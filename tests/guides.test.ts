// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest — one row (Database) spanning the
// core/browser/server faces as a multi-dir `GuideModule` (`.claude/rules/documentation.md`
// § Parity — one guide per package). The constants below are this package's own.

import type { SurfaceSymbol } from '@orkestrel/guide'
import type { AdmissionInterface, Condition, TableSchema } from '@src/core'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { integerShape, literalShape, optionalShape, stringShape } from '@orkestrel/contract'
import {
	auditDriver,
	cloneDriverMetadata,
	compareValues,
	computeAggregate,
	createDatabase,
	createMemoryDriver,
	equalsValue,
	extractKey,
	filterRows,
	isKey,
	matchesCondition,
	matchesGlobPattern,
	matchesLikePattern,
	matchesQuery,
	matchesWildcardPattern,
	migrateRows,
	planMigration,
	shapeToColumnStorage,
} from '@src/core'
import {
	compileAggregateSQL,
	compileColumnSQL,
	compileFieldSQL,
	compileQuerySQL,
	deriveSQLiteIndexName,
	matchesAggregateExactly,
	matchesConditionExactly,
	matchesOrderExactly,
	matchesQueryExactly,
	matchesSQLiteAffinity,
	quoteIdentifier,
	schemaToIndexes,
	schemaToTable,
} from '@src/server'
import { deriveIndexedDBIndexName } from '@src/browser'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	normalizeDirectories,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import { checkGuideFences, deriveEntrySurfaces, tempTypeScriptProject } from './setupServer.js'

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
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * `Cursor`, `DatabaseContext`, `DatabaseTransaction`, `Query`,
 * `ScopedIterator`, `Table`, and `TransactionScope` are each exported from their
 * own implementation file (one-class-per-file) but never star-exported from their face's
 * `index.ts`, so they are unreachable through the published barrel — only their `*Interface`
 * counterparts are. Naming them here is what makes that intentional rather than forgotten — and
 * the second assertion below fails when a name here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([
	'class Cursor',
	'class DatabaseContext',
	'class DatabaseTransaction',
	'class Query',
	'class ScopedIterator',
	'class Table',
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
	it('resolves every supported keyword through nested barrels in stable order', () => {
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
				{ name: 'Alpha', keyword: 'class' },
				{ name: 'Beta', keyword: 'const' },
				{ name: 'Callable', keyword: 'function' },
				{ name: 'Merged', keyword: 'class' },
				{ name: 'Merged', keyword: 'interface' },
				{ name: 'Shape', keyword: 'interface' },
				{ name: 'Value', keyword: 'type' },
			])
		} finally {
			project.scratch.destroy()
		}
	})

	it('tracks add, remove, rename, and keyword changes at the entry', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': "export * from './extra.js'",
			'src/extra.ts': 'export const Added = 1',
		})
		try {
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Added', keyword: 'const' },
			])
			project.scratch.write('src/extra.ts', 'export class Renamed {}')
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Renamed', keyword: 'class' },
			])
			project.scratch.write('src/extra.ts', 'export function Renamed(): void {}')
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Renamed', keyword: 'function' },
			])
			project.scratch.write('src/index.ts', 'export const Local = true')
			project.scratch.remove('src/extra.ts')
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Local', keyword: 'const' },
			])
		} finally {
			project.scratch.destroy()
		}
	})

	it('ignores exports that are not reachable from the entry', () => {
		const project = tempTypeScriptProject({
			'src/index.ts': 'export const Public = true',
			'src/internal.ts': 'export class Internal {}',
		})
		try {
			expect(deriveEntrySurfaces(project.config, ['src/index.ts']).get('src/index.ts')).toEqual([
				{ name: 'Public', keyword: 'const' },
			])
		} finally {
			project.scratch.destroy()
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
			project.scratch.write('src/index.ts', "export * from './missing.js'")
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				'TypeScript semantics failed',
			)
		} finally {
			project.scratch.destroy()
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
			project.scratch.destroy()
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
			project.scratch.write('src/index.ts', 'const Internal = true')
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				"Missing TypeScript module 'src/index.ts'",
			)
			project.scratch.write('src/index.ts', 'export const = true')
			expect(() => deriveEntrySurfaces(project.config, ['src/index.ts'])).toThrow(
				'TypeScript syntax failed',
			)
		} finally {
			project.scratch.destroy()
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

// `checkGuideFences` compiles each fence with `noEmit`, so it proves every name resolves
// and nothing more: a fence whose `// value` comment the code contradicts still passes it.
// These cases transcribe the fences that state a value and assert that value against the
// real sources, so a changed return breaks here rather than shipping. Each transcription
// names the guide line it mirrors. Change a fence, change the transcription beside it.
describe('flagship fences: core helpers', () => {
	it('migrateRows drops the removed column (guides/database.md:1554-1556)', () => {
		const rows = [{ id: 'a', name: 'Ada', legacy: true }]
		expect(
			migrateRows(rows, [{ operation: 'column.remove', table: 'users', column: 'legacy' }]),
		).toEqual([{ id: 'a', name: 'Ada' }])
	})

	it('cloneDriverMetadata returns a deeply frozen distinct copy (guides/database.md:1667-1669)', () => {
		const source = {
			version: 3,
			schema: [
				{
					name: 'users',
					primary: 'id',
					columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
					indexes: [],
				},
			],
		}
		const metadata = cloneDriverMetadata(source)
		expect(Object.isFrozen(metadata)).toBe(true)
		expect(Object.isFrozen(metadata.schema[0])).toBe(true)
		expect(metadata !== source).toBe(true)
	})

	it('the comparison and pattern helpers return what the fence claims (guides/database.md:2020-2023)', () => {
		expect(compareValues(1, 2)).toBe(-1)
		expect(matchesWildcardPattern('hello', 'h%o', '%', '_', true)).toBe(true)
		expect(matchesLikePattern('hello', 'h%o')).toBe(true)
		expect(matchesGlobPattern('hello', 'h*o')).toBe(true)
	})

	it('the condition helpers return what the fence claims (guides/database.md:2031-2033)', () => {
		const condition: Condition = {
			column: 'age',
			operator: 'above',
			values: [18],
			connector: 'and',
		}
		expect(matchesCondition({ age: 36 }, condition)).toBe(true)
		expect(matchesQuery({ age: 36 }, [condition])).toBe(true)
		expect(filterRows([{ age: 36 }, { age: 12 }], [condition])).toEqual([{ age: 36 }])
	})

	it('the aggregate and projection helpers return what the fence claims (guides/database.md:2038-2042)', () => {
		expect(computeAggregate([{ age: 36 }, { age: 18 }], 'average', 'age')).toBe(27)
		expect(extractKey({ id: 'u1' }, 'id')).toBe('u1')
		expect(shapeToColumnStorage(integerShape())).toBe('integer')
		expect(equalsValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
	})

	it('planMigration returns the versioned step plan the fence claims (guides/database.md:1548)', () => {
		const deployed: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [{ name: 'id', storage: 'text', optional: false, nullable: false }],
				indexes: [],
			},
		]
		const declared: readonly TableSchema[] = [
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'id', storage: 'text', optional: false, nullable: false },
					{ name: 'age', storage: 'integer', optional: true, nullable: true },
				],
				indexes: [],
			},
		]
		const plan = planMigration(deployed, declared)
		expect(plan.from).toBe(0)
		expect(plan.to).toBe(1)
		expect(plan.steps).toEqual([
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', storage: 'integer', optional: true, nullable: true },
			},
		])
	})

	it('auditDriver resolves an empty finding list for a conformant driver (guides/database.md:1770-1771)', async () => {
		const findings = await auditDriver(() => createMemoryDriver())
		expect(findings).toEqual([])
	})

	// This case is a type-conformance transcription of a caller-supplied `AdmissionInterface`
	// literal: the fence's compile against the interface proves the shape, not an implementor's
	// behaviour. `tests/src/core/DatabaseContext.test.ts` and `tests/src/core/TransactionScope.test.ts`
	// drive the real implementors of this boundary.
	it('the admission boundary reports accepting and returns the tracked result (guides/database.md:1472-1473)', async () => {
		const boundary: AdmissionInterface = {
			accepting: true,
			track: (operation) => operation(),
		}
		expect(boundary.accepting).toBe(true)
		expect(await boundary.track(async () => 42)).toBe(42)
	})
})

