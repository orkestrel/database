// The server surface's type domain — the SQLite value/row shapes and the
// compiled-SQL contract shared between the pure `compilers.ts` (a `Criteria` →
// SQL compiler, next wave) and the future SQLite `DriverInterface`. SQL is a
// node-backend concept, so it lives here rather than in `core` — `core` stays
// pure and never speaks SQL (AGENTS §1, §5). Types are the source of truth.

/**
 * The value domain a SQLite binding accepts as a bound parameter and returns
 * from a row.
 *
 * @remarks
 * Mirrors SQLite's storage classes (`NULL`, `INTEGER`, `REAL`, `TEXT`, `BLOB`)
 * at the TypeScript boundary: `null`, `number` / `bigint` for integer and
 * floating-point values, `string` for text, and `Uint8Array` for blobs. This
 * type is pure — it names the shape a value must have to cross the binding,
 * independent of any concrete sqlite package (`node:sqlite`, `better-sqlite3`,
 * etc.), so a driver can encode/decode against it without importing one.
 */
export type SQLiteValue = null | number | bigint | string | Uint8Array

/**
 * One row as a SQLite binding returns it — a plain object keyed by column name.
 *
 * @remarks
 * Every column value is a {@link SQLiteValue}. The SQLite driver decodes each
 * raw row into this shape before handing it to the core query engine; nothing
 * above the driver ever sees SQLite's native row representation directly.
 */
export type SQLiteRow = Record<string, SQLiteValue>

/**
 * A parameterized SQL fragment or statement plus its bind values.
 *
 * @remarks
 * Produced by the pure SQL compilers (`compilers.ts`) that turn a core
 * `Criteria` (or a table definition) into SQL text with `?` placeholders, and
 * consumed by the SQLite driver, which runs `sql` with `params` bound in
 * order — no further assembly. Keeping `sql` and `params` together prevents
 * the two from drifting apart across compile and execute.
 */
export interface CompiledSQL {
	readonly sql: string
	readonly params: readonly SQLiteValue[]
}
