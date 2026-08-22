---
paths:
  - 'src/**/*.ts'
  - 'app/**/*.{ts,vue}'
  - 'tests/**/*.ts'
  - 'configs/**/*.ts'
  - 'vite.config.ts'
  - 'tsconfig.json'
  - 'package.json'
---

# Architecture and placement rules

## Centralized-file pattern

| Content                   | Sole location                                                |
| ------------------------- | ------------------------------------------------------------ |
| Interfaces/types          | `*/types.ts`                                                 |
| Constants/data            | `*/constants.ts`                                             |
| Template definitions      | `*/templates.ts`                                             |
| Pure helpers              | `*/helpers.ts`                                               |
| Guards                    | `*/validators.ts`                                            |
| Guard combinators         | `*/combinators.ts`                                           |
| Owned snapshots           | `*/cloners.ts`                                               |
| Coercers                  | `*/parsers.ts`                                               |
| Shape values              | `*/shapers.ts`                                               |
| Value inferers            | `*/inferers.ts`                                              |
| Shape/algorithm compilers | `*/compilers.ts`                                             |
| Entity/value factories    | `*/factories.ts`                                             |
| Middleware factories      | `*/middlewares.ts`                                           |
| Request handlers          | `*/handlers.ts`                                              |
| Route tables              | `*/routes.ts`                                                |
| Seeders                   | `*/seeders.ts`                                               |
| Schemas                   | `*/schemas.ts`                                               |
| Compiled contracts        | `*/contracts.ts`                                             |
| Relations                 | `*/relations.ts`                                             |
| Error classes/guards      | `*/errors.ts`                                                |
| Public exports            | `*/index.ts`                                                 |
| Implementations           | `*/[domain]/[Entity].ts`, one class per file                 |
| Function modules          | a designated folder's `[function].ts`, one function per file |

Use only the centralized files an environment needs.

## Declaration placement

- An implementation file contains imports and exactly one class implementation with `#` fields.
- It contains no module-scope interface, type, constant, or free function—even when private to that file.
- A function module contains imports and exactly one exported function named for its file. Everything else extracts by kind exactly as it does from a class module.
- Extract local declarations by kind. “Only used here” and “not exported” are not exemptions.
- Every declaration in a centralized file is exported. Fold away a trivial single-use declaration or export/test it; never leave it hidden.
- The only permitted non-exported module-scope declarations are in a runtime entrypoint that must be self-contained and cannot import siblings, such as raw source loaded in a worker. Explain that necessity in a comment.
- A runtime entry—`src/bin/main.ts`, `app/browser/main.ts`, `app/server/main.ts`—is a fixed name, not a centralized kind file. Both the data rule and the function rule reach it, so it declares no module-scope constant and no module-scope function: it imports what it needs and runs. The self-contained exception above covers only an entrypoint that cannot import siblings.
- Perform a cleanup sweep after implementation: no stray implementation-file declarations, non-exported/wrong-kind centralized declarations, prohibited nested declarations, duplicate implementations, compatibility aliases, superfluous wrappers, stale imports/barrel rows, or untested extracted functions.

## Kind purity

- Each centralized file contains only its named kind.
- Module-scope constants live only in `constants.ts`, use UPPER_SNAKE_CASE, and freeze object/array data with `Object.freeze`.
- A camelCase namespace containing functions is helper behavior, not constant data; place it in `helpers.ts`.
- `helpers.ts` is exported reusable infrastructure. A reusable regex, parser, header flattener, signer, or similar fragment has one implementation used by source, tests, and fixtures.
- A would-be helper has these outcomes:
  - trivial and genuinely single-use → fold into its caller;
  - non-trivial or reusable → extract, export, unit-test, and route every duplicate through it.
- `factories.ts`, `compilers.ts`, and `parsers.ts` are centralized files, not hiding places. Factory glue extracts to `helpers.ts`; pure compiler/parser recursion remains exported in its own kind file.
- Every exported function in `parsers.ts` is named `parse*`. Every exported function in
  `factories.ts` is named `create*`.
