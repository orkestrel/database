import type {
	AggregateOperation,
	QueryInput,
	DriverInterface,
	DriverMetadata,
	Key,
	MigrationInput,
	OperationOptions,
	Row,
	TableSchema,
	StorageInterface,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { SQLiteDatabaseInterface, SQLiteValue } from '@orkestrel/sqlite'
import type { SQLiteDriverOptions } from '../types.js'
import {
	applyQuery,
	bindRowKey,
	cloneDriverMetadata,
	cloneMigrationInput,
	computeAggregate,
	checkAbort,
	DatabaseError,
	filterRows,
	equalsValue,
	extractKey,
	isDatabaseError,
	isKey,
	matchesQuery,
	migrateRows,
	normalizeDriverSchema,
	planMigration,
	projectMigrationSchema,
	validatePage,
} from '@src/core'
import { createSQLiteDatabase, isSQLiteError } from '@orkestrel/sqlite'
import {
	compileAggregateSQL,
	compileQuerySQL,
	compileWhereSQL,
	schemaToIndexes,
	schemaToTable,
	stepToSQL,
} from '../compilers.js'
import {
	decodeRow,
	encodeRow,
	encodeValue,
	extractValues,
	deriveSQLiteIndexName,
	matchesAggregateExactly,
	matchesConditionExactly,
	matchesQueryExactly,
	matchesSQLiteAffinity,
	quoteIdentifier,
} from '../helpers.js'
import { METADATA_TABLE } from '../constants.js'
import { DriverIterator } from '../../core/DriverIterator.js'

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
 * reopen-safe), and readies a reserved `_metadata` single-row table `metadata()` /
 * `stamp()` read and write — **a user table named `_metadata` collides with it**;
 * avoid the name. Rows cross the boundary through the codecs in `helpers.ts`
 * (`json` columns store / parse JSON text, a `boolean` stores `1` / `0`), so
 * the typed layer above imposes the exact shape. `write` is an
 * `INSERT OR REPLACE` upsert, while `insert` uses a plain `INSERT` and maps its
 * atomic primary-key constraint failure to `CONFLICT`; every other backend
 * `SQLiteError` is contained by the same `DatabaseError` boundary described
 * below. Querying, ordering, paging, and aggregation is native: `records` /
 * `stream` compile a `QueryInput` to SQL with `compileQuerySQL`, and
 * `aggregate` runs a SQL `COUNT`/`SUM`/`AVG`/`MIN`/`MAX` (via
 * `compileAggregateSQL`) over the same compiled WHERE. `transaction` runs a
 * callback inside native `BEGIN` / `COMMIT` / `ROLLBACK`, passing a scoped
 * storage capability that becomes invalid after settlement. `migrate` runs the
 * plan's projected DDL ({@link import('../compilers.js').stepToSQL}) inside
 * whichever native transaction is active: joined into the active transaction
 * callback when one exists (the core's versioned reconcile path wraps migrate +
 * stamp in one native `BEGIN`, and node:sqlite rejects a nested `BEGIN`), or
 * inside its own `database.transaction` otherwise — a mid-plan failure rolls
 * back atomically either way, an improvement over the non-atomic `MemoryDriver`
 * / `JSONDriver` migrate; a step referencing an undeclared table throws
 * `DatabaseError` `MIGRATION` before any DDL for that step runs. `snapshot` is
 * capture-replay (SELECT the named tables' rows, replay via DELETE + INSERT OR
 * REPLACE inside a native transaction on rollback) rather than a SQL
 * `SAVEPOINT`, since the core `transaction` calls the rollback thunk only on
 * failure with no commit-on-success signal — a long-lived `SAVEPOINT` would
 * leave the connection uncommitted (lost on close). Every backend interaction
 * runs through `#guard`, which maps a thrown backend `SQLiteError` (or any
 * unexpected non-`SQLiteError` throw) to a typed {@link DatabaseError} — never
 * a raw backend error escapes `DriverInterface`: `CONSTRAINT` → `CONFLICT`, the
 * wrapper's own `CLOSED` → `CLOSED`, `BUSY` (a locked database that outlasted
 * the configured `timeout`) → a retryable `DRIVER` (`context.retryable` is
 * `true`), and `UNKNOWN` / any other throw → `DRIVER`. The original error is
 * preserved as `context.cause`. A `DatabaseError` this driver throws directly
 * (`CLOSED` from the `#require` gate, `NOT_FOUND` from `#table`, `MIGRATION`
 * from a migration-plan fault) passes through `#guard` unchanged, never
 * re-wrapped.
 */
