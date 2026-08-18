# Bootstrap 5 Deep Reference — Theming, Forms, JS, Accessibility, Enterprise Patterns

> Part of the `enterprise-bootstrap` package. Bootstrap **5.3.x**.
> Component markup lookups: [components.md](components.md). Utility classes: [utilities.md](utilities.md).
> This file holds what those do not: setup, color modes, theming/tokens, forms in
> production, the JS lifecycle, accessibility depth, and enterprise app patterns.

## Contents

- [Quick start](#quick-start)
- [Breakpoints & layout](#breakpoints--layout)
- [Color modes (light / dark / custom)](#color-modes-light--dark--custom)
- [Theming & design tokens](#theming--design-tokens)
- [Forms in production](#forms-in-production)
- [JavaScript lifecycle](#javascript-lifecycle)
- [Accessibility](#accessibility)
- [Enterprise patterns](#enterprise-patterns) — [App shell](#app-shell) · [Dense data tables](#dense-data-tables) · [Filter & search bars](#filter--search-bars) · [Wizards & multi-step forms](#wizards--multi-step-forms) · [The five states](#the-five-states) · [Feedback discipline](#feedback-discipline) · [Destructive actions](#destructive-actions)
- [RTL](#rtl)
- [Print](#print)
- [Performance](#performance)
- [When not to hand-roll](#when-not-to-hand-roll)
- [Common layout patterns](#common-layout-patterns)

## Quick Start

CDN (5.3.8 is the current — and final — 5.3.x patch before 5.4):

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>App</title>
		<link
			href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css"
			rel="stylesheet"
		/>
	</head>
	<body>
		<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js"></script>
	</body>
</html>
```

- `bootstrap.bundle.min.js` includes Popper (needed by dropdowns, tooltips, popovers). Without the bundle, load `@popperjs/core` yourself first.
- Under a strict CSP, add per-file SRI `integrity` hashes — regenerate them from the CDN for the exact version; never copy hashes across versions.
- In a project with a bundler, prefer the installed `bootstrap` package (and its Sass source) over the CDN — see [Performance](#performance).

## Breakpoints & Layout

| Breakpoint  | Class Infix | Dimensions |
| ----------- | ----------- | ---------- |
| Extra small | (none)      | <576px     |
| Small       | `sm`        | ≥576px     |
| Medium      | `md`        | ≥768px     |
| Large       | `lg`        | ≥992px     |
| Extra large | `xl`        | ≥1200px    |
| XXL         | `xxl`       | ≥1400px    |

```html
<div class="container">Fixed-width responsive container</div>
<div class="container-fluid">Full-width container (app shells)</div>
<div class="container-md">100% until md, then fixed</div>

<div class="container">
	<div class="row">
		<div class="col">Auto-width column</div>
		<div class="col-6">6 of 12 columns</div>
		<div class="col-md-4">4 columns on md+</div>
	</div>
	<div class="row row-cols-1 row-cols-md-3 g-4">
		<div class="col">Equal cards per row, 1 → 3 across breakpoints</div>
	</div>
</div>

<div class="row g-0">No gutters</div>
<div class="row g-3">1rem gutters</div>
<div class="row gx-5 gy-3">Independent horizontal/vertical gutters</div>
```

## Color Modes (light / dark / custom)

The 5.3 color-mode system replaces the old per-component dark variants.

### Mechanics

- `data-bs-theme="light|dark"` on `<html>` sets the mode globally; on any element it scopes the mode to that subtree (nested scopes win over ancestors). Default is light.
- Mode switching works by re-pointing root CSS variables — components never change their own rules. Core variables swapped per mode: `--bs-body-bg`, `--bs-body-color`, `--bs-emphasis-color`, `--bs-secondary-color`, `--bs-secondary-bg`, `--bs-tertiary-color`, `--bs-tertiary-bg`, `--bs-border-color`, `--bs-heading-color`, `--bs-link-color`.
- Each theme color also gets a mode-adaptive triplet — `--bs-{color}-text-emphasis`, `--bs-{color}-bg-subtle`, `--bs-{color}-border-subtle` — surfaced as `.text-{color}-emphasis`, `.bg-{color}-subtle`, `.border-{color}-subtle`. These are the workhorses for status UI that must read in both modes.
- **The triplet is a recipe, not a guarantee.** `text-{color}-emphasis` on `bg-{color}-subtle` is _designed_ to pass, and it usually does in stock Bootstrap — but the values are tokens, and a compatible skin redefines them. Resolve the actual computed values from the compiled cascade the page loads (the shipped CSS, dependency stylesheets included) and measure each pairing once per theme before you rely on it. A class with no rule of its own may still inherit one; never accept a value from documentation.
- Deprecated by this system: `.navbar-dark`, `.dropdown-menu-dark`, `.btn-close-white`, `.carousel-dark` → put `data-bs-theme="dark"` on the component or an ancestor instead.

### Author rules

- Paint custom CSS from `var(--bs-…)` — never hard-coded hex — so both modes track automatically.
- Prefer `bg-body`, `bg-body-secondary`, `bg-body-tertiary` and `text-body`, `text-body-secondary` over `bg-white`/`bg-light`/`text-dark`, which freeze a mode.
- A dark region inside a light page (or vice versa) is one attribute: `<footer data-bs-theme="dark">`.

### Theme toggle

Bootstrap ships **no** mode picker — you build the toggle. The essentials: read the stored preference, fall back to `prefers-color-scheme`, set `data-bs-theme` on `document.documentElement`, and do it in a script early in `<head>` so the first paint does not flash the wrong mode.

```js
const stored = localStorage.getItem('theme')
const preferred =
	stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
document.documentElement.setAttribute('data-bs-theme', preferred)
// On toggle: setAttribute + localStorage.setItem("theme", value)
```

### Custom modes

A custom mode is a named scope overriding the same variables:

```css
[data-bs-theme='midnight'] {
	--bs-body-bg: #0b1020;
	--bs-body-color: #dfe4f2;
	--bs-tertiary-bg: #131a30;
	--bs-border-color: #26304f;
}
[data-bs-theme='midnight'] .dropdown-menu {
	--bs-dropdown-bg: var(--bs-tertiary-bg);
}
```

In Sass: `$enable-dark-mode` (default true), `$color-mode-type: data` (attribute selectors) or `media-query` (`prefers-color-scheme` — loses per-component scoping), and the `@include color-mode(dark) { … }` mixin. Dark defaults live in `_variables-dark.scss`.

## Theming & Design Tokens

### The three-tier token model

Enterprise theming survives rebrands and dark mode only when tokens are tiered:

1. **Primitives** — raw values (`--brand-blue-600`, a spacing scale). Never referenced by component CSS directly.
2. **Semantic tokens** — intent (`--bs-primary`, `--bs-body-bg`, `--bs-border-color`, `--bs-danger`). Reference primitives.
3. **Component tokens** — one component's knobs (`--bs-btn-bg`, `--bs-card-spacer-y`). Reference semantics.

**In Bootstrap, the `--bs-*` variables ARE your semantic and component layers.** Define your primitives, map them onto `--bs-*`, and let components read only `var(--bs-…)`. Dark mode then becomes a re-point of semantic tokens under `[data-bs-theme="dark"]` — if dark mode ever requires editing a component rule, the tier boundary leaked. Name semantics by role, never appearance (`--surface-sunken`, not `--gray-100`): a value change must never force a rename. Raw hex scattered in component CSS is a primitive referenced directly — the root cause of un-themable UI.

### The CSS-variables-only path (no Sass build)

Every component exposes local `--bs-{component}-*` variables (`--bs-btn-color`, `--bs-card-bg`, `--bs-nav-link-padding-x`, `--bs-table-bg`, …). The documented no-build theming route — right for consuming the CDN build:

```css
:root {
	--bs-primary: #6f42c1; /* note: utility classes derived at build     */
	--bs-primary-rgb: 111, 66, 193; /* time need the -rgb partner updated too     */
}
.btn-brand {
	--bs-btn-bg: var(--bs-primary);
	--bs-btn-color: #fff;
	--bs-btn-hover-bg: color-mix(in srgb, var(--bs-primary), black 10%);
}
```

Overriding component variables in a scope beats high-specificity override rules every time: it composes with color modes, keeps specificity flat, and documents intent.

### The Sass path (compiled builds)

Import order matters — override maps **before** the files that consume them:

```scss
@import 'bootstrap/scss/functions';
// your $variable overrides here ($primary, $font-family-base, $border-radius…)
@import 'bootstrap/scss/variables';
@import 'bootstrap/scss/variables-dark';
// your map overrides here ($theme-colors, $spacers, $grid-breakpoints…)
@import 'bootstrap/scss/maps';
@import 'bootstrap/scss/mixins';
@import 'bootstrap/scss/root';
// …only the parts you use…
@import 'bootstrap/scss/utilities';
@import 'bootstrap/scss/utilities/api'; // generates utilities — keep LAST
```

Feature flags worth knowing: `$enable-dark-mode`, `$enable-rounded`, `$enable-shadows`, `$enable-gradients`, `$enable-rfs` (fluid type), `$enable-validation-icons`, `$enable-negative-margins`, `$enable-important-utilities`, `$enable-reduced-motion`. Custom theme colors added to `$theme-colors` also need entries in the subtle/emphasis maps (`$theme-colors-text`, `$theme-colors-bg-subtle`, `$theme-colors-border-subtle` — and their `-dark` twins) to get full color-mode support.

### Utilities API

All utilities generate from the `$utilities` Sass map — extend the system instead of writing one-off CSS. Definition keys: `property`, `values` (required), plus `class`, `state`, `responsive`, `rfs`, `print`, `rtl`, `css-var`, `local-vars`.

```scss
// After functions/variables/variables-dark/maps/mixins/utilities:
$utilities: map-merge(
	$utilities,
	(
		'cursor': (
			property: cursor,
			class: cursor,
			values: auto pointer grab,
		),
		// modify an existing one, e.g. make width responsive:
		'width': map-merge(
				map-get($utilities, 'width'),
				(
					responsive: true,
				)
			),
	)
);
@import 'bootstrap/scss/utilities/api';
```

Remove with `map-remove($utilities, "width")` or set the key to `null`. This is the sanctioned answer when the shipped scale is missing a step (e.g. a `vh-50` the design truly needs).

## Forms in Production

### Layout & labels

- **Top-aligned labels by default** — the evidence (eye-tracking form research) shows fastest completion and the cleanest single-column scan, and they survive narrow screens without reflow. Reserve left-aligned labels for dense read-back forms where vertical compression matters more than speed.
- Visible label or `.form-floating` — never placeholder-only (disappears on input, fails accessibility).
- **Do not say the same thing twice.** When the host already names the request — a card heading, a dialog title, a section header stating the question — the form associates with that name via `aria-labelledby` instead of repeating the prompt in its own label. Repetition reads as two different questions to a screen-reader user and as clutter to everyone else.
- One column beats multi-column for completion; use the form grid (`row g-3` + `col-md-*`) only for genuinely paired fields (city/state/zip).

```html
<form class="row g-3">
	<div class="col-md-6">
		<label for="inputEmail4" class="form-label">Email</label>
		<input type="email" class="form-control" id="inputEmail4" aria-describedby="emailHelp" />
		<div id="emailHelp" class="form-text">Work address preferred.</div>
	</div>
	<div class="col-md-6">
		<label for="inputPassword4" class="form-label">Password</label>
		<input type="password" class="form-control" id="inputPassword4" />
	</div>
	<div class="col-12">
		<button type="submit" class="btn btn-primary">Sign in</button>
	</div>
</form>
```

### Validation timing (the rules that matter)

- Validate a field **on blur** — after the user leaves it — never on every keystroke, and never before the user has reached the field. Exception: live feedback that _helps_ while typing (password strength, username availability, character counts).
- Once a field is in an error state, re-validate as the user types so they see the fix land.
- Always re-check everything on submit. Keep the submit button **enabled** — a disabled submit hides _what is_ wrong; a validating submit shows it.
- On failed submit of a long form, render an **error summary** at the top (focus it; link each item to its field) _and_ inline messages at each field — never summary-only, never inline-only.
- Error style = color + icon + text, stating what is wrong and how to fix it. Wire message to field with `aria-describedby`, mark the field `aria-invalid="true"`. Never report errors via tooltip-on-hover.

### Bootstrap validation mechanics

Client-side, the documented pattern:

```html
<form class="needs-validation" novalidate>
	<div class="mb-3">
		<label for="name" class="form-label">First name</label>
		<input type="text" class="form-control" id="name" required />
		<div class="invalid-feedback">Enter your first name.</div>
	</div>
	<button class="btn btn-primary" type="submit">Submit</button>
</form>

<script>
	;(() => {
		'use strict'
		const forms = document.querySelectorAll('.needs-validation')
		Array.from(forms).forEach((form) => {
			form.addEventListener(
				'submit',
				(event) => {
					if (!form.checkValidity()) {
						event.preventDefault()
						event.stopPropagation()
					}
					form.classList.add('was-validated')
				},
				false,
			)
		})
	})()
</script>
```

**Documented limitation (enterprise-critical):** Bootstrap's client-side validation styles and `valid/invalid-tooltip`s are **not exposed to assistive technologies**. For accessible flows use the server-side pattern — apply `.is-invalid` / `.is-valid` directly (no `.was-validated` parent needed), with `.invalid-feedback` linked via `aria-describedby` — or rely on native browser validation.

```html
<input
	type="text"
	class="form-control is-invalid"
	id="username"
	aria-describedby="usernameFeedback"
	aria-invalid="true"
	required
/>
<div id="usernameFeedback" class="invalid-feedback">
	Choose a username — letters and digits only.
</div>
```

Details: input groups with feedback need `.has-validation` on the group (border-radius fix). `.valid/invalid-tooltip` variants need a `position-relative` parent. Validation colors are mode-adaptive via `--bs-form-valid-color`, `--bs-form-valid-border-color`, `--bs-form-invalid-color`, `--bs-form-invalid-border-color`.

### Autosave vs explicit save

- **Autosave** (with a visible "Saved" status) for continuous low-risk editing: drafts, preferences, notes.
- **Explicit, pessimistic save** for audited, transactional, or financial records — a deliberate server-confirmed commit, no optimistic success on data that must be validated and logged.

## JavaScript Lifecycle

### Initialization

- Data-attribute components initialize from markup. **Tooltips and popovers are opt-in** — construct them; toasts are hidden until shown ([components.md](components.md) → JavaScript initialization).
- Constructors accept an element or a CSS selector string: `new bootstrap.Modal('#myModal', options)`.
- Prefer `getOrCreateInstance` when an instance may already exist; `getInstance` returns `null` if none:

```js
const modal = bootstrap.Modal.getOrCreateInstance('#confirm', { backdrop: 'static' })
modal.show()
```

### Events & async behavior

- Event pairs per component: infinitive fires at start and is cancelable (`show.bs.modal` → `event.preventDefault()`); past participle fires after the transition completes (`shown.bs.modal`, `hidden.bs.modal`, `shown.bs.collapse`, …).
- **All methods are asynchronous** — they return before the transition ends, and a method called on a transitioning component is ignored. Sequence work off the completion events, not timers.

### Teardown — SPAs and dynamic views

- `dispose()` destroys the instance and its DOM data. Call it when the host element leaves the DOM (route change, list re-render), or instances and listeners leak. Dispose only after any transition finishes:

```js
el.addEventListener('hidden.bs.modal', () => {
	bootstrap.Modal.getInstance(el)?.dispose()
})
```

- **Framework reality check:** Bootstrap's JS and a virtual-DOM framework both mutating the same nodes causes bugs (stuck dropdowns, ghost backdrops). In React/Vue/Angular apps, prefer the framework-native implementations (React Bootstrap, BootstrapVueNext, ng-bootstrap) which reuse Bootstrap's CSS but own the DOM. Use raw `bootstrap.*` JS in SPAs only for leaf widgets you fully control, and dispose them on unmount.

### Popper

Dropdowns, tooltips, and popovers require Popper — load `bootstrap.bundle.min.js` (includes it) or `@popperjs/core` before `bootstrap.min.js`. Modal, collapse, offcanvas, toast, tab, alert do not need it.

## Accessibility

### Baseline (every screen)

Hold the baseline in [SKILL.md](../SKILL.md) → Accessibility baseline. Its Bootstrap-specific parts:

- Skip link: `.visually-hidden-focusable` to `<main>`. Landmarks: `nav`, `main`, `aside`. Heading order `h1 → h2 → h3` without skips.
- Keep Bootstrap's focus rings; use the `.focus-ring` helper on custom interactive elements instead of removing outlines.
- `.visually-hidden` for screen-reader-only text; `.visually-hidden-focusable` for skip links. Never combine the two.
- Verify every color pairing against the shipped cascade. Bootstrap's own docs warn that parts of the default palette fall short.

**Measuring the bars:**

- Hold the bars from [SKILL.md](../SKILL.md) → Surfaces, color, contrast: **≥ 4.5:1** for everything information-bearing, **≥ 3:1** for textless marks and state chrome. WCAG 2.2 permits 3:1 for large text; this package does not — size grants no lower tier.
- Measure in **both themes**, from the compiled cascade, never from the token names. A pairing that passes in light routinely fails in dark, and a skin's values are its own.
- Focus rings and hover fills are UI graphics: they are in scope for the 3:1 bar.
- Disabled controls are exempt from the bars by the spec. That exemption covers legibility, not meaning — see [Destructive actions](#destructive-actions) for the one disabled state that still has to change color.

**The instrument.** Bootstrap paints in translucent layers: a card header and footer are a 3% tint of the body color over the card's own background. A reader that stops at the first painted ancestor and drops its alpha treats that tint as full-strength paint, and is then wrong in **both** directions — it green-lights a pairing nobody can read, and it red-flags one that reads fine. Use a reader that:

- collects every painted layer from the element upward to the first opaque one, then composites them top over bottom (Porter-Duff `over`) onto that opaque base;
- composites a translucent foreground over that result before taking the ratio, rather than reading the declared color;
- measures both themes in one run, since the theme swap re-points the tokens under every layer;
- carries a negative control drawn from outside the population it covers — a pairing known to fail — and voids the run if that control passes.

Wire the reader into the suite once it has settled a question.

### WCAG 2.2 deltas that bite dense app UI

- **Target size ≥ 24×24 CSS px (2.5.8, AA).** Icon buttons, row actions, close buttons, sort carets, checkbox hit-areas. A smaller visual target passes if a 24px spacing circle around it stays undisturbed — so in tight `table-sm` toolbars, pad the hit area rather than enlarging the glyph.
- **Focus not obscured (2.4.11, AA).** Sticky headers/footers/action bars and toast overlays must not bury the focused element. Reserve space with `scroll-margin-top` on focusables (or `scroll-padding-top` on the scroll container) equal to the sticky chrome height.
- **Dragging alternatives (2.5.7, AA).** Any drag (row reorder, kanban, slider, resize) needs a non-drag single-pointer path: move up/down buttons, numeric input, click-to-place.
- **Accessible authentication (3.3.8, AA).** Never block paste in password/OTP fields; support password managers; no puzzle as the only way in.
- **Redundant entry (3.3.7, A).** Do not ask for the same information twice in one flow — auto-fill or offer "same as above". Governs wizards directly.
- **Consistent help (3.2.6, A).** If a help affordance repeats across pages, keep it in the same relative place everywhere.
- Housekeeping: SC 4.1.1 Parsing was removed in 2.2 — duplicate-ID lint is no longer a WCAG failure by itself (still fix it).

### Pattern contracts (APG, compact)

- **Dialog/modal:** `role="dialog"` (`alertdialog` for destructive confirms) + `aria-modal="true"` + `aria-labelledby`. Focus moves in on open, Tab is trapped, Esc closes, focus returns to the invoker. Bootstrap's modal does this — verify you did not break focus-return by removing the trigger.
- **Tabs:** `tablist` > `tab` (+`aria-selected`, `aria-controls`) with panels `tabpanel`. Roving tabindex: Left/Right between tabs, Home/End to ends; only the selected tab is `tabindex="0"`.
- **Disclosure:** a `<button>` with `aria-expanded` + `aria-controls`. Enter/Space toggles. That is the whole contract — Bootstrap collapse matches it.
- **Radio group:** prefer native `<input type="radio" name>` — one tab stop and arrow-selection come free.
- **Combobox:** input `role="combobox"` + `aria-expanded` + `aria-controls` + `aria-activedescendant` tracking the active option; Down opens/advances, Enter accepts, Esc closes. This is the hardest contract on the list — see [When not to hand-roll](#when-not-to-hand-roll).
- **Toolbar:** `role="toolbar"` + `aria-label`; one tab stop, arrows move between controls (roving tabindex). Use it to collapse a dense button cluster's tab-stops.
- **Table vs grid:** semantics follow _interaction_, not looks — see [Dense data tables](#dense-data-tables).

### Focus management in SPAs

Browsers handle focus on full page loads; in an SPA **you** do:

- On route change, move focus to the new view's `h1` (or the `<main>` with `tabindex="-1"`) so SR users hear where they landed.
- On failed submit, focus the error summary. On destructive confirm, focus the dialog's safe action.
- After deleting a row, move focus to a sensible neighbor (next row / the table region), never let it fall to `<body>`.
- Anything focused programmatically under sticky chrome needs the `scroll-margin-top` offset (2.4.11 above).

### Reduced motion

Bootstrap wraps its transitions and animations (`.fade`, `.collapsing`, carousel slide, spinner speed) in `prefers-reduced-motion: reduce` handling — transitions are disabled or slowed automatically when `$enable-reduced-motion` is on (default). Your obligations: wrap **custom** animation in `@media (prefers-reduced-motion: no-preference)`, do not auto-play movement for reduced-motion users, and keep any purely decorative motion cuttable.

## Enterprise Patterns

### App shell

**Structure:** persistent left sidebar for dense apps with many top-level destinations (it scales, nests, and stays stable while content changes); top-bar-only nav for shallow apps (≤ ~5 destinations). A collapsible sidebar reclaims width for data.

The Bootstrap implementation — a responsive offcanvas that renders inline above `lg` and becomes a drawer below it, with no custom JS:

```html
<body>
	<a class="visually-hidden-focusable" href="#main">Skip to main content</a>
	<header class="navbar bg-body-tertiary border-bottom sticky-top">
		<div class="container-fluid">
			<button
				class="btn btn-secondary d-lg-none"
				type="button"
				data-bs-toggle="offcanvas"
				data-bs-target="#appSidebar"
				aria-controls="appSidebar"
				aria-label="Open navigation"
			>
				☰
			</button>
			<a class="navbar-brand" href="/">Product</a>
			<div class="d-flex align-items-center gap-2"><!-- search, account --></div>
		</div>
	</header>

	<div class="d-flex">
		<div
			class="offcanvas-lg offcanvas-start border-end"
			tabindex="-1"
			id="appSidebar"
			aria-labelledby="appSidebarLabel"
		>
			<div class="offcanvas-header">
				<h5 class="offcanvas-title" id="appSidebarLabel">Navigation</h5>
				<button
					type="button"
					class="btn-close"
					data-bs-dismiss="offcanvas"
					data-bs-target="#appSidebar"
					aria-label="Close"
				></button>
			</div>
			<div class="offcanvas-body d-lg-block p-lg-3" style="width: 260px;">
				<nav aria-label="Primary">
					<ul class="nav nav-pills flex-column gap-1">
						<li class="nav-item">
							<a class="nav-link active" aria-current="page" href="#">Dashboard</a>
						</li>
						<li class="nav-item"><a class="nav-link" href="#">Accounts</a></li>
						<li class="nav-item"><a class="nav-link" href="#">Reports</a></li>
					</ul>
				</nav>
			</div>
		</div>
		<main id="main" class="flex-grow-1 p-3 p-lg-4" style="min-width: 0;">
			<!-- min-width: 0 lets tables shrink instead of blowing out the flex row -->
		</main>
	</div>
</body>
```

**Navigation rules:**

- Breadcrumbs only for genuinely hierarchical models (org → account → contact); in flat or tabbed apps they are noise. Current item: `aria-current="page"`, not a link.
- A command palette (Ctrl/Cmd-K) is an accelerator **on top of** visible nav, never a replacement — everything it exposes needs a discoverable UI route too.
- Keyboard shortcuts: use conventional bindings (Ctrl/Cmd-K palette, `/` focuses search, `?` opens the shortcut cheat-sheet), surface them in tooltips, and never let single-key shortcuts fire while an input has focus.
- Dashboard composition follows the same craft as any screen: state the screen's single job, lead with the numbers that answer it, and keep every widget to one job — a dashboard is not a place to exhibit every chart type.

### Dense data tables

**Semantics first — table vs grid.** Default to a static `<table>`: links and buttons inside cells ride the natural tab order and screen readers get real table navigation free. Reserve `role="grid"` for _editable, cell-interactive_ spreadsheet-like UIs — grid means you now own roving tabindex and full arrow-key cell navigation. Never bolt `role="grid"` onto a read-only table because it "looks like a data grid": semantics follow interaction, not appearance.

**Craft rules:**

- **Align by type:** numbers, currency, dates right-aligned (`text-end`, header too); text left. Use tabular figures so digits stack into comparable columns: `font-variant-numeric: tabular-nums` on numeric cells (one small custom rule that earns its place).
- **Density:** `table-sm` for compact; offer density as a user toggle (comfortable/compact) driven by one token or wrapper class, not per-cell tweaks. Do not shrink font below readability to fake density.
- **Sticky header** once the table meaningfully scrolls (roughly a viewport / ~15+ rows). Not built into Bootstrap — the pattern:

```html
<div class="table-responsive" style="max-height: 70vh;">
	<table class="table table-sm align-middle">
		<thead class="sticky-top">
			<tr>
				<th scope="col" class="bg-body-secondary">…</th>
			</tr>
		</thead>
		…
	</table>
</div>
```

Give header cells an **opaque background** (`bg-body-secondary` or a table variant) — table backgrounds are transparent by default, so rows show through a sticky header otherwise. Sticky chrome is the prime Focus-Not-Obscured offender: add `scroll-margin-top` on row focusables equal to the header height. Sticky first column only when row identity is lost on horizontal scroll — it costs paint and complexity.

- **Sorting:** the whole header is a button (not a bare caret), with a visible direction indicator, and `aria-sort="ascending|descending"` on the active `<th>` only:

```html
<th scope="col" aria-sort="ascending">
	<button type="button" class="btn btn-link p-0 fw-semibold text-body text-decoration-none">
		Amount <span aria-hidden="true">↑</span>
	</button>
</th>
```

- **Row actions:** 1–3 high-frequency actions inline; the rest behind a per-row kebab (dropdown). Hover-only reveal fails touch and keyboard — keep at least the overflow trigger always visible and ≥24px.
- **Selection & bulk actions:** header checkbox with indeterminate state for partial selection; per-row checkboxes with `aria-label` naming the row ("Select INV-1042"). When selection > 0, swap the toolbar's content in place for a contextual bar — "3 selected", the batch actions, and a clear-selection escape — never push the layout down (layout-shifting chrome is an anti-pattern). Announce the count via a polite live region.
- **Pagination vs scrolling:** paginate when users need position, totals, deep links, and "go to page N" — most enterprise CRUD. Virtualize (windowed rendering) for long uniform lists where scrolling is natural. True infinite scroll is for exploratory feeds only — never where users need a footer or a findable end.
- **Responsive, ranked:** (1) _priority columns_ — hide low-value columns per breakpoint (`d-none d-lg-table-cell`), always keeping the identifying + decision columns; (2) _horizontal scroll_ (`table-responsive`) when every column matters — remember it clips dropdowns; (3) _card-ify_ into label:value stacks below `md` for low row counts. Never card-ify a wide comparison table — comparison is the point.
- **Table states:** loading → **skeleton rows** matching the real column count/widths (a centered spinner collapses the layout); empty → distinguish _no data yet_ (invite the first action) from _no results for these filters_ (offer "Clear filters"); error → inline retry inside the table region, header and toolbar preserved.

### Filter & search bars

- One toolbar above the table: search input first (`role="search"` on the form), then the 2–4 highest-value filters as `form-select`/segmented controls, overflow filters behind a "Filters" button (offcanvas on mobile, dropdown/collapse on desktop).
- **Active filters must be visible and dismissible** — chips/badges with an ✕ and a "Clear all" — users must see _why_ the list is short. A filtered-empty state repeats the escape hatch.
- Debounce live search; show result counts ("128 results") so feedback is immediate; filter state belongs in the URL when views are shareable.
- Toolbars that overflow: `flex-nowrap overflow-auto` beats wrapping into a two-row toolbar mid-task — do not crush icon targets below 24px.

### Wizards & multi-step forms

- Show step progress: current position, total, and step names ("Step 2 of 4 — Billing"); `list-group-numbered` or a simple nav renders it honestly.
- Validate per step before advancing; never let a step advance carrying invalid data.
- Back never loses data. Persist partial state (save-and-resume) for anything beyond ~3 steps or that crosses sessions.
- Never re-ask what a previous step collected (Redundant Entry, 3.3.7) — carry it forward or offer "same as above".
- Last step: a review summary with per-section edit links, then one clearly-named commit action ("Create account", not "Submit").

### The five states

Design **all five** for every data surface: ideal (populated), empty, loading, partial, error. A component is not done until all five exist.

- **Skeleton vs spinner:** skeleton (`placeholder` + `placeholder-glow`) when you know the content's shape and it fills a region — tables, cards, detail panes — because it holds layout and shortens perceived wait. Spinner for short, indeterminate, or in-control waits (inside a button, a small inline fetch).
- **Thresholds (guidance):** under ~1s show nothing — a flashed loader is worse than none; ~1–10s show a spinner or skeleton; beyond ~10s show determinate progress (percent or step) so it does not feel hung.
- **Optimistic vs pessimistic:** apply UI immediately and reconcile (rolling back loudly on failure) for reversible high-frequency actions — toggles, stars, reorders. Await confirmation for money, audited records, and anything a rollback would confuse.
- **Empty states** invite the next action (button + one line of why). Never-had-data and filtered-empty are different states with different escapes — never ship one generic "nothing here".
- **Every error state states what failed and how to fix it**, carries a keyboard-reachable retry in place, and preserves surrounding context — a body fetch failure must not blow away the toolbar and filters.

### Feedback discipline

| Channel                       | Use for                                                                          | Never for                                          |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Toast**                     | Transient confirmation of a just-completed action; auto-dismiss; `role="status"` | Errors needing action; anything the user must read |
| **Inline alert**              | Feedback tied to a specific field/section/action; persists in context            | App-wide conditions                                |
| **Banner** (page-level alert) | Persistent page/app conditions — outage, trial expiring, permissions             | Action confirmations                               |
| **Modal / alertdialog**       | Blocking decisions the user must resolve now                                     | FYIs, success messages                             |

Blocking errors are never toasts. Keep the acting verb consistent across the flow: the "Publish" button confirms with "Published".

### Destructive actions

Match friction to reversibility × blast radius:

1. **Undo** (soft-delete + toast with Undo) for reversible, low-stakes, frequent actions — least friction, best experience. Prefer making actions undoable over interrupting them.
2. **Confirm dialog** for irreversible-but-scoped operations. Restate the specific consequence ("This permanently deletes 3 invoices"), verb-labeled buttons ("Delete invoices" / "Cancel" — never Yes/No), destructive action visually separated from safe; `alertdialog` semantics; focus lands on the safe action.
3. **Type-to-confirm** (type the entity name) only for high-blast-radius irreversible operations — delete an org, drop a dataset.

Do not type-gate a single-row delete; do not one-tap a tenant wipe. Confirm only where this ladder calls for it — a confirmation on every action gets clicked through.

**Neutralize a disabled destructive control.** `btn-danger` at full saturation reads as armed whatever the `disabled` attribute says, and the contrast exemption for disabled controls does not excuse it. While the action is unavailable, drop to the neutral or outline variant (or let the disabled state mute the fill) so the color stops promising an action, and say _why_ it is unavailable in text the assistive layer reaches: `aria-describedby` pointing at the reason, with `title` only as the pointer-user convenience on top. Never use `title` alone — it never reaches a keyboard or screen-reader user, and it disappears on touch.

## RTL

- Enable per page: `<html lang="ar" dir="rtl">` + the RTL stylesheet `bootstrap.rtl.min.css` (built from the same source via RTLCSS). RTL support is documented as experimental.
- The logical properties model is why the utilities say start/end: `ms-*`/`me-*`, `ps-*`/`pe-*`, `text-start`/`text-end`, `float-start`/`float-end`, `offcanvas-start`/`end` all flip automatically. **Never write `left`/`right` positioning or physical margins in custom CSS** — use logical properties (`margin-inline-start`, `inset-inline-end`) so your custom rules flip too.
- Caveats: shipping LTR+RTL simultaneously costs significant extra CSS; the breadcrumb divider needs `$breadcrumb-divider-flipped`; source Sass can embed RTLCSS directives (`/* rtl: … */`) for value swaps like font stacks.

## Print

- Hide chrome, keep the data: `d-print-none` on nav, sidebars, toolbars, action buttons; the report/table itself stays printable.
- `d-print-block`/`d-print-table` can resurface content hidden on screen (a print-only header with report title/date).
- Print-check data screens users will export: collapse interactive affordances (sort carets, checkboxes) via `d-print-none`, and prefer `table-bordered` legibility over hover/stripe effects that may not print.

## Performance

- **Ship one CSS system, not two.** Bootstrap plus a second framework (or a parallel bespoke layer) doubles payload and guarantees specificity fights.
- **Compressed, the full build is cheap; incomplete builds are not.** Trimming via a Sass-subset build (import only the parts used — see [Theming](#theming--design-tokens)) is the sanctioned diet. Aggressive purge tools are the risky one: Bootstrap adds classes **at runtime** (`show`, `showing`, `fade`, `collapsing`, `modal-open`, `modal-backdrop`, `offcanvas-backdrop`, tooltip/popover generated markup) — purging without safelisting them ships UIs whose modals silently stop rendering. If you purge, safelist every JS-toggled class and test every overlay.
- **Icons:** Bootstrap Icons is a separate package — prefer inline SVG or an SVG sprite (crisp, styleable via `currentColor`, no font flash) over the icon font; load only the icons used.
- **JS:** the bundle is small, but only load it where behavior exists; per-component ESM imports (`bootstrap/js/dist/modal`) trim further in bundlers.
- **Fonts:** each display face is a payload decision; subset and `font-display: swap` characterful faces, and let the data face fall back to the system stack when the brief allows.

## When Not to Hand-Roll

Bootstrap has **no** combobox/autocomplete, date picker, multi-select tags input, data grid, or tree view. The boundary rule:

- **Reach for native first:** `<input type="date">`, `<datalist>` for light autocomplete, `<select multiple>` where acceptable. Native widgets bring keyboard and AT behavior free.
- **Reach for an established accessible library second** when the product genuinely needs the richer widget (combobox with async search, spreadsheet grid, drag-reorder tree). Budget for auditing it against the APG contract.
- **Hand-roll last**, only with the APG contract in hand ([Accessibility](#accessibility) → Pattern contracts) and budget for the _keyboard_ half, which is most of the work.
- Never fake it: a `.dropdown-menu` posing as a select, a `<div>` grid with click handlers, or a scroll-anchor "wizard" each break keyboard and AT users in ways a demo never shows.

## Common Layout Patterns

### Centered content

```html
<div class="d-flex justify-content-center align-items-center vh-100">
	<div>Centered content</div>
</div>
```

### Sticky footer

```html
<body class="d-flex flex-column min-vh-100">
	<main class="flex-grow-1">Content</main>
	<footer>Footer</footer>
</body>
```

### Equal height columns

```html
<div class="row">
	<div class="col-md-6"><div class="card h-100">Equal height</div></div>
	<div class="col-md-6"><div class="card h-100">Equal height</div></div>
</div>
```

### Responsive visibility

```html
<div class="d-none d-md-block">Hidden on mobile, visible md+</div>
<div class="d-md-none">Visible only below md</div>
```
