import type { QueryInput, DriverInterface, Key, TableEventMap } from '@src/core'
import { createDatabase, createMemoryDriver, isDatabaseError } from '@src/core'
import {
	integerShape,
	literalShape,
	nullableShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'
import { collect, createRecorder, createRecorders } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	createConstrainedUsersDatabase,
	createMemoryAdapter,
	createRecordingDriver,
	createUserRow,
	INTEGRATION_TABLES,
	RECORDING_AGGREGATE,
	RECORDING_ROW,
} from '../../setup.js'

// The authoritative behavior tests for `Table` — keyed CRUD and its batch
// overloads, contract coercion + the VALIDATION / CONFLICT / NOT_FOUND error
// paths, the records / count / aggregate engine path, the query / cursor
// accessors, and name / primary / contract. The table is always reached through
// `createDatabase({ driver, tables })` (the only way one is built). The native ↔
// engine dispatch (folded in from the former nativeHooks.test.ts) uses the shared
// `createRecordingDriver` (tests/setup.ts) — a real Memory-backed driver with hook seams.

// A small typed table whose columns carry guard constraints (`min`), so coercion
// and the post-parse VALIDATION path are both exercised.
function userTable() {
	return createConstrainedUsersDatabase().users
}

async function createSeededUsersTable() {
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

	it('reports a custom primary-key column from the primary option', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { posts: { slug: stringShape(), title: stringShape() } },
			primary: { posts: 'slug' },
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

	it('allows exactly one of two simultaneous same-key adds', async () => {
		const users = userTable()
		const outcomes = await Promise.allSettled([
			users.add(createUserRow()),
			users.add(createUserRow({ name: 'Grace' })),
		])
		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
		const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
		expect(rejected).toHaveLength(1)
		expect(rejected[0]?.reason).toMatchObject({ code: 'CONFLICT' })
		expect(await users.keys()).toEqual(['u1'])
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

	it('rejects a primary change while accepting the unchanged primary', async () => {
		const users = userTable()
		await users.set(createUserRow())
		await expect(users.update('u1', { id: 'u2', age: 37 })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(await users.get('u1')).toEqual(createUserRow())
		expect(await users.get('u2')).toBeUndefined()
		expect(await users.update('u1', { id: 'u1', age: 37 })).toBe(true)
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada', age: 37 })
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

	it('generates distinct global UUIDs for keyless rows and stores each primary', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(stringShape()), kind: stringShape() } },
		})
		const events = db.table('events')
		const first = await events.set({ kind: 'click' })
		const second = await events.set({ kind: 'submit' })
		const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		expect(first).toMatch(pattern)
		expect(second).toMatch(pattern)
		expect(first).not.toBe(second)
		expect(await events.get(first)).toEqual({ id: first, kind: 'click' })
		expect(await events.get(second)).toEqual({ id: second, kind: 'submit' })
	})

	it('uses the configured generator as the authoritative override', async () => {
		let n = 0
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(stringShape()), kind: stringShape() } },
			generator: () => `k${++n}`,
		})
		const events = db.table('events')
		const key = await events.set({ kind: 'click' })
		expect(key).toBe('k1')
		expect((await events.get(key))?.kind).toBe('click')
	})

	it('keeps an explicit primary without invoking the configured generator', async () => {
		let count = 0
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: {
				events: { id: optionalShape(nullableShape(stringShape())), kind: stringShape() },
			},
			generator: () => {
				count += 1
				return 'generated'
			},
		})
		const events = db.table('events')
		expect(await events.set({ id: 'explicit', kind: 'click' })).toBe('explicit')
		await expect(events.set({ id: null, kind: 'invalid' })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(count).toBe(0)
	})

	it('uses a custom generator for a numeric primary', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(integerShape()), kind: stringShape() } },
			generator: () => 42,
		})
		const events = db.table('events')
		expect(await events.set({ kind: 'click' })).toBe(42)
		expect(await events.get(42)).toEqual({ id: 42, kind: 'click' })
	})

	it('rejects an invalid custom result without writing or emitting', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(integerShape()), kind: stringShape() } },
			generator: () => Number.NaN,
		})
		const events = db.table('events')
		const observed = createRecorders<TableEventMap, 'write'>(events.emitter, ['write'])
		await expect(events.set({ kind: 'click' })).rejects.toMatchObject({ code: 'VALIDATION' })
		expect(await events.keys()).toEqual([])
		expect(observed.write.count).toBe(0)
	})

	it('wraps a thrown generator with exact primary context and no write or event', async () => {
		const cause = new Error('generator failed')
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(stringShape()), kind: stringShape() } },
			generator: () => {
				throw cause
			},
		})
		const events = db.table('events')
		const observed = createRecorders<TableEventMap, 'write'>(events.emitter, ['write'])
		const error = await events.set({ kind: 'click' }).catch((caught: unknown) => caught)
		if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
		expect(error.code).toBe('VALIDATION')
		expect(error.context).toEqual({ table: 'events', column: 'id', cause })
		expect(await events.keys()).toEqual([])
		expect(observed.write.count).toBe(0)
	})

	it('does not retry or fall back after a constant-generator add collision', async () => {
		let count = 0
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(stringShape()), kind: stringShape() } },
			generator: () => {
				count += 1
				return 'constant'
			},
		})
		const events = db.table('events')
		expect(await events.add({ kind: 'first' })).toBe('constant')
		await expect(events.add({ kind: 'second' })).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(count).toBe(2)
		expect(await events.keys()).toEqual(['constant'])
		expect(await events.get('constant')).toEqual({ id: 'constant', kind: 'first' })
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

