// P1: Every checked population must exist and be non-empty; absence fails instead of passing vacuously.
// P2: Required items are checked strictly; extra items are ignored before their shape is read.

import type { InlineConfig, UserConfig } from 'vite'
import type { PolicyComment, PolicyDiagnostic, PolicyExpression } from '../configs/policy.js'
import type { PolicyProject } from './setupPolicy.js'
import { spawnSync } from 'node:child_process'
import {
	closeSync,
	existsSync,
	globSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, parse, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, createServer, loadConfigFromFile, parseSync, resolveConfig } from 'vite'
import { RuleTester } from 'oxlint/plugins-dev'
import * as configHelpers from '../configs/helpers.js'
import policyPlugin, {
	CENTRAL_SOURCE_FILES,
	CLASS_RULE,
	CONSTANT_RULE,
	DATA_RULE,
	DATA_SOURCE_FILES,
	DOMAIN_RULE,
	ENDING_RULE,
	FACTORY_RULE,
	FUNCTION_RULE,
	FUNCTION_SOURCE_FILES,
	HIDDEN_RULE,
	LET_RULE,
	MOCKING_RULE,
	MUTABLE_RULE,
	NESTED_RULE,
	PARSER_RULE,
	PLUGIN_RULE,
	POLICY_BANNED_TERMS,
	POLICY_ENDING_GLOBS,
	POLICY_JUDGED_TERMS,
	POLICY_NESTED_GLOBS,
	POLICY_PLACEMENT_GLOBS,
	POLICY_SCRIPT_GLOBS,
	POLICY_VOICE_STOPWORDS,
	PRIVACY_RULE,
	SCRIPT_RULE,
	TERM_RULE,
	TYPE_RULE,
	VOICE_RULE,
	VUE_IMPORT_RULE,
	blankPolicyText,
	commentToPolicyParagraph,
	computePolicyTarget,
	isPolicyVoiced,
	nodeToPolicyOuter,
	paragraphToPolicyOpener,
	programToPolicyDocs,
	reportDomain,
	statementToPolicyBindings,
	stripPolicyCode,
	textToPolicyHits,
} from '../configs/policy.js'
import configuration, { resolveWorkspacePath } from '../vite.config.js'
import * as rootConfiguration from '../vite.config.js'
import tsconfig from '../tsconfig.json' with { type: 'json' }
import {
	COMPUTED_IMPORT_PATHS,
	collectSheets,
	collectStudies,
	collectFrameworks,
	readConfigRecord,
	readConfigScript,
	collectFaceWrappers,
	inspectSheetConfiguration,
	readSheetPrelude,
	SHEET_POLICY_BARREL_PATTERN,
	SHEET_POLICY_ORDER_PATTERN,
	readImportDiagnostics,
	readNativeDiagnostics,
	createPolicyComment,
	createPolicyContext,
	createPolicyDeclarator,
	createPolicyExport,
	createPolicyLazyCases,
	createPolicyRefused,
	createPolicyScratch,
	createPolicySource,
	createPolicySparse,
	inspectPolicyConfiguration,
	inspectPolicyWiring,
	normalizePolicyFilename,
	POLICY_EXTRACTOR,
	POLICY_IMPORT_CASES,
	POLICY_LAZY_SHAPES,
	POLICY_NAME_CASES,
	POLICY_PUBLISHES,
	POLICY_ROOT,
	POLICY_WIRING_SETTINGS,
	POLICY_VUE_COMPOSABLE_SOURCE,
	POLICY_VUE_RELATIVE_SOURCES,
	POLICY_VUE_TARGET_CASES,
	POLICY_VUE_FACES,
	POLICY_VUE_UNCLASSIFIED_FILES,
	POLICY_VUE_IMPORT_FORMS,
	POLICY_VUE_POPULATIONS,
	POLICY_VUE_IMPORT_CASES,
	POLICY_VUE_BOUNDARY_CASES,
	POLICY_VUE_COMPUTED_CASES,
	POLICY_VUE_COMPUTED_FORMS,
	POLICY_VUE_PARSER_ROWS,
	POLICY_VUE_PARSER_CASES,
	POLICY_VUE_PARSED_CASES,
	POLICY_VUE_ORIGINAL_RELATIVES,
	POLICY_VUE_DOMAIN_CASES,
} from './setupPolicy.js'
import { describe, expect, it } from 'vitest'

describe('selected faces', () => {
	it('collects each selected sheet proof from the effective project root and rejects a wrong root', async () => {
		for (const face of collectSheets(POLICY_ROOT)) {
			const proofs = resolve(POLICY_ROOT, 'tests/src', face)
			if (!existsSync(proofs)) continue
			const wrapper = resolve(POLICY_ROOT, `configs/src/vite.${face}.config.ts`)
			const loaded = await loadConfigFromFile(
				{ command: 'serve', mode: 'test' },
				wrapper,
				POLICY_ROOT,
				'silent',
			)
			if (loaded === null) throw new Error(`Unloaded wrapper ${wrapper}`)
			const project = loaded.config
			const include = project.test?.include
			if (include === undefined) throw new Error(`Missing sheet include ${face}`)
			// Vitest roots a file project at its wrapper directory unless test.root overrides it.
			const directory = resolve(
				POLICY_ROOT,
				project.test?.root ?? dirname(wrapper),
				project.test?.dir || '.',
			)
			const collected = globSync(include, { cwd: directory }).map((path) =>
				resolve(directory, path),
			)
			const expected = [
				resolve(proofs, 'index.test.ts'),
				...(face === 'styles' && existsSync(resolve(proofs, 'themes/index.test.ts'))
					? [resolve(proofs, 'themes/index.test.ts')]
					: []),
			]
			expect(collected).toEqual(expect.arrayContaining(expected))
			const control = globSync(include, { cwd: dirname(wrapper) }).map((path) =>
				resolve(dirname(wrapper), path),
			)
			expect(control).toEqual([])
			expect(() => expect(control).toEqual(expect.arrayContaining(expected))).toThrow('expected')
		}
	})

	it('enumerates markers independently of wrappers and detects a deleted wrapper', () => {
		const fixture = createPolicyScratch({ prefix: 'propagation-faces-' })
		const scratch = fixture.path
		try {
			expect(collectSheets(scratch)).toEqual([])
			expect(collectFrameworks(scratch)).toEqual([])
			for (const path of [
				'src/paper/index.scss',
				'src/paper/sheet.ts',
				'src/incomplete/index.scss',
				'src/vue/index.ts',
				'app/vue/index.ts',
			]) {
				mkdirSync(dirname(resolve(scratch, path)), { recursive: true })
				writeFileSync(resolve(scratch, path), '')
			}
			expect(collectSheets(scratch)).toEqual(['paper'])
			expect(collectFrameworks(scratch)).toEqual(['src/vue', 'app/vue'])
			for (const path of [
				'configs/src/vite.paper.config.ts',
				'configs/src/vite.vue.config.ts',
				'configs/app/vite.vue.config.ts',
			]) {
				mkdirSync(dirname(resolve(scratch, path)), { recursive: true })
				writeFileSync(resolve(scratch, path), '')
			}
			expect(collectFaceWrappers(scratch)).toContain('configs/src/vite.paper.config.ts')
			rmSync(resolve(scratch, 'configs/src/vite.paper.config.ts'))
			expect(() => collectFaceWrappers(scratch)).toThrow(
				'Missing wrapper configs/src/vite.paper.config.ts',
			)
			expect(collectSheets(scratch)).toContain('paper')
		} finally {
			fixture.destroy()
		}
	})

	it('collects study tests by exact case, nested or direct, and nothing a lookalike supplies', () => {
		// Each lookalike gets its own workspace, because a host that folds case writes
		// `tests/Studies/adapter.test.ts` into an existing `tests/studies` directory.
		const lookalikes = [
			['no tests directory', []],
			['a types module alone', ['tests/studies/types.ts']],
			['the harness module alone', ['tests/setupStudy.ts']],
			['a root studies directory alone', ['studies/adapter.test.ts']],
			['a case-folded directory', ['tests/Studies/adapter.test.ts']],
			['a test of another suffix', ['tests/studies/adapter.test.js']],
			['a studies entry that is a file', ['tests/studies']],
			[
				'a test inside a nested node_modules',
				['tests/studies/fixture/node_modules/kit/index.test.ts'],
			],
			['a test inside a .git directory', ['tests/studies/fixture/.git/hooks/index.test.ts']],
		] as const
		for (const [label, paths] of lookalikes) {
			const fixture = createPolicyScratch({ prefix: 'config-studies-lookalike-' })
			try {
				for (const path of paths) fixture.write(path, '')
				expect({ label, studies: collectStudies(fixture.path) }).toEqual({ label, studies: [] })
			} finally {
				fixture.destroy()
			}
		}
		const fixture = createPolicyScratch({ prefix: 'config-studies-' })
		try {
			for (const path of [
				'tests/studies/types.ts',
				'tests/studies/memory/deep/adapter.test.ts',
				'tests/studies/session.test.ts',
				'tests/studies/memory/adapter.test.js',
				'src/core/index.ts',
			])
				fixture.write(path, '')
			expect(collectStudies(fixture.path)).toEqual([
				'tests/studies/memory/deep/adapter.test.ts',
				'tests/studies/session.test.ts',
			])
		} finally {
			fixture.destroy()
		}
	})

	it('loads each selected sheet and framework wrapper and checks its packaging and browser project', async () => {
		const manifest = readConfigRecord(
			JSON.parse(readFileSync(resolve(POLICY_ROOT, 'package.json'), 'utf8')),
		)
		const scripts = readConfigRecord(manifest.scripts)
		const sheets = collectSheets(POLICY_ROOT)
		const frameworks = collectFrameworks(POLICY_ROOT)
		const wrappers = collectFaceWrappers(POLICY_ROOT)
		const configurations: Array<{
			readonly axis: string
			readonly face: string
			readonly wrapper: string
			readonly project: UserConfig
		}> = []
		for (const sheet of sheets) expect(wrappers).toContain(`configs/src/vite.${sheet}.config.ts`)
		for (const face of frameworks)
			expect(wrappers).toContain(`configs/${face.replace('/', '/vite.')}.config.ts`)
		for (const wrapper of wrappers) {
			const loaded = await loadConfigFromFile(
				{ command: 'build', mode: 'test' },
				resolve(POLICY_ROOT, wrapper),
				POLICY_ROOT,
				'silent',
			)
			if (loaded === null) throw new Error(`Unloaded wrapper ${wrapper}`)
			const match = /^configs\/(src|app)\/vite\.([^.]+)\.config\.ts$/u.exec(wrapper)
			const axis = match?.[1]
			const face = match?.[2]
			if (axis === undefined || face === undefined) throw new Error(`Invalid wrapper ${wrapper}`)
			const project = loaded.config
			expect(project.test?.include).toContain(`tests/${axis}/${face}/**/*.test.ts`)
			expect(project.test?.browser).toMatchObject({
				enabled: true,
				instances: expect.arrayContaining([
					expect.objectContaining({ browser: 'chromium', name: `${axis}:${face} (chromium)` }),
				]),
			})
			expect(project.optimizeDeps?.include).toEqual(
				expect.arrayContaining(['@orkestrel/test', '@orkestrel/test/browser']),
			)
			expect(
				Object.getOwnPropertyDescriptor(tsconfig.compilerOptions.paths, `@${axis}/${face}`)?.value,
			).toEqual([`./${axis}/${face}/index.ts`])
			configurations.push({ axis, face, wrapper, project })
		}
		for (const { face, wrapper, project } of configurations.filter((faceConfiguration) =>
			sheets.includes(faceConfiguration.face),
		)) {
			expect(readFileSync(resolve(POLICY_ROOT, wrapper), 'utf8')).toContain('sheetProject(')
			expect(inspectSheetConfiguration(project)).toEqual([])
			const exports = readConfigRecord(manifest.exports)
			expect(exports[`./${face}`]).toBe(`./dist/src/${face}/index.css`)
			expect(exports[`./${face}/scss`]).toBe(`./src/${face}/index.scss`)
			expect(manifest.files).toContain(`src/${face}/**/*.scss`)
			expect(manifest.sideEffects).toEqual(expect.arrayContaining(['**/*.css', '**/*.scss']))
			expect(readConfigScript(scripts, `test:src:${face}`)).toContain(
				`npm run build:src:${face} &&`,
			)
			expect(readConfigScript(scripts, 'build:src')).toContain(`npm run build:src:${face}`)
		}
		for (const { project } of configurations.filter((faceConfiguration) =>
			frameworks.includes(`${faceConfiguration.axis}/${faceConfiguration.face}`),
		)) {
			expect(project.optimizeDeps?.include).toContain('vue')
			expect(project.test?.setupFiles).toEqual(
				expect.arrayContaining(['./tests/setup.ts', './tests/setupBrowser.ts']),
			)
		}
		for (const { wrapper } of configurations.filter(
			(faceConfiguration) =>
				faceConfiguration.axis === 'src' &&
				frameworks.includes(`${faceConfiguration.axis}/${faceConfiguration.face}`),
		)) {
			const text = readFileSync(resolve(POLICY_ROOT, wrapper), 'utf8')
			expect(text).toContain('rewriteCoreSpecifier')
			expect(text).toContain('rewriteBrowserSpecifier')
		}
		if (!existsSync(resolve(POLICY_ROOT, 'src/styles/themes/index.scss'))) return
		const loaded = await loadConfigFromFile(
			{ command: 'build', mode: 'test' },
			resolve(POLICY_ROOT, 'configs/src/vite.themes.config.ts'),
			POLICY_ROOT,
			'silent',
		)
		if (loaded === null) throw new Error('Unloaded themes wrapper')
		expect(loaded.config.build?.outDir).toBe('dist/src/styles/themes')
		const barrel = readFileSync(resolve(POLICY_ROOT, 'src/styles/themes/index.scss'), 'utf8')
		expect(readSheetPrelude(barrel)).toMatch(SHEET_POLICY_BARREL_PATTERN)
		expect(
			readSheetPrelude(readFileSync(resolve(POLICY_ROOT, 'src/styles/_tokens.scss'), 'utf8')),
		).toMatch(SHEET_POLICY_ORDER_PATTERN)
		const target = sheets.includes('styles') ? 'styles' : 'themes'
		const command = sheets.includes('styles')
			? 'vite build --config configs/src/vite.styles.config.ts && vite build --config configs/src/vite.themes.config.ts'
			: 'vite build --config configs/src/vite.themes.config.ts'
		expect(readConfigScript(scripts, `build:src:${target}`)).toBe(command)
		expect(readConfigScript(scripts, 'build:src')).toContain(`npm run build:src:${target}`)
	})

	it('detects missing sheet setup and reversed themes order in configuration data', () => {
		const project = {
			test: {
				setupFiles: ['./tests/setup.ts', './tests/setupBrowser.ts', './tests/setupStyles.ts'],
				isolate: false,
			},
		}
		const script =
			'vite build --config configs/src/vite.styles.config.ts && vite build --config configs/src/vite.themes.config.ts'
		const scratch = createPolicyScratch({ prefix: 'config-sheet-setup-' })
		const withoutStyles = {
			test: { ...project.test, setupFiles: ['./tests/setup.ts', './tests/setupBrowser.ts'] },
		}
		try {
			expect(inspectSheetConfiguration(withoutStyles, script, scratch.path)).toEqual([])
			scratch.write('tests/setupStyles.ts', 'export {}\n')
			expect(inspectSheetConfiguration(project, script, scratch.path)).toEqual([])
			expect(inspectSheetConfiguration(withoutStyles, script, scratch.path)).toContain(
				'./tests/setupStyles.ts',
			)
			expect(
				inspectSheetConfiguration(
					project,
					script.split(' && ').reverse().join(' && '),
					scratch.path,
				),
			).toContain('themes order')
		} finally {
			scratch.destroy()
		}
	})

	it('resolves showcase and journey modes for every occupied application', async () => {
		const applications = [
			'browser',
			...collectFrameworks(POLICY_ROOT)
				.filter((face) => face.startsWith('app/'))
				.map((face) => face.slice(4)),
		]
		const manifest = readConfigRecord(
			JSON.parse(readFileSync(resolve(POLICY_ROOT, 'package.json'), 'utf8')),
		)
		const scripts = readConfigRecord(manifest.scripts)
		const factories = readConfigRecord(rootConfiguration)
		const showcases = ['configs/app/vite.showcase.config.ts'].filter(
			(path) =>
				existsSync(resolve(POLICY_ROOT, path)) || existsSync(resolve(POLICY_ROOT, 'showcase')),
		)
		for (const showcase of showcases) {
			const wrapper = readFileSync(
				resolve(POLICY_ROOT, 'configs/app/vite.showcase.config.ts'),
				'utf8',
			)
			expect(wrapper).toContain('defineConfig(({ mode }) => appShowcase(mode))')
			expect(wrapper).not.toContain('dist/showcase')
			expect(
				readFileSync(resolve(POLICY_ROOT, '.prettierignore'), 'utf8').split(/\r\n|\n/u),
			).toContain('showcase/')
			for (const application of applications) {
				const script = 'build:showcase' + (application === 'browser' ? '' : ':' + application)
				expect(readConfigScript(scripts, script)).toContain('configs/app/vite.showcase.config.ts')
				for (const chain of manifest.private === true
					? []
					: [readConfigScript(scripts, 'prepublishOnly')]) {
					expect(chain).toContain(`npm run ${script}`)
					expect(chain.indexOf('npm run build &&')).toBeLessThan(chain.indexOf(`npm run ${script}`))
				}
				const loaded = await loadConfigFromFile(
					{ command: 'build', mode: application },
					resolve(POLICY_ROOT, showcase),
					POLICY_ROOT,
					'silent',
				)
				if (loaded === null) throw new Error('Unloaded showcase wrapper')
				const output = loaded.config.build?.outDir
				if (output === undefined) throw new Error('Missing showcase output')
				expect(relative(POLICY_ROOT, output)).toBe('showcase')
				expect(() =>
					expect(relative(POLICY_ROOT, resolve(POLICY_ROOT, 'dist/showcase'))).toBe('showcase'),
				).toThrow('expected')
				expect(loaded.config.build?.emptyOutDir).toBe(false)
			}
			expect(scripts.show).toBeUndefined()
		}
		if (!existsSync(resolve(POLICY_ROOT, 'configs/app/vite.journey.config.ts'))) return
		for (const application of applications) {
			const loaded = await loadConfigFromFile(
				{ command: 'serve', mode: application },
				resolve(POLICY_ROOT, 'configs/app/vite.journey.config.ts'),
				POLICY_ROOT,
				'silent',
			)
			if (
				loaded === null ||
				!Array.isArray(loaded.config.test?.projects) ||
				loaded.config.test.projects.length === 0
			)
				throw new Error('Missing journey projects')
			// Each awaited factory appends the variant it provides and the variants it declares.
			const provided: Array<{ readonly variant: string; readonly names: readonly string[] }> = []
			for (const factory of loaded.config.test.projects) {
				if (typeof factory !== 'function') throw new Error('Missing journey factory')
				const project = readConfigRecord(
					await Reflect.apply(factory, undefined, [{ command: 'serve', mode: application }]),
				)
				const test = readConfigRecord(project.test)
				expect(test.include).toEqual([`tests/app/${application}/integration.test.ts`])
				expect(test.exclude).toEqual([])
				const provide = readConfigRecord(test.provide)
				if (typeof provide.variant !== 'string' || !Array.isArray(provide.variants))
					throw new Error('Missing journey variant values')
				provided.push({
					variant: provide.variant,
					names: provide.variants.map((value: unknown) => {
						const variant = readConfigRecord(value)
						if (typeof variant.name !== 'string') throw new Error('Unnamed journey variant')
						return variant.name
					}),
				})
				const selected = provide.variants
					.map(readConfigRecord)
					.find((variant) => variant.name === provide.variant)
				if (selected === undefined) throw new Error('Missing selected variant')
				expect(readConfigRecord(test.browser).viewport).toEqual({
					width: selected.width,
					height: selected.height,
				})
				expect(readConfigRecord(test.browser).instances).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							browser: 'chromium',
							name: `journey:${provide.variant} (chromium)`,
						}),
					]),
				)
				expect(typeof provide.capture).toBe('boolean')
				expect(readConfigRecord(project.optimizeDeps).include).toEqual(
					expect.arrayContaining(['@orkestrel/test', '@orkestrel/test/browser']),
				)
			}
			expect(new Set(provided.map(({ variant }) => variant))).toEqual(
				new Set(provided.flatMap(({ names }) => names)),
			)
		}
		// The runner loads the wrapper beside this file's own root configuration, so every journey
		// project's record and the commands module's export are one object graph. A wrapper can
		// add commands of its own; it keeps every command the module registers.
		const registered = (
			await Promise.all(
				Object.values(import.meta.glob<unknown>('../configs/commands.ts')).map((load) => load()),
			)
		).map((module) => readConfigRecord(readConfigRecord(module).commands))
		const wrappers = await Promise.all(
			Object.values(
				import.meta.glob<unknown>('../configs/app/vite.journey.config.ts', { import: 'default' }),
			).map((load) => load()),
		)
		expect(wrappers).toHaveLength(1)
		for (const wrapper of wrappers) {
			if (typeof wrapper !== 'function') throw new Error('Missing journey wrapper factory')
			for (const application of applications) {
				// Vite accepts an async config factory, so the wrapper's result is awaited like each project's.
				const composed = readConfigRecord(
					await Reflect.apply(wrapper, undefined, [{ command: 'serve', mode: application }]),
				)
				const projects = readConfigRecord(composed.test).projects
				if (!Array.isArray(projects) || projects.length === 0)
					throw new Error('Missing journey projects')
				for (const project of projects) {
					if (typeof project !== 'function') throw new Error('Missing journey factory')
					const held = readConfigRecord(
						readConfigRecord(
							readConfigRecord(
								readConfigRecord(
									await Reflect.apply(project, undefined, [
										{ command: 'serve', mode: application },
									]),
								).test,
							).browser,
						).commands,
					)
					for (const commands of registered) {
						for (const [key, command] of Object.entries(commands)) expect(held[key]).toBe(command)
					}
				}
			}
		}
		const factory = factories.appJourney
		if (typeof factory !== 'function') throw new Error('Missing application journey')
		expect(() =>
			Reflect.apply(factory, undefined, [
				{ name: 'desktop', width: 1280, height: 800 },
				[],
				'absent',
			]),
		).toThrow('not declared')
	})

	it('collects both browser setup proofs and optimizes every selected browser factory', async () => {
		const factories = readConfigRecord(rootConfiguration)
		const manifest = readConfigRecord(
			JSON.parse(readFileSync(resolve(POLICY_ROOT, 'package.json'), 'utf8')),
		)
		const dependencies = {
			...readConfigRecord(manifest.dependencies ?? {}),
			...readConfigRecord(manifest.devDependencies ?? {}),
		}
		// The runner loads the module this file's root configuration imports, so each factory's
		// record and the module's export are one object graph.
		const registered = (
			await Promise.all(
				Object.values(import.meta.glob<unknown>('../configs/commands.ts')).map((load) => load()),
			)
		).map((module) => readConfigRecord(readConfigRecord(module).commands))
		// The configuration bundle carries `configs/commands.ts` into every load, builds included,
		// and leaves an alias it cannot resolve as a bare package import. The module therefore
		// imports only a `node:` module or a declared package, and loads workspace source inside a
		// command. The control carries both refused forms.
		const control =
			"import { GREETING } from '@src/core'\nexport * from '../src/server/index.js'\nimport { join } from 'node:path'\nimport type { BrowserConfigOptions } from 'vitest/node'\n"
		for (const [path, text, refused] of [
			['control', control, ['@src/core', '../src/server/index.js']],
			...['configs/commands.ts']
				.filter((module) => existsSync(resolve(POLICY_ROOT, module)))
				.map((module) => [module, readFileSync(resolve(POLICY_ROOT, module), 'utf8'), []] as const),
		] as const) {
			const specifiers = parseSync('commands.ts', text).program.body.flatMap((statement) =>
				statement.type === 'ImportDeclaration' ||
				statement.type === 'ExportAllDeclaration' ||
				(statement.type === 'ExportNamedDeclaration' && statement.source !== null)
					? [statement.source?.value ?? '']
					: [],
			)
			expect({
				path,
				refused: specifiers.filter(
					(specifier) =>
						!specifier.startsWith('node:') &&
						!Object.hasOwn(
							dependencies,
							specifier
								.split('/')
								.slice(0, specifier.startsWith('@') ? 2 : 1)
								.join('/'),
						),
				),
			}).toStrictEqual({ path, refused })
		}
		for (const name of [
			'srcBrowser',
			'appBrowser',
			'srcVue',
			'appVue',
			'setupBrowser',
			'sheetProject',
			'integration',
		]) {
			const factory = factories[name]
			if (typeof factory !== 'function') continue
			const project = readConfigRecord(
				Reflect.apply(factory, undefined, name === 'sheetProject' ? ['src:styles'] : []),
			)
			const test = readConfigRecord(project.test)
			if (readConfigRecord(test.browser ?? {}).enabled !== true) continue
			const label = typeof test.name === 'string' ? test.name : readConfigRecord(test.name).label
			expect(readConfigRecord(test.browser).instances).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ browser: 'chromium', name: `${label} (chromium)` }),
				]),
			)
			const include = readConfigRecord(project.optimizeDeps).include
			expect(include).toEqual(
				expect.arrayContaining([
					'@orkestrel/test',
					'@orkestrel/test/browser',
					...(dependencies['@orkestrel/contract'] === undefined ? [] : ['@orkestrel/contract']),
				]),
			)
			for (const commands of registered) {
				const held = readConfigRecord(readConfigRecord(test.browser).commands)
				for (const [key, command] of Object.entries(commands)) expect(held[key]).toBe(command)
			}
		}
		for (const proof of ['tests/setupBrowser.test.ts', 'tests/setupStyles.test.ts'].filter((path) =>
			existsSync(resolve(POLICY_ROOT, path)),
		)) {
			const factory = factories.setupBrowser
			if (typeof factory !== 'function') throw new Error('Missing browser setup project')
			expect(
				readConfigRecord(readConfigRecord(Reflect.apply(factory, undefined, [])).test).include,
			).toContain(proof)
			expect(
				readConfigRecord(readConfigRecord(Reflect.apply(factory, undefined, [])).test).include,
			).toEqual(expect.arrayContaining(['tests/setupBrowser.test.ts', 'tests/setupStyles.test.ts']))
		}
		if (typeof factories.setup !== 'function') return
		expect(
			readConfigRecord(readConfigRecord(Reflect.apply(factories.setup, undefined, [])).test)
				.exclude,
		).toEqual(expect.arrayContaining(['tests/setupBrowser.test.ts', 'tests/setupStyles.test.ts']))
	})
})

