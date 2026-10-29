/**
 * Tracks the matching-row position of one streaming page.
 *
 * @example
 * ```ts
 * const page = new StreamPage(1)
 * page.next() // false
 * page.next() // true
 * page.count // 1
 * ```
 */
export class StreamPage {
	readonly #offset: number
	#position = 0

	constructor(offset: number) {
		this.#offset = offset
	}

	get count(): number {
		return Math.max(0, this.#position - this.#offset)
	}

	next(): boolean {
		this.#position += 1
		return this.#position > this.#offset
	}
}
