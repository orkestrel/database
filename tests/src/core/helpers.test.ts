import type { DriverInterface, Key, Row, TableSchema } from '@src/core'
import {
	applyCriteria,
	auditDriver,
	checkAbort,
	columnsToContract,
	compareValues,
	computeAggregate,
	conformDriver,
	createMemoryDriver,
	deepEqual,
	driverFindings,
	extractKey,
	filterRows,
	generateUUID,
	globMatch,
	isDatabaseError,
	isDriverMeta,
	likeMatch,
	matchesCondition,
	matchesCriteria,
	MAX_PATTERN_LENGTH,
	migrateRows,
	planMigration,
	shapeToColumnType,
	sortRows,
	wildcardMatch,
} from '@src/core'
import {
	arrayShape,
	booleanShape,
	integerShape,
	jsonShape,
	literalShape,
	nullableShape,
	nullShape,
	numberShape,
	objectShape,
	optionalShape,
	rawShape,
	seededRandom,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { buildCondition, captureError } from '../../setup.js'

// `buildCondition` (tests/setup.ts) builds one condition with the seed connector
// — the connector is irrelevant for a single-condition match (it only matters
// when folding a list).

describe('compareValues', () => {
	it('orders unlike types by a stable rank', () => {
		expect(compareValues(undefined, null)).toBe(-1)
		expect(compareValues(null, true)).toBe(-1)
		expect(compareValues(true, 1)).toBe(-1)
		expect(compareValues(1, 'a')).toBe(-1)
		expect(compareValues('a', 1)).toBe(1)
	})

	it('compares same-typed values naturally', () => {
		expect(compareValues(1, 2)).toBe(-1)
		expect(compareValues(2, 2)).toBe(0)
		expect(compareValues('b', 'a')).toBe(1)
		expect(compareValues(false, true)).toBe(-1)
	})

	it('is total around NaN (sorts last, equal to itself)', () => {
		expect(compareValues(Number.NaN, Number.NaN)).toBe(0)
		expect(compareValues(Number.NaN, 1)).toBe(1)
		expect(compareValues(1, Number.NaN)).toBe(-1)
	})
})

describe('matchesCondition', () => {
	const row = { name: 'Alice', age: 30, tag: null }

	it('handles comparison operators', () => {
		expect(matchesCondition(row, buildCondition('age', 'equals', [30]))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'not', [30]))).toBe(false)
		expect(matchesCondition(row, buildCondition('age', 'above', [25]))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'below', [25]))).toBe(false)
		expect(matchesCondition(row, buildCondition('age', 'from', [30]))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'to', [30]))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'between', [18, 40]))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'between', [31, 40]))).toBe(false)
	})

	it('handles string operators', () => {
		expect(matchesCondition(row, buildCondition('name', 'like', ['al%']))).toBe(true) // case-insensitive
		expect(matchesCondition(row, buildCondition('name', 'glob', ['Al*']))).toBe(true)
		expect(matchesCondition(row, buildCondition('name', 'glob', ['al*']))).toBe(false) // case-sensitive
		expect(matchesCondition(row, buildCondition('name', 'starts', ['Ali']))).toBe(true)
		expect(matchesCondition(row, buildCondition('name', 'ends', ['ice']))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'like', ['%']))).toBe(false) // non-string value
	})

	it('handles membership and null operators', () => {
		expect(matchesCondition(row, buildCondition('age', 'any', [20, 30, 40]))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'none', [20, 40]))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'none', [30]))).toBe(false)
		expect(matchesCondition(row, buildCondition('tag', 'absent', []))).toBe(true)
		expect(matchesCondition(row, buildCondition('age', 'present', []))).toBe(true)
		expect(matchesCondition(row, buildCondition('tag', 'present', []))).toBe(false)
	})

	it('equals/not/any/none use STRUCTURAL equality (deepEqual), not the total-order rank', () => {
		const objRow = { info: { a: 1 }, list: [1, 2, 3] }
		// A differing object is NOT equal — the old rank-based comparator ranked
		// every non-scalar equal, matching ANY object.
		expect(matchesCondition(objRow, buildCondition('info', 'equals', [{ a: 2 }]))).toBe(false)
		// A structurally-equal object IS equal.
		expect(matchesCondition(objRow, buildCondition('info', 'equals', [{ a: 1 }]))).toBe(true)
		// Arrays compare by index.
		expect(matchesCondition(objRow, buildCondition('list', 'equals', [[1, 2, 3]]))).toBe(true)
		expect(matchesCondition(objRow, buildCondition('list', 'equals', [[1, 2, 4]]))).toBe(false)
		// `not` is the inverse.
		expect(matchesCondition(objRow, buildCondition('info', 'not', [{ a: 2 }]))).toBe(true)
		expect(matchesCondition(objRow, buildCondition('info', 'not', [{ a: 1 }]))).toBe(false)
		// `any` / `none` with structured operands.
		expect(matchesCondition(objRow, buildCondition('info', 'any', [{ a: 9 }, { a: 1 }]))).toBe(true)
		expect(matchesCondition(objRow, buildCondition('info', 'any', [{ a: 9 }, { a: 8 }]))).toBe(
			false,
		)
		expect(matchesCondition(objRow, buildCondition('info', 'none', [{ a: 9 }, { a: 8 }]))).toBe(
			true,
		)
		expect(matchesCondition(objRow, buildCondition('info', 'none', [{ a: 9 }, { a: 1 }]))).toBe(
			false,
		)
	})

	it('equals/any use SameValueZero via deepEqual — NaN now equals NaN', () => {
		const nanRow = { n: Number.NaN }
		expect(matchesCondition(nanRow, buildCondition('n', 'equals', [Number.NaN]))).toBe(true)
		expect(matchesCondition(nanRow, buildCondition('n', 'any', [1, Number.NaN]))).toBe(true)
		expect(matchesCondition(nanRow, buildCondition('n', 'not', [Number.NaN]))).toBe(false)
	})

	it('keeps scalar equality behavior unchanged (cross-type equals still false)', () => {
		expect(matchesCondition(row, buildCondition('age', 'equals', ['30']))).toBe(false)
		expect(matchesCondition(row, buildCondition('name', 'equals', ['Alice']))).toBe(true)
	})
})

