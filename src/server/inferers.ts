import type { ColumnStorage } from '@src/core'
import { isBigInt, isBoolean, isInteger, isNumber, isObject } from '@orkestrel/contract'

// The server surface's value inferers: the storage type a runtime value must
// encode as when no declared column governs it.

/**
 * Reads the storage type a nested (`json_extract`) operand encodes as from its
 * runtime value, never as `json`.
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
	if (isBoolean(value)) return 'boolean'
	if (isNumber(value)) return isInteger(value) ? 'integer' : 'real'
	if (isBigInt(value)) return 'integer'
	if (isObject(value)) return 'json'
	return 'text'
}

/**
 * Reads the SQLite storage class of the sentinel a column that is both optional and nullable
 * stores for explicit `null`.
 *
 * @remarks
 * A `text` or `json` column stores an empty blob, which no text value equals; every other
 * storage stores the text `null`, which no value of its class equals. An absent storage returns
 * `'text'`.
 *
 * @param storage - The column's declared storage, or `undefined` for an undeclared column
 * @returns `'blob'` or `'text'`
 *
 * @example
 * ```ts
 * inferSentinelType('text') // 'blob'
 * inferSentinelType('integer') // 'text'
 * ```
 */
export function inferSentinelType(storage: ColumnStorage | undefined): 'blob' | 'text' {
	return storage === 'text' || storage === 'json' ? 'blob' : 'text'
}
