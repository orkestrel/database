import type {
	DatabaseInterface,
	DriverInterface,
	IndexMap,
	QueryInput,
	ReadInput,
	Row,
	RowOf,
	TableInterface,
	TableSchema,
} from '@src/core'
import { compareValues, createDatabase, createMemoryDriver } from '@src/core'
import { createIndexedDBDriver, deriveIndexedDBIndexName, readIndexNames } from '@src/browser'
import type { IndexedDBCursorInterface, IndexedDBDatabaseInterface } from '@orkestrel/indexeddb'
import { createIndexedDBDatabase, promisifyRequest } from '@orkestrel/indexeddb'
import {
	booleanShape,
	integerShape,
	jsonShape,
	nullableShape,
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

/**
 * Reads an arbitrary stored value through a real native IndexedDB transaction, which reads a
 * value the wrapper refuses as no record.
 *
 * @param database - The connected native database
 * @param store - The object-store name
 * @param key - The record key
 * @returns The stored value, or `undefined` for a miss
 */
export function readIndexedDBValue(
	database: IDBDatabase,
	store: string,
	key: IDBValidKey,
): Promise<unknown> {
	return promisifyRequest(database.transaction(store, 'readonly').objectStore(store).get(key))
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

/**
 * Holds the rows the IndexedDB driver reads for each read of `CONFORMANCE_READS` over
 * `CONFORMANCE_ROWS` with an index on the optional `age` column. A read whose every
 * condition its path answers reads its matches: `age equals 36` reads 3, `age above 17` 5,
 * `age from 17` and `age between 0 and 36` 6, `age any [36, 0]` 4, an empty `any` 0, and
 * `id any` over three keys 3. `id any` over four keys beside `age equals 36` takes the
 * primary-key path and streams its 4 rows. A native page reads its page: `age above 0` ordered
 * by `age` with `limit: 2, offset: 1` reads 2, and `limit: 4, offset: 2` reads 4. A native
 * count reads no row. Every other read, which an optional column's `below`, `to`, order, or
 * aggregate, an unindexed column, an operator with no key range, or an `or` leaves residual,
 * streams the 9 rows of the store.
 */
export const CONFORMANCE_ROWS_READ: readonly number[] = Object.freeze([
	9, 3, 9, 9, 9, 9, 5, 9, 6, 9, 6, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 4, 0, 3, 9, 9, 9, 9, 9, 9,
	4, 9, 9, 9, 9, 9, 9, 9, 9, 2, 4, 0, 9, 9, 9, 9, 9,
])

/**
 * Stores a tripwire at a key: an array carrying `fields` as own properties. An index lists it
 * under those fields, and the `@orkestrel/indexeddb` wrapper refuses to read it as a record
 * (`RECORD`), so a read that reaches it raises and a read that stops ahead of it stays quiet.
 *
 * @param name - The database name
 * @param store - The object-store name
 * @param key - The out-of-line key to store the tripwire under
 * @param fields - The indexed fields the tripwire carries
 * @returns A promise that settles after the native transaction completes
 */
export async function putTripwire(
	name: string,
	store: string,
	key: IDBValidKey,
	fields: Readonly<Record<string, unknown>>,
): Promise<void> {
	const database = createIndexedDBDatabase({ name, stores: {} })
	try {
		await putIndexedDBValue(await database.connect(), store, key, Object.assign([], fields))
	} finally {
		database.close()
	}
}

/** Declares the `items` table the plan suites read: a required, an optional, and a nullable index. */
export const ITEMS = {
	id: stringShape(),
	organization: stringShape(),
	rank: integerShape(),
	tag: optionalShape(stringShape()),
	score: nullableShape(numberShape()),
}

/** Shapes one row of {@link ITEMS}. */
export type ItemRow = RowOf<typeof ITEMS>

/** Declares the `items` indexes: three single-column indexes and one compound index. */
export const ITEM_INDEXES: IndexMap = {
	items: [['organization'], ['rank'], ['tag'], ['score'], ['organization', 'rank']],
}

/** Names the compound `organization`, `rank` index as the driver derives it. */
export const ITEM_COMPOUND = deriveIndexedDBIndexName(['organization', 'rank'])

/**
 * Builds the `items` row at a position: key `k` and the position padded to four digits,
 * organization `o0` to `o3` in turn, rank the position, a tag on two rows of three, and a
 * score on every row but each fifth.
 *
 * @param position - The row's position
 * @returns The row
 */
export function buildItem(position: number): ItemRow {
	return {
		id: `k${String(position).padStart(4, '0')}`,
		organization: `o${position % 4}`,
		rank: position,
		...(position % 3 === 0 ? {} : { tag: `t${position % 5}` }),
		score: position % 5 === 0 ? null : position / 2,
	}
}

/**
 * Builds the first `count` `items` rows.
 *
 * @param count - The number of rows
 * @returns The rows, in key order
 */
export function buildItems(count: number): readonly ItemRow[] {
	return Array.from({ length: count }, (_, position) => buildItem(position))
}

/**
 * Opens a database over `items` with {@link ITEM_INDEXES} on a driver, seeded with rows.
 *
 * @param driver - The driver to open
 * @param rows - The rows to seed
 * @returns The database and its `items` table
 */
export async function seedItems(
	driver: DriverInterface,
	rows: readonly ItemRow[],
): Promise<{
	readonly database: DatabaseInterface<{ readonly items: typeof ITEMS }>
	readonly items: TableInterface<ItemRow>
}> {
	const database = createDatabase({
		driver,
		tables: { items: ITEMS },
		indexes: ITEM_INDEXES,
	})
	const items = database.table('items')
	await items.set(rows)
	return { database, items }
}

/**
 * Declares a planner schema shaped like `items`, with a `boolean` column and an index on it that
 * the planner never reads, beside the indexes {@link ITEM_INDEXES} declares.
 */
export const ITEM_SCHEMA: TableSchema = {
	name: 'items',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'organization', storage: 'text', optional: false, nullable: false },
		{ name: 'rank', storage: 'integer', optional: false, nullable: false },
		{ name: 'tag', storage: 'text', optional: true, nullable: false },
		{ name: 'score', storage: 'real', optional: false, nullable: true },
		{ name: 'active', storage: 'boolean', optional: false, nullable: false },
	],
	indexes: [['organization'], ['rank'], ['tag'], ['score'], ['active'], ['organization', 'rank']],
}

