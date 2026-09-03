import type { Result } from '@orkestrel/contract'
import type { StorageInterface, TableSchema } from '@src/core'
import { createRecorder } from '@orkestrel/test'
import { createMemoryDriver, isDatabaseError } from '@src/core'
import { describe, expect, it } from 'vitest'
import { DatabaseContext } from '../../../src/core/DatabaseContext.js'
import { TransactionScope } from '../../../src/core/TransactionScope.js'
import { createReconciliationDriver, tableSchemas } from '../../setup.js'

// `DatabaseContext` (`src/core/DatabaseContext.ts`) owns the shared lifecycle every
// typed `Database` view sits on: schema registration and its merge, admission and
// drain, the transaction boundary, versioned reconcile / apply / stamp, and the
// rollback-failure wrapping. `Database.test.ts` drives it through the public view;
// these cases drive the interned context directly, so its own contract is pinned at
// the seams a view does not expose — a second `register` after opening, and a `track`
// admitted while a transaction holds the boundary. The DRIVER wrapping of a failed
// rollback stays in `Database.test.ts`, which already drives that seam end to end.

function contextFor(...names: readonly string[]): DatabaseContext {
	const context = new DatabaseContext({ driver: createMemoryDriver(), tables: {} })
	context.register(tableSchemas(...names))
	return context
}

/** The scope shape `DatabaseContext.transaction` expects: a `Result` per attempt. */
function succeeding<R>(value: R): (storage: StorageInterface) => Promise<Result<R, unknown>> {
	return async () => ({ success: true, value })
}

function failing(error: unknown): (storage: StorageInterface) => Promise<Result<never, unknown>> {
	return async () => ({ success: false, error })
}

