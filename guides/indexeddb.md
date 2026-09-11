# IndexedDB

> A lean, typed, Promise-based wrapper over the raw browser `IDBDatabase` /
> `IDBObjectStore` / `IDBIndex` / `IDBTransaction` API — object stores, secondary
> indexes, native key ranges, promisified cursors, multi-store transactions, and
> versioned schema upgrades, over `await` instead of raw `IDBRequest` events.

Its job is to type IndexedDB's event-driven, callback-shaped, structurally-untyped surface. It exposes exactly what raw IndexedDB offers natively and deliberately nothing else: there is no `where` / `filter` / `order` / aggregate query builder here; that would duplicate a general-purpose query engine this package does not ship. Source: [`src/browser`](../src/browser). Surfaced through the `@src/browser` barrel (published as `@orkestrel/indexeddb`).

## Surface

Create a database from a store schema, then read and write through the lazily-connecting store handle it returns.

```ts
import { createIndexedDBDatabase, rangeFromKey } from '@orkestrel/indexeddb'

// A store keyed by `id`, with one secondary index on `age`. `version: 1` creates
// the schema on first open; omit `version` for auto-managed mode (see Versioned
// upgrades, later in this guide).
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
await users.index('byAge').records(rangeFromKey(18)) // adults, index-backed (O(log n))
```

### Database and factory

| API                       | Kind     | Summary                                                                         |
| ------------------------- | -------- | ------------------------------------------------------------------------------- |
| `createIndexedDBDatabase` | function | Creates a typed, lazily-connecting IndexedDB database over a store schema.      |
| `IndexedDBDatabase`       | class    | Represents a browser-native IndexedDB database — a typed, Promise-based handle. |

### Stores, indexes, cursors, transactions

| API                         | Kind  | Summary                                                                                          |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `IndexedDBStore`            | class | Represents an object store — the full keyed CRUD surface plus index, count, and cursor access.   |
| `IndexedDBIndex`            | class | Represents a secondary index on a store — a read-only view keyed by an indexed path.             |
| `IndexedDBCursor`           | class | Represents a promisified value cursor over an object store or index.                             |
| `IndexedDBTransaction`      | class | Represents an explicit transaction over one or more stores, with typed scope-bound store access. |
| `IndexedDBTransactionStore` | class | Represents an object store bound to an explicit transaction, with no implicit per-call commit.   |

### Helpers and errors

| API                    | Kind     | Summary                                                                                                                                    |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `supportsIndexedDB`    | function | Checks whether IndexedDB is available in this environment.                                                                                 |
| `promisifyRequest`     | function | Resolves an `IDBRequest` to its result, rejecting with an `IndexedDBError`.                                                                |
| `promisifyTransaction` | function | Resolves after an `IDBTransaction` commits, rejecting if it errors or aborts.                                                              |
| `readRecord`           | function | Reads one record by key from a store or index, narrowing it to a `Row`.                                                                    |
| `readRecords`          | function | Reads many records from a store or index over an optional key range, narrowing each to a `Row`.                                            |
| `hasKey`               | function | Checks whether a key is present in a store or index.                                                                                       |
| `createIndex`          | function | Creates a secondary index on a store from its `IndexDefinition`.                                                                           |
| `wrapCall`             | function | Runs a synchronous native IndexedDB call, wrapping a thrown `DOMException` into a typed `IndexedDBError`.                                  |
| `rangeAboveKey`        | function | Builds a key range strictly above one key.                                                                                                 |
| `rangeFromKey`         | function | Builds a key range starting at and including one key.                                                                                      |
| `rangeBelowKey`        | function | Builds a key range strictly below one key.                                                                                                 |
| `rangeToKey`           | function | Builds a key range ending at and including one key.                                                                                        |
| `rangePrefix`          | function | Builds a key range containing every string with one prefix.                                                                                |
| `wrapError`            | function | Maps a native IndexedDB `DOMException` to a typed `IndexedDBError`.                                                                        |
| `IndexedDBError`       | class    | Represents an error thrown by the IndexedDB wrapper, carrying a machine-readable `code` and an optional `context` beside the native cause. |
| `isIndexedDBError`     | function | Checks whether a value is an `IndexedDBError`.                                                                                             |

`supportsIndexedDB` reads `globalThis.indexedDB`, and `hasKey` is a native `count` greater than 0. `createIndex` is the shared index-DDL leaf both the built-in schema pass and `context.indexes.create` run. `wrapError` is the request boundary every bridge maps a native `DOMException` through.

### Constants

A `Shape` cell holds the constant's declared type.

| API           | Kind  | Shape                                          | Summary                                                               |
| ------------- | ----- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `ERROR_CODES` | const | `Readonly<Record<string, IndexedDBErrorCode>>` | Maps native `DOMException.name` → the wrapper's `IndexedDBErrorCode`. |

`wrapError` reads this frozen map at the request boundary, falling back to `UNKNOWN` for a native name it does not carry.

### Types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. An extended interface's name comes before `plus`, with the members it adds after.

