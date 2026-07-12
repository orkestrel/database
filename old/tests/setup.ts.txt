import {
	AgentJobInput,
	AggregateFunction,
	Columns,
	Condition,
	Connector,
	ConditionOperator,
	ContextFormatInterface,
	ConversationSnapshot,
	ConversationStoreInterface,
	ConversationSummarizer,
	Criteria,
	DriverInterface,
	EmitterInterface,
	EventMap,
	FieldPath,
	Guard,
	InferentialResult,
	JSONRPCRequest,
	Key,
	LogicalResult,
	LogLevel,
	MessageInterface,
	ProviderDelta,
	ProviderInterface,
	ProviderResult,
	ProviderStreamOptions,
	QuantitativeDefinition,
	QuantitativeResult,
	ReasonerInterface,
	Reasoning,
	ReasonResult,
	Row,
	RowOf,
	SchedulerInterface,
	SchedulerOptions,
	SinkInterface,
	SSEEvent,
	Subject,
	SymbolicResult,
	TableInterface,
	TableSchema,
	TimerCancel,
	TimerHandler,
	ToolCall,
	ToolDefinition,
	ToolInterface,
	TokenUsage,
	WorkflowDefinition,
	WorkflowFunction,
	WorkflowSnapshot,
	WorkspaceSnapshot,
	WorkspaceStoreInterface,
	MarkdownParserInterface,
	BlockNode,
	HeadingNode,
	isHeadingNode,
	ListNode,
	isListNode,
	TableNode,
	isTableNode,
	ParagraphNode,
	isParagraphNode,
	CodeBlockNode,
	isCodeBlockNode,
	BlockquoteNode,
	isBlockquoteNode,
	InlineNode,
	EmphasisNode,
	isEmphasisNode,
	InlineCodeNode,
	isCodeSpanNode,
	LinkNode,
	isLinkNode,
	isTextNode,
} from '@src/core'
import type { AuditRecord, Principal } from '@app/core'
import {
	belongsTo,
	createBinaryContent,
	createConversation,
	createDatabase,
	createFile,
	createMemoryDriver,
	createSSEParser,
	createTextContent,
	createTool,
	createWorkflowRunner,
	createWorkspace,
	factorGroup,
	hasMany,
	integerShape,
	isArray,
	ProviderAbortError,
	quantitativeDefinition,
	staticFactor,
	stringShape,
} from '@src/core'
import { describe, expect, it } from 'vitest'

/**
 * A broad spread of values for exercising parse↔guard soundness exhaustively:
 * guard-valid representatives for every shipped guard, coercible inputs (numeric
 * strings, `'true'` / `1`), and adversarial non-matches (mixed arrays, symbol,
 * bigint, function) so both soundness clauses are covered non-vacuously.
 */
export const SOUNDNESS_SAMPLE: readonly unknown[] = [
	null,
	undefined,
	true,
	false,
	0,
	1,
	-1,
	42,
	3.14,
	-0,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	'',
	' ',
	'hello',
	'abc',
	'42',
	'3.14',
	'true',
	'false',
	'0',
	'1',
	{},
	{ a: 1 },
	[],
	[1, 2],
	[1, '2'],
	['a', 'b'],
	new Map(),
	new Set(),
	10n,
	Symbol('s'),
	() => 1,
	new Date(),
]

/**
 * Return the parse↔guard soundness violations of a (guard, parser) pair over
 * {@link SOUNDNESS_SAMPLE} — an empty result means the pair is sound (AGENTS §14):
 * - **A** — a guard-valid input is returned UNCHANGED (by identity), never rejected.
 * - **B** — every non-`undefined` output satisfies the guard.
 *
 * @param guard - The guard for the parser's output type
 * @param parse - The parser under test
 * @returns Violation tags (`A@<index>` / `B@<index>`); empty when sound
 */
export function soundnessViolations<T>(
	guard: Guard<T>,
	parse: (value: unknown) => T | undefined,
): readonly string[] {
	const out: string[] = []
	for (let index = 0; index < SOUNDNESS_SAMPLE.length; index += 1) {
		const value = SOUNDNESS_SAMPLE[index]
		const parsed = parse(value)
		if (guard(value) && !Object.is(parsed, value)) out.push(`A@${index}`)
		if (parsed !== undefined && !guard(parsed)) out.push(`B@${index}`)
	}
	return out
}

/**
 * Resolve after `ms` milliseconds — the single shared delay helper (AGENTS §16.1),
 * for letting a real short timer (a {@link createTimeout} expiry) elapse instead of
 * inlining a `setTimeout` promise per test.
 *
 * @param ms - Milliseconds to wait; defaults to `0` (a macrotask turn)
 * @returns A promise that resolves once the delay elapses
 */
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `thunk` and return the value it threw, or `undefined` if it returned normally — the
 * one shared form of the `try { …; return undefined } catch (error) { return error }` IIFE
 * the error-path tests repeat (AGENTS §16.1). Lets a caller assert on the captured fault
 * unconditionally, never inside a conditional `expect` — e.g. `errorCode(captureError(() =>
 * …))` (where `errorCode` lives in the env-specific setup). For a synchronous throw site; an
 * async rejection is asserted with `await expect(…).rejects` instead.
 *
 * @param thunk - The (synchronous) operation to run and capture the throw of
 * @returns The thrown value, or `undefined` when `thunk` did not throw
 */
export function captureError(thunk: () => unknown): unknown {
	try {
		thunk()
		return undefined
	} catch (error) {
		return error
	}
}

/**
 * Round-trip a value through `JSON.parse(JSON.stringify(...))`, returning the structurally
 * identical clone — the one shared form of the "driver-swap parity" check the store / snapshot
 * tests repeat (AGENTS §16.1). A JSON / SQLite / IndexedDB backend persists a snapshot AS JSON,
 * so a structurally-faithful, pure-JSON payload must survive the round-trip byte-for-byte; a test
 * asserts `roundTripJSON(snapshot)` deep-equals the original. Type-preserving by construction —
 * the clone has the same shape (`T`), so the result drops straight into a `toEqual` against the
 * source. Environment-agnostic (`JSON` is global in node and the browser alike).
 *
 * @typeParam T - The value's type, preserved across the clone
 * @param value - The (JSON-serializable) value to round-trip
 * @returns A structurally identical deep clone of `value`
 */
export function roundTripJSON<T>(value: T): T {
	return JSON.parse(JSON.stringify(value))
}

/** A manually-settled promise — the `resolve` / `reject` lifted out of its executor. */
export interface TestGateInterface<T> {
	readonly promise: Promise<T>
	readonly resolve: (value: T) => void
	readonly reject: (error: unknown) => void
}

/**
 * Create a {@link TestGateInterface} — a deferred whose `promise` settles only when
 * the test calls `resolve` / `reject`. Lets a test gate a real handler (a queue job)
 * on a signal it controls, to prove ordering / concurrency / pause behaviour without
 * racing wall-clock timers (AGENTS §16.1).
 *
 * @typeParam T - The value the gate's `promise` resolves with
 * @returns A gate exposing its `promise` and its `resolve` / `reject`
 */
