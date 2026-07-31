import type { QueryInput, TableSchema } from '@src/core'
import {
	compileAggregateSQL,
	compileColumnSQL,
	compileFieldSQL,
	compileQuerySQL,
	compileOrder,
	compilePage,
	compileWhere,
	findColumnStorage,
	escapeLike,
	compileConditionSQL,
	inferValueStorage,
	schemaToIndexes,
	schemaToTable,
	stepToSQL,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { buildCondition as cond } from '../../setup.js'

// Unit tests for the QueryInput → SQL compiler: representative operators, the
// LEFT-TO-RIGHT parenthesization that mirrors the engine's matchesQuery fold
// (NOT SQL precedence), ORDER BY, and LIMIT/OFFSET — asserting both the `sql`
// string and the bound `parameters`. ORDER BY always ENDS with the primary key so the
// native read resolves ties in key order, matching a primary-key-ordered `scan`
// and the core engine's stable sort over a key-ordered scan (AGENTS §21 / §22
// native ↔ engine parity): with no explicit order it is the sole `ORDER BY
// "<primary>"` (here `"id"`); an explicit order appends `, "<primary>"` (ASC) as
// the final tie-break determinant — unless the primary is already one of the
// explicit terms.

const SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'active', storage: 'boolean', optional: false, nullable: false },
		{ name: 'meta', storage: 'json', optional: false, nullable: true },
	],
	indexes: [],
}

describe('SQL declaration compilers', () => {
	it('maps every portable column storage to its exact SQLite type', () => {
		expect(compileColumnSQL('text')).toBe('TEXT')
		expect(compileColumnSQL('json')).toBe('TEXT')
		expect(compileColumnSQL('integer')).toBe('INTEGER')
		expect(compileColumnSQL('boolean')).toBe('INTEGER')
		expect(compileColumnSQL('real')).toBe('REAL')
		expect(compileColumnSQL('blob')).toBe('BLOB')
	})

	it('compiles flat and nested fields with contained identifiers and paths', () => {
		expect(compileFieldSQL('payload')).toBe('"payload"')
		expect(compileFieldSQL(['payload', 'user', 'id'])).toBe(
			'json_extract("payload", \'$.user.id\')',
		)
		expect(compileFieldSQL(['payload', "a'b"])).toBe("json_extract(\"payload\", '$.a''b')")
	})

	it('compiles every aggregate without changing SQL bytes', () => {
		expect(compileAggregateSQL('count', 'age')).toBe('COUNT(*)')
		expect(compileAggregateSQL('sum', 'age')).toBe('SUM("age")')
		expect(compileAggregateSQL('average', 'age')).toBe('AVG("age")')
		expect(compileAggregateSQL('minimum', 'age')).toBe('MIN("age")')
		expect(compileAggregateSQL('maximum', 'age')).toBe('MAX("age")')
		expect(compileAggregateSQL('sum', ['payload', 'score'])).toBe(
			'SUM(json_extract("payload", \'$.score\'))',
		)
	})
})

describe('schema and migration compilers', () => {
	const INDEXED_SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: false },
		],
		indexes: [['name'], ['name', 'age']],
	}

	it('compiles the exact table and index declarations', () => {
		expect(schemaToTable(INDEXED_SCHEMA)).toBe(
			'CREATE TABLE IF NOT EXISTS "users" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "age" INTEGER NOT NULL, PRIMARY KEY ("id"))',
		)
		expect(schemaToIndexes(INDEXED_SCHEMA)).toEqual([
			'CREATE INDEX IF NOT EXISTS "idx_5_users_4_name" ON "users" ("name")',
			'CREATE INDEX IF NOT EXISTS "idx_5_users_4_name_3_age" ON "users" ("name", "age")',
		])
		expect(schemaToIndexes({ ...INDEXED_SCHEMA, indexes: [] })).toEqual([])
	})

	it('uses the same persisted index bytes for open and migration', () => {
		expect(stepToSQL({ operation: 'index.add', table: 'users', index: ['name'] })).toEqual([
			'CREATE INDEX IF NOT EXISTS "idx_5_users_4_name" ON "users" ("name")',
		])
		expect(stepToSQL({ operation: 'index.remove', table: 'users', index: ['name'] })).toEqual([
			'DROP INDEX IF EXISTS "idx_5_users_4_name"',
		])
	})

	it('compiles table and column migration operations', () => {
		expect(stepToSQL({ operation: 'table.add', table: INDEXED_SCHEMA })).toEqual([
			schemaToTable(INDEXED_SCHEMA),
			...schemaToIndexes(INDEXED_SCHEMA),
		])
		expect(stepToSQL({ operation: 'table.remove', table: 'users' })).toEqual([
			'DROP TABLE IF EXISTS "users"',
		])
		expect(
			stepToSQL({
				operation: 'column.add',
				table: 'users',
				column: { name: 'nickname', storage: 'text', optional: true, nullable: true },
			}),
		).toEqual(['ALTER TABLE "users" ADD COLUMN "nickname" TEXT'])
		expect(stepToSQL({ operation: 'column.remove', table: 'users', column: 'legacy' })).toEqual([
			'ALTER TABLE "users" DROP COLUMN "legacy"',
		])
	})
})

