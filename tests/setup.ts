// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window`: node-only helpers live in `setupServer.ts`.

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
import type { EmitterErrorHandler, EmitterInterface, EventMap } from '@orkestrel/emitter'
import type { FieldPath } from '@orkestrel/contract'
import { integerShape, stringShape } from '@orkestrel/contract'
import { createDatabase, createMemoryDriver, isDatabaseError, planMigration } from '@src/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

// ── Database test fixtures ────────────────────────────────────────────────────
// Shared, environment-agnostic scenario builders for the `database` module's tests — a
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
 * Stand up a LIVE, seeded `users` {@link import('@src/core').TableInterface} for the `database`
 * entity tests — `createDatabase({ driver: createMemoryDriver(), tables: { users: columns } })`,
 * seed the rows, and return `db.table('users')` (AGENTS §16.1). The shared form of the per-file
 * `seeded()` the `Cursor` / `Query` / `Clause` tests each hand-rolled (each over the SAME base
 * `id` / `name` / `age` columns plus its own 4th column — a `role` literal, a `nickname` optional).
 * The caller passes its FULL `columns` map and `rows`; because `columns` is captured as a `const`
 * generic, the returned table's row type is `RowOf<C>` — inferred PRECISELY (the literal-union
 * `role`, the optional `nickname`), so each file keeps `type Users = Awaited<ReturnType<typeof
 * seeded>>` with NO `as` and NO widening to a bare `Row`. A real `database` table over the in-memory
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

/**
 * Create a recorder for an {@link EmitterErrorHandler} — the emitter's
 * own listener-error channel (AGENTS §13): a `TestRecorderInterface<[error, event]>` whose
 * `handler` is wired as the `error` option, so an emit-safety test asserts a buggy listener's
 * throw was routed here (with the offending event name) instead of corrupting the entity.
 * Argument order is `(error, event)`, matching `EmitterErrorHandler`. A thin alias over
 * {@link createRecorder} (AGENTS §16.1 — extract-once over the per-entity emit-safety blocks).
 *
 * @returns A recorder of `[error: unknown, event: string]` calls
 */
export function createErrorRecorder(): TestRecorderInterface<
	readonly [error: unknown, event: string]
> {
	return createRecorder<readonly [error: unknown, event: string]>()
}

/**
 * Run `thunk` and return the value it threw, or `undefined` if it returned normally — the
 * one shared form of the `try { …; return undefined } catch (error) { return error }` IIFE
 * the error-path tests repeat (AGENTS §16.1). Lets a caller assert on the captured fault
 * unconditionally, never inside a conditional `expect` — e.g. `errorCode(captureError(() =>
 * …))` (where `errorCode` lives in the env-specific setup). For a synchronous throw site; an
 * async rejection is asserted with `await expect(…).rejects` instead.
 *
 * @param thunk - The (synchronous) operation to run and capture the throw of
 * @returns The thrown value, or `undefined` when `thunk` did not throw
 */
export function captureError(thunk: () => unknown): unknown {
	try {
		thunk()
		return undefined
	} catch (error) {
		return error
	}
}

/** A {@link createRecorder} per listed event of an `EmitterInterface`, keyed by event name. */
export type EmitterRecorders<TMap extends EventMap, TName extends keyof TMap> = {
	readonly [K in TName]: TestRecorderInterface<TMap[K]>
}

/**
 * Wire one {@link createRecorder} onto `emitter` for each of the named events — the
 * one generic form of the per-entity `recordXEvents` bundles (AGENTS §16.1). Each
 * recorder subscribes via `emitter.on(name, recorder.handler)` and is returned keyed
 * by its event name, typed with that event's argument tuple — so a test asserts what
 * fired (`events.write.calls`) and with which payload, exactly as the local bundles did.
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names to record (inferred from `events`)
 * @param emitter - The emitter to subscribe the recorders to
 * @param events - The event names to record (each becomes a key of the result)
 * @returns A recorder per name, each subscribed and keyed by event name
 */
