# SQLite

> A lean, typed, **synchronous** wrapper over Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) — zero npm dependencies, just a thin typed skin on `DatabaseSync` / `StatementSync`. It surfaces exactly SQLite's native power — prepared statements, transactions, and pragmas — and deliberately no query / filter / sort / aggregate builder: it is the raw native handle, not an ORM, so a caller reaching for typed querying builds that layer on top. Source: [`src/server`](../../src/server). Surfaced through the `@src/server` barrel.

## Surface

```ts
import { createSQLiteDatabase } from '@src/server'

const db = createSQLiteDatabase({ path: ':memory:' }) // omit `path` for the same in-memory default
db.connect() // open the handle (lazy + idempotent); calls before this throw a CLOSED SQLiteError
db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)')

// `readonly`, `timeout`, and `foreignKeys` thread straight to node:sqlite's native
// options; the database itself also implements `[Symbol.dispose]` (same as
// `close`), so `using db = createSQLiteDatabase()` releases it automatically.

db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u1', 'Ada', 36]) // → { changes: 1, rowid: 1 }
db.prepare('SELECT name FROM users WHERE age >= ?').all([18]) // → [{ name: 'Ada' }] — every adult
```

### Factories

| API                    | Kind     | Summary                                                                        |
| ---------------------- | -------- | ------------------------------------------------------------------------------ |
| `createSQLiteDatabase` | function | Create a synchronous SQLite database over `node:sqlite` (defaults `:memory:`). |

### Entities

| API               | Kind  | Summary                                                                                                               |
| ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `SQLiteDatabase`  | class | The database — `connect` / `close` / `exec` / `prepare` / `transaction` / `begin` / `commit` / `rollback` / `pragma`. |
| `SQLiteStatement` | class | A prepared statement — `run` / `get` / `all` / `iterate`.                                                             |

### Constants

| API                 | Kind  | Summary                                                                                                    |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `SQLITE_CONSTRAINT` | const | SQLite result code (low byte `19`) `wrapError` masks the `errcode` against to flag a constraint violation. |
| `SQLITE_BUSY`       | const | SQLite result code (low byte `5`) `wrapError` masks the `errcode` against to flag a locked-database fault. |

### Helpers and errors

| API              | Kind     | Summary                                                                                            |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `wrapError`      | function | Convert a thrown native `node:sqlite` error into a typed `SQLiteError`.                            |
| `bindParameters` | function | Normalize `SQLiteParameters` to a native call's positional-spread or named shape.                  |
| `SQLiteError`    | class    | A wrapper error carrying a machine-readable `code` (`CLOSED` / `CONSTRAINT` / `BUSY` / `UNKNOWN`). |
| `isSQLiteError`  | function | Whether a value is a `SQLiteError`.                                                                |

### Types

