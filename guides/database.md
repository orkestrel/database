# Database

> One typed database API that runs unchanged on top of an in-memory map or a
> persistent JSON file — keyed rows, a fluent query builder, cursors, and
> whole-store transactions. The unifying idea is that **a table is a
> contract**: you declare a `tables` map of [`ContractShape`](contract.md)s,
> and the row type, write-time coercion + validation, JSON-Schema
> introspection, and seed data all flow from that one declaration — no
> separate schema, no annotations, no `as`.
>
> The design stance is **one engine, thin drivers**. A backend implements only
> an irreducible storage primitive — keyed read/write/insert/delete, an ordered
> `scan`, key listing, and a `snapshot` — and inherits the entire WHERE /
> order / page / aggregate surface from a single pure query engine in the
> core. A backend that _can_ go faster (SQL `WHERE`, an index range)
> implements optional native hooks the engine falls back from; it never
> re-derives query semantics. So this is deliberately **not** an ORM and not
> a query abstraction layer: there is no entity graph, no migration runner,
> and no raw-SQL escape hatch — just the smallest cross-environment core that
> earns its keep. Source: [`src/core`](../src/core). Published through
> `@orkestrel/database`; two persistent drivers ship alongside it — a trusted-mode
> **SQLite** driver in [`src/server`](../src/server) (surfaced through
> `@orkestrel/database/server`) with native querying, paging, aggregation, transactions, and
> atomic migration, and a narrow-then-refine **IndexedDB** driver in
> [`src/browser`](../src/browser) (surfaced through `@orkestrel/database/browser`) that
> pushes a key-range candidate set down to the index and lets the core engine
> refine it to the exact result — plus the original I/O-free `MemoryDriver`
> and file-persisted `JSONDriver`.

## Surface

Declare a `tables` shape map (keys are table names) once, and reach each
table — fully typed, no annotations — with `table(name)`:

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(), // any DriverInterface — a persistent backend swaps in, same API
	tables: {
		users: { id: stringShape(), name: stringShape(), age: integerShape() },
		posts: { slug: stringShape(), title: stringShape() },
	},
	primary: { posts: 'slug' }, // non-`id` primary-key columns, per table
})

const users = db.table('users') // hold the handle; TableInterface<{ id; name; age }>

await users.set({ id: 'u1', name: 'Ada', age: 36 }) // coerced + validated through the contract
await users.get('u1') // typed { id; name; age } | undefined — narrowed, never `as`
await users
	.query()
	.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
	.order({ column: 'age', direction: 'descending' })
	.collect() // typed rows
```

Each `tables` value is a column map (a `column → shape` map) — a table row is
always an object, so the database wraps it in an `objectShape` for you; you
never write `objectShape` at the table level. The row type is `Infer` of
those columns, so `db.table('users')` is checked against the schema (a
typo'd column name or a wrong-typed write fails at compile time) and returns
a `TableInterface` typed by that row. That one declaration is the single
source of truth: it types the table, drives write coercion + validation,
produces the JSON Schema, and seeds fixtures.

### Factories

| API                     | Kind     | Summary                                                                                   |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `createDatabase`        | function | Create a `DatabaseInterface` over a driver and a `tables` shape map.                      |
| `createMemoryDriver`    | function | Create the in-memory reference `DriverInterface` (nested maps, no I/O).                   |
| `createJSONDriver`      | function | Create a persistent JSON-file `DriverInterface` for a given path.                         |
| `createSQLiteDriver`    | function | Create a trusted-mode, server-native SQLite `DriverInterface` for a path (or `:memory:`). |
| `createIndexedDBDriver` | function | Create a persistent IndexedDB `DriverInterface` for a browser database name.              |

### Entities

| Class             | Kind  | Role                                                                                                                                                                        |
| ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Database`        | class | Owns the driver and a `tables` map, lazily connects, `import`s / `export`s, runs `transaction`s.                                                                            |
| `MemoryDriver`    | class | The reference driver — nested maps; runs the same in a browser or on a server.                                                                                              |
| `JSONDriver`      | class | A persistent driver — the reference `MemoryDriver` plus JSON-file load / flush.                                                                                             |
| `SQLiteDriver`    | class | A persistent, trusted-mode driver — native querying/paging/aggregation, real transactions, atomic DDL migration, `_metadata`-table versioning.                              |
| `IndexedDBDriver` | class | A persistent browser driver — narrow-then-refine querying via key-range pushdown, versionchange migration, `__metadata__`-store versioning; no `transaction` / `aggregate`. |

### Server

| API                          | Kind      | Summary                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `METADATA_TABLE`             | const     | The reserved single-row table name (`_metadata`) `SQLiteDriver` stamps its `DriverMetadata` into — a user table named `_metadata` collides with it.                                                                                                                                                                                                                                        |
| `matchesConditionExactly`    | function  | Whether one `Condition` is provably SQL-vs-engine identical. `absent`/`present` refine only when a column is both optional and nullable; every scalar condition refines when it is optional or nullable. Otherwise equality and `starts`/`ends` are exact over supported scalar storage, while ranges exclude `text` because SQLite code-point order differs from JavaScript UTF-16 order. |
| `matchesOrderExactly`        | function  | Whether one `Order` term is provably exact — only a required, non-null, flat `integer`/`real`/`boolean` column qualifies; optional, nullable, text, and nested terms refine.                                                                                                                                                                                                               |
| `matchesQueryExactly`        | function  | Whether every condition and order term in a `QueryInput` is exact — the gate `SQLiteDriver` checks before trusting a native SQL path over a full-scan refine.                                                                                                                                                                                                                              |
| `matchesDeclaredStorage`     | function  | Whether an operand's runtime type matches a column's declared exact type (text↔string, integer/real↔finite number, boolean↔boolean) — backs `matchesConditionExactly`.                                                                                                                                                                                                                     |
| `EXACT_COLUMN_STORAGE`       | const     | The declared `ColumnStorage`s whose SQL EQUALITY / `starts`/`ends` comparisons are provably engine-exact under declared-type trust (`text` / `integer` / `real` / `boolean`).                                                                                                                                                                                                              |
| `EXACT_RANGE_COLUMN_STORAGE` | const     | The declared `ColumnStorage`s whose SQL RANGE comparisons and `ORDER BY` are provably engine-exact (`integer` / `real` / `boolean` — `text` is excluded; see `matchesConditionExactly`).                                                                                                                                                                                                   |
| `extractValues`              | function  | Extract a `SQLiteRow`'s values in declared positional binding order; throws a typed `DRIVER` error when a requested column is missing.                                                                                                                                                                                                                                                     |
| `deriveSQLiteIndexName`      | function  | Derive a collision-free, length-prefixed SQL index name from a table and its column list (`idx_<len>_<table>_<len>_<col>…`) — used by `schemaToIndexes` and `stepToSQL`.                                                                                                                                                                                                                   |
| `SQLiteDriverOptions`        | interface | `{ path?, readonly?, timeout?, references?, pragmas? }` — the options bag `createSQLiteDriver` accepts; `references` toggles foreign-key enforcement.                                                                                                                                                                                                                                      |

### SQL compilation

Pure, server-only functions that turn a core `QueryInput` / `TableSchema` into
parameterized SQL text — the native-query payoff for a SQLite-backed driver.
None of these import a SQLite package; they speak strings and values only.

| API                       | Kind     | Summary                                                                                                                                  |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `escapeLike`              | function | Escape `\` / `%` / `_` so a `starts` / `ends` operand matches literally under `LIKE … ESCAPE '\'`.                                       |
| `findColumnStorage`       | function | The declared `ColumnStorage` of a flat column, read from the schema.                                                                     |
| `inferValueStorage`       | function | The `ColumnStorage` a nested (`json_extract`) operand encodes as, derived from its runtime value.                                        |
| `compileJSONTypeSQL`      | function | Compile a nested `FieldPath` to its `json_type(<col>, <path>)` SQL expression — disambiguates a present JSON `null` from an absent path. |
| `compileConditionSQL`     | function | Compile one `Condition` to its parameterized SQL fragment plus bound values.                                                             |
| `compileWhere`            | function | Fold conditions into one `WHERE …` clause, parenthesized left-to-right to match the engine's fold.                                       |
| `compileOrder`            | function | Compile the `ORDER BY …` clause, always ending with the primary key as tie-breaker.                                                      |
| `compilePage`             | function | Compile the `LIMIT` / `OFFSET` clause.                                                                                                   |
| `compileQuerySQL`         | function | Compile a `QueryInput` into the full SQL clause (`WHERE` + `ORDER BY` + `LIMIT`) plus bound parameters.                                  |
| `quoteIdentifier`         | function | Quote a SQL identifier (table / column name), doubling an embedded quote.                                                                |
| `compileFieldSQL`         | function | Compile a `FieldPath` to the SQL expression that reads it (a column, or a `json_extract` path).                                          |
| `compileColumnSQL`        | function | Map a portable `ColumnStorage` to its SQLite column type keyword.                                                                        |
| `compileAggregateSQL`     | function | Compile an `AggregateOperation` over a `FieldPath` to its SQL aggregate expression.                                                      |
| `matchesAggregateExactly` | function | Test whether SQLite can execute one aggregate with the core engine's exact semantics.                                                    |
| `matchesSQLiteAffinity`   | function | Test a native declared SQLite type against one portable `ColumnStorage` affinity.                                                        |
| `matchesAbsentPath`       | function | Whether a caught filesystem error reports that nothing is there to read.                                                                 |
| `encodeValue`             | function | Encode a JS value to its stored `SQLiteValue` for a column's type — total, never throws.                                                 |
| `decodeValue`             | function | Decode a stored `SQLiteValue` back to its JS value — the exact inverse of `encodeValue`.                                                 |
| `encodeRow`               | function | Encode a whole `Row` to a `SQLiteRow` by its table's schema.                                                                             |
| `decodeRow`               | function | Decode a stored `SQLiteRow` back to a `Row` by its table's schema (absent columns omitted).                                              |
| `schemaToTable`           | function | Project a `TableSchema` to its `CREATE TABLE IF NOT EXISTS` statement.                                                                   |
| `schemaToIndexes`         | function | Project a `TableSchema` to its `CREATE INDEX IF NOT EXISTS` statements.                                                                  |
| `stepToSQL`               | function | Project one `MigrationStep` to the DDL statement(s) `SQLiteDriver.migrate` executes for it.                                              |

### Browser

Pure functions behind the IndexedDB driver's key-range pushdown planner — a
candidate SUPERSET the core engine then refines to the exact result, never
lossy.

| API                        | Kind      | Summary                                                                                                                                                       |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectPlan`               | function  | Plan an IndexedDB read for a `QueryInput` — pick the index (or primary store) and `IDBKeyRange` to narrow by, falling back to a full scan.                    |
| `conditionToRange`         | function  | The `IDBKeyRange` one `Condition` maps to when its operator is an exact key comparison over a scalar operand, else `undefined`.                               |
| `INDEXABLE_STORAGE`        | const     | The `ColumnStorage`s that are valid, orderable IndexedDB keys (`text` / `integer` / `real`).                                                                  |
| `METADATA_STORE`           | const     | The reserved out-of-line store name (`__metadata__`) `IndexedDBDriver` stamps its `DriverMetadata` into — a user table named `__metadata__` collides with it. |
| `QueryPlan`                | interface | `{ index?, range? }` — the optional index and `IDBKeyRange`; an empty object selects a full store scan.                                                       |
| `mapIndexedDBError`        | function  | Map a backend `IndexedDBError` fault to its `DatabaseError` equivalent — no raw wrapper error crosses `IndexedDBDriver`'s `DriverInterface` surface.          |
| `mapMigrationError`        | function  | Map a backend `IndexedDBError` fault from `migrate`'s versionchange path to its `DatabaseError` equivalent (remaps `UPGRADE` to `MIGRATION`).                 |
| `deriveIndexedDBIndexName` | function  | Derive an IndexedDB index name from a column list — a single column is the bare name, a compound list is length-prefixed (`'2#1:a1:b'`-style).                |
| `schemaToStore`            | function  | Project a `TableSchema` to the IndexedDB store definition used by an ordered versionchange migration.                                                         |

### Errors

| API               | Kind     | Summary                                                                                                                                  |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DatabaseError`   | class    | Carries a `DatabaseErrorCode` (`CLOSED` / `NOT_FOUND` / `CONFLICT` / `VALIDATION` / `ABORTED` / `MIGRATION` / `CONFORMANCE` / `DRIVER`). |
| `isDatabaseError` | function | Narrow an unknown caught value to a `DatabaseError`.                                                                                     |

### Query engine

The portable semantics every backend shares — pure, total functions the
driver never re-implements.

| Helper                 | Kind     | Behavior                                                                                                     |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `compareValues`        | function | Total ordering over arbitrary values (`undefined` < `null` < boolean < number < string) — never `NaN`.       |
| `matchesCondition`     | function | Evaluate one `Condition` against a row (the per-operator predicate); a type mismatch is a non-match.         |
| `matchesQuery`         | function | Fold a row through conditions, joining each by its `ConditionConnector` left-to-right.                       |
| `sortRows`             | function | Sort rows by an `Order` list, leaving the input untouched.                                                   |
| `applyQuery`           | function | The portable read pipeline — filter, then sort, then page.                                                   |
| `validatePage`         | function | Validate present `limit` and `offset` as finite nonnegative integers; checks `limit` first and accepts zero. |
| `computeAggregate`     | function | `count` / `sum` / `average` / `minimum` / `maximum` over a column (coerces via `parseNumber`).               |
| `extractKey`           | function | Read a row's primary key from a column when it is a usable `Key`.                                            |
| `bindRowKey`           | function | Return an owned row with its resolved primary key bound to the declared primary column.                      |
| `shapeToColumnSchema`  | function | Project a named `ContractShape` to its complete portable `ColumnSchema`.                                     |
| `shapeToColumnStorage` | function | Map a column's `ContractShape` to its portable `ColumnStorage` — the schema `open` hands a driver.           |
| `filterRows`           | function | Filter rows by a condition list — the shared basis behind a table's count and aggregate paths.               |
| `equalsValue`          | function | Structural equality by SameValueZero leaves — arrays by index, records by own enumerable keys.               |

### Abort

| API          | Kind     | Behavior                                                                                                                                                                      |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkAbort` | function | Throw an `ABORTED` `DatabaseError` (carrying `signal.reason`) when an `AbortSignal` has fired; a no-op otherwise — checked at operation boundaries and between streamed rows. |

### Migrations

Caller-driven schema migration — a pure structural diff plus a pure row
transform. Versioning drivers persist reconciliation metadata through the paired
`metadata` / `stamp` hooks.

| API                      | Kind     | Behavior                                                                                                                                             |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planMigration`          | function | Structurally diff a deployed and a declared `TableSchema[]` into a `Migration` plan of ordered steps.                                                |
| `migrateRows`            | function | Apply one table's `MigrationStep`s to its rows — a pure transform (`column.remove` drops the field; other operations are storage-shape no-ops here). |
| `projectMigrationSchema` | function | Project an ordered migration plan onto an owned portable schema snapshot.                                                                            |
| `normalizeDriverSchema`  | function | Canonicalize and deeply freeze a driver schema, ignoring table/column/index-list order while preserving compound-index column order.                 |

### Conformance

