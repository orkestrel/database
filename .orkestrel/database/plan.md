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
- **The paging wave is published.** The registry serves `@orkestrel/database` 0.0.24 (`5e1b08d`) and `@orkestrel/relation` 0.0.22 (`772c20d`), which pins database `^0.0.24`; each `main` holds its release commit. `@orkestrel/sqlite` 0.0.18 (`95e4408`) and `@orkestrel/indexeddb` 0.0.18 (`17e2a00`) are unchanged. Taverna adopts 0.0.24 in its own session, and its `load` readings return through the user.
- **The Node floor is 22.18.0**, scaffold's `MINIMUM_NODE_VERSION`. `designs/native.md`'s "Node 22.12.0" reads as 22.18.0. Database 0.0.24 and relation 0.0.22 carry the fleet's range `^22.18.0 || >=24.4.0`; the `>=22.12.0` in indexeddb's `engines` field is stale, and it takes the fleet's range in its coverage-wave release (`research/strategies-database.md` § 4).
- **Each repository adopts scaffold 0.0.135 and test 0.0.39 at its next release visit.** Database and relation pin scaffold `^0.0.134` and test `^0.0.38`; sqlite and indexeddb pin scaffold `^0.0.131` and test `^0.0.33`. The registry serves contract 0.0.23.
- **Agent's Q13, statistics for the IndexedDB planner, is ruled by DI3 and DI5:** the ranking is by rule, with no selectivity model, until a reading reopens it (`research/strategies-database.md` § 1, DI3 and DI5).
- **Scaffold's canon carries the native-first rule.** Its `.claude/rules/architecture.md` § System constraints has carried it since scaffold `c3fea9938`, and `AGENTS.md`'s minimal-API law points there.
- **The user's rulings of 2026-11-13 for the session after the paging wave:**
  - The order is § Open decisions, the coverage wave, the text wave, then the quality-and-performance units of § Sequence step 5.
  - A planner consultation rules each design question on evidence, and independent refuters verify each proposal ahead of a writer.
  - Publication runs on the user's one-time code, in one upload call that covers every release-ready repository of a wave in layer order.
  - The session lists, per wave, what each dependent outside these four repositories changes (§ Sequence step 4); the sessions that own those repositories make the change.
  - None of database, relation, sqlite, or indexeddb depends on `@orkestrel/toolbox`; toolbox may depend on them.
