import type {
	ColumnMap,
	DatabaseEventMap,
	DatabaseInterface,
	DriverInterface,
	CursorInterface,
	MigrationInput,
	QueryInterface,
	Row,
	RowOf,
	TableInterface,
	TableSchema,
} from '@src/core'
import type { UserRow } from '../../setup.js'
import { createDatabase, createMemoryDriver, isDatabaseError } from '@src/core'
import { integerShape, optionalShape, stringShape } from '@orkestrel/contract'
import { createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	createConstrainedUsersDatabase as userDatabase,
	createMemoryAdapter,
	createReconciliationDriver,
	IteratorSource,
	RecordingIterator,
	recordEmitterEvents,
	tableSchemas,
} from '../../setup.js'

// Database-level behavior only — lazy connect / close lifecycle, the per-table
// `keys` / `indexes` options, the typed `table()` accessor, `import` / `export`,
// `transaction`, and the push observation `emitter` (§13). Keyed CRUD, batch
// overloads, coercion / error paths, and contract introspection are `Table`'s own
// surface and live in `Table.test.ts`.

describe('Database lifecycle', () => {
	it('connects lazily on first use', async () => {
		const { db, users } = userDatabase()
		expect(db.status).toBe('idle')
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		expect(db.status).toBe('open')
	})

	it('opens explicitly without an operation', async () => {
		const { db } = userDatabase()
		await db.open()
		expect(db.status).toBe('open')
	})

	it('retries a failed lazy driver open and publishes one successful open transition', async () => {
		const memory = createMemoryDriver()
		const failure = new Error('first open failed')
		const opens: Array<readonly TableSchema[]> = []
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async open(schema) {
				opens.push(schema)
				if (opens.length === 1) throw failure
				await memory.open(schema)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const events = recordEmitterEvents(db.emitter, ['open'])

		await expect(db.open()).rejects.toBe(failure)
		expect(db.status).toBe('idle')
		expect(events.open.count).toBe(0)
		await expect(db.open()).resolves.toBeUndefined()
		expect(opens).toHaveLength(2)
		expect(db.status).toBe('open')
		expect(events.open.calls).toEqual([[]])
		await db.table('users').set({ id: 'u1', name: 'Ada' })
		expect(await db.table('users').get('u1')).toEqual({ id: 'u1', name: 'Ada' })
	})

	it('does not republish open when reconciliation retries after physical open succeeded', async () => {
		const memory = createMemoryDriver()
		let schema: readonly TableSchema[] = []
		let metadata = 0
		let opens = 0
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async open(declared) {
				opens += 1
				schema = declared
				await memory.open(declared)
			},
			async metadata() {
				metadata += 1
				return { version: metadata === 1 ? 2 : 1, schema }
			},
			async stamp() {},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		const events = recordEmitterEvents(db.emitter, ['open'])

		await expect(db.open()).rejects.toMatchObject({ code: 'MIGRATION' })
		expect(db.status).toBe('open')
		expect(events.open.calls).toEqual([[]])
		await expect(db.open()).resolves.toBeUndefined()
		expect(opens).toBe(2)
		expect(events.open.calls).toEqual([[]])
	})

	it('rejects operations after close', async () => {
		const { db, users } = userDatabase()
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		await db.close()
		expect(db.status).toBe('closed')
		await expect(users.get('u1')).rejects.toMatchObject({ code: 'CLOSED' })
	})
})

describe('table() accessor', () => {
	it('returns the typed table for a declared name', () => {
		const { db } = userDatabase()
		const users = db.table('users')
		expect(users.name).toBe('users')
		expect(users.primary).toBe('id')
	})

	// Type-level regression lock (§2 types-first): a `db.table('x')` result annotated
	// against a concrete `TableInterface<UserRow>` — exactly what `setup.ts`'s
	// `createConstrainedUsersDatabase` does (its `db`, inferred through
	// `createDatabase<const T>`, only widens to `DatabaseInterface` in the returned
	// object field; the `table('users')` call itself runs over the concrete `T`).
	// This annotation compiles ONLY while the `TableInterface<RowOf<T[K]>>` → concrete
	// relation stays shallow; a return of the TS2589 instantiation-depth blow-up fails
	// `npm run check`, never silently. `db` is also handed to a `DatabaseInterface`
	// slot to lock the open-view widening the same call site relies on.
	it('locks the concrete-consumer annotation pattern (guards TS2589)', () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const users: TableInterface<UserRow> = db.table('users')
		const view: DatabaseInterface = db
		expect(users.name).toBe('users')
		expect(view.name).toBe('database')
	})

	// Type-level precision lock: a concrete column map must infer its EXACT row.
	// `TableInterface<T>` carries `T` in both co- and contravariant positions, so a
	// clean assignment against `TableInterface<WidgetRow>` holds only when the
	// inferred row is mutually assignable with `{ id: string; age: number }` — a
	// widening to `Row` (or any drift) breaks it.
	it('infers a declared table row precisely', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { widgets: { id: stringShape(), age: integerShape() } },
		})
		const widgets: TableInterface<{ readonly id: string; readonly age: number }> =
			db.table('widgets')
		await widgets.set({ id: 'w1', age: 7 })
		const found = await widgets.get('w1')
		expect(found?.age).toBe(7)
	})

	// Type-level regression lock: contract 0.0.4's non-distributive `Infer` resolves
	// the OPEN case of `RowOf<ColumnMap>` directly to {@link Row} — mutually assignable
	// both directions, with no `[ColumnMap] extends [C]` short-circuit. A regression to
	// a broader or narrower inferred shape (or a TS2589 blow-up) fails `npm run check`.
	it('keeps RowOf<ColumnMap> mutually assignable with Row (open case)', () => {
		const row: Row = { id: 'u1' }
		const asOpen: RowOf<ColumnMap> = row
		const asRow: Row = asOpen
		expect(asRow).toBe(row)
	})
})

