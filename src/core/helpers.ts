import type {
	ContractInterface,
	ContractShape,
	FieldPath,
	RandomFunction,
} from '@orkestrel/contract'
import type {
	AggregateFunction,
	ColumnType,
	Columns,
	ConformanceFinding,
	Condition,
	Criteria,
	DriverInterface,
	DriverMeta,
	Key,
	Migration,
	MigrationStep,
	Order,
	Row,
	RowOf,
	TableSchema,
} from './types.js'
import {
	createContract,
	isArray,
	isBoolean,
	isFiniteNumber,
	isRecord,
	isString,
	objectShape,
	parseNumber,
	resolveField,
} from '@orkestrel/contract'
import { MAX_PATTERN_LENGTH, UUID_BYTE_COUNT, UUID_BYTE_RANGE } from './constants.js'
import { DatabaseError, isDatabaseError } from './errors.js'

// The query engine. Every backend's `scan` yields rows; these pure helpers do
// the filtering, ordering, paging, and aggregation once, so a driver never
// re-implements WHERE compilation. They are total — like the contracts guards
// they lean on, hostile input yields a `false` / a skipped value, never a throw.

// === Comparison

/**
 * A total ordering over arbitrary values — the comparator behind sorting and the
 * range operators.
 *
 * @remarks
 * Values of different types order by a fixed type rank (`undefined` < `null` <
 * boolean < number < string < other); same-typed values compare naturally.
 * `NaN` sorts after every other number and equal to itself, so the comparator
 * is total and never returns `NaN`.
 *
 * @param left - The left value
 * @param right - The right value
 * @returns `-1`, `0`, or `1`
 */
export function compareValues(left: unknown, right: unknown): number {
	// Rank unlike types so a mixed column still sorts deterministically:
	// undefined < null < boolean < number < string < other.
	const rankOf = (value: unknown): number => {
		if (value === undefined) return 0
		if (value === null) return 1
		if (typeof value === 'boolean') return 2
		if (typeof value === 'number') return 3
		if (typeof value === 'string') return 4
		return 5
	}
	const leftRank = rankOf(left)
	const rightRank = rankOf(right)
	if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1
	if (typeof left === 'number' && typeof right === 'number') {
		if (Number.isNaN(left) || Number.isNaN(right)) {
			return Number.isNaN(left) ? (Number.isNaN(right) ? 0 : 1) : -1
		}
		return left < right ? -1 : left > right ? 1 : 0
	}
	if (typeof left === 'string' && typeof right === 'string') {
		return left < right ? -1 : left > right ? 1 : 0
	}
	if (typeof left === 'boolean' && typeof right === 'boolean') {
		return left === right ? 0 : left ? 1 : -1
	}
	return 0
}

/**
 * Structural equality by SameValueZero leaves — the comparator behind conformance
 * checks and any test/fixture that needs "same data", not "same reference".
 *
 * @remarks
 * Primitives compare by SameValueZero (`NaN` equals itself; `+0` equals `-0`).
 * Arrays compare by index (same length, every element `deepEqual`). Plain
 * records (via `isRecord`) compare by their OWN enumerable keys: same key
 * COUNT and, for every key in `left`, `right` has that key (`Object.hasOwn`)
 * with a `deepEqual` value — so a key present with value `undefined` is NOT
 * equal to that key being absent (both differ in `Object.keys` membership).
 * Anything else (functions, class instances, mismatched shapes) falls through
 * to `false`. There is no cycle detection — a cyclic input recurses forever;
 * callers pass acyclic data (rows, plans, config).
 *
 * @param left - The left value
 * @param right - The right value
 * @returns Whether `left` and `right` are structurally equal
 *
 * @example
 * ```ts
 * deepEqual(Number.NaN, Number.NaN) // true
 * deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) // true
 * deepEqual({ a: undefined }, {}) // false — present-undefined ≠ absent
 * ```
 */
export function deepEqual(left: unknown, right: unknown): boolean {
	if (typeof left === 'number' && typeof right === 'number') {
		return (Number.isNaN(left) && Number.isNaN(right)) || left === right
	}
	if (left === right) return true
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
		)
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left)
		const rightKeys = Object.keys(right)
		if (leftKeys.length !== rightKeys.length) return false
		return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
	}
	return false
}

// === Pattern matching

/**
 * Match a value against a wildcard pattern in LINEAR time — the shared, ReDoS-SAFE
 * engine behind {@link likeMatch} and {@link globMatch}.
 *
 * @remarks
 * A backtracking RegExp (`a%b%c` → `^a.*b.*c$`) is CATASTROPHIC on a hostile pattern:
 * `.*` segments separated by literals, matched against a long non-matching input, blow
 * up super-linearly — and JS has no atomic groups / possessive quantifiers to bound it
 * (AGENTS §6.5, now that the authed server runs model-supplied `list` criteria over the
 * wire). So this builds NO regex. It runs the classic GREEDY TWO-POINTER wildcard match:
 * the `any` wildcard records its position and, on a later mismatch, backtracks ONLY to
 * that last `any` (letting it absorb one more char) — so the work is O(value × pattern),
 * never the exponential / polynomial backtracking a regex would do. The pattern length
 * is capped at {@link MAX_PATTERN_LENGTH} (a `VALIDATION` {@link DatabaseError} over it),
 * bounding the pattern factor so a match stays linear in the value length whatever the
 * pattern.
 *
 * The `any` wildcard matches any run (including empty); `single` matches exactly one
 * char; every other pattern char matches itself LITERALLY (a pattern `.` / `(` / `\` is
 * a literal — the regex-metacharacter hazard is gone with the regex). `any` is tested
 * BEFORE a literal match, so a value that literally contains the wildcard char never
 * shadows the wildcard. Case folding is applied to BOTH sides when `fold` is set.
 *
 * @param value - The value to test
 * @param pattern - The wildcard pattern
 * @param any - The any-run wildcard char (`%` for `LIKE`, `*` for `GLOB`)
 * @param single - The single-char wildcard char (`_` for `LIKE`, `?` for `GLOB`)
 * @param fold - Whether to match case-INSENSITIVELY (`LIKE` folds; `GLOB` does not)
 * @returns Whether `value` matches `pattern`
 * @throws A `VALIDATION` {@link DatabaseError} when `pattern` exceeds {@link MAX_PATTERN_LENGTH}
 */
