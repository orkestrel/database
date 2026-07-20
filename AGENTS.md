# AGENTS.md

> TypeScript · types-first · zero unsolicited dependencies · single-word public APIs.
> This file is the single source of truth for how code is written here. Follow it exactly — for humans and AI agents alike.

These rules govern every project in this style; nothing here is specific to one codebase, so never import logic, names, or assumptions from another repo. **Existing code is a verification target, not ground truth** — when code and this document disagree, this document wins (unless the user says otherwise in the moment).

These rules bind **external delegate agents identically** — Cursor Composer and Grok, invoked through the Cursor CLI, read this file on their own, and their output is audited against it with zero exemption. A dispatch to an external agent still restates the §1 non-negotiables and the unit's owned files; "an external model wrote it" is never a defense at review.

If a project ships long-form guides (`guides/`, `ROADMAP.md`, per-domain `.md` specs), read them after this file: this file is the **rules**, the guides are the **workflow** and **per-area specs**. How to do something → workflow guide. What to write → the matching spec.

---

## Orientation — the project at a glance

A workspace has two top-level surfaces, each split into the environments it needs. The reference layout:

```
src/            library (published)            app/            application
  core/   @src/core    cross-environment         core/   @app/core    shared app logic
  browser/@src/browser browser-only              browser/@app/browser Vue 3 app (entry: main.ts)
  server/ @src/server  server-only               server/ @app/server  node server (entry: main.ts)
  styles/ @src/styles  SCSS bundle → index.css
tests/          mirrors source; setup*.ts hold shared helpers
configs/        thin per-target wrappers around the root vite.config.ts / tsconfig.json
vite.config.ts  source of truth: build, test projects, aliases
tsconfig.json   source of truth: compiler options + path aliases
```

**Dependency direction:** `browser` and `server` import from `core`; `core` imports from neither. Apps import from libraries.

**Commands** (gates before commit, in order): `npm run format` · `npm run lint` (house rules) · `npm run check` (typecheck) · `npm run build` · `npm test`. Scope tests — `npm run test:src:core`, `test:app:browser`, etc. — never run the full suite casually.

---

## 1. Non-negotiable rules

- **NEVER** use `any` — use `unknown` and narrow with type guards.
- **NEVER** use `!` (non-null assertion) — use conditionals or optional chaining.
- **NEVER** use `as` (type assertion) — narrow through validation.
- **NEVER** use `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` — fix the underlying issue.
- **NEVER** add npm packages unless explicitly requested — prefer native APIs.
- **NEVER** remove a symbol to satisfy a linter — implement it or annotate `// TODO: [Feature] Brief purpose`.
- **NEVER** undo user edits in `*/types.ts` — that file is the source of truth.
- **NEVER** use `readonly` on parameters (`readonly` signals immutability to consumers, not producers).
- **NEVER** use the `private` keyword — use `#` private fields (runtime-enforced).
- **NEVER** use default exports (except where a framework strictly requires them — Vue SFCs, config files).
- **ALWAYS** use `readonly` for interface properties and public return types.
- **ALWAYS** define reusable and public types in `*/types.ts` before implementation.
- **ALWAYS** finish the implementation — no deferred logic, empty stubs, or hidden follow-up work.
- **ALWAYS** match the existing naming and file-placement patterns exactly.

---

## 2. Methodology — TTTDD (Types Then Tests Driven Development)

1. **Types drive the public API.** All interfaces and type aliases go in `*/types.ts` first. That file is the single source of truth — implementation conforms to it, never the reverse.
2. **Implement to satisfy the types.** Write the class or function that fulfills the contract. Extract internals to the appropriate centralized file.
3. **Consolidate.** After implementation, deduplicate. Patterns that repeat across files get extracted to centralized files.
4. **Harden with tests.** Cover happy paths, edge cases, error conditions, and boundary values.
5. **Document.** Write/update guides so any reader (human or AI) can understand and extend the code.

**User changes override everything.** If the user modifies a type or interface mid-task, that change is **immediately authoritative** — refactor all affected code to match. Failed tests after a type change indicate implementation that hasn't caught up, not bugs in the tests. Use `npm run check` to find every site that needs updating.

---

## 3. Code style

- Tabs for indentation.
- No semicolons (except where required for ASI).
- Single quotes for strings.
- Named exports only.
- ESM imports with explicit `.js` extension: `import { x } from './foo.js'`.
- `#` private fields, never the `private` keyword.
- Import order: type imports first (`import type`), then internal/value modules.
- No empty lines between consecutive imports of the same kind.

---

## 4. Naming — the signature of this codebase

> **Names are the public API.** They must be predictable enough that a consumer can guess the correct identifier without consulting documentation.

### 4.1 The single-word principle (the load-bearing rule)

**Every property, method, option key, and event name on an entity should be a single descriptive word.** The entity it lives on supplies all the disambiguating context — the name does not need to repeat it.

This is not a stylistic preference. It is the foundation that the rest of this document depends on. If a name needs more than one word, that is almost always a signal that the **API shape is wrong**, not that the name is too short — see §4.2.

**The reasoning:**

- A property on `AgentInterface` is already an agent property. Calling it `agentId` adds nothing — use `id`.
- A method on `ToolManager` is already a tool-manager method. Calling it `addTool` is redundant; `add()` is enough.
- An option in `DatabaseOptions` is already a database option. Calling it `databasePath` repeats the entity twice; `path` is enough.

**Scope of the rule — what it applies to (entity-scoped names):**

- Properties and getters on a class or interface
- Methods on a class or interface
- Option keys (the entity is the options interface itself)
- Event names inside an `EventMap` (the entity is the emitter that owns the map)

**What it does NOT apply to — see §4.3 / §4.5 for these:**

- Standalone helper functions at module scope (no entity context to lean on)
- Type identifiers (their role suffix is required — see §4.5)
- Constants (the qualifier is part of the meaning — `DEFAULT_TIMEOUT_MS`)

**Concrete examples from real interfaces:**

```ts
// AgentInterface — entire public surface in single words
interface AgentInterface {
	readonly emitter: EmitterInterface<AgentEventMap>
	readonly id: string
	readonly context: AgentContextInterface
	readonly status: AgentStatus
	generate(): Promise<string>
	stream(options?: AgentStreamOptions): AsyncGenerator<string, string>
	abort(): void
}

// IndexedList<T> — all members single words, intent obvious from the container
interface IndexedList<T> {
	readonly size: number
	has(id: string): boolean
	item(id: string): T | undefined
	items(): readonly T[]
	append(id: string, item: T): void
	prepend(id: string, item: T): void
	insert(index: number, id: string, item: T): void
	remove(): void
	remove(id: string): boolean
	remove(ids: string[]): boolean
}
```

**Hard targets (for entity-scoped names):**

- Public properties: **one word**
- Public methods: **one word** (two only when no single verb captures the action)
- Option keys: **one word** when ungrouped; otherwise an entity name keying a nested object (see §4.2.1)
- Event names: **one word**, present-tense verb or noun
- Private methods: 2–3 words allowed — privacy reduces the cost of length

### 4.2 When a single word is not enough — split, don't compound

If you find yourself reaching for a prefix or suffix on an entity member to disambiguate (`addInstruction`, `removeDocument`, `databasePath`, `serverTimeout`), **stop**. The compound name is a symptom that the surface is doing too much. Three strategies, by shape:

#### 4.2.1 Options — group by entity as the key

Flat option names with prefixes are wrong. Group related options into a nested object whose **key is the entity** they configure.

```ts
// ✗ Wrong — prefixes repeat the entity
interface ServerOptions {
	readonly serverPort?: number
	readonly serverTimeout?: number
	readonly databasePath?: string
	readonly databaseTimeout?: number
}

// ✓ Right — entity is the key, fields stay single-word
interface ServerOptions {
	readonly server?: { readonly port?: number; readonly timeout?: number }
	readonly database?: { readonly path?: string; readonly timeout?: number }
}
```

The shape now answers "which entity owns this setting?" structurally instead of through string prefixes. Every leaf is a single word. Adding a third option (`cache`) is a new key, not a new prefix family.

#### 4.2.2 Class members — split into a sub-entity exposed as a property

If a class accumulates verbs like `addX`, `removeX`, `addY`, `removeY`, those verbs do not belong on the parent class. Each prefix family is a separate entity. Extract it into its own class (typically a Manager) and expose it as a **single-word property** named after the domain noun (plural).

```ts
// ✗ Wrong — parent inflates with prefixed methods
interface AgentContextInterface {
	addInstruction(instruction: InstructionInput): InstructionInterface
	removeInstruction(id: string): boolean
	addDocument(document: DocumentInput): DocumentInterface
	removeDocument(id: string): boolean
	addTool(tool: ToolInput): ToolInterface
	removeTool(id: string): boolean
	// ... and on, and on
}

// ✓ Right — each domain is its own manager, exposed as a single-word property
interface AgentContextInterface {
	readonly instructions: InstructionManagerInterface
	readonly documents: DocumentManagerInterface
	readonly tools: ToolManagerInterface
	// callers reach functionality through the manager:
	//     context.instructions.add(input)
	//     context.documents.remove(id)
	//     context.tools.execute(call)
}
```

This is the dominant composition pattern. Every domain noun on a parent entity is a single-word property pointing to its own Manager class. The Manager owns the verbs (`add`, `remove`, `clear`, …) and those verbs stay single-word because their context comes from the Manager, not the parent.