describe('likeMatch', () => {
	it('matches % (any run) and _ (any single char), anchored', () => {
		expect(likeMatch('abc', 'a%')).toBe(true)
		expect(likeMatch('xab', 'a%')).toBe(false) // anchored at the start
		expect(likeMatch('abc', 'a_c')).toBe(true)
		expect(likeMatch('ac', 'a_c')).toBe(false) // _ needs exactly one char
	})

	it('is case-insensitive', () => {
		expect(likeMatch('Alice', 'al%')).toBe(true)
	})

	it('treats every non-wildcard char as a LITERAL (no metacharacter hazard)', () => {
		// A literal '.' matches a dot, not any char — the regex-escape hazard is gone with the regex.
		expect(likeMatch('a.c', 'a.c')).toBe(true)
		expect(likeMatch('abc', 'a.c')).toBe(false)
		// '(' / '[' / '\' / '+' are plain literals.
		expect(likeMatch('a(b', 'a(b')).toBe(true)
		expect(likeMatch('a[b', 'a[b')).toBe(true)
		expect(likeMatch('a\\b', 'a\\b')).toBe(true)
		expect(likeMatch('a+b', 'a+b')).toBe(true)
		expect(likeMatch('aaab', 'a+b')).toBe(false)
	})

	it('a % run behaves as a single any-run (a%%%b ≡ a%b)', () => {
		expect(likeMatch('axyzb', 'a%%%b')).toBe(true)
		expect(likeMatch('ab', 'a%%%b')).toBe(true)
		expect(likeMatch('axb', 'a%%%b')).toBe(true)
		expect(likeMatch('axc', 'a%%%b')).toBe(false)
		// Equivalent to the single-% form on the same inputs.
		expect(likeMatch('axyzb', 'a%%%%%%b')).toBe(likeMatch('axyzb', 'a%b'))
		expect(likeMatch('ab', 'a%%%%%%b')).toBe(likeMatch('ab', 'a%b'))
	})

	it('_ runs require exactly that many chars (a__b ≠ a_b)', () => {
		expect(likeMatch('axyb', 'a__b')).toBe(true)
		expect(likeMatch('axb', 'a__b')).toBe(false) // two chars required
		expect(likeMatch('axb', 'a_b')).toBe(true) // exactly one char
	})

	it('a wildcard char is ALWAYS a wildcard, even when the value contains it literally', () => {
		// `any` is tested before a literal match, so a value '%' never shadows the pattern's %.
		expect(likeMatch('a%b', 'a%b')).toBe(true)
		expect(likeMatch('axb', 'a%b')).toBe(true)
	})
})

describe('globMatch', () => {
	it('matches * (any run) and ? (any single char), anchored', () => {
		expect(globMatch('abc', 'a*')).toBe(true)
		expect(globMatch('xab', 'a*')).toBe(false)
		expect(globMatch('abc', 'a?c')).toBe(true)
		expect(globMatch('ac', 'a?c')).toBe(false)
	})

	it('is case-SENSITIVE (unlike LIKE)', () => {
		expect(globMatch('Alice', 'Al*')).toBe(true)
		expect(globMatch('Alice', 'al*')).toBe(false)
	})

	it('treats every non-wildcard char as a literal', () => {
		expect(globMatch('a.c', 'a.c')).toBe(true)
		expect(globMatch('abc', 'a.c')).toBe(false)
		expect(globMatch('a(b', 'a(b')).toBe(true)
		expect(globMatch('a\\b', 'a\\b')).toBe(true)
	})

	it('a * run behaves as a single any-run (a***b ≡ a*b)', () => {
		expect(globMatch('axyzb', 'a***b')).toBe(true)
		expect(globMatch('ab', 'a***b')).toBe(true)
		expect(globMatch('axc', 'a***b')).toBe(false)
		expect(globMatch('axyzb', 'a******b')).toBe(globMatch('axyzb', 'a*b'))
	})

	it('? runs require exactly that many chars (a??b ≠ a?b)', () => {
		expect(globMatch('axyb', 'a??b')).toBe(true)
		expect(globMatch('axb', 'a??b')).toBe(false)
		expect(globMatch('axb', 'a?b')).toBe(true)
	})
})

