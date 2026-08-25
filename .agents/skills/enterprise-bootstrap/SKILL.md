---
name: enterprise-bootstrap
description: >-
  Design and build distinctive, production-grade user interfaces with Bootstrap
  5.3 and intentional frontend craft, in any host project and on any stack. Use
  for Bootstrap user-interface work — creating, restyling, or
  extending pages, screens, components, layouts, app shells, dashboards, admin
  panels, SaaS tools, data tables, filter bars, forms, wizards, navigation,
  modals, empty/loading/error states, dark mode, marketing surfaces — whenever
  the task touches HTML/CSS/visual design, mentions Bootstrap or its components,
  or must look professional and avoid templated defaults. Covers aesthetics,
  typography, color modes, design tokens, accessibility (WCAG 2.2 AA),
  responsive layout, and enterprise app patterns. The `orkestrel-polish-surface`
  skill owns a requested verdict, round, or campaign over a surface that already
  renders, including a review that changes nothing. In that campaign's fix
  units, use this skill for Bootstrap craft.
---

# Enterprise Bootstrap

Set a deliberate visual direction, build it from Bootstrap 5.3 components and utilities, and settle
every claim about the result from what renders.

Open the reference that owns a subject before writing markup. Never guess a class name: an invented
utility (`.vw-50`, `.pointer-events-none`) has no rule in the shipped CSS and fails silently. Pick
components from [components.md](references/components.md) → Choosing components, take their markup
from the same file, and take fine layout from [utilities.md](references/utilities.md). Where
Bootstrap ships no component for the need — combobox, date picker, tags input, data grid, tree —
work the native-first ladder in [bootstrap-reference.md](references/bootstrap-reference.md) → When
not to hand-roll before building one.

| Layer          | File                                                        | Holds                                                                             |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Operate        | `SKILL.md` (this file)                                      | Process, decision rules, checklist                                                |
| Design craft   | [frontend-design.md](references/frontend-design.md)         | Aesthetic, typography, signature, interface copy, anti-defaults                   |
| Components     | [components.md](references/components.md)                   | Bootstrap component markup + enterprise selection notes                           |
| Utilities      | [utilities.md](references/utilities.md)                     | Class index, helpers, composition notes                                           |
| Bootstrap deep | [bootstrap-reference.md](references/bootstrap-reference.md) | Color modes, theming/tokens, forms, JS lifecycle, a11y depth, enterprise patterns |

---

## Portability

1. **Assume no stack.** Infer it from the workspace. Do not assume Vue, React, a skin library, a folder layout, or a named product.
2. **Target Bootstrap 5.3.x** class names and behaviors. Hold a compatible skin that keeps `.btn`, `.card`, `.form-control`, and `data-bs-*` to the same contracts.
3. **Follow the project's code law.** Its `AGENTS.md`, lint rules, and design system decide language, layout, and forbidden patterns. This package owns UI craft and Bootstrap usage, not language law.
4. **Write framework-neutral markup** — semantic HTML plus Bootstrap classes. Wire behavior with what the project already uses; in an SPA prefer the framework-native Bootstrap wrappers over raw `bootstrap.*` JS ([bootstrap-reference.md](references/bootstrap-reference.md) → JavaScript lifecycle).
5. **Keep this folder intact** so the relative links between its files resolve. Install or vendor it wherever the tooling looks for skills; the paths are tooling-specific, the content is not.
6. **Use the project's installed Bootstrap** when it has one; otherwise take the CDN snippet from [bootstrap-reference.md](references/bootstrap-reference.md) → Quick start (5.3.8).
7. **Apply this package** to UI, Bootstrap, and visual-design work matching the description above. When the user points at it, treat it as authoritative for the visual pass.

---

## The mandate

1. **Design direction** — take a point of view rooted in the _subject_ (audience, job-to-be-done, vernacular). Take one justified aesthetic risk, in one place.
2. **Bootstrap execution** — components and utilities first; custom CSS only when the system cannot express the need; paint through `--bs-*` so light and dark both survive.

Match the density to the context: a marketing page may open with a thesis-hero, an authenticated
tool opens with clarity and scan paths. In product UI put the signature in the chrome, never in the
data ([frontend-design.md](references/frontend-design.md) → Where the signature lives).

---

## Process

Design craft — subject grounding, hero and thesis, typography, structure, motion, restraint, and
interface copy — lives in [frontend-design.md](references/frontend-design.md). Read it before
setting a direction. The loop:

