import type { PluginOption, UserConfig } from 'vite'
import { mergeConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import manifest from './package.json' with { type: 'json' }
import tsconfig from './tsconfig.json' with { type: 'json' }
import {
	enforceBuildLog,
	environmentBoundary,
	outputBoundary,
	resolveExternal,
} from './configs/helpers.js'
import { resolveBrowser, resolvePinnedBrowser } from './configs/browsers.js'
import { fileURLToPath, URL } from 'node:url'

const browserOptions = resolveBrowser(resolvePinnedBrowser(), process.platform, process.env)

const optimizeDeps = {
	include: ['@orkestrel/test', '@orkestrel/test/browser', '@orkestrel/contract'],
}

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

// Merges a caller's override onto the configuration a factory declares, so a
// package's own configuration reaches the factory through its parameter instead of
// wrapping the call from outside.
//
// Vitest calls every registered project factory with its own invocation record —
// `command`, `mode`, `isSsrBuild`, `isPreview` — so a factory that also takes an
// override receives that record in the same position. A `UserConfig` declares `mode`
// but not `command`, and the invocation record always carries both, so a value
// carrying the pair is that record rather than an override. The merge returns the
// base in the record's `mode` and carries none of the record's other fields. Vitest
// runs a project that declares no `mode` in its own run mode, `test`, rather than in
// the `--mode` value it was invoked with, so a distribution proof run with
// `--mode release` would read `test` and skip where it must fail. A record whose
// `mode` is not a string throws. The `tests/config.test.ts` file drives every
// registered factory through it.
//
// `mergeConfig` concatenates arrays, so an override carrying `plugins` would otherwise
// add a second copy of a plugin the base already declares. Only named top-level
// objects replace a base plugin of the same name, in the base's position, and one
// override entry is taken at most once. An entry no base position took appends in its
// written order; the caller's own entries never merge with each other. Nested arrays,
// promises, falsy entries, and anonymous objects pass through unchanged. An override
// cannot remove a base plugin. Every key other than `plugins` merges as `mergeConfig`
// merges it, so an override's arrays elsewhere concatenate with the base's rather than
// replacing them.
export function mergeOverride(base: UserConfig, override?: UserConfig): UserConfig {
	if (override !== undefined && 'command' in override && 'mode' in override) {
		if (typeof override.mode !== 'string') {
			throw new Error('The project invocation carries no string mode')
		}
		override = { mode: override.mode }
	}
	const merged: UserConfig = override === undefined ? { ...base } : mergeConfig(base, override)
	const name = merged.test?.name
	const label = typeof name === 'string' ? name : name?.label
	const browser = merged.test?.browser
	if (label !== undefined && browser?.instances !== undefined) {
		merged.test = {
			...merged.test,
			browser: {
				...browser,
				instances: browser.instances.map((instance) => ({
					...instance,
					name: instance.name ?? `${label} (${instance.browser})`,
				})),
			},
		}
	}
	if (merged.plugins === undefined || override === undefined) return merged
	const candidates = override.plugins ?? []
	const taken = new Set<number>()
	const selected: PluginOption[] = []
	for (const plugin of base.plugins ?? []) {
		if (!isNamedPlugin(plugin)) {
			selected.push(plugin)
			continue
		}
		const index = candidates.findIndex(
			(candidate, position) =>
				!taken.has(position) && isNamedPlugin(candidate) && candidate.name === plugin.name,
		)
		const replacement = candidates[index]
		if (replacement === undefined) {
			selected.push(plugin)
		} else {
			selected.push(replacement)
			taken.add(index)
		}
	}
	for (const [index, plugin] of candidates.entries()) {
		if (!taken.has(index)) selected.push(plugin)
	}
	return { ...merged, plugins: selected }
}

function isNamedPlugin(plugin: PluginOption): plugin is { name: string } {
	return (
		typeof plugin === 'object' &&
		plugin !== null &&
		!Array.isArray(plugin) &&
		!('then' in plugin && typeof plugin.then === 'function') &&
		'name' in plugin &&
		typeof plugin.name === 'string'
	)
}

function resolveSourceExternal(id: string): boolean {
	return (
		id === '@src/core' ||
		resolveExternal(id, {
			peers,
			refused: [],
			siblings: [resolveWorkspacePath('src/core/index.ts')],
		})
	)
}

export function srcCore(override?: UserConfig): UserConfig {
	const project: UserConfig = {
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
	}
	return mergeOverride(project, override)
}

function resolveBrowserFilename(): string {
	return 'index.js'
}

export function srcBrowser(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		optimizeDeps,
		publicDir: false,
		plugins: [outputBoundary('dist/src/browser'), environmentBoundary('src/browser')],
		build: {
			emptyOutDir: true,
			sourcemap: true,
			minify: false,
			lib: {
				entry: resolveWorkspacePath('src/browser/index.ts'),
				formats: ['es'],
				fileName: resolveBrowserFilename,
			},
			outDir: 'dist/src/browser',
			rolldownOptions: {
				onLog: enforceBuildLog,
				external: resolveSourceExternal,
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
			sequence: { groupOrder: 1 },
		},
	}
	return mergeOverride(project, override)
}

function resolveServerFilename(format: string): string {
	return format === 'es' ? 'index.js' : 'index.cjs'
}

export function srcServer(override?: UserConfig): UserConfig {
	const project: UserConfig = {
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
				fileName: resolveServerFilename,
			},
			outDir: 'dist/src/server',
			target: 'node22',
			rolldownOptions: {
				onLog: enforceBuildLog,
				platform: 'node',
				external: resolveSourceExternal,
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
	}
	return mergeOverride(project, override)
}

export function policy(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		test: {
			name: { label: 'policy', color: 'white' },
			include: ['tests/policy.test.ts'],
			setupFiles: ['./tests/setup.ts'],
			environment: 'node',
			browser: { enabled: false },
		},
	}
	return mergeOverride(project, override)
}

