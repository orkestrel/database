import type {
	ColumnSchema,
	DriverMetadata,
	Key,
	Migration,
	MigrationInput,
	MigrationStep,
	TableSchema,
} from './types.js'
import {
	arrayOf,
	cloneJSONRecord,
	cloneJSONValue,
	holds,
	isArray,
	isBoolean,
	isFiniteNumber,
	isString,
} from '@orkestrel/contract'

/**
 * Checks whether a value is a usable database key.
 *
 * @param value - The value to test
 * @returns True if `value` is a string or a finite number; false otherwise
 */
export function isKey(value: unknown): value is Key {
	return isString(value) || isFiniteNumber(value)
}

/**
 * Checks whether a value is a portable column schema.
 *
 * @remarks
 * Total over any input: a hostile getter, a revoked proxy, or a cyclic value is
 * contained as a non-match rather than a throw.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link ColumnSchema}; false otherwise
 */
export function isColumnSchema(value: unknown): value is ColumnSchema {
	return holds(() => {
		const column = cloneJSONRecord(value)
		const keys = Object.keys(column)
		return (
			keys.length === 4 &&
			keys.includes('name') &&
			keys.includes('storage') &&
			keys.includes('optional') &&
			keys.includes('nullable') &&
			isString(column.name) &&
			column.name.length > 0 &&
			(column.storage === 'text' ||
				column.storage === 'integer' ||
				column.storage === 'real' ||
				column.storage === 'boolean' ||
				column.storage === 'json' ||
				column.storage === 'blob') &&
			isBoolean(column.optional) &&
			isBoolean(column.nullable)
		)
	})
}

/**
 * Checks whether a value is a portable table schema.
 *
 * @remarks
 * Total over any input: a hostile getter, a revoked proxy, or a cyclic value is
 * contained as a non-match rather than a throw.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link TableSchema}; false otherwise
 */
export function isTableSchema(value: unknown): value is TableSchema {
	return holds(() => {
		const table = cloneJSONRecord(value)
		const keys = Object.keys(table)
		if (
			keys.length !== 4 ||
			!keys.includes('name') ||
			!keys.includes('primary') ||
			!keys.includes('columns') ||
			!keys.includes('indexes') ||
			!isString(table.name) ||
			table.name.length === 0 ||
			!isString(table.primary) ||
			table.primary.length === 0 ||
			!arrayOf(isColumnSchema)(table.columns) ||
			!isArray(table.indexes)
		) {
			return false
		}
		const names = table.columns.map((column) => column.name)
		if (
			new Set(names).size !== names.length ||
			!names.includes(table.primary) ||
			!table.indexes.every(
				(index) =>
					isArray(index) &&
					index.length > 0 &&
					index.every((column) => isString(column) && names.includes(column)),
			)
		) {
			return false
		}
		const indexes = table.indexes.map((index) => JSON.stringify(index))
		return new Set(indexes).size === indexes.length
	})
}

/**
 * Checks whether a value is a complete portable driver schema.
 *
 * @remarks
 * Total over any input: a hostile getter, a revoked proxy, or a cyclic value is
 * contained as a non-match rather than a throw.
 *
 * @param value - The value to test
 * @returns True if `value` is a table-schema collection with unique table names; false otherwise
 */
export function isDriverSchema(value: unknown): value is readonly TableSchema[] {
	return holds(() => {
		const schema = cloneJSONValue(value)
		if (!arrayOf(isTableSchema)(schema)) return false
		const names = schema.map((table) => table.name)
		return new Set(names).size === names.length
	})
}

/**
 * Checks whether a value is one ordered migration step.
 *
 * @remarks
 * Total over any input: a hostile getter, a revoked proxy, or a cyclic value is
 * contained as a non-match rather than a throw.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link MigrationStep}; false otherwise
 */
export function isMigrationStep(value: unknown): value is MigrationStep {
	return holds(() => {
		const step = cloneJSONRecord(value)
		if (!isString(step.operation)) return false
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
					isString(step.table) &&
					step.table.length > 0
				)
			case 'column.add':
				return (
					keys.length === 3 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					keys.includes('column') &&
					isString(step.table) &&
					step.table.length > 0 &&
					isColumnSchema(step.column)
				)
			case 'column.remove':
				return (
					keys.length === 3 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					keys.includes('column') &&
					isString(step.table) &&
					step.table.length > 0 &&
					isString(step.column) &&
					step.column.length > 0
				)
			case 'index.add':
			case 'index.remove':
				return (
					keys.length === 3 &&
					keys.includes('operation') &&
					keys.includes('table') &&
					keys.includes('index') &&
					isString(step.table) &&
					step.table.length > 0 &&
					isArray(step.index) &&
					step.index.length > 0 &&
					step.index.every((column) => isString(column) && column.length > 0)
				)
			default:
				return false
		}
	})
}

/**
 * Checks whether a value is an ordered migration plan.
 *
 * @remarks
 * Total over any input: a hostile getter, a revoked proxy, or a cyclic value is
 * contained as a non-match rather than a throw.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link Migration}; false otherwise
 */
export function isMigration(value: unknown): value is Migration {
	return holds(() => {
		const migration = cloneJSONRecord(value)
		const keys = Object.keys(migration)
		return (
			keys.length === 3 &&
			keys.includes('from') &&
			keys.includes('to') &&
			keys.includes('steps') &&
			isFiniteNumber(migration.from) &&
			isFiniteNumber(migration.to) &&
			isArray(migration.steps) &&
			migration.steps.every(isMigrationStep)
		)
	})
}

/**
 * Checks whether a value is persisted driver metadata.
 *
 * @remarks
 * The boundary check a versioning driver's `metadata()` narrows a stored or
 * deserialized record through, so no call site needs an assertion. Total over any
 * input: a hostile getter, a revoked proxy, or a cyclic value is contained as a
 * non-match rather than a throw.
 *
 * @param value - The value to test
 * @returns True if `value` is complete {@link DriverMetadata}; false otherwise
 */
export function isDriverMetadata(value: unknown): value is DriverMetadata {
	return holds(() => {
		const metadata = cloneJSONRecord(value)
		const keys = Object.keys(metadata)
		return (
			keys.length === 2 &&
			keys.includes('version') &&
			keys.includes('schema') &&
			isFiniteNumber(metadata.version) &&
			isDriverSchema(metadata.schema)
		)
	})
}

/**
 * Checks whether a value is one atomic migration request.
 *
 * @remarks
 * Total over any input: a hostile getter, a revoked proxy, or a cyclic value is
 * contained as a non-match rather than a throw.
 *
 * @param value - The value to test
 * @returns True if `value` is a complete {@link MigrationInput}; false otherwise
 */
export function isMigrationInput(value: unknown): value is MigrationInput {
	return holds(() => {
		const input = cloneJSONRecord(value)
		const keys = Object.keys(input)
		return (
			(keys.length === 1 || keys.length === 2) &&
			keys.includes('plan') &&
			(keys.length === 1 || keys.includes('metadata')) &&
			isMigration(input.plan) &&
			(input.metadata === undefined || isDriverMetadata(input.metadata))
		)
	})
}