/** Names the indexes {@link ITEM_SCHEMA} declares, as the store lists them. */
export const ITEM_INDEX_NAMES: readonly string[] = Object.freeze(
	ITEM_SCHEMA.indexes.map((columns) => deriveIndexedDBIndexName(columns)),
)

/** Shapes one rows-read case: a read, the tripwire beyond its bound, and its bound. */
export interface TripwireCase {
	readonly name: string
	readonly input: QueryInput
	readonly key: string
	readonly fields: Readonly<Record<string, unknown>>
	readonly bound: number
}

/**
 * Holds one read per plan class over {@link buildItems}`(40)`, each with a tripwire at a key
 * inside its range and beyond its page, and the rows its driver reads at most.
 */
export const TRIPWIRE_CASES: readonly TripwireCase[] = Object.freeze([
	{
		name: 'a primary-key any page',
		input: {
			conditions: [
				{
					column: 'id',
					operator: 'any',
					values: ['k0013', 'k0001', 'k0009', 'k0005'],
					connector: 'and',
				},
			],
			limit: 2,
		},
		key: 'k0009',
		fields: { organization: 'o1', rank: 9 },
		bound: 2,
	},
	{
		name: 'an index any page',
		input: {
			conditions: [
				{ column: 'organization', operator: 'any', values: ['o3', 'o1'], connector: 'and' },
			],
			limit: 3,
		},
		key: 'k0006a',
		fields: { organization: 'o1', rank: 6 },
		bound: 3,
	},
	{
		name: 'an index equals page',
		input: {
			conditions: [
				{ column: 'organization', operator: 'equals', values: ['o2'], connector: 'and' },
			],
			limit: 3,
		},
		key: 'k0010a',
		fields: { organization: 'o2', rank: 10 },
		bound: 3,
	},
	{
		name: 'an index equals page in descending key order',
		input: {
			conditions: [
				{ column: 'organization', operator: 'equals', values: ['o2'], connector: 'and' },
			],
			order: [{ column: 'id', direction: 'descending' }],
			limit: 2,
		},
		key: 'k0030a',
		fields: { organization: 'o2', rank: 30 },
		bound: 2,
	},
	{
		name: 'an ordered index page with an offset',
		input: { order: [{ column: 'rank', direction: 'ascending' }], limit: 3, offset: 2 },
		key: 'k0004a',
		fields: { organization: 'o0', rank: 4 },
		bound: 3,
	},
	{
		name: 'a primary-key range page',
		input: {
			conditions: [{ column: 'id', operator: 'from', values: ['k0010'], connector: 'and' }],
			limit: 3,
		},
		key: 'k0012a',
		fields: { organization: 'o0', rank: 12 },
		bound: 3,
	},
	{
		name: 'a starts page',
		input: {
			conditions: [{ column: 'id', operator: 'starts', values: ['k001'], connector: 'and' }],
			limit: 2,
		},
		key: 'k0011a',
		fields: { organization: 'o3', rank: 11 },
		bound: 2,
	},
	{
		name: 'a compound equals and range page',
		input: {
			conditions: [
				{ column: 'organization', operator: 'equals', values: ['o1'], connector: 'and' },
				{ column: 'rank', operator: 'from', values: [10], connector: 'and' },
			],
			limit: 2,
		},
		key: 'k0017a',
		fields: { organization: 'o1', rank: 18 },
		bound: 2,
	},
	{
		name: 'a compound page in index order',
		input: {
			conditions: [
				{ column: 'organization', operator: 'equals', values: ['o1'], connector: 'and' },
				{ column: 'rank', operator: 'from', values: [10], connector: 'and' },
			],
			order: [{ column: 'rank', direction: 'descending' }],
			limit: 2,
		},
		key: 'k9001',
		fields: { organization: 'o1', rank: 30 },
		bound: 2,
	},
])

