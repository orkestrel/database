import type { ColumnStorage } from '@src/core'

/**
 * The declared {@link ColumnStorage}s that are valid, orderable IndexedDB keys.
 *
 * @remarks
 * `text` / `integer` / `real` occupy IndexedDB's string / number key space, so a
 * column declared with one of them can back a store or index range read.
 * `boolean` / `json` / `blob` are not valid `IDBValidKey`s and a range over one
 * would silently miss rows, so `selectPlan` never pushes a condition down on
 * them and the core engine answers the read instead.
 */
export const INDEXABLE_STORAGE: ReadonlySet<ColumnStorage> = new Set<ColumnStorage>([
	'text',
	'integer',
	'real',
])

/**
 * The reserved out-of-line store the {@link IndexedDBDriver} stamps its
 * {@link DriverMetadata} into.
 *
 * @remarks
 * Backs the driver's `metadata` / `stamp` hooks. A user table declared with this
 * exact name collides with the driver's own bookkeeping, so a caller must avoid
 * it; the collision is caught at `open`.
 */
export const METADATA_STORE = '__metadata__'
