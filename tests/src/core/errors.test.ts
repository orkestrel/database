import { DatabaseError, isDatabaseError } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('isDatabaseError', () => {
	it('accepts a class-instance context', () => {
		class Context {
			readonly [key: string]: unknown
			readonly offset = 8
		}

		const context: Readonly<Record<string, unknown>> = new Context()
		const error = new DatabaseError('CONFLICT', 'failure', context)
		expect(isDatabaseError(error)).toBe(true)
	})

	it('accepts a callable context', () => {
		const members: Readonly<Record<string, unknown>> = { offset: 8 }
		const context = Object.assign(() => undefined, members)
		const error = new DatabaseError('CONFLICT', 'failure', context)
		expect(isDatabaseError(error)).toBe(true)
	})
})
