---
name: orkestrel-build-application
description: Design, scaffold, extend, or harden Orkestrel `app/core`, `app/browser`, and `app/server` environments. Use for app-only or mixed src/app workspaces, app environment isolation, Vue browser entries, Node server entries, app aliases/configs/scripts/tests, cross-environment contracts, and application guide parity.
---

# Build an Orkestrel application

## Load authority

Read the current files in this order:

1. `AGENTS.md`.
2. `.claude/rules/application.md` for composition, entries, manifest safety, and
   lifecycle; `.claude/rules/workspace.md` for environments, aliases, configuration, and
   scripts; `.claude/rules/architecture.md` for placement and barrels;
   `.claude/rules/tests.md` for test law; `.claude/rules/documentation.md` for parity;
   plus every other rule the files in scope select.
3. `guides/README.md`, the governing application guide, and `ROADMAP.md` when present.
4. The authoritative `*/types.ts` of each selected environment, the root
   `tsconfig.json` and `vite.config.ts`, the manifest, and `configs/app`.

Those rules are the contract; this skill is only the workflow. Where a step names a law,
read the law rather than this summary of it.

## Select the environments

`--src` selects published src environments and `--app` selects private app environments.
The selections are independent, at least one is required, each offers `core`, `browser`,
and `server`, and there is no `--surfaces` synonym.

| Selection   | What it owns                                                             |
| ----------- | ------------------------------------------------------------------------ |
| app/core    | Host-independent contracts and composition; check and test only          |
| app/browser | Vue runtime behind an `index.html` entry, `vue-tsc`, real Chromium tests |
| app/server  | Node runtime, `dist/app/server/main.cjs` with only `node:*` external     |

Core-only, browser-only, and server-only applications are valid. A browser+server pair
includes app/core so the shared transport contracts have one host-independent owner.

## Execute the workflow

1. **Inventory** existing `src`, `app`, `configs`, tests, manifest scripts, aliases, and
   guide rows. Treat current code as evidence, not policy.
2. **Contract first.** Define or refine each environment's `types.ts` before
   implementation, and inspect the exact installed `@orkestrel/*` capabilities before
   writing any boundary code.
3. **Wire configuration.** Root `tsconfig.json` owns the `@app/*` aliases and root
   `vite.config.ts` derives from them and owns the Vitest projects; `configs/app` holds
   thin target wrappers and scoped tsconfigs.
4. **Implement completely** — entries, barrels, centralized declarations, one-class
   implementation files, environment parsing, lifecycle, builds, and scripts — under the
   placement and manifest laws. Parse the options container and its host and port leaves
   before mutation, rejecting wrong-shaped containers, empty hosts, and non-integer,
   negative, or out-of-range ports with a coded error and its guard.
5. **Own the shutdown contract.**
   - Serialize lifecycle transitions in call order.
   - Re-request port zero on an ephemeral restart.
   - Close hostile active connections deterministically on stop.
   - Release the runner's signal listeners idempotently on stop.
   - Isolate asynchronous failures by runner generation, so an older transition cannot
     release a newer run's listeners.
   - Return the runner from convenience startup rather than hiding that cleanup.
6. **Keep boundary enforcement inside the configured toolchain.** Each layer owns what it
   can express:
   - Oxlint `no-restricted-imports` — literal-string declared package, alias, and
     conventional relative import direction.
   - Oxfmt — formatting.
   - `tests/setupPolicy.ts` — the narrow TypeScript compiler-API pass over computed and
     template-literal specifiers, declaration placement, and the barrel law.
   - Scoped TypeScript projects — host-global isolation.
   - Vite's real builds and environment-boundary plugin — Vue, CSS, assets, workers,
     runtime resolution, and physical workspace containment. Its parsed HTML asset
     callbacks reject forced inlining before any direct asset read, and non-inlined
     output assets are audited by physical source path.

   Then hold these limits:
   - Add no standalone boundary script, and no second parser or source-language analyzer
     duplicating those layers. Reach for the toolchain's own facilities instead: Vite's
     Oxc/Rolldown AST for TypeScript and JavaScript asset references, the official Vue SFC
     compiler for `.vue` blocks, Vite's HTML parser callbacks, its bundled Lightning CSS
     dependency analyzer, and the TypeScript compiler API for the narrow coding-law pass.
   - Disable the browser application's public directory, so an unmanaged file copy cannot
     bypass the module graph.
   - Keep browser-only runtime tooling development-only.
   - Require explicit authorization before adding a Sass compiler.

7. **Prove it on real hosts.**
   - Run app/browser tests on Playwright-backed Vitest Browser Mode against real DOM.
     Probe the installed executable directly with `existsSync(chromium.executablePath())`
     rather than guessing a channel or reading an environment flag.
   - Bind port zero on loopback in app/server tests and use real fetch.
   - Prove executable readiness, collision exit, signal termination, and port release with
     real child-process tests. Windows reports `ChildProcess.kill('SIGTERM')` as OS
     termination by signal, while POSIX delivery exercises the graceful listener and exits
     zero.
   - Probe the actual capability in a capability-dependent test, and scope any skip
     narrowly.
8. **Document and prove parity** for every app export and behavioral method: guide,
   examples, manifest index, and the parity specifiers walking the existing `src` and
   `app` roots and every selected alias.
9. **Verify.** Run the rules' cleanup sweeps over source and tests. Then run the
   adversarial pass, a mechanical conformance pass, and the repository gates in their
   required order. Generated CI runs those gates on the declared minimum Node release and
   on the current major.

Do not add showcase, authentication, persistence, proxy, styling-system, or product
policy unless the request requires it. Do not leave placeholders, compatibility shims,
empty setup files, or deferred app behavior.
