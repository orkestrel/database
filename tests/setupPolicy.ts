import type { Blueprint } from '@orkestrel/scaffold'
import type {
	PolicyComment,
	PolicyContext,
	PolicyDiagnostic,
	PolicyExpression,
	PolicyScopeCode,
} from '../configs/policy.js'
import {
	createGuide,
	extractSourceLines,
	hasCanonicalSegments,
	resolveLink,
} from '@orkestrel/guide'
import { BASE_DEV_DEPENDENCIES, DISTRIBUTION_SETUP_PATH, HOST_PATHS } from '@orkestrel/scaffold'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
	realpathSync,
	chmodSync,
	existsSync,
	globSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, matchesGlob, relative as relativePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parseAst, parseSync } from 'vite'
import { stripPolicyCode, textToPolicyHits } from '../configs/policy.js'

/** Names a rule the fleet sweep decides from workspace text and paths. */
export type PolicyRule =
	| 'bridge'
	| 'dist'
	| 'mirror'
	| 'portability'
	| 'prose'
	| 'rules'
	| 'skill'
	| 'surface'
	| 'suppression'
	| 'text'

/** Describes one workspace file a physical control writes. */
export interface PolicySource {
	readonly path: string
	readonly content: string
}

/** Pairs a collected Vue import fixture with its native and independent restriction outcomes. */
export interface PolicyVueImportCase extends PolicySource {
	readonly boundary: boolean
	readonly restricted: boolean
}

/** Pairs a collected composable fixture with its placement and domain outcomes. */
export interface PolicyVueDomainCase extends PolicySource {
	readonly misplaced: boolean
	readonly malformed: boolean
}

/** Describes one policy failure the sweep reports. */
export interface PolicyViolation {
	readonly rule: PolicyRule
	readonly path: string
	readonly line?: number
	readonly message: string
}

/** Describes one reachable declaration and its physical source location. */
export interface PolicySurfaceDeclaration {
	readonly name: string
	readonly path: string
	readonly line: number
}

/** Groups reachable declarations with refusals of incomplete barrel evidence. */
export interface PolicySurfacePopulation {
	readonly declarations: readonly PolicySurfaceDeclaration[]
	readonly violations: readonly PolicyViolation[]
}

/** Reports one file's reachable declarations, or the violation reading it raised. */
export interface PolicyDeclarationRead {
	readonly declarations: readonly PolicySurfaceDeclaration[]
	readonly violation?: PolicyViolation
}

/** Names the installed host root containing the fleet's reference guides. */
export const POLICY_SURFACE_HOST = 'node_modules/@orkestrel/scaffold/dist/host'

/** Names the staged catalog's storage path beneath the installed host. */
export const POLICY_SURFACE_CATALOG = 'claude/agents/orkestrel.md'

/** Supplies export forms that must participate in the fleet comparison. */
export const POLICY_SURFACE_EXPORT_CASES = Object.freeze([
	{ label: 'namespace', text: 'export namespace waitForCondition { export const value = 1 }' },
	{ label: 'const declarators', text: 'export const other = 0, waitForCondition = 1' },
	{ label: 'let declarators', text: 'export let other = 0, waitForCondition = 1' },
	{ label: 'enum', text: 'export enum waitForCondition { Ready }' },
	{ label: 'class', text: ' export class waitForCondition {}' },
	{ label: 'interface', text: ' export interface waitForCondition {}' },
	{ label: 'type', text: ' export type waitForCondition = string' },
	{ label: 'function', text: ' export function waitForCondition() {}' },
	{
		label: 'function overload',
		text:
			'export function waitForCondition(value: string): void\n' +
			'export function waitForCondition(value: number): void\n' +
			'export function waitForCondition() {}',
	},
	{ label: 're-export list', text: "export { other as waitForCondition } from './helpers.js'" },
	{ label: 'local export list', text: 'const other = 1; export { other as waitForCondition }' },
])

/** Matches the complete physical barrel rows the parser accepts. */
export const POLICY_SURFACE_BARREL_PATTERN =
	/^\s*export\s+\*\s+from\s+(?:'(\.\.?\/[^']+\.js)'|"(\.\.?\/[^"]+\.js)")\s*;?\s*$/u

/** Names the workspace-relative styles side-effect entry the workspace rule prescribes. */
export const POLICY_SURFACE_STYLES_ENTRY = 'src/styles/sheet.ts'

/** Names the violation reported when the styles side-effect entry does not import `./index.scss` alone. */
export const POLICY_SURFACE_STYLES_MESSAGE =
	'surface population incomplete: styles entry must import ./index.scss and nothing else'

/**
 * Creates a guide whose surface claims the supplied fixture names.
 *
 * @param names - The bare names the guide claims.
 * @returns The fixture guide text.
 */
export function createPolicySurfaceGuide(names: readonly string[]): string {
	return [
		'# Fixture',
		'',
		'## Surface',
		'',
		'| Name | Kind | Summary |',
		'| ---- | ---- | ------- |',
		...names.map((name) => `| \`${name}\` | function | Declares a fixture name. |`),
		'',
	].join('\n')
}

/**
 * Writes a complete hosted reference population for a physical policy control.
 *
 * @param scratch - The owned workspace receiving the hosted references.
 * @returns Nothing.
 */
export function writePolicySurfaceHost(scratch: PolicyScratchInterface): void {
	scratch.write(
		`${POLICY_SURFACE_HOST}/${POLICY_SURFACE_CATALOG}`,
		createPolicyCatalog(['other', 'sample']),
	)
	scratch.write(`${POLICY_SURFACE_HOST}/guides/other.md`, createPolicySurfaceGuide(['readShared']))
	scratch.write(`${POLICY_SURFACE_HOST}/guides/sample.md`, createPolicySurfaceGuide([]))
}

/**
 * Creates a scratch target with a complete installed guide population.
 *
 * @returns The owned scratch workspace.
 */
export function createPolicySurfaceFixture(): PolicyScratchInterface {
	const scratch = createPolicyScratch({ prefix: 'orkestrel-policy-surface-' })
	try {
		writePolicySurfaceHost(scratch)
		scratch.write('package.json', '{"name":"@orkestrel/sample"}\n')
		scratch.write('tests/setup.ts', '')
		scratch.write('tests/setup.test.ts', "import './setupServer.js'\n")
		return scratch
	} catch (error) {
		scratch.destroy()
		throw error
	}
}

/** Describes the include, setup files, and probe settings one workspace project registers. */
export interface PolicyProject {
	readonly benchmark?: readonly string[]
	readonly include: string | readonly string[]
	readonly parallel?: boolean
	readonly pool?: string
	readonly setup: readonly string[]
}

/** Describes one physical negative control, including the population boundary it tests. */
export interface PolicyControl {
	readonly label: string
	readonly membership: string
	readonly rule: PolicyRule
	readonly files: readonly PolicySource[]
	readonly directories?: readonly string[]
	readonly line?: number
	readonly message?: string
	readonly violations?: readonly PolicyViolation[]
}

/** Describes a contained temporary directory owned by one vendored test. */
export interface PolicyScratchInterface {
	readonly path: string
	write(target: string, text: string): void
	destroy(): void
}

/**
 * Creates a contained temporary directory owned by one vendored test.
 *
 * @param options - The temporary directory name prefix and optional parent directory.
 * @returns The owned scratch directory.
 */
export function createPolicyScratch(options: {
	readonly prefix: string
	readonly parent?: string
}): PolicyScratchInterface {
	const root = mkdtempSync(join(options.parent ?? tmpdir(), options.prefix))
	return {
		path: root,
		write(target, text) {
			const normalized = normalizePolicyPath(target)
			const segments = normalized.split('/')
			if (
				normalized === '' ||
				normalized.startsWith('/') ||
				segments.some((segment) => segment === '..')
			) {
				throw new Error('Scratch target must stay within its root')
			}
			const path = join(root, ...segments)
			mkdirSync(dirname(path), { recursive: true })
			writeFileSync(path, text, 'utf8')
		},
		destroy() {
			rmSync(root, { recursive: true, force: true })
		},
	}
}

/**
 * Creates a list with the given length that holds only the entries written at their indexes.
 *
 * @remarks
 * A literal cannot express a hole, so the list is sized first and then written once per index. A
 * `for…of` loop and a spread visit each hole as `undefined`, where `map`, `filter`, and `flatMap`
 * skip it, so a caller-supplied list built here separates the two.
 *
 * @param length - The length of the list, holes included.
 * @param entries - The entry to write at each index; every other index stays a hole.
 * @returns The sparse list.
 */
export function createPolicySparse<T>(length: number, entries: ReadonlyMap<number, T>): T[] {
	const list: T[] = []
	list.length = length
	for (const [index, entry] of entries) list[index] = entry
	return list
}

/**
 * Creates a list whose entries are getters, so a reader's every read of an entry is recorded.
 *
 * @remarks
 * Only the indexes in `entries` hold a getter, and every other index stays a hole. A getter reports
 * its index to `record` and then produces its value, which may throw, so a case sees which entries
 * a reader touched before it stopped. An iterator reads an entry once as it yields it, where a copy
 * of the list reads every entry before the reader sees the first.
 *
 * @param length - The length of the list, holes included.
 * @param entries - The producer behind each getter, by index.
 * @param record - The function that receives an index each time its getter runs.
 * @param iterable - If `true`, the list keeps the iterator every array has; if `false`, its
 * `Symbol.iterator` is `undefined`, which a loop refuses and `Array.from` and `values()` do not.
 * Default: `true`.
 * @returns The list.
 */
export function createPolicyReads<T>(
	length: number,
	entries: ReadonlyMap<number, () => T>,
	record: (index: number) => void,
	iterable = true,
): T[] {
	const list = createPolicySparse<T>(length, new Map())
	for (const [index, produce] of entries) {
		Object.defineProperty(list, index, {
			configurable: true,
			enumerable: true,
			get() {
				record(index)
				return produce()
			},
		})
	}
	if (!iterable) Object.defineProperty(list, Symbol.iterator, { value: undefined })
	return list
}

/**
 * Throws the error a getter raises when its entry refuses to be read.
 *
 * @returns Never.
 * @throws RangeError - Thrown when called.
 */
export function failPolicyRead(): never {
	throw new RangeError('The entry refused its read')
}

/**
 * Settles one action into text a case compares for equality.
 *
 * @param action - The action to run.
 * @returns `return` and the JSON of the returned value, or `throw` and the constructor name.
 */
export function settlePolicyOutcome(action: () => unknown): string {
	try {
		return `return ${JSON.stringify(action())}`
	} catch (error) {
		return `throw ${error instanceof Error ? error.constructor.name : typeof error}`
	}
}

/** Describes one reader run over a recorded list, with the outcome and entry reads it must show. */
export interface PolicyLazyCase {
	readonly label: string
	readonly outcome: string
	readonly reads: readonly number[]
	readonly observe: (record: (index: number) => void) => string
}

/**
 * Creates one case that runs a reader over a recorded list.
 *
 * @param label - The text naming the reader and the list.
 * @param reader - The reader to run over the list.
 * @param list - The length of the list and the producer behind each getter, by index.
 * @param expected - The settled outcome and the indexes the reader must read, in order.
 * @returns The case.
 */
export function createPolicyLazyCase<T>(
	label: string,
	reader: (list: T[]) => unknown,
	list: {
		readonly length: number
		readonly entries: ReadonlyMap<number, () => T>
		readonly iterable?: boolean
	},
	expected: { readonly outcome: string; readonly reads: readonly number[] },
): PolicyLazyCase {
	return {
		label,
		outcome: expected.outcome,
		reads: expected.reads,
		observe: (record) =>
			settlePolicyOutcome(() =>
				reader(createPolicyReads(list.length, list.entries, record, list.iterable)),
			),
	}
}

/**
 * Describes the entries of one recorded list.
 *
 * @remarks
 * An index in `entries` produces a value the reader accepts, an index in `refusals` produces a
 * value the reader fails on after it has the value, and an index in `failures` fails when the
 * getter runs. Every other index is a hole. A list with `iterable` set to `false` has no iterator,
 * which a loop refuses and `Array.from` and `values()` do not; it is an iterator list otherwise.
 */
export interface PolicyLazyShape {
	readonly label: string
	readonly length: number
	readonly entries: readonly number[]
	readonly refusals: readonly number[]
	readonly failures: readonly number[]
	readonly iterable?: boolean
}

/** Holds the list shapes that tell one-entry-at-a-time reading from a copy that reads ahead. */
export const POLICY_LAZY_SHAPES = Object.freeze({
	empty: { label: 'an empty list', length: 0, entries: [], refusals: [], failures: [] },
	dense: { label: 'one entry', length: 1, entries: [0], refusals: [], failures: [] },
	hole: { label: 'a hole, then an entry', length: 2, entries: [1], refusals: [], failures: [] },
	holeFailure: {
		label: 'a hole, then a failing entry',
		length: 2,
		entries: [],
		refusals: [],
		failures: [1],
	},
	failureFirst: {
		label: 'a failing entry, then an entry',
		length: 2,
		entries: [1],
		refusals: [],
		failures: [0],
	},
	refusalFirst: {
		label: 'a refused entry, then an entry',
		length: 2,
		entries: [1],
		refusals: [0],
		failures: [],
	},
	holeBetween: {
		label: 'an entry, a hole, then an entry',
		length: 3,
		entries: [0, 2],
		refusals: [],
		failures: [],
	},
	unlisted: {
		label: 'two entries on a list without an iterator',
		length: 2,
		entries: [0, 1],
		refusals: [],
		failures: [],
		iterable: false,
	},
} satisfies Record<string, PolicyLazyShape>)

/** Holds values a reader's signature refuses, which a case feeds it to make processing fail. */
export const POLICY_REFUSALS = Object.freeze({ number: 7, symbol: Symbol('refused') })

/**
 * Creates a revoked proxy, which refuses every guard that inspects it.
 *
 * @returns The proxy, whose `Array.isArray` check throws a `TypeError`.
 */
export function createPolicyRevoked(): object {
	const { proxy, revoke } = Proxy.revocable({}, {})
	revoke()
	return proxy
}

/**
 * Creates a producer of revoked proxies over what another producer creates.
 *
 * @param entry - The producer whose value each proxy wraps.
 * @returns A producer whose value refuses every read, which fails a reader once it holds the entry.
 */
export function createPolicyRefused<T extends object>(entry: () => T): () => T {
	return () => {
		const { proxy, revoke } = Proxy.revocable(entry(), {})
		revoke()
		return proxy
	}
}

/** Creates a lint source over text and its comments that declares no variable. */
export function createPolicySource(
	text: string,
	comments: readonly PolicyComment[] = [],
): PolicyScopeCode {
	return { text, getAllComments: () => comments, getDeclaredVariables: () => [] }
}

/** Creates a lint context over an empty source that appends each diagnostic to the given log. */
export function createPolicyContext(
	filename: string,
	cwd: string,
	reports: PolicyDiagnostic[],
): PolicyContext {
	return {
		filename,
		cwd,
		sourceCode: createPolicySource(''),
		report: (diagnostic) => {
			reports.push(diagnostic)
		},
	}
}

/** Creates a variable declarator named `run` whose value is an arrow function. */
export function createPolicyDeclarator(): PolicyExpression {
	return {
		type: 'VariableDeclarator',
		range: [0, 0],
		id: { type: 'Identifier', range: [0, 0], name: 'run' },
		init: { type: 'ArrowFunctionExpression', range: [0, 0] },
	}
}

/** Creates a named export of a function declaration named `run`. */
export function createPolicyExport(): PolicyExpression {
	return {
		type: 'ExportNamedDeclaration',
		range: [47, 63],
		declaration: {
			type: 'FunctionDeclaration',
			range: [0, 0],
			id: { type: 'Identifier', range: [0, 0], name: 'run' },
		},
	}
}

/** Creates the one-sentence block comment a doc reader reads above an export. */
export function createPolicyComment(): PolicyComment {
	return { type: 'Block', value: '* One.', range: [0, 11] }
}

/**
 * Creates one case per list shape for a reader of a caller-supplied list.
 *
 * @param subject - The text naming the reader.
 * @param reader - The reader to run over each list.
 * @param producers - The producer behind each entry the reader accepts, and behind each it refuses.
 * @param rows - Each shape with the settled outcome and the indexes the reader must read, in order.
 * @returns One case per row.
 */
export function createPolicyLazyCases<T>(
	subject: string,
	reader: (list: T[]) => unknown,
	producers: { readonly valid: () => T; readonly refusal: () => T },
	rows: ReadonlyArray<readonly [PolicyLazyShape, string, readonly number[]]>,
): readonly PolicyLazyCase[] {
	return rows.map(([shape, outcome, reads]) =>
		createPolicyLazyCase(
			`${subject}: ${shape.label}`,
			reader,
			{
				length: shape.length,
				entries: new Map<number, () => T>([
					...shape.entries.map((index): [number, () => T] => [index, producers.valid]),
					...shape.refusals.map((index): [number, () => T] => [index, producers.refusal]),
					...shape.failures.map((index): [number, () => T] => [index, failPolicyRead]),
				]),
				iterable: shape.iterable ?? true,
			},
			{ outcome, reads },
		),
	)
}

/**
 * Holds one case per reader and list shape for the readers that take a caller-supplied list.
 *
 * @remarks
 * Each outcome and read list is what the loop each reader replaced produced. A hole is visited as
 * `undefined`, an entry after a failing one is never read, a refusal names its constructor, and a
 * list without an iterator is refused with a `TypeError` before any entry is read.
 */
export const POLICY_LAZY_CASES: readonly PolicyLazyCase[] = Object.freeze([
	...createPolicyLazyCases(
		'inspectPolicyMirrorPaths',
		(list: string[]) => inspectPolicyMirrorPaths(list, new Set()).map(({ path }) => path),
		{
			valid: () => 'tests/src/core/A.test.ts',
			// The descriptor read answers `any`, so a value the signature refuses reaches the reader.
			refusal: () => Object.getOwnPropertyDescriptor(POLICY_REFUSALS, 'symbol')?.value,
		},
		[
			[POLICY_LAZY_SHAPES.empty, 'return []', []],
			[POLICY_LAZY_SHAPES.dense, 'return ["tests/src/core/A.test.ts"]', [0]],
			[POLICY_LAZY_SHAPES.hole, 'throw TypeError', []],
			[POLICY_LAZY_SHAPES.holeFailure, 'throw TypeError', []],
			[POLICY_LAZY_SHAPES.failureFirst, 'throw RangeError', [0]],
			[POLICY_LAZY_SHAPES.refusalFirst, 'throw TypeError', [0]],
			[POLICY_LAZY_SHAPES.holeBetween, 'throw TypeError', [0]],
			[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []],
		],
	),
	...createPolicyLazyCases(
		'inspectPolicyWiring rules',
		(list: string[]) => inspectPolicyWiring({}, list, []),
		{
			valid: () => 'a',
			refusal: () => Object.getOwnPropertyDescriptor(POLICY_REFUSALS, 'symbol')?.value,
		},
		[
			[POLICY_LAZY_SHAPES.empty, 'return []', []],
			[
				POLICY_LAZY_SHAPES.dense,
				'return ["a is enabled by no top-level or override rules record"]',
				[0],
			],
			[
				POLICY_LAZY_SHAPES.hole,
				'return ["undefined is enabled by no top-level or override rules record","a is enabled by no top-level or override rules record"]',
				[1],
			],
			[POLICY_LAZY_SHAPES.holeFailure, 'throw RangeError', [1]],
			[POLICY_LAZY_SHAPES.failureFirst, 'throw RangeError', [0]],
			[POLICY_LAZY_SHAPES.refusalFirst, 'throw TypeError', [0]],
			[
				POLICY_LAZY_SHAPES.holeBetween,
				'return ["a is enabled by no top-level or override rules record","undefined is enabled by no top-level or override rules record","a is enabled by no top-level or override rules record"]',
				[0, 2],
			],
			[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []],
		],
	),
	...createPolicyLazyCases(
		'inspectPolicyWiring populations',
		(list: Array<readonly string[]>) => inspectPolicyWiring({}, [], list),
		{
			valid: () => ['a'],
			refusal: () => Object.getOwnPropertyDescriptor(POLICY_REFUSALS, 'number')?.value,
		},
		[
			[POLICY_LAZY_SHAPES.empty, 'return []', []],
			[
				POLICY_LAZY_SHAPES.dense,
				'return ["no override files list declares the population exactly: a"]',
				[0],
			],
			[POLICY_LAZY_SHAPES.hole, 'throw TypeError', []],
			[POLICY_LAZY_SHAPES.holeFailure, 'throw TypeError', []],
			[POLICY_LAZY_SHAPES.failureFirst, 'throw RangeError', [0]],
			[POLICY_LAZY_SHAPES.refusalFirst, 'throw TypeError', [0]],
			[POLICY_LAZY_SHAPES.holeBetween, 'throw TypeError', [0]],
			[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []],
		],
	),
	...createPolicyLazyCases(
		'inspectPolicyWiring overrides',
		(list: unknown[]) => inspectPolicyWiring({ overrides: list }, [], []),
		{ valid: () => ({ files: ['a'] }), refusal: createPolicyRevoked },
		[
			[POLICY_LAZY_SHAPES.empty, 'return []', []],
			[POLICY_LAZY_SHAPES.dense, 'return []', [0]],
			[POLICY_LAZY_SHAPES.hole, 'return []', [1]],
			[POLICY_LAZY_SHAPES.holeFailure, 'throw RangeError', [1]],
			[POLICY_LAZY_SHAPES.failureFirst, 'throw RangeError', [0]],
			[POLICY_LAZY_SHAPES.refusalFirst, 'throw TypeError', [0]],
			[POLICY_LAZY_SHAPES.holeBetween, 'return []', [0, 2]],
			[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []],
		],
	),
	...createPolicyLazyCases(
		'inspectPolicyConfiguration overrides',
		(list: unknown[]) =>
			inspectPolicyConfiguration({
				rules: POLICY_WIRING_SETTINGS,
				overrides: list,
			}),
		{ valid: () => ({}), refusal: createPolicyRevoked },
		[
			[POLICY_LAZY_SHAPES.empty, 'return []', []],
			[POLICY_LAZY_SHAPES.dense, 'return []', [0]],
			[POLICY_LAZY_SHAPES.hole, 'return ["override entries must be records"]', [1]],
			[POLICY_LAZY_SHAPES.holeFailure, 'throw RangeError', [1]],
			[POLICY_LAZY_SHAPES.failureFirst, 'throw RangeError', [0]],
			[POLICY_LAZY_SHAPES.refusalFirst, 'throw TypeError', [0]],
			[POLICY_LAZY_SHAPES.holeBetween, 'return ["override entries must be records"]', [0, 2]],
			[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []],
		],
	),
	...createPolicyLazyCases(
		'inspectPolicyConfiguration ignorePatterns',
		(list: unknown[]) =>
			inspectPolicyConfiguration({
				rules: POLICY_WIRING_SETTINGS,
				ignorePatterns: list,
			}),
		// The reader skips every entry that is not a string, so no entry refuses it and no row uses the
		// refusal.
		{ valid: () => 'src', refusal: createPolicyRevoked },
		[
			[POLICY_LAZY_SHAPES.empty, 'return []', []],
			[POLICY_LAZY_SHAPES.dense, 'return ["ignorePatterns must not reach src"]', [0]],
			[POLICY_LAZY_SHAPES.hole, 'return ["ignorePatterns must not reach src"]', [1]],
			[POLICY_LAZY_SHAPES.holeFailure, 'throw RangeError', [1]],
			[POLICY_LAZY_SHAPES.failureFirst, 'throw RangeError', [0]],
			[
				POLICY_LAZY_SHAPES.holeBetween,
				'return ["ignorePatterns must not reach src","ignorePatterns must not reach src"]',
				[0, 2],
			],
			[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []],
		],
	),
	...createPolicyLazyCases(
		'inspectPolicyFilenamePaths',
		(list: string[]) => inspectPolicyFilenamePaths(list).map(({ path }) => path),
		{
			valid: () => 'src/a.ts',
			refusal: () => Object.getOwnPropertyDescriptor(POLICY_REFUSALS, 'symbol')?.value,
		},
		[[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []]],
	),
])

/** Describes a population a guide states, the words that mark a sentence stating it, and its exclusion. */
export interface PolicyPopulation {
	readonly subject: string
	readonly markers: readonly string[]
	readonly exclusion: string
}

/** Describes the population of test files that selects the `studies` fact, and what it leaves out. */
export const POLICY_STUDIES_POPULATION: PolicyPopulation = Object.freeze({
	subject: '`studies`',
	markers: Object.freeze(['`*.test.ts`', 'test files']),
	exclusion: 'outside any `node_modules` or `.git` directory',
})

/**
 * Collects the guide prose sentences that state one population.
 *
 * @remarks
 * A sentence states the population when it names the subject and one marker. A fenced code block
 * is not prose. The lines of a block that are not table rows are joined into one text, and each
 * cell of a table row is a text of its own, so a `Summary` cell that equals its export's
 * description is held to the same sentences as the prose: the source doc block is where that cell's
 * wording is decided.
 *
 * @param markdown - The guide Markdown.
 * @param population - The subject, markers, and exclusion that describe the population.
 * @returns Each sentence that states the population, in document order.
 */
export function collectGuideStatements(
	markdown: string,
	population: PolicyPopulation,
): readonly string[] {
	return markdown
		.replaceAll(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gmu, '')
		.split(/(?:\r\n|\n){2,}/u)
		.flatMap((block) => {
			const lines = block.split(/\r\n|\n/u)
			return [
				lines.filter((line) => !line.startsWith('|')).join(' '),
				...lines.filter((line) => line.startsWith('|')).flatMap((row) => row.split(/(?<!\\)\|/u)),
			].flatMap((text) =>
				text
					.replaceAll(/\s+/gu, ' ')
					.trim()
					.split(/(?<=[.!?])\s+/u),
			)
		})
		.filter(
			(sentence) =>
				sentence.includes(population.subject) &&
				population.markers.some((marker) => sentence.includes(marker)),
		)
}

/** Names the security identifier of the group every access token holds, in the form `icacls` accepts. */
export const POLICY_DENY_PRINCIPAL = '*S-1-1-0'

/**
 * Runs one executable to completion and returns what it printed.
 *
 * @param file - The executable to run, resolved by name.
 * @param args - The arguments, passed without a shell.
 * @returns The standard output.
 * @throws Error - Thrown when the executable cannot start or exits with a non-zero status.
 */
export function runPolicyCommand(file: string, args: readonly string[]): string {
	const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true })
	if (result.error !== undefined) throw result.error
	if (result.status !== 0)
		throw new Error(
			`${file} ${args.join(' ')} exited with ${result.status}: ${result.stdout}${result.stderr}`,
		)
	return result.stdout
}

/**
 * Reads the permission state of one file as text two readings compare for equality.
 *
 * @remarks
 * Permission state is platform-defined. A POSIX file carries a mode, read as its octal digits
 * through `statSync`, and a Windows file carries an access-control list, read as the `icacls`
 * listing of the path, so the text holds every explicit and inherited entry in order.
 *
 * @param path - The absolute path of an existing file.
 * @returns The octal mode on POSIX, and the `icacls` listing on Windows.
 * @throws Error - Thrown when the Windows listing command exits with a non-zero status.
 */
export function readPolicyPermissions(path: string): string {
	return process.platform === 'win32'
		? runPolicyCommand('icacls', [path])
		: (statSync(path).mode & 0o7777).toString(8)
}

/**
 * Withholds read access to one file from the current user.
 *
 * @remarks
 * Read permission is platform-defined. A POSIX mode of zero withholds it from every user but root,
 * and a Windows access-control entry that denies read withholds it from the holder of every token.
 * A `package.json` that is a directory cannot stand in for this: the regular-file check refuses it
 * before any read starts, so only a file the host refuses to open reaches the read boundary.
 *
 * The restore returns the permission state it found. A POSIX restore writes back the mode read
 * before the change. A Windows restore removes the deny entries of the one principal the denial
 * names, because `icacls /restore` of a saved list needs a restore privilege a standard token does
 * not hold, and `/remove:d` of the user would also strip a deny entry the file already carried. A
 * restore that leaves the state different, as an earlier deny entry for that principal would,
 * throws rather than report success.
 *
 * @param path - The absolute path of an existing file.
 * @returns A function that restores the access, to run before the owning directory is removed.
 * @throws Error - Thrown when a command exits with a non-zero status or the restore differs.
 */