export function recordEmitterEvents<TMap extends EventMap, TName extends keyof TMap>(
	emitter: EmitterInterface<TMap>,
	events: readonly TName[],
): EmitterRecorders<TMap, TName> {
	// Accumulate into a `Partial` of the exact mapped shape — every value keeps its
	// precise per-event tuple type (a recorder is invariant in its argument tuple, so a
	// widened record won't hold it), all keys optional until assigned. Each recorder is
	// created against its event's tuple, so `on(name, handler)` is precisely typed as it
	// is wired. The dynamic key list is the untyped edge: once every listed name is
	// present we narrow `Partial` → total through a guard, never an assertion (§14).
	const recorders: Partial<EmitterRecorders<TMap, TName>> = {}
	for (const name of events) {
		const recorder = createRecorder<TMap[typeof name]>()
		emitter.on(name, recorder.handler)
		recorders[name] = recorder
	}
	if (!isTotal(recorders, events)) {
		throw new Error('recordEmitterEvents: a recorder was not wired for every event')
	}
	return recorders
}

/**
 * Narrow an accumulated `Partial<EmitterRecorders>` to its total mapped form once every
 * listed event has a recorder present — the §14 guard standing in for an assertion in
 * {@link recordEmitterEvents} (whose loop assigns one recorder per name, so this holds;
 * the explicit per-name presence check keeps the narrowing a sound guard, not a cast).
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names that must each have a recorder
 * @param recorders - The partially-accumulated recorder map to narrow
 * @param events - The event names that must all be present for the map to be total
 * @returns Whether every listed event has a recorder (narrowing `recorders` to total)
 */
export function isTotal<TMap extends EventMap, TName extends keyof TMap>(
	recorders: Partial<EmitterRecorders<TMap, TName>>,
	events: readonly TName[],
): recorders is EmitterRecorders<TMap, TName> {
	return events.every((name) => recorders[name] !== undefined)
}

// ── Driver conformance battery ──────────────────────────────────────────────
// Every current and future DriverInterface backend proves the same contract
// with one call (AGENTS §16.1) — the schema-agnostic required primitives plus
// the optional-hook battery (migrate / stream / transaction), gated on their
// presence on a fresh probe instance.

/** The two-table schema {@link conformDriver}'s battery runs against — an `id`-primary `users` table and a non-`id`-primary `posts` table. */
const CONFORM_SCHEMA: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', type: 'text', nullable: false },
			{ name: 'name', type: 'text', nullable: false },
		],
		indexes: [],
	},
	{
		name: 'posts',
		primary: 'slug',
		columns: [
			{ name: 'slug', type: 'text', nullable: false },
			{ name: 'title', type: 'text', nullable: false },
		],
		indexes: [],
	},
]

/**
 * Register the shared {@link DriverInterface} conformance battery for one backend
 * — every required primitive plus the optional-hook contract (`migrate` / `stream`
 * / `transaction`), gated on presence. Call once per backend (AGENTS §16.1) so a
 * new driver proves the same invariants the reference `MemoryDriver` does, with
 * one line instead of a hand-rolled copy of its test file.
 *
 * @remarks
 * `factory` is called fresh for every test (each backend supplies its own,
 * e.g. `createJSONDriver(tempDatabasePath().path)`) so no test leaks state into
 * the next. Optional hooks are detected on a throwaway probe instance built once
 * per `describe` registration; their sub-batteries are skipped entirely (no
 * `describe` block registered) when the hook is absent, rather than passing
 * vacuously inside a conditional `it`.
 *
 * @param name - The backend's name, used in the registered `describe` title
 * @param factory - Builds one fresh, unopened driver instance
 */
