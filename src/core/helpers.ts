import type { ContractShape, FieldPath } from '@orkestrel/contract'
import type {
	AggregateOperation,
	ColumnSchema,
	ColumnStorage,
	ConformanceFinding,
	Condition,
	QueryInput,
	DriverInterface,
	Key,
	Migration,
	MigrationStep,
	Order,
	Row,
	TableSchema,
} from './types.js'
import {
	compileGuard,
	isRecord,
	isString,
	objectShape,
	parseNumber,
	resolveField,
} from '@orkestrel/contract'
import { MAX_PATTERN_LENGTH } from './constants.js'
import { cloneDriverSchema, cloneMigrationInput } from './cloners.js'
import { DatabaseError, isDatabaseError } from './errors.js'
import { isKey, validatePage } from './validators.js'

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
	// Mapping two inputs always produces two ranks; the defaults only satisfy
	// unchecked indexed destructuring and are semantically unreachable.
	const [leftRank = 5, rightRank = 5] = [left, right].map((value) =>
		value === undefined
			? 0
			: value === null
				? 1
				: typeof value === 'boolean'
					? 2
					: typeof value === 'number'
						? 3
						: typeof value === 'string'
							? 4
							: 5,
	)
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
 * Arrays compare by index (same length, every element `equalsValue`). Plain
 * records (via `isRecord`) compare by their OWN enumerable keys: same key
 * COUNT and, for every key in `left`, `right` has that key (`Object.hasOwn`)
 * with a `equalsValue` value — so a key present with value `undefined` is NOT
 * equal to that key being absent (both differ in `Object.keys` membership).
 * Anything else (functions, class instances, mismatched shapes) falls through
 * to `false`. Container pairs are tracked iteratively, so self-referential and
 * mutually cyclic arrays/records terminate without consuming the call stack.
 * Hostile proxy traps and accessors are contained as a non-match.
 *
 * @param left - The left value
 * @param right - The right value
 * @returns Whether `left` and `right` are structurally equal
 *
 * @example
 * ```ts
 * equalsValue(Number.NaN, Number.NaN) // true
 * equalsValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) // true
 * equalsValue({ a: undefined }, {}) // false — present-undefined ≠ absent
 * ```
 */
export function equalsValue(left: unknown, right: unknown): boolean {
	const pending: Array<readonly [unknown, unknown]> = [[left, right]]
	const compared = new WeakMap<object, WeakSet<object>>()
	try {
		while (pending.length > 0) {
			const pair = pending.pop()
			if (pair === undefined) continue
			const [currentLeft, currentRight] = pair
			if (typeof currentLeft === 'number' && typeof currentRight === 'number') {
				if (
					(Number.isNaN(currentLeft) && Number.isNaN(currentRight)) ||
					currentLeft === currentRight
				) {
					continue
				}
				return false
			}
			if (currentLeft === currentRight) continue

			const leftArray = Array.isArray(currentLeft)
			const rightArray = Array.isArray(currentRight)
			const leftRecord = isRecord(currentLeft)
			const rightRecord = isRecord(currentRight)
			if (leftArray !== rightArray || leftRecord !== rightRecord) return false
			if ((!leftArray && !leftRecord) || (!rightArray && !rightRecord)) return false

			const prior = compared.get(currentLeft)
			if (prior?.has(currentRight)) continue
			if (prior === undefined) {
				compared.set(currentLeft, new WeakSet([currentRight]))
			} else {
				prior.add(currentRight)
			}

			if (leftArray && rightArray) {
				if (currentLeft.length !== currentRight.length) return false
				for (let index = 0; index < currentLeft.length; index += 1) {
					const leftOwn = Object.hasOwn(currentLeft, index)
					const rightOwn = Object.hasOwn(currentRight, index)
					if (leftOwn !== rightOwn) return false
					if (leftOwn) pending.push([currentLeft[index], currentRight[index]])
				}
				continue
			}
			if (leftRecord && rightRecord) {
				const leftKeys = Object.keys(currentLeft)
				const rightKeys = Object.keys(currentRight)
				if (leftKeys.length !== rightKeys.length) return false
				for (const key of leftKeys) {
					if (!Object.hasOwn(currentRight, key)) return false
					pending.push([currentLeft[key], currentRight[key]])
				}
			}
		}
		return true
	} catch {
		return false
	}
}