export function denyPolicyRead(path: string): () => void {
	const before = readPolicyPermissions(path)
	if (process.platform === 'win32') {
		runPolicyCommand('icacls', [path, '/deny', `${POLICY_DENY_PRINCIPAL}:(R)`])
	} else {
		chmodSync(path, 0o000)
	}
	return () => {
		if (process.platform === 'win32') {
			runPolicyCommand('icacls', [path, '/remove:d', POLICY_DENY_PRINCIPAL])
		} else {
			chmodSync(path, before)
		}
		if (readPolicyPermissions(path) !== before)
			throw new Error(`The permissions of ${path} did not restore exactly`)
	}
}

/** Holds parsed skill frontmatter and the exact scalar source used for bridge comparison. */
export interface SkillFrontmatter {
	readonly keys: readonly string[]
	readonly name: string | undefined
	readonly description: string | undefined
	readonly source: {
		readonly name: string | undefined
		readonly description: string | undefined
	}
}

/** Holds the keys and fields read so far from one frontmatter and the last line a folded block consumed. */
export interface SkillFrontmatterScan {
	readonly keys: readonly string[]
	readonly skipThrough: number
	readonly fields: ReadonlyArray<
		readonly [string, { readonly value: string; readonly source: string }]
	>
}

/** Names the directory whose immediate child directories form the complete skill family. */
export const SKILL_FAMILY_ROOT = '.agents/skills'

/** Names the directory whose immediate child directories form the Claude skill bridge family. */
export const SKILL_BRIDGE_ROOT = '.claude/skills'

/** Names the directory whose tree mirrors `.agents/skills/<skill>/scripts/*.ts` as `*.test.ts` proofs. */
export const SKILL_PROOF_ROOT = 'tests/agents/skills'

/** Holds the minimal valid skill text for physical family controls. */
export const SKILL_POLICY_TEXT =
	'---\nname: sample\ndescription: Use this skill for a policy fixture.\n---\n\n# Skill\n'

/** Holds skill text naming one reference for physical family controls. */
export const SKILL_REFERENCE_TEXT = `${SKILL_POLICY_TEXT}\nRead references/example.md.\n`

/** Holds the minimal valid provider bridge text for physical bridge controls. */
export const SKILL_BRIDGE_TEXT = `${SKILL_POLICY_TEXT}\nRead \`.agents/skills/sample/SKILL.md\`.\n`

/** Holds canonical skill metadata whose values each carry YAML's escaped apostrophe. */
export const SKILL_APOSTROPHE_METADATA =
	"interface:\n  display_name: 'Owner''s Fixture'\n" +
	"  short_description: 'Exercise the family''s apostrophe rule'\n" +
	"  default_prompt: 'Use $sample for this fixture''s value.'\n"

/** Lists every extension through which a mirrored test can name a module. */
export const POLICY_MODULE_EXTENSIONS: readonly string[] = Object.freeze([
	'cts',
	'mts',
	'ts',
	'tsx',
	'vue',
	'scss',
	'css',
])

/**
 * Lists the module extensions whose extensionless stem can resolve a leading-underscore partial.
 */
export const POLICY_PARTIAL_EXTENSIONS: readonly string[] = Object.freeze(['scss', 'css'])

/** Names the reserved stem prefix whose mirrored module can resolve inside the tests axis. */
export const POLICY_TESTS_MODULE_PREFIX = 'setup'

/**
 * Matches the complete module population available to mirrored tests under either workspace axis.
 */
export const POLICY_MODULE_GLOB = `{app,src}/**/*.{${POLICY_MODULE_EXTENSIONS.join(',')}}`

/** Matches the tests-axis setup module population available to mirrored tests. */
export const POLICY_TESTS_MODULE_GLOB = `tests/**/${POLICY_TESTS_MODULE_PREFIX}*.ts`

/**
 * Lists the root setup modules a workspace authors; scaffold owns `tests/setupPolicy.ts` and
 * `tests/setupDistribution.ts` beside them.
 */
export const POLICY_SETUP_MODULES: readonly string[] = Object.freeze([
	'tests/setup.ts',
	'tests/setupServer.ts',
	'tests/setupBrowser.ts',
	'tests/setupStyles.ts',
	'tests/setupStudy.ts',
	'tests/setupService.ts',
	'tests/setupGlobal.ts',
])

/** Names the correction a tests-tree module outside the root setup modules receives. */
export const POLICY_INFRASTRUCTURE_MESSAGE = `test infrastructure lives only in ${POLICY_SETUP_MODULES.join(', ')}: move this module's declarations into the one its environment names, or under a fixtures/ directory when a test runs it as its own entry`

/** Matches every TypeScript module the tests tree holds. */
export const POLICY_TESTS_SOURCE_GLOB = 'tests/**/*.{ts,mts,cts,tsx}'

/** Matches the mirrored module-test population inspected under either workspace axis. */
export const POLICY_TEST_GLOB = 'tests/{app,src}/**/*.test.ts'

// Compose suppression tokens so the instrument does not report its own definitions or controls.
export const POLICY_SUPPRESSION_DIRECTIVE = ['oxlint', '-disable'].join('')

/** Names the formatter directive the text sweep refuses, composed so the instrument does not report itself. */
export const POLICY_FORMATTER_DIRECTIVE = ['prettier', '-ignore'].join('')

/** Matches the source, test, config, script, skill script, and sheet files inspected for lint and formatter suppression directives. */
export const POLICY_SUPPRESSION_GLOB: readonly string[] = Object.freeze([
	'{src,app,tests,configs,scripts}/**/*.{cjs,css,cts,js,jsx,mjs,mts,scss,ts,tsx,vue}',
	'*.{cjs,css,cts,js,jsx,mjs,mts,scss,ts,tsx,vue}',
	'.agents/skills/*/scripts/*.ts',
])

/** Matches the TypeScript files inspected for an import that resolves into the built output. */
export const POLICY_DIST_GLOB = '{src,app,tests,configs}/**/*.{cts,mts,ts,tsx}'

/** Names the workspace-relative directory the build writes and no tracked TypeScript imports. */
export const POLICY_DIST_ROOT = 'dist'

/**
 * Matches the instruction, configuration, and root text files the text sweep reads beside the
 * authored Markdown and the suppression population.
 */
export const POLICY_TEXT_GLOB: readonly string[] = Object.freeze([
	'{.agents,.claude,.codex,.cursor}/**/*.{toml,yaml,yml,mdc,json}',
	'*.json',
	'.*.json',
	'.gitattributes',
	'.prettierignore',
])

/**
 * Maps each rule whose workspace-wide lint wiring must not be weakened to the whole top-level
 * setting the shipped configuration declares for it.
 *
 * @remarks
 * A setting carries its options as well as its severity, so a rule listed at `error` with an option
 * that switches its check off differs from the value declared here.
 */
export const POLICY_WIRING_SETTINGS: Readonly<Record<string, unknown>> = Object.freeze({
	'policy/no-mocking': 'error',
	'policy/no-keyword-privacy': 'error',
	'policy/no-let': 'error',
	'policy/no-malformed-summary': 'error',
	'policy/no-banned-term': 'error',
	'no-var': 'error',
	'prefer-const': 'error',
	'no-param-reassign': 'error',
	'no-ex-assign': 'error',
	'vitest/no-identical-title': 'error',
	'vitest/no-focused-tests': 'error',
	'vitest/no-disabled-tests': 'error',
	'typescript/parameter-properties': 'error',
	'typescript/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
})

/** Lists the rules whose workspace-wide lint wiring must not be weakened by configuration. */
export const POLICY_WIRING_RULES: readonly string[] = Object.freeze(
	Object.keys(POLICY_WIRING_SETTINGS),
)

/** Lists the linted workspace roots that ignore patterns must not reach. */
export const POLICY_WIRING_ROOTS: readonly string[] = Object.freeze([
	'src',
	'app',
	'tests',
	'configs',
	'.agents',
])

/** Matches a character that makes a path segment a glob rather than a literal name. */
export const POLICY_GLOB_CHARACTER = /[*?[\]{}]/u

/** Matches either lint suppression token or the formatter directive the text sweep refuses. */
export const POLICY_SUPPRESSION_PATTERN = new RegExp(
	[['eslint', '-disable'].join(''), POLICY_SUPPRESSION_DIRECTIVE, POLICY_FORMATTER_DIRECTIVE].join(
		'|',
	),
	'u',
)

/**
 * Holds the decoder the text sweep reads bytes through.
 *
 * @remarks
 * `fatal` refuses a byte sequence UTF-8 does not carry, and `ignoreBOM` keeps a leading byte-order
 * mark in the decoded text, where the default would drop it before the sweep could see it.
 */
export const POLICY_TEXT_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Lists the control code points a text file may carry: tab, line feed, and carriage return. */
export const POLICY_TEXT_CONTROLS: readonly number[] = Object.freeze([0x09, 0x0a, 0x0d])

/** Holds the code point of the replacement character a failed decode leaves behind. */
export const POLICY_TEXT_REPLACEMENT = 0xfffd

/** Holds the code point of the byte-order mark. */
export const POLICY_TEXT_MARK = 0xfeff

/**
 * Matches the workspace-authored path population inspected for a name a Windows checkout cannot
 * hold.
 */
export const POLICY_PORTABILITY_GLOB: readonly string[] = Object.freeze([
	'{src,app,configs,tests,scripts,guides}/**/*',
	'{.agents,.claude,.codex,.cursor,.github}/**/*',
	'*',
	'.*',
])

/** Lists every device name Windows reserves, whatever extension the segment carries. */
export const POLICY_RESERVED_NAMES: readonly string[] = Object.freeze([
	'aux',
	'com1',
	'com2',
	'com3',
	'com4',
	'com5',
	'com6',
	'com7',
	'com8',
	'com9',
	'con',
	'lpt1',
	'lpt2',
	'lpt3',
	'lpt4',
	'lpt5',
	'lpt6',
	'lpt7',
	'lpt8',
	'lpt9',
	'nul',
	'prn',
])

/** Matches every character Windows refuses inside a path segment. */
export const POLICY_RESERVED_PATTERN = /[<>:"|?*]/u

/** Matches a shell script named as a complete path token inside a manifest script. */
export const POLICY_SHELL_PATTERN = /\.sh\b/u

/** Lists the extensions of the shell, PowerShell, Python, and batch files a workspace keeps under one directory. */
export const POLICY_SHELL_EXTENSIONS: readonly string[] = Object.freeze([
	'.sh',
	'.bash',
	'.ps1',
	'.py',
	'.bat',
	'.cmd',
])

/** Names the one directory whose files are Cloud setup hooks, the shell files a workspace admits. */
export const POLICY_SHELL_ROOT = 'scripts'

/** Names the directory whose direct Markdown files form the complete rule family. */
export const POLICY_RULE_ROOT = '.claude/rules'

/** Names the root instruction file whose rule map registers the rule family. */
export const POLICY_RULE_MAP_FILE = 'AGENTS.md'

/** Names the heading that opens the root instruction file's rule map table. */
export const POLICY_RULE_MAP_HEADING = '## Rule map'

/** Names the workspace manifest whose scripts run on every supported host. */
export const POLICY_MANIFEST_FILE = 'package.json'

/** Lists the directory names the prose sweep never descends into. */
export const POLICY_PROSE_EXCLUSIONS: readonly string[] = Object.freeze([
	'.git',
	'.orkestrel',
	'dist',
	'node_modules',
	'tmp',
])

/** Matches a top-level guide path and captures the package short name it is written for. */
export const POLICY_MIRROR_PATTERN = /^guides\/([^/]+)\.md$/u

/** Names the guide a workspace holds as its own index rather than as a mirror. */
export const POLICY_GUIDE_MAP = 'README'

/** Names the rule file whose substitution table is the denylist's source. */
export const POLICY_TERM_FILE = '.claude/rules/writing.md'

/** Names the heading that opens the substitution table. */
export const POLICY_TERM_HEADING = '## Substitutions'

/**
 * Names the catalog agent file whose table registers every fleet package.
 *
 * @remarks
 * The path is written here rather than read from the scaffold constant that plans it, because this
 * module is vendored byte-identical into every workspace and imports nothing from the package.
 */
export const POLICY_CATALOG_FILE = '.claude/agents/orkestrel.md'

/** Names the heading that opens the package catalog. */
export const POLICY_CATALOG_HEADING = '## Package catalog'

/**
 * Normalizes platform separators for stable matching and diagnostics.
 *
 * @param path - The workspace-relative path to normalize.
 * @returns The path with forward slashes and no duplicate separators.
 */
export function normalizePolicyPath(path: string): string {
	return path.replaceAll('\\', '/').replace(/\/+/gu, '/')
}

/**
 * Normalizes a native path or `file:` URI for workspace-relative policy comparisons.
 *
 * @param root - The host path used as the comparison root.
 * @param filename - The diagnostic filename as a native path or `file:` URI.
 * @returns The normalized path relative to the resolved comparison root.
 * @throws Thrown when a `file:` filename is not a valid file URI.
 */
export function normalizePolicyFilename(root: string, filename: string): string {
	const base = resolve(root)
	const path = filename.startsWith('file:') ? fileURLToPath(filename) : resolve(base, filename)
	return normalizePolicyPath(relativePath(base, path))
}

/**
 * Reports whether a parsed configuration value is a plain record rather than an array or a
 * primitive.
 */
export function isPolicyRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses JSON text without throwing.
 *
 * @param content - The raw JSON text.
 * @returns The parsed value, or `undefined` when the text is not JSON.
 */
export function parsePolicyJSON(content: string): unknown {
	try {
		return JSON.parse(content)
	} catch {
		return undefined
	}
}

/**
 * Reads one file and parses its JSON without throwing.
 *
 * @remarks
 * One boundary holds the read and the parse, so a file the host refuses to open answers as a file
 * that holds no JSON.
 *
 * @param path - The absolute path of the file to read.
 * @returns The parsed value, or `undefined` when the file cannot be read or holds no JSON.
 */
export function readPolicyJSON(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch {
		return undefined
	}
}

/**
 * Extracts the lines beneath one heading, up to the next second-level heading.
 *
 * @param lines - The document lines.
 * @param heading - The index of the heading line whose section is read.
 * @returns Each line after the heading and before the next line starting with `## `, in order.
 */
export function extractPolicySection(lines: readonly string[], heading: number): readonly string[] {
	const following = lines.slice(heading + 1)
	const end = following.findIndex((line) => line.startsWith('## '))
	return end === -1 ? following : following.slice(0, end)
}

/**
 * Creates one stable violation for an inspection result.
 *
 * @param rule - The rule that failed.
 * @param path - The workspace-relative source path.
 * @param message - The failure text.
 * @param line - The one-based source line the violation occurred on, when known.
 * @returns The stable violation record.
 */
export function createPolicyViolation(
	rule: PolicyRule,
	path: string,
	message: string,
	line?: number,
): PolicyViolation {
	return line === undefined ? { rule, path, message } : { rule, path, line, message }
}

/**
 * Derives the extensionless module stem for one mirrored module test.
 *
 * @param path - The workspace-relative test path.
 * @returns The extensionless module stem, or `undefined` for a reserved scope test.
 */
export function testToPolicyStem(path: string): string | undefined {
	const normalized = normalizePolicyPath(path)
	if (basename(normalized) === 'integration.test.ts') return undefined
	if (!normalized.startsWith('tests/') || !normalized.endsWith('.test.ts')) return undefined
	return normalized.slice('tests/'.length, -'.test.ts'.length)
}

/**
 * Lists every module name a registered language resolves for a stem.
 *
 * @param stem - The extensionless workspace-relative module stem.
 * @returns Direct modules, partial modules, then a matching tests-axis setup module.
 */
export function stemToPolicyCandidates(stem: string): readonly string[] {
	const normalized = normalizePolicyPath(stem)
	const directory = dirname(normalized).replaceAll('\\', '/')
	const name = basename(normalized)
	return [
		...POLICY_MODULE_EXTENSIONS.map((extension) => `${normalized}.${extension}`),
		...POLICY_PARTIAL_EXTENSIONS.map((extension) => `${directory}/_${name}.${extension}`),
		...(name.startsWith(POLICY_TESTS_MODULE_PREFIX) ? [`tests/${normalized}.ts`] : []),
	]
}

/**
 * Inspects mirrored test paths against an explicit module-path population.
 *
 * @param tests - The module-test paths to inspect.
 * @param modules - The existing module paths in every registered language.
 * @returns Every missing mirror violation in test-path order.
 */
export function inspectPolicyMirrorPaths(
	tests: readonly string[],
	modules: ReadonlySet<string>,
): readonly PolicyViolation[] {
	// The mapper runs on each entry as the iterator yields it, so a hole reaches normalization as
	// `undefined` and no entry after a failing one is read, as in the loop this replaced.
	return Iterator.from(tests)
		.flatMap((test) => {
			const path = normalizePolicyPath(test)
			const stem = testToPolicyStem(path)
			if (stem === undefined) return []
			const candidates = stemToPolicyCandidates(stem)
			return candidates.some((candidate) => modules.has(candidate))
				? []
				: [
						createPolicyViolation(
							'mirror',
							path,
							`module test requires one matching module: ${candidates.join(', ')}`,
						),
					]
		})
		.toArray()
}

/**
 * Inspects every mirrored module test beneath one workspace.
 *
 * @param root - The workspace root to inspect.
 * @returns Every missing mirror violation in test-path order.
 */
export function inspectPolicyMirrors(root: string): readonly PolicyViolation[] {
	const tests = globSync(POLICY_TEST_GLOB, { cwd: root }).sort().map(normalizePolicyPath)
	const modules = new Set([
		...globSync(POLICY_MODULE_GLOB, { cwd: root }).sort().map(normalizePolicyPath),
		...globSync(POLICY_TESTS_MODULE_GLOB, { cwd: root }).sort().map(normalizePolicyPath),
	])
	return [
		...inspectPolicyMirrorPaths(tests, modules),
		...inspectPolicySetup(root),
		...inspectPolicyInfrastructure(root),
	]
}

/**
 * Checks whether a normalized path belongs to a scaffold-owned setup module.
 * @param path - The workspace-relative module path.
 * @param root - The workspace root whose manifest determines harness ownership.
 * @returns True if scaffold owns the module; false otherwise.
 */
export function matchesScaffoldSetup(path: string, root: string): boolean {
	const normalized = normalizePolicyPath(path)
	const manifest = readPolicyJSON(join(root, 'package.json'))
	return (
		(normalized === DISTRIBUTION_SETUP_PATH &&
			(!isPolicyRecord(manifest) || manifest.private !== true)) ||
		HOST_PATHS.some(
			(vendored) =>
				normalized === normalizePolicyPath(vendored) ||
				normalized.startsWith(normalizePolicyPath(vendored) + '/'),
		)
	)
}

/**
 * Inspects root setup modules and their proofs in both directions.
 * @param root - The workspace root to inspect.
 * @returns Missing modules and uncovered exporting setup modules.
 */
export function inspectPolicySetup(root: string): readonly PolicyViolation[] {
	const paths = new Set(globSync('tests/setup*.ts', { cwd: root }).map(normalizePolicyPath))
	const shared = paths.has('tests/setup.test.ts')
		? readFileSync(join(root, 'tests/setup.test.ts'), 'utf8')
		: ''
	const imports = new Set(
		parseAst(shared, { lang: 'ts' }).body.flatMap((declaration) =>
			declaration.type === 'ImportDeclaration' &&
			/^\.\/setup[^/]*\.(?:js|ts)$/u.test(declaration.source.value)
				? ['tests/' + declaration.source.value.slice(2).replace(/\.js$/u, '.ts')]
				: [],
		),
	)
	return [...paths].sort().flatMap((path) => {
		const module = path.endsWith('.test.ts') ? path.replace(/\.test\.ts$/u, '.ts') : path
		if (matchesScaffoldSetup(module, root)) return []
		if (path.endsWith('.test.ts')) {
			return paths.has(module)
				? []
				: [createPolicyViolation('mirror', path, `setup proof requires its module: ${module}`)]
		}
		// A setup-named module outside the canon's set is the placement inspector's finding alone.
		if (!POLICY_SETUP_MODULES.includes(path) && path !== DISTRIBUTION_SETUP_PATH) return []
		return /^export /m.test(readFileSync(join(root, path), 'utf8')) &&
			!paths.has(path.replace(/\.ts$/u, '.test.ts')) &&
			!imports.has(path)
			? [
					createPolicyViolation(
						'mirror',
						path,
						'exporting setup module requires its sibling proof or an import from tests/setup.test.ts',
					),
				]
			: []
	})
}

/**
 * Checks whether a tests-tree module sits where test infrastructure may live.
 *
 * @param path - The workspace-relative module path.
 * @param root - The workspace root whose manifest determines harness ownership.
 * @returns True if the module is a test, a bench, a declaration file, a root setup module the
 * canon names, a scaffold-owned module, or a file under a `fixtures/` directory; false otherwise.
 * @example
 * ```ts
 * matchesPolicyInfrastructure('tests/setupServer.ts', root) // true
 * matchesPolicyInfrastructure('tests/setupConformance.ts', root) // false
 * ```
 */
export function matchesPolicyInfrastructure(path: string, root: string): boolean {
	const normalized = normalizePolicyPath(path)
	return (
		/\.(?:test|bench)\.ts$/u.test(normalized) ||
		/\.d\.[cm]?ts$/u.test(normalized) ||
		POLICY_SETUP_MODULES.includes(normalized) ||
		normalized === DISTRIBUTION_SETUP_PATH ||
		matchesScaffoldSetup(normalized, root) ||
		normalized.split('/').includes('fixtures')
	)
}

/**
 * Inspects the tests tree for test infrastructure outside the root setup modules the canon names.
 *
 * @param root - The workspace root to inspect.
 * @returns One mirror violation per misplaced module, in path order.
 */
export function inspectPolicyInfrastructure(root: string): readonly PolicyViolation[] {
	return globSync(POLICY_TESTS_SOURCE_GLOB, { cwd: root })
		.map(normalizePolicyPath)
		.filter((path) => !path.split('/').includes('node_modules'))
		.sort()
		.filter((path) => !matchesPolicyInfrastructure(path, root))
		.map((path) => createPolicyViolation('mirror', path, POLICY_INFRASTRUCTURE_MESSAGE))
}

/**
 * Inspects code-shaped and sheet workspace files for lint and formatter suppression directives.
 *
 * @param root - The workspace root to inspect.
 * @returns Every suppression occurrence in path and line order.
 */
export function inspectPolicySuppressions(root: string): readonly PolicyViolation[] {
	const paths = globSync(POLICY_SUPPRESSION_GLOB, { cwd: root }).map(normalizePolicyPath).sort()
	return paths.flatMap((path) =>
		readFileSync(join(root, path), 'utf8')
			.split('\n')
			.flatMap((line, index) =>
				POLICY_SUPPRESSION_PATTERN.test(line)
					? [
							createPolicyViolation(
								'suppression',
								path,
								'file carries a lint or formatter suppression directive',
								index + 1,
							),
						]
					: [],
			),
	)
}

/**
 * Decodes file bytes as UTF-8 without throwing.
 *
 * @param bytes - The raw file bytes.
 * @returns The decoded text with any leading byte-order mark kept, or `undefined` when the bytes
 * are not valid UTF-8.
 */
export function parsePolicyText(bytes: Uint8Array): string | undefined {
	try {
		return POLICY_TEXT_DECODER.decode(bytes)
	} catch {
		return undefined
	}
}

/**
 * Reports whether one code point is a character the text sweep refuses.
 *
 * @remarks
 * The sweep refuses the replacement character, the byte-order mark, and every C0 or C1 control
 * character other than the three {@link POLICY_TEXT_CONTROLS} lists.
 *
 * @param code - The code point to judge.
 * @returns True if the code point is refused; false otherwise.
 */
export function matchesPolicyCharacter(code: number): boolean {
	if (code === POLICY_TEXT_REPLACEMENT || code === POLICY_TEXT_MARK) return true
	if (code < 0x20) return !POLICY_TEXT_CONTROLS.includes(code)
	return code >= 0x7f && code <= 0x9f
}

/**
 * Renders one code point as the `\u` escape a violation names it by.
 *
 * @param code - The code point to render.
 * @returns The escape, four upper-case hexadecimal digits long.
 */
export function renderPolicyCharacter(code: number): string {
	return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Inspects one file's bytes for text that is not clean UTF-8.
 *
 * @remarks
 * Bytes that do not decode report once for the file. Decoded text reports each refused character
 * once per line, so a line that repeats a character names it once.
 *
 * @param path - The workspace-relative path the bytes belong to.
 * @param bytes - The raw file bytes.
 * @returns Every text violation in line order.
 */
export function inspectPolicyBytes(path: string, bytes: Uint8Array): readonly PolicyViolation[] {
	const text = parsePolicyText(bytes)
	if (text === undefined) return [createPolicyViolation('text', path, 'text decodes as UTF-8')]
	return text
		.split(/\r\n|\n/u)
		.flatMap((line, index) =>
			[...new Set([...line].map((character) => character.codePointAt(0) ?? 0))]
				.filter(matchesPolicyCharacter)
				.map((code) =>
					createPolicyViolation(
						'text',
						path,
						`text carries no replacement, byte-order, or control character: ${renderPolicyCharacter(code)}`,
						index + 1,
					),
				),
		)
}

/**
 * Collects the workspace-relative paths of the authored and source text the sweep reads.
 *
 * @param root - The workspace root to read.
 * @returns The authored Markdown population joined with the source population the suppression
 * sweep reads and the instruction, configuration, and root text population
 * {@link POLICY_TEXT_GLOB} names, sorted by path. The three populations share no extension, so no
 * path repeats.
 */
export function collectPolicyTextPaths(root: string): readonly string[] {
	return [
		...new Set([
			...readPolicyProse(root),
			...globSync(POLICY_SUPPRESSION_GLOB, { cwd: root }).map(normalizePolicyPath),
			...globSync(POLICY_TEXT_GLOB, { cwd: root }).map(normalizePolicyPath),
		]),
	].sort()
}

/**
 * Inspects every authored and source text file for text that is not clean UTF-8.
 *
 * @param root - The workspace root to inspect.
 * @returns Every text violation in path and line order.
 */
export function inspectPolicyText(root: string): readonly PolicyViolation[] {
	return collectPolicyTextPaths(root).flatMap((path) =>
		inspectPolicyBytes(path, readFileSync(join(root, path))),
	)
}

/**
 * Collects the literal path segments the files globs of a configuration's overrides route through.
 *
 * @remarks
 * A segment that carries a glob character is not literal, and neither is an empty or dot segment.
 *
 * @param overrides - The parsed `overrides` value of an Oxlint configuration.
 * @returns Each literal segment, in the order the globs declare them.
 */
export function collectPolicyOverrideSegments(overrides: unknown): readonly string[] {
	return (Array.isArray(overrides) ? overrides : []).flatMap((override: unknown) => {
		const files: unknown = isPolicyRecord(override)
			? Object.getOwnPropertyDescriptor(override, 'files')?.value
			: undefined
		return (Array.isArray(files) ? files : []).flatMap((glob: unknown) =>
			typeof glob === 'string'
				? normalizePolicyPath(glob)
						.split('/')
						.filter(
							(segment) =>
								segment !== '' &&
								segment !== '.' &&
								segment !== '..' &&
								!POLICY_GLOB_CHARACTER.test(segment),
						)
				: [],
		)
	})
}

/**
 * Checks whether an ignore pattern can silence files inside a linted workspace root.
 *
 * @remarks
 * Oxlint reads an ignore pattern with gitignore semantics. A pattern with a slash before its last
 * character is anchored to the configuration directory, so only its first segment can reach a
 * root. A pattern without one matches a name at any depth, so it reaches a root when it carries a
 * glob character or names a segment the overrides route through. A negation reaches nothing.
 *
 * @param pattern - One entry of the configuration's `ignorePatterns`.
 * @param overrides - The parsed `overrides` value of the same configuration.
 * @returns Whether the pattern can silence a guarded file.
 */
export function isPolicyIgnoreReaching(pattern: string, overrides: unknown): boolean {
	if (pattern.startsWith('!')) return false
	const normalized = normalizePolicyPath(pattern)
	const [first = ''] = normalized.replace(/^\.\//u, '').replace(/^\//u, '').split('/')
	if (
		POLICY_WIRING_ROOTS.some((root) => first === root || (first !== '' && matchesGlob(root, first)))
	) {
		return true
	}
	const name = normalized.replace(/\/$/u, '')
	if (name.includes('/')) return false
	return POLICY_GLOB_CHARACTER.test(name) || collectPolicyOverrideSegments(overrides).includes(name)
}

/**
 * Inspects the lint configuration that keeps policy rules active across the workspace.
 *
 * @param configuration - The parsed Oxlint configuration to inspect.
 * @returns Every wiring violation in rule and configuration order.
 */
export function inspectPolicyConfiguration(configuration: unknown): readonly string[] {
	if (!isPolicyRecord(configuration)) {
		return ['Oxlint configuration must be a record']
	}

	const rules: unknown = Object.getOwnPropertyDescriptor(configuration, 'rules')?.value
	const ignorePatterns: unknown = Object.getOwnPropertyDescriptor(
		configuration,
		'ignorePatterns',
	)?.value
	const overrides: unknown = Object.getOwnPropertyDescriptor(configuration, 'overrides')?.value
	return [
		...Object.entries(POLICY_WIRING_SETTINGS).flatMap(([rule, declared]) => {
			const setting = isPolicyRecord(rules)
				? Object.getOwnPropertyDescriptor(rules, rule)?.value
				: undefined
			return isDeepStrictEqual(setting, declared)
				? []
				: [`${rule} must have the top-level setting ${JSON.stringify(declared)}`]
		}),
		...(ignorePatterns !== undefined && !Array.isArray(ignorePatterns)
			? ['ignorePatterns must be an array when declared']
			: // The mapper runs on each pattern as the iterator yields it, as the loop it replaced did.
				Iterator.from(Array.isArray(ignorePatterns) ? ignorePatterns : [])
					.flatMap((pattern) =>
						typeof pattern === 'string' && isPolicyIgnoreReaching(pattern, overrides)
							? [`ignorePatterns must not reach ${pattern}`]
							: [],
					)
					.toArray()),
		...(overrides !== undefined && !Array.isArray(overrides)
			? ['overrides must be an array when declared']
			: // The mapper runs on each entry as the iterator yields it, so a hole is a malformed entry as it
				// was in the loop, and no entry after a failing one is read.
				Iterator.from(Array.isArray(overrides) ? overrides : [])
					.flatMap((override) => {
						if (!isPolicyRecord(override)) return ['override entries must be records']
						const overrideRules: unknown = Object.getOwnPropertyDescriptor(override, 'rules')?.value
						return isPolicyRecord(overrideRules)
							? POLICY_WIRING_RULES.flatMap((rule) =>
									Object.getOwnPropertyDescriptor(overrideRules, rule) === undefined
										? []
										: [`overrides must not configure ${rule}`],
								)
							: []
					})
					.toArray()),
	]
}

/**
 * Inspects the lint configuration that keeps every named rule and population wired.
 *
 * @param configuration - The parsed Oxlint configuration to inspect.
 * @param rules - Every rule id that some top-level or override rules record must enable.
 * @param populations - Every glob population some override's files list must declare exactly.
 * @returns One violation line per unenabled rule, then one per undeclared population.
 */
export function inspectPolicyWiring(
	configuration: unknown,
	rules: readonly string[],
	populations: ReadonlyArray<readonly string[]>,
): readonly string[] {
	if (!isPolicyRecord(configuration)) {
		return ['Oxlint configuration must be a record']
	}

	const topRules: unknown = Object.getOwnPropertyDescriptor(configuration, 'rules')?.value
	const overrides: unknown = Object.getOwnPropertyDescriptor(configuration, 'overrides')?.value
	// Each mapper runs on an entry as the iterator yields it, so a hole reaches the guard as
	// `undefined` and no entry after a failing one is read, as in the loops these replaced.
	const entries = Iterator.from(Array.isArray(overrides) ? overrides : [])
		.flatMap((entry) => {
			if (!isPolicyRecord(entry)) return []
			const record: unknown = Object.getOwnPropertyDescriptor(entry, 'rules')?.value
			const files: unknown = Object.getOwnPropertyDescriptor(entry, 'files')?.value
			return [{ record, declared: Array.isArray(files) ? [files.join(' ')] : [] }]
		})
		.toArray()
	// A name enables its rule only at error severity: the string, or the first member of an array.
	const enabled = new Set(
		[topRules, ...entries.map(({ record }) => record)].flatMap((record) =>
			isPolicyRecord(record)
				? Object.getOwnPropertyNames(record).filter((name) => {
						const setting = Object.getOwnPropertyDescriptor(record, name)?.value
						return (Array.isArray(setting) ? setting[0] : setting) === 'error'
					})
				: [],
		),
	)
	const declaredPopulations = entries.flatMap(({ declared }) => declared)
	return [
		...Iterator.from(rules)
			.flatMap((rule) =>
				enabled.has(rule) ? [] : [`${rule} is enabled by no top-level or override rules record`],
			)
			.toArray(),
		...Iterator.from(populations)
			.flatMap((population) => {
				const joined = population.join(' ')
				return declaredPopulations.includes(joined)
					? []
					: [`no override files list declares the population exactly: ${joined}`]
			})
			.toArray(),
	]
}

/**
 * Resolves an exact-case directory beneath a physical root.
 *
 * @param root - The physical directory from which resolution starts.
 * @param path - The relative directory path to resolve.
 * @returns The resolved directory, or `undefined` when a segment is absent or not a directory.
 */
export function resolvePolicyDirectory(root: string, path: string): string | undefined {
	const normalized = normalizePolicyPath(path)
	if (normalized === '' || normalized === '.') return root
	return normalized.split('/').reduce<string | undefined>((current, segment) => {
		if (current === undefined) return undefined
		const entry = readdirSync(current, { withFileTypes: true }).find(
			(candidate) => candidate.name === segment && candidate.isDirectory(),
		)
		return entry === undefined ? undefined : join(current, entry.name)
	}, root)
}

/**
 * Reports whether an exact-case path resolves to a regular file beneath a physical root.
 *
 * @param root - The physical directory from which resolution starts.
 * @param path - The relative file path to inspect.
 * @returns `true` only when every directory and the regular file match exact case.
 */
export function isPolicyFile(root: string, path: string): boolean {
	const normalized = normalizePolicyPath(path)
	const directory = resolvePolicyDirectory(root, dirname(normalized))
	if (directory === undefined) return false
	const name = basename(normalized)
	return readdirSync(directory, { withFileTypes: true }).some(
		(entry) => entry.name === name && entry.isFile(),
	)
}

/**
 * Reads the immediate child directories beneath one workspace-relative path.
 *
 * @param root - The workspace root to inspect.
 * @param path - The workspace-relative parent directory.
 * @returns The sorted immediate child directory names.
 */
export function readPolicyDirectories(root: string, path: string): readonly string[] {
	const directory = resolvePolicyDirectory(root, path)
	if (directory === undefined) return []
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
}

/**
 * Discovers the skill family from immediate directories in the workspace tree.
 *
 * @param root - The workspace root to inspect.
 * @returns The sorted directory names that belong to the skill family.
 */
export function readSkillFamily(root: string): readonly string[] {
	return readPolicyDirectories(root, SKILL_FAMILY_ROOT)
}

/**
 * Parses one skill document's frontmatter without interpreting arbitrary body lines as keys.
 *
 * @param content - The raw SKILL.md text.
 * @returns The parsed fields and exact scalar source, or `undefined` for an unsupported shape.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | undefined {
	const lines = content.replaceAll('\r\n', '\n').split('\n')
	const rawLines = content.split('\n')
	if (lines[0] !== '---') return undefined
	const boundary = lines.indexOf('---', 1)
	if (boundary === -1) return undefined
	// A folded description consumes the lines after its key, so `skipThrough` carries the last of them.
	const scan = lines.slice(0, boundary).reduce<SkillFrontmatterScan | undefined>(
		(state, line, index) => {
			if (state === undefined || index === 0 || index <= state.skipThrough) return state
			const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/u)
			const key = match?.[1]
			const scalar = match?.[2]
			if (key === undefined || scalar === undefined) return undefined
			if (scalar !== '' && !scalar.startsWith(' ')) return undefined
			const initial = scalar === '' ? '' : scalar.slice(1)
			const own = rawLines[index]?.slice(line.indexOf(':') + 1)
			if (own === undefined) return undefined
			if (initial === '>-' && key !== 'description') return undefined
			if (
				initial !== '>-' &&
				key === 'description' &&
				(/^['"]/u.test(initial) || /^[>|][+-]?$/u.test(initial))
			)
				return undefined
			const rest = initial === '>-' ? lines.slice(index + 1, boundary) : []
			const ended = rest.findIndex(
				(continuation) => continuation.trim() !== '' && !continuation.startsWith('  '),
			)
			const span = ended === -1 ? rest.length : ended
			const block = rest.slice(0, span)
			const rawBlock = rawLines.slice(index + 1, index + 1 + span)
			if (rawBlock.length !== span) return undefined
			const folded = block.map((continuation) =>
				continuation.trim() === '' ? '' : continuation.slice(2),
			)
			// Each kept line joins to the one before it by a space, or by one newline per blank line between.
			const kept = folded.flatMap((continuation, position) =>
				continuation === '' ? [] : [{ continuation, position }],
			)
			const value =
				initial === '>-'
					? kept
							.map((entry, rank) => {
								const before = kept[rank - 1]
								if (before === undefined) return entry.continuation
								const blanks = entry.position - before.position - 1
								return `${blanks === 0 ? ' ' : '\n'.repeat(blanks)}${entry.continuation}`
							})
							.join('')
					: initial
			const source = initial === '>-' ? [own, ...rawBlock].join('\n') : own
			return {
				keys: [...state.keys, key],
				skipThrough: index + span,
				fields: [...state.fields, [key, { value, source }]],
			}
		},
		{ keys: [], skipThrough: 0, fields: [] },
	)
	if (scan === undefined) return undefined
	const fields = new Map(scan.fields)

	return {
		keys: scan.keys,
		name: fields.get('name')?.value,
		description: fields.get('description')?.value,
		source: { name: fields.get('name')?.source, description: fields.get('description')?.source },
	}
}

/**
 * Reports whether a description carries a sentence that begins with the case-sensitive word `Use`.
 *
 * @param description - The parsed skill description.
 * @returns True when the description contains the canonical trigger sentence.
 */
export function matchesSkillTrigger(description: string): boolean {
	return /(?:^|[.!?]\s+)Use \S/u.test(description)
}

/**
 * Reads the direct Markdown files owned by one skill's references directory.
 *
 * @param root - The workspace root to inspect.
 * @param name - The discovered skill directory name.
 * @returns Each direct references/name.md path in sorted order.
 */
export function readSkillReferences(root: string, name: string): readonly string[] {
	const directory = resolvePolicyDirectory(root, `${SKILL_FAMILY_ROOT}/${name}/references`)
	if (directory === undefined) return []
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
		.map((entry) => `references/${entry.name}`)
		.sort()
}

/**
 * Lists the TypeScript scripts a canonical skill directory holds.
 *
 * @param root - The workspace root to inspect.
 * @param name - The skill directory name.
 * @returns Each `scripts/*.ts` path relative to the skill directory, sorted.
 */
export function readSkillScripts(root: string, name: string): readonly string[] {
	const directory = resolvePolicyDirectory(root, `${SKILL_FAMILY_ROOT}/${name}/scripts`)
	if (directory === undefined) return []
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
		.map((entry) => `scripts/${entry.name}`)
		.sort()
}

/**
 * Extracts every `scripts/*.ts` path a skill document names as its own.
 *
 * @remarks
 * A path written under another skill's directory, such as
 * `.agents/skills/orkestrel-dispatch/scripts/cite.ts` inside a different skill's document, names
 * that skill's script and is skipped here; the owning skill's own sweep requires it.
 *
 * @param content - The raw SKILL.md text.
 * @param name - The directory name of the skill whose document `content` is.
 * @returns The distinct script paths, relative to the skill directory, in first-mention order.
 */
export function extractSkillScripts(content: string, name: string): readonly string[] {
	const named = [
		...content.matchAll(
			/(?:\.agents\/skills\/([A-Za-z0-9-]+)\/)?(scripts\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts)/gu,
		),
	].flatMap((match) => {
		const owner = match[1]
		const script = match[2]
		return script === undefined || (owner !== undefined && owner !== name) ? [] : [script]
	})
	return named.filter((script, index) => named.indexOf(script) === index)
}

/**
 * Extracts every script path a skill document names under another skill's directory.
 *
 * @param content - The raw SKILL.md text.
 * @param name - The directory name of the skill whose document `content` is.
 * @returns The distinct `.agents/skills/<other>/scripts/*.ts` paths, in first-mention order.
 */
export function extractForeignSkillScripts(content: string, name: string): readonly string[] {
	const named = [
		...content.matchAll(
			/\.agents\/skills\/([A-Za-z0-9-]+)\/scripts\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts/gu,
		),
	]
		.filter((match) => match[1] !== name)
		.map((match) => match[0])
	return named.filter((script, index) => named.indexOf(script) === index)
}

/**
 * Creates metadata in the canonical skill interface shape.
 *
 * @param name - The skill token the default prompt invokes.
 * @returns Canonical skill interface metadata ending in one newline.
 */
export function createSkillMetadata(name: string): string {
	return (
		[
			'interface:',
			"  display_name: 'Fixture Skill'",
			"  short_description: 'Exercise the skill family policy'",
			`  default_prompt: 'Use $${name} for this fixture.'`,
		].join('\n') + '\n'
	)
}

/**
 * Parses the default prompt from the canonical skill interface shape.
 *
 * Each value is a non-empty single-quoted scalar in which `''` carries an apostrophe.
 *
 * @param content - The raw agents/openai.yaml text.
 * @returns The default prompt scalar as written, or `undefined` when any structural rule fails.
 */
export function parseSkillPrompt(content: string): string | undefined {
	const normalized = content.replaceAll('\r\n', '\n')
	const lines = (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n')
	if (lines.length !== 4 || lines[0] !== 'interface:') return undefined
	const display = lines[1]?.match(/^  display_name: '((?:[^']|'')+)'$/u)
	const description = lines[2]?.match(/^  short_description: '((?:[^']|'')+)'$/u)
	const prompt = lines[3]?.match(/^  default_prompt: '((?:[^']|'')+)'$/u)
	if (display?.[1] === undefined || description?.[1] === undefined || prompt?.[1] === undefined) {
		return undefined
	}
	return prompt[1]
}

