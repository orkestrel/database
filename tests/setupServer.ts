import type { ColumnSchema } from '@src/core'
import type { DatabaseInterface, IndexMap, RowOf, TableInterface } from '@src/core'
import { createDatabase, createMemoryDriver } from '@src/core'
import {
	booleanShape,
	integerShape,
	jsonShape,
	nullableShape,
	numberShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'
import type { AggregateOperation, QueryInput, Row } from '@src/core'
import type { FieldPath } from '@orkestrel/contract'
import { applyQuery } from '@src/core'
import { collect } from '@orkestrel/test'
import type { JSONDriver } from '@src/server'
import type { TeardownInterface } from '@orkestrel/test'
import { fileURLToPath } from 'node:url'
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
import { compileQuerySQL, createSQLiteDriver } from '@src/server'
import { createScratch } from '@orkestrel/test/server'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { parseProjectConfig, scanDiagnostics } from '@orkestrel/probe/server'
import { parseSync } from 'vite'
import { spawnSync } from 'node:child_process'

// The compiler this workspace installs, run as a command rather than called in
// process: the command and its plain-text diagnostics are the same across the
// compiler majors this toolchain supports, and its in-process API is not. It is
// resolved from this module, so the compiler that reads a guide fence and an entry
// barrel is the one this workspace's own `check` script runs.
const COMPILER = join(
	dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
	'bin/tsc',
)
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
	return Iterator.from(fences.entries()).reduce<{
		readonly cursor: number
		readonly modules: readonly GuideFenceModule[]
	}>(
		(previous, [index, source]) => {
			const cursor = previous.cursor
			const position = document.indexOf(source, cursor)
			if (position < 0) {
				throw new Error(`Unable to locate executable fence ${index + 1} in the guide source`)
			}
			const line = document.slice(0, position).split(/\r\n|\n/u).length
			const path = join(directory, `fence-${String(index + 1).padStart(2, '0')}.ts`)
			return {
				cursor: position + source.length,
				modules: [...previous.modules, { ordinal: index + 1, line, path, source }],
			}
		},
		{ cursor: 0, modules: [] },
	).modules
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
	const point = diagnostic.range?.start
	if (diagnostic.path !== undefined && point !== undefined) {
		const file = resolve(root, diagnostic.path)
		const line = fence.line + (file === resolve(fence.path) ? point.line : 0)
		const location = ` [${relative(root, file)}:${point.line + 1}:${point.character + 1}]`
		return `Fence ${fence.ordinal} (guide line ${line})${location}: ${diagnostic.message}`
	}
	return `Fence ${fence.ordinal} (guide line ${fence.line}): ${diagnostic.message}`
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

// This workspace's root.
export const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url))

// Guide fence coordinates used by the setup proof.
export const GUIDE_LINES = [
	'# The database guide',
	'',
	'```ts',
	'const first: number = 1',
	'```',
	'',
	'```ts',
	'const second: number = 1',
	'```',
	'',
]
export const GUIDE = GUIDE_LINES.join('\n')
export const FIRST_FENCE = 'const first: number = 1\n'
export const SECOND_FENCE = 'const second: number = 1\n'
export const BROKEN_FENCE = "const second: number = 'text'\n"

// Schema for the transaction wrapper proof.
export const TRANSACTION_SCHEMA: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [],
	},
]

/** Describes a temporary project and its parsed module. */
export interface EntryModuleInterface {
	readonly parsed: ParsedModule
	readonly scratch: ScratchInterface
}

/** Creates a real temporary project and parse one of its modules off disk. */
export function readEntryModule(
	files: Readonly<Record<string, string>>,
	entry: string,
): EntryModuleInterface {
	const project = tempTypeScriptProject(files)
	const path = join(project.scratch.path, entry)
	return {
		parsed: readModuleStatements(path),
		scratch: project.scratch,
	}
}

