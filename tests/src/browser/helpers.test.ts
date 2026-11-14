import { NULLABLE_SCHEMA, NULLABLE_INDEXES } from '../../setupBrowser.js'
import {
	deleteDatabase,
	GUIDE_SCHEMA,
	ITEM_COMPOUND,
	ITEM_INDEX_NAMES,
	ITEM_SCHEMA,
	PLANNER_SCHEMA as SCHEMA,
	PLANNER_INDEXES as INDEXES,
	mintDatabase,
	TRIPLE_INDEX_NAMES,
	TRIPLE_SCHEMA,
} from '../../setupBrowser.js'
import type { ConditionOperator } from '@src/core'
import type { IndexedDBErrorCode } from '@orkestrel/indexeddb'
import { createIndexedDBDatabase, IndexedDBError } from '@orkestrel/indexeddb'
import {
	buildCompoundRange,
	conditionToRange,
	COUNT_LIMIT,
	deriveCompoundPlan,
	deriveConditionPlan,
	deriveOrderPlan,
	findAccessPlan,
	matchesAccessOrder,
	matchesKeyList,
	narrowRange,
	rankAccessPlan,
	readIndexNames,
	resolveCount,
	deriveIndexedDBIndexName,
	INDEXABLE_STORAGE,
	mapIndexedDBError,
	mapMigrationError,
	planIndexedDBQuery,
} from '@src/browser'
import { describe, expect, it } from 'vitest'
import { buildCondition } from '../../setup.js'

// The IndexedDB planner (mirrors src/browser/helpers.ts). Runs in real Chromium for
// `IDBKeyRange`. Asserts the chosen index AND the returned range's bounds: which operators
// and columns narrow to which range, and which read the whole store.

const WHOLE = { conditions: [], columns: ['id'], prefix: 0 }

describe('findAccessPlan — pushable operators on the primary key', () => {
	it('equals → primary store, IDBKeyRange.only', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'equals', ['u3'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('u3')
		expect(plan.range?.upper).toBe('u3')
		expect(plan.range?.lowerOpen).toBe(false)
		expect(plan.range?.upperOpen).toBe(false)
	})

	it('above → lowerBound exclusive', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'above', ['m'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('m')
		expect(plan.range?.lowerOpen).toBe(true)
		expect(plan.range?.upper).toBeUndefined()
	})

	it('below → upperBound exclusive', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'below', ['m'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.upper).toBe('m')
		expect(plan.range?.upperOpen).toBe(true)
		expect(plan.range?.lower).toBeUndefined()
	})

	it('from → lowerBound inclusive', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'from', ['m'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('m')
		expect(plan.range?.lowerOpen).toBe(false)
	})

	it('to → upperBound inclusive', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'to', ['m'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.upper).toBe('m')
		expect(plan.range?.upperOpen).toBe(false)
	})

	it('between → bound, both ends inclusive', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'between', ['a', 'z'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('a')
		expect(plan.range?.upper).toBe('z')
		expect(plan.range?.lowerOpen).toBe(false)
		expect(plan.range?.upperOpen).toBe(false)
	})
})

