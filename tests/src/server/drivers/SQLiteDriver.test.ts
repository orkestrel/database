import type {
	AggregateOperation,
	ColumnSchema,
	Condition,
	DriverInterface,
	QueryInput,
	DriverMetadata,
	MigrationStep,
	Row,
	TableSchema,
	StorageInterface,
} from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import {
	applyQuery,
	computeAggregate,
	createDatabase,
	createMemoryDriver,
	isDatabaseError,
	planMigration,
} from '@src/core'
import { createSQLiteDriver, schemaToIndexes, schemaToTable } from '@src/server'
import {
	booleanShape,
	integerShape,
	nullableShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'
import { createSQLiteDatabase, isSQLiteError } from '@orkestrel/sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCondition, collectRows, conformDriver, recordEmitterEvents } from '../../../setup.js'
import {
	createForeignKeyFixture,
	driverSchema,
	replaceTransactionFailure,
	tempDatabasePath,
} from '../../../setupServer.js'

// The SQLite driver's DriverInterface primitives over a real SQLite database
// (`:memory:` and temp files, no mocks, AGENTS §16): the shared conformance
// battery, keyed CRUD, codec round-trips, the CLOSED gate, native aggregate,
// snapshot, migrate atomicity, metadata/stamp persistence, a native transaction
// through both the driver directly and the core `Database.transaction`, stream
// laziness, and trusted-parity spot checks against the core engine.

conformDriver('SQLiteDriver', () => createSQLiteDriver())

// The shared driver-conformance schema — `users` (one of each codec-relevant
// column type) + a non-`id` primary `posts` table — see `driverSchema` in
// setupServer (AGENTS §16.1). The SQLite battery additionally builds a
// composite `['age', 'name']` index on `users`.
const SCHEMA = driverSchema({ indexes: [['name'], ['age', 'name']] })
const USERS_SQL =
	'CREATE TABLE "users" (' +
	'"id" TEXT NOT NULL, "name" TEXT NOT NULL, "age" INTEGER NOT NULL, ' +
	'"active" INTEGER NOT NULL, "meta" TEXT, PRIMARY KEY ("id"))'
const POSTS_SQL =
	'CREATE TABLE "posts" ("slug" TEXT NOT NULL, "title" TEXT NOT NULL, PRIMARY KEY ("slug"))'

type SQLiteDriver = ReturnType<typeof createSQLiteDriver>

async function rejectPhysicalOpen(
	statements: readonly string[],
	schema: readonly TableSchema[] = SCHEMA,
): Promise<readonly [unknown, unknown]> {
	const temp = tempDatabasePath()
	const native = createSQLiteDatabase({ path: temp.path })
	const target = createSQLiteDriver({ path: temp.path })
	try {
		native.connect()
		for (const statement of statements) native.exec(statement)
		native.close()
		const opened = await target.open(schema).catch((caught: unknown) => caught)
		const after = await target.keys(schema[0]?.name ?? 'missing').catch((caught: unknown) => caught)
		return [opened, after]
	} finally {
		native.close()
		await target.close()
		temp.cleanup()
	}
}

async function computeSQLiteAggregate(
	target: SQLiteDriver,
	operation: AggregateOperation,
	column: FieldPath,
	input: QueryInput,
): Promise<number | undefined> {
	const hook = target.aggregate
	if (hook === undefined) throw new Error('SQLiteDriver is missing its native aggregate hook')
	return hook.call(target, 'users', operation, column, input)
}

async function collectEngineRows(
	target: DriverInterface,
	input: QueryInput,
): Promise<readonly Row[]> {
	return applyQuery(await collectRows(target.scan('users')), input)
}

async function collectSQLiteIds(
	target: SQLiteDriver,
	input: QueryInput,
): Promise<readonly string[]> {
	const rows = target.records === undefined ? [] : await target.records('users', input)
	return rows.map((row) => String(row.id)).sort()
}

async function collectExpectedIds(
	target: DriverInterface,
	input: QueryInput,
): Promise<readonly string[]> {
	return (await collectEngineRows(target, input)).map((row) => String(row.id)).sort()
}

async function collectSQLiteRecords(
	target: SQLiteDriver,
	table: string,
	input: QueryInput,
): Promise<readonly Row[]> {
	const hook = target.records
	if (hook === undefined) throw new Error('SQLiteDriver is missing its native records hook')
	return hook.call(target, table, input)
}

let driver = createSQLiteDriver()

beforeEach(async () => {
	driver = createSQLiteDriver()
	await driver.open(SCHEMA)
})

afterEach(async () => {
	await driver.close()
})

describe('SQLiteDriver — open', () => {
	it('supports an explicit Database migration before the lazy open lifecycle', async () => {
		const database = createDatabase({
			driver: createSQLiteDriver(),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const plan = await database.migrate([])
		expect(plan.steps).toEqual([
			{
				operation: 'table.add',
				table: {
					name: 'users',
					primary: 'id',
					columns: [
						{ name: 'id', storage: 'text', optional: false, nullable: false },
						{ name: 'name', storage: 'text', optional: false, nullable: false },
					],
					indexes: [],
				},
			},
		])
		await database.table('users').set({ id: 'u1', name: 'Ada' })
		expect(await database.table('users').get('u1')).toEqual({ id: 'u1', name: 'Ada' })
		await database.close()
	})

	it('shares imported schema, guards before paging, and preserves primary identity across reopen', async () => {
		const temp = tempDatabasePath()
		const firstDriver = createSQLiteDriver({ path: temp.path })
		const first = createDatabase({
			driver: firstDriver,
			tables: { users: { id: stringShape(), name: stringShape({ min: 1 }) } },
			version: 1,
		})
		const logs = first.import({ logs: { id: stringShape(), message: stringShape() } })
		const users = first.table('users')
		try {
			await first.open()
			await firstDriver.write('users', 'a', { id: 'a', name: '' })
			await firstDriver.write('users', 'b', { id: 'b', name: 'Valid' })
			await logs.table('logs').set({ id: 'l1', message: 'started' })
			expect(await users.records({ limit: 1 })).toEqual([{ id: 'b', name: 'Valid' }])
			expect(await collectRows(users.scan({ limit: 1 }))).toEqual([{ id: 'b', name: 'Valid' }])
			expect(await users.count()).toBe(1)
			const diagnostic = await users
				.set({ id: 'payload-secret', name: '' })
				.catch((caught: unknown) => caught)
			expect(JSON.stringify(diagnostic)).not.toContain('payload-secret')
			await expect(users.update('b', { id: 'moved' })).rejects.toMatchObject({
				code: 'VALIDATION',
			})
			expect(await users.update('b', { id: 'b', name: 'Updated' })).toBe(true)
			await first.close()

			const reopenedDriver = createSQLiteDriver({ path: temp.path })
			try {
				const reopened = createDatabase({
					driver: reopenedDriver,
					tables: { users: { id: stringShape(), name: stringShape({ min: 1 }) } },
					version: 1,
				})
				const reopenedLogs = reopened.import({
					logs: { id: stringShape(), message: stringShape() },
				})
				await reopened.open()
				expect(await reopened.table('users').get('b')).toEqual({ id: 'b', name: 'Updated' })
				expect(await reopenedLogs.table('logs').get('l1')).toEqual({
					id: 'l1',
					message: 'started',
				})
			} finally {
				await reopenedDriver.close()
			}
		} finally {
			await firstDriver.close()
			temp.cleanup()
		}
	})

	it('creates a table and its declared indexes', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
	})

	it('rejects a persisted column whose SQLite affinity differs from the declaration', async () => {
		const temp = tempDatabasePath()
		const native = createSQLiteDatabase({ path: temp.path })
		const opened = createSQLiteDriver({ path: temp.path })
		try {
			native.connect()
			native.exec(
				'CREATE TABLE "users" (' +
					'"id" TEXT NOT NULL, "name" TEXT NOT NULL, "age" TEXT NOT NULL, ' +
					'"active" INTEGER NOT NULL, "meta" TEXT, PRIMARY KEY ("id"))',
			)
			native.close()
			const error = await opened.open(SCHEMA).catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
			expect(isDatabaseError(error) ? error.context?.aspect : undefined).toBe('column')
		} finally {
			native.close()
			await opened.close()
			temp.cleanup()
		}
	})

	it('rejects an undeclared trigger on a persisted table', async () => {
		const temp = tempDatabasePath()
		const first = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		const reopened = createSQLiteDriver({ path: temp.path })
		try {
			await first.open(SCHEMA)
			await first.close()
			native.connect()
			native.exec(
				'CREATE TRIGGER "users_guard" BEFORE INSERT ON "users" ' +
					"BEGIN SELECT RAISE(ABORT, 'guarded'); END",
			)
			native.close()
			const error = await reopened.open(SCHEMA).catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
			expect(isDatabaseError(error) ? error.context?.aspect : undefined).toBe('trigger')
		} finally {
			native.close()
			await first.close()
			await reopened.close()
			temp.cleanup()
		}
	})

	it('rejects a declared index name whose physical columns differ', async () => {
		const temp = tempDatabasePath()
		const first = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		const reopened = createSQLiteDriver({ path: temp.path })
		try {
			await first.open(SCHEMA)
			await first.close()
			native.connect()
			native.exec('DROP INDEX "idx_5_users_4_name"')
			native.exec('CREATE INDEX "idx_5_users_4_name" ON "users" ("age")')
			native.close()
			const error = await reopened.open(SCHEMA).catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
			expect(isDatabaseError(error) ? error.context?.aspect : undefined).toBe('index')
		} finally {
			native.close()
			await first.close()
			await reopened.close()
			temp.cleanup()
		}
	})

	it('atomically recreates a missing declared index during open', async () => {
		const temp = tempDatabasePath()
		const first = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		const reopened = createSQLiteDriver({ path: temp.path })
		try {
			await first.open(SCHEMA)
			await first.close()
			native.connect()
			native.exec('DROP INDEX "idx_5_users_4_name"')
			native.close()
			await reopened.open(SCHEMA)
			await reopened.close()
			native.connect()
			const index = native
				.prepare('SELECT "name" FROM "sqlite_schema" WHERE "type" = ? AND "name" = ?')
				.get(['index', 'idx_5_users_4_name'])
			expect(index?.name).toBe('idx_5_users_4_name')
		} finally {
			native.close()
			await first.close()
			await reopened.close()
			temp.cleanup()
		}
	})

	it('rejects a physical table with a missing column', async () => {
		const [error, after] = await rejectPhysicalOpen([
			'CREATE TABLE "users" (' +
				'"id" TEXT NOT NULL, "name" TEXT NOT NULL, "age" INTEGER NOT NULL, ' +
				'"active" INTEGER NOT NULL, PRIMARY KEY ("id"))',
		])
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.aspect : undefined).toBe('columns')
		expect(isDatabaseError(error) ? error.context?.actual : undefined).not.toContain('meta')
		expect(isDatabaseError(after) ? after.code : 'not-database').toBe('CLOSED')
	})

	it('rejects a physical table with an extra column', async () => {
		const [error] = await rejectPhysicalOpen([
			USERS_SQL.replace(', PRIMARY KEY ("id"))', ', "legacy" TEXT, PRIMARY KEY ("id"))'),
		])
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.actual : undefined).toContain('legacy')
	})

	it('rejects physical required/nullability drift', async () => {
		const [error] = await rejectPhysicalOpen([
			USERS_SQL.replace('"name" TEXT NOT NULL', '"name" TEXT'),
		])
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.column : undefined).toBe('name')
		expect(isDatabaseError(error) ? error.context?.actual : undefined).toMatchObject({ notnull: 0 })
	})

	it('rejects a wrong or compound physical primary key', async () => {
		const [wrong] = await rejectPhysicalOpen([
			USERS_SQL.replace('PRIMARY KEY ("id")', 'PRIMARY KEY ("age")'),
		])
		const [compound] = await rejectPhysicalOpen([
			USERS_SQL.replace('PRIMARY KEY ("id")', 'PRIMARY KEY ("id", "name")'),
		])
		expect(isDatabaseError(wrong) ? wrong.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(compound) ? compound.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(compound) ? compound.context?.column : undefined).toBe('name')
	})

	it('rejects a hidden/generated declared column', async () => {
		const generated: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'name', storage: 'text', optional: false, nullable: false },
				],
				indexes: [],
			},
		]
		const [error] = await rejectPhysicalOpen(
			[
				'CREATE TABLE "users" (' +
					'"id" TEXT NOT NULL, "name" TEXT NOT NULL GENERATED ALWAYS AS ("id") VIRTUAL, ' +
					'PRIMARY KEY ("id"))',
			],
			generated,
		)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.column : undefined).toBe('name')
		expect(isDatabaseError(error) ? error.context?.actual : undefined).toMatchObject({ hidden: 2 })
	})

	it('rejects a view occupying a declared table name', async () => {
		const [error] = await rejectPhysicalOpen([
			'CREATE VIEW "users" AS SELECT ' +
				'\'u1\' AS "id", \'Ada\' AS "name", 36 AS "age", 1 AS "active", NULL AS "meta"',
		])
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.aspect : undefined).toBe('object')
		expect(isDatabaseError(error) ? error.context?.actual : undefined).toBe('view')
	})

	it('rejects an undeclared extra unique index', async () => {
		const [error] = await rejectPhysicalOpen([
			USERS_SQL,
			'CREATE UNIQUE INDEX "users_unique_age" ON "users" ("age")',
		])
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.actual : undefined).toBe('users_unique_age')
	})

	it('rejects a deterministic declared index when its physical form is partial', async () => {
		const [error] = await rejectPhysicalOpen([
			USERS_SQL,
			'CREATE INDEX "idx_5_users_4_name" ON "users" ("name") WHERE "name" <> \'\'',
			'CREATE INDEX "idx_5_users_3_age_4_name" ON "users" ("age", "name")',
		])
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(error) ? error.context?.index : undefined).toBe('idx_5_users_4_name')
		expect(isDatabaseError(error) ? error.context?.actual : undefined).toMatchObject({ partial: 1 })
	})

	it('tolerates an extra nonunique legacy index and an extra table', async () => {
		const temp = tempDatabasePath()
		const native = createSQLiteDatabase({ path: temp.path })
		const target = createSQLiteDriver({ path: temp.path })
		try {
			native.connect()
			native.exec(USERS_SQL)
			native.exec(POSTS_SQL)
			native.exec('CREATE INDEX "users_legacy_age" ON "users" ("age")')
			native.exec('CREATE TABLE "legacy" ("id" TEXT PRIMARY KEY)')
			native.close()
			await target.open(SCHEMA)
			expect(await target.keys('users')).toEqual([])
			native.connect()
			expect(
				native
					.prepare('SELECT "name" FROM "sqlite_schema" WHERE "type" = ? AND "name" = ?')
					.get(['table', 'legacy'])?.name,
			).toBe('legacy')
		} finally {
			native.close()
			await target.close()
			temp.cleanup()
		}
	})

	it('rolls back all early table/index creation when a later table mismatches', async () => {
		const temp = tempDatabasePath()
		const native = createSQLiteDatabase({ path: temp.path })
		const target = createSQLiteDriver({ path: temp.path })
		const deployed: readonly TableSchema[] = [
			{
				name: 'missing',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
			{
				name: 'logs',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [['id']],
			},
			{
				name: 'broken',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
		]
		try {
			native.connect()
			native.exec('CREATE TABLE "logs" ("id" TEXT NOT NULL, PRIMARY KEY ("id"))')
			native.exec('CREATE TABLE "broken" ("id" INTEGER NOT NULL, PRIMARY KEY ("id"))')
			native.close()
			const error = await target.open(deployed).catch((caught: unknown) => caught)
			const after = await target.keys('logs').catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
			expect(isDatabaseError(after) ? after.code : 'not-database').toBe('CLOSED')
			native.connect()
			const objects = native
				.prepare('SELECT "name" FROM "sqlite_schema" WHERE "name" IN (?, ?, ?) ORDER BY "name"')
				.all(['missing', 'idx_4_logs_2_id', '_metadata'])
				.map((row) => row.name)
			expect(objects).toEqual([])
		} finally {
			native.close()
			await target.close()
			temp.cleanup()
		}
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

	it('opens the persisted deployed schema without pre-creating a newer declaration', async () => {
		const temp = tempDatabasePath()
		const users = SCHEMA.filter((table) => table.name === 'users')
		const first = createSQLiteDriver({ path: temp.path })
		await first.open(users)
		await first.stamp?.({ version: 1, schema: users })
		await first.close()

		const reopened = createSQLiteDriver({ path: temp.path })
		await reopened.open(SCHEMA)
		const error = await reopened.keys('posts').catch((caught: unknown) => caught)
		const metadata = await reopened.metadata?.()
		await reopened.close()

		const database = createSQLiteDatabase({ path: temp.path })
		database.connect()
		const physical = database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get(['posts'])
		database.close()
		temp.cleanup()

		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('NOT_FOUND')
		expect(metadata).toEqual({ version: 1, schema: users })
		expect(physical).toBeUndefined()
	})

	it('fails closed when persisted metadata names a missing table and retries after repair', async () => {
		const temp = tempDatabasePath()
		const target = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		const users = SCHEMA.find((table) => table.name === 'users')
		if (users === undefined) throw new Error('Expected users schema')
		try {
			await target.open(SCHEMA)
			await target.write('posts', 'intro', { slug: 'intro', title: 'Preserved' })
			await target.stamp?.({ version: 1, schema: SCHEMA })
			await target.close()

			native.connect()
			native.exec('DROP TABLE "users"')
			native.close()

			const error = await target.open(SCHEMA).catch((caught: unknown) => caught)
			expect(error).toMatchObject({
				code: 'DRIVER',
				message: 'Stored SQLite table is missing',
				context: { table: 'users', aspect: 'missing' },
			})
			await expect(target.keys('posts')).rejects.toMatchObject({ code: 'CLOSED' })

			native.connect()
			const absent = native
				.prepare('SELECT "name" FROM "sqlite_schema" WHERE "type" = ? AND "name" = ?')
				.get(['table', 'users'])
			const preserved = native
				.prepare('SELECT "title" FROM "posts" WHERE "slug" = ?')
				.get(['intro'])
			expect(absent).toBeUndefined()
			expect(preserved?.title).toBe('Preserved')
			native.exec(schemaToTable(users))
			for (const sql of schemaToIndexes(users)) native.exec(sql)
			native.close()

			await target.open(SCHEMA)
			expect(await target.read('posts', 'intro')).toEqual({
				slug: 'intro',
				title: 'Preserved',
			})
			await target.write('users', 'u1', {
				id: 'u1',
				name: 'Repaired',
				age: 1,
				active: true,
			})
			expect(await target.keys('users')).toEqual(['u1'])
		} finally {
			native.close()
			await target.close()
			temp.cleanup()
		}
	})

	it('reports the first missing table in persisted declaration order before creating either', async () => {
		const temp = tempDatabasePath()
		const target = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		try {
			await target.open(SCHEMA)
			await target.stamp?.({ version: 1, schema: SCHEMA })
			await target.close()
			native.connect()
			native.exec('DROP TABLE "users"')
			native.exec('DROP TABLE "posts"')
			native.close()

			await expect(target.open(SCHEMA)).rejects.toMatchObject({
				code: 'DRIVER',
				message: 'Stored SQLite table is missing',
				context: { table: 'users', aspect: 'missing' },
			})
			native.connect()
			const recreated = native
				.prepare('SELECT "name" FROM "sqlite_schema" WHERE "type" = ? AND "name" IN (?, ?)')
				.all(['table', 'users', 'posts'])
			expect(recreated).toEqual([])
		} finally {
			native.close()
			await target.close()
			temp.cleanup()
		}
	})

	it('closes and clears its schema when persisted-schema setup fails', async () => {
		const temp = tempDatabasePath()
		const native = createSQLiteDatabase({ path: temp.path })
		native.connect()
		native.exec(
			'CREATE TABLE "_metadata" ("id" INTEGER, "version" INTEGER, "schema" TEXT, PRIMARY KEY ("id"))',
		)
		native.prepare('INSERT INTO "_metadata" ("id", "version", "schema") VALUES (1, ?, ?)').run([
			1,
			JSON.stringify([
				{
					name: 'broken',
					primary: 'missing',
					columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
					indexes: [],
				},
			]),
		])
		native.close()

		const broken = createSQLiteDriver({ path: temp.path })
		const opened = await broken.open(SCHEMA).catch((caught: unknown) => caught)
		const after = await broken.keys('users').catch((caught: unknown) => caught)
		await broken.close()
		temp.cleanup()

		expect(isDatabaseError(opened) ? opened.code : 'not-database').toBe('DRIVER')
		expect(isDatabaseError(after) ? after.code : 'not-database').toBe('CLOSED')
	})

	it('enables native foreign-key enforcement when references is true', async () => {
		const fixture = await createForeignKeyFixture(true)
		try {
			await expect(
				fixture.driver.write('children', 'child', { id: 'child', parent: 'missing' }),
			).rejects.toMatchObject({ code: 'CONFLICT' })
		} finally {
			await fixture.driver.close()
			fixture.cleanup()
		}
	})

	it('disables native foreign-key enforcement when references is false', async () => {
		const fixture = await createForeignKeyFixture(false)
		try {
			await fixture.driver.write('children', 'child', { id: 'child', parent: 'missing' })
			expect(await fixture.driver.read('children', 'child')).toEqual({
				id: 'child',
				parent: 'missing',
			})
		} finally {
			await fixture.driver.close()
			fixture.cleanup()
		}
	})

	it('preserves the upstream foreign-key default when references is omitted', async () => {
		const fixture = await createForeignKeyFixture(undefined)
		try {
			await expect(
				fixture.driver.write('children', 'child', { id: 'child', parent: 'missing' }),
			).rejects.toMatchObject({ code: 'CONFLICT' })
		} finally {
			await fixture.driver.close()
			fixture.cleanup()
		}
	})
})

describe('SQLiteDriver — keyed CRUD', () => {
	it('binds the supplied storage key over a mismatched custom primary value', async () => {
		await driver.write('posts', 'written', { slug: 'caller', title: 'Write' })
		await driver.insert('posts', 'inserted', { slug: 'caller', title: 'Insert' })
		expect(await driver.read('posts', 'written')).toEqual({ slug: 'written', title: 'Write' })
		expect(await driver.read('posts', 'inserted')).toEqual({ slug: 'inserted', title: 'Insert' })
	})

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

	it('atomically inserts one row when the same key is submitted concurrently', async () => {
		const outcomes = await Promise.all([
			driver.insert('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true }).then(
				() => 'fulfilled',
				(error: unknown) => (isDatabaseError(error) ? error.code : 'unexpected'),
			),
			driver.insert('users', 'u1', { id: 'u1', name: 'Grace', age: 40, active: false }).then(
				() => 'fulfilled',
				(error: unknown) => (isDatabaseError(error) ? error.code : 'unexpected'),
			),
		])
		expect([...outcomes].sort()).toEqual(['CONFLICT', 'fulfilled'])
		expect(await driver.keys('users')).toEqual(['u1'])
		expect(['Ada', 'Grace']).toContain((await driver.read('users', 'u1'))?.name)
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

	it('checks abort immediately before synchronous write/delete commit points', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const controller = new AbortController()
		controller.abort('stop')
		await expect(
			driver.write(
				'users',
				'u2',
				{ id: 'u2', name: 'Bo', age: 22, active: false },
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: 'ABORTED' })
		await expect(
			driver.insert(
				'users',
				'u2',
				{ id: 'u2', name: 'Bo', age: 22, active: false },
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: 'ABORTED' })
		await expect(driver.delete('users', 'u1', { signal: controller.signal })).rejects.toMatchObject(
			{ code: 'ABORTED' },
		)
		expect(await driver.keys('users')).toEqual(['u1'])
	})

	it('does not let a late abort rewrite an already-committed result', async () => {
		const controller = new AbortController()
		await driver.write(
			'users',
			'u1',
			{ id: 'u1', name: 'Ada', age: 36, active: true },
			{ signal: controller.signal },
		)
		controller.abort('too late')
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
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
	const ACTIVE: QueryInput = {
		conditions: [{ column: 'active', operator: 'equals', values: [true], connector: 'and' }],
	}
	const NONE: QueryInput = {
		conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
	}

	beforeEach(async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'u2', { id: 'u2', name: 'Alan', age: 41, active: false })
		await driver.write('users', 'u3', { id: 'u3', name: 'Edsger', age: 50, active: true })
		await driver.write('users', 'u4', { id: 'u4', name: 'Grace', age: 22, active: false })
	})

	it('counts all matched rows with COUNT(*) — including over no conditions', async () => {
		expect(await computeSQLiteAggregate(driver, 'count', 'age', {})).toBe(4)
		expect(await computeSQLiteAggregate(driver, 'count', 'age', ACTIVE)).toBe(2)
	})

	it('rejects invalid direct records and aggregate paging while accepting zero', async () => {
		const records = driver.records
		if (records === undefined) throw new Error('SQLiteDriver is missing its native records hook')
		await expect(records.call(driver, 'users', { limit: -1 })).rejects.toMatchObject({
			code: 'VALIDATION',
			context: { field: 'limit', value: -1 },
		})
		await expect(
			computeSQLiteAggregate(driver, 'count', 'age', {
				offset: Number.POSITIVE_INFINITY,
			}),
		).rejects.toMatchObject({
			code: 'VALIDATION',
			context: { field: 'offset', value: 'Infinity' },
		})
		expect(await records.call(driver, 'users', { limit: 0 })).toEqual([])
		expect(await computeSQLiteAggregate(driver, 'count', 'age', { limit: 0 })).toBe(4)
	})

	it('sums, averages, and takes the min/max of a numeric column', async () => {
		expect(await computeSQLiteAggregate(driver, 'sum', 'age', {})).toBe(149)
		expect(await computeSQLiteAggregate(driver, 'average', 'age', ACTIVE)).toBe(43)
		expect(await computeSQLiteAggregate(driver, 'minimum', 'age', {})).toBe(22)
		expect(await computeSQLiteAggregate(driver, 'maximum', 'age', ACTIVE)).toBe(50)
	})

	it('over zero matched rows: count is 0, the numeric aggregates are undefined', async () => {
		expect(await computeSQLiteAggregate(driver, 'count', 'age', NONE)).toBe(0)
		expect(await computeSQLiteAggregate(driver, 'sum', 'age', NONE)).toBeUndefined()
	})

	it('matches the core for optional-nullable null and numeric aggregate cells', async () => {
		const schema: readonly TableSchema[] = [
			{
				name: 'values',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'value', storage: 'integer', optional: true, nullable: true },
				],
				indexes: [],
			},
		]
		const memory = createMemoryDriver()
		const target = createSQLiteDriver()
		try {
			await memory.open(schema)
			await target.open(schema)
			for (const row of [
				{ id: 'null', value: null },
				{ id: 'ten', value: 10 },
			]) {
				await memory.write('values', row.id, row)
				await target.write('values', row.id, row)
			}
			const rows = await collectRows(memory.scan('values'))
			const operations: readonly AggregateOperation[] = ['sum', 'average', 'minimum', 'maximum']
			for (const operation of operations) {
				const expected = computeAggregate(rows, operation, 'value')
				const actual = await target.aggregate?.('values', operation, 'value', {})
				expect(actual).toBe(expected)
				expect(actual).toBe(10)
			}
		} finally {
			await memory.close()
			await target.close()
		}
	})

	it('refines adversarial safe-integer and real accumulation to exact core order', async () => {
		const schema: readonly TableSchema[] = [
			{
				name: 'integers',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'value', storage: 'integer', optional: false, nullable: false },
				],
				indexes: [],
			},
			{
				name: 'reals',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'value', storage: 'real', optional: false, nullable: false },
				],
				indexes: [],
			},
		]
		const temp = tempDatabasePath()
		const memory = createMemoryDriver()
		const target = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		try {
			await memory.open(schema)
			await target.open(schema)
			const cases = [
				{
					table: 'integers',
					rows: [
						{ id: 'a', value: Number.MAX_SAFE_INTEGER },
						{ id: 'c', value: -Number.MAX_SAFE_INTEGER },
						{ id: 'b', value: 2 },
					],
					expected: 1,
					raw: 2,
				},
				{
					table: 'reals',
					rows: [
						{ id: 'a', value: 2 ** 53 },
						{ id: 'c', value: -(2 ** 53) },
						{ id: 'b', value: 1 },
					],
					expected: 0,
					raw: 1,
				},
			]
			for (const entry of cases) {
				for (const row of entry.rows) {
					await memory.write(entry.table, row.id, row)
					await target.write(entry.table, row.id, row)
				}
				const rows = await collectRows(memory.scan(entry.table))
				const operations: readonly AggregateOperation[] = ['sum', 'average']
				for (const operation of operations) {
					const expected = computeAggregate(rows, operation, 'value')
					const actual = await target.aggregate?.(entry.table, operation, 'value', {})
					expect(actual).toBe(expected)
					expect(actual).toBe(
						operation === 'average' ? entry.expected / entry.rows.length : entry.expected,
					)
				}
			}
			native.connect()
			for (const entry of cases) {
				const raw = native
					.prepare(`SELECT SUM("value") AS "value" FROM "${entry.table}"`)
					.get()?.value
				expect(raw).toBe(entry.raw)
			}
		} finally {
			native.close()
			await memory.close()
			await target.close()
			temp.cleanup()
		}
	})

	it('keeps optional-only and nullable-only minimum/maximum exact', async () => {
		const schema: readonly TableSchema[] = [
			{
				name: 'values',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'optional', storage: 'integer', optional: true, nullable: false },
					{ name: 'nullable', storage: 'integer', optional: false, nullable: true },
				],
				indexes: [],
			},
		]
		const target = createSQLiteDriver()
		try {
			await target.open(schema)
			await target.write('values', 'empty', { id: 'empty', nullable: null })
			await target.write('values', 'ten', { id: 'ten', optional: 10, nullable: 10 })
			const operations: readonly AggregateOperation[] = ['minimum', 'maximum']
			for (const operation of operations) {
				expect(await target.aggregate?.('values', operation, 'optional', {})).toBe(10)
				expect(await target.aggregate?.('values', operation, 'nullable', {})).toBe(10)
			}
		} finally {
			await target.close()
		}
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

	it('adapts captured rows to a surviving table schema before replay', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const rollback = await driver.snapshot(['users'])
		const users = SCHEMA.find((table) => table.name === 'users')
		if (users === undefined) throw new Error('Expected users schema')
		const declared: readonly TableSchema[] = [
			{
				...users,
				columns: users.columns.filter((column) => column.name !== 'active'),
			},
			...SCHEMA.filter((table) => table.name !== 'users'),
		]
		await driver.migrate?.({
			plan: planMigration(SCHEMA, declared),
		})
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99 })
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
	})

	it('does not replay captured rows into a removed and recreated same-name table', async () => {
		await driver.write('users', 'captured', {
			id: 'captured',
			name: 'Ada',
			age: 36,
			active: true,
		})
		const rollback = await driver.snapshot(['users'])
		const users = SCHEMA.find((table) => table.name === 'users')
		if (users === undefined) throw new Error('Expected users schema')
		await driver.migrate?.({
			plan: {
				from: 0,
				to: 1,
				steps: [
					{ operation: 'table.remove', table: 'users' },
					{ operation: 'table.add', table: users },
				],
			},
		})
		await driver.write('users', 'replacement', {
			id: 'replacement',
			name: 'Grace',
			age: 40,
			active: true,
		})
		await rollback()
		expect(await driver.keys('users')).toEqual(['replacement'])
	})

	it('treats an explicit unknown-only snapshot as a repeatable no-op', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const rollback = await driver.snapshot(['missing', 'missing'])
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99, active: false })
		await rollback()
		await rollback()
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Changed',
			age: 99,
			active: false,
		})
	})

	it('keeps a table added after a whole-database capture', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const rollback = await driver.snapshot()
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its migrate hook')
		await migrate.call(driver, {
			plan: {
				from: 0,
				to: 1,
				steps: [
					{
						operation: 'table.add',
						table: {
							name: 'logs',
							primary: 'id',
							columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
							indexes: [],
						},
					},
				],
			},
		})
		await driver.write('logs', 'l1', { id: 'l1' })
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99, active: false })
		await rollback()
		expect(await driver.keys('logs')).toEqual(['l1'])
		expect((await driver.read('users', 'u1'))?.name).toBe('Ada')
	})

	it('skips a captured table removed before replay', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.write('posts', 'p1', { slug: 'p1', title: 'Post' })
		const rollback = await driver.snapshot(['users'])
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its migrate hook')
		await migrate.call(driver, {
			plan: {
				from: 0,
				to: 1,
				steps: [{ operation: 'table.remove', table: 'users' }],
			},
		})
		await rollback()
		const removed = await driver.keys('users').catch((caught: unknown) => caught)
		expect(isDatabaseError(removed) ? removed.code : 'not-database').toBe('NOT_FOUND')
		expect(await driver.keys('posts')).toEqual(['p1'])
	})

	it('preserves current metadata and replays the same capture exactly twice', async () => {
		const stamp = driver.stamp
		if (stamp === undefined) throw new Error('SQLiteDriver is missing its stamp hook')
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await stamp.call(driver, { version: 1, schema: SCHEMA })
		const rollback = await driver.snapshot(['users'])
		await stamp.call(driver, { version: 2, schema: SCHEMA })
		await driver.write('users', 'u1', { id: 'u1', name: 'Changed', age: 99, active: false })
		await rollback()
		await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40, active: true })
		await rollback()
		expect(await driver.keys('users')).toEqual(['u1'])
		expect((await driver.read('users', 'u1'))?.name).toBe('Ada')
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: SCHEMA })
	})

	it('fails incompatible same-identity replay before row changes and succeeds after correction', async () => {
		const schema: readonly TableSchema[] = [
			{
				name: 'values',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'value', storage: 'integer', optional: true, nullable: false },
				],
				indexes: [],
			},
		]
		const initial = schema[0]
		if (initial === undefined) throw new Error('Expected initial snapshot schema')
		const integer = initial.columns[1]
		if (integer === undefined) throw new Error('Expected integer value column')
		const changed: TableSchema = {
			...initial,
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'value', storage: 'real', optional: true, nullable: false },
			],
		}
		const real = changed.columns[1]
		if (real === undefined) throw new Error('Expected real value column')
		const target = createSQLiteDriver()
		try {
			await target.open(schema)
			await target.write('values', 'v1', { id: 'v1', value: 10 })
			const rollback = await target.snapshot()
			const migrate = target.migrate
			if (migrate === undefined) throw new Error('SQLiteDriver is missing its migrate hook')
			await migrate.call(target, {
				plan: {
					from: 0,
					to: 1,
					steps: [
						{ operation: 'column.remove', table: 'values', column: 'value' },
						{
							operation: 'column.add',
							table: 'values',
							column: real,
						},
					],
				},
			})
			await target.write('values', 'v1', { id: 'v1', value: 99.5 })
			const incompatible = await rollback().catch((caught: unknown) => caught)
			expect(isDatabaseError(incompatible) ? incompatible.code : 'not-database').toBe('MIGRATION')
			expect(await target.read('values', 'v1')).toEqual({ id: 'v1', value: 99.5 })

			await migrate.call(target, {
				plan: {
					from: 1,
					to: 2,
					steps: [
						{ operation: 'column.remove', table: 'values', column: 'value' },
						{
							operation: 'column.add',
							table: 'values',
							column: integer,
						},
					],
				},
			})
			await target.write('values', 'v1', { id: 'v1', value: 77 })
			await rollback()
			expect(await target.read('values', 'v1')).toEqual({ id: 'v1', value: 10 })
		} finally {
			await target.close()
		}
	})

	it('rolls a multi-table replay back atomically after real native failure and retries', async () => {
		const temp = tempDatabasePath()
		const target = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		try {
			await target.open(SCHEMA)
			await target.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
			await target.write('posts', 'p1', { slug: 'p1', title: 'Captured' })
			const rollback = await target.snapshot()
			await target.write('users', 'u1', {
				id: 'u1',
				name: 'Changed',
				age: 99,
				active: false,
			})
			await target.write('posts', 'p1', { slug: 'p1', title: 'Changed' })
			native.connect()
			native.exec(
				'CREATE TRIGGER "posts_replay_guard" BEFORE INSERT ON "posts" ' +
					"BEGIN SELECT RAISE(ABORT, 'replay blocked'); END",
			)
			native.close()
			const failed = await rollback().catch((caught: unknown) => caught)
			expect(isDatabaseError(failed) ? failed.code : 'not-database').toBe('CONFLICT')
			expect((await target.read('users', 'u1'))?.name).toBe('Changed')
			expect((await target.read('posts', 'p1'))?.title).toBe('Changed')

			native.connect()
			native.exec('DROP TRIGGER "posts_replay_guard"')
			native.close()
			await rollback()
			expect((await target.read('users', 'u1'))?.name).toBe('Ada')
			expect((await target.read('posts', 'p1'))?.title).toBe('Captured')
		} finally {
			native.close()
			await target.close()
			temp.cleanup()
		}
	})

	it('contains a real dropped-table capture fault as DRIVER with the SQLite cause nested', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		try {
			await onDisk.open(SCHEMA)
			native.connect()
			native.exec('DROP TABLE "posts"')
			const error = await onDisk.snapshot().catch((caught: unknown) => caught)
			if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
			expect(error.code).toBe('DRIVER')
			expect(isSQLiteError(error.context?.cause)).toBe(true)
		} finally {
			native.close()
			await onDisk.close()
			temp.cleanup()
		}
	})

	it('contains a zero-timeout replay lock and restores successfully when retried', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver({ path: temp.path, timeout: 0 })
		const locker = createSQLiteDatabase({ path: temp.path, timeout: 0 })
		let locked = false
		try {
			await onDisk.open(SCHEMA)
			await onDisk.write('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
			})
			const rollback = await onDisk.snapshot()
			await onDisk.write('users', 'u1', {
				id: 'u1',
				name: 'Changed',
				age: 99,
				active: false,
			})
			locker.connect()
			locker.exec('BEGIN EXCLUSIVE')
			locked = true
			const error = await rollback().catch((caught: unknown) => caught)
			if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
			expect(error.code).toBe('DRIVER')
			expect(error.context?.code).toBe('BUSY')
			expect(error.context?.retryable).toBe(true)
			expect(isSQLiteError(error.context?.cause)).toBe(true)

			locker.rollback()
			locked = false
			await rollback()
			expect(await onDisk.read('users', 'u1')).toEqual({
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
			})
			await onDisk.write('users', 'u2', {
				id: 'u2',
				name: 'Grace',
				age: 40,
				active: true,
			})
			expect(await onDisk.keys('users')).toEqual(['u1', 'u2'])
		} finally {
			if (locked) locker.rollback()
			locker.close()
			await onDisk.close()
			temp.cleanup()
		}
	})
})

