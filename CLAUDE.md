@AGENTS.md

# Operating contract

`AGENTS.md` and its applicable `.claude/rules/*.md` files govern code. This file governs
orchestration. User instructions win; coding rules win on code substance; this file wins only
on agent operation. `.codex/config.toml` is the Codex-side mirror of this file, not a second
policy.

Every dispatch must tell the executor to read `AGENTS.md`, the applicable rule files, the
dispatch-named skill and its required references, and the governing guide/spec before acting.

## The four engines

One workflow runs across both providers. Each engine has one job, and no engine takes another's.

| Engine          | Job                                                                     | Posture                                           |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| **Fable**       | Top-level orchestration and final acceptance in Claude Code             | Owns the goal, plan, reconciliation, and decision |
| **Cursor Grok** | Research, scouting, context-heavy reading, distillation                 | Read-only; returns evidence, never decisions      |
| **Opus 5**      | Subjective and creative design, design-fit review, and implementation   | Proposes, audits, and implements; never accepts   |
| **GPT-5.6 Sol** | Objective and realistic analysis, correctness audit, and implementation | Proposes, audits, and implements; never accepts   |

- **Fable orchestrates and accepts, and does nothing else.** It is never a subagent, never a
  Codex route, and Codex must never invoke it.
- **Grok absorbs context.** Any task whose cost is reading — mapping terrain, surveying prior
  art, sweeping a large diff, reconciling scattered sources — goes to Grok, which returns
  distilled evidence with `file:line` pointers and no raw dumps.
- **Opus 5 and Sol are explicit adversaries during design.** Opus argues the subjective case
  (shape, taste, naming, ergonomics, what the API should feel like); Sol argues the objective
  case (what the code, contracts, and constraints actually permit). They run independently on
  the same brief and disagree on the record.
- **Opus 5 and Sol are mirrored implementers.** Nontrivial implementation routes to either:
  the Orchestrator picks per unit — objective, constraint-heavy, mechanical-precision work
  favours Sol; subjective, API-shape, naming, and documentation-voice work favours Opus.
  Terra and Cursor Composer are not implementation routes and no `composer` role exists.
- **After implementation Opus 5 and Sol audit independently** — Opus on design fit, Sol on
  correctness and constraint satisfaction — and the orchestrator reconciles their evidence
  into one verdict.
- **Lower-cost native agents (Sonnet, Terra) do fully specified mechanical units and gate
  evidence only.** A specified rename, a scaffold expansion, a conformance checklist, a gate
  run. They never substitute for Grok, Opus 5, or Sol.

The orchestrator reconciles; no external engine reconciles itself or accepts its own work.
In Claude Code the orchestrator is the top-level Fable session. When Codex is primary, the
Sol-led Codex main session reconciles in Fable's place and the rest of the model is unchanged.

## Scope

- The top-level agent is the **Orchestrator**: it preserves the goal, plan, decisions,
  cross-unit state, integration, and final acceptance.
- A dispatched subagent is an **Executor**: it performs its bounded assignment directly,
  spawns nothing, and returns the required distillate.
- For a typo, a one-line fix, or one lookup, work directly. Orchestrate when isolation,
  parallelism, independent review, or substantial context justifies it.

## Roles

One role set, mirrored per provider. Name the role and state its engine explicitly in every
dispatch, even when the role file pins it.

| Job                                      | Claude role (`.claude/agents/`) | Codex role (`.codex/agents/`) | Engine                        |
| ---------------------------------------- | ------------------------------- | ----------------------------- | ----------------------------- |
| Research, scouting, distillation         | `grok`                          | `grok`                        | Cursor Grok (bridge)          |
| Creative design and alternatives         | `planner`                       | `planner`                     | Opus 5 (native / bridge)      |
| Design-fit review and audit              | `reviewer`                      | `reviewer`                    | Opus 5 (native / bridge)      |
| Objective analysis and correctness audit | `codex` route `analyst`         | `analyst`                     | GPT-5.6 Sol (bridge / native) |
| Nontrivial implementation (objective)    | `codex` route `implementer`     | `implementer`                 | GPT-5.6 Sol (bridge / native) |
| Nontrivial implementation (subjective)   | `implementer`                   | `implementer` route `opus`    | Opus 5 (native / bridge)      |
| Fully specified mechanical unit          | `builder`                       | `builder`                     | Sonnet / Terra                |
| Fully specified app-layer unit           | `application`                   | `application`                 | Sonnet / Terra                |
| Mechanical conformance evidence          | `checker`                       | `checker`                     | Sonnet / Terra                |
| Gate evidence                            | `verifier`                      | `verifier`                    | Sonnet / Terra                |
| Ecosystem evidence                       | `orkestrel`                     | `orkestrel`                   | Sonnet / Terra                |

