// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window`: node-only helpers live in `setupServer.ts`.

import type {
	AggregateOperation,
	ColumnMap,
	Condition,
	ConditionOperator,
	ConditionConnector,
	QueryInput,
	DatabaseInterface,
	DriverInterface,
	DriverMetadata,
	MigrationInput,
	Row,
	RowOf,
	TableInterface,
	TableSchema,
} from '@src/core'
import type { EmitterErrorHandler, EmitterInterface, EventMap } from '@orkestrel/emitter'
import type { FieldPath } from '@orkestrel/contract'
import { integerShape, literalShape, stringShape } from '@orkestrel/contract'
import { conformDriver as coreConformDriver, createDatabase, createMemoryDriver } from '@src/core'
import { describe, expect, it } from 'vitest'

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
export async function collectRows<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const rows: T[] = []
	for await (const row of iterable) rows.push(row)
	return rows
}

/**
 * Collect sorted ids from the parity suite's optional-rank stream case.
 *
 * @param table - The real backend table under comparison
 * @returns Matching row ids in stable order
 */
export async function collectRankStreamIds<T extends { readonly id: string }>(
	table: TableInterface<T>,
): Promise<readonly string[]> {
	const ids: string[] = []
	for await (const row of table
		.query()
		.condition({ column: 'rank', operator: 'below', values: [10], connector: 'and' })
		.stream()) {
		ids.push(row.id)
	}
	return ids.sort()
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
	return names.map((name) => ({
		name,
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [],
	}))
}