function compile(input: QueryInput): { sql: string; parameters: readonly unknown[] } {
	const result = compileQuerySQL(input, SCHEMA)
	return { sql: result.sql, parameters: result.parameters }
}

describe('compileQuerySQL — operators', () => {
	it('compiles equals to `= ?` with the encoded operand', () => {
		expect(compile({ conditions: [cond('age', 'equals', [36])] })).toEqual({
			sql: 'WHERE "age" = ? ORDER BY "id"',
			parameters: [36],
		})
	})

	it('encodes a boolean operand to 1 / 0', () => {
		expect(compile({ conditions: [cond('active', 'equals', [true])] })).toEqual({
			sql: 'WHERE "active" = ? ORDER BY "id"',
			parameters: [1],
		})
	})

	it('compiles not to `(!= ? OR IS NULL)` — a missing column ranks below every scalar', () => {
		// The engine's `compareValues(undefined, 36) !== 0` matches an absent/NULL
		// column too, so `not` must also match the `IS NULL` row — SQL's raw
		// `!= ?` alone would exclude it (NULL comparisons are never true).
		expect(compile({ conditions: [cond('age', 'not', [36])] })).toEqual({
			sql: 'WHERE ("age" != ? OR "age" IS NULL) ORDER BY "id"',
			parameters: [36],
		})
	})

	it('compiles above / from to raw > / >= (a NULL column never matches)', () => {
		expect(compile({ conditions: [cond('age', 'above', [18])] }).sql).toBe(
			'WHERE "age" > ? ORDER BY "id"',
		)
		expect(compile({ conditions: [cond('age', 'from', [18])] }).sql).toBe(
			'WHERE "age" >= ? ORDER BY "id"',
		)
	})

	it('compiles below / to to `(< / <= ? OR IS NULL)` — a missing column ranks below every scalar', () => {
		// The engine's `compareValues(undefined, 18) < 0` matches an absent/NULL
		// column (rank 0 < any scalar's rank), so `below` / `to` must match it too.
		expect(compile({ conditions: [cond('age', 'below', [18])] })).toEqual({
			sql: 'WHERE ("age" < ? OR "age" IS NULL) ORDER BY "id"',
			parameters: [18],
		})
		expect(compile({ conditions: [cond('age', 'to', [18])] })).toEqual({
			sql: 'WHERE ("age" <= ? OR "age" IS NULL) ORDER BY "id"',
			parameters: [18],
		})
	})

	it('compiles a flat not(null) to the constant 1 (matches every row)', () => {
		// A flat column's decoded value is never a present null (NULL decodes to
		// absent), so `compareValues(value, null)` is nonzero for every row —
		// `not null` matches unconditionally, which no `!= ? OR IS NULL` shape
		// can express (it would only match the IS NULL row).
		expect(compile({ conditions: [cond('age', 'not', [null])] })).toEqual({
			sql: 'WHERE 1 ORDER BY "id"',
			parameters: [],
		})
	})

	it('compiles between to BETWEEN ? AND ?', () => {
		expect(compile({ conditions: [cond('age', 'between', [18, 65])] })).toEqual({
			sql: 'WHERE "age" BETWEEN ? AND ? ORDER BY "id"',
			parameters: [18, 65],
		})
	})

	it('compiles like and glob to their raw operators', () => {
		expect(compile({ conditions: [cond('name', 'like', ['A%'])] }).sql).toBe(
			'WHERE "name" LIKE ? ORDER BY "id"',
		)
		expect(compile({ conditions: [cond('name', 'glob', ['A*'])] }).sql).toBe(
			'WHERE "name" GLOB ? ORDER BY "id"',
		)
	})

	it('compiles starts to a case-sensitive substr(col, 1, N) = ? check (N = code-point count)', () => {
		// Case-sensitive and exact — replaces the old LIKE-based compile (which
		// was ASCII-only case-INsensitive, diverging from the engine's
		// case-sensitive startsWith). N is a code-point count via Array.from,
		// not `.length` (matters for astral characters).
		expect(compile({ conditions: [cond('name', 'starts', ['A_d%'])] })).toEqual({
			sql: 'WHERE (typeof("name") = \'text\' AND substr("name", 1, 4) = ?) ORDER BY "id"',
			parameters: ['A_d%'],
		})
	})

	it('compiles ends to a case-sensitive substr(col, -N) = ? check', () => {
		expect(compile({ conditions: [cond('name', 'ends', ['x'])] })).toEqual({
			sql: 'WHERE (typeof("name") = \'text\' AND substr("name", -1) = ?) ORDER BY "id"',
			parameters: ['x'],
		})
	})

	it('compiles an empty-string starts / ends operand to a bare text-typeof check', () => {
		// The engine: every string cell starts with / ends with ''.
		expect(compile({ conditions: [cond('name', 'starts', [''])] })).toEqual({
			sql: 'WHERE typeof("name") = \'text\' ORDER BY "id"',
			parameters: [],
		})
		expect(compile({ conditions: [cond('name', 'ends', [''])] })).toEqual({
			sql: 'WHERE typeof("name") = \'text\' ORDER BY "id"',
			parameters: [],
		})
	})

	it('compiles a non-empty any to IN (?, ?)', () => {
		expect(compile({ conditions: [cond('id', 'any', ['u1', 'u2'])] })).toEqual({
			sql: 'WHERE "id" IN (?, ?) ORDER BY "id"',
			parameters: ['u1', 'u2'],
		})
	})

	it('collapses an empty any to the constant 0 (matches nothing)', () => {
		expect(compile({ conditions: [cond('id', 'any', [])] })).toEqual({
			sql: 'WHERE 0 ORDER BY "id"',
			parameters: [],
		})
	})

	it('compiles a non-empty none to `(NOT IN (?, ?) OR IS NULL)`', () => {
		// An absent/NULL column never rank-equals a listed scalar, so the engine's
		// `none` matches it too — plain `NOT IN` alone would exclude it (SQL's
		// three-valued `NULL NOT IN (...)` is never true).
		expect(compile({ conditions: [cond('id', 'none', ['u1', 'u2'])] })).toEqual({
			sql: 'WHERE ("id" NOT IN (?, ?) OR "id" IS NULL) ORDER BY "id"',
			parameters: ['u1', 'u2'],
		})
	})

	it('collapses an empty none to the constant 1 (matches all)', () => {
		expect(compile({ conditions: [cond('id', 'none', [])] })).toEqual({
			sql: 'WHERE 1 ORDER BY "id"',
			parameters: [],
		})
	})

	it('compiles absent to IS NULL with no parameters', () => {
		expect(compile({ conditions: [cond('meta', 'absent', [])] })).toEqual({
			sql: 'WHERE "meta" IS NULL ORDER BY "id"',
			parameters: [],
		})
	})

	it('compiles present to IS NOT NULL with no parameters', () => {
		expect(compile({ conditions: [cond('meta', 'present', [])] })).toEqual({
			sql: 'WHERE "meta" IS NOT NULL ORDER BY "id"',
			parameters: [],
		})
	})

	it('compiles a nested FieldPath to json_extract binding the native scalar', () => {
		// json_extract returns the unquoted native scalar (here the number 9), so the
		// operand binds as `9` — NOT JSON.stringify(9) = '9' (a string), which would
		// match zero rows. This is the operand-encoding fix.
		expect(compile({ conditions: [cond(['meta', 'info', 'score'], 'equals', [9])] })).toEqual({
			sql: 'WHERE json_extract("meta", \'$.info.score\') = ? ORDER BY "id"',
			parameters: [9],
		})
	})

	it('binds a nested string operand as the raw string (not JSON-quoted)', () => {
		// A nested string operand binds as `green`, not JSON.stringify('green') =
		// '"green"' — json_extract returns the string unquoted.
		expect(compile({ conditions: [cond(['payload', 'tag'], 'equals', ['green'])] })).toEqual({
			sql: 'WHERE json_extract("payload", \'$.tag\') = ? ORDER BY "id"',
			parameters: ['green'],
		})
	})

	it('binds a nested boolean operand as 1 / 0', () => {
		// A JSON boolean comes back from json_extract as integer 1/0, so `true` binds
		// as `1` — not JSON.stringify(true) = 'true'.
		expect(compile({ conditions: [cond(['payload', 'flag'], 'equals', [true])] })).toEqual({
			sql: 'WHERE json_extract("payload", \'$.flag\') = ? ORDER BY "id"',
			parameters: [1],
		})
	})

	it("escapes a ' in a nested json-path part (no SQL-literal break-out)", () => {
		// A part with a single quote must be doubled (`x''y`), so a caller-supplied
		// key can't terminate the json-path string literal and inject SQL. The
		// operand binds as the raw string `v` (the native json_extract scalar).
		expect(compile({ conditions: [cond(['meta', "x'y"], 'equals', ['v'])] })).toEqual({
			sql: 'WHERE json_extract("meta", \'$.x\'\'y\') = ? ORDER BY "id"',
			parameters: ['v'],
		})
	})

	it("compiles a nested equals(null) to json_type = 'null' (present-null only)", () => {
		// json_extract collapses BOTH a present JSON `null` AND an absent path to SQL
		// `NULL` — indistinguishable. json_type disambiguates: `'null'` only for a
		// present JSON null, matching the engine's `compareValues(null, null) === 0`
		// (absent decodes to `undefined`, which does NOT equal `null`).
		expect(compile({ conditions: [cond(['meta', 'note'], 'equals', [null])] })).toEqual({
			sql: 'WHERE json_type("meta", \'$.note\') = \'null\' ORDER BY "id"',
			parameters: [],
		})
	})

	it("compiles a nested not(null) to (json_type IS NULL OR json_type != 'null')", () => {
		// Matches absent (json_type IS NULL) or present-scalar (json_type != 'null');
		// excludes only a present JSON null — matching the engine's
		// `compareValues(value, null) !== 0`.
		expect(compile({ conditions: [cond(['meta', 'note'], 'not', [null])] })).toEqual({
			sql: 'WHERE (json_type("meta", \'$.note\') IS NULL OR json_type("meta", \'$.note\') != \'null\') ORDER BY "id"',
			parameters: [],
		})
	})

	it('compiles a nested below to `(< ? OR json_extract IS NULL)` — absent and present-null both match', () => {
		// json_extract collapses BOTH absent and present-null to SQL NULL, so one
		// `IS NULL` clause catches both — matching the engine, where both an
		// undefined (rank 0) and a null (rank 1) nested value rank below any scalar.
		expect(compile({ conditions: [cond(['meta', 'score'], 'below', [18])] })).toEqual({
			sql: 'WHERE (json_extract("meta", \'$.score\') < ? OR json_extract("meta", \'$.score\') IS NULL) ORDER BY "id"',
			parameters: [18],
		})
	})

	it('compiles a nested none to `(NOT IN (...) OR json_extract IS NULL)`', () => {
		expect(compile({ conditions: [cond(['meta', 'tag'], 'none', ['a', 'b'])] })).toEqual({
			sql: 'WHERE (json_extract("meta", \'$.tag\') NOT IN (?, ?) OR json_extract("meta", \'$.tag\') IS NULL) ORDER BY "id"',
			parameters: ['a', 'b'],
		})
	})

	it('leaves a FLAT equals(null) as `= ?` binding [null] (nested-only fix)', () => {
		// A flat column with a null operand is unchanged: encodeValue(null) is NULL,
		// and a null flat column decodes to absent, so `= NULL` and the engine already
		// agree (both match nothing). Applying IS NULL here would be a new divergence.
		expect(compile({ conditions: [cond('meta', 'equals', [null])] })).toEqual({
			sql: 'WHERE "meta" = ? ORDER BY "id"',
			parameters: [null],
		})
	})
})