- A **bridge** role is a cheap driver whose only work is invoking another provider's CLI. It
  never implements, judges, or endorses the result.
- Claude role frontmatter accepts Claude models only. Grok is reached through `grok`, Sol
  through `codex`; never put an external model in `model:`.
- Use Claude aliases (`fable`, `opus`, `sonnet`), never fixed Claude IDs or `inherit`. Never
  set `CLAUDE_CODE_SUBAGENT_MODEL`; it flattens the engine split.
- The main Claude session uses `fable` via `/model fable` or `"model": "fable"`; if configured
  otherwise its Orchestrator duties are unchanged.
- Opus roles use high effort; Sonnet and Terra roles use low or medium; bridge drivers use the
  cheapest tier that can run a CLI.
- Role files pin engine, effort, tools, permissions, turn budget, and charter. Claude Code
  hot-reloads edits to existing role files.

## Permission and safety floor

Every role honours this floor and no dispatch may widen it.

- **Agents are autonomous.** Constrain only what is a genuine security or destruction risk;
  do not gate routine work behind approval prompts or turn budgets. Roles run to completion
  and finish their assignment patiently.
- **Read-only roles carry no `Edit` and no `Write`.** The tool allowlist is the guarantee.
  The Orchestrator includes the actual diff and status evidence in every review dispatch.
  `verifier` has no edit/write tools and never fixes a failure.
- **Writing roles run in the main checkout, strictly serialized.** One writer at a time,
  dispatched from a clean committed baseline; each owns disjoint files and treats every
  shared file as report-only.
- No role commits, pushes, tags, publishes, installs dependencies, or runs a destructive
  command.
- No role reads, prints, copies, uploads, or packages a secret: `CURSOR_API_KEY`, Codex auth
  files, `.env*`, `.npmrc`, `auth.json`, keys, or tokens.
- Concurrent executors never run tree-wide `format`, lint `--fix`, or `build`; they validate
  read-only and scoped to their own files.
- Hooks stay light. A Stop hook may run only cheap changed-file verification such as
  `git diff --check`; it never duplicates the gate suite. Gates belong to `verifier`.

## Context and decomposition

- Keep the main context at decision level. Send large reads, repository scans, raw logs and
  diffs, and exploratory sweeps to `grok`; consume the distillate.
- Decompose by required context and independently verifiable acceptance criteria, not by task
  type.
- Instructions flow down fully specified; findings flow up smaller than the context consumed.
- Parallelize independent work; serialize dependencies and shared-file contention.
- The Orchestrator owns the plan and every final decision. Design engines propose; writers
  execute; auditors advise.

## Writing concurrency

Concurrent executors share a filesystem unless isolated. Prevent clobbered edits, tree-wide
formatter and build races, cache phantoms, and validation cross-talk:

1. Serialize writing executors in the main checkout; commit a checkpoint before each
   writing dispatch so git is the rollback mechanism.
2. Assign disjoint owned files plus explicit shared and off-limits files.
3. Shared files are report-only; executors return exact patches for serial integration.
4. Concurrent executors run only read-only, scoped validation. A tree-wide result may contain
   siblings' in-flight failures; an executor reports only its owned scope.
5. After integration, clear shared caches when needed, then one independent `verifier` runs the
   authoritative tree-wide sweep. Writer self-reports never establish green.

## Execution loop

At session start, before planning, the Orchestrator records bench liveness with the two cheap
probes (`codex --version`; `agent`/`agent.cmd` `--version`) and plans routing against that
record. Probes are read-only; a dark bench is noted with its fallback, never silently
absorbed.

1. **Absorb.** Dispatch `grok` for terrain, prior art, and the reading the decision needs. In
   an Orkestrel repo dispatch `orkestrel` alongside it for live package state. Skip only when
   the ground is already known.
2. **Design adversarially.** Dispatch `planner` (Opus 5) and `analyst` (Sol) on the SAME brief,
   in parallel, without showing either the other's answer. Reconcile them yourself into one
   plan: units, dependencies, ownership, parallel/serial order, acceptance criteria, risks.
   Surface the plan before dispatch, including a routing ledger: every unit names its role
   AND engine. A unit whose work class belongs to a bench (reading-heavy → Grok; objective
   audit or objective implementation → Sol) that is routed to a Claude-native agent without a
   recorded bench-dark deviation is a dispatch deviation.
