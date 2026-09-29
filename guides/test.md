# Test

> The test helpers the `@orkestrel` fleet kept rewriting, published once: families of what a test
> records, what it waits for, and what it owns, with a pair outside all of them and a browser
> journey layer beside them.

**What a test records.** A call recorder, a map of recorders subscribed to an emitter's events, a
signal's live abort-listener tally, a numbered resource ledger, a captured throw, a drained async
source, a JSON copy, a required value, a decoded JSON Lines stream, and a cookie jar filled from
real responses. Each turns what the code under test did into a value you can assert on.

**What a test waits for.** A real delay, and — each bounded by a budget, an interval, and an abort
signal — a named condition, a produced value, a first event delivery, a socket's close, and a
directory the host has finally let go. One wait takes no bound at all, because it needs none:
`waitForAbort` parks on a signal's own abort. Nothing here replaces the host clock: every bound is
a real elapsed interval read with `performance.now()`.

**What a test owns and must give back.** A temporary directory, a cleanup list, and a loopback
server, each carrying `destroy()`. Each one takes something from the host.

`resolveRoot` and `readInventory` are the pair outside all of them: together they read the
real tree a test checks itself against. Neither records anything, neither waits for anything, and
neither owns anything to give back.

`createHostileValues` sits outside them too, on the input side: it is what a test feeds its guards,
a corpus whose every member throws on a naive read or violates a naive structural assumption. The
host-capability probes are outside them on the environment side, answering what this filesystem
does rather than what its platform is called. `invokeUnchecked` and `readProperty` are outside them
at the type boundary, where a value nothing declares meets a claim its caller owns, and
`flattenHeaders` is outside them on the comparison side, turning any header initializer into one
frozen record.

The journey layer drives a real interface by role and accessible name through the installed Vitest
provider, measures what a reader can see of the result, records the scenario and the page's own
output as it goes, and generates the capture portfolio from the same journeys. Around it sit the
fixture the journey runs against and the readings a styling claim rests on: an element built and
mounted, a field driven the way its component listens for, the tokens, colors, and rules the
cascade resolved, and a database given back at the end of the test that filled it.

