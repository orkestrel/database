import { integerShape, literalShape, stringShape } from '@orkestrel/contract'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedUsersTable } from '../../setup.js'

// `Cursor` — a forward walk over a snapshot of the table's keys taken when the
// cursor opens, reading each row lazily through the owning table. Covers
// value / index / done, `next` advancing the walk, in-place `update` / `remove`,
// `done` flipping past the last key, and `close` halting iteration. The cursor is
// always obtained via `table.cursor()` (which advances once so it starts on the
// first row). (Relocated out of Query.test.ts.)

// The base `id` / `name` / `age` columns plus this file's own `role` literal. The
// `createDatabase` + seed wiring is the shared `seedUsersTable` (tests/setup.ts,
// AGENTS §16.1); `columns` stays local (the per-file shape) so `Users` infers its
// exact row — the literal-union `role`, no `as`.
const columns = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	role: literalShape(['admin', 'member', 'guest']),
}

async function seeded() {
	return seedUsersTable(columns, (users) =>
		users.set([
			{ id: 'u1', name: 'Ada', age: 36, role: 'admin' },
			{ id: 'u2', name: 'Bo', age: 17, role: 'guest' },
			{ id: 'u3', name: 'Cy', age: 41, role: 'member' },
		]),
	)
}

type Users = Awaited<ReturnType<typeof seeded>>

describe('Cursor — position', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
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
		await cursor.next() // → u2
		await cursor.next() // → u3
		expect(cursor.done).toBe(false)
		await cursor.next() // past the end
		expect(cursor.done).toBe(true)
		expect(cursor.value).toBeUndefined()
	})
})

describe('Cursor — mutation', () => {
	let users: Users
	beforeEach(async () => {
		users = await seeded()
	})

	it('updates the row at the current position in place', async () => {
		const cursor = await users.cursor()
		await cursor.update({ role: 'member' })
		// The cursor's own value reflects the merged write.
		expect(cursor.value?.role).toBe('member')
		expect(cursor.value?.id).toBe('u1')
		// And the table is persisted.
		expect((await users.get('u1'))?.role).toBe('member')
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
		expect(await users.has('u2')).toBe(false) // the minor was removed
		expect((await users.get('u1'))?.role).toBe('member') // others updated
		expect(await users.count()).toBe(2)
	})
})

describe('Cursor — close', () => {
	it('stops iteration and ignores further mutation', async () => {
		const users = await seeded()
		const cursor = await users.cursor()
		cursor.close()
		expect(cursor.done).toBe(true)
		expect(cursor.value).toBeUndefined()
		// A post-close next does not resume the walk.
		await cursor.next()
		expect(cursor.done).toBe(true)
		// A post-close update is a no-op (the row is untouched).
		await cursor.update({ role: 'guest' })
		expect((await users.get('u1'))?.role).toBe('admin')
	})
})
