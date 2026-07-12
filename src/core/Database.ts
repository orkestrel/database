import type { ContractInterface } from '@orkestrel/contract'
import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	DatabaseEventMap,
	DatabaseInterface,
	DatabaseOptions,
	DatabaseStatus,
	DriverInterface,
	RowOf,
	TableExport,
	TableIndexes,
	TableInterface,
	TableKeys,
	TableSchema,
	TablesShape,
} from './types.js'
import { compileSchema, createContract, objectShape } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { DEFAULT_PRIMARY } from './constants.js'
import { DatabaseError } from './errors.js'
import { columnType } from './helpers.js'
import { Table } from './Table.js'

/**
 * A database — the ergonomic entry point over a {@link DriverInterface}.
 *
 * @remarks
 * Owns the driver and a `tables` shape map, connecting the driver lazily on first
 * use so a freshly created database is immediately usable. `table(name)` returns
 * a table typed by that table's shape `Infer`. `import` registers more tables and
 * returns a database re-typed with them over the **same** driver and storage;
 * `export` emits a portable {@link TableExport} per table. `transaction` snapshots
 * the driver, runs the scope, and rolls every table back if it throws — an
 * optimistic model that works uniformly across backends rather than reconciling
 * SQL's and IndexedDB's incompatible native transactions.
 *
 * @remarks
 * - **Observable (§13).** The owned {@link emitter} ({@link DatabaseEventMap}) carries the
 *   connection + transaction lifecycle — `open` / `close` / `transaction` / `commit` /
 *   `rollback` — for fire-and-forget observers, ALONGSIDE each table's per-row events. Every
 *   event is emitted directly, strictly AFTER the relevant transition: `commit` only after
 *   the scope succeeds, `rollback` only after every table is restored. The `rollback` emit
 *   OBSERVES the propagated error — it never swallows it (the original throw propagates
 *   exactly as before). The emitter isolates a listener throw and routes it to its `error`
 *   handler (the `error` option), so observation can never reorder, throw into, or corrupt
 *   the snapshot / commit / rollback flow.
 */
export class Database<T extends TablesShape = TablesShape> implements DatabaseInterface<T> {
	readonly #driver: DriverInterface
	readonly #tables: T
	readonly #keys: TableKeys
	readonly #indexes: TableIndexes
	readonly #name: string
	// The PUSH observation surface (§13) — owned, never inherited. The emitter isolates a
	// listener throw (routing it to the `error` handler), so it can never escape into the
	// transaction flow.
	readonly #emitter: Emitter<DatabaseEventMap>
	#status: DatabaseStatus = 'idle'
	#ready: Promise<void> | undefined

	constructor(options: DatabaseOptions<T>) {
		this.#driver = options.driver
		this.#tables = options.tables
		this.#keys = options.keys ?? {}
		this.#indexes = options.indexes ?? {}
		this.#name = options.name ?? 'database'
		this.#emitter = new Emitter<DatabaseEventMap>({ on: options.on, error: options.error })
	}

	get emitter(): EmitterInterface<DatabaseEventMap> {
		return this.#emitter
	}

	get name(): string {
		return this.#name
	}

	get status(): DatabaseStatus {
		return this.#status
	}

