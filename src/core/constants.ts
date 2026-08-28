import type { ColumnSchema, TableSchema } from './types.js'

// Database constants — frozen plain data.

/**
 * The primary-key column assumed when {@link PrimaryMap} does not name one.
 *
 * @remarks
 * `id` is the convention IndexedDB (`keyPath: 'id'`) and SQL (`id` / rowid) both
 * lean on, so a table without a `primary` override keys its rows by `id`.
 */
export const DEFAULT_PRIMARY = 'id'

/**
 * The longest `LIKE` / `GLOB` pattern the wildcard matcher accepts before rejecting it.
 *
 * @remarks
 * A `LIKE` / `GLOB` pattern is a caller-supplied operand, so
 * `matchesLikePattern` / `matchesGlobPattern` run patterns this package cannot
 * trust. The matcher is the LINEAR greedy two-pointer wildcard match — never a
 * backtracking regex (`.*`-segments-separated-by-literals against a long input is the
 * catastrophic shape JS cannot bound without atomic groups), so it is O(value ×
 * pattern). Capping the pattern length bounds that pattern factor, leaving a match
 * linear in the value length whatever the pattern. A longer pattern throws a
 * `VALIDATION` {@link DatabaseError}; the cap is generous for any legitimate search.
 */
export const MAX_PATTERN_LENGTH = 1024

/**
 * The `users` table the driver-conformance battery opens — keyed by the default
 * `id` primary column.
 *
 * @remarks
 * `age` is optional and `meta` is a declared `json` column, so the battery's
 * nested-round-trip phase is fair to a typed-column backend: a SQL driver
 * persists only declared columns, while a schemaless backend ignores the
 * declarations entirely.
 */
export const CONFORMANCE_USERS_SCHEMA: TableSchema = Object.freeze({
	name: 'users',
	primary: 'id',
	columns: Object.freeze<readonly ColumnSchema[]>([
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: true, nullable: false },
		{ name: 'meta', storage: 'json', optional: true, nullable: false },
	]),
	indexes: Object.freeze([]),
})

/**
 * The `posts` table the driver-conformance battery opens — keyed by a non-`id`
 * `slug` primary column.
 *
 * @remarks
 * Pairs with {@link CONFORMANCE_USERS_SCHEMA} so one battery exercises both
 * primary-key shapes: the default `id` and an explicit override.
 */
export const CONFORMANCE_POSTS_SCHEMA: TableSchema = Object.freeze({
	name: 'posts',
	primary: 'slug',
	columns: Object.freeze<readonly ColumnSchema[]>([
		{ name: 'slug', storage: 'text', optional: false, nullable: false },
		{ name: 'title', storage: 'text', optional: false, nullable: false },
	]),
	indexes: Object.freeze([]),
})

/**
 * The fixed two-table schema every driver-conformance phase opens.
 *
 * @remarks
 * Each phase mints a fresh driver and opens this exact schema, so a finding
 * names a violated invariant rather than a setup difference between phases.
 */
export const CONFORMANCE_SCHEMA: readonly TableSchema[] = Object.freeze([
	CONFORMANCE_USERS_SCHEMA,
	CONFORMANCE_POSTS_SCHEMA,
])
