---
name: orkestrel-journey
description: Prove a browser application the way a person uses it — real keystrokes, clicks, and Tab/Enter against only what is visible and reachable — through the journey layer @orkestrel/test/browser publishes, and generate the capture portfolio, the resolved-style matrix, and the statechart outcome from those same journeys. Use when accepting a UI build, proving an application end to end, deciding whether a surface is reachable by keyboard alone, proving what a screen refuses as well as what it does, proving the styles a browser actually resolved under each theme and viewport, driving a transition table through the interface and watching it run, auditing whether the interface speaks the user's vocabulary rather than the engine's, producing the screenshots a design review judges, routing a rendered question to an artifact a model can read, or whenever the only evidence a screen works is a test that drove it through JavaScript instead of through the interface.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-journey/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-journey/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; `AGENTS.md`, the applicable
rules, and the canonical skill remain authoritative in that order.
