# Application architecture reference

## Environment selection

Support application-only, source-only, and mixed workspaces.
The CLI uses `--src core,browser,server` for published src environments and
`--app core,browser,server` for private app environments. At least one selector
is required in non-interactive creation; `--surfaces` is not part of the
vocabulary.

| Selection   | Contract                                               |
| ----------- | ------------------------------------------------------ |
| app/core    | Host-independent contracts and composition             |
| app/browser | Vue browser runtime and real-browser tests             |
| app/server  | Node runtime, executable CJS build, and loopback tests |

Core-only, browser-only, and server-only are valid. A browser+server pair must
include app/core so shared transport contracts have one host-independent owner.

## Dependency direction

- app/core imports no DOM, Node, app/browser, or app/server implementation.
- app/browser may import app/core and published browser/core packages.
- app/server may import app/core and published server/core packages.
- Published src environments never import private app modules. Src core is
  host-independent; src browser/server may import src core and remain
  mutually disjoint.
- Apply the same direction to cross-package `@orkestrel/<package>/browser` and
  `/server` exports; a package's bare export is its core API.
- Browser code reaches server behavior through app/core contracts and a
  transport boundary, never by importing app/server.
- Every environment barrel contains `export *` declarations only. A star-export
  collision is a design failure to be renamed at its owner, never hidden behind
  a selective barrel row.
- Types, constants, helpers, validators, parsers, and factories live in their
  centralized kind files; an implementation file holds one class plus imports.
  `ApplicationServerRunner` lives alone in `ApplicationServerRunner.ts` and
  `startApplicationServer` in `factories.ts`; `main.ts` owns no reusable
  declarations.
- Enforcement is layered, and each layer owns exactly what it can express:
  - `.oxlintrc.json` `no-restricted-imports` owns **literal-string** declared
    package, alias, and conventional relative imports, in both directions.
    `.oxfmtrc.json` owns formatting. Neither replaces the other, and neither
    replaces typechecking.
  - `tests/setupPolicy.ts` owns what Oxlint cannot represent: computed and
    template-literal import specifiers, declaration placement, and the
    export-star barrel law. It is a deliberately narrow TypeScript-compiler pass
    over the repository's own coding laws — not a general-purpose analyzer, and
    not a second linter.
  - Scoped TypeScript projects remove Node/DOM globals from the wrong
    environment.
  - Vite's real browser/server builds resolve Vue, assets, CSS, workers, and
    runtime module graphs, and its generated environment-boundary plugin checks
    dependency direction and physical workspace containment on the actual graph.
    Vite's parsed HTML asset callbacks reject forced inlining before any direct
    asset read; non-inlined output assets are audited by physical source path.
  - Generated-consumer lint, typecheck, build, and integration tests prove the
    combined configuration.
- Do not add a second general-purpose parser, source-language analyzer, or
  boundary script that duplicates a layer above. Use the toolchain's own
  facilities instead: Vite's Oxc/Rolldown AST for TypeScript and JavaScript
  asset references, the official Vue SFC compiler for `.vue` blocks, Vite's
  HTML parser callbacks, its bundled Lightning CSS dependency analyzer, and the
  TypeScript compiler API for the narrow coding-law pass.
- Include `.ts`, `.tsx`, `.mts`, and `.cts` in every scoped TypeScript check.
  Vue SFCs belong only to app/browser. CSS is the generated browser style
  format; SCSS requires an explicitly authorized Sass compiler dependency.

## Entries and configuration

- Every selected app environment has an `index.ts` barrel.
- app/browser executes from `main.ts` through `index.html`.
- app/server centralizes process signals in an explicitly stoppable runner,
  returns that runner from convenience startup so cleanup is never hidden, and
  executes it from a declaration-free `main.ts`; its bundle is
  `dist/app/server/main.cjs`, with only `node:*` external.
- app/core is check/test-only.
- Root `tsconfig.json` owns `@app/*` aliases.
- Root `vite.config.ts` owns shared config and Vitest projects.
- `configs/app` contains thin target wrappers and scoped tsconfigs.
- app/browser uses `vue-tsc`; other app environments use `tsc`.

## Manifest policy

- App-only: unscoped name, `private: true`, no package `main`, `module`,
  `types`, `exports`, or public `publishConfig`.
- Mixed: normal published source entries; package files include `dist/src` and
  exclude `dist/app`.
- Add Vue only to development tooling when app/browser is selected; mixed
  publication must not expose an app-only Vue runtime dependency.
- Add no product-specific dependencies or optional showcase tooling by default.

## Boundaries and tests

- Default server host is loopback.
- Parse the options container and host/port leaves before mutation; reject
  wrong-shaped containers, empty hosts, and non-integer, negative, or
  out-of-range ports with a coded error and guard.
- Lifecycle transitions serialize in call order, ephemeral restarts re-request
  port zero, server stop closes hostile active connections deterministically,
  and runner stop idempotently releases its SIGINT/SIGTERM listeners. Runner
  generations isolate asynchronous failures so an older transition cannot
  release a newer run's listeners.
- Real child-process tests prove executable readiness, collision exit, signal
  termination, and port release. On Windows, `ChildProcess.kill('SIGTERM')`
  reports OS termination by signal; POSIX delivery exercises the runner's
  graceful signal listener and exits zero.
- Browser tests use Playwright-backed Vitest Browser Mode and real DOM. A
  browser-capability check probes the installed executable directly with
  `existsSync(chromium.executablePath())`; there is no channel or environment
  guessing.
- Server tests bind port zero on loopback and use real fetch requests.
- Capability-dependent tests probe the actual capability and scope any skip.
- The generated browser application disables the public directory so an
  unmanaged file copy cannot bypass the module graph or its boundary checks.
- Generated CI runs the gates on the declared minimum Node release and on the
  current major.
- Guide parity walks existing `src` and/or `app` roots and maps every selected
  `@src/*` / `@app/*` alias.

## Cleanup before gates

- Source: no stray or misplaced declarations, non-exported centralized
  declarations, nested function declarations, duplicate implementations,
  superfluous wrappers, compatibility aliases, or stale imports and barrel rows.
- Tests: no unused or duplicated helpers, empty setup files, placeholder suites,
  current-scope `.todo` / `.skip`, or assertions that cannot fail.
- Text: UTF-8 only; scan generated or migrated edits for replacement characters,
  mojibake, and stray control characters.
