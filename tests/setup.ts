// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window`: node-only helpers live in `setupServer.ts`.

import type { Result } from '@orkestrel/contract'
import { DatabaseContext } from '../src/core/DatabaseContext.js'
import { DatabaseTransaction } from '../src/core/DatabaseTransaction.js'
import { TransactionScope } from '../src/core/TransactionScope.js'
import type {
	StorageInterface,
	StorageMember,
	AdmissionInterface,
	AggregateOperation,
	ColumnSchema,
	Key,
	ColumnMap,
	CursorInterface,
	Condition,
	ConditionOperator,
	ConditionConnector,
	QueryInput,
	OperationOptions,
	ReadInput,
	ReadPlan,
	QueryInterface,
	DatabaseInterface,
	DriverInterface,
	DriverMetadata,
	MigrationInput,
	Migration,
	Row,
	RowOf,
	TableInterface,
	TableMap,
	TableSchema,
} from '@src/core'
import type { EmitterErrorHandler } from '@orkestrel/emitter'
import type { ContractInterface, FieldPath } from '@orkestrel/contract'
import {
	booleanShape,
	createContract,
	integerShape,
	isArray,
	isFunction,
	isRecord,
	jsonShape,
	literalShape,
	nullableShape,
	objectShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'
import { collect } from '@orkestrel/test'
import {
	applyQuery,
	normalizeReadInput,
	computeAggregate,
	CONFORMANCE_ROWS,
	CONFORMANCE_SCHEMA,
	createDatabase,
	extractKey,
	applyKeys,
	createMemoryDriver,
	isDatabaseError,
	buildBatch,
	MemoryDriver,
	requireColumns,
	collectColumns,
	StorageJournal,
	StorageRecorder,
} from '@src/core'

// ── Database test fixtures ────────────────────────────────────────────────────
// Shared, environment-agnostic scenario builders for the `database` module's tests — a
// seeded table over the real in-memory reference driver, condition/schema
// literal factories, and a recording driver for the native-hook dispatch pins
// (see `.claude/rules/tests.md` § Test contract: real implementations and
// recorders, never mocks).

/**
 * Collects sorted ids from the parity suite's optional-rank stream case.
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
 * Declares a minimal {@link TableSchema}`[]` for the named tables — each scan-only (empty
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
 * Builds one {@link Condition} for a input/compiler test — the verbose literal
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

/** Holds the shared `users` shape map the fixture rows and the native-hook dispatch tests declare. */
export const INTEGRATION_TABLES = {
	users: { id: stringShape(), name: stringShape(), age: integerShape() },
} satisfies Readonly<Record<string, ColumnMap>>

/** Shapes a row of the canonical `users` table ({@link INTEGRATION_TABLES}` users`). */
export interface UserRow {
	readonly id: string
	readonly name: string
	readonly age: number
}

/**
 * Builds one canonical `users` row (`{ id, name, age }`) — the single most-repeated row
 * literal across the database / driver / relations tests, folded into a factory with a
 * sensible default (`{ id: 'u1', name: 'Ada', age: 36 }`) plus per-call overrides so a
 * test names only the field its scenario varies (see `.claude/rules/tests.md`
 * § Shared test infrastructure). A plain data builder; the
 * shape matches {@link INTEGRATION_TABLES}` users`.
 *
 * @param overrides - Fields to override on the default row
 * @returns The assembled user row
 */
export function createUserRow(overrides?: Partial<UserRow>): UserRow {
	return { id: 'u1', name: 'Ada', age: 36, ...overrides }
}

/**
 * Builds the recurring three-row `users` seed — `Ada` / `Grace` / `Edsger` (`u1` / `u2` / `u3`)
 * — the trio the densest CRUD / batch / query tests `set([...])` before exercising reads
 * (see `.claude/rules/tests.md` § Shared test infrastructure). Built fresh each
 * call (a new array of fresh rows) so a mutating test
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
 * Stands up a LIVE, seeded `users` {@link import('@src/core').TableInterface} for the `database`
 * entity tests — `createDatabase({ driver: createMemoryDriver(), tables: { users: columns } })`,
 * seed the rows, and return `db.table('users')` (see `.claude/rules/tests.md`
 * § Shared test infrastructure). The shared form of the per-file
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
 * Stands up a constrained `users` {@link import('@src/core').DatabaseInterface} — the shared
 * shape `Database.test.ts`'s local `userDatabase()` and `Table.test.ts`'s local `userTable()`
 * each hand-rolled byte-for-byte (see `.claude/rules/tests.md`
 * § Shared test infrastructure): `createDatabase({ driver: createMemoryDriver(),
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

/**
 * Creates the constrained users table over a {@link StorageRecorder} on a real driver, so a
 * test reads the driver calls each table operation makes.
 *
 * @param driver - The real driver to record. Default: a fresh Memory driver
 * @returns The recorder, the database, and its users table
 */
export function createRecordedUsers(driver: DriverInterface = createMemoryDriver()): {
	readonly recorder: StorageRecorder
	readonly db: DatabaseInterface
	readonly users: TableInterface<UserRow>
} {
	const recorder = new StorageRecorder(driver)
	const db = createDatabase({
		driver: recorder.driver,
		tables: {
			users: { id: stringShape(), name: stringShape({ min: 1 }), age: integerShape({ min: 0 }) },
		},
	})
	return { recorder, db, users: db.table('users') }
}

/** Shapes one empty-list call on a storage's list member and the answer it must give. */
export interface EmptyStorageCase {
	readonly member: StorageMember
	readonly run: (storage: StorageInterface) => Promise<unknown>
	readonly expected: unknown
}

/** Lists the empty-list call of each storage list member, on the `users` table. */
export const EMPTY_STORAGE_CASES: readonly EmptyStorageCase[] = Object.freeze([
	{ member: 'read', run: (storage) => storage.read('users', []), expected: [] },
	{ member: 'write', run: (storage) => storage.write('users', [], []), expected: undefined },
	{ member: 'insert', run: (storage) => storage.insert('users', [], []), expected: undefined },
	{ member: 'delete', run: (storage) => storage.delete('users', []), expected: [] },
])

/** Shapes one empty-list call on a table's list overload and the answer it must give. */
export interface EmptyTableCase {
	readonly member: string
	readonly run: (users: TableInterface<UserRow>) => Promise<unknown>
	readonly expected: unknown
}

/** Lists the empty-list call of each table list overload. */
export const EMPTY_TABLE_CASES: readonly EmptyTableCase[] = Object.freeze([
	{ member: 'set', run: (users) => users.set([]), expected: [] },
	{ member: 'add', run: (users) => users.add([]), expected: [] },
	{ member: 'get', run: (users) => users.get([]), expected: [] },
	{ member: 'resolve', run: (users) => users.resolve([]), expected: [] },
	{ member: 'has', run: (users) => users.has([]), expected: [] },
	{ member: 'update', run: (users) => users.update([], { name: 'Renamed' }), expected: [] },
	{ member: 'remove', run: (users) => users.remove([]), expected: true },
])

/**
 * Builds the users rows a batch reading writes, keyed `u0` onward.
 *
 * @param count - The number of rows
 * @returns The rows
 */
export function buildUserRows(count: number): readonly UserRow[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `u${index}`,
		name: `User ${index}`,
		age: index,
	}))
}

/** Declares the exact columns the Cursor behavior and transaction-lifetime scenarios read. */
export const CURSOR_COLUMNS = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape({ min: 0 }),
	role: literalShape(['admin', 'member', 'guest']),
}

/** Shapes one row in the shared Cursor scenario. */
export type CursorUserRow = RowOf<typeof CURSOR_COLUMNS>

/** Holds the canonical three-row seed the Cursor ordering and mutation scenarios read. */
export const CURSOR_ROWS: readonly CursorUserRow[] = [
	{ id: 'u1', name: 'Ada', age: 36, role: 'admin' },
	{ id: 'u2', name: 'Bo', age: 17, role: 'guest' },
	{ id: 'u3', name: 'Cy', age: 41, role: 'member' },
]

/**
 * Creates the shared Cursor database over a caller-selected driver.
 *
 * @param driver - The storage driver; defaults to a fresh real Memory driver
 * @returns The database and its typed `users` table
 */