export function wildcardMatch(
	value: string,
	pattern: string,
	any: string,
	single: string,
	fold: boolean,
): boolean {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		throw new DatabaseError(
			'VALIDATION',
			`Pattern exceeds the maximum length of ${MAX_PATTERN_LENGTH}`,
			{ length: pattern.length, limit: MAX_PATTERN_LENGTH },
		)
	}
	const haystack = fold ? value.toLowerCase() : value
	const needle = fold ? pattern.toLowerCase() : pattern
	let vi = 0
	let pi = 0
	// The greedy backtrack point: the pattern index of the LAST `any` wildcard + the value
	// index it was taken at. On a mismatch we resume just past it and let it absorb one more
	// char (`mark += 1`) — O(value × pattern), never a regex's exponential backtracking.
	let star = -1
	let mark = 0
	while (vi < haystack.length) {
		const pc = pi < needle.length ? needle[pi] : undefined
		if (pc === any) {
			// Record the wildcard (it absorbs zero chars for now) and advance the pattern.
			star = pi
			mark = vi
			pi += 1
		} else if (pc !== undefined && (pc === single || pc === haystack[vi])) {
			vi += 1
			pi += 1
		} else if (star !== -1) {
			// Mismatch under an open `any`: let it swallow one more value char and retry.
			pi = star + 1
			mark += 1
			vi = mark
		} else {
			return false
		}
	}
	// The value is consumed — the leftover pattern matches iff it is all `any` wildcards.
	while (pi < needle.length && needle[pi] === any) pi += 1
	return pi === needle.length
}

// SQL `LIKE` → case-INSENSITIVE wildcard match (`%` any run, `_` any char).
export function likeMatch(value: string, pattern: string): boolean {
	return wildcardMatch(value, pattern, '%', '_', true)
}

// `GLOB` → case-SENSITIVE wildcard match (`*` any run, `?` any char).
export function globMatch(value: string, pattern: string): boolean {
	return wildcardMatch(value, pattern, '*', '?', false)
}

// === Condition matching

/**
 * Evaluate one {@link Condition} against a row — the per-operator predicate.
 *
 * @remarks
 * Reads the condition's column — a `FieldPath`, resolved with `resolveField` (a
 * string is one column; an array descends a nested value) — and applies the
 * operator. Range operators (`above` / `below` / `from` / `to` / `between`) use
 * {@link compareValues}, the total order; the equality family (`equals` / `not`
 * / `any` / `none`) uses {@link deepEqual} — STRUCTURAL equality, not the total
 * order's rank-5-collapses-all-objects behavior, so `equals` on an object/array
 * operand only matches a structurally-equal value, never every row holding any
 * object. This is a semantics change from ranking: `deepEqual` is SameValueZero
 * on leaves, so `NaN` now equals `NaN` under `equals` / `any` (it never matched
 * anything under the old rank-based comparison). `like` / `glob` / `starts` /
 * `ends` match only strings; `absent` / `present` test nullishness. Total — a
 * type mismatch is simply a non-match.
 *
 * @param row - The row to test
 * @param condition - The condition to apply
 * @returns Whether the row satisfies the condition
 */
export function matchesCondition(row: Row, condition: Condition): boolean {
	const value = resolveField(row, condition.column)
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'equals':
			return deepEqual(value, first)
		case 'not':
			return !deepEqual(value, first)
		case 'above':
			return compareValues(value, first) > 0
		case 'below':
			return compareValues(value, first) < 0
		case 'from':
			return compareValues(value, first) >= 0
		case 'to':
			return compareValues(value, first) <= 0
		case 'between':
			return compareValues(value, first) >= 0 && compareValues(value, second) <= 0
		case 'like':
			return isString(value) && isString(first) && likeMatch(value, first)
		case 'glob':
			return isString(value) && isString(first) && globMatch(value, first)
		case 'starts':
			return isString(value) && isString(first) && value.startsWith(first)
		case 'ends':
			return isString(value) && isString(first) && value.endsWith(first)
		case 'any':
			return condition.values.some((candidate) => deepEqual(value, candidate))
		case 'none':
			return !condition.values.some((candidate) => deepEqual(value, candidate))
		case 'absent':
			return value === undefined || value === null
		case 'present':
			return value !== undefined && value !== null
	}
}

/**
 * Fold a row through a list of conditions, joining each by its connector.
 *
 * @remarks
 * Evaluated left-to-right: the first condition seeds the result, and each later
 * condition combines with `&&` (`and`) or `||` (`or`). An empty list matches
 * every row. There is no operator precedence — conditions combine in the order
 * the query builder recorded them.
 *
 * @param row - The row to test
 * @param conditions - The conditions to fold
 * @returns Whether the row satisfies the combined conditions
 */
export function matchesCriteria(row: Row, conditions: readonly Condition[]): boolean {
	let result = true
	let seeded = false
	for (const condition of conditions) {
		const match = matchesCondition(row, condition)
		if (!seeded) {
			result = match
			seeded = true
		} else {
			result = condition.connector === 'or' ? result || match : result && match
		}
	}
	return result
}

