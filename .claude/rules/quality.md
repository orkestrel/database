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

- Research when the user asks for it, when comparing an upstream, protocol, or legacy implementation, or when current external behavior materially affects design.
- Use current primary sources for external capabilities, and the exact installed declarations and guides for dependencies. Separate verified fact from inference.
- Read authoritative types and named decision-bearing implementation files first-hand. Delegate bulk supporting context, never the owning design decision.
- Treat existing code, tests, `old/`, branches, and copied projects as evidence, not authority.
- Build a capability/defect matrix before a broad API or production-readiness change. Every row ends as implement, repair, retain, or intentionally exclude with evidence.
- Fix that matrix when the change starts. It is the definition of done, and the change closes when every row closes.
- Never end a row as "hardened further." Replace any evaluative phrase with the concrete condition that closes the row.
- Record a finding outside the matrix against the row that owns it, for the next matrix. Do not reopen this one.

## Run it, don't argue it

A question a probe can settle is settled by the probe, whether or not anyone has disputed it. Reasoning decides what to run and what the result means. It does not replace the run.

This is a habit for your own work first, and a rule about disagreements second. Most unverified beliefs are never challenged by anyone — they are simply built on.

- Test your own assumptions before you rely on them. You do not need a disagreement to justify a probe. If you are about to depend on what a function returns, what a config resolves to, what a flag does, or whether a path is even reached, run it and find out.
- Treat a long deliberation about behaviour as the signal to stop and run something. Deliberation that a ten-line probe would have ended is the most expensive habit in this process, and it is invisible because it feels like rigour.
- Verify a belief before stating it, or label it as unverified. An unverified assertion put into context becomes a fact for everything downstream, including other agents, and correcting it later costs more than the check would have.
- Hold a claim you issue to the standard you hold a claim you receive. Nothing downstream re-checks an instruction, so an unverified fact inside one becomes the premise of every task built on it. Auditing every report you receive while exempting every brief you write is the common form of this failure.
- Prefer the check over the chain of reasoning whenever the check is cheap. Reading the installed declaration, running one line, or counting the call sites beats three paragraphs inferring the same thing, and it produces evidence you can hand to someone else.
- Write the probe before the argument gets long. The moment a claim about behaviour is disputed — between engines, between a report and a rule, or in your own head — stop and run it. Get the smallest real input through the real code and read the real output.
- Bound the search before starting it, and put the bound in the brief. Name the benchmark, the population, or the row that ends it. An investigation with no stated stopping condition runs until attention runs out. This includes the case where the honest answer is that the limit is inherent and belongs in documentation rather than in code.
- Treat a negative probe as evidence about the probe until its input is shown to reach the code under test. A pass proves nothing if the vector never arrived. Instrument the path, assert an observable side effect, or drive it through a door you can see.
- When a report names a defect and your reproduction comes back clean, assume first that your vector was weaker than theirs, and go get their exact vector. Treating a failed reproduction as a disproof is the most common way a true finding is lost.
- Reproduce a reported defect's cause before instructing a fix from it. A real symptom can carry a wrong diagnosis, and a fix aimed at the stated cause edits the wrong file while the defect survives.
- Do not read a result into a tool's failure to find your probe. "No tests found", an empty match, a skipped file, a runner that resolved nothing — these report on the harness, not the subject. Confirm the probe was collected and executed first.
- Prefer an observation over a derivation, including your own. When a measurement and an argument disagree, the argument is wrong until the measurement is shown to be broken.
- Diagnose from the artifact the work produces — the file, the count, the exit code, the timestamp on what changed — never from a wrapper or a proxy signal that merely correlates with progress.
- Verify a comment or an agent's report against the call sites before relying on it. A code comment is not evidence. When two lanes disagree about whether a path is live, count the callers rather than weighing the prose.
- What a round proves is what it ran. A conclusion carried from one door to another is a hypothesis at the second door. Re-run it there.

## Falsification

A review that reads a diff finds what the diff shows. A review that tries to break named claims finds what the diff hides. Code that has passed diff review several times can still carry a defect nobody has tried to trigger.

### Writing the claims

- State the subject as a numbered list of the claims the work makes, never as "review this diff." Each claim is falsifiable: a property some concrete input, state, or interleaving could show false.
- Instruct the auditor to attempt refutation, not confirmation. A claim it cannot break is CONFIRMED with the evidence that convinced it. A claim it breaks is BROKEN with the exact failing input, state, or interleaving, plus the smallest correct fix.
- Derive claims from what the change asserts under adverse conditions: cancellation, restart, concurrency, partial failure, hostile input, resource exhaustion, and the orderings a happy path never reaches.
- Read the installed declaration or implementation of every substrate a claim depends on. A claim about `stop()` is unfalsifiable until you know what `stop()` does when the status is not the one the caller assumed.

### Instruments

