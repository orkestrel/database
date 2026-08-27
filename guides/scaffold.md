# Scaffold

> Scaffold compiles a workspace specification into an ordered list of files, compares that list to a
> real directory, and writes the difference. It ships one executable, `scaffold`, and library
> entry points: `@orkestrel/scaffold` is the pure compiler and its data contracts, and
> `@orkestrel/scaffold/server` is the filesystem writer and the network reader. Source:
> [`src/core/index.ts`](../src/core/index.ts) and [`src/server/index.ts`](../src/server/index.ts).

The package exists because every `@orkestrel` repository shares the same toolchain, the same agent
instructions, and the same root dotfiles. Keeping every copy of those files in agreement by hand
does not work. Scaffold makes the shared set data — a vendored data root shipped inside the package
— and gives it verbs: create a workspace from it, report how a workspace differs from it, and
write the difference back.

That root stages the vendored set and the instruction canon, and a target meets them differently.
`HOST_PATHS` names the vendored set — the toolchain, the policy proofs, the bench scripts, and the
harness permission file — and every target carries its own copy, which the verbs write and compare.
`CANON_PATHS` names the instruction canon — the coding and orchestration contracts, the rules, the
skills, the templates, the transport contracts, the agent roles, the bench configuration, and the
MCP registrations — which stays in one place and is published for reading. A target carries the
`AGENTS.md` and `CLAUDE.md` pointers that name where a reader finds it, and the catalog agent file
the `catalog` verb rewrites. It carries nothing else at a canon path: a file found at one is a
superseded copy, and `overwrite` deletes it. Vendored data root states how each set is staged and
how a pointer resolves.

Every following code fence is illustrative. [`tests/guides.test.ts`](../tests/guides.test.ts)
keeps the command reference aligned with the executable and transcribes the pure blueprint-default,
compile-refusal, and error-narrowing fences. A trailing comment in another fence is this guide's
claim rather than a measured answer; the driven examples are the ones the shipped declarations
print. Limits states what that leaves unproven and what covers it instead.

```sh
npm install --save-dev @orkestrel/scaffold
```

The executable needs Node 22.12 or later. Run it through `npx` without installing:

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
| `CompileStage`      | type | The compile phases, in the order they run.                                                       |
| `CompilerEventMap`  | type | The compiler's observation channel.                                                              |
| `HostFile`          | type | One vendored file read from the repository, beside the target bytes it answers for.              |
| `Drift`             | type | How one target path compares to the artifact planned for it.                                     |
| `Environment`       | type | One environment a generated workspace selects on its `src` or `app` axis.                        |
| `Finding`           | type | One drift verdict against a target path.                                                         |
| `Group`             | type | The artifact group a plan selects over.                                                          |
| `Lookup`            | type | How an upstream lookup resolved: found, missing, unmatched, or failed.                           |
| `Mirror`            | type | One dependency guide fetched from upstream, beside the local mirror it answers for.              |
| `Origin`            | type | How an artifact's content is produced.                                                           |
| `Ownership`         | type | What scaffold claims at an artifact's path.                                                      |
| `Release`           | type | One declared dependency range measured against a registry release.                               |
| `ScaffoldErrorCode` | type | The coded reasons a scaffold error is raised.                                                    |
| `Snapshot`          | type | Exact lowercase hexadecimal target bytes keyed by artifact-relative path.                        |

#### Interfaces

| Name                    | Kind      | Summary                                                                                 |
| ----------------------- | --------- | --------------------------------------------------------------------------------------- |
| `AppDefinition`         | interface | The configuration and runtime-entry settings one private `app` environment contributes. |
| `ArtifactBase`          | interface | The fields every planned file carries.                                                  |
| `Audit`                 | interface | The whole comparison of a plan against a target's current content.                      |
| `Blueprint`             | interface | The closed, JSON-serializable workspace specification.                                  |
| `CompileFailure`        | interface | The coded reason one compile stage failed.                                              |
| `CompileRecord`         | interface | The input and output snapshot of one compile stage.                                     |
| `CompilerInterface`     | interface | The compilation contract: pure, synchronous, and host-independent.                      |
| `CompilerOptions`       | interface | Options for the compiler.                                                               |
| `ContentArtifact`       | interface | A text file produced by the template or computed compilation path.                      |
| `Dependency`            | interface | One runtime `@orkestrel/*` dependency of a generated workspace.                         |
| `DependencyPinSet`      | interface | The runtime and development dependency sections a range writer may change.              |
| `HostArtifact`          | interface | A file byte-copied from the vendored data root, planned before its bytes are read.      |
| `HydratedArtifact`      | interface | A vendored file whose exact bytes have been read, so its content can be compared.       |
| `ManifestDependencySet` | interface | The runtime, development, and peer declarations read from an existing manifest.         |
| `ManifestRegionSet`     | interface | The manifest regions a writing operation may change.                                    |
| `ManifestScript`        | interface | One manifest script a region-writing operation may replace.                             |
| `Override`              | interface | One artifact override.                                                                  |
| `Plan`                  | interface | The compiled, ordered artifact list and the selection it covers.                        |
| `PlanSummary`           | interface | The tally of one plan by artifact origin.                                               |
| `Question`              | interface | One validation issue raised against a blueprint or a plan.                              |
| `Scaffolding`           | interface | The replayable outcome of one compile.                                                  |
| `SrcDefinition`         | interface | The build and export settings one published `src` environment contributes.              |
| `ViteMachinery`         | interface | Which host-specific pipelines a generated root Vite configuration carries.              |

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
| `CANON_PATHS`                     | const | The instruction-canon paths staged for reading rather than for a target, frozen.                 |
| `CATALOG_AGENT_PATH`              | const | The agent file whose marker-bounded package table the catalog verb alone owns.                   |
| `CONFIG_TEMPLATES`                | const | Formatter-stable template text for every configuration artifact.                                 |
| `CONFORMANCE_TEST_PATH`           | const | The official-tooling drift proof whose presence makes a workspace `conformance`.                 |
| `CONTROL_CHARACTER_PATTERN`       | const | Unicode controls, formatting controls, and line and paragraph separators rejected in text.       |
| `DECLARATION_DEV_DEPENDENCIES`    | const | The development dependencies that emit declarations for published source or an executable.       |
| `DEFAULT_ENGINES`                 | const | The `engines.node` range a workspace starts with.                                                |
| `DEFAULT_VERSION`                 | const | The version a workspace starts at.                                                               |
| `DEPENDENCY_NAME_PATTERN`         | const | The runtime dependency name syntax: the `@orkestrel` scope and a bare name.                      |
| `DISTRIBUTION_TEST_PATH`          | const | The generated packed-package proof every publishing workspace is planned at.                     |
| `ENGINES_PATTERN`                 | const | The minimum-Node engine syntax a blueprint declares.                                             |
| `ENVIRONMENTS`                    | const | The `Environment` values, frozen.                                                                |
| `EXECUTABLE_PATHS`                | const | The vendored paths a target receives with its executable bit set, frozen.                        |
| `EXTRA_RANGE_PATTERN`             | const | The registry-only semver subset accepted for a development extra's range.                        |
| `FLOOR_RANGE_PATTERN`             | const | The exact `major.minor.patch` floor accepted for a foreign peer's range.                         |
| `FOREIGN_NAME_PATTERN`            | const | The package name syntax for a dependency this package does not publish.                          |
| `GLOBAL_SETUP_PATH`               | const | The shared Vitest global-setup module whose presence makes a workspace `global`.                 |
| `GROUPS`                          | const | The `Group` values in plan order, frozen.                                                        |
| `GUIDES_TEST_PATH`                | const | The guide-parity proof whose presence selects the planned `guides` project.                      |
| `HEX_PATTERN`                     | const | Exact lowercase hexadecimal bytes: two digits per byte, and empty content is valid.              |
| `HOST_PATHS`                      | const | The paths a target receives from the vendored data root, frozen.                                 |
| `HOST_INVENTORY_PATH`             | const | The repository-relative path where the committed vendored-file inventory is served.              |
| `INTEGRATION_TEST_PATH`           | const | The cross-environment composition proof whose presence makes a workspace `integration`.          |
| `INVALID_PATH_CHARACTER_PATTERN`  | const | Visible characters a target-relative path and a Markdown path cell both forbid.                  |
| `MANIFEST_PATH`                   | const | The manifest path every compiler plan emits with birth ownership.                                |
| `MAX_ARTIFACT_BYTES`              | const | Maximum bytes accepted for one artifact.                                                         |
| `MAX_ARTIFACT_HEX_LENGTH`         | const | Maximum length of the hexadecimal string carrying one artifact's bytes.                          |
| `MAX_AUDIT_FINDINGS`              | const | Maximum findings one audit can produce from a bounded plan and snapshot.                         |
| `MAX_COLLECTION_ITEMS`            | const | Maximum items accepted in one public collection.                                                 |
| `MAX_DEPENDENCY_NAME_LENGTH`      | const | Maximum dependency package name length, scope included, as the registry caps it.                 |
| `MAX_MANIFEST_BYTES`              | const | Maximum bytes accepted for one package or vendored-host manifest.                                |
| `MAX_NAME_LENGTH`                 | const | Maximum bare workspace name length.                                                              |
| `MAX_PATH_LENGTH`                 | const | Maximum length of one path, matching the longest a supported filesystem accepts.                 |
| `MAX_RANGE_LENGTH`                | const | Maximum length of one declared package range.                                                    |
| `MAX_REGISTRY_BYTES`              | const | Maximum decoded bytes accepted from one registry response.                                       |
| `MAX_SCRIPT_LENGTH`               | const | Maximum length of one manifest script name or command.                                           |
| `MAX_TOTAL_ARTIFACT_BYTES`        | const | Maximum bytes retained across one whole plan or audit.                                           |
| `MAX_TOTAL_REGISTRY_BYTES`        | const | Maximum decoded bytes accepted across one registry-reading call.                                 |
| `MINIMUM_NODE_VERSION`            | const | The oldest Node version the generated toolchain supports.                                        |
| `NAME_PATTERN`                    | const | The bare workspace name syntax: lowercase alphanumeric with hyphens, letter first.               |
| `ORCHESTRATION_PATH_NAMES`        | const | The exact root filenames that wire an agent bench rather than the toolchain, frozen.             |
| `ORCHESTRATION_PATH_PREFIXES`     | const | The path prefixes whose contents instruct or wire an agent, frozen.                              |
| `ORKESTREL_RANGE_PATTERN`         | const | The exact caret-pinned pre-1.0 range accepted for an `@orkestrel/*` runtime dependency.          |
| `PRINT_WIDTH`                     | const | Columns one emitted line may occupy, matching `printWidth` in `.oxfmtrc.json`.                   |
| `RELEASE_PROOF_COMMAND`           | const | The `prepublishOnly` row that runs the packed-package proof against a real registry.             |
| `SERVICE_SCRIPT_PATH`             | const | The provisioner skeleton a workspace with declared service vendors is given once.                |
| `SERVICE_SETUP_PATH`              | const | The live-service readiness module whose presence makes a workspace `service`.                    |
| `SERVICE_TEST_INCLUDE`            | const | The include the live-service project covers, which is a directory rather than one proof.         |
| `SHOWCASE_CONFIG_PATH`            | const | The Vite wrapper whose presence makes a workspace `showcase`.                                    |
| `SHOWCASE_DEV_DEPENDENCIES`       | const | The development dependency used only by the optional single-file showcase build.                 |
| `SOURCE_BROWSER_DEV_DEPENDENCIES` | const | The development dependencies a published browser `src` environment adds.                         |
| `SRC_MATRIX`                      | const | The build and export settings each published `src` environment contributes, frozen.              |
| `TAB_WIDTH`                       | const | Columns one tab occupies when the formatter measures a line, matching `tabWidth`.                |
| `VERSION_PATTERN`                 | const | The exact `major.minor.patch` version syntax a blueprint declares.                               |
| `WORKSPACE_OWNED_PATHS`           | const | The vendored paths whose present bytes belong to each workspace, frozen.                         |

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
| `isDependency`      | const    | Narrow a value to a `Dependency`.                                                |
| `isDependencyName`  | const    | Narrow a value to the scoped package name a runtime dependency carries.          |
| `isEnvironment`     | const    | Narrow a value to one `Environment` a workspace may select.                      |
| `isFinding`         | const    | Narrow a value to a `Finding`.                                                   |
| `isGroup`           | const    | Narrow a value to one `Group` a plan selects over.                               |
| `isGroups`          | const    | Narrow a value to a bounded group selection.                                     |
| `isHex`             | const    | Narrow a value to exact lowercase hexadecimal bytes within one artifact's limit. |
| `isManifestScript`  | const    | Narrow a value to a `ManifestScript`.                                            |
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
| `extractRangeMajor`         | function | Extract the major component of an admitted dependency range.                  |
| `extractVersion`            | function | Extract the major, minor, and patch components of an exact version.           |
| `inferDrift`                | function | Infer how one target path compares to the artifact planned for it.            |
| `inferGroup`                | function | Infer the `Group` a path belongs to.                                          |
| `isCanonPath`               | function | Test whether a path belongs to the instruction canon a target reads.          |
| `isDeferredPath`            | function | Test whether another surface owns the vendored bytes at a path.               |
| `manifestToDependencies`    | function | Project a manifest's `@orkestrel/*` declarations into separate section lists. |
| `manifestToName`            | function | Project a package manifest's text to its own name.                            |
| `matchesDriftReachability`  | function | Test whether `inferDrift` could have produced a finding for an ownership.     |
| `matchesEngines`            | function | Test whether a declared engines floor is at or above the supported minimum.   |
| `matchesOrchestrationPath`  | function | Test whether a path instructs or wires an agent rather than the toolchain.    |
| `matchesPrintWidth`         | function | Test whether one emitted line fits the vendored formatter width.              |
| `matchesRange`              | function | Test whether a declared range already admits a published version.             |
| `nameToGuide`               | function | Derive the guide mirror path a package name answers for.                      |
| `nameToRewrite`             | function | Derive the declaration rewrite a published face's `beforeWriteFile` applies.  |
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
| `blueprintToWritableScripts`        | function | Project a blueprint into the manifest scripts a region write may replace.       |
| `dependenciesToQuestions`           | function | Measure one declared package list against the name and range syntax it accepts. |
| `nameToHostArtifacts`               | function | Compile the vendored host artifacts a named workspace plans.                    |
| `overridesToQuestions`              | function | Measure a blueprint's overrides against the artifacts drafted for it.           |
| `pathToCondition`                   | function | Build one `exports` condition block for a built environment.                    |
| `planToFindings`                    | function | Compare a plan against a target's current content.                              |
| `planToHash`                        | function | Compute a plan's content identity.                                              |
| `replaceManifestRanges`             | function | Replace runtime and development ranges without reading or writing peer fields.  |
| `replaceManifestScripts`            | function | Replace named script values, refusing a value the region does not accept.       |
| `replacePlanRanges`                 | function | Replace writable ranges in a plan's manifest and recompute its identity.        |
| `srcToEntry`                        | function | Project a published selection into the manifest's entry fields.                 |
| `srcToExports`                      | function | Project a published selection into the manifest's `exports` map.                |
| `srcToRoot`                         | function | Select the single published environment a package root points at.               |