/** Reads one module's named-export statements, in source order. */
export function readNamedExports(
	statements: readonly ESTree.Statement[],
): readonly ESTree.ExportNamedDeclaration[] {
	const named: ESTree.ExportNamedDeclaration[] = []
	for (const statement of statements) {
		if (statement.type === 'ExportNamedDeclaration') named.push(statement)
	}
	return named
}

/** Compiles one real source file at a project root and return what the compiler reported. */
export function readDiagnostics(source: string): {
	readonly diagnostics: readonly Diagnostic[]
	readonly path: string
	readonly root: string
	readonly scratch: ScratchInterface
} {
	const project = tempTypeScriptProject({ 'index.ts': source })
	const root = project.scratch.path
	const path = join(root, 'index.ts')
	return {
		diagnostics: readProjectDiagnostics(project.config, [path], {}),
		path,
		root,
		scratch: project.scratch,
	}
}

/** Probes the host's temporary-directory parent through a helper that reports its own path. */
export function readScratchParent(): string {
	const storage = tempDatabasePath()
	const parent = dirname(dirname(storage.path))
	storage.cleanup()
	return parent
}

/** Lists the scratch directories a prefix owns under a probed parent. */
export function readScratchNames(parent: string, prefix: string): readonly string[] {
	return readdirSync(parent).filter((name) => name.startsWith(prefix))
}

export const JSON_SCHEMA = driverSchema()

/** Registers a temporary database path for teardown. */
export function databasePath(teardown: TeardownInterface): string {
	const { path, cleanup } = tempDatabasePath()
	teardown.add(cleanup)
	return path
}

/** Describes the on-disk JSON fixture bound for a test. */
export interface JSONTestStorage {
	readonly driver: JSONDriver
	readonly path: string
	readonly cleanup: () => void
}

export const SQLITE_SCHEMA = driverSchema({ indexes: [['name'], ['age', 'name']] })
export const USERS_SQL =
	'CREATE TABLE "users" (' +
	'"id" TEXT NOT NULL, "name" TEXT NOT NULL, "age" INTEGER NOT NULL, ' +
	'"active" INTEGER NOT NULL, "meta" TEXT, PRIMARY KEY ("id"))'
export const POSTS_SQL =
	'CREATE TABLE "posts" ("slug" TEXT NOT NULL, "title" TEXT NOT NULL, PRIMARY KEY ("slug"))'

export type SQLiteDriver = ReturnType<typeof createSQLiteDriver>

export async function rejectPhysicalOpen(
	statements: readonly string[],
	schema: readonly TableSchema[] = SQLITE_SCHEMA,
): Promise<readonly [unknown, unknown]> {
	const temp = tempDatabasePath()
	const native = createSQLiteDatabase({ path: temp.path })
	const target = createSQLiteDriver({ path: temp.path })
	try {
		native.connect()
		for (const statement of statements) native.execute(statement)
		native.close()
		const opened = await target.open(schema).catch((caught: unknown) => caught)
		const after = await target.keys(schema[0]?.name ?? 'missing').catch((caught: unknown) => caught)
		return [opened, after]
	} finally {
		native.close()
		await target.close()
		temp.cleanup()
	}
}

export async function computeSQLiteAggregate(
	target: SQLiteDriver,
	operation: AggregateOperation,
	column: FieldPath,
	input: QueryInput,
): Promise<number | undefined> {
	const hook = target.aggregate
	if (hook === undefined) throw new Error('SQLiteDriver is missing its native aggregate hook')
	return hook.call(target, 'users', operation, column, input)
}

export async function collectEngineRows(
	target: DriverInterface,
	input: QueryInput,
): Promise<readonly Row[]> {
	return applyQuery(await collect(target.scan('users')), input)
}

export async function collectSQLiteIds(
	target: SQLiteDriver,
	input: QueryInput,
): Promise<readonly string[]> {
	const rows = target.records === undefined ? [] : await target.records('users', input)
	return rows.map((row) => String(row.id)).sort()
}

