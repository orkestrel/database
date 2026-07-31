import type { ContractInterface, Result } from '@orkestrel/contract'
import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	ColumnMap,
	DatabaseEventMap,
	DatabaseInterface,
	DatabaseOptions,
	DatabaseStatus,
	DatabaseStorageInterface,
	IndexMap,
	KeyFunction,
	Migration,
	OperationOptions,
	PrimaryMap,
	RowOf,
	TableDefinition,
	TableInterface,
	TableMap,
	TableSchema,
} from './types.js'
import { compileSchema, createContract, objectShape } from '@orkestrel/contract'
import { DEFAULT_PRIMARY } from './constants.js'
import { DatabaseError } from './errors.js'
import { shapeToColumnSchema } from './helpers.js'
import { DatabaseContext } from './DatabaseContext.js'
import { DatabaseTransaction } from './DatabaseTransaction.js'
import { Table } from './Table.js'
import { TransactionScope } from './TransactionScope.js'

/**
 * A typed database view over one shared internal lifecycle and storage context.
 *
 * @remarks
 * Each view owns only its table contracts, primary columns, indexes, and key
 * generator. Imported views register their physical schemas with the same
 * internal context before opening begins, so every view observes one driver,
 * merged schema, emitter, status, transaction boundary, and terminal close.
 */
export class Database<T extends TableMap = TableMap> implements DatabaseInterface<T> {
	#context: DatabaseContext
	readonly #tables: T
	readonly #primary: PrimaryMap
	readonly #indexes: IndexMap
	readonly #generate: KeyFunction | undefined

	constructor(options: DatabaseOptions<T>) {
		this.#tables = options.tables
		this.#primary = options.primary ?? {}
		this.#indexes = options.indexes ?? {}
		this.#generate = options.generator
		this.#context = new DatabaseContext(options)
		this.#context.register(this.#schema())
	}

	get emitter(): EmitterInterface<DatabaseEventMap> {
		return this.#context.emitter
	}

	get name(): string {
		return this.#context.name
	}

	get status(): DatabaseStatus {
		return this.#context.status
	}

	table<K extends keyof T & string>(name: K): TableInterface<RowOf<T[K]>> {
		if (this.#context.status === 'closed') {
			throw new DatabaseError('CLOSED', `Database '${this.#context.name}' is closed`, {
				name: this.#context.name,
			})
		}
		const columns = this.#columns(name)
		return this.#build(name, this.#key(name), createContract(objectShape(columns)))
	}

	import<U extends TableMap>(tables: U, primary?: PrimaryMap): DatabaseInterface<U> {
		return this.#spawn(tables, { ...this.#primary, ...primary })
	}

	export(): Readonly<Record<string, TableDefinition>> {
		const result: Record<string, TableDefinition> = {}
		for (const name of Object.keys(this.#tables)) {
			const columns = this.#columns(name)
			result[name] = {
				primary: this.#key(name),
				columns,
				schema: compileSchema(objectShape(columns)),
			}
		}
		return result
	}

	open(): Promise<void> {
		return this.#context.open()
	}

	close(): Promise<void> {
		return this.#context.close()
	}

	transaction<R>(
		scope: (transaction: DatabaseStorageInterface<T>) => Promise<R>,
		options?: OperationOptions,
	): Promise<R> {
		return this.#context.transaction(async (storage, lifetime) => {
			const transaction = new DatabaseTransaction(
				storage,
				this.#tables,
				this.#primary,
				this.#generate,
				this.#context.error,
				lifetime,
			)
			return this.#settle(scope, transaction, lifetime)
		}, options)
	}

	migrate(deployed: readonly TableSchema[], options?: OperationOptions): Promise<Migration> {
		return this.#context.migrate(deployed, options)
	}

	#build<R>(name: string, key: string, contract: ContractInterface<R>): TableInterface<R> {
		return new Table(
			() => this.#context.connect(),
			this.#context.driver,
			name,
			key,
			contract,
			this.#generate,
			this.#context.error,
			this.#context,
		)
	}

	#spawn<X extends TableMap>(tables: X, primary: PrimaryMap): DatabaseInterface<X> {
		return Database.#attach(
			{
				driver: this.#context.driver,
				tables,
				primary,
				name: this.#context.name,
				...(this.#context.error === undefined ? {} : { error: this.#context.error }),
				...(this.#generate === undefined ? {} : { generator: this.#generate }),
				...(this.#context.version === undefined ? {} : { version: this.#context.version }),
			},
			this.#context,
		)
	}

	#key(name: string): string {
		return this.#primary[name] ?? DEFAULT_PRIMARY
	}

	#columns<K extends keyof T & string>(name: K): T[K]
	#columns(name: string): ColumnMap
	#columns(name: string): ColumnMap {
		const columns = this.#tables[name]
		if (columns === undefined) {
			throw new DatabaseError('NOT_FOUND', `Table '${name}' is not declared`, { table: name })
		}
		return columns
	}

	#schema(): readonly TableSchema[] {
		return Object.keys(this.#tables).map((name) => {
			const columns = this.#columns(name)
			return {
				name,
				primary: this.#key(name),
				columns: Object.entries(columns).map(([column, shape]) =>
					shapeToColumnSchema(column, shape),
				),
				indexes: this.#indexes[name] ?? [],
			}
		})
	}

	async #settle<R>(
		scope: (transaction: DatabaseStorageInterface<T>) => Promise<R>,
		transaction: DatabaseStorageInterface<T>,
		lifetime: TransactionScope,
	): Promise<Result<R, unknown>> {
		const outcome: Result<R, unknown> = await Promise.resolve()
			.then(() => scope(transaction))
			.then(
				(value) => ({ success: true, value }),
				(error: unknown) => ({ success: false, error }),
			)
		lifetime.stop()
		const drained: Result<void, unknown> = await lifetime.drain().then(
			() => ({ success: true, value: undefined }),
			(error: unknown) => ({ success: false, error }),
		)
		if (!outcome.success) return outcome
		if (!drained.success) return drained
		return outcome
	}

	static #attach<X extends TableMap>(
		options: DatabaseOptions<X>,
		context: DatabaseContext,
	): Database<X> {
		const database = new Database(options)
		database.#context = context
		context.register(database.#schema())
		return database
	}
}