describe('wildcardMatch — the linear, ReDoS-safe engine', () => {
	it('matches generically with the injected wildcard chars + fold flag', () => {
		expect(wildcardMatch('abc', 'a%', '%', '_', false)).toBe(true)
		expect(wildcardMatch('ABC', 'a%', '%', '_', true)).toBe(true) // fold
		expect(wildcardMatch('ABC', 'a%', '%', '_', false)).toBe(false) // no fold
		expect(wildcardMatch('axc', 'a_c', '%', '_', false)).toBe(true)
	})

	it('rejects an over-length pattern with a VALIDATION DatabaseError', () => {
		const long = 'a'.repeat(MAX_PATTERN_LENGTH + 1)
		const error = captureError(() => wildcardMatch('x', long, '%', '_', false))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('VALIDATION')
		// A pattern exactly at the cap is accepted (no throw).
		expect(() => wildcardMatch('x', 'a'.repeat(MAX_PATTERN_LENGTH), '%', '_', false)).not.toThrow()
	})

	it('a huge any-run is fine — the matcher is LINEAR (only the length is capped, not the count)', () => {
		// 1000 consecutive % (well under the length cap) behave as one any-run, fast — no
		// wildcard-COUNT cap is needed, because the matcher never backtracks like a regex.
		expect(likeMatch('aXYZb', `a${'%'.repeat(1000)}b`)).toBe(true)
		expect(likeMatch('ab', `a${'%'.repeat(1000)}b`)).toBe(true)
	})

	it('bounds the catastrophic-backtracking SHAPE in well under a few milliseconds', () => {
		// The classic ReDoS shape a JS regex CANNOT bound: many any-run wildcards SEPARATED BY
		// LITERALS (the equivalent regex `^a.*a.*…a.*X$`), matched against a long input that never
		// ends in the required suffix — a forced full non-match. A backtracking regex blows up
		// super-linearly here (it HANGS); the linear greedy matcher is O(value × pattern).
		const hostilePattern = `${'a%'.repeat(300)}X` // 300 any-runs separated by literals
		const hostileInput = 'a'.repeat(20_000)
		const started = performance.now()
		const matched = likeMatch(hostileInput, hostilePattern)
		const elapsed = performance.now() - started
		expect(matched).toBe(false)
		// A backtracking regex takes seconds-to-forever; the linear matcher finishes near-instantly.
		// A generous ceiling leaves no room for a blow-up while staying robust on a slow CI box.
		expect(elapsed).toBeLessThan(200)
	})
})

describe('matchesCriteria', () => {
	const row = { age: 30, role: 'admin' }

	it('matches every row on an empty condition list', () => {
		expect(matchesCriteria(row, [])).toBe(true)
	})

	it('folds conditions left-to-right by connector', () => {
		const and = [buildCondition('age', 'above', [18]), buildCondition('role', 'equals', ['member'])]
		expect(matchesCriteria(row, and)).toBe(false) // role mismatch

		const or = [
			buildCondition('age', 'above', [40]), // false
			buildCondition('role', 'equals', ['admin'], 'or'), // true
		]
		expect(matchesCriteria(row, or)).toBe(true)
	})
})

describe('sortRows', () => {
	it('sorts by direction without mutating the input', () => {
		const rows = [{ n: 3 }, { n: 1 }, { n: 2 }]
		const ascending = sortRows(rows, [{ column: 'n', direction: 'ascending' }])
		expect(ascending.map((row) => row.n)).toEqual([1, 2, 3])
		expect(rows.map((row) => row.n)).toEqual([3, 1, 2]) // untouched

		const descending = sortRows(rows, [{ column: 'n', direction: 'descending' }])
		expect(descending.map((row) => row.n)).toEqual([3, 2, 1])
	})

	it('breaks ties with later terms', () => {
		const rows = [
			{ a: 1, b: 2 },
			{ a: 1, b: 1 },
		]
		const sorted = sortRows(rows, [
			{ column: 'a', direction: 'ascending' },
			{ column: 'b', direction: 'ascending' },
		])
		expect(sorted.map((row) => row.b)).toEqual([1, 2])
	})
})

describe('applyCriteria', () => {
	const rows = [
		{ id: 'a', n: 1 },
		{ id: 'b', n: 2 },
		{ id: 'c', n: 3 },
		{ id: 'd', n: 4 },
	]

	it('filters, sorts, then pages', () => {
		const result = applyCriteria(rows, {
			conditions: [{ column: 'n', operator: 'above', values: [1], connector: 'and' }],
			order: [{ column: 'n', direction: 'descending' }],
			offset: 1,
			limit: 2,
		})
		expect(result.map((row) => row.id)).toEqual(['c', 'b'])
	})

	it('returns rows unchanged with no criteria', () => {
		expect(applyCriteria(rows)).toEqual(rows)
	})
})

