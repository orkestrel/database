---
paths:
  - 'tests/**/*'
  - 'vite.config.ts'
  - 'configs/**/*.ts'
  - 'package.json'
---

# Testing rules

## Test contract

- Mirror module/application structure:
  `tests/{src,app}/[environment]/[domain]/[module].test.ts`.
- The mirrored population is `src` and `app` alone. `configs/` is a source directory and is
  deliberately not a mirrored root: its leaves produce the workspace's configuration rather than ship
  in it, and they are proved from `tests/config.test.ts` beside the configuration they produce. Do
  not add `tests/configs/`.
- Resolve a mirrored module through `.ts`, `.tsx`, `.mts`, `.cts`, `.vue`, `.scss`, or `.css`.
- Resolve a Sass or CSS partial through the module's leading underscore.
- Resolve each root `tests/setup*.test.ts` proof against its sibling `tests/setup*.ts` module. A
  root `tests/setup.test.ts` file can prove several setup modules when their helpers serve
  several projects.
- Prefer test filenames matching entrypoints: `index.test.ts` for `index.ts`, `main.test.ts` for `main.ts`.
- Tests are deterministic: identical inputs produce identical results.
- Keep default suites fast: timers normally use 10–50 ms and tests make no network calls.
- Use real implementations and small scenarios. Never use mocks, behavioral fakes, module replacement, or framework spies for project-owned or integrated behavior.
- Use recorders for calls/events, temporary resources for stateful boundaries, protocol-faithful fixture servers for deterministic network peers, and the real external service when its behavior is the claim.
- Prefer inert customizable data and input stubs.
- Allow a scripted boundary stub only when it implements the real interface or protocol minimally, to drive the system under test. It never reimplements project-owned behavior and never stands in for the integration being claimed.
- Bind a test fixture server to `127.0.0.1` on an ephemeral port (`listen(0)`), never to `::1` and never to a fixed port: a host without IPv6 fails `EAFNOSUPPORT`, and a fixed port flakes on occupancy.
- Cover happy paths, error paths, empty input, boundary values, `NaN`, positive/negative zero, cycles, and Map/Set order where relevant.
- Test observable behavior, not implementation details.
- Assert the membership a discovered or globbed set should have, not a total that a partly empty population satisfies. A glob spanning two locations passes a size check while one of them matches nothing.
- Never assert an implementation against itself. Compare the answer to a declaration, a fixture, or a second mechanism that could disagree with it. Re-deriving the answer the same way the source derives it produces a test that passes for every value the source ever returns, and it reads exactly like a real one.
- Probe a host-varying property at runtime, on the host the test is running on, and assert against what the probe returned. Filesystem case folding, path separators, permission bits, and rename semantics differ per host, so a fixture built on one host describes that host and silently measures something else on the next.
- Assert a runtime-chosen result as the property it must have, not as the number one run produced. Compression, timing, and buffer sizing are the runtime's choice, so pin the relationship the test depends on — that the encoded form is larger, that the second call is faster — and let the assertion fail when the input drifts out of the range where that relationship holds.
- Measure an elapsed interval with `performance.now()`, never `Date.now()`. `Date.now()` returns whole milliseconds, so an interval built from two of its readings truncates at both ends and can under-report by a millisecond — enough to fail a boundary assertion against a timer that behaved correctly. `performance.now()` is monotonic and sub-millisecond, and it does not move when the wall clock does.
- Give a conditional skip the mechanism that makes it inapplicable, cited, not the platform name alone. A test skipped on a platform is a test nobody re-examines; a test skipped because a named API rejects a named case is one anybody can re-check.
- A regression test records the exact command and its failing count before the fix, and the same command's passing count after.
- The revert that proves a repair reddens exactly the test that names the defect. Keep the import and collection graph valid while reverting, and confirm the named test was collected. A revert that reddens anything beyond that test broke the harness, and its count is not evidence.
- Use `it.todo()` only for explicitly out-of-scope roadmap work, never to complete the current request. Every `.skip` or conditional skip has a narrow verifiable applicability reason.
- Do not create test files solely for `constants.ts`, barrels, error definitions, or `types.ts`.
- Run the narrowest relevant Vitest project during development; do not run the entire suite casually.

## Cross-cutting proofs

A proof that covers the workspace instead of one module has a fixed location, so no package invents
its own:

