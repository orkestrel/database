---
paths:
  - 'app/**/*'
  - 'tests/app/**/*'
  - 'configs/app/**/*'
  - 'package.json'
  - 'tsconfig.json'
  - 'vite.config.ts'
  - '.oxlintrc.json'
---

# Application composition

- Select only needed app environments; app-only, src-only, and mixed workspaces
  are first-class.
- The CLI names the independent selections `--src` and `--app`.
  `--surfaces` is not an alias and must fail as an unknown option.
- Core-only, browser-only, and server-only applications are valid. A combined
  browser+server application includes app/core for shared contracts.
- Every selected environment has an `index.ts` barrel. `main.ts` is an executable
  entry and never owns reusable declarations.
- app/core is host-independent and check/test-only.
- app/browser uses app/core contracts, Vue 3 when selected, an `index.html`
  entry, `vue-tsc`, and real Chromium tests.
- app/server uses app/core contracts, parses environment values before binding,
  defaults to loopback, emits `dist/app/server/main.cjs`, and keeps only
  `node:*` external.
- Browser/server integration crosses a contract/transport boundary. Neither
  environment imports the other's implementation. `.oxlintrc.json`
  `no-restricted-imports` enforces declared package, alias, and conventional
  relative import direction. Scoped TypeScript configurations remove Node/DOM
  globals from the wrong environment. Vite's actual browser and server builds
  resolve Vue, assets, CSS, workers, and runtime module graphs. Generated
  consumers must pass lint, scoped typechecking, production builds, and real
  integration tests. Do not introduce a custom parser or source-language
  analyzer to duplicate the project toolchain.
- Scoped checks include `.ts`, `.tsx`, `.mts`, and `.cts`. Vue SFCs and CSS
  belong to browser environments; SCSS requires an authorized compiler dependency.
- Published `src` environments never import private `app` modules. Src core is
  host-independent; src browser/server may import src core but never one
  another's implementation. Apply the same environment law to
  `@orkestrel/<package>/browser` and `/server` exports.
- App-only manifests are unscoped and `private: true`, with no package export
  map or publish configuration. Mixed manifests publish only `dist/src`, and
  Vue remains development-only because app output is never published.
- app/server process signals belong to a tested, explicitly stoppable,
  generation-safe runner whose stale failures cannot release a newer run;
  convenience startup returns the runner so normal cleanup cannot be hidden.
  `ApplicationServerRunner` lives alone in `ApplicationServerRunner.ts`, and the
  `startApplicationServer` convenience factory belongs in `factories.ts`.
  `main.ts` invokes it and owns no reusable declarations or duplicated signal
  handling.
- Do not add showcase, auth, storage, proxy, CSS framework, or other product
  policy unless the request requires it.
- Test repeated lifecycle, concurrent calls, malformed environment input,
  protocol rejection, abort/cleanup where applicable, and cross-environment
  contract parity using real hosts.
