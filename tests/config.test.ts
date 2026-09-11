// P1: Every checked population must exist and be non-empty; absence fails instead of passing vacuously.
// P2: Required items are checked strictly; extra items are ignored before their shape is read.

import { spawnSync } from 'node:child_process'
import {
	existsSync,
	globSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, createServer, loadConfigFromFile } from 'vite'
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
	MOCKING_RULE,
	NESTED_RULE,
	PARSER_RULE,
	POLICY_BANNED_TERMS,
	POLICY_ENDING_GLOBS,
	POLICY_JUDGED_TERMS,
	POLICY_PLACEMENT_GLOBS,
	POLICY_VOICE_STOPWORDS,
	PRIVACY_RULE,
	TERM_RULE,
	TYPE_RULE,
	VOICE_RULE,
	blankPolicyText,
	commentToPolicyParagraph,
	isPolicyVoiced,
	paragraphToPolicyOpener,
	stripPolicyCode,
	textToPolicyHits,
} from '../configs/policy.js'
import configuration, { resolveWorkspacePath } from '../vite.config.js'
import tsconfig from '../tsconfig.json' with { type: 'json' }
import {
	createPolicyScratch,
	inspectPolicyConfiguration,
	inspectPolicyWiring,
	normalizePolicyFilename,
} from './setupPolicy.js'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A declaration roll-up loads the extractor package, which only a workspace publishing source from
// `src` installs. The resolution below is the mechanism its proof is conditioned on.
let extractorPath: string | undefined
try {
	extractorPath = createRequire(import.meta.url).resolve('@microsoft/api-extractor')
} catch {
	extractorPath = undefined
}