// === Pattern matching

/**
 * Match a query against a value as a case-insensitive ordered subsequence.
 *
 * @remarks
 * Every query character must appear in order in the value, but the characters
 * do not need to be contiguous. Query characters are literal, including
 * whitespace. Matching applies JavaScript `toLowerCase()` to both inputs
 * without locale-specific folding or Unicode normalization. An empty query
 * matches every value.
 *
 * @param value - The text searched for the query's characters
 * @param query - The characters that must all appear in order
 * @returns Whether the case-folded query is a subsequence of the case-folded value
 *
 * @example
 * ```ts
 * matchesFuzzy('Database', 'dbe') // true
 * matchesFuzzy('Database', 'abd') // false
 * ```
 */
export function matchesFuzzy(value: string, query: string): boolean {
	const folded = value.toLowerCase()
	const wanted = query.toLowerCase()
	let cursor = 0
	for (const char of wanted) {
		const found = folded.indexOf(char, cursor)
		if (found === -1) return false
		cursor = found + 1
	}
	return true
}

/**
 * Match a value against a wildcard pattern in LINEAR time — the shared, ReDoS-SAFE
 * engine behind {@link matchesLikePattern} and {@link matchesGlobPattern}.
 *
 * @remarks
 * A backtracking RegExp (`a%b%c` → `^a.*b.*c$`) is CATASTROPHIC on a hostile pattern:
 * `.*` segments separated by literals, matched against a long non-matching input, blow
 * up super-linearly — and JS has no atomic groups / possessive quantifiers to bound it
 * (AGENTS §6.5, now that the authed server runs model-supplied `list` input over the
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
export function matchesWildcardPattern(
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
export function matchesLikePattern(value: string, pattern: string): boolean {
	return matchesWildcardPattern(value, pattern, '%', '_', true)
}

// `GLOB` → case-SENSITIVE wildcard match (`*` any run, `?` any char).
export function matchesGlobPattern(value: string, pattern: string): boolean {
	return matchesWildcardPattern(value, pattern, '*', '?', false)
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
 * / `any` / `none`) uses {@link equalsValue} — STRUCTURAL equality, not the total
 * order's rank-5-collapses-all-objects behavior, so `equals` on an object/array
 * operand only matches a structurally-equal value, never every row holding any
 * object. This is a semantics change from ranking: `equalsValue` is SameValueZero
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
			return equalsValue(value, first)
		case 'not':
			return !equalsValue(value, first)
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
			return isString(value) && isString(first) && matchesLikePattern(value, first)
		case 'glob':
			return isString(value) && isString(first) && matchesGlobPattern(value, first)
		case 'starts':
			return isString(value) && isString(first) && value.startsWith(first)
		case 'ends':
			return isString(value) && isString(first) && value.endsWith(first)
		case 'any':
			return condition.values.some((candidate) => equalsValue(value, candidate))
		case 'none':
			return !condition.values.some((candidate) => equalsValue(value, candidate))
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
export function matchesQuery(row: Row, conditions: readonly Condition[]): boolean {
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
 * and aggregate paths (no sort/page, unlike {@link applyQuery}).
 *
 * @remarks
 * An empty condition list matches every row (returned as-is, no copy). Folds
 * each row through {@link matchesQuery}.
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
	return rows.filter((row) => matchesQuery(row, conditions))
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
 * Apply a {@link QueryInput} to rows — filter, then sort, then page.
 *
 * @remarks
 * The whole portable read pipeline in one place: conditions filter, `order`
 * sorts, and `offset` / `limit` window the result. Each step is skipped when its
 * part of the input is absent. The reference {@link DriverInterface} backends
 * lean on this rather than each re-deriving it.
 *
 * @param rows - The rows to process (typically a table's full `scan`)
 * @param input - The read specification, or `undefined` for all rows as-is
 * @returns The filtered, sorted, paged rows
 */
export function applyQuery(rows: readonly Row[], input?: QueryInput): readonly Row[] {
	validatePage(input)
	let result = rows
	const conditions = input?.conditions
	if (conditions !== undefined && conditions.length > 0) {
		result = result.filter((row) => matchesQuery(row, conditions))
	}
	const order = input?.order
	if (order !== undefined && order.length > 0) {
		result = sortRows(result, order)
	}
	const offset = input?.offset ?? 0
	const limit = input?.limit
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
	operation: AggregateOperation,
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
	return isKey(value) ? value : undefined
}

