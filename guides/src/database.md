# Databases

> One typed database API that runs unchanged on top of an in-memory map or IndexedDB — keyed rows, a fluent query builder, cursors, and whole-store transactions. The unifying idea is that **a table is a contract**: you declare a `tables` map of [`ContractShape`](contracts.md)s, and the row type, write-time coercion + validation, JSON-Schema introspection, and seed data all flow from that one declaration — no separate schema, no annotations, no `as`.
>
> The design stance is **one engine, thin drivers**. A backend implements only an irreducible storage primitive — keyed read/write/delete, an ordered `scan`, key listing, and a `snapshot` — and inherits the entire WHERE / order / page / aggregate surface from a single pure query engine in the core. A backend that _can_ go faster (SQL `WHERE`, an index range) implements optional native hooks the engine falls back from; it never re-derives query semantics. So this is deliberately **not** an ORM and not a query abstraction layer: there is no entity graph here (that is [relations](relations.md)), no migration runner, and no raw-SQL escape hatch — just the smallest cross-environment core that earns its keep, with a parity test asserting every native path returns exactly what the engine would. Source: [`src/core/databases`](../../src/core/databases). Surfaced through the `@src/core` barrel.

## Surface

Declare a `tables` shape map (keys are table names) once, and reach each table — fully typed, no annotations — with `table(name)`:

```ts
import { createDatabase, createMemoryDriver, integerShape, stringShape } from '@src/core'

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

Each `tables` value is a column map (a `column → shape` map) — a table row is always an object, so the database wraps it in an `objectShape` for you; you never write `objectShape` at the table level. The row type is `Infer` of those columns, so `db.table('users')` is checked against the schema (a typo'd column name or a wrong-typed write fails at compile time) and returns a `TableInterface` typed by that row. That one declaration is the single source of truth: it types the table, drives write coercion + validation, produces the JSON Schema, and seeds fixtures.

### Factories

| API                  | Kind     | Summary                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `createDatabase`     | function | Create a `DatabaseInterface` over a driver and a `tables` shape map.    |
| `createMemoryDriver` | function | Create the in-memory reference `DriverInterface` (nested maps, no I/O). |

### Entities

| Class          | Kind  | Role                                                                                             |
| -------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `Database`     | class | Owns the driver and a `tables` map, lazily connects, `import`s / `export`s, runs `transaction`s. |
| `MemoryDriver` | class | The reference driver — nested maps; the "in-between" that runs in a browser or on a server.      |
| `Table`        | class | Typed keyed CRUD plus `query` / `cursor`; validates writes and narrows reads via its contract.   |
| `Query`        | class | The fluent query builder bound to one table.                                                     |
| `Clause`       | class | A pending condition opened by `where` / `and` / `or`; its operator closes it back to the query.  |
| `Cursor`       | class | A forward row cursor over a key snapshot for bulk in-place mutation.                             |

### Persistent drivers

Beyond the in-memory reference, a persistent backend implements the same `DriverInterface`. The IndexedDB driver ships in [`src/browser/databases`](../../src/browser/databases), surfaced through `@src/browser`; it is built on the browser [IndexedDB wrapper](indexeddb.md) (never raw IndexedDB), so the whole database + [relations](relations.md) stack runs unchanged against IndexedDB — swap `createMemoryDriver` for `createIndexedDBDriver`. It implements the native `records` / `count` hooks: `selectPlan` (the [internals](#indexeddb-driver-internals) below) turns a `Criteria` into an `IDBKeyRange` over the primary key or a single-column secondary index, fetching a candidate **superset** that the core engine then refines — so a native read is byte-identical to a full scan, just over fewer rows (a parity test asserts pushdown == scan across every operator, and/or mix, ordering, paging, and a zero-match). Only the exact-comparison operators over orderable columns narrow to a range; everything else falls back to a full scan + the engine. There is **no** native `aggregate` (IndexedDB has no native `SUM`/`AVG`); the engine over the narrowed `records` covers aggregates.

| API                     | Kind     | Summary                                                                                                                                                                                                                                                                                                        |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createIndexedDBDriver` | function | Create a persistent IndexedDB `DriverInterface` for a named database.                                                                                                                                                                                                                                          |
| `IndexedDBDriver`       | class    | The IndexedDB driver — the `DriverInterface` primitives over the wrapper (out-of-line keys, auto-managed schema, atomic snapshot), with native `records` / `count` that push exact-comparison reads to an `IDBKeyRange` (primary key + secondary indexes) and refine through the engine, falling back to scan. |

#### IndexedDB driver internals

The IndexedDB driver's own surface — the pure pushdown planner in [`src/browser/databases`](../../src/browser/databases). `selectPlan` scans a `Criteria`'s conditions and picks the **first** one that is provably range-exact (a comparison operator — `equals`/`above`/`below`/`from`/`to`/`between` — over a single, orderable `text`/`integer`/`real` column with a scalar operand) and backed by a key: the table's primary key (the store itself) or a single-column secondary index (named exactly the column). It returns a `QueryPlan` — the index (or `null` for the primary store) and the `IDBKeyRange` to narrow by (`null` = full scan) — that is always a **superset** of the matching rows, so the driver's `records` / `count` run the core engine over it to get the exact result. A nested-path `FieldPath`, a non-orderable type (`boolean`/`json`/`blob`), a non-comparison operator, or a non-indexed column simply yields a full-scan plan.