/**
 * Reports whether a default prompt names one skill's token in complete form.
 *
 * A skill directory name is lowercase letters and hyphens, so a match followed by either continues
 * a longer name and names a different skill.
 *
 * @param prompt - The default prompt scalar as written.
 * @param name - The discovered skill directory name.
 * @returns True when the prompt carries `$name` as a complete token.
 */
export function matchesSkillToken(prompt: string, name: string): boolean {
	const token = `$${name}`
	// The token opens with `$`, so each `$` in the prompt is a start to try, and a name that carries
	// `$` makes the token overlap itself.
	return prompt
		.matchAll(/\$/gu)
		.some(
			({ index }) =>
				prompt.startsWith(token, index) && !/[a-z-]/u.test(prompt.charAt(index + token.length)),
		)
}

/**
 * Extracts the direct Markdown reference paths named in one skill document.
 *
 * @param content - The raw SKILL.md text.
 * @returns Each distinct references/name.md token in sorted order.
 */
export function extractSkillReferences(content: string): readonly string[] {
	// This raw-text scan includes fenced examples. Over-matching safely requires the named file.
	const references = new Set(
		[...content.matchAll(/references\/[A-Za-z0-9._-]+\.md/gu)].flatMap((match) =>
			match[0] === undefined ? [] : [match[0]],
		),
	)
	return [...references].sort()
}

/**
 * Inspects one skill document for template TODOs outside Markdown code.
 *
 * Coverage includes each literal `TODO` outside a matched pair of single backticks on one line and
 * outside a backtick or tilde fence indented by no more than three spaces. A fence starts with at
 * least three matching markers and ends on a later line starting with the same marker. Four spaces
 * start an indented code block, which this fence scanner does not interpret. An unterminated fence
 * excludes the rest of the file. Inline spans cannot cross lines, and the line discipline cannot
 * validate escaped or repeated delimiters or distinguish a backtick inside a code span's language
 * tag.
 *
 * @param rule - The canonical-skill or provider-bridge population being inspected.
 * @param path - The workspace-relative skill document path.
 * @param content - The raw Markdown text.
 * @returns Every template-TODO violation in line and occurrence order.
 */
export function inspectSkillTemplateTODOs(
	rule: 'bridge' | 'skill',
	path: string,
	content: string,
): readonly PolicyViolation[] {
	const lines = content.split(/\r\n|\r|\n/u)
	// Each line the scan reads is one outside every fence; the fence open at a line rides the fold.
	const scanned = lines.reduce<{
		readonly fence: string | undefined
		readonly indexes: readonly number[]
	}>(
		(state, line, index) => {
			const fenceLine = line.replace(/^ {0,3}/u, '')
			if (state.fence !== undefined) {
				return fenceLine.startsWith(state.fence)
					? { fence: undefined, indexes: state.indexes }
					: state
			}
			const fence = fenceLine.match(/^(`{3,}|~{3,})/u)?.[1]
			if (fence !== undefined) return { fence: fence, indexes: state.indexes }
			return { fence: undefined, indexes: [...state.indexes, index] }
		},
		{ fence: undefined, indexes: [] },
	).indexes
	return scanned.flatMap((index) => {
		// A matched pair of single backticks on one line is an inline span; a lone backtick is not.
		const outside = (lines[index] ?? '').replace(/`[^`]*`/gu, ' ')
		return Array.from({ length: outside.split('TODO').length - 1 }, () =>
			createPolicyViolation(rule, path, 'skill documents contain no template TODOs', index + 1),
		)
	})
}

/** Names why a declaration reading produced no inventory. */
export type SkillDeclarationRefusal =
	| 'entry'
	| 'form'
	| 'name'
	| 'package'
	| 'specifier'
	| 'syntax'
	| 'target'

/** Names what one declaration reading produced. */
export type SkillDeclarationOutcome = SkillDeclarationRefusal | 'cycle' | 'read'

/** Reports one declaration entry's exported names, or the cause that refused the reading. */
export interface SkillDeclarationResult {
	readonly outcome: SkillDeclarationOutcome
	readonly names: readonly string[]
	readonly detail?: string
}

/** Supplies the sentence each refused declaration reading reports, ahead of its own detail. */
export const SKILL_DECLARATION_MESSAGES: Readonly<Record<SkillDeclarationRefusal, string>> =
	Object.freeze({
		entry: 'has no declaration entry for',
		form: 'has an unsupported declaration form:',
		name: 're-exports a name its target does not declare:',
		package: 'has no installed package',
		specifier: 'is not a supported package entry specifier',
		syntax: 'has a declaration syntax error:',
		target: 'has no declaration file at',
	})

/**
 * Reads one package manifest from the directory that holds it.
 *
 * @param directory - The package directory to read the manifest from.
 * @returns The parsed manifest, or `undefined` when the directory holds none.
 * @throws SyntaxError - Thrown when the manifest exists and holds no valid JSON.
 */
export function readSkillManifest(directory: string): unknown {
	const path = join(directory, 'package.json')
	if (!existsSync(path)) return undefined
	const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'))
	return manifest
}

/**
 * Reads a public entry's exported declaration names without loading its runtime.
 *
 * @param root - The workspace whose own manifest or installed packages supply the declarations.
 * @param specifier - The public package entry to resolve through its exports map.
 * @returns The exported names, or the outcome naming why the reading refused.
 * @remarks Resolves the workspace's own package against `root` when the root manifest carries that
 * name, and every other package under node_modules, so a checkout reads the package it publishes.
 * Reads exact exports-map keys through the types, import, and default conditions; a wildcard key,
 * an array, a source alias, and a runtime-only entry have no declaration entry. The Oxc parser
 * reads exported function, variable, class, enum, interface, and type declarations, local export
 * lists, and relative star and named re-exports, including aliases and type forms. Relative .js,
 * .mjs, and .cjs targets resolve to .d.ts, .d.mts, and .d.cts declarations. This is a name
 * inventory, not TypeScript semantic validation.
 */
export function readSkillExports(root: string, specifier: string): SkillDeclarationResult {
	if (!/^@orkestrel\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u.test(specifier))
		return { outcome: 'specifier', names: [] }
	const segments = specifier.split('/')
	const key = segments.length === 2 ? '.' : `./${segments.slice(2).join('/')}`
	const own = readSkillManifest(root)
	const owned = isPolicyRecord(own) && own['name'] === segments.slice(0, 2).join('/')
	const directory = owned ? root : join(root, 'node_modules', ...segments.slice(0, 2))
	const manifest = owned ? own : readSkillManifest(directory)
	if (!isPolicyRecord(manifest)) return { outcome: 'package', names: [] }
	const exports = manifest['exports']
	const target = resolveSkillDeclaration(
		isPolicyRecord(exports) && Object.keys(exports).some((name) => name.startsWith('.'))
			? exports[key]
			: key === '.'
				? exports
				: undefined,
	)
	if (target === undefined || !target.startsWith('./') || !hasCanonicalSegments(target.slice(2)))
		return { outcome: 'entry', names: [], detail: key }
	return readSkillDeclarations(resolve(directory, target))
}

/**
 * Resolves an explicit declaration target under supported exports-map conditions.
 *
 * @param target - The installed exports-map value.
 * @returns The declaration path, or `undefined` for an unsupported target.
 */
export function resolveSkillDeclaration(target: unknown): string | undefined {
	if (typeof target === 'string') return /\.d\.(?:ts|mts|cts)$/u.test(target) ? target : undefined
	if (!isPolicyRecord(target)) return undefined
	for (const condition of ['types', 'import', 'default']) {
		if (Object.hasOwn(target, condition)) return resolveSkillDeclaration(target[condition])
	}
	return undefined
}

/** Enumerates the refusals a declaration file can carry, each written as the form that raises it. */
export const SKILL_DECLARATION_REFUSALS = Object.freeze([
	'export default function read(): void',
	'declare const value: string\nexport = value',
	'declare module "foreign" { export const value: string }',
	'export declare namespace Vocabulary { }',
	'export declare const value: string\nexport { value as default }',
	'export * as vocabulary from "./values.js"',
	'export as namespace Vocabulary',
	'export * from "foreign"',
	'export { absent } from "./values.js"',
	'export * from "./absent.js"',
	'export const =',
])

/** Describes one planted package entry and the refusal sentence its fenced import reports. */
export interface SkillRefusalCase {
	readonly label: string
	readonly specifier: string
	readonly files: readonly PolicySource[]
	readonly message: string
}

/** Supplies one planted package for each refusal cause a fenced import reports by its own name. */
export const SKILL_REFUSAL_CASES: readonly SkillRefusalCase[] = Object.freeze([
	{
		label: 'an entry segment outside the specifier grammar',
		specifier: '@orkestrel/test/Browser',
		files: [
			{
				path: 'node_modules/@orkestrel/test/package.json',
				content: '{"name":"@orkestrel/test","exports":{".":{"types":"./entry.d.ts"}}}',
			},
			{
				path: 'node_modules/@orkestrel/test/entry.d.ts',
				content: 'export declare const VALUE: string\n',
			},
		],
		message:
			'skill fence import @orkestrel/test/Browser is not a supported package entry specifier',
	},
	{
		label: 'a package the workspace does not hold',
		specifier: '@orkestrel/test',
		files: [],
		message: 'skill fence import @orkestrel/test has no installed package',
	},
	{
		label: 'an exports key the map does not declare',
		specifier: '@orkestrel/test/missing',
		files: [
			{
				path: 'node_modules/@orkestrel/test/package.json',
				content: '{"name":"@orkestrel/test","exports":{".":{"types":"./entry.d.ts"}}}',
			},
			{
				path: 'node_modules/@orkestrel/test/entry.d.ts',
				content: 'export declare const VALUE: string\n',
			},
		],
		message: 'skill fence import @orkestrel/test/missing has no declaration entry for ./missing',
	},
	{
		label: 'a wildcard exports key the reader does not expand',
		specifier: '@orkestrel/test/browser',
		files: [
			{
				path: 'node_modules/@orkestrel/test/package.json',
				content: '{"name":"@orkestrel/test","exports":{"./*":{"types":"./*.d.ts"}}}',
			},
			{
				path: 'node_modules/@orkestrel/test/browser.d.ts',
				content: 'export declare const VALUE: string\n',
			},
		],
		message: 'skill fence import @orkestrel/test/browser has no declaration entry for ./browser',
	},
	{
		label: 'a declaration target the package does not hold',
		specifier: '@orkestrel/test',
		files: [
			{
				path: 'node_modules/@orkestrel/test/package.json',
				content: '{"name":"@orkestrel/test","exports":{".":{"types":"./entry.d.ts"}}}',
			},
		],
		message: 'skill fence import @orkestrel/test has no declaration file at entry.d.ts',
	},
	{
		label: 'a declaration form the reader refuses',
		specifier: '@orkestrel/test',
		files: [
			{
				path: 'node_modules/@orkestrel/test/package.json',
				content: '{"name":"@orkestrel/test","exports":{".":{"types":"./entry.d.ts"}}}',
			},
			{
				path: 'node_modules/@orkestrel/test/entry.d.ts',
				content: 'export default function read(): void\n',
			},
		],
		message:
			'skill fence import @orkestrel/test has an unsupported declaration form: export default',
	},
	{
		label: 'a re-exported name the target does not declare',
		specifier: '@orkestrel/test',
		files: [
			{
				path: 'node_modules/@orkestrel/test/package.json',
				content: '{"name":"@orkestrel/test","exports":{".":{"types":"./entry.d.ts"}}}',
			},
			{
				path: 'node_modules/@orkestrel/test/entry.d.ts',
				content: "export { absent } from './values.js'\n",
			},
			{
				path: 'node_modules/@orkestrel/test/values.d.ts',
				content: 'export declare const VALUE: string\n',
			},
		],
		message:
			'skill fence import @orkestrel/test re-exports a name its target does not declare: absent',
	},
])

/**
 * Reads declaration names while following relative declaration re-exports without execution.
 *
 * @param path - The absolute declaration path.
 * @param ancestors - The declaration paths visited along this branch.
 * @returns The exported names, or the outcome naming why the reading refused.
 * @remarks Supports the declaration forms documented on {@link readSkillExports}. A file the branch
 * already visited reports the `cycle` outcome carrying the names that file declares itself: a named
 * re-export resolves against those declarations, and a star re-export of a visited file contributes
 * nothing, because the frame still reading that file contributes its names already. Local export
 * lists supply their written names; this parser does not typecheck their bindings or resolve
 * ambiguous star exports.
 */
export function readSkillDeclarations(
	path: string,
	ancestors: readonly string[] = [],
): SkillDeclarationResult {
	if (!existsSync(path)) return { outcome: 'target', names: [], detail: basename(path) }
	const source = parseSync(path, readFileSync(path, 'utf8'))
	const [failure] = source.errors
	if (failure !== undefined) return { outcome: 'syntax', names: [], detail: failure.message }
	// Each statement answers its own declared names or the refusal it raises; the first refusal wins.
	const declared = source.program.body.map((statement): SkillDeclarationResult => {
		if (statement.type === 'ExportDefaultDeclaration')
			return { outcome: 'form', names: [], detail: 'export default' }
		if (statement.type === 'TSExportAssignment')
			return { outcome: 'form', names: [], detail: 'export assignment' }
		if (statement.type === 'TSNamespaceExportDeclaration')
			return { outcome: 'form', names: [], detail: 'export as namespace' }
		if (statement.type === 'TSModuleDeclaration')
			return { outcome: 'form', names: [], detail: 'ambient module' }
		if (statement.type !== 'ExportNamedDeclaration' || statement.source !== null)
			return { outcome: 'read', names: [] }
		const listed = statement.specifiers.map((binding) =>
			binding.exported.type === 'Identifier' ? binding.exported.name : binding.exported.value,
		)
		if (listed.includes('default'))
			return { outcome: 'form', names: [], detail: 'default export list' }
		const declaration = statement.declaration
		if (declaration === null) return { outcome: 'read', names: listed }
		if (declaration.type === 'VariableDeclaration') {
			const identifiers = declaration.declarations.flatMap((variable) =>
				variable.id.type === 'Identifier' ? [variable.id.name] : [],
			)
			return identifiers.length === declaration.declarations.length
				? { outcome: 'read', names: [...listed, ...identifiers] }
				: { outcome: 'form', names: [], detail: 'destructured declaration' }
		}
		if (declaration.type === 'TSModuleDeclaration')
			return { outcome: 'form', names: [], detail: 'exported namespace' }
		if (
			declaration.type === 'TSDeclareFunction' ||
			declaration.type === 'ClassDeclaration' ||
			declaration.type === 'TSEnumDeclaration' ||
			declaration.type === 'TSInterfaceDeclaration' ||
			declaration.type === 'TSTypeAliasDeclaration'
		) {
			return declaration.id === null
				? { outcome: 'form', names: [], detail: 'anonymous declaration' }
				: { outcome: 'read', names: [...listed, declaration.id.name] }
		}
		return { outcome: 'form', names: [], detail: 'unsupported exported declaration' }
	})
	const refused = declared.find((result) => result.outcome !== 'read')
	if (refused !== undefined) return refused
	const names = [...new Set(declared.flatMap((result) => result.names))]
	if (ancestors.includes(path)) return { outcome: 'cycle', names }
	// A refusal short-circuits the fold, so no later re-export is read.
	const reexported = source.program.body.reduce<SkillDeclarationResult>(
		(state, statement) => {
			if (state.outcome !== 'read') return state
			if (statement.type !== 'ExportAllDeclaration' && statement.type !== 'ExportNamedDeclaration')
				return state
			const origin = statement.source
			if (origin === null) return state
			if (statement.type === 'ExportAllDeclaration' && statement.exported !== null)
				return { outcome: 'form', names: [], detail: 'star export alias' }
			if (!origin.value.startsWith('./') && !origin.value.startsWith('../'))
				return { outcome: 'form', names: [], detail: 'non-relative re-export' }
			const declaration = /\.d\.(?:ts|mts|cts)$/u.test(origin.value)
				? origin.value
				: origin.value.replace(/\.(js|mjs|cjs)$/u, (_, extension: string) =>
						extension === 'mjs' ? '.d.mts' : extension === 'cjs' ? '.d.cts' : '.d.ts',
					)
			if (!/\.d\.(?:ts|mts|cts)$/u.test(declaration))
				return { outcome: 'form', names: [], detail: 'untyped re-export target' }
			const targets = readSkillDeclarations(resolve(dirname(path), declaration), [
				...ancestors,
				path,
			])
			if (targets.outcome !== 'read' && targets.outcome !== 'cycle') return targets
			if (statement.type === 'ExportAllDeclaration')
				return {
					outcome: 'read',
					names: [...state.names, ...(targets.outcome === 'read' ? targets.names : [])],
				}
			const bindings = statement.specifiers.map((binding) => ({
				name:
					binding.exported.type === 'Identifier' ? binding.exported.name : binding.exported.value,
				original: binding.local.type === 'Identifier' ? binding.local.name : binding.local.value,
			}))
			const rejected = bindings.find(
				({ name, original }) => name === 'default' || !targets.names.includes(original),
			)
			if (rejected === undefined)
				return { outcome: 'read', names: [...state.names, ...bindings.map(({ name }) => name)] }
			return rejected.name === 'default'
				? { outcome: 'form', names: [], detail: 'default re-export' }
				: { outcome: 'name', names: [], detail: rejected.original }
		},
		{ outcome: 'read', names },
	)
	return reexported.outcome === 'read'
		? { outcome: 'read', names: [...new Set(reexported.names)].sort() }
		: reexported
}

/**
 * Inspects named Orkestrel imports in every Markdown fence against installed declaration exports.
 *
 * @param root - The workspace whose installed packages supply the declarations.
 * @param path - The workspace-relative skill document path reported on a violation.
 * @param content - The raw Markdown text.
 * @returns Every unparsed fence, unsupported package, refused declaration, or unexported binding
 * violation.
 * @remarks The guide parser supplies fences, including fences nested in lists and blockquotes.
 * The Oxc parser reads named value and type bindings, aliases, comments, and multiline imports.
 * A fence the parser refuses reports a violation when its text carries an `@orkestrel/` substring
 * anywhere, including comments and string literals, because error recovery drops the statements
 * after the failure. A refused fence without that substring stays outside this check, as prose,
 * table cells, indented code, default imports,
 * namespace imports, and imports from other scopes do. A package outside BASE_DEV_DEPENDENCIES
 * reports a violation, and each refused declaration reading reports the cause
 * {@link SKILL_DECLARATION_MESSAGES} names. This check proves exported names, not call signatures
 * or runtime behavior.
 */
export function inspectSkillImports(
	root: string,
	path: string,
	content: string,
): readonly PolicyViolation[] {
	const fences = createGuide(content)
		.fences()
		.map((fence) => {
			const source = parseSync('skill.ts', fence.code)
			const [failure] = source.errors
			const refused = failure !== undefined && fence.code.includes('@orkestrel/')
			return {
				failure: refused ? failure : undefined,
				imports: refused
					? []
					: source.program.body.flatMap((statement) => {
							if (statement.type !== 'ImportDeclaration') return []
							const specifier = statement.source.value
							const bindings = statement.specifiers.filter(
								(binding) => binding.type === 'ImportSpecifier',
							)
							return specifier.startsWith('@orkestrel/') && bindings.length > 0
								? [{ specifier, bindings }]
								: []
						}),
			}
		})
	const specifiers = [
		...new Set(
			fences
				.flatMap(({ imports }) => imports.map(({ specifier }) => specifier))
				.filter((specifier) =>
					Object.hasOwn(BASE_DEV_DEPENDENCIES, specifier.split('/').slice(0, 2).join('/')),
				),
		),
	]
	// Each distinct supported specifier is read once, in first-seen order.
	const entries = new Map(
		specifiers.map((specifier) => [specifier, readSkillExports(root, specifier)]),
	)
	return fences.flatMap(({ failure, imports }) => {
		if (failure !== undefined) {
			return [
				createPolicyViolation('skill', path, `skill fence could not be parsed: ${failure.message}`),
			]
		}
		return imports.flatMap(({ specifier, bindings }) => {
			const packageName = specifier.split('/').slice(0, 2).join('/')
			if (!Object.hasOwn(BASE_DEV_DEPENDENCIES, packageName)) {
				return [
					createPolicyViolation(
						'skill',
						path,
						`skill fence import ${specifier} is outside BASE_DEV_DEPENDENCIES: ${packageName}`,
					),
				]
			}
			const entry = entries.get(specifier) ?? readSkillExports(root, specifier)
			if (entry.outcome !== 'read' && entry.outcome !== 'cycle') {
				const phrase = SKILL_DECLARATION_MESSAGES[entry.outcome]
				return [
					createPolicyViolation(
						'skill',
						path,
						`skill fence import ${specifier} ${entry.detail === undefined ? phrase : `${phrase} ${entry.detail}`}`,
					),
				]
			}
			return bindings.flatMap((binding) => {
				const name =
					binding.imported.type === 'Identifier' ? binding.imported.name : binding.imported.value
				return entry.names.includes(name)
					? []
					: [
							createPolicyViolation(
								'skill',
								path,
								`skill fence import ${specifier} does not export ${name}`,
							),
						]
			})
		})
	})
}

/**
 * Reads the text of a specifier source that names one literally.
 *
 * @remarks
 * A string literal names its value, and a template literal with no substitution names its cooked
 * text, which TypeScript resolves the same way. Any other source, a template literal with a
 * substitution included, names nothing.
 *
 * @param source - The `source` node of a declaration or an `import()` expression.
 * @returns The literal specifier, or `undefined` when the source is computed.
 */
export function readPolicyLiteral(source: unknown): string | undefined {
	if (!isPolicyRecord(source)) return undefined
	const value: unknown = Object.getOwnPropertyDescriptor(source, 'value')?.value
	if (typeof value === 'string') return value
	const expressions: unknown = Object.getOwnPropertyDescriptor(source, 'expressions')?.value
	const quasis: unknown = Object.getOwnPropertyDescriptor(source, 'quasis')?.value
	if (
		Object.getOwnPropertyDescriptor(source, 'type')?.value !== 'TemplateLiteral' ||
		!Array.isArray(expressions) ||
		expressions.length > 0 ||
		!Array.isArray(quasis) ||
		quasis.length !== 1
	) {
		return undefined
	}
	const [quasi]: readonly unknown[] = quasis
	const text: unknown = isPolicyRecord(quasi)
		? Object.getOwnPropertyDescriptor(quasi, 'value')?.value
		: undefined
	const cooked: unknown = isPolicyRecord(text)
		? Object.getOwnPropertyDescriptor(text, 'cooked')?.value
		: undefined
	return typeof cooked === 'string' ? cooked : undefined
}

/**
 * Collects every module specifier a syntax tree names, in source order.
 *
 * @remarks
 * A specifier is the literal source of an `import` or `export … from` declaration, or of an
 * `import()` expression anywhere in the tree, a template literal with no substitution included. An
 * `import()` whose source is computed names none.
 *
 * @param node - The syntax tree, or any node or list of nodes within it.
 * @returns Each literal specifier the tree names.
 */
export function collectPolicySpecifiers(node: unknown): readonly string[] {
	if (Array.isArray(node)) return node.flatMap((child: unknown) => collectPolicySpecifiers(child))
	if (!isPolicyRecord(node)) return []
	const type: unknown = Object.getOwnPropertyDescriptor(node, 'type')?.value
	const value = readPolicyLiteral(Object.getOwnPropertyDescriptor(node, 'source')?.value)
	return [
		...(value !== undefined &&
		(type === 'ImportDeclaration' ||
			type === 'ExportAllDeclaration' ||
			type === 'ExportNamedDeclaration' ||
			type === 'ImportExpression')
			? [value]
			: []),
		...Object.values(node).flatMap((child: unknown) => collectPolicySpecifiers(child)),
	]
}

/** Names the asset extensions `vite/client` types through an ambient wildcard declaration. */
export const POLICY_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
	'.css',
	'.scss',
	'.sass',
	'.less',
	'.styl',
	'.stylus',
	'.pcss',
	'.sss',
	'.apng',
	'.bmp',
	'.png',
	'.jpg',
	'.jpeg',
	'.jfif',
	'.pjpeg',
	'.pjp',
	'.gif',
	'.svg',
	'.ico',
	'.webp',
	'.avif',
	'.cur',
	'.jxl',
	'.mp4',
	'.webm',
	'.ogg',
	'.mp3',
	'.wav',
	'.flac',
	'.aac',
	'.opus',
	'.mov',
	'.m4a',
	'.vtt',
	'.woff',
	'.woff2',
	'.eot',
	'.ttf',
	'.otf',
	'.webmanifest',
	'.pdf',
	'.txt',
	'.wasm',
])

