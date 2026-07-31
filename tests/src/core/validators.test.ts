import {
	isColumnSchema,
	isDriverMetadata,
	isDriverSchema,
	isKey,
	isMigration,
	isMigrationInput,
	isMigrationStep,
	isTableSchema,
	validatePage,
} from '@src/core'
import { describe, expect, it } from 'vitest'

const COLUMN = { name: 'id', storage: 'text', optional: false, nullable: false }
const TABLE = {
	name: 'users',
	primary: 'id',
	columns: [COLUMN],
	indexes: [['id']],
}
const STEP = { operation: 'column.remove', table: 'users', column: 'legacy' }
const PLAN = { from: 1, to: 2, steps: [STEP] }
const METADATA = { version: 2, schema: [TABLE] }

describe('database boundary validators', () => {
	it('accepts every valid declaration level', () => {
		expect(isKey('u1')).toBe(true)
		expect(isKey(42)).toBe(true)
		expect(isColumnSchema(COLUMN)).toBe(true)
		expect(isTableSchema(TABLE)).toBe(true)
		expect(isDriverSchema([TABLE])).toBe(true)
		expect(isMigrationStep(STEP)).toBe(true)
		expect(isMigration(PLAN)).toBe(true)
		expect(isDriverMetadata(METADATA)).toBe(true)
		expect(isMigrationInput({ plan: PLAN, metadata: METADATA })).toBe(true)
	})

	it('rejects malformed declarations without throwing', () => {
		expect(isKey(Number.NaN)).toBe(false)
		expect(isKey(Number.POSITIVE_INFINITY)).toBe(false)
		expect(isKey(true)).toBe(false)
		expect(isColumnSchema({ ...COLUMN, storage: 'string' })).toBe(false)
		expect(isColumnSchema({ ...COLUMN, extra: true })).toBe(false)
		expect(isTableSchema({ ...TABLE, columns: [null] })).toBe(false)
		expect(isTableSchema({ ...TABLE, extra: true })).toBe(false)
		expect(isMigrationStep({ ...STEP, operation: 'column.rename' })).toBe(false)
		expect(isMigration({ ...PLAN, to: Number.NaN })).toBe(false)
		expect(isDriverMetadata({ ...METADATA, version: Number.POSITIVE_INFINITY })).toBe(false)
		expect(isMigrationInput({ plan: PLAN, metadata: { version: '2', schema: [] } })).toBe(false)
		expect(isMigrationInput({ plan: PLAN, extra: true })).toBe(false)
	})

	it('rejects duplicate identities and broken table references', () => {
		expect(isTableSchema({ ...TABLE, columns: [COLUMN, COLUMN] })).toBe(false)
		expect(isTableSchema({ ...TABLE, primary: 'missing' })).toBe(false)
		expect(isTableSchema({ ...TABLE, indexes: [[]] })).toBe(false)
		expect(isTableSchema({ ...TABLE, indexes: [['missing']] })).toBe(false)
		expect(isTableSchema({ ...TABLE, indexes: [['id'], ['id']] })).toBe(false)
		expect(isDriverSchema([TABLE, TABLE])).toBe(false)
	})

	it('rejects sparse and decorated arrays at every position', () => {
		const first: unknown[] = []
		first.length = 1
		const middle: unknown[] = [COLUMN]
		middle.length = 3
		middle[2] = COLUMN
		const last: unknown[] = [COLUMN]
		last.length = 2
		const decorated: unknown[] = [COLUMN]
		Object.defineProperty(decorated, 'extra', { enumerable: true, value: true })

		for (const columns of [first, middle, last, decorated]) {
			expect(isTableSchema({ ...TABLE, columns })).toBe(false)
		}

		const steps: unknown[] = [STEP]
		Object.defineProperty(steps, 'extra', { enumerable: true, value: true })
		expect(isMigration({ ...PLAN, steps })).toBe(false)
	})

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
			let error: unknown
			try {
				validatePage(input)
			} catch (caught) {
				error = caught
			}

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

	it('is total over accessors, proxies, and revoked proxies', () => {
		const fault = new Error('hostile boundary')
		const accessor = Object.defineProperty({}, 'operation', {
			enumerable: true,
			get: () => {
				throw fault
			},
		})
		const proxy = new Proxy(
			{},
			{
				get: () => {
					throw fault
				},
			},
		)
		const revoked = Proxy.revocable({}, {})
		revoked.revoke()

		for (const value of [accessor, proxy, revoked.proxy]) {
			expect(isColumnSchema(value)).toBe(false)
			expect(isTableSchema(value)).toBe(false)
			expect(isDriverSchema(value)).toBe(false)
			expect(isMigrationStep(value)).toBe(false)
			expect(isMigration(value)).toBe(false)
			expect(isDriverMetadata(value)).toBe(false)
			expect(isMigrationInput(value)).toBe(false)
		}
	})
})
