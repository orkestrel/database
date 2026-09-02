import type { TableSchema } from '@src/core'
import type { IndexedDBErrorCode } from '@orkestrel/indexeddb'
import { IndexedDBError } from '@orkestrel/indexeddb'
import {
	conditionToRange,
	deriveIndexedDBIndexName,
	INDEXABLE_STORAGE,
	mapIndexedDBError,
	mapMigrationError,
	selectPlan,
} from '@src/browser'
import { describe, expect, it } from 'vitest'
import { buildCondition } from '../../setup.js'

// selectPlan — the IndexedDB pushdown planner (mirrors src/browser/helpers.ts).
// Runs in real Chromium for `IDBKeyRange`. Asserts the chosen index AND the
// returned range's bounds; the contract is that a plan only ever NARROWS to a
// superset, so here we pin which operators / columns push to which range, and
// which fall back to a full scan.

// A schema with a string primary key, a couple of typed (orderable) columns, and
// the non-orderable types pushdown must refuse (boolean / json).
const SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'score', storage: 'real', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'active', storage: 'boolean', optional: false, nullable: false },
		{ name: 'payload', storage: 'json', optional: false, nullable: true },
	],
	indexes: [['age']],
}

// The single-column secondary indexes that physically exist (named by column).
const INDEXES: readonly string[] = ['age']

