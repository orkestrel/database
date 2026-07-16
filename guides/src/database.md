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
> an irreducible storage primitive — keyed read/write/delete, an ordered
> `scan`, key listing, and a `snapshot` — and inherits the entire WHERE /
> order / page / aggregate surface from a single pure query engine in the
> core. A backend that _can_ go faster (SQL `WHERE`, an index range)
> implements optional native hooks the engine falls back from; it never
> re-derives query semantics. So this is deliberately **not** an ORM and not
> a query abstraction layer: there is no entity graph, no migration runner,
> and no raw-SQL escape hatch — just the smallest cross-environment core that
> earns its keep. Source: [`src/core`](../../src/core). Surfaced through the
> `@src/core` barrel; two persistent drivers ship alongside it — a trusted-mode
> **SQLite** driver in [`src/server`](../../src/server) (surfaced through
> `@src/server`) with native querying, paging, aggregation, transactions, and
> atomic migration, and a narrow-then-refine **IndexedDB** driver in
> [`src/browser`](../../src/browser) (surfaced through `@src/browser`) that
> pushes a key-range candidate set down to the index and lets the core engine
> refine it to the exact result — plus the original I/O-free `MemoryDriver`
> and file-persisted `JSONDriver`.

## Surface

Declare a `tables` shape map (keys are table names) once, and reach each
table — fully typed, no annotations — with `table(name)`:

```ts
import { createDatabase, createMemoryDriver } from '@src/core'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(), // any DriverInterface — a persistent backend swaps in, same API
	tables: {
		users: { id: stringShape(), name: stringShape(), age: integerShape() },
		posts: { slug: stringShape(), title: stringShape() },
	},
	keys: { posts: 'slug' }, // non-`id` primary-key columns, per table
})

const users = db.table('users') // hold the handle; TableInterface<{ id; name; age }>

await users.set({ id: 'u1', name: 'Ada', age: 36 }) // coerced + validated through the contract
const ada = await users.get('u1') // typed { id; name; age } | undefined — narrowed, never `as`
const adults = await users.query().where('age').from(18).descending('age').all() // typed rows
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

| Class             | Kind  | Role                                                                                                                                                                    |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Database`        | class | Owns the driver and a `tables` map, lazily connects, `import`s / `export`s, runs `transaction`s.                                                                        |
| `MemoryDriver`    | class | The reference driver — nested maps; runs the same in a browser or on a server.                                                                                          |
| `JSONDriver`      | class | A persistent driver — the reference `MemoryDriver` plus JSON-file load / flush.                                                                                         |
| `SQLiteDriver`    | class | A persistent, trusted-mode driver — native querying/paging/aggregation, real transactions, atomic DDL migration, `_meta`-table versioning.                              |
| `IndexedDBDriver` | class | A persistent browser driver — narrow-then-refine querying via key-range pushdown, versionchange migration, `__meta__`-store versioning; no `transaction` / `aggregate`. |
| `Table`           | class | Typed keyed CRUD plus `query` / `cursor`; validates writes and narrows reads via its contract.                                                                          |
| `Query`           | class | The fluent query builder bound to one table.                                                                                                                            |
| `Clause`          | class | A pending condition opened by `where` / `and` / `or`; its operator closes it back to the query.                                                                         |
| `Cursor`          | class | A forward row cursor over a key snapshot for bulk in-place mutation.                                                                                                    |

### Server

| API                        | Kind      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateKey`              | function  | Generate a fresh UUID string, `node:crypto`-backed — pass as `DatabaseOptions.key` in a server environment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `META_TABLE`               | const     | The reserved single-row table name (`_meta`) `SQLiteDriver` stamps its `DriverMeta` into — a user table named `_meta` collides with it.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `isExactCondition`         | function  | Whether one `Condition` is provably SQL-vs-engine semantically identical over a `TableSchema` — `SQLiteDriver` runs it natively only when this proves true. Equality (`equals`/`not`/`any`/`none`) and `starts`/`ends` are exact on `text`/`integer`/`real`/`boolean`; range operators (`above`/`below`/`from`/`to`/`between`) are exact ONLY on `integer`/`real`/`boolean` — a `text` range REFINES (SQLite's BINARY collation orders text by Unicode code point, the engine's `compareValues` orders JS strings by UTF-16 code unit; they diverge on supplementary-plane characters). |
| `isExactOrder`             | function  | Whether one `Order` term is provably exact over a `TableSchema` — exact ONLY for a flat `integer`/`real`/`boolean` column; a `text` order term REFINES (same code-point-vs-code-unit divergence as the range operators above), and a nested path is never exact.                                                                                                                                                                                                                                                                                                                        |
| `isExactCriteria`          | function  | Whether every condition and order term in a `Criteria` is exact — the gate `SQLiteDriver` checks before trusting a native SQL path over a full-scan refine.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `matchesDeclaredType`      | function  | Whether an operand's runtime type matches a column's declared exact type (text↔string, integer/real↔finite number, boolean↔boolean) — backs `isExactCondition`.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `EXACT_COLUMN_TYPES`       | const     | The declared `ColumnType`s whose SQL EQUALITY / `starts`/`ends` comparisons are provably engine-exact under declared-type trust (`text` / `integer` / `real` / `boolean`).                                                                                                                                                                                                                                                                                                                                                                                                              |
| `EXACT_RANGE_COLUMN_TYPES` | const     | The declared `ColumnType`s whose SQL RANGE comparisons and `ORDER BY` are provably engine-exact (`integer` / `real` / `boolean` — `text` is excluded; see `isExactCondition`).                                                                                                                                                                                                                                                                                                                                                                                                          |
| `indexName`                | function  | Derive a collision-free, length-prefixed SQL index name from a table and its column list (`idx_<len>_<table>_<len>_<col>…`) — used by `schemaToIndexes` and `stepToSQL`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SQLiteDriverOptions`      | interface | `{ path?, readonly?, timeout?, foreignKeys?, pragmas? }` — the options bag `createSQLiteDriver` accepts (widened from a bare path string, back-compat).                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### SQL compilation

Pure, server-only functions that turn a core `Criteria` / `TableSchema` into
parameterized SQL text — the native-query payoff for a SQLite-backed driver.
None of these import a SQLite package; they speak strings and values only.

| API               | Kind     | Summary                                                                                                                                  |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `escapeLike`      | function | Escape `\` / `%` / `_` so a `starts` / `ends` operand matches literally under `LIKE … ESCAPE '\'`.                                       |
| `declaredType`    | function | The declared `ColumnType` of a flat column, read from the schema.                                                                        |
| `valueType`       | function | The `ColumnType` a nested (`json_extract`) operand encodes as, derived from its runtime value.                                           |
| `jsonTypeColumn`  | function | Compile a nested `FieldPath` to its `json_type(<col>, <path>)` SQL expression — disambiguates a present JSON `null` from an absent path. |
| `fragment`        | function | Compile one `Condition` to its `<column> <operator>` SQL fragment plus bound params.                                                     |
| `compileWhere`    | function | Fold conditions into one `WHERE …` clause, parenthesized left-to-right to match the engine's fold.                                       |
| `compileOrder`    | function | Compile the `ORDER BY …` clause, always ending with the primary key as tie-breaker.                                                      |
| `compilePage`     | function | Compile the `LIMIT` / `OFFSET` clause.                                                                                                   |
| `compileCriteria` | function | Compile a `Criteria` into the full SQL clause (`WHERE` + `ORDER BY` + `LIMIT`) plus bound params.                                        |
| `quote`           | function | Quote a SQL identifier (table / column name), doubling an embedded quote.                                                                |
| `fieldColumn`     | function | Compile a `FieldPath` to the SQL expression that reads it (a column, or a `json_extract` path).                                          |
| `columnSQL`       | function | Map a portable `ColumnType` to its SQLite column type keyword.                                                                           |
| `aggregateSQL`    | function | Compile an `AggregateFunction` over a `FieldPath` to its SQL aggregate expression.                                                       |
| `encodeValue`     | function | Encode a JS value to its stored `SQLiteValue` for a column's type — total, never throws.                                                 |
| `decodeValue`     | function | Decode a stored `SQLiteValue` back to its JS value — the exact inverse of `encodeValue`.                                                 |
| `encodeRow`       | function | Encode a whole `Row` to a `SQLiteRow` by its table's schema.                                                                             |
| `decodeRow`       | function | Decode a stored `SQLiteRow` back to a `Row` by its table's schema (absent columns omitted).                                              |
| `schemaToTable`   | function | Project a `TableSchema` to its `CREATE TABLE IF NOT EXISTS` statement.                                                                   |
| `schemaToIndexes` | function | Project a `TableSchema` to its `CREATE INDEX IF NOT EXISTS` statements.                                                                  |
| `stepToSQL`       | function | Project one `MigrationStep` to the DDL statement(s) `SQLiteDriver.migrate` executes for it.                                              |
| `stepToSchema`    | function | Project one `MigrationStep` onto its table's declared `TableSchema` — the bookkeeping counterpart to `stepToSQL`.                        |

### Browser

Pure functions behind the IndexedDB driver's key-range pushdown planner — a
candidate SUPERSET the core engine then refines to the exact result, never
lossy.

| API                 | Kind      | Summary                                                                                                                                              |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectPlan`        | function  | Plan an IndexedDB read for a `Criteria` — pick the index (or primary store) and `IDBKeyRange` to narrow by, falling back to a full scan.             |
| `conditionRange`    | function  | The `IDBKeyRange` one `Condition` maps to when its operator is an exact key comparison over a scalar operand, else `null`.                           |
| `isKey`             | function  | Whether a value is a scalar IndexedDB key operand (`string \| number`).                                                                              |
| `INDEXABLE_TYPES`   | const     | The `ColumnType`s that are valid, orderable IndexedDB keys (`text` / `integer` / `real`).                                                            |
| `META_STORE`        | const     | The reserved out-of-line store name (`__meta__`) `IndexedDBDriver` stamps its `DriverMeta` into — a user table named `__meta__` collides with it.    |
| `QueryPlan`         | interface | `{ index, range }` — which index (or the primary store, `null`) to read and the `IDBKeyRange` to narrow by (`null` = full scan).                     |
| `mapIndexedDBError` | function  | Map a backend `IndexedDBError` fault to its `DatabaseError` equivalent — no raw wrapper error crosses `IndexedDBDriver`'s `DriverInterface` surface. |
| `mapMigrationError` | function  | Map a backend `IndexedDBError` fault from `migrate`'s versionchange path to its `DatabaseError` equivalent (remaps `UPGRADE` to `MIGRATION`).        |
| `deriveIndexName`   | function  | Derive an IndexedDB index name from a column list — a single column is the bare name, a compound list is length-prefixed (`'2#1:a1:b'`-style).       |

### Errors

| API               | Kind     | Summary                                                                                                                                  |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `DatabaseError`   | class    | Carries a `DatabaseErrorCode` (`CLOSED` / `NOT_FOUND` / `CONFLICT` / `VALIDATION` / `ABORTED` / `MIGRATION` / `CONFORMANCE` / `DRIVER`). |
| `isDatabaseError` | function | Narrow an unknown caught value to a `DatabaseError`.                                                                                     |

### Query engine

The portable semantics every backend shares — pure, total functions the
driver never re-implements.

| Helper              | Kind     | Behavior                                                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `compareValues`     | function | Total ordering over arbitrary values (`undefined` < `null` < boolean < number < string) — never `NaN`. |
| `matchesCondition`  | function | Evaluate one `Condition` against a row (the per-operator predicate); a type mismatch is a non-match.   |
| `matchesCriteria`   | function | Fold a row through conditions, joining each by its `Connector` left-to-right.                          |
| `sortRows`          | function | Sort rows by an `Order` list, leaving the input untouched.                                             |
| `applyCriteria`     | function | The portable read pipeline — filter, then sort, then page.                                             |
| `computeAggregate`  | function | `count` / `sum` / `average` / `minimum` / `maximum` over a column (coerces via `parseNumber`).         |
| `extractKey`        | function | Read a row's primary key from a column when it is a usable `Key`.                                      |
| `shapeToColumnType` | function | Map a column's `ContractShape` to its portable `ColumnType` — the schema `open` hands a driver.        |
| `filterRows`        | function | Filter rows by a condition list — the shared basis behind a table's count and aggregate paths.         |
| `deepEqual`         | function | Structural equality by SameValueZero leaves — arrays by index, records by own enumerable keys.         |

### Cancellation

| API          | Kind     | Behavior                                                                                                                                                                      |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkAbort` | function | Throw an `ABORTED` `DatabaseError` (carrying `signal.reason`) when an `AbortSignal` has fired; a no-op otherwise — checked at operation boundaries and between streamed rows. |

