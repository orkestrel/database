import type { AuditFault, ContractShape, FieldPath } from '@orkestrel/contract'
import type {
	Aggregate,
	AggregateOperation,
	ColumnMap,
	ColumnSchema,
	ColumnStorage,
	ConformanceFinding,
	Condition,
	QueryInput,
	DriverInterface,
	Key,
	MigrationStep,
	Order,
	PrimaryMap,
	ReadInput,
	ReadPlan,
	Row,
	StorageCall,
	StorageInterface,
	StorageMember,
	StorageTally,
	StreamPageInterface,
	TableMap,
	TableSchema,
} from './types.js'
import {
	collectMembers,
	extractPath,
	FAULT_LIMIT,
	compileGuard,
	errorToMessage,
	holds,
	isArray,
	isBoolean,
	isFiniteNumber,
	isInteger,
	isNumber,
	isRecord,
	isString,
	matchesMember,
	objectShape,
	parseNumber,
	preview,
	resolveField,
} from '@orkestrel/contract'
import { StreamPage } from './StreamPage.js'
import {
	AGGREGATE_OPERATIONS,
	CONFORMANCE_POSTS_SCHEMA,
	CONFORMANCE_READS,
	CONFORMANCE_ROWS,
	CONFORMANCE_SCHEMA,
	CONFORMANCE_USERS_SCHEMA,
	DEFAULT_PRIMARY,
	MAX_PATTERN_LENGTH,
	NULLISH_OPERATORS,
	PATTERN_OPERATORS,
} from './constants.js'
import { DatabaseError, isDatabaseError } from './errors.js'
import { isAggregateOperation, isKey, isScalar } from './validators.js'

// The core's query engine. It runs the residual a driver's plan returns, under the
// native-first rule `DriverInterface` states, and the whole read for a driver without
// `plan`. Its helpers are total — like the contracts guards they lean on, malformed input
// yields a `false` / a skipped value, never a throw.

// === Query input validation

/**
 * Validates the paging fields of a portable query.
 *
 * @remarks
 * A present `limit` or `offset` must be a finite nonnegative integer; zero is
 * valid. Validation is deterministic (`limit` before `offset`). Non-finite
 * values are rendered as strings in error context so JSON serialization cannot
 * collapse `NaN` or infinity to `null`.
 *
 * @param input - The portable query whose paging fields to validate
 * @throws {@link DatabaseError} `VALIDATION` when a paging field is invalid
 *
 * @example
 * ```ts
 * validatePage({ limit: 2, offset: 0 }) // returns
 * validatePage({ limit: -1 }) // throws DatabaseError VALIDATION
 * ```
 */
export function validatePage(input?: QueryInput): void {
	const limit = input?.limit
	if (limit !== undefined && (!isInteger(limit) || limit < 0)) {
		throw new DatabaseError('VALIDATION', 'Query limit must be a nonnegative integer', {
			field: 'limit',
			value: isFiniteNumber(limit) ? limit : String(limit),
		})
	}
	const offset = input?.offset
	if (offset !== undefined && (!isInteger(offset) || offset < 0)) {
		throw new DatabaseError('VALIDATION', 'Query offset must be a nonnegative integer', {
			field: 'offset',
			value: isFiniteNumber(offset) ? offset : String(offset),
		})
	}
}

/**
 * Checks whether a value is a string holding a lone surrogate, which has no UTF-8 form.
 *
 * @remarks
 * SQLite stores a lone surrogate as U+FFFD and reads back a changed value, so a table refuses
 * one in a written `text` value, a key, and a string operand on every driver.
 *
 * @param value - The value to check
 * @returns True if the value is a string that is not well-formed UTF-16; false otherwise
 *
 * @example
 * ```ts
 * matchesIllFormedText('a\uD800b') // true
 * matchesIllFormedText('\uD83D\uDE00') // false — a surrogate pair
 * matchesIllFormedText(1) // false
 * ```
 */
export function matchesIllFormedText(value: unknown): boolean {
	return isString(value) && !value.isWellFormed()
}

/**
 * Extracts the leading column a column reference names: a column name, or the first key of a
 * non-empty list of keys.
 *
 * @param column - The column reference, not yet admitted
 * @returns The leading column, or `undefined` when the reference is no column name and no
 *   non-empty list of strings
 *
 * @example
 * ```ts
 * extractColumnHead(['profile', 'age']) // 'profile'
 * extractColumnHead([]) // undefined
 * ```
 */
export function extractColumnHead(column: unknown): string | undefined {
	if (isString(column)) return column
	return isArray(column) && column.length > 0 && column.every(isString) ? column[0] : undefined
}

/**
 * Copies a read so that each `undefined` operand of `equals`, `not`, `any`, and `none` reads
 * `null`, the form `queryInputShape` declares.
 *
 * @remarks
 * A shape cannot declare an `undefined` array member, so a table checks this copy against the
 * shape and checks each `undefined` operand against its column's optionality itself. Every other
 * condition is kept by reference, and a value that is no record or whose `conditions` is no
 * list returns as it came.
 *
 * @param input - The read to copy, not yet admitted
 * @returns The input itself when no such operand is present, otherwise the copy
 *
 * @example
 * ```ts
 * maskUndefinedOperands({ conditions: [{ column: 'note', operator: 'equals', values: [undefined], connector: 'and' }] })
 * // { conditions: [{ column: 'note', operator: 'equals', values: [null], connector: 'and' }] }
 * ```
 */
export function maskUndefinedOperands(input: unknown): unknown {
	if (!isRecord(input)) return input
	const conditions = input.conditions
	if (!isArray(conditions)) return input
	const masked = conditions.map((condition) =>
		isRecord(condition) &&
		NULLISH_OPERATORS.some((operator) => operator === condition.operator) &&
		isArray(condition.values) &&
		condition.values.includes(undefined)
			? { ...condition, values: condition.values.map((value) => value ?? null) }
			: condition,
	)
	return masked.every((condition, index) => condition === conditions[index])
		? input
		: { ...input, conditions: masked }
}

/**
 * Puts back the operands of a read whose masked form {@link maskUndefinedOperands} built and the
 * query contract admitted.
 *
 * @remarks
 * The masked read and its source differ only in operand lists, so each condition takes the
 * operand list of the source's condition at the same position.
 *
 * @param masked - The admitted masked read
 * @param source - The read the mask copied
 * @returns The admitted read with the source's operands
 *
 * @example
 * ```ts
 * const source = { conditions: [{ column: 'note', operator: 'equals', values: [undefined], connector: 'and' }] }
 * restoreUndefinedOperands(maskUndefinedOperands(source), source).conditions?.[0]?.values // [undefined]
 * ```
 */
export function restoreUndefinedOperands(masked: QueryInput, source: unknown): QueryInput {
	const conditions = isRecord(source) ? source.conditions : undefined
	if (masked.conditions === undefined || !isArray(conditions)) return masked
	return {
		...masked,
		conditions: masked.conditions.map((condition, index) => {
			const original: unknown = conditions[index]
			return isRecord(original) && isArray(original.values)
				? { ...condition, values: original.values }
				: condition
		}),
	}
}

