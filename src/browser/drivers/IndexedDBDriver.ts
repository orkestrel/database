import type {
	Criteria,
	DriverInterface,
	DriverMeta,
	Key,
	Migration,
	MigrationStep,
	Row,
	TableSchema,
} from '@src/core'
import {
	applyCriteria,
	compareValues,
	DatabaseError,
	extractKey,
	isDriverMeta,
	matchesCriteria,
	migrateRows,
} from '@src/core'
import type {
	IndexedDBDatabaseInterface,
	IndexedDBStoreInterface,
	IndexedDBUpgradeContext,
	StoreDefinition,
} from '@orkestrel/indexeddb'
import { createIndexedDBDatabase } from '@orkestrel/indexeddb'
import type { QueryPlan } from '../types.js'
import { selectPlan } from '../helpers.js'
import { META_STORE } from '../constants.js'

/**
 * The IndexedDB {@link DriverInterface} — the persistent browser backend, built on
 * the published `@orkestrel/indexeddb` wrapper.
 *
 * @remarks
 * A thin adapter: it implements the storage primitives the core database layer
 * needs (`open` / `close` / `read` / `write` / `delete` / `keys` / `scan` / `clear`
 * / `snapshot`) by delegating to the wrapper's typed store operations — it never
 * touches raw IndexedDB. Rows are stored with **out-of-line keys** (the database
 * passes the key explicitly, `store.set(row, key)`), so each table is declared as a
 * key-path-less store. The wrapper opens in **auto-managed** mode (no fixed
 * version), creating any missing store on demand, so a table added to the schema is
 * created on the next open with no manual version bump. The driver's bulk reads
 * (`scan` / `keys`) use the wrapper's native `getAll` / `getAllKeys`, and `snapshot`
 * rolls back through one atomic wrapper transaction.
 *
 * It also implements the optional native `records` / `count` / `stream` hooks
 * (AGENTS §21): `selectPlan` ({@link selectPlan}) turns the {@link Criteria} into a
 * key-range pushdown over the primary key or a single-column secondary index,
 * fetching a candidate **superset** that the core engine (`applyCriteria` /
 * `matchesCriteria`) then refines — so a native read is byte-identical to a full
 * scan, just cheaper. Pushdown is conservative: only the exact-comparison
 * operators over orderable columns narrow to a range; everything else falls back
 * to a full scan + the engine.
 *
 * @remarks
 * This driver also implements `migrate` / `meta` / `stamp`. `meta` / `stamp`
 * persist the {@link DriverMeta} in a reserved out-of-line store,
 * {@link META_STORE} (`__meta__`) — excluded from a whole-store `snapshot`
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
 * `records` covers it. `transaction` is impossible here: the wrapper auto-commits
 * an `IDBTransaction` the moment control yields to a non-IDB `await`, so a
 * BEGIN-now / commit-or-rollback-later handle spanning arbitrary caller code
 * cannot be built on top of it — every atomic multi-op sequence in this driver
 * (`snapshot`'s rollback) instead runs entirely inside ONE `db.write(...)` scope.
 */
export class IndexedDBDriver implements DriverInterface {
	readonly #name: string
	#schema = new Map<string, TableSchema>()
	#database: IndexedDBDatabaseInterface | undefined

	constructor(name: string) {
		this.#name = name
	}

