// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` test project. `node:fs` / `node:path` imports belong here, never
// in `setup.ts`, which browser projects also load. Anchor every path to
// `WORKSPACE_ROOT` so the runner's cwd never matters (AGENTS §16.1).

import type { DriverInterface, TableSchema } from '@src/core'
import type { ExportKind, SurfaceSymbol } from '@orkestrel/guide'
import type { Diagnostic, Symbol as CompilerSymbol, TypeChecker } from 'typescript'
import { createSQLiteDriver } from '@src/server'
import { createSQLiteDatabase } from '@orkestrel/sqlite'
import { createScratch } from '@orkestrel/test/server'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import * as ts from 'typescript'

/**
 * One executable guide fence and its exact source location.
 */
export interface GuideFenceModule {
	readonly ordinal: number
	readonly line: number
	readonly path: string
	readonly source: string
}

/**
 * Format compiler diagnostics for a fail-closed entry-surface error.
 *
 * @param diagnostics - The compiler diagnostics to format
 * @returns Stable newline-delimited diagnostic text
 */
export function formatCompilerDiagnostics(diagnostics: readonly Diagnostic[]): string {
	return diagnostics
		.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
		.join('\n')
}

/**
 * Throw when a compiler phase produced diagnostics.
 *
 * @param phase - The compiler phase being checked
 * @param diagnostics - Diagnostics produced by that phase
 */
export function checkCompilerDiagnostics(phase: string, diagnostics: readonly Diagnostic[]): void {
	if (diagnostics.length === 0) return
	throw new Error(`${phase} failed:\n${formatCompilerDiagnostics(diagnostics)}`)
}

/**
 * Locate Guide-extracted fence bodies in their original document.
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
 * Format one executable-fence compiler diagnostic with guide provenance.
 *
 * @param diagnostic - The TypeScript diagnostic
 * @param fence - The fence being compiled
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
	if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
		const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
		const file = resolve(diagnostic.file.fileName)
		if (file === resolve(fence.path)) line += position.line
		location = ` [${relative(root, file)}:${position.line + 1}:${position.character + 1}]`
	}
	const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
	return `Fence ${fence.ordinal} (guide line ${line})${location}: ${message}`
}

/**
 * Compile every Guide-extracted TypeScript fence as a standalone module.
 *
 * @param config - The package TypeScript configuration
 * @param document - The complete guide text
 * @param fences - Verbatim bodies returned by `Guide.patterns()`
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
		const configSource = ts.readJsonConfigFile(configPath, ts.sys.readFile)
		const parsed = ts.parseJsonSourceFileConfigFileContent(
			configSource,
			ts.sys,
			root,
			{ noEmit: true },
			configPath,
		)
		checkCompilerDiagnostics('Guide TypeScript config', parsed.errors)
		const options: ts.CompilerOptions = {
			...parsed.options,
			noEmit: true,
			paths: {
				...parsed.options.paths,
				'@orkestrel/database': [join(root, 'src/core/index.ts')],
				'@orkestrel/database/browser': [join(root, 'src/browser/index.ts')],
				'@orkestrel/database/server': [join(root, 'src/server/index.ts')],
			},
		}
		const messages: string[] = []
		for (const fence of modules) {
			const program = ts.createProgram({ rootNames: [fence.path], options })
			const diagnostics = [
				...program.getOptionsDiagnostics(),
				...program.getSyntacticDiagnostics(),
				...program.getSemanticDiagnostics(),
			]
			for (const diagnostic of diagnostics) {
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
 * Whether an entry export was declared through a type-only export form.
 *
 * @param symbol - The entry's public export symbol
 * @returns `true` when the export is explicitly type-only
 */
export function isTypeOnlyExport(symbol: CompilerSymbol): boolean {
	for (const declaration of symbol.declarations ?? []) {
		if (ts.isExportSpecifier(declaration) && declaration.isTypeOnly) return true
		if (
			ts.isExportSpecifier(declaration) &&
			ts.isNamedExports(declaration.parent) &&
			ts.isExportDeclaration(declaration.parent.parent) &&
			declaration.parent.parent.isTypeOnly
		) {
			return true
		}
		if (ts.isExportDeclaration(declaration) && declaration.isTypeOnly) return true
	}
	return false
}

