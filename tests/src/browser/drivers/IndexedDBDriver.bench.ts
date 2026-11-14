import type { TableInterface } from '@src/core'
import type { IndexedDBDatabaseInterface } from '@orkestrel/indexeddb'
import type { BenchRow } from '../../../setupBrowser.js'
import { createDatabase } from '@src/core'
import { createIndexedDBDriver } from '@src/browser'
import { createIndexedDBDatabase } from '@orkestrel/indexeddb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DatabaseFixture } from '../../../setup.js'
import {
	BenchBatches,
	BENCH_CELLS,
	BENCH_INDEXES,
	BENCH_ROWS,
	BENCH_RUN,
	BENCH_TABLES,
	deleteDatabase,
	mintDatabase,
	seedBenchRecords,
} from '../../../setupBrowser.js'

// The IndexedDB driver's cells beside the wrapper alone, over one client-shaped store of
// `BENCH_ROWS` mixed rows that both arms read. Each cell asserts that both arms answer alike,
// then compares them. No gate collects this file; run it with
// `vitest bench --config vite.config.ts --project src:browser --mode benchmark
// tests/src/browser/drivers/IndexedDBDriver.bench.ts`.

const name = new DatabaseFixture<string>()
const records = new DatabaseFixture<TableInterface<BenchRow>>()
const wrapper = new DatabaseFixture<IndexedDBDatabaseInterface>()
const release = new DatabaseFixture<() => Promise<void>>()
const batches = new BenchBatches(BENCH_ROWS)

// `npm run test:bench` collects every `*.bench.ts` in its Node project, where `indexedDB` is
// undefined, so the cells run only in a browser project.
describe.skipIf(typeof indexedDB === 'undefined')('IndexedDBDriver cells', () => {
	beforeAll(async () => {
		name.hold(mintDatabase('database-idb-bench'))
		await deleteDatabase(name.value)
		await seedBenchRecords(name.value, BENCH_ROWS)
		const database = createDatabase({
			driver: createIndexedDBDriver(name.value),
			tables: BENCH_TABLES,
			indexes: BENCH_INDEXES,
		})
		records.hold(database.table('records'))
		await records.value.count()
		release.hold(() => database.close())
		const raw = createIndexedDBDatabase({
			name: name.value,
			stores: {
				records: {
					indexes: [
						{ name: 'organization', path: 'organization' },
						{ name: 'rank', path: 'rank' },
					],
				},
			},
		})
		await raw.connect()
		wrapper.hold(raw)
	}, 600_000)

	afterAll(async () => {
		wrapper.value.close()
		await release.value()
		await deleteDatabase(name.value)
	})

	it.for(BENCH_CELLS)('$name', async (cell, { bench }) => {
		expect(await cell.table(records.value, batches)).toEqual(
			await cell.wrapper(wrapper.value, batches),
		)
		await bench.compare(
			bench('table', () => cell.table(records.value, batches)),
			bench('wrapper', () => cell.wrapper(wrapper.value, batches)),
			BENCH_RUN,
		)
	})
})