export function createGate<T = void>(): TestGateInterface<T> {
	let resolve: (value: T) => void = () => {}
	let reject: (error: unknown) => void = () => {}
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/** A real {@link AbortSignal}'s `'abort'` listener bookkeeping — adds vs. removes counted. */
export interface SignalListenerCountsInterface {
	/** A recorder of `'abort'` `addEventListener` calls on the instrumented signal. */
	readonly added: TestRecorderInterface<readonly [string]>
	/** A recorder of `'abort'` `removeEventListener` calls on the instrumented signal. */
	readonly removed: TestRecorderInterface<readonly [string]>
}

/**
 * Instrument a REAL {@link AbortSignal}'s listener bookkeeping by wrapping its own
 * `addEventListener` / `removeEventListener` (delegating to the genuine implementation) and
 * counting `'abort'` adds and removes — so a test can prove a scheduler / primitive detaches
 * every abort listener it attaches (no leak), counting on the real signal rather than mocking
 * the unit under test (AGENTS §16). Environment-agnostic — `AbortSignal` exists in node and
 * the browser alike, so it lives in the shared setup.
 *
 * @param signal - The signal to instrument in place (its methods are wrapped)
 * @returns The `added` / `removed` recorders, each incremented per `'abort'` add / remove
 */
export function instrumentSignal(signal: AbortSignal): SignalListenerCountsInterface {
	const added = createRecorder<readonly [string]>()
	const removed = createRecorder<readonly [string]>()
	const realAdd = signal.addEventListener.bind(signal)
	const realRemove = signal.removeEventListener.bind(signal)
	signal.addEventListener = (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void => {
		if (type === 'abort') added.handler(type)
		realAdd(type, listener, options)
	}
	signal.removeEventListener = (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	): void => {
		if (type === 'abort') removed.handler(type)
		realRemove(type, listener, options)
	}
	return { added, removed }
}

// ── Scripted ProviderInterface (Ollama-free agent fixture) ───────────────────
//
// AGENTS §16.1: the ONE general scripted `ProviderInterface` every Ollama-free agent
// test drives — the agent-job tests (registry rehydration, the partial policy, bounded
// concurrency, durability, sub-agent spawn), the deterministic loop tests (tool
// iteration, the chunk stream, generate↔stream parity, abort / budget bounds, status,
// the emitter), and the provider-agnosticism proof. The LIVE model is exercised
// separately in the `src:ollama` project. It is a real provider (NOT a mock of the
// agent): `stream` chunks the turn's content into deltas and RETURNS the result,
// honouring its `signal` between every delta exactly like the Ollama provider (an abort
// throws a `ProviderAbortError` carrying the accumulated partial), so a cancel threaded
// into the agent commits a genuine partial. The OPTIONS are the superset of the three
// locals it replaced (`scriptProvider` / `fakeProvider` / `stubProvider`): a configurable
// `name`, an optional provider-default `format`, per-turn or `deltasOf` delta chunking,
// an `exhaust` policy (`'repeat'` — the default, last turn repeats — or `'throw'`), and an
// opt-in `record` of each call's `messages` / `tools`. Only genuine per-scenario BEHAVIOUR
// fixtures (a provider gating on a test gate, or throwing mid-stream to drive an
// abort/error path) stay local to their test file.

/**
 * One turn a {@link createScriptedProvider} replays — either a bare {@link ProviderResult}
 * (chunked by the provider's `deltasOf`) or a `{ result, deltas?, thoughts? }` pair whose per-turn
 * `deltas` override how that one turn's content streams (the richer form `scriptProvider`
 * used) and whose `thoughts` stream live reasoning deltas before the content. A `deltas` of
 * `[]` streams the content as zero deltas (the result still returns).
 */
export type ScriptedTurn =
	| ProviderResult
	| {
			readonly result: ProviderResult
			readonly deltas?: readonly string[]
			readonly thoughts?: readonly string[]
	  }

/** One recorded `generate` / `stream` call on a {@link createScriptedProvider} (when `record`). */
export interface ScriptedCall {
	readonly messages: readonly MessageInterface[]
	readonly tools: readonly ToolDefinition[] | undefined
	readonly options: ProviderStreamOptions | undefined
}

/** How a {@link createScriptedProvider} chunks a turn's content into stream deltas. */
export type DeltasOf = (content: string) => readonly string[]

/**
 * Options for {@link createScriptedProvider} — every field optional, defaulting to the
 * original single-delta / repeat-on-exhaust behaviour.
 *
 * @remarks
 * - `delay` — ms paused at the start of each call (lets a test observe concurrency via
 *   `maxInFlight`); defaults to `0`.
 * - `name` — sets the provider's `id` and `name` (so a drop-in-swap test can prove two
 *   providers are distinguishable); defaults to `'scripted'`.
 * - `format` — a provider-default {@link ContextFormatInterface}, included on the provider
 *   ONLY when supplied (omitted ⇒ framing-agnostic, like the live OllamaProvider).
 * - `deltasOf` — how a turn's content is chunked into stream deltas; defaults to one whole
 *   delta (`(content) => [content]`). A per-turn `deltas` (the `{ result, deltas }` turn
 *   form) overrides this for that turn.
 * - `exhaust` — what happens once the turn list is consumed: `'repeat'` (the DEFAULT — the
 *   last turn repeats, so a job with extra tool-iterations still resolves) or `'throw'` (a
 *   call past the end throws, to assert a bounded loop never over-ran the script).
 * - `record` — when `true`, every call appends its `messages` / `tools` to `calls`.
 */
export interface ScriptedProviderOptions {
	readonly delay?: number
	readonly name?: string
	readonly format?: ContextFormatInterface
	readonly deltasOf?: DeltasOf
	readonly exhaust?: 'repeat' | 'throw'
	readonly record?: boolean
}

/**
 * A scripted {@link ProviderInterface} plus its live recorders — `maxInFlight` is the
 * high-water mark of concurrent calls (so a test can prove a queue / runner bounded the
 * agent jobs, e.g. `concurrency: 2` ⇒ `maxInFlight <= 2`), `started` counts calls, and
 * `calls` records each call's `messages` / `tools` (populated only under `record: true`).
 */
export interface ScriptedProviderInterface extends ProviderInterface {
	/** The highest number of `stream` calls in flight at once across this provider's life. */
	readonly maxInFlight: number
	/** How many `stream` calls have started in total. */
	readonly started: number
	/** Each call's `messages` / `tools`, in order — populated only when `record: true`. */
	readonly calls: readonly ScriptedCall[]
}

// Normalize a {@link ScriptedTurn} to its `{ result, deltas? }` parts — a bare result has
// no per-turn deltas (the `'result' in turn` discriminant narrows the union, §14, no `as`).
function turnParts(turn: ScriptedTurn): {
	readonly result: ProviderResult
	readonly deltas: readonly string[] | undefined
	readonly thoughts: readonly string[] | undefined
} {
	return 'result' in turn
		? { result: turn.result, deltas: turn.deltas, thoughts: turn.thoughts }
		: { result: turn, deltas: undefined, thoughts: undefined }
}

/**
 * Create the shared scripted {@link ProviderInterface} for deterministic, Ollama-free agent
 * tests — each `generate` / `stream` call consumes the next {@link ScriptedTurn}, streams
 * its content as deltas (per-turn `deltas`, else `deltasOf(content)`, else the whole content
 * as one delta), and RETURNS the turn's result. The call honours its `signal` between every
 * delta: an already-aborted (or mid-stream aborted) signal throws a `ProviderAbortError`
 * carrying the accumulated partial, so a cancel threaded into the agent commits a genuine
 * partial. Once the turn list is exhausted the last turn repeats (`exhaust: 'repeat'`, the
 * default) unless `exhaust: 'throw'` is set.
 *
 * @param turns - The {@link ScriptedTurn}s to replay in order (the last repeats by default)
 * @param options - The {@link ScriptedProviderOptions} (all optional; see its `@remarks`)
 * @returns A {@link ScriptedProviderInterface} (the provider + its recorders)
 */
export function createScriptedProvider(
	turns: readonly ScriptedTurn[],
	options?: ScriptedProviderOptions,
): ScriptedProviderInterface {
	const delay = options?.delay ?? 0
	const name = options?.name ?? 'scripted'
	const deltasOf = options?.deltasOf ?? ((content: string): readonly string[] => [content])
	const exhaust = options?.exhaust ?? 'repeat'
	const calls: ScriptedCall[] = []
	let index = 0
	let inFlight = 0
	let maxInFlight = 0
	let started = 0
	// Consume the next turn: past the end either repeat the last ('repeat') or throw ('throw').
	const next = (): ScriptedTurn => {
		if (index >= turns.length && exhaust === 'throw') {
			throw new Error(`createScriptedProvider exhausted at turn ${index}`)
		}
		const turn = turns[Math.min(index, turns.length - 1)] ?? { content: '' }
		index += 1
		return turn
	}
	async function* stream(
		messages: readonly MessageInterface[],
		signal: AbortSignal,
		tools?: readonly ToolDefinition[],
		run?: ProviderStreamOptions,
	): AsyncGenerator<ProviderDelta, ProviderResult> {
		if (options?.record === true) calls.push({ messages: [...messages], tools, options: run })
		started += 1
		inFlight += 1
		maxInFlight = Math.max(maxInFlight, inFlight)
		try {
			if (signal.aborted) throw new ProviderAbortError({ content: '' })
			if (delay > 0) await waitForDelay(delay)
			const turn = next()
			const { result, deltas, thoughts } = turnParts(turn)
			// Per-turn `deltas` win; else chunk the content via `deltasOf`.
			const chunks = deltas ?? deltasOf(result.content)
			let streamed = ''
			let reasoned = ''
			for (const thought of thoughts ?? []) {
				if (signal.aborted) {
					const partial: ProviderResult =
						reasoned.length > 0 ? { content: streamed, thinking: reasoned } : { content: streamed }
					throw new ProviderAbortError(partial)
				}
				reasoned += thought
				if (thought.length > 0) yield { type: 'thinking', text: thought }
			}
			for (const delta of chunks) {
				if (signal.aborted) {
					const partial: ProviderResult =
						reasoned.length > 0 ? { content: streamed, thinking: reasoned } : { content: streamed }
					throw new ProviderAbortError(partial)
				}
				streamed += delta
				if (delta.length > 0) yield { type: 'content', text: delta }
			}
			if (signal.aborted) {
				const partial: ProviderResult =
					reasoned.length > 0 ? { content: streamed, thinking: reasoned } : { content: streamed }
				throw new ProviderAbortError(partial)
			}
			return result
		} finally {
			inFlight -= 1
		}
	}
	return {
		id: name,
		name,
		...(options?.format === undefined ? {} : { format: options.format }),
		get maxInFlight() {
			return maxInFlight
		},
		get started() {
			return started
		},
		get calls() {
			return calls
		},
		stream,
		async generate(messages, signal, tools, run) {
			const generator = stream(messages, signal, tools, run)
			let step = await generator.next()
			while (!step.done) step = await generator.next()
			return step.value
		},
	}
}

// ── Agent data-stub factories (real shapes + per-test overrides) ─────────────
//
// AGENTS §16.1: the repeated agent DATA shapes — a user message, a tool call, a token
// usage, the canonical `add` / `loop` tools, an agent job — built ONCE as parameterized
// factories so a test stubs the shape it needs and customizes only the bit that matters,
// instead of re-typing the literal. These are REAL data builders (and, for the tools,
// real working `ToolInterface`s), NOT mocks of behaviour — a test that needs a
// side-effect-recording `execute` keeps its own closure. All environment-agnostic (only
// `@src/core` + `crypto.randomUUID`, global in node and Chromium), so they live here.

/**
 * Build one user-turn {@link MessageInterface} — the storage layer assigns the `id`; the
 * provider sends only role + content over the wire. The drop-in author of a `user` message
 * across the agent + provider tests (live Ollama and Ollama-free alike).
 *
 * @param content - The user message's text content
 * @returns A user-role message with a minted id
 */
export function createUserMessage(content: string): MessageInterface {
	return { id: crypto.randomUUID(), role: 'user', content }
}

/**
 * Build a {@link ToolCall} for an agent / loop test — the verbose `{ id, name, arguments }`
 * literal folded into a call with a sensible default (`add` with no arguments) plus
 * per-call overrides, so a test names only the fields its scenario cares about.
 *
 * @param overrides - Fields to override on the default call (`{ id: 'c1', name: 'add', arguments: {} }`)
 * @returns The assembled tool call
 */
export function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	return { id: 'c1', name: 'add', arguments: {}, ...overrides }
}

/**
 * Build a {@link TokenUsage} for an agent / budget test — the default `{ prompt: 5,
 * completion: 7, total: 12 }`, with per-call overrides for a budget-triggering variant.
 *
 * @param overrides - Fields to override on the default usage
 * @returns The assembled token usage
 */
export function createTokenUsage(overrides?: Partial<TokenUsage>): TokenUsage {
	return { prompt: 5, completion: 7, total: 12, ...overrides }
}

/**
 * The canonical `add` tool — a REAL {@link ToolInterface} that returns a fixed `5`, the
 * single most-repeated tool literal across the agent loop / registry tests (where the loop
 * only needs SOME callable tool whose result feeds back, not a real summation). A data
 * builder, not a mock: a test that needs the tool to actually sum its arguments, or to
 * record its calls, keeps its own `createTool` closure.
 *
 * @returns A working `add` tool returning `5`
 */
export function addTool(): ToolInterface {
	return createTool({ name: 'add', execute: () => 5 })
}

/**
 * The canonical `loop` tool — a REAL {@link ToolInterface} that always returns `'again'`,
 * the tool the iteration-cap / budget / always-tool loop tests repeat. A data builder, not
 * a mock.
 *
 * @returns A working `loop` tool
 */
export function loopTool(): ToolInterface {
	return createTool({ name: 'loop', execute: () => 'again' })
}

/**
 * Build an {@link AgentJobInput} for an agent-job test — the default `{ provider: 'main',
 * messages: [{ role: 'user', content: 'go' }] }`, with per-call overrides so a test names
 * only the job fields its scenario varies (a different `provider` / `content`, a `tools`
 * list, a `budget`). A specific failure-scenario job (a budget ceiling, a tool list) is
 * expressed through overrides; a genuinely bespoke one stays local.
 *
 * @param overrides - Fields to override on the default job
 * @returns The assembled agent-job input
 */
export function createAgentJob(overrides?: Partial<AgentJobInput>): AgentJobInput {
	return { provider: 'main', messages: [{ role: 'user', content: 'go' }], ...overrides }
}

/**
 * Build a {@link Principal} for an app-layer identity / capability / audit test — the default
 * `user`-actor `admin` in `org1` (`{ actor: 'user', identity: 'u1', membershipId: 'm1',
 * organizationId: 'org1', role: 'admin' }`) merged with per-call overrides, so a test names only the
 * field its scenario varies (a `member` role, an `agent` actor, a different org for a BOLA probe).
 * The single shared principal stub the app/core + app/server tests build on instead of re-typing the
 * five-field literal (AGENTS §16.1 — a real data stub, not a mock). Environment-agnostic (only the
 * `@app/core` type), so it lives in the shared setup.
 *
 * @param overrides - Fields to override on the default principal
 * @returns The assembled principal
 */
export function buildPrincipal(overrides?: Partial<Principal>): Principal {
	return {
		actor: 'user',
		identity: 'u1',
		membershipId: 'm1',
		organizationId: 'org1',
		role: 'admin',
		...overrides,
	}
}

/**
 * Build an {@link AuditRecord} for an audit-store / governance / provenance test — the default a
 * `write` / `allowed` `account.create` record under the shared {@link buildPrincipal} actor (`{ id:
 * 'a1', at: 1, … digest: 'name:string(4)' }`) merged with per-call overrides, so a test names only
 * the field its scenario varies (the `at` for a DESC-order pin, the `actor` org for a cross-org
 * BOLA probe, the `agent` provenance for the attribution pin). The single shared audit-record stub
 * the audit + capability + server tests build on instead of re-typing the literal (AGENTS §16.1 — a
 * real data stub, not a mock). Environment-agnostic (only the `@app/core` type), so it lives here.
 *
 * @param overrides - Fields to override on the default record (its `actor` is a {@link buildPrincipal})
 * @returns The assembled audit record
 */
export function buildAuditRecord(overrides?: Partial<AuditRecord>): AuditRecord {
	return {
		id: 'a1',
		at: 1,
		actor: buildPrincipal(),
		capability: 'account.create',
		zone: 'write',
		outcome: 'allowed',
		digest: 'name:string(4)',
		...overrides,
	}
}

/**
 * Create a deterministic stub {@link ConversationSummarizer} for the conversation-layer tests
 * — a REAL `(messages) => Promise<string>` that digests the slice into `recap of <n>` (the
 * folded count), so a `compact()` produces a predictable section summary and the rollup is a
 * predictable summary-of-summaries (AGENTS §16.1: a data-stub, NOT a behavior-mock — the LIVE
 * model is exercised separately in the `src:ollama` project). Counts its calls so a test can
 * prove the TWO summarizer calls per compaction (the section digest + the rollup regeneration).
 * Environment-agnostic (only `@src/core` types), so it lives in the shared setup.
 *
 * @returns The summarizer plus a live `calls` recorder of every digested message-slice
 */
export function createStubSummarizer(): {
	readonly summarize: ConversationSummarizer
	readonly calls: readonly (readonly MessageInterface[])[]
} {
	const calls: (readonly MessageInterface[])[] = []
	return {
		get calls() {
			return calls
		},
		summarize: async (messages) => {
			calls.push(messages)
			return `recap of ${messages.length}`
		},
	}
}

// ── JSON-RPC data-stub factory (MCP request shape) ───────────────────────────
//
// AGENTS §16.1: the well-formed JSON-RPC 2.0 request literal the MCP-server tests
// repeat (`{ jsonrpc: '2.0', method, id }`) folded into one builder with a sensible
// default plus per-call overrides, so a test names only the `method` / `id` / `params`
// its scenario varies. A real `JSONRPCRequest` (env-agnostic — only the `@src/core`
// type), NOT a mock of the transport.

/**
 * Build a well-formed {@link JSONRPCRequest} — the default `{ jsonrpc: '2.0', method:
 * 'initialize', id: 1 }` merged with per-call overrides (a different `method` / `id`, or
 * a `params` payload), so the MCP dispatch / transport tests name only the field that
 * matters instead of re-typing the envelope (AGENTS §16.1). Omitting `id` via overrides
 * (`{ id: undefined }`) yields a notification.
 *
 * @param overrides - Fields to override on the default request (`method` / `id` / `params`)
 * @returns The assembled JSON-RPC request
 */
export function createJSONRPCRequest(overrides?: Partial<JSONRPCRequest>): JSONRPCRequest {
	return { jsonrpc: '2.0', method: 'initialize', id: 1, ...overrides }
}

// ── Database test fixtures & helpers (environment-agnostic) ──────────────────
//
// Shared infrastructure for the database / driver / relations tests across every
// environment (core, browser, server). All of it is plain TypeScript over the
// `@src/core` contract builders and the driver vocabulary (`Row`, `Key`,
// `Criteria`) — no `node:*`, no DOM, no `indexedDB` — so it loads safely in every
// project (AGENTS §16.1). Each test keeps only its env-specific driver creation
// and cleanup local.

/**
 * Drain an `AsyncIterable<Row>` (a driver `scan`, a cursor stream) into an array
 * — the assertion-friendly counterpart to a streaming read.
 *
 * @param iterable - The async row source to consume to completion
 * @returns Every yielded row, in iteration order
 */
export async function collectRows(iterable: AsyncIterable<Row>): Promise<Row[]> {
	const rows: Row[] = []
	for await (const row of iterable) rows.push(row)
	return rows
}

/**
 * A minimal {@link TableSchema}`[]` for the named tables — each scan-only (empty
 * `columns` / `indexes`, `primary: 'id'`), enough to ready a table by name on a
 * driver that reads only `name` (the reference `MemoryDriver`, the IndexedDB
 * driver's out-of-line stores).
 *
 * @param names - The table names to declare
 * @returns One scan-only schema per name
 */
export function tableSchemas(...names: readonly string[]): readonly TableSchema[] {
	return names.map((name) => ({ name, primary: 'id', columns: [], indexes: [] }))
}

/**
 * Build one {@link Condition} for a criteria/compiler test — the verbose literal
 * (`{ column, operator, values, connector }`) folded into a call.
 *
 * @param column - The {@link FieldPath} the condition reads (a string is ONE
 *   column, an array descends into a nested value)
 * @param operator - The WHERE comparison to apply
 * @param values - The operator's operands (none / one / two / a list)
 * @param connector - How this condition folds into the running result; defaults
 *   to `'and'` and is ignored on the first condition of a list
 * @returns The assembled condition
 */
export function buildCondition(
	column: FieldPath,
	operator: ConditionOperator,
	values: readonly unknown[],
	connector: Connector = 'and',
): Condition {
	return { column, operator, values, connector }
}

/** The shared `users` / `posts` shape maps for the cross-driver integration tests. */
export const INTEGRATION_TABLES = {
	users: { id: stringShape(), name: stringShape(), age: integerShape() },
	posts: { id: stringShape(), author: stringShape(), title: stringShape() },
} as const

/**
 * The relation map for {@link INTEGRATION_TABLES} — users have many posts, a post
 * belongs to its author — fed to `createRelationManager` in every cross-driver
 * integration test (the manager's `database` stays env-specific).
 */
export const INTEGRATION_RELATIONS = {
	users: { posts: hasMany('author') },
	posts: { author: belongsTo('author', 'users') },
} as const

/** A row of the canonical `users` table ({@link INTEGRATION_TABLES}` users`). */
export interface UserRow {
	readonly id: string
	readonly name: string
	readonly age: number
}

/**
 * Build one canonical `users` row (`{ id, name, age }`) — the single most-repeated row
 * literal across the database / driver / relations tests, folded into a factory with a
 * sensible default (`{ id: 'u1', name: 'Ada', age: 36 }`) plus per-call overrides so a
 * test names only the field its scenario varies (AGENTS §16.1). A plain data builder; the
 * shape matches {@link INTEGRATION_TABLES}` users`.
 *
 * @param overrides - Fields to override on the default row
 * @returns The assembled user row
 */
export function createUserRow(overrides?: Partial<UserRow>): UserRow {
	return { id: 'u1', name: 'Ada', age: 36, ...overrides }
}

/**
 * The recurring three-row `users` seed — `Ada` / `Grace` / `Edsger` (`u1` / `u2` / `u3`)
 * — the trio the densest CRUD / batch / query tests `set([...])` before exercising reads
 * (AGENTS §16.1). Built fresh each call (a new array of fresh rows) so a mutating test
 * never leaks into the next; each row is a {@link createUserRow} so the shape stays in one
 * place.
 *
 * @returns The three seed rows, in key order
 */
export function userRows(): readonly UserRow[] {
	return [
		createUserRow(),
		createUserRow({ id: 'u2', name: 'Grace', age: 45 }),
		createUserRow({ id: 'u3', name: 'Edsger', age: 50 }),
	]
}

/**
 * Stand up a LIVE, seeded `users` {@link import('@src/core').TableInterface} for the `databases`
 * entity tests — `createDatabase({ driver: createMemoryDriver(), tables: { users: columns } })`,
 * seed the rows, and return `db.table('users')` (AGENTS §16.1). The shared form of the per-file
 * `seeded()` the `Cursor` / `Query` / `Clause` tests each hand-rolled (each over the SAME base
 * `id` / `name` / `age` columns plus its own 4th column — a `role` literal, a `nickname` optional).
 * The caller passes its FULL `columns` map and `rows`; because `columns` is captured as a `const`
 * generic, the returned table's row type is `RowOf<C>` — inferred PRECISELY (the literal-union
 * `role`, the optional `nickname`), so each file keeps `type Users = Awaited<ReturnType<typeof
 * seeded>>` with NO `as` and NO widening to a bare `Row`. A real `databases` table over the in-memory
 * reference driver (NOT a mock); each call builds a FRESH database so a mutating test never leaks.
 *
 * @typeParam C - The `users` column map (captured `const` so its row type infers precisely)
 * @param options - `columns` (the full column map) and `rows` (the seed rows, typed `RowOf<C>`)
 * @returns The seeded `users` table, typed `TableInterface<RowOf<C>>`
 */
export async function seedUsersTable<const C extends Columns>(
	columns: C,
	seed: (users: TableInterface<RowOf<C>>) => Promise<unknown>,
): Promise<TableInterface<RowOf<C>>> {
	const database = createDatabase({ driver: createMemoryDriver(), tables: { users: columns } })
	const users = database.table('users')
	await seed(users)
	return users
}

/** One recorded call to {@link createRecordingDriver}'s native `aggregate` hook. */
export interface RecordingAggregate {
	readonly operation: AggregateFunction
	readonly column: FieldPath
	readonly criteria: Criteria
}

/**
 * A recording {@link DriverInterface} over a Map that ALSO implements the optional
 * native `records` / `count` / `aggregate` hooks (AGENTS §21) — a real driver, not
 * a mock. Rows are stored (so a scan WOULD return them), but the three hooks
 * short-circuit to a fixed sentinel and record what they were handed, so a test can
 * prove `Table` preferred the hook over the scan engine.
 */
export interface RecordingDriverInterface extends DriverInterface {
	/** The native filtered-read hook (always present here) — records its criteria. */
	records(table: string, criteria: Criteria): Promise<readonly Row[]>
	/** The native count hook (always present here) — records its criteria. */
	count(table: string, criteria: Criteria): Promise<number>
	/** The native aggregate hook (always present here) — records its arguments. */
	aggregate(
		table: string,
		operation: AggregateFunction,
		column: FieldPath,
		criteria: Criteria,
	): Promise<number | undefined>
}

/** The sentinel row {@link createRecordingDriver}'s native `records` hook returns. */
export const RECORDING_ROW: Row = { id: 'native', name: 'Native', age: 7 }

/** The sentinel total {@link createRecordingDriver}'s native `count` hook returns. */
export const RECORDING_COUNT = 999

/** The sentinel value {@link createRecordingDriver}'s native `aggregate` hook returns. */
export const RECORDING_AGGREGATE = 123

/**
 * Create a {@link RecordingDriverInterface} plus the arrays its native hooks
 * record into — a real Map-backed driver whose `records` / `count` / `aggregate`
 * return fixed sentinels ({@link RECORDING_ROW} / {@link RECORDING_COUNT} /
 * {@link RECORDING_AGGREGATE}) and push what they receive onto `recordsCalls` /
 * `countCalls` / `aggregateCalls`. Lets a test assert the native hook ran (and with
 * which arguments) instead of the scan engine. `aggregatesUndefined` makes the
 * `aggregate` hook resolve to `undefined` instead — to prove `Table` treats a
 * present hook as having handled the call even when its result is `undefined`.
 *
 * @param aggregatesUndefined - When `true`, the native `aggregate` hook resolves to
 *   `undefined` (still recording the call); defaults to `false`
 * @returns The driver and its three recorded-call arrays
 */
export function createRecordingDriver(aggregatesUndefined = false): {
	readonly driver: RecordingDriverInterface
	readonly recordsCalls: readonly Criteria[]
	readonly countCalls: readonly Criteria[]
	readonly aggregateCalls: readonly RecordingAggregate[]
} {
	const tables = new Map<string, Map<Key, Row>>()
	const recordsCalls: Criteria[] = []
	const countCalls: Criteria[] = []
	const aggregateCalls: RecordingAggregate[] = []
	const store = (table: string): Map<Key, Row> => {
		let map = tables.get(table)
		if (map === undefined) {
			map = new Map()
			tables.set(table, map)
		}
		return map
	}
	const driver: RecordingDriverInterface = {
		async open(schema) {
			for (const table of schema) {
				if (!tables.has(table.name)) tables.set(table.name, new Map())
			}
		},
		async close() {},
		async read(table, key) {
			const row = store(table).get(key)
			return row === undefined ? undefined : { ...row }
		},
		async write(table, key, row) {
			store(table).set(key, { ...row })
		},
		async delete(table, key) {
			return store(table).delete(key)
		},
		async keys(table) {
			return [...store(table).keys()]
		},
		async *scan(table) {
			for (const row of store(table).values()) yield { ...row }
		},
		async clear(table) {
			store(table).clear()
		},
		async snapshot() {
			return async () => {}
		},
		async records(_table, criteria) {
			recordsCalls.push(criteria)
			return [{ ...RECORDING_ROW }]
		},
		async count(_table, criteria) {
			countCalls.push(criteria)
			return RECORDING_COUNT
		},
		async aggregate(_table, operation, column, criteria) {
			aggregateCalls.push({ operation, column, criteria })
			return aggregatesUndefined ? undefined : RECORDING_AGGREGATE
		},
	}
	return { driver, recordsCalls, countCalls, aggregateCalls }
}

/**
 * A slowed, write-observing {@link DriverInterface} harness — the #18 single-writer-queue
 * pin's instrument (a real Map-backed driver, not a mock).
 */
export interface SlowDriverHarness {
	/** The driver — pass it to `createDatabase` / `createAppDatabase`. */
	readonly driver: DriverInterface
	/** The observed write phases, in order: `write:start:<label>` / `write:end:<label>`. */
	readonly events: readonly string[]
}

/**
 * Create a real Map-backed {@link DriverInterface} whose `write` is SLOWED by `delay`
 * milliseconds and OBSERVED — each write appends `write:start:<label>` before the delay and
 * `write:end:<label>` after it, where `label` is the written row's `name` column (or its
 * key). The instrument for interleave pins: two concurrent writers SERIALIZE exactly when no
 * `write:start` falls between another write's `start` and `end`; reads (`read` / `scan` /
 * `keys`) are NOT delayed, so a read racing a slow write observably completes first.
 *
 * @param delay - How long each `write` stalls between its `start` and `end` marks (ms)
 * @returns The {@link SlowDriverHarness} — the driver plus its ordered write events
 */
export function createSlowDriver(delay = 20): SlowDriverHarness {
	const tables = new Map<string, Map<Key, Row>>()
	const events: string[] = []
	const store = (table: string): Map<Key, Row> => {
		let map = tables.get(table)
		if (map === undefined) {
			map = new Map()
			tables.set(table, map)
		}
		return map
	}
	const driver: DriverInterface = {
		async open(schema) {
			for (const table of schema) {
				if (!tables.has(table.name)) tables.set(table.name, new Map())
			}
		},
		async close() {},
		async read(table, key) {
			const row = store(table).get(key)
			return row === undefined ? undefined : { ...row }
		},
		async write(table, key, row) {
			const label = typeof row.name === 'string' ? row.name : String(key)
			events.push(`write:start:${label}`)
			await waitForDelay(delay)
			store(table).set(key, { ...row })
			events.push(`write:end:${label}`)
		},
		async delete(table, key) {
			return store(table).delete(key)
		},
		async keys(table) {
			return [...store(table).keys()]
		},
		async *scan(table) {
			for (const row of store(table).values()) yield { ...row }
		},
		async clear(table) {
			store(table).clear()
		},
		async snapshot() {
			// Clone every table so a rollback restores the pre-transaction state (the same
			// cloned-map primitive the reference MemoryDriver uses).
			const before = new Map([...tables].map(([name, map]) => [name, new Map(map)]))
			return async () => {
				tables.clear()
				for (const [name, map] of before) tables.set(name, new Map(map))
			}
		},
	}
	return { driver, events }
}

// ── Call recorder (a real callback, not a mock) ──────────────────────────────
//
// AGENTS §16.1: when a test only needs to count calls or inspect arguments, use a
// recorder — a real listener that records every invocation — rather than a test-
// framework spy. `handler` is a genuine callback; `calls` is each invocation's
// argument tuple, in order.

/** A real call-recording callback over an argument tuple (AGENTS §16.1). */
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

/**
 * Create a {@link TestRecorderInterface} — a real callback that records each
 * invocation's arguments, for asserting what fired and with what (AGENTS §16.1).
 *
 * @typeParam TArgs - The argument tuple the recorded handler receives
 * @returns A recorder whose `handler` records into `calls`
 */
export function createRecorder<TArgs extends readonly unknown[]>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler(...args: TArgs) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/**
 * Create a recorder for an {@link import('@src/core').EmitterErrorHandler} — the emitter's
 * own listener-error channel (AGENTS §13): a `TestRecorderInterface<[error, event]>` whose
 * `handler` is wired as the `error` option, so an emit-safety test asserts a buggy listener's
 * throw was routed here (with the offending event name) instead of corrupting the entity.
 * Argument order is `(error, event)`, matching `EmitterErrorHandler`. A thin alias over
 * {@link createRecorder} (AGENTS §16.1 — extract-once over the per-entity emit-safety blocks).
 *
 * @returns A recorder of `[error: unknown, event: string]` calls
 */
export function createErrorRecorder(): TestRecorderInterface<
	readonly [error: unknown, event: string]
> {
	return createRecorder<readonly [error: unknown, event: string]>()
}

/**
 * A recording {@link import('@src/core').SinkInterface} — a real `SinkInterface` whose `write`
 * records each `(text, level)` it receives, exposed as the `calls` tuple list. The shared form of
 * the per-file copy the console tests (`Logger` / `Spinner` / `Reporter` / `LoggerManager` /
 * `Progress` / `Capture`) each drove their sink-seam through (AGENTS §16.1): a real sink, NOT a
 * behaviour mock, so an assertion reads the genuine writes. `SinkInterface` / `LogLevel` are pure
 * `@src/core` types (env-agnostic), so it lives in the shared setup.
 */
export interface RecordingSinkInterface extends SinkInterface {
	/** Each `write` call's `(text, level)`, in order — the sink's recorded output. */
	readonly calls: readonly (readonly [text: string, level: LogLevel | undefined])[]
}

/**
 * Create a {@link RecordingSinkInterface} — a real `SinkInterface` built on {@link createRecorder}
 * whose `write(text, level?)` records the pair into `calls`, for asserting exactly what a console
 * entity wrote to its sink (and at which level) without a behaviour mock (AGENTS §16.1).
 *
 * @returns A sink whose `write` records each `(text, level)` into `calls`
 */
export function createRecordingSink(): RecordingSinkInterface {
	const recorder = createRecorder<readonly [text: string, level: LogLevel | undefined]>()
	return {
		get calls() {
			return recorder.calls
		},
		write(text: string, level?: LogLevel): void {
			recorder.handler(text, level)
		},
	}
}

/**
 * A monotonic numeric resource allocator plus the recorders the pool / worker tests
 * assert against: `create` hands out `0, 1, 2, …` recording each into `created`, and
 * `destroyed` is the companion recorder a caller wires as the pool's `destroy` hook
 * (`pool: { destroy: (value) => factory.destroyed.handler(value) }`). A real factory, not
 * a mock — the `create` callback genuinely produces distinct resources (AGENTS §16.1).
 */
export interface ResourceFactoryInterface {
	/** Hand out the next resource (`0, 1, 2, …`), recording the value into {@link created}. */
	readonly create: () => number
	/** Each value `create` handed out, in order. */
	readonly created: TestRecorderInterface<readonly [number]>
	/** Each value passed to a destroy hook, in order — wired by the caller to its pool's `destroy`. */
	readonly destroyed: TestRecorderInterface<readonly [number]>
}

/**
 * Create a {@link ResourceFactoryInterface} — the shared shape behind the pool / worker
 * tests' local `counter()` / `resources()` (AGENTS §16.1). `create` is a real allocator
 * handing out monotonically-numbered resources (`0, 1, 2, …`) and recording each into
 * `created`, so a test asserts EXACTLY how many resources were made; `destroyed` is a
 * companion recorder the caller wires as the pool's `destroy` hook to assert teardown. Not
 * a mock — a genuine callback the pool drives.
 *
 * @returns The allocator (`create`) plus its `created` / `destroyed` recorders
 */
export function createResourceFactory(): ResourceFactoryInterface {
	const created = createRecorder<readonly [number]>()
	const destroyed = createRecorder<readonly [number]>()
	let next = 0
	return {
		create() {
			const value = next
			next += 1
			created.handler(value)
			return value
		},
		created,
		destroyed,
	}
}

/** A {@link createRecorder} per listed event of an `EmitterInterface`, keyed by event name. */
export type EmitterRecorders<TMap extends EventMap, TName extends keyof TMap> = {
	readonly [K in TName]: TestRecorderInterface<TMap[K]>
}

/**
 * Wire one {@link createRecorder} onto `emitter` for each of the named events — the
 * one generic form of the per-entity `recordXEvents` bundles (AGENTS §16.1). Each
 * recorder subscribes via `emitter.on(name, recorder.handler)` and is returned keyed
 * by its event name, typed with that event's argument tuple — so a test asserts what
 * fired (`events.write.calls`) and with which payload, exactly as the local bundles did.
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names to record (inferred from `events`)
 * @param emitter - The emitter to subscribe the recorders to
 * @param events - The event names to record (each becomes a key of the result)
 * @returns A recorder per name, each subscribed and keyed by event name
 */
export function recordEmitterEvents<TMap extends EventMap, TName extends keyof TMap>(
	emitter: EmitterInterface<TMap>,
	events: readonly TName[],
): EmitterRecorders<TMap, TName> {
	// Accumulate into a `Partial` of the exact mapped shape — every value keeps its
	// precise per-event tuple type (a recorder is invariant in its argument tuple, so a
	// widened record won't hold it), all keys optional until assigned. Each recorder is
	// created against its event's tuple, so `on(name, handler)` is precisely typed as it
	// is wired. The dynamic key list is the untyped edge: once every listed name is
	// present we narrow `Partial` → total through a guard, never an assertion (§14).
	const recorders: Partial<EmitterRecorders<TMap, TName>> = {}
	for (const name of events) {
		const recorder = createRecorder<TMap[typeof name]>()
		emitter.on(name, recorder.handler)
		recorders[name] = recorder
	}
	if (!isTotal(recorders, events)) {
		throw new Error('recordEmitterEvents: a recorder was not wired for every event')
	}
	return recorders
}

/**
 * Narrow an accumulated `Partial<EmitterRecorders>` to its total mapped form once every
 * listed event has a recorder present — the §14 guard standing in for an assertion in
 * {@link recordEmitterEvents} (whose loop assigns one recorder per name, so this holds;
 * the explicit per-name presence check keeps the narrowing a sound guard, not a cast).
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names that must each have a recorder
 * @param recorders - The partially-accumulated recorder map to narrow
 * @param events - The event names that must all be present for the map to be total
 * @returns Whether every listed event has a recorder (narrowing `recorders` to total)
 */
export function isTotal<TMap extends EventMap, TName extends keyof TMap>(
	recorders: Partial<EmitterRecorders<TMap, TName>>,
	events: readonly TName[],
): recorders is EmitterRecorders<TMap, TName> {
	return events.every((name) => recorders[name] !== undefined)
}

/**
 * Drain an `AsyncIterable<T>` (an agent chunk stream, a channel `drain()`) into an
 * array — the assertion-friendly counterpart to a streaming read, beside its row /
 * SSE siblings {@link collectRows} / {@link collectSSE} (AGENTS §16.1).
 *
 * @typeParam T - The element type yielded by the iterable
 * @param iterable - The async source to consume to completion
 * @returns Every yielded value, in iteration order
 */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const values: T[] = []
	for await (const value of iterable) values.push(value)
	return values
}

