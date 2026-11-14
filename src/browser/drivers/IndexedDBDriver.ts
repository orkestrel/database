import type {
	AggregateOperation,
	QueryInput,
	DriverInterface,
	DriverMetadata,
	Key,
	MigrationInput,
	MigrationStep,
	OperationOptions,
	ReadInput,
	ReadPlan,
	Row,
	TableSchema,
} from '@src/core'
import type {
	IndexedDBCursorInterface,
	IndexedDBDatabaseInterface,
	IndexedDBIndexInterface,
	IndexedDBStoreInterface,
	IndexedDBTransactionStoreInterface,
	IndexedDBUpgradeContext,
	StoreDefinition,
} from '@orkestrel/indexeddb'
import type { FieldPath } from '@orkestrel/contract'
import type { AccessBatch, AccessPlan, AccessPosition } from '../types.js'
import {
	applyKeys,
	applyQuery,
	bindRowKey,
	checkAbort,
	cloneDriverMetadata,
	cloneMigrationInput,
	compareValues,
	computeAggregate,
	computeRemoved,
	DatabaseError,
	equalsValue,
	buildBatch,
	extractKey,
	isKey,
	isDatabaseError,
	matchesQuery,
	prepareScalars,
	migrateRows,
	normalizeDriverSchema,
	projectMigrationSchema,
	StreamPage,
	validatePage,
} from '@src/core'
import { attempt, isArray, isDefined, isError, isNumber, isTrue } from '@orkestrel/contract'
import {
	createIndexedDBDatabase,
	isIndexedDBError,
	promisifyRequest,
	readRecords,
	wrapCall,
} from '@orkestrel/indexeddb'
import {
	deriveIndexedDBIndexName,
	findAccessPlan,
	mapIndexedDBError,
	mapMigrationError,
	matchesKeyList,
	narrowRange,
	planIndexedDBQuery,
	readIndexNames,
	resolveCount,
	schemaToStore,
} from '../helpers.js'
import { METADATA_STORE, STREAM_BATCH_SIZE } from '../constants.js'
import { IndexedDBBatchIterator } from '../IndexedDBBatchIterator.js'
import { IndexedDBMigrationIterator } from '../IndexedDBMigrationIterator.js'

/**
 * Implements the {@link DriverInterface} over IndexedDB — the persistent browser backend,
 * built on the published `@orkestrel/indexeddb` wrapper.
 *
 * @remarks
 * A thin adapter: it implements the storage primitives the core database layer
 * needs (`open` / `close` / `read` / `write` / `insert` / `delete` / `keys` / `scan` /
 * `clear`) by delegating to the wrapper's typed store operations. Rows are stored with
 * **out-of-line keys** (the database passes the key explicitly, `store.set(row, key)`), so
 * each table is declared as a key-path-less store. A fresh database opens in
 * **auto-managed** mode (no fixed version), creating missing declared stores and indexes on
 * demand. Once metadata is persisted, bootstrap captures the live stores and version, rejects
 * a missing persisted store, and pins the final open to that version so a competing
 * versionchange cannot silently recreate lost storage. `open` drops every index of a
 * deployed table that the deployed schema does not declare, on its own connection at the
 * next version; a concurrent version bump between its read of the version and that upgrade
 * raises a `DRIVER` error whose `context.retryable` is `true`. A list read is one
 * `get(keys)` transaction, and a list write, insert, or delete runs in one `database.write`
 * scope, so a conflicting row applies none of the batch.
 *
 * It declares `plan`, `records`, `stream`, and `aggregate`: {@link planIndexedDBQuery} keeps
 * native the one access path {@link findAccessPlan} ranks first, the order and the page that
 * path serves, and `count`, `minimum`, and `maximum` through `count(range)` and the first
 * entry of an index; every other clause is residual for the core engine. A stream, and
 * `scan`, read at most {@link STREAM_BATCH_SIZE} rows per transaction and resume after the
 * final key of each batch, so the stream reads each batch at its own moment. A native page
 * reads no row past `offset + limit`; a page with residual conditions stops after the batch
 * that holds its last match. A stored value that is no record raises `DRIVER`, and
 * `MIGRATION` inside `migrate`.
 *
 * @remarks
 * This driver also implements `migrate` / `metadata` / `stamp`. `metadata` / `stamp`
 * persist the {@link DriverMetadata} in a reserved out-of-line store,
 * {@link METADATA_STORE} (`__metadata__`), driver bookkeeping no table reaches. `migrate` applies a
 * {@link Migration} plan natively: IndexedDB schema DDL (creating/dropping a
 * store, creating/dropping an index) is legal only inside a versionchange
 * transaction (`onupgradeneeded`), so `migrate` closes the current connection
 * and opens a fresh one at `version + 1` with an `upgrade` hook that walks the
 * plan's steps — dropping stores, adding/removing indexes on the raw
 * `IDBTransaction`, and rewriting rows for `column.remove` through a cursor walk
 * (the one step needing to touch existing data; `column.add` is a no-op — this
 * driver stores whatever a row carries, so there is nothing to backfill). A
 * step referencing an unknown table is validated before the reconnect, so a
 * `MIGRATION` `DatabaseError` never wastes a version bump.
 *
 * @remarks
 * This driver omits `transaction`: the wrapper auto-commits an `IDBTransaction` when control
 * yields outside its request chain, so arbitrary callback awaits cannot remain inside one
 * native transaction, and the core's journal carries a scope over this driver. Every atomic
 * multi-operation sequence in this driver, a batch included, runs inside one
 * `db.write(...)` scope.
 */
