---
paths:
  - '**/*.{ts,tsx,mts,cts,vue}'
---

# Naming and API-shape rules

Names are public API. A consumer should be able to predict them without documentation.

## Entity-scoped names: one word

Properties/getters, methods, option keys, and event names belong to an entity whose type already supplies context. Use one descriptive word:

```ts
interface AgentInterface {
	readonly id: string
	readonly context: AgentContextInterface
	readonly status: AgentStatus
	generate(): Promise<string>
	stream(options?: AgentStreamOptions): AsyncGenerator<string, string>
	abort(): void
}
```

Hard targets:

- Public properties: one word.
- Public methods: one word; use two only when no single verb is accurate.
- Ungrouped option keys: one word.
- Grouped option key: the configured entity noun; every leaf remains one word.
- Events: one present-tense verb or noun.
- Private methods: two or three words are acceptable.

The rule does not apply to standalone helpers, type names with role suffixes, or qualified constants.

## Split instead of compounding

A compound entity member usually means the API contains multiple entities or behaviors. Do not create `addTool`, `removeDocument`, `databasePath`, or `serverTimeout`.

### Group options by entity

```ts
interface ServerOptions {
	readonly server?: { readonly port?: number; readonly timeout?: number }
	readonly database?: { readonly path?: string; readonly timeout?: number }
}
```

Never flatten these into prefixed keys.

### Extract sub-entities

Move prefixed method families to a manager and expose it as a noun:

```ts
interface AgentContextInterface {
	readonly instructions: InstructionManagerInterface
	readonly documents: DocumentManagerInterface
	readonly tools: ToolManagerInterface
}
```

Call `context.instructions.add(input)`, not `context.addInstruction(input)`.

### Split behavioral variants

Do not hide multiple algorithms behind a discriminator parameter:

```ts
parseJSON(input)
parseYAML(input)
parseTOML(input)
```

Do not write `parse(input, format)`. A literal that selects a different action is a magic mode and requires separate functions/methods.

Distinguish behavior from data:

- Different value selects a different action/algorithm/shape of work → split.
- Different value selects a datum for the same operation → keep it as data.
- Discriminants, reasoning/error codes, uniformly applied value enums, and field/key selectors are data.

## Standalone helpers

Module helpers have no owning entity at the call site, so default to `{verb}{Noun}`:

`generateId`, `computeHash`, `extractColumns`, `derivePhaseStatus`, `inferLanguage`, `normalizePath`, `sanitizeFilename`, `matchesGlobPattern`, `belongsTo`, `hasMany`.

- A one-word helper is valid only when its meaning and arguments are unmistakable: `delay`, `clamp`, `tokenize`, `similarity`.
- Reject vague helpers such as `process` or `handle`.
- A helper prefix has one project-wide meaning: `extract*` extracts structure, `infer*` derives, `compute*` calculates deterministically, and `matches*` is a predicate.
- When a helper family grows around one shape, promote it to a class with entity-scoped one-word methods.

## General vocabulary

The root design laws in `AGENTS.md` — one term per concept, boolean behavior switches, `undefined` absence, derived state, real domain states, and named discriminants — bind here. This section adds only their naming specifics:

- Describe what a thing is, not its implementation.
- Prefer short common English; avoid jargon, abbreviations, and non-universal acronyms.
- Properties are nouns; methods are verbs.
- Booleans read as assertions: `aborted`, `exhausted`, `expired`.
- Accessors use bare nouns, never `get*`/`set*`.
- Do not alternate `count`/`length`/`size`/`total` or `abort`/`cancel`.
- Name the axis a discriminant varies: `relationship`, `command`, `category`, `operation`, `via`.
- A binary switch is a boolean such as `bail`, never `'continue' | 'halt'`; genuine discriminants, multi-state lifecycles, conventional value pairs (`ascending`/`descending`, `and`/`or`), and external-spec literals remain unions.

## Acronyms

Keep canonical case:

- Initialisms: `JSON`, `HTTP`, `NDJSON`, `SSE`, `URL`, `URI`, `SQL`, `API`, `DB`, `TTL`, `UUID`, `RFC`, `JWT`.
- Brands/proper names: `SQLite`, `IndexedDB`, `GitHub`, `OAuth`.
- PascalCase identifiers preserve the acronym: `JSONSchema`, `HTTPServer`, `NDJSONParser`, `SSEStream`, `URLPattern`, `SQLiteDriver`, `IndexedDBDriver`.
- camelCase lowers an acronym only when it leads: `jsonValue`, `urlPath`, `sqlText`; otherwise preserve it: `parseJSON`, `toJSON`, `fromNDJSON`, `signJWT`, `compileSQL`.
- Ecosystem-conventional `id` and leading `url`/`uri` remain lowercase.
- Domain folders remain lowercase: `http/`, `sqlite/`, `indexeddb/`, `websocket/`.
- Never title-fold canonical acronyms into `Json`, `Ndjson`, `Http`, `Sse`, or `Sqlite`.

