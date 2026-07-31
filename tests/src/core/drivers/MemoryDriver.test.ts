import type { Condition, Migration, TableSchema } from '@src/core'
import { createMemoryDriver, isDatabaseError, planMigration } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { collectRows, conformDriver, tableSchemas } from '../../../setup.js'

conformDriver('MemoryDriver', () => createMemoryDriver())

describe('MemoryDriver', () => {
	it('readies the named tables on open (a scan returns nothing, not an error)', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users', 'posts'))
		expect(await driver.keys('users')).toEqual([])
		expect(await collectRows(driver.scan('posts'))).toEqual([])
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
		expect((await collectRows(driver.scan('t'))).map((row) => row.id)).toEqual(['a', 'b'])
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
		expect((await collectRows(driver.scan('t'))).map((row) => row.id)).toEqual(['a', 'b', 'c'])
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
		expect((await collectRows(driver.scan('t'))).map((row) => row.id)).toEqual([1, 2, 10])
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

	it('rolls back to a snapshot', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		await driver.write('t', 'a', { id: 'a', n: 1 })
		const rollback = await driver.snapshot()
		await driver.write('t', 'a', { id: 'a', n: 2 })
		await driver.write('t', 'b', { id: 'b' })
		expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 2 })
		await rollback()
		expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 1 })
		expect(await driver.read('t', 'b')).toBeUndefined()
	})

	it('rolls back a NESTED field mutated in place (on a read-back row) between snapshot and restore', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('t'))
		const original = { id: 'a', meta: { tags: ['x'] } }
		await driver.write('t', 'a', original)
		const rollback = await driver.snapshot()
		// Read back the row and mutate its nested field in place — a snapshot
		// that shares nested references (or only clones top-level fields) would
		// restore this mutated value instead of the pre-snapshot one.
		const before = await driver.read('t', 'a')
		if (before !== undefined && isRecord(before.meta) && Array.isArray(before.meta.tags)) {
			before.meta.tags.push('mutated-between-snapshot-and-restore')
		}
		await driver.write('t', 'a', { id: 'a', meta: { tags: ['x', 'overwritten'] } })
		await rollback()
		expect(await driver.read('t', 'a')).toEqual({ id: 'a', meta: { tags: ['x'] } })
	})

	describe('stream', () => {
		it('yields condition-matched rows only, in key order', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('t'))
			await driver.write('t', 'c', { id: 'c', n: 3 })
			await driver.write('t', 'a', { id: 'a', n: 1 })
			await driver.write('t', 'b', { id: 'b', n: 2 })
			const conditions: readonly Condition[] = [
				{ column: 'n', operator: 'above', values: [1], connector: 'and' },
			]
			const rows = await collectRows(
				driver.stream?.('t', { conditions }) ?? (async function* () {})(),
			)
			expect(rows.map((row) => row.id)).toEqual(['b', 'c'])
		})

		it('applies offset then limit lazily', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('t'))
			await driver.write('t', 'a', { id: 'a' })
			await driver.write('t', 'b', { id: 'b' })
			await driver.write('t', 'c', { id: 'c' })
			await driver.write('t', 'd', { id: 'd' })
			const rows = await collectRows(
				driver.stream?.('t', { offset: 1, limit: 2 }) ?? (async function* () {})(),
			)
			expect(rows.map((row) => row.id)).toEqual(['b', 'c'])
		})

		it('rejects invalid direct paging and accepts a zero limit', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('t'))
			await driver.write('t', 'a', { id: 'a' })
			expect(() => driver.stream?.('t', { limit: -1 })).toThrow(
				expect.objectContaining({
					code: 'VALIDATION',
					context: { field: 'limit', value: -1 },
				}),
			)
			const empty = driver.stream?.('t', { limit: 0 })
			if (empty === undefined) throw new Error('Expected stream capability')
			expect(await collectRows(empty)).toEqual([])
		})

		it('ignores input.order (yields key order regardless)', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('t'))
			await driver.write('t', 'b', { id: 'b', n: 2 })
			await driver.write('t', 'a', { id: 'a', n: 1 })
			const rows = await collectRows(
				driver.stream?.('t', { order: [{ column: 'n', direction: 'descending' }] }) ??
					(async function* () {})(),
			)
			expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
		})

		it('yields copy-out rows, isolated from later mutation', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('t'))
			await driver.write('t', 'a', { id: 'a', n: 1 })
			const [row] = await collectRows(driver.stream?.('t', {}) ?? (async function* () {})())
			if (row) row.n = 999
			expect(await driver.read('t', 'a')).toEqual({ id: 'a', n: 1 })
		})

		it('terminates cleanly on an early break', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('t'))
			await driver.write('t', 'a', { id: 'a' })
			await driver.write('t', 'b', { id: 'b' })
			await driver.write('t', 'c', { id: 'c' })
			const seen: string[] = []
			const source = driver.stream?.('t', {})
			if (source !== undefined) {
				for await (const row of source) {
					if (typeof row.id === 'string') seen.push(row.id)
					if (seen.length === 2) break
				}
			}
			expect(seen).toEqual(['a', 'b'])
		})

		it('yields nothing for an empty declared table and rejects an unknown table', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			expect(await collectRows(driver.stream?.('users', {}) ?? (async function* () {})())).toEqual(
				[],
			)
			await expect(
				collectRows(driver.stream?.('missing', {}) ?? driver.scan('missing')),
			).rejects.toMatchObject({
				code: 'NOT_FOUND',
			})
		})
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
			const metadata = {
				get version(): number {
					throw fault
				},
				schema: [],
			}
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

	describe('scoped snapshot', () => {
		it('restores only the listed tables; unlisted tables keep later mutations', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users', 'posts'))
			await driver.write('users', 'a', { id: 'a', n: 1 })
			await driver.write('posts', 'p1', { id: 'p1', n: 1 })
			const rollback = await driver.snapshot(['users'])
			await driver.write('users', 'a', { id: 'a', n: 2 })
			await driver.write('posts', 'p1', { id: 'p1', n: 2 })
			await rollback()
			expect(await driver.read('users', 'a')).toEqual({ id: 'a', n: 1 })
			expect(await driver.read('posts', 'p1')).toEqual({ id: 'p1', n: 2 })
		})

		it('with no argument still restores the whole store', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users', 'posts'))
			await driver.write('users', 'a', { id: 'a', n: 1 })
			await driver.write('posts', 'p1', { id: 'p1', n: 1 })
			const rollback = await driver.snapshot()
			await driver.write('users', 'a', { id: 'a', n: 2 })
			await driver.write('posts', 'p1', { id: 'p1', n: 2 })
			await rollback()
			expect(await driver.read('users', 'a')).toEqual({ id: 'a', n: 1 })
			expect(await driver.read('posts', 'p1')).toEqual({ id: 'p1', n: 1 })
		})
	})

	describe('schema-aware snapshot', () => {
		it('ignores unknown names without restoring a known table', async () => {
			const driver = createMemoryDriver()
			await driver.open(tableSchemas('users'))
			await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
			const rollback = await driver.snapshot(['missing', 'missing'])
			await driver.write('users', 'u1', { id: 'u1', value: 'current' })
			await rollback()
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'current' })
		})

		it('restores captured rows repeatedly while preserving a later table and current metadata', async () => {
			const driver = createMemoryDriver()
			const before = tableSchemas('users')
			const logs: TableSchema = {
				name: 'logs',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			}
			const current = [...before, logs]
			await driver.open(before)
			await driver.stamp?.({ version: 1, schema: before })
			await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
			const rollback = await driver.snapshot()
			await driver.migrate?.({
				plan: planMigration(before, current, 1, 2),
				metadata: { version: 2, schema: current },
			})
			await driver.write('users', 'u1', { id: 'u1', value: 'changed' })
			await driver.write('users', 'u2', { id: 'u2' })
			await driver.write('logs', 'l1', { id: 'l1', value: 'current' })

			await rollback()
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'captured' })
			expect(await driver.read('users', 'u2')).toBeUndefined()
			expect(await driver.read('logs', 'l1')).toEqual({ id: 'l1', value: 'current' })
			expect(await driver.metadata?.()).toEqual({ version: 2, schema: current })

			await driver.write('users', 'u1', { id: 'u1', value: 'changed again' })
			await rollback()
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'captured' })
			expect(await driver.read('logs', 'l1')).toEqual({ id: 'l1', value: 'current' })
		})

		it('skips a captured table removed after capture', async () => {
			const driver = createMemoryDriver()
			const schema = tableSchemas('users')
			await driver.open(schema)
			await driver.write('users', 'u1', { id: 'u1' })
			const rollback = await driver.snapshot()
			await driver.migrate?.({ plan: planMigration(schema, []) })
			await rollback()
			await expect(driver.keys('users')).rejects.toMatchObject({ code: 'NOT_FOUND' })
		})

		it('skips a same-name table removed and re-added by one ordered migration', async () => {
			const driver = createMemoryDriver()
			const [users] = tableSchemas('users')
			if (users === undefined) throw new Error('Expected users schema')
			await driver.open([users])
			await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
			const rollback = await driver.snapshot()
			await driver.migrate?.({
				plan: {
					from: 1,
					to: 2,
					steps: [
						{ operation: 'table.remove', table: 'users' },
						{ operation: 'table.add', table: users },
					],
				},
			})
			await driver.write('users', 'u2', { id: 'u2', value: 'replacement' })
			await rollback()
			expect(await driver.keys('users')).toEqual(['u2'])
			expect(await driver.read('users', 'u2')).toEqual({
				id: 'u2',
				value: 'replacement',
			})
		})

		it('adapts captured rows through a compatible column removal', async () => {
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
			const current: TableSchema = {
				...before,
				columns: [before.columns[0]].filter(
					(column): column is NonNullable<typeof column> => column !== undefined,
				),
			}
			await driver.open([before])
			await driver.write('users', 'u1', { id: 'u1', legacy: 'captured' })
			const rollback = await driver.snapshot()
			await driver.migrate?.({ plan: planMigration([before], [current]) })
			await driver.write('users', 'u1', { id: 'u1', current: true })
			await rollback()
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
		})

		it('rejects incompatible replay before mutation and remains retryable', async () => {
			const driver = createMemoryDriver()
			const before: TableSchema = {
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'value', storage: 'text', optional: false, nullable: false },
				],
				indexes: [],
			}
			const primary = before.columns[0]
			if (primary === undefined) throw new Error('Expected the primary column fixture')
			const incompatible: TableSchema = {
				...before,
				columns: [primary, { name: 'value', storage: 'integer', optional: false, nullable: false }],
			}
			const compatible: TableSchema = {
				...before,
				columns: [primary],
			}
			await driver.open([before])
			await driver.write('users', 'u1', { id: 'u1', value: 'captured' })
			const rollback = await driver.snapshot()
			await driver.write('users', 'u1', { id: 'u1', value: 'current' })
			await driver.open([incompatible])

			await expect(rollback()).rejects.toMatchObject({ code: 'MIGRATION' })
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', value: 'current' })

			await driver.open([compatible])
			await rollback()
			expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
		})
	})
})
