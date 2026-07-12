import type {
	IndexedDBCursorInterface,
	IndexedDBDatabaseInterface,
	RouterInterface,
	StoresShape,
} from '@src/browser'
import { createIndexedDBDatabase, createIndexedDBDriver, IndexedDBError } from '@src/browser'
import type { DatabaseInterface, RelationManagerInterface } from '@src/core'
import { createDatabase, createMemoryDriver } from '@src/core'
import type { ChatContentKey, EntityContentKey, Organization, tables, User } from '@app/core'
import {
	createAppDatabase,
	defineAppRelations,
	SEED_ORG_ID,
	SEED_PASSWORD_HASH,
	SEED_USER_IDS,
	seedAccounts,
	seedActivities,
	seedContacts,
	seedDocuments,
	seedLocations,
	seedMemberships,
	seedTasks,
} from '@app/core'
import type { ChatData, ContentRecord, EntityData } from '@app/browser'
import type { TestRecorderInterface } from './setup.js'
import { createRecorder, INTEGRATION_TABLES, waitForDelay } from './setup.js'

// Browser-test setup — node-free helpers, loaded after `setup.ts` for the
// `src:browser` project, which runs in a real Chromium (DOM + `indexedDB`
// available). Keep it small: this surface is plain TypeScript, not a Vue
// component library, so there is no mount/fixture machinery here.

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

// ── IndexedDB test fixtures (real Chromium, real `indexedDB`) ────────────────
//
// The shared open-a-database boilerplate every `src/browser/indexeddb` (and
// `src/browser/databases`) test reuses (AGENTS §16.1): a unique database name
// per call, a connected handle over a caller-supplied store schema, and a
// cleanup that closes the connection and deletes the database — so the suite is
// order- and rerun-independent without a per-file local opener. Each test keeps
// only its file-specific store / index definitions, passed in as the schema.

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

/** A connected test database plus the boilerplate to identify and dispose it. */
export interface TestDatabaseInterface<Stores extends StoresShape> {
	/** The IndexedDB handle, already `connect`ed and ready to use. */
	readonly db: IndexedDBDatabaseInterface<Stores>
	/** The unique name the database was opened under (for reopen / drop tests). */
	readonly name: string
	/** Close the connection and delete the database. */
	cleanup(): Promise<void>
}

/**
 * Open a fresh, connected IndexedDB database over a store schema, under a unique
 * name, returning the handle and a cleanup — the shared opener for every browser
 * `indexeddb` test (AGENTS §16.1). The handle is already connected, so a test can
 * reach `db.store(...)` immediately; `cleanup` closes and deletes it.
 *
 * @param stores - The store schema (file-specific store / index definitions)
 * @param options - `version` pins an explicit schema version (omit for
 *   auto-managed mode); `prefix` names the database for readable diagnostics
 * @returns The connected database, its name, and a cleanup
 */
export async function createTestDatabase<const Stores extends StoresShape>(
	stores: Stores,
	options?: { readonly version?: number; readonly prefix?: string },
): Promise<TestDatabaseInterface<Stores>> {
	const name = uniqueName(options?.prefix)
	const db = createIndexedDBDatabase({
		name,
		version: options?.version,
		stores,
	})
	await db.connect()
	const cleanup = async (): Promise<void> => {
		db.close()
		await deleteDatabase(name)
	}
	return { db, name, cleanup }
}

/**
 * Drive a cursor chain to its end, collecting every visited cursor — the
 * assertion-friendly counterpart to a manual `while (cursor)` walk. Each step
 * uses `continue()` with no key, so it visits records in the cursor's direction.
 *
 * @param first - The first cursor (from `store.cursor()` / `index.cursor()`), or
 *   `null` for an empty source
 * @returns The cursors visited, in traversal order
 */
export async function drainCursor(
	first: IndexedDBCursorInterface | null,
): Promise<readonly IndexedDBCursorInterface[]> {
	const seen: IndexedDBCursorInterface[] = []
	let cursor = first
	while (cursor) {
		seen.push(cursor)
		cursor = await cursor.continue()
	}
	return seen
}

