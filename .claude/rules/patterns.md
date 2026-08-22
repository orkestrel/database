---
paths:
  - 'src/**/*.ts'
  - 'app/**/*.{ts,vue}'
  - 'tests/**/*.ts'
---

# API pattern rules

## Declared ecosystem capabilities

Before writing a guard, parser, combinator, outcome, safe exception boundary, contract shape/compiler, schema utility, error narrower, emitter helper, or other general primitive:

1. Inspect `package.json`, the lockfile, vendored dependency guides, and exact installed declarations/exports.
2. Build a semantic overlap map between the proposed/local behavior and declared `@orkestrel/*` capabilities.
3. Reuse the originating package directly when semantics match.
4. Keep local behavior only when it adds a real domain invariant, composition, projection, translation, or intentionally different contract.
5. Test the difference. Similar names are not proof of equivalent semantics.

Never reimplement or rename-wrap a declared package primitive. Do not add an ecosystem dependency unless the user explicitly authorizes it.

## Options

- Top-level keys are single words.
- Group related settings beneath the configured entity noun; every leaf is one word.
- Never encode grouping through prefixes such as `serverPort` or `databasePath`.
- Reserve `on` exclusively for initial `EmitterHooks`.
- Explain short option keys in TSDoc `@remarks`, not through longer names.

```ts
interface ServerOptions {
	readonly on?: EmitterHooks<ServerEventMap>
	readonly error?: EmitterErrorHandler
	readonly server?: { readonly port?: number; readonly timeout?: number }
	readonly database?: { readonly path?: string }
}
```

## Managers

### Accessors

Managers expose one item and all items through singular/plural domain nouns:

```ts
entity(key): EntityInterface | undefined
entities(): readonly EntityInterface[]
```

Examples: `timeout(id)`/`timeouts()`, `agent(id)`/`agents()`.

### Batch operations

One single-word verb carries these overloads:

```ts
method(): void
method(id: string): boolean
method(ids: readonly string[]): boolean
```

- No argument applies to all.
- One id applies to one.
- An id list applies to those items and returns true only when all succeed.
- Never split into `methodAll`, `methodOne`, or `methodMany`.
- When a single item type can itself be a list/open record, declare the array overload first and document how callers express one list-valued item.

## Stateful emitters

An entity with lifecycle transitions, constraints, or observable operations owns an emitter by composition:

1. Define `{Entity}EventMap` in `types.ts`.
2. Add `readonly on?: EmitterHooks<{Entity}EventMap>` and `readonly error?: EmitterErrorHandler` to options.
3. Add `readonly emitter: EmitterInterface<{Entity}EventMap>` to the interface.
4. Store `readonly #emitter: Emitter<{Entity}EventMap>` and expose it through `get emitter()`.
5. Initialize with both hooks and error handling: `new Emitter({ on: options?.on, error: options?.error })`. Positional constructors thread both values equivalently.
6. Emit directly with `this.#emitter.emit(...)`; do not add a guarded `#notify`.
7. Call `this.#emitter.destroy()` last in the entity's `destroy()`.

Never inherit from `Emitter`, write delegation boilerplate, or use `Omit` to reshape it.

### Listener isolation

- The emitter isolates each listener; one throw never prevents sibling listeners.
- It reports every listener throw to its own `(error, event)` error handler.
- It never rethrows a listener error.
- A throwing error handler is swallowed to prevent recursion.
- Never add `observerError` or another listener-failure event to a domain `EventMap`.
- A genuine domain I/O/transport `error` event is distinct and remains valid.

### Browser/DOM variant

In a pure browser-DOM environment where each entity already owns a host `Element`, the element may be the event host:

- emit a typed bubbling `CustomEvent` through shared dispatch helpers;
- subscribe with shared listener helpers;
- bind `options.on` through one `bindEventMap` helper.

Choose one event model per environment. `Emitter<TMap>` remains the default outside exclusively DOM-bound environments.

### Event maps

- Event names are single present-tense verbs or nouns: `start`, `connect`, `expire`, `exhaust`, `drain`, `chunk`.
- Never publish a generic `status` event carrying a transition value; publish each transition as its own event.
- Type errors as `unknown`.
- Use empty tuples for signals and labeled tuple elements for IDE clarity.
- Keep an entity's event map focused, normally four to eight events.

## Validation and contracts

Use these orthogonal contract mechanisms:

| Surface          | Contract                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| `validators.ts`  | Total `is*` guards: `(unknown) => value is T`; no coercion/side effects       |
| `combinators.ts` | Build guards from guards: `arrayOf`, `recordOf`, `unionOf`                    |
| `parsers.ts`     | Flat coercers returning `T \| undefined`                                      |
| Shape DSL        | One `ContractShape` compiled into schema, guard, parser, and seeded generator |

- Use plain guards/parsers for small contracts.
- Use the shape DSL only when validation, serialization, and generation parity earns its complexity.
- When `@orkestrel/contract` is declared, use its exact installed guards, parsers, combinators, outcomes, `attempt` boundary, and shape DSL wherever their semantics match. Do not maintain a local copy of those primitives.
- A guard never throws for adversarial input, cycles, deep nesting, or hostile prototypes; return false.
- Recursive guards track ancestors and cap depth.
- Recursion enters only through an explicit lazy gate.
- Non-lazy structural cycles fail at build time, not runtime.
- Parse/guard soundness is mandatory:
  - guard-valid input is never rejected by its parser;
  - every parsed result satisfies its guard.
- Derive parser and guard from one source or test the round trip.

### Foreign contracts

A value returned by an interface another package publishes is FOREIGN data. Own it, validate what you dereference, and narrow nothing.

- Enforce the published contract and no more: accept unknown members, accept any implementation the interface admits including a class instance, and check each member as its published type declares it. A member typed `number` is not checked as an integer.
- Reserve the exact-record guard for a record this package owns. Over a foreign interface it refuses values the interface permits and fails closed on a valid implementation.
- Narrow nothing in an ownership transform. Where the published contract is wider than the copy mechanism, seal the value in place rather than refusing it.
- Own a foreign value at arrival, validate the owned copy, and read the foreign object exactly once. Read count is this package's decision, so no result may depend on it.
- Validate only what the package dereferences from a union it must narrow. Own a wide foreign record it merely carries and leave it unvalidated. State that asymmetry on the option that admits the implementation.