export function config(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		test: {
			name: { label: 'config', color: 'yellow' },
			include: ['tests/config.test.ts'],
			setupFiles: ['./tests/setup.ts'],
			environment: 'node',
			browser: { enabled: false },
			// A config test validates every target wrapper, spawns the real linter twice under
			// 15-second child caps, and rolls one face up through the compiler and the extractor it
			// spawns, so this budget clears the capped pair with room for a contended host.
			testTimeout: 60_000,
		},
	}
	return mergeOverride(project, override)
}

export function setup(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		test: {
			name: { label: 'setup', color: 'white' },
			include: ['tests/setup*.test.ts'],
			exclude: ['tests/setupBrowser.test.ts', 'tests/setupStyles.test.ts'],
			setupFiles: ['./tests/setup.ts'],
			pool: 'threads',
			isolate: false,
			environment: 'node',
			browser: { enabled: false },
		},
	}
	return mergeOverride(project, override)
}

export function setupBrowser(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		optimizeDeps,
		test: {
			name: { label: 'setup:browser', color: 'blue' },
			include: ['tests/setupBrowser.test.ts', 'tests/setupStyles.test.ts'],
			setupFiles: ['./tests/setup.ts', './tests/setupBrowser.ts'],
			browser: {
				enabled: true,
				provider: playwright(browserOptions),
				instances: [{ browser: 'chromium', headless: true }],
			},
		},
	}
	return mergeOverride(project, override)
}

export function guides(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		test: {
			name: { label: 'guides', color: 'green' },
			include: ['tests/guides.test.ts'],
			exclude: ['tests/src/**/*.test.ts', 'tests/app/**/*.test.ts', 'tests/setup.test.ts'],
			setupFiles: ['./tests/setup.ts'],
			environment: 'node',
			browser: { enabled: false },
		},
	}
	return mergeOverride(project, override)
}

export function distribution(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		test: {
			name: { label: 'distribution', color: 'cyan' },
			include: ['tests/distribution.test.ts'],
			setupFiles: ['./tests/setup.ts'],
			environment: 'node',
			testTimeout: 120_000,
			hookTimeout: 120_000,
			fileParallelism: false,
			sequence: { groupOrder: 1 },
		},
	}
	return mergeOverride(project, override)
}

// A workbench, not a proof. No gate selects this project. Run in test mode by the
// `test:probe` script, it collects `tmp/probes/**/*.test.ts`. Run in benchmark mode by the
// `test:bench` script, the same workbench also collects `tests/**/*.test.ts` for a `bench` block,
// so a suite may carry a bench beside its ordinary tests without a second project. The mode
// guard around each `bench` call keeps it out of test mode, so it never executes there.
export function probe(override?: UserConfig): UserConfig {
	const project: UserConfig = {
		resolve,
		test: {
			name: { label: 'probe', color: 'black' },
			include: ['tmp/probes/**/*.test.ts'],
			setupFiles: ['./tests/setup.ts'],
			environment: 'node',
			browser: { enabled: false },
			fileParallelism: false,
			sequence: { groupOrder: 1 },
			pool: 'threads',
			benchmark: { include: ['tmp/probes/**/*.test.ts', 'tests/**/*.test.ts'] },
		},
	}
	return mergeOverride(project, override)
}

export default defineConfig({
	resolve,
	test: {
		projects: [
			srcCore,
			srcBrowser,
			srcServer,
			policy,
			config,
			setup,
			setupBrowser,
			guides,
			distribution,
			probe,
		],
	},
})
