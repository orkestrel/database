import type {
	Criteria,
	DriverInterface,
	DriverMeta,
	Key,
	Migration,
	Row,
	TableSchema,
	TransactionInterface,
} from '@src/core'
import { DatabaseError, MemoryDriver, extractKey } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * A persistent {@link DriverInterface} backed by a single JSON file — the
 * reference {@link MemoryDriver} plus file load / flush.
 *
 * @remarks
 * A decorator, not a reimplementation: every primitive delegates to an inner
 * {@link MemoryDriver}, so querying, key-order `scan` / `keys`, and capture-replay
 * `snapshot` are inherited unchanged — this layer adds only persistence. `open`
 * loads the file into memory; every mutation (`write` / `delete` / `clear`) flushes
 * the whole store back. The file is one JSON object, `{ meta?: DriverMeta, tables: {
 * [name]: rows } }` — `meta` is present only once the store has been `stamp`ed
 * (an unstamped store serializes the old `{ tables }` shape, preserving
 * backward compatibility); a per-table array of rows, each row carrying its own
 * primary (the table contract), so the key is recovered on load with
 * {@link extractKey} and the file need not store it. The parsed JSON crosses the
 * boundary as `unknown` and is narrowed with {@link isRecord} / {@link extractKey},
 * never asserted (AGENTS §14): a missing, corrupt, or wrong-shaped file starts
 * empty rather than throwing, and a malformed row (or malformed `meta`) is
 * skipped/dropped rather than thrown on. It is scan-only — it implements none of
 * the optional native `records` / `count` / `aggregate` hooks, so the core engine
 * over `scan` answers every query. For development, small datasets, and portable /
 * inspectable data; for large or concurrent workloads reach for a SQLite-backed
 * driver.
 *
 * A failure in the write path ({@link JSONDriver.#serialize} — `mkdir` /
 * `writeFile` / `rename`) is wrapped and rethrown as `DatabaseError` `DRIVER`,
 * carrying the target `path` in its context; the read path ({@link
 * JSONDriver.#load}) tolerance above is a separate, deliberate contract and is
 * never touched by this wrapping.
 */
export class JSONDriver implements DriverInterface {
	readonly #path: string
	readonly #memory = new MemoryDriver()
	#schema: readonly TableSchema[] = []
	#meta: DriverMeta | undefined
	#flushCount = 0
	// Serializes #flush calls — each queued flush awaits the prior one before
	// serializing state, so the persisted snapshot always reflects the latest
	// memory state (see #flush @remarks).
	#chain: Promise<void> = Promise.resolve()
	// Set while a transaction() handle is active — suppresses #flush from
	// write/delete/clear so N mutations under the handle cost one file write
	// (on commit) instead of N (see transaction @remarks). Cleared by
	// commit/rollback, which is also how double-settle is detected.
	#deferring = false

	constructor(path: string) {
		this.#path = path
	}

	async open(schema: readonly TableSchema[]): Promise<void> {
		this.#schema = schema
		await this.#memory.open(schema)
		await this.#load()
	}

	async close(): Promise<void> {
		await this.#memory.close()
	}

	async read(table: string, key: Key): Promise<Row | undefined> {
		return this.#memory.read(table, key)
	}

	async write(table: string, key: Key, row: Row): Promise<void> {
		await this.#memory.write(table, key, row)
		if (!this.#deferring) await this.#flush()
	}

	async delete(table: string, key: Key): Promise<boolean> {
		const removed = await this.#memory.delete(table, key)
		if (!this.#deferring) await this.#flush()
		return removed
	}

	keys(table: string): Promise<readonly Key[]> {
		return this.#memory.keys(table)
	}

	scan(table: string): AsyncIterable<Row> {
		return this.#memory.scan(table)
	}

	/**
	 * Natively filtered lazy iteration — delegates to the inner {@link MemoryDriver}.
	 *
	 * @remarks
	 * Semantics are the memory driver's own: `criteria.conditions` filters, `offset`
	 * / `limit` page lazily, and `criteria.order` is ignored (streaming yields key
	 * order; sorted output is `records()`'s job).
	 *
	 * @param table - The table to stream
	 * @param criteria - The filter / offset / limit to apply lazily
	 */
	stream(table: string, criteria: Criteria): AsyncIterable<Row> {
		return this.#memory.stream(table, criteria)
	}

	async clear(table: string): Promise<void> {
		await this.#memory.clear(table)
		if (!this.#deferring) await this.#flush()
	}

	/**
	 * Begin a native transaction — flush-coalescing over the inner {@link MemoryDriver}.
	 *
	 * @remarks
	 * Single-writer: throws `DatabaseError` `CONFLICT` if a transaction is already
	 * active — this driver does not support nesting. On begin, captures the inner
	 * memory rollback thunk via `#memory.snapshot()` and suppresses per-mutation
	 * `#flush` — `write` / `delete` / `clear` still mutate memory but no longer
	 * touch the file, so N mutations under the handle cost ONE file write instead
	 * of N. `commit()` releases the suppression and performs that one atomic
	 * `#flush()`, persisting the transaction's net state. `rollback()` restores
	 * memory via the captured snapshot thunk, then `#flush()`s so the file reflects
	 * the restored state. Outside a transaction, behavior is unchanged — every
	 * mutation flushes on its own. Calling `commit` / `rollback` a second time (on
	 * either method, in either order) throws `DatabaseError` `CONFLICT`.
	 *
	 * @returns A {@link TransactionInterface} handle to `commit` or `rollback`
	 */
	async transaction(): Promise<TransactionInterface> {
		if (this.#deferring) {
			throw new DatabaseError('CONFLICT', 'A transaction is already active on this driver', {})
		}
		const rollback = await this.#memory.snapshot()
		this.#deferring = true
		let settled = false
		return {
			commit: async () => {
				if (settled) {
					throw new DatabaseError('CONFLICT', 'Transaction already settled', {})
				}
				settled = true
				this.#deferring = false
				await this.#flush()
			},
			rollback: async () => {
				if (settled) {
					throw new DatabaseError('CONFLICT', 'Transaction already settled', {})
				}
				settled = true
				await rollback()
				this.#deferring = false
				await this.#flush()
			},
		}
	}

	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		const rollback = await this.#memory.snapshot(tables)
		// Restore the in-memory state, then re-persist it — the file was rewritten
		// on each write during the scope, so a rollback must flush the restored state.
		return async () => {
			await rollback()
			await this.#flush()
		}
	}

	async meta(): Promise<DriverMeta | undefined> {
		return this.#meta
	}

	/**
	 * Persist `meta` verbatim for a later `meta()` to return.
	 *
	 * @remarks
	 * Respects the same defer-flush suppression as `write` / `delete` / `clear`
	 * (see {@link JSONDriver.transaction} @remarks) — stamping inside an active
	 * transaction updates memory but does not flush until the transaction settles.
	 *
	 * @param meta - The {@link DriverMeta} to persist
	 */
	async stamp(meta: DriverMeta): Promise<void> {
		this.#meta = meta
		if (!this.#deferring) await this.#flush()
	}

	/**
	 * Apply a {@link Migration} plan by delegating to the inner {@link MemoryDriver},
	 * then persist the migrated state.
	 *
	 * @remarks
	 * The inner `MemoryDriver.migrate` applies each step (adding/removing tables,
	 * adding/removing columns from stored rows, no-op index steps) and throws
	 * `DatabaseError` `MIGRATION` for a step referencing an unknown table — that
	 * error propagates untouched. `table.add` / `table.remove` steps also update
	 * this driver's own declared `#schema`, mirroring the bookkeeping `open` does,
	 * so a subsequent `#flush` / `#load` round-trip includes (or drops) the table.
	 * A successful migration ends with one atomic `#flush()` so the new state
	 * survives a close and reopen. A multi-step plan applies its steps
	 * sequentially and is NOT atomic — a failure partway through a plan leaves
	 * the earlier steps already applied.
	 *
	 * @param plan - The migration plan to apply
	 */
	async migrate(plan: Migration): Promise<void> {
		await this.#memory.migrate?.(plan)
		let schema = this.#schema
		for (const step of plan.steps) {
			if (step.operation === 'table.add') {
				schema = schema.some((table) => table.name === step.table.name)
					? schema
					: [...schema, step.table]
			} else if (step.operation === 'table.remove') {
				schema = schema.filter((table) => table.name !== step.table)
			}
		}
		this.#schema = schema
		await this.#flush()
	}

	// === Private

	// Load the file into memory; a missing / corrupt / wrong-shaped file starts
	// empty (never throws). Each entry is narrowed via isRecord and its key recovered
	// with extractKey from the schema's primary column; bad entries are skipped. A
	// `meta` block is narrowed with the same tolerance — a malformed or absent
	// `meta` leaves #meta undefined (unstamped) rather than throwing, which is how
	// an old-format file (no `meta` key) is distinguished from a stamped one.
	async #load(): Promise<void> {
		let raw: string
		try {
			raw = await readFile(this.#path, 'utf-8')
		} catch {
			return
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			return
		}
		if (!isRecord(parsed) || !isRecord(parsed.tables)) return
		const tables = parsed.tables
		for (const table of this.#schema) {
			const rows = tables[table.name]
			if (!Array.isArray(rows)) continue
			for (const entry of rows) {
				if (!isRecord(entry)) continue
				const key = extractKey(entry, table.primary)
				if (key === undefined) continue
				await this.#memory.write(table.name, key, entry)
			}
		}
		if (isRecord(parsed.meta)) {
			const version = parsed.meta.version
			const schema = parsed.meta.schema
			const isTableSchema = (value: unknown): value is TableSchema =>
				isRecord(value) &&
				typeof value.name === 'string' &&
				typeof value.primary === 'string' &&
				Array.isArray(value.columns) &&
				Array.isArray(value.indexes)
			if (
				typeof version === 'number' &&
				Number.isFinite(version) &&
				Array.isArray(schema) &&
				schema.every(isTableSchema)
			) {
				this.#meta = { version, schema }
			}
		}
	}

	// Queue a flush behind #chain — see #flush @remarks for why.
	async #flush(): Promise<void> {
		const next = this.#chain.then(() => this.#serialize())
		// Swallow so a failed flush doesn't leave #chain permanently rejected and
		// block every later flush; the caller of THIS #flush still observes the
		// rejection via `next` below.
		this.#chain = next.catch(() => {})
		await next
	}

	// Drain every declared table's rows from memory (in key order) and write the
	// whole store back as one pretty-printed JSON object, creating the directory.
	//
	// @remarks
	// Written atomically: the payload lands in a sibling temp file (same directory,
	// so the platform rename is atomic) and is then renamed onto `#path`. A crash
	// mid-flush can no longer truncate or corrupt the previous good file — POSIX
	// `rename` replaces the destination in one indivisible step, so a reader always
	// sees either the old file or the fully-written new one, never a partial write.
	// `#flush` serializes calls to this method through `#chain` — each flush AWAITS
	// its predecessor before draining `#memory` and writing, so the payload always
	// reflects the latest memory state. Without this, overlapping flushes triggered
	// by non-awaited concurrent mutations could serialize out of order and persist a
	// stale snapshot as the "latest" file. `meta` is included in the payload only
	// once the store has been stamped, so an unstamped store keeps serializing the
	// old `{ tables }` shape (backward compat). Any failure in this write path
	// (`mkdir` / `writeFile` / `rename`) is wrapped as `DatabaseError` `DRIVER`
	// carrying `path` in its context, after the temp-file cleanup below runs.
	async #serialize(): Promise<void> {
		const tables: Record<string, readonly Row[]> = {}
		for (const table of this.#schema) {
			const rows: Row[] = []
			for await (const row of this.#memory.scan(table.name)) rows.push(row)
			tables[table.name] = rows
		}
		this.#flushCount += 1
		const temp = `${this.#path}.${process.pid}.${this.#flushCount}.tmp`
		const payload = this.#meta === undefined ? { tables } : { meta: this.#meta, tables }
		try {
			await mkdir(dirname(this.#path), { recursive: true })
			await writeFile(temp, JSON.stringify(payload, null, 2), 'utf-8')
			await rename(temp, this.#path)
		} catch (error) {
			await rm(temp, { force: true }).catch(() => {})
			throw new DatabaseError('DRIVER', 'Failed to persist the database file', {
				path: this.#path,
				cause: error,
			})
		}
	}
}
