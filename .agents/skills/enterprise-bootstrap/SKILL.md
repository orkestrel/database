---
name: enterprise-bootstrap
description: >-
  Design and build distinctive, production-grade user interfaces with Bootstrap
  5.3 and intentional frontend craft. Use for ANY UI work — creating, restyling,
  reviewing, or extending pages, screens, components, layouts, app shells,
  dashboards, admin panels, SaaS tools, data tables, filter bars, forms,
  wizards, navigation, modals, empty/loading/error states, dark mode, marketing
  surfaces — whenever the task touches HTML/CSS/visual design, mentions
  Bootstrap or its components, or must look professional and avoid templated
  defaults. Covers aesthetics, typography, color modes, design tokens,
  accessibility (WCAG 2.2 AA), responsive layout, and enterprise app patterns.
---

# Enterprise Bootstrap

General-purpose guide for **intentional visual design** executed with **Bootstrap 5.3**: distinctive where it matters, disciplined everywhere else, utilities-first, accessible, and responsive.

This package is layered on purpose:

| Layer          | File                                                        | Holds                                                                             |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Operate        | `SKILL.md` (this file)                                      | Process, decision rules, checklists, portability                                  |
| Design craft   | [frontend-design.md](references/frontend-design.md)         | Full aesthetic, typography, signature, copy, anti-defaults                        |
| Components     | [components.md](references/components.md)                   | Bootstrap component markup + enterprise selection notes                           |
| Utilities      | [utilities.md](references/utilities.md)                     | Class index, helpers, composition notes                                           |
| Bootstrap deep | [bootstrap-reference.md](references/bootstrap-reference.md) | Color modes, theming/tokens, forms, JS lifecycle, a11y depth, enterprise patterns |

Open the relevant reference instead of guessing class names or watering down the craft — the class indexes exist because invented utilities (`.vw-50`, `.pointer-events-none`) ship silent no-ops.

---

## Portability (any project / tool / environment)

Product-agnostic. Apply the same way wherever this package is loaded.

1. **No repo assumptions.** Do not assume Vue, React, a skin library, a folder layout, or a named product. Infer stack from the workspace.
2. **Bootstrap contract.** Target Bootstrap **5.3.x** class names and behaviors. Compatible skins that keep `.btn`, `.card`, `.form-control`, `data-bs-*`, etc. are fine — obey the same contracts.
3. **Project rules win on code law.** If the repo defines conventions (`AGENTS.md`, lint rules, a design system), follow those for languages, layout, and forbidden patterns. This package owns **UI craft + Bootstrap usage**, not language law.
4. **Framework-neutral markup.** Prefer semantic HTML + Bootstrap classes. Wire behavior with whatever the project already uses; in SPAs prefer the framework-native Bootstrap wrappers over raw `bootstrap.*` JS (see [bootstrap-reference.md](references/bootstrap-reference.md) → JavaScript lifecycle).
5. **Distribution.** Keep this folder intact so relative links between files resolve. Install or vendor it wherever your tooling looks for skills/guides — paths are tooling-specific; the content is not.
6. **CDN or bundler.** Either is fine — see [bootstrap-reference.md](references/bootstrap-reference.md) Quick Start (5.3.8) for CDN; prefer the project's existing Bootstrap package when present.
7. **When to apply.** Use on UI, Bootstrap, or visual-design work matching the description above. When the user attaches or points at this package, treat it as authoritative for the visual pass.

---

## Dual mandate

1. **Design lead** — point of view rooted in the _subject_ (audience, job-to-be-done, vernacular). One justified aesthetic risk; boldness in one place. Full text: [frontend-design.md](references/frontend-design.md).
2. **Bootstrap engineer** — components + utilities first; custom CSS only when the system cannot express the need; paint via `--bs-*` so light/dark survive.

**Context match:** a marketing page may open with a thesis-hero; an authenticated tool opens with clarity and scan paths. Same craft, different density — in product UI the signature lives in the chrome, never in the data ([frontend-design.md](references/frontend-design.md) → Where the signature lives).

---

## Process

Detail and wording live in [frontend-design.md](references/frontend-design.md). Condensed loop:

1. **Ground** — subject, audience, screen's single job (state it). Use known user preferences and prior designs as hints, not templates.
2. **Plan** — token system: **color** (4–6 named values), **type** (display / body / utility), **layout** (prose + ASCII if useful), **signature** (one memorable element).
3. **Critique the plan** — if swapping the logo would make it "any SaaS," revise. Avoid clustered AI defaults unless the brief asks: cream+#F4F1EA+serif+terracotta; near-black+acid green/vermilion; broadsheet hairlines / zero radius / dense columns. Brief wins when it pins a direction.
4. **Build** — Bootstrap from components/utilities; map plan tokens onto theme variables or a thin skin — no scattered one-off hex (token discipline: [bootstrap-reference.md](references/bootstrap-reference.md) → Theming & design tokens). Watch selector specificity (utility vs custom canceling).
5. **Critique again** — remove one accessory (Chanel). Contrast, focus, `prefers-reduced-motion`, mobile, all five states present. Critique the render, not the markup.

Brainstorm privately; show higher-confidence directions.

**Rendered proof.** A claim about a screen is settled by what the browser paints, never by the markup that was supposed to paint it — source-reading review passes a component that renders nothing. The review input is captures at both viewports and both themes plus an accessibility snapshot; source only corroborates the mechanism. For the full review-round campaign built on that evidence, use the `orkestrel-polish-surface` skill instead of improvising one here.

---

## Design principles

- **Subject first** — distinctive choices from the product's world, not a generic kit.
- **Hero / thesis when it fits** — open with the most characteristic thing. Big-number+gradient-stat blocks are the template answer — use only if truly best.
- **Signature + restraint** — one memorable element; quiet discipline around it.
- **Structure is information** — eyebrows, `01/02/03`, dividers only when order/taxonomy is real.
- **Typography carries personality** — deliberate pairing and scale; characterful display, restrained.
- **Motion with purpose** — Bootstrap transitions first; one orchestrated moment if earned; less motion often beats "AI sparkle."
- **Match complexity to vision** — maximalist = elaborate execution; minimal = precision.
- **Copy is design** — see Writing below and frontend-design.

### Writing (interface copy)

- Name what the user controls, not internals ("Notifications," not "Webhook config").
- Active voice; controls say what happens ("Save changes," not "Submit").
- Same verb across button → toast → confirm ("Publish" / "Published").
- Errors: what failed + how to fix; no vague apologies.
- Empty states: invite the next action.
- Plain verbs, sentence case, no filler; one job per element (label vs example).
- Where the surrounding context already names the object, the visible label is one word and the full phrase rides in `aria-label` — the button reads "Stop", the accessible name says what it stops.
- One glyph means one thing across the whole surface: a check that means "finished" here must not mean "selected" there.

---

## Bootstrap operating principles

1. **Mobile first** — smallest screen first, then `sm` / `md` / `lg` / `xl` / `xxl`
2. **Semantic HTML** — `nav`, `main`, `section`, heading order
3. **Work down the styling ladder below** — component classes, then utilities, then Bootstrap's own extension points
4. **Test responsiveness** — every breakpoint you claim
5. **Verify against the shipped cascade** — resolve every treatment in the CSS actually loaded (Bootstrap plus every skin and dependency stylesheet the page pulls in), never against docs memory. A class with no rule of its own may still inherit one, and a token pair that passes in stock Bootstrap can fail under a compatible skin. Measure, don't assume — including the `*-subtle` / `*-emphasis` recipes, once per theme.

### The styling ladder

Work down these rungs in order. Reach a lower rung only when the one above genuinely cannot express the need.

1. **The component's own classes, in its documented structure.** Build the element the way Bootstrap defines it: the right elements, the right nesting, the right class names, the required ARIA. A card is `.card` wrapping `.card-body` wrapping `.card-title` — not a `div` with borrowed padding. The best result is an element styled entirely by correct component classes, because variants, states, colour modes, and responsive behaviour all hang off that structure.
2. **Bootstrap utilities, for refinement.** Spacing, flex, display, sizing, text, borders, colour. This is where the creative range is — compose utilities rather than reaching past them. Use only classes that exist in [utilities.md](references/utilities.md); an invented one ships a silent no-op.
3. **Bootstrap's own extension points.** Component `--bs-{component}-*` variables and the utilities API, when a real gap remains after rungs 1 and 2.
4. **Anything beyond Bootstrap's conventions is the developer's call, not yours.** Stop at rung 3, and say plainly what rung 4 would require. Leaving that decision with the developer keeps the surface conventional, reviewable, and themeable.