describe('root configuration', () => {
	it('resolves every declared alias to its real entry', () => {
		const aliases = configuration.resolve?.alias
		if (typeof aliases !== 'object' || aliases === null || Array.isArray(aliases)) {
			throw new Error('The root configuration carries no alias record')
		}
		const required = new Map<string, string>()
		for (const axis of ['src', 'app']) {
			for (const environment of ['core', 'browser', 'server']) {
				const path = `${axis}/${environment}/index.ts`
				if (existsSync(resolve(root, path))) required.set(`@${axis}/${environment}`, path)
			}
		}
		if (required.size === 0) throw new Error('The workspace selects no alias target')
		const declared = new Map(Object.entries(tsconfig.compilerOptions.paths))
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
			expect(target).toBe(resolve(root, expected))
			expect(Object.getOwnPropertyDescriptor(aliases, key)?.value).toBe(target)
		}
	})

	it('registers every workspace project with its fixed include and setup files', () => {
		const expected = new Map<
			string,
			{
				readonly benchmark?: readonly string[]
				readonly include: string
				readonly parallel?: boolean
				readonly pool?: string
				readonly setup: readonly string[]
			}
		>()
		if (existsSync(resolve(root, 'src/core'))) {
			expected.set('src:core', {
				include: 'tests/src/core/**/*.test.ts',
				setup: ['./tests/setup.ts'],
			})
		}
		if (existsSync(resolve(root, 'src/browser'))) {
			expected.set('src:browser', {
				include: 'tests/src/browser/**/*.test.ts',
				setup: ['./tests/setup.ts', './tests/setupBrowser.ts'],
			})
		}
		if (existsSync(resolve(root, 'src/server'))) {
			expected.set('src:server', {
				include: 'tests/src/server/**/*.test.ts',
				setup: ['./tests/setup.ts', './tests/setupServer.ts'],
			})
		}
		if (existsSync(resolve(root, 'src/bin'))) {
			expected.set('src:bin', {
				include: 'tests/src/bin/**/*.test.ts',
				setup: ['./tests/setup.ts', './tests/setupServer.ts'],
			})
		}
		if (existsSync(resolve(root, 'app/core'))) {
			expected.set('app:core', {
				include: 'tests/app/core/**/*.test.ts',
				setup: ['./tests/setup.ts'],
			})
		}
		if (existsSync(resolve(root, 'app/browser'))) {
			expected.set('app:browser', {
				include: 'tests/app/browser/**/*.test.ts',
				setup: ['./tests/setup.ts', './tests/setupBrowser.ts'],
			})
		}
		if (existsSync(resolve(root, 'app/server'))) {
			expected.set('app:server', {
				include: 'tests/app/server/**/*.test.ts',
				setup: ['./tests/setup.ts', './tests/setupServer.ts'],
			})
		}
		for (const label of [
			'policy',
			'config',
			'guides',
			'conformance',
			'distribution',
			'integration',
		]) {
			if (!existsSync(resolve(root, `tests/${label}.test.ts`))) continue
			expected.set(label, {
				include: `tests/${label}.test.ts`,
				setup: ['./tests/setup.ts'],
			})
		}
		// The setup project is selected by any proof named `setup*.test.ts` directly under
		// `tests`, so it is the one derived project whose include is a pattern rather than
		// the proof's own path. Reading it from the same glob the generator reads keeps a
		// registered project inside this gate instead of beside it.
		if (globSync('tests/setup*.test.ts', { cwd: root }).length > 0) {
			expected.set('setup', {
				include: 'tests/setup*.test.ts',
				setup: ['./tests/setup.ts'],
			})
		}
		// The live-service project covers a directory rather than one proof, so its
		// readiness module is the fact that selects it. A suite beneath
		// `tests/service` with no setup module is a project nothing configures.
		if (existsSync(resolve(root, 'tests/setupService.ts'))) {
			expected.set('service', {
				include: 'tests/service/**/*.test.ts',
				setup: ['./tests/setup.ts', './tests/setupService.ts'],
			})
		}
		expected.set('probe', {
			benchmark: ['tmp/probe/**/*.test.ts', 'tests/**/*.test.ts'],
			include: 'tmp/probe/**/*.test.ts',
			parallel: false,
			pool: 'threads',
			setup: ['./tests/setup.ts'],
		})
		// A row that is a configuration rather than a factory. Every generated
		// workspace registers the factory itself, so this shape is required here
		// rather than observed: the proof exercises that resolution wherever it runs
		// instead of only where a hand-written configuration happens to produce it.
		expected.set('concrete', { include: 'tests/concrete.test.ts', setup: ['./tests/setup.ts'] })

		const projects = configuration.test?.projects
		if (!Array.isArray(projects)) throw new Error('The root configuration carries no projects')
		let extraLoaded = false
		const control = Object.defineProperty(
			() => {
				extraLoaded = true
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
		const configured = new Map<
			string,
			{
				readonly benchmark?: readonly string[]
				readonly include: string
				readonly parallel?: boolean
				readonly pool?: string
				readonly setup: readonly string[]
			}
		>()
		for (const [requiredLabel] of expected) {
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
				(path) => typeof path === 'string' && (!Array.isArray(exclude) || !exclude.includes(path)),
			)
			if (effective.length !== 1 || typeof effective[0] !== 'string') {
				throw new Error(`${label} does not resolve to one effective include`)
			}
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
				configured.set(label, {
					benchmark: benchmarkInclude,
					include: effective[0],
					parallel,
					pool,
					setup: [...new Set(setup)],
				})
				continue
			}
			configured.set(label, { include: effective[0], setup: [...new Set(setup)] })
		}

		// Required projects come from present source and test paths. Each factory is selected by name
		// before its result is read. Extra factories are ignored without validating their result shape.
		expect(extraLoaded).toBe(false)
		for (const [label, project] of expected) expect(configured.get(label)).toStrictEqual(project)

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

	it('emits every project as a factory so the release mode reaches its proof', () => {
		const projects = configuration.test?.projects
		if (!Array.isArray(projects)) throw new Error('The root configuration carries no projects')
		if (projects.length === 0) throw new Error('The root configuration registers no project')
		// Measured: with `--mode release` on the command line, `import.meta.env.MODE` reads
		// `release` inside a project Vitest calls and `test` inside an inline project
		// configuration. `prepublishOnly` runs the distribution proof with `--mode release`, and
		// that proof fails rather than skips only when it reads `release`, so converting these
		// entries to inline configurations turns the publish gate into a skip while every suite
		// stays green. The control is that conversion applied to one entry.
		const inline = {
			test: {
				name: { label: 'inline' },
				include: ['tests/inline.test.ts'],
				setupFiles: ['./tests/setup.ts'],
			},
		}
		const callable = projects.concat(inline).filter((entry) => typeof entry === 'function')
		for (const entry of projects) expect(callable).toContain(entry)
		expect(callable).not.toContain(inline)
	})

	it('keeps Vitest invocation fields out of project configurations', () => {
		const projects = configuration.test?.projects
		if (!Array.isArray(projects)) throw new Error('The root configuration carries no projects')
		const factories = projects.filter((row) => typeof row === 'function')
		if (factories.length === 0)
			throw new Error('The root configuration registers no project factory')
		const sentinel = {
			command: 'sentinel-command',
			isPreview: true,
			isSsrBuild: true,
			mode: 'sentinel-mode',
			sentinel: true,
		}
		for (const factory of factories) {
			const project: unknown = Reflect.apply(factory, undefined, [sentinel])
			if (typeof project !== 'object' || project === null) {
				throw new Error('A project factory returned no configuration')
			}
			for (const field of Object.keys(sentinel)) {
				expect(Object.getOwnPropertyDescriptor(project, field)?.value).toBeUndefined()
			}
		}

		const control = Object.defineProperty(() => ({ ...sentinel }), 'name', { value: 'control' })
		expect(() => {
			for (const factory of factories.concat(control)) {
				const project: unknown = Reflect.apply(factory, undefined, [sentinel])
				if (typeof project !== 'object' || project === null) {
					throw new Error('A project factory returned no configuration')
				}
				for (const field of Object.keys(sentinel)) {
					expect(Object.getOwnPropertyDescriptor(project, field)?.value).toBeUndefined()
				}
			}
		}).toThrow(/expected/u)
	})

	it('requires and validates every selected target wrapper', async () => {
		const required: string[] = []
		for (const axis of ['src', 'app']) {
			for (const environment of ['core', 'browser', 'server']) {
				if (!existsSync(resolve(root, axis, environment))) continue
				required.push(`configs/${axis}/tsconfig.${environment}.json`)
				if (axis === 'src' || environment !== 'core') {
					required.push(`configs/${axis}/vite.${environment}.config.ts`)
				}
			}
		}
		if (existsSync(resolve(root, 'src/bin'))) {
			required.push('configs/src/tsconfig.bin.json', 'configs/src/vite.bin.config.ts')
		}
		if (existsSync(resolve(root, 'configs/app/vite.showcase.config.ts'))) {
			required.push('configs/app/vite.showcase.config.ts')
		}
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
			{ cwd: root },
		).map((path) => path.replaceAll('\\', '/'))
		const extra = 'configs/app/vite.core.config.ts'
		const controlled = found.concat(extra)

		// Required wrappers come from selected src/app targets. Only that set is loaded and validated.
		// Extra wrappers remain in the found population but are ignored before their content is read.
		expect(controlled).toContain(extra)
		expect(required).not.toContain(extra)
		for (const wrapper of required) {
			expect(controlled).toContain(wrapper)
			const viteMatch =
				/^configs\/(src|app)\/vite\.(core|browser|server|bin|showcase)\.config\.ts$/u.exec(wrapper)
			if (viteMatch !== null) {
				const [, axis, environment] = viteMatch
				if (axis === undefined || environment === undefined) {
					throw new Error(`${wrapper} carries no target`)
				}
				const loaded = await loadConfigFromFile(
					{ command: 'build', mode: 'test', isSsrBuild: false, isPreview: false },
					resolve(root, wrapper),
					root,
					'silent',
				)
				if (loaded === null) throw new Error(`${wrapper} did not load`)
				const output = loaded.config.build?.outDir
				if (output === undefined) throw new Error(`${wrapper} carries no output`)
				const expected =
					environment === 'bin'
						? 'dist/bin'
						: environment === 'showcase'
							? 'dist/showcase'
							: `dist/${axis}/${environment}`
				if (resolve(root, output) !== resolve(root, expected)) {
					throw new Error(`${wrapper} resolves to the wrong output`)
				}
				continue
			}

			const tsconfigMatch = /^configs\/(src|app)\/tsconfig\.(core|browser|server|bin)\.json$/u.exec(
				wrapper,
			)
			if (tsconfigMatch === null) {
				throw new Error(`${wrapper} is not a required target wrapper`)
			}
			const [, axis, environment] = tsconfigMatch
			if (axis === undefined || environment === undefined) {
				throw new Error(`${wrapper} carries no TypeScript scope`)
			}
			const parsed: unknown = JSON.parse(readFileSync(resolve(root, wrapper), 'utf8'))
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
					: environment === 'browser'
						? ['ESNext', 'DOM', 'DOM.Iterable']
						: ['ESNext']
			const expectedTypes =
				environment === 'core'
					? []
					: environment === 'browser'
						? axis === 'app'
							? ['vite/client', 'vue']
							: ['vite/client']
						: ['node']
			expect(lib).toStrictEqual(expectedLib)
			expect(types).toStrictEqual(expectedTypes)
		}

		const controlRequired = [
			'configs/app/vite.browser.config.ts',
			'configs/app/vite.server.config.ts',
		]
		const controlFound = ['configs/app/vite.server.config.ts']
		expect(() => {
			for (const wrapper of controlRequired) expect(controlFound).toContain(wrapper)
		}).toThrow(/vite\.browser/u)
		expect(() => expect(resolve(root, 'dist/actual')).toBe(resolve(root, 'dist/control'))).toThrow(
			/expected/u,
		)
	})

	it('registers proof scripts in the correct gate', () => {
		const manifest: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
		if (typeof manifest !== 'object' || manifest === null) {
			throw new Error('The package manifest is not a record')
		}
		const scripts: unknown = Object.getOwnPropertyDescriptor(manifest, 'scripts')?.value
		if (typeof scripts !== 'object' || scripts === null) {
			throw new Error('The package manifest carries no scripts')
		}
		const publishes = Object.getOwnPropertyDescriptor(manifest, 'private')?.value !== true
		const test = Object.getOwnPropertyDescriptor(scripts, 'test')?.value
		const config = Object.getOwnPropertyDescriptor(scripts, 'test:config')?.value
		const distribution = Object.getOwnPropertyDescriptor(scripts, 'test:distribution')?.value
		const integration = Object.getOwnPropertyDescriptor(scripts, 'test:integration')?.value
		const conformance = Object.getOwnPropertyDescriptor(scripts, 'test:conformance')?.value
		const service = Object.getOwnPropertyDescriptor(scripts, 'test:service')?.value
		const publish = Object.getOwnPropertyDescriptor(scripts, 'prepublishOnly')?.value
		const hasIntegration = existsSync(resolve(root, 'tests/integration.test.ts'))
		// The optional proofs are read off the registered project set rather than off
		// their files, because the defect this measures is a registered project no
		// gate runs. A project selected by a path that is not yet there is still
		// registered, and it is exactly the one whose script goes missing.
		const rows = configuration.test?.projects
		if (!Array.isArray(rows)) throw new Error('The root configuration carries no projects')
		const registered = new Set<string>()
		for (const row of rows) {
			if (typeof row === 'function') {
				registered.add(row.name)
				continue
			}
			if (typeof row !== 'object' || row === null) continue
			const block: unknown = Object.getOwnPropertyDescriptor(row, 'test')?.value
			if (typeof block !== 'object' || block === null) continue
			const named: unknown = Object.getOwnPropertyDescriptor(block, 'name')?.value
			if (typeof named !== 'object' || named === null) continue
			const label: unknown = Object.getOwnPropertyDescriptor(named, 'label')?.value
			if (typeof label === 'string') registered.add(label)
		}
		// The population must be able to answer both ways before either answer counts.
		expect(registered.has('config')).toBe(true)
		expect(registered.has('control')).toBe(false)
		const hasConformance = registered.has('conformance')
		const hasDistribution = registered.has('distribution')
		const hasService = registered.has('service')
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
			hasDistribution && publishes,
		)
		expect(typeof publish === 'string').toBe(publishes)
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
		expect(service).toBe(
			hasService
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project service'
				: undefined,
		)
		expect(typeof test === 'string' && test.includes('npm run test:service')).toBe(
			hasService && !publishes,
		)
		expect(typeof publish === 'string' && publish.includes('npm run test:service')).toBe(
			hasService && publishes,
		)
	})

	it('rebuilds publishing workspaces before packing', () => {
		const manifest: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
		if (typeof manifest !== 'object' || manifest === null) {
			throw new Error('The package manifest is not a record')
		}
		const scripts: unknown = Object.getOwnPropertyDescriptor(manifest, 'scripts')?.value
		if (typeof scripts !== 'object' || scripts === null) {
			throw new Error('The package manifest carries no scripts')
		}
		const publishes = Object.getOwnPropertyDescriptor(manifest, 'private')?.value !== true
		const prepack = Object.getOwnPropertyDescriptor(scripts, 'prepack')?.value
		expect(prepack).toBe(publishes ? 'npm run build' : undefined)

		const controlled = { ...scripts, prepack: 'npm run control' }
		expect(() => {
			const control = Object.getOwnPropertyDescriptor(controlled, 'prepack')?.value
			expect(control).toBe(publishes ? 'npm run build' : undefined)
		}).toThrow(/expected/u)
	})

	it('keeps the committed host inventory aligned with the vendored checkout bytes', async () => {
		// Run this gate against a quiescent checkout. It compares two reads and cannot
		// distinguish stale committed data from a source edit made while it runs.
		const packageValue: unknown = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
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
			if (existsSync(resolve(root, 'host.json'))) {
				throw new Error('A committed host inventory exists without a generator')
			}
			return
		}
		if (typeof generator !== 'string') {
			throw new Error('The host inventory generator is not a script')
		}
		const committed = resolve(root, 'host.json')
		if (!existsSync(committed)) {
			throw new Error('The committed host inventory is absent at host.json')
		}
		const helper = resolve(root, 'src/server/helpers.ts')
		if (!existsSync(helper)) {
			throw new Error('The committed host inventory has no server stager')
		}
		const server = await createServer({
			configFile: false,
			root,
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
			const workspace = mkdtempSync(join(root, 'host-inventory-'))
			try {
				const generated = join(workspace, 'host.json')
				Reflect.apply(stage, undefined, [root, generated])
				const generatedText = readFileSync(generated, 'utf8')
				const committedText = readFileSync(committed, 'utf8')
				const values: readonly unknown[] = [JSON.parse(generatedText), JSON.parse(committedText)]
				const indexes: Array<Map<string, string>> = []
				for (const value of values) {
					if (typeof value !== 'object' || value === null) {
						throw new Error('A host inventory is not a record')
					}
					const entries: unknown = Object.getOwnPropertyDescriptor(value, 'entries')?.value
					if (!Array.isArray(entries)) throw new Error('A host inventory carries no entry list')
					const index = new Map<string, string>()
					for (const entry of entries) {
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
						index.set(destination, digest)
					}
					indexes.push(index)
				}
				const generatedIndex = indexes[0]
				const committedIndex = indexes[1]
				if (generatedIndex === undefined || committedIndex === undefined) {
					throw new Error('The host inventories were not indexed')
				}
				if (generatedText !== committedText) {
					const stale: string[] = []
					for (const [destination, digest] of generatedIndex) {
						if (committedIndex.get(destination) !== digest) stale.push(destination)
					}
					for (const destination of committedIndex.keys()) {
						if (!generatedIndex.has(destination)) stale.push(destination)
					}
					throw new Error(
						`The committed host inventory is stale at ${stale.length > 0 ? stale.sort().join(', ') : 'host.json'}`,
					)
				}
				console.info(`host-inventory: entries=${generatedIndex.size}`)
			} finally {
				rmSync(workspace, { recursive: true, force: true })
			}
		} finally {
			await server.close()
		}
	})

	it('keeps policy rules active across every linted workspace path', () => {
		const parsed: unknown = JSON.parse(readFileSync(resolve(root, '.oxlintrc.json'), 'utf8'))
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
	})

	it('omits the audit-confirmed dead policy type exports', () => {
		const source = readFileSync(resolve(root, 'configs/policy.ts'), 'utf8')
		expect(source).not.toMatch(/\bPolicy(?:Call|ClassMember)\b/u)
	})
})

