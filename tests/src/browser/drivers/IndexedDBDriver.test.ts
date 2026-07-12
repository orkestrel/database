import type { DriverInterface } from '@src/core'
import { applyCriteria, createDatabase, isDatabaseError } from '@src/core'
import { createIndexedDBDriver } from '@src/browser'
import { createIndexedDBDatabase } from '@orkestrel/indexeddb'
import { integerShape, jsonShape, stringShape } from '@orkestrel/contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCondition, collectRows, conformDriver, tableSchemas } from '../../../setup.js'
import { deleteDatabase, uniqueName } from '../../../setupBrowser.js'

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

	it('lists keys and scans in key order, and clears', async () => {
		await driver.write('users', 'a', { id: 'a' })
		await driver.write('users', 'b', { id: 'b' })
		expect(await driver.keys('users')).toEqual(['a', 'b'])
		expect((await collectRows(driver.scan('users'))).map((row) => row.id)).toEqual(['a', 'b'])
		await driver.clear('users')
		expect(await driver.keys('users')).toEqual([])
	})

	it('creates a new store on reopen with more tables (auto-managed version)', async () => {
		await driver.open(tableSchemas('users', 'posts'))
		await driver.write('posts', 'p1', { id: 'p1', title: 'Hello' })
		expect(await driver.read('posts', 'p1')).toEqual({ id: 'p1', title: 'Hello' })
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
			{ name: 'people', primary: 'id', columns: [], indexes: [['age'], ['city', 'age']] },
		])
		await driverWithIndex.write('people', 'p1', { id: 'p1', age: 30, city: 'NYC' })
		await driverWithIndex.write('people', 'p2', { id: 'p2', age: 41, city: 'LA' })

		// Open the SAME database through the wrapper directly, declaring the same
		// indexes so `store.index(...)` is reachable.
		const wrapper = createIndexedDBDatabase({
			name: indexed,
			stores: {
				people: {
					indexes: [
						{ name: 'age', path: 'age' },
						{ name: 'city_age', path: ['city', 'age'] },
					],
				},
			},
		})
		await wrapper.connect()

		// NON-TAUTOLOGICAL existence proof: read the LIVE IDBObjectStore.indexNames.
		const live = wrapper.database.transaction(['people'], 'readonly').objectStore('people')
		expect([...live.indexNames].sort()).toEqual(['age', 'city_age'])

		// And a real indexed READ exercises the live IDBIndex.
		expect((await wrapper.store('people').index('age').get(41))?.id).toBe('p2')

		wrapper.close()
		await driverWithIndex.close()
		await deleteDatabase(indexed)
	})
})

describe('IndexedDBDriver — native records / count / stream pushdown', () => {
	// A real database over the IndexedDB driver, with a single-column secondary
	// index on `age` (so age queries push to a key-range) and none on `name` (so
	// name queries fall back to a scan + the engine). Behavior is asserted through
	// the observable Table API — rows / counts must be correct regardless of path.
	const PEOPLE = [
		{ id: 'u1', name: 'Ada', age: 36 },
		{ id: 'u2', name: 'Bo', age: 22 },
		{ id: 'u3', name: 'Cy', age: 41 },
		{ id: 'u4', name: 'Di', age: 22 },
		{ id: 'u5', name: 'Eve', age: 55 },
	] as const

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
			.where('age')
			.from(36)
			.descending('age')
			.offset(1)
			.limit(1)
			.all()
		expect(rows).toEqual([{ id: 'u3', name: 'Cy', age: 41 }])
	})

	it('returns every match for an indexed equality (native count agrees)', async () => {
		const rows = await people.query().where('age').equals(22).all()
		expect(rows.map((row) => row.id).sort()).toEqual(['u2', 'u4'])
		// A single pushable equality → the native key-range count path.
		expect(await people.query().where('age').equals(22).count()).toBe(2)
	})

	it('a non-indexed-column query still returns correct rows (scan + engine)', async () => {
		// `name` has no index → full scan, the engine applies `starts`.
		const rows = await people.query().where('name').starts('A').all()
		expect(rows).toEqual([{ id: 'u1', name: 'Ada', age: 36 }])
		expect(await people.query().where('name').ends('e').count()).toBe(1) // 'Eve'
	})

	it('a multi-condition query (indexed + extra predicate) returns exact rows + count', async () => {
		// age >= 22 (pushes to the index, a superset) AND name not 'Bo' (engine refines).
		const query = (): ReturnType<typeof people.query> =>
			people.query().where('age').from(22).and('name').not('Bo')
		const rows = await query().ascending('id').all()
		expect(rows.map((row) => row.id)).toEqual(['u1', 'u3', 'u4', 'u5'])
		expect(await query().count()).toBe(4)
	})

	it('an unconditional count uses the native store count', async () => {
		expect(await people.query().count()).toBe(PEOPLE.length)
	})

	it('an or-joined query full-scans and matches the engine over a plain scan', async () => {
		const conditions = [
			buildCondition('age', 'from', [40]),
			buildCondition('name', 'equals', ['Bo'], 'or'),
		]
		const rows = await people.query().where('age').from(40).or('name').equals('Bo').all()
		// age >= 40: Cy(41), Eve(55); OR name = 'Bo': Bo(22). Superset must be a
		// full scan (no single range would be a superset of this union), so the
		// native path's result equals the engine applied to every row.
		const expected = applyCriteria(
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
		const rows = await items.query().where(['payload', 'tag']).equals('green').all()
		expect(rows.map((row) => row.id)).toEqual(['i1'])
		await db.close()
	})

	it('stream is lazy and honors early break (offset/limit counting)', async () => {
		const seen: string[] = []
		for await (const row of people.query().where('age').from(0).stream()) {
			seen.push(row.id)
			if (seen.length === 2) break
		}
		expect(seen.length).toBe(2)
	})
})

