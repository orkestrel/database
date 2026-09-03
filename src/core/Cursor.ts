import type { CursorInterface, Key, Row } from './types.js'

/**
 * Walks a table's rows forward for bulk in-place mutation.
 *
 * @remarks
 * Iterates a snapshot of the table's keys captured when the cursor was opened,
 * reading each row lazily through the owning table — so a mutation made during
 * iteration cannot corrupt the walk, and a key removed mid-iteration is
 * skipped. `update` and `remove` act on the row at the current position.
 */
export class Cursor<T = Row> implements CursorInterface<T> {
	readonly #keys: readonly Key[]
	readonly #read: (key: Key) => Promise<T | undefined>
	readonly #update: (key: Key, changes: Partial<T>) => Promise<boolean>
	readonly #remove: (key: Key) => Promise<boolean>
	readonly #track: <R>(operation: () => Promise<R>) => Promise<R>
	#tail = Promise.resolve()
	#index = -1
	#value: T | undefined
	#closed = false

	constructor(
		keys: readonly Key[],
		read: (key: Key) => Promise<T | undefined>,
		update: (key: Key, changes: Partial<T>) => Promise<boolean>,
		remove: (key: Key) => Promise<boolean>,
		track: <R>(operation: () => Promise<R>) => Promise<R>,
	) {
		this.#keys = keys
		this.#read = read
		this.#update = update
		this.#remove = remove
		this.#track = track
	}

	get value(): T | undefined {
		return this.#value
	}

	get index(): number {
		return this.#index
	}

	get done(): boolean {
		return this.#closed || this.#index >= this.#keys.length
	}

	next(): Promise<void> {
		return this.#track(() => this.#queue(() => this.#advance()))
	}

	update(changes: Partial<T>): Promise<void> {
		return this.#track(() => this.#queue(() => this.#revise(changes)))
	}

	remove(): Promise<void> {
		return this.#track(() => this.#queue(() => this.#delete()))
	}

	close(): void {
		this.#closed = true
		this.#value = undefined
	}

	async #advance(): Promise<void> {
		if (this.#closed) return
		this.#index += 1
		while (this.#index < this.#keys.length) {
			if (this.#closed) return
			const key = this.#keys[this.#index]
			if (key === undefined) {
				this.#index += 1
				continue
			}
			const row = await this.#read(key)
			if (this.#closed) return
			if (row !== undefined) {
				this.#value = row
				return
			}
			this.#index += 1
		}
		this.#value = undefined
	}

	async #revise(changes: Partial<T>): Promise<void> {
		if (this.#closed || this.#value === undefined) return
		const key = this.#keys[this.#index]
		if (key === undefined) return
		await this.#update(key, changes)
		if (this.#closed) return
		const row = await this.#read(key)
		if (this.#closed) return
		this.#value = row
	}

	async #delete(): Promise<void> {
		if (this.#closed || this.#value === undefined) return
		const key = this.#keys[this.#index]
		if (key === undefined) return
		await this.#remove(key)
		if (this.#closed) return
		this.#value = undefined
	}

	#queue(operation: () => Promise<void>): Promise<void> {
		const result = this.#tail.then(operation)
		this.#tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
}
