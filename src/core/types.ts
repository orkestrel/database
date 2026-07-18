import type {
	ContractInterface,
	ContractShape,
	FieldPath,
	Infer,
	JSONSchema,
} from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

// The cross-environment database surface — one ergonomic, typed API over a
// minimal storage `Driver` that an in-memory map, IndexedDB, or SQLite can each
// satisfy. The unifying idea: a table *is* a contract. A database's `tables` map
// pairs each name with its columns (a `column → ContractShape` map, the shape DSL
// in `../contracts`), which the database wraps in an `objectShape` for you; each
// table is typed by `Infer` of its columns, with validation, coercion, JSON-Schema
// introspection, and seed generation all flowing from that one declaration.
// `import` / `export` move whole schemas between databases and environments.
// Types are the source of truth (AGENTS §2).

// === Primitives

/**
 * A primary key — the value identifying a row within its table.
 *
 * @remarks
 * `string | number` is the intersection of what IndexedDB key ranges and SQL
 * primary keys both express without coercion. Auto-generated keys are UUID
 * strings; supply your own to use numeric keys.
 */
export type Key = string | number

/**
 * A caller-supplied key minting function.
 *
 * @remarks
 * Environment surfaces provide implementations (the server's `node:crypto`-backed
 * `generateKey`); the core mints no keys itself. Supplied via
 * {@link DatabaseOptions.key} and used by a table when a written row lacks its
 * primary key. Without one, writing a keyless row is a `VALIDATION` error.
 */
export type KeyFunction = () => Key

/** A table row — a plain record of column values keyed by column name. */
export type Row = Record<string, unknown>

// === Query criteria

/**
 * A WHERE operator — the comparison a single {@link Condition} applies.
 *
 * @remarks
 * Each maps to a SQL operator and an IndexedDB read strategy (a key range where
 * the bounds allow it, a scanned predicate otherwise). The set is closed to
 * comparisons expressible on both backends.
 */
export type ConditionOperator =
	| 'equals'
	| 'not'
	| 'above'
	| 'below'
	| 'from'
	| 'to'
	| 'between'
	| 'like'
	| 'glob'
	| 'starts'
	| 'ends'
	| 'any'
	| 'none'
	| 'absent'
	| 'present'

/** How a {@link Condition} joins to the running result of the conditions before it. */
export type Connector = 'and' | 'or'

/**
 * One compiled WHERE condition.
 *
 * @remarks
 * `values` carries the operands the operator needs — none for `absent` /
 * `present`, one for most, two for `between`, a list for `any` / `none`.
 * `connector` folds this condition into the accumulated result left-to-right;
 * the first condition's connector seeds the fold and is otherwise ignored.
 * `column` is a {@link FieldPath}: a single string is ONE column (never split on
 * `.`), an array descends into a nested (object/`json`) value.
 */
export interface Condition {
	readonly column: FieldPath
	readonly operator: ConditionOperator
	readonly values: readonly unknown[]
	readonly connector: Connector
}

/** A sort direction. */
export type Direction = 'ascending' | 'descending'

/** One ordering term — a column ({@link FieldPath}, flat or nested) and its direction. */
export interface Order {
	readonly column: FieldPath
	readonly direction: Direction
}

/**
 * A serializable read specification — everything a backend needs to compile one
 * read, free of JS callbacks so any backend can honor it.
 *
 * @remarks
 * The post-fetch `filter` predicate lives on {@link QueryInterface}, never here,
 * so `Criteria` stays portable across backends.
 */
export interface Criteria {
	readonly conditions?: readonly Condition[]
	readonly order?: readonly Order[]
	readonly limit?: number
	readonly offset?: number
}

/** An aggregate computed over a numeric column. */
export type AggregateFunction = 'count' | 'sum' | 'average' | 'minimum' | 'maximum'

/**
 * Options for a cancellable read / iteration operation.
 *
 * @remarks
 * When `signal` aborts, the operation throws a {@link DatabaseError} with code
 * `ABORTED` carrying `signal.reason` in `context`. `TableInterface.scan` and
 * `QueryInterface.stream` check the signal before each yield; other read
 * methods check it at entry.
 */
export interface ReadOptions {
	readonly signal?: AbortSignal
}

// === Lifecycle

/** The lifecycle state of a {@link DatabaseInterface}. */
export type DatabaseStatus = 'idle' | 'open' | 'closed'

