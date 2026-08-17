# Auditing the instruction set

The method for judging the agents, rules, skills, and orchestration contract against a
campaign's record. Proven across two debrief rounds; the instruction layer is code — it
gets the same adversarial, evidence-first treatment as any surface.

## Two blind passes, one brief

Run a subjective lane and an objective lane on the SAME brief, in parallel, neither
seeing the other's answer before both return:

- **Subjective** (design-fit engine): coherence of the role model, charter voice, whether
  each role's job is one job, whether the skill family reads as one system.
- The subjective lenses, so the lane can state its coverage: role-job singularity;
  charter voice against dispatched usage; lane-swap residue; bridge minimalism;
  vocabulary drift across mirrored files; skill-family seams.
- **Objective** (correctness engine): evidence-only sweeps of the actual files and the
  campaign record — the lanes below.

Each lane returns numbered findings, most severe first, and exactly one terminal line:
`INSTRAUDIT <LANE>: <n> findings`.

Reconcile into rulings; every divergence gets a ruled row with the reason. Convergent
findings adopt without contest; a finding neither lane can substantiate dies on the
record.

## The objective lanes

- **Duplication diff.** Whole-line and obligation-level comparison across charters, rules,
  and skills. A charter that restates a rule drifts from it; a rule stated twice has two
  owners.
- **Mechanical-equivalence groups.** Cluster roles by frontmatter (tools, model, effort,
  mode). Two roles in one group are either genuinely distinct by context binding — or a
  duplicate.
- **Charter-versus-usage drift.** For each role, compare the charter's promises against
  how the campaign actually dispatched it: unused powers, exercised powers the charter
  never granted, deviation reports the charter's wording caused.
- **Promise-versus-tooling gaps.** A charter that promises verification it has no tool to
  perform (a registry check with no network, a capture claim with no browser) either
  gains the bounded tool or states plainly that the evidence comes supplied.
- **Roster completeness on both axes.** The role set spans model agents (engine bridges
  and pins) and task agents (job-pinned lanes with their context preset). Check each axis
  for holes against the campaign's actual work classes: implementation (mechanical,
  app-layer, judgment-bearing per engine), evidence (research, reconnaissance,
  conformance, gates, ecosystem), design, review, distillation. A work class the
  campaign routed awkwardly — absorbed by the orchestrator, forced onto the wrong tier,
  or dead when a bench was dark — names a missing or mischartered role.

## Refinement classes

Findings land as one of:

- **Role create / restore / retire.** Retirement requires more than duplication evidence:
  when a charter merely restates rules, the first remedy is a thin reference-BINDING
  charter (the role keeps its context preset and its dispatch ergonomics); retire only
  when the job itself is not distinct. Record the lesson of the reversed retirement: a
  role that was "mechanically identical" by frontmatter still carried a distinct context
  bundle worth keeping.
- **Rule additions, one law each.** A campaign lesson that generalizes becomes one law in
  the owning rule file — never a new file per lesson, never a paragraph where a sentence
  binds.
- **Root-reference trims.** Restatement of root laws in leaf files shrinks to a
  reference; the root stays the single owner.
- **Charter refinements.** Wording that caused a deviation is a defect; fix the charter,
  not the executor.
- **Skill refinements / creation.** A workflow the campaign repeated twice is a skill; a
  skill step the campaign always skipped or always overrode is wrong.
- **Orchestration-contract refinements.** Laws the orchestrator learned (cap sizing,
  probe-first, journal-first, verdict shapes, launch ownership) land in the operating
  contract, mirrored across providers.

## Three questions every round asks

- **Which findings came from falsification rather than diff reading**, and is the brief
  shape that produced them doctrine yet? Route to the Falsification law in
  `.claude/rules/quality.md`.
- **Which shipped gaps were accepted as untestable**, and was each one genuinely
  irreducible or a missing seam? Route to the missing-seam law in
  `.claude/rules/tests.md`.
- **Which units could not be re-run from their own recorded brief**, and why? A unit whose
  instruction never became a file, or whose correction left its brief behind, is a defect in
  the dispatch. Route to the brief-and-report laws in the operating contract.

## Mirror discipline

Every roster or contract change lands on all provider surfaces in the same round: the
Claude charters, the Codex mirrors, and both operating-contract role tables. An
unmirrored refinement is a new drift seeded on purpose.
