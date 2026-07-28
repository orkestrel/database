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

Use only the environments a project needs, but preserve this dependency model.

## Environments

| Path           | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `src/core/`    | Published host-independent library                 |
| `src/browser/` | Published browser-only library                     |
| `src/server/`  | Published Node-only library                        |
| `src/styles/`  | Optional SCSS bundle producing `index.css`         |
| `src/bin/`     | Optional executable entry; never a public barrel   |
| `app/core/`    | Shared application logic with an `index.ts` barrel |
| `app/browser/` | Browser app; `main.ts` entry, not a barrel         |
| `app/server/`  | Node server app; `main.ts` entry                   |
| `tests/`       | Mirrors src/app environments                       |
| `configs/`     | Thin target wrappers around root configs           |

- Browser/server import core; core imports neither.
- `app/core` is host-independent.
- `app/server` may import app/core and core/server libraries; it never imports browser code.
- `app/browser` may import app/core and core/browser libraries. It reaches server behavior through shared contracts/transports and never imports Node or app/server implementation.
- Typical browser-app domains: `components/`, `pages/`, `composables.ts`, `controllers/`, `services/`, `stores/`.
- Typical server-app domains: `handlers/`, `middlewares.ts`, `routes.ts`.
- `src/styles/index.ts` is a side-effect entry importing `./index.scss`.

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
| `dist/bin`         | Optional executable            | ES with shebang |
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

`vite.config.ts` defines one Vitest project per src/app axis × environment:

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

Setup assets:

- `tests/setup.css` declares cascade-layer order before `@import 'tailwindcss'` and its `@source`.
- Browser setup wires `setup.css`.
- Styles setup loads `setup.css` and the compiled cascade.

Scope with `test:src`, `test:src:core`, `test:app`, `test:app:server`, and equivalent scripts.

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

Strict core is load-bearing. A host-dependent helper belongs in its host environment; for example, a `generateId` reading `node:crypto` belongs in server, not core. The worker-only globals — `name`, `onrtctransform`, `close`, `postMessage`, `dispatchEvent`, `location`, `onerror`, `onlanguagechange`, `onoffline`, `ononline`, `onrejectionhandled`, `onunhandledrejection`, `self`, `importScripts`, `fonts`, `caches`, `crossOriginIsolated`, `indexedDB`, `isSecureContext`, `origin`, `scheduler`, `createImageBitmap`, `reportError`, `cancelAnimationFrame`, `requestAnimationFrame`, `onmessage`, `onmessageerror`, `addEventListener`, and `removeEventListener` — are policy-fenced out of core sources, so the `WebWorker` declarations widen the interop surface without admitting a worker host.

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
| `test`                  | Source/application projects, then guide parity                    |
| `clean`                 | Remove `dist/`                                                    |
| `copy <from> <to>`      | Copy while creating parent directories                            |
| `prepublishOnly`        | `format:check → lint:check → check → build → test`                |

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