/** A machine-readable {@link DatabaseError} code. */
export type DatabaseErrorCode =
	| 'CLOSED'
	| 'NOT_FOUND'
	| 'CONFLICT'
	| 'VALIDATION'
	| 'ABORTED'
	| 'MIGRATION'
	| 'CONFORMANCE'
	| 'DRIVER'

/**
 * One violated invariant from the driver-conformance battery.
 *
 * @remarks
 * Mirrors the payload shape of a `DatabaseError` `CONFORMANCE` `context` —
 * `check` names the invariant, `message` describes the violation, and
 * `context` carries the offending table / key / value that failed it.
 */
export interface ConformanceFinding {
	readonly check: string
	readonly message: string
	readonly context: Readonly<Record<string, unknown>>
}

/**
 * The push observation surface of a {@link DatabaseInterface} (AGENTS §13) — the
 * connection + transaction lifecycle a fire-and-forget observer (logging, metrics,
 * tracing, cache invalidation) subscribes to.
 *
 * @remarks
 * Pure signals carrying no row data — these are the database-level (not per-row)
 * moments, so a non-generic map stays lean (per-row writes are {@link TableEventMap}).
 * Listener isolation is the emitter's (AGENTS §13): every event is emitted directly and a
 * listener throw is routed to the emitter's OWN `error` handler (the `error` option), never
 * onto this domain map and never into the snapshot / commit / rollback flow — so a buggy
 * observer can never reorder, throw into, or corrupt a transaction. Every emit sits AFTER the
 * relevant transition: `commit` only after the scope succeeds, `rollback` only after every
 * table has been restored (it OBSERVES the propagated error; the original throw still
 * propagates exactly as before). Subscribe via `database.emitter.on(...)`.
 *
 * Declared as a `type` alias (not `interface extends EventMap`, §4.5 — `EventMap` is a
 * `type` kind): a type-literal satisfies the `EventMap` constraint
 * (`Record<string, readonly unknown[]>`) structurally, whereas an interface lacks the
 * required index signature.
 */
export type DatabaseEventMap = {
	/** The driver connected (`open`, or the lazy first-use connect completed). */
	readonly open: readonly []
	/** The database was closed (the driver released). */
	readonly close: readonly []
	/** A transaction scope began — the store was snapshotted, the scope is about to run. */
	readonly transaction: readonly []
	/** A transaction scope completed successfully (no rollback). */
	readonly commit: readonly []
	/** A transaction scope threw and every table was rolled back — the propagated error. */
	readonly rollback: readonly [error: unknown]
	/** A {@link Migration} plan was applied via `migrate` — the applied plan. */
	readonly migrate: readonly [migration: Migration]
}

/**
 * The push observation surface of a {@link TableInterface} (AGENTS §13) — the per-row
 * mutation moments a fire-and-forget observer (cache invalidation, sync, an audit log)
 * subscribes to, ALONGSIDE the database-level {@link DatabaseEventMap}.
 *
 * @typeParam TKey - The table's primary-key type (a {@link Key}); the events carry the
 *   affected key so the map is `TableEventMap<TKey>`.
 *
 * @remarks
 * Events carry the affected KEY only — never the row value — to keep fan-out lean and
 * avoid leaking row data through the observation channel; a consumer that needs the
 * value re-reads it by key. Any row put — `set`, `add`, or `update` — emits a single
 * `write` (the consumer re-reads if it needs to know what changed); a delete emits
 * `remove`; emptying the table emits `clear`. Reads / queries / counts are NOT emitted
 * (too hot, and a reader does not mutate). Listener isolation is the emitter's (AGENTS §13):
 * every event is emitted directly and a listener throw is routed to the emitter's `error`
 * handler (the `error` option), never onto this map, and sits AFTER the driver write / delete
 * / clear has completed — so a throwing observer can never corrupt a write or perturb a
 * transaction. Subscribe via `table.emitter.on(...)`. Declared as a `type` alias (§4.5 —
 * `EventMap` is a `type` kind).
 */
export type TableEventMap<TKey extends Key = Key> = {
	/** A row was written (set / added / updated) — the affected key (no value payload). */
	readonly write: readonly [key: TKey]
	/** A row was removed — the affected key. */
	readonly remove: readonly [key: TKey]
	/** The table was cleared (every row removed). */
	readonly clear: readonly []
}

// === Driver contract