/** A {@link SchedulerInterface} that records how many turn boundaries its `yield` paced. */
export interface RecordingSchedulerInterface extends SchedulerInterface {
	/** How many times `yield` ran — the turn boundaries the loop paced through this scheduler. */
	readonly yields: number
}

/**
 * Create a {@link RecordingSchedulerInterface} — a real `SchedulerInterface` whose
 * `yield` counts each call (the turn boundary it paced) and resolves immediately, so a
 * test can prove pacing ran BETWEEN turns (not after the last). It honours its signal
 * exactly like the real scheduler — an already-aborted signal rejects with the reason —
 * and its `delay` is a no-op. Not a mock: a genuine scheduler the agent loop drives.
 *
 * @returns A scheduler whose `yields` reports the turn boundaries it paced
 */
export function createRecordingScheduler(): RecordingSchedulerInterface {
	let yields = 0
	return {
		get yields() {
			return yields
		},
		async yield(options?: SchedulerOptions) {
			if (options?.signal?.aborted) throw options.signal.reason
			yields += 1
		},
		async delay() {},
	}
}

// ── Workflow fixtures (definitions + a deterministic settle, environment-agnostic) ──
//
// AGENTS §16.1: the recurring real {@link WorkflowDefinition} stubs the workflow tests
// build, plus the deterministic settle helper that drives one through the real runner.
// All plain `@src/core` data + the shipped `createWorkflowRunner` (no `node:*`, no DOM),
// so they load in every project. A test keeps only its env-/scenario-specific bits local
// (its own driver creation, a bespoke per-test definition).

