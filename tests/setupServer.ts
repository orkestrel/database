// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` test project. `node:fs` / `node:path` imports belong here, never
// in `setup.ts`, which browser projects also load. Anchor every path to a
// `createScratch` directory or to a caller-supplied config path, so the runner's
// cwd never matters (see `.claude/rules/tests.md` § Shared test infrastructure).

import type { DriverInterface, TableSchema } from '@src/core'
import type { Diagnostic } from '@orkestrel/probe/server'
import type { ESTree } from 'vite'
import type { ExportKeyword, SurfaceSymbol } from '@orkestrel/guide'
import type { ScratchInterface } from '@orkestrel/test/server'
import { computeSymbolKey } from '@orkestrel/guide'
import { createRequire } from 'node:module'
import { createSQLiteDatabase } from '@orkestrel/sqlite'
import { createSQLiteDriver } from '@src/server'
import { createScratch } from '@orkestrel/test/server'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { parseProjectConfig, scanDiagnostics } from '@orkestrel/probe/server'
import { parseSync } from 'vite'
import { spawnSync } from 'node:child_process'

// The compiler this workspace installs, run as a command rather than called in
// process: the command and its plain-text diagnostics are the same across the
// compiler majors this toolchain supports, and its in-process API is not. It is
// resolved from this module, so the compiler that reads a guide fence and an entry
// barrel is the one this workspace's own `check` script runs.
const COMPILER = createRequire(import.meta.url).resolve('typescript/bin/tsc')
// The source extensions a relative specifier resolves through, in resolution order.
// A published specifier spells its target `.js`; the file beside it is `.ts`.
const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts']
// The compiled-specifier suffix a TypeScript source file is reached through.
const COMPILED_SUFFIX = /\.(?:m|c)?js$/u

/**
 * Carries one executable guide fence and its exact source location.
 */
export interface GuideFenceModule {
	readonly ordinal: number
	readonly line: number
	readonly path: string
	readonly source: string
}

/**
 * Describes one module the parser read: whether its source is a module or a script, the
 * parser's first refusal, and the top-level statements it carries.
 */
export interface ParsedModule {
	readonly form: 'module' | 'script'
	readonly refusal: string | undefined
	readonly statements: readonly ESTree.Statement[]
}

/**
 * Formats compiler diagnostics for a fail-closed entry-surface error.
 *
 * @param diagnostics - The compiler diagnostics to format
 * @returns Stable newline-delimited diagnostic text
 */
export function formatCompilerDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics.map((diagnostic) => diagnostic.message).join('\n')
}

/**
 * Throws when a compiler phase produced diagnostics.
 *
 * @param phase - The compiler phase being checked
 * @param diagnostics - Diagnostics produced by that phase
 */
export function checkCompilerDiagnostics(phase: string, diagnostics: readonly Diagnostic[]): void {
	if (diagnostics.length === 0) return
	throw new Error(`${phase} failed:\n${formatCompilerDiagnostics(diagnostics)}`)
}

/**
 * Reads one module's top-level statements off the parser Vite re-exports.
 *
 * @param source - The module text to parse
 * @param name - The filename the parser reads the source language from
 * @returns Whether the source is a module or a script, the parser's first refusal, and the
 *   statements
 *
 * @remarks
 * The subject is what a declaration carries, so a parser answers it and a pattern does not.
 * `form` reports the parser's own module detection: a file carrying no import and no export
 * is a script, which is what the compiler refuses an entry barrel for.
 *
 * @example
 * ```ts
 * scanModuleSource('export const value = 1\n', 'module.ts').form // 'module'
 * ```
 */
export function scanModuleSource(source: string, name: string): ParsedModule {
	const parsed = parseSync(name, source)
	const [refusal] = parsed.errors
	return {
		form: parsed.program.sourceType === 'module' ? 'module' : 'script',
		refusal: refusal?.message,
		statements: parsed.program.body,
	}
}

/**
 * Reads one module file's top-level statements.
 *
 * @param path - The absolute module path
 * @returns The parsed module
 *
 * @throws Thrown when the parser refuses the file, naming its first refusal.
 */
