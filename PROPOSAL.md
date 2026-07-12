# PROPOSAL — `@orkestrel/database`, rebuilt from scratch

> A design document answering: _if `@orkestrel/database` did not exist and we were
> rewriting it today, how would we build it to be production-ready and
> enterprise-grade?_ It treats the current implementation as if it never shipped, but
> mines it — and the legacy multi-backend specs — for every lesson worth keeping. All
> code blocks are **illustrative**: they show the intended shape of a signature or type,
> not the final published API. Follow `AGENTS.md` for every substantive convention;
> where this document and the shipped code disagree, this document states the target and
> the [Deltas](#11-deltas) appendix names the gap.

---

## 1. Mission & thesis

### 1.1 The bridge / single-surface argument

The package's mission, in the owner's words, is that it _"acts as the bridge and single
surface for databases like IndexedDB and SQLite and helps them make up for what they
lack and allows to make the most of their features."_

That sentence contains the whole design. Embedded storage engines are wildly
heterogeneous:

| Engine        | Sync/async | Query power                    | Schema model                         | Transactions                     |
| ------------- | ---------- | ------------------------------ | ------------------------------------ | -------------------------------- |
| In-memory map | sync       | none (you write the loop)      | none                                 | none                             |
| JSON file     | async I/O  | none (dumb persistence)        | none                                 | none                             |
| IndexedDB     | async      | index ranges only, no SQL      | versioned `onupgradeneeded` upgrades | microtask-bound, auto-committing |
| SQLite        | sync-ish   | full SQL — WHERE/ORDER/agg/JON | `CREATE TABLE` / `ALTER` DDL         | `BEGIN` / `SAVEPOINT` / `COMMIT` |

A developer should not have to learn four APIs, four query dialects, four transaction
models, and four schema-evolution stories. The **single surface** is the promise that
one typed API — `Database` / `Table` / `Query` / `Cursor` / `transaction` — runs
_unchanged_ over any of them; you swap the `driver` and nothing else.

The **bridge** is the mechanism that makes the promise honest, and it has two halves:

- **Compensate** — give _every_ driver the full query, transaction, and schema surface
  even when its engine lacks it. A JSON file cannot filter, sort, page, or aggregate; the
  core supplies all of that once, over a single ordered `scan` primitive, so the dumbest
  possible backend is still a first-class database.
- **Exploit** — let a _capable_ engine answer natively through optional driver hooks, with
  well-defined semantics for when its answer is trusted. SQLite compiles a query to a
  parameterized `SELECT`; IndexedDB narrows a read to an `IDBKeyRange`; both inherit
  everything they _don't_ accelerate from the same core engine.

This is deliberately **not an ORM** and **not a second query DSL bolted onto each engine**.
There is no entity graph here, no active-record, no raw-SQL escape hatch that would leak a
dialect back into the single surface. It is the smallest cross-environment core that earns
its keep, plus the thinnest possible seams to each engine.

### 1.2 Goals

1. **One typed surface, any engine.** Identical `Database`/`Table`/`Query`/`Cursor` API and
   semantics across memory, JSON, IndexedDB, and SQLite. Behavior is byte-identical across
   backends; the only observable difference is latency and durability.
2. **A table _is_ a contract.** Schema, row type, write-time coercion + validation, JSON
   Schema introspection, and seed data all flow from one `@orkestrel/contract` declaration.
   Zero `any` / `as` / `!` (AGENTS §1); inference gives users exact row types with no
   annotations.
3. **Core-first.** As much capability as possible lives in env-agnostic `src/core`;
   environment-specific code exists _only_ at driver seams.
4. **Compensate _and_ exploit, provably.** A native path returns exactly what the core
   engine would — enforced by a shared conformance suite, not asserted by faith.
5. **Production-ready.** Cancellation, observability, explicit durability + isolation
   contracts per engine, a real migration story, streaming for large reads, and a linear,
   ReDoS-safe query evaluator on untrusted input.

### 1.3 Non-goals

- **Not an ORM / entity graph.** Relations, eager loading, and joins are a separate concern
  layered _above_ this package, never inside it.
- **No raw-SQL / raw-IndexedDB escape hatch on the single surface.** Reaching a native
  dialect is done by holding the underlying `@orkestrel/sqlite` / `@orkestrel/indexeddb`
  handle directly, outside this package — never through `Database`.
- **No distributed consistency, no networked server, no multi-process coordination.** These
  are embedded, single-process engines; the concurrency model is scoped accordingly (§6).
- **No query cost budgeting / rate limiting in core.** That is application _policy_, not
  database _mechanism_ (AGENTS §21, and see the budget verdict in §8.3).
- **No speculative backend abstractions.** A driver seam is built only when its backing
  `@orkestrel` package exists and a real consumer needs it (AGENTS §21).

---

## 2. Architecture

### 2.1 The three layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Public API      Database · Table · Query · Clause · Cursor       │  ergonomics, typing
├─────────────────────────────────────────────────────────────────┤
│  Query engine    applyCriteria · matchesCriteria · sortRows ·     │  the COMPENSATE core
│                  computeAggregate · wildcardMatch (pure, total)   │  (runs over `scan`)
├─────────────────────────────────────────────────────────────────┤
│  Driver contract DriverInterface — required primitives +          │  the BRIDGE seam
│                  optional native hooks (the EXPLOIT points)       │
├─────────────────────────────────────────────────────────────────┤
│  Drivers         MemoryDriver (core) · JSONDriver (server) ·      │  environment surfaces
│                  IndexedDBDriver (browser*) · SQLiteDriver (srv*) │  (* deferred)
└─────────────────────────────────────────────────────────────────┘
```

The load-bearing idea: **everything above the driver contract is engine-agnostic and lives
in `src/core`.** A driver is a handful of storage primitives; the query engine, the
transaction orchestration, the contract validation, the observation, and the migration
planning all sit in core, over those primitives. A new backend implements the primitives
and inherits the rest — it never re-derives WHERE compilation, ordering, paging, or
aggregation. This is AGENTS §21 ("minimal interface, one engine, native overrides") applied
as the spine of the package.

### 2.2 Surfaces & module layout

Per AGENTS §17, the library splits into environment surfaces, each its own build/export/test
target. Strict-core purity (AGENTS §17.7) is the invariant that keeps the design honest:
`src/core` compiles with `lib: ["ESNext"]` and `types: []` — no DOM, no Node, not even
`crypto`/`console`/timers. If a helper needs a host global, it does not belong in core.

```
src/core/                     @src/core  (CJS, node target — but host-global-free)
  types.ts                    source of truth: Driver/Database/Table/Query/… contracts
  constants.ts                DEFAULT_PRIMARY, MAX_PATTERN_LENGTH, …
  errors.ts                   DatabaseError + isDatabaseError
  helpers.ts                  THE QUERY ENGINE (pure, total) + schema derivation
  migrations.ts               schema-diff → Migration plan (pure)
  factories.ts                createDatabase, createMemoryDriver
  Database.ts  Table.ts  Query.ts  Clause.ts  Cursor.ts
  drivers/MemoryDriver.ts     the reference driver (in-between, no I/O)
  conformance.ts              the shared driver conformance suite (see §4.5)
  index.ts                    the sole public barrel

src/server/                   @src/server  (CJS, node)
  drivers/JSONDriver.ts       write-through JSON-file decorator over MemoryDriver  [NOW]
  drivers/SQLiteDriver.ts     native records/count/aggregate over @orkestrel/sqlite [LATER]
  compilers.ts                Criteria → parameterized SQL (pure)                   [LATER]
  factories.ts                createJSONDriver, createSQLiteDriver
  index.ts

src/browser/                  @src/browser  (ESM, browser)
  drivers/IndexedDBDriver.ts  key-range pushdown over @orkestrel/indexeddb          [LATER]
  helpers.ts                  selectPlan pushdown planner (pure)                    [LATER]
  factories.ts                createIndexedDBDriver
  index.ts
```

**Why `generateKey` (UUID) is a wrinkle to fix.** Today `generateKey` lives in
`src/core/helpers.ts` and reaches for `globalThis.crypto.randomUUID` through a defensive
runtime probe — a host global smuggled into strict core. That violates the spirit of AGENTS
§17.7. In the rebuild, key generation is a **driver responsibility**: `MemoryDriver`
(core-but-host-free) cannot mint a UUID, so the default-key policy moves to where a host
global is legal. Concretely, a row written without a primary key is assigned one by the
driver's environment face — the server/browser drivers use their host `crypto`, and core
callers who want generated keys pass a `key` factory in `DatabaseOptions`. Core stays pure;
the "who mints the id" question is answered at the seam that has an id source. (Delta §11.)

### 2.3 Mapping to package exports

Each surface's `index.ts` is the sole barrel (AGENTS §6). The consumer story:

```ts
// Core: the API + the always-available in-memory driver + everything portable.
import { createDatabase, createMemoryDriver, DatabaseError } from '@orkestrel/database'
// Server: file + (later) SQLite drivers.
import { createJSONDriver } from '@orkestrel/database/server'
// Browser: (later) the IndexedDB driver.
import { createIndexedDBDriver } from '@orkestrel/database/browser'
// The contract vocabulary is re-exported from its own package, never re-barrelled here.
import { stringShape, integerShape } from '@orkestrel/contract'
```

The `tables` declaration and every call are identical regardless of which `driver` is
passed. Driver selection is the _only_ environment-aware line in application code.

---

## 3. Public API design

### 3.1 From schema to typed queries

The developer declares tables once, as a map of `column → ContractShape`, and receives a
fully-typed database with no annotations:

```ts
// ILLUSTRATIVE
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { integerShape, literalShape, optionalShape, stringShape } from '@orkestrel/contract'

const db = createDatabase({
	driver: createMemoryDriver(),
	name: 'app',
	tables: {
		users: {
			id: stringShape(),
			name: stringShape({ min: 1 }),
			age: integerShape({ min: 0 }),
			role: literalShape(['admin', 'member', 'guest']),
			bio: optionalShape(stringShape()),
		},
		posts: { slug: stringShape(), title: stringShape() },
	},
	keys: { posts: 'slug' }, // non-`id` primary-key columns, per table
	indexes: { posts: [['title']] }, // secondary indexes — contracts can't express them
})

const users = db.table('users') // TableInterface<{ id; name; age; role; bio? }> — inferred
await users.set({ id: 'u1', name: 'Ada', age: 36, role: 'admin' }) // coerced + validated
const ada = await users.get('u1') // typed row | undefined — narrowed via the guard, never `as`
const adults = await users.query().where('age').from(18).descending('age').all() // typed rows
```

Each table's value is its **columns** — a `Readonly<Record<string, ContractShape>>`
(`Columns`). A row is always an object, so the database wraps the columns in an `objectShape`
for you; you never write `objectShape` at the table level. The row type is `Infer` of those
columns (`RowOf<C>`), so a typo'd column or a wrong-typed write fails at compile time. That
one declaration is the single source of truth: it types the table, drives write coercion +
validation, produces the JSON Schema, and seeds fixtures — the four-way `@orkestrel/contract`
parity, applied to persistence.

We keep the `tables`-as-columns shape over a hypothetical top-level `defineSchema(...)`
builder because it is already minimal: the map keys are table names, the values are the exact
property maps `objectShape` consumes, and `const` inference captures the literal names and
column types with zero ceremony. A separate `defineSchema` would add a layer without adding
information.

### 3.2 Key entities and responsibilities

| Entity            | Kind      | Responsibility                                                                                                                                      |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Database`        | class     | Owns the driver + `tables` map; lazily connects; `table` / `import` / `export` / `transaction`; DB-level events.                                    |
| `Table`           | class     | Typed keyed CRUD (+ batch overloads) over one table; validates writes and narrows reads via its contract; per-row events; opens `Query` / `Cursor`. |
| `Query`           | class     | Fluent builder → compiles a portable `Criteria`; `filter` is the in-memory JS escape hatch; terminals execute.                                      |
| `Clause`          | class     | A pending condition opened by `where` / `and` / `or`; each operator closes it back to the query.                                                    |
| `Cursor`          | class     | Forward row cursor over a key snapshot, for streaming bulk in-place `update` / `remove`.                                                            |
| `DriverInterface` | interface | The bridge: the minimal storage primitive set + optional native hooks (§4).                                                                         |
| `MemoryDriver`    | class     | The reference driver — nested maps, no I/O; the "in-between" made concrete, identical in browser or server.                                         |

These names and roles are **kept from the current implementation** — they are already
correct, single-word (AGENTS §4.1), and idiomatic. The rebuild changes the driver _contract_
(§4) and adds cancellation, migrations, and streaming (§§5–8), not the entity vocabulary.

### 3.3 What "single surface" means concretely

The following are identical across every backend, guaranteed by the conformance suite (§4.5):

- The `createDatabase({ driver, tables, keys?, indexes? })` entry point.
- The `Table` CRUD verbs and their batch-by-overload semantics (AGENTS §9.2): `get` /
  `resolve` / `has` / `set` / `add` / `update` / `remove` / `clear`, one-in-one-out or
  array-in-array-out under a single verb.
- The fluent `Query` builder and its 15 `Clause` operators, compiling to a serializable
  `Criteria` (no JS callbacks cross the seam).
- The `Cursor` walk (`value` / `index` / `done` / `next` / `update` / `remove`).
- `transaction(scope)` — commit on success, roll every table back on a throw.
- `import` / `export` for moving schemas between databases and environments.
- The `DatabaseError` taxonomy and the typed `emitter` observation channel.

The developer learns this surface once. The bridge guarantees it means the same thing on a
map, a file, IndexedDB, or SQLite.

---

## 4. The driver contract

### 4.1 The required primitive set

The bridge succeeds or fails on this interface being _small_. A new backend should implement
a handful of tiny methods and inherit the entire query/transaction/schema surface.

```ts
// ILLUSTRATIVE — the required surface
interface DriverInterface {
	open(schema: readonly TableSchema[]): Promise<void> // ready tables from the derived schema
	close(): Promise<void> // release the backend
	read(table: string, key: Key): Promise<Row | undefined>
	write(table: string, key: Key, row: Row): Promise<void> // upsert one row at a key
	delete(table: string, key: Key): Promise<boolean> // false if absent (never throws)
	keys(table: string): Promise<readonly Key[]> // ordered key projection
	scan(table: string): AsyncIterable<Row> // ordered full-row stream
	clear(table: string): Promise<void> // empty a table
	snapshot(): Promise<() => Promise<void>> // universal transaction floor
}
```

Justification, primitive by primitive:

- **`open` / `close`** — lifecycle. `open` receives a derived `TableSchema[]` (columns, portable
  `ColumnType`, primary key, declared indexes) so a native backend can build real tables and
  indexes; a scan-only backend reads only `name`. Non-negotiable.
- **`read`** — a point get is O(1) on every engine; synthesizing it from `scan` would be O(n).
  Earns its place.
- **`write` / `delete`** — the point mutations. `delete` returns `false` for an absent key
  rather than throwing (AGENTS §12: absence is not an error).
- **`scan`** — _the_ substrate. The entire compensate engine (filter/sort/page/aggregate) runs
  over an ordered row stream. Every backend can produce one. This is the single most important
  primitive: it is what lets the dumbest engine be a full database.
- **`keys`** — a cheap ordered key projection (`SELECT id`, `getAllKeys`, `[...map.keys()]`). It
  is _derivable_ from `scan` + the schema's primary column, but only wastefully (hydrating whole
  rows to read one field). Every real backend answers it cheaply, so it stays a primitive rather
  than a dead-code fallback. Used by `Cursor` (a stable key snapshot) and `Table.keys()`.