/**
 * Filter rows by a list of conditions — the shared basis for a table's count
 * and aggregate paths (no sort/page, unlike {@link applyCriteria}).
 *
 * @remarks
 * An empty condition list matches every row (returned as-is, no copy). Folds
 * each row through {@link matchesCriteria}.
 *
 * @param rows - The rows to filter
 * @param conditions - The conditions to apply (empty matches everything)
 * @returns The matching rows
 *
 * @example
 * ```ts
 * filterRows(
 * 	[{ age: 30 }, { age: 12 }],
 * 	[{ column: 'age', operator: 'above', values: [18], connector: 'and' }],
 * ) // => [{ age: 30 }]
 * ```
 */
export function filterRows(rows: readonly Row[], conditions: readonly Condition[]): readonly Row[] {
	if (conditions.length === 0) return rows
	return rows.filter((row) => matchesCriteria(row, conditions))
}

// === Ordering & paging

/**
 * Sort rows by an ordering specification, leaving the input untouched.
 *
 * @remarks
 * Applies the terms in priority order — the first term that distinguishes two
 * rows decides — using {@link compareValues}, reversing for `descending`.
 *
 * @param rows - The rows to sort
 * @param order - The ordering terms in priority order
 * @returns A new, sorted array
 */
export function sortRows(rows: readonly Row[], order: readonly Order[]): readonly Row[] {
	const sorted = [...rows]
	sorted.sort((left, right) => {
		for (const term of order) {
			const comparison = compareValues(
				resolveField(left, term.column),
				resolveField(right, term.column),
			)
			if (comparison !== 0) return term.direction === 'descending' ? -comparison : comparison
		}
		return 0
	})
	return sorted
}

/**
 * Apply a {@link Criteria} to rows — filter, then sort, then page.
 *
 * @remarks
 * The whole portable read pipeline in one place: conditions filter, `order`
 * sorts, and `offset` / `limit` window the result. Each step is skipped when its
 * part of the criteria is absent. The reference {@link DriverInterface} backends
 * lean on this rather than each re-deriving it.
 *
 * @param rows - The rows to process (typically a table's full `scan`)
 * @param criteria - The read specification, or `undefined` for all rows as-is
 * @returns The filtered, sorted, paged rows
 */
export function applyCriteria(rows: readonly Row[], criteria?: Criteria): readonly Row[] {
	let result = rows
	const conditions = criteria?.conditions
	if (conditions !== undefined && conditions.length > 0) {
		result = result.filter((row) => matchesCriteria(row, conditions))
	}
	const order = criteria?.order
	if (order !== undefined && order.length > 0) {
		result = sortRows(result, order)
	}
	const offset = criteria?.offset ?? 0
	const limit = criteria?.limit
	if (offset > 0 || limit !== undefined) {
		result = result.slice(offset, limit !== undefined ? offset + limit : undefined)
	}
	return result
}

// === Aggregation

/**
 * Compute an aggregate over a column across rows.
 *
 * @remarks
 * `count` returns the row count. The numeric aggregates coerce each cell with
 * the contracts `parseNumber` (so `'42'` counts) and ignore non-numeric cells;
 * over zero numeric values they return `undefined` — the SQL `NULL` of an empty
 * aggregate.
 *
 * @param rows - The rows to aggregate (non-record entries are ignored)
 * @param operation - The aggregate to compute
 * @param column - The column to aggregate
 * @returns The aggregate value, or `undefined` when undefined for the inputs
 */
export function computeAggregate(
	rows: readonly unknown[],
	operation: AggregateFunction,
	column: FieldPath,
): number | undefined {
	if (operation === 'count') return rows.length
	const numbers: number[] = []
	for (const row of rows) {
		if (!isRecord(row)) continue
		const value = parseNumber(resolveField(row, column))
		if (value !== undefined) numbers.push(value)
	}
	if (numbers.length === 0) return undefined
	if (operation === 'sum' || operation === 'average') {
		const total = numbers.reduce((sum, value) => sum + value, 0)
		return operation === 'average' ? total / numbers.length : total
	}
	return operation === 'minimum' ? Math.min(...numbers) : Math.max(...numbers)
}

// === Keys

/**
 * Read a row's primary key from a column, when it is a usable {@link Key}.
 *
 * @param row - The row to read
 * @param column - The primary-key column name
 * @returns The key (a string or finite number), or `undefined`
 */
export function extractKey(row: Row, column: string): Key | undefined {
	const value = row[column]
	if (isString(value)) return value
	if (isFiniteNumber(value)) return value
	return undefined
}

// === Contracts

/**
 * Compile a table's {@link Columns} into its typed {@link ContractInterface} — the
 * `column → shape` map wrapped in a closed `objectShape` and handed to
 * `createContract`.
 *
 * @remarks
 * A typed seam over a deliberately untyped implementation, mirroring the reason
 * `createContract` itself keeps an untyped impl. The public overload carries the
 * precise row type ({@link RowOf}`<C>`), so `Database.table` receives a
 * `ContractInterface<RowOf<C>>` it returns verbatim — the class never has to
 * RELATE the compiled `Infer` against `RowOf` over an abstract `T[K]`, which is
 * what trips TS's instantiation-depth guard (TS2589). The implementation is typed
 * to the broad `ContractInterface<unknown>`, so its body
 * (`createContract(objectShape(columns))`) type-checks ONCE against the open
 * `Columns` rather than being re-related per concrete table. Runtime behavior is
 * identical for every caller — only the static row type differs between the
 * overloads.
 *
 * @param columns - The table's column map (`column → ContractShape`)
 * @returns The compiled contract typed by the columns' {@link RowOf}
 *
 * @example
 * ```ts
 * import { columnsToContract } from '@orkestrel/database'
 * import { integerShape, stringShape } from '@orkestrel/contract'
 *
 * const contract = columnsToContract({ id: stringShape(), age: integerShape() })
 * contract.is({ id: 'u1', age: 30 }) // true — typed as { readonly id: string; readonly age: number }
 * ```
 */
export function columnsToContract<C extends Columns>(columns: C): ContractInterface<RowOf<C>>
export function columnsToContract(columns: Columns): ContractInterface<unknown>
export function columnsToContract(columns: Columns): ContractInterface<unknown> {
	return createContract(objectShape(columns))
}

