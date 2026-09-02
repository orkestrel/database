import type { Result } from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterInterface } from '@orkestrel/emitter'
import type {
	AdmissionInterface,
	DatabaseEventMap,
	DatabaseOptions,
	DatabaseStatus,
	DriverInterface,
	DriverMetadata,
	Migration,
	MigrationInput,
	OperationOptions,
	StorageInterface,
	TableSchema,
} from './types.js'
import { Emitter } from '@orkestrel/emitter'
import { DatabaseError } from './errors.js'
import { checkAbort, equalsValue, normalizeDriverSchema, planMigration } from './helpers.js'
import { TransactionScope } from './TransactionScope.js'

/**
 * Owns the internal shared state behind every typed view of one database.
 *
 * @remarks
 * A context owns the driver, merged physical schema, lifecycle, observation,
 * migration, and single transaction admission. It is deliberately omitted from
 * the public barrel; {@link Database} is the consumer-facing typed view.
 */
export class DatabaseContext implements AdmissionInterface {
	readonly #driver: DriverInterface
	readonly #name: string
	readonly #version: number | undefined
	readonly #error: EmitterErrorHandler | undefined
	readonly #emitter: Emitter<DatabaseEventMap>
	readonly #operations = new Set<Promise<unknown>>()
	#schema: readonly TableSchema[] = []
	#transaction: object | undefined
	#status: DatabaseStatus = 'idle'
	#ready: Promise<void> | undefined
	#failure: { readonly error: unknown } | undefined

