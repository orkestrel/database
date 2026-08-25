# Auditing the instruction set

The method for judging the agents, rules, skills, and orchestration contract against a
campaign's record. The instruction layer is code — it gets the same adversarial,
evidence-first treatment as any surface.

## Blind passes, one brief

Run the subjective lane and the objective lane on the SAME brief, in parallel, neither
seeing the other's answer before both return. `reviewer` holds the subjective lane and
`analyst` holds the objective lane.

Each lane returns numbered findings, most severe first, and exactly one terminal line:
`INSTRAUDIT <LANE>: <n> findings`. Each charter defaults to the `orkestrel-falsify`
verdict shape and takes a different shape the dispatch names, so name `orkestrel-debrief`
in the dispatch and this shape binds.

Point each lane's brief at its own section rather than copying that section's lens list
into the brief. A copied list drops a lens silently, and the lane that lost it reports
full coverage.

Reconcile into rulings; every divergence gets a ruled row with the reason. Convergent
findings adopt without contest; a finding neither lane can substantiate dies on the
record.

## The subjective lens list

Held by `reviewer`. It judges coherence of the role model, charter voice, whether each
role's job is one job, and whether the skill family reads as one system. This section is
the lens list's only normative home, and the lane states its coverage against it.

- **Role-job singularity.** Is each charter's work cohesive? A charter describing bundled
  jobs is either a role to split or a bundle no dispatch sends whole.
- **Charter voice against dispatched usage.** Read each charter the way an executor reads
  it mid-task, then compare against how the campaign actually dispatched that role.
  Wording that produced a deviation report is a defect in the charter.
- **Lane-swap residue.** A role holds the other lane when a bench is dark. Check that each
  charter's wording survives the swap: a charter that assumes its default perspective
  everywhere outside the swap clause cannot be dispatched into the other lane, and a round
  run under a swap that reads like the default lane's output is the residue.
- **Bridge minimalism.** A provider bridge loads one canonical workflow and adds nothing.
  Any instruction beyond the load is a competing instruction.
- **Vocabulary drift across mirrored files.** The same concept takes the same term across
  the Claude and Codex mirrors and each operating contract's role table.
- **Skill-family seams.** Do the skills read as one system: the naming axis, the
  load-authority order, the reference depth, and the boundary each draws with the
  contract.

## The objective lens list

Held by `analyst`. It runs evidence-only sweeps of the actual files and the campaign
record. This section is the lens list's only normative home, and the lane states its coverage
against it.

- **Duplication diff.** Whole-line and obligation-level comparison across charters, rules,
  and skills. A charter that restates a rule drifts from it; a rule restated elsewhere has
  more than one owner.
- **Mechanical-equivalence groups.** Cluster roles by frontmatter (tools, model, effort,
  mode). Roles in one group are either genuinely distinct by context binding — or
  duplicates.
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

## The questions every round asks

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
