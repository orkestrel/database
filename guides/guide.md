# Guide

> A pure, I/O-free guides-parity toolkit: `Guide` extracts a markdown guide's documented
> surface, method groups, links, test links, and fenced code blocks; `Source` reflects direct
> declarations and conventional barrel reachability from a consumer-supplied file inventory through pure text
> scanners (no filesystem or TypeScript compiler API); runtime dependencies provide markdown
> and contract primitives, while comparison helpers (`findMissingSymbols`, `findMissing`,
> `resolveLink`, …) reduce every guides-parity check to `expect([]).toEqual([])`
> (`.claude/rules/documentation.md`). Source: [`src/core`](../src/core). Published through `@orkestrel/guide`.

A guide is a contract, not prose. `createGuide(markdown)` parses a guide's
source once (through `@orkestrel/markdown`) into a `GuideInterface` — its `## Surface` identifiers
(keyword-tagged), its `## Methods` interface/method groups, every link, its `## Tests`
links, and every fenced code block, each cached at construction.
`createSource({ files, module })` builds a
`SourceInterface` that reflects intentional direct declarations, conventional barrel-reachable
declarations, and interface/class methods by scanning a consumer-gathered file inventory with
plain-text line scanners, never touching disk itself. `createSourceManager({ files, modules })`
resolves the consumer's own import specifiers onto those views, one shared `Source` per module, so
a check that meets an import decides from the specifier alone which face of the package it names.
A guides-parity test asserts direct declarations equal the barrel surface and the barrel surface
equals the documented surface, in both directions. `parseManifest` reads a `guides/README.md`'s
`## By concept` table into the list of `{ concept, spec, source, tests }` entries a suite
iterates to run this check once per documented concept.

## Surface

### Types

The manifest/extraction shapes every check is built from, from [`types.ts`](../src/core/types.ts).

