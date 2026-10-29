import type {
	IndexedDBCursorInterface,
	IndexedDBTransactionStoreInterface,
} from '@orkestrel/indexeddb'

/** Advances a migration-owned transaction cursor only when its next row is requested. */
export class IndexedDBMigrationIterator implements AsyncIterableIterator<IndexedDBCursorInterface> {
	readonly #store: IndexedDBTransactionStoreInterface
	#cursor: IndexedDBCursorInterface | null | undefined

	constructor(store: IndexedDBTransactionStoreInterface) {
		this.#store = store
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<IndexedDBCursorInterface> {
		return this
	}

	async next(): Promise<IteratorResult<IndexedDBCursorInterface>> {
		this.#cursor =
			this.#cursor === undefined
				? await this.#store.cursor()
				: this.#cursor === null
					? null
					: await this.#cursor.continue()
		return this.#cursor === null
			? { done: true, value: undefined }
			: { done: false, value: this.#cursor }
	}
}