#### Factories

| Name              | Kind     | Summary                                                                           |
| ----------------- | -------- | --------------------------------------------------------------------------------- |
| `createBlueprint` | function | Construct a `Blueprint` from a name and the fields that differ from the defaults. |

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
| `Host`                  | interface | A whole vendored host supplied as a value rather than read from a directory.         |
| `HostManifest`          | interface | The complete vendored-host inventory.                                                |
| `ManifestEntry`         | interface | One file record of the vendored host's manifest, including its exact-byte digest.    |
| `MaterializeResult`     | interface | The outcome of one mutation of a target.                                             |
| `MaterializerInterface` | interface | The mutation contract: the package's only filesystem writer.                         |
| `MaterializerOptions`   | interface | Options for the materializer.                                                        |
| `Worktree`              | interface | What git reports about a target's working tree.                                      |
| `UpstreamInterface`     | interface | The upstream contract: the package's only network reader, and it never writes.       |
| `UpstreamOptions`       | interface | Options for the upstream reader.                                                     |
| `WriteAnchor`           | interface | One physical directory identity captured across a write transaction.                 |
| `WriteDirectoryResult`  | interface | The final directory anchor of a write transaction and the subset one call created.   |
| `WriteExpectation`      | interface | One destination snapshot captured before a write and required to survive it.         |
| `WritePrecondition`     | interface | The narrower caller-observed destination state a write transaction must still match. |

#### Constants

| Name                                | Kind  | Summary                                                                                  |
| ----------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `BRANCH_PATTERN`                    | const | The Git branch syntax the repository endpoint accepts.                                   |
| `DIGEST_PATTERN`                    | const | The exact SHA-256 syntax a digest is stated in: sixty-four lowercase hexadecimal digits. |
| `DRIVE_PATTERN`                     | const | The drive prefix a Windows host path may open with.                                      |
| `INVALID_SEGMENT_CHARACTER_PATTERN` | const | Visible characters no host path segment may carry.                                       |
| `MANIFEST_NAME`                     | const | The reserved metadata name a staged vendored host writes at its own root.                |
| `MAX_BRANCH_LENGTH`                 | const | Maximum characters one repository branch may carry.                                      |
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
| `isBranch`              | const    | Narrow a value to a Git branch the repository endpoint accepts.                    |
| `isCatalogEntries`      | const    | Narrow a value to a bounded list of fleet catalog rows.                            |
| `isDependencies`        | const    | Narrow a value to a bounded list of declared runtime dependencies.                 |
| `isDependencyNames`     | const    | Narrow a value to a bounded list of `@orkestrel` package names.                    |
| `isDigest`              | const    | Narrow a value to one exact SHA-256 digest.                                        |
| `isEndpoint`            | const    | Narrow a value to a bounded upstream endpoint.                                     |
| `isFilesystemPath`      | function | Narrow a value to a path naming a location on this host.                           |
| `isHost`                | const    | Narrow a value to one whole vendored host supplied as a value.                     |
| `isHostManifest`        | const    | Narrow a value to one `HostManifest`.                                              |
| `isInventory`           | function | Narrow a value to a working-tree inventory within the limit one target may report. |
| `isManifestEntry`       | const    | Narrow a value to one `ManifestEntry`.                                             |
| `isManifestRegionSet`   | const    | Narrow a value to one `ManifestRegionSet`.                                         |
| `isMaterializerHooks`   | const    | Narrow a value to the materializer's initial listener record.                      |
| `isMaterializerOptions` | const    | Narrow a value to `MaterializerOptions`.                                           |
| `isMirrors`             | const    | Narrow a value to a bounded list of fetched guide mirrors.                         |
| `isPaths`               | const    | Narrow a value to a bounded list of target-relative paths.                         |
| `isWorktree`            | const    | Narrow a value to a `Worktree`.                                                    |
| `isTimeout`             | const    | Narrow a value to a per-request timeout in milliseconds.                           |
| `isUpstreamHooks`       | const    | Narrow a value to the upstream reader's initial listener record.                   |
| `isUpstreamOptions`     | const    | Narrow a value to `UpstreamOptions`.                                               |

#### Helpers

| Name                      | Kind     | Summary                                                                               |
| ------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `computeDigest`           | function | Compute the SHA-256 digest of text.                                                   |
| `computeFileDigest`       | function | Compute the SHA-256 digest of one file's exact bytes.                                 |
| `computeManifestDigest`   | function | Compute the digest of a vendored host's declared membership.                          |
| `filesToHost`             | function | Overlay host-owned live files onto the installed vendored floor.                      |
| `hexToDigest`             | function | Project exact bytes stated in hexadecimal to their SHA-256 digest.                    |
| `isExactCaseFile`         | function | Test whether a physical file's path matches every on-disk segment exactly.            |
| `isPhysicalDirectory`     | function | Test whether a path is a physical directory this package will read or write into.     |
| `isPhysicalFile`          | function | Test whether a path is a physical file this package will read or replace.             |
| `isVacant`                | function | Test whether a target is safe to write a fresh workspace into.                        |
| `listCanonPaths`          | function | Lists the canon paths a target holds, filtered to a plan's groups.                    |
| `listDirectories`         | function | List a directory's descendant directories as sorted root-relative paths.              |
| `listFiles`               | function | List a directory's files as sorted root-relative paths.                               |
| `matchesAnchor`           | function | Test whether a captured directory is still the same directory.                        |
| `matchesExecutablePath`   | function | Test whether a vendored path is one a target receives executable.                     |
| `matchesExpectation`      | function | Test whether a destination still holds what was captured of it.                       |
| `matchesGitPath`          | function | Test whether a path addresses a target's own repository metadata.                     |
| `matchesMissingPath`      | function | Test whether a caught filesystem error reports an absent path.                        |
| `matchesPrecondition`     | function | Test whether a destination still matches the narrower state a caller observed.        |
| `matchesProtectedPath`    | function | Test whether a target-relative path is one no verb may delete.                        |
| `matchesSensitivePath`    | function | Test whether a path names local configuration or a credential.                        |
| `pathToStorage`           | function | Project a target-relative path to the storage name a vendored host holds it under.    |
| `pruneEmptiedDirectories` | function | Removes every directory one set of deletions emptied.                                 |
| `readAnchor`              | function | Capture one directory's physical identity.                                            |
| `readExpectation`         | function | Capture what one destination holds before a write.                                    |
| `readFileHex`             | function | Read one contained file as its exact bytes in lowercase hexadecimal.                  |
| `readFileText`            | function | Read one contained file as bounded UTF-8 text.                                        |
| `readHostFloor`           | function | Read the installed vendored host floor as a verified value.                           |
| `readHostManifest`        | function | Read a vendored host's manifest, when it carries one.                                 |
| `readManifestEntry`       | function | Derive one vendored-host manifest entry from a file in a checkout.                    |
| `readSnapshot`            | function | Read a target's current bytes at the paths a plan claims.                             |
| `resolveContainedPath`    | function | Resolve a root-relative path and refuse one that leaves its root.                     |
| `resolveRealPath`         | function | Resolve a path through the real filesystem, keeping the part that does not exist yet. |
| `stageBytes`              | function | Stage the named destinations of a value host into a private root.                     |
| `stageHost`               | function | Stage a vendored host root from a real checkout.                                      |
| `stageInventory`          | function | Stage the committed vendored-file inventory from a real checkout.                     |

#### Classes

