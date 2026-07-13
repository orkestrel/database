import type { UserConfig } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import tsconfig from './tsconfig.json' with { type: 'json' }
import { fileURLToPath, URL } from 'node:url'
import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { playwright } from '@vitest/browser-playwright'

export function resolveWorkspacePath(relativePath: string): string {
	return fileURLToPath(new URL(relativePath, import.meta.url))
}

/**
 * Normalize the cross-entry core-type imports in a bundled declaration entry.
 *
 * The browser and server libs mark `@src/core` external and reference the sibling
 * `dist/src/core` build instead of inlining it (see `srcBrowser` / `srcServer`).
 * api-extractor (via vite-plugin-dts `bundleTypes`) collects those imports verbatim
 * from the per-file pre-bundle emit, where the `@src/core` alias resolves to the
 * source path — so the rolled-up entry ends up importing core types from
 * `../core/index.ts` / `../../core/index.ts` (a `.ts` extension that isn't shipped,
 * at depths relative to each source file rather than the final bundle). Rewrite every
 * such specifier to the shipped ESM declaration entry `../core/index.js`, matching the
 * JS output's `paths: { '@src/core': '../core/index.js' }` rewrite so `tsc` resolves
 * the sibling `dist/src/core/index.d.ts` from the bundled entry.
 *
 * Runs as the vite-plugin-dts `afterBuild` hook — after api-extractor has written the
 * final bundled entry — so it never perturbs api-extractor's own module resolution.
 */
