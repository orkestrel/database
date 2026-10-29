import { createDatabase } from '@src/core'
import { stringShape } from '@orkestrel/contract'
import { createIndexedDBDriver } from '@src/browser'
import { collect } from '@orkestrel/test'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseFixture, tableSchemas } from '../../setup.js'
import { deleteDatabase, mintDatabase } from '../../setupBrowser.js'

// `createIndexedDBDriver` (`src/browser/factories.ts`) in real Chromium: the
// factory returns a working `DriverInterface` backed by IndexedDB. The driver's
// full primitive surface is covered in `drivers/IndexedDBDriver.test.ts`; here we
// assert the factory wires up a usable driver end to end — directly (open + row
// round-trip + scan) and through the core `createDatabase` stack it is built to
// feed.

const name = new DatabaseFixture<string>()

afterEach(async () => {
	if (name.current !== undefined) await deleteDatabase(name.value)
	name.clear()
})

describe('createIndexedDBDriver', () => {
	it('returns a working DriverInterface (open, write, read back, scan)', async () => {
		name.hold(mintDatabase('database-idbdriver-factory'))
		await deleteDatabase(name.value)
		const driver = createIndexedDBDriver(name.value)
		await driver.open(tableSchemas('items'))
		await driver.write('items', 'a', { id: 'a', n: 1 })
		await driver.write('items', 'b', { id: 'b', n: 2 })
		expect(await driver.read('items', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('items', 'missing')).toBeUndefined()
		expect((await collect(driver.scan('items'))).map((row) => row.id)).toEqual(['a', 'b'])
		await driver.close()
	})

	it('drives the core createDatabase stack (a typed-row round-trip over IndexedDB)', async () => {
		name.hold(mintDatabase('database-idbdriver-stack'))
		await deleteDatabase(name.value)
		const db = createDatabase({
			driver: createIndexedDBDriver(name.value),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const users = db.table('users')
		await users.set({ id: 'u1', name: 'Ada' })
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada' })
		await db.close()
	})
})