/**
 * Tells whether the type check resolves a relative specifier as a module on disk.
 *
 * @remarks
 * Every relative specifier resolves on disk (a script, a declaration, a `.json` file under
 * `resolveJsonModule`, or a dotted name the bundler resolution completes) unless an ambient wildcard
 * declaration types it: a specifier with a query or a fragment, or one whose final segment ends in an
 * asset extension `vite/client` declares.
 *
 * @param specifier - The relative import specifier.
 * @returns True when the type check resolves the specifier as a module on disk.
 */
export function isPolicyCodeSpecifier(specifier: string): boolean {
	if (/[?#]/u.test(specifier)) return false
	const segment = specifier.slice(specifier.lastIndexOf('/') + 1)
	const dot = segment.lastIndexOf('.')
	return dot <= 0 || !POLICY_ASSET_EXTENSIONS.has(segment.slice(dot).toLowerCase())
}

/**
 * Inspects the tracked TypeScript for an import that resolves into the workspace's built output.
 *
 * @remarks
 * `npm run check` runs before `npm run build`, so a clean clone holds no `dist/` for such an import to
 * resolve. Each relative specifier of a static `import`, an `export … from`, and an `import()` with a
 * literal source, a template literal with no substitution included, resolves against its file's
 * directory. An `import()` with a computed source names no specifier and is left out. A file the parser refuses reports a violation, because its
 * specifiers cannot be read.
 *
 * @param root - The workspace root to inspect.
 * @returns One violation per import into `dist/`, and one per unparsed file, in path order.
 */
export function inspectPolicyDist(root: string): readonly PolicyViolation[] {
	// A specifier TypeScript types through an ambient wildcard declaration (an asset with a query or a
	// non-code extension, such as a built sheet read `?raw`) never resolves on disk during the check.
	return globSync(POLICY_DIST_GLOB, { cwd: root })
		.map(normalizePolicyPath)
		.sort()
		.flatMap((path) => {
			const source = parseSync(path, readFileSync(join(root, path), 'utf8'))
			const [failure] = source.errors
			if (failure !== undefined) {
				return [
					createPolicyViolation('dist', path, `tracked TypeScript parses: ${failure.message}`),
				]
			}
			const directory = dirname(join(root, path))
			return collectPolicySpecifiers(source.program)
				.filter((specifier) => specifier.startsWith('.') && isPolicyCodeSpecifier(specifier))
				.flatMap((specifier) => {
					const target = normalizePolicyPath(relativePath(root, resolve(directory, specifier)))
					return target === POLICY_DIST_ROOT || target.startsWith(`${POLICY_DIST_ROOT}/`)
						? [
								createPolicyViolation(
									'dist',
									path,
									`tracked TypeScript imports nothing from dist, which exists only after npm run build: ${specifier}`,
								),
							]
						: []
				})
		})
}

/**
 * Inspects one skill script proof for an import of a skill file other than the script it proves.
 *
 * @remarks
 * Each relative `import`, `export … from`, and literal `import()` specifier resolves against the
 * proof's directory. A script is self-contained and no file but its own proof imports it, so a
 * proof that reaches another script, or any other file beneath the skill family, shares a helper
 * the script law places in the test setup modules.
 *
 * @param root - The workspace root to inspect.
 * @param proof - The workspace-relative path of the proof.
 * @param script - The workspace-relative path of the script the proof mirrors.
 * @returns One violation per import of another skill file, in source order.
 */
export function inspectSkillProof(
	root: string,
	proof: string,
	script: string,
): readonly PolicyViolation[] {
	if (!isPolicyFile(root, proof)) return []
	const directory = dirname(join(root, proof))
	return collectPolicySpecifiers(parseAst(readFileSync(join(root, proof), 'utf8'), { lang: 'ts' }))
		.filter((specifier) => specifier.startsWith('.'))
		.flatMap((specifier) => {
			const imported = normalizePolicyPath(relativePath(root, resolve(directory, specifier)))
			return imported.startsWith(`${SKILL_FAMILY_ROOT}/`) &&
				imported.replace(/\.js$/u, '.ts') !== script
				? [
						createPolicyViolation(
							'skill',
							proof,
							`skill proof imports no skill file but its own script: ${imported}`,
						),
					]
				: []
		})
}

/**
 * Inspects one discovered skill's required files, metadata, token, references, and fenced imports.
 *
 * @param root - The workspace root to inspect.
 * @param name - The discovered skill directory name.
 * @param installation - The workspace supplying installed declaration entries. Default: root.
 * @returns Every skill-family violation in invariant order.
 */
export function inspectSkill(
	root: string,
	name: string,
	installation = root,
): readonly PolicyViolation[] {
	const base = `${SKILL_FAMILY_ROOT}/${name}`
	const skill = `${base}/SKILL.md`
	const metadata = `${base}/agents/openai.yaml`
	const hasSkill = isPolicyFile(root, skill)
	const content = hasSkill ? readFileSync(join(root, skill), 'utf8') : undefined
	const frontmatter = content === undefined ? undefined : parseSkillFrontmatter(content)
	const keys = new Set(frontmatter?.keys)
	const documented =
		content === undefined
			? [createPolicyViolation('skill', skill, 'skill requires an exact-case regular SKILL.md')]
			: [
					...(frontmatter === undefined
						? [createPolicyViolation('skill', skill, 'SKILL.md frontmatter exists and parses')]
						: [
								...(frontmatter.keys.length !== 2 ||
								keys.size !== 2 ||
								!keys.has('name') ||
								!keys.has('description')
									? [
											createPolicyViolation(
												'skill',
												skill,
												'SKILL.md frontmatter contains exactly name and description',
											),
										]
									: []),
								...(frontmatter.name === name
									? []
									: [
											createPolicyViolation(
												'skill',
												skill,
												'SKILL.md frontmatter name matches its directory',
											),
										]),
								...(frontmatter.description === undefined || frontmatter.description.trim() === ''
									? [createPolicyViolation('skill', skill, 'SKILL.md description is non-empty')]
									: matchesSkillTrigger(frontmatter.description)
										? []
										: [
												createPolicyViolation(
													'skill',
													skill,
													'SKILL.md description names when to use the skill in a sentence beginning Use',
												),
											]),
							]),
					...inspectSkillTemplateTODOs('skill', skill, content),
					...inspectSkillImports(installation, skill, content),
				]
	const hasMetadata = isPolicyFile(root, metadata)
	const prompt = hasMetadata
		? parseSkillPrompt(readFileSync(join(root, metadata), 'utf8'))
		: undefined
	const described = !hasMetadata
		? [
				createPolicyViolation(
					'skill',
					metadata,
					'skill requires an exact-case regular agents/openai.yaml',
				),
			]
		: prompt === undefined
			? [
					createPolicyViolation(
						'skill',
						metadata,
						'agents/openai.yaml matches the canonical four-line interface schema',
					),
				]
			: matchesSkillToken(prompt, name)
				? []
				: [
						createPolicyViolation(
							'skill',
							metadata,
							`agents/openai.yaml default_prompt contains the complete token $${name}`,
						),
					]
	const named = content === undefined ? [] : extractSkillReferences(content)
	const referenced = named.flatMap((reference) => {
		const path = `${base}/${reference}`
		if (!isPolicyFile(root, path)) {
			return [
				createPolicyViolation(
					'skill',
					path,
					`SKILL.md reference resolves to an exact-case regular file: ${reference}`,
				),
			]
		}
		const referenceContent = readFileSync(join(root, path), 'utf8')
		return [
			...inspectSkillTemplateTODOs('skill', path, referenceContent),
			...inspectSkillImports(installation, path, referenceContent),
		]
	})
	const unnamed = readSkillReferences(root, name).flatMap((reference) =>
		named.includes(reference)
			? []
			: [
					createPolicyViolation(
						'skill',
						`${base}/${reference}`,
						`references Markdown file is named by SKILL.md: ${reference}`,
					),
				],
	)
	const scripts = content === undefined ? [] : extractSkillScripts(content, name)
	const unresolved = scripts.flatMap((script) =>
		isPolicyFile(root, `${base}/${script}`)
			? []
			: [
					createPolicyViolation(
						'skill',
						`${base}/${script}`,
						`SKILL.md script resolves to an exact-case regular file: ${script}`,
					),
				],
	)
	const unproved = readSkillScripts(root, name).flatMap((script) => {
		const proof = `${SKILL_PROOF_ROOT}/${name}/${script.replace(/\.ts$/u, '.test.ts')}`
		return [
			...(scripts.includes(script)
				? []
				: [
						createPolicyViolation(
							'skill',
							`${base}/${script}`,
							`scripts TypeScript file is named by SKILL.md: ${script}`,
						),
					]),
			...(isPolicyFile(root, proof)
				? []
				: [createPolicyViolation('skill', proof, `skill script has a mirrored proof: ${proof}`)]),
			...inspectSkillProof(root, proof, `${base}/${script}`),
		]
	})
	const foreign = (content === undefined ? [] : extractForeignSkillScripts(content, name)).flatMap(
		(script) =>
			isPolicyFile(root, script)
				? []
				: [
						createPolicyViolation(
							'skill',
							script,
							`SKILL.md names another skill's script that resolves to an exact-case regular file: ${script}`,
						),
					],
	)
	const references = resolvePolicyDirectory(root, `${base}/references`)
	const nested =
		references === undefined
			? []
			: readdirSync(references, { withFileTypes: true }).flatMap((entry) =>
					entry.isDirectory()
						? [
								createPolicyViolation(
									'skill',
									`${base}/references/${entry.name}`,
									'skill references directory contains no subdirectories',
								),
							]
						: [],
				)
	const directory = resolvePolicyDirectory(root, base)
	const stray =
		directory === undefined
			? []
			: globSync('**/*', { cwd: directory })
					.map(normalizePolicyPath)
					.sort()
					.flatMap((path) => {
						if (resolvePolicyDirectory(directory, path) !== undefined) {
							return path === 'agents' ||
								path === 'references' ||
								path === 'scripts' ||
								path.startsWith('references/') ||
								(!hasSkill && path.toLowerCase() === 'skill.md') ||
								(!hasMetadata && path.toLowerCase() === 'agents/openai.yaml')
								? []
								: [
										createPolicyViolation(
											'skill',
											`${base}/${path}`,
											'skill directory contains only agents/, references/, and scripts/ directories',
										),
									]
						}
						if (!isPolicyFile(directory, path)) return []
						const file = basename(path).toLowerCase()
						if (file === 'readme.md' || file === 'changelog.md') {
							return [
								createPolicyViolation(
									'skill',
									`${base}/${path}`,
									'skill directory contains no README.md or CHANGELOG.md',
								),
							]
						}
						return path === 'SKILL.md' ||
							path === 'agents/openai.yaml' ||
							/^references\/[^/]+\.md$/u.test(path) ||
							/^scripts\/[^/]+\.ts$/u.test(path) ||
							(!hasSkill &&
								(path.toLowerCase() === 'skill.md' ||
									path.toLowerCase().startsWith('skill.md/'))) ||
							(!hasMetadata && path.toLowerCase() === 'agents/openai.yaml') ||
							(path.startsWith('references/') && path.slice('references/'.length).includes('/'))
							? []
							: [
									createPolicyViolation(
										'skill',
										`${base}/${path}`,
										'skill directory contains only SKILL.md, agents/openai.yaml, references/*.md, and scripts/*.ts',
									),
								]
					})
	return [
		...documented,
		...described,
		...referenced,
		...unnamed,
		...unresolved,
		...unproved,
		...foreign,
		...nested,
		...stray,
	]
}

/**
 * Inspects every immediate member of the discovered skill family.
 *
 * @param root - The workspace root to inspect.
 * @param installation - The workspace supplying installed declaration entries. Default: root.
 * @returns Every skill-family violation in directory and invariant order.
 */
export function inspectSkillFamily(root: string, installation = root): readonly PolicyViolation[] {
	return readSkillFamily(root).flatMap((name) => inspectSkill(root, name, installation))
}

/**
 * Inspects one provider bridge against its canonical skill twin.
 *
 * @param root - The workspace root to inspect.
 * @param name - The shared canonical and bridge directory name.
 * @returns Every bridge violation in frontmatter, body, and directory order.
 */
export function inspectBridge(root: string, name: string): readonly PolicyViolation[] {
	const canonicalPath = `${SKILL_FAMILY_ROOT}/${name}/SKILL.md`
	const bridgeBase = `${SKILL_BRIDGE_ROOT}/${name}`
	const bridgePath = `${bridgeBase}/SKILL.md`
	if (!isPolicyFile(root, bridgePath)) {
		return [
			createPolicyViolation('bridge', bridgePath, 'bridge requires an exact-case regular SKILL.md'),
		]
	}
	const content = readFileSync(join(root, bridgePath), 'utf8')
	const bridge = parseSkillFrontmatter(content)
	const canonical = isPolicyFile(root, canonicalPath)
		? parseSkillFrontmatter(readFileSync(join(root, canonicalPath), 'utf8'))
		: undefined
	const keys = new Set(bridge?.keys)
	const normalized = content.replaceAll('\r\n', '\n')
	const boundary = normalized.indexOf('\n---', 3)
	const body = boundary === -1 ? normalized : normalized.slice(boundary + '\n---'.length)
	return [
		...(bridge === undefined
			? [createPolicyViolation('bridge', bridgePath, 'bridge SKILL.md frontmatter parses')]
			: bridge.keys.length !== 2 || keys.size !== 2 || !keys.has('name') || !keys.has('description')
				? [
						createPolicyViolation(
							'bridge',
							bridgePath,
							'bridge SKILL.md frontmatter contains exactly name and description',
						),
					]
				: []),
		...(bridge !== undefined &&
		canonical !== undefined &&
		bridge.source.name !== canonical.source.name
			? [
					createPolicyViolation(
						'bridge',
						bridgePath,
						'bridge frontmatter name matches its canonical twin',
					),
				]
			: []),
		...(bridge !== undefined &&
		canonical !== undefined &&
		bridge.source.description !== canonical.source.description
			? [
					createPolicyViolation(
						'bridge',
						bridgePath,
						'bridge frontmatter description matches its canonical twin',
					),
				]
			: []),
		...(body.includes(canonicalPath)
			? []
			: [
					createPolicyViolation(
						'bridge',
						bridgePath,
						`bridge body names its canonical workflow: ${canonicalPath}`,
					),
				]),
		...inspectSkillTemplateTODOs('bridge', bridgePath, content),
		...(resolvePolicyDirectory(root, `${bridgeBase}/references`) === undefined
			? []
			: [
					createPolicyViolation(
						'bridge',
						`${bridgeBase}/references`,
						'bridge owns no references directory',
					),
				]),
	]
}

/**
 * Inspects the provider bridge set and every bridge shared with the canonical skill family.
 *
 * @param root - The workspace root to inspect.
 * @returns Every bridge-set and bridge-content violation in directory order.
 */
export function inspectSkillBridges(root: string): readonly PolicyViolation[] {
	const canonical = readSkillFamily(root)
	const bridges = readPolicyDirectories(root, SKILL_BRIDGE_ROOT)
	const bridgeSet = new Set(bridges)
	const canonicalSet = new Set(canonical)
	return [
		...canonical.flatMap((name) =>
			bridgeSet.has(name)
				? inspectBridge(root, name)
				: [
						createPolicyViolation(
							'bridge',
							`${SKILL_BRIDGE_ROOT}/${name}`,
							'canonical skill has a matching provider bridge directory',
						),
					],
		),
		...bridges.flatMap((name) =>
			canonicalSet.has(name)
				? []
				: [
						createPolicyViolation(
							'bridge',
							`${SKILL_BRIDGE_ROOT}/${name}`,
							'provider bridge directory has a canonical skill twin',
						),
					],
		),
	]
}

/**
 * Reads every rule path the root instruction file's rule map registers.
 *
 * @param content - The raw root instruction text.
 * @returns Each backticked first cell beneath the rule map heading, in table order.
 */
export function readPolicyRuleMap(content: string): readonly string[] {
	const lines = content.replaceAll('\r\n', '\n').split('\n')
	const heading = lines.indexOf(POLICY_RULE_MAP_HEADING)
	if (heading === -1) return []
	return extractPolicySection(lines, heading).flatMap((line) => {
		const cell = line.match(/^\|\s*`([^`]+)`\s*\|/u)?.[1]
		return cell === undefined ? [] : [normalizePolicyPath(cell)]
	})
}

/**
 * Inspects the discovered rule family against the root instruction file's rule map.
 *
 * A workspace with no rule file has no rule map to keep, so the population is empty there.
 *
 * @param root - The workspace root to inspect.
 * @returns Every unregistered rule file, then every row resolving to no file.
 */
export function inspectPolicyRuleMap(root: string): readonly PolicyViolation[] {
	const directory = resolvePolicyDirectory(root, POLICY_RULE_ROOT)
	if (directory === undefined) return []
	const rules = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
		.map((entry) => `${POLICY_RULE_ROOT}/${entry.name}`)
		.sort()
	if (rules.length === 0) return []
	const content = isPolicyFile(root, POLICY_RULE_MAP_FILE)
		? readFileSync(join(root, POLICY_RULE_MAP_FILE), 'utf8')
		: ''
	const registered = new Set(readPolicyRuleMap(content))
	return [
		...rules.flatMap((rule) =>
			registered.has(rule)
				? []
				: [createPolicyViolation('rules', rule, 'the rule map names every rule file')],
		),
		...[...registered].flatMap((path) =>
			isPolicyFile(root, path)
				? []
				: [createPolicyViolation('rules', path, 'every rule-map row resolves to a rule file')],
		),
	]
}

/**
 * Inspects an explicit path population for a name a Windows checkout cannot hold.
 *
 * Each path is read through its own final segment, because the population lists every directory as
 * its own entry. A Windows host refuses the reserved characters and folds a case collision into one
 * file, so those two boundaries are proven from a path population rather than from written files.
 *
 * @param paths - The workspace-relative paths to inspect.
 * @returns Every unusable-name and case-collision violation in path order.
 */
export function inspectPolicyFilenamePaths(paths: readonly string[]): readonly PolicyViolation[] {
	// The iterator visits a hole as `undefined`, which normalization refuses, as the loop did.
	const normalized = Iterator.from(paths).map(normalizePolicyPath).toArray()
	// Built from the reversed list, so the first path that folds to a key is the spelling a collision reports.
	const folded = new Map(normalized.toReversed().map((path) => [path.toLowerCase(), path]))
	return normalized.flatMap((path) => {
		const segment = basename(path)
		const [stem = ''] = segment.split('.')
		const previous = folded.get(path.toLowerCase())
		return [
			...(POLICY_RESERVED_NAMES.includes(stem.toLowerCase())
				? [
						createPolicyViolation(
							'portability',
							path,
							'path segments avoid the names Windows reserves',
						),
					]
				: []),
			...(POLICY_RESERVED_PATTERN.test(segment)
				? [
						createPolicyViolation(
							'portability',
							path,
							'path segments avoid the characters Windows refuses',
						),
					]
				: []),
			...(segment.endsWith('.') || segment.endsWith(' ')
				? [
						createPolicyViolation(
							'portability',
							path,
							'path segments end with neither a dot nor a space',
						),
					]
				: []),
			...(previous === undefined || previous === path
				? []
				: [
						createPolicyViolation(
							'portability',
							path,
							`path differs from ${previous} by case alone`,
						),
					]),
		]
	})
}

/**
 * Reads the workspace-authored path population, directories included.
 *
 * @param root - The workspace root to read.
 * @returns Every authored path, sorted by path.
 */
export function readPolicyPaths(root: string): readonly string[] {
	return globSync(POLICY_PORTABILITY_GLOB, { cwd: root }).map(normalizePolicyPath).sort()
}

/**
 * Inspects the workspace-authored path population for a name a Windows checkout cannot hold.
 *
 * @param root - The workspace root to inspect.
 * @returns Every unusable-name and case-collision violation in path order.
 */
export function inspectPolicyFilenames(root: string): readonly PolicyViolation[] {
	return inspectPolicyFilenamePaths(readPolicyPaths(root))
}

/**
 * Parses the manifest's script record without interpreting any other manifest field.
 *
 * @param content - The raw package.json text.
 * @returns Each script name and its command, in manifest order.
 */
export function parsePolicyScripts(content: string): ReadonlyMap<string, string> {
	const manifest = parsePolicyJSON(content)
	if (!isPolicyRecord(manifest)) return new Map()
	const record: unknown = Object.getOwnPropertyDescriptor(manifest, 'scripts')?.value
	if (!isPolicyRecord(record)) return new Map()
	return new Map(
		Object.getOwnPropertyNames(record).flatMap((name): Array<[string, string]> => {
			const command: unknown = Object.getOwnPropertyDescriptor(record, name)?.value
			return typeof command === 'string' ? [[name, command]] : []
		}),
	)
}

/**
 * Inspects every manifest script for a shell file no Windows host runs.
 *
 * @param root - The workspace root to inspect.
 * @returns Every shell-script violation in manifest order.
 */
export function inspectPolicyScripts(root: string): readonly PolicyViolation[] {
	if (!isPolicyFile(root, POLICY_MANIFEST_FILE)) return []
	const content = readFileSync(join(root, POLICY_MANIFEST_FILE), 'utf8')
	return [...parsePolicyScripts(content)].flatMap(([name, command]) =>
		POLICY_SHELL_PATTERN.test(command)
			? [
					createPolicyViolation(
						'portability',
						POLICY_MANIFEST_FILE,
						`manifest scripts name no .sh file: ${name}`,
					),
				]
			: [],
	)
}

/**
 * Inspects a file path population for a shell, PowerShell, Python, or batch file outside the scripts
 * directory, and for any file inside it other than a `.sh` file.
 *
 * @param paths - The workspace-relative file paths to inspect.
 * @returns One violation per refused path, in path order.
 */
export function inspectPolicyShellPaths(paths: readonly string[]): readonly PolicyViolation[] {
	return paths.flatMap((path) => {
		const lower = normalizePolicyPath(path).toLowerCase()
		const inside = lower.startsWith(`${POLICY_SHELL_ROOT}/`)
		const shell = POLICY_SHELL_EXTENSIONS.some((extension) => lower.endsWith(extension))
		if (inside ? lower.endsWith('.sh') : !shell) return []
		return [
			createPolicyViolation(
				'portability',
				path,
				inside
					? `${POLICY_SHELL_ROOT} holds .sh files and nothing else`
					: `shell, PowerShell, Python, and batch files sit only in ${POLICY_SHELL_ROOT}`,
			),
		]
	})
}

/**
 * Inspects the workspace-authored file population for a script no Windows host runs.
 *
 * @remarks
 * Only a path that could be refused is checked against the file system: a directory named like a
 * shell file, or a directory inside the scripts directory, is no file and is left to the other
 * sweeps.
 *
 * @param root - The workspace root to inspect.
 * @returns Every shell-file violation in path order.
 */
export function inspectPolicyShells(root: string): readonly PolicyViolation[] {
	const candidates = readPolicyPaths(root).filter((path) => {
		const lower = path.toLowerCase()
		return (
			lower.startsWith(`${POLICY_SHELL_ROOT}/`) ||
			POLICY_SHELL_EXTENSIONS.some((extension) => lower.endsWith(extension))
		)
	})
	return inspectPolicyShellPaths(candidates.filter((path) => isPolicyFile(root, path)))
}

/**
 * Reads every authored Markdown path in one workspace, sorted by path.
 *
 * @remarks
 * The walk descends the whole tree apart from the directory names
 * {@link POLICY_PROSE_EXCLUSIONS} lists, which hold installed packages, built output, scratch
 * work, and campaign records rather than prose this workspace authors.
 *
 * @param root - The workspace root to read.
 * @returns Every workspace-relative Markdown path, sorted by path.
 */
export function readPolicyProse(root: string): readonly string[] {
	const paths: string[] = []
	const pending: string[] = ['']
	while (pending.length > 0) {
		const relative = pending.pop() ?? ''
		for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
			const path = relative === '' ? entry.name : `${relative}/${entry.name}`
			if (entry.isDirectory()) {
				if (!POLICY_PROSE_EXCLUSIONS.includes(entry.name)) pending.push(path)
				continue
			}
			if (entry.name.endsWith('.md')) paths.push(normalizePolicyPath(path))
		}
	}
	return paths.sort()
}

/**
 * Reads the short name one workspace manifest declares, its scope removed.
 *
 * @param root - The workspace root to read.
 * @returns The manifest name after its scope, or undefined where no manifest declares one.
 */
export function readPolicyPackage(root: string): string | undefined {
	if (!isPolicyFile(root, POLICY_MANIFEST_FILE)) return undefined
	const manifest = readPolicyJSON(join(root, POLICY_MANIFEST_FILE))
	if (!isPolicyRecord(manifest)) return undefined
	const name: unknown = Object.getOwnPropertyDescriptor(manifest, 'name')?.value
	if (typeof name !== 'string') return undefined
	return name.slice(name.lastIndexOf('/') + 1)
}

/**
 * Reads every package short name the catalog table registers.
 *
 * @remarks
 * A workspace holds this file because the `catalog` verb refuses a target that lacks it, and a
 * workspace that has not received one yet registers no package, so the read yields an empty list
 * there rather than failing.
 *
 * @param root - The workspace root to read.
 * @param path - The catalog's path within that root. Default: the target catalog path.
 * @returns Each catalog row's package short name, its scope removed, in table order.
 */
export function readPolicyCatalog(
	root: string,
	path: string = POLICY_CATALOG_FILE,
): readonly string[] {
	if (!isPolicyFile(root, path)) return []
	const lines = readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n').split('\n')
	const heading = lines.indexOf(POLICY_CATALOG_HEADING)
	if (heading === -1) return []
	return extractPolicySection(lines, heading).flatMap((line) => {
		const cell = line.match(/^\|\s*`([^`]+)`\s*\|/u)?.[1]
		return cell === undefined ? [] : [cell.slice(cell.lastIndexOf('/') + 1)]
	})
}

/**
 * Reads the guide name one prose path carries when that guide is another package's to account for.
 *
 * @remarks
 * A top-level `guides/<name>.md` path yields its name unless the name is the guide index or this
 * workspace's own package; every other path yields undefined. {@link isPolicyMirror} and
 * {@link isPolicyStray} split that name by catalog membership.
 *
 * @param root - The workspace root the path belongs to.
 * @param path - The workspace-relative prose path to read.
 * @returns The guide's name, or undefined where the path is not a top-level guide another package
 * could own.
 */
export function readPolicyGuide(root: string, path: string): string | undefined {
	const name = normalizePolicyPath(path).match(POLICY_MIRROR_PATTERN)?.[1]
	if (name === undefined || name === POLICY_GUIDE_MAP) return undefined
	return name === readPolicyPackage(root) ? undefined : name
}

/**
 * Reports whether one prose path is a top-level guide the catalog registers to another package.
 *
 * @remarks
 * A mirror is fetched bytes rather than authored prose, so the term sweep leaves it to the package
 * that wrote it. The catalog table is the evidence, and it is the only evidence: the workspace's own
 * guide and the guide index are authored here, and a top-level guide the catalog does not register
 * is a finding rather than a silent exclusion.
 *
 * @param root - The workspace root the path belongs to.
 * @param path - The workspace-relative prose path to judge.
 * @returns True if the path is a top-level guide the catalog registers to a package other than this
 * one; false otherwise.
 */
export function isPolicyMirror(root: string, path: string): boolean {
	const name = readPolicyGuide(root, path)
	return name !== undefined && readPolicyCatalog(root).includes(name)
}

/**
 * Reports whether one prose path is a top-level guide no evidence accounts for.
 *
 * @param root - The workspace root the path belongs to.
 * @param path - The workspace-relative prose path to judge.
 * @returns True if the path is a top-level guide that is neither this package's own, nor the index,
 * nor a catalog row; false otherwise.
 */
export function isPolicyStray(root: string, path: string): boolean {
	const name = readPolicyGuide(root, path)
	return name !== undefined && !readPolicyCatalog(root).includes(name)
}

/**
 * Inspects every authored Markdown file for a term the substitution table bans unconditionally.
 *
 * @remarks
 * Each file is stripped of its fenced blocks, its inline code spans, its link tags, and its URLs
 * before the match, by the same reader the comment rule uses, so a term inside one of those regions
 * is not prose. Stripping holds every offset, so the reported line is the line in the file.
 *
 * A top-level guide the catalog registers to another package is a mirror and is skipped, and a
 * top-level guide no evidence accounts for reports instead, so an exclusion is never silent.
 *
 * @param root - The workspace root to inspect.
 * @returns Every unaccounted-guide violation, then every banned-term violation in path and offset
 * order.
 */
export function inspectPolicyProse(root: string): readonly PolicyViolation[] {
	return readPolicyProse(root).flatMap((path) => {
		const stray = isPolicyStray(root, path)
			? [
					createPolicyViolation(
						'prose',
						path,
						"guide is the package's own, the map, or a catalog row",
					),
				]
			: []
		if (isPolicyMirror(root, path)) return stray
		const prose = stripPolicyCode(readFileSync(join(root, path), 'utf8'))
		return [
			...stray,
			...textToPolicyHits(prose).map((hit) =>
				createPolicyViolation(
					'prose',
					path,
					`prose carries no banned term: ${hit.term.term} (${hit.term.replacement})`,
					prose.slice(0, hit.index).split('\n').length,
				),
			),
		]
	})
}

/**
 * Reads every term the substitution table's first column registers.
 *
 * @remarks
 * Each row's first cell carries its terms as code spans, so the read takes the backticked tokens
 * and drops the parenthetical qualifier a row writes beside one.
 *
 * @param content - The raw rule text carrying the substitution table.
 * @returns Each registered term, in table order.
 */
export function readPolicyTerms(content: string): readonly string[] {
	const lines = content.replaceAll('\r\n', '\n').split('\n')
	const heading = lines.indexOf(POLICY_TERM_HEADING)
	if (heading === -1) return []
	return extractPolicySection(lines, heading).flatMap((line) => {
		const cell = line.match(/^\|([^|]*)\|/u)?.[1]
		return cell === undefined
			? []
			: [...cell.matchAll(/`([^`]+)`/gu)].flatMap((match) => match[1] ?? [])
	})
}

/**
 * Inspects every host portability rule across one workspace.
 *
 * @param root - The workspace root to inspect.
 * @returns Every rule-map, filename, shell-file, and manifest-script violation.
 */
export function inspectPolicyPortability(root: string): readonly PolicyViolation[] {
	return [
		...inspectPolicyRuleMap(root),
		...inspectPolicyFilenames(root),
		...inspectPolicyShells(root),
		...inspectPolicyScripts(root),
	]
}

/**
 * Locates parsed exports at their physical declaration lines.
 *
 * @param written - The declaring workspace-relative path, normalized before it is read.
 * @param text - The declaration source text.
 * @param root - The workspace root used to resolve relative star exports, when supplied.
 * @param ancestors - The source paths already visited along this star-export branch.
 * @returns The exported names with normalized paths and declaration lines.
 * @throws An `Error` when syntax, an export form, or a star target cannot be read.
 */
export function readPolicyDeclarations(
	written: string,
	text: string,
	root?: string,
	ancestors: readonly string[] = [],
): readonly PolicySurfaceDeclaration[] {
	const path = normalizePolicyPath(written)
	if (ancestors.includes(path)) return []
	const source = parseSync(path, text)
	if (source.errors.length > 0) throw new Error(`export syntax is unreadable at ${path}`)
	return source.program.body.flatMap((statement): readonly PolicySurfaceDeclaration[] => {
		const line = text.slice(0, statement.start).split(/\r\n|\n/u).length
		if (statement.type === 'ExportAllDeclaration') {
			if (statement.exported !== null) {
				const name =
					statement.exported.type === 'Identifier'
						? statement.exported.name
						: statement.exported.value
				if (name === 'default') throw new Error(`default export is unsupported at ${path}:${line}`)
				return [{ name, path, line }]
			}
			const target = statement.source.value
			const resolved = resolveLink(
				path,
				target.endsWith('.js') ? `${target.slice(0, -3)}.ts` : target,
			)
			if (
				root === undefined ||
				!target.startsWith('.') ||
				!hasCanonicalSegments(resolved) ||
				!isPolicyFile(root, resolved)
			) {
				throw new Error(`star export target is unreadable at ${path}:${line}: ${target}`)
			}
			return readPolicyDeclarations(resolved, readFileSync(join(root, resolved), 'utf8'), root, [
				...ancestors,
				path,
			])
		}
		if (statement.type === 'ExportNamedDeclaration') {
			const listed = statement.specifiers.map((specifier) => {
				const name =
					specifier.exported.type === 'Identifier'
						? specifier.exported.name
						: specifier.exported.value
				if (name === 'default') throw new Error(`default export is unsupported at ${path}:${line}`)
				return { name, path, line: text.slice(0, specifier.start).split(/\r\n|\n/u).length }
			})
			const declaration = statement.declaration
			if (declaration === null) return listed
			if (declaration.type === 'VariableDeclaration') {
				return [
					...listed,
					...declaration.declarations.map((variable) => {
						if (variable.id.type !== 'Identifier')
							throw new Error(`export binding is unsupported at ${path}:${line}`)
						return {
							name: variable.id.name,
							path,
							line: text.slice(0, variable.id.start).split(/\r\n|\n/u).length,
						}
					}),
				]
			}
			if (
				declaration.type === 'FunctionDeclaration' ||
				declaration.type === 'TSDeclareFunction' ||
				declaration.type === 'ClassDeclaration' ||
				declaration.type === 'TSInterfaceDeclaration' ||
				declaration.type === 'TSTypeAliasDeclaration' ||
				declaration.type === 'TSEnumDeclaration' ||
				declaration.type === 'TSModuleDeclaration'
			) {
				if (declaration.id?.type !== 'Identifier')
					throw new Error(`export name is unreadable at ${path}:${line}`)
				return [...listed, { name: declaration.id.name, path, line }]
			}
			throw new Error(`export declaration is unsupported at ${path}:${line}: ${declaration.type}`)
		}
		if (
			statement.type === 'ExportDefaultDeclaration' ||
			statement.type === 'TSExportAssignment' ||
			statement.type === 'TSNamespaceExportDeclaration'
		) {
			throw new Error(`export statement is unsupported at ${path}:${line}: ${statement.type}`)
		}
		return []
	})
}

/**
 * Reads one file's declarations, or converts the reader's throw into a surface violation.
 *
 * @param root - The workspace root used to resolve relative star exports.
 * @param path - The workspace-relative path being read.
 * @param text - The declaration source text.
 * @returns The read declarations, or the violation the reader raised.
 */
export function collectPolicyDeclarations(
	root: string,
	path: string,
	text: string,
): PolicyDeclarationRead {
	try {
		return { declarations: readPolicyDeclarations(path, text, root) }
	} catch (error) {
		return {
			declarations: [],
			violation: createPolicyViolation(
				'surface',
				path,
				`surface population incomplete: ${error instanceof Error ? error.message : String(error)}`,
			),
		}
	}
}

/**
 * Reads reachable source declarations and refuses unread barrel statements or targets.
 *
 * @param root - The workspace root to inspect.
 * @returns The parsed declarations and incomplete-population violations.
 * @remarks
 * Every `index.ts` follows barrel validation. Each selected sheet's `sheet.ts` entry requires
 * exactly one bare `./index.scss` import, including styles extensions and themes.
 */
export function readPolicySurface(root: string): PolicySurfacePopulation {
	const files = Object.fromEntries(
		globSync('src/**/*.ts', { cwd: root })
			.map(normalizePolicyPath)
			.sort()
			.map((path): [string, string] => [path, readFileSync(join(root, path), 'utf8')]),
	)
	const barrels = Object.keys(files).filter((path) => path.endsWith('/index.ts'))
	const sheets = new Set([
		POLICY_SURFACE_STYLES_ENTRY,
		...collectSheets(root).map((face) => `src/${face}/sheet.ts`),
		'src/styles/themes/sheet.ts',
	])
	const entryViolations = [...sheets].flatMap((path) => {
		const stylesEntry = files[path]
		if (stylesEntry === undefined) return []
		const stylesSource = parseSync(path, stylesEntry)
		const stylesStatement =
			stylesSource.errors.length === 0 ? stylesSource.program.body[0] : undefined
		const stylesValid =
			stylesSource.errors.length === 0 &&
			stylesSource.program.body.length === 1 &&
			stylesStatement?.type === 'ImportDeclaration' &&
			stylesStatement.specifiers.length === 0 &&
			stylesStatement.source.value === './index.scss'
		const line =
			stylesStatement === undefined
				? 1
				: stylesEntry.slice(0, stylesStatement.start).split(/\r\n|\n/u).length
		return stylesValid
			? []
			: [createPolicyViolation('surface', path, POLICY_SURFACE_STYLES_MESSAGE, line)]
	})
	// Each barrel statement answers one violation, one star-export target, or neither.
	const results = barrels.flatMap(
		(path): ReadonlyArray<{ readonly violation?: PolicyViolation; readonly target?: string }> => {
			const text = files[path]
			if (text === undefined) return []
			const source = parseSync(path, text)
			const lines = extractSourceLines(text)
			if (source.errors.length > 0) {
				return [
					{
						violation: createPolicyViolation(
							'surface',
							path,
							'surface population incomplete: barrel syntax is unreadable',
						),
					},
				]
			}
			return source.program.body.map((statement) => {
				const start = text.slice(0, statement.start).split(/\r\n|\n/u).length - 1
				const end = text.slice(0, statement.end).split(/\r\n|\n/u).length - 1
				const row = lines[start]?.code.match(POLICY_SURFACE_BARREL_PATTERN)
				const target = row?.[1] ?? row?.[2]
				if (
					statement.type !== 'ExportAllDeclaration' ||
					statement.exportKind !== 'value' ||
					statement.exported !== null ||
					start !== end ||
					target === undefined
				) {
					return {
						violation: createPolicyViolation(
							'surface',
							path,
							'surface population incomplete: barrel requires a relative .js star export on one line',
							start + 1,
						),
					}
				}
				const resolved = resolveLink(path, `${target.slice(0, -3)}.ts`)
				if (
					!hasCanonicalSegments(resolved) ||
					!resolved.startsWith('src/') ||
					files[resolved] === undefined
				) {
					return {
						violation: createPolicyViolation(
							'surface',
							path,
							`surface population incomplete: barrel target is unreadable: ${target}`,
							start + 1,
						),
					}
				}
				return resolved.endsWith('/index.ts') ? {} : { target: resolved }
			})
		},
	)
	const targets = new Set(results.flatMap(({ target }) => (target === undefined ? [] : [target])))
	const reads = [...targets].flatMap((path) => {
		const text = files[path]
		return text === undefined ? [] : [collectPolicyDeclarations(root, path, text)]
	})
	return {
		declarations: reads.flatMap((read) => read.declarations),
		violations: [
			...entryViolations,
			...results.flatMap(({ violation }) => (violation === undefined ? [] : [violation])),
			...reads.flatMap((read) => (read.violation === undefined ? [] : [read.violation])),
		],
	}
}

/**
 * Inspects source and target-owned setup names against the hosted fleet guides.
 *
 * @remarks
 * Source names claimed by the target's own hosted guide are grandfathered. Setup names have no
 * grandfather. Catalog rows come from beside the guides: when reading installed guides, from the
 * staged catalog and never from the target's own table, which can list a package without a guide in
 * that host. An absent installed host falls back to checkout guides only with catalog coverage.
 * Missing comparison evidence and unread barrel statements produce surface violations.
 *
 * @param root - The workspace root to inspect.
 * @returns Surface violations sorted by path, declaration line, name, and owner.
 */
export function inspectPolicySurface(root: string): readonly PolicyViolation[] {
	const installed = join(root, POLICY_SURFACE_HOST)
	const own = readPolicyPackage(root)
	const hosted = own !== 'scaffold' && existsSync(installed)
	const host = hosted ? installed : root
	const catalog = hosted ? POLICY_SURFACE_CATALOG : POLICY_CATALOG_FILE
	const directory = hosted ? `${POLICY_SURFACE_HOST}/guides` : 'guides'
	const names = new Set(readPolicyCatalog(host, catalog))
	if (!existsSync(join(host, 'guides')) || names.size === 0) {
		return [
			createPolicyViolation(
				'surface',
				directory,
				'surface evidence missing: hosted guides and a populated catalog are required',
			),
		]
	}
	const missing = [...names].flatMap((name) =>
		isPolicyFile(host, `guides/${name}.md`)
			? []
			: [
					createPolicyViolation(
						'surface',
						`${directory}/${name}.md`,
						`surface evidence missing: catalog package ${name} has no hosted guide`,
					),
				],
	)
	// A guide without a Surface section answers its violation and no names.
	const guides = globSync('guides/*.md', { cwd: host })
		.map(normalizePolicyPath)
		.sort()
		.flatMap(
			(
				path,
			): ReadonlyArray<{
				readonly owner: string
				readonly symbols: readonly string[]
				readonly violation?: PolicyViolation
			}> => {
				const owner = basename(path, '.md')
				if (owner === POLICY_GUIDE_MAP) return []
				const guide = createGuide(readFileSync(join(host, path), 'utf8'))
				return guide.sections().includes('Surface')
					? [{ owner, symbols: guide.surface().map((symbol) => symbol.name) }]
					: [
							{
								owner,
								symbols: [],
								violation: createPolicyViolation(
									'surface',
									`${directory}/${owner}.md`,
									'surface evidence missing: hosted guide has no Surface section',
								),
							},
						]
			},
		)
	const grandfather = new Set(
		guides.filter((guide) => guide.owner === own).flatMap(({ symbols }) => symbols),
	)
	const claimed = Map.groupBy(
		guides
			.filter((guide) => guide.owner !== own)
			.flatMap(({ owner, symbols }) => symbols.map((name) => ({ name, owner }))),
		({ name }) => name,
	)
	const population = readPolicySurface(root)
	const setups = globSync('tests/setup*.ts', { cwd: root })
		.map(normalizePolicyPath)
		.sort()
		.flatMap((path) =>
			path.endsWith('.test.ts') || matchesScaffoldSetup(path, root)
				? []
				: [collectPolicyDeclarations(root, path, readFileSync(join(root, path), 'utf8'))],
		)
	const declarations = [
		...population.declarations.filter((declaration) => !grandfather.has(declaration.name)),
		...setups.flatMap((read) => read.declarations),
	]
	const claims = declarations.flatMap((declaration) =>
		[...new Set(claimed.get(declaration.name)?.map(({ owner }) => owner))].map((owner) => ({
			declaration,
			owner,
			key: `${declaration.path}\n${declaration.name}\n${owner}`,
		})),
	)
	const violations = [
		...missing,
		...guides.flatMap(({ violation }) => (violation === undefined ? [] : [violation])),
		...population.violations,
		...setups.flatMap((read) => (read.violation === undefined ? [] : [read.violation])),
		...claims
			.filter((claim, index) => claims.findIndex((other) => other.key === claim.key) === index)
			.map(({ declaration, owner }) =>
				createPolicyViolation(
					'surface',
					declaration.path,
					`surface name belongs to one package: ${declaration.name} (${owner})`,
					declaration.line,
				),
			),
	]
	return violations.sort((first, second) => {
		if (first.path !== second.path) return first.path < second.path ? -1 : 1
		if (first.line !== second.line) return (first.line ?? 0) - (second.line ?? 0)
		return first.message === second.message ? 0 : first.message < second.message ? -1 : 1
	})
}

/**
 * Inspects every policy rule across one workspace.
 *
 * @param root - The workspace root to inspect.
 * @returns Every mirror, suppression, dist import, text, skill, bridge, portability, prose, and
 * surface violation.
 */
export function inspectPolicyWorkspace(root: string): readonly PolicyViolation[] {
	return [
		...inspectPolicyMirrors(root),
		...inspectPolicySuppressions(root),
		...inspectPolicyDist(root),
		...inspectPolicyText(root),
		...inspectSkillFamily(root),
		...inspectSkillBridges(root),
		...inspectPolicyPortability(root),
		...inspectPolicyProse(root),
		...inspectPolicySurface(root),
	]
}

/**
 * Writes a control to a real temporary workspace and runs the production sweep over it.
 *
 * The control's rule selects the sweep: `skill` inspects the canonical family, `bridge` inspects
 * provider bridges, and every other rule inspects the whole workspace route.
 *
 * @param control - The physical fixture and expected rule boundary.
 * @returns Every violation reported through the production workspace route.
 */
export function inspectPolicyControl(control: PolicyControl): readonly PolicyViolation[] {
	const scratch = createPolicyScratch({ prefix: 'orkestrel-policy-' })
	try {
		writePolicySurfaceHost(scratch)
		for (const file of control.files) {
			scratch.write(file.path, file.content)
		}
		for (const directory of control.directories ?? []) {
			const marker = `${directory}/.policy-control`
			scratch.write(marker, '')
			rmSync(join(scratch.path, marker))
		}
		if (control.rule === 'skill') return inspectSkillFamily(scratch.path, process.cwd())
		if (control.rule === 'bridge') return inspectSkillBridges(scratch.path)
		return inspectPolicyWorkspace(scratch.path)
	} finally {
		scratch.destroy()
	}
}

/** Lists the physical negative controls, one for each rule the sweep claims to enforce. */
export const POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a suppression directive in a scanned source file',
		membership: 'source, test, config, and script files in the suppression population',
		rule: 'suppression',
		files: [
			{
				path: 'scripts/control.ts',
				content: `// ${POLICY_SUPPRESSION_DIRECTIVE}\ndebugger\n`,
			},
		],
	},
	{
		label: 'rejects a suppression directive in a skill script',
		membership: 'skill scripts in the suppression population',
		rule: 'suppression',
		files: [
			{
				path: '.agents/skills/sample/scripts/control.ts',
				content: `// ${POLICY_SUPPRESSION_DIRECTIVE}\ndebugger\n`,
			},
		],
	},
	{
		label: 'rejects a suppression directive in a root TSX file',
		membership: 'root code files in the suppression population',
		rule: 'suppression',
		files: [
			{
				path: 'probeRoot.tsx',
				content: `// ${POLICY_SUPPRESSION_DIRECTIVE}\ndebugger\n`,
			},
		],
	},
	{
		label: 'rejects a formatter directive in a sheet partial',
		membership: 'sheet files in the suppression population',
		rule: 'suppression',
		files: [
			{
				path: 'src/styles/_control.scss',
				content: `// ${POLICY_FORMATTER_DIRECTIVE}\n.control {\n\tcolor: red;\n}\n`,
			},
		],
	},
	{
		label: 'rejects an unmirrored module test',
		membership: 'module tests below tests/src or tests/app except integration.test.ts',
		rule: 'mirror',
		files: [
			{
				path: 'tests/app/worker/jobs/probe.test.ts',
				content: "import { it } from 'vitest'\nit('runs', () => {})\n",
			},
		],
	},
	{
		label: 'rejects a module whose stem only prefixes the test stem',
		membership: 'module paths whose exact extensionless stem differs from the test stem',
		rule: 'mirror',
		files: [
			{ path: 'app/browser/WidgetPanel.vue', content: '<template></template>\n' },
			{ path: 'tests/app/browser/Widget.test.ts', content: '' },
		],
	},
	{
		label: 'rejects a partial whose stem differs from the test stem',
		membership: 'partial module paths whose exact underscore-free stem differs from the test stem',
		rule: 'mirror',
		files: [
			{ path: 'app/browser/styles/_token.scss', content: '' },
			{ path: 'tests/app/browser/styles/tokens.test.ts', content: '' },
		],
	},
	{
		label: 'rejects a test with no module candidate',
		membership: 'module tests with no matching module path in any registered form',
		rule: 'mirror',
		files: [{ path: 'tests/app/browser/Widget.test.ts', content: '' }],
	},
	{
		label: 'rejects a non-setup module inside tests',
		membership: 'tests-axis modules whose stem does not start with setup',
		rule: 'mirror',
		files: [
			{ path: 'tests/app/core/widget.ts', content: '' },
			{ path: 'tests/app/core/widget.test.ts', content: '' },
		],
	},
])

