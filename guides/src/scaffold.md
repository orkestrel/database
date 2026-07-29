# Scaffold

> A deterministic workspace-blueprint compiler: a closed, JSON-serializable `Blueprint` compiles
> into a `Plan` of ordered `Artifact`s, and every downstream product — the files on disk, a review
> document, an audit of an existing package, a freshness report — is projected from that one plan
> rather than authored separately.
>
> The core face is pure and synchronous: no `node:*`, no clocks, no randomness, no I/O. A plan's
> `trace` and `hash` derive from its own content. The server face owns the only two impure
> entities — `Materializer`, which writes a plan to disk behind an explicit call, and `Sync`,
> which reads upstream guides and registry versions over HTTPS. The `scaffold` executable is a
> thin command-line shell around both.
>
> Every discriminant names its own axis. `origin` says how an artifact's content is produced,
> `group` says which artifact group it belongs to, `environment` says which environment owns it,
> `category` says what a declared member is, `drift` says how a target compares to its plan,
> `freshness` says how a mirror compares to upstream, `stage` says which pipeline phase ran, and
> `code` says which coded failure was raised.
>
> Source: [`src/core`](../../src/core) and [`src/server`](../../src/server), with
> [`src/bin`](../../src/bin) as an executable build target. Core exports through
> `@orkestrel/scaffold`; the materializer and sync export through `@orkestrel/scaffold/server`.

Standing up — or auditing — a workspace in this style is a mechanical projection of a fixed set of
conventions onto a name: the exports map for the selected src environments, the per-environment build
configuration, the barrels, the test projects, the guide stubs, the parity harness. This package is
that projection, expressed as data. Rendered defaults ship as versioned package data (frozen
`TemplateDefinition` values filled by a pure fill engine), so a convention change is a version bump
here rather than a hand edit in every workspace.

The module is mechanism, never product policy. The judgment calls — the name, the description, the
keywords, which src and app environments, which dependencies, any artifact override —
belong to the caller. What this module supplies is the closed vocabularies, the variant matrix as
data, exact-record validation, a fail-closed gate, a deterministic pin, and lossless projections.

Separating the _what_ (the `Blueprint`) from the _how_ (the `Plan` and its writes) is the whole
design. Because the plan and the audit are pure data, the same engine that creates a workspace can
audit an existing one — `diffPlan` against its current bytes — and repair only what drifted. And
because vendored dependency mirrors and pinned ranges themselves fall behind as upstream moves,
`Sync` reports (and, under an explicit apply, refreshes) what has aged.

## Faces and dependency direction

The package has three code faces. Generated workspaces use the separate `Environment` vocabulary
(`core`, `browser`, `server`) to identify an environment selected on the `src` or `app` axis; the
three faces below are this package's own.

- **core** — [`src/core`](../../src/core), published as `@orkestrel/scaffold`. Pure, synchronous,
  host-independent. Compiling, validating, diffing, projecting, and every rendered default.
- **server** — [`src/server`](../../src/server), published as `@orkestrel/scaffold/server`. Node
  only. Filesystem writes (`Materializer`), upstream fetches (`Sync`), the write-transaction
  machinery, and the host-staging primitive.
- **bin** — [`src/bin`](../../src/bin), built to the `scaffold` executable. Not a barrel and not
  published as a module: it exports nothing to consumers, so it carries no guide parity of its own
  and is documented here in prose.

Core imports neither of the others. Server imports core. The bin imports both. The same direction
is what a generated workspace is held to, and the compiled workspace makes it enforceable rather
than aspirational:

- `src/core` and `app/core` are host-independent — no DOM, no `node:*`, no stylesheet imports.
- `src/browser` and `app/browser` may import their own core plus browser libraries; they may never
  reach a Node builtin or a `/server` subpath.
- `src/server` and `app/server` may import their own core plus server libraries; they may never
  reach Vue, a `/browser` subpath, or a stylesheet.
- Published `src/*` may never import private `app/*`.
- `app/browser` reaches server behavior only through shared `app/core` contracts and transports,
  never through a server implementation import.

A generated `app/server` owns strict `APP_HOST`, `APP_PORT`, and `APP_START_TIMEOUT` parsing, a
repeat-safe HTTP lifecycle, bounded connection behavior, and process signal cleanup. Its exported
`reportApplicationServerError` handler writes only a stable configuration, lifecycle, or unknown
failure code; process-owned diagnostics never serialize a rejected value, nested cause, stack, or
other error context.

Every environment barrel is an export-star barrel: `index.ts` contains only `export * from './x.js'`
rows and nothing else. Named, default, namespace, and type-only barrel rows are absent by design,
so a star-export collision is a naming failure to fix at the owner rather than something to paper
over with a selective row. Both of this package's own barrels follow that rule, and every generated
barrel is emitted the same way.

## Surface

Compile a blueprint into a `Scaffolding`, then project the `Plan` it carries. The whole core path
is pure and synchronous; writing lives on the server face.

```ts
import { blueprint, createCompiler, dependency, planToReview } from '@orkestrel/scaffold'

const compiler = createCompiler()

const scaffolding = compiler.compile(
	blueprint('router', {
		description: 'A tiny hash router.',
		keywords: ['router', 'hash'],
		src: ['core', 'browser', 'server'],
		dependencies: [dependency('@orkestrel/contract', '^0.0.7')],
	}),
)

scaffolding.complete // true — the gate passed
if (scaffolding.plan) {
	scaffolding.plan.artifacts.length // every file the workspace needs, ordered
	planToReview(scaffolding.plan) // the copy-ready dry-run review document
}

compiler.emitter.on('block', (questions) => questions.length)
compiler.destroy()
```

An application-only blueprint uses an empty published set and an independent app set:

```ts
import { blueprint, blueprintToPlan } from '@orkestrel/scaffold'

const workspace = blueprint('console', {
	src: [],
	app: ['core', 'browser', 'server'],
})

const plan = blueprintToPlan(workspace)
plan.artifacts.some((artifact) => artifact.path === 'app/browser/index.html') // true
plan.artifacts.some((artifact) => artifact.path === 'app/server/main.ts') // true
```

### Types — core

From [`types.ts`](../../src/core/types.ts).

| Name                      | Kind      |
| ------------------------- | --------- |
| `Environment`             | type      |
| `BuildFormat`             | type      |
| `SrcDefinition`           | interface |
| `AppDefinition`           | interface |
| `ViteMachinery`           | interface |
| `ViteAxes`                | interface |
| `ViteProjectRegistration` | interface |
| `Origin`                  | type      |
| `Group`                   | type      |
| `Category`                | type      |
| `CatalogEntry`            | interface |
| `Drift`                   | type      |
| `Freshness`               | type      |
| `CompileStage`            | type      |
| `ScaffoldErrorCode`       | type      |
| `Dependency`              | interface |
| `Override`                | interface |
| `Blueprint`               | interface |
| `Member`                  | interface |
| `ArtifactBase`            | interface |
| `HostArtifact`            | interface |
| `ContentArtifact`         | interface |
| `Artifact`                | type      |
| `Snapshot`                | type      |
| `Plan`                    | interface |
| `Finding`                 | interface |
| `Audit`                   | interface |
| `Question`                | interface |
| `Validation`              | interface |
| `GuideSync`               | interface |
| `VersionSync`             | interface |
| `SyncReport`              | interface |
| `PlanSummary`             | interface |
| `CompileRecord`           | interface |
| `CompileFailure`          | interface |
| `Scaffolding`             | interface |
| `PlanRecord`              | interface |
| `CompilerEventMap`        | type      |
| `CompilerOptions`         | interface |
| `CompilerInterface`       | interface |
| `PlanManagerEventMap`     | type      |
| `PlanManagerOptions`      | interface |
| `PlanManagerInterface`    | interface |

The closed vocabularies are small and total. `Environment` is `'core' | 'browser' | 'server'`.
`BuildFormat` is `'es' | 'cjs'`. `Origin` is `'host' | 'template' | 'computed'`. `Group` is
`'manifest' | 'configs' | 'source' | 'tests' | 'guides' | 'docs' | 'orchestration'`. `Category` is
`'type' | 'alias' | 'constant' | 'factory' | 'entity' | 'parser' | 'guard' | 'handler' | 'error'`.
`Drift` is `'aligned' | 'stale' | 'missing' | 'foreign'`. `Freshness` is
`'current' | 'behind' | 'missing' | 'failed'`, where `missing` is an upstream `404` and `failed` is
a transport fault. `CompileStage` is `'draft' | 'gate' | 'pin'`, in that order. `ScaffoldErrorCode`
is `'INVALID' | 'BLOCKED' | 'DESTROYED' | 'TARGET' | 'WRITE' | 'FETCH'`.

`SrcDefinition` and `AppDefinition` are the per-environment matrix rows: the configuration files an
environment contributes, its test-project label, and — on the `src` axis — its `exports` subpath
and build formats, or — on the `app` axis — its optional runtime entry.

`ViteMachinery` names the three host-specific pipelines a workspace's generated `vite.config.ts` may
carry: `browser` for the CSS pipeline and the Playwright-backed browser test project, `vue` for the
single-file-component, HTML, and development-server machinery an application browser environment
needs, and `output` for build-output containment. It never selects a boundary guarantee — those ship
in every shape, as the compilers section sets out.

`ViteAxes` is the optional structural-project slice shared by every root Vite compiler:
`bin`, `integration`, and `service` each select their matching standalone project when `true`.

`ViteProjectRegistration` carries one generated project factory identifier and its optional browser
label. Root configuration renderers preserve that browser ownership as data through registration
instead of inferring it from a project identifier.

`Blueprint` is the closed input spec:

```ts
interface Blueprint {
	readonly name: string
	readonly description?: string
	readonly keywords: readonly string[]
	readonly src: readonly Environment[]
	readonly app: readonly Environment[]
	readonly dependencies: readonly Dependency[]
	readonly peers: readonly Dependency[]
	readonly extras: readonly Dependency[]
	readonly version: string
	readonly engines: string
	readonly overrides: readonly Override[]
	readonly bin: boolean
	readonly integration: boolean
	readonly service: boolean
}
```

`src` selects published library environments under `src`; `app` selects private runtime
environments under `app`. The two axes are independent, so library-only, application-only, and
mixed workspaces are all first class. `dependencies` and `peers` are runtime `@orkestrel/*`
packages — a peer flagged `optional` also gets a `peerDependenciesMeta` entry. `extras` are
package-specific development dependencies merged over the generated baseline, and may carry any
valid npm package name.

`bin`, `integration`, and `service` are the three structural axes, and they obey one law: each is
`true` only when the workspace physically ships the directory that defines it — never because of
the workspace's name, and never because a sibling axis is set. `deriveBlueprint` probes exactly
those directories, so a fresh compile and an audit of a mature repository agree on what the
workspace is.

- **`bin`** — `src/bin/` exists. It alone turns on the self-hosting extras: the manifest's `bin`
  entry, the `scaffold` script pointed at the built executable, the bin check, test, and build
  scripts, `build:host`, the `configs/src/tsconfig.bin.json` and `configs/src/vite.bin.config.ts`
  artifacts, and the `src:bin` test project.
- **`integration`** — `tests/integration/` exists. It records a slow, opt-in proof project over the
  workspace's own built output, outside the default run: the generated root configuration registers
  a standalone `integration` project including `tests/integration/**/*.test.ts`, and the manifest
  emits `test:integration`.
- **`service`** — `tests/service/` exists. It records a slow, opt-in proof project against a foreign
  running process, outside the default run: a standalone `service` project including
  `tests/service/**/*.test.ts`, with `tests/setupService.ts` after the shared setup, and the
  isolated `test:service` script.

A service workspace owes two companion files beside that directory, and derivation requires both
physically present: `tests/setupService.ts` and `scripts/service.sh`. Either missing companion is a
coded `TARGET` failure naming the missing path rather than a silent `service: false`. This package
emits neither: both are consumer-owned seams, and the generated-workspace section sets out what
each owes its workspace and which proof runs in which gate. Nothing here is inferred — the
executable axis turns on neither proof project, and neither proof project turns on the other.

`Override` replaces a rendered artifact's content at a path, never partially merges it. `Member` is
one declared public export of the scaffolded workspace, derived rather than authored.

`Artifact` is origin-discriminated. `ArtifactBase` carries `path`, `group`, and an optional
`environment`. A `HostArtifact` has `origin: 'host'`, an optional `source` (defaulting to `path`), and
an optional `hex` of exact lowercase bytes; it never carries `content`. A `ContentArtifact` has
`origin: 'template' | 'computed'` and always carries `content`; it never carries `hex` or `source`.
`Snapshot` is `Readonly<Record<string, string>>` — exact lowercase hexadecimal target bytes keyed
by artifact-relative path.

`Plan` carries the originating `blueprint`, the `groups` it covers, the ordered `artifacts`, and the
`trace` and `hash` the pin fills. The trace names both independent axes as `src:<selection>` and
`app:<selection>`, using `none` when one axis is empty, so app-only and mixed plans stay
self-describing. `PlanSummary` is the dry-run tally by origin and carries both selections. `Finding` is one
drift verdict with an optional bounded `observed` byte hex for a stale destination, and `Audit` is
the whole diff plus its `clean` and `complete` flags, `questions`, and `drifted` / `missing` /
`foreign` counts. `Question` is one validation issue; `blocking: true` fails the gate closed while
`false` rides a complete result as an advisory. `Validation` is the semantic pass result and never
throws.

`Scaffolding` is the replayable outcome of one compile: the `blueprint`, the `plan` when complete,
the accumulated `questions`, one `CompileRecord` per stage, any `CompileFailure` markers, the
`complete` flag, and the content `digest`. `PlanRecord` is a versioned, content-hashed plan inside a
`PlanManager`.

`GuideSync`, `VersionSync`, and `SyncReport` are the freshness shapes. `GuideSync` carries the
fetched `content`, its `freshness`, an optional `note` explaining a non-clean outcome, and an
optional `baseline` — the SHA-256 of the observed local mirror, or the literal `absent`, present
only on target-aware pulls. `VersionSync` compares a declared `range` to the registry `latest`.
`SyncReport` is `clean` only when nothing drifted and nothing failed. `CatalogEntry` is one fleet
package row; its `description` is the flattened text of that package's own guide's first
blockquote, and the empty string when that guide is missing, unreadable, or carries no blockquote.

`CompilerEventMap`, `CompilerOptions`, and `CompilerInterface` are the compiler triad;
`PlanManagerEventMap`, `PlanManagerOptions`, and `PlanManagerInterface` are the registry triad.
Both options records take `on` initial listeners and an `error` listener-failure handler, and
`PlanManagerOptions` additionally seeds `plans`.

### Types — server

From [`types.ts`](../../src/server/types.ts).

| Name                    | Kind      |
| ----------------------- | --------- |
| `MaterializeResult`     | interface |
| `MaterializerEventMap`  | type      |
| `MaterializerOptions`   | interface |
| `ManifestEntry`         | interface |
| `HostManifest`          | interface |
| `WriteExpectation`      | interface |
| `WritePrecondition`     | interface |
| `WriteAnchor`           | interface |
| `WriteDirectoryResult`  | interface |
| `SyncAllowance`         | type      |
| `CatalogAllowance`      | type      |
| `SyncBase`              | type      |
| `SyncBranch`            | type      |
| `GuideWrite`            | interface |
| `MaterializerInterface` | interface |
| `SyncEventMap`          | type      |
| `SyncOptions`           | interface |
| `SyncInterface`         | interface |

