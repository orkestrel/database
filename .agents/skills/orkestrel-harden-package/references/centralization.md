# Centralization and simplification

## Inventory declarations

Inspect every touched implementation and centralized file, then sweep the full affected environments.

For implementation files, inventory:

- interfaces and type aliases;
- module constants and data;
- free functions, guards, parsers, factories, and schemas;
- function declarations or assignments inside functions/methods;
- multiple classes;
- imports or exports left behind after moves.

Implementation files contain imports and one class. The rare runtime-self-contained entrypoint exception must be literally required for execution and must explain why sibling imports cannot work.

For centralized files, inventory every module declaration. Each declaration must:

- match that file's kind;
- be exported;
- be reachable from the sole public barrel when public by repository law;
- have direct behavioral coverage when it contains logic.

Promote a declaration to an environment root only when multiple modules consume it. Otherwise keep it in the owning module's centralized file.

## Apply the leaf test

Classify each function:

1. Instance state or sibling-method access: class method.
2. Pure, self-contained computation: exported centralized helper/parser/compiler/etc.
3. Defining recursive/compositional engine spine: class method after extracting its pure leaves.
4. Trivial, genuinely one-use expression: inline it.

Never move logic into a nested function to evade centralization. Anonymous callbacks passed directly to another operation remain callbacks, not hidden helper declarations.

## Remove superfluous wrappers

Search callers and callees for:

- one-line helper delegates;
- pass-through factories;
- getters that merely rename another public getter;
- duplicate guards/parsers already supplied by a declared dependency;
- compatibility aliases and re-exports;
- functions whose only purpose is avoiding a downstream rename.

A wrapper survives only if it owns a boundary, invariant, composition, translation, lifecycle, or materially narrower contract. Otherwise use or rename the real symbol and update every consumer.

Do not hollow a class into public methods that each forward to one helper. Keep meaningful orchestration on the entity and export only pure leaves.

## Consolidate tests

Sweep test files for repeated or reusable:

- input and result records;
- builders and factories;
- recorders and event capture;
- wait/readiness helpers;
- temporary workspace or fixture-server setup;
- browser/DOM builders and event factories;
- service request builders and response assertions.

Move host-independent helpers to `tests/setup.ts`; Node helpers to `tests/setupServer.ts`; browser helpers to `tests/setupBrowser.ts`; styles helpers to `tests/setupStyles.ts`; and live-service helpers to that project's dedicated setup.

Use customizable factories and inert stubs for data shapes. A scripted boundary stub may implement the real interface/protocol minimally to drive the system under test, but must not reproduce project-owned behavior or replace the integration being claimed. Otherwise use the real implementation, a temporary resource, a protocol-faithful fixture server, or the real external service.

Prefer recorders over spies. Do not use mocks or fakes.

Add focused tests for every exported function extracted from production code. Do not create isolated tests for declaration-only types, constants, barrels, or error definitions.

## Run the cleanup sweep

Before acceptance, prove:

- no stray declarations remain in implementation files;
- no non-exported or wrong-kind declaration remains in centralized files;
- no prohibited nested function declaration/assignment remains;
- no duplicate or rename-only wrapper remains;
- every move updated imports, barrels, guides, and tests;
- test helpers are consolidated without over-generalizing one-off setup;
- files are valid UTF-8 and contain no replacement characters, mojibake, unintended control characters, or accidental trailing debris.

Review the complete diff after formatting. Formatting cannot substitute for the structural sweep.
