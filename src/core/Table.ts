import type {
	AuditFault,
	ContractInterface,
	ContractRefusal,
	FieldPath,
	Guard,
} from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterInterface } from '@orkestrel/emitter'
import type { DatabaseContext } from './DatabaseContext.js'
import type {
	Aggregate,
	AggregateOperation,
	ColumnSchema,
	QueryInput,
	CursorInterface,
	Key,
	KeyFunction,
	QueryInterface,
	OperationOptions,
	ReadInput,
	Row,
	TableEventMap,
	TableInterface,
	DatabaseTableOptions,
	StorageInterface,
} from './types.js'
import type { TransactionScope } from './TransactionScope.js'
import {
	admitValue,
	attempt,
	describeFaultLine,
	describeFaults,
	extractPath,
	FAULT_LIMIT,
	isArray,
	isRecord,
	isString,
} from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { cloneQueryInput, cloneQueryPart } from './cloners.js'
import { queryInputContract } from './contracts.js'
import { DatabaseError } from './errors.js'
import { isAggregate } from './validators.js'
import {
	checkAbort,
	computeFirstIndexes,
	equalsValue,
	extractColumnHead,
	extractKey,
	findIllFormedColumn,
	maskUndefinedOperands,
	matchesIllFormedText,
	planRead,
	readPlannedAggregate,
	readPlannedRows,
	restoreUndefinedOperands,
	scanQueryFaults,
	streamPlannedRows,
} from './helpers.js'
import { Cursor } from './Cursor.js'
import { Query } from './Query.js'
import { ScopedIterator } from './ScopedIterator.js'

/**
 * Exposes typed keyed CRUD plus fluent query and cursor access over a driver.
 *
 * @remarks
 * The table's contract is the load-bearing piece: writes go through `admitValue`
 * (admitting lossless repairs and refusing an undeclared, missing, or lossy column
 * with a `VALIDATION` throw carrying the contract's `faults`),
 * reads come back through the contract guard (narrowing a stored {@link Row} to
 * the table's type, and raising `DRIVER` for a stored row that fails it), and `contract`
 * is exposed for introspection and seeding.
 *
 * Each read admits a copy of its input through `queryInputContract` and the table's columns after
 * the driver is ready, and reads only that copy; the faults of both passes wait for a refusal and
 * travel in one. A lone surrogate in a written `text` value or a key is refused. Each read runs
 * the driver's plan under the native-first rule {@link DriverInterface} states: the driver
 * answers the native side, and the core's engine runs the residual and nothing else.
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
 * - **No lifecycle verb.** The emitter ends with the handle. After the database closes, every
 *   operation refuses with `CLOSED` before it reaches the driver, so no handle emits.
 */
