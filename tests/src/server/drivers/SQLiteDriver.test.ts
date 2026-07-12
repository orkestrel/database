import type {
	AggregateFunction,
	Criteria,
	MigrationStep,
	Row,
	TableSchema,
	TransactionInterface,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import {
	applyCriteria,
	computeAggregate,
	createDatabase,
	createMemoryDriver,
	isDatabaseError,
} from '@src/core'
import { createSQLiteDriver } from '@src/server'
import { booleanShape, integerShape, stringShape } from '@orkestrel/contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCondition, collectRows, conformDriver } from '../../../setup.js'
import { driverSchema, tempDatabasePath } from '../../../setupServer.js'

// The SQLite driver's DriverInterface primitives over a real SQLite database
// (`:memory:` and temp files, no mocks, AGENTS §16): the shared conformance
// battery, keyed CRUD, codec round-trips, the CLOSED gate, native aggregate,
// snapshot, migrate atomicity, meta/stamp persistence, a native transaction
// through both the driver directly and the core `Database.transaction`, stream
// laziness, and trusted-parity spot checks against the core engine.

conformDriver('SQLiteDriver', () => createSQLiteDriver())

// The shared driver-conformance schema — `users` (one of each codec-relevant
// column type) + a non-`id` primary `posts` table — see `driverSchema` in
// setupServer (AGENTS §16.1). The SQLite battery additionally builds a
// composite `['age', 'name']` index on `users`.
const SCHEMA = driverSchema({ indexes: [['name'], ['age', 'name']] })

let driver = createSQLiteDriver()

beforeEach(async () => {
	driver = createSQLiteDriver()
	await driver.open(SCHEMA)
})

afterEach(async () => {
	await driver.close()
})

describe('SQLiteDriver — open', () => {
	it('creates a table and its declared indexes', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
	})

	it('reopens without error and readies the tables (CREATE TABLE IF NOT EXISTS)', async () => {
		await driver.open(SCHEMA)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await driver.keys('posts')).toEqual([])
	})
})

describe('SQLiteDriver — keyed CRUD', () => {
	it('writes (upsert) and reads a row back', async () => {
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

	it('reports whether a delete removed a row via changes', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await driver.delete('users', 'u1')).toBe(true)
		expect(await driver.delete('users', 'u1')).toBe(false)
		expect(await driver.read('users', 'u1')).toBeUndefined()
	})

	it('lists keys in order and clears the table', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Bo', age: 22, active: false })
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
		await driver.clear('users')
		expect(await driver.keys('users')).toEqual([])
	})

	it('keys a table by its non-id primary column', async () => {
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		expect(await driver.keys('posts')).toEqual(['intro'])
		expect(await driver.read('posts', 'intro')).toEqual({ slug: 'intro', title: 'Intro' })
	})
})

describe('SQLiteDriver — codec round-trips', () => {
	it('round-trips a boolean column through 1 / 0', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'On', age: 1, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Off', age: 2, active: false })
		expect((await driver.read('users', 'u1'))?.active).toBe(true)
		expect((await driver.read('users', 'u2'))?.active).toBe(false)
	})

	it('round-trips a nested object through a json column', async () => {
		const meta = { tags: ['a', 'b'], info: { score: 9, ok: true } }
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true, meta })
		expect((await driver.read('users', 'u1'))?.meta).toEqual(meta)
	})
})

describe('SQLiteDriver — CLOSED gate', () => {
	it('throws CLOSED before open', async () => {
		const closed = createSQLiteDriver()
		await expect(closed.read('users', 'u1')).rejects.toMatchObject({ code: 'CLOSED' })
	})

	it('throws CLOSED after close', async () => {
		await driver.close()
		await expect(driver.read('users', 'u1')).rejects.toMatchObject({ code: 'CLOSED' })
	})
})

