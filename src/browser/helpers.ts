import type { Condition, QueryInput, ReadInput, ReadPlan, TableSchema } from '@src/core'
import type { IndexedDBError } from '@orkestrel/indexeddb'
import type { StoreDefinition } from '@orkestrel/indexeddb'
import type { AccessPlan } from './types.js'
import { isString } from '@orkestrel/contract'
import { compactReadInput, compareValues, DatabaseError, findColumn, isKey } from '@src/core'
import { rangeAboveKey, rangeBelowKey, rangeFromKey, rangeToKey } from '@orkestrel/indexeddb'
import { INDEXABLE_STORAGE } from './constants.js'

// The IndexedDB driver's planner. Pure functions over the portable `QueryInput`: they pick
// the one condition an index or the primary key answers with an exact key range, which the
// plan keeps native, and leave every other clause residual for the core engine.

/**
 * Translates one {@link Condition} to the `IDBKeyRange` it maps to, when its
 * operator is one of the exact key comparisons over scalar operands; otherwise
 * returns `undefined`.
 *
 * @remarks
 * Only the comparison operators (`equals`/`above`/`below`/`from`/`to`/`between`)
 * translate to a key range that a typed (string/number) column can back with an
 * IndexedDB store/index read — see {@link findAccessCondition} for the caveats that
 * decide which of `below`/`to` may drive a secondary-index read versus the
 * primary store only (a column-type / absent-row concern, not a range-shape
 * one). `starts` is excluded — its prefix range can miss strings past U+FFFF;
 * the membership / negation / pattern / existence operators (`not`/`like`/`glob`/
 * `ends`/`any`/`none`/`absent`/`present`) have no single exact range. The operand
 * guard (`typeof` string/number) rejects a non-scalar value (for example an array, a
 * boolean) that is not a usable key. `between` additionally guards against a
 * reversed pair (`first > second`): native `IDBKeyRange.bound` throws a raw
 * `DataError` `DOMException` for a lower bound above the upper bound, so a
 * reversed pair returns `undefined` here (the read covers the whole store, and the
 * core resolves it to an empty result) rather than letting a
 * native exception escape untyped — the same defensive posture as every other
 * backend, which returns empty for a reversed/empty range instead of throwing.
 * The switch is exhaustive over every {@link ConditionOperator}, so a new
 * operator forces a deliberate decision here rather than silently defaulting
 * to a (possibly lossy) range.
 *
 * @param condition - The condition to translate
 * @returns Its exact key range, or `undefined` when the operator/operands cannot push
 */
export function conditionToRange(condition: Condition): IDBKeyRange | undefined {
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'equals':
			return isKey(first) ? IDBKeyRange.only(first) : undefined
		case 'above':
			return isKey(first) ? rangeAboveKey(first) : undefined
		case 'below':
			return isKey(first) ? rangeBelowKey(first) : undefined
		case 'from':
			return isKey(first) ? rangeFromKey(first) : undefined
		case 'to':
			return isKey(first) ? rangeToKey(first) : undefined
		case 'between':
			// A reversed pair (`first > second`) has no valid IDBKeyRange — native
			// `bound` throws rather than returning empty. Read the whole store
			// instead of letting that DOMException escape (the engine then yields
			// the correct, empty result over `compareValues(value, first) >= 0 &&
			// compareValues(value, second) <= 0`, which no row can satisfy).
			return isKey(first) && isKey(second) && compareValues(first, second) <= 0
				? IDBKeyRange.bound(first, second)
				: undefined
		case 'not':
		case 'like':
		case 'glob':
		case 'starts':
		case 'ends':
		case 'any':
		case 'none':
		case 'absent':
		case 'present':
			return undefined
	}
}