describe('flagship fences: server helpers', () => {
	const schema: TableSchema = {
		name: 'users',
		primary: 'id',
		columns: [
			{ name: 'id', storage: 'text', optional: false, nullable: false },
			{ name: 'age', storage: 'integer', optional: false, nullable: false },
		],
		indexes: [],
	}

	it('compileQuerySQL emits the fence text and parameters (guides/database.md:2135-2138)', () => {
		expect(
			compileQuerySQL(
				{ conditions: [{ column: 'age', operator: 'from', values: [18], connector: 'and' }] },
				schema,
			),
		).toEqual({ sql: 'WHERE "age" >= ? ORDER BY "id"', parameters: [18] })
	})

	it('the SQL emitters return what the fence claims (guides/database.md:2140-2148)', () => {
		expect(quoteIdentifier('order')).toBe('"order"')
		expect(deriveSQLiteIndexName('users', ['age'])).toBe('idx_5_users_3_age')
		expect(compileColumnSQL('integer')).toBe('INTEGER')
		expect(compileFieldSQL(['profile', 'score'])).toBe('json_extract("profile", \'$.score\')')
		expect(compileAggregateSQL('average', 'age')).toBe('AVG("age")')
		expect(matchesAggregateExactly('minimum', 'age', schema)).toBe(true)
		expect(matchesSQLiteAffinity('INTEGER', 'integer')).toBe(true)
		expect(schemaToTable(schema)).toContain('CREATE TABLE IF NOT EXISTS')
		expect(schemaToIndexes(schema)).toEqual([])
	})

	it('the exactness predicates return what the fence claims (guides/database.md:2197-2212)', () => {
		const exact: Condition = { column: 'age', operator: 'above', values: [18], connector: 'and' }
		const notExact: Condition = {
			column: 'age',
			operator: 'above',
			values: [null],
			connector: 'and',
		}
		expect(matchesConditionExactly(exact, schema)).toBe(true)
		expect(matchesConditionExactly(notExact, schema)).toBe(false)
		expect(matchesOrderExactly({ column: 'age', direction: 'ascending' }, schema)).toBe(true)
		expect(
			matchesQueryExactly(
				{ conditions: [exact], order: [{ column: 'age', direction: 'ascending' }] },
				schema,
			),
		).toBe(true)
	})
})

