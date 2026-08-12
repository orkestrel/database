# Research and capability audit

## Establish sources

Use this source order:

1. Current user intent and repository guide/spec.
2. Current authoritative types and real consumer behavior.
3. Official upstream documentation, protocol specifications, or primary source.
4. Installed dependency declarations, types, guides, and runtime exports.
5. Current implementation and tests.
6. `old/`, copied projects, branches, and historical code as prior art only.

Browse when the user requests research, upstream behavior can change, or current primary documentation is material. Cite sources in the resulting guide or report when that improves traceability. Do not rely on remembered versions or capabilities.

## Keep research focused

Scout paths and symbols before reading deeply. Read the governing contract and named implementation files first-hand. Pull additional files into context only when they answer a specific question.

For legacy code:

- salvage traversal, algorithms, test scenarios, or proven edge handling;
- restate the desired behavior under the current contract;
- reject old naming, dependencies, API shape, policy, and workarounds unless independently justified;
- never copy a legacy limitation merely because its code exists.

## Build a capability matrix

Record one row per meaningful capability:

| Capability | Expected behavior | Current support | Evidence | Gap/risk | Action | Tests |
| ---------- | ----------------- | --------------- | -------- | -------- | ------ | ----- |

Include:

- public and internal behavior needed by real consumers;
- official upstream capabilities that fit the requested scope;
- architectural limitations that cannot or should not be copied;
- legacy features worth salvaging;
- every `TODO`, deferred branch, placeholder, or documented omission in scope.

Classify each row:

- **implement**: missing and in scope;
- **repair**: present but unsound, incomplete, or untested;
- **retain**: correct and sufficiently proven;
- **exclude**: intentionally outside the package boundary, with a concrete reason.

“Deferred” is not a final classification for in-scope work.

A defect found after its row closed is not in-scope work of this matrix. Record it against the capability it belongs to and carry it into the next matrix — unless it falsifies its row's claim through a path this package itself ships, which makes it this matrix's repair.

## Convert evidence into design

Before implementation:

- distinguish facts from inferences;
- identify the lowest layer that owns each mechanism;
- identify API changes and all affected consumers;
- state the invariants and failure behavior;
- state what would prove completion.

Do not broaden a package to match an upstream framework wholesale. Implement the smallest complete capability set that serves the requested consumers and preserves the package's boundary.
