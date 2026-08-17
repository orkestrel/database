# Orchestration

How agents are dispatched, how long-running work is supervised, and how both are accepted. Every
harness follows this file.

## Authority

Read in this order before acting:

1. The user's current instruction. It wins over everything below.
2. `AGENTS.md` and the applicable `.claude/rules/*.md` files. They govern code substance.
3. This file. It governs agent operation only and cannot weaken the coding contract.
4. The dispatch-named skill and the references it requires.
5. The governing guide or spec.

`CLAUDE.md`, `.codex/config.toml`, and `.cursor/rules/` are bridges. Each points here and adds
only what its harness needs. None of them restates this file.

Every dispatch tells its executor to read items 2 through 5 before acting.

## The three engines

One workflow runs across all providers. Each engine has one job and never takes another's.

| Engine          | Job                                                   | Posture                                      |
| --------------- | ----------------------------------------------------- | -------------------------------------------- |
| **Cursor Grok** | Absorption, distillation, scouting, bounded research  | Read-only; returns evidence, never decisions |
| **Opus 5**      | Subjective design, design-fit review, implementation  | Proposes, audits, implements; never accepts  |
| **GPT-5.6 Sol** | Objective analysis, correctness audit, implementation | Proposes, audits, implements; never accepts  |

- Route each nontrivial implementation unit to Opus or Sol. Objective, constraint-heavy,
  mechanical-precision work goes to Sol. API-shape, naming, and documentation-voice work goes to
  Opus. Cursor Composer is not an implementation route, and no `composer` role exists.
- Design and audit always run the two-lane adversarial pass below.

## Orchestration by harness

The harness's own engine orchestrates. Run it on the latest version of that model at high
reasoning effort.

| Harness     | Orchestrator engine |
| ----------- | ------------------- |
| Claude Code | Opus 5              |
| Codex       | GPT-5.6 Sol         |
| Cursor      | Cursor Grok         |

- The Orchestrator reconciles. No engine reconciles itself or accepts its own work.
- The Orchestrator shares its engine with one lane: Opus in Claude Code, Sol in Codex. That lane is
  still dispatched as a separate subagent with a clean context, never run inline.
- In a fix round the auditor is an engine that did not write it. When the writer's engine is the
  Orchestrator's engine, the auditor is the other lane.
- Each harness reaches the engines it does not host through its own bridge file. The bridge owns
  the invocation mechanics and their cost constraints; this file owns the routing.

## The adversarial pass

Two lanes run on every design round; an audit round runs the lanes the execution loop's step 5
names, on the same clean-context terms.

| Lane           | Argues                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| **Subjective** | Shape, taste, naming, ergonomics, design fit, what the API should feel like |
| **Objective**  | Correctness, constraints, and what the code and contracts actually permit   |

**A required lane always runs.** Never collapse two required lanes into one. Never let an engine's
absence stand in for a required lane.

### Clean contexts

- Dispatch each lane as a fresh subagent. Never run a lane inside the Orchestrator's own context.
- Give each subagent the brief and its evidence slice, and nothing else. Do not carry the
  Orchestrator's conversation, its working hypothesis, or the other lane's answer.
- A lane run in the Orchestrator's context is the Orchestrator assessing itself, whatever model
  name it carries. The clean context is what makes the lane independent and unbiased, and it is
  what keeps the main context at decision level.
- Run both lanes in parallel, blind to each other. Reconcile them yourself.

### Engine assignment

By default Opus 5 holds the subjective lane and Sol holds the objective lane.

When one engine is unavailable, the remaining engine runs **both** lanes — still two separate
subagents, still clean contexts, still blind to each other, each told which perspective it holds.
Record the substitution.

| Harness     | Engine unavailable       | Runs both lanes |
| ----------- | ------------------------ | --------------- |
| Claude Code | Sol (Codex bench dark)   | Opus 5          |
| Codex       | Opus 5 (Claude CLI dark) | GPT-5.6 Sol     |
| Cursor      | Both (MCP servers dark)  | Cursor Grok     |

- Never assign Grok to either lane in Claude Code or Codex. If the remaining native engine is also
  unavailable there, the pass cannot run: stop and report rather than substituting Grok.
- Grok takes both lanes only in Cursor, and only when Opus 5 and Sol are both unavailable.
- Treat a lane that returns no verdicts as a lane that did not run. A bench lane reporting that its
  driver executed and its engine was never reached is a dark bench, not a result. Record the bench
  dark from that report, re-run the lane on the substitute engine from the table above, and name in
  the routing ledger which lane ran on which engine. Never accept a round with one lane empty.
- Re-read bench liveness at dispatch, not at session start. A bench that probed live can be dark when
  the lane launches.

## Tedious work goes to Grok

Absorption, distillation, repository scouting, and bounded primary-source research go to Grok
first, always. Grok returns distilled evidence with `file:line` pointers, never raw dumps.

Send it any task whose cost is reading: mapping terrain, surveying prior art, sweeping a large
diff, reconciling scattered sources.

Fall back in this order and record the substitution:

1. **Cursor Grok.** The default.
2. **Luna** (`gpt-5.6-luna`), when the Cursor bench is dark and Codex is available.
3. **Sonnet**, when both benches are dark.

- Never route absorption to the Orchestrator itself, even when the Orchestrator is Grok. Keep the
  main context at decision level; in Cursor that means a Grok executor session, not this one.
- Never spend Opus 5 or Sol on it.
- Grok is read-only, so a writing unit never routes there. Fully specified mechanical writing goes
  to `builder` or `application` on the harness's cheap native tier.
- `verifier` runs commands and reports exit codes, so it stays on the native tier too.