describe('SQLiteDriver — persistence across reopen (temp file)', () => {
	it('survives a close and reopen on the same file', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver({ path: temp.path })
		await onDisk.open(SCHEMA)
		await onDisk.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await onDisk.write('posts', 'intro', { slug: 'intro', title: 'Intro' })
		await onDisk.close()

		const reopened = createSQLiteDriver({ path: temp.path })
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

	it('preserves exact derived index names across a persistent reopen', async () => {
		const temp = tempDatabasePath()
		const first = createSQLiteDriver({ path: temp.path })
		await first.open(SCHEMA)
		await first.close()

		const reopened = createSQLiteDriver({ path: temp.path })
		await reopened.open(SCHEMA)
		await reopened.close()

		const database = createSQLiteDatabase({ path: temp.path })
		database.connect()
		const indexes = database
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name LIKE 'idx_%' ORDER BY name",
			)
			.all(['users'])
		database.close()
		temp.cleanup()

		expect(indexes.map((row) => row.name)).toEqual([
			'idx_5_users_3_age_4_name',
			'idx_5_users_4_name',
		])
	})

	it('reconciles persisted table removal atomically and leaves a same-version reopen unstamped', async () => {
		const temp = tempDatabasePath()
		const users = { id: stringShape(), name: stringShape() }
		const audit = { id: stringShape(), message: stringShape() }
		const v1 = createDatabase({
			driver: createSQLiteDriver({ path: temp.path }),
			name: 'tables',
			tables: { users, audit },
			version: 1,
		})
		await v1.table('users').set({ id: 'u1', name: 'Ada' })
		await v1.table('audit').set({ id: 'a1', message: 'created' })
		await v1.close()

		const v2 = createDatabase({
			driver: createSQLiteDriver({ path: temp.path }),
			name: 'tables',
			tables: { users },
			version: 2,
		})
		await v2.open()
		const preserved = await v2.table('users').get('u1')
		await v2.close()

		const native = createSQLiteDatabase({ path: temp.path })
		native.connect()
		const removed = native
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get(['audit'])
		const stored = native.prepare('SELECT "version" FROM "_metadata" WHERE "id" = 1').get()?.version
		native.exec(
			'CREATE TRIGGER "block_metadata_insert" BEFORE INSERT ON "_metadata" ' +
				"BEGIN SELECT RAISE(ABORT, 'metadata rewritten'); END",
		)
		native.close()

		const again = createDatabase({
			driver: createSQLiteDriver({ path: temp.path }),
			name: 'tables',
			tables: { users },
			version: 2,
		})
		await again.open()
		const reopened = await again.table('users').get('u1')
		await again.close()
		temp.cleanup()

		expect(preserved).toEqual({ id: 'u1', name: 'Ada' })
		expect(removed).toBeUndefined()
		expect(stored).toBe(2)
		expect(reopened).toEqual({ id: 'u1', name: 'Ada' })
	})

	it('reconciles a persisted table addition and stamps the expanded schema', async () => {
		const temp = tempDatabasePath()
		const users = { id: stringShape(), name: stringShape() }
		const posts = { id: stringShape(), title: stringShape() }
		const v1 = createDatabase({
			driver: createSQLiteDriver({ path: temp.path }),
			name: 'addition',
			tables: { users },
			version: 1,
		})
		await v1.table('users').set({ id: 'u1', name: 'Ada' })
		await v1.close()

		const v2 = createDatabase({
			driver: createSQLiteDriver({ path: temp.path }),
			name: 'addition',
			tables: { users, posts },
			version: 2,
		})
		await v2.open()
		await v2.table('posts').set({ id: 'p1', title: 'First' })
		const preserved = await v2.table('users').get('u1')
		const added = await v2.table('posts').get('p1')
		await v2.close()

		const native = createSQLiteDatabase({ path: temp.path })
		native.connect()
		const physical = native
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get(['posts'])
		const stored = native.prepare('SELECT "version" FROM "_metadata" WHERE "id" = 1').get()?.version
		native.close()
		temp.cleanup()

		expect(preserved).toEqual({ id: 'u1', name: 'Ada' })
		expect(added).toEqual({ id: 'p1', title: 'First' })
		expect(physical?.name).toBe('posts')
		expect(stored).toBe(2)
	})
})