describe('computeAggregate', () => {
	const rows = [{ amount: 10 }, { amount: '20' }, { amount: 'x' }, { other: 1 }]

	it('counts every row', () => {
		expect(computeAggregate(rows, 'count', 'amount')).toBe(4)
	})

	it('coerces numeric strings and ignores non-numeric cells', () => {
		expect(computeAggregate(rows, 'sum', 'amount')).toBe(30)
		expect(computeAggregate(rows, 'average', 'amount')).toBe(15)
		expect(computeAggregate(rows, 'minimum', 'amount')).toBe(10)
		expect(computeAggregate(rows, 'maximum', 'amount')).toBe(20)
	})

	it('returns undefined for non-count aggregates over no numeric values', () => {
		expect(computeAggregate([{ a: 'x' }], 'sum', 'a')).toBeUndefined()
		expect(computeAggregate([], 'average', 'a')).toBeUndefined()
	})
})

describe('extractKey', () => {
	it('reads string and finite-number keys, else undefined', () => {
		expect(extractKey({ id: 'u1' }, 'id')).toBe('u1')
		expect(extractKey({ id: 42 }, 'id')).toBe(42)
		expect(extractKey({ id: Number.NaN }, 'id')).toBeUndefined()
		expect(extractKey({}, 'id')).toBeUndefined()
		expect(extractKey({ id: { nested: true } }, 'id')).toBeUndefined()
	})
})

describe('shapeToColumnType', () => {
	it('maps scalar shapes to their portable type', () => {
		expect(shapeToColumnType(stringShape())).toBe('text')
		expect(shapeToColumnType(integerShape())).toBe('integer')
		expect(shapeToColumnType(numberShape())).toBe('real')
		expect(shapeToColumnType(booleanShape())).toBe('boolean')
	})

	it('maps null / object / array / union / json / raw to json', () => {
		expect(shapeToColumnType(nullShape())).toBe('json')
		expect(shapeToColumnType(objectShape({ a: stringShape() }))).toBe('json')
		expect(shapeToColumnType(arrayShape(stringShape()))).toBe('json')
		expect(shapeToColumnType(unionShape(stringShape(), integerShape()))).toBe('json')
		expect(shapeToColumnType(jsonShape())).toBe('json')
		expect(shapeToColumnType(rawShape({ type: 'object' }))).toBe('json')
	})

	it('unwraps optional / nullable to the inner type', () => {
		expect(shapeToColumnType(optionalShape(integerShape()))).toBe('integer')
		expect(shapeToColumnType(nullableShape(stringShape()))).toBe('text')
	})

	it('takes a literal shape from its values', () => {
		expect(shapeToColumnType(literalShape(['a', 'b']))).toBe('text')
		expect(shapeToColumnType(literalShape([1, 2]))).toBe('integer')
		expect(shapeToColumnType(literalShape([1.5, 2]))).toBe('real')
		expect(shapeToColumnType(literalShape([true, false]))).toBe('boolean')
	})
})

describe('columnsToContract', () => {
	it('compiles a column map into its four lockstep contract outputs', () => {
		const contract = columnsToContract({ id: stringShape(), age: integerShape() })
		// A typed row flows through the public overload — this const annotation
		// compiles only while the row is inferred precisely (the TS2589 guard).
		const row: { readonly id: string; readonly age: number } = { id: 'u1', age: 30 }
		expect(contract.is(row)).toBe(true)
		expect(contract.is({ id: 'u1' })).toBe(false)
		expect(contract.parse({ id: 'u1', age: '30' })).toEqual({ id: 'u1', age: 30 })
		expect(contract.schema.type).toBe('object')
		const generated = contract.generate(seededRandom(1))
		expect(typeof generated.id).toBe('string')
		expect(typeof generated.age).toBe('number')
	})

	it('rejects additional properties (a closed object shape)', () => {
		const contract = columnsToContract({ id: stringShape() })
		expect(contract.is({ id: 'u1', extra: true })).toBe(false)
	})
})

