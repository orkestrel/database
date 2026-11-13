import type { ColumnStorage } from '@src/core'

/**
 * Lists the declared {@link ColumnStorage}s that are valid, orderable IndexedDB keys.
 *
 * @remarks
 * `text` / `integer` / `real` occupy IndexedDB's string / number key space, so a
 * column declared with one of them can back a store or index range read.
 * `boolean` / `json` / `blob` are not valid `IDBValidKey`s and a range over one
 * would miss rows, so `findAccessCondition` never narrows on them and the core engine
 * answers those conditions instead. A frozen array: a consumer holding it reads the
 * membership with `includes` and cannot change the driver's access paths.
 */
export const INDEXABLE_STORAGE: readonly ColumnStorage[] = Object.freeze([
	'text',
	'integer',
	'real',
])

/**
 * Names the reserved out-of-line store `__metadata__` the {@link IndexedDBDriver}
 * stamps its {@link DriverMetadata} into.
 *
 * @remarks
 * Backs the driver's `metadata` / `stamp` hooks. A user table named `__metadata__`
 * collides with the driver's own bookkeeping, so a caller must avoid it; the
 * collision is caught at `open`.
 */
export const METADATA_STORE = '__metadata__'
