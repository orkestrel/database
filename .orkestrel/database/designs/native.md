# Ruling: `@orkestrel/database` native first

Ruled 2026-11-13 against database 0.0.23 (`8c5d3b1`), sqlite 0.0.18 (`95e4408`), indexeddb 0.0.18 (`17e2a00`), and relation 0.0.21 (`a7712ce`). Paths are relative to each package's checkout.

## Decision

- **Rule.** A driver answers every part of a read or a write with its engine's native operation wherever the engine has one, and the core runs its engine only over the residual a driver's plan returns. The rule's home is the `DriverInterface` TSDoc in `database/src/core/types.ts`.
- **Shape.** The driver contract gains one member, `plan`, which splits a read into a `native` part and a `residual` part per clause. The existing `records`, `stream`, and `aggregate` hooks answer the `native` part. The core runs the `residual` part and nothing else.
- **Guard.** The read guard stops filtering and becomes an assertion on the rows a read returns. A stored row that fails the contract raises `DRIVER`; no read skips a row. `count()`, `records()`, and `aggregate('count')` then read one stored set, so they agree by construction with no sweep and no trusted mark.
- **SQLite.** Every operator on a flat declared column is native. That requires stating four semantics as the engine has them: text order, `like` folding, the single-character wildcard, and `sum`/`average` arithmetic.
- **IndexedDB.** The planner picks one access path, keeps the remaining conditions as residual, and uses `records(range, count)`, `count(range)`, cursor `advance`, and batched key-range pages. A before-image journal in the core replaces `snapshot`.
- **Release order.** The paging wave is one database release with no wrapper change, and it unblocks taverna's `lines-c`. The coverage wave and the text wave follow.

Some of these decisions change published behavior. § Decisions that need the user's assent lists each one.

## Evidence

I read each line the audit cites in the TypeScript source, not in `dist`. The audit's two load-bearing claims hold:

- `Table.records` strips `limit` and `offset` before the driver call, guards every row, and slices last (`database/src/core/Table.ts:158-170`).
- `Table.count` reads every matching row through `records` and reduces over the guard (`Table.ts:191-195`), while `aggregate` is unguarded (`Table.ts:231-235`).

The other audited facts I rely on also hold: the all-or-nothing gate (`database/src/server/drivers/SQLiteDriver.ts:271-282`), the transaction capability without `records`, `aggregate`, or `stream` (`SQLiteDriver.ts:924-937`), a fresh `prepare` per call (`SQLiteDriver.ts:541-549`, `560`, `597`), the one-condition planner (`database/src/browser/helpers.ts:160-182`), the whole-store `scan` (`database/src/browser/drivers/IndexedDBDriver.ts:222-228`), the whole-database snapshot (`IndexedDBDriver.ts:255-287`, `333-348`) taken with no table list (`database/src/core/DatabaseContext.ts:213`), the lossy decode (`database/src/server/helpers.ts:377-409`, `493-502`), and relation's `any` loads and two-step `link` and `unlink` (`relation/src/core/Model.ts:206-254`, `354-511`).

The audit needs these corrections:

| Audit claim | What the source shows |
| --- | --- |
| SQLite computes `SUM` and `AVG` natively for exact conditions | `matchesAggregateExactly` returns `false` for `sum` and `average` on every column (`server/helpers.ts:247`). Both always run in JavaScript. |
| The IndexedDB planner cannot tell whether a column has absent rows | `ColumnSchema` carries `optional` and `nullable` (`core/types.ts:278-283`). The planner can admit `below` and `to` on a secondary index for a required column. |
| `rangePrefix` gives `starts` a plan as it stands | `rangePrefix` closes the range at `value + '\uffff'` (`indexeddb/src/browser/helpers.ts:247-250`), so it drops a string that continues past that code unit. `conditionToRange` excludes `starts` for that reason (`browser/helpers.ts:29`). The bound needs a repair before the plan. |
| The wrapper's array `set` can carry a batch write | The array overload takes no keys (`indexeddb/src/browser/types.ts:364`), and the driver stores rows under out-of-line keys (`IndexedDBDriver.ts:193`). A batch write runs inside one `database.write` scope instead. |
| The compiled SQL differs from the core on `NULL` | `compileConditionSQL` already replicates the core's total order with `OR … IS NULL` forms (`database/src/server/compilers.ts:216-238`). The gate, not the compiler, refuses optional and nullable columns (`server/helpers.ts:147`). The compiler is wrong only for a `null` operand on a nullable-only column and for the sentinel on a column that is both optional and nullable. |