// The browser fence's `conditionToRange` / `selectPlan` claims return `IDBKeyRange`
// values, which this Node project has no host for; `tests/src/browser/helpers.test.ts`
// asserts them in real Chromium. The two host-independent claims transcribe here.
describe('flagship fences: browser helpers', () => {
	it('isKey and deriveIndexedDBIndexName return what the fence claims (guides/database.md:2362-2364)', () => {
		expect(isKey('u1')).toBe(true)
		expect(isKey(true)).toBe(false)
		expect(deriveIndexedDBIndexName(['city', 'age'])).toBe('2#4:city3:age')
	})
})

describe('flagship fences: the database stack', () => {
	it('reports the default and the overridden primary column (guides/database.md:891-892)', () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			name: 'app',
			tables: {
				users: {
					id: stringShape(),
					name: stringShape({ min: 1 }),
					age: integerShape({ min: 0 }),
					role: literalShape(['admin', 'member', 'guest']),
					bio: optionalShape(stringShape()),
				},
				posts: { slug: stringShape(), title: stringShape() },
			},
			primary: { posts: 'slug' },
			indexes: { posts: [['title']] },
		})
		expect(db.table('users').primary).toBe('id')
		expect(db.table('posts').primary).toBe('slug')
	})

	it('stores the coerced number a numeric string parsed to (guides/database.md:1145)', async () => {
		const users = createDatabase({
			driver: createMemoryDriver(),
			tables: {
				users: {
					id: stringShape(),
					name: stringShape(),
					age: integerShape(),
					role: stringShape(),
				},
			},
		}).table('users')
		const normalized = users.contract.parse({ id: 'u2', name: 'Bo', age: '41', role: 'member' })
		if (normalized === undefined) throw new Error('Expected the row to parse')
		await users.set(normalized)
		expect((await users.get('u2'))?.age).toBe(41)
	})

	it('mints a fresh key and honours the configured generator (guides/database.md:1798, :1805)', async () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { posts: { id: optionalShape(stringShape()), title: stringShape() } },
		})
		const minted = await db.table('posts').set({ title: 'Hello' })
		expect(typeof minted).toBe('string')
		const numbered = createDatabase({
			driver: createMemoryDriver(),
			tables: { events: { id: optionalShape(integerShape()), name: stringShape() } },
			generator: () => 42,
		})
		expect(await numbered.table('events').set({ name: 'opened' })).toBe(42)
	})

	it('exports a portable definition naming its primary column (guides/database.md:1907-1909)', () => {
		const db = createDatabase({
			driver: createMemoryDriver(),
			tables: { users: { id: stringShape(), name: stringShape() } },
		})
		const exported = db.export().users
		if (exported === undefined) throw new Error('Expected the users definition')
		expect(exported.primary).toBe('id')
		expect(exported.schema).toMatchObject({ type: 'object' })
		expect(Object.keys(exported.columns)).toEqual(['id', 'name'])
	})
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })
	const surface = Array.from(
		new Map(
			normalizeDirectories(entry.source)
				.flatMap((directory) => requireDirectorySurface(directory))
				.map((symbol) => [computeSymbolKey(symbol), symbol] as const),
		).values(),
	).sort((left, right) => computeSymbolKey(left).localeCompare(computeSymbolKey(right)))

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})

		it('documents every published entry export', () => {
			expect(findMissingSymbols(surface, guide.surface())).toEqual([])
		})
		it('documents only real entry exports', () => {
			expect(findMissingSymbols(guide.surface(), surface)).toEqual([])
		})

		it('re-exports every direct declaration that is not named internal', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(computeSymbolKey)).toEqual([])
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
				.filter((symbol) => symbol.keyword === 'function')
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
				for (const { specifier, names } of extractFenceImports(fence.code)) {
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
			expect(names).not.toContain('ScopedIterator')
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