describe('SQLiteDriver — migrate', () => {
	// `age` participates in the SCHEMA's composite `['age', 'name']` index, and
	// SQLite's `ALTER TABLE … DROP COLUMN` refuses to drop an indexed column
	// (a real engine constraint, not a driver defect) — these steps drop
	// `active`, which carries no index, to exercise DROP COLUMN cleanly.
	it('applies a column.remove step that strips the real SQLite column from stored rows', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const step: MigrationStep = { operation: 'column.remove', table: 'users', column: 'active' }
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its native migrate hook')
		await migrate.call(driver, { plan: { from: 0, to: 1, steps: [step] } })
		const row = await driver.read('users', 'u1')
		expect(row).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(row && 'active' in row).toBe(false)
	})

	it('applies a plan atomically inside one native transaction — a mid-plan failure throws MIGRATION and rolls back', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const goodStep: MigrationStep = { operation: 'column.remove', table: 'users', column: 'active' }
		const badStep: MigrationStep = { operation: 'table.remove', table: 'ghost' }
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its native migrate hook')
		const prior = { version: 1, schema: SCHEMA }
		await driver.stamp?.(prior)
		const error = await migrate
			.call(driver, {
				plan: { from: 1, to: 2, steps: [goodStep, badStep] },
				metadata: { version: 2, schema: SCHEMA },
			})
			.catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		// The whole native transaction rolled back — the earlier goodStep never landed.
		const row = await driver.read('users', 'u1')
		expect(row).toEqual({ id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await driver.metadata?.()).toEqual(prior)
		await driver.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40, active: false })
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
	})

	it('throws MIGRATION for a step referencing an unknown table', async () => {
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its native migrate hook')
		const error = await migrate
			.call(driver, {
				plan: {
					from: 0,
					to: 1,
					steps: [{ operation: 'table.remove', table: 'ghost' }],
				},
			})
			.catch((caught: unknown) => caught)
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

	it('rejects an unsafe required column before rows, schema, and metadata change', async () => {
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await driver.stamp?.({ version: 1, schema: SCHEMA })
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

		const users = SCHEMA.find((table) => table.name === 'users')
		if (users === undefined) throw new Error('Expected users schema')
		const optionalColumn: ColumnSchema = {
			name: 'optional',
			storage: 'text',
			optional: true,
			nullable: false,
		}
		const safe: readonly TableSchema[] = SCHEMA.map((table) =>
			table.name === 'users'
				? {
						...users,
						columns: [...users.columns, optionalColumn],
					}
				: table,
		)
		await expect(
			driver.migrate?.({
				plan: planMigration(SCHEMA, safe, 1, 2),
				metadata: { version: 2, schema: safe },
			}),
		).resolves.toBeUndefined()
	})

	it('owns migration metadata before DDL and rejects hostile metadata before mutation', async () => {
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its native migrate hook')
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const deployed = SCHEMA.map((table) =>
			table.name === 'users'
				? { ...table, columns: table.columns.filter((column) => column.name !== 'active') }
				: table,
		)
		const metadata = { version: 2, schema: [...deployed] }
		const pending = migrate.call(driver, {
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'column.remove', table: 'users', column: 'active' }],
			},
			metadata,
		})
		metadata.schema.length = 0
		await pending
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: deployed })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })

		const reason = new Error('hostile migration metadata')
		const error = await migrate
			.call(driver, {
				plan: {
					from: 2,
					to: 3,
					steps: [{ operation: 'table.remove', table: 'posts' }],
				},
				get metadata(): DriverMetadata {
					throw reason
				},
			})
			.catch((caught: unknown) => caught)
		if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
		expect(error.code).toBe('VALIDATION')
		expect(error).not.toBe(reason)
		expect(await driver.keys('posts')).toEqual([])
	})
})

