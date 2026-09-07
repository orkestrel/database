# Database

> One typed database API for keyed rows, fluent queries, cursors, and
> whole-store transactions, running unchanged over an in-memory map, a JSON
> file, SQLite, or IndexedDB.

A table is a contract. Declare a `tables` map of
[`ContractShape`](contract.md)s once, and the row type, write-time coercion and
validation, JSON-Schema introspection, and seed data all flow from that one
declaration — no separate schema, no annotations, no `as`.

The design stance is one engine, thin drivers. A backend implements only an
irreducible storage primitive — keyed read/write/insert/delete, an ordered
`scan`, key listing, and a `snapshot` — and inherits the entire WHERE / order /
page / aggregate surface from a single pure query engine in the core. A backend
that can go faster (a SQL `WHERE`, an index range) implements the optional
native hooks the engine falls back from; it never re-derives query semantics.
So this is deliberately not an ORM and not a query abstraction layer: there is
no entity graph, no migration runner, and no raw-SQL escape hatch — only the
smallest cross-environment core that earns its keep.

Source: [`src/core`](../src/core), published through `@orkestrel/database`. The
persistent drivers ship alongside it: a trusted-mode SQLite driver in
[`src/server`](../src/server) (surfaced through `@orkestrel/database/server`)
with native querying, paging, aggregation, transactions, and atomic migration,
and a narrow-then-refine IndexedDB driver in [`src/browser`](../src/browser)
(surfaced through `@orkestrel/database/browser`) that pushes a key-range
candidate set down to the index and lets the core engine refine it to the exact
result — beside the I/O-free `MemoryDriver` and the file-persisted
`JSONDriver`.

## Surface

Declare a `tables` shape map (keys are table names) once, and reach each
table — fully typed, no annotations — with `table(name)`.

### Create a database

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

| API                     | Kind     | Summary                                                                                                                               |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `createDatabase`        | function | Creates a database over a driver and a declared `tables` schema.                                                                      |
| `createMemoryDriver`    | function | Creates the in-memory reference `DriverInterface`.                                                                                    |
| `createJSONDriver`      | function | Creates a persistent JSON-file `DriverInterface` for a given path.                                                                    |
| `createSQLiteDriver`    | function | Creates a trusted-mode, server-native SQLite `DriverInterface` for a database path, or for `:memory:` when the options bag omits one. |
| `createIndexedDBDriver` | function | Creates a persistent IndexedDB `DriverInterface` for a browser database name.                                                         |

### Classes

| Class             | Kind  | Summary                                                                                                                                                |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Database`        | class | Exposes a typed view over one shared internal lifecycle and storage context.                                                                           |
| `DriverIterator`  | class | Forms the internal continuation boundary for a root driver async iterator.                                                                             |
| `MemoryDriver`    | class | Implements the reference `DriverInterface` — nested maps, no I/O.                                                                                      |
| `JSONDriver`      | class | Implements a persistent `DriverInterface` backed by a single JSON file — the reference `MemoryDriver` plus file load / flush.                          |
| `SQLiteDriver`    | class | Implements the `DriverInterface` over SQLite — the server-native, trusted-mode backend built on the published `@orkestrel/sqlite` synchronous wrapper. |
| `IndexedDBDriver` | class | Implements the `DriverInterface` over IndexedDB — the persistent browser backend, built on the published `@orkestrel/indexeddb` wrapper.               |

### Server

| API                          | Kind     | Summary                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `METADATA_TABLE`             | const    | Names the reserved metadata table the `SQLiteDriver` creates on `open` to persist its stamped `DriverMetadata` (`version` + declared schema JSON) — the SQLite realization of the `metadata` / `stamp` driver hooks.                                                                                                                                                         |
| `matchesConditionExactly`    | function | Reports whether one `Condition` compiles to SQL that is provably identical to the core engine's `matchesCondition` for every value its column's declared type can store.                                                                                                                                                                                                     |
| `matchesOrderExactly`        | function | Reports whether one `Order` term's column compiles to an `ORDER BY` that matches the engine's `sortRows` exactly.                                                                                                                                                                                                                                                            |
| `matchesQueryExactly`        | function | Reports whether a whole `QueryInput` is exact — every condition and every order term is exact. `limit` / `offset` never affect exactness (SQL `LIMIT` / `OFFSET` are always engine-identical).                                                                                                                                                                               |
| `matchesDeclaredStorage`     | function | Reports whether a value's runtime type matches a column's declared exact type — the operand side of the declared-type-trust proof.                                                                                                                                                                                                                                           |
| `EXACT_COLUMN_STORAGE`       | const    | Lists the declared `ColumnStorage`s whose SQL EQUALITY comparisons (`equals` / `not` / `any` / `none`) and `starts` / `ends` compiles are provably engine-exact under declared-type trust — `text` / `integer` / `real` / `boolean`; a `json` or `blob` column always refines instead.                                                                                       |
| `EXACT_RANGE_COLUMN_STORAGE` | const    | Lists the declared `ColumnStorage`s whose SQL RANGE comparisons (`above` / `below` / `from` / `to` / `between`) and `ORDER BY` compiles are provably engine-exact — `integer` / `real` / `boolean` only. `text` is excluded: see `EXACT_COLUMN_STORAGE`'s remarks for the BINARY-collation (code-point) vs. JS `<` (code-unit) divergence on supplementary-plane characters. |
| `extractValues`              | function | Extracts a stored row's values in a declared positional order.                                                                                                                                                                                                                                                                                                               |
| `deriveSQLiteIndexName`      | function | Builds a collision-free SQL index name for a table + column-group index — shared by the compiler module's `schemaToIndexes` and `stepToSQL`, so a plan-built index name always matches one `open` would have created.                                                                                                                                                        |

### SQL compilation

Pure, server-only functions that turn a core `QueryInput` / `TableSchema` into
parameterized SQL text — the native-query payoff for a SQLite-backed driver.
None of these import a SQLite package; they speak strings and values only.

| API                       | Kind     | Summary                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inferValueStorage`       | function | Reads the storage type a nested (`json_extract`) operand encodes as from its runtime value, never as `json`.                                                                                                                                                                                                                     |
| `compileJSONTypeSQL`      | function | Compiles a NESTED `FieldPath` to the `json_type(<col>, <path>)` SQL expression — the `compileFieldSQL` `json_extract` sibling used to tell a PRESENT JSON `null` apart from an ABSENT path (both read back as SQL `NULL` through `json_extract`, but `json_type` reports `'null'` for the former and SQL `NULL` for the latter). |
| `compileConditionSQL`     | function | Compiles one condition to its `<column> <operator>` SQL fragment and the parameters it binds — engine-exact under SQL's three-valued NULL logic.                                                                                                                                                                                 |
| `compileWhereSQL`         | function | Folds the conditions into one WHERE clause, parenthesizing progressively left-to-right so the grouping matches the engine's `matchesQuery` fold.                                                                                                                                                                                 |
| `compileOrderSQL`         | function | Compiles the ORDER BY clause from the order terms, always ending with the primary key as the final determinant.                                                                                                                                                                                                                  |
| `compilePageSQL`          | function | Compiles the LIMIT / OFFSET clause.                                                                                                                                                                                                                                                                                              |
| `compileQuerySQL`         | function | Compiles a `QueryInput` into the SQL clause that follows a table name, with its bound parameters in clause order.                                                                                                                                                                                                                |
| `quoteIdentifier`         | function | Quotes a SQL identifier (a table or column name) so any characters are literal.                                                                                                                                                                                                                                                  |
| `compileFieldSQL`         | function | Compiles a `FieldPath` to the SQL expression that reads it.                                                                                                                                                                                                                                                                      |
| `compileColumnSQL`        | function | Maps a portable `ColumnStorage` to its SQLite column type.                                                                                                                                                                                                                                                                       |
| `compileAggregateSQL`     | function | Compiles an `AggregateOperation` over a `FieldPath`.                                                                                                                                                                                                                                                                             |
| `matchesAggregateExactly` | function | Reports whether SQLite can execute an aggregate exactly like the core engine.                                                                                                                                                                                                                                                    |
| `matchesSQLiteAffinity`   | function | Checks a declared SQLite type against a portable storage affinity.                                                                                                                                                                                                                                                               |
| `matchesAbsentPath`       | function | Reports whether a caught filesystem error says that nothing is there to read.                                                                                                                                                                                                                                                    |
| `encodeValue`             | function | Encodes a JS value to its stored `SQLiteValue` for a declared column.                                                                                                                                                                                                                                                            |
| `decodeValue`             | function | Decodes a stored `SQLiteValue` back to its JS value for a declared column — the exact inverse of `encodeValue`.                                                                                                                                                                                                                  |
| `encodeRow`               | function | Encodes a whole `Row` to a `SQLiteRow` by its table's schema.                                                                                                                                                                                                                                                                    |
| `decodeRow`               | function | Decodes a stored `SQLiteRow` back to a `Row` by its table's schema.                                                                                                                                                                                                                                                              |
| `schemaToTable`           | function | Projects a `TableSchema` to its `CREATE TABLE IF NOT EXISTS` statement.                                                                                                                                                                                                                                                          |
| `schemaToIndexes`         | function | Projects a `TableSchema` to its declared SQLite indexes.                                                                                                                                                                                                                                                                         |
| `stepToSQL`               | function | Projects one `MigrationStep` to SQLite DDL.                                                                                                                                                                                                                                                                                      |

