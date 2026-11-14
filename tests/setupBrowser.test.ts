import { describe, expect, it } from 'vitest'
import {
	BENCH_KEYS,
	BENCH_ROWS,
	BenchBatches,
	buildBenchRow,
	buildItem,
	buildItems,
	ITEM_INDEX_NAMES,
	mintDatabase,
	readCounter,
} from './setupBrowser.js'

// The browser test setup module's proof (`tests/setupBrowser.ts`). Its subject is the exported
// test infrastructure the `src:browser` suites are driven over.
//
// Proven here is the host-independent half: `mintDatabase`, which is arithmetic over a module
// counter, and the row builders and constant tables the plan suites and the bench read. The
// DOM-driving half reads `globalThis.indexedDB` or a live `IDBDatabase`. The consuming suites
// prove each against real Chromium storage on every case they set up:
// `tests/src/browser/drivers/IndexedDBDriver.test.ts` proves `deleteDatabase`,
// `putIndexedDBValue`, `readIndexedDBValue`, `putTripwire`, `seedItems`, `armVersionBump`, and
// `readStoredIndexes`; `tests/src/browser/integration.test.ts` proves `indexedDBDatabase`; and
// `tests/src/browser/factories.test.ts` and `tests/src/browser/helpers.test.ts` reuse
// `deleteDatabase` and `mintDatabase`. `seedBenchRecords`, `collectCursor`, and each
// `BENCH_CELLS` operation run in the bench `tests/src/browser/drivers/IndexedDBDriver.bench.ts`,
// which no gate collects: it asserts that each cell's table and wrapper arms answer alike.
//
// Each expectation arrives by a route `tests/setupBrowser.ts` does not share: literal rows,
// literal index names, and set membership rather than a recomputed value.

describe('mintDatabase', () => {
	it('returns a name no earlier call returned', () => {
		const names = [mintDatabase(), mintDatabase(), mintDatabase()]
		expect(new Set(names).size).toBe(names.length)
	})

	it('numbers every name from one shared counter, whatever the prefix', () => {
		const first = readCounter(mintDatabase())
		const prefixed = readCounter(mintDatabase('database-idb-parity'))
		const last = readCounter(mintDatabase())
		expect(prefixed).toBeGreaterThan(first)
		expect(last).toBeGreaterThan(prefixed)
	})

	it('defaults its prefix to database-idb and honours a supplied one', () => {
		expect(mintDatabase()).toMatch(/^database-idb-\d+$/)
		expect(mintDatabase('corruption')).toMatch(/^corruption-\d+$/)
	})
})

describe('buildItem and buildItems', () => {
	it('builds a tag on two rows of three and a null score on each fifth', () => {
		expect([buildItem(0), buildItem(7), buildItem(10)]).toEqual([
			{ id: 'k0000', organization: 'o0', rank: 0, score: null },
			{ id: 'k0007', organization: 'o3', rank: 7, tag: 't2', score: 3.5 },
			{ id: 'k0010', organization: 'o2', rank: 10, tag: 't0', score: null },
		])
		expect(buildItems(3).map((row) => row.id)).toEqual(['k0000', 'k0001', 'k0002'])
		expect(buildItems(0)).toEqual([])
	})

	it('names the indexes of the item planner schema as the store lists them', () => {
		expect(ITEM_INDEX_NAMES).toEqual([
			'organization',
			'rank',
			'tag',
			'score',
			'active',
			'2#12:organization4:rank',
		])
	})
})

describe('buildBenchRow, BenchBatches, and BENCH_KEYS', () => {
	it('builds mixed bodies of 2000, 300, and 24 characters over 40 organizations', () => {
		expect(
			[0, 7, 8, 41].map((position) => {
				const row = buildBenchRow(position)
				return [row.id, row.organization, row.rank, row.body.length]
			}),
		).toEqual([
			['k0000000', 'o0', 0, 2000],
			['k0000007', 'o7', 7, 300],
			['k0000008', 'o8', 8, 24],
			['k0000041', 'o1', 41, 24],
		])
	})

	it('hands each batch 100 fresh rows past its start', () => {
		const batches = new BenchBatches(500)
		const first = batches.next().map((row) => row.rank)
		const second = batches.next().map((row) => row.rank)
		expect([first.length, first[0], first.at(-1), second[0], second.at(-1)]).toEqual([
			100, 500, 599, 600, 699,
		])
	})

	it('lists 100 distinct keys inside the bench table', () => {
		const keys = new Set(BENCH_KEYS)
		expect(keys.size).toBe(100)
		expect([...keys].every((key) => key.startsWith('k') && Number(key.slice(1)) < BENCH_ROWS)).toBe(
			true,
		)
	})
})