One fact the audit did not record matters to the design: `JSONDriver` is another durable driver with its own `transaction` and `stream` (`database/src/server/drivers/JSONDriver.ts:145`, `170`), and it calls `MemoryDriver.snapshot` internally (`JSONDriver.ts:740`).

## 1. The stated rule

The rule reads as follows in the guide and in the `DriverInterface` TSDoc.

> **Native first.** A driver answers every part of a read or a write with its engine's native operation wherever the engine has one: filtering, ordering, paging, counting, aggregating, batch writes, keyed batch reads, streaming, and transactions. The core runs its own engine only over the residual a driver's plan returns, and a driver returns a part as residual only when its engine has no operation with the contract's meaning. A fallback on an engine that has the native operation is a defect.

- **Home.** The `DriverInterface` doc block in `database/src/core/types.ts`. Its description paragraph becomes: "Declares the storage contract a backend implements: its engine's native operations first, and the core's engine only for the residual its plan returns." The quoted rule is the opening of its `@remarks`.
- **Guide.** `database/guides/database.md` § Contract invariant 3, titled "Thin driver, one engine, native overrides" (`database.md:548`), is replaced by the rule and the coverage table in § 2 of this ruling. The pattern section "Exact-or-refine vs. narrow-then-refine native reads" (`database.md:2269`) is replaced by one section on plans and residual work. The Surface row follows the description paragraph through guide parity.
- **Shape.** The `plan` member in § 2 states the rule structurally: a driver declares what it leaves, and the core has no other source of work.
- **Pointers.** The `Table` class doc block ("The driver only stores and scans; all querying is the shared core engine", `Table.ts:45-46`), the `StorageInterface` remark "callers fall back to `scan` when a native read hook is absent" (`core/types.ts:375-376`), and the header comments in `sqlite/src/server/types.ts:3-8` and `indexeddb/src/browser/types.ts:3-7` each contradict the rule. Rewrite each to point at the `DriverInterface` rule.

Rejected: a home in scaffold's `AGENTS.md`. The design law "one shared engine, with a native backend override only for a faster path" already admits the rule, because the shared engine remains the fallback. The rule is a contract of one package family, so it lives with that contract.

## 2. The driver contract's shape

### Ruling

A driver declares its native coverage per read, by return value. `plan` receives the whole read and returns the split. The existing optional hooks stay and answer the `native` side.

The following types are added to `database/src/core/types.ts` § Driver contract.

```ts
/** Represents one aggregate a read reduces its rows to. */
export interface Aggregate {
	readonly operation: AggregateOperation
	readonly column: FieldPath
}

/** Represents a read as a driver plans it: a query, and the aggregate over its rows when the read computes one. */
export interface ReadInput extends QueryInput {
	readonly aggregate?: Aggregate
}

/** Represents the split of one read between the engine and the core. */
export interface ReadPlan {
	readonly native: ReadInput
	readonly residual: ReadInput
}

export interface StorageInterface {
	// keyed members, `scan`, `clear`, `migrate`, `metadata`, and `stamp` are unchanged in the paging wave
	plan?(table: string, input: ReadInput): ReadPlan
	records?(table: string, input: QueryInput): Promise<readonly Row[]>
	stream?(table: string, input: QueryInput): AsyncIterable<Row>
	aggregate?(
		table: string,
		operation: AggregateOperation,
		column: FieldPath,
		input: QueryInput,
	): Promise<number | undefined>
}
```

A plan obeys these invariants, and `scanDriver` checks each one:

- Every clause of the input appears in `native`, in `residual`, or in both. A condition in both is a prefilter: the engine applies a superset form and the core rechecks it.
- `order` goes whole to one side.
- `native` carries `limit` and `offset` only when `residual` holds no condition and no order.
- `native` carries `aggregate` only when `residual` holds no condition.
- When every connector is `and`, `residual.conditions` holds the conditions the engine did not answer exactly. When any connector is `or`, `residual.conditions` is empty or is the complete list, and the engine's form replaces each condition it cannot answer with a constant true, which keeps the fold a superset.
- A driver that declares `plan` declares `records` and `stream`, and declares `aggregate` when any plan it returns keeps an aggregate native. A driver without `plan` answers nothing natively, and the core treats the whole read as residual over `scan`.

### How the core runs a read

`Table` follows one procedure for `records`, `count`, `aggregate`, and `scan`:

1. Ask `plan`. Without the member, the plan is an empty `native` and the whole input as `residual`.
2. When `residual` is empty, return what `records`, `aggregate`, or `stream` answers for `native`. The core does no query work.
3. When `residual` holds conditions and no order, pull `stream(native)`, apply the residual conditions, and stop at `offset + limit` matches.
4. When `residual` holds an order, collect the filtered rows, sort, and page.
5. Assert the contract on each row a read returns, per § 3.