| API                        | Kind      | Summary                                                                                                                                       |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLiteValue`              | type      | A value SQLite stores and returns natively (`null` / number / bigint / string / `Uint8Array`).                                                |
| `SQLiteRow`                | type      | A result row — a record of column name to `SQLiteValue`.                                                                                      |
| `SQLiteParameters`         | type      | Bind parameters — positional (an array) or named (a record).                                                                                  |
| `SQLiteRunResult`          | interface | The outcome of a non-query statement (`changes` / `rowid`) — `number` (a count / rowid past 2^53 truncates, acceptable for keys and changes). |
| `SQLiteErrorCode`          | type      | The machine-readable `SQLiteError` code union.                                                                                                |
| `SQLiteDatabaseOptions`    | interface | Options for `createSQLiteDatabase` (`path` / `readonly` / `timeout` / `foreignKeys` / `bigints`).                                             |
| `SQLiteStatementInterface` | interface | The prepared-statement contract.                                                                                                              |
| `SQLiteDatabaseInterface`  | interface | The database contract.                                                                                                                        |

Row values arrive as the native `SQLiteValue` types and are handed back as-is — the precise per-row shape is imposed one layer up, by the database driver, through a contract, never re-narrowed here (AGENTS §14). Keys and columns are plain SQL: this layer moves `SQLiteValue`s in and out, and typing each row is the job of the layer above.

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed (its `readonly` data members, e.g. `path` / `connected` / `transacting`, stay in the Surface rows above). Each class implements its interface exactly — no extra public method — so this doubles as the per-instance method surface (AGENTS §22). Every one of these calls is **synchronous** and returns a plain value, never a `Promise`.

`SQLiteDatabaseInterface` also exposes `readonly transacting: boolean` — whether a transaction is currently open on this connection (node:sqlite's `isTransaction`, wrapping `sqlite3_get_autocommit()`), `false` when not connected. `transaction(scope)` sets it for the scope's duration; `begin()` / `commit()` / `rollback()` set and clear it identically, since `transaction` is itself built on those same primitives. `transaction(scope)` remains the right tool whenever the whole transaction fits in one synchronous scope; `begin` / `commit` / `rollback` exist for a long-lived or externally-driven transaction that spans async caller code and so cannot be expressed as a single synchronous scope.

`SQLiteDatabaseInterface` also declares `[Symbol.dispose](): void` — a symbol-keyed member, so it is documented here in prose rather than as a `Methods` table row (the guide-parity tooling keys method rows by identifier name). It closes the connection exactly like `close`, letting `using db = createSQLiteDatabase(...)` release it deterministically at the end of a block.

#### `SQLiteDatabaseInterface`

| Method        | Returns                    | Behavior                                                                                                   |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `connect`     | `void`                     | Open the underlying connection — lazy and idempotent; a second call is a no-op.                            |
| `close`       | `void`                     | Release the connection; afterward every operation gates `CLOSED` until reconnect.                          |
| `exec`        | `void`                     | Run one or more result-less SQL statements (DDL, pragmas) in a single call.                                |
| `prepare`     | `SQLiteStatementInterface` | Compile SQL into a reusable prepared statement (the only path that runs queries).                          |
| `transaction` | `R`                        | Run `scope` between `BEGIN` and `COMMIT`, rolling the whole scope back and rethrowing on a throw.          |
| `begin`       | `void`                     | Open a transaction (`BEGIN`); throws the native fault (e.g. a nested `BEGIN`) as a `SQLiteError`.          |
| `commit`      | `void`                     | Commit the open transaction (`COMMIT`); throws the native fault as a `SQLiteError` when none is open.      |
| `rollback`    | `void`                     | Roll back the open transaction (`ROLLBACK`); throws the native fault as a `SQLiteError` when none is open. |
| `pragma`      | `SQLiteValue \| undefined` | Read a single PRAGMA, or set then read it when a `value` is passed.                                        |

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
5. **Native faults become `SQLiteError`.** Every native `node:sqlite` throw is mapped at the boundary to a `SQLiteError` carrying a machine-readable `code` — a constraint violation (a UNIQUE / PRIMARY KEY conflict) is detected as `'CONSTRAINT'`, anything else is `'UNKNOWN'`. This holds for `iterate` too: its lazy native iterator is stepped inside its own try/catch, so a fault surfacing mid-stream (e.g. an out-of-range integer on a later row) maps to a `SQLiteError` exactly like an eager fault, never escaping raw from the caller's `for...of`. Narrow a caught value with `isSQLiteError`.
6. **`CLOSED` before connect, and after close for any statement too.** The database connects lazily; an operation before `connect` (or after `close`) throws a `CLOSED` `SQLiteError`. `connect` is idempotent. A `SQLiteStatementInterface` retains a liveness check to its owning connection: once that connection is closed, every one of the statement's methods (`run` / `get` / `all` / `iterate`) also throws `CLOSED` — even a statement prepared before the close and still held by the caller. Reconnecting afterward does not revive it: a statement prepared on the OLD connection stays `CLOSED` permanently; prepare a fresh statement on the new connection.
7. **`BUSY` on lock contention — `SQLITE_LOCKED` is not `BUSY`.** A write that finds the database locked by another connection retries for `timeout` milliseconds (default `0` — fail immediately), then throws a `BUSY` `SQLiteError` — retryable, unlike the other codes. A `SQLITE_LOCKED` fault (result code `6`, a same-connection table-lock conflict, distinct from `SQLITE_BUSY`'s cross-connection database lock) is **not** mapped to `'BUSY'` — `wrapError` only recognizes `SQLITE_BUSY`, so a `SQLITE_LOCKED` fault surfaces as `'UNKNOWN'` and is not retryable the same way.
8. **`transacting` mirrors native autocommit state.** `db.transacting` is `true` exactly while a transaction is open (inside `transaction(scope)`, or between a manual `BEGIN` and its `COMMIT` / `ROLLBACK`) and `false` otherwise, including when disconnected.
9. **`transaction(scope)` requires a synchronous scope.** If `scope` returns a thenable (an `async` function or a function returning a `Promise`), the transaction is rolled back immediately and a `SQLiteError` with code `'UNKNOWN'` is thrown — an async scope would otherwise return before its awaited work runs, letting `transaction` commit prematurely. A transaction that must span async caller code uses `begin()` / `commit()` / `rollback()` directly instead.

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

### Long-lived transactions with begin / commit / rollback

```ts
// A transaction that must span async caller code (a request handle held open
// across awaits) can't fit in one synchronous transaction(scope) — use the
// primitives directly instead.
db.begin()
try {
	db.prepare('INSERT INTO users VALUES (?, ?, ?)').run(['u5', 'Kai', 19])
	await doSomethingAsync() // caller-driven work between begin and commit
	db.commit()
} catch (error) {
	db.rollback()
	throw error
}

// Branch on `transacting` instead of catching a nested-BEGIN fault:
if (!db.transacting) db.begin()
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

### Closing a connection

```ts
db.close() // releases the connection; every operation gates CLOSED until reconnect
db.connected // false
```

### Production options: readonly, timeout, foreignKeys