/**
 * Holds one read per plan class over {@link buildItems}, for the differential against the core
 * engine over the driver's scan: each ranked path, orders in both directions, pages, `starts`,
 * the compound index, the required-column refusals, and residual conditions.
 */
export const ITEM_READS: readonly ReadInput[] = Object.freeze([
	{ conditions: [{ column: 'id', operator: 'equals', values: ['k0007'], connector: 'and' }] },
	{
		conditions: [
			{
				column: 'id',
				operator: 'any',
				values: ['k0009', 'k0001', 'zzz', 'k0001'],
				connector: 'and',
			},
		],
		order: [{ column: 'id', direction: 'descending' }],
	},
	{
		conditions: [
			{ column: 'organization', operator: 'any', values: ['o3', 'o1'], connector: 'and' },
			{ column: 'rank', operator: 'below', values: [20], connector: 'and' },
		],
		limit: 4,
		offset: 1,
	},
	{ conditions: [{ column: 'organization', operator: 'any', values: [], connector: 'and' }] },
	{
		conditions: [{ column: 'tag', operator: 'equals', values: ['t2'], connector: 'and' }],
		order: [{ column: 'id', direction: 'descending' }],
		limit: 3,
		offset: 1,
	},
	{ conditions: [{ column: 'tag', operator: 'below', values: ['t3'], connector: 'and' }] },
	{ conditions: [{ column: 'score', operator: 'to', values: [4], connector: 'and' }] },
	{ conditions: [{ column: 'score', operator: 'above', values: [10], connector: 'and' }] },
	{
		conditions: [{ column: 'rank', operator: 'between', values: [5, 25], connector: 'and' }],
		order: [{ column: 'rank', direction: 'descending' }],
		limit: 5,
		offset: 2,
	},
	{
		conditions: [{ column: 'rank', operator: 'above', values: [30], connector: 'and' }],
		limit: 3,
	},
	{ conditions: [{ column: 'id', operator: 'starts', values: ['k002'], connector: 'and' }] },
	{
		conditions: [
			{ column: 'organization', operator: 'equals', values: ['o2'], connector: 'and' },
			{ column: 'rank', operator: 'equals', values: [14], connector: 'and' },
		],
	},
	{
		conditions: [
			{ column: 'organization', operator: 'equals', values: ['o2'], connector: 'and' },
			{ column: 'rank', operator: 'to', values: [22], connector: 'and' },
			{ column: 'tag', operator: 'present', values: [], connector: 'and' },
		],
		order: [{ column: 'rank', direction: 'descending' }],
	},
	{ order: [{ column: 'rank', direction: 'descending' }], limit: 4, offset: 3 },
	{ order: [{ column: 'tag', direction: 'ascending' }], limit: 4 },
	{ order: [{ column: 'id', direction: 'descending' }], limit: 5 },
	{
		conditions: [
			{ column: 'tag', operator: 'equals', values: ['t1'], connector: 'and' },
			{ column: 'rank', operator: 'from', values: [3], connector: 'or' },
		],
		order: [{ column: 'rank', direction: 'ascending' }],
		limit: 6,
	},
	{
		conditions: [{ column: 'organization', operator: 'equals', values: ['o0'], connector: 'and' }],
		aggregate: { operation: 'count', column: 'id' },
	},
	{
		conditions: [
			{ column: 'organization', operator: 'any', values: ['o0', 'o2'], connector: 'and' },
		],
		aggregate: { operation: 'count', column: 'id' },
	},
	{
		conditions: [
			{ column: 'id', operator: 'any', values: ['k0001', 'k0002', 'nope'], connector: 'and' },
		],
		aggregate: { operation: 'count', column: 'id' },
	},
	{ aggregate: { operation: 'maximum', column: 'rank' } },
	{
		conditions: [{ column: 'rank', operator: 'below', values: [17], connector: 'and' }],
		aggregate: { operation: 'maximum', column: 'rank' },
	},
	{ aggregate: { operation: 'minimum', column: 'score' } },
	{
		conditions: [{ column: 'tag', operator: 'equals', values: ['t4'], connector: 'and' }],
		aggregate: { operation: 'sum', column: 'rank' },
	},
	{
		conditions: [
			{ column: 'organization', operator: 'any', values: ['o3', 'o1'], connector: 'and' },
		],
		aggregate: { operation: 'maximum', column: 'rank' },
	},
	{
		conditions: [{ column: 'rank', operator: 'any', values: [9, 4, 30], connector: 'and' }],
		aggregate: { operation: 'minimum', column: 'rank' },
	},
	{
		conditions: [{ column: 'rank', operator: 'above', values: [1000], connector: 'and' }],
		aggregate: { operation: 'minimum', column: 'rank' },
	},
	{ order: [{ column: 'rank', direction: 'ascending' }], offset: 100, limit: 3 },
	{ offset: 100 },
	{
		conditions: [
			{ column: 'organization', operator: 'any', values: ['o2', 'o1'], connector: 'and' },
		],
		offset: 100,
	},
])

