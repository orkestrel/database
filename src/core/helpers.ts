import type { ContractShape, FieldPath } from '@orkestrel/contract'
import type {
	AggregateFunction,
	ColumnType,
	Condition,
	Criteria,
	DriverInterface,
	Key,
	Migration,
	MigrationStep,
	Order,
	Row,
	TableSchema,
} from './types.js'
import { isFiniteNumber, isRecord, isString, parseNumber, resolveField } from '@orkestrel/contract'
import { MAX_PATTERN_LENGTH } from './constants.js'
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
		return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
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
			if (!beforeColumns.has(column.name)) {
				steps.push({ operation: 'column.add', table: table.name, column })
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

// Fixed two-table schema every conformDriver phase opens: `users` keyed by
// `id` (the default primary), `posts` keyed by a non-id `slug` — exercising
// both primary-key shapes in one battery.
const CONFORMANCE_USERS_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', type: 'text', nullable: false },
		{ name: 'name', type: 'text', nullable: false },
		{ name: 'age', type: 'integer', nullable: true },
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

const CONFORMANCE_SCHEMA: readonly TableSchema[] = [CONFORMANCE_USERS_SCHEMA, CONFORMANCE_POSTS_SCHEMA]

// Throw a CONFORMANCE DatabaseError naming which check failed plus the
// expected/actual summary — the single failure-reporting path every phase
// below funnels through.
function failConformance(check: string, message: string, context: Readonly<Record<string, unknown>>): never {
	throw new DatabaseError('CONFORMANCE', message, { check, ...context })
}

/**
 * Run the driver-conformance battery against a fresh {@link DriverInterface}
 * per phase — the shared invariant suite every backend (in-memory, SQLite,
 * IndexedDB) must uphold to be a drop-in {@link DriverInterface}.
 *
 * @remarks
 * Framework-agnostic: no test-runner or Node imports, only sibling core
 * modules — so it runs equally from a unit test, a smoke script, or a new
 * driver's own README. Opens a fixed two-table schema (`users` keyed by the
 * default `id`, `posts` keyed by a non-id `slug`) and, calling `factory()`
 * fresh for each phase so failures stay isolated, verifies: `open`/`close`;
 * `read` of a missing key returns `undefined`; `write`/`read` round-trip with
 * copy-in/copy-out isolation (mutating the caller's row after `write`, or the
 * row `read` returns, never perturbs stored state) and upsert-overwrite;
 * `delete` returns `true` then `false`; `keys`/`scan` yield in ascending key
 * order; `clear` empties only its target table; `snapshot`'s rollback thunk
 * restores pre-snapshot state; a non-`id` primary key (`posts.slug`)
 * round-trips; a nested-object row round-trips structurally (via
 * {@link deepEqual}). The optional surface is presence-gated: when `migrate`
 * exists, a `column.remove` plan strips the column from stored rows and a
 * plan referencing an unknown table throws `DatabaseError` `MIGRATION`; when
 * `stream` exists, it yields only condition-matching rows and honors
 * `offset`/`limit`; when `transaction` exists, `commit` persists and
 * `rollback` restores. The first violation throws a `CONFORMANCE`
 * {@link DatabaseError} naming the failed check plus expected/actual context
 * — every later phase is skipped.
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
	// a. open with the inline two-table schema, then close cleanly.
	{
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.close()
	}

	// b. read of a missing key -> undefined.
	{
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		const missing = await driver.read('users', 'nope')
		if (missing !== undefined) {
			failConformance('read-missing', 'read of a missing key must return undefined', {
				table: 'users',
				expected: undefined,
				actual: missing,
			})
		}
		await driver.close()
	}

	// c. write/read round-trip, copy-in/copy-out isolation, upsert-overwrite.
	{
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		const input: Row = { id: 'u1', name: 'Ada', age: 30 }
		await driver.write('users', 'u1', input)
		input.name = 'Mutated after write'
		const stored = await driver.read('users', 'u1')
		const original = { id: 'u1', name: 'Ada', age: 30 }
		if (stored === undefined || !deepEqual(stored, original)) {
			failConformance('copy-in', 'write must copy the input row rather than store it by reference', {
				table: 'users',
				expected: original,
				actual: stored,
			})
		} else {
			stored.name = 'Mutated after read'
			const reread = await driver.read('users', 'u1')
			if (reread === undefined || !deepEqual(reread, original)) {
				failConformance('copy-out', 'read must copy the stored row rather than return it by reference', {
					table: 'users',
					expected: original,
					actual: reread,
				})
			}
		}
		const overwrite = { id: 'u1', name: 'Ada Overwritten', age: 31 }
		await driver.write('users', 'u1', overwrite)
		const overwritten = await driver.read('users', 'u1')
		if (overwritten === undefined || !deepEqual(overwritten, overwrite)) {
			failConformance('upsert', 'write must upsert-overwrite an existing key', {
				table: 'users',
				expected: overwrite,
				actual: overwritten,
			})
		}
		await driver.close()
	}

	// d. delete -> true then false.
	{
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
		const first = await driver.delete('users', 'u1')
		if (first !== true) {
			failConformance('delete-true', 'delete of an existing key must return true', {
				table: 'users',
				expected: true,
				actual: first,
			})
		}
		const second = await driver.delete('users', 'u1')
		if (second !== false) {
			failConformance('delete-false', 'delete of an already-removed key must return false', {
				table: 'users',
				expected: false,
				actual: second,
			})
		}
		await driver.close()
	}

	// e. keys and scan in ascending key order.
	{
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
			failConformance('keys-order', 'keys must be returned in ascending key order', {
				table: 'users',
				expected,
				actual: keys,
			})
		}
		const scanned: Row[] = []
		for await (const row of driver.scan('users')) scanned.push(row)
		const scannedIds = scanned.map((row) => row.id)
		if (!deepEqual(scannedIds, expected)) {
			failConformance('scan-order', 'scan must yield rows in ascending key order', {
				table: 'users',
				expected,
				actual: scannedIds,
			})
		}
		await driver.close()
	}

	// f. clear empties only the targeted table.
	{
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
		await driver.write('posts', 'p1', { slug: 'p1', title: 'Post' })
		await driver.clear('users')
		const usersKeys = await driver.keys('users')
		const postsKeys = await driver.keys('posts')
		if (usersKeys.length !== 0) {
			failConformance('clear-target', 'clear must empty the targeted table', {
				table: 'users',
				expected: [],
				actual: usersKeys,
			})
		}
		if (postsKeys.length !== 1) {
			failConformance('clear-other', 'clear must not affect other tables', {
				table: 'posts',
				expected: 1,
				actual: postsKeys.length,
			})
		}
		await driver.close()
	}

	// g. snapshot rollback restores pre-snapshot state.
	{
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
			failConformance('snapshot-rollback', 'snapshot rollback must restore the pre-snapshot key set', {
				table: 'users',
				expected: ['u1'],
				actual: keys,
			})
		}
		const restored = await driver.read('users', 'u1')
		if (restored === undefined || !deepEqual(restored, original)) {
			failConformance('snapshot-rollback-value', 'snapshot rollback must restore pre-snapshot row values', {
				table: 'users',
				expected: original,
				actual: restored,
			})
		}
		await driver.close()
	}

	// h. non-id primary extraction (posts keyed by slug).
	{
		const driver = factory()
		await driver.open(CONFORMANCE_SCHEMA)
		await driver.write('posts', 'hello-world', { slug: 'hello-world', title: 'Hello' })
		const post = await driver.read('posts', 'hello-world')
		const key = post === undefined ? undefined : extractKey(post, 'slug')
		if (key !== 'hello-world') {
			failConformance('non-id-primary', 'a non-id primary key column must round-trip through the store', {
				table: 'posts',
				expected: 'hello-world',
				actual: key,
			})
		}
		await driver.close()
	}

	// i. nested-object row round-trip (structural, via deepEqual).
	{
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
		if (readBack === undefined || !deepEqual(readBack, nested)) {
			failConformance('nested-roundtrip', 'a nested-object row must round-trip structurally', {
				table: 'users',
				expected: nested,
				actual: readBack,
			})
		}
		await driver.close()
	}

	// j. migrate (presence-gated): a planMigration-built column.remove plan strips
	// stored rows; an unknown-table plan throws a MIGRATION DatabaseError.
	{
		const driver = factory()
		if (driver.migrate !== undefined) {
			await driver.open(CONFORMANCE_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30, legacy: true })
			const deployedUsers: TableSchema = {
				...CONFORMANCE_USERS_SCHEMA,
				columns: [...CONFORMANCE_USERS_SCHEMA.columns, { name: 'legacy', type: 'boolean', nullable: false }],
			}
			const removePlan = planMigration([deployedUsers], [CONFORMANCE_USERS_SCHEMA])
			await driver.migrate(removePlan)
			const migrated = await driver.read('users', 'u1')
			if (migrated === undefined || 'legacy' in migrated) {
				failConformance('migrate-column-remove', 'a column.remove migration must strip the column from stored rows', {
					table: 'users',
					expected: undefined,
					actual: migrated === undefined ? undefined : migrated.legacy,
				})
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
			if (!isDatabaseError(caught) || caught.code !== 'MIGRATION') {
				failConformance(
					'migrate-unknown-table',
					'a migration step referencing an unknown table must throw a MIGRATION DatabaseError',
					{
						table: 'ghost',
						expected: 'MIGRATION',
						actual: isDatabaseError(caught) ? caught.code : caught,
					},
				)
			}
			await driver.close()
		}
	}

	// k. stream (presence-gated): yields only condition-matching rows, honors offset/limit.
	{
		const driver = factory()
		if (driver.stream !== undefined) {
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
				failConformance('stream-match', 'stream must yield only condition-matching rows', {
					table: 'users',
					expected: ['b', 'c'],
					actual: matchedIds,
				})
			}
			const paged: Row[] = []
			for await (const row of driver.stream('users', { offset: 1, limit: 1 })) paged.push(row)
			if (paged.length !== 1) {
				failConformance('stream-page', 'stream must honor offset and limit', {
					table: 'users',
					expected: 1,
					actual: paged.length,
				})
			}
			await driver.close()
		}
	}

	// l. transaction (presence-gated): commit persists, rollback restores.
	{
		const driver = factory()
		if (driver.transaction !== undefined) {
			await driver.open(CONFORMANCE_SCHEMA)
			await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 30 })
			const committing = await driver.transaction()
			await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40 })
			await committing.commit()
			const afterCommit = [...(await driver.keys('users'))].sort()
			if (!deepEqual(afterCommit, ['u1', 'u2'])) {
				failConformance('transaction-commit', 'transaction commit must persist writes made during the scope', {
					table: 'users',
					expected: ['u1', 'u2'],
					actual: afterCommit,
				})
			}
			const rollingBack = await driver.transaction()
			await driver.write('users', 'u3', { id: 'u3', name: 'Marie', age: 50 })
			await rollingBack.rollback()
			const afterRollback = [...(await driver.keys('users'))].sort()
			if (!deepEqual(afterRollback, ['u1', 'u2'])) {
				failConformance('transaction-rollback', 'transaction rollback must restore pre-transaction state', {
					table: 'users',
					expected: ['u1', 'u2'],
					actual: afterRollback,
				})
			}
			await driver.close()
		}
	}
}
