import type { TableSchema } from '@src/core'
import {
	CONDITION_ROW,
	QUERY_ROW,
	PAGE_ROWS,
	AGGREGATE_ROWS,
	VALID_SCHEMA,
	FILTER_ROWS,
} from '../../setup.js'
import {
	applyQuery,
	captureFailure,
	collectScalars,
	applyKeys,
	buildBatch,
	computeFirstIndexes,
	computeRemoved,
	normalizeReadInput,
	scanPlans,
	CONFORMANCE_ROWS,
	CONFORMANCE_SCHEMA,
	findPlanFaults,
	foldASCII,
	matchesListed,
	planRead,
	prepareScalars,
	readPlannedAggregate,
	readPlannedRows,
	streamPlannedRows,
	auditDriver,
	buildFailureFinding,
	bindRowKey,
	checkAbort,
	compareValues,
	computeAggregate,
	conformDriver,
	createMemoryDriver,
	equalsValue,
	scanDriver,
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
	requireColumns,
	resolvePrimary,
	findColumn,
	shapeToColumnSchema,
	shapeToColumnStorage,
	sortRows,
	validatePage,
	matchesWildcardPattern,
	matchesWildcardSegment,
	StorageRecorder,
	collectColumns,
	findIllFormedColumn,
	extractColumnHead,
	maskUndefinedOperands,
	matchesIllFormedText,
	restoreUndefinedOperands,
	scanAggregateFaults,
	streamRecordedRows,
	StreamPage,
	scanColumnFaults,
	scanConditionFaults,
	scanOperandFaults,
	scanQueryFaults,
	tallyCalls,
} from '@src/core'
import {
	arrayShape,
	booleanShape,
	FAULT_LIMIT,
	integerShape,
	jsonShape,
	literalShape,
	nullableShape,
	nullShape,
	numberShape,
	objectShape,
	optionalShape,
	rawShape,
	shapeShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import { captureError, collect, createRecorder, invokeUnchecked } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	buildCondition,
	createReferenceLeakingDriver,
	createDescendingKeyDriver,
	createMismatchedMetadataDriver,
	createPartialBatchDriver,
	createDoublyBrokenDriver,
	createCrashingDriver,
	createMemoryAdapter,
	createPlannedDriver,
	createRefusingDriver,
	seedConformanceRows,
	streamThenFail,
	tableSchemas,
} from '../../setup.js'

// `buildCondition` (tests/setup.ts) builds one condition with the seed connector
// — the connector is irrelevant for a single-condition match (it only matters
// when folding a list).

describe('captureFailure', () => {
	it('preserves synchronous throws and rejections and returns absence on fulfillment', async () => {
		const reason = Symbol('failure')
		expect(await captureFailure(() => Promise.reject(reason))).toBe(reason)
		expect(
			await captureFailure(() => {
				throw reason
			}),
		).toBe(reason)
		expect(await captureFailure(() => Promise.resolve('success'))).toBeUndefined()
		expect(await captureFailure(() => Promise.reject(undefined))).toBeUndefined()
	})
})

describe('validatePage', () => {
	it.each([
		{ field: 'limit', value: -1, diagnostic: -1 },
		{ field: 'limit', value: 1.5, diagnostic: 1.5 },
		{ field: 'limit', value: Number.NaN, diagnostic: 'NaN' },
		{ field: 'limit', value: Number.POSITIVE_INFINITY, diagnostic: 'Infinity' },
		{ field: 'offset', value: -1, diagnostic: -1 },
		{ field: 'offset', value: 1.5, diagnostic: 1.5 },
		{ field: 'offset', value: Number.NaN, diagnostic: 'NaN' },
		{ field: 'offset', value: Number.POSITIVE_INFINITY, diagnostic: 'Infinity' },
	])(
		'rejects invalid $field page value $value without JSON null coercion',
		({ field, value, diagnostic }) => {
			const input = field === 'limit' ? { limit: value } : { offset: value }
			const error = captureError(() => validatePage(input))

			expect(error).toMatchObject({
				code: 'VALIDATION',
				message: `Query ${field} must be a nonnegative integer`,
				context: { field, value: diagnostic },
			})
			expect(JSON.stringify(error)).toContain(JSON.stringify(diagnostic))
			expect(JSON.stringify(error)).not.toContain('"value":null')
		},
	)

	it('checks limit before offset and accepts zero for both fields', () => {
		expect(() => validatePage({ limit: 0, offset: 0 })).not.toThrow()
		expect(() => validatePage()).not.toThrow()
		expect(() => validatePage({ limit: -1, offset: -1 })).toThrow(
			'Query limit must be a nonnegative integer',
		)
	})
})

describe('findColumn', () => {
	it('reads a declared column and reports an undeclared one as absent', () => {
		const declared: TableSchema = {
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: true, nullable: false },
			],
			indexes: [],
		}
		expect(findColumn('age', declared)).toEqual({
			name: 'age',
			storage: 'integer',
			optional: true,
			nullable: false,
		})
		expect(findColumn('missing', declared)).toBeUndefined()
	})
})

describe('resolvePrimary', () => {
	it('reads an override and falls back to the default primary column', () => {
		expect(resolvePrimary({ posts: 'slug' }, 'posts')).toBe('slug')
		expect(resolvePrimary({ posts: 'slug' }, 'users')).toBe('id')
		expect(resolvePrimary({}, 'users')).toBe('id')
	})
})

