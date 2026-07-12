import type {
	Criteria,
	DriverInterface,
	DriverMeta,
	Key,
	Migration,
	Row,
	TableSchema,
} from '../types.js'
import { DatabaseError } from '../errors.js'
import { compareValues, matchesCriteria, migrateRows } from '../helpers.js'

/**
 * The reference {@link DriverInterface} — nested maps, no I/O.
 *
 * @remarks
 * The in-between made concrete: it runs identically in a browser or on a server,
 * so it is the storage behind tests, ephemeral caches, and any code that wants
 * the database API without a persistent backend. Rows are copied in and out so a
 * caller can never mutate stored state by reference (AGENTS §11), and `snapshot`
 * clones every table to give transactions an exact rollback point. `scan` and
 * `keys` yield in key order — sorted by the core {@link compareValues} total
 * order, the same contract the SQLite (`ORDER BY`) and IndexedDB (key-ordered
 * reads) backends honor, so an unordered read agrees across every backend rather
 * than leaking Map insertion order. A persistent backend (IndexedDB, SQLite)
 * implements the same nine methods over real storage.
 */
export class MemoryDriver implements DriverInterface {
	readonly #tables = new Map<string, Map<Key, Row>>()
	#meta: DriverMeta | undefined

	async open(schema: readonly TableSchema[]): Promise<void> {
		for (const table of schema) {
			if (!this.#tables.has(table.name)) this.#tables.set(table.name, new Map())
		}
	}

	async close(): Promise<void> {}

	async read(table: string, key: Key): Promise<Row | undefined> {
		const row = this.#store(table).get(key)
		return row === undefined ? undefined : { ...row }
	}

	async write(table: string, key: Key, row: Row): Promise<void> {
		this.#store(table).set(key, { ...row })
	}

	async delete(table: string, key: Key): Promise<boolean> {
		return this.#store(table).delete(key)
	}

	async keys(table: string): Promise<readonly Key[]> {
		return this.#ordered(table)
	}

	async *scan(table: string): AsyncIterable<Row> {
		const store = this.#store(table)
		for (const key of this.#ordered(table)) {
			const row = store.get(key)
			if (row !== undefined) yield { ...row }
		}
	}

	/**
	 * Natively filtered lazy iteration — the {@link DriverInterface.stream} hook.
	 *
	 * @remarks
	 * Iterates the table's keys in the same key order `scan` and `keys` yield
	 * (sorted by {@link compareValues}), testing each row against
	 * `criteria.conditions` (via {@link matchesCriteria}) before counting it
	 * toward `offset` / `limit`. Both are applied lazily as matches are found —
	 * `offset` matches are skipped without being yielded, and iteration stops the
	 * instant `limit` yields have been produced, so a large table is never fully
	 * walked for a small page. `criteria.order` is IGNORED (the same contract as
	 * `TableInterface.scan` and `QueryInterface.stream`): streaming yields key
	 * order, sorted output is `records()`'s job. Rows yield copy-out (AGENTS
	 * §11), and an unknown table mirrors `scan`'s empty-yield behavior.
	 *
	 * @param table - The table to stream
	 * @param criteria - The filter / offset / limit to apply lazily
	 *
	 * @example
	 * ```ts
	 * for await (const row of driver.stream('users', { conditions, limit: 10 })) {
	 *   // one matched row at a time, in key order
	 * }
	 * ```
	 */
	async *stream(table: string, criteria: Criteria): AsyncIterable<Row> {
		const store = this.#store(table)
		const conditions = criteria.conditions
		const offset = criteria.offset ?? 0
		const limit = criteria.limit
		let skipped = 0
		let yielded = 0
		for (const key of this.#ordered(table)) {
			if (limit !== undefined && yielded >= limit) return
			const row = store.get(key)
			if (row === undefined) continue
			if (conditions !== undefined && conditions.length > 0 && !matchesCriteria(row, conditions)) {
				continue
			}
			if (skipped < offset) {
				skipped += 1
				continue
			}
			yield { ...row }
			yielded += 1
		}
	}

	async clear(table: string): Promise<void> {
		this.#store(table).clear()
	}

	/**
	 * Capture the current state and return a thunk that rolls back to it.
	 *
	 * @remarks
	 * `tables` omitted clones and restores the WHOLE store, byte-identical to the
	 * prior whole-store behavior. `tables` provided clones ONLY the named tables,
	 * and the returned thunk restores ONLY those — every other table keeps
	 * whatever it was mutated to after the snapshot was taken.
	 *
	 * @param tables - The table names to scope the snapshot to; omitted captures every table
	 * @returns A thunk that restores the captured tables
	 */
	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		if (tables === undefined) {
			const copy = new Map<string, Map<Key, Row>>()
			for (const [name, store] of this.#tables) {
				const cloned = new Map<Key, Row>()
				for (const [key, row] of store) cloned.set(key, { ...row })
				copy.set(name, cloned)
			}
			return async () => {
				this.#tables.clear()
				for (const [name, store] of copy) this.#tables.set(name, store)
			}
		}
		const copy = new Map<string, Map<Key, Row>>()
		for (const name of tables) {
			const store = this.#tables.get(name)
			if (store === undefined) continue
			const cloned = new Map<Key, Row>()
			for (const [key, row] of store) cloned.set(key, { ...row })
			copy.set(name, cloned)
		}
		return async () => {
			for (const [name, store] of copy) this.#tables.set(name, store)
		}
	}

