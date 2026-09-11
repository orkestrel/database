# Emitter

> The foundational observable primitive: a typed, synchronous event emitter that a
> stateful entity owns as a `#emitter` field and exposes through a `readonly emitter`
> property, fanning each event out to its listeners in the current tick and isolating a
> throwing listener from its siblings.

A queue, a database table, an agent — anything with lifecycle transitions or observable
operations takes one, and its consumers subscribe through `entity.emitter.on(...)`.
Composition, never inheritance: an entity threads its event map and an optional error
handler into the emitter and otherwise forgets it exists. It is deliberately small. There
is no scheduler, no listener cap, no `max`-listeners warning, and no `console` output;
`emit` fires listeners in registration order, and `on` returns `void`, not an
`Unsubscribe`. A throwing listener routes to the optional `error` handler instead of being
rethrown, and with no handler its throw is swallowed silently. Source:
[`src/core`](../src/core). Surfaced through the `@src/core` barrel.

## Surface

Create a standalone emitter, subscribe, and fire events synchronously:

```ts
import { createEmitter } from '@orkestrel/emitter'

// The event map names each event and the argument tuple its listeners receive.
// Declare it as a `type` alias, never as `interface … extends EventMap`: a
// type-literal satisfies the `EventMap` constraint structurally without
// inheriting its index signature, so each event keeps a precise tuple and
// `on`-hook literals stay exactly typed.
type ClockEventMap = {
	tick: readonly [at: number]
	done: readonly []
}

const clock = createEmitter<ClockEventMap>({
	on: { done: () => stop() }, // initial listeners wired at construction
	error: (error, event) => logger.warn(`listener for "${event}" threw`, error),
})

clock.on('tick', (at) => render(at)) // `at` is typed `number` from the map
clock.emit('tick', Date.now()) // synchronous — every `tick` listener runs now
clock.destroy() // teardown — drops every listener, flips `destroyed`
```

The reserved `on` option wires initial listeners at construction; the optional `error` handler receives any listener's throw as `(error, event)` so `emit` never has to rethrow. Event names are single present-tense verbs or nouns.

### Factories

| API             | Kind     | Summary                                                                                                                                                           |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createEmitter` | function | Creates a typed synchronous event emitter and returns it as an `EmitterInterface<TMap>`, wiring the initial `on` hooks and the `error` handler its options carry. |

### Helpers

| API           | Kind     | Summary                                                                      |
| ------------- | -------- | ---------------------------------------------------------------------------- |
| `extractKeys` | function | Extracts the own enumerable keys of a mapped object, typed as its key union. |

### Classes

| API       | Kind  | Summary                                                                                                                                                                                                                                              |
| --------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Emitter` | class | Implements `EmitterInterface` over one listener `Set` per event, so every public method is precisely typed with no assertion. A stateful entity owns one as a `#emitter` field and exposes it through `readonly emitter`; it never inherits from it. |

### Types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`.

