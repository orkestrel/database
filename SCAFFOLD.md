# SCAFFOLD.md — orkestrel package scaffolding reference

> The copy-paste recipe for standing up a new `@orkestrel/<name>` package from scratch —
> or for auditing an existing one back into consistency with the rest of the line. It
> covers every root config file, every per-environment build wrapper, the exports shapes,
> the test wiring, the guides system, and the quality-gate pipeline, for **every variant
> combination** of the three environment surfaces (`core`, `browser`, `server`).
>
> The sibling repositories at HEAD are the ultimate source of truth. When this document
> and a sibling repo disagree, diff both against the exemplar repos in §1.2 and fix
> whichever drifted. `AGENTS.md` remains the authority on code substance (naming,
> barrels, errors, testing methodology); this document encodes the packaging and
> configuration that make those conventions build, test, and publish green.
>
> **Indentation.** Every embedded file uses **literal TAB characters** (JSON at width 2,
> code at width 4 — see `.editorconfig`). When recreating any file below, use real tabs.

---

## 0. Conventions used in this document

| Placeholder | Means                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `<name>`    | the package's short name — the repo name (`abort`, `router`, …)       |
| `<v>`       | an environment surface the package ships: `core`, `browser`, `server` |

**Copy-first principle.** Most files below are byte-identical across every repo in the
line. When scaffolding or fixing, `cp` them from a sibling at HEAD and keep them
byte-identical — never hand-retype what has a canonical source. Only the files marked
_package-specific_ carry your own content.

---

## 1. Mental model

One npm package ships **one to three environment surfaces** under `src/`:

- **`core`** — environment-agnostic TypeScript. No DOM, no `node:*`. Published at the
  package root (`.`), dual-format (ESM + CJS).
- **`browser`** — browser-only code (DOM, IndexedDB, History…). ESM-only.
- **`server`** — Node-only code (`node:http`, `node:sqlite`…). Dual-format, built for
  `node24`.

Every combination is valid. A package with a `core` surface publishes it at `.` and the
others as subpaths (`./browser`, `./server`). A **single-surface** package (no `core`)
publishes its only surface at `.`.

### 1.1 The load-bearing rule: dependency direction

> `browser` and `server` import from **`@src/core`**; `core` imports from neither.
> `core` may import other `@orkestrel/*` packages (declared in `dependencies`).
> Barrels **never re-export a symbol that originates in another package** (AGENTS §6) —
> import sites point at the originating package instead.

Everything downstream — the build externals, the exports map, the per-surface scoped
typechecks — exists to enforce this.

### 1.2 The variant matrix (live exemplars)

| Variant combination     | Exemplar repos                                                                                 | Publishes                    |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------- |
| core only               | `abort`, `timeout`, `budget`, `emitter`, `contract`, `markdown`, `guide`, `relation`, `reason` | `.`                          |
| core + server           | `server`, `middleware`                                                                         | `.`, `./server`              |
| core + browser + server | `router`, `database`, `workflow`                                                               | `.`, `./browser`, `./server` |
| server only             | `sqlite`                                                                                       | `.` (the server build)       |
| browser only            | `indexeddb`                                                                                    | `.` (the browser build)      |
| core + browser          | _(no live exemplar — derive: router minus its server surface)_                                 | `.`, `./browser`             |

When fixing a repo, diff against the exemplar for its combination.

### 1.3 What `dist/` produces

| Surface   | Formats              | Files in `dist/src/<v>/`                                      | Externals (build)                     |
| --------- | -------------------- | ------------------------------------------------------------- | ------------------------------------- |
| `core`    | ESM + CJS            | `index.js`, `index.cjs`, `index.d.ts`, `index.d.cts` (+ maps) | `node:*`, `@orkestrel/*`              |
| `browser` | ESM only             | `index.js`, `index.d.ts` (+ map)                              | `@src/core`, `@orkestrel/*`           |
| `server`  | ESM + CJS (`node24`) | `index.js`, `index.cjs`, `index.d.ts`, `index.d.cts` (+ maps) | `@src/core`, `node:*`, `@orkestrel/*` |

Three rules make this table:

- **Declared dependencies are never bundled.** Every library build externalizes `node:*`
  and `@orkestrel/*`. A consumer installs the deps; the emitted JS imports them as bare
  specifiers. (Bundling a declared dep double-ships it and breaks type/instance identity —
  the dual-package hazard.)
- **`@src/core` becomes the sibling build.** In multi-surface packages, `browser`/`server`
  externalize `@src/core` and rewrite it to the sibling `dist/src/core` entry —
  format-aware for the dual-format server build (`../core/index.js` in the ESM output,
  `../core/index.cjs` in the CJS output). The surfaces ship as subpaths of one package
  rather than each inlining a copy of core.