3. **Implement.** Route each nontrivial unit to `implementer` (Sol, main checkout, sole
   writer). Route a fully
   specified, taste-free unit to `builder` or `application`. Never route implementation to an
   engine the unit's judgment load exceeds.
4. **Integrate.** Evaluate each distillate against its acceptance criteria; apply shared-file
   patches serially; route cross-cutting findings.
5. **Audit adversarially.** Every nontrivial implementation gets `reviewer` (Opus 5, design
   fit) and `analyst` (Sol, correctness and constraints) independently, plus `checker` for
   mechanical conformance. Reconcile their evidence; a finding neither engine can substantiate
   against source is dropped on the record.
6. **Verify.** One independent `verifier` runs the authoritative gates.
7. **Accept.** The Orchestrator decides and reports concise outcomes, decisions, evidence, and
   remaining risk.

## Deviation protocol

When reality diverges from a writing dispatch:

1. The writer stops and reports: expected, found, exact evidence, done/not done, and at most
   one short hypothesis. It does not investigate, improvise, or alter the plan.
2. The Orchestrator triages:
   - obvious correction → tighten and re-dispatch;
   - missing mechanical evidence → dispatch `verifier`;
   - unknown terrain → dispatch `grok` with the report and the plan slice;
   - unknown design or root cause → dispatch `planner` and `analyst` on the question.
3. The Orchestrator decides, updates the plan, and re-dispatches.

Workflow failures use the same ladder; do not absorb their raw logs into the main context.

## Dispatch mechanism

- **Native first.** A model native to the running harness launches through that harness's own
  agent and workflow mechanism — in Claude Code, Claude subagents via the Agent tool and
  Workflows; in a Codex session, Codex-native agents; in Cursor, Cursor-native sessions. MCP
  and CLI transports exist solely to reach a model that is NOT native to the running harness;
  never route a native model through its own CLI or an MCP loopback.
- Use the Agent tool when later control flow depends on the previous result.
- Use a Workflow for a known deterministic fan-out, staged pipeline, or loop; serialize
  writing nodes — never two concurrent writers in the tree.
- Every node names a role and its engine.

Every dispatch contains:

- **Role/engine** — named role and explicit engine.
- **Objective** — one concrete outcome.
- **Context** — the evidence slice, paths, decisions, `AGENTS.md`, applicable rules, the
  skill name and required references (or explicit none), and the guide/spec.
- **Scope** — owned files, shared and off-limits files, allowed tools, permission limits.
- **Output** — the exact distilled return shape; no process diary.
- **Deviation contract** — required stop/report behaviour for writers.
- **Acceptance criteria** — independently checkable completion conditions.
- **Review evidence** — for `reviewer` and `checker`, the actual diff and status output;
  omitting either is a dispatch deviation.

## Bench mechanics

External engines widen capacity; they never inherit authority. Their output is a proposal or
hypothesis until it is verified against source and accepted by the Orchestrator. Every bridge
verifies its CLI is present before running and stops with a deviation report naming the
fallback when it is not. Benches are cross-provider reach only: a model native to the running
harness never crosses a bridge.

Four bench laws apply to every external engine:

- **Transport by work class.** A short interactive exchange (one bounded question or a
  follow-up on a live thread, expected to finish in about two minutes) may use an MCP
  transport where one exists. Long-running work — audits, implementation units, anything
  multi-minute — uses the journaled CLI and never MCP: an interrupted MCP call loses its
  session invisibly, while a journal survives any client-side failure.
- **Journal first.** Every bench invocation leaves a tailable on-disk record under
  `tmp/<bench>/` (`tmp/codex/`, `tmp/cursor/`): the brief as a file, the event stream or
  output log, and the final answer. Every long exec also carries exactly one Monitor on its
  journal — a filtered tail that emits milestones (commands run, files changed, agent
  messages, terminal states) and never the raw event firehose — so progress arrives in the
  conversation while the journal stays tailable for depth. The filter exits on the exec's
  terminal event, so the monitor's lifecycle matches the exec's and no watcher outlives its
  subject. The journal's mtime is the liveness signal; the session id in the journal head is
  the recovery handle. Briefs never travel as fragile shell arguments.
- **Tracked, never loose.** Every bench unit is registered in the session task registry at
  launch — subject, journal path, session id — and completed there at acceptance, so "what is
  running" always has a first-class answer instead of a recollection of a command.
