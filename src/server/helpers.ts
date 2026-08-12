import type {
	AggregateOperation,
	ColumnSchema,
	ColumnStorage,
	Condition,
	QueryInput,
	Order,
	Row,
	TableSchema,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { SQLiteRow, SQLiteValue } from '@orkestrel/sqlite'
import { DatabaseError } from '@src/core'
import { cloneJSONValue, isBoolean, isFiniteNumber, isString } from '@orkestrel/contract'
import { EXACT_COLUMN_STORAGE, EXACT_RANGE_COLUMN_STORAGE } from './constants.js'

// The SQLite ↔ JS bridge for the driver. Every helper is pure and
// total — it narrows with `typeof` / `instanceof`, never `as` (AGENTS §1, §14):
// a value that does not fit its column's storage type encodes to `null` rather
// than throwing, and `decodeValue` is the exact inverse. `encodeRow` /
// `decodeRow` lift the per-cell codecs across a whole schema; the SQL
// `quoteIdentifier` contains identifier input. The SQL emitters live together
// in `compilers.ts`; this module owns exactness, codecs, value extraction, and
// persisted-name derivation. Its SQLite import is type-only and cannot couple
// the emitted JavaScript to the native package.

// === Filesystem classification

/**
 * Whether a caught filesystem error reports that nothing is there to read.
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
 * @param error - The caught value to classify; any runtime is accepted
 * @returns `true` when the error reports that the path holds nothing
 *
 * @example
 * ```ts
 * matchesAbsentPath(Object.assign(new Error('gone'), { code: 'ENOENT' })) // true
 * matchesAbsentPath(Object.assign(new Error('denied'), { code: 'EACCES' })) // false
 * matchesAbsentPath('ENOENT') // false
 * ```
 */
export function matchesAbsentPath(error: unknown): boolean {
	if (typeof error !== 'object' || error === null || !('code' in error)) return false
	return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

// === Exactness (native ↔ engine parity gating)
//
// SQLiteDriver's `records` / `count` / `aggregate` / `stream` compile a
// `QueryInput` straight to SQL with NO engine re-filter — a huge perf win, but
// only sound for a condition/order whose compiled SQL provably matches the
// core engine's `matchesCondition` / `sortRows` semantics for every value a
// contract-validated write can store ("declared-type trust"). These guards
// decide, per condition/order/input, whether that proof holds; when it does
// not, the driver falls back to a full scan refined through the same core
// engine every scan-only driver (`MemoryDriver`, `JSONDriver`) already uses —
// exact → native, otherwise → refine, never a silent semantics drift.

/**
 * Whether a value's runtime type matches a column's declared exact type —
 * the operand side of the declared-type-trust proof.
 *
 * @remarks
 * `text` ↔ string, `integer` / `real` ↔ FINITE number (`NaN` / `±Infinity`
 * fail), `boolean` ↔ boolean. Backs {@link matchesConditionExactly}'s operand checks.
 *
 * @param value - The condition operand to test
 * @param type - The column's declared portable type
 * @returns `true` when the operand's runtime type matches the declared type
 *
 * @example
 * ```ts
 * matchesDeclaredType('Ada', 'text') // true
 * matchesDeclaredType(Number.NaN, 'integer') // false — only finite numbers
 * ```
 */
export function matchesDeclaredStorage(value: unknown, storage: ColumnStorage): boolean {
	if (storage === 'text') return isString(value)
	if (storage === 'boolean') return isBoolean(value)
	return isFiniteNumber(value)
}

/**
 * Whether one {@link Condition} compiles to SQL that is PROVABLY identical to
 * the core engine's `matchesCondition` for every value its column's declared
 * type can store.
 *
 * @remarks
 * `false` for a nested `FieldPath` (an array) or a column absent from `schema`.
 * `absent` / `present` are exact unless a column is both optional and nullable.
 * In that combined case the storage sentinel for explicit `null` is not SQL
 * `NULL`, while the core treats both absence and explicit `null` as absent.
 * Every scalar operator refines when the column is optional
 * OR nullable, because SQL null semantics and the core total order differ.
 * Required non-null `equals` / `not` require an operand matching the declared
 * storage and exclude `json` / `blob`. `above` / `below` / `from` / `to` /
 * `between` are exact only for {@link EXACT_RANGE_COLUMN_STORAGE} (`integer` /
 * `real` / `boolean`) — a `text` column's range conditions REFINE, because
 * SQLite's default BINARY collation orders TEXT by Unicode CODE POINT while
 * the core engine's `compareValues` orders JS strings by UTF-16 CODE UNIT,
 * and the two diverge for supplementary-plane characters (see
 * {@link EXACT_COLUMN_STORAGE}'s remarks for the full rationale).
 * `any` / `none` require a NON-EMPTY list where every element matches (an empty
 * list is exact under neither: the engine's `any([])` matches nothing while
 * `none([])` matches everything, and SQL `IN ()` is a syntax error) — these
 * stay exact on `text` (byte equality is collation-independent and engine-
 * identical). `starts` / `ends` are exact only on a `text` column with a
 * string operand (case-sensitive `substr` compile, see {@link compileConditionSQL}) —
 * likewise collation-independent. `like` / `glob` are NEVER exact — SQLite
 * `LIKE` folds case ASCII-only against the engine's Unicode fold, and `GLOB`
 * has character classes the engine treats literally.
 *
 * @param condition - The condition to test
 * @param schema - The table's schema
 * @returns Whether `condition` is exact
 */
export function matchesConditionExactly(condition: Condition, schema: TableSchema): boolean {
	if (!isString(condition.column)) return false
	const column = schema.columns.find((candidate) => candidate.name === condition.column)
	if (column === undefined) return false
	if (condition.operator === 'absent' || condition.operator === 'present') {
		return !(column.optional && column.nullable)
	}
	if (column.optional || column.nullable) return false
	if (!EXACT_COLUMN_STORAGE.some((storage) => storage === column.storage)) return false
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'equals':
		case 'not':
			return matchesDeclaredStorage(first, column.storage)
		case 'above':
		case 'below':
		case 'from':
		case 'to':
			return (
				EXACT_RANGE_COLUMN_STORAGE.some((storage) => storage === column.storage) &&
				matchesDeclaredStorage(first, column.storage)
			)
		case 'between':
			return (
				EXACT_RANGE_COLUMN_STORAGE.some((storage) => storage === column.storage) &&
				matchesDeclaredStorage(first, column.storage) &&
				matchesDeclaredStorage(second, column.storage)
			)
		case 'any':
		case 'none':
			return (
				condition.values.length > 0 &&
				condition.values.every((value) => matchesDeclaredStorage(value, column.storage))
			)
		case 'starts':
		case 'ends':
			return column.storage === 'text' && isString(first)
		case 'like':
		case 'glob':
			return false
	}
}

/**
 * Whether one {@link Order} term's column compiles to an `ORDER BY` that
 * matches the engine's {@link import('@src/core').sortRows} exactly.
 *
 * @remarks
 * `false` for a nested `FieldPath`, a column absent from `schema`, or a
 * declared type outside {@link EXACT_RANGE_COLUMN_STORAGE} (`integer` / `real` /
 * `boolean`). `text` is NOT exact here: SQLite's default BINARY collation
 * orders TEXT by Unicode code point while the core engine's `compareValues`
 * orders JS strings by UTF-16 code unit, and the two diverge for
 * supplementary-plane characters (see {@link EXACT_COLUMN_STORAGE}'s remarks) —
 * a `text` order term REFINES through the core engine instead.
 *
 * @param order - The order term to test
 * @param schema - The table's schema
 * @returns Whether `order` is exact
 */
export function matchesOrderExactly(order: Order, schema: TableSchema): boolean {
	if (!isString(order.column)) return false
	const column = schema.columns.find((candidate) => candidate.name === order.column)
	if (column === undefined) return false
	return (
		!column.optional &&
		!column.nullable &&
		EXACT_RANGE_COLUMN_STORAGE.some((storage) => storage === column.storage)
	)
}

/**
 * Whether a whole {@link QueryInput} is exact — every condition and every order
 * term is exact. `limit` / `offset` never affect exactness (SQL `LIMIT` /
 * `OFFSET` are always engine-identical).
 *
 * @param input - The query input to test
 * @param schema - The table's schema
 * @returns Whether every part of `input` is exact
 */
export function matchesQueryExactly(input: QueryInput, schema: TableSchema): boolean {
	const conditions = input.conditions ?? []
	const order = input.order ?? []
	return (
		conditions.every((condition) => matchesConditionExactly(condition, schema)) &&
		order.every((term) => matchesOrderExactly(term, schema))
	)
}

/**
 * Determine whether SQLite can execute an aggregate exactly like the core engine.
 *
 * @param operation - Aggregate operation
 * @param column - Aggregate field
 * @param schema - Current table schema
 * @returns Whether native aggregation is exact
 */
export function matchesAggregateExactly(
	operation: AggregateOperation,
	column: FieldPath,
	schema: TableSchema,
): boolean {
	if (operation === 'count') return true
	if (operation === 'sum' || operation === 'average' || !isString(column)) return false
	const declared = schema.columns.find((candidate) => candidate.name === column)
	return (
		declared !== undefined &&
		(declared.storage === 'integer' || declared.storage === 'real') &&
		!(declared.optional && declared.nullable)
	)
}

/**
 * Test a declared SQLite type against a portable storage affinity.
 *
 * @param declared - Native declared type
 * @param storage - Portable column storage
 * @returns Whether SQLite's official affinity rules yield the expected affinity
 */
export function matchesSQLiteAffinity(declared: unknown, storage: ColumnStorage): boolean {
	if (!isString(declared)) return false
	const type = declared.toUpperCase()
	let affinity: 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' | 'NUMERIC'
	if (type.includes('INT')) affinity = 'INTEGER'
	else if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT'))
		affinity = 'TEXT'
	else if (type === '' || type.includes('BLOB')) affinity = 'BLOB'
	else if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB'))
		affinity = 'REAL'
	else affinity = 'NUMERIC'
	if (storage === 'integer' || storage === 'boolean') return affinity === 'INTEGER'
	if (storage === 'text' || storage === 'json') return affinity === 'TEXT'
	if (storage === 'blob') return affinity === 'BLOB'
	return affinity === 'REAL'
}

// === SQL identifiers

/**
 * Quote a SQL identifier (a table or column name) so any characters are literal.
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
 * Encode a JS value to its stored {@link SQLiteValue} for a declared column.
 *
 * @remarks
 * The codec is total: a malformed value encodes to SQL `NULL`. Absence always
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
		return column.storage === 'text' || column.storage === 'json' ? new Uint8Array() : String(null)
	}
	switch (column.storage) {
		case 'boolean':
			return typeof value === 'boolean' ? (value ? 1 : 0) : null
		case 'json':
			try {
				return JSON.stringify(cloneJSONValue(value))
			} catch {
				return null
			}
		case 'integer':
			return typeof value === 'bigint' ||
				(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value))
				? value
				: null
		case 'real':
			return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value))
				? value
				: null
		case 'text':
			return typeof value === 'string' ? value : null
		case 'blob':
			return value instanceof Uint8Array ? value : null
	}
}

/**
 * Decode a stored {@link SQLiteValue} back to its JS value for a declared column —
 * the exact inverse of {@link encodeValue}.
 *
 * @remarks
 * Stored values must use the declared SQLite storage class. SQL `NULL` decodes
 * to explicit `null` only for nullable-only columns and otherwise to absence.
 * Optional-and-nullable sentinels decode to explicit `null`; malformed values
 * decode to `undefined` so {@link decodeRow} omits them.
 *
 * @param value - The stored SQLite value
 * @param column - The declared storage and absence/null contract
 * @returns The decoded JS value, or `undefined` for absence/malformed storage
 *
 * @example
 * ```ts
 * decodeValue(1, booleanColumn) // true
 * decodeValue('{"a":1}', jsonColumn) // { a: 1 }
 * ```
 */
export function decodeValue(value: SQLiteValue, column: ColumnSchema): unknown {
	if (value === null) return column.nullable && !column.optional ? null : undefined
	if (
		column.optional &&
		column.nullable &&
		(column.storage === 'text' || column.storage === 'json'
			? value instanceof Uint8Array && value.byteLength === 0
			: value === String(null))
	) {
		return null
	}
	switch (column.storage) {
		case 'boolean':
			if (value === 0 || value === 0n) return false
			if (value === 1 || value === 1n) return true
			return undefined
		case 'json':
			if (typeof value !== 'string') return undefined
			try {
				return structuredClone(cloneJSONValue(JSON.parse(value)))
			} catch {
				return undefined
			}
		case 'integer':
			return typeof value === 'bigint' ||
				(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value))
				? value
				: undefined
		case 'real':
			return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value))
				? value
				: undefined
		case 'text':
			return typeof value === 'string' ? value : undefined
		case 'blob':
			return value instanceof Uint8Array ? value : undefined
	}
}

/**
 * Encode a whole {@link Row} to a {@link SQLiteRow} by its table's schema.
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
 * Extract a stored row's values in a declared positional order.
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
 * Decode a stored {@link SQLiteRow} back to a {@link Row} by its table's schema.
 *
 * @remarks
 * Decodes each declared column with {@link decodeValue} and **omits** any column
 * whose decoded value is `undefined` — so an absent / `NULL` optional column does
 * not surface as `{ bio: undefined }`, matching how the contract's optional
 * columns expect absence. Nullable-only SQL `NULL` cells remain explicit
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
	const result: Row = {}
	for (const column of schema.columns) {
		const value = row[column.name]
		if (value === undefined) continue
		const decoded = decodeValue(value, column)
		if (decoded !== undefined) result[column.name] = decoded
	}
	return result
}

// === Persisted names

/**
 * Build a collision-free SQL index name for a table + column-group index —
 * shared by the compiler module's `schemaToIndexes` and `stepToSQL`,
 * so a plan-built index name always matches one `open` would have created.
 *
 * @remarks
 * A naive `idx_<table>_<cols joined by _>` is AMBIGUOUS: table `'a_b'` with
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
