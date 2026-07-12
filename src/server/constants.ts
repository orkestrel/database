// The server surface's shared constants — reserved names its drivers claim.

/**
 * The reserved metadata table the {@link SQLiteDriver} creates on `open` to
 * persist its stamped `DriverMeta` (`version` + declared schema JSON) — the
 * SQLite realization of the `meta` / `stamp` driver hooks.
 *
 * @remarks
 * A single-row table (`id = 1`). A user table named `_meta` collides with the
 * reservation — the caller's concern to avoid, documented on the driver class.
 */
export const META_TABLE = '_meta'
