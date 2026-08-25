import type {
	DatabaseEventMap,
	QueryInput,
	DriverMetadata,
	MigrationInput,
	TableSchema,
	StorageInterface,
} from '@src/core'
import { conformDriver, createDatabase, isDatabaseError, planMigration } from '@src/core'
import { createJSONDriver, JSONDriver } from '@src/server'
import { isRecord, stringShape } from '@orkestrel/contract'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { collect, createRecorders } from '@orkestrel/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCondition } from '../../../setup.js'
import { driverSchema, replaceTransactionFailure, tempDatabasePath } from '../../../setupServer.js'

// The shared driver-conformance battery over this backend. `conformDriver` (`@src/core`) owns the
// schema, the required-primitive checks, and the presence-gated optional-hook coverage (migrate /
// stream / transaction); each backend suite registers its own case.
describe('driver conformance — JSONDriver', () => {
	it('conforms to DriverInterface', async () => {
		await expect(
			conformDriver(() => createJSONDriver(tempDatabasePath().path)),
		).resolves.toBeUndefined()
	})
})

// The JSON driver's nine DriverInterface primitives over a real temp file (no
// mocks, AGENTS §16): open + keyed read/write/delete/keys/scan(KEY order)/clear,
// persistence across a close / reopen, snapshot rollback restoring BOTH memory and
// the file, and fail-closed recovery on every existing invalid file.
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

	it('serializes simultaneous same-key inserts into one success and one conflict', async () => {
		const outcomes = await Promise.allSettled([
			driver.insert('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
			}),
			driver.insert('users', 'u1', {
				id: 'u1',
				name: 'Overwrite',
				age: 99,
				active: false,
			}),
		])
		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
		expect(
			outcomes.filter(
				(outcome) =>
					outcome.status === 'rejected' &&
					isDatabaseError(outcome.reason) &&
					outcome.reason.code === 'CONFLICT',
			),
		).toHaveLength(1)
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.keys('users')).toEqual(['u1'])
		expect(await reopened.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await reopened.close()
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

describe('JSONDriver — Database integration', () => {
	it('shares imported schema, guards before paging, and preserves primary identity across reopen', async () => {
		const database = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape({ min: 1 }) } },
			version: 1,
		})
		const logs = database.import({
			logs: { id: stringShape(), message: stringShape() },
		})
		const users = database.table('users')
		await database.open()
		await driver.write('users', 'a', { id: 'a', name: '' })
		await driver.write('users', 'b', { id: 'b', name: 'Valid' })
		await logs.table('logs').set({ id: 'l1', message: 'started' })

		expect(await users.records({ limit: 1 })).toEqual([{ id: 'b', name: 'Valid' }])
		expect(await collect(users.scan({ limit: 1 }))).toEqual([{ id: 'b', name: 'Valid' }])
		expect(await users.count()).toBe(1)
		const diagnostic = await users
			.set({ id: 'payload-secret', name: '' })
			.catch((caught: unknown) => caught)
		expect(JSON.stringify(diagnostic)).not.toContain('payload-secret')
		await expect(users.update('b', { id: 'moved' })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
		expect(await users.get('b')).toEqual({ id: 'b', name: 'Valid' })
		await database.close()

		const reopenedDriver = createJSONDriver(path)
		const reopened = createDatabase({
			driver: reopenedDriver,
			tables: { users: { id: stringShape(), name: stringShape({ min: 1 }) } },
			version: 1,
		})
		const reopenedLogs = reopened.import({
			logs: { id: stringShape(), message: stringShape() },
		})
		await reopened.open()
		expect(await reopened.table('users').get('b')).toEqual({ id: 'b', name: 'Valid' })
		expect(await reopenedLogs.table('logs').get('l1')).toEqual({
			id: 'l1',
			message: 'started',
		})
		await reopened.close()
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

		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Changed Again',
			age: 100,
			active: false,
		})
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})

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

	it('captures at its exact writer-queue position', async () => {
		const first = driver.write('users', 'u1', {
			id: 'u1',
			name: 'First',
			age: 1,
			active: true,
		})
		const snapshot = driver.snapshot()
		const second = driver.write('users', 'u2', {
			id: 'u2',
			name: 'Second',
			age: 2,
			active: true,
		})
		const rollback = await snapshot
		await Promise.all([first, second])
		await rollback()
		expect(await driver.keys('users')).toEqual(['u1'])
	})

	it('restores through the current memory instance after a transaction replacement', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const rollback = await driver.snapshot(['users', 'users', 'missing'])
		await driver.transaction(async (storage) => {
			await storage.write('users', 'u1', {
				id: 'u1',
				name: 'Transaction',
				age: 37,
				active: false,
			})
			await storage.write('users', 'u2', {
				id: 'u2',
				name: 'Added',
				age: 1,
				active: true,
			})
		})
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await driver.read('users', 'u2')).toBeUndefined()
	})

	it('adapts captured rows to the current schema and retains current metadata', async () => {
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
			meta: null,
		})
		await driver.stamp?.({ version: 1, schema: SCHEMA })
		const rollback = await driver.snapshot(['users'])
		const users = SCHEMA.find((table) => table.name === 'users')
		const posts = SCHEMA.find((table) => table.name === 'posts')
		if (users === undefined || posts === undefined) throw new Error('Expected driver schema')
		const current: readonly TableSchema[] = [
			{
				...users,
				columns: [
					...users.columns.filter((column) => column.name !== 'active' && column.name !== 'meta'),
					{
						name: 'nickname',
						storage: 'text',
						optional: true,
						nullable: false,
					},
					{
						name: 'note',
						storage: 'text',
						optional: false,
						nullable: true,
					},
				],
			},
			posts,
		]
		const plan = planMigration(SCHEMA, current, 1, 2)
		await driver.migrate?.({ plan, metadata: { version: 2, schema: current } })
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Changed',
			age: 99,
			nickname: 'Current',
			note: 'present',
		})
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: current })

		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Changed Again',
			age: 100,
			note: null,
		})
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: current })
	})

	it('skips removed captures and preserves tables added after capture', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		const rollback = await driver.snapshot()
		const users = SCHEMA.find((table) => table.name === 'users')
		if (users === undefined) throw new Error('Expected users schema')
		const logs: TableSchema = {
			name: 'logs',
			primary: 'id',
			columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
			indexes: [],
		}
		const current = [users, logs]
		await driver.migrate?.({
			plan: planMigration(SCHEMA, current, 1, 2),
			metadata: { version: 2, schema: current },
		})
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Changed',
			age: 37,
			active: false,
		})
		await driver.write('logs', 'l1', { id: 'l1' })
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await expect(driver.keys('posts')).rejects.toMatchObject({ code: 'NOT_FOUND' })
		expect(await driver.read('logs', 'l1')).toEqual({ id: 'l1' })
	})

	it('rejects capture and rollback admission while a transaction is active', async () => {
		const rollback = await driver.snapshot()
		await driver.transaction(async () => {
			await expect(driver.snapshot()).rejects.toMatchObject({ code: 'CONFLICT' })
			await expect(rollback()).rejects.toMatchObject({ code: 'CONFLICT' })
		})
	})

	it('keeps root and file unchanged after rollback persistence failure and permits retry', async () => {
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Captured',
			age: 1,
			active: true,
		})
		const rollback = await driver.snapshot(['users'])
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Current',
			age: 2,
			active: false,
		})
		const currentFile = await readFile(path, 'utf-8')
		const blocker = `${path}.${process.pid}.3.tmp`
		await mkdir(blocker)
		await expect(rollback()).rejects.toMatchObject({
			code: 'DRIVER',
			context: { path, temp: blocker },
		})
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Current',
			age: 2,
			active: false,
		})
		expect(await readFile(path, 'utf-8')).toBe(currentFile)

		await rm(blocker, { recursive: true })
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Captured',
			age: 1,
			active: true,
		})
	})

	it('treats an explicit unknown-only capture as a repeatable no-op', async () => {
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Captured',
			age: 1,
			active: true,
		})
		const rollback = await driver.snapshot(['missing', 'missing'])
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Current',
			age: 2,
			active: false,
		})
		await rollback()
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Current',
			age: 2,
			active: false,
		})
		const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
		expect(isRecord(parsed) && isRecord(parsed.tables) ? parsed.tables.users : undefined).toEqual([
			{ id: 'u1', name: 'Current', age: 2, active: false },
		])
	})

	it('skips a same-name table removed and re-added inside a committed transaction', async () => {
		const users = SCHEMA.find((table) => table.name === 'users')
		if (users === undefined) throw new Error('Expected users schema')
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Captured',
			age: 1,
			active: true,
		})
		const rollback = await driver.snapshot(['users'])
		await driver.transaction(async (storage) => {
			await storage.migrate?.({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{ operation: 'table.remove', table: 'users' },
						{ operation: 'table.add', table: users },
					],
				},
			})
			await storage.write('users', 'u2', {
				id: 'u2',
				name: 'Replacement',
				age: 2,
				active: false,
			})
		})

		await rollback()
		expect(await driver.keys('users')).toEqual(['u2'])
		expect(await driver.read('users', 'u2')).toEqual({
			id: 'u2',
			name: 'Replacement',
			age: 2,
			active: false,
		})
		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.keys('users')).toEqual(['u2'])
		await reopened.close()
	})

	it('rejects an incompatible replay before changing memory or file and permits retry', async () => {
		const incompatible = SCHEMA.map((table): TableSchema =>
			table.name === 'users'
				? {
						...table,
						columns: table.columns.map((column) =>
							column.name === 'age' ? { ...column, storage: 'text' } : column,
						),
					}
				: table,
		)
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Captured',
			age: 1,
			active: true,
		})
		const rollback = await driver.snapshot(['users'])
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Current',
			age: 2,
			active: false,
		})
		const currentFile = await readFile(path, 'utf-8')
		await driver.open(incompatible)

		await expect(rollback()).rejects.toMatchObject({ code: 'MIGRATION' })
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Current',
			age: 2,
			active: false,
		})
		expect(await readFile(path, 'utf-8')).toBe(currentFile)

		await driver.open(SCHEMA)
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Captured',
			age: 1,
			active: true,
		})
	})
})