/** Lists root setup mirror controls and their expected mirror readings. */
export const SETUP_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects an exporting setup module without proof',
		membership: 'target-owned exporting root setup modules',
		rule: 'mirror',
		files: [{ path: 'tests/setupStyles.ts', content: 'export const STYLES = 1\n' }],
		violations: [
			{
				rule: 'mirror',
				path: 'tests/setupStyles.ts',
				message:
					'exporting setup module requires its sibling proof or an import from tests/setup.test.ts',
			},
		],
	},
	{
		label: 'admits a non-exporting setup module without proof',
		membership: 'root setup modules without exports',
		rule: 'mirror',
		files: [{ path: 'tests/setupStyles.ts', content: 'const canvas = 1\nvoid canvas\n' }],
		violations: [],
	},
	{
		label: 'rejects a setup proof without its module',
		membership: 'target-owned root setup proofs',
		rule: 'mirror',
		files: [{ path: 'tests/setupStyles.test.ts', content: '' }],
		violations: [
			{
				rule: 'mirror',
				path: 'tests/setupStyles.test.ts',
				message: 'setup proof requires its module: tests/setupStyles.ts',
			},
		],
	},
	{
		label: 'admits a module imported by the shared setup proof',
		membership: 'root setup modules with shared proof imports',
		rule: 'mirror',
		files: [
			{ path: 'tests/setupStyles.ts', content: 'export const STYLES = 1\n' },
			{ path: 'tests/setup.ts', content: '' },
			{ path: 'tests/setup.test.ts', content: "import { STYLES } from './setupStyles.js'\n" },
		],
		violations: [],
	},
	{
		label: 'rejects a commented import in the shared setup proof',
		membership: 'exporting root setup modules named only by comments',
		rule: 'mirror',
		files: [
			{ path: 'tests/setupStyles.ts', content: 'export const STYLES = 1\n' },
			{ path: 'tests/setup.ts', content: '' },
			{
				path: 'tests/setup.test.ts',
				content: "/*\nimport { STYLES } from './setupStyles.js'\n*/\nexport {}\n",
			},
		],
		violations: [
			{
				rule: 'mirror',
				path: 'tests/setupStyles.ts',
				message:
					'exporting setup module requires its sibling proof or an import from tests/setup.test.ts',
			},
		],
	},
	{
		label: 'admits the distribution harness without a sibling proof',
		membership: 'content-owned distribution setup module outside the mirror population',
		rule: 'mirror',
		files: [{ path: 'tests/setupDistribution.ts', content: 'export const DISTRIBUTION = 1\n' }],
		violations: [],
	},
	{
		label: 'admits an inventory-vendored setup module without proof',
		membership: 'host-inventory setup modules outside the mirror population',
		rule: 'mirror',
		files: [{ path: 'tests/setupPolicy.ts', content: 'export const POLICY = 1\n' }],
		violations: [],
	},
	{
		label: 'requires a proof for a private workspace distribution module',
		membership: 'target-owned distribution setup module in a private workspace',
		rule: 'mirror',
		files: [
			{ path: 'package.json', content: '{"private":true}\n' },
			{ path: 'tests/setupDistribution.ts', content: 'export const DISTRIBUTION = 1\n' },
		],
		violations: [
			{
				rule: 'mirror',
				path: 'tests/setupDistribution.ts',
				message:
					'exporting setup module requires its sibling proof or an import from tests/setup.test.ts',
			},
		],
	},
])

