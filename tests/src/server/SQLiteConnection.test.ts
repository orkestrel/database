import { SQLiteConnection, STATEMENT_LIMIT } from '@src/server'
import { createSQLiteDatabase } from '@orkestrel/sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseFixture } from '../../setup.js'

// The driver's per-connection statement cache, over a real in-memory SQLite connection.

const connection = new DatabaseFixture<SQLiteConnection>()

beforeEach(() => {
	const database = createSQLiteDatabase({ path: ':memory:' })
	database.connect()
	connection.hold(new SQLiteConnection(database))
})

afterEach(() => {
	connection.value.database.close()
	connection.clear()
})

describe('SQLiteConnection', () => {
	it('returns the one cached statement for a text, and a fresh one for another text', () => {
		const statement = connection.value.prepare('SELECT ? AS "answer"')
		expect(connection.value.prepare('SELECT ? AS "answer"')).toBe(statement)
		expect(connection.value.prepare('SELECT ? AS "other"')).not.toBe(statement)
		expect(statement.get([42])).toEqual({ answer: 42 })
		expect(statement.all([7])).toEqual([{ answer: 7 }])
	})

	it('evicts the least recently used text past the limit and keeps a text used since', () => {
		const first = connection.value.prepare('SELECT 0 AS "n"')
		const second = connection.value.prepare('SELECT 1 AS "n"')
		for (const index of Array.from({ length: STATEMENT_LIMIT - 2 }, (_, offset) => offset + 2)) {
			connection.value.prepare(`SELECT ${String(index)} AS "n"`)
		}
		expect(connection.value.prepare('SELECT 0 AS "n"')).toBe(first)
		connection.value.prepare(`SELECT ${String(STATEMENT_LIMIT)} AS "n"`)
		expect(connection.value.prepare('SELECT 0 AS "n"')).toBe(first)
		expect(connection.value.prepare('SELECT 1 AS "n"')).not.toBe(second)
	})
})