- **One bundled declaration file per surface.** Types are emitted inline by
  `vite-plugin-dts` (`bundleTypes: true`) during `vite build` — a single `index.d.ts` per
  surface. Dual-format surfaces then copy it to `index.d.cts` (the `copy` script). There
  is **no hand-rolled declaration post-processing** — no `tsc` emit step in build scripts,
  no `dts.*.mjs` bundler scripts, no `rollup`/`rollup-plugin-dts` devDependencies. If a
  repo has any of those, it predates the migration: remove them.

---

## 2. Prerequisites & toolchain

- **Node `>= 24`** (`package.json` `engines`). Server builds target `node24`.
- **npm** with a committed `package-lock.json`.
- No global tools — everything is a devDependency.

| Concern             | Tool                                                                                   | Config                                     |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| Type-check          | `tsc` (typescript ^6.0.3)                                                              | `tsconfig.json` + `configs/src/*`          |
| Lint                | `oxlint` ^1.73.0                                                                       | `.oxlintrc.json`, `.oxlintignore`          |
| Format              | `oxfmt` ^0.58.0                                                                        | `.oxfmtrc.json`, `.prettierignore`         |
| Bundle              | `vite` ^8.1.4 (Rolldown-based)                                                         | `vite.config.ts` + `configs/src/*`         |
| Declarations        | `vite-plugin-dts` ^5.0.3 (+ `@microsoft/api-extractor` ^7.58.9, used by `bundleTypes`) | inline in `configs/src/vite.<v>.config.ts` |
| Test                | `vitest` ^4.1.10                                                                       | `vite.config.ts` (projects)                |
| Browser test driver | `@vitest/browser-playwright` ^4.1.10 (Chromium) — **browser-surface repos only**       | resolved in `vite.config.ts`               |
| Guides parity       | `@orkestrel/guide` ^0.0.1 (devDependency — every repo except `guide` itself)           | `tests/guides/src/parity.test.ts`          |
| Types               | `@types/node` ^26.1.1                                                                  | —                                          |

---

## 3. Repo inventory — every file, and where it comes from

| File                                                                                                             | Package-specific?                    | Source                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `package.json`                                                                                                   | identity + deps                      | copy a sibling of the same variant class, edit §4                                   |
| `package-lock.json`                                                                                              | generated                            | `npm install`                                                                       |
| `tsconfig.json`                                                                                                  | `paths` only                         | §5                                                                                  |
| `vite.config.ts`                                                                                                 | variant shape + surface doc comments | §6                                                                                  |
| `configs/src/tsconfig.<v>.json`                                                                                  | no                                   | §7 — byte-identical per variant                                                     |
| `configs/src/vite.<v>.config.ts`                                                                                 | no                                   | §7 — byte-identical per variant                                                     |
| `.editorconfig` `.gitattributes` `.gitignore` `.oxfmtrc.json` `.oxlintrc.json` `.oxlintignore` `.prettierignore` | no                                   | §8 — byte-identical everywhere                                                      |
| `.github/workflows/ci.yml`                                                                                       | no                                   | §11 — byte-identical everywhere                                                     |
| `AGENTS.md`, `CLAUDE.md`, `.claude/agents/*` (7 role files)                                                      | no                                   | byte-copy from any sibling                                                          |
| `LICENSE`                                                                                                        | no                                   | byte-copy (MIT, Copyright (c) 2026 Orkestrel)                                       |
| `README.md`                                                                                                      | yes                                  | model on a sibling's (title, Install, Requirements, Usage, Guide, Package, License) |
| `src/<v>/…`                                                                                                      | yes                                  | AGENTS.md §5–§7 (barrels, centralized files)                                        |
| `tests/setup.ts` (+ `setupBrowser.ts` / `setupServer.ts` for those surfaces)                                     | yes                                  | §9                                                                                  |
| `tests/src/<v>/…`, `tests/guides/src/parity.test.ts`                                                             | parity test: one line                | §9–§10                                                                              |
| `guides/README.md`, `guides/src/*.md`                                                                            | yes + mirrors                        | §10                                                                                 |

---

## 4. `package.json`

The complete canonical core-only example (`abort` at HEAD — copy the FILE from the
sibling repo, then edit only the identity fields and dependencies; the fence below is
the reference rendering — note markdown-fence formatting collapses the `files` array
onto one line, while the real file keeps one entry per line):