/**
 * Finds what a read asks of a table's columns that they do not hold — the schema facts a shape
 * cannot state.
 *
 * @remarks
 * Reads the read as it came, before the query contract admits it, and skips each part that is no
 * record or no list and each condition and ordering term the contract refused, which the contract
 * reports. A condition's and an ordering term's leading
 * column is declared, and a path of more than one key descends only a `json` column. A
 * condition's operand matches its column's storage class: a string for `text`, a number for
 * `integer` and `real`, a boolean for `boolean`, and any value for `json` or under a nested
 * path. `null` is admitted for `equals`, `not`, `any`, and `none` on a nullable column, and
 * `undefined` for the same operators on an optional one. `like`, `glob`, `starts`, and `ends`
 * read a `text` or `json` column. Every string operand is well-formed UTF-16, with no lone
 * surrogate, whatever its column. An aggregate names one of `AGGREGATE_OPERATIONS` and a
 * declared column. The check reads no refinement: integer-ness, bounds, patterns, and literal
 * membership stay the contract's. At most `FAULT_LIMIT` faults return.
 *
 * @param input - The read, its aggregate included
 * @param columns - The table's declared columns, by name
 * @param refused - The query contract's faults of the read; each condition and ordering term a
 *   fault names is skipped, so it carries no second fault here. Default: none
 * @returns One fault per refused column, operator, operand, or aggregate member, empty when the
 *   read is admitted
 *
 * @example
 * ```ts
 * const columns = new Map([['age', { name: 'age', storage: 'integer', optional: false, nullable: false }]])
 * scanQueryFaults({ conditions: [{ column: 'age', operator: 'equals', values: ['36'], connector: 'and' }] }, columns)
 * // [{ reason: 'type', path: ['conditions', '0', 'values', '0'], expected: 'number', received: '"36"' }]
 * ```
 */
export function scanQueryFaults(
	input: unknown,
	columns: ReadonlyMap<string, ColumnSchema>,
	refused: readonly AuditFault[] = [],
): readonly AuditFault[] {
	if (!isRecord(input)) return []
	const conditions = isArray(input.conditions) ? input.conditions : []
	const order = isArray(input.order) ? input.order : []
	const skipped = new Set(refused.map((fault) => extractPath(fault).slice(0, 2).join('/')))
	return Iterator.from([
		Iterator.from(conditions).flatMap((condition, index) =>
			skipped.has(`conditions/${index}`)
				? []
				: scanConditionFaults(condition, ['conditions', `${index}`], columns),
		),
		Iterator.from(order).flatMap((term, index) =>
			isRecord(term) && !skipped.has(`order/${index}`)
				? scanColumnFaults(term.column, ['order', `${index}`, 'column'], columns)
				: [],
		),
		input.aggregate === undefined ? [] : scanAggregateFaults(input.aggregate, columns),
	])
		.flatMap((faults) => faults)
		.take(FAULT_LIMIT)
		.toArray()
}

/**
 * Finds what one condition asks of a table's columns that they do not hold, under the rules
 * {@link scanQueryFaults} states.
 *
 * @param condition - The condition, not yet admitted; a value that is no record has no fault here
 * @param path - The condition's path in the read
 * @param columns - The table's declared columns, by name
 * @returns The condition's faults, at most `FAULT_LIMIT`
 *
 * @example
 * ```ts
 * const columns = new Map([['name', { name: 'name', storage: 'text', optional: false, nullable: false }]])
 * scanConditionFaults({ column: 'name', operator: 'equals', values: [null], connector: 'and' }, ['conditions', '0'], columns)
 * // [{ reason: 'type', path: ['conditions', '0', 'values', '0'], expected: 'string', received: 'null' }]
 * ```
 */
export function scanConditionFaults(
	condition: unknown,
	path: readonly string[],
	columns: ReadonlyMap<string, ColumnSchema>,
): readonly AuditFault[] {
	if (!isRecord(condition)) return []
	const located = scanColumnFaults(condition.column, [...path, 'column'], columns)
	const column = columns.get(extractColumnHead(condition.column) ?? '')
	if (located.length > 0 || column === undefined) return located
	const nested = isArray(condition.column) && condition.column.length > 1
	const pattern = PATTERN_OPERATORS.some((operator) => operator === condition.operator)
	if (pattern && !nested && column.storage !== 'text' && column.storage !== 'json') {
		return [
			{
				reason: 'constraint',
				path: [...path, 'operator'],
				expected: 'literal',
				constraint: 'pattern',
				limit: 'a text or json column',
				received: preview(condition.operator),
			},
		]
	}
	const nullish = NULLISH_OPERATORS.some((operator) => operator === condition.operator)
	return Iterator.from(isArray(condition.values) ? condition.values : [])
		.flatMap((value, index) =>
			scanOperandFaults(
				value,
				[...path, 'values', `${index}`],
				nested ? undefined : column,
				nullish,
			),
		)
		.take(FAULT_LIMIT)
		.toArray()
}

/**
 * Finds the fault of a column reference: an undeclared leading column, or a nested path under a
 * column that is not `json`.
 *
 * @param column - The column reference; one that is no column name and no non-empty list of
 *   strings has no fault here, because the query contract reports it
 * @param path - The reference's path in the read
 * @param columns - The table's declared columns, by name
 * @returns The reference's fault, or an empty list when the table holds it
 *
 * @example
 * ```ts
 * scanColumnFaults('agee', ['order', '0', 'column'], new Map())
 * // [{ reason: 'type', path: ['order', '0', 'column'], expected: 'literal', received: '"agee"' }]
 * ```
 */
export function scanColumnFaults(
	column: unknown,
	path: readonly string[],
	columns: ReadonlyMap<string, ColumnSchema>,
): readonly AuditFault[] {
	const head = extractColumnHead(column)
	if (head === undefined) return []
	const declared = columns.get(head)
	if (declared === undefined) {
		return [
			{
				reason: 'type',
				path: isString(column) ? path : [...path, '0'],
				expected: 'literal',
				received: preview(head),
			},
		]
	}
	if (isArray(column) && column.length > 1 && declared.storage !== 'json') {
		return [{ reason: 'type', path, expected: 'string', received: preview(column) }]
	}
	return []
}

/**
 * Finds the faults of an aggregate: an operation outside `AGGREGATE_OPERATIONS`, and a column
 * that is no column reference or that the table does not hold.
 *
 * @param aggregate - The aggregate, not yet admitted
 * @param columns - The table's declared columns, by name
 * @returns The aggregate's faults, at `['aggregate', 'operation']` and `['aggregate', 'column']`
 *
 * @example
 * ```ts
 * scanAggregateFaults({ operation: 'median', column: 'age' }, new Map())
 * // [{ reason: 'type', path: ['aggregate', 'operation'], expected: 'literal', received: '"median"' },
 * //  { reason: 'type', path: ['aggregate', 'column'], expected: 'literal', received: '"age"' }]
 * ```
 */
