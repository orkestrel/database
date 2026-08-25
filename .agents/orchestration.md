# Orchestration

How agents are dispatched, how long-running work is supervised, and how both are accepted. Every
harness follows this file.

## Authority

Read in this order before acting:

1. The user's current instruction. It wins over every later item.
2. `AGENTS.md` and the applicable `.claude/rules/*.md` files. They govern code substance.
3. This file. It governs agent operation only and cannot weaken the coding contract.
4. The dispatch-named skill and the references it requires.
5. The governing guide or spec.

`CLAUDE.md`, `.codex/config.toml`, and `.cursor/rules/` are bridges. Each points here and adds
only what its harness needs. None of them restates this file.

A line stays in this file when an executor who is not doing that thing is worse off without it. A
line becomes a skill when it fires on a named trigger and its reader is one agent at one moment.

Every dispatch tells its executor to read every item after the user's current instruction before
acting.

## The engines

One workflow runs across all providers. Each engine has one job and never takes another's.

| Engine          | Job                                                   | Posture                                      |
| --------------- | ----------------------------------------------------- | -------------------------------------------- |
| **Cursor Grok** | Absorption, distillation, scouting, bounded research  | Read-only; returns evidence, never decisions |
| **Opus 5**      | Subjective design, design-fit review, implementation  | Proposes, audits, implements; never accepts  |
| **GPT-5.6 Sol** | Objective analysis, correctness audit, implementation | Proposes, audits, implements; never accepts  |

- Route each nontrivial implementation unit to Opus or Sol. Objective, constraint-heavy,
  mechanical-precision work goes to Sol. API-shape, naming, and documentation-voice work goes to
  Opus. Cursor Composer is not an implementation route, and no `composer` role exists.
- Design runs the adversarial pass. An audit runs the lanes its round names, with at least one whose
  engine did not write the work.

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

The subjective lane and the objective lane run on every design round; an audit round runs the lanes
the execution loop's audit step names, on the same clean-context terms.

| Lane           | Argues                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| **Subjective** | Shape, taste, naming, ergonomics, design fit, what the API should feel like |
| **Objective**  | Correctness, constraints, and what the code and contracts actually permit   |

**A required lane always runs.** Never collapse required lanes into one. Never let an engine's
absence stand in for a required lane.

### Clean contexts

- Dispatch each lane as a fresh subagent. Never run a lane inside the Orchestrator's own context.
- Give each subagent the brief and its evidence slice, and nothing else. Do not carry the
  Orchestrator's conversation, its working hypothesis, or the other lane's answer.
- A lane run in the Orchestrator's context is the Orchestrator assessing itself, whatever model
  name it carries. The clean context is what makes the lane independent and unbiased, and it is
  what keeps the main context at decision level.
- Run the lanes in parallel, blind to each other. Reconcile them yourself.

### Engine assignment

By default Opus 5 holds the subjective lane and Sol holds the objective lane.

When one engine is unavailable, the remaining engine runs **every** lane — still separate
subagents, still clean contexts, still blind to each other, each told which perspective it holds.
Record the substitution.

| Harness     | Engine unavailable                | Runs every lane |
| ----------- | --------------------------------- | --------------- |
| Claude Code | Sol (Codex bench dark)            | Opus 5          |
| Codex       | Opus 5 (Claude CLI dark)          | GPT-5.6 Sol     |
| Cursor      | Opus 5 and Sol (MCP servers dark) | Cursor Grok     |

- Never assign Grok to either lane in Claude Code or Codex. If the remaining native engine is also
  unavailable there, the pass cannot run: stop and report rather than substituting Grok.
