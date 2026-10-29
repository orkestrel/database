import { describe, expect, it } from 'vitest'
import { MemoryDriver } from '@src/core'
import { JSONTransaction } from '@src/server'
import { tableSchemas } from '../../setup.js'

describe('JSONTransaction', () => {
	it('keeps projected schema and identities after invalidating the memory capability', async () => {
		const memory = new MemoryDriver()
		await memory.open(tableSchemas('users'))
		const original = {}
		const identities = new Map([['users', original]])
		const transaction = new JSONTransaction(memory, tableSchemas('users'), identities)
		identities.clear()
		expect(transaction.identities.get('users')).toBe(original)
		expect(transaction.memory).toBe(memory)
		const projected = tableSchemas('posts')
		const next = new Map([['posts', {}]])
		transaction.project(projected, next)
		transaction.stop()
		transaction.stop()
		expect(() => transaction.memory).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
		expect(transaction.schema).toBe(projected)
		expect(transaction.identities).toBe(next)
		await memory.close()
	})
})