export function scanAggregateFaults(
	aggregate: unknown,
	columns: ReadonlyMap<string, ColumnSchema>,
): readonly AuditFault[] {
	if (!isRecord(aggregate)) {
		return [
			{ reason: 'type', path: ['aggregate'], expected: 'object', received: preview(aggregate) },
		]
	}
	const operation = isAggregateOperation(aggregate.operation)
	return [
		...(operation
			? []
			: [
					{
						reason: 'type' as const,
						path: ['aggregate', 'operation'],
						expected: 'literal' as const,
						received: preview(aggregate.operation),
					},
				]),
		...(extractColumnHead(aggregate.column) === undefined
			? [
					{
						reason: 'type' as const,
						path: ['aggregate', 'column'],
						expected: 'string' as const,
						received: preview(aggregate.column),
					},
				]
			: scanColumnFaults(aggregate.column, ['aggregate', 'column'], columns)),
	]
}

/**
 * Finds the fault of one operand against its column's storage class.
 *
 * @remarks
 * A string operand is well-formed UTF-16 whatever its column, under a nested path and on a
 * `json` column included. Without a column, under a nested path, any other operand is
 * admitted; a `json` or `blob` column admits any other operand too.
 *
 * @param value - The operand
 * @param path - The operand's path in the read
 * @param column - The column the operand compares with, or `undefined` under a nested path
 * @param nullish - If `true`, the operator admits `null` on a nullable column and `undefined` on
 *   an optional one; if `false`, it admits neither
 * @returns The operand's fault, or an empty list when the column admits it
 *
 * @example
 * ```ts
 * const column = { name: 'age', storage: 'integer', optional: false, nullable: false }
 * scanOperandFaults(true, ['conditions', '0', 'values', '0'], column, true)
 * // [{ reason: 'type', path: ['conditions', '0', 'values', '0'], expected: 'number', received: 'true' }]
 * ```
 */
export function scanOperandFaults(
	value: unknown,
	path: readonly string[],
	column: ColumnSchema | undefined,
	nullish: boolean,
): readonly AuditFault[] {
	if (matchesIllFormedText(value)) {
		return [
			{
				reason: 'constraint',
				path,
				expected: 'string',
				constraint: 'pattern',
				received: preview(value),
			},
		]
	}
	if (column === undefined || column.storage === 'json' || column.storage === 'blob') return []
	const expected =
		column.storage === 'text' ? 'string' : column.storage === 'boolean' ? 'boolean' : 'number'
	const admitted =
		value === null
			? nullish && column.nullable
			: value === undefined
				? nullish && column.optional
				: expected === 'string'
					? isString(value)
					: expected === 'boolean'
						? isBoolean(value)
						: isNumber(value)
	return admitted ? [] : [{ reason: 'type', path, expected, received: preview(value) }]
}

/**
 * Finds the first `text` column of a row whose string is not well-formed UTF-16.
 *
 * @remarks
 * A `json` column is not read, because `JSON.stringify` escapes a lone surrogate and the cell
 * round-trips.
 *
 * @param row - The row to read
 * @param columns - The table's declared columns, by name
 * @returns The column's name, or `undefined` when every `text` value is well-formed
 *
 * @example
 * ```ts
 * const columns = new Map([['name', { name: 'name', storage: 'text', optional: false, nullable: false }]])
 * findIllFormedColumn({ name: 'a\uD800b' }, columns) // 'name'
 * findIllFormedColumn({ name: 'Ada' }, columns) // undefined
 * ```
 */
export function findIllFormedColumn(
	row: Row,
	columns: ReadonlyMap<string, ColumnSchema>,
): string | undefined {
	return Iterator.from(columns.values()).find(
		(column) => column.storage === 'text' && matchesIllFormedText(row[column.name]),
	)?.name
}

/**
 * Assembles the entries of a storage write from its keys and rows, one row per key.
 *
 * @remarks
 * A single key and row form one entry. Two lists pair by position.
 *
 * @param keys - The key, or the batch's keys
 * @param rows - The row, or the batch's rows in the order of `keys`
 * @returns One `[key, row]` entry per key, in the batch's order
 * @throws {@link DatabaseError} `VALIDATION` when one argument is a list and the other is not,
 *   or when the lists differ in length
 *
 * @example
 * ```ts
 * buildBatch('u1', { id: 'u1' }) // [['u1', { id: 'u1' }]]
 * buildBatch(['u1', 'u2'], [{ id: 'u1' }]) // throws VALIDATION
 * ```
 */
export function buildBatch(
	keys: Key | readonly Key[],
	rows: Row | readonly Row[],
): ReadonlyArray<readonly [Key, Row]> {
	if (!isArray(keys) && !isArray(rows)) return [[keys, rows]]
	if (!isArray(keys) || !isArray(rows) || keys.length !== rows.length) {
		throw new DatabaseError('VALIDATION', 'A batch write needs one row per key', {
			keys: isArray(keys) ? keys.length : 1,
			rows: isArray(rows) ? rows.length : 1,
		})
	}
	return keys.map((key, index) => {
		const row = rows[index]
		if (!isRecord(row)) {
			throw new DatabaseError('VALIDATION', 'A batch row is not a record', { index })
		}
		return [key, row] as const
	})
}

/**
 * Computes what a batch delete reports per key: true for the first occurrence of a key that
 * held a row, and false for a miss and for every repeat of a key.
 *
 * @param keys - The keys of the batch, in its order, compared by `SameValueZero`
 * @param existed - Whether each key held a row before the batch, by position
 * @returns One result per key, in the batch's order
 *
 * @example
 * ```ts
 * computeRemoved(['a', 'b', 'a'], [true, false, true]) // [true, false, false]
 * ```
 */
export function computeRemoved(
	keys: readonly unknown[],
	existed: readonly boolean[],
): readonly boolean[] {
	const first = computeFirstIndexes(keys)
	return keys.map((key, index) => existed[index] === true && first.get(key) === index)
}

/**
 * Computes the position of each key's first occurrence in a batch.
 *
 * @param keys - The keys of the batch, in its order, compared by `SameValueZero`
 * @returns Each distinct key mapped to the position it first appears at
 *
 * @example
 * ```ts
 * computeFirstIndexes(['a', 'b', 'a']) // Map { 'a' => 0, 'b' => 1 }
 * ```
 */
export function computeFirstIndexes(keys: readonly unknown[]): ReadonlyMap<unknown, number> {
	return new Map([...keys.entries()].reverse().map(([index, key]) => [key, index]))
}

/**
 * Applies a keyed operation that takes a key list to a single key or a key list, and answers in
 * the form the call took.
 *
 * @remarks
 * A single key reaches the operation as a list of one, and its answer is that list's first
 * result, or `false` when the operation reports none.
 *
 * @param keys - The key, or the key list
 * @param operation - The operation over a key list, answering one result per key
 * @returns The one result for a single key, or every result for a list
 *
 * @example
 * ```ts
 * await applyKeys('u1', async (keys) => keys.map(() => true)) // true
 * await applyKeys(['u1', 'u2'], async (keys) => keys.map(() => false)) // [false, false]
 * ```
 */
