// The consumer-side guides-parity drop-in (PROPOSAL §6): runs `@orkestrel/guide`'s
// checks against this repo's own `guides/README.md` manifest — one row (Database)
// spanning the core/server faces as a multi-dir `GuideModule` (AGENTS §22 —
// one guide per package).

import type { SurfaceSymbol } from '@orkestrel/guide'
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
	createGuide,
	createSource,
	fenceImports,
	findMissing,
	findUnexampled,
	isExternalLink,
	missingSymbols,
	normalizeDirectories,
	parseManifest,
	resolveLink,
	symbolKey,
} from '@orkestrel/guide'
import {
	checkGuideFences,
	deriveEntrySurfaces,
	removeProjectFile,
	tempTypeScriptProject,
	writeProjectFile,
} from './setupServer.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const WALK_DIRS = ['src', 'guides', 'tests']
const SELF_SPECIFIERS = [
	'@orkestrel/database',
	'@orkestrel/database/server',
	'@orkestrel/database/browser',
]

function walk(dir: string, acc: Record<string, string>): void {
	for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		const relative = `${dir}/${entry.name}`
		if (entry.isDirectory()) {
			walk(relative, acc)
			continue
		}
		if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.md')) continue
		acc[relative] = readFileSync(join(ROOT, relative), 'utf8')
	}
}

const files: Record<string, string> = {}
for (const dir of WALK_DIRS) walk(dir, files)
files['AGENTS.md'] = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')

function readText(relative: string): string {
	const text = files[relative]
	if (text === undefined) throw new Error(`Missing file: ${relative}`)
	return text
}

const manifest = parseManifest(readText('guides/README.md'), 'guides')
const entryDirectories = Array.from(
	new Set(manifest.flatMap((entry) => normalizeDirectories(entry.source))),
).sort()
const entryPaths = entryDirectories.map((directory) => `${directory}/index.ts`)
const entrySurfaces = deriveEntrySurfaces(join(ROOT, 'tsconfig.json'), entryPaths)

function surfaceForDirectory(directory: string): readonly SurfaceSymbol[] | undefined {
	return entrySurfaces.get(`${directory}/index.ts`)
}

function requireDirectorySurface(directory: string): readonly SurfaceSymbol[] {
	const surface = surfaceForDirectory(directory)
	if (surface === undefined) throw new Error(`Missing compiler surface for '${directory}'`)
	return surface
}

function publicSurface(directories: readonly string[]): readonly SurfaceSymbol[] {
	const surfaces = directories.flatMap((directory) => requireDirectorySurface(directory))
	const unique = new Map<string, (typeof surfaces)[number]>()
	for (const symbol of surfaces) unique.set(symbolKey(symbol), symbol)
	return Array.from(unique.values()).sort((left, right) =>
		symbolKey(left).localeCompare(symbolKey(right)),
	)
}

// Cross-face imports are real in this multi-face package (database.md fences import
// `createJSONDriver` from the server subpath alongside core exports) — so the fence-import
// check resolves each specifier to ITS OWN face's exports rather than only the current
// manifest entry's, per the specifier → module map below.
const SPECIFIER_MODULES: Readonly<Record<string, string>> = {
	'@orkestrel/database': 'src/core',
	'@orkestrel/database/server': 'src/server',
	'@orkestrel/database/browser': 'src/browser',
}
function exportsFor(specifier: string): readonly string[] {
	const module = SPECIFIER_MODULES[specifier]
	if (module === undefined) return []
	return requireDirectorySurface(module).map((symbol) => symbol.name)
}

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

