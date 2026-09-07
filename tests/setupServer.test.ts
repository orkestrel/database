import type { Diagnostic } from '@orkestrel/probe/server'
import type { ESTree } from 'vite'
import type { ParsedModule } from './setupServer.js'
import type { ScratchInterface } from '@orkestrel/test/server'
import type { TableSchema } from '@src/core'
import { basename, dirname, join } from 'node:path'
import { createJSONDriver, createSQLiteDriver } from '@src/server'
import { createMemoryDriver } from '@src/core'
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { captureError, requireValue } from '@orkestrel/test'
import {
	attributeGuideFences,
	checkCompilerDiagnostics,
	checkEntryDiagnostics,
	checkGuideFences,
	classifyEntryDeclaration,
	createForeignKeyFixture,
	deriveEntrySurfaces,
	driverSchema,
	FOREIGN_KEY_SCHEMA,
	formatCompilerDiagnostics,
	formatGuideFenceDiagnostic,
	isTypeOnlyExport,
	locateGuideFences,
	readDeclaredNames,
	readExportName,
	readModuleStatements,
	readProjectAliases,
	readProjectDiagnostics,
	replaceTransactionFailure,
	resolveExportKeywords,
	resolveModuleFile,
	scanModuleSource,
	shapeEntrySymbols,
	tempDatabasePath,
	tempTypeScriptProject,
} from './setupServer.js'

// The server test setup module's proof (`tests/setupServer.ts`). Its subject is the Node-only
// harnesses the workspace's suites are driven over: the guide-fence compiler `tests/guides.test.ts`
// runs, the entry-surface reader beside it, the temporary projects and database files the driver
// suites anchor to, and the two driver fixtures they open. The driver behavior those suites assert
// belongs to `tests/src/server/**` and is never re-proven here.
//
// Every case uses the real resource the helper exists to provide: real temporary directories, the
// workspace's own compiler run over real project files, the parser Vite re-exports run over real
// modules, a real on-disk SQLite database, and a real JSON driver. Nothing is simulated, because a
// harness that only works against a simulation proves nothing about the suites it carries.
//
// Each expectation arrives by a route `tests/setupServer.ts` does not share. A written project is
// read back through `node:fs` rather than through the scratch handle that wrote it, a parser leaf is
// driven with statements this file read itself, a declared alias is checked against the
// configuration file that declares it, and the temporary-directory parent is probed on the host at
// runtime rather than assumed.
//
// Every block that spawns the workspace's own compiler carries a `30_000` case budget. One run
// over a two-file scratch project measured 1.7 s to 1.8 s on an idle host and 3.6 s for a case
// that spawns two, so each such block states a budget sized for a contended host rather than
// leaning on the project's 5 s default, which a loaded host clears by too little to distinguish
// contention from a defect.

/** This workspace's own root, the project whose declared aliases one case reads. */
const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url))

/** One guide document whose fence bodies sit on lines this file states outright. */
const GUIDE_LINES = [
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
const GUIDE = GUIDE_LINES.join('\n')
const FIRST_FENCE = 'const first: number = 1\n'
const SECOND_FENCE = 'const second: number = 1\n'
const BROKEN_FENCE = "const second: number = 'text'\n"

/** The schema the transaction-wrapper cases open a real SQLite driver over. */
const TRANSACTION_SCHEMA: readonly TableSchema[] = [
	{
		name: 'users',
		primary: 'id',
		columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
		indexes: [],
	},
]

/** A real temporary project plus the module the parser leaves are driven over. */
interface EntryModuleInterface {
	readonly parsed: ParsedModule
	readonly scratch: ScratchInterface
}

/** Write a real temporary project and parse one of its modules off disk. */
function readEntryModule(
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

/** Read one module's named-export statements, in source order. */
function readNamedExports(
	statements: readonly ESTree.Statement[],
): readonly ESTree.ExportNamedDeclaration[] {
	const named: ESTree.ExportNamedDeclaration[] = []
	for (const statement of statements) {
		if (statement.type === 'ExportNamedDeclaration') named.push(statement)
	}
	return named
}

/** Compile one real source file at a project root and return what the compiler reported. */
function readDiagnostics(source: string): {
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

/** Probe the host's temporary-directory parent through a helper that reports its own path. */
function readScratchParent(): string {
	const storage = tempDatabasePath()
	const parent = dirname(dirname(storage.path))
	storage.cleanup()
	return parent
}

/** List the scratch directories a prefix currently owns under a probed parent. */
function readScratchNames(parent: string, prefix: string): readonly string[] {
	return readdirSync(parent).filter((name) => name.startsWith(prefix))
}

describe('scanModuleSource', () => {
	it('separates an ES module from a script and reports the refusal the parser gives', () => {
		const module = scanModuleSource('export const value = 1\n', 'module.ts')
		const script = scanModuleSource('const value = 1\n', 'script.ts')
		const refused = scanModuleSource('export const = true\n', 'broken.ts')
		expect(module.form).toBe('module')
		expect(module.refusal).toBeUndefined()
		expect(module.statements.map((statement) => statement.type)).toEqual(['ExportNamedDeclaration'])
		expect(script.form).toBe('script')
		expect(script.statements.map((statement) => statement.type)).toEqual(['VariableDeclaration'])
		expect(refused.refusal).toBeDefined()
	})
})

describe('readModuleStatements', () => {
	it('reads a written module off disk and refuses one the parser cannot read', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': "export * from './shapes.js'\n",
			'src/broken.ts': 'export const = true\n',
		})
		try {
			const parsed = readModuleStatements(join(project.scratch.path, 'src/index.ts'))
			expect(parsed.form).toBe('module')
			expect(parsed.statements.map((statement) => statement.type)).toEqual(['ExportAllDeclaration'])
			expect(() => readModuleStatements(join(project.scratch.path, 'src/broken.ts'))).toThrow(
				/The parser refused .*src\/broken\.ts/,
			)
		} finally {
			project.scratch.destroy()
		}
	})
})

