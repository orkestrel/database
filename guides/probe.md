# Probe

> **The claim prover for the `@orkestrel` line.** `@orkestrel/probe` answers this question about a
> proposed edit: does it compile, lint, and pass its test in this workspace? It holds resident
> TypeScript, Oxlint, and Vitest engines, runs a claim's case and its negative control through all
> of them, and returns a `Verdict` carrying every issue — and, when the case ran clean and the
> control broke where it said it would, a `receipt`. Source: [`src/core`](../src/core),
> [`src/server`](../src/server), [`src/bin`](../src/bin). Published through `@orkestrel/probe` and
> `@orkestrel/probe/server`.
>
> **An agent is the caller this exists for.** Deciding whether an edit compiles by reasoning about
> it costs more than asking, and the answer is a guess. A `Claim` states the edit and what would
> falsify it; a `Verdict` answers with the tools the workspace's own gate runs.
>
> **Mechanism, not policy.** probe reports evidence and mints a receipt under stated conditions. It
> holds no key, signs nothing, and compels nothing. It also **executes caller-supplied test code
> with the privileges of the process that hosts it**, so give a probe a workspace and a caller you
> already trust with a shell.

A `Claim`, a `Verdict`, and a `receipt` carry the package. A `Claim` is the question: a case, a
control that must break, and the TypeScript project both are judged under. A `Verdict` is the
answer: one `Check` per stage in each phase, the case and the control. A `receipt` is the verdict's
one-line summary of the conditions it was reached under, and it exists only when the claim proved
itself.

## Surface

### Contracts

The data shapes, from [`types.ts`](../src/core/types.ts). Every property is readonly, and an absent
optional field is absent rather than empty.

| Name                | Kind      | Shape / Purpose                                                                                                                                                                             |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Stage`             | type      | `'type' \| 'lint' \| 'runtime'` — the inspections every claim passes through, derived from `PROBE_STAGES`.                                                                                  |
| `Draft`             | interface | `{ path, text }` — one proposed file's contained workspace-relative path and its full contents. The path need not exist on disk.                                                            |
| `Case`              | interface | `{ files, test }` — the candidate drafts a claim asserts about and the test that exercises them.                                                                                            |
| `Control`           | interface | `Case` plus `{ stage, reason }` — the negative control, naming the stage it must fail at and why.                                                                                           |
| `Claim`             | interface | `{ project, case, control }` — everything one `prove` call needs.                                                                                                                           |
| `Party`             | type      | `'claimant' \| 'workspace' \| 'instrument'` — the party that must act on an issue or a failure.                                                                                             |
| `Issue`             | interface | `{ origin, path, message, range? }` — one message a stage reported and the party that must act on it. `range` is a zero-based UTF-16 `LSPRange`, absent when the tool reported no location. |
| `Check`             | interface | `{ stage, elapsed, issues }` — one stage's outcome. An empty `issues` list is the clean result; there is no separate pass flag.                                                             |
| `Toolchain`         | interface | `{ typescript, oxlint, vitest }` — the resolved versions the verdict was produced with.                                                                                                     |
| `Project`           | interface | `{ path, digest }` — the resolved TypeScript project that judged the candidates, and the digest of its compiler options.                                                                    |
| `Verdict`           | interface | `{ id, digest, toolchain, project, reason?, case, control, elapsed, receipt? }` — the full result. `Probe.prove` always carries the control reason.                                         |
| `ProbeEventMap`     | type      | The observation surface: `arm`, `prove`, `expire`, and `error`.                                                                                                                             |
| `ProbeOptions`      | interface | `{ on?, error?, workspace?, deadline? }` — the construction input. `workspace` defaults to the working directory and `deadline` to 30,000 ms.                                               |
| `ProbeInterface`    | interface | The coordinator contract; its readonly `emitter` and `toolchain` are data. See [`## Methods`](#methods).                                                                                    |
| `ProbeErrorCode`    | type      | `'refused' \| 'missing' \| 'malformed' \| 'destroyed' \| 'deadline'` — the condition that ended one operation.                                                                              |
| `ProbeErrorContext` | interface | `{ stage?, path?, project?, name?, deadline?, value? }` — the structured detail a failure reports. Every member is absent unless the failure has it.                                        |
| `ProbeErrorOptions` | interface | `{ origin, code, context?, cause? }` — the construction input for a `ProbeError`. Both classification axes are required.                                                                    |

### Constants

From [`constants.ts`](../src/core/constants.ts). Each is frozen.

| Name                   | Kind  | Value / Purpose                                                                                                            |
| ---------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| `PROBE_STAGES`         | const | `['type', 'lint', 'runtime']` — the stage order a verdict reports. The `Stage` type derives from it.                       |
| `PROBE_PARTIES`        | const | `['claimant', 'workspace', 'instrument']` — the parties an issue or a failure can name.                                    |
| `RECEIPT_PREFIX`       | const | `'probe'` — the leading token of every receipt.                                                                            |
| `RECEIPT_SEPARATOR`    | const | `':'` — the character joining a receipt's fields.                                                                          |
| `PROBE_ERROR_CODES`    | const | `['refused', 'missing', 'malformed', 'destroyed', 'deadline']` — the conditions the guard admits.                          |
| `PROBE_DEADLINE`       | const | `30_000` — the default inspection deadline `Probe` applies when construction omits one.                                    |
| `LINT_DEADLINE`        | const | `2_000` — the lint stage's lifecycle bound over its `initialize` and `shutdown` exchanges.                                 |
| `PROBE_KEYS`           | const | `4096` — the total enumerable key bound `ProbeServer` applies to inbound metadata and produced tool content alike.         |
| `PROBE_SPECIFICATIONS` | const | `64` — the specification lifetime the runtime stage replaces its resident Vitest service at.                               |
| `RUNTIME_PLUGIN`       | const | `'orkestrel-runtime-overlay'` — the Vite plugin the runtime stage installs into a target workspace's Vitest configuration. |

### Errors

The failure type every served claim reports through, and its guard, from
[`errors.ts`](../src/core/errors.ts).

| Name                   | Kind     | Signature                                           | Behavior                                                                                                                                  |
| ---------------------- | -------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ProbeError`           | class    | `new (message: string, options: ProbeErrorOptions)` | Reports one failure under an `origin` and a `code` a caller branches on, with optional `context` and `cause`.                             |
| `isProbeError`         | function | `(value: unknown) => value is ProbeError`           | Admits this package's own failure, across duplicate installations and both module formats, and only when both axes carry declared values. |
| `createDestroyedError` | function | `(subject: string) => ProbeError`                   | Creates the claimant-owned `destroyed` failure every torn-down instrument in this package refuses with.                                   |

### Shapes

The blueprints behind both the published tool schema and the guard applied to an arriving call, from
[`shapers.ts`](../src/core/shapers.ts). `CLAIM_SHAPE` compiles to the `prove` tool's JSON Schema. The
schema is the wire contract's shape and `isClaim` is the admission rule, and the rule is narrower on
`Draft.path`: see [The advertised schema is wider than the admission rule](#registering-the-server).

| Name            | Kind  | Describes                                                                               |
| --------------- | ----- | --------------------------------------------------------------------------------------- |
| `DRAFT_SHAPE`   | const | One proposed file a claim carries; its schema requires `path` to be a non-empty string. |
| `CASE_SHAPE`    | const | The drafts a claim asserts about and the test that exercises them.                      |
| `CONTROL_SHAPE` | const | A case plus the stage it must fail at and the reason it fails there.                    |
| `CLAIM_SHAPE`   | const | One whole claim: the project, the case, and the control.                                |

### Validators

Total guards, from [`validators.ts`](../src/core/validators.ts). Each returns a boolean for any input
and never throws.

| Name          | Kind     | Signature                                | Behavior                                                                                                                                                       |
| ------------- | -------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isStage`     | function | `(value: unknown) => value is Stage`     | Admits a name the `Stage` type carries.                                                                                                                        |
| `isParty`     | function | `(value: unknown) => value is Party`     | Admits `'claimant'`, `'workspace'`, or `'instrument'`.                                                                                                         |
| `isDraft`     | function | `(value: unknown) => value is Draft`     | Admits a record with a contained relative `path` and string `text`; refuses absolute and escaping paths.                                                       |
| `isCase`      | function | `(value: unknown) => value is Case`      | Admits a record whose `files` are drafts and whose `test` is one draft.                                                                                        |
| `isControl`   | function | `(value: unknown) => value is Control`   | Admits a case that also carries a `stage` and a non-empty `reason`.                                                                                            |
| `isClaim`     | function | `(value: unknown) => value is Claim`     | Admits a record carrying a non-empty `project`, a case, and a control. Exact: an unknown member is refused. Narrower than `CLAIM_SHAPE` on `Draft.path` alone. |
| `isIssue`     | function | `(value: unknown) => value is Issue`     | Admits a record carrying an origin, a path, a message, and an optional range.                                                                                  |
| `isCheck`     | function | `(value: unknown) => value is Check`     | Admits a record carrying a stage, an elapsed number, and issues.                                                                                               |
| `isToolchain` | function | `(value: unknown) => value is Toolchain` | Admits a record carrying every resolved tool version.                                                                                                          |
| `isProject`   | function | `(value: unknown) => value is Project`   | Admits a record carrying a non-empty path and a non-empty digest.                                                                                              |
| `isVerdict`   | function | `(value: unknown) => value is Verdict`   | Admits a whole verdict, including the required `digest` and `project` members.                                                                                 |

