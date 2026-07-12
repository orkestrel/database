import type { Criteria, DriverInterface, Key, Row } from '@src/core'
import { createDatabase, createMemoryDriver, isDatabaseError } from '@src/core'
import { integerShape, literalShape, optionalShape, stringShape } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import {
	collectRows,
	createConstrainedUsersDatabase,
	createRecorder,
	createRecordingDriver,
	createUserRow,
	INTEGRATION_TABLES,
	recordEmitterEvents,
	RECORDING_AGGREGATE,
	RECORDING_COUNT,
	RECORDING_ROW,
} from '../../setup.js'

// The authoritative behavior tests for `Table` — keyed CRUD and its batch
// overloads, contract coercion + the VALIDATION / CONFLICT / NOT_FOUND error
// paths, the records / count / aggregate engine path, the query / cursor
// accessors, and name / primary / contract. The table is always reached through
// `createDatabase({ driver, tables })` (the only way one is built). The native ↔
// engine dispatch (folded in from the former nativeHooks.test.ts) uses the shared
// `createRecordingDriver` (tests/setup.ts) — a real Map-backed driver, not a mock.

// A small typed table whose columns carry guard constraints (`min`), so coercion
// and the post-parse VALIDATION path are both exercised.
function userTable() {
	return createConstrainedUsersDatabase().users
}

describe('Table — identity', () => {
	it('exposes name, primary, and the compiled contract', () => {
		const users = userTable()
		expect(users.name).toBe('users')
		expect(users.primary).toBe('id') // the default key column
		expect(users.contract.schema.type).toBe('object')
		const seed = users.contract.generate()
		expect(users.contract.is(seed)).toBe(true)
		// The contract is the same coercion `set` applies — a numeric string → number.
		expect(users.contract.parse({ id: 'u', name: 'A', age: '36' })).toEqual({
			id: 'u',
			name: 'A',
			age: 36,
		})
	})

	it('reports a custom primary-key column from the keys option', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { posts: { slug: stringShape(), title: stringShape() } },
			keys: { posts: 'slug' },
		})
		const posts = db.table('posts')
		expect(posts.primary).toBe('slug')
		expect(await posts.set({ slug: 'hello', title: 'Hello' })).toBe('hello')
		expect((await posts.get('hello'))?.title).toBe('Hello')
	})
})

describe('Table — keyed CRUD (single)', () => {
	it('round-trips a typed row through set / get / has / keys / remove', async () => {
		const users = userTable()
		const key = await users.set(createUserRow())
		expect(key).toBe('u1')
		expect(await users.get('u1')).toEqual(createUserRow())
		expect(await users.has('u1')).toBe(true)
		expect(await users.has('missing')).toBe(false)
		expect(await users.keys()).toEqual(['u1'])
		expect(await users.remove('u1')).toBe(true)
		expect(await users.remove('u1')).toBe(false) // already gone
		expect(await users.get('u1')).toBeUndefined()
	})

	it('resolve returns the row or throws NOT_FOUND', async () => {
		const users = userTable()
		await users.set(createUserRow())
		expect(await users.resolve('u1')).toEqual(createUserRow())
		await expect(users.resolve('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	it('add inserts and throws CONFLICT on a duplicate key', async () => {
		const users = userTable()
		expect(await users.add(createUserRow())).toBe('u1')
		await expect(users.add(createUserRow())).rejects.toMatchObject({
			code: 'CONFLICT',
		})
	})

	it('set upserts (overwrites an existing key without conflict)', async () => {
		const users = userTable()
		await users.set(createUserRow())
		await users.set({ id: 'u1', name: 'Ada Lovelace', age: 37 })
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada Lovelace', age: 37 })
	})

	it('merges and re-validates on update; false when the key is absent', async () => {
		const users = userTable()
		await users.set(createUserRow())
		expect(await users.update('u1', { age: 37 })).toBe(true)
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada', age: 37 })
		expect(await users.update('missing', { age: 1 })).toBe(false)
	})

	it('clears every row', async () => {
		const users = userTable()
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		expect(await users.count()).toBe(2)
		await users.clear()
		expect(await users.count()).toBe(0)
		expect(await users.keys()).toEqual([])
	})

	it('uses the injected key factory when the key column is absent', async () => {
		let n = 0
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(stringShape()), kind: stringShape() } },
			key: () => `k${++n}`,
		})
		const events = db.table('events')
		const key = await events.set({ kind: 'click' })
		expect(key).toBe('k1')
		expect((await events.get(key))?.kind).toBe('click')
	})

	it('throws VALIDATION when the key column is absent and no key factory was provided', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(stringShape()), kind: stringShape() } },
		})
		const events = db.table('events')
		await expect(events.set({ kind: 'click' })).rejects.toMatchObject({ code: 'VALIDATION' })
	})
})

