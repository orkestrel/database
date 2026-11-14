import { decodeValue } from '@src/server'
import { expect, it } from 'vitest'
import { JSON_COLUMN } from '../../setupServer.js'

// The copies a `json` cell pays on read: `decodeValue` beside `JSON.parse` of the same text. The
// parse is the cell's one copy, so the decode stays within the parse's cost; a second copy of the
// parsed value doubles it at the least. Run it with `npm run test:bench`.

it('decodes a json cell at the cost of its parse', async ({ bench }) => {
	const cell = JSON.stringify({
		tags: Array.from({ length: 16 }, (_, index) => `tag-${index}`),
		profile: { name: 'Ada Lovelace', age: 36, active: true, score: 9.5 },
		history: Array.from({ length: 12 }, (_, index) => ({ at: index, note: 'x'.repeat(40) })),
	})
	const result = await bench.compare(
		bench('decode', () => {
			decodeValue(cell, JSON_COLUMN)
		}),
		bench('parse', () => {
			JSON.parse(cell)
		}),
		{ time: 1000, warmupTime: 200 },
	)
	expect(result.get('decode')).not.toBeSlowerThan(result.get('parse'), { delta: 1 })
}, 600_000)