	table<K extends keyof T & string>(name: K): TableInterface<RowOf<T[K]>> {
		if (this.#status === 'closed') {
			throw new DatabaseError('CLOSED', `Database '${this.#name}' is closed`, { name: this.#name })
		}
		// A table row is always an object, so wrap its columns in an `objectShape`.
		return this.#build(name, this.#key(name), createContract(objectShape(this.#tables[name])))
	}

	import<U extends TablesShape>(tables: U, keys?: TableKeys): DatabaseInterface<U> {
		return this.#spawn(tables, { ...this.#keys, ...keys })
	}

	export(): Readonly<Record<string, TableExport>> {
		const result: Record<string, TableExport> = {}
		for (const name of Object.keys(this.#tables)) {
			const columns = this.#tables[name]
			// `compileSchema` (not `createContract`) emits the JSON Schema without
			// instantiating `Infer` over the broad shape — which would trip TS's
			// instantiation-depth guard here, where the columns are the open union.
			result[name] = { key: this.#key(name), columns, schema: compileSchema(objectShape(columns)) }
		}
		return result
	}

	async open(): Promise<void> {
		await this.#connect()
	}

	async close(): Promise<void> {
		this.#status = 'closed'
		this.#ready = undefined
		await this.#driver.close()
		// Observe the close — AFTER the driver released, so a swallowed listener throw can't
		// perturb the teardown (a pure signal — no payload).
		this.#emitter.emit('close')
	}

	async transaction<R>(scope: () => Promise<R>): Promise<R> {
		await this.#connect()
		const rollback = await this.#driver.snapshot()
		// Observe the scope beginning — AFTER the store was snapshotted and BEFORE the scope
		// runs, so a swallowed listener throw can't perturb the snapshot the scope builds on.
		this.#emitter.emit('transaction')
		try {
			const value = await scope()
			// Observe the successful commit — AFTER the scope resolved with no throw, so the
			// transaction has already committed (there is nothing to roll back); the emit only
			// OBSERVES it. NEVER emitted on the throw path below.
			this.#emitter.emit('commit')
			return value
		} catch (error) {
			// The scope threw: roll every table back FIRST, then observe — the `rollback` emit
			// fires strictly AFTER the restore completes, and OBSERVES the propagated error (it
			// carries the error but never swallows it; the original throw still propagates,
			// exactly as before — a swallowed listener throw can't suppress or reorder it).
			await rollback()
			this.#emitter.emit('rollback', error)
			throw error
		}
	}

	// Construct a table over an opaque row type `R`, so the deep `Infer<T[K]>` of
	// `table` is never expanded structurally here (it would trip TS's
	// instantiation-depth guard — the reason `createContract` keeps its impl untyped).
	#build<R>(name: string, key: string, contract: ContractInterface<R>): TableInterface<R> {
		return new Table(() => this.#connect(), this.#driver, name, key, contract)
	}

	// Construct a sibling view over an opaque table map `X` (sharing the driver),
	// so the deep `Infer<X[K]>` of the result's `table` is not expanded
	// structurally here — the same instantiation-depth guard `#build` sidesteps.
	#spawn<X extends TablesShape>(tables: X, keys: TableKeys): DatabaseInterface<X> {
		return new Database({ driver: this.#driver, tables, keys, name: this.#name })
	}

	#key(name: string): string {
		return this.#keys[name] ?? DEFAULT_PRIMARY
	}

	// Derive each table's backend-agnostic TableSchema from its contract columns,
	// primary key, and declared indexes — what every driver's `open` receives.
	#schema(): readonly TableSchema[] {
		return Object.keys(this.#tables).map((name) => {
			const columns = this.#tables[name]
			return {
				name,
				primary: this.#key(name),
				columns: Object.keys(columns).map((column) => {
					const shape = columns[column]
					return {
						name: column,
						type: columnType(shape),
						nullable: shape.type === 'optional' || shape.type === 'nullable',
					}
				}),
				indexes: this.#indexes[name] ?? [],
			}
		})
	}

	// Open the driver once, lazily; every table operation awaits the same promise. The
	// `open` event fires from the one-time `.then` (so it observes the actual connect, not
	// each cached re-await) — AFTER the driver opened and the status flipped. A reconnect
	// after `close()` (which clears `#ready`) re-runs this and emits `open` again.
	#connect(): Promise<void> {
		if (this.#status === 'closed') {
			throw new DatabaseError('CLOSED', `Database '${this.#name}' is closed`, { name: this.#name })
		}
		if (this.#ready === undefined) {
			this.#ready = this.#driver.open(this.#schema()).then(() => {
				if (this.#status === 'idle') this.#status = 'open'
				this.#emitter.emit('open')
			})
		}
		return this.#ready
	}
}