```json
{
	"name": "@orkestrel/abort",
	"version": "0.0.1",
	"description": "A typed AbortController wrapper — stable ids, parent-signal linking via AbortSignal.any, idempotent abort with reason preservation. Part of the @orkestrel line.",
	"keywords": [
		"abort",
		"abort-controller",
		"abort-signal",
		"cancellation",
		"signals",
		"typescript"
	],
	"homepage": "https://github.com/orkestrel/abort#readme",
	"bugs": "https://github.com/orkestrel/abort/issues",
	"license": "MIT",
	"repository": {
		"type": "git",
		"url": "git+https://github.com/orkestrel/abort.git"
	},
	"files": ["dist", "README.md"],
	"type": "module",
	"sideEffects": false,
	"main": "./dist/src/core/index.cjs",
	"module": "./dist/src/core/index.js",
	"types": "./dist/src/core/index.d.ts",
	"exports": {
		".": {
			"import": {
				"types": "./dist/src/core/index.d.ts",
				"default": "./dist/src/core/index.js"
			},
			"require": {
				"types": "./dist/src/core/index.d.cts",
				"default": "./dist/src/core/index.cjs"
			}
		},
		"./package.json": "./package.json"
	},
	"publishConfig": {
		"access": "public"
	},
	"scripts": {
		"clean": "node -e \"try{require('node:fs').rmSync('dist',{recursive:true,force:true})}catch{}\"",
		"copy": "node -e \"const fs=require('node:fs'),p=require('node:path'),a=process.argv[1],b=process.argv[2];fs.mkdirSync(p.dirname(b),{recursive:true});fs.cpSync(a,b,{force:true});console.log('Copied: '+a+' to '+b)\"",
		"tmp:txt": "node -e \"const fs=require('node:fs'),p=require('node:path');function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){walk(f)}else if(!e.name.endsWith('.md')&&!e.name.endsWith('.txt')){const t=f+'.txt';if(!fs.existsSync(t)){fs.renameSync(f,t)}else{console.warn('Skipping '+f+' — target exists: '+t)}}}}try{walk('tmp')}catch(e){if(e.code!=='ENOENT')throw e}\"",
		"lint": "oxlint --config .oxlintrc.json --fix .",
		"check": "tsc --noEmit --project tsconfig.json",
		"check:src": "npm run check:src:core",
		"check:src:core": "tsc --noEmit -p configs/src/tsconfig.core.json",
		"format": "oxfmt --config .oxfmtrc.json --write .",
		"format:check": "oxfmt --config .oxfmtrc.json --check .",
		"lint:check": "oxlint --config .oxlintrc.json .",
		"test": "npm run test:src && npm run test:guides",
		"test:src": "vitest run --config vite.config.ts --no-cache --reporter=dot --project src:core",
		"test:src:core": "vitest run --config vite.config.ts --no-cache --reporter=dot --project src:core",
		"test:guides": "vitest run --config vite.config.ts --reporter=dot --project guides",
		"build": "npm run clean && npm run build:src",
		"build:src": "npm run build:src:core",
		"build:src:core": "vite build --config configs/src/vite.core.config.ts && npm run copy dist/src/core/index.d.ts dist/src/core/index.d.cts",
		"prepublishOnly": "npm run format:check && npm run lint:check && npm run check && npm run check:src && npm run build && npm test"
	},
	"dependencies": {
		"@orkestrel/contract": "^0.0.1"
	},
	"devDependencies": {
		"@microsoft/api-extractor": "^7.58.9",
		"@orkestrel/guide": "^0.0.1",
		"@types/node": "^26.1.1",
		"oxfmt": "^0.58.0",
		"oxlint": "^1.73.0",
		"typescript": "^6.0.3",
		"vite": "^8.1.4",
		"vite-plugin-dts": "^5.0.3",
		"vitest": "^4.1.10"
	},
	"engines": {
		"node": ">=24"
	}
}
```

### 4.1 Uniform fields (identical in every repo — never vary)

```json
"files": ["dist", "README.md"],
"type": "module",
"sideEffects": false,
"publishConfig": { "access": "public" },
"engines": { "node": ">=24" },
"license": "MIT"
```

Identity fields (`name`, `description` — one line ending in "Part of the @orkestrel
line.", `keywords` — lowercase, alphabetized, `homepage`/`bugs`/`repository` —
`github.com/orkestrel/<name>` shapes) are the package's own. New packages start at
`"version": "0.0.1"`.

### 4.2 Entry fields and the multi-surface `types` rule

| Variant class                       | `main`                        | `module`                      | top-level `types`?                     |
| ----------------------------------- | ----------------------------- | ----------------------------- | -------------------------------------- |
| core-only                           | `./dist/src/core/index.cjs`   | `./dist/src/core/index.js`    | **yes** (`./dist/src/core/index.d.ts`) |
| multi-surface (has subpath exports) | `./dist/src/core/index.cjs`   | `./dist/src/core/index.js`    | **NO — omit it**                       |
| server-only                         | `./dist/src/server/index.cjs` | `./dist/src/server/index.js`  | yes                                    |
| browser-only                        | `./dist/src/browser/index.js` | `./dist/src/browser/index.js` | yes                                    |

> **Why multi-surface packages must NOT have a top-level `types` field:**
> `vite-plugin-dts` derives its bundled-declaration entry from `package.json#types`. In a
> multi-surface package that field points at core, so the browser/server builds would try
> to bundle **core's** declaration entry instead of their own and emit nothing. With the
> field absent, the plugin falls back to each build's own `outDir` and every surface
> bundles correctly. Modern TypeScript resolution (`bundler`/`node16`/`nodenext`) never
> reads the top-level field when an `exports` map exists — the per-condition `types`
> entries in `exports` are authoritative. Only legacy `node10` resolution loses the
> fallback, which single-surface packages keep since it costs them nothing.