/**
 * The `code` of a caught value when it is an {@link IndexedDBError}, else
 * `undefined` — lets a test assert the machine-readable code without a
 * conditional `expect` around the `instanceof` narrowing.
 *
 * @param value - A caught value (the rejection / throw under test)
 * @returns The `IndexedDBError` code, or `undefined` for any other value
 */
export function errorCode(value: unknown): string | undefined {
	return value instanceof IndexedDBError ? value.code : undefined
}

// ── IndexedDB seed fixtures (the common stores every wrapper test starts from) ─
//
// The near-duplicate seed-a-`users`-store openers the `src/browser/indexeddb` tests
// reuse (AGENTS §16.1): each opens a uniquely-named database via
// {@link createTestDatabase}, sets the rows, and registers its `cleanup` through the
// caller's teardown registrar (so the file keeps its own `cleanups` array + the
// deferred async-thunk `afterEach`). The seed returns just the connected `db`.

/** Register a database cleanup with the caller's teardown — the per-file `cleanups`
 *  push, decoupled from the array so a seed helper need not know its shape. */
export type CleanupRegistrar = (cleanup: () => Promise<void>) => void

/** A teardown registrar: push disposers as a test sets them up, `run` them all in
 *  registration order. Its `push` IS a {@link CleanupRegistrar}, so a seed helper
 *  (`seedUsers` / `seedStore`) composes with `register: registrar.push`. */
export interface CleanupRegistrarInterface {
	/** Register a disposer (sync or async) to run at teardown. */
	push(disposer: () => void | Promise<void>): void
	/** Run every registered disposer once, in registration order, then forget them. */
	run(): Promise<void>
}

/**
 * Build a teardown registrar replacing the hand-rolled per-file `cleanups[]` +
 * `afterEach` loop every `indexeddb` / cross-driver `databases` test repeats
 * (AGENTS §16.1). Push disposers as a test opens resources; wire `registrar.run`
 * into an `afterEach`. Disposers run in REGISTRATION order — the order an
 * IndexedDB connection/transaction close can depend on — and are forgotten after,
 * so the registrar is reused across cases. `push` is a {@link CleanupRegistrar},
 * so `seedUsers(registrar.push)` / `seedStore(registrar.push)` compose directly.
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

/** The store schema {@link seedUsers} opens — a `users` store with a non-unique
 *  `byAge` index and a unique `byEmail` index. */
export const SEED_USER_STORES = {
	users: {
		path: 'id',
		indexes: [
			{ name: 'byAge', path: 'age' },
			{ name: 'byEmail', path: 'email', unique: true },
		],
	},
} as const satisfies StoresShape

/** The store schema {@link seedStore} opens — a plain `users` store keyed by `id`. */
export const SEED_STORE_STORES = {
	users: { path: 'id' },
} as const satisfies StoresShape

/**
 * Seed a `users` store keyed by `id` with a non-unique `byAge` index and a unique
 * `byEmail` index, three rows spanning ages 20/30/40 — the richer index-bearing seed
 * most `IndexedDBIndex` reads need. Registers its cleanup through `register`.
 *
 * @param register - Receives the database cleanup to run at teardown
 * @returns The connected database, already holding the three rows
 */
export async function seedUsers(
	register: CleanupRegistrar,
): Promise<IndexedDBDatabaseInterface<typeof SEED_USER_STORES>> {
	const { db, cleanup } = await createTestDatabase(SEED_USER_STORES)
	register(cleanup)
	await db.store('users').set([
		{ id: 'a', age: 20, email: 'a@x.io' },
		{ id: 'b', age: 30, email: 'b@x.io' },
		{ id: 'c', age: 40, email: 'c@x.io' },
	])
	return db
}

