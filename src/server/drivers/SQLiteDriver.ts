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
import type { SQLiteDriverOptions } from '../types.js'
import {
	applyCriteria,
	computeAggregate,
	DatabaseError,
	filterRows,
	isDriverMeta,
	matchesCriteria,
} from '@src/core'
import { isString } from '@orkestrel/contract'
import { createSQLiteDatabase, isSQLiteError } from '@orkestrel/sqlite'
import { compileCriteria, compileWhere } from '../compilers.js'
import {
	aggregateSQL,
	decodeRow,
	encodeRow,
	encodeValue,
	isExactCondition,
	isExactCriteria,
	quote,
	schemaToIndexes,
	schemaToTable,
	stepToSchema,
	stepToSQL,
} from '../helpers.js'
import { META_TABLE } from '../constants.js'

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
 * ({@link import('../helpers.js').stepToSQL}) inside whichever native
 * transaction is active: joined into an already-open `transaction()` handle
 * when one exists (the core's versioned reconcile path wraps migrate + stamp
 * in one native `BEGIN`, and node:sqlite rejects a nested `BEGIN`), or inside
 * its own `database.transaction` otherwise — a mid-plan failure rolls back
 * atomically either way, an improvement over the non-atomic `MemoryDriver` /
 * `JSONDriver` migrate; a step referencing an undeclared table throws
 * `DatabaseError` `MIGRATION` before any DDL for that step runs. `snapshot` is
 * capture-replay (SELECT the
 * named tables' rows, replay via DELETE + INSERT OR REPLACE inside a native
 * transaction on rollback) rather than a SQL `SAVEPOINT`, since the core
 * `transaction` calls the rollback thunk only on failure with no commit-on-
 * success signal — a long-lived `SAVEPOINT` would leave the connection
 * uncommitted (lost on close). Every backend interaction runs through `#guard`,
 * which maps a thrown backend `SQLiteError` (or any unexpected non-`SQLiteError`
 * throw) to a typed {@link DatabaseError} — never a raw backend error escapes
 * `DriverInterface`: `CONSTRAINT` → `CONFLICT`, the wrapper's own `CLOSED` →
 * `CLOSED`, `BUSY` (a locked database that outlasted the configured `timeout`)
 * → a retryable `DRIVER` (`context.retryable` is `true`), and `UNKNOWN` / any
 * other throw → `DRIVER`. The original error is preserved as `context.cause`.
 * A `DatabaseError` this driver throws directly (`CLOSED` from the `#require`
 * gate, `NOT_FOUND` from `#table`, `MIGRATION` from a migration-plan fault)
 * passes through `#guard` unchanged, never re-wrapped.
 */
export class SQLiteDriver implements DriverInterface {
	readonly #path: string
	readonly #options: SQLiteDriverOptions
	#database: SQLiteDatabaseInterface | undefined
	#schema = new Map<string, TableSchema>()
	#transacting = false

	constructor(path: string, options?: SQLiteDriverOptions) {
		this.#path = path
		this.#options = options ?? {}
	}