| API          | Kind      | Summary                                                                                                                      |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `selectPlan` | function  | Plan an IndexedDB read for a `Criteria` — the index (or primary store) + `IDBKeyRange` to narrow by, falling back to a scan. |
| `QueryPlan`  | interface | The planner's output — `{ index, range }`, always a superset of the matching rows (the engine refines it).                   |

### Errors

| API               | Kind     | Summary                                                                             |
| ----------------- | -------- | ----------------------------------------------------------------------------------- |
| `DatabaseError`   | class    | Carries a `DatabaseErrorCode` (`CLOSED` / `NOT_FOUND` / `CONFLICT` / `VALIDATION`). |
| `isDatabaseError` | function | Narrow an unknown caught value to a `DatabaseError`.                                |

### Query engine

The portable semantics every backend shares — pure, total functions the driver never re-implements.

| Helper             | Kind     | Behavior                                                                                               |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `compareValues`    | function | Total ordering over arbitrary values (`undefined` < `null` < boolean < number < string) — never `NaN`. |
| `matchesCondition` | function | Evaluate one `Condition` against a row (the per-operator predicate); a type mismatch is a non-match.   |
| `matchesCriteria`  | function | Fold a row through conditions, joining each by its `Connector` left-to-right.                          |
| `sortRows`         | function | Sort rows by an `Order` list, leaving the input untouched.                                             |
| `applyCriteria`    | function | The portable read pipeline — filter, then sort, then page.                                             |
| `computeAggregate` | function | `count` / `sum` / `average` / `minimum` / `maximum` over a column (coerces via `parseNumber`).         |
| `extractKey`       | function | Read a row's primary key from a column when it is a usable `Key`.                                      |
| `generateKey`      | function | Generate a fresh UUID string — used when a row is written without a key.                               |
| `columnType`       | function | Map a column's `ContractShape` to its portable `ColumnType` — the schema `open` hands a driver.        |

### Helpers & guards

Pure helpers behind the query engine and the IndexedDB pushdown planner.

| API              | Kind     | Behavior                                                                                                                                                                                                                   |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wildcardMatch`  | function | Match a value against a wildcard pattern in LINEAR time (greedy two-pointer, no backtracking) — the ReDoS-safe engine; injected `any` run + `single` char + case-fold flag; throws `VALIDATION` over `MAX_PATTERN_LENGTH`. |
| `likeMatch`      | function | Match a value against a SQL `LIKE` pattern via `wildcardMatch` (case-INSENSITIVE; `%` → any run, `_` → any char).                                                                                                          |
| `globMatch`      | function | Match a value against a `GLOB` pattern via `wildcardMatch` (case-SENSITIVE; `*` → any run, `?` → any char).                                                                                                                |
| `conditionRange` | function | The `IDBKeyRange` a `Condition` maps to when its operator is an exact key comparison over a scalar operand, else `null`.                                                                                                   |
| `isKey`          | function | Whether a value is a scalar IndexedDB key operand — a `string` or `number` (the core `Key` space).                                                                                                                         |

### Constants

| Constant             | Kind  | Value                                                                                                                                               |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_PRIMARY`    | const | The primary-key column assumed when a table has no `keys` override (`id`).                                                                          |
| `INDEXABLE_TYPES`    | const | The `ColumnType`s that are valid, orderable IndexedDB keys (`text` / `integer` / `real`) — the pushdown set.                                        |
| `MAX_PATTERN_LENGTH` | const | The longest `LIKE` / `GLOB` pattern `wildcardMatch` accepts before a `VALIDATION` throw — the ReDoS length bound (§6.5) on model-supplied criteria. |

### Types

