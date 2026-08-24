// The artifact a consumer installs, measured rather than described. This workspace
// is packed and installed into a throwaway consumer, and every following claim is read
// off that installed tree: the exports map it publishes, the declarations it ships,
// and the module objects a real runtime hands a consumer. Nothing here names this
// package, one of its exports, or how many there are, so the proof stays true as
// the published surface moves.
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
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { build } from 'vite'
import { resolveBrowser, resolvePinnedBrowser } from '../configs/browsers.js'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// Windows needs a shell to launch a `.cmd`: Node refuses one directly since the
// batch-argument hardening, and `spawnSync` returns `EINVAL` with a null status
// rather than an exit code a caller can read. Every following argument is a literal or
// a path this file built, so the shell has nothing to escape.
const SHELL = process.platform === 'win32'
// `prepublishOnly` runs this proof as `npm run test:distribution -- --mode release`.
// Release is the publish gate, so evidence it cannot obtain fails there and skips
// everywhere else: a gate that passes on missing evidence proves nothing.
const RELEASE = import.meta.env.MODE === 'release'
// The built output directory convention a browser face may publish from. Every
// selection reads this prefix off the export target and never off the subpath name. A
// workspace whose only published face is the browser one publishes that face at the
// root subpath, so a rule keyed on the subpath name drives a browser bundle through
// Node and the miss is silent.
const BROWSER_OUTPUT = './dist/src/browser/'
const ABSENT_SUBPATH = '/no-subpath-is-published-under-this-name'
const PING = ['ping', '--fetch-retries=0', '--fetch-timeout=5000', '--loglevel=silent']
const ESM_DRIVER = 'drive.mjs'
const CJS_DRIVER = 'drive.cjs'
const CONSUMER_MANIFEST = `{ "name": "distribution-consumer", "private": true, "type": "module" }\n`
const ESM_DRIVER_SOURCE = `const entry = await import(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`
const CJS_DRIVER_SOURCE = `const entry = require(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(entry).sort()))
`

// The extensions a JavaScript handler loads as modules. Node loads a native addon
// through its addon handler instead, so that extension is named separately.
const MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs']
const ADDON_EXTENSION = '.node'
// The extensions a declaration file carries. A `require` condition declares
// `.d.cts` and an ESM-only one `.d.mts`, so the `.d.ts` spelling alone does not
// name them.
const DECLARATION_EXTENSIONS = ['.d.ts', '.d.cts', '.d.mts']
type Format = 'module' | 'commonjs'

// The Node import target is resolved with the conditions that driver supplies. The
// CommonJS compile probe is selected from its declaration's format, and its runtime
// drive loads the same subpath through Node's require resolver. Vite's production
// client build enables its module and browser conditions.
const RUNTIME_CONDITIONS = Object.freeze({
	module: Object.freeze(['node-addons', 'node', 'import', 'module-sync']),
	commonjs: Object.freeze(['node-addons', 'node', 'require', 'module-sync']),
	browser: Object.freeze(['module', 'browser', 'production', 'import']),
})
// TypeScript's Node resolutions add `node` to the format condition. Its bundler
// resolution does not, so a browser drive compares against the declaration a bundler
// consumer reads rather than borrowing the Node declaration.
const BUNDLER_CONDITIONS = Object.freeze({
	module: ['types', 'import'],
	commonjs: ['types', 'require'],
})
const DECLARATION_CONDITIONS = Object.freeze({
	module: ['types', 'node', 'import'],
	commonjs: ['types', 'node', 'require'],
	browser: BUNDLER_CONDITIONS.module,
})

interface Resolution {
	readonly label: string
	readonly resolution: ts.ModuleResolutionKind
	readonly module: ts.ModuleKind
	readonly conditions: Readonly<Record<Format, readonly string[]>>
}

interface TargetResolution {
	readonly target: string
}