/**
 * Build one {@link Condition} for a input/compiler test — the verbose literal
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
	connector: ConditionConnector = 'and',
): Condition {
	return { column, operator, values, connector }
}

/** The shared `users` / `posts` shape maps for the cross-driver integration tests. */
export const INTEGRATION_TABLES = {
	users: { id: stringShape(), name: stringShape(), age: integerShape() },
	posts: { id: stringShape(), author: stringShape(), title: stringShape() },
} satisfies Readonly<Record<string, ColumnMap>>

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
 * `seeded()` the `Cursor` / `Query` tests each hand-rolled (each over the SAME base
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
export async function seedUsersTable<const C extends ColumnMap>(
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

/** The exact columns used by the Cursor behavior and transaction-lifetime scenarios. */
export const CURSOR_COLUMNS = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape({ min: 0 }),
	role: literalShape(['admin', 'member', 'guest']),
}

/** One row in the shared Cursor scenario. */
export type CursorUserRow = RowOf<typeof CURSOR_COLUMNS>

/** The canonical three-row seed used by Cursor ordering and mutation scenarios. */
export const CURSOR_ROWS: readonly CursorUserRow[] = [
	{ id: 'u1', name: 'Ada', age: 36, role: 'admin' },
	{ id: 'u2', name: 'Bo', age: 17, role: 'guest' },
	{ id: 'u3', name: 'Cy', age: 41, role: 'member' },
]

/**
 * Create the shared Cursor database over a caller-selected driver.
 *
 * @param driver - The storage driver; defaults to a fresh real Memory driver
 * @returns The database and its typed `users` table
 */
export function createCursorDatabase(driver: DriverInterface = createMemoryDriver()) {
	const db = createDatabase({ driver, tables: { users: CURSOR_COLUMNS } })
	return { db, users: db.table('users') }
}

/**
 * Create and seed the shared Cursor database.
 *
 * @param driver - The storage driver; defaults to a fresh real Memory driver
 * @returns The database and its seeded typed `users` table
 */
export async function seedCursorDatabase(driver?: DriverInterface) {
	const instance = createCursorDatabase(driver)
	await instance.users.set(CURSOR_ROWS)
	return instance
}

/**
 * Adapt a real Memory driver to only the required DriverInterface primitives.
 *
 * @param memory - The real Memory driver to expose
 * @returns A required-surface driver suitable for adding one test-specific hook
 */
export function createMemoryAdapter(
	memory: DriverInterface = createMemoryDriver(),
): DriverInterface {
	return {
		open: (schema) => memory.open(schema),
		close: () => memory.close(),
		read: (table, key) => memory.read(table, key),
		write: (table, key, row, options) => memory.write(table, key, row, options),
		insert: (table, key, row, options) => memory.insert(table, key, row, options),
		delete: (table, key, options) => memory.delete(table, key, options),
		keys: (table) => memory.keys(table),
		scan: (table) => memory.scan(table),
		clear: (table) => memory.clear(table),
		snapshot: (tables) => memory.snapshot(tables),
	}
}

/** Optional metadata capabilities exposed by a reconciliation test driver. */
export interface ReconciliationDriverOptions {
	readonly metadata: boolean
	readonly stamp: boolean
	readonly migrate?: boolean
	readonly initial?: DriverMetadata
}

/**
 * Create a real Memory-backed driver with an exact optional metadata-hook set.
 *
 * @param options - Which optional hooks exist and the initial persisted metadata
 * @returns The driver plus call records for reconciliation assertions
 */
export function createReconciliationDriver(options: ReconciliationDriverOptions): {
	readonly driver: DriverInterface
	readonly metadataCalls: readonly number[]
	readonly stampCalls: readonly DriverMetadata[]
	readonly migrateCalls: readonly MigrationInput[]
} {
	const memory = createMemoryDriver()
	const metadataCalls: number[] = []
	const stampCalls: DriverMetadata[] = []
	const migrateCalls: MigrationInput[] = []
	let stored = options.initial
	const driver: DriverInterface = {
		...createMemoryAdapter(memory),
		...(options.metadata
			? {
					async metadata() {
						metadataCalls.push(1)
						return stored
					},
				}
			: {}),
		...(options.stamp
			? {
					async stamp(next: DriverMetadata) {
						stampCalls.push(next)
						stored = next
					},
				}
			: {}),
		...(options.migrate
			? {
					async migrate(input: MigrationInput) {
						migrateCalls.push(input)
						await memory.migrate?.(input)
						if (input.metadata !== undefined) stored = input.metadata
					},
				}
			: {}),
	}
	return { driver, metadataCalls, stampCalls, migrateCalls }
}

/** A reusable host-independent AsyncIterable over one supplied AsyncIterator. */
export class IteratorSource<T> implements AsyncIterable<T> {
	readonly #iterator: AsyncIterator<T>

	constructor(iterator: AsyncIterator<T>) {
		this.#iterator = iterator
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return this.#iterator
	}
}

/** An async iterator wrapper that records every delegated source cleanup. */
export class RecordingIterator<T> implements AsyncIterator<T> {
	readonly #source: AsyncIterator<T>
	readonly #cleanup: () => void

	constructor(source: AsyncIterator<T>, cleanup: () => void) {
		this.#source = source
		this.#cleanup = cleanup
	}

	next(): Promise<IteratorResult<T>> {
		return this.#source.next()
	}

	async return(): Promise<IteratorResult<T>> {
		this.#cleanup()
		if (this.#source.return === undefined) return { done: true, value: undefined }
		return this.#source.return()
	}
}

/** One recorded call to {@link createRecordingDriver}'s native `aggregate` hook. */
export interface RecordingAggregate {
	readonly operation: AggregateOperation
	readonly column: FieldPath
	readonly input: QueryInput
}

/**
 * A recording {@link DriverInterface} over the real Memory driver that ALSO implements
 * the optional native `records` / `aggregate` hooks (AGENTS §21). Rows are
 * stored (so a scan WOULD return them), but the two hooks
 * short-circuit to a fixed sentinel and record what they were handed, so a test can
 * prove `Table` preferred the hook over the scan engine.
 */
export interface RecordingDriverInterface extends DriverInterface {
	/** The native filtered-read hook (always present here) — records its input. */
	records(table: string, input: QueryInput): Promise<readonly Row[]>
	/** The native aggregate hook (always present here) — records its arguments. */
	aggregate(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined>
}

/** The sentinel row {@link createRecordingDriver}'s native `records` hook returns. */
export const RECORDING_ROW: Row = { id: 'native', name: 'Native', age: 7 }

/** The sentinel value {@link createRecordingDriver}'s native `aggregate` hook returns. */
export const RECORDING_AGGREGATE = 123

/**
 * Create a {@link RecordingDriverInterface} plus the arrays its native hooks
 * record into — a real Memory-backed driver whose `records` / `aggregate`
 * return fixed sentinels ({@link RECORDING_ROW} / {@link RECORDING_AGGREGATE})
 * and push what they receive onto `recordsCalls` / `aggregateCalls`. Lets a test assert the native hook ran (and with
 * which arguments) instead of the scan engine. `aggregatesUndefined` makes the
 * `aggregate` hook resolve to `undefined` instead — to prove `Table` treats a
 * present hook as having handled the call even when its result is `undefined`.
 *
 * @param aggregatesUndefined - When `true`, the native `aggregate` hook resolves to
 *   `undefined` (still recording the call); defaults to `false`
 * @returns The driver and its two recorded-call arrays
 */
export function createRecordingDriver(aggregatesUndefined = false): {
	readonly driver: RecordingDriverInterface
	readonly recordsCalls: readonly QueryInput[]
	readonly aggregateCalls: readonly RecordingAggregate[]
} {
	const memory = createMemoryDriver()
	const recordsCalls: QueryInput[] = []
	const aggregateCalls: RecordingAggregate[] = []
	const driver: RecordingDriverInterface = {
		async open(schema) {
			await memory.open(schema)
		},
		async close() {
			await memory.close()
		},
		async read(table, key) {
			return memory.read(table, key)
		},
		async write(table, key, row, options) {
			await memory.write(table, key, row, options)
		},
		async insert(table, key, row, options) {
			await memory.insert(table, key, row, options)
		},
		async delete(table, key, options) {
			return memory.delete(table, key, options)
		},
		async keys(table) {
			return memory.keys(table)
		},
		scan(table) {
			return memory.scan(table)
		},
		async clear(table) {
			await memory.clear(table)
		},
		async snapshot() {
			return memory.snapshot()
		},
		async records(_table, input) {
			recordsCalls.push(input)
			return [{ ...RECORDING_ROW }]
		},
		async aggregate(_table, operation, column, input) {
			aggregateCalls.push({ operation, column, input })
			return aggregatesUndefined ? undefined : RECORDING_AGGREGATE
		},
	}
	return { driver, recordsCalls, aggregateCalls }
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
// with one call (AGENTS §16.1) — delegated to the core `conformDriver` helper
// (`@src/core`), which owns the schema, the required-primitive checks, and the
// presence-gated optional-hook coverage (migrate / stream / transaction).

/**
 * Register the shared {@link DriverInterface} conformance battery for one backend
 * — a thin `describe` wrapper around the core `conformDriver` helper. Call once
 * per backend (AGENTS §16.1) so a new driver proves the same invariants the
 * reference `MemoryDriver` does, with one line instead of a hand-rolled copy of
 * its test file.
 *
 * @param name - The backend's name, used in the registered `describe` title
 * @param factory - Builds one fresh, unopened driver instance
 */
export function conformDriver(name: string, factory: () => DriverInterface): void {
	describe(`driver conformance — ${name}`, () => {
		it('conforms to DriverInterface', async () => {
			await expect(coreConformDriver(factory)).resolves.toBeUndefined()
		})
	})
}

/** Whether a repository-relative Vue SFC path belongs to the private browser application. */
export function isBrowserVuePath(path: string): boolean {
	const normalized = path.replaceAll('\\', '/')
	return normalized.startsWith('app/browser/')
}