| Type                | Kind      | Shape                                                                                                                                                                                                    |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Key`               | type      | `string \| number` — a primary key.                                                                                                                                                                      |
| `Row`               | type      | `Record<string, unknown>` — a table row.                                                                                                                                                                 |
| `ConditionOperator` | type      | The 15 WHERE operators (`equals`, `above`, `between`, `like`, `any`, `absent`, …).                                                                                                                       |
| `Connector`         | type      | `'and' \| 'or'` — how a condition joins the running result.                                                                                                                                              |
| `Condition`         | interface | `{ column, operator, values, connector }` — one compiled WHERE condition.                                                                                                                                |
| `Direction`         | type      | `'ascending' \| 'descending'`.                                                                                                                                                                           |
| `Order`             | interface | `{ column, direction }` — one ordering term.                                                                                                                                                             |
| `Criteria`          | interface | `{ conditions?, order?, limit?, offset? }` — a serializable read spec for a driver.                                                                                                                      |
| `AggregateFunction` | type      | `'count' \| 'sum' \| 'average' \| 'minimum' \| 'maximum'`.                                                                                                                                               |
| `DatabaseStatus`    | type      | `'idle' \| 'open' \| 'closed'`.                                                                                                                                                                          |
| `DatabaseErrorCode` | type      | `'CLOSED' \| 'NOT_FOUND' \| 'CONFLICT' \| 'VALIDATION'`.                                                                                                                                                 |
| `DatabaseEventMap`  | type      | The database's push observation surface (§13) — `open` · `close` · `transaction` · `commit` · `rollback(error)`.                                                                                         |
| `TableEventMap`     | type      | A table's push observation surface (§13) — `write(key)` · `remove(key)` · `clear` (key only, no value).                                                                                                  |
| `Columns`           | type      | `Readonly<Record<string, ContractShape>>` — one table's `column → shape` map (an `objectShape`'s properties).                                                                                            |
| `TablesShape`       | type      | `Readonly<Record<string, Columns>>` — a database's table → columns map.                                                                                                                                  |
| `RowOf`             | type      | `RowOf<C>` — the row type a `Columns` map describes (`Infer` of its `objectShape`).                                                                                                                      |
| `TableKeys`         | type      | `Readonly<Record<string, string>>` — per-table primary-key column overrides.                                                                                                                             |
| `TableIndexes`      | type      | `Readonly<Record<string, readonly (readonly string[])[]>>` — per-table secondary indexes (column-name groups).                                                                                           |
| `ColumnType`        | type      | `'text' \| 'integer' \| 'real' \| 'boolean' \| 'json' \| 'blob'` — a column's portable storage type.                                                                                                     |
| `ColumnSchema`      | interface | `{ name, type, nullable }` — one column of a `TableSchema`.                                                                                                                                              |
| `TableSchema`       | interface | `{ name, primary, columns, indexes }` — a backend-agnostic table description `open` hands a driver.                                                                                                      |
| `DriverInterface`   | interface | The minimal storage contract: `open` (takes a `TableSchema[]`) / `close` / `read` / `write` / `delete` / `keys` / `scan` / `clear` / `snapshot`, plus optional native `records` / `count` / `aggregate`. |
| `DatabaseOptions`   | interface | `{ on?, driver, tables, keys?, indexes?, name? }` — input to `createDatabase` (`on?` wires initial `DatabaseEventMap` listeners, §8).                                                                    |
| `TableExport`       | interface | `{ key, columns, schema }` — one table's portable definition, produced by `export`.                                                                                                                      |
| `DatabaseInterface` | interface | `emitter` / `name` / `status` / `table` / `import` / `export` / `open` / `close` / `transaction`.                                                                                                        |
| `TableInterface`    | interface | `emitter` / `name` / `primary` / `contract` + keyed CRUD + `records` / `count` / `aggregate` + `query` / `cursor`.                                                                                       |
| `QueryInterface`    | interface | The fluent builder — `where` / `filter` / `ascending` / `limit` + terminals.                                                                                                                             |
| `ClauseInterface`   | interface | The 15 operator methods, each returning the query.                                                                                                                                                       |
| `CursorInterface`   | interface | `value` / `index` / `done` + `next` / `update` / `remove` / `close`.                                                                                                                                     |

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed (its `readonly` data members, e.g. `emitter` / `name` / `status` / `primary` / `contract` / `value` / `index` / `done`, stay in the Surface rows above — `emitter` is the typed push observation surface, see [Observing](#observing)). Each `## Entities` class implements its interface exactly, so this doubles as the per-instance method surface (AGENTS §22).

#### `DriverInterface`

The irreducible storage primitive; a backend implements exactly the REQUIRED methods and inherits the entire query surface unchanged. `records` / `count` / `aggregate` are **optional native overrides** (AGENTS §21) — a backend that can push a query down implements them and `Table` prefers them, falling back to the engine over `scan` otherwise; a backend may omit them.

| Method      | Returns                        | Behavior                                                                                                                     |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `open`      | `Promise<void>`                | Ready the tables from a derived `TableSchema[]` (a native backend builds tables/indexes; a scan-only one reads only `name`). |
| `close`     | `Promise<void>`                | Release the backend.                                                                                                         |
| `read`      | `Promise<Row \| undefined>`    | Read one row by key, or `undefined`.                                                                                         |
| `write`     | `Promise<void>`                | Write one row at a key (upsert).                                                                                             |
| `delete`    | `Promise<boolean>`             | Delete one row by key; `false` when absent.                                                                                  |
| `keys`      | `Promise<readonly Key[]>`      | List a table's keys in order.                                                                                                |
| `scan`      | `AsyncIterable<Row>`           | Iterate a table's rows in key order.                                                                                         |
| `clear`     | `Promise<void>`                | Empty a table.                                                                                                               |
| `snapshot`  | `Promise<() => Promise<void>>` | Capture state; the returned thunk rolls every table back to it.                                                              |
| `records`   | `Promise<readonly Row[]>`      | Optional native filtered read honoring the full `Criteria` (filter, order, page).                                            |
| `count`     | `Promise<number>`              | Optional native count over the criteria's conditions (paging is irrelevant).                                                 |
| `aggregate` | `Promise<number \| undefined>` | Optional native aggregate (`COUNT`/`SUM`/`AVG`/`MIN`/`MAX`) over the criteria's conditions (paging is irrelevant).           |