describe('SQLiteDriver — native aggregate', () => {
	const ACTIVE: Criteria = {
		conditions: [{ column: 'active', operator: 'equals', values: [true], connector: 'and' }],
	}
	const NONE: Criteria = {
		conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
	}

	async function runAggregate(
		operation: AggregateFunction,
		column: FieldPath,
		criteria: Criteria,
	): Promise<number | undefined> {
		const hook = driver.aggregate
		if (hook === undefined) throw new Error('SQLiteDriver is missing its native aggregate hook')
		return hook.call(driver, 'users', operation, column, criteria)
	}

	beforeEach(async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Alan', age: 41, active: false })
		await driver.write('users', 'u3', { id: 'u3', name: 'Edsger', age: 50, active: true })
		await driver.write('users', 'u4', { id: 'u4', name: 'Grace', age: 22, active: false })
	})

	it('counts all matched rows with COUNT(*) — including over no conditions', async () => {
		expect(await runAggregate('count', 'age', {})).toBe(4)
		expect(await runAggregate('count', 'age', ACTIVE)).toBe(2)
	})

	it('sums, averages, and takes the min/max of a numeric column', async () => {
		expect(await runAggregate('sum', 'age', {})).toBe(149)
		expect(await runAggregate('average', 'age', ACTIVE)).toBe(43)
		expect(await runAggregate('minimum', 'age', {})).toBe(22)
		expect(await runAggregate('maximum', 'age', ACTIVE)).toBe(50)
	})

	it('over zero matched rows: count is 0, the numeric aggregates are undefined', async () => {
		expect(await runAggregate('count', 'age', NONE)).toBe(0)
		expect(await runAggregate('sum', 'age', NONE)).toBeUndefined()
	})
})

describe('SQLiteDriver — snapshot', () => {
	it('rolls every table back to the captured state', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		const rollback = await driver.snapshot()
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99, active: false })
		await driver.write('users', 'u2', { id: 'u2', name: 'Ghost', age: 1, active: false })
		await driver.write('posts', 'extra', { slug: 'extra', title: 'Extra' })
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await driver.read('users', 'u2')).toBeUndefined()
		expect(await driver.keys('posts')).toEqual(['intro'])
	})

	it('scoped snapshot(["users"]) leaves other tables untouched', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('posts', 'p1', { slug: 'p1', title: 'Post' })
		const rollback = await driver.snapshot(['users'])
		await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40, active: true })
		await driver.write('posts', 'p2', { slug: 'p2', title: 'Another' })
		await rollback()
		expect(await driver.keys('users')).toEqual(['u1'])
		expect(await driver.keys('posts')).toEqual(['p1', 'p2'])
	})
})

describe('SQLiteDriver — persistence across reopen (temp file)', () => {
	it('survives a close and reopen on the same file', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver(temp.path)
		await onDisk.open(SCHEMA)
		await onDisk.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await onDisk.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		await onDisk.close()

		const reopened = createSQLiteDriver(temp.path)
		await reopened.open(SCHEMA)
		expect(await reopened.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await reopened.read('posts', 'intro')).toEqual({ slug: 'intro', title: 'Intro' })
		await reopened.close()
		temp.cleanup()
	})
})

