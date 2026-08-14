---
paths:
  - 'src/**/*'
  - 'app/**/*'
  - 'tests/**/*'
  - 'configs/**/*'
  - 'demo/**/*'
  - 'package.json'
  - 'tsconfig.json'
  - 'vite.config.ts'
---

# Workspace, environments, builds, and scripts

Use only the environments a project needs, and keep the root dependency model intact while doing it.

## Environments

| Path           | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `src/core/`    | Published host-independent library                            |
| `src/browser/` | Published browser-only library                                |
| `src/server/`  | Published Node-only library                                   |
| `src/styles/`  | Optional SCSS bundle producing `index.css`                    |
| `src/bin/`     | Optional executable; `main.ts` entry, never a public barrel   |
| `app/core/`    | Shared application logic with an `index.ts` barrel            |
| `app/browser/` | Browser app; `main.ts` entry, not a barrel                    |
| `app/server/`  | Node server app; `main.ts` entry                              |
| `tests/`       | Mirrors src/app environments; root holds cross-cutting proofs |
| `configs/`     | Thin target wrappers around root configs                      |

- Dependency direction is the root project model in `AGENTS.md` and is not restated here; this file governs where the environments live and how they are configured.
- Typical browser-app domains: `components/`, `pages/`, `composables/`, `controllers/`, `services/`, `stores/`.
- Typical server-app domains: `handlers.ts`, `middlewares.ts`, `routes.ts`.
- `src/styles/index.ts` is a side-effect entry importing `./index.scss`.
- `src/bin/main.ts` is the executable entry, built to `dist/bin/main.js`. The name is fixed, as it
  is for `app/browser/main.ts` and `app/server/main.ts`, so every runtime entry in a workspace is
  found at the same name.
- `package.json`'s `bin` key is the installed command name. The entry path is the value and does
  not carry that name.

## Aliases

| Alias          | Target                 |
| -------------- | ---------------------- |
| `@src/core`    | `src/core/index.ts`    |
| `@src/browser` | `src/browser/index.ts` |
| `@src/server`  | `src/server/index.ts`  |
| `@src/styles`  | `src/styles/index.ts`  |
| `@app/core`    | `app/core/index.ts`    |
| `@app/browser` | `app/browser/index.ts` |
| `@app/server`  | `app/server/index.ts`  |

Define aliases in `tsconfig.json` first. `vite.config.ts` derives from `compilerOptions.paths`; keep both aligned.

## Configuration authority

- `tsconfig.json`: shared compiler options, all-tree types, and path aliases.
- `vite.config.ts`: shared builds, test projects, environment loading/mapping, and aliases.
- `*/types.ts`: public API contracts.
- `configs/src/` and `configs/app/`: thin per-target wrappers, including optional
  `configs/src/*bin*` files. Shared logic remains in root configs.
- `configs/helpers.ts` and `configs/browsers.ts`: the only permitted leaves under `configs/`. Each
  imports nothing from the workspace, which is what keeps it a leaf. Each `configs/src/*.config.ts`
  imports the root config rather than a leaf, so shared build logic stays in one place.
- Keep `configs/helpers.ts` free of any dependency a core-only workspace does not declare. It is
  vendored byte-identical to every workspace, so an import there must resolve in all of them.
  `configs/browsers.ts` exists for that reason: it imports `playwright` and
  `@vitest/browser-playwright`, and only a workspace with a browser environment is given it.

Environment rules:

- `vite.config.ts` owns environment loading/mapping.
- Add shared variables there first.
- Prefer a minimal plain set such as `APP_NAME`, `APP_API_PATH`, `APP_HOST`, `APP_PORT`.
- Expose extra browser runtime values only for a concrete need.

## Build outputs

| Output             | Content                        | Format          |
| ------------------ | ------------------------------ | --------------- |
| `dist/src/core`    | Core library + declarations    | ES and CJS      |
| `dist/src/browser` | Browser library + declarations | ES              |
| `dist/src/server`  | Server library + declarations  | ES and CJS      |
| `dist/src/styles`  | Compiled `index.css`           | ES wrapper      |
| `dist/bin`         | Optional executable `main.js`  | ES with shebang |
| `dist/app/browser` | Browser application            | target-defined  |
| `dist/app/server`  | Server application             | CJS             |
| `dist/showcase`    | Single-file `index.html` demo  | self-contained  |

- Library declarations are emitted by `tsc` through `configs/src/tsconfig.{core,browser,server}.json`, chained after each Vite build.
- Styles ship CSS, not declarations.
- Optional `appShowcase` uses `configs/app/vite.showcase.config.ts` and `vite-plugin-singlefile` to create a minified file-URL-safe `dist/showcase/index.html`.
- The showcase is outside the default build.
- Use Oxc for showcase JS minification and Lightning CSS for CSS.
- Inject a `build-id` meta stamp so rebuilt `file://` demos cache-bust.

