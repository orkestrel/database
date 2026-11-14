// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`setupFiles[0]`). Keep this file free of `node:*` and of
// `document` / `window`: node-only helpers live in `setupServer.ts`.

import type { Result } from '@orkestrel/contract'
import { DatabaseContext } from '../src/core/DatabaseContext.js'
import { DatabaseTransaction } from '../src/core/DatabaseTransaction.js'
import { TransactionScope } from '../src/core/TransactionScope.js'
import type {
	StorageInterface,
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
	createContract,
	integerShape,
	isArray,
	literalShape,
	objectShape,
	stringShape,
} from '@orkestrel/contract'
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
	buildBatch,
	MemoryDriver,
	requireColumns,
	StorageJournal,
	StreamPage,
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

/** Names a {@link StorageInterface} member a {@link StorageRecorder} observes. */
export type StorageMember =
	| 'read'
	| 'write'
	| 'insert'
	| 'delete'
	| 'keys'
	| 'scan'
	| 'clear'
	| 'plan'
	| 'records'
	| 'stream'
	| 'aggregate'

/** Shapes one driver call a {@link StorageRecorder} observed: the member, the keys it addressed, and the rows it returned. */
export interface StorageCall {
	readonly member: StorageMember
	readonly keys: number
	readonly rows: number
	readonly scoped: boolean
}

/** Shapes the calls, addressed keys, and returned rows of one member across a slice of a recorder's log. */
export interface StorageTally {
	readonly calls: number
	readonly keys: number
	readonly rows: number
}

/**
 * Totals the calls, addressed keys, and returned rows of one member across recorded calls.
 *
 * @param calls - The recorded calls to read
 * @param member - The member to total
 * @returns The member's call count, key total, and row total
 */
export function tallyCalls(calls: readonly StorageCall[], member: StorageMember): StorageTally {
	const matched = calls.filter((call) => call.member === member)
	return {
		calls: matched.length,
		keys: matched.reduce((total, call) => total + call.keys, 0),
		rows: matched.reduce((total, call) => total + call.rows, 0),
	}
}

/**
 * Wraps a real storage's required members and appends one {@link StorageCall} per call to a
 * recorder's log, keeping the keyed members' single and list overloads.
 */
export class RecordedStorage implements StorageInterface {
	readonly #storage: StorageInterface
	readonly #scoped: boolean
	readonly #calls: StorageCall[]

	constructor(storage: StorageInterface, scoped: boolean, calls: StorageCall[]) {
		this.#storage = storage
		this.#scoped = scoped
		this.#calls = calls
	}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		if (!isArray(keys)) {
			const row = await this.#storage.read(table, keys)
			this.#record('read', 1, row === undefined ? 0 : 1)
			return row
		}
		const rows = await this.#storage.read(table, keys)
		this.#record('read', keys.length, rows.filter((row) => row !== undefined).length)
		return rows
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
		await this.#storage.write(
			table,
			entries.map(([key]) => key),
			entries.map(([, row]) => row),
			options,
		)
		this.#record('write', entries.length, 0)
	}

	insert(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async insert(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		const entries = buildBatch(keys, rows)
		await this.#storage.insert(
			table,
			entries.map(([key]) => key),
			entries.map(([, row]) => row),
			options,
		)
		this.#record('insert', entries.length, 0)
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
		return applyKeys(keys, async (listed) => {
			const removed = await this.#storage.delete(table, listed, options)
			this.#record('delete', listed.length, 0)
			return removed
		})
	}

	async keys(table: string): Promise<readonly Key[]> {
		const keys = await this.#storage.keys(table)
		this.#record('keys', 0, 0)
		return keys
	}

	scan(table: string): AsyncIterable<Row> {
		return iterateRecorded(this.#storage.scan(table), (rows) => this.#record('scan', 0, rows))
	}

	async clear(table: string): Promise<void> {
		await this.#storage.clear(table)
		this.#record('clear', 0, 0)
	}

	#record(member: StorageMember, keys: number, rows: number): void {
		this.#calls.push({ member, keys, rows, scoped: this.#scoped })
	}
}

/**
 * Yields a source's rows and reports how many it yielded when the consumer stops or the
 * source ends.
 *
 * @param source - The rows to pass through
 * @param report - Receives the count of rows yielded
 * @yields Each row of the source
 */
export async function* iterateRecorded(
	source: AsyncIterable<Row>,
	report: (rows: number) => void,
): AsyncIterable<Row> {
	const counter = new StreamPage(0)
	try {
		for await (const row of source) {
			counter.next()
			yield row
		}
	} finally {
		report(counter.count)
	}
}