- Grok takes every lane only in Cursor, and only when Opus 5 and Sol are both unavailable.
- Treat a lane that returns no verdicts as a lane that did not run. Re-probe the bench before ruling
  on why, per Bench laws rule "One lane at a time per bench". A bench lane reporting that its driver
  executed and its engine was never reached is a dark bench, not a result. Record the bench dark
  from that report, re-run the lane on the substitute engine from the preceding table, and name in
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
| Nontrivial implementation (subjective)   | `implementer`                   | `opus`                        | Opus 5 (native / bridge)      |
| Bounded primary-source research          | `researcher`                    | `researcher`                  | Grok → Luna → Sonnet          |
| Repository reconnaissance                | `scout`                         | `scout`                       | Grok → Luna → Sonnet          |
| Mechanical conformance evidence          | `checker`                       | `checker`                     | Grok → Luna → Sonnet          |
| Ecosystem evidence                       | `orkestrel`                     | `orkestrel`                   | Sonnet / Terra                |
| Fully specified mechanical unit          | `builder`                       | `builder`                     | Sonnet / Terra                |
| Fully specified app-layer unit           | `application`                   | `application`                 | Sonnet / Terra                |
| Gate evidence                            | `verifier`                      | `verifier`                    | Sonnet / Terra                |

- A **bridge** role is a cheap driver whose only work is invoking another provider's CLI. It never
  implements, judges, or endorses the result.
- `implementer` names the harness's native implementation lane, so the token means Opus in Claude
  Code and Sol in Codex. An engine-named bridge — `sol`, `opus` — names the other engine. Read a
  role name against the harness you are running in, and state the engine anyway.
- Give every role a file on both sides. The role file is where engine, effort, tools, permissions,
  and charter are pinned, and the tool allowlist is what makes the read-only floor real. A role
  with no file has nowhere to pin either.
- Reach every role by its own name. Do not rely on a remembered route.
- `researcher`, `scout`, and `checker` are native lanes for jobs that belong to Grok first.
  Dispatch `grok` with their brief before using them, and use the native role only once the ladder
  has stepped past Grok. Record which step you are on.
- `orkestrel` stays native because it carries the package catalog in its own role file. Sending its
  job to a bench means shipping that catalog across, which costs more than the bench saves.
- A transport contract lives in `.agents/transports/`, not in an agents directory. A harness lists
  its dispatchable agents from that directory, so a contract that is never dispatched sits outside
  it. `.agents/transports/codex.md` is the shared Sol transport contract and
  `.agents/transports/claude.md` the shared Opus transport contract. Neither is a route: `analyst`
  and `sol` are the named Sol bridges, `planner`, `reviewer`, and `opus` the named Opus bridges, and
  each binds its own contract by reference and pins only its route and sandbox.
- Mirroring is by work class, not filename. A transport contract is provider-specific: the Codex
  contract carries the Sol transport the Claude-side bridges follow, the Claude contract carries the
  Opus transport the Codex-side bridges follow, and each side's bridges bind their own.
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
- No role runs `git checkout`, `git restore`, `git stash`, `git reset`, or `git clean`. Each discards
  a working-tree change silently. A role that must undo its own edit undoes exactly that edit.
- A dispatch that has a unit plant a line to prove an instrument can fail names a file the unit under
  verification did not touch, and names how the plant is removed. Check the tree's status before
  choosing the file.
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
- When the recurring class has a direction — each fix relocates it along one stream: a dependency
  chain, a data path, a call chain — the source sits elsewhere on that stream, and deepening the
  current station cannot reach it. Switch from depth to breadth: fan probes over the stream's
  stations in parallel, blind and clean-contexted, as far up and down as the stream runs, to locate
  the source. Then plan downstream from the source with the sweep's map of how far the defect
  reaches, so the remaining work carries a measured bound instead of an open count of rounds. The
  seam budget in `.claude/rules/quality.md` § Rounds and verdicts states when this fires.
- The subjective and objective lanes are the adversarial pass's FLOOR, not its shape. Where a
  subject has more seams than that pass can attack, fan out one lens per seam over disjoint slices,
  keep every lens blind and
  clean-contexted, and number every slice's claims in one shared sequence. Change the lenses in a
  successor round rather than repeating them.
- Decompose by required context and independently verifiable acceptance criteria, not by task type.
- Send instructions down fully specified. Return findings smaller than the context consumed.
- Parallelize independent work. Serialize dependencies and shared-file contention.
- The Orchestrator owns the plan and every final decision. Design engines propose, writers execute,
  auditors advise.

## Writing concurrency

Concurrent executors share a filesystem unless isolated. Follow these rules to prevent clobbered
edits, formatter and build races, cache phantoms, and validation cross-talk.

