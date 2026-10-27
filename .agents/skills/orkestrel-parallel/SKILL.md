---
name: orkestrel-parallel
description: >-
  Coordinate independently owned writer lanes in one checkout through messages, with one runner for checks and an Orchestrator for decisions. Use when implementation units can progress in parallel with disjoint files or explicit regions of shared files. Serialize overlapping edits and hold every input needed for a reliable measurement. Require shared files and a channel that can wake an idle lane.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-parallel/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-parallel/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; `AGENTS.md`, the applicable
rules, and the canonical skill remain authoritative in that order.
