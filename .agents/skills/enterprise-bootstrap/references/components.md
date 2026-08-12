# Bootstrap 5 Component Reference

> Part of the `enterprise-bootstrap` package. Bootstrap **5.3.x** component
> markup + enterprise selection notes. Utility classes: [utilities.md](utilities.md).
> Theming, forms deep-dive, JS lifecycle, patterns: [bootstrap-reference.md](bootstrap-reference.md).

## Contents

- [Component list](#complete-component-list) — layout, content, form components
- Markup: [Accordion](#accordion) · [Alerts](#alerts) · [Badge](#badge) · [Breadcrumb](#breadcrumb) · [Buttons](#buttons) · [Button group](#button-group) · [Card](#card) · [Carousel](#carousel) · [Close button](#close-button) · [Collapse](#collapse) · [Dropdown](#dropdown) · [List group](#list-group) · [Modal](#modal) · [Navbar](#navbar) · [Navs & tabs](#navs--tabs) · [Offcanvas](#offcanvas) · [Pagination](#pagination) · [Placeholder](#placeholder-skeletons) · [Popover](#popover-requires-popperjs) · [Progress](#progress) · [Scrollspy](#scrollspy) · [Spinners](#spinners) · [Tables](#tables) · [Toasts](#toasts) · [Tooltip](#tooltip-requires-popperjs)
- [JavaScript initialization](#javascript-initialization) — which components need JS, which auto-init
- [Icons](#icons) — icon sourcing, status glyph marks
- [Enterprise notes](#enterprise-notes-components) — choosing components, forms, selection fills, navigation, theming

## Complete Component List

### Layout Components

- Containers: `.container`, `.container-fluid`, `.container-{breakpoint}`
- Grid: `.row`, `.col`, `.col-{1-12}`, `.col-{breakpoint}-{1-12}`
- CSS Grid (opt-in): `.grid`, `.g-col-{1-12}`

### Content Components

- Typography: `.h1`–`.h6`, `.display-1`–`.display-6`, `.lead`, `.small`
- Images: `.img-fluid`, `.img-thumbnail`, `.figure`
- Tables: `.table` + variants — see [Tables](#tables)
- Figures: `.figure`, `.figure-img`, `.figure-caption`

### Form Components

- Control: `.form-control`, `.form-control-lg/sm`, `.form-select`
- Check/Radio: `.form-check`, `.form-check-input`, `.form-check-label`
- Switch: `.form-switch`
- Range: `.form-range`
- Floating: `.form-floating`
- Input Group: `.input-group`, `.input-group-text`, `.has-validation`
- Validation: `.was-validated`, `.is-valid/invalid`, `.valid/invalid-feedback/tooltip`

Full form patterns and validation JS: [bootstrap-reference.md](bootstrap-reference.md) → Forms in production.

## Component Markup

### Accordion

```html
<div class="accordion" id="accordionExample">
	<div class="accordion-item">
		<h2 class="accordion-header">
			<button
				class="accordion-button"
				type="button"
				data-bs-toggle="collapse"
				data-bs-target="#collapseOne"
				aria-expanded="true"
				aria-controls="collapseOne"
			>
				Item #1
			</button>
		</h2>
		<div
			id="collapseOne"
			class="accordion-collapse collapse show"
			data-bs-parent="#accordionExample"
		>
			<div class="accordion-body">Body content</div>
		</div>
	</div>
	<div class="accordion-item">
		<h2 class="accordion-header">
			<button
				class="accordion-button collapsed"
				type="button"
				data-bs-toggle="collapse"
				data-bs-target="#collapseTwo"
				aria-expanded="false"
				aria-controls="collapseTwo"
			>
				Item #2
			</button>
		</h2>
		<div id="collapseTwo" class="accordion-collapse collapse" data-bs-parent="#accordionExample">
			<div class="accordion-body">Body content</div>
		</div>
	</div>
</div>
```

Variants: `.accordion-flush` (edge-to-edge, no outer borders); omit `data-bs-parent` to allow multiple items open.

### Alerts

```html
<div class="alert alert-primary" role="alert">Primary alert</div>
<div class="alert alert-success" role="alert">Success alert</div>
<div class="alert alert-danger" role="alert">Danger alert</div>
<div class="alert alert-warning" role="alert">Warning alert</div>

<div class="alert alert-primary d-flex align-items-center" role="alert">
	<svg class="bi flex-shrink-0 me-2" role="img" aria-label="Info:">...</svg>
	<div>Alert with icon</div>
</div>

<div class="alert alert-success alert-dismissible fade show" role="alert">
	<h4 class="alert-heading">Well done!</h4>
	<p>Content here.</p>
	<hr />
	<p class="mb-0">Additional info.</p>
	<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
</div>
```

`role="alert"` announces immediately when the element is injected into the DOM — right for errors and warnings. For calm status messages injected dynamically, prefer a polite live region (`role="status"`). Anything that _looks_ like an alert carries the alert role: styling and semantics disagree the moment a notice wears `.alert` chrome with no role, and an accessibility snapshot is what catches it. When to use alert vs toast vs banner: [bootstrap-reference.md](bootstrap-reference.md) → Feedback discipline.

### Badge

```html
<span class="badge text-bg-primary">Primary</span>
<span class="badge text-bg-secondary">Secondary</span>
<span class="badge text-bg-success">Success</span>
<span class="badge text-bg-danger">Danger</span>
<span class="badge text-bg-warning">Warning</span>
<span class="badge text-bg-info">Info</span>
<span class="badge text-bg-light">Light</span>
<span class="badge text-bg-dark">Dark</span>

<span class="badge rounded-pill text-bg-primary">Pill badge</span>

<!-- Notification counter positioned on a control -->
<button type="button" class="btn btn-primary position-relative">
	Inbox
	<span
		class="position-absolute top-0 start-100 translate-middle badge rounded-pill text-bg-danger"
	>
		9<span class="visually-hidden">unread messages</span>
	</span>
</button>
```

Use `text-bg-*` (auto-contrasting text) rather than `bg-*` alone. A badge is never the only carrier of meaning — pair color with text or a visually-hidden label.

**A badge is never a textless mark.** Stock Bootstrap ships `.badge:empty { display: none }`, so an empty `<span class="badge">` used as a status dot renders nothing at all — the surface silently loses the state it claimed to show, and source review never sees it. A textless status mark is an **icon glyph** (see [Icons](#icons) → Status glyph marks), not a stripped badge.

**A badge's fill is never assumed.** Stock `.badge` carries no background of its own, but compatible skins may give it one, so an "unfilled" badge can arrive painted and land at a contrast the design never intended. State the fill explicitly — `bg-*-subtle` for a muted badge, `bg-transparent` when the surface behind it must show through — and measure the result in both themes against the cascade the page actually loads.

A badge reporting an in-flight request is a live region: `role="status"` on the badge (or on the small wrapper that holds it) announces the settled state politely without stealing focus. Reserve `role="alert"` for alert-styled notices ([Alerts](#alerts)).

### Breadcrumb

```html
<nav style="--bs-breadcrumb-divider: '>';" aria-label="Breadcrumb">
	<ol class="breadcrumb">
		<li class="breadcrumb-item"><a href="#">Home</a></li>
		<li class="breadcrumb-item"><a href="#">Library</a></li>
		<li class="breadcrumb-item active" aria-current="page">Data</li>
	</ol>
</nav>
```

The current page is `aria-current="page"` and not a link. Use breadcrumbs only for genuinely hierarchical models — in flat or tabbed apps they are noise.

### Buttons

```html
<button type="button" class="btn btn-primary">Primary</button>
<button type="button" class="btn btn-secondary">Secondary</button>
<button type="button" class="btn btn-success">Success</button>
<button type="button" class="btn btn-danger">Danger</button>
<button type="button" class="btn btn-warning">Warning</button>
<button type="button" class="btn btn-info">Info</button>
<button type="button" class="btn btn-light">Light</button>
<button type="button" class="btn btn-dark">Dark</button>
<button type="button" class="btn btn-link">Link</button>

<button type="button" class="btn btn-outline-primary">Outline</button>
<button type="button" class="btn btn-outline-secondary">Outline Secondary</button>

<button type="button" class="btn btn-primary btn-lg">Large</button>
<button type="button" class="btn btn-primary btn-sm">Small</button>

<button type="button" class="btn btn-primary" disabled>Disabled</button>
<a class="btn btn-primary disabled" role="button" aria-disabled="true">Disabled Link</a>

<button type="button" class="btn btn-primary" data-bs-toggle="button">Toggle</button>
```

Icon-only buttons need `aria-label` and a ≥24×24 px target (WCAG 2.2) — `btn-sm` icon clusters in toolbars are the common violation; pad rather than shrink.

### Button Group

```html
<div class="btn-group" role="group" aria-label="Basic example">
	<button type="button" class="btn btn-primary">Left</button>
	<button type="button" class="btn btn-primary">Middle</button>
	<button type="button" class="btn btn-primary">Right</button>
</div>

<div class="btn-toolbar" role="toolbar" aria-label="Toolbar">
	<div class="btn-group me-2" role="group">...</div>
	<div class="btn-group me-2" role="group">...</div>
</div>

<div class="btn-group-vertical">
	<button type="button" class="btn btn-primary">Top</button>
	<button type="button" class="btn btn-primary">Middle</button>
	<button type="button" class="btn btn-primary">Bottom</button>
</div>
```

### Card

```html
<div class="card">
	<div class="card-header">Header</div>
	<img src="..." class="card-img-top" alt="..." />
	<div class="card-body">
		<h5 class="card-title">Title</h5>
		<h6 class="card-subtitle mb-2 text-body-secondary">Subtitle</h6>
		<p class="card-text">Text content.</p>
		<a href="#" class="card-link">Link</a>
		<a href="#" class="btn btn-primary">Button</a>
	</div>
	<ul class="list-group list-group-flush">
		<li class="list-group-item">Item</li>
	</ul>
	<div class="card-footer text-body-secondary">Footer</div>
</div>

<div class="card text-bg-primary">Colored card</div>
<div class="card border-primary">Bordered card</div>
<div class="card-group">Card group</div>
<div class="row row-cols-1 row-cols-md-3 g-4">Card grid (with h-100 on cards)</div>
```

### Carousel

```html
<div id="carouselExample" class="carousel slide" data-bs-ride="carousel">
	<div class="carousel-indicators">
		<button
			type="button"
			data-bs-target="#carouselExample"
			data-bs-slide-to="0"
			class="active"
			aria-current="true"
		></button>
		<button type="button" data-bs-target="#carouselExample" data-bs-slide-to="1"></button>
	</div>
	<div class="carousel-inner">
		<div class="carousel-item active">
			<img src="..." class="d-block w-100" alt="..." />
			<div class="carousel-caption d-none d-md-block">
				<h5>Caption</h5>
				<p>Description</p>
			</div>
		</div>
		<div class="carousel-item">
			<img src="..." class="d-block w-100" alt="..." />
		</div>
	</div>
	<button
		class="carousel-control-prev"
		type="button"
		data-bs-target="#carouselExample"
		data-bs-slide="prev"
	>
		<span class="carousel-control-prev-icon" aria-hidden="true"></span>
		<span class="visually-hidden">Previous</span>
	</button>
	<button
		class="carousel-control-next"
		type="button"
		data-bs-target="#carouselExample"
		data-bs-slide="next"
	>
		<span class="carousel-control-next-icon" aria-hidden="true"></span>
		<span class="visually-hidden">Next</span>
	</button>
</div>
```

`.carousel-dark` is deprecated — use `data-bs-theme="dark"` on the carousel instead. Auto-advancing carousels rarely belong in product UI.

### Close Button

```html
<button type="button" class="btn-close" aria-label="Close"></button>
<button type="button" class="btn-close" disabled aria-label="Close"></button>

<!-- On dark surfaces: .btn-close-white is DEPRECATED — scope the theme instead -->
<button type="button" class="btn-close" data-bs-theme="dark" aria-label="Close"></button>
```

### Collapse

```html
<p>
	<button
		class="btn btn-primary"
		type="button"
		data-bs-toggle="collapse"
		data-bs-target="#collapseExample"
		aria-expanded="false"
		aria-controls="collapseExample"
	>
		Toggle
	</button>
</p>
<div class="collapse" id="collapseExample">
	<div class="card card-body">Content here.</div>
</div>
```

Multiple targets: give each panel `.multi-collapse` and point separate triggers at each id (or one trigger at a shared selector). The trigger button IS the disclosure pattern: `aria-expanded` + `aria-controls`, Enter/Space toggles — nothing more needed.

### Dropdown

```html
<div class="dropdown">
	<button
		class="btn btn-secondary dropdown-toggle"
		type="button"
		data-bs-toggle="dropdown"
		aria-expanded="false"
	>
		Dropdown button
	</button>
	<ul class="dropdown-menu">
		<li><a class="dropdown-item" href="#">Action</a></li>
		<li><a class="dropdown-item" href="#">Another action</a></li>
		<li><hr class="dropdown-divider" /></li>
		<li><a class="dropdown-item" href="#">Something else</a></li>
	</ul>
</div>

<!-- Directions: wrap in .btn-group with .dropup / .dropend / .dropstart -->

<ul class="dropdown-menu dropdown-menu-end">
	Right-aligned
</ul>
<ul class="dropdown-menu">
	<li><h6 class="dropdown-header">Header</h6></li>
	<li><span class="dropdown-item-text">Text</span></li>
	<li><a class="dropdown-item active" aria-current="true" href="#">Active</a></li>
	<li><a class="dropdown-item disabled" aria-disabled="true">Disabled</a></li>
</ul>

<div class="dropdown-menu p-4">
	<form>Form content</form>
</div>
```

`.dropdown-menu-dark` is deprecated — use `data-bs-theme="dark"` on the menu or an ancestor. Dropdowns have full keyboard support (arrows, Esc) built in. A dropdown is a **command menu** — for choosing a form value use `.form-select`, never a styled dropdown pretending to be an input.

### List Group

```html
<ul class="list-group">
	<li class="list-group-item">Item</li>
	<li class="list-group-item active" aria-current="true">Active</li>
	<li class="list-group-item disabled" aria-disabled="true">Disabled</li>
	<li class="list-group-item list-group-item-primary">Primary</li>
</ul>

<div class="list-group">
	<a href="#" class="list-group-item list-group-item-action active" aria-current="true">
		<div class="d-flex w-100 justify-content-between">
			<h5 class="mb-1">Heading</h5>
			<small>3 days ago</small>
		</div>
		<p class="mb-1">Content.</p>
		<small>Footer text.</small>
	</a>
</div>

<ul class="list-group list-group-horizontal">
	<li class="list-group-item">Horizontal</li>
</ul>
<ul class="list-group list-group-numbered">
	<li class="list-group-item">Numbered</li>
</ul>
<ul class="list-group list-group-flush">
	<li class="list-group-item">Flush (edge-to-edge)</li>
</ul>

<!-- Checkboxes / radios in a list group (core pattern — form-check inside items) -->
<ul class="list-group">
	<li class="list-group-item">
		<input class="form-check-input me-1" type="checkbox" id="lgCheck1" value="" />
		<label class="form-check-label" for="lgCheck1">First checkbox</label>
	</li>
	<li class="list-group-item">
		<input class="form-check-input me-1" type="radio" name="lgRadio" id="lgRadio1" value="" />
		<label class="form-check-label" for="lgRadio1">First radio</label>
	</li>
</ul>
```

(The `list-group-checkable` / `list-group-item-check` classes seen in Bootstrap's _examples gallery_ are custom CSS, not core — don't ship them without their styles.)

### Modal

```html
<div
	class="modal fade"
	id="exampleModal"
	tabindex="-1"
	aria-labelledby="exampleModalLabel"
	aria-hidden="true"
>
	<div class="modal-dialog">
		<div class="modal-content">
			<div class="modal-header">
				<h1 class="modal-title fs-5" id="exampleModalLabel">Title</h1>
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
			</div>
			<div class="modal-body">Body</div>
			<div class="modal-footer">
				<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
				<button type="button" class="btn btn-primary">Save changes</button>
			</div>
		</div>
	</div>
</div>

<div class="modal-dialog modal-dialog-scrollable">Scrollable body</div>
<div class="modal-dialog modal-dialog-centered">Centered vertically</div>
<div class="modal-dialog modal-sm">Small</div>
<div class="modal-dialog modal-lg">Large</div>
<div class="modal-dialog modal-xl">Extra large</div>
<div class="modal-dialog modal-fullscreen">Fullscreen</div>
<div class="modal-dialog modal-fullscreen-sm-down">Fullscreen below sm</div>

<div class="modal" data-bs-backdrop="static" data-bs-keyboard="false">
	Static backdrop (blocks click-outside / Esc dismiss)
</div>
```

Bootstrap's modal enforces focus, adds `role="dialog"`/`aria-modal="true"`, closes on Esc, and returns focus to the trigger. One modal at a time — nesting is unsupported; if a flow needs a second layer, redesign it. In SPAs, `dispose()` the instance on unmount ([bootstrap-reference.md](bootstrap-reference.md) → JavaScript lifecycle).

### Navbar

```html
<nav class="navbar navbar-expand-lg bg-body-tertiary">
	<div class="container-fluid">
		<a class="navbar-brand" href="#">Brand</a>
		<button
			class="navbar-toggler"
			type="button"
			data-bs-toggle="collapse"
			data-bs-target="#navbarNav"
			aria-controls="navbarNav"
			aria-expanded="false"
			aria-label="Toggle navigation"
		>
			<span class="navbar-toggler-icon"></span>
		</button>
		<div class="collapse navbar-collapse" id="navbarNav">
			<ul class="navbar-nav me-auto mb-2 mb-lg-0">
				<li class="nav-item">
					<a class="nav-link active" aria-current="page" href="#">Home</a>
				</li>
				<li class="nav-item"><a class="nav-link" href="#">Features</a></li>
				<li class="nav-item">
					<a class="nav-link disabled" aria-disabled="true">Disabled</a>
				</li>
			</ul>
			<form class="d-flex" role="search">
				<input class="form-control me-2" type="search" placeholder="Search" aria-label="Search" />
				<button class="btn btn-outline-success" type="submit">Search</button>
			</form>
		</div>
	</div>
</nav>

<nav class="navbar bg-body-tertiary fixed-top">Fixed top</nav>
<nav class="navbar bg-body-tertiary sticky-top">Sticky top</nav>

<!-- Dark navbar: .navbar-dark is DEPRECATED — scope the theme instead -->
<nav class="navbar bg-primary" data-bs-theme="dark">Dark-themed navbar</nav>
```

### Navs & Tabs

```html
<ul class="nav">
	<li class="nav-item"><a class="nav-link active" aria-current="page" href="#">Active</a></li>
	<li class="nav-item"><a class="nav-link" href="#">Link</a></li>
	<li class="nav-item"><a class="nav-link disabled" aria-disabled="true">Disabled</a></li>
</ul>

<ul class="nav nav-tabs">
	…
</ul>
<ul class="nav nav-pills">
	…
</ul>
<ul class="nav nav-underline">
	…
</ul>
<!-- 5.3: understated bottom-border variant -->
<ul class="nav nav-pills nav-fill">
	…
</ul>
<ul class="nav nav-pills nav-justified">
	…
</ul>
<nav class="nav nav-tabs flex-column flex-sm-row">Responsive nav</nav>
```

Real switchable tab panels (JS-driven — buttons, not scroll anchors):

```html
<ul class="nav nav-tabs" id="myTab" role="tablist">
	<li class="nav-item" role="presentation">
		<button
			class="nav-link active"
			id="home-tab"
			data-bs-toggle="tab"
			data-bs-target="#home-pane"
			type="button"
			role="tab"
			aria-controls="home-pane"
			aria-selected="true"
		>
			Home
		</button>
	</li>
	<li class="nav-item" role="presentation">
		<button
			class="nav-link"
			id="profile-tab"
			data-bs-toggle="tab"
			data-bs-target="#profile-pane"
			type="button"
			role="tab"
			aria-controls="profile-pane"
			aria-selected="false"
		>
			Profile
		</button>
	</li>
</ul>
<div class="tab-content">
	<div
		class="tab-pane fade show active"
		id="home-pane"
		role="tabpanel"
		aria-labelledby="home-tab"
		tabindex="0"
	>
		Home content
	</div>
	<div
		class="tab-pane fade"
		id="profile-pane"
		role="tabpanel"
		aria-labelledby="profile-tab"
		tabindex="0"
	>
		Profile content
	</div>
</div>
```

### Offcanvas

```html
<button
	class="btn btn-primary"
	type="button"
	data-bs-toggle="offcanvas"
	data-bs-target="#offcanvasExample"
>
	Launch
</button>

<div
	class="offcanvas offcanvas-start"
	tabindex="-1"
	id="offcanvasExample"
	aria-labelledby="offcanvasExampleLabel"
>
	<div class="offcanvas-header">
		<h5 class="offcanvas-title" id="offcanvasExampleLabel">Offcanvas</h5>
		<button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
	</div>
	<div class="offcanvas-body">Body content</div>
</div>

<div class="offcanvas offcanvas-top">Top</div>
<div class="offcanvas offcanvas-bottom">Bottom</div>
<div class="offcanvas offcanvas-start">Left/start</div>
<div class="offcanvas offcanvas-end">Right/end</div>

<div class="offcanvas offcanvas-start" data-bs-scroll="true" data-bs-backdrop="false">
	No backdrop, body still scrolls
</div>
```

**Responsive offcanvas** — the canonical sidebar-that-becomes-a-drawer: replace `.offcanvas` with `.offcanvas-{sm|md|lg|xl|xxl}`. Content renders **inline above** that breakpoint and as an **offcanvas below** it. Close buttons inside a responsive offcanvas need an explicit `data-bs-target`. Always set `aria-labelledby` (it's conceptually a dialog; `role="dialog"` is added by JS). Width/height via `--bs-offcanvas-width` (400px) / `--bs-offcanvas-height` (30vh). Full app-shell pattern: [bootstrap-reference.md](bootstrap-reference.md) → App shell.

### Pagination

```html
<nav aria-label="Search results pages">
	<ul class="pagination">
		<li class="page-item"><a class="page-link" href="#">Previous</a></li>
		<li class="page-item"><a class="page-link" href="#">1</a></li>
		<li class="page-item active" aria-current="page"><a class="page-link" href="#">2</a></li>
		<li class="page-item"><a class="page-link" href="#">3</a></li>
		<li class="page-item"><a class="page-link" href="#">Next</a></li>
	</ul>
</nav>

<ul class="pagination pagination-lg">
	Large
</ul>
<ul class="pagination pagination-sm">
	Small
</ul>
<ul class="pagination justify-content-center">
	Centered
</ul>
```

### Placeholder (skeletons)

```html
<p aria-hidden="true">
	<span class="placeholder col-6"></span>
	<span class="placeholder w-75"></span>
	<span class="placeholder" style="width: 25%;"></span>
</p>

<span class="placeholder col-12 placeholder-lg">Large</span>
<span class="placeholder col-12 placeholder-sm">Small</span>
<span class="placeholder col-12 placeholder-xs">Extra small</span>

<p class="placeholder-glow"><span class="placeholder col-12"></span></p>
<p class="placeholder-wave"><span class="placeholder col-12"></span></p>

<button class="btn btn-primary disabled placeholder col-4" aria-hidden="true"></button>
```

Always wrap skeletons in `aria-hidden="true"` — they are visual scaffolding, not content. Skeleton-vs-spinner decision rules: [bootstrap-reference.md](bootstrap-reference.md) → The five states.

### Popover (Requires Popper.js)

```html
<button
	type="button"
	class="btn btn-lg btn-danger"
	data-bs-toggle="popover"
	data-bs-title="Popover title"
	data-bs-content="And here's some amazing content."
>
	Click to toggle popover
</button>

<button
	type="button"
	class="btn btn-secondary"
	data-bs-container="body"
	data-bs-toggle="popover"
	data-bs-placement="top"
	data-bs-content="Top popover"
>
	Popover on top
</button>
```

Popovers are **opt-in**: they do nothing until initialized in JS (see [JavaScript initialization](#javascript-initialization)). Only attach them to focusable elements; wrap disabled elements in a `<span tabindex="0">`. `data-bs-html="true"` with untrusted content is an XSS vector.

### Progress

5.3 markup — `role="progressbar"` and the `aria-value*` attributes go on the **outer `.progress`**, not the inner bar:

```html
<div
	class="progress"
	role="progressbar"
	aria-label="Basic example"
	aria-valuenow="25"
	aria-valuemin="0"
	aria-valuemax="100"
>
	<div class="progress-bar" style="width: 25%">25%</div>
</div>

<div
	class="progress"
	role="progressbar"
	aria-label="Success"
	aria-valuenow="25"
	aria-valuemin="0"
	aria-valuemax="100"
>
	<div class="progress-bar bg-success" style="width: 25%"></div>
</div>

<div
	class="progress"
	role="progressbar"
	aria-label="Striped"
	aria-valuenow="10"
	aria-valuemin="0"
	aria-valuemax="100"
>
	<div class="progress-bar progress-bar-striped" style="width: 10%"></div>
</div>

<div
	class="progress"
	role="progressbar"
	aria-label="Animated"
	aria-valuenow="75"
	aria-valuemin="0"
	aria-valuemax="100"
>
	<div class="progress-bar progress-bar-striped progress-bar-animated" style="width: 75%"></div>
</div>

<div class="progress-stacked">
	<div
		class="progress"
		role="progressbar"
		aria-label="Segment one"
		aria-valuenow="30"
		aria-valuemin="0"
		aria-valuemax="100"
		style="width: 30%"
	>
		<div class="progress-bar"></div>
	</div>
	<div
		class="progress"
		role="progressbar"
		aria-label="Segment two"
		aria-valuenow="20"
		aria-valuemin="0"
		aria-valuemax="100"
		style="width: 20%"
	>
		<div class="progress-bar bg-success"></div>
	</div>
</div>
```

### Scrollspy

```html
<nav id="navbar-example2" class="navbar bg-body-tertiary px-3 mb-3">
	<a class="navbar-brand" href="#">Navbar</a>
	<ul class="nav nav-pills">
		<li class="nav-item">
			<a class="nav-link" href="#scrollspyHeading1">First</a>
		</li>
		<li class="nav-item">
			<a class="nav-link" href="#scrollspyHeading2">Second</a>
		</li>
	</ul>
</nav>
<div
	data-bs-spy="scroll"
	data-bs-target="#navbar-example2"
	data-bs-root-margin="0px 0px -40%"
	data-bs-threshold="0.1"
	tabindex="0"
>
	<h4 id="scrollspyHeading1">First heading</h4>
	<p>Content...</p>
	<h4 id="scrollspyHeading2">Second heading</h4>
	<p>Content...</p>
</div>
```

Gotcha: the spied element must be a scroll container (height/overflow, or focusable via `tabindex="0"`), and heading IDs must match the nav `href`s exactly. Scrollspy highlights position in one long page — it is not a substitute for real tabs.

### Spinners

```html
<div class="spinner-border text-primary" role="status">
	<span class="visually-hidden">Loading...</span>
</div>

<div class="spinner-grow text-primary" role="status">
	<span class="visually-hidden">Loading...</span>
</div>

<div class="spinner-border spinner-border-sm" role="status"></div>
<div class="spinner-grow spinner-grow-sm" role="status"></div>

<button class="btn btn-primary" type="button" disabled>
	<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
	<span role="status">Loading...</span>
</button>
```

### Tables

```html
<table class="table">
	<caption class="visually-hidden">
		Monthly invoices with status and totals
	</caption>
	<thead>
		<tr>
			<th scope="col">Invoice</th>
			<th scope="col">Status</th>
			<th scope="col" class="text-end">Amount</th>
		</tr>
	</thead>
	<tbody>
		<tr>
			<th scope="row">INV-1042</th>
			<td><span class="badge text-bg-success">Paid</span></td>
			<td class="text-end">$1,280.00</td>
		</tr>
	</tbody>
</table>
```

Modifiers (combine freely):

```css
.table-sm                 /* half padding — dense screens */
.table-striped, .table-striped-columns
.table-hover              /* row highlight — scanning aid */
.table-bordered, .table-borderless
.table-active             /* highlight a row/cell */
.table-group-divider      /* thicker rule between <tbody> groups */
.caption-top              /* caption above the table */
.table-primary … .table-dark   /* variants, on table/tr/td */
.align-middle             /* vertical alignment, on table/tr/td */
```

- **Responsive:** wrap in `.table-responsive{-sm|-md|-lg|-xl|-xxl}` for horizontal scroll. Caveat: the wrapper clips overflowing content — dropdown menus inside a responsive table get cut off.
- **Dark tables:** `data-bs-theme="dark"` on the `<table>` (the `.table-dark` variant approach is superseded).
- **Theming:** variants set CSS variables, not fixed colors — `--bs-table-bg`, `--bs-table-color`, `--bs-table-striped-bg`, `--bs-table-hover-bg`, `--bs-table-active-bg`, `--bs-table-border-color`. `--bs-table-bg` is transparent by default so striping/hover layer through.
- **Sticky headers are NOT built in.** Bootstrap ships no sticky-header feature; the pattern needs a few lines of custom CSS. That, plus selection columns, `aria-sort` sorting, bulk-action bars, and responsive strategies: [bootstrap-reference.md](bootstrap-reference.md) → Dense data tables.

### Toasts

```html
<div class="toast" role="status" aria-live="polite" aria-atomic="true">
	<div class="toast-header">
		<strong class="me-auto">Deployment</strong>
		<small>11 mins ago</small>
		<button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
	</div>
	<div class="toast-body">Changes published.</div>
</div>

<div class="toast align-items-center text-bg-primary border-0" role="status" aria-live="polite">
	<div class="d-flex">
		<div class="toast-body">Color variant</div>
		<button
			type="button"
			class="btn-close me-2 m-auto"
			data-bs-theme="dark"
			data-bs-dismiss="toast"
			aria-label="Close"
		></button>
	</div>
</div>

<!-- One fixed container stacks all toasts (flex column) -->
<div class="toast-container position-fixed top-0 end-0 p-3">
	<div class="toast" role="status" aria-live="polite" aria-atomic="true">…</div>
	<div class="toast" role="status" aria-live="polite" aria-atomic="true">…</div>
</div>
```

Toasts are **opt-in** — hidden until `.show()` is called (or shown via a trigger). Keep the container in the DOM before showing so the live region announces. Use `role="status"`/`aria-live="polite"` for confirmations; reserve `role="alert"`/`assertive` for urgent messages. Errors requiring action are never toasts — see [bootstrap-reference.md](bootstrap-reference.md) → Feedback discipline.

### Tooltip (Requires Popper.js)

```html
<button
	type="button"
	class="btn btn-secondary"
	data-bs-toggle="tooltip"
	data-bs-placement="top"
	data-bs-title="Tooltip on top"
>
	Tooltip on top
</button>
<!-- data-bs-placement: top | right | bottom | left (auto-flipped in RTL) -->

<button
	type="button"
	class="btn btn-secondary"
	data-bs-toggle="tooltip"
	data-bs-html="true"
	data-bs-title="<em>Tooltip</em> <u>with</u> <b>HTML</b>"
>
	Tooltip with HTML
</button>
```

Tooltips are **opt-in** (JS init required, below). Only attach to focusable elements so keyboard users can trigger them; never put essential information _only_ in a tooltip, and never report form errors via tooltip. `data-bs-html` with untrusted content is an XSS vector.

## JavaScript Initialization

Data-attribute components (modal, collapse, dropdown, offcanvas, tab, alert dismiss) work from markup alone. **Tooltips and popovers do not** — they must be constructed; **toasts** stay hidden until shown:

```js
// Required for every tooltip/popover on the page
const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
const tooltipList = [...tooltipTriggerList].map((el) => new bootstrap.Tooltip(el))

const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]')
const popoverList = [...popoverTriggerList].map((el) => new bootstrap.Popover(el))

// Programmatic control — prefer getOrCreateInstance over `new` when the
// element may already be initialized (e.g. by a data attribute)
const myModal = bootstrap.Modal.getOrCreateInstance('#myModal')
myModal.show()

const myToast = bootstrap.Toast.getOrCreateInstance('#myToast')
myToast.show()
```

Constructors accept elements or CSS selector strings. Full lifecycle — `getInstance`, `dispose()` on unmount, event pairs (`show.bs.*` / `shown.bs.*`), async behavior, and why SPAs should prefer framework wrappers: [bootstrap-reference.md](bootstrap-reference.md) → JavaScript lifecycle.

## Icons

Bootstrap's core CSS ships **no icons**. The `.bi` SVGs in examples come from the companion [Bootstrap Icons](https://icons.getbootstrap.com/) library (`bootstrap-icons` package) — a separate install, used as inline SVG / SVG sprite (preferred) or icon font (`<i class="bi bi-check"></i>`). Decorative icons get `aria-hidden="true"`; meaningful icons get `role="img"` + `aria-label`. Pairs with the `.icon-link` helper ([utilities.md](utilities.md) → Helpers).

### Status glyph marks

The textless mark that survives both themes — dots, ticks, rings, pulses — is a glyph, not a badge ([Badge](#badge)). Inline SVG or icon font, the composition rules are the same:

```html
<span
	class="bi bi-circle-fill fs-6 lh-1 text-success-emphasis"
	role="img"
	aria-label="Healthy"
></span>
<span class="bi bi-circle fs-6 lh-1 text-body-secondary" role="img" aria-label="Not started"></span>
```

- **Color from the emphasis tokens.** `text-*-emphasis` is the mode-adaptive tier built for marks on subtle surfaces; the plain `text-*` colors are tuned for light and thin out in dark. Measure every mark at **≥ 3:1** against the surface it sits on, **in both themes**, against the compiled cascade — a skin's token values are its own.
- **Filled and hollow say different things** — done vs pending, live vs idle — so pair glyphs that share one advance width (a filled/hollow pair from the same icon family). Mixed widths make a column of marks jitter row to row.
- **Size with `fs-*` _and_ `lh-1`.** A glyph inherits the row's line-height, so an `fs-*` bump without `lh-1` grows the line box and pushes the row taller than its neighbors.
- Give the mark an accessible name (`role="img"` + `aria-label`, or a `.visually-hidden` word next to an `aria-hidden` glyph) — a mark whose only meaning is its color and shape is color-only status.

## Enterprise notes (components)

### Choosing components

| Need                                           | Prefer                                                                     | Avoid                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| Primary page actions                           | `btn` / `btn-group` / `btn-toolbar`                                        | Random links styled as buttons inconsistently  |
| Full-width stacks (sidebars, empty-state CTAs) | `d-grid gap-2` + `btn`                                                     | Absolute positioning                           |
| Switching in-page views                        | `nav-tabs` / `nav-pills` / `nav-underline` + tab panes or equivalent state | Anchor links that only scroll a long page      |
| App sidebar navigation                         | Responsive `offcanvas-{bp}` + `nav`                                        | Hand-rolled drawer JS                          |
| Structured groups                              | `card` with `card-header` / `card-body` / `card-footer`                    | Ad-hoc bordered `div`s with mismatched padding |
| Ordered instructions / schemas                 | `list-group` / `list-group-numbered`                                       | Unstyled paragraphs pretending to be steps     |
| Long documentation in-product                  | `accordion` or scrollable `modal`                                          | One infinite tinted card stack                 |
| Dense data                                     | `table` + `table-responsive` (+ `table-sm` when appropriate)               | Non-semantic grids of text                     |
| Choosing a form value                          | `form-select` (or native input)                                            | A `dropdown` menu posing as an input           |
| Confirmations / focused tasks                  | `modal` with header, body, footer actions                                  | Nested modals                                  |
| Secondary filters on small screens             | `offcanvas`                                                                | Permanent wide sidebars that crush content     |
| Transient success feedback                     | `toast`                                                                    | `alert()`; toasts for errors                   |
| Loading a known layout                         | `placeholder` skeleton                                                     | Layout-collapsing centered spinner             |

### Forms

- Prefer visible labels or `.form-floating` — placeholder-only labels fail accessibility and disappear on input.
- Pair help and errors with `aria-describedby`; use `.invalid-feedback` with `.is-invalid` and mark the field `aria-invalid="true"`.
- Money/units: `.input-group` + `.input-group-text`; add `.has-validation` on groups with validation feedback.
- Show progress with `spinner-border spinner-border-sm` inside the submit button while waiting; keep submit enabled and validate on submit rather than disabling it ([bootstrap-reference.md](bootstrap-reference.md) → Forms in production).

### Selection fills

A selected row, pill, or filter chip repaints everything inside it — marks included. Two traps, both invisible until the selected state is captured in both themes:

- **A mark on an active fill of the same family disappears.** `.active` on a `list-group-item`, `nav-pill`, or `page-item` sets the item's own color, and a `text-bg-primary`-family mark inside it inherits or loses to that fill — the mark is there in the markup and gone on screen. `text-body-emphasis` (or an outline glyph that keeps its own token) survives the fill; verify by capturing the selected row, not by reading the class list.
- **`btn-check` filter labels invert in dark.** A `btn-outline-secondary` label reads as "chosen" in light and as "muted" in dark, because the checked fill and the surface swap relative weight. Give chosen filters an accent variant (a real theme color) rather than the neutral outline, so "chosen" reads the same way in both modes.

Exactly one item in a selection carries `aria-current` — the visual fill and the announced state must be the same item.

### Navigation & overlays

- Active nav items need `aria-current="page"` (or `aria-selected="true"` for tabs).
- Modals and offcanvas: set `aria-labelledby`; Bootstrap traps focus and restores it on close — don't fight it; `dispose()` instances when the host unmounts in SPAs.
- Icon-only controls always need an accessible name (`aria-label` or visually-hidden text) and a ≥24px target.

### Theming

- Components consume CSS variables — favor `text-bg-*`, `*-subtle`, and `data-bs-theme` over one-off colors; the deprecated `*-dark` component variants (`navbar-dark`, `dropdown-menu-dark`, `btn-close-white`, `carousel-dark`) all map to `data-bs-theme="dark"`.
- To restyle a component, override its `--bs-{component}-*` variables in your own scope instead of writing high-specificity rules — see [bootstrap-reference.md](bootstrap-reference.md) → Theming & design tokens.
