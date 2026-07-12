// The IndexedDB driver's own module types. Types are the source of truth
// (AGENTS §2). The shared database vocabulary (`Criteria`, `TableSchema`, `Row`,
// …) lives in `@src/core`; only this driver's pushdown-planning shape is local.

/**
 * A pushdown plan — which index (or the primary store, `null`) to read and the
 * `IDBKeyRange` to narrow by (`null` = full scan). Always a SUPERSET of the
 * matching rows; the core engine refines it to the exact result.
 */
export interface QueryPlan {
	readonly index: string | null
	readonly range: IDBKeyRange | null
}
