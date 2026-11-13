// The server surface's shared constants — the reserved names its drivers claim.

/**
 * Names the reserved metadata table the {@link SQLiteDriver} creates on `open` to
 * persist its stamped `DriverMetadata` (`version` + declared schema JSON) — the
 * SQLite realization of the `metadata` / `stamp` driver hooks.
 *
 * @remarks
 * A single-row table (`id = 1`). A user table named `_metadata` collides with the
 * reservation — the caller's concern to avoid, documented on the driver class.
 */
export const METADATA_TABLE = '_metadata'

/**
 * Lists the PRAGMA names the {@link SQLiteDriver} refuses in its `pragmas` option, compared
 * without regard to case.
 *
 * @remarks
 * `case_sensitive_like` changes what SQLite's `LIKE` answers, so a native `like` would
 * disagree with the core engine's ASCII fold that the plan relies on.
 */
export const REFUSED_PRAGMAS: readonly string[] = Object.freeze(['case_sensitive_like'])