export function createCursorDatabase(driver: DriverInterface = createMemoryDriver()) {
	const db = createDatabase({ driver, tables: { users: CURSOR_COLUMNS } })
	return { db, users: db.table('users') }
}

/**
 * Creates and seeds the shared Cursor database.
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
 * Adapts a real Memory driver to only the required DriverInterface primitives.
 *
 * @param memory - The real Memory driver to expose
 * @returns A required-surface driver suitable for adding one test-specific hook
 */
export function createMemoryAdapter(
	memory: DriverInterface = createMemoryDriver(),
	overrides: Partial<DriverInterface> = {},
): DriverInterface {
	return {
		open: (tables) => memory.open(tables),
		close: () => memory.close(),
		read: memory.read.bind(memory),
		write: memory.write.bind(memory),
		insert: memory.insert.bind(memory),
		delete: memory.delete.bind(memory),
		keys: (table) => memory.keys(table),
		scan: (table) => memory.scan(table),
		clear: (table) => memory.clear(table),
		...overrides,
	}
}

/** Holds the list-form handlers {@link interceptStorage} puts in front of a driver's keyed members. */
export interface StorageHandlers {
	readonly read?: (table: string, keys: readonly Key[]) => Promise<ReadonlyArray<Row | undefined>>
	readonly write?: (
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	) => Promise<void>
	readonly delete?: (
		table: string,
		keys: readonly Key[],
		options?: OperationOptions,
	) => Promise<readonly boolean[]>
}

/**
 * Puts list-form handlers in front of a real driver's keyed members, each single call reaching
 * its handler as a list of one.
 *
 * @param source - The real driver
 * @param handlers - The handlers to run in place of `read`, `write`, or `delete`
 * @returns The driver with the handled members replaced
 */
export function interceptStorage(
	source: DriverInterface,
	handlers: StorageHandlers,
): DriverInterface {
	const intercepted = new InterceptedStorage(source, handlers)
	return createMemoryAdapter(source, {
		read: intercepted.read.bind(intercepted),
		write: intercepted.write.bind(intercepted),
		delete: intercepted.delete.bind(intercepted),
	})
}

/** Routes a driver's keyed members through {@link StorageHandlers}, keeping their overloads. */
export class InterceptedStorage {
	readonly #source: DriverInterface
	readonly #handlers: StorageHandlers

	constructor(source: DriverInterface, handlers: StorageHandlers) {
		this.#source = source
		this.#handlers = handlers
	}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		const handler = this.#handlers.read
		if (handler === undefined) {
			// The ternary only selects the overload; both arms make the same call.
			return isArray(keys) ? this.#source.read(table, keys) : this.#source.read(table, keys)
		}
		if (isArray(keys)) return handler(table, keys)
		const [row] = await handler(table, [keys])
		return row
	}

	write(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async write(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		const entries = buildBatch(keys, rows)
		const listed = entries.map(([key]) => key)
		const values = entries.map(([, row]) => row)
		const handler = this.#handlers.write
		if (handler === undefined) await this.#source.write(table, listed, values, options)
		else await handler(table, listed, values, options)
	}

	delete(table: string, key: Key, options?: OperationOptions): Promise<boolean>
	delete(
		table: string,
		keys: readonly Key[],
		options?: OperationOptions,
	): Promise<readonly boolean[]>
	async delete(
		table: string,
		keys: Key | readonly Key[],
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		const handler = this.#handlers.delete
		return applyKeys(keys, (listed) =>
			handler === undefined
				? this.#source.delete(table, listed, options)
				: handler(table, listed, options),
		)
	}
}

/** Names the optional metadata capabilities a reconciliation test driver exposes. */
export interface ReconciliationDriverOptions {
	readonly metadata: boolean
	readonly stamp: boolean
	readonly migrate?: boolean
	readonly initial?: DriverMetadata
}

/**
 * Creates a real Memory-backed driver with an exact optional metadata-hook set.
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
	return new ReconciliationFixture(options)
}

/** Wraps one supplied AsyncIterator as a reusable host-independent AsyncIterable. */
export class IteratorSource<T> implements AsyncIterable<T> {
	readonly #iterator: AsyncIterator<T>

	constructor(iterator: AsyncIterator<T>) {
		this.#iterator = iterator
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return this.#iterator
	}
}

/** Wraps an async iterator and records every delegated source cleanup. */
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

/** Shapes one recorded call to {@link createRecordingDriver}'s native `aggregate` hook. */
export interface RecordingAggregate {
	readonly operation: AggregateOperation
	readonly column: FieldPath
	readonly input: QueryInput
}

/**
 * Wraps the real Memory driver in a {@link DriverInterface} that ALSO implements the
 * optional native `plan` / `records` / `stream` / `aggregate` hooks and records each call.
 * Its plan keeps every read native. Rows are stored (so a scan WOULD return them), but the
 * read hooks short-circuit to a fixed sentinel and record what they were handed, so a test
 * can prove `Table` called the hook rather than the scan engine.
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

/** Holds the sentinel row {@link createRecordingDriver}'s native `records` hook returns. */
export const RECORDING_ROW: Row = { id: 'native', name: 'Native', age: 7 }

/** Holds the sentinel value {@link createRecordingDriver}'s native `aggregate` hook returns. */
export const RECORDING_AGGREGATE = 123

/**
 * Creates a {@link RecordingDriverInterface} plus the arrays its native hooks
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
	return new RecordingDriverFixture(aggregatesUndefined)
}

/** Owns the metadata state and observations of one reconciliation fixture. */
export class ReconciliationFixture {
	readonly #memory = createMemoryDriver()
	readonly #driver: DriverInterface
	readonly #metadataCalls: number[] = []
	readonly #stampCalls: DriverMetadata[] = []
	readonly #migrateCalls: MigrationInput[] = []
	#stored: DriverMetadata | undefined

	constructor(options: ReconciliationDriverOptions) {
		this.#stored = options.initial
		this.#driver = createMemoryAdapter(this.#memory, {
			...(options.metadata ? { metadata: this.#metadata.bind(this) } : {}),
			...(options.stamp ? { stamp: this.#stamp.bind(this) } : {}),
			...(options.migrate ? { migrate: this.#migrate.bind(this) } : {}),
		})
	}

	get driver(): DriverInterface {
		return this.#driver
	}

	get metadataCalls(): readonly number[] {
		return this.#metadataCalls
	}
	get stampCalls(): readonly DriverMetadata[] {
		return this.#stampCalls
	}
	get migrateCalls(): readonly MigrationInput[] {
		return this.#migrateCalls
	}

	async #metadata(): Promise<DriverMetadata | undefined> {
		this.#metadataCalls.push(1)
		return this.#stored
	}

	async #stamp(next: DriverMetadata): Promise<void> {
		this.#stampCalls.push(next)
		this.#stored = next
	}

	async #migrate(input: MigrationInput): Promise<void> {
		this.#migrateCalls.push(input)
		await this.#memory.migrate?.(input)
		if (input.metadata !== undefined) this.#stored = input.metadata
	}
}

/** Owns the call observations of a native-hook dispatch fixture. */
export class RecordingDriverFixture {
	readonly #memory = createMemoryDriver()
	readonly #driver: RecordingDriverInterface
	readonly #undefined: boolean
	readonly #records: QueryInput[] = []
	readonly #aggregates: RecordingAggregate[] = []

	constructor(aggregatesUndefined: boolean) {
		this.#undefined = aggregatesUndefined
		this.#driver = {
			...createMemoryAdapter(this.#memory),
			plan: this.#planCall.bind(this),
			records: this.#recordsCall.bind(this),
			stream: this.#streamCall.bind(this),
			aggregate: this.#aggregateCall.bind(this),
		}
	}

	get driver(): RecordingDriverInterface {
		return this.#driver
	}

	get recordsCalls(): readonly QueryInput[] {
		return this.#records
	}
	get aggregateCalls(): readonly RecordingAggregate[] {
		return this.#aggregates
	}

	// Keep every read native, so the core calls the records, stream, and aggregate hooks.
	#planCall(_table: string, input: ReadInput): ReadPlan {
		return { native: input, residual: {} }
	}