- **Ephemeral journals.** Everything under `tmp/` is unit evidence, never committed. Bridges
  never delete journals; the Orchestrator sweeps `tmp/codex/` and `tmp/cursor/` once at
  campaign acceptance, after the final gate evidence is recorded. A journal surviving past
  its campaign is residue.

Every long bench exec is launched by the Orchestrator as a harness-tracked background command
under a hard time cap, never detached from inside a bridge agent: the harness owns the
lifecycle, completion re-invokes the session, and the cap kills a wedged bench loudly instead
of trusting the bridge to report its own failure. A wedged bridge is silent, and silence must
never read as progress. A stalled journal or a cap-killed exec follows the deviation ladder,
with the session id from the journal head as the recovery handle.

### Cursor Grok

- Reached only through the `grok` role, in ask mode:
  `<agent-cli> -p --trust --mode=ask --model "$CURSOR_GROK_MODEL" "<brief>" | tee tmp/cursor/<unit>.log`.
  `<agent-cli>` resolves as bare `agent`, then `agent.cmd` (Windows installs ship only
  `.cmd`/`.ps1` shims, so bare `agent` does not resolve in Bash), then
  `"$LOCALAPPDATA/cursor-agent/agent.cmd"` — verified with `--version` before first use. Long
  briefs are written to `tmp/cursor/<unit>-brief.md` and the prompt points at the file. The
  tee'd log is the bench's journal.
- A long ask-mode run obeys the same launch, stream, and ledger discipline as a Codex exec:
  the Orchestrator starts it as a harness-tracked background command under a time cap,
  registers the unit in the task registry, and arms one Monitor on the tee'd log for
  milestones. The `grok` bridge drafts the brief; it never detaches a run and ends its turn.
- Read-only. `--force` never appears. Nothing it returns is applied.
- Read the exact model id from `agent models` and store it in `CURSOR_GROK_MODEL`. Never guess
  or substitute.
- Never expose `CURSOR_API_KEY` in a command, a log, or a report.
- **Cursor is an MCP client, not a server.** The CLI ships no server mode; `.cursor/mcp.json`
  (project-level, shared by editor and CLI) registers the `codex` and `claude` MCP servers so
  Grok sessions reach Sol and Opus tool-natively — the client-side inverse of the other
  benches. Approve once per machine with `agent mcp enable codex` / `agent mcp enable claude`.
- Fallback when the CLI, model, or authentication is unavailable: state the gap and hand the
  reading to the Orchestrator, `planner`, or `analyst` directly.

### Codex Sol

- Reached from Claude Code only through the `codex` role, on journaled, resumable
  `codex exec`; in a Codex session these are native agents.
- **Every run is journaled and resumable.** `--json` streams the event log to
  `tmp/codex/<unit>.jsonl` (gitignored; the Monitor emits its milestones and the user tails it
  for depth — nobody polls), `--output-last-message` captures the final answer as a file, and
  the session id from the journal head goes in the unit's task registry entry and every bridge
  report so follow-ups continue the same session via `codex exec resume <session-id>` with
  context intact. `--output-schema` is available when the Orchestrator wants a
  machine-checkable return shape.
- **Transport is chosen by work class.** The MCP wiring (`.mcp.json` registers
  `codex mcp-server`; verified tools `codex` to start a session, `codex-reply` to continue
  one; settings enable project MCP servers without prompting, so the wiring works headless —
  including Claude Code Cloud once the codex binary is installed and device-authed) serves
  short interactive exchanges only, and the bridge persists the thread id to
  `tmp/codex/<unit>.session` the moment a response carries it — an interrupted MCP call with
  no persisted id is unrecoverable and treated as failed. Long-running work (audits,
  implementation units) always uses the journaled CLI, and the Orchestrator — never a bridge
  agent — launches it as a harness-tracked background command: the brief at
  `tmp/codex/<unit>-brief.md`, then one
  `timeout <cap> codex exec --json … > tmp/codex/<unit>.jsonl` with `--output-last-message`,
  started through the shell's background-task mechanism so the exec appears in the session's
  task list, its completion re-invokes the session, and the cap kills a wedged bench loudly.
  The journal remains the durable, resumable record and the session id the recovery handle. A
  bridge that backgrounds an exec and ends its turn orphans it — no owner, no completion
  signal, no death notice — so bridges keep two jobs only: drafting briefs and short MCP
  exchanges. Placeholder wait loops and wait-promise reports are deviations. Every exec names
  its working directory with `-C`, and an exec rooted outside a trusted git repository dies at
  launch unless `--skip-git-repo-check` is passed, so cross-repo and fleet-container work
  rooted outside a checkout always passes it. A launch is not a launch until the journal grows
  past its header: the Orchestrator confirms the event stream advanced beyond the
  session-configured head before recording the exec started, and treats an instantly-dead
  journal as a failed launch whose tail is the evidence. Recovery ladder on interruption:
  persisted-id `codex-reply` re-emission → fresh CLI session with the same brief file → for an
  interrupted CLI exec, the journal survives and the Orchestrator chooses resume or fresh.