`MaterializeResult` reports the `target` plus the `written`, `copied`, `skipped`, and `removed`
paths of one call. `MaterializerOptions` accepts a `host` root override plus emitter `on` hooks and
an `error` handler; the default host is this package's own vendored data root, resolved from the
installed module's own location rather than the caller's working directory. A caller-supplied host
pointing at a raw repository root — one with no `manifest.json` beside it — maps artifact paths 1:1
instead of through the manifest.

`ManifestEntry` is one vendored-host file record — its un-dotted `storage` name, its `destination`
relative to a target, and an `executable` bit. `HostManifest` pairs the sorted file `entries` with
the complete sorted directory `roots` inventory, so a destructive consumer can tell a
declared-empty root from a truncated manifest.

The write-transaction shapes are the fail-closed mutation vocabulary. `WriteExpectation` is one
destination snapshot captured before mutation (`absent`, `file`, or `directory`, with device,
inode, modification time, size, and digest where they apply). `WritePrecondition` is the narrower
caller-observed state a transaction must still match. `WriteAnchor` is a physical directory
identity, and `WriteDirectoryResult` pairs the final anchor with the subset a call created.
`GuideWrite` pairs one validated guide update with its contained destination. `SyncAllowance` and
`CatalogAllowance` are one-cell `Float64Array` allowances: the former shares a byte budget across
concurrent network readers, while the latter shares one entry budget across every fleet root and
child visited by a catalog operation. `SyncBase` and `SyncBranch` are normalized strings returned
only by their corresponding boundary parsers.

`SyncOptions` groups the injectable endpoints under the entity they configure — `guides` with
`base`, `branch`, and `timeout`; `registry` with `base` and `timeout` — alongside `concurrency`,
`retries`, `strict`, `limit`, `items`, `budget`, and the emitter `on` and `error` keys.

### Constants — core

From [`constants.ts`](../../src/core/constants.ts).

| Name                              | Kind  |
| --------------------------------- | ----- |
| `ENVIRONMENTS`                    | const |
| `ORIGINS`                         | const |
| `GROUPS`                          | const |
| `CATEGORIES`                      | const |
| `FRESHNESS`                       | const |
| `COMPILE_STAGES`                  | const |
| `SRC_MATRIX`                      | const |
| `BIN_CONFIGS`                     | const |
| `APP_MATRIX`                      | const |
| `HOST_PATHS`                      | const |
| `SERVICE_SCRIPT_PATH`             | const |
| `NAME_PATTERN`                    | const |
| `MAX_NAME_LENGTH`                 | const |
| `MAX_DEPENDENCY_NAME_LENGTH`      | const |
| `MAX_PATH_LENGTH`                 | const |
| `CONTROL_CHARACTER_PATTERN`       | const |
| `INVALID_PATH_CHARACTER_PATTERN`  | const |
| `MAX_RANGE_LENGTH`                | const |
| `MAX_COLLECTION_ITEMS`            | const |
| `MAX_DATA_GRAPH_NODES`            | const |
| `MAX_DATA_GRAPH_KEYS`             | const |
| `VERSION_PATTERN`                 | const |
| `ORKESTREL_RANGE_PATTERN`         | const |
| `EXTRA_RANGE_PATTERN`             | const |
| `ENGINES_PATTERN`                 | const |
| `MINIMUM_NODE_VERSION`            | const |
| `EXPORT_KEYWORD`                  | const |
| `CONST_KEYWORD`                   | const |
| `IMPORT_KEYWORD`                  | const |
| `FUNCTION_KEYWORD`                | const |
| `HEX_PATTERN`                     | const |
| `MAX_ARTIFACT_BYTES`              | const |
| `MAX_TOTAL_ARTIFACT_BYTES`        | const |
| `MAX_SERIALIZED_INPUT_BYTES`      | const |
| `MAX_MANIFEST_BYTES`              | const |
| `MAX_ARTIFACT_HEX_LENGTH`         | const |
| `SYNC_BASELINE_PATTERN`           | const |
| `DEPENDENCY_NAME_PATTERN`         | const |
| `EXTRA_NAME_PATTERN`              | const |
| `DEFAULT_VERSION`                 | const |
| `DEFAULT_ENGINES`                 | const |
| `SCAFFOLD_RANGE`                  | const |
| `BASE_DEV_DEPENDENCIES`           | const |
| `SOURCE_BROWSER_DEV_DEPENDENCIES` | const |
| `APP_BROWSER_DEV_DEPENDENCIES`    | const |
| `CHECKOUT_ACTION_SHA`             | const |
| `SETUP_NODE_ACTION_SHA`           | const |
| `COMPILER_ID`                     | const |
| `TYPESCRIPT_EXTENSIONS`           | const |
| `JSON_PRINT_WIDTH`                | const |
| `JSON_TAB_WIDTH`                  | const |

`ENVIRONMENTS`, `ORIGINS`, `GROUPS`, `CATEGORIES`, `FRESHNESS`, and `COMPILE_STAGES` are the frozen
value lists behind their literal unions. `SRC_MATRIX` is the `src` environment matrix as
data — each environment's `configs/src` files, test-project label, `exports` subpath, and build
formats. `APP_MATRIX` is its application sibling, adding the runtime entry where an environment
produces one (`app/browser/index.html`, `app/server/main.ts`). `BIN_CONFIGS` is the executable
axis's computed `tsconfig` and Vite wrapper pair. `HOST_PATHS` is the ordered list of byte-copied
host artifacts, and it is the staging manifest rather than the per-plan carried set:
`stageHost` vendors every path on it, while each plan carries the subset `selectHostPaths` selects
for that one workspace. `SERVICE_SCRIPT_PATH` names the consumer-owned provisioner a service
workspace's audit expects.

The bounds are public because they are part of the contract, not implementation trivia.
`MAX_ARTIFACT_BYTES` caps one artifact at 5 MiB and `MAX_TOTAL_ARTIFACT_BYTES` caps one blueprint,
plan, audit, or report at 100 MiB in aggregate. `MAX_SERIALIZED_INPUT_BYTES` is four times that
aggregate ceiling so serialized hexadecimal records have a bounded envelope before JSON parsing,
and `MAX_MANIFEST_BYTES` caps every package or host manifest at 1 MiB.
`MAX_ARTIFACT_HEX_LENGTH` is the hexadecimal form of the per-artifact bound.
`MAX_COLLECTION_ITEMS` bounds one public collection at 1,000 entries.
`MAX_DATA_GRAPH_NODES` and `MAX_DATA_GRAPH_KEYS` cap recursive ownership inspection even when an
adversarial proxy produces a fresh identity at every step.
`MAX_NAME_LENGTH` is 203 so the published scoped name fits npm's 214-character limit, which
`MAX_DEPENDENCY_NAME_LENGTH` records directly. `MAX_PATH_LENGTH` and `MAX_RANGE_LENGTH` bound
serialized path and range tokens.

The patterns are the shape laws. `NAME_PATTERN` is the lowercase, letter-first workspace name.
`DEPENDENCY_NAME_PATTERN` closes `dependencies` and `peers` to `@orkestrel/<name>` — a name-shaped
law at the gate, because those are the only names that ever feed a derived `guides/src/<name>.md`
path. `EXTRA_NAME_PATTERN` is deliberately broader (any valid npm package name, scoped or not),
because `extras` names are manifest content and never feed a path. `VERSION_PATTERN` is exact
three-component semver; `ORKESTREL_RANGE_PATTERN` is the caret-pinned pre-1.0 range;
`EXTRA_RANGE_PATTERN` is the registry-only semver subset; `ENGINES_PATTERN` is the minimum-Node
form. `HEX_PATTERN` requires whole lowercase byte pairs, and `SYNC_BASELINE_PATTERN` accepts either
`absent` or an exact SHA-256 digest. `CONTROL_CHARACTER_PATTERN` and
`INVALID_PATH_CHARACTER_PATTERN` reject control characters and non-portable path characters.

`MINIMUM_NODE_VERSION` is `22.12.0`, `DEFAULT_ENGINES` derives from it, and `DEFAULT_VERSION` is
`0.0.1`. `BASE_DEV_DEPENDENCIES` is the host-neutral tooling baseline every generated workspace
gets; `SOURCE_BROWSER_DEV_DEPENDENCIES` adds the real browser providers a published browser environment
needs, and `APP_BROWSER_DEV_DEPENDENCIES` extends that with the Vue toolchain a private browser
application needs. `SCAFFOLD_RANGE` is the range generated workspaces pin this package at.
`CHECKOUT_ACTION_SHA` and `SETUP_NODE_ACTION_SHA` pin the two official CI actions to immutable
commits. `TYPESCRIPT_EXTENSIONS` is the module extension set every generated scoped check covers.
`JSON_PRINT_WIDTH` and `JSON_TAB_WIDTH` mirror the formatter configuration, so computed JSON is
format-stable by construction. `EXPORT_KEYWORD`, `CONST_KEYWORD`, `IMPORT_KEYWORD`, and
`FUNCTION_KEYWORD` keep declaration tokens out of rendered template literals, so a line-based
parity scan reading this package's own source never mistakes emitted file text for a real export.
`COMPILER_ID` is the default orchestrator id.

### Constants — server

From [`constants.ts`](../../src/server/constants.ts).

| Name                             | Kind  |
| -------------------------------- | ----- |
| `PRUNE_DIRECTORIES`              | const |
| `HOST_MANIFEST_PATH`             | const |
| `SENSITIVE_HOST_PATH_PATTERN`    | const |
| `RESERVED_TARGET_PATH_PATTERN`   | const |
| `MAX_CATALOG_DESCRIPTION_LENGTH` | const |
| `MAX_GUIDE_BYTES`                | const |
| `MAX_HOST_ENTRIES`               | const |
| `MAX_HOST_DEPTH`                 | const |
| `MAX_FILESYSTEM_DEPTH`           | const |
| `MAX_PATH_SEGMENT_BYTES`         | const |
| `RESERVED_PATH_SEGMENT_PATTERN`  | const |
| `MAX_SYNC_CONCURRENCY`           | const |
| `DEFAULT_SYNC_CONCURRENCY`       | const |
| `MAX_SYNC_RETRIES`               | const |
| `MAX_SYNC_TIMEOUT`               | const |
| `DEFAULT_SYNC_TIMEOUT`           | const |
| `MAX_SYNC_LIMIT`                 | const |
| `DEFAULT_SYNC_LIMIT`             | const |
| `DEFAULT_SYNC_ITEMS`             | const |
| `MAX_SYNC_ITEMS`                 | const |
| `DEFAULT_SYNC_BUDGET`            | const |
| `MAX_SYNC_BUDGET`                | const |
| `MAX_SYNC_BASE_LENGTH`           | const |
| `MAX_SYNC_BRANCH_LENGTH`         | const |
| `WRITE_DIGEST_PATTERN`           | const |
| `SYNC_BRANCH_PATTERN`            | const |

`PRUNE_DIRECTORIES` is the closed set of prune-owned directories — `.claude/agents`,
`.codex/agents`, and `scripts`. Nothing outside those roots is ever a deletion candidate, which is
why project-owned skills under `.agents/skills` and `.claude/skills` are structurally safe.
`HOST_MANIFEST_PATH` is the reserved `manifest.json` written at the root of every staged host.
`SENSITIVE_HOST_PATH_PATTERN` rejects credential-like, key-store, certificate-key, and
local-configuration paths at the staging boundary. `RESERVED_TARGET_PATH_PATTERN` protects `.git`
and every descendant from materialization, including when a hand-built plan targets a directory
that is otherwise vacant. `RESERVED_PATH_SEGMENT_PATTERN` rejects Windows device names even when
they carry an extension. `MAX_HOST_ENTRIES` and `MAX_HOST_DEPTH` bound vendored-host walks;
`MAX_FILESYSTEM_DEPTH` and `MAX_PATH_SEGMENT_BYTES` bound caller-supplied filesystem paths before
traversal. `MAX_GUIDE_BYTES` limits a catalog guide to the per-artifact ceiling before Markdown
parsing.

The `Sync` bounds come in matched default and maximum pairs: `concurrency` defaults to 6 and is
capped at 64, `timeout` defaults to 10 seconds and is capped at 5 minutes, `retries` is capped at
5, the per-response byte `limit` defaults to and is capped at the 5 MiB artifact limit, `items`
defaults to 256 and is capped at 1,000, and the cumulative `budget` defaults to 16 MiB and is
capped at 100 MiB. Endpoint bases and branch names are additionally bounded by
`MAX_SYNC_BASE_LENGTH` and `MAX_SYNC_BRANCH_LENGTH`. `WRITE_DIGEST_PATTERN` is the exact SHA-256
form a write precondition accepts; `SYNC_BRANCH_PATTERN` is the initial safe-character law for the
upstream guide URL boundary, followed by Git-ref structural checks in `parseSyncBranch`.
`MAX_CATALOG_DESCRIPTION_LENGTH` bounds a normalized catalog description at 500 characters.

### Templates

From [`templates.ts`](../../src/core/templates.ts).

| Name        | Kind  |
| ----------- | ----- |
| `TEMPLATES` | const |

`TEMPLATES` is the shipped, versioned `TemplateDefinition` data behind every `template`-origin
artifact. Only genuinely templated prose and source live here — starter README and guide text,
source stubs, application stubs, test stubs. Every structural file (`package.json`, the tsconfigs,
the build configuration) is `computed` instead, so a literal `{{…}}` inside a configuration can
never be mistaken for a placeholder. Changing a convention is a version bump of this package rather
than a hand edit of a generated workspace's copy.

### Errors

From [`errors.ts`](../../src/core/errors.ts).

| Name              | Kind     |
| ----------------- | -------- |
| `ScaffoldError`   | class    |
| `isScaffoldError` | function |

`ScaffoldError` carries a machine-readable `code` and an optional `context`, and `isScaffoldError`
is its total narrowing guard for a `catch`. Throwing is reserved for caller misuse:
`createBlueprint` on off-contract data throws `INVALID`; any method called after `destroy()` throws
`DESTROYED`; on the server face a non-vacant materialize target throws `TARGET` and a failed write
throws `WRITE`; a strict-mode upstream failure throws `FETCH`. A failing gate is deliberately _not_
an error — it fails closed into an incomplete `Scaffolding` whose `failures` carry a `BLOCKED`
marker.

### Validators — core

From [`validators.ts`](../../src/core/validators.ts).

| Name                      | Kind     |
| ------------------------- | -------- |
| `isDependency`            | const    |
| `isOverride`              | const    |
| `hasValidOverrideBytes`   | function |
| `isWorkspaceName`         | function |
| `hasOnlyDataProperties`   | function |
| `isDenseDataArray`        | function |
| `isEmitterErrorHandler`   | function |
| `isCompilerEventHooks`    | function |
| `isPlanManagerEventHooks` | function |
| `hasBlueprintEnvironment` | function |
| `hasValidBlueprintBytes`  | function |
| `isBlueprint`             | const    |
| `isMember`                | const    |
| `hasValidArtifactHex`     | function |
| `hasValidArtifactBytes`   | function |
| `hasValidPlanHex`         | function |
| `hasValidPlanBytes`       | function |
| `hasValidAuditBytes`      | function |
| `hasValidSnapshotBytes`   | function |
| `isArtifact`              | const    |
| `isPlan`                  | const    |
| `validatePlan`            | function |
| `hasValidSyncReportBytes` | function |
| `isSyncReport`            | const    |

