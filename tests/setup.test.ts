import type { DriverMetadata } from '@src/core'
import { compileGuard, integerShape, stringShape } from '@orkestrel/contract'
import { createDatabase, createMemoryDriver } from '@src/core'
import { collect, createRecorder, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	buildCondition,
	collectRankStreamIds,
	conformDriver,
	createConstrainedUsersDatabase,
	createCursorDatabase,
	createMemoryAdapter,
	createReconciliationDriver,
	createRecordingDriver,
	createUserRow,
	CURSOR_COLUMNS,
	CURSOR_ROWS,
	INTEGRATION_TABLES,
	IteratorSource,
	RECORDING_AGGREGATE,
	RECORDING_ROW,
	RecordingIterator,
	seedCursorDatabase,
	seedUsersTable,
	tableSchemas,
	userRows,
} from './setup.js'

// The base test setup module's proof (`tests/setup.ts`). Its subject is the exported test
// infrastructure every Vitest project loads first: the fixture data the suites write, the real
// databases the fixtures stand up, the driver seams the recorders open, and the iterator
// wrappers the transaction suites drive. The database behavior those suites assert belongs to
// the mirrored `tests/src/**` files and is never re-proven here.
//
// `tests/setup.ts` is host-independent, so every contract below is reachable from the
// Node-hosted `setup` project with the browser disabled.
//
// Each expectation arrives by a route `tests/setup.ts` does not share. A column's contract is
// read back through `compileGuard` rather than through the shape builder that declared it. A
// fixture's writes are read back through the WRAPPED driver rather than through the handle the
// fixture returned, so nothing the wrapper holds itself can satisfy the assertion. A condition
// literal is judged by the rows a real query returns rather than by its own fields.

/** The recorder proving the registered conformance battery mints from the supplied factory. */
const conformanceFactory = createRecorder<[]>()

// Registered at import time, so the recorder above is declared first and the assertion on it is
// declared last — Vitest runs a file's cases in declaration order.
conformDriver('memory driver', () => {
	conformanceFactory.handler()
	return createMemoryDriver()
})

/** Seed the canonical trio into a real constrained `users` table. */
async function seedConstrainedUsers() {
	const { users } = createConstrainedUsersDatabase()
	await users.set(userRows())
	return users
}

/** Seed a real `rank` table spanning the parity helper's `below 10` boundary. */
async function seedRankRows() {
	const db = createDatabase({
		driver: createMemoryDriver(),
		tables: { rows: { id: stringShape(), rank: integerShape() } },
	})
	const rows = db.table('rows')
	await rows.set([
		{ id: 'r3', rank: 3 },
		{ id: 'r1', rank: 9 },
		{ id: 'r2', rank: 10 },
		{ id: 'r4', rank: 41 },
	])
	return rows
}

/** Stand up a real `users` table over one of the recording driver's two aggregate modes. */
function recordUsersTable(aggregatesUndefined: boolean) {
	const recording = createRecordingDriver(aggregatesUndefined)
	const db = createDatabase({
		driver: recording.driver,
		tables: { users: INTEGRATION_TABLES.users },
	})
	return { recording, users: db.table('users') }
}

describe('INTEGRATION_TABLES', () => {
	it('admits the canonical fixture row and refuses a value of the wrong column type', () => {
		const { age, id, name } = INTEGRATION_TABLES.users
		const { author, title } = INTEGRATION_TABLES.posts
		expect(compileGuard(id)('u1')).toBe(true)
		expect(compileGuard(name)('Ada')).toBe(true)
		expect(compileGuard(age)(36)).toBe(true)
		expect(compileGuard(author)('u1')).toBe(true)
		expect(compileGuard(title)('First')).toBe(true)
		expect(compileGuard(id)(1)).toBe(false)
		expect(compileGuard(age)('36')).toBe(false)
		expect(compileGuard(age)(36.5)).toBe(false)
	})
})