| Name               | Kind  | Summary                                                                            |
| ------------------ | ----- | ---------------------------------------------------------------------------------- |
| `Materializer`     | class | The mutation spine: read the vendored host, re-derive the target, stage, swap.     |
| `Upstream`         | class | The reading spine: one bounded, unauthenticated, redirect-free request per answer. |
| `WriteTransaction` | class | One staged, reversible mutation of one target directory.                           |

## Methods

`Compiler` implements `CompilerInterface`, `Materializer` implements `MaterializerInterface`, and
`Upstream` implements `UpstreamInterface`. Each class exposes exactly its interface's members and
nothing more, so the following interface tables describe the classes too. `WriteTransaction`
publishes no interface and is documented directly.

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
| `declare`     | Rewrite the manifest regions the caller names: the ranges and the scripts.       |
| `remove`      | Re-derive and delete the tracked files the plan does not own.                    |
| `destroy`     | Tear the materializer down. Every later call throws, and teardown is idempotent. |

#### `UpstreamInterface`

| Method    | Summary                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `lookup`  | Look up the newest release each declared range admits.                                     |
| `fetch`   | Fetch each named package's guide, beside the local mirror it answers for.                  |
| `read`    | Read each named vendored file from the repository, beside the target bytes it answers for. |
| `catalog` | Catalog the published fleet from the registry's organization package list.                 |
| `destroy` | Tear the reader down, aborting every request in flight.                                    |

#### `WriteTransaction`

| Method      | Summary                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| `write`     | Stage one text file.                                                               |
| `copy`      | Stage one byte-for-byte copy in executable or non-executable destination mode.     |
| `establish` | Establish one directory inside the target, one segment at a time.                  |
| `remove`    | Mark one file for deletion at commit.                                              |
| `commit`    | Promote every staged file and take every marked file, or roll the whole call back. |
| `discard`   | Abandon the transaction and remove everything it created.                          |

## Command line

Authority is the verb's: every verb except `audit` writes when it is typed, and no
option grants a write.

| Verb        | Writes                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------ |
| `new`       | A whole workspace, into a target that holds nothing the plan would collide with            |
| `audit`     | Nothing                                                                                    |
| `repair`    | Each planned path the target is missing or has let drift, and the range and script regions |
| `catalog`   | The package table, the guide mirrors, and the range region                                 |
| `overwrite` | Everything `repair` and `catalog` write, plus deletions                                    |

### Baselines

Every remote surface reads its live source first and falls back, whole, to the copy the installed
package distributes; each operation reports one baseline word per surface. A surface can select
`floor` only where the package distributes a copy. The registry's organization membership ships
nowhere, so `catalog` refuses when that read fails.

For `new`, `repair`, `catalog`, and `overwrite`, authoritative absence on a version surface never
selects `floor`. A registry `404` or a packument with no admitted version stays a `FETCH` refusal,
because writing a version the registry says is absent produces an uninstallable manifest. `audit`
turns release absence into questions and returns its audit result. Transport faults, timeouts, rate
refusals, byte-bound refusals, and integrity refusals can select the floor.

The guide surface is the per-row exception to whole-surface fallback, for absence as well as for
faults. A foreign guide the host could not serve — a failed read, or the `404` a published package
with a private repository answers with — keeps the target's existing mirror as its floor, while the
other guide rows can still update. When at least one selected guide keeps its mirror,
`provenance.guides` is `floor` for the result; it is `live` only when every selected guide resolved
live.

A value `Host` can carry live host-owned bytes beside installed floor bytes for deferred guide and
catalog paths. Each surface still contributes one baseline. Deferred paths are presence-only, and
repair never writes their floor bytes.

Every verb's machine-readable result carries `provenance`. The record names only the remote
surfaces that the verb read. A host supplied by the `--from` option is absent because it comes from
a local path.

`scaffold --help` prints the whole reference:

```text
scaffold <verb> [options]

  scaffold new <name> [--src <list>] [--app <list>] [--bin] [--deps <list>] [--offline] [--from <path>] [--target <path>] [--json]
      scaffold a workspace
  scaffold audit [--groups <list>] [--offline] [--from <path>] [--target <path>] [--json]
      report how the target compares to its plan, writing nothing
  scaffold repair [--groups <list>] [--offline] [--from <path>] [--target <path>] [--json]
      write each planned path the target is missing or has let drift
  scaffold catalog [--all] [--from <path>] [--target <path>] [--json]
      regenerate the package table and refresh the guide mirrors
  scaffold overwrite [--groups <list>] [--dirty] [--offline] [--from <path>] [--target <path>] [--json]
      do everything repair and catalog do, then delete what the plan does not own and re-declare the dependency ranges

options
  --src <list>                   the published library environments to build: core, browser, server
  --app <list>                   the private application environments to build: core, browser, server
  --bin                          scaffold a command-line executable at src/bin/main.ts
  --deps <list>                  the @orkestrel/* packages the workspace depends on
  --groups <list>                the artifact groups to cover; every group when absent
  --all                          fetch a guide for every package the organization publishes, not the declared ones alone
  --dirty                        delete from a tree carrying uncommitted changes
  --offline                      use the distributed dependency and vendored-host floors without reading upstream
  --from <path>                  read the data root from a local path instead of the bundled one; catalog alone accepts it more than once
  --target <path>                the directory the verb operates on; the working directory when absent
  --json                         emit one machine-readable value instead of a report
  ORKESTREL_SCAFFOLD_REGISTRY    the registry base mapped to upstream.registry.base
  ORKESTREL_SCAFFOLD_REPOSITORY  the repository base mapped to upstream.repository.base

exit codes
  0  clean
  1  drift or failure
  2  usage error
```

An option a verb does not list is refused by name rather than parsed and ignored. `--help` is the
one exception, because it replaces the run rather than modifying it: a command line carrying
`--help` anywhere prints the whole reference and exits `0` before the line is read as a command, so
no verb has to list it. Without the `--offline` option, every verb reaches the registry, and none of
them invents a range when the read produces no answer. Dependency floors states what each verb reads
and what it does then.

At their defaults, online runs contact `registry.npmjs.org` for scoped package packuments and the
`/-/org/orkestrel/package` membership path. They contact `raw.githubusercontent.com` for guide
files on `main`, the scaffold repository's `host.json` file, and changed vendored paths.
`ORKESTREL_SCAFFOLD_REGISTRY` replaces the registry base, and
`ORKESTREL_SCAFFOLD_REPOSITORY` replaces the repository base. These settings change which host
answers a read and grant no verb write authority that it did not already have.

`new --bin` creates the executable entry, its test, and its scoped Vite and TypeScript wrappers. The
other structural facts do not need creation flags. Add a root `tests/setup*.test.ts` proof for
`setup`, `tests/guides.test.ts` for `guides`, `tests/integration.test.ts` for `integration`,
`tests/conformance.test.ts` for `conformance`, `tests/setupService.ts` for `service`,
`tests/setupGlobal.ts` for `global`, and `configs/app/vite.showcase.config.ts` for `showcase`;
reading verbs detect each exact-case file and register its fixed machinery. Add `scripts/service.sh`
for `vendors`. Reading verbs preserve and protect that birth-owned script, but do not infer its
vendor list from edited text.

`distribution` is not on that list. Publishing at least one `src` environment is its whole
condition, and scaffold writes `tests/distribution.test.ts` itself rather than waiting for you to.
Limits states what makes that one proof generable when the others are not.

### Reading a target

`audit`, `repair`, `catalog`, and `overwrite` derive the blueprint from the target itself. The name
and the declared `@orkestrel/*` packages come from `package.json`. The environment axes come
from the directories the target actually ships, because a directory is the fact and a declaration
beside it could disagree. The remaining facts come from exact-case files: `src/bin/main.ts` selects
`bin`, each root `tests/setup*.test.ts` match selects `setup`, `tests/guides.test.ts` selects
`guides`, `tests/integration.test.ts` selects `integration`, `tests/conformance.test.ts` selects
`conformance`, `tests/setupService.ts` selects `service`, `tests/setupGlobal.ts` selects `global`,
and `configs/app/vite.showcase.config.ts` selects `showcase`. A containing directory does not select
the fact by itself. `tests/distribution.test.ts` selects nothing: the published `src` axis the
target ships already decides the `distribution` project, and the file is planned from that.

`vendors` is not reconstructed. Its only artifact, `scripts/service.sh`, is birth-owned, so edited
script text is not a trustworthy declaration of a vendor list. A present script remains in the
target and remains protected from deletion through the owned scripts inventory, but a reading verb
does not infer vendors from it.

That is why the live-service project follows `service` rather than `vendors`. A reading verb has to
plan the project before it can say anything about a target that runs one, and a vendor list it
cannot recover would leave every such workspace unplannable. `tests/setupService.ts` is recoverable,
is the module the root configuration names by path, and is what a live proof needs anyway, so it
carries the fact and the vendor list keeps its own separate job.

The root Vite configuration defines and registers the fixed `guides` project only when the derived
blueprint carries `guides`. Reading verbs set that fact only when `tests/guides.test.ts` is a
physical file with that exact path case. A directory or a case-folded spelling does not select it. A
fresh workspace therefore carries no guides project or script. When a developer adds the proof,
`audit` reports the exact `test:guides` script line until `repair` or `overwrite` appends it through
the writable script region. The rest of the manifest remains birth-owned.

The plan-reading verbs compare the Vitest project set named by the target manifest with the
project set the planned root configuration registers. Every planned proof project must also be
reachable from the manifest's `test` chain. A target whose manifest does not set `private: true` may
also reach it from `prepublishOnly`. A private target cannot use that chain, because npm refuses the
package before a publish lifecycle script runs, so crediting it would report a dead gate as a live
one. Generated integration runs from `test`. One shell-token pass reads quoted and unquoted
`--project value` and `--project=value` forms and follows literal `npm run` calls. A shell expansion
or malformed quote that prevents a project or script name from being resolved statically produces a
question instead of licensing a write. The classifier is deliberately bounded to manifest script
text that names `vitest`; an external wrapper whose name does not identify its runner supplies no
static Vitest fact to infer.

`audit` still completes the comparison and reports one non-blocking `projects` question when its
selection includes `configs`. A scoped audit that excludes `configs` omits that question. For a
literal absent project, its advisory tells the developer to register the project or remove the
script. For a planned project absent from the gate chains, the advisory reads the manifest after a
writable script projection. The `scripts` question owns an absent direct `test:<project>` line. The
`projects` question names the direct script and the gate chain that must invoke it when the projected
region still leaves the project ungated. Its remedy reads the manifest on disk rather than the
projection, so it states what the developer's own file holds: a script the manifest declares leaves
the gate as the only repair, and a script only the projection supplies is named as missing beside
the gate. When `configs` is selected, `repair` and `overwrite` refuse
an unregistered or ungated project before writing. Their refusal names the `configs` group, the
manifest and planned `vite.config.ts` conflict, and the option to exclude `configs` from `--groups`.
A selection that excludes `configs` proceeds. An advisory alone does not make an aligned target
drift.

