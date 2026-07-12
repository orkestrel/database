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

/** Register a database cleanup with the caller's teardown — the per-file `cleanups`
 *  push, decoupled from the array so a seed helper need not know its shape. */
export type CleanupRegistrar = (cleanup: () => Promise<void>) => void

/** A teardown registrar: push disposers as a test sets them up, `run` them all in
 *  registration order. Its `push` IS a {@link CleanupRegistrar}, so a seed helper
 *  composes with `register: registrar.push`. */
export interface CleanupRegistrarInterface {
	/** Register a disposer (sync or async) to run at teardown. */
	push(disposer: () => void | Promise<void>): void
	/** Run every registered disposer once, in registration order, then forget them. */
	run(): Promise<void>
}

/**
 * Build a teardown registrar replacing a hand-rolled per-file `cleanups[]` +
 * `afterEach` loop (AGENTS §16.1). Push disposers as a test opens resources; wire
 * `registrar.run` into an `afterEach`. Disposers run in REGISTRATION order and are
 * forgotten after, so the registrar is reused across cases.
 *
 * @returns A registrar with `push(disposer)` and `run()`
 */
export function createCleanups(): CleanupRegistrarInterface {
	const disposers: Array<() => void | Promise<void>> = []
	return {
		push(disposer) {
			disposers.push(disposer)
		},
		async run() {
			for (const disposer of disposers.splice(0)) await disposer()
		},
	}
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
 * Open the core database + relations stack over the IndexedDB driver, under a
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
	const cleanup = async (): Promise<void> => {
		await db.close()
		await deleteDatabase(name)
	}
	return { db, name, cleanup }
}