export async function collectExpectedIds(
	target: DriverInterface,
	input: QueryInput,
): Promise<readonly string[]> {
	return (await collectEngineRows(target, input)).map((row) => String(row.id)).sort()
}

export async function collectSQLiteRecords(
	target: SQLiteDriver,
	table: string,
	input: QueryInput,
): Promise<readonly Row[]> {
	const hook = target.records
	if (hook === undefined) throw new Error('SQLiteDriver is missing its native records hook')
	return hook.call(target, table, input)
}

export const USERS = {
	id: stringShape(),
	name: stringShape(),
	age: integerShape(),
	score: numberShape(),
	active: booleanShape(),
	bio: optionalShape(stringShape()),
	meta: jsonShape(),
	rank: optionalShape(integerShape()),
}

export type UserRow = RowOf<typeof USERS>

// Mixed-case + non-ASCII names, boundary ages (0, negative, 17/18, 65, a large
// value), an OPTIONAL `bio` (absent on several rows rather than explicit
// null — SQLite's decodeRow omits a NULL column on read-back, so an absent
// field is the shape that round-trips identically on both backends), a
// nested `meta` json value, and an OPTIONAL `rank` (indexed on the browser
// side, absent on several rows — the lossy-pushdown reproduction).
export const ROWS: readonly UserRow[] = [
	{
		id: 'u1',
		name: 'Ada',
		age: 36,
		score: 91.5,
		active: true,
		bio: 'Computer science pioneer',
		meta: { tags: ['math', 'logic'], info: { level: 9, ok: true } },
		rank: 10,
	},
	{
		id: 'u2',
		name: 'ada',
		age: 0,
		score: 0,
		active: false,
		meta: { tags: [], info: { level: 0, ok: false } },
	},
	{
		id: 'u3',
		name: 'ÄPFEL',
		age: -5,
		score: -2.5,
		active: true,
		bio: 'Apples in German',
		meta: { tags: ['fruit'], info: { level: 3, ok: true } },
		rank: 5,
	},
	{
		id: 'u4',
		name: 'bob',
		age: 17,
		score: 50,
		active: false,
		meta: { tags: ['x'], info: { level: 1, ok: false } },
	},
	{
		id: 'u5',
		name: 'Grace',
		age: 18,
		score: 77.7,
		active: true,
		bio: 'Compiler pioneer',
		meta: { tags: ['compiler', 'math'], info: { level: 5, ok: true } },
		rank: 20,
	},
	{
		id: 'u6',
		name: 'Edsger',
		age: 65,
		score: 100,
		active: false,
		meta: { tags: [], info: { level: 10, ok: true } },
	},
	{
		id: 'u7',
		name: 'Marie',
		age: 1000000,
		score: 1e9,
		active: true,
		bio: 'Large age case',
		meta: { tags: ['big'], info: { level: 2, ok: false } },
		rank: 1,
	},
	// Non-BMP parity fixture (AGENTS/audit FIX 1 + FIX 8): `u8`'s name starts
	// with a SUPPLEMENTARY-plane character (U+1F600, encoded as the UTF-16
	// surrogate pair 😀 — lead surrogate 0xD83D), `u9`'s starts with
	// a single BMP PRIVATE-USE character (U+E050 — code unit 0xE050). Ordered
	// by Unicode CODE POINT (SQLite's default BINARY collation), u8 (U+1F600)
	// sorts ABOVE u9 (U+E050); ordered by UTF-16 CODE UNIT (the core engine's
	// `compareValues`, using JS `<`), u8's lead surrogate (0xD83D = 55357) is
	// NUMERICALLY LESS than u9's single code unit (0xE050 = 57424), so u8
	// sorts BELOW u9 — the exact divergence `matchesConditionExactly` / `matchesOrderExactly`
	// now refine `text` ranges/order to avoid (FIX 1).
	{
		id: 'u8',
		name: '\u{1F600}-user',
		age: 40,
		score: 12.5,
		active: true,
		meta: { tags: ['emoji'], info: { level: 4, ok: true } },
	},
	{
		id: 'u9',
		name: '-zzz',
		age: 41,
		score: 13.5,
		active: false,
		meta: { tags: ['private-use'], info: { level: 6, ok: false } },
	},
]

