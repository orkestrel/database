# IndexedDB

> The browser-native storage layer: a lean, typed, Promise-based wrapper over the raw `IDBDatabase` / `IDBObjectStore` / `IDBIndex` / `IDBTransaction` API. Its job is to turn IndexedDB's event-driven, callback-shaped, structurally-untyped surface into one you can `await` — and nothing more. So it exposes exactly the native capabilities the core [database](databases.md) engine **cannot** express over its portable `scan` — secondary indexes, native key ranges, promisified cursors, and native multi-store transactions — and deliberately **none** that it can: there is no `where` / `filter` / `order` / aggregate builder here. Filtering, sorting, and joining are the one core engine's job, running over `scan`; bolting a second query DSL onto the wrapper would just duplicate it (the reworked scsr package's standalone query / where-clause / aggregate classes are dropped here for exactly that reason). The IndexedDB [`DriverInterface`](databases.md) is built on this wrapper — it never touches raw IndexedDB — and standalone browser code that wants native power without the portability layer can use it directly. Source: [`src/browser/indexeddb`](../../src/browser/indexeddb). Surfaced through the `@src/browser` barrel.

## Surface

```ts
import { createIndexedDBDatabase, range } from '@src/browser'

// A store keyed by `id`, with one secondary index on `age`. `version: 1` creates
// the schema on first open; omit `version` for auto-managed mode (see below).
const db = createIndexedDBDatabase({
	name: 'app',
	version: 1,
	stores: {
		users: { path: 'id', indexes: [{ name: 'byAge', path: 'age' }] },
	},
})

const users = db.store('users') // lazily connects on first use — no explicit open
await users.set({ id: 'u1', name: 'Ada', age: 36 })
await users.set([
	{ id: 'u2', name: 'Bea', age: 17 },
	{ id: 'u3', name: 'Cy', age: 51 },
]) // array in → array of keys out (array-first batch)

await users.get('u1') // point read by primary key → the row, or undefined
await users.index('byAge').records(range.from(18)) // adults, index-backed (O(log n))
```

### Database and factory

| API                       | Kind     | Summary                                                                   |
| ------------------------- | -------- | ------------------------------------------------------------------------- |
| `createIndexedDBDatabase` | function | Create a typed, lazily-connecting IndexedDB database over a store schema. |
| `IndexedDBDatabase`       | class    | The database — `connect` / `store` / `read` / `write` / `close` / `drop`. |

### Stores, indexes, cursors, transactions

| API                         | Kind  | Summary                                                                    |
| --------------------------- | ----- | -------------------------------------------------------------------------- |
| `IndexedDBStore`            | class | One object store: keyed CRUD plus `index`, `count`, `records`, `cursor`.   |
| `IndexedDBIndex`            | class | A secondary index — read access by an indexed key path.                    |
| `IndexedDBCursor`           | class | A promisified value cursor for streaming and in-place `update` / `delete`. |
| `IndexedDBTransaction`      | class | An explicit transaction over one or more stores, with scoped store access. |
| `IndexedDBTransactionStore` | class | An object store bound to an explicit transaction (no implicit commit).     |

### Helpers and errors

| API                    | Kind     | Summary                                                                                   |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `promisifyRequest`     | function | Resolve an `IDBRequest` to its result, rejecting with an `IndexedDBError`.                |
| `promisifyTransaction` | function | Resolve once an `IDBTransaction` commits, rejecting if it errors or aborts.               |
| `readRecord`           | function | Read one record from a store or index by key, narrowed to a `Row` with `isRecord`.        |
| `readRecords`          | function | Read many records from a store or index over an optional key range, narrowed to `Row`s.   |
| `hasKey`               | function | Whether a key is present in a store or index (a native `count` > 0).                      |
| `range`                | const    | Key-range builders (`only` / `above` / `from` / `below` / `to` / `between` / `prefix`).   |
| `wrapError`            | function | Map a native IndexedDB `DOMException` to a typed `IndexedDBError` (the request boundary). |
| `IndexedDBError`       | class    | A wrapper error carrying a machine-readable `code` mapped from the native fault.          |

### Constants

| API           | Kind  | Summary                                                                          |
| ------------- | ----- | -------------------------------------------------------------------------------- |
| `ERROR_CODES` | const | Native `DOMException.name` → `IndexedDBErrorCode`, read by `wrapError` (frozen). |

### Types

| API                                  | Kind      | Summary                                                                         |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------- |
| `KeyPath`                            | type      | A key path — one field, or several for a compound key.                          |
| `IndexDefinition`                    | interface | A secondary index's definition (`name` / `path` / `unique` / `multiple`).       |
| `StoreDefinition`                    | interface | A store's schema (`path` / `increment` / `indexes`).                            |
| `StoresShape`                        | type      | A database's stores — a map of store name to its `StoreDefinition`.             |
| `IndexedDBDatabaseOptions`           | interface | Options for `createIndexedDBDatabase` (`name` / optional `version` / `stores`). |
| `CursorOptions`                      | interface | Options for opening a cursor (`query` key range, `direction`).                  |
| `IndexedDBErrorCode`                 | type      | The machine-readable `IndexedDBError` code union.                               |
| `IndexedDBDatabaseInterface`         | interface | The database contract.                                                          |
| `IndexedDBStoreInterface`            | interface | The object-store contract.                                                      |
| `IndexedDBIndexInterface`            | interface | The secondary-index contract.                                                   |
| `IndexedDBCursorInterface`           | interface | The cursor contract.                                                            |
| `IndexedDBTransactionInterface`      | interface | The explicit-transaction contract.                                              |
| `IndexedDBTransactionStoreInterface` | interface | The transaction-bound store contract.                                           |

Values are the core `Row` (a record), narrowed from IndexedDB's structured clone with `isRecord` at the read boundary — the same `as`-free bridge the core driver uses. Keys are the full native `IDBValidKey` (a superset of the core `Key`), so the wrapper speaks IndexedDB's whole key space.

A database connects **lazily**: the first store operation (or an explicit `connect`) opens it; you never wire up `onsuccess` yourself. `version` controls schema creation: pin an explicit number to create any missing stores on a bump, or **omit it** for auto-managed mode, where the database opens at its current version and bumps once on its own to create any declared store the stored schema lacks — so adding a store never needs a manual version bump. Auto-managed mode is what the database `DriverInterface` runs on.

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed (its `readonly` data members, e.g. `name` / `path` / `value` / `stores`, stay in the Surface rows above). Each class implements its interface exactly, so this doubles as the per-instance method surface (AGENTS §22).

#### `IndexedDBDatabaseInterface`

| Method    | Returns                   | Behavior                                                                           |
| --------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `connect` | `Promise<IDBDatabase>`    | Open the connection (lazy, idempotent); creates declared stores on a version bump. |
| `store`   | `IndexedDBStoreInterface` | A typed handle for a declared store.                                               |
| `read`    | `Promise<void>`           | Run a readonly scope over one or more stores.                                      |
| `write`   | `Promise<void>`           | Run a readwrite scope; commit on resolve, roll back on throw.                      |
| `close`   | `void`                    | Release the connection.                                                            |
| `drop`    | `Promise<void>`           | Close and delete the whole database.                                               |

#### `IndexedDBStoreInterface`

The keyed verbs batch by their array overload (one in → one out; array in → array out), array-first (AGENTS §9.2).

| Method    | Returns                                     | Behavior                                              |
| --------- | ------------------------------------------- | ----------------------------------------------------- |
| `get`     | `Promise<Row \| undefined>`                 | Read by key (array → array); a miss is `undefined`.   |
| `resolve` | `Promise<Row>`                              | Read by key, throwing `NOT_FOUND` on a miss.          |
| `records` | `Promise<readonly Row[]>`                   | Read many over an optional key range.                 |
| `keys`    | `Promise<readonly IDBValidKey[]>`           | List keys over an optional key range.                 |
| `has`     | `Promise<boolean>`                          | Whether a key is present (array → array).             |
| `count`   | `Promise<number>`                           | Count records, optionally within a key range.         |
| `set`     | `Promise<IDBValidKey>`                      | Upsert one record or an array (array-first overload). |
| `add`     | `Promise<IDBValidKey>`                      | Insert, throwing `CONSTRAINT` on a duplicate key.     |
| `remove`  | `Promise<void>`                             | Delete by key (array → batch).                        |
| `clear`   | `Promise<void>`                             | Empty the store.                                      |
| `index`   | `IndexedDBIndexInterface`                   | A secondary index by name.                            |
| `cursor`  | `Promise<IndexedDBCursorInterface \| null>` | Open a readwrite cursor for streaming and mutation.   |

#### `IndexedDBIndexInterface`

| Method    | Returns                                     | Behavior                                             |
| --------- | ------------------------------------------- | ---------------------------------------------------- |
| `get`     | `Promise<Row \| undefined>`                 | First record for an index key (array → array).       |
| `resolve` | `Promise<Row>`                              | First record for an index key, throwing `NOT_FOUND`. |
| `records` | `Promise<readonly Row[]>`                   | Matching records over an optional key range.         |
| `keys`    | `Promise<readonly IDBValidKey[]>`           | The matching records' primary keys.                  |
| `primary` | `Promise<IDBValidKey \| undefined>`         | The primary key for an index key.                    |
| `has`     | `Promise<boolean>`                          | Whether an index key is present (array → array).     |
| `count`   | `Promise<number>`                           | Count matches, optionally within a key range.        |
| `cursor`  | `Promise<IndexedDBCursorInterface \| null>` | Open a readonly cursor over the index.               |

#### `IndexedDBCursorInterface`

| Method     | Returns                                     | Behavior                                         |
| ---------- | ------------------------------------------- | ------------------------------------------------ |
| `continue` | `Promise<IndexedDBCursorInterface \| null>` | Advance to the next record (or an optional key). |
| `seek`     | `Promise<IndexedDBCursorInterface \| null>` | Advance to a given index key and primary key.    |
| `advance`  | `Promise<IndexedDBCursorInterface \| null>` | Skip forward `count` records.                    |
| `update`   | `Promise<IDBValidKey>`                      | Overwrite the record at the current position.    |
| `delete`   | `Promise<void>`                             | Delete the record at the current position.       |

#### `IndexedDBTransactionInterface`

| Method   | Returns                              | Behavior                                          |
| -------- | ------------------------------------ | ------------------------------------------------- |
| `store`  | `IndexedDBTransactionStoreInterface` | A scope-bound store (must be in the transaction). |
| `abort`  | `void`                               | Roll the transaction back.                        |
| `commit` | `void`                               | Flush the transaction early.                      |

#### `IndexedDBTransactionStoreInterface`

The transaction-bound CRUD surface — the same verbs as a store, without `index` and without an implicit per-call commit.

| Method    | Returns                                     | Behavior                                            |
| --------- | ------------------------------------------- | --------------------------------------------------- |
| `get`     | `Promise<Row \| undefined>`                 | Read by key within the transaction (array → array). |
| `resolve` | `Promise<Row>`                              | Read by key, throwing `NOT_FOUND` on a miss.        |
| `records` | `Promise<readonly Row[]>`                   | Read many over an optional key range.               |
| `keys`    | `Promise<readonly IDBValidKey[]>`           | List keys over an optional key range.               |
| `has`     | `Promise<boolean>`                          | Whether a key is present (array → array).           |
| `count`   | `Promise<number>`                           | Count records, optionally within a key range.       |
| `set`     | `Promise<IDBValidKey>`                      | Upsert one record or an array.                      |
| `add`     | `Promise<IDBValidKey>`                      | Insert, throwing `CONSTRAINT` on a duplicate key.   |
| `remove`  | `Promise<void>`                             | Delete by key (array → batch).                      |
| `clear`   | `Promise<void>`                             | Empty the store.                                    |
| `cursor`  | `Promise<IndexedDBCursorInterface \| null>` | Open a cursor within the transaction.               |

## Contract

These invariants hold across `src/browser/indexeddb` ↔ `indexeddb.md`:

1. **DOC ↔ SOURCE bijection.** Every row in the `## Surface` tables is a real export of the wrapper, and every export appears as a Surface row — exhaustive, both directions (AGENTS §22).
2. **Native, not a second query engine.** The wrapper exposes only what raw IndexedDB offers natively — object stores, secondary indexes, key ranges (`range`), cursors, and multi-store transactions. It has **no** `where` / `filter` / `order` / aggregate builder; that is the core database engine over `scan`. The reworked scsr package's standalone query / where-clause / aggregate classes are deliberately dropped here for exactly this reason.
3. **`Row` values, `IDBValidKey` keys.** Reads return the core `Row` (narrowed with `isRecord`, never an unchecked cast); writes take a `Row`. Keys are the native `IDBValidKey`. Per-row typing belongs above this layer, in the core database's contracts.
4. **In-line or out-of-line keys.** A store with a `path` keys rows by that field; a store with no `path` is out-of-line and takes an explicit key on `set` / `add` — which is exactly how the database driver writes (`set(row, key)`).
5. **Batch by the array overload, array-first.** `get` / `resolve` / `has` / `remove` / `set` / `add` take one value for one result or an array for an array of results (AGENTS §9.2). The array overload is declared first because an array is itself both a record and a compound `IDBValidKey`; to act on a single compound key, pass `range.only([…])` to `records` / `count`.
6. **Each standalone call is its own transaction; `read` / `write` are atomic.** A store method opens and commits its own implicit transaction; `db.read` / `db.write` run a scope across stores that commits on resolve and rolls back on a throw.
7. **DOC ↔ SOURCE method bijection.** Every method in a `## Methods` table is a real call-signature member of that interface in source, and every public method of each behavioral interface is documented — exhaustive, both directions; and each implementing class exposes exactly its interface's public methods, no more (AGENTS §22).

## Patterns

### Choosing the wrapper or the database

```ts
import { createDatabase, createMemoryDriver, stringShape } from '@src/core'
import { createIndexedDBDatabase, isIndexedDBSupported } from '@src/browser'

// Native power (indexes, ranges, cursors) — the wrapper, directly:
const raw = createIndexedDBDatabase({ name: 'app', version: 1, stores: { users: { path: 'id' } } })

// Portable, typed rows + queries + relations — the core database over a driver
// (the IndexedDB driver is built on this same wrapper):
const driver = isIndexedDBSupported()
	? /* createIndexedDBDriver('app') */ createMemoryDriver()
	: createMemoryDriver()
const db = createDatabase({ driver, tables: { users: { id: stringShape() } } })
```

### Index-backed reads with key ranges

```ts
const users = db.store('users')
await users.index('byAge').records(range.between(18, 65)) // working-age, O(log n)
await users.index('byAge').count(range.from(18)) // how many adults
await users.index('byEmail').get('ada@x.io') // unique-index point lookup
await users.records(range.prefix('user:')) // primary-key prefix scan
```

### Cursor streaming and in-place mutation

```ts
let cursor = await db.store('users').cursor()
while (cursor) {
	if (cursor.value.active === false) await cursor.delete()
	cursor = await cursor.continue()
}
```

A `store` cursor runs in a `readwrite` transaction, so `update` / `delete` work; an `index` cursor is read-only and rejects them. Iterate promptly — an unrelated `await` between `continue` steps lets the transaction auto-commit and ends the loop.

### Atomic multi-store transactions

```ts
await db.write(['users', 'posts'], async (tx) => {
	await tx.store('users').set({ id: 'u1', name: 'Ada' })
	await tx.store('posts').set({ id: 'p1', author: 'u1' })
}) // commits together; throws roll the whole scope back
```

### Branching on a typed fault

```ts
import { IndexedDBError } from '@src/browser'

// Insert if new, fall back to upsert on a duplicate-key collision.
try {
	await db.store('users').add({ id: 'u1', name: 'Ada' })
} catch (error) {
	if (error instanceof IndexedDBError && error.code === 'CONSTRAINT') {
		await db.store('users').set({ id: 'u1', name: 'Ada' })
	} else throw error
}
```

Every native `DOMException` crosses the request boundary as an `IndexedDBError` carrying a machine-readable `code` (`CONSTRAINT`, `NOT_FOUND`, `QUOTA`, `ABORTED`, …), so a `catch` branches on `error.code` rather than parsing a message string.

### Practices

- **Feature-detect with `isIndexedDBSupported`** and fall back to `createMemoryDriver` in non-browser contexts.
- **Declare a `path`** for ordinary stores (in-line keys); omit it only when you mean to pass keys explicitly (out-of-line).
- **Keep transaction scopes to awaited IndexedDB operations** — an unrelated `await` between steps lets the transaction auto-commit.
- **Reach for `range`** instead of reading everything and filtering in JS; an index plus a key range is the wrapper's whole point.

## Tests

- [`tests/guides/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ `src/browser/indexeddb` bijection.
- [`tests/src/browser/helpers.test.ts`](../../tests/src/browser/helpers.test.ts) — the browser test environment + the `isIndexedDBSupported` probe consumers run before entering this module.
- [`tests/src/browser/indexeddb/IndexedDBDatabase.test.ts`](../../tests/src/browser/indexeddb/IndexedDBDatabase.test.ts) — the wrapper in real Chromium: CRUD and batch, secondary indexes and key ranges, cursor streaming and mutation, atomic transactions and rollback, persistence across reopen, version-upgrade store creation, and drop.
- [`tests/src/browser/indexeddb/IndexedDBStore.test.ts`](../../tests/src/browser/indexeddb/IndexedDBStore.test.ts) — the store reached through `db.store(name)`: metadata getters, the keyed CRUD surface with array-first batch overloads, key-range reads, `index` / `cursor` access, and the `NOT_FOUND` / `CONSTRAINT` faults.
- [`tests/src/browser/indexeddb/IndexedDBIndex.test.ts`](../../tests/src/browser/indexeddb/IndexedDBIndex.test.ts) — the index reached through `store.index(name)`: metadata getters, the read surface (`get` / `resolve` / `records` / `keys` / `primary` / `has` / `count` / `cursor`), the unique-index lookup + constraint, and the `multiple` (multiEntry) array index.
- [`tests/src/browser/indexeddb/IndexedDBCursor.test.ts`](../../tests/src/browser/indexeddb/IndexedDBCursor.test.ts) — the store/index cursor: the position snapshot (`key` / `primary` / `value` / `direction`), the moves (`continue` / `seek` / `advance`), and in-place `update` / `delete`.
- [`tests/src/browser/indexeddb/IndexedDBTransaction.test.ts`](../../tests/src/browser/indexeddb/IndexedDBTransaction.test.ts) — the transaction from a `read` / `write` scope: metadata getters, scoped `store` access with its out-of-scope guard, and `abort` / `commit` with their finished-state faults.
- [`tests/src/browser/indexeddb/IndexedDBTransactionStore.test.ts`](../../tests/src/browser/indexeddb/IndexedDBTransactionStore.test.ts) — the scoped store reached through `tx.store(name)`: the same keyed CRUD surface as a standalone store but bound to the owning transaction (so a sequence of reads and writes is atomic), without `index`.
- [`tests/src/browser/indexeddb/helpers.test.ts`](../../tests/src/browser/indexeddb/helpers.test.ts) — the wrapper's exported helpers: the `range` key-range builders, the shared read primitives (`readRecord` / `readRecords` / `hasKey`) over a real store / index (including the non-record `isRecord` boundary), and the `promisifyRequest` / `promisifyTransaction` bridges (success + `IndexedDBError` rejection).
- [`tests/src/browser/indexeddb/factories.test.ts`](../../tests/src/browser/indexeddb/factories.test.ts) — `createIndexedDBDatabase` returns a working `IndexedDBDatabaseInterface` that connects lazily, creates its declared stores and indexes, and round-trips real data.

## See also

- [`databases.md`](databases.md) — the cross-environment database, tables, and query layer the IndexedDB driver plugs into.
- [`relations.md`](relations.md) — eager loading, which works unchanged over that driver.
- [`AGENTS.md`](../../AGENTS.md) — §22 documentation-as-contracts, §9.2 batch-by-overload.
- [`README.md`](README.md) — the guides index.
