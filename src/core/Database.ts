import type { ContractInterface, Result } from '@orkestrel/contract'
import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	ColumnSchema,
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
	DatabaseTableOptions,
	TableSchema,
} from './types.js'
import type { TransactionScope } from './TransactionScope.js'
import { compileSchema, createContract, objectShape } from '@orkestrel/contract'
import { DatabaseError } from './errors.js'
import { collectColumns, requireColumns, resolvePrimary } from './helpers.js'
import { DatabaseContext } from './DatabaseContext.js'
import { DatabaseTransaction } from './DatabaseTransaction.js'
import { Table } from './Table.js'

/**
 * Exposes a typed view over one shared internal lifecycle and storage context.
 *
 * @remarks
 * Each view owns only its table contracts, primary columns, indexes, and key
 * generator. Imported views register their physical schemas with the same
 * internal context before opening begins, so every view observes one driver,
 * merged schema, emitter, status, transaction boundary, and terminal close.
 *
 * The view owns the driver and its declared `tables`, connects that driver lazily on
 * first use, `import`s further tables and `export`s their portable definitions, and
 * runs `transaction` scopes over the shared context.
 */
export class Database<T extends TableMap = TableMap> implements DatabaseInterface<T> {
	#context: DatabaseContext
	readonly #tables: T
	readonly #primary: PrimaryMap
	readonly #indexes: IndexMap
	readonly #generate: KeyFunction | undefined
	// Each table's compiled contract, built on its first use and shared with every transaction.
	readonly #contracts: { [K in keyof T]?: ContractInterface<RowOf<T[K]>> } = {}
	// Each table's declared columns by name, which its read door checks a query against.
	readonly #columns: ReadonlyMap<string, ReadonlyMap<string, ColumnSchema>>

	constructor(options: DatabaseOptions<T>) {
		this.#tables = options.tables
		this.#primary = options.primary ?? {}
		this.#indexes = options.indexes ?? {}
		this.#generate = options.generator
		this.#columns = new Map(
			Object.keys(options.tables).map((name) => [
				name,
				collectColumns(requireColumns(options.tables, name)),
			]),
		)
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

	table<K extends keyof T & string>(
		name: K,
		options?: DatabaseTableOptions,
	): TableInterface<RowOf<T[K]>> {
		if (this.#context.status === 'closed') {
			throw new DatabaseError('CLOSED', `Database '${this.#context.name}' is closed`, {
				name: this.#context.name,
			})
		}
		return this.#build(name, resolvePrimary(this.#primary, name), this.#contract(name), options)
	}

	import<U extends TableMap>(tables: U, primary?: PrimaryMap): DatabaseInterface<U> {
		return this.#spawn(tables, { ...this.#primary, ...primary })
	}

	export(): Readonly<Record<string, TableDefinition>> {
		const result: Record<string, TableDefinition> = {}
		for (const name of Object.keys(this.#tables)) {
			const columns = requireColumns(this.#tables, name)
			result[name] = {
				primary: resolvePrimary(this.#primary, name),
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
			const transaction = new DatabaseTransaction<T>(
				storage,
				(name) => this.#contract(name),
				(name) => this.#layout(name),
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

	#contract<K extends keyof T & string>(name: K): ContractInterface<RowOf<T[K]>> {
		const cached = this.#contracts[name]
		if (cached !== undefined) return cached
		const contract = createContract(objectShape(requireColumns(this.#tables, name)))
		this.#contracts[name] = contract
		return contract
	}

	// Every declared table has an entry, because the constructor derives one per table.
	#layout(name: string): ReadonlyMap<string, ColumnSchema> {
		return this.#columns.get(name) ?? new Map()
	}

	#build<R>(
		name: string,
		key: string,
		contract: ContractInterface<R>,
		options: DatabaseTableOptions | undefined,
	): TableInterface<R> {
		return new Table(
			() => this.#context.connect(),
			this.#context.driver,
			name,
			key,
			contract,
			this.#layout(name),
			this.#generate,
			options,
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

	#schema(): readonly TableSchema[] {
		return Object.keys(this.#tables).map((name) => ({
			name,
			primary: resolvePrimary(this.#primary, name),
			columns: [...this.#layout(name).values()],
			indexes: this.#indexes[name] ?? [],
		}))
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
