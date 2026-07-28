# Fleet alignment

## Verify live state

For every relevant repository, record:

- local package name/version;
- branch and relation to `origin/main`;
- dirty paths and owning session;
- declared and resolved `@orkestrel/*` dependencies, peers, and dev dependencies;
- vendored guide freshness;
- supported runtime and package environments;
- local gate/package state.

Use npm, git, manifests, lockfiles, installed packages, canonical guides, and current scaffold authority. Do not copy a package catalog or burned-version list into this skill.

For `0.0.x`, verify the actual range behavior rather than assuming ordinary caret semantics. Record exact intended ranges and resolved versions.

## Build the dependency plan

Produce:

1. the transitive blast radius grouped by dependency layer;
2. a table of each required range/guide/consumer change;
3. topological implementation and local-verification order;
4. explicit shared files and serial integration points;
5. per-repository acceptance criteria;
6. risks from dirty branches, incompatible runtimes, live-service requirements, or conflicting sessions.

Keep one authoritative session per package. Re-establish live state before acting because another session may have moved it.

## Validate local packages

When a dependent must verify a local package:

- build the dependency;
- consume its built artifact only in an isolated or explicitly authorized consumer;
- prove every relevant resolution points to the intended artifact;
- run the dependent's targeted then final local gates;
- restore temporary overrides, manifest edits, and lockfile state.

Do not treat an undeclared source-checkout import as consumer proof.

## Align guides and verification

Refresh dependency guides through the current scaffold workflow when the owning repository and scope permit it. Report drift rather than hand-editing a vendored guide whose canonical source lives elsewhere.

Run package-local verification from dependencies to dependents. A passing lower package does not prove its consumer; a passing consumer does not replace lower-package invariants.

Report the verified dependency order, guide state, and remaining campaign risks.
