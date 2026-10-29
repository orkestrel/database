import type { USERS } from '../../setupBrowser.js'
import {
	ROWS,
	ROW_CASES,
	SCALAR_CASES,
	memoryDatabase,
	indexedDBDatabase,
	sortById,
} from '../../setupBrowser.js'
import type { DatabaseInterface } from '@src/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseFixture, collectRankStreamIds } from '../../setup.js'
import { deleteDatabase, mintDatabase } from '../../setupBrowser.js'

// Cross-backend PARITY suite — the enduring regression net proving the
// IndexedDB driver (narrow-then-refine over `src/browser`, real Chromium) returns
// byte-identical query results to the reference `MemoryDriver` (the pure core
// engine over a scan), across every clause operator, ordering, paging, and
// aggregate the public `Table` / `Query` surface exposes. Data-driven: one
// shared fixture + two CASES tables (row-returning and scalar-returning), each
// run against both backends and compared.

describe('cross-backend parity — MemoryDriver vs IndexedDBDriver', () => {
	const name = new DatabaseFixture<string>()
	const memory = new DatabaseFixture<DatabaseInterface<{ readonly users: typeof USERS }>>()
	const indexedDB = new DatabaseFixture<DatabaseInterface<{ readonly users: typeof USERS }>>()

	beforeEach(async () => {
		name.hold(mintDatabase('database-idb-parity'))
		await deleteDatabase(name.value)
		memory.hold(memoryDatabase())
		indexedDB.hold(indexedDBDatabase(name.value))
		await memory.value.table('users').set([...ROWS])
		await indexedDB.value.table('users').set([...ROWS])
	})

	afterEach(async () => {
		await memory.value.close()
		memory.clear()
		await indexedDB.value.close()
		indexedDB.clear()
		await deleteDatabase(name.value)
		name.clear()
	})

	for (const testCase of ROW_CASES) {
		it(`rows match the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.execute(memory.value.table('users'))
			const actual = await testCase.execute(indexedDB.value.table('users'))
			expect(testCase.ordered === true ? actual : sortById(actual)).toEqual(
				testCase.ordered === true ? expected : sortById(expected),
			)
		})
	}

	for (const testCase of SCALAR_CASES) {
		it(`scalar matches the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.execute(memory.value.table('users'))
			const actual = await testCase.execute(indexedDB.value.table('users'))
			expect(actual).toBe(expected)
		})
	}

	// stream() over the indexed optional `rank` column, order-insensitive.
	it('stream matches the reference engine — rank below (with absent rows)', async () => {
		expect(await collectRankStreamIds(indexedDB.value.table('users'))).toEqual(
			await collectRankStreamIds(memory.value.table('users')),
		)
	})
})