/**
 * Holds the paged reads over `any` lists, on an index and on the primary key, that the paging
 * cases run over {@link buildItems}`(40)`, by records and by stream.
 */
export const LISTED_PAGES: readonly QueryInput[] = Object.freeze([
	{
		conditions: [
			{ column: 'organization', operator: 'any', values: ['o3', 'o1'], connector: 'and' },
		],
		offset: 6,
		limit: 2,
	},
	{
		conditions: [
			{ column: 'organization', operator: 'any', values: ['o3', 'o1'], connector: 'and' },
		],
		limit: 4,
		offset: 3,
	},
	{
		conditions: [
			{ column: 'organization', operator: 'any', values: ['o3', 'o1'], connector: 'and' },
		],
		order: [{ column: 'id', direction: 'descending' }],
		limit: 4,
	},
	{
		conditions: [
			{
				column: 'id',
				operator: 'any',
				values: ['k0030', 'k0002', 'nope', 'k0011', 'k0007', 'k0019'],
				connector: 'and',
			},
		],
		limit: 2,
		offset: 2,
	},
	{
		conditions: [
			{
				column: 'id',
				operator: 'any',
				values: ['k0030', 'k0002', 'k0011', 'k0007'],
				connector: 'and',
			},
		],
		order: [{ column: 'id', direction: 'descending' }],
		limit: 3,
	},
	{
		conditions: [{ column: 'rank', operator: 'from', values: [10], connector: 'and' }],
		offset: 50,
	},
])

/**
 * Holds a connection to a database open, and when another connection asks for a version
 * change, closes it and bumps the database to `version` itself: a concurrent bump that the
 * other connection's next open request queues behind.
 *
 * @param name - The database name
 * @param version - The version the bump opens at
 * @returns The armed hold, whose `settled` promise settles after the bump's connection opened and closed
 */
export async function armVersionBump(
	name: string,
	version: number,
): Promise<{ readonly settled: Promise<void> }> {
	const held = createIndexedDBDatabase({ name, stores: {} })
	const native = await held.connect()
	const bumped = Promise.withResolvers<void>()
	native.addEventListener(
		'versionchange',
		() => {
			held.close()
			const bump = createIndexedDBDatabase({ name, version, stores: {} })
			bump.connect().then(
				() => {
					bump.close()
					bumped.resolve()
				},
				(error: unknown) => {
					bump.close()
					bumped.reject(error)
				},
			)
		},
		{ once: true },
	)
	return { settled: bumped.promise }
}