## Orchestrator and executor

- The top-level agent is the **Orchestrator**. It owns the goal, plan, decisions, cross-unit
  state, integration, and final acceptance.
- A dispatched subagent is an **Executor**. It performs its bounded assignment directly, spawns
  nothing, and returns the required distillate.
- Work directly on a typo, a one-line fix, or a single lookup. Orchestrate when isolation,
  parallelism, independent review, or substantial context justifies it.

## Roles

One role set, mirrored per provider. Name the role and state its engine in every dispatch, even
when the role file already pins it.

| Job                                      | Claude role (`.claude/agents/`) | Codex role (`.codex/agents/`) | Engine                        |
| ---------------------------------------- | ------------------------------- | ----------------------------- | ----------------------------- |
| Absorption, distillation, scouting       | `grok`                          | `grok`                        | Cursor Grok (bridge)          |
| Creative design and alternatives         | `planner`                       | `planner`                     | Opus 5 (native / bridge)      |
| Design-fit review and audit              | `reviewer`                      | `reviewer`                    | Opus 5 (native / bridge)      |
| Objective analysis and correctness audit | `analyst`                       | `analyst`                     | GPT-5.6 Sol (bridge / native) |
| Nontrivial implementation (objective)    | `sol`                           | `implementer`                 | GPT-5.6 Sol (bridge / native) |
| Nontrivial implementation (subjective)   | `implementer`                   | `implementer` route `opus`    | Opus 5 (native / bridge)      |
| Bounded primary-source research          | `researcher`                    | `researcher`                  | Grok → Luna → Sonnet          |
| Repository reconnaissance                | `scout`                         | `scout`                       | Grok → Luna → Sonnet          |
| Mechanical conformance evidence          | `checker`                       | `checker`                     | Grok → Luna → Sonnet          |
| Ecosystem evidence                       | `orkestrel`                     | `orkestrel`                   | Sonnet / Terra                |
| Fully specified mechanical unit          | `builder`                       | `builder`                     | Sonnet / Terra                |
| Fully specified app-layer unit           | `application`                   | `application`                 | Sonnet / Terra                |
| Gate evidence                            | `verifier`                      | `verifier`                    | Sonnet / Terra                |

- A **bridge** role is a cheap driver whose only work is invoking another provider's CLI. It never
  implements, judges, or endorses the result.
- Give every role a file on both sides. The role file is where engine, effort, tools, permissions,
  and charter are pinned, and the tool allowlist is what makes the read-only floor real. A role
  with no file has nowhere to pin either.
- Reach every role by its own name. Do not rely on a remembered route.
- `researcher`, `scout`, and `checker` are native lanes for jobs that belong to Grok first.
  Dispatch `grok` with their brief before using them, and use the native role only once the ladder
  has stepped past Grok. Record which step you are on.
- `orkestrel` stays native because it carries the package catalog in its own role file. Sending its
  job to a bench means shipping that catalog across, which costs more than the bench saves.
- `codex` is the shared Sol transport contract, not a route. `analyst` and `sol` are the named
  bridges; both bind that contract by reference and pin only their route and sandbox.
- Mirroring is by work class, not filename. A transport contract is provider-specific:
  `.claude/agents/codex.md` carries the Sol transport on the Claude side, `.codex/agents/claude.toml`
  the Opus transport on the Codex side, and each side's bridges bind their own by reference.
- Opus and Sol roles use high effort. Native cheap-tier roles use low or medium. Bridge drivers use
  the cheapest tier that can run a CLI.
- Never route orchestration or acceptance across a bridge.

## Permission floor

Every role honours this floor. No dispatch may widen it.

- Agents run to completion. Constrain only genuine security or destruction risk. Do not gate
  routine work behind approval prompts or turn budgets.
- Read-only roles carry no `Edit` and no `Write`. The tool allowlist is the guarantee. Because
  those roles cannot inspect the tree by writing to it, the Orchestrator supplies the actual diff
  and status evidence in every review dispatch.
- `verifier` has no edit or write tools and never fixes a failure.
- Run writing roles in the main checkout, strictly serialized: one writer at a time, dispatched
  from a clean committed baseline, each owning disjoint files.
- Treat every shared file as report-only.
- No role commits, pushes, tags, publishes, installs dependencies, or runs a destructive command.
- No role reads, prints, copies, uploads, or packages a secret — `CURSOR_API_KEY`, Codex auth
  files, `.env*`, `.npmrc`, `auth.json`, keys, or tokens.
- Concurrent executors never run tree-wide `format`, lint `--fix`, or `build`. They validate
  read-only and scoped to their own files.
- Keep hooks light. A Stop hook may run cheap changed-file verification such as `git diff --check`.
  It never duplicates the gate suite; gates belong to `verifier`.

## Context and decomposition

- Keep the main context at decision level. Send large reads, repository scans, raw logs, diffs,
  and exploratory sweeps to `grok` and consume the distillate.
- Settle a behavioural question by running it, including your own. This binds before a brief is
  written, not only after a report arrives, and it needs no disagreement to trigger it. A round of
  deliberation that a probe would have ended is the expensive failure, and it is invisible because
  it feels like rigour.
- Check an assumption before it enters the plan. An unverified belief the Orchestrator states
  becomes a fact for every unit downstream, and every one of them inherits the error.
- Break a repeating frame deliberately. When several rounds against one subject keep finding the
  same class of defect through a new door, the search is following the frame rather than the
  defect. Bound the scope, then fan out independent lenses over disjoint slices in one pass.
  Parallelism is worth more here for the framing it breaks than for the wall-clock it saves.