describe('selectPlan — pushable operators on the primary key', () => {
	it('equals → primary store, IDBKeyRange.only', () => {
		const plan = selectPlan(
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
		const plan = selectPlan({ conditions: [buildCondition('id', 'above', ['m'])] }, SCHEMA, INDEXES)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('m')
		expect(plan.range?.lowerOpen).toBe(true)
		expect(plan.range?.upper).toBeUndefined()
	})

	it('below → upperBound exclusive', () => {
		const plan = selectPlan({ conditions: [buildCondition('id', 'below', ['m'])] }, SCHEMA, INDEXES)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.upper).toBe('m')
		expect(plan.range?.upperOpen).toBe(true)
		expect(plan.range?.lower).toBeUndefined()
	})

	it('from → lowerBound inclusive', () => {
		const plan = selectPlan({ conditions: [buildCondition('id', 'from', ['m'])] }, SCHEMA, INDEXES)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.lower).toBe('m')
		expect(plan.range?.lowerOpen).toBe(false)
	})

	it('to → upperBound inclusive', () => {
		const plan = selectPlan({ conditions: [buildCondition('id', 'to', ['m'])] }, SCHEMA, INDEXES)
		expect(plan.index).toBeUndefined()
		expect(plan.range?.upper).toBe('m')
		expect(plan.range?.upperOpen).toBe(false)
	})

	it('between → bound, both ends inclusive', () => {
		const plan = selectPlan(
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

describe('selectPlan — pushable operators on a single-column secondary index', () => {
	it('a numeric secondary-index column reads that index by name', () => {
		const plan = selectPlan({ conditions: [buildCondition('age', 'from', [18])] }, SCHEMA, INDEXES)
		expect(plan.index).toBe('age')
		expect(plan.range?.lower).toBe(18)
		expect(plan.range?.lowerOpen).toBe(false)
	})

	it('equals on the indexed column → IDBKeyRange.only on that index', () => {
		const plan = selectPlan(
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
		const plan = selectPlan(
			{ conditions: [buildCondition('name', 'equals', ['Ada'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual({})
	})
})

describe('selectPlan — conditions that cannot push (full scan)', () => {
	it('a non-orderable boolean column → full scan', () => {
		const plan = selectPlan({ conditions: [buildCondition('active', 'equals', [true])] }, SCHEMA, [
			'active',
		])
		expect(plan).toEqual({})
	})

	it('a json column → full scan', () => {
		const plan = selectPlan({ conditions: [buildCondition('payload', 'equals', ['x'])] }, SCHEMA, [
			'payload',
		])
		expect(plan).toEqual({})
	})

	it('a nested-array FieldPath (descends a json value) → full scan', () => {
		const plan = selectPlan(
			{ conditions: [buildCondition(['payload', 'tag'], 'equals', ['green'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual({})
	})

	it('a column absent from the schema → full scan', () => {
		const plan = selectPlan({ conditions: [buildCondition('missing', 'equals', ['x'])] }, SCHEMA, [
			'missing',
		])
		expect(plan).toEqual({})
	})

	it('starts → full scan (prefix range can miss strings past U+FFFF)', () => {
		const plan = selectPlan(
			{ conditions: [buildCondition('id', 'starts', ['u'])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual({})
	})

	it('not → full scan (no single exact range)', () => {
		const plan = selectPlan({ conditions: [buildCondition('id', 'not', ['u1'])] }, SCHEMA, INDEXES)
		expect(plan).toEqual({})
	})

	it('any → full scan (membership, not a single range)', () => {
		const plan = selectPlan(
			{ conditions: [buildCondition('id', 'any', [['u1', 'u2']])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual({})
	})

	it('absent → full scan (existence, not a range)', () => {
		const plan = selectPlan({ conditions: [buildCondition('id', 'absent', [])] }, SCHEMA, INDEXES)
		expect(plan).toEqual({})
	})

	it('a non-string/number operand → full scan (not a usable key)', () => {
		const plan = selectPlan(
			{ conditions: [buildCondition('id', 'equals', [{ nested: true }])] },
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual({})
	})

	it('no conditions → full scan', () => {
		expect(selectPlan({}, SCHEMA, INDEXES)).toEqual({})
		expect(selectPlan(undefined, SCHEMA, INDEXES)).toEqual({})
	})
})

describe('selectPlan — selection among several conditions', () => {
	it('the FIRST qualifying condition wins', () => {
		// First condition (name) cannot push (no index); second (age) is indexed and
		// pushable → the plan picks the age index, not the unindexed name.
		const plan = selectPlan(
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
		const plan = selectPlan(
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
		const plan = selectPlan(
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
		const plan = selectPlan(
			{
				conditions: [
					buildCondition('age', 'from', [18]),
					buildCondition('name', 'equals', ['Ada'], 'or'),
				],
			},
			SCHEMA,
			INDEXES,
		)
		expect(plan).toEqual({})
	})

	it('a later or-joined condition forces a scan even if an earlier pair is AND', () => {
		const plan = selectPlan(
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
		expect(plan).toEqual({})
	})

	it("the first condition's connector is ignored (only c2.. matter)", () => {
		// A lone condition whose connector is 'or' still pushes — the first connector
		// only seeds the fold, so a single-condition input is always all-AND.
		const plan = selectPlan(
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

	it('returns undefined for a non-comparison operator', () => {
		expect(conditionToRange(buildCondition('id', 'not', ['u1']))).toBeUndefined()
		expect(conditionToRange(buildCondition('id', 'starts', ['u']))).toBeUndefined()
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

describe('selectPlan — below/to lossy-pushdown fix (an absent/null row over a secondary index)', () => {
	// A schema mirroring the audit reproduction: `age` is a NULLABLE integer with
	// its own single-column secondary index.
	const NULLABLE_SCHEMA: TableSchema = {
		name: 'people',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: true },
		],
		indexes: [['age']],
	}
	const NULLABLE_INDEXES: readonly string[] = ['age']

	it('below on a SECONDARY-indexed column never pushes (would drop absent/null rows)', () => {
		const plan = selectPlan(
			{ conditions: [buildCondition('age', 'below', [100])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(plan).toEqual({})
	})

	it('to on a SECONDARY-indexed column never pushes (would drop absent/null rows)', () => {
		const plan = selectPlan(
			{ conditions: [buildCondition('age', 'to', [100])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(plan).toEqual({})
	})

	it('below/to on the PRIMARY key still pushes (a primary key is never absent/null)', () => {
		const below = selectPlan(
			{ conditions: [buildCondition('id', 'below', ['m'])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(below.index).toBeUndefined()
		expect(below.range?.upper).toBe('m')
		const to = selectPlan(
			{ conditions: [buildCondition('id', 'to', ['m'])] },
			NULLABLE_SCHEMA,
			NULLABLE_INDEXES,
		)
		expect(to.index).toBeUndefined()
		expect(to.range?.upper).toBe('m')
	})

	it('equals/above/from/between on a SECONDARY-indexed column still push (a scalar lower bound excludes absent/null)', () => {
		expect(
			selectPlan(
				{ conditions: [buildCondition('age', 'equals', [30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
		expect(
			selectPlan(
				{ conditions: [buildCondition('age', 'above', [30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
		expect(
			selectPlan(
				{ conditions: [buildCondition('age', 'from', [30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
		expect(
			selectPlan(
				{ conditions: [buildCondition('age', 'between', [10, 30])] },
				NULLABLE_SCHEMA,
				NULLABLE_INDEXES,
			).index,
		).toBe('age')
	})

	it('a below/to condition that cannot push is skipped in favor of a LATER qualifying condition', () => {
		const plan = selectPlan(
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

	it('mapMigrationError maps UPGRADE to MIGRATION, and defers every other code to mapIndexedDBError', () => {
		const upgrade = mapMigrationError(new IndexedDBError('UPGRADE', 'bad plan'))
		expect(upgrade.code).toBe('MIGRATION')
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