### 4.3 Exports maps — all shapes

**Core-only** (`.` only) — see the full example above.

**Core + server** (`server`, `middleware`):

```json
"exports": {
	".": {
		"import": { "types": "./dist/src/core/index.d.ts", "default": "./dist/src/core/index.js" },
		"require": { "types": "./dist/src/core/index.d.cts", "default": "./dist/src/core/index.cjs" }
	},
	"./server": {
		"import": { "types": "./dist/src/server/index.d.ts", "default": "./dist/src/server/index.js" },
		"require": { "types": "./dist/src/server/index.d.cts", "default": "./dist/src/server/index.cjs" }
	},
	"./package.json": "./package.json"
}
```

**Core + browser + server** (`router`, `database`) — as above **plus** the browser
subpath, which is **import-only** (the browser build is ESM-only):

```json
"./browser": {
	"import": { "types": "./dist/src/browser/index.d.ts", "default": "./dist/src/browser/index.js" }
}
```

**Server-only** (`sqlite`) — the server build IS the root export:

```json
"exports": {
	".": {
		"import": { "types": "./dist/src/server/index.d.ts", "default": "./dist/src/server/index.js" },
		"require": { "types": "./dist/src/server/index.d.cts", "default": "./dist/src/server/index.cjs" }
	},
	"./package.json": "./package.json"
}
```

**Browser-only** (`indexeddb`) — ESM-only flat conditions (the `default` after `import`
also serves `require(esm)` consumers on Node ≥ 24):

```json
"exports": {
	".": {
		"types": "./dist/src/browser/index.d.ts",
		"import": "./dist/src/browser/index.js",
		"default": "./dist/src/browser/index.js"
	},
	"./package.json": "./package.json"
}
```

### 4.4 Scripts — the per-variant matrix

The block above is canonical. Per variant, the family expands mechanically — one
`check:src:<v>` / `build:src:<v>` / `test:src:<v>` per surface, with the aggregates
chaining exactly the surfaces the package has (**core first** in `build:src` — see §7):

| Script      | core-only                | multi-surface (e.g. core+browser+server)                                          | single-variant (e.g. server-only) |
| ----------- | ------------------------ | --------------------------------------------------------------------------------- | --------------------------------- |
| `check:src` | `npm run check:src:core` | `npm run check:src:core && npm run check:src:browser && npm run check:src:server` | `npm run check:src:server`        |
| `build:src` | `npm run build:src:core` | `npm run build:src:core && npm run build:src:browser && npm run build:src:server` | `npm run build:src:server`        |
| `test:src`  | `… --project src:core`   | `… --project src:core --project src:browser --project src:server`                 | `… --project src:server`          |

Per-surface build scripts:

```json
"build:src:core": "vite build --config configs/src/vite.core.config.ts && npm run copy dist/src/core/index.d.ts dist/src/core/index.d.cts",
"build:src:browser": "vite build --config configs/src/vite.browser.config.ts",
"build:src:server": "vite build --config configs/src/vite.server.config.ts && npm run copy dist/src/server/index.d.ts dist/src/server/index.d.cts"
```

Rules encoded there: dual-format surfaces (core, server) get the `d.ts → d.cts` copy
step; the ESM-only browser surface does not. No build script runs `tsc` (declarations
come from the inline plugin). Every `test:src*` script carries `--no-cache`;
`test:guides` deliberately does not (it reads guides/source off disk each run).
`prepublishOnly` is always exactly:

```json
"prepublishOnly": "npm run format:check && npm run lint:check && npm run check && npm run check:src && npm run build && npm test"
```

### 4.5 Dependencies

- Runtime `@orkestrel/*` deps at `^0.0.1` (or the published version — note `0.0.x` caret
  ranges pin the exact patch: `^0.0.1` never resolves `0.0.2`; bump explicitly when a dep
  publishes). Declare exactly what `src/` imports — no more, no less.
- devDependencies: the §2 table verbatim, same versions everywhere. Add
  `@vitest/browser-playwright` **only** when the package has a browser surface. Every
  repo carries `@orkestrel/guide` (guides parity) except `guide` itself.
- `middleware` shows the peer pattern: a peer dependency (`@orkestrel/server`) duplicated
  into devDependencies for local tests.

---

## 5. `tsconfig.json`

Byte-identical everywhere except the `paths` block, which lists **only the surfaces the
package has** (this is the alias source of truth — `vite.config.ts` derives its resolve
map from it):

