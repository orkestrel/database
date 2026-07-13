import type { Criteria, DatabaseInterface, RowOf, TableInterface } from '@src/core'
import { createDatabase, createMemoryDriver } from '@src/core'
import { createSQLiteDriver } from '@src/server'
import {
	booleanShape,
	integerShape,
	jsonShape,
	numberShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Cross-backend PARITY suite — the enduring regression net proving the
// SQLite driver (exact-or-refine over `src/server`) returns byte-identical
// query results to the reference `MemoryDriver` (the pure core engine over
// a scan), across every clause operator, ordering, paging, and aggregate the
// public `Table` / `Query` surface exposes. Data-driven: one shared fixture +
// two CASES tables (row-returning and scalar-returning), each run against
// both backends and compared.

const USERS = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	score: numberShape(),
	active: booleanShape(),
	bio: optionalShape(stringShape()),
	meta: jsonShape(),
	rank: optionalShape(integerShape()),
} as const

type UserRow = RowOf<typeof USERS>

// Mixed-case + non-ASCII names, boundary ages (0, negative, 17/18, 65, a large
// value), an OPTIONAL `bio` (absent on several rows rather than explicit
// null — SQLite's decodeRow omits a NULL column on read-back, so an absent
// field is the shape that round-trips identically on both backends), a
// nested `meta` json value, and an OPTIONAL `rank` (indexed on the browser
// side, absent on several rows — the lossy-pushdown reproduction).
const ROWS: readonly UserRow[] = [
	{
		id: 'u1',
		name: 'Ada',
		age: 36,
		score: 91.5,
		active: true,
		bio: 'Computer science pioneer',
		meta: { tags: ['math', 'logic'], info: { level: 9, ok: true } },
		rank: 10,
	},
	{
		id: 'u2',
		name: 'ada',
		age: 0,
		score: 0,
		active: false,
		meta: { tags: [], info: { level: 0, ok: false } },
	},
	{
		id: 'u3',
		name: 'ÄPFEL',
		age: -5,
		score: -2.5,
		active: true,
		bio: 'Apples in German',
		meta: { tags: ['fruit'], info: { level: 3, ok: true } },
		rank: 5,
	},
	{
		id: 'u4',
		name: 'bob',
		age: 17,
		score: 50,
		active: false,
		meta: { tags: ['x'], info: { level: 1, ok: false } },
	},
	{
		id: 'u5',
		name: 'Grace',
		age: 18,
		score: 77.7,
		active: true,
		bio: 'Compiler pioneer',
		meta: { tags: ['compiler', 'math'], info: { level: 5, ok: true } },
		rank: 20,
	},
	{
		id: 'u6',
		name: 'Edsger',
		age: 65,
		score: 100,
		active: false,
		meta: { tags: [], info: { level: 10, ok: true } },
	},
	{
		id: 'u7',
		name: 'Marie',
		age: 1000000,
		score: 1e9,
		active: true,
		bio: 'Large age case',
		meta: { tags: ['big'], info: { level: 2, ok: false } },
		rank: 1,
	},
	// Non-BMP parity fixture (AGENTS/audit FIX 1 + FIX 8): `u8`'s name starts
	// with a SUPPLEMENTARY-plane character (U+1F600, encoded as the UTF-16
	// surrogate pair 😀 — lead surrogate 0xD83D), `u9`'s starts with
	// a single BMP PRIVATE-USE character (U+E050 — code unit 0xE050). Ordered
	// by Unicode CODE POINT (SQLite's default BINARY collation), u8 (U+1F600)
	// sorts ABOVE u9 (U+E050); ordered by UTF-16 CODE UNIT (the core engine's
	// `compareValues`, using JS `<`), u8's lead surrogate (0xD83D = 55357) is
	// NUMERICALLY LESS than u9's single code unit (0xE050 = 57424), so u8
	// sorts BELOW u9 — the exact divergence `isExactCondition` / `isExactOrder`
	// now refine `text` ranges/order to avoid (FIX 1).
	{
		id: 'u8',
		name: '\u{1F600}-user',
		age: 40,
		score: 12.5,
		active: true,
		meta: { tags: ['emoji'], info: { level: 4, ok: true } },
	},
	{
		id: 'u9',
		name: '-zzz',
		age: 41,
		score: 13.5,
		active: false,
		meta: { tags: ['private-use'], info: { level: 6, ok: false } },
	},
]