| API              | Kind     | Behavior                                                                                                                                                                    |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conformDriver`  | function | Run the framework-agnostic driver-conformance battery against a fresh `DriverInterface` per phase — throws a `CONFORMANCE` `DatabaseError` on the first violated invariant. |
| `driverFindings` | function | Lazy `AsyncIterable` over the same battery, one phase per yield (17 phases) — a fresh factory-minted driver per phase; an unexpected phase crash is captured as a finding.  |
| `auditDriver`    | function | Drain `driverFindings` to completion and collect every violation — `[]` means the driver is fully conformant.                                                               |

### Helpers & guards

Pure helpers behind the query engine's pattern matching.

| API                      | Kind     | Behavior                                                                                                                                                                                                                   |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloneDriverMetadata`    | function | Own and validate unknown metadata as a deeply frozen `DriverMetadata`; malformed or hostile input throws `VALIDATION` at `context.path === 'metadata'`, never a raw Contract or caller error.                              |
| `matchesFuzzy`           | function | Match a case-folded query as an ordered, possibly non-contiguous subsequence of a candidate; an empty query matches every candidate.                                                                                       |
| `matchesWildcardPattern` | function | Match a value against a wildcard pattern in LINEAR time (greedy two-pointer, no backtracking) — the ReDoS-safe engine; injected `any` run + `single` char + case-fold flag; throws `VALIDATION` over `MAX_PATTERN_LENGTH`. |
| `matchesLikePattern`     | function | Match a value against a SQL `LIKE` pattern via `matchesWildcardPattern` (case-INSENSITIVE; `%` → any run, `_` → any char).                                                                                                 |
| `matchesGlobPattern`     | function | Match a value against a `GLOB` pattern via `matchesWildcardPattern` (case-SENSITIVE; `*` → any run, `?` → any char).                                                                                                       |
| `isDriverMetadata`       | function | Guard a value as a well-formed `DriverMetadata` (`{ version, schema }`) — the boundary check every versioning driver's `metadata()` narrows a stored/deserialized record through, never `as`.                              |
| `isDriverSchema`         | function | Total guard for a readonly collection of portable table schemas.                                                                                                                                                           |
| `isColumnSchema`         | function | Total guard for one portable column schema.                                                                                                                                                                                |
| `isTableSchema`          | function | Total guard for one portable table schema.                                                                                                                                                                                 |
| `isMigrationStep`        | function | Total guard for one ordered migration step.                                                                                                                                                                                |
| `isMigration`            | function | Total guard for an ordered migration plan.                                                                                                                                                                                 |
| `isMigrationInput`       | function | Total guard for a plan plus optional metadata.                                                                                                                                                                             |
| `isKey`                  | function | Whether a value is a usable database key (`string` or finite `number`).                                                                                                                                                    |
| `cloneDriverSchema`      | function | Clone, validate, and deeply freeze an owned table-schema collection.                                                                                                                                                       |
| `cloneMigrationInput`    | function | Clone, validate, and deeply freeze an atomic migration input.                                                                                                                                                              |

### Constants

