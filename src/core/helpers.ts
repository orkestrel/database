import type { AuditFault, ContractShape } from '@orkestrel/contract'
import type {
	ColumnMap,
	ColumnSchema,
	ColumnStorage,
	ConformanceFinding,
	Condition,
	QueryInput,
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
	attempt,
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
	preview,
	resolveField,
	settle,
} from '@orkestrel/contract'
import {
	DEFAULT_PRIMARY,
	MAX_PATTERN_LENGTH,
	NULLISH_OPERATORS,
	PATTERN_OPERATORS,
} from './constants.js'
import { DatabaseError } from './errors.js'
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
 * Extracts the values an ordering specification compares from one row, one per term.
 *
 * @remarks
 * Each term's column resolves through Contract's `resolveField`, so an array path descends a
 * nested value and an absent field reads `undefined`.
 *
 * @param row - The row to read
 * @param order - The ordering terms in priority order
 * @returns The row's value at each term's column, in term order
 *
 * @example
 * ```ts
 * extractOrderKeys({ age: 36, meta: { tag: 'a' } }, [{ column: 'age', direction: 'ascending' }, { column: ['meta', 'tag'], direction: 'descending' }]) // [36, 'a']
 * ```
 */
export function extractOrderKeys(row: Row, order: readonly Order[]): readonly unknown[] {
	return order.map((term) => resolveField(row, term.column))
}

/**
 * Compares two rows' order keys under an ordering specification.
 *
 * @remarks
 * Applies the terms in priority order — the first term whose keys differ decides — using
 * {@link compareValues}, reversed for `descending`. Keys no term tells apart tie.
 *
 * @param left - The left row's keys from {@link extractOrderKeys}
 * @param right - The right row's keys from {@link extractOrderKeys}
 * @param order - The ordering terms the keys were extracted for
 * @returns A negative number when `left` sorts first, a positive number when `right` does, and
 *   `0` for a tie
 *
 * @example
 * ```ts
 * compareOrderKeys([1], [2], [{ column: 'age', direction: 'descending' }]) // 1
 * ```
 */
export function compareOrderKeys(
	left: readonly unknown[],
	right: readonly unknown[],
	order: readonly Order[],
): number {
	for (const [index, term] of order.entries()) {
		const comparison = compareValues(left[index], right[index])
		if (comparison !== 0) return term.direction === 'descending' ? -comparison : comparison
	}
	return 0
}

/**
 * Sorts rows by an ordering specification, leaving the input untouched.
 *
 * @remarks
 * Extracts each row's keys once through {@link extractOrderKeys} and compares them through
 * {@link compareOrderKeys}. Rows the terms cannot distinguish keep their input order when the
 * final term ascends and reverse it when the final term descends, so over rows in ascending key
 * order a tie resolves by primary key in the direction of the final term.
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
	return rows
		.map((row, index) => [index, row, extractOrderKeys(row, order)] as const)
		.sort(
			([leftIndex, , leftKeys], [rightIndex, , rightKeys]) =>
				compareOrderKeys(leftKeys, rightKeys, order) ||
				(descending ? rightIndex - leftIndex : leftIndex - rightIndex),
		)
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
 * for nested `FieldPath` queries. A scan-only backend ignores the result. A `function`,
 * `interface`, or `undefined` shape has no storable form and throws, at the top level or under
 * `optional` or `nullable`.
 *
 * @param shape - The column's contract shape
 * @returns The portable column type
 * @throws {@link DatabaseError} `VALIDATION` for a `function`, `interface`, or `undefined` shape
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
		case 'function':
		case 'interface':
		case 'undefined':
			throw new DatabaseError(
				'VALIDATION',
				`A column declares the '${shape.category}' category, which has no storable form; declare a json or raw column instead`,
				{ category: shape.category },
			)
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
	const storage = attempt(() => shapeToColumnStorage(shape))
	if (!storage.success) {
		const category =
			storage.error instanceof DatabaseError && isString(storage.error.context?.category)
				? storage.error.context.category
				: 'function'
		throw new DatabaseError(
			'VALIDATION',
			`Column '${name}' declares the '${category}' category, which has no storable form; declare a json or raw column instead`,
			{ column: name, category },
		)
	}
	return {
		name,
		storage: storage.value,
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
 * Captures the exact rejection or synchronous throw from a driver conformance operation.
 *
 * @example
 * ```ts
 * await captureFailure(() => Promise.reject('refused')) // 'refused'
 * ```
 */
export async function captureFailure(operation: () => Promise<unknown>): Promise<unknown> {
	const outcome = await settle(operation)
	return outcome.success ? undefined : outcome.error
}