/**
 * A portable storage type for a column — the backend maps it to its native type
 * (SQLite affinity, an IndexedDB value). Derived from a column's `ContractShape`
 * by `shapeToColumnType`; `json` covers object/array/union/raw values a backend stores
 * as JSON text and can `json_extract` for nested-field queries.
 */
export type ColumnType = 'text' | 'integer' | 'real' | 'boolean' | 'json' | 'blob'

/**
 * One column of a {@link TableSchema} — its name, portable {@link ColumnType}, and
 * whether it is nullable (its shape is `optionalShape` / `nullableShape`).
 */
export interface ColumnSchema {
	readonly name: string
	readonly type: ColumnType
	readonly nullable: boolean
}

/**
 * Persisted schema metadata a versioning driver stores verbatim and returns on
 * demand.
 *
 * @remarks
 * The driver never introspects this payload — it hands back exactly what was
 * last stamped via {@link DriverInterface.stamp}. `meta()` returning `undefined`
 * is how a fresh store is distinguished from an upgradable one: it means the
 * store has never been stamped, not that it is at version zero.
 */
export interface DriverMeta {
	readonly version: number
	readonly schema: readonly TableSchema[]
}

/**
 * A backend-agnostic description of one table — what `open` hands each driver so a
 * native backend can create real tables and indexes.
 *
 * @remarks
 * Derived by the database from its `tables` contract shapes ({@link ColumnSchema}
 * per column, via `shapeToColumnType`), its `keys` (`primary`), and its `indexes` option
 * (`indexes`, each entry one possibly-compound index of column names). A scan-only
 * backend (the reference `MemoryDriver`) ignores everything but `name`.
 */
export interface TableSchema {
	readonly name: string
	readonly primary: string
	readonly columns: readonly ColumnSchema[]
	readonly indexes: readonly (readonly string[])[]
}

/**
 * One step of a {@link Migration} plan — a single schema change applied to one
 * table.
 *
 * @remarks
 * `operation` names the axis it splits on (AGENTS §4.4): adding / removing a
 * whole table, a column, or an index. A driver's optional `migrate` applies each
 * step natively; a step referencing an unknown table throws `DatabaseError`
 * `MIGRATION`.
 */
export type MigrationStep =
	| { readonly operation: 'table.add'; readonly table: TableSchema }
	| { readonly operation: 'table.remove'; readonly table: string }
	| { readonly operation: 'column.add'; readonly table: string; readonly column: ColumnSchema }
	| { readonly operation: 'column.remove'; readonly table: string; readonly column: string }
	| { readonly operation: 'index.add'; readonly table: string; readonly index: readonly string[] }
	| {
			readonly operation: 'index.remove'
			readonly table: string
			readonly index: readonly string[]
	  }

/**
 * A schema migration plan — an ordered set of {@link MigrationStep}s moving a
 * database from one schema version to another.
 *
 * @remarks
 * `from` / `to` are the source and target schema versions; `steps` runs in
 * order. Applied natively via {@link DriverInterface.migrate} when a driver
 * implements it.
 */
export interface Migration {
	readonly from: number
	readonly to: number
	readonly steps: readonly MigrationStep[]
}

/**
 * The handle a driver's native `transaction` hook returns.
 *
 * @remarks
 * `commit` finalizes the native BEGIN; `rollback` undoes it. When a driver
 * implements {@link DriverInterface.transaction}, the engine uses this handle
 * instead of the snapshot-based rollback floor.
 */
export interface TransactionInterface {
	commit(): Promise<void>
	rollback(): Promise<void>
}

/**
 * The storage primitive every backend implements — the whole of the bridge.
 *
 * @remarks
 * The REQUIRED surface is deliberately minimal: keyed read / write / delete, an
 * ordered `scan`, a key listing, and a `snapshot` that backs transactions — the
 * irreducible primitive. There is **no** required query, count, or aggregate
 * here: all of that is one query engine in the core (`helpers.ts`) running over
 * `scan`, so a new backend implements a handful of tiny methods rather than
 * re-deriving WHERE compilation. `open` now receives a derived
 * {@link TableSchema}`[]` (columns, types, primary, indexes) so a native backend
 * can build real tables and indexes; a scan-only backend reads only `name`. The
 * optional `records?` / `count?` / `aggregate?` are native overrides the engine
 * falls back from (AGENTS §21). The API is async (Promises) because IndexedDB is; synchronous
 * backends resolve immediately. Lookups that may miss return `undefined` /
 * `false` rather than throwing (AGENTS §12).
 */