describe('Table — batch write abort signal (`.claude/rules/patterns.md` § Batch operations)', () => {
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

	it('rejects promptly when readiness synchronously aborts before listener registration', async () => {
		const memory = createMemoryDriver()
		const controller = new AbortController()
		const release = Promise.withResolvers<void>()
		const reason = new Error('open aborted the caller')
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async open(schema) {
				controller.abort(reason)
				await release.promise
				await memory.open(schema)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const users = db.table('users')
		await expect(users.set(createUserRow(), { signal: controller.signal })).rejects.toMatchObject({
			code: 'ABORTED',
			context: { reason },
		})
		release.resolve()
		await db.open()
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
		// The first item is already applied — no rollback (`.claude/rules/patterns.md`
		// § Batch operations).
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

	it('reports only bounded contract faults and never the rejected row payload', async () => {
		const users = userTable()
		const events = createRecorders<TableEventMap, 'write'>(users.emitter, ['write'])
		const error = await users
			.set({ id: 'u1', name: 'payload-secret', age: Number.NaN })
			.catch((caught: unknown) => caught)
		if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')

		expect(error.code).toBe('VALIDATION')
		expect(error.context).toMatchObject({ table: 'users', field: ['age'] })
		expect(error.context).toHaveProperty('reason')
		expect(error.message).not.toContain('payload-secret')
		expect(JSON.stringify(error.context)).not.toContain('payload-secret')
		expect(JSON.stringify(error)).not.toContain('payload-secret')
		expect(events.write.count).toBe(0)
	})
})

describe('Table — records / count / aggregate (engine path)', () => {
	// A plain MemoryDriver has no native hooks, so these all exercise the core
	// engine running over `scan` (applyQuery / matchesQuery / computeAggregate).
	it('records honors conditions, order, and paging through the engine', async () => {
		const users = await createSeededUsersTable()
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

	it('rejects invalid paging at every table read boundary', async () => {
		const users = await createSeededUsersTable()
		const records = users.records({ limit: -1 })
		expect(records).toBeInstanceOf(Promise)
		await expect(records).rejects.toThrow('Query limit must be a nonnegative integer')
		const count = users.count({ offset: 1.5 })
		expect(count).toBeInstanceOf(Promise)
		await expect(count).rejects.toThrow('Query offset must be a nonnegative integer')
		const aggregate = users.aggregate('sum', 'age', { limit: Number.NaN })
		expect(aggregate).toBeInstanceOf(Promise)
		await expect(aggregate).rejects.toThrow('Query limit must be a nonnegative integer')
		expect(() => users.scan({ offset: Number.POSITIVE_INFINITY })).toThrow(
			'Query offset must be a nonnegative integer',
		)
	})

	it('accepts zero paging while count and aggregate retain unpaged semantics', async () => {
		const users = await createSeededUsersTable()
		expect(await users.records({ limit: 0 })).toEqual([])
		expect(await collect(users.scan({ limit: 0 }))).toEqual([])
		expect(await users.count({ limit: 0, offset: 0 })).toBe(3)
		expect(await users.aggregate('sum', 'age', { limit: 0, offset: 0 })).toBe(99)
	})

	it('count returns the matching total over the engine', async () => {
		const users = await createSeededUsersTable()
		expect(await users.count()).toBe(3)
		expect(
			await users.count({
				conditions: [{ column: 'age', operator: 'above', values: [30], connector: 'and' }],
			}),
		).toBe(2)
	})

	it('guards raw rows before paging and counting', async () => {
		const driver = createMemoryDriver()
		const db = createDatabase({
			driver,
			tables: {
				users: {
					id: stringShape(),
					name: stringShape({ min: 1 }),
					age: integerShape(),
				},
			},
		})
		const users = db.table('users')
		await db.open()
		await driver.write('users', 'a', { id: 'a', name: '', age: 1 })
		await driver.write('users', 'b', { id: 'b', name: 'Valid', age: 2 })

		expect(await users.records({ limit: 1 })).toEqual([{ id: 'b', name: 'Valid', age: 2 }])
		expect(await collect(users.scan({ limit: 1 }))).toEqual([{ id: 'b', name: 'Valid', age: 2 }])
		expect(await users.count()).toBe(1)
	})

	it('aggregate computes over the matched (not paged) rows', async () => {
		const users = await createSeededUsersTable()
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
		const users = await createSeededUsersTable()
		expect(
			await users.aggregate('sum', 'age', {
				conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
			}),
		).toBeUndefined()
	})
})

describe('Table — scan (lazy streaming)', () => {
	it('yields all rows in driver key-order (order is ignored)', async () => {
		const users = await createSeededUsersTable()
		const rows = await collect(users.scan())
		expect(rows.map((row) => row.id)).toEqual(['u1', 'u2', 'u3'])
	})

	it('applies input conditions lazily', async () => {
		const users = await createSeededUsersTable()
		const rows = await collect(
			users.scan({
				conditions: [{ column: 'age', operator: 'above', values: [30], connector: 'and' }],
			}),
		)
		expect(rows.map((row) => row.id).sort()).toEqual(['u1', 'u2'])
	})

	it('applies offset and limit through lazy counting', async () => {
		const users = await createSeededUsersTable()
		const rows = await collect(users.scan({ offset: 1, limit: 1 }))
		expect(rows.map((row) => row.id)).toEqual(['u2'])
	})

	it('a fresh call yields from the start even after an earlier consumer broke early', async () => {
		const users = await createSeededUsersTable()
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
		const users = await createSeededUsersTable()
		const controller = new AbortController()
		const seen: string[] = []
		let error: unknown
		try {
			for await (const row of users.scan(undefined, { signal: controller.signal })) {
				seen.push(row.id)
				controller.abort('aborted')
			}
		} catch (caught) {
			error = caught
		}
		expect(seen).toEqual(['u1'])
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('ABORTED')
	})

	it('records / count / aggregate throw ABORTED when the signal is already fired', async () => {
		const users = await createSeededUsersTable()
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

	it('refines a native stream and strips paging before dispatch', async () => {
		const streamCalls: QueryInput[] = []
		const memory = createMemoryDriver()
		const driver: DriverInterface = {
			async open(schema) {
				await memory.open(schema)
			},
			async close() {
				await memory.close()
			},
			async read(table, key) {
				return memory.read(table, key)
			},
			async write(table, key, row, options) {
				await memory.write(table, key, row, options)
			},
			async insert(table, key, row, options) {
				await memory.insert(table, key, row, options)
			},
			async delete(table, key, options) {
				return memory.delete(table, key, options)
			},
			async keys(table) {
				return memory.keys(table)
			},
			scan(table) {
				return memory.scan(table)
			},
			async clear(table) {
				await memory.clear(table)
			},
			async snapshot(tables) {
				return memory.snapshot(tables)
			},
			async *stream(_table, input) {
				streamCalls.push(input)
				yield { id: 'native', name: 'Native', age: 7 }
			},
		}
		const users = createDatabase({ driver, tables: HOOK_TABLES }).table('users')
		const input: QueryInput = {
			conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
			offset: 2,
			limit: 1,
		}
		const rows = await collect(users.scan(input))
		expect(rows).toEqual([])
		expect(streamCalls).toEqual([{ conditions: input.conditions }])
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
		expect(typeof query.condition).toBe('function')
		expect(
			(
				await query
					.condition({ column: 'role', operator: 'equals', values: ['member'], connector: 'and' })
					.collect()
			).map((row) => row.id),
		).toEqual(['u2'])
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
// When a driver implements the optional `records` / `aggregate` hooks,
// `Table` PREFERS them over the scan engine; with a plain `createMemoryDriver` it
// FALLS BACK to the engine. `createRecordingDriver` (tests/setup.ts) is a real
// Memory-backed driver that stores rows yet short-circuits the two
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
		// And it received the FULL input (records must honor filter + order + page).
		expect(recordsCalls).toHaveLength(1)
		const [input] = recordsCalls
		if (input === undefined) throw new Error('Expected one recorded input')
		expect(input.conditions).toHaveLength(1)
	})

	it('count narrows rows from the records hook and ignores paging', async () => {
		const { driver, recordsCalls } = createRecordingDriver()
		const users = createDatabase({ driver, tables: HOOK_TABLES }).table('users')
		await users.set({ id: 'stored', name: 'Stored', age: 30 })

		const total = await users.count({
			conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
			limit: 1,
			offset: 5,
		})

		expect(total).toBe(1)
		expect(recordsCalls).toEqual([
			{
				conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
			},
		])
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
			input: {
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

// ── Emitter — the PUSH observation surface ───────────────────────────────────
//
// `.claude/rules/patterns.md` § Stateful emitters owns this pattern.
// Alongside the database-level lifecycle, each Table exposes a typed `emitter`
// (`TableEventMap`) carrying its per-row mutation moments — `write` (set / add / update),
// `remove`, `clear` — for fire-and-forget observers (cache invalidation, sync). Events
// carry the affected KEY only (no value payload). Every event is emitted directly; the
// emitter isolates a listener throw (it can never escape into a write or its transaction —
// `.claude/rules/patterns.md` § Listener isolation), and every emit sits AFTER the driver
// write / delete / clear completes. A Table
// receives the Database's shared `error` handler, so a listener throw is reported without
// escaping. These pin: each event fires with the right key;
// `set` / `add` / `update` all emit one `write`; a no-op delete / update emits nothing; and
// the emit-safety guarantee — a throwing observer cannot corrupt the written state.

// The TableEventMap event names recorded across the emitter tests — fed to the shipped
// `createRecorders` (`.claude/rules/tests.md` § Shared test infrastructure: the per-event
// wiring lives in `@orkestrel/test`; this file
// keeps only the names its scenarios observe). The list carries its own exact union rather
// than `keyof TableEventMap`, because a name in the type argument that the array omits reads
// `undefined` at runtime under a non-optional recorder type.
type TableEvent = 'write' | 'remove' | 'clear'
const TABLE_EVENTS: readonly TableEvent[] = ['write', 'remove', 'clear']

describe('Table — emitter (push observation surface)', () => {
	it('set / add / update each fire one write carrying the key', async () => {
		const users = userTable()
		const events = createRecorders<TableEventMap, TableEvent>(users.emitter, TABLE_EVENTS)
		await users.set(createUserRow()) // set → write
		await users.add({ id: 'u2', name: 'Bo', age: 41 }) // add → write
		await users.update('u1', { age: 37 }) // update → write
		expect(events.write.calls).toEqual([['u1'], ['u2'], ['u1']])
		expect(events.remove.count).toBe(0)
	})

	it('fires remove on a real delete; a delete of an absent key emits nothing', async () => {
		const users = userTable()
		await users.set(createUserRow())
		const events = createRecorders<TableEventMap, TableEvent>(users.emitter, TABLE_EVENTS)
		expect(await users.remove('u1')).toBe(true)
		expect(await users.remove('missing')).toBe(false) // no row → no event
		expect(events.remove.calls).toEqual([['u1']])
	})

	it('a no-op update (absent key) emits no write', async () => {
		const users = userTable()
		const events = createRecorders<TableEventMap, TableEvent>(users.emitter, TABLE_EVENTS)
		expect(await users.update('missing', { age: 1 })).toBe(false)
		expect(events.write.count).toBe(0)
	})

	it('fires clear when the table is emptied', async () => {
		const users = userTable()
		await users.set([
			{ id: 'u1', name: 'Ada', age: 36 },
			{ id: 'u2', name: 'Bo', age: 41 },
		])
		const events = createRecorders<TableEventMap, TableEvent>(users.emitter, TABLE_EVENTS)
		await users.clear()
		expect(events.clear.calls).toEqual([[]])
	})

	it('a batch write fires one write per row, in order', async () => {
		const users = userTable()
		const events = createRecorders<TableEventMap, TableEvent>(users.emitter, TABLE_EVENTS)
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
		const events = createRecorders<TableEventMap, TableEvent>(users.emitter, TABLE_EVENTS)
		await expect(users.set({ id: 'u1', name: '', age: 36 })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(events.write.count).toBe(0)
	})

	it('aborted point mutations emit no success event and leave state unchanged', async () => {
		const users = userTable()
		await users.set(createUserRow())
		const events = createRecorders<TableEventMap, TableEvent>(users.emitter, TABLE_EVENTS)
		const controller = new AbortController()
		controller.abort('stop')
		await expect(
			users.add({ id: 'u2', name: 'Bo', age: 41 }, { signal: controller.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		await expect(
			users.update('u1', { age: 99 }, { signal: controller.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		await expect(users.remove('u1', { signal: controller.signal })).rejects.toMatchObject({
			code: 'ABORTED',
		})
		expect(events.write.count).toBe(0)
		expect(events.remove.count).toBe(0)
		expect(await users.get('u1')).toEqual(createUserRow())
		expect(await users.get('u2')).toBeUndefined()
	})

	it('EMIT SAFETY: a throwing write listener cannot corrupt the written row (the emitter isolates it)', async () => {
		const users = userTable()
		users.emitter.on('write', () => {
			throw new Error('write observer blew up')
		})
		// The write still lands despite the throwing observer. This database was created without
		// an `error` handler, so the table emitter swallows the isolated throw.
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

	it('routes root, imported, and transaction table listener throws to the shared handler', async () => {
		const errors = createRecorder<readonly [error: unknown, event: string]>()
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape() } },
			error: errors.handler,
		})
		const imported = db.import({ logs: { id: stringShape(), message: stringShape() } })
		const users = db.table('users')
		users.emitter.on('write', () => {
			throw new Error('root listener failed')
		})
		await users.set({ id: 'u1', name: 'Ada' })

		const logs = imported.table('logs')
		logs.emitter.on('write', () => {
			throw new Error('imported listener failed')
		})
		await logs.set({ id: 'l1', message: 'opened' })

		await db.transaction(async (transaction) => {
			const scoped = transaction.table('users')
			scoped.emitter.on('write', () => {
				throw new Error('transaction listener failed')
			})
			await scoped.set({ id: 'u2', name: 'Bo' })
		})

		expect(errors.calls).toEqual([
			[expect.any(Error), 'write'],
			[expect.any(Error), 'write'],
			[expect.any(Error), 'write'],
		])
		expect(await users.keys()).toEqual(['u1', 'u2'])
		expect(await logs.get('l1')).toEqual({ id: 'l1', message: 'opened' })
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