describe('SQLiteDriver — migrate', () => {
	// `migrate` is destructured off `driver` and invoked with `.call(driver, …)` —
	// it is a `#`-private-backed method, so an unbound call loses `this`.
	async function runMigrate(plan: {
		readonly from: number
		readonly to: number
		readonly steps: readonly MigrationStep[]
	}): Promise<void> {
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its native migrate hook')
		return migrate.call(driver, plan)
	}

	// `age` participates in the SCHEMA's composite `['age', 'name']` index, and
	// SQLite's `ALTER TABLE … DROP COLUMN` refuses to drop an indexed column
	// (a real engine constraint, not a driver defect) — these steps drop
	// `active`, which carries no index, to exercise DROP COLUMN cleanly.
	it('applies a column.remove step that strips the real SQLite column from stored rows', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const step: MigrationStep = { operation: 'column.remove', table: 'users', column: 'active' }
		await runMigrate({ from: 0, to: 1, steps: [step] })
		const row = await driver.read('users', 'u1')
		expect(row).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(row && 'active' in row).toBe(false)
	})

	it('applies a plan atomically inside one native transaction — a mid-plan failure throws MIGRATION and rolls back', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const goodStep: MigrationStep = { operation: 'column.remove', table: 'users', column: 'active' }
		const badStep: MigrationStep = { operation: 'table.remove', table: 'ghost' }
		const error = await runMigrate({ from: 0, to: 1, steps: [goodStep, badStep] }).catch(
			(caught: unknown) => caught,
		)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		// The whole native transaction rolled back — the earlier goodStep never landed.
		const row = await driver.read('users', 'u1')
		expect(row).toEqual({ id: 'u1', name: 'Ada', age: 36, active: true })
	})

	it('throws MIGRATION for a step referencing an unknown table', async () => {
		const error = await runMigrate({
			from: 0,
			to: 1,
			steps: [{ operation: 'table.remove', table: 'ghost' }],
		}).catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
	})
})

describe('SQLiteDriver — meta / stamp across reopen (temp file)', () => {
	it('persists the stamped meta so a reopened driver reads it back', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver(temp.path)
		await onDisk.open(SCHEMA)
		expect(await onDisk.meta?.()).toBeUndefined()
		const stamped = { version: 3, schema: SCHEMA }
		await onDisk.stamp?.(stamped)
		expect(await onDisk.meta?.()).toEqual(stamped)
		await onDisk.close()

		const reopened = createSQLiteDriver(temp.path)
		await reopened.open(SCHEMA)
		expect(await reopened.meta?.()).toEqual(stamped)
		await reopened.close()
		temp.cleanup()
	})
})

describe('SQLiteDriver — native transaction', () => {
	// `transaction` is destructured off `driver` and invoked with `.call(driver)`
	// — it is a `#`-private-backed method, so an unbound call loses `this`.
	async function runTransaction(): Promise<TransactionInterface> {
		const transaction = driver.transaction
		if (transaction === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		return transaction.call(driver)
	}

	it('commit persists writes made during the scope; rollback restores prior state', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })

		const committing = await runTransaction()
		await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40, active: true })
		await committing.commit()
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])

		const rollingBack = await runTransaction()
		await driver.write('users', 'u3', { id: 'u3', name: 'Marie', age: 50, active: true })
		await rollingBack.rollback()
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
	})

	it('throws CONFLICT on a double commit or a rollback after commit', async () => {
		const handle = await runTransaction()
		await handle.commit()
		const doubleCommit = await handle.commit().catch((caught: unknown) => caught)
		expect(isDatabaseError(doubleCommit) ? doubleCommit.code : 'not-database').toBe('CONFLICT')

		const other = await runTransaction()
		await other.commit()
		const rollbackAfterCommit = await other.rollback().catch((caught: unknown) => caught)
		expect(isDatabaseError(rollbackAfterCommit) ? rollbackAfterCommit.code : 'not-database').toBe(
			'CONFLICT',
		)
	})

	it('runs a real native transaction through Database.transaction (commit + rollback)', async () => {
		// A dedicated driver + database (not the shared fixture `driver`): letting
		// `Database` own `open()` derives the schema from `tables`, which would
		// otherwise clash with the fixture's own already-open SCHEMA.
		const users = {
			id: stringShape(),
			name: stringShape(),
			age: integerShape(),
			active: booleanShape(),
		}
		const database = createDatabase({
			driver: createSQLiteDriver(),
			name: 'app',
			tables: { users },
		})
		const table = database.table('users')
		await table.set({ id: 'u1', name: 'Ada', age: 36, active: true })

		await database.transaction(async () => {
			await table.set({ id: 'u2', name: 'Grace', age: 40, active: true })
		})
		expect([...(await table.keys())].sort()).toEqual(['u1', 'u2'])

		const thrown = new Error('boom')
		await expect(
			database.transaction(async () => {
				await table.set({ id: 'u3', name: 'Marie', age: 50, active: true })
				throw thrown
			}),
		).rejects.toBe(thrown)
		expect([...(await table.keys())].sort()).toEqual(['u1', 'u2'])
		await database.close()
	})
})

