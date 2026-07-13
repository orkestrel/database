import type { Criteria, TableSchema } from '@src/core'
import {
	compileCriteria,
	compileOrder,
	compilePage,
	compileWhere,
	declaredType,
	escapeLike,
	fragment,
	valueType,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { buildCondition as cond } from '../../setup.js'

// Unit tests for the Criteria → SQL compiler: representative operators, the
// LEFT-TO-RIGHT parenthesization that mirrors the engine's matchesCriteria fold
// (NOT SQL precedence), ORDER BY, and LIMIT/OFFSET — asserting both the `sql`
// string and the bound `params`. ORDER BY always ENDS with the primary key so the
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
		{ name: 'id', type: 'text', nullable: false },
		{ name: 'name', type: 'text', nullable: false },
		{ name: 'age', type: 'integer', nullable: false },
		{ name: 'active', type: 'boolean', nullable: false },
		{ name: 'meta', type: 'json', nullable: true },
	],
	indexes: [],
}

function compile(criteria: Criteria): { sql: string; params: readonly unknown[] } {
	const result = compileCriteria(criteria, SCHEMA)
	return { sql: result.sql, params: result.params }
}

describe('compileCriteria — operators', () => {
	it('compiles equals to `= ?` with the encoded operand', () => {
		expect(compile({ conditions: [cond('age', 'equals', [36])] })).toEqual({
			sql: 'WHERE "age" = ? ORDER BY "id"',
			params: [36],
		})
	})

	it('encodes a boolean operand to 1 / 0', () => {
		expect(compile({ conditions: [cond('active', 'equals', [true])] })).toEqual({
			sql: 'WHERE "active" = ? ORDER BY "id"',
			params: [1],
		})
	})

	it('compiles not to `(!= ? OR IS NULL)` — a missing column ranks below every scalar', () => {
		// The engine's `compareValues(undefined, 36) !== 0` matches an absent/NULL
		// column too, so `not` must also match the `IS NULL` row — SQL's raw
		// `!= ?` alone would exclude it (NULL comparisons are never true).
		expect(compile({ conditions: [cond('age', 'not', [36])] })).toEqual({
			sql: 'WHERE ("age" != ? OR "age" IS NULL) ORDER BY "id"',
			params: [36],
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
			params: [18],
		})
		expect(compile({ conditions: [cond('age', 'to', [18])] })).toEqual({
			sql: 'WHERE ("age" <= ? OR "age" IS NULL) ORDER BY "id"',
			params: [18],
		})
	})

	it('compiles a flat not(null) to the constant 1 (matches every row)', () => {
		// A flat column's decoded value is never a present null (NULL decodes to
		// absent), so `compareValues(value, null)` is nonzero for every row —
		// `not null` matches unconditionally, which no `!= ? OR IS NULL` shape
		// can express (it would only match the IS NULL row).
		expect(compile({ conditions: [cond('age', 'not', [null])] })).toEqual({
			sql: 'WHERE 1 ORDER BY "id"',
			params: [],
		})
	})

	it('compiles between to BETWEEN ? AND ?', () => {
		expect(compile({ conditions: [cond('age', 'between', [18, 65])] })).toEqual({
			sql: 'WHERE "age" BETWEEN ? AND ? ORDER BY "id"',
			params: [18, 65],
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
			params: ['A_d%'],
		})
	})

	it('compiles ends to a case-sensitive substr(col, -N) = ? check', () => {
		expect(compile({ conditions: [cond('name', 'ends', ['x'])] })).toEqual({
			sql: 'WHERE (typeof("name") = \'text\' AND substr("name", -1) = ?) ORDER BY "id"',
			params: ['x'],
		})
	})

	it('compiles an empty-string starts / ends operand to a bare text-typeof check', () => {
		// The engine: every string cell starts with / ends with ''.
		expect(compile({ conditions: [cond('name', 'starts', [''])] })).toEqual({
			sql: 'WHERE typeof("name") = \'text\' ORDER BY "id"',
			params: [],
		})
		expect(compile({ conditions: [cond('name', 'ends', [''])] })).toEqual({
			sql: 'WHERE typeof("name") = \'text\' ORDER BY "id"',
			params: [],
		})
	})

	it('compiles a non-empty any to IN (?, ?)', () => {
		expect(compile({ conditions: [cond('id', 'any', ['u1', 'u2'])] })).toEqual({
			sql: 'WHERE "id" IN (?, ?) ORDER BY "id"',
			params: ['u1', 'u2'],
		})
	})

	it('collapses an empty any to the constant 0 (matches nothing)', () => {
		expect(compile({ conditions: [cond('id', 'any', [])] })).toEqual({
			sql: 'WHERE 0 ORDER BY "id"',
			params: [],
		})
	})

	it('compiles a non-empty none to `(NOT IN (?, ?) OR IS NULL)`', () => {
		// An absent/NULL column never rank-equals a listed scalar, so the engine's
		// `none` matches it too — plain `NOT IN` alone would exclude it (SQL's
		// three-valued `NULL NOT IN (...)` is never true).
		expect(compile({ conditions: [cond('id', 'none', ['u1', 'u2'])] })).toEqual({
			sql: 'WHERE ("id" NOT IN (?, ?) OR "id" IS NULL) ORDER BY "id"',
			params: ['u1', 'u2'],
		})
	})

	it('collapses an empty none to the constant 1 (matches all)', () => {
		expect(compile({ conditions: [cond('id', 'none', [])] })).toEqual({
			sql: 'WHERE 1 ORDER BY "id"',
			params: [],
		})
	})

	it('compiles absent to IS NULL with no params', () => {
		expect(compile({ conditions: [cond('meta', 'absent', [])] })).toEqual({
			sql: 'WHERE "meta" IS NULL ORDER BY "id"',
			params: [],
		})
	})

	it('compiles present to IS NOT NULL with no params', () => {
		expect(compile({ conditions: [cond('meta', 'present', [])] })).toEqual({
			sql: 'WHERE "meta" IS NOT NULL ORDER BY "id"',
			params: [],
		})
	})

	it('compiles a nested FieldPath to json_extract binding the native scalar', () => {
		// json_extract returns the unquoted native scalar (here the number 9), so the
		// operand binds as `9` — NOT JSON.stringify(9) = '9' (a string), which would
		// match zero rows. This is the operand-encoding fix.
		expect(compile({ conditions: [cond(['meta', 'info', 'score'], 'equals', [9])] })).toEqual({
			sql: 'WHERE json_extract("meta", \'$.info.score\') = ? ORDER BY "id"',
			params: [9],
		})
	})

	it('binds a nested string operand as the raw string (not JSON-quoted)', () => {
		// A nested string operand binds as `green`, not JSON.stringify('green') =
		// '"green"' — json_extract returns the string unquoted.
		expect(compile({ conditions: [cond(['payload', 'tag'], 'equals', ['green'])] })).toEqual({
			sql: 'WHERE json_extract("payload", \'$.tag\') = ? ORDER BY "id"',
			params: ['green'],
		})
	})

	it('binds a nested boolean operand as 1 / 0', () => {
		// A JSON boolean comes back from json_extract as integer 1/0, so `true` binds
		// as `1` — not JSON.stringify(true) = 'true'.
		expect(compile({ conditions: [cond(['payload', 'flag'], 'equals', [true])] })).toEqual({
			sql: 'WHERE json_extract("payload", \'$.flag\') = ? ORDER BY "id"',
			params: [1],
		})
	})

	it("escapes a ' in a nested json-path part (no SQL-literal break-out)", () => {
		// A part with a single quote must be doubled (`x''y`), so a caller-supplied
		// key can't terminate the json-path string literal and inject SQL. The
		// operand binds as the raw string `v` (the native json_extract scalar).
		expect(compile({ conditions: [cond(['meta', "x'y"], 'equals', ['v'])] })).toEqual({
			sql: 'WHERE json_extract("meta", \'$.x\'\'y\') = ? ORDER BY "id"',
			params: ['v'],
		})
	})

	it("compiles a nested equals(null) to json_type = 'null' (present-null only)", () => {
		// json_extract collapses BOTH a present JSON `null` AND an absent path to SQL
		// `NULL` — indistinguishable. json_type disambiguates: `'null'` only for a
		// present JSON null, matching the engine's `compareValues(null, null) === 0`
		// (absent decodes to `undefined`, which does NOT equal `null`).
		expect(compile({ conditions: [cond(['meta', 'note'], 'equals', [null])] })).toEqual({
			sql: 'WHERE json_type("meta", \'$.note\') = \'null\' ORDER BY "id"',
			params: [],
		})
	})

	it("compiles a nested not(null) to (json_type IS NULL OR json_type != 'null')", () => {
		// Matches absent (json_type IS NULL) or present-scalar (json_type != 'null');
		// excludes only a present JSON null — matching the engine's
		// `compareValues(value, null) !== 0`.
		expect(compile({ conditions: [cond(['meta', 'note'], 'not', [null])] })).toEqual({
			sql: 'WHERE (json_type("meta", \'$.note\') IS NULL OR json_type("meta", \'$.note\') != \'null\') ORDER BY "id"',
			params: [],
		})
	})

	it('compiles a nested below to `(< ? OR json_extract IS NULL)` — absent and present-null both match', () => {
		// json_extract collapses BOTH absent and present-null to SQL NULL, so one
		// `IS NULL` clause catches both — matching the engine, where both an
		// undefined (rank 0) and a null (rank 1) nested value rank below any scalar.
		expect(compile({ conditions: [cond(['meta', 'score'], 'below', [18])] })).toEqual({
			sql: 'WHERE (json_extract("meta", \'$.score\') < ? OR json_extract("meta", \'$.score\') IS NULL) ORDER BY "id"',
			params: [18],
		})
	})

	it('compiles a nested none to `(NOT IN (...) OR json_extract IS NULL)`', () => {
		expect(compile({ conditions: [cond(['meta', 'tag'], 'none', ['a', 'b'])] })).toEqual({
			sql: 'WHERE (json_extract("meta", \'$.tag\') NOT IN (?, ?) OR json_extract("meta", \'$.tag\') IS NULL) ORDER BY "id"',
			params: ['a', 'b'],
		})
	})

	it('leaves a FLAT equals(null) as `= ?` binding [null] (nested-only fix)', () => {
		// A flat column with a null operand is unchanged: encodeValue(null) is NULL,
		// and a null flat column decodes to absent, so `= NULL` and the engine already
		// agree (both match nothing). Applying IS NULL here would be a new divergence.
		expect(compile({ conditions: [cond('meta', 'equals', [null])] })).toEqual({
			sql: 'WHERE "meta" = ? ORDER BY "id"',
			params: [null],
		})
	})
})