1. Serialize writing executors in the main checkout. Commit a checkpoint before each writing
   dispatch so git is the rollback mechanism.
2. Assign disjoint owned files plus explicit shared and off-limits files.
3. Keep shared files report-only. Executors return exact patches for serial integration.
4. Restrict concurrent executors to read-only, scoped validation. A tree-wide result may contain a
   sibling's in-flight failure, so an executor reports only its owned scope.
5. Give concurrent audit lanes worktree isolation whenever the campaign is uncommitted. Lanes
   sharing one working tree contaminate each other's readings in both directions.
6. After integration, clear shared caches if needed, then have one independent `verifier` run the
   authoritative tree-wide sweep. A writer's self-report never establishes green.
7. The Orchestrator's own sweep is a writing dispatch and queues behind the units that own those
   files. A script that fixes one thing across every target is the easiest way to break the
   serialization rule,
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
    question rather than an answer. A unit re-running the file alone is not alone: its own exec,
    code-mode host, and sandbox stay resident throughout, and on a small container that residue
    alone misses a deadline the same file meets on an idle one. So the deciding re-run belongs to
    the Orchestrator after the unit exits, never to the unit, and a timing failure a unit cannot
    clear is carried to that reading rather than diagnosed by the unit. This makes a writer's own
    gate evidence systematically pessimistic on timing, which is another reason the independent
    `verifier` runs the authoritative gates.
11. While any unit is live, the Orchestrator's own instruments go in its scratchpad, never in the
    subject repository's `tmp/`. A probe that both writes and deletes inside the subject tree can
    remove a file it did not create, and a cleanup keyed to a caller-supplied path list is how. The
    same directory is where dispatched units build their instruments, so removing it destroys a live
    lane's work.

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

The local steps still run, because they route the recovery rather than decide the verdict: an
unresolved CLI is an install problem, a failed authentication-state check starts the login ladder
in Recovering a dark bench, and a bench that passes both and still cannot round-trip is dark for a
reason no local check can see. Record every dark bench with its fallback and the lane substitution
it forces, and never absorb one silently. A readiness script reports readiness and performs no
model call, so the round trip belongs to the Orchestrator's own probe or to the bridge carrying
the unit, never to the hook. Liveness also expires: a dispatch that fails on quota, model access,
or the network is a fresh liveness result rather than a unit-level fault, so record the bench dark
from there and re-plan the lane instead of re-dispatching against a session-start answer that no
longer holds.

1. **Absorb.** Dispatch `grok` for terrain, prior art, and the reading the decision needs. In an
   Orkestrel repo dispatch `orkestrel` alongside it for live package state. Skip only when the
   ground is already known.
2. **Design adversarially.** Run the adversarial pass on one design brief: `planner` for
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
   engine did not write it: `reviewer` for the subjective lane and `analyst` for the objective lane,
   the way step 2 names its lanes. Run the second lane when the first returns FAIL, when the subject
   is a rendered or externally driven surface, or when the unit's claims span both correctness and
   shape. Dispatch `checker` in addition when the acceptance criteria are mechanical — counts,
   paths, parity rows, scope honesty — never in place of a lane. Record in the round's verdict file
   when a lane or the checker did not run.
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
   When the design step's exit criterion is met and the gates are green, accept. The next goal is the
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
  nodes; never run concurrent writers in the tree.
- Name a role and its engine in every node.

The harness bridge names the concrete mechanism for each of these.

### Every dispatch is a file before it is a launch

- Write the brief to a file under `tmp/`, named for its unit, before launching the unit, whatever
  engine executes it. A brief composed only inside a launch argument cannot be corrected, resumed,
  or re-run after that call ends. A native unit's pair is `tmp/units/<unit>-brief.md` and
  `tmp/units/<unit>-report.md`. A bench unit's pair sits under the bench directory its role file
  names, beside the journal.
- Write the unit's returned report in the SAME action that commits its code, never afterwards. A
  commit message states what changed; the report states what the unit measured, what it decided, what
  it could not close, and which of its own claims it flagged. An auditor's subject is the report,
  so a report living only in the Orchestrator's context stops the next lane on arrival.