// === Schema

/**
 * Map a column's {@link ContractShape} to its portable {@link ColumnType} — the
 * value a `TableSchema` carries so a native backend can declare a real column.
 *
 * @remarks
 * `string` → `text`; `number` → `integer` when the shape is integer-only, else
 * `real`; `boolean` → `boolean`. A `literal` takes the type of its values
 * (all-boolean → `boolean`, all-integer → `integer`, mixed/fractional numbers →
 * `real`, anything else → `text`). `optional` / `nullable` unwrap to their inner
 * type (nullability is tracked separately). `null` / `object` / `array` / `union` /
 * `json` / `raw` → `json`: a backend stores them as JSON text and can `json_extract`
 * for nested `FieldPath` queries. A scan-only backend ignores the result.
 *
 * @param shape - The column's contract shape
 * @returns The portable column type
 *
 * @example
 * ```ts
 * shapeToColumnType(stringShape()) // 'text'
 * shapeToColumnType(integerShape()) // 'integer'
 * shapeToColumnType(optionalShape(integerShape())) // 'integer'
 * shapeToColumnType(objectShape({ a: stringShape() })) // 'json'
 * ```
 */
export function shapeToColumnType(shape: ContractShape): ColumnType {
	switch (shape.type) {
		case 'string':
			return 'text'
		case 'number':
			return shape.integer === true ? 'integer' : 'real'
		case 'boolean':
			return 'boolean'
		case 'literal': {
			if (shape.values.every((value) => typeof value === 'boolean')) return 'boolean'
			if (shape.values.every((value) => typeof value === 'number')) {
				return shape.values.every((value) => Number.isInteger(value)) ? 'integer' : 'real'
			}
			return 'text'
		}
		case 'optional':
		case 'nullable':
			return shapeToColumnType(shape.inner)
		case 'null':
		case 'object':
		case 'array':
		case 'union':
		case 'json':
		case 'raw':
			return 'json'
	}
}

/**
 * Whether a value is a well-formed {@link DriverMeta} — the boundary guard a
 * versioning driver's `meta()` narrows a stored (structured-clone or
 * `JSON.parse`d) value through before trusting it, replacing the per-driver
 * duplicated narrowing every backend used to hand-roll (AGENTS §14: never `as`).
 *
 * @remarks
 * Total and total-recursive over the whole shape: a finite `version`, and a
 * `schema` array of well-formed {@link TableSchema} entries — each a `name` /
 * `primary` string pair, a `columns` array of well-formed {@link ColumnSchema}
 * entries (a `name` string, a {@link ColumnType} literal, a `nullable`
 * boolean), and an `indexes` array of string arrays. Anything off-shape
 * (including a non-record) returns `false` rather than throwing.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed `DriverMeta`
 *
 * @example
 * ```ts
 * isDriverMeta({ version: 1, schema: [] }) // true
 * isDriverMeta({ version: 1, schema: [{ name: 'users' }] }) // false
 * ```
 */
export function isDriverMeta(value: unknown): value is DriverMeta {
	const COLUMN_TYPES: readonly ColumnType[] = ['text', 'integer', 'real', 'boolean', 'json', 'blob']
	const isColumnType = (candidate: unknown): candidate is ColumnType =>
		isString(candidate) && COLUMN_TYPES.some((type) => type === candidate)
	const isColumnSchema = (candidate: unknown): boolean =>
		isRecord(candidate) &&
		isString(candidate.name) &&
		isColumnType(candidate.type) &&
		isBoolean(candidate.nullable)
	const isIndexGroup = (candidate: unknown): boolean =>
		isArray(candidate) && candidate.every((entry) => isString(entry))
	const isTableSchema = (candidate: unknown): candidate is TableSchema =>
		isRecord(candidate) &&
		isString(candidate.name) &&
		isString(candidate.primary) &&
		isArray(candidate.columns) &&
		candidate.columns.every(isColumnSchema) &&
		isArray(candidate.indexes) &&
		candidate.indexes.every(isIndexGroup)
	return (
		isRecord(value) &&
		isFiniteNumber(value.version) &&
		isArray(value.schema) &&
		value.schema.every(isTableSchema)
	)
}

// === Cancellation

/**
 * Throw when an {@link ReadOptions.signal | AbortSignal} has fired — the shared
 * cancellation gate checked at operation boundaries and between streamed rows.
 *
 * @remarks
 * A no-op for `undefined` or a live signal, so callers thread `options?.signal`
 * straight through. When the signal has aborted, throws an `ABORTED`
 * {@link DatabaseError} carrying the signal's `reason` in its context — callers
 * mint signals with whatever tool they like (`AbortSignal.timeout(ms)`,
 * `new AbortController()`, `@orkestrel/abort`).
 *
 * @param signal - The signal to check, if any
 * @returns Nothing — returns normally while the signal is live
 * @throws An `ABORTED` {@link DatabaseError} when the signal has aborted
 *
 * @example
 * ```ts
 * import { checkAbort } from '@orkestrel/database'
 *
 * const controller = new AbortController()
 * checkAbort(controller.signal) // returns
 * controller.abort('too slow')
 * checkAbort(controller.signal) // throws DatabaseError('ABORTED', …)
 * ```
 */
export function checkAbort(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DatabaseError('ABORTED', 'Operation aborted', { reason: signal.reason })
	}
}