	async *#streamCall(_table: string, input: QueryInput): AsyncIterable<Row> {
		this.#records.push(input)
		yield { ...RECORDING_ROW }
	}

	async #recordsCall(_table: string, input: QueryInput): Promise<readonly Row[]> {
		this.#records.push(input)
		return [{ ...RECORDING_ROW }]
	}

	async #aggregateCall(
		_table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		this.#aggregates.push({ operation, column, input })
		return this.#undefined ? undefined : RECORDING_AGGREGATE
	}
}

/**
 * Names how {@link createPlannedDriver} splits and answers a read: `native` keeps every read
 * native and answers it exactly; `dropped` loses the first condition from both sides;
 * `listed` writes an empty residual condition list; `ignored` keeps conditions native but
 * answers without them; `unscoped` hands its transaction scope a storage without `plan`.
 */
export type PlannedSplit = 'native' | 'dropped' | 'listed' | 'ignored' | 'unscoped'

/**
 * Splits a read the way a {@link PlannedSplit} driver does.
 *
 * @param split - The split behavior
 * @param input - The read to split
 * @returns The plan
 */
export function splitPlannedRead(split: PlannedSplit, input: ReadInput): ReadPlan {
	if (split === 'listed') return { native: input, residual: { conditions: [] } }
	if (split !== 'dropped') return { native: input, residual: {} }
	return {
		native: normalizeReadInput({ ...input, conditions: input.conditions?.slice(1) ?? [] }),
		residual: {},
	}
}

/**
 * Answers the native side of a plan the way a {@link PlannedSplit} driver does, over the
 * Memory driver's scan.
 *
 * @param memory - The Memory driver holding the rows
 * @param table - The table to read
 * @param input - The native side
 * @param split - The split behavior
 * @returns The rows the driver answers
 */
export async function readPlannedSplit(
	memory: DriverInterface,
	table: string,
	input: QueryInput,
	split: PlannedSplit,
): Promise<readonly Row[]> {
	const read = split === 'ignored' ? normalizeReadInput({ ...input, conditions: [] }) : input
	return applyQuery(await Array.fromAsync(memory.scan(table)), read)
}

/**
 * Streams the native side of a plan the way a {@link PlannedSplit} driver does.
 *
 * @param memory - The Memory driver holding the rows
 * @param table - The table to read
 * @param input - The native side
 * @param split - The split behavior
 * @yields The rows the driver answers
 */
export async function* streamPlannedSplit(
	memory: DriverInterface,
	table: string,
	input: QueryInput,
	split: PlannedSplit,
): AsyncIterable<Row> {
	for (const row of await readPlannedSplit(memory, table, input, split)) yield row
}

/**
 * Runs a transaction scope the way a {@link PlannedSplit} driver does: over the planned
 * driver, or over a storage without `plan` for `unscoped`, journaling each write and restoring
 * the touched rows on rejection.
 *
 * @param memory - The Memory driver holding the rows
 * @param storage - The planned storage
 * @param split - The split behavior
 * @param scope - The transaction scope
 * @returns The scope's value
 */
export async function runPlannedTransaction<R>(
	memory: DriverInterface,
	storage: StorageInterface,
	split: PlannedSplit,
	scope: (storage: StorageInterface) => Promise<R>,
): Promise<R> {
	const journal = new StorageJournal(memory)
	const scoped: StorageInterface =
		split === 'unscoped'
			? journal
			: {
					read: journal.read.bind(journal),
					write: journal.write.bind(journal),
					insert: journal.insert.bind(journal),
					delete: journal.delete.bind(journal),
					keys: journal.keys.bind(journal),
					scan: journal.scan.bind(journal),
					clear: journal.clear.bind(journal),
					...(storage.plan === undefined ? {} : { plan: storage.plan.bind(storage) }),
					...(storage.records === undefined ? {} : { records: storage.records.bind(storage) }),
					...(storage.stream === undefined ? {} : { stream: storage.stream.bind(storage) }),
					...(storage.aggregate === undefined
						? {}
						: { aggregate: storage.aggregate.bind(storage) }),
				}
	try {
		return await scope(scoped)
	} catch (error) {
		await journal.restore()
		throw error
	}
}

/**
 * Creates a Memory-backed driver that declares `plan`, `records`, `stream`, `aggregate`, and
 * `transaction`, splitting each read by a {@link PlannedSplit}.
 *
 * @param split - The split behavior; Default: `native`
 * @returns The driver
 */
export function createPlannedDriver(split: PlannedSplit = 'native'): DriverInterface {
	const memory = createMemoryDriver()
	const driver: DriverInterface = createMemoryAdapter(memory, {
		plan: (_table, input) => splitPlannedRead(split, input),
		records: (table, input) => readPlannedSplit(memory, table, input, split),
		stream: (table, input) => streamPlannedSplit(memory, table, input, split),
		aggregate: async (table, operation, column, input) =>
			computeAggregate(await readPlannedSplit(memory, table, input, split), operation, column),
		transaction: (scope) => runPlannedTransaction(memory, driver, split, scope),
	})
	return driver
}

/**
 * Creates a Memory-backed driver that declares every optional storage member: a plan that
 * keeps every read native, `records`, `stream`, and `aggregate` answered over the stored
 * rows, and the Memory driver's own `migrate`, `metadata`, and `stamp`.
 *
 * @returns The driver
 */
export function createCompleteDriver(): DriverInterface {
	const memory = new MemoryDriver()
	return createMemoryAdapter(memory, {
		plan: (_table, input) => splitPlannedRead('native', input),
		records: (table, input) => readPlannedSplit(memory, table, input, 'native'),
		stream: (table, input) => streamPlannedSplit(memory, table, input, 'native'),
		aggregate: async (table, operation, column, input) =>
			computeAggregate(await readPlannedSplit(memory, table, input, 'native'), operation, column),
		migrate: memory.migrate.bind(memory),
		metadata: memory.metadata.bind(memory),
		stamp: memory.stamp.bind(memory),
	})
}

/** Counts protocol transitions within one test scenario. */
export class DatabaseCounter {
	#count = 0

	get count(): number {
		return this.#count
	}

	next(): number {
		this.#count += 1
		return this.#count
	}
}

/** Owns a scenario's switch across its asynchronous callbacks. */
export class DatabaseSwitch {
	#active: boolean

	constructor(active = false) {
		this.#active = active
	}
	get active(): boolean {
		return this.#active
	}
	enable(): void {
		this.#active = true
	}
	disable(): void {
		this.#active = false
	}
}

/** Holds the fixture that setup binds and teardown releases. */
export class DatabaseFixture<T> {
	#value: T | undefined

	get current(): T | undefined {
		return this.#value
	}

