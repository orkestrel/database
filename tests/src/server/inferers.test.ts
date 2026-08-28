import { inferValueStorage } from '@src/server'
import { describe, expect, it } from 'vitest'

// The value inferer decides what a NESTED (`json_extract`) operand must encode
// as: `json_extract` hands back the natively-typed scalar, so the operand has to
// reach the same storage class to compare rather than the column's declared
// `json`.

describe('inferValueStorage', () => {
	it('maps a boolean to boolean', () => {
		expect(inferValueStorage(true)).toBe('boolean')
		expect(inferValueStorage(false)).toBe('boolean')
	})

	it('maps an integer number to integer and a fractional number to real', () => {
		expect(inferValueStorage(9)).toBe('integer')
		expect(inferValueStorage(1.5)).toBe('real')
	})

	it('maps a bigint to integer', () => {
		expect(inferValueStorage(7n)).toBe('integer')
	})

	it('maps an object / array to json', () => {
		expect(inferValueStorage({ a: 1 })).toBe('json')
		expect(inferValueStorage([1, 2])).toBe('json')
	})

	it('maps a string, null, and undefined to text', () => {
		expect(inferValueStorage('hi')).toBe('text')
		expect(inferValueStorage(null)).toBe('text')
		expect(inferValueStorage(undefined)).toBe('text')
	})
})
