import type { DatabaseInterface, DatabaseOptions, DriverInterface, TableMap } from './types.js'
import { Database } from './Database.js'
import { MemoryDriver } from './drivers/MemoryDriver.js'

/**
 * Creates a database over a driver and a declared `tables` schema.
 *
 * @remarks
 * `tables` maps each name to its columns (a `column → shape` map); the database
 * wraps each in an `objectShape`, so you never write `objectShape` at the table
 * level. The `const` type parameter captures the literal names and columns, so
 * `db.table('users')` is checked against the schema and typed by `Infer` of its
 * columns — no annotations. Name a non-`id` primary-key column per table via the
 * optional `primary` and `indexes` maps.
 *
 * @param options - The driver, `tables`, and optional `primary`, `indexes`,
 *   `name`, `generator`, `version`, and emitter hooks
 * @returns A typed {@link DatabaseInterface}
 *
 * @example
 * ```ts
 * import { createDatabase, createMemoryDriver } from '@orkestrel/database'
 * import { integerShape, stringShape } from '@orkestrel/contract'
 *
 * const db = createDatabase({
 * 	driver: createMemoryDriver(),
 * 	tables: {
 * 		users: { id: stringShape(), age: integerShape() },
 * 		posts: { slug: stringShape(), title: stringShape() },
 * 	},
 * 	primary: { posts: 'slug' },
 * })
 * await db.table('users').set({ id: 'u1', age: 36 }) // typed; coerced + validated
 * ```
 */
export function createDatabase<const T extends TableMap>(
	options: DatabaseOptions<T>,
): DatabaseInterface<T> {
	return new Database(options)
}

/**
 * Creates the in-memory reference {@link DriverInterface}.
 *
 * @remarks
 * Backed by nested maps with no I/O — the same driver runs in a browser or on a
 * server, making it the natural choice for tests and ephemeral storage.
 *
 * @returns A fresh in-memory driver
 */
export function createMemoryDriver(): DriverInterface {
	return new MemoryDriver()
}
