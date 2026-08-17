# Reconciling a round and ruling on it

Two auditors return. Neither accepts; the orchestrator does. This is where a round becomes a
decision, and it is not delegable.

## Reproduce before you act

The rule beneath this whole section: **run it rather than argue it.** Every judgement below is
cheap once the probe exists and unreliable until it does.

An auditor's finding is a **hypothesis** until the orchestrator has run it. Reproduce every sharp
claim by hand, against the built output, before it enters a fix brief.

**Build the hostile input outside the `try`.** A probe that wraps construction and invocation in one
catch cannot distinguish _the subject threw_ from _my harness threw_ — a missing import, a wrong
arity, a `require` in an ESM context all surface as the finding you were hoping to see. Construct
first, let harness failures crash loudly, and only guard the call under test.

Reproduction produces three outcomes, and all three matter:

- the finding **confirms** and is often **wider** than reported — the reproduction reaches doors the
  auditor did not try;
- the finding **confirms but is bounded smaller** — real, and not where the auditor thought;
- the finding **evaporates**, because the auditor's input could not exercise what it claimed to test.

Separate a dead finding from a dead vector before evaporating anything. A reported vector the
compiler rejects refutes the vector alone; re-derive one the types admit, and record which vector
was actually tested.

The same reproduction discipline applies to your own probes. A probe whose input cannot reach the
code under test reports a pass that means nothing, and it will read exactly like a real pass.

## A disagreement is rarely a tie

When two auditors return opposite verdicts on one claim, do not average them and do not prefer the
engine you trust more. **Reproduce first** — running the disagreement settles most of them outright,
and it is the only method that can also find what neither auditor saw. Then find the question each
one answered. The common shapes:

- **Both right about different objects.** One tested a case the other did not construct. This is a
  `SPLIT-CLAIM`: the claim was a universal that carried more than one subject. It is **not** a third
  verdict value — one falsifying input makes a universal claim `BROKEN`, and succeeding on a
  different object does not undo that. Split it, keep the original `BROKEN` if any subclaim is
  broken, and carry the split into the successor brief.
- **Both right about different halves of one claim number.** Same resolution: the claim number was
  carrying two claims. Split and renumber.
- **One right on the mechanism, the other on the criterion.** Take both. The reconciled ruling is
  frequently neither proposal, and better than either, because each supplied a constraint the other
  violated.
- **The consequence disproves the premise.** An argument that an input class is unreachable is
  answered by running it and showing what the reachable consequence is.

Record which engine was right and on what. A round whose disagreements are smoothed over teaches
nothing to the next one.

## Evidence custody

Blind reports are immutable, and their independence is a property of the record, not of anyone's
memory. A reader six months out must be able to tell an unbiased blind verdict from one produced
after an auditor saw its counterpart's evidence — otherwise the whole value of running blind is
unverifiable after the fact.

Two rules, both enforceable:

1. **A returned verdict is never edited** — not by the auditor, not by the orchestrator.
2. **Anything an auditor says after seeing another's report is a separate file beside that verdict**,
   under `.orkestrel/<package>/`, named for the unit and the exposure, recording what was shown and
   to whom. It is a durable record, not a journal, so it survives the campaign sweep.

That exchange is a **fallback, not a phase.** Reproduction comes first and settles most
disagreements. Reach for an exchange only when a specific factual question survives reproduction,
scope it to that question, initiate it yourself, and run it once — a second exchange is negotiation.

**Ask the auditor to attack the other's evidence on that question. Never ask it to resolve the
disagreement, reconsider its position, or say whether the other changed its mind.** Constraining
when, who, scope and frequency does nothing about convergence if the instruction itself invites it,
and "does their evidence change your claim?" is the convergence prompt in its purest form.

## Bound the finding

State what is **not** broken, and why the adjacent behaviour that looks identical is correct. A
finding without a boundary is an alarm, and alarms get discounted wholesale — including the true
ones next to them.

Two boundaries earn their keep:

- **Credit what the round got right.** If the hostile inputs adjacent to the hole are correctly
  contained, say so and list them. It sharpens the finding to a point instead of an area.
- **Show where the same-looking answer is correct.** When several exports answer a hostile input the
  same way and only one is wrong, name what makes the difference — usually that the correct ones
  agree with a documented view, and the wrong one reads on an axis it then ignores.

## Bound the fix before briefing it

Establish what over-correcting would break, and put it in the fix brief as a constraint. Both ends
are usually wrong:

- **too little** — a patch to the one function, leaving the package holding two standards for the
  same thing, which is the inconsistency that produced the finding;
- **too much** — adopting the strictest sibling's rule verbatim, breaking a legitimate caller
  pattern, and tripping "no refusal was widened into a regression" in the next round.

Find the rule that fits both. It is usually about **agreement** rather than about categories — what
a reader reads, its answer must carry — and it dissolves the special cases rather than enumerating
them.

Measure a proposed fix before adopting it; it is itself a claim. Run it against the set it must
not break, including every case an earlier round pinned. Where it fails that set, document the
limit on the helper that owns it and pin the limit with a test that names it as one. A heuristic
that trades one wrong answer for another fails quietly; a stated boundary does not.

Where the choice is genuinely open, it is a design judgement with a subjective and an objective
half, and it goes to a blind design pass before code. Ruling it unilaterally is how a fix round
becomes the next audit's finding.

## Certifying an instrument

The control-population law in `.claude/rules/quality.md` binds here without restatement. What it
leaves this round is the procedure.

When a round certifies an instrument — a pin, an identity check, a generated sweep — the controls
are usually drawn from whatever the instrument obviously covers, because that is where the examples
are easiest to construct. That sampling proves discrimination _within_ the population and is
routinely reported as proof the instrument works.

So before running controls, write down the instrument's **membership rule** in one sentence, then
ask what the rule excludes. Draw at least one control from there. Two shapes have already cost a
round each:

- an AST comparison whose controls were all drawn from the literal classes present in the bodies it
  guarded, blind to the classes absent from them;
- a call-closure pin whose controls were all body-reachable functions, green for a function reached
  only through a parameter default.

Then write the two sentences that matter: what the controls established, and what they did not. The
second sentence is the one that gets skipped, and skipping it is how an instrument's credibility
outruns its evidence.

## Ruling

- Every retained finding names the fix-brief item that carries it. A finding with no carrier is a
  dropped finding; walk the list once and check.
- Drop, **on the record**, anything neither auditor can substantiate against the evidence.
- Promote anything that must outlive the round into a durable artifact before the working files are
  swept. What lives only in a scratch file did not survive.
- The fix round's auditor is an engine that did not write it.
- The next round's brief is this round's successor.

## The threshold

Accept when the brief's claims are **satisfied on evidence** — the `PASS` terminal line the skill
defines, against a claim set that covers what the subject owns. Not green gates.

A round that finds something is the process working. A round that finds nothing because nobody tried
is the failure; a round re-run because an attack can still be imagined never ends. Bound the claim
set at the brief, rule on what it returned, and close.
