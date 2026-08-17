@AGENTS.md
@.agents/orchestration.md

# Claude Code bridge

`AGENTS.md` governs code. `.agents/orchestration.md` governs agent operation, and every harness
follows it. This file adds only what Claude Code does differently, and cannot weaken either.

## Dispatch mechanism

- Use the Agent tool for a single dispatch, including when later control flow depends on its result.
- Use a Workflow for a deterministic fan-out, staged pipeline, or loop. Serialize writing nodes.
- Recover an interrupted Workflow with `resumeFromRunId`.
- Foreground Bash is hard-capped at 10 minutes regardless of its timeout parameter. Launch anything
  that can exceed it as a harness-tracked background command.
- Never dispatch an adversarial lane with a context-inheriting subagent type such as `fork`. A lane
  must start clean, or it inherits the Orchestrator's framing and stops being independent.

## Models

- Use the aliases `opus` and `sonnet`. Never use a fixed Claude model ID and never use `inherit`.
- Never set `CLAUDE_CODE_SUBAGENT_MODEL`. It flattens the engine split.
- Run the main session on `opus` at high effort, set by `/model opus` or `"model": "opus"`. Opus 5
  is the Orchestrator in this harness. Its Orchestrator duties are unchanged if it is configured
  otherwise.
- The Orchestrator shares its engine with `planner`, `reviewer`, and the Opus `implementer`. Run
  the Sol `analyst` in every design round and every audit round so the judgment is not single-engine,
  and confirm from its journal that it reached Sol. A bridge driver that answers from its own engine
  collapses the round to one engine and its ruling still reads as normal.
- Claude role frontmatter accepts Claude models only. Reach Grok through `grok`, and Sol through
  `analyst` and `codex`. Never put an external model in `model:`.
- Claude Code hot-reloads edits to existing role files.

## Bench wiring

- `.mcp.json` registers `codex mcp-server` for short interactive exchanges with Sol. Project MCP
  servers are enabled without prompting, so the wiring works headless.
- `.claude/skills/<name>/SKILL.md` is a bridge that loads the canonical skill from
  `.agents/skills/<name>/SKILL.md`. It adds no independent process.
- Claude Code exposes `claude mcp serve`, which is how a Codex-primary session reaches Opus 5.

## Claude Code Cloud

- Cloud setup installs `@openai/codex` globally and never authenticates. The snapshotted setup
  state must contain no Codex credentials.
- At the start of each live Cloud session the user runs `codex login --device-auth` and completes
  ChatGPT approval in the browser.
- `scripts/codex.sh` only reports readiness. It never installs, authenticates, logs out, reads the
  auth cache, or performs a model call.