describe('root configuration', () => {
	it('resolves every declared alias to its real entry', () => {
		const aliases = configuration.resolve?.alias
		if (typeof aliases !== 'object' || aliases === null || Array.isArray(aliases)) {
			throw new Error('The root configuration carries no alias record')
		}
		const required = new Map<string, string>([
			...['src', 'app'].flatMap((axis) =>
				['core', 'browser', 'server'].flatMap((environment): Array<[string, string]> => {
					const path = `${axis}/${environment}/index.ts`
					return existsSync(resolve(POLICY_ROOT, path)) ? [[`@${axis}/${environment}`, path]] : []
				}),
			),
			...collectSheets(POLICY_ROOT).map((face): [string, string] => [
				`@src/${face}`,
				`src/${face}/index.ts`,
			]),
			...collectFrameworks(POLICY_ROOT).map((face): [string, string] => [
				`@${face}`,
				`${face}/index.ts`,
			]),
		])
		const declared = new Map(Object.entries(tsconfig.compilerOptions.paths))
		expect(
			required.size > 0 || existsSync(resolve(POLICY_ROOT, 'src/styles/themes/sheet.ts')),
		).toBe(true)
		if (required.size === 0) {
			if (declared.size !== 0 || Object.keys(aliases).length !== 0)
				throw new Error('The themes-only workspace declares an unexpected alias')
			return
		}
		const absent = new Map<string, readonly string[]>()
		expect(() => {
			for (const key of required.keys()) {
				if (!absent.has(key)) throw new Error('The alias population carries no required entry')
			}
		}).toThrow('The alias population carries no required entry')
		for (const [key, expected] of required) {
			const values = declared.get(key)
			if (values === undefined) throw new Error(`${key} is not declared`)
			const [path] = values
			if (path === undefined) throw new Error(`${key} carries no target`)
			const target = resolveWorkspacePath(path)
			expect(existsSync(target)).toBe(true)
			expect(target).toBe(resolve(POLICY_ROOT, expected))
			expect(Object.getOwnPropertyDescriptor(aliases, key)?.value).toBe(target)
		}
	})

	it('registers every workspace project with its fixed include and setup files', () => {
		const browserProofs = ['tests/setupBrowser.test.ts', 'tests/setupStyles.test.ts']
		const setupProofs = globSync('tests/setup*.test.ts', { cwd: POLICY_ROOT })
			.map((path) => path.replaceAll('\\', '/'))
			.filter((path) => /^tests\/setup[^/]*\.test\.ts$/u.test(path))
		const expected = new Map<string, PolicyProject>([
			// Each row is a project label, the path whose presence selects it, its include, and its setup.
			...(
				[
					['src:core', 'src/core', 'tests/src/core/**/*.test.ts', ['./tests/setup.ts']],
					[
						'src:browser',
						'src/browser',
						'tests/src/browser/**/*.test.ts',
						['./tests/setup.ts', './tests/setupBrowser.ts'],
					],
					[
						'src:server',
						'src/server',
						'tests/src/server/**/*.test.ts',
						['./tests/setup.ts', './tests/setupServer.ts'],
					],
					[
						'src:bin',
						'src/bin',
						'tests/src/bin/**/*.test.ts',
						['./tests/setup.ts', './tests/setupServer.ts'],
					],
					['app:core', 'app/core', 'tests/app/core/**/*.test.ts', ['./tests/setup.ts']],
					[
						'app:browser',
						'app/browser',
						'tests/app/browser/**/*.test.ts',
						['./tests/setup.ts', './tests/setupBrowser.ts'],
					],
					[
						'app:server',
						'app/server',
						'tests/app/server/**/*.test.ts',
						['./tests/setup.ts', './tests/setupServer.ts'],
					],
					// The `configs/agents/tsconfig.skills.json` wrapper selects the `skills` blueprint fact, and the
					// project it registers runs the mirrored proofs under `tests/agents/`.
					[
						'skills',
						'configs/agents/tsconfig.skills.json',
						'tests/agents/**/*.test.ts',
						['./tests/setup.ts'],
					],
				] as const
			)
				.filter(([, path]) => existsSync(resolve(POLICY_ROOT, path)))
				.map(([label, , include, setup]): [string, PolicyProject] => [label, { include, setup }]),
			...['policy', 'config', 'guides', 'conformance', 'tree', 'distribution', 'integration']
				.filter((label) => readdirSync(resolve(POLICY_ROOT, 'tests')).includes(`${label}.test.ts`))
				.map((label): [string, PolicyProject] => [
					label,
					{
						include: `tests/${label}.test.ts`,
						setup: [
							'./tests/setup.ts',
							...(label === 'conformance' || label === 'tree' ? ['./tests/setupServer.ts'] : []),
							...(label === 'integration' &&
							(collectSheets(POLICY_ROOT).length > 0 ||
								existsSync(resolve(POLICY_ROOT, 'src/styles/themes/index.scss')))
								? [
										'./tests/setupBrowser.ts',
										...(existsSync(resolve(POLICY_ROOT, 'tests/setupStyles.ts'))
											? ['./tests/setupStyles.ts']
											: []),
									]
								: []),
						],
					},
				]),
			...(setupProofs.some((path) => !browserProofs.includes(path))
				? [
						['setup', { include: 'tests/setup*.test.ts', setup: ['./tests/setup.ts'] }] satisfies [
							string,
							PolicyProject,
						],
					]
				: []),
			...(setupProofs.some((path) => browserProofs.includes(path))
				? [
						[
							'setup:browser',
							{ include: browserProofs, setup: ['./tests/setup.ts', './tests/setupBrowser.ts'] },
						] satisfies [string, PolicyProject],
					]
				: []),
			// The live-service project covers a directory rather than one proof, so its
			// readiness module is the fact that selects it. A suite beneath
			// `tests/service` with no setup module is a project nothing configures.
			...(existsSync(resolve(POLICY_ROOT, 'tests/setupService.ts'))
				? [
						[
							'service',
							{
								include: 'tests/service/**/*.test.ts',
								setup: ['./tests/setup.ts', './tests/setupService.ts'],
							},
						] satisfies [string, PolicyProject],
					]
				: []),
			// The study project covers a directory too, and the exact-case test files beneath
			// `tests/studies` select it, outside any `node_modules` or `.git` directory, which Vitest's
			// default exclude never collects. `tests/setupStudy.ts` is a harness module those tests import
			// and no project loads it as a setup file, so the setup list names `tests/setup.ts` alone.
			...(collectStudies(POLICY_ROOT).length > 0
				? [
						[
							'studies',
							{ include: 'tests/studies/**/*.test.ts', setup: ['./tests/setup.ts'] },
						] satisfies [string, PolicyProject],
					]
				: []),
			[
				'probe',
				{
					benchmark: ['tmp/probes/**/*.bench.ts', 'tests/**/*.bench.ts'],
					include: 'tmp/probes/**/*.test.ts',
					parallel: false,
					pool: 'threads',
					setup: ['./tests/setup.ts'],
				},
			],
			// A row that is a configuration rather than a factory. Every generated
			// workspace registers the factory itself, so this shape is required by the
			// expectation rather than observed: the proof exercises that resolution wherever it runs
			// instead of only where a hand-written configuration happens to produce it.
			['concrete', { include: 'tests/concrete.test.ts', setup: ['./tests/setup.ts'] }],
		])

		const projects = configuration.test?.projects
		if (!Array.isArray(projects)) throw new Error('The root configuration carries no projects')
		const extraLoads: string[] = []
		const control = Object.defineProperty(
			() => {
				extraLoads.push('control')
				return {
					test: {
						name: { label: 'control' },
						include: ['tests/control.test.ts', 'tests/control.integration.test.ts'],
						setupFiles: ['./tests/setup.ts'],
					},
				}
			},
			'name',
			{ value: 'control' },
		)
		const concrete = {
			test: {
				name: { label: 'concrete' },
				include: ['tests/concrete.test.ts'],
				setupFiles: ['./tests/setup.ts'],
			},
		}
		const controlled = projects.concat(control, concrete)
		const configured = new Map(
			[...expected].map(([requiredLabel]): [string, PolicyProject] => {
				const factoryName = requiredLabel.replace(/:([a-z])/gu, (_match, letter: string) =>
					letter.toUpperCase(),
				)
				// A row is either the factory named for the project or the configuration
				// that project resolves to, and a required project is found as whichever
				// it is. Only the required row is read, so an extra factory is still
				// selected by name and never called.
				const row = controlled.find((candidate) => {
					if (typeof candidate === 'function') return candidate.name === factoryName
					if (typeof candidate !== 'object' || candidate === null) return false
					const block: unknown = Object.getOwnPropertyDescriptor(candidate, 'test')?.value
					if (typeof block !== 'object' || block === null) return false
					const named: unknown = Object.getOwnPropertyDescriptor(block, 'name')?.value
					if (typeof named !== 'object' || named === null) return false
					return Object.getOwnPropertyDescriptor(named, 'label')?.value === requiredLabel
				})
				if (row === undefined) {
					throw new Error(`${requiredLabel} has no project factory or configuration`)
				}
				const project: unknown = typeof row === 'function' ? Reflect.apply(row, undefined, []) : row
				if (typeof project !== 'object' || project === null) {
					throw new Error('A project factory returned no configuration')
				}
				const test: unknown = Object.getOwnPropertyDescriptor(project, 'test')?.value
				if (typeof test !== 'object' || test === null) {
					throw new Error('A project configuration carries no test block')
				}
				const name: unknown = Object.getOwnPropertyDescriptor(test, 'name')?.value
				const include: unknown = Object.getOwnPropertyDescriptor(test, 'include')?.value
				const exclude: unknown = Object.getOwnPropertyDescriptor(test, 'exclude')?.value
				const setup: unknown = Object.getOwnPropertyDescriptor(test, 'setupFiles')?.value
				const label =
					typeof name === 'object' && name !== null
						? Object.getOwnPropertyDescriptor(name, 'label')?.value
						: undefined
				if (
					typeof label !== 'string' ||
					!Array.isArray(include) ||
					typeof include[0] !== 'string' ||
					!Array.isArray(setup) ||
					!setup.every((path) => typeof path === 'string')
				) {
					throw new Error('A project does not expose one include and its setup files')
				}
				const effective = include.filter(
					(path) =>
						typeof path === 'string' && (!Array.isArray(exclude) || !exclude.includes(path)),
				)
				if (
					effective.length !== (label === 'setup:browser' ? 2 : 1) ||
					typeof effective[0] !== 'string'
				) {
					throw new Error(`${label} does not resolve to its required includes`)
				}
				for (const required of label === 'setup' ? browserProofs : [])
					expect(exclude).toContain(required)
				if (label === 'probe') {
					const benchmark: unknown = Object.getOwnPropertyDescriptor(test, 'benchmark')?.value
					const parallel: unknown = Object.getOwnPropertyDescriptor(test, 'fileParallelism')?.value
					const pool: unknown = Object.getOwnPropertyDescriptor(test, 'pool')?.value
					if (typeof benchmark !== 'object' || benchmark === null) {
						throw new Error('The probe project carries no benchmark block')
					}
					const benchmarkInclude: unknown = Object.getOwnPropertyDescriptor(
						benchmark,
						'include',
					)?.value
					if (
						!Array.isArray(benchmarkInclude) ||
						!benchmarkInclude.every((path) => typeof path === 'string') ||
						typeof parallel !== 'boolean' ||
						typeof pool !== 'string'
					) {
						throw new Error('The probe project carries an invalid benchmark configuration')
					}
					return [
						label,
						{
							benchmark: benchmarkInclude,
							include: effective[0],
							parallel,
							pool,
							setup: [...new Set(setup)],
						},
					]
				}
				return [
					label,
					{
						include: label === 'setup:browser' ? effective : effective[0],
						setup: [...new Set(setup)],
					},
				]
			}),
		)

		// Required projects come from present source and test paths. Each factory is selected by name
		// before its result is read. Extra factories are ignored without validating their result shape.
		expect(extraLoads).toStrictEqual([])
		for (const [label, project] of expected) expect(configured.get(label)).toStrictEqual(project)
		for (const label of ['setup', 'setup:browser', 'tree']) {
			const name = label === 'setup:browser' ? 'setupBrowser' : label
			expect(projects.some((entry) => typeof entry === 'function' && entry.name === name)).toBe(
				expected.has(label),
			)
			if (!expected.has(label)) continue
			const missingSetup = new Map(configured)
			missingSetup.delete(label)
			expect(() => expect(missingSetup.get(label)).toStrictEqual(expected.get(label))).toThrow(
				'expected',
			)
		}

		const missing = new Map(configured)
		expect(missing.delete('probe')).toBe(true)
		expect(() => {
			for (const [label, project] of expected) expect(missing.get(label)).toStrictEqual(project)
		}).toThrow(/strictly equal/u)

		const misconfigured = new Map(configured)
		const probe = misconfigured.get('probe')
		if (probe === undefined) throw new Error('The configured projects carry no probe control')
		misconfigured.set('probe', { ...probe, setup: ['./tests/setupServer.ts'] })
		expect(() => {
			for (const [label, project] of expected)
				expect(misconfigured.get(label)).toStrictEqual(project)
		}).toThrow(/strictly equal/u)
	})

	it('loads file projects and returns only the invocation mode from registered project factories', async () => {
		const projects = configuration.test?.projects
		if (!Array.isArray(projects)) throw new Error('The root configuration carries no projects')
		if (projects.length === 0) throw new Error('The root configuration registers no project')
		// Vitest calls each registered factory with its invocation record, whose `mode` is the
		// `--mode` value, and runs a project that declares no `mode` in its own run mode, `test`.
		// `prepublishOnly` runs the distribution proof with `--mode release`, and that proof fails
		// rather than skips only when it reads `release`, so every project returns the record's
		// `mode` and none of the record's other fields. The sentinel mode is a value no factory
		// declares, so only a forwarded mode reads it. The controls are the ways a row misses
		// that: a factory that ignores the record, one that spreads it whole, and an inline
		// entry, which Vitest never calls.
		const invocation = {
			command: 'serve',
			isPreview: true,
			isSsrBuild: true,
			mode: 'sentinel-mode',
			sentinel: true,
		}
		const test = { name: { label: 'control' }, include: ['tests/control.test.ts'] }
		const ignoreInput = Object.defineProperty(() => ({ test }), 'name', { value: 'ignoring' })
		const spreadInput = Object.defineProperty((record: object) => ({ ...record, test }), 'name', {
			value: 'spreading',
		})
		const wrappers = projects.filter((entry) => typeof entry === 'string')
		const sheets = collectSheets(POLICY_ROOT)
		const expectedWrappers = [
			...sheets.map((face) => `./configs/src/vite.${face}.config.ts`),
			...(!sheets.includes('styles') &&
			existsSync(resolve(POLICY_ROOT, 'src/styles/themes/index.scss'))
				? ['./configs/src/vite.themes.config.ts']
				: []),
		]
		expect([...wrappers].sort()).toEqual(expectedWrappers.sort())
		for (const wrapper of wrappers) {
			const loaded = await loadConfigFromFile(
				{ command: 'serve', mode: invocation.mode },
				resolve(POLICY_ROOT, wrapper),
				POLICY_ROOT,
				'silent',
			)
			if (loaded === null) throw new Error(`Unloaded file project ${wrapper}`)
			const face = /^\.\/configs\/src\/vite\.([^.]+)\.config\.ts$/u.exec(wrapper)?.[1]
			if (face === undefined) throw new Error(`Invalid file project ${wrapper}`)
			expect(loaded.config.test?.name).toMatchObject({ label: `src:${face}` })
			expect(loaded.config.test?.include).toEqual([
				`tests/src/${face === 'themes' ? 'styles/themes' : face}/**/*.test.ts`,
			])
			expect(() =>
				expect({ test: {} }).toMatchObject({ test: { name: { label: `src:${face}` } } }),
			).toThrow('expected')
		}
		const factories = projects.filter((entry) => typeof entry !== 'string')
		const entries: readonly unknown[] = [...factories, ignoreInput, spreadInput, { test }]
		const outcomes = entries.map((entry) => {
			if (typeof entry !== 'function') {
				return { name: undefined, callable: false, mode: undefined, leaked: [] }
			}
			const project: unknown = Reflect.apply(entry, undefined, [invocation])
			if (typeof project !== 'object' || project === null) {
				throw new Error(`The project factory ${entry.name} returned no configuration`)
			}
			return {
				name: entry.name,
				callable: true,
				mode: Object.getOwnPropertyDescriptor(project, 'mode')?.value,
				leaked: Object.keys(invocation).filter(
					(field) => field !== 'mode' && Object.hasOwn(project, field),
				),
			}
		})
		const forwarded = { callable: true, mode: 'sentinel-mode', leaked: [] }
		expect(outcomes.slice(0, factories.length)).toStrictEqual(
			factories.map((entry) => ({
				name: typeof entry === 'function' ? entry.name : undefined,
				...forwarded,
			})),
		)
		expect(outcomes.slice(factories.length)).toStrictEqual([
			{ name: 'ignoring', callable: true, mode: undefined, leaked: [] },
			{
				name: 'spreading',
				callable: true,
				mode: 'sentinel-mode',
				leaked: ['command', 'isPreview', 'isSsrBuild', 'sentinel'],
			},
			{ name: undefined, callable: false, mode: undefined, leaked: [] },
		])
		for (const outcome of outcomes.slice(factories.length)) {
			expect({ ...outcome, name: undefined }).not.toStrictEqual({ name: undefined, ...forwarded })
		}

		// A record that carries no string `mode` is refused rather than forwarded as a project
		// with no mode, which would run in `test` again.
		for (const entry of projects) {
			if (typeof entry !== 'function') continue
			expect(() => Reflect.apply(entry, undefined, [{ ...invocation, mode: undefined }])).toThrow(
				'The project invocation carries no string mode',
			)
		}
	})

	it('requires and validates every selected target wrapper', async () => {
		const required = [
			...['src', 'app'].flatMap((axis) =>
				['core', 'browser', 'server'].flatMap((environment) =>
					existsSync(resolve(POLICY_ROOT, axis, environment))
						? [
								`configs/${axis}/tsconfig.${environment}.json`,
								...(axis === 'src' || environment !== 'core'
									? [`configs/${axis}/vite.${environment}.config.ts`]
									: []),
							]
						: [],
				),
			),
			...collectFrameworks(POLICY_ROOT).map(
				(face) => `configs/${face.replace('/', '/tsconfig.')}.json`,
			),
			...(existsSync(resolve(POLICY_ROOT, 'src/bin'))
				? ['configs/src/tsconfig.bin.json', 'configs/src/vite.bin.config.ts']
				: []),
			...(existsSync(resolve(POLICY_ROOT, 'configs/app/vite.showcase.config.ts'))
				? ['configs/app/vite.showcase.config.ts']
				: []),
			...(existsSync(resolve(POLICY_ROOT, 'configs/app/vite.journey.config.ts'))
				? ['configs/app/vite.journey.config.ts']
				: []),
		]
		if (required[0] === undefined) {
			throw new Error('The workspace selects no configuration target')
		}
		const found = globSync(
			[
				'configs/src/vite.*.config.ts',
				'configs/app/vite.*.config.ts',
				'configs/src/tsconfig.*.json',
				'configs/app/tsconfig.*.json',
			],
			{ cwd: POLICY_ROOT },
		).map((path) => path.replaceAll('\\', '/'))
		const extra = 'configs/app/vite.core.config.ts'
		const planted = createPolicyScratch({ prefix: 'config-journey-' })
		const journey = 'configs/app/vite.journey.config.ts'
		planted.write(
			journey,
			`export default {
	test: { projects: [() => ({
		test: {
			name: { label: 'journey:desktop' },
			include: ['tests/app/browser/integration.test.ts'],
			exclude: [],
			setupFiles: ['./tests/setup.ts', './tests/setupBrowser.ts'],
			provide: { variant: 'desktop', variants: [{ name: 'desktop', width: 1280, height: 800 }], capture: false },
			browser: { enabled: true, instances: [{ browser: 'chromium', headless: true }] },
		},
	})] },
}\n`,
		)
		const journeys: object[][] = []
		const targets = [
			...required.map((wrapper) => ({ wrapper, directory: POLICY_ROOT })),
			{ wrapper: journey, directory: planted.path },
		]
		const controlled = [...found, extra, journey]

		// Required wrappers come from selected src/app targets. Only that set is loaded and validated.
		// Extra wrappers remain in the found population but are ignored before their content is read.
		expect(controlled).toContain(extra)
		expect(required).not.toContain(extra)
		try {
			for (const { wrapper, directory } of targets) {
				expect(controlled).toContain(wrapper)
				const viteMatch =
					/^configs\/(src|app)\/vite\.(core|browser|server|bin|showcase|journey)\.config\.ts$/u.exec(
						wrapper,
					)
				if (viteMatch !== null) {
					const [, axis, environment] = viteMatch
					if (axis === undefined || environment === undefined) {
						throw new Error(`${wrapper} carries no target`)
					}
					const loaded = await loadConfigFromFile(
						{ command: 'build', mode: 'test', isSsrBuild: false, isPreview: false },
						resolve(directory, wrapper),
						directory,
						'silent',
					)
					if (loaded === null) throw new Error(`${wrapper} did not load`)
					if (environment === 'journey') {
						const projects = loaded.config.test?.projects
						if (!Array.isArray(projects) || projects.length === 0) {
							throw new Error(`${wrapper} carries no journey projects`)
						}
						const tests: object[] = []
						for (const factory of projects) {
							if (typeof factory !== 'function')
								throw new Error(`${wrapper} carries no project factory`)
							const project: unknown = await Reflect.apply(factory, undefined, [
								{ command: 'serve', mode: 'test' },
							])
							if (typeof project !== 'object' || project === null)
								throw new Error('A journey project is not a configuration')
							const test: unknown = Object.getOwnPropertyDescriptor(project, 'test')?.value
							if (typeof test !== 'object' || test === null)
								throw new Error('A journey project carries no test block')
							tests.push(test)
						}
						journeys.push(tests)
						continue
					}
					const output = loaded.config.build?.outDir
					if (output === undefined) throw new Error(`${wrapper} carries no output`)
					const expected =
						environment === 'bin'
							? 'dist/bin'
							: environment === 'showcase'
								? 'showcase'
								: `dist/${axis}/${environment}`
					if (resolve(POLICY_ROOT, output) !== resolve(POLICY_ROOT, expected)) {
						throw new Error(`${wrapper} resolves to the wrong output`)
					}
					continue
				}

				const tsconfigMatch =
					/^configs\/(src|app)\/tsconfig\.(core|browser|server|bin|vue)\.json$/u.exec(wrapper)
				if (tsconfigMatch === null) {
					throw new Error(`${wrapper} is not a required target wrapper`)
				}
				const [, axis, environment] = tsconfigMatch
				if (axis === undefined || environment === undefined) {
					throw new Error(`${wrapper} carries no TypeScript scope`)
				}
				const parsed: unknown = JSON.parse(readFileSync(resolve(POLICY_ROOT, wrapper), 'utf8'))
				if (typeof parsed !== 'object' || parsed === null) {
					throw new Error(`${wrapper} is not a TypeScript configuration record`)
				}
				const compilerOptions: unknown = Object.getOwnPropertyDescriptor(
					parsed,
					'compilerOptions',
				)?.value
				if (typeof compilerOptions !== 'object' || compilerOptions === null) {
					throw new Error(`${wrapper} carries no compiler options`)
				}
				const lib: unknown = Object.getOwnPropertyDescriptor(compilerOptions, 'lib')?.value
				const types: unknown = Object.getOwnPropertyDescriptor(compilerOptions, 'types')?.value
				const expectedLib =
					environment === 'core'
						? ['ESNext', 'WebWorker']
						: environment === 'browser' || environment === 'vue'
							? ['ESNext', 'DOM', 'DOM.Iterable']
							: ['ESNext']
				const expectedTypes =
					environment === 'core'
						? []
						: environment === 'browser' || environment === 'vue'
							? axis === 'app' && environment === 'vue'
								? ['vite/client', 'vue']
								: ['vite/client']
							: ['node']
				expect(lib).toStrictEqual(expectedLib)
				expect(types).toStrictEqual(expectedTypes)
				for (const control of axis === 'app' && environment === 'vue' ? [['vite/client']] : []) {
					expect(() => expect(control).toStrictEqual(expectedTypes)).toThrow('expected')
				}
			}
			for (const tests of journeys) {
				const names = tests.map((test) => {
					expect(Object.getOwnPropertyDescriptor(test, 'include')?.value).toStrictEqual([
						'tests/app/browser/integration.test.ts',
					])
					expect(Object.getOwnPropertyDescriptor(test, 'exclude')?.value).toStrictEqual([])
					expect(Object.getOwnPropertyDescriptor(test, 'setupFiles')?.value).toStrictEqual([
						'./tests/setup.ts',
						'./tests/setupBrowser.ts',
					])
					const name: unknown = Object.getOwnPropertyDescriptor(test, 'name')?.value
					const provide: unknown = Object.getOwnPropertyDescriptor(test, 'provide')?.value
					const browser: unknown = Object.getOwnPropertyDescriptor(test, 'browser')?.value
					if (
						typeof name !== 'object' ||
						name === null ||
						typeof provide !== 'object' ||
						provide === null ||
						typeof browser !== 'object' ||
						browser === null
					)
						throw new Error('A journey project carries no name, provide, or browser block')
					const variant: unknown = Object.getOwnPropertyDescriptor(provide, 'variant')?.value
					if (typeof variant !== 'string' || variant.length === 0)
						throw new Error('A journey project carries no variant name')
					expect(Object.getOwnPropertyDescriptor(name, 'label')?.value).toBe(`journey:${variant}`)
					expect(typeof Object.getOwnPropertyDescriptor(provide, 'capture')?.value).toBe('boolean')
					expect(Object.getOwnPropertyDescriptor(browser, 'enabled')?.value).toBe(true)
					const variants: unknown = Object.getOwnPropertyDescriptor(provide, 'variants')?.value
					if (
						!Array.isArray(variants) ||
						!variants.some(
							(candidate: unknown) =>
								typeof candidate === 'object' &&
								candidate !== null &&
								Object.getOwnPropertyDescriptor(candidate, 'name')?.value === variant,
						)
					)
						throw new Error('A journey variant is absent from its declared set')
					return variant
				})
				expect(new Set(names).size).toBe(names.length)
			}
		} finally {
			planted.destroy()
		}

		const controlRequired = [
			'configs/app/vite.browser.config.ts',
			'configs/app/vite.server.config.ts',
		]
		const controlFound = ['configs/app/vite.server.config.ts']
		expect(() => {
			for (const wrapper of controlRequired) expect(controlFound).toContain(wrapper)
		}).toThrow(/vite\.browser/u)
		expect(() =>
			expect(resolve(POLICY_ROOT, 'dist/actual')).toBe(resolve(POLICY_ROOT, 'dist/control')),
		).toThrow(/expected/u)
	})

	// A target with a server application builds it to one `main.cjs`, so a
	// single-executable embed has one file to take. The real wrapper's configuration
	// builds a scratch entry that dynamically imports a scratch module, once as the
	// wrapper declares it and once with splitting forced on. The second build is the
	// control: it shows the single chunk comes from the wrapper's `codeSplitting` option
	// and not from the entry's shape. Evaluation order of the inlined module is proved
	// once, by executing the emitted file, in the template proof that stages a server
	// root. A workspace without an `app/server` has no wrapper to build, so this case
	// reports nothing about the server application of a target that has one: the
	// assertion below only classifies the absence, and each target with a server
	// application establishes this proof when its own configuration test runs.
	it('builds the application server wrapper to one entry and splits it under the control', async () => {
		const wrapper = resolve(POLICY_ROOT, 'configs/app/vite.server.config.ts')
		const present = existsSync(wrapper)
		expect(present || !existsSync(resolve(POLICY_ROOT, 'app/server'))).toBe(true)
		if (!present) return
		const scratch = createPolicyScratch({
			parent: resolve(POLICY_ROOT, 'app/server'),
			prefix: 'config-server-entry-',
		})
		try {
			scratch.write(
				'index.ts',
				"process.stdout.write('entry\\n')\nvoid import('./lazy.js').then(({ lazy }) => process.stdout.write(lazy()))\nprocess.stdout.write('after\\n')\n",
			)
			scratch.write(
				'lazy.ts',
				"process.stdout.write('lazy\\n')\nexport function lazy(): string {\n\treturn String(process.argv.length)\n}\n",
			)
			const rosters: Array<readonly string[]> = []
			for (const chunked of [false, true]) {
				const loaded = await loadConfigFromFile(
					{ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false },
					wrapper,
					POLICY_ROOT,
					'silent',
				)
				if (loaded === null) throw new Error('The server wrapper did not load')
				const rolldown = loaded.config.build?.rolldownOptions
				const output: unknown = rolldown?.output
				if (typeof output !== 'object' || output === null || Array.isArray(output)) {
					throw new Error('The server wrapper declares no output options')
				}
				expect(Object.getOwnPropertyDescriptor(output, 'codeSplitting')?.value).toBe(false)
				const built = await build({
					...loaded.config,
					root: POLICY_ROOT,
					configFile: false,
					logLevel: 'silent',
					build: {
						...loaded.config.build,
						write: false,
						lib: {
							entry: resolve(scratch.path, 'index.ts'),
							formats: ['cjs'],
							fileName: () => 'main.cjs',
						},
						rolldownOptions: chunked
							? { ...rolldown, output: { codeSplitting: true } }
							: { ...rolldown },
					},
				})
				// A library build returns one result per format, an array even for one format.
				const results = Array.isArray(built) ? built : [built]
				expect(results).toHaveLength(1)
				for (const result of results) {
					if (!('output' in result)) throw new Error('The server build returned no output')
					rosters.push(result.output.map(({ fileName }) => fileName).toSorted())
				}
			}
			const [single, split] = rosters
			expect(single).toStrictEqual(['main.cjs'])
			expect(split).toContain('main.cjs')
			expect(split?.length).toBeGreaterThan(1)
		} finally {
			scratch.destroy()
		}
	})

	it('registers proof scripts in the correct gate', () => {
		const manifest: unknown = JSON.parse(readFileSync(resolve(POLICY_ROOT, 'package.json'), 'utf8'))
		if (typeof manifest !== 'object' || manifest === null) {
			throw new Error('The package manifest is not a record')
		}
		const scripts: unknown = Object.getOwnPropertyDescriptor(manifest, 'scripts')?.value
		if (typeof scripts !== 'object' || scripts === null) {
			throw new Error('The package manifest carries no scripts')
		}
		const manifestPublishes = Object.getOwnPropertyDescriptor(manifest, 'private')?.value !== true
		const test = Object.getOwnPropertyDescriptor(scripts, 'test')?.value
		const config = Object.getOwnPropertyDescriptor(scripts, 'test:config')?.value
		const distribution = Object.getOwnPropertyDescriptor(scripts, 'test:distribution')?.value
		const integration = Object.getOwnPropertyDescriptor(scripts, 'test:integration')?.value
		const conformance = Object.getOwnPropertyDescriptor(scripts, 'test:conformance')?.value
		const tree = Object.getOwnPropertyDescriptor(scripts, 'test:tree')?.value
		const service = Object.getOwnPropertyDescriptor(scripts, 'test:service')?.value
		const studies = Object.getOwnPropertyDescriptor(scripts, 'test:studies')?.value
		const publish = Object.getOwnPropertyDescriptor(scripts, 'prepublishOnly')?.value
		const hasIntegration = existsSync(resolve(POLICY_ROOT, 'tests/integration.test.ts'))
		// The optional proofs are read off the registered project set rather than off
		// their files, because the defect this measures is a registered project no
		// gate runs. A project selected by a path that is not yet there is still
		// registered, and it is exactly the one whose script goes missing.
		const rows = configuration.test?.projects
		if (!Array.isArray(rows)) throw new Error('The root configuration carries no projects')
		const registered = new Set(
			rows.flatMap((row) => {
				if (typeof row === 'function') return [row.name]
				if (typeof row !== 'object' || row === null) return []
				const block: unknown = Object.getOwnPropertyDescriptor(row, 'test')?.value
				if (typeof block !== 'object' || block === null) return []
				const named: unknown = Object.getOwnPropertyDescriptor(block, 'name')?.value
				if (typeof named !== 'object' || named === null) return []
				const label: unknown = Object.getOwnPropertyDescriptor(named, 'label')?.value
				return typeof label === 'string' ? [label] : []
			}),
		)
		// The population must be able to answer both ways before either answer counts.
		expect(registered.has('config')).toBe(true)
		expect(registered.has('control')).toBe(false)
		const hasConformance = registered.has('conformance')
		const hasTree = registered.has('tree')
		const hasDistribution = registered.has('distribution')
		const hasService = registered.has('service')
		const hasStudies = registered.has('studies')
		expect(config).toBe(
			'vitest run --config vite.config.ts --no-cache --reporter=dot --project config',
		)
		expect(typeof test === 'string' && test.includes('npm run test:config')).toBe(true)
		expect(distribution).toBe(
			hasDistribution
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project distribution'
				: undefined,
		)
		expect(typeof test === 'string' && test.includes('test:distribution')).toBe(false)
		expect(typeof publish === 'string' && publish.includes('npm run test:distribution')).toBe(
			hasDistribution && manifestPublishes,
		)
		expect(typeof publish === 'string').toBe(manifestPublishes)
		expect(integration).toBe(
			hasIntegration
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project integration'
				: undefined,
		)
		// The integration seed composes barrels and starts no process, so it runs in
		// `test` like any other hermetic proof. `prepublishOnly` reaches it through
		// `npm test` rather than through a second direct invocation.
		expect(typeof test === 'string' && test.includes('npm run test:integration')).toBe(
			hasIntegration,
		)
		expect(typeof publish === 'string' && publish.includes('npm run test:integration')).toBe(false)
		// A registered project no gate runs is a proof that never executes, and it
		// never fails, so the suite reports green while carrying it. Conformance is
		// hermetic and belongs to `test`. A publishing workspace isolates the
		// live-service project in `prepublishOnly`; a private workspace reaches it
		// from `test`, because npm never runs a private package's publish lifecycle.
		expect(conformance).toBe(
			hasConformance
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project conformance'
				: undefined,
		)
		expect(typeof test === 'string' && test.includes('npm run test:conformance')).toBe(
			hasConformance,
		)
		expect(tree).toBe(
			hasTree
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project tree'
				: undefined,
		)
		expect(typeof test === 'string' && test.includes('npm run test:tree')).toBe(hasTree)
		expect(typeof publish === 'string' && publish.includes('npm run test:tree')).toBe(false)
		expect(service).toBe(
			hasService
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project service'
				: undefined,
		)
		expect(typeof test === 'string' && test.includes('npm run test:service')).toBe(
			hasService && !manifestPublishes,
		)
		expect(typeof publish === 'string' && publish.includes('npm run test:service')).toBe(
			hasService && manifestPublishes,
		)
		// The study proof spawns processes, so it follows the same split as the live-service proof:
		// the publish gate of a publishing workspace runs it after `npm test` and before the release
		// proof, and a private workspace reaches it from `test`.
		expect(studies).toBe(
			hasStudies
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project studies'
				: undefined,
		)
		expect(typeof test === 'string' && test.includes('npm run test:studies')).toBe(
			hasStudies && !manifestPublishes,
		)
		expect(typeof publish === 'string' && publish.includes('npm run test:studies')).toBe(
			hasStudies && manifestPublishes,
		)
		const steps = ['npm test &&', 'npm run test:studies', 'npm run test:distribution']
		const positions = typeof publish === 'string' ? steps.map((step) => publish.indexOf(step)) : []
		const sequenced = positions.every((position, index) => position > (positions[index - 1] ?? -1))
		expect(sequenced || !(hasStudies && hasDistribution && manifestPublishes)).toBe(true)
	})

	it('rebuilds publishing workspaces before packing', () => {
		const manifest: unknown = JSON.parse(readFileSync(resolve(POLICY_ROOT, 'package.json'), 'utf8'))
		if (typeof manifest !== 'object' || manifest === null) {
			throw new Error('The package manifest is not a record')
		}
		const scripts: unknown = Object.getOwnPropertyDescriptor(manifest, 'scripts')?.value
		if (typeof scripts !== 'object' || scripts === null) {
			throw new Error('The package manifest carries no scripts')
		}
		const manifestPublishes = Object.getOwnPropertyDescriptor(manifest, 'private')?.value !== true
		const prepack = Object.getOwnPropertyDescriptor(scripts, 'prepack')?.value
		expect(prepack).toBe(manifestPublishes ? 'npm run build' : undefined)

		const controlled = { ...scripts, prepack: 'npm run control' }
		expect(() => {
			const control = Object.getOwnPropertyDescriptor(controlled, 'prepack')?.value
			expect(control).toBe(manifestPublishes ? 'npm run build' : undefined)
		}).toThrow(/expected/u)
	})

	it('keeps the committed host inventory aligned with the vendored checkout bytes', async () => {
		// Run this gate against a quiescent checkout. It compares two reads and cannot
		// distinguish stale committed data from a source edit made while it runs.
		const packageValue: unknown = JSON.parse(
			readFileSync(resolve(POLICY_ROOT, 'package.json'), 'utf8'),
		)
		if (typeof packageValue !== 'object' || packageValue === null) {
			throw new Error('The package manifest is not a record')
		}
		const scripts: unknown = Object.getOwnPropertyDescriptor(packageValue, 'scripts')?.value
		if (typeof scripts !== 'object' || scripts === null) {
			throw new Error('The package manifest carries no scripts')
		}
		const generator: unknown = Object.getOwnPropertyDescriptor(scripts, 'build:inventory')?.value
		expect(generator === undefined || typeof generator === 'string').toBe(true)
		if (generator === undefined) {
			if (existsSync(resolve(POLICY_ROOT, 'host.json'))) {
				throw new Error('A committed host inventory exists without a generator')
			}
			return
		}
		if (typeof generator !== 'string') {
			throw new Error('The host inventory generator is not a script')
		}
		const committed = resolve(POLICY_ROOT, 'host.json')
		if (!existsSync(committed)) {
			throw new Error('The committed host inventory is absent at host.json')
		}
		const helper = resolve(POLICY_ROOT, 'src/server/helpers.ts')
		if (!existsSync(helper)) {
			throw new Error('The committed host inventory has no server stager')
		}
		const server = await createServer({
			configFile: false,
			root: POLICY_ROOT,
			...(configuration.resolve === undefined ? {} : { resolve: configuration.resolve }),
			server: { middlewareMode: true },
		})
		try {
			const loaded: unknown = await server.ssrLoadModule(helper)
			if (typeof loaded !== 'object' || loaded === null) {
				throw new Error('The server helper module did not load')
			}
			const stage: unknown = Reflect.get(loaded, 'stageInventory')
			if (typeof stage !== 'function') {
				throw new Error('The server helper module exports no stageInventory function')
			}
			const scratch = createPolicyScratch({ prefix: 'host-inventory-' })
			const workspace = scratch.path
			try {
				const generated = join(workspace, 'host.json')
				Reflect.apply(stage, undefined, [POLICY_ROOT, generated])
				const generatedText = readFileSync(generated, 'utf8')
				const committedText = readFileSync(committed, 'utf8')
				const values: readonly unknown[] = [JSON.parse(generatedText), JSON.parse(committedText)]
				const indexes = values.map((value) => {
					if (typeof value !== 'object' || value === null) {
						throw new Error('A host inventory is not a record')
					}
					const entries: unknown = Object.getOwnPropertyDescriptor(value, 'entries')?.value
					if (!Array.isArray(entries)) throw new Error('A host inventory carries no entry list')
					return new Map(
						entries.map((entry: unknown): [string, string] => {
							if (typeof entry !== 'object' || entry === null) {
								throw new Error('A host inventory carries a malformed entry')
							}
							const destination: unknown = Object.getOwnPropertyDescriptor(
								entry,
								'destination',
							)?.value
							const digest: unknown = Object.getOwnPropertyDescriptor(entry, 'digest')?.value
							if (typeof destination !== 'string' || typeof digest !== 'string') {
								throw new Error('A host inventory entry carries no destination digest')
							}
							return [destination, digest]
						}),
					)
				})
				const generatedIndex = indexes[0]
				const committedIndex = indexes[1]
				if (generatedIndex === undefined || committedIndex === undefined) {
					throw new Error('The host inventories were not indexed')
				}
				if (generatedText !== committedText) {
					const stale = [
						...[...generatedIndex].flatMap(([destination, digest]) =>
							committedIndex.get(destination) === digest ? [] : [destination],
						),
						...[...committedIndex.keys()].filter((destination) => !generatedIndex.has(destination)),
					]
					throw new Error(
						`The committed host inventory is stale at ${stale.length > 0 ? stale.toSorted().join(', ') : 'host.json'}`,
					)
				}
				console.info(`host-inventory: entries=${generatedIndex.size}`)
			} finally {
				scratch.destroy()
			}
		} finally {
			await server.close()
		}
	})

	it('keeps policy rules active across every linted workspace path', () => {
		const parsed: unknown = JSON.parse(readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
		expect(inspectPolicyConfiguration(parsed)).toEqual([])
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('The Oxlint configuration is not a record')
		}
		const controlled = structuredClone(parsed)
		const overrides: unknown = Object.getOwnPropertyDescriptor(controlled, 'overrides')?.value
		if (!Array.isArray(overrides)) throw new Error('The Oxlint configuration has no overrides')
		Object.defineProperty(controlled, 'overrides', {
			value: overrides.concat({
				files: ['src/**'],
				rules: { 'policy/no-mocking': 'off' },
			}),
			enumerable: true,
			configurable: true,
			writable: true,
		})
		expect(inspectPolicyConfiguration(controlled)).toEqual([
			'overrides must not configure policy/no-mocking',
		])
		// The skill scripts sit under .agents, so an ignore pattern that reaches the folder defeats the
		// script rules as an ignore of a source root defeats the placement rules.
		const ignored = structuredClone(parsed)
		Object.defineProperty(ignored, 'ignorePatterns', {
			value: ['.orkestrel/', '.agents/skills/'],
			enumerable: true,
			configurable: true,
			writable: true,
		})
		expect(inspectPolicyConfiguration(ignored)).toEqual([
			'ignorePatterns must not reach .agents/skills/',
		])
		// An entry without an inner slash matches at any depth, so a glob or a directory name the
		// overrides route through silences guarded files while its first segment names no root.
		for (const pattern of ['*.ts', 'scripts', 'scripts/', 'policy.ts']) {
			expect(
				inspectPolicyConfiguration({ ...readConfigRecord(parsed), ignorePatterns: [pattern] }),
			).toEqual([`ignorePatterns must not reach ${pattern}`])
		}
		for (const patterns of [['.orkestrel/'], ['.orkestrel/', '!src/keep.ts'], ['./scripts']]) {
			expect(
				inspectPolicyConfiguration({ ...readConfigRecord(parsed), ignorePatterns: patterns }),
			).toEqual([])
		}
	})

	it('refuses a wiring rule whose options weaken it beneath an error severity', () => {
		const parsed: unknown = JSON.parse(readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
		const rules = readConfigRecord(readConfigRecord(parsed).rules)
		for (const [rule, setting] of [
			['typescript/explicit-member-accessibility', ['error', { accessibility: 'off' }]],
			['typescript/parameter-properties', ['error', { allow: ['private readonly'] }]],
			['no-var', ['error', { ignore: true }]],
		] as const) {
			expect(
				inspectPolicyConfiguration({
					...readConfigRecord(parsed),
					rules: { ...rules, [rule]: setting },
				}),
			).toEqual([
				`${rule} must have the top-level setting ${JSON.stringify(POLICY_WIRING_SETTINGS[rule])}`,
			])
		}
	})

	it('omits the audit-confirmed dead policy type exports', () => {
		const source = readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8')
		expect(source).not.toMatch(/\bPolicy(?:Call|ClassMember)\b/u)
	})
})

describe('policy plugin', () => {
	RuleTester.describe = describe
	RuleTester.it = it

	const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
	tester.run('no-cross-vue-face', VUE_IMPORT_RULE, {
		valid: [...POLICY_VUE_IMPORT_CASES, ...POLICY_VUE_BOUNDARY_CASES, ...POLICY_VUE_COMPUTED_CASES]
			.filter((source) => source.path.endsWith('.ts') && !source.boundary)
			.map((source) => ({
				name: `accepts the native relative boundary in ${source.path}`,
				filename: resolve(POLICY_ROOT, source.path),
				cwd: POLICY_ROOT,
				code: source.content,
			})),
		invalid: [
			...POLICY_VUE_IMPORT_CASES,
			...POLICY_VUE_BOUNDARY_CASES,
			...POLICY_VUE_UNCLASSIFIED_FILES.map((path) => ({
				path,
				content: "import './entry.js'\ndebugger\n",
				boundary: true,
				restricted: false,
			})),
		]
			.filter((source) => source.path.endsWith('.ts') && source.boundary)
			.map((source) => ({
				name: `rejects the native relative boundary in ${source.path} [membership: literal relative import or export outside permitted Vue destinations]`,
				filename: resolve(POLICY_ROOT, source.path),
				cwd: POLICY_ROOT,
				code: source.content,
				errors: [{ messageId: 'vue' }],
			})),
	})

	tester.run('no-mocking', MOCKING_RULE, {
		valid: [
			{ name: 'accepts recorders', code: 'createRecorder()' },
			{ name: 'accepts non-framework members', code: "registry.mock('./x')" },
			{ name: 'accepts unlisted framework members', code: 'vi.clearAllMocks()' },
		],
		invalid: [
			{
				name: 'rejects module mocking [membership: named vi and jest module APIs]',
				code: "vi.mock('./x')",
				errors: [{ messageId: 'mock' }],
			},
			{
				name: 'rejects computed module mocking [membership: named vi and jest module APIs]',
				code: `vi['mock']('./x')`,
				errors: [{ messageId: 'mock' }],
			},
			{
				name: 'rejects template module mocking [membership: named vi and jest module APIs]',
				code: `vi[\`mock\`]('./x')`,
				errors: [{ messageId: 'mock' }],
			},
			{
				name: 'rejects spy factories [membership: named vi and jest spy APIs]',
				code: 'jest.fn()',
				errors: [{ messageId: 'spy' }],
			},
			{
				name: 'rejects fake clocks [membership: named vi and jest clock APIs]',
				code: 'vi.useFakeTimers()',
				errors: [{ messageId: 'clock' }],
			},
			{
				name: 'rejects environment stubs [membership: named vi and jest stub APIs]',
				code: "vi.stubEnv('A', '1')",
				errors: [{ messageId: 'stub' }],
			},
		],
	})

	tester.run('no-keyword-privacy', PRIVACY_RULE, {
		valid: [
			{ name: 'accepts runtime-private fields', code: 'class Example { #value = 1 }' },
			{
				name: 'accepts unannotated members',
				code: 'class Example { value = 1; read() { return this.value } }',
			},
		],
		invalid: [
			{
				name: 'rejects private properties [membership: keyword-annotated class members]',
				code: 'class Example { private value = 1 }',
				errors: [{ messageId: 'keyword' }],
			},
			{
				name: 'rejects private methods [membership: keyword-annotated class members]',
				code: 'class Example { private read() { return 1 } }',
				errors: [{ messageId: 'keyword' }],
			},
			{
				name: 'rejects protected properties [membership: keyword-annotated class members]',
				code: 'class Example { protected value = 1 }',
				errors: [{ messageId: 'keyword' }],
			},
			{
				name: 'rejects protected methods [membership: keyword-annotated class members]',
				code: 'class Example { protected read() { return 1 } }',
				errors: [{ messageId: 'keyword' }],
			},
		],
	})

	tester.run('no-let', LET_RULE, {
		valid: [
			{ name: 'leaves an unwritten let to prefer-const', code: 'let value = 1\nread(value)' },
			{
				name: 'leaves an unwritten for-of head to prefer-const',
				code: 'for (let entry of entries) read(entry)',
			},
			{
				name: 'leaves an unwritten for-in head to prefer-const',
				code: 'for (let key in record) read(key)',
			},
			{ name: 'accepts const', code: 'const value = 1\nread(value)' },
			{ name: 'leaves var to no-var', code: 'var value\nvalue = 1' },
			{ name: 'accepts an ambient let', code: 'declare let value: number' },
			{
				name: 'accepts a let in a global augmentation',
				code: 'declare global { let ambient: number }',
			},
			{
				name: 'accepts an exported let in a declared module',
				code: "declare module 'm' { export let ambient: string }",
			},
			{
				name: 'accepts a let in a declared namespace',
				code: 'declare namespace Ambient { let value: number }',
			},
			{
				name: 'accepts a let in a namespace nested in a declared module',
				code: "declare module 'm' { namespace Inner { let value: number } }",
			},
		],
		invalid: [
			...[
				{ form: 'assignment', code: 'let count = 0\ncount = 1' },
				{ form: 'compound assignment', code: 'let count = 0\ncount += 1' },
				{ form: 'logical assignment', code: 'let count: number | undefined = 0\ncount ??= 1' },
				{ form: 'update', code: 'let count = 0\ncount++' },
				{ form: 'counter loop', code: 'for (let index = 0; index < 3; index++) read(index)' },
				{ form: 'array destructuring target', code: 'let [first] = [1]\n;[first] = [2]' },
				{ form: 'object destructuring target', code: 'let { a } = record\n;({ a } = other)' },
				{
					form: 'for-of head written in the body',
					code: 'for (let entry of entries) { entry = 1 }',
				},
				{ form: 'closure write', code: 'let ready = false\nlisten(() => { ready = true })' },
				{ form: 'later declarator', code: 'let a = 1, b = 2\nb = 3\nread(a, b)' },
				{ form: 'declaration without a value', code: 'let value\nread(value)' },
				{ form: 'value assigned later', code: 'let value: number\nvalue = 1\nread(value)' },
			].map(({ form, code }) => ({
				name: `rejects a let by ${form} [membership: let that prefer-const leaves]`,
				code,
				errors: [{ messageId: 'let' }],
			})),
			...[
				{
					form: 'a bare let beside a global augmentation',
					code: 'declare global { let ambient: number }\nlet value\nread(value)',
				},
				{
					form: 'a reassigned let beside a declared module',
					code: "declare module 'm' { export let ambient: string }\nlet count = 0\ncount++",
				},
				{
					form: 'a bare let in a namespace that is not declared',
					code: 'namespace Local { let value: number }',
				},
			].map(({ form, code }) => ({
				name: `rejects ${form} [membership: let outside an ambient block]`,
				code,
				errors: [{ messageId: 'let' }],
			})),
		],
	})

	tester.run('no-nested-functions', NESTED_RULE, {
		valid: [
			{
				name: 'accepts a module-scope function',
				code: 'function projectValue() { return 1 }',
			},
			{
				name: 'accepts an anonymous callback passed directly',
				code: 'function projectValues() { return values.map((value) => value + 1) }',
			},
			{
				name: 'accepts an anonymous arrow returned directly',
				code: 'function createProjector() { return () => 1 }',
			},
			{
				name: 'accepts callbacks in a returned object literal',
				code: [
					'function reportNode(context, node) { context.report({ node }) }',
					'const RULE = {',
					'create(context) {',
					'return { CallExpression: (node) => reportNode(context, node) }',
					'}',
					'}',
				].join('\n'),
			},
			{
				name: 'accepts function syntax inside a class expression',
				code: 'function projectValue() { return class { read() { const value = () => 1; return value() } } }',
			},
			{
				name: 'accepts class accessors inside a factory',
				code: 'function createAccessor() { class Accessor { get value() { return 1 } set value(value) { consume(value) } } return Accessor }',
			},
			{
				name: 'accepts the event-map option in a function body',
				code: `function configure() {
createSomething({
	on: {
		thing: function that() {
			console.log('that thing')
		},
		other: () => {
			console.log('this other')
		},
	},
})
}`,
			},
			{
				name: 'accepts an array element in a call argument',
				code: 'function configure() { return create([() => 1]) }',
			},
			{
				name: 'accepts methods and accessors in admitted object positions',
				code: 'function configure() { create({ on: { thing() { return 1 } } }); new Factory({ get value() { return 1 }, set value(value) { consume(value) } }); return { read() { return 1 } } }',
			},
			{
				name: 'accepts an object member returned from a function',
				code: 'function configure() { return { read: function readValue() { return 1 } } }',
			},
			{
				name: 'accepts an object member in a parenthesized arrow body',
				code: 'const configure = () => ({ read: () => 1 })',
			},
			{
				name: 'accepts a parenthesized member in a constructor argument',
				code: 'function configure() { return new Factory({ read: (() => 1) }) }',
			},
			{
				name: 'accepts a named function expression argument',
				code: 'function projectValue() { return read(function readValue() { return 1 }) }',
			},
		],
		invalid: [
			{
				name: 'accepts object accessors while rejecting nested function expressions',
				code: [
					'function createAccessor() {',
					'  const control = function () { return 1 }',
					'  return {',
					'    get value() {',
					'      const nested = function () { return 2 }',
					'      return nested()',
					'    },',
					'    set value(value) { consume(value) },',
					'  }',
					'}',
				].join('\n'),
				errors: [
					{ messageId: 'nested', line: 2, column: 18 },
					{ messageId: 'nested', line: 5, column: 21 },
				],
			},
			{
				name: 'rejects a local function declaration',
				code: 'function projectValue() { function readValue() { return 1 } return readValue() }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects a function assigned to a local binding',
				code: 'function projectValue() { const readValue = () => 1; return readValue() }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects a callback parameter default function',
				code: 'function projectValue() { return values.map((value = () => 1) => value()) }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects an assignment two direct callbacks down',
				code: 'function projectValue() { return values.map((value) => read((nested) => { const project = () => nested; return project() })) }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects a function assigned inside a class-declaration method',
				code: 'class Project { read() { const value = () => 1; return value() } }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects an object literal bound locally before being passed',
				code: 'function configure() { const options = { on: { thing: () => 1 } }; return create(options) }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects an object method bound locally before being passed',
				code: 'function configure() { const options = { on: { thing() { return 1 } } }; return create(options) }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects object accessors bound locally before being passed',
				code: 'function configure() { const options = { get value() { return 1 }, set value(value) { consume(value) } }; return create(options) }',
				errors: [{ messageId: 'nested' }, { messageId: 'nested' }],
			},
			{
				name: 'rejects an object member reached through a spread',
				code: 'function configure() { return create({ ...{ thing: () => 1 } }) }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects a computed property value',
				code: 'function configure() { return create({ [key]: () => 1 }) }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects a local binding inside a getter in an argument',
				code: 'function configure() { return create({ get value() { const read = () => 1; return read() } }) }',
				errors: [{ messageId: 'nested' }],
			},
			{
				name: 'rejects only the local binding inside an admitted member',
				code: [
					'function configure() {',
					'create({ on: { thing: () => {',
					'const read = () => 1;',
					'return read()',
					'} } })',
					'}',
				].join('\n'),
				errors: [{ messageId: 'nested', line: 3, column: 13 }],
			},
		],
	})

	tester.run('no-hidden-declaration', HIDDEN_RULE, {
		valid: [
			{
				name: 'accepts an exported centralized declaration',
				filename: 'src/worker/helpers.ts',
				code: 'export function buildValue(): void {}',
			},
			{
				name: 'accepts a hidden declaration outside a centralized file',
				filename: 'src/worker/Widget.ts',
				code: 'function buildValue(): void {}',
			},
		],
		invalid: [
			{
				name: 'rejects a hidden helper [membership: declarations in a centralized file without an export]',
				filename: 'src/worker/helpers.ts',
				code: 'function buildValue(): void {}',
				errors: [{ messageId: 'hidden' }],
			},
			{
				name: 'rejects a hidden constant [membership: declarations in a centralized file without an export]',
				filename: 'src/worker/constants.ts',
				code: 'const COUNT = 1',
				errors: [{ messageId: 'hidden' }],
			},
			{
				name: 'rejects a hidden plugin factory [membership: declarations in a centralized file without an export]',
				filename: 'src/worker/plugins.ts',
				code: 'function createModalPlugin(): void {}',
				errors: [{ messageId: 'hidden' }],
			},
		],
	})

	tester.run('no-misplaced-type', TYPE_RULE, {
		valid: [
			{
				name: 'accepts an interface in types.ts',
				filename: 'src/mobile/types.ts',
				code: 'export interface ValueInterface { readonly id: string }',
			},
			{
				name: 'accepts an interface in an ambient declaration file',
				filename: 'app/browser/env.d.ts',
				code: 'export interface EnvironmentInterface { readonly mode: string }',
			},
			{
				name: 'accepts an interface in an ambient module declaration file',
				filename: 'app/browser/env.d.mts',
				code: 'export interface EnvironmentInterface { readonly mode: string }',
			},
			{
				name: 'accepts an interface in an ambient CommonJS declaration file',
				filename: 'app/browser/env.d.cts',
				code: 'export interface EnvironmentInterface { readonly mode: string }',
			},
		],
		invalid: [
			{
				name: 'rejects an interface beside helpers [membership: top-level type declarations outside types.ts]',
				filename: 'src/mobile/helpers.ts',
				code: 'export interface ValueInterface { readonly id: string }',
				errors: [{ messageId: 'type' }],
			},
			{
				name: 'rejects a type alias in an environment module [membership: top-level type declarations outside types.ts]',
				filename: 'app/browser/env.ts',
				code: "export type Mode = 'dark' | 'light'",
				errors: [{ messageId: 'type' }],
			},
		],
	})

	tester.run('no-misplaced-class', CLASS_RULE, {
		valid: [
			{
				name: 'accepts a class in the file named for it',
				filename: 'app/desktop/Widget.ts',
				code: 'export class Widget {}',
			},
			{
				name: 'accepts an error class in errors.ts',
				filename: 'app/desktop/errors.ts',
				code: 'export class WidgetError extends Error {}',
			},
		],
		invalid: [
			{
				name: 'rejects a class that differs from its file [membership: classes outside errors.ts whose name differs from the filename]',
				filename: 'app/desktop/Widget.ts',
				code: 'export class Other {}',
				errors: [{ messageId: 'class' }],
			},
			{
				name: 'rejects a class in a camelCase file [membership: classes outside errors.ts whose name differs from the filename]',
				filename: 'app/desktop/helpers.ts',
				code: 'export class Widget {}',
				errors: [{ messageId: 'class' }],
			},
		],
	})

	tester.run('no-misplaced-data', DATA_RULE, {
		valid: [
			{
				name: 'accepts module data in constants.ts',
				filename: 'app/edge/constants.ts',
				code: "export const STATUS = 'ready'",
			},
			{
				name: 'accepts a helper namespace in helpers.ts',
				filename: 'app/edge/helpers.ts',
				code: 'export const formatters = Object.freeze({ money: build(fmt) })',
			},
		],
		invalid: [
			{
				name: 'rejects data beside handlers [membership: module data whose file is absent from the data register]',
				filename: 'app/edge/handlers.ts',
				code: "export const STATUS = 'ready'",
				errors: [{ messageId: 'data' }],
			},
			{
				name: 'rejects data in an implementation file [membership: module data whose file is absent from the data register]',
				filename: 'app/edge/Widget.ts',
				code: 'export const LIMIT = 4',
				errors: [{ messageId: 'data' }],
			},
		],
	})

	tester.run('no-misplaced-function', FUNCTION_RULE, {
		valid: [
			...POLICY_VUE_DOMAIN_CASES.filter((source) => !source.misplaced).map((source) => ({
				name: `accepts Vue function placement in ${source.path}`,
				filename: resolve(POLICY_ROOT, source.path),
				cwd: POLICY_ROOT,
				code: source.content,
			})),
			{
				name: 'accepts a function in a function-kind file',
				filename: 'src/worker/helpers.ts',
				code: 'export function buildValue(): void {}',
			},
			{
				name: 'accepts a plugin factory in plugins.ts',
				filename: 'src/worker/plugins.ts',
				code: 'export function createModalPlugin(): void {}',
			},
			{
				name: 'accepts a module in a registered function domain',
				filename: 'app/browser/composables/useTheme.ts',
				code: 'export function useTheme(): void {}',
			},
			{
				name: 'accepts a callback passed directly as an argument',
				filename: 'app/edge/constants.ts',
				code: 'export const LABELS = Object.freeze(COLUMNS.map((column) => column.label))',
			},
			{
				name: 'accepts a function returned directly through a concise body',
				filename: 'app/edge/constants.ts',
				code: 'export const WRAPPED = wrap(() => () => 1)',
			},
			{
				name: 'accepts functions returned directly through callback control flow',
				filename: 'app/edge/constants.ts',
				code: 'export const VALUES = Object.freeze(C.map((c) => { if (c) return () => 1; return () => 2 }))',
			},
			{
				name: 'accepts a function returned by a return statement inside a callback',
				filename: 'app/edge/constants.ts',
				code: 'export const LABELS = Object.freeze(COLUMNS.map((column) => { return () => column.label }))',
			},
			{
				name: 'accepts a method of a top-level class',
				filename: 'app/edge/Widget.ts',
				code: 'export class Widget { read() { return 1 } }',
			},
		],
		invalid: [
			{
				name: 'rejects a function module in an unregistered folder [membership: module function syntax whose file is absent from the function register]',
				filename: 'src/worker/jobs/runTask.ts',
				code: 'export function runTask(): void {}',
				errors: [{ messageId: 'function' }],
			},
			...POLICY_VUE_DOMAIN_CASES.filter((source) => source.misplaced).map((source) => ({
				name: `rejects Vue function placement in ${source.path} [membership: modules outside the exact direct function register]`,
				filename: resolve(POLICY_ROOT, source.path),
				cwd: POLICY_ROOT,
				code: source.content,
				errors: [{ messageId: 'function' }],
			})),
			{
				name: 'rejects a property-held arrow in a route table [membership: module function syntax whose file is absent from the function register]',
				filename: 'src/worker/routes.ts',
				code: 'export const ROUTES = Object.freeze([{ handler: () => undefined }])',
				errors: [{ messageId: 'function' }],
			},
			{
				name: 'rejects a callback parameter default function [membership: module function syntax that is neither a direct callback nor a direct result]',
				filename: 'app/edge/constants.ts',
				code: 'export const VALUES = Object.freeze(C.map((c = () => 1) => c))',
				errors: [{ messageId: 'function' }],
			},
			{
				name: 'rejects an assignment inside a direct callback [membership: module function syntax that is neither a direct callback nor a direct result]',
				filename: 'app/edge/constants.ts',
				code: 'export const VALUES = Object.freeze(C.map((c) => { const f = () => c; return f() }))',
				errors: [{ messageId: 'function' }],
			},
			{
				name: 'rejects a destructured callback parameter default function [membership: module function syntax that is neither a direct callback nor a direct result]',
				filename: 'app/edge/constants.ts',
				code: 'export const VALUES = Object.freeze(C.map(({ f = () => 1 }) => f))',
				errors: [{ messageId: 'function' }],
			},
			{
				name: 'rejects an assignment inside callback control flow [membership: module function syntax that is neither a direct callback nor a direct result]',
				filename: 'app/edge/constants.ts',
				code: 'export const VALUES = Object.freeze(C.map((c) => { if (c) { const f = () => 1; return f() } return 2 }))',
				errors: [{ messageId: 'function' }],
			},
			{
				name: 'rejects a declaration inside a direct callback [membership: module function syntax that is neither a direct callback nor a direct result]',
				filename: 'app/edge/constants.ts',
				code: 'export const LABELS = Object.freeze(COLUMNS.map((column) => { function format() { return column.label } return format() }))',
				errors: [{ messageId: 'function' }],
			},
			{
				name: 'rejects an assignment two direct callbacks down [membership: module function syntax that is neither a direct callback nor a direct result]',
				filename: 'app/edge/constants.ts',
				code: 'export const VALUES = Object.freeze(C.map((c) => wrap((d) => { const g = () => d; return g() })))',
				errors: [{ messageId: 'function' }],
			},
			{
				name: 'rejects a function in a nested folder whose suffix matches a registered domain [membership: module function syntax whose file is absent from the function register]',
				filename: 'src/server/execution/nested/src/server/execution/thing.ts',
				code: 'export function run(): void {}',
				errors: [{ messageId: 'function' }],
			},
		],
	})

	tester.run('no-malformed-constant', CONSTANT_RULE, {
		valid: [
			{
				name: 'accepts a frozen upper-case constant',
				filename: 'src/worker/constants.ts',
				code: "export const LABELS = Object.freeze(['ready'])",
			},
			{
				name: 'accepts a lower-case binding outside constants.ts',
				filename: 'src/worker/helpers.ts',
				code: 'export const count = 1',
			},
		],
		invalid: [
			{
				name: 'rejects a mutable constant [membership: variable statements in constants.ts that are not const]',
				filename: 'src/worker/constants.ts',
				code: 'export let COUNT = 1',
				errors: [{ messageId: 'mutable' }],
			},
			{
				name: 'rejects a lower-case constant [membership: declarations in constants.ts outside UPPER_SNAKE_CASE]',
				filename: 'src/worker/constants.ts',
				code: 'export const count = 1',
				errors: [{ messageId: 'naming' }],
			},
			{
				name: 'rejects a bare collection constant [membership: declarations in constants.ts with a direct array or object literal]',
				filename: 'src/worker/constants.ts',
				code: 'export const VALUES = []',
				errors: [{ messageId: 'collection' }],
			},
		],
	})

	tester.run('no-misnamed-parser', PARSER_RULE, {
		valid: [
			{
				name: 'accepts a parse-prefixed coercer',
				filename: 'app/edge/parsers.ts',
				code: 'export function parseValue(): void {}',
			},
			{
				name: 'accepts an unprefixed function outside parsers.ts',
				filename: 'app/edge/helpers.ts',
				code: 'export function coerceValue(): void {}',
			},
		],
		invalid: [
			{
				name: 'rejects an unprefixed coercer [membership: parsers.ts functions whose name does not start with parse]',
				filename: 'app/edge/parsers.ts',
				code: 'export function coerceValue(): void {}',
				errors: [{ messageId: 'parser' }],
			},
			{
				name: 'rejects an unprefixed assigned coercer [membership: parsers.ts functions whose name does not start with parse]',
				filename: 'app/edge/parsers.ts',
				code: 'export const coerceValue = () => undefined',
				errors: [{ messageId: 'parser' }],
			},
			{
				name: 'rejects an unprefixed export alias [membership: parsers.ts functions whose name does not start with parse]',
				filename: 'app/edge/parsers.ts',
				code: 'function parseValue(): void {}\nexport { parseValue as coerceValue }',
				errors: [{ messageId: 'parser' }],
			},
			{
				name: 'rejects an unprefixed exported import alias [membership: parsers.ts functions whose name does not start with parse]',
				filename: 'app/edge/parsers.ts',
				code: 'export import coerceValue = Values.parseValue',
				errors: [{ messageId: 'parser' }],
			},
		],
	})

	tester.run('no-misnamed-factory', FACTORY_RULE, {
		valid: [
			{
				name: 'accepts a create-prefixed factory',
				filename: 'app/edge/factories.ts',
				code: 'export const createValue = () => undefined',
			},
			{
				name: 'accepts an unprefixed function outside factories.ts',
				filename: 'app/edge/helpers.ts',
				code: 'export function buildValue(): void {}',
			},
		],
		invalid: [
			{
				name: 'rejects an unprefixed factory [membership: factories.ts functions whose name does not start with create]',
				filename: 'app/edge/factories.ts',
				code: 'export function buildValue(): void {}',
				errors: [{ messageId: 'factory' }],
			},
			{
				name: 'rejects an unprefixed assigned factory [membership: factories.ts functions whose name does not start with create]',
				filename: 'app/edge/factories.ts',
				code: 'export const buildValue = () => undefined',
				errors: [{ messageId: 'factory' }],
			},
			{
				name: 'rejects an unprefixed export alias [membership: factories.ts functions whose name does not start with create]',
				filename: 'app/edge/factories.ts',
				code: 'function createValue(): void {}\nexport { createValue as buildValue }',
				errors: [{ messageId: 'factory' }],
			},
			{
				name: 'rejects an unprefixed exported import alias [membership: factories.ts functions whose name does not start with create]',
				filename: 'app/edge/factories.ts',
				code: 'export import buildValue = Values.createValue',
				errors: [{ messageId: 'factory' }],
			},
		],
	})

	tester.run('no-misnamed-plugin', PLUGIN_RULE, {
		valid: [
			{
				name: 'accepts a create-prefixed plugin factory',
				filename: 'src/edge/plugins.ts',
				code: 'export function createModalPlugin(): void {}',
			},
			{
				name: 'accepts a create-prefixed plugin collection factory',
				filename: 'src/edge/plugins.ts',
				code: 'export const createBootstrapPlugins = () => undefined',
			},
			{
				name: 'accepts a plugin-suffixed name outside plugins.ts',
				filename: 'src/edge/helpers.ts',
				code: 'export function registerPlugin(): void {}',
			},
			{
				name: 'reads no binding nested inside a plugin factory',
				filename: 'src/edge/plugins.ts',
				code: 'export function createModalPlugin(): void {\n\tfunction build(): void {}\n\tbuild()\n}',
			},
			{
				name: 'accepts an export specifier in the plugin form',
				filename: 'src/edge/plugins.ts',
				code: 'function createModalPlugin(): void {}\nexport { createModalPlugin as createDialogPlugin }',
			},
			{
				name: 'accepts an exported import alias in the plugin form',
				filename: 'src/edge/plugins.ts',
				code: 'export import createDialogPlugin = Factories.createModalPlugin',
			},
			{
				name: 'accepts an exported import alias outside plugins.ts',
				filename: 'src/edge/helpers.ts',
				code: 'export import registerModal = Factories.createModalPlugin',
			},
		],
		invalid: [
			{
				name: 'rejects a plugin-suffixed name without the create prefix [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function registerModalPlugin(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a lowercase segment before the plugin suffix [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function createmodalPlugin(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a name that runs past the plugin suffix [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function createModalPluginHost(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a plugin factory with no entity segment [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function createPlugin(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a misnamed declared signature [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export declare function registerModal(): void',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects an anonymous default function [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export default function (): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects an export alias outside the plugin form [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'function createModalPlugin(): void {}\nexport { createModalPlugin as registerModal }',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a re-export outside the plugin form [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: "export { registerModal } from './modal.js'",
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a star re-export whose names the form cannot read [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: "export * from './modal.js'",
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a register-prefixed plugin factory [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function registerModal(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a create-prefixed name without the plugin suffix [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export const createModal = () => undefined',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a bare plugin-suffixed name [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function modalPlugin(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects a lowercase entity after create [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function createplugin(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects an underscore in the entity segment [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export function createModal_Plugin(): void {}',
				errors: [{ messageId: 'plugin' }],
			},
			{
				name: 'rejects an exported import alias outside the plugin form [membership: plugins.ts functions whose name is not create…Plugin or create…Plugins]',
				filename: 'src/edge/plugins.ts',
				code: 'export import registerModal = Factories.createModalPlugin',
				errors: [{ messageId: 'plugin' }],
			},
		],
	})

	tester.run('no-malformed-domain', DOMAIN_RULE, {
		valid: [
			...POLICY_VUE_DOMAIN_CASES.filter((source) => !source.malformed).map((source) => ({
				name: `accepts Vue domain shape in ${source.path}`,
				filename: resolve(POLICY_ROOT, source.path),
				cwd: POLICY_ROOT,
				code: source.content,
			})),
			{
				name: 'accepts a registered function module carrying imports and one named export',
				filename: 'app/browser/composables/useTheme.ts',
				code: ["import { ref } from 'vue'", 'export function useTheme(): void { void ref }'].join(
					'\n',
				),
			},
			{
				name: 'accepts a module outside every registered domain',
				filename: 'app/edge/helpers.ts',
				code: 'export function buildValue(): void {}',
			},
			{
				name: 'accepts a nested folder whose suffix matches a registered domain',
				filename: 'src/server/execution/nested/src/server/execution/thing.ts',
				code: 'export const VALUE = 1',
			},
		],
		invalid: [
			{
				name: 'rejects a module whose function differs from its file [membership: direct camelCase modules in a registered function-domain folder]',
				filename: 'app/browser/composables/useTheme.ts',
				code: 'export function useMode(): void {}',
				errors: [{ messageId: 'module' }],
			},
			...POLICY_VUE_DOMAIN_CASES.filter((source) => source.malformed).map((source) => ({
				name: `rejects Vue domain shape in ${source.path} [membership: direct camelCase modules in the Vue function domain]`,
				filename: resolve(POLICY_ROOT, source.path),
				cwd: POLICY_ROOT,
				code: source.content,
				errors: [{ messageId: 'module' }],
			})),
			{
				name: 'rejects a hidden domain function [membership: direct camelCase modules in a registered function-domain folder]',
				filename: 'app/browser/composables/useTheme.ts',
				code: 'function useTheme(): void {}',
				errors: [{ messageId: 'module' }],
			},
			{
				name: 'rejects a file named for a registered domain [membership: source files whose stem is a registered function-domain name]',
				filename: 'app/edge/composables.ts',
				code: 'export function buildValue(): void {}',
				errors: [{ messageId: 'file' }],
			},
		],
	})

	tester.run('no-host-line-endings', ENDING_RULE, {
		valid: [
			{
				name: 'accepts a split on the line-ending pattern',
				filename: 'src/worker/helpers.ts',
				code: 'export const lines = text.trim().split(/\\r\\n|\\n/u)',
			},
			{
				name: 'accepts a locally declared line-ending constant',
				filename: 'src/worker/constants.ts',
				code: "export const EOL = '\\n'",
			},
			{
				name: 'accepts a namespace import that reads no line ending',
				filename: 'configs/helpers.ts',
				code: ["import * as os from 'node:os'", 'export const root = os.tmpdir()'].join('\n'),
			},
		],
		invalid: [
			{
				name: 'rejects a payload trimmed before it is split [membership: split calls carrying a line-feed literal]',
				filename: 'src/worker/helpers.ts',
				code: "export const lines = text.trim().split('\\n')",
				errors: [{ messageId: 'split' }],
			},
			{
				name: 'rejects a templated line-feed split [membership: split calls carrying a line-feed literal]',
				filename: 'src/worker/helpers.ts',
				code: 'export const lines = text.trim().split(`\\n`)',
				errors: [{ messageId: 'split' }],
			},
			{
				name: 'rejects a read of the host line ending [membership: EOL reads on a binding named os]',
				filename: 'configs/helpers.ts',
				code: ["import * as os from 'node:os'", 'export const end = os.EOL'].join('\n'),
				errors: [{ messageId: 'terminator' }],
			},
			{
				name: 'rejects an EOL import from the host module [membership: named EOL specifiers imported from node:os]',
				filename: 'configs/helpers.ts',
				code: ["import { EOL } from 'node:os'", 'export const end = EOL'].join('\n'),
				errors: [{ messageId: 'terminator' }],
			},
		],
	})

	const SCRIPT_GUARD = [
		'if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === import.meta.filename) {',
		'\tprocess.exitCode = main()',
		'}',
	].join('\n')

	tester.run('no-malformed-script', SCRIPT_RULE, {
		valid: [
			{
				name: 'accepts imports, documented exports, and the one guarded entry',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: [
					"import { realpathSync } from 'node:fs'",
					'',
					'/** Reads the one value. */',
					'export function read(): number {',
					'\treturn 1',
					'}',
					'',
					'/** Runs the script. */',
					'export function main(): number {',
					'\treturn read()',
					'}',
					'',
					SCRIPT_GUARD,
				].join('\n'),
			},
			{
				name: 'accepts a documented exported type, interface, and constant',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: [
					'/** Names the one value. */',
					'export type Value = number',
					'',
					'/** Describes the one record. */',
					'export interface Entry {',
					'\treadonly value: Value',
					'}',
					'',
					'/** Holds the one constant. */',
					'export const VALUE = 1',
				].join('\n'),
			},
			{
				name: 'accepts a guard the formatter wrapped over lines',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: [
					'if (',
					'\tprocess.argv[1] !== undefined &&',
					'\trealpathSync(process.argv[1]) === import.meta.filename',
					') {',
					'\tmain()',
					'}',
				].join('\n'),
			},
			{
				name: 'accepts a doc block separated from its export by a blank line',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: ['/** Holds the one constant. */', '', 'export const VALUE = 1'].join('\n'),
			},
			{
				name: 'accepts a module outside the skill scripts',
				filename: 'src/worker/helpers.ts',
				code: 'function hidden(): void {}\nhidden()',
			},
			{
				name: 'accepts a file beside the skill scripts',
				filename: '.agents/skills/sample/references/tool.ts',
				code: 'function hidden(): void {}\nhidden()',
			},
		],
		invalid: [
			{
				name: 'rejects an unexported function [membership: top-level declarations of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: 'function read(): number { return 1 }',
				errors: [{ messageId: 'hidden' }],
			},
			{
				name: 'rejects an unexported constant [membership: top-level declarations of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: 'const VALUE = 1',
				errors: [{ messageId: 'hidden' }],
			},
			{
				name: 'rejects an unexported interface even with a doc block [membership: top-level declarations of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: [
					'/** Describes the one record. */',
					'interface Value { readonly value: number }',
				].join('\n'),
				errors: [{ messageId: 'hidden' }],
			},
			{
				name: 'rejects an export with no comment above it [membership: exported declarations of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: 'export function read(): number { return 1 }',
				errors: [{ messageId: 'doc' }],
			},
			{
				name: 'rejects an export under a line comment [membership: exported declarations of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: ['// Reads the one value.', 'export function read(): number { return 1 }'].join('\n'),
				errors: [{ messageId: 'doc' }],
			},
			{
				name: 'rejects an export under a plain block comment [membership: exported declarations of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: ['/* Reads the one value. */', 'export const VALUE = 1'].join('\n'),
				errors: [{ messageId: 'doc' }],
			},
			{
				name: 'rejects a doc block separated from its export by code [membership: exported declarations of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: ['/** Holds the one constant. */', 'const FIRST = 1', 'export const SECOND = 2'].join(
					'\n',
				),
				errors: [{ messageId: 'hidden' }, { messageId: 'doc' }],
			},
			{
				name: 'rejects a bare call [membership: top-level statements of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: 'main()',
				errors: [{ messageId: 'entry' }],
			},
			{
				name: 'rejects an entry under another condition [membership: top-level statements of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: ['if (process.argv[1] !== undefined) {', '\tmain()', '}'].join('\n'),
				errors: [{ messageId: 'entry' }],
			},
			{
				name: 'rejects the guard when it carries an else branch [membership: top-level statements of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: [SCRIPT_GUARD.replace(/\}$/u, '} else {'), '\tmain()', '}'].join('\n'),
				errors: [{ messageId: 'entry' }],
			},
			{
				name: 'rejects a second guard [membership: top-level statements of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: [SCRIPT_GUARD, SCRIPT_GUARD].join('\n'),
				errors: [{ messageId: 'entry' }],
			},
			{
				name: 'rejects an export list [membership: top-level statements of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: ['/** Holds the one constant. */', 'const VALUE = 1', 'export { VALUE }'].join('\n'),
				errors: [{ messageId: 'hidden' }, { messageId: 'entry' }],
			},
			{
				name: 'rejects a default export [membership: top-level statements of a skill script]',
				filename: '.agents/skills/sample/scripts/tool.ts',
				code: 'export default {}',
				errors: [{ messageId: 'entry' }],
			},
		],
	})

	tester.run('no-mutable-property', MUTABLE_RULE, {
		valid: [
			{
				name: 'accepts a readonly interface property',
				filename: 'src/core/types.ts',
				code: 'export interface Value { readonly id: string }',
			},
			{
				name: 'accepts a readonly property of a type alias object',
				filename: 'src/core/types.ts',
				code: 'export type Value = { readonly id: string; readonly name?: string }',
			},
			{
				name: 'accepts a method signature',
				filename: 'src/core/types.ts',
				code: 'export interface Value { read(): string }',
			},
			{
				name: 'accepts an inline parameter type',
				filename: 'src/core/helpers.ts',
				code: 'export function read(options: { id: string }): string { return options.id }',
			},
			{
				name: 'accepts an inline parameter type of an interface method',
				filename: 'src/core/types.ts',
				code: 'export interface Value { read(options: { id: string }): string }',
			},
			{
				name: 'accepts an inline parameter type of a function typed property',
				filename: 'src/core/types.ts',
				code: 'export interface Value { readonly read: (options: { id: string }) => string }',
			},
			{
				name: 'accepts an object type annotating a binding',
				filename: 'src/core/constants.ts',
				code: "export const VALUE: { id: string } = { id: 'a' }",
			},
			{
				name: 'accepts a mutable property of an ambient declaration file',
				filename: 'src/core/types.d.ts',
				code: 'export interface Value { id: string }',
			},
		],
		invalid: [
			{
				name: 'rejects a mutable interface property [membership: property signatures of an interface]',
				filename: 'src/core/types.ts',
				code: 'export interface Value { id: string }',
				errors: [{ messageId: 'mutable' }],
			},
			{
				name: 'rejects a mutable optional interface property [membership: property signatures of an interface]',
				filename: 'src/core/types.ts',
				code: 'export interface Value { readonly id: string; name?: string }',
				errors: [{ messageId: 'mutable' }],
			},
			{
				name: 'rejects a mutable property of a type alias object [membership: property signatures of a type alias object type]',
				filename: 'src/core/types.ts',
				code: 'export type Value = { id: string }',
				errors: [{ messageId: 'mutable' }],
			},
			{
				name: 'rejects a mutable property of a union member [membership: property signatures of a type alias object type]',
				filename: 'src/core/types.ts',
				code: 'export type Value = { readonly id: string } | { name: string }',
				errors: [{ messageId: 'mutable' }],
			},
			{
				name: 'rejects a mutable property of a nested object type [membership: property signatures of a type alias object type]',
				filename: 'src/core/types.ts',
				code: 'export interface Value { readonly inner: { id: string } }',
				errors: [{ messageId: 'mutable' }],
			},
			{
				name: 'rejects a mutable property of a generic argument [membership: property signatures of a type alias object type]',
				filename: 'src/core/types.ts',
				code: 'export type Value = ReadonlyArray<{ id: string }>',
				errors: [{ messageId: 'mutable' }],
			},
			{
				name: 'rejects a mutable function typed property [membership: property signatures of an interface]',
				filename: 'src/core/types.ts',
				code: 'export interface Value { read: () => string }',
				errors: [{ messageId: 'mutable' }],
			},
		],
	})

	tester.run('no-malformed-summary', VOICE_RULE, {
		valid: [
			{
				name: 'accepts a third-person opener',
				code: ['/** Creates a control. */', 'export const CONTROL = 1'].join('\n'),
			},
			{
				name: 'accepts a whether clause',
				code: ['/** Checks whether the reader is ready. */', 'export const READY = true'].join(
					'\n',
				),
			},
			{
				name: 'accepts a two-letter third-person opener',
				code: ['/** Is the value a reader receives. */', 'export const CONTROL = 1'].join('\n'),
			},
			{
				name: 'accepts a reporting opener',
				code: ['/** Reports whether the reader is ready. */', 'export const READY = true'].join(
					'\n',
				),
			},
			{
				name: 'accepts an anonymous default export',
				code: ['/** Declares the fixture plugin. */', 'export default { meta: 1 }'].join('\n'),
			},
			{
				name: 'accepts a doc block on a declaration no export reaches',
				code: ['/** The opener, a noun phrase. */', 'const CONTROL = 1', 'void CONTROL'].join('\n'),
			},
			{
				name: 'accepts a doc block on a class member',
				code: [
					'/** Holds one value. */',
					'export class Holder {',
					'\t/** The member value, a noun phrase. */',
					'\tvalue = 1',
					'}',
				].join('\n'),
			},
			{
				name: 'accepts a single-star block comment before an export',
				code: ['/* The opener, a noun phrase. */', 'export const CONTROL = 1'].join('\n'),
			},
			{
				name: 'accepts a word from the stop set after the opener',
				code: ['/** Reports whether this process passes. */', 'export const READY = true'].join(
					'\n',
				),
			},
			{
				name: 'accepts a block tag naming the symbol after the description [membership: text before the first block tag]',
				code: [
					'/**',
					' * Creates a control',
					' *',
					' * @param value - The value readControl reads.',
					' */',
					'export function readControl(value: number): number {',
					'\treturn value',
					'}',
				].join('\n'),
			},
			{ name: 'accepts an export carrying no doc block', code: 'export const CONTROL = 1' },
		],
		invalid: [
			{
				name: 'rejects a noun-phrase opener [membership: doc blocks directly above a top-level export]',
				code: ['/** The opener, a noun phrase. */', 'export const CONTROL = 1'].join('\n'),
				errors: [{ messageId: 'voice' }],
			},
			{
				name: 'rejects an imperative opener [membership: doc blocks directly above a top-level export]',
				code: ['/** Create a control. */', 'export function createControl(): void {}'].join('\n'),
				errors: [{ messageId: 'voice' }],
			},
			{
				name: 'rejects an opener from the stop set [membership: opening words ending in s that name no verb]',
				code: ['/** This holds one value. */', 'export const CONTROL = 1'].join('\n'),
				errors: [{ messageId: 'voice' }],
			},
			{
				name: 'rejects a first sentence naming its own class [membership: the declared identifier inside the first sentence]',
				code: ['/** Returns the value ControlTwo carries. */', 'export class ControlTwo {}'].join(
					'\n',
				),
				errors: [{ messageId: 'name', data: { name: 'ControlTwo' } }],
			},
			{
				name: 'rejects a first sentence naming its own constant [membership: the declared identifier inside the first sentence]',
				code: ['/** Returns the value CONTROL carries. */', 'export const CONTROL = 1'].join('\n'),
				errors: [{ messageId: 'name', data: { name: 'CONTROL' } }],
			},
			{
				name: 'rejects an empty doc block [membership: description paragraphs, the empty one included]',
				code: ['/** */', 'export const CONTROL = 1'].join('\n'),
				errors: [{ messageId: 'voice' }],
			},
			{
				name: 'rejects a doc block a blank line separates from its export [membership: doc blocks whitespace alone separates from a top-level export]',
				code: ['/** The opener, a noun phrase. */', '', 'export const CONTROL = 1'].join('\n'),
				errors: [{ messageId: 'voice' }],
			},
		],
	})

	tester.run('no-banned-term', TERM_RULE, {
		valid: [
			{ name: 'accepts a term inside a code span', code: '// A `should` token names one row.' },
			{
				name: 'accepts a term inside a fenced example',
				code: [
					'/**',
					' * Reads one value.',
					' *',
					' * @example',
					' * ```text',
					' * should stay',
					' * ```',
					' */',
					'export const CONTROL = 1',
				].join('\n'),
			},
			{
				name: 'accepts a term inside a link target',
				code: '/** Reports the state. {@link Example.should} */',
			},
			{
				name: 'accepts a term inside an address',
				code: '// Read https://example.test/should/row for the shape.',
			},
			{
				name: 'accepts a term inside a code span a line break runs through',
				code: ['/**', ' * A span `that', ' * spans lines with should` here.', ' */'].join('\n'),
			},
			{ name: 'accepts a judged term', code: '// The new value is read once now.' },
			{
				name: 'accepts a longer word carrying a term',
				code: '// A justice viable pleased reader.',
			},
			{ name: 'accepts prose carrying no term', code: '// Reads the value a reader receives.' },
		],
		invalid: [
			{
				name: 'rejects should [membership: comment prose outside code, tags, and addresses]',
				code: '// A reader should meet this row.',
				errors: [
					{
						messageId: 'term',
						data: { term: 'should', replacement: 'must, can, might, or the imperative' },
					},
				],
			},
			{
				name: 'rejects should in a block comment [membership: block and line comments alike]',
				code: '/** Reports the state a reader should meet. */',
				errors: [
					{
						messageId: 'term',
						data: { term: 'should', replacement: 'must, can, might, or the imperative' },
					},
				],
			},
			{
				name: 'rejects simply [membership: comment prose outside code, tags, and addresses]',
				code: '// The reader simply reads.',
				errors: [{ messageId: 'term', data: { term: 'simply', replacement: 'delete' } }],
			},
			{
				name: 'rejects easy [membership: comment prose outside code, tags, and addresses]',
				code: '// The path is easy.',
				errors: [{ messageId: 'term', data: { term: 'easy', replacement: 'delete' } }],
			},
			{
				name: 'rejects easiest [membership: the inflections one row reaches]',
				code: '// The path is easiest.',
				errors: [{ messageId: 'term', data: { term: 'easy', replacement: 'delete' } }],
			},
			{
				name: 'rejects just [membership: comment prose outside code, tags, and addresses]',
				code: '// The reader just reads.',
				errors: [{ messageId: 'term', data: { term: 'just', replacement: 'delete' } }],
			},
			{
				name: 'rejects currently [membership: comment prose outside code, tags, and addresses]',
				code: '// The reader currently reads.',
				errors: [
					{
						messageId: 'term',
						data: { term: 'currently', replacement: 'delete, or give the date' },
					},
				],
			},
			{
				name: 'rejects utilizes [membership: the inflections one row reaches]',
				code: '// The reader utilizes the path.',
				errors: [{ messageId: 'term', data: { term: 'utilize', replacement: 'use' } }],
			},
			{
				name: 'rejects utilizing [membership: the inflections one row reaches]',
				code: '// The reader is utilizing the path.',
				errors: [{ messageId: 'term', data: { term: 'utilize', replacement: 'use' } }],
			},
			{
				name: 'rejects leverages [membership: the inflections one row reaches]',
				code: '// The reader leverages the path.',
				errors: [{ messageId: 'term', data: { term: 'leverage', replacement: 'use' } }],
			},
			{
				name: 'rejects leveraged [membership: the inflections one row reaches]',
				code: '// The reader leveraged the path.',
				errors: [{ messageId: 'term', data: { term: 'leverage', replacement: 'use' } }],
			},
			{
				name: 'rejects via [membership: comment prose outside code, tags, and addresses]',
				code: '// The reader arrives via the path.',
				errors: [{ messageId: 'term', data: { term: 'via', replacement: 'through, by using' } }],
			},
			{
				name: 'rejects in order to [membership: comment prose outside code, tags, and addresses]',
				code: '// The reader reads in order to learn.',
				errors: [{ messageId: 'term', data: { term: 'in order to', replacement: 'to' } }],
			},
			{
				name: 'rejects the abbreviated for example [membership: dotted rows read with their dots]',
				code: '// The reader reads one path, e.g. the front page.',
				errors: [{ messageId: 'term', data: { term: 'e.g.', replacement: 'for example' } }],
			},
			{
				name: 'rejects the abbreviated that is [membership: dotted rows read with their dots]',
				code: '// The reader reads one path, i.e. the front page.',
				errors: [{ messageId: 'term', data: { term: 'i.e.', replacement: 'that is' } }],
			},
			{
				name: 'rejects the abbreviated list ending [membership: dotted rows read with their dots]',
				code: '// The reader reads paths, files, etc.',
				errors: [
					{
						messageId: 'term',
						data: { term: 'etc.', replacement: 'bound the list, or recast the sentence' },
					},
				],
			},
			{
				name: 'rejects performant [membership: comment prose outside code, tags, and addresses]',
				code: '// The path is performant.',
				errors: [
					{ messageId: 'term', data: { term: 'performant', replacement: 'the measured property' } },
				],
			},
			{
				name: 'rejects robust [membership: comment prose outside code, tags, and addresses]',
				code: '// The path is robust.',
				errors: [
					{ messageId: 'term', data: { term: 'robust', replacement: 'the measured property' } },
				],
			},
			{
				name: 'rejects robustness [membership: the inflections one row reaches]',
				code: '// The path has robustness.',
				errors: [
					{ messageId: 'term', data: { term: 'robust', replacement: 'the measured property' } },
				],
			},
			{
				name: 'rejects allows you to [membership: comment prose outside code, tags, and addresses]',
				code: '// The path allows you to read.',
				errors: [{ messageId: 'term', data: { term: 'allows you to', replacement: 'lets you' } }],
			},
			{
				name: 'rejects the conjunction pair [membership: comment prose outside code, tags, and addresses]',
				code: '// The reader reads a path and/or a file.',
				errors: [{ messageId: 'term', data: { term: 'and/or', replacement: 'and, or, or both' } }],
			},
			{
				name: 'rejects please [membership: comment prose outside code, tags, and addresses]',
				code: '// Read the path, please.',
				errors: [{ messageId: 'term', data: { term: 'please', replacement: 'delete' } }],
			},
			{
				name: 'rejects the hyphenated quick check [membership: rows written with a space or a hyphen]',
				code: '// Run a sanity-check over the path.',
				errors: [{ messageId: 'term', data: { term: 'sanity check', replacement: 'quick check' } }],
			},
			{
				name: 'rejects dummy [membership: comment prose outside code, tags, and addresses]',
				code: '// The path names a dummy value.',
				errors: [{ messageId: 'term', data: { term: 'dummy', replacement: 'placeholder' } }],
			},
			{
				name: 'rejects dummies [membership: the inflections one row reaches]',
				code: '// The path names two dummies.',
				errors: [{ messageId: 'term', data: { term: 'dummy', replacement: 'placeholder' } }],
			},
			{
				name: 'rejects the refused list name [membership: comment prose outside code, tags, and addresses]',
				code: '// The path reads a blacklist.',
				errors: [{ messageId: 'term', data: { term: 'blacklist', replacement: 'denylist' } }],
			},
			{
				name: 'rejects the refused permit name [membership: comment prose outside code, tags, and addresses]',
				code: '// The path reads a whitelist.',
				errors: [{ messageId: 'term', data: { term: 'whitelist', replacement: 'allowlist' } }],
			},
			{
				name: 'rejects the refused replica name [membership: comment prose outside code, tags, and addresses]',
				code: '// The path names a slave copy.',
				errors: [{ messageId: 'term', data: { term: 'slave', replacement: 'replica' } }],
			},
		],
	})

	it('blanks a matched region without moving a line break', () => {
		expect(blankPolicyText('abc')).toBe('   ')
		expect(blankPolicyText('ab\ncd')).toBe('  \n  ')
	})

	it('blanks every code, tag, and address region while holding each later offset', () => {
		const text = [
			'A `should` span.',
			'```text',
			'should stay',
			'```',
			'A {@link Example.should} tag.',
			'Read https://example.test/should/row here.',
			'A reader should meet this row.',
		].join('\n')
		const stripped = stripPolicyCode(text)
		expect(stripped).toHaveLength(text.length)
		expect(stripped.split('\n')).toHaveLength(text.split('\n').length)
		const hits = textToPolicyHits(stripped)
		expect(hits.map((hit) => hit.term.term)).toEqual(['should'])
		expect(text.slice(hits[0]?.index ?? -1, (hits[0]?.index ?? 0) + 6)).toBe('should')
	})

	it('reads every banned-term hit in offset order with the row it matched', () => {
		const hits = textToPolicyHits('The reader utilizes a path and arrives via a file.')
		expect(hits.map((hit) => hit.term.term)).toEqual(['utilize', 'via'])
		expect(hits.map((hit) => hit.term.replacement)).toEqual(['use', 'through, by using'])
		expect(hits[0]?.index).toBeLessThan(hits[1]?.index ?? 0)
		expect(textToPolicyHits('The reader reads one path.')).toEqual([])
	})

	it('reads a description paragraph up to its first block tag', () => {
		expect(
			commentToPolicyParagraph({
				type: 'Block',
				value: '*\n * Creates a control.\n *\n * @param value - Reports the state.\n ',
				range: [0, 0],
			}),
		).toBe('Creates a control.')
		expect(
			commentToPolicyParagraph({ type: 'Block', value: '* Creates a control. ', range: [0, 0] }),
		).toBe('Creates a control.')
		expect(commentToPolicyParagraph({ type: 'Block', value: '* ', range: [0, 0] })).toBe('')
	})

	describe('readers over a caller-supplied list with a hole', () => {
		// A `for…of` loop and a spread read a hole as `undefined`, where `map`, `filter`, `flatMap`, and
		// `findLast` skip it or stop before it, so each case puts the hole where the reader would not
		// reach it and pins the refusal the loop gave.
		const name: PolicyExpression = { type: 'Identifier', range: [0, 0], name: 'run' }
		const exported: PolicyExpression = {
			type: 'ExportNamedDeclaration',
			range: [47, 63],
			declaration: { type: 'FunctionDeclaration', range: [0, 0], id: name },
		}
		const source = createPolicySource('')

		it('refuses a hole in the declarators of a statement as the declarator it reads as', () => {
			const declarator: PolicyExpression = {
				type: 'VariableDeclarator',
				range: [0, 0],
				id: name,
				init: { type: 'ArrowFunctionExpression', range: [0, 0] },
			}

			expect(
				statementToPolicyBindings({
					type: 'VariableDeclaration',
					range: [0, 0],
					declarations: [declarator],
				}),
			).toHaveLength(1)
			expect(() =>
				statementToPolicyBindings({
					type: 'VariableDeclaration',
					range: [0, 0],
					declarations: createPolicySparse(2, new Map([[0, declarator]])),
				}),
			).toThrow(TypeError)
		})

		it('refuses a hole in the statements of a program as the statement it reads as', () => {
			const program: PolicyExpression = {
				type: 'Program',
				range: [0, 0],
				body: createPolicySparse(2, new Map([[0, exported]])),
			}

			expect(() => programToPolicyDocs(program, source)).toThrow(TypeError)
		})

		it('refuses a hole in the comments of a source as the comment it reads as', () => {
			const comment: PolicyComment = { type: 'Block', value: '* One.', range: [0, 11] }
			const comments = createPolicySparse(2, new Map([[1, comment]]))
			const program: PolicyExpression = { type: 'Program', range: [0, 0], body: [exported] }

			expect(() =>
				programToPolicyDocs(program, { text: '/** One. */\n', getAllComments: () => comments }),
			).toThrow(TypeError)
		})

		it('refuses a hole in the body of a function-domain module as the statement it reads as', () => {
			const reports: PolicyDiagnostic[] = []
			const context = createPolicyContext('/ws/src/server/execution/run.ts', '/ws', reports)
			const dense: PolicyExpression = { type: 'Program', range: [0, 0], body: [exported] }
			const sparse: PolicyExpression = {
				type: 'Program',
				range: [0, 0],
				body: createPolicySparse(2, new Map([[0, exported]])),
			}

			reportDomain(context, dense)
			expect(reports).toStrictEqual([])
			expect(() => reportDomain(context, sparse)).toThrow(TypeError)
		})
	})

	it('reads the opening word of a paragraph as its letters alone', () => {
		expect(paragraphToPolicyOpener('Creates a control.')).toBe('Creates')
		expect(paragraphToPolicyOpener('"Creates" a control.')).toBe('Creates')
		expect(paragraphToPolicyOpener('')).toBe('')
	})

	it('admits a third-person opener and refuses a registered non-verb', () => {
		expect(isPolicyVoiced('Creates')).toBe(true)
		expect(isPolicyVoiced('Is')).toBe(true)
		expect(isPolicyVoiced('This')).toBe(false)
		expect(isPolicyVoiced('Status')).toBe(false)
		expect(isPolicyVoiced('Create')).toBe(false)
		expect(isPolicyVoiced('')).toBe(false)
		expect(POLICY_VOICE_STOPWORDS.every((word) => /^[A-Z][a-z]*s$/u.test(word))).toBe(true)
	})

	it('keeps the matched and judged term sets disjoint and frozen', () => {
		const matched = POLICY_BANNED_TERMS.map((entry) => entry.term)
		expect(matched.filter((term) => POLICY_JUDGED_TERMS.includes(term))).toEqual([])
		expect(new Set(matched).size).toBe(matched.length)
		expect(Object.isFrozen(POLICY_BANNED_TERMS)).toBe(true)
		expect(Object.isFrozen(POLICY_JUDGED_TERMS)).toBe(true)
		expect(Object.isFrozen(POLICY_VOICE_STOPWORDS)).toBe(true)
		// Every judged row reaches this file as prose, so a pattern that matched one would red the
		// workspace sweep on the rule file that names it.
		for (const term of POLICY_JUDGED_TERMS) {
			expect(textToPolicyHits(`The reader reads ${term} here.`)).toEqual([])
		}
	})

	it('registers handlers as a function kind and routes as a data kind', () => {
		expect(FUNCTION_SOURCE_FILES).toContain('handlers.ts')
		expect(FUNCTION_SOURCE_FILES).not.toContain('routes.ts')
		expect(DATA_SOURCE_FILES).toContain('routes.ts')
		expect(CENTRAL_SOURCE_FILES).toContain('handlers.ts')
	})

	it('registers plugins as a central function kind', () => {
		expect(FUNCTION_SOURCE_FILES).toContain('plugins.ts')
		expect(CENTRAL_SOURCE_FILES).toContain('plugins.ts')
		expect(DATA_SOURCE_FILES).not.toContain('plugins.ts')
	})

	it('pins the global dynamic-require setting to esmodule false with no override touching it', () => {
		const configured = readConfigRecord(
			JSON.parse(readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8')),
		)
		expect(readConfigRecord(configured.rules)['import/no-dynamic-require']).toEqual([
			'error',
			{ esmodule: false },
		])
		if (!Array.isArray(configured.overrides)) throw new Error('Missing lint overrides')
		const overrides = configured.overrides
			.map(readConfigRecord)
			.filter(
				(override) => readConfigRecord(override.rules)['import/no-dynamic-require'] !== undefined,
			)
		expect(overrides).toEqual([])
	})

	it('permits a computed import() and refuses a computed require at every module path', () => {
		const fixture = createPolicyScratch({ prefix: 'computed-imports-' })
		try {
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			const configured = readConfigRecord(
				JSON.parse(readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8')),
			)
			const required = COMPUTED_IMPORT_PATHS.map((path) => path.replace(/\.(\w+)$/u, '.require.$1'))
			for (const path of COMPUTED_IMPORT_PATHS) {
				fixture.write(path, 'const selected = process.argv[2]\nvoid import(selected)\ndebugger\n')
			}
			for (const path of required) {
				fixture.write(path, 'const selected = process.argv[2]\nvoid require(selected)\ndebugger\n')
			}
			const paths = [...COMPUTED_IMPORT_PATHS, ...required]
			// Include campaign fixtures even when the workspace's default lint walk ignores them.
			fixture.write('.oxlintrc.json', JSON.stringify({ ...configured, ignorePatterns: [] }))
			const codes = readImportDiagnostics(fixture.path, paths)
			for (const path of COMPUTED_IMPORT_PATHS) {
				expect({ path, refused: codes.has('import(no-dynamic-require) ' + path) }).toEqual({
					path,
					refused: false,
				})
			}
			for (const path of required) {
				expect({ path, refused: codes.has('import(no-dynamic-require) ' + path) }).toEqual({
					path,
					refused: true,
				})
			}
			// The sentinel proves each fixture was linted, so an unlinted path cannot read as permitted.
			for (const path of paths) expect(codes.has('eslint(no-debugger) ' + path)).toBe(true)

			// The control restores the ESM setting and must refuse the same computed imports.
			fixture.write(
				'.oxlintrc.json',
				JSON.stringify({
					...configured,
					ignorePatterns: [],
					rules: {
						...readConfigRecord(configured.rules),
						'import/no-dynamic-require': ['error', { esmodule: true }],
					},
				}),
			)
			const strict = readImportDiagnostics(fixture.path, paths)
			for (const path of paths) {
				expect({ path, refused: strict.has('import(no-dynamic-require) ' + path) }).toEqual({
					path,
					refused: true,
				})
			}
		} finally {
			fixture.destroy()
		}
	})

	it('computes Vue targets from lexical importer and workspace boundaries', () => {
		expect(POLICY_VUE_TARGET_CASES.length).toBeGreaterThan(30)
		for (const [filename, cwd, source, expected] of POLICY_VUE_TARGET_CASES) {
			expect({ filename, cwd, source, target: computePolicyTarget(filename, cwd, source) }).toEqual(
				{
					filename,
					cwd,
					source,
					target: expected,
				},
			)
		}
	})

	it('partitions every Vue syntax input between parsed and native parser-refused coverage', () => {
		const originals = [...POLICY_VUE_IMPORT_CASES, ...POLICY_VUE_COMPUTED_CASES]
		const partition = [...POLICY_VUE_PARSED_CASES, ...POLICY_VUE_PARSER_CASES]
		expect(originals).toHaveLength(312)
		expect(new Set(originals.map(({ path }) => path)).size).toBe(originals.length)
		expect(POLICY_VUE_PARSED_CASES).toHaveLength(298)
		expect(POLICY_VUE_PARSER_CASES).toHaveLength(14)
		expect(new Set(partition.map(({ path }) => path)).size).toBe(partition.length)
		expect(partition.map(({ path }) => path).toSorted()).toEqual(
			originals.map(({ path }) => path).toSorted(),
		)
		for (const original of originals) {
			expect(partition.find((source) => source.path === original.path)).toMatchObject(original)
		}
		expect(POLICY_VUE_PARSER_CASES.map(({ path }) => path).toSorted()).toEqual(
			POLICY_VUE_FACES.flatMap((face) =>
				POLICY_VUE_PARSER_ROWS.map(([file]) => `${face}/${file}`),
			).toSorted(),
		)
		expect(POLICY_VUE_PARSER_CASES.every(({ path }) => path.endsWith('.cjs'))).toBe(true)
		expect([...new Set(POLICY_VUE_POPULATIONS.map(({ extension }) => extension))]).toEqual([
			'cjs',
			'cts',
			'js',
			'jsx',
			'mjs',
			'mts',
			'ts',
			'tsx',
			'vue',
		])
		for (const face of POLICY_VUE_FACES) {
			const sources = originals.filter((source) => source.path.startsWith(face + '/'))
			expect(sources).toHaveLength(156)
			for (const population of POLICY_VUE_POPULATIONS) {
				for (const form of POLICY_VUE_IMPORT_FORMS.filter(
					(item) => !item.typed || population.typed,
				)) {
					expect(sources).toContainEqual(
						expect.objectContaining({
							path: `${face}/${population.name}${form.name}.${population.extension}`,
							boundary: true,
						}),
					)
					expect(sources).toContainEqual(
						expect.objectContaining({
							path: `${face}/features/editor/${population.name}${form.name}.${population.extension}`,
							boundary: false,
						}),
					)
				}
				for (const index of POLICY_VUE_COMPUTED_FORMS.keys()) {
					expect(sources).toContainEqual(
						expect.objectContaining({
							path: `${face}/computed${population.name}${index}.${population.extension}`,
							boundary: false,
						}),
					)
				}
			}
		}
	})

	it('checks Vue import syntax and populations through the canonical policy', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-syntax-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			for (const face of POLICY_VUE_FACES) {
				const sources = POLICY_VUE_PARSED_CASES.filter((source) =>
					source.path.startsWith(face + '/'),
				)
				expect(sources).toHaveLength(149)
				expect(sources).toContainEqual(
					expect.objectContaining({ path: `${face}/cjsdynamic.cjs`, boundary: true }),
				)
				expect(sources).toContainEqual(
					expect.objectContaining({
						path: `${face}/features/editor/cjsdynamic.cjs`,
						boundary: false,
					}),
				)
				for (const source of sources) fixture.write(source.path, source.content)
				const codes = readImportDiagnostics(
					fixture.path,
					sources.map(({ path }) => path),
				)
				expect(
					sources.map(({ path }) => ({
						path,
						boundary: codes.has('policy(no-cross-vue-face) ' + path),
						restricted: codes.has('eslint(no-restricted-imports) ' + path),
					})),
				).toEqual(sources.map(({ path, boundary, restricted }) => ({ path, boundary, restricted })))
			}
		} finally {
			fixture.destroy()
		}
	})

	it('retains exact native parser refusals for CommonJS Vue inputs on both faces', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-parser-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			const sources = POLICY_VUE_PARSER_CASES
			const paths = sources.map(({ path }) => path)
			expect(paths).toHaveLength(14)
			for (const source of sources) fixture.write(source.path, source.content)
			const diagnostics = readNativeDiagnostics(fixture.path, paths)
			expect(diagnostics).toHaveLength(paths.length)
			const comparisonRoot = realpathSync.native(fixture.path)
			const observed = diagnostics.map((diagnostic) => {
				if (typeof diagnostic.filename !== 'string')
					throw new Error('Missing parser diagnostic filename: ' + JSON.stringify(diagnostic))
				const path = normalizePolicyFilename(comparisonRoot, diagnostic.filename)
				const source = sources.find((candidate) => candidate.path === path)
				if (source === undefined)
					throw new Error('Unexpected parser diagnostic: ' + JSON.stringify(diagnostic))
				expect(diagnostic).toEqual({
					message: source.message,
					severity: 'error',
					filename: diagnostic.filename,
					labels: [{ span: source.span }],
				})
				expect(
					source.content.slice(source.span.offset, source.span.offset + source.span.length),
				).toBe(source.keyword)
				return path
			})
			expect(observed.toSorted()).toEqual(paths.toSorted())
		} finally {
			fixture.destroy()
		}
	})

	it('retains Vue independent restrictions beside exact relative diagnostics', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-boundaries-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			const sources = POLICY_VUE_BOUNDARY_CASES
			expect(sources.length).toBeGreaterThan(100)
			for (const source of sources) fixture.write(source.path, source.content)
			const codes = readImportDiagnostics(
				fixture.path,
				sources.map(({ path }) => path),
			)
			expect(
				sources.map(({ path }) => ({
					path,
					boundary: codes.has('policy(no-cross-vue-face) ' + path),
					restricted: codes.has('eslint(no-restricted-imports) ' + path),
				})),
			).toEqual(sources.map(({ path, boundary, restricted }) => ({ path, boundary, restricted })))
		} finally {
			fixture.destroy()
		}
	})

	it('detects suppressed Vue reporting in a scratch policy without weakening independent bans', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-report-control-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			const plugin = readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8')
			const marker = "context.report({ node, messageId: 'vue' })"
			expect(plugin.split(marker)).toHaveLength(2)
			fixture.write('configs/policy.ts', plugin)
			const sources = POLICY_VUE_BOUNDARY_CASES
			for (const source of sources) fixture.write(source.path, source.content)
			const paths = sources.map(({ path }) => path)
			const enabled = readImportDiagnostics(fixture.path, paths)
			const expected = sources.filter(({ boundary }) => boundary).map(({ path }) => path)
			expect(expected).toContain('src/vue/boundary0.ts')
			expect(expected).toContain('app/vue/boundary0.ts')
			expect(paths.filter((path) => enabled.has('policy(no-cross-vue-face) ' + path))).toEqual(
				expected,
			)
			fixture.write('configs/policy.ts', plugin.replace(marker, 'void node'))
			const suppressed = readImportDiagnostics(fixture.path, paths)
			const actual = paths.filter((path) => suppressed.has('policy(no-cross-vue-face) ' + path))
			expect(actual).toEqual([])
			expect(() => expect(actual).toEqual(expected)).toThrow('deeply equal')
			for (const { path, restricted } of sources) {
				expect({ path, enabled: enabled.has('eslint(no-restricted-imports) ' + path) }).toEqual({
					path,
					enabled: restricted,
				})
				expect({
					path,
					suppressed: suppressed.has('eslint(no-restricted-imports) ' + path),
				}).toEqual({ path, suppressed: restricted })
			}
		} finally {
			fixture.destroy()
		}
	})

	it('detects restored Vue relative regexes against nested canonical imports', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-regex-control-' })
		try {
			const text = readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8')
			fixture.write('.oxlintrc.json', text)
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			for (const source of POLICY_VUE_RELATIVE_SOURCES) fixture.write(source.path, source.content)
			const paths = POLICY_VUE_RELATIVE_SOURCES.map(({ path }) => path)
			const enabled = readImportDiagnostics(fixture.path, paths)
			expect(paths.filter((path) => enabled.has('eslint(no-restricted-imports) ' + path))).toEqual(
				[],
			)
			expect(paths.filter((path) => enabled.has('policy(no-cross-vue-face) ' + path))).toEqual([])
			const restoredConfiguration = readConfigRecord(JSON.parse(text))
			if (!Array.isArray(restoredConfiguration.overrides)) throw new Error('Missing lint overrides')
			const restored = restoredConfiguration.overrides.map((value: unknown) => {
				const block = readConfigRecord(value)
				const files = block.files
				const owner = POLICY_VUE_FACES.find(
					(face) =>
						Array.isArray(files) &&
						files.some((file: unknown) => typeof file === 'string' && file.startsWith(face + '/')),
				)
				if (owner === undefined) return block
				const original = POLICY_VUE_ORIGINAL_RELATIVES[owner]
				if (original === undefined) throw new Error('Missing original Vue relative pattern')
				const rules = readConfigRecord(block.rules)
				const rule = rules['no-restricted-imports']
				if (!Array.isArray(rule)) throw new Error('Missing Vue import restrictions')
				const options = readConfigRecord(rule[1])
				if (!Array.isArray(options.patterns)) throw new Error('Missing Vue import patterns')
				const patterns = options.patterns.map((patternValue: unknown): Record<string, unknown> => {
					const pattern = readConfigRecord(patternValue)
					if (pattern.message !== 'Vue faces must not depend on sibling sheet faces') return pattern
					if (typeof pattern.regex !== 'string' || !pattern.regex.endsWith(')'))
						throw new Error('Missing Vue sibling alias pattern')
					return { ...pattern, regex: pattern.regex.slice(0, -1) + '|' + original + ')' }
				})
				expect(
					patterns.filter(
						(pattern) => pattern.message === 'Vue faces must not depend on sibling sheet faces',
					),
				).toHaveLength(1)
				return {
					...block,
					rules: { ...rules, 'no-restricted-imports': [rule[0], { ...options, patterns }] },
				}
			})
			expect(
				restored.filter(
					(block) => readConfigRecord(block.rules)['policy/no-cross-vue-face'] === 'error',
				),
			).toHaveLength(2)
			fixture.write(
				'.oxlintrc.json',
				JSON.stringify({ ...restoredConfiguration, overrides: restored }),
			)
			const control = readImportDiagnostics(fixture.path, paths)
			const refused = paths.filter((path) => control.has('eslint(no-restricted-imports) ' + path))
			expect(refused).toEqual(paths)
			expect(() => expect(refused).toEqual([])).toThrow('deeply equal')
			expect(paths.filter((path) => control.has('policy(no-cross-vue-face) ' + path))).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('checks exact Vue composable membership and malformed modules through the canonical policy', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-domain-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			const sources = POLICY_VUE_DOMAIN_CASES
			expect(sources).toContainEqual({
				...POLICY_VUE_COMPOSABLE_SOURCE,
				misplaced: false,
				malformed: false,
			})
			for (const source of sources) fixture.write(source.path, source.content)
			const codes = readImportDiagnostics(
				fixture.path,
				sources.map(({ path }) => path),
			)
			expect(
				sources.map(({ path }) => ({
					path,
					misplaced: codes.has('policy(no-misplaced-function) ' + path),
					malformed: codes.has('policy(no-malformed-domain) ' + path),
				})),
			).toEqual(sources.map(({ path, misplaced, malformed }) => ({ path, misplaced, malformed })))
		} finally {
			fixture.destroy()
		}
	})

	it('detects a removed Vue composable registration in a scratch policy', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-domain-control-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			const plugin = readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8')
			const registration = /^\t'app\/vue\/composables',\r?\n/gmu
			expect(plugin.match(registration)).toHaveLength(1)
			fixture.write('configs/policy.ts', plugin)
			const source = POLICY_VUE_COMPOSABLE_SOURCE
			fixture.write(source.path, source.content)
			const enabled = readImportDiagnostics(fixture.path, [source.path])
			expect(enabled.has('policy(no-misplaced-function) ' + source.path)).toBe(false)
			expect(enabled.has('policy(no-malformed-domain) ' + source.path)).toBe(false)
			fixture.write('configs/policy.ts', plugin.replace(registration, ''))
			const control = readImportDiagnostics(fixture.path, [source.path])
			expect(control.has('policy(no-misplaced-function) ' + source.path)).toBe(true)
			expect(control.has('policy(no-malformed-domain) ' + source.path)).toBe(false)
			expect(() =>
				expect(control.has('policy(no-misplaced-function) ' + source.path)).toBe(false),
			).toThrow('expected')
		} finally {
			fixture.destroy()
		}
	})

	it('admits nested same-face Vue relative imports through the canonical policy', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-relative-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			for (const source of POLICY_VUE_RELATIVE_SOURCES) {
				fixture.write(source.path, source.content)
			}
			const paths = POLICY_VUE_RELATIVE_SOURCES.map(({ path }) => path)
			expect(paths).toContain('app/vue/components/Panel.vue')
			expect(paths).toContain('src/vue/features/helpers.ts')
			const codes = readImportDiagnostics(fixture.path, paths)
			const refused = paths.filter(
				(path) =>
					codes.has('eslint(no-restricted-imports) ' + path) ||
					codes.has('policy(no-cross-vue-face) ' + path),
			)
			expect(refused).toEqual([])
		} finally {
			fixture.destroy()
		}
	})

	it('admits a valid direct application Vue composable through the canonical policy', () => {
		const fixture = createPolicyScratch({ prefix: 'policy-vue-composable-' })
		try {
			fixture.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			fixture.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			const source = POLICY_VUE_COMPOSABLE_SOURCE
			expect(source.path).toBe('app/vue/composables/useTheme.ts')
			fixture.write(source.path, source.content)
			const codes = readImportDiagnostics(fixture.path, [source.path])
			expect({
				misplaced: codes.has('policy(no-misplaced-function) ' + source.path),
				malformed: codes.has('policy(no-malformed-domain) ' + source.path),
			}).toEqual({ misplaced: false, malformed: false })
		} finally {
			fixture.destroy()
		}
	})

	it('matches every isolated import pattern with refused and admitted fixtures', () => {
		const fixture = createPolicyScratch({ prefix: 'propagation-patterns-' })
		const scratch = fixture.path
		try {
			const configured = readConfigRecord(
				JSON.parse(readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8')),
			)
			if (!Array.isArray(configured.overrides)) throw new Error('Missing overrides')
			const built = configured.overrides.flatMap((value: unknown, blockIndex: number) => {
				const block = readConfigRecord(value)
				const rule = readConfigRecord(block.rules)['no-restricted-imports']
				if (!Array.isArray(rule)) return []
				const patterns = readConfigRecord(rule[1]).patterns
				if (!Array.isArray(patterns)) throw new Error('Missing restriction patterns')
				const fromPatterns = patterns.map((patternValue: unknown, patternIndex: number) => {
					const pattern = readConfigRecord(patternValue)
					const message = pattern.message
					if (typeof message !== 'string') throw new Error('Missing pattern message')
					const alias = /@src\/(core|browser|server) alias/u.exec(message)?.[1]
					const fence = POLICY_IMPORT_CASES.find(({ marker }) => message.includes(marker))
					const chained: ReadonlyArray<readonly [string, boolean]> =
						alias !== undefined
							? [
									[`../${alias}/index.js`, true],
									[`../../${alias}/types.js`, true],
									[`../../src/${alias}/index.js`, true],
									[`../${alias}`, true],
									[`../${alias}/`, true],
									[`../${alias}?raw`, true],
									[`../${alias}#fragment`, true],
									[`@src/${alias}`, false],
									[`./${alias}/index.js`, false],
									[`../${alias}x/index.js`, false],
									[`../${alias}.ext/index.js`, false],
								]
							: message.includes('self-contained')
								? [
										['./helpers.ts', true],
										['../../orkestrel-dispatch/scripts/helpers.ts', true],
										['@orkestrel/test', true],
										['fs', true],
										['', true],
										['n', true],
										['no', true],
										['nod', true],
										['node', true],
										['nodes:fs', true],
										['node:fs', false],
										['node:child_process', false],
									]
								: message.includes('URL schemes')
									? [
											['https://host/x', true],
											['data:text/plain,x', true],
											['node:fs', false],
											['n:entry', true],
											['no:entry', true],
											['nod:entry', true],
											['nodea:entry', true],
											['1bad:entry', false],
											['./data:entry', false],
										]
									: message.includes('noncanonical dot')
										? [
												['../core/../server/index.js', true],
												['../core/./index.js', true],
												['../core/index.js', false],
												['./index.js', false],
												['../../core/index.js', false],
												['.../../index.js', true],
												['.name/../index.js', true],
											]
										: message.includes('sibling sheet')
											? [
													['@src/print', true],
													// Relative refusals now belong to the canonical filename-based matrix.
													['@src/core', false],
													['@src/browser', false],
													['@src/vue', false],
													['@app/core', false],
													['@app/browser', false],
													['@src/corex', true],
													['@src/', true],
													// The app browser query is admitted there; src retains its alias refusal.
													['../browser?x', false],
													['../print.ext/index.js', false],
													...(Array.isArray(block.files) &&
													block.files.some(
														(file: unknown) =>
															typeof file === 'string' && file.startsWith('app/vue/'),
													)
														? [['@app/print', true] as const]
														: []),
												]
											: [
													[
														message.includes('absolute paths')
															? '/machine/module.js'
															: message.includes('normalized traversal')
																? './../core/index.js'
																: message.includes('forward slashes')
																	? '..\\core\\index.js'
																	: message.includes('compiler API')
																		? 'typescript'
																		: message.includes('private app')
																			? '@app/core'
																			: message.includes('stylesheets')
																				? './index.css'
																				: message.includes('host-independent') ||
																					  message.includes('Node or server')
																					? 'node:fs'
																					: message.includes('Vue extension')
																						? '@src/vue'
																						: '@src/browser',
														true,
													],
												]
					// A setup-module fence lists its own refused and admitted specifiers in the setup module.
					const listed = fence?.cases ?? chained
					const face =
						message.includes('another styles face') && typeof pattern.regex === 'string'
							? /@src\/(bootstrap|tailwindcss|styles)\(/u.exec(pattern.regex)?.[1]
							: undefined
					if (message.includes('another styles face') && face === undefined)
						throw new Error('Missing styles face in restriction pattern')
					const sources: ReadonlyArray<readonly [string, boolean]> =
						face === undefined
							? listed
							: [
									[`@src/${face}`, true],
									[`@src/${face}?raw`, true],
									[`@orkestrel/x/${face}`, true],
									[`../${face}/index.js`, true],
									[`../src/${face}/index.js`, true],
									[`../../src/${face}/index.js`, true],
									['@src/browser', false],
									[`@src/${face}x`, false],
									[`../${face}.ext/index.js`, false],
								]
					// A per-file glob such as `.agents/skills/*/scripts/*.ts` or `tests/setup.ts` names a
					// directory once its file part is dropped and each wildcard segment takes a sample name.
					const owner =
						Array.isArray(block.files) && typeof block.files[0] === 'string'
							? block.files[0]
									.split('/**')[0]
									?.replace(/\/[^/]*\.[a-z]+$/u, '')
									.replaceAll('*', 'sample')
							: undefined
					if (owner === undefined) throw new Error('Missing pattern owner')
					// Every relative specifier is refused in a self-contained script and in the policy
					// plugin, which imports nothing, so their admitted controls are the rows above.
					const controls =
						message.includes('self-contained') || fence?.controlled === false
							? []
							: [['./index.js', false] as const]
					const cases = [...sources, ...controls].map(([source, refusal], index) => {
						const path = `${owner}/pattern${blockIndex}_${patternIndex}_${index}.ts`
						mkdirSync(dirname(resolve(scratch, path)), { recursive: true })
						writeFileSync(
							resolve(scratch, path),
							'import * as boundary from ' + JSON.stringify(source) + '\nvoid boundary\ndebugger\n',
						)
						return { path, refusal }
					})
					return {
						cases,
						override: {
							files: cases.map(({ path }) => path),
							rules: { 'no-restricted-imports': ['error', { patterns: [pattern] }] },
						},
					}
				})
				// A path entry restricts named imports of one module, so each case imports one clause.
				const entries = readConfigRecord(rule[1]).paths
				const fromPaths = (Array.isArray(entries) ? entries : []).map(
					(entryValue: unknown, entryIndex: number) => {
						const entry = readConfigRecord(entryValue)
						const message = entry.message
						if (typeof message !== 'string' || typeof entry.name !== 'string') {
							throw new Error('Missing path entry message or module')
						}
						const named = POLICY_NAME_CASES.find(({ marker }) => message.includes(marker))
						if (named === undefined) throw new Error('Missing named import cases for a path entry')
						const owner =
							Array.isArray(block.files) && typeof block.files[0] === 'string'
								? block.files[0].replace(/\/[^/]*\.[a-z]+$/u, '').replaceAll('*', 'sample')
								: undefined
						if (owner === undefined) throw new Error('Missing path owner')
						const cases = [
							...named.refused.map((clause): [string, boolean] => [clause, true]),
							...named.admitted.map((clause): [string, boolean] => [clause, false]),
						].map(([clause, refusal], index) => {
							const path = `${owner}/path${blockIndex}_${entryIndex}_${index}.ts`
							mkdirSync(dirname(resolve(scratch, path)), { recursive: true })
							writeFileSync(
								resolve(scratch, path),
								`import { ${clause} } from ${JSON.stringify(entry.name)}\ndebugger\n`,
							)
							return { path, refusal }
						})
						return {
							cases,
							override: {
								files: cases.map(({ path }) => path),
								rules: { 'no-restricted-imports': ['error', { paths: [entry] }] },
							},
						}
					},
				)
				return [...fromPatterns, ...fromPaths]
			})
			// Each fence keeps a pattern or path entry in the configuration, so deleting one fails here
			// rather than leaving the loop above with nothing to read.
			const messages = configured.overrides.flatMap((value: unknown) => {
				const rule = readConfigRecord(readConfigRecord(value).rules)['no-restricted-imports']
				if (!Array.isArray(rule)) return []
				const options = readConfigRecord(rule[1])
				return [options.patterns, options.paths]
					.flatMap((list: unknown) => (Array.isArray(list) ? list : []))
					.map((entry: unknown) => String(readConfigRecord(entry).message))
			})
			expect(
				[...POLICY_IMPORT_CASES, ...POLICY_NAME_CASES]
					.map(({ marker }) => marker)
					.filter((marker) => !messages.some((message) => message.includes(marker))),
			).toEqual([])
			const overrides = built.map(({ override }) => override)
			const expected = new Map(
				built.flatMap(({ cases }) =>
					cases.map(({ path, refusal }): [string, boolean] => [path, refusal]),
				),
			)
			writeFileSync(
				resolve(scratch, '.oxlintrc.json'),
				JSON.stringify({ rules: { 'no-debugger': 'error' }, overrides }),
			)
			const codes = readImportDiagnostics(scratch, [...expected.keys()])
			const verdicts = [...expected].map(([path, refusal]) => ({
				path,
				expected: refusal,
				actual: codes.has('eslint(no-restricted-imports) ' + path),
			}))
			expect(verdicts.filter((verdict) => verdict.expected !== verdict.actual)).toEqual([])
			writeFileSync(
				resolve(scratch, '.oxlintrc.json'),
				JSON.stringify({ rules: { 'no-debugger': 'error', 'no-restricted-imports': 'off' } }),
			)
			const disabled = readImportDiagnostics(scratch, [...expected.keys()])
			expect(() =>
				expect(
					[...expected].filter(
						([path, refusal]) => disabled.has('eslint(no-restricted-imports) ' + path) !== refusal,
					),
				).toEqual([]),
			).toThrow('deeply equal')
		} finally {
			fixture.destroy()
		}
	})

	it('fences environment and root imports through the real linter and fails with the restriction disabled', () => {
		const fixture = createPolicyScratch({ prefix: 'propagation-imports-' })
		const scratch = fixture.path
		try {
			mkdirSync(resolve(scratch, 'configs'))
			writeFileSync(
				resolve(scratch, 'configs/policy.ts'),
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts')),
			)
			const text = readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8')
			writeFileSync(resolve(scratch, '.oxlintrc.json'), text)
			const faces = ['bootstrap', 'tailwindcss', 'styles']
			const expected = new Map([
				...[
					'src/vue',
					'app/vue',
					'src/browser',
					'src/bootstrap',
					'src/tailwindcss',
					'src/styles',
					'app/browser',
					'src/core',
					'app/core',
					'src/server',
					'app/server',
					'src/bin',
				].flatMap((owner) => {
					const sheet = ['src/bootstrap', 'src/tailwindcss', 'src/styles'].includes(owner)
					const refused: ReadonlyArray<string | readonly [string, string]> = [
						...(owner.endsWith('/vue')
							? [
									'node:fs',
									'@src/server',
									'../server/index.js',
									'@src/print',
									'../print/index.js',
									...(owner.startsWith('src/')
										? ['@app/core', '../../app/core/index.js']
										: ['@app/server', '@app/print']),
								]
							: [
									'vue',
									'vue/runtime-dom',
									'@vue/runtime-core',
									'@vitejs/plugin-vue',
									'@src/vue',
									'@orkestrel/sample/vue',
									'@app/vue',
									'../vue/index.js',
									'../../src/vue/index.js',
									'../../app/vue/index.js',
								]),
						...(owner === 'src/core' ? ['@src/browser', './index.css'] : []),
						...(sheet
							? [
									'node:fs',
									'@src/server',
									'../server/index.js',
									'@app/core',
									...faces
										.filter((face) => owner !== `src/${face}`)
										.flatMap((face): ReadonlyArray<string | readonly [string, string]> => [
											`@src/${face}`,
											`@orkestrel/x/${face}`,
											`../${face}/index.js`,
											`../src/${face}/index.js`,
											`../../src/${face}/index.js`,
											['export * from', `@src/${face}`],
											['import type * as boundary from', `@src/${face}`],
										]),
								]
							: []),
						...(['src/browser', 'src/server', 'src/vue', 'src/bin'].includes(owner)
							? ['../core/index.js', '../../src/core/index.js']
							: []),
						...(owner === 'src/vue' ? ['../browser/index.js', '../../src/browser/index.js'] : []),
						...(owner === 'src/bin' ? ['../server/index.js', '../../src/server/index.js'] : []),
					]
					const admitted = [
						...(owner.endsWith('/vue')
							? [
									'@src/core',
									'@src/browser',
									'vue',
									'@vue/runtime-core',
									...(owner.startsWith('app/')
										? [
												'@app/core',
												'@app/browser',
												'@src/vue',
												'../../src/vue/index.js',
												'../browser/index.js',
											]
										: []),
								]
							: ['@src/core']),
						...(['src/browser', 'src/server', 'src/vue', 'src/bin'].includes(owner)
							? []
							: ['../core/index.js']),
						...(owner === 'src/bin' ? ['@src/server'] : []),
						...(sheet
							? [
									...faces
										.filter((face) => owner !== `src/${face}`)
										.flatMap((face) => [`@src/${face}x`, `../${face}.ext/index.js`]),
									'@src/browser',
									'./sheet.js',
									'@orkestrel/contract',
								]
							: []),
					]
					return (
						[
							[
								[
									...refused,
									'https://host/x',
									'data:text/plain,x',
									'../core/../server/index.js',
									'../core/./index.js',
								],
								true,
							],
							[
								[
									...admitted,
									'./index.js',
									...(owner.endsWith('/server') || owner === 'src/bin' ? ['node:fs'] : []),
								],
								false,
							],
						] as const
					).flatMap(([sources, refusal]) =>
						sources.map((source, index): [string, boolean] => {
							const file = owner + '/' + (refusal ? 'refused' : 'admitted') + index + '.ts'
							mkdirSync(dirname(resolve(scratch, file)), { recursive: true })
							writeFileSync(
								resolve(scratch, file),
								typeof source === 'string'
									? 'import * as boundary from ' +
											JSON.stringify(source) +
											'\nvoid boundary\ndebugger\n'
									: source[0] + ' ' + JSON.stringify(source[1]) + '\ndebugger\n',
							)
							return [file, refusal]
						}),
					)
				}),
				...(
					[
						['probe.config.ts', 'typescript', true],
						['allowed.config.ts', 'node:fs', false],
						['src/core/compiler.ts', 'typescript', true],
						['tests/compiler.ts', 'typescript', true],
						['configs/compiler.ts', 'typescript', true],
						['scripts/compiler.ts', 'typescript', true],
					] as const
				).map(([file, source, refusal]): [string, boolean] => {
					mkdirSync(dirname(resolve(scratch, file)), { recursive: true })
					writeFileSync(
						resolve(scratch, file),
						'import * as boundary from ' + JSON.stringify(source) + '\nvoid boundary\ndebugger\n',
					)
					return [file, refusal]
				}),
			])
			const reports = [false, true].map((disabled) => {
				if (disabled) {
					const parsed: unknown = JSON.parse(text)
					if (typeof parsed !== 'object' || parsed === null)
						throw new Error('Missing lint configuration')
					const overrides: unknown = Object.getOwnPropertyDescriptor(parsed, 'overrides')?.value
					if (!Array.isArray(overrides)) throw new Error('Missing lint overrides')
					for (const block of overrides) {
						if (typeof block !== 'object' || block === null) continue
						const files: unknown = Object.getOwnPropertyDescriptor(block, 'files')?.value
						if (
							!Array.isArray(files) ||
							!files.some(
								(file: unknown) => typeof file === 'string' && file.startsWith('src/vue/'),
							)
						)
							continue
						const rules: unknown = Object.getOwnPropertyDescriptor(block, 'rules')?.value
						if (typeof rules !== 'object' || rules === null) throw new Error('Missing Vue rules')
						Reflect.set(rules, 'no-restricted-imports', 'off')
					}
					writeFileSync(resolve(scratch, '.oxlintrc.json'), JSON.stringify(parsed))
				}
				return readImportDiagnostics(scratch, [...expected.keys()])
			})
			const [enabled, disabled] = reports
			if (enabled === undefined || disabled === undefined)
				throw new Error('Missing boundary readings')
			const verdicts = [...expected].map(([path, refusal]) => ({
				path,
				expected: refusal,
				actual:
					enabled.has('eslint(no-restricted-imports) ' + path) ||
					enabled.has('policy(no-cross-vue-face) ' + path),
			}))
			expect(verdicts.filter((verdict) => verdict.actual !== verdict.expected)).toEqual([])
			const control = [...expected].map(([path, refusal]) => ({
				path,
				expected: refusal,
				actual:
					disabled.has('eslint(no-restricted-imports) ' + path) ||
					disabled.has('policy(no-cross-vue-face) ' + path),
			}))
			expect(() =>
				expect(control.filter((verdict) => verdict.actual !== verdict.expected)).toEqual([]),
			).toThrow('deeply equal')
			expect(control).toContainEqual({ path: 'src/vue/refused3.ts', expected: true, actual: false })
			expect(control).toContainEqual({ path: 'src/vue/refused8.ts', expected: true, actual: false })
		} finally {
			fixture.destroy()
		}
	})

	it('enables every plugin rule over the population its law names', () => {
		const parsed: unknown = JSON.parse(readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
		const rules: unknown = Object.getOwnPropertyDescriptor(policyPlugin, 'rules')?.value
		if (typeof rules !== 'object' || rules === null) {
			throw new Error('The policy plugin declares no rules')
		}
		const declared = Object.getOwnPropertyNames(rules)
		expect(declared).toContain('no-misplaced-function')
		expect(declared).toContain('no-host-line-endings')
		expect(declared).toContain('no-cross-vue-face')
		expect(declared).toContain('no-malformed-script')
		expect(declared).toContain('no-mutable-property')
		expect(
			inspectPolicyWiring(
				parsed,
				declared.map((name) => `policy/${name}`),
				[POLICY_PLACEMENT_GLOBS, POLICY_ENDING_GLOBS, POLICY_SCRIPT_GLOBS, POLICY_NESTED_GLOBS],
			),
		).toEqual([])
		// The controls: a configuration with the skill-script override or the nested-function
		// override removed reports the population it no longer declares.
		const overrides: unknown = Object.getOwnPropertyDescriptor(parsed, 'overrides')?.value
		if (!Array.isArray(overrides)) throw new Error('The Oxlint configuration has no overrides')
		for (const population of [POLICY_SCRIPT_GLOBS, POLICY_NESTED_GLOBS]) {
			const trimmed = {
				...readConfigRecord(parsed),
				overrides: overrides.filter((override: unknown) => {
					const files = readConfigRecord(override).files
					return !Array.isArray(files) || files.join(' ') !== population.join(' ')
				}),
			}
			expect(
				inspectPolicyWiring(
					trimmed,
					[],
					[POLICY_PLACEMENT_GLOBS, POLICY_ENDING_GLOBS, POLICY_SCRIPT_GLOBS, POLICY_NESTED_GLOBS],
				),
			).toEqual([`no override files list declares the population exactly: ${population.join(' ')}`])
		}
		// The control: the script override keeps its exact population while the rule it enables is
		// set to off, which names the rule as enabled by no record.
		const disabled = {
			...readConfigRecord(parsed),
			overrides: overrides.map((override: unknown) => {
				const record = readConfigRecord(override)
				return Object.hasOwn(readConfigRecord(record.rules ?? {}), 'policy/no-malformed-script')
					? {
							...record,
							rules: { ...readConfigRecord(record.rules), 'policy/no-malformed-script': 'off' },
						}
					: record
			}),
		}
		expect(
			inspectPolicyWiring(disabled, ['policy/no-malformed-script'], [POLICY_SCRIPT_GLOBS]),
		).toEqual(['policy/no-malformed-script is enabled by no top-level or override rules record'])
	})

	it('loads every configured policy rule through the real binary', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-policy-' })
		try {
			// Compare diagnostics from the real directory while the child keeps the scratch cwd.
			const comparisonRoot = realpathSync.native(scratch.path)
			scratch.write('.oxlintrc.json', readFileSync(resolve(POLICY_ROOT, '.oxlintrc.json'), 'utf8'))
			scratch.write(
				'configs/policy.ts',
				readFileSync(resolve(POLICY_ROOT, 'configs/policy.ts'), 'utf8'),
			)
			scratch.write(
				'src/violations/fixture.ts',
				[
					'// A reader should meet this term.',
					"vi.mock('./x')",
					'class PrivateMember { private value = 1 }',
					'class ParameterMember { constructor(readonly value: string) {} }',
					'class PublicMember { public value = 1 }',
					'function OuterFunction() { const nested = () => undefined; return nested() }',
					"import * as os from 'node:os'",
					"import { EOL } from 'node:os'",
					'export interface ValueInterface { readonly id: string }',
					'/** The opener, a noun phrase. */',
					"export const STATUS = 'ready'",
					"export const lines = text.trim().split('\\n')",
					'export const ending = os.EOL + EOL',
					'let counter = 0',
					'counter++',
					'let unchanged = 1',
					'var legacy = 1',
					'function shiftValue(value: number) { value += 1; return value }',
					'try { void counter } catch (error) { error = undefined; void error }',
					'void unchanged',
					'void legacy',
					'void shiftValue',
					'void PrivateMember',
					'void ParameterMember',
					'void PublicMember',
					'void OuterFunction',
				].join('\n'),
			)
			scratch.write(
				'src/violations/helpers.ts',
				['function buildValue(): void {}', 'void buildValue'].join('\n'),
			)
			scratch.write('src/violations/parsers.ts', 'export function coerceValue(): void {}\n')
			scratch.write('src/violations/factories.ts', 'export function buildValue(): void {}\n')
			scratch.write('src/violations/plugins.ts', 'export function registerModal(): void {}\n')
			scratch.write('src/violations/constants.ts', 'export const values = []\n')
			scratch.write('src/violations/composables.ts', "export const READY = 'yes'\n")
			scratch.write('app/browser/composables/useTheme.ts', 'export function useMode(): void {}\n')
			scratch.write('app/vue/helpers.ts', "export * from '../print/index.js'\ndebugger\n")
			scratch.write(
				'.agents/skills/sample/scripts/shared.ts',
				["import { readOption } from './helpers.ts'", 'void readOption'].join('\n'),
			)
			// The fence reads a dynamic specifier as it reads a static one, and the empty specifier opens
			// with no `node:` as every other refused specifier does.
			scratch.write(
				'.agents/skills/sample/scripts/dynamic.ts',
				[
					'/** Loads a sibling. */',
					"export function load(): Promise<unknown> { return import('./other.ts') }",
				].join('\n'),
			)
			scratch.write(
				'.agents/skills/sample/scripts/empty.ts',
				[
					'/** Loads nothing. */',
					"export function load(): Promise<unknown> { return import('') }",
				].join('\n'),
			)
			scratch.write(
				'.agents/skills/sample/scripts/alone.ts',
				["import { readFileSync } from 'node:fs'", 'void readFileSync'].join('\n'),
			)
			// A script that hides a declaration, exports one with no doc block, and runs at import draws
			// every message; the conforming script beside it draws none, and its `debugger` statement
			// sits inside a function, outside the top-level statements the script rule reads, so the
			// root `no-debugger` rule proves the file entered the run.
			scratch.write(
				'.agents/skills/sample/scripts/malformed.ts',
				[
					'function hidden(): void {}',
					'export function bare(): void {}',
					'hidden()',
					'bare()',
				].join('\n'),
			)
			scratch.write(
				'.agents/skills/sample/scripts/conforming.ts',
				[
					"import { realpathSync } from 'node:fs'",
					'',
					'/** Reads the one value. */',
					'export function read(): number {',
					'\tdebugger',
					'\treturn 1',
					'}',
					'',
					'/** Runs the script. */',
					'export function main(): number {',
					'\treturn read()',
					'}',
					'',
					'if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === import.meta.filename) {',
					'\tprocess.exitCode = main()',
					'}',
				].join('\n'),
			)
			// Every form of write to a parameter or a catch binding draws the built-in rule, one file per
			// form so that a form the binary misses names itself.
			const reassignments = [
				{
					file: 'param-update',
					code: 'no-param-reassign',
					source: 'export function f(a: number) { a++; return a }',
				},
				{
					file: 'param-array-target',
					code: 'no-param-reassign',
					source: 'export function f(b: number[]) { ;[b] = [[1]]; return b }',
				},
				{
					file: 'param-object-target',
					code: 'no-param-reassign',
					source: 'export function f(c: object) { ;({ c } = { c: {} }); return c }',
				},
				{
					file: 'param-for-in-head',
					code: 'no-param-reassign',
					source: 'export function f(e: string, c: object) { for (e in c) void e; return e }',
				},
				{
					file: 'param-for-of-head',
					code: 'no-param-reassign',
					source: "export function f(e: string) { for (e of ['x']) void e; return e }",
				},
				{
					file: 'catch-update',
					code: 'no-ex-assign',
					source: 'try { void 0 } catch (err) { err++ }',
				},
				{
					file: 'catch-destructured',
					code: 'no-ex-assign',
					source: "try { void 0 } catch ({ message }) { message = 'x' }",
				},
				{
					file: 'catch-for-of-head',
					code: 'no-ex-assign',
					source: 'try { void 0 } catch (err) { for (err of [1]) void err }',
				},
			].map(({ file, code, source }) => ({
				code: `eslint(${code})`,
				filename: `src/violations/reassign/${file}.ts`,
				source,
			}))
			for (const { filename, source } of reassignments) scratch.write(filename, source)
			// An ambient block holds a `let` with no value and no `declare` flag of its own, and the
			// `debugger` statement proves the file entered the run the absence assertion reads.
			scratch.write(
				'src/violations/ambient.ts',
				[
					'declare global { let ambientGlobal: number }',
					"declare module 'ambient-module' { export let ambientExport: string }",
					'debugger',
					'export {}',
				].join('\n'),
			)
			scratch.write(
				'src/violations/types.ts',
				[
					'/** Describes a mutable record. */',
					'export interface MutableRecord { id: string }',
					'/** Describes a frozen record. */',
					'export interface FrozenRecord { readonly id: string }',
					'/** Aliases an object type. */',
					'export type MutableAlias = { value: number }',
					'/** Reads one field through an inline parameter type. */',
					'export type Reader = (options: { id: string }) => string',
				].join('\n'),
			)
			// The setup-module fences replace the generic tests restriction for the files they name,
			// and the proofs beside them keep the generic one. The `debugger` statement proves each file
			// entered the run.
			scratch.write(
				'tests/setup.ts',
				["import { readFileSync } from 'node:fs'", "import { ref } from 'vue'", 'debugger'].join(
					'\n',
				),
			)
			scratch.write(
				'tests/setupBrowser.ts',
				[
					"import { describe, it } from 'vitest'",
					"import { readFileSync } from 'node:fs'",
					'debugger',
				].join('\n'),
			)
			scratch.write(
				'tests/setupServer.ts',
				["import { expect } from 'vitest'", 'debugger'].join('\n'),
			)
			scratch.write(
				'tests/setupPolicy.ts',
				["import { readFileSync } from 'node:fs'", "import { vi } from 'vitest'", 'debugger'].join(
					'\n',
				),
			)
			scratch.write(
				'tests/setupStyles.ts',
				["import { TestRunner } from 'vitest'", 'debugger'].join('\n'),
			)
			scratch.write(
				'tests/setup.test.ts',
				["import { describe, expect, it } from 'vitest'", 'debugger'].join('\n'),
			)
			scratch.write(
				'tests/setupServer.bench.ts',
				["import { describe, expect, it } from 'vitest'", 'debugger'].join('\n'),
			)
			scratch.write(
				'tests/titles.test.ts',
				[
					"import { expect, it } from 'vitest'",
					"it('reads one value', () => expect(1).toBe(1))",
					"it('reads one value', () => expect(2).toBe(2))",
				].join('\n'),
			)
			// The line-ending population reaches src, app, and configs alone, so this module
			// outside them carries the same defect and must draw no diagnostic. The `debugger`
			// statement is the arrival control the root `no-debugger` rule reports, which proves
			// the file entered the run the following absence assertion reads.
			scratch.write(
				'scripts/read.ts',
				[
					'export function readLines(text: string): readonly string[] {',
					'\tdebugger',
					"\treturn text.trim().split('\\n')",
					'}',
				].join('\n'),
			)
			scratch.write(
				'src/clean/CleanMember.ts',
				[
					'// Reads the value a caller receives.',
					'/** Holds one runtime-private value. */',
					'export class CleanMember {',
					'\t#value = 1',
					'\tvalue(): number { return this.#value }',
					'}',
				].join('\n'),
			)

			// Run oxlint's real Node entry through the current interpreter rather than the
			// `node_modules/.bin/oxlint` shim. That shim is a POSIX `sh` script — a symlink to one on
			// Linux, a `.cmd`/`.ps1` pair on Windows — and Windows `CreateProcess` cannot execute the
			// extensionless form; spawning the `.cmd` would need `shell: true`, which breaks on paths
			// containing spaces. Resolving through `createRequire` reads oxlint's own `bin` field, so
			// the entry survives hoisting, a nested `node_modules` layout, and a future rename.
			const manifestPath = createRequire(join(POLICY_ROOT, 'package.json')).resolve(
				'oxlint/package.json',
			)
			const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
			if (typeof manifest !== 'object' || manifest === null) {
				throw new Error('The oxlint package manifest is not an object')
			}
			const bin: unknown = Object.getOwnPropertyDescriptor(manifest, 'bin')?.value
			const entry: unknown =
				typeof bin === 'string'
					? bin
					: typeof bin === 'object' && bin !== null
						? Object.getOwnPropertyDescriptor(bin, 'oxlint')?.value
						: undefined
			if (typeof entry !== 'string') {
				throw new Error('The oxlint package declares no bin.oxlint entry')
			}
			const binary = resolve(dirname(manifestPath), entry)
			const config = resolve(scratch.path, '.oxlintrc.json')
			const violations = spawnSync(
				process.execPath,
				[
					binary,
					'--config',
					config,
					'--format',
					'json',
					'src/violations',
					'app',
					'scripts',
					'tests',
					'.agents',
				],
				{ cwd: scratch.path, encoding: 'utf8', timeout: 15_000 },
			)
			const clean = spawnSync(
				process.execPath,
				[binary, '--config', config, '--format', 'json', 'src/clean'],
				{ cwd: scratch.path, encoding: 'utf8', timeout: 15_000 },
			)
			const reports = [violations, clean].map((result): string[] => {
				if (result.error !== undefined) throw result.error
				const report: unknown = JSON.parse(result.stdout)
				if (typeof report !== 'object' || report === null) {
					throw new Error('Oxlint returned no JSON report')
				}
				const diagnostics: unknown = Object.getOwnPropertyDescriptor(report, 'diagnostics')?.value
				if (!Array.isArray(diagnostics)) throw new Error('Oxlint returned no diagnostic list')
				return diagnostics.map((diagnostic: unknown) => {
					if (typeof diagnostic !== 'object' || diagnostic === null) {
						throw new Error('Oxlint returned a malformed diagnostic')
					}
					const code: unknown = Object.getOwnPropertyDescriptor(diagnostic, 'code')?.value
					const filename: unknown = Object.getOwnPropertyDescriptor(diagnostic, 'filename')?.value
					if (typeof code !== 'string' || typeof filename !== 'string') {
						throw new Error('Oxlint returned a diagnostic without a rule id and a file')
					}
					return `${code} ${normalizePolicyFilename(comparisonRoot, filename)}`
				})
			})

			const violationCodes = reports[0]
			const cleanCodes = reports[1]
			if (violationCodes === undefined || cleanCodes === undefined) {
				throw new Error('Oxlint returned no fixture reports')
			}
			expect(violations.status).toBe(1)
			for (const { code, filename } of [
				{ code: 'policy(no-mocking)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-keyword-privacy)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-let)', filename: 'src/violations/fixture.ts' },
				{ code: 'eslint(prefer-const)', filename: 'src/violations/fixture.ts' },
				{ code: 'eslint(no-var)', filename: 'src/violations/fixture.ts' },
				{ code: 'eslint(no-param-reassign)', filename: 'src/violations/fixture.ts' },
				{ code: 'eslint(no-ex-assign)', filename: 'src/violations/fixture.ts' },
				{ code: 'vitest(no-identical-title)', filename: 'tests/titles.test.ts' },
				{
					code: 'eslint(no-restricted-imports)',
					filename: '.agents/skills/sample/scripts/shared.ts',
				},
				{
					code: 'eslint(no-restricted-imports)',
					filename: '.agents/skills/sample/scripts/dynamic.ts',
				},
				{
					code: 'eslint(no-restricted-imports)',
					filename: '.agents/skills/sample/scripts/empty.ts',
				},
				{ code: 'policy(no-nested-functions)', filename: 'src/violations/fixture.ts' },
				{
					code: 'policy(no-malformed-script)',
					filename: '.agents/skills/sample/scripts/malformed.ts',
				},
				{ code: 'policy(no-mutable-property)', filename: 'src/violations/types.ts' },
				{ code: 'eslint(no-restricted-imports)', filename: 'tests/setup.ts' },
				{ code: 'eslint(no-restricted-imports)', filename: 'tests/setupBrowser.ts' },
				{ code: 'eslint(no-restricted-imports)', filename: 'tests/setupServer.ts' },
				{ code: 'policy(no-misplaced-type)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-misplaced-data)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-misplaced-function)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-misplaced-class)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-host-line-endings)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-hidden-declaration)', filename: 'src/violations/helpers.ts' },
				{ code: 'policy(no-misnamed-parser)', filename: 'src/violations/parsers.ts' },
				{ code: 'policy(no-misnamed-factory)', filename: 'src/violations/factories.ts' },
				{ code: 'policy(no-misnamed-plugin)', filename: 'src/violations/plugins.ts' },
				{ code: 'policy(no-malformed-constant)', filename: 'src/violations/constants.ts' },
				{ code: 'policy(no-malformed-domain)', filename: 'src/violations/composables.ts' },
				{ code: 'policy(no-cross-vue-face)', filename: 'app/vue/helpers.ts' },
				{ code: 'eslint(no-debugger)', filename: 'app/vue/helpers.ts' },
				{
					code: 'policy(no-malformed-domain)',
					filename: 'app/browser/composables/useTheme.ts',
				},
				{ code: 'policy(no-banned-term)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-malformed-summary)', filename: 'src/violations/fixture.ts' },
				{ code: 'typescript(parameter-properties)', filename: 'src/violations/fixture.ts' },
				{
					code: 'typescript(explicit-member-accessibility)',
					filename: 'src/violations/fixture.ts',
				},
			]) {
				expect(violationCodes).toContain(
					`${code} ${normalizePolicyFilename(comparisonRoot, filename)}`,
				)
			}
			for (const { code, filename } of reassignments) {
				expect(violationCodes).toContain(
					`${code} ${normalizePolicyFilename(comparisonRoot, filename)}`,
				)
			}
			expect(violationCodes).toContain(
				`eslint(no-debugger) ${normalizePolicyFilename(comparisonRoot, 'src/violations/ambient.ts')}`,
			)
			expect(violationCodes).not.toContain(
				`policy(no-let) ${normalizePolicyFilename(comparisonRoot, 'src/violations/ambient.ts')}`,
			)
			expect(violationCodes).toContain(
				`eslint(no-debugger) ${normalizePolicyFilename(comparisonRoot, 'scripts/read.ts')}`,
			)
			expect(violationCodes).not.toContain(
				`policy(no-host-line-endings) ${normalizePolicyFilename(comparisonRoot, 'scripts/read.ts')}`,
			)
			expect(violationCodes).not.toContain(
				`eslint(no-restricted-imports) ${normalizePolicyFilename(comparisonRoot, '.agents/skills/sample/scripts/alone.ts')}`,
			)
			// The conforming script arrives, through the `debugger` statement inside its function, and
			// draws no script diagnostic; the inline parameter type beside the two mutable properties
			// draws none either, so the types file draws exactly two.
			expect(violationCodes).toContain(
				`eslint(no-debugger) ${normalizePolicyFilename(comparisonRoot, '.agents/skills/sample/scripts/conforming.ts')}`,
			)
			expect(violationCodes).not.toContain(
				`policy(no-malformed-script) ${normalizePolicyFilename(comparisonRoot, '.agents/skills/sample/scripts/conforming.ts')}`,
			)
			expect(
				violationCodes.filter(
					(code) =>
						code ===
						`policy(no-mutable-property) ${normalizePolicyFilename(comparisonRoot, 'src/violations/types.ts')}`,
				),
			).toHaveLength(2)
			// The fences replace only the restriction of the files they name: a setup module that
			// imports a Node module or a vitest helper the law admits, a browser-enabled helper module
			// the law admits, and a setup proof that registers tests all draw the root arrival
			// diagnostic and no import restriction. A benchmark beside a setup module registers and
			// asserts as a proof does, so it is admitted the same way.
			for (const filename of [
				'tests/setupPolicy.ts',
				'tests/setupStyles.ts',
				'tests/setup.test.ts',
				'tests/setupServer.bench.ts',
			]) {
				const normalized = normalizePolicyFilename(comparisonRoot, filename)
				expect(violationCodes).toContain(`eslint(no-debugger) ${normalized}`)
				expect(violationCodes).not.toContain(`eslint(no-restricted-imports) ${normalized}`)
			}
			expect(clean.status).toBe(0)
			expect(cleanCodes).toHaveLength(0)
		} finally {
			scratch.destroy()
		}
	})
})

