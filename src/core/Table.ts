import type { ContractInterface, FieldPath, Guard } from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterInterface } from '@orkestrel/emitter'
import type { DatabaseContext } from './DatabaseContext.js'
import type {
	AggregateOperation,
	QueryInput,
	CursorInterface,
	Key,
	KeyFunction,
	QueryInterface,
	OperationOptions,
	ReadInput,
	ReadPlan,
	Row,
	TableEventMap,
	TableInterface,
	StorageInterface,
} from './types.js'
import type { TransactionScope } from './TransactionScope.js'
import { admitValue, describeFaultLine, isArray, isRecord } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { DatabaseError } from './errors.js'
import {
	applyQuery,
	checkAbort,
	compactReadInput,
	computeAggregate,
	equalsValue,
	extractKey,
	matchesQuery,
	prepareScalars,
	validatePage,
} from './helpers.js'
import { Cursor } from './Cursor.js'
import { Query } from './Query.js'
import { ScopedIterator } from './ScopedIterator.js'
import { StreamPage } from './StreamPage.js'

/**
 * Exposes typed keyed CRUD plus fluent query and cursor access over a driver.
 *
 * @remarks
 * The table's contract is the load-bearing piece: writes go through `admitValue`
 * (admitting lossless repairs and refusing an undeclared, missing, or lossy column
 * with a `VALIDATION` throw carrying the contract's `faults`),
 * reads come back through the contract guard (narrowing a stored {@link Row} to
 * the table's type, and raising `DRIVER` for a stored row that fails it), and `contract`
 * is exposed for introspection and seeding. Each read runs the driver's plan under the
 * native-first rule {@link DriverInterface} states: the driver answers the native side, and
 * the core's engine runs the residual and nothing else.
 *
 * @remarks
 * - **Observable.** The owned {@link emitter} ({@link TableEventMap}) carries the
 *   per-row mutation moments — `write` (set / add / update), `remove`, `clear` — for
 *   fire-and-forget observers (cache invalidation, sync, an audit log), alongside the
 *   database-level lifecycle. Events carry the affected key only (no value payload, to
 *   keep fan-out lean); reads / queries / counts are not emitted. Every event is emitted
 *   directly, strictly after the driver write / delete / clear completes; the emitter
 *   isolates a listener throw and routes it to its `error` handler (the `error` option),
 *   so a buggy observer can never corrupt a write or perturb a transaction.
 */
export class Table<T = Row> implements TableInterface<T> {
	readonly #ready: () => Promise<void>
	readonly #driver: StorageInterface
	readonly #name: string
	readonly #key: string
	readonly #contract: ContractInterface<T>
	readonly #guard: Guard<T>
	readonly #generate: KeyFunction | undefined
	readonly #context: DatabaseContext | undefined
	readonly #scope: TransactionScope | undefined
	// The push observation surface — owned, never inherited. The emitter isolates a
	// listener throw (routing it to the `error` handler), so it can never escape into a write
	// or a transaction.
	readonly #emitter: Emitter<TableEventMap>

