import type { DatabaseErrorCode } from '@src/core'
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

	it('accepts a VALIDATION error carrying contract faults', () => {
		const error = new DatabaseError('VALIDATION', 'failure', {
			table: 'users',
			faults: [
				{ reason: 'extra', path: ['nickname'] },
				{ reason: 'missing', path: ['age'], expected: 'integer' },
			],
		})
		expect(isDatabaseError(error)).toBe(true)
	})

	it.each([
		['a non-fault entry', [{ reason: 'extra', path: ['nickname'] }, 'nickname']],
		['an undeclared fault key', [{ reason: 'extra', path: ['nickname'], value: 'Ace' }]],
		['a lone fault outside a list', { reason: 'extra', path: ['nickname'] }],
	])('refuses a faults member holding %s', (_label, faults) => {
		const error = new DatabaseError('VALIDATION', 'failure', { table: 'users', faults })
		expect(isDatabaseError(error)).toBe(false)
	})

	it.each<DatabaseErrorCode>(['CONFLICT', 'DRIVER'])(
		'refuses a %s error whose faults member holds a non-fault',
		(code) => {
			const error = new DatabaseError(code, 'failure', {
				table: 'users',
				faults: [{ reason: 'extra', path: ['nickname'], value: 'Ace' }],
			})
			expect(isDatabaseError(error)).toBe(false)
		},
	)

	it.each<DatabaseErrorCode>(['CONFLICT', 'DRIVER', 'VALIDATION'])(
		'accepts a %s error whose faults member is empty',
		(code) => {
			expect(isDatabaseError(new DatabaseError(code, 'failure', { faults: [] }))).toBe(true)
		},
	)

	it.each<DatabaseErrorCode>([
		'CLOSED',
		'NOT_FOUND',
		'CONFLICT',
		'VALIDATION',
		'ABORTED',
		'MIGRATION',
		'CONFORMANCE',
		'DRIVER',
	])('accepts a %s error with and without a context', (code) => {
		expect(isDatabaseError(new DatabaseError(code, 'failure'))).toBe(true)
		expect(isDatabaseError(new DatabaseError(code, 'failure', { table: 'users' }))).toBe(true)
	})
})