Scaffold writes one part of the manifest rather than advising on it: the writable script region.
`repair` and `overwrite` write every direct `test:<project>` script the blueprint computes,
`test:probe`, and `test:bench`. A publishing workspace also receives `test:distribution`, `prepack`,
and `prepublishOnly`. The `test`, `check`, `build`, `dev`, `serve`, `show`, `format`, `lint`, `clean`,
and `copy` gate chains stay maintainer-owned. A declared value is overwritten only when it is already
the value being written or is a recognized generated predecessor. The overwrite happens in place,
so every byte outside the replaced ranges survives. A target's descriptions, keywords, extra
scripts, and manifest key order survive byte-for-byte. A script the manifest does not declare is
appended after the last declared script of its own key family, copying that section's indentation:
`test:setup` follows the last declared `test:` key rather than the lifecycle scripts that close the
section. A name carrying no colon has no family, and a family the section declares no member of has
nothing to follow, so each of those is appended after the last declared script instead. `catalog`
writes no script region; it names the ranges alone.

The range region and the script region are not groups. `package.json` is birth-owned, so the
`manifest` group creates it when a workspace is first materialized and never rewrites it afterwards,
and `--groups` narrows the plan rather than the regions. `repair` and `overwrite` therefore
reconcile the declared ranges and write the script region on every run, whatever the selection
names. A run scoped to `manifest` for a script write takes the reconciled `@orkestrel/*`
ranges with it, and a run that excludes `manifest` still takes the ranges and the scripts.

A value matching neither is a script the workspace author wrote. The region writer retains that
value byte-for-byte and reports its name, declared value, and planned value. Each other planned
script is decided independently: an absent script appends, the planned value stands, and an accepted
predecessor upgrades in place. Extra scripts remain byte-identical. A planned key holding a
non-string value or a `scripts` field that is not an object still refuses the whole region with no
script byte moving. `audit` reports absent and differing scripts separately in its non-blocking
`scripts` question, and the terminal audit in `repair` and `overwrite` keeps every retained
difference visible. Other selected writes still proceed. The `projects` question reports only a
direct script the projected region declares and the maintainer-owned gate chain does not invoke, and
it names that script as declared or as missing according to the manifest on disk.

The same plan-reading verbs compare the tooling set the derived blueprint plans against
`dependencies` and `devDependencies` together. A missing planned package produces one non-blocking
`dependencies` question naming every missing package and the exact manifest lines to add, in stable
order. The comparison measures membership: a workspace-owned extra is outside it, a planned tool may
live in either section, and how current a declared range is belongs to the registry evidence
Dependency floors describes rather than to this question. A present section that is not an object
produces a question instead of a crash. This question belongs to `configs` and `tests`. `audit`
reports it only when its selection includes either group, without changing its exit semantics.
`repair` and `overwrite` refuse before writing a selected `configs` or `tests` group. A selection
that excludes those groups proceeds, and no verb adds the declaration for you: `package.json` is
birth-owned, and the range and script regions are the only parts of it a verb rewrites.

`audit` reports a further non-blocking question, on the `setup` field.

The `setup` question fires when the target carries a filled root `tests/setup*.ts` module that is
neither a proof itself nor one of the vendored modules every target receives, while no proof of the
same stem covers it. A module counts as filled when its text differs from the seed this blueprint
plans at that same path.

The comparison reads the module and the seed trimmed, so surrounding whitespace decides nothing: a
trailing newline is not authorship, and a module holding whitespace alone reads as empty rather than
as filled. It is seed-relative rather than a test for emptiness, because the seeds differ by path:
`tests/setup.ts` is seeded with the empty string and `tests/setupGlobal.ts` is seeded with a `setup`
function body. A test for emptiness therefore raises the question against a freshly materialized
workspace. Holding each module to the seed the same blueprint plans at its own path reports what a
maintainer wrote rather than what scaffold seeded.

That reading carries a release-skew limit. A seeded setup module is birth-owned, so `repair` reports
it aligned and never rewrites it. A target keeps the seed of the release that materialized it. When
a release moves a planned seed, scaffold raises the question on every target materialized before it,
against a module scaffold wrote and no maintainer touched. `audit` compares each setup module only
with the seed the installed release plans, and it retains no earlier seed bytes.
`tests/setupGlobal.ts` is the module that can meet it, because it is the one seeded with more than
the empty string. A maintainer meeting that question closes it by writing the proof it asks for, or
by taking the seed the installed release plans.

Coverage is read per module: `tests/<name>.ts` is covered by `tests/<name>.test.ts` and by nothing
else, which is the pairing the vendored policy proof resolves. Writing one proof retires that module
and leaves every other uncovered module named, and the message pairs each module it names with the
proof that module wants. The question belongs to the `tests` group, so a scoped audit that excludes
`tests` omits it. Scaffold does not write the proof it asks for, and the question never refuses a
write: a writing verb reports it in the terminal audit it prints, because refusing `repair` over a
gap no write can close would block every write. Run across a fleet, the question is the list of
packages carrying a filled setup module that no proof covers.

`audit` reads the instruction canon as findings rather than as a question. Each `CANON_PATHS` member
the target holds enters the comparison, by file where the member is a directory, and a path the plan
does not claim there reports `foreign`. Ownership and drift states that population, and Vendored data
root states what `overwrite` does with it.

### Exit codes

`0` means the target matched its plan and every step completed. `1` means the target drifted or a
step failed. `2` means the command line was not a command. A foreign file counts as drift: the
target holds something the plan does not own, whether or not the verb that found it was allowed to
remove it. A superseded instruction copy is such a file, so a target generated before the canon
split exits `1` until the copy goes.

### Git

`overwrite` is the only verb that reads git, and it needs a repository. It asks git for the tracked
set and the dirty set, deletes only tracked paths, and refuses a tree carrying uncommitted changes
unless `--dirty` waives that refusal. A target that is not a git repository is refused under
`TARGET`, because deletion there would have no recovery mechanism. The other verbs never ask. A
git-ignored file sits outside each reading: it never makes the tree dirty and it is never deleted.
Limits states what that costs a target that keeps one at a canon path. The sweep prunes the
directories its deletions emptied, so a swept target does not keep the shape of the set it no longer
holds, and git records no directory to report that shape with.

### Machine-readable output

`--json` replaces the report with one JSON value on standard output. Warnings and refusals go to
standard error, so a piped value is never polluted.

| Verb        | Value                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `new`       | `MaterializeResult` — `target`, `written`, `skipped`, `removed` — plus `provenance`                      |
| `audit`     | `Audit` — `findings` and `questions` — plus `releases` and `provenance`; findings carry `ownership`      |
| `repair`    | `MaterializeResult` plus `audit`, the terminal audit taken after the write, `releases`, and `provenance` |
| `catalog`   | `MaterializeResult` plus `entries`, `mirrors`, `dropped`, `releases`, and `provenance`                   |
| `overwrite` | The `catalog` value plus `audit` and `note` on a partial run                                             |

Every failure reports the same envelope instead: `{ "error": { "code": …, "message": … } }`. The
code is a `ScaffoldErrorCode`, or `USAGE` for a command line that never became a command, or
`FAILED` for a raised value that published no code of its own. A command line that never became a
command is refused in prose even when the line carries `--json`, because the flag is read from the
command and no command was read.

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
The axes are independent, so a library-only, an application-only, and a mixed workspace are all
first class. `dependencies` are runtime `@orkestrel/*` packages. A peer in the `@orkestrel` scope is
a fleet pin; every other peer is a floor. `extras` are development dependencies and may carry any
valid npm name. A peer reaches the generated workspace through separate representations:
`Blueprint.peers` validates the scope rule and compiles the manifest declarations, while the
`peers` binding in the generated `vite.config.ts` derives from the target's live
`peerDependencies`. Each published build face — core, browser, server, and `bin` — externalizes
every name in that binding, so a peer the workspace declares by hand, such as `vitest`, is left as
an import in the emitted bundle rather than inlined into it.

A range is admitted by the shape and refused by the gate, and a `file:` specifier is where a
consumer meets that split. `isDependency` reads `range` as a non-empty string bounded at
`MAX_RANGE_LENGTH` and nothing more, because which ranges a blueprint may declare is a gate law
that reports its accepted candidates rather than a bare `false`. So a blueprint naming
`file:vendor/orkestrel-form-0.0.1.tgz` is a valid `Dependency` and reaches the gate.
`dependenciesToQuestions` then tests every declared range against the pattern its own field
accepts — `ORKESTREL_RANGE_PATTERN` for a runtime dependency and a fleet peer,
`FLOOR_RANGE_PATTERN` for a foreign peer, `EXTRA_RANGE_PATTERN` for a development extra — and none
of them admits a `file:` specifier. The question is blocking, so `audit` reports it and compares no
path:

```text
dependencies: @orkestrel/form declares the range file:vendor/orkestrel-form-0.0.1.tgz, which dependencies does not accept.
Audit did not compare the target because the blueprint was refused.
```

A workspace pinned to a committed tarball therefore has no drift detection until it re-pins to a
registry range. Read that audit as unavailable, not as clean.

One published environment owns the package root directly. Several published environments require
`core`, which owns that root while each other environment keeps its subpath. A multi-environment
`src` selection without `core` therefore emits entry fields naming a `core` build the workspace
never runs. The gate reports that as a non-blocking `src` question rather than refusing the compile,
because the shape is chosen once and read afterwards: `new` refuses the advisory, while `audit` and
`repair` need the plan to describe and restore a target that already has that shape. A library
caller creating a workspace holds the same refusal, and the Compile section states it.

`bin`, `setup`, `guides`, `integration`, `conformance`, `service`, `vendors`, `global`, and
`showcase` are structural facts. Each is set only when the workspace physically ships the directory
or exact-case file that defines it, never because of the workspace's name and never because a
sibling fact is set.

`setup` registers every root `tests/setup*.test.ts` proof in one Node project that loads
`tests/setup.ts`. A nested or wrong-case match does not set the fact. The generated manifest emits
`test:setup` and invokes it from `test` only while the fact is set.

A structural fact is read when a verb runs, not when the file appears. Writing
`tests/integration.test.ts` into a workspace sets the fact, but the root configuration on disk was
generated before that file existed and still registers no `integration` project, so `test:config`
fails with `integration has no project factory or configuration` until a plan-writing verb
regenerates it.

`repair` closes the direct-script half through the writable manifest region. It still refuses to
register a project that the maintainer-owned gate chains do not reach.

When you add a structural proof, write the file and invoke its planned `test:<project>` script from
a gate chain. Then run `repair`; it appends the direct script, regenerates the root configuration,
and registers the project. `audit` reports whichever piece is still outstanding at each step.

`distribution` is not a field at all. A published `src` environment is its whole condition, read
from the `src` axis the blueprint already carries. The proof packs and installs the published
artifact, so a workspace publishing none has nothing for it to read and gets no project, no
`test:distribution` script, and no gate entry. A workspace publishing any gets the project, the
script, the `prepublishOnly` entry, and `tests/distribution.test.ts` itself. Limits states why this
is the one proof scaffold generates from the workspace's own shape.

`service` says the workspace runs a live-service Vitest project over `tests/service`, and it alone
registers that project, its `test:service` script, and the `tests/setupService.ts` readiness module
the project names. A publishing workspace invokes it from `prepublishOnly`; a `private: true`
workspace invokes it from `test`, which is the only gate it has. Its longer timeouts and disabled
file parallelism are the same in both. `vendors` names each external service the workspace drives
and emits `scripts/service.sh`, the provisioner that starts them. Neither is derivable from the
other: a workspace may declare vendors before it writes a suite, and a suite may drive a service the
skeleton does not start.

