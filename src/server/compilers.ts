import type { ColumnType, Condition, Criteria, Order, TableSchema } from '@src/core'
import type { CompiledSQL, SQLiteValue } from './types.js'
import { isString } from '@orkestrel/contract'
import { encodeValue, fieldColumn, quote } from './helpers.js'

// The `Criteria` → parameterized SQL compiler — the native-query payoff. It turns
// a portable `Criteria` (the same one the core engine's `applyCriteria` folds)
// into the `WHERE` / `ORDER BY` / `LIMIT` tail of a `SELECT`, with bound `?`
// params in clause order. Its WHERE fold parenthesizes LEFT-TO-RIGHT to match the
// engine's `matchesCriteria` exactly (NOT SQL's AND-over-OR precedence), so a
// native read and an engine read agree on every query (the parity test). Branches
// are centralized and public per AGENTS §5 — no operator logic buried in closures.
// This module speaks pure strings/values only — it imports no SQLite package.

/**
 * Escape `\`, `%`, and `_` (each with a leading `\`) so a `starts` / `ends`
 * operand is matched literally under the `LIKE … ESCAPE '\'` clause.
 *
 * @param text - The raw operand text
 * @returns The text with LIKE metacharacters escaped
 *
 * @example
 * ```ts
 * escapeLike('50%_off') // '50\\%\\_off'
 * ```
 */