/**
 * Resolve one public entry export through the compiler's alias graph.
 *
 * @param checker - The program's type checker
 * @param symbol - The public entry export
 * @returns The defining symbol
 */
export function resolveEntrySymbol(checker: TypeChecker, symbol: CompilerSymbol): CompilerSymbol {
	if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol
	return checker.getAliasedSymbol(symbol)
}

/**
 * Classify one supported declaration of a resolved public export.
 *
 * @param symbol - The resolved defining symbol
 * @param declaration - One declaration contributing to that symbol
 * @returns Its Guide surface kind, or `undefined` when unsupported
 */
export function classifyEntryDeclaration(
	symbol: CompilerSymbol,
	declaration: ts.Declaration,
): ExportKind | undefined {
	if ((symbol.flags & ts.SymbolFlags.TypeAlias) !== 0 && ts.isTypeAliasDeclaration(declaration)) {
		return 'type'
	}
	if ((symbol.flags & ts.SymbolFlags.Interface) !== 0 && ts.isInterfaceDeclaration(declaration)) {
		return 'interface'
	}
	if ((symbol.flags & ts.SymbolFlags.Class) !== 0 && ts.isClassDeclaration(declaration)) {
		return 'class'
	}
	if ((symbol.flags & ts.SymbolFlags.Function) !== 0 && ts.isFunctionDeclaration(declaration)) {
		return 'function'
	}
	if (
		(symbol.flags & ts.SymbolFlags.Variable) !== 0 &&
		ts.isVariableDeclaration(declaration) &&
		ts.isVariableDeclarationList(declaration.parent) &&
		(declaration.parent.flags & ts.NodeFlags.Const) !== 0
	) {
		return 'const'
	}
	return undefined
}

/**
 * Convert one compiler-resolved entry export into Guide surface symbols.
 *
 * @param checker - The program's type checker
 * @param exported - The public entry export symbol
 * @param entry - The entry path used for error context
 * @returns One symbol per distinct supported declaration kind
 */
export function shapeEntrySymbols(
	checker: TypeChecker,
	exported: CompilerSymbol,
	entry: string,
): readonly SurfaceSymbol[] {
	if (exported.name === 'default') {
		throw new Error(`Entry '${entry}' contains unsupported default export`)
	}
	if (isTypeOnlyExport(exported)) {
		throw new Error(`Entry '${entry}' export '${exported.name}' is type-only`)
	}
	const target = resolveEntrySymbol(checker, exported)
	const declarations = target.declarations
	if (declarations === undefined || declarations.length === 0) {
		throw new Error(`Entry '${entry}' export '${exported.name}' has no declaration`)
	}
	const kinds = new Set<ExportKind>()
	for (const declaration of declarations) {
		const kind = classifyEntryDeclaration(target, declaration)
		if (kind === undefined) {
			throw new Error(`Entry '${entry}' export '${exported.name}' has unsupported declaration`)
		}
		kinds.add(kind)
	}
	return Array.from(kinds, (kind) => ({ name: exported.name, kind }))
}

/**
 * Resolve the public Guide surface reachable from each TypeScript entry barrel.
 *
 * @param config - The TypeScript config governing the entries
 * @param entries - Absolute or config-relative source entry paths
 * @returns A stable readonly mapping from each entry path to its sorted surface
 */