### Migrations

Caller-driven schema migration — a pure structural diff plus a pure row
transform; version tracking is deferred to future persistent backends.

| API             | Kind     | Behavior                                                                                                                                             |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planMigration` | function | Structurally diff a deployed and a declared `TableSchema[]` into a `Migration` plan of ordered steps.                                                |
| `migrateRows`   | function | Apply one table's `MigrationStep`s to its rows — a pure transform (`column.remove` drops the field; other operations are storage-shape no-ops here). |

### Conformance

| API              | Kind     | Behavior                                                                                                                                                                    |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conformDriver`  | function | Run the framework-agnostic driver-conformance battery against a fresh `DriverInterface` per phase — throws a `CONFORMANCE` `DatabaseError` on the first violated invariant. |
| `driverFindings` | function | Lazy `AsyncIterable` over the same battery, one phase per yield (14 phases) — a fresh factory-minted driver per phase; an unexpected phase crash is captured as a finding.  |
| `auditDriver`    | function | Drain `driverFindings` to completion and collect every violation — `[]` means the driver is fully conformant.                                                               |

### Helpers & guards

Pure helpers behind the query engine's pattern matching.

| API             | Kind     | Behavior                                                                                                                                                                                                                                                                                      |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wildcardMatch` | function | Match a value against a wildcard pattern in LINEAR time (greedy two-pointer, no backtracking) — the ReDoS-safe engine; injected `any` run + `single` char + case-fold flag; throws `VALIDATION` over `MAX_PATTERN_LENGTH`.                                                                    |
| `likeMatch`     | function | Match a value against a SQL `LIKE` pattern via `wildcardMatch` (case-INSENSITIVE; `%` → any run, `_` → any char).                                                                                                                                                                             |
| `globMatch`     | function | Match a value against a `GLOB` pattern via `wildcardMatch` (case-SENSITIVE; `*` → any run, `?` → any char).                                                                                                                                                                                   |
| `isDriverMeta`  | function | Guard a value as a well-formed `DriverMeta` (`{ version, schema }`) — the boundary check every versioning driver's `meta()` narrows a stored/deserialized record through, never `as`.                                                                                                         |
| `generateUUID`  | function | Generate an RFC 4122 v4 UUID from a number source — environment-agnostic, mints collision-resistant record identifiers without host crypto (not a crypto-grade source, unlike the server's `node:crypto`-backed `generateKey`); deterministic with a seeded source, `Math.random` by default. |

### Constants

| Constant             | Kind  | Value                                                                                                                                               |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_PRIMARY`    | const | The primary-key column assumed when a table has no `keys` override (`id`).                                                                          |
| `MAX_PATTERN_LENGTH` | const | The longest `LIKE` / `GLOB` pattern `wildcardMatch` accepts before a `VALIDATION` throw — the ReDoS length bound (§6.5) on model-supplied criteria. |
| `UUID_BYTE_COUNT`    | const | The number of bytes encoded by an RFC 4122 UUID (`16`).                                                                                             |
| `UUID_BYTE_RANGE`    | const | The number of distinct values one UUID byte may hold (`256`).                                                                                       |

### Types

| Type                   | Kind      | Shape                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Key`                  | type      | `string \| number` — a primary key.                                                                                                                                                                                                                                                                                            |
| `KeyFunction`          | type      | `() => Key` — a caller-supplied key minting function, supplied via `DatabaseOptions.key`.                                                                                                                                                                                                                                      |
| `Row`                  | type      | `Record<string, unknown>` — a table row.                                                                                                                                                                                                                                                                                       |
| `ConditionOperator`    | type      | The 15 WHERE operators (`equals`, `above`, `between`, `like`, `any`, `absent`, …).                                                                                                                                                                                                                                             |
| `Connector`            | type      | `'and' \| 'or'` — how a condition joins the running result.                                                                                                                                                                                                                                                                    |
| `Condition`            | interface | `{ column, operator, values, connector }` — one compiled WHERE condition.                                                                                                                                                                                                                                                      |
| `Direction`            | type      | `'ascending' \| 'descending'`.                                                                                                                                                                                                                                                                                                 |
| `Order`                | interface | `{ column, direction }` — one ordering term.                                                                                                                                                                                                                                                                                   |
| `Criteria`             | interface | `{ conditions?, order?, limit?, offset? }` — a serializable read spec for a driver.                                                                                                                                                                                                                                            |
| `AggregateFunction`    | type      | `'count' \| 'sum' \| 'average' \| 'minimum' \| 'maximum'`.                                                                                                                                                                                                                                                                     |
| `ReadOptions`          | interface | `{ signal? }` — options for a cancellable read / iteration; an aborted signal throws `ABORTED` (checked before each yield in `scan` / `stream`, at entry elsewhere).                                                                                                                                                           |
| `DatabaseStatus`       | type      | `'idle' \| 'open' \| 'closed'`.                                                                                                                                                                                                                                                                                                |
| `DatabaseErrorCode`    | type      | `'CLOSED' \| 'NOT_FOUND' \| 'CONFLICT' \| 'VALIDATION' \| 'ABORTED' \| 'MIGRATION' \| 'CONFORMANCE' \| 'DRIVER'`.                                                                                                                                                                                                              |
| `ConformanceFinding`   | interface | `{ check, message, context }` — one violated invariant yielded by `driverFindings` / collected by `auditDriver`.                                                                                                                                                                                                               |
| `DatabaseEventMap`     | type      | The database's push observation surface (§13) — `open` · `close` · `transaction` · `commit` · `rollback(error)` · `migrate(migration)`.                                                                                                                                                                                        |
| `TableEventMap`        | type      | A table's push observation surface (§13) — `write(key)` · `remove(key)` · `clear` (key only, no value).                                                                                                                                                                                                                        |
| `Columns`              | type      | `Readonly<Record<string, ContractShape>>` — one table's `column → shape` map (an `objectShape`'s properties).                                                                                                                                                                                                                  |
| `TablesShape`          | type      | `Readonly<Record<string, Columns>>` — a database's table → columns map.                                                                                                                                                                                                                                                        |
| `RowOf`                | type      | `RowOf<C>` — the row type a `Columns` map describes (`Infer` of its `objectShape`).                                                                                                                                                                                                                                            |
| `TableKeys`            | type      | `Readonly<Record<string, string>>` — per-table primary-key column overrides.                                                                                                                                                                                                                                                   |
| `TableIndexes`         | type      | `Readonly<Record<string, readonly (readonly string[])[]>>` — per-table secondary indexes (column-name groups).                                                                                                                                                                                                                 |
| `ColumnType`           | type      | `'text' \| 'integer' \| 'real' \| 'boolean' \| 'json' \| 'blob'` — a column's portable storage type.                                                                                                                                                                                                                           |
| `ColumnSchema`         | interface | `{ name, type, nullable }` — one column of a `TableSchema`.                                                                                                                                                                                                                                                                    |
| `TableSchema`          | interface | `{ name, primary, columns, indexes }` — a backend-agnostic table description `open` hands a driver.                                                                                                                                                                                                                            |
| `MigrationStep`        | type      | A discriminated union of one schema change: `table.add` / `table.remove` / `column.add` / `column.remove` / `index.add` / `index.remove`, each naming its `table`.                                                                                                                                                             |
| `Migration`            | interface | `{ from, to, steps }` — an ordered schema migration plan moving a database from one version to another.                                                                                                                                                                                                                        |
| `TransactionInterface` | interface | `{ commit, rollback }` — the handle a driver's native `transaction` hook returns; used by `Database.transaction` in place of the snapshot floor when present.                                                                                                                                                                  |
| `DriverMeta`           | interface | `{ version, schema }` — persisted schema metadata a versioning driver stores verbatim; `meta()` returns `undefined` until the store has been `stamp`ed once.                                                                                                                                                                   |
| `DriverInterface`      | interface | The minimal storage contract: `open` (takes a `TableSchema[]`) / `close` / `read` / `write` / `delete` / `keys` / `scan` / `clear` / `snapshot`, plus optional native `records` / `count` / `aggregate` / `transaction` / `stream` / `migrate` / paired `meta` / `stamp`.                                                      |
| `DatabaseOptions`      | interface | `{ on?, error?, driver, tables, keys?, indexes?, name?, key?, version? }` — input to `createDatabase` (`on?` wires initial `DatabaseEventMap` listeners, §8; `key?` is the key factory a table uses for a keyless write; `version?` opts into open-time schema reconciliation against a versioning driver's `meta` / `stamp`). |
| `SQLiteValue`          | type      | `null \| number \| bigint \| string \| Uint8Array` — the value domain a SQLite binding accepts / returns.                                                                                                                                                                                                                      |
| `SQLiteRow`            | type      | `Record<string, SQLiteValue>` — one row as a SQLite binding returns it.                                                                                                                                                                                                                                                        |
| `CompiledSQL`          | interface | `{ sql, params }` — a parameterized SQL fragment or statement plus its bind values, produced by the `compilers.ts` functions.                                                                                                                                                                                                  |
| `TableExport`          | interface | `{ key, columns, schema }` — one table's portable definition, produced by `export`.                                                                                                                                                                                                                                            |
| `DatabaseInterface`    | interface | `emitter` / `name` / `status` / `table` / `import` / `export` / `open` / `close` / `transaction` (takes an optional `ReadOptions`) / `migrate` (diffs a deployed schema against the declared one and applies it, taking an optional `ReadOptions`).                                                                            |
| `TableInterface`       | interface | `emitter` / `name` / `primary` / `contract` + keyed CRUD (`set` / `add` / `update` / `remove` each take an optional `ReadOptions`) + `records` / `count` / `aggregate` (each taking an optional `ReadOptions`) + `scan` + `query` / `cursor`.                                                                                  |
| `QueryInterface`       | interface | The fluent builder — `where` / `filter` / `ascending` / `limit` + `stream` + terminals.                                                                                                                                                                                                                                        |
| `ClauseInterface`      | interface | The 15 operator methods, each returning the query.                                                                                                                                                                                                                                                                             |
| `CursorInterface`      | interface | `value` / `index` / `done` + `next` / `update` / `remove` / `close`.                                                                                                                                                                                                                                                           |

## Methods

The public methods of each behavioral interface — one table per type, keyed
by its backticked name, every call-signature member listed (its `readonly`
data members, e.g. `emitter` / `name` / `status` / `primary` / `contract` /
`value` / `index` / `done`, stay in the Surface rows above — `emitter` is the
typed push observation surface, see [Observing](#observing)). Each
`## Entities` class implements its interface exactly, so this doubles as the
per-instance method surface (AGENTS §22).

