import type { ColumnSchema, TableSchema } from '@src/core'
import { isDatabaseError } from '@src/core'
import {
	decodeRow,
	decodeValue,
	encodeRow,
	encodeValue,
	extractValues,
	deriveSQLiteIndexName,
	matchesAggregateExactly,
	matchesConditionExactly,
	matchesQueryExactly,
	matchesOrderExactly,
	matchesSQLiteAffinity,
	quoteIdentifier,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { buildCondition as cond } from '../../setup.js'

const BOOLEAN: ColumnSchema = {
	name: 'value',
	storage: 'boolean',
	optional: false,
	nullable: false,
}
const JSON_COLUMN: ColumnSchema = {
	name: 'value',
	storage: 'json',
	optional: false,
	nullable: false,
}
const INTEGER: ColumnSchema = {
	name: 'value',
	storage: 'integer',
	optional: false,
	nullable: false,
}
const REAL: ColumnSchema = {
	name: 'value',
	storage: 'real',
	optional: false,
	nullable: false,
}
const TEXT: ColumnSchema = {
	name: 'value',
	storage: 'text',
	optional: false,
	nullable: false,
}
const BLOB: ColumnSchema = {
	name: 'value',
	storage: 'blob',
	optional: false,
	nullable: false,
}

// The SQLite ↔ JS codecs as pure functions (no DB needed, AGENTS §16): the SQL
// identifier containment (`quoteIdentifier`), persisted SQLite index naming,
// value / row codecs, value extraction, and exactness gates. SQL emitters are
// tested together in `compilers.test.ts`. Every codec is total — a value that
// does not fit its column encodes to `null` rather than throwing.

describe('quoteIdentifier', () => {
	it('wraps an identifier in double quotes', () => {
		expect(quoteIdentifier('order')).toBe('"order"')
	})

	it('doubles an embedded double quote', () => {
		expect(quoteIdentifier('a"b')).toBe('"a""b"')
	})
})

describe('encodeValue / decodeValue — round-trips', () => {
	it('round-trips a boolean through 1 / 0', () => {
		expect(encodeValue(true, BOOLEAN)).toBe(1)
		expect(encodeValue(false, BOOLEAN)).toBe(0)
		expect(decodeValue(1, BOOLEAN)).toBe(true)
		expect(decodeValue(0, BOOLEAN)).toBe(false)
	})

	it('round-trips json through a stringified value', () => {
		const value = { tags: ['a', 'b'], info: { score: 9, ok: true } }
		const encoded = encodeValue(value, JSON_COLUMN)
		expect(encoded).toBe(JSON.stringify(value))
		expect(decodeValue(encoded, JSON_COLUMN)).toEqual(value)
	})

	it('keeps a number / bigint for integer and real, else null', () => {
		expect(encodeValue(36, INTEGER)).toBe(36)
		expect(encodeValue(10n, INTEGER)).toBe(10n)
		expect(encodeValue(3.5, REAL)).toBe(3.5)
		expect(encodeValue('nope', INTEGER)).toBeNull()
		expect(decodeValue(36, INTEGER)).toBe(36)
	})

	it('keeps a string for text, else null', () => {
		expect(encodeValue('Ada', TEXT)).toBe('Ada')
		expect(encodeValue(36, TEXT)).toBeNull()
		expect(decodeValue('Ada', TEXT)).toBe('Ada')
	})

	it('keeps a Uint8Array for blob, else null', () => {
		const bytes = new Uint8Array([1, 2, 3])
		expect(encodeValue(bytes, BLOB)).toBe(bytes)
		expect(encodeValue('nope', BLOB)).toBeNull()
		expect(decodeValue(bytes, BLOB)).toBe(bytes)
	})

	it('distinguishes required, optional, nullable, and optional-nullable NULL semantics', () => {
		const optional = { ...TEXT, optional: true }
		const nullable = { ...TEXT, nullable: true }
		const both = { ...TEXT, optional: true, nullable: true }

		expect(encodeValue(undefined, optional)).toBeNull()
		expect(decodeValue(null, optional)).toBeUndefined()
		expect(encodeValue(null, nullable)).toBeNull()
		expect(decodeValue(null, nullable)).toBeNull()
		expect(encodeValue(undefined, both)).toBeNull()
		expect(decodeValue(null, both)).toBeUndefined()
		const sentinel = encodeValue(null, both)
		expect(sentinel).toBeInstanceOf(Uint8Array)
		expect(decodeValue(sentinel, both)).toBeNull()
		expect(decodeValue(new Uint8Array([1]), both)).toBeUndefined()
		expect(encodeValue(null, TEXT)).toBeNull()
		expect(decodeValue(null, TEXT)).toBeUndefined()
	})

	it('rejects non-finite, fractional integer, permissive boolean, and malformed JSON values', () => {
		expect(encodeValue(Number.NaN, REAL)).toBeNull()
		expect(encodeValue(Number.POSITIVE_INFINITY, REAL)).toBeNull()
		expect(encodeValue(1.5, INTEGER)).toBeNull()
		expect(encodeValue(1, BOOLEAN)).toBeNull()
		expect(decodeValue(2, BOOLEAN)).toBeUndefined()
		expect(decodeValue(1.5, INTEGER)).toBeUndefined()
		expect(decodeValue('{', JSON_COLUMN)).toBeUndefined()
	})
})

describe('encodeRow / decodeRow — over a schema', () => {
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

	it('preserves explicit null for a nullable-only stored column', () => {
		const decoded = decodeRow({ id: 'u1', name: 'Ada', age: 36, active: 0, meta: null }, SCHEMA)
		expect(decoded).toEqual({ id: 'u1', name: 'Ada', age: 36, active: false, meta: null })
	})

	it('round-trips a row through encode then decode', () => {
		const row = { id: 'u1', name: 'Ada', age: 36, active: true, meta: { tags: ['x'] } }
		expect(decodeRow(encodeRow(row, SCHEMA), SCHEMA)).toEqual(row)
	})
})

describe('extractValues', () => {
	it('returns values in the requested binding order', () => {
		expect(extractValues({ id: 'u1', age: 36 }, ['age', 'id'], 'users')).toEqual([36, 'u1'])
	})

	it('throws a DRIVER error naming an absent declared column', () => {
		let caught: unknown
		try {
			extractValues({ id: 'u1' }, ['id', 'name'], 'users')
		} catch (error) {
			caught = error
		}
		expect(isDatabaseError(caught) ? caught.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(caught) ? caught.context : undefined).toEqual({
			table: 'users',
			column: 'name',
		})
	})
})

describe('deriveSQLiteIndexName — collision-free, deterministic', () => {
	it('length-prefixes the table then each column so ambiguous names no longer collide', () => {
		// The naive `idx_<table>_<cols>` scheme collides here: both compile the
		// same joined string ('a_b_c') under the old naming.
		expect(deriveSQLiteIndexName('a_b', ['c'])).toBe('idx_3_a_b_1_c')
		expect(deriveSQLiteIndexName('a', ['b', 'c'])).toBe('idx_1_a_1_b_1_c')
		expect(deriveSQLiteIndexName('a_b', ['c'])).not.toBe(deriveSQLiteIndexName('a', ['b', 'c']))
	})
})

describe('matchesConditionExactly', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: true },
			{ name: 'active', storage: 'boolean', optional: false, nullable: true },
			{ name: 'meta', storage: 'json', optional: false, nullable: true },
		],
		indexes: [],
	}

	it('is false for a nested FieldPath (array column)', () => {
		expect(matchesConditionExactly(cond(['meta', 'score'], 'above', [1]), SCHEMA)).toBe(false)
	})

	it('is false for a column absent from the schema', () => {
		expect(matchesConditionExactly(cond('missing', 'equals', [1]), SCHEMA)).toBe(false)
	})

	it('keeps JSON scalar comparisons inexact while nullable-only absence predicates are exact', () => {
		expect(matchesConditionExactly(cond('meta', 'equals', ['x']), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('meta', 'absent', []), SCHEMA)).toBe(true)
		expect(matchesConditionExactly(cond('meta', 'present', []), SCHEMA)).toBe(true)
	})

	it('scalar comparisons are conservative for every optional or nullable column', () => {
		expect(matchesConditionExactly(cond('age', 'equals', [36]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'equals', ['36']), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'equals', [null]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'not', [undefined]), SCHEMA)).toBe(false)
	})

	it('above/below/from/to remain inexact on a nullable column', () => {
		expect(matchesConditionExactly(cond('age', 'above', [18]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'below', [null]), SCHEMA)).toBe(false)
	})

	it('between remains inexact on a nullable column', () => {
		expect(matchesConditionExactly(cond('age', 'between', [18, 65]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'between', [18, null]), SCHEMA)).toBe(false)
	})

	it('any/none remain inexact on a nullable column', () => {
		expect(matchesConditionExactly(cond('age', 'any', [10, 20]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'any', []), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'none', [10, null]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'none', []), SCHEMA)).toBe(false)
	})

	it('starts/ends are exact only on a text column with a string operand', () => {
		expect(matchesConditionExactly(cond('name', 'starts', ['A']), SCHEMA)).toBe(true)
		expect(matchesConditionExactly(cond('name', 'ends', [1]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('age', 'starts', ['A']), SCHEMA)).toBe(false)
	})

	it('like/glob are never exact', () => {
		expect(matchesConditionExactly(cond('name', 'like', ['A%']), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('name', 'glob', ['A*']), SCHEMA)).toBe(false)
	})

	it('absent/present exactness follows the optional/nullable truth table', () => {
		const requiredColumn: ColumnSchema = {
			name: 'id',
			storage: 'text',
			optional: false,
			nullable: false,
		}
		const optionalColumn: ColumnSchema = { ...requiredColumn, optional: true }
		const nullableColumn: ColumnSchema = { ...requiredColumn, nullable: true }
		const bothColumn: ColumnSchema = { ...requiredColumn, optional: true, nullable: true }
		const required = { ...SCHEMA, columns: [requiredColumn] }
		const optional = { ...SCHEMA, columns: [optionalColumn] }
		const nullable = { ...SCHEMA, columns: [nullableColumn] }
		const both = {
			...SCHEMA,
			columns: [bothColumn],
		}
		expect(matchesConditionExactly(cond('id', 'absent', []), required)).toBe(true)
		expect(matchesConditionExactly(cond('id', 'present', []), required)).toBe(true)
		expect(matchesConditionExactly(cond('id', 'absent', []), optional)).toBe(true)
		expect(matchesConditionExactly(cond('id', 'present', []), optional)).toBe(true)
		expect(matchesConditionExactly(cond('id', 'absent', []), nullable)).toBe(true)
		expect(matchesConditionExactly(cond('id', 'present', []), nullable)).toBe(true)
		expect(matchesConditionExactly(cond('id', 'absent', []), both)).toBe(false)
		expect(matchesConditionExactly(cond('id', 'present', []), both)).toBe(false)
	})

	it('nullable boolean comparisons remain inexact', () => {
		expect(matchesConditionExactly(cond('active', 'equals', [true]), SCHEMA)).toBe(false)
		expect(matchesConditionExactly(cond('active', 'equals', [1]), SCHEMA)).toBe(false)
	})
})