describe('JSONDriver — durable recovery boundary', () => {
	it('treats only a proven missing path as a fresh store', async () => {
		const missing = tempDatabasePath()
		const recovered = createJSONDriver(missing.path)
		await recovered.open(SCHEMA)
		expect(await recovered.keys('users')).toEqual([])
		expect(await recovered.keys('posts')).toEqual([])
		await recovered.close()
		missing.cleanup()
	})

	it('wraps a non-ENOENT read failure without treating it as absence', async () => {
		const unreadable = tempDatabasePath()
		await mkdir(unreadable.path, { recursive: true })
		const recovered = createJSONDriver(unreadable.path)
		const error = await recovered.open(SCHEMA).catch((caught: unknown) => caught)
		expect(error).toMatchObject({
			code: 'DRIVER',
			message: 'Failed to read the JSON database file',
			context: { path: unreadable.path },
		})
		expect(isDatabaseError(error) ? error.context?.cause : undefined).toBeInstanceOf(Error)
		await expect(recovered.keys('users')).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await recovered.close()
		unreadable.cleanup()
	})

	it.each(['', '   ', 'not json', '{"tables":'])(
		'rejects invalid JSON syntax without exposing the native parser for %j',
		async (contents) => {
			const corrupt = tempDatabasePath()
			await mkdir(dirname(corrupt.path), { recursive: true })
			await writeFile(corrupt.path, contents, 'utf-8')
			const before = await readFile(corrupt.path, 'utf-8')
			const entries = await readdir(dirname(corrupt.path))
			const recovered = createJSONDriver(corrupt.path)
			const error = await recovered.open(SCHEMA).catch((caught: unknown) => caught)
			expect(error).toMatchObject({
				code: 'DRIVER',
				message: 'Stored JSON database is invalid JSON',
				context: { path: corrupt.path, aspect: 'syntax' },
			})
			expect(isDatabaseError(error) ? error.context?.cause : undefined).toBeUndefined()
			expect(await readFile(corrupt.path, 'utf-8')).toBe(before)
			expect(await readdir(dirname(corrupt.path))).toEqual(entries)
			await expect(recovered.keys('users')).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await recovered.close()
			corrupt.cleanup()
		},
	)

	it.each([
		null,
		[],
		42,
		{},
		{ unexpected: [] },
		{ tables: { users: [], posts: [] }, extra: true },
	])('rejects a non-exact outer document without rewriting it: %j', async (document) => {
		const corrupt = tempDatabasePath()
		await mkdir(dirname(corrupt.path), { recursive: true })
		const contents = JSON.stringify(document)
		await writeFile(corrupt.path, contents, 'utf-8')
		const recovered = createJSONDriver(corrupt.path)
		await expect(recovered.open(SCHEMA)).rejects.toMatchObject({
			code: 'DRIVER',
			message: 'Stored JSON database document is invalid',
			context: { path: corrupt.path, aspect: 'document' },
		})
		expect(await readFile(corrupt.path, 'utf-8')).toBe(contents)
		await recovered.close()
		corrupt.cleanup()
	})

	it.each([null, [], 42])('rejects a non-record tables container: %j', async (tables) => {
		const corrupt = tempDatabasePath()
		await mkdir(dirname(corrupt.path), { recursive: true })
		await writeFile(corrupt.path, JSON.stringify({ tables }), 'utf-8')
		const recovered = createJSONDriver(corrupt.path)
		await expect(recovered.open(SCHEMA)).rejects.toMatchObject({
			code: 'DRIVER',
			message: 'Stored JSON tables are invalid',
			context: { path: corrupt.path, aspect: 'tables' },
		})
		await recovered.close()
		corrupt.cleanup()
	})

	it('rejects missing and unknown table keys without publishing partial rows', async () => {
		const missing = tempDatabasePath()
		await mkdir(dirname(missing.path), { recursive: true })
		await writeFile(
			missing.path,
			JSON.stringify({ tables: { users: [{ id: 'u1', preserved: true }] } }),
			'utf-8',
		)
		const recovered = createJSONDriver(missing.path)
		await expect(recovered.open(SCHEMA)).rejects.toMatchObject({
			code: 'DRIVER',
			message: 'Stored JSON table set is invalid',
			context: { path: missing.path, table: 'posts', aspect: 'missing' },
		})
		await expect(recovered.keys('users')).rejects.toMatchObject({ code: 'NOT_FOUND' })

		await writeFile(
			missing.path,
			JSON.stringify({ tables: { users: [], posts: [], private: [] } }),
			'utf-8',
		)
		await expect(recovered.open(SCHEMA)).rejects.toMatchObject({
			code: 'DRIVER',
			message: 'Stored JSON table set is invalid',
			context: { path: missing.path, aspect: 'unknown', count: 1 },
		})
		await recovered.close()
		missing.cleanup()
	})

	it.each([
		{
			label: 'container',
			tables: { users: {}, posts: [] },
			context: { table: 'users', aspect: 'container' },
		},
		{
			label: 'row record',
			tables: { users: [42], posts: [] },
			context: { table: 'users', index: 0, aspect: 'record' },
		},
		{
			label: 'primary',
			tables: { users: [{ name: 'missing' }], posts: [] },
			context: { table: 'users', index: 0, aspect: 'primary' },
		},
		{
			label: 'duplicate',
			tables: { users: [{ id: 'u1' }, { id: 'u1' }], posts: [] },
			context: { table: 'users', index: 1, aspect: 'duplicate' },
		},
	])('rejects an invalid $label while preserving the file', async ({ tables, context }) => {
		const corrupt = tempDatabasePath()
		await mkdir(dirname(corrupt.path), { recursive: true })
		const contents = JSON.stringify({ tables })
		await writeFile(corrupt.path, contents, 'utf-8')
		const recovered = createJSONDriver(corrupt.path)
		await expect(recovered.open(SCHEMA)).rejects.toMatchObject({
			code: 'DRIVER',
			message:
				context.aspect === 'container'
					? 'Stored JSON table is invalid'
					: 'Stored JSON row is invalid',
			context: { path: corrupt.path, ...context },
		})
		expect(await readFile(corrupt.path, 'utf-8')).toBe(contents)
		await recovered.close()
		corrupt.cleanup()
	})

	it('retains structurally valid storage rows for the application layer to validate', async () => {
		const legacy = tempDatabasePath()
		await mkdir(dirname(legacy.path), { recursive: true })
		await writeFile(
			legacy.path,
			JSON.stringify({
				tables: { users: [{ id: 'u1', application: 'invalid' }], posts: [] },
			}),
			'utf-8',
		)
		const recovered = createJSONDriver(legacy.path)
		await recovered.open(SCHEMA)
		expect(await recovered.read('users', 'u1')).toEqual({
			id: 'u1',
			application: 'invalid',
		})
		await recovered.close()
		legacy.cleanup()
	})

	it('retries the same driver after external repair without losing the original bytes', async () => {
		const repairable = tempDatabasePath()
		await mkdir(dirname(repairable.path), { recursive: true })
		const invalid = '{"tables":'
		await writeFile(repairable.path, invalid, 'utf-8')
		const recovered = createJSONDriver(repairable.path)
		await expect(recovered.open(SCHEMA)).rejects.toMatchObject({ code: 'DRIVER' })
		expect(await readFile(repairable.path, 'utf-8')).toBe(invalid)
		await writeFile(
			repairable.path,
			JSON.stringify({ tables: { users: [{ id: 'u1', repaired: true }], posts: [] } }),
			'utf-8',
		)
		await recovered.open(SCHEMA)
		expect(await recovered.read('users', 'u1')).toEqual({ id: 'u1', repaired: true })
		await recovered.close()
		repairable.cleanup()
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
		await driver.migrate?.({ plan })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', active: true })
		await driver.close()

		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', active: true })
		await reopened.close()
	})

	it('reflects a table.add step in the file shape', async () => {
		const extra: TableSchema = {
			name: 'tags',
			primary: 'id',
			columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
			indexes: [],
		}
		const plan = planMigration(SCHEMA, [...SCHEMA, extra])
		await driver.migrate?.({ plan })
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({ tables: { users: [], posts: [], tags: [] } })
	})

	it('reflects a table.remove step in the file shape', async () => {
		const plan = planMigration(
			SCHEMA,
			SCHEMA.filter((table) => table.name !== 'posts'),
		)
		await driver.migrate?.({ plan })
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({ tables: { users: [] } })
	})

	it('throws a MIGRATION DatabaseError when a step references an unknown table', async () => {
		const plan = planMigration(
			[
				{
					name: 'missing',
					primary: 'id',
					columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
					indexes: [],
				},
			],
			[],
		)
		const error = await driver.migrate?.({ plan }).catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
	})

	it('accepts reorder-only migration metadata', async () => {
		const reordered = [...SCHEMA].reverse().map((table) => ({
			...table,
			columns: [...table.columns].reverse(),
			indexes: [...table.indexes].reverse(),
		}))
		await driver.migrate?.({
			plan: { from: 1, to: 2, steps: [] },
			metadata: { version: 2, schema: reordered },
		})
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: reordered })
	})

	it('rejects an unsafe required column before rows, schema, metadata, or file change', async () => {
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await driver.stamp?.({ version: 1, schema: SCHEMA })
		const beforeFile = await readFile(path, 'utf-8')
		await expect(
			driver.migrate?.({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{
							operation: 'column.add',
							table: 'users',
							column: {
								name: 'required',
								storage: 'text',
								optional: false,
								nullable: false,
							},
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: 'MIGRATION',
			context: { table: 'users', column: 'required' },
		})
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await driver.metadata?.()).toEqual({ version: 1, schema: SCHEMA })
		expect(await readFile(path, 'utf-8')).toBe(beforeFile)
	})

	it('publishes migrated rows, schema, and metadata together or leaves all three unchanged', async () => {
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		const declared = SCHEMA.filter((table) => table.name !== 'posts')
		const plan = planMigration(SCHEMA, declared, 1, 2)
		await rm(path, { force: true })
		await mkdir(path)
		await expect(
			driver.migrate?.({ plan, metadata: { version: 2, schema: declared } }),
		).rejects.toMatchObject({ code: 'DRIVER' })
		expect(await driver.metadata?.()).toBeUndefined()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})

		await rm(path, { force: true, recursive: true })
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
		expect(parsed).toEqual({
			tables: {
				users: [{ id: 'u1', name: 'Ada', age: 36, active: true }],
				posts: [{ slug: 'intro', title: 'Intro' }],
			},
		})
	})
})

