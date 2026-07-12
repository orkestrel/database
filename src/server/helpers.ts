import { randomUUID } from 'node:crypto'

// The server's key-minting `KeyFunction` implementation — `core` mints no keys
// itself (AGENTS §1: cross-environment code touches no `node:*`), so a server
// consumer wires this in as `DatabaseOptions.key`.

/**
 * Generate a fresh unique key — a v4 UUID string, backed by `node:crypto`.
 *
 * @remarks
 * Supply this as {@link import('@src/core').DatabaseOptions.key} so a table mints
 * a key when a written row lacks its primary-key value. Strings work as keys on
 * every backend; supply your own key values directly to use numeric keys instead.
 *
 * @returns A new UUID string
 *
 * @example
 * ```ts
 * const db = createDatabase({ driver, tables, key: generateKey })
 * ```
 */
export function generateKey(): string {
	return randomUUID()
}