/** Lists tests-tree placement controls and their expected mirror readings. */
export const INFRASTRUCTURE_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a root setup module outside the canon names',
		membership: 'root setup modules the canon does not name',
		rule: 'mirror',
		files: [{ path: 'tests/setupCanvas.ts', content: 'const canvas = 1\nvoid canvas\n' }],
		violations: [
			{ rule: 'mirror', path: 'tests/setupCanvas.ts', message: POLICY_INFRASTRUCTURE_MESSAGE },
		],
	},
	{
		label: 'rejects a helper module inside the mirrored tree',
		membership: 'non-test modules beneath tests outside the root setup modules',
		rule: 'mirror',
		files: [{ path: 'tests/src/core/suite.ts', content: '' }],
		violations: [
			{ rule: 'mirror', path: 'tests/src/core/suite.ts', message: POLICY_INFRASTRUCTURE_MESSAGE },
		],
	},
	{
		label: 'admits the canon setup modules, a bench, a declaration file, and a fixture entry',
		membership: 'modules the tests tree may hold',
		rule: 'mirror',
		files: [
			{ path: 'tests/setupServer.ts', content: 'const server = 1\nvoid server\n' },
			{ path: 'tests/setupBrowser.ts', content: 'const browser = 1\nvoid browser\n' },
			{ path: 'tests/src/core/helpers.bench.ts', content: '' },
			{ path: 'tests/env.d.ts', content: '' },
			{ path: 'tests/src/server/fixtures/child.ts', content: '' },
		],
		violations: [],
	},
	{
		label: 'reports an exporting setup module outside the canon names once',
		membership: 'exporting root setup modules the canon does not name',
		rule: 'mirror',
		files: [{ path: 'tests/setupCanvas.ts', content: 'export const CANVAS = 1\n' }],
		violations: [
			{ rule: 'mirror', path: 'tests/setupCanvas.ts', message: POLICY_INFRASTRUCTURE_MESSAGE },
		],
	},
	{
		label: 'reports an exporting setup module outside the canon names once in a private workspace',
		membership: 'exporting root setup modules the canon does not name, private workspace',
		rule: 'mirror',
		files: [
			{ path: 'package.json', content: '{"private":true}\n' },
			{ path: 'tests/setupCanvas.ts', content: 'export const CANVAS = 1\n' },
		],
		violations: [
			{ rule: 'mirror', path: 'tests/setupCanvas.ts', message: POLICY_INFRASTRUCTURE_MESSAGE },
		],
	},
	{
		label: 'admits an exporting setup-named declaration file and bench',
		membership: 'declaration files and benches whose names open with setup',
		rule: 'mirror',
		files: [
			{
				path: 'tests/setupTypes.d.ts',
				content: 'export interface Shape {\n\treadonly value: number\n}\n',
			},
			{ path: 'tests/setupTiming.bench.ts', content: 'export const TIMING = 1\n' },
		],
		violations: [],
	},
])

/** Lists standalone sheet selections and their core-bearing control for the vendored proof. */
export const SHEET_POLICY_SELECTIONS: ReadonlyArray<
	Pick<Blueprint, 'src' | 'styles' | 'themes'> & {
		readonly conformance?: boolean
		readonly tree?: boolean
		readonly integration?: boolean
		readonly files?: readonly PolicySource[]
		readonly control?: {
			readonly before: string
			readonly after: string
			readonly failure: string
		}
	}
> = Object.freeze([
	{ src: [], styles: true, themes: true },
	{ src: [], styles: false, themes: true },
	{
		src: [],
		styles: false,
		themes: true,
		integration: true,
		control: {
			before: "existsSync(resolveWorkspacePath('tests/setupStyles.ts'))",
			after: 'true',
			failure: './tests/setupStyles.ts',
		},
	},
	{ src: ['core'], styles: true, themes: true },
	{
		src: ['core'],
		styles: false,
		themes: false,
		tree: true,
		files: [{ path: 'tests/tree.test.ts', content: 'export {}\n' }],
	},
	{
		src: ['core', 'browser'],
		styles: true,
		themes: true,
		conformance: true,
		integration: true,
		files: [
			{
				path: 'src/styles/_tokens.scss',
				content:
					'// Every published sheet opens with the same full statement so load order cannot change layer order.\n@layer reset, base, bootstrap, theme, elements, components, surfaces, composables, modifiers, utilities;\n',
			},
			{
				path: 'src/styles/themes/index.scss',
				content:
					"// Tokens declares only the shared layer order, so this sheet carries no styles defaults.\n@use '../tokens';\n@use 'default';\n",
			},
			{ path: 'tests/conformance.test.ts', content: 'export {}\n' },
			{ path: 'tests/integration.test.ts', content: 'export {}\n' },
			{ path: 'tests/setupServer.ts', content: 'export {}\n' },
		],
	},
	{
		src: ['core'],
		styles: false,
		themes: false,
		conformance: true,
		files: [{ path: 'tests/conformance.test.ts', content: 'export {}\n' }],
		control: {
			before: "setupFiles: ['./tests/setup.ts', './tests/setupServer.ts']",
			after: "setupFiles: ['./tests/setup.ts']",
			failure: './tests/setupServer.ts',
		},
	},
	{
		src: ['core'],
		styles: true,
		themes: false,
		integration: true,
		files: [{ path: 'tests/setupStyles.ts', content: 'export {}\n' }],
		control: {
			before: "? ['./tests/setupStyles.ts']",
			after: '? []',
			failure: './tests/setupStyles.ts',
		},
	},
	{
		src: ['core', 'browser'],
		styles: false,
		themes: false,
		integration: true,
		control: {
			before: "include: ['tests/integration.test.ts'],\n\t\t\tsetupFiles: ['./tests/setup.ts']",
			after:
				"include: ['tests/integration.test.ts'],\n\t\t\tsetupFiles: ['./tests/setup.ts', './tests/setupBrowser.ts']",
			failure: './tests/setupBrowser.ts',
		},
	},
])

/** Matches the required opening themes directives without fixing quote style. */
export const SHEET_POLICY_BARREL_PATTERN =
	/^@use\s+(['"])\.\.\/tokens\1;\s*@use\s+(['"])default\2;/u

/** Matches a sheet's opening layer order with at least two authored names. */
export const SHEET_POLICY_ORDER_PATTERN = /^@layer\s+[-\w.]+(?:\s*,\s*[-\w.]+)+\s*;/u

/**
 * Reads a stylesheet after its leading comments and whitespace.
 * @param text - The authored stylesheet.
 * @returns The stylesheet beginning at its first directive or rule.
 */
export function readSheetPrelude(text: string): string {
	return text.replace(/^(?:\s|\/\/[^\r\n]*(?:\r\n|\n|$)|\/\*[\s\S]*?\*\/)+/u, '')
}

/** Lists the physical in-family controls for every skill-family assertion class. */
export const SKILL_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a named script of another skill that does not exist',
		membership: 'script paths qualified with another skill directory in canonical skill documents',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: SKILL_POLICY_TEXT + '\nRun `node .agents/skills/other/scripts/gone.ts` first.\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		violations: [
			{
				rule: 'skill',
				path: '.agents/skills/other/scripts/gone.ts',
				message:
					"SKILL.md names another skill's script that resolves to an exact-case regular file: .agents/skills/other/scripts/gone.ts",
			},
		],
	},
	{
		label: 'accepts a named script of another skill that exists',
		membership: 'script paths qualified with another skill directory in canonical skill documents',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT + '\nRun `node .agents/skills/other/scripts/present.ts` first.\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{
				path: '.agents/skills/other/SKILL.md',
				content:
					SKILL_POLICY_TEXT.replace('name: sample', 'name: other') +
					'\nRun `scripts/present.ts`.\n',
			},
			{ path: '.agents/skills/other/agents/openai.yaml', content: createSkillMetadata('other') },
			{
				path: '.agents/skills/other/scripts/present.ts',
				content: '// Usage: node .agents/skills/other/scripts/present.ts\n',
			},
			{ path: 'tests/agents/skills/other/scripts/present.test.ts', content: '' },
		],
		violations: [],
	},
	{
		label: 'rejects a skill script with no mirrored proof',
		membership: 'skill scripts against tests/agents/skills/<skill>/scripts/*.test.ts',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: SKILL_POLICY_TEXT + '\nRun `scripts/lone.ts`.\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{
				path: '.agents/skills/sample/scripts/lone.ts',
				content: '// Usage: node .agents/skills/sample/scripts/lone.ts\n',
			},
		],
		violations: [
			{
				rule: 'skill',
				path: 'tests/agents/skills/sample/scripts/lone.test.ts',
				message:
					'skill script has a mirrored proof: tests/agents/skills/sample/scripts/lone.test.ts',
			},
		],
	},
	{
		label: 'rejects a skill proof that imports a skill file other than its own script',
		membership: 'relative imports of skill proofs against the script each proof mirrors',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: SKILL_POLICY_TEXT + '\nRun `scripts/probe.ts`.\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{
				path: '.agents/skills/sample/scripts/probe.ts',
				content: '// Usage: node .agents/skills/sample/scripts/probe.ts\n',
			},
			{
				path: 'tests/agents/skills/sample/scripts/probe.test.ts',
				content:
					"import { read } from '../../../../../.agents/skills/other/scripts/helpers.ts'\nvoid read\n",
			},
		],
		violations: [
			{
				rule: 'skill',
				path: 'tests/agents/skills/sample/scripts/probe.test.ts',
				message:
					'skill proof imports no skill file but its own script: .agents/skills/other/scripts/helpers.ts',
			},
		],
	},
	{
		label: 'accepts a skill proof that imports its own script and a test setup module',
		membership: 'relative imports of skill proofs against the script each proof mirrors',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: SKILL_POLICY_TEXT + '\nRun `scripts/probe.ts`.\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{
				path: '.agents/skills/sample/scripts/probe.ts',
				content: '// Usage: node .agents/skills/sample/scripts/probe.ts\n',
			},
			{
				path: 'tests/agents/skills/sample/scripts/probe.test.ts',
				content: [
					"import { read } from '../../../../../.agents/skills/sample/scripts/probe.ts'",
					"import { runSkillScript } from '../../../../setupServer.js'",
					'void read',
					'void runSkillScript',
				].join('\n'),
			},
		],
		violations: [],
	},
	{
		label: 'rejects an unexported value binding in a skill fence',
		membership: 'named value imports in canonical skill fences',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n```ts\nimport { s2MissingValue } from "@orkestrel/test/browser"\n```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		violations: [
			{
				rule: 'skill',
				path: '.agents/skills/sample/SKILL.md',
				message: 'skill fence import @orkestrel/test/browser does not export s2MissingValue',
			},
		],
	},
	{
		label: 'rejects an unexported type binding in a skill fence',
		membership: 'named type imports in canonical skill fences',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n```ts\nimport type { S2MissingType } from "@orkestrel/test/browser"\n```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		violations: [
			{
				rule: 'skill',
				path: '.agents/skills/sample/SKILL.md',
				message: 'skill fence import @orkestrel/test/browser does not export S2MissingType',
			},
		],
	},
	{
		label: 'accepts exported value and type bindings from root and browser entries',
		membership: 'named value and type imports in canonical skill fences',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n```ts\nimport { waitForCondition, type WaitOptions } from "@orkestrel/test"\nimport { clickAccessible } from "@orkestrel/test/browser"\nimport type { CaptureVariant } from "@orkestrel/test/browser"\n```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		violations: [],
	},
	{
		label: 'reports one absent binding beside exported bindings in the same fence',
		membership: 'named value and type imports in canonical skill fences',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n```ts\nimport { s2MissingValue, type WaitOptions } from "@orkestrel/test"\nimport { clickAccessible } from "@orkestrel/test/browser"\nimport type { CaptureVariant } from "@orkestrel/test/browser"\n```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		violations: [
			{
				rule: 'skill',
				path: '.agents/skills/sample/SKILL.md',
				message: 'skill fence import @orkestrel/test does not export s2MissingValue',
			},
		],
	},
	{
		label: 'accepts a fenced import of the package the inspected workspace itself publishes',
		membership: 'named imports of the workspace package in canonical skill fences',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n```ts\nimport { BASE_DEV_DEPENDENCIES } from "@orkestrel/scaffold"\n```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		violations: [],
	},
	{
		label: 'rejects a skill fence the parser cannot read beside an Orkestrel import',
		membership: 'canonical skill fences whose text names an Orkestrel specifier',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n```ts\nimport { waitForCondition } from "@orkestrel/test"\nconst value =\n```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a fenced package outside the base dependency set',
		membership: 'Orkestrel package imports in canonical skill fences',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT + '\n```ts\nimport { isString } from "@orkestrel/contract"\n```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		violations: [
			{
				rule: 'skill',
				path: '.agents/skills/sample/SKILL.md',
				message:
					'skill fence import @orkestrel/contract is outside BASE_DEV_DEPENDENCIES: @orkestrel/contract',
			},
		],
	},
	{
		label: 'reports an unexported binding against its named reference file',
		membership: 'named imports in fences in referenced skill documents',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_REFERENCE_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{
				path: '.agents/skills/sample/references/example.md',
				content:
					'# Example\n\n~~~ts\nimport { s2MissingReference } from "@orkestrel/test/browser"\n~~~\n',
			},
		],
		violations: [
			{
				rule: 'skill',
				path: '.agents/skills/sample/references/example.md',
				message: 'skill fence import @orkestrel/test/browser does not export s2MissingReference',
			},
		],
	},
	{
		label: 'rejects a SKILL.md without frontmatter',
		membership: 'exact-case regular SKILL.md files in discovered skill directories',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: '# Skill\n' },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects an unsupported description scalar shape',
		membership: 'description scalars in discovered skill frontmatter',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: |\n  Use this skill for a policy fixture.\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects extra frontmatter keys',
		membership: 'parsed frontmatter keys in discovered skill documents',
		rule: 'skill',
		message: 'SKILL.md frontmatter contains exactly name and description',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: Use this skill for a policy fixture.\nlicense: MIT\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a frontmatter name that differs from its directory',
		membership: 'parsed names in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md frontmatter name matches its directory',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: other\ndescription: Use this skill for a policy fixture.\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects an empty skill description',
		membership: 'parsed descriptions in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md description is non-empty',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: '---\nname: sample\ndescription: \n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a description without a Use sentence',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		message: 'SKILL.md description names when to use the skill in a sentence beginning Use',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: Exercise the skill family policy.\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a single-quoted description scalar',
		membership: 'description scalars in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md frontmatter exists and parses',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					"---\nname: sample\ndescription: 'Use this skill for a policy fixture.'\n---\n\n# Skill\n",
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a double-quoted description scalar',
		membership: 'description scalars in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md frontmatter exists and parses',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: "Use this skill for a policy fixture."\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects an unnamed Markdown reference file',
		membership: 'Markdown files directly beneath a discovered skill references directory',
		rule: 'skill',
		message: 'references Markdown file is named by SKILL.md: references/orphan.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/references/orphan.md', content: '# Orphan\n' },
		],
	},
	{
		label: 'rejects a template TODO in skill prose',
		membership:
			'TODO occurrences outside inline backtick spans and fences indented no more than three spaces in canonical SKILL.md files and the references/*.md files they name',
		rule: 'skill',
		message: 'skill documents contain no template TODOs',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: `${SKILL_POLICY_TEXT}\nTODO: describe the workflow\n`,
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a template TODO in a CR-only skill reference',
		membership:
			'TODO occurrences outside inline backtick spans and fenced code blocks in named canonical skill references using CR line endings',
		rule: 'skill',
		line: 5,
		message: 'skill documents contain no template TODOs',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_REFERENCE_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{
				path: '.agents/skills/sample/references/example.md',
				content: '# Example\r```text\rTODO: fenced\r```\rTODO: describe the workflow\r',
			},
		],
	},
	{
		label: 'rejects a template TODO in a four-space-indented fence opener',
		membership:
			'TODO occurrences inside a four-space-indented fence opener and closer, which forms an indented code block outside the fence population, in discovered skill documents',
		rule: 'skill',
		message: 'skill documents contain no template TODOs',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n3. Return the verdict.\n\n    ```text\n    TODO: describe the workflow\n    ```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a nested references directory',
		membership: 'directories directly beneath a discovered skill references directory',
		rule: 'skill',
		message: 'skill references directory contains no subdirectories',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/references/nested/detail.md', content: '# Detail\n' },
		],
	},
	{
		label: 'rejects an auxiliary changelog in a skill directory',
		membership: 'files at any depth inside a discovered skill directory',
		rule: 'skill',
		message: 'skill directory contains no README.md or CHANGELOG.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/CHANGELOG.MD', content: '# Changes\n' },
		],
	},
	{
		label: 'rejects a non-contract file in a skill directory',
		membership: 'regular files at any depth inside a discovered skill directory',
		rule: 'skill',
		message:
			'skill directory contains only SKILL.md, agents/openai.yaml, references/*.md, and scripts/*.ts',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/run.sh', content: '#!/bin/sh\n' },
		],
	},
	{
		label: 'rejects an empty non-contract directory in a skill directory',
		membership: 'directories at any depth inside a discovered skill directory',
		rule: 'skill',
		message: 'skill directory contains only agents/, references/, and scripts/ directories',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		directories: ['.agents/skills/sample/assets'],
	},
	{
		label: 'rejects a missing exact-case SKILL.md',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/skill.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a missing exact-case agents/openai.yaml',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/OpenAI.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a non-regular SKILL.md',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md/child.txt', content: '' },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects malformed agents/openai.yaml metadata',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: 'interface: {}\n' },
		],
	},
	{
		label: 'rejects a default prompt with the wrong skill token',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('other') },
		],
	},
	{
		label: 'rejects a default prompt whose token extends the skill name',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.agents/skills/sample/agents/openai.yaml',
				content: createSkillMetadata('samplex'),
			},
		],
	},
	{
		label: 'rejects a dangling exact-case SKILL.md reference',
		membership: 'references/name.md tokens extracted from canonical SKILL.md text',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_REFERENCE_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
])

/** Lists the physical controls for provider-bridge assertions. */
export const BRIDGE_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a canonical skill without a provider bridge',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'bridge',
		message: 'canonical skill has a matching provider bridge directory',
		files: [{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT }],
	},
	{
		label: 'rejects a provider bridge without a canonical skill',
		membership: 'immediate directories beneath .claude/skills',
		rule: 'bridge',
		message: 'provider bridge directory has a canonical skill twin',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.claude/skills/sample/SKILL.md', content: SKILL_BRIDGE_TEXT },
			{
				path: '.claude/skills/extra/SKILL.md',
				content:
					'---\nname: extra\ndescription: Use this skill for a policy fixture.\n---\n\nRead `.agents/skills/extra/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge without an exact-case SKILL.md',
		membership: 'provider bridge directories shared with the canonical family',
		rule: 'bridge',
		message: 'bridge requires an exact-case regular SKILL.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.claude/skills/sample/skill.md', content: SKILL_BRIDGE_TEXT },
		],
	},
	{
		label: 'rejects malformed bridge frontmatter',
		membership: 'exact-case regular SKILL.md files in shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge SKILL.md frontmatter parses',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content: '# Bridge\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects extra bridge frontmatter keys',
		membership: 'parsed frontmatter keys in shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge SKILL.md frontmatter contains exactly name and description',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: Use this skill for a policy fixture.\nlicense: MIT\n---\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge name that drifts from its canonical twin',
		membership: 'parsed frontmatter in shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge frontmatter name matches its canonical twin',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content:
					'---\nname: other\ndescription: Use this skill for a policy fixture.\n---\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge description that drifts from its canonical twin',
		membership: 'matching immediate directories beneath .agents/skills and .claude/skills',
		rule: 'bridge',
		message: 'bridge frontmatter description matches its canonical twin',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: >-\n  Use this skill for a policy fixture.\n---\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge body without its canonical workflow path',
		membership: 'bodies of exact-case regular bridge SKILL.md files',
		rule: 'bridge',
		message: 'bridge body names its canonical workflow: .agents/skills/sample/SKILL.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content: `${SKILL_POLICY_TEXT}\nRead the canonical workflow.\n`,
			},
		],
	},
	{
		label: 'rejects a template TODO in bridge prose',
		membership:
			'TODO occurrences outside inline backtick spans and fenced code blocks in exact-case bridge SKILL.md files shared with the canonical family',
		rule: 'bridge',
		message: 'skill documents contain no template TODOs',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content: `${SKILL_BRIDGE_TEXT}\nTODO: describe the bridge\n`,
			},
		],
	},
	{
		label: 'rejects a references directory owned by a provider bridge',
		membership: 'shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge owns no references directory',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.claude/skills/sample/SKILL.md', content: SKILL_BRIDGE_TEXT },
			{ path: '.claude/skills/sample/references/detail.md', content: '# Detail\n' },
		],
	},
])

/**
 * Describes an in-family skill whose metadata values carry escaped apostrophes, proving they parse.
 */
export const SKILL_POLICY_APOSTROPHE: PolicyControl = Object.freeze({
	label: 'accepts escaped apostrophes in agents/openai.yaml values',
	membership: 'immediate directories beneath .agents/skills',
	rule: 'skill',
	files: [
		{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
		{ path: '.agents/skills/sample/agents/openai.yaml', content: SKILL_APOSTROPHE_METADATA },
	],
})

/**
 * Describes a folded description containing a colon, proving continuation lines do not become keys.
 */
export const SKILL_POLICY_FOLDED: PolicyControl = Object.freeze({
	label: 'accepts a folded description containing a colon',
	membership: 'folded description scalars in discovered skill frontmatter',
	rule: 'skill',
	files: [
		{
			path: '.agents/skills/sample/SKILL.md',
			content:
				'---\nname: sample\ndescription: >-\n  Use this skill when a continuation contains: a colon.\n---\n\n# Skill\n',
		},
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
	],
})

/** Describes a healthy skill reference whose prose carries the documented backticked TODO form. */
export const SKILL_POLICY_BACKTICKED: PolicyControl = Object.freeze({
	label: 'accepts a backticked TODO in skill prose',
	membership: 'TODO occurrences inside matched inline backtick spans in discovered skill documents',
	rule: 'skill',
	files: [
		{ path: '.agents/skills/sample/SKILL.md', content: SKILL_REFERENCE_TEXT },
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		{
			path: '.agents/skills/sample/references/example.md',
			content: '- every `TODO`, deferred branch, placeholder, or documented omission in scope.\n',
		},
	],
})

/** Describes a healthy skill whose fenced example carries a template-TODO spelling. */
export const SKILL_POLICY_FENCED: PolicyControl = Object.freeze({
	label: 'accepts a TODO in a three-space-indented fenced skill example',
	membership:
		'TODO occurrences inside fenced code blocks indented no more than three spaces in discovered skill documents',
	rule: 'skill',
	files: [
		{
			path: '.agents/skills/sample/SKILL.md',
			content:
				SKILL_POLICY_TEXT +
				'\n3. Return the verdict.\n\n   ```text\n   TODO: describe the workflow\n   ```\n',
		},
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
	],
})

/** Describes a folded description whose blank scalar line separates its paragraphs. */
export const SKILL_POLICY_PARAGRAPHS: PolicyControl = Object.freeze({
	label: 'accepts a folded description containing two paragraphs',
	membership: 'folded description scalars in discovered skill frontmatter',
	rule: 'skill',
	files: [
		{
			path: '.agents/skills/sample/SKILL.md',
			content:
				'---\nname: sample\ndescription: >-\n  First paragraph.\n\n  Use `--app` when a policy fixture needs it.\n---\n\n# Skill\n',
		},
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
	],
})

/**
 * Describes a bridge skill outside the discovered family, used to prove the membership boundary.
 */
export const SKILL_POLICY_EXCLUSION: PolicyControl = Object.freeze({
	label: 'excludes .claude/skills from the skill family',
	membership: 'directories outside .agents/skills',
	rule: 'skill',
	files: [{ path: '.claude/skills/bridge/SKILL.md', content: SKILL_POLICY_TEXT }],
})

/**
 * Creates root instruction text whose rule map names an explicit rule set.
 *
 * @param rules - The workspace-relative rule paths the map registers.
 * @returns Root instruction text carrying one rule map table.
 */
export function createPolicyRuleMap(rules: readonly string[]): string {
	return (
		[
			'# Fixture instructions',
			'',
			POLICY_RULE_MAP_HEADING,
			'',
			'| Rule | Governs |',
			'| ---- | ------- |',
			...rules.map((rule) => `| \`${rule}\` | Fixture rows |`),
		].join('\n') + '\n'
	)
}

/**
 * Creates catalog agent text whose package table names an explicit package set.
 *
 * @param names - The package short names the catalog registers.
 * @returns Catalog agent text carrying one package table.
 */
export function createPolicyCatalog(names: readonly string[]): string {
	return (
		[
			'# Orkestrel',
			'',
			POLICY_CATALOG_HEADING,
			'',
			'| Package | Version |',
			'| ------- | ------- |',
			...names.map((name) => `| \`@orkestrel/${name}\` | \`0.0.1\` |`),
		].join('\n') + '\n'
	)
}

/** Lists the physical controls for every rule-map parity assertion the workspace route reaches. */
export const RULES_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a rule file the rule map omits',
		membership: 'Markdown files directly beneath .claude/rules',
		rule: 'rules',
		message: 'the rule map names every rule file',
		files: [
			{ path: POLICY_RULE_MAP_FILE, content: createPolicyRuleMap([]) },
			{ path: `${POLICY_RULE_ROOT}/sample.md`, content: '# Sample\n' },
		],
	},
	{
		label: 'rejects a rule-map row that resolves to nothing',
		membership: 'backticked first cells in the rule map table',
		rule: 'rules',
		message: 'every rule-map row resolves to a rule file',
		files: [
			{
				path: POLICY_RULE_MAP_FILE,
				content: createPolicyRuleMap([
					`${POLICY_RULE_ROOT}/sample.md`,
					`${POLICY_RULE_ROOT}/missing.md`,
				]),
			},
			{ path: `${POLICY_RULE_ROOT}/sample.md`, content: '# Sample\n' },
		],
	},
])

