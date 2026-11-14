import type { DriverMetadata, MigrationInput, TableSchema } from './types.js'
import { cloneJSONRecord, cloneJSONValue, isArray, isRecord } from '@orkestrel/contract'
import { DatabaseError, isDatabaseError } from './errors.js'
import { compareValues } from './helpers.js'
import { isDriverMetadata, isDriverSchema, isMigrationInput } from './validators.js'

/**
 * Clones unknown driver metadata into a distinct deeply frozen snapshot.
 *
 * @remarks
 * The clone is validated as {@link DriverMetadata} before it is returned, so a
 * malformed or unexpected value throws a `VALIDATION` {@link DatabaseError} at
 * `context.path === 'metadata'` rather than surfacing a raw Contract or caller error.
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
		if (isDatabaseError(error)) throw error
		throw new DatabaseError('VALIDATION', 'Driver metadata is invalid', {
			path: 'metadata',
			cause: error,
		})
	}
}

/**
 * Clones unknown driver schema into a distinct deeply frozen snapshot.
 *
 * @remarks
 * The clone is validated as a table-schema collection before it is returned, so a
 * malformed or unexpected value throws a `VALIDATION` {@link DatabaseError} at
 * `context.path === 'schema'` rather than surfacing a raw Contract or caller error.
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
		if (isDatabaseError(error)) throw error
		throw new DatabaseError('VALIDATION', 'Driver schema is invalid', {
			path: 'schema',
			cause: error,
		})
	}
}

/**
 * Clones unknown migration input into a distinct deeply frozen snapshot.
 *
 * @remarks
 * The clone is validated as a {@link MigrationInput} before it is returned, so a
 * malformed or unexpected value throws a `VALIDATION` {@link DatabaseError} at
 * `context.path === 'migration'` rather than surfacing a raw Contract or caller error.
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
		if (isDatabaseError(error)) throw error
		throw new DatabaseError('VALIDATION', 'Migration input is invalid', {
			path: 'migration',
			cause: error,
		})
	}
}

/**
 * Copies a read a table is about to admit, so a change its caller makes after admission never
 * reaches the read.
 *
 * @remarks
 * Copies the record, its `conditions` and `order` lists, each condition and ordering term, each
 * operand list, and each list of keys, reading each member once. Operands are kept by reference.
 * A value that is no record, and a part that is no record or no list, is kept as it came, for the
 * query contract to report.
 *
 * @param value - The read, not yet admitted
 * @returns The copy
 *
 * @example
 * ```ts
 * const conditions = [{ column: 'age', operator: 'from', values: [18], connector: 'and' }]
 * const copy = cloneQueryInput({ conditions })
 * conditions.push({ column: 'age', operator: 'to', values: [65], connector: 'and' })
 * copy // { conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] }
 * ```
 */
export function cloneQueryInput(value: unknown): unknown {
	if (!isRecord(value)) return value
	const copy = { ...value }
	const { conditions, order } = copy
	return {
		...copy,
		...(isArray(conditions) ? { conditions: conditions.map(cloneQueryPart) } : {}),
		...(isArray(order) ? { order: order.map(cloneQueryPart) } : {}),
	}
}

/**
 * Copies one condition or ordering term of a read, with its list of keys and its operand list,
 * reading each member once.
 *
 * @param value - The condition or term, not yet admitted
 * @returns The copy, or the value as it came when it is no record
 *
 * @example
 * ```ts
 * cloneQueryPart({ column: ['profile', 'age'], direction: 'ascending' })
 * // { column: ['profile', 'age'], direction: 'ascending' }, a fresh key list included
 * ```
 */
export function cloneQueryPart(value: unknown): unknown {
	if (!isRecord(value)) return value
	const copy = { ...value }
	const { column, values } = copy
	return {
		...copy,
		...(isArray(column) ? { column: [...column] } : {}),
		...(isArray(values) ? { values: [...values] } : {}),
	}
}

/**
 * Canonicalizes an unknown driver schema into a distinct deeply frozen snapshot.
 *
 * @remarks
 * Table and column lists are sorted by name. The index list is sorted by the
 * complete serialized tuple while column order inside each compound index is
 * preserved because it carries index semantics. Validation and ownership flow
 * through {@link cloneDriverSchema} before and after projection.
 *
 * @param value - Unknown driver schema
 * @returns A validated, owned canonical schema
 *
 * @example
 * ```ts
 * const id = { name: 'id', storage: 'text', optional: false, nullable: false } as const
 * const name = { name: 'name', storage: 'text', optional: false, nullable: false } as const
 * normalizeDriverSchema([{ name: 'users', primary: 'id', columns: [name, id], indexes: [] }, { name: 'posts', primary: 'id', columns: [id], indexes: [] }])
 * // [{ name: 'posts', … columns: [id] }, { name: 'users', … columns: [id, name] }], deeply frozen
 * ```
 */
export function normalizeDriverSchema(value: unknown): readonly TableSchema[] {
	const owned = cloneDriverSchema(value)
	const tables = owned.map((table) => ({
		name: table.name,
		primary: table.primary,
		columns: [...table.columns].sort((left, right) => compareValues(left.name, right.name)),
		indexes: [...table.indexes].sort((left, right) =>
			compareValues(JSON.stringify(left), JSON.stringify(right)),
		),
	}))
	tables.sort((left, right) => compareValues(left.name, right.name))
	return cloneDriverSchema(tables)
}
