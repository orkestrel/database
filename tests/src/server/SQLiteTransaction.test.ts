import { describe, expect, it } from 'vitest'
import { SQLiteTransaction } from '@src/server'
import { tableSchemas } from '../../setup.js'

describe('SQLiteTransaction', () => {
	it('copies admission maps and replaces the candidate schema and identities together', () => {
		const schema = new Map(tableSchemas('users').map((table) => [table.name, table]))
		const identity = {}
		const identities = new Map([['users', identity]])
		const transaction = new SQLiteTransaction(schema, identities)
		schema.clear()
		identities.clear()
		expect([...transaction.schema.keys()]).toEqual(['users'])
		expect(transaction.identities.get('users')).toBe(identity)
		const projected = new Map([['posts', {}]])
		transaction.project(tableSchemas('posts'), projected)
		expect([...transaction.schema.keys()]).toEqual(['posts'])
		expect(transaction.identities).toBe(projected)
	})
})