describe('isDriverMeta', () => {
	const validSchema: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [{ name: 'id', type: 'text', nullable: false }],
		indexes: [['id']],
	}

	it('accepts a well-formed DriverMeta', () => {
		expect(isDriverMeta({ version: 1, schema: [validSchema] })).toBe(true)
		expect(isDriverMeta({ version: 0, schema: [] })).toBe(true)
	})

	it('rejects a non-record value', () => {
		expect(isDriverMeta(null)).toBe(false)
		expect(isDriverMeta('meta')).toBe(false)
		expect(isDriverMeta([])).toBe(false)
	})

	it('rejects a non-finite version', () => {
		expect(isDriverMeta({ version: Number.NaN, schema: [] })).toBe(false)
		expect(isDriverMeta({ version: Number.POSITIVE_INFINITY, schema: [] })).toBe(false)
		expect(isDriverMeta({ version: '1', schema: [] })).toBe(false)
	})

	it('rejects a schema that is not an array', () => {
		expect(isDriverMeta({ version: 1, schema: {} })).toBe(false)
		expect(isDriverMeta({ version: 1 })).toBe(false)
	})

	it('rejects a table schema with a bad column type', () => {
		const bad = { ...validSchema, columns: [{ name: 'id', type: 'nope', nullable: false }] }
		expect(isDriverMeta({ version: 1, schema: [bad] })).toBe(false)
	})

	it('rejects a table schema with a non-record column', () => {
		const bad = { ...validSchema, columns: ['id'] }
		expect(isDriverMeta({ version: 1, schema: [bad] })).toBe(false)
	})

	it('rejects a table schema with a non-string index entry', () => {
		const bad = { ...validSchema, indexes: [[1]] }
		expect(isDriverMeta({ version: 1, schema: [bad] })).toBe(false)
	})

	it('rejects a table schema that is not a record', () => {
		expect(isDriverMeta({ version: 1, schema: ['users'] })).toBe(false)
	})
})

describe('checkAbort', () => {
	it('is a no-op for undefined and a live signal', () => {
		expect(captureError(() => checkAbort(undefined))).toBeUndefined()
		const controller = new AbortController()
		expect(captureError(() => checkAbort(controller.signal))).toBeUndefined()
	})

	it('throws an ABORTED DatabaseError carrying the reason once the signal has fired', () => {
		const controller = new AbortController()
		controller.abort('too slow')
		const error = captureError(() => checkAbort(controller.signal))
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('ABORTED')
		expect(isDatabaseError(error) ? error.context : undefined).toEqual({ reason: 'too slow' })
	})
})

// Local schema-literal builder — kept file-local since only this file diffs
// TableSchema literals directly (AGENTS §16.1: extract once it serves a
// second file).
function schema(overrides: Partial<TableSchema> & { name: string }): TableSchema {
	return { primary: 'id', columns: [], indexes: [], ...overrides }
}

describe('planMigration', () => {
	it('adds a declared table missing from deployed', () => {
		const users = schema({ name: 'users' })
		const plan = planMigration([], [users])
		expect(plan.steps).toEqual([{ operation: 'table.add', table: users }])
	})

	it('removes a deployed table missing from declared', () => {
		const users = schema({ name: 'users' })
		const plan = planMigration([users], [])
		expect(plan.steps).toEqual([{ operation: 'table.remove', table: 'users' }])
	})

	it('orders steps table.remove, then table.add, before per-table changes', () => {
		const gone = schema({ name: 'gone' })
		const fresh = schema({ name: 'fresh' })
		const shared = schema({
			name: 'shared',
			columns: [{ name: 'age', type: 'integer', nullable: false }],
		})
		const sharedBefore = schema({ name: 'shared' })
		const plan = planMigration([gone, sharedBefore], [fresh, shared])
		expect(plan.steps).toEqual([
			{ operation: 'table.remove', table: 'gone' },
			{ operation: 'table.add', table: fresh },
			{
				operation: 'column.add',
				table: 'shared',
				column: { name: 'age', type: 'integer', nullable: false },
			},
		])
	})

	it('adds and removes columns on a shared table', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', type: 'text', nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', type: 'integer', nullable: true }],
		})
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', type: 'integer', nullable: true },
			},
		])
	})

	it('adds and removes index groups by deep equality of the column-name array', () => {
		const before = schema({ name: 'users', indexes: [['name'], ['a', 'b']] })
		const after = schema({ name: 'users', indexes: [['name'], ['b', 'a']] })
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('produces no steps for identical schemas', () => {
		const users = schema({
			name: 'users',
			columns: [{ name: 'name', type: 'text', nullable: false }],
			indexes: [['name']],
		})
		const plan = planMigration([users], [users])
		expect(plan.steps).toEqual([])
	})

	it('throws a MIGRATION DatabaseError when a shared column changes type', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', type: 'text', nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', type: 'integer', nullable: false }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('users')
	})

	it('throws a MIGRATION DatabaseError when a shared column changes nullability', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', type: 'integer', nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', type: 'integer', nullable: true }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
	})

	it('defaults from to 0 and to to 1', () => {
		const plan = planMigration([], [])
		expect(plan.from).toBe(0)
		expect(plan.to).toBe(1)
	})

	it('honors explicit from / to labels', () => {
		const plan = planMigration([], [], 3, 4)
		expect(plan.from).toBe(3)
		expect(plan.to).toBe(4)
	})
})

