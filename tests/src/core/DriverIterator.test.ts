import { DriverIterator } from '../../../src/core/DriverIterator.js'
import { describe, expect, it } from 'vitest'

describe('DriverIterator', () => {
	it('guards before reading, cleans once, and terminalizes after a guard failure', async () => {
		const failure = new Error('transaction active')
		let reads = 0
		let returns = 0
		const source: AsyncIterator<string> = {
			async next(): Promise<IteratorResult<string>> {
				reads += 1
				return { done: false, value: 'unreachable' }
			},
			async return(): Promise<IteratorResult<string>> {
				returns += 1
				return { done: true, value: undefined }
			},
		}
		const iterator = new DriverIterator(source, () => {
			throw failure
		})

		await expect(iterator.next()).rejects.toBe(failure)
		expect(reads).toBe(0)
		expect(returns).toBe(1)
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		expect(returns).toBe(1)
	})

	it('discards a produced row when the post-read guard fails', async () => {
		const failure = new Error('transaction started during read')
		let guards = 0
		let returns = 0
		const source: AsyncIterator<string> = {
			async next(): Promise<IteratorResult<string>> {
				return { done: false, value: 'payload-secret' }
			},
			async return(): Promise<IteratorResult<string>> {
				returns += 1
				return { done: true, value: undefined }
			},
		}
		const iterator = new DriverIterator(source, () => {
			guards += 1
			if (guards === 2) throw failure
		})

		await expect(iterator.next()).rejects.toBe(failure)
		expect(returns).toBe(1)
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
	})

	it('marks return terminal before awaiting cleanup and invokes cleanup once', async () => {
		const cleanup = Promise.withResolvers<IteratorResult<string>>()
		let returns = 0
		const source: AsyncIterator<string> = {
			async next(): Promise<IteratorResult<string>> {
				return { done: false, value: 'row' }
			},
			return(): Promise<IteratorResult<string>> {
				returns += 1
				return cleanup.promise
			},
		}
		const iterator = new DriverIterator(source, () => undefined)
		const first = iterator.return()

		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		expect(returns).toBe(1)
		cleanup.resolve({ done: true, value: undefined })
		await expect(first).resolves.toEqual({ done: true, value: undefined })
	})

	it('uses source throw when present and permits a nonterminal result to continue', async () => {
		let reads = 0
		let throws = 0
		const source: AsyncIterator<string> = {
			async next(): Promise<IteratorResult<string>> {
				reads += 1
				return reads === 1 ? { done: false, value: 'continued' } : { done: true, value: undefined }
			},
			async throw(): Promise<IteratorResult<string>> {
				throws += 1
				return { done: false, value: 'recovered' }
			},
		}
		const iterator = new DriverIterator(source, () => undefined)

		await expect(iterator.throw(new Error('recoverable'))).resolves.toEqual({
			done: false,
			value: 'recovered',
		})
		await expect(iterator.next()).resolves.toEqual({ done: false, value: 'continued' })
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		expect(throws).toBe(1)
	})

	it('cleans and preserves the caller failure when source throw is absent', async () => {
		const failure = new Error('caller failure')
		let returns = 0
		const source: AsyncIterator<string> = {
			async next(): Promise<IteratorResult<string>> {
				return { done: false, value: 'row' }
			},
			async return(): Promise<IteratorResult<string>> {
				returns += 1
				throw new Error('cleanup failure')
			},
		}
		const iterator = new DriverIterator(source, () => undefined)

		await expect(iterator.throw(failure)).rejects.toBe(failure)
		expect(returns).toBe(1)
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.throw(failure)).rejects.toBe(failure)
		expect(returns).toBe(1)
	})

	it('normalizes return when the source has no cleanup method', async () => {
		const source: AsyncIterator<string> = {
			async next(): Promise<IteratorResult<string>> {
				return { done: false, value: 'row' }
			},
		}
		const iterator = new DriverIterator(source, () => undefined)

		await expect(iterator.return()).resolves.toEqual({ done: true, value: undefined })
		await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
	})
})
