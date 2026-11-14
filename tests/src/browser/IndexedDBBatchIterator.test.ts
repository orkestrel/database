import type { AccessPosition } from '@src/browser'
import { IndexedDBBatchIterator, STREAM_BATCH_SIZE } from '@src/browser'
import { createIndexedDBDatabase } from '@orkestrel/indexeddb'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { deleteDatabase, mintDatabase } from '../../setupBrowser.js'

// `IndexedDBBatchIterator` (src/browser/IndexedDBBatchIterator.ts) over a real store: each batch
// is one `records(range, count)` call, read past the position the previous batch reports.

describe('IndexedDBBatchIterator', () => {
	it('reads each batch past the position the previous batch reports, up to its limit', async () => {
		const name = mintDatabase('database-batch-iterator')
		const database = createIndexedDBDatabase({ name, stores: { books: { path: 'id' } } })
		const reads = createRecorder<[position: AccessPosition | undefined, size: number]>()
		try {
			await database
				.store('books')
				.set([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }])
			const batches = new IndexedDBBatchIterator(async (position, size) => {
				reads.handler(position, size)
				const after =
					position === undefined ? undefined : IDBKeyRange.lowerBound(position.primary, true)
				const rows = await database.store('books').records(after, Math.min(size, 2))
				const id = String(rows.at(-1)?.id)
				return rows.length < Math.min(size, 2)
					? { rows }
					: { rows, position: { key: id, primary: id } }
			}, 3)
			const read: unknown[] = []
			for await (const batch of batches) read.push(batch.map((row) => row.id))
			expect(read).toEqual([['a', 'b'], ['c']])
			expect(reads.calls).toEqual([
				[undefined, 3],
				[{ key: 'b', primary: 'b' }, 1],
			])
			expect(await batches.next()).toEqual({ done: true, value: undefined })
			expect(reads.count).toBe(2)
		} finally {
			database.close()
			await deleteDatabase(name)
		}
	})

	it('asks for one batch at a time, and ends at a batch without a position or an empty one', async () => {
		const reads = createRecorder<[position: AccessPosition | undefined, size: number]>()
		const batches = new IndexedDBBatchIterator(async (position, size) => {
			reads.handler(position, size)
			return position === undefined
				? { rows: [{ id: 'a' }], position: { key: 'a', primary: 'a' } }
				: { rows: [] }
		})
		expect(await batches.next()).toEqual({ done: false, value: [{ id: 'a' }] })
		expect(await batches.next()).toEqual({ done: true, value: undefined })
		expect(await batches.next()).toEqual({ done: true, value: undefined })
		expect(reads.calls.map(([, size]) => size)).toEqual([STREAM_BATCH_SIZE, STREAM_BATCH_SIZE])
	})
})