describe('migrateRows', () => {
	it('drops a removed column from every row', () => {
		const rows = [
			{ id: 'a', name: 'Ada', legacy: true },
			{ id: 'b', name: 'Grace', legacy: false },
		]
		const result = migrateRows(rows, [
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
		])
		expect(result).toEqual([
			{ id: 'a', name: 'Ada' },
			{ id: 'b', name: 'Grace' },
		])
	})

	it('leaves rows as-is on column.add (no backfill)', () => {
		const rows = [{ id: 'a', name: 'Ada' }]
		const result = migrateRows(rows, [
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', type: 'integer', nullable: true },
			},
		])
		expect(result).toEqual([{ id: 'a', name: 'Ada' }])
		expect(result[0]).not.toHaveProperty('age')
	})

	it('never mutates the input rows', () => {
		const rows = [{ id: 'a', name: 'Ada', legacy: true }]
		const frozen = rows.map((row) => Object.freeze({ ...row }))
		expect(() =>
			migrateRows(frozen, [{ operation: 'column.remove', table: 'users', column: 'legacy' }]),
		).not.toThrow()
		expect(frozen[0]).toEqual({ id: 'a', name: 'Ada', legacy: true })
	})

	it('returns a new (equal) array on an empty step list', () => {
		const rows = [{ id: 'a', name: 'Ada' }]
		const result = migrateRows(rows, [])
		expect(result).toEqual(rows)
		expect(result).not.toBe(rows)
		expect(result[0]).not.toBe(rows[0])
	})

	it('is a no-op for table / index steps', () => {
		const rows = [{ id: 'a', name: 'Ada' }]
		const result = migrateRows(rows, [
			{ operation: 'table.add', table: { name: 'users', primary: 'id', columns: [], indexes: [] } },
			{ operation: 'index.add', table: 'users', index: ['name'] },
		])
		expect(result).toEqual(rows)
	})
})

describe('deepEqual', () => {
	it('compares primitives by SameValueZero (NaN equal to itself)', () => {
		expect(deepEqual(1, 1)).toBe(true)
		expect(deepEqual(1, 2)).toBe(false)
		expect(deepEqual('a', 'a')).toBe(true)
		expect(deepEqual(Number.NaN, Number.NaN)).toBe(true)
		expect(deepEqual(0, -0)).toBe(true)
		expect(deepEqual(undefined, undefined)).toBe(true)
		expect(deepEqual(null, null)).toBe(true)
		expect(deepEqual(null, undefined)).toBe(false)
	})

	it('compares nested objects and arrays structurally', () => {
		expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
		expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
		expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
		expect(deepEqual([1, 2, 3], [1, 2])).toBe(false)
	})

	it('rejects mismatched shapes (array vs object, extra keys)', () => {
		expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false)
		expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
	})

	it('treats a key present with value undefined as NOT equal to that key being absent', () => {
		expect(deepEqual({ a: undefined }, {})).toBe(false)
		expect(deepEqual({}, { a: undefined })).toBe(false)
		expect(deepEqual({ a: undefined }, { a: undefined })).toBe(true)
	})
})

describe('filterRows', () => {
	const rows = [{ age: 30 }, { age: 12 }, { age: 45 }]

	it('matches every row on an empty condition list', () => {
		expect(filterRows(rows, [])).toBe(rows)
	})

	it('filters by the given conditions', () => {
		const result = filterRows(rows, [buildCondition('age', 'above', [18])])
		expect(result.map((row) => row.age)).toEqual([30, 45])
	})
})

describe('conformDriver', () => {
	it('resolves for a conformant driver (the reference memory driver)', async () => {
		await expect(conformDriver(() => createMemoryDriver())).resolves.toBeUndefined()
	})

	it('rejects with a CONFORMANCE DatabaseError when read violates copy-out isolation', async () => {
		function createBrokenDriver(): DriverInterface {
			const inner = createMemoryDriver()
			const stored = new Map<Key, Row>()
			return {
				open: (tables) => inner.open(tables),
				close: () => inner.close(),
				async write(table: string, key: Key, row: Row): Promise<void> {
					await inner.write(table, key, row)
					stored.set(key, row) // stores the reference directly (breaks copy-in)
				},
				async read(table: string, key: Key): Promise<Row | undefined> {
					// Returns the stored reference directly instead of a copy — breaks copy-out.
					if (stored.has(key)) return stored.get(key)
					return inner.read(table, key)
				},
				delete: (table, key) => inner.delete(table, key),
				keys: (table) => inner.keys(table),
				scan: (table) => inner.scan(table),
				clear: (table) => inner.clear(table),
				snapshot: () => inner.snapshot(),
			}
		}
		const error = await conformDriver(() => createBrokenDriver()).catch((caught: unknown) => caught)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
	})

	it('rejects with a CONFORMANCE DatabaseError when keys are not ascending', async () => {
		function createBrokenDriver(): DriverInterface {
			const inner = createMemoryDriver()
			return {
				open: (tables) => inner.open(tables),
				close: () => inner.close(),
				read: (table, key) => inner.read(table, key),
				write: (table, key, row) => inner.write(table, key, row),
				delete: (table, key) => inner.delete(table, key),
				async keys(table: string): Promise<readonly Key[]> {
					return [...(await inner.keys(table))].reverse()
				},
				scan: (table) => inner.scan(table),
				clear: (table) => inner.clear(table),
				snapshot: () => inner.snapshot(),
			}
		}
		const error = await conformDriver(() => createBrokenDriver()).catch((caught: unknown) => caught)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
	})
})