| Name                     | Kind      | Shape                                                                                                                                                                                                                                         |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExportKeyword`          | type      | `'type' \| 'interface' \| 'const' \| 'function' \| 'class'` — the declaration-keyword reflection population, derived from `EXPORT_KEYWORDS`. Comment/template payload and enums are outside it; general package policy does not forbid enums. |
| `SurfaceSymbol`          | interface | `{ name, keyword }` — one documented / exported symbol.                                                                                                                                                                                       |
| `GuideModule`            | type      | `string \| readonly string[]` — one source directory, or several; `'.'` is the canonical workspace root.                                                                                                                                      |
| `SourceLine`             | interface | `{ source, code, jsdoc }` — one terminator-free physical source line with exact raw text, equal-length projections, and every genuine JSDoc span at its physical column or `undefined`.                                                       |
| `ManifestEntry`          | interface | `{ concept, spec, source, tests }` — one `## By concept` manifest row, paths normalized to workspace root.                                                                                                                                    |
| `MethodGroup`            | interface | `{ interface, methods }` — one `#### \`Interface\`` block's documented method names, in table order.                                                                                                                                          |
| `FenceImport`            | interface | `{ specifier, names }` — one brace `import` statement projected from a guide fence, each alias resolved to the original exported name.                                                                                                        |
| `GuideFence`             | interface | `{ language, code }` — one fenced code block; `language` is its info-string tag, or `undefined` when the fence is untagged.                                                                                                                   |
| `GuideInterface`         | interface | `{ sections, surface, methods, links, tests, fences }` — the structured, pure view over one parsed guide. See [`## Methods`](#methods).                                                                                                       |
| `SourceInterface`        | interface | `{ exports, surface, methods, exists, hidden, examples }` — direct declarations, conventional barrel reachability, members, paths, discipline, and examples. See [`## Methods`](#methods).                                                    |
| `SourceManagerInterface` | interface | `{ source, sources }` — resolves one import specifier to the shared source view of the module it names, and enumerates those views. See [`## Methods`](#methods).                                                                             |
| `SourceOptions`          | interface | `{ files, module }` — exact canonical-segment opaque workspace-relative inventory keys plus the canonicalized module scope to reflect.                                                                                                        |
| `SourceManagerOptions`   | interface | `{ files, modules }` — one shared inventory plus the consumer's own specifier-to-module policy.                                                                                                                                               |
| `DeclarationHead`        | interface | `{ text, end }` — a declaration head joined into one line (across an oxfmt-wrapped signature) plus the index of the line ending in `{`.                                                                                                       |
| `Declaration`            | interface | `{ body, bases }` — one located `export class` / `export interface` declaration, its body lines and its base identifiers read from the same head.                                                                                             |
| `DeclarationKeyword`     | type      | `'class' \| 'interface'` — which declaration head `extractDeclaration` and `Source` locate; the `ExportKeyword` subset carrying a documented member body.                                                                                     |

### Constants

The declaration-keyword population, the section-heading keys, and the external-link schemes every
extractor and link check is keyed on, from [`constants.ts`](../src/core/constants.ts).

| Name               | Kind  | Behavior                                                                                                                                                    |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPORT_KEYWORDS`  | const | `['type', 'interface', 'const', 'function', 'class']` — the frozen population `ExportKeyword`, `isExportKeyword`, and `surfaceSymbolShape` all derive from. |
| `SURFACE`          | const | `'Surface'` — the `## Surface` heading text.                                                                                                                |
| `METHODS`          | const | `'Methods'` — the `## Methods` heading text.                                                                                                                |
| `TESTS`            | const | `'Tests'` — the `## Tests` heading text.                                                                                                                    |
| `MANIFEST`         | const | `'By concept'` — the `## By concept` manifest heading text.                                                                                                 |
| `EXTERNAL_SCHEMES` | const | `readonly string[]` — `['http:', 'https:', 'mailto:', 'tel:']`; a link with one of these prefixes is never filesystem-resolved.                             |

### Helpers

Pure, total leaves from [`helpers.ts`](../src/core/helpers.ts) — the source-line projection,
the declaration, member, JSDoc, and guide-document grammars built on it, and the comparison and
path primitives `Guide`, `Source`, `parsers.ts`, and a consumer's parity test all reach for
directly.

| Name                    | Kind     | Signature                                                                                                 | Behavior                                                                                                                                                                                                                                          |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeDirectories`  | function | `(module: GuideModule) => readonly string[]`                                                              | Canonicalizes through `resolvePath`, uses `'.'` for root, and removes duplicates in first-seen order.                                                                                                                                             |
| `computeModuleKey`      | function | `(module: GuideModule) => string`                                                                         | The stable cache key for a module scope — its normalized directories joined by NUL, so two spellings of one module share a key and no directory boundary can collide with directory text.                                                         |
| `selectModuleKeys`      | function | `(files: Readonly<Record<string, string>>, module: GuideModule) => readonly string[]`                     | Selects exact canonical-segment opaque `.ts` keys under any scope and excludes every selected exact `index.ts` plus `*.test.ts`; sorted.                                                                                                          |
| `hasCanonicalSegments`  | function | `(key: string) => boolean`                                                                                | Rejects empty, `.` and `..` slash-separated segments without normalization while retaining ordinary dotfiles.                                                                                                                                     |
| `computeSymbolKey`      | function | `(symbol: SurfaceSymbol) => string`                                                                       | The bijection key for a surface symbol — `${keyword} ${name}` — so a symbol comparison diffs (name, keyword) pairs, not names alone.                                                                                                              |
| `findMissing`           | function | `(names: readonly string[], source: readonly string[]) => readonly string[]`                              | The names present in `names` but absent from `source` — the set-difference behind a both-directions bijection assertion.                                                                                                                          |
| `findMissingSymbols`    | function | `(symbols: readonly SurfaceSymbol[], source: readonly SurfaceSymbol[]) => readonly string[]`              | The `computeSymbolKey` set-difference between two symbol lists.                                                                                                                                                                                   |
| `extractSourceLines`    | function | `(source: string) => readonly SourceLine[]`                                                               | Equal-length physical source, code, and JSDoc projection with bounded literal Unicode identifier slash state.                                                                                                                                     |
| `extractExports`        | function | `(source: string) => readonly SurfaceSymbol[]`                                                            | Direct declaration-keyword exports over projected lines with an uninterrupted column-zero head; projection never widens membership.                                                                                                               |
| `extractHidden`         | function | `(source: string) => readonly SurfaceSymbol[]`                                                            | The non-exported mirror with the same projected, uninterrupted column-zero head and declaration-keyword population.                                                                                                                               |
| `joinHead`              | function | `(lines: readonly string[], start: number) => DeclarationHead \| undefined`                               | Joins a declaration head starting at `start` into one space-separated line, consuming lines until the first ending in `{`.                                                                                                                        |
| `escapeRegExp`          | function | `(value: string) => string`                                                                               | Escapes every regex metacharacter in a literal string so it reads as text inside a larger `RegExp` source — `extractDeclaration`'s head grammar and `findUnexampled`'s word-boundary search both splice a caller-supplied name through it.        |
| `extractDeclaration`    | function | `(source: string, keyword: DeclarationKeyword, name: string) => Declaration \| undefined`                 | Locates one real `export class` / `export interface` head in projected lines and returns its raw body and its `extends` bases together, or `undefined` when the file declares no such head.                                                       |
| `extractMemberMethods`  | function | `(lines: readonly string[]) => readonly string[]`                                                         | Matches callable members on one projection of the body; commented candidates, getters, setters, `static`, and `#` privates never count.                                                                                                           |
| `extractExampleLines`   | function | `(lines: readonly SourceLine[]) => readonly SourceLine[]`                                                 | The next physical candidate after the authoritative exact `@example` span in a leading chain.                                                                                                                                                     |
| `extractExamples`       | function | `(source: string) => readonly string[]`                                                                   | Matches exported functions against shared eligible genuine JSDoc adjacency and aligned code.                                                                                                                                                      |
| `extractExampleMethods` | function | `(lines: readonly string[]) => readonly string[]`                                                         | Matches callable members against the same shared eligible genuine JSDoc adjacency and aligned code.                                                                                                                                               |
| `selectSectionBlocks`   | function | `(document: MarkdownDocument, heading: string) => readonly BlockNode[]`                                   | The block nodes under a named `##` heading, up to the next `##`-or-higher heading (or the document's end).                                                                                                                                        |
| `extractSurface`        | function | `(document: MarkdownDocument) => readonly SurfaceSymbol[]`                                                | Every `## Surface` identifier: each table's rows union every backticked H3 entity heading, deduped by `computeSymbolKey`.                                                                                                                         |
| `extractMethods`        | function | `(document: MarkdownDocument) => readonly MethodGroup[]`                                                  | One `MethodGroup` per documented behavioral interface in `## Methods` — an H4 code span sets the interface, the following table lists its methods.                                                                                                |
| `extractLinks`          | function | `(document: MarkdownDocument) => readonly string[]`                                                       | Every link href in the guide document, including table cells — a full, depth-first AST walk.                                                                                                                                                      |
| `extractTests`          | function | `(document: MarkdownDocument) => readonly string[]`                                                       | The relative test links declared under `## Tests`.                                                                                                                                                                                                |
| `extractFences`         | function | `(document: MarkdownDocument) => readonly GuideFence[]`                                                   | Every fenced code block anywhere in the guide document, tagged or not — a full AST walk with no language filter.                                                                                                                                  |
| `isExternalLink`        | function | `(href: string) => boolean`                                                                               | Whether a guides-parity link check skips a link `href` — an external scheme (`EXTERNAL_SCHEMES`) or a bare `#` anchor.                                                                                                                            |
| `resolveLink`           | function | `(file: string, target: string) => string`                                                                | Derives a declaring file's directory, including workspace-root files, then delegates to `resolvePath`.                                                                                                                                            |
| `resolvePath`           | function | `(directory: string, target: string) => string`                                                           | Sole dot-segment reducer; returns `'.'` when no segment remains and preserves every excess leading parent.                                                                                                                                        |
| `findFirstCode`         | function | `(nodes: readonly InlineNode[]) => string \| undefined`                                                   | The first code-span value found by descending an inline node list, following into `emphasis`, `link`, and `image` children.                                                                                                                       |
| `normalizeIdentifier`   | function | `(code: string) => string`                                                                                | The identifier prefix of a code-span text — everything before its first `<`, trimmed (strips generic-parameter annotation).                                                                                                                       |
| `findKindIndex`         | function | `(table: TableNode) => number \| undefined`                                                               | The index of a table's `Kind` column, found by its header text so it survives column reordering.                                                                                                                                                  |
| `extractCellLinks`      | function | `(cell: readonly InlineNode[]) => readonly string[]`                                                      | The link hrefs found within one table cell's inline content, in walk order.                                                                                                                                                                       |
| `findUnexampled`        | function | `(names: readonly string[], fences: readonly string[], examples: readonly string[]) => readonly string[]` | The names with no fence mention (word boundary) and no `@example` membership — the EX check's core comparison.                                                                                                                                    |
| `findUnlisted`          | function | `(fences: readonly GuideFence[], languages: readonly string[]) => readonly GuideFence[]`                  | The fences whose language the caller did not list, plus every untagged fence — an untagged fence has no language to list.                                                                                                                         |
| `extractFenceImports`   | function | `(fence: string) => readonly FenceImport[]`                                                               | Parses a fence's brace `import` statements into per-specifier imported identifier names — the FI check's core comparison. Brace bindings only: a default, namespace, side-effect, or mixed `import Default, { named }` statement is not surfaced. |

### Parsers

The manifest coercer, from [`parsers.ts`](../src/core/parsers.ts) — the one scanner that turns
markdown text into typed values, composed out of `helpers.ts`'s leaves.

| Name            | Kind     | Signature                                                           | Behavior                                                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `parseManifest` | function | `(markdown: string, directory: string) => readonly ManifestEntry[]` | Resolves manifest links and canonicalizes Source values through `normalizeDirectories`, preserving one-versus-many shape. |

### Shapers

Declarative `ContractShape` values (from `@orkestrel/contract`) from
[`shapers.ts`](../src/core/shapers.ts) — every documented data type here is
non-recursive, so each shapes directly.

| Name                 | Kind  | Builds                                                                              |
| -------------------- | ----- | ----------------------------------------------------------------------------------- |
| `surfaceSymbolShape` | const | The shape of a `SurfaceSymbol` — `{ name: string, keyword: ExportKeyword }`.        |
| `methodGroupShape`   | const | The shape of a `MethodGroup` — `{ interface: string, methods: readonly string[] }`. |
| `manifestEntryShape` | const | The shape of a `ManifestEntry` — `source` accepting a single directory or several.  |

### Validators

Total from-unknown guards composed from `@orkestrel/contract` combinators, from
[`validators.ts`](../src/core/validators.ts).

| Name              | Kind  | Narrows to / Tests | Behavior                                                               |
| ----------------- | ----- | ------------------ | ---------------------------------------------------------------------- |
| `isExportKeyword` | const | `value: unknown`   | `true` when `value` is one of the documented `ExportKeyword` literals. |
| `isSurfaceSymbol` | const | `value: unknown`   | `true` when `value` is a well-formed `SurfaceSymbol`.                  |
| `isMethodGroup`   | const | `value: unknown`   | `true` when `value` is a well-formed `MethodGroup`.                    |
| `isManifestEntry` | const | `value: unknown`   | `true` when `value` is a well-formed `ManifestEntry`.                  |

### Factories

From [`factories.ts`](../src/core/factories.ts).

| Name                          | Kind     | Signature                                                   | Behavior                                                                                               |
| ----------------------------- | -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createGuide`                 | function | `(source: string) => GuideInterface`                        | Creates a structured `GuideInterface` view over one guide's markdown source.                           |
| `createSource`                | function | `(options: SourceOptions) => SourceInterface`               | Creates a pure `SourceInterface` over a consumer-supplied file inventory.                              |
| `createSourceManager`         | function | `(options: SourceManagerOptions) => SourceManagerInterface` | Creates a `SourceManagerInterface` over a specifier-to-module policy, sharing one `Source` per module. |
| `createSurfaceSymbolContract` | function | `() => ContractInterface<SurfaceSymbol>`                    | Compiles `surfaceSymbolShape` into a guard / parser / schema / generator bundle.                       |
| `createMethodGroupContract`   | function | `() => ContractInterface<MethodGroup>`                      | Compiles `methodGroupShape` into a guard / parser / schema / generator bundle.                         |
| `createManifestEntryContract` | function | `() => ContractInterface<ManifestEntry>`                    | Compiles `manifestEntryShape` into a guard / parser / schema / generator bundle.                       |

### `Guide`

The implementing class of `GuideInterface`, from [`Guide.ts`](../src/core/Guide.ts). A
pure, structured view over one parsed guide: parses `source` once through
`@orkestrel/markdown` and never touches the filesystem — `Guide` reads only the markdown
text it is given and records nothing about where the guide came from. Every accessor
returns the same cached, readonly array on every call. See [`## Methods`](#methods) for its
public call-signature surface.

### `Source`

The implementing class of `SourceInterface`, from [`Source.ts`](../src/core/sources/Source.ts). A
pure reflection over a consumer-supplied file inventory (root-relative path → file text) plus a
module scope. `exports()` inventories direct `type`, `interface`, `const`, `function`, and
`class` declarations in the selected canonical directories' exact opaque module keys over
comment/template-excluded projected code lines; `enum` is outside this reflection population without being forbidden by
general package policy;
`surface()` inventories declarations reachable through each selected directory's conventional
root barrel. Both projections are computed on first access, cached, deduplicated by name and
keyword, and sorted by name. Member structure comes from projected lines while raw bodies preserve
JSDoc evidence, and `methods(name)` resolves a declaration's members through its `extends` chain
within the same module scope, reading the first file that declares the name. `Source` never uses the
TypeScript compiler API or filesystem; the consumer gathers `files` however its environment
allows. See [`## Methods`](#methods) for the public call-signature surface.

### `SourceManager`

The implementing class of `SourceManagerInterface`, from
[`SourceManager.ts`](../src/core/sources/SourceManager.ts). It answers one question a bare `Source`
cannot: a guide fence may import from a face of the package this `Source` does not cover, and the
check needs the right `Source` for whichever specifier the fence names. `modules` is the consumer's
own policy — it maps each import specifier the package publishes to the source module behind it —
and `SourceManager` never infers or normalizes that map. `source(specifier)` returns `undefined` for
an unmapped specifier, and a fence-import check skips the import on that signal; a mapped specifier
is local. `sources()` enumerates the same views, one per distinct module the policy maps, so a
check that must sweep every face of the package reads them without repeating the policy. One
`Source` is cached per module, so two specifiers naming one module share one entity and the
inventory is scanned once. See [`## Methods`](#methods) for its public call-signature surface.

## Methods

The public methods of each behavioral interface — one table per type, keyed by its
backticked name (`.claude/rules/documentation.md` § Parity).

#### `GuideInterface`

| Method     | Returns                    | Behavior                                                                                    |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `sections` | `readonly string[]`        | The `##` heading names, in document order — the non-vacuousness guard for section presence. |
| `surface`  | `readonly SurfaceSymbol[]` | Every `## Surface` identifier + keyword — table rows union backticked entity headings.      |
| `methods`  | `readonly MethodGroup[]`   | One `MethodGroup` per documented behavioral interface in `## Methods`.                      |
| `links`    | `readonly string[]`        | Every link href in the guide, including table cells.                                        |
| `tests`    | `readonly string[]`        | The relative test links declared under `## Tests`.                                          |
| `fences`   | `readonly GuideFence[]`    | Every fenced code block in the whole document, tagged or not — no language filter.          |

#### `SourceInterface`

| Method     | Returns                    | Behavior                                                                                                                                                                                                    |
| ---------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exports`  | `readonly SurfaceSymbol[]` | What the package **declares** — direct `type`, `interface`, `const`, `function`, and `class` declarations in the selected module keys.                                                                      |
| `surface`  | `readonly SurfaceSymbol[]` | What a consumer can **import** — every declaration reachable through the selected directories' conventional root `index.ts` barrels.                                                                        |
| `methods`  | `readonly string[]`        | The call-signature members of the `class` / `interface` named `name`, unioned with those of every declaration it extends within the module scope. The first file declaring the name answers for it.         |
| `exists`   | `boolean`                  | Whether a workspace-root-relative path names an inventory key exactly, or a directory any inventory key sits beneath — which is what lets a guide link to a directory resolve.                              |
| `hidden`   | `readonly SurfaceSymbol[]` | Every module-scope declaration **lacking** `export` (`.claude/rules/architecture.md` § Barrel exports).                                                                                                     |
| `examples` | `readonly string[]`        | The exported functions (or, given `name`, that declaration's own members) whose eligible leading JSDoc chain ends in an exact block-position `@example` span. Given `name`, it follows no `extends` clause. |

#### Which projector a check uses

`exports()` and `surface()` answer different questions, and picking the wrong one is the most
common error in a consumer's parity test.

**`surface()` is what a guide is checked against.** A guide documents what a consumer can import,
and `surface()` is the barrel-reachable set. Use it for the documented-surface bijection (SB) and
for the fence-import comparison (FI).

**`exports()` answers a different question.** It is every direct declaration under the selected
modules, and it includes a class that carries `export` only because the placement sweep requires
every implementation class to be exported. Those classes are deliberately absent from the barrel,
so they are not part of the package's public surface. Use `exports()` where the question really is
what the package declares — the direct-versus-barrel legs of SB, which catch a declaration the
barrel never re-exports.

Check whether `surface()` already answers the question before reaching for a denylist over
`exports()` or a second projector built on the TypeScript compiler. `surface()` excludes the
internal implementation classes a denylist would enumerate by hand, so a fence-import check reads
`surface()`.

#### `SourceManagerInterface`

| Method    | Returns                        | Behavior                                                                                                                   |
| --------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `source`  | `SourceInterface \| undefined` | The shared source view of the module `specifier` names, or `undefined` when the policy does not map it — a foreign import. |
| `sources` | `readonly SourceInterface[]`   | One shared source view per distinct module the policy maps, in first-seen specifier order.                                 |

## The extraction model

`Guide` parses a guide's markdown once (through `@orkestrel/markdown`'s `createMarkdown`) and
caches its projections at construction — `sections`, `surface`, `methods`, `links`, `tests`,
`fences` — so every accessor is a cheap array return, not a re-parse. `extractSurface` scopes to the
`## Surface` section (`selectSectionBlocks`) and unions its sources of identifiers: every table's
column-0 code span (keyword read from the column whose header text is `Kind`, located
positionally so it survives reordering) and every backticked H3 entity heading (a class
documented outside a table, keyword fixed to `'class'`). `extractMethods` scopes to
`## Methods`: an H4 whose first code span sets the current interface name, and the very next
table becomes that interface's `MethodGroup`. Both extractors normalize every identifier
through `normalizeIdentifier`, stripping a generic-parameter annotation (`` `WidgetInterface<T>` ``
→ `WidgetInterface`) so the bijection key is always the bare name. `extractLinks` walks the
whole AST for every `link` node (table cells included); `extractTests` does the same walk
scoped to the `## Tests` section only; and `extractFences` walks the whole AST for every
fenced code block, tagged or not, keeping each fence's info-string language and verbatim body.

The fence projection is total on purpose. `Guide` reports what the document contains, and each
consumer decides which languages its own checks read: `findUnlisted` states the list a package
allows, and the example and import checks filter to the language they parse. A package documenting
`sql` or `sh` examples can therefore feed those fences to its own checks. A `ts` filter inside
`Guide` would have discarded them before the consumer ever saw them, and an untagged fence would
have vanished with no language to report.

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
physical record is returned once as the candidate. `extractExamples` and `extractExampleMethods` share this
adjacency parser and apply their distinct exported-function and callable-member grammars only to
`code`.

Across the `.ts` module keys under each selected directory, excluding its root `index.ts` and
every `*.test.ts`, `extractExports` matches
`^export (?:async )?(function\*?|class|const|interface|type) (\w+)` per projected line, deduped by
(keyword, name). `extractHidden` applies the same declaration-keyword head grammar without
`export`. Comment and
template payload, enums, `let`, `var`, and other TypeScript declaration forms are outside these
populations; enum exclusion describes reflection scope, not a general package-policy ban.
`extractDeclaration` locates a named real `export class` / `export interface` head and exact
column-zero close in projected lines (joining an oxfmt-wrapped signature through `joinHead`), then
returns that one head's aligned raw body and its `extends` bases as a single `Declaration`, or
`undefined` when the file declares no such head. One locator is what keeps a body and a heritage
clause on the same declaration. Its identifier is escaped through `escapeRegExp` before it enters
the head grammar, so a name carrying a regex metacharacter is literal text rather than a wildcard
or a thrown `SyntaxError`. A head that opens no column-zero close is skipped and the scan
continues. `extractMemberMethods` projects that body once and matches
`^\t(?:async )?\*?(\w+)(<[^>]*>)?\??\(` against those body lines — plain / `async` /
generator / optional methods count; getters, setters, `static` members, and `#` privates
never match (their keyword or sigil breaks the `name(` shape), and `constructor` is filtered
out of `Source.methods`. Every balanced `<...>` span is removed from the head before its `extends`
clause is read, so a `T extends Base` type parameter never reads as a base and `Base<T>` reads as
`Base`, and a class's `implements` clause is excluded. `Source.methods(name)` unions the located
declaration's own members with those of every declaration it extends, following each base through
the same module scope and keeping the keyword it started from — an interface chain resolves through
interfaces, a class chain through classes, so an interface extending a name only a class declares
gets nothing from it. One declaration answers for a name: the module scope's files are read in
sorted key order, and the first one whose located head has a body or has bases supplies both the
members and the bases; a head with neither a body nor bases does not count as declared, so an empty
`export interface X {}` is skipped and the scan continues to a later file or falls through to a
same-named class, and a second file declaring the same name after one is found adds nothing. The
inventory is the further bound: a base the
selected directories do not declare, whether it is imported from another package or written as a
qualified name such as `external.Store`, contributes no members and is not an error, and one
visited set per call collapses a cycle and a diamond to a single visit. `Source.examples(name)` is
deliberately asymmetric with it — it reads only the named declaration's own body, under each
keyword, and follows no `extends` clause, so an inherited member's `@example` belongs to the base
that declares it. `selectModuleKeys` scopes the inventory to one `GuideModule`'s `.ts` files,
excluding each scope directory's own `index.ts` and any `*.test.ts` file. `Source.hidden()`
mechanically asserts the export-discipline rule `.claude/rules/architecture.md` § Barrel exports
states, and catches a hidden declaration-keyword declaration the surface bijection alone would
never see.

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
`extractExports` declarations. One visited set terminates self-cycles, multi-index cycles, repeated
rows, and diamonds. `computeSymbolKey` deduplicates same-name/same-keyword rows while retaining
same-name/different-keyword rows, and the final list uses the same name sort as `exports()`.

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

- **SB — Direct/barrel/guide surface parity (keyword folded in).** `findMissingSymbols` proves every
  direction: direct declarations → barrel surface, barrel surface → direct declarations, barrel
  surface → guide surface, and guide surface → barrel surface. Every comparison uses `computeSymbolKey`,
  so a declaration may drift in neither name nor keyword. Guard: `guide.surface().length > 0`.
- **MB — Methods bijection + class-no-extra.** Per `MethodGroup`, its `methods` vs
  `source.methods(group.interface)`, `findMissing` both directions; then, by the
  `XInterface → X` naming convention, `findMissing(source.methods('X'), group.methods)` must
  also be empty — the implementing class exposes no undocumented public method. Guard:
  `group.methods.length > 0`.
- **LI — Link integrity.** `guide.links()`, dropping `isExternalLink` hrefs, `resolveLink`
  the rest against the guide's own path, keep those failing `source.exists` — which holds for a
  directory link too, because `exists` answers for an inventory key and for any directory a key
  sits beneath. Guard: `guide.links().length > 0`.
- **TE — Tests-link existence.** `guide.tests()`, `resolveLink` + `source.exists`, keep the
  missing; a link naming a fixture directory resolves on the same directory rule. Guard:
  `guide.tests().length > 0`.
- **NV — Non-vacuousness.** `parseManifest` yields at least one entry; each guide's
  `surface()` and every `MethodGroup` is non-empty — the guard behind every other check.
- **FL — Fence-language listing.** `findUnlisted(guide.fences(), LANGUAGES)` keeps every fence
  whose language the package did not list, plus every untagged fence. The list is the package's
  own — `Guide` never decides it — so a package documenting `sh` or `sql` examples lists those
  languages and keeps its remaining checks scoped to the one they parse.
- **EX — Examples presence.** A documented symbol "has an example" when its bare name
  appears (word boundary) in any fence body from `guide.fences()` filtered to the example
  language, **or** its source has an immediately preceding eligible leading JSDoc chain whose final
  authoritative span carries an exact block-position `@example` tag, with optional title text,
  (`source.examples()` / `source.examples(name)`).
  Applies to every `function`-keyword `Surface` symbol and every `MethodGroup` member.
  Presence-only — fence and JSDoc **content** are never checked. `findUnexampled` is the
  comparison. Guard: the SB/MB extractions this check reuses already prove non-vacuous.
- **FI — Fence-import reality.** Every `import { ... } from 'specifier'` in a `guide.fences()`
  fence of the checked language, for a **self** specifier (this repo's own package name / path
  alias), imports only names that exist in `source.surface()`. `extractFenceImports` parses the
  statement; `findMissing` diffs the imported names against the public/barrel surface's names.
  Guard: the comparison runs against at least one resolved import.

Permanent controls bind the SB population boundaries through production `Source`, `Guide`,
`findMissingSymbols`, and `computeSymbolKey`: a stranded direct declaration must be missing from the barrel;
a phantom Guide row must be missing from the barrel; keyword drift must fail in both barrel/Guide
directions; a barrel-only declaration outside `selectModuleKeys()` must be missing from direct exports;
a correlated commented declaration must remain absent from direct and barrel populations while
failing Guide-to-barrel; and a workspace-root `index.ts` hop must reach its real terminal symbol.

## The pure file-inventory model

Neither `Guide` nor `Source` ever imports `node:fs` or any other I/O primitive — `Source`'s
construction input (`SourceOptions.files`) is a plain `Readonly<Record<string, string>>` the
**consumer** gathers however their runtime allows: a recursive `node:fs` walk in a Node vitest
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
guide.surface() // [{ name: 'X', keyword: 'class' }]
guide.sections() // ['Surface']
```

### List the fence languages a package allows

````ts
import { createGuide, findUnlisted } from '@orkestrel/guide'

const guide = createGuide('```ts\nconst a = 1\n```\n\n```sh\nnpm test\n```\n')
guide.fences() // [{ language: 'ts', code: 'const a = 1' }, { language: 'sh', code: 'npm test' }]
findUnlisted(guide.fences(), ['ts']) // [{ language: 'sh', code: 'npm test' }]
findUnlisted(guide.fences(), ['ts', 'sh']) // []
````

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
source.exports() // [{ name: 'Guide', keyword: 'class' }, { name: 'GuideInterface', keyword: 'interface' }]
source.surface() // [{ name: 'Guide', keyword: 'class' }, { name: 'GuideInterface', keyword: 'interface' }]
source.methods('GuideInterface') // ['sections']
source.exists('src/core/Guide.ts') // true
source.exists('src/core') // true — a directory any inventory key sits beneath
```

### Resolve a fence's import specifier to the right `Source`

```ts
import { createSourceManager } from '@orkestrel/guide'

const sources = createSourceManager({
	files: {
		'src/core/index.ts': "export * from './Guide.js'\n",
		'src/core/Guide.ts': 'export class Guide {}\n',
	},
	modules: { '@scope/package': 'src/core', '@scope/package/core': 'src/core' },
})

sources.source('@scope/package')?.surface() // [{ name: 'Guide', keyword: 'class' }]
sources.source('node:fs') // undefined — a foreign import, which a fence check skips
sources.source('@scope/package') === sources.source('@scope/package/core') // true
sources.sources() // [the one shared view both specifiers name]
```

### The bijection assertion shape

```ts
import { createGuide, createSource, findMissingSymbols } from '@orkestrel/guide'

const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `Guide` | class |')
const source = createSource({
	files: {
		'src/core/index.ts': "export * from './Guide.js'\n",
		'src/core/Guide.ts': 'export class Guide {}\n',
	},
	module: 'src/core',
})

// Direct declarations, public barrel, and guide surface agree in every direction.
findMissingSymbols(source.exports(), source.surface()) // []
findMissingSymbols(source.surface(), source.exports()) // []
findMissingSymbols(source.surface(), guide.surface()) // []
findMissingSymbols(guide.surface(), source.surface()) // []
```

### Project source into physical code lines

```ts
import { extractSourceLines } from '@orkestrel/guide'

extractSourceLines('export const visible = true // note\n')
// [{ source: 'export const visible = true // note', code: 'export const visible = true        ', jsdoc: undefined }]
// … one record per remaining line
```

### Resolve directory and file targets

```ts
import { resolveLink, resolvePath } from '@orkestrel/guide'

resolvePath('guides/nested', './spec.md') // 'guides/nested/spec.md'
resolveLink('index.ts', './root.ts') // 'root.ts'
```

## Tests

- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — direct `SourceLine`, lexical, and JSDoc-alignment invariants; projected declaration-keyword direct/hidden reflection; genuine JSDoc example adjacency and faux JSDoc exclusion; every guide-document extractor; canonical-key, runtime-name, `resolvePath`, and `resolveLink` invariants; all remaining helper leaves.
- [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts) — `parseManifest` row parsing, malformed-row skipping, one-versus-many Source canonicalization, and nested manifest directories.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — `isExportKeyword` / `isSurfaceSymbol` / `isMethodGroup` / `isManifestEntry`.
- [`tests/src/core/shapers.test.ts`](../tests/src/core/shapers.test.ts) — per-shape guard exactness, JSON Schema essentials, seeded generate round-trips, parse rebuilds.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createGuide` / `createSource` + the compiled symbol/group/manifest contracts.
- [`tests/src/core/Guide.test.ts`](../tests/src/core/Guide.test.ts) — `Guide`'s cached projections and production barrel/Guide phantom and keyword-drift controls.
- [`tests/src/core/sources/Source.test.ts`](../tests/src/core/sources/Source.test.ts) — direct/barrel projections, lexical and JSDoc regressions, canonical-key populations, root and nested indexes, exact row grammar, graph invariants, and correlated population controls.
- [`tests/src/core/sources/SourceManager.test.ts`](../tests/src/core/sources/SourceManager.test.ts) — `computeModuleKey` boundary collision, specifier resolution, the `undefined` skip for an unmapped specifier, array-valued module scopes, `sources()` enumeration, and per-module entity sharing with a differently-scoped identity control.
- [`tests/fixtures/broken/stranded-export`](../tests/fixtures/broken/stranded-export) — permanent negative control: its guide and direct declarations agree while its conventional barrel omits `strandedExport`.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — the drop-in guides-parity suite, run against **this** repository's own `guides/README.md` manifest — the self-dogfooding acceptance criterion.

## See also

- `AGENTS.md` (workspace root) — the rules; `.claude/rules/documentation.md` § Parity states the documentation-as-contract law.
- [`README.md`](README.md) — the guides index.
