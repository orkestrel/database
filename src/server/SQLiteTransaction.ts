import type { TableSchema } from '@src/core'

/**
 * Owns the candidate schema and table identities of one SQLite transaction.
 *
 * @example
 * ```ts
 * const transaction = new SQLiteTransaction(new Map(), new Map())
 * transaction.schema.size // 0
 * ```
 */
export class SQLiteTransaction {
	#schema: ReadonlyMap<string, TableSchema>
	#identities: ReadonlyMap<string, object>

	constructor(schema: ReadonlyMap<string, TableSchema>, identities: ReadonlyMap<string, object>) {
		this.#schema = new Map(schema)
		this.#identities = new Map(identities)
	}

	get schema(): ReadonlyMap<string, TableSchema> {
		return this.#schema
	}

	get identities(): ReadonlyMap<string, object> {
		return this.#identities
	}

	project(schema: readonly TableSchema[], identities: ReadonlyMap<string, object>): void {
		this.#schema = new Map(schema.map((table) => [table.name, table]))
		this.#identities = identities
	}
}