A helper ships here when it is a reusable test mechanism with a real consumer that no native or
declared primitive already covers; [Limits](#limits) states that rule and what it refused. This
package holds one implementation of each and ships as a `devDependency`. Nothing here runs in
production code. Source: [`src/core`](../src/core), [`src/browser`](../src/browser), and
[`src/server`](../src/server).

This package runtime-depends on `@orkestrel/contract` for the outcome type `retryUntil` reads
internally and for the guards every environment narrows with. Nothing from it is re-exported, and no
exported type here names a type from another `@orkestrel` package. A
dependency on `@orkestrel/emitter` would install a second copy of it beside the one a consumer
already pins, and the compiler reads two copies as two distinct types. A foreign type in a
signature fails the other way, rejecting the consumer's own local value inside the consumer's own
repository. Those rules hold both.

## Install

Add the package as a development dependency; it ships no runtime code.

```bash
npm install --save-dev @orkestrel/test
```

`@orkestrel/test` is the host-independent core. `@orkestrel/test/server` is the Node face — the
filesystem helpers, the process and socket readings, the cookie jar, and the pure leaves they are
built from. `@orkestrel/test/browser` is the
journey layer, which drives a real browser through the installed Vitest provider. Core touches
neither `node:*` nor the DOM, so a browser test project imports it unchanged.

The browser face ships ES only. It is built on `vitest/browser`, which is an ES-only module, so no
CommonJS consumer can reach it and no `.d.cts` is emitted for it.

`@orkestrel/test/browser` loads only inside Vitest Browser Mode. It imports `vitest/browser` at
module scope, so importing it from a Node host throws at module load rather than deferring the
failure into the first helper call. A module that must load under Node as well reaches it through a
dynamic import behind a DOM guard — a setup file that a Node project and a browser project both
register is the case that needs it.

## Surface

The values and types that follow are everything this package exports, from its core, browser, and
server environments.

```ts
import { createRecorder, createTeardown, waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'

// What a test owns: one cleanup list, and a temporary directory seeded with the input under test.
const teardown = createTeardown()
const scratch = createScratch({ files: { 'input.txt': 'hello' } })
teardown.add(() => scratch.destroy())

// What a test records: a real callback rather than a spy — hand `handler` to the code under test.
const recorder = createRecorder<[path: string]>()
loader.on('read', recorder.handler)

loader.watch(scratch.path)
await waitForDelay(10) // let a real host timer elapse

recorder.count // how many reads arrived
recorder.calls // the arguments of each, oldest first

await teardown.destroy() // gives every owned resource back, newest first
```

### Core

Imported from `@orkestrel/test`.

#### Types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional
member and `plus` introducing its call-signature members, and a type alias's own type literal with
a union's arms escaped as `\|`. An extended interface's name comes before `plus`, with the members
it adds after.

| Type                       | Kind      | Shape                                                      | Summary                                                                                                                                        |
| -------------------------- | --------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `WaitOptions`              | interface | `{ budget?, interval?, signal? }`                          | Configures a bounded asynchronous wait with an elapsed-time limit, a delay between readings, and an abort signal.                              |
| `RetryOptions`             | interface | `WaitOptions` plus `{ attempts? }`                         | Configures a bounded retry, adding an optional producer-call limit to a bounded wait's bounds.                                                 |
| `TextWaitOptions`          | interface | `WaitOptions` plus `{ exact?, absent? }`                   | Configures a bounded wait over a reading of text.                                                                                              |
| `EventSubscriber`          | type      | `(listener) => cleanup \| void`                            | Subscribes a listener to one event source.                                                                                                     |
| `RecorderInterface`        | interface | `{ calls, count, handler }` plus `clear`                   | Records every call made to its handler.                                                                                                        |
| `EventSourceInterface`     | interface | `{} plus on`                                               | Subscribes handlers to a typed event source.                                                                                                   |
| `RecorderMap`              | type      | `{ readonly [K in TName]: RecorderInterface<TMap[K]> }`    | Maps event names to recorders for their delivered argument tuples.                                                                             |
| `SignalInterface`          | interface | `{ controller, signal, count }`                            | Holds a real abort signal and controller instrumented with its live abort-listener tally.                                                      |
| `SignalRegistration`       | type      | `readonly [listener, installed, capture, cleanup]`         | Represents one abort listener an instrumented signal installed, as its tally holds it.                                                         |
| `ResourceFactoryInterface` | interface | `{ created, destroyed }` plus `create` / `destroy`         | Represents a numbered resource factory with records of every creation and destruction.                                                         |
| `TeardownInterface`        | interface | `{ count }` plus `add` / `destroy`                         | Represents the cleanup a test adds as it goes and runs once, newest first, when it is done.                                                    |
| `TeardownHandler`          | type      | `() => void \| Promise<void>`                              | Represents the work one teardown entry performs when the list is destroyed.                                                                    |
| `JSONSafe`                 | type      | `JSONSafe<T>`                                              | Represents the JSON-safe projection of a type: every member JSON preserves, mapped to itself, and every member it does not, mapped to `never`. |
| `HeadersSource`            | type      | `NonNullable<ConstructorParameters<typeof Headers>[0]>`    | Covers any value the host `Headers` constructor accepts.                                                                                       |
| `JourneyVariant`           | interface | `{ name, width, height }`                                  | Represents one theme-and-viewport pair in the form a project configuration can serialize.                                                      |
| `StatechartStatus`         | type      | `'pending' \| 'idle' \| 'running' \| 'passed' \| 'failed'` | Names the run state a statechart harness publishes through its status attribute.                                                               |
| `StateTransition`          | interface | `{ name, from, event, to }`                                | Represents one row of a statechart table: the entity's state before an event, the event, and the state that event must leave it in.            |
| `StateScenario`            | interface | `{ transition }` plus `arrange` / `act` / `assert`         | Drives one `StateTransition` through the three phases that prove it.                                                                           |

Each interface's call-signature members are listed under [Methods](#methods). `Result`, `Success`,
and `Failure` come from `@orkestrel/contract` (mirrored at [`contract.md`](contract.md)) and are not
re-exported; `retryUntil` reads `Result` internally.

#### Constants

A `Shape` cell holds the constant's declared type.

| API                     | Kind  | Shape                                                                                                        | Summary                                                                                  |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `STATECHART_ATTRIBUTES` | const | `Readonly<Record<'status' \| 'passed' \| 'failed' \| 'total' \| 'scenario' \| 'result' \| 'state', string>>` | Names the attributes a statechart harness publishes, keyed by the fact each one carries. |
| `STATECHART_STATUSES`   | const | `readonly ['pending', 'idle', 'running', 'passed', 'failed']`                                                | Lists every value a statechart harness reports through its `status` attribute.           |

A harness renders the attributes and a gate outside the page polls them, so the names are the whole
contract between the two. `status`, `passed`, `failed`, and `total` belong on the harness root,
`scenario` and `result` on each row, and `state` on the element rendering the entity's current
state. `pending` is what a harness carries while its inventory is incomplete — until every
declared row has rendered and the root carries the row count — so a gate that reads it has found
a harness whose rows never mounted. `idle` is a mounted harness with its tally at zero, `running`
is a run in flight, and `passed` and `failed` are the pair a gate waits for rather than waiting a
fixed duration. An exceptional exit is terminal too: a harness whose `state` reader throws writes
`failed` and then rejects the run, so the gate reads a terminal pair while the suite reads the
throw. `StatechartStatus` is the same set of readings as a named union.

#### Validators

In a guard table a `Shape` cell holds the type the guard narrows to.

| API                     | Kind     | Shape                      | Summary                                                            |
| ----------------------- | -------- | -------------------------- | ------------------------------------------------------------------ |
| `isRecorderMapComplete` | function | `RecorderMap<TMap, TName>` | Checks whether a value contains a recorder for every listed event. |

`isRecorderMapComplete` takes the events as a second parameter rather than reading them off the
value, because the listed events are what completeness is measured against. It reads each listed key
for a `handler` function and a `calls` array, and answers `false` for a value that is not an object,
for a missing or inherited key, and for a member carrying neither. Per-key tuple precision is the
claim the narrowing carries rather than something the reading checks, so a caller relying on it
establishes the pairing between an event and the recorder stored under that event first;
`createRecorders` establishes it by wiring each recorder to exactly the event it stores that recorder
under. Every hostile read is contained, so a value whose keys or getters throw answers `false`
instead of propagating.

#### Helpers

| API                   | Kind     | Signature                                                                             | Summary                                                                                                                                     |
| --------------------- | -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `waitForCondition`    | function | `(description, condition, options?) => Promise<void>`                                 | Waits until a condition holds within an elapsed-time budget.                                                                                |
| `retryUntil`          | function | `(description, produce, satisfied, options?) => Promise<T>`                           | Repeats a producer until one produced value satisfies a predicate.                                                                          |
| `waitForEvent`        | function | `(subscribe, description, options?) => Promise<TArgs>`                                | Waits for the first delivery from an event subscription.                                                                                    |
| `waitForText`         | function | `(description, read, text, options?) => Promise<string>`                              | Waits until a reading of text carries an expected sentence.                                                                                 |
| `checkBounds`         | function | `(subject: string, budget: number, interval: number) => void`                         | Checks the resolved bounds one bounded wait runs under.                                                                                     |
| `buildRetryExhausted` | function | `(description, budget, elapsed, last, cause) => Error`                                | Builds the error `retryUntil` raises when its elapsed-time budget runs out.                                                                 |
| `buildRefusal`        | function | `(name: string, cause: unknown) => Error`                                             | Builds the error a refused fixture build raises, named for the row it was building for.                                                     |
| `dropRegistration`    | function | `(registrations: SignalRegistration[], installed) => SignalRegistration \| undefined` | Drops the registration an instrumented signal installed for one listener.                                                                   |
| `decodeJSONLines`     | function | `(text: string) => readonly unknown[]`                                                | Decodes newline-delimited JSON values.                                                                                                      |
| `waitForDelay`        | function | `(ms?: number) => Promise<void>`                                                      | Waits for a host timer to elapse.                                                                                                           |
| `waitForAbort`        | function | `(signal: AbortSignal) => Promise<void>`                                              | Waits until an abort signal is aborted.                                                                                                     |
| `captureError`        | function | `(thunk: () => unknown) => unknown`                                                   | Captures the value thrown by a thunk.                                                                                                       |
| `requireValue`        | function | `<T>(value: T \| null \| undefined, message?: string) => T`                           | Narrows a value away from `null` and `undefined`, throwing when it is absent.                                                               |
| `collect`             | function | `<T>(source: AsyncIterable<T>) => Promise<readonly T[]>`                              | Collects every value from an async iterable.                                                                                                |
| `collectStream`       | function | `<T>(stream: ReadableStream<T>) => Promise<readonly T[]>`                             | Collects every value from a readable stream.                                                                                                |
| `roundTripJSON`       | function | `<T>(value: T & JSONSafe<T>) => T`                                                    | Copies a JSON value through serialization and parsing.                                                                                      |
| `invokeUnchecked`     | function | `<T>(target: unknown, method: unknown, args: readonly unknown[]) => T`                | Invokes an unknown method through an explicit unchecked result contract.                                                                    |
| `readProperty`        | function | `<T>(target: unknown, key: PropertyKey) => T`                                         | Reads a property from an unknown object or function.                                                                                        |
| `flattenHeaders`      | function | `(init: HeadersSource) => Readonly<Record<string, string>>`                           | Normalizes headers into a frozen plain record.                                                                                              |
| `resolveRoot`         | function | `(meta: ImportMeta) => URL`                                                           | Resolves the parent directory of a calling module, which is the workspace root when called from the conventional `tests/setup.ts` location. |
| `executeScenario`     | function | `(scenario, context) => Promise<void>`                                                | Drives one statechart scenario through its arrange, act, and assert phases.                                                                 |
| `executeScenarios`    | function | `(scenarios, build) => Promise<void>`                                                 | Drives a statechart table row by row, each row against a context of its own.                                                                |

`dropRegistration` is the mechanic `createSignal`'s one-shot and scope-abort paths share, exported
because both of them call it rather than because a consumer was expected to. Reaching it takes a
`SignalRegistration` list of your own: `createSignal` hands back `SignalInterface`, whose members are
`controller`, `signal`, and `count`, so nothing this package returns carries the list to pass.

#### Factories

| API                     | Kind     | Signature                                                                                                 | Summary                                                                                  |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `createHostileValues`   | function | `() => readonly unknown[]`                                                                                | Creates values that make common object readers throw or violate their assumptions.       |
| `createRecorder`        | function | `<TArgs extends readonly unknown[]>() => RecorderInterface<TArgs>`                                        | Creates a recorder for callback arguments.                                               |
| `createRecorders`       | function | `<TMap, TName>(source: EventSourceInterface<TMap>, events: readonly TName[]) => RecorderMap<TMap, TName>` | Creates event recorders and subscribes them to the source.                               |
| `createSignal`          | function | `() => SignalInterface`                                                                                   | Creates a real abort controller whose signal reports its live abort listeners.           |
| `createResourceFactory` | function | `() => ResourceFactoryInterface`                                                                          | Creates a monotonically numbered resource factory with creation and destruction records. |
| `createTeardown`        | function | `() => TeardownInterface`                                                                                 | Creates a teardown list that runs registered handlers newest-first.                      |

### Browser

Imported from `@orkestrel/test/browser`. Every journey verb here resolves its own target from a
role and an accessible name and drives it through the installed Vitest provider, and none of them
takes an element, a component instance, or a selector for the thing it acts on. That is what keeps
a journey a description of what a person does rather than of what the markup happens to be.

The fixture builders, the readers, and the field writers do take an element, and none of them is a
journey verb. `build` creates a node, `mount` attaches one, and `render` does both from
markup or from a tag and its classes; `createHarness` mounts a whole statechart table and hands
back the root it mounted; `buildContrast`, `buildEscapes`, and `buildCensus` each build
a detached control the caller appends where it is reading; `clearStorage` takes nothing at all, and
`removeDatabase` takes a database name. The predicates, the element readers, and the describers name
a node the caller already has — `isRendered`, `isReachable`, `readHit`, `readText`, `readRole`,
`readName`, `readStates`, `readCensus`, `describeTree`, `describeFocus`, `extractOrphans`,
`readRows`, `readStyle`, `readToken`, `readPixels`, `readContrast`, `readLayers`, `readBackdrop`,
and `readRing` — and each reads that node rather than acting on a target it was handed.
`waitForAnimations` takes one too, and waiting for a browser to stop painting it changes nothing
about it. `captureFrame` and `place` take an
element as well, and photographing one is a reading too: neither moves focus, dispatches an event,
or changes what the element renders. `typeInput` and `commitInput` are the exception, and it stays
narrow: they write into the field they are given, as the synthetic counterpart of `typeAccessible`
for a component that listens for `input`. The color leaves, the cascade readers, the pane verbs,
and the whole-document readers take a value or nothing at all, so they name no target either.

#### Types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional
member and `plus` introducing its call-signature members, and a type alias's own type literal with
a union's arms escaped as `\|`.

| Type                  | Kind      | Shape                                                                          | Summary                                                                                                                                         |
| --------------------- | --------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Color`               | type      | `readonly [red, green, blue, alpha]`                                           | Represents one rendered color as straight sRGB channels and its alpha.                                                                          |
| `ElementOptions`      | interface | `{ classes?, text?, attributes? }`                                             | Configures one built element: its class list, its text, and its attributes.                                                                     |
| `FrameOptions`        | interface | `{ path, width, height, element? }`                                            | Configures one captured frame: where it is written, the viewport it is shot at, and what it shoots.                                             |
| `FrameOffset`         | interface | `{ top, left }`                                                                | Represents how far an element frame moves the tester frame from the runner window's origin for the shot, in CSS pixels.                         |
| `FrameReading`        | interface | `{ width, height, floor }`                                                     | Represents one written frame read back from the file a capture produced: its size in device pixels, and the single color its bottom row paints. |
| `CaptureVariant`      | interface | `JourneyVariant` plus `{ apply? }`                                             | Adds to a journey variant the document change a capture run applies before resizing.                                                            |
| `PortfolioOptions`    | interface | `{ states, variants, variant, directory, enabled? }`                           | Configures a capture portfolio: the state registry, the variant matrix, this run's variant, where it writes, and whether it writes at all.      |
| `PortfolioInterface`  | interface | `{ variant, placements, paths, files }` plus `place`                           | Holds the registry of capture states one run places, and the files it wrote placing them.                                                       |
| `JournalStep`         | interface | `{ action, trigger, result }`                                                  | Represents one scripted step a journal recorded, and what the surface did about it.                                                             |
| `JournalInterface`    | interface | `{ steps, output }` plus `start` / `stop` / `record`                           | Records one scenario: every step it took and everything the page said while it ran.                                                             |
| `StateOptions`        | interface | `WaitOptions` plus `{ absent? }`                                               | Configures a bounded wait over the states a control announces.                                                                                  |
| `MediaOptions`        | interface | `{ print?, motion?, forced? }`                                                 | Configures the tester's print medium, motion preference, and forced colours.                                                                    |
| `StorageOptions`      | interface | `{ values?, reads?, writes?, quota? }`                                         | Configures an inert `Storage`: its seed, which operations the host permits, and its quota.                                                      |
| `WebStorageInterface` | interface | `Storage` plus `{}` plus `permit`                                              | Holds a store the host can withhold and later grant.                                                                                            |
| `CensusReading`       | interface | `{ elements, tokens, undeclared }`                                             | Reports an authored-class census: the population walked, the tokens found, and the undeclared.                                                  |
| `ContrastFixture`     | interface | `{ root, refused, accepted }`                                                  | Holds a detached translucent stack whose flat and composited readings disagree across one bar.                                                  |
| `EscapeFixture`       | interface | `{ root, inline, embedded, permitted }`                                        | Holds detached markup a style-escape reading must find, and the one it must leave alone.                                                        |
| `CensusFixture`       | interface | `{ root, token, mark }`                                                        | Holds detached markup an authored-class census must report as undeclared.                                                                       |
| `HarnessOptions`      | interface | `{ scenarios, build, state, pause? }`                                          | Configures the harness that renders one transition table and drives it row by row.                                                              |
| `HarnessInterface`    | interface | `{ root, status, total, passed, failed, failures }` plus `execute` / `destroy` | Holds a mounted statechart harness, the tally it publishes, and the run it drives.                                                              |

#### Constants

A `Shape` cell holds the constant's declared type.

| API                  | Kind  | Shape                              | Summary                                                                                                    |
| -------------------- | ----- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ACCESSIBLE_ROLES`   | const | `readonly string[]`                | Names the interactive ARIA roles a bare accessible name is searched across.                                |
| `CANVAS_COLOR`       | const | `Color`                            | Names the color a browser paints an unstyled document with: opaque white.                                  |
| `CAPTURE_PANE`       | const | `string`                           | Names the attribute marking the runner's tester pane, and the rule that sizes it, while a frame is staged. |
| `CAPTURE_STAGINGS`   | const | `number`                           | Bounds the restagings one capture takes before it refuses a document whose height never settles.           |
| `CONTENT_ROLES`      | const | `readonly string[]`                | Names the roles whose accessible name is the text a reader can see inside them.                            |
| `FIELD_ROLES`        | const | `Readonly<Record<string, string>>` | Names the role each `input` type carries.                                                                  |
| `FOCUSABLE_SELECTOR` | const | `string`                           | Names what sequential keyboard navigation can reach, before disabled and unrendered elements go.           |
| `HEADER_ROLES`       | const | `Readonly<Record<string, string>>` | Names the role a `th` carries for the header axis its `scope` names.                                       |
| `IMPLICIT_ROLES`     | const | `Readonly<Record<string, string>>` | Names the role each listed tag carries in the accessibility tree when it declares none of its own.         |
| `MEDIA_STAGE`        | const | `string`                           | Names the tester root's attribute holding the media readings observed before the first stage.              |
| `POINTER_HOLD`       | const | `string`                           | Names the tester root's attribute holding the pressed pointer's page coordinates.                          |

#### Helpers

| API                        | Kind     | Signature                                                                                                               | Summary                                                                                                                                                                                                                                                                         |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveAccessible`        | function | `(name: string) => HTMLElement` / `(role: string, name: string) => HTMLElement`                                         | Resolves one visible, focus-reachable interactive element by its exact accessible name. A wholly-off-viewport target is scrolled into view before reachability is measured.                                                                                                     |
| `resolveAccessibleWithin`  | function | `(region: string, role: string, name: string) => HTMLElement`                                                           | Resolves one human-reachable control by role and accessible-name text inside a named region.                                                                                                                                                                                    |
| `resolveRendered`          | function | `(first: string, second?: string) => HTMLElement`                                                                       | Resolves one rendered, focus-reachable interactive element without requiring it to intersect the viewport yet.                                                                                                                                                                  |
| `computeNamePattern`       | function | `(name: string) => RegExp`                                                                                              | Computes the pattern that matches one accessible name a decorative glyph may sit beside.                                                                                                                                                                                        |
| `isOutsideViewport`        | function | `(rectangle: DOMRectReadOnly) => boolean`                                                                               | Determines whether a rectangle lies wholly outside the browser viewport.                                                                                                                                                                                                        |
| `isRendered`               | function | `(element: Element) => boolean`                                                                                         | Determines whether the accessibility tree presents one element at all.                                                                                                                                                                                                          |
| `isReachable`              | function | `(element: Element) => boolean`                                                                                         | Determines whether a person can click one element where it sits.                                                                                                                                                                                                                |
| `readHit`                  | function | `(element: Element) => Element \| undefined`                                                                            | Reads the topmost element at one element's bounding-box centre.                                                                                                                                                                                                                 |
| `clickAccessible`          | function | `(name: string) => Promise<void>` / `(role: string, name: string) => Promise<void>`                                     | Clicks one visible, focus-reachable control by its accessible name through the browser provider.                                                                                                                                                                                |
| `clickAccessibleWithin`    | function | `(region: string, role: string, name: string) => Promise<void>`                                                         | Clicks one human-reachable control by role and accessible-name text inside a named region.                                                                                                                                                                                      |
| `clickDisclosure`          | function | `(name: string) => Promise<void>`                                                                                       | Opens or closes one native details disclosure by its rendered summary.                                                                                                                                                                                                          |
| `sendProtocol`             | function | `(method: string, params: Readonly<Record<string, unknown>>) => Promise<void>`                                          | Sends one DevTools protocol command through the browser provider.                                                                                                                                                                                                               |
| `hoverAccessible`          | function | `(name: string) => Promise<void>` / `(role: string, name: string) => Promise<void>`                                     | Hovers one visible, focus-reachable control by its accessible name through the browser provider.                                                                                                                                                                                |
| `holdAccessible`           | function | `(name: string) => Promise<void>` / `(role: string, name: string) => Promise<void>`                                     | Holds the primary pointer button on one visible, focus-reachable control by its accessible name.                                                                                                                                                                                |
| `holdAccessibleWithin`     | function | `(region: string, role: string, name: string) => Promise<void>`                                                         | Holds the primary pointer button on one control by role and accessible-name text inside a named region.                                                                                                                                                                         |
| `driveHold`                | function | `(resolve: () => HTMLElement, name: string) => Promise<void>`                                                           | Holds the primary pointer button on the control a resolver returns, through the browser provider.                                                                                                                                                                               |
| `releasePointer`           | function | `() => Promise<void>`                                                                                                   | Releases a held pointer and parks it outside the page, clearing hover.                                                                                                                                                                                                          |
| `typeAccessible`           | function | `(name: string, text: string) => Promise<void>`                                                                         | Replaces a named field's value through focus, select-all, deletion, and real keystrokes.                                                                                                                                                                                        |
| `fillAccessible`           | function | `(name: string, text: string) => Promise<void>`                                                                         | Replaces a named field's value in one operation, for text too long to type key by key.                                                                                                                                                                                          |
| `traverseAccessible`       | function | `(name: string) => Promise<HTMLElement>`                                                                                | Reaches a named control only through natural forward Tab traversal from the current focus.                                                                                                                                                                                      |
| `traverseAccessibleWithin` | function | `(region: string, role: string, name: string) => Promise<HTMLElement>`                                                  | Reaches a control by role and accessible-name text inside a named region, only through natural forward Tab traversal from the current focus.                                                                                                                                    |
| `driveTraversal`           | function | `(resolve: () => HTMLElement, name: string) => Promise<HTMLElement>`                                                    | Reaches the control a resolver returns, only through natural forward Tab traversal from the current focus.                                                                                                                                                                      |
| `pressKeys`                | function | `(keys: string) => Promise<void>`                                                                                       | Sends a key sequence to whatever holds focus, and refuses to send it to nothing.                                                                                                                                                                                                |
| `readPerception`           | function | `(name: string) => string`                                                                                              | Reads the normalized visible text of one named region, dialog, table, tab panel, or alert.                                                                                                                                                                                      |
| `readPage`                 | function | `() => string`                                                                                                          | Reads the normalized visible text of the whole page.                                                                                                                                                                                                                            |
| `readFocus`                | function | `() => string \| undefined`                                                                                             | Reads the rendered text of the element that holds focus.                                                                                                                                                                                                                        |
| `readValue`                | function | `(role: string, name: string) => string`                                                                                | Reads the value a resolved control renders.                                                                                                                                                                                                                                     |
| `readRefusal`              | function | `(name: string) => string \| undefined` / `(role: string, name: string) => string \| undefined`                         | Reads the refusal one named target answers with, or nothing when it resolves.                                                                                                                                                                                                   |
| `readText`                 | function | `(element: Element) => string`                                                                                          | Reads one element's rendered text the way a name computation reads it.                                                                                                                                                                                                          |
| `readRole`                 | function | `(element: Element) => string \| undefined`                                                                             | Reads the role one element carries in the accessibility tree.                                                                                                                                                                                                                   |
| `readName`                 | function | `(element: Element) => string`                                                                                          | Reads the accessible name one element is announced under.                                                                                                                                                                                                                       |
| `readStates`               | function | `(element: Element) => readonly string[]`                                                                               | Reads the states one element is announced in.                                                                                                                                                                                                                                   |
| `describeTree`             | function | `(element: Element) => string`                                                                                          | Describes the accessible tree one rendered element presents.                                                                                                                                                                                                                    |
| `describeFocus`            | function | `(element: Element) => string`                                                                                          | Describes the order sequential keyboard navigation visits one element's controls in.                                                                                                                                                                                            |
| `waitForFrame`             | function | `() => Promise<void>`                                                                                                   | Waits for one animation frame to settle pending browser paint work.                                                                                                                                                                                                             |
| `waitForState`             | function | `(name, state, options?) => Promise<readonly string[]>` / `(role, name, state, options?) => Promise<readonly string[]>` | Waits until one named control announces a state, or stops announcing it.                                                                                                                                                                                                        |
| `waitForAnimations`        | function | `(element: Element, options?: WaitOptions) => Promise<void>`                                                            | Waits until every finite animation on one element and its subtree has stopped moving.                                                                                                                                                                                           |
| `build`                    | function | `<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions) => HTMLElementTagNameMap[K]`                 | Builds one unmounted element of a known tag, wearing the classes, text, and attributes asked for.                                                                                                                                                                               |
| `mount`                    | function | `<T extends Element>(element: T) => T`                                                                                  | Puts one element into the document and hands it straight back.                                                                                                                                                                                                                  |
| `render`                   | function | `(markup: string) => HTMLDivElement` / `(tag: K, classes: string) => HTMLElementTagNameMap[K]`                          | Renders one fixture into the document from trusted markup.                                                                                                                                                                                                                      |
| `typeInput`                | function | `(element: HTMLInputElement \| HTMLTextAreaElement, text: string) => void`                                              | Sets one field's value and announces it the way typing into the field does.                                                                                                                                                                                                     |
| `commitInput`              | function | `(element: HTMLInputElement \| HTMLTextAreaElement, text: string) => void`                                              | Sets one field's value and commits it, the way typing and then leaving the field does.                                                                                                                                                                                          |
| `clearStorage`             | function | `() => void`                                                                                                            | Clears both browser storage surfaces.                                                                                                                                                                                                                                           |
| `removeDatabase`           | function | `(name: string) => Promise<void>`                                                                                       | Deletes one IndexedDB database and reports what the request actually did.                                                                                                                                                                                                       |
| `convertSRGB`              | function | `(red: number, green: number, blue: number, alpha?: number) => Color`                                                   | Converts normalized encoded sRGB channels to the clipped paint scale.                                                                                                                                                                                                           |
| `convertLinearSRGB`        | function | `(red: number, green: number, blue: number, alpha?: number) => Color`                                                   | Converts linear sRGB channels to encoded, clipped paint channels.                                                                                                                                                                                                               |
| `convertXYZD65`            | function | `(x: number, y: number, z: number, alpha?: number) => Color`                                                            | Converts D65 XYZ coordinates to clipped sRGB paint channels.                                                                                                                                                                                                                    |
| `convertXYZD50`            | function | `(x: number, y: number, z: number, alpha?: number) => Color`                                                            | Converts D50 XYZ coordinates to clipped sRGB paint channels.                                                                                                                                                                                                                    |
| `convertOKLab`             | function | `(lightness: number, a: number, b: number, alpha?: number) => Color`                                                    | Converts OKLab coordinates to clipped sRGB paint channels.                                                                                                                                                                                                                      |
| `convertLab`               | function | `(lightness: number, a: number, b: number, alpha?: number) => Color`                                                    | Converts CIE Lab coordinates relative to D50 to clipped sRGB paint channels.                                                                                                                                                                                                    |
| `convertDisplayP3`         | function | `(red: number, green: number, blue: number, alpha?: number) => Color`                                                   | Converts encoded Display P3 channels to clipped sRGB paint channels.                                                                                                                                                                                                            |
| `convertA98RGB`            | function | `(red: number, green: number, blue: number, alpha?: number) => Color`                                                   | Converts encoded A98 RGB channels to clipped sRGB paint channels.                                                                                                                                                                                                               |
| `convertProPhotoRGB`       | function | `(red: number, green: number, blue: number, alpha?: number) => Color`                                                   | Converts encoded ProPhoto RGB channels to clipped sRGB paint channels.                                                                                                                                                                                                          |
| `convertRec2020`           | function | `(red: number, green: number, blue: number, alpha?: number) => Color`                                                   | Converts encoded Rec. 2020 channels to clipped sRGB paint channels.                                                                                                                                                                                                             |
| `parseColor`               | function | `(value: string) => Color \| undefined`                                                                                 | Parses computed CSS Color 4 values into clipped straight sRGB channels.                                                                                                                                                                                                         |
| `parseCSSColor`            | function | `(value: string) => Color \| undefined`                                                                                 | Resolves any CSS color expression to straight sRGB channels, by asking the browser.                                                                                                                                                                                             |
| `matchesColor`             | function | `(first: string \| Color, second: string \| Color) => boolean`                                                          | Determines whether two colors render the same, within the rounding a browser does.                                                                                                                                                                                              |
| `blendColor`               | function | `(front: Color, back: Color) => Color`                                                                                  | Composites one color over another.                                                                                                                                                                                                                                              |
| `measureLuminance`         | function | `(color: Color) => number`                                                                                              | Measures one opaque color's WCAG relative luminance.                                                                                                                                                                                                                            |
| `measureContrast`          | function | `(front: Color, back: Color) => number`                                                                                 | Measures the WCAG 2.x contrast ratio between two opaque colors.                                                                                                                                                                                                                 |
| `readLayers`               | function | `(element: Element) => readonly Color[]`                                                                                | Collects readable background color layers and refuses an unreadable painted layer.                                                                                                                                                                                              |
| `readBackdrop`             | function | `(element: Element, floor: Color) => Color`                                                                             | Resolves the opaque color standing behind one element.                                                                                                                                                                                                                          |
| `readContrast`             | function | `(element: Element, floor?: Color) => number`                                                                           | Measures the WCAG 2.x contrast ratio between an element's computed text and background colors.                                                                                                                                                                                  |
| `readRing`                 | function | `(control: Element, worn?: Element) => number \| undefined`                                                             | Measures the contrast the focus chrome painted on one control reaches against its own backdrop.                                                                                                                                                                                 |
| `readClipEdge`             | function | `(element: Element) => number \| undefined`                                                                             | Measures the row a clipping element cuts its content off at, in document coordinates.                                                                                                                                                                                           |
| `readClipMargin`           | function | `(element: Element) => number`                                                                                          | Measures how far past its own box a clipping element lets its content show.                                                                                                                                                                                                     |
| `clipsOverflow`            | function | `(element: Element) => boolean`                                                                                         | Reports whether an element clips its descendants' overflow.                                                                                                                                                                                                                     |
| `measureContent`           | function | `() => number`                                                                                                          | Measures the row the document's own content ends on, in document coordinates.                                                                                                                                                                                                   |
| `stagePane`                | function | `(width: number, height: number) => Promise<void>`                                                                      | Sets the tester's viewport and renders the runner's pane at the size that viewport claims.                                                                                                                                                                                      |
| `releasePane`              | function | `() => Promise<void>`                                                                                                   | Hands the tester pane back to the runner's own layout, at the viewport it had before staging.                                                                                                                                                                                   |
| `computeOffset`            | function | `(box: DOMRectReadOnly, width: number, height: number) => FrameOffset`                                                  | Computes how far an element frame moves the tester frame so the element is shot inside the runner's window.                                                                                                                                                                     |
| `stageMedia`               | function | `(options: MediaOptions) => Promise<void>`                                                                              | Stages the tester's print medium, motion preference, and forced colours through the browser provider.                                                                                                                                                                           |
| `releaseMedia`             | function | `() => Promise<void>`                                                                                                   | Restores the media readings observed before the first stage as explicit emulation. With nothing staged, clears every override and waits for a stable reading, not a proved engine baseline. Checks the budget between polls, so a frame that never paints is not bounded by it. |
| `captureFrame`             | function | `(options: FrameOptions) => Promise<string>`                                                                            | Shoots one frame at one viewport size and proves the file on disk holds this run's bytes.                                                                                                                                                                                       |
| `readFrame`                | function | `(path: string) => Promise<FrameReading>`                                                                               | Reads one written frame back and reports its size and the color its bottom row paints.                                                                                                                                                                                          |
| `readCascade`              | function | `() => ReadonlySet<string>`                                                                                             | Collects every class token the stylesheets loaded into this document actually define.                                                                                                                                                                                           |
| `readClasses`              | function | `(root: ParentNode) => ReadonlySet<string>`                                                                             | Collects every class token the markup under one root carries.                                                                                                                                                                                                                   |
| `readCensus`               | function | `(root: ParentNode) => CensusReading`                                                                                   | Takes the authored-class census of one subtree against the cascade this document loaded.                                                                                                                                                                                        |
| `readRules`                | function | `() => readonly CSSRule[]`                                                                                              | Collects every rule the stylesheets loaded into this document hold, nested grouping rules included.                                                                                                                                                                             |
| `findRule`                 | function | `(selector: string) => CSSStyleRule \| undefined`                                                                       | Finds the first style rule in the cascade whose selector carries a fragment.                                                                                                                                                                                                    |
| `findKeyframes`            | function | `(name: string) => CSSKeyframesRule \| undefined`                                                                       | Finds the animation the cascade declares under one name.                                                                                                                                                                                                                        |
| `readRows`                 | function | `(root: ParentNode, selector: string) => readonly string[]`                                                             | Reads the normalized visible text of every element a selector matches, in document order.                                                                                                                                                                                       |
| `extractOrphans`           | function | `(root: ParentNode, child: string, parent: string) => readonly string[]`                                                | Collects every element carrying a component class rendered outside the container it belongs to.                                                                                                                                                                                 |
| `extractStyles`            | function | `(root: ParentNode) => readonly string[]`                                                                               | Collects the markup of every element carrying a non-empty `style` attribute and of every `<style>` element, in document order, `root` included in both populations when it is an `Element`.                                                                                     |
| `readStyle`                | function | `(element: Element, property: string, pseudo?: string) => string`                                                       | Reads one resolved CSS property from a real browser element or a named pseudo-element.                                                                                                                                                                                          |
| `readToken`                | function | `(element: Element, name: string) => string`                                                                            | Reads one custom property from an element's resolved style.                                                                                                                                                                                                                     |
| `readRootToken`            | function | `(name: string) => string`                                                                                              | Reads one custom property from the document element.                                                                                                                                                                                                                            |
| `readPixels`               | function | `(element: Element, property: string, pseudo?: string) => number`                                                       | Reads one resolved CSS length as a number of pixels.                                                                                                                                                                                                                            |
| `expandCaptures`           | function | `(states: readonly string[], variants: readonly CaptureVariant[]) => readonly string[]`                                 | Expands a capture registry across every variant into the filenames a complete portfolio holds.                                                                                                                                                                                  |
| `buildDenial`              | function | `(operation: string, key?: string) => DOMException`                                                                     | Builds the refusal a host withholding a storage operation raises.                                                                                                                                                                                                               |
| `buildContrast`            | function | `(bar: number) => ContrastFixture`                                                                                      | Builds a detached translucent stack whose composited and flat contrast readings straddle one bar.                                                                                                                                                                               |
| `buildEscapes`             | function | `(permitted: string) => EscapeFixture`                                                                                  | Builds detached markup carrying one style escape of each kind, plus the sheet a project allows.                                                                                                                                                                                 |
| `buildCensus`              | function | `() => CensusFixture`                                                                                                   | Builds detached markup carrying one undeclared class token on HTML and another on SVG.                                                                                                                                                                                          |

#### Factories

| API                  | Kind     | Signature                                                                                                 | Summary                                                                                           |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `createPointerEvent` | function | `(name: string, options?: PointerEventInit) => PointerEvent`                                              | Creates one real pointer event, ready to dispatch.                                                |
| `createDragEvent`    | function | `(name: string, options?: DragEventInit) => DragEvent`                                                    | Creates one real drag event carrying a live data transfer, ready to dispatch.                     |
| `createPortfolio`    | function | `(options: PortfolioOptions) => PortfolioInterface`                                                       | Creates the capture portfolio one run places its screenshots through.                             |
| `createChannel`      | function | `(name: string, output: string[], forward: (...data: unknown[]) => void) => (...data: unknown[]) => void` | Creates one console channel that records every call it receives and hands that call on unchanged. |
| `createJournal`      | function | `() => JournalInterface`                                                                                  | Creates the journal one scenario records its steps and the page's own output into.                |
| `createStorage`      | function | `(options?: StorageOptions) => WebStorageInterface`                                                       | Creates an inert `Storage` a host can withhold, grant, and run out of room in.                    |
| `createHarness`      | function | `(options: HarnessOptions<TState, TEvent, TContext>) => HarnessInterface`                                 | Creates a mounted statechart harness that renders one transition table and drives it row by row.  |

`resolveAccessible` counts a match as reachable only when every condition holds: it is connected; it
passes a visibility check honouring opacity and CSS; its box has non-zero width and height; its
`tabIndex` is at least zero; it matches neither `:disabled` nor `[aria-disabled="true"]`; and it has
no `[inert]` ancestor. A wholly off-viewport match is scrolled into view once and measured again, so
a control a person can scroll to is reachable and one that stays outside is not. The bare-name form
searches `ACCESSIBLE_ROLES`; the two-argument form searches exactly the role it is given, which is
how a name a tab shares with its own panel is disambiguated.

`resolveRendered` applies the same conditions and skips the viewport requirement. It is what every
acting verb resolves through, so a click does not fail on a target the act itself scrolls into view.
It is exported because a journey that needs a target before it is on screen needs the same rule
rather than a second reading of it.

`resolveRendered` runs two passes, and only the first one can return an element. The visible pass
asks the role engine for the exact name over the elements the accessibility tree presents, so the
name it matches is the one a screen reader announces: an `aria-hidden` icon beside the text
contributes nothing to it, and a control captioned by a glyph resolves under the words a person
reads. Every element the resolver returns, refuses as unreachable, or reports as ambiguous comes
from that pass. The hidden pass runs only when the visible pass found nothing at all, and it decides
which refusal the caller hears: `No interactive element has the accessible name "X"` when the page
carries the name nowhere, `Interactive target "X" is not visible and focus-reachable` when a folded
control carries it. Seeing a folded control means including hidden elements, which puts the glyph
back into the computed name, so that pass matches `computeNamePattern` rather than the exact string.

`computeNamePattern` anchors the name at both ends and admits a run of characters that are neither
letters nor digits before it and after it. That is what a glyph is, so the pattern separates
`Add building` beside an icon from `Add`, and the exact contract holds in the hidden pass as it does
in the visible one. Its tolerance has two edges, and both cost a refusal voice rather than an
element: a hidden icon whose own content is a word defeats the pattern, and a name differing from
the requested one by punctuation alone satisfies it.

`readPerception` runs one pass, because absence and concealment share its refusal. That pass asks
over the presented elements too, so a region labelled by a heading that carries a glyph is read
under the heading's words, and a region the tree does not present is refused as not visible.

`clickAccessibleWithin` matches the region's name exactly and the control's name loosely. That
combination is what a person does with a repeated short verb such as `Add`, or with a line whose
rendered status completes its accessible name: the region supplies the context, and the name only
has to be recognisable inside it. The loose match reads a computed name that includes the hidden
subtrees, so a glyph joins the text rather than displacing it and the control is still recognisable
under the words beside it. That verb owns one refusal for a control it cannot reach, absent or
hidden, so it needs no second pass to tell the two apart. `resolveAccessibleWithin` is that
resolution on its own, and `holdAccessibleWithin` and `traverseAccessibleWithin` drive the control it
resolves the way `holdAccessible` and `traverseAccessible` drive a document-wide one, so a twin of
the same name in another region is left alone.

`traverseAccessible` charges a step only when focus actually lands on an element, ends when focus
revisits one — that is a complete cycle of the tab order — and re-resolves the target by name on
every step, because a framework may replace the node between resolution and focus arrival. Its hard
cap is three times the page's candidate count plus ten, including disabled controls and elements
with `tabindex="-1"`, so a page whose focus never settles fails instead of hanging.
`driveTraversal` is that loop over any resolver, and `driveHold` is the one pointer drive every hold
verb shares, releasing the pointer before refusing when the frame wait or the pressed-state read
fails, as well as when the press misses; each verb supplies its resolver and the name its refusals
voice.

`build` and `mount` are the halves of a fixture, and `render` is the pair spelled as one call.
`build` creates the element and applies its class list, its text, and its attributes, and leaves it
out of the document, so nothing resolves against the cascade and no box is laid out until the
element is attached. Its text is set as text rather than parsed as markup, so a `<` in it stays a
`<`. `mount` attaches an element and hands that same element back, which is what makes a computed
style, an inherited custom property, and a real box available. `render` takes trusted fixture markup
and returns the attached container holding it, or takes a tag and its class list and returns the
attached element itself, typed as exactly that tag. The class list is required in the tag form,
which is what keeps the forms apart: a one-argument call is always markup.

None of them records anything. A browser test file shares one page, so a fixture left behind is the
next test's resolver ambiguity, and removal belongs to the consumer's teardown: build the container
in a setup module, register its removal on a `createTeardown` list or in an `afterEach` hook, and
mount every fixture inside it.

`typeInput` and `commitInput` write into a field the test already holds. `typeInput` sets the value
in one write and dispatches one bubbling `input` event, with the value already set by the time a
listener reads it. `commitInput` does that and then dispatches one bubbling `change`, which is the
order a browser produces when a person types and then leaves the field. Each dispatched event is a
plain `Event`, never an `InputEvent`, so a component reading `inputType` or testing
`instanceof InputEvent` reads neither off them. Neither sends a keystroke either, so a component
reading `key`, composition, or selection receives nothing from them — drive that one through
`typeAccessible` instead.

`removeDatabase` deletes one IndexedDB database and reports what the request did. Deleting a
database that was never created succeeds, so an `afterEach` hook calls it whether or not the test
reached the code that opens one. A block is a rejection rather than a wait: `blocked` fires while
another connection is still open, and a suite that swallowed it would leave the next test reading
the previous test's records through a database that reports itself deleted. The connection holding
it open is the caller's to close, and [Voices](#voices) carries the message each refusal spells.

The paint parser reads computed `rgb()`, `rgba()`, `oklab()`, `oklch()`, `lab()`,
`lch()`, and `color()` values. Its predefined spaces are `srgb`, `srgb-linear`,
`display-p3`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz`, `xyz-d50`, and
`xyz-d65`. Signed channels, percentage lightness, degree hues, scientific notation, and
`none` components resolve to straight sRGB. The exported conversion helpers apply the
[CSS Color 4 matrices and white-point adaptation](https://www.w3.org/TR/css-color-4/#color-conversion-code).
The Rec. 2020 decoder follows Chromium's piecewise transfer curve. Encoded sRGB channels are
clipped to 0–255 after conversion; this reader does not perform perceptual gamut mapping.
Alpha is clipped to 0–1.

`parseCSSColor` is the live half of the pair `parseColor` opens. `parseColor` reads text and speaks
only the computed syntaxes a cascade hands back; `parseCSSColor` stages a probe element, hands the
expression to the real cascade, and reads back what the engine computed — which is the only way a
keyword, a hex triple, a `var()` reference, or a `color-mix()` becomes channels at all. The probe is
mounted, so a `var()` reference resolves against the tokens `:root` declares, and it is removed in a
`finally`. Refusal is the CSSOM's: an expression it will not parse returns `undefined`. A `var()`
naming an undeclared custom property is not refused, and [Limits](#limits) states what that costs.

`matchesColor` compares two colors as a browser renders them. Each string side resolves through
`parseCSSColor`, so a keyword, a token reference, and the `rgb()` an engine computes for either
compare equal without a test converting anything first. The tolerance is half a channel step on the
0–255 scale, and the alpha is scaled onto that same range before it is compared, so one number
covers every channel. A side that resolves to nothing makes the answer `false` rather than a throw,
because this is a predicate.

`readContrast` resolves a transparent or translucent background through the element's ancestors:
every painted layer from the element up to the first opaque one composites top-over-bottom onto that
opaque base, so a 3% surface tint reads as a tint over what shows through it rather than as a
full-strength paint. A translucent foreground then resolves against that effective background before
luminance is measured. With `floor` omitted it refuses every stack whose walk reaches no fully
opaque layer, rather than assuming a white canvas. Supply a floor — `CANVAS_COLOR` for a document,
or the color a fragment is really mounted onto — and the same stack composites onto it instead of
being refused. A detached element is refused either way, because its computed foreground color does
not exist.

`readLayers` is the reading that refusal turns on. It hands back the painted layers themselves,
element first and the deepest last, so a walk that ended on a real surface is the one whose last
layer has an alpha of `1`. A composited color cannot answer that question: 64 half-transparent
layers blend to identical channels over black and over white alike, because the floor's remaining
share falls below the last bit a channel carries, so comparing two composited readings admits the
stack the refusal exists for.

An unreadable painted background layer throws an error naming its element and computed value.
Non-finite calculations such as `color(srgb calc(infinity) 0 0)` are deliberately unreadable.
A layer with an explicit zero alpha paints nothing and is skipped, including an unreadable one.
Background images remain outside this color reader. The refusal propagates through `readBackdrop`,
`readContrast`, and the focused-control reading in `readRing`, even with a supplied floor.

`readBackdrop` composites that stack and takes its floor as an argument rather than reaching for
`CANVAS_COLOR` itself, so a measurement over a surface the canvas never shows through names the
color it actually sits on. When no layer paints it hands that floor straight back.

`readRing` reads and never acts. Focus arrives through the published verbs, and this measures what
the browser painted once it landed: the `outline` the cascade declares, and the first color in a
`box-shadow`. A control that is not matching `:focus-visible`, a control left the browser's own
`outline-style: auto` ring, and a focus style that only changes the control's own fill all report
`undefined` — in each case no measurement taken here would be about focus. `worn` names the element
the chrome is painted onto when that is not the element holding focus, which is the hidden-input
control whose visible label wears every pixel of its chrome. Modern colors, including an
`oklch()` box-shadow, return the ring’s contrast ratio against its backdrop.

`readRules` is the one walk over the shipped cascade, and `readCascade`, `findRule`, and
`findKeyframes` all read through it. It collects each sheet's own rules in sheet order and then
expands the grouping rules level by level, so a media query, a supports block, a layer, and a nested
style rule all surface, and a top-level rule is always met before a rule nested inside an earlier
one. The descent reaches a grouping rule and nothing else, and a `@keyframes` rule is not one: the
`@keyframes` rule itself is collected wherever it sits and the keyframe rules inside it are not, so
`findKeyframes` is the door to those. A stylesheet the document cannot read — a cross-origin sheet
with no CORS grant — throws from its own `cssRules` getter, and that sheet is skipped rather than
ending the walk.

`readCascade` reports the tokens of that same walk, and both its membership and its order are
deliberate differences from 0.0.8. A class declared inside a grouping rule counts as defined,
because a class the cascade defines under a condition is still one the cascade defines; 0.0.8 read
the top-level rules alone. Insertion order is breadth-first, so a top-level class lands before a
class declared inside an earlier grouping rule; 0.0.8 popped a stack and inserted the deepest rule
first. Iterate the set where the order is the subject and read `has` where membership is. A
`@keyframes` rule's own children are outside the walk, so an animation's stops define no token here.

`findRule` and `findKeyframes` differ in how they match, and the subject is what decides it. A
selector is compound, so `findRule` matches its argument as a substring of the whole selector text:
`findRule('.card')` finds `.card`, `.card:hover`, and `.panel > .card` alike, and more of the
selector narrows it. An animation name is one atom, so `findKeyframes` matches it exactly. Each
answers what a stylesheet declares rather than what an element resolves to, and a rule either one
finds may be overridden by another — assert on `readStyle` where the rendered result is the subject.

`readToken`, `readRootToken`, and `readPixels` are `readStyle` with the question narrowed.
`readToken` reads a custom property and accepts the name with or without its leading dashes, because
a token is spoken about both ways — `--surface` in a stylesheet and `surface` in prose. An absent
token reads as `''`, which is what the CSSOM returns and is indistinguishable from a token declared
empty, so assert on the value you expect rather than on presence. Resolution is inheritance: a token
declared on `:root` reads from any mounted descendant, and from an unmounted element it reads as
`''`. `readRootToken` is that reading taken against `document.documentElement`, which is where a
theme declares its tokens and where a `[data-theme]` switch retunes them. `readPixels` reads the
leading number of a resolved length and answers `0` for a value carrying none, because `'auto'`,
`'none'`, and `''` each contribute no pixels to what a reader sees; read the text with `readStyle`
where that distinction matters.

`stagePane` unscales the runner's tester and lifts it to the window's origin, because a frame shot
through the runner's fitting scale is a thumbnail of the surface. That couples it to Vitest's own
tester layout, which is contract rather than accident: `vitest@4.1.11` is the version behind the
`iframe[data-vitest]` selector and the `--tester-transform`, `--tester-margin-left`,
`--viewport-width`, and `--viewport-height` custom properties it writes. A release that renames any
of them reddens the size check rather than writing a wrong frame. Always hand the pane back with
`releasePane`: a tester left pinned at a viewport taller than the window puts its lower half beyond
what a pointer can reach, so the next ordinary press fails as a control that is covered. The release
also resizes the tester to the viewport it had before the staging, which it reads off the rule
element it removes, so the capture's variant size belongs to the frame rather than to every test
that runs after it.

That hand-back is why the pair is a capture's staging and not a resize. Call `page.viewport` from
`vitest/browser` where a journey needs its own size — a breakpoint to drive, a variant to act at —
and leave the tester there. A suite that stages and releases instead resizes the tester and then
undoes the resize, so its next step runs at the size the file started at. This package publishes no
verb for that, because `page.viewport` already is one.

`captureFrame` stages, shoots, and proves the file. The path a screenshot call returns is the path
it meant to write, so `captureFrame` reads that file back through the runner's built-in `readFile`
command and compares it with the shot itself, which is what separates this run's frame from one an
earlier run left behind. It releases the pane in a `finally`, so a refusal at any stage hands the
tester back before it propagates.

A page frame covers the whole document at the width it was given, whatever height it was given. The
provider shoots the tester's body in the top-level page's own coordinates, so a document taller than
the pane paints for the pane's height and the rows under it are the runner's page: the frame reads
as the surface down to the fold and as bare canvas after it. `captureFrame` therefore lays the
document out at the declared viewport, measures the height the shot needs, and stages the pane again
at that height for the shot alone.

The measurement is `measureContent`, floored at the declared height because the declared viewport is
the smallest frame a variant asks for. Read the content's edge rather than the body's box: the box
is the larger of the content and the pane, so every pane staged over the document stretches it and
reads back as the document's own height. A capture that staged a pane taller than the document could
not descend from a reading like that — the box, `body.scrollHeight`, `body.offsetHeight`, and
`documentElement.scrollHeight` each answer with the pane. `measureContent` walks the elements inside
the body instead, taking the largest bottom edge in document coordinates plus that element's own
bottom margin, and adds the body's and the root's bottom padding and margin under them. An
ancestor that clips its overflow (the `clipsOverflow` helper: an `overflow-y` value other than the
`visible` keyword, or a paint containment) caps a descendant's edge at that ancestor's clip edge,
which the `readClipEdge` helper reads. An `overflow-y` value of the `hidden` keyword, the `auto`
keyword, or the `scroll` keyword clips at the padding box, whatever the ancestor's
`overflow-clip-margin` value selects. The `clip` keyword and a paint containment over a `visible`
overflow clip at the box that value selects, the padding box by default, expanded by the length the
`readClipMargin` helper reads. So a viewport-height specimen
inside a bounded frame ends, for the reading, where the frame ends rather than stretching the
document with every pane. It rounds up, which is what covers a body ending part way through a row: a
box ending on a fraction under a half is a row the integer scroll height drops, and that row comes
out as the runner's page.

The edge is read again after every staging, because a rule bound to the viewport height — a `vh`
length, a fixed footer, a full-height panel — lays the document out taller against the taller pane,
so a surface built out of those photographs as its scrolled-open self rather than as one screen, and
the reading taken before that staging is stale by exactly what the reflow added. Restaging at the
edge alone converges on such a document without arriving: a rule that keeps half the pane reads
1322, 1561, 1681, and 1741 against a fixed point of 1800, halving what is left each time. Each
staging
therefore carries the growth the one before it produced, staging at the edge plus that growth, which
lands on the fixed point instead of creeping toward it: 1322, then 1800. The first staging carries
no growth, because nothing has grown yet, so a document of fixed content is staged at its own edge
and shot there — a 1600-row document reads back as a 1600-row frame rather than as one an overshoot
stretched.

The re-reading stops when the pane and the edge agree, which is the pane the shot is taken at. A
rule that adds height with every pane never reaches that point, so the re-reading is bounded by
`CAPTURE_STAGINGS` and the shot is refused with
`Capture frame at <path> never settled after <n> restagings: <h> over a <h> pane` rather than
written at a height that is already wrong. That bound is 4: a document holding half the pane plus a
fixed block settles in two restagings, one whose growth is capped part way settles in three, and
the fourth is headroom.

An element frame no taller than the declared height is shot in the declared pane, so its viewport
lengths resolve against the declared viewport whether the element sits above the fold, below it, or
fixed: a `50vh` element under a 900-row block reads back 422 rows in an 844-row pane. The re-reading
takes the element's own height, so the pane grows only for an element taller than the declared
height, and then to that element's height, which is what its viewport lengths resolve against.
Where the element's box lies outside the pane, the document is scrolled by the nearest distance that
would bring it inside, and the box is read again. A fixed element past the pane can take a scroll
that does not move it, and that scroll is handed back with the rest. The document is not scrolled for
an element already inside the pane.

The provider paints an element that fits the runner's window only where that window shows it. Where
such an element lies past the window, the `captureFrame` function offsets the calling tester frame up
or left only as far as brings the element inside, and composites the frame so a fixed element that
starts past the window's height is not culled. The `computeOffset` function computes that move. The
offset is written on that frame's own `style` attribute, outranks the placement the `stagePane`
function makes, and is removed as soon as the screenshot settles. An element inside the window, or
too large for it, is not offset.

The capture sends no pointer input. The staging lifts the tester to the window's origin, a scroll
brings an element outside the pane into it, and an offset brings an element past the window inside;
each moves content under a pointer resting on the page. A pointer the case placed on the element,
with the pane already staged at the frame's size, keeps its hover in the frame where the element lies
inside both the pane and the runner window, because the capture then moves nothing. No hover is
promised after the pane is released.

`readFrame` reads a written frame back: its size in device pixels, and the single color its bottom
row paints. The reading comes off the file through the browser's own image decoding rather than off
the document that produced it, which is what makes it evidence about the capture rather than a
second look at the style that fed it — a clipped frame reports the runner's white canvas as its
floor while every style in the document still resolves to the document's own background. Pass the
absolute path `captureFrame` returned: the runner's `readFile` command resolves a relative path
against its own root rather than against the calling test file. A file that opens with a PNG header
and still does not decode is refused with the width and height that header declares, in device
pixels; a file with no PNG header is refused without a size.

`createPortfolio` refuses an unregistered variant name at creation, so a run cannot write a filename
naming a combination it did not render. A portfolio left un-`enabled` is the ordinary run: `place`
resizes nothing, writes nothing, and records nothing, so a journey calls it unconditionally. An
enabled `place` applies the variant and writes `<directory>/<state>--<variant>.png` through
`captureFrame`, so it stages the pane at the variant's size, covers the whole document, verifies the
written bytes, and records only a path that read back as this run's own frame. The tester comes back
at the viewport it had before the placement, so a journey that places a state carries on at its own
size rather than at the variant's. `placements` and `paths` hand out snapshots, so a list read
before a placement stays what it was.

`createJournal` records rather than replaces. Every intercepted console call is forwarded to the
channel that was there when the journal started, so a run under a journal prints exactly what it
prints without one, and `stop` puts those same function references back by identity. `start` clears
both lists whether or not the journal was already recording, so a restart never stacks one wrapper
on another. Uncaught errors and unhandled rejections are recorded too, through listeners the journal
drops when it stops. There is no shared instance: a file that needs one journal per scenario creates
one per scenario.

The filename law is injective within one run: one variant is selected, and every filename is
`<state>--<variant>.png`. A duplicate filename therefore implies a duplicate placement, which
`place` already refuses. Any future naming change that breaks this injectivity must reintroduce a
collision refusal before writing.

### Server

Imported from `@orkestrel/test/server`.

#### Types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional
member and `plus` introducing its call-signature members, and a type alias's own type literal with
a union's arms escaped as `\|`. An extended interface's name comes before `plus`, with the members
it adds after.

| Type                 | Kind      | Shape                                                                                         | Summary                                                                                         |
| -------------------- | --------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ScratchInterface`   | interface | `{ path }` plus `write` / `read` / `has` / `names` / `ensure` / `link` / `remove` / `destroy` | Holds a temporary directory a test owns, writes into, reads back, and removes when it is done.  |
| `ScratchIdentity`    | interface | `{ device, inode, birth }`                                                                    | Represents the fields that together identify one allocated directory on its host.               |
| `ScratchOptions`     | interface | `{ parent?, prefix?, files? }`                                                                | Configures a scratch directory allocation.                                                      |
| `LoopbackInterface`  | interface | `{ url, port }` plus `destroy`                                                                | Holds a server a test owns, listening on an ephemeral loopback port until the test releases it. |
| `CookieJarInterface` | interface | `{ header }` plus `read` / `capture`                                                          | Holds a name-keyed cookie store a test drives one origin with, filled from real responses.      |
| `InventoryOptions`   | interface | `{ extensions?, exclude? }`                                                                   | Configures a source inventory read.                                                             |
| `UpgradeOptions`     | interface | `WaitOptions` plus `{ path?, protocols? }`                                                    | Configures a client upgrade request.                                                            |
| `UpgradeResult`      | type      | `{ claimed, protocol } \| { claimed, status }`                                                | Represents what one server did with a client upgrade request.                                   |

#### Constants

A `Shape` cell holds the constant's declared type.

| API                           | Kind  | Shape               | Summary                                                                            |
| ----------------------------- | ----- | ------------------- | ---------------------------------------------------------------------------------- |
| `REMOVE_TREE_MAX_ATTEMPTS`    | const | `number`            | Caps the attempts `removeTree` makes before rethrowing a retryable removal error.  |
| `REMOVE_TREE_RETRY_DELAY_MS`  | const | `number`            | Names the synchronous delay, in milliseconds, `removeTree` waits between attempts. |
| `REMOVE_TREE_RETRYABLE_CODES` | const | `readonly string[]` | Names the error codes `removeTree` retries; every other code rethrows immediately. |

#### Helpers

| API                      | Kind     | Signature                                                                                                           | Summary                                                                                          |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `readInventory`          | function | `(root: URL \| string, targets: readonly string[], options?: InventoryOptions) => Readonly<Record<string, string>>` | Reads files from selected targets below a root directory.                                        |
| `resolveContained`       | function | `(root: string, target: string) => string \| undefined`                                                             | Resolves a target that stays below a root directory.                                             |
| `requireContained`       | function | `(root: string, target: string) => string`                                                                          | Resolves a target that stays below a root directory, refusing an escape.                         |
| `isExcluded`             | function | `(key: string, exclusions: readonly string[]) => boolean`                                                           | Reports whether a root-relative key matches an exclusion.                                        |
| `readIdentity`           | function | `(status: Stats) => ScratchIdentity`                                                                                | Reads the identity of one allocated directory off a host status.                                 |
| `matchesIdentity`        | function | `(current: ScratchIdentity, allocation: ScratchIdentity) => boolean`                                                | Reports whether two directory identities name the same allocation.                               |
| `readErrorCode`          | function | `(error: unknown) => string \| undefined`                                                                           | Reads the `code` an unknown thrown value carries.                                                |
| `createLink`             | function | `(path: string, source: string) => void`                                                                            | Creates a symbolic link with a directory-junction fallback for hosts that refuse symbolic links. |
| `removeTree`             | function | `(path: string) => void`                                                                                            | Removes a directory tree, retrying past a transient Windows handle-release race.                 |
| `isRunning`              | function | `(pid: number) => boolean`                                                                                          | Reports whether a process id names a live process.                                               |
| `waitForSocketClose`     | function | `(socket: Socket, options?: WaitOptions) => Promise<void>`                                                          | Waits for a socket to close, accepting a peer reset as a forced close.                           |
| `destroyScratch`         | function | `(scratch: ScratchInterface, options?: WaitOptions) => Promise<void>`                                               | Destroys a scratch directory, retrying until the host releases it.                               |
| `requestUpgrade`         | function | `(port: number, options?: UpgradeOptions) => Promise<UpgradeResult>`                                                | Drives a real client upgrade request against a loopback port and reports what the server did.    |
| `supportsDirectoryLinks` | function | `() => boolean`                                                                                                     | Checks whether this host links a directory, by creating one link and reading through it.         |
| `supportsFileLinks`      | function | `() => boolean`                                                                                                     | Checks whether this host links a file, by creating one link and reading the file through it.     |
| `supportsMode`           | function | `() => boolean`                                                                                                     | Checks whether POSIX permission bits round-trip through this host's `chmod` and `stat`.          |
| `supportsCase`           | function | `() => boolean`                                                                                                     | Checks whether this host treats two names differing only by case as distinct files.              |
| `supportsBytes`          | function | `() => boolean`                                                                                                     | Checks whether this host accepts a filename carrying a raw byte no UTF-8 decoder resolves.       |

`resolveContained` is the one lexical containment check, and `readInventory` and `createScratch`
both call it. It resolves the target against the root — relative or absolute — and returns
`undefined` when the result is not below it. An absolute target inside the root resolves, so a
caller hands it the path it already has rather than making it root-relative first. It is exported
because a consumer writing its own filesystem fixture needs the same check and would otherwise write
another copy of it.

`@orkestrel/scaffold` publishes `resolveContainedPath`, one word away, and the two are not the same
predicate. This one is lexical only and dependency-free. That one is lexical plus physical — it also
refuses a link that leaves the root and a dangling link whose raw target contains a `..` segment —
and it lives in a build tool. A test helper with zero runtime dependencies does not take a runtime
dependency on the scaffolding tool to obtain a path predicate. If that difference ever stops holding,
delete `resolveContained` and import `resolveContainedPath` from `@orkestrel/scaffold`, which this
package already carries as a `devDependency`, rather than adding a third variant.

`requireContained` is that same resolution with the refusal every contained scratch operation makes
of an escape: it throws `Path outside scratch directory: <target>` where `resolveContained` answers
`undefined`. Every `ScratchInterface` member and the `files` seeding pass through it, so the check
and its one message are stated once rather than at each member. Read `resolveContained` where an
escape is an answer the caller handles rather than a refusal it wants raised.

`isExcluded` is the exclusion rule itself, and `readInventory` applies it to a named target and a
walked entry alike. An exclusion matches whole segments of a root-relative key, so it drops the key
it names and every key below it, and it leaves a sibling whose name merely starts the same way. It
takes exclusions already normalized: `readInventory` normalizes the spellings its `exclude` option
accepts before calling it, so a caller applying the rule to its own keys normalizes its own list. It
is exported because a consumer walking its own tree wants that rule rather than a second reading of
what `exclude` means.

`matchesIdentity` is the comparison `destroy()` makes before it removes anything: whether the
identity read from the allocated path now is the identity recorded when the directory was allocated.
All three fields are compared because none of them alone identifies an allocation. A device is
shared by every directory on one filesystem, an index node is reused once its directory is removed,
and a creation time repeats within the host's timestamp resolution. It is exported so a fixture that
manages its own directory can make the same check rather than trusting a path. `readIdentity` reads
that triple off a `node:fs` `Stats`, and it is the one reading `createScratch` takes at allocation,
before a `remove`, and before a `destroy`, so the three sites cannot drift on which fields name an
allocation.

`readErrorCode` reads the `code` off an unknown thrown value, which is what a host refusal is at a
`catch`. It answers `undefined` for a value that is not an object, one carrying no `code`, and one
carrying a `code` that is not a string, so a caller compares against the code it cares about rather
than narrowing an unknown first. `createLink` and `removeTree` both classify their refusals through
it, and it is exported because a fixture catching its own host refusal wants the same contained read.

`waitForSocketClose` and `destroyScratch` are the bounded waits on this entry, and both take the
core entry's `WaitOptions`. Import that type from `@orkestrel/test` beside the helpers themselves
from `@orkestrel/test/server`: the shape has one home, and this entry names it in a signature rather
than re-exporting it.

`createLink` is the link mechanism `ScratchInterface.link` calls, and
[Hosts that create no symbolic link](#hosts-that-create-no-symbolic-link) states what it does. Its
`path` parameter is where the link is created and its `source` parameter is the destination that
link points at, which is `link`'s vocabulary rather than `node:fs`'s. It is exported because a
fixture creating its own links wants the same host handling rather than a second reading of it.

`requestUpgrade` drives one real client upgrade request against a loopback port and reports what the
server did. The request carries `Connection: Upgrade` and `Upgrade: websocket`, which is what routes
it to a server's `upgrade` handler, and the offered subprotocols travel as one comma-separated
`Sec-WebSocket-Protocol` field. `claimed` is the discriminant, and each arm carries only what its own
path produced. The claimed arm carries `protocol`, the field the server sent, so `undefined` there
says the server selected none rather than that it refused; it carries no status, because a claimed
upgrade produced no plain answer and the `101` on the wire is deliberately not reported as one. The
refused arm carries `status`, the plain answer's status, and no subprotocol. Reading `status` off an
unnarrowed result is a compile error rather than an `undefined`, so a test names the arm it expects
before it reads the detail.

The wait is bounded, because a server that accepts the connection and answers nothing raises no
transport error. `UpgradeOptions` extends `WaitOptions`, the budget defaults to `1000` milliseconds,
and the rejection names the port and path the call was waiting on. The interval is validated for
consistency with the wait family and is not used, because this helper parks on the request's events
rather than reading for an answer. A bound that is not finite and non-negative is refused before the
request is made, and an already-aborted signal is refused there too. The promise settles once, on
whichever of `upgrade`, `response`, `error`, the budget, and the abort arrives first, and a transport
error — the `ECONNREFUSED` a closed port answers — is the rejection.

The client socket is destroyed on every settlement path, the budget's and the abort's included, and
the request is made with no agent, so no pooled connection outlives the call to keep a suite's event
loop alive. The socket the server keeps is the fixture's own: [Limits](#limits) states why
`createLoopback` cannot take it back.

The capability probes read this host rather than branching on `process.platform`.
`supportsDirectoryLinks`, `supportsFileLinks`, `supportsMode`, `supportsCase`, and `supportsBytes`
each allocate a directory under the host temporary directory, attempt the operation, read the result
back, and remove the allocation in a `finally`. Each reads a host refusal as `false` rather than
throwing, so the answer is a fact about this run rather than an error to handle, and each probes
afresh on every call rather than remembering an answer a host can change. Gate a proof on the probe
that names the mechanism it needs: an unprivileged Windows host answers `supportsDirectoryLinks`
`true` through a junction while answering `supportsFileLinks` `false`, so a fixture that reads a
file through a link asks the second question rather than the first. `supportsMode` answers whether a
permission bit is stored, which is narrower than whether it is enforced — a POSIX host running as
uid `0` stores every bit faithfully and bypasses the access check those bits describe, so a proof
that needs a refusal probes that refusal itself.

#### Factories

| API               | Kind     | Signature                                        | Summary                                                                                     |
| ----------------- | -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `createScratch`   | function | `(options?: ScratchOptions) => ScratchInterface` | Allocates an owned temporary directory with contained file operations.                      |
| `createLoopback`  | function | `(server: Server) => Promise<LoopbackInterface>` | Starts a server on an ephemeral IPv4 loopback port.                                         |
| `createCookieJar` | function | `() => CookieJarInterface`                       | Creates a cookie jar that records a real response's cookies and replays them as one header. |

A refused `ScratchOptions` key leaves nothing behind, by two different mechanisms. `parent` and
`prefix` are checked before `mkdtempSync` runs, so a refused value allocates nothing. `files` is
seeded after the directory exists, so a refused key removes the directory that was recently made and
rethrows.

`parent` is the existing directory the allocation is created in, and defaults to the host temporary
directory; allocation throws when it is missing, is a symbolic link, or is not a directory. `prefix`
starts the generated directory name, and defaults to `orkestrel-test-`; allocation throws when it
contains `/` or `\`, which is what stops a prefix steering the allocation out of its parent. Nothing
else is refused: a fragment carrying no separator is one path segment, so `release-0..2-` allocates.
`files` seeds files on allocation, keyed by path below the scratch directory; allocation removes the
directory it recently made and rethrows when a key escapes or the host refuses a write.

`createLoopback` takes a `node:net` `Server` — `node:http`'s and `node:https`'s both extend it — and
never constructs one. It listens on port `0` at `127.0.0.1`, waits for the `listening` event, and
reads the assigned port off `address()`, throwing
`Loopback address must have a numeric port; found <address>` when that address carries none. The
`createLoopback` contract states what `destroy()` drops, what `url` does and does not spell, and why
this package never reserves a port number.

## Methods

The call-signature members of each behavioral interface. Their `readonly` data members stay in the
earlier [Surface](#surface) rows.

#### `RecorderInterface`

| Method  | Returns | Summary                                                    |
| ------- | ------- | ---------------------------------------------------------- |
| `clear` | `void`  | Discards the recorded calls and keeps the recorder usable. |

#### `EventSourceInterface`

| Method | Returns | Summary                           |
| ------ | ------- | --------------------------------- |
| `on`   | `void`  | Subscribes a handler to an event. |

#### `ResourceFactoryInterface`

| Method    | Returns  | Summary                       |
| --------- | -------- | ----------------------------- |
| `create`  | `number` | Creates a numbered resource.  |
| `destroy` | `void`   | Destroys a numbered resource. |

#### `TeardownInterface`

| Method    | Returns         | Summary                                                                                                   |
| --------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| `add`     | `void`          | Registers a handler to run when the list is destroyed.                                                    |
| `destroy` | `Promise<void>` | Runs every registered handler in reverse registration order, awaiting each in turn, and empties the list. |

#### `StateScenario`

| Method    | Returns                 | Summary                                                     |
| --------- | ----------------------- | ----------------------------------------------------------- |
| `arrange` | `Promise<void> \| void` | Puts the entity into the transition's `from` state.         |
| `act`     | `Promise<void> \| void` | Applies the transition's event to the arranged entity.      |
| `assert`  | `Promise<void> \| void` | Checks that the entity reached the transition's `to` state. |

#### `LoopbackInterface`

| Method    | Returns         | Summary                                                                                                             |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `destroy` | `Promise<void>` | Drops every live connection on a server that carries `closeAllConnections`, stops listening, and releases the port. |

#### `CookieJarInterface`

| Method    | Returns               | Summary                                              |
| --------- | --------------------- | ---------------------------------------------------- |
| `read`    | `string \| undefined` | Reads one stored cookie value.                       |
| `capture` | `readonly string[]`   | Applies every `Set-Cookie` field a response carries. |

#### `PortfolioInterface`

| Method  | Returns                        | Summary                                                                                                |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `place` | `Promise<string \| undefined>` | Places one registered state: applies the variant, stages the pane, and writes the verified screenshot. |

#### `JournalInterface`

| Method   | Returns | Summary                                                                       |
| -------- | ------- | ----------------------------------------------------------------------------- |
| `start`  | `void`  | Starts a fresh recording, dropping whatever the previous scenario left.       |
| `stop`   | `void`  | Stops recording and hands every intercepted console channel back by identity. |
| `record` | `void`  | Records one step, when the journal is started.                                |

#### `WebStorageInterface`

| Method   | Returns | Summary                                                                      |
| -------- | ------- | ---------------------------------------------------------------------------- |
| `permit` | `void`  | Grants the reads and the writes the host withheld, and replenishes no quota. |

The rest of the surface is the platform's: `length`, `key`, `getItem`, `setItem`, `removeItem`, and
`clear` are declared by the host `Storage` interface this one extends. A store created here answers
through those methods and intercepts no named-property access, so drive a consumer under test
through `getItem` and `setItem`;
[Bounds a shipped helper carries](#bounds-a-shipped-helper-carries) states what the property form
reads instead.

#### `HarnessInterface`

| Method    | Returns         | Summary                                                                  |
| --------- | --------------- | ------------------------------------------------------------------------ |
| `execute` | `Promise<void>` | Drives every row in table order, from a fresh tally and a cleared state. |
| `destroy` | `void`          | Removes the mounted root, and does nothing when it is already removed.   |

`execute` drives the table the harness was constructed with, so a second call re-runs the same rows.
It clears every rendered `result`, the rendered `state`, and the tally before the first row starts,
and that reset is readable while the run is in flight: a harness mid-re-run reports nothing passed,
nothing failed, and no state rather than what the run before it left. Every exit writes a terminal
status, because the gate polling the markup has no rejection channel to read: a run that completes
writes `passed` or `failed`, and a run a `state` reader ends writes `failed` and then rejects with
that reader's value by identity, without counting the row as failed. `destroy` takes the root out of
the document and leaves the element itself intact, so the tally a finished run published is still
readable from the object afterwards.

#### `ScratchInterface`

| Method    | Returns               | Summary                                                                               |
| --------- | --------------------- | ------------------------------------------------------------------------------------- |
| `write`   | `string`              | Writes a file, creating each parent directory that does not exist.                    |
| `read`    | `string \| undefined` | Reads a file.                                                                         |
| `has`     | `boolean`             | Reports whether a path exists without following its final symbolic link.              |
| `names`   | `readonly string[]`   | Lists the names directly inside a directory in sorted order.                          |
| `ensure`  | `string`              | Creates a directory and every missing parent.                                         |
| `link`    | `string`              | Creates a symbolic link at a contained path, creating its missing parent directories. |
| `remove`  | `void`                | Removes a file, an empty directory, or a directory and its descendants.               |
| `destroy` | `void`                | Removes the allocated directory and everything in it when its identity still matches. |

An empty target names the allocation root. `ensure('')` returns the root path, `has('')` reports
`true`, and `names('')` lists the root. `write('', …)` surfaces the host's `EISDIR` and `link('', …)`
its `EEXIST`, because the root is a directory that already exists. The host code is the accurate
answer there, so this package adds no refusal of its own.

`remove` is the exception, and it refuses: `remove('')`, `remove('.')`, and `remove` of the absolute
root all throw `Scratch directory is not a removable target: <target>`. Every other member reads the
root as harmless or as a question about the allocation, and only `remove` would read it as an
instruction to delete one — which is what an empty computed path produces. Ending the allocation is
`destroy()`'s job. What the refusal buys is that the degenerate argument is loud: the empty computed
path is this member's most destructive input, and it throws rather than acting. It buys no more than
that. A directory that has replaced the allocation at the same path is not protected by it —
`remove('x')` still removes `<replacement>/x`, exactly as `write`, `ensure`, and `link` still act
inside one.

### Traversal

Every member that takes a target resolves that target's **intermediate** segments through a symbolic
link inside the allocation and acts at the destination. `write`, `read`, `has`, `names`, `ensure`,
`link`, and `remove` all do this, so a lexically contained path can read, list, create, write, and
remove outside the allocation. That is the contract rather than a hole in it: containment here is
lexical, `link` is the member that creates such a link, and the [threat model](#threat-model) names
who else creates one.

`remove` carries the one physical exception, and it is narrow. It reads the final entry it reaches
with `lstat` and refuses when that entry carries the allocation's identity, so a target that arrives
back at the allocation through an intermediate link throws instead of emptying it. A sibling reached
through that same link is still removed. The exception stops at the allocation itself and is
deliberately not narrowed further, because narrowing it further would be the per-segment walk this
package declines to do.

The **final** segment is where `has`, `link`, and `remove` differ from the rest. `has` reads it with
`lstat` rather than following it, so `has('gate')` reports the link itself and stays `true` after
whatever `gate` pointed at is removed. `link` acts at the final segment rather than through it, so a
second `link('gate', …)` surfaces the host's `EEXIST` instead of creating a link inside the
destination. `remove` acts there too, so `remove('gate')` unlinks `gate` and leaves the directory it
pointed at standing; following the link would instead remove a whole tree outside the allocation
through one contained path. `write`, `read`, `names`, and `ensure` act at what a final-segment link
points at, so `ensure` against a dangling final link throws the host's `ENOENT` and creates nothing
at the destination.

`ensure` returns the lexical path it was given rather than the destination, so `ensure('gate/made')`
returns `<allocation>/gate/made` while the directory is made wherever `gate` points, and
`ensure('gate')` returns `<allocation>/gate` and leaves the directory it points at alone.

### Hosts that create no symbolic link

`link` and `createLink` attempt an untyped `symlinkSync` first, and that is the whole mechanism on a
host that grants it. Windows grants the symbolic-link privilege only under Developer Mode or to an
administrator, and refuses the call with `EPERM` otherwise. Only `EPERM` falls back: every other code
rethrows untouched, so an occupied path still surfaces the host's own `EEXIST`. The fallback creates
a directory junction, which needs no privilege and points only at a directory. Everything that
junction changes is in this section.

The source resolves against the link's own directory rather than against the process working
directory, so `link('nested/gate', 'source')` points at `<allocation>/nested/source` — where a
symbolic link made from the same relative source lands.

A source that exists and is not a directory is refused: the original `EPERM` is rethrown and nothing
is left at the link path. A file source is the case that varies by host. Where the host makes
symbolic links, `read` follows a link whose source names a file and returns that file's text; where
the host makes junctions, the same `link` call throws and creates nothing. Link a directory and read
the file through it when a fixture must run on a host of either kind.

A missing source is accepted, and the dangling junction it creates answers the way a dangling
symbolic link does: `has` reports `true` and `read` returns `undefined`. It resolves later only if a
**directory** appears at the source. A file appearing there leaves it unresolvable, so a fixture that
links a path first and writes a file there second reads back nothing on such a host.

Where the host creates a junction, the stored value is the source resolved to an absolute path, so
`readlink` on a link made from a relative source returns an absolute path. That is why `link`
promises the stored value names the destination and promises nothing about its exact text. Assert on
what the link reaches, not on what it stores.

## Voices

Every message `src/browser` throws. Keep them distinct: a journey asserts the one it means, and
absent, present-but-gated, and ambiguous are different findings about an interface.

| Voice                                                                                    | Thrown by                 |
| ---------------------------------------------------------------------------------------- | ------------------------- |
| `No interactive element has the accessible name "<name>"`                                | `resolveRendered`         |
| `Interactive target "<name>" is not visible and focus-reachable`                         | `resolveRendered`         |
| `Interactive target "<name>" is ambiguous across <n> elements`                           | `resolveRendered`         |
| `Interactive target "<name>" could not be resolved`                                      | `resolveRendered`         |
| `Interactive target "<name>" is unreachable after scrolling`                             | `resolveAccessible`       |
| `Interactive target "<name>" is not reachable inside "<region>"`                         | `resolveAccessibleWithin` |
| `Interactive target "<name>" is ambiguous across <n> elements inside "<region>"`         | `resolveAccessibleWithin` |
| `Interactive target "<name>" could not be resolved inside "<region>"`                    | `resolveAccessibleWithin` |
| `Native disclosure "<name>" is not visible and focus-reachable`                          | `clickDisclosure`         |
| `Native disclosure "<name>" is ambiguous across <n> elements`                            | `clickDisclosure`         |
| `Native disclosure "<name>" could not be resolved`                                       | `clickDisclosure`         |
| `Interactive target "<name>" is not reachable through forward Tab traversal: <trail>`    | `driveTraversal`          |
| `Named region "<name>" is not visible`                                                   | `readPerception`          |
| `Named region "<name>" is ambiguous across <n> elements`                                 | `readPerception`          |
| `Named region "<name>" could not be resolved`                                            | `readPerception`          |
| `Interactive target "<name>" does not carry a value`                                     | `readValue`               |
| `Computed foreground color is unavailable`                                               | `readContrast`            |
| `Computed background color is unavailable`                                               | `readContrast`            |
| `Tester pane is unavailable for a capture`                                               | `stagePane`               |
| `Tester pane rendered <w>x<h> for a <w>x<h> viewport`                                    | `stagePane`               |
| `Capture frame at <path> never settled after <n> restagings: <h> over a <h> pane`        | `captureFrame`            |
| `Capture frame was written to <path> where <path> was asked for`                         | `captureFrame`            |
| `Capture frame at <path> is not the one this run shot`                                   | `captureFrame`            |
| `Capture frame at <path> could not be read`                                              | `readFrame`               |
| `Capture frame at <path> is not an image this browser decodes`                           | `readFrame`               |
| `Capture frame at <path> is not an image this browser decodes: <w>x<h> device pixels`    | `readFrame`               |
| `Capture frame at <path> cannot be measured without a 2D canvas`                         | `readFrame`               |
| `Capture variant "<name>" is not registered`                                             | `createPortfolio`         |
| `Capture state "<state>" is not registered`                                              | `place`                   |
| `Capture state "<state>" is already placed`                                              | `place`                   |
| `IndexedDB database "<name>" could not be deleted`                                       | `removeDatabase`          |
| `IndexedDB database "<name>" is blocked by an open connection`                           | `removeDatabase`          |
| `Key sequence "<keys>" was sent with nothing focused`                                    | `pressKeys`               |
| `Condition "<subject>" did not hold within <n>ms (waited <n>ms) (last states: <states>)` | `waitForState`            |
| `Animation subject is not connected`                                                     | `waitForAnimations`       |
| `Animation "<subject>" did not settle within <n>ms (waited <n>ms): <animations>`         | `waitForAnimations`       |
| `Class census walked no element`                                                         | `readCensus`              |
| `Contrast control cannot straddle the bar <bar>`                                         | `buildContrast`           |
| `Access is denied for <operation> "<key>"`                                               | `buildDenial`             |
| `No room is left for <key>`                                                              | `createStorage`           |
| `Storage quota must be a non-negative integer`                                           | `createStorage`           |
| `Statechart harness mounted no transition`                                               | `createHarness`           |
| `Statechart harness carries no status`                                                   | `status`                  |

Some of those rows are not plain `Error` messages. `buildDenial` returns a `DOMException` named
`SecurityError`, `createStorage` raises that one from every operation the permission withholds and a
`DOMException` named `QuotaExceededError` from a write past the quota, and each carries the name a
denied or full origin carries. Assert on the `name` as well as on the message.

The `waitForState` and `waitForAnimations` rows are the wait family's own voices with a subject
this layer supplies. `waitForState`
names the control and the state it was waiting for as its condition's description, and appends the
states it last read, so an exhausted wait says what the control was announcing instead.
`waitForAnimations` names the subject through `readRole` and `readName` and lists the animations
still running. Both validate their bounds through `checkBounds`, which raises
`Wait budget must be finite and non-negative` for the first and `Animation budget must be finite and
non-negative` for the second.

Some of them are narrowing rather than findings, and no input reaches them. Each `could not be
resolved` is one: a preceding length check does not narrow the later lookup under
`noUncheckedIndexedAccess`, so the branch gives the value its type. `Statechart harness carries no
status` is another: the harness writes that attribute at construction and nothing but the harness
writes it, so the reading is a member of `STATECHART_STATUSES` unless a caller took the attribute
off the root it was handed.

The capture guards are the other population no test drives, because each answers for a runner or a
provider this package does not control. `Tester pane is unavailable for a capture` fires where
Vitest stops laying its tester out inside a pane. `Capture frame was written to <path> where <path>
was asked for` fires where the provider resolves a screenshot path against a base other than the
calling test file. `Capture frame at <path> is not the one this run shot` fires where the file on
disk disagrees with the bytes the provider handed back — which a provider that overwrites its target
never produces, so the suite proves that comparison discriminates with a planted file rather than by
reaching the refusal. `Capture frame at <path> cannot be measured without a 2D canvas` is narrowing
of the same kind: a canvas allocated for this reading and asked for no other context type hands one
back. The remaining refusals of the `readFrame` function are driven, by a path holding no file, by a
file holding no image, and by a PNG header over no image data, and so is
`Capture frame at <path> never settled after <n> restagings`, by a fixture whose full-height panel
grows with every pane the capture stages.

The pointer, pseudo-element, and media helpers add the following voices.

| Voice                                                         | Thrown by      |
| ------------------------------------------------------------- | -------------- |
| `Browser provider exposes no DevTools session`                | `sendProtocol` |
| `Pointer is already held at <x>x<y>`                          | `driveHold`    |
| `Interactive target "<name>" did not enter the pressed state` | `driveHold`    |
| `Pseudo-element "<pseudo>" must start with "::"`              | `readStyle`    |
| `Pseudo-element "<pseudo>" is not one this engine exposes`    | `readStyle`    |
| `Media emulation was staged with nothing to emulate`          | `stageMedia`   |
| `Media emulation did not reach the tester: <query>`           | `stageMedia`   |
| `Media emulation did not clear from the tester`               | `releaseMedia` |

The resolver's absent, gated, ambiguous, and unreachable voices stay unchanged. The DevTools-session
and media-delivery refusals guard provider failures the managed Chromium suite doesn't induce.
The suite exercises real delivery rather than substituting a provider that manufactures a failure.

### Refusals outside the journey layer

The unchecked boundary refuses before it acts, and these are its own messages.

| Voice                                  | Thrown by         |
| -------------------------------------- | ----------------- |
| `Method must be callable`              | `invokeUnchecked` |
| `Target must be an object or function` | `readProperty`    |

Each is a `TypeError` rather than an `Error`, because what failed is the argument's own type rather
than a state the caller could have read first. Every other refusal `src/core` and `src/server` raise
is documented with the member that raises it: a wait names the description it was given, a scratch
member names the target it refused, and the [Contract](#contract) rule that owns each one spells the
message out.

## Contract

These hold across `src/core`, `src/browser`, `src/server`, and this guide.

1. **Doc ↔ source bijection, and every flagship fence transcribed.** Every `## Surface` row is a real
   export, and every export is a row — exhaustive in each direction, name and kind together. The
   same suite anchors its further comparisons to source rather than to the guide: the barrel exposes
   exactly what the modules declare, `## Methods` documents exactly the interfaces that carry call
   signatures, and every name a `ts` fence imports from this package is a real export. Deleting a
   documented section therefore fails rather than passing with nothing left to check.
   Resolution is not behavior, though: a name can resolve while the sentence beside it is false, so
   the same suite transcribes each flagship fence this package's own runtime can run and asserts the
   values that fence's comments claim. A fence naming a browser is left to the browser suite, which
   is where its values are pinned. Change a fence, change its transcription in the same edit.
   [`tests/guides.test.ts`](../tests/guides.test.ts) proves all of it, and builds its own file
   inventory with this package's `readInventory` and `resolveRoot`.
2. **`clear()` truncates.** It empties the backing array rather than replacing it, so a `calls`
   reference captured before the call reads as empty after it. Capture `calls` after the last
   `clear()` you care about, or read `count` instead.
3. **`captureError` converts a synchronous throw into a value.** It returns the thrown value
   exactly, including `null` and `undefined`, and it never throws for a thunk that completed. Limits
   come with that. A thunk that throws `undefined` is indistinguishable from one that
   completed, because both return `undefined`; assert on a thrown value's identity, not on its
   absence. And an `async` thunk never throws synchronously — it returns a rejected promise — so
   `captureError` returns `undefined` and the rejection escapes unhandled. It converts; it decides
   nothing. The variant that throws when nothing was thrown is an assertion, and it is not published
   here.
4. **`requireValue` tests presence, not truth.** `0`, `''`, and `false` pass through unchanged; only
   `null` and `undefined` throw. It exists because `!` and `as` are banned, so a throwing narrowing
   helper is the sanctioned way to reach a value's non-nullable type.
5. **`roundTripJSON` bounds its parameter by `JSONSafe<T>`, and throws rather than returning `null`
   quietly.** The parameter is `T & JSONSafe<T>` rather than `T extends JSONValue`, because a
   `JSONValue` constraint rejects every `interface`: TypeScript grants an implicit index signature
   to a type alias and never to an interface, and interfaces are what this fleet's public types are.
   The projection accepts an interface-typed value, keeps `T` as the return type, and refuses a
   `Date`, a `Map`, or any method-bearing type at the member that carries it. More members meet
   `never` because the copy would not carry what the type claims. Serialization drops a
   member typed `undefined` from an object and rewrites it to `null` in an array, so
   `{ a: undefined }` and a top-level `undefined` are both refused at the call. `JSON.stringify`
   never enumerates a symbol-keyed member, so the copy arrives without it. And a member declared as
   the opaque `object` type projects over no members at all, so a `Date` under it would copy back as
   a string, off the type the member declares. `unknown` is the member type that does pass through, so
   `Record<string, unknown>` is accepted and what its values hold is a runtime question rather than
   a typed one. The bound is not enough on its own either: `NaN`, `Infinity`, and `-Infinity` are
   numbers, they satisfy it, and `JSON.stringify` turns each of them into `null`. So the helper
   rejects a non-finite number at any depth with `JSON values must contain finite numbers`, and the
   copy's type claim holds for every value it does return. The replacer alone would not close it: a
   `JSON.rawJSON` value carries text `JSON.stringify` emits without inspecting, so
   `JSON.rawJSON('1e400')` passes the replacer untouched and parses back as `Infinity`. The helper
   therefore checks the parsed graph as well, and the replacer and the parsed-graph check report the
   same message. A normalization remains and is not an error: `-0` serializes as `0`, so the copy is
   `0`.
6. **`readInventory` refuses links.** A target is a file or a directory. A named file is read and
   keyed whatever `extensions` says, which is what lets one call take a package's root files and its
   source tree together; a named directory is walked under the filter. It throws when the root or a
   named target is a symbolic link, when the root is not a directory, when a target is neither a file
   nor a directory, or when a target resolves outside the root. A missing target surfaces the host's
   own `ENOENT` rather than a message from this package. It skips a symlink met while walking rather
   than following it. A target may be written relative to the root or as an absolute path inside it,
   and one that escapes is refused either way.

   A link in the **middle** of a named target is a separate refusal, and the only one that reaches
   it: the symbolic-link check reads the final segment, which such a link is not. The named target is
   resolved with `realpath` and refused when the real path leaves the root, so
   `readInventory(root, ['link/file.txt'])` with `link` pointing outside throws
   `Target outside root: link/file.txt`. When that link stays inside the root the target resolves,
   and the entry is keyed by its **real** path rather than by the path the caller named.

   An exclusion applies to a named target as well as a walked entry, so exclusion beats naming:
   `readInventory(root, ['src/core/index.ts'], { exclude: ['src/core'] })` returns `{}`. A
   `tsconfig` reader expects the more specific entry to win, the way a `files` entry survives
   `exclude`; here the more specific entry is the one that disappears. Express an exception with a
   second call that names the kept file and passes no exclusion, and merge the maps. An
   exclusion is normalized before the rule applies: a leading `./` and a trailing `/` are stripped,
   and `''` and `'.'` both name the root, so either drops every key. Keys are root-relative and
   separated by `/` whatever the host separator is: `readInventory` takes the spelling `relative`
   returns and rejoins its segments split on `sep` with `/`. The suite gates that proof on a host
   reading rather than on a platform name. It spells a nested path with `join`, and where that
   spelling carries `sep` and no `/` it asserts that a walked key and a named key both read
   `alpha/beta/deep.txt` and carry no `sep`. A host that already spells the path with `/` skips the
   case, because the conversion is a no-op there and discriminates nothing. The map is built by
   inserting the keys in sorted order. Read back, non-integer keys hold that order. Integer-like
   keys do not, because a plain object enumerates them numerically first: files named `0`, `2`,
   `10`, and `a.txt` insert as `0`, `10`, `2`, `a.txt` and enumerate as `0`, `2`, `10`, `a.txt`.
   Returning a `ReadonlyMap` would keep the order and break the structural match with
   `@orkestrel/guide`'s `SourceOptions.files` that the whole helper is shaped for, so the guarantee
   narrows instead. Case is the host's decision, not this package's: whether names differing only in
   case are the same file varies by filesystem, so the suite probes the running host and asserts
   what the probe returned instead of assuming either answer.

7. **`createScratch` refuses a lexical escape, not a symbolic link.** It allocates with
   `mkdtempSync` below `parent`, which creates the directory at mode `0700` on a host that applies
   POSIX permission bits. The suite gates that assertion on `supportsMode`, so the mode is proven
   where the probe answers `true` and the case is skipped where it answers `false`. A Windows host
   answers `false` and reads the same allocation back as `0666`, so the bits describe nothing it
   applies. Every member that takes a target — `write`, `read`, `has`, `names`, `ensure`, `link`,
   and `remove` — throws when that target lexically escapes the allocated directory, and a failed
   seed removes the directory before rethrowing. `remove` adds a refusal the others do not need: a
   target naming the allocation itself, lexically or through an intermediate symbolic link. The
   lexical half compares paths. The physical half reads only the final entry with `lstat` and
   compares it with `matchesIdentity`; it walks no path segments and follows no final link. That is
   the comparison `destroy()` makes, so it carries the same birth-time limit stated for `destroy()`
   later. `link` checks its target and not its source, so a contained link may point anywhere.
   `createScratch` does not walk the path's segments for symbolic links: that is sandbox behavior
   and this is not a sandbox. So a lexically contained path can still act outside the allocation,
   and only one that lands back on the allocation itself is refused; [Traversal](#traversal) states
   what each member does with a link it meets, and the [threat model](#threat-model) says who
   creates one.

   `names` sorts, and the suite discriminates a dropped `.sort()`. Filenames written from raw
   bytes give `readdirSync` the reverse of sorted order: `0x80` is an invalid UTF-8 lead byte, so
   that name reaches JavaScript as `U+FFFD` and sorts after `é`, while on disk `0x80` sorts before
   `é`'s leading `0xc3`. The suite asserts the host's order, the sorted order, and that they
   differ, so it fails rather than going quiet if that population ever stops discriminating.

   That population carries a limit, and it is Node's rather than this package's. A name the host
   refuses to decode reaches JavaScript as `U+FFFD`, and that string re-encodes to the bytes
   `EF BF BD`, which are not the bytes on disk. So the string `names()` hands back never addresses
   the entry it came from: `has` on it reports `false`, and `remove(names()[i])` removes nothing and
   throws nothing, because a missing target is a no-op. The silence is the cost — a caller looping
   over `names()` to clear a directory leaves such a file behind and reads success. Reach that file
   with a `Buffer` path through `node:fs` directly.

   `destroy()` is idempotent, and identity is what makes it safe rather than location: it removes
   the entry at the allocated path only while `matchesIdentity` holds against the allocation. A
   replacement directory left at that path is not removed, and an allocation moved elsewhere is not
   removed at all. That comparison never consulted the host temporary directory, so it holds
   unchanged wherever `parent` puts the allocation. Limits sit beside the `0700` one. The check
   reads the entry and then removes the path as separate steps, so an allocation swapped between
   them is removed anyway; whoever swaps it runs as the same uid, which is the population the threat
   model already declines to defend against. And birth time is the host's to supply. This host
   supplies a real one — the allocation's `birthtimeMs` does not move when files are written into
   it, while its `ctimeMs` does — so `destroy()` is sound here. Where a host has none, libuv reports
   `ctime` in its place, the first seeded write moves it, and `destroy()` takes its early return. It
   returns `void`, so that refusal is indistinguishable from success and the allocation leaks
   silently.

8. **A destroyed allocation answers presence and refuses action.** `read` returns `undefined` and
   `has` returns `false`; `write`, `names`, `ensure`, `link`, and `remove` throw
   `Scratch directory does not exist`. The split follows the return type: a member whose return type
   carries absence answers with it, and a member whose return type does not, refuses. `names` asks a
   question and changes nothing, and it refuses anyway, because `readonly string[]` has no value
   meaning gone. `write`, `ensure`, and `link` are why the refusal is written out rather than left to
   the host: each calls `mkdirSync` with `recursive`, which recreates every missing parent, so
   without the check any of them would rebuild the allocation root and leave a destroyed
   fixture looking alive. `remove` is written out for the opposite reason: `rmSync` with `force`
   does not throw on a path that is not there, so without the check it would report success against
   a fixture that is gone.
9. **One runtime dependency, and no foreign type in a signature.** `dependencies` holds exactly
   `@orkestrel/contract`: `src/core` reads its `Result` inside `retryUntil` and narrows with its
   guards, `src/browser` narrows with them too, and `src/server` narrows and parses with them. The
   [Limits](#limits) row `An outcome triple` records that adoption and why a second copy of the type
   was refused. `vitest` is a peer dependency rather than a runtime one, so the runner a consumer
   already installed is the one this package drives. No exported signature names a type from another
   `@orkestrel` package, so no consumer can be handed a two-copies type failure by installing this
   package. The browser entry's declarations do name this package's own core types — `CaptureVariant`
   extends `JourneyVariant`, and `StateOptions` extends `WaitOptions` — and the declaration roll-up
   writes those as imports from `@orkestrel/test`. That is one package resolving its own root entry
   rather than a second copy of anything, which is the whole of what the two-copies rule is about.
10. **`createTeardown` runs newest-first, and every handler runs.** `destroy()` takes the registered
    handlers in reverse registration order and awaits each one before starting the next, so a
    handler that undoes what a later registration depends on runs after it. A handler that throws or
    rejects does not stop the run: every remaining handler still runs, and the failures are raised
    at the end. Exactly one failure is rethrown by identity, so a test can assert on the value it
    threw. Several are wrapped in an `AggregateError` whose `errors` are in run order — newest
    first — rather than in registration order. `destroy()` empties the list before it starts, so a
    handler registered while the run is in progress stays registered for the next call rather than
    joining this one, and `count` read from inside a running handler counts only those late
    registrations. A repeated `destroy()` runs nothing that already ran, which is what makes it
    idempotent. The list registers no Vitest hook itself: the consumer writes
    `afterEach(() => teardown.destroy())` once, in its own setup. That one line is what keeps the
    runner out of this package's `dependencies`: registering the hook here would take a runtime
    dependency on the test runner, and `vitest` is a peer dependency precisely so the installation
    the consumer already made is the one that runs.
11. **`createLoopback` binds a server the caller made.** The caller constructs its own unstarted
    server and keeps every protocol handler on it; this package supplies the bind and the release
    and nothing else. It listens on port `0` at `127.0.0.1`, so the host assigns the port and the
    address is always IPv4 loopback — never `::1`, which a host resolving `localhost` can hand back
    instead, and never a fixed port a parallel worker may already hold. `port` is that assigned
    number, read off `address()`. `url` is `http://127.0.0.1:<port>` with no trailing slash, and the
    scheme is spelled `http` unconditionally, so a TLS server's origin is `port` plus a scheme the
    caller writes itself. `destroy()` drops every live connection before it closes, so a keep-alive
    client cannot hold the port past the test that opened it; the drop reaches the `node:http` and
    `node:https` servers that carry `closeAllConnections`. A plain `node:net` server has no such
    method to call, so `destroy()` waits for its open sockets to end. It is idempotent — the first
    call's promise is returned to every later one — and a server already closed underneath it
    resolves rather than throwing. The package never reserves a port number and releases it for the
    caller to rebind; [Limits](#limits) states why that shape is refused.
12. **`createHostileValues` is a growing totality corpus with a negative control.** Each call
    returns a frozen array of fresh values, and [Prove a guard is total](#prove-a-guard-is-total)
    lists every member with the reading it breaks. Every member makes a naive read throw or violates
    a naive structural assumption; a total guard survives every member without throwing. Each has a
    direct probe for that failure. The negative control keeps an inert value from entering the corpus
    under a hostile name. Whether it accepts or refuses one is that guard's own contract. Membership
    may grow in a release, so consumers loop over the whole array, assert their guard's expected
    answer per index, and attribute each failure by that index instead of naming or counting members
    locally.
13. **The journey layer resolves its own targets, and imports almost nothing.** No journey verb in
    `src/browser` accepts an element, a component instance, or a selector for the target it acts on:
    each finds its own from a role and an accessible name, which is what stops a journey drifting
    into a description of the markup. `build` creates a node, `mount` attaches one, `render` does
    both, `clearStorage` takes nothing at all, and `removeDatabase` takes a database name. The
    predicates, the element readers, and the describers do take a node —
    `isRendered`, `isReachable`, `readHit`, `readText`, `readRole`, `readName`, `readStates`,
    `readCensus`, `describeTree`, `describeFocus`, `extractOrphans`, `readRows`, `readStyle`,
    `readToken`, `readPixels`, `readContrast`, `readLayers`, `readBackdrop`, and `readRing` — and
    each is a reader of a node the caller already has rather than a verb that acts on a target.
    `waitForAnimations` takes one as the subject of a wait, and waiting for a browser to stop
    painting it changes nothing about it. `buildContrast`, `buildEscapes`, and `buildCensus` return
    detached nodes for the caller to append and remove, the way `build` does. `captureFrame`
    and `place` take one as the subject of a photograph, which is a reading too: neither moves
    focus, dispatches an event, nor changes what the element renders. `typeInput` and `commitInput`
    are the one pair that acts on the element it is handed, and the exception is deliberately
    narrow: they are the synthetic counterpart of `typeAccessible`, for a component that listens for
    `input` and a test that already holds the field. Drive the field by name wherever the keystrokes
    are part of what the journey claims. `readRing` is the case that makes the split explicit. It
    measures the focus chrome a browser painted and never brings the focus about, so a journey
    reaches the control through `traverseAccessible` or `pressKeys` and then measures what landed.
    The environment imports `vitest/browser`, DOM globals, this package's own core, and the
    `@orkestrel/contract` guards it narrows with — and no framework, no `node:*`, and no
    `import.meta.env`, so whether a run writes captures is the consumer's decision through
    `PortfolioOptions.enabled` rather than an environment variable this package reads. The core
    import ships as an import rather than as a second copy: the browser build declares `@src/core`
    external and rewrites it to the core entry beside it, and the declaration roll-up rewrites it to
    the package name, so a consumer resolves one `waitForCondition` rather than two. `vitest` is a
    peer dependency, so the provider the layer drives is the one the consumer already installed.
14. **The wait family polls only where nothing publishes an event.** The no-polling architecture law
    governs a product's idle wakeup: a running system parks on the event or the abort signal that
    fires. A test instrument is the other case. It waits on a fact another process produces — a file
    a build wrote, a port a child bound, a handle a host has not released — and that fact publishes
    no event to park on, so `waitForCondition` re-reads the condition through `waitForDelay` inside a
    budget measured with `performance.now()`. Where an event does exist, `waitForEvent` is the door:
    it parks on the subscription, validates the interval for consistency with the family and never
    uses it, and invokes the cleanup the subscriber returned on timeout, on abort, and on delivery
    alike. `waitForAnimations` is the browser environment's parking door, on the same terms: it parks
    on each animation's own `finished` promise and validates the interval for consistency with the
    family without ever using it. `waitForText` polls, because a reading of text publishes no event,
    and it refuses two calls no reading could ever satisfy before it takes one: an empty `text` or
    an empty `absent` with `Text expectation must not be empty`, because every string contains the
    empty string, and a `text` that carries `absent` with
    `Text departure must not appear in the text expectation`, because a reading that satisfies the
    arrival carries the departure too — under `exact` it equals `text` and without it contains
    `text`. `waitForCondition`, `retryUntil`, and `waitForEvent` each name what they are waiting for,
    and that description is what the timeout message carries — a wait nobody described times out
    saying nothing about what failed. Every bound is validated finite and non-negative before
    anything is read, a budget of `0` still permits the immediate first reading, and an abort rejects
    with the signal's own reason rather than with a message of this package's. `retryUntil` also
    renders the last unsatisfying value into its exhaustion message, through `JSON.stringify` with a
    string conversion behind it and a cut at 200 characters, so an exhausted retry reports what it
    kept producing rather than only that it kept failing. `waitForCondition` and
    `retryUntil` throw opposite ways, and the split is deliberate: `waitForCondition` propagates a
    condition's throw
    unchanged, because a broken reading does not become true by being taken again, while `retryUntil`
    counts a `produce` throw as an unsatisfied attempt and hands the last one to the exhaustion
    error's `cause`, because a producer that throws is exactly what a retry exists for. A throw from
    `satisfied` propagates unchanged for `waitForCondition`'s reason: the predicate is broken.
15. **A role map's membership is the contract.** `IMPLICIT_ROLES`, `FIELD_ROLES`, `HEADER_ROLES`, and
    `CONTENT_ROLES` are each read as a closed list rather than as a cache of an ARIA computation. A
    tag `IMPLICIT_ROLES` omits carries no implicit role, so `readRole` returns `undefined` for it,
    `describeTree` writes no line for it, and the walk continues straight into its children at the
    depth the omitted element sat at; an `input` type `FIELD_ROLES` omits exposes none the same way.
    `A`, `INPUT`, and `SELECT` are absent from `IMPLICIT_ROLES` deliberately, because each takes its
    role from an attribute rather than from its tag, and `readRole` answers for them from their own
    anatomy. Read a description that omits an element as the map's answer rather than as a defect.
    Widening what a description carries is a change to the map here, not a workaround at the call
    site.
16. **`isRendered` and `isReachable` are the announced half and the clickable half.** `isRendered`
    reads no geometry at all: only the removals a browser honours — `aria-hidden` anywhere above the
    element, the `hidden` attribute, a hidden input, and a `display` or `visibility` that takes it
    off the page. `isReachable` reads geometry, and adds connectedness, a visibility check that
    honours opacity, a non-zero box, the sequential focus order, `:disabled` and `aria-disabled`, and
    the `[inert]` ancestor. It adds one reading the element's own facts cannot carry: an open modal
    dialog. A shown `[aria-modal="true"]` element that does not contain the subject refuses it,
    because a pointer, a Tab, and a reader honouring that attribute all stop at the dialog while the
    covered control stays connected, laid out, and focusable. The dialog is put through `isRendered`,
    so a drawer parked at `visibility: hidden` excludes nothing, and containment follows the flat
    tree, so the innermost dialog rules and a host it holds carries its shadow content with it.
    Applying that inside the predicate is what keeps the resolver, the ambiguity count, the Tab
    trail, and every acting verb agreeing with the person in front of the dialog, and it is what
    takes away the name splitting a consumer writes to keep a covered control out of the count. A
    control clipped to a zero-size rectangle is the case that separates them: the accessibility tree
    still announces it, so `isRendered` accepts it and `isReachable` refuses it. `isReachable` is the
    one reachability filter the layer applies — `resolveRendered`, `clickAccessibleWithin`, and
    `clickDisclosure` each narrow their own candidates and then keep the ones it accepts — so a
    journey meets one rule rather than near-copies of it. Neither asks about the viewport;
    `resolveAccessible` scrolls a wholly off-viewport target into view and measures that separately
    with `isOutsideViewport`.
    `readHit` reads beside that pair rather than filtering with it. It hit-tests one point — the
    element's own bounding-box centre — which is how it sees what neither predicate can: a cover
    over a control they both accept, and a wrapped inline target whose centre falls between its line
    boxes. No acting verb consults it, because it names a node rather than ruling, and `isReachable`
    stays the one reachability filter the verbs apply. It is also the reader that needs the pair run
    first, and [Bounds a shipped helper carries](#bounds-a-shipped-helper-carries) states what it
    reports for an element that failed them.
17. **A journal forwards every console call and swallows nothing.** A browser publishes no listener
    for its own output, so `createJournal` stands in front of the console and hands each call on to
    the channel that was there when `start` armed it. A run under a journal therefore prints exactly
    what it prints without one, which is what stops a recording from hiding the diagnostics it exists
    to keep. `stop` puts those same function references back by identity, so a channel another tool
    installed survives the journal rather than being replaced by a copy of it. `start` clears `steps`
    and `output` whether or not the journal was already recording and leaves a standing interception
    alone, so a restart never wraps its own wrappers. `record` does nothing while the journal is
    stopped, and `steps` and `output` hand out snapshots. There is no shared instance: a file that
    needs one journal per scenario creates one per scenario.
18. **The capture layer depends on the Vitest runner's own tester layout, deliberately.** A
    screenshot is taken off the page the runner painted, and `vitest@4.1.11` lays its tester out
    inside a smaller page and fits it by scaling the pane the tester sits in, so a frame shot through
    that scale is a thumbnail of the surface. `stagePane` therefore reaches into that layout: the
    `iframe[data-vitest]` selector and the `--tester-transform`, `--tester-margin-left`,
    `--viewport-width`, and `--viewport-height` custom properties are the runner's, not this
    package's, and `captureFrame` reads its written file back through the runner's built-in
    `readFile` command. That is contract rather than accident. A Vitest release that renames any of
    them reddens `stagePane`'s size check, which throws
    `Tester pane rendered <w>x<h> for a <w>x<h> viewport` rather than writing a wrong frame. The
    coupling therefore fails loudly, and the version this rule names moves with the fix instead of a
    suite shipping thumbnails nobody inspects. The same layout decides what a frame covers: the
    provider shoots the tester's body in the top-level page's coordinates, so the `captureFrame`
    function stages the pane again at the document's own height wherever the document outruns the
    declared one, and a page frame is neither shorter nor taller than the document it photographs.
    That height is
    `measureContent`, the content's own edge rounded up, rather than the body's box: the box is the
    larger of the content and the pane, so a taller pane stretches it and a capture cannot read its
    way back down. The edge is read again after every staging, because a rule bound to the viewport
    height lays the document out taller against the taller pane, and each staging carries the growth
    the one before it produced so a converging document lands on its fixed point rather than
    creeping toward it. The re-reading is bounded by `CAPTURE_STAGINGS`, and a document still
    growing at that bound is refused rather than photographed at a stale height. An element frame
    keeps the declared pane unless its element is taller, and offsets the calling tester frame only
    as far as brings the element inside the runner's window. What
    the capture borrows it gives back: the `releasePane` function returns the tester to the viewport
    it held before the staging, the capture then restores the tester's scroll position, even where
    the release rejects, and it restores the offset frame's
    `style` attribute as soon as the screenshot settles. So the variant a frame was shot at belongs
    to that frame alone, and a suite that wants a size of its own calls the `page.viewport` method
    rather than this pair.
19. **The statechart harness is test-side, and the markup is its whole contract.** A page cannot
    import this package. `@orkestrel/test` is a development dependency, its browser entry imports
    `vitest/browser` at module scope, and that import throws outside Browser Mode — so an
    application that reached for `createHarness` would be shipping the runner to production.
    The harness therefore mounts from the suite, and the only thing that crosses to a gate
    outside the page is the rendered markup. `STATECHART_ATTRIBUTES` names every attribute on
    both sides of that boundary, so neither the harness nor the gate spells a `data-statechart-*`
    string of its own. The markup is framework-free and the harness renders it with `build` and
    `mount`, so a workspace that installs no view library can still run it. Every reading the
    object publishes comes off that markup rather than out of a field beside it: `status`,
    `total`, `passed`, and `failed` read the root's attributes and `failures` reads the name of
    each row whose rendered `result` reads `failed`, so a test asserting on the object and a gate
    polling the page cannot report different things. That gate has no rejection channel, so every
    exit writes a terminal status: a completed run writes `passed` or `failed`, and a run that a
    `state` reader or a non-`Error` phase throw ends writes `failed` and then rejects with that
    value by identity, leaving the row it was reading uncounted. A run that rejected while the root
    still read `running` would strand the gate on a reading the harness never leaves. The gate stays
    outside this package: the harness carries its own tally, so nothing here reads a harness back,
    and no page is generated or published to host one.

### Threat model

The filesystem helpers make different promises, because they work on different directories.
Read the `createScratch` contract against the `createScratch` paragraphs later and the
`readInventory` contract against the `readInventory` one.

`createScratch` allocates its own directory with `mkdtempSync`, which sets mode `0700` on a host
that applies POSIX permission bits, and the suite asserts that mode where `supportsMode` answers
`true`. Where the host applies those bits, the mode keeps another uid out; where `supportsMode`
answers `false` the mode protects nothing, and the allocation carries only the access its parent
directory already gives. The mode does not keep out a sibling test worker or the code under test on
any host, because both run as the same uid, and they are the population that would create a link
here. Its containment check is lexical: it refuses a relative path that escapes the allocated
directory, which is the accident that actually happens — a test writing `../foo`. It does not walk
the path's segments for symbolic links, because per-segment walking is sandbox behavior and this is
not a sandbox.

So a link inside the allocation was created by the test process or by the code the test drives, and
handing `scratch.path` to the code under test is the ordinary use of this helper. `link` is this
package's own entry in that population: it creates a symbolic link on request, it refuses only an
escaping target, and its source may name anything. The source stays unchecked except on the fallback
path, which stats it to decide whether a junction can point there. [Traversal](#traversal) states
what each member does with a link it meets, and a contained path reaching outside the allocation
through one is the result. This helper does not defend against that.

`parent` adds a limit, and it is visibility. An allocation under the host temporary directory is
seen by nothing in the repository. An allocation under a path inside a package tree is seen by
everything that walks that tree while it exists — `tsc`, the formatter, the linter, the policy
sweep, and the test runner's own globs. Set `parent` to a path those tools already ignore, or leave
it unset and take the host temporary directory. `destroy()` is unaffected either way, because it
matches on identity rather than on where the allocation sits.

`readInventory` walks a directory the caller supplies, usually a real checkout the test did not
create, so it does refuse links. It keeps its refusals separate: it throws on a symlinked root,
throws on a symlinked named target, throws on a named target whose real path leaves the root through
a link in the middle, and skips a symlink met while walking. They are distinct decisions rather than
a shared rule, and each is its own check at the door it guards.

Neither helper stops hard links. A hard link is an ordinary directory entry: `lstat` reports a
regular file, so `readInventory` reads the outside inode and `createScratch` writes through it.
Detecting that would need inode bookkeeping on every entry, and it would buy nothing, because
anyone able to create a hard link where the test process writes already writes there. So no
hard-link detection is added, and the boundary is documented instead.

## Limits

This package ships what the fleet repeats, not everything the fleet has.

A candidate ships when it is a reusable test mechanism, has a real consumer, fits this package's
environment boundaries, and duplicates no native or declared-dependency primitive. Repeated demand
across the fleet is what raises a candidate, and it is evidence rather than the gate. A shape many
packages wrote is still refused when it is one suite's policy, a redeclaration of a type another
`@orkestrel` package already publishes, or a race; a shape few packages wrote still ships when the
mechanism is a contract every consumer has to implement identically.

The journey layer in `src/browser` is that second case. It is what `orkestrel-prove-journey`
requires every browser workspace to implement, and a workspace writing its own copy of it writes a
slightly different resolver, a slightly different set of failure voices, and a journey that reads as
if it proved something it did not. Publishing it once is what keeps those implementations identical.
Touching the DOM buys nothing on its own: the browser candidates the survey raised are ruled one at
a time in the following table, and some of them ship while others do not.

A member is one implementation group carried by one package, under whatever name that package
spells it and whether it exports the helper or declares it inside a test file. Repeated calls routed
through one shared implementation stay one member, and a set of adversarial values fed through one
totality loop is one member rather than one per value. Read the first column as the group rather
than as an export: **nothing in this section is importable**, and the only names you can install are
in [Surface](#surface).

The table records the evidence and the ruling for each candidate the fleet survey raised. Revisit a
row when the candidate's shape changes, when a native or declared primitive appears that covers it,
or when a consumer appears the ruling did not consider.

| Candidate                                                                                        | Ruling  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A recorder map over an emitter's events, with its map, event-map, subscriber, and totality types | Ships   | It ships as `createRecorders`, with `RecorderMap` and `EventSourceInterface` beside it. Inference is what the earlier refusal turned on, and the shape improves it without settling it: a source parameter typed `EventSourceInterface<TMap>` is an inference site, so a call against one names no type argument, while a concrete class supplies none and the call names both. A keying limit survives that: `TName` derives from the events array's element type, so an array declared with a wider union than its contents keys the map past the events actually listed, and [Bounds a shipped helper carries](#bounds-a-shipped-helper-carries) states what to pass instead. A published signature still cannot import a consumer's event map, so the interface asks for the subscribe half alone and the consumer's own map is what it is instantiated with.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Hostile guard-input sets                                                                         | Ships   | `form`, `table`, and `supervisor` each feed one adversarial set through total readers, and the set is a mechanism rather than a policy: a guard's own contract decides the answers, not the corpus. It ships as `createHostileValues`; its members do not each become a factory, and every member carries a naive-reader negative control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Raw invocation — `invokeRaw`                                                                     | Ships   | It ships as `invokeUnchecked`, with `readProperty` beside it for the read. Native `Reflect.apply` still makes the call; what these add is the boundary — a callability refusal before the call, a target refusal before the read, and one named place where an unchecked runtime result meets the type its caller claims. The claim stays the caller's, and so does the guard that narrows what came back. Without them a consumer that bans `as` cannot drive a foreign object at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Condition polling — wall-clock predicate loops                                                   | Ships   | The wait-family contract states the distinction: the no-polling architecture law governs a product's idle wakeup, and a test instrument waiting on a fact another process produces has no event to park on. It ships as `waitForCondition`. `retryUntil` ships on the same reading, because retrying a real operation is not re-reading a predicate; and where an event does exist, `waitForEvent` is the door.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Deep nesting beyond a guard's cap                                                                | Refused | `table` builds a record chain and `supervisor` builds nested arrays. The two nest different containers, so one shared factory needs a selector argument that changes the construction algorithm — a mode switch rather than a mechanism.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Canonical wire fixpoint assertions                                                               | Refused | `form` and `table` each serialize, parse untrusted JSON, serialize again, and compare exact bytes. The comparison is an assertion over the consumer's own codecs rather than a reusable mechanism, so the shape stays consumer-local and [Prove a wire fixpoint](#prove-a-wire-fixpoint) publishes the pattern instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Numeric corpora, hostile-key tables, and deep-freeze                                             | Refused | A numeric corpus or a hostile-object table is test policy — what a given suite decided to check — rather than a mechanism, and one factory covering the variants would need a mode argument. `createHostileValues` ships because a guard's totality is a property of the guard; these encode a decision about coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Clearing web storage between tests                                                               | Ships   | Emptying local and session storage together is one mechanism, and the `afterEach` hook that must run after a failed test too is where every browser suite needs it. It ships as `clearStorage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Class-ancestry orphan detection                                                                  | Ships   | A rendered element carrying a child class with no container class above it is a real invariant a stylesheet cannot state, and the check is mechanism when the class names are parameters rather than one framework's. It ships as `extractOrphans(root, child, parent)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A DOM element builder                                                                            | Ships   | It ships as `build` for the element and `mount` for the attachment, and `render` widened to take a tag and its class list as well as markup. A class list, a text, and an attribute map are what a fixture actually varies, and expressing that variation through markup means assembling a string. Nothing here assembles a tree one call at a time: a fixture with children is still written as markup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A surface digest — `describeSurface`                                                             | Refused | Its digest format is one workspace's policy about what a summary of a surface contains, and it is assembled from the excluded `extractControls` besides. `describeTree` and `describeFocus` publish the readings a digest is built from instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A control extractor — `extractControls`                                                          | Refused | Generalized past its one caller it is a wrapper over `querySelectorAll` that adds no boundary, invariant, composition, or narrower contract, which is what the superfluous-wrapper rule refuses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A pointer-centre hit reading — `readHit`                                                         | Ships   | It ships as `readHit`. `extractControls` is the bar it has to clear, and it does: the centre computation composes a rectangle reading with a hit test, the `undefined` translation is this package's absence convention for a reader, and "the point is always this element's centre" is a materially narrower contract than `elementFromPoint`. `roughnotes` writes that composition inline in `App.test.ts`, `integration.test.ts`, and the `ContactForm`, `PaymentForm`, and `SubscribeForm` suites, each against the cover and the wrapped target `isReachable` cannot see.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Text resolution by selector — `resolveText`                                                      | Refused | The journey-layer contract is the one it breaks: a journey verb resolves its own target from a role and an accessible name, and one that takes a selector turns a journey into a description of the markup. Taking a node the test already holds is a different thing, which is what the element readers do; `findRule` takes a selector because its subject is the stylesheet rather than a target to act on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A hand-driven timer — `terminal`, `toolbox`                                                      | Refused | `toolbox` runtime-depends on `terminal`, so the two are one implementation rather than independent demand. The shape is also `@orkestrel/terminal`'s published `TimerHandler`, which a copy here would redeclare unversioned and hand consumers a second incompatible type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A hand-driven clock — `mcp`, `middleware`                                                        | Refused | `AGENTS.md` bans replacing the host clock outright, so publishing one from the fleet's own test package would sanction across every workspace the substitution those rules refuse. `waitForDelay` waits on a real host timer and `waitForCondition` bounds a real elapsed interval with `performance.now()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A reserve-then-release port picker                                                               | Refused | It binds a port, closes it, and hands the number to a child that binds it again, and the window between that close and that rebind is a race another process on the host can win. Have the child bind `0` and report back the port it was given; `createLoopback` does exactly that for a server the test owns itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| An abort-signal wait — `waitForAbort`                                                            | Ships   | It ships as `waitForAbort`. Every bounded member still takes `WaitOptions.signal` and rejects with the signal's own reason, so a bounded wait needs nothing here; this answers the other case, where the abort is itself the fact the test waits for. It parks on a one-shot listener with no timer and no budget, so a signal that never aborts is the caller's own deadlock rather than a timeout this could name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Abort-signal instrumentation                                                                     | Ships   | It ships as `createSignal`. A recorder handed to `addEventListener('abort', …)` still records what one listener heard; what no recorder can answer is how many listeners stand on the signal at this moment, which is the question a leak asks. The instrumented signal counts its own abort registrations, keyed by the original callback and the capture mode, so a helper that removes what it added proves the removal. A registration leaves the tally on removal, on a one-shot delivery, and when a signal scoping it aborts, which is what makes the reading a live tally rather than an install count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| An outcome triple — a produced arm, a failed arm, and their union                                | Adopted | This package runtime-depends on `@orkestrel/contract` and imports `Result`, `Success`, and `Failure` from it rather than shipping a second copy. No signature published here returns one — `retryUntil` reads the type internally — and the names are not re-exported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A statechart transition table and its runner                                                     | Ships   | It ships as `StateTransition` and `StateScenario`, driven by `executeScenario` and `executeScenarios`, with `STATECHART_ATTRIBUTES` and `STATECHART_STATUSES` for the harness a browser workspace renders. `elements` and `veneer` each declare the field-identical pair of interfaces in their own setup file, so the fleet already writes this twice and a third copy drifts the moment one of them adds a phase. The runner ships in its walking form rather than its registering one: a package helper registers no test, so `describe` and `it.each` stay in the workspace and this drives whatever rows it is handed. The row's name is what a failure carries, because a table's rows run under one test name and a bare assertion message never says which row produced it. No published package declares a generic transition record or a closure-walking runner. `@orkestrel/workflow` names a task's behavior with a string and sequences structurally, so it neither takes a scenario's closures nor drives `arrange`, `act`, and `assert` in order, and adopting it would move this package off layer 0 and pull that package's whole runtime graph into every consumer's test install. `STATECHART_STATUSES` names a harness's reported run state rather than a task's derived status, so it does not restate `LifecycleStatus`. `STATECHART_ATTRIBUTES` is the fleet contract the journey skill's statechart reference fixes for every harness and every gate, so it is a mechanism the fleet shares rather than one suite's policy. |
| A keyboard verb — `pressKeys`                                                                    | Ships   | It ships as `pressKeys`, and the refusal is what keeps it from being a rename of `userEvent.keyboard`. A key sent while the document body holds focus reaches no control, every assertion after it reads the surface the key never touched, and nothing in the provider's verb reports that. The refusal is an invariant rather than a spelling, and the skill stops teaching the provider's verb directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A text wait — `waitForText`                                                                      | Ships   | It ships in `src/core` as `waitForText`, because a reading of text is host-independent and the reader is a parameter. `waitForCondition` is the poll underneath it and asks the caller to write the comparison; `retryUntil` repeats a real operation and counts a throw as an attempt, which is the wrong direction for a reading that must stop on a broken region. What this adds over writing the predicate by hand is the pair of bounds a replacement needs: `exact` for a reading that must be the sentence rather than carry it, and `absent` for the sentence the screen is replacing, without which a wait resolves on the frame carrying both. An empty expectation is refused rather than satisfied by every reading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| An announced-state wait — `waitForState`                                                         | Ships   | It ships as `waitForState`. The fleet's browser suites poll a framework's own class names to decide a menu has finished opening, which reads a stylesheet's vocabulary and goes stale when the framework renames it. This waits on what the control announces, resolves the control afresh on every reading so a re-rendered node is still the subject, and returns the states at resolution so an assertion has them. Where a surface announces nothing, the finding is the surface's: the replacement is an `aria-expanded` on the trigger rather than a helper that reads classes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| An animation wait — `waitForAnimations`                                                          | Ships   | It ships as `waitForAnimations`. The fleet hand-rolled the same loop over `getAnimations` in more than one workspace, and a contrast or color reading taken while paint is moving reports an interpolated frame no state of the interface paints. It parks on each animation's own `finished` promise rather than polling, re-reads after each completion so an animation a finishing one starts is waited on, and excludes an animation declaring infinite iterations — a spinner that runs forever is a finding about the reading rather than a wait to lengthen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A refusal reader — `readRefusal`                                                                 | Ships   | It ships as `readRefusal`. `captureError` is the bar it has to clear and it does: this fixes the resolver rather than taking any thunk, translates the `unknown` a capture hands back into `string \| undefined`, and rethrows what is not an `Error` instead of returning it as a message. A journey asserting that a control is gated rather than absent compares the exact sentence, and `roughnotes` writes that same capture inline wherever it asserts on a refusal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A storage fixture — `createStorage`                                                              | Ships   | It ships as `createStorage`, returning `WebStorageInterface`. A consumer declared a class bounding writes and a class withholding permission, and each is the same inert store under different options. It is a real `Storage` backed by a map of its own, it patches neither browser surface, and `permit` grants what the host withheld. A stalled read was refused with it: `Storage` is synchronous, so a stall is not expressible against the interface a consumer codes to.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| An authored-class census — `readCensus`                                                          | Ships   | It ships as `readCensus`. `readClasses` differenced against `readCascade` is the check, and every workspace writes that difference the same way; what each of them omits is the population, so a walk that read nothing reports the same empty difference as markup whose every class the cascade declares. Reporting `elements` beside `undeclared` and refusing an empty walk is the invariant this adds over the two readings it composes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Control fixture builders — `buildContrast`, `buildEscapes`, `buildCensus`                        | Ships   | Each ships. An instrument is not evidence until its control has failed, and a consumer's contrast, style-escape, and census readings each ran against fixtures that could not fail them: every other fixture painted its own opaque background, so the compositing walk never ran; the escape reading was fed an inline attribute and never a `<style>` element; and the census was fed an HTML token and never the SVG one whose class list is no string. Each builder is parameterized by what the policy owns — the bar, the exempt id — and returns detached nodes, so the caller decides where they are read and nothing is mounted for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A stalled-read store                                                                             | Refused | A store whose reads hang is not expressible against the interface a consumer codes to: `Storage` is synchronous, so `getItem` either answers or throws and there is no point at which a caller awaits it. A test that needs a hanging read needs an asynchronous surface, which is a different subject from the Web Storage one `createStorage` stands in for.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A painted-population predicate — `isPainted`                                                     | Refused | The platform already answers it. `element.checkVisibility()` reports what the box tree renders and a non-zero `getBoundingClientRect()` reports what occupies space, and `isRendered` and `isReachable` already compose those two for the questions this layer asks. A third predicate over the same readings adds a name rather than an invariant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A statechart harness — `createHarness`                                                           | Ships   | It ships as `createHarness`, with `HarnessOptions` and `HarnessInterface` beside it. The attribute contract is one every consumer would otherwise implement identically, which is the same admission that shipped the journey layer: `STATECHART_ATTRIBUTES` already published the names, and a workspace writing its own renderer against them writes a slightly different root, a slightly different row, and a gate that reads one workspace's markup and not the next one's. It renders framework-free markup through `build` and `mount`, drives each row through the `executeScenario` this package already publishes, and carries on past a failing row so one run reports on the whole table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A separate gate reader — `readHarness`                                                           | Refused | The object already carries the tally. `createHarness` returns `status`, `total`, `passed`, `failed`, and `failures`, every one of them read off the rendered markup, so a second helper that parsed the same attributes back out would be a wrapper over `getAttribute` adding no boundary, invariant, or translation. A gate running outside this package is outside its environment too — it polls a page from a process that never imports a module importing `vitest/browser` — so what it needs is the attribute names, and `STATECHART_ATTRIBUTES` is what publishes them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A generated or published harness page                                                            | Refused | Which transitions a surface owes, where that page is deep-linked, and whether it ships to anyone are product decisions, and framework code stops before them. A page hosting a harness would also have to import this package, which rule 19 rules out: the browser entry imports `vitest/browser` at module scope. The mechanism ships and the page does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A framework-class disclosure settle                                                              | Refused | A helper that waits for a named element to carry one class and not two others encodes one framework's transition vocabulary, which is that framework's policy rather than a mechanism. `waitForState` waits on what the control announces and `waitForAnimations` waits on the paint itself, and between them they answer the question the class poll was asked. A surface announcing nothing is the finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

The journey additions have these candidate rulings.

| Candidate                       | Ruling  | Why                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A hover verb                    | Ships   | `hoverAccessible` adds exact role/name resolution and the journey's reachability boundary to the provider's hover primitive.                                                                                                                                                                                  |
| A pointer hold                  | Ships   | `holdAccessible` composes resolution, tester-scale mapping, a trusted press, and a pressed-state read-back through `driveHold`; `holdAccessibleWithin` resolves inside a named region and drives the same hold. `releasePointer` releases the hold and clears hover. Veneer's Button consumes the held paint. |
| A pseudo-element style read     | Ships   | The third argument of `readStyle` and `readPixels` selects another subject of the same CSSOM reading. A separate reader would duplicate that operation.                                                                                                                                                       |
| A medium emulation              | Ships   | `stageMedia` bounds the axes through `MediaOptions`, reads back `print: true`, either `motion` value, and either `forced` value, and pairs with `releaseMedia` for teardown. A `print: false` stage is sent and followed by a frame wait without a read-back.                                                 |
| A DevTools command door         | Ships   | `sendProtocol` centralizes the unchecked provider boundary shared by pointer and media operations. The scale control consumes it directly.                                                                                                                                                                    |
| A general media-feature map     | Refused | The consumer needs print, motion, and forced colours. A free-form map adds an unbounded contract without a consumer.                                                                                                                                                                                          |
| A scoped hold taking a callback | Refused | The layer already uses stage-and-release pairs. An `afterEach` hook owns release after a failed test without a second lifecycle form.                                                                                                                                                                         |

`ScratchInterface`'s own members were ruled the same way, and coherence rather than demand decided
them. `ensure` ships because it is the one member that produces an empty directory — `write` always
creates a file. `names` and `link` ship because a fixture that seeds a tree has to list it and to
plant the link the [threat model](#threat-model) names. `remove` ships because `write`, `ensure`, and
`link` each create something and nothing took one of them back short of `destroy()`. `has` renames
the `exists` this interface already carried, so it was never a candidate, and `path`, `write`,
`read`, and `destroy` are what an owned directory is rather than candidates at all.

Some shapes the fleet repeats often are refused anyway, because a primitive already covers them. An
error-recording wrapper is a short delegate to the recorder that already ships. A deferred gate is
native `Promise.withResolvers`. A shared random seed is a bare literal.

The remaining local candidates are element and text requiring (redundant under
`noUncheckedIndexedAccess`), unique naming (hidden module state), socket flushing (an unjustified
constant), the throwing variant of `captureError`, and pattern requiring. Every product-specific
peer, protocol fixture, and domain builder stays in the package that owns it.

### Bounds a shipped helper carries

A shipped helper can still decline the question it looks like it answers. Each bound here belongs to
the helper rather than to the host, and each names what to reach for instead.

- **`holdAccessible` maps through the tester iframe's painted scale and reads `:active` back.** It
  presses the control's centre and releases before refusing a missed press. If that release also
  rejects, the missed-press refusal carries it as its cause. That path can't be driven from inert
  input against a conforming engine, because the marker is built from the coordinates the press
  used; it is covered by review. The measured layout is a single accessible, uniformly scaled tester
  iframe. A covered centre or unsupported geometry can refuse even when the resolver accepts the
  target. The verb inherits the resolver's focus reachability conditions.
- **`releasePointer` parks the pointer outside the page.** It releases at the recorded point first,
  which can produce a click. It then clears hover by moving to (-1, -1) in the runner page's
  coordinates, one pixel above and to the left of that page's viewport. The browser hit-tests
  nothing outside the viewport, so no element takes a `mouseover` event or hover paint from the
  parked pointer until the next pointer verb. This holds even where a staging, scroll, or offset
  lays content over the park point. Register it with `afterEach` before a hover
  or hold. A second release sends no button-up event. Holds must not overlap. A rejected press
  leaves no marker. A rejected release keeps the marker for a retry and still attempts the park. If
  that park also rejects, the park's error surfaces with the release rejection attached in the
  aggregate's errors; the park rejection is its cause.
- **`stageMedia` overrides the provider page, and `releaseMedia` restores the first stage's
  readings.** Pin a base with `{ motion: true }` rather than assuming the host prefers motion.
  `motion: false` stages reduced motion; `print: true` stages print, and `print: false` stages
  screen; `forced: true` stages active forced colours, and `forced: false` stages none. An omitted
  print, motion, or forced axis keeps its effective reading, as does `prefers-color-scheme`. Any
  other emulated feature the provider configured is cleared. An empty `{}`
  refuses. Each staged query has a 1000 ms read-back budget with a 10 ms poll interval; refusal
  restores the carried pre-call readings before throwing and can take two budgets. A restoration
  failure is attached as the refusal's cause. The read-back exhaustion path can't be driven from
  inert input against a conforming engine; its restoration is covered by review and by the shared
  payload code, not by a case. The first stage records print, reduced motion, dark colour scheme,
  and forced colours on the tester root under `MEDIA_STAGE`, as a bit string in that order (`1` for
  a match, `0` otherwise). Later stages keep that marker. Release restores those readings as
  explicit emulation rather than removing every override, waits per axis for its recorded value, and
  removes the marker. A release whose wait exhausts keeps `MEDIA_STAGE` on the tester root, so the
  next `releaseMedia` retries from the same recorded readings. A release with nothing staged clears
  every override and compares readings taken strictly after the reset until they are stable.
  Stability doesn't prove the engine's own baseline. Each release read-back has a 1000 ms budget and
  waits for a frame per poll, with 10 ms between polls. The budget is checked between polls, so a
  frame that never paints is not bounded by it. Media scopes must not overlap. The browser project
  runs files serially.
- **`readStyle` refuses a pseudo argument rather than ignoring it.** The argument must start with
  `::` before the engine's selector-support check runs. A supported pseudo-element with no value for
  the requested property still reads as an empty string. `readPixels` uses the same guard.
- **`sendProtocol` reaches a Chromium-family provider alone.** It needs the provider's DevTools
  session, passes the named command and parameters through, and discards the response. Browser
  termination cannot promise cleanup. Edge observations belong to a separate run.
- **`parseCSSColor` resolves an undeclared token to the inherited color.** A `var()` naming a custom
  property nothing declares is not a parse failure: the cascade accepts it and computes the
  inherited color, so `parseCSSColor('var(--absent)')` hands back channels rather than `undefined`.
  Read `readToken` or `readRootToken` where a missing token is the subject.
- **`createLoopback` cannot take back an upgraded socket.** A server that claims an upgrade keeps
  that connection, detached from the server itself, so `destroy()`'s `closeAllConnections` never
  reaches it and the close waits on it. A fixture that upgrades records the socket its `upgrade`
  handler took and destroys it before destroying the loopback.
- **`destroyScratch`'s behavior under a permission hold is unproven where the hold cannot bind.** The
  retry path is proven against a real host refusal, and a host that produces no such refusal cannot
  exercise it: a container running as uid `0` bypasses the access check the mode bits describe, so
  the suite reads a runtime probe and skips that case rather than asserting either answer. Read
  `supportsMode` for the narrower question of whether the bits are stored at all.
- **`createRecorders` keys its map from the events array's declared element type.** An array declared
  with a wider union than its contents widens `TName` past the events actually listed, so the omitted
  key reads `undefined` at runtime under a non-optional type and `isRecorderMapComplete` still reports
  `true`, because it checks the events it was given rather than the type it was keyed by. Pass a
  literal array or a tuple, so the element type is exactly what was listed.
- **`createStorage` answers through its methods and intercepts no named-property access.** The store
  is a real `Storage`, and `Storage` declares an index signature, so `store.theme` typechecks with no
  cast and reads `undefined` while `getItem('theme')` answers. A property write lands on the object
  rather than in the store, so it consumes no quota, meets no withheld permission, and is invisible
  to every read. Drive the code under test through `getItem` and `setItem`, which is where the seed,
  the quota, and the grant are.
- **`readProperty`'s `TypeError` names the target, never the read.** It refuses a target that is
  neither an object nor a function before it reads anything, and a getter that throws on an accepted
  target hands that throw straight to the caller. Wrap the call in `captureError` where a hostile
  getter is the subject.
- **`readPixels` reports a measured contribution rather than a parsed length.** A resolved value
  carrying no leading number — `'auto'`, `'none'`, `''` — reads as `0`, because none of them
  contributes a pixel to what a reader sees, so a caller cannot tell an unparsable value from a
  genuine zero. Read the text with `readStyle` where that distinction is the subject.
- **`isRendered` and `isReachable` read an ancestor attribute inside the element's own tree.** Each
  asks `closest` for the `aria-hidden` ancestor and the `[inert]` ancestor, and `closest` never
  crosses a shadow boundary, so a host carrying either attribute is invisible to a subject inside its
  shadow root — in an open root and a closed one alike. What the flat tree decides still reaches the
  subject: a host the document does not lay out takes the element off the page, and both predicates
  refuse it. Read a `true` for a shadow subject as the element's own answer, and ask the host
  separately where an ancestor attribute is the subject.
- **`isReachable` finds an open modal through the `aria-modal` attribute in the element's own
  document.** Two arrangements carry no such attribute there, and each leaves the page behind it
  reachable: a native `<dialog>` opened with `showModal`, which a browser makes modal without
  marking it, and a dialog declared inside a shadow tree, which a document query does not return.
  Containment itself does cross a boundary, because the subject's host chain is judged beside the
  subject, so a dialog holding a host holds that host's shadow content too. Read `:modal` or the
  dialog's own root where a native or shadow-declared dialog is the subject.
- **`waitForAnimations` waits on the animations a browser reports as running.** A finished animation
  filling its target stays in the list and is already at rest, a paused one is at rest too and
  nothing here resumes it, and an animation declaring infinite iterations never finishes. Each is
  left out, so a wait that resolves is a claim about the paint that was moving rather than about the
  list being empty. Read `element.getAnimations({ subtree: true })` directly where the membership of
  that list is the subject.
- **`readHit` answers for one point, and a node it returns is no proof of a cover.** An element the
  document does not render measures a zero rectangle at the origin, and a zero-area element measures
  a point on its own edge, so each is hit-tested like any other point and names whatever paints
  there — the surrounding container, or the document body for a rectangle collapsed at the origin —
  while `contains` reads false. A cover painted with `pointer-events: none` is absent from the hit
  test, so the reading names the element underneath it and the caller reads reachable for a cover a
  person can see. An element inside a shadow tree retargets in an open root and a closed one alike:
  the document-level hit test names the host, which the inner element does not contain. Run
  `isRendered` and `isReachable` first, and ask `element.getRootNode()` for its own
  `elementFromPoint` where the subject sits in a shadow tree. `undefined` carries the other silence:
  a centre outside the viewport reads the same as a centre that reaches nothing, and
  `isOutsideViewport` does not separate them, because it asks whether the whole rectangle misses the
  viewport while this asks where one point lands.

## Patterns

### Record calls without a spy

A recorder is a real callback, so the code under test is driven exactly as a consumer drives it.
`clear()` truncates in place, which is what lets a captured reference stay correct.

```ts
import { createRecorder } from '@orkestrel/test'

const recorder = createRecorder<[id: string, size: number]>()
recorder.handler('a', 1)
recorder.handler('b', 2)
recorder.count // 2
recorder.calls // [['a', 1], ['b', 2]]

const captured = recorder.calls
recorder.clear()
recorder.count // 0
captured.length // 0 — the same array, truncated
recorder.handler('c', 3)
recorder.count // 1 — still usable
```

### Record an emitter's events

One call subscribes a recorder to each event you name and hands back a map keyed by those names. In
the following fence, `createLoader` returns a loader that emits `read` for every file it reads and `fail`
for every file it cannot.

```ts
import { createRecorders } from '@orkestrel/test'

type LoaderEvents = {
	readonly read: readonly [path: string]
	readonly fail: readonly [reason: string, retryable: boolean]
}

const loader = createLoader()

// A concrete class is no inference site for the event map, so this call names both type arguments.
const recorders = createRecorders<LoaderEvents, 'read' | 'fail'>(loader, ['read', 'fail'])

await loader.scan('src')

recorders.read.count // 2
recorders.read.calls // [['src/index.ts'], ['src/types.ts']]
recorders.fail.calls // [['locked', true]]
```

Where the source arrives as a parameter typed `EventSourceInterface<TMap>`, the same call infers both
type arguments and names neither.

```ts
import type { EventSourceInterface } from '@orkestrel/test'
import { createRecorders } from '@orkestrel/test'

function record(source: EventSourceInterface<LoaderEvents>) {
	// `TMap` infers from the parameter and `TName` from the array.
	return createRecorders(source, ['read', 'fail'])
}
```

The interface asks for the subscribe half alone, so any source carrying a typed `on` satisfies it,
whatever else it publishes. A duplicate event name installs a fresh recorder for each occurrence and
the map keeps the last one, so name each event once unless the duplicate subscription is the subject.

### Count the listeners on a signal

`createSignal` hands back a real `AbortController`, its signal, and the tally of abort listeners
standing on that signal at this moment. The tally is what a leak is asserted against: a recorder
reports what one listener heard, and only the tally reports what is still installed.

```ts
import { createRecorder, createSignal, waitForAbort } from '@orkestrel/test'

const instrument = createSignal()
instrument.count // 0

const heard = createRecorder<[event: Event]>()
instrument.signal.addEventListener('abort', heard.handler)
instrument.count // 1
instrument.signal.addEventListener('abort', heard.handler)
instrument.count // 1 — the same callback and capture mode register once

const parked = waitForAbort(instrument.signal)
instrument.count // 2

const scoped = createRecorder<[event: Event]>()
const lifetime = new AbortController()
instrument.signal.addEventListener('abort', scoped.handler, { signal: lifetime.signal })
instrument.count // 3

lifetime.abort()
instrument.count // 2 — the scoped registration left when its own lifetime aborted

instrument.controller.abort()
await parked
instrument.count // 1 — the one-shot listener left the tally when it fired
heard.count // 1
scoped.count // 0 — its lifetime ended before the abort it was waiting for

instrument.signal.removeEventListener('abort', heard.handler)
instrument.count // 0 — removal takes the original callback, not the wrapper
```

A registration leaves the tally on removal, on a one-shot delivery, and when a signal scoping it
aborts. An `addEventListener` call whose scope has already aborted installs nothing and records
nothing, so it never enters the tally at all.

Read `instrument.count` where you want the reading. It is a getter over the live registrations, so a
number pulled out by destructuring is the tally as it stood at that line and stops tracking.

### Number the resources a fixture allocates

`createResourceFactory` answers the question a leak test asks — what was created, what was destroyed,
and in what order — without the fixture keeping its own arrays.

```ts
import { createResourceFactory } from '@orkestrel/test'

const resources = createResourceFactory()

const first = resources.create() // 1
const second = resources.create() // 2
resources.destroy(first)

resources.created.calls // [[1], [2]]
resources.destroyed.calls // [[1]]
resources.created.count - resources.destroyed.count // 1 — what the fixture still holds
```

The id is the creation record's length plus one, so it counts allocations rather than live resources
and a destroyed id is never reissued. `destroy` records the id it was given and frees nothing, so it
accepts an id that was never created and an id destroyed twice; assert on the record rather than
expecting a refusal. Clearing `created` restarts the numbering at `1`, which is why the recorders are
read rather than cleared mid-test.

### Capture a throw, then assert on it

Assert on what came back, not on the fact that something came back. `undefined` is both "nothing was
thrown" and "`undefined` was thrown", and the helper cannot tell you which.

```ts
import { captureError } from '@orkestrel/test'

const thrown = captureError(() => JSON.parse('{'))
thrown instanceof SyntaxError // true

captureError(() => 'fine') // undefined — the thunk completed
captureError(() => {
	throw undefined
}) // undefined — the same result, from a thunk that threw

// An async thunk returns a rejected promise instead of throwing, so nothing is captured
// and the rejection escapes. Await the call and catch it yourself.
```

### Narrow without `!` or `as`

`requireValue` passes a falsy value through unchanged and throws only on `null` or `undefined`.

```ts
import { requireValue } from '@orkestrel/test'

requireValue(0) // 0
requireValue('') // ''
requireValue(false) // false
requireValue(undefined) // throws Error: Value is required
requireValue(null, 'port is required') // throws Error: port is required
```

### Cross an unchecked boundary

`invokeUnchecked` and `readProperty` are the door out of a typed program and into a value nothing
declares. Each refuses its own argument first, makes the unchecked access, and hands the result back
under the type the caller named. In the following fence, `handle` comes back from a foreign module that
ships no declarations.

```ts
import { invokeUnchecked, readProperty } from '@orkestrel/test'

const close: unknown = readProperty(handle, 'close')
invokeUnchecked<void>(handle, close, [])

const label = readProperty<unknown>(handle, 'label')
typeof label === 'string' // narrow what came back before asserting on it

readProperty<string>(handle, 'absent') // undefined — nothing checks that the key is there
invokeUnchecked<void>(handle, 'close', []) // throws TypeError: Method must be callable
readProperty<string>(null, 'label') // throws TypeError: Target must be an object or function
```

The claim is yours. `readProperty<string>` narrows nothing at runtime, so a test that goes on to
assert on the value reads it back as `unknown` and guards it, and a test that only drives the foreign
object claims `void` and asserts on what the driving produced. That is the whole reason these ship:
a consumer that bans `as` and `!` still has to reach a value the compiler cannot see, and this is the
one named place where that happens.

### Flatten headers into one record

`flattenHeaders` turns any header initializer into a frozen plain record, so a header assertion is
one `toStrictEqual` rather than a walk. Hand it a real response's own `headers`, a record, or an
entries array.

```ts
import { flattenHeaders } from '@orkestrel/test'

flattenHeaders({ 'Content-Type': 'application/json' }) // { 'content-type': 'application/json' }

flattenHeaders([
	['x-run', '1'],
	['X-Run', '2'],
]) // { 'x-run': '1, 2' } — one name, its values combined

Object.isFrozen(flattenHeaders(new Headers({ accept: 'text/plain' }))) // true
```

The normalization is the host `Headers` constructor's own, so a record, an entries array, and a
`Headers` value all answer the same way, and a name's case never decides whether an assertion
matches. `HeadersSource` is that accepted input, derived from the constructor rather than named from
a library, so it resolves the same in every project this package compiles under.

### Drain an async source

`collect` and `collectStream` drain an async iterable and a readable stream into arrays, in yield
order.

```ts
import { collect, collectStream } from '@orkestrel/test'

async function* letters() {
	yield 'a'
	yield 'b'
}

await collect(letters()) // ['a', 'b']

const stream = new ReadableStream<number>({
	start(controller) {
		controller.enqueue(1)
		controller.enqueue(2)
		controller.close()
	},
})

await collectStream(stream) // [1, 2]
```

### Wait for a named condition

Pick the member by what publishes the fact you are waiting for. Reach for `waitForCondition` when
nothing publishes it and the test has to read for it. Reach for `retryUntil` when the reading itself
is the value you want and producing it can fail. Reach for `waitForEvent` when the fact does publish
an event, because parking on it beats reading for it. The wait-family contract states why a test
instrument polls where a product must not.

Name the wait in every case. The description is what the timeout message carries, and a wait nobody
described times out saying nothing about what failed.

In the following fence, `isBuilt` reports whether a build running outside the test has produced its
artifact, `origin` is the URL of a server the test started, and `child` is a process it spawned.

```ts
import { retryUntil, waitForCondition, waitForEvent } from '@orkestrel/test'

// Nothing publishes an event for "the build finished", so read until the reading holds.
await waitForCondition('artifact is on disk', () => isBuilt(), { budget: 2000, interval: 25 })

// The reading itself is the value you want, and the producer throws until the port answers.
const body = await retryUntil(
	'health endpoint answers',
	async () => (await fetch(`${origin}/health`)).text(),
	(text) => text === 'ok',
	{ budget: 2000, attempts: 20 },
)
body // 'ok' — the first produced value the predicate accepted

// An event exists, so park on it. The cleanup the subscriber returns runs on delivery, on timeout,
// and on abort alike.
const [code] = await waitForEvent<[number]>((listener) => {
	child.on('exit', listener)
	return () => {
		child.off('exit', listener)
	}
}, 'child exits')
code // 0
```

The two throw the other way round, which is what makes the pair worth having. A condition that
throws is a broken reading, and taking it again does not make it true, so `waitForCondition` hands
the throw straight on. A producer that throws is what a retry exists for, so `retryUntil` counts it
as an unsatisfied attempt and hands the last one to the exhaustion error's `cause`.

```ts
import { retryUntil, waitForCondition } from '@orkestrel/test'

const unreachable = new Error('registry unreachable')

// waitForCondition: the condition's throw is the rejection, by identity.
const refused: unknown = await waitForCondition('never holds', () => {
	throw unreachable
}).catch((reason: unknown) => reason)
refused === unreachable // true

// retryUntil: the producer's throw is an attempt, and the last one rides the exhaustion error.
const exhausted: unknown = await retryUntil(
	'registry answers',
	(): string => {
		throw unreachable
	},
	() => true,
	{ budget: 30, interval: 10 },
).catch((reason: unknown) => reason)
if (exhausted instanceof Error) {
	exhausted.message.startsWith('Retry "registry answers" did not succeed within 30ms') // true
	exhausted.cause === unreachable // true — the last producer throw, kept as the cause
}
```

Every bounded member takes an `AbortSignal` and rejects with the signal's own reason, so one
controller ends a whole file's waits. A budget of `0` still permits the immediate first reading, and
a bound that is not finite and non-negative is refused before anything is read.

### Wait for a sentence to arrive

A journey waits for what a person reads, and the reading is yours to scope: a whole page, one named
region, or a value a host-independent test computes. A screen replacing one sentence with another
passes through a frame carrying both, so name the departing sentence in `absent` and the wait
resolves on the reading that carries one and not the other.

```ts
import { waitForText } from '@orkestrel/test'

let painted = 'Signed out'
setTimeout(() => {
	painted = 'Signed out Signed in'
}, 10)
setTimeout(() => {
	painted = 'Signed in'
}, 30)

await waitForText('the session line replaces the prompt', () => painted, 'Signed in', {
	absent: 'Signed out',
	budget: 2000,
}) // 'Signed in' — the reading that satisfied the poll

// Throws Error: Text expectation must not be empty
await waitForText('anything', () => painted, '')
```

`waitForCondition` owns the poll, so the bounds, the timeout voice, and the abort reason are that
helper's, and a reader that throws stops the wait rather than counting as a reading that did not
satisfy it. Pass `exact` where the reading must be the sentence rather than carry it. Scope the
reading as narrowly as the claim: a wait over the whole page resolves on the sentence wherever it
lands, which is rarely what a journey means.

### Copy a JSON value

This demonstration builds an interface-typed value, copies it through JSON serialization, and
shows the guard `roundTripJSON` raises on a non-finite member.

```ts
import { captureError, roundTripJSON } from '@orkestrel/test'

// An interface, not a type alias: the bound is a projection rather than an index signature, so an
// interface-typed value copies and keeps its own type.
interface Snapshot {
	readonly name: string
	readonly tags: readonly string[]
}

const original: Snapshot = { name: 'a', tags: ['x'] }
const copy: Snapshot = roundTripJSON(original)
copy // { name: 'a', tags: ['x'] }
copy.tags === original.tags // false — fresh references all the way down

// roundTripJSON(new Date()) — does not compile; a member JSON cannot carry is typed `never`.

roundTripJSON(-0) // 0 — JSON has no negative zero
captureError(() => roundTripJSON({ a: [{ b: NaN }] }))
// Error: JSON values must contain finite numbers — at any depth, rather than a silent null
```

### Prove a guard is total

Every member throws on a naive read or violates a naive structural assumption. A total guard
survives every member without throwing. Whether it accepts or refuses one is that guard's own
contract. Run the whole corpus, attribute a throw or wrong answer to the loop index, and compare
with the answer that guard's contract requires for that member.

The fence is the body of a parameterized consumer test. `guard` is the total guard under test, and
`expected` is its readonly list of required answers in corpus order.

```ts
import { expect } from 'vitest'
import { createHostileValues } from '@orkestrel/test'

const values = createHostileValues()
expect(expected.length).toBe(values.length)

for (const [index, value] of values.entries()) {
	let accepted: boolean | undefined
	expect(() => {
		accepted = guard(value)
	}, `hostile value ${index}`).not.toThrow()
	expect(accepted, `hostile value ${index}`).toBe(expected[index])
}
```

The corpus is the positive proof input. Keep a negative control for every member too: perform the
naive read or the naive structural reading that member is meant to break, and prove it answers the
way the member's own hostility says. Without that control, an inert value can make the totality loop
look stronger without exercising another hostile boundary.

This package's own suite carries one control per member, in corpus order, and each names the reading
that member breaks:

- the self-referential record — `JSON.stringify` throws on the cycle;
- the revoked proxy — `Reflect.ownKeys` throws;
- the property proxy — reading a named property throws;
- the key proxy — `Reflect.ownKeys` throws;
- the prototype proxy — `Object.getPrototypeOf` throws;
- the null-prototype record — a direct `hasOwnProperty` call throws;
- the array-target proxy — `Array.isArray` answers `true` and an index read throws;
- the self-referential array — `JSON.stringify` throws on the cycle;
- the sparse array — its enumerable keys are fewer than its `length`, and nothing throws;
- the hidden-key record — its enumerable keys are fewer than its own keys, and nothing throws;
- the named getter — reading the property it declares throws.

The sparse array and the hidden-key record are why the corpus is not described as a set of throwing
values: each answers a naive reading with a wrong number rather than with an exception, which is the
failure a totality loop alone would not surface.

### Prove a wire fixpoint

A wire fixpoint proves that a consumer's parser and serializer reproduce canonical bytes after the
wire has crossed an untrusted JSON boundary. This is **not** `roundTripJSON`: that helper makes a
typed JSON copy and returns the copied value. No wire-fixpoint export exists, because the comparison
is the consumer's assertion over its own codecs. In this consumer-test fence, `schema` is the local
fixture and `parseSchema` and `serializeSchema` are its local codecs.

```ts
import { expect } from 'vitest'
import { requireValue } from '@orkestrel/test'

const wire = JSON.stringify(serializeSchema(schema))
const received = requireValue(parseSchema(JSON.parse(wire)))

expect(JSON.stringify(serializeSchema(received))).toBe(wire)
```

### Drive a statechart table

A statechart table is a row per transition, and a row is the transition plus the three phases that
prove it: `arrange` puts the entity into `from`, `act` applies the `event`, and `assert` reads the
entity for `to`. `executeScenarios` walks the table and hands each row a context of its own; it
registers nothing, so `describe` and `it` stay where you write them.

The entity in the following fences is a real one, and the fences are the table this package's own
browser suite runs. It is a native disclosure with two doors: the summary toggles it, and a Dismiss
button closes it and does nothing when it is already closed. That second door is what gives the
table a row whose event leaves the state where it found it, which a lone `<details>` cannot have —
its one event always flips. Every value these fences claim is pinned in
`tests/src/browser/factories.test.ts`, because the fences drive a browser and the `guides` project
runs with the browser disabled.

The phases are module functions the whole table shares, which is the shape a table of any size
wants: each phase reads its subject from its own parameters rather than from the row it belongs to,
so one set of three serves every row.

```ts
import type { StateScenario } from '@orkestrel/test'
import { executeScenarios, requireValue } from '@orkestrel/test'
import { clickAccessible, clickDisclosure, readStates, render } from '@orkestrel/test/browser'
import { expect, it } from 'vitest'

type DisclosureState = 'closed' | 'open'
type DisclosureEvent = 'toggle' | 'dismiss'

interface DisclosureContext {
	readonly summary: HTMLElement
}

// A journey verb resolves its own target by accessible name, so two mounted disclosures called
// "Advanced" are an ambiguity rather than a second fixture. Each build takes the previous one out.
let mounted: HTMLElement | undefined

function buildDisclosure(): DisclosureContext {
	mounted?.remove()
	const container = render(
		'<details><summary>Advanced</summary><p>Every setting.</p></details><button type="button">Dismiss</button>',
	)
	const details = requireValue(container.querySelector('details'))
	requireValue(container.querySelector('button')).addEventListener('click', () => {
		details.open = false
	})
	mounted = container
	return { summary: requireValue(container.querySelector('summary')) }
}

function readDisclosure(context: DisclosureContext): DisclosureState {
	return readStates(context.summary).includes('expanded') ? 'open' : 'closed'
}

async function arrangeDisclosure(
	context: DisclosureContext,
	state: DisclosureState,
): Promise<void> {
	if (readDisclosure(context) !== state) await clickDisclosure('Advanced')
}

// The context is unused because a journey verb finds what a person reads rather than a node this
// row was handed.
async function actOnDisclosure(_context: DisclosureContext, event: DisclosureEvent): Promise<void> {
	if (event === 'toggle') await clickDisclosure('Advanced')
	else await clickAccessible('Dismiss')
}

function assertDisclosure(context: DisclosureContext, state: DisclosureState): void {
	expect(readDisclosure(context)).toBe(state)
}

const SCENARIOS: ReadonlyArray<StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>> =
	[
		{
			transition: {
				name: 'closed opens through the summary',
				from: 'closed',
				event: 'toggle',
				to: 'open',
			},
			arrange: arrangeDisclosure,
			act: actOnDisclosure,
			assert: assertDisclosure,
		},
		{
			transition: {
				name: 'open closes through the summary',
				from: 'open',
				event: 'toggle',
				to: 'closed',
			},
			arrange: arrangeDisclosure,
			act: actOnDisclosure,
			assert: assertDisclosure,
		},
		{
			transition: {
				name: 'open closes through the button',
				from: 'open',
				event: 'dismiss',
				to: 'closed',
			},
			arrange: arrangeDisclosure,
			act: actOnDisclosure,
			assert: assertDisclosure,
		},
		{
			// The row whose event leaves the state where it found it.
			transition: {
				name: 'closed stays closed through the button',
				from: 'closed',
				event: 'dismiss',
				to: 'closed',
			},
			arrange: arrangeDisclosure,
			act: actOnDisclosure,
			assert: assertDisclosure,
		},
	]

it('walks the disclosure statechart', async () => {
	await executeScenarios(SCENARIOS, buildDisclosure)
})
```

Name each row for the door it drove. A table that names only the states reads as if one mechanism
moved the entity, and the row that matters most here is the one where the button leaves the
disclosure exactly as it found it — a name saying which control was pressed is what separates that
row from the toggle rows beside it.

Both unions are the entity's own vocabulary, so a row naming a state or an event the entity does not
have fails to typecheck rather than at runtime.

The rows run one after another, because a statechart's rows drive one entity and a parallel run
would have them arranging over each other. The run stops at the first row that fails, and the row's
name opens the message — a table runs under one test name, so a bare assertion message never says
which row produced it. A builder that refuses stops the run the same way and its row's name opens
that message too, because a fixture is built under the same test name its phases run under.

```ts
const MISMATCHED: ReadonlyArray<
	StateScenario<DisclosureState, DisclosureEvent, DisclosureContext>
> = [
	{
		// Nothing about the row is malformed and the phases are the table's own; the `to` state is
		// the part the event cannot reach, so only `assert` can catch it.
		transition: {
			name: 'the summary leaves it closed',
			from: 'closed',
			event: 'toggle',
			to: 'closed',
		},
		arrange: arrangeDisclosure,
		act: actOnDisclosure,
		assert: assertDisclosure,
	},
]

await executeScenarios(MISMATCHED, buildDisclosure)
// Error: the summary leaves it closed: expected 'open' to be 'closed'

await executeScenarios(MISMATCHED, () => {
	throw new Error('no fixture')
})
// Error: the summary leaves it closed: build refused
```

Whatever the phase threw arrives as that error's `cause`, by identity, so an assertion's own detail
survives the renaming. A phase that throws something other than an `Error` is named by its type —
`arrange refuses: threw a non-error object value` — and the value itself is still the `cause`. A
builder's refusal arrives as the `cause` the same way, and the phases of the row it was building for
never start.

`buildRefusal` builds that refusal sentence, and `createHarness` announces the same one on the row
it refused, so the runner and the harness name a refused build once rather than twice.

```ts
import { buildRefusal } from '@orkestrel/test'

buildRefusal('the summary leaves it closed', new Error('no fixture')).message
// 'the summary leaves it closed: build refused'
```

Drive one row on its own with `executeScenario`, which takes the context rather than building it.

`createHarness` renders that same table in a browser and drives it row by row, publishing its
progress through the attributes a gate outside the page polls. It takes the table, the builder, and
one reader that reports the state the entity is in.

```ts
import { STATECHART_ATTRIBUTES } from '@orkestrel/test'
import { createHarness } from '@orkestrel/test/browser'

const harness = createHarness({
	scenarios: SCENARIOS,
	build: buildDisclosure,
	state: readDisclosure,
})

harness.status // 'idle' — mounted, nothing run yet
harness.total // 4

await harness.execute()

harness.status // 'passed'
harness.passed // 4
harness.failed // 0
harness.failures // []

// The object reads its own markup, so a gate polling the page and a test asserting on the object
// cannot disagree.
harness.root.getAttribute(STATECHART_ATTRIBUTES.status) // 'passed'
harness.root.getAttribute(STATECHART_ATTRIBUTES.total) // '4'

harness.destroy()
```

The harness writes the attributes onto its own markup: `status`, `passed`, `failed`, and `total` on
its root, `scenario` and `result` on each row, `state` on the element rendering the entity's current
state. A `role="status"` announcer narrates each step in a sentence beside them, so the page reads
as a report rather than as a grid of attributes. A gate reads the root until `status` reads `passed`
or `failed`, then reads the tally and names each row whose `result` reads `failed`. That reading
always arrives, because every exit writes it: a run a `state` reader ends writes `failed` before it
rejects, so the gate is never left polling a `running` the harness does not leave. Neither side
spells a `data-statechart-*` string of its own, so the two cannot drift apart.

`STATECHART_ATTRIBUTES` and `STATECHART_STATUSES` publish those names and those readings, and
`StatechartStatus` is the same set of readings as a named union.

```ts
import { STATECHART_ATTRIBUTES, STATECHART_STATUSES } from '@orkestrel/test'

STATECHART_ATTRIBUTES.status // 'data-statechart-status'
STATECHART_ATTRIBUTES.scenario // 'data-statechart-scenario'

STATECHART_STATUSES[0] // 'pending' — carried until every declared row has rendered
STATECHART_STATUSES.includes('running') // true
```

A run walks the tuple in the order it is written. `pending` covers construction, so a gate that
reads it has found a harness whose rows never mounted; `idle` is a mounted harness with its tally at
zero; `running` is a run in flight; and `passed` and `failed` are the pair a gate waits for rather
than waiting a fixed duration. A run that a `state` reader ends writes `failed` and then rejects
with that reader's value by identity, so the pair covers an exceptional exit as well as a completed
one, and the row that reader was called for is not counted as failed.

`execute` carries on past a failing row, which is where the harness parts company with
`executeScenarios`: one run reports on the whole table rather than stopping at the first finding,
and a builder that refuses fails its own row under `buildRefusal`'s sentence, the one that runner
raises. What decides whether a row's phases run is whether its builder returned rather than what it
returned, so a table whose context is `undefined` drives every phase of every row. Call `execute`
again to re-run the same table from a fresh tally and a cleared state.

### Read a source inventory

The pairing `resolveRoot` and `readInventory` is what a guides-parity suite needs: the workspace
root from `import.meta`, then the file map. The `readInventory` contract states what an exclusion
matches; the last call that follows is the part that surprises people.

```ts
import { resolveRoot } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'

// From tests/guides.test.ts, one directory up is the workspace root.
const root = resolveRoot(import.meta)

Object.keys(readInventory(root, ['src/core'], { extensions: ['.ts'] }))
// ['src/core/constants.ts', 'src/core/factories.ts', 'src/core/helpers.ts',
//  'src/core/index.ts', 'src/core/types.ts', 'src/core/validators.ts']

// A named file is included whatever `extensions` says, so one call takes the root files a suite
// needs and the source tree it walks.
Object.keys(readInventory(root, ['package.json', 'src/core'], { extensions: ['.ts'] }))
// ['package.json', 'src/core/constants.ts', 'src/core/factories.ts', 'src/core/helpers.ts',
//  'src/core/index.ts', 'src/core/types.ts', 'src/core/validators.ts']

Object.keys(
	readInventory(root, ['src/core'], {
		extensions: ['.ts'],
		exclude: ['src/core/index.ts'],
	}),
)
// ['src/core/constants.ts', 'src/core/factories.ts', 'src/core/helpers.ts',
//  'src/core/types.ts', 'src/core/validators.ts']

// A directory key takes every key below it.
Object.keys(readInventory(root, ['src'], { extensions: ['.ts'], exclude: ['src/server'] }))
// ['src/browser/constants.ts', 'src/browser/factories.ts', 'src/browser/helpers.ts',
//  'src/browser/index.ts', 'src/browser/types.ts', 'src/core/constants.ts',
//  'src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts',
//  'src/core/validators.ts']

// An exclusion also applies to a target you name, so naming one file below an excluded directory
// does not reinstate it.
readInventory(root, ['src/core/index.ts'], { extensions: ['.ts'], exclude: ['src/core'] })
// {} — take the exception in a second call, and merge the two maps
```

### Own a temporary directory

This demonstration builds a scratch directory seeded with a file, writes and reads inside it,
refuses an escaping write, and nests one allocation inside another.

```ts
import { createScratch } from '@orkestrel/test/server'

const scratch = createScratch({ prefix: 'guide-', files: { 'src/index.ts': 'export {}\n' } })

scratch.read('src/index.ts') // 'export {}\n'
scratch.has('src') // true
scratch.read('src') // throws Error: Scratch path is a directory: src
scratch.read('missing.ts') // undefined
scratch.write('../escape.ts', '') // throws Error: Path outside scratch directory: ../escape.ts

// `write` answers the contained path it wrote, the way `ensure` and `link` answer theirs, so the
// path goes straight to the code under test without joining it again.
scratch.write('src/notes.ts', 'export {}\n') // `${scratch.path}/src/notes.ts`

// `ensure` is how you get an empty directory, because every `write` creates a file.
scratch.ensure('empty')
scratch.names() // ['empty', 'src']
scratch.names('empty') // []

// `parent` puts the allocation somewhere other than the host temporary directory.
const child = createScratch({ parent: scratch.path, prefix: 'child-' })
scratch.names().length // 3 — 'empty', 'src', and the child allocation
child.destroy()
scratch.names().length // 2 — the child removed itself and nothing else

// `link` creates the symbolic link the threat model names, and `read` follows it. A directory
// source runs on a host that creates no symbolic link too; see "Hosts that create no symbolic
// link" for what such a host does with a file source.
const outside = createScratch({ prefix: 'outside-', files: { 'read.ts': 'export {}\n' } })
scratch.link('gate', outside.path) // `${scratch.path}/gate` — the link's own path, not its destination
scratch.read('gate/read.ts') // 'export {}\n' — read through the link, at its destination

// A link pointing out of the allocation is resolved through, so a contained path acts outside it.
scratch.ensure('gate/made') // `${scratch.path}/gate/made` — the lexical path, not the destination
outside.names() // ['made', 'read.ts'] — the directory was made under `outside.path`
scratch.names('gate') // ['made', 'read.ts'] — the same entries, listed through the link

// `link` acts at the final segment rather than through it, so `gate` is occupied.
scratch.link('gate', outside.path) // throws Error: EEXIST: file already exists

// `has` reads the final segment without following it, and `read` follows it.
scratch.link('dangling', 'missing.ts')
scratch.has('dangling') // true — the link is there
scratch.read('dangling') // undefined — what it points at is not

// `remove` takes one contained entry and acts at the final segment, so a link goes and whatever it
// pointed at stays. A missing target is a no-op.
scratch.remove('dangling')
scratch.has('dangling') // false
scratch.remove('missing.ts') // no throw — there was nothing there
scratch.remove('src') // the directory and everything under it
scratch.names() // ['empty', 'gate']

scratch.destroy()
scratch.destroy() // no-op — destroy is idempotent
outside.has('made') // true — destroy unlinks `gate` and leaves what it pointed at
outside.destroy()
```

`destroy()` is synchronous, and it already outlasts the short `EPERM` a Windows host reports for a
directory a recently exited child held as its working directory: `removeTree` retries that removal ten
times 100 milliseconds apart, which bounds the blocking wait at roughly a second. Nothing extra is
needed for a child the test has already reaped.

Reach for `destroyScratch` where the hold outlasts that second — a holder still running, a host
still flushing, a network filesystem taking its time. It retries `destroy()` inside a budget that
defaults to `10000` milliseconds at a `25` millisecond interval, awaits between attempts instead of
blocking the thread, takes a `signal` that ends the wait early, and hands the host's own last
refusal back as the exhaustion error's `cause` when the directory is never released. Every refusal
is retried, not a named list of codes, so a fault no wait can clear costs the whole budget before it
surfaces.

```ts
import { createScratch, destroyScratch } from '@orkestrel/test/server'

const workspace = createScratch({ prefix: 'build-' })

// The child that had `workspace.path` as its working directory is still shutting down.
await destroyScratch(workspace) // resolves as soon as the host lets the directory go
```

### Give everything back in one hook

Register the cleanup where you take the resource, then let one hook run all of it. The list reverses
registration order, so each handler runs while what it depends on is still standing.

```ts
import { afterEach, it } from 'vitest'
import { createTeardown } from '@orkestrel/test'

const teardown = createTeardown()

// This package registers no hook of its own, so the consumer writes this line once.
afterEach(() => teardown.destroy())

it('runs its cleanup newest-first', async () => {
	const order: string[] = []
	teardown.add(() => {
		order.push('opened first')
	})
	teardown.add(async () => {
		await Promise.resolve()
		order.push('opened second')
	})
	teardown.count // 2

	await teardown.destroy()
	order // ['opened second', 'opened first'] — reversed, and each awaited before the next
	teardown.count // 0 — the list is empty, so the hook shown earlier then runs nothing
})
```

### Answer a real request on a loopback port

This demonstration starts a real server on an ephemeral loopback port, fetches from it, and closes
it idempotently.

```ts
import { createServer } from 'node:http'
import { createLoopback } from '@orkestrel/test/server'

// The server is yours, so every route, header, and status stays yours.
const server = createServer((_request, response) => {
	response.end('ok')
})

const loopback = await createLoopback(server)

loopback.url === `http://127.0.0.1:${loopback.port}` // true — IPv4 loopback, no trailing slash
loopback.port > 0 // true — the host picked it; this package neither picks nor reserves a number

const response = await fetch(loopback.url)
await response.text() // 'ok'

await loopback.destroy() // drops any live connection, then closes
await loopback.destroy() // undefined — destroy is idempotent
server.listening // false
```

### Request an HTTP upgrade

`requestUpgrade` drives a real client upgrade request at a loopback port and reports what the server
did with it. The fixture keeps every socket its `upgrade` handler took, because an upgraded
connection is detached from the server and `loopback.destroy()` cannot reach it.

```ts
import type { Duplex } from 'node:stream'
import { createLoopback, requestUpgrade } from '@orkestrel/test/server'
import { createServer } from 'node:http'

const detached: Duplex[] = []
const server = createServer((request, response) => {
	response.statusCode = 426
	response.end('upgrade required')
})
const loopback = await createLoopback(server)

try {
	// With no upgrade handler installed, the plain handler answers and the client reads that answer.
	await requestUpgrade(loopback.port, { path: '/socket' })
	// { claimed: false, status: 426 } — the refused arm carries the status alone

	server.on('upgrade', (request, socket) => {
		detached.push(socket)
		// The silent path takes the socket and answers nothing, which is what the budget ends.
		if (request.url !== '/socket') return
		socket.write(
			'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: ledger.v2\r\n\r\n',
		)
	})

	const claimed = await requestUpgrade(loopback.port, {
		path: '/socket',
		protocols: ['ledger.v2', 'ledger.v1'],
	})
	// { claimed: true, protocol: 'ledger.v2' } — the claimed arm carries the subprotocol alone
	if (claimed.claimed) claimed.protocol // 'ledger.v2'; `status` does not exist on this arm

	await requestUpgrade(loopback.port, { path: '/silent', budget: 50 })
	// rejects: Upgrade request to 127.0.0.1:<port>/silent was not answered within 50ms
} finally {
	for (const socket of detached) socket.destroy()
	await loopback.destroy()
}
```

Narrow on `claimed` before reading the detail, because each arm carries only its own member: the
refused arm carries `status` and no subprotocol, and the claimed arm carries `protocol` — `undefined`
there says the server selected none rather than that it refused — and no status at all. A closed port
rejects with the client's own `ECONNREFUSED` rather than reporting a refusal, and a server that
accepts the connection and answers nothing rejects on the budget, which defaults to `1000`
milliseconds and names the port and path it was waiting on.

### Probe what the host supports

Gate a proof on the mechanism it needs rather than on the platform name. Each probe allocates its own
directory, attempts the operation, reads the result back, and removes what it made.

```ts
import { createScratch, supportsFileLinks } from '@orkestrel/test/server'
import { expect, it } from 'vitest'

it.skipIf(!supportsFileLinks())('reads a file through a link', () => {
	const scratch = createScratch({ files: { 'source.txt': 'linked' } })
	try {
		scratch.link('gate.txt', 'source.txt')
		expect(scratch.read('gate.txt')).toBe('linked')
	} finally {
		scratch.destroy()
	}
})
```

Pick the probe whose question is the one the proof rests on. `supportsDirectoryLinks` and
`supportsFileLinks` split where an unprivileged Windows host does: it makes a directory junction and
refuses a file link. `supportsCase` and `supportsBytes` answer for the filenames a walk can meet, and
`supportsMode` answers whether a permission bit is stored rather than whether it is enforced. Nothing
is remembered between calls, so a probe reads the host as it stands when the decision is taken.

### Replay response cookies

`fetch` sends no cookie back on its own, so a test driving a session across requests has to carry
the `Cookie` header itself. `createCookieJar` takes that header off real `Set-Cookie` fields rather
than off a string the test wrote, so the flow under test is the one the origin actually asked for.

The boundary is name-only, and it is deliberate. The jar selects by cookie name and reads past
`Domain`, `Path`, `Expires`, and `Secure`; a field spelling `Max-Age=0` deletes its cookie and every
other field stores or replaces one. That is enough to drive one controlled fixture origin, which is
what this jar is for, and it is not a user agent's cookie store: it enforces no scope, honours no
expiry, and nothing in it outlives the jar. Drive a real browser wherever the scoping rules are the
claim.

In the following fence, `loopback` is the origin the preceding section bound, and its `/session`
route answers with real `Set-Cookie` fields.

```ts
import { createCookieJar } from '@orkestrel/test/server'

const jar = createCookieJar()

// Signing in sets the session on a real response; `capture` returns those fields unmodified.
const signIn = await fetch(`${loopback.url}/session`, { method: 'POST' })
jar.capture(signIn) // ['session=abc; Path=/; HttpOnly', 'theme=dark; Max-Age=600']
jar.read('session') // 'abc'
jar.header // 'session=abc; theme=dark' — in the order the jar first met each name

// The next request carries what the origin set, so the fixture sees the session it issued.
const profile = await fetch(`${loopback.url}/profile`, { headers: { cookie: jar.header ?? '' } })
await profile.text() // 'signed in'

// Signing out is `Max-Age=0`, in whatever case and spacing the origin spells it.
jar.capture(await fetch(`${loopback.url}/session`, { method: 'DELETE' }))
jar.read('session') // undefined
jar.header // 'theme=dark'
```

### Refuse an escaping path in your own fixture

`readInventory` and `createScratch` refuse an escape with this predicate. Reach for it when a
fixture of your own resolves a caller-supplied path below a root.

```ts
import { createScratch, resolveContained } from '@orkestrel/test/server'

const scratch = createScratch({ files: { 'src/index.ts': 'export {}\n' } })
const root = scratch.path

resolveContained(root, 'src/index.ts') // `${root}/src/index.ts`
resolveContained(root, `${root}/src/index.ts`) // `${root}/src/index.ts` — absolute and inside
resolveContained(root, '../escape.ts') // undefined — lexically outside
resolveContained(root, `${root}/../escape.ts`) // undefined — absolute and outside
resolveContained(root, '/etc/passwd') // undefined — absolute and outside

scratch.destroy()
```

### Build and mount a fixture

`build` makes the element, `mount` attaches it, and `render` is the pair in one call. Register the
removal as you go: nothing here records what it created, and a browser test file shares one page, so
a fixture left behind is the next test's resolver ambiguity.

```ts
import { createTeardown } from '@orkestrel/test'
import { build, mount, render } from '@orkestrel/test/browser'
import { afterEach } from 'vitest'

const teardown = createTeardown()
afterEach(() => teardown.destroy())

const panel = mount(
	build('section', { classes: 'surface', attributes: { 'aria-label': 'Ledger' } }),
)
teardown.add(() => panel.remove())

// Built and appended inside the mounted panel, so it resolves against the shipped cascade.
panel.append(build('button', { classes: 'primary', text: 'Save', attributes: { type: 'button' } }))

const markup = render('<button type="button">Save</button>') // the attached container
const heading = render('h2', 'title') // the attached element itself, typed as HTMLHeadingElement
teardown.add(() => markup.remove())
teardown.add(() => heading.remove())
```

Mount before measuring. An unmounted element inherits no custom property, resolves against no rule,
and lays out no box, so `readStyle`, `readToken`, and `readPixels` each answer with the initial
value — which reads as a styling defect rather than as a detached node — and `readContrast` refuses
the element outright, because its computed foreground color does not exist. `build` sets its `text`
as text rather than as markup, so a `<` in it stays a `<`; write the fixture as markup where the
fixture is markup.

### Drive an interface the way a person does

Every verb finds its own target, so a journey names what a person names. Nothing here takes an
element, and nothing dispatches a constructed event.

```ts
import {
	clickAccessible,
	clickAccessibleWithin,
	readPerception,
	readValue,
	traverseAccessible,
	typeAccessible,
} from '@orkestrel/test/browser'

await typeAccessible('Runs', '3')
readValue('textbox', 'Runs') // '3' — the value the control renders, not the state behind it

// Role first when a bare name answers for more than one element. A tab and its own panel collide
// by construction, because the panel is labelled by the tab.
await clickAccessible('tab', 'Drafts')

// Region first when a short verb repeats, or when a rendered status completes the name.
await clickAccessibleWithin('Ledger', 'button', 'Monthly income')

// Focus arrives the way the interface offers it. Nothing calls element.focus().
await traverseAccessible('Evaluate')

readPerception('Run') // one visible named region, whitespace collapsed, hidden-but-read text kept
```

### Hold a control and read the pressed paint

Register pointer cleanup before a test can fail. This fixture declares `padding-top: 16px` on its
`Apply` button and `32px` under `:active`. Read the paint while the button is held, then release it.

```ts
import {
	holdAccessible,
	readPixels,
	releasePointer,
	resolveAccessible,
} from '@orkestrel/test/browser'
import { afterEach } from 'vitest'

afterEach(releasePointer)
const button = resolveAccessible('button', 'Apply')
readPixels(button, 'padding-top') // 16
await holdAccessible('button', 'Apply')
readPixels(button, 'padding-top') // 32
await releasePointer()
readPixels(button, 'padding-top') // 16
```

Where a twin elsewhere on the page carries the same name, hold the one inside a named region with
`holdAccessibleWithin('Ledger', 'button', 'Apply')`, which composes `resolveAccessibleWithin` with
`driveHold`; `traverseAccessibleWithin` composes the same resolver with `driveTraversal`, and each
refuses before it sends any input.

### Read a pseudo-element's paint

This fixture declares `padding-top: 0` on its `Marked` button and `7px` on its generated `::after`
pseudo-element. Keep the element reading beside the pseudo reading so dropping the argument fails.

```ts
import { readPixels, readStyle, resolveAccessible } from '@orkestrel/test/browser'

const button = resolveAccessible('Marked')
readStyle(button, 'padding-top', '::after') // '7px'
readPixels(button, 'padding-top', '::after') // 7
readStyle(button, 'padding-top') // '0px'
```

### Emulate reduced motion and print

This fixture's `Media` button declares `padding-top: 1px`, `2px` under reduced motion, and `3px`
under print. Pin the base preference, then read each staged axis. Stage the inverse of the observed
motion reading before release so the restore comparison can fail. The initial unstaged release
clears overrides and waits for stable readings. The final release returns the readings observed
before the first stage, kept as explicit emulation. A further unstaged release clears that emulation.

```ts
import { readPixels, releaseMedia, resolveAccessible, stageMedia } from '@orkestrel/test/browser'
import { afterEach } from 'vitest'

afterEach(releaseMedia)
await releaseMedia()
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const button = resolveAccessible('Media')
await stageMedia({ motion: true })
readPixels(button, 'padding-top') // 1
await stageMedia({ motion: false })
readPixels(button, 'padding-top') // 2
matchMedia('(prefers-reduced-motion: reduce)').matches // true
await stageMedia({ motion: reduced })
matchMedia('(prefers-reduced-motion: reduce)').matches === !reduced // true
readPixels(button, 'padding-top') === (reduced ? 1 : 2) // true
await stageMedia({ print: true })
readPixels(button, 'padding-top') // 3
matchMedia('print').matches // true
await releaseMedia()
matchMedia('print').matches // false
matchMedia('(prefers-reduced-motion: reduce)').matches === reduced // true
readPixels(button, 'padding-top') === (reduced ? 2 : 1) // true
```

### Send a key to what holds focus

Bring focus about through a verb, then send the sequence. A key sent while the document body holds
focus reaches no control, and every assertion after it reads the surface the key never touched, so
that case is refused rather than sent.

```ts
import { pressKeys, traverseAccessible } from '@orkestrel/test/browser'

await traverseAccessible('Evaluate')
await pressKeys('{Enter}') // the key reaches the control focus landed on

if (document.activeElement instanceof HTMLElement) document.activeElement.blur()

// Throws Error: Key sequence "{Escape}" was sent with nothing focused
await pressKeys('{Escape}')
```

Escaping is yours, because the sequence is the subject: `{` opens a key name and `[` opens a code
name. Reach for `typeAccessible` where the text is the subject and the key syntax is in the way.

### Wait for what a control announces

Wait on what a person is told, not on the class names a stylesheet happens to use. `waitForState`
resolves the control afresh on every reading, so a re-rendered node is still the subject, and
returns the states it read at resolution.

```ts
import { clickAccessible, waitForState } from '@orkestrel/test/browser'

await clickAccessible('Pin note')
await waitForState('Pin note', 'pressed=true') // ['pressed=true']

// The other direction, for a state that has to go away.
await clickAccessible('Filters')
await waitForState('button', 'Filters', 'expanded', { absent: true }) // ['collapsed']
```

Spell the state the way `readStates` reports it. The exhaustion message names the control, the
state, and the states last read, so a wait that ran out says what the control was announcing
instead. Where the surface announces nothing, the finding is the surface's: give the trigger its
`aria-expanded`, `aria-pressed`, or `aria-busy` rather than waiting on a framework's classes.

### Wait for the paint to stop moving

A reading taken while paint is moving reports an interpolated frame no state of the interface
paints. In the following fence `panel` transitions its `color` over 120ms.

```ts
import { readContrast, readStyle, waitForAnimations } from '@orkestrel/test/browser'

panel.classList.add('settle-done')

await waitForAnimations(panel, { budget: 2000 })

readStyle(panel, 'color') // 'rgb(0, 0, 0)'
readContrast(panel) // measured against the settled paint rather than a frame in between
```

The wait parks on each animation's own `finished` promise and reads the list again after each
completion, so an animation a finishing one starts is waited on too. An animation declaring infinite
iterations is left out, which is what lets a page carrying a spinner settle at all. A detached
element is refused rather than reported settled.

### Read the refusal instead of catching it

Absent, present-but-gated, and ambiguous are different findings about an interface, so assert on the
sentence rather than on a boolean. `readRefusal` drives the resolver and hands back its message, or
nothing at all when the target resolves.

```ts
import { readRefusal } from '@orkestrel/test/browser'

readRefusal('Save changes') // undefined — the control resolves
readRefusal('Menu') // 'Interactive target "Menu" is not visible and focus-reachable'
readRefusal('Nowhere') // 'No interactive element has the accessible name "Nowhere"'
readRefusal('Drafts') // 'Interactive target "Drafts" is ambiguous across 2 elements'
readRefusal('tab', 'Drafts') // undefined — the role disambiguates it
```

Compare the whole sentence. A comparison against a fragment of one passes for a refusal about a
different condition, which is the finding the distinct voices exist to keep apart.

### Drive a field the component listens to

Drive a field by name wherever the keystrokes are part of what the journey claims. Reach for these
where the test already holds the element and the subject is what the component does with the value.

```ts
import { requireValue } from '@orkestrel/test'
import { commitInput, render, typeInput } from '@orkestrel/test/browser'

const container = render('<input aria-label="Runs" value="0">')
const field = requireValue(container.querySelector('input'))

typeInput(field, '3') // one bubbling `input`, with the value already set when a listener reads it
field.value // '3'

commitInput(field, '4') // one `input`, then one `change`, both bubbling
field.value // '4'

// Each dispatched event is a plain `Event`. Nothing here constructs an `InputEvent`.

container.remove()
```

`typeInput` dispatches no `change`, which is the split: a component that acts on every keystroke
hears `input` alone, and one that waits for the field to be committed needs `commitInput`. Each
dispatched event is a plain `Event`, never an `InputEvent`, so a component reading `inputType` or
testing `instanceof InputEvent` reads neither off them. Neither sends a keystroke either, so a
component reading `key`, composition, or selection receives nothing from them — `typeAccessible` is
the door for all of those.

### Measure what a reader sees

`readContrast` measures the ratio between an element's rendered text and what is actually behind it,
not between the two colors its own rule declares. It walks the ancestors from the element up to the
first opaque layer and composites them top over bottom, so a 3% surface tint reads as a tint over
what shows through it. A translucent foreground then resolves against that effective background
before luminance is measured.

The `floor` parameter is the opaque color that walk ends on, and omitting it is deliberately strict.
Omit it and every stack the floor would still show through is refused — the one where nothing from
the element upwards paints, and the one whose painted layers are all translucent — because assuming
a white canvas turns "this surface declares no background" into a number that reads like a
measurement. Supply it and the same stack composites onto it instead. Supply `CANVAS_COLOR` for a
document a browser paints onto its own canvas, and the color a fragment is really mounted onto
everywhere else. A floor is what you know the surface sits on, rather than a fallback for not
knowing.

```ts
import { requireValue } from '@orkestrel/test'
import { CANVAS_COLOR, readContrast, render } from '@orkestrel/test/browser'

const surface = render('<main style="background:#fff"><p style="color:#767676">Ready</p></main>')
const text = requireValue(surface.querySelector('p'))

readContrast(text).toFixed(2) // '4.54' — measured against the white the ancestor really paints
readContrast(text) >= 4.5 // true — the WCAG 2.x floor for body text

// A fragment with no painted ancestor is refused rather than assumed.
const fragment = render('<p style="color:#767676">Ready</p>')
const orphan = requireValue(fragment.querySelector('p'))
readContrast(orphan) // throws Error: Computed background color is unavailable

// Name the surface it is really on, and the same stack measures.
readContrast(orphan, CANVAS_COLOR).toFixed(2) // '4.54'
```

`readRing` is the same reading for focus chrome, and it reads only: focus arrives through
`traverseAccessible`, `userEvent.keyboard` from `vitest/browser`, or a real click, and this measures
what the browser painted after it landed. It reports `undefined` for a control that is not matching
`:focus-visible`, for one left the browser's own `outline-style: auto` ring, and for a focus style
that only repaints the control's fill — in each case no measurement taken here would be about focus.

```ts
import { requireValue } from '@orkestrel/test'
import { readRing, traverseAccessible } from '@orkestrel/test/browser'

const focused = await traverseAccessible('Evaluate')
readRing(focused) // the ratio the painted outline or box-shadow reaches against its backdrop

// Some controls are two elements. `worn` names the one the chrome is painted onto.
readRing(focused, requireValue(document.querySelector('label[for="evaluate"]')))
```

### Read the tokens and colors a theme declares

`readToken` and `readRootToken` read what the cascade resolved, and `parseCSSColor` resolves any
color expression by asking the same browser. In the following fence the document declares
`--ink: rgb(1, 2, 3)` on `:root`, `.card` sets `padding-left: 12px`, and `card` is a mounted inline
element carrying that class, so its `width` resolves to `auto`.

```ts
import {
	matchesColor,
	readPixels,
	readRootToken,
	readToken,
	parseCSSColor,
} from '@orkestrel/test/browser'

readRootToken('ink') // 'rgb(1, 2, 3)'
readRootToken('--ink') // 'rgb(1, 2, 3)' — the dashes are optional
readToken(card, 'ink') // 'rgb(1, 2, 3)' — inherited from `:root` by a mounted element
readToken(card, 'absent') // '' — an undeclared token reads as a token declared empty does

parseCSSColor('var(--ink)') // [1, 2, 3, 1]
parseCSSColor('rebeccapurple') // [102, 51, 153, 1]
parseCSSColor('not-a-color') // undefined — the CSSOM refused the expression
matchesColor('rebeccapurple', 'rgb(102, 51, 153)') // true
matchesColor(readToken(card, 'ink'), 'rgb(1, 2, 3)') // true

readPixels(card, 'padding-left') // 12
readPixels(card, 'width') // 0 — a width resolving to `auto` carries no number
```

Assert on the value rather than on presence. An absent token and one declared empty both read as
`''`, and `parseCSSColor` resolves a `var()` naming an undeclared property to the inherited color
rather than refusing it, so a test that means to catch a missing token compares what `readToken`
returned.

### Find a rule in the cascade

Assert on the stylesheet where the stylesheet is the subject, and on `readStyle` where the rendered
result is. In the following fence the cascade declares `.card { padding: 8px }` inside a media query, and
an animation named `slide` carrying a `from` stop and a `to` stop.

```ts
import { findKeyframes, findRule, readRules } from '@orkestrel/test/browser'

findRule('.card')?.style.getPropertyValue('padding') // '8px'
findRule('.never-declared') // undefined

findKeyframes('slide')?.cssRules.length // 2
findKeyframes('slid') // undefined — an animation name matches exactly

readRules().filter((rule) => rule instanceof CSSKeyframesRule) // every animation the cascade declares
```

`findRule` matches its argument as a substring of the whole selector text, so `findRule('.card')`
finds `.card`, `.card:hover`, and `.panel > .card` alike; pass more of the selector to narrow it.
Both finders read through `readRules`, which expands a media query, a supports block, a layer, and a
nested style rule level by level, so a top-level rule is always met before a rule nested inside an
earlier one. That descent reaches a grouping rule and nothing else, and a `@keyframes` rule is not
one: the last line of the fence finds the `@keyframes` rule itself because the walk collects it where
it sits, and the keyframe stops inside it never appear in that list, which is why `findKeyframes` is
the door to them. A rule either finder returns may still be overridden by another, which is why a
claim about what a reader sees is asserted through `readStyle`, `readToken`, `readPixels`, or
`readContrast` instead.

### Read the classes and styles the markup carries

Two readings answer whether rendered markup uses the design system or works around it. `readCascade`
reads what the stylesheets define and `readClasses` reads what the markup carries, so the set
difference between them is the authored-class census: the classes the markup uses and no loaded
stylesheet declares. `extractStyles` collects the markup of everything that styles itself instead —
an inline `style` attribute, wherever it sits, and a `<style>` element, whatever it holds.

In the following fence the cascade declares `.card` and nothing else, and `section` is the rendered
`<section class="card">`.

```ts
import { extractStyles, readCascade, readClasses } from '@orkestrel/test/browser'

// <section class="card">
//   <p class="lead" style="color: red">Ready</p>
//   <style>.late { color: blue }</style>
// </section>

const authored = readClasses(section)
authored.has('card') // true — the root's own classes count
authored.has('lead') // true

// `readCascade` reads what the stylesheets define and `readClasses` reads what the markup carries,
// so their set difference is the authored-class census.
const undeclared = [...authored].filter((name) => !readCascade().has(name))
undeclared // ['lead'] — no loaded stylesheet declares it

extractStyles(section)
// ['<p class="lead" style="color: red">Ready</p>', '<style>.late { color: blue }</style>']
```

Both readers take a `ParentNode`, so a detached element and a `DocumentFragment` work as well as an
attached tree, and a `DocumentFragment` contributes its descendants alone because it is not an
element. Every class is read through `classList` rather than through `className`, which is what makes
an SVG element count the same as an HTML one: `className` on an SVG element is an `SVGAnimatedString`
rather than a string.

Nothing but an inline declaration is reported. A class and a `data-*` attribute name something the
cascade resolves, so neither is reported however unusual it looks, and an inline `style` on a
`<path>` inside an SVG is reported because a namespace changes nothing about what an inline
declaration is. A `style` attribute holding nothing but whitespace declares nothing and is read past.

The `extractStyles` reading is named for what it returns rather than `extractEscapes`, because the
`escape` term already carries the encoding sense in the `@orkestrel/html` and `@orkestrel/console`
packages.

### Take an authored-class census

`readClasses` differenced against `readCascade` is the check every workspace writes; what each of
them omits is the population it walked. `readCensus` reports both, and refuses a walk that read no
element, because an empty walk reports the same empty difference as markup whose every class the
cascade declares.

```ts
import { buildCensus, readCensus } from '@orkestrel/test/browser'

const control = buildCensus()
screen.append(control.root)

const census = readCensus(screen)
census.elements // 4 — the screen, the control's root, and the two marked elements
census.undeclared // [control.mark, control.token] — sorted, the SVG one included
```

The control is the point of the fixture. One token rides on an HTML element and the other on an SVG
element, whose `className` is an `SVGAnimatedString` rather than a string, so a census blind to the
second reports one token where two are carried and reads as a clean screen.

### Control a reading before you trust it

An instrument is not evidence until its control has failed. Each builder returns detached nodes for
you to append where you are reading and remove afterwards, so nothing is mounted for you.

```ts
import {
	buildContrast,
	buildEscapes,
	extractStyles,
	mount,
	readContrast,
} from '@orkestrel/test/browser'

const contrast = buildContrast(4.5)
mount(contrast.root)
readContrast(contrast.refused) < 4.5 // true
readContrast(contrast.accepted) >= 4.5 // true
contrast.root.remove()

const escapes = buildEscapes('project-stylesheet')
extractStyles(escapes.root).length // 3

// Throws Error: Contrast control cannot straddle the bar 21
buildContrast(21)
```

`buildContrast` is translucent over an opaque floor, so the compositing walk and the alpha blend
`readContrast` exists for are the things under test: a reader taking the nearest declared background
at full strength answers the opposite pair. The greys are searched rather than written down, so the
stack follows the bar you asked for, and a bar no stack can straddle is refused rather than returned
as a control that proves nothing.

`buildEscapes` carries the inline-attribute branch of a style-escape reading and the embedded-element
branch, plus a `<style>` carrying the id a project exempts, so a reading that passes by refusing
every `<style>` element fails that exemption instead of clearing it. Its root stays detached, which
is what keeps an embedded sheet out of the cascade every other reading measures against.

### Withhold a store the way a host does

A browser with site data blocked refuses every operation the permission withholds, and an origin
with no room left refuses `setItem`. `createStorage` makes both reachable against a real `Storage`
surface, backed by a map of its own: it patches neither browser surface and dispatches no `storage`
event.

```ts
import { buildDenial, createStorage } from '@orkestrel/test/browser'

const storage = createStorage({ values: { theme: 'dark' }, reads: false, quota: 1 })

// Throws DOMException named SecurityError: Access is denied for getItem "theme"
storage.getItem('theme')

storage.permit() // the grant a person allowing site data performs
storage.getItem('theme') // 'dark'

storage.setItem('theme', 'light')
// Throws DOMException named QuotaExceededError: No room is left for scale
storage.setItem('scale', '2')

buildDenial('length').name // 'SecurityError'
```

`length`, `key`, and `getItem` are reads; `clear`, `removeItem`, and `setItem` are writes. `quota`
counts accepted `setItem` calls rather than bytes, because the number of writes is what a journey
scripts. `removeItem` consumes none of it and `permit` replenishes none of it: room and permission
are different refusals, and a test that granted the permission still meets the full origin.

### Remove an IndexedDB database

Close the connections the test opened, then delete. A live connection blocks the deletion, and the
block is a rejection rather than a wait. In the following fence, `connection` is the `IDBDatabase` the
test opened.

```ts
import { removeDatabase } from '@orkestrel/test/browser'
import { afterEach } from 'vitest'

// Runs after a failed test as well as a passing one, whether or not the test opened anything.
afterEach(() => removeDatabase('ledger'))

await removeDatabase('never-created') // resolves — deleting an absent database succeeds

connection.close()
await removeDatabase('ledger')

// With that connection still open, the same call rejects instead:
// Error: IndexedDB database "ledger" is blocked by an open connection
```

The rejection is the point. A suite that swallowed the block would leave the next test reading the
previous test's records through a database that reports itself deleted, so the connection holding it
open is handed back to the caller that owns it.

### Record a browser journal

A journal records what a scenario did and everything the page said while it did it. It is the
evidence a failing journey hands back: the steps in order, beside the console lines and uncaught
failures the surface produced under them.

Wrap the scenario in `try`/`finally` and stop the journal in the `finally`. `start` replaces the
console channels, so a scenario that throws before an unguarded `stop` leaves this journal's
wrappers standing for every later test in the file.

```ts
import { clickAccessible, createJournal, readPerception } from '@orkestrel/test/browser'
import { expect, it } from 'vitest'

const journal = createJournal()

it('evaluates a draft', async () => {
	journal.start()
	try {
		await clickAccessible('button', 'Evaluate')
		journal.record('click', 'Evaluate', readPerception('Run'))

		expect(journal.steps).toStrictEqual([
			{ action: 'click', trigger: 'Evaluate', result: 'Scored 3 of 3' },
		])
		expect(journal.output).toStrictEqual([]) // the page logged nothing and threw nothing
	} finally {
		journal.stop()
	}
})
```

The journal contract is the one behind that: the journal forwards every console call to the channel
that was there when it started, so a run under a journal prints exactly what it prints without one,
and `stop` puts those same function references back by identity. `record` does nothing while the
journal is stopped, so a step taken before `start` or after `stop` is not recorded, and `steps` and
`output` hand out snapshots. There is no shared instance: create one journal per scenario.

### Place a capture portfolio

The registry is declared once, the run renders one variant, and the same expansion answers both
"what must exist" and "what did".

```ts
import { createPortfolio, expandCaptures } from '@orkestrel/test/browser'

const states = ['start-empty', 'answer-ideal']
const variants = [
	{ name: 'light-1440', width: 1440, height: 1000 },
	{
		name: 'dark-390',
		width: 390,
		height: 844,
		apply: () => document.documentElement.setAttribute('data-theme', 'dark'),
	},
]

const portfolio = createPortfolio({
	states,
	variants,
	variant: 'dark-390',
	directory: '../../../tmp/capture/states',
	// This example is an enabled capture run. A real suite can supply its own gate here.
	enabled: true,
})

expandCaptures(states, variants).length // 4 — the registry times the variants
portfolio.files // the same four names, so a proof compares one expansion against the disk

// Placed from inside the journey that reached the state, right after the assertion that proves it.
await portfolio.place('start-empty')
// A run that omits `enabled` returns undefined here, resizes nothing, and records nothing.

portfolio.place('answer-partial') // rejects: Capture state "answer-partial" is not registered
```

### Measure a document's content edge

A capture stages the pane at the height the document needs, and the body's box cannot answer for
that height once the pane is taller than the document. In the following fence the document holds
1600 rows of fixed content and nothing is bound to the viewport.

```ts
import { measureContent, releasePane, stagePane } from '@orkestrel/test/browser'

await stagePane(390, 844)
measureContent() // 1600 — the row the last content ends on
document.documentElement.scrollHeight // 1600 — the box, which is the content under this pane

await stagePane(390, 2356)
measureContent() // 1600 — unchanged, because nothing in the document moved
document.documentElement.scrollHeight // 2356 — the box, stretched to the pane

await releasePane()
```

The second pair is what the reading exists for. Every box a document exposes — the body's rectangle,
`body.scrollHeight`, `body.offsetHeight`, `documentElement.scrollHeight` — is the larger of the
content and the pane, so a caller that has staged too tall a pane reads that pane back and cannot
descend from it. `measureContent` walks the elements inside the body instead, so it descends. Where
the document is laid out against the viewport, it moves with the viewport and reports what the
reflow produced rather than what the pane claimed, except inside a frame that clips its overflow,
where a viewport-bound child ends at the frame's clip edge. The `clipsOverflow` helper names the
frames that count, and the `readClipEdge` helper reads each frame's clip edge. An `overflow-y`
value of the `hidden` keyword, the `auto` keyword, or the `scroll` keyword ends at the padding box.
The `clip` keyword and a paint containment over a
`visible` overflow end at the box the frame's `overflow-clip-margin` value selects, the padding box
by default, expanded by the margin the `readClipMargin` helper reads.

### Read a written frame back

A capture is a claim about pixels, so prove it against the pixels. In the following fence the
document declares `html { background: rgb(0, 128, 0) }` on its root element and carries content
shorter than a 390x844 pane.

```ts
import { captureFrame, readFrame } from '@orkestrel/test/browser'

const written = await captureFrame({
	path: '../../../tmp/capture/frame/read.png',
	width: 390,
	height: 844,
})

const reading = await readFrame(written)
reading.width // 390 — the pane's width, in device pixels
reading.height // 844 — the pane's height, because this document is shorter than the pane
reading.floor // 'rgb(0, 128, 0)' — the document's own background, all the way down
```

The floor is what separates a covered frame from a clipped one. The rows a capture cannot paint are
the runner's own page rather than the document, so a clipped frame reads `'rgb(255, 255, 255)'`
there while every style in the document still resolves to the background it declared. Shoot the same
document at a taller fixture and the reading answers for the whole of it and no more: the height is
the content edge `measureContent` read, and the floor is that same background. A bottom row painting
more than one color — a split gradient, a two-column footer — reports `undefined` rather than
picking one of them.

### Practices

- **Adopt one helper at a time.** Replace a package's local recorder, then its delay, then its
  temporary directory. Nothing here re-exports another package's symbol, so each swap is
  independent.
- **Take the cleanup list before the resources.** `createTeardown` is what makes the rest of the
  owned family safe to reach for, because one hook then releases everything the test took.
- **Import by environment.** Reach for `@orkestrel/test` first; drop to `@orkestrel/test/server`
  only for the filesystem helpers, and to `@orkestrel/test/browser` only inside a browser test
  project.
- **Let the journey layer be the only door.** A journey that works around a missing helper by
  reaching for a selector is a layer defect. Add the capability here instead.
- **Keep the helper out of the assertion.** `captureError` converts a throw into a value and
  `requireValue` converts absence into a throw; the test still does the asserting.
- **Replace a fixed sleep with a named wait.** A `waitForDelay(500)` guarding a fact is a guess that
  is either slower than it needs to be or shorter than the slowest host, and it reports nothing when
  it fails. Name the fact instead, and let `waitForCondition`, `retryUntil`, or `waitForEvent` decide
  when it holds.
- **Let `readInventory` refuse.** A symlinked root or an escaping target is an error, not a
  filtered result, so a misconfigured walk fails loudly instead of returning a short map.
- **Reach for `parent` only when the allocation must be somewhere named.** The default keeps it out
  of the repository, and a path inside a package tree is walked by every tool that reads that tree.

## Tests

Each entry names the contracts its file proves. The test names carry the cases.

- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — the `captureError`,
  `requireValue`, `roundTripJSON`, and wait-family contracts, plus `waitForDelay` against a real
  elapsed interval and `resolveRoot` against the calling file. The wait
  family takes its bounds and its throw directions: `waitForCondition` takes an immediate read
  under a zero budget, a later read that holds, an asynchronous condition, the timeout naming the
  condition and the budget, a condition throw propagated unchanged, an abort that rejects with the
  signal's reason and stops reading, a true reading taken after the final interval, and the refused
  bounds. `retryUntil` takes a first satisfying attempt and a later one, the exact satisfying value,
  exhaustion by attempts and by budget, producer throws counted as attempts with the last one kept as
  the cause, a predicate throw propagated unchanged, and an aborted retry. `waitForEvent` takes the
  exact delivered tuple, a timeout and an abort each naming the cleanup they invoked, and a second
  delivery ignored after settlement. `waitForText` takes a reading that arrives on a later poll, the
  containing reading its `exact` arm must refuse beside the whole reading that arm accepts, the frame
  carrying both the arrival and the departure that `absent` waits past, an empty expectation and an
  empty departure each refused, a reader throw propagated unchanged, the timeout naming the wait and
  the budget, an abort rejecting with the signal's own reason, and a refused bound raised through the
  family. `decodeJSONLines` takes empty input, a trailing newline, CRLF,
  line order, primitive lines, and a malformed physical line named with the native `SyntaxError` as
  its cause. `collect` and `collectStream` drain an empty and an ordered source, and the stream's
  reader lock is released afterwards. `roundTripJSON` takes a copy of a flat and a nested
  interface-typed value with fresh references, a record of `unknown` values, the projection's `never`
  at an opaque `object` member and at a symbol-keyed one, `undefined`, a function, and a symbol
  refused at depth under an `unknown` member, a `Date` under one copied as its serialized string, the
  non-finite refusal at every depth and through `JSON.rawJSON`, the `-0` normalization, and a large
  array and object copied without exceeding the host's argument limit. The leaves the wait family
  shares take their own inputs: `checkBounds` takes a zero and a positive bound, each refused budget
  and interval named for the subject it was given, and the budget named first where both are
  invalid; `buildRetryExhausted` takes the message with and without a rendered last value and the
  cause kept by identity; `dropRegistration` takes a scoped registration dropped with its cleanup
  aborted, an unscoped one carrying no cleanup, and a listener the list does not hold, which changes
  nothing. The statechart runners drive a real disclosure: `executeScenario` takes the phase order
  with each phase's own part of the transition, an asynchronous act awaited before the assertion,
  and — as the control drawn from outside the passing table — a row whose `to` state the event
  cannot reach, failing at `assert` with the row's name opening the message and the assertion kept
  as the `cause`, beside a non-error throw named by its type and handed back as the `cause`
  unchanged. `executeScenarios` takes a table walked in written order against a fresh context per
  row, a builder called for the row it is building and awaited when it returns a promise, and a run
  stopped at the first failing row with the rows after it never started.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — the truncating
  `clear()`, `createTeardown`, and `createHostileValues` contracts. `createRecorder` records typed
  tuples in call order, and truncates a `calls` array the test
  captured before the `clear()`. `createTeardown` takes newest-first order across synchronous and
  asynchronous handlers, a synchronous throw and an asynchronous rejection each rethrown by identity
  with every remaining handler still run, both together aggregated in run order, a handler added
  during a run kept for the next call, the count reset before the handlers run, and a `destroy()`
  that is called empty and called twice. `createHostileValues` proves a naive-reader failure for
  every member, frozen and fresh membership, and one total guard's benign and hostile answers with
  loop-index attribution.
- [`tests/src/browser/helpers.test.ts`](../tests/src/browser/helpers.test.ts) — the journey-layer,
  role-map, and announced-half-and-clickable-half contracts across the layer, in real Chromium
  against constructed markup. The resolver takes a bare name, a
  role that disambiguates a tab from its own panel, a name no element carries, a name carried only by
  a role outside `ACCESSIBLE_ROLES`, and the disabled, hidden, and inert matches that are present but
  gated. It takes the glyph cases against a fixture stylesheet that really paints one: an exact name
  beside an `aria-hidden` icon, the same shape folded so the hidden pass names it unreachable rather
  than absent, a folded control carrying no glyph, the name the page carries nowhere, a short prefix
  that resolves nothing whether the longer name is on screen or folded, and a painted control an
  `aria-hidden` ancestor withholds, refused rather than returned. `computeNamePattern`
  takes a glyph at either edge, the prefix and the trailing word it refuses, regular-expression
  punctuation read as literal text, a requested name whose whitespace is collapsed, and both edges of
  its tolerance. `resolveAccessible` takes a target scrolled into view and one fixed outside the viewport
  that stays there, and `isOutsideViewport` takes a rectangle wholly beyond each edge and one
  straddling an edge. `isReachable` takes a plain control and each condition it drops, a control the
  document no longer holds, a focusable SVG against an element from a foreign namespace, and the
  refused summary that proves it is the one filter the acting verbs apply. It takes the open modal
  dialog through the readings that fix it: the masthead control the dialog leaves behind against the
  same name inside it, which resolves and traverses unambiguously; the control a plain dialog, a
  folded modal, and a blanked modal each leave standing, as the control; the nested dialog and the
  shadow subject that pin containment on the flat tree; and the native `showModal` dialog and the
  shadow-declared modal it reports nothing about, which is the bound the guide states. `isRendered`
  takes each removal a browser honours and, as the split from `isReachable`, a zero-size announced
  control. Each predicate also takes a subject inside an open and a closed shadow root beside a host
  that carries its own ancestor attribute — `[inert]` for one and `aria-hidden` for the other — and a
  host the flat tree does not lay out, which pins where the boundary falls for each.
  `pressKeys` takes a sequence reaching the control a traversal focused and, as the control, the same
  sequence refused while the document body holds focus with no keystroke recorded. `waitForState`
  takes a state a timer flips after the act, a node replaced mid-wait and still resolved by role and
  name, the reverse direction under `absent`, the exhaustion naming the control and the state and
  carrying the states last read, the resolver's own refusal propagated rather than spent as a
  reading, and a refused bound. `waitForAnimations` takes a descendant transition awaited to its end,
  the exhaustion naming the subject and the animation still running, an infinite-iteration animation
  excluded while it is still turning, a detached subject refused, and a refused bound; its settled
  reading is compared against the interpolated one taken mid-transition. `readRefusal` takes the
  absent, gated, and ambiguous voices beside a target that resolves under a bare name and under a
  role, and — as the control for the rethrow — a fixture element whose own `tabIndex` getter refuses
  with a string, handed straight back. `readCensus` takes a population carrying both undeclared
  tokens, tokens sorted rather than left in document order, a subtree whose every class the cascade
  declares, and an empty walk refused. `buildDenial` takes the keyed and unkeyed spellings of its
  `SecurityError`; `buildContrast` takes a composited stack straddling two different bars with the
  flat reading disagreeing for each foreground, and a bar refused at either end; `buildEscapes` takes
  both escapes and the exempt sheet reported, the exemption filtered by id, and a root that stays
  detached; `buildCensus` takes the SVG element whose class list is no string. The barrel takes every
  published name resolved from the specifier a consumer imports, and a bare `JourneyVariant` accepted
  wherever a `CaptureVariant` is asked for.
  `readHit` takes a centre that reaches the element itself, a reachable control under a cover that
  the reading names instead, a soft-wrapped inline target whose two line rectangles leave the box
  centre on its list item, and a control fixed outside the viewport, whose centre reaches nothing.
  Each acting verb takes its happy path and every voice it owns, including both
  region-scoped refusals and both native-disclosure ones; `clickAccessibleWithin` also takes a
  glyph-captioned control inside a region a glyph-carrying heading labels, which is the loose match
  proving unchanged. `traverseAccessible` takes a Tab-reachable
  target; as the cap control, a lone target whose own focus handler blurs it, so focus never lands
  and the cap fails with an empty trail; and, as the cycle control, the same self-blurring target
  behind a reachable decoy, so the traversal completes one cycle and reports the decoy in its trail.
  The page readers take their own inputs: `readPerception` takes one named region including its
  visually hidden text, a region a glyph-carrying heading labels through `aria-labelledby`, a painted
  region an `aria-hidden` attribute withholds, and its not-visible and ambiguous refusals, `readPage`
  the whole page as one
  normalized sentence, and
  `readFocus` a focused control's rendered text, a focused element that renders none, and nothing
  holding focus at all; `readValue` takes a rendered value and a control carrying none. The element
  readers follow: `readText` takes an `aria-hidden` glyph dropped with the runs around it collapsed
  and an element with no text at all; `readRole` takes exactly the tags `IMPLICIT_ROLES` carries and
  one it leaves out, a declared role taken over the implicit one, a section made a region only by
  something naming it, the axis a `th` declares against the column it defaults to, an anchor that is
  a link only while it holds an `href`, a select that becomes a listbox when it offers several rows
  at once, and exactly the input types `FIELD_ROLES` carries against one it leaves out; `readName`
  takes an `aria-labelledby` list joined in order past an id nothing answers for, an `aria-hidden`
  glyph dropped from a content role's text, `aria-label` over inner text, a form control's own
  labels, a button input named by its value, an image named by its alternative text over a `title`
  it also carries, an image carrying no alternative text named by that `title` instead, and the fall
  through to `title` and then to an empty string; `readStates` takes every declared state in one
  order, a native disclosure and a field read from the platform copies rather than from attributes,
  and a control that declares nothing. `describeTree` takes indentation that follows the roles rather
  than the markup, each line's name and states, an unpresented element dropped with its whole
  subtree, and a subtree carrying no role at all; `describeFocus` takes a positive `tabindex` first
  in ascending order before document order, a reachable control the role map does not answer for
  named by its tag, and a subtree with nothing reachable. `waitForFrame` takes the frame callbacks
  already queued, `render` takes parsed fixture markup attached to the document, and `clearStorage`
  takes local and session storage emptied together.
  `readContrast` takes a translucent surface composited onto the opaque layer beneath it, a fully
  opaque stack over different ancestors as the control from outside that population, a stack where
  nothing paints and one whose every painted layer is translucent, a stack 64 translucent layers
  deep whose composite has rounded to the canvas's own channels, a detached element whose computed
  foreground does not exist, and the same unpainted and translucent stacks measured against a
  supplied floor instead of refused. The color leaves beneath it take their own inputs: `parseColor`
  across the legacy and modern syntaxes, a refused keyword, hex triple, empty value, and unsupported
  color space, and — as the control the literals cannot supply — what this browser actually computes
  for a keyword and for a `color-mix()`. `blendColor`, `measureLuminance`, and `measureContrast`
  take their identities, their ordering, and the symmetry of the ratio. `readLayers` takes an
  unpainted stack, a transparent layer left out of a painted one, an opaque layer that ends the
  walk, and the deep stack whose last layer stays translucent while its composite no longer
  separates the floors; `readBackdrop` takes the floor returned by identity, a translucent stack
  composited onto it, and an opaque layer that ends the walk. `readRing` takes a painted outline and
  a painted box-shadow reached through `traverseAccessible`, a control that is not focused, a
  focused control left the browser's own ring, a focus style that only repaints the control's fill,
  and a `worn` element whose reading separates from the control's own. `measureContent` takes a
  1600-row document read under an 844 pane and under a 2356 one, against the scroll height that
  agrees with it under the shorter pane and stretches to the pane under the taller, and a document
  whose last element carries a bottom margin under a body carrying bottom padding, where a reading
  taken from rectangles alone stops 100 rows short. `stagePane` takes the marked pane, the tester
  rendered at the viewport it was given, a release that runs twice without complaining, and a
  release after two stagings that hands back the viewport the tester held before the first;
  `captureFrame` takes a real file written, read back, and matched, with a planted file as the
  comparison's negative control, one element shot rather than the page, and a pane pinned to the
  wrong size by a rule of higher specificity, which is the refusal that also proves the release runs
  on the failing path. It also takes a document taller than the pane, whose frame equals the
  fixture's own declared 1600 rows and ends on the background the document declares rather than on
  the runner's canvas, and a document shorter than the pane, whose frame stays at the pane's height
  on that same floor. The equality is the control that an overshoot adds no rows: a frame taller
  than the document paints the same floor, because the root's background covers whatever canvas the
  pane stretched, so a `>=` assertion reads a 2356-row frame as coverage. The height the shot is
  staged at takes its own cases. A body whose box ends on a quarter of a pixel is measured under the
  staged pane first, so the case reddens on a browser that rounds the other way instead of passing
  quietly, and its frame ends on the fixture's background rather than on the runner's page in the
  row `scrollHeight` rounded away. A full-height panel capped by a media query reflows against the
  taller pane, and its frame covers what the reflow added. A panel holding half the pane over a
  fixed 900-row block converges on 1800 without ever reaching it by restaging at the height last
  read — 1322, then 1561 — and its frame lands on 1800, which is the fixed point written out rather
  than read back from the capture that staged it. The same panel uncapped grows with every pane and
  reaches the refusal, whose written-out restaging bound reddens when the source's bound moves and
  whose pane and viewport are handed back anyway. An element frame takes a fixed `30vh` panel whose
  top lies past the runner's window, shot from a scrolled tester, whose frame is 30% of the declared
  height on the panel's own color with the scroll handed back; an element below both the pane and
  the window, whole on the document's floor with the scroll handed back; a `50vh` element and a
  `30vh` element below the fold, at the declared pane rather than a grown one; an element taller
  than the pane, in a pane of its own height; an element that outgrows every pane, refused with the
  pane and the scroll handed back; a second tester frame the offset leaves in place; and a frame
  carrying no `style` attribute, handed back without one. After the `releasePointer` function, an
  element frame takes no `mouseover` event for an element inside the window, which also takes no `scroll` event;
  for a flush-left element the scroll brings to the top, one the offset brings to the left edge, and
  one too large for the window; for an element past both window edges, whose frame has the
  element's size; for an element touching the origin and one filling the window; across a scroll
  the staging clamps, with the scroll handed back; and for an `svg` element in the shadow tree of a
  fixed host and a fixed `svg` element under a containing-block ancestor. A hover placed after
  staging on an element at the tester's top-left corner stays in the frame. The `computeOffset`
  function takes an element inside the window, one touching the origin or starting above it, one
  filling the window, an element past the bottom edge, a fractional bottom edge rounded up, a
  fractional top and a fractional left each moved only as far as the window start, a box already
  ending inside a fractional window left where it is, an element past the right edge,
  one past both edges, and an element too large for the window.
  The `readFrame` function takes a written
  frame's size and floor, read a second way through the cascade's own answer for the same canvas, a
  bottom row split between two colors reported as no floor at all, a path holding no file,
  a file holding no image and refused without a size, and a PNG header over no image data, refused
  with the size the header declares. The `readCascade` function takes class tokens collected from
  plain and grouped rules and only real ones;
  `readRows` takes a row joined from its own text nodes rather than from run-together content, and
  an empty list; `extractOrphans` takes a child class rendered outside its container with a nested
  one left alone, nothing reported when every child sits inside one, and, as the control, an element
  answering the invariant by carrying both classes itself; `readStyle` takes the browser's resolved
  value for one property. `expandCaptures` takes the exact expected file list rather than a count,
  and both empty inputs. `readClasses` takes the root's own classes ahead of its descendants' in
  document order, an SVG class read through `classList` where `className` is no string, a fragment
  root contributing its descendants alone, markup carrying no class at all, and a class absent from
  the cascade left in the difference against `readCascade`. `extractStyles` takes an inline
  attribute and a `<style>` element in document order, a `<style>` root and a styled root each
  counted beside a `<div>` root carrying neither, an inline style on an SVG path, a `<style>`
  element carrying an inline attribute reported once, a whitespace-only attribute read past, a
  fragment root, and — as the control — markup whose classes and `data-*` attributes leave it with
  nothing to report.
- [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts) — the journal
  contract, and the portfolio's refusals, its disabled gate, and its writes. Creation refuses an
  unregistered variant name; the registry expands across every variant whether or not the run
  writes; a run
  that is not enabled applies nothing, writes nothing, and records nothing; an enabled run applies
  the variant, resizes the viewport, writes a real file through the provider, records it, and hands
  out snapshots rather than its own lists; it refuses an unregistered state and a second placement of
  one state; and a placement handed an element writes a frame that is not the whole page's and leaves
  the staged pane released. `createJournal` takes a step recorded only while it is started, every
  console channel forwarded to the recorder that was there, a call's arguments joined into a line,
  an uncaught error and an unhandled rejection recorded and then ignored after the stop, the
  channels handed back by identity with a second stop proven a no-op against a replacement, a restart
  that clears `steps` and `output` without stacking wrappers, snapshots that stay what they were, and
  one journal's recording kept out of another's. `createStorage` takes a seeded store answering every
  operation, each withheld operation refused in its own voice, both permissions granted at once with
  the store answering from what it kept, a quota spent on accepted writes alone with `removeItem`
  consuming none of it, a granted permission replenishing no room, every refused quota value, and —
  as the control for the inertness claim — a write that leaves `localStorage` exactly as it was.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — the `readInventory` and
  wait-family contracts, and each pure leaf against its own inputs. `resolveContained` takes
  contained relative and absolute targets and both spellings of an escape, and `requireContained`
  takes the same contained pair and each escape refused with the message naming the target it was
  given. `readIdentity` takes a real
  allocation's three fields, that allocation matching itself across a `stat` and an `lstat`, and a
  second allocation reading as a different identity. `readErrorCode` takes a real `ENOENT` off the
  host, a plain object, an `Error` carrying a non-string `code` and one carrying none, a
  null-prototype record, and the values that are not objects at all. `matchesIdentity` takes a triple
  matching in every field and one differing in each. `isExcluded` takes a key, an ancestor, the root, and a sibling that only
  looks like a match. `readInventory` takes key order, extension filtering, exclusion at the named
  door and at the walked one with its spellings normalized to one rule, each of its link refusals
  with a contained intermediate link as the control on the intermediate-link one, a root-level
  `__proto__` file, and the
  host's own case behavior probed rather than assumed. `createLink` takes a directory named by an
  absolute source, a relative source resolved against the link's own directory against a decoy one
  level up, a dangling link, the host's `EEXIST` on an occupied path, and — where the host makes no
  symbolic link — a file source refused with the host's own `EPERM` and nothing left behind.
  `removeTree` takes a live process
  holding the tree as its working directory, and the hosts split rather than branching at
  runtime: on Windows the un-retried `rmSync` baseline is proven to fail first, so the retry is what
  succeeds, and on POSIX the removal is permitted outright. `isRunning` takes the process making the
  call, a child that has exited, and a pid the host refuses without throwing. `waitForSocketClose`
  takes an already-closed socket, a peer that ends the connection, a reset waited past to the close
  that follows it, a socket error that is not a reset, a socket left open past the budget, both
  listeners removed after it resolves and after it rejects, an abort before and during the wait, and
  the refused bounds. `destroyScratch` takes a first-attempt destruction whose elapsed reading is
  below one retry interval, a signal already aborted before anything is attempted, the refused
  bounds, and — on each host by the mechanism that host actually refuses a removal for — an
  allocation held until the holder lets go, its budget exhausted with the host's own refusal as the
  `cause` and then destroyed after the hold ends.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — the
  `createScratch`, destroyed-allocation, and `createLoopback` contracts. `createLoopback` takes a
  real `fetch` answered from its own origin, a live keep-alive connection dropped by `destroy()`
  with a second server then binding the released port, a repeated `destroy()`
  handed the same promise before either call settles, parallel instances landing on distinct
  ports, a plain `node:net` server bound and closed, and a server already listening when it was
  handed over, refused. For `createScratch`, the ungrouped cases take the `0700` mode, nested
  seeding, the cleanup after a failed seed, the lexical refusals, the empty target's answers, and
  `has`, `write`, `read`, `names`, `ensure`, `link`, and `remove` each refused at a symbolic-link
  root and at a file root; `destroy()` is idempotent, leaves a replacement directory standing, and
  leaves a moved allocation alone. Then one group per subject.
  `destruction` takes `write`, `read`, `has`, `names`, `ensure`, `link`, and `remove` after
  `destroy()`, with `write`, `ensure`, and `link` also proven not to rebuild the allocation root, and
  `remove` proving its root and escape refusals answer before the destroyed-allocation one.
  `names` takes its sorted output, including the population that discriminates a dropped `.sort()`.
  `ensure` takes an empty directory, every missing parent, and a repeated call. `link` takes
  traversal through a planted link, the final segment `has` reports rather than follows, and the
  `EEXIST` an occupied final segment throws. `remove` takes a file beside a kept
  sibling, an empty directory, a populated subtree, a missing target, an ancestor link back to the
  allocation with every seeded file read back afterwards, a final link whose destination is read back
  afterwards, a sibling directory reached through that same ancestor link, an escaping target with
  the file outside left intact, the root refused as `''`, as `'.'`, and as its absolute path, a
  foreign directory swapped onto the allocated path that `remove('')` refuses, and that same swap
  under `destroy()`, which removes nothing either. `parent` and `prefix` take their own refusals.
  `createCookieJar` takes an empty jar rendering no header, every `Set-Cookie` field a real response
  carries applied and handed back unmodified, a cookie replaced whatever attributes the second field
  carries, a deletion on `Max-Age=0` in whatever case and spacing the origin sends, and a field
  carrying no `name=value` pair read past and still returned.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — the doc ↔ source bijection contract: the
  `## Surface` ↔ source bijection, the barrel ↔ source bijection, the behavioral-interface ↔
  `## Methods` bijection and each group's members, the fence imports, and link resolution for this
  guide. It also runs the equality gate: every `Summary` cell against the description paragraph of
  the declaration it documents, the titled `Own a temporary directory` fence against the `@example`
  block of that title (pinned so the titled pair cannot be retired silently), and the README pitch
  against this guide's tagline. Beside them it runs the fences themselves and asserts what their
  comments claim: the recorder's truncating `clear()`, the recorder map keyed by the events a real
  source emits, the signal tally through every exit it has, the resource numbering, the unchecked
  boundary's uncallable-method and non-object-target refusals, the header flattening, the wait
  family's opposite throw directions with the exhaustion message and its `cause`, the statechart
  table walked against a real disclosure with the failing row's name opening the message and the
  assertion kept as the `cause`, the text wait resolving on the reading that carries the arrival
  without the departure and refusing an empty expectation, the cookie jar driven against a real
  origin, and the HTTP upgrade's refused arm, claimed arm, and budget.

## See also

- [`README.md`](README.md) — the guides index.
- `AGENTS.md` at the workspace root — the rules this package's own source and tests follow.
