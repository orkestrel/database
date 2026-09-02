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
// Types are the source of truth: implementation and tests conform to this file.

// === Primitives

/**
 * A primary key — the value identifying a row within its table.
 *
 * @remarks
 * `string | number` is the intersection of what IndexedDB key ranges and SQL
 * primary keys both express without coercion. The default generated key is a
 * UUID string; configure a custom generator for numeric primary keys.
 */
export type Key = string | number

/**
 * A key-generating function.
 *
 * @remarks
 * Supplied through {@link DatabaseOptions.generator} as an authoritative
 * override when an application needs a non-UUID key or controlled generation.
 * When omitted, a keyless write uses the global `crypto.randomUUID()`. Numeric
 * primary keys therefore require a custom generator.
 */
export type KeyFunction = () => Key

/** A table row — a plain record of column values keyed by column name. */
export type Row = Record<string, unknown>

// === Query input

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
export type ConditionConnector = 'and' | 'or'

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
	readonly connector: ConditionConnector
}

/** A sort direction. */
export type OrderDirection = 'ascending' | 'descending'

/** One ordering term — a column ({@link FieldPath}, flat or nested) and its direction. */
export interface Order {
	readonly column: FieldPath
	readonly direction: OrderDirection
}

/**
 * A serializable read specification — everything a backend needs to compile one
 * read, free of JS callbacks so any backend can honor it.
 *
 * @remarks
 * The post-fetch `filter` predicate lives on {@link QueryInterface}, never here,
 * so `QueryInput` stays portable across backends. When present, `limit` and
 * `offset` must be finite nonnegative integers. Zero is valid: `limit: 0`
 * selects an empty page and `offset: 0` skips nothing.
 */
export interface QueryInput {
	readonly conditions?: readonly Condition[]
	readonly order?: readonly Order[]
	readonly limit?: number
	readonly offset?: number
}

/** An aggregate computed over a numeric column. */
export type AggregateOperation = 'count' | 'sum' | 'average' | 'minimum' | 'maximum'

/**
 * Options for an abortable operation.
 *
 * @remarks
 * When `signal` aborts, the operation throws a {@link DatabaseError} with code
 * `ABORTED` carrying `signal.reason` in `context`. Reads check at their
 * documented boundaries; point mutations propagate the signal through the
 * driver to the backend commit point.
 */
export interface OperationOptions {
	readonly signal?: AbortSignal
}

// === Lifecycle

/** The lifecycle state of a {@link DatabaseInterface}. */
export type DatabaseStatus = 'idle' | 'open' | 'closed'

/**
 * The admission boundary a scoped operation enters before it runs.
 *
 * @remarks
 * The one contract the root database context and a transaction scope both
 * expose: `accepting` reports whether the boundary still admits work, and
 * `track` enters an operation into the boundary's ledger so whoever stops the
 * boundary can contain everything already accepted. A streamed read enters each
 * continuation independently through the same pair, so an idle iterator never
 * pins the boundary open.
 */
export interface AdmissionInterface {
	readonly accepting: boolean
	track<R>(operation: () => Promise<R>): Promise<R>
}

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
 * The push observation surface of a {@link DatabaseInterface} — the
 * connection + transaction lifecycle a fire-and-forget observer (logging, metrics,
 * tracing, cache invalidation) subscribes to.
 *
 * @remarks
 * Pure signals carrying no row data — these are the database-level (not per-row)
 * moments, so a non-generic map stays lean (per-row writes are {@link TableEventMap}).
 * Listener isolation is the emitter's: every event is emitted directly and a
 * listener throw is routed to the emitter's OWN `error` handler (the `error` option), never
 * onto this domain map and never into the snapshot / commit / rollback flow — so a buggy
 * observer can never reorder, throw into, or corrupt a transaction. Every emit sits AFTER the
 * relevant transition: `commit` only after the scope succeeds, `rollback` only after the
 * rollback operation completes (it OBSERVES the propagated scope error; that exact reason
 * still propagates). A rollback failure propagates instead and emits no misleading
 * `rollback` event. Subscribe via `database.emitter.on(...)`.
 *
 * Declared as a `type` alias (not `interface extends EventMap` — `EventMap` is a
 * `type` kind): a type-literal satisfies the `EventMap` constraint
 * (`Record<string, readonly unknown[]>`) structurally, whereas an interface lacks the
 * required index signature.
 */
