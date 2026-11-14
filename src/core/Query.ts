import type { FieldPath } from '@orkestrel/contract'
import type {
	Aggregate,
	AggregateOperation,
	Condition,
	OperationOptions,
	Order,
	QueryInput,
	QueryInterface,
	ReadInput,
	Row,
	TableInterface,
} from './types.js'
import { computeAggregate } from './helpers.js'
import { StreamPage } from './StreamPage.js'

/**
 * Builds a read against one table through a fluent chain.
 *
 * @remarks
 * Accumulates typed conditions, ordering, JS filters, and a page. Each builder
 * method mutates and returns the same instance. Portable inputs flow to the
 * table, while predicates remain an in-memory refinement. `admit` and `admitAggregate` are the
 * table's door: a page the builder sets and an aggregate the query computes itself after a filter
 * pass it, with its conditions, in one door call.
 */
export class Query<T = Row> implements QueryInterface<T> {
	readonly #table: TableInterface<T>
	readonly #admit: (input: unknown) => QueryInput
	readonly #admitAggregate: (
		input: unknown,
		aggregate: unknown,
	) => ReadInput & { readonly aggregate: Aggregate }
	readonly #conditions: Condition[] = []
	readonly #orders: Order[] = []
	readonly #filters: Array<(row: T) => boolean> = []
	#limit: number | undefined
	#offset: number | undefined

	constructor(
		table: TableInterface<T>,
		admit: (input: unknown) => QueryInput,
		admitAggregate: (
			input: unknown,
			aggregate: unknown,
		) => ReadInput & { readonly aggregate: Aggregate },
	) {
		this.#table = table
		this.#admit = admit
		this.#admitAggregate = admitAggregate
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
		this.#admit({ limit: count })
		this.#limit = count
		return this
	}

	offset(count: number): QueryInterface<T> {
		this.#admit({ offset: count })
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
		if (this.#orders.length === 0) {
			const rows: T[] = []
			for await (const row of this.stream()) rows.push(row)
			return rows
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
	 * Evaluates conditions, filters, offset, and limit lazily.
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
		const page = new StreamPage(this.#offset ?? 0)
		for await (const row of this.#table.scan({ conditions: this.#conditions }, options)) {
			if (this.#limit !== undefined && page.count >= this.#limit) break
			if (!Iterator.from(this.#filters).every((predicate) => predicate(row))) continue
			if (!page.next()) continue
			yield row
		}
	}

	async aggregate(operation: AggregateOperation, column: FieldPath): Promise<number | undefined> {
		if (this.#filters.length === 0) {
			return this.#table.aggregate(operation, column, {
				conditions: this.#conditions,
			})
		}
		const read = this.#admitAggregate({ conditions: this.#conditions }, { operation, column })
		const fetched = await this.#table.records({ conditions: read.conditions ?? [] })
		return computeAggregate(
			this.#filtered(fetched),
			read.aggregate.operation,
			read.aggregate.column,
		)
	}

	#filtered(rows: readonly T[]): readonly T[] {
		return Iterator.from(this.#filters).reduce(
			(result, predicate) => result.filter(predicate),
			rows,
		)
	}

	#page(rows: readonly T[]): readonly T[] {
		const offset = this.#offset ?? 0
		if (offset === 0 && this.#limit === undefined) return rows
		return rows.slice(offset, this.#limit === undefined ? undefined : offset + this.#limit)
	}
}