| Constant             | Kind  | Value                                                                                                                                                     |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_PRIMARY`    | const | The primary-key column assumed when a table has no `primary` override (`id`).                                                                             |
| `MAX_PATTERN_LENGTH` | const | The longest `LIKE` / `GLOB` pattern `matchesWildcardPattern` accepts before a `VALIDATION` throw — the ReDoS length bound (§6.5) on model-supplied input. |

### Types

| Type                       | Kind      | Shape                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Key`                      | type      | `string \| number` — a primary key.                                                                                                                                                                                                                                                                                              |
| `KeyFunction`              | type      | `() => Key` — a caller-supplied key minting function, supplied via `DatabaseOptions.generator`.                                                                                                                                                                                                                                  |
| `Row`                      | type      | `Record<string, unknown>` — a table row.                                                                                                                                                                                                                                                                                         |
| `ConditionOperator`        | type      | The 15 WHERE operators (`equals`, `above`, `between`, `like`, `any`, `absent`, …).                                                                                                                                                                                                                                               |
| `ConditionConnector`       | type      | `'and' \| 'or'` — how a condition joins the running result.                                                                                                                                                                                                                                                                      |
| `Condition`                | interface | `{ column, operator, values, connector }` — one compiled WHERE condition.                                                                                                                                                                                                                                                        |
| `OrderDirection`           | type      | `'ascending' \| 'descending'`.                                                                                                                                                                                                                                                                                                   |
| `Order`                    | interface | `{ column, direction }` — one ordering term.                                                                                                                                                                                                                                                                                     |
| `QueryInput`               | interface | `{ conditions?, order?, limit?, offset? }` — a serializable read spec; present `limit` / `offset` values are finite nonnegative integers and zero is legal.                                                                                                                                                                      |
| `AggregateOperation`       | type      | `'count' \| 'sum' \| 'average' \| 'minimum' \| 'maximum'`.                                                                                                                                                                                                                                                                       |
| `OperationOptions`         | interface | `{ signal? }` — options for an abortable operation; point mutations propagate the signal through the driver to the backend commit point, while `scan` / `stream` check before each yield.                                                                                                                                        |
| `DatabaseStatus`           | type      | `'idle' \| 'open' \| 'closed'`.                                                                                                                                                                                                                                                                                                  |
| `DatabaseErrorCode`        | type      | `'CLOSED' \| 'NOT_FOUND' \| 'CONFLICT' \| 'VALIDATION' \| 'ABORTED' \| 'MIGRATION' \| 'CONFORMANCE' \| 'DRIVER'`.                                                                                                                                                                                                                |
| `ConformanceFinding`       | interface | `{ check, message, context }` — one violated invariant yielded by `driverFindings` / collected by `auditDriver`.                                                                                                                                                                                                                 |
| `DatabaseEventMap`         | type      | The database's push observation surface (§13) — `open` · `close` · `transaction` · `commit` · `rollback(error)` · `migrate(migration)`.                                                                                                                                                                                          |
| `TableEventMap`            | type      | A table's push observation surface (§13) — `write(key)` · `remove(key)` · `clear` (key only, no value).                                                                                                                                                                                                                          |
| `ColumnMap`                | type      | `Readonly<Record<string, ContractShape>>` — one table's `column → shape` map (an `objectShape`'s properties).                                                                                                                                                                                                                    |
| `TableMap`                 | type      | `Readonly<Record<string, ColumnMap>>` — a database's table → columns map.                                                                                                                                                                                                                                                        |
| `RowOf`                    | type      | `RowOf<C>` — the row type a `ColumnMap` map describes (`Infer` of its `objectShape`).                                                                                                                                                                                                                                            |
| `PrimaryMap`               | type      | `Readonly<Record<string, string>>` — per-table primary-key column overrides.                                                                                                                                                                                                                                                     |
| `IndexMap`                 | type      | `Readonly<Record<string, readonly (readonly string[])[]>>` — per-table secondary indexes (column-name groups).                                                                                                                                                                                                                   |
| `ColumnStorage`            | type      | `'text' \| 'integer' \| 'real' \| 'boolean' \| 'json' \| 'blob'` — a column's portable storage type.                                                                                                                                                                                                                             |
| `ColumnSchema`             | interface | `{ name, storage, optional, nullable }` — one column of a `TableSchema`.                                                                                                                                                                                                                                                         |
| `TableSchema`              | interface | `{ name, primary, columns, indexes }` — a backend-agnostic table description `open` hands a driver.                                                                                                                                                                                                                              |
| `MigrationStep`            | type      | A discriminated union of one schema change: `table.add` / `table.remove` / `column.add` / `column.remove` / `index.add` / `index.remove`, each naming its `table`.                                                                                                                                                               |
| `Migration`                | interface | `{ from, to, steps }` — an ordered schema migration plan moving a database from one version to another.                                                                                                                                                                                                                          |
| `MigrationInput`           | interface | `{ plan, metadata? }` — one atomic driver migration input: schema steps and optional target metadata publish or roll back together.                                                                                                                                                                                              |
| `StorageInterface`         | interface | The storage capability passed to a driver's native `transaction` scope: required `read` / `write` / atomic `insert` / `delete` / `keys` / `scan` / `clear`, plus optional native query, stream, migration, and metadata operations; no public settlement methods.                                                                |
| `DriverMetadata`           | interface | `{ version, schema }` — persisted schema metadata snapshotted at `stamp` / migration ingress; `metadata()` returns `undefined` until first stamp, then a distinct deeply frozen owned snapshot.                                                                                                                                  |
| `DriverInterface`          | interface | Lifecycle plus required keyed storage/scan/snapshot, optional native query/transaction/migration, and paired `metadata` / `stamp`; metadata snapshots on write and returns as a deeply frozen copy.                                                                                                                              |
| `DatabaseOptions`          | interface | `{ on?, error?, driver, tables, primary?, indexes?, name?, generator?, version? }` — input to `createDatabase` (`on?` wires initial `DatabaseEventMap` listeners, `generator?` supplies a key for a keyless write, and `version?` opts into open-time schema reconciliation against a versioning driver's `metadata` / `stamp`). |
| `CompiledSQL`              | interface | `{ sql, parameters }` — a parameterized SQL fragment or statement plus its bind values, produced by the `compilers.ts` functions.                                                                                                                                                                                                |
| `TableDefinition`          | interface | `{ primary, columns, schema }` — one table's portable definition, produced by `export`.                                                                                                                                                                                                                                          |
| `DatabaseStorageInterface` | interface | A transaction-lifetime table view: `table`; no connection, import, migration, or nesting methods.                                                                                                                                                                                                                                |
| `DatabaseInterface`        | interface | `emitter` / `name` / `status` / `table` / `import` / `export` / `open` / `close` / `transaction` (passes a `DatabaseStorageInterface` and takes an optional `OperationOptions`) / `migrate` (diffs a deployed schema against the declared one and applies it, taking an optional `OperationOptions`).                            |
| `TableInterface`           | interface | `emitter` / `name` / `primary` / `contract` + keyed CRUD (`set` / `add` / `update` / `remove` each take an optional `OperationOptions`) + `records` / `count` / `aggregate` (each taking an optional `OperationOptions`) + `scan` + `query` / `cursor`.                                                                          |
| `QueryInterface`           | interface | The fluent builder — `condition` / `order` / `filter` / paging, `stream`, and terminal operations.                                                                                                                                                                                                                               |
| `CursorInterface`          | interface | `value` / `index` / `done` + `next` / `update` / `remove` / `close`.                                                                                                                                                                                                                                                             |

## Methods

The public methods of each behavioral interface — one table per type, keyed
by its backticked name, every call-signature member listed (its `readonly`
data members, e.g. `emitter` / `name` / `status` / `primary` / `contract` /
`value` / `index` / `done`, stay in the Surface rows above — `emitter` is the
typed push observation surface, see [Observing](#observing)). Each
`## Entities` class implements its interface exactly, so this doubles as the
per-instance method surface (AGENTS §22).

#### `StorageInterface`

The storage capability a native driver passes into one transaction scope.
It exposes work, not settlement: the driver commits when the callback fulfills,
rolls back when it rejects, and invalidates the capability afterward.

| Method      | Returns                                | Behavior                                                          |
| ----------- | -------------------------------------- | ----------------------------------------------------------------- |
| `read`      | `Promise<Row \| undefined>`            | Read one row by key inside the transaction.                       |
| `write`     | `Promise<void>`                        | Write one row at a key inside the transaction.                    |
| `insert`    | `Promise<void>`                        | Atomically insert one row; reject `CONFLICT` if its key exists.   |
| `delete`    | `Promise<boolean>`                     | Delete one row by key inside the transaction.                     |
| `keys`      | `Promise<readonly Key[]>`              | List a table's keys inside the transaction.                       |
| `scan`      | `AsyncIterable<Row>`                   | Iterate a table's rows inside the transaction.                    |
| `clear`     | `Promise<void>`                        | Empty a table inside the transaction.                             |
| `records`   | `Promise<readonly Row[]>`              | Optional native filtered read inside the transaction.             |
| `aggregate` | `Promise<number \| undefined>`         | Optional native aggregate inside the transaction.                 |
| `stream`    | `AsyncIterable<Row>`                   | Optional natively filtered lazy iteration inside the transaction. |
| `migrate`   | `Promise<void>`                        | Optionally apply one atomic `MigrationInput` in the transaction.  |
| `metadata`  | `Promise<DriverMetadata \| undefined>` | Optional metadata read joined to the transaction.                 |
| `stamp`     | `Promise<void>`                        | Optional metadata write joined to the transaction.                |

#### `DriverInterface`

The complete backend extends `StorageInterface` with lifecycle, the
snapshot floor, and an optional native transaction callback. The inherited
storage/query/migration/metadata methods are documented above.

| Method     | Returns                        | Behavior                                                                                                                |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `open`     | `Promise<void>`                | Ready the tables from a derived `TableSchema[]` (a native backend builds tables/indexes; a scan-only one reads `name`). |
| `close`    | `Promise<void>`                | Release the backend.                                                                                                    |
| `snapshot` | `Promise<() => Promise<void>>` | Capture state; omitted tables means the whole store, while a list scopes capture/restore to those tables.               |

Its optional generic `transaction?<R>(scope)` callback is documented in
[Native transactions](#native-transactions); the installed guide parser does
not classify an optional generic signature as a method-table row.

#### `DatabaseInterface`

| Method        | Returns                                     | Behavior                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table`       | `TableInterface<RowOf<T[K]>>`               | The typed handle for a declared table.                                                                                                                                                                                                       |
| `import`      | `DatabaseInterface<U>`                      | Define a shape map of tables; a typed view over the same driver.                                                                                                                                                                             |
| `export`      | `Readonly<Record<string, TableDefinition>>` | A portable `TableDefinition` per table.                                                                                                                                                                                                      |
| `open`        | `Promise<void>`                             | Connect the driver eagerly (otherwise lazy on first use).                                                                                                                                                                                    |
| `close`       | `Promise<void>`                             | Close the database and its driver.                                                                                                                                                                                                           |
| `transaction` | `Promise<R>`                                | Run a scope with a `DatabaseStorageInterface`; fulfill to commit, reject to roll back; takes an optional `OperationOptions` (`signal` checked once, at entry).                                                                               |
| `migrate`     | `Promise<Migration>`                        | Diff a deployed `TableSchema[]` against the declared schema via `planMigration`, apply `{ plan }` through the driver's optional `migrate` hook, and return the plan; takes an optional `OperationOptions` (`signal` checked once, at entry). |

#### `DatabaseStorageInterface`

| Method  | Returns                       | Behavior                                                                                      |
| ------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `table` | `TableInterface<RowOf<T[K]>>` | Return a table bound to the active transaction; it throws `CONFLICT` after the scope settles. |

#### `TableInterface`

The keyed methods batch by overload (one in → one out; array in → array
out) — a single verb, never `getMany` / `setAll`. `records()` / `scan()`
narrow every row through the table's contract guard, so a non-conforming
stored row (legacy data, a row from before a migration) never appears in
their results. `count()` uses the same contract-valid candidate semantics as
`records()` while ignoring paging, so invalid stored rows do not consume the
count. `aggregate()` remains a stored-row operation; its `count` aggregate may
therefore include a row that `TableInterface.count()` excludes.

| Method      | Returns                              | Behavior                                                                                                                                                           |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get`       | `Promise<T \| undefined>` (or array) | Read by key(s); `undefined` per miss.                                                                                                                              |
| `resolve`   | `Promise<T>` (or array)              | Read by key(s); throws `NOT_FOUND` on a miss.                                                                                                                      |
| `has`       | `Promise<boolean>` (or array)        | Whether key(s) exist.                                                                                                                                              |
| `keys`      | `Promise<readonly Key[]>`            | All primary keys in order.                                                                                                                                         |
| `records`   | `Promise<readonly T[]>`              | Rows matching an optional `QueryInput`; takes an optional `OperationOptions`.                                                                                      |
| `count`     | `Promise<number>`                    | Count contract-valid rows matching an optional `QueryInput`; paging is ignored; takes an optional `OperationOptions`.                                              |
| `aggregate` | `Promise<number \| undefined>`       | `count` / `sum` / `average` / `minimum` / `maximum` over a column; takes an optional `OperationOptions`.                                                           |
| `scan`      | `AsyncIterable<T>`                   | Lazy filtered iteration; `conditions` / `offset` / `limit` honored lazily, `order` IGNORED (sorted output is `records()`'s job); signal checked before each yield. |
| `set`       | `Promise<Key>` (or array)            | Upsert row(s) → key(s); `signal` reaches each backend commit point; an aborted batch keeps earlier committed items.                                                |
| `add`       | `Promise<Key>` (or array)            | Insert row(s) through the driver's atomic `insert`; concurrent duplicate claims yield one success and one `CONFLICT`; `signal` reaches each backend commit point.  |
| `update`    | `Promise<boolean>` (or array)        | Merge changes into existing row(s), re-validate, and propagate `signal` to each backend commit point; an aborted batch keeps earlier committed items.              |
| `remove`    | `Promise<boolean>` (or array)        | Delete row(s) by key; `signal` reaches each backend commit point; an aborted batch keeps earlier committed items.                                                  |
| `clear`     | `Promise<void>`                      | Empty the table.                                                                                                                                                   |
| `query`     | `QueryInterface<T>`                  | Open a fluent query builder.                                                                                                                                       |
| `cursor`    | `Promise<CursorInterface<T>>`        | Open a forward row cursor for bulk mutation.                                                                                                                       |

#### `QueryInterface`

Each modifier mutates and returns the same builder. `condition` accepts the
portable condition directly, `order` accepts one portable order, and the
terminal methods execute the accumulated `QueryInput`.

| Method      | Returns                        | Behavior                                                                                                       |
| ----------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `condition` | `QueryInterface<T>`            | Add one portable condition, including its explicit connector.                                                  |
| `order`     | `QueryInterface<T>`            | Add one portable column and direction.                                                                         |
| `filter`    | `QueryInterface<T>`            | Add a post-fetch JavaScript predicate.                                                                         |
| `limit`     | `QueryInterface<T>`            | Cap the result count.                                                                                          |
| `offset`    | `QueryInterface<T>`            | Skip leading rows.                                                                                             |
| `collect`   | `Promise<readonly T[]>`        | Execute and collect every matching row.                                                                        |
| `find`      | `Promise<T \| undefined>`      | Execute and return the first match or `undefined`.                                                             |
| `count`     | `Promise<number>`              | Execute and return the match count.                                                                            |
| `stream`    | `AsyncIterable<T>`             | Evaluate conditions, filters, offset, and limit lazily; `order` is ignored; takes optional `OperationOptions`. |
| `aggregate` | `Promise<number \| undefined>` | Execute a named aggregate over a column.                                                                       |

#### `CursorInterface`

| Method   | Returns         | Behavior                                              |
| -------- | --------------- | ----------------------------------------------------- |
| `next`   | `Promise<void>` | Advance to the next present row.                      |
| `update` | `Promise<void>` | Merge changes into the row at the current position.   |
| `remove` | `Promise<void>` | Delete the row at the current position.               |
| `close`  | `void`          | Close terminally; later cursor operations are no-ops. |

## Contract

These invariants hold across the core database source tree ↔ this guide:

1. **DOC ↔ PUBLIC ENTRY bijection.** Every `function` / `const` / `class` /
   `interface` / `type` row in the `## Surface` tables is reachable from the
   `src/core`, `src/server`, or `src/browser` entry barrel, and every reachable
   public export appears as a Surface row — compiler-resolved and exhaustive in
   both directions (AGENTS §22). Exported implementation declarations outside
   an entry barrel remain internal.
2. **A table is a contract.** Every write is coerced **and** validated
   through the table's compiled contract — `set` / `add` / `update` run the
   row through the installed Contract 0.0.9 `contract.parse`, one step that
   both coerces and enforces constraints such as `min` / `pattern`. Every
   parsed result already satisfies `contract.is`, so `Table` does not run a
   second guard after parsing; a row that fails throws `VALIDATION`. Reads are
   narrowed back to the table's row type through the guard — never an `as`
   (AGENTS §1). The
   row type is the shape's `Infer`, so a `tables` map types every table from
   one declaration. A contract rejection reports only the table plus the first
   bounded contract fault (`field` and `reason` when one exists); the rejected
   row, received value, and parser cause never enter the message, context,
   serialized error, or table events.
3. **Thin driver, one engine, native overrides.** The REQUIRED
   `DriverInterface` surface is the irreducible storage primitive — keyed
   read/write/atomic-insert/delete, an ordered `scan`, key listing, and `snapshot`. `open`
   hands the driver a derived `TableSchema[]` (each table's `columns`, their
   portable `ColumnStorage` via `shapeToColumnStorage`, the `primary` key, and declared
   `indexes`) so a native backend can build real tables and indexes; a
   scan-only backend reads only `name`. The pure, total query engine
   (`applyQuery` / `matchesQuery` / `computeAggregate` / …) over `scan`
   is the default and the only REQUIRED path. A backend MAY implement the
   optional native `records?` / `aggregate?` / `transaction?` /
   `stream?` / `migrate?` where it has a faster or more native path, and the
   engine prefers each when present — falling back to the portable path
   otherwise (AGENTS §21). Because `aggregate?` legitimately resolves to
   `undefined` (a sum over zero rows), `Table.aggregate` decides the hook ran
   by its **presence** (a present method returns a Promise; `?.()` is
   `undefined` only when the method is absent), never by the resolved value.
   Neither reference driver implements `records?` / `aggregate?`,
   so every query runs the engine over key-ordered `scan`; both DO implement
   `stream?` and `migrate?` (`MemoryDriver.stream` lazily filters `scan` via
   the engine; `JSONDriver.stream` delegates to its inner `MemoryDriver`).
   `MemoryDriver` still lacks a native `transaction?`, so its transactions
   always use the snapshot floor; `JSONDriver` now DOES implement
   `transaction?` — it clones the committed memory/schema/metadata into an
   isolated candidate, passes only that candidate's capability to the callback,
   and publishes it with one atomic file replacement only when the callback
   fulfills. Rejection or persistence failure discards the candidate, leaving
   committed memory, metadata, and file bytes exact; nesting and root operations
   while active throw `CONFLICT`. Root `scan` / `stream` iterators created
   before a JSON or SQLite transaction guard every continuation before and
   after the underlying read. Resuming one while the transaction is active
   throws `CONFLICT`, discards any concurrently produced row, cleans the source
   exactly once, and terminalizes the iterator; the transaction and driver
   remain usable. Memory and IndexedDB need no equivalent root wrapper because
   neither exposes a callback transaction. `Database.transaction` over a `JSONDriver`
   therefore prefers this native path over the snapshot floor. Both reference drivers now also
   implement the paired `metadata?` / `stamp?` — `MemoryDriver` in-process only
   (the owned `DriverMetadata` snapshot lives in instance memory), `JSONDriver` persisted:
   the file is `{ metadata?: DriverMetadata, tables }`, with `metadata` present only
   once the store has been `stamp`ed at least once (an old, pre-versioning
   file — bare `{ tables }` — reads back as unstamped, i.e. `metadata()` resolves
   `undefined`; a bare `{ tables }` document is therefore simply unstamped). A `JSONDriver` write-path
   fault (`mkdir` / `writeFile` / `rename` failing during `#serialize`)
   surfaces as a `DatabaseError` `DRIVER` after temporary-file cleanup; its
   context carries `path` and the native `cause`. If that cleanup also fails,
   the top-level `DRIVER` context is exactly the persistence evidence
   `{ path, temp, cause, cleanup }`; a precommit abort remains an `ABORTED`
   `DatabaseError` nested at `cause`, while cleanup failure determines the
   top-level code. Durable reads fail closed: only a proven absent JSON path or
   absent native metadata record is fresh. A fresh SQLite/IndexedDB store may create
   missing declared tables/stores while retaining unrelated physical objects. Once
   metadata exists, every table/store in its persisted schema must already exist
   physically: SQLite throws
   `DatabaseError('DRIVER', 'Stored SQLite table is missing')` before any DDL in its
   open transaction, and IndexedDB throws
   `DatabaseError('DRIVER', 'Stored IndexedDB store is missing')` before its final
   open. Extra physical objects remain allowed, and SQLite may reconstruct a
   missing declared index because the table and its records still exist. IndexedDB
   captures the bootstrap connection's exact stores and version in the same
   lifetime, then pins the persisted final open to that version; a concurrent
   versionchange makes the stale open reject instead of silently bumping and
   recreating storage. Existing unreadable, malformed, structurally incompatible,
   or physically incomplete state throws `DRIVER` without publishing a handle or
   attempting table/store repair; after external repair, the same driver instance
   may retry `open`.
   `SQLiteDriver` and `IndexedDBDriver` complete the native-override
   picture from opposite ends, each earning trust its own way (AGENTS §21).
   `SQLiteDriver` is **prove-exactness-or-refine**: real `CREATE TABLE` /
   `CREATE INDEX` DDL backs every table, but `records?` /
   `aggregate?` / `stream?` compile a `QueryInput` straight to SQL
   (`compileQuerySQL`, `compileAggregateSQL`) and run it natively ONLY when
   `matchesQueryExactly` (built from `matchesConditionExactly` / `matchesOrderExactly`) first
   proves the SQL and the engine's semantics are identical for every
   condition and order term — otherwise the driver falls back to a full
   `scan` refined through the SAME core engine every scan-only driver uses
   (`applyQuery` / `filterRows` / `computeAggregate` / `matchesQuery`).
   Refine, not native SQL, is the path for: `like` / `glob` patterns (SQL
   `LIKE`/`GLOB` semantics can diverge from the engine's `matchesWildcardPattern`),
   every scalar condition over a column that is optional OR nullable,
   `absent` / `present` only when the column is optional AND nullable, a `null`
   or `undefined` scalar operand, an empty `any` / `none` operand list,
   mismatched operand types, `json` / `blob` columns, and any nested
   `FieldPath` — AND a
   RANGE operator (`above` / `below` / `from` / `to` / `between`) or an
   `ORDER BY` term over a `text` column: SQLite's default BINARY collation
   orders `TEXT` by Unicode CODE POINT while the core engine's `compareValues`
   orders JS strings by UTF-16 CODE UNIT, and the two diverge on
   supplementary-plane characters (code points ≥ U+10000, e.g. many emoji) —
   so text ranges and text ordering always refine through the engine, even
   though text EQUALITY (`equals`/`not`/`any`/`none`) and `starts`/`ends` stay
   native on a required non-null text column. `starts` / `ends` compile
   case-SENSITIVELY (a `substr` comparison plus a
   `typeof text === 'string'` guard; an empty operand falls back to a
   `typeof` check) when they DO qualify as exact. `IndexedDBDriver` is **narrow-then-refine**:
   `records?` / `stream?` first ask `selectPlan` for a key-range pushdown over
   the primary key or a single-column secondary index — a candidate SUPERSET,
   never lossy — then hands that superset to the SAME core engine
   (`applyQuery` / `matchesQuery`) every scan-only driver uses, which
   refines it to the exact result; a plan that cannot prove itself range-exact
   (a nested path, a non-orderable column type, an `or`-joined condition, a
   non-comparison operator) falls back to a full scan. `below` / `to` push
   down ONLY onto the primary store, never a secondary index — a secondary
   index has no entry for a row whose indexed column is absent or `null`,
   while the engine's total order (`compareValues`) lets those rows match a
   `below` / `to` bound; `equals` / `above` / `from` / `between` remain
   index-eligible on either. `conditionToRange` returns `undefined` for a `between`
   whose bounds are reversed (`compareValues(first, second) > 0`), so
   `selectPlan` falls back to a full scan instead of handing a raw
   backwards `IDBKeyRange` to the store (which would throw a `DataError`).
   `IndexedDBDriver.snapshot()` captures every store in ONE read transaction,
   so the capture is point-in-time consistent across stores even under
   concurrent writers; `restore` was already atomic. Both drivers implement
   `migrate?` natively and treat `MigrationInput` as one commit unit:
   `SQLiteDriver` applies schema, rows, and optional metadata inside one native
   SQLite transaction (`stepToSQL` projects each step's DDL), while a migration
   invoked inside an existing callback transaction uses one fixed internal
   savepoint SQL literal. The published `@orkestrel/sqlite` wrapper
   intentionally exposes raw `exec` but no savepoint manager; the savepoint
   contains a caught inner migration so it cannot leak partial DDL and the
   outer transaction remains active for unrelated work.
   `IndexedDBDriver` performs a non-empty plan in one versionchange transaction,
   writing `metadata` in that SAME upgrade; a metadata-only input uses one ordinary
   `__metadata__` readwrite transaction. Both implement the paired `metadata?` /
   `stamp?` into a reserved store name a user table must avoid:
   `SQLiteDriver` uses a single-row `_metadata` table (`METADATA_TABLE`), and
   `IndexedDBDriver` uses an out-of-line `__metadata__` store (`METADATA_STORE`), both
   excluded from a whole-store `snapshot`. `SQLiteDriver` implements
   `transaction?` as a callback-scoped real `BEGIN` / `COMMIT` / `ROLLBACK`;
   the capability performs reads, writes, migration, and metadata work inside
   that one native transaction, then becomes invalid. `IndexedDBDriver`
   deliberately OMITS `transaction?`: an `IDBTransaction` can auto-commit when
   control yields to a non-IDB `await`, so arbitrary callback awaits cannot
   truthfully remain inside one native transaction. It also omits `aggregate?`
   because IndexedDB has no native SUM/AVG/MIN/MAX; the engine over the narrowed
   `records?` covers it. A new backend implements a handful of small methods and
   inherits the entire query surface unchanged.
4. **Total query helpers; the equality family is structural, not ranked.**
   `compareValues`, `matchesCondition`, and `matchesQuery` never throw — a
   type mismatch is a non-match and the comparator is a total order (it
   never returns `NaN`), mirroring the contracts guards' totality (AGENTS
   §14). The range operators (`above` / `below` / `from` / `to` /
   `between`) still rank through `compareValues`'s total order (which
   collapses every object/array to one rank-5 bucket). The equality-family
   operators (`equals` / `not` / `any` / `none`) instead compare through
   `equalsValue` — STRUCTURAL equality by SameValueZero leaves, so `equals` on
   an object/array compares field-by-field rather than by reference or rank,
   and `NaN` equals `NaN` under `equals` / `any` (it never matched anything
   under the old rank-based comparison).
5. **Scoped transactions, with explicit admission and drain.**
   `transaction(scope, options?)` checks `options?.signal` once at entry, then
   gives `scope` a `DatabaseStorageInterface`: a table-only view backed by a
   scoped `StorageInterface`. Every operation accepted while the callback
   is active is tracked, and settlement waits for that whole accepted operation
   graph to drain — not just the promise the callback returns. A rejected
   accepted operation aborts the transaction even when caller code catches that
   rejection. If the callback itself throws synchronously or rejects
   asynchronously, that exact reason wins over a drain error; otherwise the
   first tracked failure becomes the transaction error.
   Admission closes when the callback returns, so later work conflicts rather
   than escaping settlement. Each `scan` / `stream` continuation is tracked
   independently: an in-flight `next()` drains, but an idle iterator does not pin
   commit, and a continuation requested after settlement throws `CONFLICT`.
   Root tables (including imported views), `open`, `close`, `migrate`, and
   nesting throw `CONFLICT` while the scope is active; the scoped view, its
   tables, queries, cursors, and streams also throw `CONFLICT` after settlement.
   When the driver implements `transaction?(scope)`, the driver owns
   acquisition, commit on fulfillment, rollback on rejection, release, and
   invalidation. Otherwise the universal single-writer floor snapshots the
   whole store, runs the same scoped callback, and restores the snapshot on
   rejection. Either path emits the identical `transaction` / `commit`
   lifecycle; `rollback(error)` is emitted only when rollback completed and the
   original scope/drain error remains the propagated rejection, never when
   cleanup itself replaced that error.
6. **Observation is a pure side-channel (§13).** The core `Database` owns a
   typed `emitter` (`DatabaseEventMap` — `open` / `close` / `transaction` /
   `commit` / `rollback` / `migrate`) and each `Table` owns one (`TableEventMap` —
   `write` / `remove` / `clear`, KEY only, no value payload to avoid heavy
   fan-out / leaking row data). Every event is emitted directly (the AGENTS
   §13 convention: the emitter isolates a listener throw, routing it to its
   OWN `error` handler — the `error` option, surfaced as `(error, event)`,
   NOT a domain event — itself re-entrancy-guarded) strictly AFTER the
   relevant transition — `commit` only after a scope succeeds, `rollback`
   only after restoration succeeds and the observed error is the same rejection
   that propagates (a cleanup failure is not mislabeled as a rollback), a
   `write` / `remove` / `clear` only after the driver op
   completes. So a buggy observer can never corrupt a write or a
   transaction: the committed state stays intact, the rollback still
   restores, and the original transaction error still propagates (proven by
   the emit-safety tests). Reads / queries / counts are not emitted (a
   reader does not mutate, and those paths are too hot). The observation
   lives in the core layer; the drivers stay storage primitives.
7. **Views share a driver.** A database is a typed view over a set of tables
   on one driver. `import(tables)` returns a new view of just those tables
   over the **same** driver (sharing storage and transactions); `export()`
   emits a portable `TableDefinition` per table — `schema` is the universally
   portable JSON Schema, `columns` re-imports losslessly via `import` within
   a TypeScript environment.
8. **DOC ↔ SOURCE method bijection.** Every behavioral interface's
   `## Methods` table lists exactly its public methods (call-signature
   members) — exhaustive, both directions — and each implementing class
   (`Database` / `MemoryDriver` / `JSONDriver` / `SQLiteDriver` /
   `IndexedDBDriver` / `Table` / `Query`) implements
   every REQUIRED method and adds none beyond the interface (optional members
   like `records?` / `aggregate?` / `transaction?` / `stream?` /
   `migrate?` / `metadata?` / `stamp?` may be omitted). `MemoryDriver` and
   `JSONDriver` both omit `records?` / `aggregate?`, and both now
   implement `stream?` / `migrate?` / `metadata?` / `stamp?`; `MemoryDriver` still
   omits `transaction?` (snapshot floor only) while `JSONDriver` now
   implements `transaction?` too (isolated candidate state plus one atomic
   publish on callback fulfillment). `SQLiteDriver` implements EVERY optional hook — `records?` /
   `aggregate?` / `transaction?` / `stream?` / `migrate?` / `metadata?`
   / `stamp?` — the fully-native backend. `IndexedDBDriver` implements
   `records?` / `stream?` / `migrate?` / `metadata?` / `stamp?` but
   omits `transaction?` and `aggregate?` by IndexedDB's nature, not by
   choice (AGENTS §22). A renamed / added / removed method breaks the gate
   until the table is reconciled.
9. **Abort is a shared gate, not per-method reinvention.**
   `checkAbort(signal)` is the one place `ABORTED` is thrown — a no-op for
   `undefined` or a live signal. `records` / `count` / `aggregate` check it
   at entry; `TableInterface.scan` and `QueryInterface.stream` check it
   BEFORE EACH YIELD (so an abort mid-iteration stops promptly) and IGNORE
   `order` (streaming yields driver key-order; sorted output stays
   `records()`'s job). Breaking out of a stream early (`break`) closes the
   underlying source. Each call to `scan` / `stream` returns a fresh
   iterable — reusing a `QueryInterface` across calls never leaks state
   between them. `set` / `update` route through `write`, `add` through the
   required atomic `insert`, and `remove` through `delete`; all carry the same
   `OperationOptions` to the real backend commit point. An abort while the shared lazy open is pending
   rejects that mutation promptly; the open may finish for other waiters, but
   the rejected mutation never dispatches later. Memory and SQLite re-check
   immediately before their synchronous mutation. IndexedDB runs each point
   mutation in one explicit readwrite transaction and aborts that transaction
   only while it is active. JSON queues each nontransactional point mutation
   through preimage capture, staging, atomic rename, and success or restoration;
   queued aborts never start, active precommit aborts restore memory and clean
   the temp file before rejection, and reads wait behind that unit. Once an
   commit point that cannot be aborted (`SQLite` call entry, IndexedDB transaction
   completion, JSON `rename` dispatch) has won, the operation awaits and reports its real
   result; a late signal cannot convert success to `ABORTED`. Batch items remain
   sequential and independent: earlier committed items survive an abort of a
   later item.
10. **Key generation is host-neutral and overridable.** When an optional
    primary column is omitted, a table uses global `crypto.randomUUID()`.
    `DatabaseOptions.generator` (a `KeyFunction`) authoritatively replaces
    that default, which is required for numeric generated primaries. An
    explicit primary value always wins and never invokes the generator.
11. **Atomic migration input, plus opt-in versioned reconciliation.**
    `planMigration(deployed, declared, from?, to?)` structurally diffs two
    `TableSchema[]` into an ordered `Migration` plan (`table.add` /
    `table.remove`, then each shared table's `column.add` / `column.remove`
    / `index.add` / `index.remove`). A driver receives
    `driver.migrate?.({ plan, metadata? })`: one `MigrationInput` whose schema
    changes and optional target metadata publish atomically. A step
    referencing an unknown table throws
    `DatabaseError('MIGRATION')`; so does a `column.add` / `column.remove`-adjacent
    shared column whose declared `storage`, `optional`, or `nullable` differs between
    `deployed` and `declared` (an in-place storage/optionality/nullability change is not
    auto-migrated — the JSDoc on `planMigration` documents the manual path:
    add a new column, copy/convert the data, then remove the old one).
    A `column.add` that is required and non-null is rejected before DDL because
    existing rows cannot satisfy it without an explicit data backfill; add an
    optional or nullable column first, populate it, then tighten the schema
    through an explicit application-managed migration.
    `Database.migrate(deployed, options?)`
    is the explicit pre-open migration path. It diffs `deployed` against the
    database's own declared `tables`, applies the resulting plan through the
    driver's `migrate?` hook (throwing `MIGRATION` when the driver lacks
    one), emits the `migrate` event on success, and returns the applied
    plan — `options?.signal` is checked once, at entry, throwing `ABORTED`
    on an already-fired signal. The explicit path opens the caller-declared
    deployed physical schema, applies the migration (including target metadata
    when `version` is configured), and publishes `open` as one readiness
    transition. It is an alternative admission path, so the same handle does
    not run a second automatic reconciliation. A failed explicit apply remains
    the exact readiness failure for ordinary table/open work until another
    explicit `migrate` succeeds; `close` remains available. `migrateRows` is the pure per-table row
    transform (`column.remove` drops the field from a fresh copy of each
    row; the other operations act on storage shape, not row shape, so they
    are no-ops here) — a driver's own `migrate` decides how to apply it to
    stored rows. This caller-driven path remains the way to migrate against
    an UNVERSIONED driver (one that implements neither `metadata` nor `stamp`),
    which still owns knowing what is currently deployed. A driver that DOES
    implement both `metadata` and `stamp` can instead opt into automatic
    reconciliation by passing `DatabaseOptions.version`. A versioning driver's
    `open()` first discovers persisted `DriverMetadata.schema` and opens that
    DEPLOYED physical schema; it must not pre-create the target schema before
    reconciliation. `Database.open()` then compares deployed metadata with the
    declared version inside the same lazy-connect chain. A fresh store
    (`metadata()` is `undefined`) stamps `{ version, schema }` for next time. A
    stored version below the declared one computes the plan from the persisted
    schema and passes `{ plan, metadata: { version, schema } }` to `migrate`, so
    schema, rows, and new metadata commit or roll back together. A stored
    version above the declared one throws `MIGRATION`. At an equal version,
    the persisted and declared schemas must still match; drift throws
    `MIGRATION`, while an exact match is a no-op with no metadata rewrite.
    Comparison canonicalizes table order, column order, and the outer index-list
    order, while preserving each compound index's inner column order because
    `['city', 'age']` and `['age', 'city']` are different indexes.
    `version` left unset, or set against a non-versioning driver, leaves
    `open()` unchanged — versioning is opt-in per driver AND per database.
    Versioning drivers own the migration input's atomicity even when they do
    not expose a general callback `transaction` hook. On a fresh handle, call
    either `open()` for metadata-driven reconciliation or `migrate(deployed)`
    for caller-driven reconciliation. Both converge on the same declared schema
    and publish readiness once.
12. **Driver conformance.** `conformDriver(factory)` is a framework-agnostic
    battery (no test-runner import) any new `DriverInterface` backend can run
    against itself — a smoke script, a unit test, or a new driver's own
    README all call it the same way. It opens a fixed two-table schema per
    phase (calling `factory()` fresh each time so failures stay isolated) and
    verifies the REQUIRED surface's invariants (copy-in/copy-out isolation,
    upsert-overwrite, key-ordered `keys`/`scan`, `snapshot` rollback, a
    non-`id` primary key, structural round-tripping via `equalsValue`), then
    presence-gates the optional `migrate?` / `stream?` / `transaction?`
    hooks when the driver implements them. The battery's `write-read` phase
    is deepened with nested-field checks (a written row's nested object/array
    fields must copy-in/copy-out isolated, not just its top-level fields),
    and a dedicated `snapshot-nested` phase asserts the same nested isolation
    across a `snapshot()` capture/restore round-trip — a driver that
    shallow-copies anywhere in its write/read/scan/snapshot boundary now
    fails conformance (`MemoryDriver` passes by deep-copying via
    `structuredClone` at every one of those boundaries). The first violated
    invariant throws a `CONFORMANCE` `DatabaseError` naming the failed check.
13. **Backend faults surface as `DatabaseError`, never raw.** No native
    wrapper error (a SQLite fault, an IndexedDB `DOMException`) crosses a
    `DriverInterface` implementation — `SQLiteDriver` and `IndexedDBDriver`
    each map every backend fault to a `DatabaseError` at the boundary
    (`#guard` internally on the SQLite side; `mapIndexedDBError` /
    `mapMigrationError` on the IndexedDB side), preserving the original
    error as `context.cause`. `SQLiteDriver`: a constraint violation maps to
    `CONFLICT`, a closed-connection fault to `CLOSED`, a busy/locked database
    to `DRIVER` with a `retryable` context flag, anything else to `DRIVER`.
    Snapshot capture puts the open gate, every prepare/read, and captured-map
    population inside one `#guard`; replay likewise contains the open gate,
    native transaction, deletes, prepares, and reinserts in one `#guard`.
    Public `close()` crosses that same boundary. A physically dropped declared
    table therefore rejects capture as top-level `DRIVER`, and a zero-timeout
    exclusive lock rejects replay as retryable `DRIVER` with
    `context.code === 'BUSY'`; both retain the actual `SQLiteError` only at
    `context.cause`.
    `IndexedDBDriver`: a constraint violation maps to `CONFLICT`; a
    closed/not-open/invalid-state fault to `CLOSED`; a quota fault to
    `DRIVER` with `code: 'QUOTA'`; `migrate`'s versionchange path remaps an
    upgrade fault to `MIGRATION`; anything else to `DRIVER`. A blocked open
    or versionchange is nonterminal and remains pending until the competing
    connection closes, rather than surfacing as an error.
14. **The reserved metadata table/store is a hard guard, not a naming
    convention.** `SQLiteDriver.open` throws `DatabaseError('VALIDATION')`
    when the declared tables include one literally named `_metadata`
    (`METADATA_TABLE`); `IndexedDBDriver.open` does the same for `__metadata__`
    (`METADATA_STORE`) — a collision is caught at `open`, not discovered later
    as corrupted metadata. Because both drivers derive their index names from
    a length-prefixed scheme (`deriveSQLiteIndexName` for SQLite,
    `deriveIndexedDBIndexName` for IndexedDB) to stay collision-free across
    compound indexes, a database
    file/store created under an OLDER naming scheme leaves its old-named
    indexes orphaned (unreferenced, harmless) on reopen under the new scheme —
    they are never queried and never collide, but a storage audit may notice
    them.

What ships is the **core in-between** (schema-aware: `open` receives a
derived `TableSchema[]`, with `shapeToColumnStorage` mapping each column's shape), its
reference `MemoryDriver`, and three persistent backends. `JSONDriver` in
`src/server` is a decorator over `MemoryDriver` that loads/flushes a single
JSON file — every primitive delegates to the inner memory driver, so
querying, key-order `scan` / `keys`, and capture-replay `snapshot` are
inherited unchanged; `JSONDriver.migrate` additionally persists the migrated
state, and every flush is now atomic — written to a sibling temp file and
`rename`d onto the target path, so a crash mid-flush can never truncate or
corrupt the previous good file. Outside a `transaction`, `JSONDriver` still
flushes once per mutation (`write` / `insert` / `delete` / `clear`); its native
`transaction?(scope)` clones committed rows, schema, and metadata into an
isolated candidate. The callback can observe only that candidate; fulfillment
serializes it once and publishes memory only after the atomic file replacement,
while rejection or persistence failure discards it without changing committed
state. Nested transactions, root operations while active, and a captured
capability used after settlement throw `CONFLICT`. `SQLiteDriver`, also in `src/server`, is the
fully-native, **trusted-mode** backend on the published `@orkestrel/sqlite`
wrapper — real typed `CREATE TABLE` / `CREATE INDEX` DDL, native
`records?` / `aggregate?` / `stream?` compiled straight to SQL,
real `BEGIN` / `COMMIT` / `ROLLBACK` transactions, atomic DDL migration
(`stepToSQL`; a root input uses one native transaction, while an input inside
an existing callback transaction uses the guarded fixed internal savepoint
literal for caught-inner-failure containment while the outer transaction stays
active),
and a reserved
`_metadata` table (`METADATA_TABLE`) for `metadata?` / `stamp?` versioning — every
optional `DriverInterface` hook, none skipped. `IndexedDBDriver` in
`src/browser`, on the published `@orkestrel/indexeddb` wrapper, is the
**narrow-then-refine** persistent browser backend — `selectPlan` turns a
`QueryInput` into a key-range pushdown over the primary key or a single-column
secondary index (a candidate superset, never lossy) that the same core
engine then refines to the exact result; `migrate?` applies a non-empty plan
and its metadata in one versionchange transaction, and `metadata?` / `stamp?`
persist into a reserved
`__metadata__` store (`METADATA_STORE`) — it omits `transaction?` because arbitrary
callback awaits outlive an auto-committing `IDBTransaction`, and
`aggregate?` (no native SUM/AVG/MIN/MAX) by IndexedDB's own nature. The core
`Database` / `Table` are also **observable** — each owns a typed `emitter`
(`DatabaseEventMap` / `TableEventMap`, §13) carrying the transaction +
per-row lifecycle (see [Observing](#observing)); a driver stays a storage
primitive (the observation lives in the core layer above it).

## Patterns

### Declaring tables in options

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, literalShape, optionalShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	name: 'app',
	tables: {
		// Each table's value is its columns — wrapped in an `objectShape` for you.
		users: {
			id: stringShape(),
			name: stringShape({ min: 1 }),
			age: integerShape({ min: 0 }),
			role: literalShape(['admin', 'member', 'guest']),
			bio: optionalShape(stringShape()), // nested object columns still use objectShape
		},
		posts: { slug: stringShape(), title: stringShape() },
	},
	primary: { posts: 'slug' }, // default primary column is 'id'
	indexes: { posts: [['title']] }, // secondary indexes — contracts don't express them
})

const users = db.table('users') // hold the handle; reuse it
const posts = db.table('posts')

users.primary // 'id' — the default primary column
posts.primary // 'slug' — the declared override
```

Each `indexes` entry is one (possibly compound) index of column names; they
flow into each table's derived `TableSchema`. Both drivers here are
scan-only and ignore them; SQLite and IndexedDB use supported declarations
for native indexes and still refine through the shared engine when required.

### Swapping the driver

The `tables` declaration and every call against the database are identical
across backends — only the `driver` changes, so the same code runs in tests
and in production. Pick the driver per environment and pass it to
`createDatabase`:

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database' // tests / ephemeral — no I/O
import { createJSONDriver } from '@orkestrel/database/server' // node — persisted to a file
import { integerShape, stringShape } from '@orkestrel/contract'

const driver =
	process.env.NODE_ENV === 'test' ? createMemoryDriver() : createJSONDriver('data/app.json')
const db = createDatabase({
	driver,
	tables: { users: { id: stringShape(), age: integerShape() } },
	indexes: { users: [['age']] },
})
void db
```

`MemoryDriver` is scan-only (the core engine answers every query) and
I/O-free, making it the storage behind tests, ephemeral caches, and any code
that wants the database API without a persistent backend. Its row boundary
continues to use native `structuredClone`, retaining supported non-JSON values
such as `Blob` and `Uint8Array`; only `DriverMetadata` crosses the stricter exact-JSON
`cloneDriverMetadata` boundary. `JSONDriver` adds file persistence on top of the same
in-memory engine — both return identical query results, so the choice is purely
about where the bytes live, never about behavior.

### Keyed CRUD

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, optionalShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: {
			id: stringShape(),
			name: stringShape(),
			age: integerShape(),
			role: stringShape(),
			bio: optionalShape(stringShape()),
		},
	},
}).table('users')

await users.set({ id: 'u1', name: 'Ada', age: 36, role: 'admin' }) // upsert → key
await users.add({ id: 'u1', name: 'Ada', age: 36, role: 'admin' }) // throws CONFLICT (exists)
await users.update('u1', { age: 37 }) // merge + re-validate → boolean
await users.get('u1') // row or undefined (typed)
await users.resolve('u1') // row or throw NOT_FOUND
await users.has('u1') // boolean
await users.remove('u1') // boolean
await users.clear() // empty the table

// A missing primary uses global crypto.randomUUID(), or DatabaseOptions.generator when supplied.
```

`add` is a storage-level claim, not `read` followed by `write`: `Table.add`
calls the required `DriverInterface.insert`, and each backend rejects a
duplicate at its own atomic insertion boundary. Two concurrent adds for the
same key therefore cannot both succeed; exactly one wins and the other rejects
with `CONFLICT`.

### Filtered records, count, and aggregate

`records` / `count` / `aggregate` take an optional `QueryInput` directly —
`query()` compiles one for you, but a caller with a pre-built `QueryInput` can
call these directly:

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape(), age: integerShape() } },
}).table('users')

await users.records({
	conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }],
}) // every row aged 18 or over
await users.count() // every row, unfiltered
await users.aggregate('average', 'age') // number | undefined
```

### Streaming with early exit

`scan` (on a table) and `stream` (on a query) are lazy — rows are yielded one
at a time rather than collected up front. `conditions` / `offset` / `limit`
are honored as rows stream; `order` is IGNORED (sorted output is `records()`
/ `collect()`'s job — streaming yields driver key-order). Breaking out early
closes the underlying source, and each call returns a fresh iterable:

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: {
			id: stringShape(),
			name: stringShape(),
			age: integerShape(),
			role: stringShape(),
		},
	},
}).table('users')

