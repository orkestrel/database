import type { MemoryDriver, TableSchema } from '@src/core'
import { DatabaseError } from '@src/core'

/**
 * Owns the isolated memory store and schema of one JSON transaction.
 *
 * @example
 * ```ts
 * const transaction = new JSONTransaction(new MemoryDriver(), [], new Map())
 * transaction.stop()
 * // transaction.memory throws CONFLICT after settlement.
 * ```
 */
export class JSONTransaction {
	#memory: MemoryDriver | undefined
	#schema: readonly TableSchema[]
	#identities: ReadonlyMap<string, object>

	constructor(
		memory: MemoryDriver,
		schema: readonly TableSchema[],
		identities: ReadonlyMap<string, object>,
	) {
		this.#memory = memory
		this.#schema = schema
		this.#identities = new Map(identities)
	}

	get memory(): MemoryDriver {
		if (this.#memory === undefined)
			throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		return this.#memory
	}

	get schema(): readonly TableSchema[] {
		return this.#schema
	}

	get identities(): ReadonlyMap<string, object> {
		return this.#identities
	}

	project(schema: readonly TableSchema[], identities: ReadonlyMap<string, object>): void {
		this.#schema = schema
		this.#identities = identities
	}

	stop(): void {
		this.#memory = undefined
	}
}