#### 4.2.3 Functions — split variants instead of dispatching by parameter

If a function takes a discriminator parameter to choose between behaviors (`parse(format, input)` where `format` is `'json' | 'yaml' | 'toml'`), split it into separate named functions. Each variant lives independently and the call site reads naturally.

```ts
// ✗ Wrong — discriminator parameter dispatches between behaviors
function parse(input: string, format: 'json' | 'yaml' | 'toml'): unknown {
	/* big switch */
}
// callers: parse(text, 'json'), parse(text, 'yaml')

// ✓ Right — each variant is its own function
function parseJson(input: string): unknown {
	/* ... */
}
function parseYaml(input: string): unknown {
	/* ... */
}
function parseToml(input: string): unknown {
	/* ... */
}
// callers: parseJson(text), parseYaml(text)
```

These resulting names are multi-word — that is correct. Helpers live at module scope with no entity context, so they need enough words to be self-descriptive at the call site (§4.3). The principle being enforced is **"split variants into named functions,"** not "make the names single-word." A discriminator parameter folds multiple behaviors behind one name; splitting exposes them honestly. If a family of related functions starts to feel like it deserves a shared context, that's a signal to promote it into a class or interface and let §4.2.2 take over.

#### 4.2.4 Parameters — no behavior-selecting magic strings

A string (or other literal) parameter must never select WHICH behavior a function performs. If passing a different value routes the call to a different branch — a different algorithm, a different shape of work — that parameter is a magic string, and the function is several functions hiding behind one name. Split it into separately named functions (§4.2.3); when the variants share an entity, promote them to methods on a class (§4.2.2).

```ts
// ✗ Wrong — position is a mode literal that switches behavior
function addFactor(
	group: FactorGroup,
	factor: Factor,
	position: 'start' | 'end' | { readonly before: string } | { readonly after: string },
): FactorGroup {
	/* branches on position */
}

// ✓ Right — one name per behavior; the optional target id is data, not a mode
function appendFactor(group: FactorGroup, factor: Factor, target?: string): FactorGroup {
	/* ... */
}
function prependFactor(group: FactorGroup, factor: Factor, target?: string): FactorGroup {
	/* ... */
}
```

Same test as the binary-toggle rule (§4.4): does the value switch behavior, or is it data? These are data and stay unions: a discriminant on a data value you narrow on (reasoning, an error code); a value enum applied uniformly (`Comparison`, `Aggregation`, `MathOperation`); a key or field selector applied uniformly (a `clear(definition, key)` that deletes whichever optional key is named performs the same operation for every value). The line: a value that picks a DIFFERENT thing to do — split; a value that picks a different DATUM to do the SAME thing to — data.

### 4.3 Helpers are different — module scope has no entity context

Standalone helper functions exported from `helpers.ts` (or any module) are called bare at the consumer site:

```ts
import { computeHash, extractColumns, normalizePath } from './helpers.js'

const hash = computeHash(content)
const cols = extractColumns(definition)
const path = normalizePath(input)
```

There is no parent class or interface providing context. The helper name is the **entire** signal the reader gets. So helpers default to a self-descriptive `{verb}{Noun}` form and need enough words to make the action clear without ambiguity.

- **Default form:** `{verb}{Noun}` — `generateId`, `computeHash`, `extractColumns`, `derivePhaseStatus`, `inferLanguage`, `normalizePath`, `sanitizeFilename`, `matchesGlobPattern`, `belongsTo`, `hasMany`.
- **Single-word helpers are allowed** only when the verb alone is fully unambiguous and the helper takes obvious arguments — `delay(ms)`, `clamp(n, bounds)`, `tokenize(input)`, `similarity(a, b)`. If you have to think about what `process(x)` or `handle(x)` does, the name is too short.
- **Identical-verb-means-identical-thing still applies** (§4.4, §4.8): every `extract*` extracts from a structure, every `infer*` derives a value from another, every `compute*` runs a deterministic calculation, every `matches*` is a predicate. Pick a verb prefix per concept and use it everywhere.
- **When a helper family grows,** that's a signal to promote it to a class (§4.2.2). Five `extract*Foo` helpers operating on the same shape probably belong on a `FooReader` class with single-word methods.

### 4.4 General rules

- Names describe **what a thing is**, not how it works internally.
- Prefer short, common English words — avoid jargon, abbreviations, acronyms (unless universally understood: URL, ID, HTML).
- One concept = one word, used everywhere (always `count`, never `length`/`size`/`total` interchangeably).
- If two names feel synonymous, pick one and use it project-wide.
- Properties are **nouns** — `count`, not `getCount`.
- Methods are **verbs** — `abort`, not `aborter`.
- Booleans read as **assertions** — `aborted`, `exhausted`, `expired`.
- A **binary behavioral toggle is a boolean**, not a two-value union — `bail`, not `failure: 'continue' | 'halt'`. The test is whether it _switches behavior_: discriminated-union tags (§4.5), multi-value / lifecycle unions (§10), conventional value pairs (`ascending`/`descending`, `and`/`or`), and external-spec literals are **not** toggles — they stay unions.
- No `get`/`set` prefixes — accessors use bare nouns.
- Identical verbs across the project mean identical things — see Lifecycle Vocabulary (§10).
- A **discriminant is named for the axis it splits on**, never `kind` — `relationship`, `command`, `category` say what varies; `kind`/`type` say nothing.

### 4.4.1 Acronym casing in identifiers

When a name **does** contain an acronym (the universally-understood ones the rule above permits), the acronym keeps its **canonical case** — never PascalCase-folded to title case.

- **An initialism is UPPERCASE** — `JSON`, `HTTP`, `NDJSON`, `SSE`, `URL`, `URI`, `SQL`, `API`, `DB`, `TTL`, `UUID`, `RFC`, `JWT`. A **brand / proper name keeps its branding** — `SQLite`, `IndexedDB`, `GitHub`, `OAuth`.
- **In a PascalCase type / class / interface, the acronym is always its canonical case:** `JSONSchema`, `NDJSONParser`, `HTTPServer`, `SSEStream`, `URLPattern`, `SQLiteDriver`, `IndexedDBDriver`.
- **In a camelCase value / method / property, an acronym lowercases ONLY when it LEADS the name** (to satisfy camelCase) — `jsonValue`, `urlPath`, `sqlText` — and keeps its canonical case anywhere else: `parseJSON`, `toJSON`, `fromNDJSON`, `signJWT`, `compileSQL`.
- **Module FOLDERS stay lowercase** (§4.7) — `http/`, `sqlite/`, `indexeddb/`, `websocket/`. This rule governs **identifiers**, not folder names.
- A few **ecosystem-conventional** lowercase identifiers stay as the ecosystem writes them: `id` (a property), and a leading `url` / `uri` in a camelCase name.
- **The drift to avoid is PascalCase-folding an acronym** — `Json`, `Ndjson`, `Http`, `Sse`, `Sqlite` are **WRONG**; write `JSON`, `NDJSON`, `HTTP`, `SSE`, `SQLite`.

### 4.5 Type-level identifiers (PascalCase + role suffix)

Type names are the one place suffixes are required — they encode the type's **role**, which the consumer cannot infer from context alone.

| Kind                 | Suffix               | Pattern                    | Purpose                                   |
| -------------------- | -------------------- | -------------------------- | ----------------------------------------- |
| Behavioral interface | `Interface`          | `{Entity}Interface`        | Contract for a class                      |
| Options / config     | `Options`            | `{Entity}Options`          | Input bag for creating/configuring        |
| Creation input       | `Input`              | `{Entity}Input`            | Minimal data needed to create an instance |
| Outcome / output     | `Result`             | `{Entity}Result`           | Structured return value                   |
| Execution context    | `Context`            | `{Entity}Context`          | Ambient state passed through a call chain |
| Event map            | `EventMap`           | `{Entity}EventMap`         | Map of event names → arg tuples           |
| Union / enum-like    | `{Noun}`             | `{Entity}{Noun}`           | Constrained set of literal values         |
| Plain data / value   | _(none)_             | `{Entity}`                 | Records or events with no behavior        |
| Function type        | `Handler`/`Function` | `{Entity}Handler`          | Function type invoked by the framework    |
| Manager interface    | `ManagerInterface`   | `{Entity}ManagerInterface` | Collection contract w/ lookup + lifecycle |

### 4.6 Value-level identifiers

| Kind             | Casing           | Pattern                   | Examples                               |
| ---------------- | ---------------- | ------------------------- | -------------------------------------- |
| Class            | PascalCase       | `{Entity}`                | `Agent`, `Greeter`, `Timeout`          |
| Manager class    | PascalCase       | `{Entity}Manager`         | `ToolManager`, `ScopeManager`          |
| Factory function | camelCase        | `create{Entity}`          | `createAgent`, `createGreeter`         |
| Type guard       | camelCase        | `is{Condition}`           | `isRecord`, `isSuccess`, `isFailure`   |
| Helper function  | camelCase        | `{verb}{Noun}` (see §4.3) | `generateId`, `computeHash`, `delay`   |
| Constant         | UPPER_SNAKE_CASE | `{QUALIFIER}_{NOUN}`      | `DEFAULT_TIMEOUT_MS`, `MAX_ITERATIONS` |
| Property / field | camelCase        | bare noun (single word)   | `count`, `signal`, `status`, `context` |
| Method           | camelCase        | bare verb (single word)   | `abort()`, `start()`, `execute()`      |
| Boolean          | camelCase        | adjective/past-participle | `aborted`, `paused`, `expired`         |

