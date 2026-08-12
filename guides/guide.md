# Guide

> A pure, I/O-free guides-parity toolkit: `Guide` extracts a markdown guide's documented
> surface, method groups, links, and test links; `Source` reflects direct declarations and
> conventional barrel reachability from a consumer-supplied file inventory via pure text
> scanners (no filesystem or TypeScript compiler API); runtime dependencies provide markdown
> and contract primitives, while comparison helpers (`missingSymbols`, `findMissing`,
> `resolveLink`, …) reduce every guides-parity check to `expect([]).toEqual([])`
> (AGENTS §22). Source: [`src/core`](../../src/core). Published through `@orkestrel/guide`.

The doctrine: a guide is a contract, not prose. `createGuide(markdown)` parses a guide's
source once (via `@orkestrel/markdown`) into a `GuideInterface` — its `## Surface` identifiers
(kind-tagged), its `## Methods` interface/method groups, every link, and its `## Tests`
links, each cached at construction. `createSource({ files, module })` builds a
`SourceInterface` that reflects intentional direct declarations, conventional barrel-reachable
declarations, and interface/class methods by scanning a consumer-gathered file inventory with
plain-text line scanners, never touching disk itself. A guides-parity test asserts direct
declarations equal the barrel surface and the barrel surface equals the documented surface,
in both directions. `parseManifest` reads a `guides/README.md`'s
`## By concept` table into the list of `{ concept, spec, source, tests }` entries a suite
iterates to run this check once per documented concept.

## Surface

### Types

The manifest/extraction shapes every check is built from, from [`types.ts`](../../src/core/types.ts).

