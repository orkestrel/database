import type { StorageMember } from '@src/core'
import type { StreamPage } from '@src/core'
import { collect, createRecorder } from '@orkestrel/test'
import { createMemoryDriver, RecordedStorage } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createMemoryAdapter, FormStorage, streamThenFail, tableSchemas } from '../../setup.js'

describe('RecordedStorage', () => {
	it('reports each call as it is invoked, with the keys it addresses and the rows it returns', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		const calls = createRecorder<[member: StorageMember, keys: number, rows: StreamPage]>()
		const recorded = new RecordedStorage(memory, calls.handler)
		await recorded.write('users', ['a', 'b'], [{ id: 'a' }, { id: 'b' }])
		await recorded.insert('users', 'c', { id: 'c' })
		expect(await recorded.read('users', ['a', 'missing'])).toEqual([{ id: 'a' }, undefined])
		expect(await recorded.read('users', 'c')).toEqual({ id: 'c' })
		expect(await recorded.read('users', 'missing')).toBeUndefined()
		expect(await recorded.keys('users')).toEqual(['a', 'b', 'c'])
		expect(await collect(recorded.scan('users'))).toHaveLength(3)
		expect(await recorded.delete('users', ['a', 'b'])).toEqual([true, true])
		expect(await recorded.delete('users', 'z')).toBe(false)
		await recorded.clear('users')
		expect(calls.calls.map(([member, keys, rows]) => [member, keys, rows.count])).toEqual([
			['write', 2, 0],
			['insert', 1, 0],
			['read', 2, 1],
			['read', 1, 1],
			['read', 1, 0],
			['keys', 0, 0],
			['scan', 0, 3],
			['delete', 2, 0],
			['delete', 1, 0],
			['clear', 0, 0],
		])
		expect(await memory.keys('users')).toEqual([])
	})

	it('forwards each keyed call in the form it received', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		const source = new FormStorage(memory)
		const recorded = new RecordedStorage(
			source,
			createRecorder<[StorageMember, number, StreamPage]>().handler,
		)
		await recorded.write('users', 'a', { id: 'a' })
		await recorded.write('users', ['b'], [{ id: 'b' }])
		await recorded.insert('users', 'c', { id: 'c' })
		await recorded.insert('users', ['d'], [{ id: 'd' }])
		await recorded.read('users', 'a')
		await recorded.read('users', ['a'])
		await recorded.delete('users', 'a')
		await recorded.delete('users', ['b'])
		expect(source.forms).toEqual([
			'write single',
			'write list',
			'insert single',
			'insert list',
			'read single',
			'read list',
			'delete single',
			'delete list',
		])
	})

	it('counts a call the storage rejects, and a scan returned and never pulled, as one call with no row', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		await memory.insert('users', 'a', { id: 'a' })
		const calls = createRecorder<[member: StorageMember, keys: number, rows: StreamPage]>()
		const recorded = new RecordedStorage(memory, calls.handler)
		await expect(recorded.insert('users', 'a', { id: 'a' })).rejects.toMatchObject({
			code: 'CONFLICT',
		})
		recorded.scan('users')
		expect(calls.calls.map(([member, keys, rows]) => [member, keys, rows.count])).toEqual([
			['insert', 1, 0],
			['scan', 0, 0],
		])
	})

	it('counts the rows a scan yielded before its source threw', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		const calls = createRecorder<[member: StorageMember, keys: number, rows: StreamPage]>()
		const recorded = new RecordedStorage(
			createMemoryAdapter(memory, {
				scan: () => streamThenFail([{ id: 'a' }, { id: 'b' }], 'scan failed'),
			}),
			calls.handler,
		)
		await expect(collect(recorded.scan('users'))).rejects.toThrow('scan failed')
		expect(calls.calls.map(([member, , rows]) => [member, rows.count])).toEqual([['scan', 2]])
	})

	it('refuses mismatched batch lists and mixed forms before the storage sees them, reporting nothing', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		const calls = createRecorder<[StorageMember, number, StreamPage]>()
		const recorded = new RecordedStorage(memory, calls.handler)
		await expect(recorded.write('users', ['a', 'b'], [{ id: 'a' }])).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		await expect(
			Reflect.apply(recorded.write, recorded, ['users', ['a'], { id: 'a' }]),
		).rejects.toMatchObject({
			code: 'VALIDATION',
			context: { keys: 1, rows: 1 },
		})
		await expect(
			Reflect.apply(recorded.insert, recorded, ['users', 'a', [{ id: 'a' }]]),
		).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(calls.calls).toEqual([])
		expect(await memory.keys('users')).toEqual([])
	})
})
