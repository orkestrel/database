# Codex transport contract

The transport contract every Claude-side driver follows when it carries a brief to the
GPT-5.6 Sol bench: work class to transport, the exact exec form, journalling, session ids,
and recovery. Reach a route by its own name — `analyst` for audit, `sol` for
implementation. This file is a contract, not a role: it is never dispatched, and the
drivers that bind it pin their own tools, model, effort, and permission mode.

You dispatch the external Codex Sol bench.

Read `.agents/orchestration.md` first. It owns the role set, the routing, and the dispatch
contract.

The dispatch names exactly one route and includes the objective, evidence slice, rules,
skill, guide or spec, scope, output contract, and acceptance criteria. Spawn no Claude
agent, never implement directly, and never treat Sol's response as authoritative.

## Models and effort

```text
CODEX_ANALYST_MODEL=gpt-5.6-sol
CODEX_ANALYST_EFFORT=high
CODEX_IMPLEMENTER_MODEL=gpt-5.6-sol
CODEX_IMPLEMENTER_EFFORT=high
```

Raise the analyst to `xhigh` only for a stated hard reasoning need. Use `gpt-5.6-terra`
only for explicitly mechanical, taste-free roles. Use `gpt-5.6-luna` for absorption,
distillation, scouting, and bounded research when the Cursor bench is dark — it sits
between Cursor Grok and Sonnet on the tedious-work ladder, and the substitution is
recorded. Never switch models silently.

## Transport — pick by work class

- **Short interactive exchange** (one bounded question or a follow-up on an existing
  thread, finishing in about two minutes): use the MCP tools. `mcp__codex__codex` starts
  the session; `mcp__codex__codex-reply` continues it. Persist the thread id to
  `tmp/codex/<unit>.session` the moment a response carries it. An interrupted MCP call
  whose id was never written to disk is unrecoverable, and that exchange is then failed.
- **Long-running work** (audits, implementation units, anything multi-minute): the
  journaled CLI is mandatory, the MCP tools are forbidden, and you do not launch it. A
  long MCP call is one interruption away from losing the session invisibly, and a
  backgrounded exec you start and walk away from has no owner, no completion signal, and
  no death notice. Prepare it and hand it back.

## Prepare the journaled CLI launch

Your jobs are drafting the brief and running short MCP exchanges. For long work you
prepare the launch and return it; the Orchestrator runs it as a harness-tracked
background command under a hard cap.

Create `tmp/codex/`, then write the full brief to `tmp/codex/<unit>-brief.md`. Briefs
never travel as shell arguments. Return the exact resolved command with a pointer prompt:

`timeout <cap> codex exec --json -C <working-directory> --sandbox <route-sandbox> --model gpt-5.6-sol -c "model_reasoning_effort=\"high\"" --output-last-message tmp/codex/<unit>-last.md "Read and execute the brief at tmp/codex/<unit>-brief.md exactly. Your final message must be the report it specifies." < /dev/null > tmp/codex/<unit>.jsonl`

- Return the brief path, that resolved command, and the journal path. Leave
  `<cap>` unresolved — the Orchestrator owns it, per **Long-running commands → Launching**
  in `.agents/orchestration.md`. You hold no record of prior runs.
- Never launch, background, poll, sleep-loop, restart, or kill an exec.
- Keep `< /dev/null`. A background-launched exec that inherits an open stdin pipe wedges
  before its first event, and only the cap ever surfaces it.
- Add `--skip-git-repo-check` when the working directory is outside a trusted git
  repository, and `--output-schema <file>` when the Orchestrator supplies one.
- The journal at `tmp/codex/<unit>.jsonl` is the live progress record and its mtime is
  the liveness signal the Orchestrator watches. Never re-print the stream into your report.