| API                                     | Kind      | Shape                                                                                                                                                                  | Summary                                                                                                                          |
| --------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Row`                                   | type      | `Record<string, unknown>`                                                                                                                                              | Represents a record stored in, and read from, an object store.                                                                   |
| `KeyPath`                               | type      | `string \| readonly string[]`                                                                                                                                          | Represents a key path — one field, or several for a compound key.                                                                |
| `IndexDefinition`                       | interface | `{ name, path, unique?, multiple? }`                                                                                                                                   | Represents the declaration of a secondary index — its name, key path, and uniqueness.                                            |
| `StoreDefinition`                       | interface | `{ path?, increment?, indexes? }`                                                                                                                                      | Represents the declaration of one object store — its key path, key generation, and secondary indexes.                            |
| `IndexedDBSchema`                       | type      | `Readonly<Record<string, StoreDefinition>>`                                                                                                                            | Represents a database's schema — a map of store name to its `StoreDefinition`.                                                   |
| `IndexedDBUpgradeContext`               | interface | `{ transaction, old, version, stores, indexes }`                                                                                                                       | Represents the escape hatch into a version-change upgrade, passed to `IndexedDBDatabaseOptions.upgrade`.                         |
| `IndexedDBUpgradeStoreManagerInterface` | interface | `{ names } plus create, drop, store`                                                                                                                                   | Represents the store manager of a version-change upgrade.                                                                        |
| `IndexedDBUpgradeIndexManagerInterface` | interface | `{} plus create, drop`                                                                                                                                                 | Represents the secondary-index manager of a version-change upgrade.                                                              |
| `IndexedDBDatabaseOptions`              | interface | `{ name, version?, stores, upgrade? }`                                                                                                                                 | Represents the options for `createIndexedDBDatabase`.                                                                            |
| `IndexedDBCursorOptions`                | interface | `{ query?, direction? }`                                                                                                                                               | Represents the options for opening a cursor.                                                                                     |
| `IndexedDBErrorCode`                    | type      | `'NOT_OPEN' \| 'CLOSED' \| 'NOT_FOUND' \| 'CONSTRAINT' \| 'QUOTA' \| 'ABORTED' \| 'DATA' \| 'OPEN' \| 'UPGRADE' \| 'INACTIVE' \| 'READONLY' \| 'INVALID' \| 'UNKNOWN'` | Represents a machine-readable `IndexedDBError` code.                                                                             |
| `IndexedDBDatabaseInterface`            | interface | `{ database, name, version, stores, open } plus connect, store, read, write, close, drop`                                                                              | Represents the contract of a typed, lazily-connecting IndexedDB database.                                                        |
| `IndexedDBRecordStoreInterface`         | interface | `{} plus get, resolve, records, keys, has, count, set, add, remove, clear, cursor`                                                                                     | Represents the contract the object-store surfaces share — the keyed record verbs, in or out of an explicit transaction.          |
| `IndexedDBStoreInterface`               | interface | `IndexedDBRecordStoreInterface plus { name, path, indexes, increment } plus index`                                                                                     | Represents the contract of an object store — the keyed record surface plus the store's own schema metadata and `index` accessor. |
| `IndexedDBIndexInterface`               | interface | `{ name, path, unique, multiple } plus get, resolve, records, keys, primary, has, count, cursor`                                                                       | Represents the contract of a secondary index — read access by an indexed key path.                                               |
| `IndexedDBCursorInterface`              | interface | `{ cursor, source, key, primary, value, direction } plus continue, seek, advance, update, remove`                                                                      | Represents the contract of a promisified value cursor for streaming and in-place mutation.                                       |
| `IndexedDBTransactionInterface`         | interface | `{ transaction, mode, stores, active, finished, error } plus store, abort, commit`                                                                                     | Represents the contract of an explicit transaction over one or more stores.                                                      |
| `IndexedDBTransactionStoreInterface`    | interface | `IndexedDBRecordStoreInterface plus { store }`                                                                                                                         | Represents the contract of an object store bound to an explicit transaction.                                                     |

Values are this package's own `Row` (a record), narrowed from IndexedDB's structured clone with `isRecord` (from `@orkestrel/contract`) at the read boundary — an `as`-free bridge. Keys are the full native `IDBValidKey`, so the wrapper speaks IndexedDB's whole key space.

A database connects **lazily**: the first store operation (or an explicit `connect`) opens it; you never wire up `onsuccess` yourself. `version` controls schema creation: pin an explicit number to create any missing stores on a bump, or **omit it** for auto-managed mode, where the database opens at its current version and bumps once on its own to create any declared store the stored schema lacks — so adding a store never needs a manual version bump.

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed. Each interface's `readonly` data members are named in the `Shape` column of the [Types](#types) table, earlier. Each class implements its interface exactly, so this doubles as the per-instance method surface (`AGENTS.md` § Documentation contract).

`IndexedDBUpgradeContext` carries only readonly data, so no Methods table follows for it. Its managers carry the upgrade's schema verbs: `context.stores` is the store manager, while `IndexedDBDatabaseInterface.stores` is the plain name list.

#### `IndexedDBDatabaseInterface`

| Method    | Returns                   | Summary                                                                              |
| --------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `connect` | `Promise<IDBDatabase>`    | Opens the connection, lazily and idempotently, waiting through a native block.       |
| `store`   | `IndexedDBStoreInterface` | Returns a typed handle for one declared store.                                       |
| `read`    | `Promise<void>`           | Runs a readonly scope over one or more stores.                                       |
| `write`   | `Promise<void>`           | Runs a readwrite scope, committing when it resolves and rolling back when it throws. |
| `close`   | `void`                    | Retires the handle permanently, releasing the connection and any later open result.  |
| `drop`    | `Promise<void>`           | Closes and deletes the database, waiting through a native block.                     |

#### `IndexedDBRecordStoreInterface`

The keyed record surface `IndexedDBStoreInterface` and `IndexedDBTransactionStoreInterface` both extend, declared once so neither can drift from the other. The keyed verbs batch by their array overload (one in → one out; array in → array out), array-first (`.claude/rules/patterns.md` § Managers § Batch operations). Each extending table that follows repeats these rows, because a consumer holding either interface calls them on it.

| Method    | Returns                                     | Summary                                                                |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `get`     | `Promise<Row \| undefined>`                 | Reads the record at a primary key, or `undefined` on a miss.           |
| `resolve` | `Promise<Row>`                              | Reads the record at a primary key, throwing `NOT_FOUND` on a miss.     |
| `records` | `Promise<readonly Row[]>`                   | Reads the stored records over an optional key range.                   |
| `keys`    | `Promise<readonly IDBValidKey[]>`           | Lists the stored primary keys over an optional key range.              |
| `has`     | `Promise<boolean>`                          | Checks whether a primary key is present.                               |
| `count`   | `Promise<number>`                           | Counts the stored records within an optional key range.                |
| `set`     | `Promise<IDBValidKey>`                      | Writes a record, overwriting whatever the key already holds.           |
| `add`     | `Promise<IDBValidKey>`                      | Writes a record, throwing `CONSTRAINT` where the key is already taken. |
| `remove`  | `Promise<void>`                             | Deletes the record at a primary key.                                   |
| `clear`   | `Promise<void>`                             | Deletes every record the store holds.                                  |
| `cursor`  | `Promise<IndexedDBCursorInterface \| null>` | Opens a cursor over the records, or resolves `null` where none match.  |

#### `IndexedDBStoreInterface`

`IndexedDBRecordStoreInterface` plus `index`. Each call runs in its own implicit transaction.

| Method    | Returns                                     | Summary                                                                      |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `get`     | `Promise<Row \| undefined>`                 | Reads the record at a primary key, or `undefined` on a miss.                 |
| `resolve` | `Promise<Row>`                              | Reads the record at a primary key, throwing `NOT_FOUND` on a miss.           |
| `records` | `Promise<readonly Row[]>`                   | Reads the stored records over an optional key range.                         |
| `keys`    | `Promise<readonly IDBValidKey[]>`           | Lists the stored primary keys over an optional key range.                    |
| `has`     | `Promise<boolean>`                          | Checks whether a primary key is present.                                     |
| `count`   | `Promise<number>`                           | Counts the stored records within an optional key range.                      |
| `set`     | `Promise<IDBValidKey>`                      | Writes a record, overwriting whatever the key already holds.                 |
| `add`     | `Promise<IDBValidKey>`                      | Writes a record, throwing `CONSTRAINT` where the key is already taken.       |
| `remove`  | `Promise<void>`                             | Deletes the record at a primary key.                                         |
| `clear`   | `Promise<void>`                             | Deletes every record the store holds.                                        |
| `index`   | `IndexedDBIndexInterface`                   | Returns a read-only view over one of the store's declared secondary indexes. |
| `cursor`  | `Promise<IndexedDBCursorInterface \| null>` | Opens a cursor over the records, or resolves `null` where none match.        |

#### `IndexedDBIndexInterface`

| Method    | Returns                                     | Summary                                                                          |
| --------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `get`     | `Promise<Row \| undefined>`                 | Reads the first record for an index key, or `undefined` on a miss.               |
| `resolve` | `Promise<Row>`                              | Reads the first record for an index key, throwing `NOT_FOUND` on a miss.         |
| `records` | `Promise<readonly Row[]>`                   | Reads the matching records over an optional index-key range.                     |
| `keys`    | `Promise<readonly IDBValidKey[]>`           | Lists the primary keys of the matching records over an optional index-key range. |
| `primary` | `Promise<IDBValidKey \| undefined>`         | Reads the primary key an index key maps to, or `undefined` on a miss.            |
| `has`     | `Promise<boolean>`                          | Checks whether an index key is present.                                          |
| `count`   | `Promise<number>`                           | Counts the matching records within an optional index-key range.                  |
| `cursor`  | `Promise<IndexedDBCursorInterface \| null>` | Opens a read-only cursor over the matches, or resolves `null` where none match.  |

#### `IndexedDBCursorInterface`

Each readonly data member is a snapshot of the position the cursor stopped on, because IndexedDB reuses the live cursor object on every move.

| Method     | Returns                                     | Summary                                                                     |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| `continue` | `Promise<IndexedDBCursorInterface \| null>` | Advances to the next record, or to the next record at or after a given key. |
| `seek`     | `Promise<IndexedDBCursorInterface \| null>` | Advances to a given index key and primary key.                              |
| `advance`  | `Promise<IndexedDBCursorInterface \| null>` | Skips forward a given number of records.                                    |
| `update`   | `Promise<IDBValidKey>`                      | Overwrites the record at the current position.                              |
| `remove`   | `Promise<void>`                             | Deletes the record at the current position.                                 |

#### `IndexedDBTransactionInterface`

| Method   | Returns                              | Summary                                                                                       |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `store`  | `IndexedDBTransactionStoreInterface` | Returns a scope-bound store, which must be one of the transaction's own stores.               |
| `abort`  | `void`                               | Rolls every write in the transaction back, throwing `INACTIVE` where it has already finished. |
| `commit` | `void`                               | Flushes the transaction early, throwing `INACTIVE` where it has already finished.             |

#### `IndexedDBTransactionStoreInterface`

`IndexedDBRecordStoreInterface` bound to an explicit transaction — the same verbs as a store, without `index` and without an implicit per-call commit. Its `store` is the raw `IDBObjectStore` the owning transaction binds.

| Method    | Returns                                     | Summary                                                                |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `get`     | `Promise<Row \| undefined>`                 | Reads the record at a primary key, or `undefined` on a miss.           |
| `resolve` | `Promise<Row>`                              | Reads the record at a primary key, throwing `NOT_FOUND` on a miss.     |
| `records` | `Promise<readonly Row[]>`                   | Reads the stored records over an optional key range.                   |
| `keys`    | `Promise<readonly IDBValidKey[]>`           | Lists the stored primary keys over an optional key range.              |
| `has`     | `Promise<boolean>`                          | Checks whether a primary key is present.                               |
| `count`   | `Promise<number>`                           | Counts the stored records within an optional key range.                |
| `set`     | `Promise<IDBValidKey>`                      | Writes a record, overwriting whatever the key already holds.           |
| `add`     | `Promise<IDBValidKey>`                      | Writes a record, throwing `CONSTRAINT` where the key is already taken. |
| `remove`  | `Promise<void>`                             | Deletes the record at a primary key.                                   |
| `clear`   | `Promise<void>`                             | Deletes every record the store holds.                                  |
| `cursor`  | `Promise<IndexedDBCursorInterface \| null>` | Opens a cursor over the records, or resolves `null` where none match.  |

#### `IndexedDBUpgradeStoreManagerInterface`

`names` lists the store names the database holds at that point in the upgrade.

| Method   | Returns                              | Summary                                                                  |
| -------- | ------------------------------------ | ------------------------------------------------------------------------ |
| `create` | `void`                               | Creates a store from its definition, within the upgrade transaction.     |
| `drop`   | `void`                               | Deletes a store and everything it holds, within the upgrade transaction. |
| `store`  | `IndexedDBTransactionStoreInterface` | Returns a transaction-bound store for migrating data during the upgrade. |

#### `IndexedDBUpgradeIndexManagerInterface`

Reached as `context.indexes`; the store a call names must already exist within the current upgrade transaction.

| Method   | Returns | Summary                                                                         |
| -------- | ------- | ------------------------------------------------------------------------------- |
| `create` | `void`  | Creates a secondary index on an existing store, within the upgrade transaction. |
| `drop`   | `void`  | Removes a named secondary index from a store, within the upgrade transaction.   |

## Contract

These invariants hold across `src/browser` ↔ `indexeddb.md`:

1. **DOC ↔ SOURCE bijection.** Every row in the `## Surface` tables is a real export of the wrapper, and every export appears as a Surface row — exhaustive, both directions (`AGENTS.md` § Documentation contract).
2. **Native, not a query engine.** The wrapper exposes only what raw IndexedDB offers natively — object stores, secondary indexes, key-range helpers, cursors, and multi-store transactions. It has **no** `where` / `filter` / `order` / aggregate builder; that stays out of scope entirely, deliberately, so the wrapper never grows into a second query DSL.
3. **`Row` values, `IDBValidKey` keys.** Reads return this package's own `Row` (narrowed with `isRecord`, never an unchecked cast); writes take a `Row`. Keys are the native `IDBValidKey`.
4. **In-line or out-of-line keys.** A store with a `path` keys rows by that field; a store with no `path` is out-of-line and takes an explicit key on `set` / `add` (`set(row, key)`).
5. **Batch by the array overload, array-first.** `get` / `resolve` / `has` / `remove` / `set` / `add` take one value for one result or an array for an array of results (`.claude/rules/patterns.md` § Managers § Batch operations). The array overload is declared first because an array is itself both a record and a compound `IDBValidKey`; to act on a single compound key, pass `IDBKeyRange.only([…])` to `records` / `count`.
6. **Each standalone call is its own transaction; `read` / `write` are atomic.** A store method opens and commits its own implicit transaction; `db.read` / `db.write` run a scope across stores that commits on resolve and rolls back on a throw. The completion listener is attached BEFORE the scope runs (not after it resolves), so a scope whose last step is a non-IDB `await` — letting the native transaction auto-commit while the scope is still on the stack — still settles `read` / `write` instead of hanging: `complete` can otherwise fire before a listener attached only after the scope returns would ever be wired.
7. **`get` / `records` narrow to records; `count` / `has` / `keys` operate on keys.** A store or index counts, tests presence, and lists keys over every stored value regardless of shape, but `get` / `resolve` / `records` narrow each value with `isRecord` — so a store holding a non-record value shows `count` greater than `records().length`, and `has` reads `true` for a key `get` reads back as `undefined` (a miss and a non-record value both read as `undefined` from `get`). A cursor reports the same boundary the same way: `cursor.value` is `Row | undefined` and reads `undefined` for a non-record stored value — see Cursor streaming and in-place mutation, later in this guide.
8. **DOC ↔ SOURCE method bijection.** Every method in a `## Methods` table is a real call-signature member of that interface in source, and every public method of each behavioral interface is documented — exhaustive, both directions; and each implementing class exposes exactly its interface's public methods, no more (`AGENTS.md` § Documentation contract).