describe('SQLiteDriver — migrate joined into an enclosing native transaction', () => {
	// The regression: `migrate` must NOT open its own native transaction when the
	// caller already has one open (Database's versioned reconcile / #apply path) —
	// node:sqlite rejects a nested `BEGIN`.
	it('runs migrate directly inside an already-open driver.transaction() handle (no nested BEGIN)', async () => {
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its native migrate hook')
		const transaction = driver.transaction
		if (transaction === undefined) throw new Error('SQLiteDriver is missing its transaction hook')

		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const handle = await transaction.call(driver)
		const step: MigrationStep = { operation: 'column.remove', table: 'users', column: 'active' }
		await migrate.call(driver, { from: 0, to: 1, steps: [step] })
		await handle.commit()

		const row = await driver.read('users', 'u1')
		expect(row).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(row && 'active' in row).toBe(false)
	})

	it('versioned reconcile survives a real reopen at a new version with a dropped column', async () => {
		const temp = tempDatabasePath()
		const v1Users = {
			id: stringShape(),
			name: stringShape(),
			age: integerShape(),
			active: booleanShape(),
		}
		const v1 = createDatabase({
			driver: createSQLiteDriver(temp.path),
			name: 'versioned',
			tables: { users: v1Users },
			version: 1,
		})
		const v1Table = v1.table('users')
		await v1Table.set({ id: 'u1', name: 'Ada', age: 36, active: true })
		await v1.close()

		const v2Users = { id: stringShape(), name: stringShape(), age: integerShape() }
		const v2 = createDatabase({
			driver: createSQLiteDriver(temp.path),
			name: 'versioned',
			tables: { users: v2Users },
			version: 2,
		})
		const v2Table = v2.table('users')
		await v2.open()
		const row = await v2Table.get('u1')
		expect(row).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(row && 'active' in row).toBe(false)
		await v2.close()

		// A second reopen at the same declared version is a no-op reconcile.
		const v2Again = createDatabase({
			driver: createSQLiteDriver(temp.path),
			name: 'versioned',
			tables: { users: v2Users },
			version: 2,
		})
		await v2Again.open()
		const rowAgain = await v2Again.table('users').get('u1')
		expect(rowAgain).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		await v2Again.close()

		temp.cleanup()
	})
})

describe('SQLiteDriver — stream laziness', () => {
	it('breaking out of a stream early yields only the consumed rows and leaves the driver usable', async () => {
		for (const id of ['a', 'b', 'c', 'd', 'e']) {
			await driver.write('users', id, { id, name: id, age: 10, active: true })
		}
		const collected: string[] = []
		for await (const row of driver.stream?.('users', {}) ?? []) {
			const id = row.id
			if (typeof id === 'string') collected.push(id)
			if (collected.length === 1) break
		}
		expect(collected).toEqual(['a'])
		// The driver is still fully usable after the early break — no leaked lock/state.
		await driver.write('users', 'z', { id: 'z', name: 'Z', age: 99, active: true })
		expect(await driver.read('users', 'z')).toEqual({ id: 'z', name: 'Z', age: 99, active: true })
	})
})

