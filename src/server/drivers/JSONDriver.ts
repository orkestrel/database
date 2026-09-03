import type {
	QueryInput,
	DriverInterface,
	DriverMetadata,
	Key,
	MigrationInput,
	MigrationStep,
	OperationOptions,
	Row,
	TableSchema,
	StorageInterface,
} from '@src/core'
import {
	bindRowKey,
	DatabaseError,
	DriverIterator,
	MemoryDriver,
	checkAbort,
	cloneDriverMetadata,
	cloneMigrationInput,
	equalsValue,
	extractKey,
	isDatabaseError,
	migrateRows,
	normalizeDriverSchema,
	planMigration,
	projectMigrationSchema,
	validatePage,
} from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { matchesAbsentPath } from '../helpers.js'

/**
 * Implements a persistent {@link DriverInterface} backed by a single JSON file — the
 * reference {@link MemoryDriver} plus file load / flush.
 *
 * @remarks
 * A decorator, not a reimplementation: storage primitives delegate to an inner
 * {@link MemoryDriver}, while this layer owns persistence, writer ordering,
 * isolated transactions, and queued row-snapshot restoration. `open`
 * loads the file into memory; every mutation (`write` / `delete` / `clear`) flushes
 * the whole store back. The file is one JSON object, `{ metadata?: DriverMetadata, tables: {
 * [name]: rows } }` — `metadata` is present only once the store has been `stamp`ed
 * (an unstamped store omits `metadata`); a per-table array of rows, each row carrying its own
 * primary (the table contract), so the key is recovered on load with
 * {@link extractKey} and the file need not store it. The parsed JSON crosses the
 * boundary as `unknown` and is narrowed with {@link isRecord} / {@link extractKey},
 * never asserted. A read that reports no document there starts empty —
 * `ENOENT` for a plain absence, and `ENOTDIR` for a path whose parent is not a
 * directory, which no later write could find either; every other read failure or
 * invalid existing document fails closed without publication, mutation, or
 * automatic repair. It implements the optional native `stream` hook that
 * `TableInterface.scan` prefers over `scan`, and neither `records` nor
 * `aggregate`, so the core engine's `matchesQuery` answers every query on
 * either path. For development, small datasets, and portable / inspectable
 * data; for large or concurrent workloads reach for a SQLite-backed driver.
 *
 * Metadata crosses {@link cloneDriverMetadata} at parsed-file ingress, public and
 * scoped write ingress, candidate/root publication, serialization, and copy-out.
 * Callers therefore cannot mutate queued metadata, and `metadata()` always returns a
 * distinct deeply frozen snapshot. A failure in the write path ({@link
 * JSONDriver.#serialize} — `mkdir` / `writeFile` / `rename`) is wrapped and
 * rethrown as `DatabaseError` `DRIVER`, carrying the target `path` and native
 * `cause` in its context. If temporary-file cleanup also fails, the top-level
 * `DRIVER` context additionally carries `temp` and `cleanup`; a precommit abort
 * remains an `ABORTED` `DatabaseError` in `context.cause`. The fail-closed read path
 * ({@link JSONDriver.#document}) remains separate from this write-error contract.
 */
export class JSONDriver implements DriverInterface {
	readonly #path: string
	#memory = new MemoryDriver()
	#identities = new Map<string, object>()
	#schema: readonly TableSchema[] = []
	#metadata: DriverMetadata | undefined
	#flushCount = 0
	// Serializes point mutations and whole transaction callbacks. Reads await
	// the same chain and cannot observe a half-published file/memory transition.
	#chain: Promise<void> = Promise.resolve()
	// The token and candidate are present only while one isolated transaction
	// callback owns the writer. Root operations conflict instead of reaching
	// speculative state; the scoped capability checks the token on every call.
	#transaction: object | undefined
	#candidate: MemoryDriver | undefined
	#candidateIdentities: Map<string, object> | undefined
	#candidateSchema: readonly TableSchema[] | undefined

	constructor(path: string) {
		this.#path = path
	}

	async open(schema: readonly TableSchema[]): Promise<void> {
		this.#root()
		const owned = normalizeDriverSchema(schema)
		await this.#enqueue(() => this.#open(owned))
	}

