import type { Row } from '@src/core'
import { matchesLikePattern, readPlannedAggregate, readPlannedRows } from '@src/core'
import { expect, it } from 'vitest'
import {
	buildBenchRows,
	buildShuffledBenchRows,
	createListedStorage,
	InsertionPage,
	RESIDUAL_AGGREGATE,
	RESIDUAL_BUDGET,
	RESIDUAL_CONTROL_ROWS,
	RESIDUAL_FILTER,
	RESIDUAL_GROWTH,
	RESIDUAL_PAGE,
	RESIDUAL_PATTERN,
	RESIDUAL_ROWS,
	RESIDUAL_RUN,
	RESIDUAL_SCALE,
	RESIDUAL_SHARE,
	RESIDUAL_WIDTH,
} from '../../setup.js'

// The residual path's cost with the driver's work taken out: each read streams listed rows of the
// bench table (unique keys, a skewed rank with ties that rises with the key, text of 24 to 199
// characters) through the core's residual pass; the unordered page cells read the same rows with
// the rank permuted against the key. A share cell reads its median at `RESIDUAL_ROWS`, taverna's
// slice, against its bar, stated ahead of the run: `RESIDUAL_SHARE` of the consumer's
// `RESIDUAL_BUDGET` page. A growth cell reads its median at a `RESIDUAL_SCALE` fraction of the
// slice and at the slice, and its growth stays under `RESIDUAL_GROWTH`: linear work grows by about
// the scale and quadratic work by its square. The matcher cell reads one call at
// `MAX_PATTERN_LENGTH` against the widest text the consumer carries and a `RESIDUAL_SCALE` multiple
// of it. The control inserts every row in place into a held page: quadratic moves with no
// allocation per row, so its growth must exceed the bar the cells meet. Each cell builds its own
// rows. No gate collects this file; run it with
// `npm run test:bench -- tests/src/core/helpers.bench.ts`.

const bar = RESIDUAL_BUDGET * RESIDUAL_SHARE
const quarter = Math.floor(RESIDUAL_ROWS / RESIDUAL_SCALE)

it('reads an ordered residual page within its share at the slice', async ({ bench }) => {
	const slice = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const one = await bench('page at the slice', () =>
		readPlannedRows(slice, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	console.log('page share', one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
}, 600_000)

it('grows an ordered residual page linearly', async ({ bench }) => {
	const small = createListedStorage(buildBenchRows(quarter))
	const large = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const one = await bench('page at a quarter', () =>
		readPlannedRows(small, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	const two = await bench('page at the slice', () =>
		readPlannedRows(large, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	console.log('page growth', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('reads an ordered residual page over unordered ranks within its share at the slice', async ({
	bench,
}) => {
	const slice = createListedStorage(buildShuffledBenchRows(RESIDUAL_ROWS))
	const one = await bench('unordered page at the slice', () =>
		readPlannedRows(slice, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	console.log('unordered share', one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
}, 600_000)

it('grows an ordered residual page over unordered ranks linearly', async ({ bench }) => {
	const small = createListedStorage(buildShuffledBenchRows(quarter))
	const large = createListedStorage(buildShuffledBenchRows(RESIDUAL_ROWS))
	const one = await bench('unordered page at a quarter', () =>
		readPlannedRows(small, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	const two = await bench('unordered page at the slice', () =>
		readPlannedRows(large, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	console.log(
		'unordered growth',
		one.latency.p50,
		two.latency.p50,
		two.latency.p50 / one.latency.p50,
	)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('reads a residual aggregate within its share at the slice', async ({ bench }) => {
	const slice = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const one = await bench('aggregate at the slice', () =>
		readPlannedAggregate(slice, 'items', {}, RESIDUAL_AGGREGATE)).run(RESIDUAL_RUN)
	console.log('aggregate share', one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
}, 600_000)

it('grows a residual aggregate linearly', async ({ bench }) => {
	const small = createListedStorage(buildBenchRows(quarter))
	const large = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const one = await bench('aggregate at a quarter', () =>
		readPlannedAggregate(small, 'items', {}, RESIDUAL_AGGREGATE)).run(RESIDUAL_RUN)
	const two = await bench('aggregate at the slice', () =>
		readPlannedAggregate(large, 'items', {}, RESIDUAL_AGGREGATE)).run(RESIDUAL_RUN)
	console.log(
		'aggregate growth',
		one.latency.p50,
		two.latency.p50,
		two.latency.p50 / one.latency.p50,
	)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('reads a residual like over the slice within its share', async ({ bench }) => {
	const slice = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const one = await bench('like at the slice', () =>
		readPlannedRows(slice, 'items', RESIDUAL_FILTER)).run(RESIDUAL_RUN)
	console.log('like share', one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
}, 600_000)

it('grows a residual like linearly', async ({ bench }) => {
	const small = createListedStorage(buildBenchRows(quarter))
	const large = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const one = await bench('like at a quarter', () =>
		readPlannedRows(small, 'items', RESIDUAL_FILTER)).run(RESIDUAL_RUN)
	const two = await bench('like at the slice', () =>
		readPlannedRows(large, 'items', RESIDUAL_FILTER)).run(RESIDUAL_RUN)
	console.log('like growth', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('grows a match at MAX_PATTERN_LENGTH linearly in the value width', async ({ bench }) => {
	const widest = 'x'.repeat(RESIDUAL_WIDTH)
	const wider = 'x'.repeat(RESIDUAL_WIDTH * RESIDUAL_SCALE)
	const one = await bench('pattern limit at the widest text', () =>
		matchesLikePattern(widest, RESIDUAL_PATTERN)).run(RESIDUAL_RUN)
	const two = await bench('pattern limit at the scaled width', () =>
		matchesLikePattern(wider, RESIDUAL_PATTERN)).run(RESIDUAL_RUN)
	console.log('matcher growth', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(matchesLikePattern(widest, RESIDUAL_PATTERN)).toBe(true)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('grows a quadratic in-place insertion page past the bar', async ({ bench }) => {
	const small: readonly Row[] = buildBenchRows(RESIDUAL_CONTROL_ROWS)
	const large: readonly Row[] = buildBenchRows(RESIDUAL_CONTROL_ROWS * RESIDUAL_SCALE)
	const one = await bench('control at the base size', () => {
		const page = new InsertionPage('rank')
		for (const row of small) page.add(row)
		return page.rows
	}).run(RESIDUAL_RUN)
	const two = await bench('control at the scaled size', () => {
		const page = new InsertionPage('rank')
		for (const row of large) page.add(row)
		return page.rows
	}).run(RESIDUAL_RUN)
	console.log('control growth', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(two.latency.p50 / one.latency.p50).toBeGreaterThan(RESIDUAL_GROWTH)
}, 600_000)