	get value(): T {
		if (this.#value === undefined) throw new Error('The database fixture is not bound')
		return this.#value
	}

	hold(value: T): void {
		if (this.#value !== undefined) throw new Error('The database fixture is already bound')
		this.#value = value
	}

	clear(): void {
		this.#value = undefined
	}
}

export const COLUMNS = {
	users: { id: stringShape(), name: stringShape(), age: integerShape() },
}

/**
 * Creates the contract source a {@link DatabaseTransaction} reads its tables' contracts from,
 * compiling each table's contract on each call.
 *
 * @param tables - The declared tables
 * @returns The source, which throws `NOT_FOUND` for an undeclared table
 */
export function createContractSource<T extends TableMap>(
	tables: T,
): <K extends keyof T & string>(name: K) => ContractInterface<RowOf<T[K]>> {
	return (name) => createContract(objectShape(requireColumns(tables, name)))
}

export async function transactionView(): Promise<{
	readonly view: DatabaseTransaction<typeof COLUMNS>
	readonly scope: TransactionScope
	readonly driver: StorageInterface
}> {
	const driver = createMemoryDriver()
	await driver.open(tableSchemas('users'))
	const scope = new TransactionScope()
	return {
		view: new DatabaseTransaction<typeof COLUMNS>(
			driver,
			createContractSource(COLUMNS),
			(name) => collectColumns(requireColumns(COLUMNS, name)),
			{},
			undefined,
			undefined,
			scope,
		),
		scope,
		driver,
	}
}

export function contextFor(...names: readonly string[]): DatabaseContext {
	const context = new DatabaseContext({ driver: createMemoryDriver(), tables: {} })
	context.register(tableSchemas(...names))
	return context
}

/** Describes the result returned by a fixture's transaction callback. */
export type TransactionResult<R> = (storage: StorageInterface) => Promise<Result<R, unknown>>

/** Returns a transaction scope that succeeds with the supplied value. */
export function succeeding<R>(value: R): TransactionResult<R> {
	return async () => ({ success: true, value })
}

export function failing(error: unknown): TransactionResult<never> {
	return async () => ({ success: false, error })
}

/** Resolves the readiness of an already connected transaction. */
export function ready(): Promise<void> {
	return Promise.resolve()
}

/** Creates the structural admission literal used by the guide proof. */
export function createAdmissionBoundary(): AdmissionInterface {
	return { accepting: true, track: (operation) => operation() }
}

/** Yields no rows for an absent optional stream. */
export async function* emptyRows(): AsyncGenerator<Row> {}

/** Creates metadata whose version accessor throws the supplied reason. */
export function createUnclonableMetadata(
	fault: unknown,
	declared: readonly TableSchema[] = [],
): DriverMetadata {
	return {
		get version(): number {
			throw fault
		},
		schema: declared,
	}
}

/** Returns an inert value for a non-serializable function fixture. */
export function emptyValue(): undefined {
	return undefined
}

/** Returns a fixture result after its resources finish closing. */
export async function completeFixture<T>(
	operation: () => Promise<T>,
	cleanup: () => Promise<void>,
): Promise<T> {
	try {
		return await operation()
	} finally {
		await cleanup()
	}
}

/** Creates a row whose payload read aborts its native transaction. */
export function createAbortingRow(controller: AbortController, reason: string): Row {
	return {
		id: 'active',
		get payload(): string {
			controller.abort(reason)
			return 'value'
		},
	}
}

/** Seeds the canonical trio into a real constrained `users` table. */
export async function seedConstrainedUsers() {
	const { users } = createConstrainedUsersDatabase()
	await users.set(userRows())
	return users
}

/** Seeds a real `rank` table spanning the parity helper's `below 10` boundary. */
export async function seedRankRows() {
	const db = createDatabase({
		driver: createMemoryDriver(),
		tables: { rows: { id: stringShape(), rank: integerShape() } },
	})
	const rows = db.table('rows')
	await rows.set([
		{ id: 'r3', rank: 3 },
		{ id: 'r1', rank: 9 },
		{ id: 'r2', rank: 10 },
		{ id: 'r4', rank: 41 },
	])
	return rows
}

/** Creates a real `users` table over one of the recording driver's two aggregate modes. */
export function recordUsersTable(aggregatesUndefined: boolean) {
	const recording = createRecordingDriver(aggregatesUndefined)
	const db = createDatabase({
		driver: recording.driver,
		tables: { users: INTEGRATION_TABLES.users },
	})
	return { recording, users: db.table('users') }
}

export const columns = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	role: literalShape(['admin', 'member', 'guest']),
}

// The table's row type is inferred from its columns — no hand-written alias.
export async function seeded() {
	return seedUsersTable(columns, (users) =>
		users.set([
			{ id: 'u1', name: 'Ada', age: 36, role: 'admin' },
			{ id: 'u2', name: 'Bo', age: 17, role: 'guest' },
			{ id: 'u3', name: 'Cy', age: 41, role: 'member' },
			{ id: 'u4', name: 'Di', age: 23, role: 'member' },
		]),
	)
}

export type Users = Awaited<ReturnType<typeof seeded>>

export async function createNestedPeopleTable() {
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

export function schema(overrides: Partial<TableSchema> & { name: string }): TableSchema {
	const declared: readonly ColumnSchema[] = [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		...(overrides.columns ?? []),
	]
	return { primary: 'id', indexes: [], ...overrides, columns: declared }
}

export function createReferenceLeakingDriver(): DriverInterface {
	return new ReferenceDriverFixture(false).driver
}

export function createDescendingKeyDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: inner.read.bind(inner),
		write: inner.write.bind(inner),
		insert: inner.insert.bind(inner),
		delete: inner.delete.bind(inner),
		async keys(table: string): Promise<readonly Key[]> {
			return [...(await inner.keys(table))].reverse()
		},
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
	}
}

export function createMismatchedMetadataDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: inner.read.bind(inner),
		write: inner.write.bind(inner),
		insert: inner.insert.bind(inner),
		delete: inner.delete.bind(inner),
		keys: (table) => inner.keys(table),
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		async metadata() {
			return { version: 99, schema: [] }
		},
		async stamp() {
			// Deliberately ignores the stamped value.
		},
	}
}

/**
 * Creates a Memory-backed driver whose list insert applies each row in turn, so a conflicting
 * final member leaves the rows ahead of it — the per-row batch a conformant driver refuses.
 *
 * @returns The driver
 */
export function createPartialBatchDriver(): DriverInterface {
	return new PartialBatchFixture().driver
}

export function createDoublyBrokenDriver(): DriverInterface {
	return new ReferenceDriverFixture(true).driver
}

export function createCrashingDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: inner.read.bind(inner),
		write: inner.write.bind(inner),
		insert: inner.insert.bind(inner),
		delete: inner.delete.bind(inner),
		keys: (table) => inner.keys(table),
		scan(): AsyncIterable<Row> {
			throw new Error('scan exploded')
		},
		clear: (table) => inner.clear(table),
	}
}

export type CursorUsers = TableInterface<CursorUserRow>
export type UserCursor = CursorInterface<CursorUserRow>

export type DatabaseEvent = 'open' | 'close' | 'transaction' | 'commit' | 'rollback'
export const DATABASE_EVENTS: readonly DatabaseEvent[] = [
	'open',
	'close',
	'transaction',
	'commit',
	'rollback',
]
export type MigrateEvent = 'migrate'
export const MIGRATE_EVENTS: readonly MigrateEvent[] = ['migrate']

/** Owns a physical-open fixture whose metadata becomes compatible on retry. */
export class ReopenDriverFixture {
	readonly #memory = createMemoryDriver()
	#schema: readonly TableSchema[] = []
	#metadata = 0
	#opens = 0

	get opens(): number {
		return this.#opens
	}

	get driver(): DriverInterface {
		return createMemoryAdapter(this.#memory, {
			open: this.#open.bind(this),
			metadata: this.#readMetadata.bind(this),
			async stamp() {},
		})
	}

	async #open(declared: readonly TableSchema[]): Promise<void> {
		this.#opens += 1
		this.#schema = declared
		await this.#memory.open(declared)
	}

	async #readMetadata(): Promise<DriverMetadata> {
		this.#metadata += 1
		return { version: this.#metadata === 1 ? 2 : 1, schema: this.#schema }
	}
}

export function userTable() {
	return createConstrainedUsersDatabase().users
}

export async function createSeededUsersTable() {
	const db = createDatabase({
		driver: createMemoryDriver(),
		tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
	})
	const users = db.table('users')
	await users.set([
		{ id: 'u1', name: 'Ada', age: 36 },
		{ id: 'u2', name: 'Bo', age: 41 },
		{ id: 'u3', name: 'Cy', age: 22 },
	])
	return users
}

export const HOOK_TABLES = { users: INTEGRATION_TABLES.users }

export type TableEvent = 'write' | 'remove' | 'clear'

export const TABLE_EVENTS: readonly TableEvent[] = ['write', 'remove', 'clear']

/** Creates metadata that records and rejects a version read. */
export function createHostileMetadata(
	reads: DatabaseCounter,
	declared: readonly TableSchema[],
	message: string,
): DriverMetadata {
	return {
		get version(): number {
			reads.next()
			throw new Error(message)
		},
		schema: declared,
	}
}

/** Creates migration input that records and rejects a metadata read. */
export function createHostileMigration(
	reads: DatabaseCounter,
	plan: Migration,
	message: string,
): MigrationInput {
	return {
		plan,
		get metadata(): DriverMetadata {
			reads.next()
			throw new Error(message)
		},
	}
}

/** Owns the reference leakage that the conformance fixtures deliberately expose. */
export class ReferenceDriverFixture {
	readonly #memory = createMemoryDriver()
	readonly #stored = new Map<Key, Row>()
	readonly #descending: boolean

	constructor(descending: boolean) {
		this.#descending = descending
	}

