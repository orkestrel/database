# Emitter

> The foundational observable primitive (AGENTS §13): a typed, **synchronous** event emitter. Every stateful entity in the codebase — a queue, a database table, an agent — that has lifecycle transitions or observable operations **owns** one `Emitter<TMap>` as a `#emitter` field and exposes it through a `readonly emitter` property; consumers subscribe via `entity.emitter.on(...)`. Composition, never inheritance: an entity threads its event map and an optional error handler into the emitter and otherwise forgets it exists.
>
> It is deliberately small. There is no scheduler — `emit` fires listeners in the current tick, in registration order. There is no listener cap, no `max`-listeners warning, and no `console` output (a documented divergence from the scsr precursor). `on` returns `void`, not an `Unsubscribe`. What it _does_ carry is the one invariant a fan-out primitive can't omit: a throwing listener is isolated so it can never take down its siblings or the emit loop. Source: [`src/core`](../../src/core). Surfaced through the `@src/core` barrel.

## Surface

Create a standalone emitter, subscribe, and fire events synchronously:

```ts
import { createEmitter } from '@src/core'

// The event map names each event and the argument tuple its listeners receive.
// Declare it as a `type` alias (§4.5 — `EventMap` is a `type` kind), never as
// `interface … extends EventMap`: a type-literal satisfies the `EventMap`
// constraint structurally without inheriting its index signature, so each event
// keeps a precise tuple and `on`-hook literals stay exactly typed.
type ClockEventMap = {
	tick: readonly [at: number]
	done: readonly []
}

const clock = createEmitter<ClockEventMap>({
	on: { done: () => stop() }, // initial listeners wired at construction (§8)
	error: (cause, event) => logger.warn(`listener for "${event}" threw`, cause),
})

clock.on('tick', (at) => render(at)) // `at` is typed `number` from the map
clock.emit('tick', Date.now()) // synchronous — every `tick` listener runs now
clock.destroy() // teardown — drops every listener, flips `destroyed`
```

The reserved `on` option wires initial listeners at construction (AGENTS §8); the optional `error` handler receives any listener's throw as `(cause, event)` so `emit` never has to rethrow. Event names are single present-tense verbs or nouns, and a map stays small — typically 4–8 events (AGENTS §4.1, §13).

### Factories

| API             | Kind     | Summary                                                                 |
| --------------- | -------- | ----------------------------------------------------------------------- |
| `createEmitter` | function | Create an `EmitterInterface<TMap>`, optionally with initial `on` hooks. |

### Helpers

| API           | Kind     | Summary                                                          |
| ------------- | -------- | ---------------------------------------------------------------- |
| `extractKeys` | function | Extract an object's own enumerable keys, typed as its key union. |

### Entities

| API       | Kind  | Summary                                                                     |
| --------- | ----- | --------------------------------------------------------------------------- |
| `Emitter` | class | The typed synchronous emitter; entities own one as `#emitter` (AGENTS §13). |

### Types

| Type                  | Kind      | Shape                                                                                                       |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `EventMap`            | type      | `Record<string, readonly unknown[]>` — each event name to its listener argument tuple.                      |
| `EmitterHandler`      | type      | `(...args: TArgs) => void` — a listener for one event's argument tuple.                                     |
| `EmitterErrorHandler` | type      | `(error: unknown, event: string) => void` — the emitter's OWN listener-error handler (the `error` option).  |
| `EmitterHooks`        | type      | `{ [K in keyof TMap]?: EmitterHandler<TMap[K]> }` — initial listeners, the reserved `on` option.            |
| `EmitterOptions`      | interface | `{ on?: EmitterHooks<TMap>; error?: EmitterErrorHandler }` — options for `createEmitter` / the constructor. |
| `EmitterInterface`    | interface | `destroyed` data member + `on` / `once` / `off` / `emit` / `count` / `clear` / `destroy`.                   |

