# Production hardening

## Build the risk and seam matrix

List every boundary where assumptions can fail:

- public inputs and option combinations;
- empty, missing, minimum, maximum, overflow, `NaN`, infinity, and signed-zero values;
- invalid state transitions and repeated lifecycle operations;
- partial work, abort, timeout, retry, pause/resume, stop/destroy, and cleanup;
- concurrency, reentrancy, ordering, idempotency, fairness, and backpressure;
- filesystem, process, socket, protocol, browser, model, and network boundaries;
- hostile strings, paths, headers, frames, JSON, prototypes, getters, and proxies;
- resource ownership, leaks, teardown, and pressure;
- environment isolation and unsupported-host behavior;
- serialization, restore, public exports, and consumer ergonomics.

For each applicable seam, state the invariant, failure mode, observable result, and proving test. Omit irrelevant generic cases rather than creating meaningless tests.

## Use real implementations

Test through public behavior with:

| Seam                                    | The real thing it must be driven with                                    |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Package behavior                        | Real package classes and composed managers                               |
| Filesystem                              | Temporary directories and files                                          |
| Network protocol                        | Actual local sockets and protocol-faithful fixture servers               |
| Browser                                 | An actual Chromium-family browser when the browser is the system         |
| Declared dependency                     | The actual installed dependency                                          |
| External service or model               | The real service in its dedicated project when its behavior is the claim |
| Third-party client or protocol consumer | One representative real foreign client, driven end to end                |

A third-party seam is the one case where the package's own tests cannot close the claim:
protocol tests prove the protocol, and only a real client of that class proves the
integration. Drive it end to end, record the exact commands, and record what that client
could NOT reach as an honest limit rather than an untested assumption.

Never use mocks, behavioral fakes, module replacement, or framework spies. Use recorders for callbacks and customizable data factories/stubs for inert shapes.

## Design live-service tests

Keep live tests in a dedicated project with explicit readiness, setup, timeout, and cleanup.

- Require the real service; fail loudly when unavailable.
- Never silently skip or convert absence into a passing result.
- Warm the service before measured assertions when startup is material.
- Use the smallest prompt/request/context that proves one behavior.
- Make assertions semantic and bounded, not dependent on exact prose.
- For model tests, constrain temperature/seed/options when the real API supports it, but do not claim determinism the provider does not promise.
- Increase context or workload incrementally only when the scenario requires it.
- Test instruction precedence, long-context behavior, summarization, tool calls, scopes, and state transitions through observable outcomes.
- Avoid redundant expensive calls; one request should prove one primary claim.

Keep live projects outside the fast default suite when repository policy requires it, while making their explicit command authoritative for the campaign.

## Challenge lifecycle and pressure

Exercise:

- repeated start/stop/pause/resume/abort/destroy calls;
- operations during transitions and after teardown;
- concurrent managers/entities and interleaved completion;
- late events, listener errors, rejection paths, and cleanup after partial setup;
- append/change/remove behavior while work is active versus already advanced;
- queues, pools, workers, terminals, sockets, or browsers at representative concurrency;
- cancellation propagation and bounded shutdown;
- no busy polling, open handles, leaked processes, sessions, pages, files, or listeners.

Use bounded pressure tests that expose coordination defects without making the suite gratuitously slow.

## Audit security and destructive paths

For every fetch, write, delete, extraction, path, protocol, or authentication boundary:

- validate before acting;
- constrain targets and traversal;
- fail closed when an allowlist or target cannot be established;
- avoid logging secrets or untrusted full payloads;
- make destructive scope explicit and recoverable where practical;
- prove malformed, partial, oversized, and adversarial input behavior.

## Audit the tests themselves

Verify:

- every test file is discovered by the intended project;
- targeted commands run the expected count and environment;
- `.todo`, `.skip`, conditional skips, retries, and generous timeouts are justified;
- no current-scope requirement is represented only by a todo;
- assertions can fail for the defect they claim to catch;
- tests observe public outcomes rather than private implementation;
- helpers do not reimplement production logic;
- real cleanup runs even after assertion or setup failure.

## Inspect generated outputs

- build all supported environments;
- inspect export/declaration alignment and supported runtime targets;
- confirm required declarations, maps, and assets are present;
- confirm secrets, temporary artifacts, and generated reports do not leak into outputs.
