import type { UserRow } from '../../../setup.js'
import type { DriverInterface, Row, TableSchema, TableInterface } from '@src/core'
import {
	applyQuery,
	captureFailure,
	computeAggregate,
	CONFORMANCE_POSTS_SCHEMA,
	CONFORMANCE_READS,
	CONFORMANCE_ROWS,
	CONFORMANCE_USERS_SCHEMA,
	conformDriver,
	createDatabase,
	createMemoryDriver,
	extractKey,
	filterRows,
	isDatabaseError,
	readPlannedAggregate,
	readPlannedRows,
	StorageJournal,
	StorageRecorder,
	tallyCalls,
} from '@src/core'
import {
	createIndexedDBDriver,
	deriveIndexedDBIndexName,
	IndexedDBDriver,
	schemaToStore,
	STREAM_BATCH_SIZE,
} from '@src/browser'
import { createIndexedDBDatabase, promisifyRequest } from '@orkestrel/indexeddb'
import { integerShape, jsonShape, shapeShape, stringShape } from '@orkestrel/contract'
import { collect } from '@orkestrel/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	createDoorTable,
	ILL_FORMED_RESULT,
	readIllFormedText,
	buildCondition,
	tableSchemas,
	DatabaseCounter,
	DatabaseFixture,
	completeFixture,
	createAbortingRow,
	createRecordedUsers,
	EMPTY_STORAGE_CASES,
	EMPTY_TABLE_CASES,
} from '../../../setup.js'
import type { ItemRow } from '../../../setupBrowser.js'
import {
	ABSENT_ROWS,
	ABSENT_SCHEMA,
	armVersionBump,
	buildItem,
	buildItems,
	COLLISION_SCHEMA,
	CONFORMANCE_ROWS_READ,
	deleteDatabase,
	ITEM_READS,
	ITEMS,
	LISTED_PAGES,
	mintDatabase,
	PEOPLE,
	putIndexedDBValue,
	putTripwire,
	readIndexedDBValue,
	readStoredIndexes,
	REVERSED_SCHEMA,
	seedItems,
	TRIPWIRE_CASES,
} from '../../../setupBrowser.js'

// The IndexedDB DriverInterface implementation, exercised directly in real
// Chromium — the storage primitives the core database layer builds on,
// delegating to the published `@orkestrel/indexeddb` wrapper, schema-driven
// secondary index creation, and the native records / count / stream pushdown
// hooks.

const counter = new DatabaseCounter()
const name = new DatabaseFixture<string>()
const driver = new DatabaseFixture<DriverInterface>()

beforeEach(async () => {
	counter.next()
	name.hold(`database-idbdriver-${counter.count}`)
	await deleteDatabase(name.value)
	driver.clear()
	driver.hold(createIndexedDBDriver(name.value))
	await driver.value.open(tableSchemas('users'))
})

