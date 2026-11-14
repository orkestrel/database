import type { DriverInterface } from '@src/core'
import type { SQLiteValue } from '@orkestrel/sqlite'

// The server surface's type domain — the compiled-SQL contract shared between
// the pure `compilers.ts` (`QueryInput` → SQL) and `SQLiteDriver`. SQL is a
// Node-backend concept, so it lives here rather than in `core`; core stays
// host-independent and never speaks SQL.

/**
 * Represents a parameterized SQL fragment or statement plus its bind values. The
 * `@orkestrel/database/server` entry point exports this type.
 *
 * @remarks
 * Produced by the pure SQL compilers (`compilers.ts`) that turn a core
 * `QueryInput` (or a table definition) into SQL text with `?` placeholders, and
 * consumed by the SQLite driver, which runs `sql` with `parameters` bound in
 * order — no further assembly. Keeping `sql` and `parameters` together prevents
 * the two from drifting apart across compile and execute.
 */
export interface CompiledSQL {
	readonly sql: string
	readonly parameters: readonly SQLiteValue[]
}

/**
 * Configures {@link import('./factories.js').createSQLiteDriver}. The
 * `@orkestrel/database/server` entry point exports this type.
 *
 * @remarks
 * Threaded into the underlying `@orkestrel/sqlite` wrapper's connection.
 * `path` is the required database file path (pass `':memory:'` explicitly for memory); `readonly`
 * opens the connection read-only (a write then fails as a typed `DRIVER`
 * {@link DatabaseError}); `timeout` is the busy-timeout in milliseconds before
 * a locked database fails `BUSY`, 0 when omitted: set it only when another process or a
 * worker thread opens the file, because the wait blocks the calling thread; `references`
 * enables or disables foreign-key constraint enforcement, while omission retains the
 * upstream default. A writable file opens under `journal_mode = WAL` unless `pragmas` names
 * `journal_mode`. `pragmas` is an ordered record of PRAGMA name to value, applied through
 * the wrapper's `pragma()` after the WAL default, in insertion order (for example
 * `{ synchronous: 'FULL' }`). Each name must pass `isPragmaName` and be one of
 * `PRAGMA_NAMES`, and each value must pass `isPragmaValue`, a 32-bit signed integer or a
 * bare keyword; anything else throws `VALIDATION`. Core rows are number-typed — this driver
 * never surfaces a `bigint`, so a stored integer beyond
 * `Number.MAX_SAFE_INTEGER` reads back imprecisely (the wrapper's own
 * `bigints` option is not exposed here).
 */
export interface SQLiteDriverOptions {
	readonly path: string
	readonly readonly?: boolean
	readonly timeout?: number
	readonly references?: boolean
	readonly pragmas?: Readonly<Record<string, string | number>>
}

/**
 * Represents the SQLite driver: the storage contract plus a read of one connection pragma.
 *
 * @remarks
 * `createSQLiteDriver` returns it. The `pragma` method is a root member: the scoped capability
 * a transaction passes does not declare it.
 *
 * @example
 * ```ts
 * import type { SQLiteDriverInterface } from '@orkestrel/database/server'
 * import { createSQLiteDriver } from '@orkestrel/database/server'
 *
 * const driver: SQLiteDriverInterface = createSQLiteDriver({ path: ':memory:' })
 * await driver.open([])
 * driver.pragma('journal_mode') // 'memory'
 * ```
 */
export interface SQLiteDriverInterface extends DriverInterface {
	/**
	 * Runs `PRAGMA name` with no value and returns the first value the engine answers.
	 *
	 * @remarks
	 * A name the engine treats as an action runs that action. The name must pass
	 * `isPragmaName` from `@orkestrel/sqlite`; a malformed name raises `VALIDATION` ahead of
	 * any SQL, and a call while a transaction is active raises `CONFLICT`.
	 *
	 * @param name - The pragma name
	 * @returns The first value of the engine's answer, or `undefined` when it answers no row
	 *
	 * @example
	 * ```ts
	 * import { createSQLiteDriver } from '@orkestrel/database/server'
	 *
	 * const driver = createSQLiteDriver({ path: ':memory:', pragmas: { synchronous: 'OFF' } })
	 * await driver.open([])
	 * driver.pragma('synchronous') // 0
	 * ```
	 */
	pragma(name: string): SQLiteValue | undefined
}