#### `DatabaseInterface`

| Method        | Returns                                 | Behavior                                                         |
| ------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `table`       | `TableInterface<RowOf<T[K]>>`           | The typed handle for a declared table.                           |
| `import`      | `DatabaseInterface<U>`                  | Define a shape map of tables; a typed view over the same driver. |
| `export`      | `Readonly<Record<string, TableExport>>` | A portable `TableExport` per table.                              |
| `open`        | `Promise<void>`                         | Connect the driver eagerly (otherwise lazy on first use).        |
| `close`       | `Promise<void>`                         | Close the database and its driver.                               |
| `transaction` | `Promise<R>`                            | Run a scope; roll every table back if it throws.                 |

#### `TableInterface`

The keyed methods batch by overload (one in → one out; array in → array out) — a single verb, never `getMany` / `setAll`.

| Method      | Returns                              | Behavior                                                           |
| ----------- | ------------------------------------ | ------------------------------------------------------------------ |
| `get`       | `Promise<T \| undefined>` (or array) | Read by key(s); `undefined` per miss.                              |
| `resolve`   | `Promise<T>` (or array)              | Read by key(s); throws `NOT_FOUND` on a miss.                      |
| `has`       | `Promise<boolean>` (or array)        | Whether key(s) exist.                                              |
| `keys`      | `Promise<readonly Key[]>`            | All primary keys in order.                                         |
| `records`   | `Promise<readonly T[]>`              | Rows matching an optional `Criteria`.                              |
| `count`     | `Promise<number>`                    | Count matching an optional `Criteria`.                             |
| `aggregate` | `Promise<number \| undefined>`       | `count` / `sum` / `average` / `minimum` / `maximum` over a column. |
| `set`       | `Promise<Key>` (or array)            | Upsert row(s) → key(s).                                            |
| `add`       | `Promise<Key>` (or array)            | Insert row(s); `CONFLICT` on a duplicate key.                      |
| `update`    | `Promise<boolean>` (or array)        | Merge changes into existing row(s) and re-validate.                |
| `remove`    | `Promise<boolean>` (or array)        | Delete row(s) by key.                                              |
| `clear`     | `Promise<void>`                      | Empty the table.                                                   |
| `query`     | `QueryInterface<T>`                  | Open a fluent query builder.                                       |
| `cursor`    | `Promise<CursorInterface<T>>`        | Open a forward row cursor for bulk mutation.                       |

#### `QueryInterface`

`where` / `and` / `or` open a `ClauseInterface`; the rest mutate and return the same builder; `all` / `first` / `count` / the aggregates are the terminals.

| Method       | Returns                        | Behavior                                   |
| ------------ | ------------------------------ | ------------------------------------------ |
| `where`      | `ClauseInterface<T>`           | Open the first condition on a column.      |
| `and`        | `ClauseInterface<T>`           | Open a condition joined with `and`.        |
| `or`         | `ClauseInterface<T>`           | Open a condition joined with `or`.         |
| `filter`     | `QueryInterface<T>`            | Add a post-fetch JS predicate.             |
| `ascending`  | `QueryInterface<T>`            | Order ascending by a column.               |
| `descending` | `QueryInterface<T>`            | Order descending by a column.              |
| `limit`      | `QueryInterface<T>`            | Cap the result count.                      |
| `offset`     | `QueryInterface<T>`            | Skip leading rows.                         |
| `all`        | `Promise<readonly T[]>`        | Execute → every matching row.              |
| `first`      | `Promise<T \| undefined>`      | Execute → the first match or `undefined`.  |
| `count`      | `Promise<number>`              | Execute → the match count.                 |
| `sum`        | `Promise<number \| undefined>` | Execute → sum of a column.                 |
| `average`    | `Promise<number \| undefined>` | Execute → average of a column.             |
| `minimum`    | `Promise<number \| undefined>` | Execute → minimum of a column.             |
| `maximum`    | `Promise<number \| undefined>` | Execute → maximum of a column.             |
| `aggregate`  | `Promise<number \| undefined>` | Execute → a named aggregate over a column. |

#### `ClauseInterface`