describe('JSONDriver — stream', () => {
	it('yields condition-matched rows honoring a limit, from the file-backed store', async () => {
		await driver.write('users', 'a', { id: 'a', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'b', { id: 'b', name: 'Bo', age: 22, active: false })
		await driver.write('users', 'c', { id: 'c', name: 'Ada', age: 40, active: true })
		const input: QueryInput = { conditions: [buildCondition('name', 'equals', ['Ada'])] }
		const rows = []
		for await (const row of driver.stream('users', input)) rows.push(row)
		expect(rows.map((row) => row.id).sort()).toEqual(['a', 'c'])

		const limited = []
		for await (const row of driver.stream('users', { limit: 1 })) limited.push(row)
		expect(limited).toHaveLength(1)
	})

	it('rejects invalid direct paging and accepts a zero limit', async () => {
		await driver.write('users', 'a', { id: 'a', name: 'Ada', age: 36, active: true })
		expect(() => driver.stream('users', { offset: -1 })).toThrow(
			'Query offset must be a nonnegative integer',
		)
		expect(await collect(driver.stream('users', { limit: 0 }))).toEqual([])
	})
})

describe('JSONDriver — transaction', () => {
	it('terminalizes root scan and stream continuations resumed inside a transaction', async () => {
		await driver.write('users', 'a', { id: 'a', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'b', { id: 'b', name: 'Bo', age: 22, active: false })
		await driver.write('users', 'c', { id: 'c', name: 'Cy', age: 40, active: true })
		const scan = driver.scan('users')[Symbol.asyncIterator]()
		const stream = driver.stream('users', {})[Symbol.asyncIterator]()
		expect((await scan.next()).done).toBe(false)
		expect((await stream.next()).done).toBe(false)

		await driver.transaction(async (transaction) => {
			for (const iterator of [scan, stream]) {
				await expect(iterator.next()).rejects.toMatchObject({
					code: 'CONFLICT',
					message: 'A transaction is active on this driver',
				})
				await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
			}
			await transaction.write('users', 'd', {
				id: 'd',
				name: 'Di',
				age: 23,
				active: true,
			})
			expect((await transaction.read('users', 'd'))?.name).toBe('Di')
		})

		expect((await driver.read('users', 'd'))?.name).toBe('Di')
		await driver.write('users', 'e', { id: 'e', name: 'Eve', age: 55, active: true })
		expect((await driver.read('users', 'e'))?.name).toBe('Eve')
	})

	it('does not report rollback when a wrapper replaces the post-native rejection', async () => {
		const replacement = new Error('post-rollback wrapper failure')
		const scope = new Error('scope failed')
		const database = createDatabase({
			driver: replaceTransactionFailure(driver, replacement),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const events = createRecorders<DatabaseEventMap, 'rollback'>(database.emitter, ['rollback'])
		const error = await database
			.transaction(async (transaction) => {
				await transaction.table('users').set({ id: 'u1', name: 'Ada' })
				throw scope
			})
			.catch((caught: unknown) => caught)
		expect(error).toMatchObject({
			code: 'DRIVER',
			context: { transaction: scope, cause: replacement },
		})
		expect(events.rollback.count).toBe(0)
		expect(await driver.read('users', 'u1')).toBeUndefined()
	})

	it('isolates scoped work, supports read-after-write, and publishes atomically on fulfillment', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Original', age: 30, active: true })
		const before = await readFile(path, 'utf-8')
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const running = driver.transaction(async (transaction) => {
			await transaction.write('users', 'u1', {
				id: 'u1',
				name: 'Changed',
				age: 31,
				active: true,
			})
			await transaction.insert('users', 'u2', {
				id: 'u2',
				name: 'Bo',
				age: 22,
				active: false,
			})
			expect((await transaction.read('users', 'u1'))?.name).toBe('Changed')
			entered.resolve()
			await release.promise
		})
		await entered.promise
		expect(await readFile(path, 'utf-8')).toBe(before)
		await expect(driver.read('users', 'u1')).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(
			driver.write('users', 'outside', { id: 'outside', name: 'Outside', age: 1, active: false }),
		).rejects.toMatchObject({ code: 'CONFLICT' })
		release.resolve()
		await running
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

	it('discards rows and metadata when the scope rejects', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Original', age: 30, active: true })
		const before = await readFile(path, 'utf-8')
		const reason = new Error('rollback')
		await expect(
			driver.transaction(async (transaction) => {
				await transaction.write('users', 'u1', {
					id: 'u1',
					name: 'Changed',
					age: 99,
					active: false,
				})
				await transaction.write('users', 'u2', {
					id: 'u2',
					name: 'Ghost',
					age: 1,
					active: false,
				})
				const declared = SCHEMA.filter((table) => table.name !== 'posts')
				await transaction.migrate?.({
					plan: planMigration(SCHEMA, declared, 1, 2),
					metadata: { version: 2, schema: declared },
				})
				throw reason
			}),
		).rejects.toBe(reason)
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Original',
			age: 30,
			active: true,
		})
		expect(await driver.read('users', 'u2')).toBeUndefined()
		expect(await driver.metadata?.()).toBeUndefined()
		expect(await readFile(path, 'utf-8')).toBe(before)
	})

	it('commits candidate inserts, schema migration, and metadata in one file replacement', async () => {
		const declared = SCHEMA.filter((table) => table.name !== 'posts')
		await driver.transaction(async (transaction) => {
			await transaction.insert('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
			})
			await transaction.migrate?.({
				plan: planMigration(SCHEMA, declared, 1, 2),
				metadata: { version: 2, schema: declared },
			})
			expect(await transaction.metadata?.()).toEqual({ version: 2, schema: declared })
		})
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: declared })
		const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
		expect(parsed).toEqual({
			metadata: { version: 2, schema: declared },
			tables: {
				users: [{ id: 'u1', name: 'Ada', age: 36, active: true }],
			},
		})
	})

	it('owns scoped stamp and migrate metadata before caller mutation can cross an await', async () => {
		const plan = planMigration(SCHEMA, SCHEMA, 1, 2)
		await driver.transaction(async (transaction) => {
			const stampSchema = SCHEMA.map((table) => ({ ...table }))
			const stampInput = { version: 1, schema: stampSchema }
			const stamping = transaction.stamp?.(stampInput)
			if (stamping === undefined) throw new Error('Expected scoped stamp capability')
			const stampTable = stampSchema[0]
			if (stampTable === undefined) throw new Error('Expected stamp metadata table')
			stampInput.version = 91
			stampTable.name = 'mutated-stamp'
			await stamping

			const stamped = await transaction.metadata?.()
			if (stamped === undefined) throw new Error('Expected scoped stamped metadata')
			expect(stamped).toEqual({ version: 1, schema: SCHEMA })
			expect(Object.isFrozen(stamped)).toBe(true)
			expect(Object.isFrozen(stamped.schema)).toBe(true)

			const migrateSchema = SCHEMA.map((table) => ({ ...table }))
			const migrateMeta = { version: 2, schema: migrateSchema }
			const migrating = transaction.migrate?.({ plan, metadata: migrateMeta })
			if (migrating === undefined) throw new Error('Expected scoped migrate capability')
			const migrateTable = migrateSchema[0]
			if (migrateTable === undefined) throw new Error('Expected migrate metadata table')
			migrateMeta.version = 92
			migrateTable.name = 'mutated-migrate'
			await migrating

			const migrated = await transaction.metadata?.()
			if (migrated === undefined) throw new Error('Expected scoped migrated metadata')
			expect(migrated).toEqual({ version: 2, schema: SCHEMA })
			expect(migrated).not.toBe(stamped)
			expect(migrated.schema).not.toBe(stamped.schema)
		})

		expect(await driver.metadata?.()).toEqual({ version: 2, schema: SCHEMA })
		const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
		expect(parsed).toMatchObject({ metadata: { version: 2, schema: SCHEMA } })
	})

	it('rejects nesting and invalidates a captured capability after settlement', async () => {
		const captured = Promise.withResolvers<{
			readonly transaction: StorageInterface
			readonly iterator: AsyncIterator<unknown>
		}>()
		await driver.transaction(async (transaction) => {
			await expect(
				driver.transaction(async () => {
					throw new Error('nested scope ran')
				}),
			).rejects.toMatchObject({ code: 'CONFLICT' })
			await transaction.write('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
			})
			const iterator = transaction.scan('users')[Symbol.asyncIterator]()
			expect((await iterator.next()).done).toBe(false)
			captured.resolve({ transaction, iterator })
		})
		const stale = await captured.promise
		await expect(stale.transaction.read('users', 'u1')).rejects.toMatchObject({
			code: 'CONFLICT',
		})
		await expect(stale.iterator.next()).rejects.toMatchObject({ code: 'CONFLICT' })
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
	})

	it('invalidates the capability before asynchronous publication completes', async () => {
		const returned = Promise.withResolvers<void>()
		let captured: StorageInterface | undefined
		let completed = false
		const running = driver
			.transaction(async (transaction) => {
				captured = transaction
				const payload = 'x'.repeat(65_536)
				for (let index = 0; index < 32; index += 1) {
					await transaction.write('users', `u${index}`, {
						id: `u${index}`,
						name: `User ${index}`,
						payload,
					})
				}
				returned.resolve()
			})
			.finally(() => {
				completed = true
			})

		await returned.promise
		await Promise.resolve()
		await Promise.resolve()
		expect(completed).toBe(false)
		const stale = captured
		if (stale === undefined) throw new Error('Expected captured transaction capability')
		await expect(stale.write('users', 'late', { id: 'late', name: 'Late' })).rejects.toMatchObject({
			code: 'CONFLICT',
		})
		await running
		expect(await driver.read('users', 'late')).toBeUndefined()

		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.read('users', 'late')).toBeUndefined()
		expect(await reopened.keys('users')).toHaveLength(32)
		await reopened.close()
	})

	it('rejects stale scoped metadata work before inspecting hostile inputs', async () => {
		const captured = Promise.withResolvers<StorageInterface>()
		await driver.transaction(async (transaction) => {
			captured.resolve(transaction)
		})
		const stale = await captured.promise

		let stampReads = 0
		const stampMeta: DriverMetadata = {
			get version(): number {
				stampReads += 1
				throw new Error('stale stamp metadata was inspected')
			},
			schema: SCHEMA,
		}
		const stamping = stale.stamp?.(stampMeta)
		if (stamping === undefined) throw new Error('Expected scoped stamp capability')
		await expect(stamping).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(stampReads).toBe(0)

		let migrateReads = 0
		const migrateInput: MigrationInput = {
			plan: planMigration(SCHEMA, SCHEMA, 1, 2),
			get metadata(): DriverMetadata {
				migrateReads += 1
				throw new Error('stale migrate metadata was inspected')
			},
		}
		const migrating = stale.migrate?.(migrateInput)
		if (migrating === undefined) throw new Error('Expected scoped migrate capability')
		await expect(migrating).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(migrateReads).toBe(0)
	})

	it('orders work queued before and after acquisition without clobbering acknowledged writes', async () => {
		const before = driver.write('users', 'before', {
			id: 'before',
			name: 'Before',
			age: 1,
			active: true,
		})
		const transaction = driver.transaction(async (scoped) => {
			expect(await scoped.read('users', 'before')).toBeDefined()
			await scoped.write('users', 'inside', {
				id: 'inside',
				name: 'Inside',
				age: 2,
				active: true,
			})
		})
		const after = driver.write('users', 'after', {
			id: 'after',
			name: 'After',
			age: 3,
			active: true,
		})
		await Promise.all([before, transaction, after])
		expect(await driver.keys('users')).toEqual(['after', 'before', 'inside'])
	})

	it('queues open behind an earlier transaction and reloads the persisted deployed schema', async () => {
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Before',
			age: 1,
			active: true,
		})
		await driver.stamp?.({ version: 1, schema: SCHEMA })
		const transaction = driver.transaction(async (scoped) => {
			expect(await scoped.read('users', 'u1')).toBeDefined()
			await scoped.insert('users', 'u2', {
				id: 'u2',
				name: 'Inside',
				age: 2,
				active: true,
			})
		})
		const opening = driver.open(SCHEMA.filter((table) => table.name === 'posts'))
		await Promise.all([transaction, opening])

		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
		expect(await driver.keys('posts')).toEqual([])
		const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
		expect(parsed).toEqual({
			metadata: { version: 1, schema: SCHEMA },
			tables: {
				users: [
					{ id: 'u1', name: 'Before', age: 1, active: true },
					{ id: 'u2', name: 'Inside', age: 2, active: true },
				],
				posts: [],
			},
		})
	})

	it('leaves root memory exact when candidate commit persistence fails and recovers the queue', async () => {
		const temp = tempDatabasePath()
		await mkdir(dirname(temp.path), { recursive: true })
		await writeFile(temp.path, JSON.stringify({ tables: { users: [], posts: [] } }), 'utf-8')
		const blocked = new JSONDriver(temp.path)
		await blocked.open(SCHEMA)
		await mkdir(`${temp.path}.${process.pid}.1.tmp`)
		await expect(
			blocked.transaction(async (transaction) => {
				await transaction.write('users', 'u1', {
					id: 'u1',
					name: 'Ada',
					age: 36,
					active: true,
				})
				await transaction.stamp?.({ version: 2, schema: SCHEMA })
			}),
		).rejects.toMatchObject({ code: 'DRIVER' })
		expect(await blocked.read('users', 'u1')).toBeUndefined()
		expect(await blocked.metadata?.()).toBeUndefined()
		await expect(
			blocked.transaction(async (transaction) => {
				expect(await transaction.keys('users')).toEqual([])
				throw new Error('queue recovered')
			}),
		).rejects.toThrow('queue recovered')
		await blocked.close()
		temp.cleanup()
	})
})