describe('primary option', () => {
	it('names a non-id primary-key column per table', async () => {
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

describe('indexes option', () => {
	it('accepts a per-table indexes option; CRUD works (the scan-only driver ignores it)', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: {
				posts: { id: stringShape(), title: stringShape(), author: stringShape() },
			},
			indexes: { posts: [['title'], ['author', 'title']] },
		})
		const posts = db.table('posts')
		await posts.set({ id: 'p1', title: 'Hello', author: 'u1' })
		await posts.set({ id: 'p2', title: 'World', author: 'u1' })
		expect((await posts.get('p1'))?.title).toBe('Hello')
		expect(await posts.count()).toBe(2)
		expect(
			(
				await posts
					.query()
					.condition({ column: 'author', operator: 'equals', values: ['u1'], connector: 'and' })
					.collect()
			).map((p) => p.id),
		).toEqual(['p1', 'p2'])
	})
})

describe('import / export', () => {
	it('imports tables as a typed view over the same driver', async () => {
		const { db, users } = userDatabase()
		const logs = db.import({ logs: { id: stringShape(), msg: stringShape() } }).table('logs')
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		await logs.set({ id: 'l1', msg: 'hello' })
		expect((await logs.get('l1'))?.msg).toBe('hello')
		// Same driver/storage: the original table is still intact.
		expect((await users.get('u1'))?.name).toBe('Ada')
	})

	it('shares one emitter, status, merged schema, and terminal close across views', async () => {
		const { db, users } = userDatabase()
		const logs = db.import({ logs: { id: stringShape(), message: stringShape() } })
		const sessions = db.import({ sessions: { id: stringShape(), user: stringShape() } })
		expect(logs.emitter).toBe(db.emitter)
		expect(sessions.emitter).toBe(db.emitter)
		const events = recordEmitterEvents(db.emitter, ['close'])

		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		await logs.table('logs').set({ id: 'l1', message: 'started' })
		await sessions.table('sessions').set({ id: 's1', user: 'u1' })
		expect(db.status).toBe('open')
		expect(logs.status).toBe('open')
		expect(sessions.status).toBe('open')

		await logs.close()
		expect(db.status).toBe('closed')
		expect(sessions.status).toBe('closed')
		await db.close()
		expect(events.close.count).toBe(1)
		await expect(users.get('u1')).rejects.toMatchObject({ code: 'CLOSED' })
	})

	it('accepts identical same-name registration and rejects a conflicting schema', () => {
		const { db } = userDatabase()
		const identical = db.import({
			users: { id: stringShape(), name: stringShape(), age: integerShape() },
		})
		expect(identical.emitter).toBe(db.emitter)
		expect(() =>
			db.import({
				users: { id: integerShape(), name: stringShape(), age: integerShape() },
			}),
		).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
	})

	it('restricts import to composition time', async () => {
		const pending = userDatabase().db
		const opening = pending.open()
		expect(() => pending.import({ logs: { id: stringShape(), message: stringShape() } })).toThrow(
			expect.objectContaining({ code: 'CONFLICT' }),
		)
		await opening
		expect(() => pending.import({ sessions: { id: stringShape(), user: stringShape() } })).toThrow(
			expect.objectContaining({ code: 'CONFLICT' }),
		)

		const active = userDatabase().db
		await active.transaction(async () => {
			expect(() => active.import({ logs: { id: stringShape(), message: stringShape() } })).toThrow(
				expect.objectContaining({ code: 'CONFLICT' }),
			)
		})

		const closed = userDatabase().db
		await closed.close()
		expect(() => closed.import({ logs: { id: stringShape(), message: stringShape() } })).toThrow(
			expect.objectContaining({ code: 'CLOSED' }),
		)
	})

	it('retains the complete imported schema across a versioned reopen', async () => {
		const driver = createMemoryDriver()
		const first = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		const firstLogs = first.import({ logs: { id: stringShape(), message: stringShape() } })
		await first.table('users').set({ id: 'u1', name: 'Ada' })
		await firstLogs.table('logs').set({ id: 'l1', message: 'started' })
		await first.close()

		const reopened = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		const reopenedLogs = reopened.import({
			logs: { id: stringShape(), message: stringShape() },
		})
		await reopened.open()
		expect((await reopened.table('users').get('u1'))?.name).toBe('Ada')
		expect((await reopenedLogs.table('logs').get('l1'))?.message).toBe('started')
		expect((await driver.metadata?.())?.schema.map((table) => table.name)).toEqual([
			'logs',
			'users',
		])
	})

	it('exports a portable schema per table', () => {
		const { db } = userDatabase()
		const exported = db.export()
		expect(Object.keys(exported)).toEqual(['users'])
		expect(exported.users?.primary).toBe('id')
		expect(exported.users?.schema.type).toBe('object')
		expect(Object.keys(exported.users?.columns ?? {})).toEqual(['id', 'name', 'age'])
	})
})

describe('transactions', () => {
	it('commits on success', async () => {
		const { db, users } = userDatabase()
		await db.transaction(async (transaction) => {
			const scoped = transaction.table('users')
			await scoped.set({ id: 'u1', name: 'Ada', age: 36 })
			await scoped.set({ id: 'u2', name: 'Bo', age: 41 })
		})
		expect(await users.count()).toBe(2)
	})

	it('returns the scope value', async () => {
		const { db } = userDatabase()
		const value = await db.transaction(async (transaction) => {
			await transaction.table('users').set({ id: 'u1', name: 'Ada', age: 36 })
			return 'done'
		})
		expect(value).toBe('done')
	})

	it('persists a global UUID generated inside a real Memory transaction', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(stringShape()), kind: stringShape() } },
		})
		let key: string | number | undefined
		await db.transaction(async (transaction) => {
			key = await transaction.table('events').set({ kind: 'click' })
		})
		expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		if (key === undefined) throw new Error('Expected a generated key')
		expect(await db.table('events').get(key)).toEqual({ id: key, kind: 'click' })
	})

	it('rolls back every write on a throw', async () => {
		const { db, users } = userDatabase()
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		await expect(
			db.transaction(async (transaction) => {
				const scoped = transaction.table('users')
				await scoped.update('u1', { age: 99 })
				await scoped.set({ id: 'u2', name: 'Bo', age: 41 })
				throw new Error('boom')
			}),
		).rejects.toThrow('boom')
		expect((await users.get('u1'))?.age).toBe(36) // restored
		expect(await users.has('u2')).toBe(false) // never committed
	})

	it('rejects captured root operations and nesting promptly while the scope is active', async () => {
		const { db, users } = userDatabase()
		const imported = db.import({ logs: { id: stringShape(), message: stringShape() } })
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const running = db.transaction(async (transaction) => {
			await transaction.table('users').update('u1', { age: 37 })
			entered.resolve()
			await release.promise
		})
		await entered.promise
		await expect(users.get('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(imported.table('logs').keys()).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(imported.status).toBe('open')
		await expect(db.open()).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(db.close()).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(db.migrate([])).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(
			db.transaction(async () => {
				throw new Error('nested scope ran')
			}),
		).rejects.toMatchObject({ code: 'CONFLICT' })
		release.resolve()
		await running
		expect((await users.get('u1'))?.age).toBe(37)
	})

	it('drains an immediately admitted root write before a failing transaction snapshots', async () => {
		const memory = createMemoryDriver()
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let blocked = true
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async write(table, key, row, options) {
				if (blocked) {
					blocked = false
					entered.resolve()
					await release.promise
				}
				await memory.write(table, key, row, options)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const users = db.table('users')
		const writing = users.set({ id: 'u1', name: 'Ada' })
		await entered.promise
		const reason = new Error('transaction failed')
		let started = false
		const running = db.transaction(async () => {
			started = true
			throw reason
		})
		expect(started).toBe(false)
		release.resolve()
		await writing
		await expect(running).rejects.toBe(reason)
		expect(started).toBe(true)
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada' })
	})

	it('closes admission first and drains an admitted delayed write before driver close', async () => {
		const memory = createMemoryDriver()
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const closes = createRecorder<[]>()
		let blocked = true
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async write(table, key, row, options) {
				if (blocked) {
					blocked = false
					entered.resolve()
					await release.promise
				}
				await memory.write(table, key, row, options)
			},
			async close() {
				closes.handler()
				await memory.close()
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const users = db.table('users')
		const writing = users.set({ id: 'u1', name: 'Ada' })
		await entered.promise
		const closing = db.close()
		expect(db.status).toBe('closed')
		expect(closes.count).toBe(0)
		await expect(users.get('u1')).rejects.toMatchObject({ code: 'CLOSED' })
		release.resolve()
		await writing
		await closing
		expect(closes.count).toBe(1)
	})

	it('admits each root iterator continuation and cleans a rejected source exactly once', async () => {
		const memory = createMemoryDriver()
		const cleanups = createRecorder<[]>()
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			stream(table) {
				return new IteratorSource(
					new RecordingIterator(memory.scan(table)[Symbol.asyncIterator](), cleanups.handler),
				)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const users = db.table('users')
		await users.set([
			{ id: 'u1', name: 'Ada' },
			{ id: 'u2', name: 'Bo' },
		])

		const iterator = users.scan()[Symbol.asyncIterator]()
		expect((await iterator.next()).value?.id).toBe('u1')
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const running = db.transaction(async () => {
			entered.resolve()
			await release.promise
		})
		await entered.promise
		await expect(iterator.next()).rejects.toMatchObject({ code: 'CONFLICT' })
		await Promise.resolve()
		expect(cleanups.count).toBe(1)
		release.resolve()
		await running
		expect((await iterator.next()).done).toBe(true)
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada' })

		const closed = users.scan()[Symbol.asyncIterator]()
		expect((await closed.next()).value?.id).toBe('u1')
		await db.close()
		await expect(closed.next()).rejects.toMatchObject({ code: 'CLOSED' })
		await Promise.resolve()
		expect(cleanups.count).toBe(2)
	})

	it('invalidates scoped tables, queries, cursors, and partially consumed streams after settle', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const captured = Promise.withResolvers<{
			readonly table: TableInterface<UserRow>
			readonly query: QueryInterface<UserRow>
			readonly cursor: CursorInterface<UserRow>
			readonly iterator: AsyncIterator<UserRow>
		}>()
		await db.transaction(async (transaction) => {
			const table = transaction.table('users')
			await table.set({ id: 'u1', name: 'Ada', age: 36 })
			await table.set({ id: 'u2', name: 'Bo', age: 41 })
			const query = table
				.query()
				.condition({ column: 'age', operator: 'above', values: [20], connector: 'and' })
			const cursor = await table.cursor()
			const iterator = table.scan()[Symbol.asyncIterator]()
			expect((await iterator.next()).value?.id).toBe('u1')
			captured.resolve({ table, query, cursor, iterator })
		})
		const { table, query, cursor, iterator } = await captured.promise
		await expect(table.get('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(query.collect()).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(cursor.next()).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(iterator.next()).rejects.toMatchObject({ code: 'CONFLICT' })
	})

	it('drains an unawaited accepted update while root access remains blocked', async () => {
		const memory = createMemoryDriver()
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let held = true
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async read(table, key) {
				if (held) {
					held = false
					entered.resolve()
					await release.promise
				}
				return memory.read(table, key)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const users = db.table('users')
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		const captured = Promise.withResolvers<TableInterface<UserRow>>()
		const running = db.transaction(async (transaction) => {
			const scoped = transaction.table('users')
			captured.resolve(scoped)
			const operation = scoped.update('u1', { age: 37 })
			await entered.promise
			expect(operation).toBeInstanceOf(Promise)
		})
		const scoped = await captured.promise
		await entered.promise
		await expect(users.get('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
		release.resolve()
		await running
		expect((await users.get('u1'))?.age).toBe(37)
		await expect(scoped.get('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
	})

	it('rolls back when an unawaited accepted operation rejects', async () => {
		const { db, users } = userDatabase()
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		await expect(
			db.transaction(async (transaction) => {
				const operation = transaction.table('users').add({ id: 'u1', name: 'Duplicate', age: 99 })
				expect(operation).toBeInstanceOf(Promise)
			}),
		).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
	})

	it('preserves a scope rejection exactly after accepted work drains', async () => {
		const { db, users } = userDatabase()
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		const reason = Number.NaN
		await expect(
			db.transaction(async (transaction) => {
				const operation = transaction.table('users').update('u1', { age: 99 })
				expect(operation).toBeInstanceOf(Promise)
				throw reason
			}),
		).rejects.toBe(reason)
		expect((await users.get('u1'))?.age).toBe(36)
	})

	it('drains accepted work and rolls back after a synchronous callback throw', async () => {
		const memory = createMemoryDriver()
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let blocking = false
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async write(table, key, row, options) {
				if (blocking) {
					entered.resolve()
					await release.promise
				}
				await memory.write(table, key, row, options)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const users = db.table('users')
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		blocking = true
		const scoped = Promise.withResolvers<TableInterface<UserRow>>()
		const reason = Symbol('synchronous callback failure')
		const running = db.transaction((transaction) => {
			const table = transaction.table('users')
			scoped.resolve(table)
			void table.update('u1', { age: 99 })
			throw reason
		})
		await entered.promise
		await expect((await scoped.promise).get('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(users.get('u1')).rejects.toMatchObject({ code: 'CONFLICT' })
		release.resolve()
		await expect(running).rejects.toBe(reason)
		expect((await users.get('u1'))?.age).toBe(36)
	})
})

describe('transaction() abort signal (snapshot floor)', () => {
	it('checks the abort signal at entry before touching the snapshot floor', async () => {
		const { db } = userDatabase()
		const controller = new AbortController()
		controller.abort('too slow')
		await expect(
			db.transaction(
				async () => {
					throw new Error('should not run')
				},
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: 'ABORTED' })
		expect(db.status).toBe('idle')
	})
})

// ── Emitter — the PUSH observation surface (AGENTS §13) ──────────────────────
//
// The Database exposes a typed `emitter` (`DatabaseEventMap`) carrying its connection +
// transaction lifecycle for fire-and-forget observers. Every event is emitted directly; the
// emitter isolates a listener throw (it can never escape into the snapshot / commit / rollback
// flow, AGENTS §13), routing it to the emitter's own `error` handler (the `error` option), and
// every emit sits AFTER its transition (`commit` after the scope succeeds, `rollback` after
// every table is restored — and the `rollback` emit OBSERVES the propagated error, never
// swallowing it). These pin: each event fires at the right moment; `on?` wires initial
// listeners; and the LOAD-BEARING emit-safety guarantee — a throwing observer can corrupt
// neither the committed state nor the propagation of the original transaction error, yet the
// `error` handler fires.

// The DatabaseEventMap event names recorded across the emitter tests — fed to the shared
// `recordEmitterEvents` (AGENTS §16.1: the per-event wiring is centralized; this file
// keeps only the names its scenarios observe).
const DATABASE_EVENTS: ReadonlyArray<keyof DatabaseEventMap> = [
	'open',
	'close',
	'transaction',
	'commit',
	'rollback',
]
const MIGRATE_EVENTS: ReadonlyArray<keyof DatabaseEventMap> = ['migrate']

describe('Database — emitter (push observation surface)', () => {
	it('fires open once on lazy first-use connect and then fires terminal close', async () => {
		const { db, users } = userDatabase()
		const events = recordEmitterEvents(db.emitter, DATABASE_EVENTS)
		expect(events.open.count).toBe(0) // idle — nothing connected yet
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		expect(events.open.count).toBe(1) // the lazy connect fired `open` once
		await users.get('u1') // a further op re-awaits the cached connect — no new `open`
		expect(events.open.count).toBe(1)
		await db.close()
		expect(events.close.calls).toEqual([[]])
	})

	it('fires open on an explicit open() with no operation', async () => {
		const { db } = userDatabase()
		const events = recordEmitterEvents(db.emitter, DATABASE_EVENTS)
		await db.open()
		expect(events.open.calls).toEqual([[]])
	})

	it('fires transaction then commit on a successful scope (no rollback)', async () => {
		const { db } = userDatabase()
		const events = recordEmitterEvents(db.emitter, DATABASE_EVENTS)
		await db.transaction(async (transaction) => {
			await transaction.table('users').set({ id: 'u1', name: 'Ada', age: 36 })
		})
		expect(events.transaction.count).toBe(1)
		expect(events.commit.count).toBe(1)
		expect(events.rollback.count).toBe(0)
	})

	it('fires transaction then rollback (with the error) on a throwing scope; commit never fires', async () => {
		const { db, users } = userDatabase()
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		const events = recordEmitterEvents(db.emitter, DATABASE_EVENTS)
		const boom = new Error('boom')
		await expect(
			db.transaction(async (transaction) => {
				await transaction.table('users').update('u1', { age: 99 })
				throw boom
			}),
		).rejects.toBe(boom)
		expect(events.transaction.count).toBe(1)
		expect(events.commit.count).toBe(0) // a throwing scope never commits
		// `rollback` fired once, carrying the propagated error — and the table was restored.
		expect(events.rollback.calls).toEqual([[boom]])
		expect((await users.get('u1'))?.age).toBe(36)
	})

	it('emits no rollback event when rollback itself fails', async () => {
		const memory = createMemoryDriver()
		const failure = new Error('rollback failed')
		const reason = new Error('scope failed')
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async snapshot() {
				await memory.snapshot()
				return async () => {
					throw failure
				}
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const events = recordEmitterEvents(db.emitter, DATABASE_EVENTS)
		const error = await db
			.transaction(async (transaction) => {
				await transaction.table('users').set({ id: 'u1', name: 'Ada', age: 36 })
				throw reason
			})
			.catch((caught: unknown) => caught)
		if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
		expect(error.code).toBe('DRIVER')
		expect(error.context).toEqual({ cause: failure, transaction: reason })
		expect(events.transaction.count).toBe(1)
		expect(events.commit.count).toBe(0)
		expect(events.rollback.count).toBe(0)
	})

	it('preserves native rollback cleanup and transaction evidence in one DRIVER error', async () => {
		const memory = createMemoryDriver()
		const cleanup = new Error('native cleanup failed')
		const reason = new Error('native scope failed')
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async transaction(scope) {
				const rollback = await memory.snapshot()
				try {
					return await scope(memory)
				} catch {
					await rollback()
					throw cleanup
				}
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
		})
		const events = recordEmitterEvents(db.emitter, DATABASE_EVENTS)
		const error = await db
			.transaction(async (transaction) => {
				await transaction.table('users').set({ id: 'u1', name: 'Ada', age: 36 })
				throw reason
			})
			.catch((caught: unknown) => caught)
		if (!isDatabaseError(error)) throw new Error('Expected a DatabaseError')
		expect(error.code).toBe('DRIVER')
		expect(error.context).toEqual({ cause: cleanup, transaction: reason })
		expect(events.rollback.count).toBe(0)
		expect(await db.table('users').get('u1')).toBeUndefined()
	})

	it('wires initial listeners from the `on` option at construction', async () => {
		const open = createRecorder<[]>()
		const commit = createRecorder<[]>()
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape(), age: integerShape() } },
			on: { open: open.handler, commit: commit.handler },
		})
		await db.transaction(async (transaction) => {
			await transaction.table('users').set({ id: 'u1', name: 'Ada', age: 36 })
		})
		expect(open.calls).toEqual([[]]) // the lazy connect inside the txn fired `open`
		expect(commit.calls).toEqual([[]])
	})

	it('EMIT SAFETY: a throwing commit listener cannot corrupt the committed state, and routes to the error handler', async () => {
		const errors = createRecorder<readonly [error: unknown, event: string]>()
		const { db, users } = userDatabase(errors.handler)
		// A buggy `commit` observer that throws on the audited transaction path. It must NOT
		// undo the commit nor escape the transaction.
		db.emitter.on('commit', () => {
			throw new Error('commit observer blew up')
		})
		// The transaction still resolves (the throw never escaped) and the writes committed.
		await db.transaction(async (transaction) => {
			const scoped = transaction.table('users')
			await scoped.set({ id: 'u1', name: 'Ada', age: 36 })
			await scoped.set({ id: 'u2', name: 'Bo', age: 41 })
		})
		// THE LOAD-BEARING ASSERTION: the committed state is intact despite the throwing observer.
		expect(await users.count()).toBe(2)
		expect((await users.get('u1'))?.name).toBe('Ada')
		// The throw was routed to the emitter's error handler — (error, event) order.
		expect(errors.calls).toEqual([[expect.any(Error), 'commit']])
		// A fresh transaction still commits after the storm.
		await db.transaction(async (transaction) =>
			transaction.table('users').set({ id: 'u3', name: 'Cy', age: 22 }),
		)
		expect(await users.count()).toBe(3)
	})

	it('EMIT SAFETY: a throwing rollback listener cannot suppress the propagated txn error', async () => {
		const errors = createRecorder<readonly [error: unknown, event: string]>()
		const { db, users } = userDatabase(errors.handler)
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		db.emitter.on('rollback', () => {
			throw new Error('rollback observer blew up')
		})
		const boom = new Error('boom')
		// THE LOAD-BEARING ASSERTION: the ORIGINAL transaction error still propagates — the
		// throwing `rollback` observer did not replace or swallow it.
		await expect(
			db.transaction(async (transaction) => {
				await transaction.table('users').update('u1', { age: 99 })
				throw boom
			}),
		).rejects.toBe(boom)
		expect((await users.get('u1'))?.age).toBe(36) // the rollback still restored the table
		expect(errors.calls).toEqual([[expect.any(Error), 'rollback']])
	})

	it('EMIT SAFETY: a throwing error handler neither escapes nor recurses', async () => {
		const errors = createRecorder<readonly [error: unknown, event: string]>()
		const { db, users } = userDatabase((error, event) => {
			errors.handler(error, event)
			throw new Error('error handler blew up too')
		})
		db.emitter.on('commit', () => {
			throw new Error('commit listener blew up')
		})
		// The transaction STILL commits — neither throw escaped into the flow.
		await db.transaction(async (transaction) =>
			transaction.table('users').set({ id: 'u1', name: 'Ada', age: 36 }),
		)
		expect(await users.count()).toBe(1)
		// The error handler fired exactly once (its own throw was swallowed, not re-entered —
		// so it could not recurse).
		expect(errors.count).toBe(1)
		expect(errors.calls[0]?.[1]).toBe('commit')
	})
})

// ── migrate() ─────────────────────────────────────────────────────────────────
//
// Diffs a caller-supplied `deployed` schema against the database's declared schema
// via `planMigration`, applies the resulting plan through the driver's optional
// `migrate` hook, and returns the applied plan. Throws `MIGRATION` when the driver
// lacks the hook (propagated driver errors, e.g. unknown-table, pass through as-is —
// covered by `MemoryDriver`'s own tests and `conformDriver`). Checks abort at entry.
// Emits `migrate` AFTER a successful apply (AGENTS §13).

describe('migrate()', () => {
	it('applies a column.remove plan, strips stored rows, and emits migrate once', async () => {
		const driver = createMemoryDriver()
		const deployed: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'name', storage: 'text', optional: false, nullable: false },
					{ name: 'legacy', storage: 'text', optional: false, nullable: false },
				],
				indexes: [],
			},
		]
		await driver.open(deployed)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', legacy: 'remove' })
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		const plan = await db.migrate(deployed)
		expect(plan.steps).toEqual([{ operation: 'column.remove', table: 'users', column: 'legacy' }])
		expect(events.migrate.calls).toEqual([[plan]])
		expect(events.migrate.count).toBe(1)
		expect(await db.table('users').get('u1')).toEqual({ id: 'u1', name: 'Ada' })
	})

	it('rejects an explicit deployed schema after the database has opened', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		await db.open()
		await expect(db.migrate(tableSchemas('users'))).rejects.toMatchObject({ code: 'CONFLICT' })
	})

	it('rejects with MIGRATION when the driver has no migrate hook; no event fires', async () => {
		const memory = createMemoryDriver()
		const driver = createMemoryAdapter(memory)
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		await expect(db.migrate([])).rejects.toMatchObject({ code: 'MIGRATION' })
		expect(events.migrate.count).toBe(0)
	})

	it('checks the abort signal at entry; driver.migrate is never called, no event fires', async () => {
		const memory = createMemoryDriver()
		const calls: MigrationInput[] = []
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async migrate(plan) {
				calls.push(plan)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		const controller = new AbortController()
		controller.abort('too slow')
		await expect(db.migrate([], { signal: controller.signal })).rejects.toMatchObject({
			code: 'ABORTED',
		})
		expect(calls).toEqual([])
		expect(events.migrate.count).toBe(0)
	})

	it('fails closed after apply rejection and allows an explicit migration retry', async () => {
		const memory = createMemoryDriver()
		const failure = new Error('apply failed')
		let applies = 0
		const driver: DriverInterface = {
			...createMemoryAdapter(memory),
			async migrate(input) {
				applies += 1
				if (applies === 1) throw failure
				await memory.migrate?.(input)
			},
		}
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const users = db.table('users')
		const events = recordEmitterEvents(db.emitter, ['open', 'migrate', 'close'])

		await expect(db.migrate([])).rejects.toBe(failure)
		expect(db.status).toBe('idle')
		expect(events.open.count).toBe(0)
		expect(events.migrate.count).toBe(0)
		await expect(db.open()).rejects.toBe(failure)
		await expect(users.keys()).rejects.toBe(failure)

		const plan = await db.migrate([])
		expect(applies).toBe(2)
		expect(db.status).toBe('open')
		expect(events.open.calls).toEqual([[]])
		expect(events.migrate.calls).toEqual([[plan]])
		await users.set({ id: 'u1', name: 'Ada' })
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada' })
		await db.close()
		expect(events.close.calls).toEqual([[]])
	})

	it('returns a zero-step plan and still invokes the driver when deployed matches declared', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		const deployed: readonly TableSchema[] = [
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
		const plan = await db.migrate(deployed)
		expect(plan.steps).toEqual([])
		expect(events.migrate.calls).toEqual([[plan]])
	})

	it('rejects an unsafe required-column migration before opening or stamping the driver', async () => {
		const driver = createMemoryDriver()
		const deployed: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
		]
		await driver.open(deployed)
		await driver.write('users', 'u1', { id: 'u1' })
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 2,
		})
		await expect(db.migrate(deployed)).rejects.toMatchObject({
			code: 'MIGRATION',
			context: { table: 'users', column: 'name' },
		})
		expect(db.status).toBe('idle')
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1' })
		expect(await driver.metadata?.()).toBeUndefined()
	})
})

// ── version reconciliation (open()) ──────────────────────────────────────────
//
// When `version` is set and the driver implements BOTH `metadata` and `stamp`, `open()`
// reconciles the driver's persisted `DriverMetadata` against the declared version INSIDE the
// same lazy-connect chain, AFTER the `open` event (AGENTS §13 emit-after-transition).

describe('version reconciliation (open())', () => {
	it('fresh memory driver: stamps { version, declared schema }, no migrate event', async () => {
		const driver = createMemoryDriver()
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		await db.open()
		expect(events.migrate.count).toBe(0)
		const metadata = await driver.metadata?.()
		expect(metadata?.version).toBe(1)
		expect(metadata?.schema.map((table) => table.name)).toEqual(['users'])
	})

	it('reopening at a higher version applies a column.remove plan, strips rows, and re-stamps', async () => {
		const driver = createMemoryDriver()
		const legacySchema: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'name', storage: 'text', optional: false, nullable: false },
					{ name: 'legacy', storage: 'text', optional: false, nullable: false },
				],
				indexes: [],
			},
		]
		await driver.open(legacySchema)
		await driver.write('users', 'u1', { id: 'u1', name: 'Ada', legacy: 'x' })
		await driver.stamp?.({ version: 1, schema: legacySchema })

		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 2,
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		await db.open()
		expect(events.migrate.count).toBe(1)
		expect(events.migrate.calls[0]?.[0]?.steps).toEqual([
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
		])
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' })
		const metadata = await driver.metadata?.()
		expect(metadata?.version).toBe(2)
	})

	it('stored version newer than declared: open() rejects MIGRATION', async () => {
		const driver = createMemoryDriver()
		await driver.open([])
		await driver.stamp?.({ version: 5, schema: [] })
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		await expect(db.open()).rejects.toMatchObject({ code: 'MIGRATION' })
	})

	it('stored schema drift at the declared version rejects MIGRATION', async () => {
		const driver = createMemoryDriver()
		const stored: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
		]
		await driver.open(stored)
		await driver.stamp?.({ version: 1, schema: stored })
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		await expect(db.open()).rejects.toMatchObject({ code: 'MIGRATION' })
	})

	it('same-version reconciliation accepts table, column, and index-list reordering', async () => {
		const driver = createMemoryDriver()
		const stored: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'name', storage: 'text', optional: false, nullable: false },
					{ name: 'id', storage: 'text', optional: false, nullable: false },
				],
				indexes: [],
			},
		]
		await driver.open(stored)
		await driver.stamp?.({ version: 1, schema: stored })
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		await expect(db.open()).resolves.toBeUndefined()
	})

	it('stored version older, non-empty plan, driver lacks migrate: open() rejects MIGRATION', async () => {
		const legacySchema: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
		]
		const { driver } = createReconciliationDriver({
			metadata: true,
			stamp: true,
			initial: { version: 1, schema: legacySchema },
		})
		await driver.open?.(legacySchema)
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 2,
		})
		await expect(db.open()).rejects.toMatchObject({ code: 'MIGRATION' })
	})

	it('version unset: reconciliation is skipped — metadata/stamp never called', async () => {
		const { driver, metadataCalls, stampCalls } = createReconciliationDriver({
			metadata: true,
			stamp: true,
		})
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		await db.open()
		expect(metadataCalls).toEqual([])
		expect(stampCalls).toEqual([])
	})

	it('version set with only metadata: skips every reconciliation hook, migration, and event', async () => {
		const { driver, metadataCalls, stampCalls, migrateCalls } = createReconciliationDriver({
			metadata: true,
			stamp: false,
			migrate: true,
			initial: { version: 0, schema: [] },
		})
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		await expect(db.open()).resolves.toBeUndefined()
		expect(metadataCalls).toEqual([])
		expect(stampCalls).toEqual([])
		expect(migrateCalls).toEqual([])
		expect(events.migrate.count).toBe(0)
	})

	it('version set with only stamp: skips every reconciliation hook, migration, and event', async () => {
		const { driver, metadataCalls, stampCalls, migrateCalls } = createReconciliationDriver({
			metadata: false,
			stamp: true,
			migrate: true,
		})
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		const events = recordEmitterEvents(db.emitter, MIGRATE_EVENTS)
		await expect(db.open()).resolves.toBeUndefined()
		expect(metadataCalls).toEqual([])
		expect(stampCalls).toEqual([])
		expect(migrateCalls).toEqual([])
		expect(events.migrate.count).toBe(0)
	})

	it('version set, driver without metadata/stamp: open() succeeds silently', async () => {
		const memory = createMemoryDriver()
		const driver = createMemoryAdapter(memory)
		const db = createDatabase({
			driver,
			tables: { users: { id: stringShape(), name: stringShape() } },
			version: 1,
		})
		await expect(db.open()).resolves.toBeUndefined()
		expect(db.status).toBe('open')
	})
})
