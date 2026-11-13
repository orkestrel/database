# Database campaign intake, 2026-11-13

The messages reached the fleet Orchestrator from taverna's Orchestrator. They are recorded here verbatim.

## Message 1: native paging and counting

From taverna's Orchestrator: the user asks you to take up the `@orkestrel/database` work next. `Table.records()` and `Table.count()` never push a page or a count down to the driver. This is taverna's evidence; the design and the repair are yours.

**The finding (installed `@orkestrel/database` 0.0.23, `dist/src/core/index.js`):**
- **`records(input)` (line 2840).** It hands the driver's `records` hook only `{ conditions, order }`. It then runs `#guard(row)` over every returned row in JS and applies `offset`/`limit` last with `rows.slice` (lines 2849–2854). `limit` and `offset` never reach the driver, so SQLite returns every matching row for a 10-row page.
- **`count(input)` (line 2869).** It fetches every matching row through the same hook and reduces over `#guard` (lines 2874–2877). That is a full row read in place of `SELECT COUNT(*)`. The remarks give the reason: legacy invalid rows must not make `count()` disagree with `records()`.
- **Together.** A list endpoint that asks for a page and its total reads the whole matching set twice. Taverna's `listCapabilityOf` (`app/core/capabilities/helpers.ts`, about line 588) does exactly that: `table.count` plus `table.records` with `limit`/`offset`.

**What taverna measured** (its `load` unit):
- On the 80,646-row book slice, `claim_list` read 1501 rows to answer, with 3002 reads behind it.
- A 10-row `/api/search` page took 255–337 ms at one hundredth of the book.
- Part of that is taverna's audit, one record per list invoke. The rest is this row-read-then-slice path, which grows with the table, not the page.

**What taverna needs from the package:**
1. A page that reaches the driver: `limit`/`offset` in the SQL.
2. A count the driver answers: `COUNT(*)` with the conditions.
3. `count()` and `records()` must still agree. The current design pays for that with full reads. A design that keeps it without them is yours to choose: for example, rows guaranteed valid at write time or after a one-time sweep, so the guard leaves the hot path. Keep the guard's reason in the remarks.

**Lower priority, already deferred to you in taverna's plan:** a text index in `@orkestrel/database`. Taverna's search is a substring scan over declared columns. It will build its own word-index table (its planned `search` unit) unless the package offers one.

**Observation only, no ask.** A second SQLite connection to the same file lost writes as `BUSY` (errcode 5), even with a 50 ms busy timeout (the fastest refusal came at 95.75 ms). Taverna fixed its side by giving each store its own file (`f7238b2`). If the driver should document or prevent that, it's yours to rule.

**Scheduling.** Taverna's `lines-c` page repair waits on your answer. `lines-a` runs now and doesn't need it. When the release lands, send me the version and the API, and I'll adopt it under your one-step handover.

## Message 2: the user's native-first principle and the audit

**The principle (the user, 2026-11-13).** `@orkestrel/database` is the unifier: one API over SQLite and IndexedDB, carrying the best database design patterns.
- It **prefers and defaults to each driver's native abilities**, and supplies its own logic only to fill a gap that driver's engine cannot cover.
- Wherever an engine can do the work natively, that path comes first. Filtering, ordering, paging, counting, aggregating, indexing, uniqueness, relations, transactions, and text search are all candidates.
- The package's fallback serves only the engine that lacks the ability. For example, IndexedDB has no multi-field filter, arbitrary ORDER BY, or OFFSET, so those fall back there and never on SQLite.
- Custom logic never runs where the native path exists, because it will never be as fast.
- The user asks that this become the package's stated rule (guide, contract TSDoc, and the driver contract's shape) and that the package be brought to it.

**The audit:** `research/audit.md` in this folder. It is read-only, cited file:line against installed database 0.0.23, sqlite 0.0.18, indexeddb 0.0.18, and relation 0.0.21, and each checkout's HEAD is its release commit. Taverna's Orchestrator verified the two load-bearing claims in the code.