describe('compileCriteria — parenthesization', () => {
	it('folds a 3-condition and/or mix left-to-right (not SQL precedence)', () => {
		const criteria: Criteria = {
			conditions: [
				cond('age', 'from', [18]),
				cond('name', 'starts', ['A'], 'or'),
				cond('active', 'equals', [true], 'and'),
			],
		}
		// (((age >= ? OR starts(name)) AND active = ?)) — the fold wraps each step,
		// matching the engine's left-to-right matchesCriteria (NOT SQL precedence).
		expect(compile(criteria)).toEqual({
			sql: 'WHERE (("age" >= ? OR (typeof("name") = \'text\' AND substr("name", 1, 1) = ?)) AND "active" = ?) ORDER BY "id"',
			params: [18, 'A', 1],
		})
	})

	it('ignores the first condition connector', () => {
		const criteria: Criteria = {
			conditions: [cond('age', 'from', [18], 'or'), cond('active', 'equals', [true], 'and')],
		}
		expect(compile(criteria).sql).toBe('WHERE ("age" >= ? AND "active" = ?) ORDER BY "id"')
	})
})

describe('compileCriteria — order and paging', () => {
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
		).toEqual({ sql: 'ORDER BY "age" DESC, "name" ASC, "id"', params: [] })
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
		).toEqual({ sql: 'ORDER BY "age" ASC, "id" DESC', params: [] })
	})

	it('appends the primary tie-breaker to a single explicit non-primary term', () => {
		// A lone explicit term that is not the primary still gets `, "id"` appended.
		expect(compile({ order: [{ column: 'age', direction: 'ascending' }] })).toEqual({
			sql: 'ORDER BY "age" ASC, "id"',
			params: [],
		})
	})

	it('compiles LIMIT then OFFSET when both present (with the default key order)', () => {
		expect(compile({ limit: 10, offset: 5 })).toEqual({
			sql: 'ORDER BY "id" LIMIT ? OFFSET ?',
			params: [10, 5],
		})
	})

	it('compiles LIMIT alone (with the default key order)', () => {
		expect(compile({ limit: 10 })).toEqual({ sql: 'ORDER BY "id" LIMIT ?', params: [10] })
	})

	it('compiles offset-only to LIMIT -1 OFFSET ? (with the default key order)', () => {
		expect(compile({ offset: 5 })).toEqual({
			sql: 'ORDER BY "id" LIMIT -1 OFFSET ?',
			params: [5],
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
			params: [18, 5, 2],
		})
	})

	it('defaults an unordered criteria to ORDER BY the primary key (key order)', () => {
		// No explicit order → the compiler appends ORDER BY "<primary>", so the native
		// records read yields rows in key order, matching a primary-key-ordered `scan`
		// and the core engine over an unordered scan (the parity safety net depends
		// on this).
		expect(compile({})).toEqual({ sql: 'ORDER BY "id"', params: [] })
	})

	it('compiles an undefined criteria to the same default key order', () => {
		expect(compileCriteria(undefined, SCHEMA)).toEqual({ sql: 'ORDER BY "id"', params: [] })
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

describe('declaredType', () => {
	it('returns the declared storage type of a known column', () => {
		expect(declaredType('age', SCHEMA)).toBe('integer')
		expect(declaredType('meta', SCHEMA)).toBe('json')
	})

	it('returns undefined for a column the schema does not carry', () => {
		expect(declaredType('missing', SCHEMA)).toBeUndefined()
	})
})

describe('valueType', () => {
	it('maps a boolean to boolean', () => {
		expect(valueType(true)).toBe('boolean')
		expect(valueType(false)).toBe('boolean')
	})

	it('maps an integer number to integer and a fractional number to real', () => {
		expect(valueType(9)).toBe('integer')
		expect(valueType(1.5)).toBe('real')
	})

	it('maps a bigint to integer', () => {
		expect(valueType(7n)).toBe('integer')
	})

	it('maps an object / array to json', () => {
		expect(valueType({ a: 1 })).toBe('json')
		expect(valueType([1, 2])).toBe('json')
	})

	it('maps a string, null, and undefined to text', () => {
		expect(valueType('hi')).toBe('text')
		expect(valueType(null)).toBe('text')
		expect(valueType(undefined)).toBe('text')
	})
})

describe('fragment', () => {
	it('builds a flat equals fragment encoding the operand by its declared type', () => {
		// A flat `boolean` column encodes its operand to 1 / 0 via the declared type.
		expect(fragment(cond('active', 'equals', [true]), SCHEMA)).toEqual({
			sql: '"active" = ?',
			params: [1],
		})
	})

	it('builds a BETWEEN fragment binding both operands', () => {
		expect(fragment(cond('age', 'between', [18, 65]), SCHEMA)).toEqual({
			sql: '"age" BETWEEN ? AND ?',
			params: [18, 65],
		})
	})

	it('builds a case-sensitive starts fragment (substr(col, 1, N) = ?)', () => {
		expect(fragment(cond('name', 'starts', ['A_d%']), SCHEMA)).toEqual({
			sql: '(typeof("name") = \'text\' AND substr("name", 1, 4) = ?)',
			params: ['A_d%'],
		})
	})

	it('collapses an empty any to the constant 0 with no params', () => {
		expect(fragment(cond('id', 'any', []), SCHEMA)).toEqual({ sql: '0', params: [] })
	})

	it('collapses an empty none to the constant 1 with no params', () => {
		expect(fragment(cond('id', 'none', []), SCHEMA)).toEqual({ sql: '1', params: [] })
	})

	it("compiles a nested null equals to json_type = 'null' with no bound param", () => {
		// A nested (json_extract) field with a null operand under equals compiles
		// through json_type — 'null' means present-JSON-null, distinguishing it
		// from an absent path (which json_extract alone cannot tell apart).
		expect(fragment(cond(['meta', 'note'], 'equals', [null]), SCHEMA)).toEqual({
			sql: "json_type(\"meta\", '$.note') = 'null'",
			params: [],
		})
	})

	it('encodes a nested operand as the native json_extract scalar (not JSON-quoted)', () => {
		// A nested string operand binds raw (`green`), not JSON.stringify('green').
		expect(fragment(cond(['meta', 'tag'], 'equals', ['green']), SCHEMA)).toEqual({
			sql: 'json_extract("meta", \'$.tag\') = ?',
			params: ['green'],
		})
	})
})

describe('compileWhere', () => {
	it('returns an empty clause and no params for zero conditions', () => {
		expect(compileWhere([], SCHEMA)).toEqual({ sql: '', params: [] })
	})

	it('builds a single-condition WHERE with no wrapping parens', () => {
		expect(compileWhere([cond('age', 'from', [18])], SCHEMA)).toEqual({
			sql: 'WHERE "age" >= ?',
			params: [18],
		})
	})

	it('folds multiple conditions left-to-right, ignoring the first connector', () => {
		// Each step wraps the running clause — matching the engine's matchesCriteria
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
			params: [18, 'A', 1],
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
		expect(compilePage(10, 5)).toEqual({ sql: 'LIMIT ? OFFSET ?', params: [10, 5] })
	})

	it('compiles LIMIT alone', () => {
		expect(compilePage(10, undefined)).toEqual({ sql: 'LIMIT ?', params: [10] })
	})

	it('compiles an offset without a limit to LIMIT -1 OFFSET ?', () => {
		// SQLite needs a LIMIT for OFFSET to apply; -1 means "no limit".
		expect(compilePage(undefined, 5)).toEqual({ sql: 'LIMIT -1 OFFSET ?', params: [5] })
	})

	it('returns an empty clause when neither limit nor offset is set', () => {
		expect(compilePage(undefined, undefined)).toEqual({ sql: '', params: [] })
	})
})
