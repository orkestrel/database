---
name: orkestrel-publish
description: Run an Orkestrel release from layer order to registry confirmation. Use when the user asks to publish a package, to run a fleet-wide release wave, or to recover a release that stalled at the npm approval, and follow it for the per-repository visit, the bump ruling, the layer preparation, the login approval, and the five-minute upload window.
---

# Publish an Orkestrel release

## Load authority

Read the current files in this order:

1. `AGENTS.md` and every applicable `.claude/rules/*.md` file.
2. `.agents/orchestration.md` § Publishing the fleet and § Long-running commands. Each named
   section binds every step here.
3. The reference the moment needs: [wave.md](references/wave.md) before visiting a repository,
   ruling on a bump, or preparing a layer; [window.md](references/window.md) before running
   `npm login` or any upload.
4. The live evidence: the registry's packument for every package in the round, each target's
   manifest, and the catalog table the contract names as the layer order.

The user's current instruction wins. The contract's § Publishing the fleet owns the credential
and authorization law; nothing here weakens it.

## The boundary with the contract

`.agents/orchestration.md` § Publishing the fleet binds every release, and this skill does not
repeat it. Read that section for the credential and approval law, the long-running-command
binding, the serialization of uploads, the tarball swap that serves a consumer whose dependency
has not published, what a bump obliges downstream, and where the layer order comes from.

This skill carries what an operator needs while a release is running: the per-repository visit,
the bump ruling, the preparation order, the login and approval mechanics, and the window.

Where the skill and the contract disagree, the contract wins. Report the drift instead of
following the skill.

## Run the release

1. **Name the round.** List the packages the release covers, and group them into layers by the
   contract's layer order.
2. **Take the registry evidence.** Read what the registry serves for every package in the round.
   Derive each pin from that reading, never from a local manifest.
3. **Visit each repository.** Run the visit in [wave.md](references/wave.md) in its stated order,
   in parallel slices of disjoint repositories, each slice serial inside itself.
4. **Rule on each package's bump.** Apply the triggers in [wave.md](references/wave.md). A package
   whose published surface did not move takes its re-pin, its gates, and a commit to `main`, and
   does not publish.
5. **Prepare the whole layer before authenticating.** Bump, re-pin, install, sweep the self-pins,
   run each package's own `prepublishOnly` to green, commit, and push. Every one of those steps
   happens outside the window.
6. **Reach the approval.** Follow [window.md](references/window.md), and launch the login chain
   only after the user signals they are at the keyboard.
7. **Spend the window.** Follow [window.md](references/window.md). Open the layer with one
   package, confirm its upload from the registry, then chase the remaining uploads back-to-back.
8. **Close the layer from the registry, then prepare the next.** A dependent's new pin cannot
   install until the version it names exists, so preparation and publication interleave and cannot
   be batched ahead.

Run that sequence for every layer, from the registry reading to the registry close. Refresh the
registry evidence between layers rather than carrying the previous round's reading forward.

## Accept the release

Completion requires:

- every package the round named has ended published at a registry-confirmed version, published on
  a later round with the reason recorded, or ruled as no bump with the evidence that ruled it;
- every obligation § What a bump obliges places on a published package's dependents has closed as
  that section requires;
- every tarball swap is restored per § Fixing a dependency before it publishes, and no target
  repository is left holding an uncommitted bump or an unpushed commit;
- every gate that proved a package ran outside the window and against the artifact that shipped.

Report the layers in publish order, each package with its registry-confirmed version, the bump
rulings and their evidence, the approvals the user granted, and anything still unpublished. End
with exactly one terminal line — `RELEASE: LANDED` when every package in the round has closed, or
`RELEASE: OPEN` with the packages that have not.
