import type { DatabaseInterface, IndexMap, QueryInput, RowOf, TableInterface } from '@src/core'
import { createDatabase, createMemoryDriver } from '@src/core'
import { createIndexedDBDriver } from '@src/browser'
import {
	booleanShape,
	integerShape,
	jsonShape,
	numberShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectRankStreamIds } from '../../setup.js'
import { deleteDatabase, uniqueName } from '../../setupBrowser.js'

// Cross-backend PARITY suite — the enduring regression net proving the
// IndexedDB driver (narrow-then-refine over `src/browser`, real Chromium) returns
// byte-identical query results to the reference `MemoryDriver` (the pure core
// engine over a scan), across every clause operator, ordering, paging, and
// aggregate the public `Table` / `Query` surface exposes. Data-driven: one
// shared fixture + two CASES tables (row-returning and scalar-returning), each
// run against both backends and compared.

const USERS = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	score: numberShape(),
	active: booleanShape(),
	bio: optionalShape(stringShape()),
	meta: jsonShape(),
	rank: optionalShape(integerShape()),
}

type UserRow = RowOf<typeof USERS>

// Mixed-case + non-ASCII names, boundary ages (0, negative, 17/18, 65, a large
// value), an OPTIONAL `bio` (absent on several rows), a nested `meta` json
// value, and an OPTIONAL `rank` — indexed on this backend (`INDEXES` below),
// absent on several rows so the IndexedDB lossy-pushdown reproduction (a
// range query over an indexed column with rows missing the field entirely)
// is exercised against the shared reference.
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
	// by Unicode CODE POINT, u8 (U+1F600) sorts ABOVE u9 (U+E050); ordered by
	// UTF-16 CODE UNIT (the core engine's `compareValues`, using JS `<`,
	// AND IndexedDB's native string-key comparison, which is spec'd as
	// code-unit order), u8's lead surrogate (0xD83D = 55357) is NUMERICALLY
	// LESS than u9's single code unit (0xE050 = 57424), so u8 sorts BELOW
	// u9 — IndexedDB's native string-key order is expected to match the
	// engine's here (both are code-unit order), unlike SQLite's BINARY
	// collation (code-point order, see FIX 1 in `src/server/helpers.ts`).
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

const INDEXES: IndexMap = { users: [['age'], ['name'], ['rank']] }

function memoryDatabase(): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createMemoryDriver(),
		tables: { users: USERS },
		indexes: INDEXES,
	})
}

function indexedDBDatabase(name: string): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createIndexedDBDriver(name),
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
	execute(users: UsersTable): Promise<readonly UserRow[]>
}

// A scalar-returning case (count / an aggregate) — compared directly.
interface ScalarCase {
	readonly name: string
	execute(users: UsersTable): Promise<number | undefined>
}

