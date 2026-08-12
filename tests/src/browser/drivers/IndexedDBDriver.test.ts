import type { DriverInterface, TableSchema } from '@src/core'
import {
	applyQuery,
	createDatabase,
	createMemoryDriver,
	isDatabaseError,
	planMigration,
} from '@src/core'
import { createIndexedDBDriver, deriveIndexedDBIndexName, schemaToStore } from '@src/browser'
import { createIndexedDBDatabase } from '@orkestrel/indexeddb'
import { integerShape, jsonShape, stringShape } from '@orkestrel/contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCondition, collectRows, conformDriver, tableSchemas } from '../../../setup.js'
import { deleteDatabase, putIndexedDBValue, uniqueName } from '../../../setupBrowser.js'

// The IndexedDB DriverInterface implementation, exercised directly in real
// Chromium — the storage primitives the core database layer builds on,
// delegating to the published `@orkestrel/indexeddb` wrapper, schema-driven
// secondary index creation, and the native records / count / stream pushdown
// hooks.

let counter = 0
let name = ''
let driver: DriverInterface

beforeEach(async () => {
	counter += 1
	name = `taverna-idbdriver-${counter}`
	await deleteDatabase(name)
	driver = createIndexedDBDriver(name)
	await driver.open(tableSchemas('users'))
})

