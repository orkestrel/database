import { admitValue, createContract } from '@orkestrel/contract'
import { queryInputContract, queryInputShape } from '@src/core'
import { describe, expect, it } from 'vitest'
import { OPERATOR_ARITIES } from '../../setup.js'

describe('queryInputContract', () => {
	for (const { operator, admitted, refused } of OPERATOR_ARITIES) {
		it(`holds the arity of ${operator}`, () => {
			for (const values of admitted) {
				expect(
					queryInputContract.is({
						conditions: [{ column: 'c', operator, values, connector: 'and' }],
					}),
				).toBe(true)
			}
			for (const values of refused) {
				expect(
					queryInputContract.is({
						conditions: [{ column: 'c', operator, values, connector: 'or' }],
					}),
				).toBe(false)
			}
		})
	}

	it('names the operator candidates when the operator is unknown', () => {
		const admission = admitValue(queryInputContract, {
			conditions: [{ column: 'c', operator: 'similar', values: [1], connector: 'and' }],
		})
		expect(admission.success ? [] : admission.error.faults).toEqual([
			{
				reason: 'variant',
				path: ['conditions', '0'],
				variants: 5,
				key: 'operator',
				expected: [
					'absent',
					'present',
					'equals',
					'not',
					'above',
					'below',
					'from',
					'to',
					'like',
					'glob',
					'starts',
					'ends',
					'between',
					'any',
					'none',
				],
			},
		])
	})

	it('admits a column name or a non-empty key list, and refuses an empty list', () => {
		const answers = ['age', ['profile', 'age'], [], ['profile', 1]].map((column) =>
			queryInputContract.is({
				conditions: [{ column, operator: 'present', values: [], connector: 'and' }],
				order: [{ column, direction: 'descending' }],
			}),
		)
		expect(answers).toEqual([true, true, false, false])
	})

	it('refuses an undeclared key, an unknown connector or direction, and a fractional page', () => {
		const condition = { column: 'c', operator: 'equals', values: [1], connector: 'and' }
		expect(queryInputContract.is({})).toBe(true)
		expect(queryInputContract.is({ conditions: [{ ...condition, extra: true }] })).toBe(false)
		expect(queryInputContract.is({ conditions: [{ ...condition, connector: 'xor' }] })).toBe(false)
		expect(queryInputContract.is({ order: [{ column: 'c', direction: 'up' }] })).toBe(false)
		expect(queryInputContract.is({ limit: 1.5 })).toBe(false)
		expect(queryInputContract.is({ offset: -1 })).toBe(false)
		expect(queryInputContract.is({ limit: 0, offset: 0 })).toBe(true)
		expect(queryInputContract.is({ where: [] })).toBe(false)
	})

	it('refuses an undefined operand, which an array member of a shape cannot declare', () => {
		expect(
			queryInputContract.is({
				conditions: [{ column: 'c', operator: 'equals', values: [undefined], connector: 'and' }],
			}),
		).toBe(false)
	})

	it('compiles from queryInputShape to the same schema', () => {
		expect(createContract(queryInputShape).schema).toEqual(queryInputContract.schema)
	})
})

describe('queryInputContract — the column of every arm', () => {
	for (const { operator, admitted } of OPERATOR_ARITIES) {
		it(`admits a name and a non-empty key list under ${operator}, and refuses an empty list or a non-string key`, () => {
			const [values = []] = admitted
			const answers = ['age', ['profile', 'age'], [], ['profile', 1], 7].map((column) =>
				queryInputContract.is({ conditions: [{ column, operator, values, connector: 'and' }] }),
			)
			expect(answers).toEqual([true, true, false, false, false])
		})
	}
})