const INDEXES = { users: [['age'], ['name'], ['rank']] } as const

function memoryDatabase(): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createMemoryDriver(),
		tables: { users: USERS },
		indexes: INDEXES,
	})
}

function sqliteDatabase(): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createSQLiteDriver(),
		tables: { users: USERS },
		indexes: INDEXES,
	})
}

type UsersTable = TableInterface<UserRow>

function sortById(rows: readonly UserRow[]): readonly UserRow[] {
	return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

// A row-returning case: `ordered` distinguishes an order-sensitive comparison
// (compare arrays exactly) from an order-insensitive one (sort by `id` first).
interface RowCase {
	readonly name: string
	readonly ordered?: boolean
	run(users: UsersTable): Promise<readonly UserRow[]>
}

// A scalar-returning case (count / an aggregate) — compared directly.
interface ScalarCase {
	readonly name: string
	run(users: UsersTable): Promise<number | undefined>
}

const ROW_CASES: readonly RowCase[] = [
	// ── All 15 clause operators (each its own case) ──────────────────────
	{ name: 'equals', run: (users) => users.query().where('age').equals(36).all() },
	{ name: 'not', run: (users) => users.query().where('active').not(true).all() },
	{ name: 'above', run: (users) => users.query().where('age').above(18).all() },
	{ name: 'below', run: (users) => users.query().where('age').below(18).all() },
	{ name: 'from', run: (users) => users.query().where('age').from(18).all() },
	{ name: 'to', run: (users) => users.query().where('age').to(18).all() },
	{ name: 'between', run: (users) => users.query().where('age').between(0, 36).all() },
	{ name: 'like', run: (users) => users.query().where('name').like('%a%').all() },
	{ name: 'glob', run: (users) => users.query().where('name').glob('[A-Z]*').all() },
	{ name: 'starts', run: (users) => users.query().where('name').starts('A').all() },
	{ name: 'ends', run: (users) => users.query().where('name').ends('e').all() },
	{ name: 'any', run: (users) => users.query().where('name').any(['Ada', 'Grace', 'nope']).all() },
	{ name: 'none', run: (users) => users.query().where('name').none(['Ada', 'Grace']).all() },
	{ name: 'absent (rank)', run: (users) => users.query().where('rank').absent().all() },
	{ name: 'present (rank)', run: (users) => users.query().where('rank').present().all() },

	// ── starts/ends case-sensitivity ─────────────────────────────────────
	{
		name: "starts('ada') case variation",
		run: (users) => users.query().where('name').starts('ada').all(),
	},
	{
		name: "starts('Ada') case variation",
		run: (users) => users.query().where('name').starts('Ada').all(),
	},
	{ name: "ends('a') case variation", run: (users) => users.query().where('name').ends('a').all() },
	{ name: "ends('A') case variation", run: (users) => users.query().where('name').ends('A').all() },
	{
		name: "starts('') matches every row",
		run: (users) => users.query().where('name').starts('').all(),
	},
	{
		name: "ends('') matches every row",
		run: (users) => users.query().where('name').ends('').all(),
	},

	// ── non-ASCII like, bracket glob, non-string cells ───────────────────
	{
		name: "like non-ASCII pattern 'äpfel%'",
		run: (users) => users.query().where('name').like('äpfel%').all(),
	},
	{
		name: "glob '[a-z]' bracket pattern (engine-literal semantics)",
		run: (users) => users.query().where('name').glob('[a-z]*').all(),
	},
	{
		name: 'like against a non-string (age) column',
		run: (users) => users.query().where('age').like('%3%').all(),
	},
	{
		name: 'glob against a non-string (age) column',
		run: (users) => users.query().where('age').glob('*3*').all(),
	},

	// ── any([]) / none([]) / mixed lists / deep json equals ─────────────
	{ name: 'any([]) matches nothing', run: (users) => users.query().where('name').any([]).all() },
	{
		name: 'none([]) matches everything',
		run: (users) => users.query().where('name').none([]).all(),
	},
	{
		name: 'any with a mixed-type list',
		run: (users) => users.query().where('age').any([36, 'nope', 0]).all(),
	},
	{
		name: 'none with a mixed-type list',
		run: (users) => users.query().where('age').none([36, 'nope', 0]).all(),
	},
	{
		name: 'equals a deep matching json operand',
		run: (users) =>
			users
				.query()
				.where('meta')
				.equals({ tags: ['math', 'logic'], info: { level: 9, ok: true } })
				.all(),
	},
	{
		name: 'equals a deep non-matching json operand (different nested shape)',
		run: (users) =>
			users
				.query()
				.where('meta')
				.equals({ tags: ['math', 'logic'], info: { level: 9, ok: false } })
				.all(),
	},
	{
		name: 'not a deep json operand',
		run: (users) =>
			users
				.query()
				.where('meta')
				.not({ tags: [], info: { level: 0, ok: false } })
				.all(),
	},

	// ── range operators over the INDEXED optional `rank` column, some rows absent ──
	{
		name: 'rank below (with absent rows)',
		run: (users) => users.query().where('rank').below(10).all(),
	},
	{ name: 'rank to (with absent rows)', run: (users) => users.query().where('rank').to(10).all() },
	{
		name: 'rank from (with absent rows)',
		run: (users) => users.query().where('rank').from(5).all(),
	},
	{
		name: 'rank above (with absent rows)',
		run: (users) => users.query().where('rank').above(5).all(),
	},
	{
		name: 'rank between (with absent rows)',
		run: (users) => users.query().where('rank').between(1, 10).all(),
	},

	// ── between reversed bounds ───────────────────────────────────────────
	{
		name: 'between reversed bounds is empty, never throws',
		run: (users) => users.query().where('age').between(36, 0).all(),
	},

	// ── mismatched operand types ──────────────────────────────────────────
	{
		name: 'equals with a string operand on an integer column',
		run: (users) => users.query().where('age').equals('36').all(),
	},
	{
		name: 'above with a string operand on an integer column',
		run: (users) => users.query().where('age').above('18').all(),
	},
	{
		name: 'equals with a number operand on a text column',
		run: (users) => users.query().where('name').equals(36).all(),
	},

	// ── non-BMP text RANGE parity (FIX 1 — code point vs. code unit) ─────
	// Threshold '' sits between u8's lead surrogate (0xD83D) and u9's
	// code unit (0xE050): a code-unit (engine) comparison puts u8 BELOW the
	// threshold while a code-point (SQLite BINARY) comparison would put it
	// ABOVE — `isExactCondition` now refines these through the engine so both
	// backends agree.
	{
		name: 'above on non-BMP text (name) — code point vs. code unit divergence',
		run: (users) => users.query().where('name').above('').all(),
	},
	{
		name: 'below on non-BMP text (name) — code point vs. code unit divergence',
		run: (users) => users.query().where('name').below('').all(),
	},
	{
		name: 'from on non-BMP text (name) — code point vs. code unit divergence',
		run: (users) => users.query().where('name').from('').all(),
	},
	{
		name: 'to on non-BMP text (name) — code point vs. code unit divergence',
		run: (users) => users.query().where('name').to('').all(),
	},
	{
		name: 'between on non-BMP text (name) — code point vs. code unit divergence',
		run: (users) => users.query().where('name').between('\u{10000}', '').all(),
	},

	// ── ordering ──────────────────────────────────────────────────────────
	{
		name: 'ascending on text (name)',
		ordered: true,
		run: (users) => users.query().ascending('name').all(),
	},
	{
		name: 'descending on text (name)',
		ordered: true,
		run: (users) => users.query().descending('name').all(),
	},
	{
		name: 'ascending on non-BMP text (name) with limit — code point vs. code unit divergence',
		ordered: true,
		run: (users) => users.query().ascending('name').limit(4).all(),
	},
	{
		name: 'descending on non-BMP text (name) with limit — code point vs. code unit divergence',
		ordered: true,
		run: (users) => users.query().descending('name').limit(4).all(),
	},
	{
		name: 'ascending on integer (age)',
		ordered: true,
		run: (users) => users.query().ascending('age').all(),
	},
	{
		name: 'descending on integer (age)',
		ordered: true,
		run: (users) => users.query().descending('age').all(),
	},
	{
		name: 'ascending on boolean (active)',
		ordered: true,
		run: (users) => users.query().ascending('active').all(),
	},
	{
		name: 'descending on boolean (active)',
		ordered: true,
		run: (users) => users.query().descending('active').all(),
	},
	{
		name: 'ascending on the json column (meta)',
		ordered: true,
		run: (users) => users.query().ascending('meta').all(),
	},
	{
		name: 'multi-term order (active then age)',
		ordered: true,
		run: (users) => users.query().ascending('active').ascending('age').all(),
	},
	{
		name: 'order + limit + offset paging',
		ordered: true,
		run: (users) => users.query().ascending('age').offset(2).limit(3).all(),
	},

	// ── stream() with conditions + offset + limit, order-insensitive ─────
	{
		name: 'stream with conditions + offset + limit',
		run: async (users) => {
			const collected: UserRow[] = []
			for await (const row of users
				.query()
				.where('active')
				.equals(true)
				.offset(1)
				.limit(2)
				.stream()) {
				collected.push(row)
			}
			return collected
		},
	},

	// ── records() with a prebuilt Criteria ────────────────────────────────
	{
		name: 'records() with a prebuilt Criteria',
		ordered: true,
		run: (users) => {
			const criteria: Criteria = {
				conditions: [{ column: 'active', operator: 'equals', values: [true], connector: 'and' }],
				order: [{ column: 'age', direction: 'ascending' }],
			}
			return users.records(criteria)
		},
	},
]

const SCALAR_CASES: readonly ScalarCase[] = [
	{ name: 'aggregate count (age, no conditions)', run: (users) => users.query().count() },
	{ name: 'aggregate sum (age, no conditions)', run: (users) => users.query().sum('age') },
	{ name: 'aggregate average (age, no conditions)', run: (users) => users.query().average('age') },
	{ name: 'aggregate minimum (age, no conditions)', run: (users) => users.query().minimum('age') },
	{ name: 'aggregate maximum (age, no conditions)', run: (users) => users.query().maximum('age') },
	{
		name: 'aggregate sum (score, filtered by active)',
		run: (users) => users.query().where('active').equals(true).sum('score'),
	},
	{
		name: 'aggregate average (score, filtered by active)',
		run: (users) => users.query().where('active').equals(true).average('score'),
	},
	{
		name: 'aggregate sum over the TEXT name column (parseNumber semantics)',
		run: (users) => users.query().sum('name'),
	},
	{
		name: 'aggregate count over zero matching rows',
		run: (users) => users.query().where('age').above(1e9).count(),
	},
	{
		name: 'aggregate sum over zero matching rows',
		run: (users) => users.query().where('age').above(1e9).sum('age'),
	},
	{
		name: 'rank count over a from-filtered range (indexed optional column)',
		run: (users) => users.query().where('rank').from(5).count(),
	},
	{
		name: 'count over a non-BMP text (name) range — code point vs. code unit divergence',
		run: (users) => users.query().where('name').above('').count(),
	},
]

describe('cross-backend parity — MemoryDriver vs SQLiteDriver', () => {
	let memory: DatabaseInterface<{ readonly users: typeof USERS }>
	let sqlite: DatabaseInterface<{ readonly users: typeof USERS }>

	beforeEach(async () => {
		memory = memoryDatabase()
		sqlite = sqliteDatabase()
		await memory.table('users').set([...ROWS])
		await sqlite.table('users').set([...ROWS])
	})

	afterEach(async () => {
		await memory.close()
		await sqlite.close()
	})

	for (const testCase of ROW_CASES) {
		it(`rows match the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.run(memory.table('users'))
			const actual = await testCase.run(sqlite.table('users'))
			const normalize = testCase.ordered === true ? (rows: readonly UserRow[]) => rows : sortById
			expect(normalize(actual)).toEqual(normalize(expected))
		})
	}

	for (const testCase of SCALAR_CASES) {
		it(`scalar matches the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.run(memory.table('users'))
			const actual = await testCase.run(sqlite.table('users'))
			expect(actual).toBe(expected)
		})
	}

	// stream() over the indexed optional `rank` column, order-insensitive.
	it('stream matches the reference engine — rank below (with absent rows)', async () => {
		async function streamIds(users: UsersTable): Promise<readonly string[]> {
			const ids: string[] = []
			for await (const row of users.query().where('rank').below(10).stream()) ids.push(row.id)
			return [...ids].sort()
		}
		expect(await streamIds(sqlite.table('users'))).toEqual(await streamIds(memory.table('users')))
	})
})
