# The journey layer

Build every capability here before writing the first journey, and route every journey step through
it. Treat a journey that works around a missing capability as a layer defect.

Implement the signatures below as a contract in the workspace's browser test setup module; never
copy them as source. Name each helper for the human act it performs.

## What it drives

- Drive the real browser through the installed Vitest browser provider. Import its `page` locators
  and `userEvent` from `vitest/browser`; the `@vitest/browser/context` specifier is deprecated and
  is not the import a new layer uses.
- Use the provider verbs for input: `click`, `keyboard`, `tab`, `type`, `clear`, `fill`, and
  `selectOptions`. Use `page.viewport` and `page.screenshot` for captures, and the runner's file
  command to read a written capture back.
- Never dispatch a constructed event from the layer or from a journey. The centralized event
  factories `.claude/rules/tests.md` prescribes serve unit tests whose subject is the handler; a
  journey drives input through the provider verbs only.
- Never let a helper take an element, a component instance, or a selector from the caller. Every
  helper resolves its own target from role and accessible name.

## The resolver

```ts
resolveAccessible(name: string): HTMLElement
resolveAccessible(role: string, name: string): HTMLElement
```

- Match the accessible name exactly, never a substring.
- Search a fixed set of interactive roles for the bare-name form, and exactly the named role for
  the two-argument form.
- Count a match as reachable only when every condition holds: it is connected; it passes a
  visibility check that honours opacity and CSS; its box has non-zero width and height; its
  `tabIndex` is at least zero; it matches neither `:disabled` nor `[aria-disabled="true"]`; and it
  has no `[inert]` ancestor.
- Scroll a wholly off-viewport target into view once, then measure reachability again. Count a
  control a person can scroll to as reachable, and one that stays outside the viewport as
  unreachable.
- Give the layer a rendered-only resolver beneath the public one, and use it from the acting verbs
  so a click does not fail on a target the act itself scrolls into view.

### The failure voices

Keep these distinct, and never merge two into one message.

| Condition                                  | The voice it must throw                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| No element carries the name                | `No interactive element has the accessible name "<name>"`        |
| Every match fails a reachability condition | `Interactive target "<name>" is not visible and focus-reachable` |
| Several matches are reachable              | `Interactive target "<name>" is ambiguous across <n> elements`   |
| Still off-viewport after being scrolled to | `Interactive target "<name>" is unreachable after scrolling`     |

- Report an absent control and a present-but-unreachable one as different findings: the first names
  a missing control, the second names the interface gating one that exists.
- Report ambiguity as a finding about the surface. Name the match count in the message, and
  re-target the journey by role or region.

## Role vocabulary

Never infer a role from markup. Confirm the computed role in the browser whenever a target stops
resolving.

- A `list`-bearing input computes `combobox`, not `textbox`. Attaching native suggestion machinery
  to a field is a role change: re-target every journey that names that field, and read a resolver
  miss immediately after such a change as this before treating the element as missing.
- Always target a tab by its role. A tab and its panel collide on a bare name by construction,
  because the panel is labelled by its tab.
- `<summary>` is exposed as a native disclosure rather than through a role the provider's role
  locators accept. Give the layer a separate disclosure verb keyed to the summary's rendered text,
  applying the same reachability conditions and its own failure voices.

## Region-scoped resolution

```ts
clickAccessibleWithin(region: string, role: string, name: string): Promise<void>
```

- Provide this form for repeated short verbs such as `Add`, and for a control whose accessible name
  is completed by a status the row renders.
- Apply the same reachability conditions inside the region, and throw voices that name the region
  as well as the target.

## Input and traversal

| Verb                         | Contract                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `typeAccessible(name, text)` | Focus the field, select all, delete, then send real keystrokes. Escape the provider's key syntax in the text. |
| `fillAccessible(name, text)` | Replace the value in one operation for text too long to type. The real element still publishes real input.    |
| `pressKeys(keys)`            | Send a provider keyboard sequence for Enter, arrows, modifiers, and combinations.                             |
| `traverseAccessible(name)`   | Move focus by forward Tab from wherever focus is, and return the target once focus lands on it.               |

- Count a traversal step only when focus actually lands on an element, and never charge the step
  bound for a Tab that moved nothing.
- End the traversal when focus revisits an element, which is one complete cycle of the tab order,
  and throw the traversal's own voice, carrying the trail of what focus did reach. Keep a hard cap
  above the cycle so a page with no tab order fails instead of hanging.
- Re-resolve the target by role and name on every step, and never hold a node reference across
  steps. A framework may replace the node between resolution and focus arrival.
- Never call the browser's focus method to place focus.

## Perception

```ts
readPerception(name: string): string
```

- Return the normalized `innerText` of exactly one visible named region, dialog, table, tab panel,
  alert, or status. Collapse whitespace runs to single spaces and trim.
- Read `innerText`, never `textContent`: `innerText` applies CSS transforms and leaves out content
  the layout hides. Quote that text in assertions.
- Include descendant visually-hidden text, which a screen reader perceives and which a clip-based
  hiding technique leaves in `innerText`.
- Throw when the named region is absent, hidden, or ambiguous.
- Give the layer a whole-page perception reader for cross-region sentences and the vocabulary
  sweep, a focus reader that returns the active element's rendered text, and a value reader that
  returns a resolved control's value. A perception assertion may quote that value: it is a rendered
  fact rather than internal state.

## Mounting and cleanup

- Mount the shipped root component with its real provisions and return an idempotent cleanup that
  unmounts the app and removes its container.
- Undo everything a journey changed after each test: unmount, destroy the session, reset the theme,
  clear the keys the application persisted, and return the route to its entry. Never let a journey
  inherit the previous journey's state.

## The capture hook

Give the layer exactly one capture helper. [captures.md](captures.md) owns the registry, the
variant matrix, and the proofs that read what it wrote.