```json
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"lib": ["ESNext", "DOM", "DOM.Iterable"],
		"types": ["node", "vite/client", "vitest/globals"],

		"moduleDetection": "force",
		"resolveJsonModule": true,

		"strict": true,
		"noImplicitOverride": true,
		"noFallthroughCasesInSwitch": true,
		"forceConsistentCasingInFileNames": true,
		"skipLibCheck": true,

		"noEmit": true,
		"paths": {
			"@src/core": ["./src/core/index.ts"],
			"@src/browser": ["./src/browser/index.ts"],
			"@src/server": ["./src/server/index.ts"]
		}
	},
	"exclude": ["node_modules", "dist", "tmp"]
}
```

(A core-only package keeps just the `@src/core` line; `sqlite` keeps just `@src/server`;
`indexeddb` just `@src/browser`.)

---

## 6. The root `vite.config.ts`

One file defines every surface's build **and** every Vitest project as composable
factories. The complete multi-surface canonical (`router` at HEAD, byte-identical except
that the two package-specific surface descriptions in the srcBrowser/srcServer doc
comments are generalized to `<describe THIS package's …>` placeholders — write your own):

```ts
import type { UserConfig } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import tsconfig from './tsconfig.json' with { type: 'json' }
import { fileURLToPath, URL } from 'node:url'
import { globSync } from 'node:fs'
import { playwright } from '@vitest/browser-playwright'

export function resolveWorkspacePath(relativePath: string): string {
	return fileURLToPath(new URL(relativePath, import.meta.url))
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

// Extends srcCore: browser-only library (`src/browser`, <describe THIS package's
// browser surface in one line>). Builds an ES lib and runs its tests in a real
// Chromium via Playwright, where DOM and browser-only APIs are available.
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
					// Declared `@orkestrel/*` deps are externalized too, never bundled.
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

// Extends srcCore: server-only library (`src/server`, <describe THIS package's
// server surface in one line>). Builds a dual ESM+CJS lib for Node and runs its
// tests in the node environment. Externalizes `node:*` AND declared
// `@orkestrel/*` deps AND `@src/core` → the sibling `dist/src/core` build
// (format-aware: `../core/index.js` for the ESM output, `../core/index.cjs`
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
							id === '@src/core' || id.startsWith('node:') || id.startsWith('@orkestrel/'),
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
```

### 6.1 Trimming to your variant

- **core + server** (`server`, `middleware`): delete `srcBrowser`, the
  `globSync`/`playwright` imports and `createBrowserProvider` may remain or go with it
  (the exemplars keep `createBrowserProvider` only when a browser surface exists —
  `server` at HEAD retains it harmlessly; prefer dropping it in new repos), `projects:
[srcCore, srcServer, guides]`.
- **core-only** (`abort`): only `resolveWorkspacePath`, `resolve`, `srcCore`, `guides`;
  no playwright imports at all; `projects: [srcCore, guides]`.
- **single-variant** (`sqlite`, `indexeddb`): the **variant factory IS the base** — there
  is no `srcCore`. `sqlite` exports `srcServer` carrying the resolve + build defaults +
  its own lib/test config directly, and `guides` extends `srcServer`; `indexeddb`
  likewise collapses onto `srcBrowser` (its `guides` overrides `environment: 'node'`,
  `browser: { enabled: false }`). `projects: [src<Variant>, guides]`.
- The surface doc comments (`<describe THIS package's …>`) must describe **your**
  package's actual surfaces — never leave another package's description in place.

### 6.2 Vitest projects at a glance

| Project       | Color   | Env                                                            | include                | setupFiles                    |
| ------------- | ------- | -------------------------------------------------------------- | ---------------------- | ----------------------------- |
| `src:core`    | magenta | node                                                           | `tests/src/core/**`    | `setup.ts`                    |
| `src:browser` | yellow  | real Chromium (Playwright, headless, `fileParallelism: false`) | `tests/src/browser/**` | `setup.ts`, `setupBrowser.ts` |
| `src:server`  | red     | node                                                           | `tests/src/server/**`  | `setup.ts`, `setupServer.ts`  |
| `guides`      | green   | node                                                           | `tests/guides/**`      | `setup.ts` (inherited)        |

`include` globs concatenate through `mergeConfig` — child projects re-`exclude` the
parent's globs. Preserve that idiom when extending.

---

## 7. `configs/src/` — per-surface wrappers

Thin wrappers only; all shared logic lives in the root configs. Each surface has exactly
two files. **Byte-identical across repos per variant** — copy from the exemplar.

**`vite.core.config.ts`** — the core build: dual-format lib + inline bundled types +
dependency externalization:

```ts
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcCore, resolveWorkspacePath } from '../../vite.config'

export default defineConfig(
	srcCore({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.core.json'),
				bundleTypes: true,
			}),
		],
		build: {
			lib: {
				entry: resolveWorkspacePath('src/core/index.ts'),
				formats: ['es', 'cjs'],
				fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
			},
			outDir: 'dist/src/core',
			rollupOptions: {
				external: [/^node:/, /^@orkestrel\//],
			},
		},
	}),
)
```

**`vite.browser.config.ts`** / **`vite.server.config.ts`** — pass-throughs plus the same
inline dts plugin (the lib/externals live in the root factory):

```ts
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcBrowser, resolveWorkspacePath } from '../../vite.config'

// The published `@src/browser` library build — a thin wrapper around the shared
// `srcBrowser` config in the root vite.config.ts, which already externalizes
// `@src/core` to the sibling `dist/src/core` build. Types are bundled inline by
// vite-plugin-dts (see configs/src/vite.core.config.ts for the same pattern).
export default defineConfig(
	srcBrowser({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.browser.json'),
				bundleTypes: true,
			}),
		],
	}),
)
```

```ts
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcServer, resolveWorkspacePath } from '../../vite.config'

// Types are bundled inline by vite-plugin-dts (see configs/src/vite.core.config.ts
// for the same pattern).
export default defineConfig(
	srcServer({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.server.json'),
				bundleTypes: true,
			}),
		],
	}),
)
```

The tsconfigs — used by the dts plugin (`tsconfigPath`) **and** by `check:src:<v>`
(`tsc --noEmit -p …`), enforcing each surface's environment contract:

**`tsconfig.core.json`** (pure ECMAScript — no DOM, no Node types):

```json
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"lib": ["ESNext"],
		"noEmit": false,
		"declaration": true,
		"emitDeclarationOnly": true,
		"rootDir": "../../src/core",
		"outDir": "../../dist/src/core"
	},
	"include": ["../../src/core/**/*.ts"]
}
```

**`tsconfig.browser.json`** (DOM, no Node):

```json
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"lib": ["ESNext", "DOM", "DOM.Iterable"],
		"types": ["vite/client"],
		"noEmit": false,
		"declaration": true,
		"emitDeclarationOnly": true,
		"rootDir": "../../src",
		"outDir": "../../dist/src"
	},
	"include": ["../../src/browser/**/*.ts"]
}
```

**`tsconfig.server.json`** (Node, no DOM):

```json
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"lib": ["ESNext"],
		"types": ["node"],
		"noEmit": false,
		"declaration": true,
		"emitDeclarationOnly": true,
		"rootDir": "../../src",
		"outDir": "../../dist/src"
	},
	"include": ["../../src/server/**/*.ts"]
}
```

> **The `rootDir` trick.** Core uses `rootDir: ../../src/core`; browser/server use the
> broader `rootDir: ../../src` with a scoped `include` so their type-check can see
> `@src/core` source. The dts plugin's `bundleTypes` collapses everything into one
> `index.d.ts` per surface either way.

> **Build order matters:** `build:src` runs **core first** (`core && browser && server`)
> so sibling references resolve against a fresh core build.

> **Banned:** `dts.*.mjs` post-processing scripts, `tsc` emit steps in `build:src:*`,
> `rollup`/`rollup-plugin-dts` devDependencies. The inline plugin replaced all of it.

---

## 8. Dotfiles (byte-identical everywhere)

The files below are byte-identical across every repo — when scaffolding or fixing,
`cp` them from a sibling (fences cannot preserve exact end-of-file bytes, so the sibling
copy, not this rendering, is the byte-canonical source).

**`.editorconfig`**

```ini
root = true

