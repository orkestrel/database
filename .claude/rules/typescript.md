---
paths:
  - '**/*.{ts,tsx,mts,cts,vue}'
---

# TypeScript rules

The non-negotiables and design laws in `AGENTS.md` apply without exception and are not restated here. This file adds only what TypeScript itself decides.

## Syntax and imports

- Tabs for indentation.
- No semicolons unless ASI requires one.
- Single quotes.
- Named exports only, except framework-required defaults.
- ESM imports use explicit `.js` extensions for local TypeScript modules.
- Place `import type` declarations before value imports.
- Do not place blank lines between consecutive imports of the same kind.
- Narrow an accepted `unknown` with a total guard rather than a conditional access.

## Types

- Put every reusable or public interface/type alias in the nearest authoritative `*/types.ts`.
- Public collection properties and return types use `readonly T[]`, `ReadonlyMap<K, V>`, or `ReadonlySet<T>`.
- Optional state is `T | undefined`; an optional lookup failure returns `undefined`.

## Immutability

- Never mutate caller-owned inputs.
- Use copy-on-write for internal state.
- Return copies or readonly views; never leak a mutable internal reference.
- Compute derived facts instead of persisting duplicate state.

## Errors and outcomes

| Condition                            | Required strategy                           |
| ------------------------------------ | ------------------------------------------- |
| Programmer error or invalid argument | Throw an `AppError`                         |
| I/O/network/external operation       | Return `Result<T, E>` or throw consistently |
| Optional missing lookup              | Return `undefined`                          |
| Invalid input inside a guard         | Return `false`; never throw                 |

Use the existing outcome contract from a declared dependency or the owning environment; do not redeclare it at each call site. When no such contract exists and adding a dependency is not authorized, define this once in the owning `types.ts`:

```ts
interface Success<T> {
	readonly success: true
	readonly value: T
}

interface Failure<E> {
	readonly success: false
	readonly error: E
}

type Result<T, E = Error> = Success<T> | Failure<E>
```

- When `@orkestrel/contract` is declared, inspect and use its exact installed `Result`, construction/narrowing helpers, and `attempt` behavior instead of duplicating them.
- Otherwise construct and narrow through the owning environment's centralized helpers.
- Error classes expose a machine-readable `code` and optional `context`.
- Every public error class ships with a guard such as `isAppError` for safe `catch` narrowing.

## Comments and API documentation

- Comments explain why, never restate what self-explanatory code does. The Writing rules in `AGENTS.md` govern their prose.
- Every public export has complete TSDoc: description, `@param`, `@returns`, and `@example` where applicable.
- Document an options object as one `@param`; describe its short fields under `@remarks`.
- Private methods and overload-specific notes use single-line `//` comments, not public TSDoc.
- Do not document speculative future product behavior unless requested.
- Never use `@internal` to hide a method; make it `#` private.