**What it found, beyond `records`/`count`:**
1. **All-or-nothing pushdown.** The SQLite driver sends a query to SQL only when every clause is "exact" (`matchesQueryExactly`; `SQLiteDriver.records`, server dist line 1766). One optional or nullable column, a text `order`, a `like`, or a nested path sends the whole query to `#scan` plus `applyQuery` in JS. `like`/`glob` are never exact, and `starts` compiles to `substr(...)`, which no index can use.
2. **The SQLite transaction capability** (`#capability`, server dist lines 2187–2200) exposes no `records`, `aggregate`, or `stream`. So every `records`/`count`/`aggregate` inside `database.transaction` is a full scan and a JS filter. Taverna runs every write handler in a transaction.
3. **IndexedDB.** `selectPlan` uses only the first condition, on a single-column index. `any` has no plan, so every `relation` load is a full `getAll` of the related store. Compound indexes are created and never read. `getAll(range, count)`, `count(range)`, and cursor `advance` exist in `@orkestrel/indexeddb` but go unused. `scan` and `stream` load the whole store into an array.
4. **The IndexedDB transaction fallback** snapshots every row of every table per transaction and rewrites them all on rollback.
5. **Gaps in the contract itself.** It has no batch-write member (each row is its own commit), no unique non-primary index, no `REFERENCES`, and no text index kind (FTS5 exists natively on SQLite). The SQLite driver has no prepared-statement cache, and `Table.get(keys)` is a sequential point-read loop where `IN (...)` or one IDB transaction would do.
6. **The read guard is the root of the `records`/`count` design.** Writes are already validated, so the guard defends only against legacy or out-of-band rows. Fleet canon is greenfield (scaffold `AGENTS.md`: no migration for data an earlier release produced). `aggregate('count')` is already unguarded, so the claimed agreement is already broken there.

**The audit's guard recommendation:** sweep each table once through the guard at open and after a migration; persist a per-table trusted mark keyed to the contract fingerprint; give a trusted table native paging and a native count, with the guard on the returned page only; leave a table that fails the sweep untrusted on today's path, reporting the invalid keys and repairing nothing automatically; and raise a page-guard failure on a trusted table as corruption.

**Top five, by rows read** (N table, M matching, P page, K keys written): native count (M to one aggregate row); push limit and offset down (M to P); per-clause pushdown, `starts` as an index range, and IndexedDB plans for `any`/`starts` (N to M_exact); native read hooks on the SQLite transaction capability (N to the above); a before-image journal in place of IndexedDB's whole-database snapshot (Σ N to K).

**A default to rule under the principle.** The SQLite driver sets no `journal_mode` and no busy timeout by default. Should the package default to SQLite's best native practice (WAL, a busy timeout, `BEGIN IMMEDIATE` for writers), or leave it to each application? Taverna will set WAL and a timeout on its four connections itself either way.

**Taverna's side.** Taverna will declare its filter and order columns required wherever the domain allows, declare an index on every foreign-key and filter column, and adopt the scaffold session's release under the one-step handover. `lines-c`'s page repair waits on that release.

## Message 3: six points from taverna's `native` consult, verbatim

The points follow verbatim.
1. **The driver's WAL default.** Taverna will set `journal_mode = WAL` and `synchronous = FULL` itself, through the driver's `pragmas` option. If the driver defaults to WAL, it must not lower `synchronous` without the application saying so. A busy timeout has no effect with one connection per file: taverna's `load` arm C measured every wait running out, because the single thread holding the read is the one that waits.
2. **The exactness gate on an optional column.** Admit `equals` and `any` with non-null operands on an optional column. Per-clause pushdown alone won't reach a relation load, which has one clause.
3. **An `any` list past the bound-parameter limit.** `compileConditionSQL` binds one parameter per value, and `Model` builds the list from every parent key (`relation` near lines 622 and 639). Rule chunking, or a stated bound.
4. **Statistics.** Rule whether the driver runs `PRAGMA optimize` at close and on a long-lived connection. The `pragmas` option applies only at open, so a file that grows from empty inside one process plans with no `sqlite_stat1`. Without statistics, `id IN (…) AND organization_id = ?` may plan through the tenant index and read every row of the organization.
5. **Reading a connection setting back.** Neither the driver nor the database can read a pragma back, so an application can't prove `synchronous`.
6. **Undeclared indexes at open.** A database with no version keeps every index a later declaration drops.

Taverna depends on `matchesQueryExactly` and `compileQuerySQL` staying exported: its index-plan and census tests compile SQL through them. It asks to be told if the release renames them.