- Capture the unit's returned report to a file beside its brief under the same unit name, so a
  unit's instruction and its outcome are one pair on disk.
- Amend a brief on re-run rather than restating it. A mid-campaign correction produces a successor
  file recording what changed and why, and the original stays. A fix round's brief names the
  findings it carries and where each came from.
- Name a corrected unit's effective brief and report and the pair they supersede before that unit
  integrates. A unit whose correction landed as a serial patch or a direct reconciliation, with no
  successor pair on disk, cannot be re-run from what the campaign kept.
- Write the round's verdict to `.orkestrel/<package>/<unit>-audit-verdict.md`. That file is where
  the audit step records a lane or a checker that did not run.
- Read the copy the executor will open, not the one you wrote. A brief written in the orchestrator's
  repository and staged into the subject's checkout so a `-C` invocation can reach it is a second
  file, and staging can rewrite a path or drop a clause. The executor rules on what it opens, so a
  staged copy whose facts are false stops a unit that was correctly briefed. Verify the staged path
  and its load-bearing facts before launching, and stage into a scratch directory the subject tree
  ignores rather than into the checkout root.
- Send a decision taken mid-campaign to every unit already in flight whose brief it invalidates. An
  executor cannot see a change made after it was dispatched, so it writes the state its brief
  described and the defect surfaces as its own.
- Retention is uniform for every unit, whatever engine ran it, including an Orchestrator-owned
  integration, fix, probe, or capture unit: copy the brief, the returned report or distillate, the
  audit verdict, the exact executed script or instrument, and the acceptance evidence into
  `.orkestrel/<package>/` as the unit is dispatched and as it returns, then sweep only the `tmp/`
  launch copies. A capture claim's instrument is acceptance evidence; the frames may be swept once
  the record transcribes them, because the committed instrument re-produces the film. The **Bench
  laws** rule "Ephemeral streams, durable records" owns journals and points here for everything
  durable.
- Promote anything that must outlive the campaign into a durable artifact before the sweep — a
  commit message, a guide, a rule, a retrospective. What is only in a swept file did not survive,
  and a debrief that must quote the record verbatim has nothing to quote.
- Land a process rule stated as binding mid-campaign in the owning rule or contract file in the
  same commit that states it. A campaign artifact is evidence, never a rule's home.

### Where campaign artifacts live

- Put every campaign artifact in the **orchestrator's** repository under `.orkestrel/<package>/`,
  named for the package the campaign is about.
- Give a campaign spanning several packages one shared `.orkestrel/campaign/` folder instead, so the
  wave's plan, routing ledger, and verdicts sit together rather than split across the packages they
  rule on.
- Never put them in the package they are about. A published package's tree is its product.
- Claim nothing outside `.orkestrel/` unless Orkestrel scaffold mandates it. Everything Orkestrel
  owns in a consumer's tree lives beneath that folder, so a convention can be settled there without
  colliding with a convention that is not Orkestrel's.
- Keep the campaign narrative and every ruling in the durable artifact that owns it — the guide for
  product truth, a rule or role file for process truth, the commit message for the decision itself.
  Use `ROADMAP.md` only where the repository already keeps one.
- Prefer a mechanism that recomputes a fact over a document that records it. A document recording
  live state is stale from the moment it is written, and the next campaign reads it as current.
  Where the fact can be derived, derive it: the fleet's publish order lives in the catalog table
  `scaffold catalog` regenerates, not in a written order anyone has to remember to update.
- Prune the campaign folder in a commit at acceptance. Git history is the archive; the working tree
  is the workspace. `.agents/skills/orkestrel-debrief/references/retention.md` owns the procedure —
  the checks that close the prune, the artifact locations it sweeps, and the promotion record
  the commit message carries. Run it before deleting anything.

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
  it in every brief; an executor deep in a task does not re-read this contract. Write the sentence
  for the reader the transport actually delivers it to, because "directly" names a different action
  on each side of a bridge. To a native subagent or a bench engine reading the brief inside its own
  CLI, it means do the work yourself. To a bridge driver, whose entire assignment is the launch, it
  means carry the brief across unaltered and return the journal — the engine behind the CLI is not a
  subagent the driver is spawning, and a driver told to work directly answers from its own engine
  instead. That answer reads normal and its only tell is the missing journal, so pair this sentence
  with **Bench laws** rule "Journal first" and refuse a bench result whose journal path and session
  id are absent.
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

