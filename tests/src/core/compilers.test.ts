import type { ColumnSchema, MigrationStep, TableSchema } from '@src/core'
import { isDatabaseError, planMigration, projectMigrationSchema } from '@src/core'
import { captureError } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { MIGRATION_USERS, schema } from '../../setup.js'

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
			columns: [{ name: 'age', storage: 'integer', optional: true, nullable: false }],
		})
		const sharedBefore = schema({ name: 'shared' })
		const plan = planMigration([gone, sharedBefore], [fresh, shared])
		expect(plan.steps).toEqual([
			{ operation: 'table.remove', table: 'gone' },
			{ operation: 'table.add', table: fresh },
			{
				operation: 'column.add',
				table: 'shared',
				column: { name: 'age', storage: 'integer', optional: true, nullable: false },
			},
		])
	})

	it('adds and removes columns on a shared table', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', storage: 'text', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: true }],
		})
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', storage: 'integer', optional: false, nullable: true },
			},
		])
	})

	it('adds and removes index groups by deep equality of the column-name array', () => {
		const columns: readonly ColumnSchema[] = [
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'a', storage: 'text', optional: false, nullable: false },
			{ name: 'b', storage: 'text', optional: false, nullable: false },
		]
		const before = schema({ name: 'users', columns, indexes: [['name'], ['a', 'b']] })
		const after = schema({ name: 'users', columns, indexes: [['name'], ['b', 'a']] })
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('produces no steps for identical schemas', () => {
		const users = schema({
			name: 'users',
			columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
			indexes: [['name']],
		})
		const plan = planMigration([users], [users])
		expect(plan.steps).toEqual([])
	})

	it('produces no steps when only table, column, and index-list order differs', () => {
		const users = schema({
			name: 'users',
			columns: [
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: true, nullable: false },
			],
			indexes: [['name'], ['age', 'name']],
		})
		const posts = schema({ name: 'posts' })
		const reorderedUsers: TableSchema = {
			...users,
			columns: [...users.columns].reverse(),
			indexes: [...users.indexes].reverse(),
		}
		expect(planMigration([users, posts], [posts, reorderedUsers]).steps).toEqual([])
	})

	it('preserves compound-index column order as migration-significant', () => {
		const columns: readonly ColumnSchema[] = [
			{ name: 'a', storage: 'text', optional: false, nullable: false },
			{ name: 'b', storage: 'text', optional: false, nullable: false },
		]
		const before = schema({ name: 'users', columns, indexes: [['a', 'b']] })
		const after = schema({ name: 'users', columns, indexes: [['b', 'a']] })
		expect(planMigration([before], [after]).steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('rejects adding a required non-null column to an existing table', () => {
		const before = schema({ name: 'users' })
		const after = schema({
			name: 'users',
			columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(error).toMatchObject({
			code: 'MIGRATION',
			message:
				"migrate: required non-null column 'name' cannot be added automatically to existing table 'users'",
			context: { table: 'users', column: 'name' },
		})
	})

	it('throws a MIGRATION DatabaseError when a shared column changes type', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'text', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('users')
	})

	it('throws a MIGRATION DatabaseError when a shared column changes nullability', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: true }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
	})

	it('throws MIGRATION when a shared table changes primary or a column changes optionality', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const primary = { ...before, primary: 'age' }
		const optional = {
			...before,
			columns: before.columns.map((column) =>
				column.name === 'age' ? { ...column, optional: true } : column,
			),
		}
		expect(captureError(() => planMigration([before], [primary]))).toMatchObject({
			code: 'MIGRATION',
		})
		expect(captureError(() => planMigration([before], [optional]))).toMatchObject({
			code: 'MIGRATION',
		})
	})

	it('removes dependent indexes before removing their columns', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', storage: 'text', optional: false, nullable: false }],
			indexes: [['legacy']],
		})
		const after = schema({ name: 'users' })
		expect(planMigration([before], [after]).steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['legacy'] },
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
		])
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

describe('projectMigrationSchema', () => {
	const users = MIGRATION_USERS

	it('projects ordered table, column, and index transitions to a fresh valid schema', () => {
		const result = projectMigrationSchema(
			[users],
			[
				{ operation: 'index.remove', table: 'users', index: ['name'] },
				{ operation: 'column.remove', table: 'users', column: 'name' },
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'age', storage: 'integer', optional: true, nullable: false },
				},
				{ operation: 'index.add', table: 'users', index: ['age'] },
			],
		)
		expect(result).toEqual([
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'age', storage: 'integer', optional: true, nullable: false },
					{ name: 'id', storage: 'text', optional: false, nullable: false },
				],
				indexes: [['age']],
			},
		])
		expect(result[0]).not.toBe(users)
	})

	it('rejects invalid sequential transitions before publishing a schema', () => {
		const cases: ReadonlyArray<readonly MigrationStep[]> = [
			[{ operation: 'table.remove', table: 'missing' }],
			[{ operation: 'column.remove', table: 'users', column: 'id' }],
			[{ operation: 'column.remove', table: 'users', column: 'name' }],
			[{ operation: 'index.add', table: 'users', index: ['missing'] }],
			[{ operation: 'index.remove', table: 'users', index: ['id'] }],
		]
		for (const steps of cases) {
			expect(captureError(() => projectMigrationSchema([users], steps))).toMatchObject({
				code: 'MIGRATION',
			})
		}
	})

	it('accepts optional-only and nullable-only additions but rejects required non-null additions', () => {
		const optional = projectMigrationSchema(
			[users],
			[
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'optional', storage: 'text', optional: true, nullable: false },
				},
			],
		)
		const nullable = projectMigrationSchema(
			[users],
			[
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'nullable', storage: 'text', optional: false, nullable: true },
				},
			],
		)
		expect(optional[0]?.columns.some((column) => column.name === 'optional')).toBe(true)
		expect(nullable[0]?.columns.some((column) => column.name === 'nullable')).toBe(true)
		expect(
			captureError(() =>
				projectMigrationSchema(
					[users],
					[
						{
							operation: 'column.add',
							table: 'users',
							column: {
								name: 'required',
								storage: 'text',
								optional: false,
								nullable: false,
							},
						},
					],
				),
			),
		).toMatchObject({ code: 'MIGRATION', context: { table: 'users', column: 'required' } })
	})
})
