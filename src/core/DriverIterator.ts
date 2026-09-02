/**
 * Forms the internal continuation boundary for a root driver async iterator.
 *
 * @remarks
 * A driver transaction can begin while a caller holds an idle root iterator.
 * Every `next` therefore checks the driver's root-state guard immediately
 * before and after advancing the source. A failed continuation terminalizes the
 * iterator, discards any row produced before the post-advance guard failed, and
 * attempts source cleanup exactly once.
 */
export class DriverIterator<T> implements AsyncIterableIterator<T> {
	readonly #source: AsyncIterator<T>
	readonly #guard: () => void
	#terminal = false
	#cleaned = false

	constructor(source: AsyncIterator<T>, guard: () => void) {
		this.#source = source
		this.#guard = guard
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<T> {
		return this
	}

	async next(): Promise<IteratorResult<T>> {
		if (this.#terminal) return { done: true, value: undefined }
		try {
			this.#guard()
			const result = await this.#source.next()
			this.#guard()
			if (result.done === true) {
				this.#terminal = true
				this.#cleaned = true
			}
			return result
		} catch (error) {
			this.#terminal = true
			await this.#discard()
			throw error
		}
	}

	async return(): Promise<IteratorResult<T>> {
		if (this.#terminal) return { done: true, value: undefined }
		this.#terminal = true
		if (this.#cleaned || this.#source.return === undefined) {
			this.#cleaned = true
			return { done: true, value: undefined }
		}
		this.#cleaned = true
		return this.#source.return()
	}

	async throw(error?: unknown): Promise<IteratorResult<T>> {
		if (this.#terminal) throw error
		if (this.#source.throw === undefined) {
			this.#terminal = true
			await this.#discard()
			throw error
		}
		try {
			const result = await this.#source.throw(error)
			if (result.done === true) {
				this.#terminal = true
				this.#cleaned = true
			}
			return result
		} catch (cause) {
			this.#terminal = true
			await this.#discard()
			throw cause
		}
	}

	async #discard(): Promise<void> {
		if (this.#cleaned) return
		this.#cleaned = true
		try {
			await this.#source.return?.()
		} catch {}
	}
}