export interface DriverInterface {
	open(schema: readonly TableSchema[]): Promise<void>
	close(): Promise<void>
	read(table: string, key: Key): Promise<Row | undefined>
	write(table: string, key: Key, row: Row): Promise<void>
	delete(table: string, key: Key): Promise<boolean>
	keys(table: string): Promise<readonly Key[]>
	scan(table: string): AsyncIterable<Row>
	clear(table: string): Promise<void>
	/**
	 * Capture the current state and return a thunk that rolls every table back to
	 * it — the primitive transactions are built on (SQL `SAVEPOINT`, an IndexedDB
	 * key buffer, a cloned map).
	 *
	 * @remarks
	 * `tables` omitted captures/rolls back the WHOLE store (existing behavior).
	 * `tables` provided captures/restores ONLY the named tables — the returned
	 * rollback thunk leaves every other table untouched.
	 */
	snapshot(tables?: readonly string[]): Promise<() => Promise<void>>
	/**
	 * Optional native filtered read (AGENTS §21). A backend that can evaluate a
	 * {@link Criteria} natively (SQL `WHERE` + `ORDER`/`LIMIT`, an index range)
	 * implements this; `Table` prefers it and falls back to `applyCriteria` over
	 * `scan` when it is absent. Must honor the full criteria (filter, order, page).
	 */
	records?(table: string, criteria: Criteria): Promise<readonly Row[]>
	/**
	 * Optional native count (AGENTS §21). Counts rows matching the criteria's
	 * conditions (paging is irrelevant to a count); `Table` falls back to counting
	 * the engine-filtered `scan` when absent.
	 */
	count?(table: string, criteria: Criteria): Promise<number>
	/**
	 * Optional native aggregate (AGENTS §21). A backend that can compute an
	 * aggregate natively (SQL `COUNT`/`SUM`/`AVG`/`MIN`/`MAX`, an indexed count)
	 * implements this; `Table.aggregate` prefers it and otherwise falls back to
	 * `computeAggregate` over the native-filtered (or scanned) rows. Aggregates
	 * ignore paging, so `criteria` carries only conditions.
	 */
	aggregate?(
		table: string,
		operation: AggregateFunction,
		column: FieldPath,
		criteria: Criteria,
	): Promise<number | undefined>
	/**
	 * Optional native transaction (BEGIN). When present, the engine uses the
	 * returned {@link TransactionInterface}'s `commit` / `rollback` instead of
	 * the snapshot-based rollback floor.
	 */
	transaction?(): Promise<TransactionInterface>
	/**
	 * Optional natively filtered lazy iteration — a {@link Criteria}-aware
	 * streaming read. Drivers without it are served by the core scan fallback
	 * (filtering `scan` lazily).
	 */
	stream?(table: string, criteria: Criteria): AsyncIterable<Row>
	/**
	 * Optional native migration — applies a {@link Migration} plan directly.
	 * Throws `DatabaseError` `MIGRATION` when a step references an unknown
	 * table.
	 */
	migrate?(plan: Migration): Promise<void>
	/**
	 * Optional persisted-metadata read (PAIRED with {@link stamp} — a driver
	 * implements both or neither). Returns the {@link DriverMeta} last stamped,
	 * or `undefined` when the store has never been stamped.
	 */
	meta?(): Promise<DriverMeta | undefined>
	/**
	 * Optional persisted-metadata write (PAIRED with {@link meta} — a driver
	 * implements both or neither). Persists `meta` verbatim for a later `meta()`
	 * to return.
	 */
	stamp?(meta: DriverMeta): Promise<void>
}

// === Database

/**
 * One table's columns — a map of column name to its value {@link ContractShape}.
 *
 * @remarks
 * This is exactly the property map an `objectShape` takes. A table row is always
 * an object, so you write the columns directly (`{ id: stringShape(), … }`) and
 * the database wraps them in an `objectShape` for you — no redundant `objectShape`
 * at the table level. (Nested object *columns* still use `objectShape`, since a
 * column is not always an object.)
 */
export type Columns = Readonly<Record<string, ContractShape>>

/**
 * A database's table schema — a map of table name to its {@link Columns}.
 *
 * @remarks
 * Each table's row type is `Infer` of its columns (see {@link RowOf}); primary-key
 * columns are named separately via {@link TableKeys}.
 */
export type TablesShape = Readonly<Record<string, Columns>>