`Table.count(input)` is `aggregate` with operation `count`, so one path serves both. `Table.scan` keeps its public meaning, key order with `order` ignored; the driver's `stream` hook honors `order` because step 3 depends on it. The recheck at `Table.ts:370` runs for residual conditions only. `Query.collect` with a `filter` predicate and no order uses step 3 with the predicate as one more residual check.

### Members added, removed, renamed

| Wave | Interface | Change |
| --- | --- | --- |
| Paging | `StorageInterface` | Add `plan`. `stream` honors `order`. `records`, `stream`, and `aggregate` are called with `plan.native` only. |
| Paging | `MemoryDriver`, `JSONDriver` | Remove `stream`. It duplicates the core's residual path over `scan` (`MemoryDriver.ts:138`, `JSONDriver.ts:145`). |
| Paging | `SQLiteDriver` transaction capability | Add `plan`, `records`, `stream`, `aggregate`. |
| Paging | `@orkestrel/database/server` exports | Remove `matchesQueryExactly`, `matchesConditionExactly`, `matchesOrderExactly`, `matchesAggregateExactly`, `EXACT_COLUMN_STORAGE`, `EXACT_RANGE_COLUMN_STORAGE`. Add the pure planner (recommended name `planSQLiteQuery`). |
| Paging | `@orkestrel/database/browser` exports | Replace `selectPlan` with the pure planner (recommended name `planIndexedDBQuery`). Rename the browser type `QueryPlan` to `AccessPlan`. |
| Coverage | `StorageInterface` | `read`, `write`, `insert`, and `delete` each gain the list overload scaffold's `.claude/rules/patterns.md` § Batch operations prescribes. No member is added. |
| Coverage | `DriverInterface` | Remove `snapshot`. |
| Coverage | `SQLiteDriverOptions` | No member change. `timeout` and `pragmas.journal_mode` gain defaults. |
| Text | `DatabaseOptions`, `TableSchema`, `ConditionOperator` | Add `text` and the `search` operator, after the design round in § 6. |

### Clause coverage

The following table rules where each clause runs. "Residual" names the work the core runs, and it runs for the named engine alone.

| Clause | SQLite | IndexedDB | Residual |
| --- | --- | --- | --- |
| `equals`, `not`, `any`, `none` on a flat `text`, `integer`, `real`, or `boolean` column | Native, with `NULL`-safe forms chosen from the column's flags | `equals` and `any` drive the access path on the primary key or an index | IndexedDB: `not`, `none`, and every condition beyond the access path |
| `above`, `below`, `from`, `to`, `between` | Native, text included | Native on the primary key or an index; `below` and `to` on a secondary index for a required column only | IndexedDB: beyond the access path |
| `starts` | Native index range, `>= prefix AND < successor` | Native key range with the exact successor bound | None on either engine when the column is keyed |
| `ends` | Native `substr`, scanned by the engine | No native form | IndexedDB |
| `like`, `glob` | Native `LIKE` and `GLOB` | No native form | IndexedDB |
| `absent`, `present` | Native | No native form for `absent` | IndexedDB |
| Nested path; `json` or `blob` column | Prefilter for the equality family on a nested scalar; no native form otherwise | No native form | Both engines |
| `or` connector | Native | No native form | IndexedDB: the whole fold |
| Order | Native on every flat column | Native on the primary key, or on the access-path index over required columns in one direction | IndexedDB otherwise; SQLite for a nested path |
| Page | `LIMIT` and `OFFSET` | `records(range, count)`; cursor `advance` for an offset or a descending read | The early-exit window in step 3, when residual conditions exist |
| Count | `COUNT(*)` | `count(range)`; a sum of counts for `any` | A counted walk when residual conditions exist |
| `sum`, `average` | Native on `integer` and `real` | No native form | IndexedDB |
| `minimum`, `maximum` | Native on `integer` and `real` | The first or last entry of the column's index | IndexedDB without that index |
| Batch writes | One transaction, or one savepoint inside a scope | One `database.write` scope | None; `MemoryDriver` and `JSONDriver` apply all or nothing |
| Point reads by many keys | One statement | `get(keys)` in one transaction (`indexeddb/src/browser/IndexedDBStore.ts:76-80`) | None |
| Streaming | `iterate` | Batched key-range pages | None |
| Transactions | `BEGIN IMMEDIATE`; the scoped capability mirrors every native member | No native form | The core's before-image journal, for IndexedDB and `MemoryDriver` |
| Unique indexes | `UNIQUE` index | `unique` index | Deferred; see the following paragraph |
| References | `REFERENCES` | No native form | Deferred; see the following paragraph |
| Text search | FTS5 | No native form | § 6 |

