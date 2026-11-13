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
- Taverna's six points are ruled in `designs/native.md` § Addendum. The paging wave gains the primary-key pin (unary `+` on the other conditions when an `any` is on the primary key), native `equals`/`any` on optional and nullable columns, and the empty-residual invariant. The coverage wave gains the `journal_mode`-only WAL default with no busy-timeout default, `PRAGMA optimize` at close and open, `SQLiteDriverInterface.pragma(name)`, and the drop of undeclared indexes at open.
- Taverna's tests import `matchesQueryExactly` and `compileQuerySQL`. The paging release renames `matchesQueryExactly` to `planSQLiteQuery(input, schema)` and keeps `compileQuerySQL` with changed SQL text (§ Addendum); the handover names both.
- The paging wave's Core unit also makes the core engine's `any` and `none` linear in rows: `matchesCondition` builds one `Set` of a condition's scalar values per condition and keeps `equalsValue` for a non-scalar value (taverna's `native-b` reading, 2026-11-13: an `id any` over 1000 keys on a fixture driver ran rows × keys, and two book cases went from about 1 s to 14-17 s). This is the residual engine's own cost; the native path is unchanged.
- 2026-11-13: the paging wave's units landed: Contract `9684cf6`, Core `ca7e133`, SQLite `f95d4db`, IndexedDB port `211c36c`, Prose `195570f`, and the `matchesMember` rename `a592a5b`. Their acceptance readings at 2000 rows, 1500 matching, and a page of 10 are asserted in `tests/src/server/drivers/SQLiteDriver.test.ts` § "native-first paging readings". A page reads 10 rows, `count` is one aggregate with zero rows, and a read inside `transaction` never scans.
- Scaffold's `.claude/rules/architecture.md` § System constraints carries the native-first rule as of scaffold `c3fea9938`; the guide no longer cites the scan-first default.
- The `@orkestrel/sqlite` and `@orkestrel/indexeddb` header comments still state the scan-first default. The coverage wave corrects indexeddb's in its `rangePrefix` release. Sqlite's comment rides its next functional release; by the user's ruling of 2026-11-13, no release ships for a comment alone.
- Next: the paging wave's review round, then its release.

## Sequence

1. **Paging wave**, one `@orkestrel/database` release: the Contract, Core, SQLite, IndexedDB-port, and Prose units of `designs/native.md` § 8, then one independent review round, then the release. Taverna's `lines-c` waits on it.
2. **Coverage wave**: `@orkestrel/indexeddb` (`rangePrefix`), then the IndexedDB plans, the journal, the batches, and the SQLite completion in `@orkestrel/database`, then `@orkestrel/relation`, each released in that layer order.
3. **Text wave**: the design round of `designs/native.md` § 6, then one `@orkestrel/database` release.

## Deferred

- Unique indexes and references join the wave that follows their first consumer (`designs/native.md` § 8). The trigger is a consumer that declares one. The owner is this campaign.
- The dependents' sweep (`designs/native.md` § 8, "What each dependent changes") runs at each wave's adoption: agent, middleware, queue, relation, supervisor, taverna, terminal, toolbox, worker, workflow, and workspace.