### 4.6.1 The derivation & construction idioms (one prefix/suffix per role)

A small set of affixes carry a fixed **role** across the whole codebase. Each says exactly what a symbol does and how it composes — pick the affix by role, never by feel, and never blur two roles under one shape.

- **`is*` — a guard.** A `Guard<T> = (value: unknown) => value is T`: total, never throws, returns `false` for anything off-shape (`isRecord`, `isSuccess`, `isJSONPrimitive`).
- **`parse*` — a coercer.** Returns `T | undefined` — "give me a `T` or nothing" (`parseNumber`, `parseJSON`). Cross-type conversion lives here, not on a guard.
- **`create*` — an entity / value factory.** Constructs and returns an instance (`createAgent`, `createGreeter`, `createDatabase`).
- **`*Of` — a combinator / builder.** Takes the **constituent parts** and returns the container / guard / value built from them: `arrayOf(guard)`, `recordOf(guard)`, `unionOf(...guards)`, `boundsOf(min, max)`, `rangeOf(start, end)`. A builder consumes the **pieces**.
- **`{noun}To{Noun}` — a projection.** Takes a **whole** and returns a derived view of it: `definitionToSnapshot`, `stepToForm`, `fileToDocument`, `schemaToParameters`. A projection consumes the **whole** — this is what distinguishes it from `*Of` (which consumes the parts). When you reach for `*Of` to name a "make a Y out of an X" helper, you want `xToY` instead; reserve `*Of` for parts-to-container builders.
- **`*Shape` — a shaper.** A `ContractShape` **value** — a JSON-Schema blueprint, not a function and not a type (`stringShape`, `objectShape`). Shapers live in `shapers.ts`; the compilers turn a shape into a guard / parser / schema / generator.
- **`_*` (leading underscore) — an intentionally-unused binding.** Suppresses the unused-binding lint for a binding that is GENUINELY ignored (a callback-conformance param, a rest-omit, a swallowed `catch (_e)`); it is NEVER a privacy marker (privacy is `#`). Keep it rare and verified-intentional — never a forgotten wiring (§4.8).

Two members carry a fixed concept-name regardless of the entity:

- A **discriminant names its axis, never `kind` / `type`** — `modality`, `operation`, `via`, `relationship` say what varies; `kind` says nothing (§4.4 / §4.8).
- A **tally is `count`** — never `length` / `size` / `total` used interchangeably (§4.4).
  - **Descriptive tallies when several counts coexist.** A bare `count` is right only when there is ONE unambiguous tally in scope. When a type exposes SEVERAL distinct counts, each takes a DESCRIPTIVE name for what it counts — not a bare `count`. E.g. a workers `Pool` exposes `size` (total), `idle`, and `active`, not three `count`s; a `Queue` keeps `count` (its single pending length) + `active`. Use the most descriptive word for what is represented; reserve bare `count` for the single, unambiguous tally.
- A **binary behavioral toggle is a boolean**, not a two-value union (§4.4) — `bail`, not `'continue' | 'halt'`.

### 4.7 File & folder naming

| Kind           | Pattern                        | Examples                         |
| -------------- | ------------------------------ | -------------------------------- |
| Domain folder  | lowercase plural of the entity | `agents/`, `tools/`, `greeters/` |
| Implementation | PascalCase entity name         | `Agent.ts`, `ToolManager.ts`     |
| Test file      | PascalCase entity + `.test`    | `Agent.test.ts`                  |
| Docs           | lowercase domain + `.md`       | `agents.md`                      |

### 4.8 Anti-patterns

- Don't compound when you can split — see §4.2 (the dominant failure mode).
- Don't prefix interfaces with `I` — use the `Interface` suffix (`AgentInterface`, not `IAgent`).
- Don't use generic words — `data`, `info`, `item`, `thing`, `obj` are too vague.
- Don't name a discriminant `kind` (or `type`) — name the axis it splits (`relationship`, `command`, `category`); `kind` is the discriminant-level `data`/`thing`.
- Don't encode types in names — `nameString`, `countNumber` are redundant.
- Don't model a binary behavioral toggle as a two-value union — make it a boolean (`bail`, not `'continue' | 'halt'`); see §4.4.
- Don't mix synonyms — pick one term per concept (don't use `cancel` for `abort`, `reset` for `clear`, `run` for `execute`).
- Don't pass a string/mode parameter that selects a function's behavior — split into named functions (§4.2.3/§4.2.4). A behavior-switching value is a magic string; a discriminant, value enum, or key selector treated uniformly is data.
- Don't use the `Handler` suffix on classes — `Handler` is for function types only.
- Don't abbreviate — `config` not `cfg`, `document` not `doc`, `message` not `msg`.
- Don't pluralize type names — `MessageRole`, not `MessageRoles`.
- Don't mark methods `@internal` in TSDoc — make them `#` private instead.
- **The leading `_` is the intentionally-unused marker, never a privacy marker (privacy is `#`).** A leading `_` suppresses the unused-binding lint (`argsIgnorePattern` / `varsIgnorePattern` / `caughtErrorsIgnorePattern`). Reserve it for a binding that is GENUINELY ignored: an interface / callback-conformance param the impl truly doesn't need, a destructuring rest-omit, a swallowed `catch (_e)`, an unused loop var. Keep it RARE — every `_` must be **verified-intentional, never a forgotten wiring**: if a `_`-param carries data the function SHOULD use, drop the `_` and wire it; if it exists for no signature-compat reason, remove it. Prefer a one-line inline comment justifying each `src/` `_` (the convention is far-and-few-between by design).
- Don't write `getX` / `setX` accessors — use bare nouns.

---

## 5. Project structure & the centralized-file pattern

| Content          | Location                 | Notes                                    |
| ---------------- | ------------------------ | ---------------------------------------- |
| Types/interfaces | `*/types.ts`             | **SOURCE OF TRUTH** — no types elsewhere |
| Constants        | `*/constants.ts`         | UPPER_SNAKE_CASE, `Object.freeze` values |
| Helpers/guards   | `*/helpers.ts`           | Pure utilities                           |
| Errors           | `*/errors.ts`            | Error classes and their type guards      |
| Implementations  | `*/[domain]/[Entity].ts` | One class per file                       |
| Public barrel    | `*/index.ts`             | The **sole** public export surface       |
| Tests            | `tests/`                 | Mirror source structure                  |

Each surface grows through the centralized-file pattern. The full set of recognized centralized files (use only the ones a surface actually needs):

- `types.ts` · `constants.ts` · `helpers.ts` · `validators.ts` · `combinators.ts` · `parsers.ts` · `shapers.ts` · `compilers.ts` · `factories.ts` · `middlewares.ts` · `seeders.ts` · `schemas.ts` · `relations.ts` · `errors.ts` · `index.ts`

**Implementation files contain ONLY** class implementations with `#` private fields and imports. They must **NOT** contain interface definitions, type aliases, constants, or free-standing helper functions — extract those to the appropriate centralized file. Keep compiler/parser recursion in the **functional core**: a **pure** branch — referentially transparent, touching no instance state and calling no sibling method — stays an **exported, centralized helper** (`helpers.ts` / `compilers.ts` / `parsers.ts`), testable in isolation, and is never hidden behind a file-local non-exported function. A branch that must reach the **imperative shell** — instance `#`state or a sibling method — is not a free function but a **method**: public when it is the interface contract, a `#` private method (§7) otherwise. These are complementary, not in tension: extraction pushes every pure **leaf** out to a centralized helper, while an **orchestration** step lives as a class method — and a public method is a real **composition** of those leaves, never a thin 1:1 delegate that only forwards to one helper. "Orchestration" is broader than "stateful": a pure but **compositional or recursive algorithm step** (a chaining pass, a `solve`/`isolate`/`prove` routine, a relational join) stays a `#` private method even when it touches no `#`state and — after its own leaves are extracted — calls only helpers, because it is the class's behavior, not a leaf (§7 gives the ordered leaf test).

**Extract aggressively — `export`ed or not.** The rule is about WHERE a member lives, not whether it is public. A file-local `interface` / `type` / `const` / free `function` that is _only_ used inside its own impl file and never exported **must still be extracted** to the module's centralized file (a private local `interface Waiter` → `types.ts`; a module-scope `const LIMIT` → `constants.ts`; a free `function compilePath` → `helpers.ts`). "It's only used here / it's not exported" is **not** a reason to leave it in the impl file — an implementation file holds the class and nothing else. Centralizing a type then publishes it through the barrel (`export type *`), and a published symbol is documented + parity-covered (§22) like any other; that visibility is the intended, accepted cost of the rule, not a reason to dodge it. The one and only exception is a file that **must be self-contained for the runtime to work** — e.g. a worker entrypoint (`serve.ts` / `main.ts`) loaded as raw source inside a spawned worker thread, which therefore _cannot_ import from a core alias or sibling centralized files, so its guards/types live inline by necessity (and say so in a comment). Such files are rare and load-bearing; everything else extracts, no exceptions. Run a dedicated clean-up sweep to confirm no impl file harbors a stray local type/const/helper — and that **no centralized file harbors ANY non-exported member at all**. Every declaration in a centralized file is `export`ed: a `type` in `types.ts`, a `const` in `constants.ts`, a guard in `validators.ts`, a parser in `parsers.ts`, a function in `helpers.ts` — all public, no exceptions. A non-exported member in a centralized file (even a private helper type aliased only by another type in the same file) is itself a defect: `export` it (or, if it is a trivial single-use internal, fold it away entirely so nothing non-exported remains). The sole non-exported module-scope declarations anywhere are the runtime-self-contained exception's.