/**
 * Return a fresh row whose primary column is authoritatively bound to its storage key.
 *
 * @param row - The caller row
 * @param primary - The primary column
 * @param key - The authoritative storage key
 * @returns A fresh row with the bound primary
 */
export function bindRowKey(row: Row, primary: string, key: Key): Row {
	return { ...row, [primary]: key }
}

// === Schema

/**
 * Map a column's {@link ContractShape} to its portable {@link ColumnStorage} — the
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
 * shapeToColumnStorage(stringShape()) // 'text'
 * shapeToColumnStorage(integerShape()) // 'integer'
 * shapeToColumnStorage(optionalShape(integerShape())) // 'integer'
 * shapeToColumnStorage(objectShape({ a: stringShape() })) // 'json'
 * ```
 */
export function shapeToColumnStorage(shape: ContractShape): ColumnStorage {
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
			return shapeToColumnStorage(shape.inner)
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
 * Project one contract shape into a portable column schema.
 *
 * @param name - The column name
 * @param shape - The column contract shape
 * @returns The portable storage and independent absence/null acceptance
 */
export function shapeToColumnSchema(name: string, shape: ContractShape): ColumnSchema {
	const isColumn = compileGuard(objectShape({ value: shape }))
	return {
		name,
		storage: shapeToColumnStorage(shape),
		optional: isColumn({}),
		nullable: isColumn({ value: null }),
	}
}

// === Abort

/**
 * Throw when an {@link OperationOptions.signal | AbortSignal} has fired — the shared
 * abort gate checked at operation boundaries and between streamed rows.
 *
 * @remarks
 * A no-op for `undefined` or a live signal, so callers thread `options?.signal`
 * straight through. When the signal has aborted, throws an `ABORTED`
 * {@link DatabaseError} carrying the signal's `reason` in its context — callers
 * mint signals with native APIs such as `AbortSignal.timeout(ms)` or
 * `new AbortController()`.
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
 * plan labels only; versioning drivers persist and reconcile them through
 * {@link DriverMetadata}.
 *
 * A column present in BOTH schemas under the same name but with a different
 * `storage`, `optional`, or `nullable` value throws a `MIGRATION`
 * {@link DatabaseError} naming the
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
	if (!Number.isFinite(from) || !Number.isFinite(to)) {
		throw new DatabaseError('MIGRATION', 'Migration versions must be finite', { from, to })
	}
	let beforeSchema: readonly TableSchema[]
	let targetSchema: readonly TableSchema[]
	try {
		beforeSchema = normalizeDriverSchema(deployed)
		targetSchema = normalizeDriverSchema(declared)
	} catch (error) {
		throw new DatabaseError('MIGRATION', 'Migration schema is invalid', { cause: error })
	}
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
 * Sequentially project migration steps over a canonical validated owned schema.
 * Adding a required non-null column to an existing table rejects with
 * `MIGRATION`; optional-only and nullable-only additions remain portable.
 *
 * @param schema - The initial deployed schema
 * @param steps - The ordered migration steps
 * @returns A fresh owned final schema
 */
export function projectMigrationSchema(
	schema: readonly TableSchema[],
	steps: readonly MigrationStep[],
): readonly TableSchema[] {
	let owned: readonly TableSchema[]
	let projectedSteps: readonly MigrationStep[]
	try {
		owned = normalizeDriverSchema(schema)
		projectedSteps = cloneMigrationInput({ plan: { from: 0, to: 1, steps } }).plan.steps
	} catch (error) {
		throw new DatabaseError('MIGRATION', 'Migration input is invalid', { cause: error })
	}
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

/**
 * Canonicalize an unknown driver schema into a distinct deeply frozen snapshot.
 *
 * @remarks
 * Table and column lists are sorted by name. The index list is sorted by the
 * complete serialized tuple while column order inside each compound index is
 * preserved because it carries index semantics. Validation and ownership flow
 * through {@link cloneDriverSchema} before and after projection.
 *
 * @param value - Unknown driver schema
 * @returns A validated, owned canonical schema
 */
export function normalizeDriverSchema(value: unknown): readonly TableSchema[] {
	const owned = cloneDriverSchema(value)
	const tables = owned.map((table) => ({
		name: table.name,
		primary: table.primary,
		columns: [...table.columns].sort((left, right) => compareValues(left.name, right.name)),
		indexes: [...table.indexes].sort((left, right) =>
			compareValues(JSON.stringify(left), JSON.stringify(right)),
		),
	}))
	tables.sort((left, right) => compareValues(left.name, right.name))
	return cloneDriverSchema(tables)
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
 * stored state) and upsert-overwrite; simultaneous same-key `insert` calls
 * produce exactly one commit and one `CONFLICT`; pre-aborted `write`,
 * `insert`, and `delete` calls leave storage unchanged; `delete` returns
 * `true` then `false`;
 * `keys`/`scan` yield in ascending key order; `clear` empties only its target
 * table; `snapshot`'s rollback thunk restores pre-snapshot state, including a
 * NESTED field mutated in place on a read-back row between capture and
 * restore; a scoped `snapshot(['users'])` rolls back only the named table,
 * leaving a concurrent mutation to another table intact; a
 * non-`id` primary key (`posts.slug`) round-trips; a nested-object row
 * round-trips structurally (via {@link equalsValue}). The optional surface is
 * presence-gated: when `migrate` exists, a `column.remove` plan strips the
 * column from stored rows and a plan referencing an unknown table throws
 * `DatabaseError` `MIGRATION`; when `stream` exists, it yields only
 * condition-matching rows and honors `offset`/`limit`; when `transaction`
 * exists, `commit` persists and `rollback` restores; when both `metadata` and
 * `stamp` exist, a fresh store's `metadata()` is `undefined`, and after
 * `stamp({ version, schema })`, `metadata()` returns the exact stamped value.
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
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: true, nullable: false },
			// Declared so the nested-roundtrip phase is fair to typed-column
			// backends (a SQL driver persists only declared columns; schemaless
			// backends ignore declarations entirely).
			{ name: 'meta', storage: 'json', optional: true, nullable: false },
		],
		indexes: [],
	}
	const CONFORMANCE_POSTS_SCHEMA: TableSchema = {
		name: 'posts',
		primary: 'slug',
		columns: [
			{ name: 'slug', storage: 'text', optional: false, nullable: false },
			{ name: 'title', storage: 'text', optional: false, nullable: false },
		],
		indexes: [],
	}
	const CONFORMANCE_SCHEMA: readonly TableSchema[] = [
		CONFORMANCE_USERS_SCHEMA,
		CONFORMANCE_POSTS_SCHEMA,
	]
	// a. open with the inline two-table schema, then close cleanly.
	try {
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.close()
	} catch (error) {
		yield {
			check: 'open-close',
			message: error instanceof Error ? error.message : String(error),
			context: { error },
		}
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
		yield {
			check: 'read-missing',
			message: error instanceof Error ? error.message : String(error),
			context: { error },
		}
	}

	// c. write/read round-trip, copy-in/copy-out isolation (including NESTED
	// fields, not just top-level ones), upsert-overwrite.
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
			yield {
				check: 'write-read',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
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
			let fulfilled = 0
			let conflicted = 0
			for (const outcome of outcomes) {
				if (outcome.status === 'fulfilled') fulfilled += 1
				else if (isDatabaseError(outcome.reason) && outcome.reason.code === 'CONFLICT') {
					conflicted += 1
				}
			}
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
			yield {
				check: 'insert-atomic',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
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
			yield {
				check: 'delete',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
		}
	}

	// d2. pre-aborted point mutations reject as ABORTED without changing rows.
	try {
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
		const controller = new AbortController()
		controller.abort('conformance abort')
		let writeError: unknown
		let insertError: unknown
		let deleteError: unknown
		try {
			await driver.write(
				'users',
				'u2',
				{ id: 'u2', name: 'Grace', age: 40 },
				{ signal: controller.signal },
			)
		} catch (error) {
			writeError = error
		}
		try {
			await driver.insert(
				'users',
				'u2',
				{ id: 'u2', name: 'Grace', age: 40 },
				{ signal: controller.signal },
			)
		} catch (error) {
			insertError = error
		}
		try {
			await driver.delete('users', 'u1', { signal: controller.signal })
		} catch (error) {
			deleteError = error
		}
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
		yield {
			check: 'mutation-abort',
			message: error instanceof Error ? error.message : String(error),
			context: { error },
		}
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
			yield {
				check: 'order',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
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
			yield {
				check: 'clear',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
		}
	}

	// g. snapshot rollback restores pre-snapshot state.
	snapshotPhase: {
		try {
			const driver = factory()
			await driver.open(CONFORMANCE_SCHEMA)
			const original = { id: 'u1', name: 'Ada', age: 30 }
			await driver.write('users', 'u1', original)
			const rollback = await driver.snapshot()
			await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40 })
			await driver.delete('users', 'u1')
			await rollback()
			const keys = [...(await driver.keys('users'))]
			if (!equalsValue(keys, ['u1'])) {
				await driver.close()
				yield {
					check: 'snapshot-rollback',
					message: 'snapshot rollback must restore the pre-snapshot key set',
					context: { table: 'users', expected: ['u1'], actual: keys },
				}
				break snapshotPhase
			}
			const restored = await driver.read('users', 'u1')
			await driver.close()
			if (restored === undefined || !equalsValue(restored, original)) {
				yield {
					check: 'snapshot-rollback-value',
					message: 'snapshot rollback must restore pre-snapshot row values',
					context: { table: 'users', expected: original, actual: restored },
				}
			}
		} catch (error) {
			yield {
				check: 'snapshot',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
		}
	}

	// g2. snapshot rollback survives a nested field mutated between capture and restore.
	try {
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
		if (restored === undefined || !equalsValue(restored, original)) {
			yield {
				check: 'snapshot-nested',
				message:
					'snapshot rollback must restore pre-snapshot nested field values, unaffected by a later in-place mutation of a read-back row',
				context: { table: 'users', expected: original, actual: restored },
			}
		}
	} catch (error) {
		yield {
			check: 'snapshot-nested',
			message: error instanceof Error ? error.message : String(error),
			context: { error },
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
		yield {
			check: 'non-id-primary',
			message: error instanceof Error ? error.message : String(error),
			context: { error },
		}
	}

	// i. nested-object row round-trip (structural, via equalsValue).
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
		yield {
			check: 'nested-roundtrip',
			message: error instanceof Error ? error.message : String(error),
			context: { error },
		}
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
			const removePlan = planMigration([deployedUsers], [CONFORMANCE_USERS_SCHEMA])
			await driver.migrate({ plan: removePlan })
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
			let caught: unknown
			try {
				await driver.migrate({
					plan: {
						from: 0,
						to: 1,
						steps: [{ operation: 'table.remove', table: 'ghost' }],
					},
				})
			} catch (error) {
				caught = error
			}
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
			yield {
				check: 'migrate',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
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
			yield {
				check: 'stream',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
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
			try {
				await driver.transaction(async (transaction) => {
					await transaction.write('users', 'u3', { id: 'u3', name: 'Marie', age: 50 })
					throw reason
				})
			} catch (error) {
				if (error !== reason) throw error
			}
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
			yield {
				check: 'transaction',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
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
			yield {
				check: 'metadata-stamp',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
		}
	}

	// n. scoped snapshot rolls back only the named table.
	scopedPhase: {
		try {
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
			if (!equalsValue(usersKeys, ['u1'])) {
				await driver.close()
				yield {
					check: 'snapshot-scoped-users',
					message: 'a scoped snapshot must roll back only the named table',
					context: { table: 'users', expected: ['u1'], actual: usersKeys },
				}
				break scopedPhase
			}
			const postsKeys = [...(await driver.keys('posts'))].sort()
			await driver.close()
			if (!equalsValue(postsKeys, ['p1', 'p2'])) {
				yield {
					check: 'snapshot-scoped-posts',
					message: "a scoped snapshot must leave an unnamed table's mutations intact",
					context: { table: 'posts', expected: ['p1', 'p2'], actual: postsKeys },
				}
			}
		} catch (error) {
			yield {
				check: 'snapshot-scoped',
				message: error instanceof Error ? error.message : String(error),
				context: { error },
			}
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
