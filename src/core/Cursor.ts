import type { CursorInterface, Key, TableInterface } from './types.js'

/**
 * A forward row cursor for bulk in-place mutation.
 *
 * @remarks
 * Iterates a snapshot of the table's keys captured when the cursor was opened,
 * reading each row lazily through the owning table — so a mutation made during
 * iteration cannot corrupt the walk, and a key removed mid-iteration is simply
 * skipped. `update` and `remove` act on the row at the current position.
 */
export class Cursor<T = Record<string, unknown>> implements CursorInterface<T> {
	readonly #table: TableInterface<T>
	readonly #keys: readonly Key[]
	#index = -1
	#value: T | undefined
	#closed = false

	constructor(table: TableInterface<T>, keys: readonly Key[]) {
		this.#table = table
		this.#keys = keys
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

	async next(): Promise<void> {
		if (this.#closed) return
		this.#index += 1
		while (this.#index < this.#keys.length) {
			const key = this.#keys[this.#index]
			if (key === undefined) {
				this.#index += 1
				continue
			}
			const row = await this.#table.get(key)
			if (row !== undefined) {
				this.#value = row
				return
			}
			this.#index += 1
		}
		this.#value = undefined
	}

	async update(changes: Partial<T>): Promise<void> {
		if (this.#closed || this.#value === undefined) return
		const key = this.#keys[this.#index]
		if (key === undefined) return
		await this.#table.update(key, changes)
		this.#value = await this.#table.get(key)
	}

	async remove(): Promise<void> {
		if (this.#closed || this.#value === undefined) return
		const key = this.#keys[this.#index]
		if (key === undefined) return
		await this.#table.remove(key)
		this.#value = undefined
	}

	close(): void {
		this.#closed = true
		this.#value = undefined
	}
}
