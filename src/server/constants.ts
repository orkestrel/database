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
 * Lists the PRAGMA names the {@link SQLiteDriver} admits in its `pragmas` option, each matched
 * exactly; it refuses every other name, because one can change a read result the planner
 * assumes.
 *
 * @remarks
 * Each admitted name changes cost, durability, or write checks, and no row a read returns:
 *
 * - `journal_mode`: how the engine journals a write; a read sees the same rows.
 * - `synchronous`: when the engine syncs the file to disk.
 * - `foreign_keys`: whether a write checks its references.
 * - `busy_timeout`: how long a statement waits on a lock.
 * - `cache_size`: how many pages the engine caches.
 * - `temp_store`: where temporary tables and indexes live.
 * - `mmap_size`: how much of the file the engine maps into memory.
 * - `wal_autocheckpoint`: how often the write-ahead log checkpoints.
 *
 * Refused names include `case_sensitive_like`, which changes what `LIKE` answers,
 * `encoding`, which changes text order, and `full_column_names` / `short_column_names`,
 * which change the names a row decodes by.
 */
export const PRAGMA_NAMES: readonly string[] = Object.freeze([
	'journal_mode',
	'synchronous',
	'foreign_keys',
	'busy_timeout',
	'cache_size',
	'temp_store',
	'mmap_size',
	'wal_autocheckpoint',
])