- Two lanes is the adversarial pass's FLOOR, not its shape. Where a subject has more seams than
  two lanes can attack, fan out one lens per seam over disjoint slices, keep every lens blind and
  clean-contexted, and number every slice's claims in one shared sequence. Change the lenses in a
  successor round rather than repeating them.
- Decompose by required context and independently verifiable acceptance criteria, not by task type.
- Send instructions down fully specified. Return findings smaller than the context consumed.
- Parallelize independent work. Serialize dependencies and shared-file contention.
- The Orchestrator owns the plan and every final decision. Design engines propose, writers execute,
  auditors advise.

## Writing concurrency

Concurrent executors share a filesystem unless isolated. Follow these six rules to prevent
clobbered edits, formatter and build races, cache phantoms, and validation cross-talk.

1. Serialize writing executors in the main checkout. Commit a checkpoint before each writing
   dispatch so git is the rollback mechanism.
2. Assign disjoint owned files plus explicit shared and off-limits files.
3. Keep shared files report-only. Executors return exact patches for serial integration.
4. Restrict concurrent executors to read-only, scoped validation. A tree-wide result may contain a
   sibling's in-flight failure, so an executor reports only its owned scope.
5. Give concurrent audit lanes worktree isolation whenever the campaign is uncommitted. Two lanes
   sharing one working tree contaminate each other's readings in both directions.
6. After integration, clear shared caches if needed, then have one independent `verifier` run the
   authoritative tree-wide sweep. A writer's self-report never establishes green.
7. The Orchestrator's own sweep is a writing dispatch and queues behind the units that own those
   files. A script that fixes one thing across every target is the easiest way to break rule 1,
   because it does not feel like a dispatch — nobody was named, no brief was written, and it
   finishes in seconds. It still writes into trees a live unit owns, and a unit whose brief it
   invalidates will repair the same drift the other way and report a state that is already false.
   Run it before the units, or after them, or send the decision to every unit in flight per the
   mid-campaign rule under **Dispatch anatomy**. Never beside them.
8. A fleet pass that records a per-target status commits only the targets it recorded green. Reading
   "is the tree dirty" instead of "did this target pass" pushes a red target the moment one exists,
   and a flake makes that look like it worked. Refuse the failed row, name it, and re-run it alone
   before deciding what it was.
9. Run a fleet pass in slices that report as they finish, never as one block. A block hides its first
   failure behind every target that follows, so the failure surfaces after the work it should have
   stopped. A slice hands control back while most of the fleet is still unstarted.
10. Re-run a timing or resource failure alone before believing it. Concurrent slices, builds, and
    suites make a container miss deadlines it meets when idle, so a red result under load is a
    question rather than an answer.

## Execution loop

At session start, before planning, probe bench liveness and plan routing against the result. Resolve
each CLI first (`codex --version`; `agent --version`, falling back to `agent.cmd --version`), then
run the bench's authentication-state check where it exposes one. Neither answer is liveness. A
version string proves the binary is installed, and an authentication-state check reads stored
credentials, so both pass while the account is out of quota, while the routed model is unavailable to
it, while the server has already revoked the credential the check just read, and inside a sandbox
with the network denied. Record a bench live only on a bounded round-tripped model call that came
back, and record what came back beside the routing decision. Probes are read-only, and the role file
owns each bench's exact probe.

The two local steps still run, because they route the recovery rather than decide the verdict: an
unresolved CLI is an install problem, a failed authentication-state check starts the login ladder
below, and a bench that passes both and still cannot round-trip is dark for a reason no local check
can see. Record every dark bench with its fallback and the lane substitution it forces, and never
absorb one silently. A readiness script reports readiness and performs no model call, so the round
trip belongs to the Orchestrator's own probe or to the bridge carrying the unit, never to the hook.
Liveness also expires: a dispatch that fails on quota, model access, or the network is a fresh
liveness result rather than a unit-level fault, so record the bench dark from there and re-plan the
lane instead of re-dispatching against a session-start answer that no longer holds.

1. **Absorb.** Dispatch `grok` for terrain, prior art, and the reading the decision needs. In an
   Orkestrel repo dispatch `orkestrel` alongside it for live package state. Skip only when the
   ground is already known.
2. **Design adversarially.** Run the two-lane adversarial pass on one design brief: `planner` for
   the subjective lane and `analyst` for the objective lane. Reconcile them yourself into one plan:
   units, dependencies, ownership, parallel and serial order, acceptance criteria, risks.
   - Surface the plan before dispatch, including a routing ledger naming each unit's role **and**
     engine. Routing a unit to a Claude-native agent when its work class belongs to a bench —
     reading-heavy to Grok, objective audit or objective implementation to Sol — without a recorded
     bench-dark deviation is a dispatch deviation.
   - State the goal's exit criterion beside the units: the enumerated capabilities whose closure
     ends the campaign, each to end implemented, repaired, retained, or intentionally excluded on
     evidence. A plan that names work but not its end can only be abandoned, never finished.
3. **Implement.** Route each nontrivial objective unit to the Sol `implementer` and each nontrivial
   subjective unit to the Opus `implementer`, in the main checkout, one writer at a time. Route a
   fully specified taste-free unit to `builder`. Never route implementation to an engine the unit's
   judgment load exceeds.
4. **Integrate.** Evaluate each distillate against its acceptance criteria, apply shared-file
   patches serially, and route cross-cutting findings. Integration applies exact returned patches
   and mechanical conflict resolution only. A new type, mechanism, behavior, or acceptance
   criterion discovered at integration is a successor brief routed to a writer, never an
   integration edit.