#### `DriverInterface`

The irreducible storage primitive; a backend implements exactly the REQUIRED
methods and inherits the entire query surface unchanged. `records` / `count`
/ `aggregate` / `transaction` / `stream` / `migrate` are **optional native
overrides** (AGENTS §21) — a backend that can push a query, a native BEGIN, a
filtered lazy read, or a schema change down implements them and the engine
prefers them, falling back to the portable path otherwise; a backend may omit
any or all of them. `meta` / `stamp` are a PAIRED optional override — a
versioning backend implements both or neither — that persist and return a
`DriverMeta` verbatim, powering `DatabaseOptions.version` reconciliation.

| Method        | Returns                            | Behavior                                                                                                                       |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `open`        | `Promise<void>`                    | Ready the tables from a derived `TableSchema[]` (a native backend builds tables/indexes; a scan-only one reads only `name`).   |
| `close`       | `Promise<void>`                    | Release the backend.                                                                                                           |
| `read`        | `Promise<Row \| undefined>`        | Read one row by key, or `undefined`.                                                                                           |
| `write`       | `Promise<void>`                    | Write one row at a key (upsert).                                                                                               |
| `delete`      | `Promise<boolean>`                 | Delete one row by key; `false` when absent.                                                                                    |
| `keys`        | `Promise<readonly Key[]>`          | List a table's keys in order.                                                                                                  |
| `scan`        | `AsyncIterable<Row>`               | Iterate a table's rows in key order.                                                                                           |
| `clear`       | `Promise<void>`                    | Empty a table.                                                                                                                 |
| `snapshot`    | `Promise<() => Promise<void>>`     | Capture state; `tables` omitted captures/restores the WHOLE store, provided captures/restores ONLY the named tables.           |
| `records`     | `Promise<readonly Row[]>`          | Optional native filtered read honoring the full `Criteria` (filter, order, page).                                              |
| `count`       | `Promise<number>`                  | Optional native count over the criteria's conditions (paging is irrelevant).                                                   |
| `aggregate`   | `Promise<number \| undefined>`     | Optional native aggregate (`COUNT`/`SUM`/`AVG`/`MIN`/`MAX`) over the criteria's conditions (paging is irrelevant).             |
| `transaction` | `Promise<TransactionInterface>`    | Optional native BEGIN; when present, `Database.transaction` uses its `commit` / `rollback` instead of the snapshot floor.      |
| `stream`      | `AsyncIterable<Row>`               | Optional natively filtered lazy iteration over a `Criteria`; drivers without it are served by the core scan fallback.          |
| `migrate`     | `Promise<void>`                    | Optional native migration — applies a `Migration` plan directly; throws `DatabaseError('MIGRATION')` on an unknown table.      |
| `meta`        | `Promise<DriverMeta \| undefined>` | Optional persisted-metadata read (PAIRED with `stamp`) — the last-stamped `DriverMeta`, or `undefined` before the first stamp. |
| `stamp`       | `Promise<void>`                    | Optional persisted-metadata write (PAIRED with `meta`) — persists `meta` verbatim for a later `meta()` to return.              |

#### `DatabaseInterface`

