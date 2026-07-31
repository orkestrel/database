import type { FieldPath } from '@orkestrel/contract'
import type {
	AggregateOperation,
	Condition,
	OperationOptions,
	Order,
	QueryInterface,
	TableInterface,
} from './types.js'
import { computeAggregate } from './helpers.js'
import { validatePage } from './validators.js'

/**
 * A fluent query builder bound to one table.
 *
 * @remarks
 * Accumulates typed conditions, ordering, JS filters, and a page. Each builder
 * method mutates and returns the same instance. Portable inputs flow to the
 * table, while predicates remain an in-memory refinement.
 */
export class Query<T = Record<string, unknown>> implements QueryInterface<T> {
	readonly #table: TableInterface<T>
	readonly #conditions: Condition[] = []
	readonly #orders: Order[] = []
	readonly #filters: ((row: T) => boolean)[] = []
	#limit: number | undefined
	#offset: number | undefined

	constructor(table: TableInterface<T>) {
		this.#table = table
	}

	condition(input: Condition): QueryInterface<T> {
		this.#conditions.push(input)
		return this
	}

	order(input: Order): QueryInterface<T> {
		this.#orders.push(input)
		return this
	}

	filter(predicate: (row: T) => boolean): QueryInterface<T> {
		this.#filters.push(predicate)
		return this
	}

	limit(count: number): QueryInterface<T> {
		validatePage({ limit: count })
		this.#limit = count
		return this
	}

	offset(count: number): QueryInterface<T> {
		validatePage({ offset: count })
		this.#offset = count
		return this
	}

	async collect(): Promise<readonly T[]> {
		if (this.#filters.length === 0) {
			return this.#table.records({
				conditions: this.#conditions,
				order: this.#orders,
				...(this.#limit !== undefined ? { limit: this.#limit } : {}),
				...(this.#offset !== undefined ? { offset: this.#offset } : {}),
			})
		}
		const fetched = await this.#table.records({
			conditions: this.#conditions,
			order: this.#orders,
		})
		return this.#page(this.#filtered(fetched))
	}

	async find(): Promise<T | undefined> {
		const rows = await this.collect()
		return rows[0]
	}

	async count(): Promise<number> {
		if (this.#filters.length === 0) {
			return this.#table.count({ conditions: this.#conditions })
		}
		const fetched = await this.#table.records({ conditions: this.#conditions })
		return this.#filtered(fetched).length
	}

	/**
	 * Lazily evaluate conditions, filters, offset, and limit.
	 *
	 * @param options - Optional abort options
	 * @returns Matching rows in storage order
	 */
	async *stream(options?: OperationOptions): AsyncIterable<T> {
		if (this.#filters.length === 0) {
			yield* this.#table.scan(
				{
					conditions: this.#conditions,
					...(this.#limit !== undefined ? { limit: this.#limit } : {}),
					...(this.#offset !== undefined ? { offset: this.#offset } : {}),
				},
				options,
			)
			return
		}
		const offset = this.#offset ?? 0
		let matched = 0
		let yielded = 0
		for await (const row of this.#table.scan({ conditions: this.#conditions }, options)) {
			if (this.#limit !== undefined && yielded >= this.#limit) break
			let matches = true
			for (const predicate of this.#filters) {
				if (!predicate(row)) {
					matches = false
					break
				}
			}
			if (!matches) continue
			if (matched < offset) {
				matched += 1
				continue
			}
			matched += 1
			yielded += 1
			yield row
		}
	}

	aggregate(operation: AggregateOperation, column: FieldPath): Promise<number | undefined> {
		if (this.#filters.length === 0) {
			return this.#table.aggregate(operation, column, {
				conditions: this.#conditions,
			})
		}
		return this.#table
			.records({ conditions: this.#conditions })
			.then((fetched) => computeAggregate(this.#filtered(fetched), operation, column))
	}

	#filtered(rows: readonly T[]): readonly T[] {
		let result = rows
		for (const predicate of this.#filters) result = result.filter(predicate)
		return result
	}

	#page(rows: readonly T[]): readonly T[] {
		const offset = this.#offset ?? 0
		if (offset === 0 && this.#limit === undefined) return rows
		return rows.slice(offset, this.#limit === undefined ? undefined : offset + this.#limit)
	}
}