9. **One atomic upgrade boundary.** The built-in create-missing-stores pass and the custom `upgrade` callback run inside the same versionchange transaction and failure boundary. A synchronous built-in/custom fault, or a custom rejection captured while that transaction remains active, aborts the whole upgrade and rejects `connect()` with `UPGRADE`; no partially created store, index, or migration survives. Its `cause` preserves the initiating value even when that value is `undefined`, and a native schema failure retains the nested typed chain (`UPGRADE` → `CONSTRAINT` → native `ConstraintError`). A failed open clears only its attempt-local state, so the same handle can retry. If auto-commit already occurred but the browser reports success after a failure was recorded, the wrapper closes that result before rejecting, preventing an orphan connection; closing cannot undo the already-committed schema.
10. **Blocking is progress; close wins lifecycle races.** Native `blocked` notifications from open/delete requests are not terminal failures, so `connect()` / `drop()` stay pending until the blocker closes and IndexedDB reports success or error. Repeated `connect()` calls share that pending Promise. `close()` permanently retires the handle even while an open is pending: every native database returned later is closed before the pending `connect()` rejects with `CLOSED`, including the second open of an auto-managed missing-store bump. Connection events carry their exact database identity, so a stale close/versionchange event cannot clear a different live connection.

## Patterns

### Feature-detecting before opening a database