export class Table<T = Row> implements TableInterface<T> {
	readonly #ready: () => Promise<void>
	readonly #driver: StorageInterface
	readonly #name: string
	readonly #key: string
	readonly #contract: ContractInterface<T>
	readonly #columns: ReadonlyMap<string, ColumnSchema>
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
		columns: ReadonlyMap<string, ColumnSchema>,
		generate: KeyFunction | undefined,
		options: DatabaseTableOptions | undefined,
		error: EmitterErrorHandler | undefined,
		context?: DatabaseContext,
		scope?: TransactionScope,
	) {
		this.#ready = ready
		this.#driver = driver
		this.#name = name
		this.#key = key
		this.#contract = contract
		this.#columns = columns
		this.#guard = contract.is
		this.#generate = generate
		this.#context = context
		this.#scope = scope
		const handler = options?.error ?? error
		this.#emitter = new Emitter<TableEventMap>({
			...(options?.on === undefined ? {} : { on: options.on }),
			...(handler === undefined ? {} : { error: handler }),
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
			this.#check(keys)
			if (isArray(keys)) return this.#readMany(keys)
			return this.#read(keys)
		})
	}

	resolve(key: Key): Promise<T>
	resolve(keys: readonly Key[]): Promise<readonly T[]>
	resolve(keys: Key | readonly Key[]): Promise<T | readonly T[]> {
		return this.#track(async () => {
			await this.#ready()
			this.#check(keys)
			if (!isArray(keys)) return this.#resolveOne(keys)
			const rows = await this.#readMany(keys)
			const missing = keys.find((_, index) => rows[index] === undefined)
			if (missing !== undefined) this.#missing(missing)
			return rows.flatMap((row) => (row === undefined ? [] : [row]))
		})
	}

	has(key: Key): Promise<boolean>
	has(keys: readonly Key[]): Promise<readonly boolean[]>
	has(keys: Key | readonly Key[]): Promise<boolean | readonly boolean[]> {
		return this.#track(async () => {
			await this.#ready()
			this.#check(keys)
			if (isArray(keys)) return (await this.#readMany(keys)).map((row) => row !== undefined)
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
		return this.#track(async () => {
			checkAbort(options?.signal)
			await this.#ready()
			const read = this.#admit(input)
			const rows = await readPlannedRows(
				this.#driver,
				this.#name,
				{
					...(read.conditions === undefined ? {} : { conditions: read.conditions }),
					...(read.order === undefined ? {} : { order: read.order }),
					...(read.limit === undefined ? {} : { limit: read.limit }),
					...(read.offset === undefined ? {} : { offset: read.offset }),
				},
				() => this.#step(options),
			)
			return rows.map((row) => this.#assert(row))
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
		return this.#track(async () => {
			checkAbort(options?.signal)
			await this.#ready()
			const read = this.#admit(input)
			return (await this.#compute({ operation: 'count', column: this.#key }, read, options)) ?? 0
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
		return this.#track(async () => {
			checkAbort(options?.signal)
			await this.#ready()
			const read = this.#admit(input, { operation, column })
			return this.#compute(read.aggregate, read, options)
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
				return this.#putMany(rows, false, options)
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
				return this.#putMany(rows, true, options)
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
			this.#check(keys)
			if (isArray(keys)) {
				return this.#updateMany(keys, changes, options)
			}
			return this.#updateOne(keys, changes, options)
		})
	}

	remove(key: Key, options?: OperationOptions): Promise<boolean>
	remove(keys: readonly Key[], options?: OperationOptions): Promise<boolean>
	remove(
		keys: Key | readonly Key[],
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		return this.#track(async () => {
			await this.#wait(options?.signal)
			this.#check(keys)
			if (isArray(keys)) {
				return this.#deleteMany(keys, options)
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
		return new Query<T>(
			this,
			(input) => this.#admit(input),
			(input, aggregate) => this.#admit(input, aggregate),
		)
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
		const read = this.#admit(input)
		const plan = planRead(this.#driver, this.#name, {
			...(read.conditions === undefined ? {} : { conditions: read.conditions }),
			...(read.limit === undefined ? {} : { limit: read.limit }),
			...(read.offset === undefined ? {} : { offset: read.offset }),
		})
		const rows = streamPlannedRows(this.#driver, this.#name, plan.native, plan.residual, () =>
			this.#step(options),
		)
		for await (const row of rows) yield this.#assert(row)
	}

	// Run an aggregate read through the shared read procedure, with the table's checks.
	#compute(
		aggregate: Aggregate,
		read: QueryInput,
		options: OperationOptions | undefined,
	): Promise<number | undefined> {
		return readPlannedAggregate(
			this.#driver,
			this.#name,
			read.conditions === undefined ? {} : { conditions: read.conditions },
			aggregate,
			() => this.#step(options),
		)
	}

	// Check readiness and the abort signal around each row a read pulls.
	async #step(options: OperationOptions | undefined): Promise<void> {
		await this.#ready()
		checkAbort(options?.signal)
	}

	// Read and narrow one row per key in one driver call (assumes the driver is connected).
	async #readMany(keys: readonly Key[]): Promise<ReadonlyArray<T | undefined>> {
		const rows = await this.#driver.read(this.#name, keys)
		return rows.map((row) => (row === undefined ? undefined : this.#assert(row)))
	}

	// Admit every row ahead of the one driver call, so a refused row applies none of the batch.
	async #putMany(
		rows: readonly T[],
		insert: boolean,
		options: OperationOptions | undefined,
	): Promise<readonly Key[]> {
		const validated = rows.map((row) => this.#validate(this.#prepare(row)))
		const keys = validated.map((row) => this.#resolveKey(row))
		if (insert) await this.#driver.insert(this.#name, keys, validated, options)
		else await this.#driver.write(this.#name, keys, validated, options)
		for (const key of keys) this.#emitter.emit('write', key)
		return keys
	}

	// Merge the changes into every present row, admit each merged row, then write them in one
	// driver call; an absent key reports false.
	async #updateMany(
		keys: readonly Key[],
		changes: Partial<T>,
		options: OperationOptions | undefined,
	): Promise<readonly boolean[]> {
		const existing = await this.#driver.read(this.#name, keys)
		const present = keys.flatMap((key, index) => {
			const row = existing[index]
			return row === undefined ? [] : [[key, row] as const]
		})
		if (present.length === 0) {
			checkAbort(options?.signal)
			return keys.map(() => false)
		}
		for (const [key] of present) this.#hold(key, changes)
		const merged = present.map(([, row]) => this.#validate(Object.assign({}, row, changes)))
		await this.#driver.write(
			this.#name,
			present.map(([key]) => key),
			merged,
			options,
		)
		for (const [key] of present) this.#emitter.emit('write', key)
		return existing.map((row) => row !== undefined)
	}

	// Delete every key in one driver call, emitting `remove` for each row it removed; a key
	// repeated in the call is one key, so the list answers true only when every distinct listed key held a row and was removed.
	async #deleteMany(keys: readonly Key[], options: OperationOptions | undefined): Promise<boolean> {
		const removed = await this.#driver.delete(this.#name, keys, options)
		for (const [index, key] of keys.entries()) {
			if (removed[index] === true) this.#emitter.emit('remove', key)
		}
		const first = computeFirstIndexes(keys)
		return keys.every((key, index) => first.get(key) !== index || removed[index] === true)
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
		if (row === undefined) this.#missing(key)
		return row
	}

	#missing(key: Key): never {
		throw new DatabaseError('NOT_FOUND', `No row '${key}' in table '${this.#name}'`, {
			table: this.#name,
			key,
		})
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
		this.#hold(key, changes)
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

	// Refuse a change that moves a row to another primary key.
	#hold(key: Key, changes: Partial<T>): void {
		const input: unknown = changes
		if (isRecord(input) && Object.hasOwn(input, this.#key) && !equalsValue(input[this.#key], key)) {
			throw new DatabaseError(
				'VALIDATION',
				`Update cannot change primary column '${this.#key}' on table '${this.#name}'`,
				{ table: this.#name, column: this.#key, key },
			)
		}
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
						const aborted = attempt(() => checkAbort(signal))
						if (!aborted.success) reject(aborted.error)
					},
					{ once: true, signal: cleanup.signal },
				)
				ready.then(resolve, reject)
				const aborted = attempt(() => checkAbort(signal))
				if (!aborted.success) reject(aborted.error)
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
		if (admission.success && isRecord(admission.value.value)) {
			const column = findIllFormedColumn(admission.value.value, this.#columns)
			if (column === undefined) return admission.value.value
			throw new DatabaseError(
				'VALIDATION',
				`Column '${column}' of table '${this.#name}' holds ill-formed text: a lone surrogate has no UTF-8 form; replace it before writing`,
				{ table: this.#name, column },
			)
		}
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
		this.#check(key)
		return key
	}

	// Refuse a key that is ill-formed text, which SQLite would store changed.
	#check(keys: Key | readonly Key[]): void {
		const listed: readonly Key[] = isArray(keys) ? keys : [keys]
		if (!listed.some(matchesIllFormedText)) return
		throw new DatabaseError(
			'VALIDATION',
			`Key for column '${this.#key}' of table '${this.#name}' is ill-formed text: a lone surrogate has no UTF-8 form`,
			{ table: this.#name, column: this.#key },
		)
	}

	// Admit a copy of a read, and of its aggregate when it computes one, through the query contract
	// and the table's columns, and return the copies the read uses; faults wait for a refusal, and
	// one refusal carries both passes' faults.
	#admit(input: unknown): ReadInput
	#admit(input: unknown, aggregate: unknown): ReadInput & { readonly aggregate: Aggregate }
	#admit(input: unknown, aggregate?: unknown): ReadInput {
		if (input === undefined && aggregate === undefined) return {}
		const cloned = attempt(() => cloneQueryInput(input === undefined ? {} : input))
		const copy: unknown = cloned.success ? cloned.value : input
		const measure = aggregate === undefined ? undefined : cloneQueryPart(aggregate)
		const read = measure === undefined || !isRecord(copy) ? copy : { ...copy, aggregate: measure }
		const admitted = cloned.success ? this.#matchContract(copy) : undefined
		const contract: ContractRefusal =
			admitted === undefined ? this.#auditContract(copy) : { faults: [] }
		const columns = cloned.success ? scanQueryFaults(read, this.#columns, contract.faults) : []
		if (admitted !== undefined && columns.length === 0) {
			if (measure === undefined) return admitted
			if (isAggregate(measure)) return { ...admitted, aggregate: measure }
		}
		return this.#refuseRead(contract, columns, read)
	}

	// Narrow a copied read through the query contract, an `undefined` operand masked and restored.
	#matchContract(copy: unknown): QueryInput | undefined {
		if (queryInputContract.is(copy)) return copy
		const masked = attempt(() => maskUndefinedOperands(copy))
		if (!masked.success || masked.value === copy || !queryInputContract.is(masked.value)) {
			return undefined
		}
		return restoreUndefinedOperands(masked.value, copy)
	}

	// Compute the query contract's faults of a refused read, after the refusal.
	#auditContract(copy: unknown): ContractRefusal {
		const masked = attempt(() => maskUndefinedOperands(copy))
		const admission = admitValue(queryInputContract, masked.success ? masked.value : copy)
		return admission.success ? { faults: admission.value.repairs } : admission.error
	}

	// Raise one refusal for a read, its header naming the passes that refused, the first column
	// fault's column, its operator when the contract admitted the read, and the declared columns, and
	// its body the contract's bounded rendering of the contract's faults, then the columns' faults.
	#refuseRead(contract: ContractRefusal, columns: readonly AuditFault[], read: unknown): never {
		const faults = [...contract.faults, ...columns].slice(0, FAULT_LIMIT)
		const [fault] = columns
		const path = fault === undefined ? [] : extractPath(fault)
		const list = isRecord(read) && path[0] !== undefined ? read[path[0]] : undefined
		const entry: unknown = isArray(list) ? list[Number(path[1])] : list
		const head = isRecord(entry) ? extractColumnHead(entry.column) : undefined
		const column = head === undefined ? undefined : this.#columns.get(head)
		const operator =
			contract.faults.length === 0 && path[0] === 'conditions' && isRecord(entry)
				? entry.operator
				: undefined
		const passes = [
			...(contract.faults.length > 0 ? ['query contract'] : []),
			...(columns.length > 0 ? ['columns'] : []),
		].join(' and ')
		const declared = [...this.#columns.values()]
			.map(
				(schema) =>
					`${schema.name} ${schema.storage}${schema.optional ? ' optional' : ''}${schema.nullable ? ' nullable' : ''}`,
			)
			.join(', ')
		throw new DatabaseError(
			'VALIDATION',
			`Query failed the '${this.#name}' ${passes}${column === undefined ? '' : ` at '${column.name}' (${column.storage})`}${isString(operator) ? ` under '${operator}'` : ''}${columns.length > 0 ? ` (declared columns: ${declared})` : ''}: ${describeFaults(faults)}`,
			{
				table: this.#name,
				faults,
				...(column === undefined ? {} : { column: column.name }),
				...(isString(operator) ? { operator } : {}),
				...(contract.cause === undefined ? {} : { cause: contract.cause }),
			},
		)
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
