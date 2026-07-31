// Database constants — frozen plain data (AGENTS §5).

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
 * A ReDoS bound (AGENTS §6.5): the SA1–SA4 migration lets a model supply `list`
 * input over the wire, so `matchesLikePattern` / `matchesGlobPattern` run attacker-controlled
 * patterns. The matcher is the LINEAR greedy two-pointer wildcard match — never a
 * backtracking regex (`.*`-segments-separated-by-literals against a long input is the
 * catastrophic shape JS cannot bound without atomic groups), so it is O(value ×
 * pattern). Capping the pattern length bounds that pattern factor, leaving a match
 * linear in the value length whatever the pattern. A longer pattern throws a
 * `VALIDATION` {@link DatabaseError}; the cap is generous for any legitimate search.
 */
export const MAX_PATTERN_LENGTH = 1024