**Centralized files are kind-pure — the rule cuts both ways.** Extraction is not only _out of impl files_; each centralized file holds ONLY its kind, so a member in the wrong centralized file is as misplaced as one left in an impl file. `constants.ts` is the **sole** home for a module-scope constant — a `const` sitting in `helpers.ts` is misplaced and moves to `constants.ts` (or is promoted per the surface-root / core rules). `constants.ts` holds UPPER*SNAKE `Object.freeze`d **data**; a camelCase namespace whose members are \_functions* (a builder / utility DSL) is a **helper**, not a data constant, and lives in `helpers.ts`.

**`helpers.ts` is the exported, reusable-utility surface — every function in it is `export`ed.** A helper is shared infrastructure: exporting it makes it consolidatable and reachable by its own unit test. A would-be non-exported module-scope helper therefore has exactly two dispositions — **fold** it into its sole caller when it is a trivial, single-use internal (so no hidden function remains), or **extract + `export` + test** it when it is non-trivial or reusable (then route the other sites that hand-roll the same logic through it). Never leave a hidden, non-exported function loitering in `helpers.ts`. A reusable fragment — a regex, a JSON-body parse, a header flatten — is **one** exported helper that every site calls, **including tests and fixtures (§16.1)**; it is never reimplemented inline. A `factories.ts` / `compilers.ts` / `parsers.ts` is itself a centralized file, **not** an exemption: a factory's private glue step extracts to an exported `helpers.ts` function (a one-off used by a single factory still extracts — "only one caller" is not a reason to hide it), and a compiler's / parser's **pure** recursion branches stay **`export`ed** in `compilers.ts` / `parsers.ts` per the recursion rule above (a branch that must reach instance `#`state or a sibling method is a `#` private method instead — §7). The only non-exported module-scope function anywhere is in the runtime-self-contained file; every other free function — factory glue, compiler branch, guard step — is exported and unit-tested.

**`middlewares.ts` holds middleware factory functions — a middleware is a function, never a class.** A middleware is a behavior, not an entity: the `Middleware` contract is `(context, next) => …`, so each ships as a factory `createX(options): Middleware` that closes over its config — the right shape for a behavior (and the universal web idiom), never a class with a lone `handle` method. `middlewares.ts` is its kind-pure home, kept distinct from `factories.ts` (which constructs entities / managers / stores / route inputs / transports / data) so a request handler is never confused with an object constructor. A middleware's state is **closure-private by default** (a rate limiter's per-key tally); the moment a consumer must _address_ that state — swap it for a durable backend, share it, inspect it — the **state**, not the middleware, is extracted into a pluggable class taken as an option (default in-memory), exactly as a `createSession` takes a `SessionStore`. Reusable cross-middleware machinery (a cookie signer/parser, a multipart stream parser) is likewise a class/helper the factories compose. The only _manager_ of middleware is the spine's `MiddlewareManager` (the composition chain) — there is no per-middleware manager.

**Purpose of the centralized files:** deduplicate and consolidate. When a helper appears in (or is hand-rolled in) two places, extract it to one exported helper and route every site through it. When a constant is used across modules, centralize it. When an impl file grows a private local type or helper, extract it — the impl file stays a pure class.

**No function is ever declared or assigned inside another function or method body.** No local `function` declaration, no `const fn = () => {}` binding, no nested `function*` — regardless of how many call sites would share it. Extract the logic to the appropriate centralized module (or a `#` private method when it is inherently instance-bound — reaches `this`state or a sibling method, per §7) and import or call it from there. The ONLY function-valued expression allowed inside a body is an anonymous callback passed directly in argument position (an array `.map`, a `Timeout` handler, a `try`/`catch` wrapper). "Only one caller" is not an exemption — a single-use nested helper still evades the export-and-test law (§2.4) exactly as a hidden multi-use one would, so it extracts on the same terms as everything else in this section.

**Shared / core layer.** When multiple packages or surfaces exist, shared logic belongs in a central core/shared layer. Every cross-surface concept consolidates here. Other surfaces import from core; core never imports from them.

**Surface root vs. modules.** A surface that grows several modules (sub-domains, each its own folder with its own centralized files) keeps cross-module types and helpers at the **surface root** (`<surface>/types.ts`, `<surface>/helpers.ts`) and module-specific ones inside the module (`<surface>/<module>/types.ts`, `helpers.ts`, `errors.ts`, `constants.ts`). The surface barrel re-exports the root files and each module barrel, so everything still flows through the single top-level `index.ts`. Promote a member to the root only when **two or more modules** use it — a member used by one module stays in that module (the same rule the cross-surface core layer follows, one level down). A surface root's own cross-cutting surface is covered by behavioral tests (a `helpers.test.ts` mirroring the root); a module's documented surface is parity-tested against its own directory (§22).

**Entity sub-folders.** A module's implementation classes live one per file (§5 table); when a domain noun grows its own family — an entity plus its manager, or several sibling implementations of one shape — those class files nest in a sub-folder named for the entity (`phases/`, `tasks/`, `routes/`, `transports/`), co-locating each entity with its manager. The sub-folder holds **only** the entity's class files — its `{Entity}Interface` stays in the module-root `types.ts`, its `create*` factories in the module-root `factories.ts`, and the module barrel re-exports the nested classes; an entity sub-folder grows **no** centralized files of its own.