### Browser

Pure functions behind the IndexedDB driver's key-range pushdown planner — a
candidate SUPERSET the core engine then refines to the exact result, never
lossy.

| API                        | Kind     | Summary                                                                                                                                                                                              |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectPlan`               | function | Plans an IndexedDB read for a `QueryInput` — picks the index (or the primary store) and `IDBKeyRange` to narrow by, falling back to a full scan.                                                     |
| `conditionToRange`         | function | Translates one `Condition` to the `IDBKeyRange` it maps to, when its operator is one of the exact key comparisons over scalar operands; otherwise returns `undefined`.                               |
| `INDEXABLE_STORAGE`        | const    | Lists the declared `ColumnStorage`s that are valid, orderable IndexedDB keys.                                                                                                                        |
| `METADATA_STORE`           | const    | Names the reserved out-of-line store the `IndexedDBDriver` stamps its `DriverMetadata` into.                                                                                                         |
| `mapIndexedDBError`        | function | Maps a backend `IndexedDBError` to the portable `DatabaseError` taxonomy — the default mapping used everywhere except inside `migrate()`.                                                            |
| `mapMigrationError`        | function | Maps a backend `IndexedDBError` to the portable `DatabaseError` taxonomy for use INSIDE `migrate()` — the one context where `UPGRADE` means the migration itself failed, not a generic driver fault. |
| `deriveIndexedDBIndexName` | function | Derives an IndexedDB index name for a declared column group — a bare column name for a single-column index, a deterministic collision-free encoding for a compound one.                              |
| `schemaToStore`            | function | Projects a table schema into the IndexedDB wrapper's store definition.                                                                                                                               |

### Errors

| API               | Kind     | Summary                                               |
| ----------------- | -------- | ----------------------------------------------------- |
| `DatabaseError`   | class    | Represents an error thrown by the database layer.     |
| `isDatabaseError` | function | Narrows an unknown caught value to a `DatabaseError`. |

### Query engine

The portable semantics every backend shares — pure, total functions the
driver never re-implements.

| Helper                 | Kind     | Summary                                                                                                                                                                |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compareValues`        | function | Compares two arbitrary values under one total order — the comparator behind sorting and the range operators.                                                           |
| `matchesCondition`     | function | Evaluates one `Condition` against a row — the per-operator predicate.                                                                                                  |
| `matchesQuery`         | function | Folds a row through a list of conditions, joining each by its connector.                                                                                               |
| `sortRows`             | function | Sorts rows by an ordering specification, leaving the input untouched.                                                                                                  |
| `applyQuery`           | function | Applies a `QueryInput` to rows — filter, then sort, then page.                                                                                                         |
| `validatePage`         | function | Validates the paging fields of a portable query.                                                                                                                       |
| `computeAggregate`     | function | Computes an aggregate over a column across rows.                                                                                                                       |
| `extractKey`           | function | Reads a row's primary key from a column, when it is a usable `Key`.                                                                                                    |
| `bindRowKey`           | function | Returns a fresh row whose primary column is authoritatively bound to its storage key.                                                                                  |
| `shapeToColumnSchema`  | function | Projects one contract shape into a portable column schema.                                                                                                             |
| `findColumn`           | function | Reads one flat column's declaration out of a table schema.                                                                                                             |
| `resolvePrimary`       | function | Resolves the primary-key column one table keys its rows by.                                                                                                            |
| `requireColumns`       | function | Requires one declared table's columns out of a table map.                                                                                                              |
| `shapeToColumnStorage` | function | Maps a column's `ContractShape` to its portable `ColumnStorage` — the value a `TableSchema` carries so a native backend can declare a real column.                     |
| `filterRows`           | function | Filters rows by a list of conditions — the shared basis for a table's count and aggregate paths (no sort/page, unlike `applyQuery`).                                   |
| `equalsValue`          | function | Compares two values structurally by SameValueZero leaves — the comparator behind conformance checks and any test/fixture that needs "same data", not "same reference". |

### Abort

| API          | Kind     | Summary                                                                                                                   |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `checkAbort` | function | Throws when an `AbortSignal` has fired — the shared abort gate checked at operation boundaries and between streamed rows. |

### Migrations

Caller-driven schema migration — a pure structural diff plus a pure row
transform. Versioning drivers persist reconciliation metadata through the paired
`metadata` / `stamp` hooks.

| API                      | Kind     | Summary                                                                         |
| ------------------------ | -------- | ------------------------------------------------------------------------------- |
| `planMigration`          | function | Diffs a deployed and a declared table set structurally into a `Migration` plan. |
| `migrateRows`            | function | Applies one table's `MigrationStep`s to its rows — a pure row transform.        |
| `projectMigrationSchema` | function | Projects migration steps sequentially over a canonical validated owned schema.  |
| `normalizeDriverSchema`  | function | Canonicalizes an unknown driver schema into a distinct deeply frozen snapshot.  |

### Conformance

| API             | Kind     | Summary                                                                                                                                                                                                                                                             |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conformDriver` | function | Runs the driver-conformance battery, throwing on the first violated invariant — the fail-fast entry point most callers (test setup, CI smoke checks) want.                                                                                                          |
| `scanDriver`    | function | Walks the driver-conformance battery against a fresh `DriverInterface` per phase, yielding one `ConformanceFinding` per violated invariant — the shared invariant suite every backend (in-memory, SQLite, IndexedDB) must uphold to be a drop-in `DriverInterface`. |
| `auditDriver`   | function | Runs the FULL driver-conformance battery and collects every violation — the audit entry point for a driver author who wants a complete report rather than a single fail-fast throw.                                                                                 |

### Helpers & guards

Pure helpers behind the query engine's pattern matching.

| API                      | Kind     | Summary                                                                                                                                         |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloneDriverMetadata`    | function | Clones unknown driver metadata into a distinct deeply frozen snapshot.                                                                          |
| `matchesWildcardPattern` | function | Matches a value against a wildcard pattern in linear time — the shared, ReDoS-safe engine behind `matchesLikePattern` and `matchesGlobPattern`. |
| `matchesLikePattern`     | function | Matches a value against a SQL `LIKE` pattern, folding case.                                                                                     |
| `matchesGlobPattern`     | function | Matches a value against a `GLOB` pattern, preserving case.                                                                                      |
| `isDriverMetadata`       | function | Checks whether a value is persisted driver metadata.                                                                                            |
| `isDriverSchema`         | function | Checks whether a value is a complete portable driver schema.                                                                                    |
| `isColumnSchema`         | function | Checks whether a value is a portable column schema.                                                                                             |
| `isTableSchema`          | function | Checks whether a value is a portable table schema.                                                                                              |
| `isMigrationStep`        | function | Checks whether a value is one ordered migration step.                                                                                           |
| `isMigration`            | function | Checks whether a value is an ordered migration plan.                                                                                            |
| `isMigrationInput`       | function | Checks whether a value is one atomic migration request.                                                                                         |
| `isKey`                  | function | Checks whether a value is a usable database key.                                                                                                |
| `cloneDriverSchema`      | function | Clones unknown driver schema into a distinct deeply frozen snapshot.                                                                            |
| `cloneMigrationInput`    | function | Clones unknown migration input into a distinct deeply frozen snapshot.                                                                          |

