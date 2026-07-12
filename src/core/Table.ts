import type { ContractInterface, FieldPath, Guard } from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type {
	AggregateFunction,
	Criteria,
	CursorInterface,
	DriverInterface,
	Key,
	KeyFunction,
	QueryInterface,
	Row,
	TableEventMap,
	TableInterface,
} from './types.js'
import { isArray, isRecord } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { DatabaseError } from './errors.js'
import { applyCriteria, computeAggregate, extractKey, matchesCriteria } from './helpers.js'
import { Cursor } from './Cursor.js'
import { Query } from './Query.js'

/**
 * A table — typed keyed CRUD plus fluent query and cursor access over a driver.
 *
 * @remarks
 * The table's contract is the load-bearing piece: writes go through `parse`
 * (coercing inputs and rejecting rows that don't fit with a `VALIDATION` throw),
 * reads come back through the contract guard (narrowing a stored {@link Row} to
 * the table's type — no assertion, AGENTS §1), and `contract` is exposed for
 * introspection and seeding. The driver only stores and scans; all querying is
 * the shared core engine in `helpers.ts`.
 *
 * @remarks
 * - **Observable (§13).** The owned {@link emitter} ({@link TableEventMap}) carries the
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
	readonly #driver: DriverInterface
	readonly #name: string
	readonly #key: string
	readonly #contract: ContractInterface<T>
	readonly #guard: Guard<T>
	readonly #generate: KeyFunction | undefined
	// The PUSH observation surface (§13) — owned, never inherited. The emitter isolates a
	// listener throw (routing it to the `error` handler), so it can never escape into a write
	// or a transaction.
	readonly #emitter: Emitter<TableEventMap>

	constructor(
		ready: () => Promise<void>,
		driver: DriverInterface,
		name: string,
		key: string,
		contract: ContractInterface<T>,
		generate?: KeyFunction,
		on?: EmitterHooks<TableEventMap>,
		error?: EmitterErrorHandler,
	) {
		this.#ready = ready
		this.#driver = driver
		this.#name = name
		this.#key = key
		this.#contract = contract
		this.#guard = contract.is
		this.#generate = generate
		this.#emitter = new Emitter<TableEventMap>({ on, error })
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
	get(keys: readonly Key[]): Promise<readonly (T | undefined)[]>
	async get(keys: Key | readonly Key[]): Promise<(T | undefined) | readonly (T | undefined)[]> {
		await this.#ready()
		if (isArray(keys)) return this.#each(keys, (key) => this.#read(key))
		return this.#read(keys)
	}

	resolve(key: Key): Promise<T>
	resolve(keys: readonly Key[]): Promise<readonly T[]>
	async resolve(keys: Key | readonly Key[]): Promise<T | readonly T[]> {
		await this.#ready()
		if (isArray(keys)) return this.#each(keys, (key) => this.#resolveOne(key))
		return this.#resolveOne(keys)
	}

	has(key: Key): Promise<boolean>
	has(keys: readonly Key[]): Promise<readonly boolean[]>
	async has(keys: Key | readonly Key[]): Promise<boolean | readonly boolean[]> {
		await this.#ready()
		if (isArray(keys)) return this.#each(keys, async (key) => (await this.#read(key)) !== undefined)
		return (await this.#read(keys)) !== undefined
	}

	async keys(): Promise<readonly Key[]> {
		await this.#ready()
		return this.#driver.keys(this.#name)
	}

	async records(criteria?: Criteria): Promise<readonly T[]> {
		await this.#ready()
		// Native filtered read when the backend offers one; else the engine over scan.
		const native = await this.#driver.records?.(this.#name, criteria ?? {})
		const source = native ?? applyCriteria(await this.#collect(), criteria)
		const rows: T[] = []
		for (const row of source) {
			if (this.#guard(row)) rows.push(row)
		}
		return rows
	}

	async count(criteria?: Criteria): Promise<number> {
		await this.#ready()
		// Counts ignore paging — pass conditions only, so native and scan agree.
		const conditions = criteria?.conditions
		const native = await this.#driver.count?.(this.#name, conditions ? { conditions } : {})
		if (native !== undefined) return native
		return this.#match(await this.#collect(), criteria).length
	}

	async aggregate(
		operation: AggregateFunction,
		column: FieldPath,
		criteria?: Criteria,
	): Promise<number | undefined> {
		await this.#ready()
		// Aggregate over filtered (not paged) rows — native hook, native records, or scan.
		const conditions = criteria?.conditions
		const filter: Criteria = conditions ? { conditions } : {}
		// `?.()` is `undefined` only when the driver lacks the method; a present
		// hook returns a Promise (whose resolved value may itself be `undefined`).
		const native = this.#driver.aggregate?.(this.#name, operation, column, filter)
		if (native !== undefined) return native
		const rows = await this.#driver.records?.(this.#name, filter)
		const matched = rows ?? this.#match(await this.#collect(), criteria)
		return computeAggregate(matched, operation, column)
	}

	set(row: T): Promise<Key>
	set(rows: readonly T[]): Promise<readonly Key[]>
	async set(rows: T | readonly T[]): Promise<Key | readonly Key[]> {
		await this.#ready()
		if (isArray(rows)) return this.#each(rows, (row) => this.#put(row, false))
		return this.#put(rows, false)
	}

	add(row: T): Promise<Key>
	add(rows: readonly T[]): Promise<readonly Key[]>
	async add(rows: T | readonly T[]): Promise<Key | readonly Key[]> {
		await this.#ready()
		if (isArray(rows)) return this.#each(rows, (row) => this.#put(row, true))
		return this.#put(rows, true)
	}

	update(key: Key, changes: Partial<T>): Promise<boolean>
	update(keys: readonly Key[], changes: Partial<T>): Promise<readonly boolean[]>
	async update(
		keys: Key | readonly Key[],
		changes: Partial<T>,
	): Promise<boolean | readonly boolean[]> {
		await this.#ready()
		if (isArray(keys)) return this.#each(keys, (key) => this.#updateOne(key, changes))
		return this.#updateOne(keys, changes)
	}

	remove(key: Key): Promise<boolean>
	remove(keys: readonly Key[]): Promise<readonly boolean[]>
	async remove(keys: Key | readonly Key[]): Promise<boolean | readonly boolean[]> {
		await this.#ready()
		if (isArray(keys)) return this.#each(keys, (key) => this.#delete(key))
		return this.#delete(keys)
	}

	async clear(): Promise<void> {
		await this.#ready()
		await this.#driver.clear(this.#name)
		// Observe the cleared table — AFTER the driver emptied it, so a swallowed listener
		// throw can never alter the clear (no value payload — `clear` is a pure signal).
		this.#emitter.emit('clear')
	}

	query(): QueryInterface<T> {
		return new Query<T>(this)
	}

	async cursor(): Promise<CursorInterface<T>> {
		await this.#ready()
		const cursor = new Cursor<T>(this, await this.#driver.keys(this.#name))
		await cursor.next()
		return cursor
	}

	// Run a single-item operation across each item in order — the batch overloads
	// loop one item at a time (sequential, so writes never race) rather than
	// pushing batch logic into the thin driver.
	async #each<I, R>(
		items: readonly I[],
		operation: (item: I) => Promise<R>,
	): Promise<readonly R[]> {
		const results: R[] = []
		for (const item of items) results.push(await operation(item))
		return results
	}

	// Read and narrow one row (assumes the driver is connected).
	async #read(key: Key): Promise<T | undefined> {
		return this.#cast(await this.#driver.read(this.#name, key))
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

	// Coerce/validate and write one row; `exclusive` makes it an insert (CONFLICT on a dup).
	async #put(row: T, exclusive: boolean): Promise<Key> {
		const validated = this.#validate(this.#prepare(row))
		const key = this.#resolveKey(validated)
		if (exclusive && (await this.#driver.read(this.#name, key)) !== undefined) {
			throw new DatabaseError('CONFLICT', `Row '${key}' already exists in table '${this.#name}'`, {
				table: this.#name,
				key,
			})
		}
		await this.#driver.write(this.#name, key, validated)
		// Observe the written row — AFTER the driver write succeeded; carries the KEY only
		// (set / add / update all emit one `write`, the consumer re-reads if it needs the
		// value). A swallowed listener throw can't perturb the write (or its transaction).
		this.#emitter.emit('write', key)
		return key
	}

	// Merge changes into one existing row and re-validate; `false` when it is absent.
	async #updateOne(key: Key, changes: Partial<T>): Promise<boolean> {
		const existing = await this.#driver.read(this.#name, key)
		if (existing === undefined) return false
		await this.#driver.write(this.#name, key, this.#validate(Object.assign({}, existing, changes)))
		// Observe the updated row — AFTER the driver write, and only on the path that wrote
		// (an absent key returned `false` above, emitting nothing).
		this.#emitter.emit('write', key)
		return true
	}

	// Delete one row, emitting `remove` only when a row was actually removed (a delete of
	// an absent key returns `false` and emits nothing) — AFTER the driver delete completes.
	async #delete(key: Key): Promise<boolean> {
		const removed = await this.#driver.delete(this.#name, key)
		if (removed) this.#emitter.emit('remove', key)
		return removed
	}

	// Gather the table's full contents from the driver's ordered scan.
	async #collect(): Promise<readonly Row[]> {
		const rows: Row[] = []
		for await (const row of this.#driver.scan(this.#name)) rows.push(row)
		return rows
	}

	// Filter rows by a criteria's conditions only (no sort/page) — the shared basis
	// for count and aggregate, matching what the native count/records paths compute.
	#match(rows: readonly Row[], criteria?: Criteria): readonly Row[] {
		const conditions = criteria?.conditions
		if (conditions === undefined || conditions.length === 0) return rows
		return rows.filter((row) => matchesCriteria(row, conditions))
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
			if (this.#generate === undefined) {
				throw new DatabaseError(
					'VALIDATION',
					`Row for table '${this.#name}' is missing its key column '${this.#key}' and no key factory was provided`,
					{ table: this.#name, column: this.#key },
				)
			}
			prepared[this.#key] = this.#generate()
		}
		return prepared
	}

	// Coerce *and* validate through the contract in one step: the contract's `parse`
	// now coerces types (`'36'` → `36`) AND enforces every leaf refinement (`min` /
	// `max` / `pattern`), so a non-`undefined` result already satisfies the guard
	// (AGENTS §14 parse↔guard soundness) — no separate `is` re-check is needed.
	// `isRecord` is kept solely to narrow the parsed `T` back to a storable `Row`
	// without an assertion (AGENTS §1); a table contract is always an object shape,
	// so it never rejects a genuinely-parsed row.
	#validate(row: Row): Row {
		const parsed = this.#contract.parse(row)
		if (parsed === undefined || !isRecord(parsed)) {
			throw new DatabaseError('VALIDATION', `Row failed the '${this.#name}' contract`, {
				table: this.#name,
				row,
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
}
