# Campaign: native first

**Goal.** Bring `@orkestrel/database` and its drivers to the user's native-first rule (2026-11-13). The package is one API over SQLite and IndexedDB. Each driver answers every part of a read or write with its engine's native operation wherever the engine has one. The core runs its own logic only over the residual a driver cannot answer, and never where a native path exists. The rule is stated in the guide, in the driver contract's TSDoc, and in the driver contract's shape.

**Exit criterion.** The three waves of `designs/native.md` § 8 are released and pushed. Each wave's acceptance readings are recorded in its closing commit, and taverna adopts the paging wave with its `load` readings re-measured against `research/intake.md`.

## Repositories

- `@orkestrel/database`: https://github.com/orkestrel/database, which holds the contract, the core, and the SQLite and IndexedDB drivers.
- `@orkestrel/indexeddb`: https://github.com/orkestrel/indexeddb, the coverage wave's `rangePrefix` unit.
- `@orkestrel/relation`: https://github.com/orkestrel/relation, the coverage wave's relation unit.
- `@orkestrel/sqlite`: https://github.com/orkestrel/sqlite, with no functional change in any wave (`designs/native.md` § 8).

## Governing skills

- `orkestrel-harden` governs each implementation unit.
- `orkestrel-falsify` governs each wave's review round.
- `orkestrel-publish` governs each release and the consumers' adoption.

## State

- 2026-11-13: the design is ruled (`designs/native.md`). The user assented to all six behavior decisions in its § "Decisions that need the user's assent":
  - a nonconforming stored row raises on read;
  - text order is the engine's binary order;
  - `like` folds ASCII only, and `_` and `?` match one code point;
  - ties follow the final order term's direction;
  - `sum` and `average` use the engine's arithmetic;
  - a batch applies all rows or none.
- Open: taverna's six points in `research/intake.md` § Message 3 need an addendum to the design before the SQLite paging unit starts. Points 2 and 3 bear on the paging wave: an optional column's `equals`/`any`, and an `any` list past the bound-parameter limit.
- Taverna's tests import `matchesQueryExactly` and `compileQuerySQL`. The design moves the exactness predicates to the planner exports (`designs/native.md` § 8, "What each dependent changes"), so the paging release's handover names each rename.
- Next: the design addendum for § Message 3, then the paging wave's Contract and Core unit.

## Sequence

1. **Paging wave**, one `@orkestrel/database` release: the Contract, Core, SQLite, IndexedDB-port, and Prose units of `designs/native.md` § 8, then one independent review round, then the release. Taverna's `lines-c` waits on it.
2. **Coverage wave**: `@orkestrel/indexeddb` (`rangePrefix`), then the IndexedDB plans, the journal, the batches, and the SQLite completion in `@orkestrel/database`, then `@orkestrel/relation`, each released in that layer order.
3. **Text wave**: the design round of `designs/native.md` § 6, then one `@orkestrel/database` release.

## Deferred

- Unique indexes and references join the wave that follows their first consumer (`designs/native.md` § 8). The trigger is a consumer that declares one. The owner is this campaign.
- The dependents' sweep (`designs/native.md` § 8, "What each dependent changes") runs at each wave's adoption: agent, middleware, queue, relation, supervisor, taverna, terminal, toolbox, worker, workflow, and workspace.
