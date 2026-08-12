# Cross-package and environment integration

## Map ownership

Dependency direction across environments is the root project model in `AGENTS.md`, detailed for placement in `.claude/rules/workspace.md` and for app composition in `.claude/rules/application.md`. Read those; this reference does not restate them. Apply the same law to a dependency's `@orkestrel/<package>/browser` and `/server` exports, whose bare export is its core API.

Ownership across packages is what those rules leave open: framework packages own reusable mechanisms, and applications own workflows, policy, presentation, users, authorization decisions, and product-specific defaults.

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

When the claim is that a foreign client can consume the stack — an editor, an agent CLI, a third-party protocol client — one representative real client of that class drives the surface end to end before the claim ships. Record the exact commands, the authentication and approval model that client needed, and every part of the surface it could not reach. Protocol-level tests prove the protocol; only the client proves the integration.

Test both successful composition and contract disagreement: invalid options, unavailable capability, partial failure, abort/cleanup, version mismatch, and lifecycle ordering where applicable.
