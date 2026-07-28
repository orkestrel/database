import type { Condition, Criteria, TableSchema } from '@src/core'
import type { IndexedDBError } from '@orkestrel/indexeddb'
import type { QueryPlan } from './types.js'
import { compareValues, DatabaseError } from '@src/core'
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
 * translate to a key range that a typed (string/number) column can back with an
 * IndexedDB store/index read — see {@link selectPlan} for the caveats that
 * decide WHICH of `below`/`to` may drive a SECONDARY-index read versus the
 * primary store only (a column-type / absent-row concern, not a range-shape
 * one). `starts` is excluded — its prefix range can miss strings past U+FFFF;
 * the membership / negation / pattern / existence operators (`not`/`like`/`glob`/
 * `ends`/`any`/`none`/`absent`/`present`) have no single exact range. The operand
 * guard (`typeof` string/number) rejects a non-scalar value (e.g. an array, a
 * boolean) that is not a usable key. `between` additionally guards against a
 * REVERSED pair (`first > second`): native `IDBKeyRange.bound` throws a raw
 * `DataError` `DOMException` for a lower bound above the upper bound, so a
 * reversed pair returns `null` here (falls back to a full scan, which the
 * engine then correctly resolves to an empty result) rather than letting a
 * native exception escape untyped — the same defensive posture as every other
 * backend, which returns empty for a reversed/empty range instead of throwing.
 * The switch is exhaustive over every {@link ConditionOperator}, so a new
 * operator forces a deliberate decision here rather than silently defaulting
 * to a (possibly lossy) range.
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
			// A reversed pair (`first > second`) has no valid IDBKeyRange — native
			// `bound` throws rather than returning empty. Fall back to a full scan
			// instead of letting that DOMException escape (the engine then yields
			// the correct, empty result over `compareValues(value, first) >= 0 &&
			// compareValues(value, second) <= 0`, which no row can satisfy).
			return isKey(first) && isKey(second) && compareValues(first, second) <= 0
				? range.between(first, second)
				: null
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
 * non-scalar operand cannot push and is skipped.
 *
 * **`below`/`to` may drive a SECONDARY-index range only when the column has NO
 * absent/null rows to lose — which this planner cannot verify from the schema
 * alone, so it restricts them to the PRIMARY store, where that is always true.**
 * The engine's total order (`compareValues`, see `@src/core`) ranks
 * `undefined` (absent) and `null` BELOW every number/string, so
 * `matchesCondition('below' | 'to', …)` is TRUE for a row whose field is absent
 * or `null` — but a secondary IndexedDB index has NO ENTRY for a row whose
 * indexed field is absent/`null`, so a `below`/`to` range read against that
 * index would SILENTLY DROP those rows (they can never be over-fetched, only
 * missed — the one shape of lossiness this planner must never produce). The
 * table's PRIMARY key is exempt: a row's primary-key value is always present
 * and never `null` (it is the row's identity, enforced at write time), so a
 * `below`/`to` range against the primary store can never exclude an
 * absent/null-keyed row because no such row exists. `equals`/`above`/`from`/
 * `between` stay index-eligible on ANY orderable column, primary or secondary:
 * each is bounded below by a scalar (`equals`/`between`'s lower bound, `above`/
 * `from`'s lower bound), and every scalar strictly out-ranks `undefined`/`null`
 * in the total order, so an absent/null-valued row can never satisfy them — the
 * index's silence on such a row is harmless (it was never going to match).
 * **Declared-type trust caveat:** this reasoning holds under the contract that
 * an {@link INDEXABLE_TYPES} column, once contract-validated at write time,
 * holds only `string | number | null` (or is absent) — never some other
 * runtime value that could rank differently; a driver bypassing the write
 * contract (writing raw rows directly to the store) could defeat this
 * argument, but that is out of scope for a planner reading validated schema
 * metadata.
 *
 * When no condition qualifies the plan is a full scan (`{ index: null, range:
 * null }`) and the engine does everything. The plan is always a SUPERSET of the
 * matching rows — the only correctness contract — so the driver may safely run
 * the exact engine over it.
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
		// `below`/`to` can silently drop an absent/null-valued row from a SECONDARY
		// index (see @remarks) — only the primary store (handled above) is safe.
		// Keep scanning: a later condition may still qualify.
		if (condition.operator === 'below' || condition.operator === 'to') continue
		if (available.includes(condition.column)) return { index: condition.column, range: keyRange }
		// The column is range-exact but has no usable index — keep looking.
	}
	return { index: null, range: null }
}

