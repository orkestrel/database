import { BOOLEAN, JSON_COLUMN, INTEGER, REAL, TEXT, BLOB } from '../../setupServer.js'
import type { ColumnSchema } from '@src/core'
import { isDatabaseError } from '@src/core'
import {
	decodeRow,
	decodeValue,
	encodeRow,
	encodeValue,
	extractValues,
	deriveSQLiteIndexName,
	classifyAbsence,
	computeSuccessor,
	findNativeColumn,
	matchesAbsentPath,
	matchesNativeAggregate,
	matchesNativeCondition,
	matchesNativeOrder,
	matchesPrimaryPin,
	matchesSQLiteAffinity,
	planSQLiteQuery,
	quoteIdentifier,
} from '@src/server'
import { describe, expect, it } from 'vitest'
import { captureError } from '@orkestrel/test'
import { buildCondition as cond } from '../../setup.js'

// The SQLite ↔ JS codecs as pure functions (no DB needed): the SQL
// identifier containment (`quoteIdentifier`), persisted SQLite index naming,
// value / row codecs, value extraction, and the SQLite planner. SQL emitters are
// tested together in `compilers.test.ts`. Incompatible present values refuse with a validation error.

describe('quoteIdentifier', () => {
	it('refuses incompatible present column values with bounded diagnostics', async () => {
		for (const [column, value] of [
			[BOOLEAN, 1],
			[INTEGER, 1.5],
			[REAL, Number.NaN],
			[TEXT, 36],
			[BLOB, 'invalid'],
			[JSON_COLUMN, { at: new Date(0) }],
		] satisfies ReadonlyArray<readonly [ColumnSchema, unknown]>) {
			expect(() => encodeValue(value, column)).toThrow(
				expect.objectContaining({ code: 'VALIDATION' }),
			)
		}
		const column = { ...JSON_COLUMN, name: 'column'.repeat(10000) }
		const error = await captureError(() => encodeValue({ at: new Date(0) }, column))
		expect(isDatabaseError(error)).toBe(true)
		if (!isDatabaseError(error)) throw error
		expect(error.message.length).toBeLessThan(1000)
		expect(error.message).toContain('column')
	})
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

	it('keeps a number / bigint for integer and real, refusing incompatible values', () => {
		expect(encodeValue(36, INTEGER)).toBe(36)
		expect(encodeValue(10n, INTEGER)).toBe(10n)
		expect(encodeValue(3.5, REAL)).toBe(3.5)
		expect(() => encodeValue('nope', INTEGER)).toThrow(
			expect.objectContaining({ code: 'VALIDATION' }),
		)
		expect(decodeValue(36, INTEGER)).toBe(36)
	})

	it('keeps a string for text, refusing incompatible values', () => {
		expect(encodeValue('Ada', TEXT)).toBe('Ada')
		expect(() => encodeValue(36, TEXT)).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
		expect(decodeValue('Ada', TEXT)).toBe('Ada')
	})

	it('keeps a Uint8Array for blob, refusing incompatible values', () => {
		const bytes = new Uint8Array([1, 2, 3])
		expect(encodeValue(bytes, BLOB)).toBe(bytes)
		expect(() => encodeValue('nope', BLOB)).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
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
		expect(() => decodeValue(new Uint8Array([1]), both)).toThrow(
			expect.objectContaining({ code: 'DRIVER' }),
		)
		expect(encodeValue(null, TEXT)).toBeNull()
		expect(decodeValue(null, TEXT)).toBeUndefined()
	})

	it('rejects non-finite, fractional integer, permissive boolean, and malformed JSON values', () => {
		expect(() => encodeValue(Number.NaN, REAL)).toThrow(
			expect.objectContaining({ code: 'VALIDATION' }),
		)
		expect(() => encodeValue(Number.POSITIVE_INFINITY, REAL)).toThrow(
			expect.objectContaining({ code: 'VALIDATION' }),
		)
		expect(() => encodeValue(1.5, INTEGER)).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
		expect(() => encodeValue(1, BOOLEAN)).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
	})

	it('raises DRIVER for a stored value that does not match its declaration', () => {
		for (const [value, column] of [
			[2, BOOLEAN],
			[1.5, INTEGER],
			['{', JSON_COLUMN],
			['text', REAL],
		] as const) {
			expect(() => decodeValue(value, column, { table: 'users', key: 'u1' })).toThrow(
				expect.objectContaining({
					code: 'DRIVER',
					context: { table: 'users', key: 'u1', column: column.name, storage: column.storage },
				}),
			)
		}
	})
})

