// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `guides` (and future `src:server` / `app:server`) projects. `node:fs` /
// `node:path` imports belong here, never in `setup.ts`, which browser projects
// also load. Anchor every path to `WORKSPACE_ROOT` so the runner's cwd never
// matters (AGENTS §16.1).

import type {
	AggregateFunction,
	DatabaseInterface,
	FieldPath,
	MCPServerInterface,
	QueryInterface,
	TableInterface,
	TableSchema,
} from '@src/core'
import type {
	InputStreamInterface,
	OutputStreamInterface,
	RouteHandlerContextInterface,
	ServerInterface,
	SessionInterface,
	StreamTargetInterface,
	WebSocketFrame,
} from '@src/server'
import type { TestRecorderInterface } from './setup.js'
import type { IncomingMessage } from 'node:http'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { EventEmitter } from 'node:events'
import { createServer as createHTTPServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
	booleanShape,
	createDatabase,
	createMCPServer,
	createMemoryDriver,
	createTool,
	createToolManager,
	integerShape,
	isRecord,
	nullableShape,
	objectShape,
	stringShape,
	strip,
} from '@src/core'
import {
	collectBody,
	contentType,
	createSQLiteDriver,
	decodeBody,
	flattenHeaders,
	isSQLiteError,
	parseWebSocketFrame,
} from '@src/server'
import {
	addTool,
	classMethodNames,
	createRecorder,
	exportedTypeNames,
	exportedValueNames,
	interfaceMethodNames,
	interfaceRequiredMethodNames,
	methodTable,
	surfaceRows,
} from './setup.js'

// Absolute path to the repository root, resolved from this file's URL.
export const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url))

// Read one repo-relative text file, anchored to the workspace root.
export function readText(relativePath: string): string {
	return readFileSync(join(WORKSPACE_ROOT, relativePath), 'utf8')
}

// Whether a repo-relative path exists.
export function fileExists(relativePath: string): boolean {
	return existsSync(join(WORKSPACE_ROOT, relativePath))
}

// Workspace-relative, forward-slash paths of every file under a repo-relative
// directory, recursively, optionally filtered by file name.
export function listTree(
	relativeDir: string,
	filter?: (name: string) => boolean,
): readonly string[] {
	const root = join(WORKSPACE_ROOT, relativeDir)
	const paths: string[] = []
	for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue
		if (filter !== undefined && !filter(entry.name)) continue
		const full = join(entry.parentPath, entry.name)
		paths.push(full.slice(WORKSPACE_ROOT.length).split('\\').join('/'))
	}
	return paths.sort()
}

// Concatenated source of every matching file under a repo-relative directory tree.
export function readTree(relativeDir: string, filter?: (name: string) => boolean): string {
	return listTree(relativeDir, filter)
		.map((path) => readText(path))
		.join('\n')
}

// Every markdown guide under a repo-relative directory tree, keyed by path without `.md`.
export function readGuides(relativeDir: string): Readonly<Record<string, string>> {
	const guides: Record<string, string> = {}
	const prefix = `${relativeDir}/`
	for (const path of listTree(relativeDir, (name) => name.endsWith('.md'))) {
		if (path.startsWith(prefix)) {
			guides[path.slice(prefix.length).replace(/\.md$/, '')] = readText(path)
		}
	}
	return guides
}

/**
 * A fake {@link StreamTargetInterface} for the C-g server console — a stand-in `process.stdout` /
 * `process.stderr` with a recorded `write`, so a `createServerSink` / `ProcessCapture` test drives
 * the isTTY / strip / routing paths WITHOUT touching the real process streams (AGENTS §16.1 — a
 * reusable server fixture lives in setup). The recorder captures every written string; `isTTY` and
 * `columns` are fixed at construction so a test can exercise the TTY (ANSI verbatim) and non-TTY
 * (ANSI stripped) branches deterministically.
 *
 * @param options - `isTTY` (default `false` — a piped stream) and `columns` (a TTY width, omitted
 *   when not a TTY). `write` always returns `true` (no simulated backpressure unless overridden by
 *   a caller building its own target).
 * @returns The `target` (pass as `out` / `err` / a process-stream stand-in) plus its `writes`
 *   recorder (`writes.calls` is the list of `[text]` tuples written, `writes.count` the tally).
 */
export function createStreamTarget(options?: { isTTY?: boolean; columns?: number }): {
	readonly target: StreamTargetInterface
	readonly writes: TestRecorderInterface<readonly [text: string]>
} {
	const writes = createRecorder<readonly [text: string]>()
	const target: StreamTargetInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: options?.isTTY ?? false,
		columns: options?.columns,
	}
	return { target, writes }
}

/**
 * A recording stand-in for a raw `process.stdout.write` / `process.stderr.write` — a function
 * assignable to the Node stream `write` slot (so a test can `process.stdout.write = probe.write`
 * with no `as`) that records each chunk as text and returns a configurable backpressure boolean.
 * The C-g `ProcessCapture` test installs one as the "current" write BEFORE starting the capture, so
 * the capture's snapshot-original (and any mirror replay) lands HERE instead of the real terminal —
 * keeping the suite output-clean and the mirror assertion deterministic (AGENTS §16.1).
 *
 * @param backpressure - The boolean each `write` returns (default `true` — buffer not full); set
 *   `false` to drive the capture's backpressure-passthrough assertion.
 * @returns The `write` (assign it to a process stream) plus `texts` — the list of chunks written,
 *   each coerced to a string (a Buffer / Uint8Array decoded utf-8), in order.
 */
export function createWriteProbe(backpressure = true): {
	readonly write: NodeJS.WriteStream['write']
	readonly texts: readonly string[]
} {
	const texts: string[] = []
	const write = (chunk: string | Uint8Array): boolean => {
		texts.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
		return backpressure
	}
	return { write, texts }
}

/**
 * A scripted FAKE TTY pair for the T-c interactive `Terminal` driver — a stand-in `process.stdin` /
 * `process.stdout` so a prompt test drives every keypress and records every byte WITHOUT a real
 * terminal (AGENTS §16.1 — a reusable server fixture lives in setup). The `input` is a real
 * {@link EventEmitter} (so `on` / `off` / the driver's `'data'` subscription are genuine, not mocked)
 * wearing the {@link InputStreamInterface} shape (a TTY by default, with `setRawMode` / `resume` /
 * `pause`); `push(chunk)` emits a scripted key chunk into it. The `output` records every written
 * string; {@link FakeTTYInterface.text} returns that output ANSI-STRIPPED (via the framework's
 * `strip`, never a re-rolled regex — §16.1) so a test asserts the RENDERED CONTENT of a prompt view.
 *
 * The fixture also tracks the raw-mode lifecycle so a test can prove the driver is leak-free: `enters`
 * / `exits` count `setRawMode(true)` / `setRawMode(false)`, `raw` is the live raw-mode flag, and
 * `listeners` is the current `'data'` listener count — after a prompt resolves a test asserts
 * `enters === 1`, `exits === 1`, `raw === false`, and `listeners === 0` (raw mode entered exactly
 * once and fully cleaned up, no leaked listener).
 *
 * @param options - `isTTY` (default `true` — exercise the raw-mode interactive path; pass `false` to
 *   drive the `node:readline` non-TTY fallback) and `columns` (a reported TTY width)
 * @returns The {@link FakeTTYInterface}
 */
export function createFakeTTY(options?: { isTTY?: boolean; columns?: number }): FakeTTYInterface {
	const emitter = new EventEmitter()
	const writes = createRecorder<readonly [text: string]>()
	let raw = false
	let enters = 0
	let exits = 0
	const input: InputStreamInterface = {
		on(event, listener) {
			emitter.on(event, listener)
		},
		off(event, listener) {
			emitter.off(event, listener)
		},
		setRawMode(mode: boolean) {
			if (mode && !raw) enters += 1
			if (!mode && raw) exits += 1
			raw = mode
		},
		resume() {},
		pause() {},
		isTTY: options?.isTTY ?? true,
	}
	const output: OutputStreamInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: options?.isTTY ?? true,
	}
	return {
		input,
		output,
		writes,
		push: (chunk: string | Uint8Array) => emitter.emit('data', chunk),
		text: () => strip(writes.calls.map(([written]) => written).join('')),
		get raw() {
			return raw
		},
		get enters() {
			return enters
		},
		get exits() {
			return exits
		},
		listeners: () => emitter.listenerCount('data'),
	}
}

