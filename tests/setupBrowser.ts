// Browser-test setup — environment-specific helpers loaded after `setup.ts`
// for the `src:browser` project, which runs in a real Chromium (DOM
// available, no `node:*`).

/**
 * Deletes an IndexedDB database, settling after the request reports any outcome, so a test can
 * start from a clean store.
 *
 * @param name - The database name to delete
 * @returns A promise that settles after the request reports success, error, or a block
 *
 * @remarks
 * This is deliberately NOT `removeDatabase` from `@orkestrel/test/browser`, which rejects on
 * `blocked`. That contract assumes the caller's close has fully released the connection by the
 * time its promise settles. Over this package's IndexedDB driver it does not: `Database.close()`
 * resolves before Chromium releases the connection, so a delete issued straight afterwards
 * intermittently observes `blocked`. Swapping this helper for `removeDatabase` reddened 43 of the
 * `src:browser` tests, and re-running `tests/src/browser/integration.test.ts` alone reddened 1 of
 * 72 on a case the whole-project run did not name — a race, not a fixed site. A retry loop is a
 * polling architecture and is refused, so the block is absorbed here instead. Every caller names
 * its database through {@link uniqueName}, so an incomplete delete never reaches the next test.
 *
 * One block is reproducible rather than raced: after `migrate` throws `MIGRATION`, the driver
 * leaves a connection open. That belongs to `src/browser`, not to this module.
 */
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
 * @param prefix - A readable name segment (defaults to `database-idb`)
 * @returns A name no earlier call has returned
 */
export function uniqueName(prefix = 'database-idb'): string {
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
