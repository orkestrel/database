import type {
	AggregateFunction,
	ColumnSchema,
	ColumnType,
	MigrationStep,
	Row,
	TableSchema,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { SQLiteRow, SQLiteValue } from './types.js'
import { isArray, isBoolean, isRecord, isString } from '@orkestrel/contract'
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
 * Supply this as {@link import('@src/core').DatabaseOptions.key} so a table mints
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
 * Project a {@link TableSchema} to the `CREATE INDEX IF NOT EXISTS` statements a
 * SQLite driver's `open` issues for its declared indexes.
 *
 * @remarks
 * One statement per index group; the index name is `idx_<table>_<columns joined
 * by _>`, matching the driver's naming so a repeated `open` is idempotent.
 *
 * @param schema - The table's schema
 * @returns One `CREATE INDEX IF NOT EXISTS …` statement per declared index
 *
 * @example
 * ```ts
 * schemaToIndexes(schema)
 * // ['CREATE INDEX IF NOT EXISTS "idx_users_name" ON "users" ("name")']
 * ```
 */
export function schemaToIndexes(schema: TableSchema): readonly string[] {
	return schema.indexes.map(
		(group) =>
			'CREATE INDEX IF NOT EXISTS ' +
			quote('idx_' + schema.name + '_' + group.join('_')) +
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
					quote('idx_' + step.table + '_' + step.index.join('_')) +
					' ON ' +
					quote(step.table) +
					' (' +
					step.index.map(quote).join(', ') +
					')',
			]
		case 'index.remove':
			return ['DROP INDEX IF EXISTS ' + quote('idx_' + step.table + '_' + step.index.join('_'))]
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

/**
 * Whether a value is a well-formed {@link TableSchema} — the boundary guard a
 * SQLite driver's `meta()` narrows a stored, `JSON.parse`d schema through
 * before trusting it (AGENTS §14: never `as`).
 *
 * @remarks
 * Total and total-recursive over the shape: `name` / `primary` strings, each
 * `columns` entry a well-formed {@link ColumnSchema} (a `name` string, a
 * {@link ColumnType} literal, a `nullable` boolean), and each `indexes` entry
 * an array of strings. Anything off-shape (including a non-record) returns
 * `false` rather than throwing.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed `TableSchema`
 *
 * @example
 * ```ts
 * isTableSchema({ name: 'users', primary: 'id', columns: [], indexes: [] }) // true
 * isTableSchema({ name: 'users' }) // false
 * ```
 */
export function isTableSchema(value: unknown): value is TableSchema {
	const COLUMN_TYPES: readonly ColumnType[] = ['text', 'integer', 'real', 'boolean', 'json', 'blob']
	const isColumnType = (candidate: unknown): candidate is ColumnType =>
		isString(candidate) && COLUMN_TYPES.some((type) => type === candidate)
	const isColumnSchema = (candidate: unknown): candidate is ColumnSchema =>
		isRecord(candidate) &&
		isString(candidate.name) &&
		isColumnType(candidate.type) &&
		isBoolean(candidate.nullable)
	const isIndexGroup = (candidate: unknown): candidate is readonly string[] =>
		isArray(candidate) && candidate.every(isString)
	return (
		isRecord(value) &&
		isString(value.name) &&
		isString(value.primary) &&
		isArray(value.columns) &&
		value.columns.every(isColumnSchema) &&
		isArray(value.indexes) &&
		value.indexes.every(isIndexGroup)
	)
}
