import type { Row } from '@src/core'
import type { AccessBatch, AccessPosition } from './types.js'
import { STREAM_BATCH_SIZE } from './constants.js'

/**
 * Iterates the batches of one stream, each read by its own call, past the position the previous
 * batch reports, up to a total row limit.
 *
 * @remarks
 * `read` receives `undefined` for the first batch and then each batch's `position`, with the
 * number of rows to read: {@link STREAM_BATCH_SIZE}, or fewer where `limit` leaves fewer. It runs
 * one transaction per call, because a transaction cannot stay open across the consumer's awaits,
 * so the stream reads each batch at its own moment. The iterator holds the batch it last
 * returned and no earlier one. It ends after a batch without `position`, at an empty batch, or
 * once it has read `limit` rows.
 *
 * @example
 * ```ts
 * import { IndexedDBBatchIterator } from '@orkestrel/database/browser'
 * import { createIndexedDBDatabase } from '@orkestrel/indexeddb'
 *
 * const database = createIndexedDBDatabase({ name: 'library', stores: { books: { path: 'id' } } })
 * const books = database.store('books')
 * const batches = new IndexedDBBatchIterator(async (position, size) => {
 * 	const after = position === undefined ? undefined : IDBKeyRange.lowerBound(position.primary, true)
 * 	const rows = await books.records(after, size)
 * 	const id = String(rows.at(-1)?.id)
 * 	return rows.length < size ? { rows } : { rows, position: { key: id, primary: id } }
 * }, 5)
 * for await (const batch of batches) batch.length // at most 5 books in all
 * ```
 */
export class IndexedDBBatchIterator implements AsyncIterableIterator<readonly Row[]> {
	readonly #read: (position: AccessPosition | undefined, size: number) => Promise<AccessBatch>
	readonly #limit: number
	#batch: AccessBatch | undefined
	#count = 0

	constructor(
		read: (position: AccessPosition | undefined, size: number) => Promise<AccessBatch>,
		limit = Number.POSITIVE_INFINITY,
	) {
		this.#read = read
		this.#limit = limit
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<readonly Row[]> {
		return this
	}

	async next(): Promise<IteratorResult<readonly Row[]>> {
		const size = Math.min(STREAM_BATCH_SIZE, this.#limit - this.#count)
		if (size <= 0 || (this.#batch !== undefined && this.#batch.position === undefined)) {
			return { done: true, value: undefined }
		}
		this.#batch = await this.#read(this.#batch?.position, size)
		this.#count += this.#batch.rows.length
		return this.#batch.rows.length === 0
			? { done: true, value: undefined }
			: { done: false, value: this.#batch.rows }
	}
}
