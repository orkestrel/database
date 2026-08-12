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
3. **Establish the intended contract.** Build a capability/defect matrix. Separate verified fact from inference. Mark each row implement, repair, retain, or exclude with a reason. The matrix is fixed at this step and is the campaign's definition of done: every later step serves a row, and work that serves no row belongs to the next campaign. The row set is fixed; the planned work that closes it is not. Re-baseline that work at each phase boundary per `.agents/orchestration.md`, which owns the step and its boundary with rescoping.
4. **Design types first.** Update guide/spec intent and `*/types.ts` before implementation, under the root design laws. A contract that needs a compatibility shim is the wrong contract.
5. **Implement completely.** Finish every in-scope branch and reuse the exact installed Orkestrel primitives whose semantics match. The root completion law decides what may not be left behind.
6. **Prove each defect before repairing it.** A repair begins with a test that fails for that defect: record the exact command and its failing count before the fix and the same command's passing count after. A repair with no red-then-green record is unproven.
7. **Consolidate.** Run the complete centralization and wrapper sweep. Update all call sites to the real symbol rather than leaving aliases or 1:1 delegates.
8. **Challenge seams.** Add deterministic tests for invariants, boundaries, failures, lifecycle, cleanup, cancellation, concurrency, hostile input, and resource pressure as applicable, under the test rules' real-implementation law.
9. **Use live services deliberately.** Put real external services/models in their dedicated project, require readiness, and make each request minimally sufficient, robust, and behaviorally meaningful. When the claim is that a foreign client can use this package, drive one representative real client end to end.
10. **Document the final behavior.** Update the governing guide, examples, method tables, limitations, and parity coverage. Document architectural limits honestly.
11. **Audit completion.** Inspect test discovery, `.todo`/`.skip`/conditional skip use, source/test helper duplication, exports, environment isolation, unexpected text corruption, and the entire diff.
12. **Verify.** Run the repository-prescribed gates in order and inspect the generated outputs relevant to the request.
13. **Review independently, and never by the author.** When orchestration is available, run the two-lane adversarial pass — subjective design fit and objective correctness — plus a mechanical checker, per `.agents/orchestration.md`. Add a dedicated adversarial round for security, concurrency, destructive paths, or external input. A unit's auditor is an engine that did not write it; same-engine re-review returns the author's own blind spot. Resolve every required finding, then rerun affected verification.

## Accept the result

Do not accept “mostly complete,” “tests pass” without adequacy review, or a builder's self-report. Completion requires:

- all requested capabilities implemented or explicitly proven out of scope;
- red-then-green evidence for every repaired defect;
- public contract, implementation, tests, guides, and generated outputs aligned;
- no unresolved centralization, wrapper, dependency-reuse, test-discovery, lifecycle, security, or text-integrity finding;
- exact command evidence for every final gate.

Completion is those conditions met, not the absence of anything further to find. When every row is closed and the gates are green, stopping is the correct action and the next campaign is the deliverable; a further pass over the same surface is a new instruction from the user, not a finding.

Report what changed, what evidence proves it, exact test/gate results, and any genuine residual risk. Do not call an in-scope omission “future work.”