describe('matchesOrderExactly', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: true },
			{ name: 'meta', storage: 'json', optional: false, nullable: true },
		],
		indexes: [],
	}

	it('is false for an optional or nullable scalar column', () => {
		expect(matchesOrderExactly({ column: 'age', direction: 'ascending' }, SCHEMA)).toBe(false)
	})

	it('is false for a nested FieldPath, an absent column, or a json/blob column', () => {
		expect(matchesOrderExactly({ column: ['meta', 'score'], direction: 'ascending' }, SCHEMA)).toBe(
			false,
		)
		expect(matchesOrderExactly({ column: 'missing', direction: 'ascending' }, SCHEMA)).toBe(false)
		expect(matchesOrderExactly({ column: 'meta', direction: 'ascending' }, SCHEMA)).toBe(false)
	})
})

describe('matchesQueryExactly', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: false },
			{ name: 'meta', storage: 'json', optional: false, nullable: true },
		],
		indexes: [],
	}

	it('is true when every condition and order term is exact (limit/offset never affect it)', () => {
		expect(
			matchesQueryExactly(
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
		expect(
			matchesQueryExactly({ conditions: [cond(['meta', 'score'], 'above', [1])] }, SCHEMA),
		).toBe(false)
		expect(
			matchesQueryExactly(
				{ order: [{ column: ['meta', 'score'], direction: 'ascending' }] },
				SCHEMA,
			),
		).toBe(false)
	})

	it('is true for an empty/undefined input', () => {
		expect(matchesQueryExactly({}, SCHEMA)).toBe(true)
	})
})

