import type { ColumnSchema, DriverInterface, Key, MigrationStep, Row, TableSchema } from '@src/core'
import {
	applyQuery,
	auditDriver,
	bindRowKey,
	checkAbort,
	compareValues,
	computeAggregate,
	conformDriver,
	createMemoryDriver,
	equalsValue,
	driverFindings,
	extractKey,
	filterRows,
	matchesGlobPattern,
	isDatabaseError,
	isDriverMetadata,
	matchesLikePattern,
	matchesCondition,
	matchesQuery,
	MAX_PATTERN_LENGTH,
	migrateRows,
	normalizeDriverSchema,
	planMigration,
	projectMigrationSchema,
	shapeToColumnSchema,
	shapeToColumnStorage,
	sortRows,
	matchesWildcardPattern,
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

	it('equals/not/any/none use STRUCTURAL equality (equalsValue), not the total-order rank', () => {
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

	it('equals/any use SameValueZero via equalsValue — NaN now equals NaN', () => {
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

describe('matchesLikePattern', () => {
	it('matches % (any run) and _ (any single char), anchored', () => {
		expect(matchesLikePattern('abc', 'a%')).toBe(true)
		expect(matchesLikePattern('xab', 'a%')).toBe(false) // anchored at the start
		expect(matchesLikePattern('abc', 'a_c')).toBe(true)
		expect(matchesLikePattern('ac', 'a_c')).toBe(false) // _ needs exactly one char
	})

	it('is case-insensitive', () => {
		expect(matchesLikePattern('Alice', 'al%')).toBe(true)
	})

	it('treats every non-wildcard char as a LITERAL (no metacharacter hazard)', () => {
		// A literal '.' matches a dot, not any char — the regex-escape hazard is gone with the regex.
		expect(matchesLikePattern('a.c', 'a.c')).toBe(true)
		expect(matchesLikePattern('abc', 'a.c')).toBe(false)
		// '(' / '[' / '\' / '+' are plain literals.
		expect(matchesLikePattern('a(b', 'a(b')).toBe(true)
		expect(matchesLikePattern('a[b', 'a[b')).toBe(true)
		expect(matchesLikePattern('a\\b', 'a\\b')).toBe(true)
		expect(matchesLikePattern('a+b', 'a+b')).toBe(true)
		expect(matchesLikePattern('aaab', 'a+b')).toBe(false)
	})

	it('a % run behaves as a single any-run (a%%%b ≡ a%b)', () => {
		expect(matchesLikePattern('axyzb', 'a%%%b')).toBe(true)
		expect(matchesLikePattern('ab', 'a%%%b')).toBe(true)
		expect(matchesLikePattern('axb', 'a%%%b')).toBe(true)
		expect(matchesLikePattern('axc', 'a%%%b')).toBe(false)
		// Equivalent to the single-% form on the same inputs.
		expect(matchesLikePattern('axyzb', 'a%%%%%%b')).toBe(matchesLikePattern('axyzb', 'a%b'))
		expect(matchesLikePattern('ab', 'a%%%%%%b')).toBe(matchesLikePattern('ab', 'a%b'))
	})

	it('_ runs require exactly that many chars (a__b ≠ a_b)', () => {
		expect(matchesLikePattern('axyb', 'a__b')).toBe(true)
		expect(matchesLikePattern('axb', 'a__b')).toBe(false) // two chars required
		expect(matchesLikePattern('axb', 'a_b')).toBe(true) // exactly one char
	})

	it('a wildcard char is ALWAYS a wildcard, even when the value contains it literally', () => {
		// `any` is tested before a literal match, so a value '%' never shadows the pattern's %.
		expect(matchesLikePattern('a%b', 'a%b')).toBe(true)
		expect(matchesLikePattern('axb', 'a%b')).toBe(true)
	})
})

describe('matchesGlobPattern', () => {
	it('matches * (any run) and ? (any single char), anchored', () => {
		expect(matchesGlobPattern('abc', 'a*')).toBe(true)
		expect(matchesGlobPattern('xab', 'a*')).toBe(false)
		expect(matchesGlobPattern('abc', 'a?c')).toBe(true)
		expect(matchesGlobPattern('ac', 'a?c')).toBe(false)
	})

	it('is case-SENSITIVE (unlike LIKE)', () => {
		expect(matchesGlobPattern('Alice', 'Al*')).toBe(true)
		expect(matchesGlobPattern('Alice', 'al*')).toBe(false)
	})

	it('treats every non-wildcard char as a literal', () => {
		expect(matchesGlobPattern('a.c', 'a.c')).toBe(true)
		expect(matchesGlobPattern('abc', 'a.c')).toBe(false)
		expect(matchesGlobPattern('a(b', 'a(b')).toBe(true)
		expect(matchesGlobPattern('a\\b', 'a\\b')).toBe(true)
	})

	it('a * run behaves as a single any-run (a***b ≡ a*b)', () => {
		expect(matchesGlobPattern('axyzb', 'a***b')).toBe(true)
		expect(matchesGlobPattern('ab', 'a***b')).toBe(true)
		expect(matchesGlobPattern('axc', 'a***b')).toBe(false)
		expect(matchesGlobPattern('axyzb', 'a******b')).toBe(matchesGlobPattern('axyzb', 'a*b'))
	})

	it('? runs require exactly that many chars (a??b ≠ a?b)', () => {
		expect(matchesGlobPattern('axyb', 'a??b')).toBe(true)
		expect(matchesGlobPattern('axb', 'a??b')).toBe(false)
		expect(matchesGlobPattern('axb', 'a?b')).toBe(true)
	})
})

describe('matchesWildcardPattern — the linear, ReDoS-safe engine', () => {
	it('matches generically with the injected wildcard chars + fold flag', () => {
		expect(matchesWildcardPattern('abc', 'a%', '%', '_', false)).toBe(true)
		expect(matchesWildcardPattern('ABC', 'a%', '%', '_', true)).toBe(true) // fold
		expect(matchesWildcardPattern('ABC', 'a%', '%', '_', false)).toBe(false) // no fold
		expect(matchesWildcardPattern('axc', 'a_c', '%', '_', false)).toBe(true)
	})

	it('rejects an over-length pattern with a VALIDATION DatabaseError', () => {
		const long = 'a'.repeat(MAX_PATTERN_LENGTH + 1)
		const error = captureError(() => matchesWildcardPattern('x', long, '%', '_', false))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('VALIDATION')
		// A pattern exactly at the cap is accepted (no throw).
		expect(() =>
			matchesWildcardPattern('x', 'a'.repeat(MAX_PATTERN_LENGTH), '%', '_', false),
		).not.toThrow()
	})

	it('a huge any-run is fine — the matcher is LINEAR (only the length is capped, not the count)', () => {
		// 1000 consecutive % (well under the length cap) behave as one any-run, fast — no
		// wildcard-COUNT cap is needed, because the matcher never backtracks like a regex.
		expect(matchesLikePattern('aXYZb', `a${'%'.repeat(1000)}b`)).toBe(true)
		expect(matchesLikePattern('ab', `a${'%'.repeat(1000)}b`)).toBe(true)
	})

	it('bounds the catastrophic-backtracking SHAPE in well under a few milliseconds', () => {
		// The classic ReDoS shape a JS regex CANNOT bound: many any-run wildcards SEPARATED BY
		// LITERALS (the equivalent regex `^a.*a.*…a.*X$`), matched against a long input that never
		// ends in the required suffix — a forced full non-match. A backtracking regex blows up
		// super-linearly here (it HANGS); the linear greedy matcher is O(value × pattern).
		const hostilePattern = `${'a%'.repeat(300)}X` // 300 any-runs separated by literals
		const hostileInput = 'a'.repeat(20_000)
		const started = performance.now()
		const matched = matchesLikePattern(hostileInput, hostilePattern)
		const elapsed = performance.now() - started
		expect(matched).toBe(false)
		// A backtracking regex takes seconds-to-forever; the linear matcher finishes near-instantly.
		// A generous ceiling leaves no room for a blow-up while staying robust on a slow CI box.
		expect(elapsed).toBeLessThan(200)
	})
})

describe('matchesQuery', () => {
	const row = { age: 30, role: 'admin' }

	it('matches every row on an empty condition list', () => {
		expect(matchesQuery(row, [])).toBe(true)
	})

	it('folds conditions left-to-right by connector', () => {
		const and = [buildCondition('age', 'above', [18]), buildCondition('role', 'equals', ['member'])]
		expect(matchesQuery(row, and)).toBe(false) // role mismatch

		const or = [
			buildCondition('age', 'above', [40]), // false
			buildCondition('role', 'equals', ['admin'], 'or'), // true
		]
		expect(matchesQuery(row, or)).toBe(true)
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

describe('applyQuery', () => {
	const rows = [
		{ id: 'a', n: 1 },
		{ id: 'b', n: 2 },
		{ id: 'c', n: 3 },
		{ id: 'd', n: 4 },
	]

	it('filters, sorts, then pages', () => {
		const result = applyQuery(rows, {
			conditions: [{ column: 'n', operator: 'above', values: [1], connector: 'and' }],
			order: [{ column: 'n', direction: 'descending' }],
			offset: 1,
			limit: 2,
		})
		expect(result.map((row) => row.id)).toEqual(['c', 'b'])
	})

	it('returns rows unchanged with no input', () => {
		expect(applyQuery(rows)).toEqual(rows)
	})

	it('validates paging before applying it and accepts zero', () => {
		expect(() => applyQuery(rows, { limit: -1 })).toThrow(
			'Query limit must be a nonnegative integer',
		)
		expect(() => applyQuery(rows, { offset: Number.POSITIVE_INFINITY })).toThrow(
			'Query offset must be a nonnegative integer',
		)
		expect(applyQuery(rows, { limit: 0, offset: 0 })).toEqual([])
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

describe('bindRowKey', () => {
	it('returns a fresh row with the storage key authoritative for any primary name', () => {
		const input = { slug: 'caller', title: 'Hello' }
		expect(bindRowKey(input, 'slug', 'stored')).toEqual({ slug: 'stored', title: 'Hello' })
		expect(input).toEqual({ slug: 'caller', title: 'Hello' })
	})
})

describe('shapeToColumnStorage', () => {
	it('maps scalar shapes to their portable type', () => {
		expect(shapeToColumnStorage(stringShape())).toBe('text')
		expect(shapeToColumnStorage(integerShape())).toBe('integer')
		expect(shapeToColumnStorage(numberShape())).toBe('real')
		expect(shapeToColumnStorage(booleanShape())).toBe('boolean')
	})

	it('maps null / object / array / union / json / raw to json', () => {
		expect(shapeToColumnStorage(nullShape())).toBe('json')
		expect(shapeToColumnStorage(objectShape({ a: stringShape() }))).toBe('json')
		expect(shapeToColumnStorage(arrayShape(stringShape()))).toBe('json')
		expect(shapeToColumnStorage(unionShape(stringShape(), integerShape()))).toBe('json')
		expect(shapeToColumnStorage(jsonShape())).toBe('json')
		expect(shapeToColumnStorage(rawShape({ type: 'object' }))).toBe('json')
	})

	it('unwraps optional / nullable to the inner type', () => {
		expect(shapeToColumnStorage(optionalShape(integerShape()))).toBe('integer')
		expect(shapeToColumnStorage(nullableShape(stringShape()))).toBe('text')
	})

	it('takes a literal shape from its values', () => {
		expect(shapeToColumnStorage(literalShape(['a', 'b']))).toBe('text')
		expect(shapeToColumnStorage(literalShape([1, 2]))).toBe('integer')
		expect(shapeToColumnStorage(literalShape([1.5, 2]))).toBe('real')
		expect(shapeToColumnStorage(literalShape([true, false]))).toBe('boolean')
	})
})

describe('shapeToColumnSchema', () => {
	it('derives absence and null acceptance independently from the compiled contract', () => {
		expect(shapeToColumnSchema('value', stringShape())).toEqual({
			name: 'value',
			storage: 'text',
			optional: false,
			nullable: false,
		})
		expect(shapeToColumnSchema('value', optionalShape(stringShape()))).toEqual({
			name: 'value',
			storage: 'text',
			optional: true,
			nullable: false,
		})
		expect(shapeToColumnSchema('value', nullableShape(stringShape()))).toEqual({
			name: 'value',
			storage: 'text',
			optional: false,
			nullable: true,
		})
		expect(shapeToColumnSchema('value', optionalShape(nullableShape(stringShape())))).toEqual({
			name: 'value',
			storage: 'text',
			optional: true,
			nullable: true,
		})
	})
})

describe('isDriverMetadata', () => {
	const validSchema: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [['id']],
	}

	it('accepts a well-formed DriverMetadata', () => {
		expect(isDriverMetadata({ version: 1, schema: [validSchema] })).toBe(true)
		expect(isDriverMetadata({ version: 0, schema: [] })).toBe(true)
	})

	it('rejects a non-record value', () => {
		expect(isDriverMetadata(null)).toBe(false)
		expect(isDriverMetadata('invalid')).toBe(false)
		expect(isDriverMetadata([])).toBe(false)
	})

	it('rejects a non-finite version', () => {
		expect(isDriverMetadata({ version: Number.NaN, schema: [] })).toBe(false)
		expect(isDriverMetadata({ version: Number.POSITIVE_INFINITY, schema: [] })).toBe(false)
		expect(isDriverMetadata({ version: '1', schema: [] })).toBe(false)
	})

	it('rejects a schema that is not an array', () => {
		expect(isDriverMetadata({ version: 1, schema: {} })).toBe(false)
		expect(isDriverMetadata({ version: 1 })).toBe(false)
	})

	it('rejects a table schema with a bad column type', () => {
		const bad = {
			...validSchema,
			columns: [{ name: 'id', storage: 'nope', optional: false, nullable: false }],
		}
		expect(isDriverMetadata({ version: 1, schema: [bad] })).toBe(false)
	})

	it('rejects a table schema with a non-record column', () => {
		const bad = { ...validSchema, columns: ['id'] }
		expect(isDriverMetadata({ version: 1, schema: [bad] })).toBe(false)
	})

	it('rejects a table schema with a non-string index entry', () => {
		const bad = { ...validSchema, indexes: [[1]] }
		expect(isDriverMetadata({ version: 1, schema: [bad] })).toBe(false)
	})

	it('rejects a table schema that is not a record', () => {
		expect(isDriverMetadata({ version: 1, schema: ['users'] })).toBe(false)
	})

	it('returns false for hostile root and nested reads', () => {
		const fault = new Error('hostile read')
		const root = Object.defineProperty({ schema: [] }, 'version', {
			enumerable: true,
			get: () => {
				throw fault
			},
		})
		const nested = {
			version: 1,
			schema: [
				Object.defineProperty({ primary: 'id', columns: [], indexes: [] }, 'name', {
					enumerable: true,
					get: () => {
						throw fault
					},
				}),
			],
		}
		const proxy = Proxy.revocable({ version: 1, schema: [] }, {})
		proxy.revoke()

		expect(isDriverMetadata(root)).toBe(false)
		expect(isDriverMetadata(nested)).toBe(false)
		expect(isDriverMetadata(proxy.proxy)).toBe(false)
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

describe('normalizeDriverSchema', () => {
	it('owns, sorts, and deeply freezes tables, columns, and index lists without mutating input', () => {
		const users = schema({
			name: 'users',
			columns: [
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: true, nullable: false },
			],
			indexes: [['name'], ['age', 'name']],
		})
		const posts = schema({ name: 'posts' })
		const input = [users, posts]
		const normalized = normalizeDriverSchema(input)

		expect(input).toEqual([users, posts])
		expect(normalized.map((table) => table.name)).toEqual(['posts', 'users'])
		expect(normalized[1]?.columns.map((column) => column.name)).toEqual(['age', 'id', 'name'])
		expect(normalized[1]?.indexes).toEqual([['age', 'name'], ['name']])
		expect(normalized).not.toBe(input)
		expect(normalized[1]).not.toBe(users)
		expect(normalized[1]?.columns).not.toBe(users.columns)
		expect(normalized[1]?.indexes).not.toBe(users.indexes)
		expect(Object.isFrozen(normalized)).toBe(true)
		expect(Object.isFrozen(normalized[1])).toBe(true)
		expect(Object.isFrozen(normalized[1]?.columns)).toBe(true)
		expect(Object.isFrozen(normalized[1]?.indexes[0])).toBe(true)
	})

	it('rejects malformed input through the driver-schema validation boundary', () => {
		expect(captureError(() => normalizeDriverSchema([{ name: 'users' }]))).toMatchObject({
			code: 'VALIDATION',
			context: { path: 'schema' },
		})
	})
})

// Local schema-literal builder — kept file-local since only this file diffs
// TableSchema literals directly (AGENTS §16.1: extract once it serves a
// second file).
function schema(overrides: Partial<TableSchema> & { name: string }): TableSchema {
	const columns: readonly ColumnSchema[] = [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		...(overrides.columns ?? []),
	]
	return { primary: 'id', indexes: [], ...overrides, columns }
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
			columns: [{ name: 'age', storage: 'integer', optional: true, nullable: false }],
		})
		const sharedBefore = schema({ name: 'shared' })
		const plan = planMigration([gone, sharedBefore], [fresh, shared])
		expect(plan.steps).toEqual([
			{ operation: 'table.remove', table: 'gone' },
			{ operation: 'table.add', table: fresh },
			{
				operation: 'column.add',
				table: 'shared',
				column: { name: 'age', storage: 'integer', optional: true, nullable: false },
			},
		])
	})

	it('adds and removes columns on a shared table', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', storage: 'text', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: true }],
		})
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', storage: 'integer', optional: false, nullable: true },
			},
		])
	})

	it('adds and removes index groups by deep equality of the column-name array', () => {
		const columns: readonly ColumnSchema[] = [
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'a', storage: 'text', optional: false, nullable: false },
			{ name: 'b', storage: 'text', optional: false, nullable: false },
		]
		const before = schema({ name: 'users', columns, indexes: [['name'], ['a', 'b']] })
		const after = schema({ name: 'users', columns, indexes: [['name'], ['b', 'a']] })
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('produces no steps for identical schemas', () => {
		const users = schema({
			name: 'users',
			columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
			indexes: [['name']],
		})
		const plan = planMigration([users], [users])
		expect(plan.steps).toEqual([])
	})

	it('produces no steps when only table, column, and index-list order differs', () => {
		const users = schema({
			name: 'users',
			columns: [
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: true, nullable: false },
			],
			indexes: [['name'], ['age', 'name']],
		})
		const posts = schema({ name: 'posts' })
		const reorderedUsers: TableSchema = {
			...users,
			columns: [...users.columns].reverse(),
			indexes: [...users.indexes].reverse(),
		}
		expect(planMigration([users, posts], [posts, reorderedUsers]).steps).toEqual([])
	})

	it('preserves compound-index column order as migration-significant', () => {
		const columns: readonly ColumnSchema[] = [
			{ name: 'a', storage: 'text', optional: false, nullable: false },
			{ name: 'b', storage: 'text', optional: false, nullable: false },
		]
		const before = schema({ name: 'users', columns, indexes: [['a', 'b']] })
		const after = schema({ name: 'users', columns, indexes: [['b', 'a']] })
		expect(planMigration([before], [after]).steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('rejects adding a required non-null column to an existing table', () => {
		const before = schema({ name: 'users' })
		const after = schema({
			name: 'users',
			columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(error).toMatchObject({
			code: 'MIGRATION',
			message:
				"migrate: required non-null column 'name' cannot be added automatically to existing table 'users'",
			context: { table: 'users', column: 'name' },
		})
	})

	it('throws a MIGRATION DatabaseError when a shared column changes type', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'text', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('users')
	})

	it('throws a MIGRATION DatabaseError when a shared column changes nullability', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: true }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
	})

	it('throws MIGRATION when a shared table changes primary or a column changes optionality', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const primary = { ...before, primary: 'age' }
		const optional = {
			...before,
			columns: before.columns.map((column) =>
				column.name === 'age' ? { ...column, optional: true } : column,
			),
		}
		expect(captureError(() => planMigration([before], [primary]))).toMatchObject({
			code: 'MIGRATION',
		})
		expect(captureError(() => planMigration([before], [optional]))).toMatchObject({
			code: 'MIGRATION',
		})
	})

	it('removes dependent indexes before removing their columns', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', storage: 'text', optional: false, nullable: false }],
			indexes: [['legacy']],
		})
		const after = schema({ name: 'users' })
		expect(planMigration([before], [after]).steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['legacy'] },
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
		])
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

describe('projectMigrationSchema', () => {
	const users = schema({
		name: 'users',
		columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
		indexes: [['name']],
	})

	it('projects ordered table, column, and index transitions to a fresh valid schema', () => {
		const result = projectMigrationSchema(
			[users],
			[
				{ operation: 'index.remove', table: 'users', index: ['name'] },
				{ operation: 'column.remove', table: 'users', column: 'name' },
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'age', storage: 'integer', optional: true, nullable: false },
				},
				{ operation: 'index.add', table: 'users', index: ['age'] },
			],
		)
		expect(result).toEqual([
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'age', storage: 'integer', optional: true, nullable: false },
					{ name: 'id', storage: 'text', optional: false, nullable: false },
				],
				indexes: [['age']],
			},
		])
		expect(result[0]).not.toBe(users)
	})

	it('rejects invalid sequential transitions before publishing a schema', () => {
		const cases: ReadonlyArray<readonly MigrationStep[]> = [
			[{ operation: 'table.remove', table: 'missing' }],
			[{ operation: 'column.remove', table: 'users', column: 'id' }],
			[{ operation: 'column.remove', table: 'users', column: 'name' }],
			[{ operation: 'index.add', table: 'users', index: ['missing'] }],
			[{ operation: 'index.remove', table: 'users', index: ['id'] }],
		]
		for (const steps of cases) {
			expect(captureError(() => projectMigrationSchema([users], steps))).toMatchObject({
				code: 'MIGRATION',
			})
		}
	})

	it('accepts optional-only and nullable-only additions but rejects required non-null additions', () => {
		const optional = projectMigrationSchema(
			[users],
			[
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'optional', storage: 'text', optional: true, nullable: false },
				},
			],
		)
		const nullable = projectMigrationSchema(
			[users],
			[
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'nullable', storage: 'text', optional: false, nullable: true },
				},
			],
		)
		expect(optional[0]?.columns.some((column) => column.name === 'optional')).toBe(true)
		expect(nullable[0]?.columns.some((column) => column.name === 'nullable')).toBe(true)
		expect(
			captureError(() =>
				projectMigrationSchema(
					[users],
					[
						{
							operation: 'column.add',
							table: 'users',
							column: {
								name: 'required',
								storage: 'text',
								optional: false,
								nullable: false,
							},
						},
					],
				),
			),
		).toMatchObject({ code: 'MIGRATION', context: { table: 'users', column: 'required' } })
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
				column: { name: 'age', storage: 'integer', optional: false, nullable: true },
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