describe('IndexedDBDriver — abort while the shared lazy open is blocked', () => {
	it('rejects promptly and never dispatches the row mutation after readiness later settles', async () => {
		const blockedName = mintDatabase('database-idbdriver-blocked')
		const blocker = createIndexedDBDatabase({ name: blockedName, version: 1, stores: {} })
		await blocker.connect()
		const changed = Promise.withResolvers<void>()
		blocker.database.addEventListener('versionchange', () => changed.resolve(), { once: true })
		const database = createDatabase({
			driver: createIndexedDBDriver(blockedName),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const users = database.table('users')
		const controller = new AbortController()
		const writing = users.set({ id: 'u1', name: 'Ada' }, { signal: controller.signal })
		await changed.promise
		controller.abort('stop waiting')
		const error = await writing.catch((caught: unknown) => caught).finally(() => blocker.close())
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('ABORTED')
		await database.open()
		expect(await users.get('u1')).toBeUndefined()
		await database.close()
		await deleteDatabase(blockedName)
	})
})

afterEach(async () => {
	await driver.value.close()
	await deleteDatabase(name.value)
	driver.clear()
	name.clear()
})

// The shared driver-conformance battery over this backend. `conformDriver` (`@src/core`) owns the
// schema, the required-primitive checks, and the presence-gated optional-hook coverage (migrate /
// stream / transaction); each backend suite registers its own case.
describe('driver conformance — IndexedDBDriver', () => {
	it('conforms to DriverInterface', async () => {
		await expect(
			conformDriver(() => createIndexedDBDriver(mintDatabase('database-idbdriver-conform'))),
		).resolves.toBeUndefined()
	})
})

describe('IndexedDBDriver — storage primitives over the wrapper', () => {
	it('round-trips a shape-valued column through a real table', async () => {
		const databaseName = mintDatabase('database-shape-column')
		const database = createDatabase({
			driver: createIndexedDBDriver(databaseName),
			tables: { definitions: { id: stringShape(), definition: shapeShape() } },
		})
		try {
			await database.open()
			const definitions = database.table('definitions')
			const row = { id: 'profile', definition: stringShape() }
			await definitions.set(row)
			expect(await definitions.get('profile')).toEqual(row)
		} finally {
			await database.close()
			await deleteDatabase(databaseName)
		}
	})
	it('answers native reads inside a journal scope with its writes, and restores on rejection', async () => {
		const databaseName = mintDatabase('database-journal-scope')
		const database = createDatabase({
			driver: createIndexedDBDriver(databaseName),
			tables: { users: { id: stringShape(), age: integerShape() } },
		})
		try {
			const users = database.table('users')
			await users.set([
				{ id: 'u1', age: 30 },
				{ id: 'u2', age: 40 },
			])
			const adults = { conditions: [buildCondition('age', 'from', [35])] }
			const reason = new Error('scope failed')
			const seen = Promise.withResolvers<number>()
			await expect(
				database.transaction(async (transaction) => {
					const scoped = transaction.table('users')
					await scoped.set({ id: 'u3', age: 50 })
					await scoped.update('u1', { age: 36 })
					seen.resolve(await scoped.count(adults))
					throw reason
				}),
			).rejects.toBe(reason)
			expect(await seen.promise).toBe(3)
			expect(await users.count(adults)).toBe(1)
			expect(await users.keys()).toEqual(['u1', 'u2'])
		} finally {
			await database.close()
			await deleteDatabase(databaseName)
		}
	})

	it('reads back what it writes; misses are undefined / false', async () => {
		await driver.value.write('users', 'u1', { id: 'u1', n: 1 })
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
		expect(await driver.value.read('users', 'missing')).toBeUndefined()
		expect(await driver.value.delete('users', 'missing')).toBe(false)
		expect(await driver.value.delete('users', 'u1')).toBe(true)
		expect(await driver.value.read('users', 'u1')).toBeUndefined()
	})

	it('atomically inserts one row when the same key is submitted concurrently', async () => {
		const outcomes = await Promise.all([
			driver.value.insert('users', 'u1', { id: 'u1', name: 'Ada' }).then(
				() => 'fulfilled',
				(error: unknown) => (isDatabaseError(error) ? error.code : 'unexpected'),
			),
			driver.value.insert('users', 'u1', { id: 'u1', name: 'Grace' }).then(
				() => 'fulfilled',
				(error: unknown) => (isDatabaseError(error) ? error.code : 'unexpected'),
			),
		])
		expect([...outcomes].sort()).toEqual(['CONFLICT', 'fulfilled'])
		expect(await driver.value.keys('users')).toEqual(['u1'])
		expect(['Ada', 'Grace']).toContain((await driver.value.read('users', 'u1'))?.name)
	})

	it('rejects pre-aborted and actively aborted inserts without storing a row', async () => {
		const before = new AbortController()
		before.abort('stop before insert')
		await expect(
			driver.value.insert('users', 'before', { id: 'before' }, { signal: before.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await driver.value.read('users', 'before')).toBeUndefined()

		const active = new AbortController()
		const row = createAbortingRow(active, 'stop active insert')
		await expect(
			driver.value.insert('users', 'active', row, { signal: active.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await driver.value.read('users', 'active')).toBeUndefined()
	})

	it('lists keys and scans in key order, and clears', async () => {
		await driver.value.write('users', 'a', { id: 'a' })
		await driver.value.write('users', 'b', { id: 'b' })
		expect(await driver.value.keys('users')).toEqual(['a', 'b'])
		expect((await collect(driver.value.scan('users'))).map((row) => row.id)).toEqual(['a', 'b'])
		await driver.value.clear('users')
		expect(await driver.value.keys('users')).toEqual([])
	})

	it('aborts an active write transaction and rolls the row back', async () => {
		const controller = new AbortController()
		const row = createAbortingRow(controller, 'stop active write')
		const writing = driver.value.write('users', 'active', row, { signal: controller.signal })
		await expect(writing).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await driver.value.read('users', 'active')).toBeUndefined()
	})

	it('leaves a row intact when delete is aborted before native dispatch', async () => {
		// The public driver surface exposes no lifecycle point between delete's
		// presence read and remove request. Keep this proof deterministic rather
		// than inferring an active boundary from a timer or payload size.
		await driver.value.write('users', 'u1', { id: 'u1', n: 1 })
		const controller = new AbortController()
		controller.abort('stop before delete')
		await expect(
			driver.value.delete('users', 'u1', { signal: controller.signal }),
		).rejects.toMatchObject({
			code: 'ABORTED',
		})
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('does not let a late abort convert a completed transaction success', async () => {
		const controller = new AbortController()
		await driver.value.write('users', 'u1', { id: 'u1', n: 1 }, { signal: controller.signal })
		controller.abort('too late')
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('creates a new store on reopen with more tables (auto-managed version)', async () => {
		await driver.value.open(tableSchemas('users', 'posts'))
		await driver.value.write('posts', 'p1', { id: 'p1', title: 'Hello' })
		expect(await driver.value.read('posts', 'p1')).toEqual({ id: 'p1', title: 'Hello' })
	})

	it('opens only the persisted deployed schema before migration', async () => {
		const users = tableSchemas('users')
		const metadata = { version: 1, schema: users }
		await driver.value.stamp?.(metadata)
		await driver.value.close()

		const reopened = createIndexedDBDriver(name.value)
		await reopened.open(tableSchemas('users', 'posts'))
		const planned =
			reopened.records === undefined
				? Promise.resolve(undefined)
				: reopened.records('posts', { conditions: [] })
		const error = await planned.catch((caught: unknown) => caught)
		const stored = await reopened.metadata?.()

		const wrapper = createIndexedDBDatabase({
			name: name.value,
			stores: { __metadata__: {}, users: {} },
		})
		await wrapper.connect()
		const stores = wrapper.stores
		wrapper.close()
		await reopened.close()

		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('NOT_FOUND')
		expect(stores).not.toContain('posts')
		expect(stored).toEqual(metadata)
	})

	it('fails closed when persisted stores are missing and retries after external repair', async () => {
		const schema = tableSchemas('users', 'posts')
		await driver.value.open(schema)
		await driver.value.stamp?.({ version: 1, schema })
		await driver.value.close()

		const inspected = createIndexedDBDatabase({
			name: name.value,
			stores: { __metadata__: {}, users: {}, posts: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()
		const damaged = createIndexedDBDatabase({
			name: name.value,
			version: version + 1,
			stores: { __metadata__: {}, users: {}, posts: {}, audit: {} },
			upgrade: (context) => {
				context.stores.drop('users')
				context.stores.drop('posts')
			},
		})
		await damaged.connect()
		await damaged.store('audit').set({ retained: true }, 'entry')
		const damagedVersion = damaged.version
		damaged.close()

		await expect(driver.value.open(schema)).rejects.toMatchObject({
			code: 'DRIVER',
			message: 'Stored IndexedDB store is missing',
			context: {
				name: name.value,
				store: 'users',
				aspect: 'missing',
			},
		})
		await expect(driver.value.metadata?.()).rejects.toMatchObject({
			code: 'CLOSED',
			context: { name },
		})

		const physical = createIndexedDBDatabase({
			name: name.value,
			version: damagedVersion,
			stores: { __metadata__: {}, audit: {} },
		})
		await physical.connect()
		expect(physical.stores).not.toContain('users')
		expect(physical.stores).not.toContain('posts')
		expect(await physical.store('audit').get('entry')).toEqual({ retained: true })
		expect(await physical.store('__metadata__').has('metadata')).toBe(true)
		physical.close()

		const repaired = createIndexedDBDatabase({
			name: name.value,
			version: damagedVersion + 1,
			stores: {
				__metadata__: {},
				audit: {},
				...Object.fromEntries(schema.map((table) => [table.name, schemaToStore(table)])),
			},
		})
		await repaired.connect()
		const repairedVersion = repaired.version
		repaired.close()

		await driver.value.open(schema)
		await driver.value.write('users', 'u1', { id: 'u1', repaired: true })
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1', repaired: true })
		const reopened = createIndexedDBDatabase({
			name: name.value,
			version: repairedVersion,
			stores: { __metadata__: {}, users: {}, posts: {}, audit: {} },
		})
		await reopened.connect()
		expect(reopened.version).toBe(repairedVersion)
		expect(await reopened.store('audit').get('entry')).toEqual({ retained: true })
		reopened.close()
	})

	it('pins persisted reopening to the observed version across a competing versionchange', async () => {
		const schema = tableSchemas('users')
		await driver.value.stamp?.({ version: 1, schema })
		await driver.value.close()

		const inspected = createIndexedDBDatabase({
			name: name.value,
			stores: { __metadata__: {}, users: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()

		const opening = driver.value.open(schema).catch((caught: unknown) => caught)
		const external = createIndexedDBDatabase({
			name: name.value,
			version: version + 1,
			stores: { __metadata__: {}, users: {}, external: {} },
		})
		await external.connect()
		const changedVersion = external.version
		external.close()
		const error = await opening
		expect(error).toMatchObject({
			code: 'DRIVER',
			context: { cause: { code: 'OPEN' } },
		})
		await expect(driver.value.metadata?.()).rejects.toMatchObject({
			code: 'CLOSED',
			context: { name },
		})

		await driver.value.open(schema)
		await driver.value.write('users', 'u1', { id: 'u1', resumed: true })
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1', resumed: true })
		const reopened = createIndexedDBDatabase({
			name: name.value,
			version: changedVersion,
			stores: { __metadata__: {}, users: {}, external: {} },
		})
		await reopened.connect()
		expect(reopened.version).toBe(changedVersion)
		expect(reopened.stores).toContain('external')
		reopened.close()
	})

	it('reads a key list in one transaction, in its order, with undefined for each miss', async () => {
		await driver.value.write(
			'users',
			['a', 'b'],
			[
				{ id: 'a', n: 1 },
				{ id: 'b', n: 2 },
			],
		)
		expect(await driver.value.read('users', ['b', 'missing', 'a'])).toEqual([
			{ id: 'b', n: 2 },
			undefined,
			{ id: 'a', n: 1 },
		])
	})

	it('inserts no listed row when the final member conflicts', async () => {
		await driver.value.write('users', 'a', { id: 'a', n: 1 })
		await expect(
			driver.value.insert('users', ['b', 'c', 'a'], [{ id: 'b' }, { id: 'c' }, { id: 'a' }]),
		).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(await driver.value.keys('users')).toEqual(['a'])
	})

	it('deletes a key list in one transaction, reporting each stored key once', async () => {
		await driver.value.write('users', ['a', 'b'], [{ id: 'a' }, { id: 'b' }])
		expect(await driver.value.delete('users', ['a', 'missing', 'a'])).toEqual([true, false, false])
		expect(await driver.value.keys('users')).toEqual(['b'])
	})

	it('persists across close and reopen', async () => {
		await driver.value.write('users', 'u1', { id: 'u1', name: 'Ada' })
		await driver.value.close()
		const reopened = createIndexedDBDriver(name.value)
		await reopened.open(tableSchemas('users'))
		expect(await reopened.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
		await reopened.close()
	})

	it('creates the declared secondary indexes from the schema', async () => {
		// A FRESH name so the store is created WITH its indexes (indexes are only
		// built at store-creation time).
		const indexed = `database-idbdriver-index-${counter}`
		await deleteDatabase(indexed)
		const driverWithIndex = createIndexedDBDriver(indexed)
		await driverWithIndex.open([
			{
				name: 'people',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'age', storage: 'integer', optional: false, nullable: false },
					{ name: 'city', storage: 'text', optional: false, nullable: false },
				],
				indexes: [['age'], ['city', 'age']],
			},
		])
		await driverWithIndex.write('people', 'p1', { id: 'p1', age: 30, city: 'NYC' })
		await driverWithIndex.write('people', 'p2', { id: 'p2', age: 41, city: 'LA' })

		// Open the SAME database through the wrapper directly, declaring the same
		// indexes so `store.index(...)` is reachable. The compound `['city', 'age']`
		// index is named by using `deriveIndexedDBIndexName` — a length-prefixed encoding, NOT the
		// naive `'city_age'` join, so it can never collide with a single-column
		// index over a column literally named `city_age` (AGENTS/Unit 6).
		const compoundName = deriveIndexedDBIndexName(['city', 'age'])
		await driverWithIndex.close()
		const wrapper = createIndexedDBDatabase({
			name: indexed,
			stores: {
				people: {
					indexes: [
						{ name: 'age', path: 'age' },
						{ name: compoundName, path: ['city', 'age'] },
					],
				},
			},
		})
		await wrapper.connect()

		// NON-TAUTOLOGICAL existence proof: read the LIVE IDBObjectStore.indexNames.
		const live = wrapper.database.transaction(['people'], 'readonly').objectStore('people')
		expect([...live.indexNames].sort()).toEqual(['age', compoundName].sort())

		// And a real indexed READ exercises the live IDBIndex.
		expect((await wrapper.store('people').index('age').get(41))?.id).toBe('p2')

		wrapper.close()
		await deleteDatabase(indexed)
	})
})

describe('IndexedDBDriver — Database integration', () => {
	it('shares imported schema, raises on a nonconforming row, binds raw keys, and reopens the union', async () => {
		const composed = mintDatabase('database-idb-composed')
		await deleteDatabase(composed)
		const firstDriver = createIndexedDBDriver(composed)
		const first = createDatabase({
			driver: firstDriver,
			tables: { users: { id: stringShape(), name: stringShape({ min: 1 }) } },
			version: 1,
		})
		const logs = first.import({ logs: { id: stringShape(), message: stringShape() } })
		const users = first.table('users')
		try {
			await first.open()
			await firstDriver.write('users', 'a', { id: 'unbound-a', name: '' })
			await firstDriver.write('users', 'b', { id: 'unbound-b', name: 'Valid' })
			await logs.table('logs').set({ id: 'l1', message: 'started' })
			await expect(users.records({ limit: 1 })).rejects.toMatchObject({
				code: 'DRIVER',
				context: { table: 'users', key: 'a' },
			})
			await expect(collect(users.scan({ limit: 1 }))).rejects.toMatchObject({ code: 'DRIVER' })
			expect(await users.records({ offset: 1 })).toEqual([{ id: 'b', name: 'Valid' }])
			expect(await users.count()).toBe(2)
			const diagnostic = await users
				.set({ id: 'payload-secret', name: '' })
				.catch((caught: unknown) => caught)
			expect(JSON.stringify(diagnostic)).not.toContain('payload-secret')
			expect(await users.get('b')).toEqual({ id: 'b', name: 'Valid' })
			await expect(users.update('b', { id: 'moved' })).rejects.toMatchObject({
				code: 'VALIDATION',
			})
			expect(await users.update('b', { id: 'b', name: 'Updated' })).toBe(true)
			await first.close()

			const reopenedDriver = createIndexedDBDriver(composed)
			try {
				const reopened = createDatabase({
					driver: reopenedDriver,
					tables: { users: { id: stringShape(), name: stringShape({ min: 1 }) } },
					version: 1,
				})
				const reopenedLogs = reopened.import({
					logs: { id: stringShape(), message: stringShape() },
				})
				await reopened.open()
				expect(await reopened.table('users').get('b')).toEqual({ id: 'b', name: 'Updated' })
				expect(await reopenedLogs.table('logs').get('l1')).toEqual({
					id: 'l1',
					message: 'started',
				})
			} finally {
				await reopenedDriver.close()
			}
		} finally {
			await firstDriver.close()
			await deleteDatabase(composed)
		}
	})
})

describe('IndexedDBDriver — native records / count / stream pushdown', () => {
	it('rejects invalid direct paging and accepts a zero limit', async () => {
		const records = driver.value.records
		const stream = driver.value.stream
		if (records === undefined) throw new Error('Expected records capability')
		if (stream === undefined) throw new Error('Expected stream capability')
		await expect(records.call(driver.value, 'users', { limit: -1 })).rejects.toMatchObject({
			code: 'VALIDATION',
			context: { field: 'limit', value: -1 },
		})
		expect(() => stream.call(driver.value, 'users', { offset: Number.NaN })).toThrow(
			expect.objectContaining({
				code: 'VALIDATION',
				context: { field: 'offset', value: 'NaN' },
			}),
		)
		expect(await records.call(driver.value, 'users', { limit: 0 })).toEqual([])
		expect(await collect(stream.call(driver.value, 'users', { limit: 0 }))).toEqual([])
	})

	// A real database over the IndexedDB driver, with a single-column secondary
	// index on `age` (so age queries push to a key-range) and none on `name` (so
	// name queries fall back to a scan + the engine). Behavior is asserted through
	// the observable Table API — rows / counts must be correct regardless of path.

	const dbName = new DatabaseFixture<string>()
	const people = new DatabaseFixture<TableInterface<UserRow>>()

	beforeEach(async () => {
		dbName.clear()
		dbName.hold(mintDatabase('database-idb-pushdown'))
		await deleteDatabase(dbName.value)
		const db = createDatabase({
			driver: createIndexedDBDriver(dbName.value),
			tables: { people: { id: stringShape(), name: stringShape(), age: integerShape() } },
			indexes: { people: [['age']] },
		})
		people.hold(db.table('people'))
		await people.value.set([...PEOPLE])
	})

	afterEach(() => people.clear())

	afterEach(async () => {
		await deleteDatabase(dbName.value)
		dbName.clear()
	})

	it('an indexed-column range query returns the right filtered, ordered, paged rows', async () => {
		// age >= 36, descending by age — pushes to the `age` index range, then the
		// engine orders + pages. Expect Eve(55), Cy(41), Ada(36) → drop the first.
		const rows = await people.value
			.query()
			.condition({ column: 'age', operator: 'from', values: [36], connector: 'and' })
			.order({ column: 'age', direction: 'descending' })
			.offset(1)
			.limit(1)
			.collect()
		expect(rows).toEqual([{ id: 'u3', name: 'Cy', age: 41 }])
	})

	it('returns every match for an indexed equality and table count agrees', async () => {
		const rows = await people.value
			.query()
			.condition({ column: 'age', operator: 'equals', values: [22], connector: 'and' })
			.collect()
		expect(rows.map((row) => row.id).sort()).toEqual(['u2', 'u4'])
		// A single pushable equality → the native key-range count path.
		expect(
			await people.value
				.query()
				.condition({ column: 'age', operator: 'equals', values: [22], connector: 'and' })
				.count(),
		).toBe(2)
	})

	it('a non-indexed-column query still returns correct rows (scan + engine)', async () => {
		// `name` has no index → full scan, the engine applies `starts`.
		const rows = await people.value
			.query()
			.condition({ column: 'name', operator: 'starts', values: ['A'], connector: 'and' })
			.collect()
		expect(rows).toEqual([{ id: 'u1', name: 'Ada', age: 36 }])
		expect(
			await people.value
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['e'], connector: 'and' })
				.count(),
		).toBe(1) // 'Eve'
	})

	it('a multi-condition query (indexed + extra predicate) returns exact rows + count', async () => {
		// age >= 22 (pushes to the index, a superset) AND name not 'Bo' (engine refines).
		const query = people.value
			.query()
			.condition({ column: 'age', operator: 'from', values: [22], connector: 'and' })
			.condition({ column: 'name', operator: 'not', values: ['Bo'], connector: 'and' })
		const rows = await query.order({ column: 'id', direction: 'ascending' }).collect()
		expect(rows.map((row) => row.id)).toEqual(['u1', 'u3', 'u4', 'u5'])
		expect(await query.count()).toBe(4)
	})

	it('an unconditional count uses the native store count', async () => {
		expect(await people.value.query().count()).toBe(PEOPLE.length)
	})

	it('matches Memory across records, count, and stream for non-finite indexed operands', async () => {
		const memory = createDatabase({
			driver: createMemoryDriver(),
			tables: { people: { id: stringShape(), name: stringShape(), age: integerShape() } },
			indexes: { people: [['age']] },
		})
		const reference = memory.table('people')
		await reference.set([...PEOPLE])
		const conditions = [
			buildCondition('age', 'equals', [Number.NaN]),
			buildCondition('age', 'from', [Number.POSITIVE_INFINITY]),
			buildCondition('age', 'above', [Number.NEGATIVE_INFINITY]),
		]
		for (const condition of conditions) {
			const input = { conditions: [condition] }
			expect(await people.value.records(input)).toEqual(await reference.records(input))
			expect(await people.value.count(input)).toBe(await reference.count(input))
			expect(await collect(people.value.scan(input))).toEqual(await collect(reference.scan(input)))
		}
		await memory.close()
	})

	it('an or-joined query full-scans and matches the engine over a plain scan', async () => {
		const conditions = [
			buildCondition('age', 'from', [40]),
			buildCondition('name', 'equals', ['Bo'], 'or'),
		]
		const rows = await people.value
			.query()
			.condition({ column: 'age', operator: 'from', values: [40], connector: 'and' })
			.condition({ column: 'name', operator: 'equals', values: ['Bo'], connector: 'or' })
			.collect()
		// age >= 40: Cy(41), Eve(55); OR name = 'Bo': Bo(22). Superset must be a
		// full scan (no single range would be a superset of this union), so the
		// native path's result equals the engine applied to every row.
		const expected = applyQuery(
			PEOPLE.map((row) => ({ ...row })),
			{ conditions },
		)
		expect(rows.map((row) => row.id).sort()).toEqual(expected.map((row) => row.id).sort())
		expect(rows.map((row) => row.id).sort()).toEqual(['u2', 'u3', 'u5'].sort())
	})

	it('a nested FieldPath condition full-scans (never treated as a flat key)', async () => {
		dbName.clear()
		dbName.hold(mintDatabase('database-idb-nested'))
		await deleteDatabase(dbName.value)
		const db = createDatabase({
			driver: createIndexedDBDriver(dbName.value),
			tables: {
				items: { id: stringShape(), payload: jsonShape() },
			},
		})
		const items = db.table('items')
		await items.set([
			{ id: 'i1', payload: { tag: 'green' } },
			{ id: 'i2', payload: { tag: 'blue' } },
		])
		const rows = await items
			.query()
			.condition({
				column: ['payload', 'tag'],
				operator: 'equals',
				values: ['green'],
				connector: 'and',
			})
			.collect()
		expect(rows.map((row) => row.id)).toEqual(['i1'])
		await db.close()
	})

	it('stream is lazy and honors early break (offset/limit counting)', async () => {
		const seen: string[] = []
		for await (const row of people.value
			.query()
			.condition({ column: 'age', operator: 'from', values: [0], connector: 'and' })
			.stream()) {
			seen.push(row.id)
			if (seen.length === 2) break
		}
		expect(seen.length).toBe(2)
	})
})

describe('IndexedDBDriver — migrate / metadata / stamp', () => {
	it('metadata is undefined until stamped, and round-trips exactly on stamp', async () => {
		expect(await driver.value.metadata?.()).toBeUndefined()
		const metadata = { version: 1, schema: tableSchemas('users') }
		await driver.value.stamp?.(metadata)
		expect(await driver.value.metadata?.()).toEqual(metadata)
	})

	it.each([
		{ label: 'stored undefined', value: undefined },
		{ label: 'stored null', value: null },
		{ label: 'stored scalar', value: 'payload-secret' },
		{ label: 'missing fields', value: {} },
		{ label: 'invalid version', value: { version: 'payload-secret', schema: [] } },
		{
			label: 'invalid schema',
			value: {
				version: 1,
				schema: [{ name: 'payload-secret', primary: 42, columns: [], indexes: [] }],
			},
		},
	])('distinguishes absence from $label and preserves the durable record', async ({ value }) => {
		const corruptName = mintDatabase('database-idb-corrupt-metadata')
		await deleteDatabase(corruptName)
		const seeded = createIndexedDBDatabase({
			name: corruptName,
			stores: { __metadata__: {} },
		})
		await seeded.connect()
		await putIndexedDBValue(seeded.database, '__metadata__', 'metadata', value)
		expect(await seeded.store('__metadata__').has('metadata')).toBe(true)
		seeded.close()

		const recovered = createIndexedDBDriver(corruptName)
		try {
			const error = await recovered.open(tableSchemas('users')).catch((caught: unknown) => caught)
			expect(error).toMatchObject({
				code: 'DRIVER',
				message: 'Stored IndexedDB metadata is invalid',
				context: {
					name: corruptName,
					store: '__metadata__',
					key: 'metadata',
					cause: { code: 'VALIDATION' },
				},
			})
			expect(JSON.stringify(error)).not.toContain('payload-secret')
			await expect(recovered.metadata?.()).rejects.toMatchObject({
				code: 'CLOSED',
				context: { name: corruptName },
			})

			const inspected = createIndexedDBDatabase({
				name: corruptName,
				stores: { __metadata__: {} },
			})
			const native = await inspected.connect()
			expect(await inspected.store('__metadata__').has('metadata')).toBe(true)
			const retained = await readIndexedDBValue(native, '__metadata__', 'metadata')
			expect(retained).toEqual(value)
			inspected.close()
		} finally {
			await recovered.close()
			await deleteDatabase(corruptName)
		}
	})

	it('closes a failed bootstrap and retries the same driver after external repair', async () => {
		const repairName = mintDatabase('database-idb-repair-metadata')
		await deleteDatabase(repairName)
		const seeded = createIndexedDBDatabase({
			name: repairName,
			stores: { __metadata__: {} },
		})
		await seeded.connect()
		await seeded.store('__metadata__').set({ version: 'broken', schema: [] }, 'metadata')
		seeded.close()

		const recovered = createIndexedDBDriver(repairName)
		try {
			await expect(recovered.open(tableSchemas('users'))).rejects.toMatchObject({
				code: 'DRIVER',
			})
			const repaired = { version: 2, schema: tableSchemas('users') }
			const external = createIndexedDBDatabase({
				name: repairName,
				stores: { __metadata__: {}, users: {}, repair: {} },
			})
			await external.connect()
			await external.store('__metadata__').set(repaired, 'metadata')
			external.close()

			await recovered.open(tableSchemas('users'))
			expect(await recovered.metadata?.()).toEqual(repaired)
			await recovered.write('users', 'u1', { id: 'u1', repaired: true })
			expect(await recovered.read('users', 'u1')).toEqual({ id: 'u1', repaired: true })
		} finally {
			await recovered.close()
			await deleteDatabase(repairName)
		}
	})

	it('metadata persists across close and reopen (same database name)', async () => {
		const metadata = { version: 2, schema: tableSchemas('users') }
		await driver.value.stamp?.(metadata)
		await driver.value.close()
		const reopened = createIndexedDBDriver(name.value)
		await reopened.open(tableSchemas('users'))
		expect(await reopened.metadata?.()).toEqual(metadata)
		await reopened.close()
	})

	it('accepts reorder-only migration metadata', async () => {
		const canonical = tableSchemas('users', 'posts')
		await driver.value.open(canonical)
		const reordered = [...canonical].reverse()
		await driver.value.migrate?.({
			plan: { from: 1, to: 2, steps: [] },
			metadata: { version: 2, schema: reordered },
		})
		expect(await driver.value.metadata?.()).toEqual({ version: 2, schema: reordered })
	})

	it('rejects an unsafe required column before rows, schema, and metadata change', async () => {
		const before = tableSchemas('users')
		await driver.value.write('users', 'u1', { id: 'u1' })
		await driver.value.stamp?.({ version: 1, schema: before })
		await expect(
			driver.value.migrate?.({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{
							operation: 'column.add',
							table: 'users',
							column: {
								name: 'required',
								storage: 'text',
								optional: false,
								nullable: false,
							},
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: 'MIGRATION',
			context: { table: 'users', column: 'required' },
		})
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1' })
		expect(await driver.value.metadata?.()).toEqual({ version: 1, schema: before })

		const safe: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'optional', storage: 'text', optional: true, nullable: false },
				],
				indexes: [],
			},
		]
		await expect(
			driver.value.migrate?.({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{
							operation: 'column.add',
							table: 'users',
							column: {
								name: 'optional',
								storage: 'text',
								optional: true,
								nullable: false,
							},
						},
					],
				},
				metadata: { version: 2, schema: safe },
			}),
		).resolves.toBeUndefined()
	})

	it('reconciles a real Database table removal and preserves a same-version reopen', async () => {
		const versioned = mintDatabase('database-idb-version-remove')
		await deleteDatabase(versioned)
		const users = { id: stringShape(), name: stringShape() }
		const audit = { id: stringShape(), message: stringShape() }
		const v1 = createDatabase({
			driver: createIndexedDBDriver(versioned),
			tables: { users, audit },
			version: 1,
		})
		const v2 = createDatabase({
			driver: createIndexedDBDriver(versioned),
			tables: { users },
			version: 2,
		})
		const again = createDatabase({
			driver: createIndexedDBDriver(versioned),
			tables: { users },
			version: 2,
		})
		const result = await completeFixture(
			async () => {
				await v1.table('users').set({ id: 'u1', name: 'Ada' })
				await v1.table('audit').set({ id: 'a1', message: 'created' })
				await v1.close()
				await v2.open()
				const preserved = await v2.table('users').get('u1')
				await v2.close()

				const inspected = createIndexedDBDatabase({
					name: versioned,
					stores: { __metadata__: {}, users: {} },
				})
				await inspected.connect()
				const stores = inspected.stores
				const stamped = await inspected.store('__metadata__').get('metadata')
				const version = inspected.version
				inspected.close()

				await again.open()
				const reopened = await again.table('users').get('u1')
				await again.close()

				const repeated = createIndexedDBDatabase({
					name: versioned,
					stores: { __metadata__: {}, users: {} },
				})
				await repeated.connect()
				const storesAgain = repeated.stores
				const stampedAgain = await repeated.store('__metadata__').get('metadata')
				const versionAgain = repeated.version
				repeated.close()
				return {
					preserved,
					stores,
					stamped,
					version,
					reopened,
					storesAgain,
					stampedAgain,
					versionAgain,
				}
			},
			async () => {
				await v1.close()
				await v2.close()
				await again.close()
				await deleteDatabase(versioned)
			},
		)

		expect(result.preserved).toEqual({ id: 'u1', name: 'Ada' })
		expect(result.stores).not.toContain('audit')
		expect(result.stamped).toMatchObject({ version: 2 })
		expect(result.reopened).toEqual({ id: 'u1', name: 'Ada' })
		expect(result.storesAgain).toEqual(result.stores)
		expect(result.stampedAgain).toEqual(result.stamped)
		expect(result.versionAgain).toBe(result.version)
	})

	it('reconciles a real Database table addition while preserving deployed rows', async () => {
		const versioned = mintDatabase('database-idb-version-add')
		await deleteDatabase(versioned)
		const users = { id: stringShape(), name: stringShape() }
		const posts = { id: stringShape(), title: stringShape() }
		const v1 = createDatabase({
			driver: createIndexedDBDriver(versioned),
			tables: { users },
			version: 1,
		})
		const v2 = createDatabase({
			driver: createIndexedDBDriver(versioned),
			tables: { users, posts },
			version: 2,
		})
		const result = await completeFixture(
			async () => {
				await v1.table('users').set({ id: 'u1', name: 'Ada' })
				await v1.close()
				await v2.open()
				await v2.table('posts').set({ id: 'p1', title: 'First' })
				const preserved = await v2.table('users').get('u1')
				const added = await v2.table('posts').get('p1')
				await v2.close()

				const inspected = createIndexedDBDatabase({
					name: versioned,
					stores: { __metadata__: {}, users: {}, posts: {} },
				})
				await inspected.connect()
				const stores = inspected.stores
				const stamped = await inspected.store('__metadata__').get('metadata')
				inspected.close()
				return { preserved, added, stores, stamped }
			},
			async () => {
				await v1.close()
				await v2.close()
				await deleteDatabase(versioned)
			},
		)

		expect(result.preserved).toEqual({ id: 'u1', name: 'Ada' })
		expect(result.added).toEqual({ id: 'p1', title: 'First' })
		expect(result.stores).toContain('posts')
		expect(result.stamped).toMatchObject({ version: 2 })
	})

	it('table.add creates a usable store by using migrate', async () => {
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{
						operation: 'table.add',
						table: {
							name: 'posts',
							primary: 'id',
							columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
							indexes: [],
						},
					},
				],
			},
		})
		await driver.value.write('posts', 'p1', { id: 'p1', title: 'Hello' })
		expect(await driver.value.read('posts', 'p1')).toEqual({ id: 'p1', title: 'Hello' })
	})

	it('table.remove drops a store by using migrate', async () => {
		await driver.value.open(tableSchemas('users', 'posts'))
		await driver.value.write('posts', 'p1', { id: 'p1' })
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'table.remove', table: 'posts' }],
			},
		})
		await expect(driver.value.read('posts', 'p1')).rejects.toThrow('posts')
	})

	it('replays table.add then table.remove in order without leaving a store', async () => {
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{
						operation: 'table.add',
						table: {
							name: 'posts',
							primary: 'id',
							columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
							indexes: [],
						},
					},
					{ operation: 'table.remove', table: 'posts' },
				],
			},
		})
		await expect(driver.value.read('posts', 'p1')).rejects.toThrow('posts')
		const inspected = createIndexedDBDatabase({
			name: name.value,
			stores: { __metadata__: {}, users: {} },
		})
		await inspected.connect()
		expect(inspected.stores).not.toContain('posts')
		inspected.close()
	})

	it('replays table.remove then table.add in order and replaces the store', async () => {
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
			indexes: [],
		}
		const replacement: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: false, nullable: false },
			],
			indexes: [['age']],
		}
		await driver.value.open([deployed])
		await driver.value.write('users', 'old', { id: 'old' })
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{ operation: 'table.remove', table: 'users' },
					{ operation: 'table.add', table: replacement },
				],
			},
		})
		expect(await driver.value.read('users', 'old')).toBeUndefined()
		await driver.value.write('users', 'new', { id: 'new', age: 41 })
		const rows = await driver.value.records?.('users', {
			conditions: [buildCondition('age', 'equals', [41])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['new'])
	})

	it('replays index.add then index.remove in order on a newly added table', async () => {
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{
						operation: 'table.add',
						table: {
							name: 'posts',
							primary: 'id',
							columns: [
								{ name: 'id', storage: 'text', optional: false, nullable: false },
								{ name: 'rank', storage: 'integer', optional: false, nullable: false },
							],
							indexes: [],
						},
					},
					{ operation: 'index.add', table: 'posts', index: ['rank'] },
					{ operation: 'index.remove', table: 'posts', index: ['rank'] },
				],
			},
		})
		const inspected = createIndexedDBDatabase({
			name: name.value,
			stores: { __metadata__: {}, users: {}, posts: {} },
		})
		await inspected.connect()
		const transaction = inspected.database.transaction('posts', 'readonly')
		expect([...transaction.objectStore('posts').indexNames]).toEqual([])
		inspected.close()
	})

	it('replays table.add then index.add with the final index present and usable', async () => {
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{
						operation: 'table.add',
						table: {
							name: 'posts',
							primary: 'id',
							columns: [
								{ name: 'id', storage: 'text', optional: false, nullable: false },
								{ name: 'rank', storage: 'integer', optional: false, nullable: false },
							],
							indexes: [],
						},
					},
					{ operation: 'index.add', table: 'posts', index: ['rank'] },
				],
			},
		})
		await driver.value.write('posts', 'p1', { id: 'p1', rank: 7 })
		const rows = await driver.value.records?.('posts', {
			conditions: [buildCondition('rank', 'equals', [7])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['p1'])
		const inspected = createIndexedDBDatabase({
			name: name.value,
			stores: {
				__metadata__: {},
				users: {},
				posts: { indexes: [{ name: 'rank', path: 'rank' }] },
			},
		})
		await inspected.connect()
		expect((await inspected.store('posts').index('rank').get(7))?.id).toBe('p1')
		inspected.close()
	})

	it('replays column.remove then column.add and publishes the final column schema', async () => {
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'legacy', storage: 'text', optional: false, nullable: true },
			],
			indexes: [],
		}
		await driver.value.open([deployed])
		await driver.value.write('users', 'u1', { id: 'u1', legacy: 'old' })
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{ operation: 'column.remove', table: 'users', column: 'legacy' },
					{
						operation: 'column.add',
						table: 'users',
						column: { name: 'legacy', storage: 'integer', optional: false, nullable: true },
					},
				],
			},
		})
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1' })
		await driver.value.write('users', 'u2', { id: 'u2', legacy: 2 })
		await driver.value.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'index.add', table: 'users', index: ['legacy'] }],
			},
		})
		const rows = await driver.value.records?.('users', {
			conditions: [buildCondition('legacy', 'equals', [2])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['u2'])
	})

	it('index.add on an existing store becomes visible (secondary-index read works)', async () => {
		await driver.value.open([
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'age', storage: 'integer', optional: false, nullable: false },
				],
				indexes: [],
			},
		])
		await driver.value.write('users', 'u1', { id: 'u1', age: 30 })
		await driver.value.write('users', 'u2', { id: 'u2', age: 41 })
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'index.add', table: 'users', index: ['age'] }],
			},
		})
		await driver.value.close()
		// Read the live IDBIndex through a fresh wrapper connection over the SAME
		// database — a non-tautological existence proof of the created index.
		const wrapper = createIndexedDBDatabase({
			name: name.value,
			stores: { users: { indexes: [{ name: 'age', path: 'age' }] } },
		})
		await wrapper.connect()
		expect((await wrapper.store('users').index('age').get(41))?.id).toBe('u2')
		wrapper.close()
		driver.clear()
		driver.hold(createIndexedDBDriver(name.value))
		await driver.value.open(tableSchemas('users'))
	})

	it('rewrites every stored row in cursor order during column removal', async () => {
		// Base: c8b95c5:src/browser/drivers/IndexedDBDriver.ts:749-764.
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'legacy', storage: 'boolean', optional: false, nullable: true },
			],
			indexes: [],
		}
		await driver.value.open([deployed])
		const rows = Array.from({ length: 128 }, (_, index) => ({
			id: `u${String(index).padStart(3, '0')}`,
			name: `Person ${index}`,
			legacy: true,
		}))
		for (const row of rows.toReversed()) await driver.value.write('users', row.id, row)
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
			},
		})
		expect(await collect(driver.value.scan('users'))).toEqual(
			rows.map((row) => ({ id: row.id, name: row.name })),
		)
	})

	it('a column.remove migration rewrites stored rows (verified post-reconnect)', async () => {
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'legacy', storage: 'boolean', optional: false, nullable: true },
			],
			indexes: [],
		}
		const declared: TableSchema = {
			...deployed,
			columns: deployed.columns.filter((column) => column.name !== 'legacy'),
		}
		await driver.value.open([deployed])
		await driver.value.write('users', 'u1', { id: 'u1', name: 'Ada', legacy: true })
		await driver.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
			},
		})
		const migrated = await driver.value.read('users', 'u1')
		expect(migrated).toEqual({ id: 'u1', name: 'Ada' })
		await driver.value.close()
		const reopened = createIndexedDBDriver(name.value)
		await reopened.open([declared])
		expect(await reopened.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
		await reopened.close()
		driver.clear()
		driver.hold(createIndexedDBDriver(name.value))
		await driver.value.open(tableSchemas('users'))
	})

	it('a column.remove migration fails closed on a non-record stored value', async () => {
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'legacy', storage: 'boolean', optional: false, nullable: true },
			],
			indexes: [],
		}
		await driver.value.open([deployed])
		await driver.value.write('users', 'u1', { id: 'u1', name: 'Ada', legacy: true })
		await driver.value.close()
		const seeded = createIndexedDBDatabase({
			name: name.value,
			stores: { users: {} },
		})
		await seeded.connect()
		await putIndexedDBValue(seeded.database, 'users', 'x', 42)
		seeded.close()

		const corrupted = createIndexedDBDriver(name.value)
		await corrupted.open([deployed])
		const error = await corrupted
			.migrate?.({
				plan: {
					from: 0,
					to: 1,
					steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
				},
			})
			.catch((caught: unknown) => caught)
		expect(error).toMatchObject({ code: 'MIGRATION' })
		await corrupted.close()
		driver.clear()
		driver.hold(createIndexedDBDriver(name.value))
		await driver.value.open(tableSchemas('users'))
	})

	it('reconnects a yielded wrapper before reading its version for migration', async () => {
		const inspected = createIndexedDBDatabase({
			name: name.value,
			stores: { __metadata__: {}, users: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()
		const external = createIndexedDBDatabase({
			name: name.value,
			version: version + 1,
			stores: { __metadata__: {}, users: {}, external: {} },
		})
		await external.connect()
		external.close()

		await driver.value.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [
					{
						operation: 'column.add',
						table: 'users',
						column: { name: 'added', storage: 'text', optional: false, nullable: true },
					},
				],
			},
		})
		await driver.value.write('users', 'u1', { id: 'u1', added: 'ready' })
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1', added: 'ready' })
	})

	it('reopening with a reduced schema drops ghost tables (unresolvable, no stale pushdown)', async () => {
		await driver.value.open(tableSchemas('users', 'posts'))
		await driver.value.write('posts', 'p1', { id: 'p1' })
		// Reopen with ONLY 'users' declared — the ghost 'posts' table must not
		// remain resolvable by planning (`#table` / `records` / `stream`).
		await driver.value.open(tableSchemas('users'))
		const ghostRecords =
			driver.value.records === undefined
				? Promise.resolve(undefined)
				: driver.value.records('posts', { conditions: [] })
		await expect(ghostRecords).rejects.toThrow('posts')
	})

	it('a mid-upgrade migrate failure leaves #schema/database at the pre-failure state, and a later valid migrate still succeeds', async () => {
		// A stored non-record fails the column walk inside the upgrade, after the store was added.
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: false, nullable: true },
				{ name: 'legacy', storage: 'boolean', optional: true, nullable: false },
			],
			indexes: [['age']],
		}
		await driver.value.open([deployed])
		await driver.value.write('users', 'u1', { id: 'u1', age: 30 })
		const metadata = { version: 1, schema: [deployed] }
		await driver.value.stamp?.(metadata)
		const corrupt = createIndexedDBDatabase({ name: name.value, stores: {} })
		await putIndexedDBValue(await corrupt.connect(), 'users', 'x', 42)
		corrupt.close()
		// One versionchange creates a store before the non-record fault aborts the whole upgrade,
		// including its metadata stamp.
		await expect(
			driver.value.migrate?.({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{
							operation: 'table.add',
							table: {
								name: 'posts',
								primary: 'id',
								columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
								indexes: [],
							},
						},
						{ operation: 'column.remove', table: 'users', column: 'legacy' },
					],
				},
			}),
		).rejects.toMatchObject({ code: 'MIGRATION' })
		// The driver reconnects at the exact pre-migration state.
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1', age: 30 })
		expect(await driver.value.metadata?.()).toEqual(metadata)
		await expect(driver.value.read('posts', 'p1')).rejects.toThrow('posts')
		await driver.value.write('users', 'u2', { id: 'u2', age: 40 })
		expect(await driver.value.read('users', 'u2')).toEqual({ id: 'u2', age: 40 })
		// A subsequent valid migration proves the failed candidate was discarded.
		await driver.value.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'index.add', table: 'users', index: ['id'] }],
			},
		})
		await driver.value.close()
		const wrapper = createIndexedDBDatabase({
			name: name.value,
			stores: {
				users: {
					indexes: [{ name: 'id', path: 'id' }],
				},
			},
		})
		await wrapper.connect()
		expect(wrapper.stores).not.toContain('posts')
		expect((await wrapper.store('users').index('id').get('u2'))?.id).toBe('u2')
		wrapper.close()
		driver.clear()
		driver.hold(createIndexedDBDriver(name.value))
		await driver.value.open(tableSchemas('users'))
	})

	it('recovers its pre-migration schema after a real duplicate-index upgrade failure', async () => {
		// The open drops the undeclared physical index, so the plan repeats its own index.add.
		const dual = mintDatabase('database-idb-dual-recovery')
		await deleteDatabase(dual)
		const physical = createIndexedDBDatabase({
			name: dual,
			stores: { users: { indexes: [{ name: 'age', path: 'age' }] } },
		})
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: false, nullable: true },
			],
			indexes: [],
		}
		const recovering = createIndexedDBDriver(dual)
		const cleanup = createIndexedDBDatabase({ name: dual, stores: {} })
		try {
			await physical.connect()
			physical.close()
			await recovering.open([deployed])
			const error = await recovering
				.migrate?.({
					plan: {
						from: 1,
						to: 2,
						steps: [
							{ operation: 'index.add', table: 'users', index: ['age'] },
							{ operation: 'index.add', table: 'users', index: ['age'] },
						],
					},
				})
				.catch((caught: unknown) => caught)
			if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
			expect(error.code).toBe('MIGRATION')
			expect(await recovering.read('users', 'u1')).toBeUndefined()
			await recovering.write('users', 'u2', { id: 'u2', age: 40 })
			expect(await recovering.read('users', 'u2')).toEqual({ id: 'u2', age: 40 })
			await cleanup.drop()
		} finally {
			physical.close()
			cleanup.close()
			await recovering.close()
		}
	})

	it('an unknown-table migration step throws MIGRATION without consuming a version', async () => {
		await driver.value.write('users', 'u1', { id: 'u1' })
		const caught = await captureFailure(async () => {
			await driver.value.migrate?.({
				plan: {
					from: 0,
					to: 1,
					steps: [{ operation: 'table.remove', table: 'ghost' }],
				},
			})
		})
		expect(isDatabaseError(caught) && caught.code === 'MIGRATION').toBe(true)
		// The connection is still usable — no version bump was wasted.
		expect(await driver.value.read('users', 'u1')).toEqual({ id: 'u1' })
		await driver.value.write('users', 'u2', { id: 'u2' })
		expect(await driver.value.read('users', 'u2')).toEqual({ id: 'u2' })
	})
})

