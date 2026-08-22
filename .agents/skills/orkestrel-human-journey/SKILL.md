---
name: orkestrel-human-journey
description: Prove a browser application the way a person uses it — real keystrokes, clicks, and Tab/Enter against only what is visible and reachable — and generate the capture portfolio from those same journeys. Use when accepting a UI build, proving an application end to end, deciding whether a surface is reachable by keyboard alone, proving what a screen refuses as well as what it does, auditing whether the interface speaks the user's vocabulary rather than the engine's, producing the screenshots a design review judges, or whenever the only evidence a screen works is a test that drove it through JavaScript instead of through the interface.
---

# Prove an application through human journeys

## Load authority

Read the current files in this order:

1. `AGENTS.md`.
2. `.claude/rules/tests.md` for test law, real implementations, and shared test infrastructure;
   `.claude/rules/browser.md` for browser and Vue usage; `.claude/rules/application.md` for app
   composition and entries; `.claude/rules/documentation.md` for parity. Those rules are the
   contract; this skill is the workflow.
3. [layer.md](references/layer.md) before building, extending, or debugging the journey layer.
4. [captures.md](references/captures.md) before registering a state or placing a capture.
5. `guides/README.md`, the governing guide for the surface, and `ROADMAP.md` when present.
6. The `*/types.ts` of every environment the journeys drive, plus the application's root component,
   route entry, and store contract.

## Apply the journey laws

1. **Drive only what a person can see and reach.** Target every control by its ARIA role and its
   accessible name as rendered. Never reach into a component instance, a store, a transport, a
   copied credential, or a test-only hook to make a step succeed. Report a step that cannot be
   performed through the interface as a finding about the interface.
2. **Assert what is seen.** Quote the rendered text a person reads, which is `innerText` — a label
   under `text-uppercase` asserts as `TRACE` where the source says `Trace`. Never let a state read
   replace a perception assertion; it may only corroborate one, and `.claude/rules/tests.md` fixes
   which state a test may read at all.
3. **Assert what the interface withholds.** Assert every refusal through the resolver's exact
   failure voice, and distinguish an absent control from a present but humanly unreachable one.
4. **Keep transport and persistence proofs in their own declared block,** never inside a journey.
   Assert every live or asynchronous fact by convergence — poll until it contains or equals — never
   by an identity read of one frame.
5. **Generate the portfolio from the acceptance journeys.** Place each registered state inside the
   journey that reaches it, and never register a state no journey reaches.
6. **Commit a value through an act a person performs:** Enter, Tab away, or a named button. Report a
   surface that commits on a timer, on an unpredictable event, or only after work the person cannot
   observe as a surface finding, and never work around it in the layer.
7. **Type only what a person would.** Journeys carry trusted input; adversarial payloads belong to
   the transport family and the parser suites.

## Build or verify the journey layer

- Build the layer as shared browser test infrastructure under `.claude/rules/tests.md`: it lives in
  the workspace's browser test setup module, exports every helper from there, and adds a journey
  helper only where `@orkestrel/test` publishes none. Never declare a resolver inside a test file.
- Give the layer every capability [layer.md](references/layer.md) fixes: the role-scoped resolver
  and its distinct failure voices, region-scoped resolution, the input and traversal verbs, the
  perception readers, and the capture hook.
- Drive every step through the browser provider's user-event API, and never dispatch a constructed
  event ([layer.md](references/layer.md) → What it drives).
- Re-verify the layer against what the application renders now whenever markup changes
  ([layer.md](references/layer.md) → Role vocabulary).

## Derive journeys from intents

Write one journey per user intent, named for what the person achieves rather than for the
components it passes through. Place them in the browser environment's `integration.test.ts`, whose
placement and scope `.claude/rules/tests.md` fixes.

- Enter through the real entry: mount the shipped root component with a real store and the route a
  person lands on, and let the application load itself.
- Reach each surface's own controls through forward Tab traversal in at least one journey.
- Type keystroke by keystroke where the keystrokes are the subject; fill in one operation where the
  text is only a payload the person pastes.
- Poll every fact the application produces asynchronously until it converges. Never assert one from
  a single read after the action. A poll's predicate must be able to go false-to-true after the
  action it observes; a predicate already true when the poll starts binds nothing.
- Assert the state the flow must reach, never the transient path taken to it. A criterion that bans
  a harmless transient over-refuses and breaks on the next honest implementation.
- Assert the negative beside the positive whenever a value replaces another: the new sentence is
  present **and** the old one is gone.
- After a confirmed destructive action, assert through trusted input that focus landed on a visible,
  announced location.
- Assert the whole page's perception never matches the vocabulary the product does not speak —
  engine, schema, and implementation words the interface is supposed to translate.
- Report a bare accessible name that answers for more than one reachable element on one screen as a surface
  finding, and target through role or region until the surface is fixed.

## Prove the refusals

- Give every surface a refusal family: the controls a person must not reach in the state the
  journey has put the surface in.
- Assert the exact failure voice the case means. Never write an assertion that accepts more than
  one voice.
- Cover the restrictions the interface imposes on itself: a collapsed panel's field, a verb
  belonging to another kind of object, a control disabled until its precondition lands.
- When a refusal changes voice after a markup change, read it as a role or reachability change
  before treating the element as missing
  ([layer.md](references/layer.md) → Role vocabulary).

## Declare the transport family

- Name the block for what it proves — persistence, restart, storage failure.
- Drive it through the application's real session and store contracts. Build a store that stalls a
  read, fails a fixed number of reads, or fails a write as an inert configurable implementation of
  the published interface, under the real-implementation law in `AGENTS.md`.
- Prove the visible half in a journey: the failure sentence a person reads, and the retry control
  that clears it.
- Assert restart by starting a second session over the same store and polling the restored value.

## Generate the portfolio

Follow [captures.md](references/captures.md) for the state registry and its placement rules, the
theme-and-viewport variant matrix, the always-on filename proof, the capture-run membership proof,
and how a state that exists only during an activation is captured.

When a capture and a green suite disagree, the capture is the evidence and the fixture is the
defect.

Route review of the portfolio to the `orkestrel-polish-surface` campaign. Do not judge it here.

## Accept

Completion requires all of:

- every in-scope user intent reaching its outcome through the interface, with no step that reaches
  past it;
- keyboard-only reachability proven on every surface the journeys cover;
- a refusal family per surface, each asserting one exact failure voice;
- the transport family declared separately, driven through real implementations, and convergent;
- the registry-times-variants filename proof and the state-placement proof green in an ordinary run;
- one capture run per variant writing every registered file, each read back non-empty;
- perception assertions quoting rendered text, and the vocabulary sweep green on the whole page;
- the repository gates green, under the independent-verification law in `.agents/orchestration.md`.

Report each journey by the intent it proves, the refusals it establishes, the states it placed, and
every surface finding the layer's refusals exposed.
