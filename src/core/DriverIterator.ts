/**
 * Forms the internal continuation boundary for a root driver async iterator.
 *
 * @remarks
 * A driver transaction can begin while a caller holds an idle root iterator.
 * Every `next` therefore checks the driver's root-state guard immediately
 * before and after advancing the source. A failed continuation terminalizes the
 * iterator, discards any row produced before the post-advance guard failed, and
 * attempts source cleanup exactly once.
 *
 * A driver implementing the published `DriverInterface` extension seam wraps its
 * own source iterator in one so a root `scan` / `stream` cannot outlive the
 * driver state it was opened against.
 *
 * @typeParam T - The value the wrapped source yields
 *
 * @example
 * ```ts
 * import type { Row } from '@orkestrel/database'
 * import { DatabaseError, DriverIterator } from '@orkestrel/database'
 *
 * // Inside a driver's `scan`, over its own row source and root-state guard.
 * declare const rows: AsyncIterator<Row>
 * declare const transacting: () => boolean
 * const scan = new DriverIterator(rows, () => {
 * 	if (transacting()) {
 * 		throw new DatabaseError('CONFLICT', 'scan: a transaction is active')
 * 	}
 * })
 * for await (const row of scan) row // one row at a time, guarded around each advance
 * ```
 */
export class DriverIterator<T> implements AsyncIterableIterator<T> {
	readonly #source: AsyncIterator<T>
	readonly #guard: () => void
	#terminal = false
	#cleaned = false

	/**
	 * Wraps one source iterator in the continuation boundary.
	 *
	 * @param source - The driver's own row iterator, advanced once per `next`
	 * @param guard - The root-state check, run immediately before and after each advance; it throws to terminalize the iteration
	 */
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
