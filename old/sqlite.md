# SQLite

> The server-native storage layer: a lean, typed, **synchronous** wrapper over Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) — zero npm dependencies, just a thin typed skin on `DatabaseSync` / `StatementSync`. It surfaces exactly SQLite's native power — prepared statements, transactions, and pragmas — and deliberately **none** of what the core [database](databases.md) engine already provides over its portable `scan`: there is no query / filter / sort / aggregate builder here, because that one query engine lives in core and runs over every backend. So this wrapper stays small on purpose; it is the raw native handle, not a second ORM. The SQLite [`DriverInterface`](databases.md) (the database backend) is built on top of it — the driver never reaches past it to raw `node:sqlite` — yet standalone server code can hold the handle directly when it just wants typed SQL. It is the server counterpart to the browser's [IndexedDB](indexeddb.md) wrapper, the same lean-native discipline on a synchronous engine. Source: [`src/server/sqlite`](../../src/server/sqlite). Surfaced through the `@src/server` barrel.

## Surface

```ts
import { createSQLiteDatabase } from '@src/server'

const db = createSQLiteDatabase({ path: ':memory:' }) // omit `path` for the same in-memory default
db.connect() // open the handle (lazy + idempotent); calls before this throw a CLOSED SQLiteError
db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')

db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Ada', 36]) // → { changes: 1, rowid: 1 }
db.prepare('SELECT name FROM users WHERE age >= ?').all([18]) // → [{ name: 'Ada' }] — every adult
```

### Factories

| API                    | Kind     | Summary                                                                        |
| ---------------------- | -------- | ------------------------------------------------------------------------------ |
| `createSQLiteDatabase` | function | Create a synchronous SQLite database over `node:sqlite` (defaults `:memory:`). |

### Entities

| API               | Kind  | Summary                                                                             |
| ----------------- | ----- | ----------------------------------------------------------------------------------- |
| `SQLiteDatabase`  | class | The database — `connect` / `close` / `exec` / `prepare` / `transaction` / `pragma`. |
| `SQLiteStatement` | class | A prepared statement — `run` / `get` / `all` / `iterate`.                           |

### Constants

| API                 | Kind  | Summary                                                                                                    |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `SQLITE_CONSTRAINT` | const | SQLite result code (low byte `19`) `wrapError` masks the `errcode` against to flag a constraint violation. |

### Helpers and errors

| API              | Kind     | Summary                                                                                   |
| ---------------- | -------- | ----------------------------------------------------------------------------------------- |
| `wrapError`      | function | Convert a thrown native `node:sqlite` error into a typed `SQLiteError`.                   |
| `bindParameters` | function | Normalize `SQLiteParameters` to a native call's positional-spread or named shape.         |
| `SQLiteError`    | class    | A wrapper error carrying a machine-readable `code` (`CLOSED` / `CONSTRAINT` / `UNKNOWN`). |
| `isSQLiteError`  | function | Whether a value is a `SQLiteError`.                                                       |

### Types