1. **Ground** — name the subject, the audience, and the screen's single job, and state them. Use known user preferences and prior designs as hints, not templates.
2. **Plan** — build a token system: **color** (4–6 named values), **type** (display / body / utility), **layout** (prose plus ASCII if useful), **signature** (one memorable element).
3. **Critique the plan** — if swapping the logo would make it "any SaaS", revise. Avoid the clustered AI defaults unless the brief asks for them: cream + #F4F1EA + serif + terracotta; near-black + acid green or vermilion; broadsheet hairlines, zero radius, dense columns. The brief wins when it pins a direction.
4. **Build** — compose Bootstrap components and utilities; map the plan's tokens onto theme variables or a thin skin, with no scattered one-off hex ([bootstrap-reference.md](references/bootstrap-reference.md) → Theming & design tokens). Watch selector specificity: a utility and a custom rule that cancel each other show up as padding and margin bugs.
5. **Critique the render** — remove one accessory. Check contrast, focus, `prefers-reduced-motion`, mobile, and every data state. Critique what rendered, not the markup.

Brainstorm privately; show a direction only once it satisfies the brief and the quality floor
([frontend-design.md](references/frontend-design.md) → Process).

**Rendered proof.** Settle every claim about a screen from a capture, never from source alone;
`.agents/orchestration.md` owns this law where it is present. The review input here is captures at
both viewports and both themes plus an accessibility snapshot; source only corroborates the
mechanism. For a full review-round campaign built on that evidence, use the
`orkestrel-polish-surface` skill instead of improvising one here.

**Mechanical proof.** These instruments settle what a capture cannot. Pair each one with a negative
control drawn from outside the population it covers, and treat an instrument whose control passes as
broken; `.claude/rules/quality.md` owns this law where it is present:

- **Contrast, composited.** Read every pairing through a reader that composites the painted layers, in both themes ([bootstrap-reference.md](references/bootstrap-reference.md) → Measuring the bars).
- **Authored classes against the shipped cascade.** Extract every class authored in the templates and components, and fail the run on one that has no rule in the compiled CSS the page loads. Assert a population floor so an extractor that quietly matched nothing cannot pass, and control it with a class you know is absent.
- **One glyph, one meaning.** Register each status glyph against the meaning it carries. No meaning takes more than one glyph, no glyph serves more than one meaning, and every registered glyph resolves in the icon set actually shipped.

---

## Bootstrap operating principles

1. **Mobile first** — smallest screen first, then `sm` / `md` / `lg` / `xl` / `xxl`.
2. **Semantic HTML** — `nav`, `main`, `section`, heading order.
3. **Work down the styling ladder below** — component classes, then utilities, then Bootstrap's own extension points.
4. **Test every breakpoint you claim.**
5. **Reach for Bootstrap's own transitions before writing custom animation**, spend one orchestrated moment at most, and wrap any custom animation in `prefers-reduced-motion: no-preference` ([bootstrap-reference.md](references/bootstrap-reference.md) → Reduced motion).
6. **Resolve every treatment in the shipped cascade** — Bootstrap plus every skin and dependency stylesheet the page pulls in — never from docs memory. A class with no rule of its own may still inherit one, and a token pair that passes in stock Bootstrap can fail under a compatible skin. Measure the `*-subtle` / `*-emphasis` recipes too, once per theme, with a reader that composites the translucent layers ([bootstrap-reference.md](references/bootstrap-reference.md) → Measuring the bars).

### The styling ladder

Work down these rungs in order. Reach a lower rung only when the one above genuinely cannot express
the need.

1. **The component's own classes, in its documented structure.** Use the right elements, nesting, class names, and required ARIA: a card is `.card` wrapping `.card-body` wrapping `.card-title`, not a `div` with borrowed padding. Variants, states, color modes, and responsive behavior all hang off that structure.
2. **Bootstrap utilities, for refinement.** Spacing, flex, display, sizing, text, borders, color. Compose utilities rather than reaching past them, and use only classes that exist in [utilities.md](references/utilities.md).
3. **Bootstrap's own extension points.** Component `--bs-{component}-*` variables and the utilities API, when a real gap remains after the component-class and utility tiers.
4. **Anything beyond Bootstrap's conventions is the developer's call, not yours.** Stop at rung 3 and say plainly what rung 4 would require.

Never open at rung 4. Specifically, do not reach first for:

- a `style="..."` attribute;
- a `<style>` block in a page or component;
- a new stylesheet rule for something a utility already does.

Each ends the cascade for that element: it outranks the utilities, it ignores `--bs-*` retheming, and
it does not change across breakpoints or color modes.

### Hierarchy & actions

| Intent      | Typical choice                                                      |
| ----------- | ------------------------------------------------------------------- |
| Primary     | `btn btn-primary` — **one** clear primary per region                |
| Secondary   | `btn-secondary` — solid, so the surface underneath cannot change it |
| Destructive | `btn-danger` + the confirmation ladder                              |
| Tertiary    | `btn-link` or text links                                            |
| Status      | `badge` / `alert` / `*-emphasis` — **icon + color + word**          |