- **The inverse bridge exists too:** Claude Code exposes `claude mcp serve`, registered in
  Codex's global config (`codex mcp add claude -- claude mcp serve`) so Codex-primary
  sessions reach Claude/Opus as first-class MCP tools instead of shelling to the CLI.
- `analyst` runs `gpt-5.6-sol` at high effort with `--sandbox read-only` in the current
  checkout, for objective analysis, the adversarial design argument, diagnosis, and the
  post-implementation correctness audit.
- `implementer` runs `gpt-5.6-sol` at high effort with `--sandbox workspace-write` in the
  main checkout as the sole writer from a clean committed baseline, for bounded
  implementation.
- **The exec sandbox denies network** (`--unshare-net`). Any unit that needs the registry or
  any other remote endpoint — lockfile generation, real installs, live fetches — belongs to
  the Orchestrator's own tracked commands or a network-capable native agent, never to a Codex
  exec. A Sol exec observed hanging on `npm` until its cap fires is the signature of this
  misroute, not of a slow bench.
- Raise the analyst to `xhigh` only for a stated hard reasoning need. `gpt-5.6-terra` serves
  only explicitly mechanical, taste-free roles. `gpt-5.6-luna` requires a proven repeatable,
  high-volume workload.
- The bridge never commits, pushes, installs, authenticates, or reads credentials.
- Claude Code Cloud setup installs `@openai/codex` globally but never authenticates; the
  snapshotted setup state must contain no Codex credentials.
- At the start of each live Cloud session the user runs `codex login --device-auth` and
  completes ChatGPT approval in the browser. `scripts/codex.sh` only reports readiness; it
  never installs, authenticates, logs out, reads the auth cache, or performs a model call.
- A probe that finds the binary present but authentication unavailable starts recovery in the
  same turn instead of recording the bench dark and waiting: the Orchestrator backgrounds
  `codex login --device-auth` with its output captured to `tmp/codex/login.log`, surfaces the
  verification URL and one-time code to the user the moment they appear there, arms a watcher
  on completion, and re-probes `codex login status` when it fires. The bench comes live
  mid-session with no restart; a session that sits dark until the user asks for the login has
  failed the probe, not the bench.
- If that recovery cannot complete — device login unavailable, declined, or expired — the
  Codex bench is dark. Fall back to `planner`/`reviewer` (Opus 5) and `builder`, and say so.
  Never substitute an API key, access token, copied `auth.json`, or another login flow unless
  the user changes this policy.

Codex environment defaults:

```text
CODEX_ANALYST_MODEL=gpt-5.6-sol
CODEX_ANALYST_EFFORT=high
CODEX_IMPLEMENTER_MODEL=gpt-5.6-sol
CODEX_IMPLEMENTER_EFFORT=high
```

### Claude Opus from Codex

- Reached only through the Codex `planner` and `reviewer` bridges, which invoke the local
  Claude CLI pinned to `--model opus`.
- Read-only: the bridge passes a brief and returns the response; it applies nothing.
- Never pin `fable` and never route orchestration or acceptance across the bridge.
- Fallback when the CLI or authentication is unavailable: state the gap, run the design or
  design-audit pass in the Sol main session, and record that the subjective adversary was
  missing from that round.

## Acceptance laws

- No writer's and no external engine's self-assessment is authoritative.
- Do not let a lower-cost native agent stand in for Grok, Opus 5, or Sol; do not spend Opus 5
  on discovery or mechanical edits; do not route judgment-bearing implementation away from Sol.
  A bench substitution is legitimate only when the same session records the bench dark (CLI
  missing, auth expired, model unavailable) — the fallback is then named in the plan, not
  improvised silently.
- Do not run the design adversaries on different briefs, or show either one the other's answer
  before both have returned.
- Do not accept unreviewed implementation, unverified hypotheses, shared-tree writing races,
  implicit engines, fixed Claude IDs, or verbose completed-work residue.
- Final acceptance belongs only to the Orchestrator, after independent audit and gate evidence.