The seven `is*` constants are total guards compiled from their shapes and refined by the `has*`
predicates beside them. A guard never throws — adversarial input, hostile prototypes, deep nesting,
and cycles all return `false`. The refinements are exported separately because they carry real
laws: `hasBlueprintEnvironment` requires at least one selected environment across the two axes;
`hasValidArtifactHex` applies the lowercase byte-pair law; and the `*Bytes` predicates apply the
per-item and aggregate byte limits to overrides, blueprints, artifacts, plans, audits, snapshots,
and sync reports. `isWorkspaceName` is the bounded bare-name guard used wherever a manifest name is
read back. `hasOnlyDataProperties` and `isDenseDataArray` are core guards because every environment
uses the same accessor-free graph and dense-array boundary. `isEmitterErrorHandler`,
`isCompilerEventHooks`, and `isPlanManagerEventHooks` validate callable observation seams before
entity allocation.

`validatePlan` is the pre-mutation gate: it runs the semantic pass over the plan's own blueprint and
then checks every override against the exact artifact set the plan would write. An override whose
`path` matches no planned artifact, targets a `host`-origin artifact, or targets the
blueprint-owned `package.json` publication boundary is a blocking question rather than a silent
no-op. An override that clears all three lands a `warnings` entry naming the path it replaces — the
declaration is accepted, and it is never accepted silently.

### Validators — server

From [`validators.ts`](../../src/server/validators.ts).

| Name                       | Kind     |
| -------------------------- | -------- |
| `isPortablePath`           | function |
| `isFilesystemPath`         | function |
| `isTerminalText`           | function |
| `isDependencyData`         | function |
| `isSensitiveHostPath`      | function |
| `isReservedTargetPath`     | function |
| `isCatalogAllowance`       | function |
| `isCatalogDescription`     | function |
| `isMissingPathError`       | function |
| `isWritePrecondition`      | function |
| `isManifestEntry`          | function |
| `isHostManifest`           | function |
| `isSyncEventHooks`         | function |
| `isMaterializerEventHooks` | function |

`isPortablePath` is the law every write and read is held to: a non-empty relative POSIX path, under
the length bound, free of control characters and non-portable characters, with no empty, `.`, `..`,
trailing-dot, trailing-space, or reserved-device segment. `isFilesystemPath` is the looser bound for
a host path a caller supplies, and `isTerminalText` is the bound for anything rendered into a
terminal or a JSON diagnostic. `isDependencyData` combines the data-only reflection with the core
dependency guard. `isReservedTargetPath` identifies preserved `.git` metadata, while
`isCatalogAllowance` bounds the single fleet counter at `MAX_HOST_ENTRIES` before directory
traversal and reads the typed array's intrinsic backing buffer, rejecting shared storage even when a
caller shadows the public `buffer` property.

`hasOnlyDataProperties` and `isDenseDataArray` exist because a boundary that copies a caller's graph
must never invoke a caller-defined accessor: the first walks a record or array graph and rejects any
non-data property within the public node/key budgets, while the second rejects a sparse,
symbol-bearing, or method-bearing array. Together they make a structured clone of an untrusted
input safe without admitting unbounded traversal. `isWritePrecondition`, `isManifestEntry`, and
`isHostManifest` are the exact-shape guards for the mutation and vendored-host records, and
`isSyncEventHooks`, `isMaterializerEventHooks`, and `isEmitterErrorHandler` reject an options object
carrying an unknown or non-callable hook. `isMissingPathError` narrows a caught filesystem error to
exactly `ENOENT`, so an absent path is never conflated with a permission failure.

### Parsers — core

From [`parsers.ts`](../../src/core/parsers.ts).

| Name                      | Kind     |
| ------------------------- | -------- |
| `parseBoundedJSON`        | function |
| `parseCompilerOptions`    | function |
| `parseBlueprint`          | function |
| `parsePlan`               | function |
| `parsePlanIds`            | function |
| `parsePlanManagerOptions` | function |
| `parseSyncReport`         | function |

`parseBoundedJSON` measures serialized UTF-8 bytes before allocating a parsed graph, applies a
caller-supplied `@orkestrel/contract` guard, and returns `undefined` for an invalid budget,
oversized or malformed JSON, or an off-contract result. The three domain parsers are the coercing
counterparts of their guards. Given a value they return it when the guard accepts it; given a string
they pass through the shared serialized-input ceiling before JSON parsing. A guard-valid value
round-trips unchanged, and malformed or off-contract input returns `undefined` rather than throwing.
`parsePlanIds` snapshots a bounded dense unique string array entirely through own data descriptors;
it never invokes a caller's iterator, accessor, symbol member, or sparse index.
`parseCompilerOptions` accepts only own `on` and `error` data properties and copies the compiler's
declared listener hooks before its emitter is allocated.
`parsePlanManagerOptions` performs the same fail-closed work for constructor options: it accepts
only own `plans`, `on`, and `error` data properties, bounds and snapshots seed plans without calling
their iterator, and copies only the three declared listener hooks.

### Cloners — core

From [`cloners.ts`](../../src/core/cloners.ts).

| Name           | Kind     |
| -------------- | -------- |
| `snapshotPlan` | function |

`snapshotPlan` validates a data-only plan, detaches it through its canonical JSON representation,
and recursively freezes the entire owned graph. A `PlanManager` therefore never aliases a caller's
blueprint, artifacts, arrays, or returned record.

### Parsers — server

From [`parsers.ts`](../../src/server/parsers.ts).

| Name                       | Kind     |
| -------------------------- | -------- |
| `parseSyncDependencies`    | function |
| `parseFilesystemPaths`     | function |
| `parsePortablePaths`       | function |
| `parseWritePreconditions`  | function |
| `parseSyncBase`            | function |
| `parseSyncCurrent`         | function |
| `parseSyncBranch`          | function |
| `parseMaterializerOptions` | function |
| `parseSyncOptions`         | function |

These are the boundary coercers that run before any resource is allocated or any request is issued.
`parseMaterializerOptions` and `parseSyncOptions` reject an unknown key, an accessor-backed
property, or a malformed nested endpoint group, then compile the remainder through the shared
contract. `parseSyncBase` rejects an overlong token before URL allocation, then normalizes an
endpoint to an absolute `https:` origin — plain `http:` is accepted only for loopback — and rejects
embedded credentials, a query, or a fragment. `parseSyncBranch` implements the Git ref-name safety
subset used in raw-guide URLs: it rejects overlong values, empty or dot-leading components, `..`,
`@{`, the single `@`, trailing dots, and `.lock` suffixes without regard to case.
`parseSyncCurrent` snapshots only the declared guide references, enforcing both the per-file and
cumulative byte allowance. The three array parsers return frozen copies read through property
descriptors, so a caller-supplied array can never smuggle in a getter.

### Shapers — core

From [`shapers.ts`](../../src/core/shapers.ts).

| Name              | Kind     |
| ----------------- | -------- |
| `dependencyShape` | function |
| `overrideShape`   | function |
| `blueprintShape`  | function |
| `memberShape`     | function |
| `artifactShape`   | function |
| `planShape`       | function |
| `syncReportShape` | function |

Each returns a fresh declarative contract shape that compiles into a guard, a parser, a schema, and
a seeded generator. The shapes stay structural on purpose: `blueprintShape` declares `name` as a
plain bounded string rather than a pattern so the generator stays satisfiable, and the
`NAME_PATTERN` law lives in the semantic pass instead. Likewise `artifactShape` splits on `origin` —
host artifacts may carry `source` and `hex`, content artifacts require `content` — while the
lowercase byte-pair law stays a semantic refinement.

### Shapers — server

From [`shapers.ts`](../../src/server/shapers.ts).

| Name                       | Kind     |
| -------------------------- | -------- |
| `syncGuideOptionsShape`    | function |
| `syncRegistryOptionsShape` | function |
| `syncOptionsShape`         | function |
| `materializerOptionsShape` | function |

The closed data-only option shapes. Every numeric option is an integer shape bounded by its own
maximum constant, so an out-of-range `concurrency`, `retries`, `limit`, `items`, `budget`, or
`timeout` fails at the boundary rather than deep inside a request loop.

### Contracts — server

From [`contracts.ts`](../../src/server/contracts.ts).

| Name                          | Kind  |
| ----------------------------- | ----- |
| `syncOptionsContract`         | const |
| `materializerOptionsContract` | const |

The compiled, closed data-only option contracts the two server parsers run their inputs through.

### Helpers — core

From [`helpers.ts`](../../src/core/helpers.ts).

| Name                        | Kind     |
| --------------------------- | -------- |
| `dependency`                | function |
| `ownDataValue`              | function |
| `override`                  | function |
| `member`                    | function |
| `blueprint`                 | function |
| `pascalCase`                | function |
| `escapeHtmlText`            | function |
| `serializeTypeScriptString` | function |
| `blueprintToMembers`        | function |
| `catalogNames`              | function |
| `alignTable`                | function |
| `splitTableRow`             | function |
| `padCell`                   | function |
| `delimiterCell`             | function |
| `planToSummary`             | function |
| `planToReview`              | function |
| `auditToReview`             | function |
| `isBehind`                  | function |
| `syncToReview`              | function |
| `catalogToBlock`            | function |
| `inferGroup`                | function |
| `diffPlan`                  | function |
| `bytesToHex`                | function |
| `contentCodePoint`          | function |
| `contentToBytes`            | function |
| `contentByteLength`         | function |
| `contentToHex`              | function |
| `snapshotOf`                | function |
| `selectHostPaths`           | function |
| `findPathConflict`          | function |
| `findFileConflict`          | function |
| `validateDependencyArray`   | function |
| `validateBlueprint`         | function |
| `manifestToDependencies`    | function |
| `manifestToName`            | function |
| `rangeToFreshness`          | function |
| `computeHash`               | function |
| `stableStringify`           | function |
| `planPayload`               | function |
| `computeColumnWidth`        | function |
| `renderArray`               | function |
| `renderObject`              | function |
| `renderValue`               | function |
| `formatJson`                | function |
| `pinPlan`                   | function |

`dependency`, `override`, `member`, and `blueprint` are the builders. `ownDataValue` reads only an
own data descriptor, so parsed JSON cannot acquire manifest fields through a polluted prototype
and accessors are never invoked. Each builder omits an absent optional
field entirely rather than writing `undefined`, so a built value round-trips its own exact-record
guard. `blueprint` fills the defaults: `version` and `engines` from their constants, `src` to
`['core']`, and every other collection to empty. `pascalCase` derives the entity name from a
lowercase-hyphen package name, and `blueprintToMembers` derives the declared public `Member[]` — a
full entity, options type, interface, and factory per published environment, plus the exact declaration
inventory each selected application environment contributes.

`escapeHtmlText` and `serializeTypeScriptString` are the two escaping leaves used when a
caller-supplied name reaches generated HTML or generated TypeScript source; the latter preserves
every UTF-16 code unit, escaping lone surrogates and line separators.

`alignTable` builds a formatter-width-aligned GFM table by rendering a real table node and then
re-padding both the cells and the delimiter row to per-column codepoint width. `splitTableRow`,
`padCell`, and `delimiterCell` are its exported leaves — the row splitter honours an escaped pipe
as literal text rather than a column boundary, and `padCell` measures codepoints so a surrogate
pair counts once. `catalogNames` is the mirror-image reader: it extracts `@orkestrel/<name>` package
names from a catalog table by a pure line scan, and returns `[]` rather than throwing when the text
has no rows.

`planToSummary`, `planToReview`, `auditToReview`, `syncToReview`, and `catalogToBlock` are the
lossless projections. The review documents are copy-ready markdown; `auditToReview` groups findings
by drift, elides the aligned ones, and rejects an unsafe finding path outright. `catalogToBlock`
deduplicates by name, sorts by code unit, prefixes a standing trust notice, and emits only the
`Package` and `Version` columns — network-controlled descriptions are deliberately omitted, because
that block enters agent instruction context. `isBehind` is the shared freshness predicate both
report projections count with.

`diffPlan` is the audit engine, and `inferGroup` classifies a target file the plan does not own.
`snapshotOf`, `contentToHex`, `contentToBytes`, `contentByteLength`, `contentCodePoint`, and
`bytesToHex` are the host-independent byte leaves that make exact comparison possible without a
host encoder or buffer; an unpaired surrogate encodes as `U+FFFD` rather than throwing.
`selectHostPaths` is the one-owner filter plan assembly applies before it carries anything: it
returns the host paths in input order minus `guides/src/<name>.md`, so a workspace never plans a
vendored mirror of the guide it writes itself. `findPathConflict` finds the first exact or
case-insensitive collision in a path list, and `findFileConflict` additionally rejects a file that
would sit inside another planned path — the loud backstop behind that selection.

`validateBlueprint` and `validateDependencyArray` are the semantic pass. The array validator is
pure — it returns its questions and the set of names it saw, so the caller can apply the
cross-array overlap rules on top. `manifestToDependencies` reads a manifest's `dependencies`,
`devDependencies`, and `peerDependencies` in that order, keeps only own data sections and scoped
names, deduplicates, and never throws. `manifestToName` is its self-reading sibling over the same
text: the manifest's own string `name`, or `undefined` when the text is oversized, malformed,
rootless, or nameless — the projection that lets a target recognize itself in its own declared
dependencies. `rangeToFreshness` applies the exact-pin comparison; the `missing` and `failed`
verdicts come from the fetch layer, never from this pure comparison.

`computeHash` is a deterministic FNV-1a digest and `stableStringify` a key-order-independent
canonical serialization, so two logically equal blueprints hash identically. `planPayload`
serializes exactly the blueprint, groups, and artifacts that establish plan identity, and `pinPlan`
hashes that payload while filling an explicit `src:<selection> · app:<selection>` trace (`none`
marks an empty axis). `PlanManager` compares the canonical payload whenever an
id is already registered: an identical plan is idempotent, while a distinct payload with the same
32-bit digest fails closed with `ScaffoldError('INVALID', 'Plan hash collision')`.
`formatJson` and its leaves — `renderValue`,
`renderArray`, `renderObject`, and `computeColumnWidth` — emit JSON that matches the fleet
formatter byte for byte, collapsing a short array onto one line and breaking a long one, so
computed configuration JSON is format-stable by construction.

### Helpers — server

From [`helpers.ts`](../../src/server/helpers.ts).

| Name                       | Kind     |
| -------------------------- | -------- |
| `isRealDirectory`          | function |
| `isRealFile`               | function |
| `digestFile`               | function |
| `digestHex`                | function |
| `digestText`               | function |
| `guideStub`                | function |
| `packageShortName`         | function |
| `readGuideReferences`      | function |
| `syncReportOf`             | function |
| `hostRoot`                 | function |
| `resolveRealPath`          | function |
| `resolveContainedPath`     | function |
| `resolvePhysicalPath`      | function |
| `validateWriteAnchor`      | function |
| `createWriteDirectory`     | function |
| `validateWriteDirectories` | function |
| `validateWriteTarget`      | function |
| `discardWriteTransaction`  | function |
| `commitWriteTransaction`   | function |
| `resolveGuideWrites`       | function |
| `restoreFiles`             | function |
| `replaceDirectory`         | function |
| `selectOrkestrelEntries`   | function |
| `deriveBlueprint`          | function |
| `isVacant`                 | function |
| `readTarget`               | function |
| `readManifest`             | function |
| `readHostManifest`         | function |
| `readFileHex`              | function |
| `readFileText`             | function |
| `listFiles`                | function |
| `listDirectories`          | function |
| `storagePath`              | function |
| `stageHost`                | function |
| `locateHostSource`         | function |
| `remapArtifactPath`        | function |
| `hydratePlan`              | function |
| `vendoredPruneSet`         | function |
| `pruneTargets`             | function |
| `consumeCatalogAllowance`  | function |
| `discoverPackages`         | function |
| `guideToDescription`       | function |
| `catalogPackages`          | function |