describe('createUserRow', () => {
	it('carries the canonical defaults and replaces only the overridden fields', () => {
		expect(createUserRow()).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(createUserRow({ age: 41 })).toEqual({ id: 'u1', name: 'Ada', age: 41 })
		expect(createUserRow({ id: 'u9', name: 'Grace' })).toEqual({
			id: 'u9',
			name: 'Grace',
			age: 36,
		})
	})

	it('builds a row the fixture column contracts admit', () => {
		const row = createUserRow({ id: 'u2', name: 'Grace', age: 45 })
		const { age, id, name } = INTEGRATION_TABLES.users
		expect(compileGuard(id)(row.id)).toBe(true)
		expect(compileGuard(name)(row.name)).toBe(true)
		expect(compileGuard(age)(row.age)).toBe(true)
	})
})

describe('userRows', () => {
	it('returns the Ada / Grace / Edsger trio in key order', () => {
		expect(userRows()).toEqual([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Grace', age: 45 },
			{ id: 'u3', name: 'Edsger', age: 50 },
		])
	})

	it('builds a fresh array of fresh rows on every call', () => {
		const first = userRows()
		const second = userRows()
		expect(first).not.toBe(second)
		expect(first[0]).not.toBe(second[0])
	})
})

describe('tableSchemas', () => {
	it('declares scan-only schemas a real driver readies under each named table', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users', 'posts'))
		await driver.insert('users', 'u1', { id: 'u1' })
		await driver.insert('posts', 'p1', { id: 'p1' })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
		expect(await driver.keys('posts')).toEqual(['p1'])
		await driver.close()
	})

	it('readies only the named tables, so an undeclared name is refused', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		await expect(driver.keys('posts')).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await driver.close()
	})
})

describe('buildCondition', () => {
	it('builds a condition a real query applies to the rows it names', async () => {
		const users = await seedConstrainedUsers()
		const older = await users
			.query()
			.condition(buildCondition('age', 'above', [40]))
			.collect()
		expect(older.map((row) => row.id).sort()).toEqual(['u2', 'u3'])
	})

	it('defaults the connector to and, and honours an explicit or', async () => {
		const users = await seedConstrainedUsers()
		const intersected = await users
			.query()
			.condition(buildCondition('age', 'above', [40]))
			.condition(buildCondition('name', 'equals', ['Grace']))
			.collect()
		const united = await users
			.query()
			.condition(buildCondition('age', 'above', [48]))
			.condition(buildCondition('name', 'equals', ['Grace'], 'or'))
			.collect()
		expect(intersected.map((row) => row.id)).toEqual(['u2'])
		expect(united.map((row) => row.id).sort()).toEqual(['u2', 'u3'])
	})
})

describe('collectRankStreamIds', () => {
	it('collects the ids ranked below 10 in sorted order, excluding the boundary', async () => {
		const rows = await seedRankRows()
		expect(await collectRankStreamIds(rows)).toEqual(['r1', 'r3'])
	})
})

describe('seedUsersTable', () => {
	it('returns a live table carrying exactly what the caller seeded', async () => {
		const users = await seedUsersTable(
			{ id: stringShape(), name: stringShape(), rank: integerShape() },
			(table) => table.set([{ id: 'u1', name: 'Ada', rank: 1 }]),
		)
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada', rank: 1 })
		expect(users.name).toBe('users')
		expect(users.primary).toBe('id')
	})

	it('builds a fresh database per call, so a seeded row never reaches the next table', async () => {
		const columns = { id: stringShape(), name: stringShape() }
		await seedUsersTable(columns, (table) => table.set([{ id: 'u1', name: 'Ada' }]))
		const second = await seedUsersTable(columns, () => Promise.resolve())
		expect(await second.keys()).toEqual([])
	})
})

