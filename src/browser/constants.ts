import type { ColumnType } from '@src/core'

// The column types that are valid, orderable IndexedDB keys (string / number key
// space). `boolean` / `json` / `blob` are not valid `IDBValidKey`s and would make
// a range silently miss rows, so they are never pushed down.
export const INDEXABLE_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
	'text',
	'integer',
	'real',
])