export class SQLiteDriver implements DriverInterface {
	readonly #path: string
	readonly #options: SQLiteDriverOptions
	#database: SQLiteDatabaseInterface | undefined
	#schema = new Map<string, TableSchema>()
	#identities = new Map<string, object>()
	#transaction: object | undefined
	#candidateSchema: Map<string, TableSchema> | undefined
	#candidateIdentities: Map<string, object> | undefined

	constructor(options: SQLiteDriverOptions = {}) {
		this.#path = options.path ?? ':memory:'
		this.#options = options
	}

	async open(schema: readonly TableSchema[]): Promise<void> {
		this.#root()
		const owned = normalizeDriverSchema(schema)
		if (owned.some((table) => table.name === METADATA_TABLE)) {
			throw new DatabaseError(
				'VALIDATION',
				`A declared table cannot be named '${METADATA_TABLE}' — it is reserved for driver metadata`,
				{ table: METADATA_TABLE },
			)
		}
		this.#guard(() => {
			const current = this.#database
			const previousIdentities = this.#identities
			this.#database = undefined
			this.#schema = new Map()
			this.#identities = new Map()
			current?.close()
			const database = createSQLiteDatabase({
				path: this.#path,
				...(this.#options.readonly !== undefined ? { readonly: this.#options.readonly } : {}),
				...(this.#options.timeout !== undefined ? { timeout: this.#options.timeout } : {}),
				...(this.#options.references !== undefined
					? { foreignKeys: this.#options.references }
					: {}),
			})
			try {
				database.connect()
				for (const [name, value] of Object.entries(this.#options.pragmas ?? {})) {
					database.pragma(name, value)
				}
				const map = new Map<string, TableSchema>()
				const identities = new Map<string, object>()
				database.transaction(() => {
					this.#ensureMetadataTable(database)
					const stored = this.#readMetadata(database)
					const deployed = normalizeDriverSchema(stored?.schema ?? owned)
					const missing = new Map<string, readonly string[] | undefined>()
					for (const table of deployed) {
						map.set(table.name, table)
						missing.set(table.name, this.#validateTable(database, table))
					}
					if (stored !== undefined) {
						for (const table of stored.schema) {
							if (missing.get(table.name) === undefined) {
								throw new DatabaseError('DRIVER', 'Stored SQLite table is missing', {
									table: table.name,
									aspect: 'missing',
								})
							}
						}
					}
					for (const table of deployed) {
						const absent = missing.get(table.name)
						if (absent === undefined) {
							database.execute(schemaToTable(table))
							for (const sql of schemaToIndexes(table)) database.execute(sql)
						} else {
							for (const [index, group] of table.indexes.entries()) {
								if (absent.includes(deriveSQLiteIndexName(table.name, group))) {
									const sql = schemaToIndexes(table)[index]
									if (sql !== undefined) database.execute(sql)
								}
							}
						}
						identities.set(table.name, previousIdentities.get(table.name) ?? {})
					}
				})
				this.#schema = map
				this.#identities = identities
				this.#database = database
			} catch (error) {
				try {
					database.close()
				} catch {}
				this.#schema = new Map()
				this.#identities = new Map()
				throw error
			}
		})
	}

	async close(): Promise<void> {
		this.#root()
		this.#guard(() => {
			this.#database?.close()
			this.#database = undefined
		})
	}

	async read(table: string, key: Key): Promise<Row | undefined> {
		this.#root()
		return this.#read(table, key)
	}

	async write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		this.#root()
		await this.#write(table, key, row, options)
	}

