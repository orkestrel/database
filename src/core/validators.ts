import type {
	ColumnSchema,
	DriverMetadata,
	Key,
	Migration,
	MigrationInput,
	MigrationStep,
	TableSchema,
} from './types.js'
import { cloneJSONRecord, cloneJSONValue } from '@orkestrel/contract'

/**
 * Checks whether a value is a usable database key.
 *
 * @param value - The value to test
 * @returns True if `value` is a string or a finite number; false otherwise
 */
export function isKey(value: unknown): value is Key {
	return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Checks whether a value is a portable column schema.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link ColumnSchema}; false otherwise
 */
export function isColumnSchema(value: unknown): value is ColumnSchema {
	try {
		const column = cloneJSONRecord(value)
		const keys = Object.keys(column)
		return (
			keys.length === 4 &&
			keys.includes('name') &&
			keys.includes('storage') &&
			keys.includes('optional') &&
			keys.includes('nullable') &&
			typeof column.name === 'string' &&
			column.name.length > 0 &&
			(column.storage === 'text' ||
				column.storage === 'integer' ||
				column.storage === 'real' ||
				column.storage === 'boolean' ||
				column.storage === 'json' ||
				column.storage === 'blob') &&
			typeof column.optional === 'boolean' &&
			typeof column.nullable === 'boolean'
		)
	} catch {
		return false
	}
}

/**
 * Checks whether a value is a portable table schema.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link TableSchema}; false otherwise
 */
export function isTableSchema(value: unknown): value is TableSchema {
	try {
		const table = cloneJSONRecord(value)
		const keys = Object.keys(table)
		if (
			keys.length !== 4 ||
			!keys.includes('name') ||
			!keys.includes('primary') ||
			!keys.includes('columns') ||
			!keys.includes('indexes') ||
			typeof table.name !== 'string' ||
			table.name.length === 0 ||
			typeof table.primary !== 'string' ||
			table.primary.length === 0 ||
			!Array.isArray(table.columns) ||
			!Array.isArray(table.indexes) ||
			!table.columns.every(isColumnSchema)
		) {
			return false
		}
		const names = table.columns.map((column) => column.name)
		if (
			new Set(names).size !== names.length ||
			!names.includes(table.primary) ||
			!table.indexes.every(
				(index) =>
					Array.isArray(index) &&
					index.length > 0 &&
					index.every((column) => typeof column === 'string' && names.includes(column)),
			)
		) {
			return false
		}
		const indexes = table.indexes.map((index) => JSON.stringify(index))
		return new Set(indexes).size === indexes.length
	} catch {
		return false
	}
}

/**
 * Checks whether a value is a complete portable driver schema.
 *
 * @param value - The value to test
 * @returns True if `value` is a table-schema collection with unique table names; false otherwise
 */
export function isDriverSchema(value: unknown): value is readonly TableSchema[] {
	try {
		const schema = cloneJSONValue(value)
		if (!Array.isArray(schema) || !schema.every(isTableSchema)) return false
		const names = schema.map((table) => table.name)
		return new Set(names).size === names.length
	} catch {
		return false
	}
}

/**
 * Checks whether a value is one ordered migration step.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link MigrationStep}; false otherwise
 */
export function isMigrationStep(value: unknown): value is MigrationStep {
	try {
		const step = cloneJSONRecord(value)
		if (typeof step.operation !== 'string') return false
		const keys = Object.keys(step)
		switch (step.operation) {
			case 'table.add':
				return (
					keys.length === 2 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					isTableSchema(step.table)
				)
			case 'table.remove':
				return (
					keys.length === 2 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					typeof step.table === 'string' &&
					step.table.length > 0
				)
			case 'column.add':
				return (
					keys.length === 3 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					keys.includes('column') &&
					typeof step.table === 'string' &&
					step.table.length > 0 &&
					isColumnSchema(step.column)
				)
			case 'column.remove':
				return (
					keys.length === 3 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					keys.includes('column') &&
					typeof step.table === 'string' &&
					step.table.length > 0 &&
					typeof step.column === 'string' &&
					step.column.length > 0
				)
			case 'index.add':
			case 'index.remove':
				return (
					keys.length === 3 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					keys.includes('index') &&
					typeof step.table === 'string' &&
					step.table.length > 0 &&
					Array.isArray(step.index) &&
					step.index.length > 0 &&
					step.index.every((column) => typeof column === 'string' && column.length > 0)
				)
			default:
				return false
		}
	} catch {
		return false
	}
}

/**
 * Checks whether a value is an ordered migration plan.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link Migration}; false otherwise
 */
export function isMigration(value: unknown): value is Migration {
	try {
		const migration = cloneJSONRecord(value)
		const keys = Object.keys(migration)
		return (
			keys.length === 3 &&
			keys.includes('from') &&
			keys.includes('to') &&
			keys.includes('steps') &&
			typeof migration.from === 'number' &&
			Number.isFinite(migration.from) &&
			typeof migration.to === 'number' &&
			Number.isFinite(migration.to) &&
			Array.isArray(migration.steps) &&
			migration.steps.every(isMigrationStep)
		)
	} catch {
		return false
	}
}

/**
 * Checks whether a value is persisted driver metadata.
 *
 * @param value - The value to test
 * @returns True if `value` is complete {@link DriverMetadata}; false otherwise
 */
export function isDriverMetadata(value: unknown): value is DriverMetadata {
	try {
		const metadata = cloneJSONRecord(value)
		const keys = Object.keys(metadata)
		return (
			keys.length === 2 &&
			keys.includes('version') &&
			keys.includes('schema') &&
			typeof metadata.version === 'number' &&
			Number.isFinite(metadata.version) &&
			isDriverSchema(metadata.schema)
		)
	} catch {
		return false
	}
}

/**
 * Checks whether a value is one atomic migration request.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link MigrationInput}; false otherwise
 */
export function isMigrationInput(value: unknown): value is MigrationInput {
	try {
		const input = cloneJSONRecord(value)
		const keys = Object.keys(input)
		return (
			(keys.length === 1 || keys.length === 2) &&
			keys.includes('plan') &&
			(keys.length === 1 || keys.includes('metadata')) &&
			isMigration(input.plan) &&
			(input.metadata === undefined || isDriverMetadata(input.metadata))
		)
	} catch {
		return false
	}
}
