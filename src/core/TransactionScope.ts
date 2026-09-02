import type { AdmissionInterface } from './types.js'
import { DatabaseError } from './errors.js'
import { ScopedIterator } from './ScopedIterator.js'

/**
 * Forms the internal lifetime boundary for one database transaction callback.
 *
 * @remarks
 * Promise operations enter synchronously through {@link track}. Closing stops new
 * work while {@link drain} contains every operation already accepted, including
 * work the callback started without awaiting. {@link stream} applies the same
 * boundary to each iterator continuation without retaining an idle iterator.
 */
export class TransactionScope implements AdmissionInterface {
	readonly #operations = new Set<Promise<unknown>>()
	#accepting = true
	#failed = false
	#error: unknown

	get accepting(): boolean {
		return this.#accepting
	}

	check(): void {
		if (!this.#accepting) {
			throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		}
	}

	track<R>(operation: () => Promise<R>): Promise<R> {
		try {
			this.check()
		} catch (error) {
			return Promise.reject(error)
		}
		let promise: Promise<R>
		try {
			promise = operation()
		} catch (error) {
			promise = Promise.reject(error)
		}
		this.#operations.add(promise)
		promise.then(
			() => {
				this.#operations.delete(promise)
			},
			(error: unknown) => {
				this.#operations.delete(promise)
				if (!this.#failed) {
					this.#failed = true
					this.#error = error
				}
			},
		)
		return promise
	}

	stream<T>(source: AsyncIterable<T>): AsyncIterable<T> {
		return new ScopedIterator(source, this, () => Promise.resolve())
	}

	stop(): void {
		this.#accepting = false
	}

	async drain(): Promise<void> {
		while (this.#operations.size > 0) {
			await Promise.allSettled(this.#operations)
		}
		if (this.#failed) throw this.#error
	}
}