Never open at rung 4. Specifically, do not reach first for:

- a `style="..."` attribute;
- a `<style>` block in a page or component;
- a new stylesheet rule for something a utility already does.

Each of those ends the cascade for that element: it outranks the utilities, it ignores `--bs-*` retheming, and it does not change across breakpoints or colour modes. Fighting utilities with high-specificity custom rules is the usual source of padding and margin cancel bugs.

### Hierarchy & actions

| Intent      | Typical choice                                           |
| ----------- | -------------------------------------------------------- |
| Primary     | `btn btn-primary` — **one** clear primary per region     |
| Secondary   | `btn-outline-*` matching the surface                     |
| Destructive | `btn-danger` + the confirmation ladder below             |
| Tertiary    | `btn-link` or text links                                 |
| Status      | `badge` / `alert` / `*-emphasis` — **never color alone** |

A status mark with **no text** is an icon glyph, never a `badge`: stock Bootstrap ships `.badge:empty { display: none }`, so an empty badge used as a dot never renders at all ([components.md](references/components.md) → Badge).

### Surfaces, color, contrast

- **Contrast bars, measured in both themes:** **≥ 4.5:1** for anything information-bearing — `small`, captions, and meta text included — and **≥ 3:1** for textless marks, state indicators, and the hover/focus chrome that carries state. Verify even Bootstrap's own palette; the docs admit some defaults fall short.
- `text-body-tertiary` fails the AA bar for information-bearing small text — tier such text `text-body-secondary` or better, and keep tertiary for genuinely decorative marks.
- Disabled controls are exempt from the bars, but a disabled **destructive** control must not keep full danger saturation — at full strength it still reads as armed. Neutralize the variant while it is disabled and carry the reason on the control with `aria-describedby` (plus `title` for pointer users), never `title` alone.
- Prefer `bg-body`, `bg-body-secondary`, `bg-body-tertiary` over raw `bg-white`/`bg-light` — they track `data-bs-theme`.
- Pairings: `text-bg-*`, `*-subtle`, `*-emphasis`, `text-body` / `text-body-secondary`. (`text-muted` is deprecated — use `text-body-secondary`.)
- On **dark surfaces**, scope `data-bs-theme="dark"` rather than reaching for the deprecated `*-dark` component variants; gray-on-dark outlines often fail contrast.
- Support `data-bs-theme="light"` and `dark` when the product offers both — drive custom paint from `var(--bs-…)`. Mechanics: [bootstrap-reference.md](references/bootstrap-reference.md) → Color modes.

### Density, layout, responsive

- Enterprise density: `table-sm`, `btn-sm` / `btn-group-sm`, compact toolbars — but keep every interactive target **≥ 24×24px** (WCAG 2.2); pad hit areas rather than shrinking them.
- Offer density (comfortable/compact) as a user toggle driven by one token, not ad-hoc `-sm` sprinkling.
- Cards earn their keep: `.card` when grouping helps; otherwise spacing + type.
- Prefer `gap-*` on parents over margin spam on every child.
- Wide data: ranked responsive strategies (priority columns → horizontal scroll → card-ify) in [bootstrap-reference.md](references/bootstrap-reference.md) → Dense data tables.
- Toolbars: `btn-toolbar` + `overflow-auto` — don't crush icons below target size.
- Below `sm`, collapse captioned buttons to their icons (accessible names retained) **before** the brand or page title starts truncating — identity survives, chrome shrinks.
- App frame: sidebar via responsive `offcanvas-{bp}` (inline desktop, drawer mobile) — full pattern in [bootstrap-reference.md](references/bootstrap-reference.md) → App shell.
- Print: chrome `d-print-none`; keep the data printable.

### States & feedback (decision rules)

- **Every data surface ships five states:** ideal, empty, loading, partial, error. Not done until all five exist.
- **Loading:** skeleton (`placeholder`) when the layout is known — it holds the frame; spinner for short or in-control waits (inside the button). Under ~1s show nothing; past ~10s show determinate progress.
- **Empty:** no-data-yet invites the first action; no-results-for-filters offers "Clear filters." Never one generic "nothing here."
- **Errors:** what failed + how to fix + a keyboard-reachable retry, in place — never a toast, never a wiped layout.
- **Channel rule:** toast = transient success; inline alert = contextual; banner = persistent page-level condition; modal = blocking decision. Full matrix: [bootstrap-reference.md](references/bootstrap-reference.md) → Feedback discipline.
- **Destructive ladder:** undo > confirm dialog (verb-labeled buttons, consequence restated) > type-to-confirm (only high blast radius). Prefer undoable over interrupting.

