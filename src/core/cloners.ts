import type { DriverMetadata, MigrationInput, TableSchema } from './types.js'
import { cloneJSONRecord, cloneJSONValue } from '@orkestrel/contract'
import { DatabaseError } from './errors.js'
import { isDriverMetadata, isDriverSchema, isMigrationInput } from './validators.js'

/**
 * Clone unknown driver metadata into a distinct deeply frozen snapshot.
 *
 * @param value - Unknown metadata
 * @returns Owned driver metadata
 */
export function cloneDriverMetadata(value: unknown): DriverMetadata {
	try {
		const metadata = cloneJSONRecord(value)
		if (isDriverMetadata(metadata)) return metadata
		throw new DatabaseError('VALIDATION', 'Driver metadata is invalid', {
			path: 'metadata',
		})
	} catch (error) {
		if (error instanceof DatabaseError) throw error
		throw new DatabaseError('VALIDATION', 'Driver metadata is invalid', {
			path: 'metadata',
			cause: error,
		})
	}
}

/**
 * Clone unknown driver schema into a distinct deeply frozen snapshot.
 *
 * @param value - Unknown table schema collection
 * @returns Owned driver schema
 */
export function cloneDriverSchema(value: unknown): readonly TableSchema[] {
	try {
		const schema = cloneJSONValue(value)
		if (isDriverSchema(schema)) return schema
		throw new DatabaseError('VALIDATION', 'Driver schema is invalid', {
			path: 'schema',
		})
	} catch (error) {
		if (error instanceof DatabaseError) throw error
		throw new DatabaseError('VALIDATION', 'Driver schema is invalid', {
			path: 'schema',
			cause: error,
		})
	}
}

/**
 * Clone unknown migration input into a distinct deeply frozen snapshot.
 *
 * @param value - Unknown migration input
 * @returns Owned migration input
 */
export function cloneMigrationInput(value: unknown): MigrationInput {
	try {
		const input = cloneJSONRecord(value)
		if (isMigrationInput(input)) return input
		throw new DatabaseError('VALIDATION', 'Migration input is invalid', {
			path: 'migration',
		})
	} catch (error) {
		if (error instanceof DatabaseError) throw error
		throw new DatabaseError('VALIDATION', 'Migration input is invalid', {
			path: 'migration',
			cause: error,
		})
	}
}
