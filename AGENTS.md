# AGENTS.md

> TypeScript · types-first · zero unsolicited dependencies · single-word public APIs.
> This is the authoritative root for how humans and agents write code in this project.

## Authority and loading

- These instructions apply to every project in this style. Never import assumptions, names, or logic from another repository.
- The user's current instruction wins. Otherwise this file and its linked rules outrank existing code. Existing code is evidence to verify, not ground truth.
- `*/types.ts` is authoritative for public APIs. Implementation and tests conform to it. Never undo a user's type edit.
- `.agents/orchestration.md` governs agent operation only and cannot weaken this coding contract. `CLAUDE.md`, `.codex/config.toml`, and `.cursor/rules/` are harness bridges to it and carry no independent coding policy.
- `.agents/skills/` contains reusable workflows. An explicitly invoked or dispatch-named skill and its required references are binding process instructions, but cannot weaken this file, the applicable rules, or the governing guide or spec.
- External delegates, including Cursor and Codex models, have no exemption. Every dispatch restates the non-negotiables, applicable rules, guide or spec, and owned files. Every result receives independent review.
- Before working, read in order:
  1. this file;
  2. every applicable file in `.claude/rules/` from the rule map below;
  3. every explicitly invoked or dispatch-named skill and the references it requires;
  4. `guides/README.md`, the matching guide or spec, and `ROADMAP.md` when present.
- Rules state **how to write**. Guides and specs state **what to build** and the domain workflow. When they conflict, stop and surface the conflict.

## Project model

```text
src/      published library: core, browser, server, optional styles
app/      application: core, browser, server
tests/    mirrors source; setup*.ts owns shared test infrastructure
configs/  thin target wrappers around root Vite/TypeScript configuration
```

- `core` is host-independent. Browser and server may import core; core imports neither.
- `app/core` is host-independent. `app/server` may import app/core plus core and server libraries, never browser code. `app/browser` may import app/core plus core and browser libraries, and reaches server behavior through shared contracts and transports, never through Node or server implementation imports.
- Enforce environment boundaries with the project toolchain directly: Oxlint restricts declared package, alias, and conventional relative imports; scoped TypeScript projects remove host globals from core and the opposite host; Vite resolves and builds the selected Vue/browser and Node/server graphs; generated-consumer tests exercise those real configurations.
- Published source never imports private app code. Core stays host-independent. Browser and server stay disjoint.
- Do not add a second parser or source-language analyzer to duplicate TypeScript, Oxlint, Vue, HTML, CSS, or Vite.
- `tsconfig.json`, `vite.config.ts`, and each `*/types.ts` are their respective sources of truth.
- Use only the environments the project needs. Do not delete structural files merely because they are empty.

## Non-negotiable rules

- **NEVER** use `any`; accept `unknown` and narrow with guards.
- **NEVER** use non-null assertions (`!`) or type assertions (`as`); narrow or validate.
- **NEVER** use `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable`; fix the cause.
- **NEVER** add an npm package unless the user explicitly requests it; prefer native APIs.
- **NEVER** remove a symbol to silence lint. Implement it or annotate `// TODO: [Feature] Brief purpose`.
- **NEVER** undo user edits in `*/types.ts`.
- **NEVER** write `public`, `protected`, or `private` on a class member, and never declare a parameter property; use runtime-enforced `#` fields.
- **NEVER** use default exports except where a framework requires them, such as Vue SFCs or config files.
- **NEVER** use mocks, behavioral fakes, module replacement, framework spies, or fake clocks to simulate project-owned behavior. Use real implementations, recorders, temporary resources, protocol-faithful fixture servers, and inert customizable data stubs.
- **ALWAYS** make interface properties and public return collections readonly.
- **ALWAYS** define reusable and public types in `*/types.ts` before implementation.
- **ALWAYS** inspect the exact declared and installed `@orkestrel/*` capabilities before implementing overlapping logic. Reuse a primitive when its semantics match, and do not wrap it merely to rename it.
- **ALWAYS** finish the requested implementation: no empty stubs, deferred logic, or concealed follow-up work.
- **ALWAYS** follow the repository's naming, placement, export, and dependency-direction rules exactly.

## Design laws