- Those name forms are one-directional. A name does not place a function: `createWriteDirectory`
  creates a directory rather than an entity and `isVacant` is a predicate rather than a `Guard<T>`,
  so both stay in `helpers.ts`. Placement follows what the function is; the name form follows
  placement.
- Repair a violation of those forms by deciding what the function **is** first, then moving or
  renaming to match. Both repairs exist and picking the wrong one does real damage.
  - Wrong file, right name → **move it**. A `scan*` in `parsers.ts` is a pure lexical leaf that
    belongs in `helpers.ts`. The barrel star-exports both, so the move leaves the published surface
    identical.
  - Right file, wrong name → **rename it in place**. A function returning a live entity is an entity
    factory and belongs in `factories.ts` whatever it is called, so `restoreThing` there is misnamed,
    not misplaced. Renaming moves the published surface and earns a version bump; that cost is the
    correct one to pay, and it is smaller than the alternative.
  - Never let the name choose. Relocating a correctly-placed function to escape a rename drags its
    dependencies with it — an entity factory moved into `helpers.ts` makes that file import an
    implementation class, and a leaf file that imports a class stops being a leaf for every module
    beneath it.
- Keep the leaf pair class-free. `helpers.ts` and `validators.ts` sit at the bottom of a module's
  graph: they import types, constants, errors, and each other, and they import no implementation
  class. Every file that constructs or drives a class — `cloners.ts`, `compilers.ts`, `factories.ts`,
  `shapers.ts` — sits above them, consumes them, and is never consumed by them. One cycle between
  the leaves is the shape this produces and is acceptable; an edge running downward from a
  class-importing file into the leaf pair is not.
- `templates.ts` and `contracts.ts` hold data only — shipped template definitions and compiled
  contracts. A function that builds either belongs in the kind file for what it builds.
- `handlers.ts` holds request handlers, which are functions. `routes.ts` holds data only: a route is
  `{ method, path, handler }`, so the table maps each path to a handler declared in `handlers.ts`
  and referenced by name, never to a function expression written in place. Neither file mixes kinds and the
  route set stays readable as data.

### What the policy sweep proves

The fleet policy sweep (`tests/policy.test.ts`, `tests/setupPolicy.ts`) enforces syntactic
placement: a declaration of a given syntactic kind appears only in a file permitted to hold that
kind. It reads declaration syntax and file name, never meaning.

- It proves that a module function sits in a function-kind file, that module data sits in a
  data-kind file, that every centralized declaration is exported, that a class sits in its matching
  implementation or errors file, and that `constants.ts` declares only UPPER_SNAKE_CASE consts with
  no bare collection literal.
- It proves that no source, test, config, or script file carries an `eslint-disable` or
  `oxlint-disable` directive.
- It does not prove a collection is frozen. It reads the declaration, never the value a call
  returns, so `Object.freeze([…])` and any other call initializer are one syntax to it. The freeze
  obligation in the kind-purity rules above binds regardless; only the bare literal is mechanical.
- It does not tell one function kind from another. Every centralized file that permits functions
  reads the same to it apart from the `parse*` and `create*` name forms: `cloners.ts`, `combinators.ts`,
  `compilers.ts`, `errors.ts`, `factories.ts`, `handlers.ts`, `helpers.ts`, `inferers.ts`,
  `middlewares.ts`, `parsers.ts`, `relations.ts`, `schemas.ts`, `seeders.ts`, `shapers.ts`, and
  `validators.ts`. That list is exhaustive, a new function kind joins it, and no later version of
  the sweep claims more.
- It reports no `data` violation in `helpers.ts`. The kind rules place a camelCase namespace of
  functions there, and a namespace of callables is not separable from a data table by declaration
  syntax, so `DATA_EXEMPT_FILES` in `tests/setupPolicy.ts` excludes the file. Ordinary module data
  there — `export const RETRIES = 3` — is unreported; the constants rule above binds regardless.
- It inspects no ambient declaration file: `.d.ts`, `.d.mts`, and `.d.cts` are all outside its
  reach. An ambient declaration file is not a module in the kind table, so it sits outside the
  parsed population entirely rather than being exempted from the `type` rule.
- It does not inspect class-expression members. A function assigned inside a class-expression
  method is unreported; the functions rule above still binds, and cleanup and review enforce it.
