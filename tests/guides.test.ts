// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow are this
// package's own, as is the executed section that closes the file.

import type { AdmissionInterface, Condition, TableSchema } from '@src/core'
import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The one guide this package sources, whose tagline the README pitch equals. */
const GUIDE_SPEC = 'guides/database.md'
/** The package identity that binds its manifest, module map, and README pitch. */
const PACKAGE_NAME = '@orkestrel/database'
/** Each import specifier this package's own guides may resolve against, mapped to its face. */
const MODULES = Object.freeze({
	[PACKAGE_NAME]: 'src/core',
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
 * the assertion that follows it fails when a name here stops being stranded, so the list cannot rot.
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

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md', 'package.json'],
	modules: MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, root, rows }) => {
	const { integerShape, isRecord, literalShape, optionalShape, parseJSON, stringShape } =
		await import('@orkestrel/contract')
	const { computeSymbolKey, createGuide, findMissingSymbols, normalizeDirectories } =
		await import('@orkestrel/guide')
	const { requireValue } = await import('@orkestrel/test')
	const {
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
	} = await import('@src/core')
	const { deriveIndexedDBIndexName } = await import('@src/browser')
	const {
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
	} = await import('@src/server')
	const { join, posix } = await import('node:path')
	const { checkGuideFences, deriveEntrySurfaces, tempTypeScriptProject } =
		await import('./setupServer.js')
	const { describe, expect, it } = await import('vitest')
	const own = requireValue(
		rows.find((row) => row.entry.spec === GUIDE_SPEC),
		`Missing manifest row: ${GUIDE_SPEC}`,
	)
	const manifest = parseJSON(requireValue(files['package.json'], 'Missing inventory: package.json'))
	if (!isRecord(manifest)) throw new Error('Invalid package manifest: package.json')

	it('manifest lists at least one guide', () => {
		expect(report.input).toEqual([])
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.map((row) => row.entry.spec)).toContain(GUIDE_SPEC)
		expect(own.entry.source).toEqual(['src/core', 'src/browser', 'src/server'])
	})

	// The example half of the equality case is silent over an empty population: with no
	// title on both sides `findDrift` compares no pair and the case passes on the summaries
	// alone. This pins the population this repository's own guide contributes, so removing
	// every `@example` title reddens the suite instead of quietly retiring half the gate.
	// The failure names both title sets, because a pin reporting only its own emptiness
	// leaves the reader to work out which side dropped the title.
	it('pairs at least one example title across the guide and the source', () => {
		expect(report.examples.titles.filter((finding) => finding.spec === GUIDE_SPEC)).toEqual([])
	})

	// The README's pitch and the guide's tagline are one text, each read as the blockquote
	// under its file's H1. `README.md` is outside the concept index, so the reader is
	// applied to it directly rather than through a manifest row. Each side is guarded
	// against `undefined` first, so a file that lost its blockquote reports that rather
	// than reporting two absences as agreement.
	it('opens the README with the guide tagline', () => {
		expect(manifest.name).toBe(PACKAGE_NAME)
		expect(report.pitch).toEqual([])
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
			expect(() => checkGuideFences(join(root, 'tsconfig.json'), document, fences)).toThrow(
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
			const records = [{ id: 'a', name: 'Ada', legacy: true }]
			expect(
				migrateRows(records, [{ operation: 'column.remove', table: 'users', column: 'legacy' }]),
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

	for (const { entry, guide, source } of rows) {
		describe(`${entry.concept}`, () => {
			it('uses only listed fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('extracts a non-empty documented surface', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
			})

			it('carries a summary for every documented and declared symbol', () => {
				expect(guide.surface().filter((symbol) => symbol.summary === undefined)).toEqual([])
				expect(source.surface().filter((symbol) => symbol.summary === undefined)).toEqual([])
			})

			it('re-exports every direct declaration that is not named internal', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
			})
			it('names no symbol internal that the barrel already exports', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
			})
			it('re-exports only direct declarations', () => {
				expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			})
			it('documents every barrel export', () => {
				expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
			})
			it('documents only barrel exports', () => {
				expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
			})

			it('exposes no hidden module-scope declarations', () => {
				expect(source.hidden().map(computeSymbolKey)).toEqual([])
			})

			it('documents a populated method group', () => {
				expect(report.sections.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			// The equality gate compares a `Summary` cell with its export's description paragraph
			// and a titled fence with the `@example` of that title. The command report owns the
			// comparison and names each side. Converge the selected side through an explicit
			// GuideCommand rewrite direction, never by weakening this assertion.
			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(report.examples.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
				expect(report.examples.functions.filter((finding) => finding.spec === entry.spec)).toEqual(
					[],
				)
			})

			it('documents an example for every method', () => {
				expect(report.examples.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				expect(report.imports.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('resolves every relative link', () => {
				expect(report.links.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})
			it('links only to test files that exist', () => {
				expect(report.tests.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('compiles every TypeScript fence against the published entry specifiers', () => {
				expect(() =>
					checkGuideFences(
						join(root, 'tsconfig.json'),
						requireValue(files[entry.spec], `Missing file: ${entry.spec}`),
						guide
							.fences()
							.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
							.map((fence) => fence.code),
					),
				).not.toThrow()
			}, 60_000)

			it('keeps table, query, and transaction implementations internal', () => {
				const identifiers = normalizeDirectories(entry.source).map((directory) =>
					posix.join(directory, 'index.ts'),
				)
				const surfaces = deriveEntrySurfaces(join(root, 'tsconfig.json'), identifiers)
				const names = identifiers.flatMap((identifier) =>
					requireValue(surfaces.get(identifier), `Missing compiler surface: ${identifier}`).map(
						(symbol) => symbol.name,
					),
				)
				expect(names).not.toContain('Table')
				expect(names).not.toContain('Query')
				expect(names).not.toContain('DatabaseTransaction')
				expect(names).not.toContain('ScopedIterator')
				expect(names).not.toContain('TransactionScope')
				expect(names).toContain('TableInterface')
				expect(names).toContain('QueryInterface')
				expect(source.methods('TableInterface').map((method) => method.name)).toContain('count')
				expect(source.methods('QueryInterface').map((method) => method.name)).toContain('count')
			})
		})
	}
})
