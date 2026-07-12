import { createMemoryDriver } from '@src/core'
import { describe, expect, it } from 'vitest'
import { collectRows, tableSchemas } from '../../../setup.js'

describe('MemoryDriver', () => {
	it('readies the named tables on open (a scan returns nothing, not an error)', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users', 'posts'))
		expect(await driver.keys('users')).toEqual([])
		expect(await collectRows(driver.scan('posts'))).toEqual([])
	})

	it('reads back what it writes, and misses return undefined / false', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		await driver.write('t', 'a', { id: 'a', n: 1 })
		expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('t', 'missing')).toBeUndefined()
		expect(await driver.delete('t', 'missing')).toBe(false)
		expect(await driver.delete('t', 'a')).toBe(true)
		expect(await driver.read('t', 'a')).toBeUndefined()
	})

	it('lists keys and scans every row', async () => {
		const driver = createMemoryDriver()
		await driver.write('t', 'a', { id: 'a' })
		await driver.write('t', 'b', { id: 'b' })
		expect(await driver.keys('t')).toEqual(['a', 'b'])
		expect((await collectRows(driver.scan('t'))).map((row) => row.id)).toEqual(['a', 'b'])
		await driver.clear('t')
		expect(await driver.keys('t')).toEqual([])
	})

	it('yields keys and scans rows in KEY order, not insertion order', async () => {
		// The DriverInterface contract: scan iterates in key order and keys lists in
		// order (guides/src/database.md). Writing OUT of key order must NOT leak Map
		// insertion order — the reference driver sorts by the core total order, so it
		// agrees with the SQLite (ORDER BY) and IndexedDB (key-ranged) backends.
		const driver = createMemoryDriver()
		await driver.write('t', 'c', { id: 'c' })
		await driver.write('t', 'a', { id: 'a' })
		await driver.write('t', 'b', { id: 'b' })
		expect(await driver.keys('t')).toEqual(['a', 'b', 'c'])
		expect((await collectRows(driver.scan('t'))).map((row) => row.id)).toEqual(['a', 'b', 'c'])
	})

	it('orders numeric keys numerically (not lexicographically)', async () => {
		// The core total order ranks number < string and sorts numbers naturally, so
		// 2 precedes 10 — matching how a numeric primary key sorts on a native backend.
		const driver = createMemoryDriver()
		await driver.write('t', 10, { id: 10 })
		await driver.write('t', 2, { id: 2 })
		await driver.write('t', 1, { id: 1 })
		expect(await driver.keys('t')).toEqual([1, 2, 10])
		expect((await collectRows(driver.scan('t'))).map((row) => row.id)).toEqual([1, 2, 10])
	})

	it('isolates stored rows from caller mutation (copy in, copy out)', async () => {
		const driver = createMemoryDriver()
		const input = { id: 'a', n: 1 }
		await driver.write('t', 'a', input)
		input.n = 999 // mutate the caller's object after writing
		const read = await driver.read('t', 'a')
		expect(read?.n).toBe(1)
		if (read) read.n = 42 // mutate the returned copy
		expect((await driver.read('t', 'a'))?.n).toBe(1)
	})

	it('rolls back to a snapshot', async () => {
		const driver = createMemoryDriver()
		await driver.write('t', 'a', { id: 'a', n: 1 })
		const rollback = await driver.snapshot()
		await driver.write('t', 'a', { id: 'a', n: 2 })
		await driver.write('t', 'b', { id: 'b' })
		expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 2 })
		await rollback()
		expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('t', 'b')).toBeUndefined()
	})
})
