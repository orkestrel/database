import type { TableSchema } from '@src/core'
import {
	aggregateSQL,
	columnSQL,
	decodeRow,
	decodeValue,
	encodeRow,
	encodeValue,
	fieldColumn,
	indexName,
	isExactCondition,
	isExactCriteria,
	isExactOrder,
	quote,
	schemaToIndexes,
	schemaToTable,
	stepToSQL,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { buildCondition as cond } from '../../setup.js'

// The SQLite ↔ JS codecs as pure functions (no DB needed, AGENTS §16): the SQL
// identifier / type builders (`columnSQL`, `quote`, `fieldColumn` — including the
// json-path injection escape), the value / row codecs (`encodeValue` /
// `decodeValue` round-trips, `encodeRow` / `decodeRow` over a schema, including
// `decodeRow` omitting an undefined-decoded column), and the DDL projections
// (`schemaToTable` / `schemaToIndexes`). Every codec is total — a value that does
// not fit its column encodes to `null` rather than throwing.

describe('columnSQL', () => {
	it('maps each portable ColumnType to its SQLite type', () => {
		expect(columnSQL('text')).toBe('TEXT')
		expect(columnSQL('json')).toBe('TEXT') // JSON stored as text
		expect(columnSQL('integer')).toBe('INTEGER')
		expect(columnSQL('boolean')).toBe('INTEGER') // boolean stored as 1 / 0
		expect(columnSQL('real')).toBe('REAL')
		expect(columnSQL('blob')).toBe('BLOB')
	})
})

describe('quote', () => {
	it('wraps an identifier in double quotes', () => {
		expect(quote('order')).toBe('"order"')
	})

	it('doubles an embedded double quote', () => {
		expect(quote('a"b')).toBe('"a""b"')
	})
})

describe('fieldColumn', () => {
	it('quotes a single string as one column', () => {
		expect(fieldColumn('payload')).toBe('"payload"')
	})

	it('compiles an array path to json_extract over the quoted column', () => {
		expect(fieldColumn(['payload', 'user', 'id'])).toBe('json_extract("payload", \'$.user.id\')')
	})

	it("escapes a single quote in a path part to '' (no injection)", () => {
		// A path key carrying a quote must not break out of the '$...' string literal.
		expect(fieldColumn(['payload', "a'b"])).toBe("json_extract(\"payload\", '$.a''b')")
	})
})

describe('aggregateSQL', () => {
	it('compiles count to COUNT(*) — all matched rows, not non-null column values', () => {
		// computeAggregate('count') is rows.length, so the SQL must count ROWS.
		expect(aggregateSQL('count', 'age')).toBe('COUNT(*)')
		// The column is irrelevant for count — still COUNT(*).
		expect(aggregateSQL('count', ['payload', 'score'])).toBe('COUNT(*)')
	})

	it('wraps a flat column in SUM / AVG / MIN / MAX', () => {
		expect(aggregateSQL('sum', 'age')).toBe('SUM("age")')
		expect(aggregateSQL('average', 'age')).toBe('AVG("age")')
		expect(aggregateSQL('minimum', 'age')).toBe('MIN("age")')
		expect(aggregateSQL('maximum', 'age')).toBe('MAX("age")')
	})

	it('wraps a nested FieldPath (json_extract) in the aggregate', () => {
		expect(aggregateSQL('sum', ['payload', 'score'])).toBe(
			'SUM(json_extract("payload", \'$.score\'))',
		)
	})
})

describe('encodeValue / decodeValue — round-trips', () => {
	it('round-trips a boolean through 1 / 0', () => {
		expect(encodeValue(true, 'boolean')).toBe(1)
		expect(encodeValue(false, 'boolean')).toBe(0)
		expect(decodeValue(1, 'boolean')).toBe(true)
		expect(decodeValue(0, 'boolean')).toBe(false)
	})

	it('round-trips json through a stringified value', () => {
		const value = { tags: ['a', 'b'], info: { score: 9, ok: true } }
		const encoded = encodeValue(value, 'json')
		expect(encoded).toBe(JSON.stringify(value))
		expect(decodeValue(encoded, 'json')).toEqual(value)
	})

	it('keeps a number / bigint for integer and real, else null', () => {
		expect(encodeValue(36, 'integer')).toBe(36)
		expect(encodeValue(10n, 'integer')).toBe(10n)
		expect(encodeValue(3.5, 'real')).toBe(3.5)
		expect(encodeValue('nope', 'integer')).toBeNull()
		expect(decodeValue(36, 'integer')).toBe(36)
	})

	it('keeps a string for text, else null', () => {
		expect(encodeValue('Ada', 'text')).toBe('Ada')
		expect(encodeValue(36, 'text')).toBeNull()
		expect(decodeValue('Ada', 'text')).toBe('Ada')
	})

	it('keeps a Uint8Array for blob, else null', () => {
		const bytes = new Uint8Array([1, 2, 3])
		expect(encodeValue(bytes, 'blob')).toBe(bytes)
		expect(encodeValue('nope', 'blob')).toBeNull()
		expect(decodeValue(bytes, 'blob')).toBe(bytes)
	})

	it('encodes null / undefined to NULL and decodes a stored NULL to undefined', () => {
		expect(encodeValue(null, 'boolean')).toBeNull()
		expect(encodeValue(undefined, 'json')).toBeNull()
		expect(encodeValue(null, 'text')).toBeNull()
		// NULL decodes to undefined for every type (so decodeRow can omit it).
		expect(decodeValue(null, 'boolean')).toBeUndefined()
		expect(decodeValue(null, 'json')).toBeUndefined()
		expect(decodeValue(null, 'text')).toBeUndefined()
		expect(decodeValue(null, 'integer')).toBeUndefined()
	})
})

describe('encodeRow / decodeRow — over a schema', () => {
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

	it('encodes only the schema columns, dropping extra row keys', () => {
		const encoded = encodeRow(
			{ id: 'u1', name: 'Ada', age: 36, active: true, meta: { k: 1 }, extra: 'x' },
			SCHEMA,
		)
		expect(encoded).toEqual({ id: 'u1', name: 'Ada', age: 36, active: 1, meta: '{"k":1}' })
		expect('extra' in encoded).toBe(false) // not a declared column
	})

	it('encodes an absent column from undefined (stores NULL)', () => {
		const encoded = encodeRow({ id: 'u1', name: 'Ada', age: 36, active: false }, SCHEMA)
		expect(encoded.meta).toBeNull()
	})

	it('decodes a stored row back through the schema', () => {
		const decoded = decodeRow(
			{ id: 'u1', name: 'Ada', age: 36, active: 1, meta: '{"k":1}' },
			SCHEMA,
		)
		expect(decoded).toEqual({ id: 'u1', name: 'Ada', age: 36, active: true, meta: { k: 1 } })
	})

	it('omits a column whose decoded value is undefined (stored NULL)', () => {
		const decoded = decodeRow({ id: 'u1', name: 'Ada', age: 36, active: 0, meta: null }, SCHEMA)
		expect(decoded).toEqual({ id: 'u1', name: 'Ada', age: 36, active: false })
		expect('meta' in decoded).toBe(false) // NULL → undefined → omitted
	})

	it('round-trips a row through encode then decode', () => {
		const row = { id: 'u1', name: 'Ada', age: 36, active: true, meta: { tags: ['x'] } }
		expect(decodeRow(encodeRow(row, SCHEMA), SCHEMA)).toEqual(row)
	})
})

describe('schemaToTable / schemaToIndexes — DDL projections', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', type: 'text', nullable: false },
			{ name: 'name', type: 'text', nullable: false },
			{ name: 'age', type: 'integer', nullable: false },
		],
		indexes: [['name'], ['name', 'age']],
	}

	it('compiles CREATE TABLE IF NOT EXISTS with typed columns and a PRIMARY KEY', () => {
		expect(schemaToTable(SCHEMA)).toBe(
			'CREATE TABLE IF NOT EXISTS "users" ("id" TEXT, "name" TEXT, "age" INTEGER, PRIMARY KEY ("id"))',
		)
	})

	it('compiles one CREATE INDEX IF NOT EXISTS per declared index group (length-prefixed, collision-free name)', () => {
		expect(schemaToIndexes(SCHEMA)).toEqual([
			'CREATE INDEX IF NOT EXISTS "idx_5_users_4_name" ON "users" ("name")',
			'CREATE INDEX IF NOT EXISTS "idx_5_users_4_name_3_age" ON "users" ("name", "age")',
		])
	})

	it('returns an empty list for a table with no declared indexes', () => {
		expect(schemaToIndexes({ ...SCHEMA, indexes: [] })).toEqual([])
	})
})