const ROW_CASES: readonly RowCase[] = [
	// ── All 15 clause operators (each its own case) ──────────────────────
	{
		name: 'equals',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'equals', values: [36], connector: 'and' })
				.collect(),
	},
	{
		name: 'not',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'active', operator: 'not', values: [true], connector: 'and' })
				.collect(),
	},
	{
		name: 'above',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'below',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'below', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'from',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'to',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'to', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'between',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'between', values: [0, 36], connector: 'and' })
				.collect(),
	},
	{
		name: 'like',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'like', values: ['%a%'], connector: 'and' })
				.collect(),
	},
	{
		name: 'glob',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'glob', values: ['[A-Z]*'], connector: 'and' })
				.collect(),
	},
	{
		name: 'starts',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: ['A'], connector: 'and' })
				.collect(),
	},
	{
		name: 'ends',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['e'], connector: 'and' })
				.collect(),
	},
	{
		name: 'any',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'name',
					operator: 'any',
					values: ['Ada', 'Grace', 'nope'],
					connector: 'and',
				})
				.collect(),
	},
	{
		name: 'none',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'none', values: ['Ada', 'Grace'], connector: 'and' })
				.collect(),
	},
	{
		name: 'absent (rank)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'absent', values: [], connector: 'and' })
				.collect(),
	},
	{
		name: 'present (rank)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'present', values: [], connector: 'and' })
				.collect(),
	},

	// ── starts/ends case-sensitivity ─────────────────────────────────────
	{
		name: "starts('ada') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: ['ada'], connector: 'and' })
				.collect(),
	},
	{
		name: "starts('Ada') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: ['Ada'], connector: 'and' })
				.collect(),
	},
	{
		name: "ends('a') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['a'], connector: 'and' })
				.collect(),
	},
	{
		name: "ends('A') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['A'], connector: 'and' })
				.collect(),
	},
	{
		name: "starts('') matches every row",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: "ends('') matches every row",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: [''], connector: 'and' })
				.collect(),
	},

	// ── non-ASCII like, bracket glob, non-string cells ───────────────────
	{
		name: "like non-ASCII pattern 'äpfel%'",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'like', values: ['äpfel%'], connector: 'and' })
				.collect(),
	},
	{
		name: "glob '[a-z]' bracket pattern (engine-literal semantics)",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'glob', values: ['[a-z]*'], connector: 'and' })
				.collect(),
	},
	{
		name: 'like against a non-string (age) column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'like', values: ['%3%'], connector: 'and' })
				.collect(),
	},
	{
		name: 'glob against a non-string (age) column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'glob', values: ['*3*'], connector: 'and' })
				.collect(),
	},

	// ── any([]) / none([]) / mixed lists / deep json equals ─────────────
	{
		name: 'any([]) matches nothing',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'any', values: [], connector: 'and' })
				.collect(),
	},
	{
		name: 'none([]) matches everything',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'none', values: [], connector: 'and' })
				.collect(),
	},
	{
		name: 'any with a mixed-type list',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'any', values: [36, 'nope', 0], connector: 'and' })
				.collect(),
	},
	{
		name: 'none with a mixed-type list',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'none', values: [36, 'nope', 0], connector: 'and' })
				.collect(),
	},
	{
		name: 'equals a deep matching json operand',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'meta',
					operator: 'equals',
					values: [{ tags: ['math', 'logic'], info: { level: 9, ok: true } }],
					connector: 'and',
				})
				.collect(),
	},
	{
		name: 'equals a deep non-matching json operand (different nested shape)',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'meta',
					operator: 'equals',
					values: [{ tags: ['math', 'logic'], info: { level: 9, ok: false } }],
					connector: 'and',
				})
				.collect(),
	},
	{
		name: 'not a deep json operand',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'meta',
					operator: 'not',
					values: [{ tags: [], info: { level: 0, ok: false } }],
					connector: 'and',
				})
				.collect(),
	},

	// ── range operators over the INDEXED optional `rank` column, some rows absent
	// (the IndexedDB lossy-pushdown reproduction) ────────────────────────
	{
		name: 'rank below (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'below', values: [10], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank to (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'to', values: [10], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank from (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'from', values: [5], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank above (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'above', values: [5], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank between (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'between', values: [1, 10], connector: 'and' })
				.collect(),
	},

	// ── between reversed bounds ───────────────────────────────────────────
	{
		name: 'between reversed bounds is empty, never throws',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'between', values: [36, 0], connector: 'and' })
				.collect(),
	},

	// ── mismatched operand types ──────────────────────────────────────────
	{
		name: 'equals with a string operand on an integer column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'equals', values: ['36'], connector: 'and' })
				.collect(),
	},
	{
		name: 'above with a string operand on an integer column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: ['18'], connector: 'and' })
				.collect(),
	},
	{
		name: 'equals with a number operand on a text column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'equals', values: [36], connector: 'and' })
				.collect(),
	},

	// ── non-BMP text RANGE parity (FIX 8 — code point vs. code unit) ─────
	// IndexedDB string-key comparison is spec'd as UTF-16 code-unit order —
	// the SAME order the core engine's `compareValues` uses — so these are
	// expected to match natively (unlike SQLite's BINARY/code-point
	// collation; see the server parity suite's equivalent cases).
	{
		name: 'above on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'above', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'below on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'below', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'from on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'from', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'to on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'to', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'between on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'name',
					operator: 'between',
					values: ['\u{10000}', ''],
					connector: 'and',
				})
				.collect(),
	},

	// ── ordering ──────────────────────────────────────────────────────────
	{
		name: 'ascending on text (name)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'name', direction: 'ascending' }).collect(),
	},
	{
		name: 'descending on text (name)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'name', direction: 'descending' }).collect(),
	},
	{
		name: 'ascending on non-BMP text (name) with limit — code point vs. code unit divergence',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'name', direction: 'ascending' }).limit(4).collect(),
	},
	{
		name: 'descending on non-BMP text (name) with limit — code point vs. code unit divergence',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'name', direction: 'descending' }).limit(4).collect(),
	},
	{
		name: 'ascending on integer (age)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'age', direction: 'ascending' }).collect(),
	},
	{
		name: 'descending on integer (age)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'age', direction: 'descending' }).collect(),
	},
	{
		name: 'ascending on boolean (active)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'active', direction: 'ascending' }).collect(),
	},
	{
		name: 'descending on boolean (active)',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'active', direction: 'descending' }).collect(),
	},
	{
		name: 'ascending on the json column (meta)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'meta', direction: 'ascending' }).collect(),
	},
	{
		name: 'multi-term order (active then age)',
		ordered: true,
		execute: (users) =>
			users
				.query()
				.order({ column: 'active', direction: 'ascending' })
				.order({ column: 'age', direction: 'ascending' })
				.collect(),
	},
	{
		name: 'order + limit + offset paging',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'age', direction: 'ascending' }).offset(2).limit(3).collect(),
	},

	// ── stream() with conditions + offset + limit, order-insensitive ─────
	{
		name: 'stream with conditions + offset + limit',
		execute: async (users) => {
			const collected: UserRow[] = []
			for await (const row of users
				.query()
				.condition({ column: 'active', operator: 'equals', values: [true], connector: 'and' })
				.offset(1)
				.limit(2)
				.stream()) {
				collected.push(row)
			}
			return collected
		},
	},

	// ── records() with a prebuilt QueryInput ────────────────────────────────
	{
		name: 'records() with a prebuilt QueryInput',
		ordered: true,
		execute: (users) => {
			const input: QueryInput = {
				conditions: [{ column: 'active', operator: 'equals', values: [true], connector: 'and' }],
				order: [{ column: 'age', direction: 'ascending' }],
			}
			return users.records(input)
		},
	},
]

