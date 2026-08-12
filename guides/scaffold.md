# Scaffold

> Scaffold compiles a workspace specification into an ordered list of files, compares that list to a
> real directory, and writes the difference. It ships one executable, `scaffold`, and two library
> entry points: `@orkestrel/scaffold` is the pure compiler and its data contracts, and
> `@orkestrel/scaffold/server` is the filesystem writer and the network reader. Source:
> [`src/core/index.ts`](../src/core/index.ts) and [`src/server/index.ts`](../src/server/index.ts).

The package exists because every `@orkestrel` repository shares the same toolchain, the same agent
instructions, and the same root dotfiles. Keeping thirty copies of those files in agreement by hand
does not work. Scaffold makes the shared set data — a vendored data root shipped inside the package
— and gives it three verbs: create a workspace from it, report how a workspace differs from it, and
write the difference back.

Every code fence below is illustrative. Nothing runs one, so a trailing `// value` comment inside a
fence is this guide's claim rather than a measured answer; the driven examples are the ones the
shipped declarations print. Limits states what that leaves unproven and what covers it instead.

```sh
npm install --save-dev @orkestrel/scaffold
```

The executable needs Node 22.12 or newer. Run it through `npx` without installing:

```sh
npx @orkestrel/scaffold --help
```

## Surface

### Core

Exported from `@orkestrel/scaffold`, and reachable from
[`src/core/index.ts`](../src/core/index.ts).

#### Types

| Name                | Kind | Summary                                                                                          |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `Artifact`          | type | One file in a plan, discriminated by how its content is produced and what scaffold claims of it. |
| `BuildFormat`       | type | One module format a published library environment builds.                                        |
| `CatalogEntry`      | type | One package row of the fleet catalog.                                                            |
| `CompileStage`      | type | The three compile phases, in the order they run.                                                 |
| `CompilerEventMap`  | type | The compiler's observation channel.                                                              |
| `Drift`             | type | How one target path compares to the artifact planned for it.                                     |
| `Environment`       | type | One environment a generated workspace selects on its `src` or `app` axis.                        |
| `Finding`           | type | One drift verdict against a target path.                                                         |
| `Group`             | type | The artifact group a plan selects over.                                                          |
| `Lookup`            | type | Whether an upstream lookup produced an answer.                                                   |
| `Mirror`            | type | One dependency guide fetched from upstream, beside the local mirror it answers for.              |
| `Origin`            | type | How an artifact's content is produced.                                                           |
| `Ownership`         | type | What scaffold claims at an artifact's path.                                                      |
| `Release`           | type | One declared dependency range measured against the registry's latest release.                    |
| `ScaffoldErrorCode` | type | The coded reasons a scaffold error is raised.                                                    |
| `Snapshot`          | type | Exact lowercase hexadecimal target bytes keyed by artifact-relative path.                        |

#### Interfaces

| Name                | Kind      | Summary                                                                                 |
| ------------------- | --------- | --------------------------------------------------------------------------------------- |
| `AppDefinition`     | interface | The configuration and runtime-entry settings one private `app` environment contributes. |
| `ArtifactBase`      | interface | The fields every planned file carries.                                                  |
| `Audit`             | interface | The whole comparison of a plan against a target's current content.                      |
| `Blueprint`         | interface | The closed, JSON-serializable workspace specification.                                  |
| `CompileFailure`    | interface | The coded reason one compile stage failed.                                              |
| `CompileRecord`     | interface | The input and output snapshot of one compile stage.                                     |
| `CompilerInterface` | interface | The compilation contract: pure, synchronous, and host-independent.                      |
| `CompilerOptions`   | interface | Options for the compiler.                                                               |
| `ContentArtifact`   | interface | A text file produced by the template or computed compilation path.                      |
| `Dependency`        | interface | One runtime `@orkestrel/*` dependency of a generated workspace.                         |
| `HostArtifact`      | interface | A file byte-copied from the vendored data root, planned before its bytes are read.      |
| `HydratedArtifact`  | interface | A vendored file whose exact bytes have been read, so its content can be compared.       |
| `Override`          | interface | One artifact override.                                                                  |
| `PlanSummary`       | interface | The tally of one plan by artifact origin.                                               |
| `Plan`              | interface | The compiled, ordered artifact list and the selection it covers.                        |
| `Question`          | interface | One validation issue raised against a blueprint or a plan.                              |
| `Scaffolding`       | interface | The replayable outcome of one compile.                                                  |
| `SrcDefinition`     | interface | The build and export settings one published `src` environment contributes.              |
| `ViteMachinery`     | interface | Which host-specific pipelines a generated root Vite configuration carries.              |

#### Constants

| Name                              | Kind  | Summary                                                                                          |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `APP_BROWSER_DEV_DEPENDENCIES`    | const | The development dependencies a private Vue browser application adds.                             |
| `APP_DEV_DEPENDENCIES`            | const | The development dependency every private `app` environment adds.                                 |
| `APP_MATRIX`                      | const | The configuration and runtime-entry settings each private `app` environment contributes, frozen. |
| `APP_SERVER_DEV_DEPENDENCIES`     | const | The development dependencies a private server application adds.                                  |
| `ARTIFACT_TEMPLATES`              | const | Formatter-stable template text for source, test, document, guide, and service artifacts.         |
| `BASE_DEV_DEPENDENCIES`           | const | The tooling versions scaffold and every generated workspace share.                               |
| `BIN_CONFIGS`                     | const | The configuration files a workspace that ships its own executable adds, frozen.                  |
| `BIN_ENTRY_PATH`                  | const | The executable entry whose presence makes a workspace `bin`.                                     |
| `CATALOG_AGENT_PATH`              | const | The agent file whose marker-bounded package table the catalog verb alone owns.                   |
| `CONFIG_TEMPLATES`                | const | Formatter-stable template text for every configuration artifact.                                 |
| `CONTROL_CHARACTER_PATTERN`       | const | Unicode controls, formatting controls, and line and paragraph separators rejected in text.       |
| `DEFAULT_ENGINES`                 | const | The `engines.node` range a workspace starts with.                                                |
| `DEFAULT_VERSION`                 | const | The version a workspace starts at.                                                               |
| `DEPENDENCY_NAME_PATTERN`         | const | The runtime dependency name syntax: the `@orkestrel` scope and a bare name.                      |
| `ENGINES_PATTERN`                 | const | The minimum-Node engine syntax a blueprint declares.                                             |
| `ENVIRONMENTS`                    | const | The three `Environment` values, frozen.                                                          |
| `EXTRA_NAME_PATTERN`              | const | The development extra name syntax: any valid npm package name.                                   |
| `EXTRA_RANGE_PATTERN`             | const | The registry-only semver subset accepted for a development extra's range.                        |
| `GLOBAL_SETUP_PATH`               | const | The shared Vitest global-setup module whose presence makes a workspace `global`.                 |
| `GUIDES_TEST_PATH`                | const | The guide-parity proof whose physical file selects the fixed `guides` project.                   |
| `EXECUTABLE_PATHS`                | const | The vendored paths a target receives with its executable bit set, frozen.                        |
| `GROUPS`                          | const | The seven `Group` values in plan order, frozen.                                                  |
| `HEX_PATTERN`                     | const | Exact lowercase hexadecimal bytes: two digits per byte, and empty content is valid.              |
| `HOST_PATHS`                      | const | The paths byte-copied from the vendored data root, frozen.                                       |
| `INTEGRATION_TEST_PATH`           | const | The installed-package proof whose presence makes a workspace `integration`.                      |
| `INVALID_PATH_CHARACTER_PATTERN`  | const | Visible characters a target-relative path and a Markdown path cell both forbid.                  |
| `MAX_ARTIFACT_BYTES`              | const | Maximum bytes accepted for one artifact.                                                         |
| `MAX_ARTIFACT_HEX_LENGTH`         | const | Maximum length of the hexadecimal string carrying one artifact's bytes.                          |
| `MAX_AUDIT_FINDINGS`              | const | Maximum findings one audit can produce from a bounded plan and snapshot.                         |
| `MAX_COLLECTION_ITEMS`            | const | Maximum items accepted in one public collection.                                                 |
| `MAX_DEPENDENCY_NAME_LENGTH`      | const | Maximum dependency package name length, scope included, as the registry caps it.                 |
| `MAX_MANIFEST_BYTES`              | const | Maximum bytes accepted for one package or vendored-host manifest.                                |
| `MAX_NAME_LENGTH`                 | const | Maximum bare workspace name length.                                                              |
| `MAX_PATH_LENGTH`                 | const | Maximum length of one path, matching the longest a supported filesystem accepts.                 |
| `MAX_RANGE_LENGTH`                | const | Maximum length of one declared package range.                                                    |
| `MAX_TOTAL_ARTIFACT_BYTES`        | const | Maximum bytes retained across one whole plan or audit.                                           |
| `MINIMUM_NODE_VERSION`            | const | The oldest Node version the generated toolchain supports.                                        |
| `NAME_PATTERN`                    | const | The bare workspace name syntax: lowercase alphanumeric with hyphens, letter first.               |
| `ORCHESTRATION_PATH_NAMES`        | const | The exact root filenames that wire an agent bench rather than the toolchain, frozen.             |
| `ORCHESTRATION_PATH_PREFIXES`     | const | The path prefixes whose contents instruct or wire an agent, frozen.                              |
| `ORKESTREL_RANGE_PATTERN`         | const | The exact caret-pinned pre-1.0 range accepted for an `@orkestrel/*` runtime dependency.          |
| `SERVICE_SCRIPT_PATH`             | const | The provisioner skeleton a workspace with declared service vendors is given once.                |
| `SHOWCASE_CONFIG_PATH`            | const | The Vite wrapper whose presence makes a workspace `showcase`.                                    |
| `SHOWCASE_DEV_DEPENDENCIES`       | const | The development dependency used only by the optional single-file showcase build.                 |
| `SOURCE_BROWSER_DEV_DEPENDENCIES` | const | The development dependencies a published browser `src` environment adds.                         |
| `SRC_MATRIX`                      | const | The build and export settings each published `src` environment contributes, frozen.              |
| `VERSION_PATTERN`                 | const | The exact three-component version syntax a blueprint declares.                                   |

