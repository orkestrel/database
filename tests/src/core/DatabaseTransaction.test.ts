import type { StorageInterface } from '@src/core'
import { integerShape, optionalShape, stringShape } from '@orkestrel/contract'
import { createMemoryDriver, isDatabaseError } from '@src/core'
import { describe, expect, it } from 'vitest'
import { DatabaseTransaction } from '../../../src/core/DatabaseTransaction.js'
import { TransactionScope } from '../../../src/core/TransactionScope.js'
import { tableSchemas } from '../../setup.js'

// `DatabaseTransaction` (`src/core/DatabaseTransaction.ts`) is the interned table-only
// view a transaction callback receives as its `DatabaseStorageInterface`. In production
// `DatabaseContext.transaction` builds it; these cases build it directly over a real
// `MemoryDriver` and a real `TransactionScope`, so the view's own contract — the scope
// check on `table`, and the scope-bound `Table` it constructs — is pinned without a
// database transaction around it.

const COLUMNS = { users: { id: stringShape(), name: stringShape(), age: integerShape() } }

async function transactionView(): Promise<{
	readonly view: DatabaseTransaction<typeof COLUMNS>
	readonly scope: TransactionScope
	readonly driver: StorageInterface
}> {
	const driver = createMemoryDriver()
	await driver.open(tableSchemas('users'))
	const scope = new TransactionScope()
	return {
		view: new DatabaseTransaction(driver, COLUMNS, {}, undefined, undefined, scope),
		scope,
		driver,
	}
}

describe('table()', () => {
	it('returns a typed table bound to the transaction driver', async () => {
		const { view } = await transactionView()
		const users = view.table('users')
		expect(users.name).toBe('users')
		expect(users.primary).toBe('id')
		await users.set({ id: 'u1', name: 'Ada', age: 36 })
		expect(await users.get('u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
	})

	it('writes straight through to the scoped driver', async () => {
		const { view, driver } = await transactionView()
		await view.table('users').set({ id: 'u1', name: 'Ada', age: 36 })
		expect(await driver.read('users', 'u1')).toEqual({ id: 'u1', name: 'Ada', age: 36 })
	})

	it('throws CONFLICT once the scope has settled', async () => {
		const { view, scope } = await transactionView()
		scope.stop()
		let error: unknown
		try {
			view.table('users')
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFLICT')
	})

	it('throws NOT_FOUND for a table the view does not declare', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('users'))
		// Held at the open `TableMap` default, so `table` accepts any name and the
		// runtime refusal — not the compiler — is what this asserts.
		const open: DatabaseTransaction = new DatabaseTransaction(
			driver,
			COLUMNS,
			{},
			undefined,
			undefined,
			new TransactionScope(),
		)
		let error: unknown
		try {
			open.table('posts')
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('NOT_FOUND')
	})

	it('honours a per-table primary override', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('posts'))
		const columns = { posts: { slug: stringShape(), title: stringShape() } }
		const view = new DatabaseTransaction(
			driver,
			columns,
			{ posts: 'slug' },
			undefined,
			undefined,
			new TransactionScope(),
		)
		const posts = view.table('posts')
		expect(posts.primary).toBe('slug')
		expect(await posts.set({ slug: 'hello', title: 'Hello' })).toBe('hello')
	})
})

describe('the scoped table it builds', () => {
	it('refuses an operation started after the scope settled', async () => {
		const { view, scope } = await transactionView()
		const users = view.table('users')
		scope.stop()
		await expect(users.set({ id: 'u2', name: 'Bo', age: 41 })).rejects.toMatchObject({
			code: 'CONFLICT',
		})
	})

	it('mints a key from the supplied generator for a keyless write', async () => {
		const driver = createMemoryDriver()
		await driver.open(tableSchemas('events'))
		const columns = { events: { id: optionalShape(stringShape()), kind: stringShape() } }
		let minted = 0
		const view = new DatabaseTransaction(
			driver,
			columns,
			{},
			() => {
				minted += 1
				return `generated-${minted}`
			},
			undefined,
			new TransactionScope(),
		)
		const key = await view.table('events').set({ kind: 'click' })
		expect(key).toBe('generated-1')
		expect(await driver.read('events', 'generated-1')).toEqual({
			id: 'generated-1',
			kind: 'click',
		})
	})
})