describe('SQLiteDriver — metadata / stamp across reopen (temp file)', () => {
	it('owns stamp ingress and returns persisted, distinct, deeply frozen copy-outs', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver({ path: temp.path })
		const reopened = createSQLiteDriver({ path: temp.path })
		try {
			await onDisk.open(SCHEMA)
			expect(await onDisk.metadata?.()).toBeUndefined()
			const stamped = { version: 3, schema: [...SCHEMA] }
			const pending = onDisk.stamp?.(stamped)
			if (pending === undefined) throw new Error('SQLiteDriver is missing its stamp hook')
			stamped.schema.length = 0
			await pending
			const first = await onDisk.metadata?.()
			const second = await onDisk.metadata?.()
			if (first === undefined || second === undefined) {
				throw new Error('SQLiteDriver did not return persisted metadata')
			}
			expect(first).toEqual({ version: 3, schema: SCHEMA })
			expect(first).not.toBe(second)
			expect(first.schema).not.toBe(second.schema)
			expect(Object.isFrozen(first)).toBe(true)
			expect(Object.isFrozen(first.schema)).toBe(true)
			for (const table of first.schema) {
				expect(Object.isFrozen(table)).toBe(true)
				expect(Object.isFrozen(table.columns)).toBe(true)
				expect(Object.isFrozen(table.indexes)).toBe(true)
			}
			await onDisk.close()

			await reopened.open(SCHEMA)
			expect(await reopened.metadata?.()).toEqual({ version: 3, schema: SCHEMA })
		} finally {
			await onDisk.close()
			await reopened.close()
			temp.cleanup()
		}
	})

	it.each([
		{ label: 'invalid JSON text', version: 1, schema: '{' },
		{ label: 'valid non-array JSON', version: 1, schema: JSON.stringify({ malformed: true }) },
		{
			label: 'structurally invalid schema array',
			version: 1,
			schema: JSON.stringify([
				{
					name: 'users',
					primary: 'missing',
					columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
					indexes: [],
				},
			]),
		},
		{ label: 'invalid version storage', version: 'invalid', schema: JSON.stringify(SCHEMA) },
	])('rejects $label without publication or persisted mutation', async ({ version, schema }) => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		const reopened = createSQLiteDriver({ path: temp.path })
		try {
			await onDisk.open(SCHEMA)
			await onDisk.write('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
			})
			await onDisk.close()
			native.connect()
			native
				.prepare('INSERT OR REPLACE INTO "_metadata" ("id", "version", "schema") VALUES (1, ?, ?)')
				.run([version, schema])
			const before = native
				.prepare('SELECT "version", "schema" FROM "_metadata" WHERE "id" = 1')
				.get()
			native.close()

			const opened = await reopened.open(SCHEMA).catch((caught: unknown) => caught)
			const after = await reopened.keys('users').catch((caught: unknown) => caught)
			if (!isDatabaseError(opened)) throw new Error('Expected a DatabaseError')
			expect(opened.code).toBe('DRIVER')
			expect(opened.context?.table).toBe('_metadata')
			expect(opened.context?.aspect).toBe('metadata')
			expect(opened.context).not.toHaveProperty('actual')
			expect(isDatabaseError(after) ? after.code : 'not-database').toBe('CLOSED')

			native.connect()
			const persisted = native
				.prepare('SELECT "version", "schema" FROM "_metadata" WHERE "id" = 1')
				.get()
			const row = native.prepare('SELECT "name" FROM "users" WHERE "id" = ?').get(['u1'])
			expect(persisted).toEqual(before)
			expect(row?.name).toBe('Ada')
		} finally {
			native.close()
			await onDisk.close()
			await reopened.close()
			temp.cleanup()
		}
	})

	it('keeps an absent metadata row distinct from malformed metadata', async () => {
		const fresh = createSQLiteDriver()
		await fresh.open(SCHEMA)
		expect(await fresh.metadata?.()).toBeUndefined()
		await fresh.close()
	})

	it('maps hostile stamp metadata to VALIDATION without leaking the caller error', async () => {
		const reason = new Error('hostile metadata getter')
		const stamp = driver.stamp
		if (stamp === undefined) throw new Error('SQLiteDriver is missing its stamp hook')
		const error = await stamp
			.call(driver, {
				get version(): number {
					throw reason
				},
				schema: SCHEMA,
			})
			.catch((caught: unknown) => caught)
		if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
		expect(error.code).toBe('VALIDATION')
		expect(error).not.toBe(reason)
		expect(error.context?.path).toBe('metadata')
	})

	it('checks the closed lifecycle before traversing hostile stamp or migrate metadata', async () => {
		const closed = createSQLiteDriver()
		const reason = new Error('hostile metadata getter')
		const metadata: DriverMetadata = {
			get version(): number {
				throw reason
			},
			schema: SCHEMA,
		}
		const stamp = closed.stamp
		if (stamp === undefined) throw new Error('SQLiteDriver is missing its stamp hook')
		const stamped = await stamp.call(closed, metadata).catch((caught: unknown) => caught)
		if (!isDatabaseError(stamped)) throw new Error('Expected a DatabaseError')
		expect(stamped.code).toBe('CLOSED')
		const migrate = closed.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its migrate hook')
		const migrated = await migrate
			.call(closed, {
				plan: { from: 0, to: 1, steps: [] },
				get metadata(): DriverMetadata {
					throw reason
				},
			})
			.catch((caught: unknown) => caught)
		if (!isDatabaseError(migrated)) throw new Error('Expected a DatabaseError')
		expect(migrated.code).toBe('CLOSED')
	})
})

