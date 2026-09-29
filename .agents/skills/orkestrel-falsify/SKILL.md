---
name: orkestrel-falsify
description: >-
  Run one adversarial audit round against finished work: write the subject as numbered falsifiable claims, dispatch independent auditors instructed to break them, reconcile their evidence, and rule. Use when the size gate in `.agents/orchestration.md` names a review, before a fix round is accepted, before a version bump or publication, or when a defect has recurred across rounds. Do not use it for a small change, a mechanical rename, or a round with no added or repaired claim to attack.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-falsify/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-falsify/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; `AGENTS.md`, the applicable
rules, and the canonical skill remain authoritative in that order.
