import type { FieldPath } from '@orkestrel/contract'
import type {
	Aggregate,
	AggregateOperation,
	ConformanceFinding,
	DriverInterface,
	Migration,
	MigrationStep,
	QueryInput,
	ReadInput,
	Row,
	StorageInterface,
	TableSchema,
} from './types.js'
import { attempt, isFiniteNumber, isRecord, settle } from '@orkestrel/contract'
import { cloneMigrationInput, normalizeDriverSchema } from './cloners.js'
import {
	CONFORMANCE_POSTS_SCHEMA,
	CONFORMANCE_READS,
	CONFORMANCE_ROWS,
	CONFORMANCE_SCHEMA,
	CONFORMANCE_USERS_SCHEMA,
} from './constants.js'
import { DatabaseError, isDatabaseError } from './errors.js'
import {
	applyQuery,
	buildFailureFinding,
	captureFailure,
	equalsValue,
	extractKey,
	filterRows,
	findPlanFaults,
	matchesQuery,
	normalizeReadInput,
	planRead,
	prepareScalars,
	validatePage,
} from './helpers.js'
import { OrderedPage } from './OrderedPage.js'
import { StreamAggregate } from './StreamAggregate.js'
import { StreamPage } from './StreamPage.js'

/**
 * Diffs a deployed and a declared table set structurally into a {@link Migration}
 * plan.
 *
 * @remarks
 * Tables present in `declared` but not `deployed` become `table.add` steps
 * (carrying the full declared {@link TableSchema}); tables present in
 * `deployed` but not `declared` become `table.remove` steps. Tables present in
 * both are diffed column-by-column (by name) and index-group-by-index-group
 * (by deep equality of the column-name array), each producing `column.add` /
 * `column.remove` / `index.add` / `index.remove` steps. Step order is
 * deterministic: every `table.remove`, then every `table.add`, then each
 * shared table's column/index changes in `declared` order. `from` / `to` are
 * plan labels only; versioning drivers persist and reconcile them through
 * {@link DriverMetadata}.
 *
 * A column present in both schemas under the same name but with a different
 * `storage`, `optional`, or `nullable` value throws a `MIGRATION`
 * {@link DatabaseError} naming the table, the column, and the from→to
 * difference — a name-only diff would otherwise silently produce no step for
 * the drift, and versioned reconciliation would stamp over it. There is no
 * automatic in-place type-change step: the manual path is to add a new column,
 * copy/convert the data at the application layer, then remove the old column —
 * two separate plans, never a single implicit "alter" step.
 *
 * @param deployed - The already-applied table schemas
 * @param declared - The table schemas the caller wants applied
 * @param from - The plan's source version label (defaults to `0`)
 * @param to - The plan's target version label (defaults to `1`)
 * @returns The migration plan moving `deployed` toward `declared`
 * @throws A `MIGRATION` {@link DatabaseError} when a shared table's primary or
 * a shared column's `storage`, `optional`, or `nullable` differs, or when a
 * required non-null column would be added to an existing table without a
 * portable backfill
 *
 * @example
 * ```ts
 * const plan = planMigration(
 * 	[{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }], indexes: [] }],
 * 	[{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }, { name: 'age', storage: 'integer', optional: true, nullable: false }], indexes: [] }],
 * )
 * // plan.steps === [{ operation: 'column.add', table: 'users', column: { name: 'age', ... } }]
 * ```
 */
export function planMigration(
	deployed: readonly TableSchema[],
	declared: readonly TableSchema[],
	from = 0,
	to = 1,
): Migration {
	if (!isFiniteNumber(from) || !isFiniteNumber(to)) {
		throw new DatabaseError('MIGRATION', 'Migration versions must be finite', { from, to })
	}
	const schemas = attempt(() => ({
		before: normalizeDriverSchema(deployed),
		target: normalizeDriverSchema(declared),
	}))
	if (!schemas.success) {
		throw new DatabaseError('MIGRATION', 'Migration schema is invalid', { cause: schemas.error })
	}
	const { before: beforeSchema, target: targetSchema } = schemas.value
	const deployedByName = new Map(beforeSchema.map((table) => [table.name, table]))
	const declaredByName = new Map(targetSchema.map((table) => [table.name, table]))

	const steps: MigrationStep[] = []

	for (const table of beforeSchema) {
		if (!declaredByName.has(table.name))
			steps.push({ operation: 'table.remove', table: table.name })
	}
	for (const table of targetSchema) {
		if (!deployedByName.has(table.name)) steps.push({ operation: 'table.add', table })
	}

	for (const table of targetSchema) {
		const before = deployedByName.get(table.name)
		if (before === undefined) continue
		if (before.primary !== table.primary) {
			throw new DatabaseError(
				'MIGRATION',
				`planMigration: primary column on table '${table.name}' changed from '${before.primary}' to '${table.primary}'`,
				{ table: table.name, from: before.primary, to: table.primary },
			)
		}

		const beforeColumnMap = new Map(before.columns.map((column) => [column.name, column]))
		const afterColumnMap = new Map(table.columns.map((column) => [column.name, column]))

		for (const index of before.indexes) {
			if (!table.indexes.some((candidate) => equalsValue(candidate, index))) {
				steps.push({ operation: 'index.remove', table: table.name, index })
			}
		}
		for (const column of before.columns) {
			if (!afterColumnMap.has(column.name)) {
				steps.push({ operation: 'column.remove', table: table.name, column: column.name })
			}
		}
		for (const column of table.columns) {
			const previous = beforeColumnMap.get(column.name)
			if (previous === undefined) {
				steps.push({ operation: 'column.add', table: table.name, column })
				continue
			}
			if (
				previous.storage !== column.storage ||
				previous.optional !== column.optional ||
				previous.nullable !== column.nullable
			) {
				throw new DatabaseError(
					'MIGRATION',
					`planMigration: column '${column.name}' on table '${table.name}' changed shape ` +
						`(storage ${previous.storage}→${column.storage}, optional ${previous.optional}→${column.optional}, nullable ${previous.nullable}→${column.nullable}) — ` +
						`in-place storage/optionality/nullability changes are not auto-migrated; add a new column, copy/convert ` +
						`the data, then remove the old column`,
					{
						table: table.name,
						column: column.name,
						from: {
							storage: previous.storage,
							optional: previous.optional,
							nullable: previous.nullable,
						},
						to: {
							storage: column.storage,
							optional: column.optional,
							nullable: column.nullable,
						},
					},
				)
			}
		}

		for (const index of table.indexes) {
			if (!before.indexes.some((candidate) => equalsValue(candidate, index))) {
				steps.push({ operation: 'index.add', table: table.name, index })
			}
		}
	}

	const projected = projectMigrationSchema(beforeSchema, steps)
	if (!equalsValue(projected, targetSchema)) {
		throw new DatabaseError('MIGRATION', 'Migration plan does not project to the declared schema', {
			projected,
			declared: targetSchema,
		})
	}
	return cloneMigrationInput({ plan: { from, to, steps } }).plan
}