5. **Audit adversarially.** Audit every nontrivial implementation with at least one lane whose
   engine did not write it. Run the second lane when the first returns FAIL, when the subject is a
   rendered or externally driven surface, or when the unit's claims span both correctness and
   shape. Dispatch `checker` when the acceptance criteria are mechanical — counts, paths, parity
   rows, scope honesty. Record in the round's verdict file when a lane or the checker did not run.
   - State the audit's subject as numbered falsifiable claims and require per-claim verdicts with
     evidence, per the Falsification law in `.claude/rules/quality.md` and the `orkestrel-falsify`
     value set, unless the dispatch names a different skill that fixes another.
   - In a fix round, give the unit to an auditor engine that did not write it.
   - Run the `orkestrel-falsify` skill for multi-round audits. It owns the brief anatomy, the
     successor-brief rule, the verdict shape and its single terminal line, and the reconciliation
     discipline.
   - Reconcile the lanes that ran. Drop, on the record, any finding no lane can substantiate.
6. **Verify.** Have one independent `verifier` run the authoritative gates.
7. **Re-baseline.** Reconcile the remaining plan against what the phase revealed, before dispatching
   the next one.
   - Rule on every remaining unit: **satisfied**, the phase closed it, strike it; **transformed**,
     the intent stands and the work changed, restate it; **added**, the phase revealed a fork the
     plan did not consider; **unchanged**.
   - Redraw the dependency order. Strike a unit whose subject a later unit deletes. State the new
     prerequisite of a unit that acquired one.
   - Walk the remaining units once and ask of each whether what just landed still supports it. A
     decision taken inside a unit can remove a later unit's foundation, and the unit that took it
     cannot see that.
   - Re-baseline when a probe overturns a decision the plan rests on, not only at a phase boundary.
     A measurement that falsifies your own reconciliation changes which units run.
   - Record what changed and why. An unrecorded re-baseline cannot be audited, and the next one
     re-derives it.
8. **Accept.** Decide, then report outcomes, decisions, evidence, and remaining risk concisely.
   When step 2's exit criterion is met and the gates are green, accept. The next goal is the
   deliverable.

### Re-baselining is not rescoping

`.claude/rules/quality.md` fixes the enumerated scope when work begins and forbids reopening it. A
re-baseline changes which units run. It never changes the goal's exit criterion.

Strike a unit because the phase satisfied it, never because it became inconvenient. Add a unit
because implementation revealed work the exit criterion already required, never because an engine
thought of something else worth doing. A re-baseline that moves the exit criterion is a rescope, and
that needs the user.

## Deviation protocol

When reality diverges from a writing dispatch:

1. The writer stops and reports: expected, found, exact evidence, done or not done, and at most one
   short hypothesis. It does not investigate, improvise, or alter the plan.
2. The Orchestrator triages:
   - obvious correction → tighten and re-dispatch;
   - missing mechanical evidence → dispatch `verifier`;
   - unknown terrain → dispatch `grok` with the report and the plan slice;
   - unknown design or root cause → dispatch `planner` and `analyst` on the question.
3. The Orchestrator decides, updates the plan, and re-dispatches.

Workflow failures use the same ladder. Do not absorb their raw logs into the main context.

## Dispatch anatomy

### Native first

Launch a model through the running harness's own mechanism whenever that harness hosts it: Claude
subagents and workflows in Claude Code, Codex-native agents in a Codex session, Cursor-native
sessions in Cursor. MCP and CLI transports exist only to reach a model the harness does not host.
Never route a native model through its own CLI or an MCP loopback.

- Use a single-agent dispatch when later control flow depends on the previous result.
- Use a workflow for a known deterministic fan-out, staged pipeline, or loop. Serialize writing
  nodes; never run two concurrent writers in the tree.
- Name a role and its engine in every node.

The harness bridge names the concrete mechanism for each of these.

### Every dispatch is a file before it is a launch

- Write the brief to a file under `tmp/`, named for its unit, before launching the unit, whatever
  engine executes it. A brief composed only inside a launch argument cannot be corrected, resumed,
  or re-run once that call ends.
- Capture the unit's returned report to a file beside its brief under the same unit name, so a
  unit's instruction and its outcome are one pair on disk.
- Amend a brief on re-run rather than restating it. A mid-campaign correction produces a successor
  file recording what changed and why, and the original stays. A fix round's brief names the
  findings it carries and where each came from.
- Send a decision taken mid-campaign to every unit already in flight whose brief it invalidates. An
  executor cannot see a change made after it was dispatched, so it writes the state its brief
  described and the defect surfaces as its own.
- Retention is uniform for every unit, whatever engine ran it, including an Orchestrator-owned
  integration, fix, probe, or capture unit: copy the brief, the returned report or distillate, the
  audit verdict, the exact executed script or instrument, and the acceptance evidence into
  `.orkestrel/<package>/` as the unit is dispatched and as it returns, then sweep only the `tmp/`
  launch copies. A capture claim's instrument is acceptance evidence; the frames may be swept once
  the record transcribes them, because the committed instrument re-produces the film. **Bench
  laws** rule 4 owns journals and points here for everything durable.
- Promote anything that must outlive the campaign into a durable artifact before the sweep — a
  commit message, a guide, a rule, a retrospective. What is only in a swept file did not survive,
  and a debrief that must quote the record verbatim has nothing to quote.
- Land a process rule stated as binding mid-campaign in the owning rule or contract file in the
  same commit that states it. A campaign artifact is evidence, never a rule's home.

### Where campaign artifacts live

- Put every campaign artifact in the **orchestrator's** repository under `.orkestrel/<package>/`,
  named for the package the campaign is about.