## Test project matrix

`vite.config.ts` defines Vitest projects on two axes. The first is one project per src/app axis ×
environment:

| Project       | Files                  | Environment         | Setup                                           |
| ------------- | ---------------------- | ------------------- | ----------------------------------------------- |
| `src:core`    | `tests/src/core/**`    | Node                | `setup.ts`                                      |
| `src:browser` | `tests/src/browser/**` | Playwright Chromium | `setup.ts`, `setupBrowser.ts`                   |
| `src:server`  | `tests/src/server/**`  | Node                | `setup.ts`, `setupServer.ts`                    |
| `src:styles`  | `tests/src/styles/**`  | Playwright Chromium | `setup.ts`, `setupBrowser.ts`, `setupStyles.ts` |
| `src:bin`     | `tests/src/bin/**`     | Node                | `setup.ts`, `setupServer.ts`                    |
| `app:core`    | `tests/app/core/**`    | Node                | `setup.ts`                                      |
| `app:browser` | `tests/app/browser/**` | Playwright Chromium | `setup.ts`, `setupBrowser.ts`                   |
| `app:server`  | `tests/app/server/**`  | Node                | `setup.ts`, `setupServer.ts`                    |

The second axis is cross-cutting workspace proofs. Each one covers the whole workspace rather than
one environment, so each is its own project:

| Project        | Files                        | Proves                                                              | Gate                                  |
| -------------- | ---------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `policy`       | `tests/policy.test.ts`       | Every source file obeys the syntactic coding and placement law      | `test`                                |
| `config`       | `tests/config.test.ts`       | Root configuration resolves its aliases, projects, and outputs      | `test`                                |
| `guides`       | `tests/guides.test.ts`       | Every documented API exists and every public API is documented      | `test`                                |
| `conformance`  | `tests/conformance.test.ts`  | Where this package drifts from the official tooling it tracks       | `test`                                |
| `distribution` | `tests/distribution.test.ts` | The packed package installs and resolves through its public exports | `prepublishOnly`; absent when private |
| `integration`  | `tests/integration.test.ts`  | The package's features work together end to end across environments | `test`                                |
| `service`      | `tests/service/**/*.test.ts` | The live external services this package drives, driven for real     | `prepublishOnly`; `test` when private |

`conformance`, `integration`, `distribution`, and `service` are four subjects, not four names for
one.
Keep `conformance` in `test`: measure this package against an installed official artifact, and start
any server the proof drives itself. Keep `integration` in `test`: compose the workspace's public
surfaces without packing, installing, or driving an external service. In a publishing workspace,
run `distribution` and `service` from `prepublishOnly`: pack and install the package in
`distribution`, and drive the real service with `tests/setupService.ts`, longer timeouts, and no file
parallelism in `service`. In a `private: true` workspace, never declare `prepublishOnly`; omit
`distribution`, reach `service` from `test`, and retain the service project's isolated
configuration.

One project sits on neither axis. `probe` includes `tmp/probe/**/*.test.ts` so an agent can run a
throwaway instrument against real sources, aliases and setup. Declare no proof there. Every test
script names its project, so no gate runs it; its directory is ignored by git; and
`.claude/rules/tests.md` governs what may live there.

- Define a cross-cutting project only for a proof the package actually has.
- A live-service project is the fifth kind. It is the `service` project above, `scripts/service.sh`
  provisions what it drives, and `.claude/rules/tests.md` governs it. Name it `service` whatever it
  drives.
- In a publishing workspace, a project leaves the default run when it drives a live external
  service or is hermetic but slow — it spawns processes, packs, installs, or drives a real build.
- Give every isolated project its own script, and place that script by the paragraph above.

Setup assets:

- `tests/setup.css` declares cascade-layer order before `@import 'tailwindcss'` and its `@source`.
- Browser setup wires `setup.css`.
- Styles setup loads `setup.css` and the compiled cascade.

Scope with `test:src`, `test:src:core`, `test:app`, `test:app:server`, and equivalent scripts. Each
cross-cutting project has its own script too: `test:policy`, `test:config`, `test:guides`,
`test:conformance`, `test:distribution`, `test:integration`, `test:service`.

## Typechecking and environment isolation

`npm run check` is the comprehensive contract. It typechecks the whole tree and
then runs the configured scoped checks that prove environment isolation.

- Use plain `tsc` for a TypeScript-only tree.
- Use `vue-tsc` only for a scope containing `.vue` internals.
- `check:src` mirrors configured `src:*` test projects; optional `src:bin` is its
  own scope.