export const INDEXES: IndexMap = { users: [['age'], ['name'], ['rank']] }

export function memoryDatabase(): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createMemoryDriver(),
		tables: { users: USERS },
		indexes: INDEXES,
	})
}

export function sqliteDatabase(): DatabaseInterface<{ readonly users: typeof USERS }> {
	return createDatabase({
		driver: createSQLiteDriver(),
		tables: { users: USERS },
		indexes: INDEXES,
	})
}

export type UsersTable = TableInterface<UserRow>

export function sortById(rows: readonly UserRow[]): readonly UserRow[] {
	return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

// A row-returning case: `ordered` distinguishes an order-sensitive comparison
// (compare arrays exactly) from an order-insensitive one (sort by `id` first).
export interface RowCase {
	readonly name: string
	readonly ordered?: boolean
	execute(users: UsersTable): Promise<readonly UserRow[]>
}

// A scalar-returning case (count / an aggregate) — compared directly.
export interface ScalarCase {
	readonly name: string
	execute(users: UsersTable): Promise<number | undefined>
}

export const ROW_CASES: readonly RowCase[] = [
	// ── All 15 clause operators (each its own case) ──────────────────────
	{
		name: 'equals',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'equals', values: [36], connector: 'and' })
				.collect(),
	},
	{
		name: 'not',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'active', operator: 'not', values: [true], connector: 'and' })
				.collect(),
	},
	{
		name: 'above',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'below',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'below', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'from',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'from', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'to',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'to', values: [18], connector: 'and' })
				.collect(),
	},
	{
		name: 'between',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'between', values: [0, 36], connector: 'and' })
				.collect(),
	},
	{
		name: 'like',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'like', values: ['%a%'], connector: 'and' })
				.collect(),
	},
	{
		name: 'glob',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'glob', values: ['[A-Z]*'], connector: 'and' })
				.collect(),
	},
	{
		name: 'starts',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: ['A'], connector: 'and' })
				.collect(),
	},
	{
		name: 'ends',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['e'], connector: 'and' })
				.collect(),
	},
	{
		name: 'any',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'name',
					operator: 'any',
					values: ['Ada', 'Grace', 'nope'],
					connector: 'and',
				})
				.collect(),
	},
	{
		name: 'none',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'none', values: ['Ada', 'Grace'], connector: 'and' })
				.collect(),
	},
	{
		name: 'absent (rank)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'absent', values: [], connector: 'and' })
				.collect(),
	},
	{
		name: 'present (rank)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'present', values: [], connector: 'and' })
				.collect(),
	},

	// ── starts/ends case-sensitivity ─────────────────────────────────────
	{
		name: "starts('ada') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: ['ada'], connector: 'and' })
				.collect(),
	},
	{
		name: "starts('Ada') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: ['Ada'], connector: 'and' })
				.collect(),
	},
	{
		name: "ends('a') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['a'], connector: 'and' })
				.collect(),
	},
	{
		name: "ends('A') case variation",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: ['A'], connector: 'and' })
				.collect(),
	},
	{
		name: "starts('') matches every row",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'starts', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: "ends('') matches every row",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'ends', values: [''], connector: 'and' })
				.collect(),
	},

	// ── non-ASCII like, bracket glob, non-string cells ───────────────────
	{
		name: "like non-ASCII pattern 'äpfel%'",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'like', values: ['äpfel%'], connector: 'and' })
				.collect(),
	},
	{
		name: "glob '[a-z]' bracket pattern (engine-literal semantics)",
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'glob', values: ['[a-z]*'], connector: 'and' })
				.collect(),
	},
	{
		name: 'like against a non-string (age) column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'like', values: ['%3%'], connector: 'and' })
				.collect(),
	},
	{
		name: 'glob against a non-string (age) column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'glob', values: ['*3*'], connector: 'and' })
				.collect(),
	},

	// ── any([]) / none([]) / mixed lists / deep json equals ─────────────
	{
		name: 'any([]) matches nothing',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'any', values: [], connector: 'and' })
				.collect(),
	},
	{
		name: 'none([]) matches everything',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'none', values: [], connector: 'and' })
				.collect(),
	},
	{
		name: 'any with a mixed-type list',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'any', values: [36, 'nope', 0], connector: 'and' })
				.collect(),
	},
	{
		name: 'none with a mixed-type list',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'none', values: [36, 'nope', 0], connector: 'and' })
				.collect(),
	},
	{
		name: 'equals a deep matching json operand',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'meta',
					operator: 'equals',
					values: [{ tags: ['math', 'logic'], info: { level: 9, ok: true } }],
					connector: 'and',
				})
				.collect(),
	},
	{
		name: 'equals a deep non-matching json operand (different nested shape)',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'meta',
					operator: 'equals',
					values: [{ tags: ['math', 'logic'], info: { level: 9, ok: false } }],
					connector: 'and',
				})
				.collect(),
	},
	{
		name: 'not a deep json operand',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'meta',
					operator: 'not',
					values: [{ tags: [], info: { level: 0, ok: false } }],
					connector: 'and',
				})
				.collect(),
	},

	// ── range operators over the INDEXED optional `rank` column, some rows absent ──
	{
		name: 'rank below (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'below', values: [10], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank to (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'to', values: [10], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank from (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'from', values: [5], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank above (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'above', values: [5], connector: 'and' })
				.collect(),
	},
	{
		name: 'rank between (with absent rows)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'between', values: [1, 10], connector: 'and' })
				.collect(),
	},

	// ── between reversed bounds ───────────────────────────────────────────
	{
		name: 'between reversed bounds is empty, never throws',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'between', values: [36, 0], connector: 'and' })
				.collect(),
	},

	// ── mismatched operand types ──────────────────────────────────────────
	{
		name: 'equals with a string operand on an integer column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'equals', values: ['36'], connector: 'and' })
				.collect(),
	},
	{
		name: 'above with a string operand on an integer column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: ['18'], connector: 'and' })
				.collect(),
	},
	{
		name: 'equals with a number operand on a text column',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'equals', values: [36], connector: 'and' })
				.collect(),
	},

	// ── non-BMP text RANGE parity (FIX 1 — code point vs. code unit) ─────
	// Threshold '' sits between u8's lead surrogate (0xD83D) and u9's
	// code unit (0xE050): a code-unit (engine) comparison puts u8 BELOW the
	// threshold while a code-point (SQLite BINARY) comparison would put it
	// ABOVE — `matchesConditionExactly` now refines these through the engine so both
	// backends agree.
	{
		name: 'above on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'above', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'below on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'below', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'from on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'from', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'to on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'to', values: [''], connector: 'and' })
				.collect(),
	},
	{
		name: 'between on non-BMP text (name) — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({
					column: 'name',
					operator: 'between',
					values: ['\u{10000}', ''],
					connector: 'and',
				})
				.collect(),
	},

	// ── ordering ──────────────────────────────────────────────────────────
	{
		name: 'ascending on text (name)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'name', direction: 'ascending' }).collect(),
	},
	{
		name: 'descending on text (name)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'name', direction: 'descending' }).collect(),
	},
	{
		name: 'ascending on non-BMP text (name) with limit — code point vs. code unit divergence',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'name', direction: 'ascending' }).limit(4).collect(),
	},
	{
		name: 'descending on non-BMP text (name) with limit — code point vs. code unit divergence',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'name', direction: 'descending' }).limit(4).collect(),
	},
	{
		name: 'ascending on integer (age)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'age', direction: 'ascending' }).collect(),
	},
	{
		name: 'descending on integer (age)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'age', direction: 'descending' }).collect(),
	},
	{
		name: 'ascending on boolean (active)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'active', direction: 'ascending' }).collect(),
	},
	{
		name: 'descending on boolean (active)',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'active', direction: 'descending' }).collect(),
	},
	{
		name: 'ascending on the json column (meta)',
		ordered: true,
		execute: (users) => users.query().order({ column: 'meta', direction: 'ascending' }).collect(),
	},
	{
		name: 'multi-term order (active then age)',
		ordered: true,
		execute: (users) =>
			users
				.query()
				.order({ column: 'active', direction: 'ascending' })
				.order({ column: 'age', direction: 'ascending' })
				.collect(),
	},
	{
		name: 'order + limit + offset paging',
		ordered: true,
		execute: (users) =>
			users.query().order({ column: 'age', direction: 'ascending' }).offset(2).limit(3).collect(),
	},

	// ── stream() with conditions + offset + limit, order-insensitive ─────
	{
		name: 'stream with conditions + offset + limit',
		execute: async (users) => {
			const collected: UserRow[] = []
			for await (const row of users
				.query()
				.condition({ column: 'active', operator: 'equals', values: [true], connector: 'and' })
				.offset(1)
				.limit(2)
				.stream()) {
				collected.push(row)
			}
			return collected
		},
	},

	// ── records() with a prebuilt QueryInput ────────────────────────────────
	{
		name: 'records() with a prebuilt QueryInput',
		ordered: true,
		execute: (users) => {
			const input: QueryInput = {
				conditions: [{ column: 'active', operator: 'equals', values: [true], connector: 'and' }],
				order: [{ column: 'age', direction: 'ascending' }],
			}
			return users.records(input)
		},
	},
]

