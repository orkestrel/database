# Guides

A dual-axis index into this repository's guides — by concept, and by
directory (AGENTS §22).

## By concept

| Concept  | Spec                                 | Source                                                                                    | Tests                                                                                                                         |
| -------- | ------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Database | [`src/database.md`](src/database.md) | [`src/core`](../src/core), [`src/browser`](../src/browser), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/browser`](../tests/src/browser), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory     | Guide                                |
| ------------- | ------------------------------------ |
| `src/core`    | [`src/database.md`](src/database.md) |
| `src/browser` | [`src/database.md`](src/database.md) |
| `src/server`  | [`src/database.md`](src/database.md) |

## Dependency reference

[`src/contract.md`](src/contract.md) is a byte-identical mirror of the guide for
`@orkestrel/contract` — one of this package's runtime dependencies. It documents
**that package's** surface (guards, combinators, parsers, and the shape DSL), not
anything sourced in this repo; it is kept here so a reader of this package can see
the primitives it is built from without leaving this guide set.

[`src/emitter.md`](src/emitter.md) is a byte-identical mirror of the guide for
`@orkestrel/emitter` — this package's other runtime dependency. It documents
**that package's** surface (the `Emitter` class, `EmitterInterface`, and the
listener-isolation contract), not anything sourced in this repo; it is kept here
so a reader of this package can see the primitives it is built from without
leaving this guide set.

[`src/abort.md`](src/abort.md) is a byte-identical mirror of the guide for
`@orkestrel/abort` — this package's third runtime dependency. It documents
**that package's** surface (the `Abort` class, `AbortInterface`, and the
parent-linking / cascading-cancellation contract), not anything sourced in
this repo; it is kept here so a reader of this package can see the primitives
it is built from without leaving this guide set.

[`src/guide.md`](src/guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides/src/parity.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not anything
sourced in this repo; it is kept here so a reader of the parity suite can see
the primitives it is built from without leaving this guide set.

[`src/indexeddb.md`](src/indexeddb.md) is a byte-identical mirror of the guide
for `@orkestrel/indexeddb` — this package's fourth runtime dependency. It
documents **that package's** surface (`IndexedDBDatabase`, stores, indexes,
cursors, and transactions), not anything sourced in this repo; it is kept
here so a reader of this package can see the primitives its IndexedDB driver
is built from without leaving this guide set.

[`src/sqlite.md`](src/sqlite.md) is a byte-identical mirror of the guide for
`@orkestrel/sqlite` — this package's fifth runtime dependency. It documents
**that package's** surface (`SQLiteDatabase`, prepared statements, and
transactions over `node:sqlite`), not anything sourced in this repo; it is
kept here so a reader of this package can see the primitives its SQLite
driver is built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; §22 documentation-as-contracts.
