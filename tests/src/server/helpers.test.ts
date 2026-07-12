import type { TableSchema } from '@src/core'
import {
	aggregateSQL,
	columnSQL,
	decodeRow,
	decodeValue,
	encodeRow,
	encodeValue,
	fieldColumn,
	quote,
	schemaToIndexes,
	schemaToTable,
} from '@src/server'
import { describe, expect, it } from 'vitest'

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

	it('compiles one CREATE INDEX IF NOT EXISTS per declared index group', () => {
		expect(schemaToIndexes(SCHEMA)).toEqual([
			'CREATE INDEX IF NOT EXISTS "idx_users_name" ON "users" ("name")',
			'CREATE INDEX IF NOT EXISTS "idx_users_name_age" ON "users" ("name", "age")',
		])
	})

	it('returns an empty list for a table with no declared indexes', () => {
		expect(schemaToIndexes({ ...SCHEMA, indexes: [] })).toEqual([])
	})
})
