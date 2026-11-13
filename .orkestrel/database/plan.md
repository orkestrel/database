# Campaign: native first, then quality and performance

**Goal.** Bring `@orkestrel/database`, `@orkestrel/relation`, `@orkestrel/sqlite`, and `@orkestrel/indexeddb` to the user's native-first rule, then raise their quality and performance under `tenets.md`.

The package is one API over SQLite and IndexedDB. Each driver answers every part of a read or write with its engine's native operation wherever the engine has one. The core runs its own logic only over the residual a driver cannot answer, and never where a native path exists. Where a package must build its own mechanism, the mechanism follows the tenets drawn from the Agent campaign.

**Exit criterion.**

- The three waves of `designs/native.md` § 8 are released and pushed, with each wave's acceptance readings recorded in its closing commit.
- Taverna adopts the paging wave, with its `load` readings re-measured against `research/intake.md`.
- The quality-and-performance units of § Sequence step 4 are each released with their readings.

## Repositories

- `@orkestrel/database`: https://github.com/orkestrel/database. It holds the contract, the core, and the SQLite and IndexedDB drivers.
- `@orkestrel/indexeddb`: https://github.com/orkestrel/indexeddb.
- `@orkestrel/relation`: https://github.com/orkestrel/relation.
- `@orkestrel/sqlite`: https://github.com/orkestrel/sqlite.

## Governing skills

- `orkestrel-harden` governs each implementation unit.
- `orkestrel-falsify` governs each wave's review round.
- `orkestrel-publish` governs each release and each consumer's adoption.

## State

- **2026-11-13: the design is ruled** (`designs/native.md`). The user assented to all six behavior decisions in its § "Decisions that need the user's assent":
  - a nonconforming stored row raises on read;
  - text order is the engine's binary order;
  - `like` folds ASCII only, and `_` and `?` match one code point;
  - ties follow the final order term's direction;
  - `sum` and `average` use the engine's arithmetic;
  - a batch applies all rows or none.