| Type                  | Kind      | Shape                                                           | Summary                                                                                                                                                                                                                                 |
| --------------------- | --------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EventMap`            | type      | `Record<string, readonly unknown[]>`                            | Maps each event name to the argument tuple its listeners receive.                                                                                                                                                                       |
| `EmitterHandler`      | type      | `(...args: TArgs) => void`                                      | Represents a listener for one event's argument tuple.                                                                                                                                                                                   |
| `EmitterErrorHandler` | type      | `(error: unknown, event: string) => void`                       | Represents the emitter's own listener-error handler — the `error` option, invoked when a listener throws during `emit`, with the caught error and the stringified event name.                                                           |
| `EmitterHooks`        | type      | `{ readonly [K in keyof TMap]?: EmitterHandler<TMap[K]> }`      | Declares the initial event listeners for an emitter — the reserved `on` option: a partial map of event name to its handler, wired at construction.                                                                                      |
| `EmitterOptions`      | interface | `{ on?, error? }`                                               | Configures `createEmitter` and the `Emitter` constructor.                                                                                                                                                                               |
| `EmitterInterface`    | interface | `{ destroyed } plus on, once, off, emit, count, clear, destroy` | Represents the contract a consumer of an emitter holds: the `destroyed` reading, the `on` / `once` / `off` registration trio, the synchronous `emit`, and the `count` / `clear` / `destroy` set that reports on and releases listeners. |

The `destroyed` boolean is a `readonly` data member of `EmitterInterface` (a preceding Surface row) — its call-signature methods are documented under [Methods](#methods).

## Methods

The public methods of `EmitterInterface` — every call-signature member listed (its `readonly` data member `destroyed` stays a Surface row). `Emitter` implements the interface exactly, so this doubles as the class's instance-method surface.

#### `EmitterInterface`

`on` / `once` / `off` register and unregister listeners; `emit` fires them synchronously; `count` / `clear` are the batch pair (all events, or one); `destroy` is the teardown.

| Method    | Returns  | Summary                                                                                                               |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `on`      | `void`   | Registers a listener for an event. Does nothing after `destroy()`.                                                    |
| `once`    | `void`   | Registers a listener that removes itself after its first call. Does nothing after `destroy()`.                        |
| `off`     | `void`   | Removes a listener registered for an event by its original handler, including one registered through `once`.          |
| `emit`    | `void`   | Invokes an event's listeners synchronously, in registration order, isolating a throw. Does nothing after `destroy()`. |
| `count`   | `number` | Returns the live listener count, for one event or across every event.                                                 |
| `clear`   | `void`   | Drops registered listeners, for one event or every event, leaving the emitter usable and `destroyed` unchanged.       |
| `destroy` | `void`   | Tears down the emitter: drops every listener and sets `destroyed` to `true`. Idempotent.                              |

## Contract

These invariants hold across `src/core` ↔ `emitter.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the emitter source, and every export appears as a Surface row — exhaustive, both directions.
2. **Synchronous, ordered.** `emit` invokes listeners in registration order, in the current tick — no microtask, no scheduler. A listener registered during an `emit` is not invoked for that same `emit` (the listener set is snapshotted before the loop).
3. **Listener isolation routes errors.** A throwing listener never stops its siblings: every listener runs, and a throw is routed to the emitter's OWN `error` handler (`EmitterOptions.error`, surfaced as `(error, event)`) — `emit` NEVER rethrows. EVERY throwing listener surfaces (not only the first); with no `error` handler, a throw is swallowed silently. The `error` handler runs in its own try/catch, so a throwing handler is swallowed too (anti-recursion).
4. **Composition, not inheritance.** Entities own an `Emitter` as `#emitter` and expose `readonly emitter`; they never extend it. There is no delegation boilerplate, no `Omit` hacks.
5. **Destroyed → no-op.** After `destroy()`, `on` / `once` / `emit` do nothing and `destroyed` is `true`; `destroy()` is idempotent. `clear()` resets listeners without destroying the emitter (`destroyed` stays `false`).
6. **`once` / `off` correlate.** A `once` listener is wrapped so it removes itself after firing; `off` called with the original handler removes that wrapper, so callers never juggle the wrapper themselves.
7. **DOC ↔ SOURCE method bijection.** The `## Methods` table lists exactly `EmitterInterface`'s public methods — exhaustive, both directions — and `Emitter` exposes the same public methods, no more.

Deliberately out of scope, to keep the surface small: a listener-count cap or `max` warning, and any `console` output. Asynchronous emit, wildcard events, and an `Unsubscribe` return from `on` are additive and would leave the preceding surface unchanged.

## Patterns

### Standalone emitter

Create an emitter with no owning entity, subscribe, and fire its events:

```ts
import { createEmitter } from '@orkestrel/emitter'

type DownloadEventMap = {
	chunk: readonly [bytes: number]
	done: readonly []
}

const emitter = createEmitter<DownloadEventMap>()
emitter.on('chunk', (bytes) => accumulate(bytes))
emitter.once('done', () => finish())
emitter.emit('chunk', 1024)
emitter.emit('done')
```

### Own an emitter

This is the dominant use, and the shape every observable entity in the codebase follows. The entity owns an `Emitter` as `#emitter`, exposes it through `readonly emitter`, and threads the caller's `on` (and optional `error`) options straight into the constructor — so the owner's options surface mirrors the emitter's without re-deriving it. It emits internally and tears the emitter down last in its own `destroy()`. No inheritance, no delegation boilerplate.