	get driver(): DriverInterface {
		return createMemoryAdapter(this.#memory, {
			write: this.#write.bind(this),
			read: this.#read.bind(this),
			keys: this.#keys.bind(this),
		})
	}

	// Keep each written row by reference, so a later caller change reaches the stored row.
	#write(table: string, keys: readonly Key[], rows: readonly Row[]): Promise<void>
	#write(table: string, key: Key, row: Row): Promise<void>
	async #write(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
	): Promise<void> {
		const entries = buildBatch(keys, rows)
		await this.#memory.write(
			table,
			entries.map(([key]) => key),
			entries.map(([, row]) => row),
		)
		for (const [key, row] of entries) this.#stored.set(key, row)
	}

	#read(table: string, key: Key): Promise<Row | undefined>
	#read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async #read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		if (!isArray(keys)) return this.#stored.get(keys) ?? this.#memory.read(table, keys)
		const rows = await this.#memory.read(table, keys)
		return keys.map((key, index) => this.#stored.get(key) ?? rows[index])
	}

	async #keys(table: string): Promise<readonly Key[]> {
		const keys = await this.#memory.keys(table)
		return this.#descending ? [...keys].reverse() : keys
	}
}

/** Owns a Memory driver whose list insert applies each row in turn. */
export class PartialBatchFixture {
	readonly #memory = createMemoryDriver()

	get driver(): DriverInterface {
		return createMemoryAdapter(this.#memory, { insert: this.#insert.bind(this) })
	}

	#insert(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	#insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async #insert(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		for (const [key, row] of buildBatch(keys, rows)) {
			await this.#memory.insert(table, key, row, options)
		}
	}
}

export const COLUMN = { name: 'id', storage: 'text', optional: false, nullable: false }
export const TABLE = {
	name: 'users',
	primary: 'id',
	columns: [COLUMN],
	indexes: [['id']],
}
export const STEP = { operation: 'column.remove', table: 'users', column: 'legacy' }
export const PLAN = { from: 1, to: 2, steps: [STEP] }
export const METADATA = { version: 2, schema: [TABLE] }

export const CONDITION_ROW = { name: 'Alice', age: 30, tag: null }

export const QUERY_ROW = { age: 30, role: 'admin' }

export const PAGE_ROWS = [
	{ id: 'a', n: 1 },
	{ id: 'b', n: 2 },
	{ id: 'c', n: 3 },
	{ id: 'd', n: 4 },
]

export const AGGREGATE_ROWS = [{ amount: 10 }, { amount: '20' }, { amount: 'x' }, { other: 1 }]

export const VALID_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
	indexes: [['id']],
}

export const MIGRATION_USERS = schema({
	name: 'users',
	columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
	indexes: [['name']],
})

export const FILTER_ROWS = [{ age: 30 }, { age: 12 }, { age: 45 }]

/**
 * Opens a driver on `CONFORMANCE_SCHEMA` and writes `CONFORMANCE_ROWS` into `users`.
 *
 * @param driver - The driver to seed
 */
export async function seedConformanceRows(driver: DriverInterface): Promise<void> {
	await driver.open(CONFORMANCE_SCHEMA)
	for (const row of CONFORMANCE_ROWS) {
		const key = extractKey(row, 'id')
		if (key !== undefined) await driver.write('users', key, row)
	}
}

// ── Query door fixtures ───────────────────────────────────────────────────────

/**
 * Holds the door table's columns: one per storage class, an optional and a nullable `text`
 * column, a `json` column, and a literal whose members span two classes, which is `json`.
 */
export const DOOR_COLUMNS = {
	id: stringShape(),
	n: integerShape(),
	label: stringShape(),
	flag: booleanShape(),
	note: optionalShape(stringShape()),
	tag: nullableShape(stringShape()),
	meta: jsonShape(),
	mode: literalShape(['a', 1]),
}

/** Represents one row of the door table. */
export type DoorRow = RowOf<typeof DOOR_COLUMNS>

/** Holds the door table's rows: `a` lacks `note` and holds a `null` tag. */
export const DOOR_ROWS: readonly DoorRow[] = Object.freeze([
	{ id: 'a', n: 5, label: '5', flag: true, tag: null, meta: { x: 1 }, mode: 'a' },
	{ id: 'b', n: 7, label: '07', flag: false, note: 'n', tag: 't', meta: { x: 2 }, mode: 1 },
])

/**
 * Creates the door table over a {@link StorageRecorder} on a real driver, seeded with
 * {@link DOOR_ROWS}, so a test reads the driver calls a refused read makes.
 *
 * @param driver - The driver to record. Default: a fresh Memory driver
 * @returns The recorder and the seeded table
 */
export async function createDoorTable(driver: DriverInterface = createMemoryDriver()): Promise<{
	readonly recorder: StorageRecorder
	readonly table: TableInterface<DoorRow>
}> {
	const recorder = new StorageRecorder(driver)
	const table = createDatabase({ driver: recorder.driver, tables: { items: DOOR_COLUMNS } }).table(
		'items',
	)
	await table.set(DOOR_ROWS)
	return { recorder, table }
}

/**
 * Shapes one read the door refuses: the read, the first fault its refusal carries, its second
 * fault when it carries two, and the column and operator the refusal names when it names them.
 */
export interface RefusedRead {
	readonly name: string
	readonly input: unknown
	readonly fault: Readonly<Record<string, unknown>>
	readonly second?: Readonly<Record<string, unknown>>
	readonly column?: string
	readonly operator?: string
}

/**
 * Lists the reads the door refuses: each case of the 0.0.24 door and affinity readings, and one
 * case per refusal class of the table's columns.
 */