	constructor(options: DatabaseOptions) {
		this.#driver = options.driver
		this.#name = options.name ?? 'database'
		this.#version = options.version
		this.#error = options.error
		this.#emitter = new Emitter<DatabaseEventMap>({
			...(options.on === undefined ? {} : { on: options.on }),
			...(options.error === undefined ? {} : { error: options.error }),
		})
	}

	get driver(): DriverInterface {
		return this.#driver
	}

	get emitter(): EmitterInterface<DatabaseEventMap> {
		return this.#emitter
	}

	get error(): EmitterErrorHandler | undefined {
		return this.#error
	}

	get name(): string {
		return this.#name
	}

	get accepting(): boolean {
		return this.#status !== 'closed' && this.#transaction === undefined
	}

	get status(): DatabaseStatus {
		return this.#status
	}

	get version(): number | undefined {
		return this.#version
	}

	register(schema: readonly TableSchema[]): void {
		if (this.#status === 'closed') {
			throw new DatabaseError('CLOSED', `Database '${this.#name}' is closed`, {
				name: this.#name,
			})
		}
		if (this.#ready !== undefined || this.#transaction !== undefined) {
			throw new DatabaseError(
				'CONFLICT',
				`Database '${this.#name}' cannot import tables after opening has started`,
				{ name: this.#name, status: this.#status },
			)
		}
		const registered = normalizeDriverSchema(schema)
		const merged = [...this.#schema]
		for (const table of registered) {
			const existing = merged.find((candidate) => candidate.name === table.name)
			if (existing === undefined) {
				merged.push(table)
				continue
			}
			if (!equalsValue(existing, table)) {
				throw new DatabaseError(
					'VALIDATION',
					`Table '${table.name}' conflicts with its registered schema`,
					{ table: table.name },
				)
			}
		}
		this.#schema = normalizeDriverSchema(merged)
	}

	async open(): Promise<void> {
		this.#outside()
		await this.connect()
	}

	async close(): Promise<void> {
		this.#outside()
		if (this.#status === 'closed') return
		this.#status = 'closed'
		await this.#drain()
		const ready = this.#ready
		if (ready !== undefined) await ready.catch(() => {})
		this.#ready = undefined
		await this.#driver.close()
		this.#emitter.emit('close')
	}

	connect(): Promise<void> {
		if (this.#ready !== undefined) return this.#ready
		if (this.#failure !== undefined) throw this.#failure.error
		if (this.#status === 'closed') {
			throw new DatabaseError('CLOSED', `Database '${this.#name}' is closed`, {
				name: this.#name,
			})
		}
		const readiness = this.#driver
			.open(this.#schema)
			.then(async () => {
				if (this.#status === 'idle') {
					this.#status = 'open'
					this.#emitter.emit('open')
				}
				await this.#reconcile()
			})
			.catch((error: unknown) => {
				if (this.#ready === readiness) this.#ready = undefined
				throw error
			})
		this.#ready = readiness
		return readiness
	}

	track<R>(operation: () => Promise<R>): Promise<R> {
		try {
			this.#admit()
		} catch (error) {
			return Promise.reject(error)
		}
		let promise: Promise<R>
		try {
			promise = operation()
		} catch (error) {
			promise = Promise.reject(error)
		}
		this.#operations.add(promise)
		promise.then(
			() => {
				this.#operations.delete(promise)
			},
			() => {
				this.#operations.delete(promise)
			},
		)
		return promise
	}

	async transaction<R>(
		scope: (storage: StorageInterface, lifetime: TransactionScope) => Promise<Result<R, unknown>>,
		options?: OperationOptions,
	): Promise<R> {
		checkAbort(options?.signal)
		this.#admit()
		const token = {}
		this.#transaction = token
		try {
			await this.#drain()
			await this.connect()
			if (this.#driver.transaction !== undefined) {
				const rejection: { rejected: boolean; error: unknown; marker: object } = {
					rejected: false,
					error: undefined,
					marker: {},
				}
				try {
					const value = await this.#driver.transaction(async (storage) => {
						this.#emitter.emit('transaction')
						const outcome = await scope(storage, new TransactionScope())
						if (!outcome.success) {
							rejection.rejected = true
							rejection.error = outcome.error
							throw rejection.marker
						}
						return outcome.value
					})
					this.#emitter.emit('commit')
					return value
				} catch (error) {
					if (rejection.rejected) {
						if (Object.is(error, rejection.marker)) {
							this.#emitter.emit('rollback', rejection.error)
							throw rejection.error
						}
						throw this.#rollbackError(rejection.error, error)
					}
					throw error
				}
			}
			const rollback = await this.#driver.snapshot()
			this.#emitter.emit('transaction')
			const outcome = await scope(this.#driver, new TransactionScope())
			if (outcome.success) {
				this.#emitter.emit('commit')
				return outcome.value
			}
			try {
				await rollback()
			} catch (cause) {
				throw this.#rollbackError(outcome.error, cause)
			}
			this.#emitter.emit('rollback', outcome.error)
			throw outcome.error
		} finally {
			if (this.#transaction === token) this.#transaction = undefined
		}
	}

	async migrate(deployed: readonly TableSchema[], options?: OperationOptions): Promise<Migration> {
		checkAbort(options?.signal)
		this.#outside()
		if (this.#ready !== undefined || this.#status !== 'idle') {
			throw new DatabaseError(
				'CONFLICT',
				`Database '${this.#name}' cannot apply an explicit deployed schema after opening`,
				{ name: this.#name, status: this.#status },
			)
		}
		if (this.#driver.migrate === undefined) {
			throw new DatabaseError(
				'MIGRATION',
				`Database '${this.#name}' driver does not support migration`,
				{ name: this.#name },
			)
		}
		const plan = planMigration(deployed, this.#schema)
		const readiness = this.#transition(deployed, plan).catch((error: unknown) => {
			if (this.#ready === readiness) this.#ready = undefined
			this.#failure = { error }
			throw error
		})
		this.#failure = undefined
		this.#ready = readiness
		await readiness
		return plan
	}

	#admit(): void {
		if (this.#status === 'closed') {
			throw new DatabaseError('CLOSED', `Database '${this.#name}' is closed`, {
				name: this.#name,
			})
		}
		if (this.#transaction !== undefined) {
			throw new DatabaseError('CONFLICT', `Database '${this.#name}' has an active transaction`, {
				name: this.#name,
			})
		}
		if (this.#failure !== undefined) throw this.#failure.error
	}

	#outside(): void {
		if (this.#transaction !== undefined) {
			throw new DatabaseError('CONFLICT', `Database '${this.#name}' has an active transaction`, {
				name: this.#name,
			})
		}
	}

	async #drain(): Promise<void> {
		if (this.#operations.size === 0) return
		await Promise.allSettled(this.#operations)
	}

	async #reconcile(): Promise<void> {
		if (
			this.#version === undefined ||
			this.#driver.metadata === undefined ||
			this.#driver.stamp === undefined
		) {
			return
		}
		const metadata = await this.#driver.metadata()
		if (metadata === undefined) {
			await this.#stamp()
			return
		}
		if (metadata.version > this.#version) {
			throw new DatabaseError(
				'MIGRATION',
				`Database '${this.#name}' store version ${metadata.version} is newer than declared version ${this.#version}`,
				{ name: this.#name, stored: metadata.version, declared: this.#version },
			)
		}
		if (metadata.version === this.#version) {
			if (!equalsValue(normalizeDriverSchema(metadata.schema), this.#schema)) {
				throw new DatabaseError(
					'MIGRATION',
					`Database '${this.#name}' stored schema differs at version ${this.#version}`,
					{ name: this.#name, version: this.#version },
				)
			}
			return
		}
		const plan = planMigration(metadata.schema, this.#schema, metadata.version, this.#version)
		if (plan.steps.length > 0 && this.#driver.migrate === undefined) {
			throw new DatabaseError(
				'MIGRATION',
				`Database '${this.#name}' driver does not support migration`,
				{ name: this.#name, stored: metadata.version, declared: this.#version },
			)
		}
		await this.#apply(plan)
	}

	async #apply(plan: Migration): Promise<void> {
		if (this.#driver.transaction !== undefined) {
			await this.#driver.transaction(async (storage) => {
				if (plan.steps.length > 0 && storage.migrate === undefined) {
					throw new DatabaseError(
						'MIGRATION',
						`Database '${this.#name}' transaction does not support migration`,
						{ name: this.#name },
					)
				}
				if (storage.migrate === undefined) await this.#stamp(storage)
				else await storage.migrate(this.#migration(plan))
			})
			this.#emitter.emit('migrate', plan)
			return
		}
		if (this.#driver.migrate === undefined) await this.#stamp()
		else await this.#driver.migrate(this.#migration(plan))
		this.#emitter.emit('migrate', plan)
	}

	async #transition(deployed: readonly TableSchema[], plan: Migration): Promise<void> {
		await this.#driver.open(deployed)
		await this.#apply(plan)
		if (this.#status === 'idle') {
			this.#status = 'open'
			this.#emitter.emit('open')
		}
	}

	async #stamp(storage?: StorageInterface): Promise<void> {
		const target = storage ?? this.#driver
		if (this.#version === undefined || target.stamp === undefined) return
		const metadata: DriverMetadata = {
			version: this.#version,
			schema: this.#schema,
		}
		await target.stamp(metadata)
	}

	#migration(plan: Migration): MigrationInput {
		if (this.#version === undefined) return { plan }
		return {
			plan,
			metadata: { version: this.#version, schema: this.#schema },
		}
	}

	#rollbackError(transaction: unknown, cause: unknown): DatabaseError {
		return new DatabaseError('DRIVER', `Database '${this.#name}' rollback failed`, {
			cause,
			transaction,
		})
	}
}