// === Migrations

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
 * A column present in BOTH schemas under the same name but with a different
 * `type` or `nullable` throws a `MIGRATION` {@link DatabaseError} naming the
 * table, the column, and the from→to difference — a name-only diff would
 * otherwise silently produce NO step for the drift, and versioned
 * reconciliation would stamp over it. There is no automatic in-place
 * type-change step: the manual path is to add a new column, copy/convert the
 * data at the application layer, then remove the old column — two separate
 * plans, never a single implicit "alter" step.
 *
 * @param deployed - The table schemas currently applied
 * @param declared - The table schemas the caller wants applied
 * @param from - The plan's source version label (defaults to `0`)
 * @param to - The plan's target version label (defaults to `1`)
 * @returns The migration plan moving `deployed` toward `declared`
 * @throws A `MIGRATION` {@link DatabaseError} when a shared column's `type` or
 * `nullable` differs between `deployed` and `declared`
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
		if (!declaredByName.has(table.name))
			steps.push({ operation: 'table.remove', table: table.name })
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
			const previous = beforeColumns.get(column.name)
			if (previous === undefined) {
				steps.push({ operation: 'column.add', table: table.name, column })
				continue
			}
			if (previous.type !== column.type || previous.nullable !== column.nullable) {
				throw new DatabaseError(
					'MIGRATION',
					`planMigration: column '${column.name}' on table '${table.name}' changed shape ` +
						`(type ${previous.type}→${column.type}, nullable ${previous.nullable}→${column.nullable}) — ` +
						`in-place type/nullability changes are not auto-migrated; add a new column, copy/convert ` +
						`the data, then remove the old column`,
					{
						table: table.name,
						column: column.name,
						from: { type: previous.type, nullable: previous.nullable },
						to: { type: column.type, nullable: column.nullable },
					},
				)
			}
		}

		// Deep-equal two column-name index groups (order-sensitive: an index over
		// `[a, b]` is not the same index as `[b, a]`).
		const sameIndex = (left: readonly string[], right: readonly string[]): boolean =>
			left.length === right.length && left.every((column, position) => column === right[position])
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
		.filter(
			(step): step is Extract<MigrationStep, { operation: 'column.remove' }> =>
				step.operation === 'column.remove',
		)
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

// === Conformance

/**
 * Run the driver-conformance battery against a fresh {@link DriverInterface}
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
 * `read` of a missing key returns `undefined`; `write`/`read` round-trip with
 * DEEP copy-in/copy-out isolation (mutating the caller's row — including a
 * NESTED field — after `write`, or a row `read` returns, never perturbs
 * stored state) and upsert-overwrite; `delete` returns `true` then `false`;
 * `keys`/`scan` yield in ascending key order; `clear` empties only its target
 * table; `snapshot`'s rollback thunk restores pre-snapshot state, including a
 * NESTED field mutated in place on a read-back row between capture and
 * restore; a scoped `snapshot(['users'])` rolls back only the named table,
 * leaving a concurrent mutation to another table intact; a
 * non-`id` primary key (`posts.slug`) round-trips; a nested-object row
 * round-trips structurally (via {@link deepEqual}). The optional surface is
 * presence-gated: when `migrate` exists, a `column.remove` plan strips the
 * column from stored rows and a plan referencing an unknown table throws
 * `DatabaseError` `MIGRATION`; when `stream` exists, it yields only
 * condition-matching rows and honors `offset`/`limit`; when `transaction`
 * exists, `commit` persists and `rollback` restores; when both `meta` and
 * `stamp` exist, a fresh store's `meta()` is `undefined`, and after
 * `stamp({ version, schema })`, `meta()` returns the exact stamped value.
 *
 * Each phase runs within a `try`/`catch`: an EXPECTED mismatch yields a
 * finding built from the assertion, while an UNEXPECTED throw (a driver
 * crash mid-phase) is caught and yielded as a finding too, naming the phase
 * as `check` and carrying the caught error in `context.error` — a broken
 * driver can never escape the battery as an unhandled rejection. Within a
 * phase, the FIRST violated assertion yields and the phase stops (matching
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
 * import { createMemoryDriver, driverFindings } from '@orkestrel/database'
 *
 * for await (const finding of driverFindings(() => createMemoryDriver())) {
 * 	console.log(finding.check, finding.message)
 * }
 * ```
 */
