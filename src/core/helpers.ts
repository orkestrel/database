import type { ContractShape, FieldPath } from '@orkestrel/contract'
import type {
	AggregateFunction,
	ColumnType,
	Condition,
	Criteria,
	Key,
	Order,
	Row,
} from './types.js'
import { isFiniteNumber, isRecord, isString, parseNumber, resolveField } from '@orkestrel/contract'
import { MAX_PATTERN_LENGTH } from './constants.js'
import { DatabaseError } from './errors.js'

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
 * operator. Range operators use {@link compareValues}; `like` / `glob` / `starts`
 * / `ends` match only strings; `any` / `none` test membership by value equality.
 * Total — a type mismatch is simply a non-match.
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
			return compareValues(value, first) === 0
		case 'not':
			return compareValues(value, first) !== 0
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
			return condition.values.some((candidate) => compareValues(value, candidate) === 0)
		case 'none':
			return !condition.values.some((candidate) => compareValues(value, candidate) === 0)
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

/**
 * Generate a fresh unique key — a v4 UUID string.
 *
 * @remarks
 * Used when a row is written without a primary-key value. Strings work as keys
 * on every backend; supply your own value to use numeric keys.
 *
 * @returns A new UUID string
 */
export function generateKey(): string {
	const scope: object = globalThis
	if ('crypto' in scope && typeof scope.crypto === 'object' && scope.crypto !== null) {
		const source: object = scope.crypto
		if ('randomUUID' in source && typeof source.randomUUID === 'function') {
			const key: unknown = source.randomUUID.call(source)
			if (typeof key === 'string') return key
		}
	}
	throw new Error('generateKey: the host provides no crypto.randomUUID')
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
 * columnType(stringShape()) // 'text'
 * columnType(integerShape()) // 'integer'
 * columnType(optionalShape(integerShape())) // 'integer'
 * columnType(objectShape({ a: stringShape() })) // 'json'
 * ```
 */
export function columnType(shape: ContractShape): ColumnType {
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
			return columnType(shape.inner)
		case 'null':
		case 'object':
		case 'array':
		case 'union':
		case 'json':
		case 'raw':
			return 'json'
	}
}