- **`clear`** — a bulk empty (`TRUNCATE`, `objectStore.clear()`, `map.clear()`). Also derivable
  (`keys` then `delete` each) but at O(n) round-trips; every engine has a native O(1)-ish path,
  so it stays.
- **`snapshot`** — the irreducible transaction floor. Returns a rollback thunk that restores
  every table to the captured state. This is the _universal_ mechanism that makes transactions
  work on engines with no native transaction concept (§6).

**On minimalism (7 vs 9).** One could shave `keys` and `clear` to optional native
accelerations and require only 7 primitives (open/close/read/write/delete/scan/snapshot). We
deliberately do **not**: every conceivable backend implements `keys` and `clear` trivially and
cheaply, so making them optional would ship strictly-slower fallback code paths that never run
in practice — minimalism for its own sake. The design budget is better spent on the
_exploitation_ hooks below, which unlock real native power. This is a change of emphasis from
"fewest possible required methods" to "smallest _stable_ required contract, richest optional
seam."

### 4.2 Optional capability hooks (the exploit points)

A backend that can go faster implements one or more optional hooks. `Table` prefers a present
hook and falls back to the engine over `scan` when it is absent (AGENTS §21).

```ts
// ILLUSTRATIVE — the optional surface, added to DriverInterface
  records?(table: string, criteria: Criteria): Promise<readonly Row[]>          // native filtered read
  stream?(table: string, criteria: Criteria): AsyncIterable<Row>                // native filtered STREAM (new)
  count?(table: string, criteria: Criteria): Promise<number>                    // native count
  aggregate?(table: string, operation: AggregateFunction,
             column: FieldPath, criteria: Criteria): Promise<number | undefined>// native aggregate
  transaction?(): Promise<TransactionInterface>                                 // native BEGIN/COMMIT/ROLLBACK (new)
  migrate?(plan: Migration): Promise<void>                                      // native DDL / version upgrade (new)
```