// Table.scan — lazy filtered iteration, no upfront collection.
for await (const user of users.scan({
	conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }],
})) {
	if (user.name === 'Ada') break // closes the source immediately — no more rows read
}

// Query.stream — the fluent builder's lazy terminal (filters/offset/limit apply, order is ignored).
for await (const user of users
	.query()
	.condition({ column: 'role', operator: 'equals', values: ['member'], connector: 'and' })
	.stream()) {
	console.log(user.name)
}
```

### Abort

Reads, iterations, and point mutations take an optional
`OperationOptions.signal`. An already-fired signal throws `ABORTED`; `scan` /
`stream` re-check it before each yield, while mutations carry it through the
driver to the backend commit point:

```ts
import {
	checkAbort,
	createDatabase,
	createMemoryDriver,
	isDatabaseError,
} from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: { id: stringShape(), name: stringShape(), age: integerShape(), role: stringShape() },
	},
}).table('users')

// A time-boxed read — abort after 50ms.
try {
	await users.records(undefined, { signal: AbortSignal.timeout(50) })
} catch (error) {
	if (isDatabaseError(error) && error.code === 'ABORTED') console.log('too slow', error.context)
}

// A time-boxed scan — checked before each yielded row.
const controller = new AbortController()
for await (const user of users.scan(undefined, { signal: controller.signal })) {
	if (user.id === 'stop-here') controller.abort('caller aborted')
}