describe('resolveModuleFile', () => {
	it('resolves a published specifier, a directory, and refuses a target with no source file', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': 'export {}\n',
			'src/shapes.ts': 'export {}\n',
			'src/drivers/index.ts': 'export {}\n',
		})
		const root = project.scratch.path
		const from = join(root, 'src/index.ts')
		try {
			expect(resolveModuleFile(from, './shapes.js')).toBe(join(root, 'src/shapes.ts'))
			expect(resolveModuleFile(from, './shapes')).toBe(join(root, 'src/shapes.ts'))
			expect(resolveModuleFile(from, './drivers')).toBe(join(root, 'src/drivers/index.ts'))
			expect(resolveModuleFile(from, '../src/shapes.ts')).toBe(join(root, 'src/shapes.ts'))
			expect(() => resolveModuleFile(from, './absent.js')).toThrow(/Unable to resolve '\.\/absent/)
		} finally {
			project.scratch.destroy()
		}
	})
})

describe('readDeclaredNames', () => {
	it('names every binding a declaration carries and nothing for a statement that declares none', () => {
		const module = readEntryModule(
			{
				'src/index.ts':
					"import { join } from 'node:path'\nexport const A = 1, B = 2\nexport class Engine {}\nexport interface Shape {\n\treadonly id: string\n}\nvoid join\n",
			},
			'src/index.ts',
		)
		try {
			const named = readNamedExports(module.parsed.statements)
			const declared = named.map((statement) =>
				readDeclaredNames(requireValue(statement.declaration)),
			)
			expect(declared).toEqual([['A', 'B'], ['Engine'], ['Shape']])
			expect(readDeclaredNames(requireValue(module.parsed.statements[0]))).toEqual([])
		} finally {
			module.scratch.destroy()
		}
	})

	it('reports undefined for a declarator that binds a destructuring pattern', () => {
		const module = readEntryModule(
			{ 'src/index.ts': 'export const { a, b } = { a: 1, b: 2 }\n' },
			'src/index.ts',
		)
		try {
			const named = readNamedExports(module.parsed.statements)
			expect(readDeclaredNames(requireValue(requireValue(named[0]).declaration))).toBeUndefined()
		} finally {
			module.scratch.destroy()
		}
	})
})

describe('readExportName', () => {
	it('reads an identifier name and an arbitrary string name off the same specifier pair', () => {
		const module = readEntryModule(
			{
				'src/index.ts':
					"export { build } from './shapes.js'\nexport { build as 'renamed name' } from './shapes.js'\n",
			},
			'src/index.ts',
		)
		try {
			const named = readNamedExports(module.parsed.statements)
			const pairs = named.map((statement) => {
				const specifier = requireValue(statement.specifiers[0])
				return `${readExportName(specifier.local)}:${readExportName(specifier.exported)}`
			})
			expect(pairs).toEqual(['build:build', 'build:renamed name'])
		} finally {
			module.scratch.destroy()
		}
	})
})