`records` / `count` / `aggregate` exist today and are kept. The rebuild adds three:

- **`stream`** — filtered async-iteration, so a large result set never fully materializes. SQLite
  `iterate()` and IndexedDB cursors both support it natively. Fallback: the engine filters the
  required `scan`.
- **`transaction`** — a native transaction handle (`{ commit(); rollback() }`), so a capable
  engine uses `BEGIN … COMMIT/ROLLBACK` (or a `SAVEPOINT`) instead of whole-store capture-replay.
  This is the single most important new hook — see §6.
- **`migrate`** — apply a `Migration` plan natively (SQLite `ALTER`/`CREATE INDEX`, IndexedDB
  version bump). Fallback: the portable scan-transform-rewrite (§5.5).

### 4.3 The capability-negotiation model: trusted vs verified

Negotiation is **structural, by presence** — no capability descriptor object, no feature flags.
`Table` calls `driver.records?.(…)`; a `?.()` that resolves to `undefined` means the method is
_absent_ (fall back to the engine); a present method returns a `Promise` whose resolved value is
the answer. (The one subtlety, preserved from today: `aggregate?` legitimately resolves to
`undefined` for an empty aggregate, so presence is detected by the _method_, not the resolved
value.)

When a native hook _is_ present, the core operates in one of two modes, and every driver
declares which one it is in for each hook by construction:

- **Trusted (return the exact answer).** SQLite compiles the whole `Criteria` to a
  parameterized `SELECT`; its `records`/`count`/`aggregate` are exact, and the core returns them
  as-is (after the per-row contract guard). The core _trusts_ the driver.
- **Narrow-then-refine (return a superset, refine internally).** IndexedDB can only push
  _exact-comparison_ operators over an indexed, orderable column down to an `IDBKeyRange`. Its
  `records` fetches a candidate **superset** and then runs the core engine over that superset
  _inside the driver_ before returning — so the value handed back to `Table` is already exact.
  The refinement lives in the driver, not the core; the core still simply trusts the return.

The trust is not faith — it is **earned by the conformance suite** (§4.5), which asserts, for
every operator, and/or mix, ordering, paging, aggregate, and a zero-match case, that the native
path deep-equals the engine over the same data. In production the core trusts; in CI the suite
verifies. A driver that cannot prove parity for a hook simply omits it and inherits the
compensate path — correctness is never at risk, only speed.

