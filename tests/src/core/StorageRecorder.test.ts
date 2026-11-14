import type { QueryInput } from '@src/core'
import { integerShape, stringShape } from '@orkestrel/contract'
import { collect } from '@orkestrel/test'
import { createDatabase, createMemoryDriver, StorageRecorder, tallyCalls } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	createCompleteDriver,
	createMemoryAdapter,
	createPlannedDriver,
	emptyRows,
	streamThenFail,
	tableSchemas,
} from '../../setup.js'

// `StorageRecorder` wraps a real driver: each test reads the calls it recorded against what the
// driver holds, never against a fake.

describe('StorageRecorder', () => {
	it('records the rows each member returns, unscoped, and declares only the source members', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await recorder.driver.open(tableSchemas('users'))
		await recorder.driver.write('users', 'a', { id: 'a' })
		await recorder.driver.write('users', 'b', { id: 'b' })
		const { value, calls } = await recorder.measure(async () => {
			const rows = await collect(recorder.driver.scan('users'))
			const row = await recorder.driver.read('users', 'missing')
			return { rows: rows.length, row }
		})
		expect(value).toEqual({ rows: 2, row: undefined })
		expect(tallyCalls(calls, 'scan')).toEqual({ calls: 1, keys: 0, rows: 2 })
		expect(tallyCalls(calls, 'read')).toEqual({ calls: 1, keys: 1, rows: 0 })
		expect(calls.every((call) => !call.scoped)).toBe(true)
		expect(recorder.driver.transaction).toBeUndefined()
		expect(recorder.driver.plan).toBeUndefined()
		expect(recorder.source.stream).toBeUndefined()
		expect(tallyCalls(recorder.calls, 'write')).toEqual({ calls: 2, keys: 2, rows: 0 })
	})

	it('records the native members and marks each call a transaction scope makes', async () => {
		const recorder = new StorageRecorder(createPlannedDriver('native'))
		const users = createDatabase({
			driver: recorder.driver,
			tables: { users: { id: stringShape(), age: integerShape() } },
		}).table('users')
		await users.set([
			{ id: 'u1', age: 36 },
			{ id: 'u2', age: 7 },
			{ id: 'u3', age: 41 },
		])
		const read: QueryInput = {
			conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }],
		}
		const { calls } = await recorder.measure(async () => {
			expect((await users.records(read)).map((row) => row.id)).toEqual(['u1', 'u3'])
			expect(await collect(users.scan(read))).toHaveLength(2)
			expect(await users.aggregate('sum', 'age', read)).toBe(77)
		})
		expect(tallyCalls(calls, 'plan').calls).toBe(3)
		expect(tallyCalls(calls, 'records')).toEqual({ calls: 1, keys: 0, rows: 2 })
		expect(tallyCalls(calls, 'stream')).toEqual({ calls: 1, keys: 0, rows: 2 })
		expect(tallyCalls(calls, 'aggregate')).toEqual({ calls: 1, keys: 0, rows: 0 })
		expect(tallyCalls(calls, 'scan').calls).toBe(0)
		const scoped = await recorder.measure(
			() =>
				recorder.driver.transaction?.((storage) => storage.read('users', ['u1', 'u9'])) ??
				Promise.resolve([]),
		)
		expect(scoped.value).toEqual([{ id: 'u1', age: 36 }, undefined])
		expect(scoped.calls).toEqual([{ member: 'read', keys: 2, rows: 1, scoped: true }])
	})

	it('forwards the migration members unrecorded and keeps the open and close of its source', async () => {
		const source = createCompleteDriver()
		const recorder = new StorageRecorder(source)
		await recorder.driver.open(tableSchemas('users'))
		await recorder.driver.stamp?.({ version: 1, schema: tableSchemas('users') })
		expect((await recorder.driver.metadata?.())?.version).toBe(1)
		expect(recorder.calls).toEqual([])
		expect(recorder.source).toBe(source)
		await recorder.driver.close()
	})

	it('records a call its source rejects as invoked, and hands out a copy of its log', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await recorder.driver.open(tableSchemas('users'))
		await recorder.driver.insert('users', 'a', { id: 'a' })
		await expect(recorder.driver.insert('users', 'a', { id: 'a' })).rejects.toMatchObject({
			code: 'CONFLICT',
		})
		const log = recorder.calls
		expect(log).toEqual([
			{ member: 'insert', keys: 1, rows: 0, scoped: false },
			{ member: 'insert', keys: 1, rows: 0, scoped: false },
		])
		await recorder.driver.clear('users')
		expect(log).toHaveLength(2)
		expect(recorder.calls).toHaveLength(3)
	})

	it('counts a stream returned and never pulled as one call with no row', async () => {
		const recorder = new StorageRecorder(createPlannedDriver('native'))
		await recorder.driver.open(tableSchemas('users'))
		await recorder.driver.write('users', ['a', 'b'], [{ id: 'a' }, { id: 'b' }])
		const { calls } = await recorder.measure(async () => {
			recorder.driver.stream?.('users', {})
			recorder.driver.scan('users')
		})
		expect(calls).toEqual([
			{ member: 'stream', keys: 0, rows: 0, scoped: false },
			{ member: 'scan', keys: 0, rows: 0, scoped: false },
		])
	})

	it('counts the rows a consumer took from a stream it abandoned early', async () => {
		const recorder = new StorageRecorder(createPlannedDriver('native'))
		await recorder.driver.open(tableSchemas('users'))
		await recorder.driver.write('users', ['a', 'b', 'c'], [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
		const { calls } = await recorder.measure(async () => {
			for await (const row of recorder.driver.stream?.('users', {}) ?? []) {
				expect(row).toEqual({ id: 'a' })
				break
			}
		})
		expect(calls).toEqual([{ member: 'stream', keys: 0, rows: 1, scoped: false }])
	})

	it('counts the rows a stream yielded before its source threw', async () => {
		const memory = createMemoryDriver()
		const recorder = new StorageRecorder(
			createMemoryAdapter(memory, {
				plan: (_table, input) => ({ native: input, residual: {} }),
				records: () => Promise.resolve([]),
				stream: () => streamThenFail([{ id: 'a' }, { id: 'b' }], 'stream failed'),
			}),
		)
		const { calls } = await recorder.measure(() =>
			expect(collect(recorder.driver.stream?.('users', {}) ?? emptyRows())).rejects.toThrow(
				'stream failed',
			),
		)
		expect(calls).toEqual([{ member: 'stream', keys: 0, rows: 2, scoped: false }])
	})
})