`integration` projects a cross-environment composition proof for any workspace, independently of
whether it has a published `src`. Its generated seed imports every selected `src` and `app`
environment through its public barrel. It starts no process and does not pack or install the
workspace. The proof composes across environments, so when `src` and `app` together declare fewer
than two the gate reports a non-blocking `integration` question: the project, the script, and the
`test` entry are all still registered, and the advisory reports that the seed composes nothing
rather than withholding it.

`showcase` projects only when the browser `app` environment exists. Without that axis the flag adds
no artifact, configuration, script, or dependency, and the gate reports a non-blocking question on
that field so the caller who set it learns it emitted nothing.

`createBlueprint` enforces shape only. Whether the name is a name, the version a version, and the
axis combination one this package can generate are the gate's laws, and the gate answers them with
questions. A blueprint the gate will refuse is still constructible, so one law lives in one place.

## Compile

The compiler is pure, synchronous, and host-independent. It runs its stages in order.

| Stage   | Does                                                                     |
| ------- | ------------------------------------------------------------------------ |
| `draft` | Assembles the artifacts the selected groups cover, and applies overrides |
| `gate`  | Measures the blueprint, its overrides, and the drafted artifacts         |
| `pin`   | Gives the plan its content identity                                      |

```ts
import { Compiler, createBlueprint } from '@orkestrel/scaffold'

const compiler = new Compiler()
const scaffolding = compiler.compile(createBlueprint('router', { src: ['core'] }))

scaffolding.plan?.artifacts // every planned file, in group order
scaffolding.stages // one CompileRecord per stage that ran
compiler.destroy()
```

One rule decides the outcome: a `Scaffolding` carries a plan exactly when no question blocks. A
refused blueprint is answered rather than raised, so a caller reads the refusal from the value it
asked for. Each stage records its input and its output, a failed stage records the coded reason
beside them, and the stages after a failed one never run.

A plan says the blueprint can be built. It does not decide whether to create it. Every question
beside the plan is advice the compile could not settle, and the caller that chose the shape is the
one that answers it. So `new` refuses on any question, blocking or not, before it writes, while
`audit` and `repair` carry the same questions through, because a target that already has that shape
still has to be described and restored.

A library caller creating a fresh workspace applies `new`'s rule itself:

```ts
import { Compiler, createBlueprint } from '@orkestrel/scaffold'

const compiler = new Compiler()
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
`INVALID`, because it is not a question anyone can answer. Each entry point snapshots the caller's
value first and then guards the snapshot, so a property backed by an accessor is refused rather than
read. `isPlan` refuses an artifact at `package.json` unless it carries `birth` ownership, because a
plan claiming `content` or `presence` there contradicts the compiler-produced plan.

Overrides replace a drafted artifact's content whole. The gate checks each override against the
blueprint's full draft before a group selection narrows the returned plan, so an override outside a
selected group does not block that compile. An override that matches no artifact in the full draft,
that targets a host-origin artifact, or that targets the manifest is a blocking question rather
than a silent no-op.

### Groups

A plan selects over the following groups, and a compile that names none covers all of them. Their
order is the order a plan lists its artifacts in.

| Group           | Holds                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| `manifest`      | `package.json`                                                             |
| `configs`       | The root and per-target build configuration, and the root dotfiles         |
| `source`        | The selected environment barrels and entries                               |
| `tests`         | The shared setup modules, the entry tests, and the policy sweep            |
| `guides`        | The guide index and the vendored guide mirrors                             |
| `docs`          | `README.md` beside the `AGENTS.md` and `CLAUDE.md` pointers                |
| `orchestration` | The harness permission file, the bench scripts, and the catalog agent file |

The plan claims paths inside the instruction canon deliberately, and each has a reason. The `docs`
group carries the `AGENTS.md` and `CLAUDE.md` pointers that name where each contract is read,
planned at those canon destinations as this package's own template content. The `orchestration`
group carries `CATALOG_AGENT_PATH`, the host-origin artifact at a canon path, because the `catalog`
verb refuses a target that lacks the file. Every other canon path is staged for reading, so no group
selection copies a contract into a target, and a copy a target holds at one of them is foreign drift
in the group `inferGroup` gives it. A scoped audit reads the canon through that same selection, so a
run excluding a group reports nothing there.

## Ownership and drift

`Origin` and `Ownership` describe every planned file, and they answer different questions. `Origin` says how the
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
| `birth`     | Nothing        | Create the file only during initial materialize   |

Presence ownership has separate mechanisms, and a reader needs to know which applies:

| Mechanism       | Paths                                             | Bytes belong to                              | Cost                                                        |
| --------------- | ------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Verb-owned      | `CATALOG_AGENT_PATH` and dependency guide mirrors | `catalog` or `mirror`                        | The owning verb is the only route for a later update.       |
| Workspace-owned | `WORKSPACE_OWNED_PATHS`, which holds `.gitignore` | The target workspace                         | Present bytes receive no later canonical ignore update.     |
| Plan-owned      | `DISTRIBUTION_TEST_PATH`                          | The plan, until the workspace writes its own | A deleted file is restored from the plan on the next write. |
| Unhydrated      | Every vendored path a core-compiled plan carries  | Scaffold, after a hydrating face reads them  | Hydration restores the byte claim the core plan omits.      |

The unhydrated row is the one a core-only caller meets most, and reading it as a claim about the
path is the mistake it invites. `Compiler` runs in the pure core face, which cannot read the
vendored data root, so every host artifact it plans carries `presence`: a claim over bytes nobody
has read is a claim no comparison could check. A `src: ['core']` plan therefore reports `presence`
for `.claude/settings.json`, `scripts/codex.sh`, `tests/policy.test.ts`, and every other vendored
path, and a consumer concluding from that reading that scaffold never replaces those bytes is wrong.
`Materializer` hydrates the plan before it audits or writes: hydration reads the vendored root and
turns each path scaffold owns the bytes of into a content-owned artifact, leaving `presence` on the
workspace-owned paths and the mirror pointers the preceding rows name. What a verb claims at a
vendored path is the hydrated ownership, and `HostArtifact` carries the same narrowing on the type.

The `AGENTS.md` and `CLAUDE.md` pointers sit outside that row. Their bytes come from a frozen
template rather than from the data root, so the pure core face already claims them content-owned and
hydration leaves them alone. `repair` and `overwrite` restore a missing pointer and replace a drifted
one, in every face, which is what keeps a target's resolution instructions in agreement with the
release it installed.

Birth ownership is what makes a generated workspace the consumer's. `materialize` writes a
birth-owned path into a vacant target. A later `repair` or `overwrite` call treats that path as
aligned whether it is present or absent, so it neither restores missing bytes nor replaces present
bytes.

You own `tests/setup.ts`, the selected `tests/setupBrowser.ts`, `tests/setupServer.ts`,
`tests/setupService.ts`, and `tests/setupGlobal.ts` modules, each root `tests/setup*.test.ts` proof,
the selected environment entry tests under `tests/src` and `tests/app`, the
`tests/src/bin/main.test.ts` file, and the `tests/integration.test.ts` seed. Scaffold writes those
planned files only during materialize and leaves later edits or deletions alone. You also own the
`tests/guides.test.ts`, `tests/conformance.test.ts`, and `tests/service/**/*.test.ts` proof files,
each of which selects its project by being written. Scaffold content-owns `tests/setupPolicy.ts`,
`tests/policy.test.ts`, and `tests/config.test.ts`; `repair` and `overwrite` restore those files when
their bytes drift or the files are missing.

`tests/distribution.test.ts` is the one proof scaffold generates, and the one test artifact it
claims by presence. Generation is the line, not writing: scaffold writes the vendored
`tests/policy.test.ts` and `tests/config.test.ts` proofs too, and restores them, but those are the
shared file set's own bytes copied into the target. The distribution proof is derived from the
workspace's own shape instead, which is why it is the one proof a generated file can be. A
publishing workspace missing that file reports `missing` drift, and `repair` or `overwrite` writes
the generated proof there. A workspace that replaced the generated proof with a better one keeps its
own bytes exactly: presence compares existence, so no verb reads what is already at the path, none
replaces it, and none ever reports it stale. Deleting the file is how you ask for the generated
proof back; editing it is how you keep your own. Limits states what makes this proof generable when
the others are not.

Content ownership does not preserve an arbitrary custom Vitest project. The optional proof projects
are fixed: `guides`, `integration`, `conformance`, and `service` are selected by their defining
paths, and `distribution` by a published `src` environment. A workspace that needs other local
configuration must keep those edits outside a content-owned file; `repair` restores that file to the
canonical project set.

An audit reports one `Finding` per planned path, followed by every foreign path in the groups the
plan covers. That second list draws on a file beneath a vendored directory the plan expands and on a
file the target holds at a canon path the plan does not claim. Every planned finding carries its
artifact's `ownership`. A foreign finding has no ownership because no artifact was planned for its
path. `Ownership` says what scaffold claims at
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

`isFinding` proves the shape a reader may destructure and nothing about whether the verdict is one
an audit could have reached. `repair` and `remove` re-derive every verdict themselves and act only
on what they derived, so a verdict the comparison could not have produced is refused by name rather
than acted on.

That shape is versioned, and the guard runs at runtime. `repair` and `remove` guard the whole audit
before reading any of it, so an audit persisted or built against an earlier version of this package
is refused with a coded `INVALID` failure rather than accepted and partly understood. A planned
finding carries `ownership`, which findings made before that field existed do not. `remove` acts
only on foreign findings, which never carried ownership, but the guard reads every finding, so one
older planned finding refuses that call too. Take a fresh audit rather than replaying a stored one:
a stored audit records what a target looked like then, and each verb binds its writes to what a
target holds. The refusal is deliberate at `0.0.x` and there is no migration path.

## Fleet catalog

`catalog` rewrites one marker-bounded region in `CATALOG_AGENT_PATH` and nothing else in that file.
The region holds a table with these columns:

| Column                 | Content                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `Package`              | The published package name                                                 |
| `Version`              | The registry's `dist-tags.latest`, or the cause when the lookup found none |
| `Layer`                | The publish round the edges place the package in, as `L0`, `L1`, …         |
| `Runtime dependencies` | Each declared runtime edge, as name and range                              |

The edge-bearing columns come from the same abbreviated packument the version came from, so a
catalog costs one request per package and no more. Only `dependencies` is read. `devDependencies`
reaches no consumer of the published package, so it constrains nothing about publish order, and
reading it would place packages in rounds that do not exist.

The layer is not stored on a row. `catalogToLayers` derives it from the rows' own edges, in the same
call that writes them, so the layer and the rows cannot disagree:

```ts
import { catalogToLayers } from '@orkestrel/scaffold'

