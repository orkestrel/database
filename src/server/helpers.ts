import type {
	ColumnSchema,
	ColumnStorage,
	Condition,
	ReadInput,
	ReadPlan,
	Row,
	TableSchema,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { SQLiteRow, SQLiteValue } from '@orkestrel/sqlite'
import { DatabaseError, findColumn, MAX_PATTERN_LENGTH, normalizeReadInput } from '@src/core'
import { isPragmaName, isPragmaValue } from '@orkestrel/sqlite'
import { PRAGMA_NAMES } from './constants.js'
import { inferSentinelType } from './inferers.js'
import {
	attempt,
	cloneJSONValue,
	isBigInt,
	isBoolean,
	isError,
	isFiniteNumber,
	isInteger,
	isNumber,
	isString,
	isUint8Array,
	preview,
} from '@orkestrel/contract'

// The server environment's pure helpers: the SQLite planner, the SQLite ↔ JS bridge, and
// the filesystem-error classification the file-backed driver reads. Encoding refuses
// incompatible present values; decoding raises on malformed storage. `encodeRow` /
// `decodeRow` lift the per-cell codecs across a whole schema; the SQL
// `quoteIdentifier` contains identifier input. The SQL emitters live together
// in `compilers.ts`; this module owns the planner, codecs, value extraction, and
// persisted-name derivation. Its one SQLite value import is the wrapper's pragma guards.

// === Filesystem classification

/**
 * Reports whether a caught filesystem error says that nothing is there to read.
 *
 * @remarks
 * Two codes carry that meaning: `ENOENT` is a plain absence, and `ENOTDIR` is a
 * path whose parent is not a directory — an absence in the stronger sense, since
 * no file can exist at that name and no later write could find one. Hosts
 * disagree about which of the two they report for the second shape, so a driver
 * that reads only `ENOENT` opens on one host and fails closed on another over
 * the same tree.
 *
 * Every other code — a permission refusal, a symlink loop, an unreadable
 * existing file — is a real failure and stays one.
 *
 * A caught value that is not a coded `Error` is not a report about a path, so it
 * answers `false` rather than being read for a `code` any object could carry.
 *
 * @param error - The caught value to classify; any runtime is accepted
 * @returns True if the error reports that the path holds nothing; false otherwise
 *
 * @example
 * ```ts
 * matchesAbsentPath(Object.assign(new Error('gone'), { code: 'ENOENT' })) // true
 * matchesAbsentPath(Object.assign(new Error('denied'), { code: 'EACCES' })) // false
 * matchesAbsentPath('ENOENT') // false
 * ```
 */
export function matchesAbsentPath(error: unknown): boolean {
	if (!isError(error) || !('code' in error)) return false
	return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

// === Native coverage (the SQLite planner)
//
// SQLiteDriver answers each read through `planSQLiteQuery`: every clause SQLite answers with
// the contract's meaning goes to the plan's native side, which `compileQuerySQL` compiles,
// and only the rest goes to the residual the core runs. A flat declared `text`, `integer`,
// `real`, or `boolean` column is native under every operator, with the forms chosen from the
// column's flags; the equality family on a nested scalar under a `json` head is a prefilter
// on both sides; every other nested path and a `json` or `blob` column stay residual.

/**
 * Reports whether an operand has the storage class a declared column stores, so a bound
 * operand compares as the stored values do.
 *
 * @remarks
 * `text` ↔ string, `integer` ↔ finite integer, `real` ↔ finite number, `boolean` ↔
 * boolean. Every other storage answers `false`.
 *
 * @param value - The condition operand to test
 * @param storage - The column's declared portable storage type
 * @returns True if the operand's runtime type matches the declared type; false otherwise
 *
 * @example
 * ```ts
 * matchesDeclaredStorage('Ada', 'text') // true
 * matchesDeclaredStorage(1.5, 'integer') // false — only finite integers
 * ```
 */
export function matchesDeclaredStorage(value: unknown, storage: ColumnStorage): boolean {
	switch (storage) {
		case 'text':
			return isString(value)
		case 'boolean':
			return isBoolean(value)
		case 'integer':
			return isFiniteNumber(value) && isInteger(value)
		case 'real':
			return isFiniteNumber(value)
		case 'json':
		case 'blob':
			return false
	}
}

/**
 * Resolves the declared column a field path names when SQLite answers it natively: a flat
 * path to a declared `text`, `integer`, `real`, or `boolean` column.
 *
 * @param path - The field path a condition, an order term, or an aggregate names
 * @param schema - The table's schema
 * @returns The declared column, or `undefined` for a nested path, an undeclared column, or
 *   a `json` or `blob` column
 *
 * @example
 * ```ts
 * findSQLiteColumn('age', schema) // { name: 'age', storage: 'integer', … }
 * findSQLiteColumn(['meta', 'tag'], schema) // undefined
 * ```
 */
export function findSQLiteColumn(path: FieldPath, schema: TableSchema): ColumnSchema | undefined {
	if (!isString(path)) return undefined
	const column = findColumn(path, schema)
	if (column === undefined || column.storage === 'json' || column.storage === 'blob') {
		return undefined
	}
	return column
}

/**
 * Reports whether SQLite answers one {@link Condition} with the core engine's meaning.
 *
 * @remarks
 * The column must be a flat declared `text`, `integer`, `real`, or `boolean` column. Under
 * every flag combination: `absent` and `present` always; `equals` and `not` with a `null`
 * operand, an `undefined` operand, or an operand of the column's storage class; `above`,
 * `below`, `from`, `to`, and `between` with operands of that class (text included, under
 * the engine's binary order); `any` and `none` when every operand is `null`, `undefined`,
 * or of that class; `like` and `glob` on a `text` column with a string pattern no longer
 * than {@link MAX_PATTERN_LENGTH}; `starts` and `ends` on a `text` column with a string
 * operand.
 *
 * @param condition - The condition to test
 * @param schema - The table's schema
 * @returns True if SQLite answers the condition natively; false otherwise
 *
 * @example
 * ```ts
 * matchesSQLiteCondition({ column: 'name', operator: 'like', values: ['a%'], connector: 'and' }, schema) // true
 * ```
 */
export function matchesSQLiteCondition(condition: Condition, schema: TableSchema): boolean {
	const column = findSQLiteColumn(condition.column, schema)
	if (column === undefined) return false
	const [first, second] = condition.values
	switch (condition.operator) {
		case 'absent':
		case 'present':
			return true
		case 'equals':
		case 'not':
			return first === null || first === undefined || matchesDeclaredStorage(first, column.storage)
		case 'above':
		case 'below':
		case 'from':
		case 'to':
			return matchesDeclaredStorage(first, column.storage)
		case 'between':
			return (
				matchesDeclaredStorage(first, column.storage) &&
				matchesDeclaredStorage(second, column.storage)
			)
		case 'any':
		case 'none':
			return condition.values.every(
				(value) =>
					value === null || value === undefined || matchesDeclaredStorage(value, column.storage),
			)
		case 'like':
		case 'glob':
			return column.storage === 'text' && isString(first) && first.length <= MAX_PATTERN_LENGTH
		case 'starts':
		case 'ends':
			return column.storage === 'text' && isString(first)
	}
}

/**
 * Reports whether SQLite applies a superset form of one {@link Condition} that the core then
 * rechecks: `equals`, `not`, `any`, or `none` on a nested path under a declared `json` head,
 * with scalar operands.
 *
 * @remarks
 * The path holds a head and at least one key, and a JSON path label names each key as the
 * core does: a canonical array index such as `0` and `length` reach an array member in the
 * core, while a label names an object member only, and a key holding U+0000 ends the SQL text
 * the label sits in. Every operand is a string, a number, a boolean, `null`, or `undefined`.
 * {@link compileNestedSQL} compiles the form.
 *
 * @param condition - The condition to test
 * @param schema - The table's schema
 * @returns True if the condition goes to both sides of the plan; false otherwise
 *
 * @example
 * ```ts
 * matchesSQLitePrefilter({ column: ['meta', 'tag'], operator: 'equals', values: ['red'], connector: 'and' }, schema) // true
 * matchesSQLitePrefilter({ column: ['meta', '0'], operator: 'equals', values: ['red'], connector: 'and' }, schema) // false
 * ```
 */
export function matchesSQLitePrefilter(condition: Condition, schema: TableSchema): boolean {
	if (isString(condition.column)) return false
	const [head, ...keys] = condition.column
	return (
		head !== undefined &&
		keys.length > 0 &&
		findColumn(head, schema)?.storage === 'json' &&
		keys.every(
			(key) => key !== 'length' && !key.includes('\u0000') && !/^(?:0|[1-9]\d*)$/u.test(key),
		) &&
		(condition.operator === 'equals' ||
			condition.operator === 'not' ||
			condition.operator === 'any' ||
			condition.operator === 'none') &&
		condition.values.every(
			(value) =>
				value === null ||
				value === undefined ||
				isString(value) ||
				isNumber(value) ||
				isBoolean(value),
		)
	)
}

/**
 * Splits a read into the part SQLite answers natively and the residual the core runs — the
 * SQLite driver's `plan`.
 *
 * @remarks
 * When every connector is `and`, each condition {@link matchesSQLiteCondition} answers goes
 * native, each condition {@link matchesSQLitePrefilter} admits goes to both sides, and the
 * rest go residual; when any connector is `or`, the conditions go native together or
 * residual together. The order goes native when every term names a flat declared column:
 * SQL places `NULL` lowest in both directions, the core's place for an absent or `null`
 * value, and {@link compileOrderSQL} ranks the sentinel of a column that is both optional and
 * nullable between absence and the values. The page goes native when the residual holds no
 * condition and no order. The aggregate goes native when the residual holds no condition
 * and it is `count`, or `sum`, `average`, `minimum`, or `maximum` on a flat declared
 * `integer` or `real` column that is not both optional and nullable, under the engine's
 * arithmetic. A side that carries nothing is `{}`, so a read is wholly native when
 * `residual` equals `{}`. Pass the native side to {@link compileQuerySQL} for its SQL.
 *
 * @param input - The read to split
 * @param schema - The table's schema
 * @returns The plan
 *
 * @example
 * ```ts
 * planSQLiteQuery({ conditions: [{ column: 'name', operator: 'like', values: ['a%'], connector: 'and' }], limit: 10 }, schema)
 * // { native: { conditions: [ … ], limit: 10 }, residual: {} }
 * ```
 */
export function planSQLiteQuery(input: ReadInput, schema: TableSchema): ReadPlan {
	const read = normalizeReadInput(input)
	const conditions = read.conditions ?? []
	const answered = conditions.filter((condition) => matchesSQLiteCondition(condition, schema))
	const folded = conditions.slice(1).some((condition) => condition.connector === 'or')
	const whole = answered.length === conditions.length
	const native = whole
		? conditions
		: folded
			? []
			: conditions.filter(
					(condition) => answered.includes(condition) || matchesSQLitePrefilter(condition, schema),
				)
	const residual = whole
		? []
		: folded
			? conditions
			: conditions.filter((condition) => !answered.includes(condition))
	const order = read.order ?? []
	const ordered = order.every((term) => findSQLiteColumn(term.column, schema) !== undefined)
	const paged = residual.length === 0 && ordered
	const aggregate = read.aggregate
	const measured = aggregate === undefined ? undefined : findSQLiteColumn(aggregate.column, schema)
	const reduced =
		aggregate !== undefined &&
		residual.length === 0 &&
		(aggregate.operation === 'count' ||
			(measured !== undefined &&
				(measured.storage === 'integer' || measured.storage === 'real') &&
				!(measured.optional && measured.nullable)))
	return {
		native: normalizeReadInput({
			conditions: native,
			order: ordered ? order : [],
			...(paged && read.limit !== undefined ? { limit: read.limit } : {}),
			...(paged && read.offset !== undefined ? { offset: read.offset } : {}),
			...(reduced ? { aggregate } : {}),
		}),
		residual: normalizeReadInput({
			conditions: residual,
			order: ordered ? [] : order,
			...(!paged && read.limit !== undefined ? { limit: read.limit } : {}),
			...(!paged && read.offset !== undefined ? { offset: read.offset } : {}),
			...(aggregate !== undefined && !reduced ? { aggregate } : {}),
		}),
	}
}

/**
 * Reports whether a WHERE fold pins its column references: every connector is `and` and one
 * condition is `any` on the primary key.
 *
 * @param conditions - The conditions to fold
 * @param schema - The table's schema
 * @returns True if the fold pins every condition but the primary-key `any`; false otherwise
 *
 * @example
 * ```ts
 * matchesPrimaryPin([{ column: 'id', operator: 'any', values: ['a'], connector: 'and' }], schema) // true
 * ```
 */
export function matchesPrimaryPin(conditions: readonly Condition[], schema: TableSchema): boolean {
	return (
		!conditions.slice(1).some((condition) => condition.connector === 'or') &&
		conditions.some(
			(condition) => condition.operator === 'any' && condition.column === schema.primary,
		)
	)
}

/**
 * Computes the least text above every text that starts with a prefix, in code-point order —
 * the exclusive upper bound of the `starts` range.
 *
 * @remarks
 * Increments the final code point, skipping the surrogate range. A final U+10FFFF drops and
 * carries to the code point before it. A prefix of U+10FFFF code points alone has no upper
 * bound.
 *
 * @param prefix - The prefix, holding no unpaired surrogate
 * @returns The successor, or `undefined` when no text bounds the prefix's range
 *
 * @example
 * ```ts
 * computeSuccessor('ab') // 'ac'
 * computeSuccessor('a\u{10FFFF}') // 'b'
 * computeSuccessor('퟿') // ''
 * ```
 */
export function computeSuccessor(prefix: string): string | undefined {
	const points = Array.from(prefix)
	const kept = points.findLastIndex((point) => (point.codePointAt(0) ?? 0) < 0x10ffff)
	if (kept < 0) return undefined
	const code = (points[kept]?.codePointAt(0) ?? 0) + 1
	const next = code === 0xd800 ? 0xe000 : code
	return points.slice(0, kept).join('') + String.fromCodePoint(next)
}

/**
 * Checks a declared SQLite type against a portable storage affinity.
 *
 * @param declared - Native declared type
 * @param storage - Portable column storage
 * @returns True if SQLite's official affinity rules yield the expected affinity; false otherwise
 */
export function matchesSQLiteAffinity(declared: unknown, storage: ColumnStorage): boolean {
	if (!isString(declared)) return false
	const type = declared.toUpperCase()
	const affinity = type.includes('INT')
		? 'INTEGER'
		: type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')
			? 'TEXT'
			: type === '' || type.includes('BLOB')
				? 'BLOB'
				: type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')
					? 'REAL'
					: 'NUMERIC'
	if (storage === 'integer' || storage === 'boolean') return affinity === 'INTEGER'
	if (storage === 'text' || storage === 'json') return affinity === 'TEXT'
	if (storage === 'blob') return affinity === 'BLOB'
	return affinity === 'REAL'
}

// === Connection settings

/**
 * Validates the `pragmas` option of the SQLite driver: each name must pass `isPragmaName` and
 * be one of {@link PRAGMA_NAMES}, matched exactly, and each value must pass `isPragmaValue`.
 *
 * @remarks
 * `@orkestrel/sqlite` owns the pragma syntax: a name is ASCII letters, digits, and
 * underscores, and a value is a 32-bit signed integer or a bare keyword of ASCII letters and
 * underscores, such as `WAL` or `FULL`, so a value can neither chain a statement nor carry
 * another setting. {@link PRAGMA_NAMES} is the planner's fact: the names that change no read
 * result. The check runs before the driver connects.
 *
 * @param pragmas - The PRAGMA names and values to apply at open, or `undefined` for none
 * @throws A `VALIDATION` {@link DatabaseError} naming the refused pragma, and its value when
 *   the value is refused
 *
 * @example
 * ```ts
 * validatePragmas({ journal_mode: 'WAL' }) // returns
 * validatePragmas({ case_sensitive_like: 'ON' }) // throws VALIDATION
 * validatePragmas({ cache_size: 2147483648 }) // throws VALIDATION
 * ```
 */
export function validatePragmas(
	pragmas: Readonly<Record<string, string | number>> | undefined,
): void {
	for (const [name, value] of Object.entries(pragmas ?? {})) {
		if (!isPragmaName(name) || !PRAGMA_NAMES.includes(name)) {
			throw new DatabaseError(
				'VALIDATION',
				`SQLite pragma ${preview(name)} is refused: the driver admits only ${PRAGMA_NAMES.join(', ')}, which change no read result`,
				{ pragma: name },
			)
		}
		if (!isPragmaValue(value)) {
			throw new DatabaseError(
				'VALIDATION',
				`SQLite pragma ${preview(name)} takes a 32-bit signed integer or a keyword of ASCII letters and underscores, not ${preview(value)}`,
				{ pragma: name, value: preview(value) },
			)
		}
	}
}

// === SQL identifiers

/**
 * Quotes a SQL identifier (a table or column name) so any characters are literal.
 *
 * @remarks
 * Wraps the name in double quotes and doubles any embedded quote — the standard
 * SQL identifier-quoting that lets a column named `order` or `from` be referenced
 * safely. Identifiers cannot be bound as parameters, so they are quoted instead.
 *
 * @param identifier - The raw identifier
 * @returns The double-quoted identifier
 *
 * @example
 * ```ts
 * quoteIdentifier('order') // '"order"'
 * ```
 */
export function quoteIdentifier(identifier: string): string {
	return '"' + identifier.replaceAll('"', '""') + '"'
}

// === Value codecs

/**
 * Encodes a JS value to its stored {@link SQLiteValue} for a declared column.
 *
 * @remarks
 * A malformed present value throws a `VALIDATION` DatabaseError. Absence always
 * uses SQL `NULL`. A nullable-only column also uses SQL `NULL` for explicit
 * `null`; an optional-and-nullable column uses a storage-class sentinel so
 * absence and explicit `null` remain distinct.
 *
 * @param value - The JS value to store
 * @param column - The declared storage and absence/null contract
 * @returns The value SQLite stores
 *
 * @example
 * ```ts
 * encodeValue(true, booleanColumn) // 1
 * encodeValue({ a: 1 }, jsonColumn) // '{"a":1}'
 * ```
 */
export function encodeValue(value: unknown, column: ColumnSchema): SQLiteValue {
	if (value === undefined) return null
	if (value === null) {
		if (!column.nullable) return null
		if (!column.optional) return null
		return inferSentinelType(column.storage) === 'blob' ? new Uint8Array() : String(null)
	}
	switch (column.storage) {
		case 'boolean':
			if (isBoolean(value)) return value ? 1 : 0
			break
		case 'json': {
			const encoded = attempt(() => JSON.stringify(cloneJSONValue(value)))
			if (encoded.success) return encoded.value
			break
		}
		case 'integer':
			if (isBigInt(value) || (isFiniteNumber(value) && isInteger(value))) return value
			break
		case 'real':
			if (isBigInt(value) || isFiniteNumber(value)) return value
			break
		case 'text':
			if (isString(value)) return value
			break
		case 'blob':
			if (isUint8Array(value)) return value
			break
	}
	throw new DatabaseError('VALIDATION', `Value cannot be stored in column ${preview(column.name)}`)
}

/**
 * Decodes a stored {@link SQLiteValue} back to its JS value for a declared column —
 * the exact inverse of {@link encodeValue}.
 *
 * @remarks
 * SQL `NULL` decodes to explicit `null` only for a nullable-only column and otherwise to
 * absence. An optional-and-nullable sentinel decodes to explicit `null`. A stored value whose
 * storage class does not match its declaration, or malformed JSON text, is corruption: it
 * raises `DRIVER` with `context` plus the column, and never decodes to absence.
 *
 * @param value - The stored SQLite value
 * @param column - The declared storage and absence/null contract
 * @param context - The fault context the caller names, such as `table` and `key`
 * @returns The decoded JS value, or `undefined` for absence
 * @throws A `DRIVER` {@link DatabaseError} when the stored value does not match its declaration
 *
 * @example
 * ```ts
 * decodeValue(1, booleanColumn) // true
 * decodeValue('{"a":1}', jsonColumn) // { a: 1 }
 * ```
 */
export function decodeValue(
	value: SQLiteValue,
	column: ColumnSchema,
	context: Readonly<Record<string, unknown>> = {},
): unknown {
	if (value === null) return column.nullable && !column.optional ? null : undefined
	if (
		column.optional &&
		column.nullable &&
		(inferSentinelType(column.storage) === 'blob'
			? isUint8Array(value) && value.byteLength === 0
			: value === String(null))
	) {
		return null
	}
	switch (column.storage) {
		case 'boolean':
			if (value === 0 || value === 0n) return false
			if (value === 1 || value === 1n) return true
			break
		case 'json': {
			if (!isString(value)) break
			const parsed = attempt<unknown>(() => JSON.parse(value))
			if (parsed.success) return structuredClone(cloneJSONValue(parsed.value))
			break
		}
		case 'integer':
			if (isBigInt(value) || (isFiniteNumber(value) && isInteger(value))) return value
			break
		case 'real':
			if (isBigInt(value) || isFiniteNumber(value)) return value
			break
		case 'text':
			if (isString(value)) return value
			break
		case 'blob':
			if (isUint8Array(value)) return value
			break
	}
	throw new DatabaseError(
		'DRIVER',
		`Stored value in column ${preview(column.name)} does not match its declaration`,
		{ ...context, column: column.name, storage: column.storage },
	)
}

/**
 * Encodes a whole {@link Row} to a {@link SQLiteRow} by its table's schema.
 *
 * @remarks
 * Encodes each declared column's value with {@link encodeValue}; columns the row
 * does not carry encode from `undefined` (so they store `null`). Only the
 * schema's columns appear in the result — an extra row key is dropped.
 *
 * @param row - The JS row to store
 * @param schema - The table's schema
 * @returns The storable SQLite row
 *
 * @example
 * ```ts
 * encodeRow({ id: 'u1', active: true }, schema) // { id: 'u1', active: 1, ... }
 * ```
 */
export function encodeRow(row: Row, schema: TableSchema): SQLiteRow {
	const result: SQLiteRow = {}
	for (const column of schema.columns) {
		result[column.name] = encodeValue(row[column.name], column)
	}
	return result
}

/**
 * Extracts a stored row's values in a declared positional order.
 *
 * @remarks
 * SQLite statements bind arrays positionally. Every requested column must be
 * present in `row`; an incomplete backend row is a typed `DRIVER` fault carrying
 * the table and missing column in its context.
 *
 * @param row - The stored SQLite row
 * @param names - The column names in binding order
 * @param table - The owning table name for fault context
 * @returns The row values in the same order as `names`
 * @throws A `DRIVER` {@link DatabaseError} when a requested column is missing
 *
 * @example
 * ```ts
 * extractValues({ id: 'u1', age: 36 }, ['age', 'id'], 'users') // [36, 'u1']
 * ```
 */
export function extractValues(
	row: SQLiteRow,
	names: readonly string[],
	table: string,
): readonly SQLiteValue[] {
	const values: SQLiteValue[] = []
	for (const name of names) {
		const value = row[name]
		if (value === undefined) {
			throw new DatabaseError('DRIVER', 'SQLite row is missing a declared column', {
				table,
				column: name,
			})
		}
		values.push(value)
	}
	return values
}

/**
 * Decodes a stored {@link SQLiteRow} back to a {@link Row} by its table's schema.
 *
 * @remarks
 * Decodes each declared column with {@link decodeValue} and **omits** any column
 * whose decoded value is `undefined` — so an absent / `NULL` optional column does
 * not surface as `{ bio: undefined }`, matching how the contract's optional
 * columns expect absence. A cell that does not match its declaration raises `DRIVER` with
 * `table`, `column`, and `key`. Nullable-only SQL `NULL` cells remain explicit
 * `null`; optional-and-nullable columns use their storage-class sentinel.
 *
 * @param row - The stored SQLite row
 * @param schema - The table's schema
 * @returns The decoded JS row (absent columns omitted)
 *
 * @example
 * ```ts
 * decodeRow({ id: 'u1', active: 1, bio: null }, schema) // { id: 'u1', active: true }
 * ```
 */
export function decodeRow(row: SQLiteRow, schema: TableSchema): Row {
	const context = { table: schema.name, key: row[schema.primary] }
	const result: Row = {}
	for (const column of schema.columns) {
		const value = row[column.name]
		if (value === undefined) continue
		const decoded = decodeValue(value, column, context)
		if (decoded !== undefined) result[column.name] = decoded
	}
	return result
}

// === Persisted names

/**
 * Builds a collision-free SQL index name for a table + column-group index —
 * shared by the compiler module's `schemaToIndexes` and `stepToSQL`,
 * so a plan-built index name always matches one `open` would have created.
 *
 * @remarks
 * A naive `idx_<table>_<cols joined by _>` is ambiguous: table `'a_b'` with
 * column `'c'` and table `'a'` with columns `['b', 'c']` both produce
 * `idx_a_b_c`. This encodes each part (the table name, then each column name)
 * length-prefixed (`<len>_<part>`) so the boundary between parts is always
 * unambiguous, however the names themselves are punctuated.
 *
 * @param table - The table name
 * @param columns - The index's column names, in order
 * @returns The deterministic, collision-free index identifier (unquoted)
 *
 * @example
 * ```ts
 * deriveSQLiteIndexName('users', ['name']) // 'idx_5_users_4_name'
 * deriveSQLiteIndexName('a_b', ['c']) // 'idx_3_a_b_1_c'
 * deriveSQLiteIndexName('a', ['b', 'c']) // 'idx_1_a_1_b_1_c'
 * ```
 */
export function deriveSQLiteIndexName(table: string, columns: readonly string[]): string {
	const parts = [table, ...columns].map((part) => String(part.length) + '_' + part)
	return 'idx_' + parts.join('_')
}