/**
 * Finds the condition an IndexedDB read narrows on: the first one an index or the primary
 * key answers with an exact key range.
 *
 * @remarks
 * Narrowing is sound only when every condition is `and`-joined: the engine folds
 * conditions left-to-right (`c1 && c2 && … && cn`), so the result is a subset of
 * each. A single `or` breaks that, so any `or` finds nothing. Otherwise it scans the
 * conditions in order and selects the **first** one that is range-exact and backed by a
 * key: a comparison operator ({@link conditionToRange}) over a single, orderable
 * (`text`/`integer`/`real`) column that is either the table's primary key or has a
 * single-column secondary index named exactly the column. A nested {@link FieldPath}, a
 * column absent from the schema, a non-orderable type (`boolean`/`json`/`blob`), a
 * non-comparison operator, or a non-scalar operand cannot narrow and is skipped.
 *
 * **`below`/`to` narrow on the primary key only.** The core's total order ranks an absent
 * value and `null` below every number and string, so `below` and `to` match a row whose
 * field is absent or `null`, and a secondary index holds no entry for that row; a range
 * over the index would drop it. A row's primary key is always present, so the primary
 * store is safe. `equals`/`above`/`from`/`between` stay index-eligible on any orderable
 * column: each is bounded below by a scalar, which an absent or `null` value never meets.
 * This holds for the values a contract-validated write stores in an
 * {@link INDEXABLE_STORAGE} column: a string, a number, `null`, or absence.
 *
 * @param input - The read specification, or `undefined` for an unconditional read
 * @param schema - The table's schema — its `primary` key and column types
 * @param available - The secondary-index names that physically exist on the store
 *   (`store.indexes`); a single-column index is named exactly its column
 * @returns The condition to narrow on, or `undefined` when none qualifies
 *
 * @example
 * ```ts
 * findAccessCondition({ conditions: [from('age', 18)] }, schema, ['age']) // the from condition
 * findAccessCondition({ conditions: [like('name', 'a%')] }, schema, []) // undefined
 * ```
 */
export function findAccessCondition(
	input: QueryInput | undefined,
	schema: TableSchema,
	available: readonly string[],
): Condition | undefined {
	const conditions = input?.conditions ?? []
	if (conditions.slice(1).some((condition) => condition.connector === 'or')) return undefined
	return conditions.find((condition) => {
		// An array column is a nested FieldPath into a json value — not a key.
		if (!isString(condition.column)) return false
		const column = findColumn(condition.column, schema)
		if (column === undefined || !INDEXABLE_STORAGE.includes(column.storage)) return false
		if (conditionToRange(condition) === undefined) return false
		if (condition.column === schema.primary) return true
		if (condition.operator === 'below' || condition.operator === 'to') return false
		return available.includes(condition.column)
	})
}

/**
 * Derives the key-range read for the condition an IndexedDB read narrows on.
 *
 * @param condition - The access condition from {@link findAccessCondition}, or `undefined`
 * @param schema - The table's schema — its `primary` key
 * @returns The index and range to read; `{}` for a whole-store read
 *
 * @example
 * ```ts
 * deriveAccessPlan(eq('id', 'u1'), schema) // { range: only('u1') }
 * deriveAccessPlan(from('age', 18), schema) // { index: 'age', range: from(18) }
 * ```
 */
export function deriveAccessPlan(
	condition: Condition | undefined,
	schema: TableSchema,
): AccessPlan {
	if (condition === undefined || !isString(condition.column)) return {}
	const range = conditionToRange(condition)
	if (range === undefined) return {}
	return condition.column === schema.primary ? { range } : { index: condition.column, range }
}

/**
 * Splits a read into the part IndexedDB answers natively and the residual the core runs —
 * the IndexedDB driver's `plan`.
 *
 * @remarks
 * The native side holds the one condition {@link findAccessCondition} narrows on, answered
 * by a key range over the primary store or an index. Every other clause — the remaining
 * conditions, the order, the page, and the aggregate — is residual. A read with no access
 * condition is a whole-store read with the whole read residual. A side that carries nothing
 * is `{}`.
 *
 * @param input - The read to split
 * @param schema - The table's schema
 * @param available - The secondary-index names that physically exist on the store
 * @returns The plan
 *
 * @example
 * ```ts
 * planIndexedDBQuery({ conditions: [from('age', 18), like('name', 'a%')], limit: 10 }, schema, ['age'])
 * // { native: { conditions: [from('age', 18)] }, residual: { conditions: [like('name', 'a%')], limit: 10 } }
 * ```
 */
