import { createDatabase } from '@src/core'
import { createJSONDriver } from '@src/server'
import { createScratch } from '@orkestrel/test/server'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { BENCH_COLUMNS, buildBenchRows } from '../../../setup.js'

// The point-write cost of the whole-document flush against the document's size: one upsert into a
// file of 2000 bench rows beside one into a file of 4000. The flush rewrites every row, so the cost
// grows with the document and no further; a growth past 2.5 at double size reads a superlinear
// term. The driver keeps the whole-document write until a consumer's reading shows the cost. Run
// it with `npm run test:bench`.

it('writes a row at a cost linear in the document size', async ({ bench }) => {
	const scratch = createScratch({ prefix: 'database-json-bench-' })
	try {
		const drivers = await Promise.all(
			[2000, 4000].map(async (size) => {
				const driver = createJSONDriver(join(scratch.path, `items-${String(size)}.json`))
				await createDatabase({ driver, tables: { items: BENCH_COLUMNS } })
					.table('items')
					.set(buildBenchRows(size))
				return driver
			}),
		)
		const [first] = buildBenchRows(1)
		const [small, large] = drivers
		if (first === undefined || small === undefined || large === undefined) {
			throw new Error('Expected two drivers and a bench row')
		}
		const result = await bench.compare(
			bench('write into 2000 rows', async () => {
				await small.write('items', first.id, first)
			}),
			bench('write into 4000 rows', async () => {
				await large.write('items', first.id, first)
			}),
			{ time: 1000, warmupTime: 200 },
		)
		expect(result.get('write into 4000 rows')).not.toBeSlowerThan(
			result.get('write into 2000 rows'),
			{ delta: 1.5 },
		)
		await Promise.all(drivers.map((driver) => driver.close()))
	} finally {
		scratch.destroy()
	}
}, 600_000)
