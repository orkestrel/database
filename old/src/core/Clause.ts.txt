import type { FieldPath } from '../types.js'
import type {
	Condition,
	ConditionOperator,
	Connector,
	QueryInterface,
	ClauseInterface,
} from './types.js'

/**
 * A pending condition opened by a query's `where` / `and` / `or`.
 *
 * @remarks
 * Holds the column, the connector that will join this condition to the ones
 * before it, and a recorder the owning query supplies. Each operator builds the
 * {@link Condition}, hands it to the recorder, and returns the query — so the
 * fluent chain flows straight back into the builder without exposing a mutator.
 */
export class Clause<T = Record<string, unknown>> implements ClauseInterface<T> {
	readonly #record: (condition: Condition) => QueryInterface<T>
	readonly #column: FieldPath
	readonly #connector: Connector

	constructor(
		record: (condition: Condition) => QueryInterface<T>,
		column: FieldPath,
		connector: Connector,
	) {
		this.#record = record
		this.#column = column
		this.#connector = connector
	}

	equals(value: unknown): QueryInterface<T> {
		return this.#apply('equals', [value])
	}

	not(value: unknown): QueryInterface<T> {
		return this.#apply('not', [value])
	}

	above(value: unknown): QueryInterface<T> {
		return this.#apply('above', [value])
	}

	below(value: unknown): QueryInterface<T> {
		return this.#apply('below', [value])
	}

	from(value: unknown): QueryInterface<T> {
		return this.#apply('from', [value])
	}

	to(value: unknown): QueryInterface<T> {
		return this.#apply('to', [value])
	}

	between(lower: unknown, upper: unknown): QueryInterface<T> {
		return this.#apply('between', [lower, upper])
	}

	like(pattern: string): QueryInterface<T> {
		return this.#apply('like', [pattern])
	}

	glob(pattern: string): QueryInterface<T> {
		return this.#apply('glob', [pattern])
	}

	starts(prefix: string): QueryInterface<T> {
		return this.#apply('starts', [prefix])
	}

	ends(suffix: string): QueryInterface<T> {
		return this.#apply('ends', [suffix])
	}

	any(values: readonly unknown[]): QueryInterface<T> {
		return this.#apply('any', values)
	}

	none(values: readonly unknown[]): QueryInterface<T> {
		return this.#apply('none', values)
	}

	absent(): QueryInterface<T> {
		return this.#apply('absent', [])
	}

	present(): QueryInterface<T> {
		return this.#apply('present', [])
	}

	#apply(operator: ConditionOperator, values: readonly unknown[]): QueryInterface<T> {
		return this.#record({ column: this.#column, operator, values, connector: this.#connector })
	}
}