| API                        | Kind      | Summary                                                                                                                                       |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLiteValue`              | type      | A value SQLite stores and returns natively (`null` / number / bigint / string / `Uint8Array`).                                                |
| `SQLiteRow`                | type      | A result row — a record of column name to `SQLiteValue`.                                                                                      |
| `SQLiteParameters`         | type      | Bind parameters — positional (an array) or named (a record).                                                                                  |
| `SQLiteRunResult`          | interface | The outcome of a non-query statement (`changes` / `rowid`) — `number` (a count / rowid past 2^53 truncates, acceptable for keys and changes). |
| `SQLiteErrorCode`          | type      | The machine-readable `SQLiteError` code union.                                                                                                |
| `SQLiteDatabaseOptions`    | interface | Options for `createSQLiteDatabase` (`path`).                                                                                                  |
| `SQLiteStatementInterface` | interface | The prepared-statement contract.                                                                                                              |
| `SQLiteDatabaseInterface`  | interface | The database contract.                                                                                                                        |

Row values arrive as the native `SQLiteValue` types and are handed back as-is — the precise per-row shape is imposed one layer up, by the database driver, through a contract, never re-narrowed here (AGENTS §14). Keys and columns are plain SQL: this layer moves `SQLiteValue`s in and out, and typing each row is the job of the layer above.

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed (its `readonly` data members, e.g. `path` / `connected`, stay in the Surface rows above). Each class implements its interface exactly — no extra public method — so this doubles as the per-instance method surface (AGENTS §22). Every one of these calls is **synchronous** and returns a plain value, never a `Promise`.

#### `SQLiteDatabaseInterface`

| Method        | Returns                    | Behavior                                                                                          |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `connect`     | `void`                     | Open the underlying connection — lazy and idempotent; a second call is a no-op.                   |
| `close`       | `void`                     | Release the connection; afterward every operation gates `CLOSED` until reconnect.                 |
| `exec`        | `void`                     | Run one or more result-less SQL statements (DDL, pragmas) in a single call.                       |
| `prepare`     | `SQLiteStatementInterface` | Compile SQL into a reusable prepared statement (the only path that runs queries).                 |
| `transaction` | `R`                        | Run `scope` between `BEGIN` and `COMMIT`, rolling the whole scope back and rethrowing on a throw. |
| `pragma`      | `SQLiteValue \| undefined` | Read a single PRAGMA, or set then read it when a `value` is passed.                               |

#### `SQLiteStatementInterface`

| Method    | Returns                       | Behavior                                                                                |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `run`     | `SQLiteRunResult`             | Execute a non-query (INSERT / UPDATE / DELETE / DDL); return its `changes` and `rowid`. |
| `get`     | `SQLiteRow \| undefined`      | Execute and return the first row, or `undefined` when none matched.                     |
| `all`     | `readonly SQLiteRow[]`        | Execute and return every matching row eagerly as an array.                              |
| `iterate` | `IterableIterator<SQLiteRow>` | Execute and stream rows lazily — one row materialized at a time, for large result sets. |

## Contract

These invariants hold across `src/server/sqlite` ↔ `sqlite.md`:

1. **DOC ↔ SOURCE bijection.** Every row in the `## Surface` tables is a real export of the wrapper, and every export appears as a Surface row — exhaustive, both directions (AGENTS §22).
2. **Synchronous.** Every operation runs synchronously, because `node:sqlite` does — no Promises. The asynchronous `DriverInterface` adaptation happens one layer up, in the SQLite driver.
3. **Native, not a second query engine.** The wrapper exposes only what `node:sqlite` offers natively — prepared statements, transactions, and pragmas. It has **no** `where` / `filter` / `order` / aggregate builder; that is the core database engine over `scan`, the same discipline as the IndexedDB wrapper.
4. **`SQLiteValue` values, plain SQL.** Reads return `SQLiteRow`s of native `SQLiteValue`s; writes bind `SQLiteValue`s. Per-row typing belongs above this layer, in the core database's contracts.
5. **Native faults become `SQLiteError`.** Every native `node:sqlite` throw is mapped at the boundary to a `SQLiteError` carrying a machine-readable `code` — a constraint violation (a UNIQUE / PRIMARY KEY conflict) is detected as `'CONSTRAINT'`, anything else is `'UNKNOWN'`. Narrow a caught value with `isSQLiteError`.
6. **`CLOSED` before connect.** The database connects lazily; an operation before `connect` (or after `close`) throws a `CLOSED` `SQLiteError`. `connect` is idempotent.

## Patterns

### Connect, exec, and round-trip a row

```ts
import { createSQLiteDatabase } from '@src/server'

const db = createSQLiteDatabase() // path defaults to ':memory:'
db.connect()
db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')
const result = db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Ada', 36])
result.changes // 1
db.prepare('SELECT * FROM users WHERE id = ?').get(['u1']) // { id: 'u1', name: 'Ada', age: 36 }
```

### Positional and named parameters