describe('indexName — collision-free, deterministic', () => {
	it('length-prefixes the table then each column so ambiguous names no longer collide', () => {
		// The naive `idx_<table>_<cols>` scheme collides here: both compile the
		// same joined string ('a_b_c') under the old naming.
		expect(indexName('a_b', ['c'])).toBe('idx_3_a_b_1_c')
		expect(indexName('a', ['b', 'c'])).toBe('idx_1_a_1_b_1_c')
		expect(indexName('a_b', ['c'])).not.toBe(indexName('a', ['b', 'c']))
	})

	it('matches schemaToIndexes and stepToSQL (index.add / index.remove) identically', () => {
		const schema: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [{ name: 'id', type: 'text', nullable: false }],
			indexes: [['name']],
		}
		expect(schemaToIndexes(schema)[0]).toContain(indexName('users', ['name']))
		expect(stepToSQL({ operation: 'index.add', table: 'users', index: ['name'] })[0]).toContain(
			indexName('users', ['name']),
		)
		expect(stepToSQL({ operation: 'index.remove', table: 'users', index: ['name'] })[0]).toContain(
			indexName('users', ['name']),
		)
	})
})

describe('isExactCondition', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', type: 'text', nullable: false },
			{ name: 'name', type: 'text', nullable: false },
			{ name: 'age', type: 'integer', nullable: true },
			{ name: 'active', type: 'boolean', nullable: true },
			{ name: 'meta', type: 'json', nullable: true },
		],
		indexes: [],
	}

	it('is false for a nested FieldPath (array column)', () => {
		expect(isExactCondition(cond(['meta', 'score'], 'above', [1]), SCHEMA)).toBe(false)
	})

	it('is false for a column absent from the schema', () => {
		expect(isExactCondition(cond('missing', 'equals', [1]), SCHEMA)).toBe(false)
	})

	it('is false for a json/blob-declared column on every operator except absent/present', () => {
		expect(isExactCondition(cond('meta', 'equals', ['x']), SCHEMA)).toBe(false)
		expect(isExactCondition(cond('meta', 'absent', []), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('meta', 'present', []), SCHEMA)).toBe(true)
	})

	it('equals/not require an operand matching the declared type; null/undefined is never exact', () => {
		expect(isExactCondition(cond('age', 'equals', [36]), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('age', 'equals', ['36']), SCHEMA)).toBe(false)
		expect(isExactCondition(cond('age', 'equals', [null]), SCHEMA)).toBe(false)
		expect(isExactCondition(cond('age', 'not', [undefined]), SCHEMA)).toBe(false)
	})

	it('above/below/from/to require a matching scalar operand', () => {
		expect(isExactCondition(cond('age', 'above', [18]), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('age', 'below', [null]), SCHEMA)).toBe(false)
	})

	it('between requires BOTH operands to match the declared type', () => {
		expect(isExactCondition(cond('age', 'between', [18, 65]), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('age', 'between', [18, null]), SCHEMA)).toBe(false)
	})

	it('any/none require a non-empty list where every element matches; an empty list is never exact', () => {
		expect(isExactCondition(cond('age', 'any', [10, 20]), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('age', 'any', []), SCHEMA)).toBe(false)
		expect(isExactCondition(cond('age', 'none', [10, null]), SCHEMA)).toBe(false)
		expect(isExactCondition(cond('age', 'none', []), SCHEMA)).toBe(false)
	})

	it('starts/ends are exact only on a text column with a string operand', () => {
		expect(isExactCondition(cond('name', 'starts', ['A']), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('name', 'ends', [1]), SCHEMA)).toBe(false)
		expect(isExactCondition(cond('age', 'starts', ['A']), SCHEMA)).toBe(false)
	})

	it('like/glob are never exact', () => {
		expect(isExactCondition(cond('name', 'like', ['A%']), SCHEMA)).toBe(false)
		expect(isExactCondition(cond('name', 'glob', ['A*']), SCHEMA)).toBe(false)
	})

	it('absent/present are exact for any flat column (matching decodeRow NULL→undefined)', () => {
		expect(isExactCondition(cond('age', 'absent', []), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('active', 'present', []), SCHEMA)).toBe(true)
	})

	it('a matching boolean operand on a boolean column is exact', () => {
		expect(isExactCondition(cond('active', 'equals', [true]), SCHEMA)).toBe(true)
		expect(isExactCondition(cond('active', 'equals', [1]), SCHEMA)).toBe(false)
	})
})