describe('requireColumns', () => {
	it('bounds an undeclared table name in the refusal', () => {
		const name = 'x'.repeat(100_000)
		const error = captureError(() => requireColumns({}, name))
		expect(isDatabaseError(error)).toBe(true)
		if (!isDatabaseError(error)) throw error
		expect(error.message.length).toBeLessThan(300)
		expect(error).toMatchObject({ code: 'NOT_FOUND', context: { table: name } })
	})
	it('reads a declared table and throws NOT_FOUND for an undeclared one', () => {
		const tables = { users: { id: stringShape() } }
		expect(requireColumns(tables, 'users')).toBe(tables.users)
		expect(captureError(() => requireColumns(tables, 'posts'))).toMatchObject({
			code: 'NOT_FOUND',
			context: { table: 'posts' },
		})
	})
})

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
	const row = CONDITION_ROW

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

	it('equals/any use SameValueZero by using equalsValue — NaN now equals NaN', () => {
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

describe('matchesWildcardSegment', () => {
	it('matches each code point literally or through the single wildcard at the offset', () => {
		expect(matchesWildcardSegment(Array.from('hello'), Array.from('l_o'), 2, '_')).toBe(true)
		expect(matchesWildcardSegment(Array.from('hello'), Array.from('l_o'), 1, '_')).toBe(false)
		expect(matchesWildcardSegment(Array.from('hello'), [], 5, '_')).toBe(true)
	})

	it('fails an offset that leaves the segment outside the value', () => {
		expect(matchesWildcardSegment(Array.from('hello'), Array.from('lo'), 4, '_')).toBe(false)
		expect(matchesWildcardSegment(Array.from('hello'), Array.from('he'), -1, '_')).toBe(false)
	})

	it('compares code points, so the single wildcard spans a whole astral character', () => {
		expect(matchesWildcardSegment(Array.from('😀'), ['_'], 0, '_')).toBe(true)
		expect(matchesWildcardSegment(Array.from('😀'), ['_', '_'], 0, '_')).toBe(false)
	})
})

describe('matchesWildcardPattern — the linear, ReDoS-safe engine', () => {
	it('reads a wildcard char longer or shorter than one unit as a literal, as the base did', () => {
		// Base c8b95c5 src/core/helpers.ts:277 compared one pattern unit with `any`, so `XX` never matched.
		expect(matchesWildcardPattern('ab', 'aXXb', 'XX', '?', false)).toBe(false)
		expect(matchesWildcardPattern('aXXb', 'aXXb', 'XX', '?', false)).toBe(true)
		expect(matchesWildcardPattern('ab', 'ab', '', '?', false)).toBe(true)
		expect(matchesWildcardPattern('a', 'ab', '', '?', false)).toBe(false)
	})

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
		// A generous ceiling leaves no room for a blow-up while still passing on a slow CI box.
		expect(elapsed).toBeLessThan(200)
	})
})

