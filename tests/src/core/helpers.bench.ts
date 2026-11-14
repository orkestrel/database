import { matchesLikePattern, readPlannedAggregate, readPlannedRows } from '@src/core'
import { expect, it } from 'vitest'
import {
	buildBenchRows,
	buildShuffledBenchRows,
	createListedStorage,
	sortByInsertion,
	RESIDUAL_AGGREGATE,
	RESIDUAL_BUDGET,
	RESIDUAL_CONTROL_ROWS,
	RESIDUAL_FILTER,
	RESIDUAL_GROWTH,
	RESIDUAL_PAGE,
	RESIDUAL_PATTERN,
	RESIDUAL_ROWS,
	RESIDUAL_RUN,
	RESIDUAL_SHARE,
	RESIDUAL_WIDTH,
} from '../../setup.js'

// The residual path's cost with the driver's work taken out: each read streams listed rows of the
// bench table (unique keys, a skewed rank with ties that rises with the key, text of 24 to 199
// characters) through the core's residual pass; the unordered page cell reads the same rows with
// the rank permuted against the key. A cell reads its median at `RESIDUAL_ROWS`, taverna's slice, and at
// double that size. Its bar, stated ahead of the run, is `RESIDUAL_SHARE` of the consumer's
// `RESIDUAL_BUDGET` page at the slice, and its growth to double size stays under
// `RESIDUAL_GROWTH`. The matcher cell reads one call at `MAX_PATTERN_LENGTH` against the widest
// text the consumer carries and against double that width, and bars only the growth. The
// control is an ordered page that holds every row sorted by insertion: it is quadratic, so its
// growth must exceed the bar the cells meet. No gate collects this file; run it with
// `npm run test:bench -- tests/src/core/helpers.bench.ts`.

// Each cell builds its own rows, so only its two sizes are alive while it runs.
const bar = RESIDUAL_BUDGET * RESIDUAL_SHARE

it('reads an ordered residual page within its share and grows linearly', async ({ bench }) => {
	const slice = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const doubled = createListedStorage(buildBenchRows(RESIDUAL_ROWS * 2))
	const one = await bench('page at the slice', () =>
		readPlannedRows(slice, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	const two = await bench('page at double', () =>
		readPlannedRows(doubled, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	console.log('page', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('reads an ordered residual page over unordered ranks within its share', async ({ bench }) => {
	const shuffled = createListedStorage(buildShuffledBenchRows(RESIDUAL_ROWS))
	const reshuffled = createListedStorage(buildShuffledBenchRows(RESIDUAL_ROWS * 2))
	const one = await bench('unordered page at the slice', () =>
		readPlannedRows(shuffled, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	const two = await bench('unordered page at double', () =>
		readPlannedRows(reshuffled, 'items', RESIDUAL_PAGE)).run(RESIDUAL_RUN)
	console.log('unordered', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('reads a residual aggregate within its share and grows linearly', async ({ bench }) => {
	const slice = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const doubled = createListedStorage(buildBenchRows(RESIDUAL_ROWS * 2))
	const one = await bench('aggregate at the slice', () =>
		readPlannedAggregate(slice, 'items', {}, RESIDUAL_AGGREGATE)).run(RESIDUAL_RUN)
	const two = await bench('aggregate at double', () =>
		readPlannedAggregate(doubled, 'items', {}, RESIDUAL_AGGREGATE)).run(RESIDUAL_RUN)
	console.log('aggregate', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('reads a residual like over the slice within its share and grows linearly', async ({
	bench,
}) => {
	const slice = createListedStorage(buildBenchRows(RESIDUAL_ROWS))
	const doubled = createListedStorage(buildBenchRows(RESIDUAL_ROWS * 2))
	const one = await bench('like at the slice', () =>
		readPlannedRows(slice, 'items', RESIDUAL_FILTER)).run(RESIDUAL_RUN)
	const two = await bench('like at double', () =>
		readPlannedRows(doubled, 'items', RESIDUAL_FILTER)).run(RESIDUAL_RUN)
	console.log('like', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(one.latency.p50).toBeLessThan(bar)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('matches a pattern at MAX_PATTERN_LENGTH with growth linear in the value width', async ({
	bench,
}) => {
	const widest = 'x'.repeat(RESIDUAL_WIDTH)
	const double = 'x'.repeat(RESIDUAL_WIDTH * 2)
	const one = await bench('pattern limit at the widest text', () =>
		matchesLikePattern(widest, RESIDUAL_PATTERN)).run(RESIDUAL_RUN)
	const two = await bench('pattern limit at double width', () =>
		matchesLikePattern(double, RESIDUAL_PATTERN)).run(RESIDUAL_RUN)
	console.log('matcher', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(matchesLikePattern(widest, RESIDUAL_PATTERN)).toBe(true)
	expect(two.latency.p50 / one.latency.p50).toBeLessThan(RESIDUAL_GROWTH)
}, 600_000)

it('reads the growth of a quadratic ordered page past the bar', async ({ bench }) => {
	const small = buildBenchRows(RESIDUAL_CONTROL_ROWS)
	const large = buildBenchRows(RESIDUAL_CONTROL_ROWS * 2)
	const one = await bench('control at the base size', () => sortByInsertion(small, 'rank')).run(
		RESIDUAL_RUN,
	)
	const two = await bench('control at double', () => sortByInsertion(large, 'rank')).run(
		RESIDUAL_RUN,
	)
	console.log('control', one.latency.p50, two.latency.p50, two.latency.p50 / one.latency.p50)
	expect(two.latency.p50 / one.latency.p50).toBeGreaterThan(RESIDUAL_GROWTH)
}, 600_000)