- Never put them in the package they are about. A published package's tree is its product.
- Claim nothing outside `.orkestrel/` unless Orkestrel scaffold mandates it. Everything Orkestrel
  owns in a consumer's tree lives beneath that folder, so a convention can be settled there without
  colliding with a convention that is not Orkestrel's.
- Keep the campaign narrative and every ruling in the durable artifact that owns it — the guide for
  product truth, a rule or role file for process truth, the commit message for the decision itself.
  Use `ROADMAP.md` only where the repository already keeps one.
- Prefer a mechanism that recomputes a fact over a document that records it. A ledger of live state
  is stale from the moment it is written, and the next campaign reads it as current. Where the fact
  can be derived, derive it: the fleet's publish order lives in the catalog table `scaffold catalog`
  regenerates, not in a written order anyone has to remember to update.
- Prune the campaign folder in a commit at acceptance. The tree ends clean and the record stays
  recoverable by hash. Git history is the archive; the working tree is the workspace.

### Required sections

- **Role and engine.** The named role and its explicit engine.
- **Objective.** One concrete outcome.
- **Context.** The evidence slice, paths, decisions, `AGENTS.md`, applicable rules, the skill name
  and its required references (or an explicit none), and the guide or spec. Include the host
  environment facts the unit will hit — the shell, path, and network constraints its commands run
  under — because an executor that rediscovers them pays for the discovery in round trips. State
  every standing condition the same way: a file expected to be dirty, a command known to fail, a
  shim the shell blocks. A condition the brief leaves unnamed comes back as a deviation report
  about something you already knew.
- **Unknowns.** What the Orchestrator does not yet know that the unit needs, named as unknown, with
  how the unit reports back on it. A brief that cannot be fully specified says so instead of
  shipping a guess the executor would have to invent an answer around.
- **Scope.** Owned files, shared and off-limits files, allowed tools, permission limits.
- **Execution.** State that the executor performs the assignment directly and spawns nothing. Put
  it in every brief; an executor deep in a task does not re-read this contract.
- **Output.** The exact distilled return shape. No process diary.
- **Deviation contract.** The required stop-and-report behaviour for writers, scoped. A conflict
  with the primary objective stops the unit. An ancillary conflict — where a paragraph sits, which
  heading a section takes — is the executor's to decide, record, and carry on from. An unscoped
  contract stops a unit over a detail it was equipped to settle.
- **Acceptance criteria.** Independently checkable completion conditions.
- **Review evidence.** What the subject type requires, per the table in `orkestrel-falsify`. For a
  code change that is the actual diff and the actual status output; omitting either is a dispatch
  deviation. For any claim about a rendered or externally driven surface, the capture portfolio is
  the review input and source is corroboration. A subject may occupy more than one row — a ruling
  whose fixes already landed as edits is both a proposal and a code change — and it gets the
  evidence of every row it occupies.

### Check the brief before you send it

Run these eleven checks on every brief. Each is cheap, and skipping one costs a full dispatch cycle
that produces no work, because a unit given a brief that is internally consistent and factually
wrong is right to stop.

- Name the executor that will actually read the brief, and write its transport for that reader. The
  same unit goes either to a bridge driver that invokes a bench CLI or to the bench engine already
  running inside that CLI, and the sections that are essential for the first are nonsense to the
  second: a brief telling an engine to launch its own CLI fails on arrival. Describe the route the
  reader takes, not the route the work travels.
- Paste the command and its output for every factual claim — paths, counts, registrations, file
  existence. A description of a result is not the result, and a name recalled beside a counted set
  is a guess. A claim about a search names the scope the search covered: a search bounded to one
  directory proves something about that directory and nothing about the rest of the tree, and a
  filtered set proves something about the filter's membership rule and nothing about the population
  it was drawn from.
- Take every measurement under the conditions the unit will run in, or have the unit take it. A
  number measured in your environment and asserted as a criterion is unreachable when the
  executor's sandbox denies what yours permitted, and no edit to the owned files can close it.
  Where the unit is better placed to measure than you are, make the measurement its first step and
  fix the criterion to the property you want rather than to the number you saw.
- Read the acceptance criteria against the off-limits list, line by line. Every criterion closes
  using owned files alone. A criterion that needs an off-limits file gets that file granted or gets
  struck. A file the change will break that appears in neither list is an unscoped file; grant it or
  strike the criterion.
- Give a small unrelated obligation its own unit. Ride it along in a large one and its scope error
  blocks the primary work, which is a whole unit lost to a detail.
- Ask what the change will do to the facts you just measured. A criterion fixed to a measured set is
  unreachable if the change alters that set, and a file marked off-limits is wrong if the change
  writes to it. Measure the state the unit will finish in, not only the state it starts from.
- Grant both halves of a template change where the package generates the configuration it runs on.
  The template and the repository's own materialized copy of that template's output are one change:
  adding a fixed Vitest project moves the template, `vite.config.ts`, `package.json`, and the proof
  file that project includes. Withhold either half and no edit to the owned files can reach the
  gates the brief requires.
- Name the property the unit must change, and stop. A consequence you expect to follow from it is an
  observation for the report, not a criterion. Bundled together, the unit can satisfy neither and
  cannot tell which half you meant.
- Keep the brief's control identifiers inside the brief. Label controls so the brief's own table can
  be read, and say in the brief that a test is named for what it proves, never for the control that
  specified it. An implementer writing one test per control otherwise takes the label as the obvious
  name, and a private brief vocabulary becomes a permanent test name.
- Check the brief's output mechanism and its verification method against the executor's tool
  allowlist. A read-only role cannot write a report file, cannot write a probe, and cannot run a
  sandbox that writes, so naming any of those stops the unit on arrival over a detail the allowlist
  already settled. Where a read-only lane needs executed evidence, produce it separately and hand it
  over: the Orchestrator supplies the evidence and the lane rules on it.
