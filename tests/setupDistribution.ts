import type { PlaywrightProviderOptions } from '@vitest/browser-playwright'
import type { Browser } from 'playwright'
import type { SpawnSyncReturns } from 'node:child_process'
import type { TestContext } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative as relativePath, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parseSync } from 'vite'
import { chromium } from 'playwright'
import { build } from 'vite'
import { resolveBrowser, resolvePinnedBrowser } from '../configs/browsers.js'

/** Defines the lifecycle and installed consumer read by a distribution proof. */
export interface DistributionSuiteInterface {
	readonly scratch: string
	start(): void
	read(context: TestContext): DistributionStage
	destroy(): void
}

/** Holds the observed and required values for one distribution assertion. */
export interface DistributionObservation {
	readonly actual: unknown
	readonly expected: unknown
}

/** Defines one independently registered distribution observation. */
export interface DistributionCase {
	readonly label: string
	readonly observe: (
		context: TestContext,
	) => DistributionObservation | Promise<DistributionObservation>
}

/** Holds the installed export map's classified publications. */
export interface DistributionClassification {
	readonly entries: readonly DistributionEntry[]
	readonly subpaths: readonly string[]
	readonly undeclared: readonly string[]
	readonly excluded: readonly string[]
	readonly targets: readonly string[]
}

/** Names the workspace whose packed artifact the proof consumes. */
export const DISTRIBUTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Names the npm executable on the running host. */
export const DISTRIBUTION_NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// The compiler this workspace installs, run as a command rather than called in
// process: the command and its plain-text diagnostics are the same across the
// compiler majors this toolchain supports, and its in-process API is not. It is
// resolved from the workspace under proof, so a consumer of the packed artifact is
// checked by the same compiler that workspace's own `check` script runs. TypeScript 7 exports
// `package.json` but not `bin/tsc`, so the path is joined from the manifest's directory.
/** Names the TypeScript manifest installed by the workspace under proof. */
export const DISTRIBUTION_TYPESCRIPT = createRequire(
	join(DISTRIBUTION_ROOT, 'package.json'),
).resolve('typescript/package.json')
/** Names the compiler installed by the workspace under proof. */
export const DISTRIBUTION_COMPILER = join(dirname(DISTRIBUTION_TYPESCRIPT), 'bin', 'tsc')
// Windows needs a shell to launch a `.cmd`: Node refuses one directly since the
// batch-argument hardening, and `spawnSync` returns `EINVAL` with a null status
// rather than an exit code a caller can read. Every following argument is a literal or
// a path this file built, so the shell has nothing to escape.
/** Selects the Windows command-shell route required by the npm shim. */
export const DISTRIBUTION_SHELL = process.platform === 'win32'
// `prepublishOnly` runs this proof as `npm run test:distribution -- --mode release`,
// and the root configuration's project factories carry that mode into this project.
// Release is the publish gate, so evidence it cannot obtain fails there and skips
// everywhere else: a gate that passes on missing evidence proves nothing.
/** Indicates whether missing prerequisites must fail the publish gate. */
export const DISTRIBUTION_RELEASE = import.meta.env?.MODE === 'release'
// The built output directory convention a browser face may publish from. Every
// selection reads this prefix off the export target and never off the subpath name. A
// workspace whose only published face is the browser one publishes that face at the
// root subpath, so a rule keyed on the subpath name drives a browser bundle through
// Node and the miss is silent.
/** Names the conventional output prefix for a browser publication. */
export const DISTRIBUTION_BROWSER_OUTPUT = './dist/src/browser/'
/** Names the unpublished subpath used as a resolution control. */
export const DISTRIBUTION_ABSENT_SUBPATH = '/no-subpath-is-published-under-this-name'
// A compiler diagnostic that says where it is: the path relative to the directory
// the compiler ran in, the 1-based line and column, the code, and the message. The
// diagnostics are the verdict rather than the exit code, which differs between the
// compiler majors this toolchain supports, so a reported line matching nothing here
// came from something other than a check of a consumer module.
/** Matches the location prefix of a consumer compiler diagnostic. */
export const DISTRIBUTION_DIAGNOSTIC_PATTERN = /^(.+?)\(\d+,\d+\): error TS\d+: /u
/** Lists the bounded registry-readiness command arguments. */
export const DISTRIBUTION_PING = Object.freeze([
	'ping',
	'--fetch-retries=0',
	'--fetch-timeout=5000',
	'--loglevel=silent',
])
/** Names the consumer entry that imports an installed module. */
export const DISTRIBUTION_ESM_DRIVER = 'drive.mjs'
/** Names the consumer entry that requires an installed module. */
export const DISTRIBUTION_CJS_DRIVER = 'drive.cjs'
/** Defines the isolated consumer package manifest. */
export const DISTRIBUTION_CONSUMER_MANIFEST =
	'{ "name": "distribution-consumer", "private": true, "type": "module" }\n'
/** Reads the names exported by an installed ESM entry. */
export const DISTRIBUTION_ESM_DRIVER_SOURCE = `const entry = await import(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`
/** Reads the names exported by an installed CommonJS entry. */
export const DISTRIBUTION_CJS_DRIVER_SOURCE = `const entry = require(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`

// The extensions a JavaScript handler loads as modules. Node loads a native addon
// through its addon handler instead, so that extension is named separately.
/** Lists extensions loaded as JavaScript modules. */
export const DISTRIBUTION_MODULE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs'])
/** Names the extension loaded by the native-addon handler. */
export const DISTRIBUTION_ADDON_EXTENSION = '.node'
// The extensions a declaration file carries. A `require` condition declares
// `.d.cts` and an ESM-only one `.d.mts`, so the `.d.ts` spelling alone does not
// name them.
/** Lists the supported TypeScript declaration extensions. */
export const DISTRIBUTION_DECLARATION_EXTENSIONS = Object.freeze(['.d.ts', '.d.cts', '.d.mts'])
/** Names the module format of a typed consumer. */
export type DistributionFormat = 'module' | 'commonjs'

// The Node import target is resolved with the conditions that driver supplies. The
// CommonJS compile probe is selected from its declaration's format, and its runtime
// drive loads the same subpath through Node's require resolver. Vite's production
// client build enables its module and browser conditions.
/** Defines the conditions each runtime uses to resolve an entry. */
export const DISTRIBUTION_RUNTIME_CONDITIONS = Object.freeze({
	module: Object.freeze(['node-addons', 'node', 'import', 'module-sync']),
	commonjs: Object.freeze(['node-addons', 'node', 'require', 'module-sync']),
	browser: Object.freeze(['module', 'browser', 'production', 'import']),
})
// TypeScript's Node resolutions add `node` to the format condition. Its bundler
// resolution does not, so a browser drive compares against the declaration a bundler
// consumer reads rather than borrowing the Node declaration.
/** Defines the declaration conditions used by bundler consumers. */
export const DISTRIBUTION_BUNDLER_CONDITIONS = Object.freeze({
	module: Object.freeze(['types', 'import']),
	commonjs: Object.freeze(['types', 'require']),
})
/** Defines the declaration conditions paired with each runtime. */
export const DISTRIBUTION_DECLARATION_CONDITIONS = Object.freeze({
	module: Object.freeze(['types', 'node', 'import']),
	commonjs: Object.freeze(['types', 'node', 'require']),
	browser: DISTRIBUTION_BUNDLER_CONDITIONS.module,
})

/** Describes the compiler options and conditions for one consumer resolution. */
export interface DistributionResolution {
	readonly label: string
	readonly resolution: string
	readonly module: string
	readonly conditions: Readonly<Record<DistributionFormat, readonly string[]>>
}

/** Holds the target selected by package condition resolution. */
export interface DistributionTargetResult {
	readonly target: string
}

// Each compile driver carries the compiler options its scratch project sets and
// the conditions TypeScript applies for that resolution and importing format. A
// `require`-only subpath therefore stays in each CommonJS probe that can resolve it.
// The option values are the spellings the project file takes, so nothing here needs
// the compiler's own API to name them.
/** Lists the compiler resolutions driven against installed declarations. */
export const DISTRIBUTION_RESOLUTIONS: readonly DistributionResolution[] = Object.freeze([
	{
		label: 'node16',
		resolution: 'node16',
		module: 'node16',
		conditions: DISTRIBUTION_DECLARATION_CONDITIONS,
	},
	{
		label: 'nodenext',
		resolution: 'nodenext',
		module: 'nodenext',
		conditions: DISTRIBUTION_DECLARATION_CONDITIONS,
	},
	{
		label: 'bundler',
		resolution: 'bundler',
		module: 'esnext',
		conditions: DISTRIBUTION_BUNDLER_CONDITIONS,
	},
])