// Every point-mutation primitive carries the signal to its backend commit point.
await users.set({ id: 'u2', name: 'Bo', age: 41, role: 'member' }, { signal: controller.signal })
await users.add({ id: 'u3', name: 'Cy', age: 29, role: 'member' }, { signal: controller.signal })
await users.remove('u2', { signal: controller.signal })

// The shared gate every abortable boundary calls internally:
checkAbort(controller.signal) // throws DatabaseError('ABORTED', …) once aborted
```

Abort is precommit, not a `Promise.race` over an active commit that cannot be aborted
write. Memory and SQLite check immediately before their synchronous mutation;
IndexedDB aborts its explicit readwrite transaction while active; JSON aborts
staging, cleans its temp file, and restores the preimage before rejecting. If
the native commit has already been dispatched, the method ignores a late abort
and awaits the real success or failure. A batch passes the same signal to each
sequential item, so already-committed earlier items remain committed.

### Batch operations

The keyed methods batch by overload (AGENTS §9.2) — one key/row in, one
result; an array in, an array of results in the same order. The verb never
changes (no `getMany` / `setAll`):

```ts
import type { RowOf } from '@orkestrel/database'
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const columns = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	role: stringShape(),
}
const users = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: columns },
}).table('users')
const row1: RowOf<typeof columns> = { id: 'u1', name: 'Ada', age: 36, role: 'admin' }
const row2: RowOf<typeof columns> = { id: 'u2', name: 'Bo', age: 41, role: 'member' }
const row3: RowOf<typeof columns> = { id: 'u3', name: 'Cy', age: 29, role: 'member' }

await users.set([row1, row2, row3]) // → readonly Key[]
await users.add([row1, row2]) // → readonly Key[] (CONFLICT rejects the batch)
await users.get(['u1', 'u2']) // → readonly (Row | undefined)[]
await users.resolve(['u1', 'u2']) // → readonly Row[] (NOT_FOUND on any miss)
await users.has(['u1', 'u2']) // → readonly boolean[]
await users.update(['u1', 'u2'], { role: 'member' }) // same changes to each → readonly boolean[]
await users.remove(['u1', 'u2']) // → readonly boolean[]
```

A batch runs as independent sequential operations; wrap it in `transaction`
when it must be atomic.

### Coercion through the contract

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: { id: stringShape(), name: stringShape(), age: integerShape(), role: stringShape() },
	},
}).table('users')

// A numeric column accepts a numeric string and stores the coerced number.
const normalized = users.contract.parse({
	id: 'u2',
	name: 'Bo',
	age: '41',
	role: 'member',
})
if (normalized === undefined) throw new Error('Expected the row to parse')
await users.set(normalized)
;(await users.get('u2'))?.age // 41 (a number) — the contract parsed it

// A row that cannot satisfy the shape throws DatabaseError('VALIDATION').
```

### Fluent queries

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: { id: stringShape(), name: stringShape(), age: integerShape(), role: stringShape() },
	},
}).table('users')

await users
	.query()
	.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
	.condition({ column: 'role', operator: 'not', values: ['guest'], connector: 'and' })
	.order({ column: 'age', direction: 'descending' })
	.limit(10)
	.collect() // the first ten non-guest adults, oldest first

await users
	.query()
	.condition({ column: 'name', operator: 'starts', values: ['A'], connector: 'and' })
	.find() // first match or undefined
await users
	.query()
	.condition({ column: 'role', operator: 'equals', values: ['admin'], connector: 'and' })
	.count() // number
await users
	.query()
	.condition({ column: 'role', operator: 'equals', values: ['member'], connector: 'and' })
	.aggregate('average', 'age') // number | undefined
await users
	.query()
	.filter((user) => user.name.includes('a'))
	.collect() // post-fetch JavaScript predicate

// Ordering, paging, and named aggregation:
await users.query().order({ column: 'name', direction: 'ascending' }).offset(10).limit(5).collect() // page 3 of 5, alphabetical
await users
	.query()
	.condition({ column: 'age', operator: 'above', values: [18], connector: 'and' })
	.aggregate('sum', 'age')
```

Every condition operator uses the same `condition` method and explicit,
serializable input:

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, optionalShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: {
			id: stringShape(),
			name: stringShape(),
			age: integerShape(),
			role: stringShape(),
			bio: optionalShape(stringShape()),
		},
	},
}).table('users')

await users
	.query()
	.condition({ column: 'age', operator: 'equals', values: [36], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'age', operator: 'not', values: [36], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'age', operator: 'above', values: [18], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'age', operator: 'below', values: [65], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'age', operator: 'to', values: [65], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'age', operator: 'between', values: [18, 65], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'name', operator: 'like', values: ['A%'], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'name', operator: 'glob', values: ['A*'], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'name', operator: 'starts', values: ['A'], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'name', operator: 'ends', values: ['a'], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'role', operator: 'any', values: ['admin', 'member'], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'role', operator: 'none', values: ['guest'], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'bio', operator: 'absent', values: [], connector: 'and' })
	.collect()
await users
	.query()
	.condition({ column: 'bio', operator: 'present', values: [], connector: 'and' })
	.collect()
```

The condition operators map to familiar SQL operators. The engine
evaluates every one of them in JS over `scan`; SQLite and IndexedDB push down
provably exact candidate work and refine through these same semantics:

| Operator  | SQL           |
| --------- | ------------- |
| `equals`  | `=`           |
| `not`     | `!=`          |
| `above`   | `>`           |
| `below`   | `<`           |
| `from`    | `>=`          |
| `to`      | `<=`          |
| `between` | `BETWEEN`     |
| `like`    | `LIKE`        |
| `glob`    | `GLOB`        |
| `starts`  | `LIKE 'p%'`   |
| `ends`    | `LIKE '%s'`   |
| `any`     | `IN`          |
| `none`    | `NOT IN`      |
| `absent`  | `IS NULL`     |
| `present` | `IS NOT NULL` |

### Nested fields

Every column — in a condition, order, or aggregate — is a
[`FieldPath`](contract.md): a **single string is one
column** (never split on `.`), while an **array descends** into a nested
(object / `json`) value. The _shape_ of the argument says how to read it; the
string's _value_ is never parsed — there are no magic strings here.

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { numberShape, objectShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		events: {
			id: stringShape(),
			payload: objectShape({
				user: objectShape({ id: stringShape() }),
				at: stringShape(),
			}),
			'payload.id': stringShape(),
		},
		orders: {
			id: stringShape(),
			totals: objectShape({ amount: numberShape() }),
		},
	},
})

await db
	.table('events')
	.query()
	.condition({
		column: ['payload', 'user', 'id'],
		operator: 'equals',
		values: ['u1'],
		connector: 'and',
	})
	.collect()
await db
	.table('events')
	.query()
	.order({ column: ['payload', 'at'], direction: 'descending' })
	.limit(20)
	.collect()
await db.table('orders').query().aggregate('sum', ['totals', 'amount'])

// A dotted string is a column literally named 'payload.id' — NOT a path:
await db
	.table('events')
	.query()
	.condition({ column: 'payload.id', operator: 'present', values: [], connector: 'and' })
	.collect()
```

### Cursors

The concrete cursor implementation is internal. Consumers receive the public
`CursorInterface`, whose promise operations execute serially in invocation
order. Every call is admitted through its owning transaction ledger before
closed-cursor no-op behavior is considered, so a retained cursor still rejects
with `CONFLICT` after its transaction settles. One rejected operation does not
poison later admitted work.

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: { id: stringShape(), age: integerShape(), role: stringShape() },
	},
}).table('users')

const cursor = await users.cursor()
while (!cursor.done) {
	if (cursor.value && cursor.value.age < 18) await cursor.remove()
	else await cursor.update({ role: 'member' })
	await cursor.next()
}
cursor.close()
```

`close()` is the sole synchronous cursor operation. It is terminal and clears
`value` immediately. Work queued but not yet dispatched becomes a no-op; a
backend mutation already dispatched may settle, but no await continuation can
publish cursor state or restore `value` after close.

### Transactions

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: {
		users: {
			id: stringShape(),
			name: stringShape(),
			age: integerShape(),
			role: stringShape(),
		},
		posts: { slug: stringShape(), title: stringShape() },
	},
	primary: { posts: 'slug' },
})
const somethingWrong = false

// Commits on success; rolls every table back if the scope throws.
await db.transaction(async (transaction) => {
	await transaction.table('users').set({ id: 'u3', name: 'Cy', age: 29, role: 'member' })
	await transaction.table('posts').add({ slug: 'intro', title: 'Intro' })
	if (somethingWrong) throw new Error('abort') // → both writes undone
})

