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
	Row,
	TableEventMap,
	TableInterface,
	StorageInterface,
} from './types.js'
import type { TransactionScope } from './TransactionScope.js'
import { isArray, isRecord } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { DatabaseError } from './errors.js'
import {
	applyQuery,
	checkAbort,
	computeAggregate,
	equalsValue,
	extractKey,
	filterRows,
	matchesQuery,
	validatePage,
} from './helpers.js'
import { Cursor } from './Cursor.js'
import { Query } from './Query.js'
import { ScopedIterator } from './ScopedIterator.js'

/**
 * Exposes typed keyed CRUD plus fluent query and cursor access over a driver.
 *
 * @remarks
 * The table's contract is the load-bearing piece: writes go through `parse`
 * (coercing inputs and rejecting rows that don't fit with a `VALIDATION` throw),
 * reads come back through the contract guard (narrowing a stored {@link Row} to
 * the table's type — no assertion), and `contract` is exposed for
 * introspection and seeding. The driver only stores and scans; all querying is
 * the shared core engine in `helpers.ts`.
 *
 * @remarks
 * - **Observable.** The owned {@link emitter} ({@link TableEventMap}) carries the
 *   per-row mutation moments — `write` (set / add / update), `remove`, `clear` — for
 *   fire-and-forget observers (cache invalidation, sync, an audit log), ALONGSIDE the
 *   database-level lifecycle. Events carry the affected KEY only (no value payload, to
 *   keep fan-out lean); reads / queries / counts are not emitted. Every event is emitted
 *   directly, strictly AFTER the driver write / delete / clear completes; the emitter
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
	// The PUSH observation surface — owned, never inherited. The emitter isolates a
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
			const candidate: QueryInput = {
				...(input?.conditions === undefined ? {} : { conditions: input.conditions }),
				...(input?.order === undefined ? {} : { order: input.order }),
			}
			const native = await this.#driver.records?.(this.#name, candidate)
			const source = native ?? applyQuery(await this.#collect(), candidate)
			const rows: T[] = []
			for (const row of source) {
				if (this.#guard(row)) rows.push(row)
			}
			const offset = input?.offset ?? 0
			const limit = input?.limit
			return rows.slice(offset, limit === undefined ? undefined : offset + limit)
		})
	}

	/**
	 * Counts contract-valid rows matching `input`'s conditions.
	 *
	 * @remarks
	 * Paging is ignored. Candidate rows use the driver's native `records` hook
	 * when present, then the table contract guard determines the count so legacy
	 * invalid rows cannot make `count()` disagree with `records()`.
	 *
	 * @param input - Optional conditions to filter by (paging is ignored)
	 * @param options - `{ signal }` to abort
	 * @returns The count of matching contract-valid rows
	 */
	async count(input?: QueryInput, options?: OperationOptions): Promise<number> {
		validatePage(input)
		return this.#track(async () => {
			checkAbort(options?.signal)
			await this.#ready()
			const conditions = input?.conditions
			const candidate: QueryInput = conditions === undefined ? {} : { conditions }
			const native = await this.#driver.records?.(this.#name, candidate)
			const rows = native ?? filterRows(await this.#collect(), conditions ?? [])
			let count = 0
			for (const row of rows) {
				if (this.#guard(row)) count += 1
			}
			return count
		})
	}

	/**
	 * Computes an aggregate over `column` across rows matching `input`'s
	 * conditions.
	 *
	 * @remarks
	 * Unlike {@link count}, `aggregate` operates on STORED rows WITHOUT the
	 * contract guard {@link records} / {@link scan} apply — a non-conforming
	 * stored row still contributes to the computed aggregate when it matches
	 * the conditions, even though it would never appear in `records()`'s
	 * output.
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
			// Aggregate over filtered (not paged) rows — native hook, native records, or scan.
			const conditions = input?.conditions
			const filter: QueryInput = conditions ? { conditions } : {}
			// `?.()` is `undefined` only when the driver lacks the method; a present
			// hook returns a Promise (whose resolved value may itself be `undefined`).
			const native = this.#driver.aggregate?.(this.#name, operation, column, filter)
			if (native !== undefined) return native
			const rows = await this.#driver.records?.(this.#name, filter)
			const matched = rows ?? filterRows(await this.#collect(), input?.conditions ?? [])
			return computeAggregate(matched, operation, column)
		})
	}

	/**
	 * Streams the table's rows matching `input`, applying offset/limit paging.
	 *
	 * @remarks
	 * `input.limit` counts rows that pass both the input conditions and the
	 * table's contract guard. Native streams receive only the conditions; this
	 * table rechecks them, narrows each candidate, and applies offset/limit last,
	 * matching {@link records} when storage contains legacy invalid rows.
	 *
	 * @param input - Optional conditions plus offset/limit paging
	 * @param options - `{ signal }` to abort mid-stream
	 * @returns An async iterable of matching, guard-conforming rows
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
			// Observe the cleared table — AFTER the driver emptied it, so a swallowed listener
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
			let initializing = true
			const cursor = new Cursor<T>(
				await this.#driver.keys(this.#name),
				(key) => this.#readCursor(key),
				(key, changes) => this.#updateCursor(key, changes),
				(key) => this.#deleteCursor(key),
				(operation) => (initializing ? operation() : this.#track(operation)),
			)
			await cursor.next()
			initializing = false
			return cursor
		})
	}

	async *#scan(input?: QueryInput, options?: OperationOptions): AsyncIterable<T> {
		checkAbort(options?.signal)
		await this.#ready()
		const conditions = input?.conditions
		const offset = input?.offset ?? 0
		const limit = input?.limit
		let matched = 0
		let yielded = 0
		const source =
			this.#driver.stream === undefined
				? this.#driver.scan(this.#name)
				: this.#driver.stream(this.#name, conditions === undefined ? {} : { conditions })
		const iterator = source[Symbol.asyncIterator]()
		try {
			while (true) {
				await this.#ready()
				checkAbort(options?.signal)
				if (limit !== undefined && yielded >= limit) return
				const step = await iterator.next()
				await this.#ready()
				checkAbort(options?.signal)
				if (step.done === true) return
				const row = step.value
				if (conditions !== undefined && conditions.length > 0 && !matchesQuery(row, conditions)) {
					continue
				}
				const narrowed = this.#cast(row)
				if (narrowed === undefined) continue
				if (matched < offset) {
					matched += 1
					continue
				}
				matched += 1
				yielded += 1
				yield narrowed
			}
		} finally {
			await iterator.return?.()
		}
	}

	// Run a single-item operation across each item in order — the batch overloads
	// loop one item at a time (sequential, so writes never race) rather than
	// pushing batch logic into the thin driver. `signal` (write batches only) is
	// checked before EVERY item, so an abort mid-batch stops before the next
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
		return this.#cast(await this.#driver.read(this.#name, key))
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
		// Observe the written row — AFTER the driver write succeeded; carries the KEY only
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
		// Observe the updated row — AFTER the driver write, and only on the path that wrote
		// (an absent key returned `false` above, emitting nothing).
		this.#emitter.emit('write', key)
		return true
	}

	async #updateCursor(key: Key, changes: Partial<T>): Promise<boolean> {
		await this.#wait(undefined)
		return this.#updateOne(key, changes)
	}

	// Delete one row, emitting `remove` only when a row was actually removed (a delete of
	// an absent key returns `false` and emits nothing) — AFTER the driver delete completes.
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

	// Gather the table's full contents from the driver's ordered scan.
	async #collect(): Promise<readonly Row[]> {
		const rows: Row[] = []
		for await (const row of this.#driver.scan(this.#name)) rows.push(row)
		return rows
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

	// Coerce *and* validate through the contract in one step: the contract's `parse`
	// now coerces types (`'36'` → `36`) AND enforces every leaf refinement (`min` /
	// `max` / `pattern`), so a non-`undefined` result already satisfies the guard
	// (parse↔guard soundness) — no separate `is` re-check is needed.
	// `isRecord` is kept solely to narrow the parsed `T` back to a storable `Row`
	// without an assertion; a table contract is always an object shape,
	// so it never rejects a genuinely-parsed row.
	#validate(row: Row): Row {
		const parsed = this.#contract.parse(row)
		if (parsed === undefined || !isRecord(parsed)) {
			const [fault] = this.#contract.explain(row)
			throw new DatabaseError('VALIDATION', `Row failed the '${this.#name}' contract`, {
				table: this.#name,
				...(fault === undefined ? {} : { field: fault.path, reason: fault.reason }),
			})
		}
		return parsed
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

	// Narrow a stored row to the table's type through the contract guard.
	#cast(row: Row | undefined): T | undefined {
		return row !== undefined && this.#guard(row) ? row : undefined
	}

	#track<R>(operation: () => Promise<R>): Promise<R> {
		if (this.#context !== undefined) return this.#context.track(operation)
		return this.#scope === undefined ? operation() : this.#scope.track(operation)
	}
}