export const REFUSED_READS: readonly RefusedRead[] = Object.freeze([
	{
		name: 'a misspelled column under absent',
		input: { conditions: [{ column: 'tga', operator: 'absent', values: [], connector: 'and' }] },
		fault: {
			reason: 'type',
			path: ['conditions', '0', 'column'],
			expected: 'literal',
			received: '"tga"',
		},
		operator: 'absent',
	},
	{
		name: 'a misspelled column under equals',
		input: { conditions: [{ column: 'tga', operator: 'equals', values: ['x'], connector: 'and' }] },
		fault: { reason: 'type', path: ['conditions', '0', 'column'], expected: 'literal' },
		operator: 'equals',
	},
	{
		name: 'an unknown operator',
		input: {
			conditions: [{ column: 'label', operator: 'similar', values: ['x'], connector: 'and' }],
		},
		fault: { reason: 'variant', path: ['conditions', '0'], key: 'operator' },
	},
	{
		name: 'between with one operand',
		input: {
			conditions: [{ column: 'label', operator: 'between', values: ['a'], connector: 'and' }],
		},
		fault: {
			reason: 'constraint',
			path: ['conditions', '0', 'values'],
			constraint: 'min',
			limit: 2,
		},
	},
	{
		name: 'a string operand on an integer column',
		input: { conditions: [{ column: 'n', operator: 'equals', values: ['5'], connector: 'and' }] },
		fault: {
			reason: 'type',
			path: ['conditions', '0', 'values', '0'],
			expected: 'number',
			received: '"5"',
		},
		column: 'n',
		operator: 'equals',
	},
	{
		name: 'a string bound on an integer column',
		input: { conditions: [{ column: 'n', operator: 'above', values: ['6'], connector: 'and' }] },
		fault: { reason: 'type', path: ['conditions', '0', 'values', '0'], expected: 'number' },
		column: 'n',
		operator: 'above',
	},
	{
		name: 'a number operand on a text column',
		input: { conditions: [{ column: 'label', operator: 'equals', values: [5], connector: 'and' }] },
		fault: {
			reason: 'type',
			path: ['conditions', '0', 'values', '0'],
			expected: 'string',
			received: '5',
		},
		column: 'label',
		operator: 'equals',
	},
	{
		name: 'a list operand in an any list on an integer column',
		input: { conditions: [{ column: 'n', operator: 'any', values: [['5']], connector: 'and' }] },
		fault: { reason: 'type', path: ['conditions', '0', 'values', '0'], expected: 'number' },
		column: 'n',
		operator: 'any',
	},
	{
		name: 'a boolean operand on an integer column',
		input: { conditions: [{ column: 'n', operator: 'equals', values: [true], connector: 'and' }] },
		fault: {
			reason: 'type',
			path: ['conditions', '0', 'values', '0'],
			expected: 'number',
			received: 'true',
		},
		column: 'n',
		operator: 'equals',
	},
	{
		name: 'null on a column that is not nullable',
		input: {
			conditions: [{ column: 'label', operator: 'equals', values: [null], connector: 'and' }],
		},
		fault: {
			reason: 'type',
			path: ['conditions', '0', 'values', '0'],
			expected: 'string',
			received: 'null',
		},
		column: 'label',
		operator: 'equals',
	},
	{
		name: 'null under a range operator on a nullable column',
		input: { conditions: [{ column: 'tag', operator: 'above', values: [null], connector: 'and' }] },
		fault: {
			reason: 'type',
			path: ['conditions', '0', 'values', '0'],
			expected: 'string',
			received: 'null',
		},
		column: 'tag',
		operator: 'above',
	},
	{
		name: 'undefined on a column that is not optional',
		input: {
			conditions: [{ column: 'label', operator: 'not', values: [undefined], connector: 'and' }],
		},
		fault: { reason: 'type', path: ['conditions', '0', 'values', '0'], received: 'undefined' },
		column: 'label',
		operator: 'not',
	},
	{
		name: 'undefined under a range operator on an optional column',
		input: {
			conditions: [{ column: 'note', operator: 'from', values: [undefined], connector: 'and' }],
		},
		fault: {
			reason: 'type',
			path: ['conditions', '0', 'values', '0'],
			expected: 'json',
			received: 'undefined',
		},
	},
	{
		name: 'a pattern operator on an integer column',
		input: { conditions: [{ column: 'n', operator: 'like', values: ['5%'], connector: 'and' }] },
		fault: {
			reason: 'constraint',
			path: ['conditions', '0', 'operator'],
			constraint: 'pattern',
			limit: 'a text or json column',
			received: '"like"',
		},
		column: 'n',
		operator: 'like',
	},
	{
		name: 'a nested path under a text column',
		input: {
			conditions: [{ column: ['label', 'x'], operator: 'equals', values: [1], connector: 'and' }],
		},
		fault: { reason: 'type', path: ['conditions', '0', 'column'], expected: 'string' },
		column: 'label',
		operator: 'equals',
	},
	{
		name: 'a one-key path holding the wrong class',
		input: { conditions: [{ column: ['n'], operator: 'equals', values: ['5'], connector: 'and' }] },
		fault: { reason: 'type', path: ['conditions', '0', 'values', '0'], expected: 'number' },
		column: 'n',
		operator: 'equals',
	},
	{
		name: 'an ill-formed text operand',
		input: {
			conditions: [{ column: 'label', operator: 'starts', values: ['a\uD800'], connector: 'and' }],
		},
		fault: {
			reason: 'constraint',
			path: ['conditions', '0', 'values', '0'],
			constraint: 'pattern',
		},
		column: 'label',
		operator: 'starts',
	},
	{
		name: 'an undeclared order column',
		input: { order: [{ column: 'nn', direction: 'ascending' }] },
		fault: {
			reason: 'type',
			path: ['order', '0', 'column'],
			expected: 'literal',
			received: '"nn"',
		},
	},
	{
		name: 'an ill-formed text operand under a json path',
		input: {
			conditions: [
				{ column: ['meta', 'x'], operator: 'equals', values: ['\uD800'], connector: 'and' },
			],
		},
		fault: {
			reason: 'constraint',
			path: ['conditions', '0', 'values', '0'],
			constraint: 'pattern',
		},
		column: 'meta',
		operator: 'equals',
	},
	{
		name: 'a non-string pattern operand',
		input: { conditions: [{ column: 'label', operator: 'like', values: [5], connector: 'and' }] },
		fault: { path: ['conditions', '0', 'values', '0'] },
	},
	{
		name: 'an empty column path',
		input: { conditions: [{ column: [], operator: 'present', values: [], connector: 'and' }] },
		fault: { path: ['conditions', '0', 'column'] },
	},
	{
		name: 'an unknown connector',
		input: { conditions: [{ column: 'n', operator: 'present', values: [], connector: 'xor' }] },
		fault: { path: ['conditions', '0', 'connector'] },
	},
	{
		name: 'an unknown direction',
		input: { order: [{ column: 'n', direction: 'up' }] },
		fault: { path: ['order', '0', 'direction'] },
	},
	{
		name: 'a negative limit',
		input: { limit: -1 },
		fault: { reason: 'constraint', path: ['limit'], constraint: 'min' },
	},
	{
		name: 'a fractional offset',
		input: { offset: 1.5 },
		fault: { path: ['offset'] },
	},
	{
		name: 'a null read',
		input: null,
		fault: { reason: 'type', expected: 'object', received: 'null' },
	},
	{
		name: 'an unknown operator beside a wrong-class operand, each fault once',
		input: {
			conditions: [
				{ column: 'n', operator: 'similar', values: ['x'], connector: 'and' },
				{ column: 'n', operator: 'equals', values: ['5'], connector: 'and' },
			],
		},
		fault: { reason: 'variant', path: ['conditions', '0'], key: 'operator' },
		second: {
			reason: 'type',
			path: ['conditions', '1', 'values', '0'],
			expected: 'number',
			received: '"5"',
		},
		column: 'n',
	},
	{
		name: 'a misspelled read key',
		input: { condtions: [] },
		fault: { reason: 'extra', path: ['condtions'] },
	},
])

/**
 * Shapes one read the door admits, with the ids of the door rows it reads.
 */
export interface AdmittedRead {
	readonly name: string
	readonly input: QueryInput
	readonly ids: readonly string[]
}

/** Lists the reads the door admits at the edges of each refusal class. */
export const ADMITTED_READS: readonly AdmittedRead[] = Object.freeze([
	{
		name: 'undefined on an optional column',
		input: {
			conditions: [{ column: 'note', operator: 'equals', values: [undefined], connector: 'and' }],
		},
		ids: ['a'],
	},
	{
		name: 'null on a nullable column',
		input: {
			conditions: [{ column: 'tag', operator: 'equals', values: [null], connector: 'and' }],
		},
		ids: ['a'],
	},
	{
		name: 'null and a string in an any list on a nullable column',
		input: {
			conditions: [{ column: 'tag', operator: 'any', values: [null, 't'], connector: 'and' }],
		},
		ids: ['a', 'b'],
	},
	{
		name: 'a nested path under a json column',
		input: {
			conditions: [{ column: ['meta', 'x'], operator: 'equals', values: [2], connector: 'and' }],
		},
		ids: ['b'],
	},
	{
		name: 'any operand on a json column',
		input: {
			conditions: [{ column: 'meta', operator: 'equals', values: [{ x: 1 }], connector: 'and' }],
		},
		ids: ['a'],
	},
	{
		name: 'a number on a literal spanning two classes',
		input: { conditions: [{ column: 'mode', operator: 'equals', values: [1], connector: 'and' }] },
		ids: ['b'],
	},
	{
		name: 'a pattern on a text column',
		input: {
			conditions: [{ column: 'label', operator: 'like', values: ['0%'], connector: 'and' }],
		},
		ids: ['b'],
	},
	{
		name: 'a one-key path holding its class',
		input: {
			conditions: [{ column: ['n'], operator: 'between', values: [1, 6], connector: 'and' }],
		},
		ids: ['a'],
	},
	{
		name: 'a boolean on a boolean column, ordered and paged',
		input: {
			conditions: [{ column: 'flag', operator: 'equals', values: [false], connector: 'or' }],
			order: [{ column: 'n', direction: 'descending' }],
			limit: 1,
		},
		ids: ['b'],
	},
])

/** Shapes one public read a door case runs through: records, count, aggregate, scan, or a query. */
export interface DoorPath {
	readonly name: string
	readonly run: (table: TableInterface<DoorRow>, input: unknown) => Promise<unknown>
}

/**
 * Lists every public read of a table and a query, each passing its input untyped, as a client
 * that authors a read does.
 */
export const DOOR_PATHS: readonly DoorPath[] = Object.freeze([
	{ name: 'records', run: (table, input) => Reflect.apply(table.records, table, [input]) },
	{ name: 'count', run: (table, input) => Reflect.apply(table.count, table, [input]) },
	{
		name: 'aggregate',
		run: (table, input) => Reflect.apply(table.aggregate, table, ['sum', 'n', input]),
	},
	{ name: 'scan', run: (table, input) => collect(Reflect.apply(table.scan, table, [input])) },
	{ name: 'query collect', run: (table, input) => buildDoorQuery(table, input).collect() },
	{ name: 'query count', run: (table, input) => buildDoorQuery(table, input).count() },
	{ name: 'query stream', run: (table, input) => collect(buildDoorQuery(table, input).stream()) },
	{
		name: 'query aggregate',
		run: (table, input) => buildDoorQuery(table, input).aggregate('maximum', 'n'),
	},
	{
		name: 'query aggregate after a filter',
		run: (table, input) =>
			buildDoorQuery(table, input)
				.filter(() => true)
				.aggregate('maximum', 'n'),
	},
])

