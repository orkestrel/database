import type { ContractInterface, ContractShape, FieldPath, Infer, JSONSchema } from '@orkestrel/contract'
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

// === Lifecycle

/** The lifecycle state of a {@link DatabaseInterface}. */
export type DatabaseStatus = 'idle' | 'open' | 'closed'

/** A machine-readable {@link DatabaseError} code. */
export type DatabaseErrorCode = 'CLOSED' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION'

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
 * by `columnType`; `json` covers object/array/union/raw values a backend stores
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
 * A backend-agnostic description of one table — what `open` hands each driver so a
 * native backend can create real tables and indexes.
 *
 * @remarks
 * Derived by the database from its `tables` contract shapes ({@link ColumnSchema}
 * per column, via `columnType`), its `keys` (`primary`), and its `indexes` option
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
	 */
	snapshot(): Promise<() => Promise<void>>
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
 * The row type a table's {@link Columns} describe — `Infer` of its `objectShape`.
 *
 * @remarks
 * The broad `Columns` (an open `column → shape` map, e.g. when a database is held
 * at its default type) short-circuits to {@link Row}: there is nothing concrete to
 * infer, and expanding `Infer` over the open shape would trip TS's
 * instantiation-depth guard. Concrete column maps infer their exact row.
 */
export type RowOf<C extends Columns> = [Columns] extends [C]
	? Row
	: Infer<{ readonly type: 'object'; readonly properties: C }>

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
 * is the emitter's listener-error handler (§13 — a listener throw routes here).
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
	transaction<R>(scope: () => Promise<R>): Promise<R>
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
	records(criteria?: Criteria): Promise<readonly T[]>
	count(criteria?: Criteria): Promise<number>
	aggregate(
		operation: AggregateFunction,
		column: FieldPath,
		criteria?: Criteria,
	): Promise<number | undefined>
	set(row: T): Promise<Key>
	set(rows: readonly T[]): Promise<readonly Key[]>
	add(row: T): Promise<Key>
	add(rows: readonly T[]): Promise<readonly Key[]>
	update(key: Key, changes: Partial<T>): Promise<boolean>
	update(keys: readonly Key[], changes: Partial<T>): Promise<readonly boolean[]>
	remove(key: Key): Promise<boolean>
	remove(keys: readonly Key[]): Promise<readonly boolean[]>
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
