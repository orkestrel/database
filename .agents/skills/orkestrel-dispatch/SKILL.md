---
name: orkestrel-dispatch
description: >-
  Dispatch one unit of work to a native subagent or an external bench and bring its result back: write the brief, probe the bench, launch under a cap, watch liveness, read the report, check its citations, accept, and delete the launch copies. Use when `.agents/orchestration.md` routes work to a role, when a bench lane is needed, or when a command will outlive the turn that starts it.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-dispatch/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-dispatch/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; the authority order is
`.agents/orchestration.md` § Authority.
