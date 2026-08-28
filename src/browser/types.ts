// The IndexedDB driver's own module types. Types are the source of truth:
// implementation and tests conform to them. The shared database vocabulary
// (`QueryInput`, `TableSchema`, `Row`,
// …) lives in `@orkestrel/database`; only this driver's pushdown-planning shape is local.

/**
 * A pushdown plan — an optional index and optional `IDBKeyRange` used to narrow
 * a read. An omitted `index` selects the primary store; an omitted `range`
 * performs a full scan. The plan is always a superset of the matching rows;
 * the core engine refines it to the exact result. An empty plan (`{}`) is a
 * primary-store full scan.
 */
export interface QueryPlan {
	readonly index?: string
	readonly range?: IDBKeyRange
}