export function escapeLike(text: string): string {
	return text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/**
 * The declared storage type of a flat (string) column, read from the schema.
 *
 * @param column - The column name
 * @param schema - The table's schema
 * @returns The column's {@link ColumnType}, or `undefined` if the schema does not carry it
 *
 * @example
 * ```ts
 * declaredType('age', schema) // 'integer'
 * ```
 */
export function declaredType(column: string, schema: TableSchema): ColumnType | undefined {
	return schema.columns.find((candidate) => candidate.name === column)?.type
}

/**
 * The storage type a nested (`json_extract`) operand encodes as, derived from its
 * RUNTIME value — NOT `json`.
 *
 * @remarks
 * `json_extract` returns the unquoted, natively-typed scalar (a JSON boolean as
 * `1` / `0`, a number as-is, a string as-is), so the operand must encode to that
 * same scalar to compare. A boolean → `'boolean'` (→ `1` / `0`); a number →
 * `'integer'` / `'real'`; a bigint → `'integer'`; a string → `'text'`; `null` /
 * `undefined` → `'text'` (encodes to `null`); an object / array → `'json'` (the
 * edge of comparing against a json subtree).
 *
 * @param value - The runtime operand value
 * @returns The {@link ColumnType} to encode it as
 *
 * @example
 * ```ts
 * valueType(true) // 'boolean'
 * valueType(9) // 'integer'
 * ```
 */
export function valueType(value: unknown): ColumnType {
	if (typeof value === 'boolean') return 'boolean'
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real'
	if (typeof value === 'bigint') return 'integer'
	if (typeof value === 'object' && value !== null) return 'json'
	return 'text'
}

/**
 * Compile one condition to its `<column> <operator>` SQL fragment and the params
 * it binds.
 *
 * @remarks
 * Every operand is run through `encodeValue`, so a bound value matches the SQL
 * the column side compiles to. A flat column encodes operands with its DECLARED
 * schema type (a flat `json` column → `JSON.stringify`); a nested `FieldPath`
 * encodes each operand as the NATIVE scalar `json_extract` returns, derived from
 * the operand's runtime type (per-operand, since `between` / `any` / `none` can
 * mix types). `any` / `none` collapse an empty list to a constant (`0` matches
 * nothing, `1` matches all) with no params. A nested field with a null/undefined
 * operand under `equals` / `not` compiles to `IS NULL` / `IS NOT NULL` (no bound
 * param) instead of `= ?` / `!= ?`, matching the engine's treatment of a
 * present-but-null nested value.
 *
 * @param condition - The condition to compile
 * @param schema - The table's schema (for declared column types)
 * @returns The SQL fragment and its bound parameters
 *
 * @example
 * ```ts
 * fragment({ column: 'age', operator: 'above', values: [18], connector: 'and' }, schema)
 * // { sql: '"age" > ?', params: [18] }
 * ```
 */
export function fragment(condition: Condition, schema: TableSchema): CompiledSQL {
	const column = fieldColumn(condition.column)
	const nested = !isString(condition.column)
	const declared = isString(condition.column) ? declaredType(condition.column, schema) : undefined
	const encode = (value: unknown): SQLiteValue =>
		encodeValue(value, nested ? valueType(value) : (declared ?? 'json'))
	const first = condition.values[0]
	const second = condition.values[1]
	// A nested (`json_extract`) field with a null/undefined operand under
	// `equals` / `not`: `json_extract` collapses a stored JSON `null` to SQL
	// `NULL`, and `<col> = ?` / `!= ?` binding `NULL` never matches under SQL's
	// three-valued logic — so compile `IS NULL` / `IS NOT NULL` (no bound param)
	// to match the engine, which treats a present-but-null nested value as equal
	// to `null`. This is NESTED-ONLY: a flat null column is left as `= ?` / `!= ?`
	// (a null flat column decodes to absent, so the engine and `= NULL` already
	// agree on matching nothing).
	const nullOperand = nested && (first === null || first === undefined)
	switch (condition.operator) {
		case 'equals':
			if (nullOperand) return { sql: column + ' IS NULL', params: [] }
			return { sql: column + ' = ?', params: [encode(first)] }
		case 'not':
			if (nullOperand) return { sql: column + ' IS NOT NULL', params: [] }
			return { sql: column + ' != ?', params: [encode(first)] }
		case 'above':
			return { sql: column + ' > ?', params: [encode(first)] }
		case 'below':
			return { sql: column + ' < ?', params: [encode(first)] }
		case 'from':
			return { sql: column + ' >= ?', params: [encode(first)] }
		case 'to':
			return { sql: column + ' <= ?', params: [encode(first)] }
		case 'between':
			return { sql: column + ' BETWEEN ? AND ?', params: [encode(first), encode(second)] }
		case 'like':
			return { sql: column + ' LIKE ?', params: [encode(first)] }
		case 'glob':
			return { sql: column + ' GLOB ?', params: [encode(first)] }
		case 'starts':
			return {
				sql: column + " LIKE ? ESCAPE '\\'",
				params: [(isString(first) ? escapeLike(first) : '') + '%'],
			}
		case 'ends':
			return {
				sql: column + " LIKE ? ESCAPE '\\'",
				params: ['%' + (isString(first) ? escapeLike(first) : '')],
			}
		case 'any':
			if (condition.values.length === 0) return { sql: '0', params: [] }
			return {
				sql: column + ' IN (' + condition.values.map(() => '?').join(', ') + ')',
				params: condition.values.map(encode),
			}
		case 'none':
			if (condition.values.length === 0) return { sql: '1', params: [] }
			return {
				sql: column + ' NOT IN (' + condition.values.map(() => '?').join(', ') + ')',
				params: condition.values.map(encode),
			}
		case 'absent':
			return { sql: column + ' IS NULL', params: [] }
		case 'present':
			return { sql: column + ' IS NOT NULL', params: [] }
	}
}

/**
 * Fold the conditions into one WHERE clause, parenthesizing progressively
 * left-to-right so the grouping matches the engine's `matchesCriteria` fold.
 *
 * @remarks
 * The first condition's connector is ignored, per the {@link Condition} types.
 *
 * @param conditions - The conditions to fold
 * @param schema - The table's schema
 * @returns The `WHERE …` clause and its bound parameters, or an empty clause for zero conditions
 *
 * @example
 * ```ts
 * compileWhere([{ column: 'age', operator: 'from', values: [18], connector: 'and' }], schema)
 * // { sql: 'WHERE "age" >= ?', params: [18] }
 * ```
 */
export function compileWhere(conditions: readonly Condition[], schema: TableSchema): CompiledSQL {
	if (conditions.length === 0) return { sql: '', params: [] }
	const head = fragment(conditions[0], schema)
	let clause = head.sql
	const params: SQLiteValue[] = [...head.params]
	for (let index = 1; index < conditions.length; index += 1) {
		const next = fragment(conditions[index], schema)
		const operator = conditions[index].connector === 'or' ? 'OR' : 'AND'
		clause = '(' + clause + ' ' + operator + ' ' + next.sql + ')'
		params.push(...next.params)
	}
	return { sql: 'WHERE ' + clause, params }
}

/**
 * Compile the ORDER BY clause from the order terms, always ending with the
 * primary key as the final determinant.
 *
 * @remarks
 * The native `records` read then resolves ties in key order, matching a
 * primary-key-ordered `scan` and the core engine's stable `sortRows` over a
 * key-ordered scan (and IndexedDB's key-ordered reads), so a native read equals
 * the scan path (AGENTS §21 / §22 native ↔ engine parity). SQLite without an
 * `ORDER BY` returns rowid (insertion) order, and an explicit order alone breaks
 * ties by rowid too — both diverge from every key-ordered backend. The
 * tie-breaker is ASCENDING regardless of the explicit directions: the engine's
 * stable sort runs over key-ascending input, so equal rows stay in
 * ascending-key order whichever way the explicit terms point. Skipped when the
 * primary is already an explicit order term (no double-append).
 *
 * @param order - The explicit order terms, or `undefined`
 * @param schema - The table's schema (for the primary key)
 * @returns The `ORDER BY …` clause, or an empty string when there is nothing to order by
 *
 * @example
 * ```ts
 * compileOrder([{ column: 'age', direction: 'descending' }], schema)
 * // 'ORDER BY "age" DESC, "id"'
 * ```
 */
export function compileOrder(order: readonly Order[] | undefined, schema: TableSchema): string {
	const terms = (order ?? []).map(
		(term) => fieldColumn(term.column) + (term.direction === 'descending' ? ' DESC' : ' ASC'),
	)
	const ordersByPrimary = (order ?? []).some(
		(term) => isString(term.column) && term.column === schema.primary,
	)
	if (!ordersByPrimary) terms.push(quote(schema.primary))
	return terms.length === 0 ? '' : 'ORDER BY ' + terms.join(', ')
}

/**
 * Compile the LIMIT / OFFSET clause.
 *
 * @remarks
 * An offset without a limit uses `LIMIT -1` (SQLite's "no limit") so OFFSET is
 * still honored.
 *
 * @param limit - The maximum row count, or `undefined`
 * @param offset - The row count to skip, or `undefined`
 * @returns The `LIMIT …` clause and its bound parameters, or an empty clause when neither is set
 *
 * @example
 * ```ts
 * compilePage(undefined, 5) // { sql: 'LIMIT -1 OFFSET ?', params: [5] }
 * ```
 */
export function compilePage(limit: number | undefined, offset: number | undefined): CompiledSQL {
	if (limit !== undefined && offset !== undefined) {
		return { sql: 'LIMIT ? OFFSET ?', params: [limit, offset] }
	}
	if (limit !== undefined) return { sql: 'LIMIT ?', params: [limit] }
	if (offset !== undefined) return { sql: 'LIMIT -1 OFFSET ?', params: [offset] }
	return { sql: '', params: [] }
}

/**
 * Compile a {@link Criteria} into the SQL clause that follows a table name, with
 * its bound parameters in clause order.
 *
 * @remarks
 * The driver's native `records` / `count` path: it assembles
 * `[where, orderBy, limitOffset]` (each possibly empty) into one clause so a
 * `SELECT * FROM <table> <clause>` runs the whole read in the engine instead of
 * over a JS `scan`. The WHERE fold is parenthesized **left-to-right** to mirror
 * the core engine's `matchesCriteria` (not SQL's native AND-over-OR precedence),
 * so a native and an engine read return identical rows. Each operand is encoded
 * via `encodeValue`: a flat column uses its declared schema type, while a nested
 * `FieldPath` (a `json_extract` read) encodes each operand as the native scalar
 * the extract returns — derived from the operand's runtime type — so it compares.
 * The 15 operators map per the databases guide's operator table, with
 * `starts` / `ends` using `LIKE … ESCAPE '\'` and an empty `any` / `none` list
 * collapsing to a constant. A `undefined` criteria (or one with no parts)
 * compiles to an empty clause.
 *
 * @param criteria - The read specification, or `undefined` for all rows
 * @param schema - The table's schema (column types for operand encoding)
 * @returns The SQL tail and its bound parameters
 *
 * @example
 * ```ts
 * compileCriteria({ conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] }, schema)
 * // { sql: 'WHERE "age" >= ? ORDER BY "id"', params: [18] }
 * ```
 */
export function compileCriteria(criteria: Criteria | undefined, schema: TableSchema): CompiledSQL {
	const where = compileWhere(criteria?.conditions ?? [], schema)
	const orderBy = compileOrder(criteria?.order, schema)
	const page = compilePage(criteria?.limit, criteria?.offset)
	const sql = [where.sql, orderBy, page.sql].filter((part) => part !== '').join(' ')
	return { sql, params: [...where.params, ...page.params] }
}
