import {
	cloneDriverMetadata,
	cloneDriverSchema,
	cloneMigrationInput,
	cloneQueryInput,
	cloneQueryPart,
	isDatabaseError,
} from '@src/core'
import { isContractError } from '@orkestrel/contract'
import { captureError, createRecorder } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import { emptyValue } from '../../setup.js'

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
		const inputs: readonly unknown[] = [cyclic, { version: 1, schema: [], extra: emptyValue }]

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

describe('cloneQueryInput', () => {
	it('copies the read, its lists, each condition and term, and each key and operand list', () => {
		const condition = {
			column: ['meta', 'x'],
			operator: 'any',
			values: [1, { a: 1 }],
			connector: 'and',
		}
		const term = { column: ['meta', 'y'], direction: 'ascending' }
		const input = { conditions: [condition], order: [term], limit: 1, extra: true }
		const copy = cloneQueryInput(input)
		expect(copy).toEqual(input)
		expect(copy).not.toBe(input)
		const copied =
			copy !== null && typeof copy === 'object' && 'conditions' in copy
				? copy.conditions
				: undefined
		expect(Array.isArray(copied) ? copied[0] : undefined).not.toBe(condition)
		condition.values.push(2)
		condition.column.push('z')
		term.column.push('z')
		input.conditions.push(condition)
		expect(copy).toEqual({
			conditions: [
				{ column: ['meta', 'x'], operator: 'any', values: [1, { a: 1 }], connector: 'and' },
			],
			order: [{ column: ['meta', 'y'], direction: 'ascending' }],
			limit: 1,
			extra: true,
		})
	})

	it('keeps a value that is no record, and a part that is no record or no list, as it came', () => {
		expect(cloneQueryInput(null)).toBeNull()
		expect(cloneQueryInput({ conditions: 'x', order: [3] })).toEqual({
			conditions: 'x',
			order: [3],
		})
		expect(cloneQueryPart(5)).toBe(5)
		expect(cloneQueryPart({ column: 'n', values: 'x' })).toEqual({ column: 'n', values: 'x' })
	})

	it('reads each member once', () => {
		const reads = createRecorder<[]>()
		const input = Object.defineProperty({}, 'conditions', {
			enumerable: true,
			get: () => {
				reads.handler()
				return []
			},
		})
		expect(cloneQueryInput(input)).toEqual({ conditions: [] })
		expect(reads.calls).toHaveLength(1)
	})
})
