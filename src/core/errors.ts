import type { DatabaseErrorCode } from './types.js'

// Invalid operations and programmer errors `throw`, always a
// `DatabaseError` carrying a machine-readable `code` so a `catch` branches on
// `error.code` instead of parsing the message. Lookups that may simply miss
// (`get`, `has`, `remove`) return `undefined` / `false` — they never throw.

/**
 * Represents an error thrown by the database layer.
 *
 * @remarks
 * Carries a {@link DatabaseErrorCode} and an optional `context` bag naming the
 * offending table / key. Thrown for: operating on a closed database (`CLOSED`), a
 * `resolve` miss (`NOT_FOUND`), an `add` onto an existing key (`CONFLICT`), a
 * row that fails its table's contract (`VALIDATION`), an aborted operation whose
 * {@link OperationOptions.signal} aborted (`ABORTED`, carrying `signal.reason` in
 * `context`), an inapplicable {@link Migration} plan (`MIGRATION`), a
 * driver that violates a {@link DriverInterface} invariant, thrown by the
 * `conformDriver` helper (`CONFORMANCE`), and an unexpected infrastructure
 * fault surfaced by a driver seam — e.g. a filesystem failure while
 * persisting (`DRIVER`) — as opposed to expected domain conditions, which
 * keep their specific codes.
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
		if (context !== undefined) this.context = context
	}
}

/**
 * Narrows an unknown caught value to a {@link DatabaseError}.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns True if `value` is a {@link DatabaseError}; false otherwise
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