export const SCALAR_CASES: readonly ScalarCase[] = [
	{ name: 'aggregate count (age, no conditions)', execute: (users) => users.query().count() },
	{
		name: 'aggregate sum (age, no conditions)',
		execute: (users) => users.query().aggregate('sum', 'age'),
	},
	{
		name: 'aggregate average (age, no conditions)',
		execute: (users) => users.query().aggregate('average', 'age'),
	},
	{
		name: 'aggregate minimum (age, no conditions)',
		execute: (users) => users.query().aggregate('minimum', 'age'),
	},
	{
		name: 'aggregate maximum (age, no conditions)',
		execute: (users) => users.query().aggregate('maximum', 'age'),
	},
	{
		name: 'aggregate sum (score, filtered by active)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'active', operator: 'equals', values: [true], connector: 'and' })
				.aggregate('sum', 'score'),
	},
	{
		name: 'aggregate average (score, filtered by active)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'active', operator: 'equals', values: [true], connector: 'and' })
				.aggregate('average', 'score'),
	},
	{
		name: 'aggregate sum over the TEXT name column (parseNumber semantics)',
		execute: (users) => users.query().aggregate('sum', 'name'),
	},
	{
		name: 'aggregate count over zero matching rows',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: [1e9], connector: 'and' })
				.count(),
	},
	{
		name: 'aggregate sum over zero matching rows',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'age', operator: 'above', values: [1e9], connector: 'and' })
				.aggregate('sum', 'age'),
	},
	{
		name: 'rank count over a from-filtered range (indexed optional column)',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'rank', operator: 'from', values: [5], connector: 'and' })
				.count(),
	},
	{
		name: 'count over a non-BMP text (name) range — code point vs. code unit divergence',
		execute: (users) =>
			users
				.query()
				.condition({ column: 'name', operator: 'above', values: [''], connector: 'and' })
				.count(),
	},
]