const layers = catalogToLayers(entries)
layers[0] // the names that depend on nothing else in the fleet
```

An edge counts only when it names a package this catalog publishes. An edge leaving the fleet and an
edge to a row that found no version each constrain nothing, so neither holds its dependent back.

The order is load-bearing because these packages are `0.0.x`, where a caret pins one exact release.
A dependent sees a new dependency version only after the dependent re-pins and republishes, so
publishing a dependent before its dependency leaves the dependent pinned to the older release.
Ranges that disagree install duplicate copies of one package, and the compiler reads those copies as
distinct types.

A cycle cannot be published in rounds. `catalogToLayers` omits its members rather than placing them
in an order that would be wrong. It also omits each row whose `lookup` field is `missing` or
`failed`, because no published version supplied dependencies to place. To distinguish the causes,
inspect an omitted row's `lookup` field: an omitted `found` row belongs to a cycle, while another
lookup verdict records why the registry row could not enter a layer.

## Dependency floors

Every scaffold-owned runtime or development range is a floor: a caret over a whole
`major.minor.patch` version. The triple is the newest release the registry served when that floor
was last raised, so a workspace generated with no network still receives the latest floor scaffold
knew rather than a bare `major.0.0`. A `Blueprint.peers` row is written during creation into a
vacant target. After creation, peer declarations and `peerDependenciesMeta` are caller-owned:
`audit`, `repair`, `catalog`, and `overwrite` do not invent, rewrite, insert, or remove them. Caller
extras also pass through unchanged. Extras follow `EXTRA_RANGE_PATTERN`; fleet peers follow
`ORKESTREL_RANGE_PATTERN`; foreign peers follow `FLOOR_RANGE_PATTERN`.

The distribution project packs a caller-owned peer beside a co-peer witness that requires an exact
version. The real npm resolver accepts the preserved range. Its narrowed-range control reports
`ERESOLVE`.

The floors live in scaffold's own `package.json`. `BASE_DEV_DEPENDENCIES` and the tables beside it
derive each row scaffold installs from that manifest, and the self-pin from its `version` field, so
the toolchain a generated workspace receives is the toolchain scaffold runs. The rows scaffold does
not install are seeds — `@vitejs/plugin-vue`, `vue`, `vue-tsc`, `vite-plugin-singlefile`, and the
application-server fleet packages — and each carries the newest triple its supported major served
when it was written.
[`tests/src/core/constants.test.ts`](../tests/src/core/constants.test.ts) names that seeded set, so a
row entering or leaving the manifest moves a test rather than passing unnoticed.

A newer major is never crossed for you. `audit` reports one as a non-blocking `dependencies`
question, and a person decides whether the generated toolchain supports it. Inside the declared
major the verbs raise the floor themselves, which is what makes the caret's own width beside the
point: `^0.64.0` admits no `0.65.0`, and `repair` rewrites the range to `^0.65.0` rather than
widening it.

Compatibility and staleness are separate questions, so they are read by separate helpers.
`extractRangeMajor` answers which major a range names, which is what a compatibility bound is
measured against. `matchesRange` answers whether a published version satisfies a range, which is
admission rather than currency: a drift check that asked it would read a raised floor and a stale one
alike.

### What each verb reads

`new`, `audit`, and `repair` read declared versions and the vendored host. `catalog` reads
organization membership, its packuments, and the selected guides. `overwrite` reads every surface
that `repair` and `catalog` read. A network-forced floor is drift except for a successful `new` run;
an explicit `--offline` floor is intentional, and the verb's result decides its exit. `catalog` has
no offline form. `overwrite` commits repair and removal before it starts the catalog step.

Each verb resolves a surface's complete answer before it opens that surface's write transaction, so
a partial answer never becomes a partial pin set. `overwrite` keeps the repair and removal work it
committed before a later catalog refusal and records that refusal in `note`.

| Verb        | Reads live                                                       | When the network forces a floor                                                                                                                             | With `--offline`                                                                                            |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `new`       | Declared versions and the vendored host                          | Writes the distributed version and host floors; exits `0` after creating the workspace                                                                      | Reads no upstream surface, writes the same floors, and exits `0` after creating the workspace               |
| `audit`     | Declared versions and the vendored host                          | Compares through the distributed floors and exits `1`                                                                                                       | Compares through the floors; exits `0` for an aligned target or `1` for drift                               |
| `repair`    | Declared versions and the vendored host                          | Repairs from the distributed floors and exits `1`, even when the terminal audit is aligned                                                                  | Repairs from the floors; the terminal audit decides exit `0` or `1`                                         |
| `catalog`   | Organization membership, its packuments, and the selected guides | Refuses a membership or version failure with `FETCH` and exit `1`; preserves the local mirror of each guide that failed or is absent upstream and exits `1` | Is a usage error; exits `2` and writes nothing                                                              |
| `overwrite` | Everything `repair` and `catalog` read                           | Keeps completed repair and deletion work, names each floor or refused catalog step in `note`, and exits `1`                                                 | Repairs, deletes, and writes version floors; skips `catalog`, records that refusal in `note`, and exits `1` |

A fleet row is compared exactly — `^0.1.0` is stale the moment the registry serves `0.1.2` — and
that inequality alone raises `audit` to exit `1`. A foreign row is compared inside its declared
major, and each verdict is a non-blocking question: one for a floor below the newest release that
major serves, and one for a newer major the registry publishes.

### Raising the floor before a release

The floors ship inside the package, so a release carrying stale ones propagates them to every
workspace generated from it until the next release. Raise them as the opening step of a release,
while the registry is reachable:

1. Run `scaffold audit` against this repository and read its `dependencies` questions.
2. Run `scaffold repair`, or `npm update` followed by the same audit, until no question remains.
3. Run the gate chain, then bump the version and publish.

That cycle is what keeps every release shipping the then-latest floor, and it is what a consumer
generating a workspace with no network receives.

## Vendored data root

The vendored data root is the shared file set, staged into the published package as plain data.
Staging walks `HOST_PATHS` and `CANON_PATHS`, and a release ships what both name.

`HOST_PATHS` is the vendored set, and a target receives a copy of each path it selects: the licence,
the harness permission file, the bench scripts, the shared policy register, the byte-identical root
dotfiles, and the guide mirrors a generated workspace starts from. It is a candidate list rather than
a plan, because a workspace never mirrors its own guide.

`CANON_PATHS` is the instruction canon, staged for reading instead: the `AGENTS.md` coding contract,
the `CLAUDE.md` harness bridge, the `.agents/orchestration.md` agent-operation contract, the rules
under `.claude/rules/` and `.cursor/rules/`, the skills under `.agents/skills/` and `.claude/skills/`,
the templates under `.agents/templates/`, the transport contracts under `.agents/transports/`, the
agent roles under `.claude/agents/` and `.codex/agents/`, the `.codex/config.toml` bench
configuration, and the `.mcp.json` and `.cursor/mcp.json` server registrations. A release stages
every one of them, and a target receives a copy only where the plan claims the path. At the
`AGENTS.md` and `CLAUDE.md` destinations it receives the pointers: different content at the same
paths, planned as this package's own template content. At `CATALOG_AGENT_PATH` it receives the staged
bytes themselves, because the `catalog` verb refuses a target that lacks the file. Everywhere else in
the canon a target holds nothing, and a reader reaches the contracts from a scaffold checkout sitting
beside the repository, or from the `node_modules/@orkestrel/scaffold/dist/host/` root inside the
installed package, which is what the `AGENTS.md` pointer scaffold plans into a target names.

`HOST_PATHS` and `CANON_PATHS` are disjoint by prefix in either direction: no member of one equals or
sits beneath a member of the other. Staging depends on that, because the walk covers the union and a
path it discovers twice claims one storage name twice, which refuses the stage. `isCanonPath` is the
one reading of canon membership, matching a member and anything beneath a member that is a directory,
so staging, the live overlay, and the executable's fetch list never disagree about what a path is.
Membership says where a path's bytes are staged, not whether a plan claims it: `nameToHostArtifacts`
appends `CATALOG_AGENT_PATH` to what `HOST_PATHS` selects rather than listing it there, which is what
keeps the file planned without putting a canon path in the vendored list.

The `host.json` file at the repository root is the committed live inventory. Each entry carries the
SHA-256 digest of its file content, and the inventory carries a membership digest over its declared
paths and file digests. Run `npm run build:inventory` whenever a vendored byte or path changes; the
`config` project refuses a stale inventory. Run that gate against a quiescent checkout: its fresh and
committed reads cannot distinguish stale data from a source edit made while the gate runs.

The installed release fixes which paths a target owns. A live inventory can update bytes only for
those paths; it can neither introduce a path nor delete one. A path added upstream is invisible
until a release adds it to the installed manifest. Remove a vendored path in the same change that
ships the release which removes it from that manifest.

Moving a path from `HOST_PATHS` to `CANON_PATHS` is not that removal. The path stays staged, stays in
the installed manifest, and keeps being published; what changes is that no host artifact claims it. A
target generated before the move still holds the copy it received, and that copy sits at a path the
plan does not own, so `audit` reports it `foreign` and exits `1`. `overwrite` deletes it in the run
that repairs the pointers — one candidate list and one transaction, whether the file is a stray
beneath a vendored directory or a superseded copy inside the canon. Membership decides that, never
byte identity: a copy a release behind no longer matches the bytes the canon stages, and matching
bytes is exactly how such a copy would be spared.

At the default `UpstreamOptions.retries` value, an aligned target spends one request on `host.json`,
and each installed path whose live digest differs from the target adds one request for its bytes. A
positive `retries` value can repeat a request after a transport fault. Raw-host propagation lag after
a commit is a property of the content host. Scaffold neither creates that lag nor presents a stale
response as fresher than the host served it.

A canon destination costs no request. The fetch list drops every canon destination and `filesToHost`
keeps the installed floor bytes for each one, claimed or not. The rule covers the destinations a plan
does claim as well: the `AGENTS.md` and `CLAUDE.md` pointers are written from this package's own
templates, and the catalog agent file is claimed by presence, so no byte a target holds is taken from
a fetched canon path. A fill carrying no row for a canon path is complete rather than spoiled, which
is what lets one `Host` carry live bytes beside floor bytes without mixing baselines within a
surface.

`.claude/settings.json` is in that set, and the artifact planned for it is content-owned. `repair`
and `overwrite` restore its bytes, so an edit made to it inside a target is reverted at the next
visit and reported as drift until then. Put an operator grant in `.claude/settings.local.json`
instead. That path is outside `HOST_PATHS` and matches the vendoring deny-list
`matchesSensitivePath` reads, so `stageHost` never copies it into a host root and no plan carries
it.

`stageHost` fills the root from a real checkout at build time:

```ts
import { stageHost } from '@orkestrel/scaffold/server'

