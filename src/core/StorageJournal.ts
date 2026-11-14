import type {
	Key,
	OperationOptions,
	Row,
	StorageInterface,
	StorageJournalInterface,
} from './types.js'
import { isArray } from '@orkestrel/contract'
import { applyKeys, buildBatch } from './helpers.js'

/**
 * Records the prior row of each key a scope writes or deletes, on its first touch, and restores
 * those keys on request — the transaction floor for a driver without `transaction`.
 *
 * @remarks
 * Every member forwards to the wrapped storage, so a read inside the scope sees the scope's
 * writes. A write, insert, or delete reads the prior rows of its untouched keys in one list
 * `read` ahead of the write, and a later touch of the same key waits on that read. `clear`
 * reads the table's keys and rows in one `keys` and one list `read` ahead of emptying it, and a
 * later touch of that table records nothing. `restore` writes back each cleared table, then
 * each recorded row, and deletes each recorded key that held no row, so its cost follows the
 * keys the scope touched. It gives rollback on rejection, and no crash atomicity.
 *
 * @example
 * ```ts
 * import { createMemoryDriver, StorageJournal } from '@orkestrel/database'
 *
 * const driver = createMemoryDriver()
 * await driver.open([{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }], indexes: [] }])
 * await driver.write('users', 'u1', { id: 'u1', name: 'Ada' })
 * const journal = new StorageJournal(driver)
 * await journal.write('users', 'u1', { id: 'u1', name: 'Grace' })
 * await journal.insert('users', 'u2', { id: 'u2', name: 'Alan' })
 * await journal.restore()
 * await driver.read('users', ['u1', 'u2']) // [{ id: 'u1', name: 'Ada' }, undefined]
 * ```
 */
export class StorageJournal implements StorageJournalInterface {
	readonly #source: StorageInterface
	// The prior row of each touched key, per table: each key is read once, on its first touch.
	readonly #keys = new Map<string, Map<Key, Promise<Row | undefined>>>()
	// The rows of each table the scope cleared, read once ahead of its first clear.
	readonly #tables = new Map<string, Promise<ReadonlyMap<Key, Row>>>()

	constructor(source: StorageInterface) {
		this.#source = source
	}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
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
		const entries = buildBatch(keys, rows)
		const listed = entries.map(([key]) => key)
		await this.#record(table, listed)
		await this.#source.write(
			table,
			listed,
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
		const entries = buildBatch(keys, rows)
		const listed = entries.map(([key]) => key)
		await this.#record(table, listed)
		await this.#source.insert(
			table,
			listed,
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
		return applyKeys(keys, async (listed) => {
			await this.#record(table, listed)
			return this.#source.delete(table, listed, options)
		})
	}

	keys(table: string): Promise<readonly Key[]> {
		return this.#source.keys(table)
	}

	scan(table: string): AsyncIterable<Row> {
		return this.#source.scan(table)
	}

	async clear(table: string): Promise<void> {
		const recorded = this.#tables.get(table)
		const captured = recorded ?? this.#capture(table)
		if (recorded === undefined) {
			this.#tables.set(table, captured)
			// A failed capture recorded no rows and stopped its clear, so a later clear captures again.
			captured.catch(() => {
				this.#tables.delete(table)
			})
		}
		await captured
		await this.#source.clear(table)
	}

	async restore(): Promise<void> {
		for (const [table, captured] of this.#tables) {
			const [outcome] = await Promise.allSettled([captured])
			// A capture that failed stopped its clear, so the table holds what the scope wrote.
			if (outcome?.status !== 'fulfilled') continue
			await this.#source.clear(table)
			const rows = outcome.value
			if (rows.size > 0) await this.#source.write(table, [...rows.keys()], [...rows.values()])
		}
		for (const [table, priors] of this.#keys) {
			const keys = [...priors.keys()]
			const outcomes = await Promise.allSettled(priors.values())
			// A prior read that failed stopped its write, so its key holds what it held before.
			const read = keys.flatMap((key, index) => {
				const outcome = outcomes[index]
				return outcome?.status === 'fulfilled' ? [[key, outcome.value] as const] : []
			})
			const absent = read.flatMap(([key, row]) => (row === undefined ? [key] : []))
			const present = read.flatMap(([key, row]) => (row === undefined ? [] : [[key, row] as const]))
			if (absent.length > 0) await this.#source.delete(table, absent)
			if (present.length > 0) {
				await this.#source.write(
					table,
					present.map(([key]) => key),
					present.map(([, row]) => row),
				)
			}
		}
	}

	// Read the prior rows of the keys the table has not recorded, in one list read, and wait for
	// every listed key's prior row, so no write reaches the storage ahead of the read it follows.
	async #record(table: string, keys: readonly Key[]): Promise<void> {
		const cleared = this.#tables.get(table)
		if (cleared !== undefined) {
			await cleared
			return
		}
		const priors = this.#keys.get(table) ?? new Map<Key, Promise<Row | undefined>>()
		this.#keys.set(table, priors)
		const fresh = [...new Set(keys)].filter((key) => !priors.has(key))
		if (fresh.length > 0) {
			const read = this.#source.read(table, fresh)
			// A failed read recorded no prior row, so a later touch of these keys reads them again.
			read.catch(() => {
				for (const key of fresh) priors.delete(key)
			})
			for (const [index, key] of fresh.entries()) {
				priors.set(
					key,
					read.then((rows) => rows[index]),
				)
			}
		}
		await Promise.all(keys.map((key) => priors.get(key)))
	}

	async #capture(table: string): Promise<ReadonlyMap<Key, Row>> {
		const keys = await this.#source.keys(table)
		const rows = await this.#source.read(table, keys)
		return new Map(
			keys.flatMap((key, index) => {
				const row = rows[index]
				return row === undefined ? [] : [[key, row] as const]
			}),
		)
	}
}