/**
 * Map a backend {@link IndexedDBError} to the portable `DatabaseError` taxonomy
 * — the default mapping used everywhere except inside `migrate()`.
 *
 * @remarks
 * No backend fault may leak through `DriverInterface` as a raw `IndexedDBError`.
 * `CONSTRAINT` (a unique-key violation) is a `CONFLICT` — the same code every
 * other backend uses for a duplicate key. `CLOSED`/`NOT_OPEN`/`INVALID` (the
 * connection is gone, never opened, or the native handle is stale) collapse to
 * `CLOSED`. `QUOTA` and `BLOCKED` are genuine infrastructure faults (`DRIVER`),
 * carrying a machine-readable `context.code` (`'QUOTA'` / `'BLOCKED'`) so a
 * caller can branch without parsing the message; `BLOCKED` additionally marks
 * `context.retryable: true` — a concurrent connection holding the database open
 * is a transient condition, not a permanent one. Every other code (`UPGRADE`
 * here — see {@link mapMigrationError} for the `migrate()`-only remapping to
 * `MIGRATION` — `ABORTED`, `NOT_FOUND`, `DATA`, `OPEN`, `INACTIVE`, `READONLY`,
 * `UNKNOWN`) is an unexpected infrastructure fault and maps to `DRIVER` — the
 * driver opens its own readwrite transactions, so a `READONLY` fault can only
 * mean the backend behaved unexpectedly. The original error is always
 * preserved as `context.cause` for diagnostics.
 *
 * @param error - The backend error to translate
 * @returns The portable `DatabaseError`
 */
export function mapIndexedDBError(error: IndexedDBError): DatabaseError {
	switch (error.code) {
		case 'CONSTRAINT':
			return new DatabaseError('CONFLICT', error.message, { cause: error })
		case 'CLOSED':
		case 'NOT_OPEN':
		case 'INVALID':
			return new DatabaseError('CLOSED', error.message, { cause: error })
		case 'QUOTA':
			return new DatabaseError('DRIVER', error.message, { cause: error, code: 'QUOTA' })
		case 'BLOCKED':
			return new DatabaseError('DRIVER', error.message, {
				cause: error,
				code: 'BLOCKED',
				retryable: true,
			})
		case 'UPGRADE':
		case 'ABORTED':
		case 'NOT_FOUND':
		case 'DATA':
		case 'OPEN':
		case 'INACTIVE':
		case 'READONLY':
		case 'UNKNOWN':
			return new DatabaseError('DRIVER', error.message, { cause: error })
	}
}

/**
 * Map a backend {@link IndexedDBError} to the portable `DatabaseError` taxonomy
 * for use INSIDE `migrate()` — the one context where `UPGRADE` means the
 * migration itself failed, not a generic driver fault.
 *
 * @remarks
 * `migrate()` reconnects at a bumped version inside `onupgradeneeded`; a
 * rejection there (an inapplicable step, a native `ConstraintError` from a
 * duplicate index, …) surfaces as `IndexedDBError` `UPGRADE` and must become a
 * `MIGRATION` `DatabaseError` so a caller can distinguish "this migration plan
 * failed" from "the driver hit an unrelated infrastructure fault". Every other
 * code defers to {@link mapIndexedDBError} unchanged.
 *
 * @param error - The backend error to translate
 * @returns The portable `DatabaseError`
 */
export function mapMigrationError(error: IndexedDBError): DatabaseError {
	if (error.code === 'UPGRADE') {
		return new DatabaseError('MIGRATION', error.message, { cause: error })
	}
	return mapIndexedDBError(error)
}

/**
 * Derive an IndexedDB index name for a declared column group — a bare column
 * name for a single-column index, a deterministic collision-free encoding for a
 * compound one.
 *
 * @remarks
 * Naming a compound index by joining its columns with `_` (`['a', 'b'] →
 * 'a_b'`) collides with a single-column index over a column LITERALLY named
 * `'a_b'` — the same name, two different key paths (`'a_b'` vs `['a', 'b']`),
 * which either throws a native `ConstraintError` from a duplicate
 * `createIndex` call at open, or (worse) lets {@link selectPlan}'s name-based
 * lookup match the wrong index. A single-column index keeps the BARE column
 * name — {@link selectPlan} matches `available.includes(condition.column)` by
 * that exact name, so a single-column index must stay named after its column
 * verbatim. A compound index instead encodes each column as a LENGTH-PREFIXED
 * segment (`'2#1:a1:b'`), so the boundary between columns is self-describing
 * and cannot be reconstructed by any other column list — including one
 * containing a column that happens to look like an encoded segment.
 *
 * @param columns - The index's column group, in declared order
 * @returns The index name to pass to `createIndex` / read back from `indexNames`
 *
 * @example
 * ```ts
 * deriveIndexName(['age']) // 'age'
 * deriveIndexName(['a', 'b']) // '2#1:a1:b'
 * ```
 */
export function deriveIndexName(columns: readonly string[]): string {
	const [column] = columns
	if (columns.length === 1 && column !== undefined) return column
	return `${columns.length}#${columns.map((part) => `${part.length}:${part}`).join('')}`
}
