import {
	cloneDriverMetadata,
	cloneDriverSchema,
	cloneMigrationInput,
	isDatabaseError,
} from '@src/core'
import { isContractError } from '@orkestrel/contract'
import { captureError } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

describe('cloneDriverMetadata', () => {
	it('returns a distinct normalized deeply frozen snapshot isolated from its source', () => {
		const column = { name: 'id', storage: 'text', optional: false, nullable: false }
		const index = ['id']
		const table = {
			name: 'users',
			primary: 'id',
			columns: [column],
			indexes: [index],
		}
		const source = { version: 1, schema: [table] }
		const metadata = cloneDriverMetadata(source)
		const [clonedTable] = metadata.schema
		const [clonedColumn] = clonedTable?.columns ?? []
		const [clonedIndex] = clonedTable?.indexes ?? []

		expect(metadata).not.toBe(source)
		expect(metadata.schema).not.toBe(source.schema)
		expect(clonedTable).not.toBe(table)
		expect(clonedColumn).not.toBe(column)
		expect(clonedIndex).not.toBe(index)
		expect(Object.getPrototypeOf(metadata)).toBeNull()
		expect(clonedTable === undefined ? undefined : Object.getPrototypeOf(clonedTable)).toBeNull()
		expect(clonedColumn === undefined ? undefined : Object.getPrototypeOf(clonedColumn)).toBeNull()
		expect(Object.isFrozen(metadata)).toBe(true)
		expect(Object.isFrozen(metadata.schema)).toBe(true)
		expect(Object.isFrozen(clonedTable)).toBe(true)
		expect(Object.isFrozen(clonedTable?.columns)).toBe(true)
		expect(Object.isFrozen(clonedColumn)).toBe(true)
		expect(Object.isFrozen(clonedTable?.indexes)).toBe(true)
		expect(Object.isFrozen(clonedIndex)).toBe(true)

		source.version = 9
		table.name = 'changed'
		column.name = 'changed'
		index.push('changed')
		source.schema.push({ name: 'posts', primary: 'id', columns: [], indexes: [] })
		expect(metadata).toEqual({
			version: 1,
			schema: [
				{
					name: 'users',
					primary: 'id',
					columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
					indexes: [['id']],
				},
			],
		})
	})

	it('maps malformed metadata to VALIDATION at the metadata path', () => {
		const error = captureError(() => cloneDriverMetadata({ version: '1', schema: [] }))
		expect(isDatabaseError(error)).toBe(true)
		if (!isDatabaseError(error)) throw new Error('Expected DatabaseError')
		expect(error.code).toBe('VALIDATION')
		expect(error.context).toEqual({ path: 'metadata' })
		expect(isContractError(error)).toBe(false)
	})

	it('contains cycles and functions without leaking a raw Contract error', () => {
		const cyclic: Record<string, unknown> = { version: 1, schema: [] }
		cyclic.self = cyclic
		const inputs: readonly unknown[] = [cyclic, { version: 1, schema: [], extra: () => undefined }]

		for (const input of inputs) {
			const error = captureError(() => cloneDriverMetadata(input))
			expect(isDatabaseError(error)).toBe(true)
			if (!isDatabaseError(error)) throw new Error('Expected DatabaseError')
			expect(error.code).toBe('VALIDATION')
			expect(error.context?.path).toBe('metadata')
			expect(isContractError(error.context?.cause)).toBe(true)
			expect(isContractError(error)).toBe(false)
		}
	})

	it('contains accessors and hostile proxies without leaking caller errors', () => {
		const fault = new Error('caller-owned hostile message')
		const accessor = Object.defineProperty({ schema: [] }, 'version', {
			enumerable: true,
			get: () => {
				throw fault
			},
		})
		const hostile = new Proxy(
			{ version: 1, schema: [] },
			{
				ownKeys: () => {
					throw fault
				},
			},
		)
		const revoked = Proxy.revocable({ version: 1, schema: [] }, {})
		revoked.revoke()

		for (const input of [accessor, hostile, revoked.proxy]) {
			const error = captureError(() => cloneDriverMetadata(input))
			expect(isDatabaseError(error)).toBe(true)
			if (!isDatabaseError(error)) throw new Error('Expected DatabaseError')
			expect(error.code).toBe('VALIDATION')
			expect(error.context?.path).toBe('metadata')
			expect(isContractError(error.context?.cause)).toBe(true)
			expect(error).not.toBe(fault)
			expect(error.context?.cause).not.toBe(fault)
			expect(error.message).not.toContain(fault.message)
		}
	})
})

describe('cloneDriverSchema', () => {
	it('returns an owned, deeply frozen schema snapshot', () => {
		const source = [
			{
				name: 'users',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [['id']],
			},
		]
		const schema = cloneDriverSchema(source)
		const [table] = schema

		expect(schema).not.toBe(source)
		expect(table).not.toBe(source[0])
		expect(Object.isFrozen(schema)).toBe(true)
		expect(Object.isFrozen(table)).toBe(true)
		expect(Object.isFrozen(table?.columns)).toBe(true)
		expect(Object.isFrozen(table?.indexes)).toBe(true)
		source[0]?.columns.push({ name: 'name', storage: 'text', optional: false, nullable: true })
		expect(schema[0]?.columns).toEqual([
			{ name: 'id', storage: 'text', optional: false, nullable: false },
		])
	})

	it('contains invalid JSON and reports the schema path', () => {
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		const error = captureError(() => cloneDriverSchema(cyclic))
		if (!isDatabaseError(error)) throw new Error('Expected DatabaseError')
		expect(error.code).toBe('VALIDATION')
		expect(error.context?.path).toBe('schema')
		expect(isContractError(error.context?.cause)).toBe(true)
	})
})

describe('cloneMigrationInput', () => {
	it('owns the ordered plan and optional metadata atomically', () => {
		const input = {
			plan: {
				from: 1,
				to: 2,
				steps: [{ operation: 'column.remove', table: 'users', column: 'legacy' }],
			},
			metadata: {
				version: 2,
				schema: [
					{
						name: 'users',
						primary: 'id',
						columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
						indexes: [],
					},
				],
			},
		}
		const owned = cloneMigrationInput(input)

		expect(owned).not.toBe(input)
		expect(owned.plan).not.toBe(input.plan)
		expect(owned.plan.steps).not.toBe(input.plan.steps)
		expect(owned.metadata).not.toBe(input.metadata)
		expect(Object.isFrozen(owned)).toBe(true)
		expect(Object.isFrozen(owned.plan)).toBe(true)
		expect(Object.isFrozen(owned.plan.steps)).toBe(true)
		expect(Object.isFrozen(owned.metadata)).toBe(true)
	})

	it('contains hostile traversal and reports the migration path', () => {
		const fault = new Error('hostile migration')
		const input = Object.defineProperty({}, 'plan', {
			enumerable: true,
			get: () => {
				throw fault
			},
		})
		const error = captureError(() => cloneMigrationInput(input))
		if (!isDatabaseError(error)) throw new Error('Expected DatabaseError')
		expect(error.code).toBe('VALIDATION')
		expect(error.context?.path).toBe('migration')
		expect(isContractError(error.context?.cause)).toBe(true)
		expect(error).not.toBe(fault)
		expect(error.context?.cause).not.toBe(fault)
	})
})