describe('IndexedDBDriver — abort while the shared lazy open is blocked', () => {
	it('rejects promptly and never dispatches the row mutation after readiness later settles', async () => {
		const blockedName = uniqueName('taverna-idbdriver-blocked')
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
		let error: unknown
		try {
			error = await writing.catch((caught: unknown) => caught)
		} finally {
			blocker.close()
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('ABORTED')
		await database.open()
		expect(await users.get('u1')).toBeUndefined()
		await database.close()
		await deleteDatabase(blockedName)
	})
})

afterEach(async () => {
	await driver.close()
	await deleteDatabase(name)
})

conformDriver('IndexedDBDriver', () =>
	createIndexedDBDriver(uniqueName('taverna-idbdriver-conform')),
)

describe('IndexedDBDriver — storage primitives over the wrapper', () => {
	it('reads back what it writes; misses are undefined / false', async () => {
		await driver.write('users', 'u1', { id: 'u1', n: 1 })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
		expect(await driver.read('users', 'missing')).toBeUndefined()
		expect(await driver.delete('users', 'missing')).toBe(false)
		expect(await driver.delete('users', 'u1')).toBe(true)
		expect(await driver.read('users', 'u1')).toBeUndefined()
	})

	it('atomically inserts one row when the same key is submitted concurrently', async () => {
		const outcomes = await Promise.all([
			driver.insert('users', 'u1', { id: 'u1', name: 'Ada' }).then(
				() => 'fulfilled',
				(error: unknown) => (isDatabaseError(error) ? error.code : 'unexpected'),
			),
			driver.insert('users', 'u1', { id: 'u1', name: 'Grace' }).then(
				() => 'fulfilled',
				(error: unknown) => (isDatabaseError(error) ? error.code : 'unexpected'),
			),
		])
		expect([...outcomes].sort()).toEqual(['CONFLICT', 'fulfilled'])
		expect(await driver.keys('users')).toEqual(['u1'])
		expect(['Ada', 'Grace']).toContain((await driver.read('users', 'u1'))?.name)
	})

	it('rejects pre-aborted and actively aborted inserts without storing a row', async () => {
		const before = new AbortController()
		before.abort('stop before insert')
		await expect(
			driver.insert('users', 'before', { id: 'before' }, { signal: before.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await driver.read('users', 'before')).toBeUndefined()

		const active = new AbortController()
		const row = {
			id: 'active',
			get payload(): string {
				active.abort('stop active insert')
				return 'value'
			},
		}
		await expect(
			driver.insert('users', 'active', row, { signal: active.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await driver.read('users', 'active')).toBeUndefined()
	})

	it('lists keys and scans in key order, and clears', async () => {
		await driver.write('users', 'a', { id: 'a' })
		await driver.write('users', 'b', { id: 'b' })
		expect(await driver.keys('users')).toEqual(['a', 'b'])
		expect((await collectRows(driver.scan('users'))).map((row) => row.id)).toEqual(['a', 'b'])
		await driver.clear('users')
		expect(await driver.keys('users')).toEqual([])
	})

	it('aborts an active write transaction and rolls the row back', async () => {
		const controller = new AbortController()
		const row = {
			id: 'active',
			get payload(): string {
				controller.abort('stop active write')
				return 'value'
			},
		}
		const writing = driver.write('users', 'active', row, { signal: controller.signal })
		await expect(writing).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await driver.read('users', 'active')).toBeUndefined()
	})

	it('leaves a row intact when delete is aborted before native dispatch', async () => {
		// The public driver surface exposes no lifecycle point between delete's
		// presence read and remove request. Keep this proof deterministic rather
		// than inferring an active boundary from a timer or payload size.
		await driver.write('users', 'u1', { id: 'u1', n: 1 })
		const controller = new AbortController()
		controller.abort('stop before delete')
		await expect(driver.delete('users', 'u1', { signal: controller.signal })).rejects.toMatchObject(
			{
				code: 'ABORTED',
			},
		)
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('does not let a late abort convert a completed transaction success', async () => {
		const controller = new AbortController()
		await driver.write('users', 'u1', { id: 'u1', n: 1 }, { signal: controller.signal })
		controller.abort('too late')
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('creates a new store on reopen with more tables (auto-managed version)', async () => {
		await driver.open(tableSchemas('users', 'posts'))
		await driver.write('posts', 'p1', { id: 'p1', title: 'Hello' })
		expect(await driver.read('posts', 'p1')).toEqual({ id: 'p1', title: 'Hello' })
	})

	it('opens only the persisted deployed schema before migration', async () => {
		const users = tableSchemas('users')
		const metadata = { version: 1, schema: users }
		await driver.stamp?.(metadata)
		await driver.close()

		const reopened = createIndexedDBDriver(name)
		await reopened.open(tableSchemas('users', 'posts'))
		const planned =
			reopened.records === undefined
				? Promise.resolve(undefined)
				: reopened.records('posts', { conditions: [] })
		const error = await planned.catch((caught: unknown) => caught)
		const stored = await reopened.metadata?.()

		const wrapper = createIndexedDBDatabase({
			name,
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
		await driver.open(schema)
		await driver.stamp?.({ version: 1, schema })
		await driver.close()

		const inspected = createIndexedDBDatabase({
			name,
			stores: { __metadata__: {}, users: {}, posts: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()
		const damaged = createIndexedDBDatabase({
			name,
			version: version + 1,
			stores: { __metadata__: {}, users: {}, posts: {}, audit: {} },
			upgrade: (context) => {
				context.drop('users')
				context.drop('posts')
			},
		})
		await damaged.connect()
		await damaged.store('audit').set({ retained: true }, 'entry')
		const damagedVersion = damaged.version
		damaged.close()

		await expect(driver.open(schema)).rejects.toMatchObject({
			code: 'DRIVER',
			message: 'Stored IndexedDB store is missing',
			context: {
				name,
				store: 'users',
				aspect: 'missing',
			},
		})
		await expect(driver.metadata?.()).rejects.toMatchObject({
			code: 'CLOSED',
			context: { name },
		})

		const physical = createIndexedDBDatabase({
			name,
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
			name,
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

		await driver.open(schema)
		await driver.write('users', 'u1', { id: 'u1', repaired: true })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', repaired: true })
		const reopened = createIndexedDBDatabase({
			name,
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
		await driver.stamp?.({ version: 1, schema })
		await driver.close()

		const inspected = createIndexedDBDatabase({
			name,
			stores: { __metadata__: {}, users: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()

		const opening = driver.open(schema).catch((caught: unknown) => caught)
		const external = createIndexedDBDatabase({
			name,
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
		await expect(driver.metadata?.()).rejects.toMatchObject({
			code: 'CLOSED',
			context: { name },
		})

		await driver.open(schema)
		await driver.write('users', 'u1', { id: 'u1', resumed: true })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', resumed: true })
		const reopened = createIndexedDBDatabase({
			name,
			version: changedVersion,
			stores: { __metadata__: {}, users: {}, external: {} },
		})
		await reopened.connect()
		expect(reopened.version).toBe(changedVersion)
		expect(reopened.stores).toContain('external')
		reopened.close()
	})

	it('rolls back to a whole-store snapshot atomically', async () => {
		await driver.write('users', 'a', { id: 'a', n: 1 })
		const rollback = await driver.snapshot()
		await driver.write('users', 'a', { id: 'a', n: 2 })
		await driver.write('users', 'b', { id: 'b' })
		expect(await driver.read('users', 'a')).toEqual({ id: 'a', n: 2 })
		await rollback()
		expect(await driver.read('users', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('users', 'b')).toBeUndefined()
	})

	it('rolls back only the named tables in a scoped snapshot', async () => {
		await driver.open(tableSchemas('users', 'posts'))
		await driver.write('users', 'a', { id: 'a', n: 1 })
		await driver.write('posts', 'p1', { id: 'p1', title: 'Hello' })
		const rollback = await driver.snapshot(['users'])
		await driver.write('users', 'a', { id: 'a', n: 2 })
		await driver.write('posts', 'p1', { id: 'p1', title: 'Changed' })
		await rollback()
		// Scoped table restored...
		expect(await driver.read('users', 'a')).toEqual({ id: 'a', n: 1 })
		// ...but the untouched table keeps its post-snapshot mutation.
		expect(await driver.read('posts', 'p1')).toEqual({ id: 'p1', title: 'Changed' })
	})

	it('persists across close and reopen', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
		await driver.close()
		const reopened = createIndexedDBDriver(name)
		await reopened.open(tableSchemas('users'))
		expect(await reopened.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
		await reopened.close()
	})

	it('creates the declared secondary indexes from the schema', async () => {
		// A FRESH name so the store is created WITH its indexes (indexes are only
		// built at store-creation time).
		const indexed = `taverna-idbdriver-index-${counter}`
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
		// index is named via `deriveIndexedDBIndexName` — a length-prefixed encoding, NOT the
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
	it('shares imported schema, guards before paging, binds raw keys, and reopens the union', async () => {
		const composed = uniqueName('taverna-idb-composed')
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
			expect(await users.records({ limit: 1 })).toEqual([{ id: 'b', name: 'Valid' }])
			expect(await collectRows(users.scan({ limit: 1 }))).toEqual([{ id: 'b', name: 'Valid' }])
			expect(await users.count()).toBe(1)
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
		const records = driver.records
		const stream = driver.stream
		if (records === undefined) throw new Error('Expected records capability')
		if (stream === undefined) throw new Error('Expected stream capability')
		await expect(records.call(driver, 'users', { limit: -1 })).rejects.toMatchObject({
			code: 'VALIDATION',
			context: { field: 'limit', value: -1 },
		})
		expect(() => stream.call(driver, 'users', { offset: Number.NaN })).toThrow(
			expect.objectContaining({
				code: 'VALIDATION',
				context: { field: 'offset', value: 'NaN' },
			}),
		)
		expect(await records.call(driver, 'users', { limit: 0 })).toEqual([])
		expect(await collectRows(stream.call(driver, 'users', { limit: 0 }))).toEqual([])
	})

	// A real database over the IndexedDB driver, with a single-column secondary
	// index on `age` (so age queries push to a key-range) and none on `name` (so
	// name queries fall back to a scan + the engine). Behavior is asserted through
	// the observable Table API — rows / counts must be correct regardless of path.
	const PEOPLE: ReadonlyArray<{
		readonly id: string
		readonly name: string
		readonly age: number
	}> = [
		{ id: 'u1', name: 'Ada', age: 36 },
		{ id: 'u2', name: 'Bo', age: 22 },
		{ id: 'u3', name: 'Cy', age: 41 },
		{ id: 'u4', name: 'Di', age: 22 },
		{ id: 'u5', name: 'Eve', age: 55 },
	]

	let dbName = ''
	let people = createDatabase({
		driver: createIndexedDBDriver('unused'),
		tables: { people: { id: stringShape(), name: stringShape(), age: integerShape() } },
	}).table('people')

	beforeEach(async () => {
		dbName = uniqueName('taverna-idb-pushdown')
		await deleteDatabase(dbName)
		const db = createDatabase({
			driver: createIndexedDBDriver(dbName),
			tables: { people: { id: stringShape(), name: stringShape(), age: integerShape() } },
			indexes: { people: [['age']] },
		})
		people = db.table('people')
		await people.set([...PEOPLE])
	})

	afterEach(async () => {
		await deleteDatabase(dbName)
	})

	it('an indexed-column range query returns the right filtered, ordered, paged rows', async () => {
		// age >= 36, descending by age — pushes to the `age` index range, then the
		// engine orders + pages. Expect Eve(55), Cy(41), Ada(36) → drop the first.
		const rows = await people
			.query()
			.condition({ column: 'age', operator: 'from', values: [36], connector: 'and' })
			.order({ column: 'age', direction: 'descending' })
			.offset(1)
			.limit(1)
			.collect()
		expect(rows).toEqual([{ id: 'u3', name: 'Cy', age: 41 }])
	})

	it('returns every match for an indexed equality and table count agrees', async () => {
		const rows = await people
			.query()
			.condition({ column: 'age', operator: 'equals', values: [22], connector: 'and' })
			.collect()
		expect(rows.map((row) => row.id).sort()).toEqual(['u2', 'u4'])
		// A single pushable equality → the native key-range count path.
		expect(
			await people
				.query()
				.condition({ column: 'age', operator: 'equals', values: [22], connector: 'and' })
				.count(),
		).toBe(2)
	})

	it('a non-indexed-column query still returns correct rows (scan + engine)', async () => {
		// `name` has no index → full scan, the engine applies `starts`.
		const rows = await people
			.query()
			.condition({ column: 'name', operator: 'starts', values: ['A'], connector: 'and' })
			.collect()
		expect(rows).toEqual([{ id: 'u1', name: 'Ada', age: 36 }])
		expect(
			await people
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['e'], connector: 'and' })
				.count(),
		).toBe(1) // 'Eve'
	})

	it('a multi-condition query (indexed + extra predicate) returns exact rows + count', async () => {
		// age >= 22 (pushes to the index, a superset) AND name not 'Bo' (engine refines).
		const query = people
			.query()
			.condition({ column: 'age', operator: 'from', values: [22], connector: 'and' })
			.condition({ column: 'name', operator: 'not', values: ['Bo'], connector: 'and' })
		const rows = await query.order({ column: 'id', direction: 'ascending' }).collect()
		expect(rows.map((row) => row.id)).toEqual(['u1', 'u3', 'u4', 'u5'])
		expect(await query.count()).toBe(4)
	})

	it('an unconditional count uses the native store count', async () => {
		expect(await people.query().count()).toBe(PEOPLE.length)
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
			expect(await people.records(input)).toEqual(await reference.records(input))
			expect(await people.count(input)).toBe(await reference.count(input))
			expect(await collectRows(people.scan(input))).toEqual(
				await collectRows(reference.scan(input)),
			)
		}
		await memory.close()
	})

	it('an or-joined query full-scans and matches the engine over a plain scan', async () => {
		const conditions = [
			buildCondition('age', 'from', [40]),
			buildCondition('name', 'equals', ['Bo'], 'or'),
		]
		const rows = await people
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
		dbName = uniqueName('taverna-idb-nested')
		await deleteDatabase(dbName)
		const db = createDatabase({
			driver: createIndexedDBDriver(dbName),
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
		for await (const row of people
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
		expect(await driver.metadata?.()).toBeUndefined()
		const metadata = { version: 1, schema: tableSchemas('users') }
		await driver.stamp?.(metadata)
		expect(await driver.metadata?.()).toEqual(metadata)
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
		const corruptName = uniqueName('taverna-idb-corrupt-metadata')
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
			await inspected.connect()
			expect(await inspected.store('__metadata__').has('metadata')).toBe(true)
			const retained = await inspected.store('__metadata__').get('metadata')
			const expected = typeof value === 'object' && value !== null ? value : undefined
			expect(retained).toEqual(expected)
			inspected.close()
		} finally {
			await recovered.close()
			await deleteDatabase(corruptName)
		}
	})

	it('closes a failed bootstrap and retries the same driver after external repair', async () => {
		const repairName = uniqueName('taverna-idb-repair-metadata')
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
		await driver.stamp?.(metadata)
		await driver.close()
		const reopened = createIndexedDBDriver(name)
		await reopened.open(tableSchemas('users'))
		expect(await reopened.metadata?.()).toEqual(metadata)
		await reopened.close()
	})

	it('accepts reorder-only migration metadata', async () => {
		const canonical = tableSchemas('users', 'posts')
		await driver.open(canonical)
		const reordered = [...canonical].reverse()
		await driver.migrate?.({
			plan: { from: 1, to: 2, steps: [] },
			metadata: { version: 2, schema: reordered },
		})
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: reordered })
	})

	it('rejects an unsafe required column before rows, schema, and metadata change', async () => {
		const before = tableSchemas('users')
		await driver.write('users', 'u1', { id: 'u1' })
		await driver.stamp?.({ version: 1, schema: before })
		await expect(
			driver.migrate?.({
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
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
		expect(await driver.metadata?.()).toEqual({ version: 1, schema: before })

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
			driver.migrate?.({
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

	it('the reserved metadata store is excluded from a whole-store snapshot rollback', async () => {
		const first = { version: 1, schema: tableSchemas('users') }
		await driver.stamp?.(first)
		const rollback = await driver.snapshot()
		const second = { version: 2, schema: tableSchemas('users') }
		await driver.stamp?.(second)
		await rollback()
		// The whole-store rollback restored table data but must NOT have touched
		// the reserved metadata store — the newer stamp survives.
		expect(await driver.metadata?.()).toEqual(second)
	})

	it('reconciles a real Database table removal and preserves a same-version reopen', async () => {
		const versioned = uniqueName('taverna-idb-version-remove')
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
		let preserved: unknown
		let stores: readonly string[] = []
		let stamped: unknown
		let version = 0
		let reopened: unknown
		let storesAgain: readonly string[] = []
		let stampedAgain: unknown
		let versionAgain = 0
		try {
			await v1.table('users').set({ id: 'u1', name: 'Ada' })
			await v1.table('audit').set({ id: 'a1', message: 'created' })
			await v1.close()
			await v2.open()
			preserved = await v2.table('users').get('u1')
			await v2.close()

			const inspected = createIndexedDBDatabase({
				name: versioned,
				stores: { __metadata__: {}, users: {} },
			})
			await inspected.connect()
			stores = inspected.stores
			stamped = await inspected.store('__metadata__').get('metadata')
			version = inspected.version
			inspected.close()

			await again.open()
			reopened = await again.table('users').get('u1')
			await again.close()

			const repeated = createIndexedDBDatabase({
				name: versioned,
				stores: { __metadata__: {}, users: {} },
			})
			await repeated.connect()
			storesAgain = repeated.stores
			stampedAgain = await repeated.store('__metadata__').get('metadata')
			versionAgain = repeated.version
			repeated.close()
		} finally {
			await v1.close()
			await v2.close()
			await again.close()
			await deleteDatabase(versioned)
		}

		expect(preserved).toEqual({ id: 'u1', name: 'Ada' })
		expect(stores).not.toContain('audit')
		expect(stamped).toMatchObject({ version: 2 })
		expect(reopened).toEqual({ id: 'u1', name: 'Ada' })
		expect(storesAgain).toEqual(stores)
		expect(stampedAgain).toEqual(stamped)
		expect(versionAgain).toBe(version)
	})

	it('reconciles a real Database table addition while preserving deployed rows', async () => {
		const versioned = uniqueName('taverna-idb-version-add')
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
		let preserved: unknown
		let added: unknown
		let stores: readonly string[] = []
		let stamped: unknown
		try {
			await v1.table('users').set({ id: 'u1', name: 'Ada' })
			await v1.close()
			await v2.open()
			await v2.table('posts').set({ id: 'p1', title: 'First' })
			preserved = await v2.table('users').get('u1')
			added = await v2.table('posts').get('p1')
			await v2.close()

			const inspected = createIndexedDBDatabase({
				name: versioned,
				stores: { __metadata__: {}, users: {}, posts: {} },
			})
			await inspected.connect()
			stores = inspected.stores
			stamped = await inspected.store('__metadata__').get('metadata')
			inspected.close()
		} finally {
			await v1.close()
			await v2.close()
			await deleteDatabase(versioned)
		}

		expect(preserved).toEqual({ id: 'u1', name: 'Ada' })
		expect(added).toEqual({ id: 'p1', title: 'First' })
		expect(stores).toContain('posts')
		expect(stamped).toMatchObject({ version: 2 })
	})

	it('table.add creates a usable store via migrate', async () => {
		await driver.migrate?.({
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
		await driver.write('posts', 'p1', { id: 'p1', title: 'Hello' })
		expect(await driver.read('posts', 'p1')).toEqual({ id: 'p1', title: 'Hello' })
	})

	it('table.remove drops a store via migrate', async () => {
		await driver.open(tableSchemas('users', 'posts'))
		await driver.write('posts', 'p1', { id: 'p1' })
		await driver.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'table.remove', table: 'posts' }],
			},
		})
		await expect(driver.read('posts', 'p1')).rejects.toThrow('posts')
	})

	it('replays table.add then table.remove in order without leaving a store', async () => {
		await driver.migrate?.({
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
		await expect(driver.read('posts', 'p1')).rejects.toThrow('posts')
		const inspected = createIndexedDBDatabase({
			name,
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
		await driver.open([deployed])
		await driver.write('users', 'old', { id: 'old' })
		await driver.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{ operation: 'table.remove', table: 'users' },
					{ operation: 'table.add', table: replacement },
				],
			},
		})
		expect(await driver.read('users', 'old')).toBeUndefined()
		await driver.write('users', 'new', { id: 'new', age: 41 })
		const rows = await driver.records?.('users', {
			conditions: [buildCondition('age', 'equals', [41])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['new'])
	})

	it('replays index.add then index.remove in order on a newly added table', async () => {
		await driver.migrate?.({
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
			name,
			stores: { __metadata__: {}, users: {}, posts: {} },
		})
		await inspected.connect()
		const transaction = inspected.database.transaction('posts', 'readonly')
		expect([...transaction.objectStore('posts').indexNames]).toEqual([])
		inspected.close()
	})

	it('replays table.add then index.add with the final index present and usable', async () => {
		await driver.migrate?.({
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
		await driver.write('posts', 'p1', { id: 'p1', rank: 7 })
		const rows = await driver.records?.('posts', {
			conditions: [buildCondition('rank', 'equals', [7])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['p1'])
		const inspected = createIndexedDBDatabase({
			name,
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
		await driver.open([deployed])
		await driver.write('users', 'u1', { id: 'u1', legacy: 'old' })
		await driver.migrate?.({
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
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
		await driver.write('users', 'u2', { id: 'u2', legacy: 2 })
		await driver.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'index.add', table: 'users', index: ['legacy'] }],
			},
		})
		const rows = await driver.records?.('users', {
			conditions: [buildCondition('legacy', 'equals', [2])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['u2'])
	})

	it('index.add on an existing store becomes visible (secondary-index read works)', async () => {
		await driver.open([
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
		await driver.write('users', 'u1', { id: 'u1', age: 30 })
		await driver.write('users', 'u2', { id: 'u2', age: 41 })
		await driver.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'index.add', table: 'users', index: ['age'] }],
			},
		})
		await driver.close()
		// Read the live IDBIndex through a fresh wrapper connection over the SAME
		// database — a non-tautological existence proof of the created index.
		const wrapper = createIndexedDBDatabase({
			name,
			stores: { users: { indexes: [{ name: 'age', path: 'age' }] } },
		})
		await wrapper.connect()
		expect((await wrapper.store('users').index('age').get(41))?.id).toBe('u2')
		wrapper.close()
		driver = createIndexedDBDriver(name)
		await driver.open(tableSchemas('users'))
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
		await driver.open([deployed])
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', legacy: true })
		await driver.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
			},
		})
		const migrated = await driver.read('users', 'u1')
		expect(migrated).toEqual({ id: 'u1', name: 'Ada' })
		await driver.close()
		const reopened = createIndexedDBDriver(name)
		await reopened.open([declared])
		expect(await reopened.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
		await reopened.close()
		driver = createIndexedDBDriver(name)
		await driver.open(tableSchemas('users'))
	})

	it('reconnects a yielded wrapper before reading its version for migration', async () => {
		const inspected = createIndexedDBDatabase({
			name,
			stores: { __metadata__: {}, users: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()
		const external = createIndexedDBDatabase({
			name,
			version: version + 1,
			stores: { __metadata__: {}, users: {}, external: {} },
		})
		await external.connect()
		external.close()

		await driver.migrate?.({
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
		await driver.write('users', 'u1', { id: 'u1', added: 'ready' })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', added: 'ready' })
	})

	it('reopening with a reduced schema drops ghost tables (unresolvable, no stale pushdown)', async () => {
		await driver.open(tableSchemas('users', 'posts'))
		await driver.write('posts', 'p1', { id: 'p1' })
		// Reopen with ONLY 'users' declared — the ghost 'posts' table must not
		// remain resolvable by planning (`#table` / `records` / `stream`).
		await driver.open(tableSchemas('users'))
		const ghostRecords =
			driver.records === undefined
				? Promise.resolve(undefined)
				: driver.records('posts', { conditions: [] })
		await expect(ghostRecords).rejects.toThrow('posts')
	})

	it('a mid-upgrade migrate failure leaves #schema/database at the pre-failure state, and a later valid migrate still succeeds', async () => {
		const deployed: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: false, nullable: true },
			],
			indexes: [['age']],
		}
		await driver.open([deployed])
		await driver.write('users', 'u1', { id: 'u1', age: 30 })
		const metadata = { version: 1, schema: [deployed] }
		await driver.stamp?.(metadata)
		// One versionchange creates a store and index before a duplicate-index
		// fault aborts the whole upgrade, including its metadata stamp.
		await expect(
			driver.migrate?.({
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
						{ operation: 'index.remove', table: 'users', index: ['age'] },
					],
				},
				metadata: {
					version: 2,
					schema: [
						{ ...deployed, indexes: [] },
						{
							name: 'posts',
							primary: 'id',
							columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
							indexes: [],
						},
					],
				},
			}),
		).rejects.toThrow(`Upgrade of '${name}' failed`)
		// The driver reconnects at the exact pre-migration state.
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', age: 30 })
		expect(await driver.metadata?.()).toEqual(metadata)
		await expect(driver.read('posts', 'p1')).rejects.toThrow('posts')
		await driver.write('users', 'u2', { id: 'u2', age: 40 })
		expect(await driver.read('users', 'u2')).toEqual({ id: 'u2', age: 40 })
		// A subsequent valid migration proves the failed candidate was discarded.
		await driver.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'index.add', table: 'users', index: ['id'] }],
			},
		})
		await driver.close()
		const wrapper = createIndexedDBDatabase({
			name,
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
		driver = createIndexedDBDriver(name)
		await driver.open(tableSchemas('users'))
	})

	it('recovers its pre-migration schema after a real duplicate-index upgrade failure', async () => {
		const dual = uniqueName('taverna-idb-dual-recovery')
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
						steps: [{ operation: 'index.add', table: 'users', index: ['age'] }],
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
		await driver.write('users', 'u1', { id: 'u1' })
		let caught: unknown
		try {
			await driver.migrate?.({
				plan: {
					from: 0,
					to: 1,
					steps: [{ operation: 'table.remove', table: 'ghost' }],
				},
			})
		} catch (error) {
			caught = error
		}
		expect(isDatabaseError(caught) && caught.code === 'MIGRATION').toBe(true)
		// The connection is still usable — no version bump was wasted.
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
		await driver.write('users', 'u2', { id: 'u2' })
		expect(await driver.read('users', 'u2')).toEqual({ id: 'u2' })
	})
})

describe('IndexedDBDriver — the audit reproduction (below/to over a nullable indexed column)', () => {
	// The exact reproduction: a nullable `age` with its own secondary index, and a
	// row ('b') where `age` is entirely ABSENT. The engine's total order ranks
	// absent/null BELOW every number, so `below`/`to` must include 'b' — but a
	// naive index-range read would silently drop it (no index entry exists for an
	// absent field). `records` / `count` / `stream` must all agree with a plain
	// engine-over-scan.
	const SCHEMA: TableSchema = {
		name: 'people',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: true },
		],
		indexes: [['age']],
	}
	const ROWS: ReadonlyArray<{ readonly id: string; readonly age?: number }> = [
		{ id: 'a', age: 10 },
		{ id: 'b' },
	]

	let dbName = ''
	let repro: DriverInterface = createIndexedDBDriver('unused')

	beforeEach(async () => {
		dbName = uniqueName('taverna-idb-repro')
		await deleteDatabase(dbName)
		repro = createIndexedDBDriver(dbName)
		await repro.open([SCHEMA])
		for (const row of ROWS) await repro.write('people', row.id, { ...row })
	})

	afterEach(async () => {
		await repro.close()
		await deleteDatabase(dbName)
	})

	it("records: to(100) includes row 'b' (its absent age ranks below 100 under the engine's order)", async () => {
		const rows = await repro.records?.('people', {
			conditions: [buildCondition('age', 'to', [100])],
		})
		expect(rows?.map((row) => row.id).sort()).toEqual(['a', 'b'])
	})

	it("records: below(100) includes row 'b'", async () => {
		const rows = await repro.records?.('people', {
			conditions: [buildCondition('age', 'below', [100])],
		})
		expect(rows?.map((row) => row.id).sort()).toEqual(['a', 'b'])
	})

	it("stream: to(100) / below(100) both yield row 'b'", async () => {
		const toRows =
			repro.stream === undefined
				? []
				: await collectRows(
						repro.stream('people', { conditions: [buildCondition('age', 'to', [100])] }),
					)
		const belowRows =
			repro.stream === undefined
				? []
				: await collectRows(
						repro.stream('people', { conditions: [buildCondition('age', 'below', [100])] }),
					)
		expect(toRows.map((row) => row.id).sort()).toEqual(['a', 'b'])
		expect(belowRows.map((row) => row.id).sort()).toEqual(['a', 'b'])
	})

	it('matches a plain engine-over-scan for both operators (superset contract holds)', async () => {
		const scanned = await collectRows(repro.scan('people'))
		const expectedTo = applyQuery(scanned, { conditions: [buildCondition('age', 'to', [100])] })
		const expectedBelow = applyQuery(scanned, {
			conditions: [buildCondition('age', 'below', [100])],
		})
		const to = await repro.records?.('people', { conditions: [buildCondition('age', 'to', [100])] })
		const below = await repro.records?.('people', {
			conditions: [buildCondition('age', 'below', [100])],
		})
		expect(to?.map((row) => row.id).sort()).toEqual(expectedTo.map((row) => row.id).sort())
		expect(below?.map((row) => row.id).sort()).toEqual(expectedBelow.map((row) => row.id).sort())
	})
})

describe('IndexedDBDriver — reversed between bounds', () => {
	const SCHEMA: TableSchema = {
		name: 'people',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: false },
		],
		indexes: [['age']],
	}

	let dbName = ''
	let reversed: DriverInterface = createIndexedDBDriver('unused')

	beforeEach(async () => {
		dbName = uniqueName('taverna-idb-reversed')
		await deleteDatabase(dbName)
		reversed = createIndexedDBDriver(dbName)
		await reversed.open([SCHEMA])
		await reversed.write('people', 'a', { id: 'a', age: 10 })
		await reversed.write('people', 'b', { id: 'b', age: 20 })
	})

	afterEach(async () => {
		await reversed.close()
		await deleteDatabase(dbName)
	})

	it('a reversed same-type between (id) returns empty and never throws', async () => {
		await expect(
			reversed.records?.('people', { conditions: [buildCondition('id', 'between', ['z', 'a'])] }),
		).resolves.toEqual([])
	})

	it('a reversed mixed-value between (age, numeric) returns empty and never throws', async () => {
		await expect(
			reversed.records?.('people', { conditions: [buildCondition('age', 'between', [100, 1])] }),
		).resolves.toEqual([])
	})

	it('stream over a reversed between yields nothing and never throws', async () => {
		const rows =
			reversed.stream === undefined
				? []
				: await collectRows(
						reversed.stream('people', {
							conditions: [buildCondition('age', 'between', [100, 1])],
						}),
					)
		expect(rows).toEqual([])
	})
})

describe('IndexedDBDriver — snapshot point-in-time consistency', () => {
	it('snapshot([]) is a no-op capture/restore (no stores named)', async () => {
		const rollback = await driver.snapshot([])
		await driver.write('users', 'a', { id: 'a' })
		await rollback()
		// Nothing was captured, so nothing is restored — the write survives.
		expect(await driver.read('users', 'a')).toEqual({ id: 'a' })
	})

	it('a whole-store snapshot still round-trips exactly (capture now runs in ONE read transaction)', async () => {
		await driver.write('users', 'a', { id: 'a', n: 1 })
		await driver.write('users', 'b', { id: 'b', n: 2 })
		const rollback = await driver.snapshot()
		await driver.write('users', 'a', { id: 'a', n: 99 })
		await driver.delete('users', 'b')
		await driver.write('users', 'c', { id: 'c', n: 3 })
		await rollback()
		expect(await driver.read('users', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('users', 'b')).toEqual({ id: 'b', n: 2 })
		expect(await driver.read('users', 'c')).toBeUndefined()
	})
})

describe('IndexedDBDriver — schema-aware snapshot', () => {
	it('treats an explicit unknown-only capture as a repeatable no-op', async () => {
		await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
		const rollback = await driver.snapshot(['missing', 'missing'])
		await driver.write('users', 'u1', { id: 'u1', value: 'current' })
		await rollback()
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'current' })
	})

	it('replays exactly while preserving a later table and current metadata', async () => {
		const before = tableSchemas('users')
		const current = tableSchemas('users', 'logs')
		await driver.stamp?.({ version: 1, schema: before })
		await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
		const rollback = await driver.snapshot()
		await driver.migrate?.({
			plan: planMigration(before, current, 1, 2),
			metadata: { version: 2, schema: current },
		})
		await driver.write('users', 'u1', { id: 'u1', value: 'changed' })
		await driver.write('users', 'u2', { id: 'u2' })
		await driver.write('logs', 'l1', { id: 'l1', value: 'current' })

		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'captured' })
		expect(await driver.read('users', 'u2')).toBeUndefined()
		expect(await driver.read('logs', 'l1')).toEqual({ id: 'l1', value: 'current' })
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: current })

		await driver.write('users', 'u1', { id: 'u1', value: 'changed again' })
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'captured' })
		expect(await driver.read('logs', 'l1')).toEqual({ id: 'l1', value: 'current' })
	})

	it('skips a captured table removed after capture', async () => {
		const schema = tableSchemas('users')
		await driver.write('users', 'u1', { id: 'u1' })
		const rollback = await driver.snapshot()
		await driver.migrate?.({ plan: planMigration(schema, []) })
		await rollback()
		if (driver.records === undefined) throw new Error('Expected IndexedDB records hook')
		await expect(driver.records('users', {})).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	it('skips a same-name table removed and re-added by one ordered migration', async () => {
		const [users] = tableSchemas('users')
		if (users === undefined) throw new Error('Expected users schema')
		await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
		const rollback = await driver.snapshot()
		await driver.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [
					{ operation: 'table.remove', table: 'users' },
					{ operation: 'table.add', table: users },
				],
			},
		})
		await driver.write('users', 'u2', { id: 'u2', value: 'replacement' })
		await rollback()
		expect(await driver.keys('users')).toEqual(['u2'])
		expect(await driver.read('users', 'u2')).toEqual({ id: 'u2', value: 'replacement' })
	})

	it('does not publish a replacement identity when the native upgrade fails', async () => {
		const schema = tableSchemas('audit', 'users')
		const [audit, users] = schema
		if (audit === undefined || users === undefined) throw new Error('Expected driver schema')
		await driver.open(schema)
		await driver.close()
		const inspected = createIndexedDBDatabase({
			name,
			stores: { __metadata__: {}, audit: {}, users: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()
		const physical = createIndexedDBDatabase({
			name,
			version: version + 1,
			stores: { __metadata__: {}, audit: {}, users: {} },
			upgrade: (context) => {
				context.index('audit', {
					name: deriveIndexedDBIndexName(['id']),
					path: 'id',
				})
			},
		})
		await physical.connect()
		physical.close()
		await driver.open(schema)
		await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
		const rollback = await driver.snapshot(['users'])
		await driver.write('users', 'u1', { id: 'u1', value: 'current' })

		await expect(
			driver.migrate?.({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{ operation: 'table.remove', table: 'users' },
						{ operation: 'table.add', table: users },
						{ operation: 'index.add', table: 'audit', index: ['id'] },
					],
				},
			}),
		).rejects.toMatchObject({ code: 'MIGRATION' })
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'captured' })
	})

	it('adapts captured rows through a compatible column removal', async () => {
		const before: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'legacy', storage: 'text', optional: false, nullable: false },
			],
			indexes: [],
		}
		const current: TableSchema = {
			...before,
			columns: before.columns.filter((column) => column.name !== 'legacy'),
		}
		await driver.open([before])
		await driver.write('users', 'u1', { id: 'u1', legacy: 'captured' })
		const rollback = await driver.snapshot()
		await driver.migrate?.({ plan: planMigration([before], [current]) })
		await driver.write('users', 'u1', { id: 'u1', value: 'current' })
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
	})

	it('rejects incompatible replay before mutation and remains retryable', async () => {
		const before: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'value', storage: 'text', optional: false, nullable: false },
			],
			indexes: [],
		}
		const incompatible: TableSchema = {
			...before,
			columns: before.columns.map((column) =>
				column.name === 'value' ? { ...column, storage: 'integer' } : column,
			),
		}
		const compatible: TableSchema = {
			...before,
			columns: before.columns.filter((column) => column.name !== 'value'),
		}
		await driver.open([before])
		await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
		const rollback = await driver.snapshot()
		await driver.write('users', 'u1', { id: 'u1', value: 'current' })
		await driver.open([incompatible])

		await expect(rollback()).rejects.toMatchObject({ code: 'MIGRATION' })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'current' })

		await driver.open([compatible])
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
	})

	it('rolls every store back when a later native restore fails and retries after repair', async () => {
		const schema = tableSchemas('audit', 'users')
		await driver.open(schema)
		await driver.write('audit', 'a1', { id: 'a1', value: 'captured' })
		await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
		const rollback = await driver.snapshot()
		await driver.write('audit', 'a1', { id: 'a1', value: 'current' })
		await driver.write('users', 'u1', { id: 'u1', value: 'current' })
		await driver.close()

		const inspected = createIndexedDBDatabase({
			name,
			stores: { __metadata__: {}, audit: {}, users: {} },
		})
		await inspected.connect()
		const version = inspected.version
		inspected.close()
		const incompatible = createIndexedDBDatabase({
			name,
			version: version + 1,
			stores: { __metadata__: {}, audit: {}, users: { path: 'id' } },
			upgrade: (context) => {
				context.drop('users')
				context.create('users', { path: 'id' })
			},
		})
		await incompatible.connect()
		incompatible.close()
		await driver.open(schema)

		await expect(rollback()).rejects.toBeDefined()
		expect(await driver.read('audit', 'a1')).toEqual({ id: 'a1', value: 'current' })
		expect(await driver.read('users', 'u1')).toBeUndefined()
		await driver.close()

		const repaired = createIndexedDBDatabase({
			name,
			version: version + 2,
			stores: { __metadata__: {}, audit: {}, users: {} },
			upgrade: (context) => {
				context.drop('users')
				context.create('users', {})
			},
		})
		await repaired.connect()
		repaired.close()
		await driver.open(schema)
		await rollback()
		expect(await driver.read('audit', 'a1')).toEqual({ id: 'a1', value: 'captured' })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'captured' })
	})
})

describe('IndexedDBDriver — error taxonomy mapping (integration)', () => {
	it('a mid-upgrade UPGRADE fault surfaces as a MIGRATION DatabaseError (not a raw IndexedDBError)', async () => {
		let caught: unknown
		try {
			await driver.migrate?.({
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
		} catch (error) {
			caught = error
		}
		expect(isDatabaseError(caught)).toBe(true)
		expect(isDatabaseError(caught) && caught.code).toBe('MIGRATION')
	})

	it('an operation after close() throws the driver-own CLOSED DatabaseError (never a raw backend error)', async () => {
		await driver.close()
		let caught: unknown
		try {
			await driver.read('users', 'u1')
		} catch (error) {
			caught = error
		}
		expect(isDatabaseError(caught)).toBe(true)
		expect(isDatabaseError(caught) && caught.code).toBe('CLOSED')
		// Reconnect so the shared `afterEach` can close/delete cleanly.
		driver = createIndexedDBDriver(name)
		await driver.open(tableSchemas('users'))
	})
})

describe('IndexedDBDriver — reserved __metadata__ table name guard', () => {
	it('open() throws a VALIDATION DatabaseError when a declared table is named __metadata__', async () => {
		const guarded = createIndexedDBDriver(uniqueName('taverna-idb-metadata-guard'))
		let caught: unknown
		try {
			await guarded.open([
				{
					name: '__metadata__',
					primary: 'id',
					columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
					indexes: [],
				},
			])
		} catch (error) {
			caught = error
		}
		expect(isDatabaseError(caught)).toBe(true)
		expect(isDatabaseError(caught) && caught.code).toBe('VALIDATION')
	})
})

describe('IndexedDBDriver — index-name collision (a_b column vs [a, b] compound index)', () => {
	const SCHEMA: TableSchema = {
		name: 'items',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'a', storage: 'text', optional: false, nullable: false },
			{ name: 'b', storage: 'text', optional: false, nullable: false },
			{ name: 'a_b', storage: 'text', optional: false, nullable: false },
		],
		indexes: [['a_b'], ['a', 'b']],
	}

	let dbName = ''
	let collision: DriverInterface = createIndexedDBDriver('unused')

	beforeEach(async () => {
		dbName = uniqueName('taverna-idb-collision')
		await deleteDatabase(dbName)
		collision = createIndexedDBDriver(dbName)
	})

	afterEach(async () => {
		await collision.close()
		await deleteDatabase(dbName)
	})

	it('opens fine with both a single-column "a_b" index and a compound ["a","b"] index', async () => {
		await expect(collision.open([SCHEMA])).resolves.toBeUndefined()
	})

	it('a pushdown on "a_b" uses the single-column index, not the compound one', async () => {
		await collision.open([SCHEMA])
		await collision.write('items', 'i1', { id: 'i1', a: 'x', b: 'y', a_b: 'match' })
		await collision.write('items', 'i2', { id: 'i2', a: 'match', b: 'other', a_b: 'other' })
		const rows = await collision.records?.('items', {
			conditions: [buildCondition('a_b', 'equals', ['match'])],
		})
		expect(rows?.map((row) => row.id)).toEqual(['i1'])
	})

	it('migrate can add and remove each index independently', async () => {
		await collision.open([{ ...SCHEMA, indexes: [] }])
		await collision.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'index.add', table: 'items', index: ['a_b'] }],
			},
		})
		await collision.migrate?.({
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'index.add', table: 'items', index: ['a', 'b'] }],
			},
		})
		await collision.write('items', 'i1', { id: 'i1', a: 'x', b: 'y', a_b: 'z' })
		const bySingle = await collision.records?.('items', {
			conditions: [buildCondition('a_b', 'equals', ['z'])],
		})
		expect(bySingle?.map((row) => row.id)).toEqual(['i1'])
		await collision.migrate?.({
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
		// still reads correctly via a full scan.
		const afterRemove = await collision.records?.('items', {
			conditions: [buildCondition('a_b', 'equals', ['z'])],
		})
		expect(afterRemove?.map((row) => row.id)).toEqual(['i1'])
	})
})