describe('compileQuerySQL — parenthesization', () => {
	it('folds a 3-condition and/or mix left-to-right (not SQL precedence)', () => {
		const input: QueryInput = {
			conditions: [
				cond('age', 'from', [18]),
				cond('name', 'starts', ['A'], 'or'),
				cond('active', 'equals', [true], 'and'),
			],
		}
		// (((age >= ? OR starts(name)) AND active = ?)) — the fold wraps each step,
		// matching the engine's left-to-right matchesQuery (NOT SQL precedence).
		expect(compile(input)).toEqual({
			sql: 'WHERE (("age" >= ? OR (typeof("name") = \'text\' AND substr("name", 1, 1) = ?)) AND "active" = ?) ORDER BY "id"',
			parameters: [18, 'A', 1],
		})
	})

	it('ignores the first condition connector', () => {
		const input: QueryInput = {
			conditions: [cond('age', 'from', [18], 'or'), cond('active', 'equals', [true], 'and')],
		}
		expect(compile(input).sql).toBe('WHERE ("age" >= ? AND "active" = ?) ORDER BY "id"')
	})
})

describe('compileQuerySQL — order and paging', () => {
	it('compiles ORDER BY with directions, appending the primary tie-breaker (ASC)', () => {
		// An explicit order that does NOT include the primary appends `, "id"` as the
		// final determinant — ASCENDING regardless of the explicit directions — so
		// SQLite resolves ties in key order, matching a primary-key-ordered `scan` and
		// the engine's stable sort over a key-ordered scan (and IndexedDB's
		// key-ordered reads). Without it SQLite would break ties by rowid (insertion
		// order) and diverge (the cross-backend hole).
		expect(
			compile({
				order: [
					{ column: 'age', direction: 'descending' },
					{ column: 'name', direction: 'ascending' },
				],
			}),
		).toEqual({ sql: 'ORDER BY "age" DESC, "name" ASC, "id"', parameters: [] })
	})

	it('does NOT double-append when the explicit order already includes the primary', () => {
		// The primary already determines the order, so no tie-break term is appended —
		// the explicit `"id"` (with its own direction) stays the sole/final determinant.
		expect(
			compile({
				order: [
					{ column: 'age', direction: 'ascending' },
					{ column: 'id', direction: 'descending' },
				],
			}),
		).toEqual({ sql: 'ORDER BY "age" ASC, "id" DESC', parameters: [] })
	})

	it('appends the primary tie-breaker to a single explicit non-primary term', () => {
		// A lone explicit term that is not the primary still gets `, "id"` appended.
		expect(compile({ order: [{ column: 'age', direction: 'ascending' }] })).toEqual({
			sql: 'ORDER BY "age" ASC, "id"',
			parameters: [],
		})
	})

	it('compiles LIMIT then OFFSET when both present (with the default key order)', () => {
		expect(compile({ limit: 10, offset: 5 })).toEqual({
			sql: 'ORDER BY "id" LIMIT ? OFFSET ?',
			parameters: [10, 5],
		})
	})

	it('compiles LIMIT alone (with the default key order)', () => {
		expect(compile({ limit: 10 })).toEqual({ sql: 'ORDER BY "id" LIMIT ?', parameters: [10] })
	})

	it('compiles offset-only to LIMIT -1 OFFSET ? (with the default key order)', () => {
		expect(compile({ offset: 5 })).toEqual({
			sql: 'ORDER BY "id" LIMIT -1 OFFSET ?',
			parameters: [5],
		})
	})

	it('assembles WHERE, ORDER BY, and LIMIT/OFFSET in order', () => {
		expect(
			compile({
				conditions: [cond('age', 'from', [18])],
				order: [{ column: 'age', direction: 'ascending' }],
				limit: 5,
				offset: 2,
			}),
		).toEqual({
			sql: 'WHERE "age" >= ? ORDER BY "age" ASC, "id" LIMIT ? OFFSET ?',
			parameters: [18, 5, 2],
		})
	})

	it('defaults an unordered input to ORDER BY the primary key (key order)', () => {
		// No explicit order → the compiler appends ORDER BY "<primary>", so the native
		// records read yields rows in key order, matching a primary-key-ordered `scan`
		// and the core engine over an unordered scan (the parity safety net depends
		// on this).
		expect(compile({})).toEqual({ sql: 'ORDER BY "id"', parameters: [] })
	})

	it('compiles an undefined input to the same default key order', () => {
		expect(compileQuerySQL(undefined, SCHEMA)).toEqual({ sql: 'ORDER BY "id"', parameters: [] })
	})

	it('rejects invalid paging before compiling query SQL', () => {
		expect(() => compileQuerySQL({ limit: 1.5 }, SCHEMA)).toThrow(
			'Query limit must be a nonnegative integer',
		)
		expect(() => compileQuerySQL({ offset: Number.POSITIVE_INFINITY }, SCHEMA)).toThrow(
			'Query offset must be a nonnegative integer',
		)
	})
})