// Every case below writes a real TypeScript project to disk and runs the compiler
// over it, so the block's cost is seconds rather than milliseconds and the default
// per-test budget cannot hold it under a full-suite run. The timeout states that
// cost once for the block rather than inflating a unit test's.
describe('compiler entry surfaces', () => {
	it('resolves every supported kind through nested barrels in stable order', () => {
		const project = tempTypeScriptProject({
			'src/definitions.ts': [
				'export type Value = string',
				'export interface Shape { readonly value: string }',
				'export class Alpha {}',
				'export function Callable(): void {}',
				'export const Beta = 1',
				'export interface Merged { readonly value: string }',
				'export class Merged {}',
			].join('\n'),
			'src/middle.ts': "export * from './definitions.js'",
			'src/index.ts': "export * from './middle.js'",
			'dist/index.ts': 'export class DistributionOnly {}',
		})
		try {
			const surfaces = deriveEntrySurfaces(project.config, ['src/index.ts'])
			expect(surfaces.get('src/index.ts')).toEqual([
				{ name: 'Alpha', kind: 'class' },
				{ name: 'Beta', kind: 'const' },
				{ name: 'Callable', kind: 'function' },
				{ name: 'Merged', kind: 'class' },
				{ name: 'Merged', kind: 'interface' },
				{ name: 'Shape', kind: 'interface' },
				{ name: 'Value', kind: 'type' },
			])
		} finally {
			project.cleanup()
		}
	})

	it('tracks add, remove, rename, and kind changes at the entry', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': "export * from './extra.js'",
			'src/extra.ts': 'export const Added = 1',
		})
		try {
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Added', kind: 'const' },
			])
			writeProjectFile(project.directory, 'src/extra.ts', 'export class Renamed {}')
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Renamed', kind: 'class' },
			])
			writeProjectFile(project.directory, 'src/extra.ts', 'export function Renamed(): void {}')
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Renamed', kind: 'function' },
			])
			writeProjectFile(project.directory, 'src/index.ts', 'export const Local = true')
			removeProjectFile(project.directory, 'src/extra.ts')
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Local', kind: 'const' },
			])
		} finally {
			project.cleanup()
		}
	})

	it('ignores exports that are not reachable from the entry', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': 'export const Public = true',
			'src/internal.ts': 'export class Internal {}',
		})
		try {
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Public', kind: 'const' },
			])
		} finally {
			project.cleanup()
		}
	})

	it('fails closed on colliding and broken re-exports', () => {
		const project = tempTypeScriptProject({
			'src/a.ts': 'export const Collision = 1',
			'src/b.ts': 'export const Collision = 2',
			'src/index.ts': "export * from './a.js'\nexport * from './b.js'",
		})
		try {
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				'TypeScript semantics failed',
			)
			writeProjectFile(project.directory, 'src/index.ts', "export * from './missing.js'")
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				'TypeScript semantics failed',
			)
		} finally {
			project.cleanup()
		}
	})

	it.each([
		{
			label: 'let',
			definition: 'export let Bad = 1',
			entry: "export { Bad } from './definition.js'",
		},
		{
			label: 'default',
			definition: 'export default class Bad {}',
			entry: "export { default } from './definition.js'",
		},
		{
			label: 'type-only',
			definition: 'export interface Bad {}',
			entry: "export type { Bad } from './definition.js'",
		},
		{
			label: 'enum',
			definition: 'export enum Bad { Value }',
			entry: "export { Bad } from './definition.js'",
		},
		{
			label: 'namespace',
			definition: 'export namespace Bad { export const value = 1 }',
			entry: "export { Bad } from './definition.js'",
		},
	])('rejects unsupported $label exports', ({ definition, entry }) => {
		const project = tempTypeScriptProject({
			'src/definition.ts': definition,
			'src/index.ts': entry,
		})
		try {
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				/unsupported|type-only/,
			)
		} finally {
			project.cleanup()
		}
	})

	it('fails closed on a missing entry and syntax diagnostics', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': 'export const Public = true',
		})
		try {
			expect(() => deriveEntrySurfaces(project.config, ['src/missing.ts'])).toThrow(
				"Missing TypeScript entry 'src/missing.ts'",
			)
			writeProjectFile(project.directory, 'src/index.ts', 'const Internal = true')
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				"Missing TypeScript module 'src/index.ts'",
			)
			writeProjectFile(project.directory, 'src/index.ts', 'export const = true')
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				'TypeScript syntax failed',
			)
		} finally {
			project.cleanup()
		}
	})
}, 120_000)

