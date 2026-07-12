import type { TableSchema } from '@src/core'
import { migrateRows, planMigration } from '@src/core'
import { describe, expect, it } from 'vitest'

// Local schema-literal builder — kept file-local since only this file diffs
// TableSchema literals directly (AGENTS §16.1: extract once it serves a
// second file).
function schema(overrides: Partial<TableSchema> & { name: string }): TableSchema {
	return { primary: 'id', columns: [], indexes: [], ...overrides }
}

describe('planMigration', () => {
	it('adds a declared table missing from deployed', () => {
		const users = schema({ name: 'users' })
		const plan = planMigration([], [users])
		expect(plan.steps).toEqual([{ operation: 'table.add', table: users }])
	})

	it('removes a deployed table missing from declared', () => {
		const users = schema({ name: 'users' })
		const plan = planMigration([users], [])
		expect(plan.steps).toEqual([{ operation: 'table.remove', table: 'users' }])
	})

	it('orders steps table.remove, then table.add, before per-table changes', () => {
		const gone = schema({ name: 'gone' })
		const fresh = schema({ name: 'fresh' })
		const shared = schema({
			name: 'shared',
			columns: [{ name: 'age', type: 'integer', nullable: false }],
		})
		const sharedBefore = schema({ name: 'shared' })
		const plan = planMigration([gone, sharedBefore], [fresh, shared])
		expect(plan.steps).toEqual([
			{ operation: 'table.remove', table: 'gone' },
			{ operation: 'table.add', table: fresh },
			{
				operation: 'column.add',
				table: 'shared',
				column: { name: 'age', type: 'integer', nullable: false },
			},
		])
	})

	it('adds and removes columns on a shared table', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', type: 'text', nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', type: 'integer', nullable: true }],
		})
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', type: 'integer', nullable: true },
			},
		])
	})

	it('adds and removes index groups by deep equality of the column-name array', () => {
		const before = schema({ name: 'users', indexes: [['name'], ['a', 'b']] })
		const after = schema({ name: 'users', indexes: [['name'], ['b', 'a']] })
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('produces no steps for identical schemas', () => {
		const users = schema({
			name: 'users',
			columns: [{ name: 'name', type: 'text', nullable: false }],
			indexes: [['name']],
		})
		const plan = planMigration([users], [users])
		expect(plan.steps).toEqual([])
	})

	it('defaults from to 0 and to to 1', () => {
		const plan = planMigration([], [])
		expect(plan.from).toBe(0)
		expect(plan.to).toBe(1)
	})

	it('honors explicit from / to labels', () => {
		const plan = planMigration([], [], 3, 4)
		expect(plan.from).toBe(3)
		expect(plan.to).toBe(4)
	})
})

describe('migrateRows', () => {
	it('drops a removed column from every row', () => {
		const rows = [
			{ id: 'a', name: 'Ada', legacy: true },
			{ id: 'b', name: 'Grace', legacy: false },
		]
		const result = migrateRows(rows, [
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
		])
		expect(result).toEqual([
			{ id: 'a', name: 'Ada' },
			{ id: 'b', name: 'Grace' },
		])
	})

	it('leaves rows as-is on column.add (no backfill)', () => {
		const rows = [{ id: 'a', name: 'Ada' }]
		const result = migrateRows(rows, [
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', type: 'integer', nullable: true },
			},
		])
		expect(result).toEqual([{ id: 'a', name: 'Ada' }])
		expect(result[0]).not.toHaveProperty('age')
	})

	it('never mutates the input rows', () => {
		const rows = [{ id: 'a', name: 'Ada', legacy: true }]
		const frozen = rows.map((row) => Object.freeze({ ...row }))
		expect(() =>
			migrateRows(frozen, [{ operation: 'column.remove', table: 'users', column: 'legacy' }]),
		).not.toThrow()
		expect(frozen[0]).toEqual({ id: 'a', name: 'Ada', legacy: true })
	})

	it('returns a new (equal) array on an empty step list', () => {
		const rows = [{ id: 'a', name: 'Ada' }]
		const result = migrateRows(rows, [])
		expect(result).toEqual(rows)
		expect(result).not.toBe(rows)
		expect(result[0]).not.toBe(rows[0])
	})

	it('is a no-op for table / index steps', () => {
		const rows = [{ id: 'a', name: 'Ada' }]
		const result = migrateRows(rows, [
			{ operation: 'table.add', table: { name: 'users', primary: 'id', columns: [], indexes: [] } },
			{ operation: 'index.add', table: 'users', index: ['name'] },
		])
		expect(result).toEqual(rows)
	})
})