/**
 * The row type a table's {@link Columns} describe — `Infer` of the `objectShape`
 * the database wraps them in.
 *
 * @remarks
 * Contract 0.0.4's non-distributive `Infer` resolves the OPEN case (the broad
 * `Columns` — e.g. when a database is held at its default type) directly:
 * `RowOf<Columns>` and {@link Row} are mutually assignable, so no short-circuit
 * to `Row` and no `additionalProperties: false` pin are needed — `Infer` no
 * longer trips TS's instantiation-depth guard over the open shape, and the
 * inferred row matches the CLOSED object `objectShape(columns)` builds at
 * runtime (its additional-properties parameter defaults to `false`) for every
 * concrete column map.
 */
export type RowOf<C extends Columns> = Infer<{ readonly type: 'object'; readonly properties: C }>

/**
 * Per-table primary-key column overrides — `{ [table]: column }`.
 *
 * @remarks
 * A table absent from this map keys its rows by {@link DEFAULT_PRIMARY} (`id`).
 * Kept separate from {@link TablesShape} so the table map stays purely columns.
 */
export type TableKeys = Readonly<Record<string, string>>

/**
 * Per-table secondary indexes — `{ [table]: groups }`, each group one
 * (possibly compound) index of column names.
 *
 * @remarks
 * Contracts don't express indexes, so they're declared here on `createDatabase`
 * and flow into each {@link TableSchema}'s `indexes` (SQLite `CREATE INDEX`,
 * IndexedDB `createIndex`). Mirrors {@link TableKeys}.
 */
export type TableIndexes = Readonly<Record<string, readonly (readonly string[])[]>>

/**
 * Options for `createDatabase`.
 *
 * @remarks
 * `driver` is the storage backend; `tables` declares each table's columns;
 * `keys` overrides the primary-key column per table ({@link DEFAULT_PRIMARY}
 * otherwise); `indexes` declares secondary indexes per table (contracts don't
 * express them) that flow into each derived {@link TableSchema}; `name` labels
 * the database; `on` wires initial {@link DatabaseEventMap} listeners (§8); `error`
 * is the emitter's listener-error handler (§13 — a listener throw routes here);
 * `key` is the key factory a table uses when a written row lacks its primary
 * key — without one, writing a keyless row is a `VALIDATION` error (the core
 * mints no keys itself).
 */
export interface DatabaseOptions<T extends TablesShape = TablesShape> {
	readonly on?: EmitterHooks<DatabaseEventMap>
	/** The emitter's listener-error handler (AGENTS §13) — a listener throw routes here, not to a domain event. */
	readonly error?: EmitterErrorHandler
	readonly driver: DriverInterface
	readonly tables: T
	readonly keys?: TableKeys
	readonly indexes?: TableIndexes
	readonly name?: string
	readonly key?: KeyFunction
	/**
	 * The declared schema version.
	 *
	 * @remarks
	 * Only meaningful when the driver implements BOTH {@link DriverInterface.meta}
	 * and {@link DriverInterface.stamp} (a versioning driver); unset, or a
	 * non-versioning driver, leaves `open()` unchanged from today's behavior.
	 * When set and the driver versions, `open()` reconciles against the
	 * driver's persisted {@link DriverMeta}:
	 * - **Fresh store** (`meta()` returns `undefined`) — no migration is
	 *   possible (there is nothing deployed to diff against), so `open()`
	 *   simply `stamp`s `{ version, schema }` for next time.
	 * - **Stored version < `version`** — `planMigration(stored.schema, declared
	 *   schema)` computes the upgrade plan, applied via the driver's optional
	 *   `migrate` hook. If `migrate` is absent and the plan is non-empty,
	 *   `open()` throws `DatabaseError` `MIGRATION`. On success, `open()`
	 *   `stamp`s the new `{ version, schema }` and emits the `migrate` event.
	 * - **Stored version > `version`** — the store is newer than the declared
	 *   schema; `open()` throws `DatabaseError` `MIGRATION`.
	 * - **Stored version === `version`** — no-op.
	 *
	 * When the driver ALSO implements {@link DriverInterface.transaction}, the
	 * `migrate` + `stamp` pair applies atomically through that native handle
	 * (all-or-nothing, rolled back cleanly on a mid-plan failure); otherwise the
	 * pair applies sequentially, with a small documented window in which a `stamp`
	 * failure after a successful `migrate` can leave new data under old meta.
	 */
	readonly version?: number
}