	async close(): Promise<void> {
		this.#root()
		await this.#chain
		await this.#memory.close()
	}

	async read(table: string, key: Key): Promise<Row | undefined> {
		this.#root()
		await this.#chain
		return this.#memory.read(table, key)
	}

	async write(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		this.#root()
		await this.#enqueue(() => this.#write(table, key, row, options), options?.signal)
	}

	async insert(table: string, key: Key, row: Row, options?: OperationOptions): Promise<void> {
		this.#root()
		await this.#enqueue(() => this.#insert(table, key, row, options), options?.signal)
	}

	async delete(table: string, key: Key, options?: OperationOptions): Promise<boolean> {
		this.#root()
		return this.#enqueue(() => this.#delete(table, key, options), options?.signal)
	}

	async keys(table: string): Promise<readonly Key[]> {
		this.#root()
		await this.#chain
		return this.#memory.keys(table)
	}

	scan(table: string): AsyncIterable<Row> {
		return new DriverIterator(this.#scan(table)[Symbol.asyncIterator](), () => this.#root())
	}

	/**
	 * Iterates rows lazily with native filtering — delegates to the inner {@link MemoryDriver}.
	 *
	 * @remarks
	 * Semantics are the memory driver's own: `input.conditions` filters, `offset`
	 * / `limit` page lazily, and `input.order` is ignored (streaming yields key
	 * order; sorted output is `records()`'s job).
	 *
	 * @param table - The table to stream
	 * @param input - The filter / offset / limit to apply lazily
	 */
	stream(table: string, input: QueryInput): AsyncIterable<Row> {
		validatePage(input)
		return new DriverIterator(this.#stream(table, input)[Symbol.asyncIterator](), () =>
			this.#root(),
		)
	}

	async clear(table: string): Promise<void> {
		this.#root()
		await this.#enqueue(() => this.#clear(table))
	}

	/**
	 * Runs an isolated native transaction callback over a candidate memory store.
	 *
	 * @remarks
	 * Single-writer: nesting and root operations while active throw `CONFLICT`.
	 * The callback receives a capability over cloned rows, schema, and metadata.
	 * Fulfillment atomically serializes that candidate and publishes it to root
	 * memory only after file replacement succeeds. Rejection or persistence
	 * failure discards the candidate, and every captured capability call after
	 * settlement throws `CONFLICT`.
	 *
	 * @returns The callback's resolved value
	 */
	async transaction<R>(scope: (storage: StorageInterface) => Promise<R>): Promise<R> {
		this.#root()
		return this.#enqueue(() => this.#transact(scope))
	}

	/**
	 * Captures an owned row snapshot at an exact writer-queue position.
	 *
	 * @remarks
	 * Capture owns table names, schemas, rows, and one session-local identity per
	 * table. Rollback is repeatable: it clones the then-current root into a
	 * candidate, adapts captured rows to each surviving same-identity table
	 * through the portable migration engine, persists the candidate with current
	 * metadata, and publishes memory only after file replacement succeeds.
	 * Removed, replaced, uncaptured, and later-added tables remain untouched.
	 *
	 * @param tables - Existing tables to capture; omitted captures every current table
	 * @returns A repeatable rollback operation
	 */
	async snapshot(tables?: readonly string[]): Promise<() => Promise<void>> {
		this.#root()
		const names = tables === undefined ? undefined : [...tables]
		const captured = await this.#enqueue(() => this.#capture(names))
		return async () => {
			this.#root()
			await this.#enqueue(() => this.#restore(captured))
		}
	}

	async metadata(): Promise<DriverMetadata | undefined> {
		this.#root()
		await this.#chain
		return this.#metadata === undefined ? undefined : cloneDriverMetadata(this.#metadata)
	}

	/**
	 * Persists an owned metadata snapshot for a later `metadata()` to copy out.
	 *
	 * @remarks
	 * Root stamping conflicts while a transaction is active. The scoped
	 * {@link StorageInterface.stamp} updates candidate metadata and publishes
	 * with the candidate rows on callback fulfillment.
	 *
	 * @param metadata - The {@link DriverMetadata} to persist
	 */
	async stamp(metadata: DriverMetadata): Promise<void> {
		this.#root()
		const owned = cloneDriverMetadata(metadata)
		await this.#enqueue(() => this.#stamp(owned))
	}

	/**
	 * Applies one atomic {@link MigrationInput} through an isolated candidate.
	 *
	 * @remarks
	 * The candidate receives every plan step plus optional metadata. Its complete
	 * rows, derived schema, and metadata serialize through one atomic file
	 * replacement before root memory changes. Any migration or persistence failure
	 * therefore leaves root state and the prior file exact.
	 *
	 * @param input - The plan and optional metadata to settle together
	 */
	async migrate(input: MigrationInput): Promise<void> {
		this.#root()
		const owned = cloneMigrationInput(input)
		await this.#enqueue(() => this.#migrate(owned))
	}

	// === Private

	async *#scan(table: string): AsyncIterable<Row> {
		await this.#chain
		for await (const row of this.#memory.scan(table)) yield row
	}

	async *#stream(table: string, input: QueryInput): AsyncIterable<Row> {
		await this.#chain
		for await (const row of this.#memory.stream(table, input)) yield row
	}

	async #open(declared: readonly TableSchema[]): Promise<void> {
		const parsed = await this.#document()
		let stored: DriverMetadata | undefined
		let tables: Readonly<Record<string, unknown>>
		if (parsed === undefined) {
			const fresh: Record<string, unknown> = {}
			for (const table of declared) fresh[table.name] = []
			tables = fresh
		} else {
			if (
				!isRecord(parsed) ||
				!Object.hasOwn(parsed, 'tables') ||
				Object.keys(parsed).some((key) => key !== 'tables' && key !== 'metadata')
			) {
				throw new DatabaseError('DRIVER', 'Stored JSON database document is invalid', {
					path: this.#path,
					aspect: 'document',
				})
			}
			if (!isRecord(parsed.tables)) {
				throw new DatabaseError('DRIVER', 'Stored JSON tables are invalid', {
					path: this.#path,
					aspect: 'tables',
				})
			}
			tables = parsed.tables
			if (Object.hasOwn(parsed, 'metadata')) {
				try {
					stored = cloneDriverMetadata(parsed.metadata)
				} catch {
					const cause = new DatabaseError('VALIDATION', 'Stored JSON metadata failed validation', {
						path: 'metadata',
					})
					throw new DatabaseError('DRIVER', 'Stored JSON metadata is invalid', {
						path: this.#path,
						aspect: 'metadata',
						cause,
					})
				}
			}
		}
		const schema = normalizeDriverSchema(stored?.schema ?? declared)
		const names = new Set(schema.map((table) => table.name))
		for (const table of schema) {
			if (!Object.hasOwn(tables, table.name)) {
				throw new DatabaseError('DRIVER', 'Stored JSON table set is invalid', {
					path: this.#path,
					table: table.name,
					aspect: 'missing',
				})
			}
		}
		const unknown = Object.keys(tables).filter((name) => !names.has(name)).length
		if (unknown > 0) {
			throw new DatabaseError('DRIVER', 'Stored JSON table set is invalid', {
				path: this.#path,
				aspect: 'unknown',
				count: unknown,
			})
		}
		const memory = new MemoryDriver()
		await memory.open(schema)
		await this.#hydrate(memory, schema, tables)
		if (stored !== undefined) await memory.stamp(stored)
		this.#memory = memory
		this.#schema = schema
		this.#identities = this.#alignIdentities(schema)
		const metadata = await memory.metadata()
		this.#metadata = metadata === undefined ? undefined : cloneDriverMetadata(metadata)
	}