export type DatabaseEventMap = {
	/** The driver connected (`open`, or the lazy first-use connect completed). */
	readonly open: readonly []
	/** The database was closed (the driver released). */
	readonly close: readonly []
	/** A transaction scope began after its native boundary or fallback snapshot was acquired. */
	readonly transaction: readonly []
	/** A transaction scope completed successfully (no rollback). */
	readonly commit: readonly []
	/** A transaction scope failed and rollback completed — the exact propagated scope error. */
	readonly rollback: readonly [error: unknown]
	/** A {@link Migration} plan was applied via `migrate` — the applied plan. */
	readonly migrate: readonly [migration: Migration]
}

/**
 * The push observation surface of a {@link TableInterface} — the per-row
 * mutation moments a fire-and-forget observer (cache invalidation, sync, an audit log)
 * subscribes to, ALONGSIDE the database-level {@link DatabaseEventMap}.
 *
 * @remarks
 * Events carry the affected KEY only — never the row value — to keep fan-out lean and
 * avoid leaking row data through the observation channel; a consumer that needs the
 * value re-reads it by key. Any row put — `set`, `add`, or `update` — emits a single
 * `write` (the consumer re-reads if it needs to know what changed); a delete emits
 * `remove`; emptying the table emits `clear`. Reads / queries / counts are NOT emitted
 * (too hot, and a reader does not mutate). Listener isolation is the emitter's:
 * every event is emitted directly and a listener throw is routed to the emitter's `error`
 * handler (the `error` option), never onto this map, and sits AFTER the driver write / delete
 * / clear has completed — so a throwing observer can never corrupt a write or perturb a
 * transaction. Subscribe via `table.emitter.on(...)`. Declared as a `type` alias (
 * `EventMap` is a `type` kind).
 */
export type TableEventMap = {
	/** A row was written (set / added / updated) — the affected key (no value payload). */
	readonly write: readonly [key: Key]
	/** A row was removed — the affected key. */
	readonly remove: readonly [key: Key]
	/** The table was cleared (every row removed). */
	readonly clear: readonly []
}

// === Driver contract

/**
 * A portable storage type for a column — the backend maps it to its native type
 * (SQLite affinity, an IndexedDB value). Derived from a column's `ContractShape`
 * by `shapeToColumnStorage`; `json` covers object/array/union/raw values a backend stores
 * as JSON text and can `json_extract` for nested-field queries.
 */
export type ColumnStorage = 'text' | 'integer' | 'real' | 'boolean' | 'json' | 'blob'

/**
 * One column of a {@link TableSchema} — its name, portable {@link ColumnStorage}, and
 * whether it independently accepts absence (`optional`) and explicit `null`
 * (`nullable`).
 */
export interface ColumnSchema {
	readonly name: string
	readonly storage: ColumnStorage
	readonly optional: boolean
	readonly nullable: boolean
}

/**
 * Persisted schema metadata a versioning driver owns as an immutable snapshot.
 *
 * @remarks
 * A driver snapshots metadata when it enters through `stamp` or a
 * {@link MigrationInput}, so later caller mutation cannot alter stored version
 * state. `metadata()` returns a distinct deeply frozen owned snapshot, never the
 * driver's internal reference. `undefined` distinguishes a fresh store from an
 * upgradable one: it means the store has never been stamped, not that it is at
 * version zero.
 */
export interface DriverMetadata {
	readonly version: number
	readonly schema: readonly TableSchema[]
}

/**
 * A backend-agnostic description of one table — what `open` hands each driver so a
 * native backend can create real tables and indexes.
 *
 * @remarks
 * Derived by the database from its `tables` contract shapes ({@link ColumnSchema}
 * per column, via `shapeToColumnStorage`), its `primary`, and its `indexes` option
 * (`indexes`, each entry one possibly-compound index of column names). A scan-only
 * backend (the reference `MemoryDriver`) ignores everything but `name`.
 */
export interface TableSchema {
	readonly name: string
	readonly primary: string
	readonly columns: readonly ColumnSchema[]
	readonly indexes: ReadonlyArray<readonly string[]>
}

/**
 * One step of a {@link Migration} plan — a single schema change applied to one
 * table.
 *
 * @remarks
 * `operation` names the axis it splits on: adding / removing a
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
 * One atomic migration request.
 *
 * @remarks
 * `plan` carries the schema changes. `metadata`, when present, is the snapshot that
 * must settle in the same atomic unit as those changes so a failed migration
 * cannot expose a new schema under stale version metadata.
 */
