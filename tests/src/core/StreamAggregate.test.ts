import { isDatabaseError } from '@src/core'
import { StreamAggregate } from '../../../src/core/StreamAggregate.js'
import { captureError } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { AGGREGATE_ROWS } from '../../setup.js'

// `StreamAggregate` folds one value per row offered and holds no row: each operation against
// fixed values, the empty fold, signed zero, the fold order of a sum, and the refusal.

describe('StreamAggregate', () => {
	it('counts every value it is offered, a non-record included', () => {
		const count = new StreamAggregate('count', 'amount')
		for (const row of [...AGGREGATE_ROWS, 'loose', null]) count.add(row)
		expect(count.value).toBe(6)
	})

	it('coerces numeric strings and skips non-numeric cells and non-records', () => {
		const values = (['sum', 'average', 'minimum', 'maximum'] as const).map((operation) => {
			const aggregate = new StreamAggregate(operation, 'amount')
			for (const row of [...AGGREGATE_ROWS, 'loose']) aggregate.add(row)
			return aggregate.value
		})
		expect(values).toEqual([30, 15, 10, 20])
	})

	it('reads a nested path', () => {
		const aggregate = new StreamAggregate('maximum', ['profile', 'age'])
		for (const row of [{ profile: { age: 41 } }, { profile: { age: 17 } }, { profile: {} }]) {
			aggregate.add(row)
		}
		expect(aggregate.value).toBe(41)
	})

	it('returns zero for a count and undefined otherwise over no numeric value', () => {
		expect(new StreamAggregate('count', 'amount').value).toBe(0)
		const sum = new StreamAggregate('sum', 'amount')
		sum.add({ amount: 'x' })
		expect(sum.value).toBeUndefined()
		expect(new StreamAggregate('average', 'amount').value).toBeUndefined()
	})

	it('keeps signed zero for the extrema in arrival order', () => {
		const minimum = new StreamAggregate('minimum', 'value')
		const maximum = new StreamAggregate('maximum', 'value')
		minimum.add({ value: 0 })
		minimum.add({ value: -0 })
		maximum.add({ value: -0 })
		maximum.add({ value: 0 })
		expect(Object.is(minimum.value, -0)).toBe(true)
		expect(Object.is(maximum.value, 0)).toBe(true)
	})

	it('sums in arrival order', () => {
		const sum = new StreamAggregate('sum', 'value')
		for (const value of [1e16, 1, -1e16]) sum.add({ value })
		expect(sum.value).toBe(0)
	})

	it('refuses an operation outside AGGREGATE_OPERATIONS before any row', () => {
		const error = captureError(() => Reflect.construct(StreamAggregate, ['median', 'amount']))
		expect(error).toMatchObject({ code: 'VALIDATION', context: { operation: 'median' } })
		expect(isDatabaseError(error)).toBe(true)
	})
})
