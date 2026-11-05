---
name: orkestrel-publish
description: Run an Orkestrel release from layer order to registry confirmation, or adopt a published scaffold release in one consumer. Use when the user asks to publish a package, to run a fleet-wide release wave, to recover a release that stalled at the npm approval, or to adopt a published scaffold release in one repository, and follow it for the per-repository visit, the bump ruling, the layer preparation, the login approval, the upload approval, and the adoption.
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-publish/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-publish/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; the authority order is
`.agents/orchestration.md` § Authority.