/**
 * Projects migration steps sequentially over a canonical validated owned schema.
 *
 * @remarks
 * Adding a required non-null column to an existing table rejects with
 * `MIGRATION`; optional-only and nullable-only additions remain portable.
 *
 * @param schema - The initial deployed schema
 * @param steps - The ordered migration steps
 * @returns A fresh owned final schema
 *
 * @example
 * ```ts
 * const id = { name: 'id', storage: 'text', optional: false, nullable: false } as const
 * const age = { name: 'age', storage: 'integer', optional: true, nullable: false } as const
 * projectMigrationSchema([{ name: 'users', primary: 'id', columns: [id], indexes: [] }], [{ operation: 'column.add', table: 'users', column: age }])
 * // [{ name: 'users', primary: 'id', columns: [age, id], indexes: [] }]
 * ```
 */
export function projectMigrationSchema(
	schema: readonly TableSchema[],
	steps: readonly MigrationStep[],
): readonly TableSchema[] {
	const captured = attempt(() => ({
		owned: normalizeDriverSchema(schema),
		steps: cloneMigrationInput({ plan: { from: 0, to: 1, steps } }).plan.steps,
	}))
	if (!captured.success) {
		throw new DatabaseError('MIGRATION', 'Migration input is invalid', { cause: captured.error })
	}
	const { owned, steps: projectedSteps } = captured.value
	const tables = new Map(owned.map((table) => [table.name, table]))
	for (const step of projectedSteps) {
		if (step.operation === 'table.add') {
			if (tables.has(step.table.name)) {
				throw new DatabaseError('MIGRATION', `migrate: table '${step.table.name}' already exists`, {
					table: step.table.name,
				})
			}
			tables.set(step.table.name, step.table)
			continue
		}
		const table = tables.get(step.table)
		if (table === undefined) {
			throw new DatabaseError('MIGRATION', `migrate: table '${step.table}' does not exist`, {
				table: step.table,
			})
		}
		if (step.operation === 'table.remove') {
			tables.delete(step.table)
			continue
		}
		if (step.operation === 'column.add') {
			if (table.columns.some((column) => column.name === step.column.name)) {
				throw new DatabaseError(
					'MIGRATION',
					`migrate: column '${step.column.name}' already exists`,
					{ table: step.table, column: step.column.name },
				)
			}
			if (!step.column.optional && !step.column.nullable) {
				throw new DatabaseError(
					'MIGRATION',
					`migrate: required non-null column '${step.column.name}' cannot be added automatically to existing table '${step.table}'`,
					{ table: step.table, column: step.column.name },
				)
			}
			tables.set(step.table, { ...table, columns: [...table.columns, step.column] })
			continue
		}
		if (step.operation === 'column.remove') {
			if (!table.columns.some((column) => column.name === step.column)) {
				throw new DatabaseError('MIGRATION', `migrate: column '${step.column}' does not exist`, {
					table: step.table,
					column: step.column,
				})
			}
			if (table.primary === step.column) {
				throw new DatabaseError('MIGRATION', 'migrate: cannot remove the primary column', {
					table: step.table,
					column: step.column,
				})
			}
			if (table.indexes.some((index) => index.includes(step.column))) {
				throw new DatabaseError('MIGRATION', 'migrate: cannot remove an indexed column', {
					table: step.table,
					column: step.column,
				})
			}
			tables.set(step.table, {
				...table,
				columns: table.columns.filter((column) => column.name !== step.column),
			})
			continue
		}
		if (step.operation === 'index.add') {
			if (
				step.index.length === 0 ||
				step.index.some((name) => !table.columns.some((column) => column.name === name))
			) {
				throw new DatabaseError('MIGRATION', 'migrate: index references a missing column', {
					table: step.table,
					index: step.index,
				})
			}
			if (table.indexes.some((index) => equalsValue(index, step.index))) {
				throw new DatabaseError('MIGRATION', 'migrate: index already exists', {
					table: step.table,
					index: step.index,
				})
			}
			tables.set(step.table, { ...table, indexes: [...table.indexes, step.index] })
			continue
		}
		if (!table.indexes.some((index) => equalsValue(index, step.index))) {
			throw new DatabaseError('MIGRATION', 'migrate: index does not exist', {
				table: step.table,
				index: step.index,
			})
		}
		tables.set(step.table, {
			...table,
			indexes: table.indexes.filter((index) => !equalsValue(index, step.index)),
		})
	}
	try {
		return normalizeDriverSchema([...tables.values()])
	} catch (error) {
		throw new DatabaseError('MIGRATION', 'Projected migration schema is invalid', { cause: error })
	}
}

// === Read procedure

/**
 * Computes an aggregate over a column across rows.
 *
 * @remarks
 * `count` returns the row count. The numeric aggregates coerce each cell with
 * the contracts `parseNumber` (so `'42'` counts) and ignore non-numeric cells;
 * over zero numeric values they return `undefined` — the SQL `NULL` of an empty
 * aggregate. Folds the rows one at a time, holding none.
 *
 * @param rows - The rows to aggregate (non-record entries are ignored)
 * @param operation - The aggregate to compute
 * @param column - The column to aggregate
 * @returns The aggregate value, or `undefined` when undefined for the inputs
 * @throws {@link DatabaseError} `VALIDATION` when `operation` is not one of {@link AGGREGATE_OPERATIONS}
 *
 * @example
 * ```ts
 * const rows = [{ age: 40 }, { age: 20 }, { age: 30 }]
 * computeAggregate(rows, 'sum', 'age') // 90
 * computeAggregate(rows, 'maximum', 'age') // 40
 * computeAggregate([], 'average', 'age') // undefined
 * ```
 */
export function computeAggregate(
	rows: readonly unknown[],
	operation: AggregateOperation,
	column: FieldPath,
): number | undefined {
	const aggregate = new StreamAggregate(operation, column)
	for (const row of rows) aggregate.add(row)
	return aggregate.value
}

