import type { Order } from '@src/core'
import { OrderedPage, sortRows } from '@src/core'
import { captureError } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { buildSeededPage } from '../../setup.js'

// `OrderedPage` against `sortRows`, the core's whole-list order: the same page over seeded rows,
// and at most `offset + limit` rows held after each row the page is offered.

describe('OrderedPage', () => {
	const seeds = Array.from({ length: 500 }, (_, index) => index + 1)
	const byRank: readonly Order[] = [{ column: 'rank', direction: 'descending' }]

	it('keeps the page sortRows pages over seeded rows, ties and mixed types included', () => {
		for (const seed of seeds) {
			const { rows, order, offset, limit } = buildSeededPage(seed)
			const page = new OrderedPage(order, offset, limit)
			for (const row of rows) page.add(row)
			expect(
				page.rows.map((row) => row.id),
				`seed ${String(seed)}`,
			).toEqual(
				sortRows(rows, order)
					.slice(offset, offset + limit)
					.map((row) => row.id),
			)
		}
	})

	it('holds at most offset + limit rows after each row it is offered', () => {
		for (const seed of seeds) {
			const { rows, order, offset, limit } = buildSeededPage(seed)
			const page = new OrderedPage(order, offset, limit)
			const bound = limit === 0 ? 0 : offset + limit
			expect(
				rows.map((row) => {
					page.add(row)
					return page.count
				}),
				`seed ${String(seed)}`,
			).toEqual(rows.map((_, index) => Math.min(index + 1, bound)))
		}
	})

	it('keeps the page over rising, falling, and alternating ranks at a deep heap', () => {
		const shapes = [
			Array.from({ length: 300 }, (_, index) => ({ id: index, rank: index })),
			Array.from({ length: 300 }, (_, index) => ({ id: index, rank: -index })),
			Array.from({ length: 300 }, (_, index) => ({ id: index, rank: (index % 2) * index })),
			Array.from({ length: 300 }, (_, index) => ({ id: index, rank: Math.floor(index / 7) })),
		]
		for (const [shape, rows] of shapes.entries()) {
			for (const direction of ['ascending', 'descending'] as const) {
				const order: readonly Order[] = [{ column: 'rank', direction }]
				const page = new OrderedPage(order, 40, 23)
				for (const row of rows) page.add(row)
				expect(
					page.rows.map((row) => row.id),
					`shape ${String(shape)} ${direction}`,
				).toEqual(
					sortRows(rows, order)
						.slice(40, 63)
						.map((row) => row.id),
				)
			}
		}
	})

	it('breaks a tie by arrival, reversed when the final term descends', () => {
		const rows = [
			{ id: 'a', rank: 1 },
			{ id: 'b', rank: 1 },
			{ id: 'c', rank: 0 },
		]
		const descending = new OrderedPage(byRank, 0, 2)
		const ascending = new OrderedPage([{ column: 'rank', direction: 'ascending' }], 0, 2)
		for (const row of rows) {
			descending.add(row)
			ascending.add(row)
		}
		expect(descending.rows.map((row) => row.id)).toEqual(['b', 'a'])
		expect(ascending.rows.map((row) => row.id)).toEqual(['c', 'a'])
	})

	it('holds no row for a zero limit and returns none past the held rows', () => {
		const empty = new OrderedPage(byRank, 3, 0)
		const short = new OrderedPage(byRank, 3, 2)
		for (const rank of [5, 4, 3]) {
			empty.add({ id: String(rank), rank })
			short.add({ id: String(rank), rank })
		}
		expect(empty.count).toBe(0)
		expect(empty.rows).toEqual([])
		expect(short.count).toBe(3)
		expect(short.rows).toEqual([])
	})

	it('refuses a page that is not a finite nonnegative integer', () => {
		expect(captureError(() => new OrderedPage(byRank, -1, 1))).toMatchObject({
			code: 'VALIDATION',
		})
		expect(captureError(() => new OrderedPage(byRank, 0, 1.5))).toMatchObject({
			code: 'VALIDATION',
		})
	})
})
