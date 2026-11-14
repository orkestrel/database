import type {
	DriverInterface,
	DriverMetadata,
	Key,
	MigrationInput,
	MigrationStep,
	OperationOptions,
	Row,
	TableSchema,
} from '../types.js'
import { cloneDriverMetadata, cloneMigrationInput } from '../cloners.js'
import { isArray } from '@orkestrel/contract'
import { DatabaseError } from '../errors.js'
import {
	bindRowKey,
	checkAbort,
	compareValues,
	computeFirstIndexes,
	computeRemoved,
	equalsValue,
	buildBatch,
	migrateRows,
	normalizeDriverSchema,
	projectMigrationSchema,
} from '../helpers.js'

/**
 * Implements the reference {@link DriverInterface} — nested maps, no I/O.
 *
 * @remarks
 * The in-between made concrete: it runs identically in a browser or on a server,
 * so it is the storage behind tests, ephemeral caches, and any code that wants
 * the database API without a persistent backend. Rows are deep-copied (through
 * `structuredClone`) in and out — at `write`, `insert`, `read`, and `scan` — so a caller
 * mutating a nested field of an input row or a returned row can never perturb stored state;
 * a shallow `{ ...row }` spread
 * would still share nested object/array references. Metadata instead routes
 * through `cloneDriverMetadata`: `stamp` and migration snapshot exact JSON at
 * ingress, and `metadata` returns a distinct deeply frozen owned copy. A list write or insert
 * clones and checks every row ahead of the first store change, so it applies every row or
 * none. It declares no `transaction`; the core's journal carries a scope over it. `scan` and
 * `keys` yield in key order — sorted by the core {@link compareValues} total
 * order, the same contract the SQLite (`ORDER BY`) and IndexedDB (key-ordered
 * reads) backends honor, so an unordered read agrees across every backend rather
 * than leaking Map insertion order. A persistent backend (IndexedDB, SQLite)
 * implements the same required methods over real storage.
 */
export class MemoryDriver implements DriverInterface {
	readonly #tables = new Map<string, Map<Key, Row>>()
	#schema: readonly TableSchema[] = []
	#metadata: DriverMetadata | undefined