	/**
	 * Return the persisted {@link DriverMeta}, or `undefined` when the store has
	 * never been stamped.
	 *
	 * @remarks
	 * In-process only — the metadata lives in this instance's memory, exactly
	 * like the rest of this driver's storage. A driver-conformance-valid
	 * implementation of the optional `meta` / `stamp` pair.
	 *
	 * @returns The last-stamped {@link DriverMeta}, or `undefined`
	 */
	async meta(): Promise<DriverMeta | undefined> {
		return this.#meta
	}

	/**
	 * Persist `meta` verbatim for a later `meta()` to return.
	 *
	 * @param meta - The {@link DriverMeta} to persist
	 */
	async stamp(meta: DriverMeta): Promise<void> {
		this.#meta = meta
	}

	/**
	 * Apply a {@link Migration} plan's steps against the in-memory store.
	 *
	 * @remarks
	 * A multi-step plan applies its steps sequentially and is NOT atomic — a
	 * failure partway through a plan leaves the earlier steps already applied.
	 *
	 * @param plan - The migration plan to apply
	 */
	async migrate(plan: Migration): Promise<void> {
		for (const step of plan.steps) {
			switch (step.operation) {
				case 'table.add':
					if (!this.#tables.has(step.table.name)) this.#tables.set(step.table.name, new Map())
					break
				case 'table.remove':
					this.#require(step.table)
					this.#tables.delete(step.table)
					break
				case 'column.add':
				case 'column.remove': {
					const store = this.#require(step.table)
					const rows = [...store.entries()]
					const migrated = migrateRows(
						rows.map(([, row]) => row),
						[step],
					)
					rows.forEach(([key], index) => store.set(key, migrated[index]))
					break
				}
				case 'index.add':
				case 'index.remove':
					this.#require(step.table)
					break
			}
		}
	}

	// A table's keys in key order — the contract `scan` and `keys` yield in.
	// `compareValues` is the core total order (number < string, natural within),
	// matching the SQLite `ORDER BY` and IndexedDB key-range orderings.
	#ordered(table: string): readonly Key[] {
		return [...this.#store(table).keys()].sort(compareValues)
	}

	// A migration step's table must already exist — unlike `#store`, a missing
	// table here is a MIGRATION error rather than an as-yet-untouched table.
	#require(table: string): Map<Key, Row> {
		const store = this.#tables.get(table)
		if (store === undefined) {
			throw new DatabaseError('MIGRATION', `migrate: unknown table '${table}'`, { table })
		}
		return store
	}

	// Lazily create a table's backing map — a write to an as-yet-untouched (but
	// declared) table just works, and reads of an empty table return nothing.
	#store(table: string): Map<Key, Row> {
		let store = this.#tables.get(table)
		if (store === undefined) {
			store = new Map()
			this.#tables.set(table, store)
		}
		return store
	}
}