describe('escapeLike', () => {
	it('escapes %, _, and the escape char (\\) each with a leading backslash', () => {
		// `\` first (so the escapes it introduces are not re-escaped), then % and _.
		expect(escapeLike('50%_off')).toBe('50\\%\\_off')
	})

	it('escapes a leading backslash before the wildcards it precedes', () => {
		// `a\%` → the literal `\` doubles to `\\` and the `%` escapes to `\%`.
		expect(escapeLike('a\\%')).toBe('a\\\\\\%')
	})

	it('returns plain text with no LIKE metacharacters unchanged', () => {
		expect(escapeLike('plain')).toBe('plain')
	})
})

describe('findColumnStorage', () => {
	it('returns the declared storage type of a known column', () => {
		expect(findColumnStorage('age', SCHEMA)).toBe('integer')
		expect(findColumnStorage('meta', SCHEMA)).toBe('json')
	})

	it('returns undefined for a column the schema does not carry', () => {
		expect(findColumnStorage('missing', SCHEMA)).toBeUndefined()
	})
})

describe('inferValueStorage', () => {
	it('maps a boolean to boolean', () => {
		expect(inferValueStorage(true)).toBe('boolean')
		expect(inferValueStorage(false)).toBe('boolean')
	})

	it('maps an integer number to integer and a fractional number to real', () => {
		expect(inferValueStorage(9)).toBe('integer')
		expect(inferValueStorage(1.5)).toBe('real')
	})

	it('maps a bigint to integer', () => {
		expect(inferValueStorage(7n)).toBe('integer')
	})

	it('maps an object / array to json', () => {
		expect(inferValueStorage({ a: 1 })).toBe('json')
		expect(inferValueStorage([1, 2])).toBe('json')
	})

	it('maps a string, null, and undefined to text', () => {
		expect(inferValueStorage('hi')).toBe('text')
		expect(inferValueStorage(null)).toBe('text')
		expect(inferValueStorage(undefined)).toBe('text')
	})
})

