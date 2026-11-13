# Tenets

These are the standing directives for every change to `@orkestrel/database`, `@orkestrel/relation`, `@orkestrel/sqlite`, and `@orkestrel/indexeddb`. Each line names a pattern whose evidence, rule, and proof form are in its research record:

- an id with no prefix is in `research/strategies-database.md` § 1;
- an `A-` id is in `research/strategies-agent.md` § 1.

Apply a tenet by reading its record first. A change that breaks a tenet states which one, why, and the ruling that admits it.

## The user's principles, verbatim

- **Native first** (2026-11-13, `research/intake.md` § Message 2):
  - "`@orkestrel/database` is the unifier: one API over SQLite and IndexedDB, carrying the best database design patterns."
  - "It prefers and defaults to each driver's native abilities, and supplies its own logic only to fill a gap that driver's engine cannot cover."
  - "Custom logic never runs where the native path exists, because it will never be as fast."
- **Nothing deferred** (2026-11-12, at about 14:30): "Take care of everything now, not interested in deferring anything".
- **No release for prose alone** (2026-11-13): "No need to do a release for comments, let's just release with what is necessary."
- **Greenfield**, from scaffold `AGENTS.md`: no alias, wrapper, or migration for a shape or for data an earlier release wrote.

## The database family's tenets

### Native first

- **DN1.** The engine answers, and the core runs only the residual.
- **DN2.** The contract takes the engine's semantics.
- **DN3.** A fallback names the engine it serves.
- **DN4.** Read the wrapper's surface ahead of writing logic.

### Planner and residual

- **DP1.** The plan is a return value, split per clause.
- **DP2.** One checker holds the plan invariants, and an empty side is `{}`.
- **DP3.** One read procedure serves `Table` and the differential.
- **DP4.** Each precondition of the residual procedure is named and pinned.
- **DP5.** The planner's assumptions bind the connection.

### The read path

- **DR1.** The read guard asserts and never filters.
- **DR2.** Rows read follow the page.
- **DR3.** One counting path.
- **DR4.** The residual exits early, and each buffer is named.
- **DR5.** The residual engine prepares one time per read.
- **DR6.** Decode raises, and a copy on a read path is measured.

### Transactions and journals

- **DT1.** The scoped capability mirrors every native member.
- **DT2.** A scope takes its lock at the start, and a refusal surfaces.
- **DT3.** A default trades nothing the application owns.
- **DT4.** Rollback costs the keys touched.
- **DT5.** Each multi-step read states its transaction boundary.

### Writes and batches

- **DW1.** A batch is one engine round trip and applies all rows or none.
- **DW2.** A list binds as one parameter.
- **DW3.** The engine's conflict answer is the fact.
- **DW4.** A whole-set write cost is measured ahead of a mechanism.

### Indexes and statistics

- **DI1.** A native form is one an index can use.
- **DI2.** Pin the access path where the form hides a fact.
- **DI3.** Statistics are the engine's.
- **DI4.** The file's indexes equal the declaration.
- **DI5.** IndexedDB takes one access path, by rule.
- **DI6.** The application declares the indexes a relation needs.

### Measurement and instruments

- **DM1.** Rows read is the first cost reading, on one recorder.
- **DM2.** The before reading is taken on the published build.
- **DM3.** The instrument reads beneath the boundary it claims.
- **DM4.** The bar is the consumer's, read at scale, with the consumer's own term removed.
- **DM5.** An engine fact is a probe reading with its versions.
- **DM6.** Each package carries a bench file its gates do not collect, with an assertion that can fail (with A-M1).

### Proving

- **DV1.** A differential against the core engine, with named exemptions.
- **DV2.** A matrix of operator, storage, and flags.
- **DV3.** Red on the published behavior.
- **DV4.** Inject the fallback.
- **DV5.** A browser claim is run in a browser.
- **DV6.** One independent round finds what the gates pass.
- **DV7.** A citation is checked at its commit.

### API and release

- **DA1.** Rename and remove with no alias, and hand the consumer the list.
- **DA2.** A barrel holds capabilities, and a kind file holds helpers.
- **DA3.** A wrapper releases ahead of the database release that uses it.
- **DA4.** No release ships for prose alone.
- **DA5.** A change to published behavior needs the user's assent.
- **DA6.** One writer per checkout, and the plan follows the commits.

