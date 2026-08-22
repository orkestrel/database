# Test

> The test helpers the fleet kept rewriting, published once. They read as families of what a test
> records, what it waits for, and what it owns, with a pair outside all of them and a browser journey
> layer beside them.
>
> **What a test records.** A call recorder, a map of recorders subscribed to an emitter's events, a
> signal's live abort-listener tally, a numbered resource ledger, a captured throw, a drained async
> source, a JSON copy, a required value, a decoded JSON Lines stream, and a cookie jar filled from
> real responses. Each turns what the code under test did into a value you can assert on.
>
> **What a test waits for.** A real delay, and — each bounded by a budget, an interval, and an abort
> signal — a named condition, a produced value, a first event delivery, a socket's close, and a
> directory the host has finally let go. One wait takes no bound at all, because it needs none:
> `waitForAbort` parks on a signal's own abort. Nothing here replaces the host clock: every bound is
> a real elapsed interval read with `performance.now()`.
>
> **What a test owns and must give back.** A temporary directory, a cleanup list, and a loopback
> server, each carrying `destroy()`. Each one takes something from the host.
>
> `resolveRoot` and `readInventory` are the pair outside all of them: together they read the
> real tree a test checks itself against. Neither records anything, neither waits for anything, and
> neither owns anything to give back.
>
> `createHostileValues` sits outside them too, on the input side: it is what a test feeds its guards,
> a corpus whose every member throws on a naive read or violates a naive structural assumption. The
> host-capability probes are outside them on the environment side, answering what this filesystem
> does rather than what its platform is called. `invokeUnchecked` and `readProperty` are outside them
> at the type boundary, where a value nothing declares meets a claim its caller owns, and
> `flattenHeaders` is outside them on the comparison side, turning any header initializer into one
> frozen record.
>
> The journey layer drives a real interface by role and accessible name through the installed Vitest
> provider, measures what a reader can see of the result, records the scenario and the page's own
> output as it goes, and generates the capture portfolio from the same journeys. Around it sit the
> fixture the journey runs against and the readings a styling claim rests on: an element built and
> mounted, a field driven the way its component listens for, the tokens, colors, and rules the
> cascade resolved, and a database given back at the end of the test that filled it.
>
> A helper ships here when it is a reusable test mechanism with a real consumer that no native or
> declared primitive already covers; [Limits](#limits) states that rule and what it refused. This
> package holds one implementation of each and ships as a `devDependency`. Nothing here runs in
> production code. Source: [`src/core`](../src/core), [`src/browser`](../src/browser), and
> [`src/server`](../src/server).
>
> It has **zero runtime dependencies**, and no exported type here names an `@orkestrel/*` type. A
> dependency on `@orkestrel/emitter` would install a second copy of it beside the one a consumer
> already pins, and the compiler reads two copies as two distinct types. A foreign type in a
> signature fails the other way, rejecting the consumer's own local value inside the consumer's own
> repository. Rule 9 holds both.

## Install

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

| Type                       | Kind      | Shape                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WaitOptions`              | interface | `{ budget?, interval?, signal? }` — the elapsed-time limit, delay between readings, and abort signal for a bounded wait.                                                                                                                                                                 |
| `RetryOptions`             | interface | `WaitOptions` plus `{ attempts? }` — the optional producer-call limit for a bounded retry.                                                                                                                                                                                               |
| `EventSubscriber`          | type      | `(listener) => cleanup \| void` — installs one event listener and may return its cleanup.                                                                                                                                                                                                |
| `RecorderInterface`        | interface | `{ calls, count, handler }` plus `clear` — the recorded calls of one callback.                                                                                                                                                                                                           |
| `EventSourceInterface`     | interface | `on` alone — the subscribe half of a typed event source; it carries no data members.                                                                                                                                                                                                     |
| `RecorderMap`              | type      | `{ readonly [K in TName]: RecorderInterface<TMap[K]> }` — one recorder per requested event name.                                                                                                                                                                                         |
| `SignalInterface`          | interface | `{ controller, signal, count }` — a real abort controller, its instrumented signal, and that signal's live abort-listener tally.                                                                                                                                                         |
| `ResourceFactoryInterface` | interface | `{ created, destroyed }` plus `create` / `destroy` — numbered resources, with a recorder for the ids created and one for the ids destroyed.                                                                                                                                              |
| `TeardownInterface`        | interface | `{ count }` plus `add` / `destroy` — the cleanup one test registers as it goes.                                                                                                                                                                                                          |
| `TeardownHandler`          | type      | `() => void \| Promise<void>` — the work one registered entry performs.                                                                                                                                                                                                                  |
| `JSONValue`                | type      | `string \| number \| boolean \| null \| readonly JSONValue[] \| { readonly [key: string]: JSONValue }`.                                                                                                                                                                                  |
| `JSONSafe`                 | type      | `JSONSafe<T>` — `T` with each member JSON preserves kept, and each member it drops or reshapes outside its declared type mapped to `never`: `undefined`, an opaque `object` member, and a symbol-keyed member. `unknown` still passes through, so `Record<string, unknown>` is accepted. |
| `HeadersSource`            | type      | `NonNullable<ConstructorParameters<typeof Headers>[0]>` — every value the host `Headers` constructor accepts: a record, an entries array, or another `Headers` value.                                                                                                                    |

Each interface's `readonly` data members are the row above; its call-signature members are listed
under [Methods](#methods).

#### Validators

| API                     | Kind     | Signature                                                                                      | Summary                                                                       |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `isRecorderMapComplete` | function | `<TMap, TName>(value: unknown, events: readonly TName[]) => value is RecorderMap<TMap, TName>` | Whether a value carries a structurally valid recorder for every listed event. |

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

| API                | Kind     | Signature                                                              | Summary                                                        |
| ------------------ | -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `waitForCondition` | function | `(description, condition, options?) => Promise<void>`                  | Reads until a condition holds within a monotonic budget.       |
| `retryUntil`       | function | `(description, produce, satisfied, options?) => Promise<T>`            | Produces until a value satisfies a predicate or a bound.       |
| `waitForEvent`     | function | `(subscribe, description, options?) => Promise<TArgs>`                 | Parks until the first event delivery, timeout, or abort.       |
| `decodeJSONLines`  | function | `(text: string) => readonly unknown[]`                                 | Decodes non-empty JSON Lines in physical-line order.           |
| `waitForDelay`     | function | `(ms?: number) => Promise<void>`                                       | Waits for a real host timer; defaults to `0`.                  |
| `waitForAbort`     | function | `(signal: AbortSignal) => Promise<void>`                               | Parks on a signal's abort; an aborted signal resolves at once. |
| `captureError`     | function | `(thunk: () => unknown) => unknown`                                    | Runs a synchronous thunk and returns whatever it threw.        |
| `requireValue`     | function | `<T>(value: T \| null \| undefined, message?: string) => T`            | Narrows away `null` and `undefined` by throwing.               |
| `collect`          | function | `<T>(source: AsyncIterable<T>) => Promise<readonly T[]>`               | Drains an async iterable into an array, in iteration order.    |
| `collectStream`    | function | `<T>(stream: ReadableStream<T>) => Promise<readonly T[]>`              | Drains a readable stream into an array, in read order.         |
| `roundTripJSON`    | function | `<T>(value: T & JSONSafe<T>) => T`                                     | Copies a JSON value; throws on a non-finite number.            |
| `invokeUnchecked`  | function | `<T>(target: unknown, method: unknown, args: readonly unknown[]) => T` | Calls an unknown method under a return type the caller claims. |
| `readProperty`     | function | `<T>(target: unknown, key: PropertyKey) => T`                          | Reads a property off an unknown value under the same claim.    |
| `flattenHeaders`   | function | `(init: HeadersSource) => Readonly<Record<string, string>>`            | Normalizes any header initializer into a frozen plain record.  |
| `resolveRoot`      | function | `(meta: ImportMeta) => URL`                                            | The URL one directory above the calling module's own file.     |

#### Factories

| API                     | Kind     | Signature                                                                                                 | Summary                                                          |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `createHostileValues`   | function | `() => readonly unknown[]`                                                                                | Fresh hostile values for proving that a guard is total.          |
| `createRecorder`        | function | `<TArgs extends readonly unknown[]>() => RecorderInterface<TArgs>`                                        | A recorder whose `handler` appends each call, in order.          |
| `createRecorders`       | function | `<TMap, TName>(source: EventSourceInterface<TMap>, events: readonly TName[]) => RecorderMap<TMap, TName>` | One recorder per named event, each subscribed to the source.     |
| `createSignal`          | function | `() => SignalInterface`                                                                                   | A real controller whose signal reports its live abort listeners. |
| `createResourceFactory` | function | `() => ResourceFactoryInterface`                                                                          | Numbered resources with every creation and destruction recorded. |
| `createTeardown`        | function | `() => TeardownInterface`                                                                                 | A cleanup list that runs newest-first when it is destroyed.      |

### Browser

Imported from `@orkestrel/test/browser`. Every journey verb here resolves its own target from a
role and an accessible name and drives it through the installed Vitest provider, and none of them
takes an element, a component instance, or a selector for the thing it acts on. That is what keeps
a journey a description of what a person does rather than of what the markup happens to be.

The fixture builders, the readers, and the field writers do take an element, and none of them is a
journey verb. `build` creates a node, `mount` attaches one, and `render` does both from
markup or from a tag and its classes; `clearStorage` takes nothing at all, and `removeDatabase`
takes a database name. The predicates, the element readers, and the describers name a node the
caller already has — `isRendered`, `isReachable`, `readText`, `readRole`, `readName`, `readStates`,
`describeTree`, `describeFocus`, `extractOrphans`, `readRows`, `style`, `token`, `pixels`,
`contrast`, `readLayers`, `readBackdrop`, and `readRing` — and each reads that node rather than
acting on a target it was handed. `captureFrame` and `place` take an element as well, and
photographing one is a reading too: neither moves focus, dispatches an event, or changes what the
element renders. `typeInput` and `commitInput` are the exception, and it stays narrow: they write
into the field they are given, as the synthetic counterpart of `typeAccessible` for a component
that listens for `input`. The color leaves, the cascade readers, the pane verbs, and the
whole-document readers take a value or nothing at all, so they name no target either.

#### Types

| Type                 | Kind      | Shape                                                                                                                                               |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Color`              | type      | `readonly [red, green, blue, alpha]` — one rendered color, its channels 0–255 and its alpha 0–1.                                                    |
| `ElementOptions`     | interface | `{ classes?, text?, attributes? }` — the class list, the text, and the attributes one built element carries.                                        |
| `FrameOptions`       | interface | `{ path, width, height, element? }` — where one frame is written, the viewport it is shot at, and what it shoots.                                   |
| `CaptureVariant`     | interface | `{ name, width, height, apply? }` — one theme-and-viewport pair, and the document change it needs first.                                            |
| `PortfolioOptions`   | interface | `{ states, variants, variant, directory, enabled? }` — the registry, the matrix, this run's variant, where it writes, and whether it writes at all. |
| `PortfolioInterface` | interface | `{ variant, states, paths, files }` plus `place` — one run's registry and what it placed.                                                           |
| `JournalStep`        | interface | `{ action, trigger, result }` — one scripted step and what the surface did about it.                                                                |
| `JournalInterface`   | interface | `{ steps, output }` plus `start` / `stop` / `record` — one scenario's steps and the page's own output.                                              |

#### Constants

| API                  | Kind  | Signature                          | Summary                                                                                                                            |
| -------------------- | ----- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESSIBLE_ROLES`   | const | `readonly string[]`                | The interactive roles a bare accessible name is searched across.                                                                   |
| `CANVAS_COLOR`       | const | `Color`                            | Opaque white: the page a browser paints an unstyled document onto.                                                                 |
| `CAPTURE_PANE`       | const | `string`                           | The attribute marking the runner's tester pane, and the rule sizing it, while a frame is staged.                                   |
| `CONTENT_ROLES`      | const | `readonly string[]`                | The roles `readName` names from the text a reader can see inside them.                                                             |
| `FIELD_ROLES`        | const | `Readonly<Record<string, string>>` | The role each `input` type carries; a type it omits exposes none.                                                                  |
| `FOCUSABLE_SELECTOR` | const | `string`                           | What sequential keyboard navigation can reach, before the removals `describeFocus` applies.                                        |
| `HEADER_ROLES`       | const | `Readonly<Record<string, string>>` | The role a `th` carries for the `col` or `row` axis its `scope` names.                                                             |
| `IMPLICIT_ROLES`     | const | `Readonly<Record<string, string>>` | The role each listed tag carries when it declares none. Membership is the contract: a tag it omits is written into no description. |

#### Helpers

| API                     | Kind     | Signature                                                                                               | Summary                                                                                                                                            |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveAccessible`     | function | `(name: string) => HTMLElement` / `(role: string, name: string) => HTMLElement`                         | One visible, focus-reachable control, scrolled into view once before reachability is measured.                                                     |
| `resolveRendered`       | function | `(first: string, second?: string) => HTMLElement`                                                       | The same resolver without the viewport requirement; the acting verbs use it.                                                                       |
| `isOutsideViewport`     | function | `(rectangle: DOMRectReadOnly) => boolean`                                                               | Whether a measured rectangle lies wholly outside the viewport.                                                                                     |
| `isRendered`            | function | `(element: Element) => boolean`                                                                         | Whether the accessibility tree presents the element at all; no geometry is read, so a zero-size announced control passes.                          |
| `isReachable`           | function | `(element: Element) => boolean`                                                                         | Whether a person can click the element where it sits; the one reachability filter every acting verb applies.                                       |
| `clickAccessible`       | function | `(name: string) => Promise<void>` / `(role: string, name: string) => Promise<void>`                     | Trusted activation of one resolved control.                                                                                                        |
| `clickAccessibleWithin` | function | `(region: string, role: string, name: string) => Promise<void>`                                         | Trusted activation inside one named region, matching the control's name loosely.                                                                   |
| `clickDisclosure`       | function | `(name: string) => Promise<void>`                                                                       | Trusted activation of a native `<summary>`, which carries no role locators accept.                                                                 |
| `typeAccessible`        | function | `(name: string, text: string) => Promise<void>`                                                         | Focus, select all, delete, then real keystrokes, with the provider's key syntax escaped.                                                           |
| `fillAccessible`        | function | `(name: string, text: string) => Promise<void>`                                                         | Replaces a value in one operation, for text too long to type.                                                                                      |
| `pressKeys`             | function | `(keys: string) => Promise<void>`                                                                       | A provider keyboard sequence sent to whatever holds focus.                                                                                         |
| `traverseAccessible`    | function | `(name: string) => Promise<HTMLElement>`                                                                | Forward Tab alone, until focus lands on the re-resolved target.                                                                                    |
| `readPerception`        | function | `(name: string) => string`                                                                              | The normalized `innerText` of exactly one visible named region, dialog, table, panel, or alert.                                                    |
| `readPage`              | function | `() => string`                                                                                          | The normalized `innerText` of the whole page.                                                                                                      |
| `readFocus`             | function | `() => string \| undefined`                                                                             | The focused HTML element's rendered text (`''` included); `undefined` for a non-HTML focus; the whole page's text when nothing holds focus.        |
| `readValue`             | function | `(role: string, name: string) => string`                                                                | The value a resolved input, textarea, or select renders.                                                                                           |
| `readText`              | function | `(element: Element) => string`                                                                          | The element's rendered text with every `aria-hidden` descendant dropped and its whitespace runs collapsed.                                         |
| `readRole`              | function | `(element: Element) => string \| undefined`                                                             | The declared role, the implicit one, or `undefined` when the element carries none.                                                                 |
| `readName`              | function | `(element: Element) => string`                                                                          | The accessible name, computed in the order a browser computes it; an empty string when nothing names the element.                                  |
| `readStates`            | function | `(element: Element) => readonly string[]`                                                               | Every state the element declares, in one fixed order.                                                                                              |
| `describeTree`          | function | `(element: Element) => string`                                                                          | One indented line per roled element, naming its role, its name, and its states; indentation follows the roles rather than the markup.              |
| `describeFocus`         | function | `(element: Element) => string`                                                                          | One numbered line per reachable control, a positive `tabindex` first in ascending order and everything else in document order.                     |
| `waitForFrame`          | function | `() => Promise<void>`                                                                                   | One `requestAnimationFrame`, to settle pending paint work.                                                                                         |
| `build`                 | function | `<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions) => HTMLElementTagNameMap[K]` | One unmounted element of exactly that tag, carrying its classes, text, and attributes.                                                             |
| `mount`                 | function | `<T extends Element>(element: T) => T`                                                                  | Appends an element to the document and hands the same element back.                                                                                |
| `render`                | function | `(markup: string) => HTMLDivElement` / `(tag: K, classes: string) => HTMLElementTagNameMap[K]`          | Trusted fixture markup in an attached container, or one attached element of that tag.                                                              |
| `typeInput`             | function | `(element: HTMLInputElement \| HTMLTextAreaElement, text: string) => void`                              | Sets a field's value and dispatches one bubbling `input` event, a plain `Event` rather than an `InputEvent`.                                       |
| `commitInput`           | function | `(element: HTMLInputElement \| HTMLTextAreaElement, text: string) => void`                              | Sets a field's value, then dispatches `input` and `change`, in that order.                                                                         |
| `clearStorage`          | function | `() => void`                                                                                            | Empties local and session storage together, for an `afterEach` hook that runs after a failed test too.                                             |
| `removeDatabase`        | function | `(name: string) => Promise<void>`                                                                       | Deletes one IndexedDB database; rejects on an error and on a block.                                                                                |
| `parseColor`            | function | `(value: string) => Color \| undefined`                                                                 | One computed `rgb()`, `rgba()`, or `color(srgb …)` value as straight channels; `undefined` for anything else.                                      |
| `rgba`                  | function | `(value: string) => Color \| undefined`                                                                 | Any CSS color expression resolved to channels by the real cascade; `undefined` when the CSSOM refuses it.                                          |
| `colorEqual`            | function | `(first: string \| Color, second: string \| Color) => boolean`                                          | Whether two colors render the same, within half a channel step.                                                                                    |
| `blendColor`            | function | `(front: Color, back: Color) => Color`                                                                  | One color composited over another, always opaque.                                                                                                  |
| `measureLuminance`      | function | `(color: Color) => number`                                                                              | One opaque color's WCAG relative luminance, from `0` to `1`.                                                                                       |
| `measureContrast`       | function | `(front: Color, back: Color) => number`                                                                 | The WCAG 2.x ratio between two opaque colors, from `1` to `21`.                                                                                    |
| `readLayers`            | function | `(element: Element) => readonly Color[]`                                                                | Every painted layer between the element and its first opaque ancestor, that ancestor last; an unpainted stack is empty.                            |
| `readBackdrop`          | function | `(element: Element, floor: Color) => Color`                                                             | The opaque color behind an element, every translucent layer composited onto the required floor.                                                    |
| `contrast`              | function | `(element: Element, floor?: Color) => number`                                                           | The WCAG 2.x ratio for one element's text; an omitted floor refuses an unpainted stack and a supplied one composites onto it.                      |
| `readRing`              | function | `(control: Element, worn?: Element) => number \| undefined`                                             | The ratio the painted focus chrome reaches against its backdrop; `undefined` off `:focus-visible` or with no painted chrome.                       |
| `stagePane`             | function | `(width: number, height: number) => Promise<void>`                                                      | Sets the viewport and renders the runner's tester pane at that size, unscaled.                                                                     |
| `releasePane`           | function | `() => void`                                                                                            | Hands the staged pane back to the runner's own layout.                                                                                             |
| `captureFrame`          | function | `(options: FrameOptions) => Promise<string>`                                                            | Stages, shoots, reads the file back, and returns the verified absolute path; releases the pane either way.                                         |
| `readCascade`           | function | `() => ReadonlySet<string>`                                                                             | Every class token the stylesheets loaded into this document define.                                                                                |
| `readRules`             | function | `() => readonly CSSRule[]`                                                                              | Every rule the loaded stylesheets hold, level by level, nested grouping rules included; a `@keyframes` rule is collected and its children are not. |
| `findRule`              | function | `(selector: string) => CSSStyleRule \| undefined`                                                       | The first style rule whose selector text carries a fragment.                                                                                       |
| `findKeyframes`         | function | `(name: string) => CSSKeyframesRule \| undefined`                                                       | The animation the cascade declares under an exact name.                                                                                            |
| `readRows`              | function | `(root: ParentNode, selector: string) => readonly string[]`                                             | One line per matched element, built from its text nodes rather than from `textContent`.                                                            |
| `extractOrphans`        | function | `(root: ParentNode, child: string, parent: string) => readonly string[]`                                | The markup of every element carrying the `child` class with no `parent` class above it.                                                            |
| `style`                 | function | `(element: Element, property: string) => string`                                                        | One resolved CSS property, trimmed, read from the real browser.                                                                                    |
| `token`                 | function | `(element: Element, name: string) => string`                                                            | One custom property off an element's resolved style, its dashes optional.                                                                          |
| `rootToken`             | function | `(name: string) => string`                                                                              | The same reading taken against the document element.                                                                                               |
| `pixels`                | function | `(element: Element, property: string) => number`                                                        | One resolved length as a number of pixels; `0` when it carries none.                                                                               |
| `expandCaptures`        | function | `(states: readonly string[], variants: readonly CaptureVariant[]) => readonly string[]`                 | The registry times the variants, as `<state>--<variant>.png` names.                                                                                |

#### Factories

| API                  | Kind     | Signature                                                                                                 | Summary                                                                            |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `createPointerEvent` | function | `(name: string, options?: PointerEventInit) => PointerEvent`                                              | One real pointer event carrying a browser's own defaults.                          |
| `createDragEvent`    | function | `(name: string, options?: DragEventInit) => DragEvent`                                                    | One real drag event carrying a live data transfer.                                 |
| `createPortfolio`    | function | `(options: PortfolioOptions) => PortfolioInterface`                                                       | The capture registry one run places its screenshots through.                       |
| `createChannel`      | function | `(name: string, output: string[], forward: (...data: unknown[]) => void) => (...data: unknown[]) => void` | One console channel that records every call it receives and forwards it unchanged. |
| `createJournal`      | function | `() => JournalInterface`                                                                                  | The record of one scenario's steps and the page's own output.                      |

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

`clickAccessibleWithin` matches the region's name exactly and the control's name loosely. That
combination is what a person does with a repeated short verb such as `Add`, or with a line whose
rendered status completes its accessible name: the region supplies the context, and the name only
has to be recognisable inside it.

`traverseAccessible` charges a step only when focus actually lands on an element, ends when focus
revisits one — that is a complete cycle of the tab order — and re-resolves the target by name on
every step, because a framework may replace the node between resolution and focus arrival. Its hard
cap is three times the page's candidate count plus ten, including disabled controls and elements
with `tabindex="-1"`, so a page whose focus never settles fails instead of hanging.

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

`rgba` is the live half of the pair `parseColor` opens. `parseColor` reads text and speaks only the
computed syntaxes a cascade hands back; `rgba` stages a probe element, hands the expression to the
real cascade, and reads back what the engine computed — which is the only way a keyword, a hex
triple, a `var()` reference, or a `color-mix()` becomes channels at all. The probe is mounted, so a
`var()` reference resolves against the tokens `:root` declares, and it is removed in a `finally`.
Refusal is the CSSOM's: an expression it will not parse returns `undefined`. A `var()` naming an
undeclared custom property is not refused, and [Limits](#limits) states what that costs.

`colorEqual` compares two colors as a browser renders them. Each string side resolves through
`rgba`, so a keyword, a token reference, and the `rgb()` an engine computes for either compare equal
without a test converting anything first. The tolerance is half a channel step on the 0–255 scale,
and the alpha is scaled onto that same range before it is compared, so one number covers every
channel. A side that resolves to nothing makes the answer `false` rather than a throw, because this
is a predicate.

`contrast` resolves a transparent or translucent background through the element's ancestors: every
painted layer from the element up to the first opaque one composites top-over-bottom onto that
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

`readBackdrop` composites that stack and takes its floor as an argument rather than reaching for
`CANVAS_COLOR` itself, so a measurement over a surface the canvas never shows through names the
color it actually sits on. When no layer paints it hands that floor straight back.

`readRing` reads and never acts. Focus arrives through the published verbs, and this measures what
the browser painted once it landed: the `outline` the cascade declares, and the first color in a
`box-shadow`. A control that is not matching `:focus-visible`, a control left the browser's own
`outline-style: auto` ring, and a focus style that only changes the control's own fill all report
`undefined` — in each case no measurement taken here would be about focus. `worn` names the element
the chrome is painted onto when that is not the element holding focus, which is the hidden-input
control whose visible label wears every pixel of its chrome.

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
finds may be overridden by another — assert on `style` where the rendered result is the subject.

`token`, `rootToken`, and `pixels` are `style` with the question narrowed. `token` reads a custom
property and accepts the name with or without its leading dashes, because a token is spoken about
both ways — `--surface` in a stylesheet and `surface` in prose. An absent token reads as `''`, which
is what the CSSOM returns and is indistinguishable from a token declared empty, so assert on the
value you expect rather than on presence. Resolution is inheritance: a token declared on `:root`
reads from any mounted descendant, and from an unmounted element it reads as `''`. `rootToken` is
that reading taken against `document.documentElement`, which is where a theme declares its tokens
and where a `[data-theme]` switch retunes them. `pixels` reads the leading number of a resolved
length and answers `0` for a value carrying none, because `'auto'`, `'none'`, and `''` each
contribute no pixels to what a reader sees; read the text with `style` where that distinction
matters.

`stagePane` unscales the runner's tester and lifts it to the window's origin, because a frame shot
through the runner's fitting scale is a thumbnail of the surface. That couples it to Vitest's own
tester layout, which is contract rather than accident: `vitest@4.1.11` is the version behind the
`iframe[data-vitest]` selector and the `--tester-transform`, `--tester-margin-left`,
`--viewport-width`, and `--viewport-height` custom properties it writes. A release that renames any
of them reddens the size check rather than writing a wrong frame. Always hand the pane back with
`releasePane`: a tester left pinned at a viewport taller than the window puts its lower half beyond
what a pointer can reach, so the next ordinary press fails as a control that is covered.

`captureFrame` stages, shoots, and proves the file. The path a screenshot call returns is the path
it meant to write, so `captureFrame` reads that file back through the runner's built-in `readFile`
command and compares it with the shot itself, which is what separates this run's frame from one an
earlier run left behind. It releases the pane in a `finally`, so a refusal at any stage hands the
tester back before it propagates.

`createPortfolio` refuses an unregistered variant name at creation, so a run cannot write a filename
naming a combination it did not render. A portfolio left un-`enabled` is the ordinary run: `place`
resizes nothing, writes nothing, and records nothing, so a journey calls it unconditionally. An
enabled `place` applies the variant and writes `<directory>/<state>--<variant>.png` through
`captureFrame`, so it stages the pane at the variant's size, verifies the written bytes, and records
only a path that read back as this run's own frame. `states` and `paths` hand out snapshots, so a
list read before a placement stays what it was.

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

| Type                 | Kind      | Shape                                                                                                                                                                                 |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScratchInterface`   | interface | `{ path }` plus `write` / `read` / `has` / `names` / `ensure` / `link` / `remove` / `destroy` — one owned directory.                                                                  |
| `ScratchIdentity`    | interface | `{ device, inode, birth }` — the three fields that together name one allocation on its host.                                                                                          |
| `ScratchOptions`     | interface | `{ parent?: string, prefix?: string, files?: Readonly<Record<string, string>> }`.                                                                                                     |
| `LoopbackInterface`  | interface | `{ url, port }` plus `destroy` — one server on an owned ephemeral loopback port.                                                                                                      |
| `CookieJarInterface` | interface | `{ header }` plus `read` / `capture` — one name-keyed cookie store filled from real responses.                                                                                        |
| `InventoryOptions`   | interface | `{ extensions?: readonly string[], exclude?: readonly string[] }`.                                                                                                                    |
| `UpgradeOptions`     | interface | `WaitOptions` plus `{ path?, protocols? }` — the bounds the wait takes, and the request path and subprotocol tokens one upgrade request offers.                                       |
| `UpgradeResult`      | type      | `{ claimed: true, protocol }` or `{ claimed: false, status }` — the claimed arm carrying the subprotocol the server selected, and the refused arm carrying the plain answer's status. |

#### Constants

| API                           | Kind  | Shape               | Summary                                                                              |
| ----------------------------- | ----- | ------------------- | ------------------------------------------------------------------------------------ |
| `REMOVE_TREE_MAX_ATTEMPTS`    | const | `number`            | The attempts `removeTree` makes before rethrowing a retryable removal error.         |
| `REMOVE_TREE_RETRY_DELAY_MS`  | const | `number`            | The synchronous delay, in milliseconds, `removeTree` waits between attempts.         |
| `REMOVE_TREE_RETRYABLE_CODES` | const | `readonly string[]` | The removal error codes `removeTree` retries; every other code rethrows immediately. |

#### Helpers

| API                      | Kind     | Signature                                                                                                           | Summary                                                                                |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `readInventory`          | function | `(root: URL \| string, targets: readonly string[], options?: InventoryOptions) => Readonly<Record<string, string>>` | Named files and walked directories, keyed by root-relative path in sorted order.       |
| `resolveContained`       | function | `(root: string, target: string) => string \| undefined`                                                             | The absolute target below `root`, or `undefined` when it escapes.                      |
| `isExcluded`             | function | `(key: string, exclusions: readonly string[]) => boolean`                                                           | Whether an exclusion names the key or one of its ancestors.                            |
| `matchesIdentity`        | function | `(current: ScratchIdentity, allocation: ScratchIdentity) => boolean`                                                | Whether two identities name the same allocation.                                       |
| `createLink`             | function | `(path: string, source: string) => void`                                                                            | Create a symbolic link, or a directory junction where the host refuses one.            |
| `removeTree`             | function | `(path: string) => void`                                                                                            | Remove a directory tree, retrying a briefly-held handle before rethrowing.             |
| `isRunning`              | function | `(pid: number) => boolean`                                                                                          | Whether a process id names a live process at the moment of the call.                   |
| `waitForSocketClose`     | function | `(socket: Socket, options?: WaitOptions) => Promise<void>`                                                          | Wait for a socket's `close`, waiting past a peer reset.                                |
| `destroyScratch`         | function | `(scratch: ScratchInterface, options?: WaitOptions) => Promise<void>`                                               | Destroy a scratch directory, retrying until the host releases it.                      |
| `requestUpgrade`         | function | `(port: number, options?: UpgradeOptions) => Promise<UpgradeResult>`                                                | Drives one client upgrade request within a budget and reports what the server did.     |
| `supportsDirectoryLinks` | function | `() => boolean`                                                                                                     | Whether this host links a directory and reads through the link.                        |
| `supportsFileLinks`      | function | `() => boolean`                                                                                                     | Whether this host links a file and reads the file through the link.                    |
| `supportsMode`           | function | `() => boolean`                                                                                                     | Whether POSIX permission bits round-trip through this host's `chmod` and `stat` calls. |
| `supportsCase`           | function | `() => boolean`                                                                                                     | Whether names differing only by case are distinct files on this host.                  |
| `supportsBytes`          | function | `() => boolean`                                                                                                     | Whether a filename carrying a raw non-UTF-8 byte is written and read back.             |

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
manages its own directory can make the same check rather than trusting a path.

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

| API               | Kind     | Signature                                        | Summary                                                              |
| ----------------- | -------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `createScratch`   | function | `(options?: ScratchOptions) => ScratchInterface` | Allocates a directory below `parent` the caller owns and destroys.   |
| `createLoopback`  | function | `(server: Server) => Promise<LoopbackInterface>` | Binds a caller-supplied server to `127.0.0.1` on a host-picked port. |
| `createCookieJar` | function | `() => CookieJarInterface`                       | Records a real response's cookies and replays them as one header.    |

A refused `ScratchOptions` key leaves nothing behind, by two different mechanisms. `parent` and
`prefix` are checked before `mkdtempSync` runs, so a refused value allocates nothing. `files` is
seeded after the directory exists, so a refused key removes the directory that was just made and
rethrows.

`parent` is the existing directory the allocation is created in, and defaults to the host temporary
directory; allocation throws when it is missing, is a symbolic link, or is not a directory. `prefix`
starts the generated directory name, and defaults to `orkestrel-test-`; allocation throws when it
contains `/` or `\`, which is what stops a prefix steering the allocation out of its parent. Nothing
else is refused: a fragment carrying no separator is one path segment, so `release-0..2-` allocates.
`files` seeds files on allocation, keyed by path below the scratch directory; allocation removes the
directory it just made and rethrows when a key escapes or the host refuses a write.

`createLoopback` takes a `node:net` `Server` — `node:http`'s and `node:https`'s both extend it — and
never constructs one. It listens on port `0` at `127.0.0.1`, waits for the `listening` event, and
reads the assigned port off `address()`, throwing
`Loopback address must have a numeric port; found <address>` when that address carries none. Rule 11
states what `destroy()` drops, what `url` does and does not spell, and why this package never
reserves a port number.

## Methods

The call-signature members of each behavioral interface. Their `readonly` data members stay in the
[Surface](#surface) rows above.

#### `RecorderInterface`

| Method  | Returns | Behavior                                                                     |
| ------- | ------- | ---------------------------------------------------------------------------- |
| `clear` | `void`  | Truncates the recorded calls in place; the recorder stays usable afterwards. |

#### `EventSourceInterface`

| Method | Returns | Behavior                                                                                                                                                                             |
| ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `on`   | `void`  | Subscribes one handler to one event. The interface asks for the subscribe half alone, so a source that also removes handlers, emits, or counts subscriptions satisfies it unchanged. |

#### `ResourceFactoryInterface`

| Method    | Returns  | Behavior                                                                                                                                                                                                                          |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`  | `number` | Returns the next id and records it. The id is the creation record's length plus one, so it counts allocations rather than live resources: a destroyed id is never reissued, and clearing `created` restarts the numbering at `1`. |
| `destroy` | `void`   | Records the id it was given and nothing else. It frees nothing, refuses nothing, and accepts an id that was never created, so a suite asserts on the record rather than on a refusal.                                             |

#### `TeardownInterface`

| Method    | Returns         | Behavior                                                                                                                                                                                                                                 |
| --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add`     | `void`          | Registers one handler. Registration order is what `destroy()` reverses, so the newest registration is undone first.                                                                                                                      |
| `destroy` | `Promise<void>` | Runs every registered handler newest-first, awaiting each before the next, and empties the list. Every handler runs even after an earlier one fails; one failure rethrows by identity and several throw an `AggregateError`. Idempotent. |

#### `LoopbackInterface`

| Method    | Returns         | Behavior                                                                                                                                                                                                                                                                                               |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `destroy` | `Promise<void>` | Drops every live connection on a server that carries `closeAllConnections`, stops listening, and releases the port; a plain `net.Server` has no such method, so it waits for its open sockets to end. Idempotent: the first call's promise is handed to every later one, and a closed server resolves. |

#### `CookieJarInterface`

| Method    | Returns               | Behavior                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`    | `string \| undefined` | The stored value for one cookie name, or `undefined` when the jar holds none of that name.                                                                                                                                                                                                                                                                                                     |
| `capture` | `readonly string[]`   | Applies every `Set-Cookie` field the response carries — storing a new cookie, replacing one of the same name, or deleting one on `Max-Age=0` — and returns those fields unmodified, in the order the response carried them. A field carrying no `name=value` pair is read past and still returned. Selection is by name alone, so `Domain`, `Path`, `Expires`, and `Secure` are read past too. |

#### `PortfolioInterface`

| Method  | Returns                        | Behavior                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `place` | `Promise<string \| undefined>` | Places one registered state: applies the variant, stages the pane at its size, writes and verifies the screenshot, records it, and returns the written path. Takes an optional element to shoot instead of the page. `undefined` and no record at all when the run is not enabled. |

#### `JournalInterface`

| Method   | Returns | Behavior                                                                                                                                                            |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`  | `void`  | Clears both lists and arms the recording. On an already-started journal it clears and leaves the interception standing, so a restart never wraps its own wrappers.  |
| `stop`   | `void`  | Hands every intercepted console channel back by identity and drops the failure listeners. The recorded lists survive. Calling it on a stopped journal does nothing. |
| `record` | `void`  | Appends one frozen step. Does nothing while the journal is stopped, so a step taken before `start` or after `stop` is not recorded.                                 |

#### `ScratchInterface`

| Method    | Returns               | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write`   | `string`              | Writes a file at a path lexically contained by the directory, creating missing parents, and returns that lexical path. Throws on an escaping path, and on a root that is missing, a link, or not a directory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `read`    | `string \| undefined` | Reads a file, or `undefined` when no file can be read, including through a link whose target is missing and after the allocation is gone. Throws `Scratch path is a directory: <target>` on a directory, and throws on an escaping path and on a root that is a link or not a directory. Reading follows links, so a link the host cannot resolve, such as a cycle, surfaces the host's own error.                                                                                                                                                                                                                                                                                                                                                      |
| `has`     | `boolean`             | Whether the entry at a contained path is present, without following its final link, so a link whose target is missing still reports `true`. `false` once the allocated directory itself is gone. Throws on an escaping path, and on a root that is a link or not a directory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `names`   | `readonly string[]`   | The entry names directly inside a lexically contained directory, sorted, without their parent paths — the allocated directory itself when the target is omitted. Throws on an escaping path, on a target that is missing or is not a directory, and on a root that is missing, a link, or not a directory.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ensure`  | `string`              | Creates a directory at a lexically contained path and every missing parent, and returns that lexical path. It is the one member that produces an empty directory, because `write` always creates a file. Idempotent on a directory that already exists. Throws when the target exists and is not a directory, on an escaping path, and on a root that is missing, a link, or not a directory.                                                                                                                                                                                                                                                                                                                                                           |
| `link`    | `string`              | Creates a symbolic link at a contained path, creating its missing parents, and returns that lexical path whatever host mechanism created the link. The source is the destination path the link points at; it is not containment-checked, so it may name a destination outside the directory, and its exact stored text is not promised. Throws on an escaping path, on a root that is missing, a link, or not a directory, and when the host refuses the link — `EEXIST` when something already occupies the path. A host that creates no symbolic link falls back to a directory junction and refuses a source that exists and is not a directory; [Hosts that create no symbolic link](#hosts-that-create-no-symbolic-link) states that path in full. |
| `remove`  | `void`                | Removes the entry at a lexically contained path: a file, an empty directory, or a directory and its whole subtree. A missing target is a no-op rather than an error, so a caller removing something it created conditionally does not guard first. It acts at the final segment rather than through it, so removing a link removes the link and leaves its destination standing. Throws on an escaping path, on a target naming the allocation itself — lexically, or through an intermediate symbolic link — and on a root that is missing, a link, or not a directory.                                                                                                                                                                                |
| `destroy` | `void`                | Removes the directory this call allocated, and only that: it removes the entry at the allocated path while `matchesIdentity` holds against the allocation, and removes nothing when it does not. Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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
absent, present-but-gated, and ambiguous are three different findings about an interface.

| Voice                                                                                 | Thrown by               |
| ------------------------------------------------------------------------------------- | ----------------------- |
| `No interactive element has the accessible name "<name>"`                             | `resolveRendered`       |
| `Interactive target "<name>" is not visible and focus-reachable`                      | `resolveRendered`       |
| `Interactive target "<name>" is ambiguous across <n> elements`                        | `resolveRendered`       |
| `Interactive target "<name>" could not be resolved`                                   | `resolveRendered`       |
| `Interactive target "<name>" is unreachable after scrolling`                          | `resolveAccessible`     |
| `Interactive target "<name>" is not reachable inside "<region>"`                      | `clickAccessibleWithin` |
| `Interactive target "<name>" is ambiguous across <n> elements inside "<region>"`      | `clickAccessibleWithin` |
| `Interactive target "<name>" could not be resolved inside "<region>"`                 | `clickAccessibleWithin` |
| `Native disclosure "<name>" is not visible and focus-reachable`                       | `clickDisclosure`       |
| `Native disclosure "<name>" is ambiguous across <n> elements`                         | `clickDisclosure`       |
| `Native disclosure "<name>" could not be resolved`                                    | `clickDisclosure`       |
| `Interactive target "<name>" is not reachable through forward Tab traversal: <trail>` | `traverseAccessible`    |
| `Named region "<name>" is not visible`                                                | `readPerception`        |
| `Named region "<name>" is ambiguous across <n> elements`                              | `readPerception`        |
| `Named region "<name>" could not be resolved`                                         | `readPerception`        |
| `Interactive target "<name>" does not carry a value`                                  | `readValue`             |
| `Computed foreground color is unavailable`                                            | `contrast`              |
| `Computed background color is unavailable`                                            | `contrast`              |
| `Tester pane is unavailable for a capture`                                            | `stagePane`             |
| `Tester pane rendered <w>x<h> for a <w>x<h> viewport`                                 | `stagePane`             |
| `Capture frame was written to <path> where <path> was asked for`                      | `captureFrame`          |
| `Capture frame at <path> is not the one this run shot`                                | `captureFrame`          |
| `Capture variant "<name>" is not registered`                                          | `createPortfolio`       |
| `Capture state "<state>" is not registered`                                           | `place`                 |
| `Capture state "<state>" is already placed`                                           | `place`                 |
| `IndexedDB database "<name>" could not be deleted`                                    | `removeDatabase`        |
| `IndexedDB database "<name>" is blocked by an open connection`                        | `removeDatabase`        |

Some of them are narrowing rather than findings, and no input reaches them. Each `could not be
resolved` is one: a preceding length check does not narrow the later lookup under
`noUncheckedIndexedAccess`, so the branch gives the value its type.

The capture guards are the other population no test drives, because each answers for a runner or a
provider this package does not control. `Tester pane is unavailable for a capture` fires where
Vitest stops laying its tester out inside a pane. `Capture frame was written to <path> where <path>
was asked for` fires where the provider resolves a screenshot path against a base other than the
calling test file. `Capture frame at <path> is not the one this run shot` fires where the file on
disk disagrees with the bytes the provider handed back — which a provider that overwrites its target
never produces, so the suite proves that comparison discriminates with a planted file rather than by
reaching the refusal.

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
   exactly, including `null` and `undefined`, and it never throws for a thunk that completed. Two
   limits come with that. A thunk that throws `undefined` is indistinguishable from one that
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
   `Date`, a `Map`, or any method-bearing type at the member that carries it. Three more members
   meet `never` for one reason: the copy would not carry what the type claims. Serialization drops a
   member typed `undefined` from an object and rewrites it to `null` in an array, so
   `{ a: undefined }` and a top-level `undefined` are both refused at the call. `JSON.stringify`
   never enumerates a symbol-keyed member, so the copy arrives without it. And a member declared as
   the opaque `object` type projects over no members at all, so a `Date` under it would copy back as
   a string, off the type the member declares. One member type does pass through: `unknown`, so
   `Record<string, unknown>` is accepted and what its values hold is a runtime question rather than
   a typed one. The bound is not enough on its own either: `NaN`, `Infinity`, and `-Infinity` are
   numbers, they satisfy it, and `JSON.stringify` turns each of them into `null`. So the helper
   rejects a non-finite number at any depth with `JSON values must contain finite numbers`, and the
   copy's type claim holds for every value it does return. The replacer alone would not close it: a
   `JSON.rawJSON` value carries text `JSON.stringify` emits without inspecting, so
   `JSON.rawJSON('1e400')` passes the replacer untouched and parses back as `Infinity`. The helper
   therefore checks the parsed graph as well, and both doors report the same message. One
   normalization remains and is not an error: `-0` serializes as `0`, so the copy is `0`.
6. **`readInventory` refuses links.** A target is a file or a directory. A named file is read and
   keyed whatever `extensions` says, which is what lets one call take a package's root files and its
   source tree together; a named directory is walked under the filter. It throws when the root or a
   named target is a symbolic link, when the root is not a directory, when a target is neither a file
   nor a directory, or when a target resolves outside the root. A missing target surfaces the host's
   own `ENOENT` rather than a message from this package. It skips a symlink met while walking rather
   than following it. A target may be written relative to the root or as an absolute path inside it,
   and one that escapes is refused either way.

   A link in the **middle** of a named target is the fourth refusal, and the only one that reaches
   it: the symbolic-link check reads the final segment, which such a link is not. The named target is
   resolved with `realpath` and refused when the real path leaves the root, so
   `readInventory(root, ['link/file.txt'])` with `link` pointing outside throws
   `Target outside root: link/file.txt`. When that link stays inside the root the target resolves,
   and the entry is keyed by its **real** path rather than by the path the caller named.

   An exclusion applies to a named target as well as a walked entry, so exclusion beats naming:
   `readInventory(root, ['src/core/index.ts'], { exclude: ['src/core'] })` returns `{}`. A
   `tsconfig` reader expects the more specific entry to win, the way a `files` entry survives
   `exclude`; here the more specific entry is the one that disappears. Express an exception with a
   second call that names the kept file and passes no exclusion, and merge the two maps. An
   exclusion is normalized before the rule applies: a leading `./` and a trailing `/` are stripped,
   and `''` and `'.'` both name the root, so either drops every key. Keys are root-relative and
   separated by `/` whatever the host separator is. The suite runs on POSIX, where `/` is already
   the separator, so it proves the key shape and not the conversion. The map is built by inserting
   the keys in sorted order. Read back, non-integer keys hold that order. Integer-like keys do not,
   because a plain object enumerates them numerically first: four files named `0`, `2`, `10`, and
   `a.txt` insert as `0`, `10`, `2`, `a.txt` and enumerate as `0`, `2`, `10`, `a.txt`. Returning a
   `ReadonlyMap` would keep the order and break the structural match with `@orkestrel/guide`'s
   `SourceOptions.files` that the whole helper is shaped for, so the guarantee narrows instead. Case
   is the host's decision, not this package's: whether two names differing only in case are one file
   varies by filesystem, so the suite probes the running host and asserts what the probe returned
   instead of assuming either answer.

7. **`createScratch` refuses a lexical escape, not a symbolic link.** It allocates with
   `mkdtempSync` below `parent`, which creates the directory at POSIX mode `0700`. The suite asserts
   that mode unguarded, so it is proven on POSIX and unproven on a host that emulates permission
   bits. Every member that takes a target — `write`, `read`, `has`, `names`, `ensure`, `link`, and
   `remove` — throws when that target lexically escapes the allocated directory, and a failed seed
   removes the directory before rethrowing. `remove` adds one refusal the others do not need: a
   target naming the allocation itself, lexically or through an intermediate symbolic link. The
   lexical half compares paths. The physical half reads only the final entry with `lstat` and
   compares it with `matchesIdentity`; it walks no path segments and follows no final link. That is
   the comparison `destroy()` makes, so it carries the same birth-time limit stated for `destroy()`
   below. `link` checks its target and not its source, so a contained link may point anywhere.
   `createScratch` does not walk the path's segments for symbolic links: that is sandbox behavior
   and this is not a sandbox. So a lexically contained path can still act outside the allocation,
   and only one that lands back on the allocation itself is refused; [Traversal](#traversal) states
   what each member does with a link it meets, and the [threat model](#threat-model) says who
   creates one.

   `names` sorts, and the suite discriminates a dropped `.sort()`. Two filenames written from raw
   bytes give `readdirSync` the reverse of sorted order: `0x80` is an invalid UTF-8 lead byte, so
   that name reaches JavaScript as `U+FFFD` and sorts after `é`, while on disk `0x80` sorts before
   `é`'s leading `0xc3`. The suite asserts the host's order, the sorted order, and that the two
   differ, so it fails rather than going quiet if that population ever stops discriminating.

   That population carries a limit, and it is Node's rather than this package's. A name the host
   refuses to decode reaches JavaScript as `U+FFFD`, and that string re-encodes to the three bytes
   `EF BF BD`, which are not the bytes on disk. So the string `names()` hands back never addresses
   the entry it came from: `has` on it reports `false`, and `remove(names()[i])` removes nothing and
   throws nothing, because a missing target is a no-op. The silence is the cost — a caller looping
   over `names()` to clear a directory leaves such a file behind and reads success. Reach that file
   with a `Buffer` path through `node:fs` directly.

   `destroy()` is idempotent, and identity is what makes it safe rather than location: it removes
   the entry at the allocated path only while `matchesIdentity` holds against the allocation. A
   replacement directory left at that path is not removed, and an allocation moved elsewhere is not
   removed at all. That comparison never consulted the host temporary directory, so it holds
   unchanged wherever `parent` puts the allocation. Two limits sit beside the `0700` one. The check
   reads the entry and then removes the path as two steps, so an allocation swapped between them is
   removed anyway; whoever swaps it runs as the same uid, which is the population the threat model
   already declines to defend against. And birth time is the host's to supply. This host supplies a
   real one — the allocation's `birthtimeMs` does not move when files are written into it, while its
   `ctimeMs` does — so `destroy()` is sound here. Where a host has none, libuv reports `ctime` in its
   place, the first seeded write moves it, and `destroy()` takes its early return. It returns `void`,
   so that refusal is indistinguishable from success and the allocation leaks silently.

8. **A destroyed allocation answers presence and refuses action.** `read` returns `undefined` and
   `has` returns `false`; `write`, `names`, `ensure`, `link`, and `remove` throw
   `Scratch directory does not exist`. The split follows the return type: a member whose return type
   carries absence answers with it, and a member whose return type does not, refuses. `names` asks a
   question and changes nothing, and it refuses anyway, because `readonly string[]` has no value
   meaning gone. `write`, `ensure`, and `link` are why the refusal is written out rather than left to
   the host: each calls `mkdirSync` with `recursive`, which recreates every missing parent, so
   without the check any of the three would rebuild the allocation root and leave a destroyed
   fixture looking alive. `remove` is written out for the opposite reason: `rmSync` with `force`
   does not throw on a path that is not there, so without the check it would report success against
   a fixture that is gone.
9. **Zero runtime dependencies, and no foreign type in a signature.** `dependencies` is empty and
   stays empty. No exported signature names an `@orkestrel/*` type, so no consumer can be handed a
   two-copies type failure by installing this package.
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
    `afterEach(() => teardown.destroy())` once, in its own setup. That one line is the price of the
    zero-dependency contract, because registering the hook here would take a runtime dependency on
    the test runner and rule 9 forbids one.
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
    returns a frozen array of fresh values: a self-cycle, a revoked proxy, proxies that throw from
    `get`, `ownKeys`, and `getPrototypeOf`, and a null-prototype record. Every member makes a naive
    reader throw. Each has a direct probe for that failure. The negative control keeps an inert value
    from entering the corpus under a hostile name. A total guard survives every member without
    throwing. Whether it accepts or refuses one is that guard's own contract. Membership may grow in
    a release, so consumers loop over the whole array, assert their guard's expected answer per
    index, and attribute each failure by that index instead of naming or counting members locally.
13. **The journey layer resolves its own targets, and imports almost nothing.** No journey verb in
    `src/browser` accepts an element, a component instance, or a selector for the target it acts on:
    each finds its own from a role and an accessible name, which is what stops a journey drifting
    into a description of the markup. `build` creates a node, `mount` attaches one, `render` does
    both, `clearStorage` takes nothing at all, and `removeDatabase` takes a database name. The
    predicates, the element readers, and the describers do take a node —
    `isRendered`, `isReachable`, `readText`, `readRole`, `readName`, `readStates`, `describeTree`,
    `describeFocus`, `extractOrphans`, `readRows`, `style`, `token`, `pixels`, `contrast`,
    `readLayers`, `readBackdrop`, and `readRing` — and each is a reader of a node the caller already
    has rather than a verb that acts on a target. `captureFrame` and `place` take one as the subject
    of a photograph, which is a reading too: neither moves focus, dispatches an event, nor changes
    what the element renders. `typeInput` and `commitInput` are the one pair that acts on the
    element it is handed, and the exception is deliberately narrow: they are the synthetic
    counterpart of `typeAccessible`, for a component that listens for `input` and a test that
    already holds the field. Drive the field by name wherever the keystrokes are part of what the
    journey claims.
    `readRing` is the case that makes the split explicit. It measures the focus chrome a browser
    painted and never brings the focus about, so a journey reaches the control through
    `traverseAccessible` or `pressKeys` and then measures what landed.
    The whole environment imports `vitest/browser` and DOM globals and nothing else — no `src/core`
    import, no framework, no `node:*`, and no `import.meta.env`, so whether a run writes captures is
    the consumer's decision through `PortfolioOptions.enabled` rather than an environment variable
    this package reads. `vitest` is a peer dependency, so the provider the layer drives is the one
    the consumer already installed, and rule 9's empty `dependencies` is untouched.
14. **The wait family polls only where nothing publishes an event.** The no-polling architecture law
    governs a product's idle wakeup: a running system parks on the event or the abort signal that
    fires. A test instrument is the other case. It waits on a fact another process produces — a file
    a build wrote, a port a child bound, a handle a host has not released — and that fact publishes
    no event to park on, so `waitForCondition` re-reads the condition through `waitForDelay` inside a
    budget measured with `performance.now()`. Where an event does exist, `waitForEvent` is the door:
    it parks on the subscription, validates the interval for consistency with the family and never
    uses it, and invokes the cleanup the subscriber returned on timeout, on abort, and on delivery
    alike. `waitForCondition`, `retryUntil`, and `waitForEvent` each name what they are waiting for,
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
    the `[inert]` ancestor. A control clipped to a
    zero-size rectangle is the case that separates them: the accessibility tree still announces it,
    so `isRendered` accepts it and `isReachable` refuses it. `isReachable` is the one reachability
    filter the layer applies — `resolveRendered`, `clickAccessibleWithin`, and `clickDisclosure` each
    narrow their own candidates and then keep the ones it accepts — so a journey meets one rule
    rather than near-copies of it. Neither asks about the viewport; `resolveAccessible` scrolls a
    wholly off-viewport target into view and measures that separately with `isOutsideViewport`.
17. **A journal forwards every console call and swallows nothing.** A browser publishes no listener
    for its own output, so `createJournal` stands in front of the console and hands each call on to
    the channel that was there when `start` armed it. A run under a journal therefore prints exactly
    what it prints without one, which is what stops a recording from hiding the diagnostics it exists
    to keep. `stop` puts those same function references back by identity, so a channel another tool
    installed survives the journal rather than being replaced by a copy of it. `start` clears both
    lists whether or not the journal was already recording and leaves a standing interception alone,
    so a restart never wraps its own wrappers. `record` does nothing while the journal is stopped,
    and `steps` and `output` hand out snapshots. There is no shared instance: a file that needs one
    journal per scenario creates one per scenario.
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
    suite shipping thumbnails nobody inspects.

### Threat model

The two filesystem helpers make different promises, because they work on different directories.
Read rule 7 against the `createScratch` paragraphs below and rule 6 against the `readInventory` one.

`createScratch` allocates its own directory with `mkdtempSync` at POSIX mode `0700`, and the suite
asserts that mode on POSIX, the only host CI runs. The mode keeps another uid out. It does not keep
out a sibling test worker or the code under test, because both run as the same uid, and they are the
population that would create a link here. Its containment check is lexical: it refuses a relative
path that escapes the allocated directory, which is the accident that actually happens — a test
writing `../foo`. It does not walk the path's segments for symbolic links, because per-segment
walking is sandbox behavior and this is not a sandbox.

So a link inside the allocation was created by the test process or by the code the test drives, and
handing `scratch.path` to the code under test is the ordinary use of this helper. `link` is this
package's own entry in that population: it creates a symbolic link on request, it refuses only an
escaping target, and its source may name anything. The source stays unchecked except on the fallback
path, which stats it to decide whether a junction can point there. [Traversal](#traversal) states
what each member does with a link it meets, and a contained path reaching outside the allocation
through one is the result. This helper does not defend against that.

`parent` adds one limit, and it is visibility. An allocation under the host temporary directory is
seen by nothing in the repository. An allocation under a path inside a package tree is seen by
everything that walks that tree while it exists — `tsc`, the formatter, the linter, the policy
sweep, and the test runner's own globs. Set `parent` to a path those tools already ignore, or leave
it unset and take the host temporary directory. `destroy()` is unaffected either way, because it
matches on identity rather than on where the allocation sits.

`readInventory` walks a directory the caller supplies, usually a real checkout the test did not
create, so it does refuse links. It keeps four separate refusals: it throws on a symlinked root,
throws on a symlinked named target, throws on a named target whose real path leaves the root through
a link in the middle, and skips a symlink met while walking. They are four decisions rather than one
rule, and each is its own check at the door it guards.

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

The journey layer in `src/browser` is that second case. It is what `orkestrel-human-journey`
requires every browser workspace to implement, and a workspace writing its own copy of it writes a
slightly different resolver, a slightly different set of failure voices, and a journey that reads as
if it proved something it did not. Publishing it once is what keeps those implementations identical.
Touching the DOM buys nothing on its own: the browser candidates the survey raised are ruled below
one at a time, and some of them ship while others do not.

A member is one implementation group carried by one package, under whatever name that package
spells it and whether it exports the helper or declares it inside a test file. Repeated calls routed
through one shared implementation stay one member, and a set of adversarial values fed through one
totality loop is one member rather than one per value. Read the first column as the group rather
than as an export: **nothing in this section is importable**, and the only names you can install are
in [Surface](#surface).

The table records the evidence and the ruling for each candidate the fleet survey raised. Revisit a
row when the candidate's shape changes, when a native or declared primitive appears that covers it,
or when a consumer appears the ruling did not consider.

| Candidate                                                                                        | Ruling  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A recorder map over an emitter's events, with its map, event-map, subscriber, and totality types | Ships   | It ships as `createRecorders`, with `RecorderMap` and `EventSourceInterface` beside it. Inference is what the earlier refusal turned on, and the shape improves it without settling it: a source parameter typed `EventSourceInterface<TMap>` is an inference site, so a call against one names no type argument, while a concrete class supplies none and the call names both. A keying limit survives that: `TName` derives from the events array's element type, so an array declared with a wider union than its contents keys the map past the events actually listed, and [Bounds a shipped helper carries](#bounds-a-shipped-helper-carries) states what to pass instead. A published signature still cannot import a consumer's event map, so the interface asks for the subscribe half alone and the consumer's own map is what it is instantiated with. |
| Hostile guard-input sets                                                                         | Ships   | `form`, `table`, and `supervisor` each feed one adversarial set through total readers, and the set is a mechanism rather than a policy: a guard's own contract decides the answers, not the corpus. It ships as `createHostileValues`; its members do not each become a factory, and every member carries a naive-reader negative control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Raw invocation — `invokeRaw`                                                                     | Ships   | It ships as `invokeUnchecked`, with `readProperty` beside it for the read. Native `Reflect.apply` still makes the call; what these add is the boundary — a callability refusal before the call, a target refusal before the read, and one named place where an unchecked runtime result meets the type its caller claims. The claim stays the caller's, and so does the guard that narrows what came back. Without them a consumer that bans `as` cannot drive a foreign object at all.                                                                                                                                                                                                                                                                                                                                                                           |
| Condition polling — wall-clock predicate loops                                                   | Ships   | Rule 14 states the distinction: the no-polling architecture law governs a product's idle wakeup, and a test instrument waiting on a fact another process produces has no event to park on. It ships as `waitForCondition`. `retryUntil` ships on the same reading, because retrying a real operation is not re-reading a predicate; and where an event does exist, `waitForEvent` is the door.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Deep nesting beyond a guard's cap                                                                | Refused | `table` builds a record chain and `supervisor` builds nested arrays. The two nest different containers, so one shared factory needs a selector argument that changes the construction algorithm — a mode switch rather than a mechanism.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Canonical wire fixpoint assertions                                                               | Refused | `form` and `table` each serialize, parse untrusted JSON, serialize again, and compare exact bytes. The comparison is an assertion over the consumer's own codecs rather than a reusable mechanism, so the shape stays consumer-local and [Prove a wire fixpoint](#prove-a-wire-fixpoint) publishes the pattern instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Numeric corpora, hostile-key tables, and deep-freeze                                             | Refused | A numeric corpus or a hostile-object table is test policy — what a given suite decided to check — rather than a mechanism, and one factory covering the variants would need a mode argument. `createHostileValues` ships because a guard's totality is a property of the guard; these encode a decision about coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Clearing web storage between tests                                                               | Ships   | Emptying local and session storage together is one mechanism, and the `afterEach` hook that must run after a failed test too is where every browser suite needs it. It ships as `clearStorage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Class-ancestry orphan detection                                                                  | Ships   | A rendered element carrying a child class with no container class above it is a real invariant a stylesheet cannot state, and the check is mechanism when the class names are parameters rather than one framework's. It ships as `extractOrphans(root, child, parent)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A DOM element builder                                                                            | Ships   | It ships as `build` for the element and `mount` for the attachment, and `render` widened to take a tag and its class list as well as markup. A class list, a text, and an attribute map are what a fixture actually varies, and expressing that variation through markup means assembling a string. Nothing here assembles a tree one call at a time: a fixture with children is still written as markup.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A surface digest — `describeSurface`                                                             | Refused | Its digest format is one workspace's policy about what a summary of a surface contains, and it is assembled from the excluded `extractControls` besides. `describeTree` and `describeFocus` publish the readings a digest is built from instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A control extractor — `extractControls`                                                          | Refused | Generalized past its one caller it is a wrapper over `querySelectorAll` that adds no boundary, invariant, composition, or narrower contract, which is what the superfluous-wrapper rule refuses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Text resolution by selector — `resolveText`                                                      | Refused | Rule 13 is the contract it breaks: a journey verb resolves its own target from a role and an accessible name, and one that takes a selector turns a journey into a description of the markup. Taking a node the test already holds is a different thing, which is what the element readers do; `findRule` takes a selector because its subject is the stylesheet rather than a target to act on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A hand-driven timer — `terminal`, `toolbox`                                                      | Refused | `toolbox` runtime-depends on `terminal`, so the two are one implementation rather than independent demand. The shape is also `@orkestrel/terminal`'s published `TimerHandler`, which a copy here would redeclare unversioned and hand consumers a second incompatible type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A hand-driven clock — `mcp`, `middleware`                                                        | Refused | `AGENTS.md` bans replacing the host clock outright, so publishing one from the fleet's own test package would sanction across every workspace the substitution those rules refuse. `waitForDelay` waits on a real host timer and `waitForCondition` bounds a real elapsed interval with `performance.now()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A reserve-then-release port picker                                                               | Refused | It binds a port, closes it, and hands the number to a child that binds it again, and the window between that close and that rebind is a race another process on the host can win. Have the child bind `0` and report back the port it was given; `createLoopback` does exactly that for a server the test owns itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| An abort-signal wait — `waitForAbort`                                                            | Ships   | It ships as `waitForAbort`. Every bounded member still takes `WaitOptions.signal` and rejects with the signal's own reason, so a bounded wait needs nothing here; this answers the other case, where the abort is itself the fact the test waits for. It parks on a one-shot listener with no timer and no budget, so a signal that never aborts is the caller's own deadlock rather than a timeout this could name.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Abort-signal instrumentation                                                                     | Ships   | It ships as `createSignal`. A recorder handed to `addEventListener('abort', …)` still records what one listener heard; what no recorder can answer is how many listeners stand on the signal at this moment, which is the question a leak asks. The instrumented signal counts its own abort registrations, keyed by the original callback and the capture mode, so a helper that removes what it added proves the removal. A registration leaves the tally on removal, on a one-shot delivery, and when a signal scoping it aborts, which is what makes the reading a live tally rather than an install count.                                                                                                                                                                                                                                                   |

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

- **`rgba` resolves an undeclared token to the inherited color.** A `var()` naming a custom property
  nothing declares is not a parse failure: the cascade accepts it and computes the inherited color,
  so `rgba('var(--absent)')` hands back channels rather than `undefined`. Read `token` or `rootToken`
  where a missing token is the subject.
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
- **`readProperty`'s `TypeError` names the target, never the read.** It refuses a target that is
  neither an object nor a function before it reads anything, and a getter that throws on an accepted
  target hands that throw straight to the caller. Wrap the call in `captureError` where a hostile
  getter is the subject.
- **`pixels` reports a measured contribution rather than a parsed length.** A resolved value carrying
  no leading number — `'auto'`, `'none'`, `''` — reads as `0`, because none of them contributes a
  pixel to what a reader sees, so a caller cannot tell an unparsable value from a genuine zero. Read
  the text with `style` where that distinction is the subject.

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
an event, because parking on it beats reading for it. Rule 14 states why a test instrument polls
where a product must not.

Name the wait in every case. The description is what the timeout message carries, and a wait nobody
described times out saying nothing about what failed.

In the fence below, `isBuilt` reports whether a build running outside the test has produced its
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

### Copy a JSON value

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

### Read a source inventory

The pairing `resolveRoot` and `readInventory` is what a guides-parity suite needs: the workspace
root from `import.meta`, then the file map. Rule 6 states what an exclusion matches; the last call
below is the part that surprises people.

```ts
import { resolveRoot } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'

// From tests/guides.test.ts, one directory up is the workspace root.
const root = resolveRoot(import.meta)

Object.keys(readInventory(root, ['src/core'], { extensions: ['.ts'] }))
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts']

// A named file is included whatever `extensions` says, so one call takes the root files a suite
// needs and the source tree it walks.
Object.keys(readInventory(root, ['package.json', 'src/core'], { extensions: ['.ts'] }))
// ['package.json', 'src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts',
//  'src/core/types.ts']

Object.keys(
	readInventory(root, ['src/core'], {
		extensions: ['.ts'],
		exclude: ['src/core/index.ts'],
	}),
)
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/types.ts']

// A directory key takes every key below it.
Object.keys(readInventory(root, ['src'], { extensions: ['.ts'], exclude: ['src/server'] }))
// ['src/core/factories.ts', 'src/core/helpers.ts', 'src/core/index.ts', 'src/core/types.ts']

// An exclusion also applies to a target you name, so naming one file below an excluded directory
// does not reinstate it.
readInventory(root, ['src/core/index.ts'], { extensions: ['.ts'], exclude: ['src/core'] })
// {} — take the exception in a second call, and merge the two maps
```

### Own a temporary directory

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
directory a just-exited child held as its working directory: `removeTree` retries that removal ten
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
	teardown.count // 0 — the list is empty, so the hook above then runs nothing
})
```

### Answer a real request on a loopback port

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

In the fence below, `loopback` is the origin the preceding section bound, and its `/session` route
answers with real `Set-Cookie` fields.

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
and lays out no box, so `style`, `token`, and `pixels` each answer with the initial value — which
reads as a styling defect rather than as a detached node — and `contrast` refuses the element
outright, because its computed foreground color does not exist. `build` sets its `text` as text
rather than as markup, so a `<` in it stays a `<`; write the fixture as markup where the fixture is
markup.

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

`contrast` measures the ratio between an element's rendered text and what is actually behind it, not
between the two colors its own rule declares. It walks the ancestors from the element up to the
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
import { CANVAS_COLOR, contrast, render } from '@orkestrel/test/browser'

const surface = render('<main style="background:#fff"><p style="color:#767676">Ready</p></main>')
const text = requireValue(surface.querySelector('p'))

contrast(text).toFixed(2) // '4.54' — measured against the white the ancestor really paints
contrast(text) >= 4.5 // true — the WCAG 2.x floor for body text

// A fragment with no painted ancestor is refused rather than assumed.
const fragment = render('<p style="color:#767676">Ready</p>')
const orphan = requireValue(fragment.querySelector('p'))
contrast(orphan) // throws Error: Computed background color is unavailable

// Name the surface it is really on, and the same stack measures.
contrast(orphan, CANVAS_COLOR).toFixed(2) // '4.54'
```

`readRing` is the same reading for focus chrome, and it reads only: focus arrives through
`traverseAccessible`, `pressKeys`, or a real click, and this measures what the browser painted after
it landed. It reports `undefined` for a control that is not matching `:focus-visible`, for one left
the browser's own `outline-style: auto` ring, and for a focus style that only repaints the control's
fill — in each case no measurement taken here would be about focus.

```ts
import { requireValue } from '@orkestrel/test'
import { readRing, traverseAccessible } from '@orkestrel/test/browser'

const focused = await traverseAccessible('Evaluate')
readRing(focused) // the ratio the painted outline or box-shadow reaches against its backdrop

// Some controls are two elements. `worn` names the one the chrome is painted onto.
readRing(focused, requireValue(document.querySelector('label[for="evaluate"]')))
```

### Read the tokens and colors a theme declares

`token` and `rootToken` read what the cascade resolved, and `rgba` resolves any color expression by
asking the same browser. In the following fence the document declares `--ink: rgb(1, 2, 3)` on `:root`,
`.card` sets `padding-left: 12px`, and `card` is a mounted element carrying that class.

```ts
import { colorEqual, pixels, rgba, rootToken, token } from '@orkestrel/test/browser'

rootToken('ink') // 'rgb(1, 2, 3)'
rootToken('--ink') // 'rgb(1, 2, 3)' — the dashes are optional
token(card, 'ink') // 'rgb(1, 2, 3)' — inherited from `:root` by a mounted element
token(card, 'absent') // '' — an undeclared token reads as a token declared empty does

rgba('var(--ink)') // [1, 2, 3, 1]
rgba('rebeccapurple') // [102, 51, 153, 1]
rgba('not-a-color') // undefined — the CSSOM refused the expression
colorEqual('rebeccapurple', 'rgb(102, 51, 153)') // true
colorEqual(token(card, 'ink'), 'rgb(1, 2, 3)') // true

pixels(card, 'padding-left') // 12
pixels(card, 'width') // 0 — a width resolving to `auto` carries no number
```

Assert on the value rather than on presence. An absent token and one declared empty both read as
`''`, and `rgba` resolves a `var()` naming an undeclared property to the inherited color rather than
refusing it, so a test that means to catch a missing token compares what `token` returned.

### Find a rule in the cascade

Assert on the stylesheet where the stylesheet is the subject, and on `style` where the rendered
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
claim about what a reader sees is asserted through `style`, `token`, `pixels`, or `contrast` instead.

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

Rule 17 is the contract behind that: the journal forwards every console call to the channel that was
there when it started, so a run under a journal prints exactly what it prints without one, and
`stop` puts those same function references back by identity. `record` does nothing while the journal
is stopped, so a step taken before `start` or after `stop` is not recorded, and `steps` and `output`
hand out snapshots. There is no shared instance: create one journal per scenario.

### Place a capture portfolio

The registry is declared once, the run renders one variant, and the same expansion answers both
"what should exist" and "what did".

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

Each entry names the rules its file proves. The test names carry the cases.

- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — rules 3, 4, 5, and 14, plus
  `waitForDelay` against a real elapsed interval and `resolveRoot` against the calling file. The wait
  family takes its bounds and its two throw directions: `waitForCondition` takes an immediate read
  under a zero budget, a later read that holds, an asynchronous condition, the timeout naming the
  condition and the budget, a condition throw propagated unchanged, an abort that rejects with the
  signal's reason and stops reading, a true reading taken after the final interval, and the refused
  bounds. `retryUntil` takes a first satisfying attempt and a later one, the exact satisfying value,
  exhaustion by attempts and by budget, producer throws counted as attempts with the last one kept as
  the cause, a predicate throw propagated unchanged, and an aborted retry. `waitForEvent` takes the
  exact delivered tuple, a timeout and an abort each naming the cleanup they invoked, and a second
  delivery ignored after settlement. `decodeJSONLines` takes empty input, a trailing newline, CRLF,
  line order, primitive lines, and a malformed physical line named with the native `SyntaxError` as
  its cause. `collect` and `collectStream` drain an empty and an ordered source, and the stream's
  reader lock is released afterwards. `roundTripJSON` takes a copy of a flat and a nested
  interface-typed value with fresh references, a record of `unknown` values, the projection's `never`
  at an opaque `object` member and at a symbol-keyed one, `undefined`, a function, and a symbol
  refused at depth under an `unknown` member, a `Date` under one copied as its serialized string, the
  non-finite refusal at every depth and through `JSON.rawJSON`, the `-0` normalization, and a large
  array and object copied without exceeding the host's argument limit.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — rules 2, 10, and 12.
  `createRecorder` records typed tuples in call order, and truncates a `calls` array the test
  captured before the `clear()`. `createTeardown` takes newest-first order across synchronous and
  asynchronous handlers, a synchronous throw and an asynchronous rejection each rethrown by identity
  with every remaining handler still run, both together aggregated in run order, a handler added
  during a run kept for the next call, the count reset before the handlers run, and a `destroy()`
  that is called empty and called twice. `createHostileValues` proves a naive-reader failure for
  every member, frozen and fresh membership, and one total guard's benign and hostile answers with
  loop-index attribution.
- [`tests/src/browser/helpers.test.ts`](../tests/src/browser/helpers.test.ts) — rules 13, 15, and 16
  across the layer, in real Chromium against constructed markup. The resolver takes a bare name, a
  role that disambiguates a tab from its own panel, a name no element carries, a name carried only by
  a role outside `ACCESSIBLE_ROLES`, and the disabled, hidden, and inert matches that are present but
  gated; `resolveAccessible` takes a target scrolled into view and one fixed outside the viewport
  that stays there, and `isOutsideViewport` takes a rectangle wholly beyond each edge and one
  straddling an edge. `isReachable` takes a plain control and each condition it drops, a control the
  document no longer holds, a focusable SVG against an element from a foreign namespace, and the
  refused summary that proves it is the one filter the acting verbs apply; `isRendered` takes each
  removal a browser honours and, as the split from `isReachable`, a zero-size announced control.
  Each acting verb takes its happy path and every voice it owns, including both
  region-scoped refusals and both native-disclosure ones. `traverseAccessible` takes a Tab-reachable
  target; as the cap control, a lone target whose own focus handler blurs it, so focus never lands
  and the cap fails with an empty trail; and, as the cycle control, the same self-blurring target
  behind a reachable decoy, so the traversal completes one cycle and reports the decoy in its trail.
  The page readers take their own inputs: `readPerception` takes one named region including its
  visually hidden text and its not-visible and ambiguous refusals, `readPage` the whole page as one
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
  `contrast` takes a translucent surface composited onto the opaque layer beneath it, a fully opaque
  stack over two different ancestors as the control from outside that population, a stack where
  nothing paints and one whose every painted layer is translucent, a stack 64 translucent layers
  deep whose composite has rounded to the canvas's own channels, a detached element whose computed
  foreground does not exist, and the same unpainted and translucent stacks measured against a
  supplied floor instead of refused. The color
  leaves beneath it take their own inputs: `parseColor` across the legacy and modern syntaxes, a
  refused keyword, hex triple, empty value, and unsupported color space, and — as the control the
  literals cannot supply — what this browser actually computes for a keyword and for a
  `color-mix()`. `blendColor`, `measureLuminance`, and `measureContrast` take their identities,
  their ordering, and the symmetry of the ratio. `readLayers` takes an unpainted stack, a
  transparent layer left out of a painted one, an opaque layer that ends the walk, and the deep
  stack whose last layer stays translucent while its composite no longer separates the floors;
  `readBackdrop` takes the floor returned by identity, a translucent stack composited onto it, and
  an opaque layer that ends the walk.
  `readRing` takes a painted outline and a painted box-shadow reached through `traverseAccessible`,
  a control that is not focused, a focused control left the browser's own ring, a focus style that
  only repaints the control's fill, and a `worn` element whose reading separates from the control's
  own. `stagePane` takes the marked pane, the tester
  rendered at the viewport it was given, and a release that runs twice without complaining;
  `captureFrame` takes a real file written, read back, and matched, with a planted file as the
  comparison's negative control, one element shot rather than the page, and a pane pinned to the
  wrong size by a rule of higher specificity, which is the refusal that also proves the release runs
  on the failing path. `readCascade` takes class tokens collected from plain and grouped rules and
  only real ones; `readRows` takes a row joined from its own text nodes rather than from run-together
  content, and an empty list; `extractOrphans` takes a child class rendered outside its container
  with a nested one left alone, nothing reported when every child sits inside one, and, as the
  control, an element answering the invariant by carrying both classes itself; `style` takes the
  browser's resolved value for one property. `expandCaptures` takes the exact expected file list
  rather than a count, and both empty inputs.
- [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts) — rule 17, and the
  portfolio's refusals, its disabled gate, and its writes. Creation refuses an unregistered variant
  name; the registry expands across every variant whether or not the run writes; a run
  that is not enabled applies nothing, writes nothing, and records nothing; an enabled run applies
  the variant, resizes the viewport, writes a real file through the provider, records it, and hands
  out snapshots rather than its own lists; it refuses an unregistered state and a second placement of
  one state; and a placement handed an element writes a frame that is not the whole page's and leaves
  the staged pane released. `createJournal` takes a step recorded only while it is started, every
  console channel forwarded to the recorder that was there, the arguments of one call joined into one
  line, an uncaught error and an unhandled rejection recorded and then ignored after the stop, the
  channels handed back by identity with a second stop proven a no-op against a replacement, a restart
  that clears both lists while keeping one wrapper rather than stacking two, snapshots that stay what
  they were, and one journal's recording kept out of another's.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — rules 6 and 14, and
  each pure leaf against its own inputs. `resolveContained` takes contained relative and absolute
  targets and both spellings of an escape. `matchesIdentity` takes a triple matching in every field
  and one differing in each. `isExcluded` takes a key, an ancestor, the root, and a sibling that only
  looks like a match. `readInventory` takes key order, extension filtering, exclusion at the named
  door and at the walked one with its spellings normalized to one rule, each of its link refusals
  with a contained intermediate link as the control on the intermediate-link one, a root-level
  `__proto__` file, and the
  host's own case behavior probed rather than assumed. `createLink` takes a directory named by an
  absolute source, a relative source resolved against the link's own directory against a decoy one
  level up, a dangling link, the host's `EEXIST` on an occupied path, and — where the host makes no
  symbolic link — a file source refused with the host's own `EPERM` and nothing left behind.
  `removeTree` takes a live process
  holding the tree as its working directory, and the two hosts split rather than branching at
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
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — rules 7, 8, and 11.
  `createLoopback` takes a real `fetch` answered from its own origin, a live keep-alive connection
  dropped by `destroy()` with a second server then binding the released port, a repeated `destroy()`
  handed the same promise before either call settles, ten parallel instances landing on distinct
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
  the file outside left intact, the root refused in all three spellings, a foreign directory swapped
  onto the allocated path that `remove('')` refuses, and that same swap under `destroy()`, which
  removes nothing either. `parent` and `prefix` take their own refusals. `createCookieJar` takes an
  empty jar rendering no header, every `Set-Cookie` field a real response carries applied and handed
  back unmodified, a cookie replaced whatever attributes the second field carries, a deletion on
  `Max-Age=0` in whatever case and spacing the origin sends, and a field carrying no `name=value`
  pair read past and still returned.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — rule 1: the `## Surface` ↔ source bijection,
  the barrel ↔ source bijection, the behavioral-interface ↔ `## Methods` bijection and each group's
  members, the fence imports, and link resolution for this guide. Beside them it runs the fences
  themselves and asserts what their comments claim: the recorder's truncating `clear()`, the recorder
  map keyed by the events a real source emits, the signal tally through every exit it has, the
  resource numbering, the unchecked boundary's uncallable-method and non-object-target refusals, the
  header flattening, the wait family's opposite throw directions with the exhaustion message and its
  `cause`, the cookie jar driven against a real origin, and the HTTP upgrade's refused arm, claimed
  arm, and budget.

## See also

- [`README.md`](README.md) — the guides index.
- `AGENTS.md` at the workspace root — the rules this package's own source and tests follow.