describe('compileConditionSQL', () => {
	it('builds a flat equals compileConditionSQL encoding the operand by its declared type', () => {
		// A flat `boolean` column encodes its operand to 1 / 0 via the declared type.
		expect(compileConditionSQL(cond('active', 'equals', [true]), SCHEMA)).toEqual({
			sql: '"active" = ?',
			parameters: [1],
		})
	})

	it('builds a BETWEEN compileConditionSQL binding both operands', () => {
		expect(compileConditionSQL(cond('age', 'between', [18, 65]), SCHEMA)).toEqual({
			sql: '"age" BETWEEN ? AND ?',
			parameters: [18, 65],
		})
	})

	it('builds a case-sensitive starts compileConditionSQL (substr(col, 1, N) = ?)', () => {
		expect(compileConditionSQL(cond('name', 'starts', ['A_d%']), SCHEMA)).toEqual({
			sql: '(typeof("name") = \'text\' AND substr("name", 1, 4) = ?)',
			parameters: ['A_d%'],
		})
	})

	it('collapses an empty any to the constant 0 with no parameters', () => {
		expect(compileConditionSQL(cond('id', 'any', []), SCHEMA)).toEqual({ sql: '0', parameters: [] })
	})

	it('collapses an empty none to the constant 1 with no parameters', () => {
		expect(compileConditionSQL(cond('id', 'none', []), SCHEMA)).toEqual({
			sql: '1',
			parameters: [],
		})
	})

	it("compiles a nested null equals to json_type = 'null' with no bound param", () => {
		// A nested (json_extract) field with a null operand under equals compiles
		// through json_type — 'null' means present-JSON-null, distinguishing it
		// from an absent path (which json_extract alone cannot tell apart).
		expect(compileConditionSQL(cond(['meta', 'note'], 'equals', [null]), SCHEMA)).toEqual({
			sql: "json_type(\"meta\", '$.note') = 'null'",
			parameters: [],
		})
	})

	it('encodes a nested operand as the native json_extract scalar (not JSON-quoted)', () => {
		// A nested string operand binds raw (`green`), not JSON.stringify('green').
		expect(compileConditionSQL(cond(['meta', 'tag'], 'equals', ['green']), SCHEMA)).toEqual({
			sql: 'json_extract("meta", \'$.tag\') = ?',
			parameters: ['green'],
		})
	})
})