describe('IndexedDBDriver — the audit reproduction (below/to over a nullable indexed column)', () => {
	// The exact reproduction: a nullable `age` with its own secondary index, and a
	// row ('b') where `age` is entirely ABSENT. The engine's total order ranks
	// absent/null BELOW every number, so `below`/`to` must include 'b' — but a
	// naive index-range read would silently drop it (no index entry exists for an
	// absent field). `records` / `count` / `stream` must all agree with a plain
	// engine-over-scan.
	const SCHEMA = ABSENT_SCHEMA
	const ROWS = ABSENT_ROWS

	const dbName = new DatabaseFixture<string>()
	const repro = new DatabaseFixture<DriverInterface>()

	beforeEach(async () => {
		dbName.clear()
		dbName.hold(mintDatabase('database-idb-repro'))
		await deleteDatabase(dbName.value)
		repro.hold(createIndexedDBDriver(dbName.value))
		await repro.value.open([SCHEMA])
		for (const row of ROWS) await repro.value.write('people', row.id, { ...row })
	})

	afterEach(async () => {
		await repro.value.close()
		repro.clear()
		await deleteDatabase(dbName.value)
		dbName.clear()
	})

	it("records: to(100) includes row 'b' (its absent age ranks below 100 under the engine's order)", async () => {
		const rows = await repro.value.records?.('people', {
			conditions: [buildCondition('age', 'to', [100])],
		})
		expect(rows?.map((row) => row.id).sort()).toEqual(['a', 'b'])
	})

	it("records: below(100) includes row 'b'", async () => {
		const rows = await repro.value.records?.('people', {
			conditions: [buildCondition('age', 'below', [100])],
		})
		expect(rows?.map((row) => row.id).sort()).toEqual(['a', 'b'])
	})

	it("stream: to(100) / below(100) both yield row 'b'", async () => {
		const toRows =
			repro.value.stream === undefined
				? []
				: await collect(
						repro.value.stream('people', { conditions: [buildCondition('age', 'to', [100])] }),
					)
		const belowRows =
			repro.value.stream === undefined
				? []
				: await collect(
						repro.value.stream('people', { conditions: [buildCondition('age', 'below', [100])] }),
					)
		expect(toRows.map((row) => row.id).sort()).toEqual(['a', 'b'])
		expect(belowRows.map((row) => row.id).sort()).toEqual(['a', 'b'])
	})

	it('matches a plain engine-over-scan for both operators (superset contract holds)', async () => {
		const scanned = await collect(repro.value.scan('people'))
		const expectedTo = applyQuery(scanned, { conditions: [buildCondition('age', 'to', [100])] })
		const expectedBelow = applyQuery(scanned, {
			conditions: [buildCondition('age', 'below', [100])],
		})
		const to = await repro.value.records?.('people', {
			conditions: [buildCondition('age', 'to', [100])],
		})
		const below = await repro.value.records?.('people', {
			conditions: [buildCondition('age', 'below', [100])],
		})
		expect(to?.map((row) => row.id).sort()).toEqual(expectedTo.map((row) => row.id).sort())
		expect(below?.map((row) => row.id).sort()).toEqual(expectedBelow.map((row) => row.id).sort())
	})
})

