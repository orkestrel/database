// P1: Every checked population must exist and be non-empty; absence fails instead of passing vacuously.
// P2: Required items are checked strictly; extra items are ignored before their shape is read.

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
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, loadConfigFromFile } from 'vite'
import * as configHelpers from '../configs/helpers.js'
import configuration, { resolveWorkspacePath } from '../vite.config.js'
import tsconfig from '../tsconfig.json' with { type: 'json' }
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
		}).toThrowError('The alias population carries no required entry')
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
			{ readonly include: string; readonly setup: readonly string[] }
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
		for (const label of ['policy', 'config', 'guides', 'integration']) {
			if (!existsSync(resolve(root, `tests/${label}.test.ts`))) continue
			expected.set(label, {
				include: `tests/${label}.test.ts`,
				setup: ['./tests/setup.ts'],
			})
		}
		expected.set('probe', { include: 'tmp/probe/**/*.test.ts', setup: ['./tests/setup.ts'] })
		// A row that is a configuration rather than a factory. A workspace with a
		// browser application emits one, because that factory refuses overrides and
		// so is not a value Vitest may call. It is required here, in a workspace that
		// has no browser application, so this proof exercises that resolution
		// wherever it runs instead of only where the shape happens to occur.
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
			{ readonly include: string; readonly setup: readonly string[] }
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
		}).toThrowError(/strictly equal/u)

		const misconfigured = new Map(configured)
		const probe = misconfigured.get('probe')
		if (probe === undefined) throw new Error('The configured projects carry no probe control')
		misconfigured.set('probe', { ...probe, setup: ['./tests/setupServer.ts'] })
		expect(() => {
			for (const [label, project] of expected)
				expect(misconfigured.get(label)).toStrictEqual(project)
		}).toThrowError(/strictly equal/u)
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
		}).toThrowError(/vite\.browser/u)
		expect(() =>
			expect(resolve(root, 'dist/actual')).toBe(resolve(root, 'dist/control')),
		).toThrowError(/expected/u)
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
		const test = Object.getOwnPropertyDescriptor(scripts, 'test')?.value
		const config = Object.getOwnPropertyDescriptor(scripts, 'test:config')?.value
		const integration = Object.getOwnPropertyDescriptor(scripts, 'test:integration')?.value
		const publish = Object.getOwnPropertyDescriptor(scripts, 'prepublishOnly')?.value
		const hasIntegration = existsSync(resolve(root, 'tests/integration.test.ts'))
		expect(config).toBe(
			'vitest run --config vite.config.ts --no-cache --reporter=dot --project config',
		)
		expect(typeof test === 'string' && test.includes('npm run test:config')).toBe(true)
		expect(integration).toBe(
			hasIntegration
				? 'vitest run --config vite.config.ts --no-cache --reporter=dot --project integration'
				: undefined,
		)
		expect(typeof test === 'string' && test.includes('test:integration')).toBe(false)
		expect(typeof publish === 'string' && publish.includes('npm run test:integration')).toBe(
			hasIntegration,
		)
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

	it('resolves contained workspace paths and refuses a real outside sibling', () => {
		const outside = mkdtempSync(join(tmpdir(), 'orkestrel-config-outside-'))
		try {
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
			rmSync(outside, { recursive: true, force: true })
		}
	})

	it('reads bounded files and resolves package roots from real manifests', () => {
		const workspace = mkdtempSync(join(tmpdir(), 'orkestrel-config-package-'))
		try {
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
			rmSync(workspace, { recursive: true, force: true })
		}
	})

	it('classifies module boundaries and extracts static asset sources', async () => {
		const workspace = mkdtempSync(join(tmpdir(), 'orkestrel-config-assets-'))
		try {
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
			rmSync(workspace, { recursive: true, force: true })
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
		).toThrowError('Build output must use its exact configured workspace directory')
		const outside = resolve(dirname(root), 'outside-config-control')
		expect(() => configHelpers.enforceOutputPath(outside, outside)).toThrowError(
			'Build output must remain inside the workspace',
		)
	})

	it('drives both plugins through their real Vite hooks', async () => {
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
			await expect(Reflect.apply(hook, context, ['@src/server', source])).rejects.toThrowError(
				'Browser modules cannot depend on Node or server-only modules',
			)
			await expect(Reflect.apply(hook, context, ['@src/core', source])).resolves.toBeNull()
		} finally {
			rmSync(workspace, { recursive: true, force: true })
		}
	})
})