describe('isTypeOnlyExport', () => {
	it('reports the explicit type-only forms, star and named alike, and clears an ordinary value export', () => {
		const module = readEntryModule(
			{
				'src/shapes.ts':
					'export interface Shape {\n\treadonly id: string\n}\nexport interface Label {\n\treadonly text: string\n}\nexport function build(): number {\n\treturn 1\n}\n',
				'src/index.ts':
					"export { build } from './shapes.js'\nexport type { Shape } from './shapes.js'\nexport { type Label } from './shapes.js'\nexport * from './shapes.js'\nexport type * from './shapes.js'\n",
			},
			'src/index.ts',
		)
		try {
			const named = readNamedExports(module.parsed.statements)
			const specified = named.map((statement) =>
				isTypeOnlyExport(statement, requireValue(statement.specifiers[0])),
			)
			const stars = module.parsed.statements
				.filter((statement) => statement.type === 'ExportAllDeclaration')
				.map((statement) => isTypeOnlyExport(statement, undefined))
			expect(specified).toEqual([false, true, true])
			expect(stars).toEqual([false, true])
		} finally {
			module.scratch.destroy()
		}
	})
})

describe('classifyEntryDeclaration', () => {
	it('names each supported declaration keyword and refuses an unsupported one', () => {
		const module = readEntryModule(
			{
				'src/index.ts':
					'export class Engine {}\nexport function build(): number {\n\treturn 1\n}\nexport const LIMIT = 5\nexport interface Shape {\n\treadonly id: string\n}\nexport type Label = string\nexport let counter = 0\nexport enum Mode {\n\tOne,\n}\n',
			},
			'src/index.ts',
		)
		try {
			const kinds = readNamedExports(module.parsed.statements).map((statement) =>
				classifyEntryDeclaration(requireValue(statement.declaration)),
			)
			expect(kinds).toEqual([
				'class',
				'function',
				'const',
				'interface',
				'type',
				undefined,
				undefined,
			])
		} finally {
			module.scratch.destroy()
		}
	})
})

describe('resolveExportKeywords', () => {
	it('follows a re-export to the module that declares it, reads a local declaration in place, and stops on a visited module', () => {
		const project = tempTypeScriptProject({
			'src/shapes.ts': 'export class Engine {}\nexport function build(): number {\n\treturn 1\n}\n',
			'src/index.ts': "export { build } from './shapes.js'\nexport const LIMIT = 5\n",
		})
		const entry = join(project.scratch.path, 'src/index.ts')
		try {
			expect(resolveExportKeywords(entry, 'build', 'src/index.ts', new Set())).toEqual(['function'])
			expect(resolveExportKeywords(entry, 'LIMIT', 'src/index.ts', new Set())).toEqual(['const'])
			expect(resolveExportKeywords(entry, 'Engine', 'src/index.ts', new Set())).toEqual([])
			expect(resolveExportKeywords(entry, 'build', 'src/index.ts', new Set([entry]))).toEqual([])
		} finally {
			project.scratch.destroy()
		}
	})

	it('reads every keyword a merged name carries and follows a star re-export', () => {
		const project = tempTypeScriptProject({
			'src/shapes.ts':
				"export interface Engine {\n\treadonly id: string\n}\nexport const Engine = { id: 'e' }\n",
			'src/index.ts': "export * from './shapes.js'\n",
		})
		const entry = join(project.scratch.path, 'src/index.ts')
		try {
			expect([...resolveExportKeywords(entry, 'Engine', 'src/index.ts', new Set())].sort()).toEqual(
				['const', 'interface'],
			)
		} finally {
			project.scratch.destroy()
		}
	})
})