describe('JSONDriver — metadata persistence', () => {
	it('is undefined on a fresh store', async () => {
		expect(await driver.metadata?.()).toBeUndefined()
	})

	it('stamps and persists metadata across close and reopen', async () => {
		const metadata = { version: 2, schema: SCHEMA }
		await driver.stamp?.(metadata)
		await driver.close()

		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		const restored = await reopened.metadata?.()
		if (restored === undefined) throw new Error('Expected restored metadata')
		expect(restored).toEqual(metadata)
		expect(restored).not.toBe(metadata)
		expect(restored.schema).not.toBe(metadata.schema)
		expect(Object.isFrozen(restored)).toBe(true)
		expect(Object.isFrozen(restored.schema)).toBe(true)
		await reopened.close()
	})

	it('snapshots root stamp ingress synchronously and returns distinct deeply frozen copies', async () => {
		const schema = SCHEMA.map((table) => ({ ...table }))
		const input = { version: 2, schema }
		const stamping = driver.stamp?.(input)
		if (stamping === undefined) throw new Error('Expected root stamp capability')
		const sourceTable = schema[0]
		if (sourceTable === undefined) throw new Error('Expected stamp metadata table')
		input.version = 99
		sourceTable.name = 'mutated'
		await stamping

		const first = await driver.metadata?.()
		const second = await driver.metadata?.()
		if (first === undefined || second === undefined) {
			throw new Error('Expected stamped metadata copies')
		}
		const firstTable = first.schema[0]
		if (firstTable === undefined) throw new Error('Expected copied metadata table')
		const firstColumn = firstTable.columns[0]
		if (firstColumn === undefined) throw new Error('Expected copied metadata column')
		const firstIndex = firstTable.indexes[0]
		if (firstIndex === undefined) throw new Error('Expected copied metadata index')

		expect(first).toEqual({ version: 2, schema: SCHEMA })
		expect(first).not.toBe(input)
		expect(first).not.toBe(second)
		expect(first.schema).not.toBe(second.schema)
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.schema)).toBe(true)
		expect(Object.isFrozen(firstTable)).toBe(true)
		expect(Object.isFrozen(firstTable.columns)).toBe(true)
		expect(Object.isFrozen(firstColumn)).toBe(true)
		expect(Object.isFrozen(firstTable.indexes)).toBe(true)
		expect(Object.isFrozen(firstIndex)).toBe(true)
		expect(Reflect.set(firstTable, 'name', 'changed')).toBe(false)
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: SCHEMA })

		const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
		expect(parsed).toMatchObject({ metadata: { version: 2, schema: SCHEMA } })
	})

	it('snapshots root migrate metadata before queue admission can yield', async () => {
		const schema = SCHEMA.map((table) => ({ ...table }))
		const metadata = { version: 2, schema }
		const plan = planMigration(SCHEMA, SCHEMA, 1, 2)
		const migrating = driver.migrate?.({ plan, metadata })
		if (migrating === undefined) throw new Error('Expected root migrate capability')
		const sourceTable = schema[0]
		if (sourceTable === undefined) throw new Error('Expected migrate metadata table')
		metadata.version = 99
		sourceTable.name = 'mutated'
		await migrating

		const stored = await driver.metadata?.()
		if (stored === undefined) throw new Error('Expected migrated metadata')
		expect(stored).toEqual({ version: 2, schema: SCHEMA })
		expect(Object.isFrozen(stored)).toBe(true)
		expect(Object.isFrozen(stored.schema)).toBe(true)
		expect(Object.isFrozen(stored.schema[0])).toBe(true)
		const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
		expect(parsed).toMatchObject({ metadata: { version: 2, schema: SCHEMA } })
	})

	it('loads an old-shape file without metadata and keeps tables intact', async () => {
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
		expect(await reopened.metadata?.()).toBeUndefined()
		expect(await reopened.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await reopened.close()
	})

	it.each([
		{ label: 'non-record payload', metadata: 'payload-secret' },
		{ label: 'string version', metadata: { version: 'two', schema: SCHEMA } },
		{
			label: 'invalid column storage',
			metadata: {
				version: 1,
				schema: [
					{
						...SCHEMA[0],
						columns: [
							{
								name: 'payload-secret',
								storage: 'string',
								optional: false,
								nullable: false,
							},
						],
					},
					SCHEMA[1],
				],
			},
		},
		{
			label: 'non-string index entry',
			metadata: { version: 1, schema: [{ ...SCHEMA[0], indexes: [[42]] }, SCHEMA[1]] },
		},
		{
			label: 'non-record column',
			metadata: { version: 1, schema: [{ ...SCHEMA[0], columns: [42] }, SCHEMA[1]] },
		},
	])(
		'fails closed on metadata with a $label and keeps durable bytes exact',
		async ({ metadata }) => {
			await mkdir(dirname(path), { recursive: true })
			const contents = JSON.stringify({
				metadata,
				tables: {
					users: [{ id: 'u1', name: 'Ada', age: 36, active: true }],
					posts: [],
				},
			})
			await writeFile(path, contents, 'utf-8')
			const reopened = createJSONDriver(path)
			const error = await reopened.open(SCHEMA).catch((caught: unknown) => caught)
			expect(error).toMatchObject({
				code: 'DRIVER',
				message: 'Stored JSON metadata is invalid',
				context: { path, aspect: 'metadata', cause: { code: 'VALIDATION' } },
			})
			expect(JSON.stringify(error)).not.toContain('payload-secret')
			expect(await readFile(path, 'utf-8')).toBe(contents)
			await expect(reopened.keys('users')).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await reopened.close()
		},
	)

	it('serializes the exact { metadata, tables } shape once stamped', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const metadata = { version: 1, schema: SCHEMA }
		await driver.stamp?.(metadata)
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			metadata,
			tables: { users: [{ id: 'u1', name: 'Ada', age: 36, active: true }], posts: [] },
		})
	})

	it('serializes without a metadata key while unstamped', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const raw = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(raw)
		expect(parsed).toEqual({
			tables: { users: [{ id: 'u1', name: 'Ada', age: 36, active: true }], posts: [] },
		})
		expect(isRecord(parsed) ? Object.keys(parsed) : []).not.toContain('metadata')
	})
})