- `check:app` mirrors configured `app:*` projects.
- During development, run the narrowest granular scope that covers the change.
- Lint is a separate complementary gate; neither lint nor root checking replaces
  environment-isolation checks.

| Scope                        | `lib`                             | `types`           | Permitted host globals                                                                                                                   |
| ---------------------------- | --------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src:core`, `app:core`       | `["ESNext","WebWorker"]`          | `[]`              | WHATWG web interop: fetch family, streams, URL, Abort, encoders, crypto, timers, console, DOMException, structuredClone; no DOM, no Node |
| `src:browser`, `app:browser` | `["ESNext","DOM","DOM.Iterable"]` | default           | DOM; no Node                                                                                                                             |
| `src:server`, `app:server`   | `["ESNext"]`                      | `["node"]`        | Node; no DOM                                                                                                                             |
| `src:styles`                 | `["ESNext"]`                      | `["vite/client"]` | Vite SCSS module declaration only                                                                                                        |

Strict core is load-bearing:

- Put a host-dependent helper in its host environment. A `generateId` reading `node:crypto` belongs in server, not core.
- Core declares `WebWorker` to widen the WHATWG interop surface, not to admit a worker host. Policy fences these worker-only globals out of core sources: `name`, `onrtctransform`, `close`, `postMessage`, `dispatchEvent`, `location`, `onerror`, `onlanguagechange`, `onoffline`, `ononline`, `onrejectionhandled`, `onunhandledrejection`, `self`, `importScripts`, `fonts`, `caches`, `crossOriginIsolated`, `indexedDB`, `isSecureContext`, `origin`, `scheduler`, `createImageBitmap`, `reportError`, `cancelAnimationFrame`, `requestAnimationFrame`, `onmessage`, `onmessageerror`, `addEventListener`, `removeEventListener`.

Build/check config alignment:

- `configs/src/tsconfig.{core,browser,server}.json` serves emit and scoped checking.
- `configs/src/tsconfig.styles.json` is check-only.
- `configs/app/tsconfig.core.json` is check-only.
- `configs/app/tsconfig.{browser,server}.json` is check-only.
- Root `tsconfig.json` keeps all libs/types for IDE and comprehensive checking; scoped configs tighten each environment.

## Script intent

| Script                  | Contract                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `dev`                   | Browser development entry                                         |
| `build`                 | Build configured library/application targets                      |
| `serve` / `serve:build` | Run built server / build then run                                 |
| `showcase`              | Showcase dev server                                               |
| `build:showcase`        | Build `dist/showcase`                                             |
| `show`                  | Build and copy showcase to `demo/showcase.html`                   |
| `lint`                  | `oxlint --config .oxlintrc.json --fix .`; separate from typecheck |
| `lint:check`            | Non-mutating whole-tree lint gate                                 |
| `check`                 | Comprehensive root typecheck plus configured isolation scopes     |
| `check:<scope>`         | On-demand environment-isolation pass                              |
| `format`                | Format all files                                                  |
| `format:check`          | Non-mutating whole-tree format gate                               |
| `test`                  | Environment projects plus non-isolated cross-cutting proofs       |
| `clean`                 | Remove `dist/`                                                    |
| `copy <from> <to>`      | Copy while creating parent directories                            |
| `prepublishOnly`        | Publishing workspaces only: the gate chain, then isolated proofs  |

Run `show` only **after** formatting. The committed `demo/showcase.html` is generated/minified; formatting after generation would expand its inlined bundle.

## Tooling

- Typechecker: `vue-tsc` only where Vue SFCs are checked; `tsc` elsewhere.
- Linter: Oxlint with `.oxlintrc.json`, independent from typechecking.
- Formatter: Oxfmt with `.oxfmtrc.json`.
- Bundler: Vite.
- Tests: Vitest; `@vitest/browser-playwright` for browser projects.
- Node build targets derive from the package's declared supported runtime. Keep `engines`, bundler targets, scoped configs, tests, and documentation aligned; never hard-code one Node version line-wide.
- Browser framework: Vue 3 when present.

## Text integrity

- Store text as UTF-8.
- Before accepting broad generated or migrated edits, scan changed text for replacement characters, mojibake, unintended control characters, and accidental trailing debris.
- Preserve intentional Unicode punctuation and symbols; do not “clean” valid text merely because it is non-ASCII.
- Never renormalize Unicode while rewriting a file. Retyping a line can silently fold a decomposed sequence into its precomposed form — `e` + U+0301 becoming U+00E9 — and the two render identically, so the diff reads as a no-op and review sees nothing. Where the exact code points are the subject, as in an encoding or transport proof, that fold deletes the case the test exists for while leaving it green and named. Move such a line rather than retyping it, and compare bytes with `od -c` or a code-point dump rather than by eye.
