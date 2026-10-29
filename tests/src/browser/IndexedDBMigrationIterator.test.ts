import { IndexedDBMigrationIterator } from '../../../src/browser/IndexedDBMigrationIterator.js'
import { createIndexedDBDatabase } from '@orkestrel/indexeddb'
import { deleteDatabase, mintDatabase } from '../../setupBrowser.js'
import { describe, expect, it } from 'vitest'

describe('IndexedDBMigrationIterator', () => {
	it('reads and updates every cursor row before advancing in key order', async () => {
		// Base: c8b95c5:src/browser/drivers/IndexedDBDriver.ts:749-764.
		const name = mintDatabase('database-migration-iterator')
		const database = createIndexedDBDatabase({ name, stores: { rows: {} } })
		try {
			await database.connect()
			await database.write(['rows'], async (transaction) => {
				const store = transaction.store('rows')
				await store.set({ value: 'b' }, 'b')
				await store.set({ value: 'a' }, 'a')
				const iterator = new IndexedDBMigrationIterator(store)
				const visited: unknown[] = []
				for await (const cursor of iterator) {
					visited.push(cursor.value)
					await cursor.update({ value: cursor.key, migrated: true })
				}
				expect(visited).toEqual([{ value: 'a' }, { value: 'b' }])
				expect(await iterator.next()).toEqual({ done: true, value: undefined })
			})
			expect(await database.store('rows').records()).toEqual([
				{ value: 'a', migrated: true },
				{ value: 'b', migrated: true },
			])
		} finally {
			database.close()
			await deleteDatabase(name)
		}
	})
})