| Method        | Returns                                 | Behavior                                                                                                                                                                                                                              |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table`       | `TableInterface<RowOf<T[K]>>`           | The typed handle for a declared table.                                                                                                                                                                                                |
| `import`      | `DatabaseInterface<U>`                  | Define a shape map of tables; a typed view over the same driver.                                                                                                                                                                      |
| `export`      | `Readonly<Record<string, TableExport>>` | A portable `TableExport` per table.                                                                                                                                                                                                   |
| `open`        | `Promise<void>`                         | Connect the driver eagerly (otherwise lazy on first use).                                                                                                                                                                             |
| `close`       | `Promise<void>`                         | Close the database and its driver.                                                                                                                                                                                                    |
| `transaction` | `Promise<R>`                            | Run a scope; roll every table back if it throws; takes an optional `ReadOptions` (`signal` checked once, at entry).                                                                                                                   |
| `migrate`     | `Promise<Migration>`                    | Diff a deployed `TableSchema[]` against the declared schema via `planMigration`, apply the plan through the driver's optional `migrate` hook, and return the plan; takes an optional `ReadOptions` (`signal` checked once, at entry). |

#### `TableInterface`

The keyed methods batch by overload (one in → one out; array in → array
out) — a single verb, never `getMany` / `setAll`. `records()` / `scan()`
narrow every row through the table's contract guard, so a non-conforming
stored row (legacy data, a row from before a migration) never appears in
their results; `count()` / `aggregate()` operate on STORED rows WITHOUT that
guard, counting/aggregating whatever matches in storage regardless of
conformance — so `count()` CAN exceed `(await records(criteria)).length`
when storage holds non-conforming rows.

| Method      | Returns                              | Behavior                                                                                                                                                                                           |
| ----------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`       | `Promise<T \| undefined>` (or array) | Read by key(s); `undefined` per miss.                                                                                                                                                              |
| `resolve`   | `Promise<T>` (or array)              | Read by key(s); throws `NOT_FOUND` on a miss.                                                                                                                                                      |
| `has`       | `Promise<boolean>` (or array)        | Whether key(s) exist.                                                                                                                                                                              |
| `keys`      | `Promise<readonly Key[]>`            | All primary keys in order.                                                                                                                                                                         |
| `records`   | `Promise<readonly T[]>`              | Rows matching an optional `Criteria`; takes an optional `ReadOptions`.                                                                                                                             |
| `count`     | `Promise<number>`                    | Count matching an optional `Criteria`; takes an optional `ReadOptions`.                                                                                                                            |
| `aggregate` | `Promise<number \| undefined>`       | `count` / `sum` / `average` / `minimum` / `maximum` over a column; takes an optional `ReadOptions`.                                                                                                |
| `scan`      | `AsyncIterable<T>`                   | Lazy filtered iteration; `conditions` / `offset` / `limit` honored lazily, `order` IGNORED (sorted output is `records()`'s job); signal checked before each yield.                                 |
| `set`       | `Promise<Key>` (or array)            | Upsert row(s) → key(s); takes an optional `ReadOptions` (`signal` checked at entry and, for a batch, between items — already-applied items stay applied, no rollback).                             |
| `add`       | `Promise<Key>` (or array)            | Insert row(s); `CONFLICT` on a duplicate key; takes an optional `ReadOptions` (`signal` checked at entry and, for a batch, between items — already-applied items stay applied, no rollback).       |
| `update`    | `Promise<boolean>` (or array)        | Merge changes into existing row(s) and re-validate; takes an optional `ReadOptions` (`signal` checked at entry and, for a batch, between items — already-applied items stay applied, no rollback). |
| `remove`    | `Promise<boolean>` (or array)        | Delete row(s) by key; takes an optional `ReadOptions` (`signal` checked at entry and, for a batch, between items — already-applied items stay applied, no rollback).                               |
| `clear`     | `Promise<void>`                      | Empty the table.                                                                                                                                                                                   |
| `query`     | `QueryInterface<T>`                  | Open a fluent query builder.                                                                                                                                                                       |
| `cursor`    | `Promise<CursorInterface<T>>`        | Open a forward row cursor for bulk mutation.                                                                                                                                                       |

#### `QueryInterface`

`where` / `and` / `or` open a `ClauseInterface`; the rest mutate and return
the same builder; `all` / `first` / `count` / the aggregates are the
terminals.

| Method       | Returns                        | Behavior                                                                                                            |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `where`      | `ClauseInterface<T>`           | Open the first condition on a column.                                                                               |
| `and`        | `ClauseInterface<T>`           | Open a condition joined with `and`.                                                                                 |
| `or`         | `ClauseInterface<T>`           | Open a condition joined with `or`.                                                                                  |
| `filter`     | `QueryInterface<T>`            | Add a post-fetch JS predicate.                                                                                      |
| `ascending`  | `QueryInterface<T>`            | Order ascending by a column.                                                                                        |
| `descending` | `QueryInterface<T>`            | Order descending by a column.                                                                                       |
| `limit`      | `QueryInterface<T>`            | Cap the result count.                                                                                               |
| `offset`     | `QueryInterface<T>`            | Skip leading rows.                                                                                                  |
| `stream`     | `AsyncIterable<T>`             | Lazy per-row evaluation of conditions / filters / offset / limit; `order` IGNORED; takes an optional `ReadOptions`. |
| `all`        | `Promise<readonly T[]>`        | Execute → every matching row.                                                                                       |
| `first`      | `Promise<T \| undefined>`      | Execute → the first match or `undefined`.                                                                           |
| `count`      | `Promise<number>`              | Execute → the match count.                                                                                          |
| `sum`        | `Promise<number \| undefined>` | Execute → sum of a column.                                                                                          |
| `average`    | `Promise<number \| undefined>` | Execute → average of a column.                                                                                      |
| `minimum`    | `Promise<number \| undefined>` | Execute → minimum of a column.                                                                                      |
| `maximum`    | `Promise<number \| undefined>` | Execute → maximum of a column.                                                                                      |
| `aggregate`  | `Promise<number \| undefined>` | Execute → a named aggregate over a column.                                                                          |

#### `ClauseInterface`

The 15 WHERE operators; each records its condition and returns the query
(see the operator table under [Fluent queries](#fluent-queries) for the SQL
mapping).

| Method    | Returns             | Operator      |
| --------- | ------------------- | ------------- |
| `equals`  | `QueryInterface<T>` | `=`           |
| `not`     | `QueryInterface<T>` | `!=`          |
| `above`   | `QueryInterface<T>` | `>`           |
| `below`   | `QueryInterface<T>` | `<`           |
| `from`    | `QueryInterface<T>` | `>=`          |
| `to`      | `QueryInterface<T>` | `<=`          |
| `between` | `QueryInterface<T>` | `BETWEEN`     |
| `like`    | `QueryInterface<T>` | `LIKE`        |
| `glob`    | `QueryInterface<T>` | `GLOB`        |
| `starts`  | `QueryInterface<T>` | `LIKE 'p%'`   |
| `ends`    | `QueryInterface<T>` | `LIKE '%s'`   |
| `any`     | `QueryInterface<T>` | `IN`          |
| `none`    | `QueryInterface<T>` | `NOT IN`      |
| `absent`  | `QueryInterface<T>` | `IS NULL`     |
| `present` | `QueryInterface<T>` | `IS NOT NULL` |

#### `CursorInterface`

| Method   | Returns         | Behavior                                            |
| -------- | --------------- | --------------------------------------------------- |
| `next`   | `Promise<void>` | Advance to the next present row.                    |
| `update` | `Promise<void>` | Merge changes into the row at the current position. |
| `remove` | `Promise<void>` | Delete the row at the current position.             |
| `close`  | `void`          | Stop iteration (`done` becomes `true`).             |

## Contract

These invariants hold across the core database source tree ↔ this guide:

1. **DOC ↔ SOURCE bijection.** Every `function` / `const` / `class` /
   `interface` / `type` row in the `## Surface` tables is a real export of
   `src/core`, `src/server`, and `src/browser`, and every export appears as
   a Surface row — exhaustive, both directions (AGENTS §22).
2. **A table is a contract.** Every write is coerced **and** validated
   through the table's compiled contract — `set` / `add` / `update` run the
   row through `contract.parse` (coercion) and then the guard `contract.is`
   (constraints like `min` / `pattern`, which `parse` alone does not
   enforce); a row that fails throws `VALIDATION`. Reads are narrowed back to
   the table's row type through the guard — never an `as` (AGENTS §1). The
   row type is the shape's `Infer`, so a `tables` map types every table from
   one declaration.
3. **Thin driver, one engine, native overrides.** The REQUIRED
   `DriverInterface` surface is the irreducible storage primitive — keyed
   read/write/delete, an ordered `scan`, key listing, and `snapshot`. `open`
   hands the driver a derived `TableSchema[]` (each table's `columns`, their
   portable `ColumnType` via `shapeToColumnType`, the `primary` key, and declared
   `indexes`) so a native backend can build real tables and indexes; a
   scan-only backend reads only `name`. The pure, total query engine
   (`applyCriteria` / `matchesCriteria` / `computeAggregate` / …) over `scan`
   is the default and the only REQUIRED path. A backend MAY implement the
   optional native `records?` / `count?` / `aggregate?` / `transaction?` /
   `stream?` / `migrate?` where it has a faster or more native path, and the
   engine prefers each when present — falling back to the portable path
   otherwise (AGENTS §21). Because `aggregate?` legitimately resolves to
   `undefined` (a sum over zero rows), `Table.aggregate` decides the hook ran
   by its **presence** (a present method returns a Promise; `?.()` is
   `undefined` only when the method is absent), never by the resolved value.
   Neither reference driver implements `records?` / `count?` / `aggregate?`,
   so every query runs the engine over key-ordered `scan`; both DO implement
   `stream?` and `migrate?` (`MemoryDriver.stream` lazily filters `scan` via
   the engine; `JSONDriver.stream` delegates to its inner `MemoryDriver`).
   `MemoryDriver` still lacks a native `transaction?`, so its transactions
   always use the snapshot floor; `JSONDriver` now DOES implement
   `transaction?` — a flush-coalescing wrapper over the inner memory driver
   (writes during the scope skip their per-mutation flush; `commit` issues
   one atomic flush of the net state, `rollback` restores the pre-transaction
   snapshot then flushes it; re-entering or double-settling a transaction
   throws `CONFLICT`) — so `Database.transaction` over a `JSONDriver` prefers
   this native path over the snapshot floor. Both reference drivers now also
   implement the paired `meta?` / `stamp?` — `MemoryDriver` in-process only
   (the `DriverMeta` lives in instance memory), `JSONDriver` persisted:
   the file is `{ meta?: DriverMeta, tables }`, with `meta` present only
   once the store has been `stamp`ed at least once (an old, pre-versioning
   file — bare `{ tables }` — reads back as unstamped, i.e. `meta()` resolves
   `undefined`, preserving backward compatibility). A `JSONDriver` write-path
   fault (`mkdir` / `writeFile` / `rename` failing during `#serialize`)
   surfaces as a `DatabaseError` `DRIVER` (carrying `path` in `context`) —
   an unexpected infrastructure fault, distinct from the deliberate read-path
   tolerance (a missing/corrupt/wrong-shaped file starts empty rather than
   throwing). `SQLiteDriver` and `IndexedDBDriver` complete the native-override
   picture from opposite ends, each earning trust its own way (AGENTS §21).
   `SQLiteDriver` is **prove-exactness-or-refine**: real `CREATE TABLE` /
   `CREATE INDEX` DDL backs every table, but `records?` / `count?` /
   `aggregate?` / `stream?` compile a `Criteria` straight to SQL
   (`compileCriteria`, `aggregateSQL`) and run it natively ONLY when
   `isExactCriteria` (built from `isExactCondition` / `isExactOrder`) first
   proves the SQL and the engine's semantics are identical for every
   condition and order term — otherwise the driver falls back to a full
   `scan` refined through the SAME core engine every scan-only driver uses
   (`applyCriteria` / `filterRows` / `computeAggregate` / `matchesCriteria`).
   Refine, not native SQL, is the path for: `like` / `glob` patterns (SQL
   `LIKE`/`GLOB` semantics can diverge from the engine's `wildcardMatch`),
   a `null` or `undefined` operand (SQLite storage collapses an explicit
   `null` to an absent column on read-back — `decodeRow` omits a `NULL`
   column entirely, so an `absent`/`present` check must run through the
   engine to stay exact), an empty `any` / `none` operand list, mismatched
   operand types, `json` / `blob` columns, and any nested `FieldPath` — AND a
   RANGE operator (`above` / `below` / `from` / `to` / `between`) or an
   `ORDER BY` term over a `text` column: SQLite's default BINARY collation
   orders `TEXT` by Unicode CODE POINT while the core engine's `compareValues`
   orders JS strings by UTF-16 CODE UNIT, and the two diverge on
   supplementary-plane characters (code points ≥ U+10000, e.g. many emoji) —
   so text ranges and text ordering always refine through the engine, even
   though text EQUALITY (`equals`/`not`/`any`/`none`) and `starts`/`ends` stay
   native. `starts` / `ends` compile case-SENSITIVELY (a `substr` comparison plus a
   `typeof text === 'string'` guard; an empty operand falls back to a
   `typeof` check) when they DO qualify as exact. `IndexedDBDriver` is **narrow-then-refine**: `records?` /
   `count?` / `stream?` first ask `selectPlan` for a key-range pushdown over
   the primary key or a single-column secondary index — a candidate SUPERSET,
   never lossy — then hands that superset to the SAME core engine
   (`applyCriteria` / `matchesCriteria`) every scan-only driver uses, which
   refines it to the exact result; a plan that cannot prove itself range-exact
   (a nested path, a non-orderable column type, an `or`-joined condition, a
   non-comparison operator) falls back to a full scan. `below` / `to` push
   down ONLY onto the primary store, never a secondary index — a secondary
   index has no entry for a row whose indexed column is absent or `null`,
   while the engine's total order (`compareValues`) lets those rows match a
   `below` / `to` bound; `equals` / `above` / `from` / `between` remain
   index-eligible on either. `conditionRange` returns `null` for a `between`
   whose bounds are reversed (`compareValues(first, second) > 0`), so
   `selectPlan` falls back to a full scan instead of handing a raw
   backwards `IDBKeyRange` to the store (which would throw a `DataError`).
   `IndexedDBDriver.snapshot()` captures every store in ONE read transaction,
   so the capture is point-in-time consistent across stores even under
   concurrent writers; `restore` was already atomic. Both drivers implement
   `migrate?` natively — `SQLiteDriver` inside one atomic `database.transaction`
   (`stepToSQL` projects each step's DDL; a mid-plan failure rolls back
   everything already applied), `IndexedDBDriver` via a versionchange
   reconnect (IndexedDB schema DDL is legal only inside `onupgradeneeded`, so
   `migrate` closes the connection and reopens at `version + 1` with an
   `upgrade` hook walking the plan) — and both implement the paired `meta?` /
   `stamp?` into a reserved store name a user table must avoid: `SQLiteDriver`
   a single-row `_meta` table (`META_TABLE`), `IndexedDBDriver` an out-of-line
   `__meta__` store (`META_STORE`), both excluded from a whole-store
   `snapshot`. `SQLiteDriver` implements `transaction?` with real `BEGIN` /
   `COMMIT` / `ROLLBACK` (double-settle throws `CONFLICT`); `IndexedDBDriver`
   deliberately OMITS `transaction?` — the underlying wrapper auto-commits its
   `IDBTransaction` the moment control yields to a non-IDB `await`, so no
   BEGIN-now/commit-or-rollback-later handle can span arbitrary caller code —
   and OMITS `aggregate?` — IndexedDB has no native SUM/AVG/MIN/MAX, so the
   engine over the narrowed `records?` covers it. A new backend implements a
   handful of small methods and inherits the entire query surface unchanged.
4. **Total query helpers; the equality family is structural, not ranked.**
   `compareValues`, `matchesCondition`, and `matchesCriteria` never throw — a
   type mismatch is a non-match and the comparator is a total order (it
   never returns `NaN`), mirroring the contracts guards' totality (AGENTS
   §14). The range operators (`above` / `below` / `from` / `to` /
   `between`) still rank through `compareValues`'s total order (which
   collapses every object/array to one rank-5 bucket). The equality-family
   operators (`equals` / `not` / `any` / `none`) instead compare through
   `deepEqual` — STRUCTURAL equality by SameValueZero leaves, so `equals` on
   an object/array compares field-by-field rather than by reference or rank,
   and `NaN` equals `NaN` under `equals` / `any` (it never matched anything
   under the old rank-based comparison).
5. **Optimistic transactions, with a native fast path.** `transaction(scope,
options?)` checks `options?.signal` ONCE at entry (an already-aborted
   signal throws `ABORTED` before anything else runs), then, when the driver
   implements the optional native `transaction?()`, drives the scope through
   that handle's `commit` / `rollback` instead of the snapshot floor —
   commit on success, rollback + rethrow on a throw; a native commit failure
   propagates as-is with no rollback attempt, since the engine owns
   transaction state after a failed COMMIT. Absent a native hook, it
   falls back to the universal model: `snapshot()` the store, run the scope,
   and on a throw call the rollback thunk to restore every table, then
   rethrow. Either path emits the identical `transaction` / `commit` /
   `rollback` lifecycle (§13), so observers can't tell which floor ran.
   Nesting is unsupported on both paths — this is a single-writer model, not
   reentrant.
6. **Observation is a pure side-channel (§13).** The core `Database` owns a
   typed `emitter` (`DatabaseEventMap` — `open` / `close` / `transaction` /
   `commit` / `rollback`) and each `Table` owns one (`TableEventMap` —
   `write` / `remove` / `clear`, KEY only, no value payload to avoid heavy
   fan-out / leaking row data). Every event is emitted directly (the AGENTS
   §13 convention: the emitter isolates a listener throw, routing it to its
   OWN `error` handler — the `error` option, surfaced as `(error, event)`,
   NOT a domain event — itself re-entrancy-guarded) strictly AFTER the
   relevant transition — `commit` only after a scope succeeds, `rollback`
   only after every table is restored (and the `rollback` emit OBSERVES the
   propagated error; it never suppresses or reorders it — the original throw
   still propagates), a `write` / `remove` / `clear` only after the driver op
   completes. So a buggy observer can never corrupt a write or a
   transaction: the committed state stays intact, the rollback still
   restores, and the original transaction error still propagates (proven by
   the emit-safety tests). Reads / queries / counts are not emitted (a
   reader does not mutate, and those paths are too hot). The observation
   lives in the core layer; the drivers stay storage primitives.
7. **Views share a driver.** A database is a typed view over a set of tables
   on one driver. `import(tables)` returns a new view of just those tables
   over the **same** driver (sharing storage and transactions); `export()`
   emits a portable `TableExport` per table — `schema` is the universally
   portable JSON Schema, `columns` re-imports losslessly via `import` within
   a TypeScript environment.
8. **DOC ↔ SOURCE method bijection.** Every behavioral interface's
   `## Methods` table lists exactly its public methods (call-signature
   members) — exhaustive, both directions — and each implementing class
   (`Database` / `MemoryDriver` / `JSONDriver` / `SQLiteDriver` /
   `IndexedDBDriver` / `Table` / `Query` / `Clause` / `Cursor`) implements
   every REQUIRED method and adds none beyond the interface (optional members
   like `records?` / `count?` / `aggregate?` / `transaction?` / `stream?` /
   `migrate?` / `meta?` / `stamp?` may be omitted). `MemoryDriver` and
   `JSONDriver` both omit `records?` / `count?` / `aggregate?`, and both now
   implement `stream?` / `migrate?` / `meta?` / `stamp?`; `MemoryDriver` still
   omits `transaction?` (snapshot floor only) while `JSONDriver` now
   implements `transaction?` too (flush-coalescing over the inner memory
   driver). `SQLiteDriver` implements EVERY optional hook — `records?` /
   `count?` / `aggregate?` / `transaction?` / `stream?` / `migrate?` / `meta?`
   / `stamp?` — the fully-native backend. `IndexedDBDriver` implements
   `records?` / `count?` / `stream?` / `migrate?` / `meta?` / `stamp?` but
   omits `transaction?` and `aggregate?` by IndexedDB's nature, not by
   choice (AGENTS §22). A renamed / added / removed method breaks the gate
   until the table is reconciled.
9. **Cancellation is a shared gate, not per-method reinvention.**
   `checkAbort(signal)` is the one place `ABORTED` is thrown — a no-op for
   `undefined` or a live signal. `records` / `count` / `aggregate` check it
   at entry; `TableInterface.scan` and `QueryInterface.stream` check it
   BEFORE EACH YIELD (so an abort mid-iteration stops promptly) and IGNORE
   `order` (streaming yields driver key-order; sorted output stays
   `records()`'s job). Breaking out of a stream early (`break`) closes the
   underlying source. Each call to `scan` / `stream` returns a fresh
   iterable — reusing a `QueryInterface` across calls never leaks state
   between them.
10. **No auto-generated keys in core; a keyless write needs a key
    factory.** Core mints no keys itself (AGENTS §1 — cross-environment code
    touches no `node:*`). `DatabaseOptions.key` (a `KeyFunction`) is what a
    table calls when a written row is missing its primary-key column; without
    one, writing a keyless row throws `VALIDATION`. The server ships
    `generateKey` (`node:crypto`-backed) to wire in as `key`; other
    environments supply their own `KeyFunction`, or callers always provide
    their own key values.
11. **Caller-driven migrations, plus opt-in versioned reconciliation.**
    `planMigration(deployed, declared, from?, to?)` structurally diffs two
    `TableSchema[]` into an ordered `Migration` plan (`table.add` /
    `table.remove`, then each shared table's `column.add` / `column.remove`
    / `index.add` / `index.remove`), which the caller hands to
    `driver.migrate?.(plan)` — a step referencing an unknown table throws
    `DatabaseError('MIGRATION')`; so does a `column.add` / `column.remove`-adjacent
    shared column whose declared `type` or `nullable` differs between
    `deployed` and `declared` (an in-place type/nullability change is not
    auto-migrated — the JSDoc on `planMigration` documents the manual path:
    add a new column, copy/convert the data, then remove the old one).
    `Database.migrate(deployed, options?)`
    orchestrates this for the caller: it diffs `deployed` against the
    database's own declared `tables`, applies the resulting plan through the
    driver's `migrate?` hook (throwing `MIGRATION` when the driver lacks
    one), emits the `migrate` event on success, and returns the applied
    plan — `options?.signal` is checked once, at entry, throwing `ABORTED`
    on an already-fired signal. `migrateRows` is the pure per-table row
    transform (`column.remove` drops the field from a fresh copy of each
    row; the other operations act on storage shape, not row shape, so they
    are no-ops here) — a driver's own `migrate` decides how to apply it to
    stored rows. This caller-driven path remains the way to migrate against
    an UNVERSIONED driver (one that implements neither `meta` nor `stamp`),
    which still owns knowing what is currently deployed. A driver that DOES
    implement both `meta` and `stamp` can instead opt into automatic
    reconciliation by passing `DatabaseOptions.version`: `Database.open()`
    reads the driver's persisted `DriverMeta` and reconciles it against the
    declared version, inside the same lazy-connect chain, after the `open`
    event fires — a fresh store (`meta()` is `undefined`) simply `stamp`s
    `{ version, schema }` for next time (nothing to diff yet); a stored
    version below the declared one computes and applies the upgrade plan via
    `planMigration` + `driver.migrate?` (throwing `MIGRATION` when the plan
    is non-empty and the driver lacks `migrate`), then `stamp`s the new
    metadata and emits `migrate`; a stored version above the declared one is
    unrecoverable and throws `MIGRATION`; an equal version is a no-op.
    `version` left unset, or set against a non-versioning driver, leaves
    `open()` unchanged — versioning is opt-in per driver AND per database.
    When the driver also implements `transaction`, the migrate + `stamp`
    pair applies atomically (all-or-nothing); prefer ONE mode per database —
    setting `version` and also calling `migrate()` explicitly runs
    reconciliation on open and the explicit plan separately, emitting
    `migrate` for each.
12. **Driver conformance.** `conformDriver(factory)` is a framework-agnostic
    battery (no test-runner import) any new `DriverInterface` backend can run
    against itself — a smoke script, a unit test, or a new driver's own
    README all call it the same way. It opens a fixed two-table schema per
    phase (calling `factory()` fresh each time so failures stay isolated) and
    verifies the REQUIRED surface's invariants (copy-in/copy-out isolation,
    upsert-overwrite, key-ordered `keys`/`scan`, `snapshot` rollback, a
    non-`id` primary key, structural round-tripping via `deepEqual`), then
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
    `IndexedDBDriver`: a constraint violation maps to `CONFLICT`; a
    closed/not-open/invalid-state fault to `CLOSED`; a quota fault to
    `DRIVER` with `code: 'QUOTA'`; a blocked upgrade to `DRIVER` with
    `code: 'BLOCKED'` and `retryable: true`; `migrate`'s versionchange path
    remaps an upgrade fault to `MIGRATION`; anything else to `DRIVER`.
