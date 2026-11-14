import type {
	AggregateOperation,
	ColumnSchema,
	QueryInput,
	DriverInterface,
	DriverMetadata,
	Key,
	MigrationInput,
	OperationOptions,
	ReadInput,
	ReadPlan,
	Row,
	TableSchema,
	StorageInterface,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import {
	attempt,
	isArray,
	isBigInt,
	isError,
	isInteger,
	isNumber,
	isString,
} from '@orkestrel/contract'
import type { SQLiteDatabaseInterface, SQLiteValue } from '@orkestrel/sqlite'
import type { SQLiteDriverOptions } from '../types.js'
import {
	applyKeys,
	bindRowKey,
	cloneDriverMetadata,
	cloneMigrationInput,
	checkAbort,
	computeRemoved,
	DatabaseError,
	DriverIterator,
	equalsValue,
	buildBatch,
	findColumn,
	isDatabaseError,
	normalizeDriverSchema,
	projectMigrationSchema,
	ScopedStorage,
	validatePage,
} from '@src/core'
import { createSQLiteDatabase, isSQLiteError } from '@orkestrel/sqlite'
import {
	compileAggregateSQL,
	compileInsertSQL,
	compileListSQL,
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
	matchesSQLiteAffinity,
	planSQLiteQuery,
	quoteIdentifier,
	validatePragmas,
} from '../helpers.js'
import { SQLiteTransaction } from '../SQLiteTransaction.js'
import { METADATA_TABLE } from '../constants.js'

/**
 * Implements the {@link DriverInterface} over SQLite — the server-native, trusted-mode
 * backend built on the published `@orkestrel/sqlite` synchronous wrapper.
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
 * below. Reads follow the native-first rule {@link DriverInterface} states: `plan` splits
 * each read through {@link planSQLiteQuery}, `records` / `stream` compile the native side
 * to SQL with `compileQuerySQL`, and `aggregate` runs a SQL
 * `COUNT`/`SUM`/`AVG`/`MIN`/`MAX` (through `compileAggregateSQL`) over the same
 * compiled WHERE. A stored value that does not match its declaration raises `DRIVER`.
 * `transaction` runs a callback inside native `BEGIN` / `COMMIT` / `ROLLBACK`, passing a
 * scoped storage capability that declares the same native members and becomes invalid
 * after settlement. `migrate` runs the
 * plan's projected DDL ({@link import('../compilers.js').stepToSQL}) inside
 * whichever native transaction is active: joined into the active transaction
 * callback when one exists (the core's versioned reconcile path wraps migrate +
 * stamp in one native `BEGIN`, and node:sqlite rejects a nested `BEGIN`), or
 * inside its own `database.transact` otherwise — a mid-plan failure rolls
 * back atomically either way, an improvement over the non-atomic `MemoryDriver`
 * / `JSONDriver` migrate; a step referencing an undeclared table throws
 * `DatabaseError` `MIGRATION` before any DDL for that step runs. A list write or insert runs
 * one prepared statement per row as one commit: one transaction outside a scope, one savepoint
 * inside one, so a conflicting row applies none of the batch. A list read and a list delete
 * are each one statement, the keys bound as one JSON parameter. Every backend interaction
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
	readonly #transactions = new Set<SQLiteTransaction>()

	constructor(options: SQLiteDriverOptions) {
		if (!isString(options?.path) || options.path === '') {
			throw new DatabaseError(
				'VALIDATION',
				"SQLite path is required; pass a file path or ':memory:'",
			)
		}
		validatePragmas(options.pragmas)
		this.#path = options.path
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
				database.transact(() => {
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

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		this.#root()
		// The ternary only selects the overload; both arms make the same call.
		return isArray(keys) ? this.#read(table, keys) : this.#read(table, keys)
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
		this.#root()
		this.#put(table, buildBatch(keys, rows), true, options)
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
		this.#root()
		this.#put(table, buildBatch(keys, rows), false, options)
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
		this.#root()
		// The ternary only selects the overload; both arms make the same call.
		return isArray(keys) ? this.#delete(table, keys, options) : this.#delete(table, keys, options)
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

	/**
	 * Splits a read into the part SQLite answers natively and the residual the core runs.
	 *
	 * @param table - The declared table to read
	 * @param input - The read to split
	 * @returns The plan {@link planSQLiteQuery} returns for the table's schema
	 */
	plan(table: string, input: ReadInput): ReadPlan {
		this.#root()
		return this.#plan(table, input)
	}

	async records(table: string, input: QueryInput): Promise<readonly Row[]> {
		validatePage(input)
		this.#root()
		return this.#records(table, input)
	}

	async aggregate(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		validatePage(input)
		this.#root()
		return this.#aggregate(table, operation, column, input)
	}

	stream(table: string, input: QueryInput): AsyncIterable<Row> {
		validatePage(input)
		return new DriverIterator(this.#stream(table, input)[Symbol.asyncIterator](), () =>
			this.#root(),
		)
	}

	/**
	 * Begins a native transaction — real `BEGIN`, `COMMIT`, `ROLLBACK`.
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
		const token = new SQLiteTransaction(this.#schema, this.#identities)
		this.#transactions.add(token)
		try {
			const value = await this.#invokeTransaction(scope, token, database)
			try {
				this.#guard(() => database.commit())
			} catch (error) {
				if (database.transacting) this.#guard(() => database.rollback())
				throw error
			}
			this.#requireTransaction(token)
			this.#schema = new Map(token.schema)
			this.#identities = new Map(token.identities)
			return value
		} finally {
			this.#transactions.delete(token)
		}
	}

	/**
	 * Applies a {@link Migration} plan by executing each step's projected DDL
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
			database.transact(() => {
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
	 * Reads the persisted {@link DriverMetadata} from the reserved `_metadata` table.
	 *
	 * @returns The last-stamped `DriverMetadata`, or `undefined` when never stamped
	 *   (or the stored row is malformed)
	 */
	async metadata(): Promise<DriverMetadata | undefined> {
		this.#root()
		return this.#metadata()
	}

	/**
	 * Persists an owned metadata snapshot into the reserved `_metadata` table's
	 * single row.
	 *
	 * @param metadata - The {@link DriverMetadata} to persist
	 */
	async stamp(metadata: DriverMetadata): Promise<void> {
		this.#root()
		await this.#stamp(metadata)
	}

	// === Private

	#read(table: string, key: Key): Promise<Row | undefined>
	#read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async #read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		const schema = this.#table(table)
		return this.#guard(() => {
			const database = this.#require()
			if (!isArray(keys)) {
				const row = database
					.prepare(
						'SELECT * FROM ' +
							quoteIdentifier(table) +
							' WHERE ' +
							quoteIdentifier(schema.primary) +
							' = ?',
					)
					.get([this.#key(keys, schema)])
				return row === undefined ? undefined : decodeRow(row, schema)
			}
			if (keys.length === 0) return []
			// One statement for the whole list, its keys bound as one JSON parameter.
			const { sql, parameters } = compileListSQL(
				'SELECT * FROM ' +
					quoteIdentifier(table) +
					' WHERE ' +
					quoteIdentifier(schema.primary) +
					' IN ',
				'',
				keys,
				false,
				this.#primary(schema),
			)
			const found = new Map(
				database
					.prepare(sql)
					.all(parameters)
					.map((row) => [row[schema.primary], decodeRow(row, schema)] as const),
			)
			return keys.map((key) => found.get(this.#key(key, schema)))
		})
	}

	#write(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	#write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async #write(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		this.#put(table, buildBatch(keys, rows), true, options)
	}

	#insert(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	#insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async #insert(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		this.#put(table, buildBatch(keys, rows), false, options)
	}

	// Write every entry through one prepared statement, as one commit: a lone statement commits
	// itself, a list runs in one transaction outside a scope and in one savepoint inside one.
	#put(
		table: string,
		entries: ReadonlyArray<readonly [Key, Row]>,
		replace: boolean,
		options: OperationOptions | undefined,
	): void {
		const schema = this.#table(table)
		this.#guard(() => {
			const names = schema.columns.map((column) => column.name)
			const values = entries.map(([key, row]) =>
				extractValues(encodeRow(bindRowKey(row, schema.primary, key), schema), names, table),
			)
			const database = this.#require()
			const statement = database.prepare(compileInsertSQL(schema, replace))
			checkAbort(options?.signal)
			const [single] = values
			if (values.length === 1 && single !== undefined) {
				statement.execute(single)
				return
			}
			if (values.length === 0) return
			if (database.transacting) {
				this.#contain(database, () => {
					for (const value of values) statement.execute(value)
				})
				return
			}
			database.transact(() => {
				for (const value of values) statement.execute(value)
			})
		})
	}

	#delete(table: string, key: Key, options?: OperationOptions): Promise<boolean>
	#delete(
		table: string,
		keys: readonly Key[],
		options?: OperationOptions,
	): Promise<readonly boolean[]>
	async #delete(
		table: string,
		keys: Key | readonly Key[],
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		const schema = this.#table(table)
		return applyKeys(keys, async (listed) =>
			this.#guard(() => {
				// One statement for the whole list; RETURNING names each key it removed.
				const { sql, parameters } = compileListSQL(
					'DELETE FROM ' +
						quoteIdentifier(table) +
						' WHERE ' +
						quoteIdentifier(schema.primary) +
						' IN ',
					' RETURNING ' + quoteIdentifier(schema.primary),
					listed,
					false,
					this.#primary(schema),
				)
				const statement = this.#require().prepare(sql)
				checkAbort(options?.signal)
				const deleted = new Set(statement.all(parameters).map((row) => row[schema.primary]))
				const encoded = listed.map((key) => this.#key(key, schema))
				return computeRemoved(
					encoded,
					encoded.map((key) => deleted.has(key)),
				)
			}),
		)
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
				if (isString(value) || isNumber(value)) keys.push(value)
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

	#plan(table: string, input: ReadInput): ReadPlan {
		return planSQLiteQuery(input, this.#table(table))
	}

	async #records(table: string, input: QueryInput): Promise<readonly Row[]> {
		validatePage(input)
		const schema = this.#table(table)
		return this.#guard(() => {
			const { sql, parameters } = compileQuerySQL(input, schema)
			return this.#require()
				.prepare('SELECT * FROM ' + quoteIdentifier(table) + ' ' + sql)
				.all(parameters)
				.map((row) => decodeRow(row, schema))
		})
	}

	async #aggregate(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		validatePage(input)
		const schema = this.#table(table)
		return this.#guard(() => {
			// The WHERE clause alone: paging never applies to the one aggregate row.
			const { sql, parameters } = compileWhereSQL(input.conditions ?? [], schema)
			const value = this.#require()
				.prepare(
					'SELECT ' +
						compileAggregateSQL(operation, column) +
						' AS value FROM ' +
						quoteIdentifier(table) +
						(sql === '' ? '' : ' ' + sql),
				)
				.get(parameters)?.value
			// Over zero matched rows SUM / AVG / MIN / MAX are SQL NULL, the core's undefined.
			return value === null || value === undefined ? undefined : Number(value)
		})
	}

	// Validate the page ahead of the lazy stream, so a bad page refuses at the call.
	#streamRows(table: string, input: QueryInput): AsyncIterable<Row> {
		validatePage(input)
		return this.#stream(table, input)
	}

	async *#stream(table: string, input: QueryInput): AsyncIterable<Row> {
		const schema = this.#table(table)
		const compiled = compileQuerySQL(input, schema)
		for await (const row of this.#iterate(
			schema,
			'SELECT * FROM ' + quoteIdentifier(table) + ' ' + compiled.sql,
			compiled.parameters,
		)) {
			yield row
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
				.execute()
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
					((isInteger(entry.cid) && entry.cid >= 0) || (isBigInt(entry.cid) && entry.cid >= 0n))
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
		if (!isString(text)) {
			throw new DatabaseError('DRIVER', 'Stored SQLite metadata schema is invalid', {
				table: METADATA_TABLE,
				aspect: 'metadata',
			})
		}
		if (!isNumber(version) && !isBigInt(version)) {
			throw new DatabaseError('DRIVER', 'Stored SQLite metadata version is invalid', {
				table: METADATA_TABLE,
				aspect: 'metadata',
			})
		}
		const decoded = attempt<unknown>(() => JSON.parse(text))
		if (!decoded.success) {
			throw new DatabaseError('DRIVER', 'Stored SQLite metadata JSON is invalid', {
				table: METADATA_TABLE,
				aspect: 'metadata',
				cause: decoded.error,
			})
		}
		const parsed = decoded.value
		if (!isArray(parsed)) {
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
			.execute([metadata.version, JSON.stringify(metadata.schema)])
	}

	async #invokeTransaction<R>(
		scope: (storage: StorageInterface) => Promise<R>,
		token: SQLiteTransaction,
		database: SQLiteDatabaseInterface,
	): Promise<R> {
		try {
			return await scope(this.#capability(token))
		} catch (error) {
			this.#guard(() => database.rollback())
			throw error
		}
	}

	// The driver's unchecked storage, wrapped once in the scope's lifetime boundary.
	#capability(token: SQLiteTransaction): StorageInterface {
		return new ScopedStorage(
			{
				read: this.#read.bind(this),
				write: this.#write.bind(this),
				insert: this.#insert.bind(this),
				delete: this.#delete.bind(this),
				keys: this.#keys.bind(this),
				scan: this.#scan.bind(this),
				clear: this.#clear.bind(this),
				plan: this.#plan.bind(this),
				records: this.#records.bind(this),
				stream: this.#streamRows.bind(this),
				aggregate: this.#aggregate.bind(this),
				migrate: this.#migrateTransaction.bind(this, token),
				metadata: this.#metadata.bind(this),
				stamp: this.#stamp.bind(this),
			},
			() => this.#requireTransaction(token),
		)
	}

	async #migrateTransaction(token: SQLiteTransaction, input: MigrationInput): Promise<void> {
		const database = this.#require()
		const owned = cloneMigrationInput(input)
		const candidate = token.schema
		const identities = token.identities
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
			this.#contain(database, () => {
				this.#applyPlan(database, owned)
				if (owned.metadata !== undefined) {
					this.#writeMetadata(database, owned.metadata)
				}
			})
		})
		token.project(projected, projectedIdentities)
	}

	// Run work inside one savepoint of the open transaction: a throw rolls the work back and
	// leaves the transaction open, because the published wrapper has no savepoint manager.
	#contain(database: SQLiteDatabaseInterface, operation: () => void): void {
		database.execute('SAVEPOINT "_orkestrel_scope"')
		try {
			operation()
			database.execute('RELEASE SAVEPOINT "_orkestrel_scope"')
		} catch (error) {
			try {
				database.execute('ROLLBACK TO SAVEPOINT "_orkestrel_scope"')
			} finally {
				database.execute('RELEASE SAVEPOINT "_orkestrel_scope"')
			}
			throw error
		}
	}

	// The primary column's declaration, which encodes a key for binding.
	#primary(schema: TableSchema): ColumnSchema {
		return (
			findColumn(schema.primary, schema) ?? {
				name: schema.primary,
				storage: 'text',
				optional: false,
				nullable: false,
			}
		)
	}

	#requireTransaction(token: SQLiteTransaction): void {
		if (!this.#transactions.has(token)) {
			throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		}
	}

	#root(): void {
		if (this.#transactions.size !== 0) {
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
			if (isDatabaseError(error)) throw error
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
			throw new DatabaseError('DRIVER', isError(error) ? error.message : String(error), {
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
		const [transaction] = this.#transactions
		const schema = (transaction?.schema ?? this.#schema).get(name)
		if (schema === undefined) {
			throw new DatabaseError('NOT_FOUND', `Table '${name}' is not in the schema`, { table: name })
		}
		return schema
	}

	// Encode a primary key for binding against its column's stored type.
	#key(key: Key, schema: TableSchema): SQLiteValue {
		return encodeValue(key, this.#primary(schema))
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
