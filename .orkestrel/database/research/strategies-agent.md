# Strategies the Agent campaign hands to the database family

The Agent campaign built its own mechanisms only where no engine could answer: a price for a prompt ahead of the provider's token report, a derivation of shown state from stored messages, a head cache, a window of sent exchanges, a job-tree scan, and the admission doors. Each one became correct by the same route: a refusal by default at the last point where the quantity is knowable, state derived from the record in place of a stored flag, and one home per rule that the planner and the executor both call. Each one became fast by the same route: the engine's own report replaces the formula as soon as it exists, a cache is keyed to exactly the bytes it priced, staleness is an identity compare of the inputs of the last render, and a cost bar is a share of the caller's real spend read at the input limit with a superlinear control that must fail. The method around them carried as much as the code: a probe on two trees ahead of any source edit, a claim red on the untouched tree, a mutation of the deciding line, a seeded differential whose differences fall into classes written ahead of the run, bars read as baselines that separate drift from an outlier, and one pinned real client run ahead of a release. This file states those patterns as tenets for the residual path, planner, cache, journal, batch, and admission of `database`, `relation`, `sqlite`, and `indexeddb`. It meets `database/.orkestrel/database/designs/native.md` (cited as `native`) and does not restate it.

## Marks and verification

- **[fact]** I read the line's content in this consultation at the cited tracked source, the cited tracked record, or the `agent` git log.
- **[record]** The line comes from a map, a ruling, or a report I did not reread, and it names its carrier.
- **[inference]** The line is a generalization, a tenet, or a proof form with no run of its own.
- [fact] I ran no test, probe, build, or git command. I verified each `agent` commit I cite by its hash and subject in the checkout's git log file, each constant and helper by its line in `src/core`, and each reading by the tracked record or the report that holds it.
- [fact] Commits `ff5ebebf` and `36987981`, which map A cites, are absent from the git log file I read, so no line here carries them.
- [record] Commits in `toolbox`, `workspace`, `study`, and `ollama` come from map D and from `agent` `.orkestrel/agent/plan.md` § State. I did not read those repositories' logs.
- [inference] The reconciled `tenets.md` can cite tracked carriers only. Each evidence line here leads with a commit, `agent` `.orkestrel/agent/plan.md`, `agent` `.orkestrel/agent/designs/disclosure.md` (cited as `disclosure`), or a `src` path. A [record: ] path is a second carrier that is git-ignored, and the reconciler retargets or drops it.

## 1. The patterns

### Native first and reuse

#### A-N1. The engine's report replaces the formula

- **Learned.** [fact] The ledger prices a prompt with a measured `scale` and `overhead` only because the provider reports tokens after the call. `Gauge.remainder` reads the last reported prompt whenever one exists, and the formula serves the first request alone (map A § The gauge, `src/core/ledgers/Gauge.ts`).
- **Learned.** [record] The fit moved off a stand-in onto the measured remainder in `c915224d` ("Fit recall to the measured room, not the longest reply").
- **Evidence.** [fact] `c915224d` is in the `agent` log with that subject. [record] Map A § Recall's room and § The gate.
- **Tenet.** [inference] A core mechanism computes a quantity only while the engine cannot report it. After the engine reports a row count, a change count, a conflict, or a plan, the core reads that report and holds no estimate of the same quantity.
- **Proof.** [inference] A recording driver asserts that a read whose plan leaves an empty residual makes no core query call. A mutation that reroutes that read through the core's engine must redden the assertion.

#### A-N2. Call the primitive, never a local copy

- **Learned.** [record] Every option door calls `refuseOptionKeys` from `@orkestrel/contract` and wraps nothing. A hand-written seeded generator in `tests/setup.ts` duplicated contract's `seededRandom` and was removed after the user's ruling of 2026-11-11 (memory `feedback-reuse-ecosystem`; map B § Option doors).
- **Evidence.** [fact] `1d99e541` ("Build the O-and-D cut, calibration on a bounded sample, and refused undeclared members") carries the doors. [record] The door census marked every host-facing door in [record: doors-ruling.md].
- **Tenet.** [inference] Before a helper lands in `src` or `tests`, the unit names the `@orkestrel` export and the platform API it checked. A local variant of an installed primitive stays only with a proven semantic difference.
- **Proof.** [inference] A census by export name across the four packages, ruled row by row, and the policy project's `surface` rule for collisions.

#### A-N3. The package that walks the bytes owns the predicate

- **Learned.** [record] A filter applied after `Workspace.search` still ran the pattern over hidden text, and with `limit: 1` an empty answer told the caller that an earlier hidden file matched. A filter after `replace` cannot undo the write. The skip moved inside the walk, in the package that owns the walk (map D § The `files` list binds the tool).
- **Evidence.** [fact] `3509c166` ("Hand each tool call the run's workspace and files list, and rebuild the head after an edit"). [record] `workspace` `640959f`; `disclosure` § Agent 0.0.43.
- **Tenet.** [inference] A condition, a page, and an allow-list apply inside the engine's walk or inside the core's single residual pass, never in the caller after the read. A restriction on a write applies ahead of the write.
- **Proof.** [inference] A two-arm probe with an excluded row placed first and a page of one row, on the base and on the candidate. The base must return the wrong page or read the excluded row, and the recorder's rows-read count must fall on the candidate.

#### A-N4. One holder per fact and per capability

- **Learned.** [record] Toolbox's `switch` and Agent's built-in `switch` offered one verb with opposite reach, and the copy that ignored the ceiling was deleted. A per-name pool beside the managers and a public method restating a derived price were each refused as a second holder (map D § The workspace a tool acts on, § What a durable job carries; triage rows D37).
- **Evidence.** [fact] `905f7183` ("Close phase 3 of the disclosure campaign: disclosure in the ledger") carries the durable-job carriage. [record] `toolbox` `adc42dc`; `disclosure` § Refused.
- **Tenet.** [inference] A fact or a capability has one home across the four packages. A second path to the same answer is deleted in the change that finds it, with no alias.
- **Proof.** [inference] An export census per capability, and a mutation that makes the two paths disagree: where one path remains, the mutation has nothing to split.

#### A-N5. Pure TypeScript over the platform

- **Learned.** [record] The user ruled on 2026-10-23 that no package uses FFI, a Node-API addon, or a compiled helper, and that a requirement only native code can meet is waived (memory `feedback-no-native`).
- **Evidence.** [record] Ruling U22, memory `feedback-no-native`.
- **Tenet.** [inference] `node:sqlite` and the browser's IndexedDB are the engines. An engine capability absent at the declared Node floor is read by a probe and then runs as residual or is waived. No unit proposes a native component.
- **Proof.** [inference] The dependency census of each `package.json`, and a probe of each engine capability a design relies on at the declared floor, recorded with its Node version.

### Correctness of a custom mechanism

#### A-C1. Options and records are different doors

- **Learned.** [record] An options object calls the key door: an undeclared own member refuses, and a declared member holding `undefined` reads as absent. A stored record passes an exact contract: an undeclared member and a present `undefined` both refuse. Internal helpers and error constructors take no door (map B § Option doors, § Exact record admission; map D § Undeclared option members).
- **Evidence.** [fact] `1d99e541`. [fact] `disclosure` § The release bar reads claims O.1 and O.3 into the no-regression line. [record] `createScope({ tool })` built an unconstrained scope ahead of the door ([record: r.md] § PO).
- **Tenet.** [inference] Every constructor and per-call options object refuses an undeclared key through contract's key door against an exported key list. Every row, snapshot, metadata record, and migration input passes an exact contract. A helper downstream of a door checks nothing again.
- **Proof.** [inference] One claim per door, red on the untouched tree with a stray key, plus a row that spells each declared option `undefined` and is admitted. A `Required<T>` fixture forces every key into the list at compile time.