14. **The reserved meta table/store is a hard guard, not a naming
    convention.** `SQLiteDriver.open` throws `DatabaseError('VALIDATION')`
    when the declared tables include one literally named `_meta`
    (`META_TABLE`); `IndexedDBDriver.open` does the same for `__meta__`
    (`META_STORE`) — a collision is caught at `open`, not discovered later
    as corrupted metadata. Because both drivers derive their index names from
    a length-prefixed scheme (`indexName` for SQLite, `deriveIndexName` for
    IndexedDB) to stay collision-free across compound indexes, a database
    file/store created under an OLDER naming scheme leaves its old-named
    indexes orphaned (unreferenced, harmless) on reopen under the new scheme —
    they are never queried and never collide, but a storage audit may notice
    them.

What ships is the **core in-between** (schema-aware: `open` receives a
derived `TableSchema[]`, with `shapeToColumnType` mapping each column's shape), its
reference `MemoryDriver`, and three persistent backends. `JSONDriver` in
`src/server` is a decorator over `MemoryDriver` that loads/flushes a single
JSON file — every primitive delegates to the inner memory driver, so
querying, key-order `scan` / `keys`, and capture-replay `snapshot` are
inherited unchanged; `JSONDriver.migrate` additionally persists the migrated
state, and every flush is now atomic — written to a sibling temp file and
`rename`d onto the target path, so a crash mid-flush can never truncate or
corrupt the previous good file. Outside a `transaction`, `JSONDriver` still
flushes once per mutation (`write` / `delete` / `clear`); its native
`transaction?()` coalesces every write made during the scope into ONE atomic
flush on `commit` (instead of one per write) and, on `rollback`, restores
the pre-transaction snapshot in memory then flushes that restored state —
re-entering a transaction while one is active, or settling the same handle
twice, throws `CONFLICT`. `SQLiteDriver`, also in `src/server`, is the
fully-native, **trusted-mode** backend on the published `@orkestrel/sqlite`
wrapper — real typed `CREATE TABLE` / `CREATE INDEX` DDL, native
`records?` / `count?` / `aggregate?` / `stream?` compiled straight to SQL,
real `BEGIN` / `COMMIT` / `ROLLBACK` transactions, atomic DDL migration
(`stepToSQL`, one native `database.transaction` per plan), and a reserved
`_meta` table (`META_TABLE`) for `meta?` / `stamp?` versioning — every
optional `DriverInterface` hook, none skipped. `IndexedDBDriver` in
`src/browser`, on the published `@orkestrel/indexeddb` wrapper, is the
**narrow-then-refine** persistent browser backend — `selectPlan` turns a
`Criteria` into a key-range pushdown over the primary key or a single-column
secondary index (a candidate superset, never lossy) that the same core
engine then refines to the exact result; `migrate?` applies a plan via a
versionchange reconnect, and `meta?` / `stamp?` persist into a reserved
`__meta__` store (`META_STORE`) — it omits `transaction?` (auto-committing
`IDBTransaction`s cannot host a BEGIN-now/commit-later handle) and
`aggregate?` (no native SUM/AVG/MIN/MAX) by IndexedDB's own nature. The core
`Database` / `Table` are also **observable** — each owns a typed `emitter`
(`DatabaseEventMap` / `TableEventMap`, §13) carrying the transaction +
per-row lifecycle (see [Observing](#observing)); a driver stays a storage
primitive (the observation lives in the core layer above it). Deliberately
**not** part of this surface yet, by the same "build only what earns its
keep" discipline: a raw-SQL escape hatch — additive, and depends on nothing
that doesn't already exist; everything above is unchanged once it lands.

## Patterns

### Declaring tables in options

```ts
import { createDatabase, createMemoryDriver } from '@src/core'
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
	keys: { posts: 'slug' }, // default key is 'id'
	indexes: { posts: [['title']] }, // secondary indexes — contracts don't express them
})

const users = db.table('users') // hold the handle; reuse it
const posts = db.table('posts')
```

Each `indexes` entry is one (possibly compound) index of column names; they
flow into each table's derived `TableSchema`. Both drivers here are
scan-only and ignore them; a future native backend uses them to build real
indexes.

### Swapping the driver

The `tables` declaration and every call against the database are identical
across backends — only the `driver` changes, so the same code runs in tests
and in production. Pick the driver per environment and pass it to
`createDatabase`:

```ts
import { createDatabase, createMemoryDriver } from '@src/core' // tests / ephemeral — no I/O
import { createJSONDriver } from '@src/server' // node — persisted to a file

const driver =
	process.env.NODE_ENV === 'test' ? createMemoryDriver() : createJSONDriver('data/app.json')
const db = createDatabase({ driver, tables, keys, indexes })
```

`MemoryDriver` is scan-only (the core engine answers every query) and
I/O-free, making it the storage behind tests, ephemeral caches, and any code
that wants the database API without a persistent backend; `JSONDriver` adds
file persistence on top of the same in-memory engine — both return
identical query results, so the choice is purely about where the bytes
live, never about behavior.

### Keyed CRUD

```ts
await users.set({ id: 'u1', name: 'Ada', age: 36, role: 'admin' }) // upsert → key
await users.add({ id: 'u1', name: 'Ada', age: 36, role: 'admin' }) // throws CONFLICT (exists)
await users.update('u1', { age: 37 }) // merge + re-validate → boolean
await users.get('u1') // row or undefined (typed)
await users.resolve('u1') // row or throw NOT_FOUND
await users.has('u1') // boolean
await users.remove('u1') // boolean
await users.clear() // empty the table

// Core mints no keys itself — a write missing its key column throws VALIDATION
// unless `DatabaseOptions.key` supplied a `KeyFunction` (see "Key factories" below).
```

### Filtered records, count, and aggregate

`records` / `count` / `aggregate` take an optional `Criteria` directly —
`query()` compiles one for you, but a caller with a pre-built `Criteria` can
call these directly:

```ts
const adults = await users.records({
	conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }],
})
const total = await users.count() // every row, unfiltered
const average = await users.aggregate('average', 'age') // number | undefined
```

### Streaming with early exit

`scan` (on a table) and `stream` (on a query) are lazy — rows are yielded one
at a time rather than collected up front. `conditions` / `offset` / `limit`
are honored as rows stream; `order` is IGNORED (sorted output is `records()`
/ `all()`'s job — streaming yields driver key-order). Breaking out early
closes the underlying source, and each call returns a fresh iterable:

```ts
// Table.scan — lazy filtered iteration, no upfront collection.
for await (const user of users.scan({
	conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }],
})) {
	if (user.name === 'Ada') break // closes the source immediately — no more rows read
}

// Query.stream — the fluent builder's lazy terminal (filters/offset/limit apply, order is ignored).
for await (const user of users.query().where('role').equals('member').stream()) {
	console.log(user.name)
}
```

### Cancellation

Every read / iteration method takes an optional `ReadOptions.signal`. An
already-fired signal throws `ABORTED`; `scan` / `stream` re-check it before
each yield, so an abort mid-iteration stops promptly:

```ts
import { checkAbort, isDatabaseError } from '@src/core'

// A time-boxed read — abort after 50ms.
try {
	await users.records(undefined, { signal: AbortSignal.timeout(50) })
} catch (error) {
	if (isDatabaseError(error) && error.code === 'ABORTED') console.log('too slow', error.context)
}

// A time-boxed scan — checked before each yielded row.
const controller = new AbortController()
for await (const user of users.scan(undefined, { signal: controller.signal })) {
	if (user.id === 'stop-here') controller.abort('caller cancelled')
}

// The shared gate every read method calls internally:
checkAbort(controller.signal) // throws DatabaseError('ABORTED', …) once aborted
```

### Batch operations

The keyed methods batch by overload (AGENTS §9.2) — one key/row in, one
result; an array in, an array of results in the same order. The verb never
changes (no `getMany` / `setAll`):

```ts
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
// A numeric column accepts a numeric string and stores the coerced number.
const id = await users.set({ id: 'u2', name: 'Bo', age: '41' as never, role: 'member' })
;(await users.get('u2'))?.age // 41 (a number) — the contract parsed it

// A row that cannot satisfy the shape throws DatabaseError('VALIDATION').
```

### Fluent queries

```ts
const adults = await users
	.query()
	.where('age')
	.from(18)
	.and('role')
	.not('guest')
	.descending('age')
	.limit(10)
	.all()

await users.query().where('name').starts('A').first() // first match or undefined
await users.query().where('role').equals('admin').count() // number
await users.query().where('role').equals('member').average('age') // number | undefined
await users
	.query()
	.filter((user) => user.name.includes('a'))
	.all() // post-fetch JS predicate

// Ordering, paging, and every terminal aggregate:
await users.query().ascending('name').offset(10).limit(5).all() // page 3 of 5, alphabetical
await users.query().where('age').above(18).sum('age') // number | undefined
await users.query().where('role').equals('member').minimum('age') // number | undefined
await users.query().where('role').equals('member').maximum('age') // number | undefined
await users.query().where('role').equals('member').aggregate('count', 'age') // named aggregate
```

Every `ClauseInterface` operator, called in isolation (each opens a
condition and returns the query):

```ts
await users.query().where('age').equals(36).all()
await users.query().where('age').not(36).all()
await users.query().where('age').above(18).all()
await users.query().where('age').below(65).all()
await users.query().where('age').from(18).all()
await users.query().where('age').to(65).all()
await users.query().where('age').between(18, 65).all()
await users.query().where('name').like('A%').all()
await users.query().where('name').glob('A*').all()
await users.query().where('name').starts('A').all()
await users.query().where('name').ends('a').all()
await users.query().where('role').any(['admin', 'member']).all()
await users.query().where('role').none(['guest']).all()
await users.query().where('bio').absent().all()
await users.query().where('bio').present().all()
```

The WHERE operators (each maps to a familiar SQL operator). The engine
evaluates every one of them in JS over `scan`; a future native backend can
push the exact-comparison operators down to its own index:

| Method          | SQL           |
| --------------- | ------------- |
| `equals(v)`     | `=`           |
| `not(v)`        | `!=`          |
| `above(v)`      | `>`           |
| `below(v)`      | `<`           |
| `from(v)`       | `>=`          |
| `to(v)`         | `<=`          |
| `between(a, b)` | `BETWEEN`     |
| `like(p)`       | `LIKE`        |
| `glob(p)`       | `GLOB`        |
| `starts(p)`     | `LIKE 'p%'`   |
| `ends(s)`       | `LIKE '%s'`   |
| `any(vs)`       | `IN`          |
| `none(vs)`      | `NOT IN`      |
| `absent()`      | `IS NULL`     |
| `present()`     | `IS NOT NULL` |

### Nested fields

Every column — in `where` / `and` / `or`, `ascending` / `descending`, and the
aggregates — is a [`FieldPath`](contract.md): a **single string is one
column** (never split on `.`), while an **array descends** into a nested
(object / `json`) value. The _shape_ of the argument says how to read it; the
string's _value_ is never parsed — there are no magic strings here.

```ts
await db.table('events').query().where(['payload', 'user', 'id']).equals('u1').all()
await db.table('events').query().descending(['payload', 'at']).limit(20).all()
await db.table('orders').query().sum(['totals', 'amount'])

// A dotted string is a column literally named 'payload.id' — NOT a path:
await db.table('events').query().where('payload.id').present().all()
```

### Cursors

```ts
const cursor = await users.cursor()
while (!cursor.done) {
	if (cursor.value && cursor.value.age < 18) await cursor.remove()
	else await cursor.update({ role: 'member' })
	await cursor.next()
}
cursor.close()
```

### Transactions

```ts
// Commits on success; rolls every table back if the scope throws.
await db.transaction(async () => {
	await users.set({ id: 'u3', name: 'Cy', age: 29, role: 'member' })
	await posts.add({ slug: 'intro', title: 'Intro' })
	if (somethingWrong) throw new Error('abort') // → both writes undone
})

// A pre-aborted signal is checked once at entry, before anything transactional runs:
await db.transaction(async () => {}, { signal: AbortSignal.timeout(0) }) // throws ABORTED
```

### Native transactions

`transaction` uses a driver's optional native `transaction?()` hook — its
`TransactionInterface` `commit` / `rollback` — instead of the snapshot floor
when the driver implements it; the `transaction` / `commit` / `rollback`
events fire the same either way, so calling code and observers can't tell
which floor ran:

```ts
import type { DriverInterface, TransactionInterface } from '@src/core'

// A driver opting into native BEGIN/COMMIT/ROLLBACK — Database.transaction
// prefers this over the snapshot-based rollback floor when present.
const nativeHandle: TransactionInterface = {
	commit: async () => {
		/* native COMMIT */
	},
	rollback: async () => {
		/* native ROLLBACK */
	},
}
const driver: Pick<DriverInterface, 'transaction'> = {
	transaction: async () => nativeHandle,
}
```

A `scope` throw rolls back via the native handle; a native `commit` failure
propagates as-is with no rollback attempt — the engine owns transaction
state after a failed COMMIT, so `transaction()` never masks that failure
behind a rollback error.

### Migrations

Migrations are caller-driven — `planMigration` structurally diffs a
deployed and a declared `TableSchema[]` into an ordered `Migration`, which
the caller hands to a driver's optional native `migrate?`. `migrateRows` is
the pure per-table row transform a driver's `migrate` can lean on. Calling
`planMigration` + `driver.migrate?` directly is still the low-level path
(useful outside a `Database`, e.g. against a bare driver):

```ts
import { createMemoryDriver, migrateRows, planMigration } from '@src/core'

const deployed = [{ name: 'users', primary: 'id', columns: [], indexes: [] }]
const declared = [
	{
		name: 'users',
		primary: 'id',
		columns: [{ name: 'age', type: 'integer' as const, nullable: false }],
		indexes: [],
	},
]
const plan = planMigration(deployed, declared) // { from: 0, to: 1, steps: [...] }
const driver = createMemoryDriver()
await driver.open(declared) // a driver must be opened before its optional hooks run
await driver.migrate?.(plan) // applies the plan natively (throws MIGRATION on an unknown table)

// The pure row-shape transform a driver's own `migrate` can apply:
const rows = [{ id: 'a', name: 'Ada', legacy: true }]
migrateRows(rows, [{ operation: 'column.remove', table: 'users', column: 'legacy' }])
// => [{ id: 'a', name: 'Ada' }]
```

`Database.migrate(deployed, options?)` wraps that same diff-then-apply
orchestration against the database's OWN declared `tables`, so the caller
only has to track what is currently deployed:

```ts
import { createDatabase, createMemoryDriver } from '@src/core'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
})
await db.open() // a driver must be opened before migrate's driver.migrate? hook runs

const deployed = [{ name: 'users', primary: 'id', columns: [], indexes: [] }]
const plan = await db.migrate(deployed) // diffs deployed vs. declared, applies it, emits 'migrate'
plan.steps // the applied Migration steps

db.emitter.on('migrate', (applied) => console.log('migrated to', applied.to))
```

### Versioned auto-migrate on open

A driver that implements the paired `meta` / `stamp` (both reference drivers
do) can skip the caller-driven `Database.migrate` call entirely: pass
`DatabaseOptions.version`, and `open()` reconciles the driver's persisted
schema against the declared one for you, migrating and re-stamping as needed:

```ts
import { createDatabase, createMemoryDriver } from '@src/core'
import { generateKey } from '@src/server'
import { integerShape, stringShape } from '@orkestrel/contract'

const driver = createMemoryDriver() // any DriverInterface implementing meta/stamp
const db = createDatabase({
	driver,
	tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
	version: 2, // the declared schema version
	key: generateKey,
})

await db.open() // fresh store → just stamps { version: 2, schema } for next time
db.emitter.on('migrate', (applied) => console.log('auto-migrated to', applied.to))

// Reopening the SAME driver/store later with a higher `version` diffs the
// stored schema against the newly declared one, applies the plan through
// `driver.migrate?`, re-stamps, and emits `migrate` — all inside `open()`.
```

### Driver conformance

`conformDriver(factory)` runs the same invariant battery every backend must
uphold — call it from a new driver's own test suite (or a smoke script) to
prove it is a drop-in `DriverInterface`:

```ts
import { conformDriver, createMemoryDriver } from '@src/core'

await conformDriver(() => createMemoryDriver()) // resolves once every phase passes
// A driver that violates an invariant rejects with DatabaseError('CONFORMANCE', ...)
```

### Auditing a custom driver

`auditDriver(factory)` drains the full battery instead of failing fast,
collecting every violation — useful when developing a new backend and
wanting the complete picture in one run rather than fixing one invariant at
a time:

```ts
import { auditDriver, createMemoryDriver } from '@src/core'

const findings = await auditDriver(() => createMemoryDriver())
// [] — a fully conformant driver
for (const finding of findings) console.log(`${finding.check}: ${finding.message}`)

// The lower-level generator these two build on — one phase per yield, lazy:
import { driverFindings } from '@src/core'
for await (const finding of driverFindings(() => createMemoryDriver())) {
	console.log(finding.check, finding.context)
}
```

### Key factories

Core mints no keys itself — a written row missing its primary-key column
throws `VALIDATION` unless `DatabaseOptions.key` supplies a `KeyFunction`.
The server ships `generateKey` (`node:crypto`-backed):

```ts
import { createDatabase, createMemoryDriver } from '@src/core'
import { generateKey } from '@src/server'
import { stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { posts: { id: stringShape(), title: stringShape() } },
	key: generateKey, // a table calls this when a written row lacks its key column
})
const key = await db.table('posts').set({ title: 'Hello' } as never) // a fresh UUID
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
import { createDatabase, createMemoryDriver } from '@src/core'
import { stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	tables: { users: { id: stringShape(), name: stringShape() } },
	on: { commit: () => log('txn committed') }, // initial listener at construction
})

const users = db.table('users') // hold the handle (the documented practice) and observe it
users.emitter.on('write', (key) => cache.invalidate('users', key)) // re-read by key if needed
users.emitter.on('remove', (key) => cache.invalidate('users', key))
db.emitter.on('rollback', (error) => log.warn('txn rolled back', error))
```

The event vocabulary:

| Entity     | Event map          | Events                                                                                          |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `Database` | `DatabaseEventMap` | `open()` · `close()` · `transaction()` · `commit()` · `rollback(error)`                         |
| `Table`    | `TableEventMap`    | `write(key)` · `remove(key)` · `clear()` (key only — `set` / `add` / `update` all emit `write`) |

`open` fires when the driver connects (an explicit `open()`, or the lazy
first-use connect — a reconnect after `close()` fires it again); `close`
when the driver is released; `transaction` when a scope begins (after the
snapshot); `commit` only after a scope SUCCEEDS; `rollback` only after a
throwing scope's tables are all restored. A `Table` fires `write` after any
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
// Define more tables at runtime; the returned view is typed and shares storage.
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
portable.users.schema // a JSON Schema document
portable.users.columns // the source column map (re-imports via `import` in a TS environment)
portable.users.key // 'id'
```

### Introspection & seeding

```ts
users.contract.schema // the table's JSON Schema (from the shape)
users.contract.generate() // a valid seed row — reproducible with a seeded RandomFunction
users.contract.is(value) // the row guard
```

### Connecting eagerly

The driver connects lazily on first table use; call `open` to connect
eagerly instead (useful to fail fast at startup, before the first request):

```ts
await db.open() // connects now — table() calls after this never wait on it
```

### Driver primitives

A `DriverInterface` is the irreducible storage primitive every backend
implements; `Database` / `Table` are the ergonomic layer built on it. Calling
it directly (as `Table` does internally) shows the whole REQUIRED surface:

```ts
import { createMemoryDriver } from '@src/core'

const driver = createMemoryDriver()
await driver.open([{ name: 'users', primary: 'id', columns: [], indexes: [] }])
await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
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

The pure functions behind `Table` and `Query` — useful directly when
building a new driver's native `records` / `count` / `aggregate` hook:

```ts
import { integerShape } from '@orkestrel/contract'
import {
	applyCriteria,
	compareValues,
	computeAggregate,
	deepEqual,
	extractKey,
	filterRows,
	globMatch,
	likeMatch,
	matchesCondition,
	matchesCriteria,
	shapeToColumnType,
	sortRows,
	wildcardMatch,
} from '@src/core'

compareValues(1, 2) // -1 — a total order over mixed types
wildcardMatch('hello', 'h%o', '%', '_', true) // true — the shared LIKE/GLOB engine
likeMatch('hello', 'h%o') // true — case-insensitive
globMatch('hello', 'h*o') // true — case-sensitive

const condition = { column: 'age', operator: 'above', values: [18], connector: 'and' } as const
matchesCondition({ age: 36 }, condition) // true
matchesCriteria({ age: 36 }, [condition]) // true — folds every condition
filterRows([{ age: 36 }, { age: 12 }], [condition]) // [{ age: 36 }] — the count/aggregate basis

sortRows([{ age: 36 }, { age: 18 }], [{ column: 'age', direction: 'ascending' }])
applyCriteria([{ age: 36 }, { age: 18 }], { conditions: [condition], limit: 1 })
computeAggregate([{ age: 36 }, { age: 18 }], 'average', 'age') // 27

extractKey({ id: 'u1' }, 'id') // 'u1'
shapeToColumnType(integerShape()) // 'integer' — the type `open` hands a driver
deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) // true — structural, not reference, equality
```

### Persistence with the JSON driver

```ts
import { createDatabase } from '@src/core'
import { createJSONDriver } from '@src/server'
import { stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createJSONDriver('data/app.json'),
	tables: { users: { id: stringShape(), name: stringShape() } },
})
await db.table('users').set({ id: 'u1', name: 'Ada' }) // persisted to app.json
```

`JSONDriver` loads the file on `open`, flushes the whole store back after
every mutation, and starts empty rather than throwing on a missing, corrupt,
or wrong-shaped file. It is a decorator over `MemoryDriver` — every read,
scan, and `snapshot` delegates to the inner memory driver, so behavior is
identical to `MemoryDriver` except that writes survive a restart.

### Compiling criteria to SQL

The server's pure `compilers.ts` turns a core `Criteria` (the same one
`applyCriteria` folds) into the `WHERE` / `ORDER BY` / `LIMIT` tail of a
`SELECT`, with `?`-bound params in clause order — the payload a native SQLite
driver's `records` / `count` hook runs directly:

```ts
import { compileCriteria } from '@src/server'
import type { TableSchema } from '@src/core'

const schema: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', type: 'text', nullable: false },
		{ name: 'age', type: 'integer', nullable: false },
	],
	indexes: [],
}

const { sql, params } = compileCriteria(
	{ conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] },
	schema,
)
// sql: 'WHERE "age" >= ? ORDER BY "id"', params: [18]

// A parameterized SQLite binding runs it directly:
// db.prepare(`SELECT * FROM "users" ${sql}`).all(...params)
```

### Exact-or-refine vs. narrow-then-refine native reads

A native override earns the engine's trust one of two ways (AGENTS §21).
**Prove-exactness-or-refine** (`SQLiteDriver`): the backend has real typed
columns and indexes, so it compiles the `Criteria` straight to SQL and runs
it natively ONLY when `isExactCriteria` first proves the SQL and the engine
agree on every condition/order term for that schema — otherwise it falls
back to a full scan refined through the same core engine (never a "trust
blindly" path). **Narrow-then-refine**
(`IndexedDBDriver`): the backend can only prove a candidate SUPERSET range-exact
(a key-range pushdown), so it fetches that superset and hands it to the SAME
core engine every scan-only driver uses (`applyCriteria` / `matchesCriteria`),
which refines it down to the exact result — conformance is earned by "never
under-fetch," not by native filtering. Both are indistinguishable from the
caller's side: `Table.records` / `count` / `stream` return identical rows
either way; only the path to get there differs.

```ts
import { isExactCondition, isExactCriteria, isExactOrder } from '@src/server'
import type { TableSchema } from '@src/core'

const schema: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', type: 'text', nullable: false },
		{ name: 'age', type: 'integer', nullable: false },
	],
	indexes: [],
}

const exact = { column: 'age', operator: 'above', values: [18], connector: 'and' } as const
isExactCondition(exact, schema) // true — a plain comparison over a typed column

const notExact = { column: 'age', operator: 'above', values: [null], connector: 'and' } as const
isExactCondition(notExact, schema) // false — a null operand refines instead

isExactOrder({ column: 'age', direction: 'ascending' }, schema) // true — a flat, orderable column

isExactCriteria({ conditions: [exact], order: [{ column: 'age', direction: 'ascending' }] }, schema) // true
```

### Persistence with the SQLite driver

```ts
import { createDatabase } from '@src/core'
import { createSQLiteDriver } from '@src/server'
import { integerShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createSQLiteDriver('data/app.sqlite'), // or createSQLiteDriver() for ':memory:'
	tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
})
await db.table('users').set({ id: 'u1', name: 'Ada', age: 36 }) // persisted to app.sqlite

// Native querying, paging, and aggregation — compiled to SQL, no engine re-filter:
await db.table('users').query().where('age').from(18).descending('age').all()
await db.table('users').query().where('age').above(18).average('age')

// Real transactions and atomic migration ship with it:
await db.transaction(async () => {
	await db.table('users').update('u1', { age: 37 })
}) // real BEGIN/COMMIT/ROLLBACK, not the snapshot floor

// createSQLiteDriver also accepts a full SQLiteDriverOptions bag (a bare
// string is still shorthand for `{ path }`, back-compat):
createSQLiteDriver({
	path: 'data/app.sqlite',
	timeout: 5000,
	foreignKeys: true,
	pragmas: { journal_mode: 'WAL' }, // applied via pragma() right after connect(), in order
})
```

`SQLiteDriver` is the fully-native backend — it implements every optional
`DriverInterface` hook (`records?` / `count?` / `aggregate?` / `transaction?`
/ `stream?` / `migrate?` / `meta?` / `stamp?`). Reopen the same `path` with a
higher `DatabaseOptions.version` and it reconciles automatically through its
reserved `_meta` table (`META_TABLE`) — see
[Versioned auto-migrate on open](#versioned-auto-migrate-on-open); `open()`
throws `DatabaseError('VALIDATION')` if a declared table is literally named
`_meta`, so the collision is caught immediately rather than silently
corrupting metadata.

### Persistence with the IndexedDB driver

```ts
import { createDatabase } from '@src/core'
import { createIndexedDBDriver } from '@src/browser'
import { stringShape } from '@orkestrel/contract'

// Feature-detect before reaching for it — IndexedDB is a browser-only global.
if (typeof indexedDB !== 'undefined') {
	const db = createDatabase({
		driver: createIndexedDBDriver('app'),
		tables: { users: { id: stringShape(), name: stringShape() } },
	})
	await db.table('users').set({ id: 'u1', name: 'Ada' }) // persisted to IndexedDB
	await db.table('users').query().where('id').equals('u1').all() // pushed down to a key range
}
```

`IndexedDBDriver` narrows a `Criteria` to a key-range candidate over the
primary key or a single-column secondary index (`selectPlan`), then lets the
core engine refine it to the exact result — see
[Exact-or-refine vs. narrow-then-refine native reads](#exact-or-refine-vs-narrow-then-refine-native-reads).
It implements `records?` / `count?` / `stream?` / `migrate?` / `meta?` /
`stamp?` (persisted into a reserved `__meta__` store, `META_STORE` —
`open()` throws `DatabaseError('VALIDATION')` if a declared table is
literally named `__meta__`), but OMITS `transaction?` (the underlying
`IDBTransaction` auto-commits the moment control yields to a non-IDB
`await`) and `aggregate?` (IndexedDB has no native SUM/AVG/MIN/MAX) by
IndexedDB's own nature.

### IndexedDB pushdown planning

The pure planner behind `IndexedDBDriver`'s native `records?` / `count?` /
`stream?` — useful directly to see what a `Criteria` pushes down to before it
ever touches a browser database:

```ts
import type { TableSchema } from '@src/core'
import { conditionRange, isKey, selectPlan } from '@src/browser'

const schema: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', type: 'text', nullable: false },
		{ name: 'age', type: 'integer', nullable: false },
	],
	indexes: [['age']],
}

isKey('u1') // true — a string is a usable IndexedDB key
isKey(true) // false — a boolean is not

const equalsAge = { column: 'age', operator: 'equals', values: [30], connector: 'and' } as const
conditionRange(equalsAge) // an IDBKeyRange.only(30) — an exact comparison operator

// A full scan (no condition qualifies for pushdown) returns a null plan —
// the driver then reads every row and lets the core engine filter it exactly:
selectPlan(undefined, schema, ['age']) // { index: null, range: null }

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
import { mapIndexedDBError, mapMigrationError } from '@src/browser'
import type { IndexedDBError } from '@orkestrel/indexeddb'

declare const fault: IndexedDBError // a caught backend fault

mapIndexedDBError(fault) // → DatabaseError('CONFLICT' | 'CLOSED' | 'DRIVER', ...)
mapMigrationError(fault) // → the same, but an UPGRADE fault becomes 'MIGRATION'
```

### Practices

- **Declare tables in `createDatabase({ tables })` and hold the handles** —
  `const users = db.table('users')`; reuse them rather than re-resolving.
- **Writes coerce, reads narrow.** Lean on the contract: pass loose input
  (`'41'`) and store clean typed data; trust `get` / `records` to return the
  row type.
- **Use `resolve` when absence is an error**, `get` when it is expected —
  `resolve` throws `NOT_FOUND`, `get` returns `undefined`.
- **Reach for `query()` over `records()`** — the builder compiles a portable
  `Criteria`; `filter` is the JS escape hatch when an operator won't express
  it.
- **Use `import` to add tables to a live store** and `export` to move a
  schema across environments; both share the underlying driver.
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

- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ source bijection across `src/core`, `src/server`, and `src/browser` (value + type exports), plus each interface ↔ implementing-class method bijection.
- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — the query engine: `compareValues` total order, every `matchesCondition` operator (the equality family — `equals` / `not` / `any` / `none` — via `deepEqual`, including `NaN`-equals-`NaN`; the range family via `compareValues`), `matchesCriteria` folding, `filterRows`, `sortRows`, `applyCriteria`, `computeAggregate`, `extractKey`, `shapeToColumnType`'s shape → portable-type mapping (scalars, `json` for object/array/union/raw, optional/nullable unwrap, literal-by-values), `deepEqual`'s structural equality, `planMigration`'s `MIGRATION` throw on a shared column's type/nullable drift, and `conformDriver`'s battery against `MemoryDriver` and a deliberately-broken driver (each check fails with a `CONFORMANCE` `DatabaseError`), including the deepened `write-read` nested-field checks and the `snapshot-nested` phase (a shallow-copying driver fails it).
- [`tests/src/core/drivers/MemoryDriver.test.ts`](../../tests/src/core/drivers/MemoryDriver.test.ts) — the driver primitive: `open(schema)` readies tables, read/write/delete/keys/scan/clear + `snapshot` rollback, and deep-copy isolation via `structuredClone` at every boundary (write / read / scan / stream / snapshot) — mutating a caller's input or a returned row never affects stored state, including nested fields.
- [`tests/src/core/Database.test.ts`](../../tests/src/core/Database.test.ts) — declared tables, lazy connect, typed CRUD, coercion + `VALIDATION` / `CONFLICT` / `NOT_FOUND`, custom keys, the `indexes` option, `import` / `export`, `transaction` commit/rollback, `migrate` (applies a diffed plan through the driver's `migrate` hook and emits `migrate` once, rejects `MIGRATION` when the driver lacks the hook), and the `emitter` (`DatabaseEventMap`): `open` on connect / reconnect, `transaction` → `commit` on success and → `rollback(error)` on a throw (never both), `on?` wiring, and the emit-safety guarantee (a throwing `commit` observer can't corrupt the committed state, a throwing `rollback` observer can't suppress the propagated error, the throw routes to the emitter's `error` handler, no recursion).
- [`tests/src/core/Table.test.ts`](../../tests/src/core/Table.test.ts) — `Table`'s keyed CRUD + batch overloads, coercion + the `VALIDATION` / `CONFLICT` / `NOT_FOUND` paths, the records / count / aggregate engine path, the query / cursor accessors, the native ↔ engine dispatch: a real recording driver with `records` / `count` / `aggregate` hooks proves `Table` prefers them (including a present `aggregate` that resolves to `undefined`), a plain `MemoryDriver` the engine fallback — and the `emitter` (`TableEventMap`): `set` / `add` / `update` each fire one `write(key)`, `remove(key)` only on a real delete (a miss / no-op emits nothing), `clear`, a `VALIDATION` failure emits no `write`, and the emit-safety guarantee (a throwing `write` observer can't corrupt the row — the emitter isolates it; a `Table` reached via the `Database` has no `error` handler, so the throw is swallowed silently).
- [`tests/src/core/Query.test.ts`](../../tests/src/core/Query.test.ts) — `Query`'s where / and / or dispatch, ordering, paging, `filter`, and aggregates.
- [`tests/src/core/Clause.test.ts`](../../tests/src/core/Clause.test.ts) — `Clause`'s operator methods, each closing the pending condition with the right operator + operands and returning the owning query, asserted through real execution.
- [`tests/src/core/Cursor.test.ts`](../../tests/src/core/Cursor.test.ts) — `Cursor`'s forward walk over a key snapshot: `value` / `index` / `done`, `next`, in-place `update` / `remove`, and `close`.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createDatabase` / `createMemoryDriver` each return a working instance of their interface (a round-trip end to end).
- [`tests/src/server/drivers/JSONDriver.test.ts`](../../tests/src/server/drivers/JSONDriver.test.ts) — `JSONDriver`'s persistence: `open` loads an existing file (and starts empty on a missing/corrupt/wrong-shaped one), every mutation flushes the whole store, `snapshot` rollback re-persists the restored state, querying runs through the inherited `MemoryDriver` engine unchanged, `stream` delegates to the inner memory driver, and `transaction` (flush-coalescing: the file stays unchanged mid-transaction then reflects every write on `commit`, `rollback` restores memory and the file, re-entering an active transaction throws `CONFLICT`, and normal per-mutation flushing resumes once the handle settles).
- [`tests/src/server/drivers/SQLiteDriver.test.ts`](../../tests/src/server/drivers/SQLiteDriver.test.ts) — `SQLiteDriver`'s full native surface: `open`'s real DDL (reopen-safe), a `VALIDATION` throw when a declared table is named `_meta`, keyed CRUD + codec round-trips, the `CLOSED` gate, native `records` / `count` / `aggregate` / `stream` running natively ONLY when `isExactCriteria` proves the query exact and refining through the core engine otherwise (patterns, null/undefined operands, `json`/`blob` columns, nested paths), case-sensitive `starts` / `ends`, native `aggregate`'s zero-row `undefined`/`0` cases, `snapshot` capture-replay, persistence across a reopen against a temp file, `migrate` (atomic DDL via `stepToSQL`/`stepToSchema`, rejecting `MIGRATION` on an unknown table or a shared column's type/nullable drift), `meta` / `stamp` across a reopen, native `transaction` (double-settle `CONFLICT`), backend-fault → `DatabaseError` mapping (`CONSTRAINT`→`CONFLICT`, `CLOSED`→`CLOSED`, `BUSY`→`DRIVER` retryable, else `DRIVER`), and exact-vs-refine parity — the driver's results checked against the same criteria run through the core engine via `conformDriver`.
- [`tests/src/server/helpers.test.ts`](../../tests/src/server/helpers.test.ts) — the SQL bridge: `columnSQL`, `quote`, `fieldColumn`, `aggregateSQL`, `encodeValue` / `decodeValue` round-trips, `encodeRow` / `decodeRow` over a schema, `schemaToTable` / `schemaToIndexes` DDL projections, `indexName`'s collision-free length-prefixed naming, and `isExactCondition` / `isExactOrder` / `isExactCriteria`'s exactness predicates across every operator, nested path, and mismatched-type case.
- [`tests/src/server/compilers.test.ts`](../../tests/src/server/compilers.test.ts) — the pure `Criteria` → SQL compilers: `escapeLike`, `declaredType` / `valueType`, `fragment`, `compileWhere`, `compileOrder`, `compilePage`, and `compileCriteria`'s full clause assembly.
- [`tests/src/server/parity.test.ts`](../../tests/src/server/parity.test.ts) — cross-backend behavioral parity: the same `Criteria` set run against `MemoryDriver` and `SQLiteDriver` (both exact-path and refine-path queries) produce identical rows/counts/aggregates.
- [`tests/src/browser/drivers/IndexedDBDriver.test.ts`](../../tests/src/browser/drivers/IndexedDBDriver.test.ts) — `IndexedDBDriver`'s full surface against a real IndexedDB: `open`'s store/index creation (reopen-safe, auto-managed) and a `VALIDATION` throw when a declared table is named `__meta__`, keyed CRUD, native `records` / `count` / `stream` pushdown (primary-key and secondary-index ranges, `below`/`to` primary-only pushdown, reversed-`between` full-scan fallback, general full-scan fallback), `snapshot` capture-replay in one read transaction (excluding `__meta__`), `migrate` via a versionchange reconnect (rejecting `MIGRATION` on an unknown table), `meta` / `stamp` via the reserved `__meta__` store, backend-fault → `DatabaseError` mapping (`CONSTRAINT`→`CONFLICT`, `CLOSED`/`NOT_OPEN`/`INVALID`→`CLOSED`, `QUOTA`/`BLOCKED`→`DRIVER`, migrate `UPGRADE`→`MIGRATION`), and confirmation that `transaction` / `aggregate` are absent.
- [`tests/src/browser/helpers.test.ts`](../../tests/src/browser/helpers.test.ts) — the pushdown planner: `isKey`, `conditionRange` over every comparison operator (and `null` for non-comparison operators / non-scalar operands, and for a reversed `between`), `selectPlan`'s index/primary-key selection, `below`/`to` primary-only pushdown, `or`-join full-scan fallback, non-orderable-type / nested-path skip cases, `mapIndexedDBError` / `mapMigrationError`'s fault-code mapping, and `deriveIndexName`'s single-column/compound naming.
- [`tests/src/browser/factories.test.ts`](../../tests/src/browser/factories.test.ts) — `createIndexedDBDriver` returns a working `DriverInterface` instance (a round-trip end to end).
- [`tests/src/browser/parity.test.ts`](../../tests/src/browser/parity.test.ts) — cross-backend behavioral parity: the same `Criteria` set run against `MemoryDriver` and `IndexedDBDriver` produce identical rows/counts, including pushdown edge cases (`below`/`to` on a secondary-indexed column, a reversed `between`).

## See also

- [`contract.md`](contract.md) — the shape DSL and `createContract` a table is built on.
- [`AGENTS.md`](../../AGENTS.md) — the rules; §12 errors & `Result`, §14 totality, §21 minimal interface / one engine / native overrides, §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
