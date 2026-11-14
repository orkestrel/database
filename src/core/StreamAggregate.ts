import type { FieldPath } from '@orkestrel/contract'
import type { AggregateOperation } from './types.js'
import { isRecord, parseNumber, preview, resolveField } from '@orkestrel/contract'
import { AGGREGATE_OPERATIONS } from './constants.js'
import { DatabaseError } from './errors.js'
import { isAggregateOperation } from './validators.js'

/**
 * Folds one aggregate over rows as they arrive, holding no row.
 *
 * @remarks
 * `count` counts every value offered. The numeric aggregates coerce each cell with the contracts
 * `parseNumber`, so `'42'` counts, and skip a value that is no record and a non-numeric cell;
 * over no numeric value they read `undefined`, the SQL `NULL` of an empty aggregate. A sum adds
 * in arrival order, and the extrema compare each value with a scalar `Math.min` or `Math.max`.
 *
 * @throws A `VALIDATION` {@link DatabaseError} when the operation is not one of {@link AGGREGATE_OPERATIONS}
 *
 * @example
 * ```ts
 * const aggregate = new StreamAggregate('sum', 'age')
 * aggregate.add({ age: 40 })
 * aggregate.add({ age: '2' })
 * aggregate.value // 42
 * ```
 */
export class StreamAggregate {
	readonly #operation: AggregateOperation
	readonly #column: FieldPath
	#count = 0
	#numbers = 0
	#result: number

	constructor(operation: AggregateOperation, column: FieldPath) {
		if (!isAggregateOperation(operation)) {
			throw new DatabaseError(
				'VALIDATION',
				`Aggregate operation ${preview(operation)} is not one of ${AGGREGATE_OPERATIONS.join(', ')}`,
				{ operation },
			)
		}
		this.#operation = operation
		this.#column = column
		this.#result =
			operation === 'minimum'
				? Number.POSITIVE_INFINITY
				: operation === 'maximum'
					? Number.NEGATIVE_INFINITY
					: 0
	}

	get value(): number | undefined {
		if (this.#operation === 'count') return this.#count
		if (this.#numbers === 0) return undefined
		return this.#operation === 'average' ? this.#result / this.#numbers : this.#result
	}

	add(row: unknown): void {
		this.#count += 1
		if (this.#operation === 'count' || !isRecord(row)) return
		const value = parseNumber(resolveField(row, this.#column))
		if (value === undefined) return
		this.#numbers += 1
		this.#result =
			this.#operation === 'minimum'
				? Math.min(this.#result, value)
				: this.#operation === 'maximum'
					? Math.max(this.#result, value)
					: this.#result + value
	}
}
