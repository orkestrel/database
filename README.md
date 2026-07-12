# @orkestrel/router

A typed request router for the `@orkestrel` line — the first `@orkestrel`
package to ship both server and browser environments alongside its shared
core. Built to sit beside `@orkestrel/contract` (validation) and
`@orkestrel/emitter` (observable lifecycle), reusing both as it takes shape.

## Install

```sh
npm install @orkestrel/router
```

## Requirements

- Node.js >= 24
- ESM-only (no CommonJS build)
- Server and browser environments both supported

## Status

The public API is under design and not yet implemented — this package
currently ships no runtime code. This README will gain an install snippet,
usage examples, and a guide link once the design lands.

## Package

Published as three environment-scoped entry points per the `exports` field in
`package.json`: a shared core, `./browser`, and `./server`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
