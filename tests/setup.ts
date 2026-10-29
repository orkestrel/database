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
	DatabaseInterface,
	DriverInterface,
	DriverMetadata,
	MigrationInput,
	Migration,
	Row,
	RowOf,
	TableInterface,
	TableSchema,
} from '@src/core'
import type { EmitterErrorHandler } from '@orkestrel/emitter'
import type { FieldPath } from '@orkestrel/contract'
import { integerShape, literalShape, objectShape, stringShape } from '@orkestrel/contract'
import { createDatabase, createMemoryDriver } from '@src/core'

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
		read: (table, key) => memory.read(table, key),
		write: (table, key, row, options) => memory.write(table, key, row, options),
		insert: (table, key, row, options) => memory.insert(table, key, row, options),
		delete: (table, key, options) => memory.delete(table, key, options),
		keys: (table) => memory.keys(table),
		scan: (table) => memory.scan(table),
		clear: (table) => memory.clear(table),
		snapshot: (tables) => memory.snapshot(tables),
		...overrides,
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
 * optional native `records` / `aggregate` hooks and records each call (see
 * `.claude/rules/architecture.md` § System constraints). Rows are
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
			...createMemoryAdapter(this.#memory, { snapshot: () => this.#memory.snapshot() }),
			records: this.#recordsCall.bind(this),
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

export async function transactionView(): Promise<{
	readonly view: DatabaseTransaction<typeof COLUMNS>
	readonly scope: TransactionScope
	readonly driver: StorageInterface
}> {
	const driver = createMemoryDriver()
	await driver.open(tableSchemas('users'))
	const scope = new TransactionScope()
	return {
		view: new DatabaseTransaction(driver, COLUMNS, {}, undefined, undefined, scope),
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
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		insert: (table, key, row) => inner.insert(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		async keys(table: string): Promise<readonly Key[]> {
			return [...(await inner.keys(table))].reverse()
		},
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		snapshot: () => inner.snapshot(),
	}
}

export function createMismatchedMetadataDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		insert: (table, key, row) => inner.insert(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		keys: (table) => inner.keys(table),
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		snapshot: (tables) => inner.snapshot(tables),
		async metadata() {
			return { version: 99, schema: [] }
		},
		async stamp() {
			// Deliberately ignores the stamped value.
		},
	}
}

export function createWholeSnapshotDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		insert: (table, key, row) => inner.insert(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		keys: (table) => inner.keys(table),
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		snapshot: () => inner.snapshot(),
	}
}

export function createDoublyBrokenDriver(): DriverInterface {
	return new ReferenceDriverFixture(true).driver
}

export function createCrashingDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		insert: (table, key, row) => inner.insert(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		keys: (table) => inner.keys(table),
		scan(): AsyncIterable<Row> {
			throw new Error('scan exploded')
		},
		clear: (table) => inner.clear(table),
		snapshot: (tables) => inner.snapshot(tables),
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
			snapshot: (tables) => this.#memory.snapshot(this.#descending ? tables : undefined),
		})
	}

	async #write(table: string, key: Key, row: Row): Promise<void> {
		await this.#memory.write(table, key, row)
		this.#stored.set(key, row)
	}

	async #read(table: string, key: Key): Promise<Row | undefined> {
		if (this.#stored.has(key)) return this.#stored.get(key)
		return this.#memory.read(table, key)
	}

	async #keys(table: string): Promise<readonly Key[]> {
		const keys = await this.#memory.keys(table)
		return this.#descending ? [...keys].reverse() : keys
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
