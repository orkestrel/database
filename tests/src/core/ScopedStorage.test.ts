import { createMemoryDriver, DatabaseError, ScopedStorage } from '@src/core'
import { isFunction } from '@orkestrel/contract'
import { captureError, collect, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	createCompleteDriver,
	createMemoryAdapter,
	DatabaseSwitch,
	tableSchemas,
} from '../../setup.js'

// `ScopedStorage` over a real Memory driver, guarded by a switch the test settles: every member
// forwards while the guard passes and refuses after it throws, and `scan` checks around each
// advance.

describe('ScopedStorage', () => {
	it('forwards the single and list forms of each keyed member while the guard passes', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		const scoped = new ScopedStorage(driver, () => {})
		await scoped.write('users', ['u1', 'u2'], [{ id: 'u1' }, { id: 'u2' }])
		await scoped.insert('users', 'u3', { id: 'u3' })
		expect(await scoped.read('users', ['u3', 'missing'])).toEqual([{ id: 'u3' }, undefined])
		expect(await scoped.delete('users', ['u1', 'missing'])).toEqual([true, false])
		expect(await scoped.delete('users', 'u2')).toBe(true)
		expect(await scoped.keys('users')).toEqual(['u3'])
		expect(await collect(scoped.scan('users'))).toEqual([{ id: 'u3' }])
		await scoped.clear('users')
		expect(await driver.keys('users')).toEqual([])
	})

	it('refuses every member after the guard throws, and changes no row', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		await driver.write('users', 'u1', { id: 'u1' })
		const settled = new DatabaseSwitch()
		const scoped = new ScopedStorage(driver, () => {
			if (settled.active) throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		})
		settled.enable()
		const refused = { code: 'CONFLICT' }
		await expect(scoped.read('users', 'u1')).rejects.toMatchObject(refused)
		await expect(scoped.write('users', 'u2', { id: 'u2' })).rejects.toMatchObject(refused)
		await expect(scoped.insert('users', ['u2'], [{ id: 'u2' }])).rejects.toMatchObject(refused)
		await expect(scoped.delete('users', 'u1')).rejects.toMatchObject(refused)
		await expect(scoped.keys('users')).rejects.toMatchObject(refused)
		await expect(scoped.clear('users')).rejects.toMatchObject(refused)
		await expect(collect(scoped.scan('users'))).rejects.toMatchObject(refused)
		expect(await driver.keys('users')).toEqual(['u1'])
	})

	it('refuses the scan advance after the scope settles mid-iteration', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		await driver.write('users', ['u1', 'u2'], [{ id: 'u1' }, { id: 'u2' }])
		const settled = new DatabaseSwitch()
		const scoped = new ScopedStorage(driver, () => {
			if (settled.active) throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		})
		const iterator = scoped.scan('users')[Symbol.asyncIterator]()
		expect(await iterator.next()).toEqual({ done: false, value: { id: 'u1' } })
		settled.enable()
		await expect(iterator.next()).rejects.toMatchObject({ code: 'CONFLICT' })
	})
})

describe('ScopedStorage — optional members', () => {
	it('forwards each optional member while the guard passes and refuses each after it throws', async () => {
		const driver = createCompleteDriver()
		const schema = tableSchemas('users')
		await driver.open(schema)
		await driver.write('users', ['u1', 'u2'], [{ id: 'u1' }, { id: 'u2' }])
		const settled = new DatabaseSwitch()
		const scoped = new ScopedStorage(driver, () => {
			if (settled.active) throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		})
		const plan = requireValue(scoped.plan)
		const records = requireValue(scoped.records)
		const stream = requireValue(scoped.stream)
		const aggregate = requireValue(scoped.aggregate)
		const migrate = requireValue(scoped.migrate)
		const metadata = requireValue(scoped.metadata)
		const stamp = requireValue(scoped.stamp)
		const rows = [{ id: 'u1' }, { id: 'u2' }]
		expect(plan('users', { limit: 1 })).toEqual({ native: { limit: 1 }, residual: {} })
		expect(await records('users', {})).toEqual(rows)
		expect(await collect(stream('users', {}))).toEqual(rows)
		expect(await aggregate('users', 'count', 'id', {})).toBe(2)
		await migrate({ plan: { from: 1, to: 2, steps: [] } })
		await stamp({ version: 2, schema })
		expect(await metadata()).toEqual({ version: 2, schema })

		settled.enable()
		const refused = { code: 'CONFLICT' }
		expect(captureError(() => plan('users', {}))).toMatchObject(refused)
		await expect(records('users', {})).rejects.toMatchObject(refused)
		expect(captureError(() => stream('users', {}))).toMatchObject(refused)
		await expect(aggregate('users', 'count', 'id', {})).rejects.toMatchObject(refused)
		await expect(migrate({ plan: { from: 2, to: 3, steps: [] } })).rejects.toMatchObject(refused)
		await expect(metadata()).rejects.toMatchObject(refused)
		await expect(stamp({ version: 3, schema })).rejects.toMatchObject(refused)
		expect(await driver.metadata?.()).toEqual({ version: 2, schema })
	})

	it('declares no optional member over a source that declares none', () => {
		const scoped = new ScopedStorage(createMemoryAdapter(createMemoryDriver()), () => {})
		expect([
			scoped.plan,
			scoped.records,
			scoped.stream,
			scoped.aggregate,
			scoped.migrate,
			scoped.metadata,
			scoped.stamp,
		]).toEqual(Array.from({ length: 7 }, () => undefined))
	})

	it('declares over a MemoryDriver only the optional members it declares', () => {
		const scoped = new ScopedStorage(createMemoryDriver(), () => {})
		expect([scoped.plan, scoped.records, scoped.stream, scoped.aggregate]).toEqual(
			Array.from({ length: 4 }, () => undefined),
		)
		expect([scoped.migrate, scoped.metadata, scoped.stamp].every(isFunction)).toBe(true)
	})
})
