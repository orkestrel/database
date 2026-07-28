---
paths:
  - 'src/**/*'
  - 'app/**/*'
  - 'tests/**/*'
  - 'guides/**/*'
  - 'package.json'
  - 'vite.config.ts'
  - 'tsconfig.json'
  - '.agents/skills/**/*'
  - '.claude/skills/**/*'
---

# Research, hardening, and completion rules

## Evidence before change

- Research is mandatory when the user requests it, when comparing an upstream/protocol/legacy implementation, or when current external behavior materially affects design.
- Use current primary sources for external capabilities and exact installed declarations/guides for dependencies. Separate verified fact from inference.
- Read authoritative types and named decision-bearing implementation files first-hand. Delegate bulk supporting context, not the owning design decision.
- Treat existing code, tests, `old/`, branches, and copied projects as evidence rather than authority.
- Build a capability/defect matrix before a broad API or production-readiness change. Every row ends as implement, repair, retain, or intentionally exclude with evidence.

## Ecosystem reuse

- Inspect declared `@orkestrel/*` packages before implementing overlapping infrastructure.
- Prefer an exact originating primitive when semantics match; test semantic differences when they do not.
- Downstream friction is valid evidence of a reusable upstream defect, not automatic proof. Fix the lowest package that owns the general mechanism and keep product policy downstream.
- Update affected consumers atomically. Never add compatibility shims or dependency re-exports.

## Production hardening

- Translate “enterprise-grade” or “production-ready” into an explicit risk/seam matrix covering applicable inputs, states, failures, cleanup, cancellation, concurrency, resource ownership, hostile boundaries, environment isolation, serialization/restore, and package consumption.
- Test observable invariants at each applicable seam with real implementations.
- Use dedicated real-service projects for external model/service behavior. Require readiness and tune each request to the smallest robust proof.
- Audit test discovery, counts, skipped/todo tests, cleanup, and assertion adequacy; passing discovered tests alone is insufficient.
- Inspect public exports, declarations, supported runtime targets, and generated outputs.
- Add an independent adversarial review for security, destructive paths, concurrency, protocols, or untrusted external input.

## Completion

- Run the applicable repository skill for comprehensive hardening, structural cleanup, contract adoption, or multi-package alignment.
- Finish every in-scope capability and required finding now. Do not leave TODOs, deferred rows, empty branches, skipped proof, or hidden follow-up work.
- Perform a final centralization/wrapper/test-helper/text-integrity sweep after implementation and before gates.
- Local quality gates and relevant output inspection are required evidence.
