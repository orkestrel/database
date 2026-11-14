import { createDatabase, createMemoryDriver } from '@src/core'
import { expect, it } from 'vitest'
import { BENCH_COLUMNS, buildBenchRows } from '../../../setup.js'

// The driver's key order on the suite-sized bench table, written in a shuffled order so the sort
// does real work: `keys` over an unchanged key set beside `keys` after a key-set change. The order
// is kept per key set, so the unchanged cell copies a kept list where the changed cell sorts, and
// `scan` reads the same kept order. Run it with `npm run test:bench`.

it('reads a kept key order without sorting it again', async ({ bench }) => {
	const driver = createMemoryDriver()
	const items = createDatabase({ driver, tables: { items: BENCH_COLUMNS } }).table('items')
	const rows = buildBenchRows(1000)
	await items.set(
		rows.flatMap((_, index) => {
			const row = rows[(index * 7919) % rows.length]
			return row === undefined ? [] : [row]
		}),
	)
	const [first] = rows
	if (first === undefined) throw new Error('Expected a bench row')
	const result = await bench.compare(
		bench('keys kept', async () => {
			await driver.keys('items')
		}),
		bench('keys after a change', async () => {
			await driver.delete('items', first.id)
			await driver.write('items', first.id, first)
			await driver.keys('items')
		}),
		{ time: 1000, warmupTime: 200 },
	)
	expect(result.get('keys kept')).toBeFasterThan(result.get('keys after a change'), { delta: 0.5 })
}, 600_000)