/** Holds the manifest one prose control writes, naming the package its own guide belongs to. */
export const PROSE_POLICY_MANIFEST = '{\n\t"name": "@orkestrel/sample"\n}\n'

/**
 * Lists the physical controls for every prose-population boundary the workspace route reaches.
 *
 * @remarks
 * Each control that tests an exclusion also writes the arrival file, whose different term proves
 * the sweep ran over the control workspace rather than reporting nothing because it found nothing.
 */
export const PROSE_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a banned term in the workspace front page',
		membership: 'authored Markdown outside the excluded directories and the guide mirrors',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: should (must, can, might, or the imperative)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: 'README.md', content: '# Front page\n\nA reader should meet this term.\n' },
		],
	},
	{
		label: 'rejects a banned term in the package guide',
		membership: 'the top-level guide whose name matches the manifest name',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: should (must, can, might, or the imperative)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: 'guides/sample.md', content: '# Sample\n\nA reader should meet this term.\n' },
		],
	},
	{
		label: 'rejects a banned term in a rule file',
		membership: 'authored Markdown below a dot directory the sweep descends into',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: should (must, can, might, or the imperative)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{
				path: `${POLICY_RULE_ROOT}/sample.md`,
				content: '# Sample\n\nA reader should meet this term.\n',
			},
			{
				path: POLICY_RULE_MAP_FILE,
				content: createPolicyRuleMap([`${POLICY_RULE_ROOT}/sample.md`]),
			},
		],
	},
	{
		label: 'accepts a banned term inside a fenced block',
		membership: 'fenced regions, whose lines are code rather than prose',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: via (through, by using)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: 'README.md', content: '# Front page\n\nA reader arrives via this term.\n' },
			{
				path: 'guides/README.md',
				content: '# Index\n\n```text\nshould inside a fence\n```\n',
			},
		],
	},
	{
		label: 'accepts a banned term inside a code span a line break runs through',
		membership: 'inline code spans, whose text is a token rather than prose',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: via (through, by using)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: 'README.md', content: '# Front page\n\nA reader arrives via this term.\n' },
			{
				path: 'guides/README.md',
				content: '# Index\n\nA span `that\nspans lines with should` here.\n',
			},
		],
	},
	{
		label: 'accepts a banned term in a guide the catalog registers to another package',
		membership: 'top-level guides the catalog registers to a package other than this one',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: via (through, by using)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: POLICY_CATALOG_FILE, content: createPolicyCatalog(['other', 'sample']) },
			{ path: 'README.md', content: '# Front page\n\nA reader arrives via this term.\n' },
			{ path: 'guides/other.md', content: '# Other\n\nA reader should meet this term.\n' },
		],
	},
	{
		label: 'rejects a top-level guide the catalog does not register',
		membership: 'top-level guides that are neither this package, nor the index, nor a catalog row',
		rule: 'prose',
		message: "guide is the package's own, the map, or a catalog row",
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: POLICY_CATALOG_FILE, content: createPolicyCatalog(['other', 'sample']) },
			{ path: 'guides/stray.md', content: '# Stray\n\nA reader reads this guide.\n' },
		],
	},
	{
		label: 'accepts a banned term inside an installed package',
		membership: 'Markdown below a directory name the sweep never descends into',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: via (through, by using)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: 'README.md', content: '# Front page\n\nA reader arrives via this term.\n' },
			{
				path: 'node_modules/sample/README.md',
				content: '# Installed\n\nA reader should meet this term.\n',
			},
		],
	},
	{
		label: 'accepts a banned term inside scratch work',
		membership: 'Markdown below a directory name the sweep never descends into',
		rule: 'prose',
		line: 3,
		message: 'prose carries no banned term: via (through, by using)',
		files: [
			{ path: POLICY_MANIFEST_FILE, content: PROSE_POLICY_MANIFEST },
			{ path: 'README.md', content: '# Front page\n\nA reader arrives via this term.\n' },
			{ path: 'tmp/notes.md', content: '# Notes\n\nA reader should meet this term.\n' },
		],
	},
])

/** Lists the physical controls for every portability assertion the workspace route reaches. */
export const PORTABILITY_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a reserved device name',
		membership: 'path segments in the workspace-authored path population',
		rule: 'portability',
		message: 'path segments avoid the names Windows reserves',
		files: [{ path: 'src/worker/con.ts', content: '' }],
	},
	{
		label: 'rejects a segment that ends with a dot',
		membership: 'path segments in the workspace-authored path population',
		rule: 'portability',
		message: 'path segments end with neither a dot nor a space',
		files: [{ path: 'src/worker/helpers.ts.', content: '' }],
	},
	{
		label: 'rejects a segment that ends with a space',
		membership: 'path segments in the workspace-authored path population',
		rule: 'portability',
		message: 'path segments end with neither a dot nor a space',
		files: [{ path: 'src/worker/helpers.ts ', content: '' }],
	},
	{
		label: 'rejects a shell script named by a manifest script',
		membership: 'string values beneath the manifest scripts record',
		rule: 'portability',
		message: 'manifest scripts name no .sh file: prepare',
		files: [
			{
				path: POLICY_MANIFEST_FILE,
				content: '{\n\t"scripts": {\n\t\t"prepare": "bash scripts/prepare.sh"\n\t}\n}\n',
			},
		],
	},
	...[
		['a shell file outside scripts', 'src/worker/run.sh'],
		['a bash file outside scripts', 'configs/setup.bash'],
		['a PowerShell file outside scripts', 'tests/probe.ps1'],
		['a Python file outside scripts', 'guides/build.py'],
		['a batch file outside scripts', 'build.bat'],
		['a command file outside scripts', '.claude/hook.cmd'],
	].map(([label, path]): PolicyControl => ({
		label: `rejects ${label}`,
		membership: 'shell, PowerShell, Python, and batch extensions in the file path population',
		rule: 'portability',
		message: 'shell, PowerShell, Python, and batch files sit only in scripts',
		files: [{ path: path ?? '', content: '' }],
	})),
	{
		label: 'rejects a non-shell file inside scripts',
		membership: 'every file beneath the scripts directory',
		rule: 'portability',
		message: 'scripts holds .sh files and nothing else',
		files: [{ path: 'scripts/probe.ts', content: '' }],
	},
])

/**
 * Holds the message prefix a dist-import violation carries, written out so the controls read the
 * production message from a second copy.
 */
export const DIST_POLICY_MESSAGE =
	'tracked TypeScript imports nothing from dist, which exists only after npm run build'

/**
 * Lists the physical controls for every import into the built output the workspace route refuses
 * and admits.
 *
 * @remarks
 * Each refusal sits beside an admission drawn from outside its population, so a sweep that reports
 * nothing because it read nothing fails a refusal. The admissions cover a specifier the rule does
 * not read, a path that only resembles the output directory, and a directory the rule does not walk.
 */
export const DIST_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a static import that resolves into dist',
		membership: 'static import specifiers of source, app, test, and config TypeScript',
		rule: 'dist',
		files: [
			{
				path: 'tests/src/server/control.ts',
				content:
					"import { createServer } from '../../../dist/src/server/index.js'\nvoid createServer\n",
			},
		],
		violations: [
			{
				rule: 'dist',
				path: 'tests/src/server/control.ts',
				message: `${DIST_POLICY_MESSAGE}: ../../../dist/src/server/index.js`,
			},
		],
	},
	{
		label: 'rejects a type import that resolves into dist',
		membership: 'static import specifiers of source, app, test, and config TypeScript',
		rule: 'dist',
		files: [
			{
				path: 'configs/control.ts',
				content:
					"import type { Sample } from '../dist/src/core/index.js'\nexport type Held = Sample\n",
			},
		],
		violations: [
			{
				rule: 'dist',
				path: 'configs/control.ts',
				message: `${DIST_POLICY_MESSAGE}: ../dist/src/core/index.js`,
			},
		],
	},
	{
		label: 'rejects a re-export that resolves into dist',
		membership: 'export-from specifiers of source, app, test, and config TypeScript',
		rule: 'dist',
		files: [
			{
				path: 'src/core/control.ts',
				content: "export * from '../../dist/src/core/index.js'\n",
			},
		],
		violations: [
			{
				rule: 'dist',
				path: 'src/core/control.ts',
				message: `${DIST_POLICY_MESSAGE}: ../../dist/src/core/index.js`,
			},
		],
	},
	{
		label: 'rejects a dynamic import with a literal specifier that resolves into dist',
		membership: 'import() expressions with a string-literal source',
		rule: 'dist',
		files: [
			{
				path: 'app/server/control.ts',
				content: "export const load = () => import('../../dist/app/server/main.js')\n",
			},
		],
		violations: [
			{
				rule: 'dist',
				path: 'app/server/control.ts',
				message: `${DIST_POLICY_MESSAGE}: ../../dist/app/server/main.js`,
			},
		],
	},
	{
		label: 'rejects a dynamic import whose template literal has no substitution',
		membership: 'import() expressions with a template-literal source and no substitution',
		rule: 'dist',
		files: [
			{
				path: 'app/server/control.ts',
				content: 'export const load = () => import(`../../dist/app/server/main.js`)\n',
			},
		],
		violations: [
			{
				rule: 'dist',
				path: 'app/server/control.ts',
				message: `${DIST_POLICY_MESSAGE}: ../../dist/app/server/main.js`,
			},
		],
	},
	{
		label: 'admits a dynamic import with a computed specifier',
		membership: 'import() expressions with a computed source',
		rule: 'dist',
		files: [
			{
				path: 'src/core/control.ts',
				content:
					"const entry = '../../dist/src/core/index.js'\nexport const load = () => import(entry)\nexport const select = (name: string) => import(`../../dist/${name}.js`)\n",
			},
		],
		violations: [],
	},
	{
		label: 'admits a package specifier and a dist path held only as text',
		membership: 'specifiers the rule resolves, beside strings and comments it does not read',
		rule: 'dist',
		files: [
			{
				path: 'tests/control.ts',
				content:
					"// import '../dist/src/core/index.js'\nimport { it } from 'vitest'\nexport const path = '../dist/src/core/index.js'\nvoid it\n",
			},
		],
		violations: [],
	},
	{
		label: 'admits a dist directory that is not the workspace output',
		membership: 'relative specifiers that resolve outside the root dist directory',
		rule: 'dist',
		files: [
			{
				path: 'src/core/control.ts',
				content:
					"import './dist/index.js'\nimport '../distribution/index.js'\nimport '../../../sibling/dist/index.js'\n",
			},
		],
		violations: [],
	},
	{
		label: 'admits an import into dist from a directory the rule does not walk',
		membership: 'TypeScript outside src, app, tests, and configs',
		rule: 'dist',
		files: [
			{
				path: 'scripts/control.ts',
				content: "import '../dist/src/core/index.js'\n",
			},
		],
		violations: [],
	},
	{
		label: 'rejects a JSON import and a dotted extensionless import that resolve into dist',
		membership:
			'specifiers the type check reads from disk under resolveJsonModule and bundler resolution',
		rule: 'dist',
		files: [
			{
				path: 'tests/src/core/control.ts',
				content:
					"import meta from '../../../dist/meta.json'\nimport config from '../../../dist/configs/vite.journey.config'\nvoid meta\nvoid config\n",
			},
		],
		violations: [
			{
				rule: 'dist',
				path: 'tests/src/core/control.ts',
				message: `${DIST_POLICY_MESSAGE}: ../../../dist/meta.json`,
			},
			{
				rule: 'dist',
				path: 'tests/src/core/control.ts',
				message: `${DIST_POLICY_MESSAGE}: ../../../dist/configs/vite.journey.config`,
			},
		],
	},
	{
		label: 'admits a built asset an ambient declaration types',
		membership: 'specifiers with a query or a non-code extension',
		rule: 'dist',
		files: [
			{
				path: 'tests/src/styles/index.test.ts',
				content:
					"import sheet from '../../../dist/src/styles/index.css?raw'\nimport icon from '../../../dist/src/icon.svg'\nvoid sheet\nvoid icon\n",
			},
		],
		violations: [],
	},
])

/**
 * Holds the message prefix a text violation carries, written out so the controls read the
 * production message from a second copy.
 */
export const TEXT_POLICY_MESSAGE = 'text carries no replacement, byte-order, or control character'

/**
 * Lists the physical controls for every text-integrity refusal and admission the workspace route
 * reaches.
 *
 * @remarks
 * Every character a control plants is written as a `\u` escape here, so this file carries none of
 * the characters it tests for. Each excluded-directory control also writes the arrival file, whose
 * refusal proves the sweep ran over the control workspace rather than reporting nothing because it
 * found nothing. A file whose bytes are not UTF-8 cannot be written through a text fixture, so the
 * proofs of that refusal write the bytes themselves.
 */
export const TEXT_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a bell control character in a source file',
		membership: 'source files in the suppression population, C0 controls beyond the three allowed',
		rule: 'text',
		files: [{ path: 'src/control.ts', content: "const bell = 'a\u0007b'\n" }],
		violations: [
			{
				rule: 'text',
				path: 'src/control.ts',
				line: 1,
				message: `${TEXT_POLICY_MESSAGE}: \\u0007`,
			},
		],
	},
	{
		label: 'rejects an escape control character in authored Markdown',
		membership: 'authored Markdown outside the excluded directories, C0 controls',
		rule: 'text',
		files: [{ path: 'README.md', content: '# Front page\n\ncolor \u001B[31m\n' }],
		violations: [
			{
				rule: 'text',
				path: 'README.md',
				line: 3,
				message: `${TEXT_POLICY_MESSAGE}: \\u001B`,
			},
		],
	},
	{
		label: 'rejects a C1 control character',
		membership: 'source files in the suppression population, C1 controls',
		rule: 'text',
		files: [{ path: 'src/control.ts', content: "const a = 1\nconst next = 'a\u0085b'\n" }],
		violations: [
			{
				rule: 'text',
				path: 'src/control.ts',
				line: 2,
				message: `${TEXT_POLICY_MESSAGE}: \\u0085`,
			},
		],
	},
	{
		label: 'rejects the delete control character',
		membership: 'source files in the suppression population, the control above the ASCII range',
		rule: 'text',
		files: [{ path: 'src/control.ts', content: "const del = 'a\u007Fb'\n" }],
		violations: [
			{
				rule: 'text',
				path: 'src/control.ts',
				line: 1,
				message: `${TEXT_POLICY_MESSAGE}: \\u007F`,
			},
		],
	},
	{
		label: 'rejects a replacement character',
		membership: 'authored Markdown outside the excluded directories, decoded text',
		rule: 'text',
		files: [{ path: 'README.md', content: '# Front page\n\nbroken \uFFFD text\n' }],
		violations: [
			{
				rule: 'text',
				path: 'README.md',
				line: 3,
				message: `${TEXT_POLICY_MESSAGE}: \\uFFFD`,
			},
		],
	},
	{
		label: 'rejects a byte-order mark that opens a file',
		membership: 'source files in the suppression population, the first character of a file',
		rule: 'text',
		files: [{ path: 'src/control.ts', content: '\uFEFFexport {}\n' }],
		violations: [
			{
				rule: 'text',
				path: 'src/control.ts',
				line: 1,
				message: `${TEXT_POLICY_MESSAGE}: \\uFEFF`,
			},
		],
	},
	{
		label: 'rejects a byte-order mark inside a literal',
		membership: 'source files in the suppression population, a character within a line',
		rule: 'text',
		files: [{ path: 'src/control.ts', content: "const path = '\uFEFFleading.txt'\n" }],
		violations: [
			{
				rule: 'text',
				path: 'src/control.ts',
				line: 1,
				message: `${TEXT_POLICY_MESSAGE}: \\uFEFF`,
			},
		],
	},
	{
		label: 'names each refused character once on a line that repeats it',
		membership: 'refused characters grouped by line, in order of first appearance',
		rule: 'text',
		files: [{ path: 'src/control.ts', content: "const mixed = 'a\u0007b\u0007c\u001B'\n" }],
		violations: [
			{
				rule: 'text',
				path: 'src/control.ts',
				line: 1,
				message: `${TEXT_POLICY_MESSAGE}: \\u0007`,
			},
			{
				rule: 'text',
				path: 'src/control.ts',
				line: 1,
				message: `${TEXT_POLICY_MESSAGE}: \\u001B`,
			},
		],
	},
	{
		label: 'accepts tab, line feed, carriage return, and intentional Unicode',
		membership: 'the characters a text file may carry, composed and decomposed forms included',
		rule: 'text',
		files: [
			{
				path: 'src/control.ts',
				content: "const note = 'café\tcafé — \u{1F600}'\r\n\t\n",
			},
			{ path: 'README.md', content: '# Front page\r\n\r\nplain é — text\n' },
		],
		violations: [],
	},
	{
		label: 'accepts a control character below an excluded directory',
		membership: 'Markdown below a directory name the sweep never descends into',
		rule: 'text',
		files: [
			{ path: 'README.md', content: '# Front page\n\ncolor \u001B[31m\n' },
			{ path: 'node_modules/sample/README.md', content: '# Installed\n\nbell \u0007\n' },
		],
		violations: [
			{
				rule: 'text',
				path: 'README.md',
				line: 3,
				message: `${TEXT_POLICY_MESSAGE}: \\u001B`,
			},
		],
	},
	...[
		{
			label: 'rejects a bell control character in a skill script',
			membership: 'skill scripts in the suppression population, C0 controls',
			path: '.agents/skills/sample/scripts/control.ts',
			content: "const bell = 'a\u0007b'\n",
		},
		{
			label: 'rejects a bell control character in a root JSON file',
			membership: 'root JSON files in the text population, C0 controls',
			path: 'tsconfig.json',
			content: '{\n\t"note": "a\u0007b"\n}\n',
		},
		{
			label: 'rejects a bell control character in a root dot JSON file',
			membership: 'root dot-prefixed JSON files in the text population, C0 controls',
			path: '.oxlintrc.json',
			content: '{\n\t"note": "a\u0007b"\n}\n',
		},
		{
			label: 'rejects a bell control character in a JSON file below an instruction folder',
			membership: 'JSON files below .agents, .claude, .codex, and .cursor, C0 controls',
			path: '.claude/settings.json',
			content: '{\n\t"note": "a\u0007b"\n}\n',
		},
		{
			label: 'rejects a bell control character in a TOML role file',
			membership: 'TOML files below .agents, .claude, .codex, and .cursor, C0 controls',
			path: '.codex/agents/sample.toml',
			content: 'name = "sample"\nnote = "a\u0007b"\n',
		},
		{
			label: 'rejects a bell control character in a skill metadata file',
			membership: 'YAML files below .agents, .claude, .codex, and .cursor, C0 controls',
			path: '.agents/skills/sample/agents/openai.yaml',
			content: "interface:\n  display_name: 'a\u0007b'\n",
		},
		{
			label: 'rejects a bell control character in a Cursor rule file',
			membership: 'MDC files below .agents, .claude, .codex, and .cursor, C0 controls',
			path: '.cursor/rules/sample.mdc',
			content: '---\nalwaysApply: true\n---\na\u0007b\n',
		},
		{
			label: 'rejects a bell control character in the attributes file',
			membership: 'the root .gitattributes file, C0 controls',
			path: '.gitattributes',
			content: '* text=auto eol=lf\n# a\u0007b\n',
		},
		{
			label: 'rejects a bell control character in the formatter ignore file',
			membership: 'the root .prettierignore file, C0 controls',
			path: '.prettierignore',
			content: 'dist/\n# a\u0007b\n',
		},
	].map(({ label, membership, path, content }): PolicyControl => ({
		label,
		membership,
		rule: 'text',
		files: [{ path, content }],
		violations: [
			{
				rule: 'text',
				path,
				line: content.split('\n').findIndex((line) => line.includes('\u0007')) + 1,
				message: `${TEXT_POLICY_MESSAGE}: \\u0007`,
			},
		],
	})),
	{
		label: 'accepts a control character in JSON outside the instruction folders and the root',
		membership: 'JSON files below src and tmp, which the text population does not reach',
		rule: 'text',
		files: [
			{ path: 'README.md', content: '# Front page\n\ncolor \u001B[31m\n' },
			{ path: 'src/data.json', content: '{\n\t"note": "a\u0007b"\n}\n' },
			{ path: 'tmp/probe.json', content: '{\n\t"note": "a\u0007b"\n}\n' },
		],
		violations: [
			{
				rule: 'text',
				path: 'README.md',
				line: 3,
				message: `${TEXT_POLICY_MESSAGE}: \\u001B`,
			},
		],
	},
])

/** Pairs a setup-module import fence with the specifiers it refuses and the ones it admits. */
export interface PolicyImportCase {
	/** Names the text of the fence's message the lint configuration carries. */
	readonly marker: string
	/** Lists each module specifier with whether the fence refuses it. */
	readonly cases: ReadonlyArray<readonly [string, boolean]>
	/** States whether a relative specifier outside the fence is also a case that must be admitted. */
	readonly controlled: boolean
}

/** Pairs a setup-module named-import fence with the import clauses it refuses and the ones it admits. */
export interface PolicyNameCase {
	/** Names the text of the fence's message the lint configuration carries. */
	readonly marker: string
	/** Lists the import clauses the fence refuses, each written as the text between the braces. */
	readonly refused: readonly string[]
	/** Lists the import clauses the fence admits, each written as the text between the braces. */
	readonly admitted: readonly string[]
}

/**
 * Lists the refused and admitted specifiers of every setup-module `no-restricted-imports` pattern.
 *
 * @remarks
 * The isolated-pattern proof reads a case from here when a pattern's message carries the marker, and
 * refuses a configuration that carries no pattern for a marker, so a deleted fence cannot pass by
 * leaving nothing to test.
 */
export const POLICY_IMPORT_CASES: readonly PolicyImportCase[] = Object.freeze([
	{
		marker: 'tests/setup.ts must stay host-independent: import no node:',
		controlled: true,
		cases: [
			['node:fs', true],
			['node:fs/promises', true],
			['node:path', true],
			['nodes:fs', false],
			['fs', false],
			['vitest', false],
			['./setupServer.js', false],
		],
	},
	{
		marker: 'tests/setup.ts must stay host-independent: import no Vue',
		controlled: true,
		cases: [
			['vue', true],
			['vue/server-renderer', true],
			['vue?raw', true],
			['@vue/test-utils', true],
			['vue-router', false],
			['vuex', false],
			['node:fs', false],
			['./vue.js', false],
		],
	},
	{
		marker: 'the browser and styles setup modules hold no Node',
		controlled: true,
		cases: [
			['node:fs', true],
			['node:child_process', true],
			['nodes:fs', false],
			['vue', false],
			['playwright', false],
			['./setup.js', false],
		],
	},
	{
		marker: 'configs/policy.ts imports nothing',
		controlled: false,
		cases: [
			['node:fs', true],
			['./helpers.js', true],
			['vitest', true],
			['@orkestrel/test', true],
		],
	},
])

/** Lists the refused and admitted named imports of every setup-module `no-restricted-imports` path. */
export const POLICY_NAME_CASES: readonly PolicyNameCase[] = Object.freeze([
	{
		marker: 'nothing an assertion is',
		refused: [
			'describe',
			'it',
			'test',
			'expect',
			'describe as suite',
			'expect, vi',
			'type TestContext, it',
		],
		admitted: ['vi', 'TestRunner', 'afterEach', 'beforeAll', 'bench'],
	},
])

/**
 * Collects sheet faces from their source markers.
 * @param directory - The workspace root.
 * @returns Source-selected sheet names in sorted order.
 */
export function collectSheets(directory: string): readonly string[] {
	if (!existsSync(resolve(directory, 'src'))) return []
	return readdirSync(resolve(directory, 'src'), { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(resolve(directory, 'src', entry.name, 'index.scss')) &&
				existsSync(resolve(directory, 'src', entry.name, 'sheet.ts')),
		)
		.map((entry) => entry.name)
		.sort()
}

/**
 * Collects the study tests a workspace holds beneath `tests/studies`.
 * @param directory - The workspace root.
 * @returns Sorted workspace-relative paths of the physical `*.test.ts` files, nested or direct,
 * beneath a `tests/studies` directory whose stored name has exactly that case, outside any
 * `node_modules` or `.git` directory, which Vitest's default exclude never collects; empty when
 * the directory is absent, is not a directory, or holds none.
 */
export function collectStudies(directory: string): readonly string[] {
	const tests = resolve(directory, 'tests')
	if (!existsSync(tests)) return []
	// A directory entry carries the name the host stores, so matching it keeps the selection exact-case
	// on a host that folds case, and its type excludes a link without following it.
	const held = readdirSync(tests, { withFileTypes: true })
	if (!held.some((entry) => entry.name === 'studies' && entry.isDirectory())) return []
	const studies: string[] = []
	const pending = ['tests/studies']
	while (pending.length > 0) {
		const current = pending.pop() ?? ''
		for (const entry of readdirSync(resolve(directory, current), { withFileTypes: true })) {
			const path = `${current}/${entry.name}`
			// Vitest's default exclude collects nothing beneath these directories.
			if (entry.isDirectory()) {
				if (entry.name !== 'node_modules' && entry.name !== '.git') pending.push(path)
			} else if (
				entry.isFile() &&
				entry.name.endsWith('.test.ts') &&
				lstatSync(resolve(directory, path)).nlink === 1
			)
				studies.push(path)
		}
	}
	return studies.sort()
}

/**
 * Collects occupied framework faces from the source and application trees.
 * @param directory - The workspace root.
 * @returns Occupied axis and framework paths.
 */
export function collectFrameworks(directory: string): readonly string[] {
	return ['src', 'app'].flatMap((axis) =>
		existsSync(resolve(directory, axis))
			? readdirSync(resolve(directory, axis), { withFileTypes: true })
					.filter((entry) => entry.isDirectory() && entry.name === 'vue')
					.map((entry) => `${axis}/${entry.name}`)
			: [],
	)
}

/**
 * Reads a configuration record without asserting its type.
 * @param value - The configuration value to validate.
 * @returns The record's own entries; throws for a non-record.
 */
export function readConfigRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error('Expected a configuration record')
	return Object.fromEntries(Object.entries(value))
}

/**
 * Reads a declared script and refuses an absent script.
 * @param scripts - The manifest's script record.
 * @param name - The required script name.
 * @returns The declared command; throws for a missing command.
 */
export function readConfigScript(scripts: Readonly<Record<string, unknown>>, name: string): string {
	const script = scripts[name]
	if (typeof script !== 'string') throw new Error(`Missing script ${name}`)
	return script
}

/**
 * Reads source-selected wrappers and refuses a missing wrapper.
 * @param directory - The workspace root.
 * @returns Required wrapper paths; throws for a missing path.
 */
export function collectFaceWrappers(directory: string): readonly string[] {
	const wrappers = [
		...collectSheets(directory).map((face) => `configs/src/vite.${face}.config.ts`),
		...collectFrameworks(directory).map(
			(face) => `configs/${face.replace('/', '/vite.')}.config.ts`,
		),
	]
	for (const wrapper of wrappers)
		if (!existsSync(resolve(directory, wrapper))) throw new Error(`Missing wrapper ${wrapper}`)
	return wrappers
}

/**
 * Inspects sheet setup membership and themes ordering from configuration data.
 * @param project - The resolved sheet project.
 * @param script - The optional chained styles and themes build command.
 * @param directory - The target workspace root; defaults to the policy root.
 * @returns Missing setup paths and invalid isolation or ordering fields.
 */
export function inspectSheetConfiguration(
	project: unknown,
	script?: string,
	directory: string = POLICY_ROOT,
): readonly string[] {
	const test = readConfigRecord(readConfigRecord(project).test)
	const setup = test.setupFiles
	return [
		...[
			'./tests/setup.ts',
			'./tests/setupBrowser.ts',
			...(existsSync(resolve(directory, 'tests/setupStyles.ts')) ? ['./tests/setupStyles.ts'] : []),
		].filter((path) => !Array.isArray(setup) || !setup.includes(path)),
		...(test.isolate !== false ? ['isolate'] : []),
		...(script !== undefined &&
		(!script.includes('vite.styles.config.ts') ||
			!script.includes('vite.themes.config.ts') ||
			script.indexOf('vite.styles.config.ts') > script.indexOf('vite.themes.config.ts'))
			? ['themes order']
			: []),
	]
}

