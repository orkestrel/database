import type { Diagnostic, Symbol as CompilerSymbol, TypeChecker } from 'typescript'
import type { ScratchInterface } from '@orkestrel/test/server'
import type { TableSchema } from '@src/core'
import { basename, dirname, join } from 'node:path'
import { createJSONDriver, createSQLiteDriver } from '@src/server'
import { createMemoryDriver } from '@src/core'
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { captureError, requireValue } from '@orkestrel/test'
import * as ts from 'typescript'
import {
	checkCompilerDiagnostics,
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
	replaceTransactionFailure,
	resolveEntrySymbol,
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
// Every case uses the real resource the helper exists to provide: real temporary directories, real
// TypeScript programs over real source files, a real on-disk SQLite database, and a real JSON
// driver. Nothing is simulated, because a harness that only works against a simulation proves
// nothing about the suites it carries.
//
// Each expectation arrives by a route `tests/setupServer.ts` does not share. A written project is
// read back through `node:fs` rather than through the scratch handle that wrote it, a compiler
// leaf is driven with symbols taken from a program this file built, and the temporary-directory
// parent is probed on the host at runtime rather than assumed.

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

/** A real entry program plus the pieces the compiler leaves are driven with. */
interface EntryProgramInterface {
	readonly checker: TypeChecker
	readonly scratch: ScratchInterface
	readonly symbols: readonly CompilerSymbol[]
}

/** Build a real program over a temporary project and read its entry module's exports. */
function readEntryProgram(
	files: Readonly<Record<string, string>>,
	entry: string,
): EntryProgramInterface {
	const project = tempTypeScriptProject(files)
	const path = join(project.scratch.path, entry)
	const program = ts.createProgram({
		rootNames: [path],
		options: {
			strict: true,
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			noEmit: true,
		},
	})
	const checker = program.getTypeChecker()
	const source = requireValue(program.getSourceFile(path), `missing source ${entry}`)
	const module = requireValue(checker.getSymbolAtLocation(source), `missing module ${entry}`)
	return { checker, scratch: project.scratch, symbols: checker.getExportsOfModule(module) }
}

/** Read one named export from a program's entry symbols. */
function findExport(symbols: readonly CompilerSymbol[], name: string): CompilerSymbol {
	return requireValue(
		symbols.find((symbol) => symbol.name === name),
		`missing export ${name}`,
	)
}

/** Read the first declaration a resolved symbol carries. */
function firstDeclaration(checker: TypeChecker, symbol: CompilerSymbol) {
	const target = resolveEntrySymbol(checker, symbol)
	return { declaration: requireValue(target.declarations?.[0]), target }
}

/** Compile one real source file and return the semantic diagnostics it produces. */
function readDiagnostics(source: string): {
	readonly diagnostics: readonly Diagnostic[]
	readonly path: string
	readonly scratch: ScratchInterface
} {
	const project = tempTypeScriptProject({ 'src/index.ts': source })
	const path = join(project.scratch.path, 'src/index.ts')
	const program = ts.createProgram({
		rootNames: [path],
		options: { strict: true, target: ts.ScriptTarget.ESNext, noEmit: true },
	})
	return { diagnostics: program.getSemanticDiagnostics(), path, scratch: project.scratch }
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

describe('formatCompilerDiagnostics', () => {
	it('flattens every diagnostic message onto its own line', () => {
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
})

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
})

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

describe('formatGuideFenceDiagnostic', () => {
	it('adds the diagnostic line to the guide line when the fault is in the fence itself', () => {
		const { diagnostics, path, scratch } = readDiagnostics(
			"const head = 1\nexport const limit: number = 'five'\nexport { head }\n",
		)
		try {
			const diagnostic = requireValue(diagnostics[0])
			const message = formatGuideFenceDiagnostic(
				diagnostic,
				{ ordinal: 2, line: 8, path, source: BROKEN_FENCE },
				dirname(path),
			)
			expect(message).toContain('Fence 2 (guide line 9)')
			expect(message).toContain("Type 'string' is not assignable to type 'number'.")
		} finally {
			scratch.destroy()
		}
	})

	it('keeps the guide line and names the foreign file when the fault is imported', () => {
		const { diagnostics, path, scratch } = readDiagnostics("export const limit: number = 'five'\n")
		try {
			const diagnostic = requireValue(diagnostics[0])
			const message = formatGuideFenceDiagnostic(
				diagnostic,
				{ ordinal: 1, line: 4, path: join(dirname(path), 'fence-01.ts'), source: FIRST_FENCE },
				dirname(path),
			)
			expect(message).toContain('Fence 1 (guide line 4)')
			expect(message).toContain('[index.ts:1:14]')
		} finally {
			scratch.destroy()
		}
	})
})

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
})