Unique indexes and references wait for a consumer. The native-first rule governs how a capability runs, and scaffold's minimal-API law governs whether it exists; no file named in the brief shows a consumer for either, and relation's `link` no longer needs one under § 7. The shape is fixed so neither needs another design round: `DatabaseOptions.unique` and `DatabaseOptions.references`, each a per-table map beside `indexes`, flowing into `TableSchema`. A violation raises `CONFLICT`, which both drivers already map from the engine's constraint fault (`SQLiteDriver.ts:1072`, `browser/helpers.ts:211`). IndexedDB has no reference enforcement, so the core checks references inside the transaction for that engine alone.

### Semantics the rule fixes

Native coverage on SQLite requires the contract to state these semantics. Each one is a change to published behavior.

- **Text order is the engine's binary order.** SQLite compares code points, and IndexedDB, `MemoryDriver`, and `JSONDriver` compare UTF-16 code units. The two orders agree except between a supplementary-plane character and a character in U+E000 to U+FFFF (`database/src/server/constants.ts:15-23`). Text range operators and `starts` follow the same order.
- **`NULL` and absence keep the core's total order**: absent, then `null`, then every value (`core/helpers.ts:99-131`). SQLite expresses the order natively. A column with one flag sorts natively because SQL places `NULL` lowest in both directions. A column that is both optional and nullable needs a rank expression ahead of the column term, because its `null` sentinel is an empty blob or the text `null` (`server/helpers.ts:324-330`), and neither sorts below the column's values.
- **Ties resolve by primary key in the direction of the final order term.** The published rule is ascending always (`compilers.ts:386-390`). SQLite expresses either rule; an IndexedDB cursor in the `prev` direction returns equal index keys in descending primary-key order, so the direction-following rule makes a descending index read native.
- **`like` folds ASCII letters only, and `_` and `?` match one code point.** That is SQLite's `LIKE` and `GLOB`. The core engine folds through `toLowerCase` and matches one UTF-16 code unit (`core/helpers.ts:300-303`, `241-252`). The core engine changes to match. `glob` compiles with each `[` written as `[[]`, because the core treats a class literally.
- **`sum` and `average` on a declared `integer` or `real` column are the engine's arithmetic.** A `real` sum can differ from a JavaScript left-to-right sum in its final bits. On any other column the core's `parseNumber` coercion has no SQL equivalent (`core/helpers.ts:564-587`), so the aggregate stays residual.

### Rejected

- **A declared capability set.** Coverage depends on the operator, the column's storage and flags, and, on IndexedDB, which index exists. A set cannot state that.
- **Optional hooks alone, with the fallback inside each driver.** That is the 0.0.23 shape (`SQLiteDriver.ts:280-282`, `IndexedDBDriver.ts:244`). It hides the residual, so no test can assert that a native path was taken.
- **A `native` sub-entity holding `plan`, `records`, `stream`, and `aggregate`.** It makes all-or-nothing a type fact, and it restructures every driver class. The conformance check gives the same assurance for a smaller change.
- **A separate `count` hook.** `aggregate` already carries `count`, and another path is another place to disagree.
- **One canonical text order.** Code-unit order keeps SQLite's text order and text ranges in JavaScript, which is the path taverna pays for. Code-point order makes every IndexedDB key range on text inexact. A UTF-16 big-endian database encoding would make SQLite's binary collation match code-unit order; it doubles ASCII text storage, converts on every bind, and its behavior under `node:sqlite` is unread.
- **Keeping Unicode folding in `like`.** SQLite's `LIKE` is neither a superset nor a subset of the Unicode fold, so no prefilter is safe and every `like` stays a full JavaScript scan on SQLite. Unicode-insensitive matching belongs to the text index in § 6.

## 3. The read guard

### Ruling

Remove the guard as a filter. Keep it as an assertion at the read boundary.

- `Table.#cast` raises `DatabaseError` `DRIVER` with `table`, `key`, and the contract's faults when a stored row fails the contract. It runs on the rows a read returns, so a page costs one check per returned row. No read drops a row.
- SQLite's `decodeValue` raises `DRIVER` with `table`, `column`, and `key` for a cell whose storage class does not match its declaration, in place of returning `undefined` (`server/helpers.ts:388-408`). A malformed optional cell passes the 0.0.23 guard as an absent field, which is silent data loss the guard never covered.
- A residual count applies the residual conditions and does not assert the contract, because it returns no row.

