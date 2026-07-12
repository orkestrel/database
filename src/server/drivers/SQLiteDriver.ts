import type {
	AggregateFunction,
	Criteria,
	DriverInterface,
	DriverMeta,
	Key,
	Migration,
	Row,
	TableSchema,
	TransactionInterface,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { SQLiteDatabaseInterface, SQLiteRow, SQLiteValue } from '@orkestrel/sqlite'
import { DatabaseError } from '@src/core'
import { createSQLiteDatabase } from '@orkestrel/sqlite'
import { compileCriteria } from '../compilers.js'
import {
	aggregateSQL,
	decodeRow,
	encodeRow,
	encodeValue,
	isTableSchema,
	quote,
	schemaToIndexes,
	schemaToTable,
	stepToSchema,
	stepToSQL,
} from '../helpers.js'

// The reserved single-row metadata table `meta` / `stamp` persist through — a
// user table named `_meta` collides with it (the caller's concern to avoid,
// documented on the class below).
const META_TABLE = '_meta'

/**
 * The SQLite {@link DriverInterface} — the server-native, trusted-mode backend
 * built on the published `@orkestrel/sqlite` synchronous wrapper.
 *
 * @remarks
 * A thin adapter: it implements the storage primitives the core database layer
 * needs by delegating to the wrapper's prepared statements — it never touches
 * raw `node:sqlite`. `open` issues `CREATE TABLE IF NOT EXISTS` with real typed
 * columns (mapped from each {@link TableSchema}'s portable column types) and a
 * `PRIMARY KEY`, plus a `CREATE INDEX IF NOT EXISTS` per declared index (both
 * reopen-safe), and readies a reserved `_meta` single-row table `meta()` /
 * `stamp()` read and write — **a user table named `_meta` collides with it**;
 * avoid the name. Rows cross the boundary through the codecs in `helpers.ts`
 * (`json` columns store / parse JSON text, a `boolean` stores `1` / `0`), so the
 * typed layer above imposes the exact shape (AGENTS §14). `write` is an
 * `INSERT OR REPLACE` upsert — the `Table` layer detects a `CONFLICT` via a
 * prior `has`, so this never translates a constraint error; a backend
 * `SQLiteError` otherwise propagates unchanged. Querying, ordering, paging, and
 * aggregation are native: `records` / `count` / `stream` compile a `Criteria`
 * to SQL with `compileCriteria`, and `aggregate` runs a SQL
 * `COUNT`/`SUM`/`AVG`/`MIN`/`MAX` (via `aggregateSQL`) over the same compiled
 * WHERE. `transaction` wraps native `BEGIN` / `COMMIT` / `ROLLBACK` with
 * double-settle guards. `migrate` runs the plan's projected DDL
 * ({@link import('../helpers.js').stepToSQL}) inside one native
 * `database.transaction` — a mid-plan failure rolls back atomically, an
 * improvement over the non-atomic `MemoryDriver` / `JSONDriver` migrate; a
 * step referencing an undeclared table throws `DatabaseError` `MIGRATION`
 * before any DDL for that step runs. `snapshot` is capture-replay (SELECT the
 * named tables' rows, replay via DELETE + INSERT OR REPLACE inside a native
 * transaction on rollback) rather than a SQL `SAVEPOINT`, since the core
 * `transaction` calls the rollback thunk only on failure with no commit-on-
 * success signal — a long-lived `SAVEPOINT` would leave the connection
 * uncommitted (lost on close). The only {@link DatabaseError} it emits directly
 * is `CLOSED` (a use before `open` / after `close`) and `MIGRATION`; every
 * other propagated fault is a backend `SQLiteError`.
 */
export class SQLiteDriver implements DriverInterface {
	readonly #path: string
	#database: SQLiteDatabaseInterface | undefined
	#schema = new Map<string, TableSchema>()

	constructor(path: string) {
		this.#path = path
	}

	async open(schema: readonly TableSchema[]): Promise<void> {
		this.#database?.close()
		const database = createSQLiteDatabase({ path: this.#path })
		database.connect()
		const map = new Map<string, TableSchema>()
		for (const table of schema) {
			map.set(table.name, table)
			database.exec(schemaToTable(table))
			for (const sql of schemaToIndexes(table)) database.exec(sql)
		}
		database.exec(
			'CREATE TABLE IF NOT EXISTS ' +
				quote(META_TABLE) +
				' ("id" INTEGER, "version" INTEGER, "schema" TEXT, PRIMARY KEY ("id"))',
		)
		this.#schema = map
		this.#database = database
	}

	async close(): Promise<void> {
		this.#database?.close()
		this.#database = undefined
	}

	async read(table: string, key: Key): Promise<Row | undefined> {
		const schema = this.#table(table)
		const row = this.#require()
			.prepare('SELECT * FROM ' + quote(table) + ' WHERE ' + quote(schema.primary) + ' = ?')
			.get([this.#key(key, schema)])
		return row === undefined ? undefined : decodeRow(row, schema)
	}

	async write(table: string, key: Key, row: Row): Promise<void> {
		const schema = this.#table(table)
		const encoded = encodeRow({ ...row, [schema.primary]: key }, schema)
		const names = schema.columns.map((column) => column.name)
		const values = names.map((name) => encoded[name])
		this.#require()
			.prepare(
				'INSERT OR REPLACE INTO ' +
					quote(table) +
					' (' +
					names.map(quote).join(', ') +
					') VALUES (' +
					names.map(() => '?').join(', ') +
					')',
			)
			.run(values)
	}

	async delete(table: string, key: Key): Promise<boolean> {
		const schema = this.#table(table)
		const result = this.#require()
			.prepare('DELETE FROM ' + quote(table) + ' WHERE ' + quote(schema.primary) + ' = ?')
			.run([this.#key(key, schema)])
		return result.changes > 0
	}

	async keys(table: string): Promise<readonly Key[]> {
		const schema = this.#table(table)
		const primary = quote(schema.primary)
		// ORDER BY the primary key: the contract lists keys in key order, and SQLite
		// returns rows in rowid (insertion) order without it.
		const rows = this.#require()
			.prepare('SELECT ' + primary + ' FROM ' + quote(table) + ' ORDER BY ' + primary)
			.all()
		const keys: Key[] = []
		for (const row of rows) {
			const value = row[schema.primary]
			if (typeof value === 'string' || typeof value === 'number') keys.push(value)
		}
		return keys
	}

	async *scan(table: string): AsyncIterable<Row> {
		const schema = this.#table(table)
		// ORDER BY the primary key so the scan yields rows in key order (the engine
		// and cursors depend on it), not SQLite's default rowid order.
		for (const row of this.#require()
			.prepare('SELECT * FROM ' + quote(table) + ' ORDER BY ' + quote(schema.primary))
			.iterate()) {
			yield decodeRow(row, schema)
		}
	}

	async clear(table: string): Promise<void> {
		this.#table(table)
		this.#require()
			.prepare('DELETE FROM ' + quote(table))
			.run()
	}

	async records(table: string, criteria: Criteria): Promise<readonly Row[]> {
		const schema = this.#table(table)
		const { sql, params } = compileCriteria(criteria, schema)
		const rows = this.#require()
			.prepare('SELECT * FROM ' + quote(table) + (sql === '' ? '' : ' ' + sql))
			.all(params)
		return rows.map((row) => decodeRow(row, schema))
	}

	async count(table: string, criteria: Criteria): Promise<number> {
		const schema = this.#table(table)
		const { sql, params } = compileCriteria(criteria, schema)
		const row = this.#require()
			.prepare('SELECT COUNT(*) AS count FROM ' + quote(table) + (sql === '' ? '' : ' ' + sql))
			.get(params)
		const value = row?.count
		return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : 0
	}

	async aggregate(
		table: string,
		operation: AggregateFunction,
		column: FieldPath,
		criteria: Criteria,
	): Promise<number | undefined> {
		const schema = this.#table(table)
		const { sql, params } = compileCriteria(criteria, schema)
		const value = this.#require()
			.prepare(
				'SELECT ' +
					aggregateSQL(operation, column) +
					' AS value FROM ' +
					quote(table) +
					(sql === '' ? '' : ' ' + sql),
			)
			.get(params)?.value
		// Over zero matched rows SUM/AVG/MIN/MAX are SQL NULL → undefined (the engine
		// agrees); COUNT(*) is 0. A clean numeric column coerces as the engine does.
		return value === null || value === undefined ? undefined : Number(value)
	}

	async *stream(table: string, criteria: Criteria): AsyncIterable<Row> {
		const schema = this.#table(table)
		const { sql, params } = compileCriteria(criteria, schema)
		for (const row of this.#require()
			.prepare('SELECT * FROM ' + quote(table) + (sql === '' ? '' : ' ' + sql))
			.iterate(params)) {
			yield decodeRow(row, schema)
		}
	}

	/**
	 * Begin a native transaction — real `BEGIN`, `COMMIT`, `ROLLBACK`.
	 *
	 * @remarks
	 * Calling `commit` or `rollback` a second time (on either method, in either
	 * order) throws `DatabaseError` `CONFLICT`.
	 *
	 * @returns A {@link TransactionInterface} handle to `commit` or `rollback`
	 */
	async transaction(): Promise<TransactionInterface> {
		const database = this.#require()
		database.exec('BEGIN')
		let settled = false
		return {
			commit: async () => {
				if (settled) {
					throw new DatabaseError('CONFLICT', 'Transaction already settled', {})
				}
				settled = true
				database.exec('COMMIT')
			},
			rollback: async () => {
				if (settled) {
					throw new DatabaseError('CONFLICT', 'Transaction already settled', {})
				}
				settled = true
				database.exec('ROLLBACK')
			},
		}
	}

	/**
	 * Apply a {@link Migration} plan by executing each step's projected DDL
	 * ({@link import('../helpers.js').stepToSQL}) inside one native
	 * `database.transaction` — atomic: a mid-plan failure rolls back every
	 * DDL statement already applied by the plan.
	 *
	 * @remarks
	 * A step referencing a table not in this driver's declared schema (and
	 * that is not itself a `table.add`) throws `DatabaseError` `MIGRATION`
	 * before any DDL for that step runs, propagating out of the native
	 * transaction (which rolls back on a throw).
	 *
	 * @param plan - The migration plan to apply
	 */
	async migrate(plan: Migration): Promise<void> {
		const database = this.#require()
		const schema = new Map(this.#schema)
		database.transaction(() => {
			for (const step of plan.steps) {
				const table = step.operation === 'table.add' ? step.table.name : step.table
				if (step.operation !== 'table.add' && !schema.has(table)) {
					throw new DatabaseError('MIGRATION', `migrate: unknown table '${table}'`, { table })
				}
				for (const sql of stepToSQL(step)) database.exec(sql)
				if (step.operation === 'table.add') {
					schema.set(step.table.name, step.table)
				} else if (step.operation === 'table.remove') {
					schema.delete(step.table)
				} else {
					const existing = schema.get(table)
					if (existing !== undefined) schema.set(table, stepToSchema(existing, step))
				}
			}
		})
		this.#schema = schema
	}

	/**
	 * Read the persisted {@link DriverMeta} from the reserved `_meta` table.
	 *
	 * @returns The last-stamped `DriverMeta`, or `undefined` when never stamped
	 *   (or the stored row is malformed)
	 */
	async meta(): Promise<DriverMeta | undefined> {
		const database = this.#require()
		const row = database
			.prepare('SELECT "version", "schema" FROM ' + quote(META_TABLE) + ' WHERE "id" = 1')
			.get()
		if (row === undefined) return undefined
		const version = row.version
		const text = row.schema
		if (typeof text !== 'string') return undefined
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch {
			return undefined
		}
		if (
			(typeof version !== 'number' && typeof version !== 'bigint') ||
			!Array.isArray(parsed) ||
			!parsed.every(isTableSchema)
		) {
			return undefined
		}
		return { version: Number(version), schema: parsed }
	}

	/**
	 * Persist `meta` verbatim (as JSON) into the reserved `_meta` table's single
	 * row.
	 *
	 * @param meta - The {@link DriverMeta} to persist
	 */
	async stamp(meta: DriverMeta): Promise<void> {
		this.#require()
			.prepare(
				'INSERT OR REPLACE INTO ' +
					quote(META_TABLE) +
					' ("id", "version", "schema") VALUES (1, ?, ?)',
			)
			.run([meta.version, JSON.stringify(meta.schema)])
	}

	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		const database = this.#require()
		// Capture-replay rather than a SQL SAVEPOINT: the core `transaction` calls
		// the rollback thunk only on failure, with no commit-on-success signal — a
		// long-lived SAVEPOINT would leave the connection in an uncommitted
		// transaction (lost on close). Captured rows are already encoded, so they
		// reinsert directly. `tables` omitted captures/restores the whole schema.
		const names = tables ?? [...this.#schema.keys()]
		const captured = new Map<
			string,
			{ readonly names: readonly string[]; readonly rows: readonly SQLiteRow[] }
		>()
		for (const name of names) {
			const schema = this.#schema.get(name)
			if (schema === undefined) continue
			captured.set(name, {
				names: schema.columns.map((column) => column.name),
				rows: database.prepare('SELECT * FROM ' + quote(name)).all(),
			})
		}
		return async () => {
			const current = this.#require()
			current.transaction(() => {
				for (const [name, snapshot] of captured) {
					current.exec('DELETE FROM ' + quote(name))
					const statement = current.prepare(
						'INSERT OR REPLACE INTO ' +
							quote(name) +
							' (' +
							snapshot.names.map(quote).join(', ') +
							') VALUES (' +
							snapshot.names.map(() => '?').join(', ') +
							')',
					)
					for (const row of snapshot.rows) {
						statement.run(snapshot.names.map((column) => row[column]))
					}
				}
			})
		}
	}

	// === Private

	#require(): SQLiteDatabaseInterface {
		if (this.#database === undefined) {
			throw new DatabaseError('CLOSED', `SQLite database '${this.#path}' is not open`, {
				path: this.#path,
			})
		}
		return this.#database
	}

	// Require the database open and resolve a declared table's schema.
	#table(name: string): TableSchema {
		this.#require()
		const schema = this.#schema.get(name)
		if (schema === undefined) {
			throw new DatabaseError('NOT_FOUND', `Table '${name}' is not in the schema`, { table: name })
		}
		return schema
	}

	// Encode a primary key for binding against its column's stored type.
	#key(key: Key, schema: TableSchema): SQLiteValue {
		const primary = schema.columns.find((column) => column.name === schema.primary)
		return encodeValue(key, primary === undefined ? 'text' : primary.type)
	}
}
