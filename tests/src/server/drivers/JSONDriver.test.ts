import type { Criteria } from '@src/core'
import { isDatabaseError, planMigration } from '@src/core'
import { createJSONDriver, JSONDriver } from '@src/server'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCondition, conformDriver } from '../../../setup.js'
import { driverSchema, tempDatabasePath } from '../../../setupServer.js'

conformDriver('JSONDriver', () => createJSONDriver(tempDatabasePath().path))

// The JSON driver's nine DriverInterface primitives over a real temp file (no
// mocks, AGENTS §16): open + keyed read/write/delete/keys/scan(KEY order)/clear,
// persistence across a close / reopen, snapshot rollback restoring BOTH memory and
// the file, and graceful degradation on a missing / corrupt / wrong-shaped file.
// It is a decorator over MemoryDriver, so key order and capture-replay snapshot are
// inherited; these assert the persistence layer the decorator adds.

// The shared driver-conformance schema (a text-primary `users` table + a non-`id`
// primary `posts` table, proving the key is recovered from each table's own primary
// column on load) — see `driverSchema` in setupServer (AGENTS §16.1). The JSON battery
// uses the default single `['name']` index on `users`.
const SCHEMA = driverSchema()

let path = ''
let cleanup = (): void => {}
let driver = new JSONDriver('placeholder')

// A fresh temp path per test; the driver is opened on it. The path is reused across
// reopen cases (a new driver on the same file) to prove persistence.
beforeEach(async () => {
	const temp = tempDatabasePath()
	path = temp.path
	cleanup = temp.cleanup
	driver = new JSONDriver(path)
	await driver.open(SCHEMA)
})

afterEach(async () => {
	await driver.close()
	cleanup()
})

describe('JSONDriver — keyed CRUD', () => {
	it('writes and reads a row back over a temp file', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
	})

	it('upserts an existing key', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: false })
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada Lovelace', age: 37, active: true })
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada Lovelace',
			age: 37,
			active: true,
		})
	})

	it('returns undefined reading a missing key', async () => {
		expect(await driver.read('users', 'nope')).toBeUndefined()
	})

	it('reports whether a delete removed a row, and the row is gone', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await driver.delete('users', 'u1')).toBe(true)
		expect(await driver.delete('users', 'u1')).toBe(false)
		expect(await driver.read('users', 'u1')).toBeUndefined()
	})

	it('clears a table', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })
		await driver.clear('users')
		expect(await driver.keys('users')).toEqual([])
	})

	it('keys a table by its non-id primary column', async () => {
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		expect(await driver.keys('posts')).toEqual(['intro'])
		expect(await driver.read('posts', 'intro')).toEqual({ slug: 'intro', title: 'Intro' })
	})

	it('round-trips a nested object through a json column', async () => {
		const meta = { tags: ['a', 'b'], info: { score: 9, ok: true } }
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true, meta })
		expect((await driver.read('users', 'u1'))?.meta).toEqual(meta)
	})
})

describe('JSONDriver — KEY order (inherited from MemoryDriver)', () => {
	it('lists keys in key order though inserted out of order', async () => {
		await driver.write('users', 'u3', { id: 'u3', name: 'Edsger', age: 50, active: true })
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })
		expect(await driver.keys('users')).toEqual(['u1', 'u2', 'u3'])
	})

	it('scans rows in key order though inserted out of order', async () => {
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })
		await driver.write('users', 'u3', { id: 'u3', name: 'Edsger', age: 50, active: true })
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const scanned = []
		for await (const row of driver.scan('users')) scanned.push(row.id)
		expect(scanned).toEqual(['u1', 'u2', 'u3'])
	})
})

describe('JSONDriver — persistence across reopen', () => {
	it('survives a close and reopen on the same file', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		await driver.close()

		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		const scanned = []
		for await (const row of reopened.scan('users')) scanned.push(row.id)
		expect(scanned).toEqual(['u1', 'u2'])
		expect(await reopened.read('posts', 'intro')).toEqual({ slug: 'intro', title: 'Intro' })
		await reopened.close()
	})

	it('opens empty on a fresh (missing) path', async () => {
		const fresh = tempDatabasePath()
		const empty = createJSONDriver(fresh.path)
		await empty.open(SCHEMA)
		expect(await empty.keys('users')).toEqual([])
		const scanned = []
		for await (const row of empty.scan('users')) scanned.push(row)
		expect(scanned).toEqual([])
		await empty.close()
		fresh.cleanup()
	})
})

describe('JSONDriver — snapshot rollback re-flushes', () => {
	it('restores both memory and the file to the captured state', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		const rollback = await driver.snapshot()
		// Mutate after the snapshot — these writes also rewrote the file.
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99, active: false })
		await driver.write('users', 'u2', { id: 'u2', name: 'Ghost', age: 1, active: false })
		await driver.write('posts', 'extra', { slug: 'extra', title: 'Extra' })
		await rollback()

		// In memory, the state is back to the snapshot.
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await driver.read('users', 'u2')).toBeUndefined()
		expect(await driver.keys('posts')).toEqual(['intro'])

		// And the FILE was re-flushed: a fresh driver on the path reads the restored
		// state, not the post-snapshot mutations.
		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await reopened.read('users', 'u2')).toBeUndefined()
		expect(await reopened.keys('posts')).toEqual(['intro'])
		await reopened.close()
	})
})