### Constants

A `Shape` cell holds the constant's declared type.

| Constant                   | Kind  | Shape                    | Summary                                                                                                       |
| -------------------------- | ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_PRIMARY`          | const | `'id'`                   | Supplies the primary-key column assumed when `PrimaryMap` does not name one.                                  |
| `MAX_PATTERN_LENGTH`       | const | `1024`                   | Sets the longest `LIKE` / `GLOB` pattern the wildcard matcher accepts before rejecting it.                    |
| `CONFORMANCE_USERS_SCHEMA` | const | `TableSchema`            | Describes the `users` table the driver-conformance battery opens — keyed by the default `id` primary column.  |
| `CONFORMANCE_POSTS_SCHEMA` | const | `TableSchema`            | Describes the `posts` table the driver-conformance battery opens — keyed by a non-`id` `slug` primary column. |
| `CONFORMANCE_SCHEMA`       | const | `readonly TableSchema[]` | Holds the fixed two-table schema every driver-conformance phase opens.                                        |

### Types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`.

| Type                       | Kind      | Shape                                                                                                                                                                                                                                                                 | Summary                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Key`                      | type      | `string \| number`                                                                                                                                                                                                                                                    | Represents a primary key — the value identifying a row within its table.                                                                                                                                                                                                                                                                       |
| `KeyFunction`              | type      | `() => Key`                                                                                                                                                                                                                                                           | Represents a key-generating function.                                                                                                                                                                                                                                                                                                          |
| `Row`                      | type      | `Record<string, unknown>`                                                                                                                                                                                                                                             | Represents a table row — a plain record of column values keyed by column name.                                                                                                                                                                                                                                                                 |
| `ConditionOperator`        | type      | `'equals' \| 'not' \| 'above' \| 'below' \| 'from' \| 'to' \| 'between' \| 'like' \| 'glob' \| 'starts' \| 'ends' \| 'any' \| 'none' \| 'absent' \| 'present'`                                                                                                        | Represents a WHERE operator — the comparison a single `Condition` applies.                                                                                                                                                                                                                                                                     |
| `ConditionConnector`       | type      | `'and' \| 'or'`                                                                                                                                                                                                                                                       | Names how a `Condition` joins to the running result of the conditions before it.                                                                                                                                                                                                                                                               |
| `Condition`                | interface | `{ column, operator, values, connector }`                                                                                                                                                                                                                             | Represents one compiled WHERE condition.                                                                                                                                                                                                                                                                                                       |
| `OrderDirection`           | type      | `'ascending' \| 'descending'`                                                                                                                                                                                                                                         | Names a sort direction.                                                                                                                                                                                                                                                                                                                        |
| `Order`                    | interface | `{ column, direction }`                                                                                                                                                                                                                                               | Represents one ordering term — a column (`FieldPath`, flat or nested) and its direction.                                                                                                                                                                                                                                                       |
| `QueryInput`               | interface | `{ conditions?, order?, limit?, offset? }`                                                                                                                                                                                                                            | Represents a serializable read specification — everything a backend needs to compile one read, free of JS callbacks so any backend can honor it.                                                                                                                                                                                               |
| `AggregateOperation`       | type      | `'count' \| 'sum' \| 'average' \| 'minimum' \| 'maximum'`                                                                                                                                                                                                             | Names an aggregate computed over a numeric column.                                                                                                                                                                                                                                                                                             |
| `OperationOptions`         | interface | `{ signal? }`                                                                                                                                                                                                                                                         | Options for an abortable operation.                                                                                                                                                                                                                                                                                                            |
| `DatabaseStatus`           | type      | `'idle' \| 'open' \| 'closed'`                                                                                                                                                                                                                                        | Names the lifecycle state of a `DatabaseInterface`.                                                                                                                                                                                                                                                                                            |
| `AdmissionInterface`       | interface | `{ accepting } plus track`                                                                                                                                                                                                                                            | Represents the admission boundary a scoped operation enters before it runs.                                                                                                                                                                                                                                                                    |
| `DatabaseErrorCode`        | type      | `'CLOSED' \| 'NOT_FOUND' \| 'CONFLICT' \| 'VALIDATION' \| 'ABORTED' \| 'MIGRATION' \| 'CONFORMANCE' \| 'DRIVER'`                                                                                                                                                      | Names a machine-readable `DatabaseError` code.                                                                                                                                                                                                                                                                                                 |
| `ConformanceFinding`       | interface | `{ check, message, context }`                                                                                                                                                                                                                                         | Represents one violated invariant from the driver-conformance battery.                                                                                                                                                                                                                                                                         |
| `DatabaseEventMap`         | type      | `{ open, close, transaction, commit, rollback, migrate }`                                                                                                                                                                                                             | Describes the push observation surface of a `DatabaseInterface` — the connection + transaction lifecycle a fire-and-forget observer (logging, metrics, tracing, cache invalidation) subscribes to.                                                                                                                                             |
| `TableEventMap`            | type      | `{ write, remove, clear }`                                                                                                                                                                                                                                            | Describes the push observation surface of a `TableInterface` — the per-row mutation moments a fire-and-forget observer (cache invalidation, sync, an audit log) subscribes to, ALONGSIDE the database-level `DatabaseEventMap`.                                                                                                                |
| `ColumnMap`                | type      | `Readonly<Record<string, ContractShape>>`                                                                                                                                                                                                                             | Represents one table's columns — a map of column name to its value `ContractShape`.                                                                                                                                                                                                                                                            |
| `TableMap`                 | type      | `Readonly<Record<string, ColumnMap>>`                                                                                                                                                                                                                                 | Represents a database's table schema — a map of table name to its `ColumnMap`.                                                                                                                                                                                                                                                                 |
| `RowOf`                    | type      | `Infer<{ category: 'object'; properties: C }>`                                                                                                                                                                                                                        | Represents the row type a table's `ColumnMap` describe — `Infer` of the `objectShape` the database wraps them in.                                                                                                                                                                                                                              |
| `PrimaryMap`               | type      | `Readonly<Record<string, string>>`                                                                                                                                                                                                                                    | Holds per-table primary-key column overrides — `{ [table]: column }`.                                                                                                                                                                                                                                                                          |
| `IndexMap`                 | type      | `Readonly<Record<string, ReadonlyArray<readonly string[]>>>`                                                                                                                                                                                                          | Holds per-table secondary indexes — `{ [table]: groups }`, each group one (possibly compound) index of column names.                                                                                                                                                                                                                           |
| `ColumnStorage`            | type      | `'text' \| 'integer' \| 'real' \| 'boolean' \| 'json' \| 'blob'`                                                                                                                                                                                                      | Names a portable storage type for a column — the backend maps it to its native type (SQLite affinity, an IndexedDB value). Derived from a column's `ContractShape` by `shapeToColumnStorage`; `json` covers object/array/union/raw values a backend stores as JSON text and can `json_extract` for nested-field queries.                       |
| `ColumnSchema`             | interface | `{ name, storage, optional, nullable }`                                                                                                                                                                                                                               | Represents one column of a `TableSchema` — its name, portable `ColumnStorage`, and whether it independently accepts absence (`optional`) and explicit `null` (`nullable`).                                                                                                                                                                     |
| `TableSchema`              | interface | `{ name, primary, columns, indexes }`                                                                                                                                                                                                                                 | Represents a backend-agnostic description of one table — what `open` hands each driver so a native backend can create real tables and indexes.                                                                                                                                                                                                 |
| `MigrationStep`            | type      | `{ operation: 'table.add', table } \| { operation: 'table.remove', table } \| { operation: 'column.add', table, column } \| { operation: 'column.remove', table, column } \| { operation: 'index.add', table, index } \| { operation: 'index.remove', table, index }` | Represents one step of a `Migration` plan — a single schema change applied to one table.                                                                                                                                                                                                                                                       |
| `Migration`                | interface | `{ from, to, steps }`                                                                                                                                                                                                                                                 | Represents a schema migration plan — an ordered set of `MigrationStep`s moving a database from one schema version to another.                                                                                                                                                                                                                  |
| `MigrationInput`           | interface | `{ plan, metadata? }`                                                                                                                                                                                                                                                 | Represents one atomic migration request.                                                                                                                                                                                                                                                                                                       |
| `StorageInterface`         | interface | `{} plus read, write, insert, delete, keys, scan, clear, records?, aggregate?, stream?, migrate?, metadata?, stamp?`                                                                                                                                                  | Declares the storage operations available only inside a driver's transaction scope.                                                                                                                                                                                                                                                            |
| `DriverMetadata`           | interface | `{ version, schema }`                                                                                                                                                                                                                                                 | Represents persisted schema metadata a versioning driver owns as an immutable snapshot.                                                                                                                                                                                                                                                        |
| `DriverInterface`          | interface | `{} plus open, close, snapshot, read, write, insert, delete, keys, scan, clear, records?, aggregate?, stream?, migrate?, metadata?, stamp?, transaction?`                                                                                                             | Declares the storage primitive every backend implements — the whole of the bridge.                                                                                                                                                                                                                                                             |
| `DatabaseOptions`          | interface | `{ on?, error?, driver, tables, primary?, indexes?, name?, generator?, version? }`                                                                                                                                                                                    | Options for `createDatabase`.                                                                                                                                                                                                                                                                                                                  |
| `CompiledSQL`              | interface | `{ sql, parameters }`                                                                                                                                                                                                                                                 | Represents a parameterized SQL fragment or statement plus its bind values.                                                                                                                                                                                                                                                                     |
| `SQLiteDriverOptions`      | interface | `{ path?, readonly?, timeout?, references?, pragmas? }`                                                                                                                                                                                                               | Options for `createSQLiteDriver`.                                                                                                                                                                                                                                                                                                              |
| `QueryPlan`                | interface | `{ index?, range? }`                                                                                                                                                                                                                                                  | Represents a pushdown plan — an optional index and optional `IDBKeyRange` used to narrow a read. An omitted `index` selects the primary store; an omitted `range` performs a full scan. The plan is always a superset of the matching rows; the core engine refines it to the exact result. An empty plan (`{}`) is a primary-store full scan. |
| `TableDefinition`          | interface | `{ primary, columns, schema }`                                                                                                                                                                                                                                        | Represents one table's portable definition, produced by `export` — the unit of schema / migration exchange across environments.                                                                                                                                                                                                                |
| `DatabaseStorageInterface` | interface | `{} plus table`                                                                                                                                                                                                                                                       | Represents a database view valid only inside one `DatabaseInterface.transaction` scope.                                                                                                                                                                                                                                                        |
| `DatabaseInterface`        | interface | `{ emitter, name, status } plus table, import, export, open, close, transaction, migrate`                                                                                                                                                                             | Represents a database — the ergonomic entry point that owns the driver and its tables.                                                                                                                                                                                                                                                         |
| `TableInterface`           | interface | `{ emitter, name, primary, contract } plus get, resolve, has, keys, records, count, aggregate, scan, set, add, update, remove, clear, query, cursor`                                                                                                                  | Exposes typed keyed CRUD plus fluent query and cursor access.                                                                                                                                                                                                                                                                                  |
| `QueryInterface`           | interface | `{} plus condition, order, filter, limit, offset, collect, find, count, stream, aggregate`                                                                                                                                                                            | Builds a read through a fluent chain.                                                                                                                                                                                                                                                                                                          |
| `CursorInterface`          | interface | `{ value, index, done } plus next, update, remove, close`                                                                                                                                                                                                             | Walks a table's rows forward for bulk in-place mutation.                                                                                                                                                                                                                                                                                       |

## Methods

The public methods of each behavioral interface — one table per type, keyed
by its backticked name, every call-signature member listed (its `readonly`
data members, for example `emitter` / `name` / `status` / `primary` / `contract` /
`value` / `index` / `done`, stay in the Surface rows above — `emitter` is the
typed push observation surface, see [Observing](#observing)). Each
`### Classes` class implements its interface exactly, so this doubles as the
per-instance method surface (see `.claude/rules/documentation.md` § Parity).