	constructor(
		ready: () => Promise<void>,
		driver: StorageInterface,
		name: string,
		key: string,
		contract: ContractInterface<T>,
		generate?: KeyFunction,
		error?: EmitterErrorHandler,
		context?: DatabaseContext,
		scope?: TransactionScope,
	) {
		this.#ready = ready
		this.#driver = driver
		this.#name = name
		this.#key = key
		this.#contract = contract
		this.#guard = contract.is
		this.#generate = generate
		this.#context = context
		this.#scope = scope
		this.#emitter = new Emitter<TableEventMap>({
			...(error !== undefined ? { error } : {}),
		})
	}

	get emitter(): EmitterInterface<TableEventMap> {
		return this.#emitter
	}

	get name(): string {
		return this.#name
	}

	get primary(): string {
		return this.#key
	}

	get contract(): ContractInterface<T> {
		return this.#contract
	}

	get(key: Key): Promise<T | undefined>
	get(keys: readonly Key[]): Promise<ReadonlyArray<T | undefined>>
	get(keys: Key | readonly Key[]): Promise<(T | undefined) | ReadonlyArray<T | undefined>> {
		return this.#track(async () => {
			await this.#ready()
			if (isArray(keys)) return this.#each(keys, (key) => this.#read(key))
			return this.#read(keys)
		})
	}

	resolve(key: Key): Promise<T>
	resolve(keys: readonly Key[]): Promise<readonly T[]>
	resolve(keys: Key | readonly Key[]): Promise<T | readonly T[]> {
		return this.#track(async () => {
			await this.#ready()
			if (isArray(keys)) return this.#each(keys, (key) => this.#resolveOne(key))
			return this.#resolveOne(keys)
		})
	}

	has(key: Key): Promise<boolean>
	has(keys: readonly Key[]): Promise<readonly boolean[]>
	has(keys: Key | readonly Key[]): Promise<boolean | readonly boolean[]> {
		return this.#track(async () => {
			await this.#ready()
			if (isArray(keys)) {
				return this.#each(keys, async (key) => (await this.#read(key)) !== undefined)
			}
			return (await this.#read(keys)) !== undefined
		})
	}

	keys(): Promise<readonly Key[]> {
		return this.#track(async () => {
			await this.#ready()
			return this.#driver.keys(this.#name)
		})
	}

	async records(input?: QueryInput, options?: OperationOptions): Promise<readonly T[]> {
		validatePage(input)
		return this.#track(async () => {
			checkAbort(options?.signal)
			await this.#ready()
			const plan = this.#plan({
				...(input?.conditions === undefined ? {} : { conditions: input.conditions }),
				...(input?.order === undefined ? {} : { order: input.order }),
				...(input?.limit === undefined ? {} : { limit: input.limit }),
				...(input?.offset === undefined ? {} : { offset: input.offset }),
			})
			const residual = plan.residual
			if (Object.keys(residual).length === 0 && this.#driver.records !== undefined) {
				const rows = await this.#driver.records(this.#name, plan.native)
				return rows.map((row) => this.#assert(row))
			}
			if (residual.order === undefined) {
				const rows: T[] = []
				for await (const row of this.#select(plan.native, residual, options)) {
					rows.push(this.#assert(row))
				}
				return rows
			}
			const matched: Row[] = []
			const filter = residual.conditions === undefined ? {} : { conditions: residual.conditions }
			for await (const row of this.#select(plan.native, filter, options)) matched.push(row)
			return applyQuery(matched, {
				order: residual.order,
				...(residual.limit === undefined ? {} : { limit: residual.limit }),
				...(residual.offset === undefined ? {} : { offset: residual.offset }),
			}).map((row) => this.#assert(row))
		})
	}

	/**
	 * Counts the stored rows matching `input`'s conditions.
	 *
	 * @remarks
	 * Paging is ignored. The count is the `count` aggregate, so it reads the stored set
	 * `records()` reads: a native plan counts in the engine and returns no row.
	 *
	 * @param input - Optional conditions to filter by (paging is ignored)
	 * @param options - `{ signal }` to abort
	 * @returns The count of matching stored rows
	 */
	async count(input?: QueryInput, options?: OperationOptions): Promise<number> {
		validatePage(input)
		return this.#track(async () => {
			checkAbort(options?.signal)
			await this.#ready()
			return (await this.#compute('count', this.#key, input, options)) ?? 0
		})
	}

	/**
	 * Computes an aggregate over `column` across the stored rows matching `input`'s
	 * conditions.
	 *
	 * @param operation - The aggregate to compute
	 * @param column - The column to aggregate
	 * @param input - Optional conditions to filter by (paging is ignored)
	 * @param options - `{ signal }` to abort
	 * @returns The aggregate value, or `undefined` when undefined for the inputs
	 */
	async aggregate(
		operation: AggregateOperation,
		column: FieldPath,
		input?: QueryInput,
		options?: OperationOptions,
	): Promise<number | undefined> {
		validatePage(input)
		return this.#track(async () => {
			checkAbort(options?.signal)
			await this.#ready()
			return this.#compute(operation, column, input, options)
		})
	}

	/**
	 * Streams the table's rows matching `input`, applying offset/limit paging.
	 *
	 * @remarks
	 * The rows come in ascending key order; `input.order` is ignored. A native plan pages
	 * in the engine; otherwise the table applies the residual conditions as rows stream and
	 * stops at `offset + limit` matches.
	 *
	 * @param input - Optional conditions plus offset/limit paging
	 * @param options - `{ signal }` to abort mid-stream
	 * @returns An async iterable of matching rows
	 */
	scan(input?: QueryInput, options?: OperationOptions): AsyncIterable<T> {
		validatePage(input)
		const source = this.#scan(input, options)
		if (this.#context !== undefined) return new ScopedIterator(source, this.#context, this.#ready)
		return this.#scope === undefined ? source : this.#scope.stream(source)
	}

	set(row: T, options?: OperationOptions): Promise<Key>
	set(rows: readonly T[], options?: OperationOptions): Promise<readonly Key[]>
	set(rows: T | readonly T[], options?: OperationOptions): Promise<Key | readonly Key[]> {
		return this.#track(async () => {
			await this.#wait(options?.signal)
			if (isArray(rows)) {
				return this.#each(rows, (row) => this.#put(row, false, options), options?.signal)
			}
			return this.#put(rows, false, options)
		})
	}

	add(row: T, options?: OperationOptions): Promise<Key>
	add(rows: readonly T[], options?: OperationOptions): Promise<readonly Key[]>
	add(rows: T | readonly T[], options?: OperationOptions): Promise<Key | readonly Key[]> {
		return this.#track(async () => {
			await this.#wait(options?.signal)
			if (isArray(rows)) {
				return this.#each(rows, (row) => this.#put(row, true, options), options?.signal)
			}
			return this.#put(rows, true, options)
		})
	}

	update(key: Key, changes: Partial<T>, options?: OperationOptions): Promise<boolean>
	update(
		keys: readonly Key[],
		changes: Partial<T>,
		options?: OperationOptions,
	): Promise<readonly boolean[]>
	update(
		keys: Key | readonly Key[],
		changes: Partial<T>,
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		return this.#track(async () => {
			await this.#wait(options?.signal)
			if (isArray(keys)) {
				return this.#each(keys, (key) => this.#updateOne(key, changes, options), options?.signal)
			}
			return this.#updateOne(keys, changes, options)
		})
	}

	remove(key: Key, options?: OperationOptions): Promise<boolean>
	remove(keys: readonly Key[], options?: OperationOptions): Promise<readonly boolean[]>
	remove(
		keys: Key | readonly Key[],
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		return this.#track(async () => {
			await this.#wait(options?.signal)
			if (isArray(keys)) {
				return this.#each(keys, (key) => this.#delete(key, options), options?.signal)
			}
			return this.#delete(keys, options)
		})
	}

	clear(): Promise<void> {
		return this.#track(async () => {
			await this.#ready()
			await this.#driver.clear(this.#name)
			// Observe the cleared table — after the driver emptied it, so a swallowed listener
			// throw can never alter the clear (no value payload — `clear` is a pure signal).
			this.#emitter.emit('clear')
		})
	}

	query(): QueryInterface<T> {
		return new Query<T>(this)
	}

	cursor(): Promise<CursorInterface<T>> {
		return this.#track(async () => {
			await this.#ready()
			const cursor = new Cursor<T>(
				await this.#driver.keys(this.#name),
				(key) => this.#readCursor(key),
				(key, changes) => this.#updateCursor(key, changes),
				(key) => this.#deleteCursor(key),
				(operation) => this.#track(operation),
				true,
			)
			await cursor.next()
			return cursor
		})
	}

	async *#scan(input?: QueryInput, options?: OperationOptions): AsyncIterable<T> {
		checkAbort(options?.signal)
		await this.#ready()
		const plan = this.#plan({
			...(input?.conditions === undefined ? {} : { conditions: input.conditions }),
			...(input?.limit === undefined ? {} : { limit: input.limit }),
			...(input?.offset === undefined ? {} : { offset: input.offset }),
		})
		for await (const row of this.#select(plan.native, plan.residual, options)) {
			yield this.#assert(row)
		}
	}

	// Ask the driver for its plan; a driver without the native members leaves the whole read
	// residual over `scan`.
	#plan(input: ReadInput): ReadPlan {
		const read = compactReadInput(input)
		const driver = this.#driver
		if (driver.plan === undefined || driver.records === undefined || driver.stream === undefined) {
			return { native: {}, residual: read }
		}
		return driver.plan(this.#name, read)
	}

	// Stream the native side, apply the residual conditions, and window by the residual page,
	// stopping at `offset + limit` matches. The residual order is the caller's.
	async *#select(
		native: ReadInput,
		residual: ReadInput,
		options?: OperationOptions,
	): AsyncIterable<Row> {
		const conditions = residual.conditions ?? []
		const scalars = prepareScalars(conditions)
		const limit = residual.limit
		const page = new StreamPage(residual.offset ?? 0)
		const source =
			this.#driver.plan === undefined || this.#driver.stream === undefined
				? this.#driver.scan(this.#name)
				: this.#driver.stream(this.#name, native)
		const iterator = source[Symbol.asyncIterator]()
		try {
			while (true) {
				await this.#ready()
				checkAbort(options?.signal)
				if (limit !== undefined && page.count >= limit) return
				const step = await iterator.next()
				await this.#ready()
				checkAbort(options?.signal)
				if (step.done === true) return
				const row = step.value
				if (conditions.length > 0 && !matchesQuery(row, conditions, scalars)) continue
				if (!page.next()) continue
				yield row
			}
		} finally {
			await iterator.return?.()
		}
	}

	// Run an aggregate read: the engine computes it when the plan keeps it native; otherwise
	// the residual conditions filter the native rows and the core reduces them, asserting none.
	async #compute(
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput | undefined,
		options: OperationOptions | undefined,
	): Promise<number | undefined> {
		const plan = this.#plan({
			...(input?.conditions === undefined ? {} : { conditions: input.conditions }),
			aggregate: { operation, column },
		})
		const { aggregate, ...native } = plan.native
		if (aggregate !== undefined && this.#driver.aggregate !== undefined) {
			return this.#driver.aggregate(this.#name, aggregate.operation, aggregate.column, native)
		}
		const filter =
			plan.residual.conditions === undefined ? {} : { conditions: plan.residual.conditions }
		const rows: Row[] = []
		for await (const row of this.#select(native, filter, options)) rows.push(row)
		return computeAggregate(rows, operation, column)
	}

	// Run a single-item operation across each item in order — the batch overloads
	// loop one item at a time (sequential, so writes never race) rather than
	// pushing batch logic into the thin driver. `signal` (write batches only) is
	// checked before every item, so an abort mid-batch stops before the next
	// item runs — already-applied items stay applied (no rollback).
	async #each<I, R>(
		elements: readonly I[],
		operation: (element: I) => Promise<R>,
		signal?: AbortSignal,
	): Promise<readonly R[]> {
		const results: R[] = []
		for (const element of elements) {
			checkAbort(signal)
			results.push(await operation(element))
		}
		return results
	}

	// Read and narrow one row (assumes the driver is connected).
	async #read(key: Key): Promise<T | undefined> {
		const row = await this.#driver.read(this.#name, key)
		return row === undefined ? undefined : this.#assert(row)
	}

	async #readCursor(key: Key): Promise<T | undefined> {
		await this.#ready()
		return this.#read(key)
	}

	// Read one row or throw NOT_FOUND.
	async #resolveOne(key: Key): Promise<T> {
		const row = await this.#read(key)
		if (row === undefined) {
			throw new DatabaseError('NOT_FOUND', `No row '${key}' in table '${this.#name}'`, {
				table: this.#name,
				key,
			})
		}
		return row
	}

	// Coerce/validate and write one row; `insert` selects the atomic insert primitive.
	async #put(row: T, insert: boolean, options?: OperationOptions): Promise<Key> {
		const validated = this.#validate(this.#prepare(row))
		const key = this.#resolveKey(validated)
		if (insert) await this.#driver.insert(this.#name, key, validated, options)
		else await this.#driver.write(this.#name, key, validated, options)
		// Observe the written row — after the driver write succeeded; carries the key only
		// (set / add / update all emit one `write`, the consumer re-reads if it needs the
		// value). A swallowed listener throw can't perturb the write (or its transaction).
		this.#emitter.emit('write', key)
		return key
	}

	// Merge changes into one existing row and re-validate; `false` when it is absent.
	async #updateOne(key: Key, changes: Partial<T>, options?: OperationOptions): Promise<boolean> {
		const existing = await this.#driver.read(this.#name, key)
		if (existing === undefined) {
			checkAbort(options?.signal)
			return false
		}
		const input: unknown = changes
		if (isRecord(input) && Object.hasOwn(input, this.#key) && !equalsValue(input[this.#key], key)) {
			throw new DatabaseError(
				'VALIDATION',
				`Update cannot change primary column '${this.#key}' on table '${this.#name}'`,
				{ table: this.#name, column: this.#key, key },
			)
		}
		await this.#driver.write(
			this.#name,
			key,
			this.#validate(Object.assign({}, existing, changes)),
			options,
		)
		// Observe the updated row — after the driver write, and only on the path that wrote
		// (an absent key returned `false` above, emitting nothing).
		this.#emitter.emit('write', key)
		return true
	}

	async #updateCursor(key: Key, changes: Partial<T>): Promise<boolean> {
		await this.#wait(undefined)
		return this.#updateOne(key, changes)
	}

	// Delete one row, emitting `remove` only when a row was actually removed (a delete of
	// an absent key returns `false` and emits nothing) — after the driver delete completes.
	async #delete(key: Key, options?: OperationOptions): Promise<boolean> {
		const removed = await this.#driver.delete(this.#name, key, options)
		if (removed) this.#emitter.emit('remove', key)
		return removed
	}

	async #deleteCursor(key: Key): Promise<boolean> {
		await this.#wait(undefined)
		return this.#delete(key)
	}

	// Await the shared lazy-open promise without tying its lifetime to this
	// mutation. An abort rejects this waiter promptly and consumes the open
	// promise's later settlement; the driver still checks the same signal at its
	// commit point, so a readiness completion after abort can never dispatch a
	// row mutation.
	async #wait(signal: AbortSignal | undefined): Promise<void> {
		checkAbort(signal)
		const ready = this.#ready()
		if (signal === undefined) {
			await ready
			return
		}
		const cleanup = new AbortController()
		try {
			await new Promise<void>((resolve, reject) => {
				signal.addEventListener(
					'abort',
					() => {
						ready.catch(() => {})
						try {
							checkAbort(signal)
						} catch (error) {
							reject(error)
						}
					},
					{ once: true, signal: cleanup.signal },
				)
				ready.then(resolve, reject)
				if (signal.aborted) {
					ready.catch(() => {})
					try {
						checkAbort(signal)
					} catch (error) {
						reject(error)
					}
				}
			})
		} finally {
			cleanup.abort()
		}
		checkAbort(signal)
	}

	// Copy the input and assign a generated key when the key column is empty.
	#prepare(row: T): Row {
		if (!isRecord(row)) {
			throw new DatabaseError('VALIDATION', `Row for table '${this.#name}' is not a record`, {
				table: this.#name,
			})
		}
		const prepared: Row = { ...row }
		if (prepared[this.#key] === undefined) {
			if (this.#generate !== undefined) {
				try {
					prepared[this.#key] = this.#generate()
				} catch (cause) {
					throw new DatabaseError(
						'VALIDATION',
						`Failed to generate primary column '${this.#key}' for table '${this.#name}'`,
						{ table: this.#name, column: this.#key, cause },
					)
				}
			} else {
				try {
					prepared[this.#key] = crypto.randomUUID()
				} catch (cause) {
					throw new DatabaseError(
						'DRIVER',
						`Host failed to generate primary column '${this.#key}' for table '${this.#name}'`,
						{ table: this.#name, column: this.#key, cause },
					)
				}
			}
		}
		return prepared
	}

	// `isRecord` only narrows the admitted `T` back to a storable `Row`: a table contract is
	// always an object shape, so it never refuses an admitted row.
	#validate(row: Row): Row {
		const admission = admitValue(this.#contract, row)
		if (admission.success && isRecord(admission.value.value)) return admission.value.value
		const faults = admission.success ? [] : admission.error.faults
		const [fault] = faults
		throw new DatabaseError(
			'VALIDATION',
			fault === undefined
				? `Row failed the '${this.#name}' contract`
				: `Row failed the '${this.#name}' contract: ${describeFaultLine(fault, this.#contract.schema)}`,
			{ table: this.#name, faults },
		)
	}

	#resolveKey(row: Row): Key {
		const key = extractKey(row, this.#key)
		if (key === undefined) {
			throw new DatabaseError('VALIDATION', `Row has no usable key in column '${this.#key}'`, {
				table: this.#name,
				column: this.#key,
			})
		}
		return key
	}

	// Narrow a stored row to the table's type, raising DRIVER for a row that fails the contract.
	#assert(row: Row): T {
		if (this.#guard(row)) return row
		const admission = admitValue(this.#contract, row)
		const faults = admission.success ? [] : admission.error.faults
		const [fault] = faults
		throw new DatabaseError(
			'DRIVER',
			fault === undefined
				? `Stored row failed the '${this.#name}' contract`
				: `Stored row failed the '${this.#name}' contract: ${describeFaultLine(fault, this.#contract.schema)}`,
			{ table: this.#name, key: extractKey(row, this.#key), faults },
		)
	}

	#track<R>(operation: () => Promise<R>): Promise<R> {
		if (this.#context !== undefined) return this.#context.track(operation)
		return this.#scope === undefined ? operation() : this.#scope.track(operation)
	}
}