/** A scripted fake-TTY pair for the interactive `Terminal` tests — see {@link createFakeTTY}. */
export interface FakeTTYInterface {
	/** The injectable input stream — pass as `createTerminal({ input })`; a real {@link EventEmitter} under the {@link InputStreamInterface} shape. */
	readonly input: InputStreamInterface
	/** The injectable recording output stream — pass as `createTerminal({ output })`. */
	readonly output: OutputStreamInterface
	/** Every written string, in order (`writes.calls` is the list of `[text]` tuples) — the raw record behind {@link text}. */
	readonly writes: TestRecorderInterface<readonly [text: string]>
	/** Emit one scripted key chunk into the input as a `'data'` event (a string or raw bytes `parseKey` decodes). */
	push(chunk: string | Uint8Array): void
	/** The full written output with ANSI stripped — assert a prompt view's rendered content against this. */
	text(): string
	/** The live raw-mode flag — assert `false` after a prompt resolves (raw mode was left). */
	readonly raw: boolean
	/** How many times `setRawMode(true)` was called — assert `1` (raw mode entered exactly once per prompt). */
	readonly enters: number
	/** How many times `setRawMode(false)` was called — assert `1` (raw mode cleaned up). */
	readonly exits: number
	/** The current `'data'` listener count — assert `0` after a prompt resolves (no leaked listener). */
	listeners(): number
}

// The cursor hide / show escapes the interactive `Terminal` writes around a prompt — built from the
// ESC char code so no raw control byte sits in source. `assertCleanExit` asserts BOTH appear in the
// raw output (the cursor was hidden during the prompt and RESTORED on the way out).
const CURSOR_HIDE = `${String.fromCharCode(27)}[?25l`
const CURSOR_SHOW = `${String.fromCharCode(27)}[?25h`

/**
 * The full concatenated RAW output (ANSI intact) the interactive `Terminal` driver wrote to a {@link
 * FakeTTYInterface} — the un-stripped twin of {@link FakeTTYInterface.text} (which returns the same
 * bytes ANSI-STRIPPED). Use it to assert the exact escape sequences (the cursor hide/show, the
 * cursor-up redraw climbs) OR — for a `password` prompt — to prove a secret NEVER appears in ANY
 * written chunk, the committed submit line included (AGENTS §16.1).
 *
 * @param tty - The fake TTY from {@link createFakeTTY}
 * @returns Every written string joined in order, ANSI escapes intact
 */
export function rawOutput(tty: FakeTTYInterface): string {
	return tty.writes.calls.map(([written]) => written).join('')
}

/**
 * Assert the raw-mode LEAK-FREEDOM invariant after an interactive prompt settles (submit OR cancel):
 * raw mode was entered EXACTLY `entries` time(s) and fully unwound (`enters === exits`, `raw ===
 * false`), no `'data'` listener leaked (`listeners() === 0`), and the cursor was hidden then SHOWN
 * again (restored on the way out) — the load-bearing `Terminal` invariant every exit-path test
 * checks (AGENTS §16.1). The un-stripped {@link rawOutput} is the twin reader it builds on.
 *
 * @param tty - The fake TTY from {@link createFakeTTY}, after a prompt has resolved/rejected
 * @param entries - How many raw-mode entries to expect (default `1` — one prompt; pass the prompt
 *   count for a re-use-across-sequential-prompts assertion)
 */
export function assertCleanExit(tty: FakeTTYInterface, entries = 1): void {
	expect(tty.enters).toBe(entries)
	expect(tty.exits).toBe(entries)
	expect(tty.raw).toBe(false)
	expect(tty.listeners()).toBe(0)
	const raw = rawOutput(tty)
	expect(raw).toContain(CURSOR_HIDE)
	expect(raw).toContain(CURSOR_SHOW)
}

// A fresh on-disk SQLite database path under the OS temp dir, with a `cleanup`
// thunk that removes its directory. Used by tests that need real file persistence
// across a close / reopen (`:memory:` cannot persist). Call `cleanup` in
// `afterEach` so no temp file leaks (AGENTS §16.1).
export function tempDatabasePath(): { readonly path: string; readonly cleanup: () => void } {
	const directory = mkdtempSync(join(tmpdir(), 'taverna-sqlite-'))
	return {
		path: join(directory, 'database.sqlite'),
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	}
}

/** A temp-dir fixture for the static-file tests — its `root` directory plus a `cleanup` thunk. */
export interface StaticFixtureInterface {
	/** The temp directory's absolute path — pass it as `createStatic`'s `root`. */
	readonly root: string
	/** Remove the whole temp directory; call in `afterEach` so no temp file leaks. */
	cleanup(): void
}

/**
 * Write a map of relative-path → content into a fresh OS-temp directory — the REAL on-disk fixture
 * the `createStatic` tests serve (no mock FS — AGENTS §16). Each key is a forward-slash relative path
 * (parent directories are created); each value is the file's text or raw bytes (a `Buffer`, for a
 * binary asset whose exact length the Range / Content-Length assertions rely on). Returns the temp
 * `root` + a `cleanup` thunk (call it in `afterEach`). Mirrors {@link tempDatabasePath}, generalized
 * to a tree of files (AGENTS §16.1).
 *
 * @param files - A `{ 'relative/path': content }` map; `content` is a UTF-8 string or a `Buffer`
 * @returns The {@link StaticFixtureInterface} — the served `root` + its `cleanup`
 */
export function createStaticFixture(
	files: Readonly<Record<string, string | Buffer>>,
): StaticFixtureInterface {
	const root = mkdtempSync(join(tmpdir(), 'taverna-static-'))
	for (const [relativePath, content] of Object.entries(files)) {
		const full = join(root, relativePath)
		mkdirSync(dirname(full), { recursive: true })
		writeFileSync(full, content)
	}
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	}
}

/** A temp-dir fixture for the multipart-upload tests — its staging `path`, a live file lister, and a `cleanup` thunk. */
export interface UploadDirectoryInterface {
	/** The temp directory's absolute path — pass it as `createMultipart`'s `directory`. */
	readonly path: string
	/** The names of the files CURRENTLY staged in the directory — assert `[]` to prove no temp leak. */
	files(): readonly string[]
	/** Remove the whole temp directory; call in `afterEach` so no temp file leaks. */
	cleanup(): void
}

/**
 * Make a fresh OS-temp directory for the multipart tests to STAGE uploads into — the real on-disk
 * staging area (no mock FS — AGENTS §16). `files()` lists what is currently staged (so a leak / clean
 * is asserted directly), and `cleanup()` removes the tree in `afterEach`. Mirrors {@link
 * createStaticFixture} / {@link tempDatabasePath} (§16.1).
 *
 * @returns The {@link UploadDirectoryInterface} — the staging `path` + `files()` lister + `cleanup`
 */
export function createUploadDirectory(): UploadDirectoryInterface {
	const path = mkdtempSync(join(tmpdir(), 'taverna-upload-'))
	return {
		path,
		files: () => readdirSync(path),
		cleanup: () => rmSync(path, { recursive: true, force: true }),
	}
}

/** One part of a hand-built multipart body — a `name` (form field), optional `filename` (⇒ a file part), optional `type` (`Content-Type`), and raw `data` bytes. */
export interface MultipartPartInput {
	readonly name: string
	readonly filename?: string
	readonly type?: string
	readonly data: string | Buffer
}

/**
 * Hand-build a raw `multipart/form-data` body `Buffer` for a given `boundary` — the precise-bytes
 * fixture the malformed-body + disconnect + raw-stream tests feed (where a real `FormData` can't
 * express a TRUNCATED / hand-crafted body). Each part writes its `Content-Disposition` (+ `filename`
 * / `Content-Type` when given) then its raw `data`; the body is terminated by the closing boundary.
 *
 * @remarks
 * A well-formed body uses the global `FormData` + `fetch` instead (a real browser-shaped multipart
 * request); this builder is for the cases that need exact / broken bytes. Returns the assembled
 * `Buffer` (feed it to a raw `http.request`, or slice it to simulate a truncated upload).
 *
 * @param boundary - The boundary token (the same one passed in the `Content-Type` header)
 * @param parts - The parts to encode (field + file parts)
 * @returns The raw multipart body bytes
 */