Fill `.agents/templates/brief.md`, which carries the named scope rows and the worked reason behind
each check. Then run this checklist against what you filled.

- Name the executor that will open the brief, and write the transport for that reader. A bridge
  driver and the bench engine inside that driver's CLI need opposite instructions.
- Paste the command and its output behind every factual claim — paths, counts, registrations, file
  existence. Name the scope any search covered, and check a fact against the code rather than
  against another artifact that states it.
- Take every measurement under the conditions the unit runs in, or have the unit take it before
  doing anything else.
- Ask what the change does to every fact you measured, and fix each criterion to the state the unit
  finishes in.
- Scope the change by the files its result makes **false**, not by the files that declare the thing
  changing: the test asserting the reversed behaviour, the fixture carrying the raised value, the
  golden digest over generated output, the consumer script naming the removed union member.
- Derive that set by running the suite. Where you cannot run it, name the search's bound in the
  brief so the unit re-derives the set.
- Grant a behaviour with the tests that pin it, a constant with every fixture and expectation
  derived from it, and a template change with the materialized copy the package generates from it.
- Read each criterion against the off-limits list, line by line. Grant the file a criterion needs or
  strike that criterion. A file the change will break that appears in neither list is unscoped.
- Scope a unit that changes a mechanism to own the prose describing it. Where a brief scopes that
  prose out, name the carrier and dispatch it before the change ships.
- Give a small unrelated obligation its own unit.
- Name the property the unit must change, and stop. Record an expected consequence as an
  observation, never as a second criterion.
- Order the criteria cheap-first, so an unreachable one cannot hide a typecheck or a lint criterion
  behind it. Where the change edits a file the repository vendors or digests, the regeneration step
  precedes every gate that reads the generated artifact.
- Never make a timing-sensitive or whole-suite gate result a criterion for a unit running inside its
  own exec. Name it as an observation the unit reports with its own reading, and take the
  authoritative run yourself after the unit exits. A scoped run over the unit's owned files stays a
  legitimate criterion.
- Check the brief's output mechanism and its verification method against the executor's tool
  allowlist. A read-only lane writes no report file and runs no probe, so hand it the rendered
  evidence instead.
- Keep the brief's control identifiers inside the brief, and say in the brief that a test is named
  for what it proves rather than for the control that specified it.

### Carry every finding

After reconciling findings into briefs, walk the retained finding list once. Every finding names
the brief item that carries it. A finding with no carrier is a dropped finding.

Every finding names exactly one carrier. A further brief claiming the same finding is not redundancy
that costs a little duplicated work — it is a conflict the executor discovers mid-unit, between
documents you told it to obey, with no way to tell which you meant. It will either implement the row
twice or stop. Where a reconciliation table and a brief disagree about who owns a row, the brief the
executor opens wins, and you fix the other one before the second unit launches.

## Long-running commands

A bench exec, a Workflow, an install, a build, and a publish chain are one class of thing: a
command that outlives the turn that started it. Every law here binds all of them.

### Launching

- The Orchestrator launches every long command as a harness-tracked background command under a hard
  time cap. Never detach one from inside a dispatched agent. The harness owns the lifecycle,
  completion re-invokes the session, and the cap kills a wedged command loudly instead of trusting
  the agent to report its own failure. A wedged bridge is silent, and silence must never read as
  progress.
- Never replicate git commits through a hosting provider's REST API when a file's content must ride
  inside the tool-call JSON. The per-call read cap truncates it, and a lockfile is the file that
  proves the point: it transits incomplete and the tree it lands in installs something else. Push
  over git, or move the file another way.
- Write a multi-step chain to a script file and run the file. A chain composed inside one shell
  argument cannot be read back, corrected, or re-run, and the record of what actually ran is the
  argument text in a transcript rather than a file on disk.