`hostRoot` resolves this module's own installed package root — the nearest ancestor of its own file
holding a `package.json` — and returns its vendored `dist/host` directory. Walking up from the
module rather than from the working directory is what makes the default host correct once installed:
the package ships its vendored data with itself.

`resolveRealPath`, `resolveContainedPath`, and `resolvePhysicalPath` are the containment ladder.
The first resolves the deepest existing ancestor through symlinks with bounded iterative traversal;
the second rejects any candidate that escapes its root after that resolution; the third additionally
requires every existing ancestor between the root and the destination to be a real, unlinked
directory. All three reject malformed paths before filesystem access. Containment is therefore
realpath-aware rather than merely lexical, so a symlinked subdirectory planted inside an otherwise
legitimate root cannot smuggle a write or a read outside it.

`digestFile`, `digestHex`, and `digestText` are the three SHA-256 leaves. The file digest is
bounded-memory and revalidates device, inode, size, and modification time before and after reading,
so a file swapped mid-read is a failure rather than a silent wrong digest. `readFileHex` and
`readFileText` read one contained file under the same revalidation, and the text reader decodes
strictly, rejecting invalid UTF-8. Manifest reads stop at `MAX_MANIFEST_BYTES`; catalog guide reads
stop at `MAX_GUIDE_BYTES`. `listFiles` and `listDirectories` walk a real, unlinked root under the
entry and depth bounds, returning sorted POSIX-relative paths and `[]` for an absent root.
`isRealDirectory` and `isRealFile` are the physical path predicates they all lean on.

The write-transaction helpers are the fail-closed mutation path. `createWriteDirectory` establishes
a directory one segment at a time behind captured identities; `validateWriteAnchor`,
`validateWriteDirectories`, and `validateWriteTarget` revalidate those identities before each step;
`commitWriteTransaction` promotes a complete staged set and rolls every earlier destination back
when a later promotion fails; `discardWriteTransaction` removes the private residue of an
uncommitted or already-committed transaction; `restoreFiles` returns quarantined files to their
original paths in reverse order; and `replaceDirectory` atomically swaps a completed staging
directory for its target, preserving a recoverable backup. `resolveGuideWrites` is the sync-side
preflight: it resolves every behind-guide destination, enforces the canonical
`guides/src/<short>.md` path for its dependency name, rejects collisions, and rejects a destination
that is not a plain physical file — all before any mutation.

`isVacant` is the green-field target law: a path is vacant when it is absent, empty, or contains
nothing but a real `.git` directory. `readTarget` reads a target's current bytes at a set of paths
into an exact-byte snapshot, mapping a directly requested directory to the empty string and
omitting an absent path entirely. `readManifest` reads `package.json` text, and
`selectOrkestrelEntries` filters a manifest field to its scoped name-and-range entries.

`deriveBlueprint` is the faithful inverse an audit needs: it reconstructs a blueprint from an
existing workspace so a mature package is diffed against its own would-be scaffold rather than a
dependency-less stand-in. Environments come from `src/<environment>/` and `app/<environment>/`, and
the three structural axes from the directory probes and the service companion law the blueprint
section states — every one of them a reading of the filesystem, never of the name. Dependencies and
peers come from the manifest's scoped entries, with an optional peer recovered from
`peerDependenciesMeta`; and `extras` is every development dependency minus the complete set
`devDependenciesFor` emits for those environments and structural axes, and minus anything already
declared as a dependency or peer. An axis-emitted dependency is therefore never double-counted,
while a hand-added development dependency round-trips and stays audit-clean. Derivation yields no
`overrides`: they are caller-time inputs, not repository state. A computed artifact that must differ
reveals a gap in the canon; the blueprint grows an axis for that distinction rather than the
repository forking the file.

`storagePath`, `stageHost`, `readHostManifest`, `locateHostSource`, `remapArtifactPath`, and
`hydratePlan` are the vendored-host path. `storagePath` maps a repo-relative path to its un-dotted
storage name, `stageHost` copies the vendored set into an output directory behind a full preflight
and an atomic swap, and `readHostManifest` reads and validates the resulting `manifest.json`,
returning `undefined` when a host has none — the raw-repository-root fallback that maps sources 1:1.
`locateHostSource` resolves one source to its storage file, `remapArtifactPath` maps a manifest
destination back onto an artifact's target prefix, and `hydratePlan` rehydrates a plan's host
artifacts with their exact bytes, expanding a directory-shaped host artifact into one artifact per
file.

`vendoredPruneSet` establishes the allowlist for one prune directory and fails closed rather than
returning an unestablished empty set — a missing host root, or a host with neither a manifest nor
that directory, is a coded failure, while a host that genuinely vendors nothing there remains a
valid empty allowlist. `pruneTargets` is the single source of truth for prune drift: it lists the
paths under a target's prune directories that the allowlist does not declare, and it never deletes
anything.

`consumeCatalogAllowance` decrements the single shared entry allowance and throws `TARGET` before an
over-budget traversal continues. `discoverPackages` requires a real, unlinked root and lists its
immediate child directories whose bounded manifest names a scoped package, skipping anything else
silently. A control-bearing child directory fails closed before its manifest is read and the
untrusted name is never reflected in the diagnostic. `catalogPackages` applies one allowance across
every root and directory rather than
resetting a per-root budget, then draws each description from the first paragraph of the first
blockquote of that package's own bounded guide via `guideToDescription`; a missing guide, an
unreadable or oversized one, or one with no blockquote yields an empty description rather than an
error.

`packageShortName` strips the canonical scope, `guideStub` renders the pointer written when a
dependency guide is not vendored yet, `readGuideReferences` reads a target's existing local mirrors
so a pull's verdicts are target-relative, and `syncReportOf` assembles one report from already
ordered guide and version outcomes.

### Compilers — core

From [`compilers.ts`](../../src/core/compilers.ts).

| Name                       | Kind     |
| -------------------------- | -------- |
| `hostGroup`                | function |
| `fillArtifact`             | function |
| `srcVariant`               | function |
| `entryFields`              | function |
| `dualCondition`            | function |
| `exportsMap`               | function |
| `compareCodeUnit`          | function |
| `devDependenciesFor`       | function |
| `packageManifest`          | function |
| `rootTsconfig`             | function |
| `viteMachinery`            | function |
| `renderViteTest`           | function |
| `viteHeader`               | function |
| `policyViteProject`        | function |
| `guidesViteProject`        | function |
| `binViteProject`           | function |
| `integrationViteProject`   | function |
| `serviceViteProject`       | function |
| `viteProjectRegistrations` | function |
| `viteProjectDefinitions`   | function |
| `singleSrcViteConfig`      | function |
| `rootViteConfig`           | function |
| `applicationViteConfig`    | function |
| `coreTsconfig`             | function |
| `coreViteConfig`           | function |
| `srcTsconfig`              | function |
| `srcViteConfig`            | function |
| `binTsconfig`              | function |
| `binViteConfig`            | function |
| `appTsconfig`              | function |
| `appViteConfig`            | function |
| `ciWorkflow`               | function |
| `configArtifacts`          | function |
| `sourceArtifacts`          | function |
| `applicationArtifacts`     | function |
| `paritySpecifiers`         | function |
| `testArtifacts`            | function |
| `guideMemberTable`         | function |
| `guideUsage`               | function |
| `guideMethods`             | function |
| `guideTests`               | function |
| `guideArtifacts`           | function |
| `applyOverrides`           | function |
| `blueprintToPlan`          | function |

`blueprintToPlan` is the whole pure compilation: draft each selected group's artifacts, append the
host set, apply overrides, and pin. Everything above it is an exported leaf of that drafting, each
independently callable and independently tested.

`srcVariant` classifies an `src` environment selection into its manifest variant — one environment, or
several. `entryFields`, `dualCondition`, and `exportsMap` build the manifest entry fields and the
`exports` map from that variant; a browser-only package exports a single module condition, while
core and server src get dual import and require conditions with matching declaration files.
`devDependenciesFor` emits the blueprint's complete development dependency set: the shared
baseline, package extras, dev-installed peers, selected browser toolchains, and the bin axis's
browser test provider. Extras and peers are sorted by `compareCodeUnit` so ordering is stable across
locales. `packageManifest` assembles the whole file — name, publication mode, files, scripts,
dependencies, peers and their optional metadata, and engines.

`rootTsconfig` emits the root compiler options and one path alias per declared environment;
`coreTsconfig`, `srcTsconfig`, and `appTsconfig` emit the scoped configurations that remove the
wrong host's globals from each environment. A core scope is the interesting one: `lib` is
`["ESNext", "WebWorker"]` and `types` stays `[]`, which declares the WHATWG surface that is
identical across Node, browsers, and workers — `fetch` and its request/response/header types,
streams, `URL`, `AbortController`, the text encoders, `crypto`, timers, `console`, `DOMException`,
`structuredClone` — while leaving `document`, `window`, and every `node:*` type unresolvable. That
is one declaration set for a host-independent module, not a host. `viteHeader` renders the shared
header — the alias block
derived from the tsconfig paths, plus the environment-boundary plugin — and `viteMachinery` is the
one place the header's axes are derived, read by `rootViteConfig`, `singleSrcViteConfig`,
`applicationViteConfig`, and `configArtifacts` alike so no caller can invent a fourth answer.

**The boundary guarantees do not vary by blueprint.** Every generated `vite.config.ts` — a
`core`-only library, an application of `app/core` alone, or the full six-environment workspace —
emits `environmentBoundary`, its `resolveId` / `load` / `buildEnd` walks, the module-graph AST audit
(`environmentAssetSources`, `parseSync`, `Visitor`), and stylesheet rejection (`isStylesheetPath`
plus its `environmentPathError` / `environmentSourceError` clauses). Those enforce owner-independent
laws: core stays host-independent whatever else the workspace declares, a server module never
imports a stylesheet, and a `@vite-ignore` dynamic import — which `resolveId` never sees and the
module graph never records — has no other enforcement point in workspace-owned source. Dependency
and toolchain modules are outside that ownership boundary. Only host-specific pipelines vary,
along the three `ViteMachinery` axes:

| Machinery                                                         | Emitted when                         |
| ----------------------------------------------------------------- | ------------------------------------ |
| CSS pipeline (`ENVIRONMENT_CSS`, `preprocessCSS`, `isCSSRequest`) | a `src` or `app` browser environment |
| Playwright provider and `hasChromium`                             | a `src` or `app` browser environment |
| Vue plugin, HTML boundary, browser development server             | an `app` browser environment         |
| Output containment (`outputBoundary`, `enforceOutputPath`)        | anything the workspace builds        |

An application of `app/core` alone is the sole shape that builds nothing, so it is the sole shape
without output containment — and it still carries every boundary guarantee above.

`renderViteTest` is the single root-project renderer. It consumes ordered `ViteProjectRegistration`
data and emits either the plain project list or the browser gate, keeping source and application
root configurations byte-consistent without reconstructing browser ownership.
`viteProjectRegistrations` is the one registration derivation every root shape consumes: it derives
the selected source and application projects from the canonical environment order, then appends
`policy`, `guides`, and the optional `srcBin`, `integration`, and `service` projects.
`viteProjectDefinitions` renders the standalone proof and structural-axis definitions in that same
order with one blank line between declarations. Both consume `ViteAxes`, so each optional project is
controlled only by its matching `bin`, `integration`, or `service` blueprint axis.

`coreViteConfig`, `srcViteConfig`, `binViteConfig`, and `appViteConfig` emit the thin per-target
wrappers, while `binTsconfig` emits the executable declaration scope; `rootViteConfig`,
`singleSrcViteConfig`, and `applicationViteConfig` emit the root configuration for a library-only,
single non-core `src` environment, and application-bearing workspace respectively; and
`policyViteProject`, `guidesViteProject`, `integrationViteProject`, and `serviceViteProject` emit
the standalone Node proof projects, with `binViteProject` the single executable-project emitter. A
proof project is structurally derived from the directory holding its tests and never wraps a source
or application environment project. The guides project therefore uses only `tests/setup.ts`, never
`setupServer.ts`, `setupBrowser.ts`, or `setupService.ts`; and its `tests/src/**/*.test.ts` and
`tests/app/**/*.test.ts` exclude rows are uniform across all root shapes by design, including
core-only workspaces where one row cannot currently match. Integration and service use 120-second
test and hook timeouts with file parallelism disabled, and service alone layers
`tests/setupService.ts` onto the shared setup. Where a bin workspace also ships the integration
project, that project wires `tests/setupIntegration.ts` as its global setup for the shared
template-registry harness; bin-less integration workspaces do not.

`configArtifacts`, `sourceArtifacts`, `applicationArtifacts`, `testArtifacts`, and `guideArtifacts`
are the per-group drafters. When `bin` is selected, `configArtifacts` includes
`configs/src/tsconfig.bin.json` and `configs/src/vite.bin.config.ts` beside the declared environment
configuration pairs. `paritySpecifiers` computes the self-specifier and module map the
generated parity suite resolves fence imports through. `guideMemberTable`, `guideUsage`,
`guideMethods`, and `guideTests` render the generated guide's member tables, usage examples, method
contract, and test inventory. `fillArtifact` fills one template entry into a `template`-origin
artifact with missing placeholders treated as an error, and `hostGroup` resolves which group a
byte-copied host path belongs to. `applyOverrides` replaces a matching artifact's content in place
and deliberately leaves an unmatched, host-owned, or `package.json` override unapplied, because the
gate reports it as a blocking question. `ciWorkflow` renders the generated workflow.

### Factories

From [`factories.ts`](../../src/core/factories.ts) and
[`factories.ts`](../../src/server/factories.ts).

| Name                 | Kind     |
| -------------------- | -------- |
| `createCompiler`     | function |
| `createPlanManager`  | function |
| `createBlueprint`    | function |
| `createMaterializer` | function |
| `createSync`         | function |

`createBlueprint` is the validating constructor: it fills the builder defaults and then checks both
the exact-record shape and the semantic pass, throwing `INVALID` when either fails. The other four
construct their entities from their options records.

### `Compiler`

The compilation orchestrator, from [`Compiler.ts`](../../src/core/Compiler.ts). It runs the fixed
three-stage `draft → gate → pin` pipeline over a blueprint and owns a typed emitter whose event map
is `compile`, `audit`, `block`, `error`, and `destroy`. Both public methods are genuinely
synchronous and pure. `compile` emits `compile` only for a complete compilation and `block` for a
gated one; `audit` emits `block` when gated and then always emits `audit`, never `compile`. After
`destroy()` every method other than the getter and `destroy` itself throws `DESTROYED`, and teardown
is idempotent with the emitter destroyed last.

### `PlanManager`

The versioned, content-hashed plan registry, from
[`PlanManager.ts`](../../src/core/PlanManager.ts). Its event map is `add`, `remove`, and `destroy`.
Construction parses its exact options before allocating the emitter. `add` re-pins an immutable,
detached plan snapshot and mints the record id from that content hash, so re-adding an unchanged plan
resolves to the same frozen record, a changed plan mints a fresh id, and a distinct canonical payload
with a colliding digest throws `INVALID` before mutation or emission. `remove` follows the
batch-overload convention with the array overload declared first. Its list form is all-or-nothing:
if any listed id is unregistered the collection is untouched and `false` is returned; on success all
selected records are removed before the first stable-order event, so synchronous listeners observe
the committed state and cannot create reentrant duplicate removals. After `destroy()` every method
other than the getters and `destroy` throws `DESTROYED`.

### `Materializer`

