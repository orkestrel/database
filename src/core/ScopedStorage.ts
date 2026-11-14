import type { FieldPath } from '@orkestrel/contract'
import type {
	AggregateOperation,
	DriverMetadata,
	Key,
	MigrationInput,
	OperationOptions,
	QueryInput,
	ReadInput,
	ReadPlan,
	Row,
	StorageInterface,
} from './types.js'
import { isArray } from '@orkestrel/contract'
import { applyKeys, buildBatch } from './helpers.js'
import { DriverIterator } from './DriverIterator.js'

/**
 * Forms the lifetime boundary of a driver's scoped storage: each member runs the guard, then
 * forwards to the storage it wraps.
 *
 * @remarks
 * A driver implementing `transaction` hands its scope a capability that refuses work after the
 * scope settles. This class carries that refusal for every member, the keyed ones with their
 * single and list overloads included, so the driver passes only its own storage and its scope
 * check. An optional member is present only when the wrapped storage declares it. Every member
 * runs the guard first, ahead of any check of its own input, because a settled capability is
 * invalid for every call: a malformed page sent after settlement refuses with the guard's error.
 * `stream` checks the guard at the call and around each advance, and `scan` around each advance,
 * through a {@link DriverIterator}. The guard's throw becomes the member's rejection, and a
 * synchronous throw from `plan` and `stream`.
 *
 * @example
 * ```ts
 * import { createMemoryDriver, DatabaseError, ScopedStorage } from '@orkestrel/database'
 *
 * const driver = createMemoryDriver()
 * await driver.open([{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }], indexes: [] }])
 * const settled = new AbortController()
 * const scoped = new ScopedStorage(driver, () => {
 * 	if (settled.signal.aborted) throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
 * })
 * await scoped.write('users', ['u1', 'u2'], [{ id: 'u1' }, { id: 'u2' }])
 * settled.abort()
 * await scoped.read('users', 'u1') // rejects CONFLICT
 * ```
 */
export class ScopedStorage implements StorageInterface {
	readonly #source: StorageInterface
	readonly #guard: () => void
	readonly plan?: (table: string, input: ReadInput) => ReadPlan
	readonly records?: (table: string, input: QueryInput) => Promise<readonly Row[]>
	readonly stream?: (table: string, input: QueryInput) => AsyncIterable<Row>
	readonly aggregate?: (
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	) => Promise<number | undefined>
	readonly migrate?: (input: MigrationInput) => Promise<void>
	readonly metadata?: () => Promise<DriverMetadata | undefined>
	readonly stamp?: (metadata: DriverMetadata) => Promise<void>

	/**
	 * Wraps one storage in the scope's lifetime boundary.
	 *
	 * @param source - The storage the scope reaches
	 * @param guard - The scope check, run ahead of every member; it throws after the scope settles
	 */
	constructor(source: StorageInterface, guard: () => void) {
		this.#source = source
		this.#guard = guard
		const { plan, records, stream, aggregate, migrate, metadata, stamp } = source
		if (plan !== undefined) this.plan = this.#plan.bind(this, plan.bind(source))
		if (records !== undefined) this.records = this.#records.bind(this, records.bind(source))
		if (stream !== undefined) this.stream = this.#stream.bind(this, stream.bind(source))
		if (aggregate !== undefined) {
			this.aggregate = this.#aggregate.bind(this, aggregate.bind(source))
		}
		if (migrate !== undefined) this.migrate = this.#migrate.bind(this, migrate.bind(source))
		if (metadata !== undefined) this.metadata = this.#metadata.bind(this, metadata.bind(source))
		if (stamp !== undefined) this.stamp = this.#stamp.bind(this, stamp.bind(source))
	}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		this.#guard()
		// The ternary only selects the overload; both arms make the same call.
		return isArray(keys) ? this.#source.read(table, keys) : this.#source.read(table, keys)
	}

	write(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async write(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		this.#guard()
		const entries = buildBatch(keys, rows)
		await this.#source.write(
			table,
			entries.map(([key]) => key),
			entries.map(([, row]) => row),
			options,
		)
	}

	insert(
		table: string,
		keys: readonly Key[],
		rows: readonly Row[],
		options?: OperationOptions,
	): Promise<void>
	insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void>
	async insert(
		table: string,
		keys: Key | readonly Key[],
		rows: Row | readonly Row[],
		options?: OperationOptions,
	): Promise<void> {
		this.#guard()
		const entries = buildBatch(keys, rows)
		await this.#source.insert(
			table,
			entries.map(([key]) => key),
			entries.map(([, row]) => row),
			options,
		)
	}

	delete(table: string, key: Key, options?: OperationOptions): Promise<boolean>
	delete(
		table: string,
		keys: readonly Key[],
		options?: OperationOptions,
	): Promise<readonly boolean[]>
	async delete(
		table: string,
		keys: Key | readonly Key[],
		options?: OperationOptions,
	): Promise<boolean | readonly boolean[]> {
		this.#guard()
		return applyKeys(keys, (listed) => this.#source.delete(table, listed, options))
	}

	async keys(table: string): Promise<readonly Key[]> {
		this.#guard()
		return this.#source.keys(table)
	}

	scan(table: string): AsyncIterable<Row> {
		return new DriverIterator(this.#source.scan(table)[Symbol.asyncIterator](), this.#guard)
	}

	async clear(table: string): Promise<void> {
		this.#guard()
		await this.#source.clear(table)
	}

	#plan(
		plan: (table: string, input: ReadInput) => ReadPlan,
		table: string,
		input: ReadInput,
	): ReadPlan {
		this.#guard()
		return plan(table, input)
	}

	async #records(
		records: (table: string, input: QueryInput) => Promise<readonly Row[]>,
		table: string,
		input: QueryInput,
	): Promise<readonly Row[]> {
		this.#guard()
		return records(table, input)
	}

	#stream(
		stream: (table: string, input: QueryInput) => AsyncIterable<Row>,
		table: string,
		input: QueryInput,
	): AsyncIterable<Row> {
		this.#guard()
		return new DriverIterator(stream(table, input)[Symbol.asyncIterator](), this.#guard)
	}

	async #aggregate(
		aggregate: (
			table: string,
			operation: AggregateOperation,
			column: FieldPath,
			input: QueryInput,
		) => Promise<number | undefined>,
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		this.#guard()
		return aggregate(table, operation, column, input)
	}

	async #migrate(
		migrate: (input: MigrationInput) => Promise<void>,
		input: MigrationInput,
	): Promise<void> {
		this.#guard()
		await migrate(input)
	}

	async #metadata(
		metadata: () => Promise<DriverMetadata | undefined>,
	): Promise<DriverMetadata | undefined> {
		this.#guard()
		return metadata()
	}

	async #stamp(
		stamp: (metadata: DriverMetadata) => Promise<void>,
		metadata: DriverMetadata,
	): Promise<void> {
		this.#guard()
		await stamp(metadata)
	}
}