#### Guards

| Name                | Kind     | Summary                                                                          |
| ------------------- | -------- | -------------------------------------------------------------------------------- |
| `isArtifact`        | const    | Narrow a value to an `Artifact`.                                                 |
| `isAudit`           | const    | Narrow a value to an `Audit`.                                                    |
| `isBlueprint`       | const    | Narrow a value to a `Blueprint`.                                                 |
| `isCatalogEntry`    | const    | Narrow a value to a `CatalogEntry`.                                              |
| `isCollection`      | function | Narrow a value to an array within the limit one public collection accepts.       |
| `isCompilerHooks`   | const    | Narrow a value to the compiler's initial listener record.                        |
| `isCompilerOptions` | const    | Narrow a value to `CompilerOptions`.                                             |
| `isContent`         | const    | Narrow a value to text this package will accept as one artifact's content.       |
| `isDependencyName`  | const    | Narrow a value to the scoped package name a runtime dependency carries.          |
| `isDependency`      | const    | Narrow a value to a `Dependency`.                                                |
| `isEnvironment`     | const    | Narrow a value to one `Environment` a workspace may select.                      |
| `isFinding`         | const    | Narrow a value to a `Finding`.                                                   |
| `isGroup`           | const    | Narrow a value to one `Group` a plan selects over.                               |
| `isGroups`          | const    | Narrow a value to a bounded group selection.                                     |
| `isHex`             | const    | Narrow a value to exact lowercase hexadecimal bytes within one artifact's limit. |
| `isMirror`          | const    | Narrow a value to a `Mirror`.                                                    |
| `isOverride`        | const    | Narrow a value to an `Override`.                                                 |
| `isPath`            | function | Narrow a value to a logical target-relative path.                                |
| `isPlan`            | const    | Narrow a value to a `Plan`.                                                      |
| `isQuestion`        | const    | Narrow a value to a `Question`.                                                  |
| `isScaffoldError`   | function | Narrow a caught value to a `ScaffoldError`.                                      |
| `isSnapshot`        | function | Narrow a value to a `Snapshot`.                                                  |

#### Parsers

| Name                   | Kind     | Summary                                         |
| ---------------------- | -------- | ----------------------------------------------- |
| `parseBlueprint`       | function | Coerce an untrusted value to a `Blueprint`.     |
| `parseCompilerOptions` | function | Coerce an untrusted value to `CompilerOptions`. |
| `parseGroups`          | function | Coerce an untrusted value to a group selection. |
| `parseSnapshot`        | function | Coerce an untrusted value to a `Snapshot`.      |

#### Helpers

| Name                        | Kind     | Summary                                                                       |
| --------------------------- | -------- | ----------------------------------------------------------------------------- |
| `artifactToHex`             | function | Project an artifact to the exact bytes it claims, as hexadecimal.             |
| `bytesToHex`                | function | Encode bytes as exact lowercase hexadecimal text.                             |
| `catalogToLayers`           | function | Project a catalog into the layers it publishes in.                            |
| `cloneValue`                | function | Snapshot an untrusted value into exact JSON data the caller owns.             |
| `compareVersions`           | function | Compare two versions by their numeric components.                             |
| `computeBytes`              | function | Count the UTF-8 bytes text encodes to.                                        |
| `computeHash`               | function | Compute the deterministic content identity of text.                           |
| `contentToHex`              | function | Encode text as the exact lowercase hexadecimal form of its UTF-8 bytes.       |
| `extractVersion`            | function | Extract the three numeric components of an exact version.                     |
| `inferDrift`                | function | Infer how one target path compares to the artifact planned for it.            |
| `inferGroup`                | function | Infer the `Group` a path belongs to.                                          |
| `manifestToDependencies`    | function | Project a package manifest's text to the `@orkestrel/*` packages it declares. |
| `manifestToName`            | function | Project a package manifest's text to its own name.                            |
| `matchesDriftReachability`  | function | Test whether `inferDrift` could have produced a finding for an ownership.     |
| `matchesEngines`            | function | Test whether a declared engines floor is at or above the supported minimum.   |
| `matchesOrchestrationPath`  | function | Test whether a path instructs or wires an agent rather than the toolchain.    |
| `matchesRange`              | function | Test whether a declared range already admits a published version.             |
| `nameToGuide`               | function | Derive the guide mirror path a package name answers for.                      |
| `planToSummary`             | function | Project a plan into its tally by artifact origin.                             |
| `selectGroups`              | function | Select the groups a compile covers, in plan order.                            |
| `selectHostPaths`           | function | Select the host paths a named workspace vendors.                              |
| `serializeTypeScriptString` | function | Serialize one string as a single-quoted TypeScript literal.                   |