/**
 * Streams the native side of a plan and applies residual conditions and a residual page,
 * stopping at `offset + limit` matches — step 3 of the read procedure.
 *
 * @remarks
 * The rows come from `stream` for a storage that plans, and from `scan` otherwise. Each
 * condition's scalar set is built once. `step` runs before each pull and after it, where
 * `Table` checks readiness and the abort signal. The residual order is the caller's.
 *
 * @param storage - The storage to read
 * @param table - The table to read
 * @param native - The plan's native side
 * @param residual - The residual conditions and page to apply
 * @param step - The check to run around each pull. Default: none
 * @yields The rows the residual keeps, in the order the native side streams them
 *
 * @example
 * ```ts
 * await Array.fromAsync(streamPlannedRows(createMemoryDriver(), 'users', {}, { limit: 1 })) // the first row
 * ```
 */
export async function* streamPlannedRows(
	storage: StorageInterface,
	table: string,
	native: ReadInput,
	residual: ReadInput,
	step?: () => Promise<void>,
): AsyncIterable<Row> {
	const conditions = residual.conditions ?? []
	const scalars = prepareScalars(conditions)
	const limit = residual.limit
	const page = new StreamPage(residual.offset ?? 0)
	const source =
		storage.plan === undefined || storage.stream === undefined
			? storage.scan(table)
			: storage.stream(table, native)
	const iterator = source[Symbol.asyncIterator]()
	try {
		while (true) {
			await step?.()
			if (limit !== undefined && page.count >= limit) return
			const pulled = await iterator.next()
			await step?.()
			if (pulled.done === true) return
			const row = pulled.value
			if (conditions.length > 0 && !matchesQuery(row, conditions, scalars)) continue
			if (!page.next()) continue
			yield row
		}
	} finally {
		await iterator.return?.()
	}
}

/**
 * Reads the rows of a read through a storage's plan — the read procedure `Table.records`
 * runs and the conformance differential checks.
 *
 * @remarks
 * An empty residual returns what `records` answers for the native side. A residual without
 * an order streams the native side through {@link streamPlannedRows}, stopping at
 * `offset + limit` matches. A residual order with a limit keeps the page in a heap as the
 * filtered rows stream, holding at most `offset + limit` rows, and a zero limit reads no row; a
 * residual order without a limit collects the filtered rows, then sorts and pages them through
 * {@link applyQuery}.
 *
 * With `accept`, the plan covers the conditions and the order, and the page stays in the core:
 * each row the residual conditions keep must also pass `accept`, ahead of the page, so a native
 * order streams and stops at `offset + limit` accepted rows.
 *
 * @param storage - The storage to read
 * @param table - The table to read
 * @param input - The read, without an aggregate
 * @param step - The check to run around each pulled row. Default: none
 * @param accept - A predicate each row must also pass, run as the row streams. Default: none
 * @returns The rows the plan answers
 * @throws A `VALIDATION` {@link DatabaseError} when a residual page is not a finite nonnegative integer
 *
 * @example
 * ```ts
 * import { createMemoryDriver, readPlannedRows } from '@orkestrel/database'
 *
 * const driver = createMemoryDriver()
 * await driver.open([{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }], indexes: [] }])
 * await driver.write('users', 'u1', { id: 'u1', age: 36 })
 * await readPlannedRows(driver, 'users', { limit: 1 }) // [{ id: 'u1', age: 36 }]
 * ```
 */
export async function readPlannedRows(
	storage: StorageInterface,
	table: string,
	input: QueryInput,
	step?: () => Promise<void>,
	accept?: (row: Row) => boolean,
): Promise<readonly Row[]> {
	const { limit, offset, ...query } = input
	const plan = planRead(storage, table, accept === undefined ? input : query)
	if (
		accept === undefined &&
		Object.keys(plan.residual).length === 0 &&
		storage.records !== undefined
	) {
		return storage.records(table, plan.native)
	}
	const residual =
		accept === undefined
			? plan.residual
			: normalizeReadInput({
					...plan.residual,
					...(limit === undefined ? {} : { limit }),
					...(offset === undefined ? {} : { offset }),
				})
	if (accept === undefined && residual.order === undefined) {
		return Array.fromAsync(streamPlannedRows(storage, table, plan.native, residual, step))
	}
	validatePage(residual)
	if (residual.limit === 0) return []
	const filter = residual.conditions === undefined ? {} : { conditions: residual.conditions }
	const rows = streamPlannedRows(storage, table, plan.native, filter, step)
	if (residual.order === undefined) {
		const page = new StreamPage(residual.offset ?? 0)
		const kept: Row[] = []
		for await (const row of rows) {
			if (accept?.(row) === false || !page.next()) continue
			kept.push(row)
			if (residual.limit !== undefined && page.count >= residual.limit) break
		}
		return kept
	}
	if (residual.limit === undefined) {
		const kept: Row[] = []
		for await (const row of rows) if (accept?.(row) !== false) kept.push(row)
		return applyQuery(kept, {
			order: residual.order,
			...(residual.offset === undefined ? {} : { offset: residual.offset }),
		})
	}
	const page = new OrderedPage(residual.order, residual.offset ?? 0, residual.limit)
	for await (const row of rows) if (accept?.(row) !== false) page.add(row)
	return page.rows
}

/**
 * Computes an aggregate read through a storage's plan — the read procedure `Table.count`
 * and `Table.aggregate` run and the conformance differential checks.
 *
 * @remarks
 * `aggregate` answers when the plan keeps the aggregate native; otherwise the residual
 * conditions filter the native rows as they stream and each row folds into the aggregate,
 * which holds no row.
 *
 * @param storage - The storage to read
 * @param table - The table to read
 * @param input - The read's conditions; paging is ignored
 * @param aggregate - The aggregate to compute
 * @param step - The check to run around each pulled row. Default: none
 * @returns The aggregate value, or `undefined` when undefined for the rows
 *
 * @example
 * ```ts
 * import { createMemoryDriver, readPlannedAggregate } from '@orkestrel/database'
 *
 * const driver = createMemoryDriver()
 * await driver.open([{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }], indexes: [] }])
 * await driver.write('users', 'u1', { id: 'u1', age: 36 })
 * await readPlannedAggregate(driver, 'users', {}, { operation: 'sum', column: 'age' }) // 36
 * ```
 */
