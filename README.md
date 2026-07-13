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

Everything currently on the npm registry is at `0.0.1` — the wrapper repos'
`0.0.2`s were never published, so `0.0.2` is the next version for all three
packages and absorbs every change on this line.

This package's SQLite and IndexedDB drivers are built against the wrapper
surfaces documented by the mirrored guides in this repo — that is,
`@orkestrel/sqlite@0.0.2` and `@orkestrel/indexeddb@0.0.2` — and the
dependency ranges pin exactly those versions (`^0.0.2`; on a `0.0.x` version
a caret means exactly that patch: `>=0.0.2 <0.0.3`). Publish in this order:

1. Publish `@orkestrel/sqlite@0.0.2` and `@orkestrel/indexeddb@0.0.2` — they
   are independent of each other (either order; both depend only on the
   already-published `@orkestrel/contract`).
2. In this repo, run `npm install` to re-resolve `package-lock.json` against
   the newly published wrappers and commit the refreshed lockfile.
3. Run the `prepublishOnly` gates and publish `@orkestrel/database@0.0.2`.

Until step 1 happens, a fresh `npm ci` in this repo fails to resolve
`^0.0.2` — deliberately. The exact pin makes it impossible to install or
publish this package against the older `0.0.1` wrappers, which lack driver
fixes this package's behavior relies on (the SQLite wrapper's mid-stream
`iterate` fault mapping, the IndexedDB wrapper's abnormal-close recovery and
`READONLY` fault code) and whose surfaces the mirrored guides here no longer
describe. The same discipline applies to every future wrapper release: bump
the pinned range, re-mirror the wrapper guides, and republish this package
deliberately — wrapper changes never flow in silently.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
