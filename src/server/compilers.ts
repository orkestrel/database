import type { ColumnType, Condition, Criteria, Order, TableSchema } from '@src/core'
import type { CompiledSQL, SQLiteValue } from './types.js'
import { DatabaseError } from '@src/core'
import { isString } from '@orkestrel/contract'
import { encodeValue, fieldColumn, quote } from './helpers.js'

/**
 * Compile a NESTED {@link FieldPath} to the `json_type(<col>, <path>)` SQL
 * expression — the {@link fieldColumn} `json_extract` sibling used to tell a
 * PRESENT JSON `null` apart from an ABSENT path (both read back as SQL `NULL`
 * through `json_extract`, but `json_type` reports `'null'` for the former and
 * SQL `NULL` for the latter).
 *
 * @param path - The nested field path (a column plus its JSON keys)
 * @returns The SQL expression reading the value's JSON type
 *
 * @example
 * ```ts
 * jsonTypeColumn(['payload', 'user', 'id']) // "json_type(\"payload\", '$.user.id')"
 * ```
 */
export function jsonTypeColumn(path: readonly string[]): string {
	const [column, ...nested] = path
	if (column === undefined) {
		throw new DatabaseError('VALIDATION', 'A field path must contain at least one column')
	}
	const rest = nested.map((key) => '.' + key.replaceAll("'", "''")).join('')
	return 'json_type(' + quote(column) + ", '$" + rest + "')"
}

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
 * it binds — engine-exact under SQL's three-valued NULL logic.
 *
 * @remarks
 * Every operand is run through `encodeValue`, so a bound value matches the SQL
 * the column side compiles to. A flat column encodes operands with its DECLARED
 * schema type (a flat `json` column → `JSON.stringify`); a nested `FieldPath`
 * encodes each operand as the NATIVE scalar `json_extract` returns, derived from
 * the operand's runtime type (per-operand, since `between` / `any` / `none` can
 * mix types). `any` / `none` collapse an empty list to a constant (`0` matches
 * nothing, `1` matches all) with no params.
 *
 * The core engine's total order ranks `undefined` (rank 0) BELOW `null`
 * (rank 1) (see `compareValues`), so a MISSING/`NULL` column MATCHES
 * `below` / `to` / a scalar `not` / `none` — the opposite of raw SQL, where a
 * comparison against `NULL` is `NULL` (excluded). This fragment replicates the
 * engine exactly. Truth table (`value` = the engine's decoded field read; a
 * FLAT column's stored `NULL` decodes to `undefined` per `decodeRow`, so a
 * flat `value` is NEVER a present `null` — only a NESTED path can be
 * present-but-`null`):
 *
 * ```text
 * operator            | value=undefined (absent)      | value=null (nested only) | value=scalar
 * --------------------|--------------------------------|---------------------------|-------------
 * equals, first=null  | no match                       | MATCH                     | no match
 * equals, first=X     | no match                       | no match                  | value===X
 * not, first=null     | MATCH (flat: unconditionally;  | no match                  | MATCH
 *                     |   nested: absent still matches)|                           |
 * not, first=X        | MATCH                          | MATCH                     | value!==X
 * below/to, first=X   | MATCH (rank 0 < rank(X))       | MATCH (rank 1 < rank(X))  | rank compare
 * none, list=[…]       | MATCH (no scalar rank-equal)   | MATCH                     | not-in-list
 * any, list=[…]        | no match                       | no match                  | in-list
 * above/from/between  | no match                       | no match                  | rank compare
 * like/glob/starts/…  | no match (not a string)        | no match                  | string test
 * present              | false                          | false                     | true
 * absent                | true                           | true                      | false
 * ```
 *
 * Because a flat column's `NULL` always decodes to `undefined`, `equals`
 * against a `null` operand needs no special flat compilation (`col = ?`
 * binding a `NULL` param is already always-false in SQL, matching "no match"
 * above) — but flat `not` against `null` must match EVERY row (both the
 * absent and the scalar rows), which `col != ? OR col IS NULL` cannot express
 * (it only catches the `IS NULL` row), so a flat `not`-with-`null`-operand
 * compiles to the constant `1`.
 *
 * A NESTED path can be present-but-`null` (a stored JSON `null`), which
 * `json_extract` reads back as SQL `NULL` — indistinguishable from an ABSENT
 * path. `json_type(col, path)` disambiguates them (`'null'` for present-null,
 * SQL `NULL` for absent), so nested `equals` / `not` against a `null` operand
 * compile through `json_type` instead of `IS NULL` / `IS NOT NULL`.
 *
 * Every other MATCH-on-null-or-absent row is expressed uniformly (flat and
 * nested alike) as `(<column> <op> ? OR <column> IS NULL)` — for a nested
 * path, `json_extract` already collapses BOTH absent and present-null to SQL
 * `NULL`, so `IS NULL` catches both in one clause; for a flat column there is
 * only the absent case to catch.
 *
 * @param condition - The condition to compile
 * @param schema - The table's schema (for declared column types)
 * @returns The SQL fragment and its bound parameters
 *
 * @example
 * ```ts
 * fragment({ column: 'age', operator: 'above', values: [18], connector: 'and' }, schema)
 * // { sql: '"age" > ?', params: [18] }
 * fragment({ column: 'age', operator: 'below', values: [18], connector: 'and' }, schema)
 * // { sql: '("age" < ? OR "age" IS NULL)', params: [18] }
 * ```
 */