describe('JSONDriver — graceful degradation', () => {
	it('starts empty (no throw) on a corrupt, non-JSON file', async () => {
		const corrupt = tempDatabasePath()
		await mkdir(dirname(corrupt.path), { recursive: true })
		await writeFile(corrupt.path, 'not json', 'utf-8')
		const recovered = createJSONDriver(corrupt.path)
		await recovered.open(SCHEMA)
		expect(await recovered.keys('users')).toEqual([])
		// Still usable: a write persists and reads back.
		await recovered.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await recovered.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await recovered.close()
		corrupt.cleanup()
	})

	it('starts empty (no throw) on a valid-JSON but wrong-shaped file', async () => {
		const wrong = tempDatabasePath()
		await mkdir(dirname(wrong.path), { recursive: true })
		await writeFile(wrong.path, JSON.stringify({ unexpected: [1, 2, 3] }), 'utf-8')
		const recovered = createJSONDriver(wrong.path)
		await recovered.open(SCHEMA)
		expect(await recovered.keys('users')).toEqual([])
		await recovered.close()
		wrong.cleanup()
	})

	it('skips malformed entries but keeps the good ones', async () => {
		const mixed = tempDatabasePath()
		await mkdir(dirname(mixed.path), { recursive: true })
		// A good row, a non-record entry, and a record missing its primary — only the
		// good row should survive the load (the rest are skipped, not thrown on).
		const contents = JSON.stringify({
			tables: {
				users: [
					{ id: 'u1', name: 'Ada', age: 36, active: true },
					42,
					{ name: 'No Key', age: 0, active: false },
				],
			},
		})
		await writeFile(mixed.path, contents, 'utf-8')
		const recovered = createJSONDriver(mixed.path)
		await recovered.open(SCHEMA)
		expect(await recovered.keys('users')).toEqual(['u1'])
		expect(await recovered.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await recovered.close()
		mixed.cleanup()
	})

	it('round-trips the documented file shape { tables: { [name]: rows } }', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.close()
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			tables: {
				users: [{ id: 'u1', name: 'Ada', age: 36, active: true }],
				posts: [],
			},
		})
	})
})

describe('JSONDriver — migrate', () => {
	it('persists a column.remove step to the file across close and reopen', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const before = SCHEMA
		const after = SCHEMA.map((table) =>
			table.name === 'users'
				? { ...table, columns: table.columns.filter((column) => column.name !== 'age') }
				: table,
		)
		const plan = planMigration(before, after)
		await driver.migrate?.(plan)
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', active: true })
		await driver.close()

		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', active: true })
		await reopened.close()
	})

	it('reflects a table.add step in the file shape', async () => {
		const extra = {
			name: 'tags',
			primary: 'id',
			columns: [{ name: 'id', type: 'text' as const, nullable: false }],
			indexes: [],
		}
		const plan = planMigration(SCHEMA, [...SCHEMA, extra])
		await driver.migrate?.(plan)
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({ tables: { users: [], posts: [], tags: [] } })
	})

	it('reflects a table.remove step in the file shape', async () => {
		const plan = planMigration(
			SCHEMA,
			SCHEMA.filter((table) => table.name !== 'posts'),
		)
		await driver.migrate?.(plan)
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({ tables: { users: [] } })
	})

	it('throws a MIGRATION DatabaseError when a step references an unknown table', async () => {
		const plan = planMigration([{ name: 'missing', primary: 'id', columns: [], indexes: [] }], [])
		const error = await driver.migrate?.(plan).catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
	})
})

