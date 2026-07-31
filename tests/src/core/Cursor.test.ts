import type { CursorInterface, DriverInterface, Row, TableInterface } from '@src/core'
import type { CursorUserRow } from '../../setup.js'
import { createMemoryDriver } from '@src/core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Cursor } from '../../../src/core/Cursor.js'
import { createMemoryAdapter, seedCursorDatabase } from '../../setup.js'

type Users = TableInterface<CursorUserRow>
type UserCursor = CursorInterface<CursorUserRow>

describe('Cursor — position', () => {
	let users: Users
	beforeAll(async () => {
		users = (await seedCursorDatabase()).users
	})

	it('opens positioned at the first row (index 0, not done)', async () => {
		const cursor = await users.cursor()
		expect(cursor.index).toBe(0)
		expect(cursor.done).toBe(false)
		expect(cursor.value?.id).toBe('u1')
	})

	it('advances forward through the key snapshot with next', async () => {
		const cursor = await users.cursor()
		const seen: string[] = []
		while (!cursor.done) {
			if (cursor.value) seen.push(cursor.value.id)
			await cursor.next()
		}
		expect(seen).toEqual(['u1', 'u2', 'u3'])
	})

	it('is done with an undefined value after the last key', async () => {
		const cursor = await users.cursor()
		await cursor.next()
		await cursor.next()
		expect(cursor.done).toBe(false)
		await cursor.next()
		expect(cursor.done).toBe(true)
		expect(cursor.value).toBeUndefined()
	})
})