export function buildMultipart(boundary: string, parts: readonly MultipartPartInput[]): Buffer {
	const chunks: Buffer[] = []
	for (const part of parts) {
		const disposition =
			part.filename === undefined
				? `Content-Disposition: form-data; name="${part.name}"`
				: `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`
		const type = part.type === undefined ? '' : `\r\nContent-Type: ${part.type}`
		chunks.push(Buffer.from(`--${boundary}\r\n${disposition}${type}\r\n\r\n`))
		chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data))
		chunks.push(Buffer.from('\r\n'))
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`))
	return Buffer.concat(chunks)
}

/**
 * POST a raw body to a URL over a real `node:http` request, then DESTROY the socket after `bytes` of
 * the body have been written — the deterministic mid-upload CLIENT DISCONNECT the multipart cleanup
 * test needs (a `fetch` can't be torn down mid-stream as precisely). Resolves once the socket is
 * destroyed (the server then observes the disconnect and cleans its staged temp files).
 *
 * @param url - The absolute URL to POST to
 * @param type - The `Content-Type` header (a `multipart/form-data; boundary=…`)
 * @param body - The full body bytes (only the first `bytes` are written before the abort)
 * @param bytes - How many leading bytes of `body` to write before destroying the socket
 * @returns Resolves after the request socket is destroyed mid-body
 */
export function abortMidUpload(
	url: string,
	type: string,
	body: Buffer,
	bytes: number,
): Promise<void> {
	return new Promise<void>((resolve) => {
		const target = new URL(url)
		const request = httpRequest(
			{
				hostname: target.hostname,
				port: target.port,
				path: target.pathname,
				method: 'POST',
				// Declare the FULL length so the server keeps reading (and stays mid-parse) until we cut it.
				headers: { 'content-type': type, 'content-length': String(body.length) },
			},
			() => undefined,
		)
		request.on('error', () => resolve()) // the destroy surfaces as a socket error — expected
		request.write(body.subarray(0, bytes), () => {
			// Bytes are on the wire + the server is mid-parse; cut the connection.
			request.destroy()
			resolve()
		})
	})
}

// Run `action`, returning a thrown `SQLiteError`'s `code` (or a sentinel) — so an
// error code is asserted unconditionally, never inside a conditional `expect`.
// Shared by the SQLite wrapper and driver tests that branch on a fault's code.
export function sqliteErrorCode(action: () => unknown): string {
	try {
		action()
		return 'NO_THROW'
	} catch (error) {
		return isSQLiteError(error) ? error.code : 'NOT_SQLITE_ERROR'
	}
}

// ── SQLite ↔ engine parity scenario (node-only) ──────────────────────────────
//
// The shared fixture behind the native ↔ engine parity safety net: SQLiteDriver's
// native `records` / `count` (Criteria → SQL) must return results IDENTICAL to the
// core engine path (MemoryDriver, which falls back to `applyCriteria` over `scan`)
// over the same data. Node-only because it stands up a real `createSQLiteDriver`
// backend; the comparator is fed query builders by the parity test.

/** The columns for the parity scenario — one of each comparable type plus a json `payload`. */
export const PARITY_TABLES = {
	users: {
		id: stringShape(),
		name: stringShape(),
		age: integerShape(),
		active: booleanShape(),
		payload: objectShape({
			tag: stringShape(),
			score: integerShape(),
			flag: booleanShape(),
			note: nullableShape(stringShape()),
		}),
	},
} as const

/** A row of {@link PARITY_TABLES}` users` — the static type the parity builders see. */
export type ParityUser = {
	readonly id: string
	readonly name: string
	readonly age: number
	readonly active: boolean
	readonly payload: {
		readonly tag: string
		readonly score: number
		readonly flag: boolean
		readonly note: string | null
	}
}

/**
 * The seed rows for the parity scenario — typed columns so ordering agrees between
 * backends; `tag` values carry LIKE wildcards (`%` / `_`) and `note` mixes present
 * strings with JSON `null`, so the escape and present-but-null paths are exercised.
 *
 * @remarks
 * Deliberately listed OUT of primary-key order (`u3, u6, u1, u2, u5, u4`), so the
 * backends are seeded non-monotonically. An unordered `.all()` / `count` then
 * genuinely proves BOTH the native backend and the core engine return rows in KEY
 * order (`u1`…`u6`) rather than insertion order — the key-order contract every
 * `DriverInterface` honors. The `age = 36` TIE (`u1` / `u6`) is seeded
 * KEY-DESCENDING (`u6` before `u1`), so insertion order disagrees with key order on
 * the tie: an `.ascending('age')` read then proves the tie resolves in KEY order on
 * both backends — it would FAIL if SQLiteDriver broke ties by rowid (insertion)
 * instead of appending the primary-key tie-breaker. Reordering this list changes
 * only the insertion order; the row content and count (6) the assertions rely on
 * are unchanged.
 */
export const PARITY_ROWS: readonly ParityUser[] = [
	{
		id: 'u3',
		name: 'Edsger',
		age: 50,
		active: true,
		payload: { tag: 'blue_z', score: 30, flag: true, note: 'third' },
	},
	{
		id: 'u6',
		name: 'Brenda',
		age: 36,
		active: false,
		payload: { tag: 'red%y', score: 25, flag: false, note: null },
	},
	{
		id: 'u1',
		name: 'Ada',
		age: 36,
		active: true,
		payload: { tag: 'red_x', score: 10, flag: true, note: 'first' },
	},
	{
		id: 'u2',
		name: 'Alan',
		age: 41,
		active: false,
		payload: { tag: 'red%y', score: 20, flag: false, note: null },
	},
	{
		id: 'u5',
		name: 'Bob',
		age: 22,
		active: true,
		payload: { tag: 'redish', score: 50, flag: true, note: 'fifth' },
	},
	{
		id: 'u4',
		name: 'Grace',
		age: 45,
		active: false,
		payload: { tag: 'green', score: 40, flag: false, note: null },
	},
]

/** One backend's side of a parity comparison — a query's rows and its count. */
export interface ParityOutcome {
	readonly rows: readonly ParityUser[]
	readonly count: number
}

/** A parity comparator — runs one query builder against both backends. */
export type ParityComparator = (
	build: (table: TableInterface<ParityUser>) => QueryInterface<ParityUser>,
) => Promise<{ readonly native: ParityOutcome; readonly engine: ParityOutcome }>

/**
 * An aggregate parity comparator — runs one aggregate (over a column, optionally
 * scoped by a query builder's WHERE) against both backends and returns each side's
 * result. The native side hits {@link SQLiteDriver}'s SQL `COUNT`/`SUM`/`AVG`/`MIN`/
 * `MAX`; the engine side runs `computeAggregate` over the {@link MemoryDriver}'s scan
 * (no `aggregate?` hook) — a single `expect` asserts they are identical.
 *
 * @param operation - The aggregate to compute
 * @param column - The column (or nested path) to aggregate
 * @param scope - Optional query builder scoping the rows by a WHERE clause; omit for
 *   the whole table
 * @returns The two backends' aggregate values, side by side
 */
export type ParityAggregator = (
	operation: AggregateFunction,
	column: FieldPath,
	scope?: (table: TableInterface<ParityUser>) => QueryInterface<ParityUser>,
) => Promise<{ readonly native: number | undefined; readonly engine: number | undefined }>

/**
 * Stand up the parity scenario: a SQLite-backed (native) and a Memory-backed
 * (engine) database over {@link PARITY_TABLES}, each seeded with {@link PARITY_ROWS},
 * and two comparators — `parity` runs one query builder against both and returns
 * their `all()` rows and `count()` side by side; `aggregate` runs one aggregate
 * against both — so a single call-site `expect` asserts each pair is identical. Each
 * comparison gets a fresh table handle so chains don't leak.
 *
 * @returns The `parity` and `aggregate` comparators over the two seeded backends
 */
export async function setupParity(): Promise<{
	readonly parity: ParityComparator
	readonly aggregate: ParityAggregator
}> {
	const sqlite: DatabaseInterface<typeof PARITY_TABLES> = createDatabase({
		driver: createSQLiteDriver(),
		tables: PARITY_TABLES,
	})
	const memory: DatabaseInterface<typeof PARITY_TABLES> = createDatabase({
		driver: createMemoryDriver(),
		tables: PARITY_TABLES,
	})
	await sqlite.table('users').set([...PARITY_ROWS])
	await memory.table('users').set([...PARITY_ROWS])
	const parity: ParityComparator = async (build) => ({
		native: {
			rows: await build(sqlite.table('users')).all(),
			count: await build(sqlite.table('users')).count(),
		},
		engine: {
			rows: await build(memory.table('users')).all(),
			count: await build(memory.table('users')).count(),
		},
	})
	const aggregate: ParityAggregator = async (operation, column, scope) => ({
		native: await (scope ? scope(sqlite.table('users')) : sqlite.table('users').query()).aggregate(
			operation,
			column,
		),
		engine: await (scope ? scope(memory.table('users')) : memory.table('users').query()).aggregate(
			operation,
			column,
		),
	})
	return { parity, aggregate }
}

// ── Driver-conformance schema (the JSON / SQLite driver batteries) ───────────
//
// AGENTS §16.1: the `const SCHEMA: readonly TableSchema[]` the JSONDriver and SQLiteDriver
// conformance tests declared VERBATIM — a `users` table (one of each codec-relevant column
// type: text `id` / `name`, an `integer` `age`, a `boolean` `active`, a nullable `json`
// `meta`) plus a non-`id`-primary `posts` table (proving the key is recovered from each
// table's own primary column) — folded into one factory. The two suites differ ONLY in the
// `users` table's secondary `indexes` (JSONDriver declares `[['name']]`; SQLiteDriver also
// builds a composite `['age', 'name']`), so that one set is the sole parameter. The
// `factories` test's trimmed users-only, two-column variant is a DIFFERENT shape and stays
// local there.

/**
 * Build the shared driver-conformance schema the JSON / SQLite `DriverInterface` batteries
 * run against (AGENTS §16.1) — a `users` table carrying one of each codec-relevant column
 * type (text, `integer`, `boolean`, a nullable `json`) and a `posts` table keyed by a
 * non-`id` primary column (`slug`), so each driver test proves the same CRUD / key-order /
 * snapshot / codec contract. The `users` table's secondary `indexes` are the only thing the
 * two suites vary — the SQLite battery additionally exercises a composite index — so they are
 * the sole parameter; everything else (columns, primaries, the `posts` table) is fixed.
 *
 * @param options - `indexes` parameterizes the `users` table's secondary index set (each
 *   inner array is one index's column list); defaults to `[['name']]` (the JSON battery's set).
 *   The `posts` table is always unindexed.
 * @returns The two-table schema (`users` + `posts`)
 */
export function driverSchema(options?: {
	indexes?: readonly (readonly string[])[]
}): readonly TableSchema[] {
	return [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', type: 'text', nullable: false },
				{ name: 'name', type: 'text', nullable: false },
				{ name: 'age', type: 'integer', nullable: false },
				{ name: 'active', type: 'boolean', nullable: false },
				{ name: 'meta', type: 'json', nullable: true },
			],
			indexes: options?.indexes ?? [['name']],
		},
		{
			name: 'posts',
			primary: 'slug',
			columns: [
				{ name: 'slug', type: 'text', nullable: false },
				{ name: 'title', type: 'text', nullable: false },
			],
			indexes: [],
		},
	]
}

// ── Teardown registrar (tracked-resource cleanup) ────────────────────────────
//
// AGENTS §16.1: the duplicated `const tracked = []` + `afterEach(dispose-all)` +
// `track(item)` trio every node-resource suite hand-rolls — the started-server `stop()`
// form (Server / http-helpers / mcp-factories) and the worker `destroy()` form
// (workers/helpers) — folded into one registrar. The caller supplies the disposer
// (`h => h.stop()` or `w => w.destroy()`); the registrar holds the tracked list AND wires
// its OWN `afterEach` to dispose every tracked item (awaiting async disposers), so no
// socket / thread leaks across a suite. A real cleanup wiring, not a mock.

/** A tracked-resource teardown registrar — see {@link createTeardown}. */
export interface TeardownInterface<T> {
	/** Register `item` for disposal at `afterEach`, returning it for inline use. */
	track<U extends T>(item: U): U
}

/**
 * Create a {@link TeardownInterface} that disposes every tracked item after each test —
 * the one general form of the `tracked[]` + `afterEach` + `track` pattern the server
 * suites repeat (AGENTS §16.1). Call it at a suite's top level: it registers its OWN
 * `afterEach` immediately, draining the tracked list and running `dispose` on each item
 * (awaiting a returned promise), so a started server is `stop()`ed and a worker
 * `destroy()`ed even when an assertion throws mid-test. The disposer is the caller's
 * (`(handle) => handle.stop()` / `(worker) => worker.destroy()`), so the registrar stays
 * agnostic to what it tears down.
 *
 * @typeParam T - The kind of item tracked (the disposer's parameter type)
 * @param dispose - How to dispose one tracked item (may be async)
 * @returns A registrar whose `track` enrolls an item and returns it
 */
export function createTeardown<T>(
	dispose: (item: T) => void | Promise<void>,
): TeardownInterface<T> {
	const tracked: T[] = []
	afterEach(async () => {
		for (const item of tracked.splice(0)) await dispose(item)
	})
	return {
		track(item) {
			tracked.push(item)
			return item
		},
	}
}

// ── HTTP spine test harness (node-only, real `node:http`) ────────────────────
//
// AGENTS §16.1: the started-server fixture the http-spine tests share lives here,
// not duplicated per file. Each test starts a REAL server on an ephemeral port and
// drives it with the global `fetch` over a real socket — no mocking (§16). The
// returned handle carries the bound base URL plus a `stop` thunk every test calls in
// `afterEach` so no listener leaks across files.

/** A started test server — its bound `base` URL plus the {@link ServerInterface}. */
export interface StartedServerInterface {
	readonly server: ServerInterface
	readonly port: number
	readonly base: string
	stop(): Promise<void>
}

/**
 * Start a {@link ServerInterface} on an ephemeral port and resolve its bound base
 * URL — the shared harness for the real-`node:http` spine tests.
 *
 * @remarks
 * Awaits `server.start()` (binding `127.0.0.1:<ephemeral>`) and returns the handle.
 * Call `stop()` in `afterEach` (it gracefully stops then `destroy`s, so a wedged
 * drain still tears the socket down — no leaked listener hangs the runner).
 *
 * @param server - The server to start (already configured with routes / middleware)
 * @returns The started-server handle (`base` URL + `stop`)
 */
export async function startServer(server: ServerInterface): Promise<StartedServerInterface> {
	const port = await server.start()
	return {
		server,
		port,
		base: `http://127.0.0.1:${port}`,
		async stop() {
			await server.stop()
			await server.destroy()
		},
	}
}

