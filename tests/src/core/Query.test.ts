import { captureFailure } from '@src/core'
import { collect } from '@orkestrel/test'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Users } from '../../setup.js'
import { DatabaseFixture, seeded, createNestedPeopleTable } from '../../setup.js'

// `Query`'s own surface — portable conditions and ordering, the post-fetch
// `filter`, `limit` / `offset` paging, the
// terminals (`all` / `first` / `count` / the aggregates), and nested `FieldPath`
// reads. The cursor lives in Cursor.test.ts.

describe('Query — where / and / or dispatch', () => {
	const users = new DatabaseFixture<Users>()
	beforeAll(async () => {
		users.hold(await seeded())
	})

	it('opens a clause with where and runs the resulting condition', async () => {
		const adults = await users.value
			.query()
			.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
			.collect()
		expect(adults.map((user) => user.id).sort()).toEqual(['u1', 'u3', 'u4'])
	})

	it('joins further clauses with and (intersection) / or (union)', async () => {
		const result = await users.value
			.query()
			.condition({ column: 'age', operator: 'above', values: [18], connector: 'and' })
			.condition({ column: 'role', operator: 'equals', values: ['member'], connector: 'and' })
			.collect()
		expect(result.map((user) => user.id).sort()).toEqual(['u3', 'u4'])

		const either = await users.value
			.query()
			.condition({ column: 'role', operator: 'equals', values: ['admin'], connector: 'and' })
			.condition({ column: 'role', operator: 'equals', values: ['guest'], connector: 'or' })
			.collect()
		expect(either.map((user) => user.id).sort()).toEqual(['u1', 'u2'])
	})
})

describe('Query — ordering, paging, filter', () => {
	const users = new DatabaseFixture<Users>()
	beforeAll(async () => {
		users.hold(await seeded())
	})

	it('orders and pages', async () => {
		const oldest = await users.value
			.query()
			.order({ column: 'age', direction: 'descending' })
			.limit(2)
			.collect()
		expect(oldest.map((user) => user.age)).toEqual([41, 36])

		const page = await users.value
			.query()
			.order({ column: 'age', direction: 'ascending' })
			.offset(1)
			.limit(2)
			.collect()
		expect(page.map((user) => user.age)).toEqual([23, 36])
	})

	it('rejects invalid page builders synchronously without mutating the query', async () => {
		const limit = users.value.query().order({ column: 'age', direction: 'ascending' })
		expect(() => limit.limit(-1)).toThrow('Query limit must be a nonnegative integer')
		expect((await limit.collect()).map((user) => user.age)).toEqual([17, 23, 36, 41])

		const offset = users.value.query().order({ column: 'age', direction: 'ascending' })
		expect(() => offset.offset(Number.NaN)).toThrow('Query offset must be a nonnegative integer')
		expect((await offset.collect()).map((user) => user.age)).toEqual([17, 23, 36, 41])
	})

	it('accepts zero paging for eager and streamed queries', async () => {
		expect(await users.value.query().limit(0).collect()).toEqual([])
		expect(await collect(users.value.query().limit(0).stream())).toEqual([])
		expect(await users.value.query().offset(0).limit(1).collect()).toHaveLength(1)
	})

	it('returns the first match or undefined', async () => {
		expect(
			(await users.value.query().order({ column: 'age', direction: 'ascending' }).find())?.id,
		).toBe('u2')
		expect(
			await users.value
				.query()
				.condition({ column: 'age', operator: 'above', values: [100], connector: 'and' })
				.find(),
		).toBeUndefined()
	})

	it('applies a post-fetch JS filter that composes with conditions and paging', async () => {
		// Names: Ada(3), Bo(2), Cy(2), Di(2) — the length-2 filter drops Ada.
		const result = await users.value
			.query()
			.filter((user) => user.name.length === 2)
			.order({ column: 'id', direction: 'ascending' })
			.collect()
		expect(result.map((user) => user.id)).toEqual(['u2', 'u3', 'u4'])

		const paged = await users.value
			.query()
			.filter((user) => user.age >= 18)
			.order({ column: 'age', direction: 'ascending' })
			.offset(1)
			.limit(1)
			.collect()
		expect(paged.map((user) => user.id)).toEqual(['u1']) // ages 23,36,41 → offset 1 → 36 = Ada
	})
})

