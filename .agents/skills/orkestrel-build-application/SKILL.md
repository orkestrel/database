---
name: orkestrel-build-application
description: Design, scaffold, extend, or harden Orkestrel `app/core`, `app/browser`, and `app/server` environments. Use for app-only or mixed src/app workspaces, app environment isolation, Vue browser entries, Node server entries, app aliases/configs/scripts/tests, cross-environment contracts, and application guide parity.
---

# Build an Orkestrel application

Read `AGENTS.md`, `.claude/rules/application.md`, `.claude/rules/workspace.md`,
`.claude/rules/architecture.md`, `.claude/rules/documentation.md`, and every other rule
selected by the files in scope. Then read
[`references/application.md`](references/application.md) completely.

## Workflow

1. Inventory existing `src`, `app`, `configs`, tests, manifest scripts, aliases,
   and guide rows. Treat current code as evidence, not policy.
2. Select only required environments. `--src` selects published src environments and
   `--app` selects private app environments; the two selections are independent,
   at least one is required, and there is no `--surfaces` synonym. Each side offers
   `core`, `browser`, and `server`. Browser and server may depend on their core, core
   depends on neither host implementation, and browser/server remain disjoint.
3. Define or refine public contracts in each environment's `types.ts` before
   implementation. Inspect exact installed `@orkestrel/*` capabilities before
   writing boundary code, and reuse a primitive whose semantics match.
4. Add aliases in root TypeScript configuration and derive Vite aliases from
   them. Keep `configs/app` wrappers thin.
5. Implement complete entries, `export *`-only barrels, centralized `types.ts` /
   `constants.ts` / `helpers.ts` and their sibling kind files, dedicated one-class
   implementation files, environment parsing, lifecycle, builds, and scripts.
   App-only manifests must be `private: true`; mixed manifests publish only
   `dist/src` and never expose `dist/app`.
6. Keep boundary enforcement inside the configured toolchain, each layer owning what
   it can express: Oxlint `no-restricted-imports` for literal-string declared package,
   alias, and conventional relative import direction; Oxfmt for formatting;
   `tests/setupPolicy.ts` as the narrow TypeScript compiler-API pass over computed and
   template-literal specifiers, declaration placement, and the barrel law; scoped
   TypeScript projects for host-global isolation; and Vite's real browser/server
   builds and environment-boundary plugin for Vue, CSS, assets, workers, runtime
   resolution, and physical workspace containment, using Vite's Oxc AST for
   TypeScript/JavaScript, the official Vue SFC compiler for `.vue` blocks, Vite's
   HTML parser callbacks, and Vite's bundled Lightning CSS dependency analyzer.
   Exercise the combined configuration through
   fresh generated-consumer lint, typecheck, build, and integration tests. Add no
   standalone boundary script and no second general-purpose parser or source-language
   analyzer duplicating those layers. Keep browser-only runtime tooling
   development-only and require explicit authorization before adding a Sass compiler.
7. Add real app/core Node tests, app/browser Playwright-backed Chromium tests,
   app/server loopback and child-process tests, and cross-environment integration.
   Exercise repeated lifecycle, malformed environment values, protocol failures,
   concurrency, hostile connections, and cleanup. A signal-owning server runner must
   expose idempotent explicit stop so normal shutdown releases every installed process
   listener; stale asynchronous failures cannot mutate a newer generation, and
   convenience starters return the runner rather than hiding that cleanup contract.
   Keep the runner class alone in `ApplicationServerRunner.ts` and its convenience
   starter in centralized `factories.ts`.
8. Update the guide, examples, manifest index, and parity specifiers for every
   app export and behavioral method.
9. Run source cleanup, test cleanup, one independent design audit and one
   independent objective audit, a mechanical conformance pass, and the
   repository gates in their required order.

Do not add showcase, authentication, persistence, proxy, styling-system, or
product policy unless the request requires it. Do not leave placeholders,
compatibility shims, empty setup files, or deferred app behavior.
