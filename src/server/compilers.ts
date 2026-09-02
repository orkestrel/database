import type {
	AggregateOperation,
	ColumnStorage,
	Condition,
	MigrationStep,
	Order,
	QueryInput,
	TableSchema,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { SQLiteValue } from '@orkestrel/sqlite'
import type { CompiledSQL } from './types.js'
import { DatabaseError, findColumn, validatePage } from '@src/core'
import { isString } from '@orkestrel/contract'
import { deriveSQLiteIndexName, encodeValue, quoteIdentifier } from './helpers.js'
import { inferValueStorage } from './inferers.js'

/**
 * Map a portable {@link ColumnStorage} to its SQLite column type.
 *
 * @param storage - The portable column type
 * @returns The SQLite column type keyword
 */
export function compileColumnSQL(storage: ColumnStorage): string {
	switch (storage) {
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
 * Compile a {@link FieldPath} to the SQL expression that reads it.
 *
 * @param path - The field path
 * @returns The SQL expression selecting the value
 */
export function compileFieldSQL(path: FieldPath): string {
	if (isString(path)) return quoteIdentifier(path)
	const [column, ...nested] = path
	if (column === undefined) {
		throw new DatabaseError('VALIDATION', 'A field path must contain at least one column')
	}
	const rest = nested.map((key) => '.' + key.replaceAll("'", "''")).join('')
	return 'json_extract(' + quoteIdentifier(column) + ", '$" + rest + "')"
}

/**
 * Compile an {@link AggregateOperation} over a {@link FieldPath}.
 *
 * @param operation - The aggregate to compute
 * @param column - The column or nested path to aggregate
 * @returns The SQL aggregate expression
 */
export function compileAggregateSQL(operation: AggregateOperation, column: FieldPath): string {
	switch (operation) {
		case 'count':
			return 'COUNT(*)'
		case 'sum':
			return 'SUM(' + compileFieldSQL(column) + ')'
		case 'average':
			return 'AVG(' + compileFieldSQL(column) + ')'
		case 'minimum':
			return 'MIN(' + compileFieldSQL(column) + ')'
		case 'maximum':
			return 'MAX(' + compileFieldSQL(column) + ')'
	}
}

/**
 * Compile a NESTED {@link FieldPath} to the `json_type(<col>, <path>)` SQL
 * expression — the {@link compileFieldSQL} `json_extract` sibling used to tell a
 * PRESENT JSON `null` apart from an ABSENT path (both read back as SQL `NULL`
 * through `json_extract`, but `json_type` reports `'null'` for the former and
 * SQL `NULL` for the latter).
 *
 * @param path - The nested field path (a column plus its JSON keys)
 * @returns The SQL expression reading the value's JSON type
 *
 * @example
 * ```ts
 * compileJSONTypeSQL(['payload', 'user', 'id']) // "json_type(\"payload\", '$.user.id')"
 * ```
 */
export function compileJSONTypeSQL(path: readonly string[]): string {
	const [column, ...nested] = path
	if (column === undefined) {
		throw new DatabaseError('VALIDATION', 'A field path must contain at least one column')
	}
	const rest = nested.map((key) => '.' + key.replaceAll("'", "''")).join('')
	return 'json_type(' + quoteIdentifier(column) + ", '$" + rest + "')"
}

// The `QueryInput` → parameterized SQL compiler — the native-query payoff. It turns
// a portable `QueryInput` (the same one the core engine's `applyQuery` folds)
// into the `WHERE` / `ORDER BY` / `LIMIT` tail of a `SELECT`, with bound `?`
// parameters in clause order. Its WHERE fold parenthesizes LEFT-TO-RIGHT to match the
// engine's `matchesQuery` exactly (NOT SQL's AND-over-OR precedence), so a
// native read and an engine read agree on every query (the parity test). Branches
// are centralized and public — no operator logic buried in closures.
// This module speaks pure strings/values only. Its SQLiteValue import is
// type-only and cannot couple the emitted JavaScript to the native package.

/**
 * Compile one condition to its `<column> <operator>` SQL fragment and the parameters
 * it binds — engine-exact under SQL's three-valued NULL logic.
 *
 * @remarks
 * Every operand is run through `encodeValue`, so a bound value matches the SQL
 * the column side compiles to. A flat column encodes operands with its DECLARED
 * schema type (a flat `json` column → `JSON.stringify`); a nested `FieldPath`
 * encodes each operand as the NATIVE scalar `json_extract` returns, derived from
 * the operand's runtime type (per-operand, since `between` / `any` / `none` can
 * mix types). `any` / `none` collapse an empty list to a constant (`0` matches
 * nothing, `1` matches all) with no parameters.
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
 * A flat SQL `NULL` represents absence or explicit null according to its
 * {@link ColumnSchema}; optional-and-nullable columns use a storage-class
 * sentinel to distinguish the two. The native exactness gate therefore
 * refines every optional or nullable scalar comparison through the core engine.
 * This compiler still emits a total SQL fragment for direct consumers.
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
 * compileConditionSQL({ column: 'age', operator: 'above', values: [18], connector: 'and' }, schema)
 * // { sql: '"age" > ?', parameters: [18] }
 * compileConditionSQL({ column: 'age', operator: 'below', values: [18], connector: 'and' }, schema)
 * // { sql: '("age" < ? OR "age" IS NULL)', parameters: [18] }
 * ```
 */
export function compileConditionSQL(condition: Condition, schema: TableSchema): CompiledSQL {
	const column = compileFieldSQL(condition.column)
	const nested = !isString(condition.column)
	const declared = isString(condition.column) ? findColumn(condition.column, schema) : undefined
	const first = condition.values[0]
	const second = condition.values[1]
	const nullOperand = first === null || first === undefined
	// The nested `json_type` read — built only when `condition.column` is an
	// array (a nested path) — disambiguates a present JSON `null` from an
	// absent path under `equals` / `not` (see the truth table above).
	const jsonType = !isString(condition.column) ? compileJSONTypeSQL(condition.column) : ''
	let sql: string
	let values: readonly unknown[]
	switch (condition.operator) {
		case 'equals':
			if (nullOperand && nested) {
				return { sql: jsonType + " = 'null'", parameters: [] }
			}
			sql = column + ' = ?'
			values = [first]
			break
		case 'not':
			if (nullOperand) {
				if (nested) {
					return {
						sql: '(' + jsonType + ' IS NULL OR ' + jsonType + " != 'null')",
						parameters: [],
					}
				}
				// A flat column's decoded value is never a present null, so
				// `compareValues(value, null)` is nonzero for EVERY row (absent or
				// scalar) — the engine's `not null` matches unconditionally.
				return { sql: '1', parameters: [] }
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
			if (text === '') {
				return { sql: 'typeof(' + column + ") = 'text'", parameters: [] }
			}
			const length = Array.from(text).length
			sql = '(typeof(' + column + ") = 'text' AND substr(" + column + ', 1, ' + length + ') = ?)'
			values = [first]
			break
		}
		case 'ends': {
			// Mirror of `starts`: `substr(<col>, -N)` (SQLite's 2-arg form counts
			// from the right when N is negative) reads the last N code points.
			const text = isString(first) ? first : ''
			if (text === '') {
				return { sql: 'typeof(' + column + ") = 'text'", parameters: [] }
			}
			const length = Array.from(text).length
			sql = '(typeof(' + column + ") = 'text' AND substr(" + column + ', -' + length + ') = ?)'
			values = [first]
			break
		}
		case 'any':
			if (condition.values.length === 0) return { sql: '0', parameters: [] }
			sql = column + ' IN (' + condition.values.map(() => '?').join(', ') + ')'
			values = condition.values
			break
		case 'none':
			if (condition.values.length === 0) return { sql: '1', parameters: [] }
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
			return { sql: column + ' IS NULL', parameters: [] }
		case 'present':
			return { sql: column + ' IS NOT NULL', parameters: [] }
	}
	return {
		sql,
		parameters: values.map((value) => {
			const storage = nested ? inferValueStorage(value) : (declared?.storage ?? 'json')
			return encodeValue(value, declared ?? { name: '', storage, optional: false, nullable: false })
		}),
	}
}

/**
 * Folds the conditions into one WHERE clause, parenthesizing progressively
 * left-to-right so the grouping matches the engine's `matchesQuery` fold.
 *
 * @remarks
 * The first condition's connector is ignored, per the {@link Condition} types.
 * Every fragment (see {@link compileConditionSQL}'s truth table) replicates the core
 * engine's total order EXACTLY under SQL's three-valued NULL logic, so this
 * clause matches `applyQuery` row-for-row over the same table — a native
 * `records` / `count` read never disagrees with a scan-and-filter fallback.
 *
 * @param conditions - The conditions to fold
 * @param schema - The table's schema
 * @returns The `WHERE …` clause and its bound parameters, or an empty clause for zero conditions
 *
 * @example
 * ```ts
 * compileWhereSQL([{ column: 'age', operator: 'from', values: [18], connector: 'and' }], schema)
 * // { sql: 'WHERE "age" >= ?', parameters: [18] }
 * ```
 */
export function compileWhereSQL(
	conditions: readonly Condition[],
	schema: TableSchema,
): CompiledSQL {
	const [first, ...remaining] = conditions
	if (first === undefined) return { sql: '', parameters: [] }
	const head = compileConditionSQL(first, schema)
	let clause = head.sql
	const parameters: SQLiteValue[] = [...head.parameters]
	for (const condition of remaining) {
		const next = compileConditionSQL(condition, schema)
		const operator = condition.connector === 'or' ? 'OR' : 'AND'
		clause = '(' + clause + ' ' + operator + ' ' + next.sql + ')'
		parameters.push(...next.parameters)
	}
	return { sql: 'WHERE ' + clause, parameters }
}

/**
 * Compiles the ORDER BY clause from the order terms, always ending with the
 * primary key as the final determinant.
 *
 * @remarks
 * The native `records` read then resolves ties in key order, matching a
 * primary-key-ordered `scan` and the core engine's stable `sortRows` over a
 * key-ordered scan (and IndexedDB's key-ordered reads), so a native read equals
 * the scan path — native ↔ engine parity. SQLite without an
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
 * compileOrderSQL([{ column: 'age', direction: 'descending' }], schema)
 * // 'ORDER BY "age" DESC, "id"'
 * ```
 */
export function compileOrderSQL(order: readonly Order[] | undefined, schema: TableSchema): string {
	const terms = (order ?? []).map(
		(term) => compileFieldSQL(term.column) + (term.direction === 'descending' ? ' DESC' : ' ASC'),
	)
	const ordersByPrimary = (order ?? []).some(
		(term) => isString(term.column) && term.column === schema.primary,
	)
	if (!ordersByPrimary) terms.push(quoteIdentifier(schema.primary))
	return terms.length === 0 ? '' : 'ORDER BY ' + terms.join(', ')
}

/**
 * Compiles the LIMIT / OFFSET clause.
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
 * compilePageSQL(undefined, 5) // { sql: 'LIMIT -1 OFFSET ?', parameters: [5] }
 * ```
 */
export function compilePageSQL(limit: number | undefined, offset: number | undefined): CompiledSQL {
	validatePage({
		...(limit === undefined ? {} : { limit }),
		...(offset === undefined ? {} : { offset }),
	})
	if (limit !== undefined && offset !== undefined) {
		return { sql: 'LIMIT ? OFFSET ?', parameters: [limit, offset] }
	}
	if (limit !== undefined) return { sql: 'LIMIT ?', parameters: [limit] }
	if (offset !== undefined) return { sql: 'LIMIT -1 OFFSET ?', parameters: [offset] }
	return { sql: '', parameters: [] }
}

/**
 * Compile a {@link QueryInput} into the SQL clause that follows a table name, with
 * its bound parameters in clause order.
 *
 * @remarks
 * The driver's native `records` / `count` path: it assembles
 * `[where, orderBy, limitOffset]` (each possibly empty) into one clause so a
 * `SELECT * FROM <table> <clause>` runs the whole read in the engine instead of
 * over a JS `scan`. The WHERE fold is parenthesized **left-to-right** to mirror
 * the core engine's `matchesQuery` (not SQL's native AND-over-OR precedence),
 * so a native and an engine read return identical rows. Each operand is encoded
 * via `encodeValue`: a flat column uses its declared schema type, while a nested
 * `FieldPath` (a `json_extract` read) encodes each operand as the native scalar
 * the extract returns — derived from the operand's runtime type — so it compares.
 * Every operator maps per the databases guide's operator table, with
 * `starts` / `ends` compiling to a CODE-POINT `substr` slice guarded by
 * `typeof(<column>) = 'text'` (case-sensitive, matching the engine's
 * `String.prototype.startsWith` / `endsWith`) and an empty `any` / `none` list
 * collapsing to a constant. An `undefined` input (or one with no parts)
 * compiles to an empty clause.
 *
 * @param input - The read specification, or `undefined` for all rows
 * @param schema - The table's schema (column types for operand encoding)
 * @returns The SQL tail and its bound parameters
 *
 * @example
 * ```ts
 * compileQuerySQL({ conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] }, schema)
 * // { sql: 'WHERE "age" >= ? ORDER BY "id"', parameters: [18] }
 * ```
 */
export function compileQuerySQL(input: QueryInput | undefined, schema: TableSchema): CompiledSQL {
	validatePage(input)
	const where = compileWhereSQL(input?.conditions ?? [], schema)
	const orderBy = compileOrderSQL(input?.order, schema)
	const page = compilePageSQL(input?.limit, input?.offset)
	const sql = [where.sql, orderBy, page.sql].filter((part) => part !== '').join(' ')
	return {
		sql,
		parameters: [...where.parameters, ...page.parameters],
	}
}

/**
 * Project a {@link TableSchema} to its `CREATE TABLE IF NOT EXISTS` statement.
 *
 * @param schema - The table schema
 * @returns The complete table declaration
 */
export function schemaToTable(schema: TableSchema): string {
	const columns = schema.columns.map(
		(column) =>
			quoteIdentifier(column.name) +
			' ' +
			compileColumnSQL(column.storage) +
			(column.optional || column.nullable ? '' : ' NOT NULL'),
	)
	return (
		'CREATE TABLE IF NOT EXISTS ' +
		quoteIdentifier(schema.name) +
		' (' +
		columns.join(', ') +
		', PRIMARY KEY (' +
		quoteIdentifier(schema.primary) +
		'))'
	)
}

/**
 * Project a {@link TableSchema} to its declared SQLite indexes.
 *
 * @param schema - The table schema
 * @returns One statement per declared index
 */
export function schemaToIndexes(schema: TableSchema): readonly string[] {
	return schema.indexes.map(
		(group) =>
			'CREATE INDEX IF NOT EXISTS ' +
			quoteIdentifier(deriveSQLiteIndexName(schema.name, group)) +
			' ON ' +
			quoteIdentifier(schema.name) +
			' (' +
			group.map(quoteIdentifier).join(', ') +
			')',
	)
}

/**
 * Project one {@link MigrationStep} to SQLite DDL.
 *
 * @param step - The migration step
 * @returns The statements that apply the step
 */
export function stepToSQL(step: MigrationStep): readonly string[] {
	switch (step.operation) {
		case 'table.add':
			return [schemaToTable(step.table), ...schemaToIndexes(step.table)]
		case 'table.remove':
			return ['DROP TABLE IF EXISTS ' + quoteIdentifier(step.table)]
		case 'column.add':
			return [
				'ALTER TABLE ' +
					quoteIdentifier(step.table) +
					' ADD COLUMN ' +
					quoteIdentifier(step.column.name) +
					' ' +
					compileColumnSQL(step.column.storage) +
					(step.column.optional || step.column.nullable ? '' : ' NOT NULL'),
			]
		case 'column.remove':
			return [
				'ALTER TABLE ' +
					quoteIdentifier(step.table) +
					' DROP COLUMN ' +
					quoteIdentifier(step.column),
			]
		case 'index.add':
			return [
				'CREATE INDEX IF NOT EXISTS ' +
					quoteIdentifier(deriveSQLiteIndexName(step.table, step.index)) +
					' ON ' +
					quoteIdentifier(step.table) +
					' (' +
					step.index.map(quoteIdentifier).join(', ') +
					')',
			]
		case 'index.remove':
			return [
				'DROP INDEX IF EXISTS ' + quoteIdentifier(deriveSQLiteIndexName(step.table, step.index)),
			]
	}
}