/**
 * A real, valid {@link WorkflowDefinition} stub — a workflow with two phases, one task of
 * each `via` form, a `concurrency` throttle, and an explicit `bail`. Apply `overrides` to
 * produce a variant. The shared base the contract / factory / W-b entity tests build on (the
 * live tree is built from this), so the definition shape stays in one place (AGENTS §16.1).
 *
 * @param overrides - Fields to override on the default definition (`wf-1` / `Release`)
 * @returns The assembled workflow definition
 */
export function buildWorkflowDefinition(
	overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
	return {
		id: 'wf-1',
		name: 'Release',
		description: 'Ship a release',
		bail: false,
		phases: [
			{
				id: 'phase-build',
				name: 'Build',
				concurrency: 2,
				tasks: [
					{ id: 'task-compile', name: 'Compile', run: { via: 'function', name: 'compile' } },
					{
						id: 'task-scan',
						name: 'Scan',
						description: 'Security scan',
						run: { via: 'tool', name: 'scanner' },
					},
				],
			},
			{
				id: 'phase-review',
				name: 'Review',
				tasks: [{ id: 'task-audit', name: 'Audit', run: { via: 'agent', name: 'auditor' } }],
			},
		],
		...overrides,
	}
}

/**
 * A real two-phase `release` {@link WorkflowDefinition} (≥1 task each) — phase `build` runs
 * two `function` tasks concurrently, phase `ship` a third in a later phase. The handlers are
 * registered on the runner BY NAME (see {@link RELEASE_FUNCTIONS}), so a settled run records
 * real `completed` statuses + results. The shared store-test fixture both the Memory and the
 * Database `WorkflowStore` twins drive (AGENTS §16.1 — one stub, not a per-file copy).
 *
 * @param id - The workflow id (and snapshot key); defaults to `'release'`
 * @returns The assembled `release` workflow definition
 */