describe('compileWhere', () => {
	it('returns an empty clause and no parameters for zero conditions', () => {
		expect(compileWhere([], SCHEMA)).toEqual({ sql: '', parameters: [] })
	})

	it('builds a single-condition WHERE with no wrapping parens', () => {
		expect(compileWhere([cond('age', 'from', [18])], SCHEMA)).toEqual({
			sql: 'WHERE "age" >= ?',
			parameters: [18],
		})
	})

	it('folds multiple conditions left-to-right, ignoring the first connector', () => {
		// Each step wraps the running clause — matching the engine's matchesQuery
		// fold, NOT SQL's AND-over-OR precedence; the first connector is dropped.
		expect(
			compileWhere(
				[
					cond('age', 'from', [18], 'or'),
					cond('name', 'equals', ['A'], 'or'),
					cond('active', 'equals', [true], 'and'),
				],
				SCHEMA,
			),
		).toEqual({
			sql: 'WHERE (("age" >= ? OR "name" = ?) AND "active" = ?)',
			parameters: [18, 'A', 1],
		})
	})
})

describe('compileOrder', () => {
	it('returns ORDER BY the primary key alone for an undefined order', () => {
		expect(compileOrder(undefined, SCHEMA)).toBe('ORDER BY "id"')
	})

	it('appends the primary key (ASC) as the tie-breaker after explicit non-primary terms', () => {
		expect(
			compileOrder(
				[
					{ column: 'age', direction: 'descending' },
					{ column: 'name', direction: 'ascending' },
				],
				SCHEMA,
			),
		).toBe('ORDER BY "age" DESC, "name" ASC, "id"')
	})

	it('does not double-append when an explicit term is already the primary', () => {
		expect(compileOrder([{ column: 'id', direction: 'descending' }], SCHEMA)).toBe(
			'ORDER BY "id" DESC',
		)
	})

	it('compiles a nested FieldPath order term to json_extract', () => {
		expect(compileOrder([{ column: ['meta', 'score'], direction: 'ascending' }], SCHEMA)).toBe(
			'ORDER BY json_extract("meta", \'$.score\') ASC, "id"',
		)
	})
})