- The Orchestrator reads Sol's answer from the `--output-last-message` file rather than
  stdout, and records the session id (`thread_id` in the journal's opening events)
  beside the result; a follow-up on a finished exec is a fresh dispatch.

## The exec sandbox denies network

`codex exec` runs with `--unshare-net`. Any unit needing the registry or another remote
endpoint — lockfile generation, real installs, live fetches — belongs to the
Orchestrator's own tracked commands or a network-capable native agent. Never put it in a
brief. A Sol exec hanging on `npm` until its cap fires is this misroute, not a slow bench.

The namespace has its own loopback, so a host daemon on `127.0.0.1` is unreachable and a bind can
fail `EPERM`. It has no IPv6, so `::1` fails `EAFNOSUPPORT`. Any proof that must reach a daemon,
bind a port, or drive a built server belongs outside the exec.

## The exec sandbox mounts `.git` read-only

A `workspace-write` exec can write the working tree and cannot write `.git`. Every command
that takes the index lock fails, `git checkout -- <file>` included.

Never write a git command into a brief as a mechanism. A unit that must restore a file it
mutated restores it by rewriting the original text, and proves it with
`git diff --exit-code -- <file>`, which reads the index without locking it. Reading commands
— `status`, `diff`, `log` — are unaffected and stay available.

## Recovery ladder

On any interruption or missing result, in order:

1. Interrupted MCP call with a persisted thread id → `mcp__codex__codex-reply` asking Sol
   to re-emit the complete final report. The reasoning may have finished server-side.
2. No persisted id, or the reply fails → prepare a fresh journaled CLI launch with the
   same brief file and return it.
3. Interrupted CLI exec → the journal survives. Report the thread id and the last journal
   events as a deviation, and let the Orchestrator choose resume or fresh.

`codex exec resume <session-id>` inherits the session's sandbox, model, effort, and
working directory, and rejects `--sandbox`, `--model`, `-c`, and `-C`. Only output flags
and the prompt are valid on a resume. A read-only session can therefore never be resumed
into a writer, so implementation always gets a fresh `workspace-write` session.

## Analyst route

Sandbox `read-only`, current checkout. Use for the objective design argument, diagnosis,
correctness and security audit, and constraint review. Capture repository status before
and after. Require evidence for every claim and return unsupported claims as dropped.

An audit brief states its subject as a numbered list of falsifiable claims rather than a
diff to read, and requires Sol to attempt refutation. The Falsification section of
`.claude/rules/quality.md` owns the method and the evidence each verdict carries. The verdict shape
defaults to `orkestrel-falsify`; a dispatch may name a different skill that fixes another. That
skill owns the value set and the terminal line. Point the brief at both; restate neither.

## Implementer route

Sandbox `workspace-write`, main checkout, sole serial writer from a clean committed
baseline, with owned files, off-limits files, and a deviation contract. The brief forbids
dependency installation, commits, pushes, publishing, credentials, destructive commands,
shared-file edits, and tree-wide mutating gates.

The Orchestrator verifies the finished exec with direct evidence — git status, the diff,
scoped validation — and carries touched files, diffstat, and deviation state into
integration and review.

## Routing exclusion — defensive negative-test units

The provider applies a content-safety filter that terminates a turn mid-run when the work
requires authoring or reproducing a violation construct, even when the purpose is to prove
a guard rejects it: sandbox escapes, resolution-bypassing imports, boundary evasion,
injection payloads, credential-handling probes. The filter reads the construct, not the
intent, so a legitimate negative test trips it exactly like an attack would. Observed twice
on one unit, at the same point in the work, with nothing written to disk either time.

Route such a unit to the native Opus `implementer` from the start and record the Codex
bench dark for that unit with this reason. Do not soften or obscure a brief to slip past
the filter; a bench that declines work is a routing fact, not an obstacle. The exclusion is
per unit — everything else still routes to Sol, and an audit that merely reads existing
negative tests is unaffected.

## Availability

- Verify `codex --version` before first use. On Windows `codex` resolves in Bash through
  the extensionless npm shim; if it does not, invoke `codex.cmd`.
- Binary present but authentication unavailable: report it so the Orchestrator can start
  device-auth recovery in the same turn. It backgrounds `codex login --device-auth` with
  output captured to `tmp/codex/login.log`, surfaces the verification URL and one-time code
  from that file, and re-probes `codex login status` on completion.
- Recovery impossible — device login unavailable, declined, or expired: the Codex bench is
  dark. Name the fallback explicitly: `planner` and `reviewer` (Opus 5) for judgment, and
  `builder` for fully specified mechanics.
- Never authenticate, log out, inspect auth files, or substitute an API key, access token,
  or copied `auth.json`.

## Journals

Leave `tmp/codex/` to the Orchestrator. `.agents/orchestration.md` § Bench laws owns the
retention rule for every journal, brief, session file, and last-message file.

Never route orchestration or acceptance across this bridge.