/**
 * Wraps a real driver and records the keys each storage member addresses and the rows it
 * returns, inside a transaction scope too — the rows-read instrument of the native-first
 * acceptance readings.
 */
export class StorageRecorder {
	readonly #source: DriverInterface
	readonly #driver: DriverInterface
	readonly #calls: StorageCall[] = []

	constructor(source: DriverInterface) {
		this.#source = source
		this.#driver = this.#root(source)
	}

	get driver(): DriverInterface {
		return this.#driver
	}

	get source(): DriverInterface {
		return this.#source
	}

	get calls(): readonly StorageCall[] {
		return this.#calls
	}

	/**
	 * Runs one operation and returns its value with the driver calls it made.
	 *
	 * @param operation - The operation to observe
	 * @returns The operation's value and the calls recorded while it ran
	 */
	async measure<R>(
		operation: () => Promise<R>,
	): Promise<{ readonly value: R; readonly calls: readonly StorageCall[] }> {
		const mark = this.#calls.length
		const value = await operation()
		return { value, calls: this.#calls.slice(mark) }
	}

	#root(source: DriverInterface): DriverInterface {
		const base: DriverInterface = {
			...this.#wrap(source, false),
			open: source.open.bind(source),
			close: source.close.bind(source),
		}
		if (source.transaction === undefined) return base
		return {
			...base,
			transaction: <R>(scope: (storage: StorageInterface) => Promise<R>): Promise<R> =>
				this.#transaction(source, scope),
		}
	}

	#wrap(storage: StorageInterface, scoped: boolean): StorageInterface {
		const recorded = new RecordedStorage(storage, scoped, this.#calls)
		return {
			read: recorded.read.bind(recorded),
			write: recorded.write.bind(recorded),
			insert: recorded.insert.bind(recorded),
			delete: recorded.delete.bind(recorded),
			keys: recorded.keys.bind(recorded),
			scan: recorded.scan.bind(recorded),
			clear: recorded.clear.bind(recorded),
			...(storage.migrate === undefined ? {} : { migrate: storage.migrate.bind(storage) }),
			...(storage.metadata === undefined ? {} : { metadata: storage.metadata.bind(storage) }),
			...(storage.stamp === undefined ? {} : { stamp: storage.stamp.bind(storage) }),
			...(storage.plan === undefined ? {} : { plan: this.#plan.bind(this, storage, scoped) }),
			...(storage.records === undefined
				? {}
				: { records: this.#records.bind(this, storage, scoped) }),
			...(storage.stream === undefined ? {} : { stream: this.#stream.bind(this, storage, scoped) }),
			...(storage.aggregate === undefined
				? {}
				: { aggregate: this.#aggregate.bind(this, storage, scoped) }),
		}
	}

	#transaction<R>(
		source: DriverInterface,
		scope: (storage: StorageInterface) => Promise<R>,
	): Promise<R> {
		if (source.transaction === undefined) throw new Error('The source declares no transaction')
		return source.transaction((storage) => scope(this.#wrap(storage, true)))
	}

	#plan(storage: StorageInterface, scoped: boolean, table: string, input: ReadInput): ReadPlan {
		if (storage.plan === undefined) throw new Error('The storage declares no plan')
		const split = storage.plan(table, input)
		this.#calls.push({ member: 'plan', keys: 0, rows: 0, scoped })
		return split
	}

	async #records(
		storage: StorageInterface,
		scoped: boolean,
		table: string,
		input: QueryInput,
	): Promise<readonly Row[]> {
		if (storage.records === undefined) throw new Error('The storage declares no records')
		const rows = await storage.records(table, input)
		this.#calls.push({ member: 'records', keys: 0, rows: rows.length, scoped })
		return rows
	}

	#stream(
		storage: StorageInterface,
		scoped: boolean,
		table: string,
		input: QueryInput,
	): AsyncIterable<Row> {
		if (storage.stream === undefined) throw new Error('The storage declares no stream')
		return iterateRecorded(storage.stream(table, input), (rows) => {
			this.#calls.push({ member: 'stream', keys: 0, rows, scoped })
		})
	}

	async #aggregate(
		storage: StorageInterface,
		scoped: boolean,
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		if (storage.aggregate === undefined) throw new Error('The storage declares no aggregate')
		const value = await storage.aggregate(table, operation, column, input)
		this.#calls.push({ member: 'aggregate', keys: 0, rows: 0, scoped })
		return value
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