- **Types first.** Public contracts precede implementation.
- **Single-word entity APIs.** Properties, methods, option keys, and events use one descriptive word. If one word is insufficient, change the shape: group options, extract a sub-entity or manager, or split behaviors.
- **Self-describing helpers.** Module-scope helpers normally use `{verb}{Noun}` because they lack entity context.
- **One concept, one term.** Do not alternate synonyms. Lifecycle verbs have fixed meanings.
- **Boolean behavior.** A binary behavioral switch is a boolean, not a two-literal union.
- **Real domain states only.** Literal unions represent irreducible modes, phases, discriminants, or external values — not decorative labels for facts already represented.
- **Absence is `undefined`.** Never invent sentinels such as `'none'`, `'unset'`, `'unknown'`, `''`, or `-1`. Use `null` only when an external format distinguishes it from omission.
- **Derive state.** Compute facts from existing fields. Do not store a second flag or label that can drift.
- **Named discriminants.** Name the axis that varies (`relationship`, `command`, `category`), never `kind` or `type`.
- **Centralize by kind.** Types, constants, helpers, validators, parsers, factories, errors, and similar declarations live in their designated centralized files. Implementation files contain one class plus imports.
- **Export and test reusable logic.** No hidden module helpers or declarations. Fold trivial one-use logic into its caller, or export it from the correct centralized module and test it.
- **No nested functions.** Extract function declarations and assignments from bodies. The only exceptions are an anonymous callback passed directly as an argument and an anonymous function returned directly as a result.
- **Functional core, imperative shell.** Export pure leaves. Keep stateful or defining orchestration as class methods. Classes compose behavior; they do not forward 1:1 to helpers.
- **No superfluous wrappers.** A wrapper must add a boundary, invariant, composition, translation, lifecycle, or materially narrower contract. Otherwise use or rename the real symbol and update every consumer.
- **Minimal public API.** Add or substantively expand a capability with its first real consumer; do not speculate. This is a creation gate, never a later visibility gate. Once an intentional reusable capability exists, expose its top-level source exports through the correct environment barrel regardless of which consumers currently use them, so developers receive the same supported mechanisms the package uses. Remove a symbol only when the capability itself should not exist. Prefer one minimal interface and one shared engine, allowing native backend overrides only for genuine faster paths.
- **No compatibility shims.** This is greenfield. Update every consumer in the same change.
- **Mechanism, not product policy.** Framework code supplies reusable mechanisms and stops before application decisions.
- **No polling architecture.** Park idle work on events and abort signals. Yield long work cooperatively.

## TTTDD: Types Then Tests Driven Development

1. **Types:** define or revise the contract in `*/types.ts`. Entity-scoped names satisfy the naming rules and properties are readonly.
2. **Implementation:** conform exactly to the types. Place every declaration in its prescribed file.
3. **Consolidation:** remove duplication and route repeated behavior through one shared implementation.
4. **Tests:** cover happy paths, edge cases, failures, and boundary values with targeted deterministic tests.
5. **Documentation:** update the matching guide or spec and parity coverage.

- Treat a mid-task type change from the user as immediately authoritative. Type failures identify implementation that has not caught up.
- Insert a failing proof before fixing a defect: record the exact command and its failing count, implement, then record the same command green. A test that never ran red does not bind to the defect it claims.
- Run the question rather than reasoning about it. Get the smallest real input through the real code and read the real output, as early as the question can be put under a test. Reasoning chooses what to run and interprets what comes back; it never replaces the run.
- When a claim about a TypeScript edit can name its project, its case, and the edit that must break with the stage it breaks at, call the `prove` tool the `probe` MCP server registers before relying on the claim. `.claude/rules/quality.md` § Instruments owns that rule and the receipt it requires.
- Test your own assumptions before relying on them, and before stating them. A probe needs no dispute to justify it, and an unverified belief you put into context becomes a fact for everything downstream.
- Follow the applicable repository skill for comprehensive hardening, research, centralization, contract adoption, real-service integration, or cross-package alignment.
- Leave no current-scope requirement as a TODO, skipped test, deferred row, or hidden follow-up.
- Define completion before starting. Enumerate the capabilities the change owns and what closing each one requires. That enumeration is current scope and is fixed when the work begins. Record a finding outside it against the capability that owns it, for the next change, rather than reopening this one.

## Work process

1. **Understand:** clarify scope and entities, and state what completion requires, before starting. Read `*/types.ts`, the rule files, the applicable skill, and the matching guide before editing.
2. **Research:** when requested or externally material, verify current primary sources and build a capability/defect matrix before changing the API.
3. **Design:** change types first and typecheck the proposed contract.
4. **Implement:** match the interface, reuse declared ecosystem primitives, extract centralized logic, and update the sole barrel.
5. **Consolidate:** remove duplication, nested declarations, and superfluous wrappers without expanding the API.
6. **Test:** mirror source structure, challenge the applicable seams with real implementations, and run the narrowest relevant project. Reach this step early and often, not once at the end. A question answered by a test is settled; the same question answered in prose is still open.
7. **Document:** update the guide, examples, and parity contract.
8. **Verify:** audit discovery, deferrals, and package contents as applicable. Run the required gates and read their actual output before claiming success.

Quality gates before commit, in order. The acceptance gate is the non-mutating variant; run the mutating `lint` and then `format` first only to converge, then prove with the checks. `lint --fix` rewrites code and its output is not formatter-clean, so a `format` that ran before it leaves `format:check` failing on the file `lint` just rewrote:

```text
npm run format:check → npm run lint:check → npm run check → npm run build → npm test
```

- Use scoped checks and tests during development. Do not run the whole suite casually.
- Type error: read the complete diagnostic, compare implementation with `*/types.ts`, fix one cause, and rerun the relevant check.
- Unused contract symbol: stop. Implement it or leave the prescribed TODO. Never delete it for lint.
- Compound entity member: stop. Correct the API shape before implementation. This does not apply to descriptive module helpers.
- Scope closed and gates green: stop. Report the outcome and move to the next scope. Another pass over the same surface is a new instruction, not diligence.

## Rule map

Every file below is a normative extension of this root. Read every rule relevant to the files or concepts you touch. Path frontmatter only controls Claude's automatic loading.

| Rule                             | Governs                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `.claude/rules/names.md`         | Identifiers, API shape, acronyms, lifecycle vocabulary, files/folders  |
| `.claude/rules/typescript.md`    | TypeScript syntax, imports, immutability, errors, TSDoc                |
| `.claude/rules/architecture.md`  | Centralized files, exports, classes, modules, extension points, stores |
| `.claude/rules/patterns.md`      | Options, managers, emitters, guards, parsers, contracts                |
| `.claude/rules/tests.md`         | Test behavior, helpers, browser tests, Vitest configuration            |
| `.claude/rules/workspace.md`     | Src/app environments, aliases, isolation, builds, scripts, tooling     |
| `.claude/rules/application.md`   | App composition, entries, manifest safety, lifecycle, integration      |
| `.claude/rules/browser.md`       | Vue/browser architecture and platform usage                            |
| `.claude/rules/styles.md`        | SCSS/CSS centralization, tokens, mixins, layers, naming                |
| `.claude/rules/documentation.md` | Guides, parity, roadmap, showcase, examples                            |
| `.claude/rules/writing.md`       | Developer prose: reports, replies, vocabulary, claims, structure       |
| `.claude/rules/quality.md`       | Research, dependency reuse, hardening, completion, package inspection  |

## Documentation contract

- Specs precede code. Read the matching guide, form the intended design, then compare the implementation.
- Keep public exports and behavioral methods in guide parity. TypeScript, SCSS, Markdown, tests, and showcase must agree.
- Never suppress a parity failure. Correct the drift.

## Communication

- Do the obvious work without asking for ceremonial permission.
- Keep chat summaries short. Show exact changes as diffs when useful.
- Never claim a gate passed until you ran it and read the result.

### Writing

This governs prose everywhere: chat replies, instruction files, guides, TSDoc, commit messages, and briefs.

- Write plainly. Say what you mean; mean what you say.
- Lead with the decision or the finding. Do not build up to it.
- One idea per sentence. Keep sentences short.
- Use the active voice, and the imperative for instructions.
- State the rule first. Add rationale only when it changes a judgment call, and keep it subordinate.
- Do not write aphorisms, metaphors, or rhetorical flourish. An aphorism is a memory device for a person; it carries no instruction an agent can act on.
- Do not use a long or technical word where a short common one works.
- Keep all substance, nuance, and precision. Cut only what makes text hard to read.
- Present a tradeoff as option, cost, and recommendation — not as a balanced meditation.
- Write requirements so they are specific and testable. Replace evaluative words such as "user friendly" or "hardened further" with the concrete condition that closes them.
- **NEVER state a count.** A number answering "how many" about a set anyone can add to is a count — rules, rows, members, exports, files, options, steps, cases, stages, findings, and tests are such sets. Name the members, or write the sentence without the number.
- **NEVER name a list item by its position.** Write the item's name, never its ordinal or its number.
- Treat `both` as a count where it tallies a set that can grow. Keep it where the sentence names the members.
- Write a number only as a value the reader needs: a duration, a size, a limit, a version, a date, an exit code, or a measurement reported with the run that produced it.
- Delete a count you find. Do not correct it.

#### Instruction files

`AGENTS.md`, `.claude/rules/*`, `.agents/*`, `.claude/agents/*`, and every skill are executed, not
read. An agent loads them mid-task and acts on them. Write them for that reader.

- Write every line as a directive: what to do, what to check, or what to refuse. Delete a line that does none of those.
- Name the observable trigger and the required action. "When X, do Y" is actionable; "X matters" is not.
- State the finding as the rule. Never record how it was found, which session found it, what was tried first, or what a probe proved. That history belongs in the commit message.
- Cut any clause written to persuade, reassure, or explain the rule to a person. An agent needs the rule and its trigger, not agreement with it.
- Give a rule one home. Restating it elsewhere creates a duplicate that drifts, and an agent reading the stale copy is following this file.
- Keep an example only when it disambiguates the rule. Delete an example that merely illustrates it.