`count()` equals `records()` for one input because both read the stored rows: a native count counts them, and `records()` returns each of them or raises. `aggregate('count')` is the same path as `count()`.

### The guard's reason

The reason no longer holds. The remark at `Table.ts:177-180` defends against legacy invalid rows, and scaffold's `AGENTS.md` rules that fleet packages and applications write no accommodation for data an earlier release produced. The remarks on `TableInterface.records`, `count`, and `aggregate` (`core/types.ts:791-813`) are replaced by the invariant: every write is admitted through the contract, so every stored row conforms, and a stored row that fails the contract on read is corruption and raises.

### Rejected

- **The audit's sweep with a per-table trusted mark.** It keeps the skip behavior for an untrusted table, so it keeps two read paths, a persisted mark, a contract fingerprint, an event, and a quarantine call. Each of those accommodates data the greenfield law excludes. It also costs a full guarded scan per table at open after each contract change.
- **SQLite `STRICT` tables or `CHECK` constraints.** `STRICT` refuses the `null` sentinel the driver stores in a column that is both optional and nullable, it cannot express a contract constraint or a `json` shape, it has no IndexedDB equivalent, and it forces every existing file to be rebuilt. It defends against a writer outside `Table`, and no file named in the brief shows one. A consumer with such a writer reopens this ruling.
- **A bulk verification member on `Table`.** The raised error names the table and the key, and `remove(key)` repairs a row without reading it. Add a reporting sweep when a consumer needs bulk diagnosis; it reports and repairs nothing.

## 4. SQLite

- **Per-clause pushdown.** The planner replaces the gate at `SQLiteDriver.ts:271`. Every operator on a flat declared `text`, `integer`, `real`, or `boolean` column is native, so the residual is empty for those reads. A `null` operand on a nullable-only column compiles to `IS NULL` and `IS NOT NULL`. Every text predicate on a column that is both optional and nullable carries a `typeof(…) = 'text'` term, because the sentinel is a blob. A nested path and a `json` or `blob` column follow the coverage table.
- **`starts`.** Compile to `column >= ? AND column < ?`, with the upper bound the prefix whose final code point is incremented, carrying past U+10FFFF and skipping the surrogate range. That form uses an index; `substr` does not (`compilers.ts:255-271`). `ends` keeps `substr`, which is exact and scanned by the engine.
- **`like` and `glob`.** Exact and native under the semantics in § 2. A `like` with a leading `%` is a table scan inside the engine, and it materializes the matching rows only.
- **Transaction capability.** `#capability` gains `plan`, `records`, `stream`, and `aggregate`, each behind `#requireTransaction` (`SQLiteDriver.ts:924-937`). `scanDriver` asserts that the scoped storage declares `plan` whenever the driver does.
- **Statement cache.** Hold it privately in the driver, keyed by SQL text, bounded with least-recently-used eviction, and cleared on `open`, `close`, and `migrate`. Serve `get`, `all`, and `execute` from it. Prepare a fresh statement for `iterate`, because a cached statement with an open iterator cannot be run again. The wrapper needs no change.
- **`get(keys)` and `any`.** Bind the list as one JSON parameter and compile `IN (SELECT value FROM json_each(?))`. One statement text serves every list length, which keeps the cache small, and the bound-parameter limit stops applying. The driver already depends on the JSON functions (`compilers.ts:56`, `102`). The `node:sqlite` parameter limit is unread, and this form makes the reading unnecessary. Return rows in the order of the input keys.
- **`BEGIN IMMEDIATE`.** `transaction` opens with `BEGIN IMMEDIATE` through the wrapper's `execute`; the wrapper's `begin` issues a deferred `BEGIN` (`sqlite/src/server/SQLiteDatabase.ts:132-134`). A deferred transaction that reads and then writes can fail `BUSY` with no wait when another connection holds the write lock, which matches taverna's observation of refusals under a set timeout. Taking the write lock at `BEGIN` lets the busy timeout apply.
- **Busy timeout.** Default `timeout` to one named constant in `server/constants.ts`. `node:sqlite` defaults to zero, which fails every contended write at once (`sqlite/src/server/types.ts:81-84`). I recommend 5000 ms; the unit records the two-connection run behind the value. A scope holds the write lock across its awaits, so the default must exceed a scope's duration.
- **WAL.** Default `journal_mode` to `WAL` for a writable file path. Skip it for `':memory:'` and for `readonly`. A `pragmas.journal_mode` entry wins. Leave `synchronous` to the application, because it trades durability, which is product policy.
- **A second connection to one file.** Document it; the driver cannot detect another process. The guide states that one driver per file is the supported shape, that a second connection works under WAL with the timeout and `BEGIN IMMEDIATE`, that a copy of the main file alone misses the WAL, and that a refusal surfaces as `DRIVER` with `context.retryable` (`SQLiteDriver.ts:1078-1084`).