export async function* driverFindings(
	factory: () => DriverInterface,
): AsyncIterable<ConformanceFinding> {
	// Fixed two-table schema every phase opens: `users` keyed by `id` (the
	// default primary), `posts` keyed by a non-id `slug` — exercising both
	// primary-key shapes in one battery.
	const CONFORMANCE_USERS_SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', type: 'text', nullable: false },
			{ name: 'name', type: 'text', nullable: false },
			{ name: 'age', type: 'integer', nullable: true },
			// Declared so the nested-roundtrip phase is fair to typed-column
			// backends (a SQL driver persists only declared columns; schemaless
			// backends ignore declarations entirely).
			{ name: 'meta', type: 'json', nullable: true },
		],
		indexes: [],
	}
	const CONFORMANCE_POSTS_SCHEMA: TableSchema = {
		name: 'posts',
		primary: 'slug',
		columns: [
			{ name: 'slug', type: 'text', nullable: false },
			{ name: 'title', type: 'text', nullable: false },
		],
		indexes: [],
	}
	const CONFORMANCE_SCHEMA: readonly TableSchema[] = [
		CONFORMANCE_USERS_SCHEMA,
		CONFORMANCE_POSTS_SCHEMA,
	]
	// Build a ConformanceFinding naming which check failed plus the
	// expected/actual summary — the single failure-reporting shape every
	// phase below funnels through (returned, never thrown).
	const findingOf = (
		check: string,
		message: string,
		context: Readonly<Record<string, unknown>>,
	): ConformanceFinding => ({ check, message, context })

	type Phase = {
		readonly check: string
		readonly run: () => Promise<ConformanceFinding | undefined>
	}

	const phases: readonly Phase[] = [
		// a. open with the inline two-table schema, then close cleanly.
		{
			check: 'open-close',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				await driver.close()
				return undefined
			},
		},

		// b. read of a missing key -> undefined.
		{
			check: 'read-missing',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				const missing = await driver.read('users', 'nope')
				await driver.close()
				if (missing !== undefined) {
					return findingOf('read-missing', 'read of a missing key must return undefined', {
						table: 'users',
						expected: undefined,
						actual: missing,
					})
				}
				return undefined
			},
		},

		// c. write/read round-trip, copy-in/copy-out isolation (including NESTED
		// fields, not just top-level ones), upsert-overwrite.
		{
			check: 'write-read',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				const input: Row = { id: 'u1', name: 'Ada', age: 30, meta: { tags: ['a'] } }
				await driver.write('users', 'u1', input)
				input.name = 'Mutated after write'
				// Mutate a NESTED field of the input after write — a shallow copy-in
				// would still share the nested object by reference.
				if (isRecord(input.meta) && Array.isArray(input.meta.tags)) input.meta.tags.push('mutated')
				const stored = await driver.read('users', 'u1')
				const original = { id: 'u1', name: 'Ada', age: 30, meta: { tags: ['a'] } }
				if (stored === undefined || !deepEqual(stored, original)) {
					await driver.close()
					return findingOf(
						'copy-in',
						'write must deep-copy the input row (including nested fields) rather than store it by reference',
						{ table: 'users', expected: original, actual: stored },
					)
				}
				stored.name = 'Mutated after read'
				// Mutate a NESTED field of the read result — a shallow copy-out would
				// still share the nested object with stored state.
				if (isRecord(stored.meta) && Array.isArray(stored.meta.tags))
					stored.meta.tags.push('mutated')
				const reread = await driver.read('users', 'u1')
				if (reread === undefined || !deepEqual(reread, original)) {
					await driver.close()
					return findingOf(
						'copy-out',
						'read must deep-copy the stored row (including nested fields) rather than return it by reference',
						{ table: 'users', expected: original, actual: reread },
					)
				}
				const overwrite = { id: 'u1', name: 'Ada Overwritten', age: 31 }
				await driver.write('users', 'u1', overwrite)
				const overwritten = await driver.read('users', 'u1')
				await driver.close()
				if (overwritten === undefined || !deepEqual(overwritten, overwrite)) {
					return findingOf('upsert', 'write must upsert-overwrite an existing key', {
						table: 'users',
						expected: overwrite,
						actual: overwritten,
					})
				}
				return undefined
			},
		},

		// d. delete -> true then false.
		{
			check: 'delete',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
				const first = await driver.delete('users', 'u1')
				if (first !== true) {
					await driver.close()
					return findingOf('delete-true', 'delete of an existing key must return true', {
						table: 'users',
						expected: true,
						actual: first,
					})
				}
				const second = await driver.delete('users', 'u1')
				await driver.close()
				if (second !== false) {
					return findingOf('delete-false', 'delete of an already-removed key must return false', {
						table: 'users',
						expected: false,
						actual: second,
					})
				}
				return undefined
			},
		},

		// e. keys and scan in ascending key order.
		{
			check: 'order',
			run: async () => {
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
				if (!deepEqual(keys, expected)) {
					await driver.close()
					return findingOf('keys-order', 'keys must be returned in ascending key order', {
						table: 'users',
						expected,
						actual: keys,
					})
				}
				const scanned: Row[] = []
				for await (const row of driver.scan('users')) scanned.push(row)
				const scannedIds = scanned.map((row) => row.id)
				await driver.close()
				if (!deepEqual(scannedIds, expected)) {
					return findingOf('scan-order', 'scan must yield rows in ascending key order', {
						table: 'users',
						expected,
						actual: scannedIds,
					})
				}
				return undefined
			},
		},

		// f. clear empties only the targeted table.
		{
			check: 'clear',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
				await driver.write('posts', 'p1', { slug: 'p1', title: 'Post' })
				await driver.clear('users')
				const usersKeys = await driver.keys('users')
				const postsKeys = await driver.keys('posts')
				await driver.close()
				if (usersKeys.length !== 0) {
					return findingOf('clear-target', 'clear must empty the targeted table', {
						table: 'users',
						expected: [],
						actual: usersKeys,
					})
				}
				if (postsKeys.length !== 1) {
					return findingOf('clear-other', 'clear must not affect other tables', {
						table: 'posts',
						expected: 1,
						actual: postsKeys.length,
					})
				}
				return undefined
			},
		},

		// g. snapshot rollback restores pre-snapshot state.
		{
			check: 'snapshot',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				const original = { id: 'u1', name: 'Ada', age: 30 }
				await driver.write('users', 'u1', original)
				const rollback = await driver.snapshot()
				await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40 })
				await driver.delete('users', 'u1')
				await rollback()
				const keys = [...(await driver.keys('users'))]
				if (!deepEqual(keys, ['u1'])) {
					await driver.close()
					return findingOf(
						'snapshot-rollback',
						'snapshot rollback must restore the pre-snapshot key set',
						{ table: 'users', expected: ['u1'], actual: keys },
					)
				}
				const restored = await driver.read('users', 'u1')
				await driver.close()
				if (restored === undefined || !deepEqual(restored, original)) {
					return findingOf(
						'snapshot-rollback-value',
						'snapshot rollback must restore pre-snapshot row values',
						{ table: 'users', expected: original, actual: restored },
					)
				}
				return undefined
			},
		},

		// g2. snapshot rollback survives a NESTED field mutated in place, on a
		// row already read back, BETWEEN capture and restore — a snapshot that
		// only clones top-level fields (or shares nested references) would
		// restore a mutated nested value instead of the pre-snapshot one.
		{
			check: 'snapshot-nested',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				const original = { id: 'u3', name: 'Nested', age: 20, meta: { tags: ['a'] } }
				await driver.write('users', 'u3', original)
				const rollback = await driver.snapshot()
				const before = await driver.read('users', 'u3')
				if (isRecord(before) && isRecord(before.meta) && Array.isArray(before.meta.tags)) {
					before.meta.tags.push('mutated-before-restore')
				}
				await driver.write('users', 'u3', {
					id: 'u3',
					name: 'Nested',
					age: 20,
					meta: { tags: ['a', 'mutated-after-write'] },
				})
				await rollback()
				const restored = await driver.read('users', 'u3')
				await driver.close()
				if (restored === undefined || !deepEqual(restored, original)) {
					return findingOf(
						'snapshot-nested',
						'snapshot rollback must restore pre-snapshot nested field values, unaffected by a later in-place mutation of a read-back row',
						{ table: 'users', expected: original, actual: restored },
					)
				}
				return undefined
			},
		},

		// h. non-id primary extraction (posts keyed by slug).
		{
			check: 'non-id-primary',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				await driver.write('posts', 'hello-world', { slug: 'hello-world', title: 'Hello' })
				const post = await driver.read('posts', 'hello-world')
				const key = post === undefined ? undefined : extractKey(post, 'slug')
				await driver.close()
				if (key !== 'hello-world') {
					return findingOf(
						'non-id-primary',
						'a non-id primary key column must round-trip through the store',
						{ table: 'posts', expected: 'hello-world', actual: key },
					)
				}
				return undefined
			},
		},

		// i. nested-object row round-trip (structural, via deepEqual).
		{
			check: 'nested-roundtrip',
			run: async () => {
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
				if (readBack === undefined || !deepEqual(readBack, nested)) {
					return findingOf('nested-roundtrip', 'a nested-object row must round-trip structurally', {
						table: 'users',
						expected: nested,
						actual: readBack,
					})
				}
				return undefined
			},
		},

		// j. migrate (presence-gated): a planMigration-built column.remove plan strips
		// stored rows; an unknown-table plan throws a MIGRATION DatabaseError.
		{
			check: 'migrate',
			run: async () => {
				const driver = factory()
				if (driver.migrate === undefined) return undefined
				// Open with the DEPLOYED schema so `legacy` is a declared column —
				// a typed-column backend persists only declared columns and can only
				// drop a column that really exists; schemaless backends are unaffected.
				const deployedUsers: TableSchema = {
					...CONFORMANCE_USERS_SCHEMA,
					columns: [
						...CONFORMANCE_USERS_SCHEMA.columns,
						{ name: 'legacy', type: 'boolean', nullable: true },
					],
				}
				await driver.open([deployedUsers, CONFORMANCE_POSTS_SCHEMA])
				await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30, legacy: true })
				const removePlan = planMigration([deployedUsers], [CONFORMANCE_USERS_SCHEMA])
				await driver.migrate(removePlan)
				const migrated = await driver.read('users', 'u1')
				if (migrated === undefined || 'legacy' in migrated) {
					await driver.close()
					return findingOf(
						'migrate-column-remove',
						'a column.remove migration must strip the column from stored rows',
						{
							table: 'users',
							expected: undefined,
							actual: migrated === undefined ? undefined : migrated.legacy,
						},
					)
				}
				let caught: unknown
				try {
					await driver.migrate({
						from: 0,
						to: 1,
						steps: [{ operation: 'table.remove', table: 'ghost' }],
					})
				} catch (error) {
					caught = error
				}
				await driver.close()
				if (!isDatabaseError(caught) || caught.code !== 'MIGRATION') {
					return findingOf(
						'migrate-unknown-table',
						'a migration step referencing an unknown table must throw a MIGRATION DatabaseError',
						{
							table: 'ghost',
							expected: 'MIGRATION',
							actual: isDatabaseError(caught) ? caught.code : caught,
						},
					)
				}
				return undefined
			},
		},

		// k. stream (presence-gated): yields only condition-matching rows, honors offset/limit.
		{
			check: 'stream',
			run: async () => {
				const driver = factory()
				if (driver.stream === undefined) return undefined
				await driver.open(CONFORMANCE_SCHEMA)
				const rows = [
					{ id: 'a', name: 'A', age: 10 },
					{ id: 'b', name: 'B', age: 20 },
					{ id: 'c', name: 'C', age: 30 },
				]
				for (const row of rows) await driver.write('users', row.id, row)
				const criteria: Criteria = {
					conditions: [{ column: 'age', operator: 'above', values: [10], connector: 'and' }],
				}
				const matched: Row[] = []
				for await (const row of driver.stream('users', criteria)) matched.push(row)
				const matchedIds = matched.map((row) => row.id).sort()
				if (!deepEqual(matchedIds, ['b', 'c'])) {
					await driver.close()
					return findingOf('stream-match', 'stream must yield only condition-matching rows', {
						table: 'users',
						expected: ['b', 'c'],
						actual: matchedIds,
					})
				}
				const paged: Row[] = []
				for await (const row of driver.stream('users', { offset: 1, limit: 1 })) paged.push(row)
				await driver.close()
				if (paged.length !== 1) {
					return findingOf('stream-page', 'stream must honor offset and limit', {
						table: 'users',
						expected: 1,
						actual: paged.length,
					})
				}
				return undefined
			},
		},

		// l. transaction (presence-gated): commit persists, rollback restores.
		{
			check: 'transaction',
			run: async () => {
				const driver = factory()
				if (driver.transaction === undefined) return undefined
				await driver.open(CONFORMANCE_SCHEMA)
				await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
				const committing = await driver.transaction()
				await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40 })
				await committing.commit()
				const afterCommit = [...(await driver.keys('users'))].sort()
				if (!deepEqual(afterCommit, ['u1', 'u2'])) {
					await driver.close()
					return findingOf(
						'transaction-commit',
						'transaction commit must persist writes made during the scope',
						{ table: 'users', expected: ['u1', 'u2'], actual: afterCommit },
					)
				}
				const rollingBack = await driver.transaction()
				await driver.write('users', 'u3', { id: 'u3', name: 'Marie', age: 50 })
				await rollingBack.rollback()
				const afterRollback = [...(await driver.keys('users'))].sort()
				await driver.close()
				if (!deepEqual(afterRollback, ['u1', 'u2'])) {
					return findingOf(
						'transaction-rollback',
						'transaction rollback must restore pre-transaction state',
						{ table: 'users', expected: ['u1', 'u2'], actual: afterRollback },
					)
				}
				return undefined
			},
		},

		// m. meta/stamp (presence-gated: a driver implements both or neither). A
		// fresh store's meta() is undefined; after stamp({ version, schema }),
		// meta() returns exactly the stamped value.
		{
			check: 'meta-stamp',
			run: async () => {
				const driver = factory()
				if (driver.meta === undefined || driver.stamp === undefined) return undefined
				await driver.open(CONFORMANCE_SCHEMA)
				const fresh = await driver.meta()
				if (fresh !== undefined) {
					await driver.close()
					return findingOf('meta-fresh', 'a fresh store must report undefined meta', {
						expected: undefined,
						actual: fresh,
					})
				}
				const stamped = { version: 1, schema: CONFORMANCE_SCHEMA }
				await driver.stamp(stamped)
				const read = await driver.meta()
				await driver.close()
				if (read === undefined || !deepEqual(read, stamped)) {
					return findingOf('meta-stamp', 'meta() must return exactly the last-stamped value', {
						expected: stamped,
						actual: read,
					})
				}
				return undefined
			},
		},

		// n. scoped snapshot: snapshot(['users']) rolls back only the named
		// table — a concurrent mutation to another table survives the rollback.
		{
			check: 'snapshot-scoped',
			run: async () => {
				const driver = factory()
				await driver.open(CONFORMANCE_SCHEMA)
				const original = { id: 'u1', name: 'Ada', age: 30 }
				await driver.write('users', 'u1', original)
				await driver.write('posts', 'p1', { slug: 'p1', title: 'Post' })
				const rollback = await driver.snapshot(['users'])
				await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40 })
				await driver.write('posts', 'p2', { slug: 'p2', title: 'Another post' })
				await rollback()
				const usersKeys = [...(await driver.keys('users'))]
				if (!deepEqual(usersKeys, ['u1'])) {
					await driver.close()
					return findingOf(
						'snapshot-scoped-users',
						'a scoped snapshot must roll back only the named table',
						{ table: 'users', expected: ['u1'], actual: usersKeys },
					)
				}
				const postsKeys = [...(await driver.keys('posts'))].sort()
				await driver.close()
				if (!deepEqual(postsKeys, ['p1', 'p2'])) {
					return findingOf(
						'snapshot-scoped-posts',
						"a scoped snapshot must leave an unnamed table's mutations intact",
						{ table: 'posts', expected: ['p1', 'p2'], actual: postsKeys },
					)
				}
				return undefined
			},
		},
	]

	for (const phase of phases) {
		try {
			const finding = await phase.run()
			if (finding !== undefined) yield finding
		} catch (error) {
			yield findingOf(phase.check, error instanceof Error ? error.message : String(error), {
				error,
			})
		}
	}
}