**Outline buttons are the decorative tier.** They paint no background of their own, so they borrow
whatever surface they sit on and their contrast is surface- and theme-dependent by construction:
against stock Bootstrap the whole `btn-outline-*` family misses 4.5:1 across the dark theme and on
light tinted surfaces — cards, subtle alerts. Give any action that carries information or
consequence the solid variant. Solid variants paint their own background and measure identically on
every surface, and the stock fills sit at the 4.5:1 bar with nothing to spare. Re-measure a solid
variant whenever anything layers over it — an `opacity-*` utility, a translucent overlay, a skin's
own tint.

A status mark with **no text** is an icon glyph, never a `badge`
([components.md](references/components.md) → Badge).

### Surfaces, color, contrast

- **Contrast bars, measured in both themes:** **≥ 4.5:1** for anything information-bearing — `small`, captions, and meta text included — and **≥ 3:1** for textless marks, state indicators, and the hover/focus chrome that carries state. Verify Bootstrap's own palette too; the docs admit some defaults fall short. Read both themes — a pairing that passes light routinely fails dark.
- **Information-bearing status text takes the `-emphasis` pair.** Plain `text-success` and `text-danger` miss the bar across the dark theme and on light tinted surfaces, and `text-warning` is theme-asymmetric — unreadable on light, comfortable on dark. Never make a plain semantic color the encoding; use it only as decoration beside an encoding that already passes.
- `text-body-tertiary` carries no information anywhere: it measures under 4.5:1 on every surface in both themes. Tier text a user must read `text-body-secondary` or better, and keep tertiary for genuinely decorative marks.
- **A subtle fill degrades everything inside it one notch.** Inside `alert-*` and the `*-subtle` backgrounds, outline buttons and plain semantic text fail even in light — so information-bearing text there is `-emphasis` and every button is solid.
- **A primary fill destroys every semantic color.** On `.active`, `.bg-primary`, and `text-bg-*` surfaces every tone class measured lands under the bar in both themes, the `-emphasis` family included, because the fill supplies its own contrast color and the tone class overrides it with one tuned for a different background. Carry no tone class inside such a fill; let the surface's contrast color take the text, keep the status encoded by icon and word, and verify by capturing the selected state ([components.md](references/components.md) → Selection fills).
- Disabled controls are exempt from the bars, but a disabled **destructive** control must not keep full danger saturation — at full strength it still reads as armed. Neutralize the variant while it is disabled and carry the reason on the control with `aria-describedby` (plus `title` for pointer users), never `title` alone.
- Prefer `bg-body`, `bg-body-secondary`, `bg-body-tertiary` over raw `bg-white` / `bg-light`, and drive custom paint from `var(--bs-…)` — they track `data-bs-theme`, a hard-coded hex does not.
- Pairings: `text-bg-*`, `*-subtle`, `*-emphasis`, `text-body` / `text-body-secondary`. `text-muted` is deprecated — use `text-body-secondary`.
- On **dark surfaces**, scope `data-bs-theme="dark"` rather than the deprecated component variants `navbar-dark`, `dropdown-menu-dark`, `btn-close-white`, and `carousel-dark`; gray-on-dark outlines often fail contrast.
- Support `data-bs-theme="light"` and `dark` when the product offers both. Mechanics: [bootstrap-reference.md](references/bootstrap-reference.md) → Color modes.

### Density, layout, responsive

- Enterprise density: `table-sm`, `btn-sm` / `btn-group-sm`, compact toolbars — but keep every interactive target **≥ 24×24px**, measured on the rendered box rather than assumed from the class (WCAG 2.2); pad hit areas rather than shrinking them.
- Where information density is the screen's job, take the `-sm` family across a control row together — `btn-sm` with `form-control-sm`, `form-select-sm`, `input-group-sm` — so the row shares one height. Never mix control sizes within one row.
- Cards earn their keep: `.card` when grouping helps; otherwise spacing and type.
- Swap conditional chrome in place. A bulk-action bar or an alert that shoves the toolbar down shifts the layout mid-task.
- App shell, dense tables, filter bars, and the ranked responsive strategies for wide data: [bootstrap-reference.md](references/bootstrap-reference.md) → Enterprise patterns. Spacing, toolbar, truncation, and print composition: [utilities.md](references/utilities.md) → Composition habits.

### States & feedback

