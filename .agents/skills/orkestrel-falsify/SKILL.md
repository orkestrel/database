---
name: orkestrel-falsify
description: Run an adversarial audit round against work that already looks finished — write the subject as numbered falsifiable claims, dispatch independent auditors instructed to break them rather than confirm them, reconcile their evidence, and rule. Use before accepting a fix round, before a version bump or publication, when green gates are the only evidence a change works, when a defect has recurred across rounds, or whenever a review would otherwise read a diff and agree with it.
---

# Falsify

Green gates prove a suite ran. They prove nothing about the claim the work makes. This skill is for
the moment when everything passes and the work is still not known to be right.

## Load authority

1. `AGENTS.md`.
2. `.claude/rules/quality.md`, especially **Falsification** — the laws governing auditor behaviour.
   This skill prescribes the round; that section prescribes the conduct inside it. Do not restate it.
3. The governing guide/spec for the subject.
4. `references/brief.md` before writing a brief; `references/reconcile.md` before ruling.

## When a round is warranted

Run one when the work is finished and the evidence is weak in a specific way:

- gates are green and nothing has attacked the claim;
- a fix round is about to be accepted, especially one whose author reported success;
- a version is about to be bumped, packed, or published;
- the same defect class has now appeared in more than one round;
- a self-declared "sound, unchanged, no fix needed" verdict is load-bearing.

Do not run one for a typo, a mechanical rename, or work whose failure would be immediately visible.

A round also needs something new to attack. When the previous round's claims all held, nothing has
been added or repaired since, and the only motive is that an auditor could still imagine an attack,
there is no subject — closing is the correct action and the next subject is the deliverable.

## Write the brief

The brief is the instrument. A weak brief produces a confirming review no matter which auditor reads
it. Follow `references/brief.md`. What this skill adds beyond the conduct law:

- Every re-run is a **successor**, not a restatement. It carries what the previous round closed so
  nothing is re-reported, and it adds claims that attack **the previous round's own rulings**.
- The brief names what the round **decides**. An auditor that does not know the stakes calibrates to
  politeness.
- Unknowns are named as unknowns, with how the auditor reports back on them.

The claim form itself is the Falsification law's — read it there. The **verdict shape** below is this
skill's, because `.agents/orchestration.md` assigns it here; everything else about auditor conduct is the law's.

## Evidence, by subject type

The brief supplies the evidence its subject actually has. Requiring a diff for a subject that has no
diff is a rule the brief cannot satisfy.

| subject                                 | required evidence                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| a code change                           | the actual diff and the actual status output; omitting either is a dispatch deviation |
| a rendered or externally driven surface | the capture portfolio as primary, source as corroboration                             |
| a policy, design, or process proposal   | the proposal, the canon it must satisfy, and the record of what motivated it          |

**A subject can occupy more than one row; supply every row it occupies.** A ruling whose fixes
already landed as edits is both the third row and the first, and withholding the diff on the grounds
that the subject is "a proposal" leaves the auditor unable to check whether a fix changed anything
nobody claimed.

## Run the round

- **Verify every authority the brief references exists in the tree the auditor is rooted in.** A
  brief that points at a rule file, section, or guide the executor cannot find delivers nothing while
  looking like authority — and it fails silently, because an auditor does not report a heading it
  never saw. Check before dispatch; propagate the missing file rather than restating its contents in
  the brief. This is the reason restatement felt necessary, and it is the wrong cure.
- Run the **two-lane adversarial pass** on one identical brief: a subjective lane and an objective
  lane, each a fresh subagent with a clean context, blind to each other. Reconcile them yourself.
  `.agents/orchestration.md` owns lane definitions, engine assignment, and what happens when an
  engine is dark; do not restate them here.
- A round run with one lane is a deviation. Record it rather than glossing it. If an engine is
  unavailable, the remaining engine runs both lanes — it never drops one.
- **Pair every finder with an independent refuter when the round fans out past two lanes.** The
  refuter receives one slice's findings, never that finder's work, and is briefed to BREAK them
  rather than to re-audit the subject. It reproduces each stated vector itself and defaults to
  refuted when uncertain.
- Refute on any of six grounds, and name which: the vector does not reproduce; the behaviour is
  correct and documented; it is unreachable through the public API or a documented seam; it asks
  for new capability rather than naming a defect; it restates a finding an earlier round
  repaired; or its diagnosis is wrong — then CONFIRM with the correction.
- Only a survivor earns a fix unit. An unrefuted finding is a hypothesis. The two scope grounds,
  unreachable and new capability, are what keep a round from drifting into a redesign.
- **Give every auditor the means to run its attacks.** A lens that can only read returns derivations,
  and a derivation reads exactly like a verdict — it will confirm a claim that one probe would break.
- **Tell each auditor exactly where a probe may live, and verify that place works before you say it.**
  A test runner resolves only what its own configuration includes: a probe written outside every
  configured project is not discovered at all, and the run reports no test files rather than a result.
  Where the repository provides a probe project, use it and name that project in the brief;
  `.claude/rules/tests.md` governs what may live there. Where it does not, the reliable form is a file
  inside the canonical mirrored suite, run by explicit path. Either way the probe is deleted before the
  auditor returns, and promoted into a permanent test when it proves something worth keeping. Give each
  concurrent auditor a distinct filename that already satisfies the repository's test naming
  convention; never invent a prefix to dodge collisions, and never let two auditors claim one path. A
  probe left in the mirrored suite is discovered and fails a run nobody else caused.