export async function readPlannedAggregate(
	storage: StorageInterface,
	table: string,
	input: QueryInput,
	aggregate: Aggregate,
	step?: () => Promise<void>,
): Promise<number | undefined> {
	const plan = planRead(storage, table, {
		...(input.conditions === undefined ? {} : { conditions: input.conditions }),
		aggregate,
	})
	const { aggregate: kept, ...native } = plan.native
	if (kept !== undefined && storage.aggregate !== undefined) {
		return storage.aggregate(table, kept.operation, kept.column, native)
	}
	const filter =
		plan.residual.conditions === undefined ? {} : { conditions: plan.residual.conditions }
	const fold = new StreamAggregate(aggregate.operation, aggregate.column)
	for await (const row of streamPlannedRows(storage, table, native, filter, step)) fold.add(row)
	return fold.value
}

// === Conformance

/**
 * Compares a storage's planned answer to every conformance read against the core engine's
 * answer over its `scan`, and checks each plan's invariants.
 *
 * @remarks
 * The storage holds {@link CONFORMANCE_ROWS} in `users`. Each read in
 * {@link CONFORMANCE_READS} yields one finding per broken plan invariant and one per answer
 * that differs from {@link applyQuery} or {@link computeAggregate} over the scanned rows.
 *
 * @param storage - The seeded storage to read
 * @param check - The finding's `check` prefix
 * @yields One {@link ConformanceFinding} per broken invariant or differing answer
 *
 * @example
 * ```ts
 * import { scanPlans, CONFORMANCE_ROWS, CONFORMANCE_SCHEMA, createMemoryDriver } from '@orkestrel/database'
 *
 * const driver = createMemoryDriver()
 * await driver.open(CONFORMANCE_SCHEMA)
 * for (const row of CONFORMANCE_ROWS) await driver.write('users', String(row.id), row)
 * for await (const finding of scanPlans(driver, 'plan')) console.log(finding.check) // logs nothing
 * ```
 */
export async function* scanPlans(
	storage: StorageInterface,
	check: string,
): AsyncIterable<ConformanceFinding> {
	const scanned = await Array.fromAsync(storage.scan('users'))
	for (const input of CONFORMANCE_READS) {
		const read = normalizeReadInput(input)
		const faults =
			storage.plan === undefined ? [] : findPlanFaults(read, storage.plan('users', read))
		if (faults.length > 0) {
			yield {
				check: check + '-invariant',
				message: 'a plan must obey every invariant DriverInterface states',
				context: { table: 'users', input, faults },
			}
		}
		const { aggregate, ...query } = input
		const expected =
			aggregate === undefined
				? applyQuery(scanned, query)
				: computeAggregate(
						filterRows(scanned, query.conditions ?? []),
						aggregate.operation,
						aggregate.column,
					)
		const actual =
			aggregate === undefined
				? await readPlannedRows(storage, 'users', query)
				: await readPlannedAggregate(storage, 'users', query, aggregate)
		if (!equalsValue(actual, expected)) {
			yield {
				check: check + '-differential',
				message: "a planned read must answer what the core engine answers over the driver's scan",
				context: { table: 'users', input, expected, actual },
			}
		}
	}
}

/**
 * Walks the driver-conformance battery against a fresh {@link DriverInterface}
 * per phase, yielding one {@link ConformanceFinding} per violated invariant —
 * the shared invariant suite every backend (in-memory, SQLite, IndexedDB)
 * must uphold to be a drop-in {@link DriverInterface}.
 *
 * @remarks
 * Framework-agnostic: no test-runner or Node imports, only sibling core
 * modules — so it runs equally from a unit test, a smoke script, or a new
 * driver's own README. Opens a fixed two-table schema (`users` keyed by the
 * default `id`, `posts` keyed by a non-id `slug`) and, calling `factory()`
 * fresh for each phase so failures stay isolated, verifies: `open`/`close`;
 * `read` of a missing key returns `undefined`; `write`/`read` round-trip
 * with deep copy-in/copy-out isolation (mutating the caller's row —
 * including a nested field — after `write`, or a row `read` returns, never
 * perturbs stored state) and upsert-overwrite; simultaneous same-key
 * `insert` calls produce exactly one commit and one `CONFLICT`; pre-aborted
 * `write`, `insert`, and `delete` calls leave storage unchanged; `delete`
 * returns `true` then `false`; `keys`/`scan` yield in ascending key order;
 * `clear` empties only its target table; a list read copies each prior row out and a list
 * delete and a list write restore them, the calls the core's journal makes; a list read
 * answers in key order, a list write applies every row, a list insert with a conflicting
 * final member and a mismatched batch apply none, and a list delete reports each key once;
 * inside a transaction, a conflicting list insert applies no row and the scope commits the
 * rest; a non-`id` primary key
 * (`posts.slug`) round-trips; a nested-object row round-trips structurally
 * (through {@link equalsValue}). The optional surface is presence-gated: when
 * `migrate` exists, a `column.remove` plan strips the column from stored
 * rows and a plan referencing an unknown table throws `DatabaseError`
 * `MIGRATION`; when `stream` exists, it yields only condition-matching rows
 * and honors `offset`/`limit`; when `transaction` exists, `commit` persists
 * and `rollback` restores; when `plan` exists, the driver declares `records` and `stream`,
 * every plan over {@link CONFORMANCE_READS} obeys the invariants {@link DriverInterface}
 * states, each planned read answers what the core engine answers over `scan` (the binary
 * text order is the one exemption, and {@link CONFORMANCE_ROWS} holds no case of it), and a
 * transaction capability declares each native member its driver declares; when both `metadata` and `stamp` exist, a fresh
 * store's `metadata()` is `undefined`, and after
 * `stamp({ version, schema })`, `metadata()` returns the exact stamped value.
 *
 * Each phase runs within a `try`/`catch`: an expected mismatch yields a
 * finding built from the assertion, while an unexpected throw (a driver
 * crash mid-phase) is caught and yielded as a finding too, naming the phase
 * as `check` and carrying the caught error in `context.error` — a broken
 * driver can never escape the battery as an unhandled rejection. Within a
 * phase, the first violated assertion yields and the phase stops (matching
 * the historical fail-fast shape at phase granularity); the generator then
 * moves on to the next phase regardless. Because this is a **generator**,
 * consuming only the first yielded value reproduces true fail-fast (later
 * phases never run) — that is exactly what {@link conformDriver} does.
 *
 * @param factory - Mints a fresh, unopened driver instance (called once per phase)
 * @yields One {@link ConformanceFinding} per violated invariant, in phase order
 *
 * @example
 * ```ts
 * import { createMemoryDriver, scanDriver } from '@orkestrel/database'
 *
 * for await (const finding of scanDriver(() => createMemoryDriver())) {
 * 	console.log(finding.check, finding.message)
 * }
 * ```
 */