#### Compilers

| Name                                | Kind     | Summary                                                                         |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `applyOverrides`                    | function | Replace the content of every drafted artifact an override names.                |
| `artifactToFinding`                 | function | Project one planned artifact and the bytes found at its path into a verdict.    |
| `artifactsToQuestions`              | function | Measure a drafted artifact list against the laws a whole plan decides.          |
| `blueprintToConfigArtifacts`        | function | Compile every artifact in the `configs` group.                                  |
| `blueprintToDevDependencies`        | function | Project a blueprint into the development dependencies its manifest declares.    |
| `blueprintToDocumentArtifacts`      | function | Compile the generated workspace's root documentation.                           |
| `blueprintToGuideArtifacts`         | function | Compile the generated workspace's guide index.                                  |
| `blueprintToMachinery`              | function | Derive the host-specific machinery a generated root Vite configuration carries. |
| `blueprintToManifest`               | function | Compile a blueprint into its `package.json` content.                            |
| `blueprintToOrchestrationArtifacts` | function | Compile the blueprint-dependent orchestration artifacts.                        |
| `blueprintToQuestions`              | function | Measure a blueprint against every law its own fields decide.                    |
| `blueprintToRootTsconfig`           | function | Compile the root TypeScript configuration for a blueprint.                      |
| `blueprintToRootVite`               | function | Compile the root Vite and Vitest configuration for a blueprint.                 |
| `blueprintToScripts`                | function | Project a blueprint into the scripts its manifest declares.                     |
| `blueprintToSourceArtifacts`        | function | Compile every artifact in the `source` group.                                   |
| `blueprintToTestArtifacts`          | function | Compile every artifact in the `tests` group that is not vendored from the host. |
| `dependenciesToQuestions`           | function | Measure one declared package list against the name and range syntax it accepts. |
| `nameToHostArtifacts`               | function | Compile the vendored host artifacts a named workspace plans.                    |
| `overridesToQuestions`              | function | Measure a blueprint's overrides against the artifacts drafted for it.           |
| `pathToCondition`                   | function | Build one `exports` condition block for a built environment.                    |
| `planToFindings`                    | function | Compare a plan against a target's current content.                              |
| `planToHash`                        | function | Compute a plan's content identity.                                              |
| `srcToEntry`                        | function | Project a published selection into the manifest's entry fields.                 |
| `srcToExports`                      | function | Project a published selection into the manifest's `exports` map.                |
| `srcToRoot`                         | function | Select the single published environment a package root points at.               |

#### Factories

| Name              | Kind     | Summary                                                                           |
| ----------------- | -------- | --------------------------------------------------------------------------------- |
| `createBlueprint` | function | Construct a `Blueprint` from a name and the fields that differ from the defaults. |
| `createCompiler`  | function | Construct a `Compiler`.                                                           |

#### Classes

| Name            | Kind  | Summary                                                                     |
| --------------- | ----- | --------------------------------------------------------------------------- |
| `Compiler`      | class | The compile spine: draft, gate, pin, run in that order over a blueprint.    |
| `ScaffoldError` | class | The one error this package throws, carrying the coded reason it was raised. |

### Server

Exported from `@orkestrel/scaffold/server`, and reachable from
[`src/server/index.ts`](../src/server/index.ts).

#### Types

| Name                   | Kind | Summary                                    |
| ---------------------- | ---- | ------------------------------------------ |
| `MaterializerEventMap` | type | The materializer's observation channel.    |
| `UpstreamEventMap`     | type | The upstream reader's observation channel. |

#### Interfaces

| Name                    | Kind      | Summary                                                                              |
| ----------------------- | --------- | ------------------------------------------------------------------------------------ |
| `HostManifest`          | interface | The complete vendored-host inventory.                                                |
| `ManifestEntry`         | interface | One file record of the vendored host's manifest.                                     |
| `MaterializeResult`     | interface | The outcome of one mutation of a target.                                             |
| `MaterializerInterface` | interface | The mutation contract: the package's only filesystem writer.                         |
| `MaterializerOptions`   | interface | Options for the materializer.                                                        |
| `Repository`            | interface | What git reports about a target's working tree.                                      |
| `UpstreamInterface`     | interface | The upstream contract: the package's only network reader, and it never writes.       |
| `UpstreamOptions`       | interface | Options for the upstream reader.                                                     |
| `WriteAnchor`           | interface | One physical directory identity captured across a write transaction.                 |
| `WriteDirectoryResult`  | interface | The final directory anchor of a write transaction and the subset one call created.   |
| `WriteExpectation`      | interface | One destination snapshot captured before a write and required to survive it.         |
| `WritePrecondition`     | interface | The narrower caller-observed destination state a write transaction must still match. |

#### Constants

| Name                                | Kind  | Summary                                                                                  |
| ----------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `BRANCH_PATTERN`                    | const | The Git branch syntax the guide endpoint accepts.                                        |
| `DIGEST_PATTERN`                    | const | The exact SHA-256 syntax a digest is stated in: sixty-four lowercase hexadecimal digits. |
| `DRIVE_PATTERN`                     | const | The drive prefix a Windows host path may open with.                                      |
| `INVALID_SEGMENT_CHARACTER_PATTERN` | const | Visible characters no host path segment may carry.                                       |
| `MANIFEST_NAME`                     | const | The reserved metadata name a staged vendored host writes at its own root.                |
| `MAX_BRANCH_LENGTH`                 | const | Maximum characters one guide branch may carry.                                           |
| `MAX_ENDPOINT_LENGTH`               | const | Maximum characters one caller-supplied upstream endpoint may carry.                      |
| `MAX_INVENTORY_PATHS`               | const | Maximum paths one target's working-tree inventory may report.                            |
| `MAX_PATH_DEPTH`                    | const | Maximum segments one host path may carry.                                                |
| `MAX_PATH_SEGMENT_BYTES`            | const | Maximum UTF-8 bytes one host path segment may encode to.                                 |
| `MAX_UPSTREAM_CONCURRENCY`          | const | Maximum simultaneous upstream requests.                                                  |
| `MAX_UPSTREAM_RETRIES`              | const | Maximum retries one upstream request may be given after a transport fault.               |
| `MAX_UPSTREAM_TIMEOUT`              | const | Maximum timeout one upstream request may be given, in milliseconds.                      |
| `RESERVED_SEGMENT_PATTERN`          | const | The Windows device names that stay reserved even when an extension follows.              |

#### Guards

| Name                    | Kind     | Summary                                                                            |
| ----------------------- | -------- | ---------------------------------------------------------------------------------- |
| `isBranch`              | const    | Narrow a value to a Git branch the guide endpoint accepts.                         |
| `isCatalogEntries`      | const    | Narrow a value to a bounded list of fleet catalog rows.                            |
| `isDependencies`        | const    | Narrow a value to a bounded list of declared runtime dependencies.                 |
| `isDependencyNames`     | const    | Narrow a value to a bounded list of `@orkestrel` package names.                    |
| `isDigest`              | const    | Narrow a value to one exact SHA-256 digest.                                        |
| `isEndpoint`            | const    | Narrow a value to a bounded upstream endpoint.                                     |
| `isFilesystemPath`      | function | Narrow a value to a path naming a location on this host.                           |
| `isHostManifest`        | const    | Narrow a value to one `HostManifest`.                                              |
| `isInventory`           | function | Narrow a value to a working-tree inventory within the limit one target may report. |
| `isManifestEntry`       | const    | Narrow a value to one `ManifestEntry`.                                             |
| `isMaterializerHooks`   | const    | Narrow a value to the materializer's initial listener record.                      |
| `isMaterializerOptions` | const    | Narrow a value to `MaterializerOptions`.                                           |
| `isMirrors`             | const    | Narrow a value to a bounded list of fetched guide mirrors.                         |
| `isRepository`          | const    | Narrow a value to a `Repository`.                                                  |
| `isTimeout`             | const    | Narrow a value to a per-request timeout in milliseconds.                           |
| `isUpstreamHooks`       | const    | Narrow a value to the upstream reader's initial listener record.                   |
| `isUpstreamOptions`     | const    | Narrow a value to `UpstreamOptions`.                                               |