### Views & navigation

- In-page view switching → real **tabs** (`nav-tabs` / `nav-pills` / `nav-underline` + tab panes / equivalent state), not scroll-only hash links dressed as tabs.
- Active items: `aria-current="page"` or `aria-selected`. Exactly **one** `aria-current` per selection — per nav, per list, per table; two is no selection at all.
- A mark laid on a selected/active fill must survive it: a `text-bg-*`-family mark on a `.active` fill of the same color is overridden and vanishes, while `text-body-emphasis` keeps reading. Same trap for `btn-check` filter labels ([components.md](references/components.md) → Selection fills).
- Icon-only controls: `aria-label` (and `title` when helpful).
- Breadcrumbs only for real hierarchy; command palette only on top of visible nav.

### Forms (decision rules)

- Visible labels (top-aligned by default) or `.form-floating` — never placeholder-only.
- Validate on **blur**, re-validate error fields on input, everything on submit; keep submit **enabled**.
- Long forms pair a focusable error summary with inline `.invalid-feedback` per field (`aria-describedby`, `aria-invalid`).
- Bootstrap's client-side validation styles aren't exposed to assistive tech — accessible flows use the server-side classes or native validation. Mechanics + canonical JS: [bootstrap-reference.md](references/bootstrap-reference.md) → Forms in production.
- Units/money: `.input-group` + `.input-group-text` (+ `.has-validation` when feedback present).
- Multi-step: per-step validation, back without loss, never re-ask collected data.

### Component cheat sheet

| Problem             | Start with                                                                |
| ------------------- | ------------------------------------------------------------------------- |
| App frame           | `navbar` + responsive `offcanvas-{bp}` sidebar + `container-fluid`        |
| Page sections       | spaced headings or `card`                                                 |
| Actions             | `btn`, `btn-group`, `btn-toolbar`, `d-grid gap-2`                         |
| In-page views       | `nav-tabs` / `nav-pills` / `nav-underline` + panes                        |
| Data                | `table` + `table-responsive` (+ patterns in the deep reference)           |
| Filters / secondary | `offcanvas`, `dropdown`, `collapse`                                       |
| Long help           | `accordion` and/or scrollable `modal`                                     |
| Forms               | `form-control`, `form-select`, `form-floating`, `input-group`, validation |
| Feedback            | `alert`, `toast`, `badge`, `progress`, `spinner`, `placeholder`           |
| Steps / schemas     | `list-group` / `list-group-numbered`                                      |
| Value pickers       | `form-select` / native inputs — never a dropdown posing as an input       |

Markup: [components.md](references/components.md). Fine layout: [utilities.md](references/utilities.md).

### When custom CSS is justified

This is rung 4 of the styling ladder, so it is the developer's decision. Propose it, name what it buys, and do not take it unprompted. Exhaust rungs 1–3 first: correct component structure, then utilities, then the extension points — component `--bs-{component}-*` variables for restyling, the utilities API for missing utility steps ([bootstrap-reference.md](references/bootstrap-reference.md) → Theming).

When the developer does authorize it:

- Name in Bootstrap vocabulary
- Colors from `var(--bs-…)` / theme tokens so light and dark both work
- Logical properties (`margin-inline-start`, not `margin-left`) so RTL works
- Minimal surface area; document why
- A stylesheet rule, never a `style` attribute or a `<style>` block — those cannot be themed, overridden, or made responsive

### Anti-patterns