export async function applyKeys(
	keys: Key | readonly Key[],
	operation: (keys: readonly Key[]) => Promise<readonly boolean[]>,
): Promise<boolean | readonly boolean[]> {
	const answers = await operation(isArray(keys) ? keys : [keys])
	return isArray(keys) ? answers : answers[0] === true
}

/**
 * Drops each clause a read does not hold, so an absent clause is an absent key.
 *
 * @remarks
 * An empty condition list and an empty order become absent keys, the shape a
 * {@link ReadPlan} side takes, so a read with no clause is `{}`.
 *
 * @param input - The read to compact
 * @returns The read with only its present clauses
 *
 * @example
 * ```ts
 * normalizeReadInput({ conditions: [], order: [], limit: 10 }) // { limit: 10 }
 * ```
 */
export function normalizeReadInput(input: ReadInput): ReadInput {
	return {
		...(input.conditions !== undefined && input.conditions.length > 0
			? { conditions: input.conditions }
			: {}),
		...(input.order !== undefined && input.order.length > 0 ? { order: input.order } : {}),
		...(input.limit === undefined ? {} : { limit: input.limit }),
		...(input.offset === undefined ? {} : { offset: input.offset }),
		...(input.aggregate === undefined ? {} : { aggregate: input.aggregate }),
	}
}

// === Comparison

/**
 * Compares two arbitrary values under one total order — the comparator behind
 * sorting and the range operators.
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
 *
 * @example
 * ```ts
 * compareValues(1, 2) // -1
 * compareValues('b', 'a') // 1
 * compareValues(null, 0) // -1
 * compareValues(Number.NaN, Number.NaN) // 0
 * ```
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
				: isBoolean(value)
					? 2
					: isNumber(value)
						? 3
						: isString(value)
							? 4
							: 5,
	)
	if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1
	if (isNumber(left) && isNumber(right)) {
		if (Number.isNaN(left) || Number.isNaN(right)) {
			return Number.isNaN(left) ? (Number.isNaN(right) ? 0 : 1) : -1
		}
		return left < right ? -1 : left > right ? 1 : 0
	}
	if (isString(left) && isString(right)) {
		return left < right ? -1 : left > right ? 1 : 0
	}
	if (isBoolean(left) && isBoolean(right)) {
		return left === right ? 0 : left ? 1 : -1
	}
	return 0
}

/**
 * Compares two values structurally by SameValueZero leaves — the comparator
 * behind conformance checks and any test/fixture that needs "same data", not
 * "same reference".
 *
 * @remarks
 * Primitives compare by SameValueZero (`NaN` equals itself; `+0` equals `-0`).
 * Arrays compare by index (same length, every element `equalsValue`). Plain
 * records (through `isRecord`) compare by their own enumerable keys: same key
 * count and, for every key in `left`, `right` has that key (`Object.hasOwn`)
 * with a `equalsValue` value — so a key present with value `undefined` is not
 * equal to that key being absent (both differ in `Object.keys` membership).
 * Anything else (functions, class instances, mismatched shapes) falls through
 * to `false`. Container pairs are tracked iteratively, so self-referential and
 * mutually cyclic arrays/records terminate without consuming the call stack.
 * A throwing proxy trap or accessor is contained as a non-match.
 *
 * @param left - The left value
 * @param right - The right value
 * @returns True if `left` and `right` are structurally equal; false otherwise
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
	return holds(() => {
		while (pending.length > 0) {
			const pair = pending.pop()
			if (pair === undefined) continue
			const [currentLeft, currentRight] = pair
			if (isNumber(currentLeft) && isNumber(currentRight)) {
				if (
					(Number.isNaN(currentLeft) && Number.isNaN(currentRight)) ||
					currentLeft === currentRight
				) {
					continue
				}
				return false
			}
			if (currentLeft === currentRight) continue

			const leftArray = isArray(currentLeft)
			const rightArray = isArray(currentRight)
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
				for (const index of Array.prototype.keys.call(currentLeft)) {
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
	})
}

// === Pattern matching

/**
 * Folds the ASCII letters of a text to lower case, leaving every other character unchanged.
 *
 * @remarks
 * The fold `LIKE` applies: SQLite's `LIKE` folds only `A` through `Z`, so `É` and `é` stay
 * distinct.
 *
 * @param text - The text to fold
 * @returns The text with each ASCII capital replaced by its small letter
 *
 * @example
 * ```ts
 * foldASCII('Émile ADA') // 'Émile ada'
 * ```
 */