describe('shapeEntrySymbols', () => {
	it('returns one symbol per distinct declaration keyword a name carries', () => {
		const project = tempTypeScriptProject({
			'src/index.ts':
				"export interface Engine {\n\treadonly id: string\n}\nexport const Engine = { id: 'e' }\n",
		})
		try {
			const shaped = shapeEntrySymbols(
				join(project.scratch.path, 'src/index.ts'),
				'src/index.ts',
				new Set(),
			)
			expect(shaped.map((symbol) => symbol.name)).toEqual(['Engine', 'Engine'])
			expect([...shaped.map((symbol) => symbol.keyword)].sort()).toEqual(['const', 'interface'])
		} finally {
			project.scratch.destroy()
		}
	})

	it('refuses a default export, a type-only export, an unsupported declaration, and a script source', () => {
		const project = tempTypeScriptProject({
			'src/shapes.ts': 'export interface Shape {\n\treadonly id: string\n}\n',
			'src/default.ts': 'const engine = 1\nexport default engine\n',
			'src/typed.ts': "export type { Shape } from './shapes.js'\n",
			'src/unsupported.ts': 'export let counter = 0\n',
			'src/script.ts': 'const counter = 0\nvoid counter\n',
		})
		const root = project.scratch.path
		try {
			expect(() =>
				shapeEntrySymbols(join(root, 'src/default.ts'), 'src/default.ts', new Set()),
			).toThrow(/unsupported default export/)
			expect(() =>
				shapeEntrySymbols(join(root, 'src/typed.ts'), 'src/typed.ts', new Set()),
			).toThrow(/is type-only/)
			expect(() =>
				shapeEntrySymbols(join(root, 'src/unsupported.ts'), 'src/unsupported.ts', new Set()),
			).toThrow(/unsupported declaration/)
			expect(() =>
				shapeEntrySymbols(join(root, 'src/script.ts'), 'src/script.ts', new Set()),
			).toThrow(/Missing TypeScript module 'src\/script\.ts'/)
		} finally {
			project.scratch.destroy()
		}
	})

	it('refuses a destructured export declarator as an unsupported declaration', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': 'export const { a, b } = { a: 1, b: 2 }\n',
		})
		const root = project.scratch.path
		try {
			expect(() =>
				shapeEntrySymbols(join(root, 'src/index.ts'), 'src/index.ts', new Set()),
			).toThrow(/Entry 'src\/index\.ts' export 'VariableDeclaration' has unsupported declaration/)
		} finally {
			project.scratch.destroy()
		}
	})
})

// See the file header for the compiler-budget reason every `30_000`-budgeted block below shares.
describe('readProjectAliases', () => {
	it('reads no alias from a project that declares none', () => {
		const project = tempTypeScriptProject({ 'src/index.ts': 'export const LIMIT = 5\n' })
		try {
			expect(readProjectAliases(project.config)).toEqual({})
		} finally {
			project.scratch.destroy()
		}
	})

	it('reads the aliases this workspace declares as absolute targets', () => {
		const config = join(WORKSPACE_ROOT, 'tsconfig.json')
		const declared: unknown = JSON.parse(readFileSync(config, 'utf8'))
		const aliases = readProjectAliases(config)
		expect(declared).toMatchObject({
			compilerOptions: { paths: { '@src/core': ['./src/core/index.ts'] } },
		})
		expect(aliases['@src/core']).toEqual([join(WORKSPACE_ROOT, 'src/core/index.ts')])
		expect(aliases['@src/server']).toEqual([join(WORKSPACE_ROOT, 'src/server/index.ts')])
		expect(existsSync(join(WORKSPACE_ROOT, 'src/core/index.ts'))).toBe(true)
	})

	it('refuses a project the compiler cannot print the configuration of', () => {
		expect(() => readProjectAliases(join(WORKSPACE_ROOT, 'tmp', 'absent-tsconfig.json'))).toThrow(
			/The compiler refused to print the configuration of .*absent-tsconfig\.json/,
		)
	})
}, 30_000)

describe('readProjectDiagnostics', () => {
	it('reports nothing for a clean project and locates the fault in a broken one', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': 'export const LIMIT = 5\n',
			'src/broken.ts': "export const limit: number = 'five'\n",
		})
		const root = project.scratch.path
		try {
			expect(readProjectDiagnostics(project.config, [join(root, 'src/index.ts')], {})).toEqual([])
			const reported = readProjectDiagnostics(project.config, [join(root, 'src/broken.ts')], {})
			const diagnostic = requireValue(reported[0])
			expect(reported.length).toBe(1)
			expect(diagnostic.path).toBe(join('src', 'broken.ts'))
			expect(diagnostic.range?.start).toEqual({ line: 0, character: 13 })
			expect(diagnostic.message).toContain("Type 'string' is not assignable to type 'number'.")
		} finally {
			project.scratch.destroy()
		}
	})

	it('resolves a specifier only the declared alias overlay reaches', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': "import { LIMIT } from '@fixture/shapes'\nexport const total = LIMIT\n",
			'src/shapes.ts': 'export const LIMIT = 5\n',
		})
		const root = project.scratch.path
		try {
			const overlaid = readProjectDiagnostics(project.config, [join(root, 'src/index.ts')], {
				'@fixture/shapes': [join(root, 'src/shapes.ts')],
			})
			const bare = readProjectDiagnostics(project.config, [join(root, 'src/index.ts')], {})
			expect(overlaid).toEqual([])
			expect(formatCompilerDiagnostics(bare)).toContain("Cannot find module '@fixture/shapes'")
		} finally {
			project.scratch.destroy()
		}
	})

	// No case ends the compiler child on a signal here: the host has no deterministic way to send
	// one to a spawned child mid-compile. This case instead proves the refusal shape the signal
	// guard shares with a project-level fault the compiler already reports through the options
	// path, which a missing base configuration reaches without the parser or the source tree.
	it('reports a project-level diagnostic naming no file for a missing base configuration', () => {
		const project = tempTypeScriptProject({
			'tsconfig.json': JSON.stringify({ extends: './absent-base.json', include: ['src/**/*.ts'] }),
			'src/index.ts': 'export const LIMIT = 5\n',
		})
		try {
			const reported = readProjectDiagnostics(
				project.config,
				[join(project.scratch.path, 'src/index.ts')],
				{},
			)
			expect(reported.some((diagnostic) => diagnostic.path === undefined)).toBe(true)
			expect(formatCompilerDiagnostics(reported)).toContain('absent-base.json')
		} finally {
			project.scratch.destroy()
		}
	})
}, 30_000)