describe('SQLiteDriver — native transaction', () => {
	it('terminalizes root scan and stream continuations resumed inside a transaction', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		await driver.write('users', 'a', { id: 'a', name: 'Ada', age: 36, active: true })
		await driver.write('users', 'b', { id: 'b', name: 'Bo', age: 22, active: false })
		await driver.write('users', 'c', { id: 'c', name: 'Cy', age: 40, active: true })
		const streamSource = driver.stream?.('users', {})
		if (streamSource === undefined) throw new Error('Expected stream capability')
		const scan = driver.scan('users')[Symbol.asyncIterator]()
		const stream = streamSource[Symbol.asyncIterator]()
		expect((await scan.next()).done).toBe(false)
		expect((await stream.next()).done).toBe(false)

		await transact.call(driver, async (transaction) => {
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
		const native = createSQLiteDriver()
		const replacement = new Error('post-rollback wrapper failure')
		const scope = new Error('scope failed')
		const database = createDatabase({
			driver: replaceTransactionFailure(native, replacement),
			tables: {
				users: {
					id: stringShape(),
					name: stringShape(),
					age: integerShape(),
					active: booleanShape(),
				},
			},
		})
		const events = recordEmitterEvents(database.emitter, ['rollback'])
		const error = await database
			.transaction(async (transaction) => {
				await transaction.table('users').set({ id: 'u1', name: 'Ada', age: 36, active: true })
				throw scope
			})
			.catch((caught: unknown) => caught)
		expect(error).toMatchObject({
			code: 'DRIVER',
			context: { transaction: scope, cause: replacement },
		})
		expect(events.rollback.count).toBe(0)
		expect(await database.table('users').get('u1')).toBeUndefined()
		await database.close()
	})

	it('commit persists writes made during the scope; rollback restores prior state', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await transact.call(driver, async (transaction) => {
			await transaction.write('users', 'u2', {
				id: 'u2',
				name: 'Grace',
				age: 40,
				active: true,
			})
			expect((await transaction.read('users', 'u2'))?.name).toBe('Grace')
		})
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
		const reason = new Error('rollback')
		await expect(
			transact.call(driver, async (transaction) => {
				await transaction.write('users', 'u3', {
					id: 'u3',
					name: 'Marie',
					age: 50,
					active: true,
				})
				throw reason
			}),
		).rejects.toBe(reason)
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
	})

	it('rejects parent operations and nesting while active, then invalidates the capability', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		const stamp = driver.stamp
		if (stamp === undefined) throw new Error('SQLiteDriver is missing its stamp hook')
		const migrate = driver.migrate
		if (migrate === undefined) throw new Error('SQLiteDriver is missing its migrate hook')
		const reason = new Error('hostile metadata getter')
		const hostile: DriverMetadata = {
			get version(): number {
				throw reason
			},
			schema: SCHEMA,
		}
		const captured = Promise.withResolvers<{
			readonly transaction: StorageInterface
			readonly iterator: AsyncIterator<unknown>
		}>()
		await transact.call(driver, async (transaction) => {
			await transaction.write('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
			})
			await expect(driver.keys('users')).rejects.toMatchObject({ code: 'CONFLICT' })
			await expect(stamp.call(driver, hostile)).rejects.toMatchObject({ code: 'CONFLICT' })
			await expect(
				migrate.call(driver, {
					plan: { from: 0, to: 1, steps: [] },
					get metadata(): DriverMetadata {
						throw reason
					},
				}),
			).rejects.toMatchObject({ code: 'CONFLICT' })
			await expect(
				transact.call(driver, async () => {
					throw new Error('nested scope ran')
				}),
			).rejects.toMatchObject({ code: 'CONFLICT' })
			const iterator = transaction.scan('users')[Symbol.asyncIterator]()
			expect((await iterator.next()).done).toBe(false)
			captured.resolve({ transaction, iterator })
		})
		const stale = await captured.promise
		await expect(stale.transaction.keys('users')).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(stale.iterator.next()).rejects.toMatchObject({ code: 'CONFLICT' })
		const scopedStamp = stale.transaction.stamp
		if (scopedStamp === undefined) throw new Error('SQLite capability is missing its stamp hook')
		await expect(scopedStamp(hostile)).rejects.toMatchObject({ code: 'CONFLICT' })
		const scopedMigrate = stale.transaction.migrate
		if (scopedMigrate === undefined)
			throw new Error('SQLite capability is missing its migrate hook')
		await expect(
			scopedMigrate({
				plan: { from: 0, to: 1, steps: [] },
				get metadata(): DriverMetadata {
					throw reason
				},
			}),
		).rejects.toMatchObject({ code: 'CONFLICT' })
	})

	it('owns scoped stamp ingress before the transaction continues', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		await transact.call(driver, async (transaction) => {
			const stamp = transaction.stamp
			if (stamp === undefined) throw new Error('SQLite capability is missing its stamp hook')
			const metadata = { version: 4, schema: [...SCHEMA] }
			const pending = stamp(metadata)
			metadata.schema.length = 0
			await pending
			const read = transaction.metadata
			if (read === undefined) throw new Error('SQLite capability is missing its metadata hook')
			const stored = await read()
			if (stored === undefined) throw new Error('SQLite capability did not persist metadata')
			expect(stored).toEqual({ version: 4, schema: SCHEMA })
			expect(Object.isFrozen(stored)).toBe(true)
			expect(Object.isFrozen(stored.schema)).toBe(true)
		})
		expect(await driver.metadata?.()).toEqual({ version: 4, schema: SCHEMA })
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

		await database.transaction(async (transaction) => {
			await transaction.table('users').set({
				id: 'u2',
				name: 'Grace',
				age: 40,
				active: true,
			})
		})
		expect([...(await table.keys())].sort()).toEqual(['u1', 'u2'])

		const thrown = new Error('boom')
		await expect(
			database.transaction(async (transaction) => {
				await transaction.table('users').set({
					id: 'u3',
					name: 'Marie',
					age: 50,
					active: true,
				})
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
	it('runs scoped migrate directly inside the outer native transaction (no nested BEGIN)', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const step: MigrationStep = { operation: 'column.remove', table: 'users', column: 'active' }
		await transact.call(driver, async (transaction) => {
			const migrate = transaction.migrate
			if (migrate === undefined) {
				throw new Error('SQLite transaction capability is missing its migrate hook')
			}
			await migrate({ plan: { from: 0, to: 1, steps: [step] } })
		})

		const row = await driver.read('users', 'u1')
		expect(row).toEqual({ id: 'u1', name: 'Ada', age: 36 })
		expect(row && 'active' in row).toBe(false)
	})

	it('commits scoped schema and metadata together', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		await driver.stamp?.({ version: 1, schema: SCHEMA })
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const deployed = SCHEMA.map((table) =>
			table.name === 'users'
				? { ...table, columns: table.columns.filter((column) => column.name !== 'active') }
				: table,
		)
		await transact.call(driver, async (transaction) => {
			const migrate = transaction.migrate
			if (migrate === undefined) {
				throw new Error('SQLite transaction capability is missing its migrate hook')
			}
			const metadata = { version: 2, schema: [...deployed] }
			const pending = migrate({
				plan: {
					from: 1,
					to: 2,
					steps: [{ operation: 'column.remove', table: 'users', column: 'active' }],
				},
				metadata,
			})
			metadata.schema.length = 0
			await pending
		})
		expect(await driver.metadata?.()).toEqual({ version: 2, schema: deployed })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
	})

	it('rolls scoped schema and metadata back when the outer scope rejects', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		const prior = { version: 1, schema: SCHEMA }
		await driver.stamp?.(prior)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		const reason = new Error('reject scope')
		const declared = SCHEMA.map((table) =>
			table.name === 'users'
				? { ...table, columns: table.columns.filter((column) => column.name !== 'active') }
				: table,
		)
		await expect(
			transact.call(driver, async (transaction) => {
				const migrate = transaction.migrate
				if (migrate === undefined) {
					throw new Error('SQLite transaction capability is missing its migrate hook')
				}
				await migrate({
					plan: {
						from: 1,
						to: 2,
						steps: [{ operation: 'column.remove', table: 'users', column: 'active' }],
					},
					metadata: { version: 2, schema: declared },
				})
				throw reason
			}),
		).rejects.toBe(reason)
		expect(await driver.metadata?.()).toEqual(prior)
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
	})

	it('contains a caught scoped migration failure before the outer transaction commits', async () => {
		const transact = driver.transaction
		if (transact === undefined) throw new Error('SQLiteDriver is missing its transaction hook')
		const prior = { version: 1, schema: SCHEMA }
		await driver.stamp?.(prior)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await transact.call(driver, async (transaction) => {
			const migrate = transaction.migrate
			if (migrate === undefined) {
				throw new Error('SQLite transaction capability is missing its migrate hook')
			}
			const error = await migrate({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{ operation: 'column.remove', table: 'users', column: 'active' },
						{ operation: 'table.remove', table: 'ghost' },
					],
				},
				metadata: { version: 2, schema: [] },
			}).catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
			await transaction.insert('users', 'u2', {
				id: 'u2',
				name: 'Grace',
				age: 40,
				active: false,
			})
		})
		expect(await driver.metadata?.()).toEqual(prior)
		expect(await driver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		expect(await driver.keys('users')).toEqual(['u1', 'u2'])
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
			driver: createSQLiteDriver({ path: temp.path }),
			name: 'versioned',
			tables: { users: v1Users },
			version: 1,
		})
		const v1Table = v1.table('users')
		await v1Table.set({ id: 'u1', name: 'Ada', age: 36, active: true })
		await v1.close()

		const v2Users = { id: stringShape(), name: stringShape(), age: integerShape() }
		const v2 = createDatabase({
			driver: createSQLiteDriver({ path: temp.path }),
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
			driver: createSQLiteDriver({ path: temp.path }),
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
	it('rejects invalid direct paging and accepts a zero limit', async () => {
		await driver.write('users', 'a', { id: 'a', name: 'Ada', age: 36, active: true })
		expect(() => driver.stream?.('users', { offset: -1 })).toThrow(
			'Query offset must be a nonnegative integer',
		)
		const empty = driver.stream?.('users', { limit: 0 })
		if (empty === undefined) throw new Error('Expected stream capability')
		expect(await collectRows(empty)).toEqual([])
	})

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

	it('maps a dropped-table prepare fault to DRIVER with its SQLite cause', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		try {
			await onDisk.open(SCHEMA)
			native.connect()
			native.exec('DROP TABLE "users"')
			const stream = onDisk.stream?.('users', {})
			if (stream === undefined) throw new Error('Expected stream capability')
			const error = await collectRows(stream).catch((caught: unknown) => caught)
			if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
			expect(error.code).toBe('DRIVER')
			expect(isSQLiteError(error.context?.cause)).toBe(true)
		} finally {
			native.close()
			await onDisk.close()
			temp.cleanup()
		}
	})

	it('omits malformed stored JSON and remains closable', async () => {
		const temp = tempDatabasePath()
		const onDisk = createSQLiteDriver({ path: temp.path })
		const native = createSQLiteDatabase({ path: temp.path })
		try {
			await onDisk.open(SCHEMA)
			await onDisk.write('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
				meta: { valid: true },
			})
			native.connect()
			native.prepare('UPDATE "users" SET "meta" = ? WHERE "id" = ?').run(['{bad', 'u1'])
			const stream = onDisk.stream?.('users', {})
			if (stream === undefined) throw new Error('Expected stream capability')
			expect(await collectRows(stream)).toEqual([{ id: 'u1', name: 'Ada', age: 36, active: true }])
		} finally {
			native.close()
			await onDisk.close()
			temp.cleanup()
		}
	})
})