### 4.4 Semantics & invariants every driver must uphold

These are the contract's teeth — the properties the core relies on and the conformance suite
enforces:

1. **Ordering.** `scan` and `keys` yield in a single, backend-agnostic key order: the core
   `compareValues` total order (`undefined` < `null` < boolean < number < string < other; `NaN`
   last, comparator never returns `NaN`). This is what makes an _unordered_ read agree across
   backends instead of leaking Map insertion order, SQLite rowid order, or IndexedDB key order.
2. **Value isolation.** Rows are copied in and out; a caller can never mutate stored state by
   reference, and a stored row can never be mutated by a later caller mutation (AGENTS §11).
3. **Point-write is upsert.** `write` replaces the row at a key wholesale. `add`/`CONFLICT`
   semantics are enforced in `Table` (read-before-write), not the driver.
4. **Absence returns, never throws.** `read` → `undefined`, `delete` → `false` for a miss. Only
   programmer/validation errors throw (AGENTS §12).
5. **Atomicity of `snapshot` rollback.** After the rollback thunk resolves, every table is
   exactly the captured state — all-or-nothing.
6. **Native == engine.** Any implemented hook returns exactly what the engine would (trusted or
   narrow-then-refined). Proven by conformance.
7. **Untyped boundary is validated, never asserted.** A driver deserializing external bytes (the
   JSON file, a SQLite `TEXT` column holding JSON) narrows with guards, never `as` (AGENTS §14);
   a malformed record is skipped, a corrupt store starts empty.
8. **Isolation/durability are declared, not assumed.** Each driver documents its transaction
   isolation and durability guarantees against the matrix in §6.3 — the core does not pretend a
   file flush is a WAL fsync.

### 4.5 The shared conformance suite

Today, parity is proven by hand-written per-driver tests. The enterprise upgrade is to ship a
**single reusable conformance suite** that every driver — in-repo _and_ third-party — runs
against its own factory:

```ts
// ILLUSTRATIVE — a shipped, importable spec-as-code
import { conform } from '@orkestrel/database/conformance'
import { createSQLiteDriver } from '@orkestrel/database/server'

// One call exercises the entire DriverInterface contract + every native hook the driver
// implements, and asserts native == engine across the full operator/order/page/aggregate matrix.
conform('SQLiteDriver', () => createSQLiteDriver(':memory:'))
```

The suite is production code (an executable specification), not a private test file: it is the
mechanism by which "trusted" is _earned_, and it is how an external author proves a new backend
is a first-class citizen without re-deriving the parity matrix. It exercises: every primitive;
key-order guarantees; value isolation; snapshot-rollback atomicity; the CONFLICT/NOT_FOUND/
VALIDATION paths; and — for each implemented hook — deep-equality with the engine over the same
seeded data, including the zero-match `undefined` aggregate edge. (Delta §11: this reusable
packaging does not exist today.)

---

## 5. Compensate & exploit, engine by engine

The `TableSchema` handed to `open` is the contract-derived description each engine consumes:

```ts
// ILLUSTRATIVE
interface TableSchema {
	readonly name: string
	readonly primary: string
	readonly columns: readonly ColumnSchema[] // { name, type: ColumnType, nullable }
	readonly indexes: readonly (readonly string[])[]
}
// ColumnType = 'text' | 'integer' | 'real' | 'boolean' | 'json' | 'blob'
// derived per column from its ContractShape by `columnType` (json covers object/array/union/raw).
```

### 5.1 Memory (core, `MemoryDriver`)

- **Offers:** nested `Map`s, synchronous, no I/O; runs identically in a browser or on a server.
- **Lacks:** persistence, native query. **Compensate:** the engine over `scan` answers every
  query; `snapshot` clones every table for an exact rollback point.
- **Role:** the reference driver and the conformance _oracle_ — every other backend must match
  its results. Scan-only (implements no native hooks). It is the storage behind tests, ephemeral
  caches, and any code that wants the API without a backend.

### 5.2 JSON file (server, `JSONDriver`)

- **Offers:** durable, human-inspectable, portable single-file storage.
- **Lacks:** everything else. **Compensate:** it is a _decorator_ over `MemoryDriver` — every
  primitive delegates to an inner memory driver, so query, key-order `scan`/`keys`, and
  capture-replay `snapshot` are inherited unchanged. It adds only load-on-`open` and
  flush-on-mutation. Scan-only; the engine answers every query.
- **Two production hardenings over today (Delta §11):**
  - **Atomic durability.** Today `flush` does a bare `writeFile` — a crash mid-write corrupts the
    file. The rebuild writes to a temp file and `rename`s (atomic on POSIX), so a torn write
    never yields a corrupt store.
  - **Coalesced flushes.** Today every write flushes the _whole_ store, so a 1000-row batch does
    1000 full-file rewrites. The rebuild flushes once per transaction commit (and coalesces
    outside a transaction), turning O(writes) file rewrites into O(commits).
- **Boundary safety:** the parsed file crosses as `unknown`, narrowed with `isRecord` /
  `extractKey`; a missing/corrupt/wrong-shaped file starts empty, a malformed row is skipped
  (AGENTS §14).

### 5.3 IndexedDB (browser, `IndexedDBDriver` — deferred to `@orkestrel/indexeddb`)

- **Lacks:** SQL, rich queries, sort/aggregate, synchronous access. **Compensate:** the engine
  over `scan` supplies WHERE/order/page/aggregate; membership, negation, pattern, existence, and
  nested-path operators always run over a full scan.
- **Offers, and how core exploits it:**
  - **Secondary indexes** — `open` reads `TableSchema.indexes` and creates them
    (`createIndex`), matching the declared column-name groups.
  - **Native key ranges** — a `selectPlan` pushdown planner turns a `Criteria` into an
    `IDBKeyRange` over the primary key or a single-column secondary index, but only for the six
    exact-comparison operators over an orderable (`text`/`integer`/`real`) column with a scalar
    operand. It fetches a **superset**, then refines through the engine (the _narrow-then-refine_
    mode of §4.3) — so a native read is byte-identical to a full scan, just over fewer rows.
    Implements `records` / `count` / `stream`; **no** native `aggregate` (IndexedDB has no
    `SUM`/`AVG`), so the engine over the narrowed rows covers aggregation.
- **Schema evolution (see §5.5):** IndexedDB is schemaless per-record, so adding a "column" is
  free (no upgrade needed); adding an _index_ or a _store_ needs a `version` bump inside
  `onupgradeneeded`. The wrapper's auto-managed version mode bumps once to create any declared
  store/index the stored schema lacks — so most schema growth needs no manual version bookkeeping.
