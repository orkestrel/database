import { createMemoryDriver, StorageJournal, StorageRecorder, tallyCalls } from '@src/core'
import { waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { interceptStorage, tableSchemas } from '../../setup.js'

// `StorageJournal` over a real Memory driver: the prior row of each touched key is read once,
// on its first touch, and restored on request; a clear captures its table alone. The adverse
// orderings — unawaited writes to one key, a write on each side of a clear, a failed prior
// read — each hold a case.

describe('StorageJournal — restore', () => {
	it('restores an updated row, deletes an inserted key, and puts back a deleted row', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		await driver.write(
			'users',
			['u1', 'u2'],
			[
				{ id: 'u1', n: 1 },
				{ id: 'u2', n: 2 },
			],
		)
		const journal = new StorageJournal(driver)
		await journal.write('users', 'u1', { id: 'u1', n: 10 })
		await journal.insert('users', ['u3'], [{ id: 'u3', n: 3 }])
		expect(await journal.delete('users', 'u2')).toBe(true)
		expect(await journal.read('users', ['u1', 'u2', 'u3'])).toEqual([
			{ id: 'u1', n: 10 },
			undefined,
			{ id: 'u3', n: 3 },
		])
		await journal.restore()
		expect(await driver.read('users', ['u1', 'u2', 'u3'])).toEqual([
			{ id: 'u1', n: 1 },
			{ id: 'u2', n: 2 },
			undefined,
		])
	})

	it('reads each key once, in one list read per call, and restores in one call per kind', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await recorder.driver.open(tableSchemas('users'))
		await recorder.driver.write('users', ['u1', 'u2'], [{ id: 'u1' }, { id: 'u2' }])
		const journal = new StorageJournal(recorder.driver)
		const { calls } = await recorder.measure(async () => {
			await journal.write('users', ['u1', 'u3'], [{ id: 'u1', n: 1 }, { id: 'u3' }])
			await journal.write('users', 'u1', { id: 'u1', n: 2 })
			await journal.restore()
		})
		expect(tallyCalls(calls, 'read')).toEqual({ calls: 1, keys: 2, rows: 1 })
		expect(tallyCalls(calls, 'delete')).toEqual({ calls: 1, keys: 1, rows: 0 })
		expect(tallyCalls(calls, 'write')).toEqual({ calls: 3, keys: 4, rows: 0 })
		expect(await recorder.driver.keys('users')).toEqual(['u1', 'u2'])
	})

	it('makes no call when it recorded nothing', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await recorder.driver.open(tableSchemas('users'))
		const journal = new StorageJournal(recorder.driver)
		const { calls } = await recorder.measure(() => journal.restore())
		expect(calls).toEqual([])
	})
})

describe('StorageJournal — adverse orderings', () => {
	it('records the first prior row when two unawaited writes touch one key', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		await driver.write('users', 'u1', { id: 'u1', n: 1 })
		const journal = new StorageJournal(driver)
		await Promise.all([
			journal.write('users', 'u1', { id: 'u1', n: 2 }),
			journal.write('users', 'u1', { id: 'u1', n: 3 }),
		])
		await journal.restore()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('waits on the delayed prior read of a key before a later write to it reaches the storage', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		await memory.write('users', 'u1', { id: 'u1', n: 1 })
		const gate = Promise.withResolvers<void>()
		const driver = interceptStorage(memory, {
			async read(table, keys) {
				await gate.promise
				return memory.read(table, keys)
			},
		})
		const journal = new StorageJournal(driver)
		const writes = Promise.all([
			journal.write('users', 'u1', { id: 'u1', n: 2 }),
			journal.write('users', 'u1', { id: 'u1', n: 3 }),
		])
		// Give an unwaited write the turns it would take to reach the storage first.
		await waitForDelay(10)
		gate.resolve()
		await writes
		expect(await memory.read('users', 'u1')).toEqual({ id: 'u1', n: 3 })
		await journal.restore()
		expect(await memory.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('restores a key written before a clear to its row ahead of the scope', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		await driver.write(
			'users',
			['u1', 'u2'],
			[
				{ id: 'u1', n: 1 },
				{ id: 'u2', n: 2 },
			],
		)
		const journal = new StorageJournal(driver)
		await journal.write('users', 'u1', { id: 'u1', n: 10 })
		await journal.clear('users')
		await journal.write(
			'users',
			['u1', 'u3'],
			[
				{ id: 'u1', n: 20 },
				{ id: 'u3', n: 3 },
			],
		)
		await journal.restore()
		expect(await driver.read('users', ['u1', 'u2', 'u3'])).toEqual([
			{ id: 'u1', n: 1 },
			{ id: 'u2', n: 2 },
			undefined,
		])
	})

	it('clears and restores the named table alone', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users', 'posts'))
		await driver.write('users', 'u1', { id: 'u1' })
		await driver.write('posts', 'p1', { id: 'p1' })
		const journal = new StorageJournal(driver)
		await journal.clear('users')
		await driver.write('posts', 'p2', { id: 'p2' })
		await journal.restore()
		expect(await driver.keys('users')).toEqual(['u1'])
		expect(await driver.keys('posts')).toEqual(['p1', 'p2'])
	})

	it('writes nothing when a prior read fails, and restores nothing for that key', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		await memory.write('users', 'u1', { id: 'u1', n: 1 })
		const failure = new Error('read failed')
		const driver = interceptStorage(memory, {
			async read() {
				throw failure
			},
		})
		const journal = new StorageJournal(driver)
		await expect(journal.write('users', 'u1', { id: 'u1', n: 2 })).rejects.toBe(failure)
		await journal.restore()
		expect(await memory.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('refuses lists of different lengths ahead of the prior read', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await recorder.driver.open(tableSchemas('users'))
		const journal = new StorageJournal(recorder.driver)
		const { value, calls } = await recorder.measure(() =>
			journal.write('users', ['u1', 'u2'], [{ id: 'u1' }]).then(
				() => 'fulfilled',
				(error: unknown) => error,
			),
		)
		expect(value).toMatchObject({ code: 'VALIDATION' })
		expect(calls).toEqual([])
	})
})