// ── Cookie round-trip helpers (the cookie-session + CSRF tests) ──────────────
//
// AGENTS §16.1: the cookie-borne session / CSRF tests echo a `Set-Cookie` value back as
// a `Cookie` request header across requests; folded into shared helpers (both the cookie
// session and the CSRF suite repeat the extract-then-resend dance). A real `fetch`
// exchange over a real server — no mock (§16).

/**
 * Extract one cookie's raw VALUE from a `fetch` Response's `Set-Cookie` header(s) — the
 * `name=<value>` pair (attributes after the first `;` stripped), or `undefined` when the
 * named cookie was not set.
 *
 * @remarks
 * Reads every `Set-Cookie` (node's `Headers.getSetCookie()` returns the un-joined array, so
 * a response setting several cookies — an id cookie + a CSRF cookie — is handled) and returns
 * the matching cookie's value. The value is left URL-ENCODED exactly as the wire carries it, so
 * it round-trips byte-for-byte when resent via {@link cookieHeader}.
 *
 * @param response - The `fetch` Response to read `Set-Cookie` from
 * @param name - The cookie name to extract
 * @returns The cookie's (wire-encoded) value, or `undefined` if not present
 */
export function readSetCookie(response: Response, name: string): string | undefined {
	for (const entry of response.headers.getSetCookie()) {
		const pair = entry.split(';', 1)[0] ?? ''
		const eq = pair.indexOf('=')
		if (eq < 0) continue
		if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim()
	}
	return undefined
}

/**
 * Build a `Cookie` request-header record echoing one cookie back — the inverse of {@link
 * readSetCookie} for the next request in a session round-trip.
 *
 * @param name - The cookie name
 * @param value - The (wire-encoded) cookie value from {@link readSetCookie}; `undefined` ⇒ an
 *   empty header set (the no-cookie case, so a test can call it unconditionally)
 * @returns A `{ cookie }` headers record (empty when `value` is `undefined`)
 */
export function cookieHeader(name: string, value: string | undefined): Record<string, string> {
	return value === undefined ? {} : { cookie: `${name}=${value}` }
}

/**
 * Build a `Cookie` request-header record echoing SEVERAL cookies back on one request — the n-cookie
 * generalization of {@link cookieHeader} for the tests that must present more than one cookie at once
 * (the CSRF + cookie-session round-trip carries BOTH a `session` and a `csrf` cookie, the shape a
 * real browser sends; the single-cookie {@link cookieHeader} can't express it). AGENTS §16.1.
 *
 * @remarks
 * Each `name=value` pair is joined with `; ` into the one `Cookie` header (the wire format). Values
 * are written verbatim (already wire-encoded, e.g. from {@link readSetCookie}). An empty `pairs` map
 * yields an empty header set, so a test can call it unconditionally.
 *
 * @param pairs - A `{ name: value }` map of cookies to send (e.g. `{ session, csrf }`)
 * @returns A `{ cookie }` headers record joining every pair (empty when `pairs` is empty)
 */