export function foldASCII(text: string): string {
	return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

/**
 * Checks whether a fixed-length wildcard segment matches a value at an offset.
 *
 * @remarks
 * Compares code points: `single` matches any one code point, and every other segment
 * code point matches itself. An offset that leaves the segment outside the value fails.
 *
 * @param value - The value's code points
 * @param segment - The segment's code points, holding no any-run wildcard
 * @param at - The value offset the segment starts at
 * @param single - The single-character wildcard
 * @returns True if every segment code point matches the value code point at its offset; false otherwise
 *
 * @example
 * ```ts
 * matchesWildcardSegment(['h', 'e', 'l', 'l', 'o'], ['l', '_', 'o'], 2, '_') // true
 * ```
 */
export function matchesWildcardSegment(
	value: readonly string[],
	segment: readonly string[],
	at: number,
	single: string,
): boolean {
	return (
		at >= 0 &&
		at + segment.length <= value.length &&
		segment.every((point, offset) => point === single || point === value[at + offset])
	)
}

/**
 * Matches a value against a wildcard pattern in linear time — the shared, ReDoS-safe
 * engine behind {@link matchesLikePattern} and {@link matchesGlobPattern}.
 *
 * @remarks
 * A backtracking RegExp (`a%b%c` → `^a.*b.*c$`) is catastrophic on a malformed pattern, and
 * a `LIKE` / `GLOB` pattern is a caller-supplied operand this package cannot trust. This
 * builds no regex. It splits the pattern on `any` into fixed-length segments, anchors the
 * first at the value's start and the last at its end, and places each middle segment at its
 * leftmost match after the one before it, which is the only placement a match needs, so the
 * work is O(value × pattern) at worst. The pattern length is capped at
 * {@link MAX_PATTERN_LENGTH} (a `VALIDATION` {@link DatabaseError} over it).
 *
 * The `any` wildcard matches any run (including empty); `single` matches exactly one code
 * point, as SQLite's `LIKE` and `GLOB` do; every other pattern character matches itself
 * literally. The pattern splits on `any` before any literal comparison, so a value that
 * literally contains the wildcard never shadows the wildcard. When `fold` is set, both sides
 * fold through {@link foldASCII}.
 *
 * @param value - The value to test
 * @param pattern - The wildcard pattern
 * @param any - The any-run wildcard (`%` for `LIKE`, `*` for `GLOB`)
 * @param single - The single-character wildcard (`_` for `LIKE`, `?` for `GLOB`)
 * @param fold - If `true`, folds ASCII letters on both sides; if `false`, compares exactly
 * @returns True if `value` matches `pattern`; false otherwise
 * @throws A `VALIDATION` {@link DatabaseError} when `pattern` exceeds {@link MAX_PATTERN_LENGTH}
 *
 * @example
 * ```ts
 * matchesWildcardPattern('Report.pdf', '%.pdf', '%', '_', true) // true
 * matchesWildcardPattern('Report.PDF', 'report._df', '%', '_', false) // false
 * matchesWildcardPattern('Report.PDF', 'report._df', '%', '_', true) // true
 * ```
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
	const haystack = Array.from(fold ? foldASCII(value) : value)
	const needle = fold ? foldASCII(pattern) : pattern
	// Only a one-unit wildcard ever equalled a pattern unit, so any other `any` stays literal.
	const segments = (any.length === 1 ? needle.split(any) : [needle]).map((segment) =>
		Array.from(segment),
	)
	const head = segments[0] ?? []
	const tail = segments.at(-1) ?? []
	if (segments.length === 1) {
		return haystack.length === head.length && matchesWildcardSegment(haystack, head, 0, single)
	}
	const end = haystack.length - tail.length
	if (
		end < head.length ||
		!matchesWildcardSegment(haystack, head, 0, single) ||
		!matchesWildcardSegment(haystack, tail, end, single)
	) {
		return false
	}
	const reached = segments.slice(1, -1).reduce<number | undefined>((from, segment) => {
		if (from === undefined) return undefined
		const at = new Array<undefined>(Math.max(0, end - segment.length - from + 1))
			.keys()
			.map((offset) => from + offset)
			.find((candidate) => matchesWildcardSegment(haystack, segment, candidate, single))
		return at === undefined ? undefined : at + segment.length
	}, head.length)
	return reached !== undefined
}

/**
 * Matches a value against a SQL `LIKE` pattern, folding ASCII case.
 *
 * @remarks
 * `%` matches any run of characters (including none) and `_` matches exactly one code
 * point; every other pattern character matches itself literally. Only the ASCII letters fold,
 * as in SQLite's `LIKE`. Runs on {@link matchesWildcardPattern}, so the match is linear in
 * the value length and the pattern is capped at {@link MAX_PATTERN_LENGTH}.
 *
 * @param value - The value to test
 * @param pattern - The `LIKE` pattern
 * @returns True if `value` matches `pattern` under ASCII case folding; false otherwise
 * @throws A `VALIDATION` {@link DatabaseError} when `pattern` exceeds {@link MAX_PATTERN_LENGTH}
 *
 * @example
 * ```ts
 * matchesLikePattern('Hello', 'h%o') // true — `%` spans any run, and ASCII case folds
 * matchesLikePattern('Émile', 'émile') // false — only ASCII letters fold
 * ```
 */
export function matchesLikePattern(value: string, pattern: string): boolean {
	return matchesWildcardPattern(value, pattern, '%', '_', true)
}

/**
 * Matches a value against a `GLOB` pattern, preserving case.
 *
 * @remarks
 * `*` matches any run of characters (including none) and `?` matches exactly one code
 * point; every other pattern character matches itself literally, so a character class such
 * as `[a-z]` is not interpreted. Runs on {@link matchesWildcardPattern}, so the match is
 * linear in the value length and the pattern is capped at {@link MAX_PATTERN_LENGTH}.
 *
 * @param value - The value to test
 * @param pattern - The `GLOB` pattern
 * @returns True if `value` matches `pattern` case-sensitively; false otherwise
 * @throws A `VALIDATION` {@link DatabaseError} when `pattern` exceeds {@link MAX_PATTERN_LENGTH}
 *
 * @example
 * ```ts
 * matchesGlobPattern('hello', 'h*o') // true — `*` spans any run
 * matchesGlobPattern('Hello', 'h*o') // false — `GLOB` is case-sensitive
 * ```
 */
export function matchesGlobPattern(value: string, pattern: string): boolean {
	return matchesWildcardPattern(value, pattern, '*', '?', false)
}

// === Condition matching

/**
 * Collects the scalar operands of a membership list into one set.
 *
 * @remarks
 * A scalar is `undefined`, `null`, a boolean, a number, a string, a bigint, or a symbol. The
 * set is Contract's `collectMembers` vocabulary, which `matchesMember` asks by SameValueZero,
 * the comparison {@link equalsValue} applies to a scalar, so `any` and `none` test a scalar
 * field with one lookup instead of one comparison per operand. Object operands stay out of
 * the set; {@link equalsValue} compares them.
 *
 * @param values - The operands of an `any` or `none` condition
 * @returns The set of scalar operands
 *
 * @example
 * ```ts
 * collectScalars(['a', 1, { b: 2 }]).has('a') // true
 * ```
 */
export function collectScalars(values: readonly unknown[]): ReadonlySet<unknown> {
	return collectMembers(values.filter(isScalar))
}

/**
 * Evaluates one {@link Condition} against a row — the per-operator predicate.
 *
 * @remarks
 * Reads the condition's column — a `FieldPath`, resolved with `resolveField` (a
 * string is one column; an array descends a nested value) — and applies the
 * operator. Range operators (`above` / `below` / `from` / `to` / `between`) use
 * {@link compareValues}, the total order; the equality family (`equals` / `not`
 * / `any` / `none`) uses {@link equalsValue}, structural equality with SameValueZero
 * leaves, so `NaN` equals `NaN` under `equals` / `any`. `any` and `none` test the field
 * through {@link matchesListed}. `like` / `glob` / `starts` / `ends` match only strings;
 * `absent` / `present` test nullishness. Total — a type mismatch is a non-match.
 *
 * @param row - The row to test
 * @param condition - The condition to apply
 * @param scalars - The condition's scalar operands from {@link collectScalars}. Default:
 *   collected on this call
 * @returns True if the row satisfies the condition; false otherwise
 *
 * @example
 * ```ts
 * const adult = { column: 'age', operator: 'from', values: [18], connector: 'and' } as const
 * matchesCondition({ age: 36 }, adult) // true
 * matchesCondition({ age: 12 }, adult) // false
 * ```
 */
export function matchesCondition(
	row: Row,
	condition: Condition,
	scalars?: ReadonlySet<unknown>,
): boolean {
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
			return matchesListed(value, condition.values, scalars)
		case 'none':
			return !matchesListed(value, condition.values, scalars)
		case 'absent':
			return value === undefined || value === null
		case 'present':
			return value !== undefined && value !== null
	}
}

/**
 * Checks whether a value equals one operand of a membership list.
 *
 * @remarks
 * A scalar value is one Contract `matchesMember` lookup in `scalars`; a non-scalar value
 * compares with each operand through {@link equalsValue}.
 *
 * @param value - The field value to test
 * @param values - The membership list
 * @param scalars - The list's scalar operands from {@link collectScalars}. Default: collected
 *   on this call
 * @returns True if `value` equals an operand; false otherwise
 *
 * @example
 * ```ts
 * matchesListed('a', ['a', 'b']) // true
 * matchesListed({ b: 1 }, [{ b: 1 }]) // true
 * ```
 */