describe('formatCompilerDiagnostics', () => {
	it('puts every diagnostic message on its own line and reports nothing for none', () => {
		const { diagnostics, scratch } = readDiagnostics("export const limit: number = 'five'\n")
		try {
			const text = formatCompilerDiagnostics(diagnostics)
			expect(diagnostics.length).toBeGreaterThan(0)
			expect(text.split('\n').length).toBe(diagnostics.length)
			expect(text).toContain("Type 'string' is not assignable to type 'number'.")
			expect(formatCompilerDiagnostics([])).toBe('')
		} finally {
			scratch.destroy()
		}
	})
}, 30_000)

describe('checkCompilerDiagnostics', () => {
	it('returns silently for a clean phase and throws naming the failing one', () => {
		const { diagnostics, scratch } = readDiagnostics("export const limit: number = 'five'\n")
		try {
			expect(checkCompilerDiagnostics('Entry semantics', [])).toBeUndefined()
			expect(() => checkCompilerDiagnostics('Entry semantics', diagnostics)).toThrow(
				/^Entry semantics failed:\n/,
			)
			expect(() => checkCompilerDiagnostics('Entry semantics', diagnostics)).toThrow(
				/not assignable to type 'number'/,
			)
		} finally {
			scratch.destroy()
		}
	})
}, 30_000)

describe('checkEntryDiagnostics', () => {
	it('names the semantics phase for a type fault inside the source tree', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': "export const LIMIT: number = 'five'\n",
		})
		try {
			expect(() =>
				checkEntryDiagnostics(project.config, [join(project.scratch.path, 'src/index.ts')]),
			).toThrow(/^TypeScript semantics failed:\n/)
		} finally {
			project.scratch.destroy()
		}
	})

	it('names the syntax phase for a file the parser also refuses', () => {
		const project = tempTypeScriptProject({ 'src/index.ts': 'export const = true\n' })
		try {
			expect(() =>
				checkEntryDiagnostics(project.config, [join(project.scratch.path, 'src/index.ts')]),
			).toThrow(/^TypeScript syntax failed:\n/)
		} finally {
			project.scratch.destroy()
		}
	})
}, 30_000)

describe('locateGuideFences', () => {
	it('labels each fence with its ordinal, its guide line, and a zero-padded module path', () => {
		const located = locateGuideFences(GUIDE, [FIRST_FENCE, SECOND_FENCE], '/modules')
		expect(located.map((fence) => fence.ordinal)).toEqual([1, 2])
		expect(located.map((fence) => fence.line)).toEqual([4, 8])
		expect(located.map((fence) => basename(fence.path))).toEqual(['fence-01.ts', 'fence-02.ts'])
		expect(located.map((fence) => fence.source)).toEqual([FIRST_FENCE, SECOND_FENCE])
	})

	it('advances past each match, so a repeated body maps to its later occurrence', () => {
		const repeated = [
			'# Guide',
			'',
			'```ts',
			'const value = 1',
			'```',
			'',
			'```ts',
			'const value = 1',
			'```',
			'',
		].join('\n')
		const located = locateGuideFences(
			repeated,
			['const value = 1\n', 'const value = 1\n'],
			'/modules',
		)
		expect(located.map((fence) => fence.line)).toEqual([4, 8])
	})

	it('refuses a fence body the guide does not contain', () => {
		expect(() => locateGuideFences(GUIDE, [FIRST_FENCE, 'const absent = 1\n'], '/modules')).toThrow(
			/Unable to locate executable fence 2/,
		)
	})
})

