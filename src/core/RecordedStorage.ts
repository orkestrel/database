import type { Key, OperationOptions, Row, StorageInterface, StorageMember } from './types.js'
import { isArray, isDefined } from '@orkestrel/contract'
import { DatabaseError } from './errors.js'
import { buildBatch, streamRecordedRows } from './helpers.js'
import { StreamPage } from './StreamPage.js'

/**
 * Forwards each required member of a storage in the form it received and reports each call when
 * it is invoked: the member, the keys it addresses, and a counter of the rows it returns or
 * yields.
 *
 * @remarks
 * A single key stays single and a list stays a list. A call reports before the storage settles
 * it, so a rejected call and a scan never pulled each count one call; the counter advances as
 * rows return, and a scan's as its consumer pulls them. `StorageRecorder` composes one per
 * storage it wraps.
 *
 * @example
 * ```ts
 * import type { StreamPage } from '@orkestrel/database'
 * import { createMemoryDriver, RecordedStorage } from '@orkestrel/database'
 *
 * const driver = createMemoryDriver()
 * await driver.open([{ name: 'users', primary: 'id', columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }], indexes: [] }])
 * await driver.write('users', 'u1', { id: 'u1' })
 * const counters: StreamPage[] = []
 * const storage = new RecordedStorage(driver, (_member, _keys, rows) => counters.push(rows))
 * await storage.read('users', ['u1', 'u2'])
 * counters[0]?.count // 1 — one call, two keys, one row returned
 * ```
 */
export class RecordedStorage implements StorageInterface {
	readonly #source: StorageInterface
	readonly #record: (member: StorageMember, keys: number, rows: StreamPage) => void

	constructor(
		source: StorageInterface,
		record: (member: StorageMember, keys: number, rows: StreamPage) => void,
	) {
		this.#source = source
		this.#record = record
	}

	read(table: string, key: Key): Promise<Row | undefined>
	read(table: string, keys: readonly Key[]): Promise<ReadonlyArray<Row | undefined>>
	async read(
		table: string,
		keys: Key | readonly Key[],
	): Promise<Row | undefined | ReadonlyArray<Row | undefined>> {
		const rows = this.#report('read', isArray(keys) ? keys.length : 1)
		if (!isArray(keys)) {
			const row = await this.#source.read(table, keys)
			if (row !== undefined) rows.next()
			return row
		}
		const found = await this.#source.read(table, keys)
		found.filter(isDefined).forEach(() => rows.next())
		return found
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
		if (isArray(keys) && isArray(rows)) {
			this.#report('write', buildBatch(keys, rows).length)
			return this.#source.write(table, keys, rows, options)
		}
		if (!isArray(keys) && !isArray(rows)) {
			this.#report('write', 1)
			return this.#source.write(table, keys, rows, options)
		}
		throw new DatabaseError('VALIDATION', 'A batch write needs one row per key', {
			keys: isArray(keys) ? keys.length : 1,
			rows: isArray(rows) ? rows.length : 1,
		})
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
		if (isArray(keys) && isArray(rows)) {
			this.#report('insert', buildBatch(keys, rows).length)
			return this.#source.insert(table, keys, rows, options)
		}
		if (!isArray(keys) && !isArray(rows)) {
			this.#report('insert', 1)
			return this.#source.insert(table, keys, rows, options)
		}
		throw new DatabaseError('VALIDATION', 'A batch write needs one row per key', {
			keys: isArray(keys) ? keys.length : 1,
			rows: isArray(rows) ? rows.length : 1,
		})
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
		this.#report('delete', isArray(keys) ? keys.length : 1)
		return isArray(keys)
			? this.#source.delete(table, keys, options)
			: this.#source.delete(table, keys, options)
	}

	keys(table: string): Promise<readonly Key[]> {
		this.#report('keys', 0)
		return this.#source.keys(table)
	}

	scan(table: string): AsyncIterable<Row> {
		return streamRecordedRows(this.#source.scan(table), this.#report('scan', 0))
	}

	clear(table: string): Promise<void> {
		this.#report('clear', 0)
		return this.#source.clear(table)
	}

	// Report one call as it is invoked, and return the counter of the rows it returns or yields.
	#report(member: StorageMember, keys: number): StreamPage {
		const rows = new StreamPage(0)
		this.#record(member, keys, rows)
		return rows
	}
}