stageHost(process.cwd(), 'dist/host') // one ManifestEntry per file staged
```

Each staged path is copied to a storage name, and every dot that opens a segment comes off,
because npm's own ignore rules would drop a leading-dot entry from the tarball. A dotted file at the
root moves under `dotfiles/` so it cannot collide with an undotted sibling. `manifest.json` is
written last and declares the whole membership: one entry per file with a digest computed from the
staged destination after its copy, the sorted directory inventory, and a SHA-256 digest over both.
The membership digest detects an edit that did not update the manifest, and the directory inventory
makes a declared empty directory survive a file walk.

The pointer reads that spelling back. The installed branch of a target's `AGENTS.md` names the
`node_modules/@orkestrel/scaffold/dist/host/AGENTS.md` file, the
`node_modules/@orkestrel/scaffold/dist/host/agents/orchestration.md` file, and the
`node_modules/@orkestrel/scaffold/dist/host/claude/rules/` directory, which are where the dot-stripped
storage names of `AGENTS.md`, `.agents/orchestration.md`, and `.claude/rules/` land. A reader
following a canon path through the installed package types the storage spelling, not the repository
one.

A missing staged path is refused rather than staged around, and the refusal names every missing
path at once. That is why `guides/scaffold.md` — this file — must exist before `npm run build`
completes.

The `Materializer` reads the root once, at construction, and cross-checks the manifest against the
files actually stored. It defaults to the root inside the installed package, resolved from the
module's own location rather than from the caller's working directory. `--from` points it somewhere
else. A root carrying no manifest at all is read as a raw checkout, and artifact paths map onto it
one to one.

### Integrity

HTTPS supplies Transport Layer Security (TLS) for each fetched response, and the reader applies its
per-response and per-call byte budgets before it accepts content. It carries each fetched vendored
response's decoded content as hexadecimal before any character decoding and verifies that content
against the digest in `host.json`, then verifies the inventory against its membership digest.
Transport encoding is transparent and does not enter the comparison. The path never character-
decodes and re-encodes the content.

This posture supplies integrity, not authenticity. An attacker who can serve the files can also
serve a matching inventory. The residual is direct: fetched bytes govern agent behavior in a target
that has no release gate. Run `audit` to preview the change, use the `--offline` option to pin the
distributed floors, and keep operator grants in `.claude/settings.local.json`; scaffold does not
read or write that file.

## Generated workspace

A workspace's file set is a function of its axes plus its structural facts. Nothing is fixed
except the manifest.

- One computed artifact: `package.json`, with the entry points, `exports` map, scripts, and
  development dependencies its selection implies. In publishing workspaces, the emitted `prepack`
  script runs `npm run build` so a publish rebuilds `dist/` and cannot ship a stale artifact; the
  hook is publish-time only, and every generated distribution proof passes
  `--ignore-scripts` to `npm pack` so a suite never re-runs the build it already gates.
- One template artifact per configuration file the selection needs: the root `tsconfig.json` and
  `vite.config.ts`, plus a Vite config and a scoped TypeScript config per selected environment and
  for `bin` when it is set.
- One template artifact, `configs/browsers.ts`, for a workspace selecting `browser` on either axis.
  It resolves the Chromium the Playwright provider launches, and the root `vite.config.ts` calls it
  once into `browserOptions` and passes that to every `playwright()` provider it configures. The
  precedence is `PLAYWRIGHT_EXECUTABLE_PATH`, `PLAYWRIGHT_WS_ENDPOINT`, `PLAYWRIGHT_CHANNEL`, the
  managed Playwright Chromium, the container's bundled Chromium, a verified system channel, then the
  platform default. An installed pinned revision returns empty options, so Playwright keeps its own
  launch defaults. A pinned revision that is not installed falls through to a `chromium` alias or a
  sibling `chromium-*` revision under the same browsers directory, because a managed container ships
  one usable build for many Playwright versions. It is its own file rather than a block in the
  vendored `configs/helpers.ts`, which every workspace receives byte-identical while only a browser
  selection declares the `playwright` this module imports.
- One template artifact per source and test file the selection needs: an `index.ts` barrel per
  selected environment, `main.ts` and `index.html` for an application browser, `tests/setup.ts`
  plus the host setup modules the selection reaches, and one entry test per axis project. An
  integration selection also emits a birth-owned `tests/integration.test.ts` seed that imports each
  selected public barrel and records its initial empty exports for the consumer to replace with an
  observable cross-environment flow.
- One template artifact, `tests/distribution.test.ts`, for a workspace publishing any `src`
  environment. It is the packed-package proof, and it is claimed by presence rather than birth, so a
  workspace that replaces it keeps its replacement. A published browser environment adds the
  real-browser stage to it: the stage bundles the installed package with the workspace's own
  `configs/browsers.ts` resolution, serves the bundle over a loopback server, and drives it in
  Playwright Chromium.
- One template artifact each for `README.md` and `guides/README.md`.
- One template artifact each for `AGENTS.md` and `CLAUDE.md`. They are pointers rather than contracts:
  `AGENTS.md` names the coding contract, the orchestration contract, the rules, and the skills, and
  resolves each against a sibling scaffold checkout or the installed package; `CLAUDE.md` names the
  `AGENTS.md` file beside it and imports nothing, because an `@path` import inlines the imported file
  into every context that loads it. Scaffold owns their bytes, so a release that moves the wording
  moves every target's copy at its next `repair`.
- One host artifact per vendored path the workspace selects. A vendored directory is one planned
  path that expands into the files the data root stores beneath it.

`planToSummary` reports the tally rather than a number written down here:

```ts
import { Compiler, createBlueprint, planToSummary } from '@orkestrel/scaffold'

const compiler = new Compiler()
const scaffolding = compiler.compile(createBlueprint('router', { src: ['core', 'server'] }))
const summary = scaffolding.plan === undefined ? undefined : planToSummary(scaffolding.plan)

summary?.host // vendored artifacts
summary?.template // filled artifacts
summary?.computed // the manifest
compiler.destroy()
```

## Library

The entry points split by host. `@orkestrel/scaffold` is host-independent: it compiles, gates,
and compares, and it touches neither the filesystem nor the network.
`@orkestrel/scaffold/server` is Node-only and holds everything that does.

Compare a plan against bytes a caller already read:

```ts
import type { Blueprint, Snapshot } from '@orkestrel/scaffold'
import { Compiler } from '@orkestrel/scaffold'

declare const blueprint: Blueprint
declare const current: Snapshot

const compiler = new Compiler()
const audit = compiler.audit(blueprint, current)

audit.findings.filter(({ drift }) => drift !== 'aligned')
compiler.destroy()
```

Write a compiled plan into a real directory:

```ts
import type { Plan } from '@orkestrel/scaffold'
import { Materializer } from '@orkestrel/scaffold/server'

declare const plan: Plan

const materializer = new Materializer({ host: './dist/host' })
const result = materializer.materialize(plan, './packages/router')

result.written // every path created
materializer.destroy()
```

When a `Materializer` uses a value `Host`, each mutating call stages the host under a private
`#fill` root in the operating system's temporary directory and removes that root in a `finally`
block. A process killed during the mutation can leave the temporary root behind.

`resolveContainedPath` refuses a lexical escape, a physical link out of the root, and a dangling
link whose raw target contains a `..` segment. It returns the lexical join of `root` and `path` — an
absolute path under `root` — after checking the namespace, not an open filesystem handle. Its
shipped example tests that answer's suffix rather than printing the whole path. Its contract
therefore excludes a concurrent rename or link swap during the check or before the caller finishes
using that path. A caller that admits hostile concurrent namespace mutation needs a handle-bound
operation instead.

`resolveRealPath` answers the caller's own text collapsed lexically, then resolved through every link
in what survives that collapse. A `..` the caller wrote cancels the segment before it as text, so
`<root>/hop/..` answers `<root>` even where `hop` links elsewhere, rather than the directory holding
what `hop` points at. The collapse only ever shortens the path, so nothing reaches outside it this
way; the answer is a lexical location resolved through links, not a physical one.

Read the registry and the repository host:

```ts
import { Upstream } from '@orkestrel/scaffold/server'

const upstream = new Upstream({ registry: { timeout: 5_000 } })
const releases = await upstream.lookup([{ name: '@orkestrel/emitter', range: '^0.0.5' }])

releases.filter((release) => release.lookup === 'found')
upstream.destroy()
```

Every request is unauthenticated, follows no redirect, and is bounded twice: `limit` refuses one
oversized answer and `budget` refuses many small ones. A per-package failure is collected as a
verdict carrying its cause rather than thrown, so one unreachable package never costs the caller the
rest of the answer. The organization package list is the exception, because without it there is no
fleet to report.

A found verdict carries the newest version the declared range admits, not whatever `dist-tags.latest`
names. `lookup` reads the packument's version map, selects across it before any collection bound can
truncate the map, and falls back to the latest tag only when that tag is itself admitted. A range of
`*` admits every version, which is how a caller asks for the newest release outright.

Each bound counts decoded bytes, and a version lookup asks the registry for the abbreviated
packument — `dist-tags` and a trimmed version map, rather than the full per-version metadata no
verdict reads. That is the smallest form the registry publishes. The default response limit is
`MAX_REGISTRY_BYTES`, and the default call budget is `MAX_TOTAL_REGISTRY_BYTES`. A package that
passes the response limit comes back as a `failed` verdict naming the limit, which is this reader's
bound and not a statement about the package.

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
It is not a journal: a process killed between promotions leaves a mixed target.
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

`INVALID` is off-contract input, `BLOCKED` is a refused blueprint, `DESTROYED` is a call after an
entity's teardown, `TARGET` is a destination that is not what the caller's observation said it was,
`WRITE` is a mutation that could not be completed, and `FETCH` is an upstream read that produced no
answer.

`BLOCKED` covers every refusal a blueprint can meet, because they are one fact — this blueprint will
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

What a reader will look for and not find.

**Guide parity has a bounded reach.** [`tests/guides.test.ts`](../tests/guides.test.ts) proves that
the Surface tables match the core and server barrels in each direction, the method tables match the
behavioral declarations, relative links resolve, and named imports in TypeScript fences resolve. It
does not resolve arbitrary backticked prose spans or typecheck a whole fence. The same suite keeps
the command reference aligned with the executable and executes the transcribed pure examples for
blueprint defaults, compile refusal, and error-code narrowing. Other trailing comments remain guide
claims rather than build answers. The verdicts that are measured are the ones a consumer hovers:
[`tests/distribution.test.ts`](../tests/distribution.test.ts) drives every `@example` the built
declarations print against the installed package, scores each verdict it can read as a value, and
names exactly the ones it cannot. Executing the remaining fences would require fixtures for each
ambient value plus isolated filesystem and network drivers for the mutating examples; adding those
drivers is separate test capability rather than name-resolution parity.

**The library does not enforce the creating verb's policy.** `new` refuses a blueprint carrying any
question, and `materialize` writes any plan into any vacant target. The Compile section states the
rule a library caller applies in its place.

**A file a target keeps at a canon path never reports clean.** `overwrite` deletes a superseded
instruction copy in the run that repairs the pointers, and it deletes only what git tracks, from a
tree carrying no uncommitted work. An untracked copy is left standing, and a git-ignored one sits
outside the dirty reading as well, so a target can carry its own file at a canon path through every
visit. The audit reads canon membership by path, so such a copy stays a `foreign` finding and that
target exits `1` on every run. `repair` never closes it either: that verb writes the planned paths a
target is missing or has let drift and deletes nothing, so it restores the `AGENTS.md` and
`CLAUDE.md` pointers and leaves every other copy where it is. A maintainer who wants a local MCP
server registration keeps it outside the repository, in the harness's own local or user scope, rather
than at `.mcp.json`, where the file is drift whoever wrote it.

**A target holds no dispatchable role beyond the catalog agent.** The canon is staged for reading, so
a target receives the `AGENTS.md` and `CLAUDE.md` pointers and `.claude/agents/orkestrel.md`, and
nothing else a harness reads: no other agent role, no bench configuration, and no MCP registration. A
harness running in a target loads none of those from `node_modules` either, so a role, a bench, or a
server that target needs is defined in the harness's own local or user scope — the seam the preceding
registration entry already names. Fleet targets are not orchestration hosts. A session that
dispatches roles starts on scaffold, where `.agents/orchestration.md` and the role files sit, and
attaches the target it is working on.

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
environment because the fleet has one; scaffold does not generate it.

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

**Scaffold generates the distribution proof and refuses to generate every other one.** The subject
is what separates them, and it is the whole rule. Generating a file is not the same as writing one:
scaffold also writes `tests/policy.test.ts` and `tests/config.test.ts` into a target, byte for byte
from the shared file set, and the distribution proof is the one it derives from the workspace it is
writing into.

