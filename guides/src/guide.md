# Guide

> A zero-dependency guides-parity toolkit: `Guide` extracts a markdown guide's documented
> surface, method groups, links, and test links; `Source` reflects the same shapes from a
> consumer-supplied file inventory via pure text scanners (no filesystem, no TypeScript
> compiler API); a small set of pure comparison helpers (`missingSymbols`, `findMissing`,
> `resolveLink`, …) reduce every guides-parity check to `expect([]).toEqual([])`
> (AGENTS §22). Source: [`src/core`](../../src/core). Surfaced through the `@src/core` barrel.

The doctrine: a guide is a contract, not prose. `createGuide(markdown)` parses a guide's
source once (via `@orkestrel/markdown`) into a `GuideInterface` — its `## Surface` identifiers
(kind-tagged), its `## Methods` interface/method groups, every link, and its `## Tests`
links, each cached at construction. `createSource({ files, module })` builds a
`SourceInterface` that reflects the SAME two shapes — exported symbols and interface/class
methods — by scanning a consumer-gathered file inventory with plain-text line scanners
(`exportsFrom`, `declarationBody` + `memberMethods`), never touching disk itself. A
guides-parity test then asserts these two views agree in both directions: nothing documented
is phantom, nothing exported is undocumented. `parseManifest` reads a `guides/README.md`'s
`## By concept` table into the list of `{ concept, spec, source, tests }` entries a suite
iterates to run this check once per documented concept.

## Surface

### Types

The manifest/extraction shapes every check is built from, from [`types.ts`](../../src/core/types.ts).