describe('configuration helpers', () => {
	it('resolves declared application modes and refuses undeclared modes', () => {
		const applications = { browser: true, vue: true }
		for (const mode of [undefined, 'development', 'production', 'test', 'browser']) {
			expect(configHelpers.resolveApplication(mode, applications)).toBe('browser')
		}
		expect(configHelpers.resolveApplication('vue', applications)).toBe('vue')
		expect(() => configHelpers.resolveApplication('vue', { browser: true })).toThrow(
			'The application mode "vue" is not declared.',
		)
		expect(() => configHelpers.resolveApplication('preview', applications)).toThrow(
			'The application mode "preview" is not declared.',
		)
		expect(() => configHelpers.resolveApplication('toString', applications)).toThrow(
			'The application mode "toString" is not declared.',
		)
	})

	it('hashes page bytes against SHA-256 vectors without its stamp line', () => {
		expect(configHelpers.computeStamp('')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		)
		expect(configHelpers.computeStamp('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		)
		expect(configHelpers.computeStamp('<meta name="build-id" content="old" />\nabc')).toBe(
			configHelpers.computeStamp('abc'),
		)
		expect(configHelpers.computeStamp('<meta name="build-id" content="old" />\r\nabc')).toBe(
			configHelpers.computeStamp('abc'),
		)
		expect(configHelpers.computeStamp('abd')).not.toBe(configHelpers.computeStamp('abc'))
	})

	it('stamps the final page once and refuses repeated or malformed stamp lines', () => {
		const html = '<html>\n\t<head>\n\t</head>\n</html>\n'
		const stamped = configHelpers.stampPage(html)
		expect(stamped.match(/name="build-id"/gu)).toHaveLength(1)
		expect(stamped).toContain(`content="${configHelpers.computeStamp(stamped)}"`)
		expect(configHelpers.computeStamp(stamped)).toBe(configHelpers.computeStamp(html))
		expect(configHelpers.stampPage(stamped)).toBe(stamped)
		const fixture = createPolicyScratch({ prefix: 'propagation-stamp-' })
		const scratch = fixture.path
		try {
			const path = resolve(scratch, 'page.html')
			writeFileSync(path, stamped)
			expect(configHelpers.stampPage(readFileSync(path, 'utf8'))).toBe(stamped)
			writeFileSync(path, '<meta name="build-id" content="old" />\n' + stamped)
			expect(() => configHelpers.stampPage(readFileSync(path, 'utf8'))).toThrow(
				'at most one well-formed build stamp line',
			)
		} finally {
			fixture.destroy()
		}
		expect(() =>
			configHelpers.stampPage('<meta name="build-id" content="old" />\n' + stamped),
		).toThrow('A showcase page must carry at most one well-formed build stamp line.')
		expect(() => configHelpers.stampPage('<html><head></head></html>')).toThrow(
			'A showcase page must close its head on its own line.',
		)
		expect(() => configHelpers.stampPage('<meta name="build-id" content="old">\n' + html)).toThrow(
			'A showcase page must carry at most one well-formed build stamp line.',
		)
	})

	it('resolves externals from peers, refused packages, and published siblings', () => {
		const options = {
			peers: ['sample-peer'],
			refused: ['vue', '@vue/'],
			siblings: ['C:/workspace/src/browser/index.ts'],
		}
		for (const id of [
			'node:fs',
			'@orkestrel/contract',
			'sample-peer',
			'sample-peer/subpath',
			'C:\\workspace\\src\\browser\\index.ts',
		]) {
			expect(configHelpers.resolveExternal(id, options)).toBe(true)
		}
		for (const id of [
			'@src/browser',
			'@src/core',
			'@app/vue',
			'sample-peerish',
			'./local.js',
			'vue-tools',
		]) {
			expect(configHelpers.resolveExternal(id, options)).toBe(false)
		}
		for (const id of ['vue', 'vue/runtime-dom']) {
			expect(() => configHelpers.resolveExternal(id, options)).toThrow(
				`The import ${id} is refused`,
			)
			expect(() => configHelpers.resolveExternal(id, options)).toThrow('peerDependencies')
		}
		expect(configHelpers.resolveExternal('vue', { ...options, peers: ['vue'] })).toBe(true)
		expect(configHelpers.resolveExternal('vue/runtime-dom', { ...options, peers: ['vue'] })).toBe(
			true,
		)
		expect(() =>
			configHelpers.resolveExternal('@vue/runtime-core', {
				...options,
				peers: ['vue', '@vue/runtime-core'],
			}),
		).toThrow('import from vue instead of the @vue/ implementation scope')
	})

	it('classifies Vue faces as browser owners and browser targets', () => {
		for (const owner of ['src/vue', 'app/vue']) {
			expect(configHelpers.environmentPathError(owner, 'src/server/index.ts')).toBeDefined()
			expect(configHelpers.environmentSourceError(owner, 'node:fs')).toBeDefined()
			expect(configHelpers.environmentSourceError(owner, '@src/server')).toBeDefined()
			expect(configHelpers.environmentPathError(owner, 'src/browser/index.ts')).toBeUndefined()
			expect(configHelpers.environmentSourceError(owner, '@src/browser')).toBeUndefined()
		}
		for (const owner of ['src/core', 'app/core', 'src/server', 'app/server']) {
			expect(configHelpers.environmentPathError(owner, 'src/vue/index.ts')).toBeDefined()
			expect(configHelpers.environmentPathError(owner, 'app/vue/index.ts')).toBeDefined()
			expect(configHelpers.environmentSourceError(owner, '@src/vue')).toBeDefined()
			expect(configHelpers.environmentSourceError(owner, '@app/vue')).toBeDefined()
		}
	})

	it('exposes every helper this proof requires', () => {
		const required = [
			'BuildState',
			'ENVIRONMENT_MODULE_BYTES',
			'PACKAGE_MANIFEST_BYTES',
			'WORKSPACE_ROOT',
			'attemptValue',
			'buildExtractorOverride',
			'containedPath',
			'decodeAssetSource',
			'declarationRollup',
			'enforceBuildLog',
			'enforceOutputPath',
			'environmentAssetSources',
			'environmentBoundary',
			'environmentPathError',
			'environmentSourceError',
			'fileSystemPath',
			'findPackageDirectory',
			'hasAsciiUrlControl',
			'isBoundaryExemptModule',
			'isExtractorModule',
			'isOutsideWorkspacePath',
			'isPackageBoundary',
			'isStringList',
			'isStylesheetPath',
			'isWorkspaceBoundaryModule',
			'outputBoundary',
			'packageManifestName',
			'packageNameOf',
			'packageRootForResolved',
			'packageRootOf',
			'parseProjectScope',
			'physicalPath',
			'readBoundedFile',
			'readHandleBytes',
			'readCompilerOutput',
			'resolveCompiler',
			'rewriteCoreSpecifier',
			'sourceFallback',
			'workspacePath',
		]
		const found = Object.keys(configHelpers)
		for (const name of required) expect(found).toContain(name)
	})

	it('fails broken import-meta builds and forwards every other log', () => {
		expect(() =>
			configHelpers.enforceBuildLog(
				'warn',
				{
					code: 'EMPTY_IMPORT_META',
					message: 'The import.meta meta-property is not available in CommonJS output.',
				},
				expect.unreachable,
			),
		).toThrow(
			'[orkestrel-build] The import.meta meta-property is not available in CommonJS output.',
		)

		const levels: string[] = []
		const messages: string[] = []
		configHelpers.enforceBuildLog(
			'warn',
			{ code: 'CONTROL_WARNING', message: 'The control warning remains visible.' },
			(level, log) => {
				levels.push(level)
				messages.push(typeof log === 'string' ? log : log.message)
			},
		)
		expect(levels).toStrictEqual(['warn'])
		expect(messages).toStrictEqual(['The control warning remains visible.'])
	})

	it('resolves contained workspace paths and refuses a real outside sibling', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-outside-' })
		try {
			const outside = scratch.path
			const importer = resolve(POLICY_ROOT, 'tests/config.test.ts')
			expect(configHelpers.WORKSPACE_ROOT).toBe(realpathSync.native(POLICY_ROOT))
			expect(configHelpers.fileSystemPath(`/@fs/${POLICY_ROOT}`)).toBe(POLICY_ROOT)
			expect(configHelpers.physicalPath(`${POLICY_ROOT}?control=true`)).toBe(
				realpathSync.native(POLICY_ROOT),
			)
			expect(configHelpers.sourceFallback(importer, './setup.ts')).toBe(
				resolve(POLICY_ROOT, 'tests/setup.ts'),
			)
			expect(configHelpers.sourceFallback(importer, pathToFileURL(importer).href)).toBe(importer)
			expect(configHelpers.workspacePath(importer)).toBe('tests/config.test.ts')
			expect(configHelpers.containedPath(POLICY_ROOT, importer)).toBe(true)
			expect(configHelpers.containedPath(POLICY_ROOT, outside)).toBe(false)
			expect(configHelpers.workspacePath(outside)).toBeUndefined()
			expect(configHelpers.isOutsideWorkspacePath(outside)).toBe(true)
			expect(configHelpers.isOutsideWorkspacePath('src/core/index.ts')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('reads bounded files and resolves package roots from real manifests', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-package-' })
		try {
			const workspace = scratch.path
			const packageRoot = resolve(workspace, 'node_modules/@sample/package')
			const source = resolve(packageRoot, 'src/index.ts')
			mkdirSync(dirname(source), { recursive: true })
			writeFileSync(resolve(packageRoot, 'package.json'), '{"name":"@sample/package"}', 'utf8')
			writeFileSync(source, 'export {}\n', 'utf8')
			const under = resolve(workspace, 'under.txt')
			const at = resolve(workspace, 'at.txt')
			const over = resolve(workspace, 'over.txt')
			writeFileSync(under, 'abc', 'utf8')
			writeFileSync(at, 'abcd', 'utf8')
			writeFileSync(over, 'abcde', 'utf8')

			expect(configHelpers.PACKAGE_MANIFEST_BYTES).toBe(1_048_576)
			expect(configHelpers.ENVIRONMENT_MODULE_BYTES).toBe(8_388_608)
			expect(configHelpers.readBoundedFile(under, 4)).toBe('abc')
			expect(configHelpers.readBoundedFile(at, 4)).toBe('abcd')
			expect(configHelpers.readBoundedFile(over, 4)).toBeUndefined()
			expect(configHelpers.packageNameOf('@sample/package/subpath')).toBe('@sample/package')
			expect(configHelpers.packageNameOf('vite/client')).toBe('vite')
			expect(configHelpers.packageNameOf('node:fs')).toBeUndefined()
			expect(configHelpers.packageManifestName(packageRoot)).toBe('@sample/package')
			expect(configHelpers.isPackageBoundary(packageRoot)).toBe(true)
			expect(configHelpers.packageRootOf('@sample/package', source)).toBe(
				realpathSync.native(packageRoot),
			)
			expect(configHelpers.packageRootForResolved(source)).toBe(realpathSync.native(packageRoot))
		} finally {
			scratch.destroy()
		}
	})

	it('returns a producer value, or undefined when the producer throws', () => {
		expect(configHelpers.attemptValue(() => decodeURI('%20'))).toBe(' ')
		expect(configHelpers.attemptValue(() => decodeURI('%E0%A4%A'))).toBeUndefined()
		expect(configHelpers.attemptValue(() => undefined)).toBeUndefined()
		expect(configHelpers.attemptValue(() => 0)).toBe(0)
	})

	it('fills a buffer from an open handle until it ends, and refuses a file over the limit', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-handle-' })
		try {
			// Each case is a file's text, the offset already read into the buffer, and the largest total allowed.
			const results = [
				{ text: 'abc', offset: 0, limit: 4 },
				{ text: 'abcd', offset: 0, limit: 4 },
				{ text: 'abcde', offset: 0, limit: 4 },
				{ text: '', offset: 0, limit: 4 },
				{ text: 'abc', offset: 2, limit: 10 },
				{ text: 'abc', offset: 2, limit: 4 },
			].map(({ text, offset, limit }) => {
				scratch.write('subject.txt', text)
				const handle = openSync(resolve(scratch.path, 'subject.txt'), 'r')
				try {
					const bytes = Buffer.alloc(16)
					const count = configHelpers.readHandleBytes(handle, bytes, offset, limit)
					return { count, filled: bytes.toString('utf8', offset, count ?? offset) }
				} finally {
					closeSync(handle)
				}
			})
			// A file at or under the limit answers its length; the shifted read adds the offset to the
			// length and fills the buffer past it; a file over the limit answers nothing.
			expect(results.map(({ count }) => count)).toStrictEqual([3, 4, undefined, 0, 5, undefined])
			expect(results.map(({ filled }) => filled)).toStrictEqual(['abc', 'abcd', '', '', 'abc', ''])
		} finally {
			scratch.destroy()
		}
	})

	it('finds the nearest package directory from a manifest, a package boundary, or nothing', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-find-' })
		try {
			scratch.write('held/package.json', '{"name":"held"}')
			scratch.write('held/src/deep/file.txt', '')
			scratch.write('modules/node_modules/plain/lib/file.txt', '')
			scratch.write('modules/node_modules/@scope/named/lib/file.txt', '')
			scratch.write('modules/node_modules/@scope/file.txt', '')
			const held = resolve(scratch.path, 'held')
			expect(configHelpers.findPackageDirectory(held)).toBe(held)
			expect(configHelpers.findPackageDirectory(resolve(held, 'src/deep'))).toBe(held)
			const plain = resolve(scratch.path, 'modules/node_modules/plain')
			expect(configHelpers.findPackageDirectory(resolve(plain, 'lib'))).toBe(plain)
			const named = resolve(scratch.path, 'modules/node_modules/@scope/named')
			expect(configHelpers.findPackageDirectory(resolve(named, 'lib'))).toBe(named)
			expect(configHelpers.findPackageDirectory(named)).toBe(named)
			// A scope directory alone is not a package boundary, so the walk passes it by.
			expect(
				configHelpers.isPackageBoundary(resolve(scratch.path, 'modules/node_modules/@scope')),
			).toBe(false)
			// The walk ends at the filesystem root; the answer there is the root only if it holds a manifest.
			const root = parse(scratch.path).root
			expect(configHelpers.findPackageDirectory(root)).toBe(
				existsSync(resolve(root, 'package.json')) ? root : undefined,
			)
		} finally {
			scratch.destroy()
		}
	})

	it('holds the workspace defaults until a resolved build config replaces them', async () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-state-' })
		try {
			const fresh = new configHelpers.BuildState()
			expect(fresh.building).toBe(false)
			expect(fresh.output).toBe(configHelpers.WORKSPACE_ROOT)
			expect(fresh.root).toBe(configHelpers.WORKSPACE_ROOT)
			expect(fresh.source).toBe('')
			expect(new configHelpers.BuildState('C:/output').output).toBe('C:/output')

			const entry = resolve(scratch.path, 'index.ts')
			const inline: InlineConfig = {
				root: scratch.path,
				configFile: false,
				logLevel: 'silent',
				build: { outDir: 'out', lib: { entry, formats: ['es'] } },
			}
			const buildState = new configHelpers.BuildState()
			buildState.resolve(await resolveConfig(inline, 'build'))
			expect(buildState.building).toBe(true)
			expect(buildState.output).toBe(resolve(scratch.path, 'out'))
			expect(buildState.root).toBe(realpathSync.native(scratch.path))
			expect(buildState.source).toBe(entry)

			// The control: a serve command is not a build, and a config with no library entry has no source.
			const serveState = new configHelpers.BuildState()
			serveState.resolve(await resolveConfig({ ...inline, build: { outDir: 'out' } }, 'serve'))
			expect(serveState.building).toBe(false)
			expect(serveState.source).toBe('')
		} finally {
			scratch.destroy()
		}
	})

	it('admits each physical package root once and locates the first admitted root containing a path', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-locate-' })
		try {
			scratch.write('modules/outer/inner/index.ts', '')
			scratch.write('modules/other/index.ts', '')
			const outer = realpathSync.native(resolve(scratch.path, 'modules/outer'))
			const inner = realpathSync.native(resolve(scratch.path, 'modules/outer/inner'))
			const inside = resolve(scratch.path, 'modules/outer/inner/index.ts')
			const beside = resolve(scratch.path, 'modules/other/index.ts')

			const state = new configHelpers.BuildState()
			// A fresh state admits nothing, so it locates nothing.
			expect(state.locate(inside)).toBeUndefined()
			state.trust(outer)
			state.trust(outer)
			state.trust(inner)
			expect(state.locate(inside)).toBe(outer)
			expect(state.locate(beside)).toBeUndefined()
			// Admission order decides which of two containing roots answers.
			const reversed = new configHelpers.BuildState()
			reversed.trust(inner)
			reversed.trust(outer)
			expect(reversed.locate(inside)).toBe(inner)
			expect(new configHelpers.BuildState().locate(inside)).toBeUndefined()
			// The admitted roots are never returned, so the class publishes no member that lists them.
			expect(Object.getOwnPropertyNames(configHelpers.BuildState.prototype).sort()).toEqual([
				'building',
				'constructor',
				'locate',
				'output',
				'resolve',
				'root',
				'source',
				'trust',
			])
		} finally {
			scratch.destroy()
		}
	})

	it('climbs from a policy node through its enclosing parentheses alone', () => {
		const call = { type: 'CallExpression', range: [0, 9] } satisfies PolicyExpression
		const outer = {
			type: 'ParenthesizedExpression',
			range: [1, 8],
			parent: call,
		} satisfies PolicyExpression
		const inner = {
			type: 'ParenthesizedExpression',
			range: [2, 7],
			parent: outer,
		} satisfies PolicyExpression
		const leaf = { type: 'Identifier', range: [3, 4], parent: inner } satisfies PolicyExpression
		expect(nodeToPolicyOuter(leaf)).toBe(outer)
		expect(nodeToPolicyOuter(inner)).toBe(outer)
		expect(nodeToPolicyOuter(outer)).toBe(outer)
		// The control: a node under a non-parenthesized parent, or under none, stays where it is.
		const argument = { type: 'Identifier', range: [1, 2], parent: call } satisfies PolicyExpression
		expect(nodeToPolicyOuter(argument)).toBe(argument)
		expect(nodeToPolicyOuter(call)).toBe(call)
	})

	it('classifies module boundaries and extracts static asset sources', async () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-assets-' })
		try {
			const workspace = scratch.path
			const source = resolve(workspace, 'entry.ts')
			const code =
				"const module = import('./module.js')\nconst asset = new URL('./asset%20name.png', import.meta.url)\nvoid module\nvoid asset\n"
			writeFileSync(source, code, 'utf8')

			expect(configHelpers.hasAsciiUrlControl('clean')).toBe(false)
			expect(configHelpers.hasAsciiUrlControl('line\u0000break')).toBe(true)
			expect(configHelpers.isBoundaryExemptModule('virtual:control')).toBe(true)
			expect(configHelpers.isBoundaryExemptModule(resolve(POLICY_ROOT, 'src/core/index.ts'))).toBe(
				false,
			)
			expect(
				configHelpers.isWorkspaceBoundaryModule(resolve(POLICY_ROOT, 'src/core/index.ts')),
			).toBe(true)
			expect(configHelpers.isWorkspaceBoundaryModule(source)).toBe(false)
			expect(configHelpers.isStylesheetPath('src/styles/index.scss?direct')).toBe(true)
			expect(configHelpers.isStylesheetPath('src/core/index.ts')).toBe(false)
			expect(configHelpers.decodeAssetSource('./asset%20name.png')).toBe('./asset name.png')
			expect(configHelpers.decodeAssetSource('%')).toBeUndefined()
			await expect(
				configHelpers.environmentAssetSources(readFileSync(source, 'utf8'), source),
			).resolves.toStrictEqual(['./module.js', './asset name.png'])
			await expect(
				configHelpers.environmentAssetSources(readFileSync(source, 'utf8'), source, true),
			).resolves.toStrictEqual([])
		} finally {
			scratch.destroy()
		}
	})

	it('reports environment and output boundary errors with legal controls', () => {
		expect(configHelpers.environmentPathError('src/browser', 'src/server/index.ts')).toBe(
			'Browser modules cannot depend on Node or server-only modules',
		)
		expect(configHelpers.environmentPathError('src/browser', 'src/core/index.ts')).toBeUndefined()
		expect(configHelpers.environmentSourceError('src/browser', '@src/server')).toBe(
			'Browser modules cannot depend on Node or server-only modules',
		)
		expect(configHelpers.environmentSourceError('src/browser', '@src/core')).toBeUndefined()
		const expected = resolve(POLICY_ROOT, 'dist/config-control')
		expect(() => configHelpers.enforceOutputPath(expected, expected)).not.toThrow()
		expect(() =>
			configHelpers.enforceOutputPath(resolve(POLICY_ROOT, 'dist/outside-control'), expected),
		).toThrow('Build output must use its exact configured workspace directory')
		const outside = resolve(dirname(POLICY_ROOT), 'outside-config-control')
		expect(() => configHelpers.enforceOutputPath(outside, outside)).toThrow(
			'Build output must remain inside the workspace',
		)
	})

	it('admits a computed import() through Vite at every module path while collecting literal specifiers', async () => {
		for (const path of [...COMPUTED_IMPORT_PATHS, '../outside/src/server/load.ts']) {
			await expect(
				configHelpers.environmentAssetSources(
					'void import(process.argv[2])',
					resolve(POLICY_ROOT, path),
				),
			).resolves.toEqual([])
			await expect(
				configHelpers.environmentAssetSources(
					"void import('@src/browser')",
					resolve(POLICY_ROOT, path),
				),
			).resolves.toEqual(['@src/browser'])
		}
		expect(configHelpers.environmentSourceError('src/server', '@src/browser')).toBeDefined()
	})

	it('drives each plugin through its real Vite hooks', async () => {
		const environments: ReadonlyArray<
			'src/core' | 'src/browser' | 'src/server' | 'app/core' | 'app/browser' | 'app/server'
		> = ['src/core', 'src/browser', 'src/server', 'app/core', 'app/browser', 'app/server']
		const owner = environments.find((environment) => existsSync(resolve(POLICY_ROOT, environment)))
		if (owner === undefined) throw new Error('The workspace carries no environment plugin target')
		const scratch = createPolicyScratch({
			parent: resolve(POLICY_ROOT, owner),
			prefix: 'config-build-',
		})
		const workspace = scratch.path
		try {
			const source = resolve(workspace, 'index.ts')
			writeFileSync(source, 'export const control = true\n', 'utf8')
			await expect(
				build({
					root: POLICY_ROOT,
					configFile: false,
					logLevel: 'silent',
					publicDir: false,
					plugins: [
						configHelpers.outputBoundary('dist/config-control'),
						configHelpers.environmentBoundary(owner),
					],
					build: {
						write: false,
						outDir: 'dist/config-control',
						lib: {
							entry: source,
							formats: ['es'],
							fileName: () => 'index.js',
						},
						rolldownOptions: { external: [/^node:/u, /^@orkestrel\//u] },
					},
				}),
			).resolves.toBeDefined()

			const boundary = configHelpers.environmentBoundary('src/browser')
			const hook = boundary.resolveId
			if (typeof hook !== 'function') {
				throw new Error('The environment boundary has no resolve hook')
			}
			const context = {
				error: expect.unreachable,
				resolve: Promise.resolve.bind(Promise, { id: source }),
			}
			await expect(Reflect.apply(hook, context, ['@src/server', source])).rejects.toThrow(
				'Browser modules cannot depend on Node or server-only modules',
			)
			await expect(Reflect.apply(hook, context, ['@src/core', source])).resolves.toBeNull()
		} finally {
			scratch.destroy()
		}
	})

	it('resolves the installed compiler through bin.tsc when private package paths are unexported', () => {
		const compiler = configHelpers.resolveCompiler(import.meta.url)
		expect(configHelpers.readCompilerOutput(compiler, ['--version'])).toMatch(/^Version \d+\./u)
		const scratch = createPolicyScratch({ prefix: 'orkestrel-compiler-exports-' })
		try {
			const root = join(scratch.path, 'node_modules/typescript')
			scratch.write('package.json', '{"type":"module"}')
			scratch.write(
				'node_modules/typescript/package.json',
				JSON.stringify({
					name: 'typescript',
					exports: { './package.json': './package.json' },
					bin: { tsc: relative(root, compiler) },
				}),
			)
			const path = join(scratch.path, 'package.json')
			expect(() => createRequire(path).resolve('typescript/bin/tsc')).toThrow(
				'not defined by "exports"',
			)
			expect(configHelpers.resolveCompiler(path)).toBe(compiler)
			expect(
				configHelpers.readCompilerOutput(configHelpers.resolveCompiler(path), ['--version']),
			).toMatch(/^Version \d+\./u)
			scratch.write('consumer.ts', 'const value: string = 1\nconsole.log(value)\n')
			const refused = spawnSync(
				process.execPath,
				[compiler, '--noEmit', '--pretty', 'false', '--skipLibCheck', 'consumer.ts'],
				{ cwd: scratch.path, encoding: 'utf8', windowsHide: true },
			)
			expect(refused.status).toBeGreaterThan(0)
			expect(refused.stdout).toContain('error TS2322')
			scratch.write('consumer.ts', "const value: string = 'accepted'\nconsole.log(value)\n")
			const accepted = spawnSync(
				process.execPath,
				[compiler, '--noEmit', '--pretty', 'false', '--skipLibCheck', 'consumer.ts'],
				{ cwd: scratch.path, encoding: 'utf8', windowsHide: true },
			)
			expect(accepted.status, `${accepted.stdout}${accepted.stderr}`).toBe(0)
		} finally {
			scratch.destroy()
		}
	})

	it.each([{}, { bin: null }, { bin: { tsc: 7 } }])(
		'refuses a compiler manifest without a bin.tsc command: %s',
		(declared) => {
			const scratch = createPolicyScratch({ prefix: 'orkestrel-compiler-manifest-' })
			try {
				scratch.write('package.json', '{"type":"module"}')
				scratch.write('node_modules/typescript/package.json', JSON.stringify(declared))
				expect(() => configHelpers.resolveCompiler(join(scratch.path, 'package.json'))).toThrow(
					'The TypeScript package declares no bin.tsc command',
				)
			} finally {
				scratch.destroy()
			}
		},
	)

	// The scope reading applies only where the workspace publishes source from `src`, which is what
	// `publishes` reads, and the name ends at that mechanism. An absent face project is the defect
	// this case exists to report rather than a second reason to excuse it, so a workspace holding
	// the axis and vendoring no `configs/src/` wrapper reaches the throw inside the body.
	// A skip raises the run's skipped count where a guard inside the case would
	// raise its passed count with nothing measured. Every generated workspace runs its projects
	// under `--reporter=dot`, which prints a skip as an unnamed `-`, so the case name and the
	// condition in it are read by re-running the project with a reporter that names skipped cases.
	it.skipIf(!POLICY_PUBLISHES)(
		'reads the compiler scope a declaration roll-up requires [inapplicable where src holds no recognized environment directory]',
		() => {
			const compiler = configHelpers.resolveCompiler(import.meta.url)
			// The order mirrors ENVIRONMENTS in src/core/constants.ts; a server-only workspace vendors
			// no core project, so this walks to the first face the workspace actually carries.
			const faces = ['core', 'browser', 'server']
			const face = faces.find((candidate) =>
				existsSync(resolve(POLICY_ROOT, `configs/src/tsconfig.${candidate}.json`)),
			)
			if (face === undefined) throw new Error('The workspace declares no face project')
			const project = resolve(POLICY_ROOT, `configs/src/tsconfig.${face}.json`)
			const declared: unknown = JSON.parse(readFileSync(project, 'utf8'))
			if (typeof declared !== 'object' || declared === null) {
				throw new Error(`The ${face} project is not a TypeScript configuration record`)
			}
			const declaredOptions: unknown = Object.getOwnPropertyDescriptor(
				declared,
				'compilerOptions',
			)?.value
			if (typeof declaredOptions !== 'object' || declaredOptions === null) {
				throw new Error(`The ${face} project carries no compiler options`)
			}
			const declaredLib: unknown = Object.getOwnPropertyDescriptor(declaredOptions, 'lib')?.value
			const declaredTypes: unknown = Object.getOwnPropertyDescriptor(
				declaredOptions,
				'types',
			)?.value
			if (!configHelpers.isStringList(declaredLib) || !configHelpers.isStringList(declaredTypes)) {
				throw new Error(`The ${face} project declares no lib or types`)
			}
			const declaredRootDir: unknown = Object.getOwnPropertyDescriptor(
				declaredOptions,
				'rootDir',
			)?.value
			if (typeof declaredRootDir !== 'string') {
				throw new Error(`The ${face} project declares no rootDir`)
			}
			const expectedRoot = resolve(dirname(project), declaredRootDir)

			const scope = configHelpers.parseProjectScope(
				configHelpers.readCompilerOutput(compiler, ['--showConfig', '-p', project]),
				project,
			)
			if (scope === undefined) throw new Error(`The ${face} project resolved no compiler scope`)
			// The compiler lowercases every resolved library name, so the committed project is the
			// second mechanism this reading is compared against rather than the reading itself.
			expect(scope.lib.map((entry) => entry.toLowerCase())).toStrictEqual(
				declaredLib.map((entry) => entry.toLowerCase()),
			)
			expect(scope.types).toStrictEqual(declaredTypes)
			expect(scope.root).toBe(expectedRoot)
		},
	)

	// No reading in this case reads anything under `configs/src/`, so each one applies to a workspace
	// on either axis. The refusals are decided by the text handed to them; the compiler refusal by a
	// path no workspace shape carries; the manifest name, the module resolution, and the extractor
	// guard by files and packages a workspace carries on either axis. They sit apart from the
	// preceding scope reading for that reason: the skip that excuses an app-only workspace from
	// reading a face project must not excuse it from the helpers behind the roll-up, which it
	// vendors whether or not it publishes.
	it('reads the refusals, guards, overrides, and rewrites a declaration roll-up requires from every workspace', () => {
		const compiler = configHelpers.resolveCompiler(import.meta.url)
		// Any project path resolves these, because each reading is refused by the text before the
		// path is read. The root project is the one file every workspace carries.
		const project = resolve(POLICY_ROOT, 'tsconfig.json')
		expect(configHelpers.parseProjectScope('not a configuration', project)).toBeUndefined()
		expect(
			configHelpers.parseProjectScope('{"compilerOptions":{"lib":[],"types":[]}}', project),
		).toBeUndefined()
		expect(
			configHelpers.parseProjectScope('{"compilerOptions":{"lib":[1],"rootDir":"."}}', project),
		).toBeUndefined()
		// The compiler's own refusal, read from a path no workspace shape carries.
		expect(() =>
			configHelpers.readCompilerOutput(compiler, [
				'--showConfig',
				'-p',
				resolve(POLICY_ROOT, 'configs/tsconfig.absent.json'),
			]),
		).toThrow('The declaration compiler failed')

		expect(configHelpers.isStringList(['a', 'b'])).toBe(true)
		expect(configHelpers.isStringList([])).toBe(true)
		expect(configHelpers.isStringList(['a', 1])).toBe(false)
		expect(configHelpers.isStringList('a')).toBe(false)

		// The extractor runs its own bundled engine, so this override is the whole option set the
		// roll-up may hand it: passing more leaves that engine unable to follow a symbol.
		expect(
			configHelpers.buildExtractorOverride('/w/dist/index.d.ts', ['esnext'], ['node']),
		).toStrictEqual({
			compilerOptions: {
				types: ['node'],
				lib: ['esnext'],
				target: 'ESNext',
				module: 'ESNext',
				moduleResolution: 'bundler',
				skipLibCheck: true,
				strict: true,
			},
			files: ['/w/dist/index.d.ts'],
		})

		const name = configHelpers.packageManifestName(configHelpers.WORKSPACE_ROOT)
		if (name === undefined) throw new Error('The workspace manifest names no package')
		expect(configHelpers.rewriteCoreSpecifier("from '@src/core'")).toBe(`from '${name}'`)
		expect(configHelpers.rewriteCoreSpecifier("from '../../core/index.js'")).toBe(`from '${name}'`)
		expect(configHelpers.rewriteCoreSpecifier("from './sibling.js'")).toBe("from './sibling.js'")
		expect(configHelpers.rewriteBrowserSpecifier("from '@src/browser'")).toBe(
			`from '${name}/browser'`,
		)
		expect(configHelpers.rewriteBrowserSpecifier("from '../../browser/index.js'")).toBe(
			`from '${name}/browser'`,
		)
		expect(configHelpers.rewriteBrowserSpecifier("from '../browser/index.ts'")).toBe(
			`from '${name}/browser'`,
		)
		expect(configHelpers.rewriteBrowserSpecifier("from './sibling.js'")).toBe("from './sibling.js'")

		// The mechanism the roll-up proof's skip reads: an absent package rejects resolution.
		expect(() => createRequire(import.meta.url).resolve('@absent/declaration-extractor')).toThrow(
			'Cannot find module',
		)

		expect(configHelpers.isExtractorModule(undefined)).toBe(false)
		expect(configHelpers.isExtractorModule({ Extractor: {}, ExtractorConfig: {} })).toBe(false)
		expect(
			configHelpers.isExtractorModule({
				Extractor: () => undefined,
				ExtractorConfig: () => undefined,
			}),
		).toBe(false)
		expect(
			configHelpers.isExtractorModule({
				Extractor: Object.assign(() => undefined, { invoke: () => undefined }),
				ExtractorConfig: Object.assign(() => undefined, { prepare: () => undefined }),
			}),
		).toBe(true)

		// The guard reads `invoke` and `prepare` through the prototype chain, as its remarks state.
		expect(
			configHelpers.isExtractorModule({
				Extractor: Object.setPrototypeOf(() => undefined, { invoke: () => undefined }),
				ExtractorConfig: Object.setPrototypeOf(() => undefined, { prepare: () => undefined }),
			}),
		).toBe(true)
	})

	// A hoisted install can place the extractor anywhere `require.resolve` reaches, so the skip
	// control compares against the path resolution actually returned rather than a fixed layout.
	it.skipIf(POLICY_EXTRACTOR === undefined)('finds the resolved extractor on disk', () => {
		if (POLICY_EXTRACTOR === undefined) throw new Error('The extractor resolution left no path')
		expect(existsSync(POLICY_EXTRACTOR)).toBe(true)
	})

	it.skipIf(POLICY_EXTRACTOR !== undefined)('rejects resolving the unavailable extractor', () => {
		expect(() => createRequire(import.meta.url).resolve('@microsoft/api-extractor')).toThrow(
			'Cannot find module',
		)
	})

	// The roll-up loads the declaration extractor, which only a workspace publishing source from
	// `src` installs. Where `require.resolve` rejects that package, this proof does not apply.
	it.skipIf(POLICY_EXTRACTOR === undefined)(
		'rolls one face into a single declaration and rewrites its core and browser specifiers',
		async () => {
			const scratch = createPolicyScratch({ prefix: 'orkestrel-config-rollup-' })
			// The hook's temporary declaration emit is proven removed from a host temporary
			// directory this case alone writes to. `os.tmpdir()` reads `TMPDIR`, `TMP`, and `TEMP`
			// when it is called, so pointing all three into the case's own scratch places every
			// `orkestrel-declarations-` directory these builds make there, and a build another
			// process runs meanwhile makes its own elsewhere.
			const temporary = join(scratch.path, 'temporary')
			mkdirSync(temporary)
			const variables = ['TMPDIR', 'TMP', 'TEMP']
			const inherited = variables.map((name) => [name, process.env[name]] as const)
			try {
				for (const name of variables) process.env[name] = temporary
				expect(tmpdir()).toBe(temporary)
				const workspace = scratch.path
				const project = join(workspace, 'tsconfig.json')
				const source = join(workspace, 'source', 'server', 'index.ts')
				scratch.write(
					'tsconfig.json',
					JSON.stringify({
						compilerOptions: {
							target: 'ESNext',
							module: 'ESNext',
							moduleResolution: 'bundler',
							lib: ['ESNext'],
							types: [],
							strict: true,
							verbatimModuleSyntax: true,
							skipLibCheck: true,
							declaration: true,
							emitDeclarationOnly: true,
							noEmit: false,
							rootDir: './source',
							outDir: './emit',
							paths: {
								'@src/core': ['./source/core/index.ts'],
								'@src/browser': ['./source/browser/index.ts'],
							},
						},
						include: ['./source/server/**/*.ts'],
					}),
				)
				scratch.write(
					'source/core/index.ts',
					'export interface FixtureLabel {\n\treadonly label: string\n}\n',
				)
				scratch.write(
					'source/browser/index.ts',
					'export interface FixtureView {\n\treadonly visible: boolean\n}\n',
				)
				scratch.write(
					'source/server/index.ts',
					"import type { FixtureLabel } from '@src/core'\nimport type { FixtureView } from '@src/browser'\n\nexport interface FixtureRecord {\n\treadonly label: FixtureLabel\n\treadonly view: FixtureView\n\treadonly count: number\n}\n",
				)

				const name = configHelpers.packageManifestName(configHelpers.WORKSPACE_ROOT)
				if (name === undefined) throw new Error('The workspace manifest names no package')
				const rewritten = join(workspace, 'rewritten')
				const kept = join(workspace, 'kept')
				const builds = [
					{
						output: rewritten,
						plugin: configHelpers.declarationRollup({
							project,
							rewrite: (text) =>
								configHelpers.rewriteBrowserSpecifier(configHelpers.rewriteCoreSpecifier(text)),
						}),
					},
					{ output: kept, plugin: configHelpers.declarationRollup({ project }) },
				]
				for (const face of builds) {
					await build({
						root: workspace,
						configFile: false,
						logLevel: 'silent',
						publicDir: false,
						plugins: [face.plugin],
						build: {
							write: true,
							outDir: face.output,
							lib: {
								entry: source,
								formats: ['es'],
								fileName: () => 'index.js',
							},
							rolldownOptions: { external: [/^node:/u, /^@orkestrel\//u] },
						},
					})
				}

				const idle = join(workspace, 'idle')
				const plugins = configHelpers.declarationRollup({
					project,
					rewrite: configHelpers.rewriteCoreSpecifier,
				})
				const configure = plugins.configResolved
				const close = plugins.closeBundle
				if (typeof configure !== 'function' || typeof close !== 'function') {
					throw new Error('The declaration roll-up exposes no build hooks')
				}
				Reflect.apply(configure, undefined, [
					{ command: 'serve', root: workspace, build: { outDir: idle, lib: { entry: source } } },
				])
				await Reflect.apply(close, undefined, [])

				expect(
					readdirSync(temporary).filter((entry) => entry.startsWith('orkestrel-declarations-')),
				).toStrictEqual([])

				// The face ships exactly one declaration: the emit's scratch tree leaves with it.
				expect(globSync('**/*.d.ts', { cwd: rewritten })).toStrictEqual(['index.d.ts'])
				expect(existsSync(join(rewritten, 'declarations'))).toBe(false)
				expect(globSync('**/*.d.ts', { cwd: kept })).toStrictEqual(['index.d.ts'])
				expect(existsSync(join(kept, 'declarations'))).toBe(false)
				expect(existsSync(idle)).toBe(false)

				const rolled = readFileSync(join(rewritten, 'index.d.ts'), 'utf8')
				expect(rolled).toContain('FixtureRecord')
				expect(rolled).toContain(`from '${name}'`)
				expect(rolled).not.toContain('@src/core')
				expect(rolled).toContain(`from '${name}/browser'`)
				expect(rolled).not.toContain('@src/browser')

				// The control: the same face without a rewrite ships the specifier the extractor kept.
				const control = readFileSync(join(workspace, 'kept', 'index.d.ts'), 'utf8')
				expect(control).toContain('@src/core')
				expect(control).toContain('@src/browser')
				expect(control).not.toContain(`from '${name}'`)
			} finally {
				for (const [name, value] of inherited) {
					if (value === undefined) Reflect.deleteProperty(process.env, name)
					else process.env[name] = value
				}
				scratch.destroy()
			}
		},
	)
})

// A `for…of` loop reads one entry, works on it, and stops at the first failure, where a copy of the
// list reads every entry first. Each case runs a policy reader over a recorded list and pins the
// outcome and the entries it read, as the loop the reader replaced gave them.
describe('policy readers consume a caller-supplied list one entry at a time', () => {
	const failureCases = [
		[POLICY_LAZY_SHAPES.hole, 'throw TypeError', []],
		[POLICY_LAZY_SHAPES.holeFailure, 'throw TypeError', []],
		[POLICY_LAZY_SHAPES.failureFirst, 'throw RangeError', [0]],
		[POLICY_LAZY_SHAPES.refusalFirst, 'throw TypeError', [0]],
		[POLICY_LAZY_SHAPES.holeBetween, 'throw TypeError', [0]],
		[POLICY_LAZY_SHAPES.unlisted, 'throw TypeError', []],
	] as const

	it.each([
		...createPolicyLazyCases(
			'statementToPolicyBindings',
			(declarations: PolicyExpression[]) =>
				statementToPolicyBindings({ type: 'VariableDeclaration', range: [0, 0], declarations }).map(
					(binding) => binding.name,
				),
			{ valid: createPolicyDeclarator, refusal: createPolicyRefused(createPolicyDeclarator) },
			[
				[POLICY_LAZY_SHAPES.empty, 'return []', []],
				[POLICY_LAZY_SHAPES.dense, 'return ["run"]', [0]],
				...failureCases,
			],
		),
		...createPolicyLazyCases(
			'reportDomain',
			(body: PolicyExpression[]) => {
				const reports: Array<string | undefined> = []
				reportDomain(
					{
						filename: '/ws/src/server/execution/run.ts',
						cwd: '/ws',
						sourceCode: { text: '', getAllComments: () => [], getDeclaredVariables: () => [] },
						report: (diagnostic) => {
							reports.push(diagnostic.messageId)
						},
					},
					{ type: 'Program', range: [0, 0], body },
				)
				return reports
			},
			{ valid: createPolicyExport, refusal: createPolicyRefused(createPolicyExport) },
			[
				[POLICY_LAZY_SHAPES.empty, 'return ["module"]', []],
				[POLICY_LAZY_SHAPES.dense, 'return []', [0]],
				...failureCases,
			],
		),
		...createPolicyLazyCases(
			'programToPolicyDocs statements',
			(body: PolicyExpression[]) =>
				programToPolicyDocs(
					{ type: 'Program', range: [0, 0], body },
					{
						text: '/** One. */\nexport function run() {}',
						getAllComments: () => [createPolicyComment()],
					},
				).map((doc) => doc.name),
			{ valid: createPolicyExport, refusal: createPolicyRefused(createPolicyExport) },
			[
				[POLICY_LAZY_SHAPES.empty, 'return []', []],
				[POLICY_LAZY_SHAPES.dense, 'return []', [0]],
				...failureCases,
			],
		),
		...createPolicyLazyCases(
			'programToPolicyDocs comments',
			(comments: PolicyComment[]) =>
				programToPolicyDocs(
					{ type: 'Program', range: [0, 0], body: [createPolicyExport()] },
					{ text: '/** One. */\n', getAllComments: () => comments },
				).map((doc) => doc.name),
			{ valid: createPolicyComment, refusal: createPolicyRefused(createPolicyComment) },
			[
				[POLICY_LAZY_SHAPES.empty, 'return []', []],
				[POLICY_LAZY_SHAPES.dense, 'return ["run"]', [0]],
				...failureCases,
			],
		),
		...createPolicyLazyCases(
			'programToPolicyDocs comments of a program with no export',
			(comments: PolicyComment[]) =>
				programToPolicyDocs(
					{ type: 'Program', range: [0, 0], body: [{ type: 'ImportDeclaration', range: [0, 0] }] },
					{ text: 'import x', getAllComments: () => comments },
				).map((doc) => doc.name),
			{ valid: createPolicyComment, refusal: createPolicyRefused(createPolicyComment) },
			[
				[POLICY_LAZY_SHAPES.empty, 'return []', []],
				[POLICY_LAZY_SHAPES.dense, 'return []', []],
				[POLICY_LAZY_SHAPES.hole, 'return []', []],
				[POLICY_LAZY_SHAPES.holeFailure, 'return []', []],
				[POLICY_LAZY_SHAPES.failureFirst, 'return []', []],
				[POLICY_LAZY_SHAPES.refusalFirst, 'return []', []],
				[POLICY_LAZY_SHAPES.holeBetween, 'return []', []],
				[POLICY_LAZY_SHAPES.unlisted, 'return []', []],
			],
		),
	])('$label', ({ observe, outcome, reads }) => {
		const read: number[] = []
		expect(
			observe((index) => {
				read.push(index)
			}),
		).toBe(outcome)
		expect(read).toStrictEqual(reads)
	})
})