#### Helpers

| Name                    | Kind     | Summary                                                                               |
| ----------------------- | -------- | ------------------------------------------------------------------------------------- |
| `computeDigest`         | function | Compute the SHA-256 digest of text.                                                   |
| `computeFileDigest`     | function | Compute the SHA-256 digest of one file's exact bytes.                                 |
| `computeManifestDigest` | function | Compute the digest of a vendored host's declared membership.                          |
| `isExactCaseFile`       | function | Test whether a physical file's path matches every on-disk segment exactly.            |
| `isPhysicalDirectory`   | function | Test whether a path is a physical directory this package will read or write into.     |
| `isPhysicalFile`        | function | Test whether a path is a physical file this package will read or replace.             |
| `isVacant`              | function | Test whether a target is safe to write a fresh workspace into.                        |
| `listDirectories`       | function | List a directory's descendant directories as sorted root-relative paths.              |
| `listFiles`             | function | List a directory's files as sorted root-relative paths.                               |
| `matchesAnchor`         | function | Test whether a captured directory is still the same directory.                        |
| `matchesExecutablePath` | function | Test whether a vendored path is one a target receives executable.                     |
| `matchesExpectation`    | function | Test whether a destination still holds what was captured of it.                       |
| `matchesGitPath`        | function | Test whether a path addresses a target's own repository metadata.                     |
| `matchesMissingPath`    | function | Test whether a caught filesystem error reports an absent path.                        |
| `matchesPrecondition`   | function | Test whether a destination still matches the narrower state a caller observed.        |
| `matchesProtectedPath`  | function | Test whether a target-relative path is one no verb may delete.                        |
| `matchesSensitivePath`  | function | Test whether a path names local configuration or a credential.                        |
| `pathToStorage`         | function | Project a target-relative path to the storage name a vendored host holds it under.    |
| `readAnchor`            | function | Capture one directory's physical identity.                                            |
| `readExpectation`       | function | Capture what one destination holds before a write.                                    |
| `readFileHex`           | function | Read one contained file as its exact bytes in lowercase hexadecimal.                  |
| `readFileText`          | function | Read one contained file as bounded UTF-8 text.                                        |
| `readHostManifest`      | function | Read a vendored host's manifest, when it carries one.                                 |
| `readManifestEntry`     | function | Derive one vendored-host manifest entry from a file in a checkout.                    |
| `readSnapshot`          | function | Read a target's current bytes at the paths a plan claims.                             |
| `resolveContainedPath`  | function | Resolve a root-relative path and refuse one that leaves its root.                     |
| `resolveRealPath`       | function | Resolve a path through the real filesystem, keeping the part that does not exist yet. |
| `stageHost`             | function | Stage a vendored host root from a real checkout.                                      |

#### Factories

| Name                 | Kind     | Summary                     |
| -------------------- | -------- | --------------------------- |
| `createMaterializer` | function | Construct a `Materializer`. |
| `createUpstream`     | function | Construct an `Upstream`.    |

#### Classes

| Name               | Kind  | Summary                                                                            |
| ------------------ | ----- | ---------------------------------------------------------------------------------- |
| `Materializer`     | class | The mutation spine: read the vendored host, re-derive the target, stage, swap.     |
| `Upstream`         | class | The reading spine: one bounded, unauthenticated, redirect-free request per answer. |
| `WriteTransaction` | class | One staged, reversible mutation of one target directory.                           |

## Methods

`Compiler` implements `CompilerInterface`, `Materializer` implements `MaterializerInterface`, and
`Upstream` implements `UpstreamInterface`. Each class exposes exactly its interface's members and
nothing more, so the interface tables below describe the classes too. `WriteTransaction` publishes
no interface and is documented directly.

#### `CompilerInterface`

| Method    | Summary                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `compile` | Compile a blueprint into a plan through the draft, gate, and pin stages.     |
| `audit`   | Compile a blueprint and compare its plan to a target's current content.      |
| `destroy` | Tear the compiler down. Every later call throws, and teardown is idempotent. |

#### `MaterializerInterface`

| Method        | Summary                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `audit`       | Compare a plan with a target through the vendored host that will repair it.      |
| `materialize` | Write a plan into a vacant target.                                               |
| `repair`      | Write a plan into an existing target, guided by an audit of it.                  |
| `mirror`      | Write fetched dependency guides to their local mirrors.                          |
| `catalog`     | Rewrite the marker-bounded package table in the target's catalog agent file.     |
| `declare`     | Rewrite the `@orkestrel/*` range set in the target's manifest.                   |
| `remove`      | Delete the files the plan does not own.                                          |
| `destroy`     | Tear the materializer down. Every later call throws, and teardown is idempotent. |

#### `UpstreamInterface`

| Method    | Summary                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `lookup`  | Look up the registry's latest release for each declared dependency.        |
| `fetch`   | Fetch each named package's guide, beside the local mirror it answers for.  |
| `catalog` | Catalog the published fleet from the registry's organization package list. |
| `destroy` | Tear the reader down, aborting every request in flight.                    |

#### `WriteTransaction`

| Method      | Summary                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| `write`     | Stage one text file.                                                               |
| `copy`      | Stage one byte-for-byte copy in executable or non-executable destination mode.     |
| `directory` | Establish one directory inside the target, one segment at a time.                  |
| `remove`    | Mark one file for deletion at commit.                                              |
| `commit`    | Promote every staged file and take every marked file, or roll the whole call back. |
| `discard`   | Abandon the transaction and remove everything it created.                          |

## Command line

Five verbs. Authority is the verb's: every verb except `audit` writes when it is typed, and no
option grants a write.

| Verb        | Writes                                                                            |
| ----------- | --------------------------------------------------------------------------------- |
| `new`       | A whole workspace, into a target that holds nothing the plan would collide with   |
| `audit`     | Nothing                                                                           |
| `repair`    | Each planned path the target is missing or has let drift                          |
| `catalog`   | The package table and the guide mirrors                                           |
| `overwrite` | Everything `repair` and `catalog` write, plus deletions and the dependency ranges |

`scaffold --help` prints the whole reference:

```text
scaffold <verb> [options]

  scaffold new <name> [--src <list>] [--app <list>] [--bin] [--deps <list>] [--from <path>] [--target <path>] [--json]
      scaffold a workspace
  scaffold audit [--groups <list>] [--from <path>] [--target <path>] [--json]
      report how the target compares to its plan, writing nothing
  scaffold repair [--groups <list>] [--from <path>] [--target <path>] [--json]
      write each planned path the target is missing or has let drift
  scaffold catalog [--all] [--from <path>] [--target <path>] [--json]
      regenerate the package table and refresh the guide mirrors
  scaffold overwrite [--groups <list>] [--dirty] [--from <path>] [--target <path>] [--json]
      do everything repair and catalog do, then delete what the plan does not own and re-declare the dependency ranges

options
  --src <list>     the published library environments to build: core, browser, server
  --app <list>     the private application environments to build: core, browser, server
  --bin            scaffold a command-line executable at src/bin/main.ts
  --deps <list>    the @orkestrel/* packages the workspace depends on
  --groups <list>  the artifact groups to cover; every group when absent
  --all            fetch a guide for every package the organization publishes, not just the declared ones
  --dirty          delete from a tree carrying uncommitted changes
  --from <path>    read the data root from a local path instead of the bundled one; catalog alone accepts it more than once
  --target <path>  the directory the verb operates on; the working directory when absent
  --json           emit one machine-readable value instead of a report

exit codes
  0  clean
  1  drift or failure
  2  usage error
```

An option a verb does not list is refused by name rather than parsed and ignored. `--deps` reaches
the registry, so `new` fails when the registry names no release for a package it was given: the
workspace would otherwise declare a dependency that does not resolve.

`new --bin` creates the executable entry, its test, and its scoped Vite and TypeScript wrappers.
The other structural facts do not need creation flags. Add `tests/integration.test.ts` for
`integration`, `tests/setupGlobal.ts` for `global`, and
`configs/app/vite.showcase.config.ts` for `showcase`; reading verbs detect each exact-case file and
register its fixed machinery. Add `scripts/service.sh` for `services`. Reading verbs preserve and
protect that birth-owned script, but do not infer its service list from edited text.

### Reading a target

`audit`, `repair`, `catalog`, and `overwrite` derive the blueprint from the target itself. The name
and the declared `@orkestrel/*` packages come from `package.json`. The two environment axes come
from the directories the target actually ships, because a directory is the fact and a declaration
beside it could disagree. Four more facts come from exact-case files: `src/bin/main.ts` selects
`bin`, `tests/integration.test.ts` selects `integration`, `tests/setupGlobal.ts` selects `global`,
and `configs/app/vite.showcase.config.ts` selects `showcase`. A containing directory does not select
the fact by itself.

`services` is not reconstructed. Its only artifact, `scripts/service.sh`, is birth-owned, so edited
script text is not a trustworthy declaration of a service list. A present script remains in the
target and remains protected from deletion through the owned scripts inventory, but a reading verb
does not infer services from it.

The root Vite configuration always defines the fixed `guides` project and selects it at
configuration load only when `tests/guides.test.ts` is a physical file with that exact path case. A
directory or a case-folded spelling does not select it. A fresh workspace therefore carries no
guides project. A workspace that later adds the proof keeps the project through `repair`. The
birth-owned manifest still gains no `test:guides` script automatically; the developer who adds the
proof adds that script too.

The three plan-reading verbs compare every Vitest project named by the target manifest's scripts
with the project set the planned root configuration will load. One shell-token pass reads quoted and
unquoted `--project value` and `--project=value` forms. A shell expansion or malformed quote that
prevents a project value from being resolved statically produces a question instead of licensing a
write. The classifier is deliberately bounded to manifest script text that names `vitest`; an
external wrapper whose name does not identify its runner supplies no static Vitest fact to infer.

`audit` still completes the comparison and reports one non-blocking `projects` question. For a
literal absent project, its advisory tells the developer to register the project or remove the
script. `repair` and `overwrite` refuse instead. Their refusal tells the developer to remove the
script or not use scaffold writing verbs for a workspace that needs custom Vitest projects. It does
not recommend editing the content-owned configuration that the refusing verb would restore. An
advisory alone does not make an aligned target drift.

### Exit codes

`0` means the target matched its plan and every step completed. `1` means the target drifted or a
step failed. `2` means the command line was not a command. A foreign file counts as drift: the
target holds something the plan does not own, whether or not the verb that found it was allowed to
remove it.

### Git

`overwrite` is the only verb that reads git, and it needs a repository. It asks git for the tracked
set and the dirty set, deletes only tracked paths, and refuses a tree carrying uncommitted changes
unless `--dirty` waives that refusal. A target that is not a git repository is refused under
`TARGET`, because deletion there would have no recovery mechanism. The other four verbs never ask.

### Machine-readable output

`--json` replaces the report with one JSON value on standard output. Warnings and refusals go to
standard error, so a piped value is never polluted.

| Verb        | Value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| `new`       | `MaterializeResult` — `target`, `written`, `skipped`, `removed`            |
| `audit`     | `Audit` — `findings` and `questions`; planned findings carry `ownership`   |
| `repair`    | `MaterializeResult` plus `audit`, the terminal audit taken after the write |
| `catalog`   | `MaterializeResult` plus `entries`, `mirrors`, and `dropped`               |
| `overwrite` | The `catalog` value plus `audit`, `releases`, and `note` on a partial run  |

Every failure reports the same envelope instead: `{ "error": { "code": …, "message": … } }`. The
code is a `ScaffoldErrorCode`, or `USAGE` for a command line that never became a command, or
`FAILED` for a raised value that published no code of its own. A command line that never became a
command carries no `--json`, so its refusal is always prose.

## Blueprint

A `Blueprint` is the closed, JSON-serializable specification of one workspace. `createBlueprint`
fills every field a caller does not state:

```ts
import { createBlueprint } from '@orkestrel/scaffold'

const blueprint = createBlueprint('router', {
	src: ['core', 'server'],
	dependencies: [{ name: '@orkestrel/emitter', range: '^0.0.5' }],
	bin: true,
})

blueprint.version // '0.0.1'
blueprint.engines // '>=22.12.0'
```

`src` selects published library environments and `app` selects private application environments.
The two axes are independent, so a library-only, an application-only, and a mixed workspace are all
first class. `dependencies` and `peers` are runtime `@orkestrel/*` packages; `extras` are
development dependencies and may carry any valid npm name.

One published environment owns the package root directly. Several published environments require
`core`, which owns that root while each other environment keeps its subpath. A multi-environment
`src` selection without `core` therefore emits entry fields naming a `core` build the workspace
never runs. The gate reports that as a non-blocking `src` question rather than refusing the compile,
because the shape is chosen once and read afterwards: `new` refuses the advisory, while `audit` and
`repair` need the plan to describe and restore a target that already has that shape. A library
caller creating a workspace holds the same refusal, and the Compile section below states it.

`bin`, `integration`, `services`, `global`, and `showcase` are structural facts. Each is set only
when the workspace physically ships the directory or exact-case file that defines it, never because
of the workspace's name and never because a sibling fact is set.

An axis-dependent structural fact projects only when its required axis exists. `integration`
projects a published `src`, and `showcase` projects the browser `app` environment. When that axis is
absent the flag adds no artifact, configuration, script, or dependency, and the gate reports a
non-blocking question on that field so the caller who set it learns it emitted nothing. The same
rule applies to both facts.

`createBlueprint` enforces shape only. Whether the name is a name, the version a version, and the
axis combination one this package can generate are the gate's laws, and the gate answers them with
questions. A blueprint the gate will refuse is still constructible, so one law lives in one place.

## Compile

The compiler is pure, synchronous, and host-independent. It runs three stages in order.

| Stage   | Does                                                                     |
| ------- | ------------------------------------------------------------------------ |
| `draft` | Assembles the artifacts the selected groups cover, and applies overrides |
| `gate`  | Measures the blueprint, its overrides, and the drafted artifacts         |
| `pin`   | Gives the plan its content identity                                      |

