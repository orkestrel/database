---
name: orkestrel-build
description: Wire, extend, or harden Orkestrel `app/core`, `app/browser`, and `app/server` environments — the environment's contracts, boundaries, entries, and host proofs, never the product designed inside one. Use for app-only or mixed src/app workspaces, app environment isolation, Vue browser entries, Node server entries, app aliases, configs, scripts, and tests, cross-environment contracts, and application guide parity. Do not use it to redesign an application's routes, screens, or domain behavior; take that to a design round and return here to wire what it decides.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-build/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-build/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; `AGENTS.md`, the applicable
rules, and the canonical skill remain authoritative in that order.