/**
 * Builds a query over the door table from an untyped read: each listed condition and ordering
 * term passes through the builder as authored. A read with no list builds an empty query, so a
 * case whose fault sits outside the lists reaches the door through the table's reads alone.
 *
 * @param table - The door table
 * @param input - The authored read
 * @returns The query
 */
export function buildDoorQuery(
	table: TableInterface<DoorRow>,
	input: unknown,
): QueryInterface<DoorRow> {
	const query = table.query()
	const conditions: unknown = isRecord(input) ? input.conditions : undefined
	const order: unknown = isRecord(input) ? input.order : undefined
	for (const condition of isArray(conditions) ? conditions : []) {
		Reflect.apply(query.condition, query, [condition])
	}
	for (const term of isArray(order) ? order : []) Reflect.apply(query.order, query, [term])
	return query
}

/** Shapes one operator's arity: the operand lists the query shape admits and refuses for it. */
export interface OperatorArity {
	readonly operator: string
	readonly admitted: ReadonlyArray<readonly unknown[]>
	readonly refused: ReadonlyArray<readonly unknown[]>
}

/** Lists every condition operator with operand lists on each side of its arity. */
export const OPERATOR_ARITIES: readonly OperatorArity[] = Object.freeze([
	{ operator: 'absent', admitted: [[]], refused: [[null]] },
	{ operator: 'present', admitted: [[]], refused: [[1]] },
	{ operator: 'equals', admitted: [[1], [null], [{ a: 1 }]], refused: [[], [1, 2]] },
	{ operator: 'not', admitted: [['x']], refused: [[], ['x', 'y']] },
	{ operator: 'above', admitted: [[1]], refused: [[], [1, 2]] },
	{ operator: 'below', admitted: [[1]], refused: [[]] },
	{ operator: 'from', admitted: [[1]], refused: [[1, 2]] },
	{ operator: 'to', admitted: [[1]], refused: [[]] },
	{ operator: 'between', admitted: [[1, 2]], refused: [[1], [1, 2, 3], []] },
	{ operator: 'like', admitted: [['a%']], refused: [[], [1], ['a', 'b']] },
	{ operator: 'glob', admitted: [['a*']], refused: [[null]] },
	{ operator: 'starts', admitted: [['a']], refused: [[true]] },
	{ operator: 'ends', admitted: [['z']], refused: [[]] },
	{ operator: 'any', admitted: [[], [1], [1, 'a', null]], refused: [] },
	{ operator: 'none', admitted: [[], ['a', 'b']], refused: [] },
])

/** Shapes one keyed call that carries an ill-formed key. */
export interface IllFormedKey {
	readonly name: string
	readonly run: (table: TableInterface<DoorRow>) => Promise<unknown>
}

/** Lists each keyed call of a table, every one carrying a key with a lone surrogate. */
export const ILL_FORMED_KEYS: readonly IllFormedKey[] = Object.freeze([
	{ name: 'get', run: (table) => table.get('a\uD800') },
	{ name: 'get of a list', run: (table) => table.get(['a', '\uDBFFz']) },
	{ name: 'resolve', run: (table) => table.resolve('\uD800') },
	{ name: 'has', run: (table) => table.has(['\uD800']) },
	{ name: 'update', run: (table) => table.update(['\uD800'], { n: 1 }) },
	{ name: 'remove', run: (table) => table.remove('\uD800') },
	{
		name: 'a written key',
		run: (table) =>
			table.add({ id: '\uD800', n: 1, label: 'x', flag: true, tag: null, meta: {}, mode: 'a' }),
	},
])

// ── Bench fixtures ────────────────────────────────────────────────────────────

/** Holds the columns of the bench table: a client-shaped row of keys, text, numbers, and flags. */
export const BENCH_COLUMNS = {
	id: stringShape(),
	organization: stringShape(),
	rank: integerShape(),
	body: stringShape(),
	active: booleanShape(),
	note: optionalShape(stringShape()),
}

/**
 * Builds bench rows: unique keys, a low-cardinality organization, a skewed rank, text of varied
 * width, alternating flags, and a note on every third row.
 *
 * @param count - The number of rows
 * @returns The rows, keyed `k0` onward
 */
export function buildBenchRows(count: number): ReadonlyArray<RowOf<typeof BENCH_COLUMNS>> {
	return Array.from({ length: count }, (_, index) => ({
		id: `k${index}`,
		organization: `o${index % 40}`,
		rank: Math.floor(Math.sqrt(index * 97)),
		body: 'x'.repeat(24 + (index % 176)),
		active: index % 2 === 0,
		...(index % 3 === 0 ? { note: 'n' } : {}),
	}))
}

/** Holds a read of ten conditions over the bench table, one per kind of check the door makes. */
export const TEN_CONDITIONS: QueryInput = Object.freeze<QueryInput>({
	conditions: [
		{ column: 'organization', operator: 'equals', values: ['o3'], connector: 'and' },
		{ column: 'rank', operator: 'above', values: [10], connector: 'and' },
		{ column: 'rank', operator: 'between', values: [1, 900], connector: 'and' },
		{ column: 'body', operator: 'like', values: ['x%'], connector: 'and' },
		{ column: 'active', operator: 'equals', values: [true], connector: 'and' },
		{
			column: 'id',
			operator: 'any',
			values: ['k3', 'k43', 'k83', 'k123', 'k163'],
			connector: 'and',
		},
		{ column: 'organization', operator: 'starts', values: ['o'], connector: 'and' },
		{ column: 'rank', operator: 'to', values: [100000], connector: 'and' },
		{ column: 'note', operator: 'not', values: ['m'], connector: 'and' },
		{ column: 'body', operator: 'present', values: [], connector: 'and' },
	],
})

/** Represents the members of a published database build a bench drives. */
export interface DatabaseModule {
	readonly createDatabase: typeof createDatabase
	readonly createMemoryDriver: typeof createMemoryDriver
}

/**
 * Checks whether a loaded module carries the members a bench drives, as functions.
 *
 * @remarks
 * A loaded module is foreign: the check reads that each member is a function and cannot read
 * its signature, which the published build's declarations state.
 *
 * @param value - The loaded module
 * @returns True if both members are functions; false otherwise
 */
export function isDatabaseModule(value: unknown): value is DatabaseModule {
	return isRecord(value) && isFunction(value.createDatabase) && isFunction(value.createMemoryDriver)
}

/**
 * Shapes one read of the parity suites' `users` table that the door refuses on every engine:
 * its one condition, and the column, operator, and first fault its refusal names.
 */
export interface RefusedParityRead {
	readonly name: string
	readonly condition: Condition
	readonly column: string
	readonly operator: string
	readonly fault: Readonly<Record<string, unknown>>
}

/**
 * Lists the wrong-class reads of the parity suites, each of which the door refuses before any
 * engine answers it: a pattern on an integer column, a mixed-class list, and an operand of
 * another class.
 */
