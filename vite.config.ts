import type { UserConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import manifest from './package.json' with { type: 'json' }
import tsconfig from './tsconfig.json' with { type: 'json' }
import { enforceBuildLog, environmentBoundary, outputBoundary } from './configs/helpers.js'
import { resolveBrowser, resolvePinnedBrowser } from './configs/browsers.js'
import { fileURLToPath, URL } from 'node:url'

const browserOptions = resolveBrowser(resolvePinnedBrowser(), process.platform, process.env)

export function resolveWorkspacePath(relativePath: string): string {
	return fileURLToPath(new URL(relativePath, import.meta.url))
}

const peerDependencies = 'peerDependencies' in manifest ? manifest.peerDependencies : undefined
if (
	peerDependencies !== undefined &&
	(typeof peerDependencies !== 'object' ||
		peerDependencies === null ||
		Array.isArray(peerDependencies))
) {
	throw new Error('package peerDependencies must be an object')
}
export const peers: readonly string[] =
	peerDependencies === undefined ? [] : Object.keys(peerDependencies)

const resolve = {
	alias: Object.entries(tsconfig.compilerOptions.paths).reduce((aliases, [key, values]) => {
		const [path] = values
		if (path === undefined) throw new Error('tsconfig path alias ' + key + ' has no target')
		return Object.assign(aliases, { [key]: resolveWorkspacePath(path) })
	}, {}),
}

export const srcCore = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			publicDir: false,
			build: {
				emptyOutDir: true,
				sourcemap: true,
				minify: false,
				rolldownOptions: { onLog: enforceBuildLog },
			},
			test: {
				name: { label: 'src:core', color: 'magenta' },
				include: ['tests/src/core/**/*.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
			},
		},
		options ?? {},
	)

export const srcBrowser = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			publicDir: false,
			plugins: [outputBoundary('dist/src/browser'), environmentBoundary('src/browser')],
			build: {
				emptyOutDir: true,
				sourcemap: true,
				minify: false,
				lib: {
					entry: resolveWorkspacePath('src/browser/index.ts'),
					formats: ['es'],
					fileName: () => 'index.js',
				},
				outDir: 'dist/src/browser',
				rolldownOptions: {
					onLog: enforceBuildLog,
					external: (id: string) =>
						id === '@src/core' ||
						id.startsWith('@orkestrel/') ||
						peers.some((peer) => id === peer || id.startsWith(peer + '/')),
					output: { paths: { '@src/core': '../core/index.js' } },
				},
			},
			test: {
				name: { label: 'src:browser', color: 'yellow' },
				include: ['tests/src/browser/**/*.test.ts'],
				exclude: ['tests/src/core/**/*.test.ts'],
				setupFiles: ['./tests/setup.ts', './tests/setupBrowser.ts'],

				browser: {
					enabled: true,
					provider: playwright(browserOptions),
					instances: [{ browser: 'chromium', headless: true }],
				},
				fileParallelism: false,
			},
		},
		options ?? {},
	)

export const srcServer = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			publicDir: false,
			plugins: [outputBoundary('dist/src/server'), environmentBoundary('src/server')],
			build: {
				emptyOutDir: true,
				sourcemap: true,
				minify: false,
				lib: {
					entry: resolveWorkspacePath('src/server/index.ts'),
					formats: ['es', 'cjs'],
					fileName: (format: string) => (format === 'es' ? 'index.js' : 'index.cjs'),
				},
				outDir: 'dist/src/server',
				target: 'node22',
				rolldownOptions: {
					onLog: enforceBuildLog,
					platform: 'node',
					external: (id: string) =>
						id === '@src/core' ||
						id.startsWith('node:') ||
						id.startsWith('@orkestrel/') ||
						peers.some((peer) => id === peer || id.startsWith(peer + '/')),
					output: [
						{
							format: 'es',
							entryFileNames: 'index.js',
							paths: { '@src/core': '../core/index.js' },
						},
						{
							format: 'cjs',
							entryFileNames: 'index.cjs',
							paths: { '@src/core': '../core/index.cjs' },
						},
					],
				},
			},
			test: {
				name: { label: 'src:server', color: 'red' },
				include: ['tests/src/server/**/*.test.ts'],
				exclude: ['tests/src/core/**/*.test.ts'],
				setupFiles: ['./tests/setup.ts', './tests/setupServer.ts'],
				environment: 'node',
				browser: { enabled: false },
			},
		},
		options ?? {},
	)

export const policy = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			test: {
				name: { label: 'policy', color: 'white' },
				include: ['tests/policy.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
			},
		},
		options ?? {},
	)

export const config = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			test: {
				name: { label: 'config', color: 'yellow' },
				include: ['tests/config.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
				// A config test validates every target wrapper and runs the real linter twice with
				// 15-second child caps, so this budget clears both caps and reports their diagnostics.
				testTimeout: 45_000,
			},
		},
		options ?? {},
	)

export const guides = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			test: {
				name: { label: 'guides', color: 'green' },
				include: ['tests/guides.test.ts'],
				exclude: ['tests/src/**/*.test.ts', 'tests/app/**/*.test.ts', 'tests/setup.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
			},
		},
		options ?? {},
	)

export const distribution = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			test: {
				name: { label: 'distribution', color: 'cyan' },
				include: ['tests/distribution.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				testTimeout: 120_000,
				hookTimeout: 120_000,
				fileParallelism: false,
			},
		},
		options ?? {},
	)

// A workbench, not a proof. No gate selects this project. Run in test mode by the
// `test:probe` script, it collects `tmp/probe/**/*.test.ts`. Run in benchmark mode by the
// `test:bench` script, the same workbench also collects `tests/**/*.test.ts` for a `bench` block,
// so a suite may carry a bench beside its ordinary tests without a second project. The mode
// guard around each `bench` call keeps it out of test mode, so it never executes there.
export const probe = (options?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			test: {
				name: { label: 'probe', color: 'gray' },
				include: ['tmp/probe/**/*.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
				fileParallelism: false,
				pool: 'threads',
				benchmark: { include: ['tmp/probe/**/*.test.ts', 'tests/**/*.test.ts'] },
			},
		},
		options ?? {},
	)

export default defineConfig({
	resolve,
	test: {
		projects: [srcCore, srcBrowser, srcServer, policy, config, guides, distribution, probe],
	},
})