```ts
import { createBlueprint, createCompiler } from '@orkestrel/scaffold'

const compiler = createCompiler()
const scaffolding = compiler.compile(createBlueprint('router', { src: ['core'] }))

scaffolding.plan?.artifacts // every planned file, in group order
scaffolding.stages // one CompileRecord per stage that ran
compiler.destroy()
```

One rule decides the outcome: a `Scaffolding` carries a plan exactly when no question blocks. A
refused blueprint is answered rather than raised, so a caller reads the refusal from the value it
asked for. Each stage records its input and its output, a failed stage records the coded reason
beside them, and the stages after a failed one never run.

A plan says the blueprint can be built. It does not say the blueprint should be created. Every
question beside the plan is advice the compile could not settle, and the caller that chose the shape
is the one that answers it. So `new` refuses on any question, blocking or not, before it writes,
while `audit` and `repair` carry the same questions through, because a target that already has that
shape still has to be described and restored.

A library caller creating a fresh workspace applies `new`'s rule itself:

```ts
import { createBlueprint, createCompiler } from '@orkestrel/scaffold'

const compiler = createCompiler()
const scaffolding = compiler.compile(createBlueprint('router', { src: ['browser', 'server'] }))

scaffolding.plan === undefined || scaffolding.questions.length > 0 // true — do not write this shape
compiler.destroy()
```

`materialize` does not apply that rule for you, and it could not: `compile` returns `questions`
beside `plan`, and the writer receives the plan alone. It refuses what only a writer can see — a
target that is not vacant — and writes the plan it is given otherwise. Choosing a shape is a policy
about which workspace to want, the plan has already answered whether that workspace can be built,
and the questions are where the package says what it thinks of the choice. That is the same line
`createBlueprint` draws when it constructs a blueprint the gate will refuse: one law lives in one
place, and the caller that picked the shape is the one holding it.

Off-contract input is different. A value that is not the exact shape raises `ScaffoldError` coded
`INVALID`, because it is not a question anyone can answer. Both entry points snapshot the caller's
value first and then guard the snapshot, so a property backed by an accessor is refused rather than
read.

Overrides replace a drafted artifact's content whole. The gate checks each override against the
blueprint's full draft before a group selection narrows the returned plan, so an override outside a
selected group does not block that compile. An override that matches no artifact in the full draft,
that targets a host-origin artifact, or that targets the manifest is a blocking question rather
than a silent no-op.

### Groups

A plan selects over seven groups, and a compile that names none covers all of them. The order below
is the order a plan lists its artifacts in.

| Group           | Holds                                                              |
| --------------- | ------------------------------------------------------------------ |
| `manifest`      | `package.json`                                                     |
| `configs`       | The root and per-target build configuration, and the root dotfiles |
| `source`        | The selected environment barrels and entries                       |
| `tests`         | The shared setup modules, the entry tests, and the policy sweep    |
| `guides`        | The guide index and the vendored guide mirrors                     |
| `docs`          | `README.md` and the root instruction documents                     |
| `orchestration` | The harness directories, the bench scripts, and `.mcp.json`        |

## Ownership and drift

Two axes describe every planned file, and they answer different questions. `Origin` says how the
content is produced. `Ownership` says what scaffold claims at the path.

| `Origin`   | Content comes from                          |
| ---------- | ------------------------------------------- |
| `host`     | Byte-copied from the vendored data root     |
| `template` | Filled from a frozen template definition    |
| `computed` | Derived by this package's combination logic |

| `Ownership` | Audit compares | A write does                                      |
| ----------- | -------------- | ------------------------------------------------- |
| `content`   | The bytes      | Restore a missing file, replace a stale one       |
| `presence`  | Existence only | Restore an absent file, never touch present bytes |
| `birth`     | Nothing        | Create the file only while it is absent           |

Birth ownership is what makes a generated workspace the consumer's. `package.json`, the source
barrels, the tests, `README.md`, and `guides/README.md` are written once and are never rewritten by
a later verb.

Content ownership does not preserve an arbitrary custom Vitest project. Fixed optional proofs are
selected by their defining paths, as `guides` is. A workspace that needs other local configuration
must keep those edits outside a content-owned file; `repair` restores that file to the canonical
project set.

An audit reports one `Finding` per planned path, followed by any foreign path beneath the groups
the plan covers. Every planned finding carries its artifact's `ownership`. A foreign finding has
no ownership because no artifact was planned for its path. `Ownership` says what scaffold claims at
a path, not what one run did there. Counting planned findings by `content`, `presence`, and `birth`
therefore says what audit is entitled to compare and stays the same against a vacant target and a
repaired one. What one run compared comes from `ownership`, `drift`, and `observed` together. A
content-owned finding carrying `observed` had its bytes compared. A content-owned `missing` finding
and every presence-owned finding were decided by existence alone. A birth-owned finding was not
examined. The foreign findings are exactly the ones no ownership accounts for. The audit stores no
aggregate tally.

The plan and snapshot are each bounded at `MAX_COLLECTION_ITEMS`. An audit may therefore carry one
finding per planned artifact plus one per unplanned snapshot path, up to `MAX_AUDIT_FINDINGS`.

| `Drift`   | Means                                 |
| --------- | ------------------------------------- |
| `aligned` | The target matches the plan           |
| `stale`   | The target holds different bytes      |
| `missing` | The target holds no file at that path |
| `foreign` | The plan does not own the path at all |

A stale or foreign finding carries the destination's exact bytes in `observed`, and that record is
the precondition the mutation is held to. A write that replaces stale bytes and a deletion that
removes a foreign file each fail when the destination no longer matches what the finding recorded.
The requirement sits in the type rather than in prose, because a deletion that cannot bind to what
the audit showed is the one thing the destructive verb must never do.

The shape a `Finding` admits is wider than the set an audit produces. Which combinations of
`ownership`, `drift`, and `observed` a real comparison reaches is `inferDrift`'s law — birth is
always aligned, presence compares existence only, and bytes are recorded only where they were
read — so the shape admits a birth-owned path reported stale, which no audit produces. That is
deliberate: restating the comparison's case analysis in the type would be a second copy of it, able
to disagree with the one that decides. `isFinding` proves the shape a reader may destructure and
nothing about whether the verdict is one an audit could have reached. `repair` and `remove`
re-derive every verdict themselves and act only on what they derived, so a verdict the comparison
could not have produced is refused by name rather than acted on.

That shape is versioned, and the guard runs at runtime. `repair` and `remove` guard the whole audit
before reading any of it, so an audit persisted or built against an earlier version of this package
is refused with a coded `INVALID` failure rather than accepted and partly understood. A planned
finding carries `ownership`, which findings made before that field existed do not. `remove` acts
only on foreign findings, which never carried ownership, but the guard reads every finding, so one
older planned finding refuses that call too. Take a fresh audit rather than replaying a stored one:
a stored audit records what a target looked like then, and both verbs bind their writes to what a
target holds now. The refusal is deliberate at `0.0.x` and there is no migration path.

## Fleet catalog

`catalog` rewrites one marker-bounded region in `CATALOG_AGENT_PATH` and nothing else in that file.
The region holds a table with four columns:

| Column                 | Content                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `Package`              | The published package name                                                 |
| `Version`              | The registry's `dist-tags.latest`, or the cause when the lookup found none |
| `Layer`                | The publish round the edges place the package in, as `L0`, `L1`, …         |
| `Runtime dependencies` | Each declared runtime edge, as name and range                              |