// Each compile driver carries the conditions TypeScript applies for its resolution
// and importing format. A `require`-only subpath therefore stays in each CommonJS
// probe that can resolve it.
const RESOLUTIONS: readonly Resolution[] = [
	{
		label: 'node16',
		resolution: ts.ModuleResolutionKind.Node16,
		module: ts.ModuleKind.Node16,
		conditions: DECLARATION_CONDITIONS,
	},
	{
		label: 'nodenext',
		resolution: ts.ModuleResolutionKind.NodeNext,
		module: ts.ModuleKind.NodeNext,
		conditions: DECLARATION_CONDITIONS,
	},
	{
		label: 'bundler',
		resolution: ts.ModuleResolutionKind.Bundler,
		module: ts.ModuleKind.ESNext,
		conditions: BUNDLER_CONDITIONS,
	},
]

const FORMATS: ReadonlyArray<readonly [extension: string, format: Format]> = [
	['ts', 'module'],
	['cts', 'commonjs'],
]

// One published subpath, resolved to what this proof can drive: the specifier a
// consumer writes, the declarations its consumer formats name, whether its target
// is a browser bundle, and whether it answers `import` and `require` at all.
interface Entry {
	readonly subpath: string
	readonly specifier: string
	readonly mapping: unknown
	readonly declaration: {
		readonly module: string | undefined
		readonly commonjs: string | undefined
		readonly browser: string | undefined
	}
	readonly browser: boolean
	readonly module: boolean
	readonly commonjs: boolean
	readonly required: boolean
}

// The installed tree every claim is read from. Every subpath the exports map names
// lands in exactly one of `entries`, `undeclared`, and `excluded`, so a subpath this
// proof cannot drive is reported rather than dropped.
interface Stage {
	readonly consumer: string
	readonly installed: string
	readonly archives: readonly string[]
	readonly entries: readonly Entry[]
	readonly subpaths: readonly string[]
	readonly undeclared: readonly string[]
	readonly excluded: readonly string[]
	readonly targets: readonly string[]
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNames(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((name) => typeof name === 'string')
}

// A fallback list, which is what Node reads an array in an exports entry as. The
// narrowing is what the following walkers need: `Array.isArray` widens an `unknown`
// member to `any`, and an entry read that way is not read at all.
function isList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value)
}

// Whether a string is a valid package target. Node rejects a target outside the
// package and a target containing a dot, parent, or node_modules segment during
// package-target resolution. A later module-resolution failure is not the same
// thing: an array falls through the former and keeps the latter.
function isPackageTarget(target: string): boolean {
	if (!target.startsWith('./')) return false
	for (const segment of target.slice(2).split(/[\\/]/u)) {
		let decoded = segment
		try {
			decoded = decodeURIComponent(segment)
		} catch {}
		const normalized = decoded.toLowerCase()
		if (normalized === '.' || normalized === '..' || normalized === 'node_modules') return false
	}
	return true
}

function readJson(path: string): unknown {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
	return parsed
}

function readManifestName(path: string): string {
	const manifest = readJson(path)
	if (!isRecord(manifest) || typeof manifest.name !== 'string') {
		throw new Error(`The manifest at ${path} declares no package name`)
	}
	return manifest.name
}

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content)
}

function readOutput(result: SpawnSyncReturns<string>): string {
	return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

function runNpm(args: readonly string[], cwd: string): SpawnSyncReturns<string> {
	return spawnSync(NPM, [...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, npm_config_cache: CACHE },
		shell: SHELL,
		windowsHide: true,
	})
}

function runNode(args: readonly string[], cwd: string): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [...args], { cwd, encoding: 'utf8', windowsHide: true })
}