const SCALAR_CASES: readonly ScalarCase[] = [
	{ name: 'aggregate count (age, no conditions)', execute: (users) => users.query().count() },
	{
		name: 'aggregate sum (age, no conditions)',
		execute: (users) => users.query().aggregate('sum', 'age'),
	},
	{
		name: 'aggregate average (age, no conditions)',
		execute: (users) => users.query().aggregate('average', 'age'),
	},
	{
		name: 'aggregate minimum (age, no conditions)',
		execute: (users) => users.query().aggregate('minimum', 'age'),
	},
	{
		name: 'aggregate maximum (age, no conditions)',
		execute: (users) => users.query().aggregate('maximum', 'age'),
	},
	{
		name: 'aggregate sum (score, filtered by active)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'active', operator: 'equals', values: [true], connector: 'and' })
				.aggregate('sum', 'score'),
	},
	{
		name: 'aggregate average (score, filtered by active)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'active', operator: 'equals', values: [true], connector: 'and' })
				.aggregate('average', 'score'),
	},
	{
		name: 'aggregate sum over the TEXT name column (parseNumber semantics)',
		execute: (users) => users.query().aggregate('sum', 'name'),
	},
	{
		name: 'aggregate count over zero matching rows',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: [1e9], connector: 'and' })
				.count(),
	},
	{
		name: 'aggregate sum over zero matching rows',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: [1e9], connector: 'and' })
				.aggregate('sum', 'age'),
	},
	{
		name: 'rank count over a from-filtered range (indexed optional column)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'from', values: [5], connector: 'and' })
				.count(),
	},
	{
		name: 'count over a non-BMP text (name) range — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'above', values: [''], connector: 'and' })
				.count(),
	},
]

describe('cross-backend parity — MemoryDriver vs IndexedDBDriver', () => {
	let name = ''
	let memory: DatabaseInterface<{ readonly users: typeof USERS }>
	let indexedDB: DatabaseInterface<{ readonly users: typeof USERS }>

	beforeEach(async () => {
		name = uniqueName('database-idb-parity')
		await deleteDatabase(name)
		memory = memoryDatabase()
		indexedDB = indexedDBDatabase(name)
		await memory.table('users').set([...ROWS])
		await indexedDB.table('users').set([...ROWS])
	})

	afterEach(async () => {
		await memory.close()
		await indexedDB.close()
		await deleteDatabase(name)
	})

	for (const testCase of ROW_CASES) {
		it(`rows match the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.execute(memory.table('users'))
			const actual = await testCase.execute(indexedDB.table('users'))
			expect(testCase.ordered === true ? actual : sortById(actual)).toEqual(
				testCase.ordered === true ? expected : sortById(expected),
			)
		})
	}

	for (const testCase of SCALAR_CASES) {
		it(`scalar matches the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.execute(memory.table('users'))
			const actual = await testCase.execute(indexedDB.table('users'))
			expect(actual).toBe(expected)
		})
	}

	// stream() over the indexed optional `rank` column, order-insensitive.
	it('stream matches the reference engine — rank below (with absent rows)', async () => {
		expect(await collectRankStreamIds(indexedDB.table('users'))).toEqual(
			await collectRankStreamIds(memory.table('users')),
		)
	})
})