### Formatters and the token

Pure leaves, from [`helpers.ts`](../src/core/helpers.ts).

| Name                   | Kind     | Signature                                                 | Behavior                                                                                                                                                                                                |
| ---------------------- | -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatIssue`          | function | `(issue: Issue) => string`                                | Renders one message as `[origin] path:line message`, converting the stored zero-based `range.start.line` to the one-based line an editor shows and dropping `:line` when the tool reported no location. |
| `formatCheck`          | function | `(check: Check) => string`                                | Renders one stage's summary line, then one indented line per issue.                                                                                                                                     |
| `formatProof`          | function | `(verdict: Verdict) => string`                            | Renders the closing line a rendered verdict ends with: `receipt <token>` when the verdict carries a receipt, and `no receipt` when it does not.                                                         |
| `formatReceipt`        | function | `(verdict: Verdict) => string`                            | Renders the smallest text a verdict can travel as: the identity and claim lines, the reason when present, then the closing receipt line.                                                                |
| `formatVerdict`        | function | `(verdict: Verdict) => string`                            | Renders identity, claim, toolchain, project, and reason, then both phases with each issue's origin and the receipt line.                                                                                |
| `computeReceipt`       | function | `(verdict: Verdict, stage: Stage) => string \| undefined` | Returns the token when both phases name every stage, the case ran clean, and the control broke only at `stage`; returns `undefined` otherwise.                                                          |
| `formatSpecification`  | function | `(text: string, revision: string) => string`              | Renders the bytes the runtime stage writes: the caller's test text, then the marker naming the revision that wrote it.                                                                                  |
| `matchesSpecification` | function | `(text: string, revision: string) => boolean`             | Reports whether one file's text is the generated specification written for that revision.                                                                                                               |

### Server contracts

From [`types.ts`](../src/server/types.ts).

| Name                   | Kind      | Shape / Purpose                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Inspection`           | interface | `{ subject, claim }` — one queued inspection: the case a stage reads and the claim it belongs to.                                                                                                                                                                                                                                                                                                                     |
| `InspectionOptions`    | interface | `{ signal }` — the bound a caller holds over one stage inspection. The lint stage's inspection is the only one that reads it; the type and runtime stages accept no options and honor no cancellation.                                                                                                                                                                                                                |
| `OverlayOptions`       | interface | `{ sensitive? }` — the construction options `Overlay` accepts.                                                                                                                                                                                                                                                                                                                                                        |
| `OverlayInterface`     | interface | The candidate set one inspection substitutes for files on disk; its readonly `revision` and `paths` are data. See [`## Methods`](#methods).                                                                                                                                                                                                                                                                           |
| `StageInterface`       | interface | The resident-stage contract; its readonly `stage` names the inspection it performs, and its readonly `progress` rises when claimant-owned work is admitted. When a stage later awaits work of its own, it returns `progress` to its pre-inspection reading first; `RuntimeStage` does this before eviction and cleanup, so an expiry there reads level with the coordinator's snapshot. See [`## Methods`](#methods). |
| `TypeStageInterface`   | interface | `StageInterface` plus a project-aware `inspect`. See [`## Methods`](#methods).                                                                                                                                                                                                                                                                                                                                        |
| `LintStageInterface`   | interface | `StageInterface` plus an `inspect` that takes the caller's bound. See [`## Methods`](#methods).                                                                                                                                                                                                                                                                                                                       |
| `WorkspaceManifest`    | interface | `{ path, contents }` — one installed package manifest and the absolute path it was read from.                                                                                                                                                                                                                                                                                                                         |
| `ProbeServerInterface` | interface | The stdio server that owns this process. See [`## Methods`](#methods).                                                                                                                                                                                                                                                                                                                                                |
| `ListenerCapture`      | type      | `ReadonlyMap<string, readonly Function[]>` — the listeners one emitter carried for a set of events.                                                                                                                                                                                                                                                                                                                   |

`StageInterface.progress` is the seam a foreign coordinator reads to decide whose budget an expiry
belongs to, and this is the proof behind it.
[`RuntimeStage.test.ts`](../tests/src/server/stages/RuntimeStage.test.ts) proves the gauge boundary
deterministically: it holds one inspection at the results cache with a FIFO, reads `progress`
elevated while the caller's run is in flight, and reads it level with its pre-inspection value while
the stage evicts.
[`LintStage.test.ts`](../tests/src/server/stages/LintStage.test.ts) reads the same boundary at the
other stage that owns cleanup: it fills the pipe the stage writes to, so the `didClose` the stage
owes its own language server is still waiting for room while the gauge reads level.
Claimant-side expiry is proven end to end through `Probe`, which rejects a claim
that outran the budget with `origin: 'claimant'`, `code: 'deadline'`, and the expired stage in
`context`. The composed instrument-side expiry — a real expiry during stage-owned work, attributed
through `Probe` — has no executed proof, and the gauge is the seam a proof of it reads.

### The engine

The classes, each exported from its own file.

| Name           | Kind  | Implements             | Purpose                                                                                                                                                                                                                                                                     |
| -------------- | ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Probe`        | class | `ProbeInterface`       | The coordinator: per-stage queues, active-inspection deadlines, and the receipt decision. Construction begins warming, installs initial listeners, selects the target workspace, and applies the inspection deadline from its options. [`Probe.ts`](../src/server/Probe.ts) |
| `ProbeServer`  | class | `ProbeServerInterface` | The process owner: construction creates the probe it serves, passes every option to that probe, and binds this process's stdio and termination signals. [`ProbeServer.ts`](../src/server/ProbeServer.ts)                                                                    |
| `TypeStage`    | class | `TypeStageInterface`   | A resident TypeScript language service per project, reading candidates from memory. [`TypeStage.ts`](../src/server/stages/TypeStage.ts)                                                                                                                                     |
| `LintStage`    | class | `LintStageInterface`   | A resident Oxlint language server, driven over the Language Server Protocol by the `@orkestrel/lsp` client and its stdio transport. [`LintStage.ts`](../src/server/stages/LintStage.ts)                                                                                     |
| `RuntimeStage` | class | `StageInterface`       | A resident Vitest service that writes one fresh specification per inspection. [`RuntimeStage.ts`](../src/server/stages/RuntimeStage.ts)                                                                                                                                     |
| `Overlay`      | class | `OverlayInterface`     | The candidate set one inspection holds in memory, under an identity minted fresh per instance. [`Overlay.ts`](../src/server/Overlay.ts)                                                                                                                                     |

Each stage takes one optional `workspace` argument and defaults to the working directory. A stage
serves one inspection at a time and admits none itself, so drive stages through `Probe` unless you
are building your own coordinator.

`new Overlay(options)` takes an optional `sensitive` flag, so a coordinator of your own can mint
one. Mint it per inspection and release it when that inspection ends. An overlay shared across
inspections keeps the identity a resident tool caches its answers against, so the second inspection
reads the first one's answer as a fresh one. Each stage in this package mints its own for that
reason.

Pass `sensitive` as the file-name case sensitivity you declare to the tool that overlay serves; it
defaults to `true`, which matches a lookup key against a recorded path exactly. On a host that
resolves two spellings of one file name to one file, the tool keeps whichever spelling it met first
— the committed file's, where the candidate shadows one — and asks the overlay under that, so an
overlay matching keys exactly answers nothing and the tool reads the committed file instead.
`TypeStage` mints its overlay from the workspace compiler's own `useCaseSensitiveFileNames` reading,
which is the reading it declares to that compiler's language-service host. `RuntimeStage` mints its
overlay with the default instead, because it declares no case sensitivity to Vite: a covered path
whose spelling an importer wrote differs from the recorded candidate path is served by whatever
answers first, and the stage reports it as the `workspace` issue `The workspace configuration served
this module before the runtime overlay` rather than leaving it answered silently. The folding
reaches the lookup key alone: `paths` reports the recorded spelling, and `covers` compares a
directory against that spelling unfolded.

### Server helpers

Pure leaves and workspace readers, from [`helpers.ts`](../src/server/helpers.ts).

| Name                       | Kind     | Signature                                                                                   | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizePath`            | function | `(path: string) => string`                                                                  | Rewrites a path into the forward-slash spelling this package compares and reports paths in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `readFaultCode`            | function | `(error: unknown) => string \| undefined`                                                   | Reads the condition code a native fault carries, guarded over every value a caller can catch, and reports `undefined` for a fault carrying no string code.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `escapesRoot`              | function | `(root: string, target: string) => boolean`                                                 | Reports whether one path resolves outside the root it is read against. A target resolving to the root itself is contained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `resolveWorkspaceFile`     | function | `(workspace: string, target: string, mutate?: boolean) => string`                           | Resolves a workspace-relative path to an absolute one and throws when it escapes the workspace. Under `mutate` it refuses a symbolic link as `workspace`/`refused`, refuses as `claimant`/`refused` an inspection fault whose code is `ENAMETOOLONG` or `ERR_INVALID_ARG_VALUE`, and translates every other native path-inspection fault to `workspace`/`malformed` with the native fault on `cause`. A host that reports an absent-file code for an overlong component instead — Windows reports `ENOENT` — reaches no refusal here, and `isRefusedName` classifies that name at the create. |
| `overwriteFile`            | function | `(file: string, text: string) => void`                                                      | Overwrites an existing file through a descriptor opened `O_WRONLY \| O_NOFOLLOW` and truncated through that descriptor, so a symbolic link standing at the final component refuses the open and a target that has gone fails `ENOENT` rather than being recreated. Truncation runs through the descriptor because a Windows host refuses the numeric `O_TRUNC` without `O_CREAT` as `EINVAL`. The final component is open on a host whose Node build defines no `O_NOFOLLOW`.                                                                                                                 |
| `isRefusedName`            | function | `(file: string, error: unknown) => boolean`                                                 | Reports whether a fault means the host refuses a caller-supplied name for creation: `ENAMETOOLONG`, `ERR_INVALID_ARG_VALUE` on a path carrying a NUL byte, or `ENOENT` raised while the parent stats as a directory. Never throws, whatever the fault's own property reads do, and applies no length or character policy of its own.                                                                                                                                                                                                                                                          |
| `relativeWorkspaceFile`    | function | `(workspace: string, file: string) => string`                                               | Projects an absolute path into the forward-slash workspace-relative form issues expose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `relativeWorkspaceMessage` | function | `(workspace: string, message: string) => string`                                            | Removes every spelling of the workspace root from the paths a tool's message names, at each path it begins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `resolveWorkspaceModule`   | function | `(workspace: string, specifier: string) => string`                                          | Resolves one installed module's entry path, or throws a `workspace` failure carrying the native fault as `cause`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `loadWorkspaceModule`      | function | `(workspace: string, specifier: 'typescript' \| 'vitest/node') => typeof import(specifier)` | Loads one installed tool module, or throws a `workspace` failure carrying the native fault as `cause`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `readWorkspaceManifest`    | function | `(workspace: string, name: string) => WorkspaceManifest`                                    | Reads one installed package manifest and its absolute path, translating a native read or parse fault into a `workspace` failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `resolveWorkspaceBinary`   | function | `(workspace: string, name: string) => string`                                               | Resolves a package's portable JavaScript entry from its `bin` field, never a `node_modules/.bin` shim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `inferTypeProject`         | function | `(path: string) => string`                                                                  | Selects the scoped TypeScript project for one candidate path, and throws for a path outside `src` and `app`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `inferTestProject`         | function | `(path: string) => string \| undefined`                                                     | Selects the Vitest project whose environment matches one test path, or `undefined` when none collects it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `inferDocumentLanguage`    | function | `(path: string) => string`                                                                  | Selects the Language Server Protocol language identifier a path's extension names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `buildRevisionPath`        | function | `(workspace: string, path: string, revision: string) => string`                             | Builds the fresh sibling path one runtime inspection writes its specification to.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `matchesWorkspaceModule`   | function | `(path: string) => boolean`                                                                 | Reports whether a path is a script, TypeScript, Vue, or JSON module Vitest can cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `describeUnknown`          | function | `(value: unknown) => string`                                                                | Normalizes a caught or foreign error into readable text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `guardStage`               | function | `<T>(stage: Stage, operation: Promise<T>) => Promise<T>`                                    | Guards one resident-stage operation, passing a `ProbeError` through unchanged and translating every other failure to `instrument`/`malformed` with the original fault on `cause`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `findRefusedPaths`         | function | `(value: unknown) => readonly string[]`                                                     | Names every draft member of a rejected claim whose `path` the guard refuses and the advertised schema admits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `normalizeValue`           | function | `(workspace: string, value: unknown) => unknown`                                            | Rewrites every workspace-contained absolute path to its relative form and sorts every record's keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `computeDigest`            | function | `(workspace: string, value: unknown) => string`                                             | Digests the normalized value and returns 32 lowercase hex characters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `captureListeners`         | function | `(emitter: EventEmitter, events: readonly string[]) => ListenerCapture`                     | Records the listeners one emitter carries for a set of events.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `releaseListeners`         | function | `(emitter: EventEmitter, capture: ListenerCapture) => void`                                 | Removes every listener one emitter gained since its capture, across a window nothing else attaches in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Methods

The public call-signature members of each behavioral interface, one table per interface.

#### `ProbeInterface`

| Method    | Returns            | Behavior                                                                                                                                                   |
| --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prove`   | `Promise<Verdict>` | Answers one claim with every stage's evidence for the case and the control. Throws when the control repeats the whole case, and when a stage cannot start. |
| `destroy` | `Promise<void>`    | Tears down the resident engines and releases the processes they hold. Settling is idempotent.                                                              |

#### `StageInterface`

| Method    | Returns          | Behavior                                                                                                                                                                     |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect` | `Promise<Check>` | Inspects one case and returns this stage's outcome. Throws when the resident tool cannot start.                                                                              |
| `destroy` | `Promise<void>`  | Tears down the resident tool, abandoning every inspection it holds rather than waiting behind one. What bounds the wait differs per stage: see [`## Lifecycle`](#lifecycle). |

#### `TypeStageInterface`

| Method    | Returns            | Behavior                                                                                                                                                                                                             |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect` | `Promise<Check>`   | Inspects one case against a caller-named project, or against the project each candidate path infers. A diagnostic naming no file refuses a caller-named project and reports a `workspace` issue for an inferred one. |
| `resolve` | `Promise<Project>` | Resolves one project to the resolved path and options digest the stage applies for it.                                                                                                                               |

#### `LintStageInterface`

| Method    | Returns          | Behavior                                                                                                                                                                                                                 |
| --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inspect` | `Promise<Check>` | Inspects one case under the bound its caller supplies, and refuses an inspection that omits one. The bound is optional in the type because the shared `StageInterface.inspect` takes one argument, and required in fact. |

#### `OverlayInterface`

| Method   | Returns               | Behavior                                                                                                                                                                 |
| -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `set`    | `void`                | Records one candidate's text against the absolute path it stands in for.                                                                                                 |
| `text`   | `string \| undefined` | Reads the candidate text recorded for one absolute path, or `undefined` when it holds none there. An overlay minted for a case-folding host folds the lookup key's case. |
| `covers` | `boolean`             | Reports whether a candidate sits beneath one absolute directory. Directory listings stay on disk.                                                                        |
| `clear`  | `void`                | Releases every candidate, so the paths this overlay held read from disk again.                                                                                           |

#### `ProbeServerInterface`

| Method    | Returns         | Behavior                                                                                                                                                                                                |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`   | `void`          | Reads newline-delimited JSON requests from standard input, answers `SIGINT` and `SIGTERM` by destroying, does nothing while already serving, and throws `claimant` / `destroyed` after teardown begins. |
| `destroy` | `Promise<void>` | Releases the transport, the process listeners, and the probe behind them. Settling is idempotent.                                                                                                       |

## What a probe proves

Measure a performance claim first through a guarded bench block beside the probe test, run by the
`test:bench` script; a settled magnitude then proves through `prove` as an ordinary runtime claim.

A `Claim` is a question with a falsifier attached. Its `case` is the edit you believe is correct.
Its `control` is the same edit deliberately broken, plus the `stage` you say the breakage lands at
and the `reason` in your own words. Both are judged under the TypeScript project the claim's
`project` member names.

Every verdict returned by `prove` carries that explanation unchanged as `Verdict.reason`. The
member reports why the claimant chose the control. No receipt condition reads it, and it still
reaches the token: the reason is part of the control, so it enters `verdict.digest`, and the digest
is a field of the token. Two claims that differ only in the reason's prose are two claims, and they
digest differently.

`verdict.digest` covers these things and nothing else: the case bytes, the control bytes including
the reason, and the workspace those bytes were read against. The workspace enters because probe
rewrites every absolute string in a claim relative to the workspace before hashing, which is what
keeps one commit checked out at two paths reading as one claim. A claim carrying no absolute string
therefore digests the same in every workspace; a claim that carries one digests per workspace, so
compare two such tokens only when both were minted against the same tree.

`prove` runs every stage over the case, then every stage over the control, and returns one `Check`
per stage for each. A stage that cannot start throws rather than returning an empty check, so no
verdict ever reports a stage that did not run.

The receipt is minted on these conditions together:

- both phases report one check per stage; and
- the case produced no issue at any stage; and
- the control produced an `origin: 'claimant'` issue at the stage it declared, and neither phase
  produced an `origin: 'instrument'` issue; and
- every other control stage produced no `origin: 'claimant'` issue.

A control that also breaks somewhere else has falsified the instrument rather than the claim, so no
receipt is minted for it. An `origin: 'instrument'` issue in either phase says the inspection did
not complete, so nothing was learned about the code and no receipt is minted either. An
`origin: 'workspace'` issue in the control decides neither break condition: it names the target
tree rather than the candidate. A case carrying any issue did not run clean and earns no receipt.
The check-per-stage condition binds both phases, because the clean-elsewhere condition reads the
control entries a verdict carries: a control that omits a stage would otherwise read as a stage
that stayed clean. `prove` records every stage for both phases, so that condition refuses only a
verdict you assembled by hand and passed to `computeReceipt` yourself.

`Issue.origin` names the party that must act, and the receipt conditions read that value rather
than the message beside it. **A `claimant` issue is a tool's diagnostic about a candidate draft,
and nothing else. Every other claimant fault is a throw.** That invariant is what lets one union
serve both an issue and a failure: without it, a caller's own mistake — a test path no project
collects, a project the caller named and the compiler cannot parse — would arrive as a `claimant`
issue and satisfy the condition that a test which never ran must never satisfy. A `workspace` issue
carries the target tree's own defect, such as a symbolic link in a mutation path, a mutation path
whose existing components cannot be inspected, a specification directory the target tree blocks
probe from creating, a Vitest project the root configuration declares as a path string, into which
the runtime stage can install no overlay, a project the workspace declares for itself whose
configuration produces a diagnostic naming no file, or a covered module the workspace's own
configuration served before the runtime overlay. An `instrument` issue carries this package's own
message about an inspection that did not complete — a specification it could not write, after its
directory exists, for a reason the target tree does not own, a module that ran no test, or a covered
module probe's own loader received and did not resolve.
`formatIssue` renders the value first as `[claimant]`, `[workspace]`, or `[instrument]`, so the
ownership survives `formatVerdict`. A clean runtime check means every collected test passed, not
that the module reported itself passed.

**A diagnostic naming no file belongs to whoever chose the project.** The compiler reports a
configuration fault — a `types` entry it cannot resolve, an option it cannot apply — against the
project rather than against any candidate. A caller that named the project in `Claim.project` chose
it, so the type stage throws `origin: 'claimant'`, `code: 'refused'` and inspects nothing further. A
project a candidate's own path infers is one the workspace declares for itself, so the stage reports
an `origin: 'workspace'` issue against that project path instead: the target tree holds the only
file that closes it, and naming this package would refuse every receipt that tree could earn until
someone repaired a configuration nobody else owns.

**Every message a stage reports is rendered in the workspace's own terms.** The host's directory
layout is removed from each path a message names, in whichever spelling the tool wrote — the
absolute path, the backslash spelling a Windows tool writes, and the `file:` URL a runtime names a
module by. A spelling of the root counts only where a path begins, so a directory whose own name
ends in the root's text keeps its whole path. The runtime stage removes one further name: the
generated sibling it ran, rewritten by exact basename to the declared test's own name.

## Failures

Every failure probe raises while serving a claim is a `ProbeError`. Narrow a caught value with
`isProbeError`, then read two independent members: `origin` is the party that must act and `code` is
the condition that ended the operation. Read `message` to print it and `context` for the detail
behind it.

`origin` carries the same values `Issue.origin` carries, and it answers the question a caller has
to answer first — is this my fault, the target tree's, or the tool's — from a value rather than from
the message. One branch routes every failure this package raises:

```ts
import { isProbeError } from '@orkestrel/probe'

try {
	await probe.prove(claim)
} catch (error) {
	if (!isProbeError(error)) throw error
	if (error.origin === 'claimant') console.log('repair the claim', error.code, error.message)
	if (error.origin === 'workspace') console.log('repair the workspace', error.code, error.message)
	if (error.origin === 'instrument') console.log('report a probe defect', error.code, error.message)
	if (error.code === 'deadline') console.log(error.context?.stage, error.context?.deadline)
}
```

`code` names the repair rather than the party: `refused` changes the value a guard rejected before
work started, `missing` creates or installs the named thing, `malformed` repairs a value that exists
and does not match the contract it is read against, `destroyed` builds a replacement because
teardown is permanent, and `deadline` changes the budget or the work it bounds. Neither axis is
derivable from the other. These are the pairs this package raises:

| Party        | Code        | Raised when                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claimant`   | `refused`   | An input is rejected: a path escaping the workspace, a caller-supplied name the host refuses to inspect or create — an overlong component and one carrying a NUL byte are the shapes this package meets — a claim the tool guard rejects, a control repeating the case's candidate drafts and test byte for byte, a candidate naming no scoped project, a caller-named project whose diagnostic names no file, or a lint inspection its caller supplied no bound for. |
| `claimant`   | `missing`   | The declared test path names no configured Vitest project, or names one the root configuration does not define.                                                                                                                                                                                                                                                                                                                                                       |
| `claimant`   | `destroyed` | A probe, a server, or a stage is used after its `destroy`.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `claimant`   | `deadline`  | `ProbeOptions.deadline` expired while the stage was performing claimant-owned work, so the claim outran the budget. That stage was replaced before the next inspection began. The lint stage raises the same pair on its own when the bound its caller supplied stops a diagnostics wait, and a coordinator that armed that bound replaces the pair with its own refusal.                                                                                             |
| `workspace`  | `refused`   | A mutation path crosses a symbolic link in the target tree.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `workspace`  | `missing`   | The target tree does not install a tool probe resolves from it, or publishes no binary under that tool's name.                                                                                                                                                                                                                                                                                                                                                        |
| `workspace`  | `malformed` | The target tree publishes something probe cannot read: an unparsable manifest, a `bin` entry that is not a path, a TypeScript project its own compiler refuses, an unsupported tool version, a mutation path whose existing components cannot be inspected, or a directory it blocks probe from creating for the boot workbench.                                                                                                                                      |
| `instrument` | `malformed` | probe's own tooling could not serve: a boot control that did not report red, a language server frame it could not parse, a schema or verdict of its own it could not validate.                                                                                                                                                                                                                                                                                        |
| `instrument` | `deadline`  | A stage was not performing claimant-owned work when its budget expired, or a language server did not answer its teardown exchange within the stage's own bound.                                                                                                                                                                                                                                                                                                       |

A TypeScript project whose JSON the compiler cannot parse reaches you as that `workspace` and
`malformed` pair, carrying the compiler's own diagnostic, the stage, and the project you named in
`context`, rather than as the compiler's internal assertion.

An `instrument` failure carries the same meaning it carries on `Issue.origin`: the inspection did
not complete, so nothing was learned about the code. Do not read it as evidence about a candidate.

**The pure leaves are total over a validated claim and not over every value.** `computeDigest`,
`normalizeValue`, and the other exported leaves are written for the values a `Claim` the guards
admit can carry, so a caller that hands one a value `isClaim` would refuse — a cyclic record, a
`BigInt` — gets the host's own `RangeError` or `TypeError` unchanged rather than a `ProbeError`.
Measured on 2026-08-20: `computeDigest(workspace, cyclic)` raises
`RangeError: Maximum call stack size exceeded`, and `computeDigest(workspace, { n: 1n })` raises
`TypeError: Do not know how to serialize a BigInt`. Validate with `isClaim` before you reach past
`prove` into a leaf.

`isProbeError` reads a global brand rather than the constructor, so it admits a failure raised by a
second copy of this package — a duplicate installation, or the ESM and CommonJS builds loaded
together — where `instanceof` refuses a failure the other copy raised.

## Prerequisites

probe borrows the target workspace's own toolchain and configuration, so a workspace missing any of
these returns a failure the caller cannot diagnose from the verdict alone. Check them before you
make a claim; the boot controls run through the same stages a claim does, so a workspace missing one
fails at construction rather than at `prove`.

- **A Vitest project whose name the test's path infers.** A test under `tmp/probe/` names the
  `probe` project, and a test under `tests/src/<environment>/` names `src:<environment>`. Any other
  path infers no project, and the runtime stage throws `origin: 'claimant'`, `code: 'missing'`, and
  the declared path in `context` rather than reporting an issue:
  `The runtime stage found no configured Vitest project matching the test path`. A path that infers
  a name the root configuration does not define is refused the same way, with
  `The runtime stage found no configured Vitest project named <name>`. A test that never ran is not
  evidence about the candidate, which is why this is a throw.
- **That project is composed in the root configuration, not declared as a path string.** The
  runtime stage installs its own overlay plugin into each project's configuration so the candidate
  drafts resolve from memory. A project the root configuration names by path carries no such
  plugin, so the stage installs no overlay and runs no test. The check reports an
  `origin: 'workspace'` issue, because the party that must act is the workspace owner editing
  `vite.config.ts`:
  `The runtime stage cannot instrument the string-declared Vitest project <name> because its configuration carries no runtime overlay plugin`.
  The project's `include` pattern is not the mechanism: the stage builds an explicit specification
  for the file it wrote, so a project whose glob matches nothing still serves a claim.
- **The directory the declared test path names can be created.** The runtime stage writes a real
  file beside the declared test and creates that file's directory first, recursively, so a claim
  naming a directory the workspace does not hold still runs. A fresh clone holds no `tmp/probe/`,
  because `tmp` is ignored by version control, and a claim declaring a test there creates it. A
  directory the host refuses to create — a file already occupies the path, or its parent denies
  writing — reports an `origin: 'workspace'` issue:
  `The runtime stage could not write the generated specification (<reason>)`, where `<reason>` is
  the host's own `mkdir` failure.
- **A root `tsconfig.json` that resolves at least one input.** The type stage checks the claim's
  test file against the root project, because a test needs the Vitest and Node globals the scoped
  projects remove.
- **The workspace's `typescript`, `oxlint`, and `vitest` are the same resolved files probe
  resolves.** probe reads each of them from the target workspace's `package.json`, never from its
  own dependencies, and reports the resolved versions on `Verdict.toolchain`. A verdict predicts
  the gate only while probe and the gate read one installed copy of each tool.

Declare `@orkestrel/probe` as a development dependency of the workspace it inspects. Its tools are
optional peers, resolved from that workspace at construction.

## Registering the server

The package installs a `probe` binary and publishes the `prove` Model Context Protocol tool over a
stdio transport. Register the resolved JavaScript entry and run it with the harness's own Node:

```json
{
	"mcpServers": {
		"probe": {
			"command": "node",
			"args": ["node_modules/@orkestrel/probe/dist/bin/main.js"],
			"cwd": "/srv/checkout"
		}
	}
}
```

Register that entry rather than a global install, an `npx` invocation, or the `node_modules/.bin`
shim. The shim is a shell script on POSIX hosts and a batch file on Windows, and spawning the
JavaScript entry with the current executable is the form that survives both.

When a prerequisite refuses construction, the binary writes the failure as one stderr line in
the form `[origin] code: message` and exits with status 1.

These facts decide whether a hand-written client works, and each fails silently when it is wrong:

- **The transport is newline-delimited JSON.** One JSON-RPC message per line, terminated by `\n`. A
  client that frames requests with `Content-Length` headers — the way a Language Server Protocol
  client does — gets no reply and no error. That framing is correct for this package's _lint stage_,
  which speaks the Language Server Protocol to Oxlint, and wrong for its _server_. Both live in this
  one package, which is how the mistake gets made.
- **A current-revision request carries reserved `_meta` keys.**
  `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` are
  both required; `io.modelcontextprotocol/clientInfo` is optional and must be a valid identity when
  present. A request carrying the version alone is refused with
  `-32602 Invalid params: malformed modern request metadata`, which reads like a server defect and
  is not. A version the server does not implement is refused differently, with
  `-32022 Unsupported protocol version` and a `data.supported` list; measured on 2026-08-20 that
  list is `2026-07-28`, `2025-11-25`, and `2025-06-18`.

The server answers the handshake era and the current revision together, so a client that sends
`initialize` without `_meta` is served too. `ProbeServer` creates the probe it serves and takes
every `ProbeOptions` member for it, because `start()` seizes this process's standard input and
output: a host that starts one has given the process to it. `destroy()` gives the process back and
tears the probe down with it.

**A successful `tools/call` answers with the `Verdict` record and its rendered text together.** The
result carries the record in `structuredContent` and a single `content` entry of `type: 'text'`
whose text is what `formatVerdict` rendered: the identity, claim, toolchain, project, and reason
lines, then every case and control stage, then the closing line. That closing line is where the
receipt lives in the text block, spelled `receipt <token>` when the claim proved itself and
`no receipt` when it did not, so a client reading the text block reads the outcome from its last
line rather than inferring it from the rest. A client reading the record reads `verdict.receipt`
instead: it carries the token itself, and it is absent when the claim was not proven.
`structuredContent` is the record `prove` returns in this process, unchanged, so a client reads
`verdict.id`, `verdict.digest`, `verdict.receipt`, and the per-stage `elapsed` values as data
rather than off the prose. The `@orkestrel/mcp` client's outcome carries that record alone and
drops the content blocks, so a caller of that client who wants the rendered form calls
`formatVerdict` from `@orkestrel/probe` on the record, or reads the text block off the raw wire.

**The text block carries `formatVerdict`'s prose rather than the record's serialized JSON, which
departs from the specification's recommendation.** The tools specification recommends that a tool
returning structured content also return the serialized JSON in a text content block. The receipt's
closing line has to stay quotable verbatim, so the text block keeps the rendered form and the record
travels beside it in `structuredContent`. A client that wants the serialized JSON serializes
`structuredContent` itself.

**The server publishes a key bound above the `@orkestrel/mcp` default, because a verdict's breadth
is the claimant's.** That package bounds a produced tool-call result by its total enumerable key
count as well as by its bytes, and applies one bound to inbound metadata and to produced tool
content alike; its default leaf is sized for metadata. Measured on 2026-08-27 against
`@orkestrel/mcp` 0.0.25, over the `Verdict` shape this page documents, a verdict costs 38 keys with
no issues and 11 more for each issue a stage reports, so under the default a verdict whose control
refuses one declaration travels and the next
one does not — and it fails by replacing the whole answer with `-32603 Server execution returned an
invalid tool result` rather than by dropping the record alone. A whole result carrying the record
beside its rendering costs 44 keys plus 11 for each issue, so the published bound of 4096 keys
carries a record reporting up to 368 issues. That bound also widens the inbound `_meta` key bound,
deliberately: bytes and depth still bind there, the 16 KiB metadata byte limit is unchanged, and
the process on the other end of a stdio transport is the harness that spawned this one.

**The reply falls back rather than failing, and the receipt answers at every size.** The server
admits each answer against those bounds before returning it and takes the widest one they admit.
Past 368 issues the record is refused and the result carries the rendered text alone. Past the
4 MiB content bound the rendered text is refused too, and the result carries what `formatReceipt`
renders instead: the identity and claim lines, the reason when present, and the same closing
receipt line. A client therefore reads the outcome off the last line of the text block whichever
answer arrived.

**One third-party client drives this entry: the `@orkestrel/mcp` stdio client.** It spawns the
shipped `dist/bin/main.js`, negotiates the era itself, lists `prove`, and hands back the record
described earlier, and [`main.test.ts`](../tests/src/bin/main.test.ts) runs that round trip against
the built entry on the current revision and through the legacy projection. No other third-party
client has been driven against this server, so treat a claim about another one as untested. The
transport facts stated earlier were established against this repository's own hand-written line
client, and the driven client meets them too.

**The advertised schema is wider than the admission rule, at `Draft.path`.** The `prove` tool
publishes `compileSchema(CLAIM_SHAPE)` and admits a call with `isClaim`, and the two agree on every
member but `Draft.path`: the schema constrains it to a non-empty string, while the guard also
refuses an absolute path and one that traverses out of the workspace. No JSON Schema keyword
expresses that rule, so a claim naming `../../etc/hosts` satisfies the advertised parameters and is
refused. The refusal names the members it read — `The prove tool refuses case.files.0.path: a draft
path must stay inside the workspace, which the advertised schema does not constrain` — so a client
that satisfied the schema is told which path to change rather than that its claim was invalid.

## The claim that earns a receipt

This claim earns a receipt in this workspace. Run it verbatim.

```ts
import type { Claim } from '@orkestrel/probe'
import { Probe } from '@orkestrel/probe/server'

const claim: Claim = {
	project: 'configs/src/tsconfig.core.json',
	case: {
		files: [{ path: 'src/core/greeting.ts', text: "export const GREETING = 'hi'\n" }],
		test: {
			path: 'tmp/probe/greeting.test.ts',
			text: "import { expect, test } from 'vitest'\nimport { GREETING } from '../../src/core/greeting.js'\ntest('greets', () => expect(GREETING).toBe('hi'))\n",
		},
	},
	control: {
		files: [{ path: 'src/core/greeting.ts', text: "export const GREETING: number = 'hi'\n" }],
		test: {
			path: 'tmp/probe/greeting.test.ts',
			text: "import { expect, test } from 'vitest'\nimport { GREETING } from '../../src/core/greeting.js'\ntest('greets', () => expect(GREETING).toBe('hi'))\n",
		},
		stage: 'type',
		reason: 'a string literal assigned to a number must not compile',
	},
}

const probe = new Probe({ workspace: process.cwd() })
const verdict = await probe.prove(claim)
verdict.digest // '0806fb30f428edb8ea85adfb4b355441'
verdict.receipt // 'probe:0806fb30f428edb8ea85adfb4b355441:type:typescript@6.0.3:oxlint@1.80.0:vitest@4.1.11:configs/src/tsconfig.core.json@3b674fdf121c85efb9ed1bab25ceeec8'
await probe.destroy()
```

These things in it are load-bearing:

- **The candidate file lives under `src/`.** It is checked against `configs/src/tsconfig.core.json`,
  the same scoped project the workspace's own `check:src:core` script runs.
- **The control differs from the case.** `prove` compares the control against the case byte for
  byte — every candidate draft, paired by position, and the test — and refuses a control that
  repeats all of them, with `origin: 'claimant'` and `code: 'refused'`, before any stage inspects
  the claim. A control byte-identical to its case cannot break, so it never produces the
  `origin: 'claimant'` issue a receipt requires, and the only receipt it could earn is one
  nondeterminism minted for a falsification that never happened. The comparison reads the bytes, so
  varying the control's `stage` or its `reason` alone does not admit it.
- **The test imports the candidate through a relative specifier.** The runtime stage serves the
  candidate's text at the path the claim declared, so `../../src/core/greeting.js` resolves to the
  supplied text rather than to a file on disk.
- **The test imports `test` and `expect` from `vitest`, and asserts.** A bare `test(...)` fails at
  runtime with `test is not defined`, and at a version-controlled path a body that asserts nothing
  adds the lint issue `Test has no assertions`. Both are charged to the claim.

This claim carries no absolute string, so `verdict.digest` is the same in any workspace that runs
it. Change the control's `reason` and the digest changes with it, because the reason is part of the
control the digest covers. The tool versions and the project digest in the receipt are this
workspace's, and `tests/guides.test.ts` re-runs this claim and asserts the token this page carries.

## Reading a receipt

A receipt is a `RECEIPT_SEPARATOR`-separated token with this grammar:

```text
<prefix>:<digest>:<stage>:typescript@<version>:oxlint@<version>:vitest@<version>:<project>@<options>
```

- `<prefix>` is the value of `RECEIPT_PREFIX`, so a token found away from its verdict names itself.
- `<digest>` is the claim digest: the case and the control the verdict answered, read against this
  workspace.
- `<stage>` is the stage the control declared and broke at.
- A tool field per resolved tool follows, spelled `<name>@<version>`, in the order `typescript`,
  `oxlint`, `vitest`.
- `<project>@<options>` closes the token: the workspace-relative TypeScript project that judged the
  candidates, and the digest of the compiler options it resolved to.

**Parse the project field as the remainder, not as another split.** A workspace-relative project
path may contain `:` and `@`. Split on `RECEIPT_SEPARATOR`, read the prefix, the digest, the stage,
and the tool fields as one field each, rejoin everything after the `vitest` field with that
separator, and read `<options>` as everything after that remainder's closing `@`. That rule stays
total for a project path containing either character.

The call's identity is deliberately absent from the token. It carries no integrity, and it is the
only value that would stop two honest runs of one claim from producing one comparable string.

**Verify a receipt by recomputation, or by re-running the claim.** Recompute it, holding the claim
and the workspace, by reading the digests the verdict carries. Or re-run `prove` over the same claim
and compare the two strings byte for byte: two runs of one claim in one workspace produce one token.

**probe holds no key.** The token is a function of public inputs, so anyone can type a well-formed
receipt. It is a statement of the conditions a verdict was reached under, not an authenticator, and
it is worth exactly what the reader's own recomputation is worth.

**probe executes caller-supplied test code with the host's privileges.** The runtime stage writes
the claim's test to a real file in the target workspace and runs it through the workspace's Vitest.
That code can read and write the checkout, open sockets, and reach the network. A receipt says
nothing about what the test did while earning it. Each specification runs in its own Vitest worker,
so one claim's module state, globals, and environment do not reach the next; nothing about that
worker contains a filesystem write, a loopback bind, or an outbound request.

## What a receipt does not vouch for

`Claim.project` is the one configuration input the caller chooses, which is why the receipt records
its resolved path and the digest of its compiler options. A receipt minted under a permissive
project names that project, so a reader comparing it against the gate's own project refuses it on
sight.

These configurations remain outside the token, and no receipt vouches for them:

- `.oxlintrc.json`, which the lint stage reads;
- `vite.config.ts`, which the runtime stage reads;
- the root `tsconfig.json`, against which the claim's test file is checked.

These are the same files the workspace's own `lint:check`, `test`, and `check` scripts read. A
caller that weakens one has defeated the gate itself, and no receipt vouches for a workspace against
itself.

The project digest also **moves with the TypeScript version**, because the resolved compiler options
carry enum-valued members whose numbering the compiler owns. A compiler upgrade therefore changes
the digest for an unchanged project file. That is contained rather than surprising: the token
already names `typescript@<version>`, so any policy pinning a digest already pins the version.

Further limits belong beside those:

- **A control need not be a mutation of its case, and probe applies no relatedness rule.** `Control`
  carries its own `files` and `test`, so a caller can pair a clean case with unrelated broken code
  and satisfy every receipt condition. Any approximation of relatedness strict enough to catch that
  pairing also refuses controls this package deliberately admits, so none is applied. `prove`
  refuses only a control repeating the whole case byte for byte, and that refusal answers
  nondeterminism rather than relatedness. **Judging a control against its case is the reader's
  obligation.** The claim digest binds the case and the control together, so the pairing a
  token was minted over is there to be read.
- **The overlay is the only thing that serves a candidate's bytes to the runtime stage.** A Vite
  filesystem module cache that answered a covered path from disk would run the file the workspace
  holds rather than the candidate the claim supplied. Measured on 2026-08-24, the string
  `fsModuleCache` appears nowhere in the installed `vite@8.2.2` tree, so there is no such option to
  set and none to defeat. The standing guard is the runtime stage's serve detection rather than a
  version pin: a covered module reachable from the generated specification that the overlay never
  served reports an issue, whatever served it instead. See
  [What the runtime overlay serves](#what-the-runtime-overlay-serves).
- **Write and delete containment does not bound reads.** TypeScript and Oxlint can inspect files
  outside the workspace through a symlinked candidate path, and a contained `Claim.project` can
  reach outside through `extends`, `files`, `include`, or project references. A receipt does not
  vouch that those reads stayed inside the workspace.

That split is deliberate rather than accidental, and § What containment reaches states it as a rule
rather than as a limit on the token.

## What containment reaches

Containment is not one rule, and the difference between its rules decides what a hostile claim can
do.

**Every path a claim carries is contained lexically.** `isDraft` refuses an absolute `Draft.path`
and one that traverses out of the workspace, and `resolveWorkspaceFile` refuses the same shapes
again when the stage resolves it. `Claim.project` passes the same rule.

**A write or a delete is contained physically as well.** Before probe creates a directory, writes a
generated specification, writes a boot dependency, or unlinks one, it walks the path's existing
components and refuses a symbolic link at any of them with
`Path crosses a symbolic link: <path>`; it then refuses any component whose resolved path leaves
the workspace. The symbolic-link refusal is `origin: 'workspace'`, `code: 'refused'`, because the
link belongs to the target tree. A native fault while inspecting an existing component is
`origin: 'workspace'`, `code: 'malformed'`, and retains that fault on `cause`.

The walk and the write that follows it are separate calls, so a concurrent process can move a
component between them. What that reaches is not uniform, and the difference is worth stating
exactly. **Exclusive creation and final-component removal are closed.** probe creates every file
it puts in a target with the `wx` flag, which fails rather than following a symbolic link or
overwriting a file that appeared after the walk, and an unlink names the final component itself
rather than what it points at. **An overwrite refuses symbolic-link and gone-file swaps.** A boot
dependency is overwritten through a descriptor opened `O_WRONLY | O_NOFOLLOW` and truncated
through that descriptor — a Windows host refuses the numeric `O_TRUNC` without `O_CREAT` as
`EINVAL`, and the descriptor reaches the file the open bound — which fails on a symbolic link
standing at that component and on a target that has gone since the walk saw it — while
**hard-link aliasing remains open**: a regular file swapped for a hard link to a
same-filesystem file outside the workspace passes that flag set, because `O_NOFOLLOW` refuses
symbolic links, not hard-linked inodes. Where a host's Node build defines no `O_NOFOLLOW`, that
flag contributes nothing to the flag set and an overwrite there follows a link the walk did not
see. **A directory component is open.** A directory swapped for a symbolic link after the walk
redirects the create, and closing that needs a traversal pinned to file descriptors: Node exposes
`O_NOFOLLOW` and no descriptor-relative call to apply it through, so this package cannot walk and
write through one set of descriptors. Read physical containment as covering the claim inputs and
the target tree as the walk inspected it, plus what the closed set holds at the moment probe
writes or unlinks a final component.

**A read is contained lexically only, and that is the reach to plan for.** A candidate path beneath
an in-workspace symbolic link resolves to a file outside the workspace, and TypeScript and Oxlint
inspect it there. A contained `Claim.project` reaches outside the same way through `extends`,
`files`, `include`, or project references, and its resolved compiler options — the digest the
receipt carries — then depend on a file the workspace does not hold.

Measured on 2026-08-20: with `link` a symbolic link to a directory outside the workspace,
`isDraft({ path: 'link/secret.ts', text })` returns `true`,
`resolveWorkspaceFile(workspace, 'link/secret.ts')` returns the contained spelling whose real path
is outside the workspace, and the mutating form of the same call throws a `ProbeError` carrying
`origin: 'workspace'`, `code: 'refused'`, and
`Path crosses a symbolic link: link/secret.ts`. A contained `tsconfig.json` whose `extends` names an
absolute path outside the workspace resolved to a different options digest from the same project
without it, so the outside file was read.

Read this as the reason the front of this guide gives a probe a workspace and a caller you already
trust with a shell, rather than as a hole to work around. A caller that can supply a claim can
already supply test code the runtime stage runs.

## What the lint stage does not see

**A path the workspace's version-control ignore excludes is a path the lint stage reports nothing
for.** Oxlint's language server honours `.gitignore`, and it does so for text supplied from memory
exactly as it does for a file on disk. The stage reports a clean check, not a skipped one.

This reaches the flagship claim stated earlier: its test lives at `tmp/probe/greeting.test.ts`, and `tmp` is
ignored in this workspace, so the lint stage inspects the candidate `src/core/greeting.ts` and
reports nothing about the test. Measured on 2026-08-20: the same three-line text carrying an unused
binding and a `debugger` statement returns 0 issues at `tmp/probe/lint-ignored.test.ts` and 2
issues at `tests/src/core/lint-tracked.test.ts`.

`.gitignore` alone causes this: `tmp` appears there and in no other ignore file this workspace
carries. Put every candidate draft you want linted at a path version control tracks.

## How the lint stage speaks the protocol

The lint stage owns the workspace, the candidate's identity, and the projection from a diagnostic to
an `Issue`. `@orkestrel/lsp` owns everything between them, and the hookup is fixed:

- **The transport is `createStdioClientTransport` from `@orkestrel/lsp/server`.** Its command vector
  is the current executable, the entry `resolveWorkspaceBinary` resolves for `oxlint` in the target
  workspace, and `--lsp`; its directory is that workspace. The child is therefore the workspace's
  own installed Oxlint entry rather than a `node_modules/.bin` shim, for the reason the
  **Prerequisites** section earlier gives.
- **The client is `createLSPClient` from `@orkestrel/lsp`,** over that transport, with the
  workspace's `file://` URL as its `workspace` option and a 2 s `timeout` option. That option bounds
  the `initialize` and `shutdown` exchanges and the destroy-time settlement, and it does not reach
  the diagnostics an inspection waits for. The transport's `grace` option is 1 s, half that deadline,
  so a child that ignores its ending is signalled and released inside the client's own wait for the
  close.
- **Each candidate reaches the server through the `open` method.** The stage supplies the URL the
  declared path names, the language identifier `inferDocumentLanguage` selects for that path, the
  candidate's text, and the signal its caller supplied, then closes the document. Nothing is written
  to disk. That signal is what bounds the diagnostics wait, so the stage mints no bound of its own
  for it: a second bound would race the caller's, and which one answered would depend on scheduling.
  `Probe` passes the deadline it already armed for the inspection, so one budget covers the wait and
  reports the overrun.
- **The published span reaches `Issue.range` unconverted.** The client advertises UTF-16 positions
  and the protocol numbers lines and characters from zero, which is the coordinate basis
  `Issue.range` stores, so this stage copies each coordinate rather than adjusting one. The type
  stage lowers nothing either, because the compiler answers in that basis too, and the runtime stage
  lowers a Vitest frame by one because that frame numbers from one. `formatIssue` is the only place
  the one-based line a reader opens is derived.

Each limit that split produces is the client's decision rather than this package's:

- **The client declares the capabilities and selects the diagnostics path.** It advertises UTF-16
  positions, document synchronization, published diagnostics, and pulled diagnostics, then reads the
  server's `initialize` result: a server declaring `diagnosticProvider` is pulled, and every other
  server is awaited for its published notification. The stage declares nothing and selects nothing,
  so a change in that selection reaches this stage through the package rather than through a switch
  here. Measured on 2026-08-26, Oxlint's language server reports version 1.80.0, declares
  `textDocumentSync` with `openClose`, and declares no `diagnosticProvider`, so its diagnostics
  arrive on the published path.
- **A server that declares no `openClose` synchronization admits no candidate at all.** The client
  refuses the open before any text reaches that server, and the inspection reports the refusal as a
  stage fault.
- **A published diagnostic the client refuses reaches no `Issue`.** The client validates every
  diagnostic in a notification and drops the whole notification when one fails, so that inspection
  waits out the caller's bound and reports the stop rather than returning a partial answer.

## What the runtime overlay serves

The runtime stage does not execute the test the claim declared. It writes that text to a fresh
sibling file and runs the sibling, and it installs the claim's `Case.files`, and only those, in the
overlay a Vite plugin reads. The type stage differs: it records the declared test at its declared
path alongside every candidate draft, and checks the text there. So the file one stage checks and
the file the other executes are not the same file, and a test that reads its own location sees the
generated sibling — which is why the runtime stage rewrites that name out of every message it
reports.

**A query is stripped for the lookup and kept for the transform.** The overlay is keyed by path, and
a Vite id carries its transform selectors after the first `?`. Resolution cuts the id at that
character, looks the path up in the overlay, and hands the suffix back on the id it returns; loading
cuts the same way and serves the candidate's text. So `../../src/value.ts?v=123` imports the
candidate's module and `../../src/value.ts?raw` imports the same candidate's text as a default
export, and every selector the importer wrote reaches whichever plugin owns it.

**A bare specifier is Vite's to resolve.** The overlay's resolver declines a specifier that is
neither relative nor absolute rather than guessing where the workspace would place it, so Vite
resolves it under the workspace's own configuration. The overlay's loader still runs first on the id
that resolution produced, so a bare import landing on a covered path reads the candidate's bytes.
This package holds no second copy of that resolver.

**A covered module served by anything else is reported rather than passed over.** After the run, the
stage takes each covered path its own loader never served and asks whether the generated
specification's module graph reaches that path through importers. One that is reachable was served
by something other than the overlay, and the party follows how far the id travelled. A loader of
probe's that never received the id means the workspace's own configuration answered first, reported
as `The workspace configuration served this module before the runtime overlay` with
`origin: 'workspace'`. A loader of probe's that received the id and did not match it is this
package's own resolution missing, reported as `The runtime overlay did not resolve this module` with
`origin: 'instrument'`. Reachability is what bounds the reading to this run: a resident runner keeps
module nodes from earlier inspections, and membership alone would report a candidate this claim
never imported.

## Lifecycle

A probe has no `start`. Warming begins at construction and `prove` awaits it, because the harness
owns the process: a restart is a new process rather than a second lifecycle, and a second client is
a second process with its own resident engines. `ProbeServer.start` is the transport's verb rather
than the probe's — it decides which process reads the stdio, not when the engines warm.

- **Arming.** Construction runs boot controls that mutate an imported dependency and refuse
  service unless the type and runtime stages report the change. The `arm` event fires after those
  controls have reported red and the boot's own files are gone. An attempt that rejects fires `error`
  instead, carrying the arming refusal as the attempt raises it, so a host waiting on `arm` reads the
  refusal rather than an event that never arrives. The attempt is still retained for retry, so each
  attempt surfaces its own `error` and no `prove` reports one refusal twice. The controls run under
  `tmp/probe/` against the root `tsconfig.json`, which is why the Vitest project, its composition in
  the root configuration, and a `tmp/probe/` the host lets it create gate the boot rather than a
  claim.
- **Freshness.** Every `prove` revalidates before it answers. The runtime stage re-reads each
  workspace module and invalidates the ones whose contents moved; the type stage re-reads a file
  whose modification time moved. A warm service that skipped this would return a confident wrong
  answer about freshly edited source.
- **Configuration is read once per stage, not per claim.** Freshness covers source, and it does not
  cover the configuration a resident tool was built around. The type stage keys a language service
  by resolved project path and hands back the service it already holds, so a `tsconfig.json` edited
  after that service was built does not change the compiler options the stage applies or the
  project digest it reports. Oxlint's language server and the resident Vitest hold their own
  configuration the same way. Measured on 2026-08-20: one `TypeStage` reported the same options
  digest before and after its project file was rewritten, while a stage constructed afterwards
  reported a different one. So a receipt is read against the configuration the stage was built
  around. Destroy the probe and build another after you edit `tsconfig.json`, `.oxlintrc.json`, or
  `vite.config.ts`.
- **A failed warm is not permanent.** The runtime stage holds its resident Vitest in a slot it
  clears when that warm rejects, so the fault reaches the caller as the target tree's own —
  `origin: 'workspace'`, `code: 'malformed'`, naming `vite.config.ts` in `context` — rather than
  being masked by an aging resident runner. The next `inspect` finds the slot empty and warms fresh,
  reading the configuration again, so a workspace repaired after the failed call serves the call
  that follows it.
  One call never loops through a second warm of its own, and no failure leaves the stage permanently
  refusing. This is a recovery path rather than a reload: a warm that succeeded is kept, so the
  preceding entry's rule about editing `vite.config.ts` stands.
- **Admission.** One queue per stage admits inspections in arrival order, one at a time. The
  `deadline` covers active work rather than queue wait. Caller-named project resolution shares that
  order with type inspections, so a resolve never runs partway through one inspection's own
  candidate checks.
- **Expiry.** `ProbeOptions.deadline` is the coordinator's budget for one active stage inspection,
  and it lives outside the worker because a Vitest `testTimeout` cannot fire while a synchronous
  loop blocks that worker. An expiry at any stage abandons that stage, replaces it before the next
  queued inspection begins, and emits `expire` with the claim that expired. A failed boot is
  replaced the same way: the next claim runs the controls again rather than inheriting a refusal.
- **The budget is not the ceiling.** The deadline fires on the host's event loop, and a language
  service checks one candidate synchronously, so a type inspection that is inside such a check when
  the budget expires answers at the end of that candidate's checks. The type stage hands the loop
  back at each candidate boundary to keep that hold to one candidate, so an overrun is bounded by
  the budget plus the longest candidate diagnostic batch — the syntactic and semantic readings one
  candidate takes before the loop returns. The lint stage's exchanges cross a child process and the
  runtime stage's run happens in Vitest workers, so neither holds the loop and neither adds to the
  budget. Size `deadline` against the work, and expect a reported elapsed time to exceed it by one
  candidate's check.
- **Revisions.** Each runtime inspection writes its specification at a fresh path and never reuses
  one, because a resident runner asked to re-run a path it has already seen reports a false pass.
  One inspection in every 64 also replaces the resident runner, and that inspection costs more than
  the other 63 — budget `deadline` against that one rather than the common one. That fresh path
  never reaches a caller: a test that reads its own filename, through `import.meta.url` or through a
  frame in a failure it raised, reports the path the claim declared, because the stage rewrites the
  exact basename it generated back to the declared test's basename in every message it reports.
- **Teardown.** `destroy()` releases every resident process and is idempotent. It releases the
  emitter last, and releases it on a teardown that failed too, so a listener registered through
  `ProbeOptions.on` or through `probe.emitter` receives nothing after teardown settles and
  `probe.emitter.destroyed` reads true. A refusal a later `prove` raises still reaches the caller
  that asked for it, and reaches no listener. `ProbeServer.destroy`
  adds the process itself: it removes the listeners `start` attached — the `data`, `close`, and
  `error` forwarders on standard input, and the `SIGINT` and `SIGTERM` handlers on the process —
  and pauses the stream unless `start` found it already flowing, so the
  event loop drains and the process exits 0 with no explicit exit call. A stream nobody has read yet
  is neither flowing nor paused, and this server is what sets it flowing, so it is paused. A host
  already reading its own standard input keeps reading it after the server it embedded is destroyed.
- **The server removes only what it added.** Every listener `ProbeServer` attaches is held as a
  field and removed by reference, so a listener a host registers while the server is serving is
  still attached and still fires afterwards. Nothing is chosen by being absent from a capture,
  because a capture cannot tell a listener the server added from one the host added later. The
  transport is what makes that reachable: it reads a stream the server owns rather than this
  process's standard input, so its own listeners never land on `process.stdin` and the only
  listeners the server puts there are the `data`, `close`, and `error` forwarders into that stream.
  The release-time
  reader count is load-bearing for the same reason — a host that starts reading standard input
  while the server is serving keeps its reader and keeps the flow, even though `start` found the
  stream stopped and would otherwise pause it.
- **Stage teardown is bounded, and each stage is bounded by something different.** Every resident
  stage abandons the inspections it holds rather than waiting behind one, and what it then waits for
  differs per stage. The lint stage holds a bound of its own and sets it on the `@orkestrel/lsp`
  client it drives: 2 s for each lifecycle exchange the Language Server Protocol leaves to the
  server — the `initialize` reply that warming waits for and the `shutdown` reply that ending waits
  for. It does not reach the diagnostics an inspection waits for, which the caller's own signal
  bounds instead, so a tight teardown bound no longer preempts a claim's budget. The transport's
  cooperative window is half that 2 s, so a server that answers `shutdown` and then ignores `exit` is
  signalled and released inside the client's own wait for the close, rather than deadlocking
  `destroy()`. A server that accepts the connection and answers nothing is released the same way.
  The type stage holds no bound and needs none for its own tools: it disposes each language service
  directly, and the warm it awaits first is a module load rather than a wait. What it cannot cut
  short is a language-service call already running, for the reason the preceding **The budget is not
  the ceiling** entry gives. The runtime stage holds no bound either, so a `vitest.close()` that
  never settles is bounded by the coordinator instead: `Probe.destroy` races each stage's teardown
  against `ProbeOptions.deadline` and proceeds when the budget expires. What an abandoned tool still
  holds it holds until this process ends, so that bound buys the signal path rather than the
  resource — `destroy()` settles for a caller that set a budget it can wait for, instead of hanging
  behind a stage that will not close.
- **Termination.** `ProbeServer.start` answers `SIGINT` and `SIGTERM` by destroying the server, and
  they are the whole set: no evidence names a harness that ends a stdio child any other way, and
  a configurable set would be a supported way to spell the leak this closes. Another signal arriving
  during a teardown already running reaches the default disposition and ends the process at once,
  because teardown releases its handlers before the probe. Measured on 2026-08-20 on the host § Cost
  names, signal to child exit is 2.2 s to 2.3 s during boot and 50 ms to 59 ms against an armed
  probe, over 3 runs each. The boot-time figure is the long one because teardown awaits the boot in
  flight; budget a harness's grace window against it rather than against the warm case.
- **The listener race.** Every `createVitest` call installs `SIGINT` and `SIGTERM` handlers that end
  this process about a millisecond after the signal, which is three orders of magnitude inside the
  teardown the preceding **Termination** entry measures. The runtime stage removes the handlers its
  own warm installed, as the call
  returns and before anything is awaited, so no window exists for a signal to arrive in. Without
  that, a graceful teardown reads as fixed, passes a manual test, and still leaves its files in the
  consumer's tree.
- **What a killed host leaves.** A host killed without `destroy` — `SIGKILL`, a power loss, a
  harness that never signals — can leave a generated specification or a boot dependency behind.
  Every file this package writes into a target carries `probe-<pid>-<uuid>` between its stem and its
  extension, and the runtime stage deletes such a file at its next warm when the process id leads a
  process that is gone **and** the file is one this package can attribute. Attribution is what stops
  the sweep reaching your tree: a generated specification carries your own test text, so probe
  closes the file with the marker `// @orkestrel/probe generated specification <pid>-<uuid>`, and
  the sweep requires that marker to name the same revision the file name does. The boot
  dependencies carry the same marker, so nothing is attributed by its path and nothing under
  `tmp/probe/` is deleted for sitting there. A file of yours that happens to carry the same name
  shape is left where it is, wherever it sits, and so is a live neighbour's specification.

## Cost

The following measurements decide whether a harness's timeout is right. Each was taken on 2026-08-20,
over this repository as the target workspace, on Linux 6.18.5 x64 with 4 processors, Node 22.22.2,
TypeScript 6.0.3, Oxlint 1.79.0, and Vitest 4.1.11. Read them as the shape of the cost on comparable
hardware rather than as a figure another host reproduces.

| What                                                                 | Measured                     |
| -------------------------------------------------------------------- | ---------------------------- |
| Boot: spawning `dist/bin/main.js` to the first answered `tools/call` | 4.1 s to 4.4 s over 4 runs   |
| One warm `prove` over the flagship claim, client round trip          | 437 ms to 495 ms over 4 runs |

Boot is dominated by arming, which runs its real controls through every stage before the service
answers. A client whose timeout is tighter than boot reports a hang that is a wait.
Handshake requests answer immediately; only `tools/call` waits on arming.

`prove` runs the case through every stage and then the control through every stage, in sequence, so
one call pays the runtime stage's floor twice. One runtime inspection in every 64 also replaces
the resident Vitest runner and costs more than the other 63, so budget a client timeout against that
inspection rather than the common one.

## Tests

- [`guides.test.ts`](../tests/guides.test.ts) — this guide's parity directions, the claim
  literal shared with the `Claim` contract, what `verdict.digest` covers, and the flagship claim run
  for its receipt.
- [`helpers.test.ts`](../tests/src/core/helpers.test.ts) — the formatters, the receipt token's
  conditions, and the generated specification's marker.
- [`validators.test.ts`](../tests/src/core/validators.test.ts) — every guard against hostile shapes,
  including the draft path the advertised schema admits and the guard refuses.
- [`errors.test.ts`](../tests/src/core/errors.test.ts) — the failure guard against lookalikes and a
  duplicate copy of the package, and every failure path a test can drive without a resident tool,
  driven for real and read for the ownership and the condition it raised.
- [`Probe.test.ts`](../tests/src/server/Probe.test.ts) — arming, admission, deadline expiry and
  stage replacement, and the receipt decision end to end.
- [`helpers.test.ts`](../tests/src/server/helpers.test.ts) — the server leaves, including every
  documented example on this page's helper table and the members a refused claim names.
- [`TypeStage.test.ts`](../tests/src/server/stages/TypeStage.test.ts),
  [`LintStage.test.ts`](../tests/src/server/stages/LintStage.test.ts), and
  [`RuntimeStage.test.ts`](../tests/src/server/stages/RuntimeStage.test.ts) — the resident stages
  against their real tools.
- [`ProbeServer.test.ts`](../tests/src/server/ProbeServer.test.ts) — what `start` seizes and what
  `destroy` gives back, standard input's flow included, what a host attaches while the server is
  serving, and the key bound the installed package applies to a record-bearing result.
- [`Overlay.test.ts`](../tests/src/server/Overlay.test.ts) — the candidate set's identity,
  containment, and release.
- [`main.test.ts`](../tests/src/bin/main.test.ts) — the shipped entry driven by this repository's
  own line client and by the `@orkestrel/mcp` stdio client, the record and the rendered text its
  reply carries on both eras, and the signals delivered to it during boot and in service.
- [`distribution.test.ts`](../tests/distribution.test.ts) — the packed package installed outside the
  repository and driven through its public exports.

## See also

- [`README.md`](README.md) — the guides index.
- [`mcp.md`](mcp.md) — the dependency mirror for `@orkestrel/mcp`, whose server and stdio transport
  carry the `prove` tool.
- [`lsp.md`](lsp.md) — the dependency mirror for `@orkestrel/lsp`, whose client and stdio client
  transport carry the lint stage's conversation with the Oxlint language server.
- [`tool.md`](tool.md) — the dependency mirror for `@orkestrel/tool`, whose registry holds it.
- [`contract.md`](contract.md) — the dependency mirror for `@orkestrel/contract`, whose shapes
  compile both the published tool schema and the guards.
- [`AGENTS.md`](../AGENTS.md) — the repository's coding and documentation contract.
