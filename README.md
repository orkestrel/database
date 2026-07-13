# @orkestrel/database

A typed database abstraction for the `@orkestrel` line — a single
environment-agnostic core engine (`Database`, `Table`, `Query`, `Cursor`,
`Clause`) over pluggable storage drivers at the seams. Built to sit beside
`@orkestrel/contract` (validation) and `@orkestrel/emitter` (observable
lifecycle), reusing both as it takes shape.

## Install

```sh
npm install @orkestrel/database
```

## Requirements

- Node.js >= 24 (`node:sqlite`, used by the `./server` SQLite driver, emits an
  `ExperimentalWarning` on Node's current stable line)
- Core is ESM; the `./server` subpath ships dual ESM+CJS builds; `./browser`
  is ESM-only

## Status

Pre-release (`0.0.2`): the core engine, and the memory, JSON file, SQLite,
and IndexedDB drivers are all implemented and tested, but the public API is
still unstable and may change without notice. See
[guides/src/database.md](./guides/src/database.md) for the full documented
surface.

## Package

Published as three environment-scoped entry points per the `exports` field
in `package.json`: `.` (the shared, environment-agnostic core engine plus
the in-memory driver), `./server` (adds the JSON file and SQLite drivers),
and `./browser` (adds the IndexedDB driver). Core and `./server` ship dual
ESM+CJS builds; `./browser` is ESM-only.

### Release order

This package depends on `@orkestrel/sqlite` and `@orkestrel/indexeddb` at
`^0.0.1`. Both of those packages have a `0.0.3` in progress (fixing several
driver-level issues this package's SQLite and IndexedDB drivers rely on) —
`@orkestrel/sqlite@0.0.3` and `@orkestrel/indexeddb@0.0.3` must publish
before this package's next release, at which point those dependency ranges
bump to `^0.0.3`. They stay `^0.0.1` in this commit so `npm ci` keeps
resolving the currently-published `0.0.1` wrappers.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