export async function* scanDriver(
	factory: () => DriverInterface,
): AsyncIterable<ConformanceFinding> {
	// a. open with the shared two-table schema, then close cleanly.
	try {
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.close()
	} catch (error) {
		yield buildFailureFinding('open-close', error)
	}

	// b. read of a missing key -> undefined.
	try {
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		const missing = await driver.read('users', 'nope')
		await driver.close()
		if (missing !== undefined) {
			yield {
				check: 'read-missing',
				message: 'read of a missing key must return undefined',
				context: { table: 'users', expected: undefined, actual: missing },
			}
		}
	} catch (error) {
		yield buildFailureFinding('read-missing', error)
	}

	// c. write/read round-trip, copy-in/copy-out isolation (including nested
	// fields, not only top-level ones), upsert-overwrite.
	writeRead: {
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			const input: Row = { id: 'caller', name: 'Ada', age: 30, meta: { tags: ['a'] } }
			await driver.write('users', 'u1', input)
			input.name = 'Mutated after write'
			if (isRecord(input.meta) && Array.isArray(input.meta.tags)) input.meta.tags.push('mutated')
			const stored = await driver.read('users', 'u1')
			const original = { id: 'u1', name: 'Ada', age: 30, meta: { tags: ['a'] } }
			if (stored === undefined || !equalsValue(stored, original)) {
				await driver.close()
				yield {
					check: 'copy-in',
					message:
						'write must deep-copy the input row (including nested fields) rather than store it by reference',
					context: { table: 'users', expected: original, actual: stored },
				}
				break writeRead
			}
			stored.name = 'Mutated after read'
			if (isRecord(stored.meta) && Array.isArray(stored.meta.tags)) stored.meta.tags.push('mutated')
			const reread = await driver.read('users', 'u1')
			if (reread === undefined || !equalsValue(reread, original)) {
				await driver.close()
				yield {
					check: 'copy-out',
					message:
						'read must deep-copy the stored row (including nested fields) rather than return it by reference',
					context: { table: 'users', expected: original, actual: reread },
				}
				break writeRead
			}
			const overwrite = { id: 'caller', name: 'Ada Overwritten', age: 31 }
			await driver.write('users', 'u1', overwrite)
			const overwritten = await driver.read('users', 'u1')
			await driver.close()
			const expectedOverwrite = { ...overwrite, id: 'u1' }
			if (overwritten === undefined || !equalsValue(overwritten, expectedOverwrite)) {
				yield {
					check: 'upsert',
					message: 'write must upsert-overwrite an existing key',
					context: { table: 'users', expected: expectedOverwrite, actual: overwritten },
				}
			}
		} catch (error) {
			yield buildFailureFinding('write-read', error)
		}
	}

	// c2. insert is atomic: concurrent duplicates produce one commit and one CONFLICT.
	{
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			const outcomes = await Promise.allSettled([
				driver.insert('users', 'u1', { id: 'u1', name: 'Ada', age: 30 }),
				driver.insert('users', 'u1', { id: 'u1', name: 'Grace', age: 40 }),
			])
			const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled').length
			const conflicted = outcomes.filter(
				(outcome) =>
					outcome.status === 'rejected' &&
					isDatabaseError(outcome.reason) &&
					outcome.reason.code === 'CONFLICT',
			).length
			const keys = await driver.keys('users')
			await driver.close()
			if (fulfilled !== 1 || conflicted !== 1 || !equalsValue(keys, ['u1'])) {
				yield {
					check: 'insert-atomic',
					message: 'concurrent same-key inserts must produce one commit and one CONFLICT',
					context: {
						expected: { fulfilled: 1, conflicted: 1, keys: ['u1'] },
						actual: { fulfilled, conflicted, keys },
					},
				}
			}
		} catch (error) {
			yield buildFailureFinding('insert-atomic', error)
		}
	}

	// d. delete -> true then false.
	deletePhase: {
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
			const first = await driver.delete('users', 'u1')
			if (first !== true) {
				await driver.close()
				yield {
					check: 'delete-true',
					message: 'delete of an existing key must return true',
					context: { table: 'users', expected: true, actual: first },
				}
				break deletePhase
			}
			const second = await driver.delete('users', 'u1')
			await driver.close()
			if (second !== false) {
				yield {
					check: 'delete-false',
					message: 'delete of an already-removed key must return false',
					context: { table: 'users', expected: false, actual: second },
				}
			}
		} catch (error) {
			yield buildFailureFinding('delete', error)
		}
	}

	// d2. pre-aborted point mutations reject as ABORTED without changing rows.
	try {
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
		const controller = new AbortController()
		controller.abort('conformance abort')
		const writeError = await captureFailure(() =>
			driver.write(
				'users',
				'u2',
				{ id: 'u2', name: 'Grace', age: 40 },
				{ signal: controller.signal },
			),
		)
		const insertError = await captureFailure(() =>
			driver.insert(
				'users',
				'u2',
				{ id: 'u2', name: 'Grace', age: 40 },
				{ signal: controller.signal },
			),
		)
		const deleteError = await captureFailure(() =>
			driver.delete('users', 'u1', { signal: controller.signal }),
		)
		const keys = await driver.keys('users')
		await driver.close()
		if (
			!isDatabaseError(writeError) ||
			writeError.code !== 'ABORTED' ||
			!isDatabaseError(insertError) ||
			insertError.code !== 'ABORTED' ||
			!isDatabaseError(deleteError) ||
			deleteError.code !== 'ABORTED' ||
			!equalsValue(keys, ['u1'])
		) {
			yield {
				check: 'mutation-abort',
				message: 'pre-aborted write/insert/delete must reject ABORTED without changing rows',
				context: {
					expected: { write: 'ABORTED', insert: 'ABORTED', delete: 'ABORTED', keys: ['u1'] },
					actual: {
						write: isDatabaseError(writeError) ? writeError.code : writeError,
						insert: isDatabaseError(insertError) ? insertError.code : insertError,
						delete: isDatabaseError(deleteError) ? deleteError.code : deleteError,
						keys,
					},
				},
			}
		}
	} catch (error) {
		yield buildFailureFinding('mutation-abort', error)
	}

	// e. keys and scan in ascending key order.
	orderPhase: {
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			const rows = [
				{ id: 'c', name: 'C', age: 3 },
				{ id: 'a', name: 'A', age: 1 },
				{ id: 'b', name: 'B', age: 2 },
			]
			for (const row of rows) await driver.write('users', row.id, row)
			const expected = ['a', 'b', 'c']
			const keys = [...(await driver.keys('users'))]
			if (!equalsValue(keys, expected)) {
				await driver.close()
				yield {
					check: 'keys-order',
					message: 'keys must be returned in ascending key order',
					context: { table: 'users', expected, actual: keys },
				}
				break orderPhase
			}
			const scanned: Row[] = []
			for await (const row of driver.scan('users')) scanned.push(row)
			const scannedIds = scanned.map((row) => row.id)
			await driver.close()
			if (!equalsValue(scannedIds, expected)) {
				yield {
					check: 'scan-order',
					message: 'scan must yield rows in ascending key order',
					context: { table: 'users', expected, actual: scannedIds },
				}
			}
		} catch (error) {
			yield buildFailureFinding('order', error)
		}
	}

	// f. clear empties only the targeted table.
	clearPhase: {
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
			await driver.write('posts', 'p1', { slug: 'p1', title: 'Post' })
			await driver.clear('users')
			const usersKeys = await driver.keys('users')
			const postsKeys = await driver.keys('posts')
			await driver.close()
			if (usersKeys.length !== 0) {
				yield {
					check: 'clear-target',
					message: 'clear must empty the targeted table',
					context: { table: 'users', expected: [], actual: usersKeys },
				}
				break clearPhase
			}
			if (postsKeys.length !== 1) {
				yield {
					check: 'clear-other',
					message: 'clear must not affect other tables',
					context: { table: 'posts', expected: 1, actual: postsKeys.length },
				}
			}
		} catch (error) {
			yield buildFailureFinding('clear', error)
		}
	}

	// g. journal round trip: a list read of prior rows, then a list delete and a list write put
	// them back — the calls a core journal makes to roll a scope back.
	{
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			const original = { id: 'u1', name: 'Ada', age: 30, meta: { tags: ['a'] } }
			await driver.write('users', 'u1', original)
			const touched = ['u1', 'u2']
			const priors = await driver.read('users', touched)
			const [alias] = await driver.read('users', ['u1'])
			// A list read copies each row out, so a nested change to it reaches no stored row.
			if (isRecord(alias) && isRecord(alias.meta) && Array.isArray(alias.meta.tags)) {
				alias.meta.tags.push('mutated-after-read')
			}
			await driver.write('users', 'u1', { id: 'u1', name: 'Grace', age: 40 })
			await driver.insert('users', 'u2', { id: 'u2', name: 'Alan', age: 41 })
			const present = touched.flatMap((key, index) => {
				const row = priors[index]
				return row === undefined ? [] : [[key, row] as const]
			})
			await driver.delete(
				'users',
				touched.filter((_, index) => priors[index] === undefined),
			)
			await driver.write(
				'users',
				present.map(([key]) => key),
				present.map(([, row]) => row),
			)
			const keys = [...(await driver.keys('users'))]
			const restored = await driver.read('users', 'u1')
			await driver.close()
			if (!equalsValue(keys, ['u1']) || !equalsValue(restored, original)) {
				yield {
					check: 'journal-rollback',
					message:
						'a list read must copy each prior row out, and a list delete and a list write must restore them',
					context: {
						table: 'users',
						expected: { keys: ['u1'], row: original },
						actual: { keys, row: restored },
					},
				}
			}
		} catch (error) {
			yield buildFailureFinding('journal-rollback', error)
		}
	}

	// g2. batches: a list read answers in key order, a list write applies every row, a list insert
	// with a conflicting final member applies none, a list delete reports each key, and lists of
	// different lengths refuse ahead of any write.
	batchPhase: {
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			const ada = { id: 'a', name: 'Ada', age: 30 }
			const grace = { id: 'b', name: 'Grace', age: 40 }
			await driver.write('users', ['b', 'a'], [grace, ada])
			const read = await driver.read('users', ['a', 'z', 'b'])
			if (!equalsValue(read, [ada, undefined, grace])) {
				await driver.close()
				yield {
					check: 'batch-read',
					message: 'a list write must apply every row, and a list read must answer in key order',
					context: { table: 'users', expected: [ada, undefined, grace], actual: read },
				}
				break batchPhase
			}
			const conflict = await captureFailure(() =>
				driver.insert(
					'users',
					['c', 'a'],
					[
						{ id: 'c', name: 'Alan', age: 41 },
						{ id: 'a', name: 'Again', age: 1 },
					],
				),
			)
			const shape = await captureFailure(() =>
				driver.write('users', ['d', 'e'], [{ id: 'd', name: 'Dora', age: 2 }]),
			)
			const kept = [...(await driver.keys('users'))]
			if (
				!isDatabaseError(conflict) ||
				conflict.code !== 'CONFLICT' ||
				!isDatabaseError(shape) ||
				shape.code !== 'VALIDATION' ||
				!equalsValue(kept, ['a', 'b'])
			) {
				await driver.close()
				yield {
					check: 'batch-atomic',
					message:
						'a list insert with a conflicting member must refuse CONFLICT and a mismatched batch VALIDATION, each applying no row',
					context: {
						table: 'users',
						expected: { insert: 'CONFLICT', write: 'VALIDATION', keys: ['a', 'b'] },
						actual: {
							insert: isDatabaseError(conflict) ? conflict.code : conflict,
							write: isDatabaseError(shape) ? shape.code : shape,
							keys: kept,
						},
					},
				}
				break batchPhase
			}
			const removed = await driver.delete('users', ['a', 'z', 'a'])
			const left = [...(await driver.keys('users'))]
			await driver.close()
			if (!equalsValue(removed, [true, false, false]) || !equalsValue(left, ['b'])) {
				yield {
					check: 'batch-delete',
					message:
						'a list delete must report true for the first occurrence of each key that held a row',
					context: {
						table: 'users',
						expected: { removed: [true, false, false], keys: ['b'] },
						actual: { removed, keys: left },
					},
				}
			}
		} catch (error) {
			yield buildFailureFinding('batch', error)
		}
	}

	// h. non-id primary extraction (posts keyed by slug).
	try {
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.write('posts', 'hello-world', { slug: 'caller', title: 'Hello' })
		const post = await driver.read('posts', 'hello-world')
		const key = post === undefined ? undefined : extractKey(post, 'slug')
		await driver.close()
		if (key !== 'hello-world') {
			yield {
				check: 'non-id-primary',
				message: 'a non-id primary key column must round-trip through the store',
				context: { table: 'posts', expected: 'hello-world', actual: key },
			}
		}
	} catch (error) {
		yield buildFailureFinding('non-id-primary', error)
	}

	// i. nested-object row round-trip (structural, through equalsValue).
	try {
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		const nested = {
			id: 'u3',
			name: 'Nested',
			age: 20,
			meta: { tags: ['a', 'b'], deep: { flag: true } },
		}
		await driver.write('users', 'u3', nested)
		const readBack = await driver.read('users', 'u3')
		await driver.close()
		if (readBack === undefined || !equalsValue(readBack, nested)) {
			yield {
				check: 'nested-roundtrip',
				message: 'a nested-object row must round-trip structurally',
				context: { table: 'users', expected: nested, actual: readBack },
			}
		}
	} catch (error) {
		yield buildFailureFinding('nested-roundtrip', error)
	}

	// j. migrate (presence-gated): column.remove strips rows; unknown tables fail.
	migratePhase: {
		try {
			const driver = factory()
			if (driver.migrate === undefined) break migratePhase
			const deployedUsers: TableSchema = {
				...CONFORMANCE_USERS_SCHEMA,
				columns: [
					...CONFORMANCE_USERS_SCHEMA.columns,
					{ name: 'legacy', storage: 'boolean', optional: true, nullable: false },
				],
			}
			await driver.open([deployedUsers, CONFORMANCE_POSTS_SCHEMA])
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30, legacy: true })
			await driver.migrate({
				plan: {
					from: 0,
					to: 1,
					steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
				},
			})
			const migrated = await driver.read('users', 'u1')
			if (migrated === undefined || 'legacy' in migrated) {
				await driver.close()
				yield {
					check: 'migrate-column-remove',
					message: 'a column.remove migration must strip the column from stored rows',
					context: {
						table: 'users',
						expected: undefined,
						actual: migrated === undefined ? undefined : migrated.legacy,
					},
				}
				break migratePhase
			}
			const migrate = driver.migrate.bind(driver)
			const caught = await captureFailure(() =>
				migrate({
					plan: {
						from: 0,
						to: 1,
						steps: [{ operation: 'table.remove', table: 'ghost' }],
					},
				}),
			)
			await driver.close()
			if (!isDatabaseError(caught) || caught.code !== 'MIGRATION') {
				yield {
					check: 'migrate-unknown-table',
					message:
						'a migration step referencing an unknown table must throw a MIGRATION DatabaseError',
					context: {
						table: 'ghost',
						expected: 'MIGRATION',
						actual: isDatabaseError(caught) ? caught.code : caught,
					},
				}
			}
		} catch (error) {
			yield buildFailureFinding('migrate', error)
		}
	}

	// k. stream (presence-gated): condition matching and paging.
	streamPhase: {
		try {
			const driver = factory()
			if (driver.stream === undefined) break streamPhase
			await driver.open(CONFORMANCE_SCHEMA)
			const rows = [
				{ id: 'a', name: 'A', age: 10 },
				{ id: 'b', name: 'B', age: 20 },
				{ id: 'c', name: 'C', age: 30 },
			]
			for (const row of rows) await driver.write('users', row.id, row)
			const input: QueryInput = {
				conditions: [{ column: 'age', operator: 'above', values: [10], connector: 'and' }],
			}
			const matched: Row[] = []
			for await (const row of driver.stream('users', input)) matched.push(row)
			const matchedIds = matched.map((row) => row.id).sort()
			if (!equalsValue(matchedIds, ['b', 'c'])) {
				await driver.close()
				yield {
					check: 'stream-match',
					message: 'stream must yield only condition-matching rows',
					context: { table: 'users', expected: ['b', 'c'], actual: matchedIds },
				}
				break streamPhase
			}
			const paged: Row[] = []
			for await (const row of driver.stream('users', { offset: 1, limit: 1 })) paged.push(row)
			await driver.close()
			if (paged.length !== 1) {
				yield {
					check: 'stream-page',
					message: 'stream must honor offset and limit',
					context: { table: 'users', expected: 1, actual: paged.length },
				}
			}
		} catch (error) {
			yield buildFailureFinding('stream', error)
		}
	}

	// l. transaction (presence-gated): commit persists, rollback restores.
	transactionPhase: {
		try {
			const driver = factory()
			if (driver.transaction === undefined) break transactionPhase
			await driver.open(CONFORMANCE_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
			await driver.transaction(async (transaction) => {
				await transaction.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40 })
			})
			const afterCommit = [...(await driver.keys('users'))].sort()
			if (!equalsValue(afterCommit, ['u1', 'u2'])) {
				await driver.close()
				yield {
					check: 'transaction-commit',
					message: 'transaction commit must persist writes made during the scope',
					context: { table: 'users', expected: ['u1', 'u2'], actual: afterCommit },
				}
				break transactionPhase
			}
			const reason = {}
			const transact = driver.transaction.bind(driver)
			const rolled = await settle(() =>
				transact(async (transaction) => {
					await transaction.write('users', 'u3', { id: 'u3', name: 'Marie', age: 50 })
					throw reason
				}),
			)
			if (!rolled.success && rolled.error !== reason) throw rolled.error
			const afterRollback = [...(await driver.keys('users'))].sort()
			await driver.close()
			if (!equalsValue(afterRollback, ['u1', 'u2'])) {
				yield {
					check: 'transaction-rollback',
					message: 'transaction rollback must restore pre-transaction state',
					context: { table: 'users', expected: ['u1', 'u2'], actual: afterRollback },
				}
			}
		} catch (error) {
			yield buildFailureFinding('transaction', error)
		}
	}

	// m. metadata/stamp (presence-gated): fresh is undefined; stamp round-trips.
	metadataPhase: {
		try {
			const driver = factory()
			if (driver.metadata === undefined || driver.stamp === undefined) break metadataPhase
			await driver.open(CONFORMANCE_SCHEMA)
			const fresh = await driver.metadata()
			if (fresh !== undefined) {
				await driver.close()
				yield {
					check: 'metadata-fresh',
					message: 'a fresh store must report undefined metadata',
					context: { expected: undefined, actual: fresh },
				}
				break metadataPhase
			}
			const stamped = { version: 1, schema: CONFORMANCE_SCHEMA }
			await driver.stamp(stamped)
			const read = await driver.metadata()
			await driver.close()
			if (read === undefined || !equalsValue(read, stamped)) {
				yield {
					check: 'metadata-stamp',
					message: 'metadata() must return exactly the last-stamped value',
					context: { expected: stamped, actual: read },
				}
			}
		} catch (error) {
			yield buildFailureFinding('metadata-stamp', error)
		}
	}

	// m2. plan (presence-gated): the native members, the invariants, the differential against
	// the core engine over scan, and the transaction capability's mirror of the native members.
	planPhase: {
		try {
			const driver = factory()
			if (driver.plan === undefined) break planPhase
			if (driver.records === undefined || driver.stream === undefined) {
				yield {
					check: 'plan-members',
					message: 'a driver that declares plan must declare records and stream',
					context: { records: driver.records !== undefined, stream: driver.stream !== undefined },
				}
				break planPhase
			}
			await driver.open(CONFORMANCE_SCHEMA)
			for (const row of CONFORMANCE_ROWS) {
				const key = extractKey(row, 'id')
				if (key !== undefined) await driver.write('users', key, row)
			}
			const aggregated = CONFORMANCE_READS.some(
				(input) =>
					input.aggregate !== undefined &&
					driver.plan?.('users', normalizeReadInput(input)).native.aggregate !== undefined,
			)
			if (aggregated && driver.aggregate === undefined) {
				yield {
					check: 'plan-members',
					message: 'a driver whose plan keeps an aggregate native must declare aggregate',
					context: { aggregate: false },
				}
			}
			for await (const finding of scanPlans(driver, 'plan')) yield finding
			if (driver.transaction === undefined) {
				await driver.close()
				break planPhase
			}
			const scoped = await driver.transaction(async (storage) => {
				const findings: ConformanceFinding[] = []
				for await (const finding of scanPlans(storage, 'plan-scoped')) findings.push(finding)
				return {
					findings,
					members: {
						plan: storage.plan !== undefined,
						records: storage.records !== undefined,
						stream: storage.stream !== undefined,
						aggregate: storage.aggregate !== undefined,
					},
				}
			})
			await driver.close()
			const expected = {
				plan: true,
				records: true,
				stream: true,
				aggregate: driver.aggregate !== undefined,
			}
			if (!equalsValue(scoped.members, expected)) {
				yield {
					check: 'plan-capability',
					message: 'a transaction capability must declare each native member its driver declares',
					context: { expected, actual: scoped.members },
				}
			}
			for (const finding of scoped.findings) yield finding
		} catch (error) {
			yield buildFailureFinding('plan', error)
		}
	}

	// n. batches inside a transaction (presence-gated): a list write the scope commits applies
	// every row, and a list insert that conflicts inside a scope applies none while the scope
	// continues and commits.
	scopedPhase: {
		try {
			const driver = factory()
			if (driver.transaction === undefined) break scopedPhase
			await driver.open(CONFORMANCE_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
			const conflict = await driver.transaction(async (storage) => {
				await storage.write(
					'users',
					['u2', 'u3'],
					[
						{ id: 'u2', name: 'Grace', age: 40 },
						{ id: 'u3', name: 'Alan', age: 41 },
					],
				)
				return captureFailure(() =>
					storage.insert(
						'users',
						['u4', 'u1'],
						[
							{ id: 'u4', name: 'Dora', age: 2 },
							{ id: 'u1', name: 'Again', age: 1 },
						],
					),
				)
			})
			const keys = [...(await driver.keys('users'))]
			await driver.close()
			if (
				!isDatabaseError(conflict) ||
				conflict.code !== 'CONFLICT' ||
				!equalsValue(keys, ['u1', 'u2', 'u3'])
			) {
				yield {
					check: 'transaction-batch',
					message:
						'inside a transaction a list write must apply every row and a conflicting list insert none',
					context: {
						table: 'users',
						expected: { insert: 'CONFLICT', keys: ['u1', 'u2', 'u3'] },
						actual: { insert: isDatabaseError(conflict) ? conflict.code : conflict, keys },
					},
				}
			}
		} catch (error) {
			yield buildFailureFinding('transaction-batch', error)
		}
	}
}