- Never edit a script file while a shell is executing it. `bash` reads a script incrementally from a
  byte offset rather than loading it, so an edit that shifts line numbers moves the text under that
  offset and the shell resumes mid-construct. The run dies on a syntax error in a line the script
  does not contain, which reads as a defect in the work rather than as the edit that caused it. Copy
  the file, edit the copy, and launch the copy for the next run.
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
  publish chain relaunched over a live one reports `EOTP` and `E403` that are its own processes
  colliding, and both readings point at the registry.
- Never ask `pgrep -f` or `ps | grep` whether a command is running from a shell whose own command line
  contains that command's text. The shell matches itself, so the answer is yes whatever the truth is.
  This bites in separate places and each one fails differently:
  - **A liveness watcher** loops forever, reporting "still running" and never delivering its completion
    notification, because it always finds itself.
  - **An elapsed-time reading** returns the watcher's age rather than the exec's, so the number falls
    instead of rising and reads as a relaunch that never happened.
  - **A pre-launch "is anything already running" check** reports a phantom concurrent writer, which is
    the worst of them: the honest response to it is to kill something, and there is nothing there.
    Read liveness from the recorded process id with `kill -0 <pid>`, or enumerate by executable name and
    parent with `ps -eo pid,ppid,comm` and read the rows. Both are immune; a pattern over the full command
    line is not.
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
invocation, flags, paths, probe, and recovery ladder; these laws bind every bench regardless of
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
4. **One lane at a time per bench.** Launch one `grok` lane at a time and queue the rest. Lanes past
   that starve the bench: it accepts each launch and the lanes come back empty, which reads as the
   work failing. Re-probe before ruling on an empty lane. A probe that round-trips while the lanes
   return empty names starvation, not darkness — cut the concurrency and re-run the lane, rather
   than recording the bench dark and substituting an engine.
5. **A bench sandbox spawns a child and denies that child's child.** Under `workspace-write` a bench
   exec runs a test suite and spawns children normally, and every operation one level deeper fails:
   a grandchild process is denied `EPERM`, and a nested `npm install` is denied the same way. So a
   proof needing a process tree, a tree-kill, a detached group, or an installed package cannot be
   produced inside a bench unit at all — however carefully that unit isolates. Name the limit in the
   brief before dispatch, tell the unit to record such a proof as an observation naming the exact
   settling command, and take that proof yourself on the host. Never let a unit substitute the
   reachable half: linking a packed tarball is not installing it, and a gate written to catch an
   install failure that only ever links cannot see the defect it exists for.
   Not every symptom names the sandbox. A nested process and a nested install fail `EPERM`, which
   reads as a denial; a nested `git` invocation instead reports **"not a git repository"** while the
   unit's own `git status` succeeds a moment earlier. That one reads as a broken checkout, and a unit
   acting on it will go looking for damage that is not there. Tell a unit which of its tools shell out
   one level down — a scaffolding CLI that probes git, a formatter that spawns a worker — so it
   recognises the shape instead of diagnosing the tree.
   The child a bench does create has unreliable stdio, and that failure wears a worse disguise than a
   denial. A Node process spawned by a bench unit's own Node process has been measured both buffering
   its pipe until EOF and publishing nothing at all, so no workaround built on either reading is
   dependable. Any subject whose behaviour lives in a child's pipes is therefore unmeasurable inside a
   bench: a stage driving a language server, a protocol fixture, a built entry driven as a spawned
   child. It fails as a **false green**. The stage never arms, the boot inspection times out, and that
   timeout produces the same rejection a genuine stage timeout produces, so a test asserting on the
   message passes inside the bench while the host's gate reports the honest red — and neither run
   reports why they disagree. Route such a subject to the harness's native implementer, or keep it on
   the bench and supply every executed measurement yourself. Never dispatch it to a bench and expect
   it to prove its own work. The shape to recognise is a child that exits 0 almost immediately, a
   request to it that never resolves, and a stack landing in the spawning code's exit handler.
   **When a bench sandbox denies a loopback listener, `listen` fails `EPERM` on every address.** A
   subject needing a real local server is unmeasurable inside the bench. Name the limit in the brief
   before dispatch. Have the unit report the reading as an observation naming the exact command.
   Take the proof on the host.
   **When a brief assigns a bench unit a path outside the obvious source tree, name the write limit
   in the brief.** If the sandbox rejects the patch, the unit stops and reports the rejection. Never
   find another write mechanism.