- **Transactions:** IndexedDB's native transactions are microtask-bound and auto-commit the
  moment control yields to a non-IndexedDB task, which makes them unusable as a long-lived,
  user-scoped `transaction(scope)`. So this driver keeps the **universal `snapshot`** floor
  rather than implementing the native `transaction?` hook (§6.2).

### 5.4 SQLite (server, `SQLiteDriver` — deferred to `@orkestrel/sqlite`)

- **Offers, and how core exploits it — the richest backend:**
  - `open` issues `CREATE TABLE` with real typed columns (from `ColumnType`) and `CREATE INDEX`
    from the declared indexes.
  - A `Criteria` compiles to a parameterized SQL `SELECT` via a pure `compileCriteria`
    (WHERE/ORDER/LIMIT), so filter, sort, and page run _in SQLite_. The WHERE fold parenthesizes
    left-to-right to mirror the engine's `matchesCriteria` exactly.
  - Implements **all** native hooks — `records` / `stream` (`iterate()`) / `count` /
    `aggregate` (`COUNT`/`SUM`/`AVG`/`MIN`/`MAX`) — in the _trusted_ mode: SQL is exact, the core
    returns it as-is. Nested `FieldPath` columns compile to `json_extract`.
  - **Native transactions** — implements the `transaction?` hook with `BEGIN … COMMIT/ROLLBACK`,
    getting real atomicity, isolation, and durability instead of capture-replay (§6.2).
- **Injection safety:** every value binds as a parameter — never string-interpolated. `starts` /
  `ends` compile to `LIKE … ESCAPE '\'` with escaped operands so they match literally. There is
  no dynamic-SQL path from user input to a query string (§8.6).
- **Codecs** are total: an ill-fitting value encodes to `null`; a stored `NULL` decodes to
  `undefined` (an absent optional column is omitted from a decoded row). Boolean ↔ 1/0, objects ↔
  JSON text.

### 5.5 Schema evolution & migrations across engines

The single biggest _capability_ gap in the current design is that there is **no migration
story** — the legacy spec explicitly ships "no migration runner." For enterprise use this is
untenable: schemas change, and the three engines evolve schema in three incompatible ways
(IndexedDB version upgrades, SQL DDL, JSON rewrite). The rebuild adds a portable migration model.

**The model:** a `Migration` is a pure diff between two `TableSchema[]` (the deployed schema and
the declared one), computed in core:

```ts
// ILLUSTRATIVE — pure, in src/core/migrations.ts
type MigrationStep =
	| { readonly operation: 'table.add'; readonly table: TableSchema }
	| { readonly operation: 'table.remove'; readonly table: string }
	| { readonly operation: 'column.add'; readonly table: string; readonly column: ColumnSchema }
	| { readonly operation: 'column.remove'; readonly table: string; readonly column: string }
	| { readonly operation: 'index.add'; readonly table: string; readonly index: readonly string[] }
	| {
			readonly operation: 'index.remove'
			readonly table: string
			readonly index: readonly string[]
	  }

interface Migration {
	readonly from: number // deployed schema version
	readonly to: number // declared schema version
	readonly steps: readonly MigrationStep[]
}
// migrate(deployed, declared): Migration — a pure schema-diff (discriminant named for its axis, §4.4)
```

Each driver realizes a `Migration` in its native idiom via the optional `migrate?` hook, and the
core supplies a portable fallback for engines without one:

| Engine    | `migrate?` realization                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite    | `ALTER TABLE ADD COLUMN`, `CREATE/DROP TABLE`, `CREATE/DROP INDEX`; version tracked in `user_version` PRAGMA.                               |
| IndexedDB | a `version` bump in `onupgradeneeded`: `createObjectStore` / `createIndex` / `deleteObjectStore`; column adds are no-ops (schemaless rows). |
| JSON      | portable fallback: scan → transform each row (drop removed columns, default added ones) → atomic rewrite.                                   |
| Memory    | no-op beyond adopting the new schema (nothing persistent to migrate).                                                                       |

Because column defaults and data backfills are _policy_, a `column.add` carries only the column
schema; a migration that needs a computed backfill supplies a per-step transform at the
application layer (mechanism-not-policy, AGENTS §21). `export()` already emits a portable
JSON-Schema-per-table, which is the natural artifact to diff for authoring migrations across
environments. (Delta §11: the entire migration surface is new.)

---

## 6. Transactions & consistency

### 6.1 The snapshot/rollback model (the universal floor)

The current model is elegant and _kept_ as the floor: `transaction(scope)` takes a `snapshot`,
runs the scope, and on a throw calls the rollback thunk to restore every table, then rethrows —
one uniform optimistic model rather than reconciling SQL's `BEGIN/COMMIT/ROLLBACK` with
IndexedDB's microtask-bound transactions. It works on _every_ engine because every engine can
capture and restore state.

Its limits, stated honestly:

- **Whole-store, O(n) memory.** `snapshot` clones every table. For a large store this is a real
  cost. The rebuild lets a driver **scope** the snapshot to the tables the scope will touch (an
  optional `snapshot(tables?)` argument), and prefers the native `transaction?` hook (below) where
  the engine can avoid the copy entirely.
- **No isolation.** It is single-writer optimistic: concurrent writers are not isolated, and a
  rollback restores a whole-store snapshot, so an interleaved unrelated write would also be undone.
  This is acceptable _because_ the target engines are single-process embedded stores (§6.4), and
  it is documented, not hidden.

### 6.2 Native transaction exploitation (the key improvement)

The current `DriverInterface` exposes only `snapshot(): Promise<() => Promise<void>>` — a
rollback thunk with **no commit signal**. That single omission forces even SQLite to abandon its
native `BEGIN/COMMIT` and fall back to capture-replay, because a long-lived `SAVEPOINT` would
leave the connection in an uncommitted transaction with no signal to close it. The core catches
success but never tells the driver "commit."

The rebuild fixes this by adding the optional `transaction?()` hook returning a handle with
_both_ outcomes:

```ts
// ILLUSTRATIVE
interface TransactionInterface {
  commit(): Promise<void>
  rollback(): Promise<void>
}

// Database.transaction, illustrative orchestration:
async transaction<R>(scope: () => Promise<R>): Promise<R> {
  await this.#connect()
  const native = await this.#driver.transaction?.()          // exploit if available…
  if (native !== undefined) {
    this.#emitter.emit('transaction')
    try { const value = await scope(); await native.commit(); this.#emitter.emit('commit'); return value }
    catch (error) { await native.rollback(); this.#emitter.emit('rollback', error); throw error }
  }
  const rollback = await this.#driver.snapshot()             // …else the universal floor
  this.#emitter.emit('transaction')
  try { const value = await scope(); this.#emitter.emit('commit'); return value }
  catch (error) { await rollback(); this.#emitter.emit('rollback', error); throw error }
}
```

