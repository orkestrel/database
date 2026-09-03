import { createDatabase } from '@src/core'
import { stringShape } from '@orkestrel/contract'
import { createJSONDriver, createSQLiteDriver } from '@src/server'
import { collect } from '@orkestrel/test'
import { afterEach, describe, expect, it } from 'vitest'
import { tableSchemas } from '../../setup.js'
import { driverSchema, tempDatabasePath } from '../../setupServer.js'

// The server driver factories (`src/server/factories.ts`) — that each returns a working
// instance of `DriverInterface`. The full behavior of what they build is covered in
// `drivers/JSONDriver.test.ts` and `drivers/SQLiteDriver.test.ts`; these cases assert
// only that the factory wires up a usable driver end to end, directly and through the
// core `createDatabase` stack it exists to feed. This mirrors
// `tests/src/core/factories.test.ts` and `tests/src/browser/factories.test.ts`.

const cleanups: Array<() => void> = []

afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()?.()
})

function databasePath(): string {
	const { path, cleanup } = tempDatabasePath()
	cleanups.push(cleanup)
	return path
}

describe('createJSONDriver', () => {
	it('returns a working DriverInterface (open, write, read back, scan)', async () => {
		const driver = createJSONDriver(databasePath())
		await driver.open(tableSchemas('items'))
		await driver.write('items', 'a', { id: 'a', n: 1 })
		await driver.write('items', 'b', { id: 'b', n: 2 })
		expect(await driver.read('items', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('items', 'missing')).toBeUndefined()
		expect((await collect(driver.scan('items'))).map((row) => row.id)).toEqual(['a', 'b'])
		await driver.close()
	})

	it('drives the core createDatabase stack and persists across a reopen', async () => {
		const path = databasePath()
		const tables = { users: { id: stringShape(), name: stringShape() } }
		const first = createDatabase({ driver: createJSONDriver(path), tables })
		await first.table('users').set({ id: 'u1', name: 'Ada' })
		await first.close()
		const second = createDatabase({ driver: createJSONDriver(path), tables })
		expect(await second.table('users').get('u1')).toEqual({ id: 'u1', name: 'Ada' })
		await second.close()
	})
})

describe('createSQLiteDriver', () => {
	// SQLite builds real typed columns, so this one opens the shared conformance
	// schema rather than the scan-only `tableSchemas`: an undeclared column has no
	// place to land in a native backend.
	it('returns a working DriverInterface (open, write, read back, scan)', async () => {
		const driver = createSQLiteDriver()
		await driver.open(driverSchema())
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 41, active: false })
		expect(await driver.read('users', 'u1')).toMatchObject({ id: 'u1', name: 'Ada', age: 36 })
		expect(await driver.read('users', 'missing')).toBeUndefined()
		expect((await collect(driver.scan('users'))).map((row) => row.id)).toEqual(['u1', 'u2'])
		await driver.close()
	})

	it('defaults to an in-memory database when the options bag is omitted', async () => {
		const db = createDatabase({
			driver: createSQLiteDriver(),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const users = db.table('users')
		await users.set({ id: 'u1', name: 'Ada' })
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada' })
		await db.close()
	})

	it('honours a supplied path and persists across a reopen', async () => {
		const path = databasePath()
		const tables = { users: { id: stringShape(), name: stringShape() } }
		const first = createDatabase({ driver: createSQLiteDriver({ path }), tables })
		await first.table('users').set({ id: 'u1', name: 'Ada' })
		await first.close()
		const second = createDatabase({ driver: createSQLiteDriver({ path }), tables })
		expect(await second.table('users').get('u1')).toEqual({ id: 'u1', name: 'Ada' })
		await second.close()
	})
})
