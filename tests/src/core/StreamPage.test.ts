import { describe, expect, it } from 'vitest'
import { StreamPage } from '@src/core'

describe('StreamPage', () => {
	it('skips the offset and counts only admitted rows', () => {
		const page = new StreamPage(2)
		expect(page.count).toBe(0)
		expect(page.next()).toBe(false)
		expect(page.next()).toBe(false)
		expect(page.count).toBe(0)
		expect(page.next()).toBe(true)
		expect(page.count).toBe(1)
		expect(page.next()).toBe(true)
		expect(page.count).toBe(2)
	})

	it('admits the initial row with zero offset', () => {
		const page = new StreamPage(0)
		expect(page.next()).toBe(true)
		expect(page.count).toBe(1)
	})
})