	async open(schema: readonly TableSchema[]): Promise<void> {
		const owned = normalizeDriverSchema(schema)
		const deployed = normalizeDriverSchema(this.#metadata?.schema ?? owned)
		for (const table of deployed) {
			if (!this.#tables.has(table.name)) this.#tables.set(table.name, new Map())
		}
		this.#schema = deployed
	}

	async close(): Promise<void> {}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		const store = this.#store(table)
		if (!isArray(keys)) return this.#clone(store.get(keys))
		return keys.map((key) => this.#clone(store.get(key)))
	}

	write(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async write(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		const entries = buildBatch(keys, rows)
		checkAbort(options?.signal)
		this.#apply(table, this.#own(table, entries))
	}

	insert(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async insert(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		const entries = buildBatch(keys, rows)
		checkAbort(options?.signal)
		const store = this.#store(table)
		const listed = entries.map(([key]) => key)
		const first = computeFirstIndexes(listed)
		const taken = listed.find((key, index) => store.has(key) || first.get(key) !== index)
		if (taken !== undefined) {
			throw new DatabaseError('CONFLICT', `Row '${taken}' already exists in table '${table}'`, {
				table,
				key: taken,
			})
		}
		this.#apply(table, this.#own(table, entries))
	}

	delete(table: string, key: Key, options?: OperationOptions): Promise<boolean>
	delete(
		table: string,
		keys: readonly Key[],
		options?: OperationOptions,
	): Promise<readonly boolean[]>
	async delete(
		table: string,
		keys: Key | readonly Key[],
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		checkAbort(options?.signal)
		const store = this.#store(table)
		if (!isArray(keys)) return store.delete(keys)
		const removed = computeRemoved(
			keys,
			keys.map((key) => store.has(key)),
		)
		for (const key of keys) store.delete(key)
		return removed
	}

	async keys(table: string): Promise<readonly Key[]> {
		return this.#ordered(table)
	}

	async *scan(table: string): AsyncIterable<Row> {
		const store = this.#store(table)
		for (const key of this.#ordered(table)) {
			const row = store.get(key)
			if (row !== undefined) yield structuredClone(row)
		}
	}

	async clear(table: string): Promise<void> {
		this.#store(table).clear()
	}

	/**
	 * Returns the persisted {@link DriverMetadata}, or `undefined` when the store has
	 * never been stamped.
	 *
	 * @remarks
	 * In-process only — the metadata lives in this instance's memory, exactly
	 * like the rest of this driver's storage. The returned value is a distinct
	 * deeply frozen owned snapshot. A driver-conformance-valid implementation of
	 * the optional `metadata` / `stamp` pair.
	 *
	 * @returns The last-stamped {@link DriverMetadata}, or `undefined`
	 */
	async metadata(): Promise<DriverMetadata | undefined> {
		return this.#metadata === undefined ? undefined : cloneDriverMetadata(this.#metadata)
	}

	/**
	 * Persists an owned snapshot for a later `metadata()` to return.
	 *
	 * @param metadata - The {@link DriverMetadata} to persist
	 */
	async stamp(metadata: DriverMetadata): Promise<void> {
		this.#metadata = cloneDriverMetadata(metadata)
	}

	/**
	 * Applies a {@link Migration} plan's steps against the in-memory store.
	 *
	 * @remarks
	 * Steps apply against an isolated candidate. Rows, schema changes, and
	 * optional metadata publish together only after the whole request succeeds.
	 *
	 * @param input - The migration plan and optional metadata to settle atomically
	 */
	async migrate(input: MigrationInput): Promise<void> {
		const owned = cloneMigrationInput(input)
		const schema = projectMigrationSchema(this.#schema, owned.plan.steps)
		if (
			owned.metadata !== undefined &&
			!equalsValue(normalizeDriverSchema(owned.metadata.schema), schema)
		) {
			throw new DatabaseError('MIGRATION', 'Migration metadata schema does not match the plan', {
				projected: schema,
				metadata: owned.metadata.schema,
			})
		}
		const candidate = this.#copy(this.#tables)
		for (const step of owned.plan.steps) this.#migrate(candidate, step)
		this.#tables.clear()
		for (const [name, store] of candidate) this.#tables.set(name, store)
		this.#schema = schema
		if (owned.metadata !== undefined) this.#metadata = owned.metadata
	}

	// Copy a stored row out, so a caller mutating it never reaches stored state.
	#clone(row: Row | undefined): Row | undefined {
		return row === undefined ? undefined : structuredClone(row)
	}

	// Bind and clone every entry ahead of the first store change, so a row that cannot be
	// cloned refuses the whole batch.
	#own(
		table: string,
		entries: ReadonlyArray<readonly [Key, Row]>,
	): ReadonlyArray<readonly [Key, Row]> {
		const primary = this.#table(table).primary
		return entries.map(
			([key, row]) => [key, structuredClone(bindRowKey(row, primary, key))] as const,
		)
	}

	#apply(table: string, entries: ReadonlyArray<readonly [Key, Row]>): void {
		const store = this.#store(table)
		for (const [key, row] of entries) store.set(key, row)
	}

	// A table's keys in key order — the contract `scan` and `keys` yield in.
	// `compareValues` is the core total order (number < string, natural within),
	// matching the SQLite `ORDER BY` and IndexedDB key-range orderings.
	#ordered(table: string): readonly Key[] {
		return [...this.#store(table).keys()].sort(compareValues)
	}

	// A migration step's table must already exist — unlike `#store`, a missing
	// table here is a MIGRATION error rather than an as-yet-untouched table.
	#require(tables: Map<string, Map<Key, Row>>, table: string): Map<Key, Row> {
		const store = tables.get(table)
		if (store === undefined) {
			throw new DatabaseError('MIGRATION', `migrate: unknown table '${table}'`, { table })
		}
		return store
	}

	#copy(tables: Map<string, Map<Key, Row>>): Map<string, Map<Key, Row>> {
		const copy = new Map<string, Map<Key, Row>>()
		for (const [name, store] of tables) {
			const cloned = new Map<Key, Row>()
			for (const [key, row] of store) cloned.set(key, structuredClone(row))
			copy.set(name, cloned)
		}
		return copy
	}

	#table(name: string): TableSchema {
		const schema = this.#schema.find((table) => table.name === name)
		if (schema === undefined) {
			throw new DatabaseError('NOT_FOUND', `Unknown table '${name}'`, { table: name })
		}
		return schema
	}

	#migrate(tables: Map<string, Map<Key, Row>>, step: MigrationStep): void {
		switch (step.operation) {
			case 'table.add':
				if (!tables.has(step.table.name)) tables.set(step.table.name, new Map())
				break
			case 'table.remove':
				this.#require(tables, step.table)
				tables.delete(step.table)
				break
			case 'column.add':
			case 'column.remove': {
				const store = this.#require(tables, step.table)
				const rows = [...store.entries()]
				const migrated = migrateRows(
					rows.map(([, row]) => row),
					[step],
				)
				for (const [index, [key]] of rows.entries()) {
					const row = migrated[index]
					if (row === undefined) {
						throw new DatabaseError('MIGRATION', 'migrate: transformed row is missing', {
							table: step.table,
							index,
						})
					}
					store.set(key, row)
				}
				break
			}
			case 'index.add':
			case 'index.remove':
				this.#require(tables, step.table)
				break
		}
	}

	// Resolve only a declared table. `open` creates every backing map,
	// so a missing map is a lookup failure rather than an implicit declaration.
	#store(table: string): Map<Key, Row> {
		this.#table(table)
		const store = this.#tables.get(table)
		if (store === undefined) {
			throw new DatabaseError('NOT_FOUND', `Table '${table}' has no backing store`, { table })
		}
		return store
	}
}
