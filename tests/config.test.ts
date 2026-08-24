// P1: Every checked population must exist and be non-empty; absence fails instead of passing vacuously.
// P2: Required items are checked strictly; extra items are ignored before their shape is read.

import { spawnSync } from 'node:child_process'
import {
	existsSync,
	globSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, createServer, loadConfigFromFile } from 'vite'
import { RuleTester } from 'oxlint/plugins-dev'
import * as configHelpers from '../configs/helpers.js'
import { MOCKING_RULE, NESTED_RULE, PRIVACY_RULE } from '../configs/policy.js'
import configuration, { resolveWorkspacePath } from '../vite.config.js'
import tsconfig from '../tsconfig.json' with { type: 'json' }
import { createPolicyScratch, inspectPolicyConfiguration } from './setupPolicy.js'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

	it('loads every configured policy rule through the real binary', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-config-policy-' })
		try {
			scratch.write('.oxlintrc.json', readFileSync(resolve(root, '.oxlintrc.json'), 'utf8'))
			scratch.write('configs/policy.ts', readFileSync(resolve(root, 'configs/policy.ts'), 'utf8'))
			scratch.write(
				'src/violations/fixture.ts',
				[
					"vi.mock('./x')",
					'class PrivateMember { private value = 1 }',
					'class ParameterMember { constructor(readonly value: string) {} }',
					'class PublicMember { public value = 1 }',
					'function OuterFunction() { const nested = () => undefined; return nested() }',
					'void PrivateMember',
					'void ParameterMember',
					'void PublicMember',
					'void OuterFunction',
				].join('\n'),
			)
			scratch.write(
				'src/clean/fixture.ts',
				[
					'class CleanMember {',
					'\t#value = 1',
					'\tvalue(): number { return this.#value }',
					'}',
					'void CleanMember',
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
				[binary, '--config', config, '--format', 'json', 'src/violations'],
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
					if (typeof code !== 'string') {
						throw new Error('Oxlint returned a diagnostic without a rule id')
					}
					codes.push(code)
				}
				reports.push(codes)
			}

			const violationCodes = reports[0]
			const cleanCodes = reports[1]
			if (violationCodes === undefined || cleanCodes === undefined) {
				throw new Error('Oxlint returned no fixture reports')
			}
			expect(violations.status).toBe(1)
			for (const rule of [
				'policy(no-mocking)',
				'policy(no-keyword-privacy)',
				'policy(no-nested-functions)',
				'typescript(parameter-properties)',
				'typescript(explicit-member-accessibility)',
			]) {
				expect(violationCodes).toContain(rule)
			}
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
			'containedPath',
			'decodeAssetSource',
			'enforceBuildLog',
			'enforceOutputPath',
			'environmentAssetSources',
			'environmentBoundary',
			'environmentPathError',
			'environmentSourceError',
			'fileSystemPath',
			'hasAsciiUrlControl',
			'isBoundaryExemptModule',
			'isOutsideWorkspacePath',
			'isPackageBoundary',
			'isStylesheetPath',
			'isWorkspaceBoundaryModule',
			'outputBoundary',
			'packageManifestName',
			'packageNameOf',
			'packageRootForResolved',
			'packageRootOf',
			'physicalPath',
			'readBoundedFile',
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
})
