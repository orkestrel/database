import { createMemoryDriver, isDatabaseError, planMigration } from '@src/core'
import { describe, expect, it } from 'vitest'
import { collectRows, conformDriver, tableSchemas } from '../../../setup.js'

conformDriver('MemoryDriver', () => createMemoryDriver())

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

	describe('stream', () => {
		it('yields condition-matched rows only, in key order', async () => {
			const driver = createMemoryDriver()
			await driver.write('t', 'c', { id: 'c', n: 3 })
			await driver.write('t', 'a', { id: 'a', n: 1 })
			await driver.write('t', 'b', { id: 'b', n: 2 })
			const conditions = [
				{ column: 'n', operator: 'above' as const, values: [1], connector: 'and' as const },
			]
			const rows = await collectRows(driver.stream?.('t', { conditions }) ?? (async function* () {})())
			expect(rows.map((row) => row.id)).toEqual(['b', 'c'])
		})

		it('applies offset then limit lazily', async () => {
			const driver = createMemoryDriver()
			await driver.write('t', 'a', { id: 'a' })
			await driver.write('t', 'b', { id: 'b' })
			await driver.write('t', 'c', { id: 'c' })
			await driver.write('t', 'd', { id: 'd' })
			const rows = await collectRows(
				driver.stream?.('t', { offset: 1, limit: 2 }) ?? (async function* () {})(),
			)
			expect(rows.map((row) => row.id)).toEqual(['b', 'c'])
		})

		it('ignores criteria.order (yields key order regardless)', async () => {
			const driver = createMemoryDriver()
			await driver.write('t', 'b', { id: 'b', n: 2 })
			await driver.write('t', 'a', { id: 'a', n: 1 })
			const rows = await collectRows(
				driver.stream?.('t', { order: [{ column: 'n', direction: 'descending' }] }) ??
					(async function* () {})(),
			)
			expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
		})

		it('yields copy-out rows, isolated from later mutation', async () => {
			const driver = createMemoryDriver()
			await driver.write('t', 'a', { id: 'a', n: 1 })
			const [row] = await collectRows(driver.stream?.('t', {}) ?? (async function* () {})())
			if (row) row.n = 999
			expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 1 })
		})

		it('terminates cleanly on an early break', async () => {
			const driver = createMemoryDriver()
			await driver.write('t', 'a', { id: 'a' })
			await driver.write('t', 'b', { id: 'b' })
			await driver.write('t', 'c', { id: 'c' })
			const seen: string[] = []
			const source = driver.stream?.('t', {})
			if (source !== undefined) {
				for await (const row of source) {
					seen.push(row.id as string)
					if (seen.length === 2) break
				}
			}
			expect(seen).toEqual(['a', 'b'])
		})

		it('yields nothing for an empty or unknown table, mirroring scan', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			expect(await collectRows(driver.stream?.('users', {}) ?? (async function* () {})())).toEqual(
				[],
			)
			expect(
				await collectRows(driver.stream?.('missing', {}) ?? (async function* () {})()),
			).toEqual(await collectRows(driver.scan('missing')))
		})
	})

	describe('migrate', () => {
		it('applies a table.add step by creating the table', async () => {
			const driver = createMemoryDriver()
			const plan = planMigration([], tableSchemas('users'))
			await driver.migrate?.(plan)
			expect(await driver.keys('users')).toEqual([])
		})

		it('applies a table.remove step by dropping the table and its rows', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'a', { id: 'a' })
			const plan = planMigration(tableSchemas('users'), [])
			await driver.migrate?.(plan)
			await driver.open(tableSchemas('users'))
			expect(await driver.keys('users')).toEqual([])
		})

		it('applies a column.remove step by stripping the field from every stored row', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'a', { id: 'a', name: 'Ada', legacy: true })
			await driver.write('users', 'b', { id: 'b', name: 'Grace', legacy: false })
			const before = {
				name: 'users',
				primary: 'id',
				columns: [{ name: 'legacy', type: 'text' as const, nullable: false }],
				indexes: [],
			}
			const after = { name: 'users', primary: 'id', columns: [], indexes: [] }
			const plan = planMigration([before], [after])
			await driver.migrate?.(plan)
			expect(await driver.read('users', 'a')).toEqual({ id: 'a', name: 'Ada' })
			expect(await driver.read('users', 'b')).toEqual({ id: 'b', name: 'Grace' })
		})

		it('throws a MIGRATION DatabaseError when a step references an unknown table', async () => {
			const driver = createMemoryDriver()
			const plan = planMigration(tableSchemas('missing'), [])
			const error = await driver.migrate?.(plan).catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		})
	})
})
