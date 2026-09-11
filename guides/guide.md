# Guide

> A guides-parity toolkit: pure inventory readers and comparisons in core, plus a reusable server
> command that checks or explicitly rewrites a package's guides.

A guide is a contract, not prose. `createGuide(markdown)` parses a guide's source once (through
`@orkestrel/markdown`) into a `GuideInterface` — its `## Surface` identifiers (keyword-tagged),
its `## Methods` interface/method groups, every link, its `## Tests` links, and every fenced code
block, each cached at construction. `createSource({ files, module })` builds a `SourceInterface`
that reflects intentional direct declarations, conventional barrel-reachable declarations, and
interface/class methods by scanning a consumer-gathered file inventory with plain-text line
scanners, never touching disk itself. `createSourceManager({ files, modules })` resolves the
consumer's own import specifiers onto those views, one shared `Source` per module, so a check
that meets an import decides from the specifier alone which face of the package it names. A
guides-parity test asserts direct declarations equal the barrel surface and the barrel surface
equals the documented surface, in both directions, and `findDrift` reports where a `Summary`
cell, a documented method, or a titled fence disagrees with the source it documents.
`parseManifest` reads a `guides/README.md`'s `## By concept` table into the list of
`{ concept, spec, source, tests }` entries a suite iterates to run this check once per documented
concept. [`GuideCommand`](../src/server/GuideCommand.ts) supplies the Node shell shared by package
guide scripts. It keeps package assertions in a worker callback while it owns native argument
selection, fresh inventory reads, explicit writes, the guides-project run, reporting, and exit
precedence. This package publishes core through `@orkestrel/guide` and the command through
`@orkestrel/guide/server`; its source is [`src/core`](../src/core) and
[`src/server`](../src/server).

## Surface

### Types

The manifest/extraction shapes every check is built from, from [`types.ts`](../src/core/types.ts).
A `Shape` cell lists an interface's property names alone, and a type alias's value.

| Name                     | Kind      | Shape                                                                                                        | Summary                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExportKeyword`          | type      | `'type' \| 'interface' \| 'const' \| 'function' \| 'class'`                                                  | Represents the declaration keyword a documented / exported symbol carries — the reflected `type`, `interface`, `const`, `function`, and `class` heads, derived from `EXPORT_KEYWORDS` so the type, the guard, and the shape name one population. Comment/template payload is excluded before reflection. `enum` is outside this population, not forbidden by general package policy. |
| `SurfaceSymbol`          | interface | `{ name, keyword, summary? }`                                                                                | Represents one documented / exported symbol — its identifier, its declaration keyword, and the description paragraph the guide and the doc block are compared on.                                                                                                                                                                                                                    |
| `GuideModule`            | type      | `string \| readonly string[]`                                                                                | Represents the source scope a guide's manifest entry covers — one module directory, or several when a layer guide spans multiple source directories (a core module plus its backend implementations). `'.'` is the canonical workspace-root directory; empty, trailing-slash, and dot-segment spellings canonicalize to the same value before reflection.                            |
| `SourceLine`             | interface | `{ source, code, jsdoc }`                                                                                    | Represents one terminator-free physical source line and its aligned reflection projections. Every projection has the same length as `source`, and every genuine JSDoc span retains its physical opener column; the final physical line is present even when it is empty.                                                                                                             |
| `SourceComment`          | interface | `{ text, line }`                                                                                             | Represents one eligible genuine JSDoc block paired with the physical record it documents — the block's unwrapped body and the `SourceLine` that follows its chain.                                                                                                                                                                                                                   |
| `MethodEntry`            | interface | `{ name, summary? }`                                                                                         | Represents one documented method — its identifier plus the description paragraph the guide's `Summary` cell and the member's doc block are compared on.                                                                                                                                                                                                                              |
| `SourceExample`          | interface | `{ name, title?, code, language? }`                                                                          | Represents one `@example` block read from a doc comment — the declaration it documents, its pairing title, its code, and its fence language.                                                                                                                                                                                                                                         |
| `DriftCategory`          | type      | `'summary' \| 'example'`                                                                                     | Represents the compared site one disagreement came from.                                                                                                                                                                                                                                                                                                                             |
| `Drift`                  | interface | `{ key, category, guide?, source? }`                                                                         | Represents one disagreement between a guide and the source it documents — the compared key with the text each side carries there, the side carrying no text omitted.                                                                                                                                                                                                                 |
| `ManifestEntry`          | interface | `{ concept, spec, source, tests }`                                                                           | Represents one `## By concept` manifest row — a single guides-parity check target, paths normalized to workspace root.                                                                                                                                                                                                                                                               |
| `ParityPitch`            | interface | `{ readme, spec }`                                                                                           | Names the inventory keys paired for README pitch parity.                                                                                                                                                                                                                                                                                                                             |
| `ParityOptions`          | interface | `{ files, entries, modules, languages, language, pitch? }`                                                   | Represents the pure inputs that configure a guides-parity composition.                                                                                                                                                                                                                                                                                                               |
| `ParityRow`              | interface | `{ entry, guide, source }`                                                                                   | Represents a manifest row joined to its parsed guide and reflected source.                                                                                                                                                                                                                                                                                                           |
| `ParityFinding`          | interface | `{ spec?, text }`                                                                                            | Represents a preformatted guides-parity finding.                                                                                                                                                                                                                                                                                                                                     |
| `ParityExampleResult`    | interface | `{ fences, functions, methods, titles }`                                                                     | Groups executable-example findings by their independent evidence populations.                                                                                                                                                                                                                                                                                                        |
| `ParityResult`           | interface | `{ input, sections, surface, methods, declarations, links, tests, fences, examples, imports, drift, pitch }` | Groups independently assertable guides-parity findings by subject.                                                                                                                                                                                                                                                                                                                   |
| `ParityDirection`        | type      | `'guide' \| 'source'`                                                                                        | Represents the destination an explicit parity rewrite updates.                                                                                                                                                                                                                                                                                                                       |
| `ParityChange`           | interface | `{ path, content }`                                                                                          | Represents a changed inventory text returned by a parity rewrite.                                                                                                                                                                                                                                                                                                                    |
| `ParityRewriteResult`    | interface | `{ changes, findings }`                                                                                      | Represents the changed texts and unresolved findings from an explicit rewrite.                                                                                                                                                                                                                                                                                                       |
| `ParityInterface`        | interface | `{ rows, inspect, document, annotate }`                                                                      | Represents a pure guides-parity composition over caller-supplied inventory.                                                                                                                                                                                                                                                                                                          |
| `MethodGroup`            | interface | `{ interface, methods }`                                                                                     | Represents one behavioral interface a guide's `## Methods` section documents — the H4 heading naming that interface as a code span, and the member entries its table lists.                                                                                                                                                                                                          |
| `FenceImport`            | interface | `{ specifier, names }`                                                                                       | Represents one brace `import` statement projected from a guide fence — its specifier paired with the exported names it binds.                                                                                                                                                                                                                                                        |
| `GuideFence`             | interface | `{ language, code, title? }`                                                                                 | Represents one fenced code block projected from a guide document — its `language` is the fence's info-string tag and is absent when the fence is untagged, and its `title` is the flattened text of its nearest preceding heading.                                                                                                                                                   |
| `GuideInterface`         | interface | `{ sections, tagline, surface, methods, unnamed, links, tests, fences }`                                     | Represents the structured, pure view of one parsed guide — every projection extracted and cached once at construction (see `createGuide`).                                                                                                                                                                                                                                           |
| `SourceInterface`        | interface | `{ exports, surface, methods, exists, hidden, examples }`                                                    | Represents the reflected source truth a guide's documented surface is checked against — a pure view over a consumer-supplied file inventory (see `Source`).                                                                                                                                                                                                                          |
| `SourceManagerInterface` | interface | `{ source, sources }`                                                                                        | Represents a specifier resolver that shares one `SourceInterface` per module and enumerates those views.                                                                                                                                                                                                                                                                             |
| `SourceOptions`          | interface | `{ files, module }`                                                                                          | Represents the construction input for a `Source` — a consumer-supplied file inventory (root-relative path → file text) plus the module scope to reflect. The consumer gathers `files` however their environment allows (`node:fs` in a Node script, `import.meta.glob` in a browser/vitest run) — `Source` itself never touches disk.                                                |
| `SourceManagerOptions`   | interface | `{ files, modules }`                                                                                         | Represents the construction input for a `SourceManager`: one shared file inventory plus the consumer's specifier-to-module policy.                                                                                                                                                                                                                                                   |
| `DeclarationHead`        | interface | `{ text, end }`                                                                                              | Pairs a declaration head joined into a single line with the index of the line carrying its opening `{` — how a head that oxfmt wrapped across lines (printWidth 100) is matched as if it were written on one.                                                                                                                                                                        |
| `Declaration`            | interface | `{ body, bases }`                                                                                            | Represents one located `export class` / `export interface` declaration — the body lines and the base identifiers read from the same head, so a consumer never pairs one declaration's body with another declaration's heritage (see `collectDeclarations`).                                                                                                                          |
| `DeclarationKeyword`     | type      | `'class' \| 'interface'`                                                                                     | Represents which declaration head `collectDeclarations` and `Source` locate — a `class` or an `interface`. That pair is the subset of `ExportKeyword` carrying a body whose members a guide's `## Methods` table documents.                                                                                                                                                          |

The server command contracts come from [`types.ts`](../src/server/types.ts).