describe('executable guide fences', () => {
	it.each([
		{
			label: 'a stale database option key',
			line: 7,
			source: [
				"import { createDatabase, createMemoryDriver } from '@orkestrel/database'",
				"import { stringShape } from '@orkestrel/contract'",
				'createDatabase({',
				'\tdriver: createMemoryDriver(),',
				'\ttables: { users: { id: stringShape() } },',
				"\tkeys: { users: 'id' },",
				'})',
			].join('\n'),
		},
		{
			label: 'a ColumnSchema missing optional',
			line: 6,
			source: [
				"import type { TableSchema } from '@orkestrel/database'",
				'const schema: TableSchema = {',
				"\tname: 'users',",
				"\tprimary: 'id',",
				"\tcolumns: [{ name: 'id', storage: 'text', nullable: false }],",
				'\tindexes: [],',
				'}',
				'void schema',
			].join('\n'),
		},
		{
			label: 'a nonexistent public method',
			line: 8,
			source: [
				"import { createDatabase, createMemoryDriver } from '@orkestrel/database'",
				"import { stringShape } from '@orkestrel/contract'",
				'const database = createDatabase({',
				'\tdriver: createMemoryDriver(),',
				'\ttables: { users: { id: stringShape() } },',
				'})',
				'database.connect()',
			].join('\n'),
		},
		{
			label: 'a removed server export',
			line: 2,
			source: ["import { generateKey } from '@orkestrel/database/server'", 'generateKey()'].join(
				'\n',
			),
		},
	])('rejects $label with fence provenance', ({ line, source }) => {
		const document = ['```ts', source, '```'].join('\n')
		const patterns = createGuide(document).patterns()
		expect(() => checkGuideFences(join(ROOT, 'tsconfig.json'), document, patterns)).toThrow(
			`Fence 1 (guide line ${line})`,
		)
	})
})

for (const entry of manifest) {
	const guide = createGuide(readText(entry.spec))
	const source = createSource({ files, module: entry.source })
	const surface = publicSurface(normalizeDirectories(entry.source))

	describe(`${entry.concept}`, () => {
		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('documents every source export', () => {
			expect(missingSymbols(surface, guide.surface())).toEqual([])
		})
		it('documents only real exports', () => {
			expect(missingSymbols(guide.surface(), surface)).toEqual([])
		})

		it('keeps table, query, and transaction implementations internal', () => {
			const names = surface.map((symbol) => symbol.name)
			expect(names).not.toContain('Table')
			expect(names).not.toContain('Query')
			expect(names).not.toContain('DatabaseTransaction')
			expect(names).not.toContain('TransactionIterator')
			expect(names).not.toContain('TransactionScope')
			expect(names).toContain('TableInterface')
			expect(names).toContain('QueryInterface')
			expect(source.methods('TableInterface')).toContain('count')
			expect(source.methods('QueryInterface')).toContain('count')
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(symbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every Surface function', () => {
			const fences = guide.patterns()
			const names = guide
				.surface()
				.filter((symbol) => symbol.kind === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		it('compiles every TypeScript fence against the published entry specifiers', () => {
			expect(() =>
				checkGuideFences(join(ROOT, 'tsconfig.json'), readText(entry.spec), guide.patterns()),
			).not.toThrow()
		}, 60_000)

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide.patterns()
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			for (const fence of guide.patterns()) {
				for (const { specifier, names } of fenceImports(fence)) {
					if (!SELF_SPECIFIERS.includes(specifier)) continue
					expect(findMissing(names, exportsFor(specifier))).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
		})
	})
}
