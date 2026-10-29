import { DatabaseCounter } from '../../setup.js'
import { DriverIterator } from '../../../src/core/DriverIterator.js'
import { describe, expect, it } from 'vitest'

describe('DriverIterator', () => {
	it('guards before reading, cleans once, and terminalizes after a guard failure', async () => {
		const failure = new Error('transaction active')
		const reads = new DatabaseCounter()
		const returns = new DatabaseCounter()
		const iterator = new DriverIterator<string>(
			{
				async next(): Promise<IteratorResult<string>> {
					reads.next()
					return { done: false, value: 'unreachable' }
				},
				async return(): Promise<IteratorResult<string>> {
					returns.next()
					return { done: true, value: undefined }
				},
			},
			() => {
				throw failure
			},
		)

		await expect(iterator.next()).rejects.toBe(failure)
		expect(reads.count).toBe(0)
		expect(returns.count).toBe(1)
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		expect(returns.count).toBe(1)
	})

	it('discards a produced row when the post-read guard fails', async () => {
		const failure = new Error('transaction started during read')
		const guards = new DatabaseCounter()
		const returns = new DatabaseCounter()
		const iterator = new DriverIterator<string>(
			{
				async next(): Promise<IteratorResult<string>> {
					return { done: false, value: 'payload-secret' }
				},
				async return(): Promise<IteratorResult<string>> {
					returns.next()
					return { done: true, value: undefined }
				},
			},
			() => {
				guards.next()
				if (guards.count === 2) throw failure
			},
		)

		await expect(iterator.next()).rejects.toBe(failure)
		expect(returns.count).toBe(1)
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
	})

	it('marks return terminal before awaiting cleanup and invokes cleanup once', async () => {
		const cleanup = Promise.withResolvers<IteratorResult<string>>()
		const returns = new DatabaseCounter()
		const iterator = new DriverIterator<string>(
			{
				async next(): Promise<IteratorResult<string>> {
					return { done: false, value: 'row' }
				},
				return(): Promise<IteratorResult<string>> {
					returns.next()
					return cleanup.promise
				},
			},
			() => undefined,
		)
		const first = iterator.return()

		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		expect(returns.count).toBe(1)
		cleanup.resolve({ done: true, value: undefined })
		await expect(first).resolves.toEqual({ done: true, value: undefined })
	})

	it('uses source throw when present and permits a nonterminal result to continue', async () => {
		const reads = new DatabaseCounter()
		const throws = new DatabaseCounter()
		const iterator = new DriverIterator<string>(
			{
				async next(): Promise<IteratorResult<string>> {
					reads.next()
					return reads.count === 1
						? { done: false, value: 'continued' }
						: { done: true, value: undefined }
				},
				async throw(): Promise<IteratorResult<string>> {
					throws.next()
					return { done: false, value: 'recovered' }
				},
			},
			() => undefined,
		)

		await expect(iterator.throw(new Error('recoverable'))).resolves.toEqual({
			done: false,
			value: 'recovered',
		})
		await expect(iterator.next()).resolves.toEqual({ done: false, value: 'continued' })
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		expect(throws.count).toBe(1)
	})

	it('cleans and preserves the caller failure when source throw is absent', async () => {
		const failure = new Error('caller failure')
		const returns = new DatabaseCounter()
		const iterator = new DriverIterator<string>(
			{
				async next(): Promise<IteratorResult<string>> {
					return { done: false, value: 'row' }
				},
				async return(): Promise<IteratorResult<string>> {
					returns.next()
					throw new Error('cleanup failure')
				},
			},
			() => undefined,
		)

		await expect(iterator.throw(failure)).rejects.toBe(failure)
		expect(returns.count).toBe(1)
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.throw(failure)).rejects.toBe(failure)
		expect(returns.count).toBe(1)
	})

	it('normalizes return when the source has no cleanup method', async () => {
		const iterator = new DriverIterator<string>(
			{
				async next(): Promise<IteratorResult<string>> {
					return { done: false, value: 'row' }
				},
			},
			() => undefined,
		)

		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
	})
})
