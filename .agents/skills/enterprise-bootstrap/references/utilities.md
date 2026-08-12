# Bootstrap 5 Utilities Reference

> Part of the `enterprise-bootstrap` package. Bootstrap **5.3.x** class index +
> composition notes. Component markup: [components.md](components.md).
> Theming, patterns, a11y: [bootstrap-reference.md](bootstrap-reference.md).

## Contents

- [Utility classes](#utility-classes-quick-reference) — background, borders, text color, display, flexbox, float, interactions, links, object fit, opacity, overflow, position, shadows, sizing, spacing, text, vertical align, visibility, z-index
- [Scales](#spacing-scale) — spacing scale, z-index component scale
- [Print utilities](#print-utilities)
- [Helpers](#helpers) — visually-hidden, stretched-link, ratio, stacks, vr, focus-ring, icon-link
- [Enterprise notes](#enterprise-notes-utilities) — composition habits

## Utility Classes Quick Reference

### Background

```css
.bg-primary, .bg-secondary, .bg-success, .bg-danger, .bg-warning, .bg-info, .bg-light, .bg-dark, .bg-body, .bg-white, .bg-transparent, .bg-black
.bg-body-secondary, .bg-body-tertiary
.bg-primary-subtle, .bg-secondary-subtle, .bg-success-subtle, .bg-danger-subtle, .bg-warning-subtle, .bg-info-subtle, .bg-light-subtle, .bg-dark-subtle
.bg-gradient
.bg-opacity-10, .bg-opacity-25, .bg-opacity-50, .bg-opacity-75, .bg-opacity-100
```

Prefer `bg-body-*` and `*-subtle` over `bg-white`/`bg-light` — they track `data-bs-theme` so dark mode works without extra rules.

### Borders

```css
.border, .border-top, .border-end, .border-bottom, .border-start
.border-0, .border-top-0, .border-end-0, .border-bottom-0, .border-start-0
.border-1, .border-2, .border-3, .border-4, .border-5          /* widths */
.border-primary, .border-secondary, .border-success, .border-danger, .border-warning, .border-info, .border-light, .border-dark, .border-white, .border-black
.border-primary-subtle, .border-secondary-subtle, .border-success-subtle, .border-danger-subtle, .border-warning-subtle, .border-info-subtle, .border-light-subtle, .border-dark-subtle
.border-opacity-10, .border-opacity-25, .border-opacity-50, .border-opacity-75, .border-opacity-100
.rounded, .rounded-top, .rounded-end, .rounded-bottom, .rounded-start, .rounded-circle, .rounded-pill
.rounded-0, .rounded-1, .rounded-2, .rounded-3, .rounded-4, .rounded-5
```

For borders that must stay visible in both color modes, prefer `border-*-subtle` variants (theme-adaptive) over raw color borders.

### Colors (Text)

```css
.text-primary, .text-secondary, .text-success, .text-danger, .text-warning, .text-info, .text-light, .text-dark
.text-body, .text-body-secondary, .text-body-tertiary, .text-body-emphasis
.text-primary-emphasis, .text-secondary-emphasis, .text-success-emphasis, .text-danger-emphasis, .text-warning-emphasis, .text-info-emphasis, .text-light-emphasis, .text-dark-emphasis
.text-black, .text-white, .text-black-50, .text-white-50
.text-muted        /* DEPRECATED in 5.3 — use .text-body-secondary; removed in v6 */
.text-opacity-25, .text-opacity-50, .text-opacity-75, .text-opacity-100
```

### Display

```css
.d-none, .d-inline, .d-inline-block, .d-block, .d-grid, .d-inline-grid, .d-table, .d-table-cell, .d-table-row, .d-flex, .d-inline-flex
.d-{breakpoint}-none, .d-{breakpoint}-inline, .d-{breakpoint}-inline-block, .d-{breakpoint}-block, .d-{breakpoint}-grid, .d-{breakpoint}-inline-grid, .d-{breakpoint}-table, .d-{breakpoint}-table-cell, .d-{breakpoint}-table-row, .d-{breakpoint}-flex, .d-{breakpoint}-inline-flex
```

### Flexbox

```css
/* Direction */
.flex-row, .flex-column, .flex-row-reverse, .flex-column-reverse
.flex-{breakpoint}-row, .flex-{breakpoint}-column, .flex-{breakpoint}-row-reverse, .flex-{breakpoint}-column-reverse

/* Justify Content */
.justify-content-start, .justify-content-end, .justify-content-center, .justify-content-between, .justify-content-around, .justify-content-evenly
.justify-content-{breakpoint}-start, .justify-content-{breakpoint}-end, .justify-content-{breakpoint}-center, .justify-content-{breakpoint}-between, .justify-content-{breakpoint}-around, .justify-content-{breakpoint}-evenly

/* Align Items */
.align-items-start, .align-items-end, .align-items-center, .align-items-baseline, .align-items-stretch
.align-items-{breakpoint}-start, .align-items-{breakpoint}-end, .align-items-{breakpoint}-center, .align-items-{breakpoint}-baseline, .align-items-{breakpoint}-stretch

/* Align Self */
.align-self-start, .align-self-end, .align-self-center, .align-self-baseline, .align-self-stretch

/* Fill */
.flex-fill, .flex-{breakpoint}-fill

/* Grow/Shrink */
.flex-grow-0, .flex-grow-1, .flex-shrink-0, .flex-shrink-1

/* Wrap */
.flex-wrap, .flex-nowrap, .flex-wrap-reverse

/* Order */
.order-first, .order-0, .order-1, .order-2, .order-3, .order-4, .order-5, .order-last

/* Align Content */
.align-content-start, .align-content-end, .align-content-center, .align-content-between, .align-content-around, .align-content-stretch
```

### Float

```css
.float-start, .float-end, .float-none
.float-{breakpoint}-start, .float-{breakpoint}-end, .float-{breakpoint}-none
```

### Interactions

```css
.user-select-all, .user-select-auto, .user-select-none
.pe-none, .pe-auto        /* pointer-events */
```

`.pe-none` blocks pointer input only — keyboard and assistive tech can still reach the element. Pair with `tabindex="-1"` and `aria-disabled="true"`, or better, use the real `disabled` attribute on form controls and drop `href` on links.

### Link

```css
.link-primary, .link-secondary, .link-success, .link-danger, .link-warning, .link-info, .link-light, .link-dark
.link-body-emphasis
.link-opacity-10, .link-opacity-25, .link-opacity-50, .link-opacity-75, .link-opacity-100
.link-underline, .link-underline-primary (…per theme color)
.link-underline-opacity-0, .link-underline-opacity-10, .link-underline-opacity-25, .link-underline-opacity-50, .link-underline-opacity-75, .link-underline-opacity-100
.link-offset-1, .link-offset-2, .link-offset-3
```

### Object Fit

```css
.object-fit-contain, .object-fit-cover, .object-fit-fill, .object-fit-scale, .object-fit-none
.object-fit-{breakpoint}-contain, .object-fit-{breakpoint}-cover, .object-fit-{breakpoint}-fill, .object-fit-{breakpoint}-scale, .object-fit-{breakpoint}-none
```

### Opacity

```css
.opacity-0, .opacity-25, .opacity-50, .opacity-75, .opacity-100
```

### Overflow

```css
.overflow-auto, .overflow-hidden, .overflow-visible, .overflow-scroll
.overflow-x-auto, .overflow-x-hidden, .overflow-x-visible, .overflow-x-scroll
.overflow-y-auto, .overflow-y-hidden, .overflow-y-visible, .overflow-y-scroll
```

### Position

```css
.position-static, .position-relative, .position-absolute, .position-fixed, .position-sticky
.fixed-top, .fixed-bottom
.sticky-top, .sticky-bottom
.top-0, .top-50, .top-100
.bottom-0, .bottom-50, .bottom-100
.start-0, .start-50, .start-100
.end-0, .end-50, .end-100
.translate-middle, .translate-middle-x, .translate-middle-y
```

### Shadows

```css
.shadow-none, .shadow-sm, .shadow, .shadow-lg
```

### Sizing

Bootstrap ships exactly these — nothing else (no `.vw-25`, `.vh-50`, `.mw-auto`, `.min-vh-75`, etc.; add missing steps via the utilities API if a project truly needs them — see [bootstrap-reference.md](bootstrap-reference.md)):

```css
/* Width / height (percent of parent) */
.w-25, .w-50, .w-75, .w-100, .w-auto
.h-25, .h-50, .h-75, .h-100, .h-auto

/* Max */
.mw-100, .mh-100

/* Viewport */
.vw-100, .vh-100, .min-vw-100, .min-vh-100
```

### Spacing

```css
/* Format: {property}{sides}-{size} or {property}{sides}-{breakpoint}-{size} */
/* Property: m (margin), p (padding) */
/* Sides: t, b, s (start), e (end), x, y, (blank) */
/* Size: 0, 1, 2, 3, 4, 5, auto (margins only) */

.m-0 … .m-5, .m-auto      .mt-* .mb-* .ms-* .me-* .mx-* .my-*   (same sizes, + auto)
.p-0 … .p-5               .pt-* .pb-* .ps-* .pe-* .px-* .py-*   (same sizes)

/* Gap — flex and grid parents */
.gap-0 … .gap-5
.row-gap-0 … .row-gap-5
.column-gap-0 … .column-gap-5
```

Notes: `s`/`e` are logical start/end — they flip automatically under RTL; never reach for physical left/right. `.g-*` / `.gx-*` / `.gy-*` are **row gutters** (used on `.row`), a separate system from `gap-*`. Negative margins exist in source but are disabled by default (`$enable-negative-margins`).

### Text

```css
/* Alignment */
.text-start, .text-center, .text-end
.text-{breakpoint}-start, .text-{breakpoint}-center, .text-{breakpoint}-end

/* Wrap / break */
.text-wrap, .text-nowrap, .text-break

/* Transform */
.text-lowercase, .text-uppercase, .text-capitalize

/* Weight / italics */
.fw-lighter, .fw-light, .fw-normal, .fw-medium, .fw-semibold, .fw-bold, .fw-bolder
.fst-normal, .fst-italic

/* Line height */
.lh-1, .lh-sm, .lh-base, .lh-lg

/* Family / reset / decoration */
.font-monospace, .text-reset
.text-decoration-none, .text-decoration-underline, .text-decoration-line-through

/* Size */
.fs-1, .fs-2, .fs-3, .fs-4, .fs-5, .fs-6

/* Truncate — needs display block/inline-block or a flex child with min-width 0 */
.text-truncate
```

Two composition traps in this group:

- **`fs-*` without `lh-1` grows the row.** A resized glyph or mark keeps the parent's line-height, so the line box stretches and the row sits taller than its neighbors. Pair `fs-*` with `lh-1` on anything that is a mark rather than a paragraph.
- **`text-truncate` zeroes a flex item's automatic minimum size** (that's the `min-width: 0` it carries). Inside a flex _column_, that also removes the floor that kept a heading at its own height: a growing sibling then squeezes the title from the bottom until it clips. Floor the title with `flex-shrink-0` and let the growing sibling absorb the change.

### Vertical Align

```css
.align-baseline, .align-top, .align-middle, .align-bottom, .align-text-top, .align-text-bottom
```

### Visibility

```css
.visible, .invisible
```

### Z-index

```css
.z-n1, .z-0, .z-1, .z-2, .z-3    /* NOT responsive — no breakpoint variants exist */
```

## Spacing Scale

| Class  | Size                           |
| ------ | ------------------------------ |
| `0`    | 0                              |
| `1`    | $spacer \* .25 (0.25rem = 4px) |
| `2`    | $spacer \* .5 (0.5rem = 8px)   |
| `3`    | $spacer (1rem = 16px)          |
| `4`    | $spacer \* 1.5 (1.5rem = 24px) |
| `5`    | $spacer \* 3 (3rem = 48px)     |
| `auto` | auto                           |

## Z-index Scale (components)

| Component          | Z-index |
| ------------------ | ------- |
| Dropdown           | 1000    |
| Sticky             | 1020    |
| Fixed              | 1030    |
| Offcanvas backdrop | 1040    |
| Offcanvas          | 1045    |
| Modal backdrop     | 1050    |
| Modal              | 1055    |
| Popover            | 1070    |
| Tooltip            | 1080    |
| Toast              | 1090    |

## Print Utilities

```css
.d-print-none, .d-print-inline, .d-print-inline-block, .d-print-block, .d-print-grid, .d-print-table, .d-print-table-cell, .d-print-table-row, .d-print-flex, .d-print-inline-flex
```

## Helpers

Helpers are single-purpose classes that sit alongside utilities.

- **`.visually-hidden`** — hide visually, keep for screen readers (icon-button labels, table caption text, "Danger:" prefixes).
- **`.visually-hidden-focusable`** — hidden until focused; the skip-link class. Never combine with `.visually-hidden`.
- **`.stretched-link`** — makes a whole `position-relative` container (e.g. a card) the click target of one inner link, without wrapping everything in `<a>`.
- **`.ratio .ratio-16x9`** (also `1x1`, `4x3`, `21x9`, or `--bs-aspect-ratio`) — responsive embeds/iframes.
- **`.vstack` / `.hstack gap-*`** — shorthand vertical/horizontal flex stacks for quick toolbars and side rails.
- **`.vr`** — vertical rule divider inside an `.hstack` or flex row.
- **`.focus-ring`** (+ `.focus-ring-primary` … per theme color) — opt-in focus ring for custom interactive elements; tune via `--bs-focus-ring-width` (.25rem), `--bs-focus-ring-opacity` (.25), `--bs-focus-ring-color`, `--bs-focus-ring-x/y/blur`. Use it instead of `outline: none` hacks so keyboard focus stays visible.
- **`.icon-link`** (+ `.icon-link-hover`) — pairs a Bootstrap Icon SVG with a text link; icon auto-sizes to 1em; give decorative icons `aria-hidden="true"`. Hover shift via `--bs-icon-link-transform`.

## Enterprise notes (utilities)

### Composition habits

- **Spacing scale:** prefer `gap-*` on flex/grid parents over scattering `m-*` on every child — the parent owns rhythm, children stay reorderable. Use `p-3` / `p-4` for panel padding; reserve `p-5` for sparse marketing-like empty states.
- **Body surfaces:** `bg-body`, `bg-body-secondary`, `bg-body-tertiary` track `data-bs-theme` — raw `bg-white` / `bg-light` freeze the surface in light mode.
- **Text hierarchy:** `text-body` for content, `text-body-secondary` for meta, `text-*-emphasis` when a status must stay readable on subtle backgrounds. `text-body-tertiary` is the decoration tier — it misses the 4.5:1 bar for information-bearing small text, so anything a user must read is `text-body-secondary` or better.
- **Opacity traps:** `text-white-50` / `text-black-50` often fail contrast — prefer `text-opacity-75` on a known solid, or `text-body-secondary`. Every one of these pairings is measured against the shipped cascade in both themes; a skin retunes the same token names.
- **Flex floors:** a flex column gives its items an automatic minimum size, and `text-truncate` removes it. Titles and marks that must keep their height carry `flex-shrink-0`; only the growing sibling absorbs the slack.
- **Flex toolbars:** `d-flex align-items-center gap-2 flex-wrap` (or `flex-nowrap overflow-auto` for dense bars). Equal-height siblings: `align-items-stretch` + `h-100` on cards.
- **Responsive hide:** show the best layout per breakpoint (`d-none d-md-block` vs `d-md-none`) rather than cramming one layout everywhere. Below `sm`, hide button captions (`d-none d-sm-inline` on the label span, `aria-label` on the control so the accessible name stays) before you let the brand or page title truncate.
- **RTL safety:** always `ms-*`/`me-*`/`ps-*`/`pe-*`, `text-start`/`text-end`, `float-start`/`float-end` — the logical model is what lets one build serve LTR and RTL.
- **Density as a system:** when a screen offers compact/comfortable density, drive it from a token or wrapper class that swaps padding — not ad-hoc `-sm` sprinkling per element ([bootstrap-reference.md](bootstrap-reference.md) → Design tokens).
- **Shadows:** `shadow-sm` for panels in product UI; `shadow-lg` rarely belongs in dense admin screens.
- **Print:** mark chrome `d-print-none`; keep the data table/results printable.