export class IndexedDBDriver implements DriverInterface {
	readonly #name: string
	#identities = new Map<string, object>()
	#schema = new Map<string, TableSchema>()
	#database: IndexedDBDatabaseInterface | undefined

	constructor(name: string) {
		this.#name = name
	}

	async open(schema: readonly TableSchema[]): Promise<void> {
		const owned = normalizeDriverSchema(schema)
		// The reserved metadata store name may never collide with a caller-declared
		// table — it would silently corrupt this driver's own `metadata`/`stamp`
		// bookkeeping — a programmer error, so it throws.
		if (owned.some((table) => table.name === METADATA_STORE)) {
			throw new DatabaseError(
				'VALIDATION',
				`open: table name '${METADATA_STORE}' is reserved for driver metadata`,
				{ table: METADATA_STORE },
			)
		}
		this.#database?.close()
		this.#database = undefined
		this.#schema = new Map()
		try {
			// Reconnect cleanly so the auto-managed bootstrap can ensure the
			// metadata store exists without being blocked by this driver's own
			// open handle. The final persisted open is version-pinned below.
			// Build the new schema into a local map first — never mutate `#schema`
			// in place — so a reopen with a reduced schema replaces the map
			// wholesale instead of retaining ghost tables the caller no longer
			// declared.
			const [stores, version, persisted, indexes] = await this.#bootstrap()
			if (persisted !== undefined) {
				for (const table of persisted.schema) {
					if (!stores.includes(table.name)) {
						throw new DatabaseError('DRIVER', 'Stored IndexedDB store is missing', {
							name: this.#name,
							store: table.name,
							aspect: 'missing',
						})
					}
				}
			}
			const map = new Map<string, TableSchema>()
			for (const table of normalizeDriverSchema(persisted?.schema ?? owned)) {
				map.set(table.name, table)
			}
			// Each index of a deployed table that the deployed schema does not declare.
			const undeclared = [...map.values()].flatMap((table) => {
				const declared = table.indexes.map(deriveIndexedDBIndexName)
				return (indexes.get(table.name) ?? [])
					.filter((index) => !declared.includes(index))
					.map((index) => [table.name, index] as const)
			})
			const current = undeclared.length === 0 ? version : version + 1
			if (undeclared.length > 0) await this.#reconcile(map, current, undeclared)
			const database = createIndexedDBDatabase({
				name: this.#name,
				...(persisted === undefined ? {} : { version: current }),
				stores: this.#stores(map),
			})
			try {
				await database.connect()
			} catch (error) {
				database.close()
				throw error
			}
			// Remember the schema so the native `records` / `stream` hooks
			// can plan a key-range pushdown (the primary key, column types, secondary
			// indexes).
			const identities = this.#alignIdentities(map)
			this.#schema = map
			this.#identities = identities
			this.#database = database
		} catch (error) {
			this.#identities = new Map()
			throw this.#wrap(error)
		}
	}