/** Declares the bench's client-shaped `records` table: a unique key, a low-cardinality organization, and a rank. */
export const BENCH_TABLES = {
	records: {
		id: stringShape(),
		organization: stringShape(),
		rank: integerShape(),
		body: stringShape(),
	},
}

/** Declares the bench table's single-column indexes. */
export const BENCH_INDEXES: IndexMap = { records: [['organization'], ['rank']] }

/** Holds the bench table's row count: the size of the client's slice. */
export const BENCH_ROWS = 80646

/**
 * Builds the bench row at a position: a mixed body of 24 characters, 300 on each seventh row,
 * and 2000 on each fiftieth, and one of 40 organizations in turn.
 *
 * @param position - The row's position
 * @returns The row
 */
export function buildBenchRow(position: number): RowOf<typeof BENCH_TABLES.records> {
	const length = position % 50 === 0 ? 2000 : position % 7 === 0 ? 300 : 24
	return {
		id: `k${String(position).padStart(7, '0')}`,
		organization: `o${position % 40}`,
		rank: position,
		body: 'x'.repeat(length),
	}
}

/**
 * Seeds the bench table into a database through the wrapper, in the layout the driver reads:
 * an out-of-line store keyed by `id`, with the bench indexes.
 *
 * @param name - The database name
 * @param count - The number of rows
 * @returns A promise that settles after every row is stored
 */
export async function seedBenchRecords(name: string, count: number): Promise<void> {
	const database = createIndexedDBDatabase({
		name,
		stores: {
			records: {
				indexes: [
					{ name: 'organization', path: 'organization' },
					{ name: 'rank', path: 'rank' },
				],
			},
		},
	})
	try {
		const chunks = Array.from({ length: Math.ceil(count / 4000) }, (_, chunk) =>
			Array.from({ length: Math.min(4000, count - chunk * 4000) }, (_row, offset) =>
				buildBenchRow(chunk * 4000 + offset),
			),
		)
		for (const rows of chunks) {
			await database.write('records', async (transaction) => {
				const store = transaction.store('records')
				await Promise.all(rows.map((row) => store.set(row, row.id)))
			})
		}
	} finally {
		database.close()
	}
}

/** Holds the 100 keys the bench's key-list cell reads, spread across the bench table. */
export const BENCH_KEYS: readonly string[] = Object.freeze(
	Array.from({ length: 100 }, (_, position) => buildBenchRow((position * 7919) % BENCH_ROWS).id),
)

/** Holds the organizations the bench's `any` cells read. */
export const BENCH_ORGANIZATIONS: readonly string[] = Object.freeze(['o3', 'o5'])

/** Holds the run options of every bench cell: a time window long enough to read a cell many times. */
export const BENCH_RUN = Object.freeze({ time: 400, warmupTime: 100 })

/** Shapes one row of the bench table. */
export type BenchRow = RowOf<typeof BENCH_TABLES.records>

/** Hands each bench write its own 100 fresh rows, past the seeded table. */
export class BenchBatches {
	#next: number

	constructor(start: number) {
		this.#next = start
	}

	next(): readonly BenchRow[] {
		const start = this.#next
		this.#next += 100
		return Array.from({ length: 100 }, (_, offset) => buildBenchRow(start + offset))
	}
}

/**
 * Appends the value at a wrapper cursor and each later value to `rows`, up to `size` rows.
 *
 * @param cursor - The cursor at the first value to read, or `null` at the end
 * @param rows - The rows read so far
 * @param size - The number of rows to read
 * @returns The rows
 */
export async function collectCursor(
	cursor: IndexedDBCursorInterface | null,
	rows: readonly Row[],
	size: number,
): Promise<readonly Row[]> {
	if (cursor === null || rows.length >= size) return rows
	const read = [...rows, cursor.value]
	return read.length >= size ? read : collectCursor(await cursor.continue(), read, size)
}

/** Shapes one bench cell: the read or write through the table, and the same work on the wrapper alone. */
export interface BenchCell {
	readonly name: string
	readonly table: (records: TableInterface<BenchRow>, batches: BenchBatches) => Promise<unknown>
	readonly wrapper: (
		database: IndexedDBDatabaseInterface,
		batches: BenchBatches,
	) => Promise<unknown>
}