| Name                    | Kind      | Shape                                                                                   | Summary                                                                                                |
| ----------------------- | --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GuideReadFunction`     | type      | `(root: URL \| string, targets: readonly string[]) => Readonly<Record<string, string>>` | Reads a workspace inventory through the consumer's host reader.                                        |
| `GuideRunnerOptions`    | interface | `{ root, config, project, reporters, cache, watch }`                                    | Defines the fixed guides-project runner invocation.                                                    |
| `GuideRunnerFunction`   | type      | `(mode: 'test', options: GuideRunnerOptions) => Promise<unknown>`                       | Creates a foreign guides-project runner whose consumed members Guide validates before use.             |
| `GuideCommandContext`   | interface | `{ root, files, rows, report }`                                                         | Supplies fresh owned inventory, joined rows, and its generic parity result to package assertion setup. |
| `GuideCommandHandler`   | type      | `(context: GuideCommandContext) => Promise<void>`                                       | Registers package assertions against the fresh worker context.                                         |
| `GuideCommandOptions`   | interface | `{ root, patterns, modules, languages, language, reader, runner }`                      | Configures workspace policy and direct host ports for the reusable command.                            |
| `GuideCommandInterface` | interface | `{ execute }`                                                                           | Represents the server command's native and worker behavior.                                            |

### Constants

The declaration-keyword population, the section-heading keys, and the external-link schemes every
extractor and link check is keyed on, from [`constants.ts`](../src/core/constants.ts). The server
workflow paths and usage text come from [`constants.ts`](../src/server/constants.ts).

| Name               | Kind  | Value                                                 | Summary                                                                                                                                                                                                                                                                                                       |
| ------------------ | ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPORT_KEYWORDS`  | const | `['type', 'interface', 'const', 'function', 'class']` | Lists the declaration keywords a documented or exported symbol carries, in the order the reflection grammar names them — the frozen population `ExportKeyword`, `isExportKeyword`, and `surfaceSymbolShape` all derive from.                                                                                  |
| `DRIFT_CATEGORIES` | const | `['summary', 'example']`                              | Lists the compared sites a `Drift` can describe.                                                                                                                                                                                                                                                              |
| `SURFACE`          | const | `'Surface'`                                           | Names the `## Surface` heading text a guide's documented exports section is keyed on.                                                                                                                                                                                                                         |
| `METHODS`          | const | `'Methods'`                                           | Names the `## Methods` heading text a guide's documented interface-methods section is keyed on.                                                                                                                                                                                                               |
| `TESTS`            | const | `'Tests'`                                             | Names the `## Tests` heading text a guide's documented test-link section is keyed on.                                                                                                                                                                                                                         |
| `MANIFEST`         | const | `'By concept'`                                        | Names the `## By concept` heading text the manifest's run-map table is keyed on.                                                                                                                                                                                                                              |
| `KIND`             | const | `'Kind'`                                              | Names the header text of the column a `## Surface` table's declaration keyword is read from.                                                                                                                                                                                                                  |
| `SUMMARY`          | const | `'Summary'`                                           | Names the header text of the column a `## Surface` or `## Methods` table's compared description paragraph is read from.                                                                                                                                                                                       |
| `EXTERNAL_SCHEMES` | const | `['http:', 'https:', 'mailto:', 'tel:']`              | Lists the link `href` schemes a guides-parity link check skips as external — a link with one of these prefixes (or a bare `#` anchor, handled separately in `isExternalLink`) is never resolved against the filesystem.                                                                                       |
| `WRAP_WIDTH`       | const | `100`                                                 | Holds the default character budget a rewritten doc block's description paragraph wraps inside — the greatest number of characters a re-wrapped line may carry, counted from the line's first character with a tab counting as one, so a wrapped line reads `${indent} * ${text}` and never passes that count. |

### Server constants

