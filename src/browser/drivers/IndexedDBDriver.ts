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
} from '@src/core'
import {
	applyQuery,
	bindRowKey,
	checkAbort,
	cloneDriverMetadata,
	cloneMigrationInput,
	compareValues,
	DatabaseError,
	equalsValue,
	extractKey,
	isKey,
	isDatabaseError,
	matchesQuery,
	migrateRows,
	normalizeDriverSchema,
	planMigration,
	projectMigrationSchema,
	validatePage,
} from '@src/core'
import type {
	IndexedDBDatabaseInterface,
	IndexedDBStoreInterface,
	IndexedDBTransactionStoreInterface,
	IndexedDBUpgradeContext,
	StoreDefinition,
} from '@orkestrel/indexeddb'
import { createIndexedDBDatabase, isIndexedDBError } from '@orkestrel/indexeddb'
import type { QueryPlan } from '../types.js'
import {
	deriveIndexedDBIndexName,
	mapIndexedDBError,
	mapMigrationError,
	schemaToStore,
	selectPlan,
} from '../helpers.js'
import { METADATA_STORE } from '../constants.js'

/**
 * Implements the {@link DriverInterface} over IndexedDB — the persistent browser backend,
 * built on the published `@orkestrel/indexeddb` wrapper.
 *
 * @remarks
 * A thin adapter: it implements the storage primitives the core database layer
 * needs (`open` / `close` / `read` / `write` / `delete` / `keys` / `scan` / `clear`
 * / `snapshot`) by delegating to the wrapper's typed store operations — it never
 * touches raw IndexedDB. Rows are stored with **out-of-line keys** (the database
 * passes the key explicitly, `store.set(row, key)`), so each table is declared as a
 * key-path-less store. A fresh database opens in **auto-managed** mode (no fixed
 * version), creating missing declared stores on demand. Once metadata is persisted,
 * bootstrap captures the live stores and version, rejects a missing persisted store,
 * and pins the final open to that version so a competing versionchange cannot
 * silently recreate lost storage. The driver's bulk reads (`scan` / `keys`) use the
 * wrapper's native `getAll` / `getAllKeys`, and `snapshot` rolls back through one
 * atomic wrapper transaction.
 *
 * It also implements the optional native `records` / `stream` hooks:
 * `selectPlan` ({@link selectPlan}) turns the {@link QueryInput} into a
 * key-range pushdown over the primary key or a single-column secondary index,
 * fetching a candidate **superset** that the core engine (`applyQuery` /
 * `matchesQuery`) then refines — so a native read is byte-identical to a full
 * scan, just cheaper. Pushdown is conservative: only the exact-comparison
 * operators over orderable columns narrow to a range; everything else falls back
 * to a full scan + the engine.
 *
 * @remarks
 * This driver also implements `migrate` / `metadata` / `stamp`. `metadata` / `stamp`
 * persist the {@link DriverMetadata} in a reserved out-of-line store,
 * {@link METADATA_STORE} (`__metadata__`) — excluded from a whole-store `snapshot`
 * capture, since it is driver bookkeeping, not caller data. `migrate` applies a
 * {@link Migration} plan natively: IndexedDB schema DDL (creating/dropping a
 * store, creating/dropping an index) is legal only inside a versionchange
 * transaction (`onupgradeneeded`), so `migrate` closes the current connection
 * and opens a FRESH one at `version + 1` with an `upgrade` hook that walks the
 * plan's steps — dropping stores, adding/removing indexes on the raw
 * `IDBTransaction`, and rewriting rows for `column.remove` via a cursor walk
 * (the one step needing to touch existing data; `column.add` is a no-op — this
 * driver stores whatever a row carries, so there is nothing to backfill). A
 * step referencing an unknown table is validated BEFORE the reconnect, so a
 * `MIGRATION` `DatabaseError` never wastes a version bump.
 *
 * @remarks
 * This unit deliberately OMITS `aggregate` / `transaction`. There is no native
 * `aggregate` (IndexedDB has no native SUM/AVG); the engine over the narrowed
 * `records` covers it. `transaction` is impossible here: the wrapper
 * auto-commits an `IDBTransaction` when control yields outside its request
 * chain, so arbitrary callback awaits cannot remain inside one native
 * transaction. Every atomic multi-operation sequence in this driver
 * (`snapshot`'s rollback) instead runs entirely inside ONE `db.write(...)`
 * scope.
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
			// Build the new schema into a LOCAL map first — never mutate `#schema`
			// in place — so a reopen with a REDUCED schema replaces the map
			// wholesale instead of retaining ghost tables the caller no longer
			// declared.
			const bootstrap = createIndexedDBDatabase({
				name: this.#name,
				stores: { [METADATA_STORE]: {} },
			})
			let persisted: DriverMetadata | undefined
			let stores: readonly string[] = []
			let version = 0
			try {
				await bootstrap.connect()
				stores = bootstrap.stores
				version = bootstrap.version
				persisted = await this.#load(bootstrap)
			} finally {
				bootstrap.close()
			}
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
			const database = createIndexedDBDatabase({
				name: this.#name,
				...(persisted === undefined ? {} : { version }),
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

	async read(table: string, key: Key): Promise<Row | undefined> {
		try {
			return await this.#store(table).get(key)
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	async write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		const bound = bindRowKey(row, this.#table(table).primary, key)
		await this.#mutate(table, options, async (store) => {
			await store.set(bound, key)
		})
	}

	async insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		const bound = bindRowKey(row, this.#table(table).primary, key)
		await this.#mutate(table, options, async (store) => {
			await store.add(bound, key)
		})
	}

	async delete(table: string, key: Key, options?: OperationOptions): Promise<boolean> {
		let present = false
		await this.#mutate(table, options, async (store) => {
			present = await store.has(key)
			await store.remove(key)
		})
		return present
	}

	async keys(table: string): Promise<readonly Key[]> {
		try {
			const keys = await this.#store(table).keys()
			return keys.filter(isKey)
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	async *scan(table: string): AsyncIterable<Row> {
		try {
			for (const row of await this.#store(table).records()) yield row
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	async clear(table: string): Promise<void> {
		try {
			await this.#store(table).clear()
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	async records(table: string, input: QueryInput): Promise<readonly Row[]> {
		validatePage(input)
		try {
			const schema = this.#table(table)
			const store = this.#store(table)
			const plan = selectPlan(input, schema, store.indexes)
			return applyQuery(await this.#candidates(store, schema, plan), input)
		} catch (error) {
			throw this.#wrap(error)
		}
	}

	stream(table: string, input: QueryInput): AsyncIterable<Row> {
		validatePage(input)
		return this.#stream(table, input)
	}

	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		try {
			const database = this.#require()
			const requested = tables ?? [...this.#schema.keys()]
			const names = [...new Set(requested)].filter(
				(name) =>
					name !== METADATA_STORE && this.#schema.has(name) && database.stores.includes(name),
			)
			const captured = new Map<
				string,
				{
					readonly identity: object
					readonly keys: readonly IDBValidKey[]
					readonly rows: readonly Row[]
					readonly schema: TableSchema
				}
			>()
			if (names.length > 0) {
				await database.read(names, async (transaction) => {
					for (const name of names) {
						const schema = this.#schema.get(name)
						const identity = this.#identities.get(name)
						if (schema === undefined || identity === undefined) continue
						const store = transaction.store(name)
						captured.set(name, {
							identity,
							keys: await store.keys(),
							rows: await store.records(),
							schema,
						})
					}
				})
			}
			return async () => {
				try {
					const current = this.#require()
					const replacements = new Map<
						string,
						{ readonly keys: readonly Key[]; readonly rows: readonly Row[] }
					>()
					for (const [name, snapshot] of captured) {
						const schema = this.#schema.get(name)
						if (
							schema === undefined ||
							this.#identities.get(name) !== snapshot.identity ||
							!current.stores.includes(name)
						) {
							continue
						}
						const plan = planMigration([snapshot.schema], [schema])
						const migrated = migrateRows(snapshot.rows, plan.steps)
						if (
							snapshot.keys.length !== snapshot.rows.length ||
							migrated.length !== snapshot.rows.length
						) {
							throw new DatabaseError(
								'MIGRATION',
								'IndexedDB snapshot keys and rows have different cardinality',
								{ table: name },
							)
						}
						const keys: Key[] = []
						const rows: Row[] = []
						for (const [index, key] of snapshot.keys.entries()) {
							const row = migrated[index]
							if (!isKey(key) || row === undefined) {
								throw new DatabaseError(
									'MIGRATION',
									'IndexedDB snapshot row has no usable primary key',
									{ table: name, column: schema.primary, index },
								)
							}
							keys.push(key)
							rows.push(bindRowKey(row, schema.primary, key))
						}
						replacements.set(name, { keys, rows })
					}
					if (replacements.size === 0) return
					await current.write([...replacements.keys()], async (transaction) => {
						for (const [name, replacement] of replacements) {
							const store = transaction.store(name)
							await store.clear()
							for (const [index, key] of replacement.keys.entries()) {
								const row = replacement.rows[index]
								if (row === undefined || key === undefined) {
									throw new DatabaseError('DRIVER', 'IndexedDB snapshot entry is incomplete', {
										table: name,
										index,
									})
								}
								await store.set(row, key)
							}
						}
					})
				} catch (error) {
					throw this.#wrap(error)
				}
			}
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
	 * the current connection and opens a FRESH one at `version + 1`, declaring
	 * every currently-known store (plus {@link METADATA_STORE}) so nothing is lost,
	 * and applying `table.remove` / `index.add` / `index.remove` /
	 * `column.remove` inside `upgrade`. Every step's `table` is validated against
	 * the driver's own `#schema` BEFORE the reconnect — an unknown-table step
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
		// Project the post-migration shape into a LOCAL copy first — `#schema`
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

	async *#stream(table: string, input: QueryInput): AsyncIterable<Row> {
		try {
			const schema = this.#table(table)
			const store = this.#store(table)
			const plan = selectPlan(input, schema, store.indexes)
			const conditions = input.conditions ?? []
			const offset = input.offset ?? 0
			const limit = input.limit
			let skipped = 0
			let yielded = 0
			for (const row of await this.#candidates(store, schema, plan)) {
				if (limit !== undefined && yielded >= limit) break
				if (!matchesQuery(row, conditions)) continue
				if (skipped < offset) {
					skipped += 1
					continue
				}
				yielded += 1
				yield row
			}
		} catch (error) {
			throw this.#wrap(error)
		}
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
		let aborted = false
		try {
			await this.#require().write(table, async (transaction) => {
				checkAbort(signal)
				signal?.addEventListener(
					'abort',
					() => {
						if (!transaction.active) return
						try {
							transaction.abort()
							aborted = true
						} catch {}
					},
					{ once: true, signal: cleanup.signal },
				)
				checkAbort(signal)
				await scope(transaction.store(table))
			})
		} catch (error) {
			if (aborted) checkAbort(signal)
			throw this.#wrap(error)
		} finally {
			cleanup.abort()
		}
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
		let present = false
		let value: unknown
		await database.read(METADATA_STORE, async (transaction) => {
			const store = transaction.store(METADATA_STORE)
			present = await store.has('metadata')
			if (present) value = await store.get('metadata')
		})
		if (!present) return undefined
		try {
			return cloneDriverMetadata(value)
		} catch {
			const cause = new DatabaseError('VALIDATION', 'Stored IndexedDB metadata failed validation', {
				path: 'metadata',
			})
			throw new DatabaseError('DRIVER', 'Stored IndexedDB metadata is invalid', {
				name: this.#name,
				store: METADATA_STORE,
				key: 'metadata',
				cause,
			})
		}
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

	// Reconnect at the CURRENT `#schema` with no version bump (auto-managed
	// mode, mirroring `open`) — used to restore a working connection after a
	// failed `migrate` left the prior connection closed.
	async #reopen(): Promise<void> {
		const database = createIndexedDBDatabase({
			name: this.#name,
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

	// The candidate-superset read for a plan. The primary store already returns rows
	// in primary-key order — the same order `scan` yields, which `applyQuery`
	// preserves for an unordered query. A secondary index returns them in INDEX-key
	// order, so re-sort by the primary key to reproduce scan order; the engine then
	// filters / orders / pages exactly, so a native read equals the scan path.
	async #candidates(
		store: IndexedDBStoreInterface,
		schema: TableSchema,
		plan: QueryPlan,
	): Promise<readonly Row[]> {
		if (plan.index === undefined) return store.records(plan.range)
		const rows = [...(await store.index(plan.index).records(plan.range))]
		rows.sort((left, right) =>
			compareValues(extractKey(left, schema.primary), extractKey(right, schema.primary)),
		)
		return rows
	}

	#table(name: string): TableSchema {
		const schema = this.#schema.get(name)
		if (schema === undefined) {
			throw new DatabaseError('NOT_FOUND', `table '${name}' is not declared`, { table: name })
		}
		return schema
	}

	// Mirror a migration plan's steps onto a LOCAL schema map — the same
	// bookkeeping `open` does for a freshly declared schema — without touching
	// `#schema`, so a failed migrate never leaves the driver's bookkeeping ahead
	// of the real database. The caller commits the map into `#schema` only after
	// the upgrade connects successfully.
	// Runs INSIDE the wrapper's versionchange transaction (see `migrate`
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
					const store = context.stores.open(step.table)
					let cursor = await store.cursor()
					while (cursor !== null) {
						const row = cursor.value
						if (row === undefined) {
							throw new DatabaseError('MIGRATION', 'migrate: stored value is not a record', {
								table: step.table,
							})
						}
						const [migrated] = migrateRows([row], [step])
						if (migrated === undefined) {
							throw new DatabaseError('MIGRATION', 'migrate: transformed row is missing', {
								table: step.table,
							})
						}
						await cursor.update(migrated)
						cursor = await cursor.continue()
					}
					break
				}
				case 'column.add':
					break
			}
		}
		if (input.metadata !== undefined) {
			await context.stores.open(METADATA_STORE).set(
				{
					version: input.metadata.version,
					schema: input.metadata.schema,
				},
				'metadata',
			)
		}
	}
}
