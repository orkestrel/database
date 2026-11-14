import type {
	AggregateOperation,
	ColumnSchema,
	ColumnStorage,
	Condition,
	MigrationStep,
	Order,
	QueryInput,
	TableSchema,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import type { CompiledSQL } from './types.js'
import { DatabaseError, findColumn, validatePage } from '@src/core'
import { isBoolean, isFiniteNumber, isNumber, isString } from '@orkestrel/contract'
import {
	computeSuccessor,
	deriveSQLiteIndexName,
	encodeValue,
	matchesPrimaryPin,
	quoteIdentifier,
} from './helpers.js'
import { inferSentinelType, inferValueStorage } from './inferers.js'

/**
 * Maps a portable {@link ColumnStorage} to its SQLite column type.
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
 * Compiles the keys of a nested path to a SQL string literal holding its JSON path, each key a
 * quoted label.
 *
 * @remarks
 * A quoted label reads every key as one object member, a `.`, a space, or a `[` included: a
 * backslash and a double quote are escaped with a backslash, and a single quote is doubled for
 * the SQL literal. A key never reads as an array index, so `'0'` names an object member only.
 *
 * @param keys - The keys after the head column
 * @returns The SQL string literal of the JSON path
 *
 * @example
 * ```ts
 * compileJSONPathSQL(['user', 'a.b']) // `'$."user"."a.b"'`
 * ```
 */
export function compileJSONPathSQL(keys: readonly string[]): string {
	const labels = keys.map((key) => '."' + key.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"')
	return "'$" + labels.join('').replaceAll("'", "''") + "'"
}

/**
 * Compiles the arguments a JSON function reads a nested path through: the head column, read
 * only when it holds text, and the path's quoted labels.
 *
 * @remarks
 * A head that is both optional and nullable stores explicit `null` as an empty blob, which the
 * JSON functions refuse as malformed JSON, so a head that holds no text reads as `NULL`, the
 * core's absent path.
 *
 * @param path - The nested field path: a head column, then its keys
 * @returns The two SQL arguments, comma-separated
 * @throws A `VALIDATION` {@link DatabaseError} when the path holds no column
 *
 * @example
 * ```ts
 * compileJSONAccessSQL(['profile', 'score'])
 * // `CASE WHEN typeof("profile") = 'text' THEN "profile" END, '$."score"'`
 * ```
 */
export function compileJSONAccessSQL(path: readonly string[]): string {
	const [column, ...keys] = path
	if (column === undefined) {
		throw new DatabaseError('VALIDATION', 'A field path must contain at least one column')
	}
	const head = quoteIdentifier(column)
	return (
		'CASE WHEN typeof(' + head + ") = 'text' THEN " + head + ' END, ' + compileJSONPathSQL(keys)
	)
}

/**
 * Compiles a {@link FieldPath} to the SQL expression that reads it.
 *
 * @remarks
 * A flat path compiles to the quoted column; a nested path compiles to a `json_extract` through
 * {@link compileJSONAccessSQL}.
 *
 * @param path - The field path
 * @returns The SQL expression selecting the value
 *
 * @example
 * ```ts
 * compileFieldSQL(['profile', 'score'])
 * // `json_extract(CASE WHEN typeof("profile") = 'text' THEN "profile" END, '$."score"')`
 * ```
 */
export function compileFieldSQL(path: FieldPath): string {
	return isString(path) ? quoteIdentifier(path) : 'json_extract(' + compileJSONAccessSQL(path) + ')'
}

/**
 * Compiles an {@link AggregateOperation} over a {@link FieldPath}.
 *
 * @remarks
 * `sum` compiles to `TOTAL`, the engine's floating-point sum, which `SUM` matches below 2^53
 * and which never overflows: an integer `SUM` past 2^53 raises when it is read into a
 * JavaScript number. Over no value but `NULL` it answers `NULL`, as `SUM` does.
 *
 * @param operation - The aggregate to compute
 * @param column - The column or nested path to aggregate
 * @returns The SQL aggregate expression
 *
 * @example
 * ```ts
 * compileAggregateSQL('sum', 'age') // 'CASE WHEN COUNT("age") = 0 THEN NULL ELSE TOTAL("age") END'
 * ```
 */
export function compileAggregateSQL(operation: AggregateOperation, column: FieldPath): string {
	switch (operation) {
		case 'count':
			return 'COUNT(*)'
		case 'sum': {
			const field = compileFieldSQL(column)
			return 'CASE WHEN COUNT(' + field + ') = 0 THEN NULL ELSE TOTAL(' + field + ') END'
		}
		case 'average':
			return 'AVG(' + compileFieldSQL(column) + ')'
		case 'minimum':
			return 'MIN(' + compileFieldSQL(column) + ')'
		case 'maximum':
			return 'MAX(' + compileFieldSQL(column) + ')'
	}
}

/**
 * Compiles a nested {@link FieldPath} to the SQL expression that reads the JSON type at the
 * path, through {@link compileJSONAccessSQL}.
 *
 * @remarks
 * `json_extract` reads both a present JSON `null` and an absent path as SQL `NULL`;
 * `json_type` reads `'null'` for the first and SQL `NULL` for the second.
 *
 * @param path - The nested field path (a column plus its JSON keys)
 * @returns The SQL expression reading the value's JSON type
 *
 * @example
 * ```ts
 * compileJSONTypeSQL(['payload', 'tag'])
 * // `json_type(CASE WHEN typeof("payload") = 'text' THEN "payload" END, '$."tag"')`
 * ```
 */
export function compileJSONTypeSQL(path: readonly string[]): string {
	return 'json_type(' + compileJSONAccessSQL(path) + ')'
}

// The `QueryInput` → parameterized SQL compiler. It turns the native side of a
// `planSQLiteQuery` plan into the `WHERE` / `ORDER BY` / `LIMIT` tail of a `SELECT`, with
// bound `?` parameters in clause order. Its WHERE fold parenthesizes left-to-right to match
// the engine's `matchesQuery` (NOT SQL's AND-over-OR precedence). This module speaks pure
// strings and values without loading the native package.

/**
 * Compiles one condition to its SQL fragment and the parameters it binds, with the core
 * engine's meaning under SQL's three-valued `NULL` logic.
 *
 * @remarks
 * Every operand is run through `encodeValue`: a flat column encodes operands with its
 * declared storage, and a nested `FieldPath` encodes each operand as the native scalar
 * `json_extract` returns. `equals`, `not`, `any`, and `none` on a nested path compile through
 * {@link compileNestedSQL}. The core's total order ranks an absent value and `null` below
 * every value, so `below`, `to`, `not`, and `none` match them; the fragments add the
 * column's null test, chosen from its flags. A column that is both optional and nullable
 * stores explicit `null` as a sentinel — an empty blob for `text` and the text `null`
 * otherwise — so its null test and its value test read `typeof(…)`.
 *
 * - `starts` compiles to the index range `column >= ? AND column < ?`, whose upper bound is
 *   {@link computeSuccessor} of the prefix; `ends` reads `substr`.
 * - `any` and `none` bind the whole list as one JSON parameter,
 *   `column IN (SELECT value FROM json_each(?))`; an empty list is a constant.
 * - `like` and `glob` match text values only; `glob` writes each `[` as `[[]`, because the
 *   core treats a `[` literally.
 * - `pinned` writes the column behind the unary `+`, which keeps the engine off its index:
 *   {@link compileWhereSQL} pins every other condition when one is `any` on the primary
 *   key.
 *
 * @param condition - The condition to compile
 * @param schema - The table's schema (for declared column types and flags)
 * @param pinned - If `true`, writes the column reference behind the unary `+`; if `false`,
 *   writes it bare. Default: `false`
 * @returns The SQL fragment and its bound parameters
 *
 * @example
 * ```ts
 * compileConditionSQL({ column: 'age', operator: 'above', values: [18], connector: 'and' }, schema)
 * // { sql: '"age" > ?', parameters: [18] }
 * compileConditionSQL({ column: 'name', operator: 'starts', values: ['Ad'], connector: 'and' }, schema)
 * // { sql: '("name" >= ? AND "name" < ?)', parameters: ['Ad', 'Ae'] }
 * ```
 */
export function compileConditionSQL(
	condition: Condition,
	schema: TableSchema,
	pinned = false,
): CompiledSQL {
	if (
		!isString(condition.column) &&
		(condition.operator === 'equals' ||
			condition.operator === 'not' ||
			condition.operator === 'any' ||
			condition.operator === 'none')
	) {
		return compileNestedSQL(condition)
	}
	const column = (pinned ? '+' : '') + compileFieldSQL(condition.column)
	const nested = !isString(condition.column)
	const declared = isString(condition.column) ? findColumn(condition.column, schema) : undefined
	// How the column stores absence and explicit null; an undeclared flat column reads as optional.
	const flags = nested
		? 'nested'
		: declared === undefined
			? 'optional'
			: declared.optional && declared.nullable
				? 'both'
				: declared.nullable
					? 'nullable'
					: declared.optional
						? 'optional'
						: 'required'
	const sentinel = inferSentinelType(declared?.storage)
	const absent =
		flags === 'both'
			? '(' + column + ' IS NULL OR typeof(' + column + ") = '" + sentinel + "')"
			: column + ' IS NULL'
	const valued = flags === 'both' ? ' AND typeof(' + column + ") != '" + sentinel + "'" : ''
	// The tests for a decoded null and a decoded absence, or '' where the flags store neither.
	const nulled =
		flags === 'nullable'
			? column + ' IS NULL'
			: flags === 'both'
				? 'typeof(' + column + ") = '" + sentinel + "'"
				: ''
	const absented = flags === 'optional' || flags === 'both' ? column + ' IS NULL' : ''
	// A flat text column without a sentinel holds only text or NULL, so a text test needs no
	// `typeof`; a sentinel, a nested path, or another storage can hold a non-text value.
	const texted = declared?.storage === 'text' && flags !== 'both' && flags !== 'nested'
	const textual = texted ? '' : ' AND typeof(' + column + ") = 'text'"
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'equals': {
			if (first === null) return { sql: nulled === '' ? '0' : nulled, parameters: [] }
			if (first === undefined) return { sql: absented === '' ? '0' : absented, parameters: [] }
			return compileBoundSQL(column + ' = ?', [first], nested, declared)
		}
		case 'not': {
			if (first === null || first === undefined) {
				if (first === null) {
					if (flags === 'nullable') return { sql: column + ' IS NOT NULL', parameters: [] }
					return { sql: nulled === '' ? '1' : 'NOT ' + nulled, parameters: [] }
				}
				return { sql: absented === '' ? '1' : column + ' IS NOT NULL', parameters: [] }
			}
			return compileBoundSQL(
				'(' + column + ' != ? OR ' + column + ' IS NULL)',
				[first],
				nested,
				declared,
			)
		}
		case 'above':
			return compileBoundSQL(compileGuardedSQL(column + ' > ?', valued), [first], nested, declared)
		case 'below':
			return compileBoundSQL('(' + column + ' < ? OR ' + absent + ')', [first], nested, declared)
		case 'from':
			return compileBoundSQL(compileGuardedSQL(column + ' >= ?', valued), [first], nested, declared)
		case 'to':
			return compileBoundSQL('(' + column + ' <= ? OR ' + absent + ')', [first], nested, declared)
		case 'between':
			return compileBoundSQL(
				compileGuardedSQL(column + ' BETWEEN ? AND ?', valued),
				[first, second],
				nested,
				declared,
			)
		case 'like':
			return compileBoundSQL(
				compileGuardedSQL(column + ' LIKE ?', textual),
				[first],
				nested,
				declared,
			)
		case 'glob':
			return compileBoundSQL(
				compileGuardedSQL(column + ' GLOB ?', textual),
				[isString(first) ? first.replaceAll('[', '[[]') : first],
				nested,
				declared,
			)
		case 'starts': {
			// An empty prefix matches every text value, as every string starts with ''.
			const prefix = isString(first) ? first : ''
			if (prefix === '') return { sql: 'typeof(' + column + ") = 'text'", parameters: [] }
			const successor = computeSuccessor(prefix)
			if (successor === undefined) {
				return compileBoundSQL(
					'(typeof(' + column + ") = 'text' AND " + column + ' >= ?)',
					[prefix],
					nested,
					declared,
				)
			}
			return compileBoundSQL(
				'(' + column + ' >= ? AND ' + column + ' < ?)',
				[prefix, successor],
				nested,
				declared,
			)
		}
		case 'ends': {
			// `substr(<col>, -N)` reads the last N code points.
			const suffix = isString(first) ? first : ''
			if (suffix === '') return { sql: 'typeof(' + column + ") = 'text'", parameters: [] }
			return compileBoundSQL(
				'(typeof(' +
					column +
					") = 'text' AND substr(" +
					column +
					', -' +
					String(Array.from(suffix).length) +
					') = ?)',
				[suffix],
				nested,
				declared,
			)
		}
		case 'any': {
			if (condition.values.length === 0) return { sql: '0', parameters: [] }
			const listed = condition.values.filter((value) => value !== null && value !== undefined)
			const parts = [
				...(listed.length > 0
					? [compileListSQL(column + ' IN ', '', listed, nested, declared)]
					: []),
				...(condition.values.includes(null) && nulled !== ''
					? [{ sql: nulled, parameters: [] }]
					: []),
				...(condition.values.includes(undefined) && absented !== ''
					? [{ sql: absented, parameters: [] }]
					: []),
			]
			return compileJoinedSQL(parts, ' OR ', '0')
		}
		case 'none': {
			if (condition.values.length === 0) return { sql: '1', parameters: [] }
			const listed = condition.values.filter((value) => value !== null && value !== undefined)
			const parts = [
				...(listed.length > 0
					? [
							compileListSQL(
								'(' + column + ' NOT IN ',
								' OR ' + column + ' IS NULL)',
								listed,
								nested,
								declared,
							),
						]
					: []),
				...(condition.values.includes(null) && nulled !== ''
					? [{ sql: 'NOT ' + nulled, parameters: [] }]
					: []),
				...(condition.values.includes(undefined) && absented !== ''
					? [{ sql: column + ' IS NOT NULL', parameters: [] }]
					: []),
			]
			return compileJoinedSQL(parts, ' AND ', '1')
		}
		case 'absent':
			return { sql: absent, parameters: [] }
		case 'present':
			return { sql: compileGuardedSQL(column + ' IS NOT NULL', valued), parameters: [] }
	}
}

/**
 * Compiles an `equals`, `not`, `any`, or `none` condition on a nested path to a form that tests
 * the JSON type the path holds beside its value.
 *
 * @remarks
 * Each operand class has its own term: a string reads `json_type` `text` and its value, a
 * number reads `integer` or `real` and its value, `true`, `false`, and `null` read their JSON
 * type, and an absent path reads a `NULL` type. Strings and numbers bind as one JSON list read
 * through `json_each`, so a stored number and a listed one pass through the same JSON text
 * parser. `not` and `none` negate the membership with `NULL` read as no match. Both reads go
 * through {@link compileJSONAccessSQL}. Any other operand compares as the JSON text of its
 * value. The SQLite planner sends a condition here as a prefilter only when every operand is a
 * scalar and every key is one a JSON path label names as the core does, and the core rechecks
 * it.
 *
 * @param condition - The condition, whose column is a nested path
 * @returns The SQL fragment and its bound parameters
 *
 * @example
 * ```ts
 * compileNestedSQL({ column: ['meta', 'flag'], operator: 'equals', values: [true], connector: 'and' })
 * // { sql: `json_type(CASE WHEN typeof("meta") = 'text' THEN "meta" END, '$."flag"') = 'true'`, parameters: [] }
 * ```
 */
export function compileNestedSQL(condition: Condition): CompiledSQL {
	const path = isString(condition.column) ? [condition.column] : condition.column
	const type = compileJSONTypeSQL(path)
	const value = compileFieldSQL(path)
	const listed = condition.operator === 'any' || condition.operator === 'none'
	const operands = listed ? condition.values : [condition.values[0]]
	const strings = operands.filter(isString)
	const numbers = operands.filter(isNumber)
	const others = operands.filter(
		(operand) =>
			!isString(operand) &&
			!isNumber(operand) &&
			!isBoolean(operand) &&
			operand !== null &&
			operand !== undefined,
	)
	const member = compileJoinedSQL(
		[
			...(strings.length > 0
				? [
						{
							sql: '(' + type + " = 'text' AND " + value + ' IN (SELECT value FROM json_each(?)))',
							parameters: [JSON.stringify(strings)],
						},
					]
				: []),
			...(numbers.length > 0
				? [
						{
							sql:
								'(' +
								type +
								" IN ('integer', 'real') AND " +
								value +
								' IN (SELECT value FROM json_each(?)))',
							parameters: [JSON.stringify(numbers)],
						},
					]
				: []),
			...(operands.includes(true) ? [{ sql: type + " = 'true'", parameters: [] }] : []),
			...(operands.includes(false) ? [{ sql: type + " = 'false'", parameters: [] }] : []),
			...(operands.includes(null) ? [{ sql: type + " = 'null'", parameters: [] }] : []),
			...(operands.includes(undefined) ? [{ sql: type + ' IS NULL', parameters: [] }] : []),
			...others.map((operand) => compileBoundSQL(value + ' = ?', [operand], true, undefined)),
		],
		' OR ',
		'0',
	)
	if (condition.operator === 'equals' || condition.operator === 'any') return member
	return { sql: 'NOT COALESCE(' + member.sql + ', 0)', parameters: member.parameters }
}

/**
 * Parenthesizes a fragment when a guard term joins it, and leaves a bare fragment bare.
 *
 * @param fragment - The SQL fragment
 * @param guard - The joined guard term, or `''` for none
 * @returns The fragment, parenthesized when `guard` is not empty
 *
 * @example
 * ```ts
 * compileGuardedSQL('"age" > ?', '') // '"age" > ?'
 * compileGuardedSQL('"age" > ?', ' AND "age" IS NOT NULL') // '("age" > ? AND "age" IS NOT NULL)'
 * ```
 */
export function compileGuardedSQL(fragment: string, guard: string): string {
	return guard === '' ? fragment : '(' + fragment + guard + ')'
}

/**
 * Joins SQL fragments with one connective, parenthesizing two or more, and returns a constant
 * for none.
 *
 * @param parts - The fragments and their parameters, in order
 * @param connective - The joining operator, such as ` OR `
 * @param empty - The SQL for an empty list, such as `'0'`
 * @returns The joined fragment and its parameters
 *
 * @example
 * ```ts
 * compileJoinedSQL([{ sql: 'a', parameters: [] }, { sql: 'b', parameters: [1] }], ' OR ', '0')
 * // { sql: '(a OR b)', parameters: [1] }
 * ```
 */
export function compileJoinedSQL(
	parts: readonly CompiledSQL[],
	connective: string,
	empty: string,
): CompiledSQL {
	const [only] = parts
	if (only === undefined) return { sql: empty, parameters: [] }
	if (parts.length === 1) return only
	return {
		sql: '(' + parts.map((part) => part.sql).join(connective) + ')',
		parameters: parts.flatMap((part) => part.parameters),
	}
}

/**
 * Compiles a membership list as one bound JSON parameter read through `json_each`, or as one
 * parameter per operand when an encoded operand has no JSON form.
 *
 * @param head - The SQL ahead of the list
 * @param tail - The SQL after the list
 * @param values - The operands
 * @param nested - If `true`, encodes each operand by its runtime type; if `false`, by the
 *   declared column
 * @param declared - The declared flat column
 * @returns The SQL fragment and its bound parameters
 *
 * @example
 * ```ts
 * compileListSQL('"id" IN ', '', ['a', 'b'], false, idColumn)
 * // { sql: '"id" IN (SELECT value FROM json_each(?))', parameters: ['["a","b"]'] }
 * ```
 */
export function compileListSQL(
	head: string,
	tail: string,
	values: readonly unknown[],
	nested: boolean,
	declared: ColumnSchema | undefined,
): CompiledSQL {
	const encoded = compileBoundSQL('', values, nested, declared).parameters
	if (encoded.every((value) => isString(value) || isFiniteNumber(value))) {
		return {
			sql: head + '(SELECT value FROM json_each(?))' + tail,
			parameters: [JSON.stringify(encoded)],
		}
	}
	return { sql: head + '(' + values.map(() => '?').join(', ') + ')' + tail, parameters: encoded }
}

/**
 * Encodes condition operands for a SQL fragment using their declared or inferred storage.
 *
 * @example
 * ```ts
 * compileBoundSQL('"age" > ?', [18], false, undefined)
 * // { sql: '"age" > ?', parameters: ['18'] }
 * ```
 */
export function compileBoundSQL(
	sql: string,
	values: readonly unknown[],
	nested: boolean,
	declared: ColumnSchema | undefined,
): CompiledSQL {
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
 * The first condition's connector is ignored, per the {@link Condition} types. When every
 * connector is `and` and one condition is `any` on the primary key, every other condition's
 * column reference is pinned behind the unary `+`, so the engine keeps the primary key as
 * the access path on any file, with or without `sqlite_stat1`.
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
	const pinned = matchesPrimaryPin(conditions, schema)
	const compiled = conditions.map((condition) =>
		compileConditionSQL(
			condition,
			schema,
			pinned && !(condition.operator === 'any' && condition.column === schema.primary),
		),
	)
	const [head, ...remaining] = compiled
	if (head === undefined) return { sql: '', parameters: [] }
	const fragments = remaining.map((next, index) => {
		const operator = conditions[index + 1]?.connector === 'or' ? 'OR' : 'AND'
		return ' ' + operator + ' ' + next.sql + ')'
	})
	return {
		sql: 'WHERE ' + '('.repeat(fragments.length) + head.sql + fragments.join(''),
		parameters: compiled.flatMap((part) => part.parameters),
	}
}

/**
 * Compiles the ORDER BY clause from the order terms, ending with the primary key in the
 * direction of the final term.
 *
 * @remarks
 * Ties resolve by primary key in the direction of the final order term, ascending when the
 * read has no order, so a read without an order returns ascending key order. The primary
 * term is skipped when the primary is already an explicit order term. `pinned` writes each
 * explicit term behind the unary `+`, so an order keeps the engine on the primary-key access
 * path {@link compileWhereSQL} pins. A column that is both optional and nullable stores
 * explicit `null` as a sentinel that sorts among its values, so its term follows a rank in
 * the same direction: absent ranks 0, `null` ranks 1, and a value ranks 2, which is the core's
 * total order.
 *
 * @param order - The explicit order terms, or `undefined`
 * @param schema - The table's schema (for the primary key)
 * @param pinned - If `true`, writes each explicit term behind the unary `+`; if `false`, bare.
 *   Default: `false`
 * @returns The `ORDER BY …` clause
 *
 * @example
 * ```ts
 * compileOrderSQL([{ column: 'age', direction: 'descending' }], schema)
 * // 'ORDER BY "age" DESC, "id" DESC'
 * ```
 */
export function compileOrderSQL(
	order: readonly Order[] | undefined,
	schema: TableSchema,
	pinned = false,
): string {
	const terms = (order ?? []).flatMap((term) => {
		const direction = term.direction === 'descending' ? ' DESC' : ' ASC'
		const field = compileFieldSQL(term.column)
		const declared = isString(term.column) ? findColumn(term.column, schema) : undefined
		const sorted = (pinned ? '+' : '') + field + direction
		if (declared === undefined || !declared.optional || !declared.nullable) return [sorted]
		const rank =
			'CASE WHEN ' +
			field +
			' IS NULL THEN 0 WHEN typeof(' +
			field +
			") = '" +
			inferSentinelType(declared.storage) +
			"' THEN 1 ELSE 2 END"
		return [rank + direction, sorted]
	})
	const ordersByPrimary = (order ?? []).some(
		(term) => isString(term.column) && term.column === schema.primary,
	)
	const tie = order?.at(-1)?.direction === 'descending' ? ' DESC' : ' ASC'
	const tail = ordersByPrimary ? [] : [quoteIdentifier(schema.primary) + tie]
	return 'ORDER BY ' + [...terms, ...tail].join(', ')
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
 * Compiles a {@link QueryInput} into the SQL clause that follows a table name, with
 * its bound parameters in clause order.
 *
 * @remarks
 * Pass it the native side of {@link planSQLiteQuery}. It assembles
 * `[where, orderBy, limitOffset]` into one clause so a `SELECT * FROM <table> <clause>`
 * runs the read in the engine: {@link compileWhereSQL} folds the conditions left-to-right
 * and pins them behind a primary-key `any`, and {@link compileOrderSQL} ends the order with
 * the primary key in the final term's direction. Each operand is encoded through
 * `encodeValue`.
 *
 * @param input - The read specification, or `undefined` for all rows
 * @param schema - The table's schema (column types for operand encoding)
 * @returns The SQL tail and its bound parameters
 *
 * @example
 * ```ts
 * compileQuerySQL({ conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] }, schema)
 * // { sql: 'WHERE "age" >= ? ORDER BY "id" ASC', parameters: [18] }
 * ```
 */
export function compileQuerySQL(input: QueryInput | undefined, schema: TableSchema): CompiledSQL {
	validatePage(input)
	const conditions = input?.conditions ?? []
	const where = compileWhereSQL(conditions, schema)
	const orderBy = compileOrderSQL(input?.order, schema, matchesPrimaryPin(conditions, schema))
	const page = compilePageSQL(input?.limit, input?.offset)
	const sql = [where.sql, orderBy, page.sql].filter((part) => part !== '').join(' ')
	return {
		sql,
		parameters: [...where.parameters, ...page.parameters],
	}
}

/**
 * Compiles the statement that inserts one row of a table, binding one parameter per declared
 * column in schema order.
 *
 * @param schema - The table schema
 * @param replace - If `true`, the row replaces a stored row with the same primary key; if
 *   `false`, a stored row with that key fails the statement's primary-key constraint
 * @returns The `INSERT` statement, the same text for every row of the table
 *
 * @example
 * ```ts
 * compileInsertSQL(schema, true)
 * // 'INSERT OR REPLACE INTO "users" ("id", "name") VALUES (?, ?)'
 * ```
 */
export function compileInsertSQL(schema: TableSchema, replace: boolean): string {
	const names = schema.columns.map((column) => quoteIdentifier(column.name))
	return (
		(replace ? 'INSERT OR REPLACE INTO ' : 'INSERT INTO ') +
		quoteIdentifier(schema.name) +
		' (' +
		names.join(', ') +
		') VALUES (' +
		names.map(() => '?').join(', ') +
		')'
	)
}

/**
 * Projects a {@link TableSchema} to its `CREATE TABLE IF NOT EXISTS` statement.
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
 * Projects a {@link TableSchema} to its declared SQLite indexes.
 *
 * @remarks
 * Each statement is a `CREATE INDEX IF NOT EXISTS` named by
 * {@link deriveSQLiteIndexName}, so a reopen re-issues the set safely.
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
 * Projects one {@link MigrationStep} to SQLite DDL.
 *
 * @remarks
 * These are the statements the SQLite driver's `migrate` executes for the step,
 * inside whichever native transaction is active.
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