| Name             | Kind  | Value                                                       | Summary                                                                |
| ---------------- | ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GUIDE_INDEX`    | const | `'guides/README.md'`                                        | Names the workspace-relative guide concept index.                      |
| `GUIDE_MANIFEST` | const | `'package.json'`                                            | Names the package manifest read for native pitch selection.            |
| `GUIDE_README`   | const | `'README.md'`                                               | Names the package README paired with its indexed guide pitch.          |
| `GUIDE_USAGE`    | const | `'usage: npm run test:guides [-- --to guide\|--to source]'` | Holds the native command usage text written for unsupported arguments. |

### Helpers

Pure, total leaves from [`helpers.ts`](../src/core/helpers.ts) — the source-line projection,
the declaration, member, JSDoc, and guide-document grammars built on it, and the comparison and
path primitives `Guide`, `Source`, `parsers.ts`, and a consumer's parity test all reach for
directly.

| Name                    | Kind     | Signature                                                                                                                | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compareMembership`     | function | `(spec: string, name: string, documented: readonly string[], declared: readonly string[]) => ParityFinding \| undefined` | Compares documented and declared membership exactly after sorting copies, preserving duplicates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `identifyDrift`         | function | `(spec: string, drift: Drift) => string`                                                                                 | Computes a category-separated identity for a guide finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `formatSide`            | function | `(value: string \| undefined) => string`                                                                                 | Formats present parity text as a JSON string and absent text as `absent`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `formatDrift`           | function | `(drift: Drift) => string`                                                                                               | Formats a categorized drift with its guide and source sides.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `normalizeDirectories`  | function | `(module: GuideModule) => readonly string[]`                                                                             | Normalizes a module scope to its canonical directory list. `'.'` represents workspace root; empty, trailing, and dot-segment spellings reduce through `resolvePath`, and duplicates are removed in first-seen order.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `computeModuleKey`      | function | `(module: GuideModule) => string`                                                                                        | Computes the stable cache key for a `GuideModule`. Directories normalize before joining, so equivalent module spellings share one key. The NUL separator cannot occur in filesystem-backed canonical-segment inventory keys, so no directory boundary can collide with directory text.                                                                                                                                                                                                                                                                                                                                                                                    |
| `selectModuleKeys`      | function | `(files: Readonly<Record<string, string>>, module: GuideModule) => readonly string[]`                                    | Selects the exact opaque file-inventory keys belonging under any canonical `GuideModule` directory, sorted. `'.'` selects canonical root-relative keys without accepting `/`, `./`, or `../` aliases. Every selected exact `index.ts` and every `.test.ts` key is excluded independent of scope order.                                                                                                                                                                                                                                                                                                                                                                    |
| `hasCanonicalSegments`  | function | `(key: string) => boolean`                                                                                               | Checks whether an opaque inventory key contains only canonical slash-separated segments. Empty, `.` and `..` segments are rejected without rewriting the key; ordinary dotfile segments remain valid.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `computeSymbolKey`      | function | `(symbol: SurfaceSymbol) => string`                                                                                      | Computes the bijection key for a surface symbol — `${keyword} ${name}` — so a symbol-set comparison diffs (name, keyword) pairs rather than names alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `findMissing`           | function | `(names: readonly string[], source: readonly string[]) => readonly string[]`                                             | Finds the names present in `names` but absent from `source` — the set-difference behind a both-directions bijection assertion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `findMissingSymbols`    | function | `(symbols: readonly SurfaceSymbol[], source: readonly SurfaceSymbol[]) => readonly string[]`                             | Finds the symbol-key set-difference between two symbol lists — `symbols` present but absent from `source`, compared by `computeSymbolKey` so a symbol can drift in neither name nor keyword.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `extractSourceLines`    | function | `(source: string) => readonly SourceLine[]`                                                                              | Extracts aligned physical source-line records in one character traversal. Real line and block comments and complete template tokens become spaces in `SourceLine.code`, while ordinary code, quoted strings, and recognized regex literals retain their columns. Genuine JSDoc opened from reflection code is retained span by span at its exact physical column in `SourceLine.jsdoc`; faux openers in comments and templates are excluded. Membership remains each consumer's separate anchored grammar.                                                                                                                                                                |
| `extractExports`        | function | `(source: string) => readonly SurfaceSymbol[]`                                                                           | Extracts the module-scope exports declared in one file's source text — the declaration keys `collectKeys` reports, each split back into the keyword and name that built it, deduped by (keyword, name).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `extractHidden`         | function | `(source: string) => readonly SurfaceSymbol[]`                                                                           | Extracts the module-scope declarations lacking the `export` keyword in one file's source text — the mirror image of `extractExports`'s grammar, anchored the same way (column 0, so an indented inner declaration never matches).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `joinHead`              | function | `(lines: readonly string[], start: number) => DeclarationHead \| undefined`                                              | Joins the declaration head starting at `start` into one space-separated line, consuming lines until the first that ends with `{`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `escapeRegExp`          | function | `(value: string) => string`                                                                                              | Escapes every regex metacharacter in a literal string so it reads as text inside a larger `RegExp` source rather than as syntax.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `collectDeclarations`   | function | `(source: string) => ReadonlyMap<string, Declaration>`                                                                   | Collects every `export class` / `export interface` declaration one file's source text declares, each keyed `${keyword} ${name}` and carrying the body lines and the base identifiers read from its own head, so a body and a heritage clause always come from the same declaration.                                                                                                                                                                                                                                                                                                                                                                                       |
| `extractDeclaration`    | function | `(source: string, keyword: DeclarationKeyword, name: string) => Declaration \| undefined`                                | Locates the named `export class` / `export interface` declaration in one file's source text and returns its body lines and its base identifiers read from that one head, so a body and a heritage clause always come from the same declaration, or `undefined` when the file declares no such head.                                                                                                                                                                                                                                                                                                                                                                       |
| `extractMemberMethods`  | function | `(lines: readonly string[]) => readonly MethodEntry[]`                                                                   | Selects the member lines declaring a callable member: plain, `async`, generator (`*`), and optional (`records?(`) methods all count; getters, setters, `static` members, and `#` privates never do (their keyword or `#` breaks the `name(` shape). The grammar is `collectKeys`'s, read once over `extractBodyLines`'s projection of the body, so commented method-like payload never becomes eligible and each member keys to the owner head that projection supplies. Each member carries its own doc block's description paragraph, read through `collectSummaries`; the first declaration of a name answers for it.                                                  |
| `extractSourceComments` | function | `(lines: readonly SourceLine[]) => readonly SourceComment[]`                                                             | Extracts every eligible genuine JSDoc block paired with the physical record it documents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `normalizeComment`      | function | `(comment: string) => string`                                                                                            | Returns the canonical body of one genuine JSDoc span — the `/**` opener, the closing marker, each line's continuation marker, and the block's leading indentation removed, with per-line trailing whitespace trimmed and the surrounding blank lines dropped. A line's own indentation beyond the marker is kept, so an `@example` fence body keeps the shape it was written in.                                                                                                                                                                                                                                                                                          |
| `unwrapComment`         | function | `(comment: string) => readonly string[]`                                                                                 | Unwraps one genuine JSDoc span into one content line per physical line — the `/**` opener, the closing marker, each line's continuation marker, and per-line trailing whitespace removed, with a line's own indentation past the marker kept. The result is aligned with `comment.split('\n')`, so an index found in it addresses the same physical line of the span it was built from, which is what lets a rewrite keep every line it does not replace. `normalizeComment` is this projection joined and trimmed at its ends.                                                                                                                                           |
| `buildComment`          | function | `(lines: readonly string[], indent: string) => string`                                                                   | Builds one genuine JSDoc span from its content lines — the inverse of `unwrapComment`. Each line is emitted at `indent` behind a continuation marker, an empty line as the bare marker so no line carries trailing whitespace, and the leading and trailing empty lines are dropped because the opener and the closer take those physical lines.                                                                                                                                                                                                                                                                                                                          |
| `wrapText`              | function | `(text: string, width: number) => readonly string[]`                                                                     | Wraps one paragraph into greedy lines no longer than `width` characters. Every run of whitespace separates words, and a word longer than `width` takes its own line rather than being split, so a long code token or URL survives the wrap intact.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `normalizeSummary`      | function | `(text: string) => string`                                                                                               | Returns the canonical compared form of a description paragraph. `{@link Target}` and `{@link Target \| label}` become the code token of the target text, or of the label where one is written; a target's module part — the inline import form `import('./module.js').` and TSDoc's package-qualified form `@scope/pkg#` — is dropped first. Every run of whitespace, including a collapsed continuation marker and a line break, becomes one space, the ends trim, and a code span keeps its delimiters while its own boundary whitespace goes. The guide's side and the source's side read through this one form.                                                       |
| `maskFences`            | function | `(text: string) => string`                                                                                               | Returns one doc block's unwrapped text with every fenced body replaced by aligned spaces, so a tag search reads the block's structure and never its example code. A line opening with three or more backticks or tildes opens a body, the first line opening with a run of the same character at least as long closes it, an unclosed body runs to the end, and the marker lines themselves stay. The projection preserves every line and every column, so an index found in it addresses the same character of the text it was built from.                                                                                                                               |
| `collectSummaries`      | function | `(lines: readonly SourceLine[]) => ReadonlyMap<SourceLine, string>`                                                      | Collects the description paragraph of every documented physical record — a doc block's text before its first block tag, in `normalizeSummary`'s compared form — keyed by the record it documents. A record whose block carries no description contributes no entry, so an absent summary stays absent rather than becoming an empty string.                                                                                                                                                                                                                                                                                                                               |
| `extractBodyLines`      | function | `(lines: readonly string[]) => readonly SourceLine[]`                                                                    | Extracts the aligned physical records of a declaration's body, read inside an owner head this function supplies, so a callable member in the body carries the `Owner.member` key `collectKeys` reports for it, and that head's own record opens the projection. A body read on its own carries no head, and the member grammar attaches a member to the head enclosing it.                                                                                                                                                                                                                                                                                                |
| `collectKeys`           | function | `(lines: readonly SourceLine[]) => ReadonlyMap<SourceLine, string>`                                                      | Collects the compared key of every physical record a key names — a `computeSymbolKey` symbol key for a column-zero `export` declaration head, an `Owner.member` key for a one-tab callable member inside one — keyed by the record itself. The owner closes at the first column-zero `}` or at a column-zero `export` declaration carrying another keyword, and a record no key names contributes no entry.                                                                                                                                                                                                                                                               |
| `collectExamples`       | function | `(comment: string, name: string) => readonly SourceExample[]`                                                            | Collects the `@example` blocks one doc block's unwrapped text carries, each named for the declaration or member the block documents. The text after the tag becomes the block's `title`; a body opening with a fence contributes that fence's language and its verbatim body, and a body with no fence contributes its own trimmed text as the code.                                                                                                                                                                                                                                                                                                                      |
| `extractExampleLines`   | function | `(lines: readonly SourceLine[]) => readonly SourceLine[]`                                                                | Selects the next physical record after an eligible genuine JSDoc whose final authoritative span carries an `@example` tag opening a line at its first non-blank column — the `extractSourceComments` walk filtered to the blocks that carry one. Title text is allowed, and `maskFences` keeps a fenced body's own lines out of the search.                                                                                                                                                                                                                                                                                                                               |
| `extractExamples`       | function | `(source: string) => readonly SourceExample[]`                                                                           | Extracts the `@example` blocks carried by the exported declaration heads in one file's source text, each named for the declaration its block documents. Shared adjacency comes from `extractSourceComments` and each block is read by `collectExamples`; head membership is the `collectKeys` key of the documented record under every keyword that grammar admits at column zero, so comment and template payload cannot qualify and the head grammar stays the one every reader here shares. A member key carries a dot and a head key does not, so a member's block belongs to `extractExampleMethods` instead. A head carrying several blocks contributes each.       |
| `extractExampleMethods` | function | `(lines: readonly string[]) => readonly SourceExample[]`                                                                 | Extracts the `@example` blocks carried by the callable members of a declaration body (per `collectKeys`' grammar, the same one `extractMemberMethods` reads), each named for the member its block documents. Shared adjacency comes from `extractSourceComments` and each block is read by `collectExamples`; member membership is the key `extractBodyLines`'s projection gives the documented record.                                                                                                                                                                                                                                                                   |
| `selectSectionBlocks`   | function | `(document: MarkdownDocument, heading: string) => readonly BlockNode[]`                                                  | Selects the block nodes under the named `##` heading, up to the next `##`-or-higher heading (or the document's end) — the section-scoping window `extractSurface` / `extractMethods` walk over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `extractTagline`        | function | `(document: MarkdownDocument) => string \| undefined`                                                                    | Extracts the guide's tagline — the text of the blockquote following the document's H1, with every code span kept as a code span and whitespace collapsed. A heading before the blockquote ends the window, so a blockquote elsewhere in the document is not the tagline.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `extractSurface`        | function | `(document: MarkdownDocument) => readonly SurfaceSymbol[]`                                                               | Extracts every `## Surface` identifier the guide documents — each table row's column 0 code span (the name) paired with its `Kind` column (located by header text), unioned with every H3 entity heading whose trimmed compared inline content is exactly its backticked code-span name, deduped by `computeSymbolKey`. A row with no code-span name has no name to key a symbol on, so this reader skips it and `extractUnnamed` reports it; a row with an unrecognized `Kind` text is skipped. A row also carries its `SUMMARY` column's compared text when the table has that column; a table without it leaves every row's summary absent, which `findDrift` reports. |
| `extractMethods`        | function | `(document: MarkdownDocument) => readonly MethodGroup[]`                                                                 | Extracts one `MethodGroup` per documented behavioral interface in `## Methods` — an H4 with a code span sets the current interface, and the table immediately following becomes its documented methods. A row with no code-span name has no name to key a member on, so this reader skips it and `extractUnnamed` reports it. Each row carries its `SUMMARY` column's compared text when the table has that column.                                                                                                                                                                                                                                                       |
| `collectGroups`         | function | `(document: MarkdownDocument) => ReadonlyMap<TableNode, string>`                                                         | Collects each `## Methods` table keyed to the interface its `####` heading names — an H4 carrying a code span sets the current interface and the table immediately following claims it, so a heading with no table and a table with no heading before it contribute nothing. The map iterates in document order and a node keys itself, so a repeated identical table keeps its own entry.                                                                                                                                                                                                                                                                                |
| `extractUnnamed`        | function | `(document: MarkdownDocument) => readonly string[]`                                                                      | Extracts every `## Surface` or `## Methods` table row whose first cell carries no code span. `extractSurface` and `extractMethods` skip such a row, because a row with no name gives them nothing to key a symbol or a member on, and this projection is what reports the skip. Each entry is the row's cells read through `extractCellText` and joined by `\|`, so a reader can locate the row in the guide; the `## Surface` rows come first, then the `## Methods` rows, each in document order. `GuideInterface.unnamed` caches it.                                                                                                                                   |
| `extractLinks`          | function | `(document: MarkdownDocument) => readonly string[]`                                                                      | Extracts every link href in the guide document, including table cells — a full, depth-first walk of the whole AST.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `extractTests`          | function | `(document: MarkdownDocument) => readonly string[]`                                                                      | Extracts the relative test links declared under `## Tests` — every link href found within that section only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `extractFences`         | function | `(document: MarkdownDocument) => readonly GuideFence[]`                                                                  | Extracts every fenced code block anywhere in the guide document. A full AST walk includes fences nested inside blockquotes and lists, and the same walk carries each fence's nearest preceding heading as its `title` — the key an `@example` block pairs on. A heading's text is flattened, so a title written with a code span pairs with a plain `@example` title.                                                                                                                                                                                                                                                                                                     |
| `collectFences`         | function | `(document: MarkdownDocument) => ReadonlyMap<CodeBlockNode, GuideFence>`                                                 | Collects each fenced code block keyed by its own node, paired with the `GuideFence` `extractFences` reports for it — the node-addressed form a rewrite needs, so a caller that located a fence by title can read that node's source region back from the parser. The map iterates in document order and a node keys itself, so a repeated identical fence keeps its own entry.                                                                                                                                                                                                                                                                                            |
| `isExternalLink`        | function | `(href: string) => boolean`                                                                                              | Checks whether a guides-parity link check skips a link `href` — an external scheme (`EXTERNAL_SCHEMES`) or a bare in-document `#` anchor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `resolveLink`           | function | `(file: string, target: string) => string`                                                                               | Resolves a relative `target` from the directory containing a root-relative declaring `file`. A slashless file belongs to the workspace root; path reduction is delegated to `resolvePath`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `resolvePath`           | function | `(directory: string, target: string) => string`                                                                          | Resolves a relative `target` from a root-relative `directory`, normalizing forward-slash dot segments without filesystem or extension inference. A parent pops only a retained real component; every excess leading parent is preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `findFirstCode`         | function | `(nodes: readonly InlineNode[]) => string \| undefined`                                                                  | Finds the first code-span value by descending an inline node list, following into `emphasis` / `link` / `image` children — the extraction rule behind a Surface or Methods table row's first-column identifier.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `normalizeIdentifier`   | function | `(code: string) => string`                                                                                               | Returns the identifier prefix of a code-span text — everything before its first `<`, trimmed. Guide cells and headings may annotate a generic-parameterized name (`MarkdownHandler<TNode, T>`) for readability, but the bijection key is the bare identifier the source scanner captures, so both sides must normalize the same way.                                                                                                                                                                                                                                                                                                                                      |
| `findColumnIndex`       | function | `(table: TableNode, header: string) => number \| undefined`                                                              | Finds the index of the column whose header text is `header` so a table's columns survive reordering. The match is exact and case-sensitive — a table without that exact header contributes nothing to the projection reading it, so a `## Surface` table with no `SUMMARY` column leaves every row's summary absent and `findDrift` reports each of those rows, never agreement.                                                                                                                                                                                                                                                                                          |
| `extractRowSymbol`      | function | `(table: TableNode, row: number) => SurfaceSymbol \| undefined`                                                          | Extracts one `## Surface` table row's symbol — its column 0 code span as the name, its `KIND` column as the keyword, and its `SUMMARY` column as the compared summary when the table has that column. A row with no code-span name and a row whose `Kind` text is no `ExportKeyword` have no symbol to key, so each returns `undefined`.                                                                                                                                                                                                                                                                                                                                  |
| `extractRowEntry`       | function | `(table: TableNode, row: number) => MethodEntry \| undefined`                                                            | Extracts one `## Methods` table row's entry — its column 0 code span as the name and its `SUMMARY` column as the compared summary when the table has that column. A row with no code-span name has no member to key, so it returns `undefined`.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `extractRowSummary`     | function | `(table: TableNode, row: number) => string \| undefined`                                                                 | Extracts one row's compared summary — its `SUMMARY` column read through `extractCellText` and `normalizeSummary`. A table with no such column and a row whose cell is empty each carry no summary and return `undefined` rather than an empty string, so `findDrift` reports the absence.                                                                                                                                                                                                                                                                                                                                                                                 |
| `extractCellText`       | function | `(cell: readonly InlineNode[]) => string`                                                                                | Extracts compared inline content — the text of a table cell or candidate entity heading flattened with every code span kept as a code span, so \`\` \`Widget\` \`\` reads the same wherever the parity reader compares it. Emphasis drops to its text, a link drops to its text, an image drops to its alternative text, and the markdown parser has already unescaped \`\\\|\`.                                                                                                                                                                                                                                                                                          |
| `buildCell`             | function | `(text: string) => readonly InlineNode[]`                                                                                | Builds one table cell's inline content from its compared text — the inverse of `extractCellText`. A single-backtick run whose text carries no inner backtick and neither a leading nor a trailing space becomes a code span; every other character, a backtick included, becomes literal text, which `renderMarkdown` escapes so the rendered cell parses back to the text this function was given.                                                                                                                                                                                                                                                                       |
| `extractCellLinks`      | function | `(cell: readonly InlineNode[]) => readonly string[]`                                                                     | Extracts the link hrefs within one table cell's inline content, in walk order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `findUnexampled`        | function | `(names: readonly string[], fences: readonly string[], examples: readonly string[]) => readonly string[]`                | Finds the names in `names` that have no example — a fence containing the name at a word boundary in `fences`, or a membership in `examples`, both count as "has an example"; presence-only, fence and JSDoc content are never checked.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `findUnlisted`          | function | `(fences: readonly GuideFence[], languages: readonly string[]) => readonly GuideFence[]`                                 | Finds the fences whose language is absent from the caller's listed languages. Untagged fences are always returned because they have no language to list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `extractFenceImports`   | function | `(fence: string) => readonly FenceImport[]`                                                                              | Parses a fence's brace `import` statements into per-specifier imported identifier names — `import type`, mixed multiline braces, and `x as y` aliases all count, each alias resolved to the exported name `x` because that is the name the checked barrel surface must hold. Brace bindings only: a default, namespace, side-effect, or mixed `import Default, { named }` statement is not surfaced.                                                                                                                                                                                                                                                                      |
| `collectTitles`         | function | `(guide: GuideInterface, source: SourceInterface) => ReadonlyMap<string, SourceExample>`                                 | Collects the titled `@example` blocks a guide's documented surface reaches — the module's exported declaration heads, plus the own members of every documented `class` and `interface` — keyed by title, the first block of a title answering for it.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `computeDrift`          | function | `(key: string, category: DriftCategory, guide: string \| undefined, source: string \| undefined) => Drift \| undefined`  | Computes the drift between one compared key's guide text and source text. A pair agrees only when both sides carry the same text, and every other state is a drift: guide text alone reports the guide's side, source text alone reports the source's, and neither side carrying text reports the key by itself. A side carrying no text is absent from the result, so a documented symbol with no doc block reports as a drift naming the guide's text alone, and a row a table has no `Summary` column for against a declaration with no doc block reports as `{ key }`.                                                                                                |
| `findDrift`             | function | `(guide: GuideInterface, source: SourceInterface) => readonly Drift[]`                                                   | Finds every disagreement between a guide and the source it documents, naming both sites: each `## Surface` row against its declaration's description paragraph, each `## Methods` row against its member's, and the first titled guide fence of a heading against the `@example` block of the same title. An example's compared text is its language on the first line and its body beneath, so a fence that names another language drifts on its own.                                                                                                                                                                                                                    |
| `renderSurface`         | function | `(symbols: readonly SurfaceSymbol[]) => string`                                                                          | Renders a `## Surface` table from the symbols a source declares — a `Name`, `KIND`, and `SUMMARY` table with one row per symbol, the name as a code span, the keyword as its text, and the summary through `buildCell`. A symbol carrying no summary renders an empty cell, which `extractSurface` reads back as an absent summary.                                                                                                                                                                                                                                                                                                                                       |
| `renderMethods`         | function | `(group: MethodGroup) => string`                                                                                         | Renders one `## Methods` group — the `####` heading naming the interface as a code span, then a `Name` and `SUMMARY` table with one row per documented member. A member carrying no summary renders an empty cell, which `extractMethods` reads back as an absent summary.                                                                                                                                                                                                                                                                                                                                                                                                |
| `renderExample`         | function | `(example: SourceExample) => string`                                                                                     | Renders one `@example` block as the guide fence it pairs with — an H3 heading carrying the block's title, then a fence carrying its language and its code. An untitled block renders the fence alone, because a fence pairs on its nearest preceding heading and an untitled block claims none.                                                                                                                                                                                                                                                                                                                                                                           |
| `buildTable`            | function | `(table: TableNode, row: number, column: number, text: string) => TableNode`                                             | Builds a copy of `table` with one cell's inline content rebuilt from `text` through `buildCell`. Every other cell keeps its own nodes, so a rewrite touches the one cell it names and the header and the alignment row travel unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `buildFence`            | function | `(example: SourceExample) => CodeBlockNode`                                                                              | Builds the fenced code block one `@example` block renders as — its code inside a fence carrying its language, and an untagged fence when the block names none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `spliceSpan`            | function | `(source: string, span: MarkdownSpan, replacement: string) => string`                                                    | Splices `replacement` into `source` over the region `span` addresses, and returns the result. The text before the region and the text after it travel byte for byte, so a rewrite that addresses one node's region changes nothing else in the document.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `replaceCell`           | function | `(guide: string, key: string, summary: string) => string \| undefined`                                                   | Replaces one compared cell in a guide's text and returns the whole guide back. `key` names the row the way `findDrift` names it — a `computeSymbolKey` key for a `## Surface` row, an `Owner.member` key for a `## Methods` row — and the row's `SUMMARY` cell becomes `summary`. Only the table's own source region is rewritten, so every byte outside it travels unchanged; a key reaching no cell returns `undefined`, and a row already carrying the summary returns the guide byte for byte.                                                                                                                                                                        |
| `replaceFence`          | function | `(guide: string, title: string, example: SourceExample) => string \| undefined`                                          | Replaces one titled fence in a guide's text and returns the whole guide back. The first fence carrying `title` — the pairing `findDrift` compares on — takes `example`'s language and code. Only the fence's own source region is rewritten, so every byte outside it travels unchanged; a title no fence carries returns `undefined`, and a fence already carrying that body returns the guide byte for byte.                                                                                                                                                                                                                                                            |
| `replaceSummary`        | function | `(comment: string, summary: string, width?: number) => string \| undefined`                                              | Replaces one doc block's description paragraph with `summary` and returns the whole block back. The paragraph is the block's text before its first block tag, and it re-wraps inside `width`; the blank line before the first tag, every tag line, the block's indentation, and its continuation markers all survive. A block already carrying the summary returns byte for byte, and a text that is no doc block and a summary carrying no word each return `undefined`.                                                                                                                                                                                                 |
| `replaceExample`        | function | `(comment: string, example: SourceExample) => string \| undefined`                                                       | Replaces the body of one titled `@example` tag in a doc block's raw text and returns the whole block back. The tag carrying `example`'s title takes a fence of its language and its code; every other tag, the description paragraph, the block's indentation, and its continuation markers all survive. A text that is no doc block, a title no tag carries, and a language or code the emitted three-backtick fence cannot enclose or the doc block cannot hold each return `undefined`.                                                                                                                                                                                |
| `locateComment`         | function | `(text: string, key: string) => MarkdownSpan \| undefined`                                                               | Locates the doc block a compared key attaches to inside one file's text and returns the block's own character region, so a caller can `slice` the block, rewrite it through `replaceSummary` or `replaceExample`, and write the result back through `spliceSpan`. `key` names the pair the way `findDrift` names it — a `computeSymbolKey` key for a declaration, an `Owner.member` key for an interface or class member; the region covers the block's own indentation, and no block carrying the key returns `undefined`.                                                                                                                                               |

The server command leaves come from [`helpers.ts`](../src/server/helpers.ts).

| Name                 | Kind     | Signature                                                                               | Summary                                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `formatGuideFinding` | function | `(finding: ParityFinding) => string`                                                    | Formats one finding with its guide prefix when needed.                                  |
| `matchesGuideResult` | function | `(result: unknown) => boolean`                                                          | Reads an owned foreign result view and accepts passed modules without unhandled errors. |
| `resolveGuideRoot`   | function | `(root: URL \| string) => string`                                                       | Resolves a command root to a native absolute path.                                      |
| `selectGuidePitch`   | function | `(entries: readonly ManifestEntry[], name: string \| undefined) => string \| undefined` | Selects the indexed guide matching a package's bare name.                               |

### Parsers

The manifest coercer, from [`parsers.ts`](../src/core/parsers.ts) — the one scanner that turns
markdown text into typed values, composed out of `helpers.ts`'s leaves.

| Name            | Kind     | Signature                                                           | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseManifest` | function | `(markdown: string, directory: string) => readonly ManifestEntry[]` | Parses a `## By concept` manifest table into its `ManifestEntry` rows — each row's Concept cell (flattened text), Spec / Tests cells (a single link href, resolved against `directory`), and Source cell (every link href, resolved against `directory`; Source links canonicalize through `normalizeDirectories`, one directory collapses to a `string`, and several become a `readonly string[]`). A row missing a concept, spec link, tests link, or source link is skipped as malformed. |

The server argument and package-manifest parsers come from
[`parsers.ts`](../src/server/parsers.ts).

| Name                  | Kind     | Signature                                                   | Summary                                                                                         |
| --------------------- | -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `parseGuideDirection` | function | `(args: readonly string[]) => ParityDirection \| undefined` | Maps the supported `--to guide` and `--to source` arguments to an explicit rewrite destination. |
| `parsePackageName`    | function | `(manifest: string) => string \| undefined`                 | Reads the bare package name from package manifest JSON.                                         |

### Shapers

Declarative `ContractShape` values (from `@orkestrel/contract`) from
[`shapers.ts`](../src/core/shapers.ts) — every documented data type here is non-recursive, so
each shapes directly. A `Shape` cell lists the shaped object's properties with their types.

| Name                 | Kind  | Shape                                                                       | Summary                                                                                                                                 |
| -------------------- | ----- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `surfaceSymbolShape` | const | `{ name: string, keyword: ExportKeyword, summary?: string }`                | Shapes a `SurfaceSymbol` — a documented / exported symbol's `name` paired with its `ExportKeyword` and its optional compared `summary`. |
| `methodGroupShape`   | const | `{ interface: string, methods: readonly MethodEntry[] }`                    | Shapes a `MethodGroup` — a backticked `interface` name paired with its documented `methods`.                                            |
| `methodEntryShape`   | const | `{ name: string, summary?: string }`                                        | Shapes a `MethodEntry` — one documented method's `name` paired with its optional compared `summary`.                                    |
| `sourceExampleShape` | const | `{ name: string, title?: string, code: string, language?: string }`         | Shapes a `SourceExample` — one `@example` block's `name`, its optional pairing `title`, its `code`, and its optional fence `language`.  |
| `driftShape`         | const | `{ key: string, category: DriftCategory, guide?: string, source?: string }` | Shapes a `Drift` — one disagreement's compared `key` with the optional text each side carries there.                                    |
| `manifestEntryShape` | const | `{ concept: string, spec: string, source: GuideModule, tests: string }`     | Shapes a `ManifestEntry` — one `## By concept` manifest row, `source` accepting either a single directory or several.                   |

### Validators

Total from-unknown guards composed from `@orkestrel/contract` combinators, from
[`validators.ts`](../src/core/validators.ts).

| Name              | Kind  | Summary                                                                                                                                                   |
| ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isExportKeyword` | const | Checks whether `value` is one of the documented `ExportKeyword` literals — the guard behind extracting a Surface table's `Kind` cell into a typed symbol. |
| `isDriftCategory` | const | Checks whether `value` names a supported drift category.                                                                                                  |
| `isSurfaceSymbol` | const | Checks whether `value` is a well-formed `SurfaceSymbol` — a `name` string paired with a valid `ExportKeyword`, and an optional `summary`.                 |
| `isMethodGroup`   | const | Checks whether `value` is a well-formed `MethodGroup` — a backticked `interface` name paired with its documented `MethodEntry` rows.                      |
| `isMethodEntry`   | const | Checks whether `value` is a well-formed `MethodEntry` — a `name` string with an optional `summary`.                                                       |
| `isSourceExample` | const | Checks whether `value` is a well-formed `SourceExample` — a `name` and `code` string with an optional `title` and `language`.                             |
| `isDrift`         | const | Checks whether `value` is a well-formed `Drift` — a compared `key` with an optional `guide` and `source` text.                                            |
| `isManifestEntry` | const | Checks whether `value` is a well-formed `ManifestEntry` — a `## By concept` manifest row, its `source` accepting either a single directory or several.    |

### Factories

From [`factories.ts`](../src/core/factories.ts).

| Name                          | Kind     | Signature                                                   | Summary                                                                                                                                                                                              |
| ----------------------------- | -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createGuide`                 | function | `(source: string) => GuideInterface`                        | Creates a structured `GuideInterface` view over one guide's markdown source — parses once and caches its `sections` / `surface` / `methods` / `links` / `tests` / `fences` projections.              |
| `createSource`                | function | `(options: SourceOptions) => SourceInterface`               | Creates a pure `SourceInterface` over a consumer-supplied file inventory — see `Source`.                                                                                                             |
| `createSourceManager`         | function | `(options: SourceManagerOptions) => SourceManagerInterface` | Creates a `SourceManagerInterface` that resolves the consumer's local import specifiers and shares one source view per module.                                                                       |
| `createSurfaceSymbolContract` | function | `() => ContractInterface<SurfaceSymbol>`                    | Compiles the `surfaceSymbolShape` into a `ContractInterface` for `SurfaceSymbol` — a guard, coercing parser, JSON Schema, and seeded generator from one shape declaration (AGENTS.md § Design laws). |
| `createMethodGroupContract`   | function | `() => ContractInterface<MethodGroup>`                      | Compiles the `methodGroupShape` into a `ContractInterface` for `MethodGroup` — a guard, coercing parser, JSON Schema, and seeded generator from one shape declaration (AGENTS.md § Design laws).     |
| `createMethodEntryContract`   | function | `() => ContractInterface<MethodEntry>`                      | Compiles the `methodEntryShape` into a `ContractInterface` for `MethodEntry` — a guard, coercing parser, JSON Schema, and seeded generator from one shape declaration (AGENTS.md § Design laws).     |
| `createSourceExampleContract` | function | `() => ContractInterface<SourceExample>`                    | Compiles the `sourceExampleShape` into a `ContractInterface` for `SourceExample` — a guard, coercing parser, JSON Schema, and seeded generator from one shape declaration (AGENTS.md § Design laws). |
| `createDriftContract`         | function | `() => ContractInterface<Drift>`                            | Compiles the `driftShape` into a `ContractInterface` for `Drift` — a guard, coercing parser, JSON Schema, and seeded generator from one shape declaration (AGENTS.md § Design laws).                 |
| `createManifestEntryContract` | function | `() => ContractInterface<ManifestEntry>`                    | Compiles the `manifestEntryShape` into a `ContractInterface` for `ManifestEntry` — a guard, coercing parser, JSON Schema, and seeded generator from one shape declaration (AGENTS.md § Design laws). |

### Classes

The implementing classes, from [`Guide.ts`](../src/core/Guide.ts),
[`Parity.ts`](../src/core/Parity.ts), [`GuideCommand.ts`](../src/server/GuideCommand.ts),
[`Source.ts`](../src/core/sources/Source.ts), and
[`SourceManager.ts`](../src/core/sources/SourceManager.ts) — each documented in full under its own
heading following this table.

| Name            | Kind  | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Guide`         | class | Presents a pure, structured view over one parsed guide — the documented projections (`sections` / `tagline` / `surface` / `methods` / `unnamed` / `links` / `tests` / `fences`) are extracted once at construction and cached.                                                                                                                                                                                                                                                              |
| `Parity`        | class | Composes generic guide-parity inspection and explicit in-memory rewrites over a caller inventory.                                                                                                                                                                                                                                                                                                                                                                                           |
| `GuideCommand`  | class | Drives native checking and explicit rewrites or registers package assertions in the guides worker.                                                                                                                                                                                                                                                                                                                                                                                          |
| `Source`        | class | Reflects, as a pure `SourceInterface`, a module scope's intentional direct declarations, conventional barrel-reachable surface, and member methods over a consumer-supplied file inventory, using text-only line scanners rather than the TypeScript compiler API or the filesystem. `Source` never touches disk: the consumer gathers the inventory however their environment allows (`node:fs` in a Node script, `import.meta.glob` in a browser/vitest run) and passes it in as `files`. |
| `SourceManager` | class | Resolves a consumer-owned import-specifier policy into pure source views and caches those views by module, so aliases for one module share one entity. Unmapped specifiers remain foreign to the consumer and return `undefined`. `sources()` enumerates the same shared views, one per distinct module the policy maps.                                                                                                                                                                    |

### `Guide`

The implementing class of `GuideInterface`, from [`Guide.ts`](../src/core/Guide.ts). A
pure, structured view over one parsed guide: parses `source` once through
`@orkestrel/markdown` and never touches the filesystem — `Guide` reads only the markdown
text it is given and records nothing about where the guide came from. Every accessor
returns the same cached, readonly array on every call. See [`## Methods`](#methods) for its
public call-signature surface.

### `Parity`

The implementing class of `ParityInterface`, from [`Parity.ts`](../src/core/Parity.ts). It joins
manifest rows to cached `Guide` and `Source` views, reports generic parity findings by subject, and
returns explicit guide- or source-directed changes without touching disk or mutating the caller's
inventory. It uses the existing parsed fence and source-example records, Markdown-backed targeted
guide replacers, and source-comment spans for accumulated writes.

### `GuideCommand`

The implementing class of `GuideCommandInterface`, from
[`GuideCommand.ts`](../src/server/GuideCommand.ts). In a guides worker, `execute` reads fresh
workspace bytes and supplies the resolved root, owned file inventory, joined parity rows, and
generic parity result to the package callback. Outside a guides worker, it accepts no arguments
for a no-write check, `--to guide` to update guide summaries and examples from source, or
`--to source` to update source doc blocks from the guide. A rewrite rereads the workspace before
checking unresolved findings and then runs the real guides Vitest project. Unsupported arguments
print `GUIDE_USAGE`; no-write and rewrite failures preserve a higher existing process exit code.

The `reader` port may throw while gathering the initial or fresh inventory. The `runner` port may
throw while creating the foreign runner or starting its guides project. Guide validates the
foreign runner's callable `start` and `close` members at arrival, keeps their receiver, owns the
result collections it reads, and calls a validated callable `close` in `finally`; it cannot clean
up a value that supplies no callable `close`. Native reader, runner creation, start, validation,
and cleanup exceptions are written to stderr, raise the process exit status, and leave `execute`
fulfilled after native handling. A failed or malformed runner result raises the exit status.
Worker inventory and registration failures escape and reject `execute`.

### `Source`

The implementing class of `SourceInterface`, from [`Source.ts`](../src/core/sources/Source.ts). A
pure reflection over a consumer-supplied file inventory (root-relative path → file text) plus a
module scope. `exports()` inventories direct `type`, `interface`, `const`, `function`, and `class`
declarations in the selected canonical directories' exact opaque module keys over
comment/template-excluded projected code lines; `enum` is outside this reflection population without
being forbidden by general package policy; `surface()` inventories declarations reachable through
each selected directory's conventional root barrel. Both projections are deduplicated by name and
keyword, and sorted by name. Member structure comes from projected lines while raw bodies preserve
JSDoc evidence, and `methods(name)` resolves a declaration's members through its `extends` chain
within the same module scope, reading the first file that declares the name. Every reading derives
once per instance from the immutable inventory and is reused — the `exports` and `surface`
projections on first access, the scope's declaration map on the first `methods` or `examples`
lookup, then each name's members and each example collection under the name it was asked for — so a
whole-guide comparison reads each file once rather than once per compared row. `Source` never uses
the TypeScript compiler API or filesystem; the consumer gathers `files` however its environment
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

| Method     | Returns                    | Summary                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sections` | `readonly string[]`        | Lists the `##` heading names, in document order — the non-vacuousness guard for section presence.                                                                                                                                                                                                                                                                                               |
| `tagline`  | `string \| undefined`      | Returns the text of the blockquote following the document's H1 — the guide's tagline, or `undefined` when a heading intervenes first.                                                                                                                                                                                                                                                           |
| `surface`  | `readonly SurfaceSymbol[]` | Lists every `## Surface` identifier + keyword — table rows union H3 entity headings whose trimmed compared inline content is exactly their backticked code-span name. Each row carries its `Summary` cell, located by header text, when the table has that column.                                                                                                                              |
| `methods`  | `readonly MethodGroup[]`   | Returns one `MethodGroup` per documented behavioral interface in `## Methods`, each row carrying its `Summary` cell.                                                                                                                                                                                                                                                                            |
| `unnamed`  | `readonly string[]`        | Lists every `## Surface` or `## Methods` row whose first cell carries no code span — the rows `surface` and `methods` skip for want of a name, each entry being the row's cells joined by `\|`. Such a row reaches neither projection, so no bijection check can report it and this one names it instead. The `## Surface` rows come first, then the `## Methods` rows, each in document order. |
| `links`    | `readonly string[]`        | Lists every link href in the guide, including table cells.                                                                                                                                                                                                                                                                                                                                      |
| `tests`    | `readonly string[]`        | Lists the relative test links declared under `## Tests`.                                                                                                                                                                                                                                                                                                                                        |
| `fences`   | `readonly GuideFence[]`    | Lists every fenced code block in the whole document, tagged or not, each carrying its nearest preceding heading as `title` — no language filter, so a consumer decides which languages its checks read.                                                                                                                                                                                         |

#### `ParityInterface`

| Method     | Returns                | Summary                                                                                       |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `rows`     | `readonly ParityRow[]` | Lists the manifest rows whose guide text is present, joined to parsed guide and source views. |
| `inspect`  | `ParityResult`         | Inspects the configured inventory and groups generic parity findings.                         |
| `document` | `ParityRewriteResult`  | Updates guide summaries and titled examples from source authority without touching disk.      |
| `annotate` | `ParityRewriteResult`  | Updates source doc-block summaries and examples from guide authority without touching disk.   |

#### `GuideCommandInterface`

| Method    | Returns         | Summary                                                                                         |
| --------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `execute` | `Promise<void>` | Runs the native command or registers package assertions with fresh worker inventory and parity. |

#### `SourceInterface`

| Method     | Returns                    | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exports`  | `readonly SurfaceSymbol[]` | Lists every direct declaration in the selected module keys matching `export (async )?(function*?\|class\|const\|interface\|type) Name`, by (name, keyword).                                                                                                                                                                                                                                                                                                                                                               |
| `surface`  | `readonly SurfaceSymbol[]` | Lists every declaration reachable from each selected module's conventional root `index.ts` through complete relative `.js` `export *` rows. Unlike `exports`, this inventories barrel reachability rather than all intentional direct declarations under the selected directories.                                                                                                                                                                                                                                        |
| `methods`  | `readonly MethodEntry[]`   | Returns the call-signature members of the `class` / `interface` named `name`, unioned with those of every declaration it extends within the module scope, each with its own doc block's description paragraph. The first file declaring the name answers for it.                                                                                                                                                                                                                                                          |
| `exists`   | `boolean`                  | Checks whether a workspace-root-relative path names a file or a directory present in the inventory.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `hidden`   | `readonly SurfaceSymbol[]` | Lists every module-scope declaration lacking the `export` keyword — the export-discipline reflection `.claude/rules/architecture.md` § Barrel exports states — across the same projected physical code lines and declaration keywords as `exports`. Comment/template payload and `enum` are outside this population; projection preserves physical columns but does not widen the uninterrupted column-zero declaration-head grammar. This does not forbid enums by general package policy. Empty on a conforming module. |
| `examples` | `readonly SourceExample[]` | Lists every `@example` block carried by an exported declaration head — a `type`, `interface`, `const`, `function`, or `class` head at column zero — whose next-physical-record eligible genuine JSDoc chain ends in a span holding an `@example` tag opening a line at its first non-blank column. Each block carries its title, its fence language, and its code; intervening material severs association. A member's block belongs to the `name` overload instead.                                                      |

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

| Method    | Returns                        | Summary                                                                                                                                                   |
| --------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`  | `SourceInterface \| undefined` | Resolves a mapped specifier to the shared source view of the module it names, and returns `undefined` when the policy does not map it — a foreign import. |
| `sources` | `readonly SourceInterface[]`   | Lists one shared source view per distinct module the policy maps, in first-seen specifier order, sharing the same per-module entities `source` returns.   |

## The extraction model

`Guide` parses a guide's markdown once (through `@orkestrel/markdown`'s `createMarkdown`) and
caches its projections at construction — `sections`, `tagline`, `surface`, `methods`, `unnamed`,
`links`, `tests`, `fences` — so every accessor is a cheap array return, not a re-parse.
`extractSurface` scopes to the `## Surface` section (`selectSectionBlocks`) and unions its sources
of identifiers: every table's column-0 code span (keyword read from the column whose header text
is `Kind`, located positionally so it survives reordering) and every H3 entity heading whose
trimmed compared inline content is exactly its backticked code-span name (a class documented
outside a table, keyword fixed to `'class'`). Surrounding spaces, emphasis, and links preserve
that identity. `extractSurface` refuses a heading carrying any other visible text or an additional
code span. Surface entries retain encounter order and deduplicate by name + keyword: the
first-seen entry wins, so a genuine entity heading before its matching class row keeps the
summary-less heading entry, while a table row before that heading keeps its `Summary`; the same
name under another keyword remains distinct. `extractMethods` scopes to
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

The guide's side and the source's side read into one form. `extractSurface` and `extractMethods` locate
the compared column by its header text, `Summary`, exactly as they locate `Kind`, and read that cell
through `extractCellText` and `normalizeSummary`. `extractSourceComments` walks the aligned
`SourceLine` records once, pairs each eligible genuine JSDoc block with the physical record it
documents, and every doc-block reader is a projection of that one walk: `collectSummaries` for the
description paragraph, `collectExamples` for the `@example` blocks, and `extractExampleLines` for the
records an `@example` documents. `extractTagline` reads the blockquote following the H1, and
`extractUnnamed` returns the `## Surface` and `## Methods` rows `extractSurface` and
`extractMethods` skip for want of a code-span name.

One transform reads both sides, so its clauses are stated once and each fires wherever its input
occurs rather than on a side reserved for it:

- Every single-backtick code span — one backtick per side, no inner backtick, no adjacent backtick — is located, before any other clause runs.
- `{@link X}` and `{@link A.b}` become the code token of the target text, outside a located span.
- A target's module part — the inline import form `import('./module.js').` and TSDoc's package-qualified form `@scope/pkg#`, each a package or path token, one carrying `@` or `/` — drops, so `{@link @scope/pkg#A.b}` becomes the code token of `A.b`, outside a located span.
- `{@link Owner#member}` and `{@link #member}` travel whole — a `#` that no `@` or `/` precedes is JSDoc's member reference rather than a module part — so a guide cell documents each as written, outside a located span.
- `{@link X | text}` becomes the code token of `text`, outside a located span.
- Emphasis — `**text**` and `_text_` — drops to its text.
- A link, `[text](target)`, drops to `text`.
- An image, `![text](target)`, drops to its alternative text.
- `\|` unescapes.
- Every run of whitespace, a continuation marker and a line break included, collapses to one space.
- The leading and trailing whitespace trims.
- A code span stays a code span, and the whitespace at each end of a located span's own content trims; a span whose content is all whitespace keeps one space.

Nothing else is transformed. Emphasis, a link, an image, and `\|` are markdown syntax the parser
resolves, so those clauses reach only a guide cell; `{@link Widget}` is ordinary text, so a guide cell carrying that token
rewrites to `` `Widget` `` exactly as a doc block's paragraph does, while the same token written
inside a code span stays literal on both sides. The `extractCellText` function
reads the markdown nodes and `normalizeSummary` reads the text tokens, and both sides end in
`normalizeSummary`.

The order is what makes the clauses agree. Locating spans first keeps a delimiter the `{@link}`
expansion inserts from reading as an authored one; trimming a span's boundary last, after the
whitespace collapse, judges a span wrapped across two physical lines on the characters the parser
judged. The trim is symmetric because the markdown parser is not: it strips one space from each end
of a code span only when both ends carry one, so trimming every boundary space on the source side
is the rule that meets a guide cell however it was written.

A code span delimited by more than one backtick sits outside the compared form and travels
untouched, as does a code span whose own text carries a backtick. The form spells every span with
one backtick per side, so neither can be written back: a summary carrying either cannot converge,
and the construct belongs in prose instead.

The compared unit is the description paragraph, not its first sentence: on the source side the doc
block's text from its opening to its first block tag, and on the guide side the `Summary` cell. A
block tag opens a line whose first non-blank character is `@`, so a tag written past one space after
the continuation marker still ends the paragraph and still reads as a tag. A line inside a fenced
body is example code rather than block structure, so it opens no tag: a body runs from a line
opening with three or more backticks or tildes to the first line opening with a run of the same
character at least as long, and `maskFences` replaces its characters with aligned spaces before
every tag search reads the block.
`@param`, `@returns` and the `Returns` column, `@remarks` and narrative, and the H1 tagline are
outside the comparison — `tagline()` reads the tagline for a package that compares it against its own
README, and it gains a partner to compare against when a source declares `@packageDocumentation`.
`Shape`, `Signature`, `Value`, and `Returns` are guide-only data columns and stay unread.

Examples pair by title. A `GuideFence` carries the flattened text of its nearest preceding heading as
`title`, a `SourceExample` carries the text after its `@example` tag, and a block claims the fence of
the same title. A heading's text is flattened, so a title written with a code span pairs with a plain
`@example` title. The pairing is per title across the whole document, not per heading: the first
fence a title reaches is the compared one, and every later fence of that title is outside the
comparison, whether it sits under the same heading or under a second heading of the same text. A
heading can therefore carry a setup fence and a result fence, and only the first answers for the
title. The bodies compare after `normalizeComment` removes the continuation marker and the
block's leading indentation and trims per-line trailing whitespace, and the fence language compares
with them: an example's compared text is its language on the first line and its body beneath. An
untitled `@example` keeps its presence role for `findUnexampled`.

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
each later span replaces the earlier one and is authoritative. Only an `@example` tag opening a line
at its first non-blank column qualifies; same-line title text is allowed. Source material between or after spans
severs association, a leading JSDoc on the next line replaces pending state, and any other next
physical record is returned once as the candidate. `extractExamples` and `extractExampleMethods` share this
adjacency parser and apply their distinct declaration-head and callable-member grammars only to
`code`. `extractExamples` dedupes by name and title, so a `type` and a `const` sharing one name
contribute the first block of a title rather than one block each.
`collectTitles` reads a module's head blocks before its documented members' blocks, so where a head
and a member carry one title the head's block answers.

Across the `.ts` module keys under each selected directory, excluding its root `index.ts` and
every `*.test.ts`, `collectKeys` matches
`^export (?:async )?(function\*?|class|const|interface|type) (\w+)` per projected line and keys that
line by `computeSymbolKey`; `extractExports` reads those keys, splits each at its one space, and
dedupes by (keyword, name). `collectKeys` is the package's one key grammar, and `extractExports`,
`extractExamples`, `extractMemberMethods`, `extractExampleMethods`, and `locateComment` each read
their own part out of the same map, so a change to the head shape or to the member shape reaches
every one of them. A column-zero `export` declaration carrying another keyword closes the owner
it follows, the same way a column-zero `}` does. `extractHidden` applies the same
declaration-keyword head grammar without `export`. Comment and
template payload, enums, `let`, `var`, and other TypeScript declaration forms are outside these
populations; enum exclusion describes reflection scope, not a general package-policy ban.
`collectDeclarations` reads a file's real `export class` / `export interface` heads and their exact
column-zero closes from one projection of it (joining an oxfmt-wrapped signature through
`joinHead`), and returns each head's aligned raw body and its `extends` bases as one `Declaration`,
keyed `${keyword} ${name}`. One collector is what keeps a body and a heritage clause on the same
declaration. The identifier is the head's own run up to its generic parameter list or its heritage
clause, so it enters the key as literal text: a name carrying a regex metacharacter reaches no
`RegExp`, and a lookup of that name matches the character rather than a wildcard. A head that opens
no column-zero close records nothing, and a later head of a key already collected adds nothing.
`extractDeclaration` is the named lookup over that map: it spells the `${keyword} ${name}` key so a
consumer reading one name never writes that convention, and it collects the file afresh on every
call. A consumer reading many names from one file calls `collectDeclarations` once and reads the
map, and `Source` holds one such map per module scope. `extractMemberMethods` projects that body
once through `extractBodyLines`, which reads it inside an owner head so each member keys to its
owner, and `collectKeys` matches `^\t(?:async )?\*?(\w+)\??(?:<.*>)?\(` against those body lines —
plain / `async` / generator / optional methods count; getters, setters, `static` members, and `#`
privates never match (their keyword or sigil breaks the `name(` shape), and `constructor` is
filtered out of `Source.methods`. Every balanced `<...>` span is removed from the head before its
`extends` clause is read, so a `T extends Base` type parameter never reads as a base and `Base<T>`
reads as `Base`, and a class's `implements` clause is excluded. `Source.methods(name)` unions the
located declaration's own members with those of every declaration it extends, following each base
through the same module scope and keeping the keyword it started from — an interface chain resolves
through interfaces, a class chain through classes, so an interface extending a name only a class
declares gets nothing from it. One declaration answers for a name: the module scope's files are read
in sorted key order, and the first one whose located head has a body or has bases supplies both the
members and the bases; a head with neither a body nor bases does not count as declared, so an empty
`export interface X {}` is skipped and the scan continues to a later file or falls through to a
same-named class, and a second file declaring the same name after one is found adds nothing. The
inventory is the further bound: a base the selected directories do not declare, whether it is
imported from another package or written as a qualified name such as `external.Store`, contributes
no members and is not an error, and one visited set per call collapses a cycle and a diamond to a
single visit. `Source.examples(name)` is deliberately asymmetric with it — it reads only the named
declaration's own body, under each keyword, and follows no `extends` clause, so an inherited
member's `@example` belongs to the base that declares it. `selectModuleKeys` scopes the inventory to
one `GuideModule`'s `.ts` files, excluding each scope directory's own `index.ts` and any `*.test.ts`
file. `Source.hidden()` mechanically asserts the export-discipline rule
`.claude/rules/architecture.md` § Barrel exports states, and catches a hidden declaration-keyword
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
- **RN — Row naming.** `guide.unnamed()` keeps every `## Surface` or `## Methods` row whose first
  cell carries no code span. `extractSurface` and `extractMethods` key a row on that code span, so a
  row without one enters neither `guide.surface()` nor a `MethodGroup`, no bijection leg can report
  it, and this check names the row instead of letting it go in silence. A finding is the row's cells
  read through `extractCellText` and joined by `` ` | ` ``. Guard: RN reads table rows, so a guide
  documenting its surface with backticked H3 entity headings and no `## Surface` table gives RN
  nothing to read, and SB's `guide.surface().length > 0` covers that surface instead.
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
  authoritative span carries an `@example` tag opening a line at its first non-blank column, with
  optional title text,
  (`source.examples()` / `source.examples(name)`).
  Applies to every `function`-keyword `Surface` symbol and every `MethodGroup` member.
  Presence-only — fence and JSDoc **content** are never checked. `findUnexampled` is the
  comparison. Guard: the SB/MB extractions this check reuses already prove non-vacuous.
- **SQ — Surface summary equality.** For every symbol both `guide.surface()` and `source.surface()`
  carry, the guide row's `Summary` cell equals the declaration's description paragraph. A pair agrees
  only when both sides carry the same text: guide text alone reports the guide's side, source text
  alone reports the source's, and neither side carrying text reports the key by itself — never as
  agreement. A table with no `Summary` column therefore reports every row it documents, and a package
  adopting SQ cannot pass it vacuously. `findDrift` is the comparison. Guard: the SB extractions
  this check reuses already prove non-vacuous.
- **MQ — Methods summary equality.** The same comparison per `MethodGroup`, over the members
  `group.methods` and `source.methods(group.interface)` both carry, keyed `Owner.member`.
- **EQ — Example equality.** Every titled guide fence against the `@example` block of the same title,
  body and fence language together. The block is an exported declaration head's own — a `type`, `interface`,
  `const`, `function`, or `class` head at column zero — or a documented `class` or `interface`
  member's, so a head's titled block is compared the way a member's is. The pairing is per title
  across the document, not per heading: the
  first fence a title reaches is the compared one, and every later fence of that title is outside the
  comparison, whether it sits under the same heading or under a second heading of the same text. A title one side alone carries is outside
  the comparison too, and an untitled `@example` stays EX's presence evidence.
- **RQ — README pitch equality.** The blockquote under the README's H1 equals the guide's
  tagline, both read through `createGuide(text).tagline()`. The pair is outside `findDrift`, which
  compares a guide against its source: the drop-in's README case is the gate, and the direct
  `npm run test:guides` entry reports the pair beside the drift rows and never writes it. Guard: both sides read a defined
  tagline before the comparison, so a README without a blockquote reddens rather than passing on
  `undefined`.
- **FI — Fence-import reality.** Every `import { ... } from 'specifier'` in a `guide.fences()`
  fence of the checked language, for a **self** specifier (this repo's own package name / path
  alias), imports only names that exist in `source.surface()`. `extractFenceImports` parses the
  statement; `findMissing` diffs the imported names against the public/barrel surface's names.
  Guard: the comparison runs against at least one resolved import.

SQ, MQ, and EQ share one function: `findDrift(guide, source)` returns every disagreement with both
sites, so a package's whole equality gate is `expect(findDrift(guide, source)).toEqual([])`. It
compares only the pairs both sides carry, so a symbol, a member, or a title one side lacks is left to
the bijection check that owns it and is never reported twice.

Permanent controls bind the SB population boundaries through production `Source`, `Guide`,
`findMissingSymbols`, and `computeSymbolKey`: a stranded direct declaration must be missing from the barrel;
a phantom Guide row must be missing from the barrel; keyword drift must fail in both barrel/Guide
directions; a barrel-only declaration outside `selectModuleKeys()` must be missing from direct exports;
a correlated commented declaration must remain absent from direct and barrel populations while
failing Guide-to-barrel; and a workspace-root `index.ts` hop must reach its real terminal symbol.

## The renderers and the replacers

The core readers say where a guide and its source disagree; the core renderers and replacers carry
a change across. These core leaves return text and write nothing, so the worker gate that reads
`findDrift` calls no writer. The server `GuideCommand` gathers host inventory and writes only for an
explicit `npm run test:guides -- --to guide` or `--to source` request.

`renderSurface`, `renderMethods`, and `renderExample` produce fresh guide text from source
entries — a `Name` / `Kind` / `Summary` table, a `####` group and its `Name` / `Summary` table,
and a titled fence. Each builds a markdown node and renders it through the parser's own
`renderMarkdown`, so the text it returns is the text the package parses back. Each renders the
block a guide section contains rather than the section itself, because a guide documents its
surface in several tables under their own sub-headings: reading a render back therefore parses it
under the section heading its caller supplies, so `extractSurface` reads
`'## Surface\n\n' + renderSurface(symbols)` back to the symbols it was rendered from, and
`extractMethods` reads `'## Methods\n\n' + renderMethods(group)` back to the group.
`renderExample` needs no such heading, because `extractFences` scopes a fence to no section. The
render is one-space padded whatever the committed guide's column alignment was, so the checkout's
own formatter re-aligns it and the comparison stays on parsed entries rather than on bytes.

`replaceCell` and `replaceFence` rewrite one node inside a guide that already exists. Each locates
its node through the readers — `extractRowSymbol` and `collectGroups` for a row, `collectFences`
for a fence — reads that node's source region from the parser's provenance, rebuilds the node, and
splices the render over the region through `spliceSpan`. Only the located node's own region is
rewritten, so every byte of the guide outside it travels unchanged.

`replaceSummary` and `replaceExample` rewrite one doc block's raw text — its description paragraph,
or the body of the `@example` tag carrying a given title. `locateComment` is how a caller finds
that block: it takes a file's text and a compared key and returns the block's own character region,
which the caller slices, hands to a replacer, and splices back through `spliceSpan`. `unwrapComment`
gives one content line per physical line, so the rewrite addresses the lines it replaces and keeps
every other line: the tag lines, the blank separator before the first tag, the block's indentation,
and its continuation markers. A replaced description re-wraps inside the caller's `width`, defaulting
to `WRAP_WIDTH`, because a doc block's own wrapping is not recoverable from its text.

Every replacer reports a miss the same way. `undefined` means "not replaced", and it covers a key
that reaches no row, a table carrying no `Summary` column, a title no fence or tag carries, a text
that is no doc block, a summary carrying no word, and a language or code the emitted three-backtick
fence cannot enclose or the doc block cannot hold — a body carrying `*/`. A caller reports the key
it could not place instead of writing a file it could not read back.

Every replacement whose target already carries the value returns its input byte for byte. That is
what lets a package run the propagation over a tree that has no drift and see no file move: a
re-render would re-pad a table and a re-wrap would move most doc blocks, and neither is a change
anyone asked for. The identity reads both sides through the compared form, so handing a replacer
text the form still moves writes once and is a fixed point on the next run.

The caller's named destination governs summaries and examples alike. The `guide` destination copies
source text into the guide. The `source` destination copies guide text into the source.
The gate reports and never writes in core; neither the core readers nor renderers decide. The
server command alone applies the caller's explicit destination to host files.

## The core file-inventory model

Neither `Guide` nor `Source` ever imports `node:fs` or any other I/O primitive — `Source`'s
construction input (`SourceOptions.files`) is a plain `Readonly<Record<string, string>>` the
**consumer** gathers however their runtime allows: a recursive `node:fs` walk in a Node vitest
run, `import.meta.glob('/**/*.ts', { eager: true, query: '?raw', import: 'default' })` in a
browser/vitest run, or a static bundle in any other environment. This keeps the core
environment-agnostic while every check still runs against real, on-disk truth in the consumer's
own test. The server command supplies a Node host shell over that core contract. The inventory must
include each selected module's root `index.ts` and every
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
source.methods('GuideInterface') // [{ name: 'sections' }]
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

### Compare a guide against the source it documents

```ts
import { createGuide, createSource, findDrift } from '@orkestrel/guide'

const guide = createGuide(
	'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |',
)
const source = createSource({
	files: {
		'src/core/index.ts': "export * from './helpers.js'\n",
		'src/core/helpers.ts': '/**\n * Walks a tree.\n */\nexport function walk(): void {}\n',
	},
	module: 'src/core',
})

// One entry per disagreement, naming both sites; a symbol one side lacks belongs to SB.
findDrift(guide, source) // [{ key: 'function walk', category: 'summary', guide: 'Walks the tree.', source: 'Walks a tree.' }]
```

### Compare declaration membership

```ts
import { compareMembership } from '@orkestrel/guide'

compareMembership('guides/widget.md', 'WidgetInterface', ['open'], ['open']) // undefined
```

### Identify categorized drift

```ts
import { identifyDrift } from '@orkestrel/guide'

identifyDrift('guides/widget.md', { category: 'summary', key: 'function open' })
// 'guides/widget.md\nsummary\nfunction open'
```

### Format a parity side

```ts
import { formatSide } from '@orkestrel/guide'

formatSide('Walks.') // '"Walks."'
formatSide(undefined) // 'absent'
```

### Format categorized drift

```ts
import { formatDrift } from '@orkestrel/guide'

formatDrift({ category: 'summary', key: 'function walk', guide: 'Walks.', source: 'Walks a tree.' })
// 'summary function walk: guide "Walks." source "Walks a tree."'
```

### Inspect and rewrite a caller-owned inventory

```ts
import { Parity } from '@orkestrel/guide'

const parity = new Parity({
	files,
	entries,
	modules: { '@scope/package': 'src/core' },
	languages: ['ts'],
	language: 'ts',
})

parity.rows()
parity.inspect()
parity.document()
parity.annotate()
```

### Run the shared server command

```ts
import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md'],
	modules: { '@scope/package': ['src/core', 'src/server'] },
	languages: ['ts'],
	language: 'ts',
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, root, rows }) => {
	const { expect, it } = await import('vitest')
	it('checks the documented inventory', () => {
		expect(root.length).toBeGreaterThan(0)
		expect(Object.keys(files).length).toBeGreaterThan(0)
		expect(rows.length).toBeGreaterThan(0)
		expect(report.input).toEqual([])
	})
})
```

### Carry a summary across into the guide

```ts
import { replaceCell, replaceSummary } from '@orkestrel/guide'

const guide =
	'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |'

// The guide's text back, with that one cell replaced and every byte outside the table unchanged.
replaceCell(guide, 'function walk', 'Walks a tree.')
// '## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks a tree. |'
replaceCell(guide, 'function phantom', 'Absent.') // undefined — no row carries that key
replaceCell(guide, 'function walk', 'Walks the tree.') === guide // true — the row already carries it

// The other direction: one doc block's raw text, its description paragraph replaced.
replaceSummary('/** Walks the tree. */', 'Walks a tree.') // '/** Walks a tree. */'
```

### Read a guide's tagline

```ts
import { createGuide } from '@orkestrel/guide'

const guide = createGuide('# Widget\n\n> A widget toolkit.\n\n## Surface\n')
guide.tagline() // 'A widget toolkit.'
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

This repository runs the catalog against itself. Its `tests/guides.test.ts` wires RN, SB, MB, LI,
TE, NV, FL, EX, FI, SQ, MQ, EQ, and RQ. Every `## Surface` and `## Methods` table here heads its
compared column `Summary`, so `findDrift` reads every row this guide documents and the equality
case asserts the whole worklist empty; `Kind`, `Shape`, `Signature`, `Value`, and `Returns` are the
data columns beside it and stay unread. EQ compares a `## Patterns` fence only where an `@example`
block carries the same title, so a fence composing several symbols, a fence whose body a
three-backtick doc-block fence cannot enclose, a fence whose body carries the doc-comment
terminator `*/`, and a class's constructor-door block stay outside it; a case beside the equality
one pins that at least one title pairs, so retiring the example half reddens the suite. Converge
source authority into guides with `npm run test:guides -- --to guide`, or guide authority into
source with `npm run test:guides -- --to source`; never weaken the case.

- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — direct `SourceLine`, lexical, and JSDoc-alignment invariants; projected declaration-keyword direct/hidden reflection; genuine JSDoc example adjacency and faux JSDoc exclusion; every guide-document extractor; the compared form clause by clause on both sides; the `Summary` locator over a reordered header and a table without the column; the nameless-row finding against a name the reader reads through emphasis; a block tag written past one space after the continuation marker, and a tag-shaped line inside a fenced body left to the example code; the fenced-body projection `maskFences` returns; fence titles and the tagline; `findDrift` with a negative control drawn from the symbols the bijection legs already report, a planted disagreement of each kind, and a later fence under one heading left outside the comparison; the doc-block reader against `parseSync`'s own reading, which names the shape the reader misses; the compared cell built back from its text, over every doc-block summary this package ships; the compared form's code-span clause converging a padded, a one-sided, and an all-whitespace span from either side, leaving a link token inside a span literal, and leaving a multi-backtick span untouched; the corpus this package ships carrying a floor of blocks, read at its raw spans through the aligned JSDoc projection and checked against the blocks `extractSourceComments` attaches; the renderers round-tripping through the readers that own them and the render read the same as the column-aligned committed form; each replacer's located node rewritten with every byte outside it unchanged, its miss returning `undefined`, and its identity case byte-stable over every described doc block this package ships and a fixed point on the second run, with a control from outside each replacer's membership; the one key grammar `collectKeys` reports over the control fixtures and a member fixture, its owner closing at a column-zero brace, and the keyword and member name each reader splits back out of it; `locateComment` over an overload set, a member key, an owner closed at its brace, a CRLF file, and the shapes the attaching reader misses, then a rewrite spliced back and read through `collectSummaries`, and every `Owner.member` key this package's own source declares located back to the block carrying that member's summary; canonical-key, runtime-name, `resolvePath`, and `resolveLink` invariants; all remaining helper leaves.
- [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts) — `parseManifest` row parsing, malformed-row skipping, one-versus-many Source canonicalization, and nested manifest directories.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — `isExportKeyword` / `isSurfaceSymbol` / `isMethodEntry` / `isSourceExample` / `isDrift` / `isMethodGroup` / `isManifestEntry`.
- [`tests/src/core/shapers.test.ts`](../tests/src/core/shapers.test.ts) — per-shape guard exactness, JSON Schema essentials, seeded generate round-trips, parse rebuilds.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createGuide` / `createSource` + the compiled symbol, entry, example, drift, group, and manifest contracts.
- [`tests/src/core/Guide.test.ts`](../tests/src/core/Guide.test.ts) — `Guide`'s cached projections, its tagline, its nameless rows, and its fence titles, and production barrel/Guide phantom and keyword-drift controls.
- [`tests/src/core/sources/Source.test.ts`](../tests/src/core/sources/Source.test.ts) — direct/barrel projections, lexical and JSDoc regressions, canonical-key populations, root and nested indexes, exact row grammar, graph invariants, and correlated population controls.
- [`tests/src/core/sources/SourceManager.test.ts`](../tests/src/core/sources/SourceManager.test.ts) — `computeModuleKey` boundary collision, specifier resolution, the `undefined` skip for an unmapped specifier, array-valued module scopes, `sources()` enumeration, and per-module entity sharing with a differently-scoped identity control.
- [`tests/src/server/GuideCommand.test.ts`](../tests/src/server/GuideCommand.test.ts) — direct installed reader and runner ports, fresh worker context, registration rejection, real runner cleanup after start failure, cleanup failure reporting, and higher native exit preservation.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — finding formatting, native and file-URL root resolution, pitch selection, and owned foreign-result reading with live receivers.
- [`tests/src/server/parsers.test.ts`](../tests/src/server/parsers.test.ts) — native direction arguments and package-name parsing.
- [`tests/fixtures/broken/stranded-export`](../tests/fixtures/broken/stranded-export) — permanent negative control: its guide and direct declarations agree while its conventional barrel omits `strandedExport`.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — the drop-in guides-parity suite, run against **this** repository's own `guides/README.md` manifest — the self-dogfooding acceptance criterion.

## See also

- `AGENTS.md` (workspace root) — the rules; `.claude/rules/documentation.md` § Parity states the documentation-as-contract law.
- [`README.md`](README.md) — the guides index.