export function buildReleaseDefinition(id = 'release'): WorkflowDefinition {
	return {
		id,
		name: 'Release',
		phases: [
			{
				id: 'build',
				name: 'Build',
				tasks: [
					{ id: 'compile', name: 'Compile', run: { via: 'function', name: 'compile' } },
					{ id: 'lint', name: 'Lint', run: { via: 'function', name: 'lint' } },
				],
			},
			{
				id: 'ship',
				name: 'Ship',
				tasks: [{ id: 'publish', name: 'Publish', run: { via: 'function', name: 'publish' } }],
			},
		],
	}
}

/**
 * The registered behaviors a {@link buildReleaseDefinition}'s tasks dispatch to BY NAME — each
 * a real {@link WorkflowFunction} returning a distinct value, so a settled snapshot carries real
 * boxed results (AGENTS §16.1 — a real handler map shared by the store twins, never a mock).
 */
export const RELEASE_FUNCTIONS: Readonly<Record<string, WorkflowFunction>> = {
	compile: (controller) => `built ${controller.task.id}`,
	lint: () => 'clean',
	publish: () => ({ released: true }),
}

/**
 * Drive a `definition` to a SETTLED {@link WorkflowSnapshot} through the real runner — the live
 * tree is built, executed (phases sequential, tasks concurrent via {@link RELEASE_FUNCTIONS}),
 * and serialized. The genuine durable payload after a run (real `completed` statuses + recorded
 * TaskResults), not a hand-rolled stub. The runner is paced by an injected
 * {@link createRecordingScheduler} (its `yield` resolves immediately, honouring an abort signal
 * exactly like the shipped scheduler) so the run is DETERMINISTIC with no wall-clock `setTimeout`
 * (AGENTS §16) — the unit under test still runs in full (NOT a mock). Shared by the store twins.
 *
 * @param definition - The workflow definition to build, run to completion, and snapshot
 * @returns The settled run's snapshot
 */
export async function settleSnapshot(definition: WorkflowDefinition): Promise<WorkflowSnapshot> {
	const runner = createWorkflowRunner({
		functions: RELEASE_FUNCTIONS,
		scheduler: createRecordingScheduler(),
	})
	const result = await runner.execute(definition)
	return result.workflow.snapshot()
}

// ── Store-pair contract batteries (Memory ⇄ Database twins, environment-agnostic) ──
//
// AGENTS §16.1: the `{Memory,Database}{Conversation,Workspace}Store` twins each persist the
// SAME self-contained, pure-JSON snapshot behind the SAME `{X}StoreInterface` seam (get / set /
// delete, async, keyed by the snapshot's own id), so the round-trip / upsert / delete / two-ids
// battery is IDENTICAL across each pair. Each pair's snapshot builder + shared battery are
// promoted here so the contract lives in ONE place; every twin invokes the battery ONCE with its
// own store factory and KEEPS its twin-specific blocks local (the Memory guard block; the Database
// default-driver / cross-instance / sibling blocks). Real data only (a genuine `compact()` digest,
// a real seeded binary file) — NO mocks. All plain `@src/core` (no `node:*` / DOM), so they load
// in every project. The assertions are plain-JSON `toEqual` (no class-identity `toBe`).

/**
 * Build a REAL {@link ConversationSnapshot} the way a conversation produces one — three turns
 * added, then a genuine `compact()` folds the oldest two into one summarized section + regenerates
 * the rollup `summary`, with the last message kept live (`keep: 1`). So the snapshot is NON-VACUOUS
 * in BOTH the compacted sections AND the live tail (and carries a rollup summary). The shared
 * store-test fixture both `{Memory,Database}ConversationStore` twins drive (AGENTS §16.1 — one
 * builder, not a per-file copy). The deterministic, provider-free summarizer is folded INSIDE
 * (digesting the slice into `recap(<contents>)` — NOT {@link createStubSummarizer}, whose `recap of
 * <n>` digest text differs), so a `compact()` produces a predictable section + rollup.
 *
 * @param id - The conversation id (and snapshot key); defaults to `'chat'`
 * @returns The settled conversation's snapshot (sections + live tail + rollup summary)
 */
