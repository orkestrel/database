import type {
	AggregateFunction,
	ColumnType,
	Condition,
	Criteria,
	MigrationStep,
	Order,
	Row,
	TableSchema,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { SQLiteRow, SQLiteValue } from './types.js'
import { isBoolean, isFiniteNumber, isString } from '@orkestrel/contract'
import { randomUUID } from 'node:crypto'

// The server's key-minting `KeyFunction` implementation — `core` mints no keys
// itself (AGENTS §1: cross-environment code touches no `node:*`), so a server
// consumer wires this in as `DatabaseOptions.key`.
//
// Below it: the SQLite ↔ JS bridge for the driver. Every helper is pure and
// total — it narrows with `typeof` / `instanceof`, never `as` (AGENTS §1, §14):
// a value that does not fit its column's storage type encodes to `null` rather
// than throwing, and `decodeValue` is the exact inverse. `encodeRow` /
// `decodeRow` lift the per-cell codecs across a whole schema; the SQL
// identifier / type helpers (`quote`, `columnSQL`, `fieldColumn`) build the
// static parts of a statement. `schemaToTable` / `schemaToIndexes` are pure
// projections of the CREATE TABLE / CREATE INDEX DDL a SQLite driver's `open`
// issues. This module speaks pure strings/values only — it imports no SQLite
// package.

/**
 * Generate a fresh unique key — a v4 UUID string, backed by `node:crypto`.
 *
 * @remarks
 * Supply this as {@link import('@orkestrel/database').DatabaseOptions.key} so a table mints
 * a key when a written row lacks its primary-key value. Strings work as keys on
 * every backend; supply your own key values directly to use numeric keys instead.
 *
 * @returns A new UUID string
 *
 * @example
 * ```ts
 * const db = createDatabase({ driver, tables, key: generateKey })
 * ```
 */
export function generateKey(): string {
	return randomUUID()
}

// === Exactness (native ↔ engine parity gating)
//
// SQLiteDriver's `records` / `count` / `aggregate` / `stream` compile a
// `Criteria` straight to SQL with NO engine re-filter — a huge perf win, but
// only sound for a condition/order whose compiled SQL provably matches the
// core engine's `matchesCondition` / `sortRows` semantics for every value a
// contract-validated write can store ("declared-type trust"). These guards
// decide, per condition/order/criteria, whether that proof holds; when it does
// not, the driver falls back to a full scan refined through the same core
// engine every scan-only driver (`MemoryDriver`, `JSONDriver`) already uses —
// exact → native, otherwise → refine, never a silent semantics drift.

/**
 * The declared {@link ColumnType}s whose SQL EQUALITY comparisons (`equals` /
 * `not` / `any` / `none`) and `starts` / `ends` compiles are provably
 * engine-exact under declared-type trust — `text` / `integer` / `real` /
 * `boolean`; a `json` or `blob` column always refines instead.
 *
 * @remarks
 * This set governs equality and prefix/suffix matching only. RANGE
 * comparisons (`above` / `below` / `from` / `to` / `between`) and `ORDER BY`
 * are exact for `integer` / `real` / `boolean` but NOT for `text`: compiled
 * SQL orders/ranges under SQLite's default BINARY collation, which compares
 * TEXT byte-for-byte as UTF-8 — equivalent to Unicode CODE-POINT order —
 * while the core engine's `compareValues` orders JS strings with `<`, which
 * compares UTF-16 CODE-UNIT order. The two orders diverge for supplementary-
 * plane characters (code points ≥ U+10000, e.g. many emoji): a lead surrogate
 * (`\uD800`–`\uDBFF`) sorts BELOW ``–`￿` in code-unit order, while
 * its code point sorts ABOVE them. So `isExactCondition`'s range family and
 * `isExactOrder` exclude `text`, refining through the core engine instead. A
 * future opt-in "trusted collation" mode (the caller vouches the column's
 * values are BMP-only, or a custom SQLite collation matching `compareValues`
 * is registered) could restore native text ranges/ordering.
 */
export const EXACT_COLUMN_TYPES: readonly ColumnType[] = ['text', 'integer', 'real', 'boolean']

/**
 * The declared {@link ColumnType}s whose SQL RANGE comparisons
 * (`above` / `below` / `from` / `to` / `between`) and `ORDER BY` compiles are
 * provably engine-exact — `integer` / `real` / `boolean` only. `text` is
 * excluded: see {@link EXACT_COLUMN_TYPES}'s remarks for the BINARY-collation
 * (code-point) vs. JS `<` (code-unit) divergence on supplementary-plane
 * characters.
 */
export const EXACT_RANGE_COLUMN_TYPES: readonly ColumnType[] = ['integer', 'real', 'boolean']

/**
 * Whether a value's runtime type matches a column's declared exact type —
 * the operand side of the declared-type-trust proof.
 *
 * @remarks
 * `text` ↔ string, `integer` / `real` ↔ FINITE number (`NaN` / `±Infinity`
 * fail), `boolean` ↔ boolean. Backs {@link isExactCondition}'s operand checks.
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
export function matchesDeclaredType(value: unknown, type: ColumnType): boolean {
	if (type === 'text') return isString(value)
	if (type === 'boolean') return isBoolean(value)
	return isFiniteNumber(value)
}

/**
 * Whether one {@link Condition} compiles to SQL that is PROVABLY identical to
 * the core engine's `matchesCondition` for every value its column's declared
 * type can store.
 *
 * @remarks
 * `false` for a nested `FieldPath` (an array), a column absent from `schema`,
 * or a column whose declared type is not `text` / `integer` / `real` /
 * `boolean` (a `json` / `blob` column) — EXCEPT `absent` / `present`, which
 * compile to `IS NULL` / `IS NOT NULL` and match `decodeRow`'s "a stored NULL
 * decodes to `undefined`" rule for every column type, so they are exact
 * regardless of declared type. `equals` / `not` require a operand matching the
 * column's declared type (a `null` / `undefined` operand is never exact here —
 * `encodeRow` stores both an explicit `null` and an absent field as SQL NULL,
 * so native `IS NULL` semantics cannot match the engine's `deepEqual`-over-
 * decoded-rows truth). `above` / `below` / `from` / `to` / `between` are exact
 * ONLY for a declared type in {@link EXACT_RANGE_COLUMN_TYPES} (`integer` /
 * `real` / `boolean`) — a `text` column's range conditions REFINE, because
 * SQLite's default BINARY collation orders TEXT by Unicode CODE POINT while
 * the core engine's `compareValues` orders JS strings by UTF-16 CODE UNIT,
 * and the two diverge for supplementary-plane characters (see
 * {@link EXACT_COLUMN_TYPES}'s remarks for the full rationale).
 * `any` / `none` require a NON-EMPTY list where every element matches (an empty
 * list is exact under neither: the engine's `any([])` matches nothing while
 * `none([])` matches everything, and SQL `IN ()` is a syntax error) — these
 * stay exact on `text` (byte equality is collation-independent and engine-
 * identical). `starts` / `ends` are exact only on a `text` column with a
 * string operand (case-sensitive `substr` compile, see {@link fragment}) —
 * likewise collation-independent. `like` / `glob` are NEVER exact — SQLite
 * `LIKE` folds case ASCII-only against the engine's Unicode fold, and `GLOB`
 * has character classes the engine treats literally.
 *
 * @param condition - The condition to test
 * @param schema - The table's schema
 * @returns Whether `condition` is exact
 */
export function isExactCondition(condition: Condition, schema: TableSchema): boolean {
	if (!isString(condition.column)) return false
	const column = schema.columns.find((candidate) => candidate.name === condition.column)
	if (column === undefined) return false
	if (condition.operator === 'absent' || condition.operator === 'present') return true
	if (!EXACT_COLUMN_TYPES.some((type) => type === column.type)) return false
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'equals':
		case 'not':
			return matchesDeclaredType(first, column.type)
		case 'above':
		case 'below':
		case 'from':
		case 'to':
			return (
				EXACT_RANGE_COLUMN_TYPES.some((type) => type === column.type) &&
				matchesDeclaredType(first, column.type)
			)
		case 'between':
			return (
				EXACT_RANGE_COLUMN_TYPES.some((type) => type === column.type) &&
				matchesDeclaredType(first, column.type) &&
				matchesDeclaredType(second, column.type)
			)
		case 'any':
		case 'none':
			return (
				condition.values.length > 0 &&
				condition.values.every((value) => matchesDeclaredType(value, column.type))
			)
		case 'starts':
		case 'ends':
			return column.type === 'text' && isString(first)
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
 * declared type outside {@link EXACT_RANGE_COLUMN_TYPES} (`integer` / `real` /
 * `boolean`). `text` is NOT exact here: SQLite's default BINARY collation
 * orders TEXT by Unicode code point while the core engine's `compareValues`
 * orders JS strings by UTF-16 code unit, and the two diverge for
 * supplementary-plane characters (see {@link EXACT_COLUMN_TYPES}'s remarks) —
 * a `text` order term REFINES through the core engine instead.
 *
 * @param order - The order term to test
 * @param schema - The table's schema
 * @returns Whether `order` is exact
 */
export function isExactOrder(order: Order, schema: TableSchema): boolean {
	if (!isString(order.column)) return false
	const column = schema.columns.find((candidate) => candidate.name === order.column)
	if (column === undefined) return false
	return EXACT_RANGE_COLUMN_TYPES.some((type) => type === column.type)
}

/**
 * Whether a whole {@link Criteria} is exact — every condition and every order
 * term is exact. `limit` / `offset` never affect exactness (SQL `LIMIT` /
 * `OFFSET` are always engine-identical).
 *
 * @param criteria - The criteria to test
 * @param schema - The table's schema
 * @returns Whether every part of `criteria` is exact
 */
export function isExactCriteria(criteria: Criteria, schema: TableSchema): boolean {
	const conditions = criteria.conditions ?? []
	const order = criteria.order ?? []
	return (
		conditions.every((condition) => isExactCondition(condition, schema)) &&
		order.every((term) => isExactOrder(term, schema))
	)
}

// === SQL identifiers & types

/**
 * Map a portable {@link ColumnType} to its SQLite column type.
 *
 * @remarks
 * `text` / `json` → `TEXT` (JSON is stored as text and read back with
 * `json_extract` for nested-field queries); `integer` / `boolean` → `INTEGER`
 * (a boolean stores `1` / `0`); `real` → `REAL`; `blob` → `BLOB`. No `NOT NULL`
 * is ever emitted — the contract validates required-ness; the database is just
 * storage (AGENTS §14, the typed layer above imposes the shape).
 *
 * @param type - The portable column type
 * @returns The SQLite column type keyword
 *
 * @example
 * ```ts
 * columnSQL('integer') // 'INTEGER'
 * columnSQL('json') // 'TEXT'
 * ```
 */
export function columnSQL(type: ColumnType): string {
	switch (type) {
		case 'text':
		case 'json':
			return 'TEXT'
		case 'integer':
		case 'boolean':
			return 'INTEGER'
		case 'real':
			return 'REAL'
		case 'blob':
			return 'BLOB'
	}
}

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
 * quote('order') // '"order"'
 * ```
 */
export function quote(identifier: string): string {
	return '"' + identifier.replaceAll('"', '""') + '"'
}

/**
 * Compile a {@link FieldPath} to the SQL expression that reads it.
 *
 * @remarks
 * A single string is ONE column — `quote(path)`. An array descends a JSON column:
 * the first element is the (quoted) column, the rest a `json_extract` path
 * (`json_extract("payload", '$.user.id')`), matching the guide's nested-field
 * examples (simple identifier keys). The string's value is never split on `.`
 * (AGENTS — `FieldPath` semantics): a dotted string is one column literally.
 *
 * @param path - The field path (a column, or a column + nested keys)
 * @returns The SQL expression selecting the value
 *
 * @example
 * ```ts
 * fieldColumn('payload') // '"payload"'
 * fieldColumn(['payload', 'user', 'id']) // 'json_extract("payload", \'$.user.id\')'
 * ```
 */
export function fieldColumn(path: FieldPath): string {
	if (isString(path)) return quote(path)
	const rest = path
		.slice(1)
		.map((key) => '.' + key.replaceAll("'", "''"))
		.join('')
	return 'json_extract(' + quote(path[0]) + ", '$" + rest + "')"
}

/**
 * Compile an {@link AggregateFunction} over a {@link FieldPath} to its SQL
 * aggregate expression — the SELECT body the SQLite driver's native `aggregate`
 * runs.
 *
 * @remarks
 * `count` → `COUNT(*)` (counting all matched ROWS, not non-null column values —
 * mirroring the engine's `computeAggregate('count')`, which is `rows.length`); the
 * numeric aggregates wrap the column's read expression (a flat column, or a nested
 * `json_extract` path) in `SUM` / `AVG` / `MIN` / `MAX`. Over zero matched rows
 * `COUNT(*)` is `0` and the numeric aggregates are SQL `NULL` (→ `undefined`),
 * matching the engine.
 *
 * @param operation - The aggregate to compute
 * @param column - The column (or nested path) to aggregate
 * @returns The SQL aggregate expression
 *
 * @example
 * ```ts
 * aggregateSQL('count', 'age') // 'COUNT(*)'
 * aggregateSQL('sum', 'age') // 'SUM("age")'
 * aggregateSQL('average', ['payload', 'score']) // 'AVG(json_extract("payload", \'$.score\'))'
 * ```
 */
export function aggregateSQL(operation: AggregateFunction, column: FieldPath): string {
	switch (operation) {
		case 'count':
			return 'COUNT(*)'
		case 'sum':
			return 'SUM(' + fieldColumn(column) + ')'
		case 'average':
			return 'AVG(' + fieldColumn(column) + ')'
		case 'minimum':
			return 'MIN(' + fieldColumn(column) + ')'
		case 'maximum':
			return 'MAX(' + fieldColumn(column) + ')'
	}
}

// === Value codecs

/**
 * Encode a JS value to its stored {@link SQLiteValue} for a column's type.
 *
 * @remarks
 * The forward half of the bridge, total (AGENTS §14): a value that does not fit
 * its column's storage type encodes to `null` rather than throwing. A `boolean`
 * column stores `1` / `0` (and `null` / `undefined` → `null`); a `json` column
 * stores `JSON.stringify` (or `null` for `null` / `undefined`); `integer` /
 * `real` keep a `number` / `bigint`, else `null`; `text` keeps a `string`, else
 * `null`; `blob` keeps a `Uint8Array`, else `null`. Narrowed with `typeof` /
 * `instanceof`, never `as`.
 *
 * @param value - The JS value to store
 * @param type - The column's portable storage type
 * @returns The value SQLite stores
 *
 * @example
 * ```ts
 * encodeValue(true, 'boolean') // 1
 * encodeValue({ a: 1 }, 'json') // '{"a":1}'
 * ```
 */
export function encodeValue(value: unknown, type: ColumnType): SQLiteValue {
	switch (type) {
		case 'boolean':
			return value === undefined || value === null ? null : value === true ? 1 : 0
		case 'json':
			return value === undefined || value === null ? null : JSON.stringify(value)
		case 'integer':
		case 'real':
			return typeof value === 'number' || typeof value === 'bigint' ? value : null
		case 'text':
			return typeof value === 'string' ? value : null
		case 'blob':
			return value instanceof Uint8Array ? value : null
	}
}

/**
 * Decode a stored {@link SQLiteValue} back to its JS value for a column's type —
 * the exact inverse of {@link encodeValue}.
 *
 * @remarks
 * A `boolean` column reads `1` / `0` back to `true` / `false` (a stored `null`
 * → `undefined`); a `json` column `JSON.parse`s a string (anything else →
 * `undefined`); every other type passes the value through, mapping a stored
 * `NULL` to `undefined`. NULL decodes to `undefined` so {@link decodeRow} can
 * omit absent columns.
 *
 * @param value - The stored SQLite value
 * @param type - The column's portable storage type
 * @returns The decoded JS value (`undefined` for a stored `NULL`)
 *
 * @example
 * ```ts
 * decodeValue(1, 'boolean') // true
 * decodeValue('{"a":1}', 'json') // { a: 1 }
 * ```
 */
export function decodeValue(value: SQLiteValue, type: ColumnType): unknown {
	switch (type) {
		case 'boolean':
			return value === null ? undefined : value !== 0
		case 'json':
			return typeof value === 'string' ? JSON.parse(value) : undefined
		default:
			return value === null ? undefined : value
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
		result[column.name] = encodeValue(row[column.name], column.type)
	}
	return result
}

/**
 * Decode a stored {@link SQLiteRow} back to a {@link Row} by its table's schema.
 *
 * @remarks
 * Decodes each declared column with {@link decodeValue} and **omits** any column
 * whose decoded value is `undefined` — so an absent / `NULL` optional column does
 * not surface as `{ bio: undefined }`, matching how the contract's optional
 * columns expect absence. A known, documented edge: a non-optional `nullableShape`
 * column storing `null` round-trips to absent (a `null` cell decodes to
 * `undefined`, and an `undefined` value is omitted).
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
		const decoded = decodeValue(row[column.name], column.type)
		if (decoded !== undefined) result[column.name] = decoded
	}
	return result
}

// === DDL projections

/**
 * Project a {@link TableSchema} to the `CREATE TABLE IF NOT EXISTS` statement a
 * SQLite driver's `open` issues for it.
 *
 * @remarks
 * Each column compiles to `<quoted name> <columnSQL(type)>`; the statement ends
 * with `PRIMARY KEY (<quoted primary>)`. No `NOT NULL` is emitted — the contract
 * validates required-ness, the database is just storage (AGENTS §14).
 *
 * @param schema - The table's schema
 * @returns The `CREATE TABLE IF NOT EXISTS …` statement
 *
 * @example
 * ```ts
 * schemaToTable(schema)
 * // 'CREATE TABLE IF NOT EXISTS "users" ("id" TEXT, "age" INTEGER, PRIMARY KEY ("id"))'
 * ```
 */
export function schemaToTable(schema: TableSchema): string {
	const columns = schema.columns.map((column) => quote(column.name) + ' ' + columnSQL(column.type))
	return (
		'CREATE TABLE IF NOT EXISTS ' +
		quote(schema.name) +
		' (' +
		columns.join(', ') +
		', PRIMARY KEY (' +
		quote(schema.primary) +
		'))'
	)
}

/**
 * Build a collision-free SQL index name for a table + column-group index —
 * shared by {@link schemaToIndexes} (an `open`-time `CREATE INDEX`) and
 * {@link stepToSQL}'s `index.add` / `index.remove` (a migration-time DDL),
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
 * indexName('users', ['name']) // 'idx_5_users_4_name'
 * indexName('a_b', ['c']) // 'idx_3_a_b_1_c'
 * indexName('a', ['b', 'c']) // 'idx_1_a_1_b_1_c'
 * ```
 */
export function indexName(table: string, columns: readonly string[]): string {
	const parts = [table, ...columns].map((part) => String(part.length) + '_' + part)
	return 'idx_' + parts.join('_')
}

/**
 * Project a {@link TableSchema} to the `CREATE INDEX IF NOT EXISTS` statements a
 * SQLite driver's `open` issues for its declared indexes.
 *
 * @remarks
 * One statement per index group; the index name is built by {@link indexName}
 * (collision-free and deterministic), matching the driver's naming so a
 * repeated `open` is idempotent.
 *
 * @param schema - The table's schema
 * @returns One `CREATE INDEX IF NOT EXISTS …` statement per declared index
 *
 * @example
 * ```ts
 * schemaToIndexes(schema)
 * // ['CREATE INDEX IF NOT EXISTS "idx_5_users_4_name" ON "users" ("name")']
 * ```
 */
export function schemaToIndexes(schema: TableSchema): readonly string[] {
	return schema.indexes.map(
		(group) =>
			'CREATE INDEX IF NOT EXISTS ' +
			quote(indexName(schema.name, group)) +
			' ON ' +
			quote(schema.name) +
			' (' +
			group.map(quote).join(', ') +
			')',
	)
}

/**
 * Project one {@link MigrationStep} to the DDL statement(s) a SQLite driver's
 * `migrate` executes for it.
 *
 * @remarks
 * `table.add` emits the `CREATE TABLE` plus one `CREATE INDEX` per declared
 * index (via {@link schemaToTable} / {@link schemaToIndexes}); `table.remove`
 * emits `DROP TABLE IF EXISTS`; `column.add` / `column.remove` emit `ALTER
 * TABLE … ADD COLUMN` / `… DROP COLUMN`; `index.add` / `index.remove` emit
 * `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS`, naming the index the
 * same way `schemaToIndexes` does (`idx_<table>_<columns joined by _>`) so a
 * plan-built index matches one `open` would have created. Whether the named
 * table actually exists is the caller's concern (a driver's `migrate` checks
 * its own declared schema before running these statements) — this projection
 * is pure and never inspects live state.
 *
 * @param step - The migration step to project
 * @returns The DDL statement(s) that apply the step
 *
 * @example
 * ```ts
 * stepToSQL({ operation: 'column.remove', table: 'users', column: 'legacy' })
 * // ['ALTER TABLE "users" DROP COLUMN "legacy"']
 * ```
 */
export function stepToSQL(step: MigrationStep): readonly string[] {
	switch (step.operation) {
		case 'table.add':
			return [schemaToTable(step.table), ...schemaToIndexes(step.table)]
		case 'table.remove':
			return ['DROP TABLE IF EXISTS ' + quote(step.table)]
		case 'column.add':
			return [
				'ALTER TABLE ' +
					quote(step.table) +
					' ADD COLUMN ' +
					quote(step.column.name) +
					' ' +
					columnSQL(step.column.type),
			]
		case 'column.remove':
			return ['ALTER TABLE ' + quote(step.table) + ' DROP COLUMN ' + quote(step.column)]
		case 'index.add':
			return [
				'CREATE INDEX IF NOT EXISTS ' +
					quote(indexName(step.table, step.index)) +
					' ON ' +
					quote(step.table) +
					' (' +
					step.index.map(quote).join(', ') +
					')',
			]
		case 'index.remove':
			return ['DROP INDEX IF EXISTS ' + quote(indexName(step.table, step.index))]
	}
}

/**
 * Project one {@link MigrationStep} onto its table's declared {@link TableSchema}
 * — the bookkeeping counterpart to {@link stepToSQL} (which projects the DDL a
 * driver's `migrate` runs against the live database).
 *
 * @remarks
 * `column.add` / `column.remove` add / filter the named column;
 * `index.add` / `index.remove` add / filter the matching index group (an exact
 * ordered match on `index`). `table.add` / `table.remove` act on a WHOLE
 * schema map rather than one table's shape, so they are the caller's concern
 * (a driver's `migrate` applies them directly against its table map) — passed
 * here, they return `schema` unchanged.
 *
 * @param schema - The table's current declared schema
 * @param step - The migration step to project onto it
 * @returns The table's schema after the step
 *
 * @example
 * ```ts
 * stepToSchema(schema, { operation: 'column.remove', table: 'users', column: 'legacy' })
 * // schema with the 'legacy' column dropped from `columns`
 * ```
 */
export function stepToSchema(schema: TableSchema, step: MigrationStep): TableSchema {
	switch (step.operation) {
		case 'column.add':
			return { ...schema, columns: [...schema.columns, step.column] }
		case 'column.remove':
			return { ...schema, columns: schema.columns.filter((column) => column.name !== step.column) }
		case 'index.add':
			return { ...schema, indexes: [...schema.indexes, step.index] }
		case 'index.remove':
			return {
				...schema,
				indexes: schema.indexes.filter(
					(group) =>
						!(
							group.length === step.index.length &&
							group.every((name, position) => name === step.index[position])
						),
				),
			}
		case 'table.add':
		case 'table.remove':
			return schema
	}
}
