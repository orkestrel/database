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