A distribution proof's every assertion derives from the artifact the workspace installs: the
`exports` map the packed tarball declares, the built declarations beside it, and the module objects
a Node import, a CommonJS require, and a real browser hand back from that installed tree. Nothing
there has to be named, so one generated file measures every publishing workspace, and it stays true
as that workspace's published surface moves.

A guide, conformance, live-service, or setup proof asserts something scaffold cannot read: the API a
guide fence claims, the official runner a conformance check measures against, the service a live
proof drives, and what a setup module does. That subject is what no generated file can reach, and
the claim here is about the subject rather than about every property those files have. A structural
property of the same files can be derivable — whether each root `tests/setup*.ts` module is
reachable from the root configuration is one — and a file asserting it would still leave the
module's behavior unmeasured. A generated file there would read as a proof while measuring nothing,
which is worse than an absent one. So the file a consumer writes is what selects each of those
projects, and `tests/distribution.test.ts` is the one proof scaffold generates for you.

Registration follows the same split. Scaffold registers `conformance` and `service` when their
structural facts are set, and registers `distribution` whenever the workspace publishes at least one
`src` environment. In a publishing workspace, `distribution` and `service` run from `prepublishOnly`
and `conformance` stays in `test`. In a `private: true` workspace, `distribution` is absent,
`service` runs from `test`, and there is no `prepublishOnly` at all. One gap the project set cannot
show, `audit` reports directly: a filled `tests/setup*.ts` module that no `tests/setup*.test.ts`
proof covers raises the non-blocking `setup` question, which names the modules and the proof to add.
Scaffold generates nothing there either, because what that proof asserts is those modules' own
behavior, which only the workspace that wrote them can state.

The generated proof partitions the installed `exports` map rather than sampling it. Every published
subpath lands in exactly one of driven, undeclared, or excluded, and a totality assertion holds that
partition against the map's own subpath list, so a subpath the proof classifies into none of them
reddens instead of disappearing. Another assertion beside it names every driven subpath whose entry
resolves no Node target and no browser target: each drive retires itself for such a subpath, so
membership of the partition alone would leave one measured by nothing. Together they hold that every
published subpath is driven, or is named where the proof cannot drive it.

A subpath is driven when its entry resolves a declaration, and each measurement resolves that entry
under the conditions of the driver taking it rather than under one shared set. The Node ESM runtime
resolves `node-addons`, `node`, `import`, and `module-sync`; the Node CommonJS runtime resolves
`node-addons`, `node`, `require`, and `module-sync`; Vite's production client build resolves
`module`, `browser`, `production`, and `import`. A subpath whose Vite resolution lands under
`dist/src/browser/` is driven in a real browser and the Node drives retire for it; every other
subpath is imported where the Node ESM set resolves a target and required where the Node CommonJS
set resolves one.

The CommonJS compile probe resolves the declaration under `types`, `node`, and `require`, then reads
that declaration's format. TypeScript accepts an existing declaration target directly. Otherwise it
substitutes beside the resolved JavaScript target: `.cjs` maps to `.d.cts`, `.mjs` maps to `.d.mts`,
and `.js` maps to `.d.ts`. A missing target under `types` leaves that condition unresolved, so the
walk continues through the remaining conditions or fallback members. A `.d.cts` declaration admits
the subpath. A `.d.mts` declaration refuses it. A `.d.ts` declaration takes the nearest enclosing
physical `package.json` file from its own directory: a `"type": "module"` field refuses, while
`"type": "commonjs"`, an omitted field, or a manifest that cannot supply a readable field admits.
A directory named `package.json` starts no scope, so the walk continues outward. The runtime target
does not decide compile membership. The runtime drive separately resolves under `node-addons`,
`node`, `require`, and `module-sync`, then loads the subpath whatever declaration format the compile
probe found. An invalid non-list target beside a valid CommonJS declaration therefore reaches Node's
`ERR_INVALID_PACKAGE_TARGET` failure instead of being dropped during classification.

The mirror assertion reports a CommonJS typing defect only when the entry's own mapping declares an
explicit `require` condition, the Node `require` resolver reaches the entry, and the selected
declaration refuses a CommonJS consumer. A `default` branch that merely resolves under the require
condition set makes no CommonJS claim.

Each drive compares against the declaration its own consumer reads, resolved under the conditions
TypeScript applies for that resolution and importing format: `types` first and the format's own
condition after it, with `node` between them for the `node16` and `nodenext` resolutions and left
out for `bundler`, which is the set the browser drive compares against. The import declaration and
the require declaration are resolved independently and kept separately on the entry, so a dual
subpath is compiled against the declaration each consumer format reads rather than against whichever
one answered first. That is what drives a `require`-only subpath declaring its types inside
`require`, and what admits a conventional subpath that publishes no `types` condition but ships the
adjacent declaration TypeScript substitutes from its runtime target.

A subpath is undeclared when it resolves no declaration and names a runtime target, which is a
defect, because a consumer importing it compiles against nothing under `node16`. A target is a
runtime target when its own file name carries no extension at all, or carries `.js`, `.mjs`,
`.cjs`, or `.node`. An extensionless target loads, because `require` reads such a file through its
JavaScript handler; a `.wasm` target does not, because it carries an extension that is not a
JavaScript one. A
`.node` target is named beside them because `require` loads a native addon through its own handler
rather than the JavaScript one, and the addon publishes names to whatever loads it. The test is the
extension the name carries rather than a denylist of asset extensions. Reading the
file name rather than the whole path is load-bearing: `./dist/bundle.js/feature` and
`./dist/v1.2/index` are modules, and reading the path gets each of them wrong. What the rule
excludes is stated where the proof is emitted: an extensionless file published for a reader, such as
a `LICENSE` at a subpath, reports undeclared until it is given an extension or a declaration. That
is the safe direction: the proof names a subpath it cannot vouch for rather than passing one it
never measured.

A subpath is excluded when it resolves no declaration and names no runtime target: the
`./package.json` pointer, a published stylesheet, and a WebAssembly binary are read rather than
imported, and the proof names them where it excludes them.

Classification reads every target the entry names under every condition, and the members of a
fallback list with them: Node reads an array in an exports entry as a list of fallbacks, and a
reader taking a later member takes a file the installed tree still owes. Node's package-target rules
apply inside that list, so a member naming a path outside the package or carrying a `.`, `..`, or
`node_modules` segment is skipped rather than resolved or collected: Node falls through to the next
member, and no reader can take the one it passed. A standalone target Node rejects the same way is
still read and reported, because Node throws on one rather than falling through to anything. So a
`require`-only CommonJS subpath carrying no declaration reddens too, and a `.d.ts` or `.d.cts`
target never satisfies the runtime-target test, so a types-only condition cannot stand in for a
missing declaration.

A `./*` subpath pattern is read as an ordinary subpath, with no expansion of the `*`, so a pattern
naming a runtime target reddens rather than landing in excluded. That is deliberate: excluding the
pattern would account for a whole family of published subpaths and measure none of them, which is
the silence this partition exists to close. Measuring the family means expanding the pattern against
the installed tree and driving each match, which this proof does not do. A maintainer meeting that
red is reading the honest answer — the proof does not measure that family — rather than a defect in
the proof.

The proof generated for a workspace publishing no browser face asserts that no browser face exists.
That variant drives a Node import and a Node require and carries no browser branch, because the
branch follows a published browser face on the `src` axis: the browser drive measures the packed
artifact, and only a published face is packed. A workspace that selects `browser` on its `app` axis
alone declares `playwright` and `@vitest/browser-playwright` and gets `configs/browsers.ts` emitted,
and its proof still carries no branch: the selector reads the `src` axis, and a generated manifest
packs `dist/src`, so an application face is neither selected nor packed. The imports the branch
needs are declared by either axis, so they do not select the branch. The `vite` import selects
nothing either: every workspace declares `vite`, whatever it publishes. In a core-only workspace,
those imports resolve to nothing, and emitting the branch there would fail its own `check` and
`lint:check` gates. Its Node cases retire themselves for a browser face, so a face published after
the file was written would leave nothing measuring it. The assertion reddens instead, and names the
subpath a browser branch is owed for. The remedy it carries is to delete the file and run `repair`,
which writes the variant that carries the branch — the same route presence ownership already gives
you for asking for the generated proof back.

The generated distribution proof takes its release contract from the outside. The generated
`prepublishOnly` invokes it as `npm run test:distribution -- --mode release`, and the proof reads
`import.meta.env.MODE === 'release'` and **fails** on an unreachable registry rather than skipping.
An ordinary local run skips that case, because a developer offline is not a defect; a release run
does not, because skipping there passes the publish gate without ever proving the artifact installs.
A workspace that replaces the generated proof takes that contract with it: presence ownership leaves
a replacement alone, so a replacement that ignores the flag reports green on exactly the runs that
matter.

The consequence is one empty-project case per refused proof. A blueprint carrying `conformance` with
no `tests/conformance.test.ts` registers a project whose include resolves to nothing, and Vitest
exits non-zero on it. A blueprint carrying `service` gets `tests/setupService.ts` — the root
configuration names that module by path, so an absent one fails the project's load rather than its
run — and still no suite beneath `tests/service`, so `test:service` reports no test files until the
consumer writes the first one. The `distribution` project no longer has that case: `new` writes the
proof into the workspace it registers the project in, and a target that later lost the file reports
drift that `repair` closes. Every remaining case is visible the first time the script runs, which is
why none is silent.

None of those folds into `integration`, which measures a different axis rather than a smaller
one: the workspace's selected environments compose through their public barrels. The generated seed
proves only that those barrels load together and expose the initial empty surfaces; the consumer
replaces it with an observable cross-environment flow. The seed starts no process and does not pack
or install the workspace, so the project stays in `test`. These fleet packages hold the distinction.
`@orkestrel/ollama` drives a real Ollama daemon through a `service` project, so a real service
answers it and it runs from `prepublishOnly`. `@orkestrel/mcp` measures its server against the
specification's own runner, `@modelcontextprotocol/conformance`, through a `conformance` project. It pins that runner as a development dependency and resolves it out
of `node_modules`, and the server the runner drives is one the fixture starts itself on a loopback
port, so the run drives nothing external and stays in `test`.

## Tests

- [`tests/src/core/Compiler.test.ts`](../tests/src/core/Compiler.test.ts) — the compile stages, the
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
- [`tests/src/core/constants.test.ts`](../tests/src/core/constants.test.ts) — the seeded rows named
  as a set, the floor form every shared table and this manifest carry, and the emitted TypeScript
  bound.
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
- [`tests/src/bin/CLI.test.ts`](../tests/src/bin/CLI.test.ts) — every verb driven in process
  through recording output handlers.
- [`tests/src/bin/helpers.test.ts`](../tests/src/bin/helpers.test.ts) — command-line reading, usage
  rendering, and the failure envelope.
- [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts) — the process entry point.
- [`tests/policy.test.ts`](../tests/policy.test.ts) — the syntactic coding and placement law over
  every source file.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — this guide's bijection with the barrels.

## See also

- [`guides/README.md`](README.md) — the concept and directory index.
- [`README.md`](../README.md) — the package front page.
- [`AGENTS.md`](../AGENTS.md) — the coding contract every generated workspace points at.