// The driver a bundled consumer reads declarations under. A browser application
// compiles through a bundler, so the browser drive answers under this one alone,
// and naming it here is what keeps that selection tied to the driver it selects.
/** Selects the compiler resolution used by a browser consumer. */
export const DISTRIBUTION_BROWSER_RESOLUTION = DISTRIBUTION_RESOLUTIONS.find(
	(candidate) => candidate.label === 'bundler',
)
if (DISTRIBUTION_BROWSER_RESOLUTION === undefined)
	throw new Error("DISTRIBUTION_RESOLUTIONS carries no 'bundler' row")

/** Pairs consumer source extensions with their module formats. */
export const DISTRIBUTION_FORMATS: ReadonlyArray<
	readonly [extension: string, format: DistributionFormat]
> = Object.freeze([
	['ts', 'module'],
	['cts', 'commonjs'],
])

// One published subpath, resolved to what this proof can drive: the specifier a
// consumer writes, whether the declarations its consumer formats resolve at all,
// whether the exports map answers the browser condition with a target of its own,
// whether it answers `import` and `require` at all, and whether the target that
// `require` answers with is one that a CommonJS consumer loads.
/** Describes one published subpath and its runtime and declaration capabilities. */
export interface DistributionEntry {
	readonly subpath: string
	readonly specifier: string
	readonly mapping: unknown
	readonly declaration: {
		readonly importable: boolean
		readonly requirable: boolean
		readonly browsable: boolean
	}
	readonly browsable: boolean
	readonly importable: boolean
	readonly requirable: boolean
	readonly loadable: boolean
}

// The installed tree every claim is read from. Every subpath the exports map names
// lands in exactly one of `entries`, `undeclared`, and `excluded`, so a subpath this
// proof cannot drive is reported rather than dropped.
/** Holds the installed consumer and the partition of its published subpaths. */
export interface DistributionStage {
	readonly consumer: string
	readonly installed: string
	readonly archives: readonly string[]
	readonly entries: readonly DistributionEntry[]
	readonly subpaths: readonly string[]
	readonly undeclared: readonly string[]
	readonly excluded: readonly string[]
	readonly targets: readonly string[]
}

/**
 * Checks whether a value is a non-null object other than an array.
 *
 * @param value - The value to inspect.
 * @returns True if the value is a record; false otherwise.
 */
export function isDistributionRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks whether a value is an array of strings.
 *
 * @param value - The value to inspect.
 * @returns True if every array member is a string; false otherwise.
 */
export function isDistributionNames(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((name) => typeof name === 'string')
}

// A fallback list, which is what Node reads an array in an exports entry as. The
// narrowing is what the following walkers need: `Array.isArray` widens an `unknown`
// member to `any`, and an entry read that way is not read at all.
/**
 * Checks whether a value is a fallback array.
 *
 * @param value - The value to inspect.
 * @returns True if the value is an array; false otherwise.
 */
export function isDistributionList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value)
}

// Whether a string is a valid package target. Node rejects a target outside the
// package and a target containing a dot, parent, or node_modules segment during
// package-target resolution. A later module-resolution failure is not the same
// thing: an array falls through the former and keeps the latter.
/**
 * Checks whether a relative package target contains only admitted segments.
 *
 * @param target - The package-relative target.
 * @returns True if the target passes package-target validation; false otherwise.
 */
export function matchesDistributionPackageTarget(target: string): boolean {
	if (!target.startsWith('./')) return false
	const refused = ['.', '..', 'node_modules']
	return target
		.slice(2)
		.split(/[\\/]/u)
		.every((segment) => {
			try {
				return !refused.includes(decodeURIComponent(segment).toLowerCase())
			} catch {
				return !refused.includes(segment.toLowerCase())
			}
		})
}

/**
 * Reads and parses a JSON file.
 *
 * @param path - The file to read.
 * @returns The parsed value. Throws when reading or parsing fails.
 */
export function readDistributionJSON(path: string): unknown {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
	return parsed
}

/**
 * Reads the package name from a manifest.
 *
 * @param path - The manifest to read.
 * @returns The package name. Throws when the manifest has no string name.
 */
export function readDistributionManifestName(path: string): string {
	const manifest = readDistributionJSON(path)
	if (!isDistributionRecord(manifest) || typeof manifest.name !== 'string') {
		throw new Error(`The manifest at ${path} declares no package name`)
	}
	return manifest.name
}

// A host carries a package's required peers at its own root. A consumer that carries none leaves
// npm to place them, and npm can then resolve an optional peer of a peer to a release the
// package's own range refuses, so the consumer declares them as a host would.
/**
 * Reads the peers a host must carry: every peer dependency its metadata does not mark optional.
 *
 * @param path - The manifest to read.
 * @returns Each required peer's name mapped to its declared range.
 */
export function readDistributionPeers(path: string): Readonly<Record<string, string>> {
	const manifest = readDistributionJSON(path)
	if (!isDistributionRecord(manifest) || !isDistributionRecord(manifest.peerDependencies)) {
		return {}
	}
	const meta = isDistributionRecord(manifest.peerDependenciesMeta)
		? manifest.peerDependenciesMeta
		: undefined
	const peers = Object.entries(manifest.peerDependencies).filter(
		(entry): entry is [string, string] => typeof entry[1] === 'string',
	)
	return Object.fromEntries(
		peers.filter(([name]) => {
			const entry = meta?.[name]
			return !isDistributionRecord(entry) || entry.optional !== true
		}),
	)
}

/**
 * Writes the consumer manifest, declaring the required peers as dependencies.
 *
 * @param peers - Each required peer's name mapped to its declared range.
 * @returns The manifest text; the bare manifest when the package declares no required peer.
 */
export function createDistributionConsumerManifest(
	peers: Readonly<Record<string, string>>,
): string {
	const manifest: unknown = JSON.parse(DISTRIBUTION_CONSUMER_MANIFEST)
	if (Object.keys(peers).length === 0 || !isDistributionRecord(manifest)) {
		return DISTRIBUTION_CONSUMER_MANIFEST
	}
	return `${JSON.stringify({ ...manifest, dependencies: peers })}\n`
}

/**
 * Writes a consumer file after creating its parent directory.
 *
 * @param path - The file to write.
 * @param content - The text to write.
 */
export function writeDistributionFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content)
}

/**
 * Combines the output streams of a completed command.
 *
 * @param result - The completed command.
 * @returns The trimmed diagnostic text.
 */
export function readDistributionOutput(result: SpawnSyncReturns<string>): string {
	return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

/**
 * Runs npm with a cache inside the owned scratch directory.
 *
 * @param args - The npm arguments.
 * @param cwd - The working directory.
 * @param scratch - The owned scratch root.
 * @returns The command status and captured streams.
 */
export function runDistributionNpm(
	args: readonly string[],
	cwd: string,
	scratch: string,
): SpawnSyncReturns<string> {
	return spawnSync(DISTRIBUTION_NPM, [...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, npm_config_cache: join(scratch, 'cache') },
		shell: DISTRIBUTION_SHELL,
		windowsHide: true,
	})
}

/**
 * Runs a JavaScript entry with the running Node executable.
 *
 * @param args - The Node arguments.
 * @param cwd - The working directory.
 * @returns The command status and captured streams.
 */
export function runDistributionNode(
	args: readonly string[],
	cwd: string,
): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [...args], { cwd, encoding: 'utf8', windowsHide: true })
}

// Node's own condition matching, read in declaration order.
/**
 * Resolves a package target through conditions and fallback arrays.
 *
 * @param entry - The exports-map entry.
 * @param conditions - The active resolution conditions.
 * @returns The selected target, or undefined when no branch resolves.
 */