| Path                         | Proves                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tests/policy.test.ts`       | Every source file obeys the syntactic coding and placement law                                                                 |
| `tests/config.test.ts`       | Root configuration resolves its aliases, projects, and outputs, and the `configs/` leaves behind them                          |
| `tests/guides.test.ts`       | Every documented API exists, every public API is documented, and every executable fence returns what the guide says it returns |
| `tests/conformance.test.ts`  | Where this package drifts from the official tooling it tracks                                                                  |
| `tests/distribution.test.ts` | The packed package installs and resolves through its public exports                                                            |
| `tests/integration.test.ts`  | The package's features work together end to end across environments                                                            |
| `tests/setup*.test.ts`       | Reusable behavior exported from sibling `tests/setup*.ts` modules works as the workspace's suites require                      |
| `tests/service/**/*.test.ts` | The live external services this package drives, driven for real                                                                |

- Put each root `tests/setup*.test.ts` proof in the `setup` project. Keep its assertions on
  exported test-infrastructure behavior: do not duplicate production behavior there, and do not
  move setup-helper assertions into another cross-cutting proof.
- `.claude/rules/workspace.md` names the Vitest project each location belongs to.
- The `guides` project runs in Node with the browser disabled. Its subject is what the guide
  claims: that every documented name resolves, and that every fence asserting a value returns
  that value. A proof that renders a component and compares it against a definition is a
  composition and belongs in an `integration.test.ts` scoped to its directory.
- Transcribe each flagship fence and assert the values its comments claim. Name resolution is
  not a behavioural proof, so a fence documenting a value the code contradicts passes every
  parity assertion. Change a fence, change the transcription beside it.
- `integration.test.ts` is a reserved filename at any level. It names a scope rather than a module,
  so the mirror rule does not reach it; its scope is the directory it sits in.
- An integration test is an end-to-end test: it composes the package's own features and drives them
  together, through the public API, with no part of the system under test replaced.
- Scope it by where the composition happens. `tests/integration.test.ts` drives features **across**
  environments — core through server, core through browser, one environment's output consumed by
  another. A nested `tests/src/<environment>/integration.test.ts` drives features **within** that one
  environment.
- Do not put a packaging, install, or distribution check in an integration test. What the tarball
  contains is a different question from whether the features compose.
- A test the mirror rule flags is a misplaced test until its placement is checked. Move it to the
  location its scope names. Widen the rule only when that check shows the test already sits at the
  location its scope names and the rule's population omits a module this ruleset mandates, and then
  widen the population rather than admitting the individual case.
- A nested `tests/{src,app}/<environment>/**/integration.test.ts` runs in that environment's project,
  whose existing glob collects it exactly once. Give it a separate exact-path project entry only when
  the proof needs different setup or a different runtime, and exclude that exact path from the
  environment project when you do.

## Probes

A probe is a throwaway instrument that settles one question. It is not a test and never ships.

Route the question before writing a probe. When you can state the edit you believe is correct and the
edit that must break with the stage it breaks at, the question is a claim for the `prove` tool the
`probe` MCP server registers, and `.claude/rules/quality.md` § Instruments owns that rule. When the
question carries no stated belief to falsify yet, when the subject lies outside the TypeScript a
workspace project judges, or when the proof needs what that tool's stages do not model — a process
tree, a listening socket, an installed package, a built entry driven as a child, or a live external
service — write a probe.

The kinds split by which tool has to see the probe:

- A **type probe** is read by `tsc`, whose scoped project includes only its own environment, so it
  lives in the source tree beside what it measures. Delete it before the unit returns; a leaked one
  fails the placement sweep, because a probe filename is not a centralized kind file.
- A **runtime probe** is collected by a Vitest project, so it lives in `tmp/probe/` and runs through
  the `probe` project. `tmp/` is ignored by git, so no probe enters a commit by accident, and every
  test script names its project, so no gate runs the `probe` project.
- A **bench** is read by Vitest's benchmark mode, so it lives inside a test file as a block behind
  the `if (import.meta.env.MODE === 'benchmark')` guard. Only the `test:bench` script collects the
  block, test mode fails an unguarded `bench()` call loudly, and no gate runs a bench. Call `bench`
  directly inside the guard. A `describe` inside it trips `vitest/no-conditional-tests`, and a suite
  the guard leaves unregistered fails test mode with `No test found in suite`.

Run a probe before relying on an unverified belief about behaviour: what a function returns, what a
configuration resolves to, whether a path is reached at all. Prefer a probe to an argument whenever
the probe is cheap.

When the question is whether the difference between methods is a magnitude or negligible, write a
guarded bench block beside the probe test and run the `test:bench` script. Declare the threshold
before the run, read the ratio between the methods against each side's reported uncertainty, and
record nothing below a magnitude. A settled magnitude that underwrites an implementation choice
promotes with its test into the mirrored suite and keeps its guarded block there while that choice
stands. A deterministic relationship promotes as an ordinary assertion, so delete the block. Never
commit baseline output.

These rules bind every probe:

- **Prove the instrument can fail before trusting that it passed.** Pair it with a control drawn
  from outside the population it covers.
- **Promote or delete.** A probe that settles a claim becomes a test in the mirrored location that
  proves the real source. Delete every other probe. A probe left in the suite reports on the harness
  while reading as a test.
- **Never commit a probe.** The ignore rule stops an accident, not a deliberate forced add, and a
  type probe sits in tracked source with no ignore rule at all.

## Live-service tests

Live external services/models are the deliberate exception to fast hermetic defaults:

- Put them in the `service` project, under `tests/service/`, with `tests/setupService.ts` for setup
  and a longer timeout. That module's presence is what registers the project, so a live proof with
  no readiness setup is a project nothing configures.
- `.claude/rules/workspace.md` fixes which gate runs the `service` project, and that gate is not the
  same one in a publishing and a `private: true` workspace.
- Warm and verify service readiness in `tests/setupService.ts`.
- Hard-require readiness: throw loudly; never silently skip.
- Verify service-dependent logic through that service's project, not unrelated module tests or scattered conditional skips.
- Tune each request to the smallest input/context/output that proves one behavior without becoming brittle or expensive.
- Prefer semantic bounded assertions over exact generated prose. Increase context/workload only when the scenario requires it.

## Expensive proofs

A test that spawns a process, packs, installs, or drives a real build is a proof, not a unit test.

- Give it its own Vitest project with its own setup and timeout.
- Keep it out of the default run where the workspace has a gate that can hold it.
  `.claude/rules/workspace.md` fixes which gate each isolated project runs from, and that placement
  differs between a publishing and a `private: true` workspace.
- The fixed expensive-proof projects are `distribution` and `service`.
- A `distribution` proof reads `import.meta.env.MODE` and fails, rather than skips, on an unreachable
  registry under `--mode release`. The publish gate invokes it that way, so a proof that skips there
  passes the gate without ever proving the artifact installs. An ordinary local run may still skip.
- Slow and hermetic is reason enough to isolate a proof; it need not touch an external service.
- Where such a proof stays in a shared project, size its budget from a full contended run rather than from an isolated one. A budget that clears the isolated cost by a thin margin turns contention into a red gate reporting a timeout, which carries no diagnostic about the code and costs a full investigation to dismiss.

## Shared test infrastructure

Test helpers are shared infrastructure, not local test-file clutter.

`@orkestrel/test` owns the helpers every workspace repeats: the call recorder, the real delay, the JSON and async collectors, and the owned scratch directory. Import them from `@orkestrel/test`, and its Node-only helpers from `@orkestrel/test/server`. Write a helper of your own only where the package exports none for the job. The following shapes are the contract a workspace codes against, not source to copy.

- For the vendored test set (`tests/setupPolicy.ts`, `tests/policy.test.ts`, and
  `tests/config.test.ts`), keep shared helpers within that set instead of importing them from
  `@orkestrel/test`; follow the vendored-file import law in `.claude/rules/workspace.md`.

- Extract a fixture, recorder, event factory, async wait, renderer, scenario/data builder, protocol fixture, or DOM builder as soon as it could serve another test.
- Any duplicate or near-duplicate helper is a defect; consolidate it into one general form.
- Export every reusable helper, fixture type, factory, constant, and guard from setup files.
- A setup file owns everything an assertion needs and nothing an assertion is: `describe`, `it`, and `expect` never appear in a `setup*.ts`.
- Data tables and case matrices belong in a setup file at any size; test registration does not.
- Test files import shared infrastructure rather than declaring local fixture factories.
- Never reimplement a framework helper in tests or fixtures; import the real parser, signer, flattener, or other helper.
- Prefer small customizable factories/stubs that seed inert data for a real scenario over repeated inline setup.
- Helper names follow module-helper naming: `createFixtureServer`, `buildElement`, `appendItems`, `renderRows`, `waitForReady`, `extractDetail`.

Place helpers by environment:

- `tests/setup.ts`: host-independent; no `node:*`, DOM, `window`, or Vue.
- `tests/setupServer.ts`: Node-only helpers and `node:fs` loaders anchored to `WORKSPACE_ROOT`.
- `tests/setupBrowser.ts`: DOM/Vue/browser helpers and setup CSS.
- `tests/setupStyles.ts`: CSS/style helpers and compiled cascade.

### Recorder

Import `createRecorder` from `@orkestrel/test` instead of a framework spy when only calls and arguments matter. It returns:

```ts
interface RecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}
```

### Delay

Import `waitForDelay` from `@orkestrel/test`; never repeat an inline timeout promise. It waits for one host timer and defaults to `0`:

```ts
function waitForDelay(ms?: number): Promise<void>
```

Use it to yield, never to wait for something another process produces. A fixed delay chosen to
outlast a child's startup is a race whose loss looks like a product defect: the test measures
interpreter bootstrap rather than the behaviour it names, and it fails on a loaded host and passes on
an idle one. Wait until a named condition holds instead, polling with `waitForDelay` inside a budget
measured by `performance.now()`, and fail with the condition's own description when the budget
expires.

### Scratch

Import `createScratch` from `@orkestrel/test/server` when a proof needs real files. It allocates a temporary directory it owns, contains every path against escape, and removes the directory on `destroy`:

```ts
interface ScratchInterface {
	readonly path: string
	write(target: string, text: string): string
	read(target: string): string | undefined
	has(target: string): boolean
	names(target?: string): readonly string[]
	ensure(target: string): string
	link(target: string, source: string): string
	remove(target: string): void
	destroy(): void
}
```

### Style primitives

Browser/style setup exposes shared assertions/builders:

`mount`, `render`, `build`, `style`, `token`, `rootToken`, `pixels`, `rgba`, `colorEqual`, `findRule`.

`findRule` proves a declaration exists in the cascade; `style()` reads the resolved result.

## Browser tests

Use the real browser as the system under test:

- Do not replace DOM events, storage, observers, viewports, layout methods, pointer, or drag APIs unless the browser genuinely lacks one.
- Prefer real nodes, events, styles/layout, and observers.
- Centralize event factories: `createPointerEvent`, `createDragEvent`, `typeInput`, `fireTransitionEnd`.
- Centralize DOM builders: `createButtonElement`, `createDropdownElements`, `createModalElement`.
- Assert DOM state, emitted events, callback records, focus, classes, attributes, and public API state.
- Do not assert private state, internal timers, or framework scheduler internals.
- Prefer real short timers and observable wakeups. Never replace the host clock.

## Runner configuration

Keep Vitest/provider configuration minimal:

- Prefer defaults until a measured problem proves them insufficient.
- Centralize provider setup in one helper/shared block.
- Add browser/provider/teardown/timeout/parallelism/cache/launch settings only for a current verified need.
- Avoid long browser flag lists and persistent contexts unless a test requires them.
- For slow teardown, inspect test cleanup, open handles, file parallelism, and context churn before adding launch flags.
- Remove exploratory settings after fixing the cause.
- Config comments explain the current reason, not the history of failed experiments.

## Untestable usually means missing seam

Before accepting that a behavior cannot be tested, look for the seam that would make it testable.

- Treat a collaborator reached through a hard-coded global — a stream, a clock source, a spawn, a fetch — as a missing injection point, not an untestable truth.
- An injected collaborator with a real minimal implementation is a sanctioned boundary stub, not a mock of project-owned behavior.
- Add the seam rather than shipping the gap whenever the design would welcome it anyway, and whenever a sibling collaborator is already injected.
- Record a genuinely irreducible gap where a reader meets it: what is unproven, why it cannot be driven, and what would change that. A silent untested guard reads exactly like a tested one.

Coverage rules:

- Read a coverage report as a discovery input, never as evidence of proof. It answers one cheap mechanical question — which code no test executed — and that reliably finds forgotten branches and rules nothing calls.
- Never cite coverage as the adequacy audit's result. It cannot tell you whether an executed line is asserted, so a fully covered file can still be entirely unproven.
- Never let a percentage become the target.

## Discovery and adequacy audit

Before acceptance:

- prove every intended test file is discovered by the correct project;
- prove every declared project is reachable from a gate. A project registered in the root
  configuration with no script, or with a script no chain runs, is a proof that never executes — and
  because it never executes it never fails, so the suite reports green while carrying it. Read the
  chain, not the exit code: run each project directly once and compare that list against what `test`
  actually invokes. The gate that would report this gap is the gate that is missing.
- prove a declared project's include resolves to a real file. An empty project is not a passing
  project: Vitest exits non-zero on "no test files found", so a project aimed at a path that was
  never created stays invisible until something finally runs it.
- inspect actual test counts and environments;
- audit `.todo`, `.skip`, conditional skips, retries, and inflated timeouts;
- confirm each assertion would fail for the defect it claims to catch, and that it fails rather than passes when its population is empty;
- confirm helpers do not reimplement production behavior;
- confirm cleanup runs after setup or assertion failure;
- confirm current-scope requirements have real tests rather than placeholders.
