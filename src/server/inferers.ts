import type { ColumnStorage } from '@src/core'

// The server surface's value inferers: the storage type a runtime value must
// encode as when no declared column governs it.

/**
 * Reads the storage type a nested (`json_extract`) operand encodes as from its
 * RUNTIME value — NOT `json`.
 *
 * @remarks
 * `json_extract` returns the unquoted, natively-typed scalar (a JSON boolean as
 * `1` / `0`, a number as-is, a string as-is), so the operand must encode to that
 * same scalar to compare. A boolean → `'boolean'` (→ `1` / `0`); a number →
 * `'integer'` / `'real'`; a bigint → `'integer'`; a string → `'text'`; `null` /
 * `undefined` → `'text'` (encodes to `null`); an object / array → `'json'` (the
 * edge of comparing against a json subtree).
 *
 * @param value - The runtime operand value
 * @returns The {@link ColumnStorage} to encode it as
 *
 * @example
 * ```ts
 * inferValueStorage(true) // 'boolean'
 * inferValueStorage(9) // 'integer'
 * ```
 */
export function inferValueStorage(value: unknown): ColumnStorage {
	if (typeof value === 'boolean') return 'boolean'
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real'
	if (typeof value === 'bigint') return 'integer'
	if (typeof value === 'object' && value !== null) return 'json'
	return 'text'
}