#### A-C2. Refuse the whole structure ahead of the first side effect

- **Learned.** [record] Ahead of unit R the job-tree scan cleared a child that the build then refused, so a parent made provider calls and the child refused late. `scanJobTree` refuses the root with no spawn, no build, and no provider call. A snapshot is checked whole and the checked candidate is the value seated (map B § Job-tree scan, § Exact record admission).
- **Evidence.** [fact] `1d99e541`; `scanJobTree` at `src/core/agents/helpers.ts:673`. [record] Probe PJ read 1 provider call at depth 1 and 3 at depth 3 ahead of the late refusal ([record: r.md] § PJ).
- **Tenet.** [inference] A batch, a migration, and a scope validate every member ahead of the first engine write. The value written is the candidate the check read, never a second read of the caller's object.
- **Proof.** [inference] A batch whose final member refuses, with the recorder reading zero write calls and zero commits. The mutation moves the check after the first write.

#### A-C3. One home per rule, called by the planner and the executor

- **Learned.** [record] The job shape and the build's own checks stated the same bounds twice, and a boundary table with seeded draws found 641 differing pairs. The repair put each bound in the schema where the schema can state it and the remainder in one helper that the scan and the build both call (map B § Job refusals the shape cannot state).
- **Evidence.** [fact] `collectJobRefusals` at `src/core/agents/helpers.ts:624`; `1d99e541`. [fact] The 641 pairs are row J.1 of [record: r.md].
- **Tenet.** [inference] The planner, the compiler, and the conformance check read one coverage predicate per clause. Two statements of one rule are a defect even while they agree.
- **Proof.** [inference] An equivalence claim in both directions over a boundary table and seeded draws, and a mutation of the shared predicate that reddens the planner's test and the executor's test together.

#### A-C4. Derive state from the record

- **Learned.** [record] Shown skills and the selected workspace are folded from the conversation's own success records. Phase 0 proved the fold exact ahead of any consumer, and a stored entity, a snapshot member, and a dirty flag stayed closed. The holdback is computed from the catalog at each plan (map B § Disclosure derivation; map A § The plan and the holdback).
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State, row "Phase 0, derivation": exact on 23 table rows, 22 mutants, and 7 loop-stored rows. [fact] `a1e626a1` closes phase 2.
- **Tenet.** [inference] A cache's resident set, a journal's touched keys, and a read's "wholly native" verdict are computed from the plan and the log at the point of use. No stored flag, mark, or count restates a fact the engine or the log already holds.
- **Proof.** [inference] A table of orderings with one mutant per ordering, each mutant disagreeing on the rows it names, and a round trip through a snapshot that derives the same state.

#### A-C5. An approximation names its admissible error

- **Learned.** [record] Two calibration calls measure one total and nothing about its split. Crediting hidden definitions at the message scale priced a live first call at about a sixth of its charge. The repair credits the hidden part at the lower measured rate and charges an added part at the higher, so the remaining error is a refusal of a request that fits and never a dispatch over the window (map A § The tool price; map D § The spared rate).
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § Rulings, 2026-11-12: the consumer's first call reported at 6.43 times its price. [fact] [record: room-spare-ruling.md]: scale 642 / 383 = 1.6762, density 13257 / 13776 = 0.9623. [record] The rerun `agent-consumer-live2` read 1.020 and 1.017. [fact] `disclosure` § The release bar: 3 refusals in 120 seeds and 0 under-priced dispatches on the flat arm.
- **Tenet.** [inference] Where a native form or a core estimate is not exactly the contract's meaning, the design states which error it can make and which it cannot. The admissible error is a recheck, a refusal, or extra rows read. A wrong row returned and a write applied past its bound are never admissible.
- **Proof.** [inference] A differential with one arm on which the rule is exact, where the error class must be empty, and one arm on which it is not, where both error directions are counted and the inadmissible one must read zero.

#### A-C6. Check the object that is dispatched, at the last point ahead of the engine

- **Learned.** [record] The room check moved from an admission stand-in, to the `turn` event, to the frozen request, because each earlier site left calls unpriced: a turn that admitted nothing, and host acts between the price and the send. The loop measures the copy it dispatches (map D § The overflow gate; map B § The turn loop).
- **Evidence.** [fact] `905f7183`. [record] The phase 3 review's sweep sent 27 of 5756 calls over the limit, with a control at 0 of 3682, and the round's re-audit read 70,600 calls with 0 over capacity (`agent` `.orkestrel/agent/plan.md` § State, phase 3 rows).
- **Tenet.** [inference] Admission, planning, and compilation read one frozen input, and the statement and parameters that pass the check are the ones the engine receives. No await and no caller callback sits between the check and the dispatch.
- **Proof.** [inference] A seeded sweep that mutates the caller's input between the check and the dispatch, with a control arm that must read the violation when the check is moved earlier.

#### A-C7. Commit only while what was read is unchanged

- **Learned.** [fact] A compaction fold commits only while each folded message is still the identical stored object, and a selection handler's result is discarded when the view's ids changed during its await (map B § Conversation compaction, § Selection).
- **Evidence.** [fact] `7a2e29aa` ("Add production-informed rolling compaction with isolated proofs"). [record] `src/core/conversations/Conversation.ts:338-372`.
- **Tenet.** [inference] A core step that awaits between a read and a write either runs inside one engine transaction or verifies the identity of what it read ahead of the write. A journal restore, a batched stream's resume key, and a cursor step each state which of the two holds.
- **Proof.** [inference] A table of orderings that removes, rewrites, or clears during the await, each with a mutant that drops the recheck.

#### A-C8. A wrong default is changed, never documented or made optional

- **Learned.** [record] The capacity bound applied only where a built-in was enabled, and the ruling struck the condition. The advertisement trap had a guide sentence, and the ruling deleted the sentence and changed the rule. Toolbox's `switch` was removed rather than placed behind an option (map D § The overflow gate, § The trap's rule).
- **Evidence.** [fact] `905f7183`; `1d99e541`; `filterAdvertisedTools` at `src/core/agents/helpers.ts:1386`. [record] The user's ruling of 2026-11-03 (memory `feedback-refuse-by-default`).
- **Tenet.** [inference] Absence is never a value: a missing, `null`, mistyped, or unread input refuses unless the schema declares it optional with stated behavior. No option turns safety on, and no guide sentence stands in for a rule.
- **Proof.** [inference] The claim is written against the default configuration, red on the untouched tree, with the mutation restoring the old condition.

#### A-C9. A refusal names the member and the remedy, and leaks nothing

- **Learned.** [record] The `'GAUGE'` refusal names the call and the lever that resolves it, and the falsify lane followed each named remedy to an answered request. A path outside a `files` list and an absent path refuse with one text. The fixed `overflow` note states no size (map A § Calibration; map D § The `files` list binds the tool).
- **Evidence.** [fact] `1d99e541`. [record] `disclosure` § The re-prepared 0.0.42, the K-and-R round.
- **Tenet.** [inference] A refusal carries the table, the key or column, the fault, and the remedy. It carries no rejected row, and it reads the same for a hidden target and an absent one.
- **Proof.** [inference] A test follows each remedy the text names to a passing call, and a test compares the refusal of a hidden target with the refusal of an absent one.

#### A-C10. Record what was observed and compare only what the format requires