export function matchesListed(
	value: unknown,
	values: readonly unknown[],
	scalars?: ReadonlySet<unknown>,
): boolean {
	if (isScalar(value)) return matchesMember(scalars ?? collectScalars(values), value)
	return values.some((candidate) => equalsValue(value, candidate))
}

/**
 * Folds a row through a list of conditions, joining each by its connector.
 *
 * @remarks
 * Evaluated left-to-right: the first condition seeds the result, and each later
 * condition combines with `&&` (`and`) or `||` (`or`). An empty list matches
 * every row. There is no operator precedence — conditions combine in the order
 * the query builder recorded them. A caller that folds many rows passes `scalars` from
 * {@link prepareScalars}, so each `any` and `none` builds its set once per read.
 *
 * @param row - The row to test
 * @param conditions - The conditions to fold
 * @param scalars - One scalar set per condition, by position. Default: collected on this call
 * @returns True if the row satisfies the combined conditions; false otherwise
 *
 * @example
 * ```ts
 * const adult = { column: 'age', operator: 'from', values: [18], connector: 'and' } as const
 * const named = { column: 'name', operator: 'equals', values: ['Bo'], connector: 'or' } as const
 * matchesQuery({ age: 36, name: 'Ada' }, [adult, named]) // true
 * matchesQuery({ age: 12, name: 'Ada' }, [adult, named]) // false
 * ```
 */
export function matchesQuery(
	row: Row,
	conditions: readonly Condition[],
	scalars?: ReadonlyArray<ReadonlySet<unknown>>,
): boolean {
	return (
		conditions.entries().reduce<boolean | undefined>((previous, [index, condition]) => {
			const match = matchesCondition(row, condition, scalars?.[index])
			return previous === undefined
				? match
				: condition.connector === 'or'
					? previous || match
					: previous && match
		}, undefined) ?? true
	)
}

/**
 * Collects one scalar set per condition, by position — the `scalars` argument of
 * {@link matchesQuery}.
 *
 * @param conditions - The conditions a read folds
 * @returns One {@link collectScalars} set per `any` or `none` condition, and an empty set for
 *   every other condition
 *
 * @example
 * ```ts
 * prepareScalars([{ column: 'id', operator: 'any', values: ['a'], connector: 'and' }])[0]?.has('a') // true
 * ```
 */
export function prepareScalars(
	conditions: readonly Condition[],
): ReadonlyArray<ReadonlySet<unknown>> {
	return conditions.map((condition) =>
		collectScalars(
			condition.operator === 'any' || condition.operator === 'none' ? condition.values : [],
		),
	)
}

/**
 * Filters rows by a list of conditions — the shared basis for a table's count
 * and aggregate paths (no sort/page, unlike {@link applyQuery}).
 *
 * @remarks
 * An empty condition list matches every row (returned as-is, no copy). Folds
 * each row through {@link matchesQuery} with the scalar sets built once.
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
	const scalars = prepareScalars(conditions)
	return rows.filter((row) => matchesQuery(row, conditions, scalars))
}

// === Ordering & paging

/**
 * Sorts rows by an ordering specification, leaving the input untouched.
 *
 * @remarks
 * Applies the terms in priority order — the first term that distinguishes two
 * rows decides — using {@link compareValues}, reversing for `descending`. Rows the terms
 * cannot distinguish keep their input order when the final term ascends and reverse it when
 * the final term descends, so over rows in ascending key order a tie resolves by primary key
 * in the direction of the final term.
 *
 * @param rows - The rows to sort
 * @param order - The ordering terms in priority order
 * @returns A new, sorted array
 *
 * @example
 * ```ts
 * sortRows([{ id: 'a', age: 1 }, { id: 'b', age: 1 }], [{ column: 'age', direction: 'descending' }])
 * // => [{ id: 'b', age: 1 }, { id: 'a', age: 1 }]
 * ```
 */
export function sortRows(rows: readonly Row[], order: readonly Order[]): readonly Row[] {
	const descending = order.at(-1)?.direction === 'descending'
	return [...rows.entries()]
		.sort(([leftIndex, left], [rightIndex, right]) => {
			const decided = order
				.values()
				.map((term) => {
					const comparison = compareValues(
						resolveField(left, term.column),
						resolveField(right, term.column),
					)
					return term.direction === 'descending' ? -comparison : comparison
				})
				.find((comparison) => comparison !== 0)
			if (decided !== undefined) return decided
			return descending ? rightIndex - leftIndex : leftIndex - rightIndex
		})
		.map(([, row]) => row)
}

/**
 * Applies a {@link QueryInput} to rows — filter, then sort, then page.
 *
 * @remarks
 * The whole portable read pipeline in one place: conditions filter, `order`
 * sorts, and `offset` / `limit` window the result. Each step is skipped when its
 * part of the input is absent. A plan's residual applies through it over the rows the
 * plan's native side returns.
 *
 * @param rows - The rows to process (typically a table's full `scan`)
 * @param input - The read specification, or `undefined` for all rows as-is
 * @returns The filtered, sorted, paged rows
 *
 * @example
 * ```ts
 * const rows = [{ id: 'a', age: 40 }, { id: 'b', age: 20 }, { id: 'c', age: 30 }]
 * applyQuery(rows, { order: [{ column: 'age', direction: 'ascending' }], limit: 2 })
 * // [{ id: 'b', age: 20 }, { id: 'c', age: 30 }]
 * ```
 */
export function applyQuery(rows: readonly Row[], input?: QueryInput): readonly Row[] {
	validatePage(input)
	const filtered = filterRows(rows, input?.conditions ?? [])
	const order = input?.order
	const sorted = order !== undefined && order.length > 0 ? sortRows(filtered, order) : filtered
	const offset = input?.offset ?? 0
	const limit = input?.limit
	return offset > 0 || limit !== undefined
		? sorted.slice(offset, limit !== undefined ? offset + limit : undefined)
		: sorted
}

// === Aggregation

/**
 * Computes an aggregate over a column across rows.
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
	if (!isAggregateOperation(operation)) {
		throw new DatabaseError(
			'VALIDATION',
			`Aggregate operation ${preview(operation)} is not one of ${AGGREGATE_OPERATIONS.join(', ')}`,
			{
				operation,
			},
		)
	}
	if (operation === 'count') return rows.length
	const numbers = Iterator.from(rows)
		.flatMap((row) => {
			if (!isRecord(row)) return []
			const value = parseNumber(resolveField(row, column))
			return value === undefined ? [] : [value]
		})
		.toArray()
	if (numbers.length === 0) return undefined
	if (operation === 'sum' || operation === 'average') {
		const total = numbers.reduce((sum, value) => sum + value, 0)
		return operation === 'average' ? total / numbers.length : total
	}
	return numbers.reduce(
		(result, value) =>
			operation === 'minimum' ? Math.min(result, value) : Math.max(result, value),
		operation === 'minimum' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
	)
}

// === Keys

/**
 * Reads a row's primary key from a column, when it is a usable {@link Key}.
 *
 * @param row - The row to read
 * @param column - The primary-key column name
 * @returns The key (a string or finite number), or `undefined`
 *
 * @example
 * ```ts
 * extractKey({ id: 'u1', name: 'Ada' }, 'id') // 'u1'
 * extractKey({ id: { nested: true } }, 'id') // undefined
 * ```
 */