export async function buildConversationSnapshot(id = 'chat'): Promise<ConversationSnapshot> {
	const conversation = createConversation({
		id,
		summarize: async (messages) => `recap(${messages.map((message) => message.content).join('|')})`,
		keep: 1,
	})
	conversation.add([
		{ role: 'user', content: 'first' },
		{ role: 'assistant', content: 'second' },
		{ role: 'user', content: 'third' },
	])
	// Fold the oldest two into one summarized section + regenerate the rollup; the last stays live.
	await conversation.compact()
	return conversation.snapshot()
}

/**
 * Run the SHARED `ConversationStoreInterface` contract battery against a store factory — the four
 * common describe blocks both `{Memory,Database}ConversationStore` twins prove identically
 * (AGENTS §16.1): round-trip (set → get returns an equal snapshot, sections + live tail + rollup
 * summary all surviving), upsert (set keys off the snapshot's own id, so re-setting REPLACES),
 * delete & absent (set → delete → get is `undefined`; a delete of an absent id is a no-op; get of
 * an absent id is `undefined`), and two-ids-coexist (distinct ids never clobber each other; dropping
 * one leaves the other intact). Each twin calls this ONCE with its own factory and keeps its
 * twin-specific blocks local. This helper OWNS its `describe` / `it` calls — invoke it inside a test
 * file, never at the setup module's top level.
 *
 * @param makeStore - Builds a fresh, empty store for each assertion (the twin's own factory)
 * @param build - The snapshot builder ({@link buildConversationSnapshot}); takes an optional id
 */
export function assertConversationStoreContract(
	makeStore: () => ConversationStoreInterface,
	build: (id?: string) => Promise<ConversationSnapshot>,
): void {
	describe('set → get round-trip (sections + live tail + rollup summary)', () => {
		it('set → get returns an equal snapshot (sections + tail + summary survive)', async () => {
			const store = makeStore()
			const snapshot = await build()
			await store.set(snapshot)
			const got = await store.get(snapshot.id)
			// The retrieved snapshot deep-equals what was stored (the durable payload survives intact).
			expect(got).toEqual(snapshot)
			// It carries a compacted section, a live tail, AND a rollup summary (round-trip is non-vacuous).
			expect(got?.sections).toHaveLength(1)
			expect(got?.sections[0]?.summary).toBe('recap(first|second)')
			expect(got?.sections[0]?.messages.map((message) => message.content)).toEqual([
				'first',
				'second',
			])
			expect(got?.messages.map((message) => message.content)).toEqual(['third'])
			expect(got?.summary).toBe('recap(recap(first|second))')
		})
	})

	describe('upsert (set replaces under the same id)', () => {
		it('set replaces an existing snapshot under the same id', async () => {
			// `set` keys off the snapshot's OWN id (no separate id param), so re-setting the same id
			// REPLACES — proving insert-or-replace semantics, not an append (one entry, latest wins).
			const store = makeStore()
			const first = await build('c')
			const second: ConversationSnapshot = {
				id: 'c',
				sections: [],
				messages: [{ id: 'm1', role: 'user', content: 'only' }],
			}
			await store.set(first)
			await store.set(second)
			expect(await store.get('c')).toEqual(second)
		})
	})

	describe('delete & absent', () => {
		it('set → delete → get returns undefined', async () => {
			const store = makeStore()
			const snapshot = await build()
			await store.set(snapshot)
			expect(await store.get(snapshot.id)).toBeDefined()
			await store.delete(snapshot.id)
			expect(await store.get(snapshot.id)).toBeUndefined()
		})

		it('deleting an absent id does not throw (a no-op)', async () => {
			const store = makeStore()
			await expect(store.delete('never-stored')).resolves.toBeUndefined()
		})

		it('get of an absent id returns undefined', async () => {
			const store = makeStore()
			expect(await store.get('never-stored')).toBeUndefined()
		})
	})

	describe('two distinct conversation ids coexist', () => {
		it('two distinct conversation ids coexist without cross-contamination', async () => {
			// A real durable store holds many conversations; distinct ids must not clobber each other.
			const store = makeStore()
			const alpha = await build('alpha')
			const beta = await build('beta')
			await store.set(alpha)
			await store.set(beta)
			expect(await store.get('alpha')).toEqual(alpha)
			expect(await store.get('beta')).toEqual(beta)
			// Dropping one leaves the other intact.
			await store.delete('alpha')
			expect(await store.get('alpha')).toBeUndefined()
			expect(await store.get('beta')).toEqual(beta)
		})
	})
}

/**
 * Build a REAL {@link WorkspaceSnapshot} carrying a TEXT file (written through the edit surface)
 * AND a BINARY file (`icon.png`, seated through `createFile` — the edit surface only ever mints
 * text). The genuine durable payload, built the way a real workspace produces it (both real Files,
 * pure JSON DATA by construction). The shared store-test fixture both `{Memory,Database}
 * WorkspaceStore` twins drive (AGENTS §16.1 — one builder, not a per-file copy).
 *
 * @param id - The workspace id (and snapshot key); defaults to `'scratch'`
 * @returns The workspace snapshot (one text file + one binary file)
 */
export function buildWorkspaceSnapshot(id = 'scratch'): WorkspaceSnapshot {
	const icon = createFile({ path: 'icon.png', content: createBinaryContent('AAAA', 'image/png') })
	const workspace = createWorkspace({ id })
	workspace.write('src/main.ts', 'const x = 1')
	const written = workspace.snapshot()
	// Compose the durable payload: the written text file + the seeded binary file (both real Files).
	return { id: written.id, files: [...written.files, icon] }
}

/**
 * Run the SHARED `WorkspaceStoreInterface` contract battery against a store factory — the four
 * common describe blocks both `{Memory,Database}WorkspaceStore` twins prove identically
 * (AGENTS §16.1): round-trip (set → get returns an equal snapshot, text + binary files surviving),
 * upsert (re-setting the same id REPLACES), delete & absent (set → delete → get is `undefined`; a
 * delete of an absent id is a no-op; get of an absent id is `undefined`), and two-ids-coexist
 * (distinct ids never clobber each other). Each twin calls this ONCE with its own factory and keeps
 * its twin-specific blocks local. OWNS its `describe` / `it` — invoke inside a test file, never at
 * the setup module's top level.
 *
 * @param makeStore - Builds a fresh, empty store for each assertion (the twin's own factory)
 * @param build - The snapshot builder ({@link buildWorkspaceSnapshot}); takes an optional id
 */
export function assertWorkspaceStoreContract(
	makeStore: () => WorkspaceStoreInterface,
	build: (id?: string) => WorkspaceSnapshot,
): void {
	describe('set → get round-trip (text + binary files)', () => {
		it('set → get returns an equal snapshot (text + binary files survive)', async () => {
			const store = makeStore()
			const snapshot = build()
			await store.set(snapshot)
			const got = await store.get(snapshot.id)
			// The retrieved snapshot deep-equals what was stored (the durable payload survives intact).
			expect(got).toEqual(snapshot)
			// It carries BOTH a text and a binary file (the round-trip is non-vacuous).
			expect(got?.files.map((file) => file.path)).toEqual(['src/main.ts', 'icon.png'])
		})
	})

	describe('upsert (set replaces under the same id)', () => {
		it('set replaces an existing snapshot under the same id', async () => {
			// `set` keys off the snapshot's OWN id (no separate id param), so re-setting the same id
			// REPLACES — proving insert-or-replace semantics, not an append (one entry, latest wins).
			const store = makeStore()
			const first = build('w')
			const second: WorkspaceSnapshot = {
				id: 'w',
				files: [createFile({ path: 'only.txt', content: createTextContent('only', 'text') })],
			}
			await store.set(first)
			await store.set(second)
			expect(await store.get('w')).toEqual(second)
		})
	})

	describe('delete & absent', () => {
		it('set → delete → get returns undefined', async () => {
			const store = makeStore()
			const snapshot = build()
			await store.set(snapshot)
			expect(await store.get(snapshot.id)).toBeDefined()
			await store.delete(snapshot.id)
			expect(await store.get(snapshot.id)).toBeUndefined()
		})

		it('deleting an absent id does not throw (a no-op)', async () => {
			const store = makeStore()
			await expect(store.delete('never-stored')).resolves.toBeUndefined()
		})

		it('get of an absent id returns undefined', async () => {
			const store = makeStore()
			expect(await store.get('never-stored')).toBeUndefined()
		})
	})

	describe('two distinct workspace ids coexist', () => {
		it('two distinct workspace ids coexist without cross-contamination', async () => {
			// A real durable store holds many workspaces; distinct ids must not clobber each other.
			const store = makeStore()
			const alpha = build('alpha')
			const beta = build('beta')
			await store.set(alpha)
			await store.set(beta)
			expect(await store.get('alpha')).toEqual(alpha)
			expect(await store.get('beta')).toEqual(beta)
			// Dropping one leaves the other intact.
			await store.delete('alpha')
			expect(await store.get('alpha')).toBeUndefined()
			expect(await store.get('beta')).toEqual(beta)
		})
	})
}

// ── SSE response decoding (environment-agnostic) ─────────────────────────────
//
// The client side of the HTTP SSE seam (and the live agent-stream-over-HTTP test):
// read a `fetch` Response's body stream, decode the bytes (`TextDecoder` for split
// multi-byte chars), and feed them to the core `SSEParser` — so a test asserts the
// EXACT events the seam serialized, proving the encode ↔ decode round-trip. No
// `node:*` / DOM — web `Response` / `ReadableStream` / `TextDecoder` are global in
// both the node and the browser test runners (AGENTS §16.1). The live cancellation
// test uses `readSSEStream` to pull events incrementally and abort mid-stream; the
// deterministic tests use `collectSSE` to drain to completion.

/**
 * Drain a `fetch` Response's SSE body to completion, returning every dispatched
 * {@link SSEEvent} (decoded by the core `SSEParser`).
 *
 * @remarks
 * Reads the whole `response.body` stream, so call it on a stream the server ENDS
 * (a bounded SSE response). For an unbounded / cancelled stream use
 * {@link readSSEStream} instead. A `null` body (no stream) yields no events.
 *
 * @param response - The SSE `fetch` Response to read
 * @returns Every {@link SSEEvent} the stream dispatched, in order
 */
export async function collectSSE(response: Response): Promise<readonly SSEEvent[]> {
	const events: SSEEvent[] = []
	for await (const event of readSSEStream(response)) events.push(event)
	return events
}