describe('IndexedDBDriver — migrate / meta / stamp', () => {
	it('meta is undefined until stamped, and round-trips exactly on stamp', async () => {
		expect(await driver.meta?.()).toBeUndefined()
		const meta = { version: 1, schema: tableSchemas('users') }
		await driver.stamp?.(meta)
		expect(await driver.meta?.()).toEqual(meta)
	})

	it('meta persists across close and reopen (same database name)', async () => {
		const meta = { version: 2, schema: tableSchemas('users') }
		await driver.stamp?.(meta)
		await driver.close()
		const reopened = createIndexedDBDriver(name)
		await reopened.open(tableSchemas('users'))
		expect(await reopened.meta?.()).toEqual(meta)
		await reopened.close()
	})

	it('the reserved meta store is excluded from a whole-store snapshot rollback', async () => {
		const first = { version: 1, schema: tableSchemas('users') }
		await driver.stamp?.(first)
		const rollback = await driver.snapshot()
		const second = { version: 2, schema: tableSchemas('users') }
		await driver.stamp?.(second)
		await rollback()
		// The whole-store rollback restored table data but must NOT have touched
		// the reserved meta store — the newer stamp survives.
		expect(await driver.meta?.()).toEqual(second)
	})

	it('table.add creates a usable store via migrate', async () => {
		await driver.migrate?.({
			from: 0,
			to: 1,
			steps: [
				{
					operation: 'table.add',
					table: { name: 'posts', primary: 'id', columns: [], indexes: [] },
				},
			],
		})
		await driver.write('posts', 'p1', { id: 'p1', title: 'Hello' })
		expect(await driver.read('posts', 'p1')).toEqual({ id: 'p1', title: 'Hello' })
	})

	it('table.remove drops a store via migrate', async () => {
		await driver.open(tableSchemas('users', 'posts'))
		await driver.write('posts', 'p1', { id: 'p1' })
		await driver.migrate?.({
			from: 0,
			to: 1,
			steps: [{ operation: 'table.remove', table: 'posts' }],
		})
		await expect(driver.read('posts', 'p1')).rejects.toThrow('posts')
	})

	it('index.add on an existing store becomes visible (secondary-index read works)', async () => {
		await driver.write('users', 'u1', { id: 'u1', age: 30 })
		await driver.write('users', 'u2', { id: 'u2', age: 41 })
		await driver.migrate?.({
			from: 0,
			to: 1,
			steps: [{ operation: 'index.add', table: 'users', index: ['age'] }],
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
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', legacy: true })
		await driver.migrate?.({
			from: 0,
			to: 1,
			steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
		})
		const migrated = await driver.read('users', 'u1')
		expect(migrated).toEqual({ id: 'u1', name: 'Ada' })
		await driver.close()
		const reopened = createIndexedDBDriver(name)
		await reopened.open(tableSchemas('users'))
		expect(await reopened.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
		await reopened.close()
		driver = createIndexedDBDriver(name)
		await driver.open(tableSchemas('users'))
	})

	it('an unknown-table migration step throws MIGRATION without consuming a version', async () => {
		await driver.write('users', 'u1', { id: 'u1' })
		let caught: unknown
		try {
			await driver.migrate?.({
				from: 0,
				to: 1,
				steps: [{ operation: 'table.remove', table: 'ghost' }],
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
