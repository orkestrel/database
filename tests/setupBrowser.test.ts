import { describe, expect, it } from 'vitest'
import { createIntegrationDatabase, uniqueName } from './setupBrowser.js'

// The browser test setup module's proof (`tests/setupBrowser.ts`). Its subject is the exported
// test infrastructure the `src:browser` suites are driven over.
//
// The `setup` project runs in Node with the browser disabled, and this module divides cleanly
// along that line. Proven here is its host-independent half: `uniqueName`, which is arithmetic
// over a module counter, and the wiring `createIntegrationDatabase` performs before any
// connection exists — the name it mints and the tables it declares. The DOM-driving half is
// `deleteDatabase` and `putIndexedDBValue`, which read `globalThis.indexedDB` and a live
// `IDBDatabase` that no Node project has; both are proven by the consuming browser suites,
// `tests/src/browser/drivers/IndexedDBDriver.test.ts`, `tests/src/browser/factories.test.ts`,
// and `tests/src/browser/integration.test.ts`, which drive them against real Chromium storage
// on every case they set up and tear down.
//
// `createIntegrationDatabase` is imported by no suite, so its opened half — the connection its
// `cleanup` closes and deletes — is proven nowhere. What is asserted here is everything it
// decides before a driver connects.
//
// Each expectation arrives by a route `tests/setupBrowser.ts` does not share. Uniqueness is read
// as set membership across a batch rather than as a counter value, and the declared tables are
// read back through the database's own exported definitions and its compiled row contract rather
// than through the fixture map the module handed it.

/** Read the trailing counter segment a `uniqueName` result carries. */
function readCounter(name: string): number {
	return Number(name.slice(name.lastIndexOf('-') + 1))
}

describe('uniqueName', () => {
	it('returns a name no earlier call returned', () => {
		const names = [uniqueName(), uniqueName(), uniqueName()]
		expect(new Set(names).size).toBe(names.length)
	})

	it('numbers every name from one shared counter, whatever the prefix', () => {
		const first = readCounter(uniqueName())
		const prefixed = readCounter(uniqueName('taverna-idb-int'))
		const last = readCounter(uniqueName())
		expect(prefixed).toBeGreaterThan(first)
		expect(last).toBeGreaterThan(prefixed)
	})

	it('defaults its prefix to taverna-idb and honours a supplied one', () => {
		expect(uniqueName()).toMatch(/^taverna-idb-\d+$/)
		expect(uniqueName('corruption')).toMatch(/^corruption-\d+$/)
	})
})

describe('createIntegrationDatabase', () => {
	it('mints a fresh name per fixture under the integration prefix', () => {
		const first = createIntegrationDatabase()
		const second = createIntegrationDatabase()
		expect(first.name).toMatch(/^taverna-idb-int-\d+$/)
		expect(readCounter(second.name)).toBeGreaterThan(readCounter(first.name))
	})

	it('declares the shared users and posts tables on the database it returns', () => {
		const { db } = createIntegrationDatabase()
		const definitions = db.export()
		expect(Object.keys(definitions).sort()).toEqual(['posts', 'users'])
		expect(db.table('users').primary).toBe('id')
		expect(db.table('posts').name).toBe('posts')
	})

	it('compiles a users contract admitting the canonical fixture row and nothing else', () => {
		const { db } = createIntegrationDatabase()
		const { contract } = db.table('users')
		expect(contract.is({ id: 'u1', name: 'Ada', age: 36 })).toBe(true)
		expect(contract.is({ id: 'u1', name: 'Ada' })).toBe(false)
		expect(contract.is({ id: 'u1', name: 'Ada', age: '36' })).toBe(false)
		expect(contract.is({ id: 'u1', name: 'Ada', age: 36, role: 'admin' })).toBe(false)
	})

	it('leaves the database unopened, so no connection exists before a suite drives it', () => {
		const { db } = createIntegrationDatabase()
		expect(db.status).toBe('idle')
	})
})