/**
 * Stream a `fetch` Response's SSE body as decoded {@link SSEEvent}s, yielding each
 * as its blank line arrives — so a consumer can react (e.g. abort the `fetch`)
 * mid-stream.
 *
 * @remarks
 * Pulls the `response.body` reader chunk-by-chunk through a `TextDecoder({ stream:
 * true })` (handling a multi-byte char split across reads) and the core `SSEParser`
 * (handling a partial line / in-progress event split across reads), yielding each
 * dispatched event. Ends when the body closes — a server `end()`, or the reader
 * throwing/closing after the client aborted its `fetch` (the abort path the live
 * cancellation test drives). A `null` body yields nothing.
 *
 * @param response - The SSE `fetch` Response to stream
 * @returns An async generator of decoded {@link SSEEvent}s
 */
export async function* readSSEStream(response: Response): AsyncGenerator<SSEEvent> {
	const body = response.body
	if (body === null) return
	const reader = body.getReader()
	const decoder = new TextDecoder()
	const parser = createSSEParser()
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			for (const event of parser.parse(decoder.decode(value, { stream: true }))) yield event
		}
	} finally {
		reader.releaseLock()
	}
}

// ── Deterministic timer + SSE response (terminals broker / client) ───────────
//
// The injection seams the headless `Prompt` broker and the `PromptClient` SSE bridge
// expose for hermetic tests (AGENTS §16.1): a MANUAL timer driving expiry / reconnect
// without real time, and a builder that wraps scripted SSE events as a `fetch` Response
// the injected client `fetch` returns. No `node:*` / DOM — `ReadableStream` / `Response`
// / `TextEncoder` are global in both runners.

/** A manually-driven {@link TimerHandler} plus controls to inspect + fire its armed timers. */
export interface ManualTimerInterface {
	/** The {@link TimerHandler} to inject (records each armed timer; never fires on its own). */
	readonly handler: TimerHandler
	/** How many timers are currently armed (not yet fired / cancelled). */
	readonly pending: number
	/** Fire every currently-armed timer (in arm order), clearing them. */
	flush(): void
}

/**
 * Create a {@link ManualTimerInterface} — a `TimerHandler` that records each armed deadline
 * instead of scheduling it, so a test fires expiry / reconnect on demand with zero real time
 * (AGENTS §16). Injected as the `Prompt` broker's `timer` (its prompt expiry) or the
 * `PromptClient`'s `timer` (its reconnect backoff): arm a timer, assert `pending`, call
 * {@link ManualTimerInterface.flush} to fire it. A cancelled timer (the broker answering before
 * expiry) drops out of `pending` and never fires.
 *
 * @returns A manual timer whose `handler` is the injectable {@link TimerHandler}
 */
export function createManualTimer(): ManualTimerInterface {
	let armed: { readonly callback: () => void; cancelled: boolean }[] = []
	return {
		handler(callback: () => void): TimerCancel {
			const timer = { callback, cancelled: false }
			armed.push(timer)
			return () => {
				timer.cancelled = true
			}
		},
		get pending() {
			return armed.filter((timer) => !timer.cancelled).length
		},
		flush() {
			const firing = armed
			armed = []
			for (const timer of firing) if (!timer.cancelled) timer.callback()
		},
	}
}

/** A manually-driven epoch-ms clock plus the control to advance it explicitly. */
export interface ManualClockInterface {
	/** The injectable `() => number` clock — returns the current manual instant; never moves on its own. */
	readonly now: () => number
	/** Advance the manual instant by `ms` (the explicit stand-in for a real-time wait). */
	advance(ms: number): void
}

/**
 * Create a {@link ManualClockInterface} — the manual-time sibling of {@link createManualTimer}
 * for clock-READING seams (AGENTS §16). Injected wherever a `clock: () => number` option is
 * exposed (`createSession` / `createCookieSession` / `createMCPSession`, threading the session
 * stores' trailing-`now` param): the test advances the instant explicitly instead of sleeping
 * through a real TTL window, so idle-TTL eviction is deterministic under any suite load.
 *
 * @param start - The initial manual instant (epoch ms); defaults to `0`
 * @returns A manual clock whose `now` is the injectable `() => number`
 */
export function createManualClock(start = 0): ManualClockInterface {
	let instant = start
	return {
		now: () => instant,
		advance(ms: number): void {
			instant += ms
		},
	}
}

/**
 * Build a `fetch` Response whose body is an SSE stream of the given events — the controlled
 * stream an injected client `fetch` returns so a {@link import('@src/core').PromptClientInterface}
 * test drives the bridge with no real network (AGENTS §16). Each event is serialized as
 * `event: {name}\ndata: {json}\n\n`; the stream then ENDS (a bounded SSE response), so the
 * client's read loop completes and (per its options) reconnects.
 *
 * @param events - The SSE events to stream, each `{ event, data }` (data JSON-stringified)
 * @returns A `Response` with a `text/event-stream` body of the encoded events
 */
export function createSSEResponse(
	events: readonly { readonly event: string; readonly data: unknown }[],
): Response {
	const encoder = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const { event, data } of events) {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
			}
			controller.close()
		},
	})
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

// ── Parity helpers (markdown / source introspection) ─────────────────────────
//
// Generic text helpers the guide parity gates build on. No `node:*`, no DOM —
// they operate on the strings the loaders in `setupServer.ts` hand them. They
// enforce the §22 contract: a backticked API in a guide resolves to a real
// export, and every export is documented.

// Every backticked bare identifier in `text`.
export function extractBacktickedNames(text: string): readonly string[] {
	const names = new Set<string>()
	for (const match of text.matchAll(/`([A-Za-z_$][\w$]*)`/g)) {
		const name = match[1]
		if (name) names.add(name)
	}
	return [...names]
}

// The body of a `## {heading}` section, up to the next `## ` (or end of file).
// `### ` subsections stay within the body (they don't start with `## `).
export function sectionBody(markdown: string, heading: string): string {
	const lines = markdown.split('\n')
	const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
	if (start === -1) return ''
	let end = lines.length
	for (let index = start + 1; index < lines.length; index += 1) {
		if (lines[index].startsWith('## ')) {
			end = index
			break
		}
	}
	return lines.slice(start + 1, end).join('\n')
}

// Parse a guide's `## {heading}` API tables into `{ name, kind }` rows (from
// `| Name | Kind | … |` tables). The Kind column lets a parity gate split value
// exports (`function`) from type exports (`type`) without name-pattern guesswork.
// Header / separator rows (no backticked name in column 1) drop out; pipes inside
// later columns are harmless since only columns 1 and 2 are read.
export function surfaceRows(
	markdown: string,
	heading: string,
): readonly { readonly name: string; readonly kind: string }[] {
	const rows: { name: string; kind: string }[] = []
	for (const line of sectionBody(markdown, heading).split('\n')) {
		const trimmed = line.trimStart()
		if (!trimmed.startsWith('|')) continue
		const cells = trimmed.split('|').map((cell) => cell.trim())
		const [name] = extractBacktickedNames(cells[1] ?? '')
		if (name) rows.push({ name, kind: cells[2] ?? '' })
	}
	return rows
}

// Names declared by `export function` / `export const` / `export class` in TS
// source — the value half of a surface.
export function exportedValueNames(source: string): readonly string[] {
	const names = new Set<string>()
	for (const match of source.matchAll(
		/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm,
	)) {
		const name = match[1]
		if (name) names.add(name)
	}
	return [...names]
}