/**
 * One table's portable definition, produced by `export` — the unit of schema /
 * migration exchange across environments.
 *
 * @remarks
 * `schema` is the JSON Schema (universally portable, serializable); `columns` is
 * the source column map, which re-imports losslessly via `import` within a
 * TypeScript environment. `key` is the primary-key column.
 */
export interface TableExport {
	readonly key: string
	readonly columns: Columns
	readonly schema: JSONSchema
}

/**
 * A database — the ergonomic entry point that owns the driver and its tables.
 *
 * @remarks
 * A database is a typed view over a set of tables on one driver. Tables are
 * declared up front in `createDatabase({ tables })` and reached, fully typed,
 * with `table(name)`. The driver connects lazily on first use, so a freshly
 * created database is immediately usable. `import` defines more than one table
 * from a shape map and returns a new typed view of **those** tables over the
 * same driver and storage (so views can be split by concern and still share
 * data); `export` produces a portable {@link TableExport} per table for moving a
 * schema between databases or environments. `transaction` snapshots the store,
 * runs the scope, and rolls every table back if it throws — an optimistic model
 * that works uniformly across backends rather than reconciling SQL's and
 * IndexedDB's incompatible native transactions.
 */
export interface DatabaseInterface<T extends TablesShape = TablesShape> {
	readonly emitter: EmitterInterface<DatabaseEventMap>
	readonly name: string
	readonly status: DatabaseStatus
	table<K extends keyof T & string>(name: K): TableInterface<RowOf<T[K]>>
	import<U extends TablesShape>(tables: U, keys?: TableKeys): DatabaseInterface<U>
	export(): Readonly<Record<string, TableExport>>
	open(): Promise<void>
	close(): Promise<void>
	transaction<R>(scope: () => Promise<R>, options?: ReadOptions): Promise<R>
	/**
	 * Diff a caller-supplied deployed schema against this database's declared
	 * schema (its `tables`, as configured) via `planMigration`, apply the
	 * resulting plan through the driver's optional `migrate` hook, and return
	 * the applied plan.
	 *
	 * @param deployed - The schema currently deployed, as {@link TableSchema}s
	 * @param options - Optional abort signal, checked at entry
	 * @returns The applied {@link Migration} plan
	 *
	 * @remarks
	 * Throws `DatabaseError` `MIGRATION` when the driver does not implement
	 * `migrate`, or when a step references an unknown table (propagated from
	 * the driver). Throws `ABORTED` when `options.signal` has already fired at
	 * entry. Emits the `migrate` event after a successful apply. Version
	 * TRACKING (persisting `from` / `to`) remains deferred to persistent
	 * backends — the caller owns knowing what was deployed.
	 */
	migrate(deployed: readonly TableSchema[], options?: ReadOptions): Promise<Migration>
}

// === Table

/**
 * A table — typed keyed CRUD plus fluent query and cursor access.
 *
 * @remarks
 * Writes are coerced through the table's contract: a string input to a numeric
 * column is normalized, and a row that cannot be coerced throws `VALIDATION`. A
 * row missing its key is assigned a generated UUID. `get` returns `undefined`
 * when a key is absent; `resolve` throws `NOT_FOUND`. `set` upserts; `add`
 * inserts and throws `CONFLICT` on a duplicate key. `contract` exposes the
 * compiled contract for introspection (`schema`) and fixtures (`generate`).
 *
 * The keyed methods batch by overload (AGENTS §9.2): pass one key/row for one
 * result, or an array for an array of results in the same order — a single verb,
 * never `getMany` / `setAll`. Batches run as independent sequential operations;
 * wrap them in `transaction` for atomicity.
 */