```ts
// Positional — an array bound to `?` placeholders:
db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u2', 'Lin', 29])

// Named — a record bound to bare `:name` placeholders (no prefix needed in JS):
db.prepare('INSERT INTO users VALUES (:id, :name, :age)').run({ id: 'u3', name: 'Max', age: 41 })
```

### Reading: get, all, iterate

```ts
db.prepare('SELECT name FROM users WHERE id = ?').get(['u1']) // first row or undefined
db.prepare('SELECT * FROM users ORDER BY age').all() // every row
for (const row of db.prepare('SELECT id FROM users').iterate()) handle(row) // lazy stream
```

### Atomic transactions

```ts
db.transaction(() => {
	db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u4', 'Sam', 22])
	db.prepare('UPDATE users SET age = age + 1 WHERE id = ?').run(['u1'])
}) // commits together; a throw rolls the whole scope back and rethrows
```

### Branching on a typed fault

```ts
import { createSQLiteDatabase, isSQLiteError } from '@src/server'

try {
	db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Dup', 30]) // 'u1' already exists
} catch (error) {
	if (isSQLiteError(error) && error.code === 'CONSTRAINT') {
		// a UNIQUE / PRIMARY KEY conflict — distinguished by `code`, not a parsed message
	}
}
```

### Pragmas

```ts
db.pragma('user_version') // read → 0
db.pragma('user_version', 7) // set then read → 7 (a cheap on-disk schema-version counter)
db.pragma('journal_mode', 'WAL') // set then read → 'wal' — durable write-ahead logging for a file db
```

### Practices

- **Reach for the core database, not raw SQL, for queries** — `createDatabase` over the SQLite driver gives typed rows, the query engine, and relations; this wrapper is the native handle that driver is built on.
- **Use prepared statements with bound parameters**, never string-interpolated values — binding is the SQL-injection-safe path (pragmas, which can't bind, take trusted internal names only).
- **Keep a transaction scope synchronous and tight** — the wrapper is synchronous, so a scope is a plain function body that commits on return and rolls back on a throw.
- **Branch on `error.code`** (via `isSQLiteError`) rather than parsing a message — `'CONSTRAINT'` distinguishes a key conflict from any other fault.

## Tests

- [`tests/guides/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ `src/server/sqlite` bijection and the `## Methods` ↔ interface/class method parity.
- [`tests/src/server/sqlite/SQLiteDatabase.test.ts`](../../tests/src/server/sqlite/SQLiteDatabase.test.ts) — the database in a real `:memory:` SQLite: connect / close lifecycle, the `CLOSED` gate, exec DDL, prepare round-trip, transaction commit and rollback, and pragma get + set.
- [`tests/src/server/sqlite/SQLiteStatement.test.ts`](../../tests/src/server/sqlite/SQLiteStatement.test.ts) — prepared statements: `run`'s result, positional and named binding, `get` / `all` / `iterate`, and a `CONSTRAINT` violation.
- [`tests/src/server/sqlite/helpers.test.ts`](../../tests/src/server/sqlite/helpers.test.ts) — the wrapper's boundary helpers as pure units: `wrapError` mapping a thrown value to a typed `SQLiteError` (real constraint fault → `CONSTRAINT`, non-error → `UNKNOWN`, pass-through) and `bindParameters` normalizing parameters to the native binding shape (array → positional, record → named).
- [`tests/src/server/sqlite/factories.test.ts`](../../tests/src/server/sqlite/factories.test.ts) — `createSQLiteDatabase` returns a working `SQLiteDatabaseInterface` and defaults its path to `:memory:`.

## See also

- [`databases.md`](databases.md) — the cross-environment database, tables, and query layer the SQLite driver plugs into.
- [`indexeddb.md`](indexeddb.md) — the browser counterpart, the same lean-native-wrapper discipline.
- [`AGENTS.md`](../../AGENTS.md) — §14 untyped-boundary narrowing, §22 documentation-as-contracts.
- [`README.md`](README.md) — the guides index.