```ts
// Open an existing file read-only — a write throws (the file must already exist):
const reader = createSQLiteDatabase({ path: '/data/app.db', readonly: true })

// A busy timeout retries a locked database before failing BUSY:
const writer = createSQLiteDatabase({ path: '/data/app.db', timeout: 2000 })

// Foreign-key enforcement (node:sqlite defaults this to true when omitted):
const enforced = createSQLiteDatabase({ foreignKeys: true })

// Writes always accept a bigint; a stored integer beyond Number.MAX_SAFE_INTEGER
// throws on read unless `bigints` is enabled — enabling it returns EVERY integer
// column as bigint, not just the out-of-range ones:
const exact = createSQLiteDatabase({ bigints: true })
```

### Disposing with `using`

```ts
{
	using db = createSQLiteDatabase()
	db.connect()
	db.exec('CREATE TABLE t (id INTEGER)')
} // db.close() runs automatically at the end of the block
```

### Retrying on BUSY

```ts
import { isSQLiteError } from '@src/server'

try {
	db.prepare('INSERT INTO t VALUES (?)').run([1]) // another connection holds the lock
} catch (error) {
	if (isSQLiteError(error) && error.code === 'BUSY') {
		// retryable — back off briefly and retry, or raise the `timeout` option
	}
}
```

### The boundary helpers directly

```ts
import { bindParameters, wrapError } from '@src/server'

bindParameters(['u1', 'Ada']) // → { positional: ['u1', 'Ada'] }
bindParameters({ id: 'u1' }) // → { named: { id: 'u1' } }

try {
	db.exec('not sql')
} catch (error) {
	wrapError(error) // a typed SQLiteError, mapped from the native throw
}
```

### Practices

- **Use prepared statements with bound parameters**, never string-interpolated values — binding is the SQL-injection-safe path (pragmas, which can't bind, take trusted internal names only).
- **Keep a transaction scope synchronous and tight** — the wrapper is synchronous, so a scope is a plain function body that commits on return and rolls back on a throw.
- **Branch on `error.code`** (via `isSQLiteError`) rather than parsing a message — `'CONSTRAINT'` distinguishes a key conflict from any other fault.
- **Retry `'BUSY'`, not the others** — it is the one retryable code; back off briefly (or raise `timeout`) before retrying the same operation.
- **Prefer `using`** over a manual `try` / `finally close()` when a database's lifetime matches one block scope.
- **Enable `bigints` when integers may exceed `Number.MAX_SAFE_INTEGER`** — writes already accept `bigint`, but a read of an out-of-range stored integer throws unless `bigints` is set; note the option applies to every integer column, not selectively.
- **Branch on `transacting` instead of catching a nested-`BEGIN` error** — a consumer composing its own `begin()` (e.g. a migration step joining an enclosing transaction) checks `db.transacting` first and skips its own `begin()` / `commit()` when one is already open, rather than issuing `begin()` unconditionally and handling the "cannot start a transaction within a transaction" fault.
- **Use `begin()` / `commit()` / `rollback()` only for a long-lived or externally-driven transaction** that spans async caller code — `transaction(scope)` stays the right tool whenever the whole transaction fits in one synchronous scope.
- **Never pass an `async` scope to `transaction(scope)`** — a thenable return is rejected (rolled back, then thrown as `'UNKNOWN'`) rather than silently committing before the awaited work runs; reach for `begin()` / `commit()` / `rollback()` for anything that must `await`.
- **`'BUSY'` is the only retryable code from lock contention** — a `SQLITE_LOCKED` fault (a same-connection conflict) is not mapped to `'BUSY'` and surfaces as `'UNKNOWN'`, so do not treat every lock-shaped fault as retryable; branch on `error.code === 'BUSY'` specifically.

## Tests

- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ `src/server` bijection and the `## Methods` ↔ interface/class method parity.
- [`tests/src/server/SQLiteDatabase.test.ts`](../../tests/src/server/SQLiteDatabase.test.ts) — the database in a real `:memory:` SQLite: connect / close lifecycle, the `CLOSED` gate, exec DDL, prepare round-trip, transaction commit and rollback, pragma get + set, and the production options — `readonly` rejecting a write, `foreignKeys` enforcing a real FK violation, `timeout` surfacing `BUSY` from a genuinely locked second connection, and `[Symbol.dispose]` closing inside a `using` block.
- [`tests/src/server/SQLiteStatement.test.ts`](../../tests/src/server/SQLiteStatement.test.ts) — prepared statements: `run`'s result, positional and named binding, `get` / `all` / `iterate`, and a `CONSTRAINT` violation.
- [`tests/src/server/helpers.test.ts`](../../tests/src/server/helpers.test.ts) — the wrapper's boundary helpers as pure units: `wrapError` mapping a thrown value to a typed `SQLiteError` (real constraint fault → `CONSTRAINT`, real locked-database fault → `BUSY`, non-error → `UNKNOWN`, pass-through) and `bindParameters` normalizing parameters to the native binding shape (array → positional, record → named).
- [`tests/src/server/factories.test.ts`](../../tests/src/server/factories.test.ts) — `createSQLiteDatabase` returns a working `SQLiteDatabaseInterface` and defaults its path to `:memory:`.

## See also

- [`AGENTS.md`](../../AGENTS.md) — §14 untyped-boundary narrowing, §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
