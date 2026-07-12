// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window` / Vue: DOM/Vue helpers live in `setupBrowser.ts`.

import type {
	AggregateFunction,
	Columns,
	Condition,
	ConditionOperator,
	Connector,
	Criteria,
	DatabaseInterface,
	DriverInterface,
	Key,
	Row,
	RowOf,
	TableInterface,
	TableSchema,
} from '@src/core'
import {
	createDatabase,
	createMemoryDriver,
} from '@src/core'
import { afterEach, vi } from 'vitest'

afterEach(() => {
	vi.restoreAllMocks()
})

// A real callback that records its calls — use instead of a mock when a test
// only needs to count invocations or inspect arguments.
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

export function createRecorder<
	TArgs extends readonly unknown[] = readonly unknown[],
>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler: (...args: TArgs) => {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

// ── Databases test fixtures ───────────────────────────────────────────────────
// Shared, environment-agnostic scenario builders for the `databases` / `relations` tests — a
// seeded table over the real in-memory reference driver, condition/schema
// literal factories, and a recording driver for the native-hook dispatch pins
// (AGENTS §16.1: real implementations and recorders, never mocks).

/**
 * Drain an `AsyncIterable<Row>` (a driver `scan`, a cursor stream) into an array
 * — the assertion-friendly counterpart to a streaming read.
 *
 * @param iterable - The async row source to consume to completion
 * @returns Every yielded row, in iteration order
 */
export async function collectRows(iterable: AsyncIterable<Row>): Promise<Row[]> {
	const rows: Row[] = []
	for await (const row of iterable) rows.push(row)
	return rows
}

/**
 * A minimal {@link TableSchema}`[]` for the named tables — each scan-only (empty
 * `columns` / `indexes`, `primary: 'id'`), enough to ready a table by name on a
 * driver that reads only `name` (the reference `MemoryDriver`).
 *
 * @param names - The table names to declare
 * @returns One scan-only schema per name
 */
export function tableSchemas(...names: readonly string[]): readonly TableSchema[] {
	return names.map((name) => ({ name, primary: 'id', columns: [], indexes: [] }))
}

/**
 * Build one {@link Condition} for a criteria/compiler test — the verbose literal
 * (`{ column, operator, values, connector }`) folded into a call.
 *
 * @param column - The {@link FieldPath} the condition reads (a string is ONE
 *   column, an array descends into a nested value)
 * @param operator - The WHERE comparison to apply
 * @param values - The operator's operands (none / one / two / a list)
 * @param connector - How this condition folds into the running result; defaults
 *   to `'and'` and is ignored on the first condition of a list
 * @returns The assembled condition
 */
export function buildCondition(
	column: FieldPath,
	operator: ConditionOperator,
	values: readonly unknown[],
	connector: Connector = 'and',
): Condition {
	return { column, operator, values, connector }
}

/** The shared `users` / `posts` shape maps for the cross-driver integration tests. */
export const INTEGRATION_TABLES = {
	users: { id: stringShape(), name: stringShape(), age: integerShape() },
	posts: { id: stringShape(), author: stringShape(), title: stringShape() },
} as const

/**
 * The relation map for {@link INTEGRATION_TABLES} — users have many posts, a post
 * belongs to its author — fed to `createRelationManager` in every cross-driver
 * integration test (the manager's `database` stays env-specific).
 */
export const INTEGRATION_RELATIONS = {
	users: { posts: hasMany('author') },
	posts: { author: belongsTo('author', 'users') },
} as const

/** A row of the canonical `users` table ({@link INTEGRATION_TABLES}` users`). */
export interface UserRow {
	readonly id: string
	readonly name: string
	readonly age: number
}

/**
 * Build one canonical `users` row (`{ id, name, age }`) — the single most-repeated row
 * literal across the database / driver / relations tests, folded into a factory with a
 * sensible default (`{ id: 'u1', name: 'Ada', age: 36 }`) plus per-call overrides so a
 * test names only the field its scenario varies (AGENTS §16.1). A plain data builder; the
 * shape matches {@link INTEGRATION_TABLES}` users`.
 *
 * @param overrides - Fields to override on the default row
 * @returns The assembled user row
 */
export function createUserRow(overrides?: Partial<UserRow>): UserRow {
	return { id: 'u1', name: 'Ada', age: 36, ...overrides }
}

/**
 * The recurring three-row `users` seed — `Ada` / `Grace` / `Edsger` (`u1` / `u2` / `u3`)
 * — the trio the densest CRUD / batch / query tests `set([...])` before exercising reads
 * (AGENTS §16.1). Built fresh each call (a new array of fresh rows) so a mutating test
 * never leaks into the next; each row is a {@link createUserRow} so the shape stays in one
 * place.
 *
 * @returns The three seed rows, in key order
 */
export function userRows(): readonly UserRow[] {
	return [
		createUserRow(),
		createUserRow({ id: 'u2', name: 'Grace', age: 45 }),
		createUserRow({ id: 'u3', name: 'Edsger', age: 50 }),
	]
}

/**
 * Stand up a LIVE, seeded `users` {@link import('@src/core').TableInterface} for the `databases`
 * entity tests — `createDatabase({ driver: createMemoryDriver(), tables: { users: columns } })`,
 * seed the rows, and return `db.table('users')` (AGENTS §16.1). The shared form of the per-file
 * `seeded()` the `Cursor` / `Query` / `Clause` tests each hand-rolled (each over the SAME base
 * `id` / `name` / `age` columns plus its own 4th column — a `role` literal, a `nickname` optional).
 * The caller passes its FULL `columns` map and `rows`; because `columns` is captured as a `const`
 * generic, the returned table's row type is `RowOf<C>` — inferred PRECISELY (the literal-union
 * `role`, the optional `nickname`), so each file keeps `type Users = Awaited<ReturnType<typeof
 * seeded>>` with NO `as` and NO widening to a bare `Row`. A real `databases` table over the in-memory
 * reference driver (NOT a mock); each call builds a FRESH database so a mutating test never leaks.
 *
 * @typeParam C - The `users` column map (captured `const` so its row type infers precisely)
 * @param options - `columns` (the full column map) and `rows` (the seed rows, typed `RowOf<C>`)
 * @returns The seeded `users` table, typed `TableInterface<RowOf<C>>`
 */
export async function seedUsersTable<const C extends Columns>(
	columns: C,
	seed: (users: TableInterface<RowOf<C>>) => Promise<unknown>,
): Promise<TableInterface<RowOf<C>>> {
	const database = createDatabase({ driver: createMemoryDriver(), tables: { users: columns } })
	const users = database.table('users')
	await seed(users)
	return users
}

/**
 * Stand up a constrained `users` {@link import('@src/core').DatabaseInterface} — the shared
 * shape `Database.test.ts`'s local `userDatabase()` and `Table.test.ts`'s local `userTable()`
 * each hand-rolled byte-for-byte (AGENTS §16.1): `createDatabase({ driver: createMemoryDriver(),
 * name: 'app', tables: { users: { id, name: min(1), age: min(0) } } })`. `error` forwards to the
 * database's own `EmitterErrorHandler` (the one axis `userDatabase` varied); a fresh database is
 * built on every call so a mutating test never leaks.
 *
 * @param error - The database's `EmitterErrorHandler`; omitted when not needed
 * @returns The database and its `users` table
 */
export function createConstrainedUsersDatabase(error?: EmitterErrorHandler): {
	readonly db: DatabaseInterface
	readonly users: TableInterface<UserRow>
} {
	const db = createDatabase({
		driver: createMemoryDriver(),
		name: 'app',
		tables: {
			users: { id: stringShape(), name: stringShape({ min: 1 }), age: integerShape({ min: 0 }) },
		},
		...(error === undefined ? {} : { error }),
	})
	return { db, users: db.table('users') }
}

/** One recorded call to {@link createRecordingDriver}'s native `aggregate` hook. */
export interface RecordingAggregate {
	readonly operation: AggregateFunction
	readonly column: FieldPath
	readonly criteria: Criteria
}

/**
 * A recording {@link DriverInterface} over a Map that ALSO implements the optional
 * native `records` / `count` / `aggregate` hooks (AGENTS §21) — a real driver, not
 * a mock. Rows are stored (so a scan WOULD return them), but the three hooks
 * short-circuit to a fixed sentinel and record what they were handed, so a test can
 * prove `Table` preferred the hook over the scan engine.
 */
export interface RecordingDriverInterface extends DriverInterface {
	/** The native filtered-read hook (always present here) — records its criteria. */
	records(table: string, criteria: Criteria): Promise<readonly Row[]>
	/** The native count hook (always present here) — records its criteria. */
	count(table: string, criteria: Criteria): Promise<number>
	/** The native aggregate hook (always present here) — records its arguments. */
	aggregate(
		table: string,
		operation: AggregateFunction,
		column: FieldPath,
		criteria: Criteria,
	): Promise<number | undefined>
}

/** The sentinel row {@link createRecordingDriver}'s native `records` hook returns. */
export const RECORDING_ROW: Row = { id: 'native', name: 'Native', age: 7 }

/** The sentinel total {@link createRecordingDriver}'s native `count` hook returns. */
export const RECORDING_COUNT = 999

/** The sentinel value {@link createRecordingDriver}'s native `aggregate` hook returns. */
export const RECORDING_AGGREGATE = 123

/**
 * Create a {@link RecordingDriverInterface} plus the arrays its native hooks
 * record into — a real Map-backed driver whose `records` / `count` / `aggregate`
 * return fixed sentinels ({@link RECORDING_ROW} / {@link RECORDING_COUNT} /
 * {@link RECORDING_AGGREGATE}) and push what they receive onto `recordsCalls` /
 * `countCalls` / `aggregateCalls`. Lets a test assert the native hook ran (and with
 * which arguments) instead of the scan engine. `aggregatesUndefined` makes the
 * `aggregate` hook resolve to `undefined` instead — to prove `Table` treats a
 * present hook as having handled the call even when its result is `undefined`.
 *
 * @param aggregatesUndefined - When `true`, the native `aggregate` hook resolves to
 *   `undefined` (still recording the call); defaults to `false`
 * @returns The driver and its three recorded-call arrays
 */
export function createRecordingDriver(aggregatesUndefined = false): {
	readonly driver: RecordingDriverInterface
	readonly recordsCalls: readonly Criteria[]
	readonly countCalls: readonly Criteria[]
	readonly aggregateCalls: readonly RecordingAggregate[]
} {
	const tables = new Map<string, Map<Key, Row>>()
	const recordsCalls: Criteria[] = []
	const countCalls: Criteria[] = []
	const aggregateCalls: RecordingAggregate[] = []
	const store = (table: string): Map<Key, Row> => {
		let map = tables.get(table)
		if (map === undefined) {
			map = new Map()
			tables.set(table, map)
		}
		return map
	}
	const driver: RecordingDriverInterface = {
		async open(schema) {
			for (const table of schema) {
				if (!tables.has(table.name)) tables.set(table.name, new Map())
			}
		},
		async close() {},
		async read(table, key) {
			const row = store(table).get(key)
			return row === undefined ? undefined : { ...row }
		},
		async write(table, key, row) {
			store(table).set(key, { ...row })
		},
		async delete(table, key) {
			return store(table).delete(key)
		},
		async keys(table) {
			return [...store(table).keys()]
		},
		async *scan(table) {
			for (const row of store(table).values()) yield { ...row }
		},
		async clear(table) {
			store(table).clear()
		},
		async snapshot() {
			return async () => {}
		},
		async records(_table, criteria) {
			recordsCalls.push(criteria)
			return [{ ...RECORDING_ROW }]
		},
		async count(_table, criteria) {
			countCalls.push(criteria)
			return RECORDING_COUNT
		},
		async aggregate(_table, operation, column, criteria) {
			aggregateCalls.push({ operation, column, criteria })
			return aggregatesUndefined ? undefined : RECORDING_AGGREGATE
		},
	}
	return { driver, recordsCalls, countCalls, aggregateCalls }
}