// Names declared by `export interface X` / `export type X = …` in TS source —
// the type half of a surface.
export function exportedTypeNames(source: string): readonly string[] {
	const names = new Set<string>()
	for (const match of source.matchAll(/export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
		const name = match[1]
		if (name) names.add(name)
	}
	return [...names]
}

// ── Method extraction (public members of a class / interface) ────────────────
//
// Extends the §22 surface contract one level down: a documented class / interface
// must document its public METHODS, exhaustively and only the real ones — so a
// renamed / added / removed method can't slip past the guide. Same lightweight,
// regex-over-source spirit as the export scanners above (NOT a TS parser).
//
// The single rule both extractors share — a "public method" is a member that:
//   • sits at the type's top level — exactly ONE leading tab (AGENTS §3 tabs,
//     §7 class structure). Body statements (`for` / `if` / `delete …`) and split
//     signature continuations are indented deeper, so they fall out for free;
//   • has a call signature — its name is followed by `(` (optionally through a
//     generic parameter list, `table<K>(name: K)`). This keeps methods
//     (`get(key)`, `delete(table, key)`, `model<K>(name)`) and drops data
//     properties (`readonly name: T`, index signatures `[k: string]: V`);
//   • is not an accessor — `get x()` / `set x()` are properties, not methods, and
//     are dropped (the `get`/`set` keyword is followed by a SPACE then the name,
//     whereas a method literally named `get` reads `get(` with no space);
//   • is not `#`-private, `static`, or the `constructor`.
// Overload signatures repeat a name; the Set collapses them. Interface bodies add
// none of `async` / `get` / `set` / `#` / `static`, so the one rule covers both.

// Public method names declared between `export {keyword} {name}` and its closing
// column-0 `}` (one declaration per name within a module's source tree). An
// OPTIONAL method writes a `?` between its name and `(` (`records?(…)`); `mode`
// selects which to keep — `'all'` (required + optional, what the guide documents)
// or `'required'` (only methods whose name is immediately followed by `(`).
function memberMethods(
	source: string,
	keyword: string,
	name: string,
	mode: 'all' | 'required',
): readonly string[] {
	const lines = source.split('\n')
	const header = new RegExp(`^export\\s+${keyword}\\s+${name}\\b`)
	const start = lines.findIndex((line) => header.test(line))
	if (start === -1) return []
	const methods = new Set<string>()
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index]
		if (line === '}') break // the declaration's own closing brace (column 0)
		// Top-level member: exactly one leading tab, then the member text.
		const member = /^\t(?!\t)(.*)$/.exec(line)
		if (!member) continue
		// Drop a leading `async` and/or `*` (generator) so the name leads the text.
		const text = member[1].replace(/^async\s+/, '').replace(/^\*\s*/, '')
		if (/^(?:get|set)\s/.test(text)) continue // accessor → property, not a method
		if (text.startsWith('static ')) continue
		// Name, then `(` — optionally through a generic list (`table<K>(name: K)`)
		// and/or an optional marker (`records?(…)`, captured as group 2).
		const call = /^(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*(\??)\s*\(/.exec(text)
		if (!call) continue // not a call signature → a data property
		const method = call[1]
		if (method.startsWith('#') || method === 'constructor') continue
		if (mode === 'required' && call[2] === '?') continue // optional → excluded
		methods.add(method)
	}
	return [...methods]
}

// Public method names of `export interface {name}` in TS source — required AND
// optional (the guide documents both).
export function interfaceMethodNames(source: string, name: string): readonly string[] {
	return memberMethods(source, 'interface', name, 'all')
}

// Required public method names of `export interface {name}` in TS source — drops
// optional members (`records?` / `count?`), so a class need not implement them.
export function interfaceRequiredMethodNames(source: string, name: string): readonly string[] {
	return memberMethods(source, 'interface', name, 'required')
}

// Public method names of `export class {name}` in TS source (drops accessors,
// `#` privates, `static`, and the constructor).
export function classMethodNames(source: string, name: string): readonly string[] {
	return memberMethods(source, 'class', name, 'all')
}

// The backticked method names a guide documents for a type, read from the method
// table under its own subheading (`#### \`{type}\``, any heading level whose sole
// backticked token is `{type}`). Column 1 of each `| \`name\` | … |` row carries
// the method name; the table runs to the next heading. Mirrors `surfaceRows`'
// column-1 parsing, scoped to one type's section — so each type's methods are
// asserted against its own source declaration, unambiguously.
export function methodTable(markdown: string, type: string): readonly string[] {
	const lines = markdown.split('\n')
	const heading = lines.findIndex(
		(line) => /^#{2,6}\s/.test(line) && extractBacktickedNames(line).join() === type,
	)
	if (heading === -1) return []
	const methods = new Set<string>()
	for (let index = heading + 1; index < lines.length; index += 1) {
		const line = lines[index]
		if (/^#{1,6}\s/.test(line)) break // next heading ends this type's section
		const trimmed = line.trimStart()
		if (!trimmed.startsWith('|')) continue
		const [name] = extractBacktickedNames(trimmed.split('|')[1] ?? '')
		if (name) methods.add(name)
	}
	return [...methods]
}

// Relative markdown link targets `](path)` — skips http(s) and pure `#anchors`.
export function markdownLinkTargets(markdown: string): readonly string[] {
	const targets = new Set<string>()
	for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
		const raw = match[1]
		if (!raw) continue
		const target = raw.split('#')[0].trim()
		if (target && !/^https?:/.test(target)) targets.add(target)
	}
	return [...targets]
}

// ── Reasons fixtures & narrowing helpers (environment-agnostic) ───────────────
//
// AGENTS §16.1: the shared infrastructure of the reasons tests — one throwing
// narrowing helper per member of the `ReasonResult` union (so a test reads
// `expectQuantitative(result).value` with no casts, §14), the recurring subjects
// the evaluator / reasoner scenarios read, the one-static-factor definition the
// orchestrator / factory tests run, a REAL throwing `ReasonerInterface` for the
// bail / error-event paths (a scripted collaborator, not a mock), and the
// `Reflect.apply` raw-invocation idiom for feeding malformed input past the
// compile-time types. All plain `@src/core` data — no `node:*`, no DOM — so
// everything loads in every project.

/**
 * Narrow a `reason()` return to a `QuantitativeResult` — throws on a batch
 * array or a result of another reasoning, so assertions read the narrowed
 * result with no casts (AGENTS §14).
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `QuantitativeResult`
 */
export function expectQuantitative(
	result: ReasonResult | readonly ReasonResult[],
): QuantitativeResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'quantitative') {
		throw new Error(`Expected a quantitative result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * Narrow a `reason()` return to a `LogicalResult` — throws on a batch array or
 * a result of another reasoning (the {@link expectQuantitative} sibling).
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `LogicalResult`
 */
export function expectLogical(result: ReasonResult | readonly ReasonResult[]): LogicalResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'logical') {
		throw new Error(`Expected a logical result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * Narrow a `reason()` return to a `SymbolicResult` — throws on a batch array or
 * a result of another reasoning (the {@link expectQuantitative} sibling).
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `SymbolicResult`
 */
export function expectSymbolic(result: ReasonResult | readonly ReasonResult[]): SymbolicResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'symbolic') {
		throw new Error(`Expected a symbolic result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * Narrow a `reason()` return to an `InferentialResult` — throws on a batch
 * array or a result of another reasoning (the {@link expectQuantitative} sibling).
 *
 * @param result - The single-or-batch return of a `reason()` call
 * @returns The result, narrowed to `InferentialResult`
 */
export function expectInferential(
	result: ReasonResult | readonly ReasonResult[],
): InferentialResult {
	if (isArray<ReasonResult>(result)) throw new Error('Expected a single result, got a batch array')
	if (result.reasoning !== 'inferential') {
		throw new Error(`Expected an inferential result, got "${result.reasoning}"`)
	}
	return result
}

/**
 * The recurring flat `Subject` of the evaluator / reasoner tests — one field of
 * each scalar kind (number / string / boolean) plus an `id`, so check operators
 * and subject-binding paths read real data without re-typing the literal
 * (AGENTS §16.1).
 */
export const BASIC_SUBJECT: Subject = {
	id: 'subject-1',
	age: 30,
	name: 'Alice',
	score: 85,
	state: 'CA',
	employed: true,
}

/**
 * The recurring nested `Subject` — two levels of nesting for the `FieldPath`
 * array-descent cases (a STRING field is ONE key; an ARRAY descends).
 */
export const NESTED_SUBJECT: Subject = {
	id: 'nested-1',
	address: { city: 'NY', zip: '10001' },
	scores: { math: 90, english: 80 },
}

/**
 * The recurring driver-scoring `Subject` — the multi-factor scenario the
 * evaluator and quantitative-reasoner tests share (AGENTS §16.1).
 */
export const DRIVER_SUBJECT: Subject = {
	driverAge: 22,
	violationCount: 0,
	vehicleYear: 2020,
}

/**
 * Build the simplest runnable `QuantitativeDefinition` — one sum group holding
 * one static factor, producing `value` on ANY subject. The shared definition the
 * orchestrator / factory tests dispatch when the scenario only needs SOME
 * working definition (AGENTS §16.1).
 *
 * @param id - The definition id (and name); defaults to `'static-quant'`
 * @param value - The static factor's value (the run's result); defaults to `42`
 * @returns The assembled quantitative definition
 */
export function buildStaticDefinition(id = 'static-quant', value = 42): QuantitativeDefinition {
	return quantitativeDefinition(id, id, [factorGroup('g1', 'sum', [staticFactor('f1', value)])])
}

/**
 * Create a REAL `ReasonerInterface` whose `reason` always throws
 * `new Error(message)` — the scripted collaborator driving the orchestrator's
 * `bail` / `error`-event paths (AGENTS §16.1: a real implementation of the
 * seam, not a mock of the orchestrator).
 *
 * @param message - The thrown error's message; defaults to `'boom'`
 * @param reasoning - The reasoning to register under; defaults to `'quantitative'`
 * @returns A reasoner whose `reason` throws
 */
export function createThrowingReasoner(
	message = 'boom',
	reasoning: Reasoning = 'quantitative',
): ReasonerInterface {
	return {
		id: 'throwing',
		reasoning,
		supports: (definition) => definition.reasoning === reasoning,
		validate: () => ({ valid: true, errors: [], warnings: [] }),
		reason: () => {
			throw new Error(message)
		},
	}
}

/**
 * Invoke a method with deliberately malformed arguments, bypassing its
 * compile-time parameter types — the runtime-validation idiom for feeding a
 * unit under test input its signature forbids (a malformed definition, an
 * unknown operator) WITHOUT `as` (AGENTS §1/§14). `Reflect.apply` carries the
 * raw arguments past the type system while the method's declared RETURN type is
 * kept (pass `T` explicitly for overloaded methods), so assertions on the
 * result stay typed.
 *
 * @typeParam T - The method's return type
 * @param target - The receiver (`this`) to invoke the method on
 * @param method - The method whose parameter types are bypassed
 * @param args - The raw arguments to hand it
 * @returns Whatever the method returns
 */
export function invokeRaw<T>(
	target: unknown,
	method: (...args: never[]) => T,
	args: readonly unknown[],
): T {
	return Reflect.apply(method, target, [...args])
}

// ── MarkdownParser AST assertions ─────────────────────────────────────────────
// Assert a parsed node IS a given element kind — throwing if not — and return it
// narrowed, so a test reads the typed node (`assertHeading(block).level`,
// `assertLink(node).href`) without an `as` or an `if`-guarded `expect` (both
// AGENTS-forbidden; §1 / §16). Thin assert-and-narrow wrappers over the parsers
// module's `is*` validators — one `assert{Element}` per guard — environment-agnostic,
// so they sit here beside the other base helpers, shared by the MarkdownParser unit
// test and the parser-validators test; `inlineText` is additionally reused by the
// guides-parity extractors in `setupGuides.ts`.

/** Parse `markdown` and narrow its FIRST block, asserting at least one exists. */
export function firstBlock(parser: MarkdownParserInterface, markdown: string): BlockNode {
	const block = parser.parse(markdown).children[0]
	if (block === undefined) throw new Error('expected at least one block')
	return block
}

export function assertHeadingNode(block: BlockNode): HeadingNode {
	if (!isHeadingNode(block)) throw new Error(`expected heading, got ${block.element}`)
	return block
}

export function assertListNode(block: BlockNode): ListNode {
	if (!isListNode(block)) throw new Error(`expected list, got ${block.element}`)
	return block
}

export function assertTableNode(block: BlockNode): TableNode {
	if (!isTableNode(block)) throw new Error(`expected table, got ${block.element}`)
	return block
}

export function assertParagraphNode(block: BlockNode | undefined): ParagraphNode {
	if (block === undefined || !isParagraphNode(block)) {
		throw new Error(`expected paragraph, got ${block?.element}`)
	}
	return block
}

export function assertCodeBlockNode(block: BlockNode): CodeBlockNode {
	if (!isCodeBlockNode(block)) throw new Error(`expected codeBlock, got ${block.element}`)
	return block
}

export function assertBlockquoteNode(block: BlockNode): BlockquoteNode {
	if (!isBlockquoteNode(block)) throw new Error(`expected blockquote, got ${block.element}`)
	return block
}

export function assertEmphasisNode(node: InlineNode | undefined): EmphasisNode {
	if (node === undefined || !isEmphasisNode(node)) {
		throw new Error(`expected emphasis, got ${node?.element}`)
	}
	return node
}

export function assertCodeSpanNode(node: InlineNode | undefined): InlineCodeNode {
	if (node === undefined || !isCodeSpanNode(node)) {
		throw new Error(`expected codeSpan, got ${node?.element}`)
	}
	return node
}

export function assertLinkNode(node: InlineNode | undefined): LinkNode {
	if (node === undefined || !isLinkNode(node))
		throw new Error(`expected link, got ${node?.element}`)
	return node
}

// Parse a single-paragraph markdown snippet, assert it yields exactly one
// paragraph, and return its first inline child narrowed to `InlineNode`.
export function assertInlineNode(parser: MarkdownParserInterface, markdown: string): InlineNode {
	const node = assertParagraphNode(firstBlock(parser, markdown)).children[0]
	if (node === undefined) throw new Error(`no inline node parsed from: ${markdown}`)
	return node
}

// The flattened text content of an inline-node tree (text + code values joined,
// descending through emphasis / link children) — a content assertion independent
// of the exact nesting.
export function inlineText(nodes: readonly InlineNode[]): string {
	return nodes
		.map((node) =>
			isTextNode(node) || isCodeSpanNode(node) ? node.value : inlineText(node.children),
		)
		.join('')
}