- **Learned.** [record] Study refused a replay when the serving version differed, which voided every recorded seed at each engine update. The ruling records the version as an evidence row and compares it with nothing, and keeps a check only where the format itself requires identity (map D § The serving version is an observation).
- **Evidence.** [fact] `1bd8fe27` ("Apply the prepared Study consumer change for Study 0.0.19"). [record] `study` `84e49b7`; `ollama` `710a650`.
- **Tenet.** [inference] A driver records the engine version and build options it observed. It refuses only on identity the stored format requires, such as the deployed schema, and never on a version string.
- **Proof.** [inference] A reopen under a changed observed version succeeds and records the version, and a reopen under a changed stored schema refuses.

#### A-C11. Withhold the handle that would start a second writer

- **Learned.** [record] A run on another conversation of the ledger's agent moved the gauge's scale from 1.1875 to 105.9375. The ruling added no check: it removed `generate` and `stream` from the value a host holds (map D § Who may start a run on the ledger's agent).
- **Evidence.** [fact] `ddff6c1b` ("Close phase 1 of the disclosure campaign: the run scope, the ceiling, and the ledger's agent").
- **Tenet.** [inference] An invariant that assumes one writer is held by the shape of the handle. A scoped capability exposes the members the scope may call and no other.
- **Proof.** [inference] A type-level claim that the withheld member is absent, with the breaking edit that restores it and the test that then shows the second writer.

### Performance of a custom mechanism

#### A-P1. Estimate, then measure, then refuse, on separate layers

- **Learned.** [fact] `estimateTokens` is a length heuristic, the gauge converts it with a measured rate, and the provider's report is the authority. [record] The user ruled on 2026-10-16 that the estimate, the budget, and the engine's own limit are three separately tunable stops, each attributable (memory `feedback-budget-layers`).
- **Evidence.** [fact] `66319d55` ("Measure complete requests and refuse exhausted strict windows"); `estimateRequest` at `src/core/agents/helpers.ts:497`.
- **Tenet.** [inference] A core estimate, a configured bound, and the engine's own limit are separate stops, and each refusal names the layer that fired and its reading. The core builds no selectivity or cost model until a reading shows that the ranking rule mis-plans by an outlier margin.
- **Proof.** [inference] One test per layer that makes that layer fire first and asserts the error's layer and figures.

#### A-P2. Calibrate on a bounded sample, and store nothing from a failed measurement

- **Learned.** [record] Calibration over the whole view sent calls over capacity: a re-audit counted 9034 calibration calls with 642 over capacity. The repair samples the smallest input that still holds the unknown, cuts added text by a property of the encoding, refuses a measurement over capacity, and stores no gauge from it (map A § Calibration; map D § Calibration).
- **Evidence.** [fact] `LEDGER_SAMPLE_BYTES = 3` at `src/core/ledgers/constants.ts:244`; `cutWorkspaceSample` at `src/core/ledgers/helpers.ts:2032`; `1d99e541`. [record] [record: triage-ruling.md] § A-D6 for the 9034 count.
- **Tenet.** [inference] A measured constant such as a batch size or a cache capacity is read on a bounded sample and bounded by a property of the engine or the format where one exists. A measurement that fails or exceeds its bound stores nothing.
- **Proof.** [inference] A boundary claim at the bound, with a mutation of the comparison operator that must redden the equal case.

#### A-P3. A margin is one named constant taken from a measured series

- **Learned.** [fact] `LEDGER_SCALE_DRIFT` is 0.06 at `src/core/ledgers/constants.ts:148`. [record] It is the measured rise from 1.150 to 1.212 rounded up. A reading of 1.346 fell outside that series and reopened the sample, and a move of 0.65% stayed inside and was classed as drift (map A § The scale drift).
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State: `agent-consumer-live3` failed claim 3.15 at 1.346, and `agent-consumer-live4` read 1.039 on that request. [fact] [record: k3-ruling.md]: 464 tokens over 191 estimate units against 351 over 419.
- **Tenet.** [inference] A safety margin lives in one named constant with the series it came from. A reading outside the series reopens what was sampled. The constant does not widen to absorb it.
- **Proof.** [inference] The constant's remark cites its run, and a differential control that pushes the quantity past the margin must fall into the failing class.

#### A-P4. Key a cache to exactly the bytes it priced

- **Learned.** [fact] The gauge stores a digest of the calibrated definitions and is dropped when the digest differs. [record] A ceiling change, a load, and an edit to a held-back definition leave the digest alone, so they recalibrate nothing. Skill names inside a definition were refused because every registry edit would move the digest (map A § Calibration; map B § Built-in handlers).
- **Evidence.** [fact] `dd93e2a7` ("Recalibrate a hydrated ledger whose tool definitions differ from the ones its stored gauge priced"); `digestLedgerTools` at `src/core/ledgers/helpers.ts:100`.
- **Tenet.** [inference] A cache key holds every input that changes the cached value and no input that does not. An entry is dropped on a key change and is never patched in place. A value that varies per call stays out of the key and is bound as a parameter.
- **Proof.** [inference] A recorder counts prepares or builds across calls that differ only in bound values and reads one. A mutation that adds a per-call value to the key makes the count grow with the calls.

#### A-P5. Compare identity where the engine already changes identity

- **Learned.** [record] Phase 0 read that a workspace file value changes identity on every successful write and keeps it on a `replace` with no match. The stale-head test compares length and identity, with no hash of file text (map B § Head observation and refresh).
- **Evidence.** [fact] `disclosure` § The bar of Agent 0.0.43: the rebuild costs 0.048 ms at the median and 0.064 ms at p95 a turn, noise 0.001 ms. [fact] [record: w43-bench.md]: the compare alone, N − BN, read −0.004 ms at the median.
- **Tenet.** [inference] Staleness is a compare of the inputs the last build read, by object identity where the owner replaces the object on every successful change. A probe reads that identity behavior ahead of the design that relies on it.
- **Proof.** [inference] A probe table of each write operation against "identity changed", then a claim that a no-op write keeps the cached value and a real write replaces it, with the mutation dropping the compare.

#### A-P6. Rebuild nothing whose inputs are unchanged

- **Learned.** [fact] A turn rebuilds the head only when `observe` reports a changed view, and the refresh is the built head plus the messages appended after the recorded length. [record] The ledger window extends each prompt from the last sent exchange and is dropped when its digest or a source's liveness changes (map B § Head observation; map A § The exchange window).
- **Evidence.** [fact] `d49671a3` ("Extend each prompt from the last through a window of sent exchanges"); `c9a651b2`; `matchesHeadLists` at `src/core/agents/helpers.ts:1519`.
- **Tenet.** [inference] A prepared statement, a compiled plan, and a derived schema are built one time per distinct input and reused. The reuse test is A-P4's key or A-P5's identity, and every other path builds fresh.
- **Proof.** [inference] The recorder's build count over a repeated identical operation reads one, and the arm with a changed input reads two.

#### A-P7. Own a value through one copy, freeze it, then read it by reference

- **Learned.** [fact] Judgments are owned through a JSON copy at admission, deep-frozen, and returned to readers with no copy (map B § Judgment cache).
- **Evidence.** [fact] `9745e36e` ("Store judgments as frozen records and read them without a copy"); `b9532a1b` ("Build the judgment and memo guards once").
- **Tenet.** [inference] A value is copied at the boundary where ownership changes and at no other. A further defensive copy on a read path needs its own measurement.
- **Proof.** [inference] A caller-mutation isolation test at the boundary, and a bench cell on the read path that reads the copy count from the recorder.

#### A-P8. Search in place of enumeration, with the precondition pinned

- **Learned.** [fact] The ledger's trim bisects candidate cuts in place of rendering every dropped line, and owner matching reads an index in place of scanning every owner. [record] The bisection is correct only while dropping a line cannot raise the price, and map A found no mutation of that precondition.
- **Evidence.** [fact] `275c0dab` ("Search a ledger's cut instead of rendering every dropped line"); `c70e64cd` ("Look a text's words up in the ledger index instead of scanning every owner"); `findLedgerCut` at `src/core/ledgers/helpers.ts:521`.
- **Tenet.** [inference] An algorithmic repair that depends on an ordering or a monotonic property states that property beside the code and carries a test that fails when the property is false.
- **Proof.** [inference] A differential of the search against the enumeration over seeded inputs, and a fixture that violates the precondition and must be detected or refused.

#### A-P9. Bar a hot path as a share of the caller's spend, at the input limit

- **Learned.** [fact] The derivation's bar is 6.6 ms at 1600 messages, 1% of a selection stop derived from a measured model call, with growth to double size barred at 2.5. Phase 0 read 0.943 ms and 1.873 ms, growth 1.99, and a quadratic control grew 4.53 and 4.78 times.
- **Evidence.** [fact] [record: disclosure-p0-derive.md] § Scale readings; `agent` `.orkestrel/agent/plan.md` § State, row "Phase 0, derivation". [fact] `a1e626a1` carries the bench file `tests/src/core/agents/helpers.bench.ts`.
- **Tenet.** [inference] Each residual path has a cost bar stated ahead of the run as a share of what its caller spends around it, read at the largest input the contract admits. A growth ratio at double size is asserted, and a superlinear control must fail it.
- **Proof.** [inference] A bench file in the project no gate collects: a discarded warmup, a median, the bar, the growth ratio, and the control.

#### A-P10. One forward pass with an early exit

- **Learned.** [fact] `collectDisclosure` returns ahead of any read when no recording built-in is enabled, pairs owners through groups, and folds in message order in one pass (`src/core/agents/helpers.ts:1612`).
- **Evidence.** [fact] The readings under A-P9 are that walk.
- **Tenet.** [inference] The residual path is one pass over the engine's stream that stops at the first point the answer is complete. It makes no second pass and collects no intermediate array unless an order requires one.
- **Proof.** [inference] The recorder's rows-read count against the page size and the match count, under each plan class.

#### A-P11. Yield on a time slice and park on signals

- **Learned.** [fact] The classifier yields to the host after `LEDGER_SLICE` milliseconds of filing, 5 at `src/core/ledgers/constants.ts:137`, and reads no clock when no scheduler is given. Waits race the abort signal and never poll.
- **Evidence.** [fact] `77df10c2` ("Yield the host during a ledger's filing when it passes a scheduler").
- **Tenet.** [inference] Long residual work yields cooperatively between engine round trips and honors the abort signal at each yield. It never yields inside an engine transaction that an await would end.
- **Proof.** [inference] A test aborts mid-work and reads a typed abort with no later engine call, and a test in the browser project shows a batch boundary sits between transactions.

#### A-P12. Count the round trips

- **Learned.** [fact] The routine study suite took 1201 s, and the commit that cut it records under 7 minutes. [record] Ten cases held 1177.5 s of that, none of it on a model: the time was one process per command and per trial (map C § The study suite).
- **Evidence.** [fact] `a55a2a53` ("Cut the routine study suite from 20 minutes to under 7, and re-pin the wave's dev ranges"). [fact] [record: study-sv-run.md]: 397.3 s in series against a 400 s bar, 242.9 s with parallel files.
- **Tenet.** [inference] The cost of a core operation is first the number of engine round trips it makes: transactions, statements, prepares, and cursor steps. Each operation states that number, and the recorder asserts it.
- **Proof.** [inference] A recorder assertion per public operation, written as a count against the keys or pages requested.

#### A-P13. A stream holds one batch

- **Learned.** [fact] The channel between the provider pump and the reader is a linked cell chain: push and take in constant time, at most one taken value retained, every parked reader woken on close (map B § The streaming channel).
- **Evidence.** [fact] `dd8dee79` ("Stream approval frames to the page and cut the ledger and channel hot paths").
- **Tenet.** [inference] A core stream retains the batch in flight and nothing behind it, and a slow reader pins no prefix.
- **Proof.** [inference] A bench cell that streams a table far larger than a batch and reads retained rows from the recorder.

#### A-P14. A speed mechanism needs a consumer's reading, and a refused one is a recorded stop

- **Learned.** [record] The job-tree scan's repeated walk and a third calibration call for a fixed part were each measured or argued and then refused, with the reading that reopens each. Default-off experiment options that showed no measured gain were stripped at 0.0.32 (map B § Job-tree scan; map D § Rulings that closed a mechanism; memory `feedback-no-experiment-bloat`).
- **Evidence.** [fact] `disclosure` § Refused holds the closed rows. [record] The user's ruling of 2026-10-27.
- **Tenet.** [inference] No cache, index, or batch form is added without a reading from a real caller's load. A refused mechanism is recorded with its reason and its reopen trigger, and an experiment's additions leave with the experiment.
- **Proof.** [inference] The plan's refused list, each row with a trigger a later reading can meet.

### The measurement method

#### A-M1. A bench no gate collects, with an assertion that can fail

- **Learned.** [record] Benches run in a `probe` project outside every gate. Each cell marks its own region, discards warmups, reads a median, and asserts a bar or a structural invariant. The runner's mean and margin are logged and never gate (map C § The bench project, § The slot benches).
- **Evidence.** [fact] `049db17b` ("Read message size and spread in the committed ledger bench"); `dd8dee79`.
- **Tenet.** [inference] A cost question is a `*.bench.ts` file outside the gates, whose region the code under test marks. A settled relationship is promoted as an ordinary assertion, and baseline output is never committed.
- **Proof.** [inference] The bench file carries its failing control.

#### A-M2. A solo window, with the host's other load in the record

- **Learned.** [fact] The turn-bar reading held the lane alone. One set ran under 37.7% host-wide CPU against about 10% for the others, and the difference showed in that set's p95 and maximum while its medians matched within 0.002 ms.
- **Evidence.** [fact] [record: w43-bench.md] § Host during the run; `e146717f` ("Record the head rebuild's turn-bar reading against the 6.6 ms bar").
- **Tenet.** [inference] A timing reading runs with no other measured work on the host and reports the host's other load, its memory, and its console output beside the figures. Medians carry the verdict, and tails are reported.
- **Proof.** [inference] The reading's record: the command, the host figures, and each set's values.

#### A-M3. Interleave the builds and calibrate with identical sides

- **Learned.** [fact] The six arms of the turn-bar reading ran round by round in one process with the order rotated. An identical-sides arm read 0.001 ms or less at the median, so the 0.048 ms difference sat about 50 times over the noise.
- **Evidence.** [fact] [record: w43-bench.md] § Verdict and § Deviations. [record] Scaffold's `interleave.ts` refuses an odd round count and reads no clock of its own (map C § Interleaved comparison).
- **Tenet.** [inference] Two builds are compared in one run under one load, arms alternated, with an identical-sides pair read first. The bar is the relative change, and no difference inside the identical-sides spread is recorded.
- **Proof.** [inference] The report holds each side's samples, median, and median absolute deviation, and the identical-sides row.

#### A-M4. Repeat a cell until one reading clears the timer

- **Learned.** [record] The validator and judgment cells repeat their region until one reading holds at least 100 ms, because a single call sits under the timer's resolution and the host's jitter (map C § The slot benches).
- **Evidence.** [fact] `9745e36e`; `b9532a1b`.
- **Tenet.** [inference] A cell whose single operation is cheaper than the timer repeats inside the region, and the reading is divided by the repetition count.
- **Proof.** [inference] The cell's sensitivity row: a known added delay moves the reading by that delay.

#### A-M5. A bar is a baseline that separates drift from an outlier

- **Learned.** [fact] The user ruled on 2026-11-12 that the bars are "more like what we would like than what must be the result" and exist "to differentiate a small change with a huge outlier change". [fact] A reading near its baseline is drift, and a departure by an order of magnitude is traced. [record] A target miss that is still an improvement is kept (memory `feedback-keep-improvements`).
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § Rulings, 2026-11-12 about 12:00; `disclosure` § The release bar. [fact] The study suite's 397.3 s against a 300 s target and a 400 s bar was kept.
- **Tenet.** [inference] Every bar is recorded with its baseline reading and its run. A reading inside the bar is kept even when it is slower. A reading far outside is traced to its term ahead of any change to the bar or the code. No bar moves after its data.
- **Proof.** [inference] The plan's bar table: bar, baseline, run, and the reading that reopens it.

#### A-M6. A load names its row sizes as well as its row count

- **Learned.** [record] A cost read +2 ms on uniform 47-character seeds and +18 ms on real text of about 570 characters, because it paid per word (memory `feedback-message-size`).
- **Evidence.** [fact] `049db17b`.
- **Tenet.** [inference] A bench fixture states its row count, its row width spread, and its largest value. A reading on uniform short rows is reported as such and is never the only reading.
- **Proof.** [inference] Each bench reports cost against total bytes and against rows.

#### A-M7. Rehearse without the service, then run one pinned real client

- **Learned.** [record] The consumer harness loaded taverna at a pinned commit against a chosen Agent build, with an offline scripted twin and a dry composition check. Its first live run found the price miss that every unit test passed (map C § The consumer harness).
- **Evidence.** [fact] `50f055a9` ("Record phase 3's close: the round, the consumer run, and the 4B reading"); `agent` `.orkestrel/agent/plan.md` § State, the consumer-run rows.
- **Tenet.** [inference] One representative real consumer, pinned, drives the release candidate end to end ahead of publication. The run is rehearsed first with the engine's slow part taken out, and a control that removes the feature must redden the claim.
- **Proof.** [inference] The run's readings file against the claims it serves, and the control's red reading.

### The proving method

#### A-V1. Red first on the untouched tree

- **Learned.** [fact] Each unit recorded its claims failing on the previous tree ahead of the edit: W43 read 55 failed and 5 passed, then 60 passed (map C § Probe first).
- **Evidence.** [fact] `3509c166`; `agent` `.orkestrel/agent/plan.md` § State, row W43.
- **Tenet.** [inference] A claim's test is recorded failing on the tree without the change, with its command and count, ahead of the edit that makes it pass.
- **Proof.** [inference] The red ticket and the green ticket, by command.

#### A-V2. Mutate the deciding line, and act on a survivor

- **Learned.** [fact] The mutant `k-ge` survived because no test pinned a prompt equal to capacity, and it became claim F-K2. The mutant `r2-memo` survived because a field-by-field copy was unobservable, and the line returned to the spread.
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State, rows "The falsify round on K and R" and "The fix round": 17 of 18 mutations red. [fact] `18a3677b` records the round.
- **Tenet.** [inference] Every repair and every load-bearing comparison closes with a mutation that disables it, a named failing test, and a restore proven by digest. A surviving mutant gains the test that reddens it, or the line it changed is removed.
- **Proof.** [inference] Scaffold's `mutate.ts` receipt: mutated exit, restored exit, and the digest.

#### A-V3. A seeded differential with classes written ahead of the run

- **Learned.** [record] A calibration change moved scales by rounding, so a byte-equal differential called every seed a regression. The comparator classes each seed as equal, an intended drift within the margin, an intended refusal, or a remainder, and the bar is an empty remainder. A control that pushes the scale past the margin turns every drift seed into the remainder (map C § The class comparator).
- **Evidence.** [fact] `disclosure` § The bar of the re-prepared 0.0.42: the differentials under K hold no `before` row, and the differential under R differs on 31 of 300 scenarios, all in the trap class. [fact] § The bar of Agent 0.0.43: 300 of 300 rows equal with the handler context the one difference.
- **Tenet.** [inference] A behavior that must match the previous build, or the core engine, is a seeded recorder run in two trees with identifiers stripped. Each allowed difference is a named class with a pass rule written ahead of the run, the remainder class must be empty, and a control must land in the remainder.
- **Proof.** [inference] The class counts for each arm and the control's counts, read from the JSON each arm writes.

#### A-V4. An instrument that cannot reach the class proves nothing

- **Learned.** [record] The first differential surfaces drew no allow-list scope, so equal rows said nothing about the trap class until two surfaces were added. A ledger arm that supplied a gauge never entered calibration. A probe's first run refused every row, the control included, and was discarded (map C § The seeded differential recorder, § Probe first).
- **Evidence.** [record] [record: r.md] § Phase 0; [record: k.md].
- **Tenet.** [inference] A probe, a differential, and a sweep each show a count above zero of inputs that reach the code under test, and each carries a control from inside the claim's domain that must fail.
- **Proof.** [inference] The reach count and the control's failing result, beside the reading.

#### A-V5. Adverse orderings as a table, on a deterministic fixture

- **Learned.** [record] The design lists each ordering the happy path misses: a batch summed against one remainder, an abort mid-operation, a host act between two events. A sweep fixture drew a random number at every yield and did not repeat, and a two-run repeat probe caught it (map A § Room admission; map C § The class comparator, finding F3).
- **Evidence.** [fact] `disclosure` § Behavior under each adverse ordering is a section of the design. [fact] `1d99e541` carries the scheduler fix among the K rows.
- **Tenet.** [inference] Each mechanism that spans an await carries a table of orderings: abort, rejection, concurrent write, clear, close, and restart at each await. Each row is a test. Every seeded fixture is run twice and must repeat.
- **Proof.** [inference] The table's rows by test name, and the repeat probe's equal outputs.

#### A-V6. One skeptical round on numbered claims, against a named release bar

- **Learned.** [fact] The release bar lists the consequences that block: a call past the ceiling, a request over priced capacity, a dispatch that differs with every added option absent, a stored message lost or stored twice, a run live after its owner settled. Every other finding is built, refused with its reason, stated as a limit, or handed to its owner. None is deferred.
- **Evidence.** [fact] `disclosure` § The release bar. [record] A lane that did not run a differential marked its claim unresolved (map C § Falsify rounds).
- **Tenet.** [inference] A large change gets one independent round on numbered falsifiable claims, by lanes that did not write the code. The plan names the consequences that block a release ahead of the round, and a finding under the bar never blocks.
- **Proof.** [inference] The claims file, each lane's verdict per claim, and the bar's list.

#### A-V7. One closure check, then stop

- **Learned.** [fact] After the fix round, one closure check ran 40 mutations in a scratch copy, found one open row, and closed the round when that row's mutation reddened 1 of 60. [record] The user ruled on 2026-10-18 that converging rounds end with one closure check (memory `feedback-falsify-exit`).
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State, row "The closure check".
- **Tenet.** [inference] A fix round re-audits the repaired claims only. One closure check reads whether each closed and opens no other search. A class that recurs across rounds is a design question, and it goes to a ruling.
- **Proof.** [inference] The closure report's row per finding.

#### A-V8. Hand every door the malformed shapes

- **Learned.** [record] The objective lane handed each door a plain object, a getter, a frozen object, a non-enumerable member, an inherited member, a symbol key, a `Proxy`, a class instance, and a spread. A getter that answers differently on each read passes a record check and stores another value, which the guide states as a limit (map C § Falsify rounds; map B § Exact record admission).
- **Evidence.** [fact] `18a3677b`; `disclosure` § The re-prepared 0.0.42.
- **Tenet.** [inference] Every admission door is tested with the malformed-value battery from `@orkestrel/test`. A shape the door cannot close is stated as a limit in the guide.
- **Proof.** [inference] A parameterized test over the battery per door.

### The design method

#### A-D1. Probe first, and stop when the probe returns

- **Learned.** [fact] The user ruled on 2026-11-10: "prototype early ... It's about breadth rather than depth, fail early and fast to decide definitively." Phase 0 ran every deciding probe and a thin prototype ahead of any phase. [record] Unit K's second and third probes each returned a remainder row and stopped the build ahead of any `src` edit (map C § Probe first and the return rule).
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § Rulings, 2026-11-10, and § State, the phase 0 rows.
- **Tenet.** [inference] A design's open questions are each settled by a throwaway probe under [record: ] on the base tree and on a temporary mutation of it, ahead of any source edit. A probe that returns the unexpected reading stops the unit and goes to a ruling. An adopted probe's cases move into the suite, rewritten to the repository's rules.
- **Proof.** [inference] The probe's two-arm readings and the brief's stop sentence.

#### A-D2. Write the adoption rule ahead of the run

- **Learned.** [record] The request-bounded shown set was to be adopted only on thresholds written ahead of any arm. One arm read 27 of 42 against 37 of 42, and the proposal was refused. A further probe that would adopt on a gain of one request was refused (map D § The window keeps no `load` exchange).
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State, row "Arm `taverna` live rerun": `agent-consumer-live4` was adopted under the rule written ahead of it. [fact] `disclosure` § The bar of the re-prepared 0.0.42: the triage's line on the request-bounded shown set is void.
- **Tenet.** [inference] Each measured decision states, ahead of the run, the reading that adopts, the reading that refuses, and the fixture and sample reasoning. A margin inside one run's spread adopts nothing.
- **Proof.** [inference] The ruling's dated adoption line and the run's reading beside it.

#### A-D3. The arithmetic names the term ahead of a mechanism

- **Learned.** [fact] The 1.346 miss recomputed to the density the sample had dropped: (2.43 − 0.838) × 191 is about 304 tokens against a reading 294 apart. The 6.43 miss recomputed to the wrong credit rate from the calibration record.
- **Evidence.** [fact] [record: k3-ruling.md] § Point 1; [record: room-spare-ruling.md].
- **Tenet.** [inference] An outlier is recomputed from the recorded figures until one term accounts for it. A mechanism is designed only after that term is named.
- **Proof.** [inference] The ruling shows the recomputation and the residue it leaves.

#### A-D4. Read the engine ahead of choosing a comparison

- **Learned.** [fact] Whether the calibration comparison is `>` or `>=` turned on what the daemon reports for a cut prompt. A reading showed 1026 reported at a 2048 window against 6739 at 16384, a silent cut under the window, so `>` stayed and the limit went into the guide.
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State, row "Arm `taverna` live rerun and the window reading".
- **Tenet.** [inference] A choice that depends on engine behavior is settled by a recorded reading of that engine at the declared floor. A recalled fact about an engine is labeled unread until the probe runs.
- **Proof.** [inference] The probe's reading with its engine version, cited from the constant or the comparison it decides.

#### A-D5. Every row is built, refused, stated as a limit, or handed on

- **Learned.** [fact] By the user's ruling of 2026-11-12 no finding is deferred. [record] The triage built one row, handed five to their owners, and closed the remainder as refused with reasons. A listing was ruled no reason to build (map D § Rulings that closed a mechanism).
- **Evidence.** [fact] `disclosure` § The release bar and § Refused.
- **Tenet.** [inference] The plan holds no parked row. Each row ends as built, refused with its reason and reopen trigger, stated as a limit in the guide, or handed to the package that owns it with the hand-off sent.
- **Proof.** [inference] The plan's tables, each row with one of the four ends.

#### A-D6. Census a defect class ahead of the second repair

- **Learned.** [record] After the second fail-open option surfaced, a census marked every door and ruled each row once. [record] The user ruled on 2026-11-04 that recurring findings call for a census by class and a release bar (memory `feedback-breadth-by-class`).
- **Evidence.** [fact] `disclosure` § The bar of the re-prepared 0.0.42, line "The door census's rows ruled".
- **Tenet.** [inference] The second member of a defect class triggers a census of the class across the four packages. Each hit is ruled once and fixed at its cause.
- **Proof.** [inference] The census table and one claim per built row.

#### A-D7. The smallest mechanism a reading supports, usable by its least capable caller

- **Learned.** [record] The fixed preamble, a per-workspace rate, and a rescale from a partial call were each visible in the records and left out, because the simpler formula's error sat on the safe side inside the bar. [record] The user ruled that every surface must be usable by the smallest local model and by the developer with few concepts (memory `feedback-smallest-models`).
- **Evidence.** [fact] `disclosure` § Refused, "Closed from the deferral list, 2026-11-12".
- **Tenet.** [inference] A mechanism keeps the smallest form that a reading has not falsified. A further term needs a reading outside the bar. An error text is judged by whether a caller with no other context can act on it.
- **Proof.** [inference] The refused list, and A-C9's remedy test.

### The release and cross-package method

#### A-R1. Layer order, with every dependent re-pinned

- **Learned.** [record] A caret on a `0.0.x` version admits that version alone, so a dependent left on the earlier range installs a second nested copy. One release visit re-pinned runtime ranges only, and every study check then refused on a nested copy (memory `agent-study-release-order`).
- **Evidence.** [fact] `0161a69d` and `75886fcb` ("Re-pin the @orkestrel ranges for the release visit"). [fact] [record: study-sv-run.md]: two nested-copy failures passed after the dev re-pin.
- **Tenet.** [inference] A release wave names its layers ahead of the first publish and re-pins every dependent, development dependencies included. After each install, a listing of nested `@orkestrel` copies must be empty.
- **Proof.** [inference] The nested-copy listing and the lockfile's single entry per package.

#### A-R2. Local pins through content-named tarballs and a ledger

- **Learned.** [record] Unpublished builds are consumed as `file:` tarballs named by content under [record: ] with a `pins.json` ledger, restored ahead of any scaffold verb, any gate that proves the published artifact, and any publish (memory `study-local-consumer`).
- **Evidence.** [record] Scaffold's `orkestrel-publish` skill is the canonical home.
- **Tenet.** [inference] A cross-package unit reads an unpublished dependency through the pin ledger and never commits a pin. A reading names the pinned build's digest.
- **Proof.** [inference] The ledger's status check that installed bytes match the recorded hash.

#### A-R3. The blast-radius read covers a dependent's tests and its guide fences

- **Learned.** [fact] After Agent 0.0.42 published, nine Ollama test callers failed because each passed a stored message with its minted `id` to `add`. The consumer reading ahead of the release had covered callers outside tests alone.
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State, row "Ollama 0.0.36 and Toolbox 0.0.31". [fact] [record: r.md]: two test fixtures and one guide fence in Agent itself needed the same caller fix.
- **Tenet.** [inference] Ahead of a release that tightens admission or changes a contract, each dependent's `src`, `tests`, and guide fences are swept for the changed call shape, and each dependent's suite runs against the candidate build.
- **Proof.** [inference] The sweep's term list with its hits, and each dependent's suite count on the pinned candidate.

#### A-R4. A handed-on row is on the receiving release's bar

- **Learned.** [fact] Row D20 was handed to Toolbox and missed at Toolbox 0.0.31, which shipped without it, and a further unit built it.
- **Evidence.** [fact] `agent` `.orkestrel/agent/plan.md` § State, row D20.
- **Tenet.** [inference] A row handed to another package is written into that package's plan as a release-bar line in the change that hands it on.
- **Proof.** [inference] The receiving plan's line, checked at its release visit.

#### A-R5. A live receipt names its build and lapses with it

- **Learned.** [record] A probe showed that a source change to the calibration messages changed the offline calibration, so the earlier live receipt stopped standing and a live rerun joined the bar (map C § The consumer harness).
- **Evidence.** [fact] `disclosure` § The bar of the re-prepared 0.0.42: arm `taverna`'s receipt, "which PK2 puts on a live rerun under K".
- **Tenet.** [inference] A recorded reading names the build it read. A change to the measured path voids the reading until it is read again.
- **Proof.** [inference] The bar table's receipt column, with the build beside each receipt.

#### A-R6. Record the ruling ahead of the dispatch

- **Learned.** [fact] The O-and-D ruling was committed as `095ce0db` ahead of the build in `1d99e541`, and the records followed in `18a3677b`.
- **Evidence.** [fact] The `agent` log orders `095ce0db`, `1d99e541`, `c0b84d16`, `18a3677b`.
- **Tenet.** [inference] A ruling that changes a design is committed to the campaign folder ahead of the unit it orders, and the closing commit carries the unit's evidence.
- **Proof.** [inference] The log's order.

#### A-R7. Shared instruments and shared configuration stay with their owner

- **Learned.** [fact] The lane, the mutation script, and the interleave script are scaffold's and Agent vendors none. [record] Agent measured the parallel-files setting at 242.9 s and sent the reading to scaffold in place of editing an emitted line (map C § The study suite).
- **Evidence.** [fact] [record: study-sv-run.md] § A-P4.
- **Tenet.** [inference] A package edits no scaffold-owned file. A reading that argues for a change to one goes to scaffold with its run.
- **Proof.** [inference] The scaffold `audit` verb reads clean.

## 2. Anti-patterns

- **A stand-in was priced in place of the dispatched bytes.** [record] Caught by a reviewer's model-free sweep: 27 of 5756 calls over the limit, control 0 of 3682. [inference] Prevented by A-C6.
- **Safety applied only where an unrelated option was on.** [record] Caught by taverna's reading of a request priced as not fitting and sent anyway ([record: room-all-ruling.md]). [inference] Prevented by A-C8.
- **A subset was credited at a rate the measurement did not support.** [fact] Caught only by the live consumer run, at 6.43 times the price, with every unit test green. [inference] Prevented by A-C5 and A-M7: a formula over one measured total needs a scripted arm at the real client's rates.
- **The measurement itself was unbounded and ungated.** [record] Caught by a re-audit that counted calibration calls: 642 over capacity. [inference] Prevented by A-P2.
- **A repair dropped a term the old path had covered.** [fact] The bounded sample removed the dense workspace text and read 1.346 on the next live run. [inference] Prevented by A-R5: rerun the live receipt after changing what a sample contains.
- **A child refused after its parent ran.** [record] Caught by probe PJ. The row had been closed once to avoid a second statement of each bound, and the closure was reversed. [inference] Prevented by A-C2 and A-C3 together.
- **A misspelled option failed open.** [record] Caught by a falsify lane. [inference] Prevented by A-C1.
- **A cache's stale test did not read what a write changed.** [record] After a tool edit, the following request still showed the earlier text, and a guide sentence said otherwise. A probe with a control caught it after 0.0.42 published (`disclosure` § Agent 0.0.43). [inference] Prevented by a rule under A-P5: each cached build lists its inputs, and one test per write path reads the following build.
- **A write followed a pointer another session could move.** [record] Edits landed in the registry's active workspace while the prompt showed another. [inference] Prevented by capturing the resolved target at plan time and rechecking it at the write, per A-C6 and A-C7.
- **A filter ran after the walk.** [record] Covered under A-N3. [inference] Prevented by A-N3.
- **A proof could not fail.** [record] Surviving mutants across units 1A, 1B, the durable unit, K, the closure check, Study P7, Workspace, and Toolbox were one class: the test did not distinguish the mutation that removes the behavior. A retained seed fixture was refused for the same reason. [inference] Prevented by A-V2 and A-V4.
- **A usage failure read as a result.** [record] A mutation ticket exited 64 on every step because its edit path was wrong, and nothing was mutated. [inference] Prevented by reading the mutated log's test count ahead of the verdict.
- **A fixture was not deterministic.** [record] Covered under A-V5. [inference] Prevented by A-V5's repeat run.
- **Rounds went deep on one seam.** [record] Phase 3's room seam took a series of consultant rulings, each closing the class the earlier site left open. [inference] Prevented by A-D6 and A-V7: at the second finding on a seam, census the class and move the check to where the quantity is knowable.
- **Tests were written ahead of the probe's return.** [record] They were taken back out of the tree when the probe returned ([record: k.md]). [inference] Prevented by A-D1.
- **An ecosystem primitive was rebuilt locally.** [record] Covered under A-N2. [inference] Prevented by A-N2.
- **Experiment options outlived the experiment.** [record] Covered under A-P14. [inference] Prevented by A-P14.
- **A uniform seed flattered a cost.** [record] Covered under A-M6. [inference] Prevented by A-M6.
- **A precondition was stated and never pinned.** [record] The trim's monotonic assumption has no mutation, and mutation `floor-fit` was left unpinned with the gap recorded ([record: triage-ruling.md] § D35). [inference] Prevented by A-P8.
- **A dependent broke after publication.** [fact] Covered under A-R3 and A-R4. [inference] Prevented by A-R3 and A-R4.
- **A second run reached shared calibration.** [record] Covered under A-C11. [inference] Prevented by A-C11.

## 3. Applying the patterns to the four packages

Every line in this section is [inference], read against `native` and against the package's guide in `scaffold/guides/`. A line that reports what a guide states is marked [fact] for that statement.

### `database`

- [fact] Guide § Contract invariant 3 states scan-first with optional native overrides, and `native` § 1 replaces it.
- [inference] **A-N1 and A-N3 bite hardest.** The plan's `residual` is the only source of core work, so the recorder assertions of A-N1 and A-P10 are the acceptance instrument for every read path.
- [inference] **A-C3 governs the planner.** `planSQLiteQuery`, the SQL compiler, and `scanDriver` read one coverage predicate per clause. The operator matrix in `native` § 8 is A-C3's two-direction equivalence, and it needs the boundary table as well as seeded draws.
- [inference] **A-V3 shapes the conformance differential.** `native` § 8 names the text-order case as the one exemption. Under A-V3 each published-behavior change in `native` § Decisions is its own class with a pass rule, the remainder must be empty, and a control must land in it.
- [inference] **A-C2 and A-C7 govern the journal and the batch.** [fact] The guide's `Table.test.ts` row lists "sequential partial-batch abort semantics", which `native` § 8 replaces with all-or-nothing. The journal needs A-V5's ordering table at each await: rejection, abort, `clear`, close, and a second scope.
- [inference] **A-C4 bars a stored mark.** `native` § 3 and Point 6 already refuse a trusted mark and a stored index record. The same tenet applies to the journal's touched set and the statement cache's contents: each is derived from the scope and the SQL text.
- [inference] **A-P4 and A-P6 govern the statement cache.** The `json_each` form in `native` § 4 is A-P4 applied: the list length leaves the key. The recorder's prepare count is the proof.
- [inference] **A-P9 and A-M6 set the bars.** The residual path's bar is a share of the page budget a consumer feels, read at the largest table the contract admits, with a growth control, on rows of mixed width.
- [inference] **A cache's stale test is the highest-risk seam.** [fact] The guide's Practices suggest `table.emitter` for a consumer's cache invalidation. A cache the core itself holds follows A-P5 and reads its inputs at use, with no listener.
- [inference] **A-C9 already holds for writes.** [fact] Guide invariant 2 keeps the rejected row out of the message and context. The raising read of `native` § 3 needs the same test.

### `relation`

- [fact] Guide invariant 5 states that concurrent `link` calls can each insert and that `unlink` removes every matching row, and `native` § 7 replaces both with one keyed operation.
- [inference] **A-N1 bites hardest.** The engine's conflict answer is the fact "already linked", so `link` holds no count and no check of its own, and its event follows the engine's answer.
- [inference] **A-N4 follows.** Relation keeps no uniqueness logic beside the primary key.
- [inference] **A-P12 is the performance contract.** [fact] Guide invariant 3 already states one query per direct relation and two per `through`. A recorder assertion makes that count a test for each relationship and each nesting level.
- [inference] **A-C11 explains the shape.** `Model` holds table-only storage, so atomicity must come from one native operation and never from a transaction the handle does not expose.
- [inference] **Admission of size is open.** A load's key list and its result are unbounded per `native` Point 3. A-C5 asks which error is admissible when a list is large: more rows read, or a refusal.
- [inference] **A-V5 applies to `link`.** Two concurrent calls for one pair, an abort between the junction read and the target read, and a scope that rolls back after the event has fired are each a row.
- [fact] The guide calls exact typing of loaded relations and write-cascades a "deliberate, documented deferral". [inference] Under A-D5 each needs one of the four ends.

### `sqlite`

- [fact] Guide invariant 3 states the wrapper is native only and holds no query builder, and `native` § 8 states it needs no functional change.
- [inference] **A-N4 and A-P14 bite hardest.** The wrapper's risk is growth. Each added member needs a consumer's reading, and the driver's needs (the statement cache, `BEGIN IMMEDIATE`, the pragma read) stay in `database` per `native`.
- [inference] **A-D4 governs every engine claim.** `native` § Unread lists the readings owed at the declared floor: FTS5, the bundled SQLite version, `PRAGMA optimize` behavior, and unpaired surrogates. Each is a recorded probe ahead of the unit that relies on it.
- [inference] **A-C10 applies to the version.** The driver records the bundled version and compile options as observations and refuses on none of them.
- [inference] **A-P1's attributable stops apply to faults.** [fact] Guide invariant 7 maps `SQLITE_LOCKED` to `'UNKNOWN'`. A caller that must tell a lock fault from an unclassified fault cannot, which is a question for a ruling.
- [inference] **A-C7 applies to statement lifetime.** [fact] Guide invariant 6 keeps a statement of a closed connection `CLOSED` after a reconnect. A cache above the wrapper drops its entries on `close`, as `native` § 4 rules, and A-V5 tests the order close, reconnect, cached call.
- [inference] **A-C8 applies to `pragma`.** [fact] The guide states pragmas "take trusted internal names only". `native` Point 5 places the name check in the driver. Whether the wrapper itself refuses a malformed name is open.

### `indexeddb`

- [fact] Guide invariant 7 states that `get` and `records` narrow each value with `isRecord`, so a store holding a non-record value shows `count` greater than `records().length`.
- [inference] **A-C8 bites hardest.** That invariant is a silent skip at the wrapper, one layer under the raising read of `native` § 3. A row the wrapper drops never reaches the core's assertion, so `count` and `records` can disagree again. The new session rules on it first.
- [inference] **A-C7 and A-P11 govern every multi-step read.** [fact] The guide's Practices state that an unrelated await lets a transaction commit. Each batched stream, each offset walk, and the journal's restore states its transaction boundary, and no yield sits inside one.
- [inference] **A-P12 is the cost model.** [fact] Invariant 6 gives each standalone call its own transaction. The recorder counts transactions per core operation, and `any`, batch writes, and paging each read one.
- [inference] **A-P2 sets the batch size.** `native` § 5 asks for one named constant chosen by measurement. Under A-P2 and A-P3 it carries its run, and under A-M6 the run uses rows of mixed width.
- [inference] **A-P8 applies to `rangePrefix`.** [fact] The guide states the helper caps the range at U+FFFF. The successor bound of `native` § 5 is a precondition a boundary fixture must pin.
- [inference] **A-V5 applies to the lifecycle.** [fact] Invariants 9 and 10 already cover blocked opens and close races. The planner's paths add rows: a version change between two batches of one stream, and a close during a batch.
- [inference] **A-M7 has a host gap.** [fact] The guide states the suite runs on Chromium only. A claim about another browser is unproven until that browser drives it.

## 4. Open questions the new session rules first

- [inference] **Q1. The release bar.** Which consequences block a database-family release? A candidate list, from A-V6: a read that returns a row failing its contract, `count` disagreeing with `records` for one input, a batch or scope that leaves a partial write, a native path returning rows the core engine does not return outside a named class, and a refusal that carries a row.
- [inference] **Q2. The differential's classes.** The class list for the paging wave's conformance differential, with each pass rule and the control, written ahead of the first run.
- [inference] **Q3. The bars and their baselines.** The caller's spend that each residual bar is a share of, and the table size and row width spread that count as the input limit. `native` § 8 quotes taverna's readings, and their instrument is unread.
- [inference] **Q4. The wrapper's silent skip.** Whether `indexeddb` invariant 7 becomes a raise, stays as a stated limit, or is unreachable under the driver, with a probe that stores a non-record value under the driver's store.
- [inference] **Q5. Relation's documented deferrals.** One of A-D5's four ends for typed loaded relations and for write-cascades.
- [inference] **Q6. The pragma name check's home.** The wrapper, the driver, or both, given A-C1's rule that a helper downstream of a door checks nothing again.
- [inference] **Q7. A bound on `any` and on an include's result.** Whether a size refusal exists, where it sits, and what it reports.
- [inference] **Q8. The real client.** Which taverna commit is pinned, who owns the harness, whether it is bench or product, and where its offline twin lives.
- [inference] **Q9. The recorder's home.** Whether the rows-read and round-trip recorder of `native` § 8 is an `@orkestrel/test` export or a setup fixture, checked against the test package's guide ahead of writing one.
- [inference] **Q10. The declared Node floor.** `native` names Node 22.12.0 as the floor. A standing ruling in the Agent session's memory names `>=22.18.0`. Read each package's `engines` field and probe the engine at the value found.
- [inference] **Q11. Lock-fault classification.** Whether `SQLITE_LOCKED` gains its own code, per A-P1's attributable stops.
- [inference] **Q12. Which assumptions get a mutation.** The residual path rests on stated preconditions: `stream` honors `order`, a prefilter is a superset, a successor bound is exact. Name each and its pinning test ahead of the paging wave's acceptance.
- [inference] **Q13. Statistics for the IndexedDB planner.** The ranking in `native` § 5 is by rule. State the reading that would reopen a cost model, per A-P1, and build none until it appears.
