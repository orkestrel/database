import { INDEXED_SCHEMA } from '../../setupServer.js'
import { COMPILER_SCHEMA as SCHEMA, compile } from '../../setupServer.js'
import type { QueryInput, TableSchema } from '@src/core'
import {
	compileAggregateSQL,
	compileBoundSQL,
	compileColumnSQL,
	compileFieldSQL,
	compileQuerySQL,
	compileOrderSQL,
	compilePageSQL,
	compileWhereSQL,
	compileConditionSQL,
	compileGuardedSQL,
	compileInsertSQL,
	compileJoinedSQL,
	compileJSONAccessSQL,
	compileJSONPathSQL,
	compileJSONTypeSQL,
	compileNestedSQL,
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
// and the core engine's stable sort over a key-ordered scan — native ↔ engine
// parity: with no explicit order it is the sole `ORDER BY
// "<primary>"` (here `"id"`); an explicit order appends `, "<primary>"` (ASC) as
// the final tie-break determinant — unless the primary is already one of the
// explicit terms.

describe('SQL declaration compilers', () => {
	it('binds declared JSON operands and nested scalar operands independently', () => {
		expect(compileBoundSQL('?', [true], true, undefined)).toEqual({
			sql: '?',
			parameters: [1],
		})
		expect(
			compileBoundSQL('?', [{ value: 1 }], false, {
				name: 'payload',
				storage: 'json',
				optional: false,
				nullable: false,
			}),
		).toEqual({ sql: '?', parameters: ['{"value":1}'] })
	})

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
			'json_extract(CASE WHEN typeof("payload") = \'text\' THEN "payload" END, \'$."user"."id"\')',
		)
		expect(compileFieldSQL(['payload', "a'b", 'c.d'])).toBe(
			'json_extract(CASE WHEN typeof("payload") = \'text\' THEN "payload" END, \'$."a\'\'b"."c.d"\')',
		)
		expect(compileJSONAccessSQL(['payload'])).toBe(
			'CASE WHEN typeof("payload") = \'text\' THEN "payload" END, \'$\'',
		)
		expect(() => compileJSONAccessSQL([])).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
	})

	it('quotes each path key as one object member label', () => {
		expect(compileJSONPathSQL([])).toBe("'$'")
		expect(compileJSONPathSQL(['a.b', 'c d', '0'])).toBe('\'$."a.b"."c d"."0"\'')
		expect(compileJSONPathSQL(['a"b', 'c\\d'])).toBe('\'$."a\\"b"."c\\\\d"\'')
	})

	it('compiles every aggregate, a sum as TOTAL with NULL over no value', () => {
		expect(compileAggregateSQL('count', 'age')).toBe('COUNT(*)')
		expect(compileAggregateSQL('sum', 'age')).toBe(
			'CASE WHEN COUNT("age") = 0 THEN NULL ELSE TOTAL("age") END',
		)
		expect(compileAggregateSQL('average', 'age')).toBe('AVG("age")')
		expect(compileAggregateSQL('minimum', 'age')).toBe('MIN("age")')
		expect(compileAggregateSQL('maximum', 'age')).toBe('MAX("age")')
		expect(compileAggregateSQL('maximum', ['payload', 'score'])).toBe(
			'MAX(json_extract(CASE WHEN typeof("payload") = \'text\' THEN "payload" END, \'$."score"\'))',
		)
	})
})