describe('Cursor — mutation', () => {
	let users: Users
	beforeEach(async () => {
		users = (await seedCursorDatabase()).users
	})

	it('updates the row at the current position in place', async () => {
		const cursor = await users.cursor()
		await cursor.update({ role: 'member' })
		expect(cursor.value?.role).toBe('member')
		expect(cursor.value?.id).toBe('u1')
		expect((await users.get('u1'))?.role).toBe('member')
	})

	it('rejects changing the current row primary without moving or mutating it', async () => {
		const cursor = await users.cursor()
		await expect(cursor.update({ id: 'u9', role: 'member' })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(cursor.value?.id).toBe('u1')
		expect((await users.get('u1'))?.role).toBe('admin')
		expect(await users.get('u9')).toBeUndefined()
	})

	it('removes the row at the current position and clears the value', async () => {
		const cursor = await users.cursor()
		await cursor.remove()
		expect(cursor.value).toBeUndefined()
		expect(await users.has('u1')).toBe(false)
		expect(await users.count()).toBe(2)
	})

	it('iterates, removing some and updating others in one pass', async () => {
		const cursor = await users.cursor()
		let visited = 0
		while (!cursor.done) {
			visited += 1
			if (cursor.value && cursor.value.age < 18) await cursor.remove()
			else await cursor.update({ role: 'member' })
			await cursor.next()
		}
		expect(visited).toBe(3)
		expect(await users.has('u2')).toBe(false)
		expect((await users.get('u1'))?.role).toBe('member')
		expect(await users.count()).toBe(2)
	})
})

describe('Cursor — serialization and lifetime', () => {
	it('invokes the runner synchronously once per promise operation, including after close', async () => {
		let runs = 0
		let reads = 0
		const cursor = new Cursor<Row>(
			[],
			async () => {
				reads += 1
				return undefined
			},
			async () => false,
			async () => false,
			(operation) => {
				runs += 1
				return operation()
			},
		)
		cursor.close()
		expect(runs).toBe(0)
		const next = cursor.next()
		const update = cursor.update({})
		const remove = cursor.remove()
		expect(runs).toBe(3)
		await expect(Promise.all([next, update, remove])).resolves.toHaveLength(3)
		expect(reads).toBe(0)
	})

	it('serializes overlapping next calls against consecutive keys', async () => {
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const rows: Readonly<Record<string, Row>> = {
			u1: { id: 'u1' },
			u2: { id: 'u2' },
			u3: { id: 'u3' },
		}
		const reads: string[] = []
		const cursor = new Cursor<Row>(
			['u1', 'u2', 'u3'],
			async (key) => {
				reads.push(String(key))
				if (key === 'u2') {
					entered.resolve()
					await release.promise
				}
				return rows[String(key)]
			},
			async () => true,
			async () => true,
			(operation) => operation(),
		)
		await cursor.next()
		const first = cursor.next()
		const second = cursor.next()
		await entered.promise
		expect(reads).toEqual(['u1', 'u2'])
		release.resolve()
		await Promise.all([first, second])
		expect(reads).toEqual(['u1', 'u2', 'u3'])
		expect(cursor.index).toBe(2)
		expect(cursor.value).toEqual({ id: 'u3' })
	})

	it('orders overlapping next, update, and remove against the advanced row', async () => {
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const rows: Readonly<Record<string, Row>> = {
			u1: { id: 'u1', name: 'Ada' },
			u2: { id: 'u2', name: 'Bo' },
		}
		const order: string[] = []
		const cursor = new Cursor<Row>(
			['u1', 'u2'],
			async (key) => {
				order.push(`read:${key}`)
				if (key === 'u2' && order.filter((entry) => entry === 'read:u2').length === 1) {
					entered.resolve()
					await release.promise
				}
				return rows[String(key)]
			},
			async (key) => {
				order.push(`update:${key}`)
				return true
			},
			async (key) => {
				order.push(`remove:${key}`)
				return true
			},
			(operation) => operation(),
		)
		await cursor.next()
		const next = cursor.next()
		const update = cursor.update({ name: 'Updated' })
		const remove = cursor.remove()
		await entered.promise
		expect(order).toEqual(['read:u1', 'read:u2'])
		release.resolve()
		await Promise.all([next, update, remove])
		expect(order).toEqual(['read:u1', 'read:u2', 'update:u2', 'read:u2', 'remove:u2'])
		expect(cursor.index).toBe(1)
		expect(cursor.value).toBeUndefined()
	})

	it('continues queued work after a caller operation rejects', async () => {
		const reason = new Error('update failed')
		let fails = true
		const rows: Readonly<Record<string, Row>> = {
			u1: { id: 'u1' },
			u2: { id: 'u2' },
		}
		const cursor = new Cursor<Row>(
			['u1', 'u2'],
			async (key) => rows[String(key)],
			async () => {
				if (fails) {
					fails = false
					throw reason
				}
				return true
			},
			async () => true,
			(operation) => operation(),
		)
		await cursor.next()
		const rejected = cursor.update({})
		const later = cursor.next()
		await expect(rejected).rejects.toBe(reason)
		await expect(later).resolves.toBeUndefined()
		expect(cursor.value).toEqual({ id: 'u2' })
	})

	it('never publishes a value when close occurs during a dispatched read', async () => {
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const cursor = new Cursor<Row>(
			['u1'],
			async () => {
				entered.resolve()
				await release.promise
				return { id: 'u1' }
			},
			async () => true,
			async () => true,
			(operation) => operation(),
		)
		const next = cursor.next()
		await entered.promise
		cursor.close()
		release.resolve()
		await expect(next).resolves.toBeUndefined()
		expect(cursor.done).toBe(true)
		expect(cursor.value).toBeUndefined()
	})

	it('lets a dispatched update settle but skips its reread and queued remove after close', async () => {
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let reads = 0
		let updates = 0
		let removes = 0
		const cursor = new Cursor<Row>(
			['u1'],
			async () => {
				reads += 1
				return { id: 'u1' }
			},
			async () => {
				updates += 1
				entered.resolve()
				await release.promise
				return true
			},
			async () => {
				removes += 1
				return true
			},
			(operation) => operation(),
		)
		await cursor.next()
		const update = cursor.update({})
		const remove = cursor.remove()
		await entered.promise
		cursor.close()
		release.resolve()
		await expect(Promise.all([update, remove])).resolves.toHaveLength(2)
		expect(updates).toBe(1)
		expect(reads).toBe(1)
		expect(removes).toBe(0)
		expect(cursor.value).toBeUndefined()
	})
})

describe('Cursor — close', () => {
	it('stops iteration and ignores further mutation', async () => {
		const { users } = await seedCursorDatabase()
		const cursor = await users.cursor()
		cursor.close()
		expect(cursor.done).toBe(true)
		expect(cursor.value).toBeUndefined()
		await cursor.next()
		expect(cursor.done).toBe(true)
		await cursor.update({ role: 'guest' })
		expect((await users.get('u1'))?.role).toBe('admin')
	})
})

describe('Cursor — transaction continuations', () => {
	it('drains an unawaited next that skips a deleted snapshot key', async () => {
		const { db } = await seedCursorDatabase()
		const captured = Promise.withResolvers<UserCursor>()
		await db.transaction(async (transaction) => {
			const users = transaction.table('users')
			const cursor = await users.cursor()
			captured.resolve(cursor)
			await users.remove('u2')
			void cursor.next()
		})
		const cursor = await captured.promise
		expect(cursor.value?.id).toBe('u3')
		expect(cursor.index).toBe(2)
	})

	it('drains one unawaited update through persistence and the normalized reread', async () => {
		const memory = createMemoryDriver()
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let blocking = false
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async write(table, key, row, options) {
				if (blocking) {
					entered.resolve()
					await release.promise
				}
				const normalized: Row = { ...row }
				if (typeof normalized.name === 'string') normalized.name = normalized.name.trim()
				await memory.write(table, key, normalized, options)
			},
		}
		const { db, users } = await seedCursorDatabase(driver)
		blocking = true
		const captured = Promise.withResolvers<UserCursor>()
		const operation = Promise.withResolvers<Promise<void>>()
		const running = db.transaction(async (transaction) => {
			const cursor = await transaction.table('users').cursor()
			captured.resolve(cursor)
			operation.resolve(cursor.update({ name: '  Updated  ' }))
		})
		await entered.promise
		await expect(users.get('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
		release.resolve()
		await expect(running).resolves.toBeUndefined()
		await expect(operation.promise).resolves.toBeUndefined()
		expect((await captured.promise).value?.name).toBe('Updated')
		expect((await users.get('u1'))?.name).toBe('Updated')
	})

	it('rolls back when an unawaited cursor update fails validation', async () => {
		const { db, users } = await seedCursorDatabase()
		await expect(
			db.transaction(async (transaction) => {
				const cursor = await transaction.table('users').cursor()
				void cursor.update({ age: -1 })
			}),
		).rejects.toMatchObject({ code: 'VALIDATION' })
		expect((await users.get('u1'))?.age).toBe(36)
	})

	it('rejects retained active cursor operations after settlement', async () => {
		const { db } = await seedCursorDatabase()
		const captured = Promise.withResolvers<UserCursor>()
		await db.transaction(async (transaction) => {
			captured.resolve(await transaction.table('users').cursor())
		})
		const cursor = await captured.promise
		await expect(cursor.next()).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(cursor.update({ age: 37 })).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(cursor.remove()).rejects.toMatchObject({ code: 'CONFLICT' })
	})

	it('rejects a retained closed cursor through the settled transaction ledger', async () => {
		const { db } = await seedCursorDatabase()
		const captured = Promise.withResolvers<UserCursor>()
		await db.transaction(async (transaction) => {
			const cursor = await transaction.table('users').cursor()
			cursor.close()
			captured.resolve(cursor)
		})
		await expect((await captured.promise).next()).rejects.toMatchObject({ code: 'CONFLICT' })
	})
})
