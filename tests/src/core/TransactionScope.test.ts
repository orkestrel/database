import { describe, expect, it } from 'vitest'
import { isDatabaseError } from '@src/core'
import { TransactionScope } from '../../../src/core/TransactionScope.js'
import { IteratorSource } from '../../setup.js'

// `TransactionScope` (`src/core/TransactionScope.ts`) is the interned lifetime boundary
// one transaction callback runs inside. It is reached in production through
// `DatabaseContext.transaction`, which hands a fresh scope to the callback; these cases
// drive it directly, the way `ScopedIterator.test.ts` drives it, so the boundary's own
// admission / drain / stream contract is pinned without a database around it.

describe('accepting and check', () => {
	it('admits work until stop, then refuses it', () => {
		const scope = new TransactionScope()
		expect(scope.accepting).toBe(true)
		expect(() => scope.check()).not.toThrow()
		scope.stop()
		expect(scope.accepting).toBe(false)
		let error: unknown
		try {
			scope.check()
		} catch (cause) {
			error = cause
		}
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFLICT')
	})
})

describe('track', () => {
	it('returns the operation result and drains clean', async () => {
		const scope = new TransactionScope()
		await expect(scope.track(async () => 7)).resolves.toBe(7)
		scope.stop()
		await expect(scope.drain()).resolves.toBeUndefined()
	})

	it('rejects CONFLICT after stop without running the operation', async () => {
		const scope = new TransactionScope()
		scope.stop()
		let ran = false
		const rejected = scope.track(async () => {
			ran = true
			return 1
		})
		await expect(rejected).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(ran).toBe(false)
	})

	it('captures a synchronous throw from the operation as a rejection', async () => {
		const scope = new TransactionScope()
		const boom = new Error('boom')
		const rejected = scope.track(() => {
			throw boom
		})
		await expect(rejected).rejects.toBe(boom)
		scope.stop()
		await expect(scope.drain()).rejects.toBe(boom)
	})

	it('contains work the callback never awaited', async () => {
		const scope = new TransactionScope()
		const release = Promise.withResolvers<void>()
		let settled = false
		void scope.track(async () => {
			await release.promise
			settled = true
		})
		scope.stop()
		const drained = scope.drain()
		expect(settled).toBe(false)
		release.resolve()
		await expect(drained).resolves.toBeUndefined()
		expect(settled).toBe(true)
	})

	it('drains an operation another tracked operation admitted before the boundary', async () => {
		const scope = new TransactionScope()
		const release = Promise.withResolvers<void>()
		let nested = false
		// Entered from inside the outer operation, while the scope still accepts. The
		// outer promise settles first, so drain re-reads the set rather than reading
		// it once and settling early.
		const outer = scope.track(async () => {
			void scope.track(async () => {
				await release.promise
				nested = true
			})
			return 'outer'
		})
		await expect(outer).resolves.toBe('outer')
		scope.stop()
		const drained = scope.drain()
		expect(nested).toBe(false)
		release.resolve()
		await expect(drained).resolves.toBeUndefined()
		expect(nested).toBe(true)
	})
})

describe('drain', () => {
	it('reports the FIRST tracked failure and keeps it across repeated drains', async () => {
		const scope = new TransactionScope()
		const early = new Error('early')
		const late = new Error('late')
		const first = Promise.withResolvers<void>()
		const second = Promise.withResolvers<void>()
		const one = scope.track(async () => {
			await first.promise
			throw early
		})
		const two = scope.track(async () => {
			await second.promise
			throw late
		})
		first.resolve()
		await expect(one).rejects.toBe(early)
		second.resolve()
		await expect(two).rejects.toBe(late)
		scope.stop()
		await expect(scope.drain()).rejects.toBe(early)
		await expect(scope.drain()).rejects.toBe(early)
	})

	it('resolves immediately when nothing was ever tracked', async () => {
		const scope = new TransactionScope()
		await expect(scope.drain()).resolves.toBeUndefined()
	})
})

describe('stream', () => {
	it('applies the boundary per continuation and leaves an idle iterator unpinned', async () => {
		const values = [1, 2, 3]
		let index = 0
		const source = new IteratorSource<number>({
			async next() {
				if (index >= values.length) return { done: true, value: undefined }
				const value = values[index]
				index += 1
				return { done: false, value: value ?? 0 }
			},
		})
		const scope = new TransactionScope()
		const stream = scope.stream(source)
		const iterator = stream[Symbol.asyncIterator]()
		await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
		// The iterator is idle here: drain settles without waiting for a later `next`.
		scope.stop()
		await expect(scope.drain()).resolves.toBeUndefined()
		// A continuation after the boundary closed conflicts rather than yielding.
		await expect(iterator.next()).rejects.toMatchObject({ code: 'CONFLICT' })
	})
})