export const COMPILER_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'active', storage: 'boolean', optional: false, nullable: false },
		{ name: 'meta', storage: 'json', optional: false, nullable: true },
	],
	indexes: [],
}

export function compile(input: QueryInput): {
	readonly sql: string
	readonly parameters: readonly unknown[]
} {
	const result = compileQuerySQL(input, COMPILER_SCHEMA)
	return { sql: result.sql, parameters: result.parameters }
}

export const BOOLEAN: ColumnSchema = {
	name: 'value',
	storage: 'boolean',
	optional: false,
	nullable: false,
}
export const JSON_COLUMN: ColumnSchema = {
	name: 'value',
	storage: 'json',
	optional: false,
	nullable: false,
}
export const INTEGER: ColumnSchema = {
	name: 'value',
	storage: 'integer',
	optional: false,
	nullable: false,
}
export const REAL: ColumnSchema = {
	name: 'value',
	storage: 'real',
	optional: false,
	nullable: false,
}
export const TEXT: ColumnSchema = {
	name: 'value',
	storage: 'text',
	optional: false,
	nullable: false,
}
export const BLOB: ColumnSchema = {
	name: 'value',
	storage: 'blob',
	optional: false,
	nullable: false,
}

export const CODEC_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'active', storage: 'boolean', optional: false, nullable: false },
		{ name: 'meta', storage: 'json', optional: false, nullable: true },
	],
	indexes: [],
}