**Extension-category nesting.** Beyond a domain's plain entity sub-folders, a known **extension category** — a family of classes implementing a contract that is a _designed extension point_ (a driver seam, a store seam, a transport) — nests into a sub-folder named for the category (`drivers/`, `stores/`, `transports/`), **even at a single file**, because the category is a known growth point. This holds in BOTH directions: when a layer extends ANOTHER domain's contract (concrete drivers in a consumer surface implementing core's `DriverInterface`) AND within the domain that DEFINES the contract (the default in-memory driver alongside the interface). The contract **interface stays in the module-root `types.ts`** (the source of truth); only the concrete extension **classes** nest. The test is a designed GROWTH point, NOT a coincidental name: a module's OWN core primitives stay at root — native-object wrappers that each wrap one underlying object 1:1 are co-equal core primitives, so "Store" there is the native object, not a swappable persistence backend — they stay flat.

**Stores.** A store is an extension category (it nests in `stores/` per the rule above). There are two blessed molds, chosen by access shape: **point-access** (`get` / `set` / `delete` — address one record at a time; the `{X}StoreInterface` shape) and **bulk-restore** (`save` / `load` / `remove` / `clear` — persist and restore a whole collection, e.g. a queue that resumes its entire outstanding set). Either mold shares the same invariants: the stored value carries its **own** id (no separate id parameter on `set` / `save`), every primitive is async (returns a `Promise`), and a delete / remove of an absent key is a no-op (never throws). A store family follows extension-category nesting — the concrete stores (a memory store plus a database-backed store over the core persistence layer) nest in `stores/`, the `…StoreInterface` stays in the module-root `types.ts`, and the `create…Store` factories in `factories.ts`.

---

## 6. Barrel export rules

- `*/index.ts` is the **sole** public barrel — all public API flows through it.
- **NEVER** re-export from any non-index file — only `index.ts` may `export *`.
- **NEVER** re-export a symbol that originates in another package — update imports at the consumer site to point to the originating package.
- Each implementation file exports its class directly; `index.ts` re-exports with `export *`.
- Use `export type *` for types and `export *` for values.
- When a symbol moves between packages, update every import site — do not leave re-exports as shims.

```ts
export type * from './types.js'
export * from './constants.js'
export * from './errors.js'
export * from './validators.js'
export * from './helpers.js'
export * from './factories.js'
export * from './greeters/Greeter.js'
```

---

## 7. Class implementation structure

Order inside every class:

1. `#` private fields — context, options, status, result, child managers
2. Constructor — initialize context and options; instantiate child managers
3. Public API — getters and methods implementing the interface (single-word names per §4.1)
4. `#` private helper methods

Child managers (the §4.2.2 pattern) are stored as `#` private fields and exposed through `readonly` getters that return their interface type.

A **public method**, a **`#` private method**, and a **centralized helper** (§5) are three distinct roles — do not blur them. A public method implements the interface contract and is a genuine **composition** of helpers (and, when stateful, of `#` private methods); it is never a thin 1:1 delegate that only forwards to a single helper. A `#` private method is the imperative-shell counterpart — an internal step that must touch instance `#`state or call a sibling method, so it cannot be a pure helper. A centralized helper is a pure, referentially-transparent leaf with no instance state — the testable functional core, exported from `helpers.ts`. Push every pure leaf out to a helper; keep only genuinely stateful orchestration as a `#` private method.

**Purity is necessary but NOT sufficient for extraction — a leaf is not the same as a referentially-transparent method.** Apply the leaf test in order. (1) If the member reaches instance `#`state or calls a sibling method, it stays a `#` private method — done, it is not a candidate. (2) If it is pure, ask whether it is a **leaf** — a self-contained computation understandable and testable with zero knowledge of the owning class: a key/format/compare/convert/lookup/invert/instantiate step, a single unification, a stateless projection — or an **orchestration** — the recursive spine of an algorithm, or a composition that sequences leaves into the class's actual behavior: a chaining pass, a `solve`/`isolate`/`prove` routine, a relational join. A leaf is extracted to `helpers.ts`; an orchestration stays a `#` private method **even when it is referentially transparent and — once its own leaves are extracted — calls only helpers**, because it is still an algorithm, not a leaf. (3) A class's **defining engine internals** — the comparison core of a comparator, the empty-identity of an aggregator, the dispatch of an orchestrator — likewise stay methods: extracting them would reduce the class to a **thin delegate**, the same anti-pattern this section forbids for public methods, applied to the class itself. The operative question is not "does this read `this`?" but "is this a **leaf**, or is this the class's **behavior**?" When unsure, extract genuine leaves and keep recursive/compositional algorithm steps as `#` private methods — a class must remain a real composition of leaves, never a hollow shell that forwards to helpers.

---

## 8. Options design

This is the §4.2.1 strategy applied. Every options interface follows it.

- Top-level option keys are single words.
- Settings that need grouping live under a nested object whose **key is the entity** (`server`, `database`, `cache`), never a flat name with a prefix.
- Each leaf field is a single word (`port`, `timeout`, `path`).
- The `on` key is reserved everywhere for `EmitterHooks` (initial event listeners) — do not use it for anything else.

```ts
interface ServerOptions {
	readonly on?: EmitterHooks<ServerEventMap>
	readonly server?: { readonly port?: number; readonly timeout?: number }
	readonly database?: { readonly path?: string }
}
```

Document each option's meaning under `@remarks`, not via long names.

---

## 9. Managers — accessors & batch operations

### 9.1 Accessor pattern

Managers expose items via **singular** and **plural** accessors named after the domain noun. Both names are single words, both backed by the parent's context.

| Accessor      | Returns                        | Purpose            |
| ------------- | ------------------------------ | ------------------ |
| `entity(key)` | `EntityInterface \| undefined` | Look up ONE by key |
| `entities()`  | `readonly EntityInterface[]`   | List ALL in order  |

Example: `TimeoutManager` exposes `timeout(id)` and `timeouts()`; `AgentManager` exposes `agent(id)` and `agents()`. The Manager class itself is the entity context — the methods do not need a `Timeout`/`Agent` prefix.

### 9.2 Batch operation pattern

Verbs that act on collections take three overload shapes — **same single-word verb**, different parameters.

| Signature       | Returns   | Behavior                                      |
| --------------- | --------- | --------------------------------------------- |
| `method()`      | `void`    | Applies to ALL items                          |
| `method(id)`    | `boolean` | Applies to ONE item                           |
| `method(ids[])` | `boolean` | Applies to LISTED items (true if all succeed) |

Never split this into `methodAll`, `methodOne`, `methodMany` — the verb stays single-word and overloads carry the variation.

When the single-item type can itself be a list (a key type that includes arrays, or an open record), the one-item and array overloads overlap — declare the **array overload first** so a list resolves to the batch form, and document how to express a single list-valued item so it isn't read as a batch.

---

## 10. Lifecycle vocabulary (no synonyms)

| Verb      | Meaning                                    |
| --------- | ------------------------------------------ |
| `start`   | Begin or restart an operation              |
| `stop`    | End an operation permanently               |
| `pause`   | Suspend an operation (resumable)           |
| `resume`  | Continue a paused operation                |
| `skip`    | Mark as intentionally not executed         |
| `abort`   | Cancel with signal propagation             |
| `clear`   | Reset state without destroying the entity  |
| `destroy` | Tear down the entity and release resources |
| `execute` | Run the primary work to completion         |

Do not introduce synonyms (`cancel` for `abort`, `reset` for `clear`, `run` for `execute`). Every lifecycle verb is single-word and has exactly one meaning across the entire codebase.

---

## 11. Immutability

- Never mutate inputs — copy-on-write for internal state.
- Public getters return copies or readonly views, never mutable references.
- Use `readonly T[]`, `ReadonlyMap<K, V>`, `ReadonlySet<T>` for return types and properties.
- **NEVER** use `readonly` on parameters.

---

## 12. Error handling & `Result`

| Condition                            | Strategy                     |
| ------------------------------------ | ---------------------------- |
| Programmer error / invalid arguments | `throw` (an `AppError`)      |
| External operation (I/O, network)    | `Result<T, E>` or throw      |
| Optional lookup that may not exist   | Return `undefined`           |
| Inside a type guard                  | Return `false` — never throw |

### Result type

For operations that can succeed or fail without throwing:

```ts
interface Success<T> {
	readonly success: true
	readonly value: T
}
interface Failure<E> {
	readonly success: false
	readonly error: E
}
type Result<T, E = Error> = Success<T> | Failure<E>
```

Construct with `success(value)` / `failure(error)`; narrow with the `isSuccess` / `isFailure` guards (or `if (result.success)`) — never use `as` or `!`. Error classes carry a machine-readable `code` (+ optional `context`) and ship with a type guard (`AppError` / `isAppError`) for safe narrowing in `catch`.

---

## 13. Emitter pattern (stateful entities with observable events)

Stateful entities with lifecycle transitions, constraint hits, or observable operations own an `Emitter<TMap>` instance as a `#emitter` private field and expose it through a `readonly emitter: EmitterInterface<TEventMap>` property (single-word — see §4.1). Consumers subscribe via `entity.emitter.on(...)`.

**Structure:**

1. Define `{Entity}EventMap` in `*/types.ts`.
2. `{Entity}Options` has `readonly on?: EmitterHooks<{Entity}EventMap>` and, beneath it, `readonly error?: EmitterErrorHandler` (the listener-error handler, imported from the emitter module/barrel).
3. `{Entity}Interface` has `readonly emitter: EmitterInterface<{Entity}EventMap>`.
4. The class owns `readonly #emitter: Emitter<{Entity}EventMap>` and exposes `get emitter()`.
5. Constructor initializes with `new Emitter({ on: options?.on, error: options?.error })` — forward BOTH the `on` hooks and the `error` handler. (Entities built positionally rather than from an options bag thread `error` the same way they thread `on`.)
6. Internal code uses `this.#emitter.emit(...)` directly — the emitter isolates a throwing listener, so an entity does NOT wrap emits in a guarded `#notify` of its own.
7. The entity's `destroy()` calls `this.#emitter.destroy()` last.

No inheritance from `Emitter`, no delegation boilerplate, no `Omit` hacks.

**Listener isolation is the emitter's, not a domain event.** The `Emitter` isolates every listener (a throw never stops siblings) and routes a caught throw to its OWN `error` handler (`EmitterOptions.error`, surfaced as `(error, event)`) — never rethrown, every throwing listener surfaced (not just the first), a throwing `error` handler swallowed (anti-recursion). **NEVER add an `observerError` (or any listener-error) event to a domain `EventMap`** — that concern belongs to the emitter. An entity that wants to expose it adds `error?: EmitterErrorHandler` beside its `on?` and forwards both to its `#emitter`. (A domain `error` event — a genuine I/O / transport fault — is unrelated and stays.)

> **Browser/DOM variant.** In a pure browser-DOM surface where every entity is already bound to a host `Element`, the host element may serve as the emitter instead of an `Emitter` instance: emit a typed bubbling `CustomEvent` on the host (`emit`/`dispatch` helpers), subscribe with `addEventListener` (a `listen` helper), and wire initial listeners from `options.on` with a `bindEventMap` helper. Choose one model per surface and stay consistent; `Emitter<TMap>` is the default for everything that is not exclusively browser-DOM.

**Event naming:**

- Each event name is a **single present-tense verb or noun**: `start`, `connect`, `expire`, `exhaust`, `drain`, `chunk`.
- **Never** use a generic `status` event that passes the value as a parameter — each transition is its own named event.
- Errors are always typed `unknown`; empty tuples for pure signals; labeled tuple elements for IDE hover.
- Keep maps at 4–8 events per entity.

---

## 14. Contract & validation architecture

Three orthogonal surfaces handle "is this data what I expect?":

- **Validators (`validators.ts`)** — pure `is*` type guards (`Guard<T> = (value: unknown) => value is T`). Answer "is this a `T`?" No coercion, no side effects.
- **Combinators (`combinators.ts`)** — guard-composing functions (`arrayOf`, `recordOf`, `unionOf`) that build a new `Guard<T>` out of existing ones.
- **Parsers (`parsers.ts`)** — flat coercion functions returning the typed value or `undefined`. Answer "give me a `T` or nothing." Cross-type conversions live here (`parseNumber('42') → 42`).
- **Contracts (the shape DSL)** — when validation, serialization, and test data must never drift, declare one `ContractShape` (shapers) and compile it (compilers) into four lockstep outputs: a JSON Schema, a guard, a parser, and a seeded generator. Add a shape variant once; every output covers it. This is the heavy machinery — reach for it only when the four-way parity earns its keep; small surfaces use plain guards + parsers.

**Guards are total functions.** A guard NEVER throws — adversarial input (cycles, deep nesting, hostile prototypes) returns `false`, never a `RangeError`. Recursion guards track ancestors and cap depth. The only sanctioned recursion entry point is an explicit lazy gate; non-lazy structural cycles fail loudly at build time, not at runtime.

**Parse ↔ guard soundness.** A guard-valid input is never rejected by its parser; a parsed value always satisfies the guard. Keep them derived from one source (or test the round-trip) so they cannot diverge.

> The reference `src/core` demonstrates the lightweight end of this: the contracts surface — `Guard`/`Result` types in `types.ts`, `is*` guards in `validators.ts`, `*Of` combinators in `combinators.ts`, coercing parsers in `parsers.ts`, and the shape DSL (`shapers.ts` + `compilers.ts`) that compiles one `ContractShape` into a guard, parser, JSON Schema, and generator.

---

## 15. Comments & documentation

- Comments explain **WHY**, not **WHAT** — self-explanatory code needs no comments.
- Full TSDoc on public exports: description, `@param`, `@returns`, `@example`.
- Options objects: a single `@param`, with fields listed under `@remarks` (this is where short field names earn their long descriptions).
- Private methods / overloads: single-line `//` comments only.
- Avoid comments describing future product behavior unless requested.

---

## 16. Testing

- **Structure:** test files mirror source structure (`tests/[domain]/[Entity].test.ts`).
- **Deterministic:** same inputs → same outputs.
- **Fast:** short timers (10–50ms), no network calls.
- **No mocks:** use real implementations and small scenarios — only mock genuine third-party calls.
- **Live-service tests are isolated and warmed.** Tests that require a live external service or model are the one exception to fast-and-hermetic — but they still mirror (§16) and live in a **dedicated, isolated test project** with its own setup that **warms readiness and hard-requires the service (it throws loudly, never silently skips)** plus its own longer timeout, kept **out of the default run** so unrelated suites stay fast. Live-service-dependent logic is verified **through** that service's tests in its own project — never wired into an unrelated module's tests, never scattered as ad-hoc skips.
- **Coverage:** happy path + edge cases (NaN, +0/−0, cycles, Map/Set order, empty inputs).
- **No placeholders:** use `it.todo()` for unimplemented tests, never empty passing tests.
- **Test only behavior** — do NOT create test files for `constants.ts`, `index.ts` barrels, `errors.ts` definitions, or `types.ts`.
- **Centralize test helpers** in `tests/setup*.ts`.
- **Never run the full suite casually** — target specific test projects to avoid long waits.

### 16.1 Test helper pattern

Test helpers are shared infrastructure, not local clutter. A fixture, event factory, async wait, recorder, renderer, scenario builder, fake/scripted collaborator, or DOM builder belongs in a setup file — **extract it the moment it could serve another test, not only after it has been copied.** A helper duplicated (or near-duplicated) across two files is a defect to consolidate into one general form.

- Put general, environment-agnostic helpers in `tests/setup.ts` (no `node:*`, no `document`/`window`/Vue).
- Put environment-specific helpers in the matching setup file: `tests/setupServer.ts` (node-only, `node:fs` loaders anchored to `WORKSPACE_ROOT`), `tests/setupBrowser.ts` / `tests/setupStyles.ts` (DOM/Vue/CSS).
- Setup files must export every reusable helper, fixture type, factory, constant, and guard they define.
- Test files import helpers from setup files rather than defining local fixture factories.
- Helper names follow §4.3: `createRecorder`, `buildElement`, `appendItems`, `renderRows`, `waitForDelay`, `extractDetail`.
- Prefer small factory functions that seed a real scenario over inline setup blocks repeated across tests.
- **Reuse the framework's helper — never reimplement it in a test.** When the library already exports a helper for the job (a parser, a header flattener, a signer), the test or fixture imports it rather than hand-rolling its own copy — a fixture that re-implements framework logic is the same duplication defect, one layer over (§5).

Use a **recorder** instead of a test-framework spy when the test only needs to count calls or inspect arguments. A recorder is a real callback with recorded calls; it is not a mock of behavior.

```ts
interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}
```

Use a single delay helper instead of inline `setTimeout` promises:

```ts
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
```

Style/DOM setups also ship CSS assertion primitives: `mount`, `render`, `build`, `style`, `token`, `rootToken`, `pixels`, `rgba`, `colorEqual`, and `findRule` (assert a rule is **declared** in the cascade, complementary to `style()` which reads resolved values).

### 16.2 Browser tests

Browser tests run in a real browser. Treat that as a feature, not something to fake away.

- Do not mock or replace browser APIs such as DOM events, storage, observers, viewports, layout methods, or pointer/drag primitives unless the browser truly lacks the API.
- Prefer real DOM nodes, real events, real layout styles, and real browser observers.
- Centralize browser event factories: `createPointerEvent`, `createDragEvent`, `typeInput`, `fireTransitionEnd`.
- Centralize DOM fixture builders: `createButtonElement`, `createDropdownElements`, `createModalElement`, etc.
- Assert observable behavior: DOM state, emitted events, callback records, focus, classes, attributes, and public API state.
- Avoid asserting implementation details such as internal timers, private state, or framework scheduler internals.

Use fake timers only for deterministic timer-driven behavior where waiting in real time would make the suite slower or flaky. Do not use fake timers as a substitute for testing real browser interactions.

### 16.3 Test runner configuration

Keep test runner configuration boring and minimal. Add special provider, browser, teardown, timeout, parallelism, cache, or launch settings only when there is a measured problem and a targeted setting fixes it.

- Prefer defaults until there is evidence they are wrong.
- Keep provider setup in one helper or one shared config block.
- Avoid long launch-flag lists unless each flag has a current, verified purpose.
- Avoid persistent browser contexts unless a test genuinely needs persisted browser state.
- If browser teardown is slow, first check test cleanup, open handles, file parallelism, and per-file browser context churn before adding launch flags.
- Remove exploratory configuration once the real cause is fixed.
- Comments in config should explain the current reason for a setting, not the history of failed attempts.

---

## 17. Workspace & multi-environment layout

A workspace has two top-level surfaces — a **library** (`src/`) and an **application** (`app/`) — each split into the environments it needs: `core`, `browser`, `server`, and (for `src/`) an optional `styles` bundle. A project uses only the subset it needs; the structure is identical regardless.

### 17.1 Surfaces

- `src/core/` — shared library code for browser and server consumers.
- `src/browser/` — browser-only library code.
- `src/server/` — server-only library code.
- `src/styles/` — optional SCSS bundle compiled to a shippable `index.css` (entry `index.ts` is a side-effect `import './index.scss'`).
- `app/core/` — shared application logic used by browser and server entrypoints; has an `index.ts` barrel.
- `app/browser/` — browser entry + browser-specific code; `main.ts` is the entrypoint (not a barrel). Typically grows `components/`, `pages/`, `composables.ts`, `controllers/`, `services/`, `stores/`.
- `app/server/` — server entry + server-specific code; `main.ts` is the entrypoint. Typically grows `handlers/`, `middlewares.ts`, `routes.ts`.

**Dependency direction:** browser and server import from core; core never imports from browser or server. Application surfaces import from library surfaces.

### 17.2 Alias policy

- `@src/core` → `src/core/index.ts`
- `@src/browser` → `src/browser/index.ts`
- `@src/server` → `src/server/index.ts`
- `@src/styles` → `src/styles/index.ts`
- `@app/core` → `app/core/index.ts`
- `@app/browser` → `app/browser/index.ts`
- `@app/server` → `app/server/index.ts`

Keep aliases aligned between `tsconfig.json` and `vite.config.ts` — `vite.config.ts` derives its aliases from `tsconfig.json` `compilerOptions.paths`, so **add a new alias to `tsconfig.json` first**.

### 17.3 Source of truth & config wrappers

- `tsconfig.json` is the shared TypeScript source of truth.
- `vite.config.ts` is the shared Vite source of truth (build, test projects, environment loading, aliases).
- `*/types.ts` files are the source of truth for every public API.
- Files under `configs/src/`, `configs/app/` (and `configs/bin/` if present) are **thin** target-specific wrappers around the root configs — keep root config generic and reusable; do not move shared logic out of the root files.

### 17.4 Environment rules

- `vite.config.ts` owns environment loading and mapping.
- Introduce new shared environment variables in `vite.config.ts` first.
- Prefer a minimal plain variable set (e.g. `APP_NAME`, `APP_API_PATH`, `APP_HOST`, `APP_PORT`).
- Only expose additional browser runtime values when there is a concrete need.

### 17.5 Build outputs

| Output             | Holds                              | Format |
| ------------------ | ---------------------------------- | ------ |
| `dist/src/core`    | core library                       | `cjs`  |
| `dist/src/browser` | browser library                    | `es`   |
| `dist/src/server`  | server library                     | `cjs`  |
| `dist/src/styles`  | compiled SCSS bundle (`index.css`) | `es`   |
| `dist/app/browser` | browser application build          | —      |
| `dist/app/server`  | server application build           | `cjs`  |
| `dist/showcase`    | single-file demo (`index.html`)    | —      |

Declaration emit for the TS library surfaces is handled by `tsc` via the tsconfigs under `configs/src/`, chained after each `vite build` step. The **styles** surface ships CSS, not declarations. The optional **showcase** (`appShowcase` → `configs/app/vite.showcase.config.ts`) bundles `app/browser` into one self-contained `dist/showcase/index.html` via `vite-plugin-singlefile` — it opens straight from `file://`, JS minified by oxc and CSS by Lightning CSS (both bundled with Vite). It is a distributable demo kept out of the default `build`; a build stamp (an injected `build-id` meta tag) makes rebuilds cache-bust under `file://`.

### 17.6 Testing structure

- `tests/setup.ts` — shared, environment-agnostic setup entry.
- `tests/setupBrowser.ts` — browser-only setup (wires `./setup.css`; DOM/Vue helpers).
- `tests/setupServer.ts` — server-only setup (`node:fs` loaders, `WORKSPACE_ROOT`).
- `tests/setupStyles.ts` — style setup (loads `./setup.css` + the compiled cascade; CSS assertion primitives).
- `tests/setup.css` — declares the cascade-layer order before `@import 'tailwindcss'` (+ `@source`).
- Prefer test filenames that follow the source entrypoint (`index.test.ts` for `index.ts`, `main.test.ts` for `main.ts`).

Vitest splits into one project per surface×environment, configured in `vite.config.ts` (`node` for core/server, real Chromium via `@vitest/browser-playwright` for browser/styles):

| Project       | Files                  | Environment                     | Setup files                                       |
| ------------- | ---------------------- | ------------------------------- | ------------------------------------------------- |
| `src:core`    | `tests/src/core/**`    | `node`                          | `setup.ts`                                        |
| `src:browser` | `tests/src/browser/**` | Playwright (Chromium, headless) | `setup.ts` + `setupBrowser.ts`                    |
| `src:server`  | `tests/src/server/**`  | `node`                          | `setup.ts` + `setupServer.ts`                     |
| `src:styles`  | `tests/src/styles/**`  | Playwright (Chromium, headless) | `setup.ts` + `setupBrowser.ts` + `setupStyles.ts` |
| `app:core`    | `tests/app/core/**`    | `node`                          | `setup.ts`                                        |
| `app:browser` | `tests/app/browser/**` | Playwright (Chromium, headless) | `setup.ts` + `setupBrowser.ts`                    |
| `app:server`  | `tests/app/server/**`  | `node`                          | `setup.ts` + `setupServer.ts`                     |

Scope tests by surface/environment — `npm run test:src`, `npm run test:src:core`, `npm run test:app`, `npm run test:app:server`, etc.

### 17.7 Scoped checks & type-isolation

`check` is the single **comprehensive** typecheck — `vue-tsc --noEmit --project tsconfig.json`, one pass over the root all-types tsconfig that type-checks the **whole tree** (src, app, tests, `configs/**`, `vite.config.ts`) and gives IDE parity. It uses `vue-tsc` because the tree spans `app/browser/*.vue`. That single root pass IS `check`. Linting is a **separate gate** (`lint`, §17.8): `oxlint` is not a type-checker and `tsc` does not enforce the house rules, so the two are complementary and run as distinct steps, not nested.

Alongside `check`, a `check:<scope>` script family mirrors the `test:*` projects as **separate, on-demand isolation checks** — NOT part of `check`. You run them (e.g. `npm run check:src && npm run check:app`, or a single granular scope) to enforce that each surface stays within its environment's strict `lib`/`types` contract:

- `check:src` — runs `check:src:{core,browser,server,styles}` (the strict per-env source scopes).
- `check:app` — runs `check:app:{core,browser,server}` (the strict per-env app scopes).

These scoped checks are the **isolation tool**, distinct from the everyday comprehensive `check`.

**Tooling per scope — `tsc` for pure-TS scopes, `vue-tsc` only where `.vue` is type-checked.** Only `app/browser` contains `.vue` files, so the whole-tree `check` (the root pass) and the scoped `check:app:browser` use `vue-tsc`; every other scope (`check:src:{core,browser,server,styles}`, `check:app:core`, `check:app:server`) uses plain `tsc`. Rationale: plain `tsc` treats a `*.vue` import as the opaque shim declared in `app/browser/env.d.ts` and silently skips the `.vue` internals (templates, `<script setup>`); `vue-tsc` type-checks inside them. So `vue-tsc` runs exactly where `.vue` is checked and nowhere else — which also matches the build, where the src faces are already emitted with plain `tsc`.

Each scoped check enforces **environment type-isolation** via a per-env `lib`/`types` contract, so a surface can only reach the host globals its environment actually has:

| Check scope                          | `lib`                             | `types`           | Host globals available                                                           |
| ------------------------------------ | --------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `check:src:core` / `:app:core`       | `["ESNext"]`                      | `[]`              | **none** — pure ECMAScript: no DOM, no Node (not even `crypto`/`console`/timers) |
| `check:src:browser` / `:app:browser` | `["ESNext","DOM","DOM.Iterable"]` | —                 | DOM globals; no Node                                                             |
| `check:src:server` / `:app:server`   | `["ESNext"]`                      | `["node"]`        | Node globals; no DOM                                                             |
| `check:src:styles`                   | `["ESNext"]`                      | `["vite/client"]` | `vite/client` only (for the `*.scss` module decl); no DOM, no Node               |

**Strict core is the load-bearing rule.** `core` and `app:core` are **pure ECMAScript** — a host-dependent utility cannot live there. A helper that needs a host global belongs in the environment face that has it: e.g. `generateId` (needs the host `crypto` global) lives in the **server** face (`src/server/helpers.ts`), not `@src/core`.

The per-env contracts **unify with the build**: `configs/src/tsconfig.{core,browser,server}.json` (build/emit) double as the scoped-check configs (`tsc --noEmit -p`); the net-new check-only configs are `configs/src/tsconfig.styles.json` and `configs/app/tsconfig.core.json` (`configs/app/tsconfig.{browser,server}.json` were already check-only). The root `tsconfig.json` keeps **all** libs/types so the IDE stays happy — and the comprehensive `check` runs against it; the per-env scoped checks are what tighten each surface on top.

### 17.8 Script intent

- `npm run dev` — browser development entrypoint.
- `npm run build` — build all configured library and application targets.
- `npm run serve` / `serve:build` — run the built server / build all then run it.
- `npm run showcase` — dev server for the single-file showcase.
- `npm run build:showcase` — build the single-file showcase to `dist/showcase`.
- `npm run show` — build the showcase and copy it to `demo/showcase.html`. Run it AFTER the `format` gate, never before: `demo/showcase.html` is committed in its generated, minified form, and `npm run format` would otherwise expand the single file's inlined bundle into tens of thousands of lines (oxfmt has no ignore mechanism to exempt it).
- `npm run lint` — `oxlint --config .oxlintrc.json --fix .`: the whole-tree house-rules linter (bans `any`/non-null `!`/default exports/unused vars, enforces `import type`, etc.). Its own gate — complementary to, and separate from, `check` (§17.7).
- `npm run check` — the comprehensive typecheck: `vue-tsc --noEmit --project tsconfig.json`, one root pass over the whole tree (§17.7). For on-demand environment isolation, run the separate scoped checks — `check:src`, `check:src:core`, `check:app`, `check:app:server`, etc. (§17.7).
- `npm run format` — format all files.
- `npm run clean` — remove the `dist/` directory.
- `npm run copy <from> <to>` — copy a file (creates parent dirs).
- `npm run tmp:txt` — rename non-markdown files in `tmp/` to `.txt`.
- `npm run prepublishOnly` — the full gate sequence before publishing: `format` → `lint` → `check` → `build` → `test`.

### 17.9 Tooling

- **Type checker:** `vue-tsc` (wraps `tsc` with Vue SFC support) only where `.vue` is checked (the whole-tree `check` root pass, and the scoped `check:app:browser`); plain `tsc` everywhere else (§17.7).
- **Linter:** `oxlint` (`.oxlintrc.json`, run with `--fix`) — its own gate, not part of `check`.
- **Formatter:** `oxfmt` (`.oxfmtrc.json`).
- **Bundler:** Vite.
- **Test runner:** Vitest with `@vitest/browser-playwright` for browser tests.
- **Node target:** `node24` for core and server builds.
- **Browser framework:** Vue 3 (when a browser app is present).

---

## 18. Vue / browser rules

Applies when an `app/browser/` surface uses Vue.

- **No `$emit`.** Use props, controllers, stores, services, and composables for all reactivity — they must be reactive without `$emit`. A composable returns **readonly refs** + methods (e.g. `useTheme(): { mode: Readonly<Ref<ThemeMode>>; toggle(): void }`), so consumers can't mutate the ref directly.
- **Layout via utilities, theme via tokens.** Use the CSS framework's utility classes for layout (flex, gap, spacing, max-width) and the framework's token-driven classes (`.surface`, `.button`, `.muted`, `.accent`) for color, so a `[data-theme]` flip re-themes everything. Only add custom SCSS when no utility exists, and hook into the framework's SASS variables/functions rather than hand-rolling values. Never hand-roll a literal color.
- Prefer native platform APIs (Popover, `<dialog>`, `hashchange` routing) over reinvented widgets or extra libraries.

---

## 19. SCSS conventions

When a project ships SCSS, the styles layer mirrors the TypeScript centralization principles (§5) — read the parallel TS section first. The concrete token vocabulary is project-specific (a Bootstrap project uses `--bs-*`, a Tailwind project uses `--set-*`, the reference template uses `--app-*`); the structural rules below are universal.

### 19.1 Centralized files (the §5 analogue for SCSS)

| TypeScript                    | SCSS                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| `helpers.ts` — pure functions | `_mixins.scss` — `@function` (returns a value) and `@mixin` (emits CSS)   |
| `constants.ts` — UPPER_SNAKE  | `_tokens.scss` — `:root` custom-property tokens + cascade-layer order     |
| _(theme overrides)_           | `_theme.scss` — retunes tokens under theme selectors (`[data-theme='…']`) |
| `*/index.ts` — sole barrel    | `index.scss` — sole compilation barrel (`@use 'tokens'`, `'theme'`, …)    |

`_mixins.scss` is the **mixin / function registry**. It emits no top-level CSS — every consumer reaches it with `@use '../mixins' as *` and calls its mixins / reads its lists. **Never** `@use 'mixins'` from `index.scss`.

`_tokens.scss` is the **token source of truth** and declares the cascade-layer order. Token names are part of the **public API** — adding a token is allowed; renaming or removing one is a breaking change. `_theme.scss` retunes tokens under theme selectors; partials never override tokens.

### 19.2 Three tools, three roles

- **`@function`** — when you need a _value_ to plug into a property. Pure, no side effects, returns one CSS value.
- **`@mixin`** — when you need to _emit declarations_. May take `@content`. Owns boilerplate like the transition + `prefers-reduced-motion` pair.
- **`%placeholder`** — only for sharing _within a single partial_. Placeholders are NOT reachable across `@use` boundaries; cross-file sharing flows through `@mixin`.

### 19.3 What partials must never do (mirrors §21)

- **Never invent a new token** without checking `_tokens.scss` first. New tokens belong in `_tokens.scss` (global) or on the component/element selector (component-scoped), not buried in an unrelated partial.
- **Never write a literal color.** Every color flows through a `var(--token)` reference (or a `color-mix()` of those).
- **Never write a hand-rolled per-color/per-variant block** when the structure is shared — collapse it into a single `@each` loop over a shared list.
- **Never duplicate logic across partials.** If a pattern appears in ≥2 partials, lift it to `_mixins.scss`. A pattern used by only one partial stays inline — adding a mixin for a single caller is over-abstraction.
- **Never `@extend` across partials.** Sass `@extend` collapses selectors at compile time; sharing flows through tokens and mixins, not Sass inheritance.
- **Never pair a `transition:` without a `prefers-reduced-motion: reduce` opt-out.** Use the project's `transition` mixin, which emits both. Animations use `@include reduced-motion { animation: none }`.
- **Never wrap rules in a foreign cascade layer.** Each partial wraps its rules in its own folder's `@layer`, so utilities reliably win. Declare the layer order once in the consumer entry, before `@import 'tailwindcss'`.

### 19.4 Naming

| Kind             | Casing                | Pattern                           | Examples                        |
| ---------------- | --------------------- | --------------------------------- | ------------------------------- |
| Function         | lowercase, kebab-case | `{verb}` or `{noun}`              | `tint`, `clamp`                 |
| Mixin            | lowercase, kebab-case | verb / verb-noun                  | `reduced-motion`, `transition`  |
| Sass `$variable` | lowercase, kebab-case | `!default` if overridable         | `$variants`, `$breakpoints`     |
| Custom property  | project token scheme  | `--{scope}-{property}[-modifier]` | `--app-surface`, `--bs-...`     |
| Modifier class   | bare adjective/noun   | `.{name}`                         | `.surface`, `.muted`, `.accent` |
| State class      | bare adjective        | §10 lifecycle vocabulary          | `.active`, `.disabled`          |

State class names use the §10 lifecycle vocabulary. The composable owns interactivity state (which class is on the element, when transitions fire, what `aria-*` is set); the partial owns visual chrome. They meet at the **class name** and the **transition token** — both stable contracts.

---

## 20. Workflow & recovery

**Development process:**

1. **Understand** — clarify scope, identify entities (the core nouns), read `*/types.ts` first.
2. **Design types (ALWAYS FIRST)** — open `*/types.ts`; apply §4.1 (every entity-scoped name single-word; if you can't, split per §4.2). Helpers follow §4.3. Mark all properties `readonly`. Typecheck to validate.
3. **Implement** — create the file in its domain folder, import types from `../types.js`, implement the class to match the interface exactly with `#` fields, extract helpers/constants/factories to centralized files, add `export *` to `index.ts`.
4. **Consolidate** — extract duplicated logic; simplify internals while preserving the public API.
5. **Test** — mirror structure, import via `.js` extensions, cover happy path + edges + errors, run the targeted project.
6. **Document** — update the relevant guide with new types, methods, and behavior.

**Quality gates (all pass before commit, in order):** `npm run format` · `npm run lint` (house rules) · `npm run check` (typecheck) · `npm run build` · `npm test` (targeted).

**Recovery:**

- _Type error_ → read the full message; check the implementation against `*/types.ts` (usual fixes: missing `readonly`, wrong return type, missing method); re-run typecheck after each fix.
- _Unused-symbol lint warning_ → **STOP**, do NOT delete. Is it defined in `*/types.ts`? If so, implement it; if blocked, annotate `// TODO: [Feature] Brief purpose`. Never remove a symbol just to satisfy the linter.
- _A compound name appears on an entity member_ → **STOP**; it's a design signal, not a naming problem. Apply §4.2 (nested options, sub-entity property, or separate functions), updating `*/types.ts` first. This does NOT apply to standalone helpers in `helpers.ts` — those use `{verb}{Noun}` (§4.3).

---

## 21. Architecture rules

- `*/types.ts` is the source of truth for the public API — never contradict it; implementation matches it exactly.
- Entity members (properties, methods, options, events) are single-word per §4.1; if you can't, you split per §4.2 — there is no third option. Standalone helpers use `{verb}{Noun}` per §4.3 (no entity context).
- Do not expand the public API without concrete multi-site need.
- Build a capability with its real consumer, not speculatively — defer a piece until the thing that needs it exists, then build it against that concrete consumer.
- Centralize shared logic — if two surfaces need it, it belongs in core. Deduplicate aggressively — if a pattern appears twice, extract it.
- **Minimal interface, one engine, native overrides.** When several backends satisfy one capability, keep the interface the smallest set of primitives the capability needs and put the shared logic (querying, paging, aggregation, …) in **one engine over those primitives**, so a new backend implements only the primitives and inherits the rest. A backend may override a generic operation with a **native** one where it has a faster path (an indexed count, a key-range scan), falling back to the engine otherwise — but never re-implements the whole engine per backend.
- Keep everything generic and reusable. Do not bring in logic from unrelated projects.
- Do not remove structural files just because they are currently empty.
- Prefer the smallest valid implementation that preserves the intended architecture.
- **No backwards-compatibility shims.** Greenfield: change types, rename symbols, restructure freely, and update every consumer in the same change. Never carry deprecation aliases or "for backwards-compat" branches.
- **No busy-loops, no recursive microtasks as architecture.** An idle loop **parks** on an abort / event wakeup rather than polling; long work yields cooperative quanta rather than recursing microtasks.
- **Mechanism, never policy.** A server / framework helper ships the reusable mechanism (HMAC, CORS, body parsing, sessions, cookies, CSRF, static serving, …) and stops at the line where application / product decisions begin (user models, login flows, authorization).

---

## 22. Documentation as contracts

Docs are not comments — they are enforced contracts.

- **Spec before code.** Read the matching spec/guide first, form the correct vision, then close the gap. Existing code is a _verification target_, not ground truth.
- **Guides are parity-tested.** Every backticked API in a guide must resolve to a real export, and every public export should be documented. TS ↔ SCSS ↔ Markdown drift fails CI — that is the system working, not a test to suppress.
- **Parity reaches public methods, not just exports.** For class- and interface-heavy surfaces, a guide also documents each behavioral interface's public methods — a `## Methods` section, one table per interface keyed by its backticked name. Parity then asserts the documented methods are exactly the interface's real call-signature members (its `readonly` data members stay in the `## Surface` row), and that each implementing class exposes exactly its interface's methods — no extra public surface.
- **A guide scopes parity to its concept's source.** Usually that is one module's directory; a layer concept (the database layer, say) may span its core module and the backend-driver modules that implement it. A surface root's cross-cutting helpers are covered by behavioral tests rather than a guide.
- **`AGENTS.md` is the single source of truth** for conventions, for both humans and AI. Keep instructions here, not duplicated elsewhere.
- **`guides/README.md` is the map** — a dual-axis index (by-concept: spec ↔ source ↔ tests ↔ showcase; and by-directory). Read it first to build a mental model.
- **`ROADMAP.md` is the plan of record** — upcoming work as sequenced chunks, each gated green before the next; read it to see where the project is headed and why.
- **A showcase, when present, is proof.** If the library ships a public API, the app demonstrates it in real markup; a missing demo means a missing feature, caught by parity tests.
- Guide code fences import a package's own surface through its published specifier — `@orkestrel/<name>` for the primary/core surface, `@orkestrel/<name>/<surface>` for a secondary surface — never the in-repo `@src/*` alias, which is reserved for source and tests.

---

## 23. Communication style

- Short summary in chat — no walls of text.
- Show exact changes using diff format.
- Do the work — don't ask permission to do something obvious.
- Verify before claiming done: run the gate, read the output, then report.
