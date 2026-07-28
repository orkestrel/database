---
name: orkestrel-harden-package
description: Research, audit, refactor, implement, centralize, test, document, and locally verify an individual Orkestrel TypeScript package to enterprise-grade production readiness under the repository's current AGENTS.md. Use when asked to fill missing or deferred capabilities, compare upstream or legacy implementations, salvage prior art, centralize source or test declarations, eliminate nested functions or superfluous wrappers, maximize declared @orkestrel dependencies—especially @orkestrel/contract—or add rigorous real-implementation and live-service tests. Select only the phases required by a narrow request; run the full workflow for production readiness or comprehensive hardening.
---

# Harden an Orkestrel package

## Load authority

Read the current files in this order:

1. `AGENTS.md`.
2. Every applicable `.claude/rules/*.md`.
3. Select the work lane below and read every reference that lane requires.
4. `guides/README.md`, the governing package/domain guide, and `ROADMAP.md` when present.
5. The authoritative `*/types.ts`, public barrels, `package.json`, build/test configuration, and decision-bearing implementation files.

Treat the current user instruction as authoritative. Treat repository rules as the coding contract and this skill as the workflow. Preserve dirty and user-owned work.

The decision owner must read the governing types and every implementation file the user names directly. Delegate bulk reconnaissance or supporting research, not the final design decision.

## Select the work lane

Choose the smallest lane that fully satisfies the request:

- **Structural:** centralization, nested-function removal, wrapper cleanup, or test-infrastructure consolidation.
- **Capability:** research and implement named missing behavior or upstream parity.
- **Hardening:** perform the complete production-readiness workflow.

A narrow structural request does not authorize unrelated API redesign. A hardening request does authorize fixing every verified in-scope defect and completing every in-scope deferred capability.

Load [research.md](references/research.md) for upstream comparisons, legacy/`old/` material, or capability discovery.

Load [contract.md](references/contract.md) whenever the package declares `@orkestrel/contract`, the user requests contract adoption, or local code overlaps validation, parsing, outcomes, safe exception capture, schemas, or contract generation.

Load [centralization.md](references/centralization.md) for every structural lane and as a mandatory cleanup pass after capability or hardening work.

Load [hardening.md](references/hardening.md) for the hardening lane and for any request involving concurrency, lifecycle pressure, security boundaries, real services/models, test discovery, or package inspection.

## Execute the workflow

1. **Bound the campaign.** Record requested outcomes, in-scope environments/domains, explicit exclusions, supported hosts, dirty files, and evidence needed for acceptance.
2. **Map before editing.** Trace public types, implementations, callers, tests, guides, exports, runtime boundaries, installed Orkestrel dependencies, and applicable legacy/upstream references.
3. **Establish the intended contract.** Build a capability/defect matrix. Separate verified fact from inference. Mark each row implement, repair, retain, or exclude with a reason.
4. **Design types first.** Update guide/spec intent and `*/types.ts` before implementation. Preserve dependency direction, single-word entity APIs, and mechanism-over-policy boundaries. Do not retain compatibility shims.
5. **Implement completely.** Finish every in-scope branch. Reuse exact installed Orkestrel primitives when their semantics match. Never hide incomplete behavior behind a TODO, skip, empty branch, or success-shaped placeholder.
6. **Consolidate.** Run the complete centralization and wrapper sweep. Update all call sites to the real symbol rather than leaving aliases or 1:1 delegates.
7. **Challenge seams.** Add deterministic tests for invariants, boundaries, failures, lifecycle, cleanup, cancellation, concurrency, hostile input, and resource pressure as applicable. Use real implementations and protocol-faithful fixtures. Never use mocks or fakes.
8. **Use live services deliberately.** Put real external services/models in their dedicated project, require readiness, and make each request minimally sufficient, robust, and behaviorally meaningful.
9. **Document the final behavior.** Update the governing guide, examples, method tables, limitations, and parity coverage. Document architectural limits honestly.
10. **Audit completion.** Inspect test discovery, `.todo`/`.skip`/conditional skip use, source/test helper duplication, exports, environment isolation, unexpected text corruption, and the entire diff.
11. **Verify.** Run the repository-prescribed gates in order and inspect the generated outputs relevant to the request.
12. **Review independently.** When orchestration is available, require a design-fit reviewer, an objective correctness/constraints analyst, and a mechanical checker; add an adversarial pass for security, concurrency, destructive paths, or external input. Resolve every required finding, then rerun affected verification.

## Accept the result

Do not accept “mostly complete,” “tests pass” without adequacy review, or a builder's self-report. Completion requires:

- all requested capabilities implemented or explicitly proven out of scope;
- public contract, implementation, tests, guides, and generated outputs aligned;
- no unresolved centralization, wrapper, dependency-reuse, test-discovery, lifecycle, security, or text-integrity finding;
- exact command evidence for every final gate.

Report what changed, what evidence proves it, exact test/gate results, and any genuine residual risk. Do not call an in-scope omission “future work.”