export function deriveEntrySurfaces(
	config: string,
	entries: readonly string[],
): ReadonlyMap<string, readonly SurfaceSymbol[]> {
	const configPath = resolve(config)
	const rootNames: string[] = []
	for (const entry of entries) {
		const path = resolve(dirname(configPath), entry)
		if (!ts.sys.fileExists(path)) throw new Error(`Missing TypeScript entry '${entry}'`)
		rootNames.push(path)
	}
	const configSource = ts.readJsonConfigFile(configPath, ts.sys.readFile)
	const parsed = ts.parseJsonSourceFileConfigFileContent(
		configSource,
		ts.sys,
		dirname(configPath),
		{ noEmit: true },
		configPath,
	)
	checkCompilerDiagnostics('TypeScript config', parsed.errors)
	const program = ts.createProgram({
		rootNames,
		options: { ...parsed.options, noEmit: true },
	})
	const sourceRoot = resolve(dirname(configPath), 'src')
	const syntacticDiagnostics = program.getSyntacticDiagnostics().filter((diagnostic) => {
		if (diagnostic.file === undefined) return true
		const location = relative(sourceRoot, resolve(diagnostic.file.fileName))
		return location === '' || (!location.startsWith('..') && !isAbsolute(location))
	})
	const semanticDiagnostics = program.getSemanticDiagnostics().filter((diagnostic) => {
		if (diagnostic.file === undefined) return true
		const location = relative(sourceRoot, resolve(diagnostic.file.fileName))
		return location === '' || (!location.startsWith('..') && !isAbsolute(location))
	})
	checkCompilerDiagnostics('TypeScript options', program.getOptionsDiagnostics())
	checkCompilerDiagnostics('TypeScript syntax', syntacticDiagnostics)
	checkCompilerDiagnostics('TypeScript semantics', semanticDiagnostics)

	const checker = program.getTypeChecker()
	const surfaces = new Map<string, readonly SurfaceSymbol[]>()
	for (const entry of entries) {
		const entryPath = resolve(dirname(configPath), entry)
		const source = program.getSourceFile(entryPath)
		if (source === undefined) throw new Error(`Missing TypeScript entry '${entry}'`)
		const module = checker.getSymbolAtLocation(source)
		if (module === undefined) throw new Error(`Missing TypeScript module '${entry}'`)
		const symbols: SurfaceSymbol[] = []
		for (const exported of checker.getExportsOfModule(module)) {
			symbols.push(...shapeEntrySymbols(checker, exported, entry))
		}
		symbols.sort((left, right) => {
			const name = left.name.localeCompare(right.name)
			return name === 0 ? left.kind.localeCompare(right.kind) : name
		})
		surfaces.set(entry, symbols)
	}
	return surfaces
}

/**
 * Write one source file in a real temporary TypeScript project.
 *
 * @param directory - The temporary project root
 * @param file - The project-relative file path
 * @param source - The file's source text
 */
export function writeProjectFile(directory: string, file: string, source: string): void {
	const path = join(directory, file)
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, source, 'utf8')
}

/**
 * Remove one source file from a real temporary TypeScript project.
 *
 * @param directory - The temporary project root
 * @param file - The project-relative file path
 */
export function removeProjectFile(directory: string, file: string): void {
	unlinkSync(join(directory, file))
}

/**
 * Create a real source-backed temporary TypeScript project.
 *
 * @param files - Project-relative source paths and their contents
 * @returns Its root, config path, and cleanup operation
 */
export function tempTypeScriptProject(files: Readonly<Record<string, string>>): {
	readonly directory: string
	readonly config: string
	readonly cleanup: () => void
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
		directory: scratch.path,
		config: join(scratch.path, 'tsconfig.json'),
		cleanup: () => scratch.destroy(),
	}
}

/**
 * Wrap a real native-transaction driver and replace only a rejected native
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
// (AGENTS §16.1).
export function tempDatabasePath(): { readonly path: string; readonly cleanup: () => void } {
	const scratch = createScratch({ prefix: 'database-json-' })
	return {
		path: join(scratch.path, 'database.json'),
		cleanup: () => scratch.destroy(),
	}
}

/**
 * The portable declaration matching the real foreign-key fixture tables.
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
 * Create and open a real SQLite driver over tables carrying a native foreign key.
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
		database.exec('CREATE TABLE "parents" ("id" TEXT NOT NULL, PRIMARY KEY ("id"))')
		database.exec(
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
 * Build the shared driver-conformance schema the JSON `DriverInterface` battery
 * runs against (AGENTS §16.1) — a `users` table carrying one of each codec-relevant
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