	async #migrate(input: MigrationInput): Promise<void> {
		const candidate = await this.#clone()
		const identities = this.#projectIdentities(this.#identities, input.plan.steps)
		const schema = await this.#apply(candidate, this.#schema, input)
		const metadata = await candidate.metadata()
		await this.#serialize(undefined, candidate, schema, metadata)
		this.#memory = candidate
		this.#identities = identities
		this.#schema = schema
		this.#metadata = metadata === undefined ? undefined : cloneDriverMetadata(metadata)
	}

	async #apply(
		memory: MemoryDriver,
		current: readonly TableSchema[],
		input: MigrationInput,
	): Promise<readonly TableSchema[]> {
		const schema = projectMigrationSchema(current, input.plan.steps)
		if (
			input.metadata !== undefined &&
			!equalsValue(normalizeDriverSchema(input.metadata.schema), schema)
		) {
			throw new DatabaseError('MIGRATION', 'Migration metadata schema does not match the plan', {
				projected: schema,
				metadata: input.metadata.schema,
			})
		}
		await memory.migrate(input)
		return schema
	}

	async #transact<R>(scope: (storage: StorageInterface) => Promise<R>): Promise<R> {
		this.#root()
		const candidate = await this.#clone()
		const token = {}
		this.#transaction = token
		this.#candidate = candidate
		this.#candidateIdentities = new Map(this.#identities)
		this.#candidateSchema = this.#schema
		try {
			const value = await scope(this.#capability(token))
			const schema = this.#candidateSchema
			const identities = this.#candidateIdentities
			if (schema === undefined || identities === undefined) {
				throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
			}
			this.#candidate = undefined
			this.#candidateIdentities = undefined
			this.#candidateSchema = undefined
			const metadata = await candidate.metadata()
			await this.#serialize(undefined, candidate, schema, metadata)
			this.#memory = candidate
			this.#identities = identities
			this.#schema = schema
			this.#metadata = metadata === undefined ? undefined : cloneDriverMetadata(metadata)
			return value
		} finally {
			if (this.#transaction === token) {
				this.#transaction = undefined
				this.#candidate = undefined
				this.#candidateIdentities = undefined
				this.#candidateSchema = undefined
			}
		}
	}

	async #clone(): Promise<MemoryDriver> {
		const candidate = new MemoryDriver()
		await candidate.open(this.#schema)
		for (const table of this.#schema) {
			for await (const row of this.#memory.scan(table.name)) {
				const key = extractKey(row, table.primary)
				if (key !== undefined) await candidate.write(table.name, key, row)
			}
		}
		if (this.#metadata !== undefined) {
			await candidate.stamp(cloneDriverMetadata(this.#metadata))
		}
		return candidate
	}

	async #capture(names: readonly string[] | undefined) {
		const selected = names === undefined ? undefined : new Set(names)
		const captured = new Map<
			string,
			{ readonly identity: object; readonly schema: TableSchema; readonly rows: readonly Row[] }
		>()
		for (const table of this.#schema) {
			if (selected !== undefined && !selected.has(table.name)) continue
			const identity = this.#identities.get(table.name)
			if (identity === undefined) continue
			const rows: Row[] = []
			for await (const row of this.#memory.scan(table.name)) rows.push(row)
			captured.set(table.name, { identity, schema: table, rows })
		}
		return captured
	}

	async #restore(
		captured: ReadonlyMap<
			string,
			{ readonly identity: object; readonly schema: TableSchema; readonly rows: readonly Row[] }
		>,
	): Promise<void> {
		const replacements = new Map<string, ReadonlyMap<Key, Row>>()
		for (const [name, capture] of captured) {
			const current = this.#schema.find((table) => table.name === name)
			if (current === undefined || this.#identities.get(name) !== capture.identity) continue
			const plan = planMigration([capture.schema], [current])
			const migrated = migrateRows(capture.rows, plan.steps)
			if (migrated.length !== capture.rows.length) {
				throw new DatabaseError('MIGRATION', 'Snapshot row count changed during migration', {
					table: name,
				})
			}
			const rows = new Map<Key, Row>()
			for (const [index, row] of migrated.entries()) {
				const key = extractKey(row, current.primary)
				if (key === undefined) {
					throw new DatabaseError(
						'MIGRATION',
						`migrate: captured row is missing primary column '${current.primary}'`,
						{ table: name, column: current.primary, index },
					)
				}
				rows.set(key, bindRowKey(row, current.primary, key))
			}
			replacements.set(name, rows)
		}
		const candidate = await this.#clone()
		for (const [name, rows] of replacements) {
			await candidate.clear(name)
			for (const [key, row] of rows) await candidate.write(name, key, row)
		}
		const metadata = await candidate.metadata()
		await this.#serialize(undefined, candidate, this.#schema, metadata)
		this.#memory = candidate
		this.#metadata = metadata === undefined ? undefined : cloneDriverMetadata(metadata)
	}

	#capability(token: object): StorageInterface {
		return {
			read: this.#readCandidate.bind(this, token),
			write: this.#writeCandidate.bind(this, token),
			insert: this.#insertCandidate.bind(this, token),
			delete: this.#deleteCandidate.bind(this, token),
			keys: this.#keysCandidate.bind(this, token),
			scan: this.#scanCandidate.bind(this, token),
			clear: this.#clearCandidate.bind(this, token),
			migrate: this.#migrateCandidate.bind(this, token),
			metadata: this.#metadataCandidate.bind(this, token),
			stamp: this.#stampCandidate.bind(this, token),
		}
	}

	async #readCandidate(token: object, table: string, key: Key): Promise<Row | undefined> {
		return this.#requireCandidate(token).read(table, key)
	}

	async #writeCandidate(
		token: object,
		table: string,
		key: Key,
		row: Row,
		options?: OperationOptions,
	): Promise<void> {
		await this.#requireCandidate(token).write(table, key, row, options)
	}

	async #insertCandidate(
		token: object,
		table: string,
		key: Key,
		row: Row,
		options?: OperationOptions,
	): Promise<void> {
		await this.#requireCandidate(token).insert(table, key, row, options)
	}

	async #deleteCandidate(
		token: object,
		table: string,
		key: Key,
		options?: OperationOptions,
	): Promise<boolean> {
		return this.#requireCandidate(token).delete(table, key, options)
	}

	async #keysCandidate(token: object, table: string): Promise<readonly Key[]> {
		return this.#requireCandidate(token).keys(table)
	}

	#scanCandidate(token: object, table: string): AsyncIterable<Row> {
		const source = this.#requireCandidate(token).scan(table)
		return new DriverIterator(source[Symbol.asyncIterator](), () => {
			this.#requireCandidate(token)
		})
	}

	async #clearCandidate(token: object, table: string): Promise<void> {
		await this.#requireCandidate(token).clear(table)
	}

	async #migrateCandidate(token: object, input: MigrationInput): Promise<void> {
		const memory = this.#requireCandidate(token)
		const schema = this.#candidateSchema
		const identities = this.#candidateIdentities
		if (schema === undefined || identities === undefined) {
			throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		}
		const owned = cloneMigrationInput(input)
		const projected = this.#projectIdentities(identities, owned.plan.steps)
		this.#candidateSchema = await this.#apply(memory, schema, owned)
		this.#candidateIdentities = projected
	}

	async #metadataCandidate(token: object): Promise<DriverMetadata | undefined> {
		const metadata = await this.#requireCandidate(token).metadata()
		return metadata === undefined ? undefined : cloneDriverMetadata(metadata)
	}

	async #stampCandidate(token: object, metadata: DriverMetadata): Promise<void> {
		const memory = this.#requireCandidate(token)
		const owned = cloneDriverMetadata(metadata)
		await memory.stamp(owned)
	}

	#requireCandidate(token: object): MemoryDriver {
		if (this.#transaction !== token || this.#candidate === undefined) {
			throw new DatabaseError('CONFLICT', 'Transaction scope has settled')
		}
		return this.#candidate
	}

	#alignIdentities(schema: readonly TableSchema[]): Map<string, object> {
		const aligned = new Map<string, object>()
		for (const table of schema) {
			aligned.set(table.name, this.#identities.get(table.name) ?? {})
		}
		return aligned
	}

	#projectIdentities(
		identities: ReadonlyMap<string, object>,
		steps: readonly MigrationStep[],
	): Map<string, object> {
		const projected = new Map(identities)
		for (const step of steps) {
			if (step.operation === 'table.add') projected.set(step.table.name, {})
			if (step.operation === 'table.remove') projected.delete(step.table)
		}
		return projected
	}

	#root(): void {
		if (this.#transaction !== undefined) {
			throw new DatabaseError('CONFLICT', 'A transaction is active on this driver')
		}
	}

	// Read and parse without publishing state. Absence is what the host reports when
	// nothing is there to read: ENOENT for a plain absence, and ENOTDIR for a path
	// whose parent is not a directory. The second is absence in the stronger sense —
	// no file can exist at that name — and hosts disagree on which of the two they
	// return for it, so reading only ENOENT made the same tree open on one host and
	// fail closed on another. Every EXISTING unreadable or syntactically invalid file
	// still fails closed, which is what this branch is for.
	async #document(): Promise<unknown> {
		let raw: string
		try {
			raw = await readFile(this.#path, 'utf-8')
		} catch (error) {
			if (matchesAbsentPath(error)) return undefined
			throw new DatabaseError('DRIVER', 'Failed to read the JSON database file', {
				path: this.#path,
				cause: error,
			})
		}
		try {
			return JSON.parse(raw)
		} catch {
			throw new DatabaseError('DRIVER', 'Stored JSON database is invalid JSON', {
				path: this.#path,
				aspect: 'syntax',
			})
		}
	}

	// Validate and hydrate only into the local candidate memory. The caller
	// publishes that candidate after every selected table and row succeeds.
	async #hydrate(
		memory: MemoryDriver,
		schema: readonly TableSchema[],
		tables: Readonly<Record<string, unknown>>,
	): Promise<void> {
		for (const table of schema) {
			const rows = tables[table.name]
			if (!Array.isArray(rows)) {
				throw new DatabaseError('DRIVER', 'Stored JSON table is invalid', {
					path: this.#path,
					table: table.name,
					aspect: 'container',
				})
			}
			const keys = new Set<Key>()
			for (const [index, entry] of rows.entries()) {
				if (!isRecord(entry)) {
					throw new DatabaseError('DRIVER', 'Stored JSON row is invalid', {
						path: this.#path,
						table: table.name,
						index,
						aspect: 'record',
					})
				}
				const key = extractKey(entry, table.primary)
				if (key === undefined) {
					throw new DatabaseError('DRIVER', 'Stored JSON row is invalid', {
						path: this.#path,
						table: table.name,
						index,
						aspect: 'primary',
					})
				}
				if (keys.has(key)) {
					throw new DatabaseError('DRIVER', 'Stored JSON row is invalid', {
						path: this.#path,
						table: table.name,
						index,
						aspect: 'duplicate',
					})
				}
				keys.add(key)
				await memory.write(table.name, key, entry)
			}
		}
	}

	// Queue a nontransactional operation behind #chain.
	async #enqueue<R>(operation: () => Promise<R>, signal?: AbortSignal): Promise<R> {
		checkAbort(signal)
		let started = false
		const next = this.#chain.then(async () => {
			started = true
			checkAbort(signal)
			return operation()
		})
		this.#chain = next.then(
			() => {},
			() => {},
		)
		if (signal === undefined) return next
		const cleanup = new AbortController()
		return new Promise<R>((resolve, reject) => {
			signal.addEventListener(
				'abort',
				() => {
					if (started) return
					try {
						checkAbort(signal)
					} catch (error) {
						reject(error)
					}
				},
				{ once: true, signal: cleanup.signal },
			)
			next.then(
				(result) => {
					cleanup.abort()
					resolve(result)
				},
				(error) => {
					cleanup.abort()
					reject(error)
				},
			)
		})
	}

	async #write(
		table: string,
		key: Key,
		row: Row,
		options: OperationOptions | undefined,
	): Promise<void> {
		const previous = await this.#memory.read(table, key)
		await this.#memory.write(table, key, row, options)
		try {
			await this.#serialize(options?.signal)
		} catch (error) {
			if (previous === undefined) await this.#memory.delete(table, key)
			else await this.#memory.write(table, key, previous)
			throw error
		}
	}

	async #insert(
		table: string,
		key: Key,
		row: Row,
		options: OperationOptions | undefined,
	): Promise<void> {
		await this.#memory.insert(table, key, row, options)
		try {
			await this.#serialize(options?.signal)
		} catch (error) {
			await this.#memory.delete(table, key)
			throw error
		}
	}

	async #delete(table: string, key: Key, options: OperationOptions | undefined): Promise<boolean> {
		const previous = await this.#memory.read(table, key)
		if (previous === undefined) {
			checkAbort(options?.signal)
			return false
		}
		await this.#memory.delete(table, key, options)
		try {
			await this.#serialize(options?.signal)
		} catch (error) {
			await this.#memory.write(table, key, previous)
			throw error
		}
		return true
	}

	async #clear(table: string): Promise<void> {
		const rollback = await this.#memory.snapshot([table])
		await this.#memory.clear(table)
		try {
			await this.#serialize()
		} catch (error) {
			await rollback()
			throw error
		}
	}

	async #stamp(metadata: DriverMetadata): Promise<void> {
		const previous = this.#metadata
		this.#metadata = cloneDriverMetadata(metadata)
		try {
			await this.#serialize()
		} catch (error) {
			this.#metadata = previous
			throw error
		}
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
	// `#enqueue` serializes calls to this method through `#chain` — each job AWAITS
	// its predecessor before draining `#memory` and writing, so the payload always
	// reflects the latest memory state. Without this, overlapping flushes triggered
	// by non-awaited concurrent mutations could serialize out of order and persist a
	// stale snapshot as the "latest" file. `metadata` is included in the payload only
	// once the store has been stamped; an unstamped store omits it. Metadata is cloned before the
	// first scan so this serialization owns one validated immutable snapshot.
	// A lone write-path failure becomes `DRIVER` after cleanup succeeds, while a
	// precommit abort retains `ABORTED`. If cleanup also fails, the top-level
	// `DRIVER` context carries `path`, `temp`, the mapped/original `cause`, and
	// `cleanup`.
	async #serialize(
		signal?: AbortSignal,
		memory = this.#memory,
		schema = this.#schema,
		metadata = this.#metadata,
	): Promise<void> {
		const owned = metadata === undefined ? undefined : cloneDriverMetadata(metadata)
		const tables: Record<string, readonly Row[]> = {}
		checkAbort(signal)
		for (const table of schema) {
			const rows: Row[] = []
			for await (const row of memory.scan(table.name)) {
				checkAbort(signal)
				rows.push(row)
			}
			tables[table.name] = rows
		}
		checkAbort(signal)
		this.#flushCount += 1
		const temp = `${this.#path}.${process.pid}.${this.#flushCount}.tmp`
		const payload = owned === undefined ? { tables } : { metadata: owned, tables }
		let dispatched = false
		try {
			await mkdir(dirname(this.#path), { recursive: true })
			const serialized = JSON.stringify(payload, null, 2)
			checkAbort(signal)
			await writeFile(temp, serialized, {
				encoding: 'utf-8',
				flush: true,
				signal,
			})
			checkAbort(signal)
			dispatched = true
			await rename(temp, this.#path)
		} catch (error) {
			let cause: unknown = error
			if (!dispatched) {
				try {
					checkAbort(signal)
				} catch (abort) {
					cause = abort
				}
			}
			try {
				await rm(temp, { force: true })
			} catch (cleanup) {
				// A temp file that cannot exist was never left behind, so removing it did
				// not fail in the sense this branch reports. `force` already absorbs
				// ENOENT; ENOTDIR reaches here when the write failed before the temp was
				// created because its parent is not a directory, and reporting `temp` and
				// `cleanup` there would name residue that is not on disk.
				if (!matchesAbsentPath(cleanup)) {
					throw new DatabaseError('DRIVER', 'Failed to persist and clean the database file', {
						path: this.#path,
						temp,
						cause,
						cleanup,
					})
				}
			}
			if (isDatabaseError(cause) && cause.code === 'ABORTED') throw cause
			throw new DatabaseError('DRIVER', 'Failed to persist the database file', {
				path: this.#path,
				cause,
			})
		}
	}
}