describe('compilePage', () => {
	it('compiles LIMIT then OFFSET when both are present', () => {
		expect(compilePage(10, 5)).toEqual({ sql: 'LIMIT ? OFFSET ?', parameters: [10, 5] })
	})

	it('compiles LIMIT alone', () => {
		expect(compilePage(10, undefined)).toEqual({ sql: 'LIMIT ?', parameters: [10] })
	})

	it('compiles an offset without a limit to LIMIT -1 OFFSET ?', () => {
		// SQLite needs a LIMIT for OFFSET to apply; -1 means "no limit".
		expect(compilePage(undefined, 5)).toEqual({ sql: 'LIMIT -1 OFFSET ?', parameters: [5] })
	})

	it('returns an empty clause when neither limit nor offset is set', () => {
		expect(compilePage(undefined, undefined)).toEqual({ sql: '', parameters: [] })
	})

	it('rejects invalid direct page values and accepts zero', () => {
		expect(() => compilePage(-1, undefined)).toThrow('Query limit must be a nonnegative integer')
		expect(() => compilePage(undefined, Number.NaN)).toThrow(
			'Query offset must be a nonnegative integer',
		)
		expect(compilePage(0, 0)).toEqual({ sql: 'LIMIT ? OFFSET ?', parameters: [0, 0] })
	})
})