export function conformDriver(name: string, factory: () => DriverInterface): void {
	describe(`driver conformance — ${name}`, () => {
		it('opens with a schema and closes cleanly', async () => {
			const driver = factory()
			await expect(driver.open(CONFORM_SCHEMA)).resolves.toBeUndefined()
			await expect(driver.close()).resolves.toBeUndefined()
		})

		it('reads a missing key as undefined', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			expect(await driver.read('users', 'missing')).toBeUndefined()
		})

		it('writes and reads back a row, isolating the stored copy from caller mutation', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			const input = { id: 'u1', name: 'Ada' }
			await driver.write('users', 'u1', input)
			input.name = 'Mutated after write'
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
		})

		it('upserts an existing key', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada Lovelace' })
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada Lovelace' })
		})

		it('delete returns true when present and false when absent', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
			expect(await driver.delete('users', 'u1')).toBe(true)
			expect(await driver.delete('users', 'u1')).toBe(false)
		})

		it('keys and scan yield in ascending key order', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			await driver.write('users', 'c', { id: 'c', name: 'C' })
			await driver.write('users', 'a', { id: 'a', name: 'A' })
			await driver.write('users', 'b', { id: 'b', name: 'B' })
			expect(await driver.keys('users')).toEqual(['a', 'b', 'c'])
			expect((await collectRows(driver.scan('users'))).map((row) => row.id)).toEqual([
				'a',
				'b',
				'c',
			])
		})

		it('clear empties only the targeted table', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
			await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
			await driver.clear('users')
			expect(await driver.keys('users')).toEqual([])
			expect(await driver.keys('posts')).toEqual(['intro'])
		})

		it('snapshot returns a rollback thunk that restores the pre-snapshot state', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
			const rollback = await driver.snapshot()
			await driver.write('users', 'u1', { id: 'u1', name: 'Changed' })
			await driver.write('users', 'u2', { id: 'u2', name: 'Ghost' })
			await rollback()
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
			expect(await driver.read('users', 'u2')).toBeUndefined()
		})

		it('extracts the key from a non-id primary column', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
			expect(await driver.keys('posts')).toEqual(['intro'])
			expect(await driver.read('posts', 'intro')).toEqual({ slug: 'intro', title: 'Intro' })
		})

		it('round-trips a nested-object row', async () => {
			const driver = factory()
			await driver.open(CONFORM_SCHEMA)
			const nested = { tags: ['a', 'b'], info: { score: 9, ok: true } }
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', nested })
			expect((await driver.read('users', 'u1'))?.nested).toEqual(nested)
		})

		const probe = factory()
		const hasMigrate = probe.migrate !== undefined
		const hasStream = probe.stream !== undefined
		const hasTransaction = probe.transaction !== undefined

		describe.runIf(hasMigrate)('migrate (optional)', () => {
			it('applies a plan whose column.remove step strips the field from stored rows', async () => {
				const driver = factory()
				await driver.open(CONFORM_SCHEMA)
				await driver.write('users', 'u1', { id: 'u1', name: 'Ada', legacy: true })
				const before = CONFORM_SCHEMA.map((table) =>
					table.name === 'users'
						? {
								...table,
								columns: [
									...table.columns,
									{ name: 'legacy', type: 'boolean' as const, nullable: false },
								],
							}
						: table,
				)
				const plan = planMigration(before, CONFORM_SCHEMA)
				await driver.migrate?.(plan)
				expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
			})

			it('throws a MIGRATION DatabaseError for an unknown-table plan', async () => {
				const driver = factory()
				await driver.open(CONFORM_SCHEMA)
				const plan = planMigration(
					[{ name: 'missing', primary: 'id', columns: [], indexes: [] }],
					[],
				)
				const error = await driver.migrate?.(plan).catch((caught: unknown) => caught)
				expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
			})
		})

		describe.runIf(hasStream)('stream (optional)', () => {
			it('yields only the rows matching the criteria', async () => {
				const driver = factory()
				await driver.open(CONFORM_SCHEMA)
				await driver.write('users', 'a', { id: 'a', name: 'Ada' })
				await driver.write('users', 'b', { id: 'b', name: 'Bo' })
				await driver.write('users', 'c', { id: 'c', name: 'Ada' })
				const criteria: Criteria = { conditions: [buildCondition('name', 'equals', ['Ada'])] }
				const rows: Row[] = []
				if (driver.stream !== undefined) {
					for await (const row of driver.stream('users', criteria)) rows.push(row)
				}
				expect(rows.map((row) => row.id).sort()).toEqual(['a', 'c'])
			})

			it('honors offset and limit paging', async () => {
				const driver = factory()
				await driver.open(CONFORM_SCHEMA)
				await driver.write('users', 'a', { id: 'a', name: 'Ada' })
				await driver.write('users', 'b', { id: 'b', name: 'Bo' })
				await driver.write('users', 'c', { id: 'c', name: 'Cy' })
				const rows: Row[] = []
				if (driver.stream !== undefined) {
					for await (const row of driver.stream('users', { offset: 1, limit: 1 })) rows.push(row)
				}
				expect(rows).toHaveLength(1)
			})
		})

		describe.runIf(hasTransaction)('transaction (optional)', () => {
			it('commit persists the writes made under the handle', async () => {
				const driver = factory()
				await driver.open(CONFORM_SCHEMA)
				const handle = await driver.transaction?.()
				await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
				await handle?.commit()
				expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
			})

			it('rollback restores the pre-transaction state', async () => {
				const driver = factory()
				await driver.open(CONFORM_SCHEMA)
				await driver.write('users', 'u1', { id: 'u1', name: 'Original' })
				const handle = await driver.transaction?.()
				await driver.write('users', 'u1', { id: 'u1', name: 'Changed' })
				await handle?.rollback()
				expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Original' })
			})
		})
	})
}