describe('isExactOrder', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', type: 'text', nullable: false },
			{ name: 'age', type: 'integer', nullable: true },
			{ name: 'meta', type: 'json', nullable: true },
		],
		indexes: [],
	}

	it('is true for a flat column of an exact declared type', () => {
		expect(isExactOrder({ column: 'age', direction: 'ascending' }, SCHEMA)).toBe(true)
	})

	it('is false for a nested FieldPath, an absent column, or a json/blob column', () => {
		expect(isExactOrder({ column: ['meta', 'score'], direction: 'ascending' }, SCHEMA)).toBe(false)
		expect(isExactOrder({ column: 'missing', direction: 'ascending' }, SCHEMA)).toBe(false)
		expect(isExactOrder({ column: 'meta', direction: 'ascending' }, SCHEMA)).toBe(false)
	})
})

describe('isExactCriteria', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', type: 'text', nullable: false },
			{ name: 'age', type: 'integer', nullable: true },
			{ name: 'meta', type: 'json', nullable: true },
		],
		indexes: [],
	}

	it('is true when every condition and order term is exact (limit/offset never affect it)', () => {
		expect(
			isExactCriteria(
				{
					conditions: [cond('age', 'above', [18])],
					order: [{ column: 'age', direction: 'ascending' }],
					limit: 10,
					offset: 5,
				},
				SCHEMA,
			),
		).toBe(true)
	})

	it('is false when any single condition or order term is inexact', () => {
		expect(isExactCriteria({ conditions: [cond(['meta', 'score'], 'above', [1])] }, SCHEMA)).toBe(
			false,
		)
		expect(
			isExactCriteria({ order: [{ column: ['meta', 'score'], direction: 'ascending' }] }, SCHEMA),
		).toBe(false)
	})

	it('is true for an empty/undefined criteria', () => {
		expect(isExactCriteria({}, SCHEMA)).toBe(true)
	})
})