	async close(): Promise<void> {
		this.#database?.close()
		this.#database = undefined
	}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		try {
			// A list is one `get(keys)` call, in one transaction.
			const store = this.#store(table)
			// The ternary only selects the overload; both arms make the same call.
			return isArray(keys) ? await store.get(keys) : await store.get(keys)
		} catch (error) {
			throw this.#wrap(error)
		}
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
		const entries = this.#bind(table, buildBatch(keys, rows))
		await this.#mutate(table, options, async (store) => {
			await Promise.all(entries.map(([key, row]) => store.set(row, key)))
		})
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
		const entries = this.#bind(table, buildBatch(keys, rows))
		await this.#mutate(table, options, async (store) => {
			await Promise.all(entries.map(([key, row]) => store.add(row, key)))
		})
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
		return applyKeys(keys, async (listed) => {
			const result = Promise.withResolvers<readonly boolean[]>()
			await this.#mutate(table, options, async (store) => {
				const existed = await store.has(listed)
				await store.remove(listed)
				result.resolve(computeRemoved(listed, existed))
			})
			return result.promise
		})
	}

	async keys(table: string): Promise<readonly Key[]> {
		try {
			const keys = await this.#store(table).keys()
			return keys.filter(isKey)
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	scan(table: string): AsyncIterable<Row> {
		return this.#stream(table, {})
	}

	async clear(table: string): Promise<void> {
		try {
			await this.#store(table).clear()
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	/**
	 * Splits a read into the access path the engine answers and the residual the core runs.
	 *
	 * @param table - The declared table to read
	 * @param input - The read to split
	 * @returns The plan {@link planIndexedDBQuery} returns for the table and its indexes
	 */
	plan(table: string, input: ReadInput): ReadPlan {
		try {
			return planIndexedDBQuery(input, this.#table(table), this.#store(table).indexes)
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	async records(table: string, input: QueryInput): Promise<readonly Row[]> {
		validatePage(input)
		try {
			return await this.#records(table, input)
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	stream(table: string, input: QueryInput): AsyncIterable<Row> {
		validatePage(input)
		return this.#stream(table, input)
	}

	/**
	 * Computes an aggregate over the rows matching the native side of a plan.
	 *
	 * @remarks
	 * `count` reads `count(range)` on the store or index of the access path, one count per
	 * listed key for `any`, and reads no row. `minimum` and `maximum` read the key of the first
	 * entry in the cursor direction of the path's own column. `sum` and `average`, which a plan
	 * never keeps native, reduce the rows `records` reads.
	 *
	 * @param table - The declared table to read
	 * @param operation - The aggregate to compute
	 * @param column - The column to aggregate
	 * @param input - The native side of the plan
	 * @returns The aggregate value, or `undefined` when undefined for the rows
	 */
	async aggregate(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		validatePage(input)
		try {
			return await this.#aggregate(table, operation, column, input)
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	/**
	 * Returns the persisted {@link DriverMetadata}, or `undefined` when the store has
	 * never been stamped.
	 *
	 * @remarks
	 * Reads `'metadata'` from the reserved {@link METADATA_STORE} in one readonly
	 * transaction that distinguishes key absence from a present `undefined`
	 * value. Only absence returns `undefined`; present malformed state fails
	 * closed with a payload-safe `DRIVER` error.
	 *
	 * @returns The last-stamped {@link DriverMetadata}, or `undefined`
	 */
	async metadata(): Promise<DriverMetadata | undefined> {
		try {
			return await this.#load(this.#require())
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	/**
	 * Persists an owned metadata snapshot for a later `metadata()` to return.
	 *
	 * @param metadata - The {@link DriverMetadata} to persist
	 */
	async stamp(metadata: DriverMetadata): Promise<void> {
		const database = this.#require()
		const owned = cloneDriverMetadata(metadata)
		try {
			await database
				.store(METADATA_STORE)
				.set({ version: owned.version, schema: owned.schema }, 'metadata')
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	/**
	 * Applies a {@link Migration} plan by reconnecting at a bumped version and
	 * running the plan's steps inside the wrapper's `upgrade` hook.
	 *
	 * @remarks
	 * IndexedDB schema DDL is legal only inside `onupgradeneeded`, so this closes
	 * the current connection and opens a fresh one at `version + 1`, declaring
	 * every store known at that point (plus {@link METADATA_STORE}) so nothing is
	 * lost, and applying `table.remove` / `index.add` / `index.remove` /
	 * `column.remove` inside `upgrade`. Every step's `table` is validated against
	 * the driver's own `#schema` before the reconnect — an unknown-table step
	 * throws `DatabaseError` `MIGRATION` without ever bumping the version.
	 * `table.add` / `column.add` need no upgrade-time action: `table.add` is
	 * created by the wrapper's built-in create-missing-stores pass (its
	 * definition is already in the declared `stores`), and this driver stores
	 * whatever a row carries — there is nothing to backfill for a new column.
	 * `#schema` bookkeeping is updated to match the applied plan, mirroring what
	 * `open` tracks, so subsequent pushdown planning and a later `migrate` /
	 * `open` see the new shape.
	 *
	 * @param input - The migration plan and optional metadata stamp to apply atomically
	 */
	async migrate(input: MigrationInput): Promise<void> {
		const current = this.#require()
		const owned = cloneMigrationInput(input)
		const projected = projectMigrationSchema([...this.#schema.values()], owned.plan.steps)
		if (
			owned.metadata !== undefined &&
			!equalsValue(normalizeDriverSchema(owned.metadata.schema), projected)
		) {
			throw new DatabaseError('MIGRATION', 'Migration metadata schema does not match the plan', {
				projected,
				metadata: owned.metadata.schema,
			})
		}
		const schema = new Map(projected.map((table) => [table.name, table]))
		const identities = this.#projectIdentities(this.#identities, owned.plan.steps)
		if (owned.plan.steps.length === 0) {
			const metadata = owned.metadata
			if (metadata !== undefined) {
				try {
					await current.write(METADATA_STORE, async (transaction) => {
						await transaction.store(METADATA_STORE).set(
							{
								version: metadata.version,
								schema: metadata.schema,
							},
							'metadata',
						)
					})
				} catch (error) {
					throw this.#wrap(error)
				}
			}
			return
		}
		// Project the post-migration shape into a local copy first — `#schema`
		// stays untouched until the upgrade actually commits, so a mid-upgrade
		// failure never leaves the driver's bookkeeping ahead of the real database.
		try {
			await current.connect()
			const version = current.version
			current.close()
			this.#database = undefined
			const added = new Set([...schema.keys()].filter((name) => !this.#schema.has(name)))
			const database = createIndexedDBDatabase({
				name: this.#name,
				version: version + 1,
				stores: this.#stores(schema),
				upgrade: this.#upgrade.bind(this, owned, added),
			})
			try {
				await database.connect()
			} catch (error) {
				database.close()
				throw error
			}
			// Only on success: adopt the connection AND commit the local map.
			this.#database = database
			this.#schema = schema
			this.#identities = identities
		} catch (error) {
			current.close()
			this.#database = undefined
			const cause = this.#migrationError(error)
			try {
				await this.#reopen()
			} catch (recoveryError) {
				this.#database = undefined
				throw new DatabaseError('DRIVER', 'IndexedDB migration and recovery failed', {
					cause,
					recovery: this.#recoveryError(recoveryError),
				})
			}
			throw cause
		}
	}

	// === Private

	// A transaction cannot outlive the consumer's awaits, so a stream reads one batch per transaction.
	async *#stream(table: string, input: QueryInput): AsyncIterable<Row> {
		try {
			const split = planIndexedDBQuery(input, this.#table(table), this.#store(table).indexes)
			const residual = split.residual
			if (residual.order !== undefined) {
				yield* await this.#records(table, input)
				return
			}
			if (split.native.limit === 0 || residual.limit === 0) return
			const conditions = residual.conditions ?? []
			const scalars = prepareScalars(conditions)
			const page = new StreamPage(residual.offset ?? 0)
			for await (const batch of this.#batches(table, split.native)) {
				for (const row of batch) {
					if (conditions.length > 0 && !matchesQuery(row, conditions, scalars)) continue
					if (!page.next()) continue
					yield row
					if (residual.limit !== undefined && page.count >= residual.limit) return
				}
			}
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	// A page bounds every batch: the walk reads no row past `offset + limit`.
	async *#batches(table: string, input: QueryInput): AsyncIterable<readonly Row[]> {
		const schema = this.#table(table)
		const store = this.#store(table)
		const plan = findAccessPlan(input, schema, store.indexes)
		const direction = input.order?.at(0)?.direction === 'descending' ? 'prev' : 'next'
		const offset = input.offset ?? 0
		const bound = input.limit === undefined ? Number.POSITIVE_INFINITY : offset + input.limit
		if (matchesKeyList(plan, input.order, schema.primary)) {
			yield* this.#listBatches(table, plan, direction, offset, bound)
			return
		}
		const read =
			plan.index === undefined && direction === 'next'
				? this.#readRange.bind(this, table, schema.primary, plan.range)
				: this.#readCursor.bind(
						this,
						plan.index === undefined ? store : store.index(plan.index),
						plan.range,
						direction,
						plan.index !== undefined,
					)
		const page = new StreamPage(offset)
		for await (const batch of new IndexedDBBatchIterator(read, bound)) {
			const rows = offset === 0 ? batch : batch.filter(() => page.next())
			if (rows.length > 0) yield rows
		}
	}

	// A direct caller can pass clauses the plan leaves residual; the core engine runs those.
	async #records(table: string, input: QueryInput): Promise<readonly Row[]> {
		const schema = this.#table(table)
		const store = this.#store(table)
		const split = planIndexedDBQuery(input, schema, store.indexes)
		if (Object.keys(split.residual).length > 0) {
			return applyQuery(await this.#records(table, split.native), split.residual)
		}
		const plan = findAccessPlan(input, schema, store.indexes)
		const direction = input.order?.at(0)?.direction === 'descending' ? 'prev' : 'next'
		const offset = input.offset ?? 0
		const limit = input.limit
		if (limit === 0) return []
		if (matchesKeyList(plan, input.order, schema.primary)) {
			return this.#list(table, schema.primary, plan, direction, offset, limit)
		}
		const source = plan.index === undefined ? store : store.index(plan.index)
		if (limit === undefined) {
			const rows = await source.records(plan.range)
			const ordered = direction === 'prev' ? rows.toReversed() : rows
			return offset > 0 ? ordered.slice(offset) : ordered
		}
		if (direction === 'next' && offset === 0) return source.records(plan.range, resolveCount(limit))
		if (resolveCount(offset) === undefined) return []
		const opened = await source.cursor({
			...(plan.range === undefined ? {} : { query: plan.range }),
			direction,
		})
		const cursor = opened === null || offset === 0 ? opened : await opened.advance(offset)
		if (cursor === null) return []
		const rows: Row[] = []
		await this.#collect(cursor, rows, limit)
		return rows
	}

	// A page reads its sorted keys first, so it reads the values of the page's rows alone.
	#list(
		table: string,
		primary: string,
		plan: AccessPlan,
		direction: IDBCursorDirection,
		offset: number,
		limit: number | undefined,
	): Promise<readonly Row[]> {
		return this.#within(table, async (store) => {
			if (offset === 0 && limit === undefined) {
				const rows = await this.#listRows(store, plan)
				const sign = direction === 'prev' ? -1 : 1
				return rows.toSorted((left, right) => sign * compareValues(left[primary], right[primary]))
			}
			const cap =
				limit !== undefined && direction === 'next' && plan.keys !== undefined
					? resolveCount(offset + limit)
					: undefined
			const keys = await this.#listKeys(store, plan, cap)
			const ordered = direction === 'prev' ? keys.toReversed() : keys
			const window = ordered.slice(offset, limit === undefined ? undefined : offset + limit)
			return (await store.get(window)).filter(isDefined)
		})
	}

	async #listRows(
		store: IndexedDBTransactionStoreInterface,
		plan: AccessPlan,
	): Promise<readonly Row[]> {
		const name = plan.index
		if (name === undefined) return (await store.get(plan.keys ?? [])).filter(isDefined)
		const index = wrapCall(() => store.store.index(name))
		const ranges = plan.keys?.map((key) => IDBKeyRange.only(key)) ?? [plan.range]
		const lists = await Promise.all(ranges.map((range) => readRecords(index, range)))
		return lists.flat()
	}

	// Each list is in primary-key order, so its first `cap` keys hold every key a page can take.
	async #listKeys(
		store: IndexedDBTransactionStoreInterface,
		plan: AccessPlan,
		cap: number | undefined,
	): Promise<readonly IDBValidKey[]> {
		const name = plan.index
		if (name === undefined) {
			const keys = plan.keys ?? []
			const present = await store.has(keys)
			return keys.filter((_, position) => present[position] === true)
		}
		const index = wrapCall(() => store.store.index(name))
		const ranges = plan.keys?.map((key) => IDBKeyRange.only(key)) ?? [plan.range]
		const lists = await Promise.all(
			ranges.map((range) => promisifyRequest(wrapCall(() => index.getAllKeys(range, cap)))),
		)
		return lists.flat().toSorted(compareValues)
	}

	// A row can change between the key read and its batch, so each batch rechecks the path.
	async *#listBatches(
		table: string,
		plan: AccessPlan,
		direction: IDBCursorDirection,
		offset: number,
		bound: number,
	): AsyncIterable<readonly Row[]> {
		const cap =
			direction === 'next' && plan.keys !== undefined && Number.isFinite(bound)
				? resolveCount(bound)
				: undefined
		const listed = await this.#within(table, (store) => this.#listKeys(store, plan, cap))
		const keys = (direction === 'prev' ? listed.toReversed() : listed).slice(offset, bound)
		const store = this.#store(table)
		const batches = Array.from({ length: Math.ceil(keys.length / STREAM_BATCH_SIZE) }, (_, at) =>
			keys.slice(at * STREAM_BATCH_SIZE, (at + 1) * STREAM_BATCH_SIZE),
		)
		for (const batch of batches) {
			const rows = (await store.get(batch)).filter(isDefined)
			yield plan.index === undefined
				? rows
				: rows.filter((row) => matchesQuery(row, plan.conditions))
		}
	}

	async #readRange(
		table: string,
		primary: string,
		range: IDBKeyRange | undefined,
		position: AccessPosition | undefined,
		size: number,
	): Promise<AccessBatch> {
		const query =
			position === undefined ? range : narrowRange(range, position.primary, 'next', true)
		if (position !== undefined && query === undefined) return { rows: [] }
		const rows = await this.#store(table).records(query, size)
		const last = rows.at(-1)
		if (rows.length < size || last === undefined) return { rows }
		const key = extractKey(last, primary)
		if (key === undefined) {
			throw new DatabaseError('DRIVER', 'Stored IndexedDB row does not carry its primary key', {
				table,
				column: primary,
			})
		}
		return { rows, position: { key, primary: key } }
	}

	// An index key repeats across rows, so an index resumes by seeking its key and primary key.
	async #readCursor(
		source: IndexedDBStoreInterface | IndexedDBIndexInterface,
		range: IDBKeyRange | undefined,
		direction: IDBCursorDirection,
		indexed: boolean,
		position: AccessPosition | undefined,
		size: number,
	): Promise<AccessBatch> {
		const query =
			position === undefined
				? range
				: narrowRange(range, indexed ? position.key : position.primary, direction, !indexed)
		if (position !== undefined && query === undefined) return { rows: [] }
		const opened = await source.cursor({ ...(query === undefined ? {} : { query }), direction })
		const cursor =
			opened === null || position === undefined || !indexed
				? opened
				: await this.#seek(opened, position)
		if (cursor === null) return { rows: [] }
		const rows: Row[] = []
		const last = await this.#collect(cursor, rows, size)
		return rows.length < size
			? { rows }
			: { rows, position: { key: last.key, primary: last.primary } }
	}

	async #seek(
		cursor: IndexedDBCursorInterface,
		position: AccessPosition,
	): Promise<IndexedDBCursorInterface | null> {
		const sign = cursor.direction === 'prev' ? -1 : 1
		const order =
			sign *
			(indexedDB.cmp(cursor.key, position.key) || indexedDB.cmp(cursor.primary, position.primary))
		if (order > 0) return cursor
		if (order === 0) return cursor.continue()
		const sought = await cursor.seek(position.key, position.primary)
		return sought === null ? null : this.#seek(sought, position)
	}

	async #collect(
		cursor: IndexedDBCursorInterface,
		rows: Row[],
		size: number,
	): Promise<IndexedDBCursorInterface> {
		rows.push(cursor.value)
		if (rows.length >= size) return cursor
		const next = await cursor.continue()
		return next === null ? cursor : this.#collect(next, rows, size)
	}

	// A minimum or maximum reads the first key in the cursor direction, never a row.
	async #aggregate(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		const schema = this.#table(table)
		const store = this.#store(table)
		const read = { ...input, aggregate: { operation, column } }
		const split = planIndexedDBQuery(read, schema, store.indexes)
		if (split.native.aggregate === undefined) {
			const filter = input.conditions === undefined ? {} : { conditions: input.conditions }
			return computeAggregate(await this.#records(table, filter), operation, column)
		}
		const plan = findAccessPlan(read, schema, store.indexes)
		const keys = plan.keys
		const name = plan.index
		if (operation === 'count' && keys !== undefined) {
			return this.#within(table, async (scoped) => {
				if (name === undefined) return (await scoped.has(keys)).filter(isTrue).length
				const index = wrapCall(() => scoped.store.index(name))
				const counts = await Promise.all(
					keys.map((key) => promisifyRequest(wrapCall(() => index.count(IDBKeyRange.only(key))))),
				)
				return counts.reduce((total, count) => total + count, 0)
			})
		}
		const source = name === undefined ? store : store.index(name)
		if (operation === 'count') return source.count(plan.range)
		const cursor = await source.cursor({
			...(plan.range === undefined ? {} : { query: plan.range }),
			direction: operation === 'minimum' ? 'next' : 'prev',
		})
		return cursor !== null && isNumber(cursor.key) ? cursor.key : undefined
	}

	async #within<T>(
		table: string,
		scope: (store: IndexedDBTransactionStoreInterface) => Promise<T>,
	): Promise<T> {
		const result = Promise.withResolvers<T>()
		await this.#require().read(table, async (transaction) => {
			result.resolve(await scope(transaction.store(table)))
		})
		return result.promise
	}

	// A concurrent bump past the version refuses the open, and one to it skips the upgrade.
	async #reconcile(
		schema: ReadonlyMap<string, TableSchema>,
		version: number,
		undeclared: ReadonlyArray<readonly [string, string]>,
	): Promise<void> {
		const database = createIndexedDBDatabase({
			name: this.#name,
			version,
			stores: this.#stores(schema),
			upgrade: (context) => {
				for (const [store, index] of undeclared) context.indexes.drop(store, index)
			},
		})
		try {
			const native = await database.connect()
			const indexes = readIndexNames(
				native,
				undeclared.map(([store]) => store),
			)
			if (undeclared.some(([store, index]) => indexes.get(store)?.includes(index) === true)) {
				throw this.#bumped(undefined)
			}
		} catch (error) {
			const bumped =
				isIndexedDBError(error) &&
				error.code === 'OPEN' &&
				isError(error.cause) &&
				error.cause.name === 'VersionError'
			throw bumped ? this.#bumped(error) : error
		} finally {
			database.close()
		}
	}

	#bumped(cause: unknown): DatabaseError {
		return new DatabaseError('DRIVER', 'IndexedDB database changed version during open', {
			name: this.#name,
			retryable: true,
			...(cause === undefined ? {} : { cause }),
		})
	}

	// Run one point mutation inside an explicit readwrite transaction. The
	// signal can abort that transaction only while it is active; native
	// completion is the commit boundary, so a late abort cannot rewrite a
	// completed success. A signal-driven rollback is translated to the core
	// ABORTED error after the wrapper has observed transaction settlement.
	async #mutate(
		table: string,
		options: OperationOptions | undefined,
		scope: (store: IndexedDBTransactionStoreInterface) => Promise<void>,
	): Promise<void> {
		const signal = options?.signal
		checkAbort(signal)
		const cleanup = new AbortController()
		const abort = new AbortController()
		try {
			await this.#require().write(table, async (transaction) => {
				checkAbort(signal)
				signal?.addEventListener(
					'abort',
					() => {
						if (!transaction.active) return
						attempt(() => {
							transaction.abort()
							abort.abort()
						})
					},
					{ once: true, signal: cleanup.signal },
				)
				checkAbort(signal)
				await scope(transaction.store(table))
			})
		} catch (error) {
			if (abort.signal.aborted) checkAbort(signal)
			throw this.#wrap(error)
		} finally {
			cleanup.abort()
		}
	}

	// Write each row's key into its primary column, ahead of the transaction.
	#bind(
		table: string,
		entries: ReadonlyArray<readonly [Key, Row]>,
	): ReadonlyArray<readonly [Key, Row]> {
		const primary = this.#table(table).primary
		return entries.map(([key, row]) => [key, bindRowKey(row, primary, key)] as const)
	}

	#require(): IndexedDBDatabaseInterface {
		if (this.#database === undefined) {
			throw new DatabaseError('CLOSED', `IndexedDB database '${this.#name}' is not open`, {
				name: this.#name,
			})
		}
		return this.#database
	}

	async #load(database: IndexedDBDatabaseInterface): Promise<DriverMetadata | undefined> {
		const result = Promise.withResolvers<readonly [boolean, unknown]>()
		try {
			await database.read(METADATA_STORE, async (transaction) => {
				const store = transaction.store(METADATA_STORE)
				const present = await store.has('metadata')
				result.resolve([present, present ? await store.get('metadata') : undefined])
			})
		} catch (error) {
			throw isIndexedDBError(error) && error.code === 'RECORD' ? this.#invalid() : error
		}
		const [present, value] = await result.promise
		if (!present) return undefined
		try {
			return cloneDriverMetadata(value)
		} catch {
			throw this.#invalid()
		}
	}

	#invalid(): DatabaseError {
		const cause = new DatabaseError('VALIDATION', 'Stored IndexedDB metadata failed validation', {
			path: 'metadata',
		})
		return new DatabaseError('DRIVER', 'Stored IndexedDB metadata is invalid', {
			name: this.#name,
			store: METADATA_STORE,
			key: 'metadata',
			cause,
		})
	}

	#migrationError(error: unknown): DatabaseError {
		if (isDatabaseError(error)) return error
		if (isIndexedDBError(error)) return mapMigrationError(error)
		return new DatabaseError('DRIVER', 'IndexedDB migration failed', { cause: error })
	}

	#recoveryError(error: unknown): DatabaseError {
		if (isDatabaseError(error)) return error
		if (isIndexedDBError(error)) return mapIndexedDBError(error)
		return new DatabaseError('DRIVER', 'IndexedDB recovery failed', { cause: error })
	}

	// The shared ordinary CRUD/query backend-fault boundary: no `IndexedDBError`
	// may leak through those `DriverInterface` operations. A `DatabaseError` this
	// driver threw itself (such as the `CLOSED` gate or `NOT_FOUND` table guard)
	// passes through unchanged; only a genuine backend `IndexedDBError` is
	// remapped. Migration and recovery instead use `#migrationError` and
	// `#recoveryError`.
	#wrap(error: unknown): unknown {
		return isIndexedDBError(error) ? mapIndexedDBError(error) : error
	}

	#store(table: string) {
		return this.#require().store(table)
	}

	#alignIdentities(schema: ReadonlyMap<string, TableSchema>): Map<string, object> {
		const aligned = new Map<string, object>()
		for (const table of schema.values()) {
			aligned.set(table.name, this.#identities.get(table.name) ?? {})
		}
		return aligned
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

	// Project a schema map into the wrapper's declared-stores shape — the
	// reserved metadata store is always declared alongside every table, out-of-line
	// (keys are passed explicitly), with the declared secondary indexes becoming
	// each store's `createIndex` definitions. Shared by `open`, `migrate`, and
	// `#reopen` so the projection never drifts between them.
	#stores(schema: ReadonlyMap<string, TableSchema>): Record<string, StoreDefinition> {
		const stores: Record<string, StoreDefinition> = {
			[METADATA_STORE]: {},
		}
		for (const table of schema.values()) {
			stores[table.name] = schemaToStore(table)
		}
		return stores
	}

	// Like `open`, a database with stored metadata reopens pinned, so recovery runs no reconcile.
	async #reopen(): Promise<void> {
		const [, version, persisted] = await this.#bootstrap()
		const database = createIndexedDBDatabase({
			name: this.#name,
			...(persisted === undefined ? {} : { version }),
			stores: this.#stores(this.#schema),
		})
		try {
			await database.connect()
			this.#database = database
		} catch (error) {
			database.close()
			throw error
		}
	}

	#table(name: string): TableSchema {
		const schema = this.#schema.get(name)
		if (schema === undefined) {
			throw new DatabaseError('NOT_FOUND', `table '${name}' is not declared`, { table: name })
		}
		return schema
	}

	// Mirror a migration plan's steps onto a local schema map — the same
	// bookkeeping `open` does for a freshly declared schema — without touching
	// `#schema`, so a failed migrate never leaves the driver's bookkeeping ahead
	// of the real database. The caller commits the map into `#schema` only after
	// the upgrade connects successfully.
	// Runs inside the wrapper's versionchange transaction (see `migrate`
	// @remarks). `table.add` / `column.add` are no-ops here — see `migrate`
	// @remarks for why. `column.remove` is the one step touching existing rows:
	// it walks a live cursor and rewrites each row through the core
	// `migrateRows`, updating in place — the only IDB-await-only work permitted
	// inside an upgrade transaction.
	async #upgrade(
		input: MigrationInput,
		added: ReadonlySet<string>,
		context: IndexedDBUpgradeContext,
	): Promise<void> {
		for (const name of added) {
			if (name !== METADATA_STORE && context.stores.names.includes(name)) {
				context.stores.drop(name)
			}
		}
		for (const step of input.plan.steps) {
			switch (step.operation) {
				case 'table.add':
					context.stores.create(step.table.name, schemaToStore(step.table))
					break
				case 'table.remove':
					context.stores.drop(step.table)
					break
				case 'index.add': {
					const name = deriveIndexedDBIndexName(step.index)
					const [column] = step.index
					const path = step.index.length === 1 && column !== undefined ? column : [...step.index]
					context.indexes.create(step.table, { name, path })
					break
				}
				case 'index.remove':
					context.indexes.drop(step.table, deriveIndexedDBIndexName(step.index))
					break
				case 'column.remove': {
					const store = context.stores.store(step.table)
					for await (const cursor of new IndexedDBMigrationIterator(store)) {
						const [migrated] = migrateRows([cursor.value], [step])
						if (migrated === undefined) {
							throw new DatabaseError('MIGRATION', 'migrate: transformed row is missing', {
								table: step.table,
							})
						}
						await cursor.update(migrated)
					}
					break
				}
				case 'column.add':
					break
			}
		}
		if (input.metadata !== undefined) {
			await context.stores.store(METADATA_STORE).set(
				{
					version: input.metadata.version,
					schema: input.metadata.schema,
				},
				'metadata',
			)
		}
	}

	async #bootstrap(): Promise<
		readonly [
			readonly string[],
			number,
			DriverMetadata | undefined,
			ReadonlyMap<string, readonly string[]>,
		]
	> {
		const bootstrap = createIndexedDBDatabase({
			name: this.#name,
			stores: { [METADATA_STORE]: {} },
		})
		try {
			const native = await bootstrap.connect()
			const stores = bootstrap.stores
			const indexes = readIndexNames(
				native,
				stores.filter((store) => store !== METADATA_STORE),
			)
			return [stores, bootstrap.version, await this.#load(bootstrap), indexes]
		} finally {
			bootstrap.close()
		}
	}
}
