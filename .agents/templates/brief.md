# Dispatch brief template

Copy this file for each dispatch and fill every row. Then run
`.agents/orchestration.md` § "Check the brief before you send it" against what you filled, and save
the filled copy and the returned report under the names § "Every dispatch is a file before it is a
launch" fixes.

Replace every placeholder written in upper snake case with a concrete value. Retitle the filled
copy `# Unit UNIT_ID — SHORT_SUBJECT`. Delete each italic reminder as you fill the row it sits
under, and leave no row blank: fill a row you cannot close with a named unknown label, and
describe that label under § Unknowns with how the unit reports back on it.

## Role and engine

ROLE_NAME on ENGINE_NAME, reached as TRANSPORT.

_Name the executor that opens this brief — a native subagent, a bench engine inside its own CLI, or a
bridge driver — and write every later section for that reader._

## Objective

ONE_OUTCOME.

_State one outcome. Give a small unrelated obligation its own unit._

## Context

**Evidence.** PASTED_COMMANDS_AND_OUTPUT

_Paste the command and its output behind every factual claim: paths, counts, registrations, file
existence. Name the scope each search covered, and check each fact against the code rather than
against another artifact that states it._

**Law.** `AGENTS.md`, RULE_FILES, SKILL_NAME and the references it requires, GUIDE_OR_SPEC.

_Name each applicable rule file, the dispatch-named skill and its required references, and the
governing guide or spec. Write `none` in a slot that is genuinely empty rather than dropping the
slot._

**Host.** SHELL, WORKING_PATH, NETWORK_AND_SANDBOX_LIMITS.

_Name the shell, the working path, and the sandbox, network, and approval limits the unit's commands
run under._

**Measurements.** MEASURED_FACTS_AND_THE_CONDITIONS_THEY_WERE_TAKEN_UNDER.

_Take each measurement under the conditions the unit runs in, or have the unit take it before doing
anything else._

**Control identifiers.** CONTROL_LABELS.

_Keep this brief's control labels inside this brief, and state that a test is named for what it
proves rather than for the control that specified it._

**Standing conditions.** DIRTY_FILES, KNOWN_FAILING_COMMANDS, BLOCKED_TOOLS.

_Name each condition the unit meets and must not diagnose as its own: a file expected to be dirty, a
command known to fail, a gate red at the baseline, a shim the shell blocks, and who repairs each
one._

## Unknowns

UNKNOWN_FACT and HOW_THE_UNIT_REPORTS_IT.

_Name what you do not know that the unit needs, as an unknown, with the report-back it takes. Write
`none` where the brief is fully specified, rather than shipping a guess the unit has to invent an
answer around._

## Scope

**Owned.** OWNED_FILES

_Grant a behaviour with the tests that pin it, a constant with every fixture and expectation derived
from it, a template with the materialized copy the package generates from it, and a mechanism with
the prose describing it: the comment beside the code it edits and the guide passage stating the
behaviour it moves._

**Shared (report-only).** SHARED_FILES

_Name each file another live unit owns. The unit returns an exact patch for serial integration and
edits nothing in this row._

**Off-limits.** OFF_LIMITS_FILES

_Name each file the unit must not touch, and read every acceptance criterion against this row line by
line. Grant the file a criterion needs, or strike that criterion. A file the change breaks that
appears in no row of this section is unscoped._

**What asserts the state this change ends.** FILES_THE_RESULT_MAKES_FALSE

_List every file the result makes false rather than every file that declares the thing changing: the
test asserting the reversed behaviour, the fixture carrying the raised value, the golden digest over
generated output, the consumer script naming the removed union member. Derive the list by running the
suite; where you cannot run it, name the search's bound so the unit re-derives the list. End each
entry in Owned, in Shared, or with a named carrier dispatched before this change ships._

**Tools and limits.** ALLOWED_TOOLS, PERMISSION_LIMITS

_Check the § Output mechanism and every acceptance criterion's verification method against this
allowlist. A read-only lane writes no report file and runs no probe, so hand it the rendered evidence
instead._

## Execution

**A native subagent, or a bench engine reading this brief inside its own CLI:** perform the
assignment directly and spawn nothing.

**A bridge driver:** carry this brief across unaltered, launch ENGINE_NAME through its CLI, and
return the journal path and the session id with the result.

_Keep the line written for the reader this brief reaches. Delete the line written for the other
reader. A bench result that carries no journal path and no session id ran on the driver's own engine:
refuse it._

## Output

RETURN_SHAPE, delivered through OUTPUT_MECHANISM.

_State the exact distilled return shape and the mechanism that delivers it. No process diary._

## Deviation contract

Stop and report — expected, found, exact evidence, done or not done, and at most one short
hypothesis — on CONFLICT_WITH_THE_OBJECTIVE. Decide, record, and carry on from
ANCILLARY_CONFLICT_THE_UNIT_SETTLES.

_Scope the contract. A conflict with the objective stops the unit; where a paragraph sits and which
heading a section takes are the unit's to settle._

## Acceptance criteria

1. REGENERATION_OR_CHEAPEST_GATE_CRITERION
2. SCOPED_GATE_CRITERION
3. ARTIFACT_CRITERION

_Order the criteria cheap-first, so an unreachable criterion cannot hide a typecheck or a lint
criterion behind it. Where the change edits a file the repository vendors or digests, put the
regeneration step ahead of every gate that reads the generated artifact. Ask what the change does
to every fact you measured, and fix each criterion to the state the unit finishes in. Close each
criterion with owned files alone, and name the property the unit must change; record a consequence
you expect to follow as an observation, never as a criterion. A scoped run over the unit's own
owned files stays a legitimate criterion._

**Observations, not criteria.** TIMING_SENSITIVE_OR_WHOLE_SUITE_GATES

_Name each timing-sensitive or whole-suite gate as an observation the unit reports with its own
reading. Take the authoritative run yourself after the unit exits._

## Review evidence

EVIDENCE_FOR_EVERY_ROW_THIS_SUBJECT_OCCUPIES.

_Supply what `orkestrel-falsify` § "Evidence, by subject type" requires of each row the subject
occupies: for a code change the actual diff and the actual status output, for a rendered or
externally driven surface the capture portfolio as primary and source as corroboration, and for a
policy, design, or process proposal the proposal, the canon it must satisfy, and the record of what
motivated it. A subject occupying more than one row takes the evidence of every row._