- **Taverna's six points are ruled** in `designs/native.md` § Addendum.
- **The paging wave's units:**
  - landed as Contract `9684cf6`, Core `ca7e133`, SQLite `f95d4db`, IndexedDB port `211c36c`, and Prose `195570f`, plus the `matchesMember` rename `a592a5b`;
  - one independent review round failed two claims and found four further defects;
  - the fix round landed as `e07fb1d` (code and tests) and `b43edc4` (the guide's "Migrating from 0.0.23" section, the consumer handover);
  - a focused re-check failed the pragma denylist and the migration list, and found the fallback detector reached only `records` and `count`; the second fix round landed as `9032fcd` (the `PRAGMA_NAMES` allowlist, the complete migration list, and controls for `stream`, the numeric aggregates, and a partial fallback); a closure check confirmed each row;
  - the readings at 2000 rows with 1500 matching and a page of 10 are asserted in `tests/src/server/drivers/SQLiteDriver.test.ts` § "native-first paging readings";
  - a page reads 10 rows, `count` is one aggregate with zero rows, and a read inside `transaction` never scans.
- **The user's rulings of 2026-11-13, after the design:**
  - `@orkestrel/indexeddb` raises a typed error naming the store and the key on a stored value that is no record, in place of skipping it (`research/strategies-database.md` § 4).
  - The SQLite pragma name and value check moves into `@orkestrel/sqlite`, which builds the pragma text. That gives sqlite a functional release in the coverage wave, which also carries its header comment.
  - Full-text search belongs to `@orkestrel/database` (`designs/native.md` § 6). Taverna cancels its own word-index unit and is the text wave's first consumer.
  - No release ships for prose alone.
  - The quality-and-performance work runs in a fresh session on another machine, after these packages' current releases are published. This folder is that session's whole briefing: it cites only tracked files, commits, and published URLs.
- **The Node floor is 22.18.0**, scaffold's `MINIMUM_NODE_VERSION`. `designs/native.md`'s "Node 22.12.0" reads as 22.18.0. The `>=22.12.0` in the `engines` field of database, indexeddb, and relation is stale, and each takes the fleet's range in its next functional release (`research/strategies-database.md` § 4).
- **Agent's Q13, statistics for the IndexedDB planner, is ruled by DI3 and DI5:** the ranking is by rule, with no selectivity model, until a reading reopens it (`research/strategies-database.md` § 1, DI3 and DI5).
- **Scaffold's canon carries the native-first rule.** Its `.claude/rules/architecture.md` § System constraints has carried it since scaffold `c3fea9938`, and `AGENTS.md`'s minimal-API law points there.
- **Next:** the paging wave's release preparation as database 0.0.24, then its publication on the user's code, then taverna's adoption.

## Sequence

1. **Paging wave.** One `@orkestrel/database` release: release preparation, publication, and taverna's adoption. Taverna's `lines-c` waits on it.
2. **Coverage wave**, released in layer order: `@orkestrel/indexeddb`, then `@orkestrel/sqlite`, then `@orkestrel/database`, then `@orkestrel/relation`.
   - **indexeddb:**
     - `rangePrefix` takes the exact successor;
     - the raising read on a non-record value, with invariant 7 of its guide rewritten;
     - its header comment.
   - **sqlite:**
     - the pragma name and value check;
     - its header comment.
   - **database:**
     - the IndexedDB plans of `designs/native.md` § 5: access-path ranking, `any`, `starts`, compound indexes, native order, paging and count, and batched streaming;
     - the before-image journal in place of `snapshot`;
     - the batches;
     - the SQLite completion of § 4 and the Addendum: the statement cache, `BEGIN IMMEDIATE`, a `journal_mode`-only WAL default with no busy-timeout default, `PRAGMA optimize`, `pragma(name)`, the drop of undeclared indexes at open, and the rank expression for a column that is both optional and nullable.
   - **relation:**
     - `link` and `unlink` as one insert and one delete;
     - primary-key loads through `get(keys)`;
     - its guide's two deferrals replaced by stated limits, per `research/strategies-database.md` § 4.
3. **Text wave.** The design round of `designs/native.md` § 6, with taverna's search requirement read first, then one `@orkestrel/database` release.
4. **At each wave's adoption, the dependents' sweep** of `designs/native.md` § 8 ("What each dependent changes") runs over agent, middleware, queue, relation, supervisor, taverna, terminal, toolbox, worker, workflow, and workspace. Each hit changes in the release that adopts the wave.
5. **Quality and performance**, in the fresh session. The units of `research/strategies-database.md` § 3 that no wave holds, and the patterns of `research/strategies-agent.md` § 3. In this order:
   1. the bench files and the round-trip recorder on both engines, because every later unit's acceptance reads them (DM1, DM6, A-M1, A-P12);
   2. the check on every `pragmas` entry at open;
   3. the remaining units, each with its reading against `tenets.md`.

## Open decisions

The fresh session rules these first.

- **The release bar.** It is the candidate list in `research/strategies-agent.md` § 4 Q1, plus this side's consequence: a read that runs the core engine on an engine that has the native operation.
- **The differential's classes**, the bars and their baselines, the real client, and the recorder's home: `research/strategies-agent.md` § 4 Q2, Q3, Q8, and Q9.
- **A bound on an `any` list and on an include's result,** or a stated limit (Q7).
- **Whether `SQLITE_LOCKED` gains its own code** (Q11).
- **Which assumptions of the residual path get a mutation** (Q12).
- **The run-settled questions** of `research/strategies-database.md` § 5:
  - the floor engine's SQLite version, FTS5, and `PRAGMA optimize` on Node 22.18.0;
  - unpaired surrogates;
  - an unversioned IndexedDB database with a dropped index declaration;
  - taverna's IndexedDB reads.

## Refused, with triggers

Each row is refused under scaffold's creation gate, which creates a capability with its first real consumer. Its trigger reopens it, and this campaign owns it (tenet A-D5).

- **Unique indexes and references.** The trigger is a consumer that declares one (`designs/native.md` § 8). They then join the next wave.
- **Typed loaded relations** in `@orkestrel/relation`. The trigger is a consumer that narrows a loaded relation property by hand (`research/strategies-database.md` § 4).

## Handed on

- **Write-cascades** go to the unique-index and references row. Under native-first, a cascade is the engine's `ON DELETE` on SQLite and a check inside the transaction on IndexedDB (`research/strategies-database.md` § 4).