describe('encodeRow / decodeRow — over a schema', () => {
	const SCHEMA = CODEC_SCHEMA

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
		const caught = captureError(() => {
			extractValues({ id: 'u1' }, ['id', 'name'], 'users')
		})
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

describe('matchesNativeCondition', () => {
	const SCHEMA = CONDITION_SCHEMA

	it('is false for a nested path, an undeclared column, and a json column', () => {
		expect(matchesNativeCondition(cond(['meta', 'score'], 'above', [1]), SCHEMA)).toBe(false)
		expect(matchesNativeCondition(cond('missing', 'equals', [1]), SCHEMA)).toBe(false)
		expect(matchesNativeCondition(cond('meta', 'absent', []), SCHEMA)).toBe(false)
	})

	it('answers every operator on a nullable column with operands of its class', () => {
		for (const operator of ['equals', 'not', 'above', 'below', 'from', 'to'] as const) {
			expect(matchesNativeCondition(cond('age', operator, [18]), SCHEMA)).toBe(true)
		}
		expect(matchesNativeCondition(cond('age', 'between', [1, 2]), SCHEMA)).toBe(true)
		expect(matchesNativeCondition(cond('age', 'any', [1, 2]), SCHEMA)).toBe(true)
		expect(matchesNativeCondition(cond('age', 'none', []), SCHEMA)).toBe(true)
		expect(matchesNativeCondition(cond('age', 'absent', []), SCHEMA)).toBe(true)
		expect(matchesNativeCondition(cond('age', 'equals', [null]), SCHEMA)).toBe(true)
		expect(matchesNativeCondition(cond('active', 'equals', [true]), SCHEMA)).toBe(true)
	})

	it('answers a text range, like, glob, starts, and ends', () => {
		for (const operator of ['above', 'like', 'glob', 'starts', 'ends'] as const) {
			expect(matchesNativeCondition(cond('name', operator, ['Ad']), SCHEMA)).toBe(true)
		}
	})

	it('leaves an operand of another class, an undefined operand, and an over-long pattern residual', () => {
		expect(matchesNativeCondition(cond('age', 'above', ['18']), SCHEMA)).toBe(false)
		expect(matchesNativeCondition(cond('age', 'equals', [1.5]), SCHEMA)).toBe(false)
		expect(matchesNativeCondition(cond('age', 'equals', [undefined]), SCHEMA)).toBe(false)
		expect(matchesNativeCondition(cond('age', 'any', [1, null]), SCHEMA)).toBe(false)
		expect(matchesNativeCondition(cond('age', 'like', ['1%']), SCHEMA)).toBe(false)
		expect(matchesNativeCondition(cond('name', 'like', ['a'.repeat(1025)]), SCHEMA)).toBe(false)
	})
})

describe('matchesNativeOrder', () => {
	it('orders natively by a flat declared column with at most one flag', () => {
		expect(matchesNativeOrder({ column: 'age', direction: 'ascending' }, ORDER_SCHEMA)).toBe(true)
		expect(matchesNativeOrder({ column: 'id', direction: 'descending' }, ORDER_SCHEMA)).toBe(true)
	})

	it('leaves a nested path, a json column, and a column with both flags residual', () => {
		expect(
			matchesNativeOrder({ column: ['meta', 'a'], direction: 'ascending' }, ORDER_SCHEMA),
		).toBe(false)
		expect(matchesNativeOrder({ column: 'meta', direction: 'ascending' }, ORDER_SCHEMA)).toBe(false)
		expect(matchesNativeOrder({ column: 'rank', direction: 'ascending' }, AGGREGATE_SCHEMA)).toBe(
			false,
		)
	})
})

describe('matchesNativeAggregate', () => {
	const SCHEMA = AGGREGATE_SCHEMA

	it('computes count natively whatever the column', () => {
		expect(matchesNativeAggregate({ operation: 'count', column: ['nested'] }, SCHEMA)).toBe(true)
	})

	it('computes every numeric aggregate on a numeric column with at most one flag', () => {
		for (const operation of ['sum', 'average', 'minimum', 'maximum'] as const) {
			expect(matchesNativeAggregate({ operation, column: 'age' }, SCHEMA)).toBe(true)
			expect(matchesNativeAggregate({ operation, column: 'score' }, SCHEMA)).toBe(true)
			expect(matchesNativeAggregate({ operation, column: 'rank' }, SCHEMA)).toBe(false)
			expect(matchesNativeAggregate({ operation, column: 'id' }, SCHEMA)).toBe(false)
		}
	})
})

describe('planSQLiteQuery', () => {
	const SCHEMA = CONDITION_SCHEMA
	const named = cond('name', 'equals', ['Ada'])
	const nested = cond(['meta', 'score'], 'above', [1])
	const order = [{ column: 'age', direction: 'descending' as const }]

	it('plans a read SQLite answers whole with an empty residual', () => {
		expect(planSQLiteQuery({ conditions: [named], order, limit: 10, offset: 5 }, SCHEMA)).toEqual({
			native: { conditions: [named], order, limit: 10, offset: 5 },
			residual: {},
		})
		expect(planSQLiteQuery({ conditions: [], order: [] }, SCHEMA)).toEqual({
			native: {},
			residual: {},
		})
	})

	it('splits an and read, keeping the page residual behind a residual condition', () => {
		expect(planSQLiteQuery({ conditions: [named, nested], limit: 1 }, SCHEMA)).toEqual({
			native: { conditions: [named] },
			residual: { conditions: [nested], limit: 1 },
		})
	})

	it('keeps an or read whole on one side', () => {
		const either = cond(['meta', 'score'], 'above', [1], 'or')
		expect(planSQLiteQuery({ conditions: [named, either] }, SCHEMA)).toEqual({
			native: {},
			residual: { conditions: [named, either] },
		})
	})

	it('keeps an order SQLite cannot sort residual, with the page behind it', () => {
		const deep = [{ column: ['meta', 'a'], direction: 'ascending' as const }]
		expect(planSQLiteQuery({ conditions: [named], order: deep, limit: 2 }, SCHEMA)).toEqual({
			native: { conditions: [named] },
			residual: { order: deep, limit: 2 },
		})
	})

	it('keeps an aggregate native only over a native filter', () => {
		const aggregate = { operation: 'sum' as const, column: 'age' }
		const above = cond('age', 'above', [1])
		expect(planSQLiteQuery({ conditions: [above], aggregate }, AGGREGATE_SCHEMA)).toEqual({
			native: { conditions: [above], aggregate },
			residual: {},
		})
		expect(planSQLiteQuery({ conditions: [named], aggregate }, AGGREGATE_SCHEMA)).toEqual({
			native: {},
			residual: { conditions: [named], aggregate },
		})
		expect(planSQLiteQuery({ aggregate }, AGGREGATE_SCHEMA)).toEqual({
			native: { aggregate },
			residual: {},
		})
		const ranked = { operation: 'sum' as const, column: 'rank' }
		expect(planSQLiteQuery({ aggregate: ranked }, AGGREGATE_SCHEMA)).toEqual({
			native: {},
			residual: { aggregate: ranked },
		})
	})
})

describe('classifyAbsence, matchesPrimaryPin, findNativeColumn, and computeSuccessor', () => {
	it('classifies a column by its flags', () => {
		expect(classifyAbsence({ name: 'a', storage: 'text', optional: false, nullable: false })).toBe(
			'required',
		)
		expect(classifyAbsence({ name: 'a', storage: 'text', optional: true, nullable: false })).toBe(
			'optional',
		)
		expect(classifyAbsence({ name: 'a', storage: 'text', optional: false, nullable: true })).toBe(
			'nullable',
		)
		expect(classifyAbsence({ name: 'a', storage: 'text', optional: true, nullable: true })).toBe(
			'both',
		)
		expect(classifyAbsence(undefined)).toBe('optional')
	})

	it('pins an and fold with an any on the primary key, and never an or fold', () => {
		expect(
			matchesPrimaryPin(
				[cond('id', 'any', ['a']), cond('name', 'equals', ['x'])],
				CONDITION_SCHEMA,
			),
		).toBe(true)
		expect(matchesPrimaryPin([cond('id', 'equals', ['a'])], CONDITION_SCHEMA)).toBe(false)
		expect(
			matchesPrimaryPin(
				[cond('id', 'any', ['a']), cond('name', 'equals', ['x'], 'or')],
				CONDITION_SCHEMA,
			),
		).toBe(false)
	})

	it('resolves a flat declared scalar column only', () => {
		expect(findNativeColumn('age', CONDITION_SCHEMA)?.storage).toBe('integer')
		expect(findNativeColumn('meta', CONDITION_SCHEMA)).toBeUndefined()
		expect(findNativeColumn(['age'], CONDITION_SCHEMA)).toBeUndefined()
	})

	it('increments the final code point, carrying past U+10FFFF and skipping surrogates', () => {
		expect(computeSuccessor('ab')).toBe('ac')
		expect(computeSuccessor('a\u{10FFFF}')).toBe('b')
		expect(computeSuccessor('퟿')).toBe('')
		expect(computeSuccessor('x😀')).toBe('x😁')
		expect(computeSuccessor('\u{10FFFF}')).toBeUndefined()
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

describe('matchesAbsentPath', () => {
	it('reads both codes that mean nothing is there', () => {
		// ENOTDIR is the one a host disagrees about: a path whose parent is a file
		// reports it here and a plain absence elsewhere, for a name that can hold
		// nothing either way.
		expect(matchesAbsentPath(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe(true)
		expect(matchesAbsentPath(Object.assign(new Error('under a file'), { code: 'ENOTDIR' }))).toBe(
			true,
		)
	})

	it('reads every other failure as a real one', () => {
		// The controls are drawn from outside the absent class: a refusal, a loop and
		// a busy resource all name a path that exists or cannot be decided, so a
		// predicate that answered on the presence of `code` alone fails here.
		for (const code of ['EACCES', 'ELOOP', 'EBUSY', 'EISDIR', 'ENAMETOOLONG']) {
			expect(matchesAbsentPath(Object.assign(new Error(code), { code }))).toBe(false)
		}
	})

	it('answers false for a value that is not a coded error and never throws', () => {
		// A bare object carrying the right code is the sharpest control: it satisfies
		// every duck-typed reading of the shape and is still not a report a
		// filesystem made, so a predicate reading `code` off any object fails here.
		for (const hostile of [
			'ENOENT',
			undefined,
			null,
			42,
			{},
			[],
			new Error('bare'),
			{ code: 'ENOENT' },
			{ code: 'ENOTDIR' },
		]) {
			expect(() => matchesAbsentPath(hostile)).not.toThrow()
			expect(matchesAbsentPath(hostile)).toBe(false)
		}
	})
})
import {
	CODEC_SCHEMA,
	CONDITION_SCHEMA,
	ORDER_SCHEMA,
	AGGREGATE_SCHEMA,
} from '../../setupServer.js'