[*]
end_of_line = lf
charset = utf-8
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = tab
indent_size = 4

[*.{json,jsonc,yaml,yml}]
indent_style = tab
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

**`.gitattributes`**

```gitattributes
# Enforce LF line endings everywhere — prevents CRLF/LF churn on Windows
* text=auto eol=lf
```

**`.gitignore`**

```gitignore
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
tmp
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Environment variables (keep secret)
.env
.env.*
!.env.example

# Test screenshots (generated by vitest browser mode)
tests/**/__screenshots__/

# Playwright
test-results/
playwright-report/

# Model files
*.gguf
```

**`.oxfmtrc.json`**

```json
{
	"$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxfmt/configuration_schema.json",
	"endOfLine": "lf",
	"semi": false,
	"singleQuote": true,
	"trailingComma": "all",
	"printWidth": 100,
	"useTabs": true,
	"tabWidth": 2,
	"overrides": [
		{
			"files": ["*.json", "*.jsonc"],
			"options": {
				"trailingComma": "none"
			}
		}
	]
}
```

**`.oxlintrc.json`**

```json
{
	"$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
	"plugins": ["import", "vitest"],
	"rules": {
		"@typescript-eslint/no-explicit-any": "error",
		"@typescript-eslint/no-non-null-assertion": "error",
		"@typescript-eslint/no-unused-vars": [
			"error",
			{
				"argsIgnorePattern": "^_",
				"varsIgnorePattern": "^_",
				"caughtErrorsIgnorePattern": "^_",
				"ignoreRestSiblings": true
			}
		],
		"@typescript-eslint/consistent-type-imports": [
			"error",
			{
				"prefer": "type-imports",
				"fixStyle": "separate-type-imports"
			}
		],

		"import/no-default-export": "error",
		"import/extensions": "off",
		"import/no-unassigned-import": ["error", { "allow": ["**/*.css", "**/*.scss"] }],

		"no-var": "error",
		"prefer-const": "error",
		"no-debugger": "error",
		"no-underscore-dangle": "warn",

		"vitest/warn-todo": "off"
	},
	"categories": {
		"correctness": "error",
		"suspicious": "warn",
		"pedantic": "off",
		"perf": "off",
		"style": "off",
		"restriction": "off"
	},
	"overrides": [
		{
			"files": ["*.config.ts", "*.config.js"],
			"rules": {
				"import/no-default-export": "off"
			}
		},
		{
			"files": ["*.vue"],
			"rules": {
				"import/no-default-export": "off",
				"no-unused-expressions": "off"
			}
		}
	]
}
```