The `destroyed` boolean is a `readonly` data member of `EmitterInterface` (a Surface row, above) — its call-signature methods are documented under [Methods](#methods).

## Methods

The public methods of `EmitterInterface` — every call-signature member listed (its `readonly` data member `destroyed` stays a Surface row). `Emitter` implements the interface exactly, so this doubles as the class's instance-method surface (AGENTS §22).

#### `EmitterInterface`

`on` / `once` / `off` register and unregister listeners; `emit` fires them synchronously; `count` / `clear` are the §9.2 batch pair (all events, or one); `destroy` is the §10 teardown.

| Method    | Returns  | Behavior                                                                                                   |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `on`      | `void`   | Register a listener for an event (no-op once destroyed).                                                   |
| `once`    | `void`   | Register a listener that removes itself after its first call (no-op once destroyed).                       |
| `off`     | `void`   | Remove a listener by its original handler — including one registered via `once`.                           |
| `emit`    | `void`   | Invoke an event's listeners synchronously, in registration order, isolating throws (no-op once destroyed). |
| `count`   | `number` | The live listener count — for one event, or the total across all events.                                   |
| `clear`   | `void`   | Drop listeners — for one event, or all of them; the emitter stays usable (`destroyed` unchanged).          |
| `destroy` | `void`   | Tear down: drop every listener and flip `destroyed` (idempotent).                                          |

## Contract

These invariants hold across `src/core` ↔ `emitter.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the emitter source, and every export appears as a Surface row — exhaustive, both directions (AGENTS §22).
2. **Synchronous, ordered.** `emit` invokes listeners in registration order, in the current tick — no microtask, no scheduler. A listener registered during an `emit` is not invoked for that same `emit` (the listener set is snapshotted before the loop).
3. **Listener isolation routes errors.** A throwing listener never stops its siblings: every listener runs, and a throw is routed to the emitter's OWN `error` handler (`EmitterOptions.error`, surfaced as `(error, event)`) — `emit` NEVER rethrows. EVERY throwing listener surfaces (not just the first); with no `error` handler, a throw is swallowed silently. The `error` handler runs in its own try/catch, so a throwing handler is swallowed too (anti-recursion).
4. **Composition, not inheritance (AGENTS §13).** Entities own an `Emitter` as `#emitter` and expose `readonly emitter`; they never extend it. There is no delegation boilerplate, no `Omit` hacks.
5. **Destroyed → no-op.** After `destroy()`, `on` / `once` / `emit` do nothing and `destroyed` is `true`; `destroy()` is idempotent. `clear()` resets listeners without destroying the emitter (`destroyed` stays `false`).
6. **`once` / `off` correlate.** A `once` listener is wrapped so it removes itself after firing; `off` called with the original handler removes that wrapper, so callers never juggle the wrapper themselves.
7. **DOC ↔ SOURCE method bijection.** The `## Methods` table lists exactly `EmitterInterface`'s public methods — exhaustive, both directions — and `Emitter` exposes the same public methods, no more (AGENTS §22).

Deliberately out of scope (a documented divergence from the scsr precursor, kept lean): a listener-count cap / `max` warning and any `console` output. Asynchronous emit, wildcard events, and an `Unsubscribe` return from `on` are additive and would leave the surface above unchanged.

## Patterns

### Standalone emitter

```ts
import { createEmitter } from '@src/core'

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

### Own an emitter (the AGENTS §13 pattern)

This is the dominant use, and the shape every observable entity in the codebase follows. The entity owns an `Emitter` as `#emitter`, exposes it through `readonly emitter`, and threads the caller's `on` (and optional `error`) options straight into the constructor — so the owner's options surface mirrors the emitter's without re-deriving it. It emits internally and tears the emitter down last in its own `destroy()`. No inheritance, no delegation boilerplate.

```ts
import {
	Emitter,
	type EmitterErrorHandler,
	type EmitterHooks,
	type EmitterInterface,
} from '@src/core'

type CounterEventMap = {
	tick: readonly [count: number]
	done: readonly []
}

interface CounterOptions {
	readonly on?: EmitterHooks<CounterEventMap> // initial listeners (§8)
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
import { createEmitter } from '@src/core'

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

- **Own, never inherit** — store an `Emitter` as `#emitter`, expose `readonly emitter` (AGENTS §13). No subclassing, no delegation boilerplate.
- **One word per event** — event names are single present-tense verbs or nouns (`tick`, `chunk`, `done`); keep a map to 4–8 events (AGENTS §13).
- **Empty tuples for pure signals** — an event with no payload is `readonly []`; emit it with no extra args.
- **Wire initial listeners through `on`** — the reserved options key (AGENTS §8); the constructor registers them up front.
- **Destroy last** — call `this.#emitter.destroy()` at the end of the entity's own `destroy()`, after any final events.
- **Route listener errors to the `error` handler** — `emit` never rethrows; supply `EmitterOptions.error` to receive a listener's throw (as `(error, event)`), or it is swallowed silently.

## Tests

- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ `src/core` bijection (value + type exports) and the `EmitterInterface` ↔ `Emitter` method bijection.
- [`tests/src/core/Emitter.test.ts`](../../tests/src/core/Emitter.test.ts) — `on` / `emit` (typed args, registration order), `once` (fires once, auto-removes), `off` (by original handler, including a `once` wrapper), `count` / `clear` (total and per-event), `destroy` (clears, flips `destroyed`, then no-ops), initial `on` hooks, listener isolation (a throwing listener does not stop siblings; the throw routes to the `error` handler, never rethrown; every throwing listener surfaces; a throwing `error` handler is swallowed), and empty-tuple signals.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createEmitter` returns a working `EmitterInterface` and honors initial `on` hooks.
- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — `extractKeys` returns the typed own-enumerable-key union, including the empty-object case.

## See also

- [`AGENTS.md`](../../AGENTS.md) — the rules; §13 the Emitter pattern, §8 the reserved `on` option, §4.1 single-word event names, §10 lifecycle (`clear` / `destroy`), §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