export function cookiesHeader(pairs: Readonly<Record<string, string>>): Record<string, string> {
	const entries = Object.entries(pairs)
	if (entries.length === 0) return {}
	return { cookie: entries.map(([name, value]) => `${name}=${value}`).join('; ') }
}

// ── Durable session value factory (the SessionStore TTL batteries) ───────────
//
// AGENTS §16.1: a PLAIN durable-session value (an `id` + a serializable `data` bag) — the honest
// shape a durable store persists (plain DATA, never the default `Session` CLASS whose `#`-private
// `id` a JSON / structured-clone round-trip strips). The Memory and Database `SessionStore` TTL
// suites both seed session values for the SAME idle-TTL battery (the DB suite mirrors the memory
// one "ONE-FOR-ONE"); the shared VALUE factory lives here so neither re-rolls it. (The batteries
// themselves stay local — the memory store returns the same `Session` INSTANCE asserted with `toBe`
// identity, the DB store a CLONED record asserted with `toEqual`, so the assertion bodies genuinely
// differ and a shared battery driver would not be byte-identical.)

/** A plain, durable `SessionInterface` value — an `id` plus a serializable `data` bag (no behavior). */
export interface StoredSession extends SessionInterface {
	readonly data: Readonly<Record<string, unknown>>
}

/**
 * Build a plain {@link StoredSession} value — the durable-session data factory the `SessionStore`
 * tests seed (AGENTS §16.1). A real value, not a mock (§16): an `id` plus an optional `data` bag so
 * the round-trip through a store's opaque JSON column is non-vacuous.
 *
 * @param id - The session id (its own key — the store keys off `session.id`, no separate id param)
 * @param data - The serializable session state (default `{}`)
 * @returns The plain durable-session value
 */
export function buildSession(
	id: string,
	data: Readonly<Record<string, unknown>> = {},
): StoredSession {
	return { id, data }
}

// ── Raw HTTP upgrade driver (the spine's upgrade-seam tests) ─────────────────
//
// AGENTS §16.1: the `Server.upgrade(...)` seam tests drive a REAL `node:http` protocol
// upgrade — a client request with `Connection: Upgrade` + `Upgrade: websocket` headers —
// and observe whether the server CLAIMED the socket (it answered `101` and the client's
// `'upgrade'` event fired) or DECLINED it (the spine destroyed the socket, so the client
// request errors / the socket closes with no response). Folded into one helper since
// every upgrade-seam test repeats it. A real socket exchange, no mock (§16).

/** The outcome of an {@link upgradeRequest} — whether the server claimed the upgrade. */
export interface UpgradeOutcome {
	/** `true` when the server answered `101 Switching Protocols` (a handler claimed the socket). */
	readonly claimed: boolean
	/** The `101` status when claimed, else `undefined` (the socket was destroyed un-upgraded). */
	readonly status: number | undefined
}

/**
 * Drive a real `node:http` protocol upgrade against `base` + `path` and resolve the
 * {@link UpgradeOutcome} — the shared upgrade-seam driver (AGENTS §16.1).
 *
 * @remarks
 * Sends `Connection: Upgrade` + `Upgrade: websocket` (plus any extra `headers`, e.g. a
 * `Sec-WebSocket-Key`) and waits for the exchange to settle. If a registered handler
 * CLAIMS the socket and answers `101`, the client's `'upgrade'` event fires →
 * `{ claimed: true, status: 101 }` (the client socket is destroyed to free it). If NO
 * handler claims it, the spine `socket.destroy()`s the un-upgraded connection, so the
 * client request emits `'error'` (or the socket closes) → `{ claimed: false }`. It is
 * TOTAL — the declined path is an expected outcome, never a rejection — so a test
 * asserts on the resolved shape unconditionally.
 *
 * @param base - The server's bound base URL (e.g. `http://127.0.0.1:<port>`)
 * @param path - The request path to upgrade (defaults to `'/'`)
 * @param headers - Extra request headers merged over the upgrade headers
 * @returns The {@link UpgradeOutcome}
 */
export function upgradeRequest(
	base: string,
	path = '/',
	headers?: Record<string, string>,
): Promise<UpgradeOutcome> {
	return new Promise<UpgradeOutcome>((resolve) => {
		let settled = false
		const finish = (outcome: UpgradeOutcome): void => {
			if (settled) return
			settled = true
			resolve(outcome)
		}
		const request = httpRequest(`${base}${path}`, {
			headers: { Connection: 'Upgrade', Upgrade: 'websocket', ...headers },
		})
		// The server claimed it: it sent `101` and the socket is now the handler's. Read
		// nothing — just free the client end and report the claim.
		request.on('upgrade', (response, socket) => {
			socket.destroy()
			finish({ claimed: true, status: response.statusCode })
		})
		// The server declined: it destroyed the un-upgraded socket, so the request errors
		// (a socket hang-up) — an expected, non-fatal outcome of the decline path.
		request.on('error', () => finish({ claimed: false, status: undefined }))
		// A plain (non-101) response would also mean no upgrade happened.
		request.on('response', (response) => {
			response.resume()
			finish({ claimed: false, status: response.statusCode })
		})
		request.end()
	})
}

// ── Raw HTTP response reader (the compression seam tests) ────────────────────
//
// AGENTS §16.1: the `createCompression` tests must inspect the RAW (undecoded) response bytes to
// prove the body was actually compressed on the wire — but `fetch` (undici) transparently
// decompresses a `Content-Encoding` body, so it can never observe the compressed size. This helper
// drives a real `node:http` GET (which does NOT auto-decompress) and returns the raw bytes + headers,
// so a test asserts the compressed length + decodes it itself. A real socket exchange, no mock (§16).

/** A raw `node:http` response — the undecoded body bytes + status + headers (the compression proof). */
export interface RawResponse {
	readonly status: number | undefined
	readonly headers: IncomingMessage['headers']
	readonly body: Buffer
}

/**
 * Drive a real `node:http` GET against `base` + `path` and resolve the RAW (undecoded) response —
 * the compression-seam wire reader (AGENTS §16.1).
 *
 * @remarks
 * Unlike `fetch`, `node:http` does NOT transparently decompress a `Content-Encoding` body, so the
 * resolved `body` is the exact bytes on the wire — a test asserts the compressed length and decodes
 * it with `node:zlib` itself. Send the desired `Accept-Encoding` (and any other headers) via
 * `headers`. Resolves once the full body is read.
 *
 * @param base - The server's bound base URL (e.g. `http://127.0.0.1:<port>`)
 * @param path - The request path (defaults to `'/'`)
 * @param headers - Request headers (e.g. `{ 'accept-encoding': 'gzip' }`)
 * @returns The {@link RawResponse} — `status` + `headers` + the raw `body` buffer
 */
export function readRawResponse(
	base: string,
	path = '/',
	headers?: Record<string, string>,
): Promise<RawResponse> {
	return new Promise<RawResponse>((resolve, reject) => {
		const request = httpRequest(`${base}${path}`, { headers }, (response) => {
			const chunks: Buffer[] = []
			response.on('data', (chunk: Buffer) => chunks.push(chunk))
			response.on('end', () =>
				resolve({
					status: response.statusCode,
					headers: response.headers,
					body: Buffer.concat(chunks),
				}),
			)
			response.on('error', reject)
		})
		request.on('error', reject)
		request.end()
	})
}

// ── Stand-in upstream server (the S2 proxy consumer pattern) ─────────────────
//
// AGENTS §16.1: the token-guard tests prove the S2 proxy pattern — a guarded route
// forwards to a "real LLM" upstream, injecting the real key server-side — WITHOUT a
// live model, by standing up a SECOND local `node:http` server as the stand-in
// upstream. This fixture is that canned upstream: a real server that answers any
// request with a fixed JSON body and CAPTURES each request's method + path + headers
// + parsed JSON body, so a test can assert the proxy injected its server-side key and
// that an unauthenticated request never reached the upstream. Shared here (not
// per-file) since both the deterministic proxy test and the live S2 proxy reuse the
// "canned upstream" scaffold. Each test `close()`s it in `afterEach`.