The materialization entity, from [`Materializer.ts`](../../src/server/Materializer.ts) — the only
filesystem writer in the package. Its event map is `copy`, `write`, `remove`, `done`, `error`, and
`destroy`. Every call preflights completely before mutating: a structural plan match, the semantic
and contextual validation result, portable-path checks on every artifact path and source, collision
detection, destination-shape checks, and realpath-anchored containment against both the target and
the host root. Only then does staging begin, inside a private same-volume write transaction that is
promoted atomically and rolled back on any failure. After `destroy()` every method throws
`DESTROYED`.

### `Sync`

The upstream-synchronization entity, from [`Sync.ts`](../../src/server/Sync.ts) — the only network
reader in the package. Its event map is `guide`, `version`, `package`, `write`, `done`, `error`, and
`destroy`. Every request runs under a per-request abort timeout and a bounded worker pool rather
than an unbounded parallel await, follows no redirects, sends no credentials, and reads its response
body incrementally against both the per-response limit and a shared cumulative allowance. The
default posture collects failures into the result as `missing` or `failed` verdicts; `strict` mode
turns those into a thrown `FETCH` naming the failing URL. `destroy()` aborts every in-flight request
and is idempotent, and every method afterwards throws `DESTROYED`.

### `WriteTransaction`

The nominal, same-volume write-transaction state, from
[`WriteTransaction.ts`](../../src/server/WriteTransaction.ts). It is constructed only through its
static `create`, which derives every filesystem path from a target plus portable relative paths — a
caller can neither supply a deletion root nor mutate the captured arrays. Creation snapshots every
destination into a frozen `WriteExpectation`, verifies any supplied preconditions against what is
actually on disk, captures the parent anchor identity, and creates private staging and backup
directories with restrictive permissions. Its readonly getters — `target`, `root`, `stage`,
`backup`, `expectations`, `parents`, `directories`, `anchor`, and `existing` — are the only way to
observe it; every operation over it lives in the exported transaction helpers.

## Methods

The public methods of each behavioral interface, one table per type.

#### `CompilerInterface`

| Method    | Returns       |
| --------- | ------------- |
| `compile` | `Scaffolding` |
| `audit`   | `Audit`       |
| `destroy` | `void`        |

`compile(blueprint, groups?)` runs the pipeline and returns a complete or visibly incomplete
`Scaffolding`; the optional group selection scopes the plan to those artifact groups.
`audit(blueprint, current, groups?)` compiles and then diffs the resulting plan against the
caller-supplied current content; a gated blueprint returns `complete: false` with the gate's
blocking questions and zero findings, and a complete one carries the gate's advisories on that same
`questions` field. `destroy()` is idempotent teardown. The interface also exposes the readonly
`emitter`.

#### `PlanManagerInterface`

| Method    | Returns                   |
| --------- | ------------------------- |
| `has`     | `boolean`                 |
| `plan`    | `PlanRecord \| undefined` |
| `plans`   | `readonly PlanRecord[]`   |
| `add`     | `PlanRecord`              |
| `remove`  | `boolean \| void`         |
| `destroy` | `void`                    |

`has(id)` tests registration. `plan(id)` is the singular accessor and returns `undefined` for an
unregistered id; `plans()` is the plural accessor and returns a snapshot array. `add(plan)`
registers or re-registers one plan. `remove()` removes every plan and returns `void`; `remove(id)`
removes one and returns whether it existed; `remove(ids)` is all-or-nothing over a list. The
interface also exposes the readonly `emitter` and `size` properties.

#### `MaterializerInterface`

| Method        | Returns             |
| ------------- | ------------------- |
| `materialize` | `MaterializeResult` |
| `repair`      | `MaterializeResult` |
| `prune`       | `MaterializeResult` |
| `destroy`     | `void`              |

`materialize(plan, target)` is green-field: it refuses any target `isVacant` rejects, then copies
each host artifact and writes each template and computed artifact. `repair(plan, audit, target)` is
into-existing: it skips the vacancy check, re-verifies that the target still matches the audit
preview, and writes only the missing and stale artifacts that audit names, leaving aligned ones
untouched and reporting them as `skipped`. `prune(target, expected)` deletes exactly the unexpected
files the vendored host no longer declares under the prune directories, and only after the observed
bytes still match the `expected` snapshot it was previewed with. `destroy()` is idempotent teardown.
The interface also exposes the readonly `emitter`.

#### `SyncInterface`

| Method     | Returns                            |
| ---------- | ---------------------------------- |
| `guides`   | `Promise<readonly GuideSync[]>`    |
| `versions` | `Promise<readonly VersionSync[]>`  |
| `catalog`  | `Promise<readonly CatalogEntry[]>` |
| `pull`     | `Promise<SyncReport>`              |
| `write`    | `Promise<readonly string[]>`       |
| `destroy`  | `void`                             |

`guides(deps, current?)` fetches each dependency's upstream guide. The optional `current` map is
keyed by dependency name: with it, a fetched guide byte-equal to its entry verdicts `current` and
anything else verdicts `behind`; without it, every successful fetch verdicts `behind`, because no
reference means it needs syncing. `versions(deps)` compares each declared range to the registry
latest. `catalog()` enumerates the fleet from the registry's exact organization package list — an
unreachable or malformed list is always a coded failure, since without it there is no catalog — then
degrades gracefully per package. `pull(target, dependencies?)` builds the reference map from the
target's own mirrors, so its verdicts are target-relative, and rejects a selection the target does
not declare. `write(report, target)` commits only the `behind` guides. `destroy()` aborts every
in-flight request. The interface also exposes the readonly `emitter`.

## The compile pipeline

`compile` runs three stages in fixed order and records each as a `CompileRecord` carrying its input,
its output, whether it failed, and any error text.

1. **draft** — `blueprintToPlan` selects the covered groups, drafts each group's artifacts, carries
   the selected host set — every vendored host path except the workspace's own guide — applies
   overrides, and pins the draft. A throw here records a `draft` failure coded
   `INVALID`, emits `error`, marks the remaining two stages skipped, and returns incomplete.
2. **gate** — `validatePlan` runs the semantic pass over the blueprint and checks every override
   against the drafted artifact set. Blocking questions fail the stage; an accepted override and a
   dependency outside the vendored guide set each contribute a non-blocking advisory question
   instead.
3. **pin** — a host-origin pointer artifact is appended for each non-vendored dependency, and
   `pinPlan` fills `trace` and `hash` from the plan's own content.

The gate fails closed. A blueprint that fails validation, or that carries an override matching no
planned artifact or targeting a host-origin path, yields a visible incomplete `Scaffolding` — `plan`
absent, `questions` populated, a `BLOCKED` failure marker recorded — rather than throwing and rather
than emitting a half-formed workspace. A half-formed workspace is worse than a question.

`validateBlueprint` is the semantic law in one place. It checks the name against `NAME_PATTERN` and
the length bound, the version and engines patterns, and that the declared engines floor is not below
the supported Node minimum. It requires at least one selected environment across the two axes, keeps
both axes on-vocabulary with no repeats, and blocks the one combination that has no defined
configuration class: `browser` plus `server` without `core` in the same axis. It validates each
dependency array
for a well-formed name and range with no duplicates — scoped names for `dependencies` and `peers`,
any valid npm name for `extras` — and blocks a name declared in two of the three arrays. It bounds
the description and every override by the per-item and aggregate byte limits, and blocks a repeated
or empty override path.

Because `pinPlan` derives `hash` from a canonical, key-order-independent serialization of the
blueprint, groups, and artifacts, two logically equal blueprints built in different field orders
produce the same digest — and a `PlanManager` id is that digest.

## Origin and ownership

`origin` is the ownership axis, and it decides everything downstream: how an artifact is produced,
how it is audited, and whether it may ever be overwritten.

- **`host`** — byte-copied from the vendored data root. These are the shared files a whole fleet
  keeps identical: the root instruction documents and licence, the agent, rule, and skill
  directories, the session scripts, the repository coding-law policy module, the byte-identical root
  dotfiles, and the two line guide mirrors a workspace carries for contracts other than its own.
  `HOST_PATHS` is the exact vendored list; what a given plan carries is `selectHostPaths` of it.
- **`template`** — filled from a frozen template definition by a pure fill engine. These are
  starter files: source stubs, test stubs, the starter guide, the README.
- **`computed`** — derived by this package's own combination logic. These are the structural files:
  the manifest, the tsconfigs, the build configuration, the generated CI workflow.

Audit semantics follow directly from that.

- A **template** artifact is birth-only and audit-exempt. It is always reported `aligned`, whatever
  the target holds. Starter files are written once and are legitimately outgrown — real code
  replaces the stub, a hand-authored guide replaces the scaffold prose, an entity gets renamed.
  Comparing a mature workspace against its birth stub is a category error, and it would make any
  unscoped repair a data-loss hazard. Template findings therefore never contribute to the drifted,
  missing, or clean tallies.
- A **computed** artifact is content-aware canon: `missing`, `aligned`, or `stale`, and it gates the
  audit like any other drift.
- A **host** artifact is audited by presence alone — `missing` or `aligned`, never `stale` — unless
  it has been hydrated with its real host bytes, in which case it is content-compared exactly like a
  computed artifact and can be `stale`. Hydration also expands a directory-shaped host artifact into
  one artifact per file, so agent configuration and skills are audited file by file.
- A target file the plan does not own is `foreign`, and `inferGroup` classifies it by its leading
  path segment.

The same ownership boundary is what makes mutation safe. **`fleet` and default `repair` both scope
the compiled plan to host origin before hydrating, diffing, or applying.** `--generated` widens that
scoped plan to generated canon except `package.json`; template artifacts remain birth-only in
either mode. A mature workspace's hand-written source, tests, guides, and manifest are therefore
never overwritten with a stub. The generated `.github/workflows/ci.yml` is a **computed** artifact,
so user-owned CI stands by default but is intentionally restored when `--generated` is passed.
Audit always compares it because computed artifacts are content-aware canon. A legitimate
difference that the blueprint cannot express is a canon gap: add the missing blueprint axis rather
than forking the computed file in one repository.

Overrides respect the same boundary from the other direction. `applyOverrides` never replaces a
host-origin artifact and never replaces `package.json`; the gate turns either attempt — and an
override matching no planned artifact at all — into a blocking question rather than a silent no-op.
What survives those three refusals is applied and announced: the gate carries a non-blocking
advisory naming each replaced path, and that advisory rides the `Scaffolding` and the `Audit` all
the way through the library result.

Guide mirrors are the one place ownership is conditional, and the law is one owner per guide path.
**A workspace mirrors every line guide except its own.** When the name matches — the guide package
on `guides/src/guide.md`, this package on `guides/src/scaffold.md` — the workspace itself is the
owner, keeping that path as its **template**-origin starter guide, and `selectHostPaths` drops the
vendored mirror so the path is contributed exactly once. For every other contract the mirror is the
owner: a dependency this package vendors a byte-identical mirror for gets a real host-origin copy of
`guides/src/<short>.md`, contributed once whether it arrives through the host set or through the
dependency, so a package depending on `@orkestrel/guide` plans one `guides/src/guide.md` rather than
two. Any other dependency gets a host-origin _pointer_ artifact plus a non-blocking question, never
a fabricated mirror; on materialization that pointer degrades to a short stub, and `scaffold pull`
fetches the real thing. That degrade is scoped exactly to guide pointers: any other missing manifest
entry means a corrupt or truncated vendored manifest, and fails closed. Selection is the law and
`findFileConflict` is its backstop: two artifacts at one path refuse the plan rather than racing to
be the last writer.

## Audit, repair, and prune

An audit is a pure function of a plan and a snapshot, so the same engine that creates a workspace
checks one. `readTarget` supplies the snapshot as exact bytes; `diffPlan` returns findings as data;
`auditToReview` renders them for a human. Nothing in that path writes.

The executable's physical unexpected-file scan treats exactly `scripts/service.sh` as an expected
consumer-owned seam when the derived blueprint has `service: true`. That exclusion is warranted
because a service blueprint cannot derive without the physical file: the companion-file law raises
a `TARGET` failure first, so the scan removes a false positive and can never mask an absent
provisioner. A non-service workspace still reports the same path as foreign.

`repair` turns those findings back into the narrowest possible write. It re-reads the target,
re-diffs it, and refuses to proceed if the findings changed since the preview it was given — a
target that moved under the caller is a `TARGET` failure, not a race to win. It then derives a write
precondition per artifact from the audit itself: a `missing` finding requires the destination to
still be absent, a `stale` finding requires it to still carry exactly the bytes that were observed.
Those preconditions are checked again inside the write transaction before any promotion.
An interactive audit repair hand-off forwards `--generated` into the repair invocation when the
flag was present on `audit`.

`prune` is the deletion arm, and it is deliberately narrow. Its candidate set comes from
`pruneTargets`, which is also what the executable's audit and preview read, so what is reported and
what is deleted cannot diverge. Only the three prune directories are in scope; the allowlist must be
positively established from the vendored host, or the call fails closed rather than treating an
unresolved host as "vendors nothing" and proposing to delete everything. Each candidate is verified
as a plain physical file whose bytes still match the preview, moved into a private quarantine rather
than unlinked, re-verified after the move, and only then reported as removed — with a full restore
attempt if any candidate fails mid-way.

## Upstream sync, pull, and catalog

`Sync` is the only network reader, and its posture is conservative by construction.

Every request is unauthenticated: no token, no authorization header, anywhere. Every fleet
repository is public, so plain reachability is the only signal, and a guide `404` degrades
gracefully instead of needing credentials. Redirects are never followed — a 3xx, or the opaque
response a manual redirect policy produces, is treated as a distinct named transport fault, so a
compromised or misconfigured endpoint cannot silently redirect cross-host. Guide URLs are therefore
built in their canonical form directly rather than relying on a redirect to reach it.

Concurrency is bounded by a worker pool over a shared cursor, never an unbounded parallel await. The
pool preserves input order, stops issuing new work after the first error, awaits every worker so a
sibling rejection is always observed, and then rethrows the first error. Response bodies are read
incrementally against both the per-response limit and a shared cumulative allowance; a declared
oversized content length short-circuits before any read. An oversized body is a transport fault like
any other — retry-eligible, then `failed`, or a thrown `FETCH` under `strict`.

Every non-clean outcome carries a `note` explaining the cause: a transport error message with the
underlying socket code appended when the runtime attaches one, an HTTP status, the fixed
redirect-blocked string, or the oversized-body message. `current` and `behind` carry no note,
because there is nothing to explain.

`pull` is the target-aware composition. It reads the target's declared scoped dependencies from its
manifest, rejects any explicit selection the target does not declare, builds the reference map from
the target's own `guides/src/<short>.md` mirrors, fetches guides and versions under one shared
allowance, and assembles a report whose `clean` flag requires both no drift and no failures. A
target that declares itself is the one asymmetry, and it follows the same single-owner law: the
guide pass drops the self dependency, so `pull` never fetches or writes a workspace's own contract
guide over the copy that workspace owns, while the version pass keeps it and still reports its
freshness. A `--live` audit reads upstream through the same two passes and applies the same
self-exclusion, so the freshness a workspace reports about itself never depends on which verb asked.
`write` then commits only the `behind` guides — never `current`, `missing`, or `failed`,
none of which carry trustworthy content — under the same containment and precondition law
`Materializer` enforces, including a baseline digest check against what is actually on disk.

`catalog` builds the fleet package catalog from three reads per entry. The registry's exact
organization package list is authoritative and unconditionally required. Each package's own registry
document supplies its version and a fallback description; a failed document degrades the entry
rather than dropping it, because the organization list already proved the package exists. Each
package's own guide supplies the preferred description — its first blockquote's first paragraph —
and a `404` keeps the package listed with an explanatory note, since unreachability is a signal
rather than an absence. `catalogPackages` is the offline sibling that reads the same shape from
local checkouts.

