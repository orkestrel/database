import {
	applyCriteria,
	columnType,
	compareValues,
	computeAggregate,
	extractKey,
	generateKey,
	globMatch,
	isDatabaseError,
	likeMatch,
	matchesCondition,
	matchesCriteria,
	MAX_PATTERN_LENGTH,
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

describe('generateKey', () => {
	it('returns a fresh UUID string each call', () => {
		const a = generateKey()
		const b = generateKey()
		expect(typeof a).toBe('string')
		expect(a).not.toBe(b)
		expect(a).toMatch(/^[0-9a-f-]{36}$/i)
	})
})

describe('columnType', () => {
	it('maps scalar shapes to their portable type', () => {
		expect(columnType(stringShape())).toBe('text')
		expect(columnType(integerShape())).toBe('integer')
		expect(columnType(numberShape())).toBe('real')
		expect(columnType(booleanShape())).toBe('boolean')
	})

	it('maps null / object / array / union / json / raw to json', () => {
		expect(columnType(nullShape())).toBe('json')
		expect(columnType(objectShape({ a: stringShape() }))).toBe('json')
		expect(columnType(arrayShape(stringShape()))).toBe('json')
		expect(columnType(unionShape(stringShape(), integerShape()))).toBe('json')
		expect(columnType(jsonShape())).toBe('json')
		expect(columnType(rawShape({ type: 'object' }))).toBe('json')
	})

	it('unwraps optional / nullable to the inner type', () => {
		expect(columnType(optionalShape(integerShape()))).toBe('integer')
		expect(columnType(nullableShape(stringShape()))).toBe('text')
	})

	it('takes a literal shape from its values', () => {
		expect(columnType(literalShape(['a', 'b']))).toBe('text')
		expect(columnType(literalShape([1, 2]))).toBe('integer')
		expect(columnType(literalShape([1.5, 2]))).toBe('real')
		expect(columnType(literalShape([true, false]))).toBe('boolean')
	})
})