/**
 * Seed a plain `users` store keyed by `id` (no secondary index) with three numbered
 * rows `{ id, n }` (n = 1/2/3) — the minimal seed the `IndexedDBCursor` walks/mutates.
 * Registers its cleanup through `register`.
 *
 * @param register - Receives the database cleanup to run at teardown
 * @returns The connected database, already holding the three rows
 */
export async function seedStore(
	register: CleanupRegistrar,
): Promise<IndexedDBDatabaseInterface<typeof SEED_STORE_STORES>> {
	const { db, cleanup } = await createTestDatabase(SEED_STORE_STORES)
	register(cleanup)
	await db.store('users').set([
		{ id: 'a', n: 1 },
		{ id: 'b', n: 2 },
		{ id: 'c', n: 3 },
	])
	return db
}

// ── Cross-driver database fixture (the core stack over the IndexedDB driver) ──
//
// The fresh-name + open-over-`INTEGRATION_TABLES` + cleanup opener the cross-driver
// `databases/integration` test reuses (AGENTS §16.1): it binds `createIndexedDBDriver`
// to the core `createDatabase` over the shared `INTEGRATION_TABLES` (tests/setup.ts),
// returning the handle, its name (for a reopen test), and a cleanup that closes the
// connection and deletes the database.

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
 * Open the core database + relations stack over the IndexedDB driver, under a unique
 * name, returning the handle, its name, and a cleanup — the shared opener for the
 * cross-driver integration test. The same `INTEGRATION_TABLES` fixture the SQLite
 * integration test uses, so the two prove driver-parity over identical tables.
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

// ── SPA router fixtures (the hash-driven Router teardown + render helpers) ─────
//
// The shared scenario/teardown helpers the `src/browser/router` tests reuse (AGENTS
// §16.1): the identical destroy-all teardown, the set-hash-and-settle pause, and the
// `data-page`/`data-params` render fn that proves the engine-decoded params reached
// `render`. Real `location.hash` + `hashchange`, no mocks (§16.2).

/**
 * Destroy and forget every router a test tracked, removing each `hashchange`
 * listener so none leaks across cases — the shared `beforeEach`/`afterEach` teardown
 * (the array is emptied in place). A `beforeEach` additionally resets the hash and
 * awaits a macrotask to drain any pending async `hashchange` into a quiescent `#''`.
 *
 * @param routers - The tracked routers to tear down (emptied in place)
 */
export function drainRouters(routers: RouterInterface[]): void {
	while (routers.length > 0) routers.pop()?.destroy()
}

/**
 * Set `window.location.hash` and let its ASYNC `hashchange` flush (a macrotask)
 * BEFORE any router is listening — so a test counting `navigate` emissions sees only
 * the router's own synchronous resolve(s), not a spurious replay of the initial hash.
 *
 * @param value - The hash to set (e.g. `'#/tokens'`)
 */
export async function settleHash(value: string): Promise<void> {
	window.location.hash = value
	await waitForDelay()
}

/**
 * A route render fn that tags its page with `data-page=<name>` and serializes the
 * engine-decoded params into `data-params` — the only way to prove the matcher's
 * decoded params actually REACHED `render` (not just `active`). Query the outlet for
 * the `[data-page]` node and read `data-params` to assert. Built with plain DOM
 * APIs (`document.createElement`) — the router renders a `Node`, no hyperscript.
 *
 * @param name - The page name to tag (`data-page`)
 * @returns A render fn `(params) => Node` for a `Route.render`
 */
export function createRoutePage(name: string): (params: Readonly<Record<string, string>>) => Node {
	return (params) => {
		const node = document.createElement('div')
		node.dataset.page = name
		node.dataset.params = JSON.stringify(params)
		node.textContent = name
		return node
	}
}

// ── Console capture (swap + restore the three console methods) ────────────────

/** The three captured console methods plus the restore — a real call-recording
 *  swap (AGENTS §16.1), not a framework spy. */
