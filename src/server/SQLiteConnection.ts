import type { SQLiteDatabaseInterface, SQLiteStatementInterface } from '@orkestrel/sqlite'
import { STATEMENT_LIMIT } from './constants.js'

/**
 * Owns one open SQLite connection of the SQLite driver and the prepared statements it reuses,
 * keyed by SQL text and bounded by {@link STATEMENT_LIMIT} with least-recently-used eviction.
 *
 * @remarks
 * A cached statement serves `get`, `all`, and `execute`, each of which runs to completion
 * before it returns. Prepare an `iterate` stream through `database` instead: a statement with
 * an open iterator cannot run again until the iterator ends.
 *
 * @example
 * ```ts
 * import { createSQLiteDatabase } from '@orkestrel/sqlite'
 * import { SQLiteConnection } from '@orkestrel/database/server'
 *
 * const database = createSQLiteDatabase({ path: ':memory:' })
 * database.connect()
 * const connection = new SQLiteConnection(database)
 * connection.prepare('SELECT 1 AS one') === connection.prepare('SELECT 1 AS one') // true
 * ```
 */
export class SQLiteConnection {
	readonly #database: SQLiteDatabaseInterface
	readonly #statements = new Map<string, SQLiteStatementInterface>()

	/**
	 * Creates the connection's empty statement cache over an open wrapper connection.
	 *
	 * @param database - The connected wrapper connection the statements are prepared on
	 */
	constructor(database: SQLiteDatabaseInterface) {
		this.#database = database
	}

	/**
	 * Returns the wrapper connection, for work the cache does not serve: a transaction, a pragma,
	 * a statement with no result, and an `iterate` stream.
	 */
	get database(): SQLiteDatabaseInterface {
		return this.#database
	}

	/**
	 * Returns the cached statement for a SQL text, preparing and caching it on a miss.
	 *
	 * @remarks
	 * A hit moves the text to the most recently used place. A miss past
	 * {@link STATEMENT_LIMIT} evicts the least recently used statement.
	 *
	 * @param sql - The statement text
	 * @returns The prepared statement
	 */
	prepare(sql: string): SQLiteStatementInterface {
		const cached = this.#statements.get(sql)
		if (cached !== undefined) {
			this.#statements.delete(sql)
			this.#statements.set(sql, cached)
			return cached
		}
		const statement = this.#database.prepare(sql)
		this.#statements.set(sql, statement)
		if (this.#statements.size > STATEMENT_LIMIT) {
			const [oldest] = this.#statements.keys()
			if (oldest !== undefined) this.#statements.delete(oldest)
		}
		return statement
	}
}