/** One request the {@link UpstreamInterface} stand-in captured. */
export interface UpstreamRequest {
	readonly method: string
	readonly path: string
	/** Every request header (node lower-cases the names) — assert the injected server-side key landed. */
	readonly headers: Readonly<Record<string, string>>
	/** The parsed JSON request body (`{}` for an empty / unparseable body — best-effort, never throws). */
	readonly body: Record<string, unknown>
}

/** A running stand-in upstream — its base `url`, the requests it `captured`, and `close`. */
export interface UpstreamInterface {
	readonly url: string
	readonly captured: readonly UpstreamRequest[]
	close(): Promise<void>
}

/**
 * Start a stand-in "upstream model" server on an ephemeral port that answers EVERY
 * request with the given canned JSON `body`, capturing each request for assertion —
 * the upstream half of the S2 proxy consumer pattern.
 *
 * @remarks
 * A real `node:http` server (no mock — AGENTS §16): the proxy route under a token
 * guard `fetch`es it (injecting a server-side header), and the test asserts a valid
 * token round-trips this `body` to the client while an invalid token never reaches it
 * (the capture stays empty). Mirrors the Ollama-project `startOllamaStub` shape, one
 * level generic (any path, any body).
 *
 * @param body - The canned JSON value every request is answered with
 * @returns The running {@link UpstreamInterface} — its `url`, `captured` requests, and `close`
 */
