---
paths:
  - '*.md'
  - 'guides/**/*.md'
  - 'tests/guides.test.ts'
  - 'src/**/types.ts'
  - 'src/**/index.ts'
  - 'app/**/types.ts'
  - 'app/**/index.ts'
  - 'src/styles/**/*'
  - '.agents/skills/**/*.md'
  - '.claude/skills/**/*.md'
---

# Documentation and parity rules

Documentation is an enforced contract, not explanatory decoration. The Writing rules in
`AGENTS.md` govern its prose and are not restated here.

## Authority and workflow

- Read the matching spec/guide before code, form the intended design, then compare implementation. Existing code is a verification target, not ground truth.
- `AGENTS.md` and its linked rules are the sole convention source. Do not create competing instruction copies in guides.
- `guides/README.md` is the map: maintain both a concept index and a directory index. The concept index runs `spec ↔ source ↔ tests ↔ showcase` minus every column whose subject this workspace lacks, so an app-only workspace that publishes no library and builds no showcase still owes a full index over the columns it has.
- Where the repository keeps one, `ROADMAP.md` is the sequenced plan of record. Each chunk reaches green before the next.
- A showcase is executable proof of public API. A missing demonstration is a missing feature, detectable by parity.
- An integration surface's guide documents the validated hookup for each supported client: the exact commands run, the authentication and approval model that client needs, and the honest limit wherever a client cannot reach part of the surface.

## Parity

- Every backticked API in a guide resolves to a real public export.
- Every public export is documented.
- TypeScript, SCSS, Markdown, tests, and showcase remain aligned.
- A parity failure identifies drift; never suppress or weaken the test.
- A vendored dependency guide is a mirror. Its relative links address the upstream tree and resolve to nothing here, so they are outside local-link parity. Refresh a mirror rather than rewriting it: a rewritten copy is a translation, and no comparison against the fetched bytes can check it.
- Falsify a prose claim the way you falsify a code claim. The parity test proves a name exists, never that a sentence about behavior is true, so run the example and read what it returns. A `// false` beside a call that returns `true` is a defect of the same kind as a wrong return value, and it reaches every consumer who installs the package. That proof has a home: `tests/guides.test.ts` executes the flagship fences, per `.claude/rules/tests.md`. An ordered behaviour with no gate is not a gate.
- Re-read the prose last, against what actually shipped. Where a change chose to document a limit rather than close it, the sentence was often drafted for the option that lost, or written more confidently than the code earns. Code rulings survive review because a test can break them; prose rulings survive because nothing tries.

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
- Name every Markdown file in a skill's `references/` from its `SKILL.md`, and delete a reference nothing names.
- Frontmatter contains only `name` and a trigger-focused `description`.
- Set `name` to the skill's own directory name.
- Write `description` as a single-line scalar or a folded `>-` block, and no other shape. Include in it a sentence beginning `Use ` that names when to invoke the skill.
- Do not put model routing or package version catalogs in a skill.
- Validate every referenced resource; do not leave template TODOs or auxiliary README/changelog files.
- Write `agents/openai.yaml` as one root `interface:` mapping over exactly `display_name`, `short_description`, and `default_prompt`, in that order, each on its own two-space-indented line.
- Give every one of those keys a non-empty single-quoted scalar, and write an apostrophe inside it as `''`.
- Name the skill's own `$<directory>` token in `default_prompt`.
- Keep provider bridges minimal: they load one canonical workflow and add no competing instructions.
- Give a provider bridge its canonical skill's `name` and `description` verbatim, name the `.agents/skills/<name>/SKILL.md` path it loads, and give it no references of its own.
- Give every canonical skill exactly one provider bridge directory of the same name, and give every bridge directory a canonical twin.
- Review a bridge body's remaining instructions yourself: the policy sweep proves `name` and `description` parity, the named canonical path, and the absence of bridge-owned references, and nothing else about the body.
