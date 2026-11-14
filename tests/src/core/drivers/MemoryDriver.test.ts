import type { Migration, TableSchema } from '@src/core'
import {
	conformDriver,
	createMemoryDriver,
	isDatabaseError,
	planMigration,
	StorageJournal,
} from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { collect } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	createRecordedUsers,
	createUnclonableMetadata,
	EMPTY_STORAGE_CASES,
	EMPTY_TABLE_CASES,
	tableSchemas,
} from '../../../setup.js'

// The shared driver-conformance battery over this backend. `conformDriver` (`@src/core`) owns the
// schema, the required-primitive checks, and the presence-gated optional-hook coverage (migrate /
// stream / transaction); each backend suite registers its own case.
describe('driver conformance — MemoryDriver', () => {
	it('conforms to DriverInterface', async () => {
		await expect(conformDriver(() => createMemoryDriver())).resolves.toBeUndefined()
	})
})

describe('MemoryDriver', () => {
	it('readies the named tables on open (a scan returns nothing, not an error)', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users', 'posts'))
		expect(await driver.keys('users')).toEqual([])
		expect(await collect(driver.scan('posts'))).toEqual([])
	})

	it('reads back what it writes, and misses return undefined / false', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		await driver.write('t', 'a', { id: 'a', n: 1 })
		expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('t', 'missing')).toBeUndefined()
		expect(await driver.delete('t', 'missing')).toBe(false)
		expect(await driver.delete('t', 'a')).toBe(true)
		expect(await driver.read('t', 'a')).toBeUndefined()
	})

	it('binds the authoritative key into a custom primary on write and insert', async () => {
		const driver = createMemoryDriver()
		const posts: TableSchema = {
			name: 'posts',
			primary: 'slug',
			columns: [
				{ name: 'slug', storage: 'text', optional: false, nullable: false },
				{ name: 'title', storage: 'text', optional: false, nullable: false },
			],
			indexes: [],
		}
		await driver.open([posts])
		await driver.write('posts', 'written', { slug: 'caller', title: 'Write' })
		await driver.insert('posts', 'inserted', { slug: 'caller', title: 'Insert' })
		expect(await driver.read('posts', 'written')).toEqual({ slug: 'written', title: 'Write' })
		expect(await driver.read('posts', 'inserted')).toEqual({ slug: 'inserted', title: 'Insert' })
	})

	it('rejects raw operations against undeclared tables', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		await expect(driver.write('missing', 'a', { id: 'a' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
		await expect(driver.insert('missing', 'a', { id: 'a' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
		await expect(driver.read('missing', 'a')).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	it('rejects pre-aborted point mutations without changing rows', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		await driver.write('t', 'a', { id: 'a', n: 1 })
		const controller = new AbortController()
		controller.abort('stop')
		await expect(
			driver.write('t', 'b', { id: 'b', n: 2 }, { signal: controller.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		await expect(
			driver.insert('t', 'b', { id: 'b', n: 2 }, { signal: controller.signal }),
		).rejects.toMatchObject({ code: 'ABORTED' })
		await expect(driver.delete('t', 'a', { signal: controller.signal })).rejects.toMatchObject({
			code: 'ABORTED',
		})
		expect(await driver.keys('t')).toEqual(['a'])
	})

	it('atomically accepts one of two simultaneous same-key inserts', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		const outcomes = await Promise.allSettled([
			driver.insert('t', 'a', { id: 'a', n: 1 }),
			driver.insert('t', 'a', { id: 'a', n: 2 }),
		])
		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
		const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
		expect(rejected).toHaveLength(1)
		expect(rejected[0]?.reason).toMatchObject({ code: 'CONFLICT' })
		expect(await driver.keys('t')).toEqual(['a'])
	})

	it('lists keys and scans every row', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		await driver.write('t', 'a', { id: 'a' })
		await driver.write('t', 'b', { id: 'b' })
		expect(await driver.keys('t')).toEqual(['a', 'b'])
		expect((await collect(driver.scan('t'))).map((row) => row.id)).toEqual(['a', 'b'])
		await driver.clear('t')
		expect(await driver.keys('t')).toEqual([])
	})

	it('yields keys and scans rows in KEY order, not insertion order', async () => {
		// The DriverInterface contract: scan iterates in key order and keys lists in
		// order (guides/src/database.md). Writing OUT of key order must NOT leak Map
		// insertion order — the reference driver sorts by the core total order, so it
		// agrees with the SQLite (ORDER BY) and IndexedDB (key-ranged) backends.
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		await driver.write('t', 'c', { id: 'c' })
		await driver.write('t', 'a', { id: 'a' })
		await driver.write('t', 'b', { id: 'b' })
		expect(await driver.keys('t')).toEqual(['a', 'b', 'c'])
		expect((await collect(driver.scan('t'))).map((row) => row.id)).toEqual(['a', 'b', 'c'])
	})

	it('orders numeric keys numerically (not lexicographically)', async () => {
		// The core total order ranks number < string and sorts numbers naturally, so
		// 2 precedes 10 — matching how a numeric primary key sorts on a native backend.
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		await driver.write('t', 10, { id: 10 })
		await driver.write('t', 2, { id: 2 })
		await driver.write('t', 1, { id: 1 })
		expect(await driver.keys('t')).toEqual([1, 2, 10])
		expect((await collect(driver.scan('t'))).map((row) => row.id)).toEqual([1, 2, 10])
	})

	it('isolates stored rows from caller mutation (copy in, copy out)', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		const input = { id: 'a', n: 1 }
		await driver.write('t', 'a', input)
		input.n = 999 // mutate the caller's object after writing
		const read = await driver.read('t', 'a')
		expect(read?.n).toBe(1)
		if (read) read.n = 42 // mutate the returned copy
		expect((await driver.read('t', 'a'))?.n).toBe(1)
	})

	it('deep-isolates NESTED fields from caller mutation (copy in, copy out)', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		const input = { id: 'a', meta: { tags: ['x'], deep: { flag: true } } }
		await driver.write('t', 'a', input)
		// Mutate a nested field of the input AFTER write — a shallow `{ ...row }`
		// copy would still share the nested `meta` object by reference.
		input.meta.tags.push('mutated')
		input.meta.deep.flag = false
		const read = await driver.read('t', 'a')
		expect(read).toEqual({ id: 'a', meta: { tags: ['x'], deep: { flag: true } } })
		// Mutate a nested field of the READ result — a shallow copy-out would
		// still share the nested object with stored state.
		if (read !== undefined && isRecord(read.meta) && Array.isArray(read.meta.tags)) {
			read.meta.tags.push('mutated-after-read')
		}
		const reread = await driver.read('t', 'a')
		expect(reread).toEqual({ id: 'a', meta: { tags: ['x'], deep: { flag: true } } })
	})

	it('retains native structured-clone isolation for non-JSON row values', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		const bytes = new Uint8Array([1, 2, 3])
		const blob = new Blob(['row'])
		await driver.write('t', 'a', { id: 'a', bytes, blob })
		bytes[0] = 9

		const read = await driver.read('t', 'a')
		if (read === undefined) throw new Error('Expected stored row')
		expect(read.bytes).toBeInstanceOf(Uint8Array)
		expect(read.blob).toBeInstanceOf(Blob)
		if (!(read.bytes instanceof Uint8Array)) throw new Error('Expected Uint8Array')
		if (!(read.blob instanceof Blob)) throw new Error('Expected Blob')
		expect([...read.bytes]).toEqual([1, 2, 3])
		expect(await read.blob.text()).toBe('row')
		expect(read.bytes).not.toBe(bytes)
		expect(read.blob).not.toBe(blob)

		read.bytes[0] = 8
		const reread = await driver.read('t', 'a')
		if (reread === undefined || !(reread.bytes instanceof Uint8Array)) {
			throw new Error('Expected stored Uint8Array')
		}
		expect([...reread.bytes]).toEqual([1, 2, 3])
	})

	describe('batches', () => {
		it('reads a key list in its order, with undefined for each miss', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'u1', { id: 'u1', n: 1 })
			await driver.write('users', 'u2', { id: 'u2', n: 2 })
			expect(await driver.read('users', ['u2', 'missing', 'u1'])).toEqual([
				{ id: 'u2', n: 2 },
				undefined,
				{ id: 'u1', n: 1 },
			])
		})

		it('writes every listed row at the key of its position', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write(
				'users',
				['u1', 'u2'],
				[
					{ id: 'caller', n: 1 },
					{ id: 'u2', n: 2 },
				],
			)
			expect(await driver.read('users', ['u1', 'u2'])).toEqual([
				{ id: 'u1', n: 1 },
				{ id: 'u2', n: 2 },
			])
		})

		it('writes no listed row when a final row cannot be stored', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await expect(
				driver.write('users', ['u1', 'u2'], [{ id: 'u1' }, { id: 'u2', run: () => 'unclonable' }]),
			).rejects.toMatchObject({ name: 'DataCloneError' })
			expect(await driver.keys('users')).toEqual([])
		})

		it('inserts no listed row when the final member conflicts', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'u1', { id: 'u1', n: 1 })
			await expect(
				driver.insert('users', ['u2', 'u3', 'u1'], [{ id: 'u2' }, { id: 'u3' }, { id: 'u1' }]),
			).rejects.toMatchObject({ code: 'CONFLICT', context: { key: 'u1' } })
			expect(await driver.keys('users')).toEqual(['u1'])
		})

		it('inserts no listed row when the batch repeats a key', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await expect(
				driver.insert('users', ['u2', 'u2'], [{ id: 'u2' }, { id: 'u2' }]),
			).rejects.toMatchObject({ code: 'CONFLICT', context: { key: 'u2' } })
			expect(await driver.keys('users')).toEqual([])
		})

		it('deletes a key list, reporting true for the first occurrence of each stored key', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', ['u1', 'u2'], [{ id: 'u1' }, { id: 'u2' }])
			expect(await driver.delete('users', ['u1', 'missing', 'u1'])).toEqual([true, false, false])
			expect(await driver.keys('users')).toEqual(['u2'])
		})

		it('refuses lists of different lengths ahead of any write', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await expect(driver.write('users', ['u1', 'u2'], [{ id: 'u1' }])).rejects.toMatchObject({
				code: 'VALIDATION',
				context: { keys: 2, rows: 1 },
			})
			expect(await driver.keys('users')).toEqual([])
		})
	})
	it('declares no plan and no stream, so the core answers every read over scan', () => {
		const driver = createMemoryDriver()
		expect(driver.plan).toBeUndefined()
		expect(driver.stream).toBeUndefined()
		expect(driver.records).toBeUndefined()
	})

	describe('migrate', () => {
		it('applies a table.add step by creating the table', async () => {
			const driver = createMemoryDriver()
			const plan = planMigration([], tableSchemas('users'))
			await driver.migrate?.({ plan })
			expect(await driver.keys('users')).toEqual([])
		})

		it('applies a table.remove step by dropping the table and its rows', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'a', { id: 'a' })
			const plan = planMigration(tableSchemas('users'), [])
			await driver.migrate?.({ plan })
			await driver.open(tableSchemas('users'))
			expect(await driver.keys('users')).toEqual([])
		})

		it('applies a column.remove step by stripping the field from every stored row', async () => {
			const driver = createMemoryDriver()
			const before: TableSchema = {
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'legacy', storage: 'text', optional: false, nullable: false },
				],
				indexes: [],
			}
			await driver.open([before])
			await driver.write('users', 'a', { id: 'a', name: 'Ada', legacy: true })
			await driver.write('users', 'b', { id: 'b', name: 'Grace', legacy: false })
			const after: TableSchema = {
				name: 'users',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			}
			const plan = planMigration([before], [after])
			await driver.migrate?.({ plan })
			expect(await driver.read('users', 'a')).toEqual({ id: 'a', name: 'Ada' })
			expect(await driver.read('users', 'b')).toEqual({ id: 'b', name: 'Grace' })
		})

		it('throws a MIGRATION DatabaseError when a step references an unknown table', async () => {
			const driver = createMemoryDriver()
			const plan = planMigration(tableSchemas('missing'), [])
			const error = await driver.migrate?.({ plan }).catch((caught: unknown) => caught)
			expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		})

		it('rolls back rows and metadata when a later migration step fails', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'a', { id: 'a', legacy: true })
			const before = { version: 1, schema: tableSchemas('users') }
			await driver.stamp?.(before)
			const plan: Migration = {
				from: 1,
				to: 2,
				steps: [
					{ operation: 'column.remove', table: 'users', column: 'legacy' },
					{ operation: 'table.remove', table: 'ghost' },
				],
			}
			await expect(
				driver.migrate?.({ plan, metadata: { version: 2, schema: [] } }),
			).rejects.toMatchObject({ code: 'MIGRATION' })
			expect(await driver.read('users', 'a')).toEqual({ id: 'a', legacy: true })
			expect(await driver.metadata?.()).toEqual(before)
		})

		it('owns metadata before publishing migrated rows', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'a', { id: 'a', legacy: true })
			const before = { version: 1, schema: tableSchemas('users') }
			await driver.stamp?.(before)
			const fault = new Error('metadata cannot be cloned')
			const metadata = createUnclonableMetadata(fault)
			const plan: Migration = {
				from: 1,
				to: 2,
				steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
			}
			await expect(driver.migrate?.({ plan, metadata })).rejects.toMatchObject({
				code: 'VALIDATION',
				context: { path: 'migration' },
			})
			expect(await driver.read('users', 'a')).toEqual({ id: 'a', legacy: true })
			expect(await driver.metadata?.()).toEqual(before)
		})

		it('publishes a migration-owned metadata snapshot', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			const schema = [...tableSchemas('users')]
			const metadata = { version: 2, schema }
			const plan: Migration = { from: 1, to: 2, steps: [] }
			await driver.migrate?.({ plan, metadata })
			metadata.version = 9
			schema.push({ name: 'posts', primary: 'id', columns: [], indexes: [] })

			expect(await driver.metadata?.()).toEqual({
				version: 2,
				schema: tableSchemas('users'),
			})
		})

		it('accepts reorder-only migration metadata while retaining canonical runtime schema', async () => {
			const driver = createMemoryDriver()
			const canonical = tableSchemas('users', 'posts')
			await driver.open(canonical)
			const reordered = [...canonical].reverse()
			await driver.migrate?.({
				plan: { from: 1, to: 2, steps: [] },
				metadata: { version: 2, schema: reordered },
			})
			expect(await driver.metadata?.()).toEqual({ version: 2, schema: reordered })
			await expect(driver.write('users', 'u1', { id: 'u1' })).resolves.toBeUndefined()
		})

		it('rejects an unsafe required column before rows, schema, or metadata change', async () => {
			const driver = createMemoryDriver()
			const before = tableSchemas('users')
			await driver.open(before)
			await driver.write('users', 'u1', { id: 'u1' })
			await driver.stamp?.({ version: 1, schema: before })
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
									name: 'name',
									storage: 'text',
									optional: false,
									nullable: false,
								},
							},
						],
					},
					metadata: { version: 2, schema: before },
				}),
			).rejects.toMatchObject({
				code: 'MIGRATION',
				context: { table: 'users', column: 'name' },
			})
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
			expect(await driver.metadata?.()).toEqual({ version: 1, schema: before })
		})
	})

	describe('metadata / stamp', () => {
		it('snapshots stamp input and returns distinct deeply frozen copies', async () => {
			const driver = createMemoryDriver()
			expect(await driver.metadata?.()).toBeUndefined()
			const schema = [...tableSchemas('users')]
			const metadata = { version: 3, schema }
			await driver.stamp?.(metadata)
			metadata.version = 9
			schema.push({ name: 'posts', primary: 'id', columns: [], indexes: [] })

			const first = await driver.metadata?.()
			const second = await driver.metadata?.()
			if (first === undefined || second === undefined) throw new Error('Expected metadata')
			const [table] = first.schema
			expect(first).toEqual({ version: 3, schema: tableSchemas('users') })
			expect(first).not.toBe(second)
			expect(first.schema).not.toBe(second.schema)
			expect(Object.isFrozen(first)).toBe(true)
			expect(Object.isFrozen(first.schema)).toBe(true)
			expect(Object.isFrozen(table)).toBe(true)
			expect(Object.isFrozen(table?.columns)).toBe(true)
			expect(Object.isFrozen(table?.indexes)).toBe(true)
			expect(Reflect.set(first, 'version', 10)).toBe(false)
			expect(await driver.metadata?.()).toEqual({ version: 3, schema: tableSchemas('users') })
		})
	})
})

