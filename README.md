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

- Node.js >= 24
- Core is ESM; the `./server` subpath ships a CommonJS build

## Status

Pre-release (`0.0.1`): the core engine and the memory and JSON file drivers
are implemented and tested, but the public API is still unstable and may
change without notice. See [guides/src/database.md](./guides/src/database.md)
for the full documented surface.

## Package

Published as two environment-scoped entry points per the `exports` field in
`package.json`: a shared core (with the in-memory driver) and `./server` (the
JSON file driver). IndexedDB and SQLite drivers are planned once their
backing packages exist.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