| Name              | Kind      | Shape                                                                                                                                             |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExportKind`      | type      | `'type' \| 'interface' \| 'const' \| 'function' \| 'class'` — the declaration kind half of a symbol's bijection key.                              |
| `SurfaceSymbol`   | interface | `{ name, kind }` — one documented / exported symbol.                                                                                              |
| `GuideModule`     | type      | `string \| readonly string[]` — one source directory, or several for a layer guide spanning multiple directories.                                 |
| `ManifestEntry`   | interface | `{ concept, spec, source, tests }` — one `## By concept` manifest row, paths normalized to workspace root.                                        |
| `MethodGroup`     | interface | `{ interface, methods }` — one `#### \`Interface\`` block's documented method names, in table order.                                              |
| `GuideInterface`  | interface | `{ sections, surface, methods, links, tests, patterns }` — the structured, pure view over one parsed guide. See [`## Methods`](#methods).         |
| `SourceInterface` | interface | `{ exports, methods, exists, hidden, examples }` — the reflected source truth a guide's surface is checked against. See [`## Methods`](#methods). |
| `SourceOptions`   | interface | `{ files, module }` — the construction input for a `Source`: a consumer-supplied file inventory plus the module scope to reflect.                 |
| `DeclarationHead` | interface | `{ text, end }` — a declaration head joined into one line (across an oxfmt-wrapped signature) plus the index of the line ending in `{`.           |

### Constants

The section-heading keys and external-link schemes every extractor and link check is keyed
on, from [`constants.ts`](../../src/core/constants.ts).

| Name               | Kind  | Behavior                                                                                                                        |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `SURFACE`          | const | `'Surface'` — the `## Surface` heading text.                                                                                    |
| `METHODS`          | const | `'Methods'` — the `## Methods` heading text.                                                                                    |
| `TESTS`            | const | `'Tests'` — the `## Tests` heading text.                                                                                        |
| `MANIFEST`         | const | `'By concept'` — the `## By concept` manifest heading text.                                                                     |
| `EXTERNAL_SCHEMES` | const | `readonly string[]` — `['http:', 'https:', 'mailto:', 'tel:']`; a link with one of these prefixes is never filesystem-resolved. |

### Helpers

Pure, total leaves from [`helpers.ts`](../../src/core/helpers.ts) — the building blocks
`parsers.ts`'s extractors and a consumer's parity test both reach for directly.

| Name             | Kind     | Signature                                                                                                 | Behavior                                                                                                                                                          |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moduleDirs`     | function | `(module: GuideModule) => readonly string[]`                                                              | Normalizes a `GuideModule` scope to its directory list — a single string becomes a one-element list.                                                              |
| `moduleKeys`     | function | `(files: Readonly<Record<string, string>>, module: GuideModule) => readonly string[]`                     | The file inventory's keys belonging to a `GuideModule` scope: `.ts` files under a scope directory, excluding that directory's `index.ts` and `*.test.ts`; sorted. |
| `symbolKey`      | function | `(symbol: SurfaceSymbol) => string`                                                                       | The bijection key for a surface symbol — `${kind} ${name}` — so a symbol comparison diffs (name, kind) pairs, not names alone.                                    |
| `findMissing`    | function | `(names: readonly string[], source: readonly string[]) => readonly string[]`                              | The names present in `names` but absent from `source` — the set-difference behind a both-directions bijection assertion.                                          |
| `missingSymbols` | function | `(symbols: readonly SurfaceSymbol[], source: readonly SurfaceSymbol[]) => readonly string[]`              | The `symbolKey` set-difference between two symbol lists.                                                                                                          |
| `isExternalLink` | function | `(href: string) => boolean`                                                                               | Whether a link `href` should be skipped by guides-parity link checks — an external scheme (`EXTERNAL_SCHEMES`) or a bare `#` anchor.                              |
| `resolveLink`    | function | `(from: string, target: string) => string`                                                                | Resolves a relative link `target` against `from` and normalizes the result, purely (no `node:path`).                                                              |
| `firstCode`      | function | `(nodes: readonly InlineNode[]) => string \| undefined`                                                   | The first code-span value found by descending an inline node list, following into `emphasis` / `link` children.                                                   |
| `identifierOf`   | function | `(code: string) => string`                                                                                | The identifier prefix of a code-span text — everything before its first `<`, trimmed (strips generic-parameter annotation).                                       |
| `kindIndex`      | function | `(table: TableNode) => number \| undefined`                                                               | The index of a table's `Kind` column, found by its header text so it survives column reordering.                                                                  |
| `cellLinks`      | function | `(cell: readonly InlineNode[]) => readonly string[]`                                                      | The link hrefs found within one table cell's inline content, in walk order.                                                                                       |
| `findUnexampled` | function | `(names: readonly string[], fences: readonly string[], examples: readonly string[]) => readonly string[]` | The names with no fence mention (word boundary) and no `@example` membership — the EX check's core comparison.                                                    |
| `fenceImports`   | function | `(fence: string) => readonly { specifier: string, names: readonly string[] }[]`                           | Parses a fence's `import` statements into per-specifier imported identifier names — the FI check's core comparison.                                               |

### Parsers

The guide/manifest extraction pipeline, from [`parsers.ts`](../../src/core/parsers.ts) —
the orchestration `Guide` composes out of `helpers.ts`'s leaves.

| Name              | Kind     | Signature                                                                              | Behavior                                                                                                                                                 |
| ----------------- | -------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportsFrom`     | function | `(source: string) => readonly SurfaceSymbol[]`                                         | The module-scope exports declared in one file's source text, deduped by (kind, name); a generator export scans as `function`.                            |
| `hiddenFrom`      | function | `(source: string) => readonly SurfaceSymbol[]`                                         | The module-scope declarations LACKING the `export` keyword — the export-discipline (AGENTS §5) mirror of `exportsFrom`, same five-kind grammar.          |
| `joinHead`        | function | `(lines: readonly string[], start: number) => DeclarationHead \| undefined`            | Joins a declaration head starting at `start` into one space-separated line, consuming lines until the first ending in `{`.                               |
| `declarationBody` | function | `(source: string, keyword: 'class' \| 'interface', name: string) => readonly string[]` | The body lines of the named `export class` / `export interface` declaration in one file's source text.                                                   |
| `memberMethods`   | function | `(lines: readonly string[]) => readonly string[]`                                      | The declared callable-member names in a declaration body — plain / `async` / generator / optional; getters, setters, `static`, `#` privates never count. |
| `sectionBlocks`   | function | `(document: MarkdownDocument, heading: string) => readonly BlockNode[]`                | The block nodes under a named `##` heading, up to the next `##`-or-higher heading (or the document's end).                                               |
| `extractSurface`  | function | `(document: MarkdownDocument) => readonly SurfaceSymbol[]`                             | Every `## Surface` identifier: each table's rows union every backticked H3 entity heading, deduped by `symbolKey`.                                       |
| `extractMethods`  | function | `(document: MarkdownDocument) => readonly MethodGroup[]`                               | One `MethodGroup` per documented behavioral interface in `## Methods` — an H4 code span sets the interface, the following table lists its methods.       |
| `extractLinks`    | function | `(document: MarkdownDocument) => readonly string[]`                                    | Every link href in the guide document, including table cells — a full, depth-first AST walk.                                                             |
| `extractTests`    | function | `(document: MarkdownDocument) => readonly string[]`                                    | The relative test links declared under `## Tests`.                                                                                                       |
| `examplesFrom`    | function | `(source: string) => readonly string[]`                                                | The exported functions in one file's source text whose immediately preceding JSDoc block carries `@example`.                                             |
| `exampleMethods`  | function | `(lines: readonly string[]) => readonly string[]`                                      | The `exampleMethods`-flavored `memberMethods` — callable-member names in a declaration body whose preceding JSDoc carries `@example`.                    |
| `extractPatterns` | function | `(document: MarkdownDocument) => readonly string[]`                                    | Every fenced `ts` code block's body text anywhere in the guide document — a full AST walk.                                                               |
| `parseManifest`   | function | `(markdown: string, base: string) => readonly ManifestEntry[]`                         | Parses a `## By concept` manifest table into `ManifestEntry` rows, resolving Spec / Source / Tests links against `base`.                                 |

### Shapers

Declarative `ContractShape` values (from `@orkestrel/contract`) from
[`shapers.ts`](../../src/core/shapers.ts) — every documented data type here is
non-recursive, so each shapes directly.

| Name                 | Kind  | Builds                                                                              |
| -------------------- | ----- | ----------------------------------------------------------------------------------- |
| `surfaceSymbolShape` | const | The shape of a `SurfaceSymbol` — `{ name: string, kind: ExportKind }`.              |
| `methodGroupShape`   | const | The shape of a `MethodGroup` — `{ interface: string, methods: readonly string[] }`. |
| `manifestEntryShape` | const | The shape of a `ManifestEntry` — `source` accepting a single directory or several.  |

### Validators

Total from-unknown guards composed from `@orkestrel/contract` combinators, from
[`validators.ts`](../../src/core/validators.ts).

| Name              | Kind  | Narrows to / Tests | Behavior                                                                 |
| ----------------- | ----- | ------------------ | ------------------------------------------------------------------------ |
| `isExportKind`    | const | `value: unknown`   | `true` when `value` is one of the five documented `ExportKind` literals. |
| `isSurfaceSymbol` | const | `value: unknown`   | `true` when `value` is a well-formed `SurfaceSymbol`.                    |
| `isMethodGroup`   | const | `value: unknown`   | `true` when `value` is a well-formed `MethodGroup`.                      |
| `isManifestEntry` | const | `value: unknown`   | `true` when `value` is a well-formed `ManifestEntry`.                    |

### Factories

From [`factories.ts`](../../src/core/factories.ts).

| Name                          | Kind     | Signature                                     | Behavior                                                                         |
| ----------------------------- | -------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `createGuide`                 | function | `(source: string) => GuideInterface`          | Creates a structured `GuideInterface` view over one guide's markdown source.     |
| `createSource`                | function | `(options: SourceOptions) => SourceInterface` | Creates a pure `SourceInterface` over a consumer-supplied file inventory.        |
| `createSurfaceSymbolContract` | function | `() => ContractInterface<SurfaceSymbol>`      | Compiles `surfaceSymbolShape` into a guard / parser / schema / generator bundle. |
| `createMethodGroupContract`   | function | `() => ContractInterface<MethodGroup>`        | Compiles `methodGroupShape` into a guard / parser / schema / generator bundle.   |
| `createManifestEntryContract` | function | `() => ContractInterface<ManifestEntry>`      | Compiles `manifestEntryShape` into a guard / parser / schema / generator bundle. |

### `Guide`

The implementing class of `GuideInterface`, from [`Guide.ts`](../../src/core/Guide.ts). A
stateful, structured view over one parsed guide: parses `source` once via
`@orkestrel/markdown` and never touches the filesystem — `Guide` has no notion of "where"
the guide came from, only its markdown text. Every accessor returns the same cached,
readonly array on every call. See [`## Methods`](#methods) for its public call-signature
surface.

### `Source`

The implementing class of `SourceInterface`, from [`Source.ts`](../../src/core/Source.ts). A
pure reflection over a consumer-supplied file inventory (root-relative path → file text) plus
a module scope — reflects exported symbols (`exportsFrom`) and interface/class methods
(`declarationBody` + `memberMethods`) with text-only line scanners, never the TypeScript
compiler API or the filesystem. `exports()` is computed once on first access and cached; the
consumer gathers `files` however their environment allows (`node:fs` in a Node script,
`import.meta.glob` in a browser/vitest run). See [`## Methods`](#methods) for its public
call-signature surface.

## Methods

The public methods of each behavioral interface — one table per type, keyed by its
backticked name (AGENTS §22).

#### `GuideInterface`

| Method     | Returns                    | Behavior                                                                                    |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `sections` | `readonly string[]`        | The `##` heading names, in document order — the non-vacuousness guard for section presence. |
| `surface`  | `readonly SurfaceSymbol[]` | Every `## Surface` identifier + kind — table rows union backticked entity headings.         |
| `methods`  | `readonly MethodGroup[]`   | One `MethodGroup` per documented behavioral interface in `## Methods`.                      |
| `links`    | `readonly string[]`        | Every link href in the guide, including table cells.                                        |
| `tests`    | `readonly string[]`        | The relative test links declared under `## Tests`.                                          |
| `patterns` | `readonly string[]`        | Every fenced `ts` code block's body text, whole document.                                   |

#### `SourceInterface`

| Method     | Returns                    | Behavior                                                                                                   |
| ---------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `exports`  | `readonly SurfaceSymbol[]` | Every module-scope export, including type-only, by (name, kind).                                           |
| `methods`  | `readonly string[]`        | The call-signature members of the `class` / `interface` named `name`.                                      |
| `exists`   | `boolean`                  | Whether a workspace-root-relative path exists in the inventory.                                            |
| `hidden`   | `readonly SurfaceSymbol[]` | Every module-scope declaration LACKING `export` (AGENTS §5).                                               |
| `examples` | `readonly string[]`        | The exported functions (or, given `name`, the members of `name`) whose preceding JSDoc carries `@example`. |

## The extraction model

`Guide` parses a guide's markdown once (via `@orkestrel/markdown`'s `createMarkdown`) and
caches five projections at construction — `sections`, `surface`, `methods`, `links`, `tests`
— so every accessor is a cheap array return, not a re-parse. `extractSurface` scopes to the
`## Surface` section (`sectionBlocks`) and unions two sources of identifiers: every table's
column-0 code span (kind read from the column whose header text is `Kind`, located
positionally so it survives reordering) and every backticked H3 entity heading (a class
documented outside a table, kind fixed to `'class'`). `extractMethods` scopes to
`## Methods`: an H4 whose first code span sets the current interface name, and the very next
table becomes that interface's `MethodGroup`. Both extractors normalize every identifier
through `identifierOf`, stripping a generic-parameter annotation (`` `WidgetInterface<T>` ``
→ `WidgetInterface`) so the bijection key is always the bare name. `extractLinks` walks the
whole AST for every `link` node (table cells included); `extractTests` does the same walk
scoped to the `## Tests` section only.

`Source` never parses markdown or touches disk — it scans a consumer-supplied file
inventory's TEXT with regex-based line scanners. `exportsFrom` matches
`^export (?:async )?(function\*?|class|const|interface|type) (\w+)` per line, deduped by
(kind, name). `declarationBody` locates a named `export class` / `export interface` head
(joining an oxfmt-wrapped signature via `joinHead` until a line ends in `{`), then collects
body lines to the column-0 `}`. `memberMethods` matches
`^\t(?:async )?\*?(\w+)(<[^>]*>)?\??\(` against those body lines — plain / `async` /
generator / optional methods count; getters, setters, `static` members, and `#` privates
never match (their keyword or sigil breaks the `name(` shape), and `constructor` is filtered
out of `Source.methods`. `moduleKeys` scopes the inventory to one `GuideModule`'s `.ts`
files, excluding each scope directory's own `index.ts` and any `*.test.ts` file. `hiddenFrom`
runs the mirror-image scan — the same five-kind grammar, but only lines LACKING the `export`
keyword — so `Source.hidden()` mechanically asserts AGENTS §5's export-discipline rule and
catches a hidden declaration the surface bijection alone would never see (it never appears as
an export, so it never shows up as a missing Surface row either).

## The check catalog

Every guides-parity check reduces to `expect([]).toEqual([])`, paired with a non-vacuousness
guard so a renamed heading fails loudly instead of passing on an empty extraction:

- **SB — Surface bijection (kind folded in).** `guide.surface()` vs `source.exports()`,
  `missingSymbols` both directions over `symbolKey` — a symbol may drift in neither name nor
  kind. Guard: `guide.surface().length > 0`.
- **MB — Methods bijection + class-no-extra.** Per `MethodGroup`, its `methods` vs
  `source.methods(group.interface)`, `findMissing` both directions; then, by the
  `XInterface → X` naming convention, `findMissing(source.methods('X'), group.methods)` must
  also be empty — the implementing class exposes no undocumented public method. Guard:
  `group.methods.length > 0`.
- **LI — Link integrity.** `guide.links()`, dropping `isExternalLink` hrefs, `resolveLink`
  the rest against the guide's own path, keep those failing `source.exists`.
- **TE — Tests-link existence.** `guide.tests()`, `resolveLink` + `source.exists`, keep the
  missing.
- **NV — Non-vacuousness.** `parseManifest` yields at least one entry; each guide's
  `surface()` and every `MethodGroup` is non-empty — the guard behind every other check.
- **EX — Examples presence.** A documented symbol "has an example" when its bare name
  appears (word boundary) in any of `guide.patterns()`'s fence bodies, OR its source
  JSDoc carries an `@example` block (`source.examples()` / `source.examples(name)`).
  Applies to every `function`-kind `Surface` symbol and every `MethodGroup` member.
  Presence-only — fence and JSDoc CONTENT are never checked. `findUnexampled` is the
  comparison. Guard: the SB/MB extractions this check reuses already prove non-vacuous.
- **FI — Fence-import reality.** Every `import { ... } from 'specifier'` in a
  `guide.patterns()` fence, for a SELF specifier (this repo's own package name / path
  alias), imports only names that exist in `source.exports()`. `fenceImports` parses the
  statement; `findMissing` diffs the imported names against `source.exports()`'s names.

## The pure file-inventory model

Neither `Guide` nor `Source` ever imports `node:fs` or any other I/O primitive — `Source`'s
construction input (`SourceOptions.files`) is a plain `Readonly<Record<string, string>>` the
CONSUMER gathers however their runtime allows: a recursive `node:fs` walk in a Node vitest
run, `import.meta.glob('/**/*.ts', { eager: true, query: '?raw', import: 'default' })` in a
browser/vitest run, or a static bundle in any other environment. This keeps the package
itself environment-agnostic while every check still runs against real, on-disk truth in the
consumer's own test.

## Patterns

### Construct a `Guide` from markdown text

```ts
import { createGuide } from '@orkestrel/guide'

const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `X` | class |')
guide.surface() // [{ name: 'X', kind: 'class' }]
guide.sections() // ['Surface']
```

### Construct a `Source` from an inline files record

```ts
import { createSource } from '@orkestrel/guide'

const source = createSource({
	files: {
		'src/core/Guide.ts': 'export class Guide {}\n',
		'src/core/types.ts': 'export interface GuideInterface {\n\tsections(): void\n}\n',
	},
	module: 'src/core',
})
source.exports() // [{ name: 'Guide', kind: 'class' }, { name: 'GuideInterface', kind: 'interface' }]
source.methods('GuideInterface') // ['sections']
source.exists('src/core/Guide.ts') // true
```

### The bijection assertion shape

```ts
import { createGuide, createSource, missingSymbols } from '@orkestrel/guide'

const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `Guide` | class |')
const source = createSource({
	files: { 'src/core/Guide.ts': 'export class Guide {}\n' },
	module: 'src/core',
})

// Every check collapses to an empty-array assertion, both directions.
missingSymbols(source.exports(), guide.surface()) // [] — every export is documented
missingSymbols(guide.surface(), source.exports()) // [] — every documented symbol is real
```

## Tests

- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — `moduleDirs` / `moduleKeys` / `symbolKey` / `findMissing` / `missingSymbols` / `isExternalLink` / `resolveLink` / `firstCode` / `identifierOf` / `kindIndex`.
- [`tests/src/core/parsers.test.ts`](../../tests/src/core/parsers.test.ts) — `exportsFrom` / `joinHead` / `declarationBody` / `memberMethods` / `sectionBlocks` / `extractSurface` / `extractMethods` / `extractLinks` / `extractTests` / `parseManifest`, incl. entity-heading surface and multi-dir Source cells.
- [`tests/src/core/validators.test.ts`](../../tests/src/core/validators.test.ts) — `isExportKind` / `isSurfaceSymbol` / `isMethodGroup` / `isManifestEntry`.
- [`tests/src/core/shapers.test.ts`](../../tests/src/core/shapers.test.ts) — per-shape guard exactness, JSON Schema essentials, seeded generate round-trips, parse rebuilds.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createGuide` / `createSource` + the compiled symbol/group/manifest contracts.
- [`tests/src/core/Guide.test.ts`](../../tests/src/core/Guide.test.ts) — `Guide`'s five cached projections, constructed once, called repeatedly.
- [`tests/src/core/Source.test.ts`](../../tests/src/core/Source.test.ts) — `Source`'s pure reflection against an in-memory fixture inventory, incl. `memberMethods` on every excluded shape (getters, setters, `static`, `#` privates, `constructor`).
- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the drop-in guides-parity suite, run against THIS repo's own `guides/README.md` manifest — the self-dogfooding acceptance criterion.

## See also

- `AGENTS.md` (workspace root) — the rules; §22 documentation-as-contracts.
- `PROPOSAL.md` (workspace root) — the design proposal this package implements; §5 the check catalog, §6 the drop-in, §7 source-scanning fidelity.
- [`README.md`](../README.md) — the guides index.
- [`markdown.md`](markdown.md) — the dependency mirror for `@orkestrel/markdown`, the AST/parse layer `Guide` and `Source` are built on.
</content>