describe('matchesAggregateExactly', () => {
	const SCHEMA: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: false },
			{ name: 'score', storage: 'real', optional: true, nullable: false },
			{ name: 'limit', storage: 'integer', optional: false, nullable: true },
			{ name: 'rank', storage: 'integer', optional: true, nullable: true },
		],
		indexes: [],
	}

	it('executes count natively because it ignores the column', () => {
		expect(matchesAggregateExactly('count', ['nested'], SCHEMA)).toBe(true)
	})

	it('refines sum and average regardless of the declared storage', () => {
		expect(matchesAggregateExactly('sum', 'age', SCHEMA)).toBe(false)
		expect(matchesAggregateExactly('average', 'age', SCHEMA)).toBe(false)
	})

	it('executes minimum and maximum only for exact flat numeric columns', () => {
		expect(matchesAggregateExactly('minimum', 'age', SCHEMA)).toBe(true)
		expect(matchesAggregateExactly('maximum', 'score', SCHEMA)).toBe(true)
		expect(matchesAggregateExactly('minimum', 'limit', SCHEMA)).toBe(true)
		expect(matchesAggregateExactly('minimum', 'rank', SCHEMA)).toBe(false)
		expect(matchesAggregateExactly('maximum', 'id', SCHEMA)).toBe(false)
		expect(matchesAggregateExactly('minimum', ['age'], SCHEMA)).toBe(false)
	})
})

describe('matchesSQLiteAffinity', () => {
	it('implements SQLite affinity precedence for every portable storage', () => {
		expect(matchesSQLiteAffinity('BIGINT', 'integer')).toBe(true)
		expect(matchesSQLiteAffinity('VARCHAR(40)', 'text')).toBe(true)
		expect(matchesSQLiteAffinity('', 'blob')).toBe(true)
		expect(matchesSQLiteAffinity('DOUBLE PRECISION', 'real')).toBe(true)
		expect(matchesSQLiteAffinity('INTEGER', 'boolean')).toBe(true)
		expect(matchesSQLiteAffinity('TEXT', 'json')).toBe(true)
	})

	it('rejects malformed types and incompatible affinities', () => {
		expect(matchesSQLiteAffinity(null, 'text')).toBe(false)
		expect(matchesSQLiteAffinity('NUMERIC', 'real')).toBe(false)
		expect(matchesSQLiteAffinity('TEXT', 'integer')).toBe(false)
	})
})
