import type { Migration, MigrationStep, Row, TableSchema } from './types.js'

// Pure schema-diff / row-transform functions for the migration model (AGENTS
// §2, §5): `planMigration` structurally diffs two `TableSchema[]` into a
// `Migration`; `migrateRows` applies a table's steps to its rows. Neither
// touches storage — a driver's `migrate` hook (MemoryDriver) is what applies
// a plan natively.

// Deep-equal two column-name index groups (order-sensitive: an index over
// `[a, b]` is not the same index as `[b, a]`).
function sameIndex(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false
	return left.every((column, position) => column === right[position])
}

/**
 * Structurally diff a deployed and a declared table set into a {@link Migration}
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
 * plan labels only — version tracking itself is deferred to persistent
 * backends.
 *
 * @param deployed - The table schemas currently applied
 * @param declared - The table schemas the caller wants applied
 * @param from - The plan's source version label (defaults to `0`)
 * @param to - The plan's target version label (defaults to `1`)
 * @returns The migration plan moving `deployed` toward `declared`
 *
 * @example
 * ```ts
 * const plan = planMigration(
 * 	[{ name: 'users', primary: 'id', columns: [], indexes: [] }],
 * 	[{ name: 'users', primary: 'id', columns: [{ name: 'age', type: 'integer', nullable: false }], indexes: [] }],
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
	const deployedByName = new Map(deployed.map((table) => [table.name, table]))
	const declaredByName = new Map(declared.map((table) => [table.name, table]))

	const steps: MigrationStep[] = []

	for (const table of deployed) {
		if (!declaredByName.has(table.name)) steps.push({ operation: 'table.remove', table: table.name })
	}
	for (const table of declared) {
		if (!deployedByName.has(table.name)) steps.push({ operation: 'table.add', table })
	}

	for (const table of declared) {
		const before = deployedByName.get(table.name)
		if (before === undefined) continue

		const beforeColumns = new Map(before.columns.map((column) => [column.name, column]))
		const afterColumns = new Map(table.columns.map((column) => [column.name, column]))

		for (const column of before.columns) {
			if (!afterColumns.has(column.name)) {
				steps.push({ operation: 'column.remove', table: table.name, column: column.name })
			}
		}
		for (const column of table.columns) {
			if (!beforeColumns.has(column.name)) {
				steps.push({ operation: 'column.add', table: table.name, column })
			}
		}

		for (const index of before.indexes) {
			if (!table.indexes.some((candidate) => sameIndex(candidate, index))) {
				steps.push({ operation: 'index.remove', table: table.name, index })
			}
		}
		for (const index of table.indexes) {
			if (!before.indexes.some((candidate) => sameIndex(candidate, index))) {
				steps.push({ operation: 'index.add', table: table.name, index })
			}
		}
	}

	return { from, to, steps }
}

/**
 * Apply one table's {@link MigrationStep}s to its rows — a pure row transform.
 *
 * @remarks
 * `column.remove` drops that field from every row (a fresh copy — inputs are
 * never mutated, AGENTS §11); `column.add` leaves rows as-is (an absent field
 * reads as `undefined`, backfill is application policy). `table.add` /
 * `table.remove` / `index.add` / `index.remove` are no-ops here (they operate
 * on storage shape, not row shape). Steps for tables other than the one
 * `rows` belongs to are ignored — pass only the steps relevant to this table.
 *
 * @param rows - The table's current rows
 * @param steps - The migration steps to apply (typically one table's slice of a {@link Migration})
 * @returns A new array of transformed rows; `rows` is never mutated
 *
 * @example
 * ```ts
 * const rows = [{ id: 'a', name: 'Ada', legacy: true }]
 * migrateRows(rows, [{ operation: 'column.remove', table: 'users', column: 'legacy' }])
 * // => [{ id: 'a', name: 'Ada' }]
 * ```
 */
export function migrateRows(rows: readonly Row[], steps: readonly MigrationStep[]): readonly Row[] {
	const removed = steps
		.filter((step): step is Extract<MigrationStep, { operation: 'column.remove' }> => step.operation === 'column.remove')
		.map((step) => step.column)

	if (removed.length === 0) return rows.map((row) => ({ ...row }))

	return rows.map((row) => {
		const next: Row = {}
		for (const key of Object.keys(row)) {
			if (!removed.includes(key)) next[key] = row[key]
		}
		return next
	})
}