## 5. IndexedDB

- **Plans beyond one condition.** When every connector is `and`, the planner picks one access path and returns the other conditions as residual. Rank the candidates: primary-key `equals` or `any`, a compound index matched by `equals` on its leading columns, a single-column index with `equals` or `any`, then a range or `starts` on the primary key or an index. IndexedDB has no index intersection, so a second index is never read.
- **`any`.** On the primary key, one `get(keys)` call. On an index, one `only` range per value, merged in primary-key order.
- **`starts`.** A key range from the prefix to its successor, exclusive, where the successor increments the final code unit and carries past U+FFFF. This needs the `rangePrefix` repair in `@orkestrel/indexeddb`.
- **Compound indexes.** `equals` on each leading column, with an optional range on the next column, maps to one range over array keys. The index name comes from `deriveIndexedDBIndexName` (`browser/helpers.ts:282-286`).
- **Rows missing the indexed field.** An index holds no entry for them (`browser/helpers.ts:102-120`). An index drives `below`, `to`, an order, `minimum`, or `maximum` only for a column declared required. The audit left the behavior unconfirmed; the planner already depends on it, and the unit proves it with a browser test.
- **Order.** Native on the primary key in either direction, and on the access-path index when every order term is a required column of that index in one direction. When a filter path and an order path differ, take the filter path and sort the result as residual. With no plannable condition, take the order's index.
- **Paging.** With an empty residual and a native order, read `records(range, limit)` for a zero offset and an ascending read, and a cursor with `advance(offset)` otherwise. With residual conditions, step 3 of § 2 stops the stream early.
- **Count and aggregates.** `count(range)` on the store or the index when the residual holds no condition. `minimum` and `maximum` read one entry from the column's index through a cursor's direction.
- **Streaming.** `scan` and `stream` read batched pages by key range: one batch per transaction, resumed after the final key of the batch, and through the cursor's `seek` on an index. A transaction cannot stay open across the consumer's awaits, so a held cursor is not an option. The stream sees each batch at its own moment; the guide states that. The batch size is one named constant chosen by measurement.
- **Journal.** The core records the prior row of each key a scope writes or deletes, on its first touch, and restores those keys when the scope rejects. A `clear` inside a scope journals that table alone. The journal wraps any driver without `transaction`, and reads inside the scope go to the driver, so native reads see the scope's writes. `DriverInterface.snapshot` has no caller after that and is removed from the contract and from each driver; the `JSONDriver` use at `JSONDriver.ts:740` moves to the same journal. The floor gives rollback on rejection and no crash atomicity, as the snapshot did.
- **Rejected: buffering writes and committing in one native transaction.** It gives an atomic commit, and it forces the core to merge buffered writes into every query result inside the scope, which is package logic over a native read.
- **The fallback the core runs for IndexedDB alone.** `not`, `none`, `like`, `glob`, `ends`, `absent`, a nested path, an `or` fold, a condition beyond the access path, an order no index serves, `sum`, `average`, and the journal.

## 6. Text search

The contract gains a text index, in the text wave, after one design round. Taverna is the named consumer, so the capability meets the minimal-API gate, and taverna must not build its own word-index table.

- **Shape.** `DatabaseOptions.text` declares the indexed text columns per table beside `indexes`, and `ConditionOperator` gains `search`.
- **SQLite.** FTS5.
- **IndexedDB.** No native form. The driver maintains a token store and the planner reads it. This is a fallback the rule admits.
- **Why a design round.** Taverna's search is a substring scan, and FTS5 matches tokens unless it uses the trigram tokenizer. Whether taverna needs substring or token matching, and whether it needs relevance order, which `Order` cannot express, are in no file the brief names. Whether FTS5 is compiled into `node:sqlite` at the declared floor, Node 22.12.0, is unread.
- **Interim.** The paging wave runs taverna's `like` scan inside SQLite and materializes the matching rows only. That removes the row decode and the double read at the measured slice; it remains a table scan, so it does not replace the index at full scale.

Rejected: waiting for a consumer, because one is waiting. Rejected: taverna's own word index, because it duplicates a capability both engines can serve behind one operator.

## 7. Relation

