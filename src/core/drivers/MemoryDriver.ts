import type {
	QueryInput,
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
import { DatabaseError } from '../errors.js'
import {
	bindRowKey,
	checkAbort,
	compareValues,
	equalsValue,
	matchesQuery,
	migrateRows,
	normalizeDriverSchema,
	planMigration,
	projectMigrationSchema,
	validatePage,
} from '../helpers.js'
import { isKey } from '../validators.js'

/**
 * Implements the reference {@link DriverInterface} — nested maps, no I/O.
 *
 * @remarks
 * The in-between made concrete: it runs identically in a browser or on a server,
 * so it is the storage behind tests, ephemeral caches, and any code that wants
 * the database API without a persistent backend. Rows are DEEP-copied (through
 * `structuredClone`) in and out — at `write`, `read`, `scan`, `stream`, and both
 * snapshot capture and restore — so a caller mutating a nested field of an input
 * row, a returned row, or a row mutated in place between snapshot and rollback
 * can never perturb stored state; a shallow `{ ...row }` spread
 * would still share nested object/array references. Metadata instead routes
 * through `cloneDriverMetadata`: `stamp` and migration snapshot exact JSON at
 * ingress, and `metadata` returns a distinct deeply frozen owned copy. `snapshot`
 * clones every table to give transactions an exact rollback point. `scan` and
 * `keys` yield in key order — sorted by the core {@link compareValues} total
 * order, the same contract the SQLite (`ORDER BY`) and IndexedDB (key-ordered
 * reads) backends honor, so an unordered read agrees across every backend rather
 * than leaking Map insertion order. A persistent backend (IndexedDB, SQLite)
 * implements the same required methods over real storage.
 */
export class MemoryDriver implements DriverInterface {
	readonly #tables = new Map<string, Map<Key, Row>>()
	#identities = new Map<string, object>()
	#schema: readonly TableSchema[] = []
	#metadata: DriverMetadata | undefined

	async open(schema: readonly TableSchema[]): Promise<void> {
		const owned = normalizeDriverSchema(schema)
		const deployed = normalizeDriverSchema(this.#metadata?.schema ?? owned)
		const names = new Set(deployed.map((table) => table.name))
		for (const name of this.#identities.keys()) {
			if (!names.has(name)) this.#identities.delete(name)
		}
		for (const table of deployed) {
			if (!this.#tables.has(table.name)) this.#tables.set(table.name, new Map())
			if (!this.#identities.has(table.name)) this.#identities.set(table.name, {})
		}
		this.#schema = deployed
	}

	async close(): Promise<void> {}

	async read(table: string, key: Key): Promise<Row | undefined> {
		const row = this.#store(table).get(key)
		return row === undefined ? undefined : structuredClone(row)
	}

	async write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		checkAbort(options?.signal)
		const primary = this.#table(table).primary
		this.#store(table).set(key, structuredClone(bindRowKey(row, primary, key)))
	}

	async insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		checkAbort(options?.signal)
		const store = this.#store(table)
		if (store.has(key)) {
			throw new DatabaseError('CONFLICT', `Row '${key}' already exists in table '${table}'`, {
				table,
				key,
			})
		}
		const primary = this.#table(table).primary
		store.set(key, structuredClone(bindRowKey(row, primary, key)))
	}

	async delete(table: string, key: Key, options?: OperationOptions): Promise<boolean> {
		checkAbort(options?.signal)
		return this.#store(table).delete(key)
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

	/**
	 * Iterates rows lazily with native filtering — the {@link DriverInterface.stream} hook.
	 *
	 * @remarks
	 * Iterates the table's keys in the same key order `scan` and `keys` yield
	 * (sorted by {@link compareValues}), testing each row against
	 * `input.conditions` (through {@link matchesQuery}) before counting it
	 * toward `offset` / `limit`. Both are applied lazily as matches are found —
	 * `offset` matches are skipped without being yielded, and iteration stops the
	 * instant `limit` yields have been produced, so a large table is never fully
	 * walked for a small page. `input.order` is IGNORED (the same contract as
	 * `TableInterface.scan` and `QueryInterface.stream`): streaming yields key
	 * order, sorted output is `records()`'s job. Rows yield copy-out, and an
	 * unknown table mirrors `scan`'s empty-yield behavior.
	 *
	 * @param table - The table to stream
	 * @param input - The filter / offset / limit to apply lazily
	 *
	 * @example
	 * ```ts
	 * for await (const row of driver.stream('users', { conditions, limit: 10 })) {
	 *   // one matched row at a time, in key order
	 * }
	 * ```
	 */
	stream(table: string, input: QueryInput): AsyncIterable<Row> {
		validatePage(input)
		return this.#stream(table, input)
	}

	async clear(table: string): Promise<void> {
		this.#store(table).clear()
	}

	/**
	 * Captures the current state and returns a thunk that rolls back to it.
	 *
	 * @remarks
	 * Capture owns rows, schema, and one session-local table identity. Replay
	 * adapts rows to each surviving same-identity table's current schema before
	 * changing storage. Removed or replaced tables are skipped; uncaptured and
	 * later-added tables retain their current rows. Schema and metadata are never
	 * restored.
	 *
	 * @param tables - The table names to scope the snapshot to; omitted captures every table
	 * @returns A thunk that restores the captured tables
	 */
	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		const names =
			tables === undefined
				? this.#schema.map((table) => table.name)
				: [...new Set(tables)].filter((name) => this.#schema.some((table) => table.name === name))
		const captured = new Map<
			string,
			{
				readonly identity: object
				readonly rows: ReadonlyMap<Key, Row>
				readonly schema: TableSchema
			}
		>()
		for (const name of names) {
			const schema = this.#schema.find((table) => table.name === name)
			const store = this.#tables.get(name)
			const identity = this.#identities.get(name)
			if (schema === undefined || store === undefined || identity === undefined) continue
			const rows = new Map<Key, Row>()
			for (const [key, row] of store) rows.set(key, structuredClone(row))
			captured.set(name, { identity, rows, schema })
		}
		return async () => {
			const replacements = new Map<Map<Key, Row>, ReadonlyMap<Key, Row>>()
			for (const [name, capture] of captured) {
				const schema = this.#schema.find((table) => table.name === name)
				const store = this.#tables.get(name)
				if (
					schema === undefined ||
					store === undefined ||
					this.#identities.get(name) !== capture.identity
				) {
					continue
				}
				const plan = planMigration([capture.schema], [schema])
				const entries = [...capture.rows.entries()]
				const migrated = migrateRows(
					entries.map(([, row]) => row),
					plan.steps,
				)
				if (migrated.length !== entries.length) {
					throw new DatabaseError('MIGRATION', 'Snapshot row count changed during migration', {
						table: name,
					})
				}
				const rows = new Map<Key, Row>()
				for (const [index, [key]] of entries.entries()) {
					const row = migrated[index]
					if (!isKey(key) || row === undefined) {
						throw new DatabaseError('MIGRATION', 'Snapshot row has no usable primary key', {
							table: name,
							column: schema.primary,
							index,
						})
					}
					rows.set(key, structuredClone(bindRowKey(row, schema.primary, key)))
				}
				replacements.set(store, rows)
			}
			for (const [store, rows] of replacements) {
				store.clear()
				for (const [key, row] of rows) store.set(key, row)
			}
		}
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
		const identities = this.#projectIdentities(this.#identities, owned.plan.steps)
		for (const step of owned.plan.steps) this.#migrate(candidate, step)
		this.#tables.clear()
		for (const [name, store] of candidate) this.#tables.set(name, store)
		this.#identities = identities
		this.#schema = schema
		if (owned.metadata !== undefined) this.#metadata = owned.metadata
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

	#projectIdentities(
		identities: ReadonlyMap<string, object>,
		steps: readonly MigrationStep[],
	): Map<string, object> {
		const projected = new Map(identities)
		for (const step of steps) {
			if (step.operation === 'table.add') projected.set(step.table.name, {})
			if (step.operation === 'table.remove') projected.delete(step.table)
		}
		return projected
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

	async *#stream(table: string, input: QueryInput): AsyncIterable<Row> {
		const store = this.#store(table)
		const conditions = input.conditions
		const offset = input.offset ?? 0
		const limit = input.limit
		let skipped = 0
		let yielded = 0
		for (const key of this.#ordered(table)) {
			if (limit !== undefined && yielded >= limit) return
			const row = store.get(key)
			if (row === undefined) continue
			if (conditions !== undefined && conditions.length > 0 && !matchesQuery(row, conditions)) {
				continue
			}
			if (skipped < offset) {
				skipped += 1
				continue
			}
			yield structuredClone(row)
			yielded += 1
		}
	}

	// Resolve only a currently declared table. `open` creates every backing map,
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