**`.oxlintignore`**

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
*.tsbuildinfo

# Cache
.cache/
.eslintcache

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
```

**`.prettierignore`**

```gitignore
# oxfmt (and prettier) read this file by default. Keep generated / minified
# artifacts out of the formatter so a tree-wide `npm run format` never rewrites them.

# Build output (also gitignored, listed for explicitness).
dist/
```

---

## 9. Tests

```
tests/
├── setup.ts            ← environment-agnostic helpers; loaded by every project
├── setupBrowser.ts     ← browser-surface repos only: DOM fixtures/teardown
├── setupServer.ts      ← server-surface repos only: node:* helpers
├── src/<v>/<Name>.test.ts   ← mirrors src/ 1:1 (one test file per behavioral source file)
└── guides/src/parity.test.ts
```

- **Recorder, not mock** (AGENTS §16.1): `tests/setup.ts` exports `createRecorder` — a
  real callback that records invocations — plus whatever fixtures the package's tests
  share. Test files hold scenarios and assertions only.
- Setup files exist **only for the surfaces the package has**.
- Tests import the unit under test via its alias (`@src/core`, `@src/browser`,
  `@src/server`) and helpers via relative `../setup.js`. A symbol that originates in a
  dependency is imported **from that dependency** in tests too (`isRecord` from
  `@orkestrel/contract`, never from `@src/core`).
- `*.test.ts` only; don't test barrels/types/constants; deterministic, no real network.

---

## 10. Guides

Every repo documents itself under `guides/`, gated by the parity suite:

```
guides/
├── README.md           ← the manifest: By concept / By directory / Dependency reference / See also
└── src/
    ├── <name>.md       ← this package's own guide (singular name, `# <Name>` title)
    ├── guide.md        ← byte-identical mirror of @orkestrel/guide's guide (the parity tooling)
    └── <dep>.md        ← byte-identical mirror per @orkestrel dependency (and peer)