describe('IndexedDBDriver — reversed between bounds', () => {
	const SCHEMA = REVERSED_SCHEMA

	const dbName = new DatabaseFixture<string>()
	const reversed = new DatabaseFixture<DriverInterface>()

	beforeEach(async () => {
		dbName.clear()
		dbName.hold(mintDatabase('database-idb-reversed'))
		await deleteDatabase(dbName.value)
		reversed.hold(createIndexedDBDriver(dbName.value))
		await reversed.value.open([SCHEMA])
		await reversed.value.write('people', 'a', { id: 'a', age: 10 })
		await reversed.value.write('people', 'b', { id: 'b', age: 20 })
	})

	afterEach(async () => {
		await reversed.value.close()
		reversed.clear()
		await deleteDatabase(dbName.value)
		dbName.clear()
	})

	it('a reversed same-type between (id) returns empty and never throws', async () => {
		await expect(
			reversed.value.records?.('people', {
				conditions: [buildCondition('id', 'between', ['z', 'a'])],
			}),
		).resolves.toEqual([])
	})

	it('a reversed mixed-value between (age, numeric) returns empty and never throws', async () => {
		await expect(
			reversed.value.records?.('people', {
				conditions: [buildCondition('age', 'between', [100, 1])],
			}),
		).resolves.toEqual([])
	})

	it('stream over a reversed between yields nothing and never throws', async () => {
		const rows =
			reversed.value.stream === undefined
				? []
				: await collect(
						reversed.value.stream('people', {
							conditions: [buildCondition('age', 'between', [100, 1])],
						}),
					)
		expect(rows).toEqual([])
	})
})

