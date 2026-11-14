import { decodeValue } from '@src/server'
import { CLONE_NODE_LIMIT, cloneJSONValue, matchesJSONValue } from '@orkestrel/contract'
import { expect, it } from 'vitest'
import { JSON_COLUMN } from '../../setupServer.js'

// The copies a `json` cell pays on read: `decodeValue` beside its floor, `JSON.parse` and the
// bounded JSON walk that refuses a non-finite number or a tree past the clone node limit, and
// beside the parse with the two further copies the decode once paid. The parse is the cell's one
// copy, so the decode stays at its floor and below the copying path. Run it with
// `npm run test:bench`.

it('decodes a json cell at the cost of its parse and its walk', async ({ bench }) => {
	const cell = JSON.stringify({
		tags: Array.from({ length: 16 }, (_, index) => `tag-${index}`),
		profile: { name: 'Ada Lovelace', age: 36, active: true, score: 9.5 },
		history: Array.from({ length: 12 }, (_, index) => ({ at: index, note: 'x'.repeat(40) })),
	})
	const result = await bench.compare(
		bench('decode', () => {
			decodeValue(cell, JSON_COLUMN)
		}),
		bench('parse and walk', () => {
			matchesJSONValue(JSON.parse(cell), new WeakSet(), { left: CLONE_NODE_LIMIT })
		}),
		bench('parse and two copies', () => {
			structuredClone(cloneJSONValue(JSON.parse(cell)))
		}),
		{ time: 1000, warmupTime: 200 },
	)
	expect(result.get('decode')).not.toBeSlowerThan(result.get('parse and walk'), { delta: 0.5 })
	expect(result.get('decode')).toBeFasterThan(result.get('parse and two copies'))
}, 600_000)