describe('findAccessPlan — pushable operators on a single-column secondary index', () => {
	it('a numeric secondary-index column reads that index by name', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('age', 'from', [18])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBe('age')
		expect(plan.range?.lower).toBe(18)
		expect(plan.range?.lowerOpen).toBe(false)
	})

	it('equals on the indexed column → IDBKeyRange.only on that index', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('age', 'equals', [41])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBe('age')
		expect(plan.range?.lower).toBe(41)
		expect(plan.range?.upper).toBe(41)
	})

	it('a range-exact column with NO index falls back to a full scan', () => {
		// `name` is text (orderable) but has no secondary index → cannot push.
		const plan = findAccessPlan(
			{ conditions: [buildCondition('name', 'equals', ['Ada'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})
})

describe('findAccessPlan — conditions that cannot push (full scan)', () => {
	it('a non-orderable boolean column → full scan', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('active', 'equals', [true])] },
			SCHEMA,
			['active'],
		)
		expect(plan).toEqual(WHOLE)
	})

	it('a json column → full scan', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('payload', 'equals', ['x'])] },
			SCHEMA,
			['payload'],
		)
		expect(plan).toEqual(WHOLE)
	})

	it('a nested-array FieldPath (descends a json value) → full scan', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition(['payload', 'tag'], 'equals', ['green'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('a column absent from the schema → full scan', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('missing', 'equals', ['x'])] },
			SCHEMA,
			['missing'],
		)
		expect(plan).toEqual(WHOLE)
	})

	it('starts on a text column reads the prefix range up to its successor', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'starts', ['u'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('u')
		expect(plan.range?.upper).toBe('v')
		expect(plan.range?.upperOpen).toBe(true)
	})

	it('starts on a number column → full scan (a prefix holds strings only)', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('age', 'starts', ['1'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('not → full scan (no single exact range)', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'not', ['u1'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('any with an operand that is no key → full scan', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'any', [['u1', 'u2']])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('absent → full scan (existence, not a range)', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'absent', [])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('a non-string/number operand → full scan (not a usable key)', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('id', 'equals', [{ nested: true }])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('no conditions → full scan', () => {
		expect(findAccessPlan({}, SCHEMA, INDEXES)).toEqual(WHOLE)
		expect(findAccessPlan({}, SCHEMA, INDEXES)).toEqual(WHOLE)
	})
})

describe('findAccessPlan — selection among several conditions', () => {
	it('the FIRST qualifying condition wins', () => {
		// First condition (name) cannot push (no index); second (age) is indexed and
		// pushable → the plan picks the age index, not the unindexed name.
		const plan = findAccessPlan(
			{
				conditions: [
					buildCondition('name', 'equals', ['Ada']),
					buildCondition('age', 'from', [18], 'and'),
				],
			},
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBe('age')
		expect(plan.range?.lower).toBe(18)
	})

	it('the primary key wins over a later indexed column when it comes first', () => {
		const plan = findAccessPlan(
			{
				conditions: [
					buildCondition('id', 'equals', ['u1']),
					buildCondition('age', 'from', [18], 'and'),
				],
			},
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('u1')
		expect(plan.range?.upper).toBe('u1')
	})

	it('all-AND conditions push down (the result is a subset of each)', () => {
		const plan = findAccessPlan(
			{
				conditions: [
					buildCondition('age', 'from', [18]),
					buildCondition('name', 'equals', ['Ada'], 'and'),
				],
			},
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBe('age')
		expect(plan.range?.lower).toBe(18)
	})

	it('ANY or-joined condition forces a full scan (a range would miss rows)', () => {
		// `age >= 18 OR name = 'Ada'` — narrowing on the age range would drop a row
		// matching only `name = 'Ada'` (age < 18), so no single range is a superset.
		const plan = findAccessPlan(
			{
				conditions: [
					buildCondition('age', 'from', [18]),
					buildCondition('name', 'equals', ['Ada'], 'or'),
				],
			},
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('a later or-joined condition forces a scan even if an earlier pair is AND', () => {
		const plan = findAccessPlan(
			{
				conditions: [
					buildCondition('id', 'equals', ['u1']),
					buildCondition('age', 'from', [18], 'and'),
					buildCondition('name', 'starts', ['B'], 'or'),
				],
			},
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it("the first condition's connector is ignored (only c2.. matter)", () => {
		// A lone condition whose connector is 'or' still pushes — the first connector
		// only seeds the fold, so a single-condition input is always all-AND.
		const plan = findAccessPlan(
			{ conditions: [buildCondition('age', 'from', [18], 'or')] },
			SCHEMA,
			INDEXES,
		)
		expect(plan.index).toBe('age')
		expect(plan.range?.lower).toBe(18)
	})
})

describe('conditionToRange', () => {
	it('maps each exact-comparison operator over a scalar operand to its IDBKeyRange', () => {
		expect(conditionToRange(buildCondition('id', 'equals', ['u1']))?.lower).toBe('u1')
		expect(conditionToRange(buildCondition('id', 'above', ['m']))?.lowerOpen).toBe(true)
		expect(conditionToRange(buildCondition('id', 'below', ['m']))?.upperOpen).toBe(true)
		expect(conditionToRange(buildCondition('id', 'from', ['m']))?.lowerOpen).toBe(false)
		expect(conditionToRange(buildCondition('id', 'to', ['m']))?.upperOpen).toBe(false)
		const between = conditionToRange(buildCondition('id', 'between', ['a', 'z']))
		expect(between?.lower).toBe('a')
		expect(between?.upper).toBe('z')
	})

	it('maps starts to the prefix range, and closes a prefix past U+FFFF at its successor', () => {
		const prefix = conditionToRange(buildCondition('id', 'starts', ['ab']))
		expect([prefix?.lower, prefix?.upper, prefix?.upperOpen]).toEqual(['ab', 'ac', true])
		const high = conditionToRange(buildCondition('id', 'starts', ['a\uffff']))
		expect([high?.lower, high?.upper, high?.upperOpen]).toEqual(['a\uffff', 'b', true])
		expect(high?.includes('a\uffff\uffffz')).toBe(true)
		expect(conditionToRange(buildCondition('id', 'starts', [3]))).toBeUndefined()
	})

	it('returns undefined for a non-comparison operator', () => {
		expect(conditionToRange(buildCondition('id', 'not', ['u1']))).toBeUndefined()
		expect(conditionToRange(buildCondition('id', 'any', ['u1']))).toBeUndefined()
		expect(conditionToRange(buildCondition('id', 'absent', []))).toBeUndefined()
	})

	it('returns undefined when the operand is not a scalar key', () => {
		expect(conditionToRange(buildCondition('id', 'equals', [{ nested: true }]))).toBeUndefined()
		expect(conditionToRange(buildCondition('id', 'equals', [Number.NaN]))).toBeUndefined()
		expect(
			conditionToRange(buildCondition('id', 'from', [Number.POSITIVE_INFINITY])),
		).toBeUndefined()
		expect(conditionToRange(buildCondition('id', 'to', [Number.NEGATIVE_INFINITY]))).toBeUndefined()
		// `between` needs BOTH ends to be keys.
		expect(
			conditionToRange(buildCondition('id', 'between', ['a', { nested: true }])),
		).toBeUndefined()
	})
})

describe('findAccessPlan — below/to lossy-pushdown fix (an absent/null row over a secondary index)', () => {
	// A schema mirroring the audit reproduction: `age` is a NULLABLE integer with
	// its own single-column secondary index.

	it('below on a SECONDARY-indexed column never pushes (would drop absent/null rows)', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('age', 'below', [100])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('to on a SECONDARY-indexed column never pushes (would drop absent/null rows)', () => {
		const plan = findAccessPlan(
			{ conditions: [buildCondition('age', 'to', [100])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(plan).toEqual(WHOLE)
	})

	it('below/to on the PRIMARY key still pushes (a primary key is never absent/null)', () => {
		const below = findAccessPlan(
			{ conditions: [buildCondition('id', 'below', ['m'])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(below.index).toBeUndefined()
		expect(below.range?.upper).toBe('m')
		const to = findAccessPlan(
			{ conditions: [buildCondition('id', 'to', ['m'])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(to.index).toBeUndefined()
		expect(to.range?.upper).toBe('m')
	})

	it('equals/above/from/between on a SECONDARY-indexed column still push (a scalar lower bound excludes absent/null)', () => {
		expect(
			findAccessPlan(
				{ conditions: [buildCondition('age', 'equals', [30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
		expect(
			findAccessPlan(
				{ conditions: [buildCondition('age', 'above', [30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
		expect(
			findAccessPlan(
				{ conditions: [buildCondition('age', 'from', [30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
		expect(
			findAccessPlan(
				{ conditions: [buildCondition('age', 'between', [10, 30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
	})

	it('a below/to condition that cannot push is skipped in favor of a LATER qualifying condition', () => {
		const plan = findAccessPlan(
			{
				conditions: [
					buildCondition('age', 'below', [100]),
					buildCondition('id', 'equals', ['u1'], 'and'),
				],
			},
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('u1')
	})
})

describe('conditionToRange — reversed between bounds', () => {
	it('returns undefined for a reversed same-type pair (first > second)', () => {
		expect(conditionToRange(buildCondition('id', 'between', ['z', 'a']))).toBeUndefined()
	})

	it('returns undefined for a reversed mixed-type pair (a number above a string in rank still reverses numerically)', () => {
		expect(conditionToRange(buildCondition('age', 'between', [100, 1]))).toBeUndefined()
	})

	it('still returns a range for an equal pair (first === second, not reversed)', () => {
		const same = conditionToRange(buildCondition('id', 'between', ['m', 'm']))
		expect(same?.lower).toBe('m')
		expect(same?.upper).toBe('m')
	})

	it('still returns a range for a properly ordered pair', () => {
		const ordered = conditionToRange(buildCondition('id', 'between', ['a', 'z']))
		expect(ordered?.lower).toBe('a')
		expect(ordered?.upper).toBe('z')
	})
})

describe('mapIndexedDBError / mapMigrationError', () => {
	it('maps CONSTRAINT to CONFLICT, preserving the original error as cause', () => {
		const source = new IndexedDBError('CONSTRAINT', 'duplicate key')
		const mapped = mapIndexedDBError(source)
		expect(mapped.code).toBe('CONFLICT')
		expect(mapped.context?.cause).toBe(source)
	})

	it('maps CLOSED / NOT_OPEN / INVALID to CLOSED', () => {
		expect(mapIndexedDBError(new IndexedDBError('CLOSED', 'x')).code).toBe('CLOSED')
		expect(mapIndexedDBError(new IndexedDBError('NOT_OPEN', 'x')).code).toBe('CLOSED')
		expect(mapIndexedDBError(new IndexedDBError('INVALID', 'x')).code).toBe('CLOSED')
	})

	it('maps RECORD to DRIVER with context.code = RECORD, keeping the wrapper error as cause', () => {
		const source = new IndexedDBError('RECORD', 'not a record', undefined, {
			store: 'items',
			key: 'k1',
		})
		const mapped = mapIndexedDBError(source)
		expect([mapped.code, mapped.context?.code, mapped.context?.cause]).toEqual([
			'DRIVER',
			'RECORD',
			source,
		])
	})

	it('maps QUOTA to DRIVER with context.code = QUOTA', () => {
		const mapped = mapIndexedDBError(new IndexedDBError('QUOTA', 'full'))
		expect(mapped.code).toBe('DRIVER')
		expect(mapped.context?.code).toBe('QUOTA')
	})

	it('maps every other code (including UPGRADE) to DRIVER outside migrate()', () => {
		const codes: readonly IndexedDBErrorCode[] = [
			'UPGRADE',
			'ABORTED',
			'NOT_FOUND',
			'DATA',
			'OPEN',
			'INACTIVE',
			'UNKNOWN',
		]
		for (const code of codes) {
			expect(mapIndexedDBError(new IndexedDBError(code, 'x')).code).toBe('DRIVER')
		}
	})

	it('mapMigrationError maps UPGRADE and RECORD to MIGRATION, and defers every other code to mapIndexedDBError', () => {
		const upgrade = mapMigrationError(new IndexedDBError('UPGRADE', 'bad plan'))
		expect(upgrade.code).toBe('MIGRATION')
		expect(mapMigrationError(new IndexedDBError('RECORD', 'not a record')).code).toBe('MIGRATION')
		expect(mapMigrationError(new IndexedDBError('CONSTRAINT', 'x')).code).toBe('CONFLICT')
		expect(mapMigrationError(new IndexedDBError('ABORTED', 'x')).code).toBe('DRIVER')
	})
})

describe('deriveIndexedDBIndexName', () => {
	it('keeps a single-column index bare (matches the column name exactly)', () => {
		expect(deriveIndexedDBIndexName(['age'])).toBe('age')
		expect(deriveIndexedDBIndexName(['a_b'])).toBe('a_b')
	})

	it('encodes a compound index without colliding with a single-column literal of the joined form', () => {
		const compound = deriveIndexedDBIndexName(['a', 'b'])
		expect(compound).not.toBe('a_b')
		expect(compound).not.toBe(deriveIndexedDBIndexName(['a_b']))
	})

	it('is deterministic (same columns → same name every call)', () => {
		expect(deriveIndexedDBIndexName(['city', 'age'])).toBe('2#4:city3:age')
	})

	it('distinguishes column groups that share a joined-form collision', () => {
		// ['a', 'bc'] and ['ab', 'c'] both join to 'a_bc'/'ab_c' differently, but a
		// pathological pair like ['a', 'b_c'] and ['a_b', 'c'] both underscore-join
		// to 'a_b_c' — the length-prefixed encoding must still tell them apart.
		expect(deriveIndexedDBIndexName(['a', 'b_c'])).not.toBe(deriveIndexedDBIndexName(['a_b', 'c']))
	})
})

describe('INDEXABLE_STORAGE', () => {
	it('is frozen and lists exactly the orderable column storages', () => {
		expect(Object.isFrozen(INDEXABLE_STORAGE)).toBe(true)
		expect(INDEXABLE_STORAGE).toEqual(['text', 'integer', 'real'])
	})
})

describe('findAccessPlan — ranking by rule', () => {
	const tag = buildCondition('tag', 'equals', ['t1'])
	const rank = buildCondition('rank', 'from', [10])
	const organization = buildCondition('organization', 'equals', ['o1'])
	const id = buildCondition('id', 'any', ['k3', 'k1', 'k3'])

	it('takes primary-key equals or any ahead of every index, whatever its position', () => {
		const plan = findAccessPlan({ conditions: [tag, rank, id] }, ITEM_SCHEMA, ITEM_INDEX_NAMES)
		expect(plan).toEqual({ conditions: [id], columns: ['id'], prefix: 0, keys: ['k1', 'k3'] })
	})

	it('takes a compound index matched on two columns ahead of a single-column equals', () => {
		const plan = findAccessPlan(
			{ conditions: [tag, rank, organization] },
			ITEM_SCHEMA,
			ITEM_INDEX_NAMES,
		)
		expect(plan.index).toBe(ITEM_COMPOUND)
		expect(plan.conditions).toEqual([organization, rank])
		expect([plan.prefix, plan.range?.lower, plan.range?.upper]).toEqual([1, ['o1', 10], ['o1', []]])
	})

	it('takes a single-column equals ahead of a range, and the earlier condition on a tie', () => {
		expect(findAccessPlan({ conditions: [rank, tag] }, ITEM_SCHEMA, ITEM_INDEX_NAMES).index).toBe(
			'tag',
		)
		const other = buildCondition('score', 'equals', [3])
		expect(findAccessPlan({ conditions: [other, tag] }, ITEM_SCHEMA, ITEM_INDEX_NAMES).index).toBe(
			'score',
		)
	})

	it('takes a primary-key range ahead of an index range', () => {
		const range = buildCondition('id', 'below', ['k5'])
		expect(findAccessPlan({ conditions: [rank, range] }, ITEM_SCHEMA, ITEM_INDEX_NAMES)).toEqual({
			conditions: [range],
			columns: ['id'],
			prefix: 0,
			range: expect.objectContaining({ upper: 'k5', upperOpen: true }),
		})
	})

	it('admits equals and any with key operands on an optional and a nullable column', () => {
		expect(findAccessPlan({ conditions: [tag] }, ITEM_SCHEMA, ITEM_INDEX_NAMES).index).toBe('tag')
		const scores = buildCondition('score', 'any', [4, 2])
		expect(findAccessPlan({ conditions: [scores] }, ITEM_SCHEMA, ITEM_INDEX_NAMES)).toEqual({
			conditions: [scores],
			columns: ['score'],
			prefix: 0,
			index: 'score',
			keys: [2, 4],
		})
		const nulls = buildCondition('score', 'any', [4, null])
		expect(findAccessPlan({ conditions: [nulls] }, ITEM_SCHEMA, ITEM_INDEX_NAMES).index).toBe(
			undefined,
		)
	})

	it('refuses below and to on an optional or nullable index, and admits them on a required one', () => {
		for (const condition of [
			buildCondition('tag', 'below', ['t3']),
			buildCondition('score', 'to', [3]),
		]) {
			expect(findAccessPlan({ conditions: [condition] }, ITEM_SCHEMA, ITEM_INDEX_NAMES).index).toBe(
				undefined,
			)
		}
		expect(
			findAccessPlan(
				{ conditions: [buildCondition('rank', 'to', [3])] },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			).index,
		).toBe('rank')
	})

	it('reads no index over a boolean column, and no path at all for an or read', () => {
		const active = buildCondition('active', 'equals', [true])
		expect(findAccessPlan({ conditions: [active] }, ITEM_SCHEMA, ITEM_INDEX_NAMES).index).toBe(
			undefined,
		)
		const either = buildCondition('rank', 'from', [3], 'or')
		expect(
			findAccessPlan({ conditions: [organization, either] }, ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({ conditions: [], columns: ['id'], prefix: 0 })
	})

	it('takes the order index when no condition plans, and the column index for a lone minimum', () => {
		const order = [{ column: 'rank', direction: 'descending' as const }]
		const either = buildCondition('rank', 'from', [3], 'or')
		expect(
			findAccessPlan({ conditions: [tag, either], order }, ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({ conditions: [], columns: ['rank'], prefix: 0, index: 'rank' })
		expect(
			findAccessPlan(
				{ aggregate: { operation: 'minimum', column: 'rank' } },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			).index,
		).toBe('rank')
		expect(
			findAccessPlan(
				{ aggregate: { operation: 'minimum', column: 'score' } },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			).index,
		).toBe(undefined)
	})
})

describe('deriveConditionPlan', () => {
	it('derives a point, a key list, and a range on the primary key and an index', () => {
		expect(
			deriveConditionPlan(buildCondition('rank', 'equals', [3]), ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({
			conditions: [buildCondition('rank', 'equals', [3])],
			columns: ['rank'],
			prefix: 1,
			index: 'rank',
			range: expect.objectContaining({ lower: 3, upper: 3 }),
		})
		expect(
			deriveConditionPlan(buildCondition('id', 'any', [2, 'a', 1]), ITEM_SCHEMA, ITEM_INDEX_NAMES)
				?.keys,
		).toEqual([1, 2, 'a'])
		expect(
			deriveConditionPlan(buildCondition('id', 'starts', ['k1']), ITEM_SCHEMA, [])?.range?.upper,
		).toBe('k2')
	})

	it('derives nothing for a column without an index, a nested path, or an unknown column', () => {
		expect(
			deriveConditionPlan(buildCondition('rank', 'equals', [3]), ITEM_SCHEMA, []),
		).toBeUndefined()
		expect(
			deriveConditionPlan(buildCondition(['rank', 'x'], 'equals', [3]), ITEM_SCHEMA, ['rank']),
		).toBeUndefined()
		expect(
			deriveConditionPlan(buildCondition('missing', 'equals', [3]), ITEM_SCHEMA, ['missing']),
		).toBeUndefined()
	})
})

describe('deriveCompoundPlan', () => {
	const index = ['organization', 'rank']
	const organization = buildCondition('organization', 'equals', ['o1'])

	it('reads one point for equality on every column', () => {
		const rank = buildCondition('rank', 'equals', [5])
		const plan = deriveCompoundPlan([rank, organization], index, ITEM_SCHEMA, ITEM_INDEX_NAMES)
		expect(plan?.conditions).toEqual([organization, rank])
		expect([plan?.prefix, plan?.range?.lower, plan?.range?.upper]).toEqual([
			2,
			['o1', 5],
			['o1', 5],
		])
	})

	it('reads the prefix range for equality on the leading column alone', () => {
		const plan = deriveCompoundPlan([organization], index, ITEM_SCHEMA, ITEM_INDEX_NAMES)
		expect([plan?.prefix, plan?.range?.lower, plan?.range?.upper]).toEqual([1, ['o1'], ['o1', []]])
	})

	it('refuses an unmatched optional column and a missing index', () => {
		const schema = {
			...ITEM_SCHEMA,
			columns: ITEM_SCHEMA.columns.map((column) =>
				column.name === 'rank' ? { ...column, optional: true } : column,
			),
		}
		expect(deriveCompoundPlan([organization], index, schema, ITEM_INDEX_NAMES)).toBeUndefined()
		expect(deriveCompoundPlan([organization], index, ITEM_SCHEMA, ['organization'])).toBeUndefined()
	})
})

describe('buildCompoundRange', () => {
	const keys = [['o1', 4], ['o1', 5], ['o1', 6], ['o1'], ['o2', 0]]

	it('bounds each range operator on the next column after the prefix', () => {
		const cases: ReadonlyArray<
			readonly [ConditionOperator, readonly unknown[], readonly unknown[]]
		> = [
			['above', [5], [['o1', 6]]],
			[
				'from',
				[5],
				[
					['o1', 5],
					['o1', 6],
				],
			],
			['below', [5], [['o1', 4], ['o1']]],
			['to', [5], [['o1', 4], ['o1', 5], ['o1']]],
			[
				'between',
				[5, 6],
				[
					['o1', 5],
					['o1', 6],
				],
			],
		]
		for (const [operator, values, inside] of cases) {
			const range = buildCompoundRange(['o1'], buildCondition('rank', operator, values))
			expect(keys.filter((key) => range?.includes(key) === true)).toEqual(inside)
		}
		expect(buildCompoundRange(['o1'], buildCondition('rank', 'between', [6, 5]))).toBeUndefined()
		expect(buildCompoundRange(['o1'], buildCondition('rank', 'like', ['5']))).toBeUndefined()
		expect(keys.filter((key) => buildCompoundRange(['o1'])?.includes(key) === true)).toEqual([
			['o1', 4],
			['o1', 5],
			['o1', 6],
			['o1'],
		])
	})

	it('bounds starts at the prefix successor', () => {
		const range = buildCompoundRange(['o1'], buildCondition('tag', 'starts', ['t\uffff']))
		expect(range?.includes(['o1', 't\uffff\uffffx'])).toBe(true)
		expect(range?.includes(['o1', 'u'])).toBe(false)
	})
})

describe('rankAccessPlan', () => {
	it('orders primary points, compound matches, index points beside a leading compound equals, then ranges', () => {
		const plans = [
			{ conditions: [], columns: ['id'], prefix: 0 },
			{ conditions: [], columns: ['rank'], prefix: 0, index: 'rank' },
			{ conditions: [], columns: ['id'], prefix: 1 },
			{ conditions: [], columns: ['rank'], prefix: 1, index: 'rank' },
			{
				conditions: [buildCondition('organization', 'equals', ['o1'])],
				columns: ['organization', 'rank'],
				prefix: 1,
				index: ITEM_COMPOUND,
			},
			{
				conditions: [
					buildCondition('organization', 'equals', ['o1']),
					buildCondition('rank', 'equals', [1]),
				],
				columns: ['organization', 'rank'],
				prefix: 2,
				index: ITEM_COMPOUND,
			},
			{
				conditions: [buildCondition('organization', 'from', ['o1'])],
				columns: ['organization', 'rank'],
				prefix: 0,
				index: ITEM_COMPOUND,
			},
		]
		expect(plans.map(rankAccessPlan)).toEqual([300, 301, 0, 200, 200, 98, 302])
	})
})

describe('deriveOrderPlan', () => {
	it('serves an order on required indexed columns in one direction, and no other', () => {
		expect(
			deriveOrderPlan([{ column: 'rank', direction: 'ascending' }], ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({ conditions: [], columns: ['rank'], prefix: 0, index: 'rank' })
		expect(
			deriveOrderPlan(
				[
					{ column: 'organization', direction: 'descending' },
					{ column: 'rank', direction: 'descending' },
				],
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			)?.index,
		).toBe(ITEM_COMPOUND)
		for (const order of [
			[{ column: 'tag', direction: 'ascending' as const }],
			[{ column: 'id', direction: 'ascending' as const }],
			[
				{ column: 'organization', direction: 'descending' as const },
				{ column: 'rank', direction: 'ascending' as const },
			],
		]) {
			expect(deriveOrderPlan(order, ITEM_SCHEMA, ITEM_INDEX_NAMES)).toBeUndefined()
		}
	})
})

describe('matchesAccessOrder', () => {
	const point = findAccessPlan(
		{ conditions: [buildCondition('organization', 'equals', ['o1'])] },
		ITEM_SCHEMA,
		ITEM_INDEX_NAMES,
	)
	const range = findAccessPlan(
		{ conditions: [buildCondition('rank', 'from', [3])] },
		ITEM_SCHEMA,
		ITEM_INDEX_NAMES,
	)

	it('serves the primary key on a point, and the index column on a range', () => {
		expect(matchesAccessOrder(point, [{ column: 'id', direction: 'descending' }], 'id')).toBe(true)
		expect(matchesAccessOrder(point, [{ column: 'rank', direction: 'ascending' }], 'id')).toBe(
			false,
		)
		expect(matchesAccessOrder(range, [{ column: 'rank', direction: 'descending' }], 'id')).toBe(
			true,
		)
		expect(matchesAccessOrder(range, [{ column: 'id', direction: 'ascending' }], 'id')).toBe(false)
	})

	it('refuses mixed directions and an order on an any column', () => {
		expect(
			matchesAccessOrder(
				range,
				[
					{ column: 'rank', direction: 'descending' },
					{ column: 'id', direction: 'ascending' },
				],
				'id',
			),
		).toBe(false)
		const listed = findAccessPlan(
			{ conditions: [buildCondition('rank', 'any', [3, 1])] },
			ITEM_SCHEMA,
			ITEM_INDEX_NAMES,
		)
		expect(matchesAccessOrder(listed, [{ column: 'rank', direction: 'ascending' }], 'id')).toBe(
			false,
		)
		expect(matchesAccessOrder(listed, [{ column: 'id', direction: 'descending' }], 'id')).toBe(true)
	})
})

describe('narrowRange', () => {
	it('keeps the keys past a key in each direction, and nothing past the end', () => {
		const range = IDBKeyRange.bound('b', 'm')
		const next = narrowRange(range, 'c', 'next', true)
		expect([next?.lower, next?.lowerOpen, next?.upper]).toEqual(['c', true, 'm'])
		const prev = narrowRange(range, 'c', 'prev', false)
		expect([prev?.lower, prev?.upper, prev?.upperOpen]).toEqual(['b', 'c', false])
		expect(narrowRange(range, 'm', 'next', true)).toBeUndefined()
		expect(narrowRange(range, 'a', 'prev', false)).toBeUndefined()
		expect(narrowRange(undefined, 'c', 'next', true)?.lower).toBe('c')
	})
})

describe('planIndexedDBQuery', () => {
	const rank = buildCondition('rank', 'from', [18])
	const like = buildCondition('tag', 'like', ['t%'])
	const organization = buildCondition('organization', 'equals', ['o1'])

	it('keeps the path and the order it serves native, and a page residual beside a residual filter', () => {
		const order = [{ column: 'rank', direction: 'ascending' as const }]
		expect(
			planIndexedDBQuery(
				{ conditions: [like, rank], order, limit: 10, offset: 2 },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			),
		).toEqual({
			native: { conditions: [rank], order },
			residual: { conditions: [like], limit: 10, offset: 2 },
		})
	})

	it('keeps the page native when no condition and no order stays residual', () => {
		const order = [{ column: 'id', direction: 'descending' as const }]
		expect(
			planIndexedDBQuery(
				{ conditions: [organization], order, limit: 3 },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			),
		).toEqual({ native: { conditions: [organization], order, limit: 3 }, residual: {} })
	})

	it('sorts as residual when the filter path does not serve the order', () => {
		const order = [{ column: 'rank', direction: 'ascending' as const }]
		expect(
			planIndexedDBQuery(
				{ conditions: [organization], order, limit: 3 },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			),
		).toEqual({ native: { conditions: [organization] }, residual: { order, limit: 3 } })
	})

	it('keeps count native over the path, and minimum native on the path column alone', () => {
		const count = { operation: 'count' as const, column: 'id' }
		expect(
			planIndexedDBQuery({ conditions: [rank], aggregate: count }, ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({
			native: { conditions: [rank], aggregate: count },
			residual: {},
		})
		const minimum = { operation: 'minimum' as const, column: 'rank' }
		expect(
			planIndexedDBQuery({ conditions: [rank], aggregate: minimum }, ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({ native: { conditions: [rank], aggregate: minimum }, residual: {} })
		const maximum = { operation: 'maximum' as const, column: 'rank' }
		expect(
			planIndexedDBQuery(
				{ conditions: [organization], aggregate: maximum },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			),
		).toEqual({ native: { conditions: [organization] }, residual: { aggregate: maximum } })
		const sum = { operation: 'sum' as const, column: 'rank' }
		expect(planIndexedDBQuery({ aggregate: sum }, ITEM_SCHEMA, ITEM_INDEX_NAMES)).toEqual({
			native: {},
			residual: { aggregate: sum },
		})
	})

	it('keeps every condition residual for an or read', () => {
		const either = buildCondition('rank', 'from', [18], 'or')
		expect(
			planIndexedDBQuery({ conditions: [organization, either] }, ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({ native: {}, residual: { conditions: [organization, either] } })
		expect(planIndexedDBQuery({}, ITEM_SCHEMA, ITEM_INDEX_NAMES)).toEqual({
			native: {},
			residual: {},
		})
	})
})

// Transcribes the IndexedDB planning fence of guides/database.md and asserts each value its
// comments claim, which the Node guides project has no IDBKeyRange host to run.
describe('the guide fence: IndexedDB planning', () => {
	const fromAge = buildCondition('age', 'from', [18])
	const belowCity = buildCondition('city', 'below', ['m'])
	const byAge = [{ column: 'age', direction: 'descending' as const }]
	const indexes = ['age', 'city']

	it('returns the plans and the access path the fence claims', () => {
		expect(planIndexedDBQuery({ limit: 10 }, GUIDE_SCHEMA, indexes)).toEqual({
			native: { limit: 10 },
			residual: {},
		})
		expect(
			planIndexedDBQuery({ conditions: [fromAge], order: byAge, limit: 10 }, GUIDE_SCHEMA, indexes),
		).toEqual({ native: { conditions: [fromAge], order: byAge, limit: 10 }, residual: {} })
		expect(planIndexedDBQuery({ conditions: [belowCity] }, GUIDE_SCHEMA, indexes)).toEqual({
			native: {},
			residual: { conditions: [belowCity] },
		})
		const plan = findAccessPlan({ conditions: [fromAge] }, GUIDE_SCHEMA, indexes)
		expect([plan.conditions, plan.columns, plan.prefix, plan.index]).toEqual([
			[fromAge],
			['age'],
			0,
			'age',
		])
		expect([plan.range?.lower, plan.range?.lowerOpen, plan.range?.upper]).toEqual([
			18,
			false,
			undefined,
		])
		const only = conditionToRange(buildCondition('age', 'equals', [30]))
		expect([only?.lower, only?.upper]).toEqual([30, 30])
	})
})

describe('findAccessPlan — a compound index matched on its leading column alone', () => {
	it('ranks the leading equals with a single-column equals, above a primary-key range', () => {
		const range = buildCondition('id', 'from', ['k0000'])
		const organization = buildCondition('organization', 'equals', ['o1'])
		const plan = findAccessPlan(
			{ conditions: [range, organization] },
			{ ...ITEM_SCHEMA, indexes: [['organization', 'rank']] },
			[ITEM_COMPOUND],
		)
		expect([plan.index, plan.conditions, plan.prefix]).toEqual([ITEM_COMPOUND, [organization], 1])
	})
})

describe('matchesAccessOrder — the strict-prefix guard over a three-column index', () => {
	const plan = findAccessPlan(
		{ conditions: [buildCondition('organization', 'equals', ['o1'])] },
		TRIPLE_SCHEMA,
		TRIPLE_INDEX_NAMES,
	)

	it('serves an order on every unbound column, and refuses a strict prefix of them', () => {
		expect([plan.index, plan.prefix]).toEqual([TRIPLE_INDEX_NAMES[0], 1])
		expect(
			matchesAccessOrder(
				plan,
				[
					{ column: 'rank', direction: 'ascending' },
					{ column: 'tag', direction: 'ascending' },
				],
				'id',
			),
		).toBe(true)
		expect(matchesAccessOrder(plan, [{ column: 'rank', direction: 'ascending' }], 'id')).toBe(false)
		expect(
			planIndexedDBQuery(
				{
					conditions: [buildCondition('organization', 'equals', ['o1'])],
					order: [{ column: 'rank', direction: 'ascending' }],
				},
				TRIPLE_SCHEMA,
				TRIPLE_INDEX_NAMES,
			).residual,
		).toEqual({ order: [{ column: 'rank', direction: 'ascending' }] })
	})
})

describe('planIndexedDBQuery — aggregates that stay residual', () => {
	it('keeps a minimum or maximum over an any residual, and a minimum on a nullable column', () => {
		const any = buildCondition('rank', 'any', [3, 1])
		const maximum = { operation: 'maximum' as const, column: 'rank' }
		expect(
			planIndexedDBQuery({ conditions: [any], aggregate: maximum }, ITEM_SCHEMA, ITEM_INDEX_NAMES),
		).toEqual({ native: { conditions: [any] }, residual: { aggregate: maximum } })
		const score = buildCondition('score', 'from', [3])
		const minimum = { operation: 'minimum' as const, column: 'score' }
		expect(
			planIndexedDBQuery(
				{ conditions: [score], aggregate: minimum },
				ITEM_SCHEMA,
				ITEM_INDEX_NAMES,
			),
		).toEqual({ native: { conditions: [score] }, residual: { aggregate: minimum } })
	})
})

describe('matchesKeyList', () => {
	it('lists an any, and an index range read out of the asked order, and walks every other path', () => {
		const range = findAccessPlan(
			{ conditions: [buildCondition('rank', 'from', [3])] },
			ITEM_SCHEMA,
			ITEM_INDEX_NAMES,
		)
		const point = findAccessPlan(
			{ conditions: [buildCondition('organization', 'equals', ['o1'])] },
			ITEM_SCHEMA,
			ITEM_INDEX_NAMES,
		)
		const listed = findAccessPlan(
			{ conditions: [buildCondition('id', 'any', ['k2', 'k1'])] },
			ITEM_SCHEMA,
			ITEM_INDEX_NAMES,
		)
		expect(matchesKeyList(range, undefined, 'id')).toBe(true)
		expect(matchesKeyList(range, [{ column: 'rank', direction: 'descending' }], 'id')).toBe(false)
		expect(matchesKeyList(point, undefined, 'id')).toBe(false)
		expect(matchesKeyList(listed, [{ column: 'id', direction: 'descending' }], 'id')).toBe(true)
	})
})

describe('resolveCount', () => {
	it('passes a count the engine accepts, and reads a larger one as every row', () => {
		expect([resolveCount(10), resolveCount(COUNT_LIMIT), resolveCount(undefined)]).toEqual([
			10,
			COUNT_LIMIT,
			undefined,
		])
		expect([resolveCount(COUNT_LIMIT + 1), resolveCount(Number.MAX_SAFE_INTEGER)]).toEqual([
			undefined,
			undefined,
		])
	})
})

describe('readIndexNames', () => {
	it('reads the index names of each listed store the database holds, and leaves out the rest', async () => {
		const name = mintDatabase('database-index-names')
		const database = createIndexedDBDatabase({
			name,
			stores: {
				books: {
					indexes: [
						{ name: 'author', path: 'author' },
						{ name: 'year', path: 'year' },
					],
				},
				shelves: {},
			},
		})
		try {
			const native = await database.connect()
			expect(readIndexNames(native, ['books', 'shelves', 'books', 'absent'])).toEqual(
				new Map([
					['books', ['author', 'year']],
					['shelves', []],
				]),
			)
			expect(readIndexNames(native, [])).toEqual(new Map())
		} finally {
			database.close()
			await deleteDatabase(name)
		}
	})
})