- Scope a fleet-wide refactor by the files that **consume** a symbol, not by the files that declare
  it. A criterion that removes a symbol, or that makes an existing state or fixture shape
  unreachable, closes only when every consumer that exercises it is owned, so a brief scoped to the
  declaration alone sends the unit into a typecheck break in a file it cannot edit. Count the
  importers before writing the owned list.

### Carry every finding

After reconciling findings into briefs, walk the retained finding list once. Every finding names
the brief item that carries it. A finding with no carrier is a dropped finding.

## Long-running commands

A bench exec, a Workflow, an install, a build, and a publish chain are one class of thing: a
command that outlives the turn that started it. Every law here binds all of them.

### Launching

- The Orchestrator launches every long command as a harness-tracked background command under a hard
  time cap. Never detach one from inside a dispatched agent. The harness owns the lifecycle,
  completion re-invokes the session, and the cap kills a wedged command loudly instead of trusting
  the agent to report its own failure. A wedged bridge is silent, and silence must never read as
  progress.
- Write a multi-step chain to a script file and run the file. A chain composed inside one shell
  argument cannot be read back, corrected, or re-run, and the record of what actually ran is the
  argument text in a transcript rather than a file on disk.
- On a Windows host this binds every program-carrying command, not only long ones. Heredocs,
  `node -e`, `node -p`, `&&` chaining, and any argument carrying `${...}` trip the Git Bash
  approval classifier and turn an unattended run into a manual approval prompt. Write the program
  to a file, invoke the file, and keep each shell call one plain command.
- Detach anything that must survive its launching shell with `setsid`. A backgrounded flow the
  harness reaps mid-step leaves the work half done and the exit status missing, and the reap looks
  identical to the step failing.
- Size the cap yourself, from the observed high mark of comparable commands, plus an
  independently budgeted gate allowance, plus explicit slack. Never size it from the estimate
  alone. Never delegate it: a bridge starts with a clean context, holds no record of prior runs,
  and can only guess. A cap-killed exec is indistinguishable from a real failure.
- Run the first use of any CLI flag, subcommand, quoting form, or stdin combination in a throwaway
  probe. Never inside a dispatched unit or a publish chain.
- A launch is not a launch until its record grows past its header. Confirm the log advanced beyond
  the head before recording that the command started, and treat an instantly-dead log as a failed
  launch whose tail is the evidence.
- Keep network-dependent work out of sandboxed bench execs. Bench sandboxes deny network, so
  lockfile generation, real installs, and live fetches belong to the Orchestrator's own tracked
  commands or to the native `implementer` or `builder` as an ordinary dispatched writing unit. A
  bench exec hanging on `npm` until its cap fires is the signature of this misroute, not of a slow
  bench.
- A Workflow journals identically and dies identically, so give it the same watch — with one
  correction. A workflow journal writes only at agent start and result, so its mtime goes quiet for
  minutes during healthy work, and the liveness signal is the newest subagent transcript instead. A
  watch that reports only new events cannot report a death, because silence and progress look the
  same; the filter must fire on absence. Recover with `resumeFromRunId`, which returns every
  completed agent from cache and re-runs only what never finished.

### Reading liveness

Read liveness from the artifact the work produces, never from its wrapper. A subagent's transcript
file can report zero bytes while the agent is working normally, so an empty or stale wrapper proves
nothing.

- Judge a unit by what it has changed in the tree: modification times on the files it owns, the
  counts its suite reports, the report it was told to write.
- Check that before killing anything. A healthy unit killed on a false signal loses everything it
  had not yet written down, and the loss is charged to the orchestrator, not the unit.
- If a unit must be stopped, say plainly that it was stopped and why, then assess the tree it left
  rather than assuming its partial bytes are either good or worthless.
- Follow the deviation ladder for a stalled journal or a cap-killed exec, using the session id from
  the journal head as the recovery handle.

### Confirm dead before relaunching

- Prove the previous run is gone before starting another. List the processes and read the list. A
  second run started beside a live first one produces failures that read as the subject's — a
  publish chain relaunched over a live one reports `EOTP` and `E403` that are its own two processes
  colliding, and both readings point at the registry.
- Kill by process id, never by pattern. `pkill -f` matches the relaunch that is already starting, so
  the pattern that cleans up the old run kills the new one and the cleanup reads as a launch
  failure.
- A killed `codex exec` is dead only when its process tree is dead: walk the children with
  `ps --ppid` and confirm the `codex-code-mode-host` child is gone. Before dispatching a substitute
  writer, check the owned files' modification times against the baseline — a live orphan is still
  writing the tree the substitute is about to own.
- Read a failure against what was running when it happened, not against what you believe was
  running. The check costs one command and is the only thing that separates a real failure from
  self-inflicted contention.

## Bench laws

External engines widen capacity. They never inherit authority. Treat every bench output as a
proposal or hypothesis until it is verified against source and accepted by the Orchestrator.

A bench is cross-provider reach only. Never send a model across a bridge when the running harness
hosts it natively.

A bench exec is a long-running command, so every law under **Long-running commands** binds it too.
This section adds what is true of a bench and nothing else.

Every bridge verifies before running that its CLI resolves and its bench is authenticated, and stops
with a deviation report naming the fallback when either fails. The role file owns the exact
invocation, flags, paths, probe, and recovery ladder; these four laws bind every bench regardless of
transport.

1. **Transport by work class.** Use an MCP transport only for a short interactive exchange — one
   bounded question or a follow-up on a live thread, finishing in roughly two minutes. Use the
   journaled CLI for audits, implementation units, and anything else multi-minute. An interrupted
   MCP call loses its session invisibly; a journal survives any client-side failure.