/**
 * Holds the bench cells: a key list, an `any` on an index, an ordered page, an `equals` page,
 * an `any` count, an `equals` count, and a batch write.
 */
export const BENCH_CELLS: readonly BenchCell[] = Object.freeze([
	{
		name: 'reads a key list',
		table: (records) => records.get(BENCH_KEYS),
		wrapper: (database) => database.store('records').get(BENCH_KEYS),
	},
	{
		name: 'reads every row of an any on an index',
		table: (records) =>
			records.records({
				conditions: [
					{
						column: 'organization',
						operator: 'any',
						values: BENCH_ORGANIZATIONS,
						connector: 'and',
					},
				],
			}),
		wrapper: async (database) => {
			const index = database.store('records').index('organization')
			const lists = await Promise.all(
				BENCH_ORGANIZATIONS.map((value) => index.records(IDBKeyRange.only(value))),
			)
			return lists.flat().toSorted((left, right) => compareValues(left.id, right.id))
		},
	},
	{
		name: 'reads a page in descending key order',
		table: (records) =>
			records.records({ order: [{ column: 'id', direction: 'descending' }], limit: 10 }),
		wrapper: async (database) =>
			collectCursor(await database.store('records').cursor({ direction: 'prev' }), [], 10),
	},
	{
		name: 'reads an equals page',
		table: (records) =>
			records.records({
				conditions: [
					{ column: 'organization', operator: 'equals', values: ['o3'], connector: 'and' },
				],
				limit: 10,
			}),
		wrapper: (database) =>
			database.store('records').index('organization').records(IDBKeyRange.only('o3'), 10),
	},
	{
		name: 'counts an any on an index',
		table: (records) =>
			records.count({
				conditions: [
					{
						column: 'organization',
						operator: 'any',
						values: BENCH_ORGANIZATIONS,
						connector: 'and',
					},
				],
			}),
		wrapper: async (database) => {
			const index = database.store('records').index('organization')
			const counts = await Promise.all(
				BENCH_ORGANIZATIONS.map((value) => index.count(IDBKeyRange.only(value))),
			)
			return counts.reduce((total, count) => total + count, 0)
		},
	},
	{
		name: 'counts an equals',
		table: (records) =>
			records.count({
				conditions: [
					{ column: 'organization', operator: 'equals', values: ['o3'], connector: 'and' },
				],
			}),
		wrapper: (database) =>
			database.store('records').index('organization').count(IDBKeyRange.only('o3')),
	},
	{
		name: 'writes a batch of 100 rows',
		table: async (records, batches) => {
			await records.set(batches.next())
		},
		wrapper: (database, batches) =>
			database.write('records', async (transaction) => {
				const store = transaction.store('records')
				await Promise.all(batches.next().map((row) => store.set(row, row.id)))
			}),
	},
])

/** Declares the `users` schema of the guide's IndexedDB planning fence. */
export const GUIDE_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'city', storage: 'text', optional: true, nullable: false },
	],
	indexes: [['age'], ['city']],
}

/**
 * Declares a planner schema whose one index is a three-column compound index over required
 * columns, for the guard that an order serves an index only on every unbound column.
 */
export const TRIPLE_SCHEMA: TableSchema = {
	name: 'items',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'organization', storage: 'text', optional: false, nullable: false },
		{ name: 'rank', storage: 'integer', optional: false, nullable: false },
		{ name: 'tag', storage: 'text', optional: false, nullable: false },
	],
	indexes: [['organization', 'rank', 'tag']],
}

/** Names the index {@link TRIPLE_SCHEMA} declares, as the store lists it. */
export const TRIPLE_INDEX_NAMES: readonly string[] = Object.freeze(
	TRIPLE_SCHEMA.indexes.map((columns) => deriveIndexedDBIndexName(columns)),
)

/**
 * Reads the index names one store of a database holds, through a connection opened and closed
 * for the read.
 *
 * @param name - The database name
 * @param store - The object-store name
 * @returns The store's index names, empty when the database holds no such store
 */
export async function readStoredIndexes(name: string, store: string): Promise<readonly string[]> {
	const database = createIndexedDBDatabase({ name, stores: {} })
	try {
		return readIndexNames(await database.connect(), [store]).get(store) ?? []
	} finally {
		database.close()
	}
}