6. **Ephemeral streams, durable records.** A journal proves a bench is alive and recovers an
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
starting another. Publish serially, because concurrent publishes collide on the authentication
handshake and fail each other.

The release itself runs from the `orkestrel-publish` skill: the wave's per-repo visit and its bump
triggers in `references/wave.md`, and the preparation order, the login approval, and the
five-minute upload window in `references/window.md`. Load the skill when the user asks for a
release, and follow it there rather than reconstructing the procedure here. What remains in this
section binds an executor who is not publishing.

### Fixing a dependency before it publishes

A defect a consumer meets sometimes lives in a package the consumer only has from the registry.
Waiting for that package to publish before the consumer can prove its own fix serializes releases
that could have been one. Do not wait, and do not work around it in the consumer.

Build the dependency from source, pack it, and **install the tarball** into the consumer.

- **Install it, never link it.** A link resolves through a directory and skips the packing, the
  `files` list, and the exports map — which is most of what a distribution proof exists to check. A
  gate written to catch an install failure that only ever linked cannot see the defect it exists for.
- **Write the swap to a script and run the file**, so the build, the pack, and the install are one
  artifact the next run reuses rather than a command nobody can read back.
- **Record the range you replaced** in the same step that replaces it. A consumer sitting on an
  unpublished tarball with no record of what it had is a consumer nobody can restore.
- **Rebuild and repack whenever the source moves.** A stale tarball is the same defect as a stale
  `dist/`, and it is worse for being invisible: the consumer's gates go green against a fix that no
  longer exists in the dependency's tree.
- **Restore the registry copy before any gate that must prove the published artifact, and before
  publishing anything.** A distribution proof run against a local tarball proves the local tarball.
  The release still follows layer order: the dependency publishes first, then the consumer re-pins to
  the version the registry now serves and re-runs its gates against that.
- **Keep the tarballs out of the tree.** They belong under `tmp/`, they are swept at acceptance, and
  they are never committed.

The tarball is a head start, not a shortcut. It lets the consumer's work proceed and its proofs run
against the real packed artifact while the dependency's own release is still being prepared.

### What a bump obliges

A runtime dependency and a development dependency have different blast radius, and confusing them
either publishes packages nobody needed to publish or leaves a consumer pinned to an older release.

- A **runtime** `dependencies` bump reaches every consumer of the published package. Every package
  downstream of it re-pins, re-runs its gates, bumps, and republishes, in layer order.
- A **development** `devDependencies` bump reaches nobody. Re-pin it, prove the gates still green,
  and commit to `main`. Do not bump the version and do not publish.
- A development bump that moves the published artifact is no longer a development bump. Prove the
  direction with the build, not the diff of sources: rebuild after the re-pin and compare `dist/`
  against the published tarball. Compare material content only — exclude sourcemaps and ignore
  whitespace-only differences; a superfluous diff (formatting, blank lines, map noise) moves
  nothing and obliges nothing. A material diff — tokens, declarations, logic — means the published
  surface moved — a forced `src` or `app` edit and a toolchain-changed emit both surface here — so
  that package bumps and publishes on its own account, and its own dependents follow the preceding
  runtime rule.

Every package is `0.0.x`, where a caret pins one exact release. A dependent therefore sees a new
version only after it re-pins and republishes, so the fleet publishes in topological layer order
derived from runtime `dependencies` alone. Layers exist for a reason a flat pass cannot fix:
ranges that disagree install duplicate copies of the same package, and the compiler reads them as
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

## Acceptance laws

- No writer's and no external engine's self-assessment is authoritative.
- Never spend Opus 5 or Sol on absorption, distillation, scouting, or mechanical edits. Never route
  judgment-bearing implementation away from Opus 5 or Sol.
- Substitute an engine only when the same session records the bench dark — CLI missing, auth
  expired, model unavailable. Name the fallback in the plan; never improvise it silently. The
  tedious-work ladder is the only pre-approved substitution, and each step down it is still recorded.
- Never run the lanes on different briefs, and never show either one the other's answer before
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