Both edge-bearing columns come from the same abbreviated packument the version came from, so a
catalog costs one request per package and no more. Only `dependencies` is read. `devDependencies`
reaches no consumer of the published package, so it constrains nothing about publish order, and
reading it would place packages in rounds that do not exist.

The layer is not stored on a row. `catalogToLayers` derives it from the rows' own edges, in the same
call that writes them, so the two cannot disagree:

```ts
import { catalogToLayers } from '@orkestrel/scaffold'

const layers = catalogToLayers(entries)
layers[0] // the names that depend on nothing else in the fleet
```

An edge counts only when it names a package this catalog publishes. An edge leaving the fleet and an
edge to a row that found no version each constrain nothing, so neither holds its dependent back.

The order is load-bearing because these packages are `0.0.x`, where a caret pins one exact release.
A dependent sees a new dependency version only after the dependent re-pins and republishes, so
publishing a dependent before its dependency leaves the dependent pinned to the older release. Two
ranges that disagree install two copies of one package, and the compiler reads those copies as two
distinct types.

A cycle cannot be published in rounds. `catalogToLayers` omits its members rather than placing them
in an order that would be wrong, and their rows carry no layer cell. An absent name is the report:
compare the returned names against the catalog to find one.

## Vendored data root

The vendored data root is the shared file set, staged into the published package as plain data. It
holds the root instruction documents, the licence, the orchestration contract, the four harness
directories, the bench scripts, the shared policy register, the byte-identical root dotfiles, and
the two guide mirrors a generated workspace starts from. `HOST_PATHS` is the candidate list; a plan
carries the subset its target selects, because a workspace never mirrors its own guide.

`stageHost` fills the root from a real checkout at build time:

```ts
import { stageHost } from '@orkestrel/scaffold/server'

stageHost(process.cwd(), 'dist/host') // one ManifestEntry per file staged
```

Each vendored path is copied to a storage name, and every dot that opens a segment comes off,
because npm's own ignore rules would drop a leading-dot entry from the tarball. A dotted file at the
root moves under `dotfiles/` so it cannot collide with an undotted sibling. `manifest.json` is
written last and declares the whole membership: one entry per file, the sorted directory inventory,
and a SHA-256 digest over both. The digest is what detects a membership edit that did not update
it, and the directory inventory is what makes a declared empty directory survive a file walk.

A missing vendored path is refused rather than staged around, and the refusal names every missing
path at once. That is why `guides/scaffold.md` — this file — must exist before `npm run build`
completes.

The `Materializer` reads the root once, at construction, and cross-checks the manifest against the
files actually stored. It defaults to the root inside the installed package, resolved from the
module's own location rather than from the caller's working directory. `--from` points it somewhere
else. A root carrying no manifest at all is read as a raw checkout, and artifact paths map onto it
one to one.

## Generated workspace

A workspace's file set is a function of its two axes plus its structural facts. Nothing is fixed
except the manifest.

- One computed artifact: `package.json`, with the entry points, `exports` map, scripts, and
  development dependencies its selection implies.
- One template artifact per configuration file the selection needs: the root `tsconfig.json` and
  `vite.config.ts`, plus a Vite config and a scoped TypeScript config per selected environment, and
  two more when `bin` is set.
- One template artifact per source and test file the selection needs: an `index.ts` barrel per
  selected environment, `main.ts` and `index.html` for an application browser, `tests/setup.ts`
  plus the host setup modules the selection reaches, and one entry test per axis project.
- One template artifact each for `README.md` and `guides/README.md`.
- One host artifact per vendored path the workspace selects. A vendored directory is one planned
  path that expands into the files the data root stores beneath it.

`planToSummary` reports the tally rather than a number written down here:

```ts
import { createBlueprint, createCompiler, planToSummary } from '@orkestrel/scaffold'

const compiler = createCompiler()
const scaffolding = compiler.compile(createBlueprint('router', { src: ['core', 'server'] }))
const summary = scaffolding.plan === undefined ? undefined : planToSummary(scaffolding.plan)

summary?.host // vendored artifacts
summary?.template // filled artifacts
summary?.computed // the manifest
compiler.destroy()
```

## Library

The two entry points split by host. `@orkestrel/scaffold` is host-independent: it compiles, gates,
and compares, and it touches neither the filesystem nor the network.
`@orkestrel/scaffold/server` is Node-only and holds everything that does.

Compare a plan against bytes a caller already read:

```ts
import type { Blueprint, Snapshot } from '@orkestrel/scaffold'
import { createCompiler } from '@orkestrel/scaffold'

declare const blueprint: Blueprint
declare const current: Snapshot

const compiler = createCompiler()
const audit = compiler.audit(blueprint, current)

audit.findings.filter(({ drift }) => drift !== 'aligned')
compiler.destroy()
```

Write a compiled plan into a real directory:

```ts
import type { Plan } from '@orkestrel/scaffold'
import { createMaterializer } from '@orkestrel/scaffold/server'

declare const plan: Plan

const materializer = createMaterializer({ host: './dist/host' })
const result = materializer.materialize(plan, './packages/router')

result.written // every path created
materializer.destroy()
```

`resolveContainedPath` refuses a lexical escape, a physical link out of the root, and a dangling
link whose raw target contains a `..` segment. It returns the lexical join of `root` and `path` — an
absolute path under `root`, which is what its shipped example prints — after checking the namespace,
not an open filesystem handle. Its contract therefore excludes a concurrent rename or link swap
during the check or before the caller finishes using that path. A caller that admits hostile
concurrent namespace mutation needs a handle-bound operation instead.

`resolveRealPath` answers the caller's own text collapsed lexically, then resolved through every link
in what survives that collapse. A `..` the caller wrote cancels the segment before it as text, so
`<root>/hop/..` answers `<root>` even where `hop` links elsewhere, rather than the directory holding
what `hop` points at. The collapse only ever shortens the path, so nothing reaches outside it this
way; the answer is a lexical location resolved through links, not a physical one.

Read the registry and the guide host:

```ts
import { createUpstream } from '@orkestrel/scaffold/server'

const upstream = createUpstream({ registry: { timeout: 5_000 } })
const releases = await upstream.lookup([{ name: '@orkestrel/emitter', range: '^0.0.5' }])

releases.filter((release) => release.lookup === 'found')
upstream.destroy()
```

Every request is unauthenticated, follows no redirect, and is bounded twice: `limit` refuses one
oversized answer and `budget` refuses many small ones. A per-package failure is collected as a
verdict carrying its cause rather than thrown, so one unreachable package never costs the caller the
rest of the answer. The organization package list is the exception, because without it there is no
fleet to report.

Both bounds count decoded bytes, and a version lookup asks the registry for the abbreviated
packument — `dist-tags` and a trimmed version map, rather than the full per-version metadata no
verdict reads. That is the smallest form the registry publishes, and `limit` is capped at
`MAX_ARTIFACT_BYTES`, so a package with enough published releases to pass it cannot be looked up at
all. It comes back as a `failed` verdict naming the limit, which is this reader's bound and not a
statement about the package.

A status that carries no representation — a `204` or a `205` — is a `failed` verdict naming the
status, never a `found` answer holding no bytes. A genuinely empty file arrives as a `200` and does
read as found.

Stage and swap a set of files yourself:

```ts
import { WriteTransaction } from '@orkestrel/scaffold/server'

const transaction = new WriteTransaction('./packages/router', ['AGENTS.md'])
try {
	transaction.write('AGENTS.md', '# Agents\n')
	transaction.commit() // ['AGENTS.md']
} finally {
	transaction.discard()
}
```