describe('Query — aggregates', () => {
	const users = new DatabaseFixture<Users>()
	beforeAll(async () => {
		users.hold(await seeded())
	})

	it('counts, sums, averages, and finds extremes', async () => {
		expect(await users.value.query().count()).toBe(4)
		expect(
			await users.value
				.query()
				.condition({ column: 'role', operator: 'equals', values: ['member'], connector: 'and' })
				.count(),
		).toBe(2)
		expect(await users.value.query().aggregate('sum', 'age')).toBe(117)
		expect(await users.value.query().aggregate('minimum', 'age')).toBe(17)
		expect(await users.value.query().aggregate('maximum', 'age')).toBe(41)
		expect(
			await users.value
				.query()
				.condition({ column: 'role', operator: 'equals', values: ['member'], connector: 'and' })
				.aggregate('average', 'age'),
		).toBe(32)
	})

	it('aggregates over a JS-filtered set', async () => {
		const total = await users.value
			.query()
			.filter((user) => user.age >= 18)
			.aggregate('sum', 'age')
		expect(total).toBe(100)
	})
})

describe('Query — stream (lazy streaming)', () => {
	const users = new DatabaseFixture<Users>()
	beforeAll(async () => {
		users.hold(await seeded())
	})

	it('yields lazily honoring conditions plus limit/offset', async () => {
		const rows = await collect(
			users.value
				.query()
				.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
				.stream(),
		)
		expect(rows.map((row) => row.id).sort()).toEqual(['u1', 'u3', 'u4'])

		const paged = await collect(
			users.value
				.query()
				.order({ column: 'age', direction: 'ascending' })
				.offset(1)
				.limit(2)
				.stream(),
		)
		// order is ignored by stream — paging counts over unsorted (insertion) order.
		expect(paged).toHaveLength(2)
	})

	it('applies a post-fetch filter per row', async () => {
		const rows = await collect(
			users.value
				.query()
				.filter((user) => user.name.length === 2)
				.stream(),
		)
		expect(rows.map((row) => row.id).sort()).toEqual(['u2', 'u3', 'u4'])
	})

	it('aborts mid-stream once the signal fires', async () => {
		const controller = new AbortController()
		const seen: string[] = []
		const error = await captureFailure(async () => {
			for await (const row of users.value.query().stream({ signal: controller.signal })) {
				seen.push(row.id)
				controller.abort('aborted')
			}
		})
		expect(seen).toEqual(['u1'])
		expect(error).toMatchObject({ code: 'ABORTED' })
	})
})

describe('Query — nested fields (FieldPath)', () => {
	it('filters / sorts / aggregates a nested value through an array path', async () => {
		const people = await createNestedPeopleTable()
		// array path descends; string would be ONE (flat) column.
		expect(
			(
				await people
					.query()
					.condition({
						column: ['profile', 'age'],
						operator: 'from',
						values: [18],
						connector: 'and',
					})
					.collect()
			)
				.map((p) => p.id)
				.sort(),
		).toEqual(['p1', 'p3'])
		expect(
			(
				await people
					.query()
					.order({ column: ['profile', 'age'], direction: 'descending' })
					.collect()
			).map((p) => p.id),
		).toEqual(['p3', 'p1', 'p2'])
		expect(await people.query().aggregate('maximum', ['profile', 'age'])).toBe(41)
	})

	it('treats a single string as one column, never a dotted path', async () => {
		const people = await createNestedPeopleTable()
		// 'profile.age' is a literal column name (absent here) — not split on '.'.
		expect(
			await people
				.query()
				.condition({ column: 'profile.age', operator: 'present', values: [], connector: 'and' })
				.count(),
		).toBe(0)
	})
})