Now SQLite runs a real `BEGIN … COMMIT/ROLLBACK` — genuine atomicity, isolation, and durability,
no O(n) copy. Memory and JSON keep the snapshot floor. IndexedDB keeps the snapshot floor (its
native transactions can't span a user scope). This is exactly the compensate-and-exploit pattern
of §4, applied to transactions instead of reads. (Delta §11.)

### 6.3 Guarantees & limits per engine

| Engine    | Mechanism                   | Atomic | Isolation                  | Durable on commit                   |
| --------- | --------------------------- | ------ | -------------------------- | ----------------------------------- |
| Memory    | whole-store snapshot        | yes    | none (single process)      | n/a (ephemeral)                     |
| JSON      | snapshot + coalesced flush  | yes    | none (single process)      | on commit (atomic temp-file rename) |
| IndexedDB | whole-store snapshot buffer | yes    | none (single connection)   | yes (IndexedDB persists)            |
| SQLite    | native `BEGIN`/`COMMIT`     | yes    | serializable (single conn) | yes (WAL/fsync per PRAGMA)          |

Every driver declares its row in this matrix; the conformance suite asserts the atomicity and
commit/rollback behavior, and the docs state durability/isolation explicitly so no one mistakes
a JSON flush for a WAL fsync.

### 6.4 Concurrency & change events

- **Single-writer optimistic.** The concurrency model is one logical writer per store within one
  process. Batch verbs run as _independent sequential_ operations (never racing); wrap them in
  `transaction` for atomicity. This matches the reality of embedded engines and is stated as the
  contract, not left implicit.
- **Optional optimistic concurrency (future).** For the cases that need conflict detection, a
  version-column compare-and-set (`update` gated on an expected version) is a natural additive
  layer over the existing contract — proposed for phase-later, not built speculatively.
- **Change events via `@orkestrel/emitter`.** Observation is the concurrency-adjacent surface that
  _does_ ship now: `Database` and each `Table` own a typed `emitter` (§7.4), so a cache layer or
  sync engine reacts to `write` / `remove` / `clear` and `commit` / `rollback` without polling.

---

## 7. Type strictness & validation

### 7.1 `@orkestrel/contract` as the backbone

`@orkestrel/contract` is not a dependency here — it is the _backbone_, used aggressively at
every layer. A table is a contract; that is the whole type story.

- **Where shapes are defined.** In the user's `tables` map: each column is a `ContractShape`
  (`stringShape` / `integerShape` / `objectShape` / `literalShape` / …). The database wraps a
  table's columns in an `objectShape`.
- **Where they're compiled.** `Table` builds one compiled contract per table via
  `createContract(objectShape(columns))`, giving `{ schema, is, parse, generate }`. For `export`,
  `compileSchema(objectShape(columns))` emits the portable JSON Schema without instantiating the
  full `Infer` (avoiding TS's instantiation-depth guard over the open column union).
- **Where they're enforced.** At every trust boundary:
  - **Writes** run through `contract.parse` — coercion (`'36'` → `36`) _and_ refinement
    enforcement (`min` / `max` / `pattern`), so a non-`undefined` parse already satisfies the
    guard (AGENTS §14 parse↔guard soundness). A row that can't be coerced throws `VALIDATION`.
  - **Reads** narrow a stored `Row` back to the table's row type through the guard `contract.is` —
    never an `as` (AGENTS §1). A row that fails the guard is treated as absent.
  - **Driver deserialization** (JSON file bytes, SQLite JSON columns) narrows with `isRecord` /
    `extractKey` guards.
  - **`import`** across environments re-validates the incoming shape.

### 7.2 Inference gives exact row types

`RowOf<C>` is `Infer` of a column map's `objectShape`, so `db.table('users')` returns
`TableInterface<{ id: string; name: string; age: number; role: 'admin' | 'member' | 'guest';
bio?: string }>` with zero annotations. The `const` type parameter on `createDatabase` captures
literal table names and column types. The broad, held-at-default `Columns` short-circuits `RowOf`
to `Row` so the open shape never trips the instantiation-depth guard.

### 7.3 Error taxonomy

Programmer/validation errors `throw` a typed `DatabaseError` carrying a machine-readable `code`
and an optional `context` bag; absence returns `undefined`/`false`; guards never throw
(AGENTS §12/§14). The current four codes are extended for the new surface:

| `DatabaseErrorCode` | Thrown when                                          | Status         |
| ------------------- | ---------------------------------------------------- | -------------- |
| `CLOSED`            | operating on a closed database                       | kept           |
| `NOT_FOUND`         | `resolve` on an absent key                           | kept           |
| `CONFLICT`          | `add` onto an existing key                           | kept           |
| `VALIDATION`        | a row fails its contract; a pattern exceeds the cap  | kept           |
| `ABORTED`           | an operation is cancelled via its `signal`           | **new** (§8.2) |
| `MIGRATION`         | a schema migration cannot be applied                 | **new** (§5.5) |
| `DRIVER`            | an unexpected backend I/O fault, wrapped at the seam | **new**        |

`catch` branches on `error.code` via `isDatabaseError`, never by parsing a message. Driver-native
faults (a SQLite `CONSTRAINT`, an IndexedDB `QuotaExceededError`) are mapped at the seam to a
`DatabaseError` with a `context` carrying the native code — the single surface never leaks a
backend's error type.

### 7.4 Observation (typed events)

Per AGENTS §13, `Database` and each `Table` own an `Emitter` and expose it as `readonly emitter`.
`DatabaseEventMap` = `open` / `close` / `transaction` / `commit` / `rollback(error)`;
`TableEventMap` = `write(key)` / `remove(key)` / `clear` (key only — no value payload, to keep
fan-out lean and avoid leaking row data). Every event fires _after_ the relevant transition, and
the emitter isolates a throwing listener (routing it to the emitter's own `error` handler), so a
buggy observer can never reorder, throw into, or corrupt a write or a transaction. This is kept
as-is — it is already correct and well-tested.

---

## 8. Production-readiness

### 8.1 Observability

The `emitter` surface (§7.4) is the fire-and-forget observation channel for logging, metrics,
tracing, cache invalidation, and sync. It is a _pure side-channel_: emitting never changes what a
write or a transaction does. For enterprise tracing we thread an optional trace `id` (an
`@orkestrel/abort` handle's `id`, §8.2) through a scope so a transaction's events correlate.

### 8.2 Cancellation (`@orkestrel/abort`) — ADOPT

The current implementation has **no cancellation at all** — a long `scan`, a large `records`, or
a slow transaction cannot be aborted. For a production database this is a real gap. The rebuild
adopts `@orkestrel/abort` and threads an `AbortSignal` through the long-running seams:

```ts
// ILLUSTRATIVE — a light options bag, since a signal is not serializable and must NOT enter Criteria
interface ReadOptions { readonly signal?: AbortSignal }

records(criteria?: Criteria, options?: ReadOptions): Promise<readonly T[]>
scan(criteria?: Criteria, options?: ReadOptions): AsyncIterable<T>       // public streaming terminal (§8.5)
transaction<R>(scope: () => Promise<R>, options?: ReadOptions): Promise<R>
```

The signal is checked at each `scan` step and before each batch operation; an aborted signal
throws `DatabaseError('ABORTED')` (or rejects with `signal.reason`). It is threaded natively into
SQLite (`iterate()` loop check) and IndexedDB (cursor step check). A signal never enters
`Criteria` — `Criteria` stays a serializable, callback-free read spec that any backend can
compile, exactly as the post-fetch `filter` predicate is kept off it today. Parent-linking
(`AbortSignal.any`) means one request-scoped abort cascades to every query it spawned. **Verdict:
adopt.**

### 8.3 The timeout / budget verdict

The owner is unsure `@orkestrel/timeout` and `@orkestrel/budget` are needed. Neither is currently
referenced anywhere in the codebase or guides. The recommendation is clear:

- **`@orkestrel/timeout` — DECLINE (for this package).** A per-operation timeout is "abort after N
  ms," and once the abort seam (§8.2) exists, a timeout is expressible with _zero dependencies_
  using the platform primitive: `records(criteria, { signal: AbortSignal.timeout(ms) })`, or by
  linking a caller `Abort` to `AbortSignal.timeout(ms)`. Adding `@orkestrel/timeout` would buy a
  thin convenience over a native one-liner (AGENTS §1: prefer native APIs, no unsolicited
  dependencies). We instead **document the `AbortSignal.timeout` idiom** as the supported way to
  bound a query. If a future need for _cumulative deadlines across a chain_ appears, that is a
  budget concern, below — not a timeout one.

- **`@orkestrel/budget` — DECLINE.** A budget is a cumulative cost/rate limiter (total operations,
  total time or spend across a sequence, throttling). A database engine ships the _mechanism_ of
  storage and querying and stops at the line where application _policy_ begins (AGENTS §21,
  "mechanism, never policy"). Capping how many queries a tenant may run, or how much scan cost a
  request may spend, is application governance that belongs _above_ the database, composed by the
  consumer — not baked into `Table`. Putting it in core would couple the storage mechanism to a
  policy decision it has no business owning. If an application wants it, it wraps the database;
  the package stays a clean mechanism.

Net dependency set: **`@orkestrel/contract`** (backbone), **`@orkestrel/emitter`** (events),
**`@orkestrel/abort`** (cancellation) — plus, at the deferred driver seams, **`@orkestrel/sqlite`**
and **`@orkestrel/indexeddb`**. No timeout, no budget.

### 8.4 Durability & resource lifecycle

Durability is declared per driver (§6.3), not assumed: memory is ephemeral; JSON is durable on
commit via atomic temp-file rename; IndexedDB and SQLite persist, with SQLite's WAL/fsync
behavior exposed via PRAGMA at the wrapper. Resource lifecycle follows AGENTS §10: `open`
(idempotent, lazy on first use), `close` (releases the driver; a reconnect re-opens), and
deterministic teardown (`emitter.destroy()` last). A driver holds exactly one native handle and
releases it on `close`.

### 8.5 Performance posture

- **Indexes.** Declared `indexes` flow into `TableSchema` and become real `CREATE INDEX` /
  `createIndex` on capable backends; scan-only backends ignore them.
- **Pushdown.** SQLite compiles the whole query; IndexedDB narrows to a key range. The core never
  pulls more rows than it must on a capable backend.
- **Streaming.** `records` materializes; the new public `scan(criteria?)` terminal (and
  `Query.stream()`) yields rows via async iteration over the driver's `stream?`/`scan`, so a
  million-row read never holds a million rows in memory. Cursors already stream keys.
- **ReDoS safety.** `like` / `glob` / `starts` / `ends` run the linear greedy two-pointer
  `wildcardMatch` — never a backtracking regex — with a `MAX_PATTERN_LENGTH` cap, so an
  attacker-supplied pattern is O(value × pattern), never catastrophic. Kept as-is; it is exactly
  right for a surface that may evaluate model- or client-supplied criteria.

### 8.6 Security

- **No dynamic-SQL injection path.** SQLite binds every operand as a parameter; identifiers are
  quoted with doubled quotes; `LIKE` operands are escaped. There is no code path from user input
  to an interpolated query string.
- **Validated deserialization.** Every untyped boundary (file bytes, JSON columns, imported
  schemas) is guard-narrowed, never asserted; adversarial input yields a skipped row or an empty
  store, never a crash or a smuggled value (AGENTS §14).
- **Bounded evaluation.** The pattern cap and the total, never-throwing query helpers mean hostile
  criteria degrade to a non-match, not a hang or a stack blow-out.

---

## 9. Quality engineering

- **TTTDD (AGENTS §2).** Types in `*/types.ts` first (the driver contract, the entities, the
  migration types), implementation conforms to them, then consolidation, then hardening tests,
  then guides. `types.ts` is the source of truth; the implementation never contradicts it.
- **Driver conformance suite (§4.5).** The centerpiece of the test strategy: one shared,
  importable suite that every driver runs, proving the single surface means one thing everywhere
  and every native hook equals the engine. This is how "enterprise-grade" is _demonstrated_, not
  claimed.
- **Guides parity (AGENTS §22).** `database.md` documents the surface, and a parity test asserts
  every backticked API resolves to a real export, every public export is documented, and each
  interface's `## Methods` table exactly matches its real call-signature members. The guide's
  parity scope spans the core module _and_ the backend-driver modules that implement the contract.
- **Gates (AGENTS §17.8), in order.** `format` → `lint` (house rules: no `any`/`as`/`!`/default
  exports) → `check` (typecheck, incl. the per-surface `lib`/`types` isolation that enforces
  strict-core purity) → `build` (per-surface CJS/ESM) → `test` (scoped per surface×environment).
- **CI** runs the full gate sequence per surface, with the browser drivers tested in real Chromium
  and the server drivers in node; the conformance suite runs for every driver on every backend.
- **Versioning & publishing.** SemVer; the public surface is the barrels plus the documented
  method tables. The driver contract is the most stability-sensitive type — a change to
  `DriverInterface`'s _required_ members is a breaking change for every driver, which is precisely
  why the rebuild invests in a stable required set (§4.1) and puts all growth in optional hooks
  (adding an optional hook is backward-compatible). `prepublishOnly` runs the full gate sequence.
- **Deprecation.** Greenfield discipline (AGENTS §21): no backwards-compat shims; a rename updates
  every consumer in the same change. Between majors, a deprecation is a documented `@deprecated`
  window, never a silent alias.

---

## 10. Roadmap

### Phase now — standalone-ready core (memory + JSON)

Ship the complete single surface on the two always-available backends.

- Core: `Database` / `Table` / `Query` / `Clause` / `Cursor`, the pure query engine, the
  `DriverInterface` (required primitives + the `transaction?` / `stream?` / `migrate?` optional
  hooks defined even though only memory/JSON exist), `MemoryDriver`, the migration model, the
  conformance suite, cancellation threading, and the emitter observation.
- Server: `JSONDriver` with atomic durability and coalesced flushes.
- **Acceptance:** the conformance suite passes for `MemoryDriver` and `JSONDriver`; strict-core
  purity holds (core compiles with `lib: ESNext`, `types: []`); guides parity green; cancellation
  aborts a long scan; a JSON crash-during-write leaves a valid prior file; `transaction` uses the
  snapshot floor and rolls back atomically.

### Phase next — the capable backends (IndexedDB + SQLite)

Built _against_ their real backing packages once those exist, never speculatively (AGENTS §21).

- Browser: `IndexedDBDriver` over `@orkestrel/indexeddb` — secondary indexes, `selectPlan`
  key-range pushdown (narrow-then-refine `records`/`count`/`stream`), version-upgrade migrations.
- Server: `SQLiteDriver` over `@orkestrel/sqlite` — full trusted `records`/`stream`/`count`/
  `aggregate` via `compileCriteria`, native `transaction?` (`BEGIN/COMMIT`), DDL migrations.
- **Acceptance:** the _same_ conformance suite passes for both new drivers against the memory
  oracle (native == engine across the full operator/order/page/aggregate/zero-match matrix); the
  SQLite driver exercises the native `transaction?` path; the IndexedDB driver proves
  pushdown == scan; both persist across reopen; no dynamic-SQL path exists.

### Phase later — additive, on real demand

- Optimistic-concurrency compare-and-set (`update` gated on an expected version).
- Sync / replication hooks built _on_ the existing change events (`write`/`remove`/`commit`),
  never inside core.
- Deeper observability (query timing spans) if metrics needs materialize.
- **Acceptance:** each is additive — it leaves the phase-now surface unchanged and ships only when
  a concrete consumer exists.

---

## 11. Deltas — current implementation vs this proposal

An honest appendix so the owner sees a migration path, not a greenfield fantasy.

### Where today already matches this proposal (keep as-is)

- **Entity vocabulary & roles.** `Database` / `Table` / `Query` / `Clause` / `Cursor` /
  `DriverInterface` / `MemoryDriver` are already correct, single-word, and idiomatic. No renames.
- **A table is a contract.** The `tables`-as-columns declaration, `RowOf` inference, parse-on-write
  - guard-on-read, and `export`/`import` are exactly the type-strictness backbone this proposal
    wants — already zero `any`/`as`/`!`.
- **The compensate engine.** The pure, total query engine (`compareValues`, `matchesCriteria`,
  `applyCriteria`, `computeAggregate`, and the linear ReDoS-safe `wildcardMatch`) over a single
  `scan` is the design's heart and is already excellent.
- **Optional native hooks + presence negotiation.** `records?`/`count?`/`aggregate?` with
  presence-based dispatch (and the `aggregate?`-resolves-to-`undefined` subtlety) is the right
  exploit model; kept and extended.
- **Emitter observation.** `DatabaseEventMap` / `TableEventMap` with after-the-transition,
  listener-isolated emits is already correct.
- **JSON-as-decorator + `TableSchema`-driven `open`.** The `JSONDriver`-over-`MemoryDriver`
  decorator and the contract-derived `TableSchema` handed to `open` are kept.
- **The legacy multi-backend seams.** The (currently archived) SQLite compiler and IndexedDB
  `selectPlan` designs are the correct exploit implementations; they return in phase-next over
  their new backing packages.

### Prioritized gaps (the migration path)

1. **Transactions leave native power on the table (highest impact).** `snapshot()` gives only a
   rollback thunk with no commit signal, forcing even SQLite into whole-store capture-replay.
   **Fix:** add the optional `transaction?()` hook (`{ commit; rollback }`) and prefer it in
   `Database.transaction`, so SQLite gets real `BEGIN/COMMIT` atomicity+isolation+durability, while
   memory/JSON/IndexedDB keep the (now optionally table-scoped) snapshot floor.
2. **No cancellation.** Nothing threads an `AbortSignal`; a long scan/query/transaction cannot be
   aborted. **Fix:** adopt `@orkestrel/abort`, thread an optional `signal` through reads, the new
   streaming terminal, and `transaction`; add the `ABORTED` error code. (And with this in place,
   `@orkestrel/timeout` is unnecessary — `AbortSignal.timeout(ms)` covers it natively.)
3. **No migrations / schema evolution.** The design explicitly ships no migration runner, yet the
   three engines evolve schema incompatibly. **Fix:** add the pure `Migration` schema-diff model
   in core plus the optional `migrate?` driver hook (SQLite DDL / IndexedDB version bump / JSON
   rewrite / memory no-op) and the `MIGRATION` error code.

Secondary gaps, worth doing but lower-risk:

4. **Streaming public API.** `records` fully materializes; `scan` is driver-internal. **Fix:** a
   public `scan(criteria?)` / `Query.stream()` async-iterable terminal + optional `stream?` hook,
   so large reads don't hold every row in memory.
5. **JSON durability & write amplification.** `writeFile` is non-atomic (torn write → corruption)
   and every write rewrites the whole file (O(writes) rewrites). **Fix:** atomic temp-file rename
   and flush-once-per-commit coalescing.
6. **Conformance is per-driver, not a shared kit.** Parity lives in bespoke per-driver tests.
   **Fix:** ship one reusable, importable `conform(...)` suite so in-repo and third-party drivers
   prove the contract identically.
7. **`generateKey` smuggles a host global into strict core.** UUID minting reaches
   `globalThis.crypto` from `src/core/helpers.ts`. **Fix:** move default-key generation to the
   driver seam that legitimately has a host `crypto`, keeping core host-global-free per AGENTS §17.7.