describe('SQLiteDriver — trusted-query parity vs the core engine', () => {
	// Seed the memory driver (the reference engine) and the SQLite driver with
	// identical rows, then compare native SQLite reads against the engine's
	// applyQuery / computeAggregate over an equivalent scan.
	const META_SCHEMA: readonly TableSchema[] = [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: false, nullable: false },
				{ name: 'active', storage: 'boolean', optional: false, nullable: false },
				{ name: 'meta', storage: 'json', optional: false, nullable: true },
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

	it('matches the engine over a nested (json_extract) equals condition', async () => {
		const input: QueryInput = {
			conditions: [buildCondition(['meta', 'score'], 'above', [4])],
		}
		const expected = (await collectEngineRows(memory, input)).map((row) => row.id)
		const native = sqlite.records === undefined ? [] : await sqlite.records('users', input)
		expect(native.map((row) => row.id).sort()).toEqual([...expected].sort())
	})

	it('matches the engine over an order + page mix', async () => {
		const input: QueryInput = {
			order: [{ column: 'age', direction: 'descending' }],
			limit: 2,
			offset: 1,
		}
		const expected = (await collectEngineRows(memory, input)).map((row) => row.id)
		const native = sqlite.records === undefined ? [] : await sqlite.records('users', input)
		expect(native.map((row) => row.id)).toEqual(expected)
	})

	it('matches the engine aggregate (average) over a filtered set', async () => {
		const input: QueryInput = {
			conditions: [buildCondition('active', 'equals', [true])],
		}
		const expectedRows = await collectEngineRows(memory, input)
		const expected = computeAggregate(expectedRows, 'average', 'age')
		const native =
			sqlite.aggregate === undefined
				? undefined
				: await sqlite.aggregate('users', 'average', 'age', input)
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
	// rewritten operator against the shared engine oracle (`applyQuery` /
	// `computeAggregate` over the memory driver's scan).
	const NULL_SCHEMA: readonly TableSchema[] = [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'rank', storage: 'integer', optional: true, nullable: true },
				{ name: 'meta', storage: 'json', optional: true, nullable: true },
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

	it('round-trips absence and explicit null independently for optional-nullable columns', async () => {
		await sqlite.write('users', 'absent', { id: 'absent' })
		await sqlite.write('users', 'null', { id: 'null', rank: null, meta: null })
		expect(await sqlite.read('users', 'absent')).toEqual({ id: 'absent' })
		expect(await sqlite.read('users', 'null')).toEqual({ id: 'null', rank: null, meta: null })
	})

	it('below on a nullable flat column matches the engine (absent column ranks below every scalar)', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'below', [15])] }
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
	})

	it('to on a nullable flat column matches the engine', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'to', [10])] }
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
	})

	it('a scalar not on a nullable flat column matches the engine (absent column also matches)', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'not', [10])] }
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
	})

	it('a null-operand not on a flat column matches every row (the engine oracle)', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'not', [null])] }
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
		expect(await collectSQLiteIds(sqlite, input)).toEqual(['u1', 'u2', 'u3', 'u4'])
	})

	it('none on a nullable flat column matches the engine (absent column also matches)', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'none', [10, 20])] }
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
	})

	it('a nested equals(null) matches only present-JSON-null, not an absent path', async () => {
		const input: QueryInput = {
			conditions: [buildCondition(['meta', 'note'], 'equals', [null])],
		}
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
		expect(await collectSQLiteIds(sqlite, input)).toEqual(['u1', 'u2'])
	})

	it('a nested not(null) matches an absent path or a present scalar, excluding present-null', async () => {
		const input: QueryInput = { conditions: [buildCondition(['meta', 'note'], 'not', [null])] }
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
	})

	it('a nested below matches the engine (absent path and present-null both rank below a scalar)', async () => {
		const input: QueryInput = { conditions: [buildCondition(['meta', 'tag'], 'below', ['b'])] }
		expect(await collectSQLiteIds(sqlite, input)).toEqual(await collectExpectedIds(memory, input))
	})

	it('count matches the engine over a below-filtered nullable column', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'below', [15])] }
		const expected = (await collectEngineRows(memory, input)).length
		const native =
			sqlite.aggregate === undefined
				? undefined
				: await sqlite.aggregate('users', 'count', 'rank', input)
		expect(native).toBe(expected)
	})

	it('sum over a nullable rank column, below-filtered, matches the engine aggregate', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'below', [25])] }
		const expectedRows = await collectEngineRows(memory, input)
		const expected = computeAggregate(expectedRows, 'sum', 'rank')
		const native =
			sqlite.aggregate === undefined
				? undefined
				: await sqlite.aggregate('users', 'sum', 'rank', input)
		expect(native).toBe(expected)
	})
})

