import type { Migration, MigrationStep, TableSchema } from './types.js'
import { attempt, isFiniteNumber } from '@orkestrel/contract'
import { cloneMigrationInput, normalizeDriverSchema } from './cloners.js'
import { DatabaseError } from './errors.js'
import { equalsValue } from './helpers.js'

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
