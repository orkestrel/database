# Writing the claims brief

The brief decides the round. An auditor reads it faithfully, so a claim too vague to attack
returns a confirmation that proves nothing. Write every claim sharply enough to be broken.

## Anatomy

**Subject.** The whole chain, not the last commit. A fix round's defect usually lives in what an
earlier round assumed, so an audit scoped to the newest diff cannot see it. State the tip, the
branch, and the chain of rounds with one line each on what each claimed to close.

**What the round decides.** Say it plainly — "this decides whether the package is bumped and
consumed downstream", "this decides whether the fix is accepted". An auditor that does not know the
stakes calibrates to politeness, and politeness confirms.

**Already established — do not re-run.** List what the orchestrator has already verified, so effort
goes somewhere new and settled findings are not re-reported as fresh. State that these were verified
by the orchestrator directly rather than taken from a writer's report; an auditor that suspects the
established list is hearsay will re-derive all of it.

**Review evidence.** The actual diff and the actual status output, by path. Omitting either is a
dispatch deviation. For any claim about a rendered or externally driven surface, the capture is the
evidence and source is corroboration.

**Numbered falsifiable claims.** Each is a property some concrete input, state, or interleaving
could show false. Assign the primary lane where auditors differ in strength, but do not let an
auditor skip a claim because it assumes the other covers it better. The claim set is the round's
scope: write it to cover what the subject owns, then hold it closed. An attack the round invents
against something no claim names enters the verdict only when it is substantiated to the `BROKEN`
standard; otherwise it is a claim for the successor brief, not a finding.

**Unknowns, named as unknowns.** What the orchestrator does not know that the round needs, and how
the auditor reports back on it. A brief that cannot be fully specified says so; the alternative is
an executor inventing an answer and building on it silently.

**The threshold.** State that a finding is worth more than a clean pass, and why: the alternative is
a consumer finding it after publication, when the version is already spent.

## The successor rule

A re-run **amends**; it never restates. Rewriting a brief from scratch loses the shape of what has
already been attacked, and the round re-derives it at full cost.

A successor brief:

- **carries the chain forward** with the new round added to the table;
- **moves the closed findings into "already established"** so they are not re-reported;
- **states what changed in the brief itself**, so a reader can see which claims are new;
- **adds claims that attack the previous round's own rulings.**

Attack the previous round's rulings first. A fix round makes _decisions_ — that some input is
refused rather than carried, that some widening is deliberate, that some site is sound and needs no
change. Those rulings are the freshest and least-examined surface in the package, and the engine
that made them is least able to see their consequences. Write a claim for each one. Expect a
repair to carry the next defect; a round that finds them is converging, not failing.

## Claims that repeatedly find things

- **"The containment has no remaining door."** Require the auditor to enumerate the surface itself
  rather than trust any registry, table, or sweep the writer produced.
- **"No refusal was widened into a regression."** Every hardening round risks over-correcting. Ask
  which legitimate caller pattern broke, and require it to be named.
- **"The instruments bind."** Attack the instrument's _rule_, not its output: name a change it would
  not catch. An instrument nobody has tried to evade is not evidence.
- **"No instrument is vacuous."** Ask for a control that cannot produce its failing verdict. If a
  previous round shipped one, say so and name it — a round told a tautology already shipped here
  looks harder than one told to check generally.
- **"The guide is true."** Not plausible — true. Ask specifically whether a false universal has been
  replaced by an **unfalsifiable** one, which is worse, because it reads as rigour.
- **"The package is coherent as a whole. Would you ship this?"** The only claim that catches
  accumulated damage no single diff shows.
- **"The self-declared sound-and-unchanged verdicts are sound."** A writer's table saying a site
  needed no change is a claim like any other, made by the party least able to test it. Require the
  auditor to pick the ones it considers most likely wrong and actually attack them, and say how many.

## Instructions that change auditor behaviour

- _"CONFIRMED requires naming the attack you tried that failed."_ — the single most effective
  sentence, because it converts a confirmation from an opinion into a report of work done.
- _"A claim you cannot decide is UNRESOLVED, not CONFIRMED — say what would settle it."_
- _"Assume this chain has one more."_ — naming the prior rounds and which of them a defect the
  previous round believed closed provoked.
- _"Do not hedge toward an imagined consensus."_ — when auditors run blind, each will otherwise
  soften toward what it guesses the other said.

Do **not** write _"an audit returning only confirmations has not tried."_ It reads as pressure to
produce a finding, and an auditor that manufactures one to satisfy the brief has corrupted the round
in the more expensive direction — a false finding costs a fix unit, an argument, and the credibility
of the true findings beside it. The adequacy of an all-confirmed round is tested afterwards, against
the brief, by the orchestrator.

## What not to put in a brief

- Laws already binding from `AGENTS.md` and the rule files. Reference them; restating invites drift
  between the copy and the original.
- Any hint of what the other auditor is finding, or has found.
- Your own hypothesis about where the defect is, beyond what the claims state. An auditor handed a
  suspect investigates the suspect and stops.