| Name              | Kind      | Shape                                                                                                                                                                                               |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExportKind`      | type      | `'type' \| 'interface' \| 'const' \| 'function' \| 'class'` — the five-kind reflection population. Comment/template payload and enums are outside it; general package policy does not forbid enums. |
| `SurfaceSymbol`   | interface | `{ name, kind }` — one documented / exported symbol.                                                                                                                                                |
| `GuideModule`     | type      | `string \| readonly string[]` — one source directory, or several; `'.'` is the canonical workspace root.                                                                                            |
| `SourceLine`      | interface | `{ source, code, jsdoc }` — one terminator-free physical source line with exact raw text, equal-length projections, and every genuine JSDoc span at its physical column or `undefined`.             |
| `ManifestEntry`   | interface | `{ concept, spec, source, tests }` — one `## By concept` manifest row, paths normalized to workspace root.                                                                                          |
| `MethodGroup`     | interface | `{ interface, methods }` — one `#### \`Interface\`` block's documented method names, in table order.                                                                                                |
| `GuideInterface`  | interface | `{ sections, surface, methods, links, tests, patterns }` — the structured, pure view over one parsed guide. See [`## Methods`](#methods).                                                           |
| `SourceInterface` | interface | `{ exports, surface, methods, exists, hidden, examples }` — direct declarations, conventional barrel reachability, members, paths, discipline, and examples. See [`## Methods`](#methods).          |
| `SourceOptions`   | interface | `{ files, module }` — exact canonical-segment opaque workspace-relative inventory keys plus the canonicalized module scope to reflect.                                                              |
| `DeclarationHead` | interface | `{ text, end }` — a declaration head joined into one line (across an oxfmt-wrapped signature) plus the index of the line ending in `{`.                                                             |

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

| Name                   | Kind     | Signature                                                                                                 | Behavior                                                                                                                                 |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeDirectories` | function | `(module: GuideModule) => readonly string[]`                                                              | Canonicalizes through `resolvePath`, uses `'.'` for root, and removes duplicates in first-seen order.                                    |
| `selectModuleKeys`     | function | `(files: Readonly<Record<string, string>>, module: GuideModule) => readonly string[]`                     | Selects exact canonical-segment opaque `.ts` keys under any scope and excludes every selected exact `index.ts` plus `*.test.ts`; sorted. |
| `hasCanonicalSegments` | function | `(key: string) => boolean`                                                                                | Rejects empty, `.` and `..` slash-separated segments without normalization while retaining ordinary dotfiles.                            |
| `symbolKey`            | function | `(symbol: SurfaceSymbol) => string`                                                                       | The bijection key for a surface symbol — `${kind} ${name}` — so a symbol comparison diffs (name, kind) pairs, not names alone.           |
| `findMissing`          | function | `(names: readonly string[], source: readonly string[]) => readonly string[]`                              | The names present in `names` but absent from `source` — the set-difference behind a both-directions bijection assertion.                 |
| `missingSymbols`       | function | `(symbols: readonly SurfaceSymbol[], source: readonly SurfaceSymbol[]) => readonly string[]`              | The `symbolKey` set-difference between two symbol lists.                                                                                 |
| `extractSourceLines`   | function | `(source: string) => readonly SourceLine[]`                                                               | Equal-length physical source, code, and JSDoc projection with bounded literal Unicode identifier slash state.                            |
| `isExternalLink`       | function | `(href: string) => boolean`                                                                               | Whether a link `href` should be skipped by guides-parity link checks — an external scheme (`EXTERNAL_SCHEMES`) or a bare `#` anchor.     |
| `resolveLink`          | function | `(file: string, target: string) => string`                                                                | Derives a declaring file's directory, including workspace-root files, then delegates to `resolvePath`.                                   |
| `resolvePath`          | function | `(directory: string, target: string) => string`                                                           | Sole dot-segment reducer; returns `'.'` when no segment remains and preserves every excess leading parent.                               |
| `firstCode`            | function | `(nodes: readonly InlineNode[]) => string \| undefined`                                                   | The first code-span value found by descending an inline node list, following into `emphasis` / `link` children.                          |
| `identifierOf`         | function | `(code: string) => string`                                                                                | The identifier prefix of a code-span text — everything before its first `<`, trimmed (strips generic-parameter annotation).              |
| `kindIndex`            | function | `(table: TableNode) => number \| undefined`                                                               | The index of a table's `Kind` column, found by its header text so it survives column reordering.                                         |
| `cellLinks`            | function | `(cell: readonly InlineNode[]) => readonly string[]`                                                      | The link hrefs found within one table cell's inline content, in walk order.                                                              |
| `findUnexampled`       | function | `(names: readonly string[], fences: readonly string[], examples: readonly string[]) => readonly string[]` | The names with no fence mention (word boundary) and no `@example` membership — the EX check's core comparison.                           |
| `fenceImports`         | function | `(fence: string) => readonly { specifier: string, names: readonly string[] }[]`                           | Parses a fence's `import` statements into per-specifier imported identifier names — the FI check's core comparison.                      |

### Parsers

The guide/manifest extraction pipeline, from [`parsers.ts`](../../src/core/parsers.ts) —
the orchestration `Guide` composes out of `helpers.ts`'s leaves.

| Name                  | Kind     | Signature                                                                              | Behavior                                                                                                                                           |
| --------------------- | -------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportsFrom`         | function | `(source: string) => readonly SurfaceSymbol[]`                                         | Direct five-kind exports over projected lines with an uninterrupted column-zero head; projection never widens membership.                          |
| `hiddenFrom`          | function | `(source: string) => readonly SurfaceSymbol[]`                                         | The non-exported mirror with the same projected, uninterrupted column-zero head and five-kind population.                                          |
| `joinHead`            | function | `(lines: readonly string[], start: number) => DeclarationHead \| undefined`            | Joins a declaration head starting at `start` into one space-separated line, consuming lines until the first ending in `{`.                         |
| `declarationBody`     | function | `(source: string, keyword: 'class' \| 'interface', name: string) => readonly string[]` | Selects a real head/close from projected lines and returns the aligned raw body for JSDoc evidence.                                                |
| `memberMethods`       | function | `(lines: readonly string[]) => readonly string[]`                                      | Matches callable members on one projection of the body; commented candidates, getters, setters, `static`, and `#` privates never count.            |
| `sectionBlocks`       | function | `(document: MarkdownDocument, heading: string) => readonly BlockNode[]`                | The block nodes under a named `##` heading, up to the next `##`-or-higher heading (or the document's end).                                         |
| `extractSurface`      | function | `(document: MarkdownDocument) => readonly SurfaceSymbol[]`                             | Every `## Surface` identifier: each table's rows union every backticked H3 entity heading, deduped by `symbolKey`.                                 |
| `extractMethods`      | function | `(document: MarkdownDocument) => readonly MethodGroup[]`                               | One `MethodGroup` per documented behavioral interface in `## Methods` — an H4 code span sets the interface, the following table lists its methods. |
| `extractLinks`        | function | `(document: MarkdownDocument) => readonly string[]`                                    | Every link href in the guide document, including table cells — a full, depth-first AST walk.                                                       |
| `extractTests`        | function | `(document: MarkdownDocument) => readonly string[]`                                    | The relative test links declared under `## Tests`.                                                                                                 |
| `extractExampleLines` | function | `(lines: readonly SourceLine[]) => readonly SourceLine[]`                              | The next physical candidate after the authoritative exact `@example` span in a leading chain.                                                      |
| `examplesFrom`        | function | `(source: string) => readonly string[]`                                                | Matches exported functions against shared eligible genuine JSDoc adjacency and aligned code.                                                       |
| `exampleMethods`      | function | `(lines: readonly string[]) => readonly string[]`                                      | Matches callable members against the same shared eligible genuine JSDoc adjacency and aligned code.                                                |
| `extractPatterns`     | function | `(document: MarkdownDocument) => readonly string[]`                                    | Every fenced `ts` code block's body text anywhere in the guide document — a full AST walk.                                                         |
| `parseManifest`       | function | `(markdown: string, directory: string) => readonly ManifestEntry[]`                    | Resolves manifest links and canonicalizes Source values through `normalizeDirectories`, preserving one-versus-many shape.                          |

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
pure reflection over a consumer-supplied file inventory (root-relative path → file text) plus a
module scope. `exports()` inventories direct `type`, `interface`, `const`, `function`, and
`class` declarations in the selected canonical directories' exact opaque module keys over
comment/template-excluded projected code lines; `enum` is outside this reflection population without being forbidden by
general package policy;
`surface()` inventories declarations reachable through each selected directory's conventional
root barrel. Both projections are computed on first access, cached, deduplicated by name and
kind, and sorted by name. Member structure comes from projected lines while raw bodies preserve
JSDoc evidence. `Source` never uses the
TypeScript compiler API or filesystem; the consumer gathers `files` however its environment
allows. See [`## Methods`](#methods) for the public call-signature surface.

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

| Method     | Returns                    | Behavior                                                                                                                               |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `exports`  | `readonly SurfaceSymbol[]` | Direct `type`, `interface`, `const`, `function`, and `class` declarations in the selected module keys.                                 |
| `surface`  | `readonly SurfaceSymbol[]` | Every declaration reachable through the selected directories' conventional root `index.ts` barrels.                                    |
| `methods`  | `readonly string[]`        | The call-signature members of the `class` / `interface` named `name`.                                                                  |
| `exists`   | `boolean`                  | Whether a workspace-root-relative path exists in the inventory.                                                                        |
| `hidden`   | `readonly SurfaceSymbol[]` | Every module-scope declaration LACKING `export` (AGENTS §5).                                                                           |
| `examples` | `readonly string[]`        | The exported functions (or, given `name`, members) whose eligible leading JSDoc chain ends in an exact block-position `@example` span. |

## The extraction model

`Guide` parses a guide's markdown once (via `@orkestrel/markdown`'s `createMarkdown`) and
caches six projections at construction — `sections`, `surface`, `methods`, `links`, `tests`,
`patterns` — so every accessor is a cheap array return, not a re-parse. `extractSurface` scopes to the
`## Surface` section (`sectionBlocks`) and unions two sources of identifiers: every table's
column-0 code span (kind read from the column whose header text is `Kind`, located
positionally so it survives reordering) and every backticked H3 entity heading (a class
documented outside a table, kind fixed to `'class'`). `extractMethods` scopes to
`## Methods`: an H4 whose first code span sets the current interface name, and the very next
table becomes that interface's `MethodGroup`. Both extractors normalize every identifier
through `identifierOf`, stripping a generic-parameter annotation (`` `WidgetInterface<T>` ``
→ `WidgetInterface`) so the bijection key is always the bare name. `extractLinks` walks the
whole AST for every `link` node (table cells included); `extractTests` does the same walk
scoped to the `## Tests` section only; and `extractPatterns` walks the whole AST for every
fenced `ts` code block.

`parseManifest(markdown, directory)` resolves every Spec, Source, and Tests link through
`resolvePath(directory, target)`, so root, nested, and dotted directory names are ordinary path
components. Source links then canonicalize through `normalizeDirectories`: `'.'` is workspace root and
duplicates collapse in first-seen order. `resolvePath` owns the only forward-slash dot-segment reducer, returns `'.'` when all components cancel, and retains every
excess leading parent. `resolveLink(file, target)` adds the declaring-file boundary: it derives
the directory before the final slash, treats a slashless file as workspace-root, and delegates.
Neither helper consults the filesystem, infers extensions, or guesses whether a dotted component
is a file.

`Source` never parses markdown or touches disk — it scans a consumer-supplied file
inventory's text with deliberately narrow physical-line grammars. `extractSourceLines` is the
sole character engine and emits one `SourceLine` per LF/CRLF physical line plus the final line:
`source` is exact, `code` is equal-length with real comments and complete template tokens masked,
and `jsdoc` is equal-length with every genuine span retained at its physical column or is
`undefined`. A genuine JSDoc capture starts only from ordinary reflection code, never inside an
open comment, raw template, or template substitution. The engine traverses escapes, nested
template substitutions, strings, regex character classes, comments, and division/regex contexts
only to identify those spans; it does not parse TypeScript. Literal ECMAScript Unicode identifiers
participate in bounded slash-state recognition, but escaped identifier spellings are not decoded.
Regex recognition is a bounded lexical goal: because the projection cannot infer whether `}`
closes an expression or a statement/declaration block, slash immediately after bare `}` is
division and a post-brace regex statement needs an explicit `;`. General semicolonless
declaration/ASI classification is also outside this finite projector; callers use an explicit
`;` before a slash-leading statement after such a declaration. Projection preserves columns;
each consumer still owns membership. Direct and hidden heads remain uninterrupted and
column-zero, while barrel rows retain their separate whitespace-tolerant whole-line grammar.

`extractExampleLines` walks only `SourceLine` records. A genuine JSDoc opener is eligible only
when it is the first non-whitespace source material. Within a leading whitespace-separated chain,
each later span replaces the earlier one and is authoritative. Only an exact block-position
`@example` tag qualifies; same-line title text is allowed. Source material between or after spans
severs association, a leading JSDoc on the next line replaces pending state, and any other next
physical record is returned once as the candidate. `examplesFrom` and `exampleMethods` share this
adjacency parser and apply their distinct exported-function and callable-member grammars only to
`code`.

Across the `.ts` module keys under each selected directory, excluding its root `index.ts` and
every `*.test.ts`, `exportsFrom` matches
`^export (?:async )?(function\*?|class|const|interface|type) (\w+)` per projected line, deduped by
(kind, name). `hiddenFrom` applies the same five-kind head grammar without `export`. Comment and
template payload, enums, `let`, `var`, and other TypeScript declaration forms are outside these
two populations; enum exclusion describes reflection scope, not a general package-policy ban.
`declarationBody` locates a named real `export class` / `export interface` head and exact
column-zero close in projected lines (joining an oxfmt-wrapped signature via `joinHead`), then
returns the aligned raw body. `memberMethods` projects that body once and matches
`^\t(?:async )?\*?(\w+)(<[^>]*>)?\??\(` against those body lines — plain / `async` /
generator / optional methods count; getters, setters, `static` members, and `#` privates
never match (their keyword or sigil breaks the `name(` shape), and `constructor` is filtered
out of `Source.methods`. `selectModuleKeys` scopes the inventory to one `GuideModule`'s `.ts` files,
excluding each scope directory's own `index.ts` and any `*.test.ts` file. `Source.hidden()`
mechanically asserts AGENTS §5's export-discipline rule and catches a hidden five-kind
declaration the surface bijection alone would never see.

`Source.surface()` starts only at exact `index.ts` for canonical `'.'`, or exact
`<directory>/index.ts` for each nested directory returned by `normalizeDirectories(module)`.
Inventory keys remain opaque and are never normalized; `hasCanonicalSegments` rejects empty,
`.` and `..` segments while retaining dotfiles. Both the initial index and every resolved target
must be canonical after relative-row reduction; a parent row that reduces to a canonical key
remains valid. A complete row must be equivalent to
`export * from './target.js'`: the target starts with `./` or `../` and ends in `.js`;
surrounding whitespace, either quote, an optional semicolon, and an optional trailing `//`
comment is accepted, while the inactive quote delimiter remains target data. The same projection
masks actual comment/template spans, preserving valid row code around them and markers inside a
quoted target. Arbitrary trailing source is rejected. Only the terminal `.js` becomes `.ts`;
`resolveLink(currentIndex, target)` derives the current index file's directory and delegates to
`resolvePath`, the only dot-segment reducer. Exact workspace-root `index.ts` and nested targets
ending `/index.ts` recurse as barrels, while another exact `.ts` target contributes its direct
`exportsFrom` declarations. One visited set terminates self-cycles, multi-index cycles, repeated
rows, and diamonds. `symbolKey` deduplicates same-name/same-kind rows while retaining
same-name/different-kind rows, and the final list uses the same name sort as `exports()`.

Missing roots and targets, empty barrels, and unsupported rows contribute nothing without
throwing, while valid siblings continue. Named, default, namespace, type-only, non-relative, and
extensionless re-exports are outside the population. So are enums, declarations written directly
in an `index.ts`, and re-export syntax inside a terminal non-index target. Ignoring these forms does not
validate them: repository barrel policy, typechecking, and builds own validity. There is no
filesystem, package-map, alias, config, directory-index fallback, or general TypeScript module
resolution. The supplied inventory is never mutated; the first computed result is cached and the
same readonly array instance is returned thereafter.

## The check catalog

Every guides-parity check reduces to `expect([]).toEqual([])`, paired with a non-vacuousness
guard so a renamed heading fails loudly instead of passing on an empty extraction:

- **SB — Direct/barrel/guide surface parity (kind folded in).** `missingSymbols` proves all four
  directions: direct declarations → barrel surface, barrel surface → direct declarations, barrel
  surface → guide surface, and guide surface → barrel surface. Every comparison uses `symbolKey`,
  so a declaration may drift in neither name nor kind. Guard: `guide.surface().length > 0`.
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
  appears (word boundary) in any of `guide.patterns()`'s fence bodies, OR its source has
  an immediately preceding eligible leading JSDoc chain whose final authoritative span carries
  an exact block-position `@example` tag, with optional title text,
  (`source.examples()` / `source.examples(name)`).
  Applies to every `function`-kind `Surface` symbol and every `MethodGroup` member.
  Presence-only — fence and JSDoc CONTENT are never checked. `findUnexampled` is the
  comparison. Guard: the SB/MB extractions this check reuses already prove non-vacuous.
- **FI — Fence-import reality.** Every `import { ... } from 'specifier'` in a
  `guide.patterns()` fence, for a SELF specifier (this repo's own package name / path
  alias), imports only names that exist in `source.surface()`. `fenceImports` parses the
  statement; `findMissing` diffs the imported names against the public/barrel surface's names.

Permanent controls bind the SB population boundaries through production `Source`, `Guide`,
`missingSymbols`, and `symbolKey`: a stranded direct declaration must be missing from the barrel;
a phantom Guide row must be missing from the barrel; kind drift must fail in both barrel/Guide
directions; a barrel-only declaration outside `selectModuleKeys()` must be missing from direct exports;
a correlated commented declaration must remain absent from direct and barrel populations while
failing Guide-to-barrel; and a workspace-root `index.ts` hop must reach its real terminal symbol.

## The pure file-inventory model

Neither `Guide` nor `Source` ever imports `node:fs` or any other I/O primitive — `Source`'s
construction input (`SourceOptions.files`) is a plain `Readonly<Record<string, string>>` the
CONSUMER gathers however their runtime allows: a recursive `node:fs` walk in a Node vitest
run, `import.meta.glob('/**/*.ts', { eager: true, query: '?raw', import: 'default' })` in a
browser/vitest run, or a static bundle in any other environment. This keeps the package
itself environment-agnostic while every check still runs against real, on-disk truth in the
consumer's own test. The inventory must include each selected module's root `index.ts` and every
reachable exact `.ts` target for `surface()` to observe them; absent keys remain empty reflection.

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
		'src/core/index.ts': "export * from './Guide.js'\nexport * from './types.js'\n",
		'src/core/Guide.ts': 'export class Guide {}\n',
		'src/core/types.ts': 'export interface GuideInterface {\n\tsections(): void\n}\n',
	},
	module: 'src/core',
})
source.exports() // [{ name: 'Guide', kind: 'class' }, { name: 'GuideInterface', kind: 'interface' }]
source.surface() // [{ name: 'Guide', kind: 'class' }, { name: 'GuideInterface', kind: 'interface' }]
source.methods('GuideInterface') // ['sections']
source.exists('src/core/Guide.ts') // true
```

### The bijection assertion shape

```ts
import { createGuide, createSource, missingSymbols } from '@orkestrel/guide'

const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `Guide` | class |')
const source = createSource({
	files: {
		'src/core/index.ts': "export * from './Guide.js'\n",
		'src/core/Guide.ts': 'export class Guide {}\n',
	},
	module: 'src/core',
})

// Direct declarations, public barrel, and guide surface agree in all four directions.
missingSymbols(source.exports(), source.surface()) // []
missingSymbols(source.surface(), source.exports()) // []
missingSymbols(source.surface(), guide.surface()) // []
missingSymbols(guide.surface(), source.surface()) // []
```

### Project source into physical code lines

```ts
import { extractSourceLines } from '@orkestrel/guide'

extractSourceLines('export const visible = true // note\n')
// [{ source: 'export const visible = true // note', code: 'export const visible = true        ', jsdoc: undefined }, ...]
```

### Resolve directory and file targets

```ts
import { resolveLink, resolvePath } from '@orkestrel/guide'

resolvePath('guides/nested', './spec.md') // 'guides/nested/spec.md'
resolveLink('index.ts', './root.ts') // 'root.ts'
```

## Tests

- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — direct `SourceLine`, lexical, JSDoc-alignment, canonical-key, runtime-name, `resolvePath`, and `resolveLink` invariants; all remaining helper leaves.
- [`tests/src/core/parsers.test.ts`](../../tests/src/core/parsers.test.ts) — projected five-kind direct/hidden reflection, genuine JSDoc example adjacency, faux JSDoc exclusion, nested-directory `parseManifest`, and every guide/manifest extractor.
- [`tests/src/core/validators.test.ts`](../../tests/src/core/validators.test.ts) — `isExportKind` / `isSurfaceSymbol` / `isMethodGroup` / `isManifestEntry`.
- [`tests/src/core/shapers.test.ts`](../../tests/src/core/shapers.test.ts) — per-shape guard exactness, JSON Schema essentials, seeded generate round-trips, parse rebuilds.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createGuide` / `createSource` + the compiled symbol/group/manifest contracts.
- [`tests/src/core/Guide.test.ts`](../../tests/src/core/Guide.test.ts) — `Guide`'s six cached projections and production barrel/Guide phantom and kind-drift controls.
- [`tests/src/core/Source.test.ts`](../../tests/src/core/Source.test.ts) — direct/barrel projections, lexical and JSDoc regressions, canonical-key populations, root and nested indexes, exact row grammar, graph invariants, and correlated population controls.
- [`tests/fixtures/broken/stranded-export`](../../tests/fixtures/broken/stranded-export) — permanent negative control: its guide and direct declarations agree while its conventional barrel omits `strandedExport`.
- [`tests/guides.test.ts`](../../tests/guides.test.ts) — the drop-in guides-parity suite, run against THIS repo's own `guides/README.md` manifest — the self-dogfooding acceptance criterion.

## See also

- `AGENTS.md` (workspace root) — the rules; §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
- [`markdown.md`](markdown.md) — the dependency mirror for `@orkestrel/markdown`, the AST/parse layer `Guide` is built on.
