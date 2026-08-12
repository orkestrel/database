---
name: orkestrel-debrief
description: Look back at a long campaign to learn from its mistakes and successes and improve the agents, rules, skills, and processes that ran it. Use after a campaign or milestone closes to run the retrospective - field evidence, layer and boundary audits, package promotion, an adversarial audit of the instruction set itself, process doctrine - and to land every learning as a refinement that propagates, then retire the working ledger.
---

# Debrief a closed campaign

## Load authority

Read the current files in this order:

1. `AGENTS.md`.
2. Every applicable `.claude/rules/*.md`; the documentation and quality laws bind every
   ledger entry and every refinement this skill produces.
3. The references this round needs: [instruction-audit.md](references/instruction-audit.md)
   before auditing the agent/rule/skill/process layer;
   [field-testing.md](references/field-testing.md) before running or judging a live field
   pass of an agent-facing surface.
4. `guides/README.md`, the governing guides for what the campaign built, and `ROADMAP.md`.

The user's current instruction wins. The debrief judges the artifact and the process that
produced it; neither is exempt. Capture successes as deliberately as mistakes, and codify
a practice that worked so it repeats.

## The debrief laws

- **The campaign record is the primary source.** Dispatches, deviation reports, audit
  verdicts, gate outputs, commit messages, and live transcripts are evidence; recollection
  is not. Quote verbatim — a paraphrase cannot be re-verified later.
- **Use it before you judge it.** Where the campaign built something consumable — a
  package, an app, an agent-facing surface — drive it with representative real consumers
  before writing findings about it. For agent-facing surfaces, follow
  [field-testing.md](references/field-testing.md).
- **Every finding ends in exactly one bucket**: fix now; agent refinement; rule
  refinement; skill refinement or creation; process refinement (orchestration contract);
  package promotion; guide truth; roadmap; stays as-is with the reason; or dropped on the
  record with the refuting evidence. A finding with no bucket is an unfinished debrief.
- **Fixes are re-proven by the evidence class that found them.** A defect found in live
  use closes with live use; a process failure closes when the next campaign round runs
  the corrected process.
- **Portable versus resident.** Learnings reusable beyond the repository — process
  doctrine, role charters, rules, skills — land in the portable canon and propagate
  through the scaffold host inventory. Repository truth lands in the guide; forward work
  in `ROADMAP.md`. Nothing load-bearing stays only in the ledger.
- **The ledger is ephemeral.** Fold every surviving truth into its destination, then
  delete the folder on the owner's explicit go-ahead — never silently, never as residue.

## Run the round

1. **Scope and gather.** Name the campaign(s) under debrief. Assemble the record: unit
   ledger, deviations and recoveries, audit verdicts and their reconciliations, gate
   history, and any live transcripts. State what evidence exists and what must be
   produced fresh.
2. **Field evidence.** Drive what was built with real consumers where a consumable
   surface exists. Record every pass verbatim.
3. **Artifact audits.** Layer and boundary truth: does app code belong a layer down in
   src, does src carry application policy, does either duplicate a declared ecosystem
   primitive? Package promotion: what grew into a reusable mechanism that belongs in an
   existing package or justifies a new one — mapped dependency-first so promotion order
   is executable. Every row ends implement, repair, retain, or intentionally exclude,
   with evidence.
4. **Process retrospective.** Walk the campaign record for both failure and success:
   dispatches that deviated and why; recoveries that worked (codify the mechanism that
   saved them); estimates versus observed durations; audit rounds that caught real
   defects versus rounds that churned; anything the orchestrator absorbed that should
   have been dispatched or dispatched that it should have owned.
5. **Instruction-set audit.** Audit the agents, rules, skills, and orchestration
   contract themselves against the campaign record, using the adversarial method in
   [instruction-audit.md](references/instruction-audit.md). What confused an executor is
   a defect in the instruction, not the executor.
6. **Reconcile into the ledger.** Number the findings, attach verbatim evidence, bucket
   every one. Where two audit lanes disagree, rule each divergence on the record with
   the reason.
7. **Land the refinements.** Dispatch fix-now findings as bounded units under the
   repository's engine contract; make the canon edits (charters, rules, skills,
   orchestration contract) with the owner's direction where the root contract is
   touched; re-prove per the law above.
8. **Propagate.** Portable changes are made in the scaffold repository's host inventory,
   staged, gated, and pushed — editing one project's checkout propagates nothing. Verify
   the generated-workspace proofs stay green so new projects inherit the refined canon.
9. **Dispose.** Present the disposition map — finding table with carriers, the canon
   delta, what remains open — and delete the ledger only on the owner's explicit
   go-ahead.

## Verdict shape

Each round ends with one fixed report: the finding table (id, evidence pointer, bucket,
carrier), the canon delta (files created or changed, per layer: agents, rules, skills,
process, guide, roadmap), the re-proof evidence, and exactly one terminal line —
`DEBRIEF: FOLDED` when every finding has a carrier and the propagation is pushed, or
`DEBRIEF: OPEN` with the blocking items.