export function resolveDistributionPackageTarget(
	entry: unknown,
	conditions: readonly string[],
): DistributionTargetResult | undefined {
	if (typeof entry === 'string') return { target: entry }
	if (isDistributionList(entry)) {
		for (const member of entry) {
			const resolved = resolveDistributionPackageTarget(member, conditions)
			if (resolved !== undefined && matchesDistributionPackageTarget(resolved.target))
				return resolved
		}
		return undefined
	}
	if (!isDistributionRecord(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolveDistributionPackageTarget(nested, conditions)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// A flat entry, a condition-nested entry, and a fallback list all resolve through
// one walker. An entry may declare `types` beside `default` at its top level
// rather than inside `import`, so a fixed `entry.import.types` lookup is not
// equivalent to condition resolution.
/**
 * Resolves the path selected by an exports-map entry.
 *
 * @param entry - The exports-map entry.
 * @param conditions - The active resolution conditions.
 * @returns The selected path, or undefined when no branch resolves.
 */
export function resolveDistributionTarget(
	entry: unknown,
	conditions: readonly string[],
): string | undefined {
	return resolveDistributionPackageTarget(entry, conditions)?.target
}

// Whether a path is a physical file. TypeScript's file-existence check refuses a
// directory at the same spelling and continues to the outer package scope.
/**
 * Checks whether a path names a physical file.
 *
 * @param path - The filesystem path.
 * @returns True if the path names a file; false otherwise.
 */
export function matchesDistributionFile(path: string): boolean {
	try {
		return statSync(path).isFile()
	} catch {
		return false
	}
}

// TypeScript resolves a declaration target by accepting an existing declaration
// directly or by substituting beside a JavaScript target. A missing target leaves
// the containing condition or fallback list unresolved, so the walk continues.
/**
 * Resolves an existing declaration beside a package target.
 *
 * @param target - The package-relative target.
 * @param installed - The installed package root.
 * @returns The declaration target, or undefined when no declaration exists.
 */
export function targetToDistributionDeclaration(
	target: string,
	installed: string,
): string | undefined {
	if (!matchesDistributionPackageTarget(target)) return undefined
	const declaration = target.endsWith('.cjs')
		? `${target.slice(0, -4)}.d.cts`
		: target.endsWith('.mjs')
			? `${target.slice(0, -4)}.d.mts`
			: target.endsWith('.js')
				? `${target.slice(0, -3)}.d.ts`
				: target
	if (declaration === target && !matchesDistributionDeclaration(target)) return undefined
	return matchesDistributionFile(join(installed, declaration)) ? declaration : undefined
}

// The declaration TypeScript resolves through one importing format's conditions.
// Condition objects keep manifest order, and arrays keep fallback order.
/**
 * Resolves an existing declaration through consumer conditions.
 *
 * @param entry - The exports-map entry.
 * @param conditions - The active declaration conditions.
 * @param installed - The installed package root.
 * @returns The declaration target, or undefined when no branch resolves.
 */
export function resolveDistributionDeclaration(
	entry: unknown,
	conditions: readonly string[],
	installed: string,
): string | undefined {
	if (typeof entry === 'string') return targetToDistributionDeclaration(entry, installed)
	if (isDistributionList(entry)) {
		for (const member of entry) {
			const resolved = resolveDistributionDeclaration(member, conditions, installed)
			if (resolved !== undefined) return resolved
		}
		return undefined
	}
	if (!isDistributionRecord(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolveDistributionDeclaration(nested, conditions, installed)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// The nearest package scope that decides a `.d.ts` declaration's module format. A
// physical nested manifest starts a scope even when it omits `type` or cannot be
// parsed. A directory at that spelling is not a manifest, so the walk continues.
/**
 * Reads the nearest package scope for a target inside an installed package.
 *
 * @param installed - The installed package root.
 * @param target - The package-relative target.
 * @returns The manifest type, or undefined when the nearest scope omits it or cannot be read.
 */
export function readDistributionPackageType(installed: string, target: string): unknown {
	// One `dirname` per path segment reaches the root from any path. The walk ends at the
	// installed package, so no scope above it is consulted.
	const start = dirname(join(installed, target))
	const chain = start
		.split(/[\\/]/u)
		.reduce<string[]>((climbed) => [...climbed, dirname(climbed.at(-1) ?? start)], [start])
	const end = chain.indexOf(installed)
	const scope = chain
		.slice(0, end === -1 ? chain.length : end + 1)
		.find((directory) => matchesDistributionFile(join(directory, 'package.json')))
	if (scope === undefined) return undefined
	try {
		const manifest = readDistributionJSON(join(scope, 'package.json'))
		return isDistributionRecord(manifest) ? manifest.type : undefined
	} catch {
		return undefined
	}
}

/**
 * Checks whether an entry publishes a distinct or conventional browser target.
 *
 * @param entry - The exports-map entry.
 * @returns True if the entry requires a browser drive; false otherwise.
 */
export function resolvesDistributionBrowser(entry: unknown): boolean {
	const module = resolveDistributionTarget(entry, DISTRIBUTION_RUNTIME_CONDITIONS.browser)
	if (module !== undefined && module.startsWith(DISTRIBUTION_BROWSER_OUTPUT)) return true
	if (module === undefined) return false
	const imported = resolveDistributionTarget(entry, DISTRIBUTION_RUNTIME_CONDITIONS.module)
	const required = resolveDistributionTarget(entry, DISTRIBUTION_RUNTIME_CONDITIONS.commonjs)
	return module !== imported && module !== required
}

// Whether the target selected by Node's CommonJS conditions is a module require can
// load. A JavaScript target takes its own nearest package scope. Native addons and
// extensionless targets have their own CommonJS handlers.
/**
 * Checks whether Node require can load an entry selected by its conditions.
 *
 * @param entry - The exports-map entry.
 * @param installed - The installed package root.
 * @returns True if the target has a CommonJS-compatible format; false otherwise.
 */
export function resolvesDistributionCommonJS(entry: unknown, installed: string): boolean {
	const target = resolveDistributionTarget(entry, DISTRIBUTION_RUNTIME_CONDITIONS.commonjs)
	if (target === undefined) return false
	const name = target.slice(target.lastIndexOf('/') + 1)
	if (name.endsWith('.cjs')) return true
	if (name.endsWith('.mjs')) return false
	if (name.endsWith('.node')) return true
	if (!name.includes('.')) return true
	return name.endsWith('.js') && readDistributionPackageType(installed, target) !== 'module'
}

// Whether the declaration selected by a typed CommonJS consumer admits that entry.
// A `.d.cts` declaration admits and a `.d.mts` declaration refuses. A `.d.ts`
// declaration takes its own nearest package scope.
/**
 * Checks whether an entry resolves a CommonJS-compatible declaration.
 *
 * @param entry - The exports-map entry.
 * @param installed - The installed package root.
 * @returns True if the selected declaration admits CommonJS consumption; false otherwise.
 */
export function declaresDistributionCommonJS(entry: unknown, installed: string): boolean {
	const declaration = resolveDistributionDeclaration(
		entry,
		DISTRIBUTION_DECLARATION_CONDITIONS.commonjs,
		installed,
	)
	if (declaration === undefined) return false
	if (declaration.endsWith('.d.cts')) return true
	if (declaration.endsWith('.d.mts')) return false
	return (
		declaration.endsWith('.d.ts') &&
		readDistributionPackageType(installed, declaration) !== 'module'
	)
}

// Every target an entry names under any condition. A fallback list omits members
// Node rejects during package-target validation, because no reader can take them.
/**
 * Collects the targets an entry publishes under every condition.
 *
 * @param entry - The exports-map entry.
 * @returns The targets, excluding invalid members of fallback arrays.
 */
export function collectDistributionTargets(entry: unknown): readonly string[] {
	if (typeof entry === 'string') return [entry]
	if (isDistributionList(entry))
		return entry.flatMap(collectDistributionTargets).filter(matchesDistributionPackageTarget)
	if (!isDistributionRecord(entry)) return []
	return Object.values(entry).flatMap((nested) => collectDistributionTargets(nested))
}

// Whether a target is a file a runtime loads for its names, which is what a
// declaration is owed for. The extension on the target's own file name decides it,
// and a name carrying no extension is code: `require` reads such a file through its
// JavaScript handler, so an extensionless target loads and publishes names. Node
// loads `.node` through its native-addon handler. Every other extension is an asset
// a consumer reads rather than imports — a stylesheet, a WebAssembly binary, the
// `"./package.json"` manifest pointer, and a declaration alike.
// The cost is an extensionless file published for a reader, such as a `LICENSE`:
// that target reports undeclared until it is given an extension or a declaration.
/**
 * Checks whether a target names a runtime module rather than an asset.
 *
 * @param target - The package-relative target.
 * @returns True if the target has a module extension or no extension; false otherwise.
 */
export function matchesDistributionModule(target: string): boolean {
	const name = target.slice(target.lastIndexOf('/') + 1)
	const dot = name.lastIndexOf('.')
	if (name.endsWith(DISTRIBUTION_ADDON_EXTENSION)) return true
	return dot === -1 || DISTRIBUTION_MODULE_EXTENSIONS.includes(name.slice(dot))
}

// Whether a resolved target is a declaration rather than the JavaScript a
// `default` branch answers with when the entry declares no `types` condition.
/**
 * Checks whether a target names a TypeScript declaration.
 *
 * @param target - The package-relative target.
 * @returns True if the target has a declaration extension; false otherwise.
 */
export function matchesDistributionDeclaration(target: string): boolean {
	return DISTRIBUTION_DECLARATION_EXTENSIONS.some((extension) => target.endsWith(extension))
}

// The declarations the Node module, Node CommonJS, and browser drives compare
// against. Each field uses the conditions of the TypeScript consumer paired with
// that runtime. A JavaScript target resolves through TypeScript's adjacent
// declaration substitution rather than standing in for the declaration itself.
/**
 * Reads the declarations paired with Node and browser consumers.
 *
 * @param entry - The exports-map entry.
 * @param installed - The installed package root.
 * @returns The declaration selected by each consumer format.
 */
export function readDistributionDeclaration(
	entry: unknown,
	installed: string,
): {
	readonly module: string | undefined
	readonly commonjs: string | undefined
	readonly browser: string | undefined
} {
	return {
		module: resolveDistributionDeclaration(
			entry,
			DISTRIBUTION_DECLARATION_CONDITIONS.module,
			installed,
		),
		commonjs: resolveDistributionDeclaration(
			entry,
			DISTRIBUTION_DECLARATION_CONDITIONS.commonjs,
			installed,
		),
		browser: resolveDistributionDeclaration(
			entry,
			DISTRIBUTION_DECLARATION_CONDITIONS.browser,
			installed,
		),
	}
}

// The entries one compile driver can resolve under its own conditions.
/**
 * Filters entries to those a consumer can resolve.
 *
 * @param entries - The installed entries.
 * @param conditions - The active consumer conditions.
 * @returns The matching entries in their original order.
 */
export function filterDistributionEntries(
	entries: readonly DistributionEntry[],
	conditions: readonly string[],
): readonly DistributionEntry[] {
	return entries.filter(
		(entry) =>
			resolveDistributionTarget(entry.mapping, conditions) !== undefined &&
			(!conditions.includes('require') || entry.loadable),
	)
}

// The compile drivers whose conditions reach one entry under one importing format.
// A driver that resolves no target for that entry compiles nothing, so a consumer
// written under it would report a resolution failure this package never made.
/**
 * Filters compiler resolutions to those that can read an entry.
 *
 * @param entry - The installed entry.
 * @param format - The consumer module format.
 * @returns The matching compiler resolutions.
 */
export function filterDistributionResolutions(
	entry: DistributionEntry,
	format: DistributionFormat,
): readonly DistributionResolution[] {
	return DISTRIBUTION_RESOLUTIONS.filter(
		(driver) => filterDistributionEntries([entry], driver.conditions[format]).length > 0,
	)
}

// Requirable entries that declare CommonJS support but a typed CommonJS consumer
// cannot compile against. A default branch resolving under the require condition
// set makes no CommonJS claim.
/**
 * Filters entries whose require target lacks a compatible declaration.
 *
 * @param entries - The installed entries.
 * @param installed - The installed package root.
 * @returns The entries a CommonJS consumer cannot typecheck.
 */
export function filterDistributionUntypable(
	entries: readonly DistributionEntry[],
	installed: string,
): readonly DistributionEntry[] {
	return entries.filter(
		(entry) =>
			entry.requirable &&
			isDistributionRecord(entry.mapping) &&
			Object.hasOwn(entry.mapping, 'require') &&
			!declaresDistributionCommonJS(entry.mapping, installed),
	)
}

// One surface comparison, written as the consumer module that proves it: the
// installed entry that consumer imports, the file extension fixing its importing
// format, the names a real runtime published off it, and the driver whose scratch
// project compiles it.
/** Describes the runtime names and declaration resolution compared for one entry. */
export interface DistributionSurface {
	readonly entry: DistributionEntry
	readonly extension: string
	readonly published: readonly string[]
	readonly driver: DistributionResolution
}

// A scratch project over named consumer modules, written beside them so their own
// resolution reaches the installed package. Nothing is emitted and no ambient types
// are pulled in, so what the check reads is the installed declarations alone.
/**
 * Writes a compiler project for a consumer probe.
 *
 * @param stage - The installed consumer.
 * @param name - The project filename suffix.
 * @param driver - The compiler resolution.
 * @param files - The consumer source files.
 * @returns The absolute project path.
 */
export function writeDistributionProject(
	stage: DistributionStage,
	name: string,
	driver: DistributionResolution,
	files: readonly string[],
): string {
	const path = join(stage.consumer, `tsconfig.${name}.json`)
	const project = {
		compilerOptions: {
			module: driver.module,
			moduleResolution: driver.resolution,
			noEmit: true,
			skipLibCheck: true,
			strict: true,
			target: 'esnext',
			types: [],
		},
		files: [...files],
	}
	writeDistributionFile(path, `${JSON.stringify(project, undefined, '\t')}\n`)
	return path
}

// The diagnostics the compiler this workspace installs reports for one scratch
// project. The compiler runs as a command, so nothing here reaches an API that
// moves between its majors, and the located lines it prints are the verdict rather
// than the exit code, which moves between them. A line carrying no location, a line
// naming the scratch project rather than a consumer module, and anything at all on
// the error stream are faults of this proof rather than of the package under proof,
// so each is raised where it happens instead of counted against the package.
/**
 * Checks a consumer project with the installed TypeScript compiler.
 *
 * @param stage - The installed consumer.
 * @param project - The compiler project path.
 * @returns The located compiler diagnostics. Throws on a tool or project failure.
 */
export function checkDistributionProject(
	stage: DistributionStage,
	project: string,
): readonly string[] {
	const result = runDistributionNode(
		[DISTRIBUTION_COMPILER, '--noEmit', '--pretty', 'false', '-p', project],
		stage.consumer,
	)
	const refused = `${result.stderr ?? ''}`.trim()
	if (refused.length > 0) {
		throw new Error(`The consumer compiler wrote ${refused} to its error stream`)
	}
	const lines = `${result.stdout ?? ''}`.split(/\r\n|\n/u).filter((line) => line.trim().length > 0)
	// An elaborated diagnostic prints its detail on indented lines under its own
	// first line, so each of those joins the diagnostic it elaborates. The first line
	// has no diagnostic above it to join, so it opens one whatever its indentation.
	const heads = lines.flatMap((line, index) => (index === 0 || !/^\s/u.test(line) ? [index] : []))
	const reported = heads.map((head, position) => {
		const line = lines[head] ?? ''
		const located = DISTRIBUTION_DIAGNOSTIC_PATTERN.exec(line)?.[1]
		if (located === undefined) {
			throw new Error(`The consumer compiler reported ${line}, which names no location`)
		}
		if (resolve(stage.consumer, located) === project) {
			throw new Error(`The scratch project is itself at fault: ${line}`)
		}
		return [
			line,
			...lines.slice(head + 1, heads[position + 1] ?? lines.length).map((detail) => detail.trim()),
		].join(' ')
	})
	if (reported.length === 0 && result.status !== 0) {
		throw new Error(`The consumer compiler refused the project: ${readDistributionOutput(result)}`)
	}
	return reported
}

// One installed entry's published names checked against its own declarations by
// the compiler this workspace installs, in the direction each divergence surfaces
// under. The runtime's key list is written into the consumer as a literal, so the
// published side comes from a real process and the declared side from the
// declarations that process's package ships, and the two can disagree. A name the
// declarations carry and the runtime does not lands on `declared`. A name the
// runtime carries and the declarations do not, and a name the declarations publish
// as a type alone, land on `surfaced`: a variable widens into the type
// `declared` annotates, and only `surfaced` reads the literal's own keys back.
// Each names the member it is about, so the failure says which export moved.
/**
 * Checks runtime export names against their installed declarations.
 *
 * @param stage - The installed consumer.
 * @param surface - The publication and declaration pair.
 * @returns The diagnostics labelled by compiler resolution.
 */
export function checkDistributionSurface(
	stage: DistributionStage,
	surface: DistributionSurface,
): readonly string[] {
	const slug = surface.entry.subpath.replaceAll(/[^\w]+/gu, '-')
	const name = `surface.${surface.driver.label}${slug}.${surface.extension}`
	const module = `${name}`
	const keys = surface.published.map((key) => `${JSON.stringify(key)}: true`).join(', ')
	writeDistributionFile(
		join(stage.consumer, module),
		`import * as entry from ${JSON.stringify(surface.entry.specifier)}
export const published = {${keys.length === 0 ? '' : ` ${keys} `}} as const
export const declared: Record<keyof typeof entry, true> = published
export const surfaced: Record<keyof typeof published, true> = declared
`,
	)
	const project = writeDistributionProject(stage, name, surface.driver, [`./${module}`])
	return checkDistributionProject(stage, project).map((line) => `${surface.driver.label}: ${line}`)
}

// One consumer module importing every installed entry, written where its own
// resolution finds the installed package.
/**
 * Writes a consumer importing the requested public specifiers.
 *
 * @param stage - The installed consumer.
 * @param path - The consumer-relative source path.
 * @param specifiers - The public imports to resolve.
 */
export function writeDistributionConsumerProbe(
	stage: DistributionStage,
	path: string,
	specifiers: readonly string[],
): void {
	const modules = specifiers.map((specifier, index) => ({
		binding: `entry${String(index)}`,
		specifier,
	}))
	const bindings = modules.map(
		({ binding, specifier }) => `import * as ${binding} from ${JSON.stringify(specifier)}`,
	)
	const names = modules.map(({ binding }) => binding)
	const source = `${bindings.join('\n')}\nexport const surface = [${names.join(', ')}]\n`
	writeDistributionFile(join(stage.consumer, path), source)
}

// The runtime key set a real process reads off one installed entry under one
// condition. The driver is a file rather than an `--eval` string, so the specifier
// travels as an argument and nothing needs escaping.
/**
 * Reads the names a real Node process loads from an installed entry.
 *
 * @param stage - The installed consumer.
 * @param specifier - The public package specifier.
 * @param driver - The consumer driver filename.
 * @returns The exported names. Throws when loading or decoding fails.
 */
export function driveDistributionRuntime(
	stage: DistributionStage,
	specifier: string,
	driver: string,
): readonly string[] {
	const result = runDistributionNode([join(stage.consumer, driver), specifier], stage.consumer)
	if (result.status !== 0) {
		throw new Error(
			`Loading ${specifier} from the consumer failed: ${readDistributionOutput(result)}`,
		)
	}
	const published: unknown = JSON.parse(result.stdout)
	if (!isDistributionNames(published))
		throw new Error(`The driver printed no name list for ${specifier}`)
	return published
}
/** Defines the page that loads a bundled browser consumer. */
export const DISTRIBUTION_BROWSER_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>Distribution</title>
	</head>
	<body>
		<script type="module" src="./main.js"></script>
	</body>
</html>
`

/**
 * Infers the response media type from a bundle filename.
 *
 * @param path - The requested bundle path.
 * @returns The media type, defaulting to application/octet-stream.
 */
export function inferDistributionContentType(path: string): string {
	if (path.endsWith('.html')) return 'text/html'
	if (path.endsWith('.js')) return 'text/javascript'
	if (path.endsWith('.css')) return 'text/css'
	if (path.endsWith('.json') || path.endsWith('.map')) return 'application/json'
	return 'application/octet-stream'
}

// `resolveBrowser` answers with provider options and never reports absence: its
// last resort is a channel nothing verified. So the launch is attempted and its
// rejection classified, rather than probed for and ruled on.
/**
 * Renders the browser endpoint selected by provider options.
 *
 * @param options - The browser provider options.
 * @returns The endpoint, executable, channel, or bundled-browser description.
 */
export function renderDistributionBrowser(options: PlaywrightProviderOptions): string {
	const endpoint = options.connectOptions?.wsEndpoint
	if (endpoint !== undefined) return `the browser server at ${endpoint}`
	const executable = options.launchOptions?.executablePath
	if (executable !== undefined) return `the executable at ${executable}`
	const channel = options.launchOptions?.channel
	if (channel !== undefined) return `the ${channel} channel`
	return 'the Chromium Playwright installed for itself'
}

/**
 * Launches or connects to the selected Chromium browser.
 *
 * @param options - The browser provider options.
 * @returns The real browser. Rejects when the selected browser is unavailable.
 */
export async function launchDistributionBrowser(
	options: PlaywrightProviderOptions,
): Promise<Browser> {
	const endpoint = options.connectOptions?.wsEndpoint
	if (endpoint !== undefined) return chromium.connect(endpoint)
	return chromium.launch({ ...options.launchOptions, headless: true })
}

// A consumer of one installed browser entry, bundled by the Vite toolchain this
// workspace already declares. Nothing is stubbed: the bundle resolves the installed
// package and its whole transitive graph as an application consuming it would.
/**
 * Bundles a browser consumer against an installed public entry.
 *
 * @param stage - The installed consumer.
 * @param entry - The browser publication.
 * @returns The bundle directory. Rejects when Vite cannot build the consumer.
 */
export async function bundleDistributionEntry(
	stage: DistributionStage,
	entry: DistributionEntry,
): Promise<string> {
	const page = join(stage.consumer, 'pages', entry.subpath.replaceAll(/[^\w]+/gu, '-'))
	const specifier = JSON.stringify(entry.specifier)
	writeDistributionFile(join(page, 'index.html'), DISTRIBUTION_BROWSER_PAGE)
	writeDistributionFile(
		join(page, 'main.js'),
		`import * as entry from ${specifier}\nglobalThis.subject = Object.keys(entry).sort()\n`,
	)
	await build({
		base: './',
		build: { emptyOutDir: true, outDir: 'bundle' },
		configFile: false,
		logLevel: 'error',
		root: page,
	})
	return join(page, 'bundle')
}

// The key set the bundled module publishes in a real browser, read off the page
// after it has loaded over a loopback server. A module that never evaluated
// publishes nothing, and a page error is raised rather than compared away.
/**
 * Reads the names a real browser publishes from a served bundle.
 *
 * @param browser - The browser to drive.
 * @param bundle - The built consumer directory.
 * @returns The exported names. Rejects on a page error or an invalid name list.
 */
export async function readDistributionBrowserExports(
	browser: Browser,
	bundle: string,
): Promise<readonly string[]> {
	const server = createServer((request, response) => {
		const asked = request.url === undefined || request.url === '/' ? '/index.html' : request.url
		const path = join(bundle, decodeURIComponent(asked))
		if (!path.startsWith(bundle) || !existsSync(path)) {
			response.writeHead(404)
			response.end()
			return
		}
		response.writeHead(200, { 'content-type': inferDistributionContentType(path) })
		response.end(readFileSync(path))
	})
	try {
		await new Promise<void>((settle) => {
			server.listen(0, '127.0.0.1', settle)
		})
		const address = server.address()
		if (address === null || typeof address === 'string') {
			throw new Error('The bundle server bound no port')
		}
		const page = await browser.newPage()
		const failures: string[] = []
		page.on('pageerror', (error) => failures.push(String(error)))
		await page.goto(`http://127.0.0.1:${String(address.port)}/`, { waitUntil: 'load' })
		const published: unknown = await page.evaluate('globalThis.subject')
		if (failures.length > 0) throw new Error(`The bundle raised ${failures.join(' | ')}`)
		if (!isDistributionNames(published))
			throw new Error('The bundled module published no name list')
		return published
	} finally {
		server.close()
	}
}
/**
 * Checks each browser publication against its installed declarations in a real browser.
 * @param stage - The installed consumer to drive.
 * @param context - The proof context that reports unavailable browser prerequisites.
 * @returns The compiler diagnostics each browser publication reports.
 */
export async function checkDistributionBrowser(
	stage: DistributionStage,
	context: TestContext,
): Promise<readonly string[]> {
	const driver = DISTRIBUTION_BROWSER_RESOLUTION
	if (driver === undefined) throw new Error("DISTRIBUTION_RESOLUTIONS carries no 'bundler' row")
	const entries = stage.entries.filter((entry) => entry.browsable)
	if (entries.length === 0) return context.skip('No installed entry supports a browser')
	const readings: Array<readonly string[]> = []
	for (const entry of entries) {
		if (!entry.declaration.browsable) {
			throw new Error(`${entry.subpath} publishes no browser declaration`)
		}
		const options = resolveBrowser(resolvePinnedBrowser(), process.platform, process.env)
		const browser = await launchDistributionBrowser(options).catch((error: unknown) => {
			const cause = `${renderDistributionBrowser(options)} was rejected: ${String(error)}`
			if (DISTRIBUTION_RELEASE) throw new Error(`The release gate requires a browser, and ${cause}`)
			return context.skip(`No browser launched. ${cause}`)
		})
		try {
			const bundle = await bundleDistributionEntry(stage, entry)
			const published = await readDistributionBrowserExports(browser, bundle)
			// A browser consumer reads the installed declarations through a bundler, so
			// that is the one driver this face answers under.
			const reported = checkDistributionSurface(stage, {
				entry,
				extension: 'ts',
				published,
				driver,
			})
			readings.push(reported)
		} finally {
			await browser.close()
		}
	}
	return readings.flat()
}

// Pack this workspace, install the archive into an isolated consumer, and read the
// published surface back off the installed tree. Every later claim reads this
// result, so a failure here is raised where it happens rather than once per entry.
/**
 * Packs the workspace and installs its archive into an isolated consumer.
 *
 * @param scratch - The owned scratch root.
 * @returns The installed consumer and classified exports.
 * @throws Thrown when packing or installation fails.
 */
export function buildDistributionStage(scratch: string): DistributionStage {
	const packed = join(scratch, 'packed')
	const consumer = join(scratch, 'consumer')
	mkdirSync(packed, { recursive: true })
	const pack = runDistributionNpm(
		['pack', '--ignore-scripts', '--pack-destination', packed],
		DISTRIBUTION_ROOT,
		scratch,
	)
	if (pack.status !== 0)
		throw new Error(`npm pack refused this workspace: ${readDistributionOutput(pack)}`)
	const archives = readdirSync(packed).filter((name) => name.endsWith('.tgz'))
	const archive = archives[0]
	if (archives.length !== 1 || archive === undefined) {
		throw new Error(`npm pack wrote no single archive: ${archives.join(', ')}`)
	}
	const peers = readDistributionPeers(join(DISTRIBUTION_ROOT, 'package.json'))
	writeDistributionFile(join(consumer, 'package.json'), createDistributionConsumerManifest(peers))
	writeDistributionFile(join(consumer, DISTRIBUTION_ESM_DRIVER), DISTRIBUTION_ESM_DRIVER_SOURCE)
	writeDistributionFile(join(consumer, DISTRIBUTION_CJS_DRIVER), DISTRIBUTION_CJS_DRIVER_SOURCE)
	const install = runDistributionNpm(
		['install', '--ignore-scripts', '--no-audit', '--no-fund', join(packed, archive)],
		consumer,
		scratch,
	)
	if (install.status !== 0) {
		throw new Error(`Installing the packed archive failed: ${readDistributionOutput(install)}`)
	}
	const name = readDistributionManifestName(join(DISTRIBUTION_ROOT, 'package.json'))
	const installed = join(consumer, 'node_modules', ...name.split('/'))
	const manifest = readDistributionJSON(join(installed, 'package.json'))
	if (!isDistributionRecord(manifest) || !isDistributionRecord(manifest.exports)) {
		throw new Error('The installed manifest publishes no exports map')
	}
	return { consumer, installed, archives, ...classifyDistributionStage(manifest, installed, name) }
}

// One file's run: the scratch directory and the staged consumer, which is absent when the
// registry could not be reached.
/** Binds an owned scratch directory to its optional installed consumer. */
export interface DistributionRun {
	readonly scratch: string
	readonly stage: DistributionStage | undefined
}

// The run the start hook binds once for this file and the stop hook releases.
/** Owns the staged consumer shared by one distribution proof. */
export class DistributionSuite implements DistributionSuiteInterface {
	#run: DistributionRun | undefined

	get scratch(): string {
		if (this.#run === undefined) {
			throw new Error('The distribution setup has not allocated its scratch directory')
		}
		return this.#run.scratch
	}

	read(context: TestContext): DistributionStage {
		const stage = this.#run?.stage
		if (stage === undefined) {
			return context.skip('`npm ping` did not answer, so nothing was packed or installed')
		}
		return stage
	}

	start(): void {
		if (this.#run !== undefined) {
			throw new Error('The distribution setup has already allocated its scratch directory')
		}
		const scratch = mkdtempSync(join(tmpdir(), 'distribution-'))
		this.#run = { scratch, stage: openDistributionStage(scratch) }
	}

	destroy(): void {
		if (this.#run !== undefined) {
			rmSync(this.#run.scratch, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
		}
		this.#run = undefined
	}
}

// Installing the packed archive resolves its own runtime dependencies, so an
// unreachable registry leaves nothing to measure. Under release that is the gate
// failing; anywhere else the suite skips and names the mechanism it wanted.
/**
 * Opens an installed consumer after checking registry readiness.
 *
 * @param scratch - The owned scratch root.
 * @returns The installed consumer, or undefined when an ordinary run cannot reach the registry.
 * @throws Thrown in release mode or when staging fails, after removing scratch.
 */
export function openDistributionStage(scratch: string): DistributionStage | undefined {
	try {
		mkdirSync(join(scratch, 'cache'), { recursive: true })
		if (runDistributionNpm(DISTRIBUTION_PING, DISTRIBUTION_ROOT, scratch).status !== 0) {
			if (!DISTRIBUTION_RELEASE) return undefined
			throw new Error(
				'The release gate requires a reachable npm registry, and npm ping did not answer',
			)
		}
		return buildDistributionStage(scratch)
	} catch (error) {
		rmSync(scratch, {
			force: true,
			recursive: true,
			maxRetries: 3,
			retryDelay: 100,
		})
		throw error
	}
}

/**
 * Partitions an installed exports map into driven, undeclared, and excluded subpaths.
 *
 * @param manifest - The installed package manifest.
 * @param installed - The installed package root.
 * @param name - The published package name.
 * @returns The classified entries and complete target population.
 * @throws Thrown when the exports map is absent.
 */
export function classifyDistributionStage(
	manifest: Readonly<Record<string, unknown>>,
	installed: string,
	name: string,
): DistributionClassification {
	if (!isDistributionRecord(manifest.exports))
		throw new Error('The installed manifest publishes no exports map')
	const readings = Object.entries(manifest.exports).map(([subpath, mapping]) => {
		const files = collectDistributionTargets(mapping)
		const declaration = readDistributionDeclaration(mapping, installed)
		// A subpath resolving no declaration is partitioned rather than dropped. It is a
		// defect when a runtime loads one of its targets for names, because a consumer
		// importing it compiles against nothing under `node16`. It is an excluded
		// publication otherwise: the `"./package.json"` manifest pointer and a stylesheet
		// are published for a reader rather than an importer.
		if (
			declaration.module === undefined &&
			declaration.commonjs === undefined &&
			declaration.browser === undefined
		) {
			return { subpath, files, entry: undefined }
		}
		const importTarget = resolveDistributionTarget(mapping, DISTRIBUTION_RUNTIME_CONDITIONS.module)
		const requireTarget = resolveDistributionTarget(
			mapping,
			DISTRIBUTION_RUNTIME_CONDITIONS.commonjs,
		)
		const browserTarget = resolveDistributionTarget(
			mapping,
			DISTRIBUTION_RUNTIME_CONDITIONS.browser,
		)
		const browsable = resolvesDistributionBrowser(mapping)
		const shadowed = browsable && requireTarget === browserTarget
		const requirable = requireTarget !== undefined && !shadowed
		const loadable = requirable && resolvesDistributionCommonJS(mapping, installed)
		const entry: DistributionEntry = {
			subpath,
			specifier: subpath === '.' ? name : `${name}${subpath.slice(1)}`,
			mapping,
			declaration: {
				importable: declaration.module !== undefined,
				requirable: declaration.commonjs !== undefined,
				browsable: declaration.browser !== undefined,
			},
			browsable,
			importable: importTarget !== undefined && !(browsable && importTarget === browserTarget),
			requirable,
			loadable,
		}
		return { subpath, files, entry }
	})
	const entries = readings.flatMap(({ entry }) => (entry === undefined ? [] : [entry]))
	const targets = readings.flatMap(({ files }) => files)
	const subpaths = readings.map(({ subpath }) => subpath)
	const undeclared = readings
		.filter(({ entry, files }) => entry === undefined && files.some(matchesDistributionModule))
		.map(({ subpath }) => subpath)
	const excluded = readings
		.filter(({ entry, files }) => entry === undefined && !files.some(matchesDistributionModule))
		.map(({ subpath }) => subpath)
	return { entries, subpaths, undeclared, excluded, targets }
}

/**
 * Creates the lifecycle boundary used by generated distribution proofs.
 * @returns The suite interface backed by an owned run.
 */
export function createDistributionSuite(): DistributionSuiteInterface {
	return new DistributionSuite()
}

/**
 * Collects physical files beneath an installed output directory.
 * @param directory - The output directory to walk.
 * @returns The installed files, or an empty list when the directory is absent.
 */
export function collectDistributionFiles(directory: string): readonly string[] {
	if (!existsSync(directory)) return []
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name)
		return entry.isDirectory() ? collectDistributionFiles(path) : entry.isFile() ? [path] : []
	})
}

/**
 * Reads the source environment owning an installed output path.
 * @param installed - The installed package root.
 * @param path - The output file.
 * @returns The source environment, or undefined outside a JavaScript face.
 */
export function readDistributionFace(installed: string, path: string): string | undefined {
	const [output, axis, face] = relativePath(installed, path).split(sep)
	return output === 'dist'
		? axis === 'src'
			? face
			: axis === 'bin'
				? 'bin'
				: undefined
		: undefined
}

/**
 * Scans installed JavaScript maps for sources copied from another environment.
 * @param installed - The installed package root.
 * @returns The copied sources and unreadable maps.
 * @throws Thrown when a code-bearing output has no readable map of its own.
 */
export function scanDistributionSourceMaps(installed: string): readonly string[] {
	const files = collectDistributionFiles(join(installed, 'dist')).filter(
		(path) => readDistributionFace(installed, path) !== undefined,
	)
	const outputs = files
		.filter((path) => /\.(?:js|cjs|mjs)$/u.test(path))
		.map((path) => {
			const parsed = parseSync(path, readFileSync(path, 'utf8'))
			const code = parsed.program.body.some(
				(statement) =>
					statement.type !== 'EmptyStatement' &&
					!(
						statement.type === 'ExportNamedDeclaration' &&
						statement.declaration === null &&
						statement.specifiers.length === 0 &&
						statement.source === null
					),
			)
			const reference = parsed.comments
				.flatMap((comment) => {
					const match = /^[@#]\s*sourceMappingURL=(\S+)\s*$/u.exec(comment.value)
					return match?.[1] === undefined ? [] : [match[1]]
				})
				.at(-1)
			try {
				const inline = reference?.startsWith('data:') === true
				const target = inline
					? path
					: reference === undefined
						? `${path}.map`
						: fileURLToPath(new URL(reference.replaceAll('\\', '/'), pathToFileURL(path)))
				return {
					path: target,
					face: readDistributionFace(installed, path),
					code,
					reference: inline ? reference : undefined,
				}
			} catch {
				throw new Error(`Unreadable source maps for ${path}`)
			}
		})
	const maps = [
		...outputs.filter(
			({ path, code, reference }) => code || reference !== undefined || existsSync(path),
		),
		...files
			.filter(
				(path) =>
					/\.(?:js|cjs|mjs)\.map$/u.test(path) && !outputs.some((output) => output.path === path),
			)
			.map((path) => ({
				path,
				face: readDistributionFace(installed, path),
				code: false,
				reference: undefined,
			})),
	]
	if (maps.length === 0)
		console.info('No built JavaScript face holds code, so no source map is required')
	return maps.flatMap(({ path, face, code, reference }) => {
		const label = relativePath(installed, path).split(sep).join('/')
		try {
			const payload =
				reference === undefined
					? undefined
					: /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/iu.exec(reference)
			const map: unknown =
				reference === undefined
					? readDistributionJSON(path)
					: payload?.[2] === undefined
						? undefined
						: JSON.parse(
								payload[1] === undefined
									? decodeURIComponent(payload[2])
									: Buffer.from(payload[2], 'base64').toString('utf8'),
							)
			if (
				!isDistributionRecord(map) ||
				!isDistributionNames(map.sources) ||
				(map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string')
			) {
				throw new Error('Unreadable source map')
			}
			const root = typeof map.sourceRoot === 'string' ? map.sourceRoot : ''
			const directory = root.startsWith('file:')
				? fileURLToPath(new URL(root))
				: resolve(dirname(path), root.replaceAll('\\', '/'))
			const sources = map.sources.map((source) =>
				relativePath(
					resolve(installed),
					source.startsWith('file:')
						? fileURLToPath(new URL(source))
						: resolve(directory, source.replaceAll('\\', '/')),
				)
					.split(sep)
					.join('/'),
			)
			const copied = sources.filter(
				(source) => source.startsWith('src/') && !source.startsWith(`src/${face}/`),
			)
			return [
				...copied.map((source) => `${label}: ${source}`),
				...(sources.some((source) => source.startsWith(`src/${face}/`))
					? []
					: [`${label}: unreadable source map (no src/${face}/ source)`]),
			]
		} catch {
			if (code) throw new Error(`Unreadable source maps for ${path}`)
			return [`${label}: unreadable source map`]
		}
	})
}

/**
 * Reads top-level names declared by a roll-up, including unexported declarations.
 * @param path - The installed declaration file.
 * @returns The declared names. Refuses syntax errors and unreadable binding patterns.
 */
export function readDistributionNames(path: string): readonly string[] {
	const source = parseSync(path, readFileSync(path, 'utf8'))
	if (source.errors.length > 0) throw new Error(`Unreadable declarations at ${path}`)
	return source.program.body.flatMap((statement) => {
		const declaration =
			statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
				? statement.declaration
				: statement
		if (declaration === null) return []
		if (declaration.type === 'VariableDeclaration') {
			return declaration.declarations.map((binding) => {
				if (binding.id.type !== 'Identifier')
					throw new Error(`Unreadable declaration binding at ${path}`)
				return binding.id.name
			})
		}
		if (
			declaration.type === 'ClassDeclaration' ||
			declaration.type === 'FunctionDeclaration' ||
			declaration.type === 'TSDeclareFunction' ||
			declaration.type === 'TSInterfaceDeclaration' ||
			declaration.type === 'TSTypeAliasDeclaration' ||
			declaration.type === 'TSEnumDeclaration' ||
			declaration.type === 'TSModuleDeclaration'
		) {
			return declaration.id?.type === 'Identifier' ? [declaration.id.name] : []
		}
		return []
	})
}

/**
 * Checks whether a source entry exports names, following local star exports.
 * @param path - The source entry to inspect.
 * @param ancestors - The entries already visited on this export path.
 * @returns True if the entry exports a name; false otherwise.
 */
export function matchesDistributionSourceExports(
	path: string,
	ancestors: readonly string[] = [],
): boolean {
	if (ancestors.includes(path)) return false
	const source = parseSync(path, readFileSync(path, 'utf8'))
	if (source.errors.length > 0) throw new Error(`Unreadable source exports at ${path}`)
	return source.program.body.some((statement) => {
		if (statement.type === 'ExportDefaultDeclaration') return ancestors.length === 0
		if (statement.type === 'ExportNamedDeclaration')
			return (
				statement.declaration !== null ||
				statement.specifiers.some((specifier) => {
					const name =
						specifier.exported.type === 'Identifier'
							? specifier.exported.name
							: specifier.exported.value
					return ancestors.length === 0 || name !== 'default'
				})
			)
		if (statement.type !== 'ExportAllDeclaration') return false
		if (statement.exported !== null || !statement.source.value.startsWith('.')) return true
		const target = resolve(dirname(path), statement.source.value.replace(/\.js$/u, '.ts'))
		return matchesDistributionSourceExports(target, [...ancestors, path])
	})
}

/**
 * Scans installed declaration faces for names declared by multiple environments.
 * @param installed - The installed package root.
 * @param source - The workspace holding the source entries being published.
 * @returns The repeated names with their declaring faces.
 * @throws Thrown when a source entry exports names but its roll-up declares none.
 */
export function scanDistributionDeclarations(
	installed: string,
	source: string = DISTRIBUTION_ROOT,
): readonly string[] {
	const declarations = collectDistributionFiles(join(installed, 'dist'))
		.filter(matchesDistributionDeclaration)
		.map((path) => ({
			path,
			face: readDistributionFace(installed, path),
			names: readDistributionNames(path),
		}))
	const entries = collectDistributionFiles(join(source, 'src')).filter((path) => {
		const parts = relativePath(source, path).split(sep)
		return parts.length === 3 && parts[2] === 'index.ts'
	})
	const published = entries.filter((path) => matchesDistributionSourceExports(path))
	for (const path of published) {
		const face = relativePath(source, path).split(sep)[1]
		if (!declarations.some((entry) => entry.face === face && entry.names.length > 0))
			throw new Error(
				`The ${face} source entry exports names but its declaration roll-up declares none`,
			)
	}
	if (published.length === 0)
		console.info('No source entry exports names, so no declaration names are required')
	const names = [...new Set(declarations.flatMap((entry) => entry.names))].sort()
	return names.flatMap((name) => {
		const faces = [
			...new Set(
				declarations
					.filter((entry) => entry.names.includes(name))
					.map((entry) => entry.face)
					.filter((face) => face !== undefined),
			),
		].sort()
		return faces.length > 1 ? [`${name}: ${faces.join(', ')}`] : []
	})
}

/**
 * Checks the installed manifest against npm's normalization in an owned scratch copy.
 * @param installed - The installed package root, read only.
 * @param scratch - The suite's owned scratch root and npm cache parent.
 * @returns The top-level keys changed by npm. Refuses an unsuccessful npm command.
 */
export function checkDistributionManifest(installed: string, scratch: string): readonly string[] {
	const directory = mkdtempSync(join(scratch, 'manifest-'))
	try {
		const path = join(directory, 'package.json')
		writeFileSync(path, readFileSync(join(installed, 'package.json')))
		const before = readDistributionJSON(path)
		const result = runDistributionNpm(['pkg', 'fix'], directory, scratch)
		if (result.status !== 0)
			throw new Error(`npm pkg fix failed: ${readDistributionOutput(result)}`)
		const after = readDistributionJSON(path)
		if (!isDistributionRecord(before) || !isDistributionRecord(after))
			throw new Error('Unreadable manifest')
		return [...new Set([...Object.keys(before), ...Object.keys(after)])]
			.filter((key) => !isDeepStrictEqual(before[key], after[key]))
			.sort()
	} finally {
		rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
	}
}

/**
 * Builds independently registered observations over the suite's installed consumer.
 * @param suite - The lifecycle shared by the proof's hooks and observations.
 * @returns The case rows whose observations each require one assertion.
 */
export function buildDistributionCases(
	suite: DistributionSuiteInterface,
): readonly DistributionCase[] {
	return [
		{
			label: 'classifies synthetic export mappings without a registry stage',
			observe: () => {
				const root = join(suite.scratch, 'classifiers')
				writeDistributionFile(
					join(root, 'package.json'),
					JSON.stringify({
						type: 'commonjs',
						exports: {
							condition: { browser: './b.js', default: './n.js' },
							convention: { default: './dist/src/browser/index.js' },
							universal: { default: './shared.js' },
							'import-shared': {
								browser: './shared.mjs',
								import: './shared.mjs',
								default: './node.js',
							},
							'require-shared': {
								browser: './shared.cjs',
								require: './shared.cjs',
								default: './node.js',
							},
							node: { node: './node.js', default: './node.js' },
							silent: { 'module-sync': './x.cjs', import: './x.mjs' },
							module: { require: './x.mjs' },
							'nested-module': { require: './module/x.js' },
							'nested-commonjs': { require: './commonjs/x.js' },
							esm: { import: './x.mjs' },
						},
					}),
				)
				writeDistributionFile(join(root, 'module/package.json'), '{ "type": "module" }\n')
				writeDistributionFile(join(root, 'commonjs/package.json'), '{ "type": "commonjs" }\n')
				const manifest = readDistributionJSON(join(root, 'package.json'))
				if (!isDistributionRecord(manifest) || !isDistributionRecord(manifest.exports)) {
					throw new Error('The classifier fixture declares no exports map')
				}
				const mappings = manifest.exports

				return {
					actual: {
						browser: {
							condition: resolvesDistributionBrowser(mappings.condition),
							convention: resolvesDistributionBrowser(mappings.convention),
							universal: resolvesDistributionBrowser(mappings.universal),
							import: resolvesDistributionBrowser(mappings['import-shared']),
							require: resolvesDistributionBrowser(mappings['require-shared']),
							node: resolvesDistributionBrowser(mappings.node),
						},
						commonjs: {
							silent: resolvesDistributionCommonJS(mappings.silent, root),
							module: resolvesDistributionCommonJS(mappings.module, root),
							nestedModule: resolvesDistributionCommonJS(mappings['nested-module'], root),
							nestedCommonJS: resolvesDistributionCommonJS(mappings['nested-commonjs'], root),
							esm: resolvesDistributionCommonJS(mappings.esm, root),
						},
					},
					expected: {
						browser: {
							condition: true,
							convention: true,
							universal: false,
							import: false,
							require: false,
							node: false,
						},
						commonjs: {
							silent: true,
							module: false,
							nestedModule: false,
							nestedCommonJS: true,
							esm: false,
						},
					},
				}
			},
		},
		{
			label: 'keeps installed JavaScript sources in their own environment [requires the registry]',
			observe: (context) => {
				const stage = suite.read(context)
				return { actual: scanDistributionSourceMaps(stage.installed), expected: [] }
			},
		},
		{
			label: 'declares each installed name in one environment [requires the registry]',
			observe: (context) => {
				const stage = suite.read(context)
				const faces = new Set(
					collectDistributionFiles(join(stage.installed, 'dist'))
						.filter(matchesDistributionDeclaration)
						.map((path) => readDistributionFace(stage.installed, path))
						.filter((face) => face !== undefined),
				)
				const findings = scanDistributionDeclarations(stage.installed)
				if (faces.size <= 1)
					console.info(
						'Fewer than two declaration faces are installed, so no cross-face copy exists',
					)
				return { actual: findings, expected: [] }
			},
		},
		{
			label: 'keeps the installed manifest fixed under npm pkg fix [requires the registry]',
			observe: (context) => ({
				actual: checkDistributionManifest(suite.read(context).installed, suite.scratch),
				expected: [],
			}),
		},
		{
			label: 'packs one archive and installs it in isolation [requires the registry]',
			observe: (context) => {
				const stage = suite.read(context)
				return {
					actual: {
						archives: stage.archives.length,
						installed: existsSync(join(stage.installed, 'package.json')),
						entries: stage.entries.length > 0,
					},
					expected: { archives: 1, installed: true, entries: true },
				}
			},
		},
		{
			label: 'ships every relative target its exports map names [requires the registry]',
			observe: (context) => {
				const stage = suite.read(context)
				const relative = stage.targets.filter((target) => target.startsWith('./'))
				return {
					actual: {
						populated: relative.length > 0,
						missing: relative.filter((target) => !existsSync(join(stage.installed, target))),
					},
					expected: { populated: true, missing: [] },
				}
			},
		},
		{
			label: 'declares types for every module it publishes [requires the registry]',
			observe: (context) => {
				const stage = suite.read(context)
				const partitioned = [
					...stage.entries.map((entry) => entry.subpath),
					...stage.undeclared,
					...stage.excluded,
				]
				return {
					actual: {
						undeclared: stage.undeclared,
						partitioned: partitioned.sort(),
						unreachable: stage.entries
							.filter((entry) => !entry.importable && !entry.requirable && !entry.browsable)
							.map((entry) => entry.subpath),
						untypable: filterDistributionUntypable(stage.entries, stage.installed).map(
							(entry) => entry.subpath,
						),
					},
					expected: {
						undeclared: [],
						partitioned: [...stage.subpaths].sort(),
						unreachable: [],
						untypable: [],
					},
				}
			},
		},
		{
			label: 'refuses a subpath its exports map does not name [requires the registry]',
			observe: (context) => {
				const stage = suite.read(context)
				const name = readDistributionManifestName(join(stage.installed, 'package.json'))
				const result = runDistributionNode(
					[join(stage.consumer, DISTRIBUTION_ESM_DRIVER), `${name}${DISTRIBUTION_ABSENT_SUBPATH}`],
					stage.consumer,
				)
				return {
					actual: {
						refused: result.status !== 0,
						coded: readDistributionOutput(result).includes('ERR_PACKAGE_PATH_NOT_EXPORTED'),
					},
					expected: { refused: true, coded: true },
				}
			},
		},
		{
			label: 'compiles a consumer under every module resolution [requires the registry]',
			observe: (context) => {
				const stage = suite.read(context)
				const name = readDistributionManifestName(join(stage.installed, 'package.json'))
				const readings = DISTRIBUTION_RESOLUTIONS.flatMap((driver) =>
					DISTRIBUTION_FORMATS.flatMap(([extension, format]) => {
						const written = filterDistributionEntries(stage.entries, driver.conditions[format])
						if (written.length === 0) return []
						const label = `${driver.label}.${extension}`
						const probe = `probe.${label}`
						const specifiers = written.map((entry) => entry.specifier)
						writeDistributionConsumerProbe(stage, probe, specifiers)
						const project = writeDistributionProject(stage, probe, driver, [`./${probe}`])
						const messages = checkDistributionProject(stage, project).map(
							(message) => `${label}: ${message}`,
						)
						const control = `control.${label}`
						writeDistributionConsumerProbe(stage, control, [
							`${name}${DISTRIBUTION_ABSENT_SUBPATH}`,
						])
						const refused = writeDistributionProject(stage, control, driver, [`./${control}`])
						return [
							{
								messages,
								silent: checkDistributionProject(stage, refused).length === 0 ? [label] : [],
							},
						]
					}),
				)
				return {
					actual: {
						messages: readings.flatMap(({ messages }) => messages),
						silent: readings.flatMap(({ silent }) => silent),
					},
					expected: { messages: [], silent: [] },
				}
			},
		},
		{
			label: 'publishes what it declares to a Node import, and no more',
			observe: (context) => {
				const stage = suite.read(context)
				const entries = stage.entries.filter((entry) => entry.importable)
				if (entries.length === 0) return context.skip('No installed entry supports Node import')
				const readings = entries.map((entry) => {
					if (!entry.declaration.importable)
						throw new Error(`${entry.subpath} publishes no import declaration`)
					const published = driveDistributionRuntime(
						stage,
						entry.specifier,
						DISTRIBUTION_ESM_DRIVER,
					)
					const drivers = filterDistributionResolutions(entry, 'module')
					return {
						entry: entry.subpath,
						driven: drivers.length > 0,
						reported: drivers.flatMap((driver) =>
							checkDistributionSurface(stage, { entry, extension: 'ts', published, driver }),
						),
					}
				})
				return {
					actual: readings,
					expected: entries.map((entry) => ({ entry: entry.subpath, driven: true, reported: [] })),
				}
			},
		},
		{
			label: 'publishes what it declares to a Node require, and no more',
			observe: (context) => {
				const stage = suite.read(context)
				const entries = stage.entries.filter((entry) => entry.requirable)
				if (entries.length === 0) return context.skip('No installed entry supports Node require')
				const readings = entries.map((entry) => {
					if (!entry.declaration.requirable)
						throw new Error(`${entry.subpath} publishes no require declaration`)
					const published = driveDistributionRuntime(
						stage,
						entry.specifier,
						DISTRIBUTION_CJS_DRIVER,
					)
					const drivers = filterDistributionResolutions(entry, 'commonjs')
					return {
						entry: entry.subpath,
						driven: drivers.length > 0,
						reported: drivers.flatMap((driver) =>
							checkDistributionSurface(stage, { entry, extension: 'cts', published, driver }),
						),
					}
				})
				return {
					actual: readings,
					expected: entries.map((entry) => ({ entry: entry.subpath, driven: true, reported: [] })),
				}
			},
		},
	]
}
