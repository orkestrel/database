import type { DriverInterface } from '@src/core'
import { JSONDriver } from './drivers/JSONDriver.js'

/**
 * Create a persistent JSON-file {@link DriverInterface} for the core database layer.
 *
 * @remarks
 * Pass it to `createDatabase` from `@src/core` to run the whole typed database +
 * relations stack against a single JSON file instead of memory — the `Database` /
 * `Table` / `Query` / relations API is unchanged; only where the bytes live changes.
 * The driver is the reference `MemoryDriver` plus JSON-file persistence: `open` loads
 * the file, every mutation flushes the whole store back, and querying runs through
 * the core engine over `scan` (it is scan-only — no native `records` / `count` /
 * `aggregate`). A missing, corrupt, or wrong-shaped file starts empty rather than
 * throwing.
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