describe('equalsValue', () => {
	it('compares primitives by SameValueZero (NaN equal to itself)', () => {
		expect(equalsValue(1, 1)).toBe(true)
		expect(equalsValue(1, 2)).toBe(false)
		expect(equalsValue('a', 'a')).toBe(true)
		expect(equalsValue(Number.NaN, Number.NaN)).toBe(true)
		expect(equalsValue(0, -0)).toBe(true)
		expect(equalsValue(undefined, undefined)).toBe(true)
		expect(equalsValue(null, null)).toBe(true)
		expect(equalsValue(null, undefined)).toBe(false)
	})

	it('compares nested objects and arrays structurally', () => {
		expect(equalsValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
		expect(equalsValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
		expect(equalsValue([1, 2, 3], [1, 2, 3])).toBe(true)
		expect(equalsValue([1, 2, 3], [1, 2])).toBe(false)
	})

	it('rejects mismatched shapes (array vs object, extra keys)', () => {
		expect(equalsValue([1, 2], { 0: 1, 1: 2 })).toBe(false)
		expect(equalsValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
	})

	it('treats a key present with value undefined as NOT equal to that key being absent', () => {
		expect(equalsValue({ a: undefined }, {})).toBe(false)
		expect(equalsValue({}, { a: undefined })).toBe(false)
		expect(equalsValue({ a: undefined }, { a: undefined })).toBe(true)
	})

	it('terminates for equal and unequal self-referential containers', () => {
		const left: Record<string, unknown> = { label: 'same' }
		const right: Record<string, unknown> = { label: 'same' }
		left.self = left
		right.self = right
		expect(equalsValue(left, right)).toBe(true)
		right.label = 'different'
		expect(equalsValue(left, right)).toBe(false)

		const leftArray: unknown[] = []
		const rightArray: unknown[] = []
		leftArray.push(leftArray)
		rightArray.push(rightArray)
		expect(equalsValue(leftArray, rightArray)).toBe(true)
		rightArray.push('extra')
		expect(equalsValue(leftArray, rightArray)).toBe(false)
	})

	it('terminates for equal and unequal mutually cyclic graphs through matchesCondition', () => {
		const leftRoot: Record<string, unknown> = { label: 'root' }
		const leftChild: Record<string, unknown> = { label: 'child', parent: leftRoot }
		leftRoot.child = leftChild
		const rightRoot: Record<string, unknown> = { label: 'root' }
		const rightChild: Record<string, unknown> = { label: 'child', parent: rightRoot }
		rightRoot.child = rightChild

		expect(
			matchesCondition(
				{ graph: leftRoot },
				{ column: 'graph', operator: 'equals', values: [rightRoot], connector: 'and' },
			),
		).toBe(true)
		rightChild.label = 'changed'
		expect(
			matchesCondition(
				{ graph: leftRoot },
				{ column: 'graph', operator: 'equals', values: [rightRoot], connector: 'and' },
			),
		).toBe(false)
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

function createReferenceLeakingDriver(): DriverInterface {
	const inner = createMemoryDriver()
	const stored = new Map<Key, Row>()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		async write(table: string, key: Key, row: Row): Promise<void> {
			await inner.write(table, key, row)
			stored.set(key, row)
		},
		insert: (table, key, row) => inner.insert(table, key, row),
		async read(table: string, key: Key): Promise<Row | undefined> {
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

function createDescendingKeyDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		insert: (table, key, row) => inner.insert(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		async keys(table: string): Promise<readonly Key[]> {
			return [...(await inner.keys(table))].reverse()
		},
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		snapshot: () => inner.snapshot(),
	}
}

function createMismatchedMetadataDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		insert: (table, key, row) => inner.insert(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		keys: (table) => inner.keys(table),
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		snapshot: (tables) => inner.snapshot(tables),
		async metadata() {
			return { version: 99, schema: [] }
		},
		async stamp() {
			// Deliberately ignores the stamped value.
		},
	}
}

function createWholeSnapshotDriver(): DriverInterface {
	const inner = createMemoryDriver()
	return {
		open: (tables) => inner.open(tables),
		close: () => inner.close(),
		read: (table, key) => inner.read(table, key),
		write: (table, key, row) => inner.write(table, key, row),
		insert: (table, key, row) => inner.insert(table, key, row),
		delete: (table, key) => inner.delete(table, key),
		keys: (table) => inner.keys(table),
		scan: (table) => inner.scan(table),
		clear: (table) => inner.clear(table),
		snapshot: () => inner.snapshot(),
	}
}

describe('conformDriver', () => {
	it('resolves for a conformant driver (the reference memory driver)', async () => {
		await expect(conformDriver(() => createMemoryDriver())).resolves.toBeUndefined()
	})

	it('rejects with a CONFORMANCE DatabaseError when read violates copy-out isolation', async () => {
		const error = await conformDriver(() => createReferenceLeakingDriver()).catch(
			(caught: unknown) => caught,
		)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
	})

	it('rejects with a CONFORMANCE DatabaseError when keys are not ascending', async () => {
		const error = await conformDriver(() => createDescendingKeyDriver()).catch(
			(caught: unknown) => caught,
		)
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
		insert: (table, key, row) => inner.insert(table, key, row),
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
		insert: (table, key, row) => inner.insert(table, key, row),
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
		const findings: Array<{ check: string; message: string }> = []
		for await (const finding of driverFindings(() => createCrashingDriver())) {
			findings.push({ check: finding.check, message: finding.message })
		}
		expect(findings.some((finding) => finding.message === 'scan exploded')).toBe(true)
	})

	it('runs the metadata/stamp phase for a driver that implements both hooks and finds a mismatched read', async () => {
		const findings: string[] = []
		for await (const finding of driverFindings(() => createMismatchedMetadataDriver())) {
			findings.push(finding.check)
		}
		expect(findings).toContain('metadata-fresh')

		// And the reference MemoryDriver — which implements metadata/stamp — passes cleanly.
		const clean: string[] = []
		for await (const finding of driverFindings(() => createMemoryDriver()))
			clean.push(finding.check)
		expect(clean.some((check) => check.startsWith('metadata'))).toBe(false)
	})

	it('runs the scoped-snapshot phase and finds a violation when snapshot rolls back the whole store instead of only the named table', async () => {
		const findings: string[] = []
		for await (const finding of driverFindings(() => createWholeSnapshotDriver())) {
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
