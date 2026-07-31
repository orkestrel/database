import type { TransactionScope } from './TransactionScope.js'

/**
 * The internal continuation boundary for one transaction-scoped async iterable.
 *
 * @remarks
 * Each active continuation enters the owning transaction ledger independently,
 * so an idle iterator never pins settlement. A continuation requested after
 * admission closes rejects while still attempting source cleanup exactly once.
 */
export class TransactionIterator<T> implements AsyncIterableIterator<T> {
	readonly #source: AsyncIterator<T>
	readonly #scope: TransactionScope
	#cleaned = false

	constructor(source: AsyncIterable<T>, scope: TransactionScope) {
		this.#source = source[Symbol.asyncIterator]()
		this.#scope = scope
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
		if (!this.#scope.accepting) this.#cleanup()
		return this.#scope.track(operation)
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
