import { createDatabase, createMemoryDriver } from '@src/core'
import { integerShape, literalShape, objectShape, stringShape } from '@orkestrel/contract'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectRows, seedUsersTable } from '../../setup.js'

// `Query`'s own surface — the where / and / or dispatch (the per-operator
// behavior is `Clause`'s and lives in Clause.test.ts), the post-fetch
// `filter`, `ascending` / `descending` ordering, `limit` / `offset` paging, the
// terminals (`all` / `first` / `count` / the aggregates), and nested `FieldPath`
// reads. The cursor lives in Cursor.test.ts.

// The base `id` / `name` / `age` columns plus this file's own `role` literal. The
// `createDatabase` + seed wiring is the shared `seedUsersTable` (tests/setup.ts,
// AGENTS §16.1); `columns` stays local so `Users` infers its exact row (no `as`).
const columns = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	role: literalShape(['admin', 'member', 'guest']),
}

// The table's row type is inferred from its columns — no hand-written alias.
async function seeded() {
	return seedUsersTable(columns, (users) =>
		users.set([
			{ id: 'u1', name: 'Ada', age: 36, role: 'admin' },
			{ id: 'u2', name: 'Bo', age: 17, role: 'guest' },
			{ id: 'u3', name: 'Cy', age: 41, role: 'member' },
			{ id: 'u4', name: 'Di', age: 23, role: 'member' },
		]),
	)
}

type Users = Awaited<ReturnType<typeof seeded>>

describe('Query — where / and / or dispatch', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('opens a clause with where and runs the resulting condition', async () => {
		const adults = await users.query().where('age').from(18).all()
		expect(adults.map((user) => user.id).sort()).toEqual(['u1', 'u3', 'u4'])
	})

	it('joins further clauses with and (intersection) / or (union)', async () => {
		const result = await users.query().where('age').above(18).and('role').equals('member').all()
		expect(result.map((user) => user.id).sort()).toEqual(['u3', 'u4'])

		const either = await users
			.query()
			.where('role')
			.equals('admin')
			.or('role')
			.equals('guest')
			.all()
		expect(either.map((user) => user.id).sort()).toEqual(['u1', 'u2'])
	})
})

describe('Query — ordering, paging, filter', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('orders and pages', async () => {
		const oldest = await users.query().descending('age').limit(2).all()
		expect(oldest.map((user) => user.age)).toEqual([41, 36])

		const page = await users.query().ascending('age').offset(1).limit(2).all()
		expect(page.map((user) => user.age)).toEqual([23, 36])
	})

	it('returns the first match or undefined', async () => {
		expect((await users.query().ascending('age').first())?.id).toBe('u2')
		expect(await users.query().where('age').above(100).first()).toBeUndefined()
	})

	it('applies a post-fetch JS filter that composes with conditions and paging', async () => {
		// Names: Ada(3), Bo(2), Cy(2), Di(2) — the length-2 filter drops Ada.
		const result = await users
			.query()
			.filter((user) => user.name.length === 2)
			.ascending('id')
			.all()
		expect(result.map((user) => user.id)).toEqual(['u2', 'u3', 'u4'])

		const paged = await users
			.query()
			.filter((user) => user.age >= 18)
			.ascending('age')
			.offset(1)
			.limit(1)
			.all()
		expect(paged.map((user) => user.id)).toEqual(['u1']) // ages 23,36,41 → offset 1 → 36 = Ada
	})
})

describe('Query — aggregates', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('counts, sums, averages, and finds extremes', async () => {
		expect(await users.query().count()).toBe(4)
		expect(await users.query().where('role').equals('member').count()).toBe(2)
		expect(await users.query().sum('age')).toBe(117)
		expect(await users.query().minimum('age')).toBe(17)
		expect(await users.query().maximum('age')).toBe(41)
		expect(await users.query().where('role').equals('member').average('age')).toBe(32)
	})

	it('aggregates over a JS-filtered set', async () => {
		const total = await users
			.query()
			.filter((user) => user.age >= 18)
			.sum('age')
		expect(total).toBe(100)
	})
})

describe('Query — stream (lazy streaming)', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('yields lazily honoring conditions plus limit/offset', async () => {
		const rows = await collectRows(users.query().where('age').from(18).stream())
		expect(rows.map((row) => row.id).sort()).toEqual(['u1', 'u3', 'u4'])

		const paged = await collectRows(users.query().ascending('age').offset(1).limit(2).stream())
		// order is ignored by stream — paging counts over unsorted (insertion) order.
		expect(paged).toHaveLength(2)
	})

	it('applies a post-fetch filter per row', async () => {
		const rows = await collectRows(
			users
				.query()
				.filter((user) => user.name.length === 2)
				.stream(),
		)
		expect(rows.map((row) => row.id).sort()).toEqual(['u2', 'u3', 'u4'])
	})

	it('aborts mid-stream once the signal fires', async () => {
		const controller = new AbortController()
		const seen: string[] = []
		let error: unknown
		try {
			for await (const row of users.query().stream({ signal: controller.signal })) {
				seen.push(row.id)
				controller.abort('cancelled')
			}
		} catch (caught) {
			error = caught
		}
		expect(seen).toEqual(['u1'])
		expect(error).toMatchObject({ code: 'ABORTED' })
	})
})

describe('Query — nested fields (FieldPath)', () => {
	async function nested() {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: {
				people: {
					id: stringShape(),
					profile: objectShape({ name: stringShape(), age: integerShape() }),
				},
			},
		})
		const people = db.table('people')
		await people.set({ id: 'p1', profile: { name: 'Ada', age: 36 } })
		await people.set({ id: 'p2', profile: { name: 'Bo', age: 17 } })
		await people.set({ id: 'p3', profile: { name: 'Cy', age: 41 } })
		return people
	}

	it('filters / sorts / aggregates a nested value via an array path', async () => {
		const people = await nested()
		// array path descends; string would be ONE (flat) column.
		expect(
			(await people.query().where(['profile', 'age']).from(18).all()).map((p) => p.id).sort(),
		).toEqual(['p1', 'p3'])
		expect((await people.query().descending(['profile', 'age']).all()).map((p) => p.id)).toEqual([
			'p3',
			'p1',
			'p2',
		])
		expect(await people.query().maximum(['profile', 'age'])).toBe(41)
	})

	it('treats a single string as one column, never a dotted path', async () => {
		const people = await nested()
		// 'profile.age' is a literal column name (absent here) — not split on '.'.
		expect(await people.query().where('profile.age').present().count()).toBe(0)
	})
})
