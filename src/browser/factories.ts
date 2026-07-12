import type { DriverInterface } from '@src/core'
import { IndexedDBDriver } from './drivers/IndexedDBDriver.js'

/**
 * Create a persistent IndexedDB {@link DriverInterface} for the core database layer.
 *
 * @remarks
 * Pass it to `createDatabase` from `@orkestrel/database` to run the whole typed database +
 * relations stack against IndexedDB instead of memory — the `Database` / `Table` /
 * `Query` / relations API is unchanged; only where the bytes live changes. The
 * driver is built on the published `@orkestrel/indexeddb` wrapper in auto-managed
 * mode, so a table added to the `tables` map is created on the next open with no
 * version bump. This unit omits `transaction` / `migrate` / `meta` / `stamp` /
 * `aggregate` (see {@link IndexedDBDriver} `@remarks`).
 *
 * @param name - The IndexedDB database name to open or create
 * @returns A {@link DriverInterface} backed by IndexedDB
 *
 * @example
 * ```ts
 * import { createDatabase } from '@orkestrel/database'
 * import { stringShape } from '@orkestrel/contract'
 * import { createIndexedDBDriver } from '@orkestrel/database/browser'
 *
 * const db = createDatabase({
 * 	driver: createIndexedDBDriver('app'),
 * 	tables: { users: { id: stringShape(), name: stringShape() } },
 * })
 * await db.table('users').set({ id: 'u1', name: 'Ada' }) // persisted to IndexedDB
 * ```
 */
export function createIndexedDBDriver(name: string): DriverInterface {
	return new IndexedDBDriver(name)
}