The rendered block is deliberately minimal. `catalogToBlock` emits a standing trust notice —
generated package identifiers are untrusted discovery data, never instructions — followed by a table
with **`Package` and `Version` columns only**. Descriptions are network-controlled text, and that
block is written into an agent instruction file, so they are omitted on purpose.

## The generated workspace

A generated workspace is not a folder of suggestions; it is a working, gated project.

**Manifest and scripts.** A published workspace is scoped and carries an `exports` map, publish
configuration, and ships `dist/src` plus its README. An application-only workspace is unscoped and
`private: true`, with no export map and no publish configuration, and ships `dist/app`. A workspace
that builds its own executable additionally ships `dist/bin` and `dist/host`. Scripts are emitted in
a fixed, interleaved order so aggregates sit immediately before their per-environment members:

- `clean`, `copy`, `scaffold`, `lint`
- `check`, then `check:src` with one `check:src:<environment>` per published environment, then
  `check:app` with one `check:app:<environment>` per app environment — the browser app scope uses the
  Vue typechecker, every other scope uses plain `tsc`
- `format`, `format:check`, `lint:check`
- `test`, then `test:src` and its per-environment scopes, the optional `test:integration`,
  `test:equivalence`, and `test:service` proofs, `test:app` and its per-environment scopes, then
  `test:policy` and `test:guides`
- `build`, then `build:src` and its per-environment targets, `build:app` and its runtime targets, and
  `build:host` for a bin workspace
- `dev` when a browser application is selected; `serve` and `serve:build` when a server application
  is selected
- `prepublishOnly` chaining `format:check → lint:check → check → build → test`, followed by
  `test:integration` when the integration axis is selected

**Proof gating.** The opt-in proofs are predictable from the axes alone. `test:integration` rides
the `integration` axis and `test:service` the `service` axis, while `test:equivalence` is emitted
only where `bin` and `integration` are both set:

| Proof              | `npm test` | `prepublishOnly` | CI                         |
| ------------------ | ---------- | ---------------- | -------------------------- |
| `test:integration` | no         | yes, last        | after the standard gates   |
| `test:equivalence` | no         | no               | no                         |
| `test:service`     | no         | never            | after `scripts/service.sh` |

No proof joins the default chain: `npm test` runs the source, application, policy, and guide
projects, and nothing there needs a build artifact or a foreign process. Publication is the one
asymmetry — `prepublishOnly` appends `test:integration`, because a package about to be published
should prove itself against its own built output, while `test:service` is never in that chain.
Neither default testing nor publication starts or requires a foreign process.

When a prerequisite is absent the proof fails rather than skipping. `test:integration` reads the
workspace's own built output, so it belongs after `build` — which is exactly where `prepublishOnly`
and CI put it. `test:service` refuses to start against an unprovisioned service: its setup throws at
module load, which is why CI runs `bash scripts/service.sh` immediately before it. And a script the
axes do not emit is simply not there: `test:equivalence` in a workspace that is not both `bin` and
`integration` is an unknown script rather than a quietly passing one.

The equivalence proof is a dual-path re-run rather than a separate suite. Run
`npm run test:equivalence` after changing the persistent boundary build driver; it invokes the
integration project in dual-path mode and proves each programmatic driver verdict against the
spawned npm-script reference. Ordinary integration runs keep the faster driver-only path.

**Consumer-owned service seams.** The service axis is the one place canon stops at the boundary:
there is no template for a proof project and neither companion path is on `HOST_PATHS`, so a
service workspace owns both of its seams outright. They come as a pair.

- `tests/setupService.ts` is the readiness seam. It probes the foreign process and warms it before
  any test runs, and throws at module load — naming the `service` project — when that process is
  unreachable, so an unprovisioned run fails loudly instead of passing an empty suite. Only the
  `service` project loads it.
- `scripts/service.sh` is the provisioning seam, named once by `SERVICE_SCRIPT_PATH`. It brings that
  process up idempotently — a second run against an already-provisioned service is a no-op rather
  than a second instance — and exits nonzero when it cannot, which is what makes CI's
  `bash scripts/service.sh` step a gate rather than a hint.

The audit expects the script rather than reporting it foreign, on the derive-time warrant the audit
section gives. Repair pruning applies the same exclusion, so it never proposes or removes that
required consumer-owned provisioner.

**Environment isolation.** Scoped TypeScript projects remove the wrong host's globals from each
environment: core scopes carry the WHATWG web-interop surface and no host at all — no DOM, no Node,
no `vite/client`; browser scopes carry DOM and no Node; server scopes carry Node and no DOM. The
worker-only globals the `WebWorker` declarations would otherwise admit — `name`, `onrtctransform`,
`close`, `postMessage`, `dispatchEvent`, `location`, `onerror`, `onlanguagechange`, `onoffline`,
`ononline`, `onrejectionhandled`, `onunhandledrejection`, `self`, `importScripts`, `fonts`, `caches`,
`crossOriginIsolated`, `indexedDB`, `isSecureContext`, `origin`, `scheduler`, `createImageBitmap`,
`reportError`, `cancelAnimationFrame`, `requestAnimationFrame`, `onmessage`, `onmessageerror`,
`addEventListener`, and `removeEventListener` — are fenced out of `src/core` and `app/core` sources
by the policy suite, so the declarations widen what a host-independent module may call without
widening where it may run. On every TypeScript bump, derive this list from the module-scope
global-object `declare var` and `declare function` declarations in the installed
`lib.webworker.d.ts`, then subtract values supplied by `lib.esnext*` or current Node globals. Lint
restricts declared package, alias, and conventional relative imports in the same directions.
Neither replaces the other, and neither replaces the build.

**The generated build boundary.** The emitted configuration carries an environment-boundary plugin
that resolves the real module graph rather than re-implementing a parser. **TypeScript and
JavaScript references are read through Vite's own Oxc/Rolldown AST**; **Vue single-file components
are read through the official SFC compiler**, block by block, including `src`-referenced blocks;
**CSS dependencies are parsed by Vite's bundled Lightning CSS analyzer**; and **HTML attributes,
entities, candidate lists, and metadata use Vite's own HTML parser callbacks**. The plugin runs at
resolve and transform time, checks the finished module graph at build end, rescans every emitted
JavaScript chunk's remaining dynamic imports after optimization and tree-shaking, and audits every
emitted asset's physical source path. Source-level asset URLs are checked before Vite transforms
them, so generated runtime `new URL(...)` expressions are not mistaken for caller input. HTML
`vite-ignore` tokens are reversibly encoded as an HTML character reference before Vite parses the
document, so the attribute cannot opt an element out of Vite's normal HTML graph while the same
text inside a resource URL still decodes to its original filename before resolution. Existing
equivalent character references are shifted before encoding and unshifted afterward, which keeps
comments, text, raw blocks, attributes, adjacent tokens, casing, and user-authored entity spelling
byte-stable. The trusted preparation hook owns the final pre-parse phase; inline proxy code is
restored before module analysis, and the first normal post-parse hook restores the original HTML
spelling. The browser entry begins with a generated, byte-stable security prologue: the doctype,
document and head opening, and a `Content-Security-Policy` meta element are one required prefix.
Preparation rejects a missing, moved, or changed prologue before Vite parses the document, and the
final trusted post-hook verifies that Vite retained the policy. CRLF and LF files are both accepted;
the prologue's markup and ordering are otherwise exact. Vite's `%ENV%` HTML substitution is rejected
before parsing because Vite performs that expansion after every plugin pre-hook, where it could
otherwise create a late control attribute. The guard walks the exact left-to-right `%(\S+?)%`
tokens Vite recognizes instead of performing a substring search, and each preparation plugin owns
the resolved environment/definition keys for its configuration, so one build cannot contaminate
another and overlapping percent text remains ordinary text. Read environment values from the
application's module graph through `import.meta.env` instead.
Asset URLs that force `?inline` are rejected before Vite can read them outside that auditable output
graph. Dynamic imports must use a static quoted string or expression-free template string; even
`/* @vite-ignore */` static values repeat the same environment and containment checks inside the
transform boundary, including inline HTML proxy modules. The transform, load, resolution, emitted
asset, and finished-module-graph passes apply that law only to workspace-owned `src/*` and `app/*`
modules. Resolved ids under any `node_modules` segment, Vite/Vitest virtual ids, and tooling client
injections remain owned by their toolchain and are exempt.

Browser application scripts are modules. Vite's parsed HTML asset callback rejects a classic
external `<script src>` before resolution and directs the author to `type="module"`. A module
script URL must be a non-empty local Vite-graph URL: schemes, protocol-relative URLs, data URLs,
fragments, surrounding URL whitespace, and ASCII C0 controls or DEL are rejected rather than left
as unaudited browser loads. This is deliberately broader than the URL parser's edge stripping.
Numeric
HTML character references and semicolon-terminated named references are rejected before resolution,
so neither control references nor entity-built scheme characters can bypass the boundary. Vite can
begin resolving an entity-decoded module URL before its parsed per-asset callback runs; that earlier
path remains Vite-owned and passes through the environment resolver, which rejects the same full
ASCII control range and every non-Node URL scheme before loading or output. No second HTML parser or global
reference rewrite is involved, so comments, text, non-script attributes, and entity-spelled asset
filenames retain Vite's native parsing and resolution behavior.
The resolver leaves NUL-prefixed and `virtual:` Rolldown/Vite module IDs, tooling client injections,
and every resolved `node_modules` module to the tool that owns that namespace; author module and
asset URLs are extracted and validated before they reach those resolver exceptions.
SVG script `href` and `xlink:href` attributes are parsed too and rejected as classic script loads.
Inline module scripts enter Vite's HTML proxy graph and receive the same Oxc boundary analysis as
module files. Classic inline scripts cannot enter that graph, so the required security prologue places
`Content-Security-Policy` before every author-controlled document token with `script-src 'self'`
and `script-src-attr 'none'`: inline classic code and inline event handlers cannot execute, while
Vite's same-origin external module entry remains usable. `appBrowser()` accepts no configuration
arguments. The returned Vite configuration is one closed trusted unit: its Vue and boundary
plugins, CSS analyzer, dependency optimizer, environment, builder, output pipeline, and HTML asset
callbacks cannot be extended or replaced through the factory. This deliberately excludes arbitrary
Vite, Rolldown, esbuild, PostCSS, worker, environment, builder, externalization, output-injection,
and URL-rewrite hooks that could mutate a dependency, worker graph, bundle, or final asset after
the boundary has inspected it. The computed root Vite configuration is trusted generated code:
wrapping, mutating, or replacing the object returned by `appBrowser()` is outside the factory
contract and is reported as computed-artifact drift by `scaffold audit`. The output-boundary plugin
still rejects public directories, browser asset inlining, and output path overrides in a
post-factory composition as defense in depth; that narrow check is not a general extension seam.

The browser development server applies the same trust boundary before Vite's internal middleware.
Its explicit filesystem allowlist contains only browser/core source roots, browser tests, their
exact setup files, and installed dependencies. The pre-internal middleware decodes direct,
alias-shaped, and `/@fs/` requests, resolves existing targets through their physical paths, and
returns a path-free 403 response unless the target remains in one of those roots. It also rejects
an allowed root whose physical identity escapes the workspace, so neither a nested symlink nor a
linked root can expose `app/server`, `src/server`, repository metadata, or unrelated files.

What it allows is deliberately real-world:

- safe stylesheet `@import`s and `url()` assets;
- HTML-referenced assets, including candidate lists, inline style blocks, and inline module scripts;
- static `new URL('./asset', import.meta.url)` asset references;
- static-string dynamic imports whose decoded source passes the same environment and containment law.

What it rejects is equally deliberate:

- a published `src/*` module reaching into private `app/*`;
- a core module reaching a stylesheet, a browser module, a server module, a Node builtin, or a
  browser or server package subpath;
- a browser module reaching a Node builtin or a server subpath;
- a server module reaching a stylesheet, Vue, or a browser subpath;
- a workspace-relative import that resolves outside the workspace;
- an HTML reference carrying `vite-ignore` that violates the same environment or containment law
  as an ordinary reference, a Vite `%ENV%` HTML substitution, a classic external script, or a
  computed dynamic import in the module graph that would bypass graph resolution;
- a computed or expression-bearing `new URL` asset source that could escape at runtime;
- malformed URI encoding, encoded traversal segments, or a local `file:` URL outside the owning
  environment/package root; file schemes are matched case-insensitively and converted to physical
  paths before containment.

Unsupported stylesheet `@import` or `url()` syntax is an error rather than a silently skipped
dependency. **`publicDir` is disabled on every generated build target**: an asset that is not
reachable through the module graph is not silently copied past the boundary. The output plugin
fails during configuration when a caller attempts to enable `publicDir`; browser builds likewise
reject a nonzero `assetsInlineLimit`, keeping asset bytes external and visible to output auditing
before any output directory mutation. A caller-supplied Rolldown `output.dir` or `output.file` is
also rejected during configuration; the exact generated `build.outDir` is the sole write root.

**The policy suite.** [`tests/setupPolicy.ts`](../../tests/setupPolicy.ts) is a narrow structural
policy pass built on the official TypeScript compiler. It exists for exactly the laws a linter
cannot express — that a centralized module exports every top-level declaration it holds, that
implementation files hold one class and no stray module-scope declaration, that no function is
declared inside another function outside a directly-passed callback, that interface properties are
readonly, that privacy is a runtime `#` field rather than a TypeScript modifier, that a barrel
re-exports only through `export *`, that a core source never names a worker-only global the
`WebWorker` declarations expose, and that a computed dynamic import cannot smuggle a
cross-environment dependency past the declared import rules. Vue components are inspected for the
same evasions. It is a complement to lint and typecheck, never a second type system, and it is not a
general-purpose source analyzer. Generated workspaces receive the same exported policy module as a
host-origin file and run it as a dedicated Node-only `policy` test project over
`tests/policy.test.ts`.

**Real browser capability.** Browser test projects are gated on the real executable: the generated
configuration and the generated policy test both probe `existsSync(chromium.executablePath())`. A
browser suite runs when a real Chromium is installed and is skipped honestly when it is not, rather
than being faked. The gate is applied at registration, not inside the real browser project: without
Chromium, each browser factory is replaced by a same-label Node/no-test placeholder, so generated
`--project <label>` and `--project=<label>` filters still resolve while no browser code runs. The
root permits an empty run only when every recognized exact project filter names one of those gated
placeholders; an unreadable or mixed filter keeps the ordinary no-test failure semantics for its
Node projects. One printed warning names every gated project label. A machine with a browser
registers and runs the real browser suites unchanged; a machine without one runs the remaining
projects and says so.

**Continuous integration.** The generated workflow runs on push and pull request, on
`ubuntu-latest`, with read-only contents permission, a 60-minute timeout, and a matrix that **tests
Node `22.12.0` and `26`** with fail-fast disabled. Checkout and Node setup are pinned to immutable
action commits, and checkout does not persist credentials. Dependencies install with
`npm ci --ignore-scripts`; Chromium is installed only when the workspace selects a browser environment
or builds its own executable. The gates then run in order: `format:check`, `lint:check`, `check`,
`build`, `test`, and the workspace's selected proofs follow as their own named steps, in the order
the proof-gating table gives them.

