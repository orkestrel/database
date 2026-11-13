// The IndexedDB driver's own module types. Types are the source of truth:
// implementation and tests conform to them. The shared database vocabulary
// (`QueryInput`, `TableSchema`, `Row`, …) lives in `@orkestrel/database`; only
// this driver's access-path shape is local.

/**
 * Represents the key-range read behind a plan's native side — an optional index and an
 * optional `IDBKeyRange`. An omitted `index` selects the primary store; an omitted `range`
 * reads the whole store, so `{}` is a whole-store read. The
 * `@orkestrel/database/browser` entry point exports this type.
 */
export interface AccessPlan {
	readonly index?: string
	readonly range?: IDBKeyRange
}
