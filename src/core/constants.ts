// Database constants — frozen plain data (AGENTS §5).

/**
 * The primary-key column assumed when {@link TableKeys} does not name one.
 *
 * @remarks
 * `id` is the convention IndexedDB (`keyPath: 'id'`) and SQL (`id` / rowid) both
 * lean on, so a table that omits `key` keys its rows by `id`.
 */
export const DEFAULT_PRIMARY = 'id'

/**
 * The longest `LIKE` / `GLOB` pattern the wildcard matcher accepts before rejecting it.
 *
 * @remarks
 * A ReDoS bound (AGENTS §6.5): the SA1–SA4 migration lets a model supply `list`
 * criteria over the wire, so `likeMatch` / `globMatch` run attacker-controlled
 * patterns. The matcher is the LINEAR greedy two-pointer wildcard match — never a
 * backtracking regex (`.*`-segments-separated-by-literals against a long input is the
 * catastrophic shape JS cannot bound without atomic groups), so it is O(value ×
 * pattern). Capping the pattern length bounds that pattern factor, leaving a match
 * linear in the value length whatever the pattern. A longer pattern throws a
 * `VALIDATION` {@link DatabaseError}; the cap is generous for any legitimate search.
 */
export const MAX_PATTERN_LENGTH = 1024

/** The number of bytes encoded by an RFC 4122 UUID. */
export const UUID_BYTE_COUNT = 16

/** The number of distinct values one UUID byte may hold. */
export const UUID_BYTE_RANGE = 256
