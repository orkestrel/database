import type { DatabaseErrorCode } from './types.js'

// AGENTS §12: invalid operations and programmer errors `throw`, always a
// `DatabaseError` carrying a machine-readable `code` so a `catch` branches on
// `error.code` instead of parsing the message. Lookups that may simply miss
// (`get`, `has`, `remove`) return `undefined` / `false` — they never throw.

/**
 * An error thrown by the database layer.
 *
 * @remarks
 * Carries a {@link DatabaseErrorCode} and an optional `context` bag naming the
 * offending table / key. Thrown for: operating on a closed database (`CLOSED`), a
 * `resolve` miss (`NOT_FOUND`), an `add` onto an existing key (`CONFLICT`), a
 * row that fails its table's contract (`VALIDATION`), a cancelled operation whose
 * {@link ReadOptions.signal} aborted (`ABORTED`, carrying `signal.reason` in
 * `context`), an inapplicable {@link Migration} plan (`MIGRATION`), and a
 * driver that violates a {@link DriverInterface} invariant, thrown by the
 * `conformDriver` helper (`CONFORMANCE`).
 */
export class DatabaseError extends Error {
	readonly code: DatabaseErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	constructor(
		code: DatabaseErrorCode,
		message: string,
		context?: Readonly<Record<string, unknown>>,
	) {
		super(message)
		this.name = 'DatabaseError'
		this.code = code
		this.context = context
	}
}

/**
 * Narrow an unknown caught value to a {@link DatabaseError}.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns `true` when `value` is a {@link DatabaseError}
 *
 * @example
 * ```ts
 * try {
 * 	await users.add(row)
 * } catch (error) {
 * 	if (isDatabaseError(error) && error.code === 'CONFLICT') await users.set(row)
 * }
 * ```
 */
export function isDatabaseError(value: unknown): value is DatabaseError {
	return value instanceof DatabaseError
}