/**
 * Runs the driver-conformance battery, throwing on the first violated
 * invariant — the fail-fast entry point most callers (test setup, CI smoke
 * checks) want.
 *
 * @remarks
 * Consumes only the first value {@link scanDriver} yields: because that
 * generator is lazy, every later phase never runs — true fail-fast, not
 * merely "report only the first". The
 * thrown error is byte-compatible with the historical shape: a
 * `CONFORMANCE` {@link DatabaseError} whose `message` is the finding's
 * `message` and whose `context` is `{ check, ...finding.context }`. The battery
 * takes a driver factory and reports through a throw, so it binds no test
 * framework and runs from any runner.
 *
 * @param factory - Mints a fresh, unopened driver instance (called once per phase)
 * @returns Nothing — resolves once every phase has passed
 * @throws A `CONFORMANCE` {@link DatabaseError} on the first violated invariant
 *
 * @example
 * ```ts
 * import { conformDriver, createMemoryDriver } from '@orkestrel/database'
 *
 * await conformDriver(() => createMemoryDriver()) // resolves when every invariant holds
 * ```
 */
export async function conformDriver(factory: () => DriverInterface): Promise<void> {
	for await (const finding of scanDriver(factory)) {
		throw new DatabaseError('CONFORMANCE', finding.message, {
			check: finding.check,
			...finding.context,
		})
	}
}

/**
 * Runs the full driver-conformance battery and collects every violation — the
 * audit entry point for a driver author who wants a complete report rather
 * than a single fail-fast throw.
 *
 * @remarks
 * Drains {@link scanDriver} to completion: every phase runs regardless
 * of earlier violations, so a driver breaking two independent invariants
 * reports both. An empty array means the driver is fully conformant.
 *
 * @param factory - Mints a fresh, unopened driver instance (called once per phase)
 * @returns Every violated invariant found, in phase order (empty when fully conformant)
 *
 * @example
 * ```ts
 * import { auditDriver, createMemoryDriver } from '@orkestrel/database'
 *
 * const findings = await auditDriver(() => createMemoryDriver())
 * for (const finding of findings) console.log(`${finding.check}: ${finding.message}`)
 * ```
 */
export async function auditDriver(
	factory: () => DriverInterface,
): Promise<readonly ConformanceFinding[]> {
	const findings: ConformanceFinding[] = []
	for await (const finding of scanDriver(factory)) findings.push(finding)
	return findings
}