/**
 * Run the driver-conformance battery, throwing on the first violated
 * invariant — the fail-fast entry point most callers (test setup, CI smoke
 * checks) want.
 *
 * @remarks
 * A thin driver over {@link driverFindings}: because that generator is
 * lazy, consuming only its first yielded value means every LATER phase
 * never runs — true fail-fast, not merely "report only the first". The
 * thrown error is byte-compatible with the historical shape: a
 * `CONFORMANCE` {@link DatabaseError} whose `message` is the finding's
 * `message` and whose `context` is `{ check, ...finding.context }`.
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
	for await (const finding of driverFindings(factory)) {
		throw new DatabaseError('CONFORMANCE', finding.message, {
			check: finding.check,
			...finding.context,
		})
	}
}

/**
 * Run the FULL driver-conformance battery and collect every violation — the
 * audit entry point for a driver author who wants a complete report rather
 * than a single fail-fast throw.
 *
 * @remarks
 * Drains {@link driverFindings} to completion: every phase runs regardless
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
	for await (const finding of driverFindings(factory)) findings.push(finding)
	return findings
}

// === Identifiers

/**
 * Generate an RFC 4122 version 4 UUID from a number source — no host crypto global.
 *
 * @remarks
 * Draws exactly {@link UUID_BYTE_COUNT} values from `random`, one per byte, then
 * forces the version (`4`) and variant (`10xx`) bits. The default source is
 * `Math.random` — a pure-ECMAScript intrinsic, so generation works on every host;
 * pass a seeded source (`seededRandom` from `@orkestrel/contract`) and reuse it
 * across calls for reproducible sequences in tests and fixtures — production
 * identifiers should keep the default source, whose engine entropy is far larger
 * than a 32-bit seed. Each byte is floored and masked, so a source straying
 * outside `[0, 1)` (negative, `>= 1`, `NaN`, `Infinity`) can never yield a
 * malformed UUID. Suitable as a collision-resistant record identifier — not a
 * cryptographic token; never use one as a secret.
 *
 * @param random - A number source returning values in the half-open range `[0, 1)` (defaults to `Math.random`)
 * @returns A lowercase RFC 4122 version 4 UUID
 *
 * @example
 * ```ts
 * import { generateUUID } from '@orkestrel/database'
 * import { seededRandom } from '@orkestrel/contract'
 *
 * generateUUID() // e.g. '9b2f7c1e-3d4a-4f6b-8e2d-5a1c0b9f8e7d'
 * generateUUID(seededRandom(42)) // the same UUID on every run
 * ```
 */
export function generateUUID(random: RandomFunction = Math.random): string {
	const bytes = Array.from(
		{ length: UUID_BYTE_COUNT },
		() => Math.floor(random() * UUID_BYTE_RANGE) & 0xff,
	)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0'))
	return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}
