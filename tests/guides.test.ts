// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest — one row (Database) spanning the
// core/browser/server faces as a multi-dir `GuideModule` (AGENTS §22 — one guide per
// package). The five constants below are this package's own.

import type { SurfaceSymbol } from '@orkestrel/guide'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	createGuide,
	createSource,
	createSourceManager,
	fenceImports,
	findMissing,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	missingSymbols,
	normalizeDirectories,
	parseManifest,
	resolveLink,
	symbolKey,
} from '@orkestrel/guide'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import {
	checkGuideFences,
	deriveEntrySurfaces,
	removeProjectFile,
	tempTypeScriptProject,
	writeProjectFile,
} from './setupServer.js'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** Each import specifier this package's own guides may resolve against, mapped to its face. */
const MODULES = Object.freeze({
	'@orkestrel/database': 'src/core',
	'@orkestrel/database/server': 'src/server',
	'@orkestrel/database/browser': 'src/browser',
})
/**
 * Declarations deliberately kept out of the barrel, as `symbolKey` strings.
 *
 * `Cursor`, `DatabaseContext`, `DatabaseIterator`, `DatabaseTransaction`, `DriverIterator`,
 * `Query`, `Table`, `TransactionIterator`, and `TransactionScope` are each exported from their
 * own implementation file (one-class-per-file) but never star-exported from their face's
 * `index.ts`, so they are unreachable through the published barrel — only their `*Interface`
 * counterparts are. Naming them here is what makes that intentional rather than forgotten — and
 * the second assertion below fails when a name here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([
	'class Cursor',
	'class DatabaseContext',
	'class DatabaseIterator',
	'class DatabaseTransaction',
	'class DriverIterator',
	'class Query',
	'class Table',
	'class TransactionIterator',
	'class TransactionScope',
])

/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md'])

const root = new URL('../', import.meta.url)
const ROOT = fileURLToPath(root)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sources = createSourceManager({ files, modules: MODULES })

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
		const fences = createGuide(document)
			.fences()
			.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			.map((fence) => fence.code)
		expect(() => checkGuideFences(join(ROOT, 'tsconfig.json'), document, fences)).toThrow(
			`Fence 1 (guide line ${line})`,
		)
	})
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })
	const surface = Array.from(
		new Map(
			normalizeDirectories(entry.source)
				.flatMap((directory) => requireDirectorySurface(directory))
				.map((symbol) => [symbolKey(symbol), symbol] as const),
		).values(),
	).sort((left, right) => symbolKey(left).localeCompare(symbolKey(right)))

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})

		it('documents every published entry export', () => {
			expect(missingSymbols(surface, guide.surface())).toEqual([])
		})
		it('documents only real entry exports', () => {
			expect(missingSymbols(guide.surface(), surface)).toEqual([])
		})

		it('re-exports every direct declaration that is not named internal', () => {
			const stranded = missingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = missingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
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
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.kind === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		it('compiles every TypeScript fence against the published entry specifiers', () => {
			expect(() =>
				checkGuideFences(
					join(ROOT, 'tsconfig.json'),
					requireValue(files[entry.spec], `Missing file: ${entry.spec}`),
					guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code),
				),
			).not.toThrow()
		}, 60_000)

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			for (const fence of fences) {
				for (const { specifier, names } of fenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					const exported = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, exported)).toEqual([])
				}
			}
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
