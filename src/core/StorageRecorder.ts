import type { FieldPath } from '@orkestrel/contract'
import type {
	AggregateOperation,
	DriverInterface,
	QueryInput,
	ReadInput,
	ReadPlan,
	Row,
	StorageCall,
	StorageInterface,
	StorageMember,
	StorageResult,
} from './types.js'
import { streamRecordedRows } from './helpers.js'
import { RecordedStorage } from './RecordedStorage.js'
import { StreamPage } from './StreamPage.js'

/**
 * Wraps a driver and records the keys each storage member addresses and the rows it returns or
 * yields, inside a transaction scope too — the rows-read instrument of a native-first reading.
 *
 * @remarks
 * `driver` declares exactly the members its source declares, so a read plans as it would on the
 * source. Each call counts when it is invoked, so a rejected call and a stream never pulled each
 * count one call; `plan` and `aggregate` report no rows, and a stream reports the rows its
 * consumer has pulled when `calls` or `measure` reads it. `measure` returns the calls one
 * operation made. It counts the rows each call returns or yields, which `@orkestrel/test`'s call
 * recorder does not count.
 *
 * @example
 * ```ts
 * import { integerShape, stringShape } from '@orkestrel/contract'
 * import { createDatabase, createMemoryDriver, StorageRecorder, tallyCalls } from '@orkestrel/database'
 *
 * const recorder = new StorageRecorder(createMemoryDriver())
 * const users = createDatabase({
 * 	driver: recorder.driver,
 * 	tables: { users: { id: stringShape(), age: integerShape() } },
 * }).table('users')
 * await users.set([{ id: 'u1', age: 36 }, { id: 'u2', age: 7 }])
 * const { calls } = await recorder.measure(() => users.count())
 * tallyCalls(calls, 'scan') // { calls: 1, keys: 0, rows: 2 }
 * ```
 */
export class StorageRecorder {
	readonly #source: DriverInterface
	readonly #driver: DriverInterface
	readonly #calls: Array<{
		readonly member: StorageMember
		readonly keys: number
		readonly rows: StreamPage
		readonly scoped: boolean
	}> = []

	constructor(source: DriverInterface) {
		this.#source = source
		this.#driver = this.#root(source)
	}

	get driver(): DriverInterface {
		return this.#driver
	}

	get source(): DriverInterface {
		return this.#source
	}

	get calls(): readonly StorageCall[] {
		return this.#read(0)
	}

	/**
	 * Runs one operation and returns its value with the storage calls invoked while it ran.
	 *
	 * @param operation - The operation to observe
	 * @returns The operation's value and its calls
	 */
	async measure<R>(operation: () => Promise<R>): Promise<StorageResult<R>> {
		const mark = this.#calls.length
		const value = await operation()
		return { value, calls: this.#read(mark) }
	}

	// Read the calls from a position on, each with the rows its counter holds.
	#read(from: number): readonly StorageCall[] {
		return this.#calls
			.slice(from)
			.map(({ member, keys, rows, scoped }) => ({ member, keys, rows: rows.count, scoped }))
	}

	// Record one call as it is invoked, and return the counter of the rows it returns or yields.
	#record(member: StorageMember, keys: number, scoped: boolean, rows: StreamPage): StreamPage {
		this.#calls.push({ member, keys, rows, scoped })
		return rows
	}

	#root(source: DriverInterface): DriverInterface {
		const base: DriverInterface = {
			...this.#wrap(source, false),
			open: source.open.bind(source),
			close: source.close.bind(source),
		}
		if (source.transaction === undefined) return base
		const transaction = source.transaction.bind(source)
		return {
			...base,
			transaction: <R>(scope: (storage: StorageInterface) => Promise<R>): Promise<R> =>
				transaction((storage) => scope(this.#wrap(storage, true))),
		}
	}

	#wrap(storage: StorageInterface, scoped: boolean): StorageInterface {
		const recorded = new RecordedStorage(storage, (member, keys, rows) => {
			this.#record(member, keys, scoped, rows)
		})
		return {
			read: recorded.read.bind(recorded),
			write: recorded.write.bind(recorded),
			insert: recorded.insert.bind(recorded),
			delete: recorded.delete.bind(recorded),
			keys: recorded.keys.bind(recorded),
			scan: recorded.scan.bind(recorded),
			clear: recorded.clear.bind(recorded),
			...(storage.migrate === undefined ? {} : { migrate: storage.migrate.bind(storage) }),
			...(storage.metadata === undefined ? {} : { metadata: storage.metadata.bind(storage) }),
			...(storage.stamp === undefined ? {} : { stamp: storage.stamp.bind(storage) }),
			...(storage.plan === undefined
				? {}
				: { plan: this.#plan.bind(this, storage.plan.bind(storage), scoped) }),
			...(storage.records === undefined
				? {}
				: { records: this.#records.bind(this, storage.records.bind(storage), scoped) }),
			...(storage.stream === undefined
				? {}
				: { stream: this.#stream.bind(this, storage.stream.bind(storage), scoped) }),
			...(storage.aggregate === undefined
				? {}
				: { aggregate: this.#aggregate.bind(this, storage.aggregate.bind(storage), scoped) }),
		}
	}

	#plan(
		plan: (table: string, input: ReadInput) => ReadPlan,
		scoped: boolean,
		table: string,
		input: ReadInput,
	): ReadPlan {
		this.#record('plan', 0, scoped, new StreamPage(0))
		return plan(table, input)
	}

	async #records(
		records: (table: string, input: QueryInput) => Promise<readonly Row[]>,
		scoped: boolean,
		table: string,
		input: QueryInput,
	): Promise<readonly Row[]> {
		const counter = this.#record('records', 0, scoped, new StreamPage(0))
		const rows = await records(table, input)
		rows.forEach(() => counter.next())
		return rows
	}

	#stream(
		stream: (table: string, input: QueryInput) => AsyncIterable<Row>,
		scoped: boolean,
		table: string,
		input: QueryInput,
	): AsyncIterable<Row> {
		return streamRecordedRows(
			stream(table, input),
			this.#record('stream', 0, scoped, new StreamPage(0)),
		)
	}

	async #aggregate(
		aggregate: (
			table: string,
			operation: AggregateOperation,
			column: FieldPath,
			input: QueryInput,
		) => Promise<number | undefined>,
		scoped: boolean,
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined> {
		this.#record('aggregate', 0, scoped, new StreamPage(0))
		return aggregate(table, operation, column, input)
	}
}