describe('Table — batch overloads (array in → array out, same order)', () => {
	it('set / get / has / update / remove accept one or many', async () => {
		const users = userTable()
		// set(rows[]) → keys[] in input order
		const keys = await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		expect(keys).toEqual(['u1', 'u2'])
		// get(keys[]) → parallel array, undefined for misses, original order preserved
		expect((await users.get(['u1', 'missing', 'u2'])).map((row) => row?.name)).toEqual([
			'Ada',
			undefined,
			'Bo',
		])
		// the single overload still resolves to a scalar
		expect((await users.get('u1'))?.name).toBe('Ada')
		// has(keys[]) → booleans
		expect(await users.has(['u1', 'missing'])).toEqual([true, false])
		// update(keys[], changes) → booleans (same changes applied to each)
		expect(await users.update(['u1', 'u2'], { age: 50 })).toEqual([true, true])
		expect((await users.get('u2'))?.age).toBe(50)
		// remove(keys[]) → booleans
		expect(await users.remove(['u1', 'missing'])).toEqual([true, false])
		expect(await users.count()).toBe(1)
	})

	it('resolve(keys[]) returns rows in order or throws on any miss', async () => {
		const users = userTable()
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		expect((await users.resolve(['u2', 'u1'])).map((row) => row.name)).toEqual(['Bo', 'Ada'])
		await expect(users.resolve(['u1', 'missing'])).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	it('add(rows[]) inserts each or throws CONFLICT on a duplicate', async () => {
		const users = userTable()
		await users.add(createUserRow())
		await expect(
			users.add([
				{ id: 'u2', name: 'Bo', age: 41 },
				{ id: 'u1', name: 'Dup', age: 1 },
			]),
		).rejects.toMatchObject({ code: 'CONFLICT' })
	})
})

describe('Table — batch write abort signal (AGENTS §9.2)', () => {
	it('throws ABORTED and applies nothing when the signal is already fired before a batch set', async () => {
		const users = userTable()
		const controller = new AbortController()
		controller.abort('too slow')
		await expect(
			users.set(
				[
					{ id: 'u1', name: 'Ada', age: 36 },
					{ id: 'u2', name: 'Bo', age: 41 },
				],
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await users.keys()).toEqual([])
	})

	it('throws ABORTED on a single-row write with an already-fired signal', async () => {
		const users = userTable()
		const controller = new AbortController()
		controller.abort('too slow')
		await expect(users.set(createUserRow(), { signal: controller.signal })).rejects.toMatchObject({
			code: 'ABORTED',
		})
		expect(await users.keys()).toEqual([])
	})

	it('aborting between items after the first write leaves the first item applied (no rollback)', async () => {
		const users = userTable()
		const controller = new AbortController()
		// The table emitter fires `write` AFTER the driver write completes but BEFORE
		// `#each` proceeds to the next item — abort from inside the listener to land
		// squarely in the between-items gate without any mocks.
		users.emitter.on('write', () => controller.abort('stop after first'))
		let error: unknown
		try {
			await users.set(
				[
					{ id: 'u1', name: 'Ada', age: 36 },
					{ id: 'u2', name: 'Bo', age: 41 },
				],
				{ signal: controller.signal },
			)
		} catch (caught) {
			error = caught
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('ABORTED')
		// The first item is already applied — no rollback (AGENTS §9.2 remarks).
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(await users.get('u2')).toBeUndefined()
	})
})

describe('Table — coercion and validation', () => {
	it('coerces a coercible row through the contract on write', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const users = db.table('users')
		// `set` coerces through `contract.parse` before storage — the same coercion the
		// contract applies to an untyped row (a numeric string `'36'` becomes `36`).
		expect(users.contract.parse({ id: 'u1', name: 'Ada', age: '36' })).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
		})
		// A type-valid write then round-trips as the stored number.
		await users.set(createUserRow())
		expect(await users.get('u1')).toEqual(createUserRow())
	})

	it('throws VALIDATION on a row the contract parser rejects', async () => {
		const users = userTable()
		// NaN is a `number` to the type system but the integer contract rejects it.
		await expect(users.set({ id: 'u1', name: 'Ada', age: Number.NaN })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
	})

	it('throws VALIDATION when a leaf refinement (string min) fails', async () => {
		const users = userTable()
		// '' is a string by type but violates the name `min: 1` refinement; the
		// contract parser now enforces refinements, so `parse` alone returns
		// `undefined` here (no separate guard re-check) → VALIDATION.
		await expect(users.set({ id: 'u1', name: '', age: 36 })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
	})
})

describe('Table — records / count / aggregate (engine path)', () => {
	// A plain MemoryDriver has no native hooks, so these all exercise the core
	// engine running over `scan` (applyCriteria / matchesCriteria / computeAggregate).
	async function seeded() {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const users = db.table('users')
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
			{ id: 'u3', name: 'Cy', age: 22 },
		])
		return users
	}

	it('records honors conditions, order, and paging via the engine', async () => {
		const users = await seeded()
		const all = await users.records()
		expect(all).toHaveLength(3)
		const filtered = await users.records({
			conditions: [{ column: 'age', operator: 'above', values: [25], connector: 'and' }],
			order: [{ column: 'age', direction: 'descending' }],
		})
		expect(filtered.map((row) => row.id)).toEqual(['u2', 'u1'])
		const paged = await users.records({
			order: [{ column: 'age', direction: 'ascending' }],
			offset: 1,
			limit: 1,
		})
		expect(paged.map((row) => row.id)).toEqual(['u1']) // ages 22,36,41 → offset 1 → 36
	})

	it('count returns the matching total over the engine', async () => {
		const users = await seeded()
		expect(await users.count()).toBe(3)
		expect(
			await users.count({
				conditions: [{ column: 'age', operator: 'above', values: [30], connector: 'and' }],
			}),
		).toBe(2)
	})

	it('aggregate computes over the matched (not paged) rows', async () => {
		const users = await seeded()
		expect(await users.aggregate('sum', 'age')).toBe(99)
		expect(await users.aggregate('maximum', 'age')).toBe(41)
		expect(await users.aggregate('minimum', 'age')).toBe(22)
		expect(
			await users.aggregate('average', 'age', {
				conditions: [{ column: 'age', operator: 'above', values: [30], connector: 'and' }],
			}),
		).toBe(38.5) // (36 + 41) / 2
	})

	it('aggregate returns undefined over an empty set', async () => {
		const users = await seeded()
		expect(
			await users.aggregate('sum', 'age', {
				conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
			}),
		).toBeUndefined()
	})
})

describe('Table — scan (lazy streaming)', () => {
	async function seeded() {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const users = db.table('users')
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
			{ id: 'u3', name: 'Cy', age: 22 },
		])
		return users
	}

	it('yields all rows in driver key-order (order is ignored)', async () => {
		const users = await seeded()
		const rows = await collectRows(users.scan())
		expect(rows.map((row) => row.id)).toEqual(['u1', 'u2', 'u3'])
	})

	it('applies criteria conditions lazily', async () => {
		const users = await seeded()
		const rows = await collectRows(
			users.scan({
				conditions: [{ column: 'age', operator: 'above', values: [30], connector: 'and' }],
			}),
		)
		expect(rows.map((row) => row.id).sort()).toEqual(['u1', 'u2'])
	})

	it('applies offset and limit via lazy counting', async () => {
		const users = await seeded()
		const rows = await collectRows(users.scan({ offset: 1, limit: 1 }))
		expect(rows.map((row) => row.id)).toEqual(['u2'])
	})

	it('a fresh call yields from the start even after an earlier consumer broke early', async () => {
		const users = await seeded()
		const first: string[] = []
		for await (const row of users.scan()) {
			first.push(row.id)
			break
		}
		expect(first).toEqual(['u1'])
		const second: string[] = []
		for await (const row of users.scan()) second.push(row.id)
		expect(second).toEqual(['u1', 'u2', 'u3'])
	})

	it('aborts mid-iteration once the signal fires', async () => {
		const users = await seeded()
		const controller = new AbortController()
		const seen: string[] = []
		let error: unknown
		try {
			for await (const row of users.scan(undefined, { signal: controller.signal })) {
				seen.push(row.id)
				controller.abort('cancelled')
			}
		} catch (caught) {
			error = caught
		}
		expect(seen).toEqual(['u1'])
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('ABORTED')
	})

	it('records / count / aggregate throw ABORTED when the signal is already fired', async () => {
		const users = await seeded()
		const controller = new AbortController()
		controller.abort('too slow')
		await expect(users.records(undefined, { signal: controller.signal })).rejects.toMatchObject({
			code: 'ABORTED',
		})
		await expect(users.count(undefined, { signal: controller.signal })).rejects.toMatchObject({
			code: 'ABORTED',
		})
		await expect(
			users.aggregate('sum', 'age', undefined, { signal: controller.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
	})

	it('delegates to the driver stream hook without re-filtering (native dispatch)', async () => {
		const streamCalls: Criteria[] = []
		const store = new Map<string, Row>([['stored', { id: 'stored', name: 'Stored', age: 30 }]])
		const driver: DriverInterface = {
			async open() {},
			async close() {},
			async read(_table, key) {
				return store.get(String(key))
			},
			async write(_table, key, row) {
				store.set(String(key), row)
			},
			async delete(_table, key) {
				return store.delete(String(key))
			},
			async keys() {
				return [...store.keys()]
			},
			async *scan() {
				for (const row of store.values()) yield row
			},
			async clear() {
				store.clear()
			},
			async snapshot() {
				return async () => {}
			},
			async *stream(_table, criteria) {
				streamCalls.push(criteria)
				// A driver stream is trusted to have already applied the criteria natively —
				// yield a sentinel row unrelated to the store to prove Table does not re-filter.
				yield { id: 'native', name: 'Native', age: 7 }
			},
		}
		const users = createDatabase({ driver, tables: HOOK_TABLES }).table('users')
		const criteria: Criteria = {
			conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
		}
		const rows = await collectRows(users.scan(criteria))
		expect(rows).toEqual([{ id: 'native', name: 'Native', age: 7 }])
		expect(streamCalls).toEqual([criteria])
	})
})

describe('Table — query / cursor accessors', () => {
	it('query() returns a fluent QueryInterface bound to the table', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: {
				users: { id: stringShape(), name: stringShape(), role: literalShape(['admin', 'member']) },
			},
		})
		const users = db.table('users')
		await users.set([
			{ id: 'u1', name: 'Ada', role: 'admin' },
			{ id: 'u2', name: 'Bo', role: 'member' },
		])
		const query = users.query()
		expect(typeof query.where).toBe('function')
		expect((await query.where('role').equals('member').all()).map((row) => row.id)).toEqual(['u2'])
	})

	it('cursor() returns a CursorInterface positioned at the first row', async () => {
		const users = userTable()
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		const cursor = await users.cursor()
		expect(cursor.index).toBe(0)
		expect(cursor.done).toBe(false)
		expect(cursor.value?.id).toBe('u1')
		cursor.close()
	})
})