- **Loads.** A load by primary key calls `table.get(keys)` in place of `records` with `any`: the `belongs` load and the `through` target load (`Model.ts:364-376`, `454-466`). A load by foreign key keeps `any`, which is native on SQLite and uses an index on IndexedDB when the application declares one. The relation guide states that an application declares an index on each foreign-key column and each junction column.
- **`link`.** One atomic insert. The junction row's primary key is derived from the pair, `JSON.stringify([key, target])`, and `link` calls `add` and reads `CONFLICT` as already linked. The primary key enforces uniqueness natively on both engines, so `link` needs no count (`Model.ts:210-220`) and no unique index. It emits `link` on an insert only.
- **`unlink`.** One `remove` of the derived key. It emits `unlink` when a row was removed, which matches the event's doc block (`relation/src/core/types.ts:279-282`); 0.0.21 emits always (`Model.ts:253`).
- **Constraint.** A junction's primary column is text and `link` owns its value. Junction rows an earlier release wrote under generated keys are not migrated.

Rejected: a unique index with `add`, because `Model` holds table-only storage and cannot see index declarations. Rejected: a transaction, because `DatabaseStorageInterface` exposes none and a scope cannot nest.

## 8. Units and releases

`@orkestrel/database` declares `@orkestrel/sqlite` and `@orkestrel/indexeddb` (`database/package.json:97-98`), so a wrapper change releases ahead of the database release that uses it. The paging wave needs no wrapper change, so the database goes alone. The sqlite wrapper needs no functional change in any wave.

Every unit's rows-read check uses one instrument: a recording `StorageInterface` in the test setup that counts the rows each driver member returns. `N` is the table, `M` the matching rows, `P` the page, and `K` the keys, as in the audit.

### Paging wave: one database release

This is the smallest release that unblocks `lines-c`. It must include the text-order, `NULL`, and `like` semantics: under the 0.0.23 gate a list ordered by a text column or filtered by `like` keeps a residual, and a residual order reads `M` rows.

| Unit | Scope | Acceptance |
| --- | --- | --- |
| Contract | `core/types.ts`: `Aggregate`, `ReadInput`, `ReadPlan`, `plan`, the rule's doc block | The type check passes. |
| Core | `Table` runs the plan procedure; the guard asserts; `count` is `aggregate`; the tie rule in `sortRows`; `like` and `glob` alignment; `MemoryDriver` and `JSONDriver` drop `stream`; `scanDriver` gains the plan invariants, the capability mirror, and a differential of each planned driver against the core engine over `scan` | A driver without `plan` returns what 0.0.23 returns for the conformance inputs, except a nonconforming row, which raises. The differential passes for every operator, with the text-order case named as the one exemption. |
| SQLite | The planner; the compile forms in § 4 for flat columns; strict decode; the transaction capability; native `sum` and `average` | On a table whose matching set far exceeds the page: `records` with `limit` and `offset` returns `P` rows from the driver and calls `scan` zero times; `count` returns zero rows and runs one statement; a `like` read returns `M` rows; each reading repeats inside `transaction`. A matrix of operator, storage, and flags agrees with the core engine. `EXPLAIN QUERY PLAN` reports an index search for `starts` and for `any` on an indexed column. Record the failing readings on 0.0.23 ahead of the change. |
| IndexedDB port | Express the 0.0.23 planner as a `ReadPlan`: one range condition native, the remaining clauses residual | The browser project passes and the rows read per conformance input equal 0.0.23. |
| Prose | The guide, TSDoc, and comments, after the implementation is final | `npm run test:guides` passes. |

Taverna's adoption check is its own instrument: rerun its `load` unit's readings, quoted in `research/intake.md`, which recorded 1501 rows read for `claim_list` and 255–337 ms for a 10-row search page, and read the same figures on the release.

### Coverage wave: indexeddb, then database, then relation

| Unit | Scope | Acceptance |
| --- | --- | --- |
| indexeddb | `rangePrefix` takes the exact successor as an exclusive upper bound | A store holding the prefix followed by U+FFFF and more returns that row. |
| IndexedDB plans | § 5: access-path ranking, `any`, `starts`, compound indexes, required-column rules, native order, paging, count, `minimum`, `maximum`, batched streaming | `any` over `K` keys returns `K` rows; a page returns at most `P` rows for a native plan; a native count returns zero rows; a stream holds one batch at a time. |
| Journal | The core journal; `snapshot` removed from the contract and each driver | A scope that writes `K` keys reads `K` prior rows and restores `K` on rejection, with zero `scan` calls when the scope does not `clear`. |
| Batches | List overloads on `read`, `write`, `insert`, `delete`; batches are atomic; `Cursor` reads its rows through the list `read` | `set` of `K` rows is one driver call and one commit; `get` of `K` keys is one driver call. A batch with one conflicting row applies no row. |
| SQLite completion | Statement cache; `BEGIN IMMEDIATE`, timeout, and WAL defaults; the rank expression for columns that are both optional and nullable; nested-path prefilters | A timing reading of repeated point reads, with its command, on 0.0.23 and on the change. Two drivers on one file complete interleaved write scopes inside the timeout. |
| relation | § 7 | `link` is one insert and `unlink` one delete on the recorder; two concurrent `link` calls for one pair leave one row. |

