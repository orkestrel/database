---
paths:
  - 'tests/**/*'
  - 'vite.config.ts'
  - 'configs/**/*.ts'
  - 'package.json'
---

# Testing rules

## Test contract

- Mirror source/application structure:
  `tests/{src,app}/[environment]/[domain]/[source].test.ts`.
- Prefer test filenames matching entrypoints: `index.test.ts` for `index.ts`, `main.test.ts` for `main.ts`.
- Tests are deterministic: identical inputs produce identical results.
- Keep default suites fast: timers normally use 10–50 ms and tests make no network calls.
- Use real implementations and small scenarios. Never use mocks, behavioral fakes, module replacement, or framework spies for project-owned or integrated behavior.
- Use recorders for calls/events, temporary resources for stateful boundaries, protocol-faithful fixture servers for deterministic network peers, and the real external service when its behavior is the claim.
- Prefer inert customizable data and input stubs.
- Allow a scripted boundary stub only when it implements the real interface or protocol minimally, to drive the system under test. It never reimplements project-owned behavior and never stands in for the integration being claimed.
- Cover happy paths, error paths, empty input, boundary values, `NaN`, positive/negative zero, cycles, and Map/Set order where relevant.
- Test observable behavior, not implementation details.
- Assert the membership a discovered or globbed set should have, not a total that a partly empty population satisfies. A glob spanning two locations passes a size check while one of them matches nothing.
- Never assert an implementation against itself. Compare the answer to a declaration, a fixture, or a second mechanism that could disagree with it. Re-deriving the answer the same way the source derives it produces a test that passes for every value the source ever returns, and it reads exactly like a real one.
- Probe a host-varying property at runtime, on the host the test is running on, and assert against what the probe returned. Filesystem case folding, path separators, permission bits, and rename semantics differ per host, so a fixture built on one host describes that host and silently measures something else on the next.
- Assert a runtime-chosen result as the property it must have, not as the number one run produced. Compression, timing, and buffer sizing are the runtime's choice, so pin the relationship the test depends on — that the encoded form is larger, that the second call is faster — and let the assertion fail when the input drifts out of the range where that relationship holds.
- Give a conditional skip the mechanism that makes it inapplicable, cited, not the platform name alone. A test skipped on a platform is a test nobody re-examines; a test skipped because a named API rejects a named case is one anybody can re-check.
- A regression test records the exact command and its failing count before the fix, and the same command's passing count after.
- Use `it.todo()` only for explicitly out-of-scope roadmap work, never to complete the current request. Every `.skip` or conditional skip has a narrow verifiable applicability reason.
- Do not create test files solely for `constants.ts`, barrels, error definitions, or `types.ts`.
- Run the narrowest relevant Vitest project during development; do not run the entire suite casually.

## Cross-cutting proofs

A proof that covers the workspace instead of one module has a fixed location, so no package invents
its own:

| Path                         | Proves                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `tests/policy.test.ts`       | Every source file obeys the syntactic coding and placement law  |
| `tests/config.test.ts`       | Root configuration resolves its aliases, projects, and outputs  |
| `tests/guides.test.ts`       | Every documented API exists and every public API is documented  |
| `tests/conformance.test.ts`  | Where this package drifts from the official tooling it tracks   |
| `tests/integration.test.ts`  | The built package works when installed and driven from outside  |
| `tests/service/**/*.test.ts` | The live external services this package drives, driven for real |

- `.claude/rules/workspace.md` names the Vitest project each location belongs to.
- `integration.test.ts` is a reserved filename at any level. It names a scope rather than a module,
  so the mirror rule does not reach it; its scope is the directory it sits in.
- Give every nested `integration.test.ts` its own exact-path project entry. A glob such as
  `tests/src/**/integration.test.ts` double-claims a file another project already owns.

## Probes

A probe is a throwaway instrument that settles one question. It is not a test and never ships.

Two kinds, split by which tool has to see the probe:

- A **type probe** is read by `tsc`, whose scoped project includes only its own environment, so it
  lives in the source tree beside what it measures. Delete it before the unit returns; a leaked one
  fails the placement sweep, because a probe filename is not a centralized kind file.
- A **runtime probe** is collected by a Vitest project, so it lives in `tmp/probe/` and runs through
  the `probe` project. `tmp/` is ignored by git, so no probe enters a commit by accident, and every
  test script names its project, so no gate runs the `probe` project.

Run a probe before relying on an unverified belief about behaviour: what a function returns, what a
configuration resolves to, whether a path is reached at all. Prefer a probe to an argument whenever
the probe is cheap.

Three rules bind every probe:

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
- Keep them out of the default run.
- Warm and verify service readiness in `tests/setupService.ts`.
- Hard-require readiness: throw loudly; never silently skip.
- Verify service-dependent logic through that service's project, not unrelated module tests or scattered conditional skips.
- Tune each request to the smallest input/context/output that proves one behavior without becoming brittle or expensive.
- Prefer semantic bounded assertions over exact generated prose. Increase context/workload only when the scenario requires it.

## Expensive proofs

A test that spawns a process, packs, installs, or drives a real build is a proof, not a unit test.

- Give it its own Vitest project with its own setup and timeout.
- Keep it out of the default run and require it in `prepublishOnly`.
- Slow and hermetic is reason enough to isolate a proof; it need not touch an external service.
- Where such a proof stays in a shared project, size its budget from a full contended run rather than from an isolated one. A budget that clears the isolated cost by a thin margin turns contention into a red gate reporting a timeout, which carries no diagnostic about the code and costs a full investigation to dismiss.

## Shared test infrastructure

Test helpers are shared infrastructure, not local test-file clutter.

- Extract a fixture, recorder, event factory, async wait, renderer, scenario/data builder, protocol fixture, or DOM builder as soon as it could serve another test.
- Any duplicate or near-duplicate helper is a defect; consolidate it into one general form.
- Export every reusable helper, fixture type, factory, constant, and guard from setup files.
- A setup file owns everything an assertion needs and nothing an assertion is: `describe`, `it`, and `expect` never appear in a `setup*.ts`.
- Data tables and case matrices belong in a setup file at any size; test registration does not.
- Test files import shared infrastructure rather than declaring local fixture factories.
- Never reimplement a framework helper in tests or fixtures; import the real parser, signer, flattener, or other helper.
- Prefer small customizable factories/stubs that seed inert data for a real scenario over repeated inline setup.
- Helper names follow module-helper naming: `createRecorder`, `buildElement`, `appendItems`, `renderRows`, `waitForDelay`, `extractDetail`.

Place helpers by environment:

- `tests/setup.ts`: host-independent; no `node:*`, DOM, `window`, or Vue.
- `tests/setupServer.ts`: Node-only helpers and `node:fs` loaders anchored to `WORKSPACE_ROOT`.
- `tests/setupBrowser.ts`: DOM/Vue/browser helpers and setup CSS.
- `tests/setupStyles.ts`: CSS/style helpers and compiled cascade.

### Recorder

Use a real recorder callback instead of a framework spy when only calls/arguments matter:

```ts
interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}
```

### Delay

Use the shared delay helper; never repeat inline timeout promises:

```ts
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
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
