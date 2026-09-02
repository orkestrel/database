import type { DriverInterface } from '@src/core'
import type { SQLiteDriverOptions } from './types.js'
import { JSONDriver } from './drivers/JSONDriver.js'
import { SQLiteDriver } from './drivers/SQLiteDriver.js'

/**
 * Creates a persistent JSON-file {@link DriverInterface} for the core database layer.
 *
 * @remarks
 * Pass it to `createDatabase` from `@orkestrel/database` to run the typed
 * database against a single JSON file instead of memory — the `Database` /
 * `Table` / `Query` API is unchanged; only where the bytes live changes.
 * The driver is the reference `MemoryDriver` plus JSON-file persistence: `open` loads
 * the file, every mutation flushes the whole store back, and querying runs through
 * the core engine's `matchesQuery`. The driver implements the native `stream`
 * hook and neither `records` nor `aggregate`, so the engine answers every query
 * on either path. A missing, corrupt, or wrong-shaped file starts empty rather
 * than throwing.
 *
 * @param path - The JSON file path data is loaded from and flushed to
 * @returns A {@link DriverInterface} backed by a JSON file
 *
 * @example
 * ```ts
 * import { createDatabase } from '@orkestrel/database'
 * import { stringShape } from '@orkestrel/contract'
 * import { createJSONDriver } from '@orkestrel/database/server'
 *
 * const db = createDatabase({
 * 	driver: createJSONDriver('data/app.json'),
 * 	tables: { users: { id: stringShape(), name: stringShape() } },
 * })
 * await db.table('users').set({ id: 'u1', name: 'Ada' }) // persisted to app.json
 * ```
 */
export function createJSONDriver(path: string): DriverInterface {
	return new JSONDriver(path)
}

/**
 * Creates a trusted-mode SQLite {@link DriverInterface} for the core database layer.
 *
 * @remarks
 * Pass it to `createDatabase` from `@orkestrel/database` to run the typed
 * database against a real SQLite database — the `Database` / `Table` /
 * `Query` API is unchanged; only where the bytes live changes. Built
 * on the published `@orkestrel/sqlite` synchronous wrapper: `open` issues real
 * typed `CREATE TABLE` / `CREATE INDEX` statements (reopen-safe) plus a reserved
 * `_metadata` table for `metadata()` / `stamp()` — avoid naming a table `_metadata`.
 * Querying, paging, and aggregation run natively (`records` / `count` /
 * `aggregate` / `stream`); `transaction` and `migrate` use real `BEGIN` /
 * `COMMIT` / `ROLLBACK`, so `migrate` is atomic even mid-plan.
 *
 * @param options - The {@link SQLiteDriverOptions} bag (`path`, `readonly`,
 *   `timeout`, `references`, `pragmas`); `references` directly enables or
 *   disables foreign-key enforcement, and omission retains the upstream
 *   default; omit the whole bag for an in-memory database
 * @returns A {@link DriverInterface} backed by SQLite
 *
 * @example
 * ```ts
 * import { createDatabase } from '@orkestrel/database'
 * import { stringShape } from '@orkestrel/contract'
 * import { createSQLiteDriver } from '@orkestrel/database/server'
 *
 * const db = createDatabase({
 * 	driver: createSQLiteDriver({ path: 'data/app.sqlite' }),
 * 	tables: { users: { id: stringShape(), name: stringShape() } },
 * })
 * await db.table('users').set({ id: 'u1', name: 'Ada' }) // persisted to app.sqlite
 *
 * // Or with additional options:
 * createSQLiteDriver({ path: 'data/app.sqlite', pragmas: { journal_mode: 'WAL' } })
 * ```
 */
export function createSQLiteDriver(options?: SQLiteDriverOptions): DriverInterface {
	return new SQLiteDriver(options)
}