	async open(schema: readonly TableSchema[]): Promise<void> {
		// Reconnect cleanly so an auto-managed version bump (to create new stores) is
		// never blocked by this driver's own open handle.
		this.#database?.close()
		// Build the new schema into a LOCAL map first — never mutate `#schema` in
		// place — so a reopen with a REDUCED schema replaces the map wholesale
		// instead of retaining ghost tables the caller no longer declared.
		const map = new Map<string, TableSchema>()
		for (const table of schema) map.set(table.name, table)
		const database = createIndexedDBDatabase({ name: this.#name, stores: this.#stores(map) })
		await database.connect()
		this.#database = database
		// Remember the schema so the native `records` / `count` / `stream` hooks
		// can plan a key-range pushdown (the primary key, column types, secondary
		// indexes).
		this.#schema = map
	}

	async close(): Promise<void> {
		this.#database?.close()
		this.#database = undefined
	}

	async read(table: string, key: Key): Promise<Row | undefined> {
		return this.#store(table).get(key)
	}

	async write(table: string, key: Key, row: Row): Promise<void> {
		await this.#store(table).set(row, key)
	}

	async delete(table: string, key: Key): Promise<boolean> {
		const store = this.#store(table)
		const present = await store.has(key)
		await store.remove(key)
		return present
	}

	async keys(table: string): Promise<readonly Key[]> {
		const keys = await this.#store(table).keys()
		return keys.filter((key): key is Key => typeof key === 'string' || typeof key === 'number')
	}

	async *scan(table: string): AsyncIterable<Row> {
		for (const row of await this.#store(table).records()) yield row
	}

	async clear(table: string): Promise<void> {
		await this.#store(table).clear()
	}

	async records(table: string, criteria: Criteria): Promise<readonly Row[]> {
		const schema = this.#table(table)
		const store = this.#store(table)
		const plan = selectPlan(criteria, schema, store.indexes)
		return applyCriteria(await this.#candidates(store, schema, plan), criteria)
	}

	async count(table: string, criteria: Criteria): Promise<number> {
		const schema = this.#table(table)
		const store = this.#store(table)
		const conditions = criteria.conditions ?? []
		if (conditions.length === 0) return store.count()
		const plan = selectPlan(criteria, schema, store.indexes)
		// A single pushable condition is fully expressed by its range → native count.
		if (conditions.length === 1 && plan.range !== null) {
			return plan.index === null
				? store.count(plan.range)
				: store.index(plan.index).count(plan.range)
		}
		// Otherwise the range is a superset (or a full scan) → engine filters exactly.
		// Order is irrelevant to a count, so the candidates need no re-sort.
		const candidates =
			plan.index === null
				? await store.records(plan.range)
				: await store.index(plan.index).records(plan.range)
		return candidates.reduce(
			(total, row) => (matchesCriteria(row, conditions) ? total + 1 : total),
			0,
		)
	}

	async *stream(table: string, criteria: Criteria): AsyncIterable<Row> {
		const schema = this.#table(table)
		const store = this.#store(table)
		const plan = selectPlan(criteria, schema, store.indexes)
		const conditions = criteria.conditions ?? []
		const offset = criteria.offset ?? 0
		const limit = criteria.limit
		let skipped = 0
		let yielded = 0
		for (const row of await this.#candidates(store, schema, plan)) {
			if (limit !== undefined && yielded >= limit) break
			if (!matchesCriteria(row, conditions)) continue
			if (skipped < offset) {
				skipped += 1
				continue
			}
			yielded += 1
			yield row
		}
	}

	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		const database = this.#require()
		// A whole-store capture excludes the reserved meta store — it is driver
		// bookkeeping, not caller data, and rolling it back would undo a `stamp`
		// unrelated to the caller's snapshot scope. An explicit `tables` list is
		// caller-scoped already and passes through untouched.
		const names = tables ?? database.stores.filter((name) => name !== META_STORE)
		const captured = new Map<
			string,
			{ readonly keys: readonly IDBValidKey[]; readonly rows: readonly Row[] }
		>()
		for (const name of names) {
			const store = database.store(name)
			captured.set(name, { keys: await store.keys(), rows: await store.records() })
		}
		return async () => {
			const current = this.#require()
			const restorable = names.filter((name) => current.stores.includes(name))
			if (restorable.length === 0) return
			// Restore every captured store in one transaction, so a rollback is atomic.
			await current.write(restorable, async (transaction) => {
				for (const name of restorable) {
					const snapshot = captured.get(name)
					if (snapshot === undefined) continue
					const store = transaction.store(name)
					await store.clear()
					for (let index = 0; index < snapshot.keys.length; index += 1) {
						await store.set(snapshot.rows[index], snapshot.keys[index])
					}
				}
			})
		}
	}

	/**
	 * Return the persisted {@link DriverMeta}, or `undefined` when the store has
	 * never been stamped.
	 *
	 * @remarks
	 * Reads `'meta'` from the reserved {@link META_STORE}, narrowing the
	 * structured-clone value with the core {@link isDriverMeta} guard (never
	 * asserted, AGENTS §14) — a missing or malformed record returns `undefined`,
	 * exactly like a fresh, never-stamped store.
	 *
	 * @returns The last-stamped {@link DriverMeta}, or `undefined`
	 */
	async meta(): Promise<DriverMeta | undefined> {
		const record = await this.#require().store(META_STORE).get('meta')
		if (!isDriverMeta(record)) return undefined
		return record
	}

	/**
	 * Persist `meta` verbatim for a later `meta()` to return.
	 *
	 * @param meta - The {@link DriverMeta} to persist
	 */
	async stamp(meta: DriverMeta): Promise<void> {
		await this.#require()
			.store(META_STORE)
			.set({ ...meta }, 'meta')
	}

	/**
	 * Apply a {@link Migration} plan by reconnecting at a bumped version and
	 * running the plan's steps inside the wrapper's `upgrade` hook.
	 *
	 * @remarks
	 * IndexedDB schema DDL is legal only inside `onupgradeneeded`, so this closes
	 * the current connection and opens a FRESH one at `version + 1`, declaring
	 * every currently-known store (plus {@link META_STORE}) so nothing is lost,
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
	 * @param plan - The migration plan to apply
	 */
	async migrate(plan: Migration): Promise<void> {
		for (const step of plan.steps) {
			if (step.operation !== 'table.add' && !this.#schema.has(step.table)) {
				throw new DatabaseError('MIGRATION', `migrate: unknown table '${step.table}'`, {
					table: step.table,
				})
			}
		}
		const current = this.#require()
		const version = current.version
		// Project the post-migration shape into a LOCAL copy first — `#schema`
		// stays untouched until the upgrade actually commits, so a mid-upgrade
		// failure never leaves the driver's bookkeeping ahead of the real database.
		const schema = new Map(this.#schema)
		this.#applySteps(schema, plan.steps)
		current.close()
		try {
			const database = createIndexedDBDatabase({
				name: this.#name,
				version: version + 1,
				stores: this.#stores(schema),
				upgrade: (context) => this.#upgrade(context, plan.steps),
			})
			await database.connect()
			// Only on success: adopt the connection AND commit the local map.
			this.#database = database
			this.#schema = schema
		} catch (error) {
			// The old connection was closed to allow the versionchange attempt;
			// reconnect at the PRE-migration schema/version so the driver is left
			// usable, with `#schema` (and the real database) unchanged.
			await this.#reopen()
			throw error
		}
	}

	// === Private

	#require(): IndexedDBDatabaseInterface {
		if (this.#database === undefined) {
			throw new DatabaseError('CLOSED', `IndexedDB database '${this.#name}' is not open`, {
				name: this.#name,
			})
		}
		return this.#database
	}

	#store(table: string) {
		return this.#require().store(table)
	}

	// Project a schema map into the wrapper's declared-stores shape — the
	// reserved meta store is always declared alongside every table, out-of-line
	// (keys are passed explicitly), with the declared secondary indexes becoming
	// each store's `createIndex` definitions. Shared by `open`, `migrate`, and
	// `#reopen` so the projection never drifts between them.
	#stores(schema: ReadonlyMap<string, TableSchema>): Record<string, StoreDefinition> {
		const stores: Record<string, StoreDefinition> = { [META_STORE]: {} }
		for (const table of schema.values()) {
			stores[table.name] = {
				indexes: table.indexes.map((columns) => ({
					name: columns.join('_'),
					path: columns.length === 1 ? columns[0] : [...columns],
				})),
			}
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
		await database.connect()
		this.#database = database
	}

	// The candidate-superset read for a plan. The primary store already returns rows
	// in primary-key order — the same order `scan` yields, which `applyCriteria`
	// preserves for an unordered query. A secondary index returns them in INDEX-key
	// order, so re-sort by the primary key to reproduce scan order; the engine then
	// filters / orders / pages exactly, so a native read equals the scan path.
	async #candidates(
		store: IndexedDBStoreInterface,
		schema: TableSchema,
		plan: QueryPlan,
	): Promise<readonly Row[]> {
		if (plan.index === null) return store.records(plan.range)
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
	#applySteps(schema: Map<string, TableSchema>, steps: readonly MigrationStep[]): void {
		// Deep-equal two index-column-group arrays (order-sensitive: an index over
		// `[a, b]` is not the same index as `[b, a]`) — mirrors planMigration's own
		// local `sameIndex` (src/core/helpers.ts).
		const sameIndex = (left: readonly string[], right: readonly string[]): boolean =>
			left.length === right.length && left.every((column, position) => column === right[position])
		for (const step of steps) {
			switch (step.operation) {
				case 'table.add':
					if (!schema.has(step.table.name)) schema.set(step.table.name, step.table)
					break
				case 'table.remove':
					schema.delete(step.table)
					break
				case 'column.add': {
					const table = schema.get(step.table)
					if (
						table !== undefined &&
						!table.columns.some((column) => column.name === step.column.name)
					) {
						schema.set(step.table, { ...table, columns: [...table.columns, step.column] })
					}
					break
				}
				case 'column.remove': {
					const table = schema.get(step.table)
					if (table !== undefined) {
						schema.set(step.table, {
							...table,
							columns: table.columns.filter((column) => column.name !== step.column),
						})
					}
					break
				}
				case 'index.add': {
					const table = schema.get(step.table)
					if (table !== undefined) {
						schema.set(step.table, { ...table, indexes: [...table.indexes, step.index] })
					}
					break
				}
				case 'index.remove': {
					const table = schema.get(step.table)
					if (table !== undefined) {
						schema.set(step.table, {
							...table,
							indexes: table.indexes.filter((index) => !sameIndex(index, step.index)),
						})
					}
					break
				}
			}
		}
	}

	// Runs INSIDE the wrapper's versionchange transaction (see `migrate`
	// @remarks). `table.add` / `column.add` are no-ops here — see `migrate`
	// @remarks for why. `column.remove` is the one step touching existing rows:
	// it walks a live cursor and rewrites each row through the core
	// `migrateRows`, updating in place — the only IDB-await-only work permitted
	// inside an upgrade transaction.
	async #upgrade(context: IndexedDBUpgradeContext, steps: readonly MigrationStep[]): Promise<void> {
		for (const step of steps) {
			switch (step.operation) {
				case 'table.remove':
					context.drop(step.table)
					break
				case 'index.add': {
					const name = step.index.join('_')
					const path = step.index.length === 1 ? step.index[0] : [...step.index]
					context.transaction.objectStore(step.table).createIndex(name, path)
					break
				}
				case 'index.remove':
					context.transaction.objectStore(step.table).deleteIndex(step.index.join('_'))
					break
				case 'column.remove': {
					const store = context.store(step.table)
					let cursor = await store.cursor()
					while (cursor !== null) {
						const [migrated] = migrateRows([cursor.value], [step])
						await cursor.update(migrated)
						cursor = await cursor.continue()
					}
					break
				}
				case 'table.add':
				case 'column.add':
					break
			}
		}
	}
}