// ── Native ↔ engine dispatch (folded in from the former nativeHooks.test.ts) ──
//
// When a driver implements the optional `records` / `count` / `aggregate` hooks,
// `Table` PREFERS them over the scan engine; with a plain `createMemoryDriver` it
// FALLS BACK to the engine. `createRecordingDriver` (tests/setup.ts) is a real
// Map-backed driver (not a mock) that stores rows yet short-circuits the three
// hooks to recognizable sentinels and records what it was handed.
const HOOK_TABLES = { users: INTEGRATION_TABLES.users }

describe('Table — native hook dispatch', () => {
	it('records prefers the driver hook over the scan engine', async () => {
		const { driver, recordsCalls } = createRecordingDriver()
		const users = createDatabase({ driver, tables: HOOK_TABLES }).table('users')
		// A real stored row that differs from the sentinel — a scan WOULD surface it.
		await users.set({ id: 'stored', name: 'Stored', age: 30 })

		const result = await users.records({
			conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
		})

		// The native sentinel came back, not the stored row → the hook was preferred.
		expect(result).toEqual([RECORDING_ROW])
		// And it received the FULL criteria (records must honor filter + order + page).
		expect(recordsCalls).toHaveLength(1)
		expect(recordsCalls[0].conditions).toHaveLength(1)
	})

	it('count prefers the driver hook and is handed conditions only (no paging)', async () => {
		const { driver, countCalls } = createRecordingDriver()
		const users = createDatabase({ driver, tables: HOOK_TABLES }).table('users')
		await users.set({ id: 'stored', name: 'Stored', age: 30 })

		const total = await users.count({
			conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
			limit: 1,
			offset: 5,
		})

		expect(total).toBe(RECORDING_COUNT)
		// Paging is irrelevant to a count — the hook sees conditions only.
		expect(countCalls).toHaveLength(1)
		expect(countCalls[0]).toEqual({
			conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
		})
	})

	it('aggregate prefers the native aggregate hook (conditions only) over records and the scan', async () => {
		const { driver, aggregateCalls, recordsCalls } = createRecordingDriver()
		const users = createDatabase({ driver, tables: HOOK_TABLES }).table('users')
		await users.set({ id: 'stored', name: 'Stored', age: 30 })
		// The native aggregate sentinel comes back, not a sum over the stored row (30)
		// nor over the records sentinel (7) → the aggregate hook was preferred.
		expect(
			await users.aggregate('sum', 'age', {
				conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
				limit: 1,
				offset: 5,
			}),
		).toBe(RECORDING_AGGREGATE)
		// It received the operation, column, and conditions only — paging is irrelevant.
		expect(aggregateCalls).toHaveLength(1)
		expect(aggregateCalls[0]).toEqual({
			operation: 'sum',
			column: 'age',
			criteria: {
				conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
			},
		})
		// The records hook was NOT consulted — the aggregate hook short-circuited first.
		expect(recordsCalls).toHaveLength(0)
	})

	it('treats a present aggregate hook resolving to undefined as handled (no fallback)', async () => {
		// `aggregate` legitimately returns undefined (a sum over zero rows), so Table
		// must decide the hook ran by its PRESENCE, not by the resolved value — else a
		// real undefined would wrongly trigger the records/scan fallback.
		const { driver, aggregateCalls, recordsCalls } = createRecordingDriver(true)
		const users = createDatabase({ driver, tables: HOOK_TABLES }).table('users')
		await users.set({ id: 'stored', name: 'Stored', age: 30 })
		expect(await users.aggregate('sum', 'age')).toBeUndefined()
		// The hook ran (recorded once) and the records fallback did NOT.
		expect(aggregateCalls).toHaveLength(1)
		expect(recordsCalls).toHaveLength(0)
	})

	it('falls back to the engine when the driver has no hooks', async () => {
		const users = createDatabase({ driver: createMemoryDriver(), tables: HOOK_TABLES }).table(
			'users',
		)
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		// Engine-computed over the real scan — not any sentinel.
		expect(
			(await users.records({ order: [{ column: 'age', direction: 'descending' }] })).map(
				(row) => row.id,
			),
		).toEqual(['u2', 'u1'])
		expect(
			await users.count({
				conditions: [{ column: 'age', operator: 'above', values: [40], connector: 'and' }],
			}),
		).toBe(1)
		expect(await users.aggregate('sum', 'age')).toBe(77)
	})
})