2. **Journal first.** Every bench invocation leaves a tailable on-disk record beside its brief
   under `tmp/<bench>/`: the event stream or output log, and the final answer. Arm exactly one
   Monitor per long exec, filtered to milestones — commands run, files changed, agent messages,
   terminal states — never the raw event stream. Exit the filter on the exec's terminal event so no
   watcher outlives its subject. The journal's mtime is the liveness signal; the session id in its
   head is the recovery handle. The journal is also the proof the bench ran: a bench unit returns
   its journal path and session id with its result, and the Orchestrator confirms both before
   using that result. A report does not carry the engine that produced it, so a bench unit with no
   journal ran on its driver's engine, however normal its answer reads.
3. **Tracked, never loose.** Register every bench unit in the session task registry at launch with
   its subject, journal path, and session id, and complete it there at acceptance. "What is
   running" always has a first-class answer instead of a recollection of a command.
4. **Ephemeral streams, durable records.** A journal proves a bench is alive and recovers an
   interrupted session. Keep journals under `tmp/`, never commit them, and sweep them at acceptance
   after the final gate evidence is recorded. Durable retention — brief, distillate, verdict,
   instrument, acceptance evidence — is owned by **Dispatch anatomy**; this rule owns only the
   journal stream.

### Recovering a dark bench

- A probe that finds a bench binary present but authentication unavailable starts recovery in the
  same turn. Do not record the bench dark and wait.
- Background the login command with its output captured under `tmp/<bench>/`, surface the
  verification URL and one-time code to the user the moment they appear there, arm a watcher on
  completion, and re-probe when it fires. The bench comes live mid-session with no restart.
- A session that sits dark until the user asks for the login has failed the probe, not the bench.
- Never substitute an API key, access token, copied auth file, or another login flow. If recovery
  cannot complete, record the bench dark, name the fallback in the plan, and say so.
- The role file owns each bench's exact login command and probe.

## Publishing the fleet

Publishing is the user's decision and the user's credential. The Orchestrator prepares, surfaces
the approval, and runs the publishes the user asked for. It never substitutes an API key, an access
token, a copied auth file, or another login flow, and it never asks the user to paste a token into
the conversation.

A publish chain is a long-running command, so every law under **Long-running commands** binds it:
write the chain to a file, detach it with `setsid`, and confirm the previous one is dead before
starting another.

### What a bump obliges

A runtime dependency and a development dependency have different blast radius, and confusing them
either publishes packages nobody needed to publish or leaves a consumer pinned to an older release.

- A **runtime** `dependencies` bump reaches every consumer of the published package. Every package
  downstream of it re-pins, re-runs its gates, bumps, and republishes, in layer order.
- A **development** `devDependencies` bump reaches nobody. Re-pin it, prove the gates still green,
  and commit to `main`. Do not bump the version and do not publish.
- A development bump that forces a change to `src` or `app` is no longer a development bump. The
  published types or runtime moved, so that package bumps and publishes on its own account, and
  its own dependents follow the runtime rule above.

Every package is `0.0.x`, where a caret pins one exact release. A dependent therefore sees a new
version only after it re-pins and republishes, so the fleet publishes in topological layer order
derived from runtime `dependencies` alone. Layers exist for a reason a flat pass cannot fix: two
ranges that disagree install two copies of the same package, and the compiler reads them as two
distinct types.

Read the order from the catalog table in `.claude/agents/orkestrel.md`, which `scaffold catalog`
regenerates from the registry. Its `Layer` column is the publish round. Regenerate it before
sequencing a cascade rather than trusting the copy in the tree, and never write a second order down
somewhere else.

The tooling packages sit outside that order because nothing depends on them at runtime. `scaffold`
is a development dependency of every package, including packages it depends on itself, so a runtime
layering would report a cycle that does not exist. Each package builds against the already-published
`scaffold`, never against an unpublished one, and a `scaffold` release therefore publishes on its own
and propagates as files rather than as a cascade.

`scaffold` also carries a second published surface beside `dist/src`: `package.json` ships
`dist/host`, the vendored file set every target receives through `repair`.

- Bump and publish `scaffold` when any vendored byte changes, or when the set of vendored paths
  changes. That surface moved on its own account, and `dist/src` need not move with it.
- Re-pin `@orkestrel/scaffold` in each target after a vendored-only release, run `repair` there, and
  prove that target's gates still green. `repair` restores `tests/setupPolicy.ts` and
  `tests/policy.test.ts`, so a vendored-only release can turn a green target red. A target bumps
  only when its own published surface moved.
- Keep a target's own Claude permissions in `.claude/settings.local.json`, never in the vendored
  `.claude/settings.json`. `repair` restores the vendored copy, so a `defaultMode` or an `allow`
  entry added there is reverted without warning and the operator loses grants they set
  deliberately. Change the vendored file only here, in the host inventory.
- Never edit a vendored file inside a target. `repair` restores it, so the edit is reverted and
  reports as drift in `scaffold audit`. In this repository those same files are the published
  `dist/host` surface, so editing one forces a bump, a publish, and a re-propagation across every
  target. Scope a fleet-wide refactor to the files each target owns, and record the vendored
  exclusion in the brief rather than letting each unit rediscover it.

### Preparing

1. **Bump from what the registry serves, not from the local manifest.** A repository's `version`
   can sit a release behind what was published from another checkout, and bumping that produces a
   version the registry already holds, which fails on upload after the whole gate chain has run.
   Read the registry first.