/** Lists source, application, test, configuration, script, and campaign paths for uniform computed-import proofs. */
export const COMPUTED_IMPORT_PATHS: readonly string[] = Object.freeze([
	'src/core/load.ts',
	'src/browser/load.ts',
	'src/server/load.ts',
	'src/server/load.mts',
	'src/server/load.js',
	'src/server/load.mjs',
	'src/server/load.cts',
	'src/server/load.cjs',
	'app/server/load.ts',
	'tests/load.ts',
	'tests/src/server/load.test.ts',
	'configs/load.ts',
	'scripts/load.ts',
	'.orkestrel/sample/load.ts',
	'.orkestrel/sample/instruments/harness/load.ts',
	'.orkestrel/sample/instruments/harness/load.mts',
])

/** Lists nested same-face imports carrying a native collection sentinel in each source. */
export const POLICY_VUE_RELATIVE_SOURCES: readonly PolicySource[] = Object.freeze([
	{
		path: 'app/vue/components/Panel.vue',
		content: [
			'<script lang="ts">',
			"import * as boundary from '../composables/useTheme.js'",
			'void boundary',
			'debugger',
			'</script>',
			'',
		].join('\n'),
	},
	{
		path: 'app/vue/components/dialogs/Panel.vue',
		content: [
			'<script setup lang="ts">',
			"import * as boundary from '../../composables/useTheme.js'",
			'void boundary',
			'debugger',
			'</script>',
			'',
		].join('\n'),
	},
	{
		path: 'app/vue/features/editor/dialogs/helpers.ts',
		content: [
			"import * as boundary from '../../../components/Toolbar.vue'",
			'void boundary',
			'debugger',
			'',
		].join('\n'),
	},
	{
		path: 'app/vue/features/helpers.ts',
		content: [
			"import * as boundary from '../print/index.js'",
			'void boundary',
			'debugger',
			'',
		].join('\n'),
	},
	{
		path: 'src/vue/features/helpers.ts',
		content: [
			"import * as boundary from '../print/index.js'",
			'void boundary',
			'debugger',
			'',
		].join('\n'),
	},
	{
		path: 'src/vue/features/editor/helpers.ts',
		content: [
			"import * as boundary from '../../components/Toolbar.js'",
			'void boundary',
			'debugger',
			'',
		].join('\n'),
	},
])

/** Supplies a valid direct Vue composable with its collection sentinel inside the exported function. */
export const POLICY_VUE_COMPOSABLE_SOURCE: PolicySource = Object.freeze({
	path: 'app/vue/composables/useTheme.ts',
	content: [
		'/** Reads the selected theme. */',
		'export function useTheme(): string {',
		'\tdebugger',
		"\treturn 'light'",
		'}',
		'',
	].join('\n'),
})

/** Lists lexical destinations independently of the host running the test. */
export const POLICY_VUE_TARGET_CASES: ReadonlyArray<
	readonly [string, string, string, string | undefined]
> = Object.freeze([
	[
		'/work/app/vue/components/Panel.vue',
		'/work',
		'../composables/useTheme.js',
		'app/vue/composables/useTheme.js',
	],
	[
		'/work/app/vue/components/dialogs/Panel.vue',
		'/work/',
		'../../composables/useTheme.js',
		'app/vue/composables/useTheme.js',
	],
	['/work/src/vue/features/editor/helpers.ts', '/work', '../../types.js', 'src/vue/types.js'],
	[
		'/work/app/vue/features/editor/dialogs/Panel.vue',
		'/work',
		'../../../components/Toolbar.vue',
		'app/vue/components/Toolbar.vue',
	],
	['/work/app/vue/helpers.ts', '/work', '../print/index.js', 'app/print/index.js'],
	['/work/app/vue/features/helpers.ts', '/work', '../print/index.js', 'app/vue/print/index.js'],
	['/work/src/vue/features/helpers.ts', '/work', '../print/index.js', 'src/vue/print/index.js'],
	['/work/app/vue/helpers.ts', '/work', '../browser?x', 'app/browser'],
	['/work/app/vue/helpers.ts', '/work', '../browser/#fragment', 'app/browser'],
	['/work/app/vue/helpers.ts', '/work', './entry.js?raw#fragment', 'app/vue/entry.js'],
	['/work/app/vue/helpers.ts', '/work', './%2e%2e/entry.js', 'app/vue/%2e%2e/entry.js'],
	['/work/app/vue/helpers.ts', '/work', '../../src/vue/helpers.js', 'src/vue/helpers.js'],
	[
		'/work/src/vue/nested/app/vue/helpers.ts',
		'/work',
		'../print/index.js',
		'src/vue/nested/app/print/index.js',
	],
	['/app/vue/helpers.ts', '/', './entry.js', 'app/vue/entry.js'],
	['C:/work/app/vue/features/helpers.ts', 'C:/work/', '../types.js', 'app/vue/types.js'],
	['C:\\work\\app\\vue\\features\\helpers.ts', 'C:\\work\\', '../types.js', 'app/vue/types.js'],
	['C:\\app\\vue\\helpers.ts', 'C:\\', './entry.js', 'app/vue/entry.js'],
	[
		'\\\\host\\share\\work\\app\\vue\\features\\helpers.ts',
		'\\\\host\\share\\work\\',
		'../types.js',
		'app/vue/types.js',
	],
	['//host/share/app/vue/helpers.ts', '//host/share', './entry.js', 'app/vue/entry.js'],
	['/work-other/app/vue/helpers.ts', '/work', './entry.js', undefined],
	['C:/work-other/app/vue/helpers.ts', 'C:/work', './entry.js', undefined],
	['c:/work/app/vue/helpers.ts', 'C:/work', './entry.js', undefined],
	['D:/work/app/vue/helpers.ts', 'C:/work', './entry.js', undefined],
	['//host/other/app/vue/helpers.ts', '//host/share', './entry.js', undefined],
	['/work/app/vuex/helpers.ts', '/work', './entry.js', undefined],
	['/work/other/app/vue/helpers.ts', '/work', './entry.js', undefined],
	['app/vue/helpers.ts', '/work', './entry.js', undefined],
	['/work/app/vue/helpers.ts', 'work', './entry.js', undefined],
	['/work/../other/app/vue/helpers.ts', '/work/../other', './entry.js', undefined],
	['/work/app/vue/helpers.ts', '/work', '../../../print/index.js', undefined],
	['/work/app/vue/helpers.ts', '/work', './../types.js', undefined],
	['/work/app/vue/helpers.ts', '/work', '.././types.js', undefined],
	['/work/app/vue/helpers.ts', '/work', './name/../types.js', undefined],
	['/work/app/vue/helpers.ts', '/work', './name/./types.js', undefined],
	['/work/app/vue/helpers.ts', '/work', './name//types.js', undefined],
	['/work/app/vue/helpers.ts', '/work', '..\\types.js', undefined],
	['/work/app/vue/helpers.ts', '/work', '/machine/entry.js', undefined],
	['/work/app/vue/helpers.ts', '/work', '@src/vue', undefined],
	['/work/app/vue/helpers.ts', '/work', '././entry.js', undefined],
	['/work/app/vue/helpers.ts', '/work', './.', undefined],
	['/work/app/vue/helpers.ts', '/work', '././entry.js?raw#fragment', undefined],
	['/work/app/vue/helpers.ts', '/work', './entry.js', 'app/vue/entry.js'],
	['/work/app/vue/features/helpers.ts', '/work', '../entry.js', 'app/vue/entry.js'],
	['/work/app/vue/helpers.ts', '/work', '.', 'app/vue'],
	['/work/app/vue/helpers.ts', '/work', './', 'app/vue'],
])

/** Lists the two existing override owners without inferring faces from a filename suffix. */
export const POLICY_VUE_FACES = Object.freeze(['src/vue', 'app/vue'] as const)

/** Lists importer locations that a directly invoked Vue rule must refuse to classify. */
export const POLICY_VUE_UNCLASSIFIED_FILES = Object.freeze([
	'../outside/app/vue/helpers.ts',
	'other/app/vue/helpers.ts',
	'app/vuex/helpers.ts',
])

/** Lists native source-bearing syntax, distinguishing forms that need TypeScript parsing. */
export const POLICY_VUE_IMPORT_FORMS = Object.freeze([
	{ name: 'value', before: 'import * as boundary from ', after: '\nvoid boundary', typed: false },
	{ name: 'type', before: 'import type { Boundary } from ', after: '', typed: true },
	{ name: 'named', before: 'export { boundary } from ', after: '', typed: false },
	{ name: 'star', before: 'export * from ', after: '', typed: false },
	{ name: 'namedType', before: 'export type { Boundary } from ', after: '', typed: true },
	{ name: 'starType', before: 'export type * from ', after: '', typed: true },
	{ name: 'dynamic', before: 'void import(', after: ')', typed: false },
])

/** Lists every configured extension and both native Vue script extraction forms. */
export const POLICY_VUE_POPULATIONS = Object.freeze([
	{ name: 'cjs', extension: 'cjs', before: '', after: '', typed: false },
	{ name: 'cts', extension: 'cts', before: '', after: '', typed: true },
	{ name: 'js', extension: 'js', before: '', after: '', typed: false },
	{ name: 'jsx', extension: 'jsx', before: '', after: '', typed: false },
	{ name: 'mjs', extension: 'mjs', before: '', after: '', typed: false },
	{ name: 'mts', extension: 'mts', before: '', after: '', typed: true },
	{ name: 'ts', extension: 'ts', before: '', after: '', typed: true },
	{ name: 'tsx', extension: 'tsx', before: '', after: '', typed: true },
	{
		name: 'script',
		extension: 'vue',
		before: '<script lang="ts">\n',
		after: '</script>\n',
		typed: true,
	},
	{
		name: 'setup',
		extension: 'vue',
		before: '<script setup lang="ts">\n',
		after: '</script>\n',
		typed: true,
	},
])

/** Crosses admitted nested imports and refused sibling imports with the actual syntax populations. */
export const POLICY_VUE_IMPORT_CASES: readonly PolicyVueImportCase[] = Object.freeze(
	POLICY_VUE_FACES.flatMap((face) =>
		POLICY_VUE_POPULATIONS.flatMap((population) =>
			POLICY_VUE_IMPORT_FORMS.filter((form) => !form.typed || population.typed).flatMap((form) =>
				[false, true].map((boundary) => ({
					path: `${face}/${boundary ? '' : 'features/editor/'}${population.name}${form.name}.${population.extension}`,
					content:
						population.before +
						form.before +
						JSON.stringify(boundary ? '../print/index.js' : '../../components/Toolbar.vue') +
						form.after +
						'\ndebugger\n' +
						population.after,
					boundary,
					restricted: false,
				})),
			),
		),
	),
)

/** Lists relative destinations and independent raw-spelling bans under the complete configuration. */
export const POLICY_VUE_BOUNDARY_ROWS: ReadonlyArray<readonly [string, string, boolean, boolean]> =
	Object.freeze([
		['helpers.ts', '../print/index.js', true, false],
		['helpers.ts', '../src/print/index.js', true, false],
		['helpers.ts', '../print.ext/index.js', true, false],
		['helpers.ts', '../vuex/index.js', true, false],
		['helpers.ts', '../corex/index.js', true, false],
		['helpers.ts', '../browserx/index.js', true, false],
		['helpers.ts', '../print?raw', true, false],
		['helpers.ts', '../print#fragment', true, false],
		['features/helpers.ts', '../print/index.js', false, false],
		['features/helpers.ts', '../print.ext/index.js', false, false],
		['features/editor/dialogs/helpers.ts', '../../../components/Toolbar.vue', false, false],
		['features/editor/helpers.ts', '../../../print/index.js', true, false],
		['features/editor/helpers.ts', '../../../../src/print/index.js', true, false],
		['features/helpers.ts', '../types.js?raw#fragment', false, false],
		['helpers.ts', './index.js', false, false],
		['helpers.ts', '../../../outside/index.js', true, false],
		['helpers.ts', '@src/core', false, false],
		['helpers.ts', '@src/browser', false, false],
		['helpers.ts', '@src/vue', false, false],
		['helpers.ts', '@src/print', false, true],
		['helpers.ts', '@src/corex', false, true],
		['helpers.ts', '@src/', false, true],
		['helpers.ts', '@src/server', false, true],
		['helpers.ts', '@orkestrel/sample/server', false, true],
		['helpers.ts', 'node:fs', false, true],
		['helpers.ts', 'fs/promises', false, true],
		['helpers.ts', '/machine/entry.js', false, true],
		['helpers.ts', 'C:/machine/entry.js', false, true],
		['helpers.ts', 'C:\\machine\\entry.js', false, true],
		['helpers.ts', 'file:///machine/entry.js', false, true],
		['helpers.ts', 'https://host/entry.js', false, true],
		['helpers.ts', 'data:text/javascript,export{}', false, true],
		['helpers.ts', '..\\print\\index.js', false, true],
		['helpers.ts', './../types.js', true, true],
		['helpers.ts', '.././types.js', true, true],
		['helpers.ts', './name/../types.js', true, true],
		['helpers.ts', './name/./types.js', true, true],
		['helpers.ts', './name//types.js', true, true],
		['helpers.ts', 'typescript', false, true],
		['helpers.ts', '../server/index.js', true, true],
		['features/helpers.ts', '../server/index.js', false, true],
	])

/** Supplies face-specific alias requirements and preserves existing application-relative admissions. */
export const POLICY_VUE_OWNER_ROWS: Readonly<
	Record<string, ReadonlyArray<readonly [string, string, boolean, boolean]>>
> = Object.freeze({
	'src/vue': [
		['helpers.ts', '../browser?x', false, true],
		['helpers.ts', '../browser#fragment', false, true],
		['helpers.ts', '@app/core', false, true],
		['features/helpers.ts', '../../../app/core/types.js', true, true],
		['features/helpers.ts', '../../core/helpers.js', false, true],
		['features/helpers.ts', '../../browser/helpers.js', false, true],
		['features/helpers.ts', '../core/helpers.js', false, true],
		['features/helpers.ts', '../browser/helpers.js', false, true],
		['nested/app/vue/helpers.ts', '../print/index.js', false, false],
	],
	'app/vue': [
		['helpers.ts', '../browser?x', false, false],
		['helpers.ts', '../browser#fragment', false, false],
		['helpers.ts', '../browser/index.js', false, false],
		['features/helpers.ts', '../../browser/helpers.js', false, false],
		['helpers.ts', '../core/index.js', false, false],
		['helpers.ts', '../../src/core/index.js', false, false],
		['helpers.ts', '../../src/browser/index.js', false, false],
		['helpers.ts', '../../src/vue/index.js', false, false],
		['helpers.ts', '@app/core', false, false],
		['helpers.ts', '@app/browser', false, false],
		['helpers.ts', '@app/vue', false, false],
		['helpers.ts', '@app/print', false, true],
		['helpers.ts', '@app/server', false, true],
		['features/helpers.ts', '../../server/index.js', true, true],
		['helpers.ts', '../../src/server/index.js', true, true],
		['nested/src/vue/helpers.ts', '../print/index.js', false, false],
	],
})

/** Materializes the boundary rows as separate collected modules without resolving their targets. */
export const POLICY_VUE_BOUNDARY_CASES: readonly PolicyVueImportCase[] = Object.freeze([
	...POLICY_VUE_FACES.flatMap((face) =>
		[...POLICY_VUE_BOUNDARY_ROWS, ...(POLICY_VUE_OWNER_ROWS[face] ?? [])].map(
			([file, source, boundary, restricted], index) => ({
				path: `${face}/${file.replace('helpers.ts', `boundary${index}.ts`)}`,
				content:
					'import * as boundary from ' + JSON.stringify(source) + '\nvoid boundary\ndebugger\n',
				boundary,
				restricted,
			}),
		),
	),
	...POLICY_VUE_FACES.flatMap((face) => [
		{
			path: `${face}/leadingdotentry.ts`,
			content: 'import * as boundary from "././entry.js"\nvoid boundary\ndebugger\n',
			boundary: true,
			restricted: false,
		},
		{
			path: `${face}/leadingdotonly.ts`,
			content: 'import * as boundary from "./."\nvoid boundary\ndebugger\n',
			boundary: true,
			restricted: false,
		},
		{
			path: `${face}/leadingdotquery.ts`,
			content: 'import * as boundary from "././entry.js?raw#fragment"\nvoid boundary\ndebugger\n',
			boundary: true,
			restricted: false,
		},
	]),
])

/** Lists nonliteral sources and source-less exports the relative rule leaves to their existing owners. */
export const POLICY_VUE_COMPUTED_FORMS = Object.freeze([
	'const target = "../print/index.js"; void import(target)',
	'void import("../print/" + "index.js")',
	'void import(`../print/index.js`)',
	'const boundary = 1; export { boundary }',
])

/** Supplies collection sentinels for nonliteral and source-less forms in every configured population. */
export const POLICY_VUE_COMPUTED_CASES: readonly PolicyVueImportCase[] = Object.freeze(
	POLICY_VUE_FACES.flatMap((face) =>
		POLICY_VUE_POPULATIONS.flatMap((population) =>
			POLICY_VUE_COMPUTED_FORMS.map((content, index) => ({
				path: `${face}/computed${population.name}${index}.${population.extension}`,
				content: population.before + content + '\ndebugger\n' + population.after,
				boundary: false,
				restricted: false,
			})),
		),
	),
)

/** Lists the measured CommonJS parser refusals by original relative filename, token, and offset. */
export const POLICY_VUE_PARSER_ROWS: ReadonlyArray<readonly [string, string, number]> =
	Object.freeze([
		['cjsvalue.cjs', 'import', 0],
		['features/editor/cjsvalue.cjs', 'import', 0],
		['cjsnamed.cjs', 'export', 0],
		['features/editor/cjsnamed.cjs', 'export', 0],
		['cjsstar.cjs', 'export', 0],
		['features/editor/cjsstar.cjs', 'export', 0],
		['computedcjs3.cjs', 'export', 20],
	])

/** Retains each original parser-refused input on both faces with its exact expected native location. */
export const POLICY_VUE_PARSER_CASES = Object.freeze(
	POLICY_VUE_FACES.flatMap((face) =>
		POLICY_VUE_PARSER_ROWS.map(([file, keyword, offset]) => {
			const path = `${face}/${file}`
			const source = [...POLICY_VUE_IMPORT_CASES, ...POLICY_VUE_COMPUTED_CASES].find(
				(candidate) => candidate.path === path,
			)
			if (source === undefined) throw new Error(`Missing original Vue parser fixture ${path}`)
			return {
				...source,
				keyword,
				message: `Cannot use ${keyword} statement outside a module`,
				span: { offset, length: keyword.length, line: 1, column: offset + 1 },
			}
		}),
	),
)

/** Retains all other original inputs under strict rule-code and debugger-sentinel validation. */
export const POLICY_VUE_PARSED_CASES: readonly PolicyVueImportCase[] = Object.freeze(
	[...POLICY_VUE_IMPORT_CASES, ...POLICY_VUE_COMPUTED_CASES].filter(
		(source) => !POLICY_VUE_PARSER_CASES.some((refused) => refused.path === source.path),
	),
)

/** Preserves the two removed relative alternatives solely for scratch regression controls. */
export const POLICY_VUE_ORIGINAL_RELATIVES: Readonly<Record<string, string>> = Object.freeze({
	'src/vue': String.raw`(?:\.\./)+(?:src/)?(?:[^/.scbv][^/.]*|s|s[^/.r][^/.]*|sr|sr[^/.c][^/.]*|src[^/.][^/.]*|c|c[^/.o][^/.]*|co|co[^/.r][^/.]*|cor|cor[^/.e][^/.]*|core[^/.][^/.]*|b|b[^/.r][^/.]*|br|br[^/.o][^/.]*|bro|bro[^/.w][^/.]*|brow|brow[^/.s][^/.]*|brows|brows[^/.e][^/.]*|browse|browse[^/.r][^/.]*|browser[^/.][^/.]*|v|v[^/.u][^/.]*|vu|vu[^/.e][^/.]*|vue[^/.][^/.]*)(?:/|$)`,
	'app/vue': String.raw`(?:\.\./)+(?:src/|app/)?(?:[^/.sacbv][^/.]*|s|s[^/.r][^/.]*|sr|sr[^/.c][^/.]*|src[^/.][^/.]*|a|a[^/.p][^/.]*|ap|ap[^/.p][^/.]*|app[^/.][^/.]*|c|c[^/.o][^/.]*|co|co[^/.r][^/.]*|cor|cor[^/.e][^/.]*|core[^/.][^/.]*|b|b[^/.r][^/.]*|br|br[^/.o][^/.]*|bro|bro[^/.w][^/.]*|brow|brow[^/.s][^/.]*|brows|brows[^/.e][^/.]*|browse|browse[^/.r][^/.]*|browser[^/.][^/.]*|v|v[^/.u][^/.]*|vu|vu[^/.e][^/.]*|vue[^/.][^/.]*)(?:/|$)`,
})

/** Lists direct domain failures and look-alike folders that must remain unregistered. */
export const POLICY_VUE_DOMAIN_CASES: readonly PolicyVueDomainCase[] = Object.freeze([
	{ ...POLICY_VUE_COMPOSABLE_SOURCE, misplaced: false, malformed: false },
	{
		path: 'app/vue/composables/useWrong.ts',
		content: 'export function useMode(): void { debugger }\n',
		misplaced: false,
		malformed: true,
	},
	{
		path: 'app/vue/composables/useHidden.ts',
		content: 'function useHidden(): void { debugger }\n',
		misplaced: false,
		malformed: true,
	},
	{
		path: 'app/vue/composables/useMany.ts',
		content: 'export function useMany(): void { debugger }\nexport function useOther(): void {}\n',
		misplaced: false,
		malformed: true,
	},
	{
		path: 'app/vue/composables/useExtra.ts',
		content: 'const extra = 1\nexport function useExtra(): void { debugger; void extra }\n',
		misplaced: false,
		malformed: true,
	},
	...[
		'app/vue/composables/nested/useTheme.ts',
		'app/vue/composables/nested/app/vue/composables/useTheme.ts',
		'app/vue/composablesExtra/useTheme.ts',
		'app/vue/other/useTheme.ts',
		'src/vue/composables/useTheme.ts',
		'app/vue/composables/index.ts',
		'app/vue/composables/main.ts',
		'app/vue/composables/UseTheme.ts',
	].map((path) => ({
		path,
		content: POLICY_VUE_COMPOSABLE_SOURCE.content,
		misplaced: true,
		malformed: false,
	})),
	{
		path: 'app/vue/composables/helpers.ts',
		content: POLICY_VUE_COMPOSABLE_SOURCE.content,
		misplaced: false,
		malformed: false,
	},
])

/**
 * Reads native diagnostic records through the installed linter without assigning rule codes.
 * @param directory - The fixture workspace containing the lint configuration.
 * @param paths - The fixtures expected to produce native diagnostics.
 * @returns Readonly native records for the caller's rule or parser validation contract.
 */
export function readNativeDiagnostics(
	directory: string,
	paths: readonly string[],
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	const manifestPath = createRequire(import.meta.url).resolve('oxlint/package.json')
	const manifest = readConfigRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
	const entry =
		typeof manifest.bin === 'string' ? manifest.bin : readConfigRecord(manifest.bin).oxlint
	if (typeof entry !== 'string') throw new Error('Missing Oxlint binary')
	const result = spawnSync(
		process.execPath,
		[
			resolve(dirname(manifestPath), entry),
			'--config',
			resolve(directory, '.oxlintrc.json'),
			'--no-ignore',
			'--format',
			'json',
			...paths,
		],
		{ cwd: directory, encoding: 'utf8', timeout: 15_000, windowsHide: true },
	)
	if (result.error !== undefined) throw result.error
	if (result.status !== 1)
		throw new Error(
			JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr }),
		)
	const diagnostics = readConfigRecord(JSON.parse(result.stdout)).diagnostics
	if (!Array.isArray(diagnostics)) throw new Error('Missing lint diagnostics')
	return diagnostics.map(readConfigRecord)
}

/**
 * Reads import restrictions and collection sentinels from the installed linter.
 * @param directory - The fixture workspace containing the lint configuration.
 * @param paths - The fixtures carrying debugger collection sentinels.
 * @returns Diagnostic codes paired with workspace-relative paths.
 */
export function readImportDiagnostics(
	directory: string,
	paths: readonly string[],
): ReadonlySet<string> {
	const diagnostics = readNativeDiagnostics(directory, paths)
	const codes = new Set(
		diagnostics.map((value: unknown) => {
			const diagnostic = readConfigRecord(value)
			if (typeof diagnostic.code !== 'string' || typeof diagnostic.filename !== 'string')
				throw new Error(
					'Missing diagnostic location: ' +
						JSON.stringify({
							offending: value,
							invalidDiagnostics: diagnostics.filter((candidate: unknown) => {
								const candidateRecord = readConfigRecord(candidate)
								return (
									typeof candidateRecord.code !== 'string' ||
									typeof candidateRecord.filename !== 'string'
								)
							}),
						}),
				)
			return (
				diagnostic.code +
				' ' +
				normalizePolicyFilename(realpathSync.native(directory), diagnostic.filename)
			)
		}),
	)
	for (const path of paths)
		if (!codes.has('eslint(no-debugger) ' + path)) throw new Error(`Uncollected fixture ${path}`)
	return codes
}

/**
 * Reports whether a path is a physical directory, never a link to one.
 *
 * @remarks
 * Reads the same two facts `isPhysicalDirectory` reads off an `lstat` and returns false for every
 * inspection error, because this module is vendored byte-identical and imports nothing from the
 * package.
 *
 * @param path - The absolute path to inspect.
 * @returns True if the path is a directory and not a symbolic link; false otherwise, an unreadable
 * path included.
 */
export function isPolicyDirectory(path: string): boolean {
	try {
		const entry = lstatSync(path)
		return entry.isDirectory() && !entry.isSymbolicLink()
	} catch {
		return false
	}
}

/**
 * Resolves a module specifier from this module without throwing.
 *
 * @param specifier - The package or subpath specifier to resolve.
 * @returns The resolved file path, or `undefined` when the workspace installs no such package.
 */
export function resolvePolicyPackage(specifier: string): string | undefined {
	try {
		return createRequire(import.meta.url).resolve(specifier)
	} catch {
		return undefined
	}
}

/** Names the workspace root, the directory above `tests/`, that the vendored proofs inspect. */
export const POLICY_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Holds whether the workspace publishes source from `src`; false for one with application environments alone.
 *
 * @remarks
 * The `src` axis a declaration roll-up reads, derived from a recognized source environment that is
 * a physical directory rather than from a `src` entry of any shape. A regular file, an empty
 * directory, a directory holding no recognized environment, a symbolic link, and an entry this host
 * refuses to inspect each leave a workspace publishing nothing, and reading the entry alone would
 * put every one of them under the face proof. The inspection is caught rather than excused by
 * option: `throwIfNoEntry` excuses an absent path alone and rethrows a permission refusal, and a
 * throw at module scope is a collection error that takes a whole file down in that target rather
 * than failing one case. This is the derivation `targetToEnvironments` uses, which filters the
 * environment names by a contained physical directory, and it answers the same question
 * `blueprintToScripts` answers from a blueprint's own `src` list. A workspace declaring app
 * environments alone publishes no library, so
 * it vendors no `configs/src/` face wrapper and has no roll-up to measure. A face proof is
 * conditioned on this axis rather than on a face wrapper: a workspace that declares the axis and
 * vendors no wrapper carries the defect such a proof reports, so that workspace must still fail the
 * proof. The manifest cases read the same fact from their own `private` flag and name it
 * `manifestPublishes` for the source that decides it there; this reads the axis on disk, so a
 * workspace whose manifest and shape disagree fails one of the two rather than neither.
 */
export const POLICY_PUBLISHES: boolean = ['core', 'browser', 'server'].some((environment) =>
	isPolicyDirectory(resolve(POLICY_ROOT, 'src', environment)),
)

/**
 * Holds the declaration extractor's entry path, or `undefined` where the workspace installs none.
 *
 * @remarks
 * A declaration roll-up loads the extractor package, which only a workspace publishing source from
 * `src` installs. The resolution is the mechanism its proof is conditioned on.
 */
export const POLICY_EXTRACTOR: string | undefined = resolvePolicyPackage('@microsoft/api-extractor')