// Node's own condition matching, read in declaration order.
function resolvePackageTarget(
	entry: unknown,
	conditions: readonly string[],
): TargetResolution | undefined {
	if (typeof entry === 'string') return { target: entry }
	if (isList(entry)) {
		for (const member of entry) {
			const resolved = resolvePackageTarget(member, conditions)
			if (resolved !== undefined && isPackageTarget(resolved.target)) return resolved
		}
		return undefined
	}
	if (!isRecord(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolvePackageTarget(nested, conditions)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// A flat entry, a condition-nested entry, and a fallback list all resolve through
// one walker. An entry may declare `types` beside `default` at its top level
// rather than inside `import`, so a fixed `entry.import.types` lookup is not
// equivalent to condition resolution.
function resolveTarget(entry: unknown, conditions: readonly string[]): string | undefined {
	return resolvePackageTarget(entry, conditions)?.target
}

// Whether a path is a physical file. TypeScript's file-existence check refuses a
// directory at the same spelling and continues to the outer package scope.
function matchesFile(path: string): boolean {
	try {
		return statSync(path).isFile()
	} catch {
		return false
	}
}

// TypeScript resolves a declaration target by accepting an existing declaration
// directly or by substituting beside a JavaScript target. A missing target leaves
// the containing condition or fallback list unresolved, so the walk continues.
function targetToDeclaration(target: string, installed: string): string | undefined {
	if (!isPackageTarget(target)) return undefined
	let declaration = target
	if (target.endsWith('.cjs')) declaration = `${target.slice(0, -4)}.d.cts`
	else if (target.endsWith('.mjs')) declaration = `${target.slice(0, -4)}.d.mts`
	else if (target.endsWith('.js')) declaration = `${target.slice(0, -3)}.d.ts`
	else if (!isDeclaration(target)) return undefined
	return matchesFile(join(installed, declaration)) ? declaration : undefined
}

// The declaration TypeScript resolves through one importing format's conditions.
// Condition objects keep manifest order, and arrays keep fallback order.
function resolveDeclaration(
	entry: unknown,
	conditions: readonly string[],
	installed: string,
): string | undefined {
	if (typeof entry === 'string') return targetToDeclaration(entry, installed)
	if (isList(entry)) {
		for (const member of entry) {
			const resolved = resolveDeclaration(member, conditions, installed)
			if (resolved !== undefined) return resolved
		}
		return undefined
	}
	if (!isRecord(entry)) return undefined
	for (const [condition, nested] of Object.entries(entry)) {
		if (condition !== 'default' && !conditions.includes(condition)) continue
		const resolved = resolveDeclaration(nested, conditions, installed)
		if (resolved !== undefined) return resolved
	}
	return undefined
}

// The nearest package scope that decides a `.d.ts` declaration's module format. A
// physical nested manifest starts a scope even when it omits `type` or cannot be
// parsed. A directory at that spelling is not a manifest, so the walk continues.
function readPackageType(installed: string, target: string): unknown {
	let directory = dirname(join(installed, target))
	while (true) {
		const path = join(directory, 'package.json')
		if (matchesFile(path)) {
			try {
				const manifest = readJson(path)
				return isRecord(manifest) ? manifest.type : undefined
			} catch {
				return undefined
			}
		}
		if (directory === installed) return undefined
		const parent = dirname(directory)
		if (parent === directory) return undefined
		directory = parent
	}
}

function resolvesBrowser(entry: unknown): boolean {
	const module = resolveTarget(entry, RUNTIME_CONDITIONS.browser)
	if (module !== undefined && module.startsWith(BROWSER_OUTPUT)) return true
	if (module === undefined) return false
	const imported = resolveTarget(entry, RUNTIME_CONDITIONS.module)
	const required = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
	return module !== imported && module !== required
}

// Whether the target selected by Node's CommonJS conditions is a module require can
// load. A JavaScript target takes its own nearest package scope. Native addons and
// extensionless targets have their own CommonJS handlers.
function resolvesCommonJS(entry: unknown, installed: string): boolean {
	const target = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
	if (target === undefined) return false
	const name = target.slice(target.lastIndexOf('/') + 1)
	if (name.endsWith('.cjs')) return true
	if (name.endsWith('.mjs')) return false
	if (name.endsWith('.node')) return true
	if (!name.includes('.')) return true
	return name.endsWith('.js') && readPackageType(installed, target) !== 'module'
}

// Whether the declaration selected by a typed CommonJS consumer admits that entry.
// A `.d.cts` declaration admits and a `.d.mts` declaration refuses. A `.d.ts`
// declaration takes its own nearest package scope.
function declaresCommonJS(entry: unknown, installed: string): boolean {
	const declaration = resolveDeclaration(entry, DECLARATION_CONDITIONS.commonjs, installed)
	if (declaration === undefined) return false
	if (declaration.endsWith('.d.cts')) return true
	if (declaration.endsWith('.d.mts')) return false
	return declaration.endsWith('.d.ts') && readPackageType(installed, declaration) !== 'module'
}

// Every target an entry names under any condition. A fallback list omits members
// Node rejects during package-target validation, because no reader can take them.
function collectTargets(entry: unknown): readonly string[] {
	if (typeof entry === 'string') return [entry]
	if (isList(entry)) return entry.flatMap(collectTargets).filter(isPackageTarget)
	if (!isRecord(entry)) return []
	return Object.values(entry).flatMap((nested) => collectTargets(nested))
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
function isModule(target: string): boolean {
	const name = target.slice(target.lastIndexOf('/') + 1)
	const dot = name.lastIndexOf('.')
	if (name.endsWith(ADDON_EXTENSION)) return true
	return dot === -1 || MODULE_EXTENSIONS.includes(name.slice(dot))
}

// Whether a resolved target is a declaration rather than the JavaScript a
// `default` branch answers with when the entry declares no `types` condition.
function isDeclaration(target: string): boolean {
	return DECLARATION_EXTENSIONS.some((extension) => target.endsWith(extension))
}

// The declarations the Node module, Node CommonJS, and browser drives compare
// against. Each field uses the conditions of the TypeScript consumer paired with
// that runtime. A JavaScript target resolves through TypeScript's adjacent
// declaration substitution rather than standing in for the declaration itself.
function readDeclaration(entry: unknown, installed: string): Entry['declaration'] {
	return {
		module: resolveDeclaration(entry, DECLARATION_CONDITIONS.module, installed),
		commonjs: resolveDeclaration(entry, DECLARATION_CONDITIONS.commonjs, installed),
		browser: resolveDeclaration(entry, DECLARATION_CONDITIONS.browser, installed),
	}
}

// The entries one compile driver can resolve under its own conditions.
function selectEntries(entries: readonly Entry[], conditions: readonly string[]): readonly Entry[] {
	return entries.filter(
		(entry) =>
			resolveTarget(entry.mapping, conditions) !== undefined &&
			(!conditions.includes('require') || entry.commonjs),
	)
}

// Require-loadable entries that declare CommonJS support but a typed CommonJS
// consumer cannot compile against. A default branch resolving under the require
// condition set makes no CommonJS claim.
function selectUntypable(entries: readonly Entry[], installed: string): readonly Entry[] {
	return entries.filter(
		(entry) =>
			entry.required &&
			isRecord(entry.mapping) &&
			Object.hasOwn(entry.mapping, 'require') &&
			!declaresCommonJS(entry.mapping, installed),
	)
}

// The value exports a declaration publishes, read through the compiler's checker
// over the module symbol rather than off the declaration text. An alias resolves to
// what it names, so a re-export counts as the thing it re-exports, and a type-only
// symbol is dropped because no runtime publishes one.
function readDeclaredExports(declaration: string): readonly string[] {
	const program = ts.createProgram([declaration], {
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ESNext,
	})
	const source = program.getSourceFile(declaration)
	if (source === undefined) throw new Error(`The declaration ${declaration} was not read`)
	const checker = program.getTypeChecker()
	const symbol = checker.getSymbolAtLocation(source)
	if (symbol === undefined) throw new Error(`${declaration} declares no module symbol`)
	const values: string[] = []
	for (const exported of checker.getExportsOfModule(symbol)) {
		const direct = (exported.flags & ts.SymbolFlags.Alias) === 0
		const resolved = direct ? exported : checker.getAliasedSymbol(exported)
		if ((resolved.flags & ts.SymbolFlags.Value) !== 0) values.push(exported.getName())
	}
	return [...values].sort()
}

// The diagnostics a consumer compiling against the installed declarations reports,
// flattened to their messages so a failure names what the consumer could not do.
function compileConsumer(
	entry: string,
	resolution: ts.ModuleResolutionKind,
	module: ts.ModuleKind,
): readonly string[] {
	const program = ts.createProgram([entry], {
		module,
		moduleResolution: resolution,
		noEmit: true,
		skipLibCheck: true,
		strict: true,
		target: ts.ScriptTarget.ESNext,
	})
	return ts
		.getPreEmitDiagnostics(program)
		.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
}

// One consumer module importing every installed entry, written where its own
// resolution finds the installed package.
function writeConsumerProbe(stage: Stage, path: string, specifiers: readonly string[]): string {
	const names: string[] = []
	const bindings: string[] = []
	for (const [index, specifier] of specifiers.entries()) {
		const binding = `entry${String(index)}`
		names.push(binding)
		bindings.push(`import * as ${binding} from ${JSON.stringify(specifier)}`)
	}
	const target = join(stage.consumer, path)
	writeFile(target, `${bindings.join('\n')}\nexport const surface = [${names.join(', ')}]\n`)
	return target
}

// The runtime key set a real process reads off one installed entry under one
// condition. The driver is a file rather than an `--eval` string, so the specifier
// travels as an argument and nothing needs escaping.
function driveRuntime(stage: Stage, specifier: string, driver: string): readonly string[] {
	const result = runNode([join(stage.consumer, driver), specifier], stage.consumer)
	if (result.status !== 0) {
		throw new Error(`Loading ${specifier} from the consumer failed: ${readOutput(result)}`)
	}
	const published: unknown = JSON.parse(result.stdout)
	if (!isNames(published)) throw new Error(`The driver printed no name list for ${specifier}`)
	return published
}

const BROWSER_PAGE = `<!doctype html>
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

function readContentType(path: string): string {
	if (path.endsWith('.html')) return 'text/html'
	if (path.endsWith('.js')) return 'text/javascript'
	if (path.endsWith('.css')) return 'text/css'
	if (path.endsWith('.json') || path.endsWith('.map')) return 'application/json'
	return 'application/octet-stream'
}

// `resolveBrowser` answers with provider options and never reports absence: its
// last resort is a channel nothing verified. So the launch is attempted and its
// rejection classified, rather than probed for and ruled on.
function describeBrowser(options: PlaywrightProviderOptions): string {
	const endpoint = options.connectOptions?.wsEndpoint
	if (endpoint !== undefined) return `the browser server at ${endpoint}`
	const executable = options.launchOptions?.executablePath
	if (executable !== undefined) return `the executable at ${executable}`
	const channel = options.launchOptions?.channel
	if (channel !== undefined) return `the ${channel} channel`
	return 'the Chromium Playwright installed for itself'
}

async function launchBrowser(options: PlaywrightProviderOptions): Promise<Browser> {
	const endpoint = options.connectOptions?.wsEndpoint
	if (endpoint !== undefined) return chromium.connect(endpoint)
	return chromium.launch({ ...options.launchOptions, headless: true })
}

// A consumer of one installed browser entry, bundled by the Vite toolchain this
// workspace already declares. Nothing is stubbed: the bundle resolves the installed
// package and its whole transitive graph as an application consuming it would.
async function bundleEntry(stage: Stage, entry: Entry): Promise<string> {
	const page = join(stage.consumer, 'pages', entry.subpath.replaceAll(/[^\w]+/gu, '-'))
	const specifier = JSON.stringify(entry.specifier)
	writeFile(join(page, 'index.html'), BROWSER_PAGE)
	writeFile(
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
// once it has loaded over a loopback server. A module that never evaluated
// publishes nothing, and a page error is raised rather than compared away.
async function readBrowserExports(browser: Browser, bundle: string): Promise<readonly string[]> {
	const server = createServer((request, response) => {
		const asked = request.url === undefined || request.url === '/' ? '/index.html' : request.url
		const path = join(bundle, decodeURIComponent(asked))
		if (!path.startsWith(bundle) || !existsSync(path)) {
			response.writeHead(404)
			response.end()
			return
		}
		response.writeHead(200, { 'content-type': readContentType(path) })
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
		if (!isNames(published)) throw new Error('The bundled module published no name list')
		return published
	} finally {
		server.close()
	}
}

// Pack this workspace, install the archive into an isolated consumer, and read the
// published surface back off the installed tree. Every later claim reads this
// result, so a failure here is raised where it happens rather than once per entry.
function buildStage(): Stage {
	const packed = join(SCRATCH, 'packed')
	const consumer = join(SCRATCH, 'consumer')
	mkdirSync(packed, { recursive: true })
	const pack = runNpm(['pack', '--ignore-scripts', '--pack-destination', packed], ROOT)
	if (pack.status !== 0) throw new Error(`npm pack refused this workspace: ${readOutput(pack)}`)
	const archives = readdirSync(packed).filter((name) => name.endsWith('.tgz'))
	const archive = archives[0]
	if (archives.length !== 1 || archive === undefined) {
		throw new Error(`npm pack wrote no single archive: ${archives.join(', ')}`)
	}
	writeFile(join(consumer, 'package.json'), CONSUMER_MANIFEST)
	writeFile(join(consumer, ESM_DRIVER), ESM_DRIVER_SOURCE)
	writeFile(join(consumer, CJS_DRIVER), CJS_DRIVER_SOURCE)
	const install = runNpm(
		['install', '--ignore-scripts', '--no-audit', '--no-fund', join(packed, archive)],
		consumer,
	)
	if (install.status !== 0) {
		throw new Error(`Installing the packed archive failed: ${readOutput(install)}`)
	}
	const name = readManifestName(join(ROOT, 'package.json'))
	const installed = join(consumer, 'node_modules', ...name.split('/'))
	const manifest = readJson(join(installed, 'package.json'))
	if (!isRecord(manifest) || !isRecord(manifest.exports)) {
		throw new Error('The installed manifest publishes no exports map')
	}
	const entries: Entry[] = []
	const targets: string[] = []
	const subpaths: string[] = []
	const undeclared: string[] = []
	const excluded: string[] = []
	for (const [subpath, entry] of Object.entries(manifest.exports)) {
		const files = collectTargets(entry)
		targets.push(...files)
		subpaths.push(subpath)
		const declaration = readDeclaration(entry, installed)
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
			if (files.some(isModule)) undeclared.push(subpath)
			else excluded.push(subpath)
			continue
		}
		const imported = resolveTarget(entry, RUNTIME_CONDITIONS.module)
		const requiredTarget = resolveTarget(entry, RUNTIME_CONDITIONS.commonjs)
		const browserTarget = resolveTarget(entry, RUNTIME_CONDITIONS.browser)
		const browser = resolvesBrowser(entry)
		const required = requiredTarget !== undefined && !(browser && requiredTarget === browserTarget)
		const commonjs = required && resolvesCommonJS(entry, installed)
		entries.push({
			subpath,
			specifier: subpath === '.' ? name : `${name}${subpath.slice(1)}`,
			mapping: entry,
			declaration: {
				module: declaration.module === undefined ? undefined : join(installed, declaration.module),
				commonjs:
					declaration.commonjs === undefined ? undefined : join(installed, declaration.commonjs),
				browser:
					declaration.browser === undefined ? undefined : join(installed, declaration.browser),
			},
			browser,
			module: imported !== undefined && !(browser && imported === browserTarget),
			commonjs,
			required,
		})
	}
	return { consumer, installed, archives, entries, subpaths, undeclared, excluded, targets }
}

const SCRATCH = mkdtempSync(join(tmpdir(), 'distribution-'))
const CACHE = join(SCRATCH, 'cache')
mkdirSync(CACHE, { recursive: true })
// The scratch tree holds the npm cache, the packed archive, and the installed
// consumer, so its removal is registered before the first thing that can throw.
afterAll(() => {
	rmSync(SCRATCH, { force: true, recursive: true })
})

// Installing the packed archive resolves its own runtime dependencies, so an
// unreachable registry leaves nothing to measure. Under release that is the gate
// failing; anywhere else the suite skips and names the mechanism it wanted.
//
// A module that throws while loading never reaches the `afterAll` it registered,
// so every throw here removes the scratch tree on its way out.
function openStage(): Stage | undefined {
	try {
		if (runNpm(PING, ROOT).status !== 0) {
			if (!RELEASE) return undefined
			throw new Error(
				'The release gate requires a reachable npm registry, and npm ping did not answer',
			)
		}
		return buildStage()
	} catch (error) {
		rmSync(SCRATCH, { force: true, recursive: true })
		throw error
	}
}

const STAGE = openStage()
const STAGED = STAGE !== undefined

describe('distribution classifiers', () => {
	it('classifies synthetic export mappings without a registry stage', () => {
		const root = join(SCRATCH, 'classifiers')
		writeFile(
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
		writeFile(join(root, 'module/package.json'), '{ "type": "module" }\n')
		writeFile(join(root, 'commonjs/package.json'), '{ "type": "commonjs" }\n')
		const manifest = readJson(join(root, 'package.json'))
		if (!isRecord(manifest) || !isRecord(manifest.exports)) {
			throw new Error('The classifier fixture declares no exports map')
		}
		const mappings = manifest.exports
		expect({
			condition: resolvesBrowser(mappings.condition),
			convention: resolvesBrowser(mappings.convention),
			universal: resolvesBrowser(mappings.universal),
			import: resolvesBrowser(mappings['import-shared']),
			require: resolvesBrowser(mappings['require-shared']),
			node: resolvesBrowser(mappings.node),
		}).toStrictEqual({
			condition: true,
			convention: true,
			universal: false,
			import: false,
			require: false,
			node: false,
		})
		expect({
			silent: resolvesCommonJS(mappings.silent, root),
			module: resolvesCommonJS(mappings.module, root),
			nestedModule: resolvesCommonJS(mappings['nested-module'], root),
			nestedCommonJS: resolvesCommonJS(mappings['nested-commonjs'], root),
			esm: resolvesCommonJS(mappings.esm, root),
		}).toStrictEqual({
			silent: true,
			module: false,
			nestedModule: false,
			nestedCommonJS: true,
			esm: false,
		})
	})
})

// The staged consumer, or a skip naming what the run could not reach. `it.skipIf`
// carries no reason, so the gate sits here where the test context can state one.
function requireStage(context: TestContext): Stage {
	if (!STAGED) {
		return context.skip('`npm ping` did not answer, so nothing was packed or installed')
	}
	return STAGE
}

describe('installed package consumer', () => {
	it('packs one archive and installs it in isolation [requires the registry]', (context) => {
		const stage = requireStage(context)
		expect(stage.archives).toHaveLength(1)
		expect(existsSync(join(stage.installed, 'package.json'))).toBe(true)
		expect(stage.entries.length).toBeGreaterThan(0)
	})

	it('ships every relative target its exports map names [requires the registry]', (context) => {
		const stage = requireStage(context)
		const relative = stage.targets.filter((target) => target.startsWith('./'))
		expect(relative).not.toStrictEqual([])
		expect(relative.filter((target) => !existsSync(join(stage.installed, target)))).toStrictEqual(
			[],
		)
	})

	// Every published subpath is driven, excluded by name, or reported here. A dropped
	// one leaves no trace: no runtime test, no declaration comparison, and no place in
	// the resolution compile, so the run reports success for a subpath it never
	// measured.
	it('declares types for every module it publishes [requires the registry]', (context) => {
		const stage = requireStage(context)
		const partitioned = [
			...stage.entries.map((entry) => entry.subpath),
			...stage.undeclared,
			...stage.excluded,
		]
		expect(stage.undeclared).toStrictEqual([])
		expect(partitioned.sort()).toStrictEqual([...stage.subpaths].sort())
		// A driven subpath answers a runtime condition. One resolving a declaration and
		// no Node or browser target compiles for a consumer and throws when that consumer
		// loads it. Each later drive retires itself for that entry, so this assertion names
		// the subpath rather than counting it as driven.
		const unreachable = stage.entries.filter(
			(entry) => !entry.module && !entry.required && !entry.browser,
		)
		expect(unreachable.map((entry) => entry.subpath)).toStrictEqual([])
		const untypable = selectUntypable(stage.entries, stage.installed)
		expect(untypable.map((entry) => entry.subpath)).toStrictEqual([])
	})

	it('refuses a subpath its exports map does not name [requires the registry]', (context) => {
		const stage = requireStage(context)
		const name = readManifestName(join(stage.installed, 'package.json'))
		const driver = join(stage.consumer, ESM_DRIVER)
		const result = runNode([driver, `${name}${ABSENT_SUBPATH}`], stage.consumer)
		expect(result.status).not.toBe(0)
		expect(readOutput(result)).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
	})

	// The absent subpath is the firing control: a resolution that reports nothing
	// for every published entry has not been shown to resolve anything at all. Each
	// module format carries its own control, because a format that resolves nothing
	// is silent for the same reason a resolution that resolves nothing is.
	it('compiles a consumer under every module resolution [requires the registry]', (context) => {
		const stage = requireStage(context)
		const name = readManifestName(join(stage.installed, 'package.json'))
		const reported: string[] = []
		const silent: string[] = []
		for (const driver of RESOLUTIONS) {
			for (const [extension, format] of FORMATS) {
				const written = selectEntries(stage.entries, driver.conditions[format])
				if (written.length === 0) continue
				const specifiers = written.map((entry) => entry.specifier)
				const probe = writeConsumerProbe(stage, `probe.${driver.label}.${extension}`, specifiers)
				for (const message of compileConsumer(probe, driver.resolution, driver.module)) {
					reported.push(`${driver.label}.${extension}: ${message}`)
				}
				const absent = [`${name}${ABSENT_SUBPATH}`]
				const control = writeConsumerProbe(stage, `control.${driver.label}.${extension}`, absent)
				if (compileConsumer(control, driver.resolution, driver.module).length === 0) {
					silent.push(`${driver.label}.${extension}`)
				}
			}
		}
		expect(reported).toStrictEqual([])
		expect(silent).toStrictEqual([])
	})
})

for (const entry of STAGE?.entries ?? []) {
	describe(`installed entry ${entry.subpath}`, () => {
		it.runIf(entry.module)(
			'publishes what it declares to a Node import, and no more',
			(context) => {
				const declaration = entry.declaration.module
				if (declaration === undefined) {
					throw new Error(`${entry.subpath} publishes no import declaration`)
				}
				const published = driveRuntime(requireStage(context), entry.specifier, ESM_DRIVER)
				expect(published).toStrictEqual(readDeclaredExports(declaration))
			},
		)

		it.runIf(entry.required)(
			'publishes what it declares to a Node require, and no more',
			(context) => {
				const declaration = entry.declaration.commonjs
				if (declaration === undefined) {
					throw new Error(`${entry.subpath} publishes no require declaration`)
				}
				const published = driveRuntime(requireStage(context), entry.specifier, CJS_DRIVER)
				expect(published).toStrictEqual(readDeclaredExports(declaration))
			},
		)

		it.runIf(entry.browser)(
			'publishes what it declares to a real browser, and no more [requires a browser]',
			async (context) => {
				const stage = requireStage(context)
				const declaration = entry.declaration.browser
				if (declaration === undefined) {
					throw new Error(`${entry.subpath} publishes no browser declaration`)
				}
				const options = resolveBrowser(resolvePinnedBrowser(), process.platform, process.env)
				const browser = await launchBrowser(options).catch((error: unknown) => {
					const cause = `${describeBrowser(options)} was rejected: ${String(error)}`
					if (RELEASE) throw new Error(`The release gate requires a browser, and ${cause}`)
					return context.skip(`No browser launched. ${cause}`)
				})
				try {
					const bundle = await bundleEntry(stage, entry)
					expect(await readBrowserExports(browser, bundle)).toStrictEqual(
						readDeclaredExports(declaration),
					)
				} finally {
					await browser.close()
				}
			},
		)
	})
}
