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
  `tests/{src,app}/[environment]/[domain]/[Entity].test.ts`.
- Prefer test filenames matching entrypoints: `index.test.ts` for `index.ts`, `main.test.ts` for `main.ts`.
- Tests are deterministic: identical inputs produce identical results.
- Keep default suites fast: timers normally use 10–50 ms and tests make no network calls.
- Use real implementations and small scenarios. Never use mocks, behavioral fakes, module replacement, or framework spies for project-owned or integrated behavior.
- Use recorders for calls/events, temporary resources for stateful boundaries, protocol-faithful fixture servers for deterministic network peers, and the real external service when its behavior is the claim.
- Prefer inert customizable data/input stubs. A scripted boundary stub is allowed only when it implements the real interface/protocol minimally to drive the system under test; it never reimplements project-owned behavior or stands in for the integration being claimed.
- Cover happy paths, error paths, empty input, boundary values, `NaN`, positive/negative zero, cycles, and Map/Set order where relevant.
- Test observable behavior, not implementation details.
- Use `it.todo()` only for explicitly out-of-scope roadmap work, never to complete the current request. Every `.skip` or conditional skip has a narrow verifiable applicability reason.
- Do not create test files solely for `constants.ts`, barrels, error definitions, or `types.ts`.
- Run the narrowest relevant Vitest project during development; do not run the entire suite casually.

## Live-service tests

Live external services/models are the deliberate exception to fast hermetic defaults:

- Put them in a dedicated isolated Vitest project with its own setup and longer timeout.
- Keep them out of the default run.
- Warm and verify service readiness in setup.
- Hard-require readiness: throw loudly; never silently skip.
- Verify service-dependent logic through that service's project, not unrelated module tests or scattered conditional skips.
- Tune each request to the smallest input/context/output that proves one behavior without becoming brittle or expensive.
- Prefer semantic bounded assertions over exact generated prose. Increase context/workload only when the scenario requires it.

## Shared test infrastructure

Test helpers are shared infrastructure, not local test-file clutter.

- Extract a fixture, recorder, event factory, async wait, renderer, scenario/data builder, protocol fixture, or DOM builder as soon as it could serve another test.
- Any duplicate or near-duplicate helper is a defect; consolidate it into one general form.
- Export every reusable helper, fixture type, factory, constant, and guard from setup files.
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

## Discovery and adequacy audit

Before acceptance:

- prove every intended test file is discovered by the correct project;
- inspect actual test counts and environments;
- audit `.todo`, `.skip`, conditional skips, retries, and inflated timeouts;
- confirm each assertion would fail for the defect it claims to catch;
- confirm helpers do not reimplement production behavior;
- confirm cleanup runs after setup or assertion failure;
- confirm current-scope requirements have real tests rather than placeholders.