## Type-level identifiers

| Kind                      | Required form                           |
| ------------------------- | --------------------------------------- |
| Behavioral interface      | `{Entity}Interface`                     |
| Options/config            | `{Entity}Options`                       |
| Creation input            | `{Entity}Input`                         |
| Outcome/output            | `{Entity}Result`                        |
| Execution context         | `{Entity}Context`                       |
| Event map                 | `{Entity}EventMap`                      |
| Union/enum-like           | `{Entity}{Noun}`                        |
| Plain non-behavioral data | `{Entity}`                              |
| Function type             | `{Entity}Handler` or `{Entity}Function` |
| Manager interface         | `{Entity}ManagerInterface`              |

- Never prefix interfaces with `I`.
- Never pluralize type names.
- `Handler` is for function types, never classes.

## Value-level identifiers

| Kind           | Required form                         |
| -------------- | ------------------------------------- |
| Class          | PascalCase `{Entity}`                 |
| Manager class  | PascalCase `{Entity}Manager`          |
| Factory        | camelCase `create{Entity}`            |
| Guard          | camelCase `is{Condition}`             |
| Helper         | camelCase `{verb}{Noun}`              |
| Constant       | UPPER_SNAKE_CASE `{QUALIFIER}_{NOUN}` |
| Property/field | camelCase bare noun                   |
| Method         | camelCase bare verb                   |
| Boolean        | camelCase adjective/past participle   |

## Fixed derivation/construction forms

- `is*`: total `Guard<T>`; never throws; returns false off-shape.
- `parse*`: coercion producing `T | undefined`; cross-type conversion never belongs in a guard.
- `create*`: factory constructing an entity/value.
- `*Of`: builder combining constituent parts into a container/guard/value, such as `arrayOf(guard)` or `boundsOf(min, max)`.
- `{noun}To{Noun}`: projection from a whole to a derived view, such as `definitionToSnapshot`.
- `*Shape`: `ContractShape` value/JSON-Schema blueprint, not a function or type.
- Leading `_`: intentionally unused binding only; never privacy.

For `_` bindings:

- Use only for genuine callback/signature conformance, rest omission, swallowed catches, or intentionally unused loop variables.
- Verify each use is intentional; remove `_` and wire the value if it should be consumed.
- Remove the parameter when signature compatibility does not require it.
- Prefer a short justification for each rare `_` in `src/`.

## Tallies

- A lone unambiguous tally is `count`.
- When several distinct tallies coexist, name each fact: a pool may expose `size`, `idle`, and `active`; a queue may expose `count` and `active`.
- Do not expose several ambiguous `count` properties.

## Files and folders

| Kind            | Pattern                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| Domain folder   | lowercase plural entity: `agents/`, `tools/`                                     |
| Implementation  | PascalCase entity: `Agent.ts`                                                    |
| Function module | camelCase function: `renderGrid.ts`                                              |
| Test            | source filename without extension + `.test`: `Agent.test.ts`, `useTheme.test.ts` |
| Guide           | lowercase domain: `agents.md`                                                    |

## Fixed lifecycle vocabulary

| Verb      | Exact meaning                             |
| --------- | ----------------------------------------- |
| `start`   | Begin or restart                          |
| `stop`    | End permanently                           |
| `pause`   | Suspend resumably                         |
| `resume`  | Continue after pause                      |
| `skip`    | Mark intentionally unexecuted             |
| `abort`   | Cancel with signal propagation            |
| `clear`   | Reset state without destroying the entity |
| `destroy` | Tear down and release resources           |
| `execute` | Run primary work to completion            |

Never introduce synonyms such as `cancel`, `reset`, or `run` for these meanings.

## Rejected naming

- Generic words: `data`, `info`, `item`, `thing`, `obj`.
- Type-encoded names: `nameString`, `countNumber`.
- Abbreviations: `cfg`, `doc`, `msg`; write `config`, `document`, `message`.
- `@internal` methods; use `#` privacy.
- Compound entity members where grouping/extraction/splitting provides the context.
- Behavior-selecting magic strings.