export interface MigrationInput {
	readonly plan: Migration
	readonly metadata?: DriverMetadata
}

/**
 * The storage operations available only inside a driver's transaction scope.
 *
 * @remarks
 * A driver owns acquisition, commit or rollback, release, and lifetime. This
 * capability exposes storage work only: it has no public `commit` / `rollback`,
 * cannot start a nested transaction, and throws `CONFLICT` after its scope
 * settles. Optional native read and migration hooks mirror the owning driver;
 * callers fall back to `scan` when a native read hook is absent.
 */
export interface StorageInterface {
	read(table: string, key: Key): Promise<Row | undefined>
	write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	delete(table: string, key: Key, options?: OperationOptions): Promise<boolean>
	keys(table: string): Promise<readonly Key[]>
	scan(table: string): AsyncIterable<Row>
	clear(table: string): Promise<void>
	records?(table: string, input: QueryInput): Promise<readonly Row[]>
	aggregate?(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined>
	stream?(table: string, input: QueryInput): AsyncIterable<Row>
	migrate?(input: MigrationInput): Promise<void>
	metadata?(): Promise<DriverMetadata | undefined>
	stamp?(metadata: DriverMetadata): Promise<void>
}

/**
 * The storage primitive every backend implements — the whole of the bridge.
 *
 * @remarks
 * The REQUIRED surface is deliberately minimal: keyed read / write / atomic
 * insert / delete, an ordered `scan`, a key listing, and a `snapshot` that
 * backs transactions — the irreducible primitive. There is **no** required
 * query, count, or aggregate here: all of that is one query engine in the core
 * (`helpers.ts`) running over `scan`, so a new backend implements a handful of
 * tiny methods rather than re-deriving WHERE compilation. `open` receives a
 * derived {@link TableSchema}`[]` (columns, types, primary, indexes) so a
 * native backend can build real tables and indexes; a scan-only backend reads
 * only `name`. The optional `records?` / `aggregate?` are native overrides the
 * engine falls back from. The API is async (Promises) because IndexedDB is;
 * synchronous backends resolve immediately. Lookups that may miss return
 * `undefined` / `false` rather than throwing. Metadata has the same ownership
 * boundary across every implementation: `stamp` and `migrate` snapshot
 * {@link DriverMetadata} at entry, while `metadata` returns a distinct deeply
 * frozen snapshot. A durable driver returns `undefined` only when it proves the
 * metadata record or durable store is absent. Existing unreadable or malformed
 * durable state fails `open` / `metadata` closed; it is never treated as fresh,
 * rewritten, or repaired automatically.
 */
export interface DriverInterface extends StorageInterface {
	open(schema: readonly TableSchema[]): Promise<void>
	close(): Promise<void>
	/**
	 * Capture table rows and return a repeatable thunk that restores those rows —
	 * the primitive transactions are built on.
	 *
	 * @remarks
	 * Snapshots are row-only: they never restore schema or driver metadata.
	 * `tables` omitted captures every current table. `tables` provided captures
	 * only existing named tables. Rollback skips captured tables removed since
	 * capture and leaves every uncaptured or later-added table untouched.
	 */
	snapshot(tables?: readonly string[]): Promise<() => Promise<void>>
	/**
	 * Optional native transaction scope. The driver owns acquisition, commit or
	 * rollback, release, and invalidation of the scoped capability.
	 */
	transaction?<R>(scope: (storage: StorageInterface) => Promise<R>): Promise<R>
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
export type ColumnMap = Readonly<Record<string, ContractShape>>

/**
 * A database's table schema — a map of table name to its {@link ColumnMap}.
 *
 * @remarks
 * Each table's row type is `Infer` of its columns (see {@link RowOf}); primary-key
 * columns are named separately via {@link PrimaryMap}.
 */
export type TableMap = Readonly<Record<string, ColumnMap>>

/**
 * The row type a table's {@link ColumnMap} describe — `Infer` of the `objectShape`
 * the database wraps them in.
 *
 * @remarks
 * Contract 0.0.4's non-distributive `Infer` resolves the OPEN case (the broad
 * `ColumnMap` — e.g. when a database is held at its default type) directly:
 * `RowOf<ColumnMap>` and {@link Row} are mutually assignable, so no short-circuit
 * to `Row` and no `additionalProperties: false` pin are needed — `Infer` no
 * longer trips TS's instantiation-depth guard over the open shape, and the
 * inferred row matches the CLOSED object `objectShape(columns)` builds at
 * runtime (its additional-properties parameter defaults to `false`) for every
 * concrete column map.
 */
export type RowOf<C extends ColumnMap> = Infer<{
	readonly type: 'object'
	readonly properties: C
}>

/**
 * Per-table primary-key column overrides — `{ [table]: column }`.
 *
 * @remarks
 * A table absent from this map keys its rows by {@link DEFAULT_PRIMARY} (`id`).
 * Kept separate from {@link TableMap} so the table map stays purely columns.
 */
export type PrimaryMap = Readonly<Record<string, string>>

/**
 * Per-table secondary indexes — `{ [table]: groups }`, each group one
 * (possibly compound) index of column names.
 *
 * @remarks
 * Contracts don't express indexes, so they're declared here on `createDatabase`
 * and flow into each {@link TableSchema}'s `indexes` (SQLite `CREATE INDEX`,
 * IndexedDB `createIndex`). Mirrors {@link PrimaryMap}.
 */
export type IndexMap = Readonly<Record<string, ReadonlyArray<readonly string[]>>>

/**
 * Options for `createDatabase`.
 *
 * @remarks
 * `driver` is the storage backend; `tables` declares each table's columns;
 * `primary` overrides the primary-key column per table ({@link DEFAULT_PRIMARY}
 * otherwise); `indexes` declares secondary indexes per table (contracts don't
 * express them) that flow into each derived {@link TableSchema}; `name` labels
 * the database; `on` wires initial {@link DatabaseEventMap} listeners; `error`
 * is the emitter's listener-error handler (a listener throw routes here);
 * `generator` is the authoritative key-generation override a table uses when a
 * written row's primary is exactly `undefined`. When omitted, the table uses
 * global `crypto.randomUUID()`; numeric primary keys require a custom generator.
 */
export interface DatabaseOptions<T extends TableMap = TableMap> {
	readonly on?: EmitterHooks<DatabaseEventMap>
	/**
	 * The listener-error handler shared by the database and every table emitter.
	 *
	 * @remarks
	 * Listener throws from root, imported, and transaction-scoped handles route
	 * here as `(error, event)`, never to a domain event and never into the
	 * completed operation.
	 */
	readonly error?: EmitterErrorHandler
	readonly driver: DriverInterface
	readonly tables: T
	readonly primary?: PrimaryMap
	readonly indexes?: IndexMap
	readonly name?: string
	/**
	 * The authoritative key-generation override for a keyless write.
	 *
	 * @remarks
	 * Omit it to use global `crypto.randomUUID()`. A numeric primary requires a
	 * custom generator. Explicit primary values never invoke this function. A
	 * custom generator throw is `VALIDATION`; a host `crypto.randomUUID()` failure
	 * is `DRIVER`. An invalid returned key is `VALIDATION`; neither branch falls
	 * back or retries.
	 */
	readonly generator?: KeyFunction
	/**
	 * The declared schema version.
	 *
	 * @remarks
	 * Only meaningful when the driver implements BOTH {@link DriverInterface.metadata}
	 * and {@link DriverInterface.stamp} (a versioning driver); unset, or a
	 * non-versioning driver, leaves `open()` unchanged from today's behavior.
	 * When set and the driver versions, `open()` reconciles against the driver's
	 * persisted {@link DriverMetadata}:
	 * - **Fresh store** (`metadata()` returns `undefined` after the durable
	 *   driver proves absence) — no migration is possible (there is nothing
	 *   deployed to diff against), so `open()` stamps `{ version, schema }` for
	 *   next time.
	 * - **Stored version < `version`** — `planMigration(stored.schema, declared
	 *   schema)` computes the upgrade plan, applied via the driver's optional
	 *   `migrate` hook. If `migrate` is absent and the plan is non-empty,
	 *   `open()` throws `DatabaseError` `MIGRATION`. On success, `open()`
	 *   `stamp`s the new `{ version, schema }` and emits the `migrate` event.
	 * - **Stored version > `version`** — the store is newer than the declared
	 *   schema; `open()` throws `DatabaseError` `MIGRATION`.
	 * - **Stored version === `version`** — the persisted and declared schemas
	 *   must still match. Schema drift throws `DatabaseError` `MIGRATION`;
	 *   otherwise `open()` is a no-op.
	 *
	 * A non-empty version upgrade passes both the plan and target metadata to
	 * {@link DriverInterface.migrate} as one {@link MigrationInput}; the driver
	 * settles both atomically. A zero-step version transition may use `stamp`
	 * directly because no schema or rows change.
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
 * TypeScript environment. `primary` is the primary-key column.
 */
export interface TableDefinition {
	readonly primary: string
	readonly columns: ColumnMap
	readonly schema: JSONSchema
}

/**
 * A database view valid only inside one {@link DatabaseInterface.transaction}
 * scope.
 *
 * @remarks
 * The view exposes only declared tables backed by the driver's scoped
 * {@link StorageInterface}. It cannot open, close, import, migrate, or nest
 * a transaction. The view and every table captured from it throw `CONFLICT`
 * after the scope settles.
 */
export interface DatabaseStorageInterface<T extends TableMap = TableMap> {
	table<K extends keyof T & string>(name: K): TableInterface<RowOf<T[K]>>
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
 * data); `export` produces a portable {@link TableDefinition} per table for moving a
 * schema between databases or environments. `transaction` runs a table-only
 * scoped callback through a native driver transaction when available, otherwise
 * through the universal whole-store snapshot floor.
 */
export interface DatabaseInterface<T extends TableMap = TableMap> {
	readonly emitter: EmitterInterface<DatabaseEventMap>
	readonly name: string
	readonly status: DatabaseStatus
	table<K extends keyof T & string>(name: K): TableInterface<RowOf<T[K]>>
	import<U extends TableMap>(tables: U, primary?: PrimaryMap): DatabaseInterface<U>
	export(): Readonly<Record<string, TableDefinition>>
	open(): Promise<void>
	close(): Promise<void>
	transaction<R>(
		scope: (transaction: DatabaseStorageInterface<T>) => Promise<R>,
		options?: OperationOptions,
	): Promise<R>
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
	 * entry. For explicit `migrate`, driver open and migration apply form one
	 * readiness transition: status and the `open` event publish only after apply
	 * succeeds. A failed explicit apply blocks ordinary open/table work with that
	 * exact failure until a later explicit `migrate` succeeds; `close` remains
	 * available. Automatic versioned open has a separate lifecycle: successful
	 * physical driver open publishes `open` status and one `open` event before
	 * reconciliation. If reconciliation fails, its readiness Promise and table
	 * work reject until a later automatic retry succeeds on the same physical
	 * handle. Emits the `migrate` event after a successful apply. Explicit
	 * migration still accepts the caller's deployed schema; versioned open uses
	 * {@link DatabaseOptions.version} with a driver's paired `metadata` / `stamp`
	 * capabilities to persist and reconcile deployed version metadata.
	 */
	migrate(deployed: readonly TableSchema[], options?: OperationOptions): Promise<Migration>
}

// === Table

/**
 * A table — typed keyed CRUD plus fluent query and cursor access.
 *
 * @remarks
 * Writes are coerced through the table's contract: a string input to a numeric
 * column is normalized, and a row that cannot be coerced throws `VALIDATION`. A
 * row whose primary is `undefined` receives a generated key. `get` returns `undefined`
 * when a key is absent; `resolve` throws `NOT_FOUND`. `set` upserts; `add`
 * inserts and throws `CONFLICT` on a duplicate key. `contract` exposes the
 * compiled contract for introspection (`schema`) and fixtures (`generate`).
 *
 * The keyed methods batch by overload: pass one key/row for one
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
	get(keys: readonly Key[]): Promise<ReadonlyArray<T | undefined>>
	resolve(key: Key): Promise<T>
	resolve(keys: readonly Key[]): Promise<readonly T[]>
	has(key: Key): Promise<boolean>
	has(keys: readonly Key[]): Promise<readonly boolean[]>
	keys(): Promise<readonly Key[]>
	records(input?: QueryInput, options?: OperationOptions): Promise<readonly T[]>
	/**
	 * Count contract-valid rows matching `input`'s conditions.
	 *
	 * @remarks
	 * Paging is ignored. Like `records()` / `scan()`, `count()` narrows every
	 * candidate through the table contract, so a non-conforming stored row does
	 * not consume the count.
	 */
	count(input?: QueryInput, options?: OperationOptions): Promise<number>
	/**
	 * Compute an aggregate over `column` across rows matching `input`'s
	 * conditions.
	 *
	 * @remarks
	 * Unlike {@link TableInterface.count}, `aggregate` operates on STORED rows
	 * without the contract guard that `records()` / `scan()` apply — a
	 * non-conforming stored row still contributes to the aggregate (or to the
	 * `count` operation's tally) when it matches the conditions, even though
	 * it would never appear in `records()`'s output.
	 */
	aggregate(
		operation: AggregateOperation,
		column: FieldPath,
		input?: QueryInput,
		options?: OperationOptions,
	): Promise<number | undefined>
	/**
	 * Lazy filtered iteration over the table's rows.
	 *
	 * @remarks
	 * `input`'s `conditions` / `offset` / `limit` are honored lazily as rows
	 * stream; `order` is intentionally IGNORED — streaming yields driver
	 * key-order, sorted output is `records()`'s job. Breaking out of the
	 * iteration early closes the underlying source. The signal (if any) is
	 * checked before each yield.
	 */
	scan(input?: QueryInput, options?: OperationOptions): AsyncIterable<T>
	/**
	 * Upsert one or more rows.
	 *
	 * @param row - The row to upsert
	 * @param options - Optional abort signal
	 * @returns The row's key
	 */
	set(row: T, options?: OperationOptions): Promise<Key>
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
	set(rows: readonly T[], options?: OperationOptions): Promise<readonly Key[]>
	/**
	 * Insert one or more rows, throwing `CONFLICT` on a duplicate key.
	 *
	 * @param row - The row to insert
	 * @param options - Optional abort signal
	 * @returns The row's key
	 */
	add(row: T, options?: OperationOptions): Promise<Key>
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
	add(rows: readonly T[], options?: OperationOptions): Promise<readonly Key[]>
	/**
	 * Apply a partial change to one or more rows.
	 *
	 * @param key - The key of the row to update
	 * @param changes - The partial changes to apply
	 * @param options - Optional abort signal
	 * @returns `true` when the row existed and was updated
	 */
	update(key: Key, changes: Partial<T>, options?: OperationOptions): Promise<boolean>
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
		options?: OperationOptions,
	): Promise<readonly boolean[]>
	/**
	 * Delete one or more rows.
	 *
	 * @param key - The key of the row to remove
	 * @param options - Optional abort signal
	 * @returns `true` when the row existed and was removed
	 */
	remove(key: Key, options?: OperationOptions): Promise<boolean>
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
	remove(keys: readonly Key[], options?: OperationOptions): Promise<readonly boolean[]>
	clear(): Promise<void>
	query(): QueryInterface<T>
	cursor(): Promise<CursorInterface<T>>
}

// === Query

/**
 * A fluent query builder.
 *
 * @remarks
 * `condition` appends one portable condition and `order` appends one portable
 * ordering term. `filter` adds a post-fetch JavaScript predicate (applied after
 * the backend read, before paging). The terminals (`collect` / `find` / `count`
 * / `aggregate`) execute against the table; each call mutates and returns the
 * same builder, so a chain reads as one statement. Every `column` is a
 * {@link FieldPath} — a string is one column, an array descends a nested value.
 */
export interface QueryInterface<T = Row> {
	condition(input: Condition): QueryInterface<T>
	order(input: Order): QueryInterface<T>
	filter(predicate: (row: T) => boolean): QueryInterface<T>
	limit(count: number): QueryInterface<T>
	offset(count: number): QueryInterface<T>
	collect(): Promise<readonly T[]>
	find(): Promise<T | undefined>
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
	stream(options?: OperationOptions): AsyncIterable<T>
	aggregate(operation: AggregateOperation, column: FieldPath): Promise<number | undefined>
}

// === Cursor

/**
 * A forward row cursor for bulk in-place mutation.
 *
 * @remarks
 * Iterates a snapshot of the table's keys taken at creation; `update` and
 * `remove` act on the row at the current position through the owning table.
 * Promise operations execute serially in invocation order, and one rejection
 * does not prevent later admitted work. `done` is `true` once iteration has
 * advanced past the last key. `close` is synchronous and terminal: it clears
 * the current value, queued work becomes a no-op, and in-flight work never
 * republishes a value after settling.
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