export function rewriteCoreEntry(outDir: string): () => void {
	return () => {
		const file = resolveWorkspacePath(`${outDir}/index.d.ts`)
		const content = readFileSync(file, 'utf8')
		const fixed = content.replace(
			/(['"])(?:@src\/core|(?:\.\.\/)+core\/index(?:\.d)?\.[cm]?ts)\1/g,
			"'../core/index.js'",
		)
		if (fixed !== content) writeFileSync(file, fixed)
	}
}

/**
 * Resolve the Playwright browser provider, by precedence — one self-contained
 * function covering every environment (Windows, macOS, Linux, Claude Code Cloud):
 *
 *   1. `PLAYWRIGHT_EXECUTABLE_PATH` — an explicit browser binary (CI / pinned).
 *   2. `PLAYWRIGHT_WS_ENDPOINT`     — a CDP / WebSocket endpoint of an already-
 *      running browser (remote debugging, a browser-tools MCP, etc.).
 *   3. `PLAYWRIGHT_CHANNEL`         — an explicit channel (`chrome`, `msedge`,
 *      `chromium`, …) for local dev loops.
 *   4. Claude Code / Claude Cloud  — the bundled chromium under
 *      `/opt/pw-browsers/`. The revision dir AND its inner layout drift across
 *      Playwright builds, plus a top-level `chromium` symlink points at the
 *      installed binary — so glob every known shape and take the highest match.
 *   5. Platform default — Windows → `msedge` (ships with the OS, never collides
 *      with a foreground Chrome); macOS / Linux → `chrome`. Override with
 *      `PLAYWRIGHT_CHANNEL` when the default isn't installed.
 */
export function createBrowserProvider() {
	const { PLAYWRIGHT_EXECUTABLE_PATH, PLAYWRIGHT_WS_ENDPOINT, PLAYWRIGHT_CHANNEL } = process.env
	if (PLAYWRIGHT_EXECUTABLE_PATH)
		return playwright({ launchOptions: { executablePath: PLAYWRIGHT_EXECUTABLE_PATH } })
	if (PLAYWRIGHT_WS_ENDPOINT)
		return playwright({ connectOptions: { wsEndpoint: PLAYWRIGHT_WS_ENDPOINT } })
	if (PLAYWRIGHT_CHANNEL) return playwright({ launchOptions: { channel: PLAYWRIGHT_CHANNEL } })
	if (process.platform === 'linux') {
		for (const pattern of [
			'/opt/pw-browsers/chromium',
			'/opt/pw-browsers/chromium-*/chrome-linux64/chrome',
			'/opt/pw-browsers/chromium-*/chrome-linux/chrome',
		]) {
			const [executablePath] = globSync(pattern).sort().reverse()
			if (executablePath) return playwright({ launchOptions: { executablePath } })
		}
	}
	const channel = process.platform === 'win32' ? 'msedge' : 'chrome'
	return playwright({ launchOptions: { channel } })
}

const resolve = {
	alias: Object.entries(tsconfig.compilerOptions.paths).reduce(
		(a, [k, v]) => Object.assign(a, { [k]: resolveWorkspacePath(v[0]) }),
		{},
	),
}

// Base: shared resolve + build defaults + src:core tests.
export const srcCore = (config?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			build: {
				emptyOutDir: true,
				sourcemap: true,
				minify: false,
			},
			test: {
				name: { label: 'src:core', color: 'magenta' },
				include: ['tests/src/core/**/*.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
			},
		},
		config ?? {},
	)

// Extends srcCore: the guides-parity suite. Node env — it reads the real
// guides/*.md and the documented source modules off disk — but resolves like core tests.
export const guides = (config?: UserConfig): UserConfig =>
	srcCore(
		mergeConfig(
			{
				test: {
					name: { label: 'guides', color: 'green' },
					include: ['tests/guides/**/*.test.ts'],
					exclude: ['tests/src/**/*.test.ts', 'tests/setup.test.ts'],
				},
			},
			config ?? {},
		),
	)

// Extends srcCore: browser-only library (`src/browser`, e.g. the IndexedDB
// driver). Builds an ES lib and runs its tests in a real Chromium via
// Playwright, where DOM and `indexedDB` are available. No Vue — this surface is
// plain TypeScript; add the plugin here if a browser app surface ever needs it.
export const srcBrowser = (config?: UserConfig): UserConfig =>
	srcCore(
		mergeConfig(
			{
				build: {
					lib: {
						entry: resolveWorkspacePath('src/browser/index.ts'),
						formats: ['es'],
						fileName: () => 'index.js',
					},
					outDir: 'dist/src/browser',
					// The browser lib and the core lib ship as two subpaths of one package,
					// so the published build references the sibling `dist/src/core` (ESM)
					// instead of inlining a copy. Build-only — the test project below
					// resolves `@src/core` from source through the shared `resolve` alias.
					// `@orkestrel/*` dependencies are externalized too — consumers resolve
					// them from their own installed packages instead of inlined copies.
					rolldownOptions: {
						external: (id: string) => id === '@src/core' || id.startsWith('@orkestrel/'),
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
						provider: createBrowserProvider(),
						instances: [{ browser: 'chromium', headless: true }],
					},
					fileParallelism: false,
				},
			},
			config ?? {},
		),
	)

// Extends srcCore: server-only library (`src/server`, e.g. the JSON file driver
// and, later, the SQLite driver over node:sqlite). Builds a dual ESM+CJS lib for
// Node and runs its tests in the node environment. Externalizes `node:*` (so
// node:sqlite is never bundled) AND `@src/core` → the sibling `dist/src/core`
// build (format-aware: `../core/index.js` for the ESM output, `../core/index.cjs`
// for the CJS output), exactly as core ships dual-format. Build-only — the
// test project resolves `@src/core` from source through the shared `resolve` alias.
export const srcServer = (config?: UserConfig): UserConfig =>
	srcCore(
		mergeConfig(
			{
				build: {
					lib: {
						entry: resolveWorkspacePath('src/server/index.ts'),
						formats: ['es', 'cjs'],
						fileName: (format: string) => (format === 'es' ? 'index.js' : 'index.cjs'),
					},
					outDir: 'dist/src/server',
					target: 'node24',
					rolldownOptions: {
						external: (id: string) =>
							id === '@src/core' || id.startsWith('@orkestrel/') || id.startsWith('node:'),
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
				},
			},
			config ?? {},
		),
	)

export default defineConfig({
	resolve,
	test: {
		projects: [srcCore, srcBrowser, srcServer, guides],
	},
})