export interface TableInterface<T = Row> {
	readonly emitter: EmitterInterface<TableEventMap>
	readonly name: string
	readonly primary: string
	readonly contract: ContractInterface<T>
	get(key: Key): Promise<T | undefined>
	get(keys: readonly Key[]): Promise<readonly (T | undefined)[]>
	resolve(key: Key): Promise<T>
	resolve(keys: readonly Key[]): Promise<readonly T[]>
	has(key: Key): Promise<boolean>
	has(keys: readonly Key[]): Promise<readonly boolean[]>
	keys(): Promise<readonly Key[]>
	records(criteria?: Criteria, options?: ReadOptions): Promise<readonly T[]>
	/**
	 * Count rows matching `criteria`'s conditions.
	 *
	 * @remarks
	 * `records()` / `scan()` narrow every row through the table's contract
	 * guard before returning it, so a non-conforming stored row (legacy data,
	 * a row from before a migration) never appears in their results. `count`
	 * operates on STORED rows WITHOUT that guard — it counts whatever
	 * conditions-matches in storage, guard-conforming or not. This means
	 * `count()` CAN exceed `(await records(criteria)).length` when storage
	 * holds rows that no longer conform to the table's contract.
	 */
	count(criteria?: Criteria, options?: ReadOptions): Promise<number>
	/**
	 * Compute an aggregate over `column` across rows matching `criteria`'s
	 * conditions.
	 *
	 * @remarks
	 * Like {@link TableInterface.count}, `aggregate` operates on STORED rows
	 * WITHOUT the contract guard that `records()` / `scan()` apply — a
	 * non-conforming stored row still contributes to the aggregate (or to the
	 * `count` operation's tally) when it matches the conditions, even though
	 * it would never appear in `records()`'s output.
	 */
	aggregate(
		operation: AggregateFunction,
		column: FieldPath,
		criteria?: Criteria,
		options?: ReadOptions,
	): Promise<number | undefined>
	/**
	 * Lazy filtered iteration over the table's rows.
	 *
	 * @remarks
	 * `criteria`'s `conditions` / `offset` / `limit` are honored lazily as rows
	 * stream; `order` is intentionally IGNORED — streaming yields driver
	 * key-order, sorted output is `records()`'s job. Breaking out of the
	 * iteration early closes the underlying source. The signal (if any) is
	 * checked before each yield.
	 */
	scan(criteria?: Criteria, options?: ReadOptions): AsyncIterable<T>
	/**
	 * Upsert one or more rows.
	 *
	 * @param row - The row to upsert
	 * @param options - Optional abort signal
	 * @returns The row's key
	 */
	set(row: T, options?: ReadOptions): Promise<Key>
	/**
	 * Upsert one or more rows.
	 *
	 * @param rows - The rows to upsert
	 * @param options - Optional abort signal, checked at entry and between items
	 * @returns Each row's key, in order
	 *
	 * @remarks
	 * The signal (if any) is checked at entry and between items; an abort
	 * surfaces as `DatabaseError` `ABORTED`. Already-applied items stay
	 * applied — there is no rollback. Wrap in `transaction()` for atomicity.
	 */
	set(rows: readonly T[], options?: ReadOptions): Promise<readonly Key[]>
	/**
	 * Insert one or more rows, throwing `CONFLICT` on a duplicate key.
	 *
	 * @param row - The row to insert
	 * @param options - Optional abort signal
	 * @returns The row's key
	 */
	add(row: T, options?: ReadOptions): Promise<Key>
	/**
	 * Insert one or more rows, throwing `CONFLICT` on a duplicate key.
	 *
	 * @param rows - The rows to insert
	 * @param options - Optional abort signal, checked at entry and between items
	 * @returns Each row's key, in order
	 *
	 * @remarks
	 * The signal (if any) is checked at entry and between items; an abort
	 * surfaces as `DatabaseError` `ABORTED`. Already-applied items stay
	 * applied — there is no rollback. Wrap in `transaction()` for atomicity.
	 */
	add(rows: readonly T[], options?: ReadOptions): Promise<readonly Key[]>
	/**
	 * Apply a partial change to one or more rows.
	 *
	 * @param key - The key of the row to update
	 * @param changes - The partial changes to apply
	 * @param options - Optional abort signal
	 * @returns `true` when the row existed and was updated
	 */
	update(key: Key, changes: Partial<T>, options?: ReadOptions): Promise<boolean>
	/**
	 * Apply a partial change to one or more rows.
	 *
	 * @param keys - The keys of the rows to update
	 * @param changes - The partial changes to apply to each row
	 * @param options - Optional abort signal, checked at entry and between items
	 * @returns Each row's update result, in order
	 *
	 * @remarks
	 * The signal (if any) is checked at entry and between items; an abort
	 * surfaces as `DatabaseError` `ABORTED`. Already-applied items stay
	 * applied — there is no rollback. Wrap in `transaction()` for atomicity.
	 */
	update(
		keys: readonly Key[],
		changes: Partial<T>,
		options?: ReadOptions,
	): Promise<readonly boolean[]>
	/**
	 * Delete one or more rows.
	 *
	 * @param key - The key of the row to remove
	 * @param options - Optional abort signal
	 * @returns `true` when the row existed and was removed
	 */
	remove(key: Key, options?: ReadOptions): Promise<boolean>
	/**
	 * Delete one or more rows.
	 *
	 * @param keys - The keys of the rows to remove
	 * @param options - Optional abort signal, checked at entry and between items
	 * @returns Each row's removal result, in order
	 *
	 * @remarks
	 * The signal (if any) is checked at entry and between items; an abort
	 * surfaces as `DatabaseError` `ABORTED`. Already-applied items stay
	 * applied — there is no rollback. Wrap in `transaction()` for atomicity.
	 */
	remove(keys: readonly Key[], options?: ReadOptions): Promise<readonly boolean[]>
	clear(): Promise<void>
	query(): QueryInterface<T>
	cursor(): Promise<CursorInterface<T>>
}