- **Every data surface ships these states:** ideal, empty, loading, partial, error. It is not done until every one exists. Loading thresholds, empty and error specifics, and the channel matrix for toast / inline alert / banner / modal: [bootstrap-reference.md](references/bootstrap-reference.md) → The data states, Feedback discipline.
- **Build a blocking decision on the native `<dialog>`.** `showModal()` brings focus containment, Esc, an inert background, and top-layer stacking from the platform, with no instance to construct and none to leak on unmount. Dress it with Bootstrap chrome inside ([components.md](references/components.md) → Modal). Reach for `.modal` and its JS only when the project already drives its dialogs that way.
- **Destructive actions:** prefer undoable over interrupting. Ladder and confirmation contracts: [bootstrap-reference.md](references/bootstrap-reference.md) → Destructive actions.

### Forms

- Give every field a visible label (top-aligned by default) or `.form-floating` — never placeholder-only.
- Validate on **blur**, re-validate error fields on input, re-check everything on submit, and keep submit **enabled**. Never disable submit as a validation strategy.
- Pair a focusable error summary with inline `.invalid-feedback` per field (`aria-describedby`, `aria-invalid`).
- Layout, validation mechanics and their assistive-tech limitation, input groups, autosave, and multi-step rules: [bootstrap-reference.md](references/bootstrap-reference.md) → Forms in production, Wizards & multi-step forms.

### When custom CSS is justified

This is rung 4 of the styling ladder, so it is the developer's decision. Propose it, name what it
buys, and do not take it unprompted. Exhaust rungs 1–3 first: correct component structure, then
utilities, then the extension points — component `--bs-{component}-*` variables for restyling, the
utilities API for missing utility steps ([bootstrap-reference.md](references/bootstrap-reference.md)
→ Theming).

When the developer authorizes it:

- Name it in Bootstrap vocabulary.
- Take colors from `var(--bs-…)` and theme tokens so light and dark both work.
- Use logical properties (`margin-inline-start`, not `margin-left`) so RTL works.
- Keep the surface area minimal and document why.
- Write a stylesheet rule, never a `style` attribute or a `<style>` block.

---

## Accessibility baseline

- Skip link to main; landmarks; `h1` → `h2` order.
- `aria-label` on icon-only controls; targets ≥ 24×24px.
- `aria-current` / `aria-selected` on active nav and tabs — exactly one `aria-current` per selection.
- `aria-expanded` / `aria-controls` for disclosure.
- `aria-describedby` for help and errors; `aria-invalid` on failed fields.
- Live regions match the message: an async status mark is `role="status"`; an alert-styled notice is `role="alert"`.
- A form whose host already names the request associates with that name (`aria-labelledby`) instead of repeating the prompt as its own label.
- Visible focus — keep the Bootstrap rings, use the `.focus-ring` helper for custom elements, and never write `outline: none`.
- Focus not obscured by sticky chrome (`scroll-margin-top`); focus moved deliberately on SPA route change, failed submit, and row delete.
- Meaning never by color alone; contrast verified.
- Every drag interaction has a non-drag alternative.
- Dialogs carry `aria-labelledby`; let the platform or Bootstrap trap and restore focus rather than scripting it; dispose Bootstrap instances in SPAs on unmount.

WCAG 2.2 deltas, APG pattern contracts, reduced motion, and SPA focus recipes:
[bootstrap-reference.md](references/bootstrap-reference.md) → Accessibility.

---

## Production checklist

```
Progress:
- [ ] Project code law followed; no wrong-stack assumptions
- [ ] Subject, audience, single job stated
- [ ] Design plan critiqued against the AI defaults: palette, type, layout, one signature
- [ ] Shell from components.md, utilities from utilities.md; no invented class
- [ ] Styling ladder held: no `style` attribute, no `<style>` block, no custom rule doing a utility's job
- [ ] Plan tokens mapped to theme / --bs-* (no hex scatter); light and dark both shipped where both are offered
- [ ] Copy in user language, verbs consistent, empty/error/loading text useful
- [ ] Every state per data surface: ideal / empty / loading / partial / error
- [ ] Contrast composited and measured in both themes: ≥ 4.5:1 information-bearing (small included), ≥ 3:1 marks and state chrome; meaning not color-alone
- [ ] Tiers held: `-emphasis` for information-bearing status, solid buttons for real actions, no tone class inside a filled surface
- [ ] Every treatment resolved in the shipped cascade, not from docs memory
- [ ] Authored classes checked against that cascade; one glyph per meaning; every instrument's control failed
- [ ] Keyboard: focus visible, not obscured, targets ≥ 24px, icon controls named
- [ ] Reduced motion respected; every drag has a non-drag path
- [ ] Forms: labels visible, blur validation, error summary + inline, submit enabled
- [ ] Claimed breakpoints spot-checked; RTL-safe (start/end only)
- [ ] States present: hover / focus / disabled / invalid / active
- [ ] SPA hygiene: JS instances disposed on unmount, or framework wrappers used
- [ ] Rendered proof: captures at both viewports and both themes + an accessibility snapshot
```
