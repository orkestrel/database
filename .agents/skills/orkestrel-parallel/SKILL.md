---
name: orkestrel-parallel
description: >-
  Run parallel work: lanes inside one session (subagents, child tasks, background commands) and peer sessions that share a checkout, a machine, or an execution lane. Use when units can progress in parallel, when another session works on the same machine or checkout, or before the first lane on a harness. Bound the host, keep lanes visible, coordinate writers through messages with one runner for checks, and hand a shared execution lane over in one message. Each harness page records its mechanics and quirks; a harness with no page carries no writer or runner lane until its bring-up questions are answered on one.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-parallel/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-parallel/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; the authority order is
`.agents/orchestration.md` § Authority.
