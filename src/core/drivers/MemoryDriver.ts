import type { DriverInterface, Key, Migration, Row, TableSchema } from '../types.js'
import { DatabaseError } from '../errors.js'
import { compareValues } from '../helpers.js'
import { migrateRows } from '../migrations.js'

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

	async clear(table: string): Promise<void> {
		this.#store(table).clear()
	}

	async snapshot(): Promise<() => Promise<void>> {
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