describe('SQLiteDriver — optional-nullable absent/present parity', () => {
	it('agrees across direct records/aggregate/stream and public table/query paths', async () => {
		const exact = createSQLiteDriver()
		const database = createDatabase({
			driver: exact,
			tables: {
				entries: {
					id: stringShape(),
					note: optionalShape(nullableShape(stringShape())),
				},
			},
		})
		const entries = database.table('entries')
		try {
			await entries.set({ id: 'absent' })
			await entries.set({ id: 'null', note: null })
			await entries.set({ id: 'value', note: 'ready' })
			const absent = buildCondition('note', 'absent', [])
			const present = buildCondition('note', 'present', [])

			const cases: ReadonlyArray<{
				readonly condition: Condition
				readonly count: number
			}> = [
				{ condition: absent, count: 2 },
				{ condition: present, count: 1 },
			]
			for (const { condition, count } of cases) {
				const input: QueryInput = { conditions: [condition] }
				expect(await collectSQLiteRecords(exact, 'entries', input)).toHaveLength(count)
				expect(await exact.aggregate?.('entries', 'count', 'note', input)).toBe(count)
				const direct = exact.stream?.('entries', input)
				if (direct === undefined) throw new Error('Expected stream capability')
				expect(await collectRows(direct)).toHaveLength(count)
				expect(await entries.records(input)).toHaveLength(count)
				expect(await entries.count(input)).toBe(count)
				expect(await collectRows(entries.scan(input))).toHaveLength(count)
				const query = entries.query().condition(condition)
				expect(await query.collect()).toHaveLength(count)
				expect(await query.count()).toBe(count)
				expect(await collectRows(query.stream())).toHaveLength(count)
			}
		} finally {
			await database.close()
		}
	})
})