#### `StorageInterface`

The storage capability a native driver passes into one transaction scope.
It exposes work, not settlement: the driver commits when the callback fulfills,
rolls back when it rejects, and invalidates the capability afterward. Every
method below runs inside that scope, and each carries the same contract its
`DriverInterface` twin carries against the whole backend, so the
`StorageInterface` and `DriverInterface` tables share one description per
method.

| Method      | Returns                                | Summary                                                                          |
| ----------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `read`      | `Promise<Row \| undefined>`            | Reads one row by key.                                                            |
| `write`     | `Promise<void>`                        | Writes one row at a key.                                                         |
| `insert`    | `Promise<void>`                        | Inserts one row atomically, rejecting `CONFLICT` when its key already exists.    |
| `delete`    | `Promise<boolean>`                     | Deletes one row by key.                                                          |
| `keys`      | `Promise<readonly Key[]>`              | Lists a table's keys.                                                            |
| `scan`      | `AsyncIterable<Row>`                   | Iterates a table's rows in ascending key order.                                  |
| `clear`     | `Promise<void>`                        | Empties a table.                                                                 |
| `records`   | `Promise<readonly Row[]>`              | Reads the rows matching a `QueryInput` natively — an optional hook.              |
| `aggregate` | `Promise<number \| undefined>`         | Computes an aggregate over a column natively — an optional hook.                 |
| `stream`    | `AsyncIterable<Row>`                   | Iterates the natively filtered rows lazily — an optional hook.                   |
| `migrate`   | `Promise<void>`                        | Applies one atomic `MigrationInput` — an optional hook.                          |
| `metadata`  | `Promise<DriverMetadata \| undefined>` | Reads the persisted `DriverMetadata` as a deeply frozen copy — an optional hook. |
| `stamp`     | `Promise<void>`                        | Writes the persisted `DriverMetadata`, snapshot at entry — an optional hook.     |

#### `DriverInterface`