**Agent orchestration files.** The session hooks in the generated `.claude/settings.json` run the
dependency, model, and external-tool readiness scripts at session start. The **`Stop` hook runs only
`git diff --check`** — a whitespace and conflict-marker check over the working tree, nothing more.
Bash invocation and sensitive reads are controlled by the **settings permission list, not by a guard
script**: every Bash command requires explicit approval, including commands Claude Code otherwise
classifies as read-only. Read-only reviewer, checker, and ecosystem roles carry no Bash tool; the
orchestrator supplies their diff and status evidence. Bridge, writer, and verifier roles request
approval when their bounded shell work is needed. Read patterns covering environment files,
package-manager credentials, credential stores, private keys, key stores, SSH, cloud credentials,
container configuration, `.kube`, kubeconfig, and service-account JSON are denied. There is no
guard script in the vendored set, and none is expected.

The generated `.codex/config.toml` and `.codex/agents/` mirror the same bounded research, design,
implementation, checking, and review roles for Codex. Codex has no repository settings/hook file:
each Codex agent's declared `sandbox_mode` is its mechanical permission floor, while the shared
`AGENTS.md`, rules, and skills provide the same writing and acceptance contract to both providers.

## The `scaffold` executable

The bin is a thin command-line shell over the two library faces. It exports nothing, so it carries
no module API of its own. Six verbs:

| Verb      | Purpose                                                  |
| --------- | -------------------------------------------------------- |
| `new`     | scaffold a workspace into `./<name>`                     |
| `pull`    | refresh vendored guides and versions, report drift       |
| `audit`   | whole-plan conformance report                            |
| `repair`  | restore host-owned files and optional generated canon    |
| `fleet`   | audit or repair every workspace under the cwd's children |
| `catalog` | regenerate the fleet package-catalog table               |

**Environment selection.** `new` takes `--src a,b` for published library environments and
`--app a,b` for private application environments. They are independent: `--src core,server` builds a library,
`--app core,browser,server` builds an application, and passing both builds a mixed workspace. Each
accepts any subset of `core`, `browser`, and `server`, and the gate rejects the one combination that
has no defined configuration class. `--deps x,y` adds runtime dependencies and requires each flag
token to use its full valid package name; only the interactive dependency prompt expands an
Orkestrel short name. Other npm packages are not a creation-time flag — add them to the generated
manifest's development dependencies afterwards, and they round-trip through `deriveBlueprint`'s
extras so the workspace stays audit-clean.

**Other flags.** `--target <path>` selects the directory a verb operates on. `--from <path>` is
repeatable and points at a local template or catalog source instead of the bundled one.
On `pull`, `--deps x,y` limits refresh to those declared Orkestrel dependencies; without it, every
declared dependency mirror is considered.
`--groups a,b` scopes an audit to artifact groups. `--live` adds an upstream freshness check to an
audit. `--strict` makes a pull throw on a network fault. `--offline` restricts a catalog to local
sources. `--prune` opts a repair or fleet run into deleting unexpected files under the three prune
directories. `--generated` opts a repair or fleet run into restoring generated canon except
`package.json`; on `audit`, it is inherited if the interactive repair hand-off is accepted.
`--json` emits one machine-readable value. `--apply` writes, `--yes` skips the confirmation, and
`-h` or `--help` prints usage.

**Safety model.** Every verb is a dry run by default. On a terminal a write asks for confirmation
first, defaulting to no; in a script, `--apply` writes and `--yes` skips the question. Every write is
confined to the working directory, so the instruction is to change into it first rather than to pass
a root. `repair` asks a second, separately defaulted question before deleting anything, and a
non-interactive session without `--apply` or `--yes` skips pruning rather than guessing. `fleet`
operates on the immediate children of the working directory and never on the directory itself, and
it has no root flag at all — `repair` is the single-workspace tool.

`fleet` and default `repair` are scoped to host-origin artifacts. `repair` states its selected scope
in the output; `--generated` widens both verbs to generated files while still excluding starter
files and `package.json`.

**Catalog markers.** `catalog` rewrites the block between `<!-- catalog:start -->` and
`<!-- catalog:end -->` in `.claude/agents/orkestrel.md`. **Ambiguous markers fail before any
mutation**: the file must contain exactly one ordered pair. A missing marker, a reversed pair, or a
repeated marker of either kind is a coded `TARGET` failure raised before the file is touched, and
the run reports the drift and any row-count shrink rather than rewriting a file it cannot bound.

**Certificates.** **When the running Node release exposes the system-CA APIs**, the executable
merges the operating system trust store into the default certificates, so fetches behind a
TLS-inspecting proxy behave like other tooling instead of failing against the bundled list alone.
The check is a feature detection: **earlier supported Node 22 releases simply use Node's default
roots**. It only ever adds trusted issuers — nothing disables verification — and a failure is a
silent no-op rather than a crash. Custom PEMs are added through the standard environment variable.

**Exit codes.** `0` is clean or successful, `1` is drift or failure, `2` is a usage error. An audit
exits non-zero on any drift, foreign files included, which makes it usable directly as a CI gate. A
pull exits non-zero on any drift or failure whether or not `--strict` was passed; `--strict`
additionally throws on a network fault. Every unknown verb is a usage error and gets a nearest-match
suggestion when one is sufficiently close.

## Package contents

The published package is `@orkestrel/scaffold`. Its entry points are the core barrel at `.` and the
server barrel at `./server`, both with dual import and require conditions and matching declaration
files, plus `./package.json`. The `scaffold` binary maps to the built executable.

The published file set is exactly `dist/src`, `dist/bin`, `dist/host`, and `README.md`. `dist/host`
is the vendored data root: the byte-preserved host files plus the `manifest.json` recording their
storage names, destinations, and executable bits. Storage names are un-dotted, because a leading dot
does not survive packaging intact; the manifest is what maps a storage name back to its real
destination. That is also why the default host is resolved from the installed module's own
location — the package carries its host data with itself, and a caller-supplied raw repository root
is the explicit alternative, mapping sources 1:1 with no manifest indirection.

Six runtime dependencies, all scoped: the contract toolkit behind the shape, guard, parser, and
safe-attempt primitives; the emitter behind every entity's observation channel; the markdown AST and
renderer behind the table and blockquote work; the template engine behind every template-origin
artifact; and, consumed only at the executable boundary, the terminal prompt toolkit and the console
reporter. The core face uses the first four and stays pure; the server face adds only `node:*`
builtins. Development dependencies are the shared tooling baseline plus the guide-parity toolkit
that drives [`parity.test.ts`](../../tests/guides/src/parity.test.ts). The engines floor is Node
`>=22.12.0`, and the build emits ES and CJS for both library faces plus an ES executable.

## Patterns

### Authoring and validating a blueprint

```ts
import {
	blueprint,
	blueprintToMembers,
	createBlueprint,
	dependency,
	hasBlueprintEnvironment,
	hasValidBlueprintBytes,
	hasValidOverrideBytes,
	isWorkspaceName,
	member,
	override,
	pascalCase,
	validateBlueprint,
	validateDependencyArray,
} from '@orkestrel/scaffold'

const spec = blueprint('router', {
	src: ['core', 'browser'],
	dependencies: [dependency('@orkestrel/contract', '^0.0.7')],
	peers: [dependency('@orkestrel/server', '^0.0.3', true)],
	overrides: [override('README.md', '# router\n')],
})

pascalCase('my-router') // 'MyRouter'
isWorkspaceName('router') // true
hasBlueprintEnvironment(spec) // true
hasValidBlueprintBytes(spec) // true
hasValidOverrideBytes(override('README.md', '# router\n')) // true
validateDependencyArray('dependencies', spec.dependencies).questions // []
validateBlueprint(spec).valid // true
blueprintToMembers(spec)[0] // { name: 'Router', category: 'entity', … }
member('RouterOptions', 'type', 'Options for creating a Router.')

// The validating constructor throws instead of returning questions.
createBlueprint({ name: 'router', src: ['core'] })
```

### Compiling, gating, and pinning

```ts
import {
	applyOverrides,
	blueprint,
	blueprintToPlan,
	computeHash,
	createCompiler,
	hasValidArtifactBytes,
	hasValidArtifactHex,
	hasValidPlanBytes,
	hasValidPlanHex,
	pinPlan,
	planPayload,
	stableStringify,
	validatePlan,
} from '@orkestrel/scaffold'

const compiler = createCompiler()
const spec = blueprint('router', { src: ['core'] })

const scaffolding = compiler.compile(spec)
scaffolding.stages.map((record) => record.stage) // ['draft', 'gate', 'pin']

const audit = compiler.audit(spec, {})
audit.missing // every artifact — nothing exists at the target yet

const plan = pinPlan(blueprintToPlan(spec, ['manifest', 'configs']))
validatePlan(plan).valid // true
plan.trace?.includes('src:core · app:none') // true
planPayload(plan) === planPayload({ ...plan, trace: 'ignored by identity' }) // true
hasValidPlanHex(plan) // true
hasValidPlanBytes(plan) // true
plan.artifacts.every(hasValidArtifactHex) // true
plan.artifacts.every(hasValidArtifactBytes) // true
computeHash(stableStringify(plan.blueprint)) === computeHash(stableStringify(spec)) // true
applyOverrides(plan.artifacts, spec.overrides).length // unchanged when nothing matches

compiler.destroy()
```

### Registering plans by content hash

```ts
import { blueprint, blueprintToPlan, createPlanManager } from '@orkestrel/scaffold'

const plans = createPlanManager()
const record = plans.add(blueprintToPlan(blueprint('router', { src: ['core'] })))

record.id === record.hash // true — the id is minted from content
record.version // 1
plans.has(record.id) // true
plans.plan(record.id) // the record
plans.plans().length // 1
plans.remove([record.id]) // true — all-or-nothing over a list
plans.remove() // removes everything
plans.destroy()
```

### Projecting a plan, an audit, and a report

```ts
import type { Audit, Plan, SyncReport } from '@orkestrel/scaffold'
import {
	alignTable,
	auditToReview,
	catalogNames,
	catalogToBlock,
	delimiterCell,
	guideMemberTable,
	padCell,
	planToReview,
	planToSummary,
	splitTableRow,
	syncToReview,
} from '@orkestrel/scaffold'

declare const plan: Plan
declare const audit: Audit
declare const report: SyncReport

alignTable(['API', 'Kind'], [['`createRouter`', 'function']])
splitTableRow('| a | b |') // ['a', 'b']
padCell('ab', 5) // 'ab   '
delimiterCell('left', 5) // ':----'

catalogToBlock([{ name: '@orkestrel/router', version: '0.0.5', description: '' }])
catalogNames('| @orkestrel/router | 0.0.5 |') // ['@orkestrel/router']

planToSummary(plan).artifacts // the artifact count
planToReview(plan) // the copy-ready dry-run review document
auditToReview(audit) // findings grouped by drift, aligned entries elided
syncToReview(report) // guides and versions, each in its own table
guideMemberTable('entity', [])
```

### Exact bytes, snapshots, and drift

```ts
import type { Plan } from '@orkestrel/scaffold'
import {
	bytesToHex,
	contentByteLength,
	contentCodePoint,
	contentToBytes,
	contentToHex,
	diffPlan,
	findFileConflict,
	findPathConflict,
	hasValidAuditBytes,
	hasValidSnapshotBytes,
	inferGroup,
	snapshotOf,
} from '@orkestrel/scaffold'

declare const plan: Plan

contentCodePoint('a', 0) // 97
contentByteLength('ab') // 2
bytesToHex(contentToBytes('ab')) === contentToHex('ab') // true

const current = snapshotOf({ 'package.json': '{}\n' })
hasValidSnapshotBytes(current) // true

const audit = diffPlan(plan, current)
hasValidAuditBytes(audit) // true
inferGroup('src/core/index.ts') // 'source'

findPathConflict(['a/b.ts', 'A/B.ts']) // the first case-insensitive collision
findFileConflict(['a', 'a/b.ts']) // a file nested inside another planned path
```

### Format-stable JSON and generated text

```ts
import {
	compareCodeUnit,
	computeColumnWidth,
	escapeHtmlText,
	formatJson,
	renderArray,
	renderObject,
	renderValue,
	serializeTypeScriptString,
} from '@orkestrel/scaffold'

formatJson({ lib: ['ESNext', 'DOM'] }) // '{\n\t"lib": ["ESNext", "DOM"]\n}\n'
renderValue('ESNext', '', '', '') // '"ESNext"'
renderArray(['ESNext', 'DOM'], '', '', '') // '["ESNext", "DOM"]'
renderObject({ lib: ['ESNext'] }, '') // '{\n\t"lib": ["ESNext"]\n}'
computeColumnWidth('\t"a"') // 3

escapeHtmlText('<app & "team">') // '&lt;app &amp; &quot;team&quot;&gt;'
serializeTypeScriptString("app's") // "'app\\'s'"
const sorted = ['b', 'a'].sort(compareCodeUnit) // ['a', 'b']
```

### Shapes, guards, and parsers

```ts
import {
	artifactShape,
	blueprintShape,
	dependencyShape,
	hasValidSyncReportBytes,
	isArtifact,
	isBlueprint,
	isCompilerEventHooks,
	isDependency,
	isMember,
	isOverride,
	isPlan,
	isPlanManagerEventHooks,
	isScaffoldError,
	isSyncReport,
	memberShape,
	overrideShape,
	ownDataValue,
	parseBoundedJSON,
	parseCompilerOptions,
	parseBlueprint,
	parsePlan,
	parsePlanIds,
	parsePlanManagerOptions,
	parseSyncReport,
	planShape,
	ScaffoldError,
	snapshotPlan,
	syncReportShape,
} from '@orkestrel/scaffold'

declare const value: unknown

dependencyShape()
overrideShape()
blueprintShape()
memberShape()
artifactShape()
planShape()
syncReportShape()

isDependency({ name: '@orkestrel/contract', range: '^0.0.7' }) // true
isOverride({ path: 'README.md', content: '# router\n' }) // true
isMember({ name: 'Router', category: 'entity', summary: 'The Router entity.', environment: 'core' })
isArtifact({ path: 'README.md', group: 'docs', origin: 'template', content: '# router\n' })
ownDataValue({ name: 'router' }, 'name') // 'router'

parseBoundedJSON('"ready"', (candidate): candidate is string => typeof candidate === 'string', 7)
parseCompilerOptions({ on: { destroy: () => undefined } })
parseBlueprint('{"not":"a blueprint"}') // undefined — never throws
parsePlan(undefined) // undefined
parsePlanIds(['first', 'second']) // frozen owned ids
parsePlanManagerOptions({ plans: [] }) // exact owned constructor options
parseSyncReport('{}') // undefined
const parsedPlan = parsePlan(value)
if (parsedPlan !== undefined) Object.isFrozen(snapshotPlan(parsedPlan).blueprint)

if (isBlueprint(value)) value.src
if (isPlan(value)) value.artifacts
isCompilerEventHooks({ compile: () => undefined }) // true
isPlanManagerEventHooks({ add: (id) => id.length > 0 }) // true
if (isSyncReport(value)) hasValidSyncReportBytes(value)

try {
	throw new ScaffoldError('INVALID', 'Blueprint failed the exact-record contract')
} catch (error) {
	if (isScaffoldError(error)) error.code // 'INVALID'
}
```

### Drafting artifacts group by group

