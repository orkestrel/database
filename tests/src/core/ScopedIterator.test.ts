import { describe, expect, it } from 'vitest'
import { ScopedIterator } from '../../../src/core/ScopedIterator.js'
import { TransactionScope } from '../../../src/core/TransactionScope.js'
import { IteratorSource } from '../../setup.js'

/** The transaction-scoped readiness thunk: a transaction is already connected. */
function ready(): Promise<void> {
	return Promise.resolve()
}

describe('ScopedIterator', () => {
	it('tracks next until its explicit source barrier settles', async () => {
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const source = new IteratorSource<number>({
			async next() {
				entered.resolve()
				await release.promise
				return { done: false, value: 1 }
			},
		})
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(source, scope, ready)
		const continuation = iterator.next()
		await entered.promise
		scope.stop()
		const drained = scope.drain()
		release.resolve()
		await expect(continuation).resolves.toEqual({ done: false, value: 1 })
		await expect(drained).resolves.toBeUndefined()
	})

	it('tracks active return and closes the source exactly once', async () => {
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let returns = 0
		const source = new IteratorSource<number>({
			async next() {
				return { done: false, value: 1 }
			},
			async return() {
				returns += 1
				entered.resolve()
				await release.promise
				return { done: true, value: undefined }
			},
		})
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(source, scope, ready)
		const continuation = iterator.return()
		await entered.promise
		scope.stop()
		const drained = scope.drain()
		release.resolve()
		await expect(continuation).resolves.toEqual({ done: true, value: undefined })
		await expect(drained).resolves.toBeUndefined()
		expect(returns).toBe(1)
	})

	it('terminalizes after an active return without advancing the source', async () => {
		let nexts = 0
		let returns = 0
		const source = new IteratorSource<number>({
			async next() {
				nexts += 1
				return { done: false, value: 1 }
			},
			async return() {
				returns += 1
				return { done: true, value: undefined }
			},
		})
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(source, scope, ready)

		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		expect(nexts).toBe(0)
		expect(returns).toBe(1)
	})

	it('preserves throw reasons when the source lacks throw and runs return cleanup', async () => {
		const reason = Symbol('iterator throw')
		let returns = 0
		const source = new IteratorSource<number>({
			async next() {
				return { done: false, value: 1 }
			},
			async return() {
				returns += 1
				return { done: true, value: undefined }
			},
		})
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(source, scope, ready)
		const continuation = iterator.throw(reason)
		scope.stop()
		await expect(continuation).rejects.toBe(reason)
		await expect(scope.drain()).rejects.toBe(reason)
		expect(returns).toBe(1)
	})

	it('tracks an active source throw continuation through its barrier', async () => {
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const reason = Symbol('handled source throw')
		let observed: unknown
		const source = new IteratorSource<number>({
			async next() {
				return { done: false, value: 1 }
			},
			async throw(error) {
				observed = error
				entered.resolve()
				await release.promise
				return { done: true, value: undefined }
			},
		})
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(source, scope, ready)
		const continuation = iterator.throw(reason)
		await entered.promise
		scope.stop()
		const drained = scope.drain()
		release.resolve()
		await expect(continuation).resolves.toEqual({ done: true, value: undefined })
		await expect(drained).resolves.toBeUndefined()
		expect(observed).toBe(reason)
	})

	it('normalizes a missing return method to a completed continuation', async () => {
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(
			new IteratorSource<number>({
				async next() {
					return { done: false, value: 1 }
				},
			}),
			scope,
			ready,
		)
		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		scope.stop()
		await expect(scope.drain()).resolves.toBeUndefined()
	})

	it('tracks synchronous source throws through the same rejection ledger', async () => {
		const reason = new Error('synchronous source failure')
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(
			new IteratorSource<number>({
				next() {
					throw reason
				},
			}),
			scope,
			ready,
		)
		const continuation = iterator.next()
		scope.stop()
		await expect(continuation).rejects.toBe(reason)
		await expect(scope.drain()).rejects.toBe(reason)
	})

	it('drains concurrent accepted continuations without retaining an idle iterator', async () => {
		const first = Promise.withResolvers<void>()
		const second = Promise.withResolvers<void>()
		let calls = 0
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(
			new IteratorSource<number>({
				async next() {
					calls += 1
					if (calls === 1) await first.promise
					else await second.promise
					return { done: false, value: calls }
				},
			}),
			scope,
			ready,
		)
		await expect(scope.drain()).resolves.toBeUndefined()
		const one = iterator.next()
		const two = iterator.next()
		scope.stop()
		const drained = scope.drain()
		first.resolve()
		second.resolve()
		await expect(Promise.all([one, two])).resolves.toHaveLength(2)
		await expect(drained).resolves.toBeUndefined()
	})

	it('rejects every late continuation and attempts rejected cleanup exactly once', async () => {
		let returns = 0
		const source = new IteratorSource<number>({
			async next() {
				return { done: false, value: 1 }
			},
			async return() {
				returns += 1
				throw new Error('late cleanup failed')
			},
		})
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(source, scope, ready)
		scope.stop()
		await expect(scope.drain()).resolves.toBeUndefined()
		await expect(iterator.next()).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(iterator.return()).rejects.toMatchObject({ code: 'CONFLICT' })
		await expect(iterator.throw('late')).rejects.toMatchObject({ code: 'CONFLICT' })
		expect(returns).toBe(1)
	})

	it('readies the boundary before every advance and on no other continuation', async () => {
		const order: string[] = []
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(
			new IteratorSource<number>({
				async next() {
					order.push('next')
					return { done: false, value: 1 }
				},
				async return() {
					order.push('return')
					return { done: true, value: undefined }
				},
			}),
			scope,
			async () => {
				order.push('ready')
			},
		)
		await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
		await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		expect(order).toEqual(['ready', 'next', 'ready', 'next', 'return'])
	})

	it('propagates a readiness failure instead of advancing the source', async () => {
		const reason = new Error('connect failed')
		let nexts = 0
		const scope = new TransactionScope()
		const iterator = new ScopedIterator(
			new IteratorSource<number>({
				async next() {
					nexts += 1
					return { done: false, value: 1 }
				},
			}),
			scope,
			() => Promise.reject(reason),
		)
		const continuation = iterator.next()
		scope.stop()
		await expect(continuation).rejects.toBe(reason)
		await expect(scope.drain()).rejects.toBe(reason)
		expect(nexts).toBe(0)
	})
})