export function extractKey(row: Row, column: string): Key | undefined {
	const value = row[column]
	return isKey(value) ? value : undefined
}

/**
 * Returns a fresh row whose primary column is authoritatively bound to its storage key.
 *
 * @param row - The caller row
 * @param primary - The primary column
 * @param key - The authoritative storage key
 * @returns A fresh row with the bound primary
 *
 * @example
 * ```ts
 * bindRowKey({ slug: 'draft', title: 'Notes' }, 'slug', 'notes') // { slug: 'notes', title: 'Notes' }
 * ```
 */
export function bindRowKey(row: Row, primary: string, key: Key): Row {
	return { ...row, [primary]: key }
}

// === Schema

/**
 * Maps a column's {@link ContractShape} to its portable {@link ColumnStorage} — the
 * value a `TableSchema` carries so a native backend can declare a real column.
 *
 * @remarks
 * `string` → `text`; `number` → `integer` when the shape is integer-only, else
 * `real`; `boolean` → `boolean`. A `literal` takes the type of its values
 * (all-boolean → `boolean`, all-integer → `integer`, mixed/fractional numbers →
 * `real`, all-string → `text`, members of more than one class → `json`, as a union is).
 * `optional` / `nullable` unwrap to their inner
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
	switch (shape.category) {
		case 'string':
			return 'text'
		case 'number':
			return shape.integer === true ? 'integer' : 'real'
		case 'boolean':
			return 'boolean'
		case 'literal': {
			if (shape.values.every((value) => isBoolean(value))) return 'boolean'
			if (shape.values.every((value) => isNumber(value))) {
				return shape.values.every((value) => isInteger(value)) ? 'integer' : 'real'
			}
			return shape.values.every((value) => isString(value)) ? 'text' : 'json'
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
		case 'shape':
			return 'json'
	}
}

/**
 * Projects one contract shape into a portable column schema.
 *
 * @param name - The column name
 * @param shape - The column contract shape
 * @returns The portable storage and independent absence/null acceptance
 *
 * @example
 * ```ts
 * shapeToColumnSchema('age', optionalShape(integerShape()))
 * // { name: 'age', storage: 'integer', optional: true, nullable: false }
 * ```
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

/**
 * Collects a table's column map into each column's portable schema, by name, in declaration
 * order.
 *
 * @param columns - The table's column map
 * @returns Each column's {@link ColumnSchema}, keyed by its name
 *
 * @example
 * ```ts
 * collectColumns({ id: stringShape(), age: optionalShape(integerShape()) }).get('age')
 * // { name: 'age', storage: 'integer', optional: true, nullable: false }
 * ```
 */
export function collectColumns(columns: ColumnMap): ReadonlyMap<string, ColumnSchema> {
	return new Map(
		Object.entries(columns).map(([name, shape]) => [name, shapeToColumnSchema(name, shape)]),
	)
}

/**
 * Reads one flat column's declaration out of a table schema.
 *
 * @remarks
 * The single lookup behind every declared-column question — storage type,
 * optionality, and nullability all come off the returned {@link ColumnSchema},
 * so a caller that needs more than one of them reads them from one result. A
 * nested {@link FieldPath} names no declared column, so resolve the path's head
 * before calling. A schema that does not declare the column returns `undefined`.
 *
 * @param name - The flat column name
 * @param schema - The table's schema
 * @returns The column's {@link ColumnSchema}, or `undefined` when the schema does not declare it
 *
 * @example
 * ```ts
 * findColumn('age', schema)?.storage // 'integer'
 * findColumn('absent', schema) // undefined
 * ```
 */
export function findColumn(name: string, schema: TableSchema): ColumnSchema | undefined {
	return schema.columns.find((candidate) => candidate.name === name)
}

/**
 * Resolves the primary-key column one table keys its rows by.
 *
 * @remarks
 * A table absent from the {@link PrimaryMap} keys its rows by
 * {@link DEFAULT_PRIMARY}, so this is total over any table name.
 *
 * @param primary - The per-table primary-key overrides
 * @param name - The table name
 * @returns The table's primary-key column
 *
 * @example
 * ```ts
 * resolvePrimary({ posts: 'slug' }, 'posts') // 'slug'
 * resolvePrimary({ posts: 'slug' }, 'users') // 'id' — the default primary
 * ```
 */
export function resolvePrimary(primary: PrimaryMap, name: string): string {
	return primary[name] ?? DEFAULT_PRIMARY
}

/**
 * Requires one declared table's columns out of a table map.
 *
 * @remarks
 * The overload preserves the map's own value type for a statically known table
 * name, so a typed view keeps its row type without an assertion. An undeclared
 * table is a caller error rather than an absence, so it throws instead of
 * returning `undefined`.
 *
 * @param tables - The declared table map
 * @param name - The table name
 * @returns The table's {@link ColumnMap}
 * @throws A `NOT_FOUND` {@link DatabaseError} when `tables` does not declare `name`
 *
 * @example
 * ```ts
 * requireColumns({ users: { id: stringShape() } }, 'users') // { id: … }
 * ```
 */
export function requireColumns<T extends TableMap, K extends keyof T & string>(
	tables: T,
	name: K,
): T[K]
export function requireColumns(tables: TableMap, name: string): ColumnMap
export function requireColumns(tables: TableMap, name: string): ColumnMap {
	const columns = tables[name]
	if (columns === undefined) {
		throw new DatabaseError('NOT_FOUND', `Table ${preview(name)} is not declared`, { table: name })
	}
	return columns
}

// === Abort

/**
 * Throws when an {@link OperationOptions.signal | AbortSignal} has fired — the shared
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
 * Applies one table's {@link MigrationStep}s to its rows — a pure row transform.
 *
 * @remarks
 * `column.remove` drops that field from every row (a fresh copy — inputs are
 * never mutated); `column.add` leaves rows as-is (an absent field
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

// === Recording

/**
 * Totals the calls, addressed keys, and returned rows of one member across recorded calls.
 *
 * @param calls - The recorded calls to read
 * @param member - The member to total
 * @returns The member's call count, key total, and row total
 *
 * @example
 * ```ts
 * tallyCalls([{ member: 'read', keys: 2, rows: 1, scoped: false }], 'read') // { calls: 1, keys: 2, rows: 1 }
 * ```
 */
export function tallyCalls(calls: readonly StorageCall[], member: StorageMember): StorageTally {
	const matched = calls.filter((call) => call.member === member)
	return {
		calls: matched.length,
		keys: matched.reduce((total, call) => total + call.keys, 0),
		rows: matched.reduce((total, call) => total + call.rows, 0),
	}
}