```ts
import {
	applicationArtifacts,
	blueprint,
	blueprintToMembers,
	ciWorkflow,
	configArtifacts,
	devDependenciesFor,
	dualCondition,
	entryFields,
	exportsMap,
	fillArtifact,
	guideArtifacts,
	guideMethods,
	guideTests,
	guideUsage,
	hostGroup,
	packageManifest,
	paritySpecifiers,
	selectHostPaths,
	sourceArtifacts,
	srcVariant,
	testArtifacts,
} from '@orkestrel/scaffold'

const spec = blueprint('router', { src: ['core'], app: ['core', 'server'] })
const members = blueprintToMembers(spec)

hostGroup('AGENTS.md') // 'docs'
selectHostPaths(['guides/src/router.md', 'LICENSE'], spec.name) // ['LICENSE'] — never its own guide
srcVariant(['core', 'server']) // 'multi'
entryFields(['browser']).main // './dist/src/browser/index.js'
dualCondition('./dist/src/core/index')
exportsMap(['core'])['.']
devDependenciesFor(spec).typescript
packageManifest(spec) // the whole manifest, newline-terminated

configArtifacts(spec).length
sourceArtifacts(spec, 'Router').length
applicationArtifacts(spec).length
testArtifacts(spec, 'Router').length
guideArtifacts(spec, 'Router', members).length
paritySpecifiers(spec).includes('SELF_SPECIFIERS') // true
guideUsage(spec, 'Router')
guideMethods(spec)
guideTests(spec, 'Router')
ciWorkflow(spec).includes("node: ['22.12.0', '26']") // true

fillArtifact('README.md', 'docs', 'readme', {
	name: 'router',
	title: '@orkestrel/router',
	description: 'A tiny hash router.',
	install: '',
	usage: '',
})
```

### Emitting the generated build and check configuration

```ts
import {
	appTsconfig,
	appViteConfig,
	applicationViteConfig,
	binViteProject,
	coreTsconfig,
	coreViteConfig,
	guidesViteProject,
	integrationViteProject,
	policyViteProject,
	renderViteTest,
	rootTsconfig,
	rootViteConfig,
	serviceViteProject,
	singleSrcViteConfig,
	srcTsconfig,
	srcViteConfig,
	viteHeader,
	viteMachinery,
	viteProjectDefinitions,
	viteProjectRegistrations,
} from '@orkestrel/scaffold'

rootTsconfig(['core'], ['core', 'server'])
coreTsconfig()
srcTsconfig('server')
appTsconfig('browser', true)

viteMachinery(['core']) // { browser: false, vue: false, output: true }
viteMachinery([], ['core', 'browser']) // { browser: true, vue: true, output: true }
renderViteTest([{ project: 'srcCore' }], false).includes('projects: [srcCore]') // true
viteHeader(viteMachinery([], ['core', 'browser'])) // the shared header, with browser and Vue support
coreViteConfig()
srcViteConfig('browser')
appViteConfig('server')
policyViteProject()
guidesViteProject()
binViteProject()
integrationViteProject({ bin: true, integration: true })
serviceViteProject()
viteProjectDefinitions({ integration: true }).includes('export const integration =') // true
viteProjectRegistrations(['core'], [], { integration: true }).map(({ project }) => project)
// ['srcCore', 'policy', 'guides', 'integration']

rootViteConfig(['core', 'server'], { bin: true })
singleSrcViteConfig('server').includes('srcServer') // true
applicationViteConfig([], ['core', 'server']).includes('appServer') // true
```

### Reading declared dependencies and comparing freshness

```ts
import {
	isBehind,
	manifestToDependencies,
	manifestToName,
	rangeToFreshness,
} from '@orkestrel/scaffold'
import {
	guideStub,
	packageShortName,
	readGuideReferences,
	syncReportOf,
} from '@orkestrel/scaffold/server'

manifestToDependencies('{"dependencies":{"@orkestrel/contract":"^0.0.7"}}')
manifestToName('{"name":"@orkestrel/router"}') // '@orkestrel/router' — the target's own name
rangeToFreshness('^0.0.7', '0.0.7') // 'current'
isBehind(rangeToFreshness('^0.0.7', '0.0.9')) // true

packageShortName('@orkestrel/contract') // 'contract'
guideStub('guides/src/contract.md') // the local pointer content
readGuideReferences('./packages/router', [{ name: '@orkestrel/contract', range: '^0.0.7' }])
syncReportOf('./packages/router', [], []) // { clean: true, failed: 0, … }
```

### Materializing, repairing, and pruning a target

```ts
import { blueprint, blueprintToPlan, diffPlan } from '@orkestrel/scaffold'
import {
	createMaterializer,
	hostRoot,
	hydratePlan,
	isVacant,
	locateHostSource,
	readHostManifest,
	readManifest,
	readTarget,
	remapArtifactPath,
	stageHost,
	storagePath,
} from '@orkestrel/scaffold/server'

const host = hostRoot()
readHostManifest(host) // the vendored manifest, or undefined for a raw root
storagePath('.claude/agents/reviewer.md') // 'claude/agents/reviewer.md'
locateHostSource(undefined, 'package.json', host)

const plan = hydratePlan(blueprintToPlan(blueprint('router', { src: ['core'] })), host)
remapArtifactPath(
	{ path: '.claude/agents', group: 'orchestration', origin: 'host' },
	'.claude/agents',
)

const materializer = createMaterializer()
isVacant('./packages/router-new') // true — absent, empty, or only a .git dir
materializer.materialize(plan, './packages/router-new')

readManifest('./packages/router')
const current = readTarget(
	'./packages/router',
	plan.artifacts.map((artifact) => artifact.path),
)
materializer.repair(plan, diffPlan(plan, current), './packages/router')
materializer.prune('./packages/router', {})
materializer.destroy()

stageHost(process.cwd(), 'dist/host').length // the number of files staged
```

### Pulling guides and versions

```ts
import { createSync } from '@orkestrel/scaffold/server'

const sync = createSync({ concurrency: 4, retries: 1 })

const report = await sync.pull('.')
if (report.failed === 0) await sync.write(report, '.')

const deps = [{ name: '@orkestrel/contract', range: '^0.0.7' }]
await sync.guides(deps)
await sync.versions(deps)
await sync.catalog()

sync.destroy()
```

### Fleet discovery, prune scanning, and the local catalog

```ts
import {
	catalogPackages,
	consumeCatalogAllowance,
	deriveBlueprint,
	discoverPackages,
	guideToDescription,
	isRealDirectory,
	isRealFile,
	listDirectories,
	listFiles,
	pruneTargets,
	selectOrkestrelEntries,
	vendoredPruneSet,
} from '@orkestrel/scaffold/server'

const catalogAllowance = new Float64Array([2])
consumeCatalogAllowance(catalogAllowance, './packages') // one aggregate slot remains
discoverPackages('./packages') // every scoped workspace directly under the root
deriveBlueprint('./packages/router') // the faithful inverse an audit diffs against
selectOrkestrelEntries({ '@orkestrel/contract': '^0.0.7', vite: '^8.1.5' })

isRealDirectory('./packages/router')
isRealFile('./packages/router/package.json')
listFiles('./packages/router/.claude/agents')
listDirectories('./packages/router/.claude')

vendoredPruneSet('./dist/host', '.claude/agents')
pruneTargets('./packages/router', './dist/host') // never deletes; reports only

guideToDescription('> A tiny hash router.\n>\n> More detail.') // 'A tiny hash router.'
catalogPackages(['./packages'], 4_096)
```

### The write-transaction boundary

```ts
import {
	commitWriteTransaction,
	createWriteDirectory,
	digestFile,
	digestHex,
	digestText,
	discardWriteTransaction,
	readFileHex,
	readFileText,
	replaceDirectory,
	resolveContainedPath,
	resolveGuideWrites,
	resolvePhysicalPath,
	resolveRealPath,
	restoreFiles,
	validateWriteAnchor,
	validateWriteDirectories,
	validateWriteTarget,
	WriteTransaction,
} from '@orkestrel/scaffold/server'

resolveRealPath('./packages/router/src')
resolveContainedPath('./packages/router', 'src/core/index.ts', 'TARGET', 'target')
const full = resolvePhysicalPath('./packages/router', 'package.json', 'TARGET', 'target')

digestText(readFileText('./packages/router', 'package.json', 'TARGET', 'target')) ===
	digestFile(full)
digestHex(readFileHex('./packages/router', 'package.json', 'TARGET', 'target'))

const transaction = WriteTransaction.create('./packages/router', ['package.json'])
validateWriteAnchor(transaction.anchor, 'anchor')
validateWriteDirectories(transaction)
validateWriteTarget(transaction, undefined)
createWriteDirectory(transaction.stage, 'staging')

try {
	commitWriteTransaction(transaction, ['package.json'])
} catch {
	restoreFiles(transaction, ['package.json'])
	discardWriteTransaction(transaction)
}

replaceDirectory('./staged', './target', './backup')
resolveGuideWrites([], './packages/router') // preflighted destinations, before any write
```

### Server boundary parsing and guards

```ts
import { hasOnlyDataProperties, isDenseDataArray, isEmitterErrorHandler } from '@orkestrel/scaffold'
import {
	isCatalogAllowance,
	isCatalogDescription,
	isDependencyData,
	isFilesystemPath,
	isHostManifest,
	isManifestEntry,
	isMaterializerEventHooks,
	isMissingPathError,
	isPortablePath,
	isReservedTargetPath,
	isSensitiveHostPath,
	isSyncEventHooks,
	isTerminalText,
	isWritePrecondition,
	materializerOptionsContract,
	materializerOptionsShape,
	parseFilesystemPaths,
	parseMaterializerOptions,
	parsePortablePaths,
	parseSyncBase,
	parseSyncBranch,
	parseSyncCurrent,
	parseSyncDependencies,
	parseSyncOptions,
	parseWritePreconditions,
	syncGuideOptionsShape,
	syncOptionsContract,
	syncOptionsShape,
	syncRegistryOptionsShape,
} from '@orkestrel/scaffold/server'

declare const caught: unknown

syncGuideOptionsShape()
syncRegistryOptionsShape()
syncOptionsShape()
materializerOptionsShape()
syncOptionsContract.parse({ concurrency: 4 })
materializerOptionsContract.parse({ host: './dist/host' })

parseSyncOptions({ guides: { branch: 'main' }, registry: { timeout: 5_000 } })
parseMaterializerOptions({ host: './dist/host' })
parseSyncBase('registry.npmjs.org') // 'https://registry.npmjs.org'
parseSyncBranch('main')
parseSyncCurrent({ '@orkestrel/contract': '# contract\n' }, ['@orkestrel/contract'], 16_777_216)
parseSyncDependencies([{ name: '@orkestrel/contract', range: '^0.0.7' }], false)
parsePortablePaths(['src/core/index.ts'], 1_000)
parseFilesystemPaths(['./packages'], 1_000)
parseWritePreconditions([{ path: 'package.json', shape: 'absent' }], 1_000)

isPortablePath('src/core/index.ts') // true
isFilesystemPath('./packages/router') // true
isTerminalText('router') // true
isDependencyData({ name: '@orkestrel/contract', range: '^0.0.7' }) // true
isSensitiveHostPath('.env.local') // true
isReservedTargetPath('.git/config') // true
isCatalogAllowance(new Float64Array([1])) // true
isCatalogDescription('A tiny hash router.') // true
hasOnlyDataProperties({ a: 1 }) // true
isDenseDataArray(['a'], 10, isPortablePath) // true
isWritePrecondition({ path: 'package.json', shape: 'absent' }) // true
isManifestEntry({ storage: 'AGENTS.md', destination: 'AGENTS.md', executable: false }) // true
isHostManifest({ entries: [], roots: [] }) // true
isSyncEventHooks({ done: () => undefined }) // true
isMaterializerEventHooks({ done: () => undefined }) // true
isEmitterErrorHandler(() => undefined) // true
isMissingPathError(caught) // true only for an ENOENT error
```

## Tests

- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — the pure leaves: table
  alignment, byte encoding, snapshots, host selection, conflicts, projections, hashing, and
  format-stable JSON.
- [`tests/src/core/builders.test.ts`](../../tests/src/core/builders.test.ts) — the blueprint,
  dependency, override, and member builders, including optional-field omission.
- [`tests/src/core/validators.test.ts`](../../tests/src/core/validators.test.ts) — every guard and
  refinement against valid, off-contract, hostile, and boundary input.
- [`tests/src/core/shapers.test.ts`](../../tests/src/core/shapers.test.ts) — per-shape guard
  exactness, schema essentials, seeded generation, and parse round-trips.
- [`tests/src/core/compilers.test.ts`](../../tests/src/core/compilers.test.ts) — every drafted
  group, the manifest and exports combination rules, the one-owner guide law for a workspace that
  names a line guide, and the emitted configuration text.
- [`tests/src/core/Compiler.test.ts`](../../tests/src/core/Compiler.test.ts) — the three-stage
  pipeline, the fail-closed gate, the emission sequences, and post-destroy behavior.
- [`tests/src/core/PlanManager.test.ts`](../../tests/src/core/PlanManager.test.ts) — content-hash
  ids, the batch-overload semantics, and all-or-nothing list removal.
- [`tests/src/core/policy.test.ts`](../../tests/src/core/policy.test.ts) — the repository coding-law
  policy module against this workspace and against deliberately hostile fixtures.
- [`tests/src/server/helpers.test.ts`](../../tests/src/server/helpers.test.ts) — containment,
  digests, host staging, hydration, derivation, prune scanning, and the local catalog.
- [`tests/src/server/validators.test.ts`](../../tests/src/server/validators.test.ts) — the portable
  path law, data-only reflection, and the exact-shape record guards.
- [`tests/src/server/Materializer.test.ts`](../../tests/src/server/Materializer.test.ts) —
  green-field writes, scoped repair, prune quarantine and rollback, and every fail-closed preflight.
- [`tests/src/server/Sync.test.ts`](../../tests/src/server/Sync.test.ts) — freshness verdicts,
  bounded concurrency, redirect and oversize handling, strict mode, pull, write, and catalog against
  protocol-faithful fixture servers.
- [`tests/src/server/integration.test.ts`](../../tests/src/server/integration.test.ts) — the whole
  compile, materialize, audit, repair round trip against real directories.
- [`tests/src/bin/helpers.test.ts`](../../tests/src/bin/helpers.test.ts) — the executable's rendered
  verdicts, tables, notes, and suggestion machinery.
- [`tests/src/bin/parsers.test.ts`](../../tests/src/bin/parsers.test.ts) — argument parsing, token
  splitting, and pull-selection resolution against a target's declared dependencies.
- [`tests/src/bin/validators.test.ts`](../../tests/src/bin/validators.test.ts) — the verb
  vocabulary.
- [`tests/src/bin/errors.test.ts`](../../tests/src/bin/errors.test.ts) — the executable's exit
  signalling.
- [`tests/src/bin/scaffold.test.ts`](../../tests/src/bin/scaffold.test.ts) — each verb's dry-run,
  confirm, apply, and JSON paths.
- [`tests/src/bin/e2e.test.ts`](../../tests/src/bin/e2e.test.ts) — the built executable driven end
  to end over real directories.
- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — this guide against
  the two barrels: every export documented, every documented symbol real, every interface method
  matched, every documented function exampled, and every link resolvable.

## See also

- [`AGENTS.md`](../../AGENTS.md) — the coding contract every generated workspace inherits.
- [`README.md`](../README.md) — the guides index.
- [`contract.md`](contract.md) — the shape, guard, parser, and outcome primitives the blueprint and
  plan contracts compile through.
- [`emitter.md`](emitter.md) — the observation channel every entity here composes.
- [`markdown.md`](markdown.md) — the AST and renderer behind the table and blockquote work.
- [`template.md`](template.md) — the pure fill engine behind every template-origin artifact.
- [`terminal.md`](terminal.md) and [`console.md`](console.md) — the prompt and reporter toolkits
  consumed only at the executable boundary.
- [`guide.md`](guide.md) — the guides-parity toolkit this guide is checked with.