- An instrument is not evidence until it has failed. Pair every probe, comparison, or matrix with a negative control that must report failure, run under the same conditions. An identity check whose control reports "same" has measured nothing.
- Draw the negative control from outside the population the instrument covers. Name the instrument's membership rule first, then pick a control that rule excludes. A control sampled from constructs the instrument already handles proves only that it discriminates among those constructs, and says nothing about the class it silently cannot reach.
- State an instrument's coverage beside its result. A conclusion inherits the instrument's scope, not the question's. An unstated coverage claim is read as complete, and it never is. A search proves something about the paths it walked, so name them.
- Match the instrument to the question. A text search reports on text, so a claim about declarations, call sites, or structure needs the compiler or a parser instead. A pattern written for one spelling of a construct reports on that spelling alone. A path check answers relative to the directory it runs from, so resolve the inputs against their own base before reading a miss as a finding.
- Report a question unanswered rather than answering it with a weaker instrument. A fallback that measures something adjacent returns a confident wrong answer, and nothing downstream can tell that answer from the real one — searching commit messages for a release when the question is where a version changed will match some release, just not the one asked about. Name the substitute and what it actually measures, or say the question is open.
- State what the controls established and what they did not. An instrument certified only from the inside is trusted exactly where it has never been tested.
- Treat a gap between what an instrument says it checks and what it actually matches as a defect in the instrument, not as a documented limit. A recorded blind spot buys trust only when everything outside it is genuinely covered.
- Measure the product, not the harness. A recorded baseline that counts something about its own fixture is not evidence about the shipped surface, however often a guide quotes it.
- Adopt an instrument that settled a claim as a test before accepting the work it settled. The probe that proved a fix, carrying the control that proved the probe, is that fix's regression guard. A verification that runs once is a rehearsal, not a gate.

### Rounds and verdicts

- Treat an all-confirmed round as a legitimate result, and put the brief on trial rather than the subject. Re-read the claims and ask whether any could have been falsified by evidence the round actually had. If none could, the claims were descriptive and the round proved nothing — sharpen them and re-run. If they could have been and were not, the pass stands.
- Name the claims you could not break either way, so the next round knows what has already been attacked.
- Never tell an auditor that a clean round means it did not try. That instructs it to manufacture a finding, and a manufactured finding costs a fix unit, an argument, and the credibility of the true findings beside it.
- Treat a repaired claim as a new claim, not a settled one. Re-ask it at every entry point that reaches the same rule, not only the door the defect arrived through. The engine that wrote the fix is least able to see this, because re-verifying where the fix is feels like verifying the fix.
- Let reachability bound the fix. A defect reachable through the package's own shipped code or a documented extension seam falsifies its claim and is repaired now.
- Document the obligation instead when a defect is reachable only through a hypothetical foreign implementation of a contract this package publishes. State it on the interface that owns it and prove the documentation. Do not build coordination machinery against a requirement nobody wrote down. Attacks are unlimited; reachable ones are not, and only the reachable set is a work list.
- **Three rounds at one seam is the budget.** Repeated rounds against one seam are evidence about the design, not evidence of diligence. At the third round the next unit is a ruling — on the threat model, the mechanism, or the boundary — taken with the same adversarial pass a design gets, not a fourth repair.
- Write the round count down when the seam opens, so it is a fact rather than a feeling. A seam that has consumed more rounds than the rest of the matrix combined has already answered the question.
- Give every behavioural audit the means to run its attacks. An auditor that cannot execute cannot falsify a behavioural claim: it returns derivations, and a derivation reads exactly like a verdict while being a different thing — it will confirm a claim one probe would break. Treat a report with no executed evidence as a review of the source, and label it as such.

## Ecosystem reuse

The root laws on inspecting declared `@orkestrel/*` capabilities, reusing a matching primitive, and updating every consumer without shims bind here without restatement. This file adds the judgment calls:

- Prove the semantic difference before keeping a local variant. Similar names are not evidence of different behavior.
- Treat downstream friction as valid evidence of a reusable upstream defect, not as automatic proof. Fix the lowest package that owns the general mechanism and keep product policy downstream.
- Never re-export a dependency's symbol to soften a consumer's import.

## Production hardening

- Translate "enterprise-grade" or "production-ready" into an explicit risk and seam matrix covering applicable inputs, states, failures, cleanup, cancellation, concurrency, resource ownership, hostile boundaries, environment isolation, serialization and restore, and package consumption.
- Grade that matrix on coverage, not optimization: whether every applicable seam exists, works, and stays proven. Do not grade on how many further interleavings can be invented against the one seam already proven. A surface polished past its row buys less than the next uncovered seam would have.
- Test observable invariants at each applicable seam with real implementations.
- Use dedicated real-service projects for external model or service behavior. Require readiness and tune each request to the smallest robust proof.
- Audit test discovery, counts, skipped and todo tests, cleanup, and assertion adequacy. Passing discovered tests alone is insufficient.
- Inspect public exports, declarations, supported runtime targets, and generated outputs.
- Treat a claim that a surface works with an external client as unproven until one representative real client of that class has driven it end to end. Protocol tests prove the protocol, not the integration.
- Add an independent adversarial review for security, destructive paths, concurrency, protocols, or untrusted external input.

## Completion

The root completion law — finish every in-scope capability now, leave no TODO, deferral, or hidden follow-up, and run the applicable repository skill for comprehensive work — binds here without restatement. This file adds three obligations:

- Perform a final centralization, wrapper, test-helper, and text-integrity sweep after implementation and before gates.
- Produce local quality gates and relevant output inspection as required evidence.
- Stop once the enumerated scope is closed and those gates are green. Stopping there is correct, and the next scope is the deliverable. A further pass over the same surface requires a new instruction from the user, not an auditor's remaining appetite. Depth is owed to what the scope names, not to what an engine can still imagine about it.