A transaction owns a private root beside the target on the same volume, so every promotion is a
rename rather than a copy. A failure part way through commit restores every destination it already
promoted and removes every directory it created. No destination ever receives half-written bytes.
It is not a journal: a process killed between two promotions leaves a mixed target.
The transaction binds each directory's location rather than its lifetime, so an ancestor swapped
for another path, a file, a symlink, or nothing is refused, and one deleted and recreated in place
may not be.

Narrow a refusal by its code:

```ts
import { isScaffoldError, ScaffoldError } from '@orkestrel/scaffold'

try {
	throw new ScaffoldError('TARGET', 'The target carries no readable manifest.')
} catch (error) {
	if (isScaffoldError(error)) error.code // 'TARGET'
}
```

`INVALID` is off-contract input, `BLOCKED` is a refused blueprint, `TARGET` is a destination that is
not what the caller's observation said it was, `WRITE` is a mutation that could not be completed, and
`FETCH` is an upstream read that produced no answer.

`BLOCKED` covers both refusals a blueprint can meet, because they are one fact — this blueprint will
not be built — and the questions say which. The compiler answers its refusal rather than throwing it:
the gate fails closed and records `BLOCKED` on its stage, so a caller reads that refusal from the
value it asked for. A verb that creates a workspace throws it, because it chose the shape and has
nothing to hand back. A blocking question closed the gate; a non-blocking one is a shape the package
can describe and declines to create.

Every entity publishes an emitter. The compiler emits `compile`, `audit`, `block`, `error`, and
`destroy`; the materializer emits `write`, `remove`, `finish`, `error`, and `destroy`; the upstream
reader emits `release`, `mirror`, `error`, and `destroy`. Errors are emitted immediately before they
are thrown, so an observer sees a refusal even where the caller catches it.

## Limits

Six things a reader will look for and not find.

**A code fence in this guide is unverified.** [`tests/guides.test.ts`](../tests/guides.test.ts)
proves that every fence imports only real exports of the two barrels, and that every backticked name
in this file resolves to one. It neither runs a fence nor typechecks one, so a trailing `// value`
comment inside a fence states what this guide claims rather than what the build answered. The
verdicts that are measured are the ones a consumer hovers:
[`tests/integration.test.ts`](../tests/integration.test.ts) drives every `@example` the built
declarations print against the installed package, scores each verdict it can read as a value, and
names exactly the ones it cannot. Fences are not added to that instrument, because most of them
cannot be run: several declare an ambient value that has no runtime, and several write to a
directory or read the network, so executing them would be a mutation rather than a check.

**The library does not enforce the creating verb's policy.** `new` refuses a blueprint carrying any
question, and `materialize` writes any plan into any vacant target. A workspace of several published
`src` environments without `core` is therefore constructible, compilable, and writable through the
library, and its manifest names a `core` build the workspace never runs — which is exactly what the
advisory said. The refusal lives in the verb that chose the shape because that verb is the only one
holding the advice: `compile` returns `questions` beside `plan`, and `materialize` receives the plan
alone, so it has nothing to refuse on. The Compile section states the rule a library caller applies
in its place.

**`isPath` does not prove host portability.** It proves bounded target-relative syntax and rejects
traversal, separators, controls, and reserved syntax characters. It deliberately admits host-specific
segment spellings such as a Windows device name, a trailing dot or space, and a segment beyond a
filesystem's byte ceiling. The compiler emits none of those names. A caller-supplied plan may carry
one, and the writer reports the host's refusal rather than treating logical path syntax as a promise
that every filesystem can create it. `isFilesystemPath` is the separate server guard for target and
vendored-root locations on the host. Both `/` and `\` are separators to every reading in this
package, on every host, including the server's reading of a raw symbolic-link target. A POSIX
filename that legally contains a backslash — `weird\..\name` — is therefore refused as three
segments rather than admitted as one name. That is one separator law with a conservative side, not a
host-dependent second one.

**Scaffold emits no styles axis.** `SRC_MATRIX` is exactly `core`, `browser`, and `server`, and
`Blueprint` carries no styles field. A workspace that needs `src/styles/` adds the directory, its
configuration, and its Vitest project by hand. `.claude/rules/workspace.md` describes styles as an
environment because the fleet has one; scaffold simply does not generate it.

**No host path is normalized before it is guarded.** `isFilesystemPath` refuses an empty segment, so
`packages//router` is off contract. A trailing separator does not produce one: it terminates a
directory rather than opening a segment, and every Node path API reads `./packages/router/` and
`./packages/router` as one location, so both are admitted. Every server entry point and the
`--target` option guard the text they were handed and resolve it afterwards, so a directory taken
from a shell completion arrives carrying the separator the shell appended and names the directory it
appears to name.

**A generated workspace has empty barrels and no starter entity.** Every emitted `index.ts` exports
nothing. This is deliberate: a generated sample entity is repeatedly mistaken for real
implementation. What a consumer does first is write the module's `types.ts`, then the
implementation that conforms to it, then export both from the barrel — the order `AGENTS.md` fixes.

## Tests

- [`tests/src/core/Compiler.test.ts`](../tests/src/core/Compiler.test.ts) — the three stages, the
  fail-closed rule, off-contract input, and teardown.
- [`tests/src/core/compilers.test.ts`](../tests/src/core/compilers.test.ts) — every projection from
  a blueprint to an artifact, and every gate law.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — the pure leaves, their
  determinism, and their input independence.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — every guard against
  the adversarial matrix.
- [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts) — parse and guard soundness
  in both directions.
- [`tests/src/core/cloners.test.ts`](../tests/src/core/cloners.test.ts) — ownership of a snapshot
  taken from a hostile value.
- [`tests/src/core/templates.test.ts`](../tests/src/core/templates.test.ts) — the frozen template
  definitions.
- [`tests/src/core/constants.test.ts`](../tests/src/core/constants.test.ts) — the scaffold pin every
  generated workspace inherits, held to the version this manifest declares.
- [`tests/src/server/Materializer.test.ts`](../tests/src/server/Materializer.test.ts) — every
  mutation verb against a real temporary target and a real vendored root.
- [`tests/src/server/WriteTransaction.test.ts`](../tests/src/server/WriteTransaction.test.ts) —
  staging, promotion, and rollback after a driven failure.
- [`tests/src/server/Upstream.test.ts`](../tests/src/server/Upstream.test.ts) — the bounds, the
  verdicts, and cancellation, against a protocol-faithful loopback server.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — path containment,
  digests, inventories, and the staging producer.
- [`tests/src/server/validators.test.ts`](../tests/src/server/validators.test.ts) — the host-path
  law and every server guard's boundary values.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — the two server
  factories.
- [`tests/src/bin/CLI.test.ts`](../tests/src/bin/CLI.test.ts) — every verb driven in process
  through recording output handlers.
- [`tests/src/bin/helpers.test.ts`](../tests/src/bin/helpers.test.ts) — command-line reading, usage
  rendering, and the failure envelope.
- [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts) — the process entry point.
- [`tests/policy.test.ts`](../tests/policy.test.ts) — the syntactic coding and placement law over
  every source file.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — this guide's bijection with the two barrels.

## See also

- [`guides/README.md`](README.md) — the concept and directory index.
- [`README.md`](../README.md) — the package front page.
- [`AGENTS.md`](../AGENTS.md) — the coding contract every generated workspace inherits.