describe('schema and migration compilers', () => {
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

describe('compileQuerySQL — operators', () => {
	it('compiles equals to `= ?` with the encoded operand', () => {
		expect(compile({ conditions: [cond('age', 'equals', [36])] })).toEqual({
			sql: 'WHERE "age" = ? ORDER BY "id" ASC',
			parameters: [36],
		})
	})

	it('encodes a boolean operand to 1 / 0', () => {
		expect(compile({ conditions: [cond('active', 'equals', [true])] })).toEqual({
			sql: 'WHERE "active" = ? ORDER BY "id" ASC',
			parameters: [1],
		})
	})

	it('compiles not to `(!= ? OR IS NULL)` — a missing column ranks below every scalar', () => {
		// The engine's `compareValues(undefined, 36) !== 0` matches an absent/NULL
		// column too, so `not` must also match the `IS NULL` row — SQL's raw
		// `!= ?` alone would exclude it (NULL comparisons are never true).
		expect(compile({ conditions: [cond('age', 'not', [36])] })).toEqual({
			sql: 'WHERE ("age" != ? OR "age" IS NULL) ORDER BY "id" ASC',
			parameters: [36],
		})
	})

	it('compiles above / from to raw > / >= (a NULL column never matches)', () => {
		expect(compile({ conditions: [cond('age', 'above', [18])] }).sql).toBe(
			'WHERE "age" > ? ORDER BY "id" ASC',
		)
		expect(compile({ conditions: [cond('age', 'from', [18])] }).sql).toBe(
			'WHERE "age" >= ? ORDER BY "id" ASC',
		)
	})

	it('compiles below / to to `(< / <= ? OR IS NULL)` — a missing column ranks below every scalar', () => {
		// The engine's `compareValues(undefined, 18) < 0` matches an absent/NULL
		// column (rank 0 < any scalar's rank), so `below` / `to` must match it too.
		expect(compile({ conditions: [cond('age', 'below', [18])] })).toEqual({
			sql: 'WHERE ("age" < ? OR "age" IS NULL) ORDER BY "id" ASC',
			parameters: [18],
		})
		expect(compile({ conditions: [cond('age', 'to', [18])] })).toEqual({
			sql: 'WHERE ("age" <= ? OR "age" IS NULL) ORDER BY "id" ASC',
			parameters: [18],
		})
	})

	it('compiles a flat not(null) to the constant 1 (matches every row)', () => {
		// A flat column's decoded value is never a present null (NULL decodes to
		// absent), so `compareValues(value, null)` is nonzero for every row —
		// `not null` matches unconditionally, which no `!= ? OR IS NULL` shape
		// can express (it would only match the IS NULL row).
		expect(compile({ conditions: [cond('age', 'not', [null])] })).toEqual({
			sql: 'WHERE 1 ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles between to BETWEEN ? AND ?', () => {
		expect(compile({ conditions: [cond('age', 'between', [18, 65])] })).toEqual({
			sql: 'WHERE "age" BETWEEN ? AND ? ORDER BY "id" ASC',
			parameters: [18, 65],
		})
	})

	it('compiles like and glob to their raw operators', () => {
		expect(compile({ conditions: [cond('name', 'like', ['A%'])] }).sql).toBe(
			'WHERE "name" LIKE ? ORDER BY "id" ASC',
		)
		expect(compile({ conditions: [cond('name', 'glob', ['A*'])] }).sql).toBe(
			'WHERE "name" GLOB ? ORDER BY "id" ASC',
		)
	})

	it('compiles starts to the index range >= prefix AND < successor', () => {
		expect(compile({ conditions: [cond('name', 'starts', ['A_d%'])] })).toEqual({
			sql: 'WHERE ("name" >= ? AND "name" < ?) ORDER BY "id" ASC',
			parameters: ['A_d%', 'A_d&'],
		})
	})

	it('compiles starts on a prefix of U+10FFFF alone to an open range over text', () => {
		expect(compile({ conditions: [cond('name', 'starts', ['\u{10FFFF}'])] })).toEqual({
			sql: 'WHERE (typeof("name") = \'text\' AND "name" >= ?) ORDER BY "id" ASC',
			parameters: ['\u{10FFFF}'],
		})
	})

	it('compiles ends to a case-sensitive substr(col, -N) = ? check', () => {
		expect(compile({ conditions: [cond('name', 'ends', ['x'])] })).toEqual({
			sql: 'WHERE (typeof("name") = \'text\' AND substr("name", -1) = ?) ORDER BY "id" ASC',
			parameters: ['x'],
		})
	})

	it('compiles an empty-string starts / ends operand to a bare text-typeof check', () => {
		// The engine: every string cell starts with / ends with ''.
		expect(compile({ conditions: [cond('name', 'starts', [''])] })).toEqual({
			sql: 'WHERE typeof("name") = \'text\' ORDER BY "id" ASC',
			parameters: [],
		})
		expect(compile({ conditions: [cond('name', 'ends', [''])] })).toEqual({
			sql: 'WHERE typeof("name") = \'text\' ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles a non-empty any to one json_each parameter', () => {
		expect(compile({ conditions: [cond('id', 'any', ['u1', 'u2'])] })).toEqual({
			sql: 'WHERE "id" IN (SELECT value FROM json_each(?)) ORDER BY "id" ASC',
			parameters: ['["u1","u2"]'],
		})
	})

	it('encodes a boolean list in its stored form', () => {
		expect(compile({ conditions: [cond('active', 'any', [true, false])] })).toEqual({
			sql: 'WHERE "active" IN (SELECT value FROM json_each(?)) ORDER BY "id" ASC',
			parameters: ['[1,0]'],
		})
	})

	it('collapses an empty any to the constant 0 (matches nothing)', () => {
		expect(compile({ conditions: [cond('id', 'any', [])] })).toEqual({
			sql: 'WHERE 0 ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles a non-empty none to NOT IN json_each OR IS NULL', () => {
		expect(compile({ conditions: [cond('id', 'none', ['u1', 'u2'])] })).toEqual({
			sql: 'WHERE ("id" NOT IN (SELECT value FROM json_each(?)) OR "id" IS NULL) ORDER BY "id" ASC',
			parameters: ['["u1","u2"]'],
		})
	})

	it('collapses an empty none to the constant 1 (matches all)', () => {
		expect(compile({ conditions: [cond('id', 'none', [])] })).toEqual({
			sql: 'WHERE 1 ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles absent to IS NULL with no parameters', () => {
		expect(compile({ conditions: [cond('meta', 'absent', [])] })).toEqual({
			sql: 'WHERE "meta" IS NULL ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles present to IS NOT NULL with no parameters', () => {
		expect(compile({ conditions: [cond('meta', 'present', [])] })).toEqual({
			sql: 'WHERE "meta" IS NOT NULL ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles a nested number equals to its JSON type beside a listed value', () => {
		// A listed number passes through the same JSON parser as the stored one.
		expect(compile({ conditions: [cond(['meta', 'info', 'score'], 'equals', [9])] })).toEqual({
			sql: 'WHERE (json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."info"."score"\') IN (\'integer\', \'real\') AND json_extract(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."info"."score"\') IN (SELECT value FROM json_each(?))) ORDER BY "id" ASC',
			parameters: ['[9]'],
		})
	})

	it('compiles a nested string equals to its JSON type beside a listed value', () => {
		expect(compile({ conditions: [cond(['meta', 'tag'], 'equals', ['green'])] })).toEqual({
			sql: 'WHERE (json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."tag"\') = \'text\' AND json_extract(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."tag"\') IN (SELECT value FROM json_each(?))) ORDER BY "id" ASC',
			parameters: ['["green"]'],
		})
	})

	it('compiles a nested boolean equals to its JSON type alone', () => {
		// A JSON true reads back as the integer 1, which a number 1 also reads back as.
		expect(compile({ conditions: [cond(['meta', 'flag'], 'equals', [true])] })).toEqual({
			sql: 'WHERE json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."flag"\') = \'true\' ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it("doubles a ' in a nested path label (no SQL-literal break-out)", () => {
		expect(compile({ conditions: [cond(['meta', "x'y"], 'equals', [null])] })).toEqual({
			sql: 'WHERE json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."x\'\'y"\') = \'null\' ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles a nested equals(undefined) to a NULL json_type, apart from equals(null)', () => {
		// json_extract reads both a present JSON null and an absent path as SQL NULL; json_type
		// reads 'null' for the first and NULL for the second.
		expect(compile({ conditions: [cond(['meta', 'note'], 'equals', [undefined])] })).toEqual({
			sql: 'WHERE json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."note"\') IS NULL ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles a nested not(null) to the negated membership with NULL read as no match', () => {
		expect(compile({ conditions: [cond(['meta', 'note'], 'not', [null])] })).toEqual({
			sql: 'WHERE NOT COALESCE(json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."note"\') = \'null\', 0) ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('compiles a nested below to `(< ? OR json_extract IS NULL)` — absent and present-null both match', () => {
		// json_extract collapses BOTH absent and present-null to SQL NULL, so one
		// `IS NULL` clause catches both — matching the engine, where both an
		// undefined (rank 0) and a null (rank 1) nested value rank below any scalar.
		expect(compile({ conditions: [cond(['meta', 'score'], 'below', [18])] })).toEqual({
			sql: 'WHERE (json_extract(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."score"\') < ? OR json_extract(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."score"\') IS NULL) ORDER BY "id" ASC',
			parameters: [18],
		})
	})

	it('compiles a nested any and none over every scalar class, one term per class', () => {
		const type = 'json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."tag"\')'
		const value = 'json_extract(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."tag"\')'
		const member = `((${type} = 'text' AND ${value} IN (SELECT value FROM json_each(?))) OR (${type} IN ('integer', 'real') AND ${value} IN (SELECT value FROM json_each(?))) OR ${type} = 'false' OR ${type} = 'null' OR ${type} IS NULL)`
		const values = ['a', 1, false, null, undefined, 'b', 2.5]
		expect(compile({ conditions: [cond(['meta', 'tag'], 'any', values)] })).toEqual({
			sql: `WHERE ${member} ORDER BY "id" ASC`,
			parameters: ['["a","b"]', '[1,2.5]'],
		})
		expect(compile({ conditions: [cond(['meta', 'tag'], 'none', values)] })).toEqual({
			sql: `WHERE NOT COALESCE(${member}, 0) ORDER BY "id" ASC`,
			parameters: ['["a","b"]', '[1,2.5]'],
		})
		expect(compile({ conditions: [cond(['meta', 'tag'], 'any', [])] }).sql).toBe(
			'WHERE 0 ORDER BY "id" ASC',
		)
		expect(compile({ conditions: [cond(['meta', 'tag'], 'none', [])] }).sql).toBe(
			'WHERE NOT COALESCE(0, 0) ORDER BY "id" ASC',
		)
	})

	it("reads a nested path through a head guarded to text, whatever the head's flags", () => {
		expect(compileNestedSQL(cond(['meta', 'flag'], 'equals', [true]))).toEqual({
			sql: 'json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."flag"\') = \'true\'',
			parameters: [],
		})
		expect(compileJSONTypeSQL(['meta', 'a.b'])).toBe(
			'json_type(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."a.b"\')',
		)
	})

	it('compiles a flat equals(null) and not(null) by the column flags', () => {
		expect(compile({ conditions: [cond('meta', 'equals', [null])] })).toEqual({
			sql: 'WHERE "meta" IS NULL ORDER BY "id" ASC',
			parameters: [],
		})
		expect(compile({ conditions: [cond('age', 'equals', [null])] })).toEqual({
			sql: 'WHERE 0 ORDER BY "id" ASC',
			parameters: [],
		})
		expect(compile({ conditions: [cond('meta', 'not', [null])] })).toEqual({
			sql: 'WHERE "meta" IS NOT NULL ORDER BY "id" ASC',
			parameters: [],
		})
	})

	it('reads the sentinel of a column that is both optional and nullable', () => {
		const both: TableSchema = {
			...SCHEMA,
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'bio', storage: 'text', optional: true, nullable: true },
				{ name: 'rank', storage: 'integer', optional: true, nullable: true },
			],
		}
		expect(compileConditionSQL(cond('bio', 'equals', [null]), both)).toEqual({
			sql: 'typeof("bio") = \'blob\'',
			parameters: [],
		})
		expect(compileConditionSQL(cond('rank', 'above', [1]), both)).toEqual({
			sql: '("rank" > ? AND typeof("rank") != \'text\')',
			parameters: [1],
		})
		expect(compileConditionSQL(cond('rank', 'below', [1]), both)).toEqual({
			sql: '("rank" < ? OR ("rank" IS NULL OR typeof("rank") = \'text\'))',
			parameters: [1],
		})
		expect(compileConditionSQL(cond('bio', 'like', ['a%']), both)).toEqual({
			sql: '("bio" LIKE ? AND typeof("bio") = \'text\')',
			parameters: ['a%'],
		})
	})

	it('compiles undefined operands and lists holding null or undefined by the column flags', () => {
		const both: TableSchema = {
			...SCHEMA,
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'rank', storage: 'integer', optional: true, nullable: true },
			],
		}
		expect(compileConditionSQL(cond('rank', 'equals', [undefined]), both).sql).toBe(
			'"rank" IS NULL',
		)
		expect(compileConditionSQL(cond('rank', 'not', [undefined]), both).sql).toBe(
			'"rank" IS NOT NULL',
		)
		expect(compileConditionSQL(cond('age', 'equals', [undefined]), SCHEMA).sql).toBe('0')
		expect(compileConditionSQL(cond('rank', 'any', [1, null, undefined]), both)).toEqual({
			sql: '("rank" IN (SELECT value FROM json_each(?)) OR typeof("rank") = \'text\' OR "rank" IS NULL)',
			parameters: ['[1]'],
		})
		expect(compileConditionSQL(cond('rank', 'none', [1, null]), both)).toEqual({
			sql: '(("rank" NOT IN (SELECT value FROM json_each(?)) OR "rank" IS NULL) AND NOT typeof("rank") = \'text\')',
			parameters: ['[1]'],
		})
		expect(compileConditionSQL(cond('age', 'any', [null]), SCHEMA).sql).toBe('0')
		expect(compileConditionSQL(cond('age', 'none', [null]), SCHEMA).sql).toBe('1')
	})

	it('escapes a glob class bracket, which the core reads literally', () => {
		expect(compileConditionSQL(cond('name', 'glob', ['a[b]*']), SCHEMA)).toEqual({
			sql: '"name" GLOB ?',
			parameters: ['a[[]b]*'],
		})
	})

	it('pins every other condition and the order behind an any on the primary key', () => {
		expect(
			compile({
				conditions: [cond('id', 'any', ['u1']), cond('age', 'equals', [36])],
				order: [{ column: 'age', direction: 'descending' }],
			}),
		).toEqual({
			sql: 'WHERE ("id" IN (SELECT value FROM json_each(?)) AND +"age" = ?) ORDER BY +"age" DESC, "id" DESC',
			parameters: ['["u1"]', 36],
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
			sql: 'WHERE (("age" >= ? OR ("name" >= ? AND "name" < ?)) AND "active" = ?) ORDER BY "id" ASC',
			parameters: [18, 'A', 'B', 1],
		})
	})

	it('ignores the first condition connector', () => {
		const input: QueryInput = {
			conditions: [cond('age', 'from', [18], 'or'), cond('active', 'equals', [true], 'and')],
		}
		expect(compile(input).sql).toBe('WHERE ("age" >= ? AND "active" = ?) ORDER BY "id" ASC')
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
		).toEqual({ sql: 'ORDER BY "age" DESC, "name" ASC, "id" ASC', parameters: [] })
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
			sql: 'ORDER BY "age" ASC, "id" ASC',
			parameters: [],
		})
	})

	it('compiles LIMIT then OFFSET when both present (with the default key order)', () => {
		expect(compile({ limit: 10, offset: 5 })).toEqual({
			sql: 'ORDER BY "id" ASC LIMIT ? OFFSET ?',
			parameters: [10, 5],
		})
	})

	it('compiles LIMIT alone (with the default key order)', () => {
		expect(compile({ limit: 10 })).toEqual({ sql: 'ORDER BY "id" ASC LIMIT ?', parameters: [10] })
	})

	it('compiles offset-only to LIMIT -1 OFFSET ? (with the default key order)', () => {
		expect(compile({ offset: 5 })).toEqual({
			sql: 'ORDER BY "id" ASC LIMIT -1 OFFSET ?',
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
			sql: 'WHERE "age" >= ? ORDER BY "age" ASC, "id" ASC LIMIT ? OFFSET ?',
			parameters: [18, 5, 2],
		})
	})

	it('defaults an unordered input to ORDER BY the primary key (key order)', () => {
		// No explicit order → the compiler appends ORDER BY "<primary>", so the native
		// records read yields rows in key order, matching a primary-key-ordered `scan`
		// and the core engine over an unordered scan (the parity safety net depends
		// on this).
		expect(compile({})).toEqual({ sql: 'ORDER BY "id" ASC', parameters: [] })
	})

	it('compiles an undefined input to the same default key order', () => {
		expect(compileQuerySQL(undefined, SCHEMA)).toEqual({ sql: 'ORDER BY "id" ASC', parameters: [] })
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

describe('compileConditionSQL', () => {
	it('builds a flat equals compileConditionSQL encoding the operand by its declared type', () => {
		// A flat `boolean` column encodes its operand to 1 / 0 through the declared type.
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

	it('builds a starts compileConditionSQL as the index range', () => {
		expect(compileConditionSQL(cond('name', 'starts', ['A_d%']), SCHEMA)).toEqual({
			sql: '("name" >= ? AND "name" < ?)',
			parameters: ['A_d%', 'A_d&'],
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

	it('routes a nested equality-family condition to the nested compiler, pinned or not', () => {
		for (const operator of ['equals', 'not', 'any', 'none'] as const) {
			const condition = cond(['meta', 'note'], operator, [null])
			expect(compileConditionSQL(condition, SCHEMA, true)).toEqual(compileNestedSQL(condition))
		}
	})

	it('compares a nested object operand as the JSON text of its value', () => {
		expect(compileConditionSQL(cond(['meta', 'tag'], 'equals', [{ a: 1 }]), SCHEMA)).toEqual({
			sql: 'json_extract(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."tag"\') = ?',
			parameters: ['{"a":1}'],
		})
	})
})

describe('compileWhereSQL', () => {
	it('returns an empty clause and no parameters for zero conditions', () => {
		expect(compileWhereSQL([], SCHEMA)).toEqual({ sql: '', parameters: [] })
	})

	it('builds a single-condition WHERE with no wrapping parens', () => {
		expect(compileWhereSQL([cond('age', 'from', [18])], SCHEMA)).toEqual({
			sql: 'WHERE "age" >= ?',
			parameters: [18],
		})
	})

	it('folds multiple conditions left-to-right, ignoring the first connector', () => {
		// Each step wraps the running clause — matching the engine's matchesQuery
		// fold, NOT SQL's AND-over-OR precedence; the first connector is dropped.
		expect(
			compileWhereSQL(
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

describe('compileOrderSQL', () => {
	it('returns ORDER BY the primary key alone for an undefined order', () => {
		expect(compileOrderSQL(undefined, SCHEMA)).toBe('ORDER BY "id" ASC')
	})

	it('appends the primary key (ASC) as the tie-breaker after explicit non-primary terms', () => {
		expect(
			compileOrderSQL(
				[
					{ column: 'age', direction: 'descending' },
					{ column: 'name', direction: 'ascending' },
				],
				SCHEMA,
			),
		).toBe('ORDER BY "age" DESC, "name" ASC, "id" ASC')
	})

	it('does not double-append when an explicit term is already the primary', () => {
		expect(compileOrderSQL([{ column: 'id', direction: 'descending' }], SCHEMA)).toBe(
			'ORDER BY "id" DESC',
		)
	})

	it('ranks absence, then null, then values ahead of a column with both flags, in its direction', () => {
		const schema: TableSchema = {
			...SCHEMA,
			columns: [
				...SCHEMA.columns,
				{ name: 'note', storage: 'text', optional: true, nullable: true },
				{ name: 'rank', storage: 'integer', optional: true, nullable: true },
			],
		}
		expect(
			compileOrderSQL(
				[
					{ column: 'note', direction: 'descending' },
					{ column: 'rank', direction: 'ascending' },
				],
				schema,
				true,
			),
		).toBe(
			'ORDER BY CASE WHEN "note" IS NULL THEN 0 WHEN typeof("note") = \'blob\' THEN 1 ELSE 2 END DESC, +"note" DESC, ' +
				'CASE WHEN "rank" IS NULL THEN 0 WHEN typeof("rank") = \'text\' THEN 1 ELSE 2 END ASC, +"rank" ASC, "id" ASC',
		)
	})

	it('compiles a nested FieldPath order term to json_extract', () => {
		expect(compileOrderSQL([{ column: ['meta', 'score'], direction: 'ascending' }], SCHEMA)).toBe(
			'ORDER BY json_extract(CASE WHEN typeof("meta") = \'text\' THEN "meta" END, \'$."score"\') ASC, "id" ASC',
		)
	})
})

describe('compilePageSQL', () => {
	it('compiles LIMIT then OFFSET when both are present', () => {
		expect(compilePageSQL(10, 5)).toEqual({ sql: 'LIMIT ? OFFSET ?', parameters: [10, 5] })
	})

	it('compiles LIMIT alone', () => {
		expect(compilePageSQL(10, undefined)).toEqual({ sql: 'LIMIT ?', parameters: [10] })
	})

	it('compiles an offset without a limit to LIMIT -1 OFFSET ?', () => {
		// SQLite needs a LIMIT for OFFSET to apply; -1 means "no limit".
		expect(compilePageSQL(undefined, 5)).toEqual({ sql: 'LIMIT -1 OFFSET ?', parameters: [5] })
	})

	it('returns an empty clause when neither limit nor offset is set', () => {
		expect(compilePageSQL(undefined, undefined)).toEqual({ sql: '', parameters: [] })
	})

	it('rejects invalid direct page values and accepts zero', () => {
		expect(() => compilePageSQL(-1, undefined)).toThrow('Query limit must be a nonnegative integer')
		expect(() => compilePageSQL(undefined, Number.NaN)).toThrow(
			'Query offset must be a nonnegative integer',
		)
		expect(compilePageSQL(0, 0)).toEqual({ sql: 'LIMIT ? OFFSET ?', parameters: [0, 0] })
	})
})

describe('compileJoinedSQL', () => {
	it('returns the constant for no part and the part itself for one', () => {
		expect(compileJoinedSQL([], ' OR ', '0')).toEqual({ sql: '0', parameters: [] })
		expect(compileJoinedSQL([{ sql: '"a" = ?', parameters: [1] }], ' OR ', '0')).toEqual({
			sql: '"a" = ?',
			parameters: [1],
		})
	})

	it('parenthesizes two or more parts and keeps their parameters in order', () => {
		expect(
			compileJoinedSQL(
				[
					{ sql: '"a" = ?', parameters: [1] },
					{ sql: '"b" IS NULL', parameters: [] },
					{ sql: '"c" < ?', parameters: [2] },
				],
				' AND ',
				'1',
			),
		).toEqual({ sql: '("a" = ? AND "b" IS NULL AND "c" < ?)', parameters: [1, 2] })
	})
})

describe('compileGuardedSQL', () => {
	it('leaves a fragment bare without a guard and parenthesizes it with one', () => {
		expect(compileGuardedSQL('"age" > ?', '')).toBe('"age" > ?')
		expect(compileGuardedSQL('"age" > ?', ' AND typeof("age") != \'text\'')).toBe(
			'("age" > ? AND typeof("age") != \'text\')',
		)
	})
})

describe('compileInsertSQL', () => {
	it('binds one parameter per declared column in schema order', () => {
		expect(compileInsertSQL(SCHEMA, true)).toBe(
			'INSERT OR REPLACE INTO "users" ("id", "name", "age", "active", "meta") VALUES (?, ?, ?, ?, ?)',
		)
	})

	it('omits the replace clause for an insert that must refuse an existing key', () => {
		expect(compileInsertSQL(SCHEMA, false)).toBe(
			'INSERT INTO "users" ("id", "name", "age", "active", "meta") VALUES (?, ?, ?, ?, ?)',
		)
	})
})
