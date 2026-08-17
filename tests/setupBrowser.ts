// Browser-test setup — environment-specific helpers loaded after `setup.ts`
// for the `src:browser` project, which runs in a real Chromium (DOM
// available, no `node:*`).

import type { DatabaseInterface } from '@src/core'
import { createDatabase } from '@src/core'
import { createIndexedDBDriver } from '@src/browser'
import { INTEGRATION_TABLES } from './setup.js'

// Delete an IndexedDB database, resolving once the request settles, so a test
// can start from a clean store. Resolves even when the delete is blocked by an
// open connection (the caller closes its databases first).
export function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve) => {
		const request = globalThis.indexedDB.deleteDatabase(name)
		request.onsuccess = () => resolve()
		request.onerror = () => resolve()
		request.onblocked = () => resolve()
	})
}

let databaseCounter = 0

/**
 * A process-unique IndexedDB database name — a monotonic counter under an
 * optional prefix, so concurrent tests never collide on a shared store.
 *
 * @param prefix - A readable name segment (defaults to `taverna-idb`)
 * @returns A name no earlier call has returned
 */
export function uniqueName(prefix = 'taverna-idb'): string {
	databaseCounter += 1
	return `${prefix}-${databaseCounter}`
}

/**
 * Persist an arbitrary value through a real native IndexedDB transaction.
 *
 * @remarks
 * Corruption-boundary tests need to seed values outside the wrapper's typed row
 * contract. The native API is the storage boundary under test, and awaiting the
 * transaction completion ensures the value is durable before a wrapper opens it.
 *
 * @param database - The connected native database
 * @param store - The object-store name
 * @param key - The durable record key
 * @param value - The arbitrary value to persist
 * @returns A promise that settles with the native transaction
 */
export function putIndexedDBValue(
	database: IDBDatabase,
	store: string,
	key: IDBValidKey,
	value: unknown,
): Promise<void> {
	const transaction = database.transaction(store, 'readwrite')
	transaction.objectStore(store).put(value, key)
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error)
		transaction.onabort = () => reject(transaction.error)
	})
}

// ── Cross-driver database fixture (the core stack over the IndexedDB driver) ──

/** A core `Database` over the IndexedDB driver plus the boilerplate to name and
 *  dispose it — the cross-driver integration fixture. */
export interface IntegrationDatabaseInterface {
	/** The core `Database`, opened over `INTEGRATION_TABLES` via the IndexedDB driver. */
	readonly db: DatabaseInterface<typeof INTEGRATION_TABLES>
	/** The unique IndexedDB name the database was opened under (for reopen tests). */
	readonly name: string
	/** Close the connection and delete the underlying IndexedDB database. */
	cleanup(): Promise<void>
}

/**
 * Open the core database over the IndexedDB driver, under a
 * unique name, returning the handle, its name, and a cleanup — the shared opener
 * for the cross-driver integration test.
 *
 * @returns The connected database, its IndexedDB name, and a cleanup
 */
export function createIntegrationDatabase(): IntegrationDatabaseInterface {
	const name = uniqueName('taverna-idb-int')
	const db = createDatabase({
		driver: createIndexedDBDriver(name),
		tables: INTEGRATION_TABLES,
	})
	return {
		db,
		name,
		async cleanup(): Promise<void> {
			await db.close()
			await deleteDatabase(name)
		},
	}
}