export const CONDITION_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: true },
		{ name: 'active', storage: 'boolean', optional: false, nullable: true },
		{ name: 'meta', storage: 'json', optional: false, nullable: true },
	],
	indexes: [],
}

export const ORDER_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: true },
		{ name: 'meta', storage: 'json', optional: false, nullable: true },
	],
	indexes: [],
}

export const QUERY_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'meta', storage: 'json', optional: false, nullable: true },
	],
	indexes: [],
}

export const AGGREGATE_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
		{ name: 'score', storage: 'real', optional: true, nullable: false },
		{ name: 'limit', storage: 'integer', optional: false, nullable: true },
		{ name: 'rank', storage: 'integer', optional: true, nullable: true },
	],
	indexes: [],
}

export const INDEXED_SCHEMA: TableSchema = {
	name: 'users',
	primary: 'id',
	columns: [
		{ name: 'id', storage: 'text', optional: false, nullable: false },
		{ name: 'name', storage: 'text', optional: false, nullable: false },
		{ name: 'age', storage: 'integer', optional: false, nullable: false },
	],
	indexes: [['name'], ['name', 'age']],
}

export const METRICS = {
	id: stringShape(),
	value: optionalShape(nullableShape(numberShape())),
}

export const ACTIVE: QueryInput = {
	conditions: [{ column: 'active', operator: 'equals', values: [true], connector: 'and' }],
}

export const NONE: QueryInput = {
	conditions: [{ column: 'age', operator: 'above', values: [100], connector: 'and' }],
}

export const META_SCHEMA: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: false },
			{ name: 'active', storage: 'boolean', optional: false, nullable: false },
			{ name: 'meta', storage: 'json', optional: false, nullable: true },
		],
		indexes: [],
	},
]

export const META_ROWS = [
	{ id: 'u1', name: 'Ada', age: 36, active: true, meta: { score: 9 } },
	{ id: 'u2', name: 'Alan', age: 41, active: false, meta: { score: 3 } },
	{ id: 'u3', name: 'Edsger', age: 50, active: true, meta: { score: 7 } },
	{ id: 'u4', name: 'Grace', age: 22, active: false, meta: { score: 5 } },
]

export const NULL_SCHEMA: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'rank', storage: 'integer', optional: true, nullable: true },
			{ name: 'meta', storage: 'json', optional: true, nullable: true },
		],
		indexes: [],
	},
]

export const NULL_ROWS = [
	{ id: 'u1', rank: 10, meta: { note: null, tag: 'a' } },
	{ id: 'u2', meta: { note: null, tag: 'b' } },
	{ id: 'u3', rank: 20, meta: { tag: 'c' } },
	{ id: 'u4' },
]

export const REFINE_SCHEMA: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'rank', storage: 'integer', optional: false, nullable: true },
		],
		indexes: [],
	},
]