## Tenets for a custom mechanism, from the Agent campaign

Apply these where a package must build its own mechanism because no engine answers: the residual engine, a planner, a cache, a journal, a batch, or an admission door.

### Native first and reuse

- **A-N1.** The engine's report replaces the formula.
- **A-N2.** Call the primitive, never a local copy.
- **A-N3.** The package that walks the bytes owns the predicate.
- **A-N4.** One holder per fact and per capability.
- **A-N5.** Pure TypeScript over the platform.

### Correctness of a custom mechanism

- **A-C1.** Options and records are different doors.
- **A-C2.** Refuse the whole structure ahead of the first side effect.
- **A-C3.** One home per rule, called by the planner and the executor.
- **A-C4.** Derive state from the record.
- **A-C5.** An approximation names its admissible error.
- **A-C6.** Check the object that is dispatched, at the last point ahead of the engine.
- **A-C7.** Commit only while what was read is unchanged.
- **A-C8.** A wrong default is changed, never documented or made optional.
- **A-C9.** A refusal names the member and the remedy, and leaks nothing.
- **A-C10.** Record what was observed and compare only what the format requires.
- **A-C11.** Withhold the handle that would start a second writer.

### Performance of a custom mechanism

- **A-P1.** Estimate, then measure, then refuse, on separate layers.
- **A-P2.** Calibrate on a bounded sample, and store nothing from a failed measurement.
- **A-P3.** A margin is one named constant taken from a measured series.
- **A-P4.** Key a cache to exactly the bytes it priced.
- **A-P5.** Compare identity where the engine already changes identity.
- **A-P6.** Rebuild nothing whose inputs are unchanged.
- **A-P7.** Own a value through one copy, freeze it, then read it by reference.
- **A-P8.** Search in place of enumeration, with the precondition pinned.
- **A-P9.** Bar a hot path as a share of the caller's spend, at the input limit.
- **A-P10.** One forward pass with an early exit.
- **A-P11.** Yield on a time slice and park on signals.
- **A-P12.** Count the round trips.
- **A-P13.** A stream holds one batch.
- **A-P14.** A speed mechanism needs a consumer's reading, and a refused one is a recorded stop.

### The measurement method

- **A-M1.** A bench no gate collects, with an assertion that can fail.
- **A-M2.** A solo window, with the host's other load in the record.
- **A-M3.** Interleave the builds and calibrate with identical sides.
- **A-M4.** Repeat a cell until one reading clears the timer.
- **A-M5.** A bar is a baseline that separates drift from an outlier.
- **A-M6.** A load names its row sizes as well as its row count.
- **A-M7.** Rehearse without the service, then run one pinned real client.

### The proving method

- **A-V1.** Red first on the untouched tree.
- **A-V2.** Mutate the deciding line, and act on a survivor.
- **A-V3.** A seeded differential with classes written ahead of the run.
- **A-V4.** An instrument that cannot reach the class proves nothing.
- **A-V5.** Adverse orderings as a table, on a deterministic fixture.
- **A-V6.** One skeptical round on numbered claims, against a named release bar.
- **A-V7.** One closure check, then stop.
- **A-V8.** Hand every door the malformed shapes.

### The design method

- **A-D1.** Probe first, and stop when the probe returns.
- **A-D2.** Write the adoption rule ahead of the run.
- **A-D3.** The arithmetic names the term ahead of a mechanism.
- **A-D4.** Read the engine ahead of choosing a comparison.
- **A-D5.** Every row is built, refused, stated as a limit, or handed on.
- **A-D6.** Census a defect class ahead of the second repair.
- **A-D7.** The smallest mechanism a reading supports, usable by its least capable caller.

### The release and cross-package method

- **A-R1.** Layer order, with every dependent re-pinned.
- **A-R2.** Local pins through content-named tarballs and a ledger.
- **A-R3.** The blast-radius read covers a dependent's tests and its guide fences.
- **A-R4.** A handed-on row is on the receiving release's bar.
- **A-R5.** A live receipt names its build and lapses with it.
- **A-R6.** Record the ruling ahead of the dispatch.
- **A-R7.** Shared instruments and shared configuration stay with their owner.