describe('matchesQuery', () => {
	const row = QUERY_ROW

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
	const rows = PAGE_ROWS

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
	const rows = AGGREGATE_ROWS

	it('counts every row', () => {
		expect(computeAggregate(rows, 'count', 'amount')).toBe(4)
	})

	it('coerces numeric strings and ignores non-numeric cells', () => {
		expect(computeAggregate(rows, 'sum', 'amount')).toBe(30)
		expect(computeAggregate(rows, 'average', 'amount')).toBe(15)
		expect(computeAggregate(rows, 'minimum', 'amount')).toBe(10)
		expect(computeAggregate(rows, 'maximum', 'amount')).toBe(20)
	})

	it('refuses an operation outside AGGREGATE_OPERATIONS rather than answering a maximum', () => {
		const error = captureError(() =>
			invokeUnchecked(undefined, computeAggregate, [rows, 'median', 'amount']),
		)
		expect(error).toMatchObject({ code: 'VALIDATION', context: { operation: 'median' } })
		expect(isDatabaseError(error)).toBe(true)
	})

	it('computes extrema for rows beyond the engine argument limit', () => {
		const pressureRows = Array.from({ length: 1_000_000 }, (_, index) => ({
			value: index - 500_000,
		}))
		expect.soft(() => computeAggregate(pressureRows, 'minimum', 'value')).not.toThrow()
		expect.soft(() => computeAggregate(pressureRows, 'maximum', 'value')).not.toThrow()
		expect(computeAggregate(pressureRows, 'minimum', 'value')).toBe(-500_000)
		expect(computeAggregate(pressureRows, 'maximum', 'value')).toBe(499_999)
	}, 30_000)

	it('preserves signed zero for extrema in reversed order', () => {
		expect(computeAggregate([{ value: 0 }, { value: -0 }], 'minimum', 'value')).toBe(-0)
		expect(computeAggregate([{ value: -0 }, { value: 0 }], 'maximum', 'value')).toBe(0)
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

	it('stores a literal whose members span more than one class as json, as a union is', () => {
		expect(shapeToColumnStorage(literalShape(['a', 1]))).toBe('json')
		expect(shapeToColumnStorage(literalShape([true, 'yes']))).toBe('json')
		expect(shapeToColumnStorage(literalShape([0, false]))).toBe('json')
	})

	it('takes a literal shape from its values', () => {
		expect(shapeToColumnStorage(literalShape(['a', 'b']))).toBe('text')
		expect(shapeToColumnStorage(literalShape([1, 2]))).toBe('integer')
		expect(shapeToColumnStorage(literalShape([1.5, 2]))).toBe('real')
		expect(shapeToColumnStorage(literalShape([true, false]))).toBe('boolean')
	})
})

describe('shapeToColumnSchema', () => {
	it('stores a shape-valued column as JSON', () => {
		expect(shapeToColumnSchema('definition', shapeShape())).toEqual({
			name: 'definition',
			storage: 'json',
			optional: false,
			nullable: false,
		})
	})
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
	const validSchema = VALID_SCHEMA

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
	it('contains a throwing proxy trap as a non-match', () => {
		const trapped = new Proxy(
			{},
			{
				ownKeys() {
					throw new Error('ownKeys trap failed')
				},
			},
		)
		expect(equalsValue(trapped, {})).toBe(false)
		expect(equalsValue({}, trapped)).toBe(false)
	})

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
	const rows = FILTER_ROWS

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

// A driver whose scan throws an unexpected plain Error mid-phase.

describe('buildFailureFinding', () => {
	it('names the phase and renders an Error message, keeping the exact error', () => {
		const error = new Error('open refused')
		expect(buildFailureFinding('open-close', error)).toEqual({
			check: 'open-close',
			message: 'open refused',
			context: { error },
		})
		expect(buildFailureFinding('open-close', error).context.error).toBe(error)
	})

	it('renders a thrown string and a thrown symbol as text', () => {
		const symbol = Symbol('refused')
		expect(buildFailureFinding('read-missing', 'refused').message).toBe('refused')
		expect(buildFailureFinding('read-missing', symbol).message).toBe('Symbol(refused)')
	})

	it('renders a value no message can render as the contract fallback', () => {
		const reason: object = Object.create(null)
		expect(buildFailureFinding('delete', reason)).toEqual({
			check: 'delete',
			message: 'unknown failure',
			context: { error: reason },
		})
	})
})

describe('scanDriver', () => {
	it('yields no findings for a conformant driver (the reference memory driver)', async () => {
		const findings: unknown[] = []
		for await (const finding of scanDriver(() => createMemoryDriver())) findings.push(finding)
		expect(findings).toEqual([])
	})

	it('yields lazily — breaking after the first finding never throws and never drains the rest', async () => {
		const collected: string[] = []
		for await (const finding of scanDriver(() => createDoublyBrokenDriver())) {
			collected.push(finding.check)
			break
		}
		expect(collected).toEqual(['copy-in'])
	})

	it('yields a finding (not an escaped throw) when a driver method throws unexpectedly', async () => {
		const findings: Array<{ check: string; message: string }> = []
		for await (const finding of scanDriver(() => createCrashingDriver())) {
			findings.push({ check: finding.check, message: finding.message })
		}
		expect(findings.some((finding) => finding.message === 'scan exploded')).toBe(true)
	})

	it('yields a finding when a driver throws a value that no message can render', async () => {
		const reason: object = Object.create(null)
		const findings = await auditDriver(() =>
			createMemoryAdapter(createMemoryDriver(), { open: () => Promise.reject(reason) }),
		)
		expect(findings[0]).toEqual({
			check: 'open-close',
			message: 'unknown failure',
			context: { error: reason },
		})
		expect(findings.every((finding) => finding.context?.error === reason)).toBe(true)
	})

	it('yields one rendered finding per phase when a driver that declares every member refuses to open', async () => {
		const reason: object = Object.create(null)
		const findings = await auditDriver(() => createRefusingDriver(reason))
		expect(findings.map((finding) => finding.check)).toEqual([
			'open-close',
			'read-missing',
			'write-read',
			'insert-atomic',
			'delete',
			'mutation-abort',
			'order',
			'clear',
			'journal-rollback',
			'batch',
			'non-id-primary',
			'nested-roundtrip',
			'migrate',
			'stream',
			'transaction',
			'metadata-stamp',
			'plan',
			'transaction-batch',
		])
		expect(
			findings.every(
				(finding) => finding.message === 'unknown failure' && finding.context.error === reason,
			),
		).toBe(true)
	})

	it('runs the metadata/stamp phase for a driver that implements both hooks and finds a mismatched read', async () => {
		const findings: string[] = []
		for await (const finding of scanDriver(() => createMismatchedMetadataDriver())) {
			findings.push(finding.check)
		}
		expect(findings).toContain('metadata-fresh')

		// And the reference MemoryDriver — which implements metadata/stamp — passes cleanly.
		const clean: string[] = []
		for await (const finding of scanDriver(() => createMemoryDriver())) clean.push(finding.check)
		expect(clean.some((check) => check.startsWith('metadata'))).toBe(false)
	})

	it('runs the batch phase and finds a violation when a list insert applies the rows ahead of a conflict', async () => {
		const findings: string[] = []
		for await (const finding of scanDriver(() => createPartialBatchDriver())) {
			findings.push(finding.check)
		}
		expect(findings).toEqual(['batch-atomic'])

		// And the reference MemoryDriver applies a batch whole and passes cleanly.
		const clean: string[] = []
		for await (const finding of scanDriver(() => createMemoryDriver())) clean.push(finding.check)
		expect(clean).toEqual([])
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

describe('conformDriver (fail-fast over scanDriver)', () => {
	it('throws only the FIRST violation of a driver breaking two independent invariants', async () => {
		const error = await conformDriver(() => createDoublyBrokenDriver()).catch(
			(caught: unknown) => caught,
		)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
		expect(isDatabaseError(error) ? error.context?.check : undefined).toBe('copy-in')
	})
})

describe('foldASCII', () => {
	it('folds the ASCII capitals and leaves every other character unchanged', () => {
		expect(foldASCII('Émile ADA')).toBe('Émile ada')
		expect(foldASCII('ÀÉÎ')).toBe('ÀÉÎ')
	})
})

describe('like and glob — the engine semantics SQLite shares', () => {
	it('folds ASCII letters only under like', () => {
		expect(matchesLikePattern('Émile', 'émile')).toBe(false)
		expect(matchesLikePattern('ÉMILE', 'Émile')).toBe(true)
		expect(matchesLikePattern('ADA', 'ada')).toBe(true)
	})

	it('matches one code point with the single wildcard', () => {
		expect(matchesLikePattern('x😀y', 'x_y')).toBe(true)
		expect(matchesLikePattern('x😀y', 'x__y')).toBe(false)
		expect(matchesGlobPattern('x😀y', 'x?y')).toBe(true)
		expect(matchesGlobPattern('x😀y', 'x??y')).toBe(false)
	})
})

describe('sortRows — the tie rule', () => {
	const rows = [
		{ id: 'a', age: 1 },
		{ id: 'b', age: 1 },
		{ id: 'c', age: 0 },
	]

	it('keeps the input order of a tie when the final term ascends', () => {
		expect(
			sortRows(rows, [{ column: 'age', direction: 'ascending' }]).map((row) => row.id),
		).toEqual(['c', 'a', 'b'])
	})

	it('reverses the input order of a tie when the final term descends', () => {
		expect(
			sortRows(rows, [{ column: 'age', direction: 'descending' }]).map((row) => row.id),
		).toEqual(['b', 'a', 'c'])
	})
})

describe('collectScalars, matchesListed, and prepareScalars', () => {
	it('collects the scalar operands and leaves objects out', () => {
		const scalars = collectScalars(['a', 1, null, undefined, Number.NaN, { b: 2 }])
		expect([...scalars]).toEqual(['a', 1, null, undefined, Number.NaN])
	})

	it('matches a scalar by lookup and an object structurally', () => {
		expect(matchesListed('a', ['a', 'b'])).toBe(true)
		expect(matchesListed(-0, [0])).toBe(true)
		expect(matchesListed(Number.NaN, [Number.NaN])).toBe(true)
		expect(matchesListed('1', [1])).toBe(false)
		expect(matchesListed({ b: 1 }, [{ b: 1 }])).toBe(true)
		expect(matchesListed({ b: 1 }, ['b'])).toBe(false)
	})

	it('answers from the prepared set it is handed', () => {
		expect(matchesListed('a', ['a'], new Set(['z']))).toBe(false)
		expect(matchesCondition({ id: 'z' }, buildCondition('id', 'any', ['a']), new Set(['z']))).toBe(
			true,
		)
	})

	it('prepares one set per condition, empty for every operator but any and none', () => {
		const prepared = prepareScalars([
			buildCondition('id', 'any', ['a']),
			buildCondition('id', 'equals', ['a']),
			buildCondition('id', 'none', ['b']),
		])
		expect(prepared.map((set) => [...set])).toEqual([['a'], [], ['b']])
	})

	it('folds a query through the prepared sets as it does without them', () => {
		const conditions = [
			buildCondition('id', 'any', ['a', 'b']),
			buildCondition('id', 'none', ['b']),
		]
		const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
		const prepared = prepareScalars(conditions)
		expect(rows.filter((row) => matchesQuery(row, conditions, prepared))).toEqual([{ id: 'a' }])
		expect(rows.filter((row) => matchesQuery(row, conditions))).toEqual([{ id: 'a' }])
	})
})

describe('normalizeReadInput', () => {
	it('drops an empty list and keeps every present clause', () => {
		expect(normalizeReadInput({ conditions: [], order: [], limit: 10 })).toEqual({ limit: 10 })
		expect(normalizeReadInput({})).toEqual({})
		const aggregate = { operation: 'count' as const, column: 'id' }
		expect(normalizeReadInput({ offset: 0, aggregate })).toEqual({ offset: 0, aggregate })
	})
})

describe('findPlanFaults', () => {
	const equals = buildCondition('name', 'equals', ['Ada'])
	const above = buildCondition('age', 'above', [1])
	const order = [{ column: 'age', direction: 'ascending' as const }]

	it('accepts a plan that splits every clause', () => {
		expect(
			findPlanFaults(
				{ conditions: [equals, above], order, limit: 1 },
				{ native: { conditions: [equals] }, residual: { conditions: [above], order, limit: 1 } },
			),
		).toEqual([])
	})

	it('reports a lost or invented clause as coverage', () => {
		expect(findPlanFaults({ conditions: [equals] }, { native: {}, residual: {} })).toEqual([
			'coverage',
		])
		expect(findPlanFaults({}, { native: { conditions: [equals] }, residual: {} })).toEqual([
			'coverage',
		])
		expect(findPlanFaults({ limit: 1 }, { native: {}, residual: {} })).toEqual(['coverage'])
	})

	it('reports an order split or duplicated across sides', () => {
		expect(findPlanFaults({ order }, { native: { order }, residual: { order } })).toEqual(['order'])
	})

	it('reports a native page over a residual filter', () => {
		expect(
			findPlanFaults(
				{ conditions: [above], limit: 1 },
				{ native: { limit: 1 }, residual: { conditions: [above] } },
			),
		).toEqual(['page'])
	})

	it('reports a native aggregate over a residual filter', () => {
		const aggregate = { operation: 'sum' as const, column: 'age' }
		expect(
			findPlanFaults(
				{ conditions: [above], aggregate },
				{ native: { aggregate }, residual: { conditions: [above] } },
			),
		).toEqual(['aggregate'])
	})

	it('reports a partial residual filter for an or read', () => {
		const either = buildCondition('age', 'above', [1], 'or')
		expect(
			findPlanFaults(
				{ conditions: [equals, either] },
				{ native: { conditions: [equals] }, residual: { conditions: [either] } },
			),
		).toEqual(['or'])
	})

	it('reports an empty list as a side that does not carry nothing as {}', () => {
		expect(findPlanFaults({}, { native: {}, residual: { conditions: [] } })).toEqual(['empty'])
	})
})

describe('readPlannedRows, readPlannedAggregate, and scanPlans', () => {
	it('answers a planned read and a scan-only read alike', async () => {
		const planned = createPlannedDriver()
		const memory = createMemoryDriver()
		for (const driver of [planned, memory]) {
			await driver.open(CONFORMANCE_SCHEMA)
			for (const row of CONFORMANCE_ROWS) {
				const key = extractKey(row, 'id')
				if (key !== undefined) await driver.write('users', key, row)
			}
		}
		const input = { conditions: [buildCondition('age', 'above', [17])], limit: 2 }
		const aggregate = { operation: 'sum' as const, column: 'age' }
		expect(await readPlannedRows(planned, 'users', input)).toEqual(
			await readPlannedRows(memory, 'users', input),
		)
		expect(await readPlannedAggregate(planned, 'users', input, aggregate)).toBe(
			await readPlannedAggregate(memory, 'users', input, aggregate),
		)
		expect(await collect(scanPlans(planned, 'plan'))).toEqual([])
	})

	it('reports an answer that differs from the core engine', async () => {
		const driver = createPlannedDriver('ignored')
		await driver.open(CONFORMANCE_SCHEMA)
		for (const row of CONFORMANCE_ROWS) {
			const key = extractKey(row, 'id')
			if (key !== undefined) await driver.write('users', key, row)
		}
		const findings = await collect(scanPlans(driver, 'plan'))
		expect(findings.length).toBeGreaterThan(0)
		expect(new Set(findings.map((finding) => finding.check))).toEqual(
			new Set(['plan-differential']),
		)
	})
})

describe('scanDriver — the plan phase', () => {
	it('passes a planned driver that answers every read exactly', async () => {
		expect(await auditDriver(() => createPlannedDriver())).toEqual([])
	})

	it('reports a dropped condition as an invariant and a differential finding', async () => {
		const checks = (await auditDriver(() => createPlannedDriver('dropped'))).map(
			(finding) => finding.check,
		)
		expect(checks).toContain('plan-invariant')
		expect(checks).toContain('plan-differential')
		expect(checks).toContain('plan-scoped-invariant')
	})

	it('reports an empty residual list as the empty invariant', async () => {
		const findings = await auditDriver(() => createPlannedDriver('listed'))
		const [first] = findings
		expect(first?.check).toBe('plan-invariant')
		expect(first?.context.faults).toEqual(['empty'])
	})

	it('reports a transaction capability that lacks the native members', async () => {
		const findings = await auditDriver(() => createPlannedDriver('unscoped'))
		expect(findings.map((finding) => finding.check)).toEqual(['plan-capability'])
		expect(findings[0]?.context).toEqual({
			expected: { plan: true, records: true, stream: true, aggregate: true },
			actual: { plan: false, records: false, stream: false, aggregate: false },
		})
	})
})

describe('readPlannedRows — the read procedure Table runs', () => {
	it('stops the residual stream at offset + limit matches, as Table.records does', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await recorder.driver.open(CONFORMANCE_SCHEMA)
		for (const row of CONFORMANCE_ROWS) {
			const key = extractKey(row, 'id')
			if (key !== undefined) await recorder.driver.write('users', key, row)
		}
		const input = { conditions: [buildCondition('age', 'above', [30])], limit: 1 }
		const { value, calls } = await recorder.measure(() =>
			readPlannedRows(recorder.driver, 'users', input),
		)
		expect(value.map((row) => row.id)).toEqual(['a'])
		expect(tallyCalls(calls, 'scan')).toMatchObject({ calls: 1, rows: 1 })
	})
})

describe('planRead', () => {
	it('normalizes the read and leaves it whole as residual for a storage without plan', () => {
		expect(
			planRead(createMemoryDriver(), 'users', { conditions: [], order: [], limit: 2 }),
		).toEqual({ native: {}, residual: { limit: 2 } })
	})

	it('asks a planned storage for its split of the normalized read', () => {
		const condition = buildCondition('age', 'above', [1])
		expect(
			planRead(createPlannedDriver(), 'users', { conditions: [condition], order: [] }),
		).toEqual({ native: { conditions: [condition] }, residual: {} })
		expect(planRead(createPlannedDriver('listed'), 'users', {})).toEqual({
			native: {},
			residual: { conditions: [] },
		})
	})
})

describe('streamPlannedRows', () => {
	it('applies the residual conditions and page over scan for a storage without plan', async () => {
		const driver = createMemoryDriver()
		await seedConformanceRows(driver)
		const rows = await Array.fromAsync(
			streamPlannedRows(
				driver,
				'users',
				{},
				{
					conditions: [buildCondition('age', 'above', [17])],
					offset: 1,
					limit: 2,
				},
			),
		)
		expect(rows.map((row) => row.id)).toEqual(['b', 'g'])
	})

	it('streams the native side of a planned storage and runs the step around each pull', async () => {
		const driver = createPlannedDriver()
		await seedConformanceRows(driver)
		const steps: number[] = []
		const rows = await Array.fromAsync(
			streamPlannedRows(
				driver,
				'users',
				{ conditions: [buildCondition('name', 'starts', ['Ada'])] },
				{},
				async () => {
					steps.push(steps.length)
				},
			),
		)
		expect(rows.map((row) => row.id)).toEqual(['a', 'h'])
		expect(steps).toHaveLength(6)
	})

	it('propagates a step that throws after a pull and closes the source', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await seedConformanceRows(recorder.driver)
		const steps: number[] = []
		const failure = await captureFailure(() =>
			Array.fromAsync(
				streamPlannedRows(recorder.driver, 'users', {}, {}, async () => {
					steps.push(steps.length)
					if (steps.length === 2) throw new Error('stopped')
				}),
			),
		)
		expect(failure).toEqual(new Error('stopped'))
		expect(tallyCalls(recorder.calls, 'scan')).toMatchObject({ calls: 1, rows: 1 })
	})
})

describe('buildBatch', () => {
	it('pairs a single key and row, and two lists by position', () => {
		expect(buildBatch('u1', { id: 'u1' })).toEqual([['u1', { id: 'u1' }]])
		expect(buildBatch(['u1', 2], [{ id: 'u1' }, { id: 2 }])).toEqual([
			['u1', { id: 'u1' }],
			[2, { id: 2 }],
		])
		expect(buildBatch([], [])).toEqual([])
	})

	it('refuses lists of different lengths and a call that mixes a list with a single value', () => {
		expect(captureError(() => buildBatch(['u1', 'u2'], [{ id: 'u1' }]))).toMatchObject({
			code: 'VALIDATION',
			context: { keys: 2, rows: 1 },
		})
		expect(captureError(() => buildBatch(['u1'], { id: 'u1' }))).toMatchObject({
			code: 'VALIDATION',
			context: { keys: 1, rows: 1 },
		})
	})
})

describe('computeRemoved', () => {
	it('reports true for the first occurrence of each key that held a row', () => {
		expect(computeRemoved(['a', 'b', 'a', 1], [true, false, true, true])).toEqual([
			true,
			false,
			false,
			true,
		])
		expect(computeRemoved([], [])).toEqual([])
	})

	it('reports false for a key whose existence is unread', () => {
		expect(computeRemoved(['a', 'b'], [true])).toEqual([true, false])
	})
})

describe('computeFirstIndexes', () => {
	it('maps each key to the position of its first occurrence', () => {
		expect(computeFirstIndexes(['a', 'b', 'a', 1, 'b'])).toEqual(
			new Map<unknown, number>([
				['a', 0],
				['b', 1],
				[1, 3],
			]),
		)
		expect(computeFirstIndexes([]).size).toBe(0)
	})

	it('compares keys by SameValueZero, so a number and its string differ', () => {
		expect(computeFirstIndexes([1, '1', 1])).toEqual(
			new Map<unknown, number>([
				[1, 0],
				['1', 1],
			]),
		)
	})
})

describe('applyKeys', () => {
	it('hands a single key to the operation as a list of one and answers with its one result', async () => {
		const seen = createRecorder<[keys: readonly unknown[]]>()
		const answer = await applyKeys('u1', async (keys) => {
			seen.handler(keys)
			return [true]
		})
		expect(answer).toBe(true)
		expect(seen.calls).toEqual([[['u1']]])
	})

	it('hands a key list through and answers with the whole list', async () => {
		expect(await applyKeys(['u1', 'u2'], async (keys) => keys.map((key) => key === 'u1'))).toEqual([
			true,
			false,
		])
		expect(await applyKeys([], async () => [])).toEqual([])
	})

	it('answers false for a single key the operation reports no result for', async () => {
		expect(await applyKeys('u1', async () => [])).toBe(false)
	})
})

describe('collectColumns', () => {
	it('collects each column schema by name in declaration order', () => {
		const columns = collectColumns({
			id: stringShape(),
			age: optionalShape(integerShape()),
			tag: nullableShape(stringShape()),
		})
		expect([...columns.keys()]).toEqual(['id', 'age', 'tag'])
		expect(columns.get('age')).toEqual({
			name: 'age',
			storage: 'integer',
			optional: true,
			nullable: false,
		})
		expect(columns.get('tag')).toEqual({
			name: 'tag',
			storage: 'text',
			optional: false,
			nullable: true,
		})
	})

	it('collects nothing from an empty column map', () => {
		expect(collectColumns({}).size).toBe(0)
	})
})

describe('maskUndefinedOperands', () => {
	it('reads an undefined operand of the nullish operators as null on a copy', () => {
		const condition = {
			column: 'note',
			operator: 'equals',
			values: [undefined, 'n'],
			connector: 'and',
		}
		const kept = { column: 'note', operator: 'from', values: [undefined], connector: 'and' }
		const input = { conditions: [condition, kept], limit: 1 }
		expect(maskUndefinedOperands(input)).toEqual({
			conditions: [{ ...condition, values: [null, 'n'] }, kept],
			limit: 1,
		})
		expect(condition.values).toEqual([undefined, 'n'])
	})

	it('returns the input itself when no nullish operand is undefined, and any non-read as it came', () => {
		const input = {
			conditions: [{ column: 'n', operator: 'any', values: [null, 1], connector: 'and' }],
		}
		expect(maskUndefinedOperands(input)).toBe(input)
		const unlisted = { conditions: 'none' }
		expect(maskUndefinedOperands(unlisted)).toBe(unlisted)
		expect(maskUndefinedOperands(null)).toBeNull()
		expect(maskUndefinedOperands({ conditions: [null, 3] })).toEqual({ conditions: [null, 3] })
	})
})

describe('scanQueryFaults and its leaves', () => {
	const columns = collectColumns({
		id: stringShape(),
		n: integerShape(),
		flag: booleanShape(),
		note: optionalShape(stringShape()),
		tag: nullableShape(stringShape()),
		meta: jsonShape(),
	})

	it('admits a read every column holds', () => {
		expect(
			scanQueryFaults(
				{
					conditions: [
						{ column: 'n', operator: 'between', values: [1, 2], connector: 'and' },
						{ column: 'note', operator: 'none', values: [undefined, 'x'], connector: 'or' },
						{
							column: ['meta', 'deep', 'leaf'],
							operator: 'like',
							values: ['a%'],
							connector: 'and',
						},
						{ column: 'flag', operator: 'present', values: [], connector: 'and' },
					],
					order: [{ column: ['meta', 'x'], direction: 'ascending' }],
					aggregate: { operation: 'sum', column: 'n' },
				},
				columns,
			),
		).toEqual([])
		expect(scanQueryFaults({}, columns)).toEqual([])
	})

	it('reports each fault of conditions, order, and aggregate in that order', () => {
		expect(
			scanQueryFaults(
				{
					conditions: [{ column: 'flag', operator: 'equals', values: [1], connector: 'and' }],
					order: [{ column: ['id', 'x'], direction: 'ascending' }],
					aggregate: { operation: 'sum', column: ['missing'] },
				},
				columns,
			),
		).toEqual([
			{
				reason: 'type',
				path: ['conditions', '0', 'values', '0'],
				expected: 'boolean',
				received: '1',
			},
			{ reason: 'type', path: ['order', '0', 'column'], expected: 'string', received: 'array' },
			{
				reason: 'type',
				path: ['aggregate', 'column', '0'],
				expected: 'literal',
				received: '"missing"',
			},
		])
	})

	it('stops at the contract fault limit', () => {
		const values = Array.from({ length: FAULT_LIMIT * 2 }, () => 'x')
		const conditions = [
			{ column: 'n', operator: 'any', values, connector: 'and' },
			{ column: 'n', operator: 'any', values, connector: 'and' },
		] as const
		expect(scanQueryFaults({ conditions }, columns)).toHaveLength(FAULT_LIMIT)
		expect(scanConditionFaults(conditions[0], ['conditions', '0'], columns)).toHaveLength(
			FAULT_LIMIT,
		)
	})

	it('refuses a pattern operator on an integer, real, boolean, or blob column, naming the storage that admits it', () => {
		const stores = new Map([
			['n', { name: 'n', storage: 'integer', optional: false, nullable: false }],
			['r', { name: 'r', storage: 'real', optional: false, nullable: false }],
			['b', { name: 'b', storage: 'boolean', optional: false, nullable: false }],
			['x', { name: 'x', storage: 'blob', optional: false, nullable: false }],
		] as const)
		for (const column of ['n', 'r', 'b', 'x']) {
			expect(
				scanConditionFaults(
					{ column, operator: 'glob', values: ['1*'], connector: 'and' },
					['c'],
					stores,
				),
			).toEqual([
				{
					reason: 'constraint',
					path: ['c', 'operator'],
					expected: 'literal',
					constraint: 'pattern',
					limit: 'a text or json column',
					received: '"glob"',
				},
			])
		}
		expect(
			scanConditionFaults(
				{ column: 'meta', operator: 'ends', values: ['z'], connector: 'and' },
				['c'],
				columns,
			),
		).toEqual([])
	})

	it('names the undeclared head of a column reference and a nested path under a scalar column', () => {
		expect(scanColumnFaults('nope', ['p'], columns)).toEqual([
			{ reason: 'type', path: ['p'], expected: 'literal', received: '"nope"' },
		])
		expect(scanColumnFaults(['nope', 'x'], ['p'], columns)).toEqual([
			{ reason: 'type', path: ['p', '0'], expected: 'literal', received: '"nope"' },
		])
		expect(scanColumnFaults(['n', 'x'], ['p'], columns)).toEqual([
			{ reason: 'type', path: ['p'], expected: 'string', received: 'array' },
		])
		expect(scanColumnFaults(['n'], ['p'], columns)).toEqual([])
		expect(scanColumnFaults(['meta', 'x', 'y'], ['p'], columns)).toEqual([])
	})

	it('admits nullish operands by operator family and column flags', () => {
		const tag = columns.get('tag')
		const note = columns.get('note')
		expect(scanOperandFaults(null, ['v'], tag, true)).toEqual([])
		expect(scanOperandFaults(null, ['v'], tag, false)).toEqual([
			{ reason: 'type', path: ['v'], expected: 'string', received: 'null' },
		])
		expect(scanOperandFaults(undefined, ['v'], note, true)).toEqual([])
		expect(scanOperandFaults(undefined, ['v'], tag, true)).toEqual([
			{ reason: 'type', path: ['v'], expected: 'string', received: 'undefined' },
		])
		expect(scanOperandFaults(null, ['v'], note, true)).toEqual([
			{ reason: 'type', path: ['v'], expected: 'string', received: 'null' },
		])
	})

	it('reads the storage class and no refinement of a number column', () => {
		const n = columns.get('n')
		expect(scanOperandFaults(1.5, ['v'], n, false)).toEqual([])
		expect(scanOperandFaults(Number.NaN, ['v'], n, false)).toEqual([])
		expect(scanOperandFaults(-0, ['v'], n, false)).toEqual([])
		expect(scanOperandFaults(1n, ['v'], n, false)).toEqual([
			{ reason: 'type', path: ['v'], expected: 'number', received: '1n' },
		])
	})

	it('admits any operand without a column or on a json column, and refuses ill-formed text everywhere', () => {
		expect(scanOperandFaults({ a: [1] }, ['v'], undefined, false)).toEqual([])
		expect(scanOperandFaults(Symbol('s'), ['v'], columns.get('meta'), false)).toEqual([])
		expect(scanOperandFaults('a\uD800', ['v'], undefined, false)).toEqual([
			{
				reason: 'constraint',
				path: ['v'],
				expected: 'string',
				constraint: 'pattern',
				received: '"a\\ud800"',
			},
		])
		expect(scanOperandFaults('\uDC00z', ['v'], columns.get('meta'), true)).toHaveLength(1)
		expect(scanOperandFaults('😀', ['v'], columns.get('id'), true)).toEqual([])
	})
})

describe('findIllFormedColumn', () => {
	const columns = collectColumns({
		id: stringShape(),
		body: stringShape(),
		meta: jsonShape(),
		n: integerShape(),
	})

	it('names the first text column holding a lone surrogate, and reads no json column', () => {
		expect(findIllFormedColumn({ id: 'a', body: 'x\uD800', meta: 'y\uDC00', n: 1 }, columns)).toBe(
			'body',
		)
		expect(
			findIllFormedColumn({ id: 'a', body: 'ok', meta: 'y\uDC00', n: 1 }, columns),
		).toBeUndefined()
		expect(findIllFormedColumn({ id: '😀', body: '\uDBFF' }, columns)).toBe('body')
		expect(findIllFormedColumn({}, columns)).toBeUndefined()
	})
})

describe('tallyCalls', () => {
	it('totals one member and ignores every other', () => {
		expect(
			tallyCalls(
				[
					{ member: 'read', keys: 2, rows: 1, scoped: false },
					{ member: 'write', keys: 3, rows: 0, scoped: true },
					{ member: 'read', keys: 1, rows: 1, scoped: true },
				],
				'read',
			),
		).toEqual({ calls: 2, keys: 3, rows: 2 })
		expect(tallyCalls([], 'scan')).toEqual({ calls: 0, keys: 0, rows: 0 })
	})
})

describe('streamRecordedRows', () => {
	it('counts the rows a consumer pulls when it stops early, and every row at the end', async () => {
		const memory = createMemoryDriver()
		await memory.open(tableSchemas('users'))
		await memory.write('users', ['a', 'b'], [{ id: 'a' }, { id: 'b' }])
		const early = new StreamPage(0)
		for await (const row of streamRecordedRows(memory.scan('users'), early)) {
			expect(row).toEqual({ id: 'a' })
			break
		}
		expect(early.count).toBe(1)
		const whole = new StreamPage(0)
		expect(await collect(streamRecordedRows(memory.scan('users'), whole))).toHaveLength(2)
		expect(whole.count).toBe(2)
		const unpulled = new StreamPage(0)
		streamRecordedRows(memory.scan('users'), unpulled)
		expect(unpulled.count).toBe(0)
	})

	it('holds the rows yielded before a source throws', async () => {
		const rows = new StreamPage(0)
		const failing = streamThenFail([{ id: 'a' }], 'source failed')
		await expect(collect(streamRecordedRows(failing, rows))).rejects.toThrow('source failed')
		expect(rows.count).toBe(1)
	})
})

describe('matchesIllFormedText', () => {
	it('matches a string holding a lone surrogate, and nothing else', () => {
		expect(['a\uD800b', '\uDC00', 'z\uDBFF'].map(matchesIllFormedText)).toEqual([true, true, true])
		expect(
			['', 'Ada', '\uD83D\uDE00', 1, null, undefined, ['\uD800']].map(matchesIllFormedText),
		).toEqual([false, false, false, false, false, false, false])
	})
})

describe('extractColumnHead', () => {
	it('reads the leading column of a name or a non-empty list of strings, and nothing else', () => {
		expect(extractColumnHead('age')).toBe('age')
		expect(extractColumnHead(['profile', 'age'])).toBe('profile')
		expect([[], ['profile', 1], 7, null, undefined, { 0: 'x' }].map(extractColumnHead)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		])
	})
})

describe('restoreUndefinedOperands', () => {
	it('puts back the source operands of each condition, keeping every other member', () => {
		const source = {
			conditions: [
				{ column: 'note', operator: 'equals', values: [undefined], connector: 'and' },
				{ column: 'n', operator: 'from', values: [1], connector: 'or' },
			],
			limit: 2,
		}
		const masked = maskUndefinedOperands(source)
		expect(masked).not.toBe(source)
		const restored = restoreUndefinedOperands(
			{
				conditions: [
					{ column: 'note', operator: 'equals', values: [null], connector: 'and' },
					{ column: 'n', operator: 'from', values: [1], connector: 'or' },
				],
				limit: 2,
			},
			source,
		)
		expect(restored).toEqual(source)
		expect(restoreUndefinedOperands({ limit: 1 }, source)).toEqual({ limit: 1 })
		expect(restoreUndefinedOperands({ conditions: [] }, null)).toEqual({ conditions: [] })
	})
})

describe('scanAggregateFaults', () => {
	const columns = collectColumns({ id: stringShape(), age: integerShape(), meta: jsonShape() })

	it('admits a known operation over a declared column or a json path', () => {
		expect(scanAggregateFaults({ operation: 'average', column: 'age' }, columns)).toEqual([])
		expect(scanAggregateFaults({ operation: 'sum', column: ['meta', 'x'] }, columns)).toEqual([])
	})

	it('refuses an unknown operation, a column that is no path, an undeclared column, and no record', () => {
		expect(scanAggregateFaults({ operation: 'median', column: [] }, columns)).toEqual([
			{
				reason: 'type',
				path: ['aggregate', 'operation'],
				expected: 'literal',
				received: '"median"',
			},
			{ reason: 'type', path: ['aggregate', 'column'], expected: 'string', received: 'array' },
		])
		expect(scanAggregateFaults({ operation: 'sum', column: 'agee' }, columns)).toEqual([
			{ reason: 'type', path: ['aggregate', 'column'], expected: 'literal', received: '"agee"' },
		])
		expect(scanAggregateFaults(null, columns)).toEqual([
			{ reason: 'type', path: ['aggregate'], expected: 'object', received: 'null' },
		])
	})
})

describe('scanQueryFaults on a read the contract refuses', () => {
	it('checks each well-formed part and skips each part that is no record or no list', () => {
		const columns = collectColumns({ id: stringShape(), n: integerShape() })
		expect(
			scanQueryFaults(
				{
					conditions: [null, { column: 'n', operator: 'similar', values: ['x'], connector: 'and' }],
					order: 'n',
				},
				columns,
			),
		).toEqual([
			{
				reason: 'type',
				path: ['conditions', '1', 'values', '0'],
				expected: 'number',
				received: '"x"',
			},
		])
		expect(scanQueryFaults(null, columns)).toEqual([])
		expect(
			scanQueryFaults({ conditions: [{ column: [], operator: 'present', values: [] }] }, columns),
		).toEqual([])
	})
})
