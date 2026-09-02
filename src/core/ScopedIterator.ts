import type { AdmissionInterface } from './types.js'

/**
 * Forms the internal continuation admission boundary for one scoped async iterable.
 *
 * @remarks
 * Each continuation enters the owning {@link AdmissionInterface} ledger
 * independently, so an idle iterator never delays a transaction, a settlement,
 * or a close. `ready` runs inside the tracked continuation before the source
 * advances, which is where a root stream re-establishes the lazy connection and
 * a transaction-scoped stream does nothing. A continuation requested after
 * admission closes attempts source cleanup exactly once and leaves the iterator
 * terminal.
 */
export class ScopedIterator<T> implements AsyncIterableIterator<T> {
	readonly #source: AsyncIterator<T>
	readonly #admission: AdmissionInterface
	readonly #ready: () => Promise<void>
	#cleaned = false

	constructor(source: AsyncIterable<T>, admission: AdmissionInterface, ready: () => Promise<void>) {
		this.#source = source[Symbol.asyncIterator]()
		this.#admission = admission
		this.#ready = ready
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<T> {
		return this
	}

	next(): Promise<IteratorResult<T>> {
		return this.#continue(() => this.#next())
	}

	return(): Promise<IteratorResult<T>> {
		return this.#continue(() => this.#return())
	}

	throw(error?: unknown): Promise<IteratorResult<T>> {
		return this.#continue(() => this.#throw(error))
	}

	async #next(): Promise<IteratorResult<T>> {
		if (this.#cleaned) return { done: true, value: undefined }
		await this.#ready()
		const result = await this.#source.next()
		if (result.done === true) this.#cleaned = true
		return result
	}

	async #return(): Promise<IteratorResult<T>> {
		if (this.#cleaned || this.#source.return === undefined) {
			this.#cleaned = true
			return { done: true, value: undefined }
		}
		this.#cleaned = true
		return this.#source.return()
	}

	async #throw(error: unknown): Promise<IteratorResult<T>> {
		if (this.#source.throw !== undefined) {
			const result = await this.#source.throw(error)
			if (result.done === true) this.#cleaned = true
			return result
		}
		try {
			await this.#return()
		} catch {}
		throw error
	}

	#continue<R>(operation: () => Promise<R>): Promise<R> {
		if (!this.#admission.accepting) this.#cleanup()
		return this.#admission.track(operation)
	}

	#cleanup(): void {
		if (this.#cleaned) return
		this.#cleaned = true
		try {
			const cleanup = this.#source.return?.()
			cleanup?.catch(() => {})
		} catch {}
	}
}