/**
 * Yields a source's rows, counting each row on a counter as its consumer pulls it.
 *
 * @remarks
 * The counter holds the rows yielded so far when the consumer stops early, the source ends, or
 * the source throws.
 *
 * @param source - The rows to pass through
 * @param rows - The counter each yielded row advances
 * @yields Each row of the source
 *
 * @example
 * ```ts
 * const driver = createMemoryDriver()
 * await driver.open([{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }], indexes: [] }])
 * await driver.write('users', ['a', 'b'], [{ id: 'a' }, { id: 'b' }])
 * const rows = new StreamPage(0)
 * await Array.fromAsync(streamRecordedRows(driver.scan('users'), rows))
 * rows.count // 2
 * ```
 */
export async function* streamRecordedRows(
	source: AsyncIterable<Row>,
	rows: StreamPageInterface,
): AsyncIterable<Row> {
	for await (const row of source) {
		rows.next()
		yield row
	}
}

// === Conformance

/**
 * Lists the invariants a {@link ReadPlan} breaks for the read it splits.
 *
 * @remarks
 * Checks each invariant {@link DriverInterface} states: every clause on a side, and no
 * clause the read lacks; `order` whole on one side; a native page only over an empty
 * residual filter and order; a native aggregate only over an empty residual filter; an `or`
 * read's residual filter empty or complete; and each side free of an absent-valued key or an
 * empty list. Exactness is the differential's question, not this one.
 *
 * @param input - The read the plan splits
 * @param plan - The plan to check
 * @returns The names of the broken invariants, empty when the plan obeys every one
 *
 * @example
 * ```ts
 * findPlanFaults({ limit: 1 }, { native: {}, residual: { limit: 1 } }) // []
 * findPlanFaults({ limit: 1 }, { native: {}, residual: {} }) // ['coverage']
 * ```
 */
export function findPlanFaults(input: ReadInput, plan: ReadPlan): readonly string[] {
	const { native, residual } = plan
	const conditions = input.conditions ?? []
	const sides = [...(native.conditions ?? []), ...(residual.conditions ?? [])]
	const covered =
		conditions.every((condition) => sides.some((side) => equalsValue(side, condition))) &&
		sides.every((side) => conditions.some((condition) => equalsValue(side, condition))) &&
		(input.limit === undefined
			? native.limit === undefined && residual.limit === undefined
			: native.limit === input.limit || residual.limit === input.limit) &&
		(input.offset === undefined
			? native.offset === undefined && residual.offset === undefined
			: native.offset === input.offset || residual.offset === input.offset) &&
		(input.aggregate === undefined
			? native.aggregate === undefined && residual.aggregate === undefined
			: equalsValue(native.aggregate, input.aggregate) ||
				equalsValue(residual.aggregate, input.aggregate))
	const ordered =
		input.order === undefined || input.order.length === 0
			? native.order === undefined && residual.order === undefined
			: (equalsValue(native.order, input.order) && residual.order === undefined) ||
				(equalsValue(residual.order, input.order) && native.order === undefined)
	const paged =
		(native.limit === undefined && native.offset === undefined) ||
		(residual.conditions === undefined && residual.order === undefined)
	const reduced = native.aggregate === undefined || residual.conditions === undefined
	const folded =
		!conditions.slice(1).some((condition) => condition.connector === 'or') ||
		residual.conditions === undefined ||
		equalsValue(residual.conditions, conditions)
	const compact = [native, residual].every((side) =>
		Object.values(side).every(
			(value) => value !== undefined && !(isArray(value) && value.length === 0),
		),
	)
	return [
		...(covered ? [] : ['coverage']),
		...(ordered ? [] : ['order']),
		...(paged ? [] : ['page']),
		...(reduced ? [] : ['aggregate']),
		...(folded ? [] : ['or']),
		...(compact ? [] : ['empty']),
	]
}

/**
 * Asks a storage for its plan of a read, with the read normalized first.
 *
 * @remarks
 * A storage that does not declare `plan`, `records`, and `stream` answers nothing natively:
 * its plan is an empty native side and the whole read as residual, answered over `scan`.
 *
 * @param storage - The storage to read
 * @param table - The table to read
 * @param input - The read to split
 * @returns The plan
 *
 * @example
 * ```ts
 * planRead(createMemoryDriver(), 'users', { limit: 1, order: [] }) // { native: {}, residual: { limit: 1 } }
 * ```
 */
export function planRead(storage: StorageInterface, table: string, input: ReadInput): ReadPlan {
	const read = normalizeReadInput(input)
	if (storage.plan === undefined || storage.records === undefined || storage.stream === undefined) {
		return { native: {}, residual: read }
	}
	return storage.plan(table, read)
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
 * `offset + limit` matches. A residual order collects the filtered rows, then sorts and
 * pages them through {@link applyQuery}.
 *
 * @param storage - The storage to read
 * @param table - The table to read
 * @param input - The read, without an aggregate
 * @param step - The check to run around each pulled row. Default: none
 * @returns The rows the plan answers
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
): Promise<readonly Row[]> {
	const plan = planRead(storage, table, input)
	const residual = plan.residual
	if (Object.keys(residual).length === 0 && storage.records !== undefined) {
		return storage.records(table, plan.native)
	}
	if (residual.order === undefined) {
		return Array.fromAsync(streamPlannedRows(storage, table, plan.native, residual, step))
	}
	const filter = residual.conditions === undefined ? {} : { conditions: residual.conditions }
	const matched = await Array.fromAsync(
		streamPlannedRows(storage, table, plan.native, filter, step),
	)
	return applyQuery(matched, {
		order: residual.order,
		...(residual.limit === undefined ? {} : { limit: residual.limit }),
		...(residual.offset === undefined ? {} : { offset: residual.offset }),
	})
}

/**
 * Computes an aggregate read through a storage's plan — the read procedure `Table.count`
 * and `Table.aggregate` run and the conformance differential checks.
 *
 * @remarks
 * `aggregate` answers when the plan keeps the aggregate native; otherwise the residual
 * conditions filter the native rows and {@link computeAggregate} reduces them.
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
	const rows = await Array.fromAsync(streamPlannedRows(storage, table, native, filter, step))
	return computeAggregate(rows, aggregate.operation, aggregate.column)
}

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
 * Builds the finding a conformance phase yields when it throws, naming the phase.
 *
 * @remarks
 * The message renders through `errorToMessage`, so a thrown value that no message can render
 * reads `'unknown failure'` rather than escaping the battery. `context.error` keeps the exact
 * thrown value.
 *
 * @param check - The phase the failure stopped
 * @param error - The thrown value
 * @returns The finding
 *
 * @example
 * ```ts
 * buildFailureFinding('open-close', new Error('open refused'))
 * // { check: 'open-close', message: 'open refused', context: { error: Error('open refused') } }
 * ```
 */
export function buildFailureFinding(check: string, error: unknown): ConformanceFinding {
	return { check, message: errorToMessage(error), context: { error } }
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

/**
 * Captures the exact rejection or synchronous throw from a driver conformance operation.
 *
 * @example
 * ```ts
 * await captureFailure(() => Promise.reject('refused')) // 'refused'
 * ```
 */
export async function captureFailure(operation: () => Promise<unknown>): Promise<unknown> {
	try {
		await operation()
		return undefined
	} catch (error) {
		return error
	}
}