- The cleanup sweep and independent review prove kind purity across those files. A helper misfiled
  as a parser, a coercer misfiled as a guard, a compiler misfiled as a factory, and a shaper
  misfiled as a cloner are review findings, not red tests.
- It does not decide barrel membership. It parses each file alone and resolves no module, so it
  cannot tell whether a declaration is reachable from its barrel. That question belongs to each
  package's `tests/guides.test.ts`, which imports the barrel and gets real resolution. Do not add
  module resolution here to duplicate it.
- The kind table is mandatory whether or not a test can see the violation.

## Wrapper test

A wrapper survives only when it adds a real boundary, invariant, composition, translation, lifecycle, or materially narrower contract.

- Delete one-line delegates, pass-through factories, rename-only helpers/getters, compatibility aliases, and wrappers around semantically identical platform or declared-dependency primitives.
- Rename or import the real symbol and update every consumer atomically. Do not preserve a wrapper to avoid downstream edits.
- Do not re-export a dependency's symbol from this package.
- A public class method composes real entity behavior; it never exists only to forward 1:1 to a helper.
- Audit callers and callees after every extraction so the old path and duplicate implementation do not remain.

## Functions and orchestration

- Never declare or assign a function inside another function or method.
- This bans local `function`, `function*`, and `const fn = () => ...`, regardless of caller count.
- The only in-body function expressions allowed are an anonymous callback passed directly as an argument and an anonymous function returned directly as the result (the factory/combinator pattern).
- Instance-bound work that reaches state or sibling methods is a method, not a free function.

Separate these roles:

1. **Public method:** implements the interface and genuinely composes behavior; never forwards 1:1 to one helper.
2. **`#` private method:** stateful/instance-bound orchestration or the class's defining recursive/compositional algorithm.
3. **Centralized helper:** pure referentially transparent leaf, independently understandable/testable without class knowledge.

Apply the leaf test:

1. Reaches `#` state or a sibling method → private method.
2. Pure self-contained computation (key, format, compare, convert, lookup, projection, one unification) → exported helper.
3. Recursive spine or composition of leaves (`solve`, `isolate`, `prove`, chaining, relational join), even if pure → private method.
4. Defining engine internals remain methods when extraction would hollow the class into a thin delegate.

Extract pure leaves aggressively; keep the class's actual behavior.

## Class order

1. `#` private fields: context, options, state/result, child managers.
2. Constructor: initialize context/options and instantiate child managers.
3. Public interface: getters, then methods.
4. `#` private methods.

Store child managers in `#` fields and expose readonly getters typed as their interfaces.

## Middleware

- Middleware is behavior `(context, next) => ...`, never a class with one `handle` method.
- Place middleware factories in `middlewares.ts` as `createX(options): Middleware`; keep them distinct from entity/value factories.
- Keep middleware-local state closure-private.
- If consumers must address, share, inspect, or replace that state, extract the state to a pluggable class supplied as an option, with an in-memory default.
- Extract reusable cross-middleware machinery to helpers/classes.
- `MiddlewareManager` is the sole manager of the middleware composition chain; do not create one manager per middleware.

## Environment/module placement

- Shared cross-environment logic belongs in the central core/shared layer. Other environments import core; core imports neither browser nor server.
- An environment with multiple modules keeps cross-module types/helpers at the environment root and module-specific declarations inside the module.
- Promote a declaration to the environment root only when at least two modules use it.
- The environment barrel re-exports root files and module barrels.
- Cover cross-cutting environment-root helpers with behavioral tests; each module API receives its own guide parity.

### Entity subfolders

- When one entity grows a family (entity + manager or sibling implementations), nest only its class files in a lowercase plural folder.
- Keep its interfaces in module-root `types.ts`, factories in module-root `factories.ts`, and exports in the module barrel.
- Entity subfolders never grow their own centralized files.

### Kind or folder

- A word is either a centralized kind or a domain folder, never both.
- A folder named for a centralized kind—`helpers/`, `validators/`, `handlers/`—is that kind's file, not a folder.
- `FUNCTION_DOMAIN_FOLDERS` in the fleet-canon register (`tests/setupPolicy.ts`) registers the
  folder paths whose direct modules are function modules. Registration makes a path eligible and
  fixes the declaration shape checked there; it judges nothing about what a module does.