describe('createConstrainedUsersDatabase', () => {
	it('names the database app and enforces the declared column constraints', async () => {
		const { db, users } = createConstrainedUsersDatabase()
		await users.set(createUserRow())
		expect(db.name).toBe('app')
		await expect(users.set(createUserRow({ id: 'u2', name: '' }))).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		await expect(users.set(createUserRow({ id: 'u3', age: -1 }))).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(await users.keys()).toEqual(['u1'])
	})

	it('routes a listener throw to the supplied error handler', async () => {
		const errors = createRecorder<[unknown, string]>()
		const { users } = createConstrainedUsersDatabase(errors.handler)
		users.emitter.on('write', () => {
			throw new Error('listener refused')
		})
		await users.set(createUserRow())
		expect(errors.calls.map(([, event]) => event)).toEqual(['write'])
	})

	it('builds a fresh database per call', async () => {
		const first = createConstrainedUsersDatabase()
		await first.users.set(createUserRow())
		const second = createConstrainedUsersDatabase()
		expect(await second.users.keys()).toEqual([])
	})
})

describe('CURSOR_COLUMNS', () => {
	it('admits a declared role and refuses one outside the literal set', () => {
		const role = compileGuard(CURSOR_COLUMNS.role)
		expect(role('admin')).toBe(true)
		expect(role('member')).toBe(true)
		expect(role('guest')).toBe(true)
		expect(role('owner')).toBe(false)
		expect(compileGuard(CURSOR_COLUMNS.age)(-1)).toBe(false)
	})
})

describe('createCursorDatabase', () => {
	it('stores its rows in the caller-supplied driver', async () => {
		const memory = createMemoryDriver()
		const { users } = createCursorDatabase(memory)
		await users.set(CURSOR_ROWS)
		expect(await memory.read('users', 'u2')).toEqual({
			id: 'u2',
			name: 'Bo',
			age: 17,
			role: 'guest',
		})
	})
})

describe('seedCursorDatabase', () => {
	it('seeds the canonical trio into a fresh database', async () => {
		const { users } = await seedCursorDatabase()
		const second = await seedCursorDatabase()
		await second.users.remove('u1')
		expect(await users.records()).toEqual(CURSOR_ROWS)
		expect(await second.users.keys()).toEqual(['u2', 'u3'])
	})
})

describe('createMemoryAdapter', () => {
	it('exposes only the required primitives, hiding the memory driver optional hooks', () => {
		const memory = createMemoryDriver()
		const adapter = createMemoryAdapter(memory)
		expect(typeof memory.stream).toBe('function')
		expect(typeof memory.migrate).toBe('function')
		expect(typeof memory.metadata).toBe('function')
		expect(typeof memory.stamp).toBe('function')
		expect(adapter.stream).toBeUndefined()
		expect(adapter.migrate).toBeUndefined()
		expect(adapter.metadata).toBeUndefined()
		expect(adapter.stamp).toBeUndefined()
	})

	it('delegates every exposed primitive to the driver it wraps', async () => {
		const memory = createMemoryDriver()
		const adapter = createMemoryAdapter(memory)
		await adapter.open(tableSchemas('users'))
		await adapter.write('users', 'u1', { id: 'u1' })
		await adapter.insert('users', 'u2', { id: 'u2' })
		expect(await memory.keys('users')).toEqual(['u1', 'u2'])
		expect(await collect(memory.scan('users'))).toEqual([{ id: 'u1' }, { id: 'u2' }])
		expect(await adapter.delete('users', 'u1')).toBe(true)
		expect(await memory.read('users', 'u1')).toBeUndefined()
		await adapter.clear('users')
		expect(await memory.keys('users')).toEqual([])
		await adapter.close()
	})
})