export interface ConsoleCaptureInterface {
	/** `console.log`'s recorded `(format, ...styles)` calls. */
	readonly log: TestRecorderInterface<readonly [format: string, ...styles: string[]]>
	/** `console.warn`'s recorded calls. */
	readonly warn: TestRecorderInterface<readonly [format: string, ...styles: string[]]>
	/** `console.error`'s recorded calls. */
	readonly error: TestRecorderInterface<readonly [format: string, ...styles: string[]]>
	/** Restore the original `console.log` / `warn` / `error`. */
	restore(): void
}

/**
 * Swap `console.log` / `warn` / `error` for recording callbacks and return them plus
 * a `restore` — a real call-recording capture (AGENTS §16.1), not a framework mock,
 * so a console sink test can assert the exact `(format, ...styles)` tuples each
 * method received. Call `restore()` in an `afterEach` so no swap leaks.
 *
 * @returns The three method recorders and a `restore` to put the originals back
 */
export function captureConsole(): ConsoleCaptureInterface {
	const original = {
		log: console.log,
		warn: console.warn,
		error: console.error,
	}
	const log = createRecorder<readonly [string, ...string[]]>()
	const warn = createRecorder<readonly [string, ...string[]]>()
	const error = createRecorder<readonly [string, ...string[]]>()
	console.log = log.handler
	console.warn = warn.handler
	console.error = error.handler
	const restore = (): void => {
		console.log = original.log
		console.warn = original.warn
		console.error = original.error
	}
	return { log, warn, error, restore }
}

// ── App/core domain database fixture (the shared DB + relations the browser stores
//    project over) ─────────────────────────────────────────────────────────────────
//
// The shared opener the ContentStore / ApplicationController browser tests reuse (AGENTS
// §16.1): one in-memory `createAppDatabase` + `defineAppRelations`, optionally pre-seeded
// with the deterministic @app/core fixtures (the account → location → document graph +
// contacts), so a domain-projection test has real rows to derive from. A MemoryDriver
// keeps it fast and hermetic — no IndexedDB teardown.

/** The shared app/core database + its relation manager, for a domain-projection test. */
export interface DomainDatabaseInterface {
	/** The in-memory app database (`createAppDatabase`). */
	readonly database: DatabaseInterface<typeof tables>
	/** The relation manager over it (`defineAppRelations`). */
	readonly relations: RelationManagerInterface<typeof tables>
}

/**
 * Open the shared app/core database + relations over an in-memory driver, optionally
 * pre-seeded with the deterministic fixtures — the opener every ContentStore /
 * ApplicationController domain / capability-loop test starts from (AGENTS §16.1). With `seed`
 * false the DB is empty (for a not-found / empty projection); true loads the FULL graph — the
 * identity rows (org / users / memberships), the account → location → document graph + contacts,
 * the activity timeline, and the task follow-ups — so the harness spine the app talks to (the
 * SERVER's role in production) has the same seeded data the real server seeds, and a `scope:
 * 'mine'` list / `account.assign` reassignment / task status flip has real rows to act on. The
 * graph is owned by the @app/core seed owner membership (`mem-ada`, an `admin` of `SEED_ORG_ID`),
 * which the browser's `#userPrincipal` placeholder matches.
 *
 * @param options - `seed` (default `true`) loads the @app/core seed fixtures (the full graph)
 * @returns The shared database + relation manager
 */
export async function createDomainDatabase(options?: {
	readonly seed?: boolean
}): Promise<DomainDatabaseInterface> {
	const database = createAppDatabase(createMemoryDriver())
	const relations = defineAppRelations(database)
	if (options?.seed !== false) {
		// The full identity + CRM + timeline graph in ONE pass — the org / users the memberships
		// reference, then the membership rows, then the CRM graph + activities + tasks. The org / user
		// rows have no @app/core seed fixture (they are server-seeded in production), so they are built
		// here from the same `SEED_ORG_ID` / `SEED_USER_IDS` the memberships key on.
		await database.table('organizations').add(seedDomainOrganizations())
		await database.table('users').add(seedDomainUsers())
		await database.table('memberships').add(seedMemberships())
		await database.table('accounts').add(seedAccounts())
		await database.table('contacts').add(seedContacts())
		await database.table('locations').add(seedLocations())
		await database.table('documents').add(seedDocuments())
		await database.table('activities').add(seedActivities())
		await database.table('tasks').add(seedTasks())
	}
	return { database, relations }
}

