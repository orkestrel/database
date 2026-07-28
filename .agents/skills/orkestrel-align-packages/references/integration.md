# Cross-package and environment integration

## Map ownership

Use this dependency model unless a package-specific guide narrows it:

| Surface       | May depend on                                                       | Must not depend on                     |
| ------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `src/core`    | host-independent Orkestrel core packages                            | Node, DOM, browser/server environments |
| `src/server`  | its core and server-capable dependencies                            | browser/app environments               |
| `src/browser` | its core and browser-capable dependencies                           | Node/server/app environments           |
| `app/core`    | host-independent library/core and app/core logic                    | Node, DOM, app/server, app/browser     |
| `app/server`  | app/core plus core/server libraries                                 | browser/app/browser                    |
| `app/browser` | app/core plus core/browser libraries and shared transport contracts | Node/app/server implementation         |

Browser application code reaches server behavior through shared contracts and transports, not server implementation imports.

Framework packages own reusable mechanisms. Applications own workflows, policy, presentation, users, authorization decisions, and product-specific defaults.

## Use consumers as evidence

Read the concrete consumer flow first-hand:

1. Identify the desired use case.
2. Trace construction, types, options, calls, events/results, cleanup, and errors.
3. Record every adapter, cast, wrapper, duplicate schema, or ordering workaround.
4. Decide whether it reflects:
   - consumer misuse or missing local composition;
   - a documentation/ergonomics defect;
   - a genuinely misplaced or incomplete upstream mechanism.

“Upstream never bends for downstream” is too rigid. Downstream friction may reveal an upstream defect. Fix the lowest package that owns the general mechanism, but never leak product policy upward.

## Extract across packages

When moving behavior:

- define the destination contract and guide first;
- keep storage/transport integrations pluggable where consumers choose them;
- move the real implementation, tests, and guide together;
- delete the source duplicate and update every consumer;
- use originating package imports; never re-export dependency symbols;
- validate the change without compatibility shims.

## Design round-trip tests

Place each proof at the highest useful layer:

- lower package: fast deterministic invariants and boundary behavior;
- adapter package: real protocol/storage/browser integration;
- highest consumer package: one composed ergonomic workflow;
- dedicated live-service package: real model/service behavior.

Use the actual packages and transports. Use temporary resources or protocol-faithful fixture servers for deterministic network boundaries. Use the real external service when its behavior is the claim. Never simulate an owned package with a mock or fake.

Test both successful composition and contract disagreement: invalid options, unavailable capability, partial failure, abort/cleanup, version mismatch, and lifecycle ordering where applicable.
