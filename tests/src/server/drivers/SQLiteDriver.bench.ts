import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { buildCondition, DatabaseFixture } from '../../../setup.js'
import {
	BENCH_ROWS,
	buildBenchRow,
	createBenchDatabase,
	cycleBenchKeys,
} from '../../../setupServer.js'
import type { BENCH_TABLES, BenchWidth } from '../../../setupServer.js'
import type { DatabaseInterface } from '@src/core'
import type { SQLiteDatabaseInterface } from '@orkestrel/sqlite'

// The SQLite driver's cost through `Table` beside the wrapper alone doing the same work with a
// cached statement, on a client-shaped file of taverna's slice size under WAL and `synchronous`
// FULL. The point-read cell reads the statement cache; the others read the driver's share of a
// key list, an `any` read, a page, a count, and a batch. Run it with `npm run test:bench`.

const OPTIONS = { time: 400, warmupTime: 100 }
const ORGANIZATION = buildCondition('organization', 'equals', ['o3'])
const PAGE = {
	conditions: [ORGANIZATION],
	order: [{ column: 'rank', direction: 'descending' as const }],
	limit: 10,
	offset: 100,
}

for (const width of ['narrow', 'mixed'] as const satisfies readonly BenchWidth[]) {
	describe(`SQLiteDriver on ${String(BENCH_ROWS)} ${width} rows`, () => {
		const scratch = createScratch({ prefix: 'database-bench-' })
		const database = new DatabaseFixture<DatabaseInterface<typeof BENCH_TABLES>>()
		const wrapper = new DatabaseFixture<SQLiteDatabaseInterface>()
		const keys = cycleBenchKeys(7919)
		const batches = cycleBenchKeys(104729)
		const listed = Array.from({ length: 100 }, () => keys.next().value)

		beforeAll(async () => {
			const created = await createBenchDatabase(join(scratch.path, 'items.db'), width)
			database.hold(created.database)
			wrapper.hold(created.wrapper)
		}, 120_000)

		afterAll(async () => {
			wrapper.value.close()
			await database.value.close()
			scratch.destroy()
		})

		test('point read', async ({ bench }) => {
			const statement = wrapper.value.prepare('SELECT * FROM "items" WHERE "id" = ?')
			const result = await bench.compare(
				bench('table', async () => database.value.table('items').get(keys.next().value)),
				bench('wrapper', () => statement.get([keys.next().value])),
				OPTIONS,
			)
			expect(result.get('table').name).toBe('table')
		})

		test('key list of 100', async ({ bench }) => {
			const statement = wrapper.value.prepare(
				'SELECT * FROM "items" WHERE "id" IN (SELECT value FROM json_each(?))',
			)
			const result = await bench.compare(
				bench('table', async () => database.value.table('items').get(listed)),
				bench('wrapper', () => statement.all([JSON.stringify(listed)])),
				OPTIONS,
			)
			expect(result.get('wrapper').name).toBe('wrapper')
		})

		test('any of 100 keys beside a tenant', async ({ bench }) => {
			const input = { conditions: [buildCondition('id', 'any', listed), ORGANIZATION] }
			const statement = wrapper.value.prepare(
				'SELECT * FROM "items" WHERE ("id" IN (SELECT value FROM json_each(?)) AND +"organization" = ?) ORDER BY "id" ASC',
			)
			const result = await bench.compare(
				bench('table', async () => database.value.table('items').records(input)),
				bench('wrapper', () => statement.all([JSON.stringify(listed), 'o3'])),
				OPTIONS,
			)
			expect(result.get('table').name).toBe('table')
		})

		test('page of 10 at offset 100', async ({ bench }) => {
			const statement = wrapper.value.prepare(
				'SELECT * FROM "items" WHERE "organization" = ? ORDER BY "rank" DESC, "id" DESC LIMIT ? OFFSET ?',
			)
			const result = await bench.compare(
				bench('table', async () => database.value.table('items').records(PAGE)),
				bench('wrapper', () => statement.all(['o3', 10, 100])),
				OPTIONS,
			)
			expect(result.get('table').name).toBe('table')
		})

		test('count of a tenant', async ({ bench }) => {
			const statement = wrapper.value.prepare(
				'SELECT COUNT(*) AS "value" FROM "items" WHERE "organization" = ?',
			)
			const result = await bench.compare(
				bench('table', async () =>
					database.value.table('items').count({ conditions: [ORGANIZATION] })),
				bench('wrapper', () => statement.get(['o3'])),
				OPTIONS,
			)
			expect(result.get('table').name).toBe('table')
		})

		test('batch of 100 writes', async ({ bench }) => {
			const statement = wrapper.value.prepare(
				'INSERT OR REPLACE INTO "items" ("id", "organization", "rank", "body") VALUES (?, ?, ?, ?)',
			)
			const result = await bench.compare(
				bench('table', async () =>
					database.value
						.table('items')
						.set(
							Array.from({ length: 100 }, () =>
								buildBenchRow(Number(batches.next().value.slice(1)), width),
							),
						)),
				bench('wrapper', () => {
					wrapper.value.execute('BEGIN IMMEDIATE')
					for (const row of Array.from({ length: 100 }, () =>
						buildBenchRow(Number(batches.next().value.slice(1)), width),
					)) {
						statement.execute([row.id, row.organization, row.rank, row.body])
					}
					wrapper.value.execute('COMMIT')
				}),
				OPTIONS,
			)
			expect(result.get('wrapper').name).toBe('wrapper')
		})
	})
}