describe('register', () => {
	it('merges an identical table declaration without conflict', () => {
		const context = contextFor('users')
		expect(() => context.register(tableSchemas('users'))).not.toThrow()
		expect(() => context.register(tableSchemas('posts'))).not.toThrow()
	})

	it('throws VALIDATION when a name is re-registered with a different schema', () => {
		const context = contextFor('users')
		const conflicting: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'slug',
				columns: [{ name: 'slug', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
		]
		let error: unknown
		try {
			context.register(conflicting)
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('VALIDATION')
	})

	it('throws CONFLICT once opening has started', async () => {
		const context = contextFor('users')
		await context.open()
		let error: unknown
		try {
			context.register(tableSchemas('posts'))
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFLICT')
	})

	it('throws CLOSED after close', async () => {
		const context = contextFor('users')
		await context.close()
		let error: unknown
		try {
			context.register(tableSchemas('posts'))
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CLOSED')
	})
})

describe('lifecycle', () => {
	it('reports idle, then open, then closed, and emits each transition once', async () => {
		const opened = createRecorder<readonly []>()
		const closed = createRecorder<readonly []>()
		const context = new DatabaseContext({ driver: createMemoryDriver(), tables: {} })
		context.emitter.on('open', opened.handler)
		context.emitter.on('close', closed.handler)
		expect(context.status).toBe('idle')
		await context.open()
		expect(context.status).toBe('open')
		await context.open()
		expect(opened.count).toBe(1)
		await context.close()
		expect(context.status).toBe('closed')
		await context.close()
		expect(closed.count).toBe(1)
	})

	it('reuses one readiness promise across concurrent connects', async () => {
		const context = contextFor('users')
		const first = context.connect()
		const second = context.connect()
		expect(second).toBe(first)
		await first
	})

	it('names the configured database and exposes its driver and error handler', () => {
		const errors = createRecorder<readonly [error: unknown, event: string]>()
		const driver = createMemoryDriver()
		const context = new DatabaseContext({
			driver,
			tables: {},
			name: 'app',
			error: errors.handler,
		})
		expect(context.name).toBe('app')
		expect(context.driver).toBe(driver)
		expect(context.error).toBe(errors.handler)
		expect(context.version).toBeUndefined()
	})
})

describe('admission', () => {
	it('accepts work while open and refuses it after close', async () => {
		const context = contextFor('users')
		expect(context.accepting).toBe(true)
		await expect(context.track(async () => 5)).resolves.toBe(5)
		await context.close()
		expect(context.accepting).toBe(false)
		await expect(context.track(async () => 5)).rejects.toMatchObject({ code: 'CLOSED' })
	})

	it('refuses new root work while a transaction holds the boundary', async () => {
		const context = contextFor('users')
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const running = context.transaction(async () => {
			entered.resolve()
			await release.promise
			return { success: true, value: 1 }
		})
		await entered.promise
		expect(context.accepting).toBe(false)
		await expect(context.track(async () => 2)).rejects.toMatchObject({ code: 'CONFLICT' })
		release.resolve()
		await expect(running).resolves.toBe(1)
		expect(context.accepting).toBe(true)
	})

	it('captures a synchronous throw from a tracked operation as a rejection', async () => {
		const context = contextFor('users')
		const boom = new Error('boom')
		await expect(
			context.track(() => {
				throw boom
			}),
		).rejects.toBe(boom)
	})

	it('drains root work admitted before close', async () => {
		const context = contextFor('users')
		const release = Promise.withResolvers<void>()
		let settled = false
		void context.track(async () => {
			await release.promise
			settled = true
		})
		const closing = context.close()
		expect(settled).toBe(false)
		release.resolve()
		await closing
		expect(settled).toBe(true)
	})
})

describe('transaction', () => {
	it('emits transaction then commit and returns the scope value', async () => {
		const events: string[] = []
		const context = contextFor('users')
		context.emitter.on('transaction', () => events.push('transaction'))
		context.emitter.on('commit', () => events.push('commit'))
		await expect(context.transaction(succeeding('done'))).resolves.toBe('done')
		expect(events).toEqual(['transaction', 'commit'])
	})

	it('rolls back, emits rollback with the scope error, and propagates it', async () => {
		const rolled = createRecorder<readonly [error: unknown]>()
		const context = contextFor('users')
		context.emitter.on('rollback', rolled.handler)
		const boom = new Error('scope failed')
		await expect(context.transaction(failing(boom))).rejects.toBe(boom)
		expect(rolled.calls).toEqual([[boom]])
	})

	it('restores the rows a failed scope wrote', async () => {
		const driver = createMemoryDriver()
		const context = new DatabaseContext({ driver, tables: {} })
		context.register(tableSchemas('users'))
		await context.open()
		await driver.write('users', 'u1', { id: 'u1', n: 1 })
		const boom = new Error('scope failed')
		await expect(
			context.transaction(async (storage) => {
				await storage.write('users', 'u1', { id: 'u1', n: 2 })
				return { success: false, error: boom }
			}),
		).rejects.toBe(boom)
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', n: 1 })
	})

	it('refuses a nested transaction and releases the boundary afterwards', async () => {
		const context = contextFor('users')
		await expect(
			context.transaction(async () => {
				await expect(context.transaction(succeeding(1))).rejects.toMatchObject({
					code: 'CONFLICT',
				})
				return { success: true, value: 'outer' }
			}),
		).resolves.toBe('outer')
		await expect(context.transaction(succeeding('after'))).resolves.toBe('after')
	})

	it('checks a pre-aborted signal once, at entry', async () => {
		const context = contextFor('users')
		let entered = false
		await expect(
			context.transaction(
				async () => {
					entered = true
					return { success: true, value: 1 }
				},
				{ signal: AbortSignal.abort() },
			),
		).rejects.toMatchObject({ code: 'ABORTED' })
		expect(entered).toBe(false)
	})

	it('hands the scope a fresh TransactionScope per attempt', async () => {
		const context = contextFor('users')
		const scopes: TransactionScope[] = []
		await context.transaction(async (_storage, lifetime) => {
			scopes.push(lifetime)
			return { success: true, value: 1 }
		})
		await context.transaction(async (_storage, lifetime) => {
			scopes.push(lifetime)
			return { success: true, value: 1 }
		})
		expect(scopes[0]).toBeInstanceOf(TransactionScope)
		expect(scopes[0]).not.toBe(scopes[1])
	})
})

describe('migrate', () => {
	it('throws MIGRATION when the driver carries no migrate hook', async () => {
		const { driver } = createReconciliationDriver({ metadata: false, stamp: false })
		const context = new DatabaseContext({ driver, tables: {} })
		context.register(tableSchemas('users'))
		let error: unknown
		try {
			await context.migrate([])
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
	})

	it('throws CONFLICT once the database has opened', async () => {
		const context = contextFor('users')
		await context.open()
		let error: unknown
		try {
			await context.migrate([])
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFLICT')
	})

	it('applies the plan, emits migrate, and opens', async () => {
		const migrated = createRecorder<readonly [migration: { readonly steps: readonly unknown[] }]>()
		const context = contextFor('users')
		context.emitter.on('migrate', migrated.handler)
		const plan = await context.migrate([])
		expect(plan.steps.length).toBeGreaterThan(0)
		expect(migrated.count).toBe(1)
		expect(context.status).toBe('open')
	})
})

describe('version reconciliation', () => {
	it('stamps a fresh store at the declared version', async () => {
		const { driver, stampCalls } = createReconciliationDriver({ metadata: true, stamp: true })
		const context = new DatabaseContext({ driver, tables: {}, version: 2 })
		context.register(tableSchemas('users'))
		await context.open()
		expect(context.version).toBe(2)
		expect(stampCalls.length).toBe(1)
		expect(stampCalls[0]?.version).toBe(2)
	})

	it('throws MIGRATION when the stored version is newer than the declared one', async () => {
		const { driver } = createReconciliationDriver({
			metadata: true,
			stamp: true,
			initial: { version: 5, schema: tableSchemas('users') },
		})
		const context = new DatabaseContext({ driver, tables: {}, version: 2 })
		context.register(tableSchemas('users'))
		let error: unknown
		try {
			await context.open()
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
	})

	it('throws MIGRATION when the stored schema differs at the same version', async () => {
		const { driver } = createReconciliationDriver({
			metadata: true,
			stamp: true,
			initial: { version: 2, schema: tableSchemas('posts') },
		})
		const context = new DatabaseContext({ driver, tables: {}, version: 2 })
		context.register(tableSchemas('users'))
		let error: unknown
		try {
			await context.open()
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
	})

	it('leaves a matching stored version untouched', async () => {
		const { driver, stampCalls, migrateCalls } = createReconciliationDriver({
			metadata: true,
			stamp: true,
			migrate: true,
			initial: { version: 2, schema: tableSchemas('users') },
		})
		const context = new DatabaseContext({ driver, tables: {}, version: 2 })
		context.register(tableSchemas('users'))
		await context.open()
		expect(stampCalls.length).toBe(0)
		expect(migrateCalls.length).toBe(0)
	})
})