Checks for IndexedDB support before creating and using a database, so a non-browser runtime or a privacy mode without storage never reaches the open call.

```ts
import { createIndexedDBDatabase, rangeFromKey, supportsIndexedDB } from '@orkestrel/indexeddb'

if (supportsIndexedDB()) {
	const db = createIndexedDBDatabase({
		name: 'app',
		version: 1,
		stores: {
			users: { path: 'id', indexes: [{ name: 'byAge', path: 'age' }] },
		},
	})
	await db.store('users').set({ id: 'u1', name: 'Ada', age: 36 })
	await db.store('users').index('byAge').records(rangeFromKey(18)) // adults, index-backed
}
```

### Index-backed reads with key ranges

Reads a primary-key range and an indexed range with the built-in key-range helpers and a native `IDBKeyRange`.

```ts
import {
	rangeAboveKey,
	rangeBelowKey,
	rangeFromKey,
	rangePrefix,
	rangeToKey,
} from '@orkestrel/indexeddb'

const users = db.store('users')
await users.records(IDBKeyRange.only('user:1')) // exactly one primary key
await users.records(rangeAboveKey('user:1')) // keys greater than user:1
await users.records(rangeBelowKey('user:9')) // keys less than user:9
await users.records(rangeToKey('user:9')) // keys less than or equal to user:9
await users.index('byAge').records(IDBKeyRange.bound(18, 65)) // working-age, O(log n)
await users.index('byAge').count(rangeFromKey(18)) // how many adults
await users.index('byEmail').get('ada@x.io') // unique-index point lookup
await users.records(rangePrefix('user:')) // primary-key prefix scan
```