describe('createReconciliationDriver', () => {
	it('omits every optional hook the options refuse', () => {
		const { driver } = createReconciliationDriver({ metadata: false, stamp: false })
		expect(driver.metadata).toBeUndefined()
		expect(driver.stamp).toBeUndefined()
		expect(driver.migrate).toBeUndefined()
	})

	it('serves the initial metadata, then serves what stamp persisted', async () => {
		const initial: DriverMetadata = { version: 1, schema: tableSchemas('users') }
		const next: DriverMetadata = { version: 2, schema: tableSchemas('users', 'posts') }
		const { driver, metadataCalls, stampCalls } = createReconciliationDriver({
			metadata: true,
			stamp: true,
			initial,
		})
		expect(await driver.metadata?.()).toEqual(initial)
		await driver.stamp?.(next)
		expect(await driver.metadata?.()).toEqual(next)
		expect(metadataCalls.length).toBe(2)
		expect(stampCalls).toEqual([next])
	})

	it('records a migration, applies it to the real driver, and adopts its metadata', async () => {
		const { driver, migrateCalls } = createReconciliationDriver({
			metadata: true,
			stamp: false,
			migrate: true,
		})
		await driver.open(tableSchemas('users'))
		const added = requireValue(tableSchemas('audits')[0])
		const metadata: DriverMetadata = { version: 3, schema: tableSchemas('users', 'audits') }
		await driver.migrate?.({
			plan: { from: 2, to: 3, steps: [{ operation: 'table.add', table: added }] },
			metadata,
		})
		expect(migrateCalls.map((input) => input.plan.to)).toEqual([3])
		expect(await driver.keys('audits')).toEqual([])
		expect(await driver.metadata?.()).toEqual(metadata)
		await driver.close()
	})
})

describe('IteratorSource', () => {
	it('iterates exactly what the supplied iterator yields', async () => {
		const values = [1, 2, 3]
		let index = 0
		const source = new IteratorSource<number>({
			next: () => {
				const value = values[index]
				index += 1
				return Promise.resolve(
					value === undefined ? { done: true, value: undefined } : { done: false, value },
				)
			},
		})
		expect(await collect(source)).toEqual(values)
	})
})

describe('RecordingIterator', () => {
	it('delegates next and runs the cleanup before delegating return', async () => {
		const cleanups = createRecorder<[]>()
		const returns = createRecorder<[]>()
		const iterator = new RecordingIterator<number>(
			{
				next: () => Promise.resolve({ done: false, value: 7 }),
				return: () => {
					returns.handler()
					return Promise.resolve({ done: true, value: undefined })
				},
			},
			cleanups.handler,
		)
		expect(await iterator.next()).toEqual({ done: false, value: 7 })
		expect(cleanups.count).toBe(0)
		expect(await iterator.return()).toEqual({ done: true, value: undefined })
		expect(cleanups.count).toBe(1)
		expect(returns.count).toBe(1)
	})

	it('still runs the cleanup when the source cannot be returned', async () => {
		const cleanups = createRecorder<[]>()
		const iterator = new RecordingIterator<number>(
			{ next: () => Promise.resolve({ done: true, value: undefined }) },
			cleanups.handler,
		)
		expect(await iterator.return()).toEqual({ done: true, value: undefined })
		expect(cleanups.count).toBe(1)
	})
})

describe('createRecordingDriver', () => {
	it('answers from the native hooks while the real rows stay stored', async () => {
		const { recording, users } = recordUsersTable(false)
		await users.set(createUserRow())
		expect(await users.records()).toEqual([RECORDING_ROW])
		expect(await users.aggregate('maximum', 'age')).toBe(RECORDING_AGGREGATE)
		expect(await collect(recording.driver.scan('users'))).toEqual([createUserRow()])
		expect(recording.recordsCalls.length).toBe(1)
		expect(recording.aggregateCalls.map(({ column, operation }) => [operation, column])).toEqual([
			['maximum', 'age'],
		])
	})

	it('resolves the aggregate hook to undefined on request, still recording the call', async () => {
		const { recording, users } = recordUsersTable(true)
		expect(await users.aggregate('sum', 'age')).toBeUndefined()
		expect(recording.aggregateCalls.map(({ operation }) => operation)).toEqual(['sum'])
	})
})

describe('conformDriver', () => {
	it('registers a battery that mints its driver from the supplied factory', () => {
		expect(conformanceFactory.count).toBeGreaterThan(0)
	})
})
