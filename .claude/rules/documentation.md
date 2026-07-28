---
paths:
  - '*.md'
  - 'guides/**/*.md'
  - 'tests/guides/**/*.ts'
  - 'src/**/types.ts'
  - 'src/**/index.ts'
  - 'app/**/types.ts'
  - 'app/**/index.ts'
  - 'src/styles/**/*'
  - '.agents/skills/**/*.md'
  - '.claude/skills/**/*.md'
---

# Documentation and parity rules

Documentation is an enforced contract, not explanatory decoration.

## Authority and workflow

- Read the matching spec/guide before code, form the intended design, then compare implementation. Existing code is a verification target, not ground truth.
- `AGENTS.md` and its linked rules are the sole convention source. Do not create competing instruction copies in guides.
- `guides/README.md` is the map: maintain both a concept index (`spec ↔ source ↔ tests ↔ showcase`) and directory index.
- `ROADMAP.md` is the sequenced plan of record. Each chunk reaches green before the next.
- A showcase is executable proof of public API. A missing demonstration is a missing feature, detectable by parity.

## Parity

- Every backticked API in a guide resolves to a real public export.
- Every public export is documented.
- TypeScript, SCSS, Markdown, tests, and showcase remain aligned.
- A parity failure identifies drift; never suppress or weaken the test.

For behavioral interfaces/classes:

- Document public methods under `## Methods`.
- Use one method table per interface, keyed by its backticked name.
- The table's methods exactly match the interface's call-signature members.
- Readonly data properties remain in the interface's `## Surface` row.
- Each implementing class exposes exactly its interface methods—no missing or extra public behavior.

Parity scope:

- Normally scope a guide to one module directory.
- A layer concept may include the core module and backend modules implementing it.
- Cross-cutting environment-root helpers are covered by behavioral tests rather than forced into one module guide.

## Guide examples

Code fences import through the package's published specifier:

- primary/core API: `@orkestrel/<name>`;
- secondary environment API: `@orkestrel/<name>/<environment>`.

Never use in-repository `@src/*` aliases in public guide examples; reserve them for source/tests.

## Workflow skills

- Skills prescribe reusable process; they do not copy naming, placement, syntax, lifecycle, or test laws from `AGENTS.md` and rules.
- Keep `SKILL.md` concise and route conditional detail to one-level `references/`.
- Frontmatter contains only `name` and a trigger-focused `description`.
- Do not put model routing or package version catalogs in a skill.
- Validate every referenced resource and `agents/openai.yaml`; do not leave template TODOs or auxiliary README/changelog files.
- Keep provider bridges minimal: they load one canonical workflow and add no competing instructions.