describe('IndexedDBDriver — error taxonomy mapping (integration)', () => {
	it('a mid-upgrade UPGRADE fault surfaces as a MIGRATION DatabaseError (not a raw IndexedDBError)', async () => {
		const caught = await captureFailure(async () => {
			await driver.value.migrate?.({
				plan: {
					from: 0,
					to: 1,
					// The SAME index again — a real native duplicate-index ConstraintError
					// mid-upgrade, surfacing as IndexedDBError('UPGRADE', …).
					steps: [
						{ operation: 'index.add', table: 'users', index: ['age'] },
						{ operation: 'index.add', table: 'users', index: ['age'] },
					],
				},
			})
		})
		expect(isDatabaseError(caught)).toBe(true)
		expect(isDatabaseError(caught) && caught.code).toBe('MIGRATION')
	})

	it('an operation after close() throws the driver-own CLOSED DatabaseError (never a raw backend error)', async () => {
		await driver.value.close()
		const caught = await captureFailure(async () => {
			await driver.value.read('users', 'u1')
		})
		expect(isDatabaseError(caught)).toBe(true)
		expect(isDatabaseError(caught) && caught.code).toBe('CLOSED')
		// Reconnect so the shared `afterEach` can close/delete cleanly.
		driver.clear()
		driver.hold(createIndexedDBDriver(name.value))
		await driver.value.open(tableSchemas('users'))
	})
})