The complete backend extends `StorageInterface` with lifecycle, the
snapshot floor, and an optional native transaction callback. The inherited
storage/query/migration/metadata methods carry the same contract they carry on
`StorageInterface`, addressed against the whole backend rather than one
transaction scope. `open` receives the derived `TableSchema` list: a native
backend builds real tables and indexes from it, a scan-only backend reads
`name` alone. `snapshot` with no `tables` captures the whole store, while a
list scopes capture and restore to those tables. An omitted optional hook
costs nothing — the core query engine answers `records`, `aggregate`, and
`stream` over `scan` instead, and a driver without `transaction` runs a scope
on the snapshot floor (see [Native transactions](#native-transactions)).

| Method        | Returns                                | Summary                                                                                                                                                          |
| ------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`        | `Promise<void>`                        | Readies the tables from a derived `TableSchema` list.                                                                                                            |
| `close`       | `Promise<void>`                        | Releases the backend.                                                                                                                                            |
| `snapshot`    | `Promise<() => Promise<void>>`         | Captures table rows and returns a repeatable thunk that restores those rows — the primitive transactions are built on.                                           |
| `read`        | `Promise<Row \| undefined>`            | Reads one row by key.                                                                                                                                            |
| `write`       | `Promise<void>`                        | Writes one row at a key.                                                                                                                                         |
| `insert`      | `Promise<void>`                        | Inserts one row atomically, rejecting `CONFLICT` when its key already exists.                                                                                    |
| `delete`      | `Promise<boolean>`                     | Deletes one row by key.                                                                                                                                          |
| `keys`        | `Promise<readonly Key[]>`              | Lists a table's keys.                                                                                                                                            |
| `scan`        | `AsyncIterable<Row>`                   | Iterates a table's rows in ascending key order.                                                                                                                  |
| `clear`       | `Promise<void>`                        | Empties a table.                                                                                                                                                 |
| `records`     | `Promise<readonly Row[]>`              | Reads the rows matching a `QueryInput` natively — an optional hook.                                                                                              |
| `aggregate`   | `Promise<number \| undefined>`         | Computes an aggregate over a column natively — an optional hook.                                                                                                 |
| `stream`      | `AsyncIterable<Row>`                   | Iterates the natively filtered rows lazily — an optional hook.                                                                                                   |
| `migrate`     | `Promise<void>`                        | Applies one atomic `MigrationInput` — an optional hook.                                                                                                          |
| `metadata`    | `Promise<DriverMetadata \| undefined>` | Reads the persisted `DriverMetadata` as a deeply frozen copy — an optional hook.                                                                                 |
| `stamp`       | `Promise<void>`                        | Writes the persisted `DriverMetadata`, snapshot at entry — an optional hook.                                                                                     |
| `transaction` | `Promise<R>`                           | Opens a native transaction scope — an optional driver hook. The driver owns acquisition, commit or rollback, release, and invalidation of the scoped capability. |

#### `DatabaseInterface`

`transaction` and `migrate` each take an optional `OperationOptions`, whose
`signal` is checked once, at entry.

| Method        | Returns                                     | Summary                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table`       | `TableInterface<RowOf<T[K]>>`               | Returns the typed handle for a declared table.                                                                                                                                                                                                |
| `import`      | `DatabaseInterface<U>`                      | Defines a further shape map of tables as a typed view over the same driver and storage.                                                                                                                                                       |
| `export`      | `Readonly<Record<string, TableDefinition>>` | Returns one portable `TableDefinition` per declared table.                                                                                                                                                                                    |
| `open`        | `Promise<void>`                             | Connects the driver eagerly, ahead of the lazy connect on first use.                                                                                                                                                                          |
| `close`       | `Promise<void>`                             | Closes the database and releases its driver.                                                                                                                                                                                                  |
| `transaction` | `Promise<R>`                                | Runs a scope over a `DatabaseStorageInterface`, committing when the callback fulfills and rolling back when it rejects.                                                                                                                       |
| `migrate`     | `Promise<Migration>`                        | Diffs a caller-supplied deployed schema against this database's declared schema (its `tables`, as configured) through `planMigration`, applies the resulting plan through the driver's optional `migrate` hook, and returns the applied plan. |

#### `DatabaseStorageInterface`

The scoped view and every table taken from it throw `CONFLICT` for work started
after the transaction settles.

| Method  | Returns                       | Summary                                                |
| ------- | ----------------------------- | ------------------------------------------------------ |
| `table` | `TableInterface<RowOf<T[K]>>` | Returns a table bound to the active transaction scope. |

#### `AdmissionInterface`

The admission boundary the root database context and a transaction scope both
expose; its `accepting` data member stays in the Surface row above.

| Method  | Returns      | Summary                                                                                                             |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `track` | `Promise<R>` | Enters one operation into the boundary's ledger so whoever stops the boundary contains everything already accepted. |

#### `TableInterface`

The keyed methods batch by overload (one in → one out; array in → array
out) — a single verb, never `getMany` / `setAll`. `records()` / `scan()`
narrow every row through the table's contract guard, so a non-conforming
stored row (legacy data, a row from before a migration) never appears in
their results. `count()` uses the same contract-valid candidate semantics as
`records()` while ignoring paging, so invalid stored rows do not consume the
count. `aggregate()` remains a stored-row operation; its `count` aggregate may
therefore include a row that `TableInterface.count()` excludes. `records`,
`count`, `aggregate`, `scan`, `set`, `add`, `update`, and `remove` each take an
optional `OperationOptions`: its `signal` reaches every backend commit point,
and an aborted batch keeps the items already committed.

| Method      | Returns                              | Summary                                                                              |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `get`       | `Promise<T \| undefined>` (or array) | Reads one row by key, or one row per key for a list — `undefined` for each miss.     |
| `resolve`   | `Promise<T>` (or array)              | Reads one row by key, or one row per key for a list, throwing `NOT_FOUND` on a miss. |
| `has`       | `Promise<boolean>` (or array)        | Reports whether one key exists, or one result per key for a list.                    |
| `keys`      | `Promise<readonly Key[]>`            | Lists every primary key in order.                                                    |
| `records`   | `Promise<readonly T[]>`              | Reads the contract-valid rows matching an optional `QueryInput`.                     |
| `count`     | `Promise<number>`                    | Counts contract-valid rows matching `input`'s conditions.                            |
| `aggregate` | `Promise<number \| undefined>`       | Computes an aggregate over `column` across rows matching `input`'s conditions.       |
| `scan`      | `AsyncIterable<T>`                   | Iterates the table's rows lazily with filtering.                                     |
| `set`       | `Promise<Key>` (or array)            | Upserts one or more rows.                                                            |
| `add`       | `Promise<Key>` (or array)            | Inserts one or more rows, throwing `CONFLICT` on a duplicate key.                    |
| `update`    | `Promise<boolean>` (or array)        | Applies a partial change to one or more rows.                                        |
| `remove`    | `Promise<boolean>` (or array)        | Deletes one or more rows.                                                            |
| `clear`     | `Promise<void>`                      | Empties the table.                                                                   |
| `query`     | `QueryInterface<T>`                  | Opens a fluent query builder over the table.                                         |
| `cursor`    | `Promise<CursorInterface<T>>`        | Opens a forward row cursor for bulk mutation.                                        |

#### `QueryInterface`

Each modifier mutates and returns the same builder. `condition` accepts the
portable condition directly, `order` accepts one portable order, and the
terminal methods execute the accumulated `QueryInput`. `stream` takes an
optional `OperationOptions` and ignores `order`, because rows are evaluated one
at a time.

| Method      | Returns                        | Summary                                                                          |
| ----------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `condition` | `QueryInterface<T>`            | Adds one portable condition, including its explicit connector.                   |
| `order`     | `QueryInterface<T>`            | Adds one portable ordering term — a column and a direction.                      |
| `filter`    | `QueryInterface<T>`            | Adds a post-fetch JavaScript predicate.                                          |
| `limit`     | `QueryInterface<T>`            | Caps the result count.                                                           |
| `offset`    | `QueryInterface<T>`            | Skips the leading rows.                                                          |
| `collect`   | `Promise<readonly T[]>`        | Executes the accumulated read and collects every matching row.                   |
| `find`      | `Promise<T \| undefined>`      | Executes the accumulated read and returns the first match, or `undefined`.       |
| `count`     | `Promise<number>`              | Executes the accumulated read and returns the match count.                       |
| `stream`    | `AsyncIterable<T>`             | Evaluates this query's conditions / filters / offset / limit lazily, row by row. |
| `aggregate` | `Promise<number \| undefined>` | Executes a named aggregate over one column.                                      |

#### `CursorInterface`

| Method   | Returns         | Summary                                                            |
| -------- | --------------- | ------------------------------------------------------------------ |
| `next`   | `Promise<void>` | Advances to the next present row.                                  |
| `update` | `Promise<void>` | Merges changes into the row at the current position.               |
| `remove` | `Promise<void>` | Deletes the row at the current position.                           |
| `close`  | `void`          | Closes the cursor terminally, so every later operation is a no-op. |

## Contract

These invariants hold across the core database source tree ↔ this guide:

1. **DOC ↔ PUBLIC ENTRY bijection.** Every `function` / `const` / `class` /
   `interface` / `type` row in the `## Surface` tables is reachable from the
   `src/core`, `src/server`, or `src/browser` entry barrel, and every reachable
   public export appears as a Surface row — compiler-resolved and exhaustive in
   both directions (see `.claude/rules/documentation.md` § Parity). Exported
   implementation declarations outside
   an entry barrel remain internal.
2. **A table is a contract.** Every write is coerced **and** validated
   through the table's compiled contract — `set` / `add` / `update` run the
   row through the installed Contract 0.0.9 `contract.parse`, one step that
   both coerces and enforces constraints such as `min` / `pattern`. Every
   parsed result already satisfies `contract.is`, so `Table` does not run a
   second guard after parsing; a row that fails throws `VALIDATION`. Reads are
   narrowed back to the table's row type through the guard — never an `as`
   (see `AGENTS.md` § Non-negotiable rules). The
   row type is the shape's `Infer`, so a `tables` map types every table from
   one declaration. A contract rejection reports only the table plus the first
   bounded contract fault (`field` and `reason` when one exists); the rejected
   row, received value, and parser cause never enter the message, context,
   serialized error, or table events.
3. **Thin driver, one engine, native overrides.** The REQUIRED
   `DriverInterface` surface is the irreducible storage primitive — keyed
   read/write/atomic-insert/delete, an ordered `scan`, key listing, and `snapshot`. `open`
   hands the driver a derived `TableSchema[]` (each table's `columns`, their
   portable `ColumnStorage` through `shapeToColumnStorage`, the `primary` key, and declared
   `indexes`) so a native backend can build real tables and indexes; a
   scan-only backend reads only `name`. The pure, total query engine
   (`applyQuery` / `matchesQuery` / `computeAggregate` / …) over `scan`
   is the default and the only REQUIRED path. A backend MAY implement the
   optional native `records?` / `aggregate?` / `transaction?` /
   `stream?` / `migrate?` where it has a faster or more native path, and the
   engine prefers each when present — falling back to the portable path
   otherwise (see `.claude/rules/architecture.md` § System constraints).
   Because `aggregate?` legitimately resolves to
   `undefined` (a sum over zero rows), `Table.aggregate` decides the hook ran
   by its **presence** (a present method returns a Promise; `?.()` is
   `undefined` only when the method is absent), never by the resolved value.
   Neither reference driver implements `records?` / `aggregate?`,
   so every query runs the engine over key-ordered `scan`; both DO implement
   `stream?` and `migrate?` (`MemoryDriver.stream` lazily filters `scan` through
   the engine; `JSONDriver.stream` delegates to its inner `MemoryDriver`).
   `MemoryDriver` still lacks a native `transaction?`, so its transactions
   always use the snapshot floor; `JSONDriver` DOES implement
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
   therefore prefers this native path over the snapshot floor. Both reference drivers also
   implement the paired `metadata?` / `stamp?` — `MemoryDriver` in-process only
   (the owned `DriverMetadata` snapshot lives in instance memory), `JSONDriver` persisted:
   the file is `{ metadata?: DriverMetadata, tables }`, with `metadata` present only
   once the store has been `stamp`ed at least once (an old, pre-versioning
   file — bare `{ tables }` — reads back as unstamped, that is, `metadata()`
   resolves `undefined`; a bare `{ tables }` document is therefore unstamped). A `JSONDriver` write-path
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
   picture from opposite ends, each earning trust its own way (see
   `.claude/rules/architecture.md` § System constraints).
   `SQLiteDriver` is **prove-exactness-or-refine**: real `CREATE TABLE` /
   `CREATE INDEX` DDL backs every table, but `records?` /
   `aggregate?` / `stream?` compile a `QueryInput` straight to SQL
   (`compileQuerySQL`, `compileAggregateSQL`) and run it natively only when
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
   supplementary-plane characters (code points ≥ U+10000, for example many emoji) —
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
   down only onto the primary store, never a secondary index — a secondary
   index has no entry for a row whose indexed column is absent or `null`,
   while the engine's total order (`compareValues`) lets those rows match a
   `below` / `to` bound; `equals` / `above` / `from` / `between` remain
   index-eligible on either. `conditionToRange` returns `undefined` for a `between`
   whose bounds are reversed (`compareValues(first, second) > 0`), so
   `selectPlan` falls back to a full scan instead of handing a raw
   backwards `IDBKeyRange` to the store (which would throw a `DataError`).
   `IndexedDBDriver.snapshot()` captures every store in one read transaction,
   so the capture is point-in-time consistent across stores even under
   concurrent writers; `restore` was already atomic. `SQLiteDriver` and
   `IndexedDBDriver` each implement `migrate?` natively and treat `MigrationInput` as one commit unit:
   `SQLiteDriver` applies schema, rows, and optional metadata inside one native
   SQLite transaction (`stepToSQL` projects each step's DDL), while a migration
   invoked inside an existing callback transaction uses one fixed internal
   savepoint SQL literal. The published `@orkestrel/sqlite` wrapper
   intentionally exposes raw `execute` but no savepoint manager; the savepoint
   contains a caught inner migration so it cannot leak partial DDL and the
   outer transaction remains active for unrelated work.
   `IndexedDBDriver` performs a non-empty plan in one versionchange transaction,
   writing `metadata` in that SAME upgrade; a metadata-only input uses one ordinary
   `__metadata__` readwrite transaction. A `column.remove` step that meets a stored
   value which is not a record fails the migration closed with `MIGRATION` and
   nothing is rewritten. Both implement the paired `metadata?` /
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
   never returns `NaN`), mirroring the contracts guards' totality (see
   `.claude/rules/patterns.md` § Validation and contracts). The range
   operators (`above` / `below` / `from` / `to` /
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
   graph to drain — not only the promise the callback returns. A rejected
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
6. **Observation is a pure side-channel.** The core `Database` owns a
   typed `emitter` (`DatabaseEventMap` — `open` / `close` / `transaction` /
   `commit` / `rollback` / `migrate`) and each `Table` owns one (`TableEventMap` —
   `write` / `remove` / `clear`, KEY only, no value payload to avoid heavy
   fan-out / leaking row data). Every event is emitted directly (the
   `.claude/rules/patterns.md` § Listener isolation convention: the emitter
   isolates a listener throw, routing it to its
   own `error` handler — the `error` option, surfaced as `(error, event)`,
   not a domain event — itself re-entrancy-guarded) strictly after the
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
   on one driver. `import(tables)` returns a new view of only those tables
   over the **same** driver (sharing storage and transactions); `export()`
   emits a portable `TableDefinition` per table — `schema` is the universally
   portable JSON Schema, `columns` re-imports losslessly through `import` within
   a TypeScript environment.
8. **DOC ↔ SOURCE method bijection.** Every behavioral interface's
   `## Methods` table lists exactly its public methods (call-signature
   members) — exhaustive, both directions — and each implementing class
   (`Database` / `MemoryDriver` / `JSONDriver` / `SQLiteDriver` /
   `IndexedDBDriver` / `Table` / `Query`) implements
   every REQUIRED method and adds none beyond the interface (optional members
   like `records?` / `aggregate?` / `transaction?` / `stream?` /
   `migrate?` / `metadata?` / `stamp?` may be omitted). `MemoryDriver` and
   `JSONDriver` both omit `records?` / `aggregate?`, and both
   implement `stream?` / `migrate?` / `metadata?` / `stamp?`; `MemoryDriver` still
   omits `transaction?` (snapshot floor only) while `JSONDriver`
   implements `transaction?` too (isolated candidate state plus one atomic
   publish on callback fulfillment). `SQLiteDriver` implements every optional hook — `records?` /
   `aggregate?` / `transaction?` / `stream?` / `migrate?` / `metadata?`
   / `stamp?` — the fully-native backend. `IndexedDBDriver` implements
   `records?` / `stream?` / `migrate?` / `metadata?` / `stamp?` but
   omits `transaction?` and `aggregate?` by IndexedDB's nature, not by
   choice (see `.claude/rules/documentation.md` § Parity). A renamed / added /
   removed method breaks the gate
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
    which still owns knowing what is deployed. A driver that DOES
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
    non-`id` primary key, structural round-tripping through `equalsValue`), then
    presence-gates the optional `migrate?` / `stream?` / `transaction?`
    hooks when the driver implements them. The battery's `write-read` phase
    is deepened with nested-field checks (a written row's nested object/array
    fields must copy-in/copy-out isolated, not only its top-level fields),
    and a dedicated `snapshot-nested` phase asserts the same nested isolation
    across a `snapshot()` capture/restore round-trip — a driver that
    shallow-copies anywhere in its write/read/scan/snapshot boundary
    fails conformance (`MemoryDriver` passes by deep-copying through
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
state, and every flush is atomic — written to a sibling temp file and
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
(`DatabaseEventMap` / `TableEventMap`) carrying the transaction +
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
flow into each table's derived `TableSchema`. Neither driver here declares a
native index, so both ignore them; SQLite and IndexedDB use supported
declarations for native indexes and still refine through the shared engine when
required.

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

`MemoryDriver` implements the native `stream` hook and neither `records` nor
`aggregate`, so the core engine's `matchesQuery` answers every query on either
path. It is I/O-free, making it the storage behind tests, ephemeral caches, and any code
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

The keyed methods batch by overload (see `.claude/rules/patterns.md`
§ Batch operations) — one key/row in, one
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

// A dotted string is a column literally named 'payload.id', not a path:
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
ledger, so work accepted immediately before the transaction is included and work
attempted immediately after the boundary conflicts; there is no unobserved gap where a
root write can escape into the transaction. If rollback cleanup fails, the
operation rejects `DatabaseError('DRIVER')` with exact evidence
`{ cause: rollbackFailure, transaction: originalFailure }` and emits no
`rollback` event.

`AdmissionInterface` is that ledger's published contract — the one shape the
root context and a transaction scope both present. No public call returns an
instance (every implementor is internal), so read it as the boundary shape a
scoped operation is entered into:

```ts
import type { AdmissionInterface } from '@orkestrel/database'

const boundary: AdmissionInterface = {
	accepting: true,
	track: (operation) => operation(),
}
boundary.accepting // true
await boundary.track(async () => 42) // 42
```

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
(useful outside a `Database`, for example against a bare driver):

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
only has to track what is deployed:

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
import { scanDriver } from '@orkestrel/database'
for await (const finding of scanDriver(() => createMemoryDriver())) {
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

Both the `Database` and each `Table` expose a typed `emitter` (see
`.claude/rules/patterns.md` § Stateful emitters)
carrying its lifecycle for fire-and-forget observers — logging, metrics,
**cache invalidation, a sync layer**. The vocabulary is split by audience:
the **database** carries the connection + transaction moments, each **table**
the per-row mutations (KEY only — no value payload, to keep fan-out lean; a
consumer that needs the value re-reads it). Subscribe through
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

**The listener-isolation safety guarantee.** A listener throw never escapes
into the engine: the emitter isolates it and routes it to
its own `error` handler (the `error` option, surfaced as `(error, event)`),
not to a domain event — so a buggy observer is isolated yet not silently
lost. The `error` handler runs in its own try/catch, so even a throwing
handler can't recurse or escape; with no handler, the throw is swallowed
silently. Every throwing listener surfaces (not only the first). Because
every emit sits after its transition AND is isolated, a buggy observer
**cannot corrupt a write or a transaction**: a throwing `commit` observer
leaves the committed state intact, a throwing `rollback` observer cannot
suppress the propagated transaction error (the original throw still
propagates, the tables still roll back), and a throwing `write` observer
leaves the written row intact — proven by the per-entity emit-safety tests.
(A `Table` reached through the `Database` receives the same `error` handler
the `DatabaseOptions.error` option supplies, so a `Table` listener throw
routes there; with no `error` handler configured, the throw is swallowed
silently.)

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
exported.columns // the source column map (re-imports through `import` in a TS environment)
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
await db.open() // connects immediately — table() calls after this never wait on it
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

A native override earns the engine's trust by proving exactness or by
narrowing then refining (see `.claude/rules/architecture.md` § System
constraints).
**Prove-exactness-or-refine** (`SQLiteDriver`): the backend has real typed
columns and indexes, so it compiles the `QueryInput` straight to SQL and runs
it natively only when `matchesQueryExactly` first proves the SQL and the engine
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
	pragmas: { journal_mode: 'WAL' }, // applied through pragma() right after connect(), in order
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
the wrapper deliberately provides raw `execute`, not a savepoint manager, so the
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
import type { IndexedDBError } from '@orkestrel/indexeddb'
import { mapIndexedDBError, mapMigrationError } from '@orkestrel/database/browser'

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

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ compiler-resolved public-entry bijection across `src/core`, `src/server`, and `src/browser`, including fail-closed temporary-project coverage for barrel resolution and unsupported exports, each interface ↔ implementing-class method bijection, and the equality gate: every `Summary` cell against its declaration's description paragraph, the titled `Create a database` fence against the `@example` block of that title (pinned so the titled pair cannot be retired silently), and the README pitch against this guide's tagline. It also compiles every TypeScript fence against the published entry specifiers and runs the flagship fences, asserting the values their comments claim.
- [`tests/src/core/cloners.test.ts`](../tests/src/core/cloners.test.ts) — `cloneDriverMetadata` ownership: normalized deeply frozen distinct output, caller-mutation isolation, and `VALIDATION` translation for malformed, cyclic, functional, accessor, and hostile/revoked-proxy inputs without leaking raw Contract or caller errors.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — total boundary guards for keys, columns, tables, driver schemas, migrations, inputs, and metadata.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — the query engine: `validatePage`'s strict page matrix, deterministic field order, exact non-finite diagnostics, and legal zero; `findColumn`'s flat-column lookup and its `undefined` miss; `resolvePrimary`'s declared-or-default key and `requireColumns`'s typed map lookup with its `NOT_FOUND` throw; `compareValues` total order, every `matchesCondition` operator (the equality family — `equals` / `not` / `any` / `none` — through `equalsValue`, including `NaN`-equals-`NaN`; the range family through `compareValues`), `matchesQuery` folding, `filterRows`, `sortRows`, `applyQuery`, `computeAggregate`, `extractKey`, `shapeToColumnStorage`'s shape → portable-type mapping (scalars, `json` for object/array/union/raw, optional/nullable unwrap, literal-by-values), total `isDriverMetadata` rejection of malformed and hostile getter/proxy input, `equalsValue`'s structural equality, `planMigration`'s `MIGRATION` throw on a shared column's storage/nullability drift, and the `scanDriver` / `conformDriver` / `auditDriver` battery against `MemoryDriver` and a deliberately-broken driver (each check fails with a `CONFORMANCE` `DatabaseError`), including the deepened `write-read` nested-field checks and the `snapshot-nested` phase (a shallow-copying driver fails it).
- [`tests/src/core/drivers/MemoryDriver.test.ts`](../tests/src/core/drivers/MemoryDriver.test.ts) — the driver primitive: `open(schema)` readies tables, read/write/atomic-insert/delete/keys/scan/clear + `snapshot` rollback, duplicate-insert `CONFLICT`, non-JSON row isolation through native `structuredClone`, metadata stamp/migrate/copy-out ownership through `cloneDriverMetadata`, strict stream paging, and pre-aborted point mutations rejecting `ABORTED` without changing rows.
- [`tests/src/core/Database.test.ts`](../tests/src/core/Database.test.ts) — declared tables, lazy connect, typed CRUD, custom keys, indexes, import/export, and callback transactions: whole accepted-operation drain, synchronous-throw and asynchronous-rejection reason identity, caught-operation rejection still rolling back, callback-over-drain error precedence, root/import/lifecycle/nesting barriers, stale scoped table/query/cursor/stream invalidation, and truthful successful-rollback-only events. It also covers explicit migration and versioned open: deployed-schema-first reconciliation, fresh stamp, same-version no-op, atomic upgrade input, higher-version rejection, paired-hook enforcement (metadata-only and stamp-only are inert), and migrate-event behavior.
- [`tests/src/core/ScopedIterator.test.ts`](../tests/src/core/ScopedIterator.test.ts) — direct internal continuation-lifetime coverage: tracked `next` / `return` / `throw`, the readiness thunk running before every advance and its failure preempting the source, synchronous source throws, missing methods, concurrent accepted continuations, idle iterators, late conflicts, and exactly-once rejected cleanup.
- [`tests/src/core/DriverIterator.test.ts`](../tests/src/core/DriverIterator.test.ts) — direct root-driver continuation coverage: pre/post-read guards, produced-row discard, terminalization, return races, missing methods, throw delegation, and exactly-once cleanup.
- [`tests/src/core/Table.test.ts`](../tests/src/core/Table.test.ts) — `Table`'s keyed CRUD + batch overloads, payload-safe bounded contract diagnostics, strict paging at every read boundary, coercion and error paths, `add` dispatch through atomic `insert` (including concurrent duplicate claims), sequential partial-batch abort semantics, and the emitter's post-commit/no-aborted-event guarantees.
- [`tests/src/core/Query.test.ts`](../tests/src/core/Query.test.ts) — `Query`'s where / and / or dispatch, ordering, synchronous strict page builders with no failed mutation, legal zero, `filter`, and aggregates.
- [`tests/src/core/Cursor.test.ts`](../tests/src/core/Cursor.test.ts) — cursor behavior over a key snapshot: `value` / `index` / `done`, serialized overlapping `next` / `update` / `remove`, rejection recovery, synchronous runner admission, terminal close before queued work and during dispatched reads/mutations, plus transaction-ledger regressions for deleted-key skipping, unawaited normalized updates, validation rollback, and retained closed/active conflicts.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createDatabase` / `createMemoryDriver` each return a working instance of their interface (a round-trip end to end).
- [`tests/src/core/TransactionScope.test.ts`](../tests/src/core/TransactionScope.test.ts) — direct transaction-lifetime coverage: `accepting` and the `check` refusal, synchronous admission through `track`, a synchronous operation throw captured as a rejection, unawaited work contained by `drain`, the drain loop re-reading work another tracked operation admitted, first-failure identity preserved across repeated drains, and `stream`'s per-continuation boundary leaving an idle iterator unpinned.
- [`tests/src/core/DatabaseContext.test.ts`](../tests/src/core/DatabaseContext.test.ts) — direct shared-context coverage: `register`'s identical-schema merge, its `VALIDATION` conflict, and its `CONFLICT` / `CLOSED` refusals; idle → open → closed transitions emitted once with one shared readiness promise; root admission, its transaction-time `CONFLICT`, and close-time drain; transaction commit / rollback events and value or error propagation, nested-transaction refusal, entry-only signal checking, and a fresh `TransactionScope` per attempt; explicit migration's missing-hook and post-open refusals; and versioned reconciliation's fresh stamp, newer-store rejection, differing-schema rejection, and same-version no-op.
- [`tests/src/core/DatabaseTransaction.test.ts`](../tests/src/core/DatabaseTransaction.test.ts) — direct transaction-view coverage: the typed table `table()` builds over the scoped driver, its writes landing straight on that driver, the scope `CONFLICT` after settlement, the `NOT_FOUND` refusal for an undeclared table, a per-table primary override, a scoped table refusing work started after settlement, and the configured generator minting a key for a keyless write.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — `createJSONDriver` / `createSQLiteDriver` each return a working `DriverInterface` instance (a round-trip end to end), drive the core `createDatabase` stack, and persist across a reopen; `createSQLiteDriver` defaults to an in-memory database when its options bag is omitted.
- [`tests/src/server/drivers/JSONDriver.test.ts`](../tests/src/server/drivers/JSONDriver.test.ts) — `JSONDriver` persistence plus atomic insert and the exclusive point-mutation queue: queued abort/no late start, active staging restoration, cleanup-success error precedence, deterministic real-filesystem persistence-plus-cleanup dual failure with exact evidence and queue recovery, read isolation, concurrent-writer ordering, fail-closed real-filesystem coverage for non-absence reads, invalid syntax/documents/table sets/containers/rows/metadata, byte preservation, no partial publication, application-invalid row retention, payload-safe rejection, strict stream paging, and same-instance external-repair retry; synchronous root/scoped stamp and migration ownership, deeply frozen distinct copy-out, deployed-schema-first open, isolated callback/root-migration candidates whose rows/schema/metadata publish only after file replacement succeeds, transaction-time root scan/stream continuation conflicts with terminal cleanup, and post-native-rollback rejection replacement.
- [`tests/src/server/drivers/SQLiteDriver.test.ts`](../tests/src/server/drivers/SQLiteDriver.test.ts) — `SQLiteDriver`'s native surface: deployed-metadata-first open and reconciliation; fail-closed malformed metadata, physical schema disagreement, and persisted-table loss before DDL, including deterministic first-loss evidence, physical non-recreation, external repair, and same-driver retry; root/scoped stamp/migration ownership and distinct deeply frozen copy-out; atomic insert/duplicate `CONFLICT`; point-mutation abort boundaries; strict direct records/aggregate/stream paging; native exact-or-refine query and aggregate paths; repeatable schema-aware snapshot capture/replay plus real dropped-table and exclusive-lock failure containment/recovery; atomic `MigrationInput` schema/rows/metadata at the root; fixed-literal savepoint containment for a caught migration failure while its callback transaction remains active; candidate-schema publication only after commit; callback transaction barriers/invalidation including root continuation cleanup; payload-safe rejection; post-native-rollback rejection replacement; backend-fault mapping; and engine parity.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — the SQLite bridge: `quoteIdentifier`, codecs, row extraction, `deriveSQLiteIndexName` exact bytes, and the `matchesConditionExactly` / `matchesOrderExactly` / `matchesQueryExactly` / `matchesAggregateExactly` / `matchesSQLiteAffinity` predicates.
- [`tests/src/server/compilers.test.ts`](../tests/src/server/compilers.test.ts) — the coherent SQL-emitter cluster: column/field/aggregate compilation, table/index/migration DDL, and the strict-page `QueryInput` → SQL pipeline with exact statements and parameters.
- [`tests/src/server/inferers.test.ts`](../tests/src/server/inferers.test.ts) — `inferValueStorage`'s nested-operand storage inference: the `ColumnStorage` a `json_extract` operand must encode as, over booleans, integral and fractional numbers, bigints, objects and arrays, strings, `null`, and `undefined`.
- [`tests/src/server/integration.test.ts`](../tests/src/server/integration.test.ts) — cross-backend behavioral parity: the same `QueryInput` set run against `MemoryDriver` and `SQLiteDriver` (both exact-path and refine-path queries) produce identical rows/counts/aggregates.
- [`tests/src/browser/drivers/IndexedDBDriver.test.ts`](../tests/src/browser/drivers/IndexedDBDriver.test.ts) — `IndexedDBDriver` against real IndexedDB: metadata-only bootstrap and deployed-schema-first reopen, one-transaction `has`/`get` absence discrimination, fail-closed malformed-metadata preservation (including stored `undefined`) and persisted-store loss with deterministic first-loss evidence, physical non-recreation, extra-store retention, external repair, and same-driver retry; bootstrap-lifetime store/version capture and a competing versionchange proving the persisted final open is pinned and retryable; payload-safe errors and table rejection, closed failed state, reserved-store validation, atomic `add` insertion and duplicate `CONFLICT`, active/pre-dispatch/late abort boundaries, strict direct records/stream paging, native narrow-then-refine queries, snapshot capture-replay, schema/rows/metadata in one versionchange migration, metadata-only migration input, failed-upgrade reconnection to the old schema, metadata persistence, backend-fault mapping, and confirmation that callback `transaction` / native `aggregate` are absent.
- [`tests/src/browser/helpers.test.ts`](../tests/src/browser/helpers.test.ts) — the pushdown planner: `conditionToRange` over every comparison operator, `selectPlan` index/primary selection and lossless fallbacks, backend-error mapping, and exact `deriveIndexedDBIndexName` bytes.
- [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts) — `createIndexedDBDriver` returns a working `DriverInterface` instance (a round-trip end to end).
- [`tests/src/browser/integration.test.ts`](../tests/src/browser/integration.test.ts) — cross-backend behavioral parity: the same `QueryInput` set run against `MemoryDriver` and `IndexedDBDriver` produce identical rows/counts, including pushdown edge cases (`below`/`to` on a secondary-indexed column, a reversed `between`).

## See also

- [`contract.md`](contract.md) — the shape DSL and `createContract` a table is built on.
- [`AGENTS.md`](../AGENTS.md) — the rules; see § Documentation contract.
- [`README.md`](README.md) — the guides index.