	async open(schema: readonly TableSchema[]): Promise<void> {
		if (schema.some((table) => table.name === META_TABLE)) {
			throw new DatabaseError(
				'VALIDATION',
				`A declared table cannot be named '${META_TABLE}' — it is reserved for driver metadata`,
				{ table: META_TABLE },
			)
		}
		this.#guard(() => {
			this.#database?.close()
			const database = createSQLiteDatabase({
				path: this.#path,
				readonly: this.#options.readonly,
				timeout: this.#options.timeout,
				foreignKeys: this.#options.foreignKeys,
			})
			database.connect()
			for (const [name, value] of Object.entries(this.#options.pragmas ?? {})) {
				database.pragma(name, value)
			}
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
		})
	}

	async close(): Promise<void> {
		this.#database?.close()
		this.#database = undefined
	}

	async read(table: string, key: Key): Promise<Row | undefined> {
		const schema = this.#table(table)
		return this.#guard(() => {
			const row = this.#require()
				.prepare('SELECT * FROM ' + quote(table) + ' WHERE ' + quote(schema.primary) + ' = ?')
				.get([this.#key(key, schema)])
			return row === undefined ? undefined : decodeRow(row, schema)
		})
	}

	async write(table: string, key: Key, row: Row): Promise<void> {
		const schema = this.#table(table)
		this.#guard(() => {
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
		})
	}

	async delete(table: string, key: Key): Promise<boolean> {
		const schema = this.#table(table)
		return this.#guard(() => {
			const result = this.#require()
				.prepare('DELETE FROM ' + quote(table) + ' WHERE ' + quote(schema.primary) + ' = ?')
				.run([this.#key(key, schema)])
			return result.changes > 0
		})
	}

	async keys(table: string): Promise<readonly Key[]> {
		const schema = this.#table(table)
		return this.#guard(() => {
			const primary = quote(schema.primary)
			// ORDER BY the primary key: the contract lists keys in key order, and
			// SQLite returns rows in rowid (insertion) order without it.
			const rows = this.#require()
				.prepare('SELECT ' + primary + ' FROM ' + quote(table) + ' ORDER BY ' + primary)
				.all()
			const keys: Key[] = []
			for (const row of rows) {
				const value = row[schema.primary]
				if (typeof value === 'string' || typeof value === 'number') keys.push(value)
			}
			return keys
		})
	}

	async *scan(table: string): AsyncIterable<Row> {
		const schema = this.#table(table)
		// ORDER BY the primary key so the scan yields rows in key order (the engine
		// and cursors depend on it), not SQLite's default rowid order. Every step —
		// the iterator setup, each `next()` pull, and each row's decode — runs
		// through #guard, so a mid-iteration backend fault (not just the initial
		// call) surfaces as a mapped DatabaseError rather than leaking raw.
		const iterator = this.#guard(() =>
			this.#require()
				.prepare('SELECT * FROM ' + quote(table) + ' ORDER BY ' + quote(schema.primary))
				.iterate(),
		)[Symbol.iterator]()
		while (true) {
			const step = this.#guard(() => iterator.next())
			if (step.done === true) return
			yield this.#guard(() => decodeRow(step.value, schema))
		}
	}

	async clear(table: string): Promise<void> {
		this.#table(table)
		this.#guard(() => {
			this.#require()
				.prepare('DELETE FROM ' + quote(table))
				.run()
		})
	}

	// Doctrine (AGENTS §5, the audit's keystone fix): a Criteria whose compiled
	// SQL is PROVABLY identical to the core engine's semantics (see
	// `isExactCondition` / `isExactOrder` / `isExactCriteria`) runs the fast
	// native path; otherwise this driver fetches a full scan and refines it
	// through the SAME core engine every scan-only driver (`MemoryDriver`,
	// `JSONDriver`) already uses — exact → native, otherwise → refine, never a
	// silent semantics drift between backends. A native `WHERE` that is a
	// PROVABLE SUPERSET of the engine's match set (compile natively, then
	// engine-refine only the returned rows) is a possible future optimization,
	// not implemented here.
	async records(table: string, criteria: Criteria): Promise<readonly Row[]> {
		const schema = this.#table(table)
		if (isExactCriteria(criteria, schema)) {
			return this.#guard(() => {
				const { sql, params } = compileCriteria(criteria, schema)
				const rows = this.#require()
					.prepare('SELECT * FROM ' + quote(table) + (sql === '' ? '' : ' ' + sql))
					.all(params)
				return rows.map((row) => decodeRow(row, schema))
			})
		}
		const rows: Row[] = []
		for await (const row of this.scan(table)) rows.push(row)
		return applyCriteria(rows, criteria)
	}

	async count(table: string, criteria: Criteria): Promise<number> {
		const schema = this.#table(table)
		const conditions = criteria.conditions ?? []
		if (conditions.every((condition) => isExactCondition(condition, schema))) {
			return this.#guard(() => {
				// Compile only the WHERE clause — no ORDER BY, no LIMIT/OFFSET — so a
				// direct call with `criteria.offset` set never skips the single
				// aggregate row (`compileCriteria`'s paging would otherwise apply
				// OFFSET/LIMIT to the one-row COUNT result).
				const { sql, params } = compileWhere(conditions, schema)
				const row = this.#require()
					.prepare('SELECT COUNT(*) AS count FROM ' + quote(table) + (sql === '' ? '' : ' ' + sql))
					.get(params)
				const value = row?.count
				return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : 0
			})
		}
		const rows: Row[] = []
		for await (const row of this.scan(table)) rows.push(row)
		return filterRows(rows, conditions).length
	}

	async aggregate(
		table: string,
		operation: AggregateFunction,
		column: FieldPath,
		criteria: Criteria,
	): Promise<number | undefined> {
		const schema = this.#table(table)
		const conditions = criteria.conditions ?? []
		const conditionsExact = conditions.every((condition) => isExactCondition(condition, schema))
		// `count` ignores `column` entirely (COUNT(*) over rows), so only the
		// conditions need to be exact; every other aggregate coerces the column
		// numerically (parseNumber) — only a flat, declared integer/real column
		// is provably exact (a text/json/blob column may hold non-numeric cells
		// the engine skips via parseNumber, which SQL's numeric aggregates do not).
		const columnExact =
			operation === 'count' ||
			(isString(column) &&
				schema.columns.some(
					(candidate) =>
						candidate.name === column &&
						(candidate.type === 'integer' || candidate.type === 'real'),
				))
		if (conditionsExact && columnExact) {
			return this.#guard(() => {
				// WHERE-only compile — same rationale as `count`: paging must never
				// apply to the single aggregate row.
				const { sql, params } = compileWhere(conditions, schema)
				const value = this.#require()
					.prepare(
						'SELECT ' +
							aggregateSQL(operation, column) +
							' AS value FROM ' +
							quote(table) +
							(sql === '' ? '' : ' ' + sql),
					)
					.get(params)?.value
				// Over zero matched rows SUM/AVG/MIN/MAX are SQL NULL → undefined (the
				// engine agrees); COUNT(*) is 0. A clean numeric column coerces as the
				// engine does.
				return value === null || value === undefined ? undefined : Number(value)
			})
		}
		const rows: Row[] = []
		for await (const row of this.scan(table)) rows.push(row)
		return computeAggregate(filterRows(rows, conditions), operation, column)
	}

	// `order` is intentionally IGNORED (per DriverInterface.stream — streaming
	// yields unsorted), so the native gate checks only `conditions`; `offset` /
	// `limit` are always engine-identical under either path.
	async *stream(table: string, criteria: Criteria): AsyncIterable<Row> {
		const schema = this.#table(table)
		const conditions = criteria.conditions ?? []
		if (conditions.every((condition) => isExactCondition(condition, schema))) {
			const compiled = compileCriteria(
				{ conditions, limit: criteria.limit, offset: criteria.offset },
				schema,
			)
			for (const row of this.#require()
				.prepare('SELECT * FROM ' + quote(table) + (compiled.sql === '' ? '' : ' ' + compiled.sql))
				.iterate(compiled.params)) {
				yield decodeRow(row, schema)
			}
			return
		}
		const offset = criteria.offset ?? 0
		const limit = criteria.limit
		let skipped = 0
		let yielded = 0
		for await (const row of this.scan(table)) {
			if (limit !== undefined && yielded >= limit) return
			if (conditions.length > 0 && !matchesCriteria(row, conditions)) continue
			if (skipped < offset) {
				skipped += 1
				continue
			}
			yield row
			yielded += 1
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
		this.#guard(() => database.exec('BEGIN'))
		let settled = false
		this.#transacting = true
		return {
			commit: async () => {
				if (settled) {
					throw new DatabaseError('CONFLICT', 'Transaction already settled', {})
				}
				settled = true
				this.#transacting = false
				this.#guard(() => database.exec('COMMIT'))
			},
			rollback: async () => {
				if (settled) {
					throw new DatabaseError('CONFLICT', 'Transaction already settled', {})
				}
				settled = true
				this.#transacting = false
				this.#guard(() => database.exec('ROLLBACK'))
			},
		}
	}

	/**
	 * Apply a {@link Migration} plan by executing each step's projected DDL
	 * ({@link import('../helpers.js').stepToSQL}).
	 *
	 * @remarks
	 * Atomicity is provided by whichever native transaction is active: when
	 * this driver's own `transaction()` hook already has a handle open (the
	 * core's versioned reconcile / migrate path joins migrate + stamp under
	 * one native `BEGIN`), the plan's DDL runs directly inside that enclosing
	 * transaction — a mid-plan failure propagates out and the CALLER's
	 * `commit`/`rollback` provides atomicity. node:sqlite (and SQLite
	 * generally) rejects a nested `BEGIN`, so this driver must never open a
	 * second native transaction while one is already open. Otherwise (no
	 * enclosing transaction), `migrate` wraps the plan in its own native
	 * `database.transaction` — atomic on its own: a mid-plan failure rolls
	 * back every DDL statement already applied by the plan. A step
	 * referencing a table not in this driver's declared schema (and that is
	 * not itself a `table.add`) throws `DatabaseError` `MIGRATION` before any
	 * DDL for that step runs, propagating out of whichever transaction is
	 * active (which rolls back on a throw).
	 *
	 * @param plan - The migration plan to apply
	 */
	async migrate(plan: Migration): Promise<void> {
		const database = this.#require()
		const schema = new Map(this.#schema)
		this.#guard(() => {
			if (this.#transacting) {
				this.#applyPlan(database, plan, schema)
			} else {
				database.transaction(() => this.#applyPlan(database, plan, schema))
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
		const row = this.#guard(() =>
			this.#require()
				.prepare('SELECT "version", "schema" FROM ' + quote(META_TABLE) + ' WHERE "id" = 1')
				.get(),
		)
		if (row === undefined) return undefined
		const version = row.version
		const text = row.schema
		if (typeof text !== 'string') return undefined
		if (typeof version !== 'number' && typeof version !== 'bigint') return undefined
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch {
			return undefined
		}
		const candidate = { version: Number(version), schema: parsed }
		if (!isDriverMeta(candidate)) return undefined
		return candidate
	}

	/**
	 * Persist `meta` verbatim (as JSON) into the reserved `_meta` table's single
	 * row.
	 *
	 * @param meta - The {@link DriverMeta} to persist
	 */
	async stamp(meta: DriverMeta): Promise<void> {
		this.#guard(() => {
			this.#require()
				.prepare(
					'INSERT OR REPLACE INTO ' +
						quote(META_TABLE) +
						' ("id", "version", "schema") VALUES (1, ?, ?)',
				)
				.run([meta.version, JSON.stringify(meta.schema)])
		})
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

	// Run a synchronous backend interaction, mapping any `SQLiteError` (or
	// unexpected non-`SQLiteError` throw) to a typed `DatabaseError` so a
	// backend fault never leaks through `DriverInterface` unwrapped: a
	// `CONSTRAINT` violation becomes `CONFLICT`; the wrapper's own `CLOSED`
	// passes through as `CLOSED`; a `BUSY` (a locked database that outlasted
	// the configured `timeout`) becomes a `DRIVER` error whose context marks it
	// `retryable`; `UNKNOWN` and any non-`SQLiteError` throw become `DRIVER`.
	// A `DatabaseError` already thrown by this driver itself (the `#require`
	// `CLOSED` gate, `#table`'s `NOT_FOUND`, a `MIGRATION` step fault) passes
	// through unchanged — it is never re-wrapped. The original error is kept
	// as `context.cause` for diagnostics.
	#guard<T>(run: () => T): T {
		try {
			return run()
		} catch (error) {
			if (error instanceof DatabaseError) throw error
			if (isSQLiteError(error)) {
				if (error.code === 'CONSTRAINT') {
					throw new DatabaseError('CONFLICT', error.message, { cause: error, code: error.code })
				}
				if (error.code === 'CLOSED') {
					throw new DatabaseError('CLOSED', error.message, { cause: error, code: error.code })
				}
				if (error.code === 'BUSY') {
					throw new DatabaseError('DRIVER', error.message, {
						cause: error,
						code: error.code,
						retryable: true,
					})
				}
				throw new DatabaseError('DRIVER', error.message, { cause: error, code: error.code })
			}
			throw new DatabaseError('DRIVER', error instanceof Error ? error.message : String(error), {
				cause: error,
			})
		}
	}

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

	// Walk a migration plan's steps, executing each one's projected DDL and updating
	// the working `schema` copy in place — shared by both `migrate`'s joined-transaction
	// (native handle already open) and self-wrapped (own `database.transaction`) paths.
	#applyPlan(
		database: SQLiteDatabaseInterface,
		plan: Migration,
		schema: Map<string, TableSchema>,
	): void {
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
	}
}
