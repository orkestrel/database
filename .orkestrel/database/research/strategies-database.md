# Strategies the database campaign hands to the database family

The native-first campaign replaced a scan-first core, and every pattern here comes from that replacement. The cost was never a slow loop. It was a contract that hid what each engine can answer: a page that never reached the driver, a count that read every row, a gate that sent a whole query to JavaScript for one clause, and a transaction scope that held no read member. The repair made the split a return value, `plan`, so that the residual is the only source of core work and a test can read it. The mistakes that followed were all of one kind: an instrument or a proof that could not see the path it claimed. A differential ran a copy of the read procedure, a recorder stopped at the driver boundary, a planner assumed a connection setting it never checked, and browser counts were derived by hand. This file states the campaign's patterns as tenets for `database`, `relation`, `sqlite`, and `indexeddb`. It meets the Agent session's file, [record: agent strategies-for-database.md], and cites an Agent pattern where one covers the ground.

## Marks and verification

- **[fact]** I read the line's content in this consultation: a tracked campaign record, or source at a named commit.
- **[record]** The line comes from a distillate, a brief, or a taverna record I did not reread at its source. It names its carrier.
- **[inference]** The line is a tenet, a proof form, or a generalization with no run of its own. A **Tenet** or **Proof** line with no mark is [inference].
- **`A-N1`** names pattern N1 of the Agent file. Ids here carry a group letter after `D` (`DN`, `DP`, `DR`, `DT`, `DW`, `DI`, `DM`, `DV`, `DA`), because the Agent file already holds `D1` to `D7`.
- **Short names.** `native`, `plan`, `audit`, and `intake` are `designs/native.md`, `plan.md`, `research/audit.md`, and `research/intake.md` under `database/.orkestrel/database/`. A source path is relative to its package checkout.
- [fact] I ran no test, probe, build, or gate. I ran read-only git commands (`log`, `status`, `diff --stat`, `show`) and read-only text searches in the checkouts of the family's packages.
- [fact] **The database checkout held an uncommitted fix round when I read it** (2026-11-13). `git status` listed modified files under `src/`, `tests/`, and `guides/`, and HEAD was `e291d39`. The working tree already carried `REFUSED_PRAGMAS` with `case_sensitive_like` (`src/server/constants.ts`), `Table.ts` importing `readPlannedRows` and `readPlannedAggregate`, and the renamed helpers. I checked those markers and no other row of the fix brief.
- [fact] Every database line number here is a line of commit `e291d39`, read through `git show`. The fix round moves them.
- [fact] I checked these citations of the code map against `e291d39` and each holds: `src/core/Table.ts:157-190`, `:358-364`, `:369-398`, `:404-422`, `:430-440`; `src/server/helpers.ts:264-297`; `src/server/drivers/SQLiteDriver.ts:162-164`, `:493-506`; `src/browser/drivers/IndexedDBDriver.ts:244-270`, `:512-529`, `:687-697`; `tests/setup.ts` `StorageRecorder`; the `describe` blocks "native-first paging readings", "EXPLAIN QUERY PLAN of the native plan", and "operator, storage, and flag matrix against the core engine" in `tests/src/server/drivers/SQLiteDriver.test.ts`.
- [fact] I checked these outside database, each at its release commit with a clean tree: `indexeddb/src/browser/helpers.ts:129-158` and `:247-250`; `indexeddb/guides/indexeddb.md:252`; `relation/src/core/Model.ts:206-279`; `relation/guides/relation.md:150`; `sqlite/src/server/SQLiteDatabase.ts:87-97` and `:146-149`; `sqlite/guides/sqlite.md:128` and `:310`; each package's `engines` field; `scaffold/src/core/constants.ts:706`.
- [fact] The database commits I cite are in the checkout's log: `f9c07b1`, `43bae7a`, `3d71bc7`, `9684cf6`, `ca7e133`, `f95d4db`, `211c36c`, `195570f`, `a592a5b`, `9831f94`, `e291d39`.
- **Unverified.** Every taverna reading (`load.md`, `native-a.md`, `native-b.md`, `drivers.md`), `db-readings-before.txt`, the canon line numbers in the canon distillate, and every Agent commit. I read no review verdict file; the review's findings reach this file only through [record: scaffold fix-db-paging.md].
- [inference] A reconciled tenet file can cite tracked carriers only. The scratch records of the scaffold and taverna sessions are git-ignored. Where a line's only carrier is one of them, the reconciler retargets it to the fix round's commit after that round lands, or drops it. Reconciled 2026-11-13: the fix round landed as database `e07fb1d` (code and tests) and `b43edc4` (the guide's "Migrating from 0.0.23" section); the line numbers cited at `e291d39` move by those commits.

## 1. The patterns

### Native first

#### DN1. The engine answers, and the core runs only the residual

- **Learned.** [fact] The user's rule of 2026-11-13: the package "prefers and defaults to each driver's native abilities, and supplies its own logic only to fill a gap that driver's engine cannot cover", and "Custom logic never runs where the native path exists, because it will never be as fast" (`intake:33-36`).
- **Evidence.** [fact] `native` § 1; database `9684cf6` and `ca7e133`. [fact] `plan:33`: scaffold's system-constraints rule carries it as of scaffold `c3fea9938`. [fact] The fix brief orders two residual cases compiled natively and says "do not write an exception into the rule" (`fix-db-paging.md:14`, a scratch carrier).
- **Tenet.** A driver returns a clause as residual only when its engine has no operation with the contract's meaning. A core pass on an engine that has the operation is a defect, and its repair is the native form.
- **Proof.** A recorder reading per read class: with an empty residual, zero `scan` calls and zero `stream` calls, beside DM3's assertion beneath the driver. A-N1's mutation applies.

#### DN2. The contract takes the engine's semantics

- **Learned.** [fact] Native coverage on SQLite required the contract to state text order, `like` folding, the single-character wildcard, tie direction, and `sum` and `average` arithmetic as the engine has them, and the core engine changed to match (`native` § 2, "Semantics the rule fixes").
- **Evidence.** [fact] The user's assent, `plan:22-28`. [fact] `native:164-171` rejects one canonical text order and a Unicode fold in `like`, because SQLite's `LIKE` "is neither a superset nor a subset" of that fold.
- **Tenet.** Where an engine's semantics differ from the core's, the contract takes the engine's and the core engine changes to match, or the contract names the per-engine difference. No JavaScript emulation stays on an engine to hold one canonical meaning.
- **Proof.** The differential's exemption class names the one per-engine difference, and the matrix of DV2 covers every other cell.

#### DN3. A fallback names the engine it serves

- **Learned.** [fact] "The package's fallback serves only the engine that lacks the ability" (`intake:35`). `native` § 2 rules each clause per engine, and `native:221` lists the fallback the core runs for IndexedDB alone.
- **Evidence.** [record] Under the 0.0.23 gate, taverna's census read 574 queries, 417 exact and 157 inexact ([record: taverna native-a.md]).
- **Tenet.** Each residual clause sits in the coverage table beside the engine that lacks it and the reason. A clause residual on SQLite carries an engine reason, such as a nested path or a `json` column.
- **Proof.** A plan census over the conformance reads per driver: the residual clauses equal the coverage table's rows for that engine.

#### DN4. Read the wrapper's surface ahead of writing logic

- **Learned.** [fact] The audit's "Native unused" column: `getAll(range, count)`, `count(range)`, cursor `advance`, a keyed read of many keys in one transaction, and `rangePrefix` existed in `@orkestrel/indexeddb`, and the driver called none (`audit:72-79`).
- **Evidence.** [fact] At `e291d39`, `#candidates` reads `store.records(plan.range)` with no count (`src/browser/drivers/IndexedDBDriver.ts:687-697`). [record] The code map found no `count` and no cursor call in that file.
- **Tenet.** A unit in `database` names the wrapper member and the engine primitive it read ahead of adding logic. A-N2 covers the `@orkestrel` census.
- **Proof.** The unit's record names the member, and the recorder reading shows its call.

### Planner and residual

#### DP1. The plan is a return value, split per clause

- **Learned.** [fact] The 0.0.23 gate sent a whole query to a JavaScript scan when one clause was inexact (`audit:70`, `intake:42`). [fact] `planSQLiteQuery` splits an all-`and` list per condition and sends an `or` fold whole to one side (`src/server/helpers.ts:264-297`).
- **Evidence.** [fact] `9684cf6`, `f95d4db`. [fact] `native:167` rejects optional hooks with the fallback inside each driver: "It hides the residual, so no test can assert that a native path was taken."
- **Tenet.** Every driver that answers any clause natively declares `plan`. No driver decides a fallback inside a hook. Coverage is decided per clause from the operator, the column's storage and flags, and the indexes.
- **Proof.** `findPlanFaults` inside `scanDriver`, over the conformance reads.

#### DP2. One checker holds the plan invariants, and an empty side is `{}`

- **Learned.** [fact] `native` § 2 lists the invariants and its Addendum adds the empty side. [fact] `Table.records` tests `Object.keys(residual).length === 0` (`src/core/Table.ts:169`).
- **Evidence.** [fact] `native:90-97`, `native:461`.
- **Tenet.** A page is native only when the residual holds no condition and no order. An aggregate is native only when the residual holds no condition. `order` goes whole to one side. An `or` fold is residual-empty or residual-complete. A clause a side does not hold is an absent key. A change that adds a plan class adds its invariant to the checker.
- **Proof.** One mutation per invariant inside a planner, each failing `scanDriver`.

#### DP3. One read procedure serves `Table` and the differential

- **Learned.** [fact] `readPlannedRows` and `readPlannedAggregate` duplicated `Table`'s procedure, so the conformance differential never ran `Table.#select` or `#compute` (`fix-db-paging.md:21`).
- **Evidence.** [fact] At `e291d39`, `Table.#select` and `#compute` are private bodies of their own (`src/core/Table.ts:369-422`). The uncommitted fix round has `Table` call the shared functions.
- **Tenet.** A-C3 governs: one implementation of the plan procedure, called by `Table` and by the conformance check.
- **Proof.** A mutation inside the shared procedure fails a `Table` test and the differential together.

#### DP4. Each precondition of the residual procedure is named and pinned

- **Learned.** [fact] The core's early exit depends on `stream` honoring `order` (`native:109`). [fact] At `e291d39`, the IndexedDB `#stream` reads no `input.order` (`src/browser/drivers/IndexedDBDriver.ts:512-529`), which the review found (`fix-db-paging.md:18-19`).
- **Evidence.** [fact] `native:92`: a condition on both sides is a prefilter, "the engine applies a superset form and the core rechecks it". [fact] `rangePrefix` closes at `value + '￿'` and drops a longer string (`indexeddb/src/browser/helpers.ts:247-250`, `native:31`).
- **Tenet.** The residual procedure rests on stated preconditions: `stream` honors `order`, a prefilter is a superset, and a successor bound is exact. Each has a test per driver that fails when the precondition is false. A-P8 and A-Q12 cover the method.
- **Proof.** A fixture that violates each precondition, shown failing.

#### DP5. The planner's assumptions bind the connection

- **Learned.** [fact] `pragmas: { case_sensitive_like: 'ON' }` was applied unchecked (`src/server/drivers/SQLiteDriver.ts:162-164`) while the planner ruled every text `like` native. The reviewer's probe returned `["b"]` natively and `["a","b"]` through the residual (`fix-db-paging.md:13`).
- **Evidence.** [fact] The wrapper interpolates a pragma's name and value into SQL text (`sqlite/src/server/SQLiteDatabase.ts:146-149`).
- **Tenet.** Every option that reaches the engine is ruled against what the planner assumes. The driver refuses a setting that changes the meaning of an operator a plan keeps native, and names the key and the reason.
- **Proof.** A census of the options that reach the engine, each row ruled, and a refusal test per refused key that is red on the tree without the refusal.

### The read path

#### DR1. The read guard asserts and never filters

- **Learned.** [fact] The 0.0.23 guard filtered rows, so `records` could not page and `count` could not count, and `aggregate('count')` was already unguarded (`audit:91-103`).
- **Evidence.** [fact] The user's assent to a raising read (`plan:23`); `native` § 3. [fact] `Table.records` maps each returned row through `#assert` (`src/core/Table.ts:170-171`).
- **Tenet.** No layer drops a row on a read: `Table`, a driver's decode, or a wrapper. A stored row that fails its contract raises with the table and the key. The check costs one assertion per returned row. § 4 applies the tenet to `indexeddb`.
- **Proof.** A table holding one nonconforming row: `records` raises, and `count` equals the stored count.

#### DR2. Rows read follow the page

- **Learned.** [record] A page of 10 read 1501 rows, in two driver calls, on taverna's book slice (`intake:15`, [record: taverna load.md]).
- **Evidence.** [fact] `plan:32`: at 2000 rows with 1500 matching, a page reads 10 rows, asserted in "native-first paging readings". [record] The 0.0.23 before reading was `records=1/1500`.
- **Tenet.** Each public read states its rows-read bound in `N` (table), `M` (matching), `P` (page), and `K` (keys), and a recorder test asserts it. A-P10 and A-P12 cover the form.
- **Proof.** The recorder's rows per member against `P` and `K`.

#### DR3. One counting path

- **Learned.** [fact] `Table.count` and `aggregate('count')` disagreed by design in 0.0.23 (`audit:103`). `native:169` rejects a separate `count` hook: "another path is another place to disagree."
- **Evidence.** [fact] `Table.#compute` serves both (`src/core/Table.ts:404-422`).
- **Tenet.** One member answers one question. A count is the `count` aggregate and returns no row.
- **Proof.** The recorder reads one `aggregate` call and zero rows.

#### DR4. The residual exits early, and each buffer is named

- **Learned.** [fact] `#select` streams the native side and stops at `offset + limit` matches (`src/core/Table.ts:369-398`). A residual order buffers every match (`:180-187`), and a residual aggregate pushes every surviving row into an array (`:420-422`).
- **Evidence.** [fact] At `e291d39`, the IndexedDB driver loads the whole candidate range ahead of the page (`src/browser/drivers/IndexedDBDriver.ts:512-529`, `:687-697`).
- **Tenet.** The residual is one pass that stops when the answer is complete. A buffer of every match exists only for a residual order, and its retained rows are a stated bound. A-P10 and A-P13 cover the form.
- **Proof.** Retained rows read against `offset + limit` and against `M`, per plan class.

#### DR5. The residual engine prepares one time per read

- **Learned.** [record] An `id any` over 1000 keys on a fixture driver ran rows × keys, and two book cases went from about 1 s to 14 to 17 s (`plan:31`). [fact] `3d71bc7` builds one `Set` per condition.
- **Evidence.** [fact] `#select` calls `prepareScalars` ahead of its loop (`src/core/Table.ts:375`). [fact] At `e291d39`, the IndexedDB `#stream` calls `matchesQuery(row, conditions)` with no prepared set (`src/browser/drivers/IndexedDBDriver.ts:523`), which the review found (`fix-db-paging.md:20`).
- **Tenet.** Work that depends on the read and not on the row runs ahead of the row loop on every multi-row path. A census of the callers of the row matcher holds each to it.
- **Proof.** A bench at the input limit with a growth ratio at double size and a superlinear control that fails, per A-P9.

#### DR6. Decode raises, and a copy on a read path is measured

- **Learned.** [fact] SQLite's `decodeValue` returned `undefined` for a cell whose storage class missed its declaration, which passed the guard as an absent field (`native:180`).
- **Evidence.** [record] `decodeRow` runs per row, and a `json` cell pays `JSON.parse` and then `structuredClone` (code map, `src/server/helpers.ts:531`, `:637-646`). I did not read those lines.
- **Tenet.** A decode raises `DRIVER` with the table, the column, and the key. A copy on a read path stays only with its own measurement, per A-P7.
- **Proof.** A malformed cell raises, and a bench cell reads copies per `json` cell.

### Transactions and journals

#### DT1. The scoped capability mirrors every native member

- **Learned.** [fact] The 0.0.23 transaction capability held no `records`, `aggregate`, or `stream`, so every read inside `database.transaction` scanned (`audit:86`). [record] The before readings show each `tx-*` case at `scan=1/2000`.
- **Evidence.** [fact] `f95d4db`; `native:200`; `plan:32`: a read inside `transaction` never scans.
- **Tenet.** A member added to a driver is added to its transaction capability in the same change, and `scanDriver` asserts the mirror.
- **Proof.** Each acceptance reading repeats inside `transaction` with zero `scan` calls.

#### DT2. A scope takes its lock at the start, and a refusal surfaces

- **Learned.** [fact] A deferred `BEGIN` that reads and then writes can be refused with no wait. `BEGIN IMMEDIATE` moves the refusal ahead of any work (`native:203`, `native:365`). [fact] The Addendum rejects an awaited retry inside the driver as polling.
- **Evidence.** [record] Taverna's audit store lost 57 of 136 records as `BUSY` on a shared file and none after each store took its own file ([record: taverna load.md], taverna `f7238b2`). Its drain had discarded the refusal.
- **Tenet.** A write scope takes the engine's write lock at its start. A refusal is a typed error with `context.retryable`, and no layer of the family discards an engine fault or retries on a timer.
- **Proof.** Two drivers on one file and one thread: the waiting scope is refused at its start with no wait, and it completes after the holder settles.

#### DT3. A default trades nothing the application owns

- **Learned.** [fact] `native` § 4 recommended a 5000 ms busy timeout, and the Addendum withdrew it. A wait on the calling thread cannot advance a holder on that thread (`native:363`).
- **Evidence.** [fact] The probe on Node 22.23.5 and SQLite 3.54.1: a 400 ms timeout was refused after 526 ms, and no timeout in under 1 ms (`native:354`). [record] Taverna's arm with a 50 ms timeout lost the same records.
- **Tenet.** A driver default issues only an engine setting that trades nothing: `journal_mode` alone, never `synchronous`, and no timeout. A default is read on the supported shape, one driver per file, ahead of its adoption.
- **Proof.** `pragma('synchronous')` returns the same value with the default as on an unconfigured connection.

#### DT4. Rollback costs the keys touched

- **Learned.** [fact] The fallback snapshot read every row of every table per scope and rewrote them on rollback (`audit:86`, `audit:146-147`).
- **Evidence.** [fact] `native` § 5, Journal; `native:220` rejects buffering writes for one native commit, because the core would merge buffered writes into every read.
- **Tenet.** A scope on a driver without `transaction` journals the prior row of each key on its first touch. The touched set is derived from the scope, per A-C4. A stated limit names what the journal does not give: crash atomicity.
- **Proof.** A scope that writes `K` keys reads `K` prior rows and restores `K`, with zero `scan` calls.

#### DT5. Each multi-step read states its transaction boundary

- **Learned.** [fact] An IndexedDB transaction commits when control yields outside the request chain (`indexeddb/guides/indexeddb.md:318`), so a held cursor across a consumer's awaits is not an option (`native:218`).
- **Evidence.** [fact] `native` § 5, Streaming: one batch per transaction, resumed after the batch's final key.
- **Tenet.** A-C7 and A-P11 govern. Each batched stream, offset walk, and journal restore states where its transaction ends, and no yield sits inside one.
- **Proof.** A browser test with a write between two batches, and an abort between two batches that makes no later engine call.

### Writes and batches

#### DW1. A batch is one engine round trip and applies all rows or none

- **Learned.** [record] One commit per row wrote 303 rows a second, and one transaction per organization wrote 17,291 ([record: taverna load.md], `:361-365`).
- **Evidence.** [fact] `Table.#each` runs one driver call per element, with no rollback of earlier elements (`src/core/Table.ts:430-440`). [fact] The user's assent, `plan:28`.
- **Tenet.** A list overload reaches the driver as one call and one commit. Every member is validated ahead of the engine write, per A-C2.
- **Proof.** The recorder reads one driver call for `K` rows, and a batch with one conflicting row applies none.

#### DW2. A list binds as one parameter

- **Learned.** [fact] 0.0.23 bound one parameter per value, and the probed build refuses a statement past 32766 parameters. One `json_each` parameter ran a 40000-element list (`native:343`, `native:352`, `native:385`).
- **Evidence.** [fact] `f95d4db`.
- **Tenet.** A statement's text does not vary with a list's length. A-P4 covers the cache key this serves.
- **Proof.** One statement text across list lengths, and a list past the parameter limit that returns.

#### DW3. The engine's conflict answer is the fact

- **Learned.** [fact] `link` counts and then writes, and `unlink` reads and then removes per row (`relation/src/core/Model.ts:206-253`). Neither is atomic.
- **Evidence.** [fact] `native` § 7: a derived primary key, one `add`, and `CONFLICT` read as already linked.
- **Tenet.** A-N1 governs. A uniqueness or existence question that an engine constraint answers is asked by the write itself.
- **Proof.** Two concurrent `link` calls for one pair leave one row, and the recorder reads one insert.

#### DW4. A whole-set write cost is measured ahead of a mechanism

- **Learned.** [record] `JSONDriver` rewrites the whole document on each mutation (code map, `src/server/drivers/JSONDriver.ts:754-790`).
- **Evidence.** [record] Scaffold's method "Close a cost question without building an optimization" (`.agents/skills/orkestrel-harden/references/methods.md:111`).
- **Tenet.** A-P14 governs. No journal file or append log is built for `JSONDriver` without a consumer's reading.
- **Proof.** The reading and the recorded stop with its reopen trigger.

### Indexes and statistics

#### DI1. A native form is one an index can use

- **Learned.** [fact] `starts` compiled to `substr`, which no index serves (`audit:72`).
- **Evidence.** [fact] `native:198`: a range from the prefix to its successor. The `describe` "EXPLAIN QUERY PLAN of the native plan" exists at `e291d39`.
- **Tenet.** Each native form on an indexed column carries an `EXPLAIN QUERY PLAN` assertion that reports a search.
- **Proof.** That assertion, with a control form that reports a scan.

#### DI2. Pin the access path where the form hides a fact

- **Learned.** [fact] On a file with no `sqlite_stat1`, the `json_each` form searched the tenant index at 2, 50, and 2000 keys. The unary `+` on the other conditions kept the primary key (`native:346-349`).
- **Evidence.** [fact] `native:397-403`; `f95d4db`.
- **Tenet.** A plan is read on a file with no statistics as well as on an analyzed one. Where a compile form hides a fact from the engine's planner, the compiler restores the access path in the engine's own syntax, and the matrix runs the pinned forms.
- **Proof.** `EXPLAIN QUERY PLAN` for a short list and a long list, with and without `sqlite_stat1`.

#### DI3. Statistics are the engine's

- **Learned.** [fact] After `PRAGMA optimize`, the mis-planned reads moved to the selective index (`native:349`, `native:351`).
- **Evidence.** [fact] `native:405-411`: the call at open and at close, no timer, and no write counter.
- **Tenet.** The driver holds no selectivity model. It calls the engine's own analysis at open and close, and the application calls it after a bulk load. A-P1 and A-Q13 hold the same line for IndexedDB.
- **Proof.** A file grown from empty and closed holds `sqlite_stat1` at reopen.

#### DI4. The file's indexes equal the declaration

- **Learned.** [fact] An unversioned database kept every index a later declaration dropped (`native:441`).
- **Evidence.** [fact] `native:442-448` rejects a stored record of declared indexes: "a second fact that can drift from the file."
- **Tenet.** Open reconciles derived structures both ways from the declaration, and stores no record of them.
- **Proof.** A reopen with a dropped declaration lists the remaining index, with the rows unchanged.

#### DI5. IndexedDB takes one access path, by rule

- **Learned.** [fact] The 0.0.23 planner used one condition, gave `any` no plan, and never read a compound index (`audit:70`, `audit:82`).
- **Evidence.** [fact] `native:210-217`: the ranking, and the required-column rule, because an index holds no entry for a row that lacks the field.
- **Tenet.** The planner ranks candidates by a written rule and reads one index. An index drives `below`, `to`, an order, `minimum`, or `maximum` only on a required column, and a browser test proves the engine behavior the rule depends on.
- **Proof.** The rows-read reading per ranked class, in the browser project.

#### DI6. The application declares the indexes a relation needs

- **Learned.** [fact] A load by foreign key is an `any`, native on SQLite and index-driven on IndexedDB only when the application declares the index (`native:237`).
- **Evidence.** [fact] Without statistics, a read over two plain indexes plans through the less selective one (`native:351`, `native:410`).
- **Tenet.** The relation guide states the index each relationship needs, and a test reads the plan with the index and without it.
- **Proof.** `EXPLAIN QUERY PLAN` and the IndexedDB rows-read reading for each relationship.

### Measurement and instruments

#### DM1. Rows read is the first cost reading, on one recorder

- **Learned.** [fact] `native:248`: every unit's check uses one recording `StorageInterface`. [fact] `StorageRecorder` records the member, the rows returned, and whether the call ran inside a scope (`tests/setup.ts`).
- **Evidence.** [fact] The audit ranks its fixes by rows read (`audit:136`).
- **Tenet.** A unit's acceptance is a recorder reading in `N`, `M`, `P`, and `K` ahead of any timing. A-P12 adds the round-trip count.
- **Proof.** The recorder assertion per public operation.

#### DM2. The before reading is taken on the published build

- **Learned.** [fact] `native:258` orders the failing readings recorded on 0.0.23 ahead of the change.
- **Evidence.** [record] [record: database db-readings-before.txt], a scratch carrier. Its tracked form is `plan:32`.
- **Tenet.** A-V1 governs. The before reading names the published version, and the same command gives the after reading.
- **Proof.** Both readings by command.

#### DM3. The instrument reads beneath the boundary it claims

- **Learned.** [fact] A driver that falls back internally while returning a `{}` residual passed the `like` and optional-column `any` readings (`fix-db-paging.md:22`).
- **Evidence.** [fact] The recorder wraps `DriverInterface` members and holds no view of the wrapper.
- **Tenet.** A native claim carries an assertion beneath the driver: the statements the wrapper prepares or runs, or `EXPLAIN QUERY PLAN`. A-V4 governs the reach.
- **Proof.** The assertion shown red against an injected internal fallback.

#### DM4. The bar is the consumer's, read at scale, with the consumer's own term removed

- **Learned.** [record] Against taverna's 180 ms bar, a search page read 165.3 ms at the seed, 295.0 ms at one hundredth of the book, and 1448.7 ms at one tenth ([record: taverna load.md]). The audit-write share was 139.9, 145.6, and 180.1 ms, and the predicted fixed share fell.
- **Evidence.** [record] Scaffold `.claude/rules/quality.md:63`, `:65`, and `:67`.
- **Tenet.** A-P9, A-M3, A-M5, and A-M6 govern. For this family, a reading taken from a consumer carries an arm that removes the consumer's own cost, and the package's target is the remainder.
- **Proof.** The paired arms and the calibration with identical sides.

#### DM5. An engine fact is a probe reading with its versions

- **Learned.** [fact] Inline probes on Node 22.23.5 and SQLite 3.54.1 settled the parameter limit, the `json_each` plan, and the same-thread wait (`native:339-354`). [fact] `native:481-491` lists what stays unread, including a mask the author recalled and did not reread.
- **Evidence.** [fact] No probe file is kept (`native:339`).
- **Tenet.** A-D4 and A-C10 govern. A design line that depends on an engine capability cites a reading with its Node and SQLite versions, and a recalled fact stays under Unread. § 4 rules the floor those probes run on.
- **Proof.** The reading's row, and a kept probe where the reading gates a unit.

#### DM6. Each package carries a bench file its gates do not collect, with an assertion that can fail

- **Learned.** [fact] `git ls-files` finds no `*.bench.ts` in `database`, `sqlite`, `indexeddb`, or `relation`. [record] Each declares a `test:bench` script (the code map).
- **Evidence.** [record] Scaffold `.claude/rules/tests.md:125-141`.
- **Tenet.** A-M1 governs. A timing claim in this family has no instrument until its bench file lands, and two builds are compared with scaffold's `interleave.ts`.
- **Proof.** The bench file with its control.

### Proving

#### DV1. A differential against the core engine, with named exemptions

- **Learned.** [fact] `ca7e133` adds a differential of each planned driver against the core engine over `scan` (`native:257`).
- **Evidence.** [fact] The review brief asks whether the exemption is narrow: non-BMP text only (`review-db-paging.md:52`).
- **Tenet.** A-V3 governs. Each published per-engine difference is one named class with a pass rule written ahead of the run, and the remainder is empty.
- **Proof.** The class counts and a control that lands in the remainder.

#### DV2. A matrix of operator, storage, and flags

- **Learned.** [fact] The review found two cells left residual: a list holding `null` on a nullable column, and an `undefined` operand on an optional column (`fix-db-paging.md:14-17`).
- **Evidence.** [fact] The matrix `describe` exists at `e291d39`.
- **Tenet.** An operator added or moved native gains its cells, including a `null` operand, an `undefined` operand, a list holding `null`, and a column that is both optional and nullable.
- **Proof.** The matrix agrees with the core engine in each cell.

#### DV3. Red on the published behavior

- **Learned.** [fact] The review checks that each acceptance assertion fails on 0.0.23's behavior (`review-db-paging.md:51`), and the fix brief orders each row red on `a592a5b` and green after (`fix-db-paging.md:9`).
- **Tenet.** A-V1 governs.
- **Proof.** The command and counts on both trees.

#### DV4. Inject the fallback

- **Learned.** [fact] `fix-db-paging.md:22`: "Show it red against an injected internal fallback."
- **Tenet.** A-V2 governs. Each native path closes with a mutation that reroutes it through the core engine and a named failing assertion.
- **Proof.** Scaffold's `mutate.ts` receipt.

#### DV5. A browser claim is run in a browser

- **Learned.** [fact] The IndexedDB port's rows-read counts for the conformance reads were derived by hand from the 0.0.23 rule and not run in a browser (`review-db-paging.md:43`).
- **Evidence.** The review's verdict on that claim is unverified here.
- **Tenet.** An IndexedDB reading is a test in the browser project. A count derived by hand is an expectation and never a reading.
- **Proof.** The browser test's recorder output.

#### DV6. One independent round finds what the gates pass

- **Learned.** [fact] Every gate exited 0 (`review-db-paging.md:63`), and the review still failed claims on the core and on SQLite and found the pragma defect (`fix-db-paging.md:3`).
- **Tenet.** A-V6 and A-V7 govern: one round on numbered claims per wave, one fix round, and one closure check.
- **Proof.** The claims file and the verdict per claim.

#### DV7. A citation is checked at its commit

- **Learned.** [fact] The audit cited built files, and reading the TypeScript corrected it in the places `native:27-33` lists. A consult cited `relation` lines 622 and 639 in a file of 526 lines (`native:391`).
- **Tenet.** A ruling reads each cited line in source at the named commit, and a tracked record cites tracked carriers.
- **Proof.** The ruling's evidence section names the commit and the corrections.

### API and release

#### DA1. Rename and remove with no alias, and hand the consumer the list

- **Learned.** [fact] `matchesQueryExactly` became `planSQLiteQuery`, and taverna's tests import the old name (`plan:30`, `native:450-463`).
- **Evidence.** [fact] The fix brief orders one handover list of every rename and removal (`fix-db-paging.md:36-44`).
- **Tenet.** A-R3 governs the sweep. The release's handover names each renamed, removed, and behavior-changed export in one list a consumer adopts in one step.
- **Proof.** The list against a diff of the barrels.

#### DA2. A barrel holds capabilities, and a kind file holds helpers

- **Learned.** [fact] The paging units exported module helpers that the review folded or renamed: `matchesNativeOrder` and `matchesNativeAggregate` into `planSQLiteQuery`, `collectRows` replaced by `Array.fromAsync`, and `matchesNativeCondition` to `matchesSQLiteCondition` (`fix-db-paging.md:24-35`).
- **Tenet.** A helper with one caller folds into it. A name states its engine, never `Native`. Every public name keeps a barrel row and a guide row.
- **Proof.** The guide parity test and the export census.

#### DA3. A wrapper releases ahead of the database release that uses it

- **Learned.** [fact] `database` declares `@orkestrel/indexeddb` and `@orkestrel/sqlite` (`package.json`), and `plan:40` orders the coverage wave by layer.
- **Tenet.** A-R1 and A-R2 govern.
- **Proof.** The nested-copy listing after each install.

#### DA4. No release ships for prose alone

- **Learned.** [fact] Database `e291d39` and scaffold `7385f673f`. The `sqlite` and `indexeddb` header comments still state the scan-first default (`plan:34`).
- **Tenet.** A comment, TSDoc, or guide correction rides the package's next functional release, and the plan names which.
- **Proof.** The plan's line.

#### DA5. A change to published behavior needs the user's assent

- **Learned.** [fact] `native:299-310` lists each decision beside what stays in JavaScript without it, and the user assented to all (`plan:22-28`).
- **Tenet.** A design lists each published-behavior change with its consequence when refused, ahead of any unit that depends on it.
- **Proof.** The plan's dated assent.

#### DA6. One writer per checkout, and the plan follows the commits

- **Learned.** [fact] At my read, `plan` § State said the review round was next, while the fix round after that review sat uncommitted in the working tree.
- **Tenet.** A session reads `git status` in each checkout ahead of its first edit and starts no unit in a checkout that holds another writer's changes. A-R6 governs the order of ruling and unit.
- **Proof.** The log's order and a clean status at hand-off.

## 2. Anti-patterns

- **The all-or-nothing pushdown gate.** [fact] One inexact clause sent the whole query to a JavaScript scan. Caught by the audit's read of installed 0.0.23 (`audit:70`). [record] Taverna's census then counted 157 inexact queries of 574. Prevented by DP1.
- **A transaction capability without reads.** [fact] Caught by the audit (`audit:86`) and shown by the before readings. Prevented by DT1.
- **A read guard that forced full reads.** [record] Caught by taverna's `load` readings, 1501 rows for a page of 10, and traced to the guard by the audit (`audit:99-103`). Prevented by DR1.
- **Two counting paths.** [fact] `aggregate('count')` was unguarded while `count()` reduced over the guard. Caught by the audit. Prevented by DR3.
- **A decode that dropped a field in silence.** [fact] Caught by the ruling's read of the decoder (`native:180`). Prevented by DR6.
- **A native form no index can use.** [fact] `substr` for `starts`. Caught by the audit. Prevented by DI1.
- **A compile form that hid the list length from the engine's planner.** [fact] Caught by the ruling's own probe ahead of the unit (`native:399`). Prevented by DI2 and A-D1.
- **A default that stalls the thread.** [fact] The 5000 ms busy timeout was recommended and then withdrawn. Caught by taverna's timeout arm and reproduced by the two-connection probe (`native:363`). Prevented by DT3.
- **A differential that never ran `Table`.** [fact] Caught by the independent review (`fix-db-paging.md:21`). Prevented by DP3.
- **An unchecked pragma that changed `like`.** [fact] Caught by the reviewer's probe: `["b"]` natively and `["a","b"]` through the residual (`fix-db-paging.md:13`). Prevented by DP5.
- **A recorder blind to an internal fallback.** [fact] Caught by the review (`fix-db-paging.md:22`). Prevented by DM3 and DV4.
- **Residual cases written as exceptions.** [fact] A list holding `null` and an `undefined` operand stayed residual on SQLite. Caught by the review and ruled by the user's own sentence (`fix-db-paging.md:14`). Prevented by DN1 and DV2.
- **A stream that ignored `order` and prepared per row.** [fact] Caught by the review (`fix-db-paging.md:18-20`). Prevented by DP4 and DR5.
- **A native side that re-ran the core engine over its own exact range.** [fact] IndexedDB `records` runs `applyQuery` over the candidates (`src/browser/drivers/IndexedDBDriver.ts:258-261`). Caught by the review, as an advisory (`fix-db-paging.md:23`). Prevented by DN1.
- **Browser counts derived by hand.** [fact] Caught by the review brief's own claim (`review-db-paging.md:43`). Prevented by DV5.
- **Rows × keys membership in the residual.** [record] Caught by taverna's fixture cases, 13.7 s against a 5 s timeout ([record: taverna native-b.md]). Prevented by DR5.
- **Wrapper primitives present and unused, and compound indexes created and never read.** [fact] Caught by the audit's "Native unused" column. Prevented by DN4.
- **An audit read from built files.** [fact] Caught by the ruling's read of source (`native:25-33`). Prevented by DV7.
- **A citation to lines that do not exist.** [fact] Caught by reading the file's length at its commit (`native:391`). Prevented by DV7.
- **A scratch-path citation in a tracked record.** [record] The design at `f9c07b1` cited scratch paths, and the committed design quotes `research/intake.md` in their place ([record: scaffold brief-database-addendum.md], through the lessons distillate). Caught at the addendum consultation. Prevented by the tracked-carrier rule under Marks.
- **A discarded engine refusal.** [record] Taverna's drain swallowed `BUSY`. Caught by a durable-count stop that read 20 of 45 records missing. Prevented by DT2.
- **A prediction kept past its reading.** [record] The fixed audit share was predicted and the readings refuted it ([record: taverna load.md]). Prevented by DM4.

## 3. The patterns applied to each package

Each table's `Held by` column names where the unit already sits, so nothing is planned twice. `paging` is landed work at `e291d39`. `fix round` is the uncommitted round of `fix-db-paging.md`. `coverage` and `text` are the waves of `native` § 8. `open` is work no wave holds, which the quality session takes on. Every acceptance line is [inference] unless `native` states it.

### `database`

The following units are held and are not planned again.

| Unit                                                                                                                                                                                                                     | Lands at                                                                                                                                                                       | Acceptance reading                                                                                                                                      | Held by   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Refuse `case_sensitive_like`; compile the `null`-list and `undefined`-operand cells; IndexedDB `stream` order and one preparation; one read procedure; the recorder beneath the driver; the API table; the handover list | `src/server/drivers/SQLiteDriver.ts:162-164`, `src/server/compilers.ts`, `src/browser/drivers/IndexedDBDriver.ts:512-529`, `src/core/Table.ts:369-422`, `tests/setupServer.ts` | Each row red on `a592a5b` and green after (`fix-db-paging.md:9`)                                                                                        | fix round |
| The paging release and taverna's adoption                                                                                                                                                                                | The release visit                                                                                                                                                              | Taverna's `load` readings re-measured against `intake` (`plan:5`)                                                                                       | paging    |
| IndexedDB plans: ranking, `any`, `starts`, compound indexes, native order, paging, count, `minimum`, `maximum`, batched streaming                                                                                        | `src/browser/helpers.ts:43-76`, `:115-131`, `:179-192`; `src/browser/drivers/IndexedDBDriver.ts:252-270`, `:512-529`, `:687-697`                                               | `any` over `K` keys returns `K` rows; a native page returns at most `P` rows; a native count returns zero rows; a stream holds one batch (`native:269`) | coverage  |
| The journal, and `snapshot` removed                                                                                                                                                                                      | `src/core/DatabaseContext.ts:176-229`, each driver's `snapshot`                                                                                                                | `K` prior rows read and `K` restored, zero `scan` calls (`native:270`)                                                                                  | coverage  |
| Batches and the cursor's list read                                                                                                                                                                                       | `src/core/Table.ts:430-440`, `src/core/Cursor.ts:79-96`                                                                                                                        | One driver call and one commit for `K` rows; a conflicting row applies none (`native:271`)                                                              | coverage  |
| SQLite completion: statement cache, `BEGIN IMMEDIATE`, the `journal_mode` default, `PRAGMA optimize`, `pragma(name)`, the index reconcile, the rank expression, nested-path prefilters                                   | `src/server/drivers/SQLiteDriver.ts:493-562`, `:305-325`, `:135-201`                                                                                                           | A timing reading of repeated point reads on 0.0.23 and on the change; the two-driver reading of `native:366`; `sqlite_stat1` at reopen                  | coverage  |
| The text index                                                                                                                                                                                                           | After the design round of `native` § 6                                                                                                                                         | Set by that round                                                                                                                                       | text      |

The following units are open.

| Unit                                                                                                                                                                                                                 | Lands at                                                               | Acceptance reading                                                                                                                                        | Patterns         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Check every `pragmas` entry at open.** The driver passes each name and value to a wrapper that interpolates both. `native` Point 5 checks the name of `pragma(name)` only.                                         | `src/server/drivers/SQLiteDriver.ts:162-164`                           | A name or a value outside the admitted shape raises `VALIDATION` ahead of the wrapper call, red on `e291d39`. § 5 holds the question of the check's home. | DP5, A-C1        |
| **Round trips per operation, on both engines.** Extend the recorder to count wrapper statements and IndexedDB transactions per public `Table` operation.                                                             | `tests/setup.ts`, `tests/setupServer.ts`, `tests/setupBrowser.ts`      | One assertion per public operation, written against `K` or `P`                                                                                            | DM1, DM3, A-P12  |
| **Bench files for the residual path.**                                                                                                                                                                               | `tests/src/core/helpers.bench.ts` beside the probe project             | A bar stated ahead of the run as a share of a consumer's page budget, a growth ratio at double size, and a failing superlinear control                    | DM6, DR5, A-P9   |
| **The residual `like` and `glob` matcher.** It copies the value to code points per row and allocates an index array per middle segment. It serves IndexedDB, `MemoryDriver`, and `JSONDriver` after the paging wave. | `src/core/helpers.ts:335-376`                                          | The bench cell at `MAX_PATTERN_LENGTH` and the widest admitted value. Change the code only when a consumer's load shows the term (§ 5).                   | DR5, A-P14       |
| **Top-of-page selection under a residual order, and a streamed residual aggregate.** A residual order sorts every match for a page, and a residual aggregate pushes every row into an array.                         | `src/core/Table.ts:180-187`, `:420-422`; `src/core/helpers.ts:643-726` | Retained rows at most `offset + limit` for an ordered page and zero for an aggregate, with output equal to `sortRows` over seeded inputs                  | DR4, A-P8, A-P13 |
| **`Query` reads with a predicate.** A `count` with a predicate materializes `records`, and a predicate with an order reads without the page.                                                                         | `src/core/Query.ts:61-92`                                              | A counted walk with zero retained rows; `native:109` already rules the unordered case                                                                     | DR4              |
| **`MemoryDriver` order and copies.** Each `keys` and `scan` sorts every key, and each read, write, and scanned row is cloned. Every suite and fixture driver pays it.                                                | `src/core/drivers/MemoryDriver.ts:68-107`, `:251-253`                  | A bench of repeated `scan` at a suite's real table size; the caller-mutation isolation test stays green                                                   | A-P5, A-P6, A-P7 |
| **The copy inside decode.** A `json` cell pays `JSON.parse` and then `structuredClone`.                                                                                                                              | `src/server/helpers.ts:531`, `:637-646` (unread here)                  | Copies per cell read one, with the isolation test green                                                                                                   | DR6              |
| **`JSONDriver` whole-document write.**                                                                                                                                                                               | `src/server/drivers/JSONDriver.ts:754-790`                             | A write-rate reading against document size, then a recorded stop or a design. Build nothing ahead of it.                                                  | DW4              |
| **Existence without the row.** `has` reads, decodes, and asserts the row.                                                                                                                                            | `src/core/Table.ts:144-146`                                            | Refused until a consumer's reading shows the cost; the wrappers already hold the primitive                                                                | DN4, A-P14       |

### `sqlite`

`native` § 8 rules no functional change for the wrapper in any wave, and the statement cache, `BEGIN IMMEDIATE`, and the pragma read stay in `database`.

| Unit                                                                                                                                                            | Lands at                               | Acceptance reading                                                     | Held by                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| The header comment that states the scan-first default                                                                                                           | `src/server/types.ts:1-11`             | Guide parity                                                           | Its next functional release (`plan:34`)  |
| **Engine readings on the declared floor**: the bundled SQLite version, FTS5, whether `PRAGMA optimize` bounds its analysis, and how an unpaired surrogate binds | A kept probe in the `probe` project    | Each reading with its Node and SQLite versions, on the floor § 4 rules | open; `native:312-323`, `native:481-491` |
| **The pragma text check**                                                                                                                                       | `src/server/SQLiteDatabase.ts:146-149` | § 5: its home is unruled                                               | open                                     |
| **`SQLITE_LOCKED` reads as `'UNKNOWN'`**                                                                                                                        | `guides/sqlite.md:128`, `wrapError`    | § 5: a ruling, per A-Q11                                               | open                                     |
| **A repeated point-read bench** on the wrapper alone, so that the driver's statement-cache reading has the wrapper's term apart from its own                    | `tests/` probe project                 | A-M3's interleaved comparison with identical sides read ahead of it    | open; DM4                                |

### `indexeddb`

| Unit                                                                                               | Lands at                                                                  | Acceptance reading                                                                                                      | Held by                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `rangePrefix` takes the exact successor as an exclusive bound, and the header comment is corrected | `src/browser/helpers.ts:247-250`, `src/browser/types.ts:3-7`              | A store holding the prefix followed by U+FFFF and more returns that row (`native:268`)                                  | coverage                                                      |
| **A read raises on a stored value that is no record**                                              | `src/browser/helpers.ts:129-158`, `IndexedDBCursor.ts`, guide invariant 7 | § 4 rules it. `count` equals `records().length` or the read raises, in the browser project.                             | open, and it lands in the coverage wave's `indexeddb` release |
| **Transactions per call.** Each standalone call opens its own transaction.                         | `src/browser/IndexedDBStore.ts:188-192`                                   | A recorder over the real engine counts transactions per call, as the instrument the driver's round-trip assertions read | open; A-P12                                                   |
| **The batch size constant** for the driver's batched streaming                                     | `database`, and read here on the wrapper's `records(range, count)`        | One named constant with its run, on rows of mixed width (`native:218`)                                                  | coverage, with A-P2 and A-M6                                  |
| **Hosts.** The suite runs on Chromium alone.                                                       | `tests/` browser project                                                  | § 5: which browsers the package claims                                                                                  | open; A-M7                                                    |

### `relation`

| Unit                                                                                                                                                               | Lands at                                            | Acceptance reading                                                                                                     | Held by                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Loads by primary key through the keyed list read; `link` as one insert; `unlink` as one remove that emits only when a row left; the guide states each needed index | `src/core/Model.ts:354-385`, `:454-466`, `:206-253` | `link` is one insert and `unlink` one delete on the recorder; two concurrent `link` calls leave one row (`native:273`) | coverage                                                     |
| **A query-count assertion per relationship and nesting level.** The package holds no recorder.                                                                     | `tests/src/core/Model.test.ts`                      | One query per direct relation and two per `through`, as the guide states                                               | open; A-P12. § 5 holds the recorder's home.                  |
| **The guide's two deferrals**                                                                                                                                      | `guides/relation.md:150`                            | § 4 rules both                                                                                                         | open, and it lands in the coverage wave's `relation` release |
| **The adverse orderings of `link`**: an abort between its steps, and a scope that rolls back after the event fired                                                 | `tests/src/core/Model.test.ts`                      | One test per ordering, per A-V5                                                                                        | open                                                         |
| **The size of an include.** A load returns every related row of every listed key (`native:389`).                                                                   | `src/core/Model.ts:305-329`                         | § 5: a bound or a stated limit                                                                                         | open; A-Q7                                                   |
| **The tagged load's plan.** Without statistics it plans through the less selective index (`native:410`).                                                           | `src/core/Model.ts:483-510`                         | `EXPLAIN QUERY PLAN` after the driver's `PRAGMA optimize` lands                                                        | coverage, through DI3                                        |

## 4. Rulings on the Agent file's questions for this side

### The `indexeddb` guide's invariant 7

**Ruling: the wrapper raises.** `get`, `resolve`, `records`, and a cursor's `value` raise a typed `IndexedDBError` that names the store and the key when a stored value is no record. `count`, `has`, and `keys` stay key operations. Invariant 7 is rewritten to say so.

- [fact] The guide states that a store holding a non-record value "shows `count` greater than `records().length`" (`indexeddb/guides/indexeddb.md:252`). `readRecord` returns `undefined` for such a value and `readRecords` filters it out (`indexeddb/src/browser/helpers.ts:129-158`).
- [fact] `native` § 3 rules that no read skips a row and that `count()`, `records()`, and `aggregate('count')` read one stored set.
- [fact] The driver reads its candidates through `store.records` (`src/browser/drivers/IndexedDBDriver.ts:687-697`), so the wrapper drops the value beneath `Table`'s assertion.
- [inference] **The skip is latent in the paging wave and visible in the coverage wave.** A residual count walks the same filtered rows, so both answers skip the value together. The coverage wave answers a count with `count(range)`, which counts keys over every stored value, and `count()` then exceeds `records().length`. That is the disagreement `native` § 3 removed.
- [inference] **The wrapper owns the repair.** The wrapper discards the value, so no layer over it can see it. A check in the driver needs a `count` beside every read, which is package logic over a native read. Scaffold's rule sends a reusable defect to the lowest package that owns the mechanism.
- [inference] **The cost is nothing added on a clean read.** `isRecord` already runs per value. The key of a failing value in a bulk read is computed on the refusal path alone.
- [inference] **The cursor's type follows.** A cursor stopped on a position holds a value, so `value` narrows to `StoreRecord` and raises in place of reading `undefined`. That is a public type change, so the unit starts in `src/browser/types.ts` with one design opinion. `DATA` is in the declared code union; the unit reads its meaning ahead of adding a member.
- **Wave.** The coverage wave's `indexeddb` release, beside `rangePrefix` and ahead of the database unit that makes `count(range)` native.
- **Assent.** The change alters published behavior in a package the user's assent of 2026-11-13 did not name. It follows from that assent and from the refuse-by-default ruling of 2026-11-03, and § 5 lists it for confirmation.

Rejected: keeping the skip as a stated limit, because a native count then disagrees with `records`. Rejected: a recheck in the driver, for the second round trip.

### `relation`'s guide and its two documented deferrals

**Ruling: neither stays a deferral, and each takes one of A-D5's ends.**

- [fact] The guide calls exact typing of a loaded relation property "a deliberate, documented deferral — like the database guide's deferred pieces", and says write-cascades are "Still out of scope" (`relation/guides/relation.md:150`). [fact] The database guide at `e291d39` holds no "deferred" wording, so that comparison points at nothing.
- **Typed loaded relations: refused under the creation gate, with a trigger.** Scaffold's minimal-API law creates a capability with its first real consumer. The trigger is a consumer that narrows a loaded relation property by hand. § 5 names the read that checks it against taverna. When the trigger holds, the unit is built types first in the coverage wave's `relation` release.
- **Write-cascades: handed to the database campaign's references row.** Under native-first, a cascade is the engine's `ON DELETE` on SQLite and a check inside the transaction on IndexedDB, both behind `DatabaseOptions.references` (`native:152`). `Model` holds table-only storage and no transaction (`native:242`), so `relation` cannot write one atomically and builds none. The row already has a trigger and an owner (`plan:45`). Per A-R4, the change that edits the relation guide writes the cascade into that row.
- **The guide.** The sentence at `guides/relation.md:150` is replaced by two stated limits, each with its trigger and its owner, in the coverage wave's `relation` release.

### The Node floor

**Ruling: the floor is Node 22.18.0, and `native`'s "Node 22.12.0" is read as 22.18.0.**

- [fact] Scaffold's `MINIMUM_NODE_VERSION` is `'22.18.0'` (`scaffold/src/core/constants.ts:706`).
- [fact] `database`, `indexeddb`, and `relation` each declare `"node": ">=22.12.0"`. `sqlite` declares `"node": "^22.18.0 || >=24.4.0"`.
- [inference] **The server environment's floor is already 22.18.0.** `database` declares `@orkestrel/sqlite`, and a package cannot support a Node version its dependency excludes. The `>=22.12.0` in the other manifests is a stale line.
- **Probes.** Every reading `native` owes "at the declared floor" runs on 22.18.0 and records its Node and SQLite versions: the bundled SQLite version, FTS5, and the bound on `PRAGMA optimize` (`native:230`, `native:316`, `native:484`). The readings taken on 22.23.5 stand for 22.23.5 alone, per A-R5.
- **Manifests.** The `engines` field of `database`, `indexeddb`, and `relation` takes the fleet's range in each package's next functional release. § 5 holds which file owns that range and why `sqlite`'s excludes Node 23 and the releases of Node 24 ahead of 24.4.0.
- **Record.** The campaign's writer records the correction as an addendum line in `native`. The floor has one home, scaffold's constant, and a design cites it.

## 5. Open questions

A run settles each of the following.

- **The fix round's close.** The round is uncommitted. Its commits, its red and green counts per row, and its gates are unread, and so is the review's verdict file.
- **The IndexedDB port's counts.** Whether a committed browser test reads the rows per conformance read, or the counts remain a hand derivation (DV5).
- **The floor's engine.** `SELECT sqlite_version()`, the FTS5 compile option, and `PRAGMA optimize` on Node 22.18.0. The host's Node 22 is 22.23.5 [record: the review brief], so the run needs a 22.18.0 binary.
- **The `PRAGMA optimize` mask.** `0x10002` is recalled and not reread (`native:485`).
- **A busy timeout with the holder on a worker thread.** Not probed (`native:486`).
- **An unversioned IndexedDB database with a dropped index declaration**, and a `readonly` SQLite open of a file that lacks a declared index (`native:488-489`).
- **Unpaired surrogates** in a `starts` bound and in text order (`native:321`).
- **The decode's second copy.** Read `src/server/helpers.ts:531` and measure it.
- **Taverna's reads on IndexedDB.** Whether its browser store issues `like`, a residual order, or a residual aggregate. That reading decides the open residual units of § 3 and their bars.
- **Taverna's use of a loaded relation property.** A search of its source for a by-hand narrowing settles the typed-loads trigger of § 4.
- **The dependents' sweep.** Whether another fleet package implements a driver (`plan:46`).
- **The recorder's home.** Read the `@orkestrel/test` guide for a rows-read or round-trip recorder ahead of exporting one. `relation` needs the instrument and holds none.
- **The owner of `engines`.** Read scaffold's manifest handling for whether its overwrite emits the field, and for the reason behind `sqlite`'s range.

The user or the campaign's owner settles each of the following.

- **Assent to the raising read in `indexeddb`** (§ 4). Without it, a native IndexedDB count can exceed `records().length`.
- **The home of the pragma text check.** `native` Point 5 places a name check in the driver and rules no functional change for `sqlite`. The wrapper builds the SQL text, and scaffold's lowest-owner rule and A-N3 place the check there, for the name and the value. I recommend the wrapper: it gives `sqlite` a functional release, which also carries its stale header comment. The recommendation amends a ruled line, so it needs the owner.
- **`SQLITE_LOCKED`.** Whether it gains its own code (A-Q11).
- **A bound on an `any` list and on an include's result** (A-Q7), or a stated limit.
- **Taverna's `search` unit against the text wave.** `native:233` rejects a word index owned by taverna, and taverna's plan still schedules one [record: the lessons distillate]. One ruling cancels the table or narrows `native` § 6.
- **The release bar** (A-Q1). This side adds one consequence to the Agent file's candidates: a read that runs the core engine on an engine that has the native operation, which is the user's own definition of a defect.
- **The hosts `indexeddb` claims** beyond Chromium.
- **The order of work.** The paging release and taverna's adoption are the campaign's exit criterion (`plan:5`). Whether the quality session starts its open units ahead of the coverage wave, or after it, is unruled. I recommend after the paging release and beside the coverage wave, with the bench files and the round-trip recorder landing ahead of every other open unit, because each later unit's acceptance reads them.
