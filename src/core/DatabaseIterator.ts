import type { DatabaseContext } from './DatabaseContext.js'

/**
 * The internal continuation admission boundary for a root database stream.
 *
 * @remarks
 * Each continuation enters the shared root operation ledger independently, so
 * an idle iterator never delays a transaction or close. A continuation rejected
 * after transaction or close admission closes attempts source cleanup exactly
 * once and leaves the iterator terminal.
 */
export class DatabaseIterator<T> implements AsyncIterableIterator<T> {
	readonly #source: AsyncIterator<T>
	readonly #context: DatabaseContext
	#cleaned = false

	constructor(source: AsyncIterable<T>, context: DatabaseContext) {
		this.#source = source[Symbol.asyncIterator]()
		this.#context = context
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
		await this.#context.connect()
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
		if (!this.#context.accepting) this.#cleanup()
		return this.#context.track(operation)
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