describe('JSONDriver — versioned Database reopen', () => {
	it('hydrates the deployed schema, removes a table atomically, and makes equal-version reopen a no-op', async () => {
		await driver.close()
		const version1 = createDatabase({
			driver: createJSONDriver(path),
			tables: {
				users: { id: stringShape(), name: stringShape() },
				audit: { id: stringShape(), event: stringShape() },
			},
			version: 1,
		})
		await version1.open()
		await version1.table('users').set({ id: 'u1', name: 'Ada' })
		await version1.table('audit').set({ id: 'a1', event: 'created' })
		await version1.close()

		const version2 = createDatabase({
			driver: createJSONDriver(path),
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 2,
		})
		await version2.open()
		expect(await version2.table('users').get('u1')).toEqual({ id: 'u1', name: 'Ada' })
		const migrated = await readFile(path, 'utf-8')
		const parsed: unknown = JSON.parse(migrated)
		expect(parsed).toMatchObject({
			metadata: { version: 2 },
			tables: { users: [{ id: 'u1', name: 'Ada' }] },
		})
		if (!isRecord(parsed) || !isRecord(parsed.tables)) {
			throw new Error('Expected a persisted JSON database document')
		}
		expect(Object.keys(parsed.tables)).toEqual(['users'])
		await version2.close()

		const same = createDatabase({
			driver: createJSONDriver(path),
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 2,
		})
		await same.open()
		await same.close()
		expect(await readFile(path, 'utf-8')).toBe(migrated)
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
		const writing = blocked.write('users', 'u1', {
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		const reading = blocked.read('users', 'u1')
		const error = await writing.catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.path : undefined).toBe(driverPath)
		expect(isDatabaseError(error) ? error.context?.cause : undefined).toBeInstanceOf(Error)
		expect(isDatabaseError(error) ? error.context?.temp : undefined).toBeUndefined()
		expect(isDatabaseError(error) ? error.context?.cleanup : undefined).toBeUndefined()
		expect(await reading).toBeUndefined()
		expect(await blocked.read('users', 'u1')).toBeUndefined()
		await blocked.close()
		temp.cleanup()
	})

	it('restores memory and removes the temp file when the atomic rename fails', async () => {
		const temp = tempDatabasePath()
		await mkdir(dirname(temp.path), { recursive: true })
		await writeFile(temp.path, JSON.stringify({ tables: { users: [], posts: [] } }), 'utf-8')
		const blocked = createJSONDriver(temp.path)
		await blocked.open(SCHEMA)
		await rm(temp.path)
		await mkdir(temp.path)
		await expect(
			blocked.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true }),
		).rejects.toMatchObject({ code: 'DRIVER' })
		expect(await blocked.read('users', 'u1')).toBeUndefined()
		const entries = await readdir(dirname(temp.path))
		expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false)
		await blocked.close()
		temp.cleanup()
	})

	it('reports distinct persistence and cleanup faults while restoring memory and recovering', async () => {
		const temp = `${path}.${process.pid}.1.tmp`
		await mkdir(temp)
		let error: unknown
		try {
			error = await driver
				.write('users', 'u1', {
					id: 'u1',
					name: 'Ada',
					age: 36,
					active: true,
				})
				.catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
			expect(isDatabaseError(error) ? error.context?.path : undefined).toBe(path)
			expect(isDatabaseError(error) ? error.context?.temp : undefined).toBe(temp)
			const cause = isDatabaseError(error) ? error.context?.cause : undefined
			const cleanupError = isDatabaseError(error) ? error.context?.cleanup : undefined
			expect(cause).toBeInstanceOf(Error)
			expect(cleanupError).toBeInstanceOf(Error)
			expect(cause).not.toBe(cleanupError)
			expect(error).not.toBe(cause)
			expect(error).not.toBe(cleanupError)
			expect(await driver.read('users', 'u1')).toBeUndefined()
		} finally {
			await rm(temp, { force: true, recursive: true })
		}

		await driver.write('users', 'u2', {
			id: 'u2',
			name: 'Recovered',
			age: 37,
			active: true,
		})
		expect(await driver.read('users', 'u2')).toEqual({
			id: 'u2',
			name: 'Recovered',
			age: 37,
			active: true,
		})
		await driver.close()
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
	it('rejects an aborted queued write promptly and never starts it later', async () => {
		const first = driver.write('users', 'u1', {
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		const controller = new AbortController()
		const queued = driver.write(
			'users',
			'u2',
			{ id: 'u2', name: 'Bo', age: 22, active: false },
			{ signal: controller.signal },
		)
		controller.abort('stop queued write')
		await expect(queued).rejects.toMatchObject({ code: 'ABORTED' })
		await first
		expect(await driver.keys('users')).toEqual(['u1'])
	})

	it('rolls speculative memory back before rejecting an active staging abort', async () => {
		await driver.write('users', 'u1', {
			id: 'u1',
			name: 'Before',
			age: 36,
			active: true,
		})
		const controller = new AbortController()
		const writing = driver.write(
			'users',
			'u1',
			{
				id: 'u1',
				name: 'After',
				age: 37,
				active: false,
				get meta() {
					controller.abort('stop staging')
					return { payload: 'staged' }
				},
			},
			{ signal: controller.signal },
		)
		await expect(writing).rejects.toMatchObject({ code: 'ABORTED' })
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Before',
			age: 36,
			active: true,
		})
		const entries = await readdir(dirname(path))
		expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false)
	})

	it('serializes concurrent writers without letting an older snapshot clobber a later row', async () => {
		await Promise.all([
			driver.write('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
				meta: { payload: 'x'.repeat(1024 * 1024) },
			}),
			driver.write('users', 'u2', {
				id: 'u2',
				name: 'Bo',
				age: 22,
				active: false,
			}),
		])
		const reopened = createJSONDriver(path)
		await reopened.open(SCHEMA)
		expect(await reopened.keys('users')).toEqual(['u1', 'u2'])
		await reopened.close()
	})

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