The single-boundary builders each fix a native boolean argument that reads as nothing at the call site, and `rangePrefix` caps the range at U+FFFF. Pass a native `IDBKeyRange` wherever the native call is already readable — `IDBKeyRange.only` for one key, `IDBKeyRange.bound` for a lower and an upper boundary.

### Cursor streaming and in-place mutation

Streams a store's records with a cursor, removing a record in place as the loop passes over it.

```ts
let cursor = await db.store('users').cursor()
while (cursor) {
	if (cursor.value?.active === false) await cursor.remove()
	cursor = await cursor.continue()
}
```

A `store` cursor runs in a `readwrite` transaction, so `update` / `remove` work; an `index` cursor is read-only and rejects them with a typed `IndexedDBError` (`code: 'READONLY'`, native `ReadOnlyError`). Iterate promptly — an unrelated `await` between `continue` steps lets the transaction auto-commit and ends the loop. `cursor.value` is `Row | undefined`: it narrows the stored value with `isRecord` exactly as `get` does, so a non-record stored value reads `undefined` while the cursor still stops on that position and still exposes its `key` and `primary`. Test `value` before you dereference it.

### Seeking an index cursor to one primary key

Seeks an index cursor to the one primary key it needs among several rows sharing the same index key.

```ts
// Three rows share the index key 30, so `seek` picks the one whose primary key is
// 'c' — which is what the native `continuePrimaryKey` exists for.
let cursor = await db.store('users').index('byAge').cursor()
if (cursor) cursor = await cursor.seek(30, 'c')
cursor?.primary // 'c'
```

`seek` is valid only on a cursor whose `source` is an index. It drives the native `continuePrimaryKey`, which IndexedDB defines for an index cursor alone, so a store cursor from `db.store(name).cursor()` throws `InvalidAccessError` — a name `ERROR_CODES` does not map, so it reaches the caller as an `IndexedDBError` of code `UNKNOWN`. Move a store cursor with `continue` or `advance` instead.

### Connection lifecycle: connect, close, drop

Connects explicitly, closes the handle to release the connection, then drops the whole database.

