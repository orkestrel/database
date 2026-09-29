---
name: orkestrel-debrief
description: Look back at a long campaign to learn from its mistakes and successes and improve the agents, rules, skills, and processes that ran it. Use after a campaign or milestone closes to run the retrospective - field evidence, layer and boundary audits, package promotion, an adversarial audit of the instruction set itself, process doctrine - and to land every learning as a refinement that propagates, then retire the campaign folder.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-debrief/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-debrief/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; `AGENTS.md`, the applicable
rules, and the canonical skill remain authoritative in that order.