// ── Emitter — the PUSH observation surface (AGENTS §13) ──────────────────────
//
// Alongside the database-level lifecycle, each Table exposes a typed `emitter`
// (`TableEventMap`) carrying its per-row mutation moments — `write` (set / add / update),
// `remove`, `clear` — for fire-and-forget observers (cache invalidation, sync). Events
// carry the affected KEY only (no value payload). Every event is emitted directly; the
// emitter isolates a listener throw (it can never escape into a write or its transaction,
// AGENTS §13), and every emit sits AFTER the driver write / delete / clear completes. A Table
// is reached through the Database, which does not thread an `error` handler to it, so a
// listener throw is swallowed silently. These pin: each event fires with the right key;
// `set` / `add` / `update` all emit one `write`; a no-op delete / update emits nothing; and
// the emit-safety guarantee — a throwing observer cannot corrupt the written state.

// The TableEventMap event names recorded across the emitter tests — fed to the shared
// `recordEmitterEvents` (AGENTS §16.1: the per-event wiring is centralized; this file
// keeps only the names its scenarios observe).
const TABLE_EVENTS = ['write', 'remove', 'clear'] as const

describe('Table — emitter (push observation surface)', () => {
	it('set / add / update each fire one write carrying the key', async () => {
		const users = userTable()
		const events = recordEmitterEvents(users.emitter, TABLE_EVENTS)
		await users.set(createUserRow()) // set → write
		await users.add({ id: 'u2', name: 'Bo', age: 41 }) // add → write
		await users.update('u1', { age: 37 }) // update → write
		expect(events.write.calls).toEqual([['u1'], ['u2'], ['u1']])
		expect(events.remove.count).toBe(0)
	})

	it('fires remove on a real delete; a delete of an absent key emits nothing', async () => {
		const users = userTable()
		await users.set(createUserRow())
		const events = recordEmitterEvents(users.emitter, TABLE_EVENTS)
		expect(await users.remove('u1')).toBe(true)
		expect(await users.remove('missing')).toBe(false) // no row → no event
		expect(events.remove.calls).toEqual([['u1']])
	})

	it('a no-op update (absent key) emits no write', async () => {
		const users = userTable()
		const events = recordEmitterEvents(users.emitter, TABLE_EVENTS)
		expect(await users.update('missing', { age: 1 })).toBe(false)
		expect(events.write.count).toBe(0)
	})

	it('fires clear when the table is emptied', async () => {
		const users = userTable()
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		const events = recordEmitterEvents(users.emitter, TABLE_EVENTS)
		await users.clear()
		expect(events.clear.calls).toEqual([[]])
	})

	it('a batch write fires one write per row, in order', async () => {
		const users = userTable()
		const events = recordEmitterEvents(users.emitter, TABLE_EVENTS)
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		expect(events.write.calls).toEqual([['u1'], ['u2']])
		// A batch remove fires one remove per actually-removed key (a miss emits nothing).
		await users.remove(['u1', 'missing', 'u2'])
		expect(events.remove.calls).toEqual([['u1'], ['u2']])
	})

	it('a VALIDATION failure (the row never reaches the driver) emits no write', async () => {
		const users = userTable()
		const events = recordEmitterEvents(users.emitter, TABLE_EVENTS)
		await expect(users.set({ id: 'u1', name: '', age: 36 })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(events.write.count).toBe(0)
	})

	it('EMIT SAFETY: a throwing write listener cannot corrupt the written row (the emitter isolates it)', async () => {
		const users = userTable()
		users.emitter.on('write', () => {
			throw new Error('write observer blew up')
		})
		// The write still lands despite the throwing observer — the emitter isolated the throw (a
		// Table reached via the Database has no `error` handler, so it is swallowed silently) and
		// it never escaped.
		const key = await users.set(createUserRow())
		expect(key).toBe('u1')
		// THE LOAD-BEARING ASSERTION: the row is intact.
		expect(await users.get('u1')).toEqual(createUserRow())
		// A subsequent write still works after the throw.
		await users.set({ id: 'u2', name: 'Bo', age: 41 })
		expect(await users.count()).toBe(2)
	})

	it('EMIT SAFETY: a second throwing listener still lands the write (sibling isolation)', async () => {
		const users = userTable()
		users.emitter.on('write', () => {
			throw new Error('write listener blew up')
		})
		// The write STILL lands — the throw never escaped.
		await users.set(createUserRow())
		expect((await users.get('u1'))?.name).toBe('Ada')
	})

	it('wires initial write listeners through the table handle from createDatabase', async () => {
		// `db.table(name)` returns a fresh handle each call; subscribe on the held handle (the
		// documented practice) and operate on that same handle — observation is per-handle.
		const users = userTable()
		const write = createRecorder<[key: Key]>()
		users.emitter.on('write', write.handler)
		await users.set(createUserRow())
		expect(write.calls).toEqual([['u1']])
	})
})