/**
 * The seed organization rows — ONE org (`SEED_ORG_ID`) the seeded memberships belong to
 * (AGENTS §16.1). There is no @app/core org fixture (the org is server-seeded in production), so
 * the browser test spine builds it here to match `seedMemberships`' `organizationId`.
 *
 * @returns A single-org array keyed by `SEED_ORG_ID`
 */
export function seedDomainOrganizations(): readonly Organization[] {
	return [{ id: SEED_ORG_ID, name: 'Taverna Demo', createdAt: 0, updatedAt: 0 }]
}

/**
 * The seed domain user rows — one per `SEED_USER_IDS` member (AGENTS §16.1), so the seeded
 * memberships reference real users. Built here (no @app/core user fixture — users are
 * server-seeded) with the shared `SEED_PASSWORD_HASH` placeholder. Named `seedDomainUsers` to
 * stay distinct from the IndexedDB-store `seedUsers` fixture above.
 *
 * @returns The seed users (`usr-ada` / `usr-grace`)
 */
export function seedDomainUsers(): readonly User[] {
	return SEED_USER_IDS.map((id, index) => ({
		id,
		email: `${id}@taverna.example`,
		name: index === 0 ? 'Ada Lovelace' : 'Grace Hopper',
		passwordHash: SEED_PASSWORD_HASH,
		status: 'active',
		createdAt: 0,
		updatedAt: 0,
	}))
}

/**
 * Build an entity {@link EntityContentKey} over a row id — the shared content-key builder
 * every browser store / controller / helper test keys its entity fixtures with (AGENTS
 * §16.1; one builder, never a per-file literal).
 *
 * @param key - The row id the key addresses
 * @param table - The plural DB table name (defaults to `accounts`)
 * @returns The entity content key
 */
export function entityKey(key: string, table = 'accounts'): EntityContentKey {
	return { source: 'entity', table, key }
}

/**
 * Build a chat {@link ChatContentKey} over a stream id — the shared content-key builder
 * every browser store / controller test keys its chat fixtures with (AGENTS §16.1).
 *
 * @param stream - The chat stream id
 * @returns The chat content key
 */
export function chatKey(stream: string): ChatContentKey {
	return { source: 'chat', stream }
}

/**
 * Narrow a content record's data to {@link EntityData}, throwing if it is not an entity
 * record — the unconditional accessor a domain-projection test reads `title` / `relations`
 * through, so the assertion never sits inside an `if` (AGENTS §16; the
 * `no-conditional-expect` rule). Throws a descriptive error when the record is missing or
 * not an entity, surfacing the real shape rather than a silent skip.
 *
 * @param record - The content record under test
 * @returns Its data narrowed to {@link EntityData}
 */
export function entityData(record: ContentRecord | undefined): EntityData {
	if (record === undefined) throw new Error('expected an entity content record, got undefined')
	if (record.data.renderer !== 'entity') {
		throw new Error(`expected an entity record, got renderer '${record.data.renderer}'`)
	}
	return record.data
}

/**
 * Narrow a content record's data to {@link ChatData}, throwing if it is not a chat record —
 * the unconditional accessor a chat test reads `messages` / `streaming` through (the
 * `entityData` counterpart), so the assertion never sits inside an `if` (AGENTS §16; the
 * `no-conditional-expect` rule).
 *
 * @param record - The content record under test
 * @returns Its data narrowed to {@link ChatData}
 */
export function chatData(record: ContentRecord | undefined): ChatData {
	if (record === undefined) throw new Error('expected a chat content record, got undefined')
	if (record.data.renderer !== 'chat') {
		throw new Error(`expected a chat record, got renderer '${record.data.renderer}'`)
	}
	return record.data
}
