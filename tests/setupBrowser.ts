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
// Browser-test setup — environment-specific helpers loaded after `setup.ts`
// for the `src:browser` project, which runs in a real Chromium (DOM
// available, no `node:*`).

import { DatabaseCounter } from './setup.js'

/**
 * Deletes an IndexedDB database, settling after the request reports any outcome, so a test can
 * start from a clean store.
 *
 * @param name - The database name to delete
 * @returns A promise that settles after the request reports success, error, or a block
 *
 * @remarks
 * This is deliberately NOT `removeDatabase` from `@orkestrel/test/browser`, which rejects on
 * `blocked`. That contract assumes the caller's close has fully released the connection by the
 * time its promise settles. Over this package's IndexedDB driver it does not: `Database.close()`
 * resolves before Chromium releases the connection, so a delete issued straight afterwards
 * intermittently observes `blocked`. Swapping this helper for `removeDatabase` reddened 43 of the
 * `src:browser` tests, and re-running `tests/src/browser/integration.test.ts` alone reddened 1 of
 * 72 on a case the whole-project run did not name — a race, not a fixed site. A retry loop is a
 * polling architecture and is refused, so the block is absorbed here instead. Every caller names
 * its database through {@link mintDatabase}, so an incomplete delete never reaches the next test.
 *
 * One block is reproducible rather than raced: after `migrate` throws `MIGRATION`, the driver
 * leaves a connection open. That belongs to `src/browser`, not to this module.
 */
export function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve) => {
		const request = globalThis.indexedDB.deleteDatabase(name)
		request.addEventListener('success', () => resolve())
		request.addEventListener('error', () => resolve())
		request.addEventListener('blocked', () => resolve())
	})
}

const DATABASE_COUNTER = new DatabaseCounter()

/**
 * Returns a process-unique IndexedDB database name — a monotonic counter under an
 * optional prefix, so concurrent tests never collide on a shared store.
 *
 * @param prefix - A readable name segment (defaults to `database-idb`)
 * @returns A name no earlier call has returned
 */
export function mintDatabase(prefix = 'database-idb'): string {
	return `${prefix}-${DATABASE_COUNTER.next()}`
}

/**
 * Persists an arbitrary value through a real native IndexedDB transaction.
 *
 * @remarks
 * Corruption-boundary tests need to seed values outside the wrapper's typed row
 * contract. The native API is the storage boundary under test, and awaiting the
 * transaction completion ensures the value is durable before a wrapper opens it.
 *
 * @param database - The connected native database
 * @param store - The object-store name
 * @param key - The durable record key
 * @param value - The arbitrary value to persist
 * @returns A promise that settles with the native transaction
 */
export function putIndexedDBValue(
	database: IDBDatabase,
	store: string,
	key: IDBValidKey,
	value: unknown,
): Promise<void> {
	const transaction = database.transaction(store, 'readwrite')
	transaction.objectStore(store).put(value, key)
	return new Promise((resolve, reject) => {
		transaction.addEventListener('complete', () => resolve())
		transaction.addEventListener('error', () => reject(transaction.error))
		transaction.addEventListener('abort', () => reject(transaction.error))
	})
}

/** Reads the trailing counter segment of a generated database name. */
export function readCounter(name: string): number {
	return Number(name.slice(name.lastIndexOf('-') + 1))
}

export const USERS = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	score: numberShape(),
	active: booleanShape(),
	bio: optionalShape(stringShape()),
	meta: jsonShape(),
	rank: optionalShape(integerShape()),
}

export type UserRow = RowOf<typeof USERS>

// Mixed-case + non-ASCII names, boundary ages (0, negative, 17/18, 65, a large
// value), an OPTIONAL `bio` (absent on several rows), a nested `meta` json
// value, and an OPTIONAL `rank` — indexed on this backend (`INDEXES` below),
// absent on several rows so the IndexedDB lossy-pushdown reproduction (a
// range query over an indexed column with rows missing the field entirely)
// is exercised against the shared reference.
export const ROWS: readonly UserRow[] = [
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

export const INDEXES: IndexMap = { users: [['age'], ['name'], ['rank']] }

export function memoryDatabase(): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createMemoryDriver(),
		tables: { users: USERS },
		indexes: INDEXES,
	})
}

export function indexedDBDatabase(
	name: string,
): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createIndexedDBDriver(name),
		tables: { users: USERS },
		indexes: INDEXES,
	})
}

export type UsersTable = TableInterface<UserRow>

export function sortById(rows: readonly UserRow[]): readonly UserRow[] {
	return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

// A row-returning case: `ordered` distinguishes an order-sensitive comparison
// (compare arrays exactly) from an order-insensitive one (sort by `id` first).
export interface RowCase {
	readonly name: string
	readonly ordered?: boolean
	execute(users: UsersTable): Promise<readonly UserRow[]>
}

// A scalar-returning case (count / an aggregate) — compared directly.
export interface ScalarCase {
	readonly name: string
	execute(users: UsersTable): Promise<number | undefined>
}

export const ROW_CASES: readonly RowCase[] = [
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

export const SCALAR_CASES: readonly ScalarCase[] = [
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

// A schema with a string primary key, a couple of typed (orderable) columns, and
// the non-orderable types pushdown must refuse (boolean / json).
export const PLANNER_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'score', storage: 'real', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'active', storage: 'boolean', optional: false, nullable: false },
		{ name: 'payload', storage: 'json', optional: false, nullable: true },
	],
	indexes: [['age']],
}

// The single-column secondary indexes that physically exist (named by column).
export const PLANNER_INDEXES: readonly string[] = ['age']
import type { TableSchema } from '@src/core'

export const NULLABLE_SCHEMA: TableSchema = {
	name: 'people',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: true },
	],
	indexes: [['age']],
}

export const NULLABLE_INDEXES: readonly string[] = ['age']

export const PEOPLE: ReadonlyArray<{
	readonly id: string
	readonly name: string
	readonly age: number
}> = [
	{ id: 'u1', name: 'Ada', age: 36 },
	{ id: 'u2', name: 'Bo', age: 22 },
	{ id: 'u3', name: 'Cy', age: 41 },
	{ id: 'u4', name: 'Di', age: 22 },
	{ id: 'u5', name: 'Eve', age: 55 },
]

export const ABSENT_SCHEMA: TableSchema = {
	name: 'people',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: true },
	],
	indexes: [['age']],
}

export const ABSENT_ROWS: ReadonlyArray<{ readonly id: string; readonly age?: number }> = [
	{ id: 'a', age: 10 },
	{ id: 'b' },
]

export const REVERSED_SCHEMA: TableSchema = {
	name: 'people',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
	],
	indexes: [['age']],
}

export const COLLISION_SCHEMA: TableSchema = {
	name: 'items',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'a', storage: 'text', optional: false, nullable: false },
		{ name: 'b', storage: 'text', optional: false, nullable: false },
		{ name: 'a_b', storage: 'text', optional: false, nullable: false },
	],
	indexes: [['a_b'], ['a', 'b']],
}