// A driver wrapper violating TWO independent invariants: copy-out isolation
// (phase c) AND reversed key order (phase e) — auditDriver must report BOTH,
// while conformDriver (fail-fast) must report only the first (copy-out).
function createDoublyBrokenDriver(): DriverInterface {
	const inner = createMemoryDriver()
	const stored = new Map<Key, Row>()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		async write(table: string, key: Key, row: Row): Promise<void> {
			await inner.write(table, key, row)
			stored.set(key, row) // stores the reference directly (breaks copy-in/copy-out)
		},
		async read(table: string, key: Key): Promise<Row | undefined> {
			if (stored.has(key)) return stored.get(key)
			return inner.read(table, key)
		},
		delete: (table, key) => inner.delete(table, key),
		async keys(table: string): Promise<readonly Key[]> {
			return [...(await inner.keys(table))].reverse()
		},
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		snapshot: (tables) => inner.snapshot(tables),
	}
}

// A driver whose scan throws an unexpected plain Error mid-phase.
function createCrashingDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		keys: (table) => inner.keys(table),
		scan(): AsyncIterable<Row> {
			throw new Error('scan exploded')
		},
		clear: (table) => inner.clear(table),
		snapshot: (tables) => inner.snapshot(tables),
	}
}

describe('driverFindings', () => {
	it('yields no findings for a conformant driver (the reference memory driver)', async () => {
		const findings: unknown[] = []
		for await (const finding of driverFindings(() => createMemoryDriver())) findings.push(finding)
		expect(findings).toEqual([])
	})

	it('yields lazily — breaking after the first finding never throws and never drains the rest', async () => {
		const collected: string[] = []
		for await (const finding of driverFindings(() => createDoublyBrokenDriver())) {
			collected.push(finding.check)
			break
		}
		expect(collected).toEqual(['copy-in'])
	})

	it('yields a finding (not an escaped throw) when a driver method throws unexpectedly', async () => {
		const findings: { check: string; message: string }[] = []
		for await (const finding of driverFindings(() => createCrashingDriver())) {
			findings.push({ check: finding.check, message: finding.message })
		}
		expect(findings.some((finding) => finding.message === 'scan exploded')).toBe(true)
	})

	it('runs the meta/stamp phase for a driver that implements both hooks (MemoryDriver — landed at validation time) and finds a violation when meta() disagrees with the stamped value', async () => {
		function createMismatchedMetaDriver(): DriverInterface {
			const inner = createMemoryDriver()
			return {
				open: (tables) => inner.open(tables),
				close: () => inner.close(),
				read: (table, key) => inner.read(table, key),
				write: (table, key, row) => inner.write(table, key, row),
				delete: (table, key) => inner.delete(table, key),
				keys: (table) => inner.keys(table),
				scan: (table) => inner.scan(table),
				clear: (table) => inner.clear(table),
				snapshot: (tables) => inner.snapshot(tables),
				async meta() {
					return { version: 99, schema: [] }
				},
				async stamp() {
					// Deliberately ignores the stamped value.
				},
			}
		}
		const findings: string[] = []
		for await (const finding of driverFindings(() => createMismatchedMetaDriver())) {
			findings.push(finding.check)
		}
		expect(findings).toContain('meta-fresh')

		// And the reference MemoryDriver — which now implements meta/stamp — passes cleanly.
		const clean: string[] = []
		for await (const finding of driverFindings(() => createMemoryDriver()))
			clean.push(finding.check)
		expect(clean.some((check) => check.startsWith('meta'))).toBe(false)
	})

	it('runs the scoped-snapshot phase and finds a violation when snapshot rolls back the whole store instead of only the named table', async () => {
		function createWholeStoreSnapshotDriver(): DriverInterface {
			const inner = createMemoryDriver()
			return {
				open: (tables) => inner.open(tables),
				close: () => inner.close(),
				read: (table, key) => inner.read(table, key),
				write: (table, key, row) => inner.write(table, key, row),
				delete: (table, key) => inner.delete(table, key),
				keys: (table) => inner.keys(table),
				scan: (table) => inner.scan(table),
				clear: (table) => inner.clear(table),
				snapshot: () => inner.snapshot(), // ignores the `tables` scope entirely
			}
		}
		const findings: string[] = []
		for await (const finding of driverFindings(() => createWholeStoreSnapshotDriver())) {
			findings.push(finding.check)
		}
		expect(findings).toContain('snapshot-scoped-posts')

		// And the reference MemoryDriver honors the scope and passes cleanly.
		const clean: string[] = []
		for await (const finding of driverFindings(() => createMemoryDriver()))
			clean.push(finding.check)
		expect(clean.some((check) => check.startsWith('snapshot-scoped'))).toBe(false)
	})
})

describe('auditDriver', () => {
	it('returns an empty array for a conformant driver (the reference memory driver)', async () => {
		await expect(auditDriver(() => createMemoryDriver())).resolves.toEqual([])
	})

	it('reports BOTH violations of a driver breaking two independent invariants', async () => {
		const findings = await auditDriver(() => createDoublyBrokenDriver())
		const checks = findings.map((finding) => finding.check)
		expect(checks).toContain('copy-in')
		expect(checks).toContain('keys-order')
	})
})

