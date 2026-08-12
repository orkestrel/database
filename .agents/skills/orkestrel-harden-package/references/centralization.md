# Centralization and simplification

Placement, kind purity, the wrapper test, the no-nested-function law, and barrel law live
in `.claude/rules/architecture.md`; shared test infrastructure and helper placement live in
`.claude/rules/tests.md`. This reference adds only the sweep those laws assume: what to
inventory, how to classify, and what must be proven before acceptance.

## Inventory what you touched

Inspect every touched implementation and centralized file, then sweep the full affected
environments.

| Where               | Inventory                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation file | Interfaces and type aliases, module constants and data, free functions/guards/parsers/factories/schemas, function declarations or assignments inside bodies, extra classes, imports and exports stranded by a move                                            |
| Centralized file    | Every module declaration: does it match that file's kind, is it exported, is every intentional top-level export reachable from the correct environment barrel regardless of current consumers, does it carry direct behavioral coverage when it carries logic |
| Environment root    | Every declaration promoted there: at least two consuming modules, or it belongs to the owning module's centralized file                                                                                                                                       |

The rare runtime-self-contained entrypoint exception must be literally required for
execution and must explain why sibling imports cannot work.

## Classify every function

| Signal                                     | Home                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| Reaches instance state or a sibling method | Class method                                         |
| Pure self-contained computation            | Exported centralized helper, parser, compiler, guard |
| Defining recursive or compositional spine  | Class method, after extracting its pure leaves       |
| Trivial and genuinely one-use              | Inline it into the caller                            |

Never move logic into a nested function to evade centralization. An anonymous callback
passed directly to another operation stays a callback, not a hidden helper declaration.

## Hunt the wrapper

Search callers and callees for one-line delegates, pass-through factories, getters that
rename another public getter, duplicate guards or parsers a declared dependency already
supplies, compatibility aliases and re-exports, and functions whose only purpose is
avoiding a downstream rename. The architecture rules' wrapper test decides each one; a
survivor owns a real boundary, invariant, composition, translation, lifecycle, or
materially narrower contract. Otherwise use or rename the real symbol and update every
consumer.

Do not hollow a class into public methods that each forward to one helper.

## Consolidate tests

Sweep test files for repeated or reusable input and result records, builders and
factories, recorders and event capture, wait and readiness helpers, temporary workspace or
fixture-server setup, browser and DOM builders, event factories, and service request
builders or response assertions. Move each into the setup file its environment owns.

Add focused tests for every exported function extracted from production code. Do not create
isolated tests for declaration-only types, constants, barrels, or error definitions.

## Prove the sweep

Before acceptance, prove:

- no stray declarations remain in implementation files;
- no non-exported or wrong-kind declaration remains in centralized files;
- no prohibited nested function declaration or assignment remains;
- no duplicate or rename-only wrapper remains;
- every move updated imports, barrels, guides, and tests;
- test helpers are consolidated without over-generalizing one-off setup;
- files are valid UTF-8 with no replacement characters, mojibake, unintended control
  characters, or accidental trailing debris.

Review the complete diff after formatting. Formatting cannot substitute for the structural
sweep.