### Text wave

The design round in § 6, then one database release. Unique indexes and references join whichever wave follows their consumer.

### Same wave or later

Later. The paging wave already carries the contract change and the semantic changes, and taverna waits on it. The coverage wave changes required members, which touches every driver implementation, and it gains nothing for `lines-c`.

### What each dependent changes

Whether agent, middleware, queue, relation, supervisor, taverna, terminal, toolbox, worker, workflow, or workspace implements a driver or relies on a changed behavior is unread. One sweep of each for the following terms settles it, and under the no-shim law each hit changes in the release that adopts the wave.

| Term | Change the hit needs |
| --- | --- |
| `DriverInterface`, `StorageInterface` implemented or wrapped | Paging: a `records`, `stream`, or `aggregate` hook without `plan` is never called. Coverage: add the list overloads and remove `snapshot`. |
| `matchesQueryExactly`, `matchesConditionExactly`, `matchesOrderExactly`, `matchesAggregateExactly`, `EXACT_COLUMN_STORAGE`, `EXACT_RANGE_COLUMN_STORAGE`, `selectPlan`, `QueryPlan` | Move to the planner exports. |
| A read that expects a nonconforming row to be skipped | Handle the `DRIVER` error or repair the row. |
| `like`, `glob` with non-ASCII case variants or a single-character wildcard | Fold the stored column, or move to the text index. |
| A descending `order`, or a `text` order on SQLite | Accept the tie direction and the binary order. |
| A batch call that relies on rows applied ahead of a failure | Coverage: the batch applies no row. |
| `createMemoryDriver().stream`, `createJSONDriver().stream` called directly | Call `Table.scan`. |

Taverna changes nothing to adopt the paging wave beyond its stated plan: required filter and order columns, declared indexes, and the search path's `like` semantics.

## Decisions that need the user's assent

Each of these changes published behavior. I recommend every row. The paging wave depends on the raising read, the binary text order, the `like` semantics, and the tie direction; the batch row belongs to the coverage wave.

| Decision | Without it |
| --- | --- |
| A nonconforming stored row raises on read | Paging and counting stay in JavaScript, or the sweep and trusted mark return. |
| Text order and text ranges are the engine's binary order | A `text` order on SQLite stays a residual sort over `M` rows. |
| `like` folds ASCII only; `_` and `?` match one code point | Every `like` on SQLite stays a full JavaScript scan. |
| Ties follow the final order term's direction | A descending index read on IndexedDB stays a residual sort. |
| `sum` and `average` are the engine's arithmetic on numeric columns | Both stay in JavaScript on SQLite. |
| A batch applies all rows or none | A native batch cannot run as one transaction. |

## Unread

- **`.claude/rules/architecture.md` § System constraints.** The guide cites it for the scan-first default (`database.md:560`, `2272`). The brief does not name the file. Read it; when it states the scan-first default as law, amend it in scaffold ahead of the paging wave.
- **The `node:sqlite` bound-parameter limit.** Unread, and unnecessary under the `json_each` form. `PRAGMA compile_options` on the declared Node floor settles it.
- **FTS5 and `STRICT` support in `node:sqlite` at Node 22.12.0.** `SELECT sqlite_compileoption_used('ENABLE_FTS5')` and `SELECT sqlite_version()` settle both.
- **`PRAGMA encoding` under `node:sqlite`.** Unread; it bears only on a rejected option.
- **Taverna's optional columns, order columns, and search requirement.** `app/core/schemas.ts` and the plan for its `search` unit settle them.
- **Taverna's load instrument.** The figures come from `research/intake.md`; the measurement itself was not read.
- **Dependents.** The sweep in § 8.
- **Strings with an unpaired surrogate.** How `node:sqlite` binds one is unread; the `starts` successor and the text-order claim exclude them until a boundary test reads it.
- **`JSONDriver.ts` beyond the lines cited.** I read its hook list and line 740 only; the journal unit reads the remaining lines.
- **The compiled `dist` against each checkout.** As in the audit, unconfirmed; I read source at each release commit.