describe('conformDriver (fail-fast over driverFindings)', () => {
	it('throws only the FIRST violation of a driver breaking two independent invariants', async () => {
		const error = await conformDriver(() => createDoublyBrokenDriver()).catch(
			(caught: unknown) => caught,
		)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
		expect(isDatabaseError(error) ? error.context?.check : undefined).toBe('copy-in')
	})
})

describe('generateUUID', () => {
	const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

	it('produces a canonical lowercase 8-4-4-4-12 hex UUID', () => {
		const uuid = generateUUID(seededRandom(1))
		expect(uuid).toMatch(V4)
		expect(uuid.length).toBe(36)
		expect(uuid[8]).toBe('-')
		expect(uuid[13]).toBe('-')
		expect(uuid[18]).toBe('-')
		expect(uuid[23]).toBe('-')
	})

	it('always forces the version nibble to 4', () => {
		for (let seed = 0; seed < 50; seed++) {
			const uuid = generateUUID(seededRandom(seed))
			expect(uuid[14]).toBe('4')
		}
	})

	it('always forces the variant nibble to 8, 9, a, or b', () => {
		for (let seed = 0; seed < 50; seed++) {
			const uuid = generateUUID(seededRandom(seed))
			expect(['8', '9', 'a', 'b']).toContain(uuid[19])
		}
	})

	it('is deterministic for a given seed', () => {
		expect(generateUUID(seededRandom(42))).toBe(generateUUID(seededRandom(42)))
	})

	it('continues one source sequence across calls, reproducibly', () => {
		const r = seededRandom(7)
		const a = generateUUID(r)
		const b = generateUUID(r)
		expect(a).not.toBe(b)

		const fresh = seededRandom(7)
		expect(generateUUID(fresh)).toBe(a)
		expect(generateUUID(fresh)).toBe(b)
	})

	it('diverges across different seeds', () => {
		const uuids = new Set<string>()
		for (let seed = 1; seed <= 8; seed++) uuids.add(generateUUID(seededRandom(seed)))
		expect(uuids.size).toBe(8)
	})

	it('draws exactly sixteen values from the source per UUID', () => {
		const source = seededRandom(1)
		let count = 0
		function counting(): number {
			count++
			return source()
		}
		generateUUID(counting)
		expect(count).toBe(16)
		generateUUID(counting)
		expect(count).toBe(32)
	})

	it('yields the canonical all-zero UUID from a constant-zero source', () => {
		expect(generateUUID(() => 0)).toBe('00000000-0000-4000-8000-000000000000')
	})

	it('yields the canonical all-f UUID from a saturated source', () => {
		expect(generateUUID(() => 0.9999999999)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
	})

	it('never emits a malformed UUID from out-of-contract sources', () => {
		const hostile = [
			() => 1,
			() => 2,
			() => -0.5,
			() => -1,
			() => Number.NaN,
			() => Number.POSITIVE_INFINITY,
			() => Number.NEGATIVE_INFINITY,
			() => Number.MAX_VALUE,
			() => Number.MIN_VALUE,
			() => Number.EPSILON,
		]
		for (const source of hostile) expect(generateUUID(source)).toMatch(V4)
	})

	it('stays well-formed for boundary seeds', () => {
		const seeds = [0, -1, 2 ** 32 - 1, 2 ** 32, 3.7, -0]
		for (const seed of seeds) expect(generateUUID(seededRandom(seed))).toMatch(V4)
	})

	it('produces no collisions across a large batch from one seeded source', () => {
		const r = seededRandom(123)
		const uuids = new Set<string>()
		for (let i = 0; i < 10_000; i++) uuids.add(generateUUID(r))
		expect(uuids.size).toBe(10_000)
	})

	it('produces distinct first UUIDs across many seeds', () => {
		const uuids = new Set<string>()
		for (let seed = 0; seed < 1000; seed++) uuids.add(generateUUID(seededRandom(seed)))
		expect(uuids.size).toBe(1000)
	})

	it('reaches every hex digit in the free positions over many samples', () => {
		const r = seededRandom(5)
		const seen = new Set<string>()
		for (let i = 0; i < 200; i++) {
			const uuid = generateUUID(r)
			for (let index = 0; index < uuid.length; index++) {
				if (index === 14 || index === 19) continue
				const char = uuid[index]
				if (char === '-') continue
				seen.add(char)
			}
		}
		expect([...seen].sort()).toEqual('0123456789abcdef'.split(''))
	})

	it('produces a well-formed UUID from the default source', () => {
		expect(generateUUID()).toMatch(V4)
	})

	it('produces distinct UUIDs from the default source across calls', () => {
		const uuids = new Set<string>()
		for (let i = 0; i < 100; i++) uuids.add(generateUUID())
		expect(uuids.size).toBe(100)
	})
})
