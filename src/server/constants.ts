import type { ColumnStorage } from '@src/core'

// The server surface's shared constants — reserved names its drivers claim and
// the declared column groups that SQLite can query without engine refinement.

/**
 * The declared {@link ColumnStorage}s whose SQL EQUALITY comparisons (`equals` /
 * `not` / `any` / `none`) and `starts` / `ends` compiles are provably
 * engine-exact under declared-type trust — `text` / `integer` / `real` /
 * `boolean`; a `json` or `blob` column always refines instead.
 *
 * @remarks
 * This set governs equality and prefix/suffix matching only. RANGE
 * comparisons (`above` / `below` / `from` / `to` / `between`) and `ORDER BY`
 * are exact for `integer` / `real` / `boolean` but NOT for `text`: compiled
 * SQL orders/ranges under SQLite's default BINARY collation, which compares
 * TEXT byte-for-byte as UTF-8 — equivalent to Unicode CODE-POINT order —
 * while the core engine's `compareValues` orders JS strings with `<`, which
 * compares UTF-16 CODE-UNIT order. The two orders diverge for supplementary-
 * plane characters (code points ≥ U+10000, e.g. many emoji): a lead surrogate
 * (`\uD800`–`\uDBFF`) sorts BELOW ``–`￿` in code-unit order, while
 * its code point sorts ABOVE them. So `matchesConditionExactly`'s range family and
 * `matchesOrderExactly` exclude `text`, refining through the core engine instead.
 */
export const EXACT_COLUMN_STORAGE: readonly ColumnStorage[] = Object.freeze([
	'text',
	'integer',
	'real',
	'boolean',
])

/**
 * The declared {@link ColumnStorage}s whose SQL RANGE comparisons
 * (`above` / `below` / `from` / `to` / `between`) and `ORDER BY` compiles are
 * provably engine-exact — `integer` / `real` / `boolean` only. `text` is
 * excluded: see {@link EXACT_COLUMN_STORAGE}'s remarks for the BINARY-collation
 * (code-point) vs. JS `<` (code-unit) divergence on supplementary-plane
 * characters.
 */
export const EXACT_RANGE_COLUMN_STORAGE: readonly ColumnStorage[] = Object.freeze([
	'integer',
	'real',
	'boolean',
])

/**
 * The reserved metadata table the {@link SQLiteDriver} creates on `open` to
 * persist its stamped `DriverMetadata` (`version` + declared schema JSON) — the
 * SQLite realization of the `metadata` / `stamp` driver hooks.
 *
 * @remarks
 * A single-row table (`id = 1`). A user table named `_metadata` collides with the
 * reservation — the caller's concern to avoid, documented on the driver class.
 */
export const METADATA_TABLE = '_metadata'
