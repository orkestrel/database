import type { Order, Row } from './types.js'
import { compareOrderKeys, extractOrderKeys, validatePage } from './helpers.js'

/**
 * Keeps one ordered page as rows arrive, holding at most `offset + limit` rows.
 *
 * @remarks
 * The page answers what `sortRows` then a slice answer over the same rows in arrival order: the
 * terms decide in priority order through {@link compareOrderKeys}, and rows the terms tie keep
 * their arrival order when the final term ascends and reverse it when the final term descends.
 * Each row's keys are extracted once. A row costs one comparison against the held row the page
 * would drop first, and a row the page takes costs about one comparison per level of the held
 * rows' heap more; `rows` sorts the held rows once. A zero limit holds no row.
 *
 * @throws A `VALIDATION` `DatabaseError` when `offset` or `limit` is not a finite nonnegative integer
 *
 * @example
 * ```ts
 * const page = new OrderedPage([{ column: 'age', direction: 'descending' }], 1, 1)
 * for (const age of [36, 17, 41]) page.add({ age })
 * page.rows // [{ age: 36 }]
 * page.count // 2
 * ```
 */
export class OrderedPage {
	readonly #order: readonly Order[]
	readonly #offset: number
	readonly #capacity: number
	readonly #descending: boolean
	// A heap of arrival, row, and keys whose root is the held row the page would drop first.
	readonly #heap: Array<readonly [number, Row, readonly unknown[]]> = []
	#arrivals = 0

	constructor(order: readonly Order[], offset: number, limit: number) {
		validatePage({ offset, limit })
		this.#order = order
		this.#offset = offset
		this.#capacity = limit === 0 ? 0 : offset + limit
		this.#descending = order.at(-1)?.direction === 'descending'
	}

	get count(): number {
		return this.#heap.length
	}

	get rows(): readonly Row[] {
		return this.#heap
			.toSorted((left, right) => this.#compare(left, right))
			.slice(this.#offset, this.#capacity)
			.map(([, row]) => row)
	}

	add(row: Row): void {
		const entry = [this.#arrivals, row, extractOrderKeys(row, this.#order)] as const
		this.#arrivals += 1
		if (this.#heap.length < this.#capacity) {
			this.#heap.push(entry)
			this.#rise(this.#heap.length - 1)
			return
		}
		const [last] = this.#heap
		if (last === undefined || this.#compare(entry, last) >= 0) return
		const leaf = this.#descend(0)
		this.#heap[leaf] = entry
		this.#rise(leaf)
	}

	// Order two held entries: the page's terms, then arrival in the final term's direction.
	#compare(
		left: readonly [number, Row, readonly unknown[]],
		right: readonly [number, Row, readonly unknown[]],
	): number {
		return (
			compareOrderKeys(left[2], right[2], this.#order) ||
			(this.#descending ? right[0] - left[0] : left[0] - right[0])
		)
	}

	// Move the entry at `index` toward the root while it sorts after its parent.
	#rise(index: number): void {
		if (index === 0) return
		const parent = (index - 1) >> 1
		const entry = this.#heap[index]
		const above = this.#heap[parent]
		if (entry === undefined || above === undefined || this.#compare(entry, above) <= 0) return
		this.#heap[index] = above
		this.#heap[parent] = entry
		this.#rise(parent)
	}

	// Fill the slot at `index` with its later child, slot by slot down to a leaf, and return that
	// leaf: one comparison a level, so a row that sorts first settles near the leaf it lands on.
	#descend(index: number): number {
		const left = 2 * index + 1
		const first = this.#heap[left]
		const second = this.#heap[left + 1]
		if (first === undefined) return index
		const promoted = second !== undefined && this.#compare(second, first) > 0
		this.#heap[index] = promoted ? second : first
		return this.#descend(promoted ? left + 1 : left)
	}
}