describe('JSONDriver — stream', () => {
	it('yields condition-matched rows honoring a limit, from the file-backed store', async () => {
		await driver.write('users', 'a', { id: 'a', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'b', { id: 'b', name: 'Bo', age: 22, active: false })
		await driver.write('users', 'c', { id: 'c', name: 'Ada', age: 40, active: true })
		const criteria: Criteria = { conditions: [buildCondition('name', 'equals', ['Ada'])] }
		const rows = []
		for await (const row of driver.stream('users', criteria)) rows.push(row)
		expect(rows.map((row) => row.id).sort()).toEqual(['a', 'c'])

		const limited = []
		for await (const row of driver.stream('users', { limit: 1 })) limited.push(row)
		expect(limited).toHaveLength(1)
	})
})

describe('JSONDriver — transaction', () => {
	it('defers flushing until commit: the file is unchanged mid-transaction, then reflects every write', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Original', age: 30, active: true })
		const before = await readFile(path, 'utf-8')

		const handle = await driver.transaction()
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 31, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })

		// Mid-transaction: the file has not moved, though memory has.
		expect(await readFile(path, 'utf-8')).toBe(before)
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Changed',
			age: 31,
			active: true,
		})

		await handle.commit()

		// One flush, and the file reflects the full net state.
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			tables: {
				users: [
					{ id: 'u1', name: 'Changed', age: 31, active: true },
					{ id: 'u2', name: 'Bo', age: 22, active: false },
				],
				posts: [],
			},
		})
	})

	it('rollback restores memory AND the file to the pre-transaction state', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Original', age: 30, active: true })
		const before = await readFile(path, 'utf-8')

		const handle = await driver.transaction()
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99, active: false })
		await driver.write('users', 'u2', { id: 'u2', name: 'Ghost', age: 1, active: false })
		await handle.rollback()

		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Original',
			age: 30,
			active: true,
		})
		expect(await driver.read('users', 'u2')).toBeUndefined()
		expect(await readFile(path, 'utf-8')).toBe(before)
	})

	it('throws CONFLICT when a transaction is already active', async () => {
		await driver.transaction()
		const error = await driver.transaction().catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFLICT')
	})

	it('throws CONFLICT on a double commit', async () => {
		const handle = await driver.transaction()
		await handle.commit()
		const error = await handle.commit().catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFLICT')
	})

	it('throws CONFLICT rolling back after a commit', async () => {
		const handle = await driver.transaction()
		await handle.commit()
		const error = await handle.rollback().catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFLICT')
	})

	it('resumes normal per-mutation flushing after a transaction settles', async () => {
		const handle = await driver.transaction()
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await handle.commit()

		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			tables: {
				users: [
					{ id: 'u1', name: 'Ada', age: 36, active: true },
					{ id: 'u2', name: 'Bo', age: 22, active: false },
				],
				posts: [],
			},
		})
	})
})

describe('JSONDriver — meta persistence', () => {
	it('is undefined on a fresh store', async () => {
		expect(await driver.meta?.()).toBeUndefined()
	})

	it('stamps and persists meta across close and reopen', async () => {
		const meta = { version: 2, schema: SCHEMA }
		await driver.stamp?.(meta)
		await driver.close()

		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.meta?.()).toEqual(meta)
		await reopened.close()
	})

	it('loads an old-shape file (no meta key) with meta undefined and tables intact', async () => {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(
			path,
			JSON.stringify({
				tables: { users: [{ id: 'u1', name: 'Ada', age: 36, active: true }], posts: [] },
			}),
			'utf-8',
		)
		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.meta?.()).toBeUndefined()
		expect(await reopened.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await reopened.close()
	})

	it('drops a malformed meta block (version as a string) but keeps tables intact', async () => {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(
			path,
			JSON.stringify({
				meta: { version: 'two', schema: SCHEMA },
				tables: { users: [{ id: 'u1', name: 'Ada', age: 36, active: true }], posts: [] },
			}),
			'utf-8',
		)
		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.meta?.()).toBeUndefined()
		expect(await reopened.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await reopened.close()
	})

	it('serializes the exact { meta, tables } shape once stamped', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const meta = { version: 1, schema: SCHEMA }
		await driver.stamp?.(meta)
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			meta,
			tables: { users: [{ id: 'u1', name: 'Ada', age: 36, active: true }], posts: [] },
		})
	})

	it('serializes without a meta key while unstamped', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			tables: { users: [{ id: 'u1', name: 'Ada', age: 36, active: true }], posts: [] },
		})
		expect(Object.keys(parsed as Record<string, unknown>)).not.toContain('meta')
	})
})

describe('JSONDriver — driver error seam', () => {
	it('rejects a write with a DRIVER DatabaseError carrying the path when the write path is blocked', async () => {
		const temp = tempDatabasePath()
		const blockerPath = `${dirname(temp.path)}/blocker`
		await writeFile(blockerPath, 'not a directory', 'utf-8')
		const driverPath = `${blockerPath}/db.json`
		const blocked = createJSONDriver(driverPath)
		await blocked.open(SCHEMA)
		const error = await blocked
			.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
			.catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.path : undefined).toBe(driverPath)
		temp.cleanup()
	})
})

describe('JSONDriver — scoped snapshot', () => {
	it('restores only the snapshotted table on rollback, in memory and in the file', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		const rollback = await driver.snapshot(['users'])

		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99, active: false })
		await driver.write('posts', 'extra', { slug: 'extra', title: 'Extra' })
		await rollback()

		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await driver.keys('posts')).toEqual(['extra', 'intro'])

		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			tables: {
				users: [{ id: 'u1', name: 'Ada', age: 36, active: true }],
				posts: [
					{ slug: 'extra', title: 'Extra' },
					{ slug: 'intro', title: 'Intro' },
				],
			},
		})
	})
})

describe('JSONDriver — atomic flush', () => {
	it('leaves no leftover temp files after a burst of writes, and the file always parses', async () => {
		const ids = Array.from({ length: 20 }, (_, index) => `u${String(index).padStart(2, '0')}`)
		for (const [index, id] of ids.entries()) {
			await driver.write('users', id, { id, name: `User ${index}`, age: 20 + index, active: true })
		}
		const entries = await readdir(dirname(path))
		expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false)
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			tables: {
				users: ids.map((id, index) => ({
					id,
					name: `User ${index}`,
					age: 20 + index,
					active: true,
				})),
				posts: [],
			},
		})
	})
})