	async insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		this.#root()
		await this.#insert(table, key, row, options)
	}

	async delete(table: string, key: Key, options?: OperationOptions): Promise<boolean> {
		this.#root()
		return this.#delete(table, key, options)
	}

	async keys(table: string): Promise<readonly Key[]> {
		this.#root()
		return this.#keys(table)
	}

	scan(table: string): AsyncIterable<Row> {
		return new DriverIterator(this.#scan(table)[Symbol.asyncIterator](), () => this.#root())
	}

	async clear(table: string): Promise<void> {
		this.#root()
		await this.#clear(table)
	}

	// A QueryInput whose compiled SQL is PROVABLY identical to the core engine's
	// semantics (see `matchesConditionExactly` / `matchesOrderExactly` /
	// `matchesQueryExactly`) runs the fast native path; otherwise this driver
	// fetches a full scan and refines it through the SAME core engine that
	// answers every query for `MemoryDriver` and `JSONDriver` — exact → native,
	// otherwise → refine, never a silent semantics drift between backends.
	async records(table: string, input: QueryInput): Promise<readonly Row[]> {
		validatePage(input)
		this.#root()
		const schema = this.#table(table)
		if (matchesQueryExactly(input, schema)) {
			return this.#guard(() => {
				const { sql, parameters } = compileQuerySQL(input, schema)
				const rows = this.#require()
					.prepare('SELECT * FROM ' + quoteIdentifier(table) + (sql === '' ? '' : ' ' + sql))
					.all(parameters)
				return rows.map((row) => decodeRow(row, schema))
			})
		}
		const rows: Row[] = []
		for await (const row of this.#scan(table)) rows.push(row)
		return applyQuery(rows, input)
	}

	async aggregate(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		validatePage(input)
		this.#root()
		const schema = this.#table(table)
		const conditions = input.conditions ?? []
		const conditionsExact = conditions.every((condition) =>
			matchesConditionExactly(condition, schema),
		)
		// `count` ignores `column` entirely (COUNT(*) over rows), so only the
		// conditions need to be exact; every other aggregate coerces the column
		// numerically (parseNumber) — only a flat, declared integer/real column
		// is provably exact (a text/json/blob column may hold non-numeric cells
		// the engine skips via parseNumber, which SQL's numeric aggregates do not).
		const columnExact = matchesAggregateExactly(operation, column, schema)
		if (conditionsExact && columnExact) {
			return this.#guard(() => {
				// WHERE-only compile — same rationale as `count`: paging must never
				// apply to the single aggregate row.
				const { sql, parameters } = compileWhereSQL(conditions, schema)
				const value = this.#require()
					.prepare(
						'SELECT ' +
							compileAggregateSQL(operation, column) +
							' AS value FROM ' +
							quoteIdentifier(table) +
							(sql === '' ? '' : ' ' + sql),
					)
					.get(parameters)?.value
				// Over zero matched rows SUM/AVG/MIN/MAX are SQL NULL → undefined (the
				// engine agrees); COUNT(*) is 0. A clean numeric column coerces as the
				// engine does.
				return value === null || value === undefined ? undefined : Number(value)
			})
		}
		const rows: Row[] = []
		for await (const row of this.#scan(table)) rows.push(row)
		return computeAggregate(filterRows(rows, conditions), operation, column)
	}

	// `order` is intentionally IGNORED (per DriverInterface.stream — streaming
	// yields unsorted), so the native gate checks only `conditions`; `offset` /
	// `limit` are always engine-identical under either path.
	stream(table: string, input: QueryInput): AsyncIterable<Row> {
		validatePage(input)
		return new DriverIterator(this.#stream(table, input)[Symbol.asyncIterator](), () =>
			this.#root(),
		)
	}

	/**
	 * Begin a native transaction — real `BEGIN`, `COMMIT`, `ROLLBACK`.
	 *
	 * @remarks
	 * The callback receives a scoped {@link StorageInterface}. Fulfillment
	 * commits and returns its value; rejection rolls back and preserves the
	 * original error. Root operations and nesting conflict while active, and a
	 * captured capability conflicts after settlement.
	 *
	 * @returns The callback's resolved value
	 */
	async transaction<R>(scope: (storage: StorageInterface) => Promise<R>): Promise<R> {
		this.#root()
		const database = this.#require()
		this.#guard(() => database.begin())
		const token = {}
		this.#transaction = token
		this.#candidateSchema = new Map(this.#schema)
		this.#candidateIdentities = new Map(this.#identities)
		try {
			let value: R
			try {
				value = await scope(this.#capability(token))
			} catch (error) {
				this.#guard(() => database.rollback())
				throw error
			}
			try {
				this.#guard(() => database.commit())
			} catch (error) {
				if (database.transacting) this.#guard(() => database.rollback())
				throw error
			}
			const schema = this.#candidateSchema
			const identities = this.#candidateIdentities
			if (schema === undefined || identities === undefined) {
				throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
			}
			this.#schema = schema
			this.#identities = identities
			return value
		} finally {
			if (this.#transaction === token) {
				this.#transaction = undefined
				this.#candidateSchema = undefined
				this.#candidateIdentities = undefined
			}
		}
	}

	/**
	 * Apply a {@link Migration} plan by executing each step's projected DDL
	 * ({@link import('../compilers.js').stepToSQL}).
	 *
	 * @remarks
	 * Atomicity is provided by whichever native transaction is active: when this
	 * driver's own `transaction()` callback is active (the core's versioned
	 * reconcile / migrate path joins migrate + stamp under one native `BEGIN`),
	 * the plan's DDL runs directly inside that enclosing transaction — a mid-plan
	 * failure rejects the callback and the driver rolls it back. node:sqlite (and
	 * SQLite generally) rejects a nested `BEGIN`, so this driver must never open a
	 * second native transaction while one is already open. Otherwise (no
	 * enclosing transaction), `migrate` wraps the plan in its own native
	 * `database.transaction` — atomic on its own: a mid-plan failure rolls
	 * back every DDL statement already applied by the plan. A scoped migration
	 * uses one fixed internal savepoint literal because the published SQLite
	 * wrapper intentionally exposes raw `execute` but no savepoint manager. That
	 * savepoint contains a caught inner migration so the outer callback
	 * transaction remains active and may continue safely. A step referencing a
	 * table not in this driver's declared schema (and that is not itself a
	 * `table.add`) throws `DatabaseError` `MIGRATION` before any DDL for that
	 * step runs.
	 *
	 * @param input - The migration plan and optional metadata stamp to apply atomically
	 */
	async migrate(input: MigrationInput): Promise<void> {
		this.#root()
		const database = this.#require()
		const owned = cloneMigrationInput(input)
		const projected = projectMigrationSchema([...this.#schema.values()], owned.plan.steps)
		const identities = this.#projectIdentities(this.#identities, owned.plan.steps)
		if (
			owned.metadata !== undefined &&
			!equalsValue(normalizeDriverSchema(owned.metadata.schema), projected)
		) {
			throw new DatabaseError('MIGRATION', 'Migration metadata schema does not match the plan', {
				projected,
				metadata: owned.metadata.schema,
			})
		}
		this.#guard(() => {
			database.transaction(() => {
				this.#applyPlan(database, owned)
				if (owned.metadata !== undefined) {
					this.#writeMetadata(database, owned.metadata)
				}
			})
		})
		this.#schema = new Map(projected.map((table) => [table.name, table]))
		this.#identities = identities
	}

	/**
	 * Read the persisted {@link DriverMetadata} from the reserved `_metadata` table.
	 *
	 * @returns The last-stamped `DriverMetadata`, or `undefined` when never stamped
	 *   (or the stored row is malformed)
	 */
	async metadata(): Promise<DriverMetadata | undefined> {
		this.#root()
		return this.#metadata()
	}

	/**
	 * Persist an owned metadata snapshot into the reserved `_metadata` table's
	 * single row.
	 *
	 * @param metadata - The {@link DriverMetadata} to persist
	 */
	async stamp(metadata: DriverMetadata): Promise<void> {
		this.#root()
		await this.#stamp(metadata)
	}

	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		this.#root()
		// Capture-replay rather than a SQL SAVEPOINT: the core `transaction` calls
		// the rollback thunk only on failure, with no commit-on-success signal — a
		// long-lived SAVEPOINT would leave the connection in an uncommitted
		// transaction (lost on close). Captured logical rows are adapted to each
		// surviving same-identity table before replay.
		const captured = this.#guard(() => {
			const database = this.#require()
			const names = tables === undefined ? [...this.#schema.keys()] : [...new Set(tables)]
			const snapshots = new Map<
				string,
				{
					readonly identity: object
					readonly rows: readonly Row[]
					readonly schema: TableSchema
				}
			>()
			for (const name of names) {
				const schema = this.#schema.get(name)
				const identity = this.#identities.get(name)
				if (schema === undefined || identity === undefined) continue
				snapshots.set(name, {
					identity,
					rows: database
						.prepare('SELECT * FROM ' + quoteIdentifier(name))
						.all()
						.map((row) => decodeRow(row, schema)),
					schema,
				})
			}
			return snapshots
		})
		return async () => {
			this.#root()
			const replacements = new Map<
				string,
				{
					readonly names: readonly string[]
					readonly values: ReadonlyArray<readonly SQLiteValue[]>
				}
			>()
			for (const [name, capture] of captured) {
				const schema = this.#schema.get(name)
				if (schema === undefined || this.#identities.get(name) !== capture.identity) continue
				const plan = planMigration([capture.schema], [schema])
				const rows = migrateRows(capture.rows, plan.steps)
				if (rows.length !== capture.rows.length) {
					throw new DatabaseError('MIGRATION', 'Snapshot row count changed during migration', {
						table: name,
					})
				}
				const names = schema.columns.map((column) => column.name)
				const values: Array<readonly SQLiteValue[]> = []
				for (const [index, row] of rows.entries()) {
					const key = extractKey(row, schema.primary)
					if (!isKey(key)) {
						throw new DatabaseError('MIGRATION', 'Snapshot row has no usable primary key', {
							table: name,
							column: schema.primary,
							index,
						})
					}
					const encoded = encodeRow(bindRowKey(row, schema.primary, key), schema)
					values.push(extractValues(encoded, names, name))
				}
				replacements.set(name, { names, values })
			}
			this.#guard(() => {
				const current = this.#require()
				current.transaction(() => {
					for (const [name, replacement] of replacements) {
						current.execute('DELETE FROM ' + quoteIdentifier(name))
						const statement = current.prepare(
							'INSERT OR REPLACE INTO ' +
								quoteIdentifier(name) +
								' (' +
								replacement.names.map(quoteIdentifier).join(', ') +
								') VALUES (' +
								replacement.names.map(() => '?').join(', ') +
								')',
						)
						for (const values of replacement.values) statement.run(values)
					}
				})
			})
		}
	}

	// === Private

	async #read(table: string, key: Key): Promise<Row | undefined> {
		const schema = this.#table(table)
		return this.#guard(() => {
			const row = this.#require()
				.prepare(
					'SELECT * FROM ' +
						quoteIdentifier(table) +
						' WHERE ' +
						quoteIdentifier(schema.primary) +
						' = ?',
				)
				.get([this.#key(key, schema)])
			return row === undefined ? undefined : decodeRow(row, schema)
		})
	}

	async #write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		const schema = this.#table(table)
		this.#guard(() => {
			const encoded = encodeRow(bindRowKey(row, schema.primary, key), schema)
			const names = schema.columns.map((column) => column.name)
			const values = extractValues(encoded, names, table)
			const statement = this.#require().prepare(
				'INSERT OR REPLACE INTO ' +
					quoteIdentifier(table) +
					' (' +
					names.map(quoteIdentifier).join(', ') +
					') VALUES (' +
					names.map(() => '?').join(', ') +
					')',
			)
			checkAbort(options?.signal)
			statement.run(values)
		})
	}

	async #insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		const schema = this.#table(table)
		this.#guard(() => {
			const encoded = encodeRow(bindRowKey(row, schema.primary, key), schema)
			const names = schema.columns.map((column) => column.name)
			const values = extractValues(encoded, names, table)
			const statement = this.#require().prepare(
				'INSERT INTO ' +
					quoteIdentifier(table) +
					' (' +
					names.map(quoteIdentifier).join(', ') +
					') VALUES (' +
					names.map(() => '?').join(', ') +
					')',
			)
			checkAbort(options?.signal)
			statement.run(values)
		})
	}

	async #delete(table: string, key: Key, options?: OperationOptions): Promise<boolean> {
		const schema = this.#table(table)
		return this.#guard(() => {
			const statement = this.#require().prepare(
				'DELETE FROM ' +
					quoteIdentifier(table) +
					' WHERE ' +
					quoteIdentifier(schema.primary) +
					' = ?',
			)
			checkAbort(options?.signal)
			const result = statement.run([this.#key(key, schema)])
			return result.changes > 0
		})
	}

	async #keys(table: string): Promise<readonly Key[]> {
		const schema = this.#table(table)
		return this.#guard(() => {
			const primary = quoteIdentifier(schema.primary)
			const rows = this.#require()
				.prepare('SELECT ' + primary + ' FROM ' + quoteIdentifier(table) + ' ORDER BY ' + primary)
				.all()
			const keys: Key[] = []
			for (const row of rows) {
				const value = row[schema.primary]
				if (typeof value === 'string' || typeof value === 'number') keys.push(value)
			}
			return keys
		})
	}

	async *#scan(table: string): AsyncIterable<Row> {
		const schema = this.#table(table)
		for await (const row of this.#iterate(
			schema,
			'SELECT * FROM ' + quoteIdentifier(table) + ' ORDER BY ' + quoteIdentifier(schema.primary),
		)) {
			yield row
		}
	}

	async *#stream(table: string, input: QueryInput): AsyncIterable<Row> {
		const schema = this.#table(table)
		const conditions = input.conditions ?? []
		if (conditions.every((condition) => matchesConditionExactly(condition, schema))) {
			const compiled = compileQuerySQL(
				{
					conditions,
					...(input.limit !== undefined ? { limit: input.limit } : {}),
					...(input.offset !== undefined ? { offset: input.offset } : {}),
				},
				schema,
			)
			for await (const row of this.#iterate(
				schema,
				'SELECT * FROM ' + quoteIdentifier(table) + (compiled.sql === '' ? '' : ' ' + compiled.sql),
				compiled.parameters,
			)) {
				yield row
			}
			return
		}
		const offset = input.offset ?? 0
		const limit = input.limit
		let skipped = 0
		let yielded = 0
		for await (const row of this.#scan(table)) {
			if (limit !== undefined && yielded >= limit) return
			if (conditions.length > 0 && !matchesQuery(row, conditions)) continue
			if (skipped < offset) {
				skipped += 1
				continue
			}
			yield row
			yielded += 1
		}
	}

	async *#iterate(
		schema: TableSchema,
		sql: string,
		parameters: readonly SQLiteValue[] = [],
	): AsyncIterable<Row> {
		const iterator = this.#guard(() =>
			this.#require().prepare(sql).iterate(parameters)[Symbol.iterator](),
		)
		try {
			while (true) {
				const step = this.#guard(() => iterator.next())
				if (step.done === true) return
				yield this.#guard(() => decodeRow(step.value, schema))
			}
		} finally {
			if (iterator.return !== undefined) {
				this.#guard(() => iterator.return?.())
			}
		}
	}

	async #clear(table: string): Promise<void> {
		this.#table(table)
		this.#guard(() => {
			this.#require()
				.prepare('DELETE FROM ' + quoteIdentifier(table))
				.run()
		})
	}

	async #metadata(): Promise<DriverMetadata | undefined> {
		return this.#guard(() => this.#readMetadata(this.#require()))
	}

	#ensureMetadataTable(database: SQLiteDatabaseInterface): void {
		database.execute(
			'CREATE TABLE IF NOT EXISTS ' +
				quoteIdentifier(METADATA_TABLE) +
				' ("id" INTEGER, "version" INTEGER, "schema" TEXT, PRIMARY KEY ("id"))',
		)
	}

	#validateTable(
		database: SQLiteDatabaseInterface,
		schema: TableSchema,
	): readonly string[] | undefined {
		const object = database
			.prepare('SELECT "type" AS "category" FROM "sqlite_schema" WHERE "name" = ?')
			.get([schema.name])
		if (object === undefined) return undefined
		if (object.category !== 'table') {
			throw new DatabaseError('DRIVER', 'SQLite object is not a table', {
				table: schema.name,
				aspect: 'object',
				actual: object.category,
			})
		}
		const trigger = database
			.prepare('SELECT "name" FROM "sqlite_schema" WHERE "type" = ? AND "tbl_name" = ? LIMIT 1')
			.get(['trigger', schema.name])
		if (trigger !== undefined) {
			throw new DatabaseError('DRIVER', 'SQLite table has an undeclared trigger', {
				table: schema.name,
				aspect: 'trigger',
				actual: trigger.name,
			})
		}

		const columns = database.prepare('SELECT * FROM pragma_table_xinfo(?)').all([schema.name])
		if (columns.length !== schema.columns.length) {
			throw new DatabaseError('DRIVER', 'SQLite table has different columns', {
				table: schema.name,
				aspect: 'columns',
				expected: schema.columns.map((column) => column.name),
				actual: columns.map((column) => column.name),
			})
		}
		for (const declared of schema.columns) {
			const column = columns.find((candidate) => candidate.name === declared.name)
			if (column === undefined) {
				throw new DatabaseError('DRIVER', 'SQLite table is missing a declared column', {
					table: schema.name,
					aspect: 'column',
					column: declared.name,
				})
			}
			const expectedRequired = !declared.optional && !declared.nullable
			const required = column.notnull === 1 || column.notnull === 1n
			const expectedPrimary = declared.name === schema.primary ? 1 : 0
			const primary = column.pk === expectedPrimary || column.pk === BigInt(expectedPrimary)
			const hidden = column.hidden === 0 || column.hidden === 0n
			if (
				!matchesSQLiteAffinity(column.type, declared.storage) ||
				required !== expectedRequired ||
				!primary ||
				!hidden
			) {
				throw new DatabaseError('DRIVER', 'SQLite column does not match its declaration', {
					table: schema.name,
					aspect: 'column',
					column: declared.name,
					expected: declared,
					actual: column,
				})
			}
		}

		const indexes = database.prepare('SELECT * FROM pragma_index_list(?)').all([schema.name])
		for (const index of indexes) {
			const unique = index.unique === 1 || index.unique === 1n
			if (unique && index.origin !== 'pk') {
				throw new DatabaseError('DRIVER', 'SQLite table has an undeclared unique constraint', {
					table: schema.name,
					aspect: 'index',
					actual: index.name,
				})
			}
		}
		const missing: string[] = []
		for (const group of schema.indexes) {
			const name = deriveSQLiteIndexName(schema.name, group)
			const index = indexes.find((candidate) => candidate.name === name)
			if (index === undefined) {
				missing.push(name)
				continue
			}
			const ordinary = index.unique === 0 || index.unique === 0n
			const complete = index.partial === 0 || index.partial === 0n
			if (!ordinary || !complete || index.origin !== 'c') {
				throw new DatabaseError('DRIVER', 'SQLite index does not match its declaration', {
					table: schema.name,
					aspect: 'index',
					index: name,
					actual: index,
				})
			}
			const entries = database
				.prepare('SELECT * FROM pragma_index_xinfo(?)')
				.all([name])
				.filter((entry) => entry.key === 1 || entry.key === 1n)
			if (entries.length !== group.length) {
				throw new DatabaseError('DRIVER', 'SQLite index has different columns', {
					table: schema.name,
					aspect: 'index',
					index: name,
					expected: group,
					actual: entries.map((entry) => entry.name),
				})
			}
			for (const [position, column] of group.entries()) {
				const entry = entries.find(
					(candidate) => candidate.seqno === position || candidate.seqno === BigInt(position),
				)
				const stored =
					entry !== undefined &&
					((typeof entry.cid === 'number' && Number.isInteger(entry.cid) && entry.cid >= 0) ||
						(typeof entry.cid === 'bigint' && entry.cid >= 0n))
				if (
					entry === undefined ||
					entry.name !== column ||
					!stored ||
					(entry.desc !== 0 && entry.desc !== 0n) ||
					entry.coll !== 'BINARY'
				) {
					throw new DatabaseError('DRIVER', 'SQLite index column does not match its declaration', {
						table: schema.name,
						aspect: 'index',
						index: name,
						column,
						actual: entry,
					})
				}
			}
		}
		return missing
	}

	#readMetadata(database: SQLiteDatabaseInterface): DriverMetadata | undefined {
		const row = database
			.prepare(
				'SELECT "version", "schema" FROM ' + quoteIdentifier(METADATA_TABLE) + ' WHERE "id" = 1',
			)
			.get()
		if (row === undefined) return undefined
		const version = row.version
		const text = row.schema
		if (typeof text !== 'string') {
			throw new DatabaseError('DRIVER', 'Stored SQLite metadata schema is invalid', {
				table: METADATA_TABLE,
				aspect: 'metadata',
			})
		}
		if (typeof version !== 'number' && typeof version !== 'bigint') {
			throw new DatabaseError('DRIVER', 'Stored SQLite metadata version is invalid', {
				table: METADATA_TABLE,
				aspect: 'metadata',
			})
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch (error) {
			throw new DatabaseError('DRIVER', 'Stored SQLite metadata JSON is invalid', {
				table: METADATA_TABLE,
				aspect: 'metadata',
				cause: error,
			})
		}
		if (!Array.isArray(parsed)) {
			throw new DatabaseError('DRIVER', 'Stored SQLite metadata schema is invalid', {
				table: METADATA_TABLE,
				aspect: 'metadata',
			})
		}
		const candidate = { version: Number(version), schema: parsed }
		try {
			return cloneDriverMetadata(candidate)
		} catch (error) {
			if (isDatabaseError(error) && error.code === 'VALIDATION') {
				throw new DatabaseError('DRIVER', 'Stored SQLite metadata is invalid', {
					table: METADATA_TABLE,
					aspect: 'metadata',
					cause: error,
				})
			}
			throw error
		}
	}

	async #stamp(metadata: DriverMetadata): Promise<void> {
		const database = this.#require()
		const owned = cloneDriverMetadata(metadata)
		this.#guard(() => this.#writeMetadata(database, owned))
	}

	#writeMetadata(database: SQLiteDatabaseInterface, metadata: DriverMetadata): void {
		database
			.prepare(
				'INSERT OR REPLACE INTO ' +
					quoteIdentifier(METADATA_TABLE) +
					' ("id", "version", "schema") VALUES (1, ?, ?)',
			)
			.run([metadata.version, JSON.stringify(metadata.schema)])
	}

	#capability(token: object): StorageInterface {
		return {
			read: this.#readTransaction.bind(this, token),
			write: this.#writeTransaction.bind(this, token),
			insert: this.#insertTransaction.bind(this, token),
			delete: this.#deleteTransaction.bind(this, token),
			keys: this.#keysTransaction.bind(this, token),
			scan: this.#scanTransaction.bind(this, token),
			clear: this.#clearTransaction.bind(this, token),
			migrate: this.#migrateTransaction.bind(this, token),
			metadata: this.#metadataTransaction.bind(this, token),
			stamp: this.#stampTransaction.bind(this, token),
		}
	}

	async #readTransaction(token: object, table: string, key: Key): Promise<Row | undefined> {
		this.#requireTransaction(token)
		return this.#read(table, key)
	}

	async #writeTransaction(
		token: object,
		table: string,
		key: Key,
		row: Row,
		options?: OperationOptions,
	): Promise<void> {
		this.#requireTransaction(token)
		await this.#write(table, key, row, options)
	}

	async #insertTransaction(
		token: object,
		table: string,
		key: Key,
		row: Row,
		options?: OperationOptions,
	): Promise<void> {
		this.#requireTransaction(token)
		await this.#insert(table, key, row, options)
	}

	async #deleteTransaction(
		token: object,
		table: string,
		key: Key,
		options?: OperationOptions,
	): Promise<boolean> {
		this.#requireTransaction(token)
		return this.#delete(table, key, options)
	}

	async #keysTransaction(token: object, table: string): Promise<readonly Key[]> {
		this.#requireTransaction(token)
		return this.#keys(table)
	}

	#scanTransaction(token: object, table: string): AsyncIterable<Row> {
		return new DriverIterator(this.#scan(table)[Symbol.asyncIterator](), () => {
			this.#requireTransaction(token)
		})
	}

	async #clearTransaction(token: object, table: string): Promise<void> {
		this.#requireTransaction(token)
		await this.#clear(table)
	}

	async #migrateTransaction(token: object, input: MigrationInput): Promise<void> {
		this.#requireTransaction(token)
		const database = this.#require()
		const owned = cloneMigrationInput(input)
		const candidate = this.#candidateSchema
		const identities = this.#candidateIdentities
		if (candidate === undefined || identities === undefined) {
			throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		}
		const projected = projectMigrationSchema([...candidate.values()], owned.plan.steps)
		const projectedIdentities = this.#projectIdentities(identities, owned.plan.steps)
		if (
			owned.metadata !== undefined &&
			!equalsValue(normalizeDriverSchema(owned.metadata.schema), projected)
		) {
			throw new DatabaseError('MIGRATION', 'Migration metadata schema does not match the plan', {
				projected,
				metadata: owned.metadata.schema,
			})
		}
		this.#guard(() => {
			database.execute('SAVEPOINT "_orkestrel_migration"')
			try {
				this.#applyPlan(database, owned)
				if (owned.metadata !== undefined) {
					this.#writeMetadata(database, owned.metadata)
				}
				database.execute('RELEASE SAVEPOINT "_orkestrel_migration"')
			} catch (error) {
				try {
					database.execute('ROLLBACK TO SAVEPOINT "_orkestrel_migration"')
				} finally {
					database.execute('RELEASE SAVEPOINT "_orkestrel_migration"')
				}
				throw error
			}
		})
		this.#candidateSchema = new Map(projected.map((table) => [table.name, table]))
		this.#candidateIdentities = projectedIdentities
	}

	async #metadataTransaction(token: object): Promise<DriverMetadata | undefined> {
		this.#requireTransaction(token)
		return this.#metadata()
	}

	async #stampTransaction(token: object, metadata: DriverMetadata): Promise<void> {
		this.#requireTransaction(token)
		await this.#stamp(metadata)
	}

	#requireTransaction(token: object): void {
		if (this.#transaction !== token) {
			throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		}
	}

	#root(): void {
		if (this.#transaction !== undefined) {
			throw new DatabaseError('CONFLICT', 'A transaction is active on this driver')
		}
	}

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
	#guard<T>(operation: () => T): T {
		try {
			return operation()
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

	#projectIdentities(
		identities: ReadonlyMap<string, object>,
		steps: MigrationInput['plan']['steps'],
	): Map<string, object> {
		const projected = new Map(identities)
		for (const step of steps) {
			if (step.operation === 'table.add') projected.set(step.table.name, {})
			if (step.operation === 'table.remove') projected.delete(step.table)
		}
		return projected
	}

	// Require the database open and resolve a declared table's schema.
	#table(name: string): TableSchema {
		this.#require()
		const schema = (this.#candidateSchema ?? this.#schema).get(name)
		if (schema === undefined) {
			throw new DatabaseError('NOT_FOUND', `Table '${name}' is not in the schema`, { table: name })
		}
		return schema
	}

	// Encode a primary key for binding against its column's stored type.
	#key(key: Key, schema: TableSchema): SQLiteValue {
		const primary = schema.columns.find((column) => column.name === schema.primary)
		return encodeValue(
			key,
			primary ?? {
				name: schema.primary,
				storage: 'text',
				optional: false,
				nullable: false,
			},
		)
	}

	// Walk a migration plan's steps, executing each one's projected DDL and updating
	// the working `schema` copy in place — shared by both `migrate`'s joined-transaction
	// (native callback active) and self-wrapped (own `database.transaction`) paths.
	#applyPlan(database: SQLiteDatabaseInterface, input: MigrationInput): void {
		for (const step of input.plan.steps) {
			for (const sql of stepToSQL(step)) database.execute(sql)
		}
	}
}