The 15 WHERE operators; each records its condition and returns the query (see the operator table under [Fluent queries](#fluent-queries) for the SQL mapping).

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

These invariants hold across the databases source tree ↔ `databases.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `const` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the databases source tree (`src/core/databases` plus the `src/browser/databases` driver), and every export appears as a Surface row — exhaustive, both directions (AGENTS §22).
2. **A table is a contract.** Every write is coerced **and** validated through the table's compiled contract — `set` / `add` / `update` run the row through `contract.parse` (coercion) and then the guard `contract.is` (constraints like `min` / `pattern`, which `parse` alone does not enforce); a row that fails throws `VALIDATION`. Reads are narrowed back to the table's row type through the guard — never an `as` (AGENTS §1). The row type is the shape's `Infer`, so a `tables` map types every table from one declaration.
3. **Thin driver, one engine, native overrides.** The REQUIRED `DriverInterface` surface is the irreducible storage primitive — keyed read/write/delete, an ordered `scan`, key listing, and `snapshot`. `open` hands the driver a derived `TableSchema[]` (each table's `columns`, their portable `ColumnType` via `columnType`, the `primary` key, and declared `indexes`) so a native backend can build real tables and indexes; a scan-only backend reads only `name`. The pure, total query engine (`applyCriteria` / `matchesCriteria` / `computeAggregate` / …) over `scan` is the default and the only REQUIRED path. A backend MAY implement the optional native `records?` / `count?` / `aggregate?` where it has a faster path (SQL `WHERE`, a SQL `COUNT`/`SUM`/`AVG`/`MIN`/`MAX`, an index range), and `Table` prefers them — falling back to the engine otherwise (AGENTS §21). Because `aggregate?` legitimately resolves to `undefined` (a sum over zero rows), `Table.aggregate` decides the hook ran by its **presence** (a present method returns a Promise; `?.()` is `undefined` only when the method is absent), never by the resolved value. The reference `MemoryDriver` implements none of the three, so every query runs the engine over its key-ordered `scan`. The **IndexedDB** driver implements native `records` / `count`, pushing exact-comparison reads to an `IDBKeyRange` via `selectPlan` (the [internals](#indexeddb-driver-internals)) and refining the candidate superset through the engine — so a native read returns rows identical to the engine path over the same data (a parity test asserts both across every operator, and/or mix, ordering, paging, and a zero-match). A new backend implements a handful of small methods and inherits the entire query surface unchanged.
4. **Total query helpers.** `compareValues`, `matchesCondition`, and `matchesCriteria` never throw — a type mismatch is a non-match and the comparator is a total order (it never returns `NaN`), mirroring the contracts guards' totality (AGENTS §14).
5. **Optimistic transactions.** `transaction(scope)` takes a `snapshot` of the store, runs the scope, and on a throw calls the rollback thunk to restore every table — then rethrows. It is whole-store and optimistic, one uniform model rather than reconciling SQL's `BEGIN/COMMIT/ROLLBACK` with IndexedDB's microtask-bound transactions.
6. **Observation is a pure side-channel (§13).** The core `Database` owns a typed `emitter` (`DatabaseEventMap` — `open` / `close` / `transaction` / `commit` / `rollback`) and each `Table` owns one (`TableEventMap` — `write` / `remove` / `clear`, KEY only, no value payload to avoid heavy fan-out / leaking row data). Every event is emitted directly (the AGENTS §13 convention: the emitter isolates a listener throw, routing it to its OWN `error` handler — the `error` option, surfaced as `(error, event)`, NOT a domain event — itself re-entrancy-guarded) strictly AFTER the relevant transition — `commit` only after a scope succeeds, `rollback` only after every table is restored (and the `rollback` emit OBSERVES the propagated error; it never suppresses or reorders it — the original throw still propagates), a `write` / `remove` / `clear` only after the driver op completes. So a buggy observer can never corrupt a write or a transaction: the committed state stays intact, the rollback still restores, and the original transaction error still propagates (proven by the emit-safety tests). Reads / queries / counts are not emitted (a reader does not mutate, and those paths are too hot). The observation lives in the core layer; the drivers stay storage primitives.
7. **Views share a driver.** A database is a typed view over a set of tables on one driver. `import(tables)` returns a new view of just those tables over the **same** driver (sharing storage and transactions); `export()` emits a portable `TableExport` per table — `schema` is the universally portable JSON Schema, `columns` re-imports losslessly via `import` within a TypeScript environment.
8. **DOC ↔ SOURCE method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class (`Database` / `MemoryDriver` / `IndexedDBDriver` / `Table` / `Query` / `Clause` / `Cursor`) implements every REQUIRED method and adds none beyond the interface (optional members like `records?` / `count?` / `aggregate?` may be omitted, as the scan-only `MemoryDriver` does, or implemented as the `IndexedDBDriver`'s native `records` / `count` are) (AGENTS §22). A renamed / added / removed method breaks the gate until the table is reconciled.

What ships is the **core in-between** (schema-aware: `open` receives a derived `TableSchema[]`, with `columnType` mapping each column's shape), its reference `MemoryDriver`, and the persistent **IndexedDB** driver (which creates the declared secondary indexes and pushes exact-comparison `records` / `count` reads down to an `IDBKeyRange` over the primary key + secondary indexes via `selectPlan`, refining the candidate superset through the engine). The core `Database` / `Table` are also **observable** — each owns a typed `emitter` (`DatabaseEventMap` / `TableEventMap`, §13) carrying the transaction + per-row lifecycle (see [Observing](#observing)); a driver stays a storage primitive (the observation lives in the core layer above it). Deliberately **not** part of this surface yet, by the same "build only what earns its keep" discipline the contracts guide follows: a persistent server backend (a SQLite driver implementing the same nine primitives plus all three native hooks), a raw-SQL escape hatch, and a native IndexedDB `aggregate` (IndexedDB has no native `SUM`/`AVG`, so the engine over the narrowed `records` covers it — only the pushable exact comparisons accelerate; membership / negation / pattern operators still scan). Those are additive — everything above is unchanged.

## Patterns

### Declaring tables in options

```ts
import { createDatabase, createMemoryDriver } from '@src/core'
import { integerShape, literalShape, optionalShape, stringShape } from '@src/core'

const db = createDatabase({
	driver: createMemoryDriver(),
	name: 'app',
	tables: {
		// Each table's value is its columns — wrapped in an `objectShape` for you.
		users: {
			id: stringShape(),
			name: stringShape({ min: 1 }),
			age: integerShape({ min: 0 }),
			role: literalShape('admin', 'member', 'guest'),
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

Each `indexes` entry is one (possibly compound) index of column names; they flow into each table's derived `TableSchema` (a SQLite `CREATE INDEX`, an IndexedDB `createIndex`). A scan-only driver (`MemoryDriver`) ignores them.

### Swapping the driver

The `tables` declaration and every call against the database are identical across backends — only the `driver` changes, so the same code runs in a test and in a browser. Pick the driver per environment and pass it to `createDatabase`:

```ts
import { createDatabase, createMemoryDriver } from '@src/core' // tests / ephemeral — no I/O
import { createIndexedDBDriver, isIndexedDBSupported } from '@src/browser' // browser — persistent

const driver = isIndexedDBSupported() ? createIndexedDBDriver('app') : createMemoryDriver()
const db = createDatabase({ driver, tables, keys, indexes })
```

`MemoryDriver` is scan-only (the core engine answers every query) and I/O-free, making it the storage behind tests, ephemeral caches, and any code that wants the database API without a persistent backend; `IndexedDBDriver` pushes exact-comparison reads to an `IDBKeyRange` — yet both return identical results (a parity test proves it), so the choice is purely about where the bytes live and how fast they read, never about behavior.

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

// A row written without its key gets a generated UUID (when the key is optional):
const key = await posts.set({ title: 'Hello' } as never)
```

### Batch operations

The keyed methods batch by overload (AGENTS §9.2) — one key/row in, one result; an array in, an array of results in the same order. The verb never changes (no `getMany` / `setAll`):

```ts
await users.set([row1, row2, row3]) // → readonly Key[]
await users.add([row1, row2]) // → readonly Key[] (CONFLICT rejects the batch)
await users.get(['u1', 'u2']) // → readonly (Row | undefined)[]
await users.resolve(['u1', 'u2']) // → readonly Row[] (NOT_FOUND on any miss)
await users.has(['u1', 'u2']) // → readonly boolean[]
await users.update(['u1', 'u2'], { role: 'member' }) // same changes to each → readonly boolean[]
await users.remove(['u1', 'u2']) // → readonly boolean[]
```

A batch runs as independent sequential operations; wrap it in `transaction` when it must be atomic.

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
```

The WHERE operators (each maps to a familiar SQL operator and an IndexedDB read strategy). On a scan-only driver the engine evaluates them all in JS. On IndexedDB, only the six **exact-comparison** operators push to an `IDBKeyRange`, and only when the column is the primary key or a single-column secondary index **and** an orderable (`text`/`integer`/`real`) type with a scalar operand; the range narrows to a candidate superset that the engine then refines exactly (so the result equals a scan — see [`selectPlan`](#indexeddb-driver-internals)). Everything else — pattern, membership, negation, existence operators, a nested-path column, a non-orderable column, or an unindexed column — falls back to a full scan that the engine filters:

| Method          | SQL           | IndexedDB strategy                        |
| --------------- | ------------- | ----------------------------------------- |
| `equals(v)`     | `=`           | `IDBKeyRange.only` (indexed) / scan       |
| `not(v)`        | `!=`          | scanned predicate                         |
| `above(v)`      | `>`           | `IDBKeyRange.lowerBound` (indexed) / scan |
| `below(v)`      | `<`           | `IDBKeyRange.upperBound` (indexed) / scan |
| `from(v)`       | `>=`          | `IDBKeyRange.lowerBound` (indexed) / scan |
| `to(v)`         | `<=`          | `IDBKeyRange.upperBound` (indexed) / scan |
| `between(a, b)` | `BETWEEN`     | `IDBKeyRange.bound` (indexed) / scan      |
| `like(p)`       | `LIKE`        | scanned predicate                         |
| `glob(p)`       | `GLOB`        | scanned predicate                         |
| `starts(p)`     | `LIKE 'p%'`   | scanned predicate                         |
| `ends(s)`       | `LIKE '%s'`   | scanned predicate                         |
| `any(vs)`       | `IN`          | scanned predicate                         |
| `none(vs)`      | `NOT IN`      | scanned predicate                         |
| `absent()`      | `IS NULL`     | scanned predicate                         |
| `present()`     | `IS NOT NULL` | scanned predicate                         |

### Nested fields

Every column — in `where` / `and` / `or`, `ascending` / `descending`, and the aggregates — is a [`FieldPath`](contracts.md): a **single string is one column** (never split on `.`), while an **array descends** into a nested (object / `json`) value. The _shape_ of the argument says how to read it; the string's _value_ is never parsed — there are no magic strings here.

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
```

### Observing

Both the `Database` and each `Table` expose a typed `emitter` (AGENTS §13) carrying its lifecycle for fire-and-forget observers — logging, metrics, **cache invalidation, a sync layer**. The vocabulary is split by audience: the **database** carries the connection + transaction moments, each **table** the per-row mutations (KEY only — no value payload, to keep fan-out lean; a consumer that needs the value re-reads it). Subscribe via `entity.emitter.on(...)`, or wire initial listeners through the reserved `on?` option. **Emitting is observation-only**: every event fires strictly AFTER the relevant transition, so a listener can never change what a write or a transaction does.

```ts
import { createDatabase, createMemoryDriver } from '@src/core'

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

`open` fires when the driver connects (an explicit `open()`, or the lazy first-use connect — a reconnect after `close()` fires it again); `close` when the driver is released; `transaction` when a scope begins (after the snapshot); `commit` only after a scope SUCCEEDS; `rollback` only after a throwing scope's tables are all restored. A `Table` fires `write` after any row put (set / add / update — re-read by key if you need the new value), `remove` after a row is deleted (a delete of an absent key emits nothing), and `clear` after the table is emptied. Reads / queries / counts are **not** emitted — a reader does not mutate, and those paths are too hot. Each `db.table(name)` returns a fresh handle with its own emitter, so subscribe on the handle you hold and operate on that same handle.

**The listener-isolation safety guarantee.** A listener throw is NEVER allowed to escape into the engine: the emitter isolates it and routes it to its OWN `error` handler (the `error` option, surfaced as `(error, event)`), NOT to a domain event — so a buggy observer is isolated yet not silently lost. The `error` handler runs in its own try/catch, so even a throwing handler can't recurse or escape; with no handler, the throw is swallowed silently. Every throwing listener surfaces (not just the first). Because every emit sits after its transition AND is isolated, a buggy observer **cannot corrupt a write or a transaction**: a throwing `commit` observer leaves the committed state intact, a throwing `rollback` observer cannot suppress the propagated transaction error (the original throw still propagates, the tables still roll back), and a throwing `write` observer leaves the written row intact — proven by the per-entity emit-safety tests. (A `Table` is reached via the `Database`, which does not thread an `error` handler to it, so a `Table` listener throw is swallowed silently.)

### Importing and exporting schemas

`import` defines more than one table at once from a shape map (keys are names) and returns a typed view of those tables over the **same** driver. `export` emits a portable definition per table — useful for moving a schema between databases or environments and for diffing migrations.

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

### Practices

- **Declare tables in `createDatabase({ tables })` and hold the handles** — `const users = db.table('users')`; reuse them rather than re-resolving.
- **Writes coerce, reads narrow.** Lean on the contract: pass loose input (`'41'`) and store clean typed data; trust `get` / `records` to return the row type.
- **Use `resolve` when absence is an error**, `get` when it is expected — `resolve` throws `NOT_FOUND`, `get` returns `undefined`.
- **Reach for `query()` over `records()`** — the builder compiles a portable `Criteria`; `filter` is the JS escape hatch when an operator won't express it.
- **Use `import` to add tables to a live store** and `export` to move a schema across environments; both share the underlying driver.
- **Wrap multi-write invariants in `transaction`** — a throw rolls every table back.
- **Observe, don't drive** — subscribe to `db.emitter` (transaction lifecycle) / `table.emitter` (per-row `write` / `remove` / `clear`, key only) for cache invalidation, sync, or metrics (see [Observing](#observing)); emitting is a pure side-channel, so a listener never changes what a write or transaction does (and a throwing one can't corrupt it).
- **Use `MemoryDriver` for tests and ephemeral data** — no I/O, identical behavior in browser and server.

## Tests

- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ source bijection across `src/core/databases` and the `src/browser/databases` driver (value + type exports), plus each interface ↔ implementing-class method bijection.
- [`tests/src/core/databases/helpers.test.ts`](../../tests/src/core/databases/helpers.test.ts) — the query engine: `compareValues` total order, every `matchesCondition` operator, `matchesCriteria` folding, `sortRows`, `applyCriteria`, `computeAggregate`, `extractKey`, and `columnType`'s shape → portable-type mapping (scalars, `json` for object/array/union/raw, optional/nullable unwrap, literal-by-values).
- [`tests/src/core/databases/drivers/MemoryDriver.test.ts`](../../tests/src/core/databases/drivers/MemoryDriver.test.ts) — the driver primitive: `open(schema)` readies tables, read/write/delete/keys/scan/clear + `snapshot` rollback.
- [`tests/src/core/databases/Database.test.ts`](../../tests/src/core/databases/Database.test.ts) — declared tables, lazy connect, typed CRUD, coercion + `VALIDATION` / `CONFLICT` / `NOT_FOUND`, custom keys, the `indexes` option, `import` / `export`, `transaction` commit/rollback, and the `emitter` (`DatabaseEventMap`): `open` on connect / reconnect, `transaction` → `commit` on success and → `rollback(error)` on a throw (never both), `on?` wiring, and the emit-safety guarantee (a throwing `commit` observer can't corrupt the committed state, a throwing `rollback` observer can't suppress the propagated error, the throw routes to the emitter's `error` handler, no recursion).
- [`tests/src/core/databases/Table.test.ts`](../../tests/src/core/databases/Table.test.ts) — `Table`'s keyed CRUD + batch overloads, coercion + the `VALIDATION` / `CONFLICT` / `NOT_FOUND` paths, the records / count / aggregate engine path, the query / cursor accessors, the native ↔ engine dispatch (folded in from the former `nativeHooks.test.ts`): a real recording driver with `records` / `count` / `aggregate` hooks proves `Table` prefers them (including a present `aggregate` that resolves to `undefined`), a plain `MemoryDriver` the engine fallback — and the `emitter` (`TableEventMap`): `set` / `add` / `update` each fire one `write(key)`, `remove(key)` only on a real delete (a miss / no-op emits nothing), `clear`, a `VALIDATION` failure emits no `write`, and the emit-safety guarantee (a throwing `write` observer can't corrupt the row — the emitter isolates it; a `Table` reached via the `Database` has no `error` handler, so the throw is swallowed silently).
- [`tests/src/core/databases/Query.test.ts`](../../tests/src/core/databases/Query.test.ts) — `Query`'s where / and / or dispatch, ordering, paging, `filter`, and aggregates.
- [`tests/src/core/databases/Clause.test.ts`](../../tests/src/core/databases/Clause.test.ts) — `Clause`'s operator methods, each closing the pending condition with the right operator + operands and returning the owning query, asserted through real execution.
- [`tests/src/core/databases/Cursor.test.ts`](../../tests/src/core/databases/Cursor.test.ts) — `Cursor`'s forward walk over a key snapshot: `value` / `index` / `done`, `next`, in-place `update` / `remove`, and `close`.
- [`tests/src/core/databases/factories.test.ts`](../../tests/src/core/databases/factories.test.ts) — `createDatabase` / `createMemoryDriver` each return a working instance of their interface (a round-trip end to end).
- [`tests/src/browser/databases/drivers/IndexedDBDriver.test.ts`](../../tests/src/browser/databases/drivers/IndexedDBDriver.test.ts) — the IndexedDB driver's storage primitives in real Chromium, on-demand store creation, schema-driven secondary-index creation (verified against the live `IDBObjectStore.indexNames` + an indexed read), atomic `snapshot` rollback, and the native `records` / `count` pushdown (indexed range query filtered/ordered/paged, native count for a single indexed equality, a non-indexed scan, and a multi-condition indexed-plus-extra-predicate read).
- [`tests/src/browser/databases/helpers.test.ts`](../../tests/src/browser/databases/helpers.test.ts) — `selectPlan` in real Chromium (for `IDBKeyRange`): each pushable operator on the primary key and a single-column secondary index resolves to the right index + range bounds, and every non-pushable case (a non-orderable / non-indexed / nested-path column, `starts` / `not` / `any` / `absent`, a non-scalar operand, no conditions) falls back to a full scan — plus first-qualifying-condition selection.
- [`tests/src/browser/databases/parity.test.ts`](../../tests/src/browser/databases/parity.test.ts) — the safety net: the IndexedDB driver's native `records` / `count` (key-range pushdown + engine refinement) deep-equal the core engine over `MemoryDriver` for every WHERE operator on BOTH an indexed (`age`) and a non-indexed (`name` / `id`) column, nested `FieldPath` reads, and/or mixes, ordering, paging, and a zero-match case — proving pushdown == scan.
- [`tests/src/browser/databases/factories.test.ts`](../../tests/src/browser/databases/factories.test.ts) — `createIndexedDBDriver` returns a working `DriverInterface` backed by IndexedDB (a round-trip directly and through the core `createDatabase` stack), in real Chromium.
- [`tests/src/browser/databases/integration.test.ts`](../../tests/src/browser/databases/integration.test.ts) — the whole database + relations stack over the IndexedDB driver: typed CRUD, queries, persistence across reopen, transaction rollback, and relation loading.

## See also

- [`contracts.md`](contracts.md) — the shape DSL and `createContract` a table is built on.
- [`indexeddb.md`](indexeddb.md) — the browser IndexedDB wrapper the `IndexedDBDriver` is built on.
- [`AGENTS.md`](../../AGENTS.md) — the rules; §12 errors & `Result`, §14 totality, §21 minimal interface / one engine / native overrides, §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
