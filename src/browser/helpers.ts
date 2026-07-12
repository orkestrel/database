import type { Condition, Criteria, TableSchema } from '@src/core'
import type { QueryPlan } from './types.js'
import { range } from '@orkestrel/indexeddb'
import { INDEXABLE_TYPES } from './constants.js'

// The IndexedDB driver's pushdown planner. A pure function over the portable
// `Criteria`: it decides which index (or the primary key) a read can narrow on
// and the `IDBKeyRange` to use, so the driver fetches a candidate SUPERSET rather
// than every row. The core engine then refines that superset to the exact result
// — so a plan is only ever allowed to over-fetch, never to drop a matching row.
// Anything it cannot prove range-exact (a non-comparison operator, a non-orderable
// column type, a nested path, a non-scalar operand) falls through to a full scan.

/**
 * The `IDBKeyRange` a single {@link Condition} maps to, when its operator is one
 * of the six exact key comparisons over scalar operands — else `null`.
 *
 * @remarks
 * Only the comparison operators (`equals`/`above`/`below`/`from`/`to`/`between`)
 * translate to a key range with **no missed rows** for a typed (string/number)
 * column: each is the exact native range the engine's `compareValues` predicate
 * accepts. `starts` is excluded — its prefix range can miss strings past U+FFFF;
 * the membership / negation / pattern / existence operators (`not`/`like`/`glob`/
 * `ends`/`any`/`none`/`absent`/`present`) have no single exact range. The operand
 * guard (`typeof` string/number) rejects a non-scalar value (e.g. an array, a
 * boolean) that is not a usable key. The switch is exhaustive over every
 * {@link ConditionOperator}, so a new operator forces a deliberate decision here
 * rather than silently defaulting to a (possibly lossy) range.
 *
 * @param condition - The condition to translate
 * @returns Its exact key range, or `null` when the operator/operands cannot push
 */
export function conditionRange(condition: Condition): IDBKeyRange | null {
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'equals':
			return isKey(first) ? range.only(first) : null
		case 'above':
			return isKey(first) ? range.above(first) : null
		case 'below':
			return isKey(first) ? range.below(first) : null
		case 'from':
			return isKey(first) ? range.from(first) : null
		case 'to':
			return isKey(first) ? range.to(first) : null
		case 'between':
			return isKey(first) && isKey(second) ? range.between(first, second) : null
		case 'not':
		case 'like':
		case 'glob':
		case 'starts':
		case 'ends':
		case 'any':
		case 'none':
		case 'absent':
		case 'present':
			return null
	}
}

// A scalar IndexedDB key operand — a string or number (the core `Key` space).
export function isKey(value: unknown): value is string | number {
	return typeof value === 'string' || typeof value === 'number'
}

/**
 * Plan an IndexedDB read for a {@link Criteria} — pick the index (or the primary
 * store) and {@link IDBKeyRange} to narrow by, falling back to a full scan.
 *
 * @remarks
 * Pushdown is sound ONLY when every condition is `and`-joined: the engine folds
 * conditions left-to-right (`c1 && c2 && … && cn`), so the result is a subset of
 * each — narrowing on any one is then a valid superset. A single `or` breaks that
 * (a row can match through a later condition the range would exclude), so any `or`
 * forces a full scan. Otherwise it scans the conditions in order and selects the
 * **first** one that is provably range-exact and backed by a key: a comparison
 * operator (`conditionRange`) over a single, orderable (`text`/`integer`/`real`)
 * column that is either the table's primary key (read the store directly, `index:
 * null`) or has a single-column secondary index (named exactly the column — read
 * that index). A condition whose column is a nested {@link FieldPath} array
 * (descends a json value, not a key), is absent from the schema, is a non-orderable
 * type (`boolean`/`json`/`blob`), uses a non-comparison operator, or has a
 * non-scalar operand cannot push and is skipped. When no condition qualifies the
 * plan is a full scan (`{ index: null, range: null }`) and the engine does
 * everything. The plan is always a SUPERSET of the matching rows — the only
 * correctness contract — so the driver may safely run the exact engine over it.
 *
 * @param criteria - The read specification (its `conditions` drive the plan), or
 *   `undefined` for an unconditional read
 * @param schema - The table's schema — its `primary` key and column types
 * @param available - The secondary-index names that physically exist on the store
 *   (`store.indexes`); a single-column index is named exactly its column
 * @returns The index + range to read, narrowing to a superset (never lossy)
 *
 * @example
 * ```ts
 * selectPlan({ conditions: [eq('id', 'u1')] }, schema, []) // { index: null, range: only('u1') }
 * selectPlan({ conditions: [from('age', 18)] }, schema, ['age']) // { index: 'age', range: from(18) }
 * selectPlan({ conditions: [contains('name', 'a')] }, schema, []) // { index: null, range: null }
 * ```
 */
export function selectPlan(
	criteria: Criteria | undefined,
	schema: TableSchema,
	available: readonly string[],
): QueryPlan {
	const conditions = criteria?.conditions ?? []
	// A single condition's range is a SUPERSET of the result only when the result
	// implies that condition — which holds iff every condition is `and`-joined (the
	// fold is `c1 && c2 && … && cn`, so the result is a subset of each). A single
	// `or` breaks that (a row can match via a later condition the range excludes),
	// so any `or` forces a full scan. The first condition's connector only seeds the
	// fold and is ignored (AGENTS — the `Condition.connector` contract).
	if (conditions.slice(1).some((condition) => condition.connector === 'or')) {
		return { index: null, range: null }
	}
	for (const condition of conditions) {
		// An array column is a nested FieldPath into a json value — not a key.
		if (typeof condition.column !== 'string') continue
		const column = schema.columns.find((candidate) => candidate.name === condition.column)
		if (column === undefined || !INDEXABLE_TYPES.has(column.type)) continue
		const keyRange = conditionRange(condition)
		if (keyRange === null) continue
		if (condition.column === schema.primary) return { index: null, range: keyRange }
		if (available.includes(condition.column)) return { index: condition.column, range: keyRange }
		// The column is range-exact but has no usable index — keep looking.
	}
	return { index: null, range: null }
}
