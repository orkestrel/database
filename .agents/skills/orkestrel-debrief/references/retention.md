# Retire a campaign folder

Delete a campaign's working artifacts through this procedure. It fixes what the deletion
covers, the checks that close it, the go-ahead that authorizes it, and the commit message that
keeps it recoverable.

A debrief arrives at its Dispose step, after every finding has a
carrier. A campaign that accepts with no debrief arrives at acceptance, per
`.agents/orchestration.md` § Where campaign artifacts live. The procedure is the same through
either door.

Call the `.orkestrel/` folder the campaign folder, never a ledger. The word `ledger` names the
routing ledger and the carry ledger only.

## The gate order

Order is the whole of this rule: the checks close the prune, and the owner's go-ahead authorizes
it. Run the steps in this sequence.

1. Run the carry, promotion, measurement, and orientation checks that follow. Every one closes, or
   the prune stops there and the open item gets a carrier first.
2. Present the disposition to the owner: what the checks found, where each promotion landed, and
   what the deletion removes.
3. Delete only on the owner's explicit go-ahead. Never silently, and never as residue left for the
   next session to read as current.
4. Commit the deletion with the promotion record as its message.

Closed checks authorize nothing on their own, and a go-ahead taken over an open check deletes an
item nothing carries. Pruning is deletion, so it needs the same evidence as any other destructive
step.

## What the prune covers

Rule on every location in this table before deleting anything.

| Location                | What it holds                                                                                                                                              | What the prune does                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `.orkestrel/<package>/` | The campaign folder for a campaign about one package: each unit's brief and report, the audit verdicts, the executed instruments, the acceptance evidence. | Deleted in the prune commit.                                                                                       |
| `.orkestrel/campaign/`  | The shared campaign folder for a campaign spanning several packages: the wave's plan, its routing ledger, its verdicts.                                    | Deleted in the prune commit.                                                                                       |
| `tmp/units/`            | A native unit's `<unit>-brief.md` and `<unit>-report.md` pair.                                                                                             | Swept. The durable copy already sits in the campaign folder, so a pair missing there blocks the sweep.             |
| `tmp/<bench>/`          | A bench unit's brief, report, event stream, final answer, and any login log.                                                                               | Swept after the final gate evidence is recorded. Never committed.                                                  |
| `tmp/probe/`            | The runtime probes the campaign wrote.                                                                                                                     | Swept. A probe that settled a claim becomes a test before the prune, per `.claude/rules/quality.md` § Instruments. |
| `ROADMAP.md`            | The repository's sequenced plan of record, where it keeps one.                                                                                             | Kept. Strike the chunks the campaign closed and add the forward work it revealed.                                  |
| `PROPOSAL.md`           | A proposal for work nobody has ruled on yet.                                                                                                               | Deleted after the work lands or the proposal is refused. The ruling goes in the prune commit message.              |

A plan-of-record file is not campaign residue. `ROADMAP.md` outlives every prune and takes the
campaign's forward work; `PROPOSAL.md` is spent the moment its proposal is ruled on, and a spent
proposal left in the tree reads as live work.

## Sweep `tmp/` as a tree

Sweep the whole `tmp/` tree, not the set of folders this campaign created. A journal, a log, or a
brief left by an earlier session sits in the same directory, carries no date a reader checks, and
is read by the next campaign as its own.

- Name each file you find before deleting it. A file you cannot attribute to a closed campaign is
  an open item for the carry check rather than residue.
- Never sweep while a unit is live. `tmp/units/` and `tmp/<bench>/` hold the briefs and journals
  live lanes are reading, and the Orchestrator's own instruments belong in its scratchpad for this
  reason, per `.agents/orchestration.md` § Writing concurrency.
- Delete a probe from the source tree before its unit returns, per `.claude/rules/tests.md`. A
  leaked type probe is a placement-sweep failure rather than a retention question.

## The carry check

List every item the campaign folder leaves open: a defect, a measurement to re-take, a deferred
decision, a withdrawn claim, an unmet acceptance condition. Each ends the check with a carrier — a
commit that closed it, a live brief that owns it, or an explicit drop on the record. An item with
no carrier blocks the prune.

Read the register files for this — the plan, the readiness grade, the carry ledger, the triage —
rather than every brief and report in the folder.

## The promotion check

Rule on each remaining file by what it asserts.

- Product truth goes to the guide, where the parity gate reaches it.
- A process law goes to the rule or contract file that owns it, in the commit that states it.
- A decision goes to the commit message that made it, which is where it already sits.
- Everything else is process diary and prunes.

A section recording live state — adopter republish status, installed version tables, what a sibling
repository was doing that week — prunes with no promotion. It was stale when it was written, and
promoting it publishes the staleness.

## The measurement check

A number the guide carries out of the campaign folder carries the date it was taken. A measurement
whose date the folder does not record is re-taken or dropped, never copied.

## The orientation check

A cross-session orientation document — a handoff, a package-root narrative file, a session log — is
not a further category. It duplicates the guide for product truth and the contract for process
truth, it is gated by nothing, and it drifts. Dissolve it into the artifacts that own it and delete
it.

## The prune commit

Write the prune commit's message as the promotion record: what moved, and where each part landed.
That message is what makes the deletion recoverable in practice rather than only in principle. Git
history is the archive; the working tree is the workspace.

Name in one message the guide passages the campaign produced, the rule and contract files that took
its process laws, the measurements re-taken with their dates, and the campaign folder path the
commit removes.