- Templated "AI" looks when the brief left the axis free (see frontend-design)
- Purple-gradient / glow / emoji / pill-soup decoration without subject reason
- Faux widgets that break focus and theme behavior — a `div` pretending to be a select, grid, or tab
- Hand-rolling combobox/datepicker/data-grid when native or an accessible library exists ([bootstrap-reference.md](references/bootstrap-reference.md) → When not to hand-roll)
- Scroll anchors posing as tabs
- Color-only status
- An empty `.badge` used as a dot — `.badge:empty { display: none }` means it never rendered
- Assuming an unfilled `.badge` is transparent — compatible skins may give it a default background; a muted badge states its fill (`bg-*-subtle`, `bg-transparent`)
- A colored mark dropped onto a selected/active fill of the same family — the fill wins and the mark disappears
- Disabled destructive controls left at full danger saturation
- Treatments accepted from docs memory instead of the compiled cascade
- Layout-shifting conditional chrome (bulk bars or alerts that shove the toolbar — swap in place)
- Nested bordered divs instead of real `card` structure
- Hard-coded hex that ignores `data-bs-theme`
- Deprecated dark variants (`navbar-dark`, `dropdown-menu-dark`, `btn-close-white`, `carousel-dark`, `text-muted`) in new code
- Inventing utility classes not in [utilities.md](references/utilities.md) — they fail silently
- Disabling submit as a validation strategy; blocking paste in password/OTP fields
- Errors delivered as toasts or hover tooltips
- One infinite stack of pastel cards for documentation (prefer accordion/sections)

---

## Accessibility baseline

- Skip link to main; landmarks; `h1` → `h2` order
- `aria-label` on icon-only controls; targets ≥ 24×24px
- `aria-current` / `aria-selected` on active nav/tabs — exactly one `aria-current` per selection
- `aria-expanded` / `aria-controls` for disclosure
- `aria-describedby` for help and errors; `aria-invalid` on failed fields
- Live regions match the message: an async status mark is `role="status"`; an alert-styled notice is `role="alert"`
- A form whose host already names the request associates with that name (`aria-labelledby`) instead of repeating the prompt as its own label
- Visible focus (keep Bootstrap rings; `.focus-ring` helper for custom elements — never `outline: none`)
- Focus not obscured by sticky chrome (`scroll-margin-top`); focus moved deliberately on SPA route change, failed submit, and row delete
- Meaning not by color alone; contrast verified
- Drag interactions have a non-drag alternative
- Modals: `aria-labelledby`; let Bootstrap trap/restore focus; dispose instances in SPAs on unmount

WCAG 2.2 deltas, APG pattern contracts, reduced motion, and SPA focus recipes: [bootstrap-reference.md](references/bootstrap-reference.md) → Accessibility.

---

## Production checklist

```
Progress:
- [ ] Portability: followed project code law; no wrong-stack assumptions
- [ ] Subject, audience, single job stated
- [ ] Design plan: palette, type, layout, one signature (critiqued vs AI defaults)
- [ ] Bootstrap shell from components.md; utilities from utilities.md (no invented classes)
- [ ] Styling ladder held: component structure, then utilities, then extension points — no `style` attribute, no `<style>` block, no custom rule doing a utility's job
- [ ] Plan tokens mapped to theme / --bs-* (no hex scatter); light/dark if both ship
- [ ] Copy: user language, consistent verbs, useful empty/error/loading
- [ ] Five states per data surface: ideal / empty / loading / partial / error
- [ ] Contrast measured in both themes: ≥ 4.5:1 information-bearing (small included), ≥ 3:1 marks and state chrome; meaning not color-alone
- [ ] Every treatment resolved in the shipped cascade, not from docs memory
- [ ] Keyboard: focus visible, not obscured, targets ≥ 24px, icon labels
- [ ] Reduced motion respected; drag has non-drag alternative
- [ ] Forms: labels visible, blur validation, error summary + inline, submit enabled
- [ ] Responsive spot-check (claimed breakpoints); RTL-safe (start/end only)
- [ ] States: hover/focus/disabled/invalid/active
- [ ] SPA hygiene: JS instances disposed on unmount (or framework wrappers used)
- [ ] Remove one unnecessary accessory
- [ ] Rendered proof: captures at both viewports and both themes + an accessibility snapshot
```

---

## Key takeaways

- **Layered package** — craft and Bootstrap recipes live in the reference files; this file is the decision loop.
- **Distinctive** = subject + one signature + restraint — in product UI, signature in the chrome, discipline in the data.
- **Bootstrap** = reliable shipping across breakpoints, themes, and writing directions — extend through its variables and APIs, not against them.
- **Done** = design critique **and** production states **and** the accessibility bar — each proven by what rendered, in any environment.