describe('SQLiteDriver — trusted-query parity vs the core engine', () => {
	// Seed the memory driver (the reference engine) and the SQLite driver with
	// identical rows, then compare native SQLite reads against the engine's
	// applyCriteria / computeAggregate over an equivalent scan.
	const META_SCHEMA: readonly TableSchema[] = [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', type: 'text', nullable: false },
				{ name: 'name', type: 'text', nullable: false },
				{ name: 'age', type: 'integer', nullable: false },
				{ name: 'active', type: 'boolean', nullable: false },
				{ name: 'meta', type: 'json', nullable: true },
			],
			indexes: [],
		},
	]

	const ROWS = [
		{ id: 'u1', name: 'Ada', age: 36, active: true, meta: { score: 9 } },
		{ id: 'u2', name: 'Alan', age: 41, active: false, meta: { score: 3 } },
		{ id: 'u3', name: 'Edsger', age: 50, active: true, meta: { score: 7 } },
		{ id: 'u4', name: 'Grace', age: 22, active: false, meta: { score: 5 } },
	]

	const memory = createMemoryDriver()
	let sqlite = createSQLiteDriver()

	beforeEach(async () => {
		await memory.open(META_SCHEMA)
		sqlite = createSQLiteDriver()
		await sqlite.open(META_SCHEMA)
		for (const row of ROWS) {
			await memory.write('users', row.id, row)
			await sqlite.write('users', row.id, row)
		}
	})

	afterEach(async () => {
		await sqlite.close()
	})

	async function engineRows(criteria: Criteria): Promise<readonly Row[]> {
		return applyCriteria(await collectRows(memory.scan('users')), criteria)
	}

	it('matches the engine over a nested (json_extract) equals condition', async () => {
		const criteria: Criteria = {
			conditions: [buildCondition(['meta', 'score'], 'above', [4])],
		}
		const expected = (await engineRows(criteria)).map((row) => row.id)
		const native = sqlite.records === undefined ? [] : await sqlite.records('users', criteria)
		expect(native.map((row) => row.id).sort()).toEqual([...expected].sort())
	})

	it('matches the engine over an order + page mix', async () => {
		const criteria: Criteria = {
			order: [{ column: 'age', direction: 'descending' }],
			limit: 2,
			offset: 1,
		}
		const expected = (await engineRows(criteria)).map((row) => row.id)
		const native = sqlite.records === undefined ? [] : await sqlite.records('users', criteria)
		expect(native.map((row) => row.id)).toEqual(expected)
	})

	it('matches the engine aggregate (average) over a filtered set', async () => {
		const criteria: Criteria = {
			conditions: [buildCondition('active', 'equals', [true])],
		}
		const expectedRows = await engineRows(criteria)
		const expected = computeAggregate(expectedRows, 'average', 'age')
		const native =
			sqlite.aggregate === undefined
				? undefined
				: await sqlite.aggregate('users', 'average', 'age', criteria)
		expect(native).toBe(expected)
	})
})