2. **Prepare a whole layer before authenticating.** Bump each version, re-pin every `@orkestrel`
   range to what the registry serves now, install, and run the package's own `prepublishOnly` to
   green. Move any self-pin in source with the manifest. Commit and push before the window opens.
3. **Prepare the next layer only after this one is on the registry.** A dependent's new pin cannot
   install until the version it names exists, so preparation and publication interleave and cannot
   be batched ahead.

The window is for uploads. Every gate, build, install, and commit happens outside it, which is what
makes `--ignore-scripts` the right flag at publish time: the artifact was already proved, and the
flag is what stops the gate chain running a second time inside the five minutes.

### Reaching the approval

- Launch the login chain only when the user has signalled they are at the keyboard and will click
  within ten minutes. An approval URL expires unclicked in about ten to fifteen minutes, and an
  overnight gap expires the session credential with it.
- Run `npm login` before any publish. `npm publish` does not open the browser flow: unauthenticated
  it returns `E404` on `PUT`, which reads as a missing package rather than a missing credential.
- Pass `--browser=false` to `npm login` and to every `npm publish`. Without it npm prints
  `Press ENTER to open in the browser...` and blocks. Never answer that prompt with a newline: the
  web flow consumes the newline on a later read, drops to a legacy `Username:` prompt, and exits
  **zero** without authenticating. With the flag npm prints the URL and polls, and stdin stays
  untouched.
- Hold stdin open and write nothing to it. Use a fifo held open by a long `sleep`. EOF drops npm to
  the same legacy prompt a stray newline does.
- A login log showing the spinner and then a legacy `Username:` prompt is an expired attempt, not a
  prompt to answer: kill it by process id and mint a fresh flow.
- Run the login and every publish under `script -qfc '<command>' <log>`. npm offers the approval only
  when it sees a TTY; without one it fails `EOTP` with no way to answer.
- Expect two approvals. `npmjs.com/login/cli/<id>` authenticates the session; `npmjs.com/auth/cli/<id>`
  authorizes the publish and opens the five-minute window. Tell the user both are coming, or the
  second link reads as the first having failed.
- Confirm authentication with `npm whoami`, never with an exit code. The legacy fallthrough exits
  zero.
- Re-probe `whoami` immediately before opening the window. A stored credential expires mid-session,
  so a session-start answer does not hold.
- Surface each approval URL the moment it appears in the log, and take the **last** one in log order.
  npm mints a new URL whenever an attempt restarts, and the log accumulates every one, so a URL
  chosen by sorting rather than by position is already dead when the user opens it.
- Re-read the log before treating an approval as failed. The chain is usually still alive on a newer
  URL, so surface that one rather than relaunching.
- A `404` on an approval URL usually means the publish already succeeded and consumed it. Read the
  registry before calling it a failure.
- Say that approving the publish one opens a five-minute window covering the rest of the layer.

### Spending the window

- The window opens when the user approves, not when the first publish starts. Chain every remaining
  publish inside the same process as the gate package, so no human turn sits inside it.
- Publish serially. Concurrent publishes collide on the auth handshake and fail each other.
- **Never retry a publish that is still waiting for its authorization.** Each `npm publish` attempt
  mints a new `authId` and invalidates the previous one, so a retry loop makes the URL a moving
  target the user cannot approve in time. The abandoned poll then reports
  `403 Forbidden - GET /-/v1/done?authId=…`, which reads as a permissions problem and is two attempts
  colliding. Publish the first package of a layer with exactly one attempt.
- Retry only an upload that failed **inside** an already-open window. `EOTP` there is intermittent
  contention rather than the window closing: retry about three times, and retry a failed set once the
  layer ends. Packages have landed on the third attempt and on a later pass with no new approval.
  These are two different failures wearing similar codes; a retry fixes the second and causes the
  first.
- Expect a large layer to outlast one window. Size batches to what uploads in five minutes and tell
  the user how many approvals to expect, rather than discovering it mid-run.
- Read the result from the registry, not from an exit code: a piped `npm publish` reports the exit
  status of the pipeline, and a CDN read straight after a publish can still serve the previous
  version.
- Re-read the registry before telling the user a package failed. A chain still running, a retry that
  landed, and CDN lag all produce a failure reading that the registry contradicts, and a false
  failure report costs a needless approval and a needless republish.

## Acceptance laws

- No writer's and no external engine's self-assessment is authoritative.
- Never spend Opus 5 or Sol on absorption, distillation, scouting, or mechanical edits. Never route
  judgment-bearing implementation away from Opus 5 or Sol.
- Substitute an engine only when the same session records the bench dark — CLI missing, auth
  expired, model unavailable. Name the fallback in the plan; never improvise it silently. The
  tedious-work ladder is the only pre-approved substitution, and each step down it is still recorded.
- Never run the two lanes on different briefs, and never show either one the other's answer before
  both have returned.
- Never run a lane inline in the Orchestrator's context, and never drop a lane because its default
  engine is unavailable. Substitute the engine, keep the lane.
- Never accept unreviewed implementation, unverified hypotheses, shared-tree writing races,
  implicit engines, fixed Claude model IDs, or verbose completed-work residue.
- Evidence a claim about a rendered or externally driven surface with its capture or a real foreign
  client driving it, never with source alone. Where no such surface exists this law is inert.
- When the Orchestrator writes any part of a unit, that part is briefed, owned, and audited like any
  other part, and its auditor is an engine the Orchestrator does not share.
- Final acceptance belongs only to the Orchestrator, after independent audit and gate evidence.
- Accept when the plan's exit criterion is met and the gates are green, not when the last engine
  runs out of appetite. Reopening an accepted criterion is the user's instruction, not an auditor's
  finding.