describe('attributeGuideFences', () => {
	it('attributes a diagnostic to the fence it names, an imported fault to the first fence, and a file-less one likewise', () => {
		const modules = locateGuideFences(GUIDE, [FIRST_FENCE, SECOND_FENCE], '/modules')
		const point = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
		const owned = attributeGuideFences(
			modules,
			{ path: 'modules/fence-02.ts', range: point, message: 'owned' },
			'/',
		)
		const imported = attributeGuideFences(
			modules,
			{ path: 'src/core/index.ts', range: point, message: 'imported' },
			'/',
		)
		const project = attributeGuideFences(modules, { message: 'project' }, '/')
		expect(owned.map((fence) => fence.ordinal)).toEqual([2])
		expect(imported.map((fence) => fence.ordinal)).toEqual([1])
		expect(project.map((fence) => fence.ordinal)).toEqual([1])
	})
})

describe('formatGuideFenceDiagnostic', () => {
	it('adds the diagnostic line to the guide line when the fault is in the fence itself', () => {
		const { diagnostics, path, root, scratch } = readDiagnostics(
			"const head = 1\nexport const limit: number = 'five'\nexport { head }\n",
		)
		try {
			const diagnostic = requireValue(diagnostics[0])
			const message = formatGuideFenceDiagnostic(
				diagnostic,
				{ ordinal: 2, line: 8, path, source: BROKEN_FENCE },
				root,
			)
			expect(message).toContain('Fence 2 (guide line 9)')
			expect(message).toContain("Type 'string' is not assignable to type 'number'.")
		} finally {
			scratch.destroy()
		}
	})

	it('keeps the guide line and names the foreign file when the fault is imported', () => {
		const { diagnostics, root, scratch } = readDiagnostics("export const limit: number = 'five'\n")
		try {
			const diagnostic = requireValue(diagnostics[0])
			const message = formatGuideFenceDiagnostic(
				diagnostic,
				{ ordinal: 1, line: 4, path: join(root, 'fence-01.ts'), source: FIRST_FENCE },
				root,
			)
			expect(message).toContain('Fence 1 (guide line 4)')
			expect(message).toContain('[index.ts:1:14]')
		} finally {
			scratch.destroy()
		}
	})
}, 30_000)

describe('checkGuideFences', () => {
	it('refuses a guide carrying no executable fences', () => {
		const project = tempTypeScriptProject({})
		try {
			expect(() => checkGuideFences(project.config, GUIDE, [])).toThrow(
				/has no executable TypeScript fences/,
			)
		} finally {
			project.scratch.destroy()
		}
	})

	it('returns silently when every fence compiles', () => {
		const project = tempTypeScriptProject({ 'src/index.ts': 'export {}\n' })
		try {
			expect(checkGuideFences(project.config, GUIDE, [FIRST_FENCE, SECOND_FENCE])).toBeUndefined()
		} finally {
			project.scratch.destroy()
		}
	})

	it('names the failing fence and its guide line, and only that fence', () => {
		const project = tempTypeScriptProject({ 'src/index.ts': 'export {}\n' })
		const broken = GUIDE.replace(SECOND_FENCE, BROKEN_FENCE)
		try {
			// One compile pass, read through its captured error: each `toThrow` would re-run the
			// whole two-fence compile, and three of them overrun the default case budget.
			const failure = captureError(() =>
				checkGuideFences(project.config, broken, [FIRST_FENCE, BROKEN_FENCE]),
			)
			const message = failure instanceof Error ? failure.message : ''
			expect(message).toMatch(/^Guide TypeScript fences failed:\n/)
			expect(message).toContain('Fence 2 (guide line 8)')
			expect(message).not.toContain('Fence 1')
		} finally {
			project.scratch.destroy()
		}
	})
}, 30_000)