describe('IndexedDBDriver — reserved __metadata__ table name guard', () => {
	it('open() throws a VALIDATION DatabaseError when a declared table is named __metadata__', async () => {
		const guarded = createIndexedDBDriver(mintDatabase('database-idb-metadata-guard'))
		const caught = await captureFailure(async () => {
			await guarded.open([
				{
					name: '__metadata__',
					primary: 'id',
					columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
					indexes: [],
				},
			])
		})
		expect(isDatabaseError(caught)).toBe(true)
		expect(isDatabaseError(caught) && caught.code).toBe('VALIDATION')
	})
})

describe('IndexedDBDriver — index-name collision (a_b column vs [a, b] compound index)', () => {
	const SCHEMA = COLLISION_SCHEMA

	const dbName = new DatabaseFixture<string>()
	const collision = new DatabaseFixture<DriverInterface>()

	beforeEach(async () => {
		dbName.clear()
		dbName.hold(mintDatabase('database-idb-collision'))
		await deleteDatabase(dbName.value)
		collision.hold(createIndexedDBDriver(dbName.value))
	})

	afterEach(async () => {
		await collision.value.close()
		collision.clear()
		await deleteDatabase(dbName.value)
		dbName.clear()
	})

	it('opens fine with both a single-column "a_b" index and a compound ["a","b"] index', async () => {
		await expect(collision.value.open([SCHEMA])).resolves.toBeUndefined()
	})

	it('a pushdown on "a_b" uses the single-column index, not the compound one', async () => {
		await collision.value.open([SCHEMA])
		await collision.value.write('items', 'i1', { id: 'i1', a: 'x', b: 'y', a_b: 'match' })
		await collision.value.write('items', 'i2', { id: 'i2', a: 'match', b: 'other', a_b: 'other' })
		const rows = await collision.value.records?.('items', {
			conditions: [buildCondition('a_b', 'equals', ['match'])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['i1'])
	})

	it('migrate can add and remove each index independently', async () => {
		await collision.value.open([{ ...SCHEMA, indexes: [] }])
		await collision.value.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'index.add', table: 'items', index: ['a_b'] }],
			},
		})
		await collision.value.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'index.add', table: 'items', index: ['a', 'b'] }],
			},
		})
		await collision.value.write('items', 'i1', { id: 'i1', a: 'x', b: 'y', a_b: 'z' })
		const bySingle = await collision.value.records?.('items', {
			conditions: [buildCondition('a_b', 'equals', ['z'])],
		})
		expect(bySingle?.map((row) => row.id)).toEqual(['i1'])
		await collision.value.migrate?.({
			plan: {
				from: 2,
				to: 3,
				steps: [
					{ operation: 'index.remove', table: 'items', index: ['a_b'] },
					{ operation: 'index.remove', table: 'items', index: ['a', 'b'] },
				],
			},
		})
		// Both indexes gone — the column is no longer pushable, but the table
		// still reads correctly through a full scan.
		const afterRemove = await collision.value.records?.('items', {
			conditions: [buildCondition('a_b', 'equals', ['z'])],
		})
		expect(afterRemove?.map((row) => row.id)).toEqual(['i1'])
	})
})