- **Run auditors concurrently only when their writes cannot collide.** A lens that can execute
  still writes probes; give each a distinct path and forbid whole-project runs, or serialize the
  round. **This binds
  the orchestrator too:** a tree-wide gate run while a round is live sees the auditors' in-flight probes
  and reports a failure nobody caused. Wait for the round, or scope the command to paths no auditor
  owns. Never delete another executor's working file to make your own command pass.
- **Tell a lane when its own engine wrote the half it is auditing, and tell it to attack that half
  harder.** A fix round reviewed by the engine that wrote it is the case the round exists to avoid,
  and where the pass cannot avoid it, naming it is what recovers the round. A clean pass on its own
  engine's work is the least valuable result a lane can return.
- Supply the evidence the subject type requires, per the table above.
- Auditors edit no source and spawn nothing. Read-only describes the SUBJECT, never the lane's
  tools.
- **Read the lane's allowlist before writing its brief.** A lane with no write tool cannot create
  a probe; a lane with no exec tool cannot run one or read `git`. Naming either stops the unit on
  arrival over a detail the allowlist already settled.
- Where the lane cannot execute, run the probe yourself, record its control and its output, and
  supply that record as the lane's evidence. The Orchestrator produces, the lane rules. Never
  widen a lane's tools to fit a brief.
- Blind reports are **immutable**. Nothing an auditor returns is edited, merged, or revised — by
  anyone, including the auditor — once it has been returned.

## Verdict shape

Every auditor in every round returns exactly this, and nothing else. One shape makes rounds
comparable; a round that invents its own cannot be read against the last one.

1. **Numbered verdicts**, one per claim, in the brief's order. Exactly one of four values:

   | value           | meaning                                                                                | evidence                                                                                                                                                      |
   | --------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `CONFIRMED`     | attacked and it held                                                                   | as the Falsification law requires                                                                                                                             |
   | `BROKEN`        | falsified                                                                              | as the Falsification law requires — note it says _input, **state, or interleaving**_, so a concurrency claim is falsified by an interleaving, not by an input |
   | `UNRESOLVED`    | cannot be decided from the evidence available                                          | what would settle it                                                                                                                                          |
   | `NOT-EVIDENCED` | a claim about a rendered or externally driven surface the supplied capture cannot show | which capture is missing                                                                                                                                      |

   The first two rows defer; only the last two are this skill's, because the law does not name them.
   `BROKEN` and `UNRESOLVED` are **separate**: a claim nobody could decide has not been falsified,
   and it cannot supply the fields falsification requires. `NOT-EVIDENCED` is the token the
   `analyst` and `reviewer` charters already require; it is kept, not re-invented.

2. **Findings fitting no claim**, if any, each substantiated to the same standard as `BROKEN`.

3. **One terminal line**, and only one:

   ```text
   VERDICT: PASS — <m> of <m> confirmed, no findings outside the claims
   VERDICT: FAIL — <n> broken, <u> unresolved, <e> not-evidenced, <x> findings outside the claims
   ```

   **`PASS` requires all four to be true**: every claim `CONFIRMED`, nothing `UNRESOLVED`, nothing
   `NOT-EVIDENCED`, and no substantiated finding outside the claims. A single substantiated finding
   forces `FAIL` no matter how the numbered claims landed — otherwise a round can report a real
   defect and still emit the word that authorises the release.

No process diary. No summary of what was read.

## When a round comes back all-confirmed

The Falsification law governs this: the brief goes on trial, not the subject. Apply it, and if the
claims turn out to have been descriptive, the successor brief is where the sharper ones go.

## Reconcile and rule

Follow `references/reconcile.md`. The obligations that are not delegable:

- **Reproduce every sharp finding yourself** before acting on it. An auditor's finding is a
  hypothesis until the orchestrator has run it.
- **Build before you pack.** `npm pack` runs no build, so it ships whatever `dist/` is on disk. An
  auditor who packs an artifact to inspect it is reading the last build, not the current source, and
  will report deleted exports as still shipping. Run the package's build first, and say in the brief
  that the tarball was built from the commit under audit.
- **Check the subject before acting on a finding, not only the reasoning.** A brief that names attack
  vectors teaches the lane those vectors matter, and a lane can hand back the brief's own questions as
  the subject's claims — demanding coverage for a property the subject never documented. Grep the
  subject for the claim the finding rests on. Where it is not there, the finding is against the brief.
- **A disagreement between auditors is rarely a tie to average.** It is usually two correct answers
  to two different questions. Find the question each one answered.
- **Bound every finding**: state what is _not_ broken, and why the adjacent behaviour that looks the
  same is correct. An audit that reports everything is as useless as one that reports nothing.
- **Bound the fix before briefing it.** Establish what over-correcting would break, and include that
  in the fix brief as a constraint.
- Drop, on the record, any finding neither auditor can substantiate.

## Accept, or run it again

The threshold is **a `PASS` terminal line on a brief whose claims cover what the subject owns** —
every numbered claim `CONFIRMED` on evidence, nothing `UNRESOLVED`, nothing `NOT-EVIDENCED`, no
substantiated finding beside them. Never green gates, which prove only that a suite ran.

A round that finds something is a success, not a delay. The alternative is a consumer finding it
after publication, when the version number is already spent. But an unsubstantiated attack is not a
finding, and the supply of imaginable ones never runs out: a round is not re-run because an auditor
can still think of one. A substantiated finding against something no claim names is real and forces
`FAIL`; an unsubstantiated one is a claim for the successor brief. The escalation law in
`.claude/rules/quality.md` governs a subject that keeps producing findings at the same seam — after
enough of them the ruling owed is on the design, not on the next defect.

When a fix round follows, its auditor must be an engine that did not write it, and the next round's
brief is the successor of this one.