```

Rules:

- `guides/src/` contains **exactly**: the package's own guide + one mirror per
  `@orkestrel/*` entry in `dependencies` **and** `peerDependencies` + `guide.md`.
- Every mirror is **byte-identical** to `<dep repo>/guides/src/<dep>.md` at HEAD. Re-sync
  when a dependency's guide changes (a stale mirror is an audit finding).
- `guides/README.md` names exactly the package's dependencies in its Dependency-reference
  section — no more, no less. Model it on a sibling's.
- **`tests/guides/src/parity.test.ts`**: copy from a sibling; the only line that changes
  is `SELF_SPECIFIERS` — `['@orkestrel/<name>', '@src/<v>']` for single-surface,
  `['@orkestrel/<name>', '@src/core', '@src/browser', '@src/server']` (plus the
  `SPECIFIER_MODULES` map — copy a multi-surface sibling's) for multi-surface. The suite
  gates: manifest structure, doc↔source export bijection per surface, per-method example
  fences, fence imports resolve to real exports, and every relative link resolves.

---

## 11. CI — `.github/workflows/ci.yml` (byte-identical everywhere)

```yaml
name: ci.yml

on:
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: read

    steps:
      - name: Checkout code
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Format check
        run: npm run format:check

      - name: Lint check
        run: npm run lint:check

      - name: Typecheck
        run: npm run check

      - name: Typecheck scoped sources
        run: npm run check:src

      - name: Build
        run: npm run build

      - name: Install Playwright browser
        run: npx playwright install --with-deps chromium

      - name: Run tests
        run: npm test
```

---

## 12. The quality gates

Run in this order; all green before any commit:

```bash
npm run format:check   # oxfmt --check (run `npm run format` to fix)
npm run lint:check     # oxlint, no --fix (run `npm run lint` to fix)
npm run check          # tsc --noEmit over the root tsconfig (whole tree incl. tests/configs)
npm run check:src      # per-surface environment-contract typecheck (core: no DOM/Node; browser: no Node; server: no DOM)
npm run build          # clean → build:src (core first) — vite + inline bundled types
npm test               # test:src (all surfaces, --no-cache) && test:guides (parity)
```

`prepublishOnly` chains exactly these six. While iterating, scope with the per-surface
scripts (`test:src:core`, `check:src:browser`, …).

---

## 13. Recipes

### 13.1 New package from scratch

1. Pick the variant combination; pick the exemplar repo (§1.2).
2. Byte-copy the invariants from the exemplar at HEAD: dotfiles (§8), `ci.yml`,
   `AGENTS.md`, `CLAUDE.md`, `.claude/`, `LICENSE`, `configs/src/*` for your surfaces,
   `tsconfig.json` (trim `paths`), `vite.config.ts` (trim factories, fix surface doc
   comments), `tests/guides/src/parity.test.ts` (edit `SELF_SPECIFIERS`).
3. `package.json`: copy the exemplar's; edit identity fields, `dependencies`, and the
   §4.2 entry-field rules for your variant class (multi-surface ⇒ **no** top-level
   `types`). Add `@vitest/browser-playwright` only with a browser surface.
4. Write `src/<v>/` per AGENTS.md (barrel + centralized files), `tests/setup.ts` (+
   per-surface setups), mirrored tests.
5. Guides: own guide + dependency mirrors + `guides/README.md` (§10).
6. `README.md` modeled on a sibling.
7. `npm install` (commits the lockfile), then the §12 gates until green.

### 13.2 Add an environment surface to an existing package

1. **Alias first**: add `@src/<v>` to `tsconfig.json` `paths`.
2. `vite.config.ts`: add the `src<V>` factory (copy from the exemplar), register it in
   `projects`.
3. `configs/src/`: add `tsconfig.<v>.json` + `vite.<v>.config.ts` (byte-copy §7).
4. `package.json`: add the `./​<v>` exports entry (§4.3 shape), the `check:src:<v>` /
   `build:src:<v>` / `test:src:<v>` scripts, wire the aggregates (core stays first in
   `build:src`). **If this is the package's second surface, DELETE the top-level
   `types` field** (§4.2). Add `@vitest/browser-playwright` if the new surface is
   browser.
5. `src/<v>/index.ts` barrel + source; `tests/src/<v>/` + `tests/setup<V>.ts`.
6. Guides: the own guide's Surface must now document the union of all surfaces' exports;
   parity's `SELF_SPECIFIERS` gains `@src/<v>` (copy a multi-surface sibling's
   `SPECIFIER_MODULES` idiom).
7. Gates green (§12).

### 13.3 Audit / fix an existing package (the consistency checklist)

- [ ] Uniform fields exactly as §4.1; identity fields point at this repo.
- [ ] Entry fields match the §4.2 table — multi-surface repos have **no** top-level
      `types`.
- [ ] Exports map matches the §4.3 shape for the variant class; every path it names is
      produced by the build.
- [ ] Scripts match §4 (canonical `prepublishOnly`; `--no-cache` on `test:src*`;
      per-surface families complete; core-first `build:src`; d.cts copy on dual-format
      surfaces only; no `tsc` in build steps).
- [ ] Dependencies: everything `src/` imports is declared; nothing declared is unused;
      devDeps match §2 (browser-playwright iff browser surface); no
      `rollup`/`rollup-plugin-dts`.
- [ ] `configs/src/` files byte-identical to the exemplar's; no `dts.*.mjs` anywhere.
- [ ] Root `vite.config.ts` factories match the exemplar shape: externals include
      `@orkestrel/*`; server target `node24`; format-aware `@src/core` remaps; surface
      doc comments describe **this** package.
- [ ] Dotfiles + `ci.yml` + `AGENTS.md` + `CLAUDE.md` + `.claude/` + `LICENSE`
      byte-identical to siblings.
- [ ] Guides: own guide singular-named and title-cased `# <Name>`; mirrors byte-identical
      to their source repos; `guides/README.md` dependency list exact; parity suite
      passes.
- [ ] Tests: setup files only for surfaces present; no foreign-domain fixtures; imports
      point at originating packages.
- [ ] `git status` clean of artifacts; lockfile committed; §12 gates all green.

---

## 14. Appendix — the invariant fingerprint

For a quick drift scan across the fleet, these must hold in every repo:

| Invariant                                                     | Value                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `engines.node`                                                | `>=24`                                                             |
| `type` / `sideEffects` / `files`                              | `module` / `false` / `["dist","README.md"]`                        |
| `publishConfig.access`                                        | `public`                                                           |
| typescript / vite / vitest / vite-plugin-dts / oxfmt / oxlint | `^6.0.3` / `^8.1.4` / `^4.1.10` / `^5.0.3` / `^0.58.0` / `^1.73.0` |
| `@microsoft/api-extractor` / `@types/node`                    | `^7.58.9` / `^26.1.1`                                              |
| server build target                                           | `node24`                                                           |
| declaration pipeline                                          | inline `vite-plugin-dts` `bundleTypes` + d.cts copy on dual-format |
| externals in every library build                              | `node:*`, `@orkestrel/*` (+ `@src/core` on subpath surfaces)       |
| gate order                                                    | format:check → lint:check → check → check:src → build → test       |
