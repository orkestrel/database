import { integerShape, optionalShape, stringShape } from '@orkestrel/contract'
import { beforeAll, describe, expect, it } from 'vitest'
import { seedUsersTable } from '../../setup.js'

// `Clause`'s fifteen operator methods. Each closes the pending condition with
// the right operator + operands and hands the query back so the chain continues —
// asserted through real execution over a `createMemoryDriver`-backed table (the
// engine compiles the recorded `Condition`), never by reading internals. Every
// operator also returns the owning `QueryInterface`, which a follow-on `.all()` /
// `.and(...)` proves. (Relocated out of Query.test.ts so that file keeps to
// `Query`'s own where/and/or dispatch, ordering, paging, filter, and aggregates.)

// The base `id` / `name` / `age` columns plus this file's own `nickname` optional. The
// `createDatabase` + seed wiring is the shared `seedUsersTable` (tests/setup.ts,
// AGENTS §16.1); `columns` stays local so `Users` infers its exact row — the optional
// `nickname`, no `as`.
const columns = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	nickname: optionalShape(stringShape()),
}

async function seeded() {
	return seedUsersTable(columns, (users) =>
		users.set([
			{ id: 'u1', name: 'Ada', age: 36, nickname: 'Addy' },
			{ id: 'u2', name: 'Bob', age: 41 },
			{ id: 'u3', name: 'Cyrus', age: 22, nickname: 'Cy' },
			{ id: 'u4', name: 'Dorian', age: 50 },
		]),
	)
}

type Users = Awaited<ReturnType<typeof seeded>>

// Run a single-condition query and return the matching ids, sorted for stability.
async function ids(users: Users, build: (table: Users) => Promise<readonly { id: string }[]>) {
	return (await build(users)).map((row) => row.id).sort()
}

describe('Clause — equality operators', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('equals matches an exact value', async () => {
		expect(await ids(users, (t) => t.query().where('name').equals('Ada').all())).toEqual(['u1'])
	})

	it('not excludes an exact value', async () => {
		expect(await ids(users, (t) => t.query().where('age').not(36).all())).toEqual([
			'u2',
			'u3',
			'u4',
		])
	})
})

describe('Clause — comparison operators', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('above is strictly greater', async () => {
		expect(await ids(users, (t) => t.query().where('age').above(36).all())).toEqual(['u2', 'u4'])
	})

	it('below is strictly less', async () => {
		expect(await ids(users, (t) => t.query().where('age').below(36).all())).toEqual(['u3'])
	})

	it('from is greater-or-equal', async () => {
		expect(await ids(users, (t) => t.query().where('age').from(36).all())).toEqual([
			'u1',
			'u2',
			'u4',
		])
	})

	it('to is less-or-equal', async () => {
		expect(await ids(users, (t) => t.query().where('age').to(36).all())).toEqual(['u1', 'u3'])
	})

	it('between is an inclusive range over two operands', async () => {
		expect(await ids(users, (t) => t.query().where('age').between(30, 45).all())).toEqual([
			'u1',
			'u2',
		])
	})
})

describe('Clause — string operators', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('like matches a SQL pattern (% wildcard)', async () => {
		// `%us` ends in "us" — only Cyrus.
		expect(await ids(users, (t) => t.query().where('name').like('%us').all())).toEqual(['u3'])
	})

	it('glob matches a glob pattern (* wildcard, case-sensitive)', async () => {
		expect(await ids(users, (t) => t.query().where('name').glob('A*').all())).toEqual(['u1'])
		// Glob is case-sensitive — a lowercase prefix matches nothing here.
		expect(await ids(users, (t) => t.query().where('name').glob('a*').all())).toEqual([])
	})

	it('starts matches a prefix', async () => {
		expect(await ids(users, (t) => t.query().where('name').starts('C').all())).toEqual(['u3'])
	})

	it('ends matches a suffix', async () => {
		expect(await ids(users, (t) => t.query().where('name').ends('n').all())).toEqual(['u4'])
	})
})

describe('Clause — membership operators', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('any matches a value in the list', async () => {
		expect(await ids(users, (t) => t.query().where('id').any(['u1', 'u3']).all())).toEqual([
			'u1',
			'u3',
		])
	})

	it('none excludes every value in the list', async () => {
		expect(await ids(users, (t) => t.query().where('id').none(['u1', 'u3']).all())).toEqual([
			'u2',
			'u4',
		])
	})
})

describe('Clause — presence operators (no operand)', () => {
	let users: Users
	beforeAll(async () => {
		users = await seeded()
	})

	it('present matches rows where the column is set', async () => {
		expect(await ids(users, (t) => t.query().where('nickname').present().all())).toEqual([
			'u1',
			'u3',
		])
	})

	it('absent matches rows where the column is missing', async () => {
		expect(await ids(users, (t) => t.query().where('nickname').absent().all())).toEqual([
			'u2',
			'u4',
		])
	})
})

describe('Clause — chaining', () => {
	it('every operator returns the query, so conditions chain through and / or', async () => {
		const users = await seeded()
		// above(...) returns the query → .and(...) opens the next clause → .all() runs.
		const result = await users.query().where('age').above(20).and('name').starts('C').all()
		expect(result.map((row) => row.id)).toEqual(['u3'])

		const either = await users.query().where('name').equals('Ada').or('name').equals('Bob').all()
		expect(either.map((row) => row.id).sort()).toEqual(['u1', 'u2'])
	})

	it('records the connector on each chained condition (and vs or)', async () => {
		const users = await seeded()
		// `or` widens the set; an equivalent `and` of the two would be empty.
		expect(
			(await users.query().where('age').equals(36).or('age').equals(41).all())
				.map((row) => row.id)
				.sort(),
		).toEqual(['u1', 'u2'])
		expect(await users.query().where('age').equals(36).and('age').equals(41).count()).toBe(0)
	})
})
