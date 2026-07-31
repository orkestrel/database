import type { SQLiteValue } from '@orkestrel/sqlite'

// The server surface's type domain — the compiled-SQL contract shared between
// the pure `compilers.ts` (`QueryInput` → SQL) and `SQLiteDriver`. SQL is a
// Node-backend concept, so it lives here rather than in `core`; core stays
// host-independent and never speaks SQL (AGENTS §1, §5).

/**
 * A parameterized SQL fragment or statement plus its bind values.
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
 * Options for {@link import('./factories.js').createSQLiteDriver}.
 *
 * @remarks
 * Threaded into the underlying `@orkestrel/sqlite` wrapper's connection.
 * `path` is the database file path (`':memory:'` when omitted); `readonly`
 * opens the connection read-only (a write then fails as a typed `DRIVER`
 * {@link DatabaseError}); `timeout` is the busy-timeout in milliseconds before
 * a locked database fails `BUSY`; `references` enables or disables foreign-key
 * constraint enforcement, while omission retains the upstream default.
 * `pragmas` is an ordered record of PRAGMA name to
 * value, applied via the wrapper's `pragma()` right after `connect()`, in
 * insertion order (e.g. `{ journal_mode: 'WAL' }`). Core rows are
 * number-typed — this driver never surfaces a `bigint`, so a stored integer
 * beyond `Number.MAX_SAFE_INTEGER` reads back imprecisely (the wrapper's own
 * `bigints` option is not exposed here).
 */
export interface SQLiteDriverOptions {
	readonly path?: string
	readonly readonly?: boolean
	readonly timeout?: number
	readonly references?: boolean
	readonly pragmas?: Readonly<Record<string, string | number>>
}