// Every accepted operation drains before settlement, including work not
// returned by the callback. Catching an accepted rejection does not rescue
// the transaction: the tracker still rolls it back.
await db.transaction(async (transaction) => {
	void transaction.table('users').set({ id: 'u4', name: 'Dee', age: 31, role: 'member' })
	try {
		await transaction.table('posts').add({ slug: 'intro', title: 'duplicate' })
	} catch {
		// The duplicate remains a tracked transaction failure.
	}
}) // rejects CONFLICT and rolls back u4

// Iterator continuations are the tracked unit. An in-flight next() drains;
// merely creating or pausing an iterator does not hold the transaction open.
await db.transaction(async (transaction) => {
	const rows = transaction.table('users').scan()[Symbol.asyncIterator]()
	await rows.next()
	// A rows.next() requested after this callback settles throws CONFLICT.
})

// A pre-aborted signal is checked once at entry, before anything transactional runs:
await db.transaction(async () => {}, { signal: AbortSignal.timeout(0) }) // throws ABORTED
```

While the scope is active, root/imported tables, `open`, `close`, `migrate`,
and nested transactions reject with `CONFLICT`. The transaction view and every
table/query/cursor/stream derived from it are invalid after settlement. When
both the callback and a tracked operation reject, the callback rejection takes
precedence; otherwise the first tracked rejection becomes the transaction
error. `rollback(error)` reports only a completed rollback whose original
scope/drain error is still being propagated — a cleanup failure is never
reported as a successful rollback.

Root promise operations enter the shared admission ledger synchronously, before
their first `await`. `transaction()` closes root admission before it drains that
ledger, so work accepted just before the transaction is included and work
attempted just after the boundary conflicts; there is no unobserved gap where a
root write can escape into the transaction. If rollback cleanup fails, the
operation rejects `DatabaseError('DRIVER')` with exact evidence
`{ cause: rollbackFailure, transaction: originalFailure }` and emits no
`rollback` event.

### Native transactions

`transaction` uses a driver's optional native `transaction?(scope)` hook
instead of the snapshot floor. The driver passes a `StorageInterface`
capability to the callback, commits when it fulfills, rolls back when it
rejects, and invalidates the capability after settlement. The database-level
`transaction` / `commit` / `rollback` events fire the same either way:

```ts
import type { TableSchema } from '@orkestrel/database'
import { createSQLiteDriver } from '@orkestrel/database/server'

const driver = createSQLiteDriver()
const schema: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'name', storage: 'text', optional: false, nullable: false },
		],
		indexes: [],
	},
]
await driver.open(schema)
if (driver.transaction) {
	await driver.transaction(async (transaction) => {
		await transaction.write('users', 'u1', { id: 'u1', name: 'Ada' })
		const row = await transaction.read('users', 'u1')
		if (row === undefined) throw new Error('missing scoped row')
	})
}
```

A `scope` throw rolls back and preserves the original rejection unless backend
cleanup itself fails. A commit failure rejects the callback operation and never
publishes candidate state in backends such as `JSONDriver`.

### Migrations

Migrations are caller-driven — `planMigration` structurally diffs a
deployed and a declared `TableSchema[]` into an ordered `Migration`, which
the caller packages as `MigrationInput` for a driver's optional native
`migrate?`. The input's schema changes and optional target `metadata`
commit or roll back together. `migrateRows` is the pure per-table row transform
a driver's `migrate` can lean on. Calling `planMigration` + `driver.migrate?`
directly is still the low-level path
(useful outside a `Database`, e.g. against a bare driver):

```ts
import type { TableSchema } from '@orkestrel/database'
import { createMemoryDriver, migrateRows, planMigration } from '@orkestrel/database'

const deployed: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [],
	},
]
const declared: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: true, nullable: true },
		],
		indexes: [],
	},
]
const plan = planMigration(deployed, declared) // { from: 0, to: 1, steps: [...] }
const driver = createMemoryDriver()
await driver.open(deployed) // open the physical schema that is actually deployed
await driver.migrate?.({ plan }) // atomic schema + row migration

// The pure row-shape transform a driver's own `migrate` can apply:
const rows = [{ id: 'a', name: 'Ada', legacy: true }]
migrateRows(rows, [{ operation: 'column.remove', table: 'users', column: 'legacy' }])
// => [{ id: 'a', name: 'Ada' }]
```

`Database.migrate(deployed, options?)` wraps that same diff-then-apply
orchestration against the database's OWN declared `tables`, so the caller
only has to track what is currently deployed:

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
})
const deployed: readonly import('@orkestrel/database').TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [],
	},
]
const plan = await db.migrate(deployed) // diffs deployed vs. declared, applies it, emits 'migrate'
plan.steps // the applied Migration steps

db.emitter.on('migrate', (applied) => console.log('migrated to', applied.to))
```

### Versioned auto-migrate on open

A driver that implements the paired `metadata` / `stamp` can skip the
caller-driven `Database.migrate` call entirely: pass
`DatabaseOptions.version`, and `open()` reconciles the driver's persisted
schema against the declared one for you, migrating and re-stamping as needed.

A partial capability is deliberately inert: when only `metadata` or only `stamp`
exists, `open()` calls neither hook and performs no migration, stamping, or
`migrate` event emission. Reconciliation requires `version`, `metadata`, and
`stamp` together.

```ts
import { createDatabase } from '@orkestrel/database'
import { createJSONDriver } from '@orkestrel/database/server'
import { integerShape, optionalShape, stringShape } from '@orkestrel/contract'

const path = 'data/versioned.json'
const db = createDatabase({
	driver: createJSONDriver(path),
	tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
	version: 2, // the declared schema version
})

await db.open() // fresh store → stamps { version: 2, schema } for next time
await db.open() // idempotent while this handle remains open
db.emitter.on('migrate', (applied) => console.log('auto-migrated to', applied.to))
await db.close()

// close() is terminal for this handle and every imported view. A persistent
// reopen uses a fresh driver/database handle over the same store.
const same = createDatabase({
	driver: createJSONDriver(path),
	tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
	version: 2,
})
await same.open() // same version + canonical schema → no migration or metadata rewrite
await same.close()

// Reopen the SAME store with a higher version and a changed declaration.
// The backend first opens DriverMetadata.schema as the deployed physical schema;
// Database then diffs deployed → declared and submits one atomic
// { plan, metadata: { version, schema } } migration input.
const upgraded = createDatabase({
	driver: createJSONDriver(path),
	tables: {
		users: {
			id: stringShape(),
			name: stringShape(),
			age: integerShape(),
			visits: optionalShape(integerShape()),
		},
	},
	version: 3,
})
await upgraded.open() // schema + rows + version-3 metadata publish together
```

### Owning driver metadata

`DriverMetadata` is exact JSON and crosses one public ownership boundary. A driver
snapshots it at every `stamp` / migration ingress and returns a fresh deeply
frozen copy from `metadata()`, so neither later mutation of the caller's input nor
mutation attempts against a returned value can alter stored version state.
`cloneDriverMetadata` provides that boundary to every driver:

```ts
import { cloneDriverMetadata } from '@orkestrel/database'

const source = {
	version: 3,
	schema: [
		{
			name: 'users',
			primary: 'id',
			columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
			indexes: [],
		},
	],
}
const metadata = cloneDriverMetadata(source)

Object.isFrozen(metadata) // true
Object.isFrozen(metadata.schema[0]) // true
metadata !== source // true
```

The total guards inspect untrusted input without throwing, while the cloners
establish owned, deeply frozen boundaries for the complete schema or migration.
The browser projection consumes the same portable table schema:

```ts
import {
	cloneDriverSchema,
	cloneMigrationInput,
	isColumnSchema,
	isDriverMetadata,
	isDriverSchema,
	isMigration,
	isMigrationInput,
	isMigrationStep,
	isTableSchema,
	bindRowKey,
	normalizeDriverSchema,
	projectMigrationSchema,
	shapeToColumnSchema,
	type TableSchema,
} from '@orkestrel/database'
import { schemaToStore } from '@orkestrel/database/browser'
import { optionalShape, stringShape } from '@orkestrel/contract'

const table: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
	indexes: [],
}
const plan = { from: 1, to: 2, steps: [{ operation: 'table.add', table }] }
const input = { plan, metadata: { version: 2, schema: [table] } }

isColumnSchema(table.columns[0])
isTableSchema(table)
isDriverSchema([table])
isMigrationStep(plan.steps[0])
isMigration(plan)
isDriverMetadata(input.metadata)
isMigrationInput(input)
cloneDriverSchema([table])
cloneMigrationInput(input)
bindRowKey({ name: 'Ada' }, 'id', 'u1')
normalizeDriverSchema([table])
shapeToColumnSchema('nickname', optionalShape(stringShape()))
projectMigrationSchema([], cloneMigrationInput(input).plan.steps)
schemaToStore(table)
```

The helper delegates exact JSON ownership to Contract 0.0.9's
`cloneJSONRecord`, then validates the owned output as `DriverMetadata`. A malformed
shape, cycle, function, accessor, or hostile/revoked proxy throws
`DatabaseError('VALIDATION')` with `context.path === 'metadata'`; clone/traversal
failures are retained only as `context.cause`, so no raw Contract or caller
error crosses the Database surface. Hostile values are never stringified or
embedded in the diagnostic.

`JSONDriver` applies that ownership rule at every file-backed seam: valid parsed
metadata is cloned, while a present malformed metadata value fails the whole
open with a payload-safe `DRIVER` error. Root `stamp` / `migrate`
and their scoped candidate equivalents clone metadata synchronously before
queue admission or another await can yield to caller mutation. Candidate/root
publication, serialization, and every `metadata()` copy-out clone again, so the
serialized value is an owned validated snapshot and each returned value is
distinct and deeply frozen. General rows retain `MemoryDriver`'s native
structured-clone behavior and are not forced through the JSON metadata cloner.

`SQLiteDriver` applies the same boundary at persisted-row ingress, every
root/scoped `stamp` and `migrate` ingress, and every `metadata()` copy-out.
Root lifecycle and scoped token gates run before hostile metadata traversal;
valid migration metadata is cloned before its first DDL statement. Malformed
stored metadata fails closed with `DRIVER`, while valid copy-outs are distinct
and deeply frozen. General SQLite rows continue through
their declared codecs and native `SQLiteValue`s, never the JSON metadata cloner.

### Driver conformance

`conformDriver(factory)` runs the same invariant battery every backend must
uphold — call it from a new driver's own test suite (or a smoke script) to
prove it is a drop-in `DriverInterface`:

```ts
import { conformDriver, createMemoryDriver } from '@orkestrel/database'

await conformDriver(() => createMemoryDriver()) // resolves once every phase passes
// A driver that violates an invariant rejects with DatabaseError('CONFORMANCE', ...)
```

### Auditing a custom driver

`auditDriver(factory)` drains the full battery instead of failing fast,
collecting every violation — useful when developing a new backend and
wanting the complete picture in one run rather than fixing one invariant at
a time:

```ts
import { auditDriver, createMemoryDriver } from '@orkestrel/database'

const findings = await auditDriver(() => createMemoryDriver())
// [] — a fully conformant driver
for (const finding of findings) console.log(`${finding.check}: ${finding.message}`)

// The lower-level generator these two build on — one phase per yield, lazy:
import { driverFindings } from '@orkestrel/database'
for await (const finding of driverFindings(() => createMemoryDriver())) {
	console.log(finding.check, finding.context)
}
```

### Key factories

When the primary column is optional and a write omits it, the table uses
global `crypto.randomUUID()` by default. `DatabaseOptions.generator` is an
authoritative override; numeric primary columns require one because the
default generator returns a string. Explicit primary values never invoke it.
Browser consumers relying on the default require a secure context that exposes
`crypto.randomUUID()`; otherwise supply a generator or an explicit primary.

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, optionalShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { posts: { id: optionalShape(stringShape()), title: stringShape() } },
})
await db.table('posts').set({ title: 'Hello' }) // a fresh UUID

const numbered = createDatabase({
	driver: createMemoryDriver(),
	tables: { events: { id: optionalShape(integerShape()), name: stringShape() } },
	generator: () => 42,
})
await numbered.table('events').set({ name: 'opened' }) // 42
```

### Observing

Both the `Database` and each `Table` expose a typed `emitter` (AGENTS §13)
carrying its lifecycle for fire-and-forget observers — logging, metrics,
**cache invalidation, a sync layer**. The vocabulary is split by audience:
the **database** carries the connection + transaction moments, each **table**
the per-row mutations (KEY only — no value payload, to keep fan-out lean; a
consumer that needs the value re-reads it). Subscribe via
`entity.emitter.on(...)`, or wire initial listeners through the reserved
`on?` option. **Emitting is observation-only**: every event fires strictly
AFTER the relevant transition, so a listener can never change what a write
or a transaction does.

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape(), name: stringShape() } },
	on: { commit: () => console.log('transaction committed') },
})

const users = db.table('users') // hold the handle (the documented practice) and observe it
users.emitter.on('write', (key) => console.log('invalidate users', key))
users.emitter.on('remove', (key) => console.log('invalidate users', key))
db.emitter.on('rollback', (error) => console.warn('transaction rolled back', error))
```

The event vocabulary:

| Entity     | Event map          | Events                                                                                          |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `Database` | `DatabaseEventMap` | `open()` · `close()` · `transaction()` · `commit()` · `rollback(error)` · `migrate(migration)`  |
| `Table`    | `TableEventMap`    | `write(key)` · `remove(key)` · `clear()` (key only — `set` / `add` / `update` all emit `write`) |

`open` fires once when the handle's driver connects (an explicit `open()`, or
the lazy first-use connect); `close`
when the driver is released; `transaction` when a scope begins after its
native boundary or fallback snapshot is acquired; `commit` only after a scope
SUCCEEDS; `rollback` only after a throwing scope's tables are all restored;
`migrate` after a migration commits. A `Table` fires `write` after any
row put (set / add / update — re-read by key if you need the new value),
`remove` after a row is deleted (a delete of an absent key emits nothing),
and `clear` after the table is emptied. Reads / queries / counts are **not**
emitted — a reader does not mutate, and those paths are too hot. Each
`db.table(name)` returns a fresh handle with its own emitter, so subscribe
on the handle you hold and operate on that same handle.

**The listener-isolation safety guarantee.** A listener throw is NEVER
allowed to escape into the engine: the emitter isolates it and routes it to
its OWN `error` handler (the `error` option, surfaced as `(error, event)`),
NOT to a domain event — so a buggy observer is isolated yet not silently
lost. The `error` handler runs in its own try/catch, so even a throwing
handler can't recurse or escape; with no handler, the throw is swallowed
silently. Every throwing listener surfaces (not just the first). Because
every emit sits after its transition AND is isolated, a buggy observer
**cannot corrupt a write or a transaction**: a throwing `commit` observer
leaves the committed state intact, a throwing `rollback` observer cannot
suppress the propagated transaction error (the original throw still
propagates, the tables still roll back), and a throwing `write` observer
leaves the written row intact — proven by the per-entity emit-safety tests.
(A `Table` is reached via the `Database`, which does not thread an `error`
handler to it, so a `Table` listener throw is swallowed silently.)

### Importing and exporting schemas

`import` defines more than one table at once from a shape map (keys are
names) and returns a typed view of those tables over the **same** driver.
`export` emits a portable definition per table — useful for moving a schema
between databases or environments and for diffing migrations.

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape(), name: stringShape() } },
})

