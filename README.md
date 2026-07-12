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
- ESM-only (no CommonJS build)

## Status

The public API is under design and not yet implemented — this package
currently ships no runtime code. This README will gain an install snippet,
usage examples, and a guide link once the design lands.

## Package

Published as two environment-scoped entry points per the `exports` field in
`package.json`: a shared core (with the in-memory driver) and `./server` (the
JSON file driver). IndexedDB and SQLite drivers are planned once their
backing packages exist.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