export async function startUpstream(body: unknown): Promise<UpstreamInterface> {
	const captured: UpstreamRequest[] = []
	const server = createHTTPServer((request, response) => {
		void (async () => {
			// Reuse the http module's body seam (collectBody → decodeBody) rather than a
			// bespoke parser — `collectBody(request, 0)` drains unbounded (a non-positive
			// limit), `decodeBody` JSON-parses an `application/json` body, then `isRecord`
			// narrows to the captured record (`{}` for a non-record / empty body). The proxy
			// sends known-good JSON, so decodeBody's throw-on-malformed never trips (§14).
			const buffer = await collectBody(request, 0)
			const decoded = decodeBody(buffer, contentType(request))
			captured.push({
				method: request.method ?? '',
				path: request.url ?? '',
				headers: flattenHeaders(request.headers),
				body: isRecord(decoded) ? { ...decoded } : {},
			})
			response.setHeader('Content-Type', 'application/json')
			response.end(JSON.stringify(body))
		})()
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address: unknown = server.address()
	const port = isRecord(address) && typeof address.port === 'number' ? address.port : 0
	return {
		url: `http://127.0.0.1:${port}`,
		get captured() {
			return captured
		},
		close() {
			return new Promise<void>((resolve, reject) => {
				server.close((error) => (error === undefined ? resolve() : reject(error)))
			})
		},
	}
}

// ── Canonical MCP server fixture (the calculator over a ToolManager) ─────────
//
// AGENTS §16.1: the `mcpServer()` factory the MCP transport / middleware / session tests
// repeated VERBATIM (byte-identical in mcp/factories, mcp/middlewares, and
// mcp/transports/WebSocketClientTransport) — a REAL {@link MCPServerInterface} over a REAL
// `ToolManager` carrying the canonical `add` stub (returns 5) plus a `boom` tool that throws
// `'kaboom'` (→ an `isError: true` in-band result), so every transport e2e proves BOTH a value
// round-trip and the tool-error path WITHOUT a live model (§16) — folded into one factory. The
// HTTP-client transport's RICHER `remote` variant (a structured `add` + a `greet` string + a
// `'remote kaboom'` `boom`, named `remote`) stays LOCAL there: its tool set, identity, AND error
// message all differ, so parameterizing would obscure more than it dedupes.

/**
 * Build the canonical calculator {@link MCPServerInterface} the MCP transport tests share — a REAL
 * server (`name: 'calculator'`, `version: '1.0.0'`) over a REAL `ToolManager` carrying the canonical
 * `add` stub (returns 5) plus a `boom` tool that throws `'kaboom'`, so a `tools/call` proves both a
 * value round-trip and the tool-error → `isError: true` in-band result (AGENTS §16.1). No mocks, no
 * live model — the one general form of the three byte-identical `mcpServer()` locals.
 *
 * @returns The running {@link MCPServerInterface} over the `add` + `boom` registry
 */
export function createCalculatorServer(): MCPServerInterface {
	const tools = createToolManager()
	tools.add(addTool())
	tools.add(
		createTool({
			name: 'boom',
			execute: () => {
				throw new Error('kaboom')
			},
		}),
	)
	return createMCPServer({ name: 'calculator', version: '1.0.0', tools })
}

// ── JSON POST helper (the MCP transport driver) ──────────────────────────────
//
// AGENTS §16.1: the `fetch` wrapper the MCP-over-HTTP tests repeat — POST a JSON body
// with the `application/json` content type to the transport path — folded into one helper
// (the deterministic mcp-factories test and the live ollama mcp test both hand-roll it).

/**
 * POST `body` as a JSON request to `base` + `path` and resolve the `fetch` Response — the
 * shared MCP-transport driver (AGENTS §16.1). Sets `content-type: application/json` (the
 * caller's `headers` merge on top, so a test can add an `Accept` / `Authorization`),
 * `JSON.stringify`s the body, and defaults `path` to `'/mcp'`.
 *
 * @param base - The server's bound base URL (e.g. `http://127.0.0.1:<port>`)
 * @param body - The JSON-RPC message (or any value) to send as the request body
 * @param options - Optional `headers` (merged over the JSON content type) and `path`
 *   (defaults to `'/mcp'`)
 * @returns The `fetch` Response
 */
export function postJSON(
	base: string,
	body: unknown,
	options?: { headers?: Record<string, string>; path?: string },
): Promise<Response> {
	return fetch(`${base}${options?.path ?? '/mcp'}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...options?.headers },
		body: JSON.stringify(body),
	})
}

// ── HTTP request / context stubs (the §14 boundary-narrowing pattern) ────────
//
// AGENTS §16.1: the minimal `IncomingMessage` and `RouteHandlerContextInterface` stubs the
// pure http / mcp helper tests build — each only carries the fields the reader under test
// touches, and crosses into its typed parameter through a STRUCTURAL GUARD (never an `as`,
// §14). Consolidated here from the per-file `requestStub` / `fakeContext` / `contextStub`
// locals so the one full default shape serves every reader (parseURL / requestMethod /
// contentType / flattenHeaders read the request; the middleware chain and acceptsEventStream
// / resolveClientKey read the context), with per-test overrides for the bit that matters.

/**
 * A structural guard narrowing an `unknown` stub to {@link
 * import('node:http').IncomingMessage} — the readers only read `url` / `method` / `headers`
 * (and, for the peer IP, `socket`), so a partial shape carrying `headers` crosses the
 * boundary through this guard with no assertion (AGENTS §14).
 *
 * @param value - The candidate stub
 * @returns Whether `value` is shaped enough to stand in for an `IncomingMessage`
 */
export function isIncomingMessage(value: unknown): value is IncomingMessage {
	return typeof value === 'object' && value !== null && 'headers' in value
}

/**
 * Build a minimal `node:http`-shaped request stub for the pure request readers (AGENTS
 * §16.1) — only the fields each reader touches, defaulting `headers` / `socket` to empty so
 * `flattenHeaders` / `contentType` / `parseURL` / `requestMethod` and the peer-IP read all
 * have something to read. Crosses into the `IncomingMessage` parameter through {@link
 * isIncomingMessage} (no `as`, §14). The senders + body collection are covered live against
 * a real server, not this stub.
 *
 * @param fields - The request fields to set (`url` / `method` / `headers` / `socket`); each
 *   omitted field falls back to a sensible empty default
 * @returns The narrowed `IncomingMessage` stub
 */
export function createRequestStub(fields?: {
	url?: string
	method?: string
	headers?: Record<string, string | string[] | undefined>
	socket?: { remoteAddress?: string; encrypted?: boolean }
}): IncomingMessage {
	const stub: unknown = {
		url: fields?.url,
		method: fields?.method,
		headers: fields?.headers ?? {},
		socket: fields?.socket ?? {},
	}
	if (!isIncomingMessage(stub)) throw new Error('unreachable: request stub shape')
	return stub
}

/**
 * A structural guard narrowing an `unknown` stub to {@link RouteHandlerContextInterface} —
 * the consumers read only a subset (`state`, `request`, `params` / `query`, the response
 * helpers), so a stub carrying `state` and `request` crosses the boundary through this
 * guard with no assertion (AGENTS §14).
 *
 * @param value - The candidate stub
 * @returns Whether `value` is shaped enough to stand in for a route-handler context
 */
export function isRouteContext(value: unknown): value is RouteHandlerContextInterface {
	return typeof value === 'object' && value !== null && 'state' in value && 'request' in value
}

/**
 * Build a {@link RouteHandlerContextInterface} stub with a real full default shape
 * (`state` / `query` / `params` / `request` + the `body` / `json` / `text` / `empty` /
 * `error` helpers) plus per-test overrides, crossing into the parameter through {@link
 * isRouteContext} (no `as`, §14). The single context stub behind the middleware-chain,
 * `acceptsEventStream`, and `resolveClientKey` tests (AGENTS §16.1): each overrides only
 * what it reads — the MCP transport passes a `request` carrying an `Accept` header
 * (`{ request: createRequestStub({ headers: { accept } }) }`), the rate-limit key reads
 * `state` / `request.socket`. The helper methods are inert no-ops (the chain only threads
 * the context through; a test asserting a sent response uses a real server instead).
 *
 * @param overrides - Fields to override on the default context (any subset of the interface)
 * @returns The narrowed route-handler context stub
 */
export function createContextStub(
	overrides?: Partial<RouteHandlerContextInterface>,
): RouteHandlerContextInterface {
	const stub: unknown = {
		state: new Map<string, unknown>(),
		query: new URLSearchParams(),
		params: {},
		request: createRequestStub(),
		body: () => Promise.resolve(undefined),
		json: () => {},
		text: () => {},
		empty: () => {},
		error: () => {},
		...overrides,
	}
	if (!isRouteContext(stub)) throw new Error('unreachable: context stub shape')
	return stub
}

// ── In-memory WebSocket Duplex pair (the RFC 6455 wire + transport tests) ─────
//
// AGENTS §16.1: the cross-wired in-memory `node:stream` Duplex PAIR the WebSocket wrapper
// and its MCP transport tests drive — a REAL bidirectional socket (two PassThroughs, one
// per direction), NOT a mock (§16) — folded into one shared harness. The wrapper test
// (NodeWebSocket) and the transport test (WebSocketServerTransport) both stand up the same
// pair, so it lives here. `duplexPair` makes a `[server, client]`; `flushSocket` waits for
// synchronous frame writes to propagate across the pair; `readClientFrames` is the inverse
// of what a server writes (strip the 101 handshake, then decode every complete frame off the
// running buffer); `createClientWebSocket` wraps the client end as a CLIENT-mode
// NodeWebSocket (masks its frames) for a high-level `send` / `message` round-trip.

// One endpoint of a cross-wired in-memory socket pair: a real `Duplex` whose writes forward
// into the partner's inbound `PassThrough` and whose reads drain its OWN inbound one. Two of
// these, sharing each other's channel, form a genuine bidirectional stream — bytes written to
// one arrive as `data` on the other — exercising real Node stream I/O without a socket or a
// mock (AGENTS §16). Module-private (the runtime-self-contained §5 analogue: a test-only
// stream shim with no standalone reuse beyond `duplexPair`); the pair factory is the surface.
class DuplexEnd extends Duplex {
	readonly #inbound: PassThrough
	readonly #outbound: PassThrough

	constructor(inbound: PassThrough, outbound: PassThrough) {
		super()
		this.#inbound = inbound
		this.#outbound = outbound
		this.#inbound.on('data', (chunk: Buffer) => {
			this.push(chunk)
		})
		this.#inbound.on('end', () => {
			this.push(null)
		})
	}

	override _read(): void {
		// Flow is push-driven by the inbound 'data' listener above; nothing to pull.
	}

	override _write(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: (error?: Error) => void,
	): void {
		this.#outbound.write(chunk)
		callback()
	}
}

/**
 * Create a cross-wired in-memory `node:stream` Duplex PAIR — a real bidirectional socket for
 * the WebSocket wrapper / transport tests (AGENTS §16.1). The server end gets `[0]`, the
 * client end `[1]`, sharing two `PassThrough` channels (one per direction); bytes written to
 * one arrive as `data` on the other. No socket, no mock — genuine Node stream I/O.
 *
 * @returns The `[server, client]` Duplex pair
 */
export function duplexPair(): readonly [Duplex, Duplex] {
	const toServer = new PassThrough()
	const toClient = new PassThrough()
	const server = new DuplexEnd(toServer, toClient)
	const client = new DuplexEnd(toClient, toServer)
	server.on('error', () => {})
	client.on('error', () => {})
	return [server, client]
}

/**
 * Resolve on the socket pair's next tick or two — long enough for synchronous frame writes to
 * propagate through the {@link duplexPair} PassThroughs (AGENTS §16.1). Deterministic (no real
 * timer dependence on load), so a WebSocket test awaits it after a `send` rather than polling.
 *
 * @returns A promise resolving after two `setImmediate` ticks
 */
export function flushSocket(): Promise<void> {
	return new Promise((resolve) => setImmediate(() => setImmediate(resolve)))
}

/**
 * Collect a {@link duplexPair} client end's incoming frames — FIRST stripping the server's
 * HTTP `101` handshake response (the leading text up to `\r\n\r\n`), THEN decoding every
 * complete frame off the running buffer with {@link parseWebSocketFrame} (AGENTS §16.1). The
 * real client reader: the inverse of what a server-mode wrapper writes (handshake then
 * frames). The returned `frames` array grows as the server sends.
 *
 * @param client - The client end of a {@link duplexPair}
 * @returns A handle whose `frames` accumulates each decoded {@link WebSocketFrame}
 */
export function readClientFrames(client: Duplex): { readonly frames: readonly WebSocketFrame[] } {
	const frames: WebSocketFrame[] = []
	let buffer = Buffer.alloc(0)
	let handshook = false
	const end = Buffer.from('\r\n\r\n')
	client.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk])
		if (!handshook) {
			const index = buffer.indexOf(end)
			if (index === -1) return // handshake not fully arrived yet
			buffer = buffer.subarray(index + end.length)
			handshook = true
		}
		for (;;) {
			const frame = parseWebSocketFrame(buffer)
			if (frame === undefined) break
			buffer = buffer.subarray(frame.consumed)
			frames.push(frame)
		}
	})
	return { frames }
}

// ── Guide §22 parity driver (the standard surface + method bijection) ────────
//
// AGENTS §16.1 + §22: the surface-and-method parity block that EVERY standard
// `<guide-root>/<domain>.md` test repeated verbatim — the value/type Surface bijection plus the
// per-interface / per-class Methods bijection — folded into ONE declarative driver. Each
// guide test now calls `assertGuideParity({ domain, source, interfaces, classes, match? })`
// and the driver emits the SAME `describe`/`it` structure (identical labels, so the test
// names + total count are unchanged) the hand-rolled tests emitted. It is a FUNCTION called
// BY each guide test at module eval — this module defines it but never calls `describe`/`it`
// at its own top level, so importing it registers nothing (no double-run). The §22 string
// scanners (`surfaceRows` / `exported*Names` / `*MethodNames` / `methodTable`) stay in
// `setup.ts`; the driver imports them from there exactly as it imports `createRecorder`.

// The Surface `Kind` column tokens that mark a VALUE export (`function` / `const` / `class`)
// vs. a TYPE export (`type` / `interface`) — the split the bijection sorts each row into.
const VALUE_KINDS = new Set(['function', 'const', 'class'])
const TYPE_KINDS = new Set(['type', 'interface'])

/**
 * One `[class, interface, ...bases]` parity pairing — the class must expose exactly the
 * interface's methods (plus, when listed, the methods of any interfaces it `extends`, named
 * explicitly because the scanner reads ONE declaration's own body). A plain `[class, interface]`
 * 2-tuple is the common case (no bases).
 */
export type GuideClassPairing = readonly [klass: string, iface: string, ...bases: readonly string[]]

/**
 * The declarative config for {@link assertGuideParity} — everything a standard concept guide
 * §22 parity test varies.
 *
 * @remarks
 * - `domain` — the guide path below the guide root, without `.md`; the labels are derived from it.
 * - `source` — the source tree(s) the SURFACE bijection scans for real exports; a single
 *   repo-relative dir or several joined (the layer-spanning guides — databases / console / mcp / …).
 * - `interfaces` — the behavioral interfaces whose `## Methods` tables are bijected against the real
 *   interface methods (default `[]`).
 * - `classes` — the `[class, interface, ...bases]` pairings whose class is bijected against its
 *   interface's methods (default `[]`).
 * - `match` — the class-match mode: `'exact'` (the class exposes EXACTLY the interface's methods —
 *   the common case) or `'required'` (the class implements every REQUIRED method and adds none
 *   beyond the interface's full surface — databases / console / terminals, where the interface has
 *   optional members). Default `'exact'`.
 * - `methodSource` — the source tree(s) the METHOD bijection scans; defaults to `source`. Only
 *   `ollama` overrides it (its surface scans `src/ollama`, but its methods join `src/ollama` +
 *   `src/core/agents` so the implemented `ProviderInterface` is in scope).
 * - `suffix` — appended to BOTH `describe` labels; only `router` sets it (` (both modules)` /
 *   ` (both interfaces)`). Default `['', '']` (no suffix).
 * - `documentClasses` — when `true`, the documented `## Methods` table is headed by the CLASS (not
 *   a separate interface table), so for each `classes` pairing the driver ALSO emits a
 *   `"documents every public method of <class>, and only real ones"` `it` bijecting the table under
 *   `<class>` against the CLASS's real methods. Only `ollama` sets it — its sole method table is
 *   headed `OllamaProvider` (the class), the abstract `ProviderInterface` having no table of its
 *   own. Default `false` (the table is interface-headed, covered by the `interfaces` loop).
 */
export interface GuideParityConfig {
	readonly domain: string
	readonly source: string | readonly string[]
	readonly interfaces?: readonly string[]
	readonly classes?: readonly GuideClassPairing[]
	readonly match?: 'exact' | 'required'
	readonly methodSource?: string | readonly string[]
	readonly suffix?: readonly [surface: string, method: string]
	readonly documentClasses?: boolean
}

// Join one-or-many repo-relative dirs into the concatenated source corpus the scanners read.
function corpus(source: string | readonly string[]): string {
	const dirs = typeof source === 'string' ? [source] : source
	return dirs.map((dir) => readTree(dir, (name) => name.endsWith('.ts'))).join('\n')
}

/**
 * Emit the standard §22 surface + method parity suites for one guide — the single
 * driver every standard guide test calls in place of its hand-rolled `describe`/`it` blocks
 * (AGENTS §16.1 / §22). Reproduces the exact same suite structure and labels:
 *
 * - `describe('<guide>.md — surface parity'<suffix>)` with two `it`s — the documented value
 *   exports equal the real value exports, and the documented type exports equal the real type exports
 *   (the Surface `Kind` column splitting value vs. type, deduped + sorted).
 * - `describe('<guide>.md — method parity'<suffix>)` — one `it` per `interfaces` entry
 *   (its `## Methods` table equals the interface's real methods) and one `it` per `classes` pairing
 *   (the class's methods match its interface per `match`). SKIPPED ENTIRELY when there are no
 *   interfaces AND no classes (a surface-only guide).
 *
 * The `match` branch reproduces the two class-assertion forms verbatim: `'exact'` ⇒
 * `"<class> exposes exactly <iface>'s public methods"` (set equality); `'required'` ⇒
 * `"<class> implements every required method of <iface> and adds none beyond it"` (missing/extra
 * over the contract — and its extended bases — empty).
 *
 * @param root - The repo-relative directory containing the guide tree
 * @param config - The {@link GuideParityConfig} for this guide (see its `@remarks`)
 */
export function assertGuideParity(root: string, config: GuideParityConfig): void {
	const { domain } = config
	const interfaces = config.interfaces ?? []
	const classes = config.classes ?? []
	const match = config.match ?? 'exact'
	const [surfaceSuffix, methodSuffix] = config.suffix ?? ['', '']
	const path = `${root}/${domain}.md`
	const guide = readText(path)
	const surfaceSource = corpus(config.source)
	const methodSource = corpus(config.methodSource ?? config.source)
	const rows = surfaceRows(guide, 'Surface')

	const claimedValues = [
		...new Set(rows.filter((row) => VALUE_KINDS.has(row.kind)).map((row) => row.name)),
	].sort()
	const claimedTypes = [
		...new Set(rows.filter((row) => TYPE_KINDS.has(row.kind)).map((row) => row.name)),
	].sort()
	const realValues = [...exportedValueNames(surfaceSource)].sort()
	const realTypes = [...exportedTypeNames(surfaceSource)].sort()

	describe(`${path} — surface parity${surfaceSuffix}`, () => {
		it('documents every value export, and only real ones', () => {
			expect(claimedValues).toEqual(realValues)
		})

		it('documents every type export, and only real ones', () => {
			expect(claimedTypes).toEqual(realTypes)
		})
	})

	// A surface-only guide (no interfaces or classes) has no behavioral interface and no class —
	// no Methods section to bind, so the method `describe` is omitted entirely (not an empty suite).
	if (interfaces.length === 0 && classes.length === 0) return

	// Partition the method rows up front with ORDINARY control flow, so the `describe` body is a
	// fixed sequence of unconditional `for` loops — each `it` keeps a template-literal title and an
	// INLINE `expect` (the vitest lint requires both), and no conditional ever wraps a test. The
	// order reproduces the hand-rolled suites: interface rows, then (for the class-headed `ollama`
	// shape) each class's doc row, then the class-match rows in `classes` order. The exact / required
	// split is keyed by `match`, which is uniform per guide — exactly one of the two class lists is
	// non-empty, so running both loops preserves the original ordering.
	const classDocs = config.documentClasses === true ? classes.map(([klass]) => klass) : []
	const exactPairs: readonly (readonly [string, string])[] =
		match === 'exact' ? classes.map(([klass, iface]) => [klass, iface]) : []
	const requiredPairs = match === 'required' ? classes : []

	describe(`${path} — method parity${methodSuffix}`, () => {
		for (const iface of interfaces) {
			it(`documents every public method of ${iface}, and only real ones`, () => {
				expect([...methodTable(guide, iface)].sort()).toEqual(
					[...interfaceMethodNames(methodSource, iface)].sort(),
				)
			})
		}
		// Class-headed doc table (`ollama`): the table under `<class>` equals the class's real methods.
		for (const klass of classDocs) {
			it(`documents every public method of ${klass}, and only real ones`, () => {
				expect([...methodTable(guide, klass)].sort()).toEqual(
					[...classMethodNames(methodSource, klass)].sort(),
				)
			})
		}
		// Exact match: the class exposes EXACTLY its interface's methods (no optional members).
		for (const [klass, iface] of exactPairs) {
			it(`${klass} exposes exactly ${iface}'s public methods`, () => {
				expect([...classMethodNames(methodSource, klass)].sort()).toEqual(
					[...interfaceMethodNames(methodSource, iface)].sort(),
				)
			})
		}
		// Required match: the class implements every REQUIRED method of its interface (and any extended
		// bases) and adds nothing beyond their full (required + optional) surface.
		for (const [klass, iface, ...bases] of requiredPairs) {
			it(`${klass} implements every required method of ${iface} and adds none beyond it`, () => {
				const contracts = [iface, ...bases]
				const klassMethods = new Set(classMethodNames(methodSource, klass))
				const all = new Set(
					contracts.flatMap((name) => [...interfaceMethodNames(methodSource, name)]),
				)
				const required = contracts.flatMap((name) => [
					...interfaceRequiredMethodNames(methodSource, name),
				])
				const missing = required.filter((name) => !klassMethods.has(name)).sort()
				const extra = [...klassMethods].filter((name) => !all.has(name)).sort()
				expect({ missing, extra }).toEqual({ missing: [], extra: [] })
			})
		}
	})
}

// ── tests-mirror-sources path helpers (AGENTS §16) ───────────────────────────
// The four path utilities the structure (`src/**` ↔ `tests/src/**`) mirror check uses
// to map between a source file and its mirroring test file. Names are unchanged from the
// former `structure.test.ts` (no collision with an existing setupServer export).

// The last `/`-segment of a repo-relative path (the bare file name).
export function fileName(path: string): string {
	const segments = path.split('/')
	return segments[segments.length - 1] ?? ''
}

// The mirroring test path for a source path (`src/a/B.ts` → `tests/src/a/B.test.ts`).
export function testPath(source: string): string {
	return `tests/${source.replace(/\.ts$/, '.test.ts')}`
}

// The mirrored source path for a test path (`tests/src/a/B.test.ts` → `src/a/B.ts`).
export function sourcePath(test: string): string {
	return test.replace(/^tests\//, '').replace(/\.test\.ts$/, '.ts')
}

// The base stem of a test file (`tests/src/a/B.test.ts` → `B`).
export function testBase(test: string): string {
	return fileName(test).replace(/\.test\.ts$/, '')
}
