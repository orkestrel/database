import type { DatabaseModule } from '../../setup.js'
import { createDatabase, createMemoryDriver } from '@src/core'
import { expect, it } from 'vitest'
import { BENCH_COLUMNS, buildBenchRows, isDatabaseModule, TEN_CONDITIONS } from '../../setup.js'

// The table's read cells on a suite-sized Memory table: a point read on a held table, a point
// read through `database.table(name)`, a scope with one read, and the query door's cost on a
// ten-condition count. Set `DATABASE_BASELINE` to the core entry of a published build, such as the
// 0.0.24 tarball's `dist/src/core/index.js`, to run each cell on that build beside the candidate.

it('reads the point, scope, and door cells of a table', async ({ bench }) => {
	const path = process.env.DATABASE_BASELINE
	const loaded: unknown = path === undefined ? undefined : await import(path)
	const arms: ReadonlyArray<readonly [string, DatabaseModule]> = [
		['candidate', { createDatabase, createMemoryDriver }],
		...(isDatabaseModule(loaded) ? [['0.0.24', loaded] as const] : []),
	]
	const registrations = await Promise.all(
		arms.map(async ([arm, module]) => {
			const database = module.createDatabase({
				driver: module.createMemoryDriver(),
				tables: { items: BENCH_COLUMNS },
			})
			const held = database.table('items')
			await held.set(buildBenchRows(1000))
			return [
				bench(`${arm} point held`, async () => {
					await held.get('k500')
				}),
				bench(`${arm} point resolved`, async () => {
					await database.table('items').get('k500')
				}),
				bench(`${arm} scope one read`, async () => {
					await database.transaction((scope) => scope.table('items').get('k500'))
				}),
				bench(`${arm} door ten conditions`, async () => {
					await held.count(TEN_CONDITIONS)
				}),
			]
		}),
	)
	const result = await bench.compare(...registrations.flat())
	expect(result.get('candidate point held')).toBeFasterThan(result.get('candidate scope one read'))
}, 600_000)