export function readModuleStatements(path: string): ParsedModule {
	const parsed = scanModuleSource(readFileSync(path, 'utf8'), path)
	if (parsed.refusal !== undefined) {
		throw new Error(`The parser refused ${path}: ${parsed.refusal}`)
	}
	return parsed
}

/**
 * Resolves the source file one module specifier names.
 *
 * @param from - The module the specifier is written in
 * @param specifier - The relative specifier to resolve
 * @returns The absolute source file the specifier reaches
 *
 * @throws Thrown when no source file sits at the specifier, naming both.
 *
 * @remarks
 * A published specifier spells its target `.js`, `.mjs`, or `.cjs` and the file beside it is
 * `.ts`, so the suffix is dropped before each source extension is tried. A specifier naming a
 * directory resolves to that directory's own entry file.
 */
export function resolveModuleFile(from: string, specifier: string): string {
	const target = resolve(dirname(from), specifier)
	const stem = target.replace(COMPILED_SUFFIX, '')
	const candidates = [
		...(stem === target ? [target] : []),
		...SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`),
		...SOURCE_EXTENSIONS.map((extension) => join(stem, `index${extension}`)),
	]
	for (const candidate of candidates) {
		if (statSync(candidate, { throwIfNoEntry: false })?.isFile() === true) return candidate
	}
	throw new Error(`Unable to resolve '${specifier}' from ${from}`)
}

/**
 * Reads the names one top-level declaration binds.
 *
 * @param statement - The statement to read
 * @returns Each name the statement declares, an empty list for a statement that declares none, or
 *   `undefined` when a variable declarator binds a destructuring pattern rather than a name
 */
export function readDeclaredNames(statement: ESTree.Statement): readonly string[] | undefined {
	if (statement.type === 'VariableDeclaration') {
		const names: string[] = []
		for (const declarator of statement.declarations) {
			if (declarator.id.type !== 'Identifier') return undefined
			names.push(declarator.id.name)
		}
		return names
	}
	if (
		statement.type === 'FunctionDeclaration' ||
		statement.type === 'ClassDeclaration' ||
		statement.type === 'TSTypeAliasDeclaration' ||
		statement.type === 'TSInterfaceDeclaration' ||
		statement.type === 'TSEnumDeclaration' ||
		statement.type === 'TSModuleDeclaration'
	) {
		const declared = statement.id
		return declared !== null && declared.type === 'Identifier' ? [declared.name] : []
	}
	return []
}

/**
 * Reads the export name one module export specifier carries.
 *
 * @param name - The specifier's local or exported name node
 * @returns The name as written
 */
export function readExportName(name: ESTree.ModuleExportName): string {
	return name.type === 'Literal' ? name.value : name.name
}

/**
 * Reports whether one re-export form is explicitly type-only.
 *
 * @param statement - The re-exporting statement
 * @param specifier - The specifier being read, or `undefined` for `export *`
 * @returns True if either the statement or the specifier is type-only; false otherwise
 *
 * @remarks
 * The parser marks a statement that carries a type declaration — `export interface`,
 * `export type`, `export declare const` — with a `type` export kind too, so this reads only
 * the specifier and `export *` forms, where the kind names the caller's own `type` keyword.
 */
export function isTypeOnlyExport(
	statement: ESTree.ExportNamedDeclaration | ESTree.ExportAllDeclaration,
	specifier: ESTree.ExportSpecifier | undefined,
): boolean {
	return statement.exportKind === 'type' || specifier?.exportKind === 'type'
}

/**
 * Classifies one supported top-level declaration.
 *
 * @param statement - The declaration to classify
 * @returns Its Guide surface keyword, or `undefined` when the form is unsupported
 *
 * @remarks
 * `let`, `var`, `enum`, and `namespace` are unsupported, and each reads as `undefined` here so
 * the caller refuses it by name.
 */
export function classifyEntryDeclaration(statement: ESTree.Statement): ExportKeyword | undefined {
	if (statement.type === 'TSTypeAliasDeclaration') return 'type'
	if (statement.type === 'TSInterfaceDeclaration') return 'interface'
	if (statement.type === 'ClassDeclaration') return 'class'
	if (statement.type === 'FunctionDeclaration') return 'function'
	if (statement.type === 'VariableDeclaration' && statement.kind === 'const') return 'const'
	return undefined
}

/**
 * Resolves one exported name to the keywords its declarations carry.
 *
 * @param path - The module the name is read from
 * @param name - The exported name to resolve
 * @param entry - The entry path used for error context
 * @param visited - The modules already asked for this name, which stops a re-export cycle
 * @returns One keyword per supported declaration the name resolves to, empty when the module
 *   gives the name nothing
 *
 * @throws Thrown when the name resolves to a type-only form, to an unsupported declaration, or
 *   to a destructured export declarator.
 *
 * @remarks
 * A local `export { name }` reads that name's declaration in the same file, so a name bound by
 * an import rather than by a declaration resolves to nothing and its caller refuses it.
 */
export function resolveExportKeywords(
	path: string,
	name: string,
	entry: string,
	visited: ReadonlySet<string>,
): readonly ExportKeyword[] {
	if (visited.has(path)) return []
	const seen = new Set([...visited, path])
	const parsed = readModuleStatements(path)
	const keywords: ExportKeyword[] = []
	for (const statement of parsed.statements) {
		const declaration =
			statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
		if (declaration === null) continue
		const names = readDeclaredNames(declaration)
		if (names === undefined) {
			throw new Error(`Entry '${entry}' export '${name}' has unsupported declaration`)
		}
		if (!names.includes(name)) continue
		const keyword = classifyEntryDeclaration(declaration)
		if (keyword === undefined) {
			throw new Error(`Entry '${entry}' export '${name}' has unsupported declaration`)
		}
		keywords.push(keyword)
	}
	if (keywords.length > 0) return keywords
	for (const statement of parsed.statements) {
		if (statement.type === 'ExportNamedDeclaration' && statement.source !== null) {
			for (const specifier of statement.specifiers) {
				if (readExportName(specifier.exported) !== name) continue
				if (isTypeOnlyExport(statement, specifier)) {
					throw new Error(`Entry '${entry}' export '${name}' is type-only`)
				}
				const target = resolveModuleFile(path, statement.source.value)
				keywords.push(
					...resolveExportKeywords(target, readExportName(specifier.local), entry, seen),
				)
			}
		}
		if (statement.type === 'ExportAllDeclaration' && statement.exported === null) {
			const reached = resolveExportKeywords(
				resolveModuleFile(path, statement.source.value),
				name,
				entry,
				seen,
			)
			if (reached.length > 0 && isTypeOnlyExport(statement, undefined)) {
				throw new Error(`Entry '${entry}' export '${name}' is type-only`)
			}
			keywords.push(...reached)
		}
	}
	return keywords
}

/**
 * Reads the public Guide surface one module exports.
 *
 * @param path - The module to read
 * @param entry - The entry path used for error context
 * @param visited - The modules already read, which stops an `export *` cycle
 * @returns One symbol per exported name and supported declaration keyword, in source order
 *
 * @throws Thrown when the module is not an ES module, or when an export is a default, a
 *   type-only form, or an unsupported declaration.
 */
export function shapeEntrySymbols(
	path: string,
	entry: string,
	visited: ReadonlySet<string>,
): readonly SurfaceSymbol[] {
	if (visited.has(path)) return []
	const seen = new Set([...visited, path])
	const parsed = readModuleStatements(path)
	if (parsed.form !== 'module') throw new Error(`Missing TypeScript module '${entry}'`)
	const symbols: SurfaceSymbol[] = []
	for (const statement of parsed.statements) {
		if (statement.type === 'ExportDefaultDeclaration') {
			throw new Error(`Entry '${entry}' contains unsupported default export`)
		}
		if (statement.type === 'ExportAllDeclaration') {
			if (statement.exported !== null) {
				const named = readExportName(statement.exported)
				throw new Error(`Entry '${entry}' export '${named}' has unsupported declaration`)
			}
			const typed = isTypeOnlyExport(statement, undefined)
			for (const symbol of shapeEntrySymbols(
				resolveModuleFile(path, statement.source.value),
				entry,
				seen,
			)) {
				if (typed) throw new Error(`Entry '${entry}' export '${symbol.name}' is type-only`)
				symbols.push(symbol)
			}
			continue
		}
		if (statement.type !== 'ExportNamedDeclaration') continue
		const declaration = statement.declaration
		if (declaration !== null) {
			const keyword = classifyEntryDeclaration(declaration)
			const names = readDeclaredNames(declaration)
			if (names === undefined) {
				const bound =
					declaration.type === 'VariableDeclaration'
						? declaration.declarations.find((item) => item.id.type === 'Identifier')
						: undefined
				const named =
					bound !== undefined && bound.id.type === 'Identifier' ? bound.id.name : declaration.type
				throw new Error(`Entry '${entry}' export '${named}' has unsupported declaration`)
			}
			for (const name of names) {
				if (keyword === undefined) {
					throw new Error(`Entry '${entry}' export '${name}' has unsupported declaration`)
				}
				symbols.push({ name, keyword })
			}
			continue
		}
		for (const specifier of statement.specifiers) {
			const name = readExportName(specifier.exported)
			if (name === 'default') {
				throw new Error(`Entry '${entry}' contains unsupported default export`)
			}
			if (isTypeOnlyExport(statement, specifier)) {
				throw new Error(`Entry '${entry}' export '${name}' is type-only`)
			}
			const source = statement.source
			const origin = source === null ? path : resolveModuleFile(path, source.value)
			const keywords = resolveExportKeywords(
				origin,
				readExportName(specifier.local),
				entry,
				new Set<string>(),
			)
			if (keywords.length === 0) {
				throw new Error(`Entry '${entry}' export '${name}' has no declaration`)
			}
			for (const keyword of keywords) symbols.push({ name, keyword })
		}
	}
	return symbols
}

/**
 * Reads the path aliases one TypeScript project resolves to, as absolute targets.
 *
 * @param config - The TypeScript configuration to read
 * @returns Each declared alias mapped to its absolute targets, empty when the project declares none
 *
 * @remarks
 * A scratch project that extends this one and declares its own `paths` replaces the inherited
 * set rather than merging with it, so an overlay carries these entries forward. Each target is
 * resolved against the invoked configuration's own directory, which is where this package
 * declares its aliases; a target declared by a base configuration in another directory would
 * resolve wrongly, and this reader states no support for that shape.
 *
 * @throws Thrown when the compiler fails to start or refuses to print the configuration.
 */
export function readProjectAliases(config: string): Readonly<Record<string, readonly string[]>> {
	const configPath = resolve(config)
	const root = dirname(configPath)
	const printed = spawnSync(process.execPath, [COMPILER, '--showConfig', '-p', configPath], {
		cwd: root,
		encoding: 'utf8',
		windowsHide: true,
	})
	if (printed.error !== undefined) throw printed.error
	if (printed.status !== 0) {
		throw new Error(
			`The compiler refused to print the configuration of ${configPath}: ${`${printed.stderr ?? ''}${printed.stdout ?? ''}`.trim()}`,
		)
	}
	const options = parseProjectConfig(`${printed.stdout ?? ''}`)?.compilerOptions
	if (options === null || typeof options !== 'object' || !('paths' in options)) return {}
	const declared = options.paths
	if (declared === null || typeof declared !== 'object') return {}
	const aliases: Record<string, readonly string[]> = {}
	for (const alias of Object.keys(declared)) {
		const targets: unknown = Reflect.get(declared, alias)
		if (!Array.isArray(targets)) continue
		const resolved: string[] = []
		for (const target of targets) {
			if (typeof target === 'string') resolved.push(resolve(root, target))
		}
		aliases[alias] = resolved
	}
	return aliases
}

/**
 * Compiles one file set against the caller's project and reads what the compiler reported.
 *
 * @param config - The TypeScript configuration the scratch project extends
 * @param files - The absolute files the scratch project selects
 * @param aliases - The path aliases the scratch project declares, empty to inherit the caller's
 * @returns One record per diagnostic the compiler printed, in its own order
 *
 * @throws Thrown when the compiler fails to start or writes to its error stream.
 *
 * @remarks
 * The scratch project extends the caller's, selects the named files through `files`, and clears
 * `include`, so nothing the caller's own selection carries is compiled beside them. The compiler
 * runs from the caller project's directory, so every path it prints is relative to that
 * directory and reads against it.
 */
export function readProjectDiagnostics(
	config: string,
	files: readonly string[],
	aliases: Readonly<Record<string, readonly string[]>>,
): readonly Diagnostic[] {
	const configPath = resolve(config)
	const root = dirname(configPath)
	const temp = join(root, 'tmp')
	mkdirSync(temp, { recursive: true })
	const scratch = createScratch({ parent: temp, prefix: 'database-project-' })
	try {
		const project = {
			extends: configPath,
			compilerOptions:
				Object.keys(aliases).length === 0 ? { noEmit: true } : { noEmit: true, paths: aliases },
			files: [...files],
			include: [],
		}
		const path = scratch.write('tsconfig.json', `${JSON.stringify(project, undefined, '\t')}\n`)
		const compiled = spawnSync(
			process.execPath,
			[COMPILER, '--noEmit', '--pretty', 'false', '-p', path],
			{ cwd: root, encoding: 'utf8', windowsHide: true },
		)
		if (compiled.error !== undefined) throw compiled.error
		// No case ends the child on a signal: the host has no deterministic way to do so, so this
		// guard is proved only by reading and by the compiler options refusal case beside it.
		if (compiled.signal !== null) {
			throw new Error(`The compiler ended on signal ${compiled.signal} before it finished`)
		}
		const refused = `${compiled.stderr ?? ''}`.trim()
		if (refused.length > 0) {
			throw new Error(`The compiler wrote ${refused} to its error stream`)
		}
		return scanDiagnostics(`${compiled.stdout ?? ''}`)
	} finally {
		scratch.destroy()
	}
}

/**
 * Fails closed on every diagnostic the entry graph's own sources carry.
 *
 * @param config - The TypeScript configuration governing the entries
 * @param files - The absolute entry files to compile
 *
 * @throws Thrown when the compiler reported an options, syntax, or semantic diagnostic against
 *   the project or against a file inside the caller's `src` tree.
 *
 * @remarks
 * A diagnostic naming no file is the project's own, and a diagnostic in a file the parser also
 * refuses is a syntax fault, so each reads under the phase it belongs to. A diagnostic in a file
 * outside `src` belongs to a source the entry imports rather than to the published surface, so
 * it is left to that file's own suite.
 */
export function checkEntryDiagnostics(config: string, files: readonly string[]): void {
	const root = dirname(resolve(config))
	const source = join(root, 'src')
	const options: Diagnostic[] = []
	const syntax: Diagnostic[] = []
	const semantics: Diagnostic[] = []
	for (const diagnostic of readProjectDiagnostics(config, files, {})) {
		const named = diagnostic.path
		if (named === undefined) {
			options.push(diagnostic)
			continue
		}
		const file = resolve(root, named)
		const location = relative(source, file)
		if (location !== '' && (location.startsWith('..') || isAbsolute(location))) continue
		const refusal =
			statSync(file, { throwIfNoEntry: false })?.isFile() === true
				? scanModuleSource(readFileSync(file, 'utf8'), file).refusal
				: undefined
		if (refusal === undefined) semantics.push(diagnostic)
		else syntax.push(diagnostic)
	}
	checkCompilerDiagnostics('TypeScript options', options)
	checkCompilerDiagnostics('TypeScript syntax', syntax)
	checkCompilerDiagnostics('TypeScript semantics', semantics)
}

/**
 * Locates Guide-extracted fence bodies in their original document.
 *
 * @param document - The complete guide text
 * @param fences - Verbatim bodies returned by `Guide.patterns()`
 * @param directory - The temporary project directory
 * @returns Fence modules labeled by ordinal and original source line
 */
export function locateGuideFences(
	document: string,
	fences: readonly string[],
	directory: string,
): readonly GuideFenceModule[] {
	const modules: GuideFenceModule[] = []
	let cursor = 0
	for (const [index, source] of fences.entries()) {
		const position = document.indexOf(source, cursor)
		if (position < 0) {
			throw new Error(`Unable to locate executable fence ${index + 1} in the guide source`)
		}
		const line = document.slice(0, position).split('\n').length
		const path = join(directory, `fence-${String(index + 1).padStart(2, '0')}.ts`)
		modules.push({ ordinal: index + 1, line, path, source })
		cursor = position + source.length
	}
	return modules
}

/**
 * Attributes one compiler diagnostic to the fences it reads against.
 *
 * @param modules - Every fence the compile covered
 * @param diagnostic - The diagnostic to attribute
 * @param root - The directory the compiler printed its paths relative to
 * @returns The fence whose module the diagnostic names, or the guide's first fence when it
 *   names an imported source instead, or names no file at all
 *
 * @remarks
 * One compile covers every fence, so the compiler names the file at fault and not the fence
 * that reached it. A diagnostic in an imported source, or one naming no file, therefore
 * attributes to the first fence, and the location the formatter appends names the real file and
 * point.
 */
export function attributeGuideFences(
	modules: readonly GuideFenceModule[],
	diagnostic: Diagnostic,
	root: string,
): readonly GuideFenceModule[] {
	const named = diagnostic.path
	const file = named === undefined ? undefined : resolve(root, named)
	const owners = modules.filter((fence) => resolve(fence.path) === file)
	return owners.length > 0 ? owners : modules.slice(0, 1)
}

/**
 * Formats one executable-fence compiler diagnostic with guide provenance.
 *
 * @param diagnostic - The compiler diagnostic
 * @param fence - The fence being read
 * @param root - The package root used to shorten imported-source locations
 * @returns A stable diagnostic naming the fence ordinal and guide source line
 */
export function formatGuideFenceDiagnostic(
	diagnostic: Diagnostic,
	fence: GuideFenceModule,
	root: string,
): string {
	let line = fence.line
	let location = ''
	const point = diagnostic.range?.start
	if (diagnostic.path !== undefined && point !== undefined) {
		const file = resolve(root, diagnostic.path)
		if (file === resolve(fence.path)) line += point.line
		location = ` [${relative(root, file)}:${point.line + 1}:${point.character + 1}]`
	}
	return `Fence ${fence.ordinal} (guide line ${line})${location}: ${diagnostic.message}`
}

/**
 * Compiles every Guide-extracted TypeScript fence as a standalone module.
 *
 * @param config - The package TypeScript configuration
 * @param document - The complete guide text
 * @param fences - Verbatim bodies returned by `Guide.patterns()`
 *
 * @throws Thrown when the guide carries no executable fence, or when the compiler reported a
 *   diagnostic against any fence.
 *
 * @remarks
 * Every fence carries its own `export {}`, so each is its own module and one compile covers them
 * all. The scratch project maps the published `@orkestrel/database` specifiers onto this
 * package's own entry barrels, beside the aliases the caller's project already declares.
 */
export function checkGuideFences(
	config: string,
	document: string,
	fences: readonly string[],
): void {
	if (fences.length === 0) throw new Error('The database guide has no executable TypeScript fences')
	const configPath = resolve(config)
	const root = dirname(configPath)
	const temp = join(root, 'tmp')
	mkdirSync(temp, { recursive: true })
	const scratch = createScratch({ parent: temp, prefix: 'database-guide-' })
	try {
		const modules = locateGuideFences(document, fences, scratch.path)
		for (const fence of modules) {
			scratch.write(relative(scratch.path, fence.path), `${fence.source}\nexport {}\n`)
		}
		const aliases = {
			...readProjectAliases(configPath),
			'@orkestrel/database': [join(root, 'src/core/index.ts')],
			'@orkestrel/database/browser': [join(root, 'src/browser/index.ts')],
			'@orkestrel/database/server': [join(root, 'src/server/index.ts')],
		}
		const reported = readProjectDiagnostics(
			configPath,
			modules.map((fence) => fence.path),
			aliases,
		)
		const messages: string[] = []
		for (const diagnostic of reported) {
			for (const fence of attributeGuideFences(modules, diagnostic, root)) {
				messages.push(formatGuideFenceDiagnostic(diagnostic, fence, root))
			}
		}
		if (messages.length > 0) {
			throw new Error(`Guide TypeScript fences failed:\n${messages.join('\n')}`)
		}
	} finally {
		scratch.destroy()
	}
}

/**
 * Resolves the public Guide surface reachable from each TypeScript entry barrel.
 *
 * @param config - The TypeScript config governing the entries
 * @param entries - Absolute or config-relative source entry paths
 * @returns A stable readonly mapping from each entry path to its sorted surface
 *
 * @throws Thrown when an entry is missing, when the compiler reported a diagnostic against the
 *   entry graph's own sources, or when an export is a form the Guide surface has no keyword for.
 *
 * @remarks
 * The compiler proves the graph and the parser reads it: a colliding `export *`, a missing
 * re-export, and a type fault each fail the compile, so the walk that follows reads a graph the
 * compiler already accepted. One name reached through two `export *` paths from one declaration
 * is one symbol, and one name carrying several supported declarations is one symbol per keyword.
 */
export function deriveEntrySurfaces(
	config: string,
	entries: readonly string[],
): ReadonlyMap<string, readonly SurfaceSymbol[]> {
	const configPath = resolve(config)
	const root = dirname(configPath)
	const files: string[] = []
	for (const entry of entries) {
		const path = resolve(root, entry)
		if (statSync(path, { throwIfNoEntry: false })?.isFile() !== true) {
			throw new Error(`Missing TypeScript entry '${entry}'`)
		}
		files.push(path)
	}
	checkEntryDiagnostics(configPath, files)
	const surfaces = new Map<string, readonly SurfaceSymbol[]>()
	for (const [index, entry] of entries.entries()) {
		const path = files[index]
		if (path === undefined) throw new Error(`Missing TypeScript entry '${entry}'`)
		const shaped = shapeEntrySymbols(path, entry, new Set<string>())
		const unique = new Map(shaped.map((symbol) => [computeSymbolKey(symbol), symbol]))
		surfaces.set(
			entry,
			[...unique.values()].sort((left, right) => {
				const name = left.name.localeCompare(right.name)
				return name === 0 ? left.keyword.localeCompare(right.keyword) : name
			}),
		)
	}
	return surfaces
}

/**
 * Creates a real source-backed temporary TypeScript project.
 *
 * @param files - Project-relative source paths and their contents
 * @returns Its owned scratch directory and config path
 */
export function tempTypeScriptProject(files: Readonly<Record<string, string>>): {
	readonly scratch: ScratchInterface
	readonly config: string
} {
	const scratch = createScratch({
		prefix: 'database-typescript-',
		files: {
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					strict: true,
					target: 'ESNext',
					module: 'ESNext',
					moduleResolution: 'bundler',
					noEmit: true,
				},
				include: ['src/**/*.ts'],
			}),
			...files,
		},
	})
	return {
		scratch,
		config: join(scratch.path, 'tsconfig.json'),
	}
}

/**
 * Wraps a real native-transaction driver and replaces only a rejected native
 * transaction's reason after the backend has completed its own rollback.
 *
 * @param driver - The real driver whose required primitives and transaction run
 * @param replacement - The post-rollback rejection reason to expose
 * @returns A required-primitive delegate with the one rejection seam
 */
export function replaceTransactionFailure(
	driver: DriverInterface,
	replacement: unknown,
): DriverInterface {
	const native = driver.transaction
	if (native === undefined) throw new Error('Expected a native transaction driver')
	const transact = native.bind(driver)
	return {
		open: (schema) => driver.open(schema),
		close: () => driver.close(),
		read: (table, key) => driver.read(table, key),
		write: (table, key, row, options) => driver.write(table, key, row, options),
		insert: (table, key, row, options) => driver.insert(table, key, row, options),
		delete: (table, key, options) => driver.delete(table, key, options),
		keys: (table) => driver.keys(table),
		scan: (table) => driver.scan(table),
		clear: (table) => driver.clear(table),
		snapshot: (tables) => driver.snapshot(tables),
		async transaction(scope) {
			try {
				return await transact(scope)
			} catch {
				throw replacement
			}
		},
	}
}

// A fresh on-disk database path under the OS temp dir, with a `cleanup` thunk
// that removes its directory. Used by tests that need real file persistence
// across a close / reopen. Call `cleanup` in `afterEach` so no temp file leaks
// (see `.claude/rules/tests.md` § Shared test infrastructure).
export function tempDatabasePath(): { readonly path: string; readonly cleanup: () => void } {
	const scratch = createScratch({ prefix: 'database-json-' })
	return {
		path: join(scratch.path, 'database.json'),
		cleanup: () => scratch.destroy(),
	}
}

/**
 * Declares the portable schema matching the real foreign-key fixture tables.
 */
export const FOREIGN_KEY_SCHEMA: readonly TableSchema[] = Object.freeze([
	{
		name: 'parents',
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [],
	},
	{
		name: 'children',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'parent', storage: 'text', optional: false, nullable: false },
		],
		indexes: [],
	},
])

/**
 * Creates and opens a real SQLite driver over tables carrying a native foreign key.
 *
 * @param references - The driver's foreign-key enforcement option, or `undefined`
 *   to preserve the upstream default
 * @returns The open driver and its temporary-directory cleanup
 */
export async function createForeignKeyFixture(
	references: boolean | undefined,
): Promise<{ readonly driver: DriverInterface; readonly cleanup: () => void }> {
	const storage = tempDatabasePath()
	const database = createSQLiteDatabase({ path: storage.path })
	try {
		database.connect()
		database.execute('CREATE TABLE "parents" ("id" TEXT NOT NULL, PRIMARY KEY ("id"))')
		database.execute(
			'CREATE TABLE "children" ("id" TEXT NOT NULL, "parent" TEXT NOT NULL, PRIMARY KEY ("id"), FOREIGN KEY ("parent") REFERENCES "parents" ("id"))',
		)
	} finally {
		database.close()
	}
	const driver =
		references === undefined
			? createSQLiteDriver({ path: storage.path })
			: createSQLiteDriver({ path: storage.path, references })
	try {
		await driver.open(FOREIGN_KEY_SCHEMA)
		return { driver, cleanup: storage.cleanup }
	} catch (error) {
		await driver.close().catch(() => {})
		storage.cleanup()
		throw error
	}
}

/**
 * Builds the shared driver-conformance schema the JSON `DriverInterface` battery
 * runs against (see `.claude/rules/tests.md` § Shared test infrastructure) — a
 * `users` table carrying one of each codec-relevant
 * column type (text, `integer`, `boolean`, a nullable `json`) and a `posts` table
 * keyed by a non-`id` primary column (`slug`), so the driver test proves the CRUD /
 * key-order / snapshot / codec contract.
 *
 * @param options - `indexes` parameterizes the `users` table's secondary index set
 *   (each inner array is one index's column list); defaults to `[['name']]`. The
 *   `posts` table is always unindexed.
 * @returns The two-table schema (`users` + `posts`)
 */
export function driverSchema(options?: {
	indexes?: ReadonlyArray<readonly string[]>
}): readonly TableSchema[] {
	return [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', storage: 'text', optional: false, nullable: false },
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: false, nullable: false },
				{ name: 'active', storage: 'boolean', optional: false, nullable: false },
				{ name: 'meta', storage: 'json', optional: true, nullable: true },
			],
			indexes: options?.indexes ?? [['name']],
		},
		{
			name: 'posts',
			primary: 'slug',
			columns: [
				{ name: 'slug', storage: 'text', optional: false, nullable: false },
				{ name: 'title', storage: 'text', optional: false, nullable: false },
			],
			indexes: [],
		},
	]
}