describe('SQLiteDriver — NULL-column trusted-query parity (three-valued-logic fix)', () => {
	// The regression this covers: SQL's three-valued NULL logic diverges from
	// the core engine's total order (undefined < null < boolean < number <
	// string — `compareValues`), where a missing/NULL column MATCHES `below` /
	// `to` / a scalar `not` / `none`. A NULLABLE flat `rank` column (some rows
	// omit it entirely, so SQLite stores NULL) plus a nested `meta.note` path
	// (some rows a present JSON `null`, some absent entirely) exercise every
	// rewritten operator against the shared engine oracle (`applyCriteria` /
	// `computeAggregate` over the memory driver's scan).
	const NULL_SCHEMA: readonly TableSchema[] = [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', type: 'text', nullable: false },
				{ name: 'rank', type: 'integer', nullable: true },
				{ name: 'meta', type: 'json', nullable: true },
			],
			indexes: [],
		},
	]

	// u1: rank present, meta.note present-null. u2: rank ABSENT (SQL NULL),
	// meta.note present-null. u3: rank present, meta.note ABSENT (key missing).
	// u4: rank ABSENT, meta ABSENT entirely (both column-null and path-absent).
	const NULL_ROWS = [
		{ id: 'u1', rank: 10, meta: { note: null, tag: 'a' } },
		{ id: 'u2', meta: { note: null, tag: 'b' } },
		{ id: 'u3', rank: 20, meta: { tag: 'c' } },
		{ id: 'u4' },
	]

	const memory = createMemoryDriver()
	let sqlite = createSQLiteDriver()

	beforeEach(async () => {
		await memory.open(NULL_SCHEMA)
		sqlite = createSQLiteDriver()
		await sqlite.open(NULL_SCHEMA)
		for (const row of NULL_ROWS) {
			await memory.write('users', row.id, row)
			await sqlite.write('users', row.id, row)
		}
	})

	afterEach(async () => {
		await sqlite.close()
	})

	async function engineRows(criteria: Criteria): Promise<readonly Row[]> {
		return applyCriteria(await collectRows(memory.scan('users')), criteria)
	}

	async function nativeIds(criteria: Criteria): Promise<readonly string[]> {
		const rows = sqlite.records === undefined ? [] : await sqlite.records('users', criteria)
		return rows.map((row) => String(row.id)).sort()
	}

	async function expectedIds(criteria: Criteria): Promise<readonly string[]> {
		return (await engineRows(criteria)).map((row) => String(row.id)).sort()
	}

	it('below on a nullable flat column matches the engine (absent column ranks below every scalar)', async () => {
		const criteria: Criteria = { conditions: [buildCondition('rank', 'below', [15])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
	})

	it('to on a nullable flat column matches the engine', async () => {
		const criteria: Criteria = { conditions: [buildCondition('rank', 'to', [10])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
	})

	it('a scalar not on a nullable flat column matches the engine (absent column also matches)', async () => {
		const criteria: Criteria = { conditions: [buildCondition('rank', 'not', [10])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
	})

	it('a null-operand not on a flat column matches every row (the engine oracle)', async () => {
		const criteria: Criteria = { conditions: [buildCondition('rank', 'not', [null])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
		expect(await nativeIds(criteria)).toEqual(['u1', 'u2', 'u3', 'u4'])
	})

	it('none on a nullable flat column matches the engine (absent column also matches)', async () => {
		const criteria: Criteria = { conditions: [buildCondition('rank', 'none', [10, 20])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
	})

	it('a nested equals(null) matches only present-JSON-null, not an absent path', async () => {
		const criteria: Criteria = { conditions: [buildCondition(['meta', 'note'], 'equals', [null])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
		expect(await nativeIds(criteria)).toEqual(['u1', 'u2'])
	})

	it('a nested not(null) matches an absent path or a present scalar, excluding present-null', async () => {
		const criteria: Criteria = { conditions: [buildCondition(['meta', 'note'], 'not', [null])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
	})

	it('a nested below matches the engine (absent path and present-null both rank below a scalar)', async () => {
		const criteria: Criteria = { conditions: [buildCondition(['meta', 'tag'], 'below', ['b'])] }
		expect(await nativeIds(criteria)).toEqual(await expectedIds(criteria))
	})

	it('count matches the engine over a below-filtered nullable column', async () => {
		const criteria: Criteria = { conditions: [buildCondition('rank', 'below', [15])] }
		const expected = (await engineRows(criteria)).length
		const native =
			sqlite.aggregate === undefined ? undefined : await sqlite.aggregate('users', 'count', 'rank', criteria)
		expect(native).toBe(expected)
	})

	it('sum over a nullable rank column, below-filtered, matches the engine aggregate', async () => {
		const criteria: Criteria = { conditions: [buildCondition('rank', 'below', [25])] }
		const expectedRows = await engineRows(criteria)
		const expected = computeAggregate(expectedRows, 'sum', 'rank')
		const native =
			sqlite.aggregate === undefined ? undefined : await sqlite.aggregate('users', 'sum', 'rank', criteria)
		expect(native).toBe(expected)
	})
})