- **The open decisions are ruled** in `designs/native.md` § Addendum: the open decisions, from a `planner` consultation, two refuter rounds, and the probes it cites; three items wait on taverna's session (§ Open decisions).
- **Each repository carries scaffold 0.0.135**: database `9a053b9`, relation `2590be0`, sqlite `1e8b0db`; indexeddb adopts it when its writer returns. Every gate passes except one vendored `tests/config.test.ts` case that raises `ENOTDIR` on Linux, owed to scaffold.
- **Coverage wave, landed:** sqlite `12bca99`. In progress: the indexeddb rows (rangePrefix, the raising read, the index reconcile), and database's journal, batches, and contract cache.
- **Coverage wave, relation:** landed as relation `a1e6443`.
- **Coverage wave, database core:** the before-image journal, the batches, and the contract cache land in the commit that records this line, after one review round in two lanes and two closure checks.
- **The user's ruling of 2026-11-14:** after database, relation, sqlite, and indexeddb close, `@orkestrel/contract` joins the campaign, and the costs the coverage wave measured in it become units under the same canon, probes first: the object guard (about 3 µs per row, 41 to 45% of the SQLite batched cells), `parseEnum` (6.35 µs against 15 to 68 ns for a prebuilt `literalOf`), and `resolveField` (0.79 µs against 0.023 µs for `Reflect.get`).
- **Coverage wave, database SQLite completion:** the statement cache, `BEGIN IMMEDIATE`, the WAL default, statistics at a writable open, `pragma(name)`, the index reconcile, the rank order, the nested prefilters, `TOTAL`, the tripwire, and the SQLite bench file land in the commit that records this line, built against the sqlite candidate (`12bca99`, `44db024`) through an uncommitted tarball pin.
- **Coverage wave, database query door:** the query door, the ill-formed-text refusal, and the exported recorder land in the commit that records this line; the door stays derived from contract, whose cost unit landed as contract `e17de4b` (the one-condition door 13.9 to 4.0 µs against contract 0.0.23).
- **Coverage wave, database IndexedDB plans:** the access-path ranking, native order, paging, count, extremes, batched streams, the index reconcile at open, and the RECORD mapping land in the commit that records this line, built against the indexeddb candidate through an uncommitted tarball pin. Every database coverage unit has landed.
- **Coverage wave, database conformance:** the census rows the coverage units left open (catch-to-value blocks through contract, `isScalar` from contract guards, the emitter lifecycle, one failure-to-finding rule, the leaf pair's cloner import) land in the commit that records this line. A stated limit: `helpers.ts` still constructs `StreamPage`; it reopens with the next release that may change the read-scan chain's public signatures, or a design round that admits a position-carrier form.
- **Coverage wave, indexeddb:** landed as indexeddb `1c2d789`, with scaffold 0.0.135 (`047b06a`, `dd33924`) and the fleet's Node range (`31334c5`).
- **The user's ruling of 2026-11-14 on the query door's cost:** the door stays derived from `@orkestrel/contract`. Its compiled guards cost about 14.5 µs per one-condition read (+104.8% on a SQLite primary-key `records` read against 0.0.24, past the identical-sides spread), so the contract cost units move ahead of the coverage wave's release, and contract releases first in that wave.
- **The user's rulings of 2026-11-14 on contract's semantic round:** closed and tail-shaped objects refuse hidden and symbol keys, and the guard keeps the cost unit's gain (Fable 5.2 ruled the form: a split check and a learned key plan per closed-object guard); the database write door refuses a mistyped value (strict `admitValue`, every fault named); a door may repair lossless leaves only where its guide and tool description state that it does (toolbox `requireToolCall`, workflow `admitDefinition` and `admitPatch`), and scaffold's canon states that exception beside "never coerce".
- **Next:** finish the database coverage units (SQLite completion, the query door, the IndexedDB plans), then the contract cost units, then the release visit in layer order from contract.

## Sequence

1. **Paging wave.** Taverna's adoption of database 0.0.24, with its `load` readings re-measured against `research/intake.md`.
2. **Coverage wave**, released in layer order: `@orkestrel/indexeddb`, then `@orkestrel/sqlite`, then `@orkestrel/database`, then `@orkestrel/relation`.
   - **indexeddb:**
     - `rangePrefix` takes the exact successor;
     - the raising read on a non-record value, with invariant 7 of its guide rewritten;
     - its header comment;
     - the `RECORD` key naming from a back-to-back pair;
     - missing declared indexes created after the `upgrade` callback, with the definition check, in both modes.
   - **sqlite:** landed as `12bca99` (the pragma guards and the header comment).
   - **database:**
     - the contract compiled once per table, and the query door, the operand-class check, and the ill-formed-text refusal of the open-decisions addendum;
     - `StorageRecorder` exported, the tripwire and batch-commit instruments, and the bench files with wrapper-alone arms on both engines;
     - the IndexedDB plans of `designs/native.md` § 5: access-path ranking, `any`, `starts`, compound indexes, native order, paging and count, and batched streaming;
     - the before-image journal in place of `snapshot`;
     - the batches;
     - the SQLite completion of § 4 and the Addendum: the statement cache, `BEGIN IMMEDIATE`, a `journal_mode`-only WAL default with no busy-timeout default, `PRAGMA optimize = 0x10002` at a writable open, `pragma(name)`, the drop of undeclared indexes at open on both engines, the rank expression for a column that is both optional and nullable, the integer `sum` as `TOTAL`, and the pragma guards at the driver's doors;
     - the IndexedDB driver's `RECORD` mapping and its drop of undeclared indexes, in the IndexedDB plans unit.
   - **relation:**
     - `link` and `unlink` as one insert and one delete;
     - primary-key loads through `get(keys)`;
     - its guide's two deferrals replaced by stated limits, per `research/strategies-database.md` § 4.
3. **Text wave.** The design round of `designs/native.md` § 6, with taverna's search requirement read first, then one `@orkestrel/database` release.
4. **At each wave's adoption, the dependents' sweep** of `designs/native.md` § 8 ("What each dependent changes") runs over agent, middleware, queue, relation, supervisor, taverna, terminal, toolbox, worker, workflow, and workspace. Each hit changes in the release that adopts the wave.
5. **Quality and performance**, in the fresh session. The units of `research/strategies-database.md` § 3 that no wave holds, and the patterns of `research/strategies-agent.md` § 3. In this order:
   1. the remaining units of `research/strategies-database.md` § 3, each with its reading against `tenets.md`; the bench files and instruments moved into the coverage wave, and `validatePragmas` at construction meets the `pragmas` check at open.

## Open decisions

`designs/native.md` § Addendum: the open decisions rules every decision but the three taverna's session holds:

- the taverna commit, data slice, and Node version to pin as the real client;
- taverna's IndexedDB reads, which decide whether the residual units of `research/strategies-database.md` § 3 take a consumer bar or a recorded stop, and whether the text wave builds an IndexedDB token store;
- taverna's search requirement, which opens the text wave.

## Refused, with triggers

Each row is refused under scaffold's creation gate, which creates a capability with its first real consumer. Its trigger reopens it, and this campaign owns it (tenet A-D5).

- **Unique indexes and references.** The trigger is a consumer that declares one (`designs/native.md` § 8). They then join the next wave.
- **Typed loaded relations** in `@orkestrel/relation`. The trigger is a consumer that narrows a loaded relation property by hand (`research/strategies-database.md` § 4).

## Handed on

- **Write-cascades** go to the unique-index and references row. Under native-first, a cascade is the engine's `ON DELETE` on SQLite and a check inside the transaction on IndexedDB (`research/strategies-database.md` § 4).