describe('deriveEntrySurfaces', () => {
	it('maps each requested entry to its sorted public surface', () => {
		const project = tempTypeScriptProject({
			'src/shapes.ts':
				'export interface Shape {\n\treadonly id: string\n}\nexport type Label = string\n',
			'src/index.ts':
				"export * from './shapes.js'\nexport class Engine {}\nexport function build(): number {\n\treturn 1\n}\nexport const LIMIT = 5\n",
			'src/extra.ts': 'export const EXTRA = 1\n',
		})
		try {
			const surfaces = deriveEntrySurfaces(project.config, ['src/index.ts', 'src/extra.ts'])
			const entry = requireValue(surfaces.get('src/index.ts'))
			expect([...surfaces.keys()]).toEqual(['src/index.ts', 'src/extra.ts'])
			expect(entry.map((symbol) => `${symbol.name}:${symbol.keyword}`)).toEqual([
				'build:function',
				'Engine:class',
				'Label:type',
				'LIMIT:const',
				'Shape:interface',
			])
			expect(requireValue(surfaces.get('src/extra.ts'))).toEqual([
				{ name: 'EXTRA', keyword: 'const' },
			])
		} finally {
			project.scratch.destroy()
		}
	})

	it('reads one symbol for a name two star paths reach from one declaration', () => {
		const project = tempTypeScriptProject({
			'src/shapes.ts': 'export class Engine {}\n',
			'src/left.ts': "export * from './shapes.js'\n",
			'src/right.ts': "export * from './shapes.js'\n",
			'src/index.ts': "export * from './left.js'\nexport * from './right.js'\n",
		})
		try {
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Engine', keyword: 'class' },
			])
		} finally {
			project.scratch.destroy()
		}
	})

	it('fails closed on a colliding star re-export', () => {
		const project = tempTypeScriptProject({
			'src/a.ts': 'export const Collision = 1\n',
			'src/b.ts': 'export const Collision = 2\n',
			'src/index.ts': "export * from './a.js'\nexport * from './b.js'\n",
		})
		try {
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				/TypeScript semantics failed:/,
			)
		} finally {
			project.scratch.destroy()
		}
	})

	it('refuses an entry path that does not exist', () => {
		const project = tempTypeScriptProject({ 'src/index.ts': 'export const LIMIT = 5\n' })
		try {
			expect(() => deriveEntrySurfaces(project.config, ['src/absent.ts'])).toThrow(
				/Missing TypeScript entry 'src\/absent\.ts'/,
			)
		} finally {
			project.scratch.destroy()
		}
	})

	it('fails closed on a fault inside the source tree', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': "export const LIMIT: number = 'five'\n",
		})
		try {
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				/TypeScript semantics failed:/,
			)
		} finally {
			project.scratch.destroy()
		}
	})

	it('ignores a fault in an imported file outside the source tree', () => {
		const project = tempTypeScriptProject({
			'lib/broken.ts': "export const BROKEN: number = 'five'\n",
			'src/index.ts': "export { BROKEN } from '../lib/broken.js'\n",
		})
		try {
			const surfaces = deriveEntrySurfaces(project.config, ['src/index.ts'])
			expect(requireValue(surfaces.get('src/index.ts'))).toEqual([
				{ name: 'BROKEN', keyword: 'const' },
			])
		} finally {
			project.scratch.destroy()
		}
	})
}, 30_000)

describe('tempTypeScriptProject', () => {
	it('writes a strict config beside the supplied sources and removes them on destroy', () => {
		const project = tempTypeScriptProject({ 'src/index.ts': 'export const LIMIT = 5\n' })
		const root = project.scratch.path
		expect(basename(project.config)).toBe('tsconfig.json')
		const declared: unknown = JSON.parse(readFileSync(project.config, 'utf8'))
		expect(declared).toMatchObject({ compilerOptions: { strict: true, noEmit: true } })
		expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toBe('export const LIMIT = 5\n')
		project.scratch.destroy()
		expect(existsSync(root)).toBe(false)
	})
})

describe('tempDatabasePath', () => {
	it('anchors a fresh database file in its own directory and removes it on cleanup', () => {
		const first = tempDatabasePath()
		const second = tempDatabasePath()
		try {
			expect(basename(first.path)).toBe('database.json')
			expect(dirname(first.path)).not.toBe(dirname(second.path))
			expect(existsSync(dirname(first.path))).toBe(true)
			expect(existsSync(first.path)).toBe(false)
		} finally {
			second.cleanup()
		}
		first.cleanup()
		expect(existsSync(dirname(first.path))).toBe(false)
	})
})

describe('replaceTransactionFailure', () => {
	it('refuses a driver carrying no native transaction', () => {
		expect(() => replaceTransactionFailure(createMemoryDriver(), new Error('unused'))).toThrow(
			/Expected a native transaction driver/,
		)
	})

	it('replaces the rejection reason only after the backend has rolled back', async () => {
		const storage = tempDatabasePath()
		const replacement = new Error('post-rollback wrapper failure')
		const wrapped = replaceTransactionFailure(
			createSQLiteDriver({ path: storage.path }),
			replacement,
		)
		try {
			await wrapped.open(TRANSACTION_SCHEMA)
			await expect(
				wrapped.transaction?.(async (scope) => {
					await scope.write('users', 'u1', { id: 'u1' })
					throw new Error('scope failed')
				}),
			).rejects.toBe(replacement)
			expect(await wrapped.read('users', 'u1')).toBeUndefined()
		} finally {
			await wrapped.close()
			storage.cleanup()
		}
	})

	it('delegates every required primitive to the driver it wraps', async () => {
		const storage = tempDatabasePath()
		const native = createSQLiteDriver({ path: storage.path })
		const wrapped = replaceTransactionFailure(native, new Error('unused'))
		try {
			await wrapped.open(TRANSACTION_SCHEMA)
			await wrapped.write('users', 'u1', { id: 'u1' })
			expect(await native.read('users', 'u1')).toEqual({ id: 'u1' })
			expect(await native.keys('users')).toEqual(['u1'])
			expect(await wrapped.delete('users', 'u1')).toBe(true)
			expect(await native.read('users', 'u1')).toBeUndefined()
		} finally {
			await wrapped.close()
			storage.cleanup()
		}
	})
})