```ts
import {
	Emitter,
	type EmitterErrorHandler,
	type EmitterHooks,
	type EmitterInterface,
} from '@orkestrel/emitter'

type CounterEventMap = {
	tick: readonly [count: number]
	done: readonly []
}

interface CounterOptions {
	readonly on?: EmitterHooks<CounterEventMap> // initial listeners
	readonly error?: EmitterErrorHandler // routes a listener throw, never rethrows
}

interface CounterInterface {
	readonly emitter: EmitterInterface<CounterEventMap>
	increment(): void
	destroy(): void
}

class Counter implements CounterInterface {
	#count = 0
	#emitter: Emitter<CounterEventMap>

	constructor(options?: CounterOptions) {
		// Forward both options into the owned emitter — the entity adds no logic of its own.
		this.#emitter = new Emitter({ on: options?.on, error: options?.error })
	}

	get emitter(): EmitterInterface<CounterEventMap> {
		return this.#emitter
	}

	increment(): void {
		this.#count += 1
		this.#emitter.emit('tick', this.#count) // synchronous fan-out to subscribers
	}

	destroy(): void {
		this.#emitter.emit('done') // final event, while listeners are still attached…
		this.#emitter.destroy() // …then release them last, on teardown
	}
}

const counter = new Counter({ on: { done: () => cleanup() } })
counter.emitter.on('tick', (count) => render(count))
```

### Manage listeners

`off` removes a specific listener, `count` reports how many are live (per-event or total), and `clear` drops listeners (per-event or all) without destroying the emitter:

```ts
import { createEmitter } from '@orkestrel/emitter'

type FeedEventMap = {
	post: readonly [id: string]
}

const feed = createEmitter<FeedEventMap>()
const onPost = (id: string) => log(id)

feed.on('post', onPost)
feed.count('post') // 1
feed.count() // 1 — total across all events

feed.off('post', onPost)
feed.count('post') // 0

feed.on('post', onPost)
feed.clear('post') // drop only `post` listeners
feed.clear() // drop everything; `feed.destroyed` stays false
```

### Practices

- **Own, never inherit** — store an `Emitter` as `#emitter`, expose `readonly emitter`. No subclassing, no delegation boilerplate.
- **Empty tuples for pure signals** — an event with no payload is `readonly []`; emit it with no extra args.
- **Wire initial listeners through `on`** — the reserved options key; the constructor registers them up front.
- **Destroy last** — call `this.#emitter.destroy()` at the end of the entity's own `destroy()`, after any final events.
- **Route listener errors to the `error` handler** — `emit` never rethrows; supply `EmitterOptions.error` to receive a listener's throw (as `(error, event)`), or it is swallowed silently.

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ `src/core` bijection (value + type exports), the `EmitterInterface` ↔ `Emitter` method bijection, and the equality gate: every `Summary` cell against its declaration's description paragraph, the titled `Standalone emitter` fence against the `@example` block of that title (pinned so the titled pair cannot be retired silently), and the README pitch against this guide's tagline. It also runs the Manage listeners fence and asserts the values its comments claim.
- [`tests/src/core/Emitter.test.ts`](../tests/src/core/Emitter.test.ts) — `on` / `emit` (typed args, registration order), `once` (fires once, auto-removes), `off` (by original handler, including a `once` wrapper), `count` / `clear` (total and per-event), `destroy` (clears, flips `destroyed`, then no-ops), initial `on` hooks, listener isolation (a throwing listener does not stop siblings; the throw routes to the `error` handler, never rethrown; every throwing listener surfaces; a throwing `error` handler is swallowed), and empty-tuple signals.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createEmitter` returns a working `EmitterInterface` and honors initial `on` hooks.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — `extractKeys` returns the typed own-enumerable-key union, including the empty-object case and an object whose prototype carries an enumerable key.

## See also

- [`AGENTS.md`](../AGENTS.md) — the repository's coding and orchestration authority.
- [`README.md`](README.md) — the guides index.