describe('MemoryDriver — empty lists', () => {
	for (const { member, run, expected } of EMPTY_STORAGE_CASES) {
		it(`answers an empty ${member} list and touches no row`, async () => {
			const { recorder, db } = createRecordedUsers(createMemoryDriver())
			try {
				await db.open()
				const { value, calls } = await recorder.measure(() => run(recorder.driver))
				expect(value).toEqual(expected)
				expect(calls.filter((call) => call.keys > 0 || call.rows > 0)).toEqual([])
			} finally {
				await db.close()
			}
		})

		it(`answers an empty ${member} list through the journal and restores nothing`, async () => {
			const { recorder, db } = createRecordedUsers(createMemoryDriver())
			try {
				await db.open()
				const journal = new StorageJournal(recorder.driver)
				const { value, calls } = await recorder.measure(async () => {
					const answer = await run(journal)
					await journal.restore()
					return answer
				})
				expect(value).toEqual(expected)
				expect(calls.filter((call) => call.keys > 0 || call.rows > 0)).toEqual([])
			} finally {
				await db.close()
			}
		})
	}

	for (const { member, run, expected } of EMPTY_TABLE_CASES) {
		it(`answers Table ${member} of an empty list and touches no row`, async () => {
			const { recorder, db, users } = createRecordedUsers(createMemoryDriver())
			try {
				await db.open()
				const { value, calls } = await recorder.measure(() => run(users))
				expect(value).toEqual(expected)
				expect(calls.filter((call) => call.keys > 0 || call.rows > 0)).toEqual([])
			} finally {
				await db.close()
			}
		})
	}
})