```ts
await db.connect() // idempotent — a later store call would connect lazily anyway
// ... use the database ...
db.close() // release the connection, keeping the stored data
await db.drop() // closes and deletes the whole database
```

**`close()` permanently retires the handle** — `open` reads `false` afterwards, and a later `connect()` on the SAME `IndexedDBDatabaseInterface` throws `CLOSED` rather than reconnecting; reopening the database means calling `createIndexedDBDatabase` again. If an open was already pending, IndexedDB cannot cancel that native request, but the wrapper closes any database it eventually returns and rejects the pending `connect()` with `CLOSED`, so no orphan connection survives. This includes an auto-managed open between its current-version probe and missing-store version bump. This is different from the **transient** connection yield described under Practices, later in this guide (another tab's `versionchange`, or an abnormal browser-initiated close): those clear the handle's internal latches WITHOUT retiring it, so the very same handle lazily reconnects on its next operation.

An open or deletion held up by another live connection remains pending. IndexedDB's native `blocked` notification reports progress, not a terminal error; `connect()` / `drop()` settle only after the blocker closes and the native request succeeds or errors. Repeated `connect()` calls while blocked return the same Promise.

### Reading, testing, and clearing a store

Reads with a `NOT_FOUND`-throwing lookup, tests presence of a batch of keys, removes a batch, then clears the store.

```ts
const users = db.store('users')
await users.resolve('u1') // like get, but throws NOT_FOUND on a miss
await users.has(['u1', 'ghost']) // presence per key, batched (array-first)
await users.remove(['u1', 'u2']) // delete by key, batched
await users.clear() // empty the whole store
```

### Explicit transaction control and cursor movement

Drives an explicit transaction scope, advancing and updating a cursor within it before committing early.

```ts
await db.write('users', async (transaction) => {
	// Every move returns the cursor at its new position and leaves the old wrapper
	// on its own snapshot, so rebind at each step or `update` writes a stale row.
	let cursor = await transaction.store('users').cursor()
	if (cursor) cursor = await cursor.advance(1) // skip forward one record
	if (cursor?.value) await cursor.update({ ...cursor.value, seen: true })
	transaction.commit() // flush early instead of waiting for the scope to resolve
	// transaction.abort() // or roll every write in this scope back
})
```

### The request-boundary helpers directly

Drives the request-boundary helpers directly against a raw `IDBObjectStore` and `IDBTransaction`, and maps a raw `DOMException` on its own.

```ts
import {
	createIndex,
	hasKey,
	promisifyRequest,
	promisifyTransaction,
	readRecord,
	readRecords,
	wrapCall,
	wrapError,
} from '@orkestrel/indexeddb'

await db.read('users', async (transaction) => {
	const native = transaction.store('users').store
	await promisifyRequest(wrapCall(() => native.get('u1'))) // sync throw → IndexedDBError too
	await readRecord(native, 'u1') // narrowed to Row (or undefined) with isRecord
	await readRecords(native) // every record, narrowed the same way
	await hasKey(native, 'u1') // a native count() > 0
	await promisifyTransaction(native.transaction) // resolves after the transaction commits
})
wrapError(null) // the same DOMException → IndexedDBError mapping every bridge uses

// createIndex is the leaf `context.indexes.create` delegates to inside
// onupgradeneeded — call it directly only if you are hand-rolling a raw
// versionchange transaction.
```

### Branching on a typed fault

Branches on a typed `IndexedDBError` code, falling back to an upsert when an insert collides on a duplicate key.

```ts
import { IndexedDBError } from '@orkestrel/indexeddb'

// Insert if new, fall back to upsert on a duplicate-key collision.
try {
	await db.store('users').add({ id: 'u1', name: 'Ada' })
} catch (error) {
	if (error instanceof IndexedDBError && error.code === 'CONSTRAINT') {
		await db.store('users').set({ id: 'u1', name: 'Ada' })
	} else throw error
}
```

Every terminal native `DOMException` crosses the request boundary as an `IndexedDBError` carrying a machine-readable `code` (`CONSTRAINT`, `NOT_FOUND`, `QUOTA`, `ABORTED`, `READONLY`, `DATA`, …), so a `catch` branches on `error.code` rather than parsing a message string. A native `blocked` notification is not a terminal exception and has no error code; the operation remains pending. `ReadOnlyError` (a write attempted on a `readonly` transaction — for example mutating through a cursor opened by `index(...).cursor()`, which always runs read-only) maps to `READONLY`; both `DataError` (an invalid key) and `DataCloneError` (a value IndexedDB's structured clone cannot serialize, for example a function) map to `DATA`.

### Narrowing a caught value with `isIndexedDBError`

Narrows a caught value of unknown shape to an `IndexedDBError` before reading its `code`.

```ts
import { isIndexedDBError } from '@orkestrel/indexeddb'

try {
	await db.store('users').resolve('ghost')
} catch (error) {
	if (isIndexedDBError(error) && error.code === 'NOT_FOUND') {
		// handle the miss
	} else throw error
}
```

### Versioned upgrades: dropping a store, indexing an existing store, migrating data

> **The auto-commit rule.** A transaction — including the versionchange transaction `upgrade` runs in — commits the moment control returns to the event loop with no pending IndexedDB request. Every step inside `upgrade` (and inside any `read` / `write` scope) must be an awaited IndexedDB request; a non-IDB `await` (a `fetch`, a `setTimeout`, an unrelated Promise) lets the transaction auto-commit out from under you, so any later `IndexedDBTransactionStoreInterface` call on it fails `INACTIVE` — every request-issuing call wraps its synchronous native invocation so this (and a closed-connection `INVALID`) surfaces as a typed `IndexedDBError`, the same as an asynchronous fault. This is also why there is no returnable, held-open transaction handle on this wrapper — IndexedDB itself auto-commits any transaction that isn't driven promptly, so a handle you could stash and use later would be broken by design; `read` / `write` and `upgrade` exist specifically to keep the whole scope on the stack instead. The built-in create-missing pass and the custom callback share one capture boundary, and every schema verb on the upgrade's managers — `context.stores.create` / `context.stores.drop` / `context.stores.store` / `context.indexes.create` / `context.indexes.drop` — goes through `wrapCall`, so synchronous schema faults are retained as the `UPGRADE` error's typed cause rather than escaping as raw `DOMException`s. A custom rejection captured while the versionchange transaction remains active aborts that same transaction and rolls the whole upgrade back. If auto-commit wins first but the rejection is recorded before the open success event, `connect()` still closes that connection and rejects, but the committed schema cannot be reversed. The wrapper cannot retroactively turn an already-resolved `connect()` into a rejection: if the open request succeeded before the custom Promise rejected, that late rejection is outside the recoverable boundary.
>
> `upgrade` may return `void` or a `Promise<void>` — an async `upgrade` can `await` the IDB requests it issues through `context.stores.store(...)`, subject to the same rule. A rejection captured while the transaction is active aborts it and rejects the pending `connect()` with a typed `IndexedDBError` (code `UPGRADE`) rather than an unhandled rejection. The initiating value is preserved as `cause`, including an explicitly rejected `undefined`; a failure does not poison the handle, so a later `connect()` starts a fresh attempt.

```ts
import { createIndexedDBDatabase } from '@orkestrel/indexeddb'

const db = createIndexedDBDatabase({
	name: 'app',
	version: 2,
	stores: { users: { path: 'id', indexes: [{ name: 'byName', path: 'name' }] } },
	upgrade: async (context) => {
		// Drop a retired store.
		context.stores.drop('legacy')
		// Create a store the built-in create-missing pass doesn't cover because it
		// isn't declared in `stores` — app-internal bookkeeping, for example.
		context.stores.create('meta', { path: 'key' })
		// The built-in pass only creates missing stores, so an index on an
		// already-existing store goes through the index manager; `drop` is its
		// inverse, over an index a prior version left behind.
		context.indexes.create('users', { name: 'byName', path: 'name' })
		context.indexes.drop('users', 'byRetired')
		// Migrate data in place, awaiting only the IDB requests `store()` issues.
		const store = context.stores.store('users')
		for (const row of await store.records()) {
			await store.set({ ...row, migrated: true })
		}
	},
})
await db.connect()
```

`context.transaction` — the raw versionchange `IDBTransaction` — remains available for anything this wrapper doesn't model directly.

### Practices

- **Feature-detect with `supportsIndexedDB`** before opening a database in an environment that may lack storage (a non-browser runtime, a privacy mode).
- **Declare a `path`** for ordinary stores (in-line keys); omit it only when you mean to pass keys explicitly (out-of-line).
- **Keep transaction scopes to awaited IndexedDB operations** — an unrelated `await` between steps lets the transaction auto-commit (see the auto-commit rule under Versioned upgrades, earlier in this guide).
- **Reach for the key-range helpers** instead of reading everything and filtering in JS; an index plus a key range is the wrapper's whole point.
- **A live connection yields to another tab's upgrade, and recovers from an abnormal close.** The database wires the native `onversionchange` event to close itself, so a second tab (or a second `IndexedDBDatabaseInterface` in the same page) opening at a higher version is never blocked indefinitely. Because that `close()` is self-initiated, the native `close` event does NOT fire for it — so the `onversionchange` handler also clears its own latches directly. The native `onclose` event — fired for an ABNORMAL, browser-initiated close (a crashed connection, storage eviction) that this handle did not request — clears the SAME latches, so either path leaves the handle able to lazily reconnect on its next operation rather than failing `NOT_OPEN` (or a stale, dead connection) forever. Without this, two open tabs over the same database can hang forever, and an abnormal close would permanently wedge the handle.
- **Storage persistence is app policy, not this wrapper's job.** Whether the browser is allowed to evict a database under storage pressure (`navigator.storage.persist()`) is a call the consuming application makes — this wrapper does not surface a `durability` option or any persistence API; it stays strictly on the raw IndexedDB CRUD/schema surface.
- **Safari quirks — untested here, Chromium-only CI.** This package's test suite runs against real Chromium only. Safari has historically shipped `getAll` bugs and first-transaction-after-upgrade quirks on some versions; if you must support Safari, verify your exact schema and upgrade path there directly rather than assuming Chromium parity.

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ `src/browser` bijection, the `## Methods` ↔ interface bijection, and the equality gate: every `Summary` cell against its declaration's description paragraph, the titled `Feature-detecting before opening a database` fence against the `@example` block of that title (pinned so the titled pair cannot be retired silently), and the README pitch against this guide's tagline.
- [`tests/src/browser/helpers.test.ts`](../tests/src/browser/helpers.test.ts) — the `supportsIndexedDB` probe, the key-range helpers asserted on the bounds they return, the shared read primitives (`readRecord` / `readRecords` / `hasKey`) over a real store / index (including the non-record `isRecord` boundary), `createIndex` translating an `IndexDefinition` into a native `createIndex` call inside a real `onupgradeneeded` (honouring `unique` / `multiple`), the `promisifyRequest` / `promisifyTransaction` bridges (success + `IndexedDBError` rejection), `wrapCall` over each of its three paths (a returned value passing through, a thrown `DOMException` surfacing as the mapped `IndexedDBError` with the native error as `cause`, and a non-`DOMException` throw rethrown by identity), the `context` an `IndexedDBError` carries beside its `code`, `wrapError` (including `INACTIVE` / `INVALID`), and `isIndexedDBError`.
- [`tests/src/browser/IndexedDBDatabase.test.ts`](../tests/src/browser/IndexedDBDatabase.test.ts) — the database handle in real Chromium: lazy connect and state, the `store` accessor, atomic `read` / `write` scopes (including settling when the scope ends on a trailing non-IDB `await`, the auto-commit race), `close` / `drop`, the auto-managed schema path, persistence across reopen, the `upgrade` hook (dropping a store, indexing an existing store and a same-upgrade `context.stores.create`d store through `context.indexes.create` — honouring `unique` / `multiple` — removing an index through `context.indexes.drop`, data migration through `context.stores.store`, `context.stores.create`, `old` / `version` / `stores.names`, an async `upgrade` rejection cleanly failing `connect()` with `UPGRADE`, and a synchronous `wrapCall` fault from `context.stores.drop` / `context.indexes.drop` targeting a missing store/index likewise failing `connect()` with `UPGRADE`), built-in auto-managed missing-store creation containing duplicate index names as `UPGRADE` → `CONSTRAINT` → native `ConstraintError` on two distinct same-handle `connect()` retries while suppressing the custom callback, atomic rollback of the version, sentinel data, and failed store, deletion without an orphan connection, synchronous `throw undefined` and asynchronous `Promise.reject(undefined)` failures retaining a present `cause` property, raw blockers proving a versioned open and deletion remain pending until release, repeated blocked connects share one Promise and produce one upgrade/owned connection, `close()` during blocked explicit or auto-managed second opens rejecting `CLOSED` after release without orphaning the native result, and `drop()` directly retiring a pending blocked open before deletion completes without leaving an orphan, a live connection yielding to a second connection's `versionchange`, that yielded handle lazily reconnecting at the new version on its next operation, and an ABNORMAL (non-self-initiated) `onclose` likewise leaving the handle able to lazily reconnect instead of staying invalid forever.
- [`tests/src/browser/IndexedDBStore.test.ts`](../tests/src/browser/IndexedDBStore.test.ts) — the store reached through `db.store(name)`: metadata getters, the keyed CRUD surface with array-first batch overloads, key-range reads, `index` / `cursor` access, and the `NOT_FOUND` / `CONSTRAINT` / `DATA` (a non-cloneable value) faults.
- [`tests/src/browser/IndexedDBIndex.test.ts`](../tests/src/browser/IndexedDBIndex.test.ts) — the index reached through `store.index(name)`: metadata getters, the read surface (`get` / `resolve` / `records` / `keys` / `primary` / `has` / `count` / `cursor`), the unique-index lookup + constraint, and the `multiple` (multiEntry) array index.
- [`tests/src/browser/IndexedDBCursor.test.ts`](../tests/src/browser/IndexedDBCursor.test.ts) — the store/index cursor: the position snapshot (`key` / `primary` / `value` / `direction`), the moves (`continue` / `seek` / `advance`), `seek` on a store cursor rejecting with `UNKNOWN`, in-place `update` / `remove`, an index cursor's `update` / `remove` rejecting with `READONLY`, and a non-record stored value reading `undefined` from `value`.
- [`tests/src/browser/IndexedDBTransaction.test.ts`](../tests/src/browser/IndexedDBTransaction.test.ts) — the transaction from a `read` / `write` scope: metadata getters, scoped `store` access with its out-of-scope guard, and `abort` / `commit` with their already-finished `INACTIVE` faults.
- [`tests/src/browser/IndexedDBTransactionStore.test.ts`](../tests/src/browser/IndexedDBTransactionStore.test.ts) — the scoped store reached through `transaction.store(name)`: the same keyed CRUD surface as a standalone store but bound to the owning transaction (so a sequence of reads and writes is atomic), without `index`, and a real `INACTIVE` fault after the owning transaction auto-commits out from under a captured store.
- [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts) — `createIndexedDBDatabase` returns a working `IndexedDBDatabaseInterface` that connects lazily, creates its declared stores and indexes, and round-trips real data.
- [`tests/src/browser/integration.test.ts`](../tests/src/browser/integration.test.ts) — this guide's flagship fences, transcribed and executed against real Chromium storage: each case runs one fence over a uniquely-named database and asserts the value that fence's comments claim, so a comment the code contradicts fails here. `tests/guides.test.ts` carries the presence guard beside each transcription, proving the transcribed lines are still the documented ones.

## See also

- [`AGENTS.md`](../AGENTS.md) — the Documentation contract, and the batch-by-overload rule in `.claude/rules/patterns.md` § Managers.
- [`README.md`](README.md) — the guides index.
