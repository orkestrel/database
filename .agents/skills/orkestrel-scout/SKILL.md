---
name: orkestrel-scout
description: >-
  Map terrain mechanically before anyone reads it: file trees with line counts, Markdown headings, export lines, a term census, the files that name a path, and unresolved `§` cross-references, written once and handed to the lane that reads. Use before writing a brief, before a Grok absorption lane, before a rename or a sweep, when a dispatch names the `scout` role, or whenever a question is "where is", "how big is", "what names this", or "which files carry this term".
---

# Load the canonical skill

This file is a pointer the `@orkestrel/scaffold` package writes into every fleet workspace; the
skill itself ships with that package. Read the canonical `SKILL.md` completely and follow it:

- beside a scaffold checkout, `../scaffold/.agents/skills/orkestrel-scout/SKILL.md`;
- otherwise, `node_modules/@orkestrel/scaffold/dist/host/agents/skills/orkestrel-scout/SKILL.md`.

Resolve every path the canonical skill names against the same root; under `node_modules` each
segment drops its opening dot. Run a script the skill names through its built twin, as this
repository's `AGENTS.md` states. This pointer carries no process of its own; the authority order is
`.agents/orchestration.md` § Authority.