describe('SQLiteDriver — exact ↔ refine gating (the audit fix)', () => {
	// A input whose compiled SQL is NOT provably identical to the engine
	// (like/glob, a null-operand equals/not, an empty any/none, starts case-
	// sensitivity) must go through a full-scan + core-engine refine, never the
	// old always-native path — these are the audit's concrete counter-examples.
	const REFINE_SCHEMA: readonly TableSchema[] = [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'rank', storage: 'integer', optional: false, nullable: true },
			],
			indexes: [],
		},
	]

	let refineDriver = createSQLiteDriver()

	beforeEach(async () => {
		refineDriver = createSQLiteDriver()
		await refineDriver.open(REFINE_SCHEMA)
		await refineDriver.write('users', 'u1', { id: 'u1', name: 'Ada', rank: 10 })
		await refineDriver.write('users', 'u2', { id: 'u2', name: 'ada', rank: 20 })
	})

	afterEach(async () => {
		await refineDriver.close()
	})

	it("starts('ada') refines to case-SENSITIVE matching — 'Ada' never matches", async () => {
		const input: QueryInput = { conditions: [buildCondition('name', 'starts', ['ada'])] }
		const rows = await collectSQLiteRecords(refineDriver, 'users', input)
		expect(rows.map((row) => row.id)).toEqual(['u2'])
	})

	it("starts('') and ends('') match every row of a text column", async () => {
		const startsAll: QueryInput = { conditions: [buildCondition('name', 'starts', [''])] }
		const endsAll: QueryInput = { conditions: [buildCondition('name', 'ends', [''])] }
		expect(
			(await collectSQLiteRecords(refineDriver, 'users', startsAll)).map((row) => row.id).sort(),
		).toEqual(['u1', 'u2'])
		expect(
			(await collectSQLiteRecords(refineDriver, 'users', endsAll)).map((row) => row.id).sort(),
		).toEqual(['u1', 'u2'])
	})

	it('none([null, 20]) refines to the engine: a row with rank=10 MATCHES (a null operand is never exact)', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'none', [null, 20])] }
		const rows = await collectSQLiteRecords(refineDriver, 'users', input)
		expect(rows.map((row) => row.id)).toEqual(['u1'])
	})

	it('any([]) matches nothing; none([]) matches everything — both refine (empty list is never exact)', async () => {
		const anyEmpty: QueryInput = { conditions: [buildCondition('rank', 'any', [])] }
		const noneEmpty: QueryInput = { conditions: [buildCondition('rank', 'none', [])] }
		expect(await collectSQLiteRecords(refineDriver, 'users', anyEmpty)).toEqual([])
		expect(
			(await collectSQLiteRecords(refineDriver, 'users', noneEmpty)).map((row) => row.id).sort(),
		).toEqual(['u1', 'u2'])
	})

	it('above(null) refines to the engine (a null operand is never exact for range operators)', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'above', [null])] }
		const rows = await collectSQLiteRecords(refineDriver, 'users', input)
		// The engine's compareValues ranks every value above `null`'s rank-1 spot
		// except undefined — both rows have a scalar rank, so both match.
		expect(rows.map((row) => row.id).sort()).toEqual(['u1', 'u2'])
	})

	it('a non-ASCII like / a bracketed glob refine to the engine result (never the SQL-native one)', async () => {
		await refineDriver.write('users', 'u3', { id: 'u3', name: 'ÀDA', rank: 30 })
		const likeQueryInput: QueryInput = { conditions: [buildCondition('name', 'like', ['%da%'])] }
		const globQueryInput: QueryInput = { conditions: [buildCondition('name', 'glob', ['[Aa]da'])] }
		const likeRows = await collectSQLiteRecords(refineDriver, 'users', likeQueryInput)
		const globRows = await collectSQLiteRecords(refineDriver, 'users', globQueryInput)
		// The engine's matchesLikePattern/matchesGlobPattern are case-fold/literal per the shared
		// matchesWildcardPattern — assert against the actual engine result rather than a
		// SQL-native guess (the whole point of this test: refine, not native).
		const all = [
			{ id: 'u1', name: 'Ada' },
			{ id: 'u2', name: 'ada' },
			{ id: 'u3', name: 'ÀDA' },
		]
		const { matchesLikePattern, matchesGlobPattern } = await import('@src/core')
		expect(likeRows.map((row) => row.id).sort()).toEqual(
			all.filter((row) => matchesLikePattern(row.name, '%da%')).map((row) => row.id),
		)
		expect(globRows.map((row) => row.id).sort()).toEqual(
			all.filter((row) => matchesGlobPattern(row.name, '[Aa]da')).map((row) => row.id),
		)
	})

	it('equals with an object operand on a json column refines with equalsValue semantics', async () => {
		const jsonSchema: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'meta', storage: 'json', optional: false, nullable: true },
				],
				indexes: [],
			},
		]
		const jsonDriver = createSQLiteDriver()
		await jsonDriver.open(jsonSchema)
		await jsonDriver.write('users', 'u1', { id: 'u1', meta: { a: 1, b: [2, 3] } })
		await jsonDriver.write('users', 'u2', { id: 'u2', meta: { a: 1, b: [2, 4] } })
		const input: QueryInput = {
			conditions: [buildCondition('meta', 'equals', [{ a: 1, b: [2, 3] }])],
		}
		const rows = await collectSQLiteRecords(jsonDriver, 'users', input)
		expect(rows.map((row) => row.id)).toEqual(['u1'])
		await jsonDriver.close()
	})

	it('between with reversed bounds is empty on both the native and the refine path', async () => {
		const input: QueryInput = { conditions: [buildCondition('rank', 'between', [20, 10])] }
		expect(await collectSQLiteRecords(refineDriver, 'users', input)).toEqual([])
		// A null-operand condition forces refine for the whole input via the
		// same reversed-bounds semantics.
		const forcedRefine: QueryInput = {
			conditions: [
				buildCondition('rank', 'between', [20, 10]),
				buildCondition('rank', 'equals', [null]),
			],
		}
		expect(await collectSQLiteRecords(refineDriver, 'users', forcedRefine)).toEqual([])
	})

	it('aggregate refines identically to records when conditions are inexact', async () => {
		const input: QueryInput = { conditions: [buildCondition('name', 'like', ['%da%'])] }
		const rows = await collectSQLiteRecords(refineDriver, 'users', input)
		const sum =
			refineDriver.aggregate === undefined
				? undefined
				: await refineDriver.aggregate('users', 'sum', 'rank', input)
		expect(sum).toBe(computeAggregate(rows, 'sum', 'rank'))
	})

	it('aggregate sum over a text column always refines (never a provably-exact numeric column)', async () => {
		const rows = await collectSQLiteRecords(refineDriver, 'users', {})
		const expected = computeAggregate(rows, 'sum', 'name')
		const native =
			refineDriver.aggregate === undefined
				? undefined
				: await refineDriver.aggregate('users', 'sum', 'name', {})
		expect(native).toBe(expected)
		expect(native).toBeUndefined() // parseNumber('Ada' / 'ada') is undefined — no numeric cells
	})

	it('stream ignores order (per DriverInterface) and refines a non-exact condition lazily', async () => {
		const input: QueryInput = { conditions: [buildCondition('name', 'like', ['%da%'])] }
		const collected: string[] = []
		for await (const row of refineDriver.stream?.('users', input) ?? []) {
			const id = row.id
			if (typeof id === 'string') collected.push(id)
		}
		expect(collected.sort()).toEqual(['u1', 'u2'])
	})
})

describe('SQLiteDriver — reserved _metadata table guard', () => {
	it('throws a VALIDATION DatabaseError when a declared table is named _metadata', async () => {
		const guarded = createSQLiteDriver()
		const badSchema: readonly TableSchema[] = [
			{
				name: '_metadata',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
		]
		const error = await guarded.open(badSchema).catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('VALIDATION')
	})
})

describe('SQLiteDriver — options (path, readonly, pragmas)', () => {
	it('accepts the path option', async () => {
		const configured = createSQLiteDriver({ path: ':memory:' })
		await configured.open(SCHEMA)
		await configured.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		expect(await configured.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		await configured.close()
	})

	it('applies ordered pragmas on open without throwing', async () => {
		const temp = tempDatabasePath()
		const pragmaDriver = createSQLiteDriver({ path: temp.path, pragmas: { journal_mode: 'WAL' } })
		await expect(pragmaDriver.open(SCHEMA)).resolves.toBeUndefined()
		await pragmaDriver.close()
		temp.cleanup()
	})

	it('readonly rejects a write as a typed DRIVER DatabaseError', async () => {
		const temp = tempDatabasePath()
		const writable = createSQLiteDriver({ path: temp.path })
		await writable.open(SCHEMA)
		await writable.write('users', 'u1', { id: 'u1', name: 'Ada', age: 36, active: true })
		await writable.close()

		const readonlyDriver = createSQLiteDriver({ path: temp.path, readonly: true })
		await readonlyDriver.open(SCHEMA)
		expect(await readonlyDriver.read('users', 'u1')).toEqual({
			id: 'u1',
			name: 'Ada',
			age: 36,
			active: true,
		})
		const error = await readonlyDriver
			.write('users', 'u2', { id: 'u2', name: 'Grace', age: 40, active: true })
			.catch((caught: unknown) => caught)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('DRIVER')
		await readonlyDriver.close()
		temp.cleanup()
	})
})
