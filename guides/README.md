# Guides

A dual-axis index into this repository's guides — by concept, and by
directory (see `.claude/rules/documentation.md` § Parity).

## By concept

| Concept  | Spec                         | Source                                                                                    | Tests                                                                                                                         |
| -------- | ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Database | [`database.md`](database.md) | [`src/core`](../src/core), [`src/browser`](../src/browser), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/browser`](../tests/src/browser), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory     | Guide                        |
| ------------- | ---------------------------- |
| `src/core`    | [`database.md`](database.md) |
| `src/browser` | [`database.md`](database.md) |
| `src/server`  | [`database.md`](database.md) |

## Dependency reference

[`contract.md`](contract.md) is a byte-identical mirror of the guide for
`@orkestrel/contract` — a runtime dependency. It documents
**that package's** surface (guards, combinators, parsers, and the shape DSL), not
anything sourced in this repo; it is kept here so a reader of this package can see
the primitives it is built from without leaving this guide set.

[`emitter.md`](emitter.md) is a byte-identical mirror of the guide for
`@orkestrel/emitter` — a runtime dependency. It documents
**that package's** surface (the `Emitter` class, `EmitterInterface`, and the
listener-isolation contract), not anything sourced in this repo; it is kept here
so a reader of this package can see the primitives it is built from without
leaving this guide set.

[`guide.md`](guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not anything
sourced in this repo; it is kept here so a reader of the parity suite can see
the primitives it is built from without leaving this guide set.

[`indexeddb.md`](indexeddb.md) is a byte-identical mirror of the guide
for `@orkestrel/indexeddb` — a runtime dependency. It
documents **that package's** surface (`IndexedDBDatabase`, stores, indexes,
cursors, and transactions), not anything sourced in this repo; it is kept
here so a reader of this package can see the primitives its IndexedDB driver
is built from without leaving this guide set.

[`sqlite.md`](sqlite.md) is a byte-identical mirror of the guide for
`@orkestrel/sqlite` — a runtime dependency. It documents
**that package's** surface (`SQLiteDatabase`, prepared statements, and
transactions over `node:sqlite`), not anything sourced in this repo; it is
kept here so a reader of this package can see the primitives its SQLite
driver is built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; see § Documentation contract.