- Never infer a function domain from a folder's name; a camelCase module inside an unregistered
  folder is misplaced.
- Register a folder only when its direct modules are camelCase single-function `.ts` modules. A
  folder of PascalCase single-file components, or of entity classes, never qualifies.
- Request a new domain through a fleet-canon change. There is no workspace-local registration path.

### Extension categories

- A designed extension point—drivers, stores, transports—gets its category folder even with one concrete class.
- This applies both to consumer implementations of another domain's contract and default implementations beside the defining contract.
- The contract remains in module-root `types.ts`; only concrete classes nest.
- Nest because the category is a designed growth seam, not because a class name happens to end in `Store` or `Driver`.
- Co-equal native-object wrappers that are core primitives stay flat.

### Stores

Choose the access shape:

- **Point access:** `get`, `set`, `delete`.
- **Bulk restore:** `save`, `load`, `remove`, `clear`.

Every shape obeys:

- The stored value carries its own id; do not pass a separate id to `set`/`save`.
- Every primitive is async and returns a `Promise`.
- Deleting/removing a missing key is a no-op.
- Concrete stores live in `stores/`; the interface stays in module-root `types.ts`; `create*Store` factories stay in `factories.ts`.

## Barrel exports

- `*/index.ts` is the sole public barrel.
- Only an `index.ts` may re-export.
- A barrel contains only `export * from './module.js'` declarations. Do not use
  named, default, namespace, or type-only barrel exports.
- A star-export collision is a design failure: rename the conflicting concept
  at its owner and update consumers. Never hide the collision with a selective
  barrel row.
- Never re-export a symbol originating in another package; fix consumer imports to the originating package.
- Implementation files export their own classes directly.
- Expose every intentional top-level source export through its correct environment barrel.
- Never let current consumer count gate later exposure. Developers receive the same supported
  mechanisms the package uses, so they retain full control and customization.
- If a declaration should not be public, make it a true local or runtime-private detail, or remove
  the capability for a substantive reason. Never leave an intentional reusable export stranded
  outside the barrel.
- One-class-per-file evicts some classes from their only caller, and `export` on such a file is
  structural rather than a statement of intent. Barrel that class when a consumer can construct it
  from values they already hold. Intern it — out of the barrel, and named in the package's parity
  `INTERNAL` list — when its constructor requires a value only its owner produces, or when the
  public value is a projection of the instance rather than the instance. A class named in a public
  signature is always barrelled.
- Delete a barrel row whose class no consumer can construct, and delete its `@example` with it. A
  row obliges a documented, runnable example, so a class kept public without one is drift that
  parity cannot see.
- When a symbol moves, update every import; never leave a compatibility re-export.

```ts
export * from './types.js'
export * from './constants.js'
export * from './errors.js'
export * from './validators.js'
export * from './helpers.js'
export * from './factories.js'
export * from './greeters/Greeter.js'
```

## System constraints

- Build or substantively expand a capability with its first real consumer; do not speculate. This
  gate applies only when creating or expanding the capability, not to its later barrel exposure.
- Keep interfaces to the smallest primitives the capability requires.
- For multiple backends, implement shared querying/paging/aggregation in one engine over those primitives. A backend may override an operation only with a genuine native fast path and otherwise falls back to the engine.
- Centralize any pattern repeated twice.
- Keep everything generic/reusable and free of unrelated-project logic.
- Do not expand the capability set without concrete need. Once that capability exists intentionally,
  its reusable top-level exports follow the barrel rule above without a second consumer gate.
- Do not remove structural files because they are currently empty.
- Prefer the smallest complete implementation that preserves architecture.
- No deprecation aliases, compatibility shims, or backward-compatibility branches; update all consumers atomically.
- No polling/busy loops or recursive microtasks as architecture. Park idle work on an event/abort wakeup and yield long work in cooperative quanta.
- Framework/server utilities provide mechanism—HMAC, CORS, parsing, sessions, cookies, CSRF, static serving—not product policy such as user models, login flow, or authorization.