export function fragment(condition: Condition, schema: TableSchema): CompiledSQL {
	const column = fieldColumn(condition.column)
	const nested = !isString(condition.column)
	const declared = isString(condition.column) ? declaredType(condition.column, schema) : undefined
	const first = condition.values[0]
	const second = condition.values[1]
	const nullOperand = first === null || first === undefined
	// The nested `json_type` read — built only when `condition.column` is an
	// array (a nested path) — disambiguates a present JSON `null` from an
	// absent path under `equals` / `not` (see the truth table above).
	const jsonType = !isString(condition.column) ? jsonTypeColumn(condition.column) : ''
	let sql: string
	let values: readonly unknown[]
	switch (condition.operator) {
		case 'equals':
			if (nullOperand && nested) return { sql: jsonType + " = 'null'", params: [] }
			sql = column + ' = ?'
			values = [first]
			break
		case 'not':
			if (nullOperand) {
				if (nested) {
					return {
						sql: '(' + jsonType + ' IS NULL OR ' + jsonType + " != 'null')",
						params: [],
					}
				}
				// A flat column's decoded value is never a present null, so
				// `compareValues(value, null)` is nonzero for EVERY row (absent or
				// scalar) — the engine's `not null` matches unconditionally.
				return { sql: '1', params: [] }
			}
			sql = '(' + column + ' != ? OR ' + column + ' IS NULL)'
			values = [first]
			break
		case 'above':
			sql = column + ' > ?'
			values = [first]
			break
		case 'below':
			sql = '(' + column + ' < ? OR ' + column + ' IS NULL)'
			values = [first]
			break
		case 'from':
			sql = column + ' >= ?'
			values = [first]
			break
		case 'to':
			sql = '(' + column + ' <= ? OR ' + column + ' IS NULL)'
			values = [first]
			break
		case 'between':
			sql = column + ' BETWEEN ? AND ?'
			values = [first, second]
			break
		case 'like':
			sql = column + ' LIKE ?'
			values = [first]
			break
		case 'glob':
			sql = column + ' GLOB ?'
			values = [first]
			break
		case 'starts': {
			// Case-sensitive, exact compile (replaces the old LIKE-based one, which
			// was ASCII-only case-INsensitive — a mismatch with the engine's
			// case-sensitive `String.startsWith`). `substr` counts CODE POINTS, so
			// the length is a code-point count (`Array.from`), not `.length`. An
			// empty operand matches every text-column value (the engine: every
			// string starts with '').
			const text = isString(first) ? first : ''
			if (text === '') return { sql: 'typeof(' + column + ") = 'text'", params: [] }
			const length = Array.from(text).length
			sql = '(typeof(' + column + ") = 'text' AND substr(" + column + ', 1, ' + length + ') = ?)'
			values = [first]
			break
		}
		case 'ends': {
			// Mirror of `starts`: `substr(<col>, -N)` (SQLite's 2-arg form counts
			// from the right when N is negative) reads the last N code points.
			const text = isString(first) ? first : ''
			if (text === '') return { sql: 'typeof(' + column + ") = 'text'", params: [] }
			const length = Array.from(text).length
			sql = '(typeof(' + column + ") = 'text' AND substr(" + column + ', -' + length + ') = ?)'
			values = [first]
			break
		}
		case 'any':
			if (condition.values.length === 0) return { sql: '0', params: [] }
			sql = column + ' IN (' + condition.values.map(() => '?').join(', ') + ')'
			values = condition.values
			break
		case 'none':
			if (condition.values.length === 0) return { sql: '1', params: [] }
			sql =
				'(' +
				column +
				' NOT IN (' +
				condition.values.map(() => '?').join(', ') +
				') OR ' +
				column +
				' IS NULL)'
			values = condition.values
			break
		case 'absent':
			return { sql: column + ' IS NULL', params: [] }
		case 'present':
			return { sql: column + ' IS NOT NULL', params: [] }
	}
	return {
		sql,
		params: values.map((value) =>
			encodeValue(value, nested ? valueType(value) : (declared ?? 'json')),
		),
	}
}

/**
 * Fold the conditions into one WHERE clause, parenthesizing progressively
 * left-to-right so the grouping matches the engine's `matchesCriteria` fold.
 *
 * @remarks
 * The first condition's connector is ignored, per the {@link Condition} types.
 * Every fragment (see {@link fragment}'s truth table) replicates the core
 * engine's total order EXACTLY under SQL's three-valued NULL logic, so this
 * clause matches `applyCriteria` row-for-row over the same table — a native
 * `records` / `count` read never disagrees with a scan-and-filter fallback.
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
	const [first, ...remaining] = conditions
	if (first === undefined) return { sql: '', params: [] }
	const head = fragment(first, schema)
	let clause = head.sql
	const params: SQLiteValue[] = [...head.params]
	for (const condition of remaining) {
		const next = fragment(condition, schema)
		const operator = condition.connector === 'or' ? 'OR' : 'AND'
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
