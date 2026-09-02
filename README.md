# @orkestrel/database

A typed database abstraction for the `@orkestrel` line — one public
`Database` over internal table/query engines and pluggable storage drivers at
the seams. Consumers use `TableInterface` and `QueryInterface`. Built to sit beside
`@orkestrel/contract` (validation) and `@orkestrel/emitter` (observable
lifecycle), reusing both directly. `TableInterface.cursor()` exposes the
`CursorInterface` contract for serial bulk mutation.

## Install

```sh
npm install @orkestrel/database
```

## Requirements

- Node.js >= 22.12.0, matching the package engine declaration
- The `./server` SQLite driver additionally requires a Node.js release that
  provides `node:sqlite`
- Core is ESM; the `./server` subpath ships dual ESM+CJS builds; `./browser`
  is ESM-only

## Status

Pre-release (`0.0.7`): the core engine and the memory, JSON file, SQLite,
and IndexedDB drivers are all implemented and tested, but the public API is
still unstable and may change without notice. See
[guides/database.md](./guides/database.md) for the full documented
surface.

## Package

Published as three environment-scoped entry points per the `exports` field
in `package.json`: `.` (the shared, environment-agnostic core engine plus
the in-memory driver), `./server` (adds the JSON file and SQLite drivers),
and `./browser` (adds the IndexedDB driver). Core and `./server` ship dual
ESM+CJS builds; `./browser` is ESM-only.

The server and browser drivers use the declared `@orkestrel/sqlite` and
`@orkestrel/indexeddb` package ranges. Wrapper upgrades are deliberate:
update the declared range, refresh the lockfile, run the full package gates,
and publish Database only after its wrapper dependencies are available.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