// Define more tables at runtime; the returned view is typed and shares storage.
// Compose every imported view before the first open/use; every view shares one lifecycle context.
const audit = db.import(
	{
		logs: { id: stringShape(), message: stringShape(), at: integerShape() },
		sessions: { id: stringShape(), user: stringShape() },
	},
	{ sessions: 'id' },
)
await audit.table('logs').set({ id: 'l1', message: 'started', at: 1 })

// Export a portable schema (JSON Schema is environment-agnostic).
const portable = db.export()
const exported = portable.users
if (exported === undefined) throw new Error('Expected the users definition')
exported.schema // a JSON Schema document
exported.columns // the source column map (re-imports via `import` in a TS environment)
exported.primary // 'id'
```

### Introspection & seeding

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { stringShape } from '@orkestrel/contract'

const users = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape(), name: stringShape() } },
}).table('users')
const value: unknown = { id: 'u1', name: 'Ada' }

users.contract.schema // the table's JSON Schema (from the shape)
users.contract.generate() // a valid seed row — reproducible with a seeded RandomFunction
users.contract.is(value) // the row guard
```

### Connecting eagerly

The driver connects lazily on first table use; call `open` to connect
eagerly instead (useful to fail fast at startup, before the first request):

```ts
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape() } },
})
await db.open() // connects now — table() calls after this never wait on it
```

Concurrent eager and lazy callers share one readiness attempt. A physical
driver-open failure clears that attempt, so a later `open()` or table operation
retries instead of inheriting a permanently rejected promise. When physical
open succeeds and version reconciliation then fails, `status` remains `open`
and the single `open` event records that physical transition. The shared
readiness promise and ordinary table work still reject until a later automatic
retry reconciles successfully; recovery reuses the same open physical handle
instead of creating a duplicate connection.
An explicit migration failure is stricter: ordinary work continues to receive
that exact failure until another explicit `migrate(deployed)` succeeds.

`close()` first stops new root admissions, drains every root operation admitted
synchronously before the close/transaction boundary, waits for any shared
readiness attempt to settle, and releases the driver. Close is idempotent but
terminal: the database handle and every imported view remain `closed`; reopen a
persistent store with a fresh driver/database handle.

### Driver primitives

A `DriverInterface` is the irreducible storage primitive every backend
implements; `Database` / `Table` are the ergonomic layer built on it. Calling
it directly (as `Table` does internally) shows the whole REQUIRED surface:

```ts
import type { TableSchema } from '@orkestrel/database'
import { createMemoryDriver } from '@orkestrel/database'

const driver = createMemoryDriver()
const schema: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [],
	},
]
await driver.open(schema)
await driver.stamp?.({ version: 1, schema })
await driver.insert('users', 'u1', { id: 'u1', name: 'Ada' }) // duplicate → CONFLICT
await driver.write('users', 'u1', { id: 'u1', name: 'Ada Lovelace' }) // upsert
await driver.read('users', 'u1') // { id: 'u1', name: 'Ada' } | undefined
for await (const row of driver.scan('users')) row // every row, key order
await driver.keys('users') // readonly Key[]
const rollback = await driver.snapshot() // capture, then...
await driver.delete('users', 'u1') // boolean
await rollback() // ...restore the captured state
await driver.clear('users')
await driver.close()
```

### Query engine helpers

The pure functions behind `TableInterface` and `QueryInterface` — useful
directly when building a new driver's native `records` / `aggregate` hook:

```ts
import type { Condition } from '@orkestrel/database'
import { integerShape } from '@orkestrel/contract'
import {
	applyQuery,
	compareValues,
	computeAggregate,
	equalsValue,
	extractKey,
	filterRows,
	matchesFuzzy,
	matchesGlobPattern,
	matchesLikePattern,
	matchesCondition,
	matchesQuery,
	shapeToColumnStorage,
	sortRows,
	validatePage,
	matchesWildcardPattern,
} from '@orkestrel/database'

compareValues(1, 2) // -1 — a total order over mixed types
matchesFuzzy('database', 'dbe') // true — case-folded, ordered, non-contiguous
matchesWildcardPattern('hello', 'h%o', '%', '_', true) // true — the shared LIKE/GLOB engine
matchesLikePattern('hello', 'h%o') // true — case-insensitive
matchesGlobPattern('hello', 'h*o') // true — case-sensitive

const condition: Condition = {
	column: 'age',
	operator: 'above',
	values: [18],
	connector: 'and',
}
matchesCondition({ age: 36 }, condition) // true
matchesQuery({ age: 36 }, [condition]) // true — folds every condition
filterRows([{ age: 36 }, { age: 12 }], [condition]) // [{ age: 36 }] — the count/aggregate basis

sortRows([{ age: 36 }, { age: 18 }], [{ column: 'age', direction: 'ascending' }])
applyQuery([{ age: 36 }, { age: 18 }], { conditions: [condition], limit: 1 })
validatePage({ limit: 25, offset: 0 }) // valid; fractions, negatives, NaN, and infinity throw
computeAggregate([{ age: 36 }, { age: 18 }], 'average', 'age') // 27

extractKey({ id: 'u1' }, 'id') // 'u1'
shapeToColumnStorage(integerShape()) // 'integer' — the type `open` hands a driver
equalsValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) // true — structural, not reference, equality
```

### Persistence with the JSON driver

```ts
import { createDatabase } from '@orkestrel/database'
import { createJSONDriver } from '@orkestrel/database/server'
import { stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createJSONDriver('data/app.json'),
	tables: { users: { id: stringShape(), name: stringShape() } },
})
await db.table('users').set({ id: 'u1', name: 'Ada' }) // persisted to app.json
```

`JSONDriver` serializes `open` with every mutation. It reads persisted metadata
first and, when versioned, adopts `DriverMetadata.schema` as the deployed schema
before target reconciliation. Only `ENOENT` proves a fresh store. Every other
read failure and every existing invalid document fails closed with a
payload-safe `DRIVER` error, leaving prior bytes and in-memory publication
unchanged. The accepted document has exactly `tables` and optional `metadata`;
its table keys exactly match the selected deployed schema, each table is an
array, and every entry is a record with a usable, unique declared primary key.
A bare `{ tables }` document remains a valid unstamped legacy file. No corrupt
document is rewritten, quarantined, or repaired automatically; external repair
followed by `open` on the same driver retries normally. It is a decorator over
`MemoryDriver`, but each nontransactional point mutation is one exclusive
queue job spanning preimage capture, speculative memory change, temp-file
staging, atomic rename, and success or restoration. Reads wait behind that
job, so they never observe its speculative state. An abort while queued rejects
promptly and the job later exits before touching memory; an abort during
staging uses the native file-write signal, removes the temp file, restores the
preimage, and only then rejects `ABORTED`. `rename` dispatch is the
commit point that cannot be aborted: after dispatch, the driver awaits and reports the
real rename result. A failure before or at rename restores memory before the
next queued writer starts, so concurrent writers cannot persist an older
snapshot over a later mutation. Callback transactions and root
`migrate({ plan, metadata })` build an isolated candidate and publish FILE FIRST:
the temp-file replacement must succeed before committed memory, schema, or
metadata is swapped. Thus readers never observe state that durable storage did
not accept, and a persistence failure discards the entire candidate. After a
persistence fault, temporary-file cleanup completes before rejection. Cleanup
success preserves the existing precedence: a precommit fired signal rejects
`ABORTED`, otherwise the operation rejects `DRIVER` with the native/raw fault
only at `context.cause`. If cleanup fails too, the top-level error is `DRIVER`
with `context` containing the exact `path`, deterministic sibling `temp`, the
original or abort-mapped `cause`, and the native `cleanup` fault. Root memory is
restored before that error leaves the exclusive queue, so the next operation
can proceed after the temporary obstruction is removed. A successful staging
write requests native `flush: true` before the same-directory atomic rename.

`JSONDriver.snapshot()` captures owned row data together with the table schema
needed to decode that capture. Its rollback thunk is repeatable and restores
data only into the driver's current schema: current metadata is never rewound,
a captured table removed after capture is skipped, and a table added later is
preserved. Replaying the same thunk again produces the same row result without
replacing the current schema or metadata.

### Compiling input to SQL

The server's pure `compilers.ts` turns a core `QueryInput` (the same one
`applyQuery` folds) into the `WHERE` / `ORDER BY` / `LIMIT` tail of a
`SELECT`, with `?`-bound parameters in clause order — the payload a native SQLite
driver's `records` hook runs directly:

```ts
import {
	compileAggregateSQL,
	compileColumnSQL,
	compileFieldSQL,
	compileQuerySQL,
	deriveSQLiteIndexName,
	matchesAggregateExactly,
	matchesSQLiteAffinity,
	quoteIdentifier,
	schemaToIndexes,
	schemaToTable,
	stepToSQL,
} from '@orkestrel/database/server'
import type { TableSchema } from '@orkestrel/database'

const schema: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
	],
	indexes: [],
}

compileQuerySQL(
	{ conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] },
	schema,
) // { sql: 'WHERE "age" >= ? ORDER BY "id"', parameters: [18] }

quoteIdentifier('order') // '"order"'
deriveSQLiteIndexName('users', ['age']) // 'idx_5_users_3_age'
compileColumnSQL('integer') // 'INTEGER'
compileFieldSQL(['profile', 'score']) // 'json_extract("profile", \'$.score\')'
compileAggregateSQL('average', 'age') // 'AVG("age")'
matchesAggregateExactly('minimum', 'age', schema) // true
matchesSQLiteAffinity('INTEGER', 'integer') // true
schemaToTable(schema) // CREATE TABLE IF NOT EXISTS …
schemaToIndexes(schema) // []
stepToSQL({ operation: 'index.add', table: 'users', index: ['age'] })

// A parameterized SQLite binding runs it directly:
// db.prepare(`SELECT * FROM "users" ${sql}`).all(...parameters)
```

### Exact-or-refine vs. narrow-then-refine native reads

