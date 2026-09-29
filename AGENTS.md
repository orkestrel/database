# AGENTS.md

The `@orkestrel/scaffold` package is this repository's coding and orchestration authority. This
file points at it and states no law of its own.

Read these before working: the `AGENTS.md` coding contract, the `.agents/orchestration.md`
agent-operation contract, every applicable rule the contract's rule map names under
`.claude/rules/`, and the dispatch-named skill under `.agents/skills/` with the references it
requires.

Resolve every one of those paths against scaffold, never against this repository:

- When a scaffold checkout sits beside this repository, read `../scaffold/AGENTS.md`, the
  `../scaffold/.agents/orchestration.md` file, the `../scaffold/.claude/rules/` directory, and
  the `../scaffold/.agents/skills/` directory.
- Otherwise read the installed copy, whose paths drop the dot that opens each segment: the
  `node_modules/@orkestrel/scaffold/dist/host/AGENTS.md` file, the
  `node_modules/@orkestrel/scaffold/dist/host/agents/orchestration.md` file, the
  `node_modules/@orkestrel/scaffold/dist/host/claude/rules/` directory, and the
  `node_modules/@orkestrel/scaffold/dist/host/agents/skills/` directory.

Every path a scaffold-supplied file names resolves the same way. Run a script such a file names
through its built twin: replace `node .agents/skills/` with
`node node_modules/@orkestrel/scaffold/dist/agents/skills/` and the `.ts` extension with `.js`,
because Node runs no `.ts` file under `node_modules`. The files this repository carries
— the `.claude/agents/orkestrel.md` catalog file, the `.claude/settings.json` permission file,
the bench scripts under `scripts/`, and the skill pointers under `.agents/skills/` and
`.claude/skills/`, which name the canonical skills and how to run their scripts — are this
repository's own copies and resolve here.

In Claude Code, also read the Claude bridge: `../scaffold/.claude/AGENTS.md` beside a checkout, or
`node_modules/@orkestrel/scaffold/dist/host/claude/AGENTS.md` from the installed copy. Keep no
`CLAUDE.md` in this repository; one stops Claude Code from reading this file.

Edit none of the scaffold-owned files here. The `scaffold repair` command restores them, so a
change to one is a commit in the scaffold repository followed by a release.
