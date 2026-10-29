import { METRICS } from '../../setupServer.js'
import type { USERS } from '../../setupServer.js'
import {
	ROWS,
	ROW_CASES,
	SCALAR_CASES,
	memoryDatabase,
	sqliteDatabase,
	sortById,
} from '../../setupServer.js'
import type { DatabaseInterface } from '@src/core'
import { createDatabase, createMemoryDriver } from '@src/core'
import { createSQLiteDriver } from '@src/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseFixture, collectRankStreamIds } from '../../setup.js'

// Cross-backend PARITY suite — the enduring regression net proving the
// SQLite driver (exact-or-refine over `src/server`) returns byte-identical
// query results to the reference `MemoryDriver` (the pure core engine over
// a scan), across every clause operator, ordering, paging, and aggregate the
// public `Table` / `Query` surface exposes. Data-driven: one shared fixture +
// two CASES tables (row-returning and scalar-returning), each run against
// both backends and compared.

describe('cross-backend parity — MemoryDriver vs SQLiteDriver', () => {
	const memory = new DatabaseFixture<DatabaseInterface<{ readonly users: typeof USERS }>>()
	const sqlite = new DatabaseFixture<DatabaseInterface<{ readonly users: typeof USERS }>>()

	beforeEach(async () => {
		memory.hold(memoryDatabase())
		sqlite.hold(sqliteDatabase())
		await memory.value.table('users').set([...ROWS])
		await sqlite.value.table('users').set([...ROWS])
	})

	afterEach(async () => {
		await memory.value.close()
		memory.clear()
		await sqlite.value.close()
		sqlite.clear()
	})

	for (const testCase of ROW_CASES) {
		it(`rows match the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.execute(memory.value.table('users'))
			const actual = await testCase.execute(sqlite.value.table('users'))
			expect(testCase.ordered === true ? actual : sortById(actual)).toEqual(
				testCase.ordered === true ? expected : sortById(expected),
			)
		})
	}

	for (const testCase of SCALAR_CASES) {
		it(`scalar matches the reference engine — ${testCase.name}`, async () => {
			const expected = await testCase.execute(memory.value.table('users'))
			const actual = await testCase.execute(sqlite.value.table('users'))
			expect(actual).toBe(expected)
		})
	}

	// stream() over the indexed optional `rank` column, order-insensitive.
	it('stream matches the reference engine — rank below (with absent rows)', async () => {
		expect(await collectRankStreamIds(sqlite.value.table('users'))).toEqual(
			await collectRankStreamIds(memory.value.table('users')),
		)
	})
})

describe('cross-backend public aggregate adversaries', () => {
	it('matches optional-nullable and order-sensitive real accumulation through Table', async () => {
		const memory = createDatabase({
			driver: createMemoryDriver(),
			tables: { metrics: METRICS },
		})
		const sqlite = createDatabase({
			driver: createSQLiteDriver(),
			tables: { metrics: METRICS },
		})
		try {
			const nullable = [
				{ id: 'null', value: null },
				{ id: 'ten', value: 10 },
			]
			await memory.table('metrics').set(nullable)
			await sqlite.table('metrics').set(nullable)
			expect(await sqlite.table('metrics').aggregate('sum', 'value')).toBe(
				await memory.table('metrics').aggregate('sum', 'value'),
			)
			expect(await sqlite.table('metrics').aggregate('average', 'value')).toBe(
				await memory.table('metrics').aggregate('average', 'value'),
			)
			expect(await sqlite.table('metrics').aggregate('minimum', 'value')).toBe(
				await memory.table('metrics').aggregate('minimum', 'value'),
			)
			expect(await sqlite.table('metrics').aggregate('maximum', 'value')).toBe(
				await memory.table('metrics').aggregate('maximum', 'value'),
			)

			await memory.table('metrics').clear()
			await sqlite.table('metrics').clear()
			const adversarial = [
				{ id: 'a', value: 2 ** 53 },
				{ id: 'c', value: -(2 ** 53) },
				{ id: 'b', value: 1 },
			]
			await memory.table('metrics').set(adversarial)
			await sqlite.table('metrics').set(adversarial)
			expect(await sqlite.table('metrics').aggregate('sum', 'value')).toBe(
				await memory.table('metrics').aggregate('sum', 'value'),
			)
			expect(await sqlite.table('metrics').aggregate('average', 'value')).toBe(
				await memory.table('metrics').aggregate('average', 'value'),
			)
		} finally {
			await memory.close()
			await sqlite.close()
		}
	})
})
