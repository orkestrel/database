import type { ColumnSchema, ReadInput, Row, TableSchema } from './types.js'

// Database constants — frozen plain data.

/**
 * Supplies the primary-key column, `'id'`, assumed when {@link PrimaryMap} does not name one.
 *
 * @remarks
 * `id` is the convention IndexedDB (`keyPath: 'id'`) and SQL (`id` / rowid) both
 * lean on, so a table without a `primary` override keys its rows by `id`.
 */
export const DEFAULT_PRIMARY = 'id'

/**
 * Sets the longest `LIKE` / `GLOB` pattern the wildcard matcher accepts, 1024 characters, before
 * rejecting it.
 *
 * @remarks
 * A `LIKE` / `GLOB` pattern is a caller-supplied operand, so
 * `matchesLikePattern` / `matchesGlobPattern` run patterns this package cannot
 * trust. The matcher is the linear greedy two-pointer wildcard match — never a
 * backtracking regex (`.*`-segments-separated-by-literals against a long input is the
 * catastrophic shape JS cannot bound without atomic groups), so it is O(value ×
 * pattern). Capping the pattern length bounds that pattern factor, leaving a match
 * linear in the value length whatever the pattern. A longer pattern throws a
 * `VALIDATION` {@link DatabaseError}; the cap is generous for any legitimate search.
 */
export const MAX_PATTERN_LENGTH = 1024

/**
 * Describes the `users` table the driver-conformance battery opens — keyed by the default
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
 * Describes the `posts` table the driver-conformance battery opens — keyed by a non-`id`
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
 * Holds the fixed `users` and `posts` schema every driver-conformance phase opens.
 *
 * @remarks
 * Each phase mints a fresh driver and opens this exact schema, so a finding
 * names a violated invariant rather than a setup difference between phases. The
 * array and each schema in it are frozen, so a consumer holding it cannot change
 * what a later phase opens.
 */
export const CONFORMANCE_SCHEMA: readonly TableSchema[] = Object.freeze([
	CONFORMANCE_USERS_SCHEMA,
	CONFORMANCE_POSTS_SCHEMA,
])

/**
 * Holds the `users` rows the conformance differential seeds: ties, an absent `age`, ASCII and
 * non-ASCII case variants, a supplementary-plane character, an empty name, and a `[`.
 *
 * @remarks
 * No pair of names sets a supplementary-plane character against U+E000 to U+FFFF, the one
 * case where the engine's binary text order and the core's code-unit order differ, so that
 * case is the differential's one exemption.
 */
export const CONFORMANCE_ROWS: readonly Row[] = Object.freeze([
	Object.freeze({ id: 'a', name: 'Ada', age: 36 }),
	Object.freeze({ id: 'b', name: 'ada', age: 36 }),
	Object.freeze({ id: 'c', name: 'Émile', age: 17 }),
	Object.freeze({ id: 'd', name: 'émile' }),
	Object.freeze({ id: 'e', name: 'Zoë', age: 0 }),
	Object.freeze({ id: 'f', name: 'x😀y', age: -5 }),
	Object.freeze({ id: 'g', name: '', age: 65 }),
	Object.freeze({ id: 'h', name: 'Ada Lovelace', age: 36, meta: Object.freeze({ tag: 'a' }) }),
	Object.freeze({ id: 'i', name: 'a[b]c', age: 18 }),
])

/**
 * Holds the reads the conformance differential runs over {@link CONFORMANCE_ROWS}: every
 * operator on a required text column and an optional integer column, `null` operands, `or`
 * folds, a nested path, orders with ties, a page, and every aggregate.
 */
export const CONFORMANCE_READS: readonly ReadInput[] = Object.freeze([
	{ conditions: [{ column: 'name', operator: 'equals', values: ['Ada'], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'equals', values: [36], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'equals', values: [null], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'not', values: ['Ada'], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'not', values: [36], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'not', values: [null], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'above', values: [17], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'below', values: [18], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'from', values: [17], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'to', values: [0], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'between', values: [0, 36], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'above', values: ['Zo'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'below', values: ['a'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'between', values: ['A', 'b'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'like', values: ['ada%'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'like', values: ['x_y'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'like', values: ['%MILE'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'glob', values: ['a[b]*'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'glob', values: ['A*'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'glob', values: ['x?y'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'starts', values: ['Ada'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'starts', values: [''], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'ends', values: ['ile'], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'any', values: ['Ada', 'Zoë'], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'any', values: [36, 0], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'any', values: [], connector: 'and' }] },
	{ conditions: [{ column: 'id', operator: 'any', values: ['a', 'c', 'h'], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'none', values: [36], connector: 'and' }] },
	{ conditions: [{ column: 'name', operator: 'none', values: ['Ada'], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'none', values: [], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'absent', values: [], connector: 'and' }] },
	{ conditions: [{ column: 'age', operator: 'present', values: [], connector: 'and' }] },
	{
		conditions: [{ column: ['meta', 'tag'], operator: 'equals', values: ['a'], connector: 'and' }],
	},
	{
		conditions: [
			{ column: 'id', operator: 'any', values: ['a', 'b', 'c', 'h'], connector: 'and' },
			{ column: 'age', operator: 'equals', values: [36], connector: 'and' },
		],
	},
	{
		conditions: [
			{ column: 'name', operator: 'equals', values: ['Ada'], connector: 'and' },
			{ column: 'age', operator: 'equals', values: [17], connector: 'or' },
		],
	},
	{
		conditions: [
			{ column: 'name', operator: 'like', values: ['x_y'], connector: 'and' },
			{ column: ['meta', 'tag'], operator: 'equals', values: ['a'], connector: 'or' },
		],
	},
	{ order: [{ column: 'name', direction: 'ascending' }] },
	{ order: [{ column: 'name', direction: 'descending' }] },
	{ order: [{ column: 'age', direction: 'ascending' }] },
	{ order: [{ column: 'age', direction: 'descending' }], limit: 3, offset: 1 },
	{
		order: [
			{ column: 'age', direction: 'ascending' },
			{ column: 'name', direction: 'descending' },
		],
	},
	{ order: [{ column: ['meta', 'tag'], direction: 'descending' }] },
	{
		conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
		order: [{ column: 'age', direction: 'ascending' }],
		limit: 2,
		offset: 1,
	},
	{ limit: 4, offset: 2 },
	{
		conditions: [{ column: 'age', operator: 'above', values: [0], connector: 'and' }],
		aggregate: { operation: 'count', column: 'id' },
	},
	{ aggregate: { operation: 'sum', column: 'age' } },
	{ aggregate: { operation: 'average', column: 'age' } },
	{
		conditions: [{ column: 'name', operator: 'like', values: ['a%'], connector: 'and' }],
		aggregate: { operation: 'minimum', column: 'age' },
	},
	{ aggregate: { operation: 'maximum', column: 'age' } },
	{
		conditions: [{ column: ['meta', 'tag'], operator: 'equals', values: ['a'], connector: 'and' }],
		aggregate: { operation: 'sum', column: 'age' },
	},
])