export const REFUSED_PARITY_READS: readonly RefusedParityRead[] = Object.freeze([
	{
		name: 'like against a non-string (age) column',
		condition: { column: 'age', operator: 'like', values: ['%3%'], connector: 'and' },
		column: 'age',
		operator: 'like',
		fault: {
			path: ['conditions', '0', 'operator'],
			constraint: 'pattern',
			limit: 'a text or json column',
			received: '"like"',
		},
	},
	{
		name: 'glob against a non-string (age) column',
		condition: { column: 'age', operator: 'glob', values: ['*3*'], connector: 'and' },
		column: 'age',
		operator: 'glob',
		fault: {
			path: ['conditions', '0', 'operator'],
			constraint: 'pattern',
			limit: 'a text or json column',
			received: '"glob"',
		},
	},
	{
		name: 'any with a mixed-type list',
		condition: { column: 'age', operator: 'any', values: [36, 'nope', 0], connector: 'and' },
		column: 'age',
		operator: 'any',
		fault: { path: ['conditions', '0', 'values', '1'], expected: 'number', received: '"nope"' },
	},
	{
		name: 'none with a mixed-type list',
		condition: { column: 'age', operator: 'none', values: [36, 'nope', 0], connector: 'and' },
		column: 'age',
		operator: 'none',
		fault: { path: ['conditions', '0', 'values', '1'], expected: 'number', received: '"nope"' },
	},
	{
		name: 'equals with a string operand on an integer column',
		condition: { column: 'age', operator: 'equals', values: ['36'], connector: 'and' },
		column: 'age',
		operator: 'equals',
		fault: { path: ['conditions', '0', 'values', '0'], expected: 'number', received: '"36"' },
	},
	{
		name: 'above with a string operand on an integer column',
		condition: { column: 'age', operator: 'above', values: ['18'], connector: 'and' },
		column: 'age',
		operator: 'above',
		fault: { path: ['conditions', '0', 'values', '0'], expected: 'number', received: '"18"' },
	},
	{
		name: 'equals with a number operand on a text column',
		condition: { column: 'name', operator: 'equals', values: [36], connector: 'and' },
		column: 'name',
		operator: 'equals',
		fault: { path: ['conditions', '0', 'values', '0'], expected: 'string', received: '36' },
	},
])

/** Represents a `DatabaseError` rejection as its code and context. */
export interface CapturedRefusal {
	readonly code: string
	readonly context: Readonly<Record<string, unknown>> | undefined
}

/** Represents what a table does with a lone surrogate on one driver: each refusal, and the json cell. */
export interface IllFormedResult {
	readonly text: CapturedRefusal | undefined
	readonly key: CapturedRefusal | undefined
	readonly operand: CapturedRefusal | undefined
	readonly calls: number
	readonly json: unknown
}

/**
 * Holds the result every driver gives, for a partial match: three `VALIDATION` refusals naming
 * the table and the column, no driver call, and the json cell intact.
 */
export const ILL_FORMED_RESULT: IllFormedResult = Object.freeze({
	text: { code: 'VALIDATION', context: { table: 'items', column: 'label' } },
	key: { code: 'VALIDATION', context: { table: 'items', column: 'id' } },
	operand: {
		code: 'VALIDATION',
		context: {
			table: 'items',
			column: 'label',
			operator: 'equals',
			faults: [{ path: ['conditions', '0', 'values', '0'], constraint: 'pattern' }],
		},
	},
	calls: 0,
	json: { text: 'a\uD800b' },
})

/**
 * Settles an operation and captures its `DatabaseError` rejection as the error's code and context.
 *
 * @param operation - The operation to settle
 * @returns The code and context of the rejection, or `undefined` when the operation fulfills
 * @throws The rejection itself when it is no `DatabaseError`
 */
export async function captureRefusal(
	operation: Promise<unknown>,
): Promise<CapturedRefusal | undefined> {
	const error = await operation.then(
		() => undefined,
		(caught: unknown) => caught,
	)
	if (error === undefined) return undefined
	if (!isDatabaseError(error)) throw error
	return { code: error.code, context: error.context }
}

/**
 * Reads what a seeded door table does with a lone surrogate in a written text value, a key, and
 * a text operand, and whether a json cell holding one reads back unchanged.
 *
 * @param table - The door table, seeded with {@link DOOR_ROWS}
 * @param recorder - The recorder over the table's driver
 * @returns The result
 */
export async function readIllFormedText(
	table: TableInterface<DoorRow>,
	recorder: StorageRecorder,
): Promise<IllFormedResult> {
	const [row] = DOOR_ROWS
	if (row === undefined) throw new Error('The door table has no rows')
	const { value, calls } = await recorder.measure(async () => ({
		text: await captureRefusal(table.set({ ...row, id: 'c', label: 'a\uD800b' })),
		key: await captureRefusal(table.get('\uD800')),
		operand: await captureRefusal(
			table.records({
				conditions: [{ column: 'label', operator: 'equals', values: ['\uDC00'], connector: 'and' }],
			}),
		),
	}))
	await table.set({ ...row, id: 'j', meta: { text: 'a\uD800b' } })
	return { ...value, calls: calls.length, json: (await table.get('j'))?.meta }
}

/**
 * Holds a driver's scan until a test releases it, and reports when the scan starts, so a test acts
 * between a read's admission and its rows.
 */
export class ScanGate {
	readonly #started = Promise.withResolvers<void>()
	readonly #released = Promise.withResolvers<void>()

	get started(): Promise<void> {
		return this.#started.promise
	}

	/** Lets every held scan yield its rows. */
	release(): void {
		this.#released.resolve()
	}

	/**
	 * Yields a scan's rows after the gate is released, reporting the start first.
	 *
	 * @param source - The rows to hold
	 * @yields Each row of the source
	 */
	async *scan(source: AsyncIterable<Row>): AsyncIterable<Row> {
		this.#started.resolve()
		await this.#released.promise
		yield* source
	}
}

/**
 * Forwards every required member to a Memory driver and logs the form each keyed call arrived in,
 * `single` or `list`, so a test reads what a wrapping storage forwarded.
 */
export class FormStorage implements StorageInterface {
	readonly #memory: DriverInterface
	readonly #forms: string[] = []

	constructor(memory: DriverInterface) {
		this.#memory = memory
	}

	get forms(): readonly string[] {
		return [...this.#forms]
	}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		this.#forms.push(`read ${isArray(keys) ? 'list' : 'single'}`)
		return isArray(keys) ? this.#memory.read(table, keys) : this.#memory.read(table, keys)
	}

	write(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	write(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		this.#forms.push(`write ${isArray(keys) ? 'list' : 'single'}`)
		const entries = buildBatch(keys, rows)
		return this.#memory.write(
			table,
			entries.map(([key]) => key),
			entries.map(([, row]) => row),
			options,
		)
	}

	insert(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	insert(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		this.#forms.push(`insert ${isArray(keys) ? 'list' : 'single'}`)
		const entries = buildBatch(keys, rows)
		return this.#memory.insert(
			table,
			entries.map(([key]) => key),
			entries.map(([, row]) => row),
			options,
		)
	}

	delete(table: string, key: Key, options?: OperationOptions): Promise<boolean>
	delete(
		table: string,
		keys: readonly Key[],
		options?: OperationOptions,
	): Promise<readonly boolean[]>
	delete(
		table: string,
		keys: Key | readonly Key[],
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		this.#forms.push(`delete ${isArray(keys) ? 'list' : 'single'}`)
		return isArray(keys)
			? this.#memory.delete(table, keys, options)
			: this.#memory.delete(table, keys, options)
	}

	keys(table: string): Promise<readonly Key[]> {
		return this.#memory.keys(table)
	}

	scan(table: string): AsyncIterable<Row> {
		return this.#memory.scan(table)
	}

	clear(table: string): Promise<void> {
		return this.#memory.clear(table)
	}
}

/** Shapes one aggregate the door refuses: its operation, its column, and the faults it carries. */
export interface RefusedAggregate {
	readonly operation: unknown
	readonly column: unknown
	readonly faults: ReadonlyArray<Readonly<Record<string, unknown>>>
}

/** Lists the aggregates the door refuses: an unknown operation, and a missing or malformed column. */
export const REFUSED_AGGREGATES: readonly RefusedAggregate[] = Object.freeze([
	{
		operation: 'median',
		column: 'n',
		faults: [{ path: ['aggregate', 'operation'], expected: 'literal', received: '"median"' }],
	},
	{
		operation: 'sum',
		column: undefined,
		faults: [{ path: ['aggregate', 'column'], expected: 'string', received: 'undefined' }],
	},
	{
		operation: 'sum',
		column: [],
		faults: [{ path: ['aggregate', 'column'], expected: 'string', received: 'array' }],
	},
	{
		operation: 'maximum',
		column: 7,
		faults: [{ path: ['aggregate', 'column'], expected: 'string', received: '7' }],
	},
])

/**
 * Yields rows and then throws, as a source that fails part way through a read does.
 *
 * @param rows - The rows to yield first
 * @param message - The message of the error thrown after the last row
 * @yields Each row
 */
export async function* streamThenFail(rows: readonly Row[], message: string): AsyncIterable<Row> {
	yield* rows
	throw new Error(message)
}
