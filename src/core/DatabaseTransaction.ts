import type { ContractInterface } from '@orkestrel/contract'
import type { EmitterErrorHandler } from '@orkestrel/emitter'
import type {
	ColumnSchema,
	DatabaseStorageInterface,
	KeyFunction,
	RowOf,
	TableInterface,
	PrimaryMap,
	TableMap,
	StorageInterface,
} from './types.js'
import type { TransactionScope } from './TransactionScope.js'
import { resolvePrimary } from './helpers.js'
import { Table } from './Table.js'

/**
 * Binds a table-only database view to one driver transaction scope.
 *
 * @typeParam T - The declared table shape map
 *
 * @remarks
 * The view gives transaction work the same typed tables as its owning database
 * while enforcing a materially narrower contract and lifetime. `table` and
 * every table operation call the owning scope check, so a captured capability
 * cannot escape its transaction.
 */
export class DatabaseTransaction<
	T extends TableMap = TableMap,
> implements DatabaseStorageInterface<T> {
	readonly #driver: StorageInterface
	readonly #contract: <K extends keyof T & string>(name: K) => ContractInterface<RowOf<T[K]>>
	readonly #columns: (name: string) => ReadonlyMap<string, ColumnSchema>
	readonly #primary: PrimaryMap
	readonly #generate: KeyFunction | undefined
	readonly #error: EmitterErrorHandler | undefined
	readonly #scope: TransactionScope

	constructor(
		driver: StorageInterface,
		contract: <K extends keyof T & string>(name: K) => ContractInterface<RowOf<T[K]>>,
		columns: (name: string) => ReadonlyMap<string, ColumnSchema>,
		primary: PrimaryMap,
		generate: KeyFunction | undefined,
		error: EmitterErrorHandler | undefined,
		scope: TransactionScope,
	) {
		this.#driver = driver
		this.#contract = contract
		this.#columns = columns
		this.#primary = primary
		this.#generate = generate
		this.#error = error
		this.#scope = scope
	}

	table<K extends keyof T & string>(name: K): TableInterface<RowOf<T[K]>> {
		this.#scope.check()
		return this.#build(name, resolvePrimary(this.#primary, name), this.#contract(name))
	}

	#build<R>(name: string, key: string, contract: ContractInterface<R>): TableInterface<R> {
		return new Table(
			() => Promise.resolve(),
			this.#driver,
			name,
			key,
			contract,
			this.#columns(name),
			this.#generate,
			this.#error,
			undefined,
			this.#scope,
		)
	}
}
