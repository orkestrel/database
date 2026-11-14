// The IndexedDB driver's own module types. Types are the source of truth:
// implementation and tests conform to them. The shared database vocabulary
// (`QueryInput`, `TableSchema`, `Row`, …) lives in `@orkestrel/database`; only
// this driver's access-path shapes are local.

import type { Condition, Key, Row } from '@src/core'

/**
 * Represents the one access path an IndexedDB read takes: the conditions it answers, the
 * primary store or the index it reads, and the key range or key list it reads there.
 *
 * @remarks
 * `conditions` are the read's conditions the path answers exactly; the read's other conditions
 * are residual. `columns` are the key columns of the source in order: the primary column for
 * the store, or the index's columns. `prefix` is the number of leading columns an `equals`
 * condition binds. An omitted `index` selects the primary store. `range` restricts the source to one key
 * range, and `keys` lists the keys an `any` condition reads instead: one `get(keys)` on the
 * store, or one `only` range per key on an index. With neither, the path reads the whole
 * source. The `@orkestrel/database/browser` entry point exports this type.
 */
export interface AccessPlan {
	readonly conditions: readonly Condition[]
	readonly columns: readonly string[]
	readonly prefix: number
	readonly index?: string
	readonly range?: IDBKeyRange
	readonly keys?: readonly Key[]
}

/**
 * Represents the position of one entry in an access path: its key in the path's source and its
 * primary key, which are the same key on the primary store.
 */
export interface AccessPosition {
	readonly key: IDBValidKey
	readonly primary: IDBValidKey
}

/**
 * Represents one batch a stream reads in one transaction: its rows, and the position of its
 * final entry, which the next batch reads past.
 *
 * @remarks
 * `position` is absent when the batch reached the end of its range or of its page.
 */
export interface AccessBatch {
	readonly rows: readonly Row[]
	readonly position?: AccessPosition
}