export function planIndexedDBQuery(
	input: ReadInput,
	schema: TableSchema,
	available: readonly string[],
): ReadPlan {
	const read = compactReadInput(input)
	const access = findAccessCondition(read, schema, available)
	return {
		native: access === undefined ? {} : { conditions: [access] },
		residual: compactReadInput({
			...read,
			conditions: (read.conditions ?? []).filter((condition) => condition !== access),
		}),
	}
}

/**
 * Maps a backend {@link IndexedDBError} to the portable `DatabaseError` taxonomy
 * — the default mapping used everywhere except inside `migrate()`.
 *
 * @remarks
 * No backend fault may leak through `DriverInterface` as a raw `IndexedDBError`.
 * `CONSTRAINT` (a unique-key violation) is a `CONFLICT` — the same code every
 * other backend uses for a duplicate key. `CLOSED`/`NOT_OPEN`/`INVALID` (the
 * connection is gone, never opened, or the native handle is stale) collapse to
 * `CLOSED`. `QUOTA` is a genuine infrastructure fault (`DRIVER`) carrying a
 * machine-readable `context.code` so a caller can branch without parsing the
 * message. A blocked open or versionchange is nonterminal in the backend and
 * remains pending until the competing connection closes, so it never reaches
 * this error mapper. Every other code (`UPGRADE` here — see
 * {@link mapMigrationError} for the `migrate()`-only remapping to `MIGRATION` —
 * `ABORTED`, `NOT_FOUND`, `DATA`, `OPEN`, `INACTIVE`, `READONLY`, `UNKNOWN`) is
 * an unexpected infrastructure fault and maps to `DRIVER` — the driver opens
 * its own readwrite transactions, so a `READONLY` fault can only mean the
 * backend behaved unexpectedly. The original error is always preserved as
 * `context.cause` for diagnostics.
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
 * Maps a backend {@link IndexedDBError} to the portable `DatabaseError` taxonomy
 * for use inside `migrate()` — the one context where `UPGRADE` means the
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
 * Derives an IndexedDB index name for a declared column group — a bare column
 * name for a single-column index, a deterministic collision-free encoding for a
 * compound one.
 *
 * @remarks
 * Naming a compound index by joining its columns with `_` (`['a', 'b'] →
 * 'a_b'`) collides with a single-column index over a column literally named
 * `'a_b'` — the same name, two different key paths (`'a_b'` vs `['a', 'b']`),
 * which either throws a native `ConstraintError` from a duplicate
 * `createIndex` call at open, or (worse) lets {@link findAccessCondition}'s name-based
 * lookup match the wrong index. A single-column index keeps the bare column
 * name — {@link findAccessCondition} matches `available.includes(condition.column)` by
 * that exact name, so a single-column index must stay named after its column
 * verbatim. A compound index instead encodes each column as a length-prefixed
 * segment (`'2#1:a1:b'`), so the boundary between columns is self-describing
 * and cannot be reconstructed by any other column list — including one
 * containing a column that happens to look like an encoded segment.
 *
 * @param columns - The index's column group, in declared order
 * @returns The index name to pass to `createIndex` / read back from `indexNames`
 *
 * @example
 * ```ts
 * deriveIndexedDBIndexName(['age']) // 'age'
 * deriveIndexedDBIndexName(['a', 'b']) // '2#1:a1:b'
 * ```
 */
export function deriveIndexedDBIndexName(columns: readonly string[]): string {
	const [column] = columns
	if (columns.length === 1 && column !== undefined) return column
	return `${columns.length}#${columns.map((part) => `${part.length}:${part}`).join('')}`
}

/**
 * Projects a table schema into the IndexedDB wrapper's store definition.
 *
 * @remarks
 * The definition is what an ordered versionchange migration creates the store
 * from, carrying each declared index under the name {@link deriveIndexedDBIndexName}
 * derives for its column group.
 *
 * @param schema - Portable table schema
 * @returns Store definition with declared indexes
 */
export function schemaToStore(schema: TableSchema): StoreDefinition {
	return {
		indexes: schema.indexes.map((columns) => {
			const [column] = columns
			return {
				name: deriveIndexedDBIndexName(columns),
				path: columns.length === 1 && column !== undefined ? column : [...columns],
			}
		}),
	}
}