describe('FOREIGN_KEY_SCHEMA', () => {
	it('is frozen and declares the child column the fixture keys on its parent', () => {
		expect(Object.isFrozen(FOREIGN_KEY_SCHEMA)).toBe(true)
		expect(FOREIGN_KEY_SCHEMA.map((table) => table.name)).toEqual(['parents', 'children'])
		const children = requireValue(FOREIGN_KEY_SCHEMA[1])
		expect(children.primary).toBe('id')
		expect(children.columns.map((column) => column.name)).toEqual(['id', 'parent'])
	})
})

describe('createForeignKeyFixture', () => {
	it('returns an open driver over tables the fixture created itself', async () => {
		const fixture = await createForeignKeyFixture(undefined)
		try {
			expect(await fixture.driver.keys('parents')).toEqual([])
			expect(await fixture.driver.keys('children')).toEqual([])
		} finally {
			await fixture.driver.close()
			fixture.cleanup()
		}
	})

	it('forwards the references option to the driver it opens', async () => {
		const enforcing = await createForeignKeyFixture(true)
		const permissive = await createForeignKeyFixture(false)
		try {
			await expect(
				enforcing.driver.write('children', 'child', { id: 'child', parent: 'missing' }),
			).rejects.toMatchObject({ code: 'CONFLICT' })
			await permissive.driver.write('children', 'child', { id: 'child', parent: 'missing' })
			expect(await permissive.driver.read('children', 'child')).toEqual({
				id: 'child',
				parent: 'missing',
			})
		} finally {
			await enforcing.driver.close()
			await permissive.driver.close()
			enforcing.cleanup()
			permissive.cleanup()
		}
	})

	it('removes the temporary directory it allocated', async () => {
		const parent = readScratchParent()
		const before = readScratchNames(parent, 'database-json-')
		const fixture = await createForeignKeyFixture(undefined)
		const during = readScratchNames(parent, 'database-json-')
		await fixture.driver.close()
		fixture.cleanup()
		const after = readScratchNames(parent, 'database-json-')
		expect(during.length).toBe(before.length + 1)
		expect(after).toEqual(before)
	})
})

describe('driverSchema', () => {
	it('indexes users on name by default, leaves posts unindexed, and keys posts on slug', () => {
		const [users, posts] = [requireValue(driverSchema()[0]), requireValue(driverSchema()[1])]
		expect(users.name).toBe('users')
		expect(users.primary).toBe('id')
		expect(users.indexes).toEqual([['name']])
		expect(users.columns.map((column) => `${column.name}:${column.storage}`)).toEqual([
			'id:text',
			'name:text',
			'age:integer',
			'active:boolean',
			'meta:json',
		])
		expect(posts.name).toBe('posts')
		expect(posts.primary).toBe('slug')
		expect(posts.indexes).toEqual([])
	})

	it('replaces the users index set when the caller declares one', () => {
		const users = requireValue(driverSchema({ indexes: [['name'], ['age', 'name']] })[0])
		const bare = requireValue(driverSchema({ indexes: [] })[0])
		expect(users.indexes).toEqual([['name'], ['age', 'name']])
		expect(bare.indexes).toEqual([])
	})

	it('declares a schema a real driver opens and keys posts rows by slug against', async () => {
		const storage = tempDatabasePath()
		const driver = createJSONDriver(storage.path)
		try {
			await driver.open(driverSchema())
			await driver.insert('posts', 'first-post', { slug: 'first-post', title: 'First' })
			await driver.insert('users', 'u1', {
				id: 'u1',
				name: 'Ada',
				age: 36,
				active: true,
				meta: null,
			})
			expect(await driver.keys('posts')).toEqual(['first-post'])
			expect(await driver.read('users', 'u1')).toMatchObject({ name: 'Ada', active: true })
		} finally {
			await driver.close()
			storage.cleanup()
		}
	})
})
