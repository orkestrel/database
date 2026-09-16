import { describe, expect, it } from 'vitest'
import { mintDatabase } from './setupBrowser.js'

// The browser test setup module's proof (`tests/setupBrowser.ts`). Its subject is the exported
// test infrastructure the `src:browser` suites are driven over.
//
// The `setup` project runs in Node with the browser disabled, and this module divides cleanly
// along that line. Proven here is its host-independent half: `mintDatabase`, which is arithmetic
// over a module counter. The DOM-driving half is `deleteDatabase` and `putIndexedDBValue`, which
// read `globalThis.indexedDB` and a live `IDBDatabase` that no Node project has; both are proven
// by the consuming browser suites, `tests/src/browser/drivers/IndexedDBDriver.test.ts`,
// `tests/src/browser/factories.test.ts`, and `tests/src/browser/integration.test.ts`, which drive
// them against real Chromium storage on every case they set up and tear down.
//
// Each expectation arrives by a route `tests/setupBrowser.ts` does not share. Uniqueness is read
// as set membership across a batch rather than as a counter value.

/** Read the trailing counter segment a `mintDatabase` result carries. */
function readCounter(name: string): number {
	return Number(name.slice(name.lastIndexOf('-') + 1))
}

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