describe('isTypeOnlyExport', () => {
	it('reports the explicit type-only forms and clears an ordinary value export', () => {
		const program = readEntryProgram(
			{
				'src/shapes.ts':
					'export interface Shape {\n\treadonly id: string\n}\nexport interface Label {\n\treadonly text: string\n}\nexport function build(): number {\n\treturn 1\n}\n',
				'src/index.ts':
					"export { build } from './shapes.js'\nexport type { Shape } from './shapes.js'\nexport { type Label } from './shapes.js'\n",
			},
			'src/index.ts',
		)
		try {
			expect(isTypeOnlyExport(findExport(program.symbols, 'build'))).toBe(false)
			expect(isTypeOnlyExport(findExport(program.symbols, 'Shape'))).toBe(true)
			expect(isTypeOnlyExport(findExport(program.symbols, 'Label'))).toBe(true)
		} finally {
			program.scratch.destroy()
		}
	})
})

describe('resolveEntrySymbol', () => {
	it('follows a re-export to the module that declares it, and leaves a local symbol alone', () => {
		const program = readEntryProgram(
			{
				'src/shapes.ts': 'export function build(): number {\n\treturn 1\n}\n',
				'src/index.ts': "export { build } from './shapes.js'\nexport const LIMIT = 5\n",
			},
			'src/index.ts',
		)
		try {
			const alias = findExport(program.symbols, 'build')
			const local = findExport(program.symbols, 'LIMIT')
			const resolved = resolveEntrySymbol(program.checker, alias)
			expect(resolved).not.toBe(alias)
			expect(basename(requireValue(resolved.declarations?.[0]).getSourceFile().fileName)).toBe(
				'shapes.ts',
			)
			expect(resolveEntrySymbol(program.checker, local)).toBe(local)
		} finally {
			program.scratch.destroy()
		}
	})
})

describe('classifyEntryDeclaration', () => {
	it('names each supported declaration kind and refuses an unsupported one', () => {
		const program = readEntryProgram(
			{
				'src/index.ts':
					'export class Engine {}\nexport function build(): number {\n\treturn 1\n}\nexport const LIMIT = 5\nexport interface Shape {\n\treadonly id: string\n}\nexport type Label = string\nexport let counter = 0\n',
			},
			'src/index.ts',
		)
		try {
			const kinds = ['Engine', 'build', 'LIMIT', 'Shape', 'Label', 'counter'].map((name) => {
				const { declaration, target } = firstDeclaration(
					program.checker,
					findExport(program.symbols, name),
				)
				return classifyEntryDeclaration(target, declaration)
			})
			expect(kinds).toEqual(['class', 'function', 'const', 'interface', 'type', undefined])
		} finally {
			program.scratch.destroy()
		}
	})
})

describe('shapeEntrySymbols', () => {
	it('returns one symbol per distinct declaration kind a name carries', () => {
		const program = readEntryProgram(
			{
				'src/index.ts':
					"export interface Engine {\n\treadonly id: string\n}\nexport const Engine = { id: 'e' }\n",
			},
			'src/index.ts',
		)
		try {
			const shaped = shapeEntrySymbols(
				program.checker,
				findExport(program.symbols, 'Engine'),
				'src/index.ts',
			)
			expect(shaped.map((symbol) => symbol.name)).toEqual(['Engine', 'Engine'])
			expect([...shaped.map((symbol) => symbol.kind)].sort()).toEqual(['const', 'interface'])
		} finally {
			program.scratch.destroy()
		}
	})

	it('refuses a default export, a type-only export, and an unsupported declaration', () => {
		const program = readEntryProgram(
			{
				'src/shapes.ts': 'export interface Shape {\n\treadonly id: string\n}\n',
				'src/index.ts':
					"export type { Shape } from './shapes.js'\nexport let counter = 0\nconst engine = 1\nexport default engine\n",
			},
			'src/index.ts',
		)
		try {
			expect(() =>
				shapeEntrySymbols(program.checker, findExport(program.symbols, 'default'), 'src/index.ts'),
			).toThrow(/unsupported default export/)
			expect(() =>
				shapeEntrySymbols(program.checker, findExport(program.symbols, 'Shape'), 'src/index.ts'),
			).toThrow(/is type-only/)
			expect(() =>
				shapeEntrySymbols(program.checker, findExport(program.symbols, 'counter'), 'src/index.ts'),
			).toThrow(/unsupported declaration/)
		} finally {
			program.scratch.destroy()
		}
	})
})

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
			expect(entry.map((symbol) => `${symbol.name}:${symbol.kind}`)).toEqual([
				'build:function',
				'Engine:class',
				'Label:type',
				'LIMIT:const',
				'Shape:interface',
			])
			expect(requireValue(surfaces.get('src/extra.ts'))).toEqual([{ name: 'EXTRA', kind: 'const' }])
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
				{ name: 'BROKEN', kind: 'const' },
			])
		} finally {
			project.scratch.destroy()
		}
	})
})

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
