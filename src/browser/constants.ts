import type { ColumnStorage } from '@src/core'

// The column types that are valid, orderable IndexedDB keys (string / number key
// space). `boolean` / `json` / `blob` are not valid `IDBValidKey`s and would make
// a range silently miss rows, so they are never pushed down.
export const INDEXABLE_STORAGE: ReadonlySet<ColumnStorage> = new Set<ColumnStorage>([
	'text',
	'integer',
	'real',
])

// The reserved out-of-line store the driver stamps its DriverMetadata into
// (`metadata` / `stamp`). A user table declared with this exact name would
// collide with the driver's own bookkeeping — callers must avoid it.
export const METADATA_STORE = '__metadata__'