describe('IndexedDBDriver — rows read per conformance read', () => {
	it('reads the rows each plan bounds for every read and answers what the core answers', async () => {
		const database = mintDatabase('database-idb-rows')
		await deleteDatabase(database)
		const recorder = new StorageRecorder(createIndexedDBDriver(database))
		const planned = recorder.driver
		try {
			await planned.open([
				{ ...CONFORMANCE_USERS_SCHEMA, indexes: [['age']] },
				CONFORMANCE_POSTS_SCHEMA,
			])
			for (const row of CONFORMANCE_ROWS) {
				const key = extractKey(row, 'id')
				if (key !== undefined) await planned.write('users', key, row)
			}
			const scanned = await Array.fromAsync(planned.scan('users'))
			const counts: number[] = []
			for (const input of CONFORMANCE_READS) {
				const { aggregate, ...query } = input
				const { value, calls } = await recorder.measure<readonly Row[] | number | undefined>(() =>
					aggregate === undefined
						? readPlannedRows(planned, 'users', query)
						: readPlannedAggregate(planned, 'users', query, aggregate),
				)
				expect({ input, value }).toEqual({
					input,
					value:
						aggregate === undefined
							? applyQuery(scanned, query)
							: computeAggregate(
									filterRows(scanned, query.conditions ?? []),
									aggregate.operation,
									aggregate.column,
								),
				})
				counts.push(tallyCalls(calls, 'records').rows + tallyCalls(calls, 'stream').rows)
			}
			expect(counts).toEqual(CONFORMANCE_ROWS_READ)
		} finally {
			await planned.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — stream order', () => {
	it('yields the rows in the input order, and in key order without one', async () => {
		const database = mintDatabase('database-idb-order')
		await deleteDatabase(database)
		const ordered = createIndexedDBDriver(database)
		try {
			await ordered.open([
				{ ...CONFORMANCE_USERS_SCHEMA, indexes: [['age']] },
				CONFORMANCE_POSTS_SCHEMA,
			])
			for (const row of CONFORMANCE_ROWS) {
				const key = extractKey(row, 'id')
				if (key !== undefined) await ordered.write('users', key, row)
			}
			const input = {
				conditions: [buildCondition('age', 'from', [17])],
				order: [{ column: 'age', direction: 'descending' as const }],
				limit: 3,
			}
			const scanned = await Array.fromAsync(ordered.scan('users'))
			const streamed = await Array.fromAsync(ordered.stream?.('users', input) ?? [])
			expect(streamed.map((row) => row.id)).toEqual(applyQuery(scanned, input).map((row) => row.id))
			expect(streamed.map((row) => row.id)).toEqual(['g', 'h', 'b'])
			const keyed = await Array.fromAsync(ordered.stream?.('users', {}) ?? [])
			expect(keyed.map((row) => row.id)).toEqual(scanned.map((row) => row.id))
		} finally {
			await ordered.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — empty lists', () => {
	for (const { member, run, expected } of EMPTY_STORAGE_CASES) {
		it(`answers an empty ${member} list and touches no row`, async () => {
			const database = mintDatabase('database-empty-lists')
			const { recorder, db } = createRecordedUsers(createIndexedDBDriver(database))
			try {
				await db.open()
				const { value, calls } = await recorder.measure(() => run(recorder.driver))
				expect(value).toEqual(expected)
				expect(calls.filter((call) => call.keys > 0 || call.rows > 0)).toEqual([])
			} finally {
				await db.close()
				await deleteDatabase(database)
			}
		})

		it(`answers an empty ${member} list through the journal and restores nothing`, async () => {
			const database = mintDatabase('database-empty-lists')
			const { recorder, db } = createRecordedUsers(createIndexedDBDriver(database))
			try {
				await db.open()
				const journal = new StorageJournal(recorder.driver)
				const { value, calls } = await recorder.measure(async () => {
					const answer = await run(journal)
					await journal.restore()
					return answer
				})
				expect(value).toEqual(expected)
				expect(calls.filter((call) => call.keys > 0 || call.rows > 0)).toEqual([])
			} finally {
				await db.close()
				await deleteDatabase(database)
			}
		})
	}

	for (const { member, run, expected } of EMPTY_TABLE_CASES) {
		it(`answers Table ${member} of an empty list and touches no row`, async () => {
			const database = mintDatabase('database-empty-lists')
			const { recorder, db, users } = createRecordedUsers(createIndexedDBDriver(database))
			try {
				await db.open()
				const { value, calls } = await recorder.measure(() => run(users))
				expect(value).toEqual(expected)
				expect(calls.filter((call) => call.keys > 0 || call.rows > 0)).toEqual([])
			} finally {
				await db.close()
				await deleteDatabase(database)
			}
		})
	}
})

describe('IndexedDBDriver — access paths read no row past their bound', () => {
	for (const { name: label, input, key, fields, bound } of TRIPWIRE_CASES) {
		it(`reads ${label} without reaching the tripwire beyond it`, async () => {
			const database = mintDatabase('database-idb-tripwire')
			const recorder = new StorageRecorder(createIndexedDBDriver(database))
			const { database: db, items } = await seedItems(recorder.driver, buildItems(40))
			try {
				await putTripwire(database, 'items', key, fields)
				const { value, calls } = await recorder.measure(() => items.records(input))
				expect(value).toEqual(applyQuery(buildItems(40), input))
				expect(tallyCalls(calls, 'records').rows + tallyCalls(calls, 'stream').rows).toBe(bound)
				expect(tallyCalls(calls, 'scan').calls).toBe(0)
			} finally {
				await db.close()
				await deleteDatabase(database)
			}
		})
	}

	it('raises DRIVER for a read that reaches a tripwire, so a quiet read stopped ahead of it', async () => {
		const database = mintDatabase('database-idb-tripwire')
		const { database: db, items } = await seedItems(createIndexedDBDriver(database), buildItems(8))
		try {
			await putTripwire(database, 'items', 'k0003a', { organization: 'o3', rank: 3 })
			await expect(items.records()).rejects.toMatchObject({
				code: 'DRIVER',
				context: { code: 'RECORD' },
			})
			await expect(
				items.records({ conditions: [buildCondition('organization', 'equals', ['o3'])] }),
			).rejects.toMatchObject({ code: 'DRIVER' })
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — plans answer the core engine over the scan', () => {
	it('returns the core engine rows, order included, for every plan class', async () => {
		const database = mintDatabase('database-idb-plans')
		const { database: db, items } = await seedItems(createIndexedDBDriver(database), buildItems(40))
		const memory = await seedItems(createMemoryDriver(), buildItems(40))
		try {
			for (const input of ITEM_READS.filter((read) => read.aggregate === undefined)) {
				expect({ input, rows: await items.records(input) }).toEqual({
					input,
					rows: await memory.items.records(input),
				})
				const { order: _order, ...unordered } = input
				expect({ input, scanned: await collect(items.scan(unordered)) }).toEqual({
					input,
					scanned: await collect(memory.items.scan(unordered)),
				})
				expect({ input, count: await items.count(input) }).toEqual({
					input,
					count: await memory.items.count(input),
				})
			}
			const aggregates = ITEM_READS.flatMap(({ aggregate, ...query }) =>
				aggregate === undefined ? [] : [{ aggregate, query }],
			)
			for (const { aggregate, query } of aggregates) {
				expect({
					query,
					value: await items.aggregate(aggregate.operation, aggregate.column, query),
				}).toEqual({
					query,
					value: await memory.items.aggregate(aggregate.operation, aggregate.column, query),
				})
			}
		} finally {
			await db.close()
			await memory.database.close()
			await deleteDatabase(database)
		}
	})

	it('answers each planned read inside a journal scope with the scope writes', async () => {
		const database = mintDatabase('database-idb-plans')
		const { database: db } = await seedItems(createIndexedDBDriver(database), buildItems(12))
		try {
			const input = {
				conditions: [buildCondition('organization', 'equals', ['o1'])],
				order: [{ column: 'id', direction: 'descending' as const }],
				limit: 2,
			}
			const rows = await db.transaction(async (scope) => {
				await scope.table('items').set({ id: 'k0013', organization: 'o1', rank: 13, score: 1 })
				return scope.table('items').records(input)
			})
			expect(rows.map((row) => row.id)).toEqual(['k0013', 'k0009'])
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — native counts and extremes read no row', () => {
	const COUNTS = [
		{ conditions: [buildCondition('organization', 'equals', ['o1'])] },
		{ conditions: [buildCondition('organization', 'any', ['o1', 'o3', 'o1'])] },
		{ conditions: [buildCondition('id', 'any', ['k0002', 'k0004', 'none'])] },
		{ conditions: [buildCondition('rank', 'between', [5, 30])] },
		{ conditions: [buildCondition('tag', 'equals', ['t1'])] },
		{},
	]

	it('counts each path in the engine with no row returned', async () => {
		const database = mintDatabase('database-idb-count')
		const recorder = new StorageRecorder(createIndexedDBDriver(database))
		const { database: db, items } = await seedItems(recorder.driver, buildItems(40))
		try {
			for (const input of COUNTS) {
				const { value, calls } = await recorder.measure(() => items.count(input))
				expect({ input, value }).toEqual({
					input,
					value: applyQuery(buildItems(40), input).length,
				})
				expect({ input, aggregate: tallyCalls(calls, 'aggregate').calls }).toEqual({
					input,
					aggregate: 1,
				})
				expect(calls.filter((call) => call.rows > 0)).toEqual([])
			}
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('reads the first index entry for a minimum and a maximum, past a tripwire inside the index', async () => {
		const database = mintDatabase('database-idb-extreme')
		const recorder = new StorageRecorder(createIndexedDBDriver(database))
		const { database: db, items } = await seedItems(recorder.driver, buildItems(40))
		try {
			await putTripwire(database, 'items', 'k0020a', { organization: 'o0', rank: 20 })
			const maximum = await recorder.measure(() => items.aggregate('maximum', 'rank'))
			const minimum = await recorder.measure(() =>
				items.aggregate('minimum', 'rank', {
					conditions: [buildCondition('rank', 'above', [6])],
				}),
			)
			expect([maximum.value, minimum.value]).toEqual([39, 7])
			expect([...maximum.calls, ...minimum.calls].filter((call) => call.rows > 0)).toEqual([])
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — streams read one batch at a time', () => {
	it('streams the store and an ordered index without reading past the first batch', async () => {
		const database = mintDatabase('database-idb-batches')
		const driven = new IndexedDBDriver(database)
		const rows = buildItems(700)
		const { database: db, items } = await seedItems(driven, rows)
		try {
			await putTripwire(database, 'items', 'k0600a', { organization: 'o0' })
			await putTripwire(database, 'items', 'zz', { rank: 100 })
			const seen: string[] = []
			for await (const row of items.scan()) {
				seen.push(row.id)
				if (seen.length === 3) break
			}
			const ordered: unknown[] = []
			for await (const row of driven.stream('items', {
				order: [{ column: 'rank', direction: 'descending' }],
			})) {
				ordered.push(row.rank)
				if (ordered.length === 3) break
			}
			expect([seen, ordered]).toEqual([
				['k0000', 'k0001', 'k0002'],
				[699, 698, 697],
			])
			await expect(collect(items.scan())).rejects.toMatchObject({ code: 'DRIVER' })
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('streams every row of each path in batches, in order, past the batch boundary', async () => {
		const database = mintDatabase('database-idb-batches')
		const driven = new IndexedDBDriver(database)
		const rows = buildItems(1100)
		const { database: db } = await seedItems(driven, rows)
		try {
			const reads = [
				{},
				{ order: [{ column: 'id', direction: 'descending' as const }] },
				{ order: [{ column: 'rank', direction: 'ascending' as const }] },
				{ conditions: [buildCondition('organization', 'equals', ['o2'])] },
				{
					conditions: [buildCondition('organization', 'equals', ['o2'])],
					order: [{ column: 'id', direction: 'descending' as const }],
				},
				{ conditions: [buildCondition('organization', 'any', ['o2', 'o1'])] },
				{ conditions: [buildCondition('rank', 'from', [90])] },
				{ conditions: [buildCondition('id', 'from', ['k0100'])], offset: 3 },
			]
			for (const input of reads) {
				const streamed = await collect(driven.stream('items', input))
				expect({ input, ids: streamed.map((row) => row.id) }).toEqual({
					input,
					ids: applyQuery(rows, input).map((row) => row.id),
				})
			}
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — rows missing an indexed field', () => {
	it('holds no index entry for a row that lacks the field or holds null, so below, to, and an order stay residual', async () => {
		const database = mintDatabase('database-idb-missing')
		const rows = buildItems(30)
		const { database: db, items } = await seedItems(createIndexedDBDriver(database), rows)
		const wrapper = createIndexedDBDatabase({ name: database, stores: {} })
		try {
			const native = await wrapper.connect()
			const indexed = await Promise.all(
				['tag', 'score'].map((index) =>
					promisifyRequest(
						native.transaction('items', 'readonly').objectStore('items').index(index).count(),
					),
				),
			)
			expect(indexed).toEqual([
				rows.filter((row) => row.tag !== undefined).length,
				rows.filter((row) => row.score !== null).length,
			])
			const reads = [
				{ conditions: [buildCondition('tag', 'below', ['t3'])] },
				{ conditions: [buildCondition('score', 'to', [5])] },
				{ order: [{ column: 'tag', direction: 'ascending' as const }], limit: 5 },
			]
			for (const input of reads) {
				expect(await items.records(input)).toEqual(applyQuery(rows, input))
			}
		} finally {
			wrapper.close()
			await db.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — the index reconcile at open', () => {
	it('drops an undeclared index of an unversioned database at open, keeping its rows', async () => {
		const database = mintDatabase('database-idb-reconcile')
		const both = createDatabase({
			driver: createIndexedDBDriver(database),
			tables: { items: ITEMS },
			indexes: { items: [['organization'], ['rank']] },
		})
		await both.table('items').set(buildItems(10))
		await both.close()
		const one = createDatabase({
			driver: createIndexedDBDriver(database),
			tables: { items: ITEMS },
			indexes: { items: [['organization']] },
		})
		try {
			expect(await one.table('items').records()).toEqual(buildItems(10))
			expect(await readStoredIndexes(database, 'items')).toEqual(['organization'])
		} finally {
			await one.close()
			await deleteDatabase(database)
		}
	})

	it('lists one index after a versioned database reopens with one of two, keeping its rows', async () => {
		const database = mintDatabase('database-idb-reconcile')
		const first = createDatabase({
			driver: createIndexedDBDriver(database),
			tables: { items: ITEMS },
			indexes: { items: [['organization'], ['rank']] },
			version: 1,
		})
		await first.table('items').set(buildItems(10))
		await first.close()
		const second = createDatabase({
			driver: createIndexedDBDriver(database),
			tables: { items: ITEMS },
			indexes: { items: [['rank']] },
			version: 2,
		})
		try {
			expect(await second.table('items').records()).toEqual(buildItems(10))
			expect(await readStoredIndexes(database, 'items')).toEqual(['rank'])
		} finally {
			await second.close()
			await deleteDatabase(database)
		}
	})

	it('drops an index the stamped schema does not declare, at the next pinned version', async () => {
		const database = mintDatabase('database-idb-reconcile')
		const deployed: TableSchema = {
			name: 'items',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'rank', storage: 'integer', optional: false, nullable: false },
			],
			indexes: [['rank']],
		}
		const stamped = createIndexedDBDriver(database)
		await stamped.open([deployed])
		await stamped.stamp?.({ version: 1, schema: [deployed] })
		await stamped.write('items', 'k1', { id: 'k1', rank: 1 })
		await stamped.close()
		const extra = createIndexedDBDatabase({
			name: database,
			stores: { items: { indexes: [{ name: 'id', path: 'id' }] } },
		})
		const before = (await extra.connect()).version
		extra.close()
		const reopened = createIndexedDBDriver(database)
		const wrapper = createIndexedDBDatabase({ name: database, stores: {} })
		try {
			await reopened.open([{ ...deployed, indexes: [] }])
			expect(await reopened.read('items', 'k1')).toEqual({ id: 'k1', rank: 1 })
			expect(await reopened.metadata?.()).toEqual({ version: 1, schema: [deployed] })
			expect([
				(await wrapper.connect()).version,
				await readStoredIndexes(database, 'items'),
			]).toEqual([before + 1, ['rank']])
		} finally {
			wrapper.close()
			await reopened.close()
			await deleteDatabase(database)
		}
	})

	for (const { label, offset } of [
		{ label: 'to the version its upgrade targets', offset: 0 },
		{ label: 'past the version its upgrade targets', offset: 2 },
	]) {
		it(`raises a retryable DRIVER for a concurrent bump ${label}, and a retry drops the index`, async () => {
			const database = mintDatabase('database-idb-reconcile')
			const seeded = createIndexedDBDatabase({
				name: database,
				stores: {
					items: {
						indexes: [
							{ name: 'organization', path: 'organization' },
							{ name: 'rank', path: 'rank' },
						],
					},
				},
			})
			await seeded.store('items').set({ id: 'k1', organization: 'o1', rank: 1 }, 'k1')
			const version = seeded.version
			seeded.close()
			// The bootstrap bumps once to add the metadata store, and the reconcile targets the next.
			const held = await armVersionBump(database, version + 2 + offset)
			const driven = createIndexedDBDriver(database)
			try {
				const schema: TableSchema = {
					name: 'items',
					primary: 'id',
					columns: [
						{ name: 'id', storage: 'text', optional: false, nullable: false },
						{ name: 'organization', storage: 'text', optional: false, nullable: false },
						{ name: 'rank', storage: 'integer', optional: false, nullable: false },
					],
					indexes: [['organization']],
				}
				await expect(driven.open([schema])).rejects.toMatchObject({
					code: 'DRIVER',
					context: { name: database, retryable: true },
				})
				await held.settled
				await driven.open([schema])
				expect(await driven.read('items', 'k1')).toEqual({ id: 'k1', organization: 'o1', rank: 1 })
				expect(await readStoredIndexes(database, 'items')).toEqual(['organization'])
			} finally {
				await driven.close()
				await deleteDatabase(database)
			}
		})
	}
})

describe('IndexedDBDriver — a stored non-record', () => {
	it('raises DRIVER from a point read, a list read, a planned read, and a stream', async () => {
		const database = mintDatabase('database-idb-record')
		const reader = createIndexedDBDriver(database)
		const { database: db, items } = await seedItems(reader, buildItems(6))
		try {
			const wrapper = createIndexedDBDatabase({ name: database, stores: {} })
			await putIndexedDBValue(await wrapper.connect(), 'items', 'k0002', 'payload-secret')
			wrapper.close()
			const failures = await Promise.all([
				captureFailure(() => reader.read('items', 'k0002')),
				captureFailure(() => reader.read('items', ['k0001', 'k0002'])),
				captureFailure(() =>
					items.records({ conditions: [buildCondition('id', 'from', ['k0001'])] }),
				),
				captureFailure(() => collect(items.scan())),
			])
			for (const failure of failures) {
				expect(failure).toMatchObject({ code: 'DRIVER', context: { code: 'RECORD' } })
				expect(JSON.stringify(failure)).not.toContain('payload-secret')
			}
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — fix round 1: streams with a page or a residual read by batches', () => {
	it('reads a paged scan one batch per transaction, so a write past each batch shows in the next', async () => {
		const database = mintDatabase('database-idb-paged-stream')
		const rows = buildItems(5000)
		const { database: db, items } = await seedItems(createIndexedDBDriver(database), rows)
		try {
			const seen: ItemRow[] = []
			for await (const row of items.scan({ limit: 5000 })) {
				seen.push(row)
				const next = seen.length - 1 + STREAM_BATCH_SIZE
				if (seen.length % STREAM_BATCH_SIZE === 1 && next < rows.length) {
					await items.update(buildItem(next).id, { score: -1 })
				}
			}
			expect(seen).toEqual(
				rows.map((row, at) =>
					at > 0 && at % STREAM_BATCH_SIZE === 0 ? { ...row, score: -1 } : row,
				),
			)
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('applies a direct stream residual per batch, so a write past the first batch shows', async () => {
		const database = mintDatabase('database-idb-residual-stream')
		const driven = new IndexedDBDriver(database)
		const rows = buildItems(1100)
		const { database: db, items } = await seedItems(driven, rows)
		try {
			const input = { conditions: [buildCondition('tag', 'like', ['t%'])], limit: 700 }
			const seen: unknown[] = []
			for await (const row of driven.stream('items', input)) {
				seen.push(row.id)
				if (seen.length === 1) await items.update('k0800', { tag: 'zz' })
			}
			const changed = rows.map((row) => (row.id === 'k0800' ? { ...row, tag: 'zz' } : row))
			expect(seen).toEqual(applyQuery(changed, input).map((row) => row.id))
			expect(seen).not.toContain('k0800')
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('rechecks each batch of a listed stream against the rows a write changed or removed', async () => {
		const database = mintDatabase('database-idb-listed-stream')
		const driven = new IndexedDBDriver(database)
		const rows = buildItems(1100)
		const { database: db, items } = await seedItems(driven, rows)
		try {
			const input = { conditions: [buildCondition('organization', 'any', ['o3', 'o1'])] }
			const seen: unknown[] = []
			for await (const row of driven.stream('items', input)) {
				seen.push(row.id)
				if (seen.length === 1) {
					await items.update('k1001', { organization: 'o0' })
					await items.remove('k1003')
				}
			}
			const expected = applyQuery(rows, input)
				.map((row) => row.id)
				.filter((id) => id !== 'k1001' && id !== 'k1003')
			expect(seen).toEqual(expected)
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('streams an index order across a batch boundary inside a run of duplicate keys, both ways', async () => {
		const database = mintDatabase('database-idb-duplicate-order')
		const driven = new IndexedDBDriver(database)
		const rows = buildItems(1100)
		const { database: db } = await seedItems(driven, rows)
		try {
			for (const direction of ['ascending', 'descending'] as const) {
				const input = { order: [{ column: 'organization', direction }] }
				const streamed = await collect(driven.stream('items', input))
				expect({ direction, ids: streamed.map((row) => row.id) }).toEqual({
					direction,
					ids: applyQuery(rows, input).map((row) => row.id),
				})
			}
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — fix round 1: pages, counts, and extremes at their edges', () => {
	it('pages an any on an index and on the primary key, with an offset and descending', async () => {
		const database = mintDatabase('database-idb-listed-pages')
		const driven = new IndexedDBDriver(database)
		const rows = buildItems(40)
		const { database: db, items } = await seedItems(driven, rows)
		try {
			for (const input of LISTED_PAGES) {
				const expected = applyQuery(rows, input).map((row) => row.id)
				expect({ input, ids: (await items.records(input)).map((row) => row.id) }).toEqual({
					input,
					ids: expected,
				})
				const streamed = await collect(driven.stream('items', input))
				expect({ input, ids: streamed.map((row) => row.id) }).toEqual({ input, ids: expected })
			}
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('reads a limit past the engine count as every row', async () => {
		const database = mintDatabase('database-idb-large-limit')
		const driven = new IndexedDBDriver(database)
		const rows = buildItems(12)
		const { database: db, items } = await seedItems(driven, rows)
		try {
			const reads = [
				{ limit: Number.MAX_SAFE_INTEGER },
				{ limit: Number.MAX_SAFE_INTEGER, offset: 2 },
				{ offset: Number.MAX_SAFE_INTEGER, limit: 3 },
				{
					order: [{ column: 'id', direction: 'descending' as const }],
					limit: Number.MAX_SAFE_INTEGER,
				},
				{
					conditions: [buildCondition('organization', 'any', ['o1', 'o2'])],
					limit: Number.MAX_SAFE_INTEGER,
				},
			]
			for (const input of reads) {
				const expected = applyQuery(rows, input).map((row) => row.id)
				expect({ input, ids: (await items.records(input)).map((row) => row.id) }).toEqual({
					input,
					ids: expected,
				})
				const streamed = await collect(driven.stream('items', input))
				expect({ input, ids: streamed.map((row) => row.id) }).toEqual({ input, ids: expected })
			}
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('answers undefined for a minimum and a maximum over an empty store and a zero-match range', async () => {
		const database = mintDatabase('database-idb-empty-extremes')
		const { database: db, items } = await seedItems(createIndexedDBDriver(database), [])
		try {
			expect([
				await items.aggregate('minimum', 'rank'),
				await items.aggregate('maximum', 'rank'),
				await items.count(),
			]).toEqual([undefined, undefined, 0])
			await items.set(buildItems(5))
			expect(
				await items.aggregate('maximum', 'rank', {
					conditions: [buildCondition('rank', 'above', [100])],
				}),
			).toBeUndefined()
		} finally {
			await db.close()
			await deleteDatabase(database)
		}
	})

	it('reads the compound index for its leading equals ahead of a primary-key range, past a tripwire on that range', async () => {
		const database = mintDatabase('database-idb-compound-only')
		const rows = buildItems(40)
		const driven = createDatabase({
			driver: createIndexedDBDriver(database),
			tables: { items: ITEMS },
			indexes: { items: [['organization', 'rank']] },
		})
		await driven.table('items').set(rows)
		try {
			await putTripwire(database, 'items', 'k0002a', { organization: 'o0', rank: 2 })
			const input = {
				conditions: [
					buildCondition('id', 'from', ['k0000']),
					buildCondition('organization', 'equals', ['o1']),
				],
				limit: 4,
			}
			expect(await driven.table('items').records(input)).toEqual(applyQuery(rows, input))
			expect(await driven.table('items').count(input)).toBe(
				applyQuery(rows, { conditions: input.conditions }).length,
			)
		} finally {
			await driven.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — fix round 1: a failed upgrade rolls back its metadata write', () => {
	it('keeps v1 metadata when the index pass after the metadata write refuses the upgrade, and stays usable', async () => {
		const database = mintDatabase('database-idb-post-set')
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: false, nullable: true },
			],
			indexes: [['age']],
		}
		const posts: TableSchema = {
			name: 'posts',
			primary: 'id',
			columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
			indexes: [],
		}
		const first = createIndexedDBDriver(database)
		await first.open([deployed])
		await first.write('users', 'u1', { id: 'u1', age: 30 })
		await first.stamp?.({ version: 1, schema: [deployed] })
		await first.close()
		// Rewrite the declared `age` index over another path: a pinned open and a pinned recovery
		// keep it, and the wrapper's index pass, which runs after the upgrade callback, refuses it.
		const reader = createIndexedDBDatabase({ name: database, stores: {} })
		const version = (await reader.connect()).version
		reader.close()
		const rewrite = createIndexedDBDatabase({
			name: database,
			version: version + 1,
			stores: {},
			upgrade: (context) => {
				context.indexes.drop('users', 'age')
				context.indexes.create('users', { name: 'age', path: 'id' })
			},
		})
		await rewrite.connect()
		rewrite.close()
		const migrating = createIndexedDBDriver(database)
		const checking = createIndexedDBDriver(database)
		try {
			await migrating.open([deployed])
			const error = await migrating
				.migrate?.({
					plan: { from: 1, to: 2, steps: [{ operation: 'table.add', table: posts }] },
					metadata: { version: 2, schema: [deployed, posts] },
				})
				.catch((caught: unknown) => caught)
			expect(error).toMatchObject({ code: 'MIGRATION' })
			expect(await migrating.metadata?.()).toEqual({ version: 1, schema: [deployed] })
			expect(await migrating.read('users', 'u1')).toEqual({ id: 'u1', age: 30 })
			await checking.open([deployed])
			expect(await checking.metadata?.()).toEqual({ version: 1, schema: [deployed] })
			expect(await checking.read('users', 'u1')).toEqual({ id: 'u1', age: 30 })
			const wrapper = createIndexedDBDatabase({ name: database, stores: {} })
			await wrapper.connect()
			expect(wrapper.stores).not.toContain('posts')
			wrapper.close()
		} finally {
			await migrating.close()
			await checking.close()
			await deleteDatabase(database)
		}
	})
})

describe('IndexedDBDriver — ill-formed text', () => {
	it('refuses a lone surrogate before the driver, and round-trips one in a json cell', async () => {
		const database = mintDatabase('database-idb-surrogate')
		await deleteDatabase(database)
		const { recorder, table } = await createDoorTable(createIndexedDBDriver(database))
		try {
			expect(await readIllFormedText(table, recorder)).toMatchObject(ILL_FORMED_RESULT)
		} finally {
			await recorder.driver.close()
			await deleteDatabase(database)
		}
	})
})