// === Query

/**
 * A fluent query builder.
 *
 * @remarks
 * `where` / `and` / `or` open a {@link ClauseInterface} whose operator
 * closes the condition and returns the query. `filter` adds a post-fetch JS
 * predicate (applied after the backend read, before paging). The terminals
 * (`all` / `first` / `count` / the aggregates) execute against the table; each
 * call mutates and returns the same builder, so a chain reads as one statement.
 * Every `column` is a {@link FieldPath} — a string is one column, an array
 * descends a nested value.
 */
export interface QueryInterface<T = Row> {
	where(column: FieldPath): ClauseInterface<T>
	and(column: FieldPath): ClauseInterface<T>
	or(column: FieldPath): ClauseInterface<T>
	filter(predicate: (row: T) => boolean): QueryInterface<T>
	ascending(column: FieldPath): QueryInterface<T>
	descending(column: FieldPath): QueryInterface<T>
	limit(count: number): QueryInterface<T>
	offset(count: number): QueryInterface<T>
	all(): Promise<readonly T[]>
	first(): Promise<T | undefined>
	count(): Promise<number>
	/**
	 * Lazy per-row evaluation of this query's conditions / filters / offset /
	 * limit.
	 *
	 * @remarks
	 * `order` and its comparators are IGNORED (streaming yields unsorted, as
	 * rows are evaluated one at a time). Same abort semantics as
	 * {@link TableInterface.scan}: the signal (if any) is checked before each
	 * yield, and breaking out early closes the underlying source.
	 */
	stream(options?: ReadOptions): AsyncIterable<T>
	sum(column: FieldPath): Promise<number | undefined>
	average(column: FieldPath): Promise<number | undefined>
	minimum(column: FieldPath): Promise<number | undefined>
	maximum(column: FieldPath): Promise<number | undefined>
	aggregate(operation: AggregateFunction, column: FieldPath): Promise<number | undefined>
}

/**
 * A pending condition opened by `where` / `and` / `or`.
 *
 * @remarks
 * Each operator records its condition against the query and returns the query,
 * so the chain continues fluently. `absent` / `present` take no operand;
 * `between` takes two; `any` / `none` take a list.
 */
export interface ClauseInterface<T = Row> {
	equals(value: unknown): QueryInterface<T>
	not(value: unknown): QueryInterface<T>
	above(value: unknown): QueryInterface<T>
	below(value: unknown): QueryInterface<T>
	from(value: unknown): QueryInterface<T>
	to(value: unknown): QueryInterface<T>
	between(lower: unknown, upper: unknown): QueryInterface<T>
	like(pattern: string): QueryInterface<T>
	glob(pattern: string): QueryInterface<T>
	starts(prefix: string): QueryInterface<T>
	ends(suffix: string): QueryInterface<T>
	any(values: readonly unknown[]): QueryInterface<T>
	none(values: readonly unknown[]): QueryInterface<T>
	absent(): QueryInterface<T>
	present(): QueryInterface<T>
}

// === Cursor

/**
 * A forward row cursor for bulk in-place mutation.
 *
 * @remarks
 * Iterates a snapshot of the table's keys taken at creation; `update` and
 * `remove` act on the row at the current position through the owning table.
 * `done` is `true` once iteration has advanced past the last key.
 */
export interface CursorInterface<T = Row> {
	readonly value: T | undefined
	readonly index: number
	readonly done: boolean
	next(): Promise<void>
	update(changes: Partial<T>): Promise<void>
	remove(): Promise<void>
	close(): void
}