describe('policy plugin', () => {
	RuleTester.describe = describe
	RuleTester.it = it

	const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
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
				name: 'accepts the sanctioned policy visitor delegation',
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
				name: 'rejects a named function expression argument',
				code: 'function projectValue() { return read(function readValue() { return 1 }) }',
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
			{
				name: 'accepts a function in a function-kind file',
				filename: 'src/worker/helpers.ts',
				code: 'export function buildValue(): void {}',
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
		],
	})

	tester.run('no-malformed-domain', DOMAIN_RULE, {
		valid: [
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

	it('enables every plugin rule over the population its law names', () => {
		const parsed: unknown = JSON.parse(readFileSync(resolve(root, '.oxlintrc.json'), 'utf8'))
		const rules: unknown = Object.getOwnPropertyDescriptor(policyPlugin, 'rules')?.value
		if (typeof rules !== 'object' || rules === null) {
			throw new Error('The policy plugin declares no rules')
		}
		const declared = Object.getOwnPropertyNames(rules)
		expect(declared).toContain('no-misplaced-function')
		expect(declared).toContain('no-host-line-endings')
		expect(
			inspectPolicyWiring(
				parsed,
				declared.map((name) => `policy/${name}`),
				[POLICY_PLACEMENT_GLOBS, POLICY_ENDING_GLOBS],
			),
		).toEqual([])
	})

	it('loads every configured policy rule through the real binary', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-policy-' })
		try {
			// Compare diagnostics from the real directory while the child keeps the scratch cwd.
			const comparisonRoot = realpathSync.native(scratch.path)
			scratch.write('.oxlintrc.json', readFileSync(resolve(root, '.oxlintrc.json'), 'utf8'))
			scratch.write('configs/policy.ts', readFileSync(resolve(root, 'configs/policy.ts'), 'utf8'))
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
			scratch.write('src/violations/constants.ts', 'export const values = []\n')
			scratch.write('src/violations/composables.ts', "export const READY = 'yes'\n")
			scratch.write('app/browser/composables/useTheme.ts', 'export function useMode(): void {}\n')
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
			const manifestPath = createRequire(join(root, 'package.json')).resolve('oxlint/package.json')
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
				[binary, '--config', config, '--format', 'json', 'src/violations', 'app', 'scripts'],
				{ cwd: scratch.path, encoding: 'utf8', timeout: 15_000 },
			)
			const clean = spawnSync(
				process.execPath,
				[binary, '--config', config, '--format', 'json', 'src/clean'],
				{ cwd: scratch.path, encoding: 'utf8', timeout: 15_000 },
			)
			const reports: string[][] = []
			for (const result of [violations, clean]) {
				if (result.error !== undefined) throw result.error
				const report: unknown = JSON.parse(result.stdout)
				if (typeof report !== 'object' || report === null) {
					throw new Error('Oxlint returned no JSON report')
				}
				const diagnostics: unknown = Object.getOwnPropertyDescriptor(report, 'diagnostics')?.value
				if (!Array.isArray(diagnostics)) throw new Error('Oxlint returned no diagnostic list')
				const codes: string[] = []
				for (const diagnostic of diagnostics) {
					if (typeof diagnostic !== 'object' || diagnostic === null) {
						throw new Error('Oxlint returned a malformed diagnostic')
					}
					const code: unknown = Object.getOwnPropertyDescriptor(diagnostic, 'code')?.value
					const filename: unknown = Object.getOwnPropertyDescriptor(diagnostic, 'filename')?.value
					if (typeof code !== 'string' || typeof filename !== 'string') {
						throw new Error('Oxlint returned a diagnostic without a rule id and a file')
					}
					codes.push(`${code} ${normalizePolicyFilename(comparisonRoot, filename)}`)
				}
				reports.push(codes)
			}

			const violationCodes = reports[0]
			const cleanCodes = reports[1]
			if (violationCodes === undefined || cleanCodes === undefined) {
				throw new Error('Oxlint returned no fixture reports')
			}
			expect(violations.status).toBe(1)
			for (const { code, filename } of [
				{ code: 'policy(no-mocking)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-keyword-privacy)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-nested-functions)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-misplaced-type)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-misplaced-data)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-misplaced-function)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-misplaced-class)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-host-line-endings)', filename: 'src/violations/fixture.ts' },
				{ code: 'policy(no-hidden-declaration)', filename: 'src/violations/helpers.ts' },
				{ code: 'policy(no-misnamed-parser)', filename: 'src/violations/parsers.ts' },
				{ code: 'policy(no-misnamed-factory)', filename: 'src/violations/factories.ts' },
				{ code: 'policy(no-malformed-constant)', filename: 'src/violations/constants.ts' },
				{ code: 'policy(no-malformed-domain)', filename: 'src/violations/composables.ts' },
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
			expect(violationCodes).toContain(
				`eslint(no-debugger) ${normalizePolicyFilename(comparisonRoot, 'scripts/read.ts')}`,
			)
			expect(violationCodes).not.toContain(
				`policy(no-host-line-endings) ${normalizePolicyFilename(comparisonRoot, 'scripts/read.ts')}`,
			)
			expect(clean.status).toBe(0)
			expect(cleanCodes).toHaveLength(0)
		} finally {
			scratch.destroy()
		}
	})
})

describe('configuration helpers', () => {
	it('exposes every helper this proof requires', () => {
		const required = [
			'ENVIRONMENT_MODULE_BYTES',
			'PACKAGE_MANIFEST_BYTES',
			'WORKSPACE_ROOT',
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
			'readCompilerOutput',
			'rewriteCoreSpecifier',
			'sourceFallback',
			'trustedPackageRootFor',
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
			const importer = resolve(root, 'tests/config.test.ts')
			expect(configHelpers.WORKSPACE_ROOT).toBe(realpathSync.native(root))
			expect(configHelpers.fileSystemPath(`/@fs/${root}`)).toBe(root)
			expect(configHelpers.physicalPath(`${root}?control=true`)).toBe(realpathSync.native(root))
			expect(configHelpers.sourceFallback(importer, './setup.ts')).toBe(
				resolve(root, 'tests/setup.ts'),
			)
			expect(configHelpers.sourceFallback(importer, pathToFileURL(importer).href)).toBe(importer)
			expect(configHelpers.workspacePath(importer)).toBe('tests/config.test.ts')
			expect(configHelpers.containedPath(root, importer)).toBe(true)
			expect(configHelpers.containedPath(root, outside)).toBe(false)
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
			expect(
				configHelpers.trustedPackageRootFor(source, new Set([realpathSync.native(packageRoot)])),
			).toBe(realpathSync.native(packageRoot))
		} finally {
			scratch.destroy()
		}
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
			expect(configHelpers.isBoundaryExemptModule(resolve(root, 'src/core/index.ts'))).toBe(false)
			expect(configHelpers.isWorkspaceBoundaryModule(resolve(root, 'src/core/index.ts'))).toBe(true)
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
		const expected = resolve(root, 'dist/config-control')
		expect(() => configHelpers.enforceOutputPath(expected, expected)).not.toThrow()
		expect(() =>
			configHelpers.enforceOutputPath(resolve(root, 'dist/outside-control'), expected),
		).toThrow('Build output must use its exact configured workspace directory')
		const outside = resolve(dirname(root), 'outside-config-control')
		expect(() => configHelpers.enforceOutputPath(outside, outside)).toThrow(
			'Build output must remain inside the workspace',
		)
	})

	it('drives each plugin through its real Vite hooks', async () => {
		const environments: ReadonlyArray<
			'src/core' | 'src/browser' | 'src/server' | 'app/core' | 'app/browser' | 'app/server'
		> = ['src/core', 'src/browser', 'src/server', 'app/core', 'app/browser', 'app/server']
		const owner = environments.find((environment) => existsSync(resolve(root, environment)))
		if (owner === undefined) throw new Error('The workspace carries no environment plugin target')
		const workspace = mkdtempSync(join(resolve(root, owner), 'config-build-'))
		try {
			const source = resolve(workspace, 'index.ts')
			writeFileSync(source, 'export const control = true\n', 'utf8')
			await expect(
				build({
					root,
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
			rmSync(workspace, { recursive: true, force: true })
		}
	})

	it('reads the compiler scope and fixed extractor override a declaration roll-up requires', () => {
		const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc')
		// The order mirrors ENVIRONMENTS in src/core/constants.ts; a server-only workspace vendors
		// no core project, so this walks to the first face the workspace actually carries.
		const faces = ['core', 'browser', 'server']
		const face = faces.find((candidate) =>
			existsSync(resolve(root, `configs/src/tsconfig.${candidate}.json`)),
		)
		if (face === undefined) throw new Error('The workspace declares no face project')
		const project = resolve(root, `configs/src/tsconfig.${face}.json`)
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
		const declaredTypes: unknown = Object.getOwnPropertyDescriptor(declaredOptions, 'types')?.value
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

		expect(configHelpers.parseProjectScope('not a configuration', project)).toBeUndefined()
		expect(
			configHelpers.parseProjectScope('{"compilerOptions":{"lib":[],"types":[]}}', project),
		).toBeUndefined()
		expect(
			configHelpers.parseProjectScope('{"compilerOptions":{"lib":[1],"rootDir":"."}}', project),
		).toBeUndefined()
		expect(() =>
			configHelpers.readCompilerOutput(compiler, [
				'--showConfig',
				'-p',
				resolve(root, 'configs/src/tsconfig.absent.json'),
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
	it.skipIf(extractorPath === undefined)('finds the resolved extractor on disk', () => {
		if (extractorPath === undefined) throw new Error('The extractor resolution left no path')
		expect(existsSync(extractorPath)).toBe(true)
	})

	it.skipIf(extractorPath !== undefined)('rejects resolving the unavailable extractor', () => {
		expect(() => createRequire(import.meta.url).resolve('@microsoft/api-extractor')).toThrow(
			'Cannot find module',
		)
	})

	// The roll-up loads the declaration extractor, which only a workspace publishing source from
	// `src` installs. Where `require.resolve` rejects that package, this proof does not apply.
	it.skipIf(extractorPath === undefined)(
		'rolls one face into a single declaration and rewrites its core specifier',
		async () => {
			const scratch = createPolicyScratch({ prefix: 'orkestrel-config-rollup-' })
			// The hook's temporary declaration emit is proven removed: no name beginning
			// `orkestrel-declarations-` present after the builds that was absent before them.
			const before = new Set(
				readdirSync(tmpdir()).filter((entry) => entry.startsWith('orkestrel-declarations-')),
			)
			try {
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
							paths: { '@src/core': ['./source/core/index.ts'] },
						},
						include: ['./source/server/**/*.ts'],
					}),
				)
				scratch.write(
					'source/core/index.ts',
					'export interface FixtureLabel {\n\treadonly label: string\n}\n',
				)
				scratch.write(
					'source/server/index.ts',
					"import type { FixtureLabel } from '@src/core'\n\nexport interface FixtureRecord {\n\treadonly label: FixtureLabel\n\treadonly count: number\n}\n",
				)

				const name = configHelpers.packageManifestName(configHelpers.WORKSPACE_ROOT)
				if (name === undefined) throw new Error('The workspace manifest names no package')
				const rewritten = join(workspace, 'rewritten')
				const kept = join(workspace, 'kept')
				const builds = [
					{ output: rewritten, rewrite: true },
					{ output: kept, rewrite: false },
				]
				for (const face of builds) {
					await build({
						root: workspace,
						configFile: false,
						logLevel: 'silent',
						publicDir: false,
						plugins: [
							configHelpers.declarationRollup(
								face.rewrite
									? { project, rewrite: configHelpers.rewriteCoreSpecifier }
									: { project },
							),
						],
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
				const serving = configHelpers.declarationRollup({
					project,
					rewrite: configHelpers.rewriteCoreSpecifier,
				})
				const configure = serving.configResolved
				const close = serving.closeBundle
				if (typeof configure !== 'function' || typeof close !== 'function') {
					throw new Error('The declaration roll-up exposes no build hooks')
				}
				Reflect.apply(configure, undefined, [
					{ command: 'serve', root: workspace, build: { outDir: idle, lib: { entry: source } } },
				])
				await Reflect.apply(close, undefined, [])

				const after = readdirSync(tmpdir()).filter((entry) =>
					entry.startsWith('orkestrel-declarations-'),
				)
				expect(after.every((entry) => before.has(entry))).toBe(true)

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

				// The control: the same face without a rewrite ships the specifier the extractor kept.
				const control = readFileSync(join(workspace, 'kept', 'index.d.ts'), 'utf8')
				expect(control).toContain('@src/core')
				expect(control).not.toContain(`from '${name}'`)
			} finally {
				scratch.destroy()
			}
		},
	)
})