A native override earns the engine's trust one of two ways (AGENTS §21).
**Prove-exactness-or-refine** (`SQLiteDriver`): the backend has real typed
columns and indexes, so it compiles the `QueryInput` straight to SQL and runs
it natively ONLY when `matchesQueryExactly` first proves the SQL and the engine
agree on every condition/order term for that schema — otherwise it falls
back to a full scan refined through the same core engine (never a "trust
blindly" path). **Narrow-then-refine**
(`IndexedDBDriver`): the backend can only prove a candidate SUPERSET range-exact
(a key-range pushdown), so it fetches that superset and hands it to the SAME
core engine every scan-only driver uses (`applyQuery` / `matchesQuery`),
which refines it down to the exact result — conformance is earned by "never
under-fetch," not by native filtering. Both are indistinguishable from the
caller's side: `Table.records` / `count` / `stream` return identical rows
either way; only the path to get there differs.

```ts
import type { Condition, TableSchema } from '@orkestrel/database'
import {
	matchesConditionExactly,
	matchesQueryExactly,
	matchesOrderExactly,
} from '@orkestrel/database/server'

const schema: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
	],
	indexes: [],
}

const exact: Condition = {
	column: 'age',
	operator: 'above',
	values: [18],
	connector: 'and',
}
matchesConditionExactly(exact, schema) // true — a plain comparison over a typed column

const notExact: Condition = {
	column: 'age',
	operator: 'above',
	values: [null],
	connector: 'and',
}
matchesConditionExactly(notExact, schema) // false — a null operand refines instead

matchesOrderExactly({ column: 'age', direction: 'ascending' }, schema) // true — a flat, orderable column

matchesQueryExactly(
	{ conditions: [exact], order: [{ column: 'age', direction: 'ascending' }] },
	schema,
) // true
```

### Persistence with the SQLite driver

```ts
import { createDatabase } from '@orkestrel/database'
import { createSQLiteDriver } from '@orkestrel/database/server'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createSQLiteDriver({ path: 'data/app.sqlite' }), // or createSQLiteDriver() for ':memory:'
	tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
})
await db.table('users').set({ id: 'u1', name: 'Ada', age: 36 }) // persisted to app.sqlite

// Native querying, paging, and aggregation — compiled to SQL, no engine re-filter:
await db
	.table('users')
	.query()
	.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
	.order({ column: 'age', direction: 'descending' })
	.collect()
await db
	.table('users')
	.query()
	.condition({ column: 'age', operator: 'above', values: [18], connector: 'and' })
	.aggregate('average', 'age')

// Real transactions and atomic migration ship with it:
await db.transaction(async (transaction) => {
	await transaction.table('users').update('u1', { age: 37 })
}) // real BEGIN/COMMIT/ROLLBACK, not the snapshot floor

// createSQLiteDriver accepts a SQLiteDriverOptions bag:
createSQLiteDriver({
	path: 'data/app.sqlite',
	timeout: 5000,
	references: true,
	pragmas: { journal_mode: 'WAL' }, // applied via pragma() right after connect(), in order
})
```

`SQLiteDriver` is the fully-native backend — it implements every optional
`DriverInterface` hook (`records?` / `aggregate?` / `transaction?`
/ `stream?` / `migrate?` / `metadata?` / `stamp?`). Reopen the same `path` with a
higher `DatabaseOptions.version` and it reconciles automatically through its
reserved `_metadata` table (`METADATA_TABLE`) — see
[Versioned auto-migrate on open](#versioned-auto-migrate-on-open); `open()`
throws `DatabaseError('VALIDATION')` if a declared table is literally named
`_metadata`, so the collision is caught immediately rather than silently
corrupting metadata. `open()` creates only `_metadata` first, reads
`DriverMetadata.schema`, and then creates or validates that DEPLOYED schema before
`Database` reconciles it with the declaration. A root
`migrate({ plan, metadata })` uses one native transaction for DDL, row changes, and
metadata. The same call inside a callback transaction uses a SQLite savepoint:
the wrapper deliberately provides raw `exec`, not a savepoint manager, so the
driver owns one guarded fixed internal SQL literal. If caller code catches its
failure, the failed inner migration is rolled back to that savepoint while the
surrounding transaction remains active and may continue safely. Snapshot
capture and replay, plus public `close()`, contain their complete native bodies
inside `#guard`; no raw SQLite fault crosses the driver boundary. Candidate
schema state becomes live only after the native commit. Point `write` / `insert` /
`delete` check `OperationOptions.signal`
immediately before the synchronous SQLite call; that call entry is the commit
point, so there is no post-check that could relabel a completed commit.

### Persistence with the IndexedDB driver

```ts
import { createDatabase } from '@orkestrel/database'
import { createIndexedDBDriver } from '@orkestrel/database/browser'
import { stringShape } from '@orkestrel/contract'

// Feature-detect before reaching for it — IndexedDB is a browser-only global.
if (typeof indexedDB !== 'undefined') {
	const db = createDatabase({
		driver: createIndexedDBDriver('app'),
		tables: { users: { id: stringShape(), name: stringShape() } },
	})
	await db.table('users').set({ id: 'u1', name: 'Ada' }) // persisted to IndexedDB
	await db
		.table('users')
		.query()
		.condition({ column: 'id', operator: 'equals', values: ['u1'], connector: 'and' })
		.collect() // pushed down to a key range
}
```

`IndexedDBDriver.open()` first makes a metadata-only bootstrap connection and,
inside one readonly transaction, tests whether the `'metadata'` key exists and
reads its value. Absence returns `undefined`; a present malformed value
(including stored `undefined`) throws a payload-safe `DRIVER` error without
publishing schema/identity/connection state or changing the record. The
bootstrap closes in every outcome, so external repair or version activity is
not blocked and the same driver may retry. It then connects the deployed
`DriverMetadata.schema` plus `__metadata__`; it does not create the target declaration
before reconciliation. The driver narrows a `QueryInput` to a key-range candidate over the
primary key or a single-column secondary index (`selectPlan`), then lets the
core engine refine it to the exact result — see
[Exact-or-refine vs. narrow-then-refine native reads](#exact-or-refine-vs-narrow-then-refine-native-reads).
It implements `records?` / `stream?` / `migrate?` / `metadata?` /
`stamp?` (persisted into a reserved `__metadata__` store, `METADATA_STORE` —
`open()` throws `DatabaseError('VALIDATION')` if a declared table is
literally named `__metadata__`), but OMITS `transaction?` (the underlying
`IDBTransaction` auto-commits the moment control yields to a non-IDB
`await`) and `aggregate?` (IndexedDB has no native SUM/AVG/MIN/MAX) by
IndexedDB's own nature. A non-empty `migrate({ plan, metadata })` performs DDL,
row transformations, and the metadata write in the SAME versionchange
transaction; a metadata-only input uses one ordinary `__metadata__` write
transaction. A failed upgrade reconnects the old deployed schema. Each point
`write` / `insert` / `delete` still uses one explicit
wrapper `database.write(table, scope)` transaction: the signal aborts it only
while active, a signal-driven rollback maps to `DatabaseError('ABORTED')`, and
native transaction completion is the commit boundary a late abort cannot
rewrite.
Every public `QueryInput` boundary also calls `validatePage`: `limit` and
`offset`, when present, must be finite nonnegative integers. Validation is
deterministic (`limit` before `offset`), non-finite diagnostics retain
`'NaN'` / `'Infinity'` rather than JSON-coercing to `null`, and zero is
legal. Return kind determines timing: `Query.limit` / `Query.offset` and
`AsyncIterable` factories (`Table.scan` and every direct driver `stream`)
throw synchronously, while Promise terminals (`Table.records` / `count` /
`aggregate` and native Promise hooks) return rejected promises. Every path
reports identical `VALIDATION` evidence and applies the same page predicate.
Failed query-builder validation does not mutate builder state. `count` and
`aggregate` validate paging even though valid paging remains intentionally
ignored by their unpaged semantics.

### IndexedDB pushdown planning

The pure planner behind `IndexedDBDriver`'s native `records?` /
`stream?` — useful directly to see what a `QueryInput` pushes down to before it
ever touches a browser database:

```ts
import type { Condition, TableSchema } from '@orkestrel/database'
import { isKey } from '@orkestrel/database'
import { conditionToRange, deriveIndexedDBIndexName, selectPlan } from '@orkestrel/database/browser'

const schema: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
	],
	indexes: [['age']],
}

isKey('u1') // true — a string is a usable IndexedDB key
isKey(true) // false — a boolean is not
deriveIndexedDBIndexName(['city', 'age']) // '2#4:city3:age'

const equalsAge: Condition = {
	column: 'age',
	operator: 'equals',
	values: [30],
	connector: 'and',
}
conditionToRange(equalsAge) // an IDBKeyRange.only(30) — an exact comparison operator

// A full scan (no condition qualifies for pushdown) returns an empty plan —
// the driver then reads every row and lets the core engine filter it exactly:
selectPlan(undefined, schema, ['age']) // {}

// A comparison over the indexed `age` column narrows to that index's range:
selectPlan(
	{ conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] },
	schema,
	['age'],
) // { index: 'age', range: an IDBKeyRange bounding age >= 18 }
```

### IndexedDB error mapping

`IndexedDBDriver` never lets a raw backend fault cross its `DriverInterface`
surface — every one is mapped to a `DatabaseError`, the original preserved
as `context.cause`:

```ts
import { mapIndexedDBError, mapMigrationError } from '@orkestrel/database/browser'
import type { IndexedDBError } from '@orkestrel/indexeddb'

declare const fault: IndexedDBError // a caught backend fault

mapIndexedDBError(fault) // → DatabaseError('CONFLICT' | 'CLOSED' | 'DRIVER', ...)
mapMigrationError(fault) // → the same, but an UPGRADE fault becomes 'MIGRATION'
```

### Practices

- **Declare tables in `createDatabase({ tables })` and hold the handles** —
  `const users = db.table('users')`; reuse them rather than re-resolving.
- **Writes coerce, reads narrow.** At an unknown-input boundary, normalize
  loose data (`'41'`) through `table.contract.parse` before a typed write;
  trust `get` / `records` to return the row type.
- **Use `resolve` when absence is an error**, `get` when it is expected —
  `resolve` throws `NOT_FOUND`, `get` returns `undefined`.
- **Reach for `query()` over `records()`** — the builder compiles a portable
  `QueryInput`; `filter` is the JS escape hatch when an operator won't express
  it.
- **Use `import` to add tables and views to the shared store before its first
  open/use** and `export` to move a schema across environments. Once opening
  starts, `import` conflicts; after `close`, it is closed.
- **Wrap multi-write invariants in `transaction`** — a throw rolls every
  table back.
- **Observe, don't drive** — subscribe to `db.emitter` (transaction
  lifecycle) / `table.emitter` (per-row `write` / `remove` / `clear`, key
  only) for cache invalidation, sync, or metrics (see
  [Observing](#observing)); emitting is a pure side-channel, so a listener
  never changes what a write or transaction does (and a throwing one can't
  corrupt it).
- **Use `MemoryDriver` for tests and ephemeral data** — no I/O, and
  `JSONDriver` swaps in unchanged when writes need to survive a restart.

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ compiler-resolved public-entry bijection across `src/core`, `src/server`, and `src/browser`, including fail-closed temporary-project coverage for barrel resolution and unsupported exports, plus each interface ↔ implementing-class method bijection.
- [`tests/src/core/cloners.test.ts`](../tests/src/core/cloners.test.ts) — `cloneDriverMetadata` ownership: normalized deeply frozen distinct output, caller-mutation isolation, and `VALIDATION` translation for malformed, cyclic, functional, accessor, and hostile/revoked-proxy inputs without leaking raw Contract or caller errors.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — total boundary guards for keys, columns, tables, driver schemas, migrations, inputs, and metadata, plus the strict page matrix, deterministic field order, exact non-finite diagnostics, and legal zero.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — the query engine: `compareValues` total order, `matchesFuzzy` ordered case-folded subsequences and Unicode lowercasing boundaries, every `matchesCondition` operator (the equality family — `equals` / `not` / `any` / `none` — via `equalsValue`, including `NaN`-equals-`NaN`; the range family via `compareValues`), `matchesQuery` folding, `filterRows`, `sortRows`, `applyQuery`, `computeAggregate`, `extractKey`, `shapeToColumnStorage`'s shape → portable-type mapping (scalars, `json` for object/array/union/raw, optional/nullable unwrap, literal-by-values), total `isDriverMetadata` rejection of malformed and hostile getter/proxy input, `equalsValue`'s structural equality, `planMigration`'s `MIGRATION` throw on a shared column's storage/nullability drift, and `conformDriver`'s battery against `MemoryDriver` and a deliberately-broken driver (each check fails with a `CONFORMANCE` `DatabaseError`), including the deepened `write-read` nested-field checks and the `snapshot-nested` phase (a shallow-copying driver fails it).
- [`tests/src/core/drivers/MemoryDriver.test.ts`](../tests/src/core/drivers/MemoryDriver.test.ts) — the driver primitive: `open(schema)` readies tables, read/write/atomic-insert/delete/keys/scan/clear + `snapshot` rollback, duplicate-insert `CONFLICT`, non-JSON row isolation via native `structuredClone`, metadata stamp/migrate/copy-out ownership through `cloneDriverMetadata`, strict stream paging, and pre-aborted point mutations rejecting `ABORTED` without changing rows.
- [`tests/src/core/Database.test.ts`](../tests/src/core/Database.test.ts) — declared tables, lazy connect, typed CRUD, custom keys, indexes, import/export, and callback transactions: whole accepted-operation drain, synchronous-throw and asynchronous-rejection reason identity, caught-operation rejection still rolling back, callback-over-drain error precedence, root/import/lifecycle/nesting barriers, stale scoped table/query/cursor/stream invalidation, and truthful successful-rollback-only events. It also covers explicit migration and versioned open: deployed-schema-first reconciliation, fresh stamp, same-version no-op, atomic upgrade input, higher-version rejection, paired-hook enforcement (metadata-only and stamp-only are inert), and migrate-event behavior.
- [`tests/src/core/TransactionIterator.test.ts`](../tests/src/core/TransactionIterator.test.ts) — direct internal continuation-lifetime coverage: tracked `next` / `return` / `throw`, synchronous source throws, missing methods, concurrent accepted continuations, idle iterators, late conflicts, and exactly-once rejected cleanup.
- [`tests/src/core/DriverIterator.test.ts`](../tests/src/core/DriverIterator.test.ts) — direct root-driver continuation coverage: pre/post-read guards, produced-row discard, terminalization, return races, missing methods, throw delegation, and exactly-once cleanup.
- [`tests/src/core/Table.test.ts`](../tests/src/core/Table.test.ts) — `Table`'s keyed CRUD + batch overloads, payload-safe bounded contract diagnostics, strict paging at every read boundary, coercion and error paths, `add` dispatch through atomic `insert` (including concurrent duplicate claims), sequential partial-batch abort semantics, and the emitter's post-commit/no-aborted-event guarantees.
- [`tests/src/core/Query.test.ts`](../tests/src/core/Query.test.ts) — `Query`'s where / and / or dispatch, ordering, synchronous strict page builders with no failed mutation, legal zero, `filter`, and aggregates.
- [`tests/src/core/Cursor.test.ts`](../tests/src/core/Cursor.test.ts) — cursor behavior over a key snapshot: `value` / `index` / `done`, serialized overlapping `next` / `update` / `remove`, rejection recovery, synchronous runner admission, terminal close before queued work and during dispatched reads/mutations, plus transaction-ledger regressions for deleted-key skipping, unawaited normalized updates, validation rollback, and retained closed/active conflicts.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createDatabase` / `createMemoryDriver` each return a working instance of their interface (a round-trip end to end).
- [`tests/src/server/drivers/JSONDriver.test.ts`](../tests/src/server/drivers/JSONDriver.test.ts) — `JSONDriver` persistence plus atomic insert and the exclusive point-mutation queue: queued abort/no late start, active staging restoration, cleanup-success error precedence, deterministic real-filesystem persistence-plus-cleanup dual failure with exact evidence and queue recovery, read isolation, concurrent-writer ordering, fail-closed real-filesystem coverage for non-absence reads, invalid syntax/documents/table sets/containers/rows/metadata, byte preservation, no partial publication, application-invalid row retention, payload-safe rejection, strict stream paging, and same-instance external-repair retry; synchronous root/scoped stamp and migration ownership, deeply frozen distinct copy-out, deployed-schema-first open, isolated callback/root-migration candidates whose rows/schema/metadata publish only after file replacement succeeds, transaction-time root scan/stream continuation conflicts with terminal cleanup, and post-native-rollback rejection replacement.
- [`tests/src/server/drivers/SQLiteDriver.test.ts`](../tests/src/server/drivers/SQLiteDriver.test.ts) — `SQLiteDriver`'s native surface: deployed-metadata-first open and reconciliation; fail-closed malformed metadata, physical schema disagreement, and persisted-table loss before DDL, including deterministic first-loss evidence, physical non-recreation, external repair, and same-driver retry; root/scoped stamp/migration ownership and distinct deeply frozen copy-out; atomic insert/duplicate `CONFLICT`; point-mutation abort boundaries; strict direct records/aggregate/stream paging; native exact-or-refine query and aggregate paths; repeatable schema-aware snapshot capture/replay plus real dropped-table and exclusive-lock failure containment/recovery; atomic `MigrationInput` schema/rows/metadata at the root; fixed-literal savepoint containment for a caught migration failure while its callback transaction remains active; candidate-schema publication only after commit; callback transaction barriers/invalidation including root continuation cleanup; payload-safe rejection; post-native-rollback rejection replacement; backend-fault mapping; and engine parity.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — the SQLite bridge: `quoteIdentifier`, codecs, row extraction, `deriveSQLiteIndexName` exact bytes, and the `matchesConditionExactly` / `matchesOrderExactly` / `matchesQueryExactly` / `matchesAggregateExactly` / `matchesSQLiteAffinity` predicates.
- [`tests/src/server/compilers.test.ts`](../tests/src/server/compilers.test.ts) — the coherent SQL-emitter cluster: column/field/aggregate compilation, table/index/migration DDL, and the strict-page `QueryInput` → SQL pipeline with exact statements and parameters.
- [`tests/src/server/integration.test.ts`](../tests/src/server/integration.test.ts) — cross-backend behavioral parity: the same `QueryInput` set run against `MemoryDriver` and `SQLiteDriver` (both exact-path and refine-path queries) produce identical rows/counts/aggregates.
- [`tests/src/browser/drivers/IndexedDBDriver.test.ts`](../tests/src/browser/drivers/IndexedDBDriver.test.ts) — `IndexedDBDriver` against real IndexedDB: metadata-only bootstrap and deployed-schema-first reopen, one-transaction `has`/`get` absence discrimination, fail-closed malformed-metadata preservation (including stored `undefined`) and persisted-store loss with deterministic first-loss evidence, physical non-recreation, extra-store retention, external repair, and same-driver retry; bootstrap-lifetime store/version capture and a competing versionchange proving the persisted final open is pinned and retryable; payload-safe errors and table rejection, closed failed state, reserved-store validation, atomic `add` insertion and duplicate `CONFLICT`, active/pre-dispatch/late abort boundaries, strict direct records/stream paging, native narrow-then-refine queries, snapshot capture-replay, schema/rows/metadata in one versionchange migration, metadata-only migration input, failed-upgrade reconnection to the old schema, metadata persistence, backend-fault mapping, and confirmation that callback `transaction` / native `aggregate` are absent.
- [`tests/src/browser/helpers.test.ts`](../tests/src/browser/helpers.test.ts) — the pushdown planner: `conditionToRange` over every comparison operator, `selectPlan` index/primary selection and lossless fallbacks, backend-error mapping, and exact `deriveIndexedDBIndexName` bytes.
- [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts) — `createIndexedDBDriver` returns a working `DriverInterface` instance (a round-trip end to end).
- [`tests/src/browser/integration.test.ts`](../tests/src/browser/integration.test.ts) — cross-backend behavioral parity: the same `QueryInput` set run against `MemoryDriver` and `IndexedDBDriver` produce identical rows/counts, including pushdown edge cases (`below`/`to` on a secondary-indexed column, a reversed `between`).

## See also

- [`contract.md`](contract.md) — the shape DSL and `createContract` a table is built on.
- [`AGENTS.md`](../AGENTS.md) — the rules; §12 errors & `Result`, §14 totality, §21 minimal interface / one engine / native overrides, §22 documentation-as-contracts.
- [`README.md`](README.md) — the guides index.
