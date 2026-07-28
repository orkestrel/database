import type { FieldPath } from '@orkestrel/contract'
import type {
	AggregateFunction,
	ClauseInterface,
	Condition,
	Connector,
	Order,
	QueryInterface,
	ReadOptions,
	TableInterface,
} from './types.js'
import { computeAggregate } from './helpers.js'
import { Clause } from './Clause.js'

/**
 * A fluent query builder bound to one table.
 *
 * @remarks
 * Accumulates conditions, ordering, JS filters, and a page; each builder method
 * mutates and returns the same instance, so a chain reads as one statement. The
 * portable parts (conditions, order, page) compile into a {@link Criteria} the
 * table resolves; a `filter` predicate is applied in memory after the read and
 * before paging, so it composes with the rest without a backend ever seeing a
 * JS callback.
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

	where(column: FieldPath): ClauseInterface<T> {
		return this.#clause(column, 'and')
	}

	and(column: FieldPath): ClauseInterface<T> {
		return this.#clause(column, 'and')
	}

	or(column: FieldPath): ClauseInterface<T> {
		return this.#clause(column, 'or')
	}

	filter(predicate: (row: T) => boolean): QueryInterface<T> {
		this.#filters.push(predicate)
		return this
	}

	ascending(column: FieldPath): QueryInterface<T> {
		this.#orders.push({ column, direction: 'ascending' })
		return this
	}

	descending(column: FieldPath): QueryInterface<T> {
		this.#orders.push({ column, direction: 'descending' })
		return this
	}

	limit(count: number): QueryInterface<T> {
		this.#limit = count
		return this
	}

	offset(count: number): QueryInterface<T> {
		this.#offset = count
		return this
	}

	async all(): Promise<readonly T[]> {
		// No JS filters → push the whole criteria (including paging) to the table.
		if (this.#filters.length === 0) {
			return this.#table.records({
				conditions: this.#conditions,
				order: this.#orders,
				...(this.#limit !== undefined ? { limit: this.#limit } : {}),
				...(this.#offset !== undefined ? { offset: this.#offset } : {}),
			})
		}
		// With filters → fetch conditions + order, filter in memory, then page.
		const fetched = await this.#table.records({ conditions: this.#conditions, order: this.#orders })
		return this.#page(this.#filtered(fetched))
	}

	async first(): Promise<T | undefined> {
		const rows = await this.all()
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
	 * Lazy per-row evaluation of this query's conditions / filters / offset /
	 * limit.
	 *
	 * @remarks
	 * `order` and its comparators are IGNORED (streaming yields unsorted, as rows
	 * are evaluated one at a time). Same abort semantics as
	 * `TableInterface.scan`: the signal (if any) is checked before each yield,
	 * and breaking out early closes the underlying source.
	 *
	 * @param options - `signal` to cancel the iteration; checked before each yield
	 * @returns An async iterable of matching rows
	 */
	async *stream(options?: ReadOptions): AsyncIterable<T> {
		// No JS filters → the table's own offset/limit apply directly against the
		// condition-matched rows (matching `all()`'s no-filter fast path).
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
		// With filters → offset/limit must apply AFTER filtering, so the table is
		// asked for conditions only and paging is counted here (matching `all()`'s
		// filtered path: fetch, filter in memory, then page).
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

	aggregate(operation: AggregateFunction, column: FieldPath): Promise<number | undefined> {
		if (this.#filters.length === 0) {
			return this.#table.aggregate(operation, column, { conditions: this.#conditions })
		}
		return this.#table
			.records({ conditions: this.#conditions })
			.then((fetched) => computeAggregate(this.#filtered(fetched), operation, column))
	}

	sum(column: FieldPath): Promise<number | undefined> {
		return this.aggregate('sum', column)
	}

	average(column: FieldPath): Promise<number | undefined> {
		return this.aggregate('average', column)
	}

	minimum(column: FieldPath): Promise<number | undefined> {
		return this.aggregate('minimum', column)
	}

	maximum(column: FieldPath): Promise<number | undefined> {
		return this.aggregate('maximum', column)
	}

	#clause(column: FieldPath, connector: Connector): ClauseInterface<T> {
		return new Clause<T>(
			(condition) => {
				this.#conditions.push(condition)
				return this
			},
			column,
			connector,
		)
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
