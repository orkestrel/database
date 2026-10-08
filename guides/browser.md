# Browser

> The browser runtime for the `@orkestrel` line: a `Browser` that finds, launches, or attaches
> to Chromium; its contexts and pages; the elements and readings a page yields; and the toolset
> and journeys that hand a page to an agent.

A browser finds, launches, or attaches to Chromium and owns the connection through which its contexts run.

A context groups pages, cookies, permissions, storage, and emulation, and can isolate a task from other contexts.

A page drives one tab with trusted input and yields its frames, elements, and captured readings.

An element gives a stable reference to an actionable node and reports why an action cannot proceed.

A reading holds one captured document and projects bounded Markdown or text from that capture.

A toolset publishes a view as agent tools, adopts the page's own tools, and produces receipts for actions.

A journey keeps a sequence of intents that a recorder captures, a store persists, and a replay executes or a compiler turns into a module.

The core, `@orkestrel/browser`, supplies the contexts, pages, readings, toolset, journeys, and injected CDP client without Node or DOM dependencies. The server face, `@orkestrel/browser/server`, supplies the browser runtime, filesystem stores, and MCP server. The browser face, `@orkestrel/browser/browser`, supplies a DOM view and a WebSocket transport. Both host faces depend on the core and neither imports the other. The `browse` binary starts the MCP server from environment options.

Source: [core](../src/core), [server](../src/server), [browser](../src/browser), and [binary](../src/bin).

## Surface

`BrowserPage`, `BrowserFrame`, `BrowserPageElement`, `BrowserElementManager`, `BrowserDOMElement`, `BrowserDOMElementManager`, and `BrowserJourneyToolset` are internal classes: their owners construct them and return their public interfaces. `BrowserDialog`, `BrowserDownload`, `BrowserWebSocket`, `BrowserCodegen`, `BrowserRouteManager`, `BrowserFileChooser`, `BrowserHandle`, `BrowserHold`, `BrowserNavigationRecord`, `BrowserRegistry`, `BrowserRoute`, `BrowserWorker`, and `FileBrowserStore` are internal for the same reason. Construct a context with `createBrowserContext`, obtain pages from its owner, and construct a toolset with `createBrowserToolset` over either a page or a DOM view. A caller owns that view; destroying the toolset releases its registrations and observers.

The owners also construct `BrowserClock`, `BrowserCookieManager`, `BrowserEmulationManager`, `BrowserHARManager`, `BrowserNetworkManager`, `BrowserKeyboard`, `BrowserMouse`, `BrowserTouch`, `BrowserNavigationManager`, `BrowserPermissionManager`, `BrowserScriptManager`, `BrowserStorageManager`, `BrowserTracing`, `BrowserCoverage`, `BrowserPerformance`, `BrowserProfiler`, `BrowserDiagnostics`, and `BrowserAccessibility`. These classes are internal; the page or context exposes their public interfaces.

### Connect to a browser and drive a page

The following fence connects to a running browser or launches one, opens a page, and clicks an element the page's element manager finds.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ headless: true })
await browser.connect() // CDP endpoint discovery → connect, else launch
const page = await browser.create({ url: 'https://example.com' })
await (await page.elements.find({ css: '#accept' }))[0]?.click()
const shot = await page.screenshot({ path: './out.png' })
await browser.destroy()
```

### Drive a page with a small model

The following fence registers the browser vocabulary in a tool manager, seeds the first message with numbered lines from `read({ from: 1 })`, and hands that manager to an `@orkestrel/agent` loop over a local model. The guide proof executes the toolset setup and seed; it doesn't run the model.

```ts
import { createAgent } from '@orkestrel/agent'
import { createBrowserToolset } from '@orkestrel/browser'
import { createBrowser } from '@orkestrel/browser/server'
import { createOllama } from '@orkestrel/ollama'
import { createToolManager } from '@orkestrel/tool'

const system =
	'You control a web browser with tools and must call a tool before you answer. ' +
	'The first message shows numbered page lines; references such as e4 name its elements. ' +
	'To learn a fact, call read with from 1 and search words from your question; follow a footer by calling read with its from line. ' +
	"To use the site's search box, call type with its reference, the words, and submit true. " +
	'To press a button or follow a link, call click with its reference from the latest result. Never invent a reference. ' +
	'If text you expect has not appeared, call wait once. ' +
	'When the task is done, answer in one short sentence.'

const browser = createBrowser({ headless: true })
await browser.connect()
const page = await browser.create({ url: 'https://shop.example.test/' })
const toolset = createBrowserToolset(page, { tools: createToolManager() })
await toolset.start()
toolset.tools.tools().map((tool) => tool.name) // ['read', 'click', 'type', 'press', 'navigate', 'wait']
const seeded = await toolset.tools.execute({
	id: 'seed',
	name: 'read',
	arguments: { from: 1 },
})
const view = seeded.success ? String(seeded.value) : seeded.error
const agent = createAgent(createOllama({ model: 'qwen3.5:2b-q4_K_M' }), {
	system,
	tools: toolset.tools,
})
agent.context.messages.add({
	role: 'user',
	content: `What does the Alpine Kettle cost?\n\nThe browser's first read of the page:\n${view}`,
})
const result = await agent.generate()
await toolset.destroy()
await browser.destroy()
```

### Core

The core supplies the entities a browser session and an agent use. Its host-specific dependencies enter through the transport, writer, tool source, and store interfaces.

#### Context and page

| API                                 | Kind      | Summary                                                                                                                                                                             |
| ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserContext`                    | class     | Owns pages and shared state inside one Chromium browser context.                                                                                                                    |
| `BrowserTransition`                 | class     | Runs one asynchronous transition at a time, shared by every caller that joins it.                                                                                                   |
| `createBrowserContext`              | function  | Creates a wrapper over an existing browser context on a CDP client.                                                                                                                 |
| `BrowserBindingCall`                | interface | Describes a decoded page-to-host binding call.                                                                                                                                      |
| `BrowserCaptureResult`              | interface | Carries a receipt's capture or the bounded reason no capture was available.                                                                                                         |
| `BrowserChord`                      | interface | Describes a parsed keyboard chord.                                                                                                                                                  |
| `BrowserClockInterface`             | interface | Controls Chromium virtual time for deterministic page timers.                                                                                                                       |
| `BrowserConsoleMessage`             | interface | Represents one console API call.                                                                                                                                                    |
| `BrowserContextInterface`           | interface | Represents an isolated browser session over a CDP browser context.                                                                                                                  |
| `BrowserCookie`                     | interface | Represents one cookie returned from a browser context.                                                                                                                              |
| `BrowserCookieFilter`               | interface | Describes narrowing criteria for removing context cookies.                                                                                                                          |
| `BrowserCookieInput`                | interface | Describes the input used to create or replace a browser cookie.                                                                                                                     |
| `BrowserCookieManagerInterface`     | interface | Provides cookie operations scoped to one browser context.                                                                                                                           |
| `BrowserCookiePartition`            | interface | Describes a cookie partition key used by CHIPS-partitioned cookies.                                                                                                                 |
| `BrowserCoverageInterface`          | interface | Drives the coverage capture lifecycle.                                                                                                                                              |
| `BrowserCoverageRange`              | interface | Describes a source range reported by JavaScript or CSS coverage.                                                                                                                    |
| `BrowserCoverageResult`             | interface | Describes combined JavaScript and CSS usage.                                                                                                                                        |
| `BrowserCredentials`                | interface | Describes the HTTP basic-auth credentials applied to context pages.                                                                                                                 |
| `BrowserDestination`                | interface | Pairs a document that recorded a surviving submission with the submission's destination.                                                                                            |
| `BrowserDiagnosticsInterface`       | interface | Groups the diagnostics by capability.                                                                                                                                               |
| `BrowserDialogInterface`            | interface | Represents one active JavaScript dialog.                                                                                                                                            |
| `BrowserDocument`                   | interface | Represents one document captured in a CDP DOM snapshot.                                                                                                                             |
| `BrowserDownloadInterface`          | interface | Represents one context download tracked through Chromium's Browser domain.                                                                                                          |
| `BrowserDownloadProgress`           | interface | Describes a protocol-neutral download progress update.                                                                                                                              |
| `BrowserDownloadStart`              | interface | Describes a decoded `Browser.downloadWillBegin` event.                                                                                                                              |
| `BrowserEmulationManagerInterface`  | interface | Configures context-scoped emulation.                                                                                                                                                |
| `BrowserFileChooserInterface`       | interface | Represents one intercepted file chooser.                                                                                                                                            |
| `BrowserFrameInfo`                  | interface | Describes serializable frame metadata decoded from CDP `Page.getFrameTree`.                                                                                                         |
| `BrowserFrameInterface`             | interface | Provides the operations shared by a top-level page and an iframe document.                                                                                                          |
| `BrowserFunctionCoverage`           | interface | Describes function coverage inside one script.                                                                                                                                      |
| `BrowserGeolocation`                | interface | Describes a geographic location override.                                                                                                                                           |
| `BrowserHandleInterface`            | interface | Represents a remote JavaScript object retained in one frame execution context.                                                                                                      |
| `BrowserHAR`                        | interface | Describes the standards-shaped HAR 1.2 document produced by the network manager.                                                                                                    |
| `BrowserHARContent`                 | interface | Describes response body metadata in an HTTP archive.                                                                                                                                |
| `BrowserHARCookie`                  | interface | Represents one cookie in an HTTP archive.                                                                                                                                           |
| `BrowserHARCreator`                 | interface | Describes the tool identity embedded in an HTTP archive.                                                                                                                            |
| `BrowserHAREntry`                   | interface | Represents one completed HTTP exchange in a HAR recording.                                                                                                                          |
| `BrowserHARLog`                     | interface | Describes the HAR 1.2 log object.                                                                                                                                                   |
| `BrowserHARManagerInterface`        | interface | Provides HAR recording and replay operations.                                                                                                                                       |
| `BrowserHARPost`                    | interface | Describes request body metadata in an HTTP archive.                                                                                                                                 |
| `BrowserHARRequest`                 | interface | Describes a HAR 1.2 request entry.                                                                                                                                                  |
| `BrowserHARResponse`                | interface | Describes a HAR 1.2 response entry.                                                                                                                                                 |
| `BrowserHARTimings`                 | interface | Holds HAR 1.2 phase timings in milliseconds.                                                                                                                                        |
| `BrowserHARValue`                   | interface | Represents one name/value pair in an HTTP archive.                                                                                                                                  |
| `BrowserKey`                        | interface | Describes normalized CDP keyboard key data.                                                                                                                                         |
| `BrowserKeyboardInterface`          | interface | Provides keyboard input operations bound to one frame target session.                                                                                                               |
| `BrowserLayout`                     | interface | Describes layout data associated with one captured DOM node.                                                                                                                        |
| `BrowserMargin`                     | interface | Describes the paper margin lengths accepted by Chromium print-to-PDF.                                                                                                               |
| `BrowserMedia`                      | interface | Describes browser color and media feature overrides.                                                                                                                                |
| `BrowserMetric`                     | interface | Represents one Performance-domain metric.                                                                                                                                           |
| `BrowserMouseInterface`             | interface | Provides mouse input operations bound to one frame target session.                                                                                                                  |
| `BrowserNavigationManagerInterface` | interface | Provides URL and network-idle waits associated with one page.                                                                                                                       |
| `BrowserNavigationRecordInterface`  | interface | Settles the navigation an input into one frame started, from the steps the page accepted after the record opened.                                                                   |
| `BrowserNavigationResult`           | interface | Describes the outcome of a top-level navigation command.                                                                                                                            |
| `BrowserNetworkManagerInterface`    | interface | Provides page-scoped network observation and interception.                                                                                                                          |
| `BrowserPageError`                  | interface | Represents one uncaught page exception.                                                                                                                                             |
| `BrowserPageInterface`              | interface | Abstracts a single top-level browser page, extending `BrowserFrameInterface` with navigation, screenshots, frame discovery, DOM snapshots, a journey recorder, and target teardown. |
| `BrowserPassage`                    | interface | Describes the projection and context of one bounded reading window.                                                                                                                 |
| `BrowserPDFResult`                  | interface | Describes the result of printing a page to PDF.                                                                                                                                     |
| `BrowserPerformanceInterface`       | interface | Reads Performance-domain metrics.                                                                                                                                                   |
| `BrowserPermissionManagerInterface` | interface | Provides permission override operations scoped to one browser context.                                                                                                              |
| `BrowserPopupManagerInterface`      | interface | Opens the records that settle the popups an input into a page opens.                                                                                                                |
| `BrowserPopupRecordInterface`       | interface | Settles the popups an input opened, from the `Page.windowOpen` reports the page's own session sends after the record opened.                                                        |
| `BrowserProfile`                    | interface | Describes a sampled CPU profile.                                                                                                                                                    |
| `BrowserProfileFrame`               | interface | Describes a JavaScript call frame from a CPU profile.                                                                                                                               |
| `BrowserProfileNode`                | interface | Represents one node in a sampled CPU profile.                                                                                                                                       |
| `BrowserProfilerInterface`          | interface | Drives the sampled CPU profile lifecycle.                                                                                                                                           |
| `BrowserProxy`                      | interface | Describes proxy settings used when creating an isolated browser context.                                                                                                            |
| `BrowserQuad`                       | interface | Describes a decoded content quad and its actionable center.                                                                                                                         |
| `BrowserReceipt`                    | interface | Describes one tool receipt before rendering.                                                                                                                                        |
| `BrowserRequest`                    | interface | Represents one observed browser request.                                                                                                                                            |
| `BrowserRequestFailure`             | interface | Represents one failed browser request.                                                                                                                                              |
| `BrowserResponse`                   | interface | Represents one observed browser response.                                                                                                                                           |
| `BrowserRouteDefinition`            | interface | Represents one installed network route.                                                                                                                                             |
| `BrowserRouteInterface`             | interface | Represents one paused Fetch-domain request.                                                                                                                                         |
| `BrowserRouteManagerInterface`      | interface | Manages the request handlers installed on a page network.                                                                                                                           |
| `BrowserRouteQuery`                 | interface | Describes route matching criteria. Omitted fields match all values.                                                                                                                 |
| `BrowserScreenshotResult`           | interface | Describes the result of a page screenshot.                                                                                                                                          |
| `BrowserScriptCoverage`             | interface | Describes JavaScript script coverage.                                                                                                                                               |
| `BrowserScriptManagerInterface`     | interface | Manages initialization scripts and host bindings for one page.                                                                                                                      |
| `BrowserSecurity`                   | interface | Describes the TLS details supplied with a browser response.                                                                                                                         |
| `BrowserSettlementResult`           | interface | Describes the navigation a record settled.                                                                                                                                          |
| `BrowserStackFrame`                 | interface | Represents one browser-side stack frame.                                                                                                                                            |
| `BrowserStorageEntry`               | interface | Represents one key/value pair from web storage.                                                                                                                                     |
| `BrowserStorageManagerInterface`    | interface | Provides storage-state import, export, and clearing operations.                                                                                                                     |
| `BrowserStorageOrigin`              | interface | Describes an origin-scoped local and session storage snapshot.                                                                                                                      |
| `BrowserStorageState`               | interface | Describes a portable browser authentication and storage snapshot.                                                                                                                   |
| `BrowserStyleCoverage`              | interface | Describes CSS stylesheet coverage.                                                                                                                                                  |
| `BrowserTab`                        | interface | Describes one open tab of a toolset's context, which the `read` header lists.                                                                                                       |
| `BrowserTiming`                     | interface | Holds network timing values in milliseconds relative to request time.                                                                                                               |
| `BrowserTimingRange`                | interface | Describes the start/end pair for one network timing phase.                                                                                                                          |
| `BrowserTouchInterface`             | interface | Provides touch input operations bound to one frame target session.                                                                                                                  |
| `BrowserTracingInterface`           | interface | Drives the trace capture lifecycle.                                                                                                                                                 |
| `BrowserTracingResult`              | interface | Describes the result of a trace capture.                                                                                                                                            |
| `BrowserTransitionInterface`        | interface | Represents one asynchronous transition shared by every caller that arrives while it runs.                                                                                           |
| `BrowserUserAgent`                  | interface | Describes user-agent metadata accepted by Chromium emulation.                                                                                                                       |
| `BrowserViewInterface`              | interface | Provides the document operations shared by remote and DOM-native views.                                                                                                             |
| `BrowserViewport`                   | interface | Describes the viewport dimensions for a browser page.                                                                                                                               |
| `BrowserWorkerInterface`            | interface | Represents a script worker attached to a page target.                                                                                                                               |
| `BrowserWriterInterface`            | interface | Provides a pluggable sink for persisting captured browser bytes to a path.                                                                                                          |
| `BrowserCallOptions`                | interface | Describes the options every asynchronous page, frame, handle, and worker call accepts.                                                                                              |
| `BrowserClickOptions`               | interface | Describes the options for a trusted mouse click.                                                                                                                                    |
| `BrowserContextOptions`             | interface | Configures a wrapper around an existing browser context.                                                                                                                            |
| `BrowserCoverageOptions`            | interface | Describes the options for a coverage capture.                                                                                                                                       |
| `BrowserDownloadOptions`            | interface | Describes the download policy for a browser context.                                                                                                                                |
| `BrowserDragOptions`                | interface | Describes the options for a trusted mouse drag.                                                                                                                                     |
| `BrowserEmulationOptions`           | interface | Describes network and rendering overrides inherited by context pages.                                                                                                               |
| `BrowserFollowOptions`              | interface | Configures one step a toolset follows.                                                                                                                                              |
| `BrowserHAROptions`                 | interface | Describes the options for a HAR recording.                                                                                                                                          |
| `BrowserInputOptions`               | interface | Describes the options shared by every trusted input operation.                                                                                                                      |
| `BrowserIsolateOptions`             | interface | Configures a new isolated browser context.                                                                                                                                          |
| `BrowserNavigationOptions`          | interface | Describes the options for page navigation.                                                                                                                                          |
| `BrowserNetworkOptions`             | interface | Configures the supplied network overrides without changing omitted keys.                                                                                                            |
| `BrowserOperationOptions`           | type      | Collects every option a trusted-input operation can carry.                                                                                                                          |
| `BrowserPageOptions`                | interface | Describes the options for creating a page through its context.                                                                                                                      |
| `BrowserPDFOptions`                 | interface | Describes the options for printing a Chromium page to PDF.                                                                                                                          |
| `BrowserRouteContinueOptions`       | interface | Describes the overrides supplied when continuing an intercepted request.                                                                                                            |
| `BrowserRouteFulfillOptions`        | interface | Describes the synthetic response supplied when fulfilling an intercepted request.                                                                                                   |
| `BrowserScreenshotOptions`          | interface | Describes the options for taking a page screenshot.                                                                                                                                 |
| `BrowserSettlementOptions`          | interface | Configures a record's settlement.                                                                                                                                                   |
| `BrowserStorageOptions`             | interface | Describes the options for collecting storage state from selected origins.                                                                                                           |
| `BrowserTracingOptions`             | interface | Describes the options for a Chromium trace capture.                                                                                                                                 |
| `BrowserTraversalOptions`           | interface | Describes the options for traversing a browser snapshot.                                                                                                                            |
| `BrowserWaitOptions`                | interface | Configures a text or element wait, including whether absence satisfies it.                                                                                                          |
| `validateBrowserContextOptions`     | function  | Validates isolated-context options before creating remote state.                                                                                                                    |
| `validateBrowserEmulationOptions`   | function  | Validates context emulation boundaries before partial application.                                                                                                                  |
| `validateBrowserInputOptions`       | function  | Validates the bounded delay, count, and steps of one trusted-input operation.                                                                                                       |
| `BrowserBindingHandler`             | type      | Runs a host function exposed into page JavaScript.                                                                                                                                  |
| `BrowserContextDisposal`            | type      | Records Chromium's disposal acknowledgement or the failure that left disposal unconfirmed.                                                                                          |
| `BrowserContextEventMap`            | type      | Maps the browser-context lifecycle events.                                                                                                                                          |
| `BrowserDestinationRelationship`    | type      | Names the frame a submission targets relative to the frame whose document submitted, mirroring the HTML `_self`, `_parent`, and `_top` keywords.                                    |
| `BrowserDialogCategory`             | type      | Names a JavaScript dialog category reported by Chromium.                                                                                                                            |
| `BrowserDownloadEventMap`           | type      | Maps the download progress events.                                                                                                                                                  |
| `BrowserDownloadStatus`             | type      | Names a download lifecycle phase.                                                                                                                                                   |
| `BrowserEpochFunction`              | type      | Reads the navigation epoch of the frame a reading was captured from.                                                                                                                |
| `BrowserMouseButton`                | type      | Names a mouse button understood by Chromium's Input domain.                                                                                                                         |
| `BrowserNavigationCondition`        | type      | Names the page load condition for navigation — the CDP load event awaited by `navigate()`.                                                                                          |
| `BrowserNavigationEventMap`         | type      | Maps the navigation steps a page accepts from the session that owns each frame, which it hands to its navigation and element managers.                                              |
| `BrowserNavigationReason`           | type      | Names why a frame requested a navigation, mirroring the CDP `Page.ClientNavigationReason` values that `Page.frameRequestedNavigation` carries as of Chromium 141.                   |
| `BrowserNavigationStage`            | type      | Names how far a settled navigation got: requested, committed, or loaded.                                                                                                            |
| `BrowserNetworkEventMap`            | type      | Maps the network events a page's network manager emits.                                                                                                                             |
| `BrowserPageEventMap`               | type      | Maps the typed page, frame, target, and user-visible browser events.                                                                                                                |
| `BrowserPagesFunction`              | type      | Returns the context's live pages at call time.                                                                                                                                      |
| `BrowserRouteHandler`               | type      | Runs for a matching intercepted request.                                                                                                                                            |
| `BrowserSameSite`                   | type      | Names a cookie same-site policy understood by Chromium.                                                                                                                             |
| `BrowserScreenshotScale`            | type      | Names a screenshot coordinate scale.                                                                                                                                                |
| `BrowserSessionFunction`            | type      | Resolves the current CDP session for a frame id.                                                                                                                                    |
| `BrowserSiblingRelation`            | type      | Names a structural sibling relationship relative to a browser node.                                                                                                                 |
| `BrowserStepOutcome`                | type      | Names how one step ended.                                                                                                                                                           |
| `BrowserTeardownFunction`           | type      | Runs one teardown step to settlement while the first failure is retained.                                                                                                           |
| `BrowserTransitionFunction`         | type      | Runs the work one `BrowserTransitionInterface` transition performs.                                                                                                                 |
| `BrowserViewEventMap`               | type      | Maps the `console` and `error` events of a view that observes its document's output.                                                                                                |
| `BrowserWorkerCategory`             | type      | Names a worker target category.                                                                                                                                                     |
| `browserHARHeadersToRecord`         | function  | Converts HAR name/value headers into a Fetch-domain header record.                                                                                                                  |
| `buildBrowserHAREntry`              | function  | Builds a standards-shaped HAR 1.2 entry from one observed exchange.                                                                                                                 |
| `computeBrowserButtons`             | function  | Computes the CDP Input pressed-button bitmask.                                                                                                                                      |
| `computeBrowserModifiers`           | function  | Computes the CDP Input modifier bitmask.                                                                                                                                            |
| `extractBrowserChord`               | function  | Extracts a keyboard chord such as `Control+Shift+P` into its parts, throwing a `BrowserError` on an empty chord or an unsupported modifier.                                         |
| `isBrowserPage`                     | function  | Checks whether a value exposes the page capabilities used by a browser toolset.                                                                                                     |
| `matchesBrowserCookieURL`           | function  | Matches a decoded cookie against one request URL.                                                                                                                                   |
| `matchesBrowserRoute`               | function  | Matches a request against route criteria.                                                                                                                                           |
| `matchesBrowserURL`                 | function  | Matches a URL using Chromium-style `*` and `**` glob segments.                                                                                                                      |
| `normalizeBrowserKey`               | function  | Normalizes named keys and modifier aliases before trusted keyboard input.                                                                                                           |
| `renderBrowserPassage`              | function  | Renders a bounded window with numbered rows and an exact continuation.                                                                                                              |
| `renderBrowserReceipt`              | function  | Renders a tool receipt: the action and its status on one line, the interrupting dialog, then a blank line and the fresh view.                                                       |
| `renderBrowserReceiptWindow`        | function  | Fits an unnumbered receipt and a complete page window inside one result limit.                                                                                                      |
| `requireBrowserString`              | function  | Requires an evaluated browser value to be a string.                                                                                                                                 |
| `settleBrowserTeardown`             | function  | Awaits every teardown step in order and returns the first failure.                                                                                                                  |
| `validateBrowserHAR`                | function  | Validates the HAR 1.2 fields required for deterministic replay.                                                                                                                     |
| `validateBrowserPageOpen`           | function  | Refuses work on a disconnected or closed page.                                                                                                                                      |
| `validateBrowserRange`              | function  | Validates a finite numeric range.                                                                                                                                                   |
| `validateBrowserTimeout`            | function  | Validates a public browser timeout before protocol work begins.                                                                                                                     |
| `validateBrowserViewport`           | function  | Validates Chromium viewport metrics.                                                                                                                                                |
| `BROWSER_DEFAULT_TIMEOUT_MS`        | const     | Sets the default timeout for browser connection, requests, and navigation, `30_000` milliseconds.                                                                                   |
| `BROWSER_DEFAULT_VIEWPORT_HEIGHT`   | const     | Sets the default viewport height, `720` pixels.                                                                                                                                     |
| `BROWSER_DEFAULT_VIEWPORT_WIDTH`    | const     | Sets the default viewport width, `1280` pixels.                                                                                                                                     |
| `BROWSER_FRAME_WORLD_NAME`          | const     | Names the isolated world used for iframe evaluation, `'__orkestrelBrowserFrame'`.                                                                                                   |
| `BROWSER_HAR_CREATOR`               | const     | Names the tool identity embedded in HAR 1.2 documents.                                                                                                                              |
| `BROWSER_KEY_MODIFIERS`             | const     | Maps a canonical modifier name to its CDP Input modifier bit value.                                                                                                                 |
| `BROWSER_MOUSE_BUTTON_MASKS`        | const     | Maps each public mouse button to its CDP Input pressed-button bit value.                                                                                                            |
| `BROWSER_NAVIGATION_REASONS`        | const     | Lists every CDP `Page.ClientNavigationReason` value a page accepts as a navigation's reason, as of Chromium 141; a page reads any other reason as undefined.                        |
| `BROWSER_RELOAD_NAVIGATION_TYPES`   | const     | Lists the CDP `Page.frameStartedNavigating` `navigationType` values that repeat or restore a history entry rather than follow a request, as of Chromium 141.                        |
| `BROWSER_SCHEMES`                   | const     | Names the URL schemes the `navigate` tool accepts by default: `http:` and `https:`.                                                                                                 |
| `BROWSER_SCREENSHOT_ATTRIBUTE`      | const     | Names the attribute that tags temporary screenshot styles and masks.                                                                                                                |
| `BROWSER_STABLE_FRAME_COUNT`        | const     | Sets the number of animation frames whose element bounds must agree before trusted input.                                                                                           |
| `BROWSER_STOP_LOADING_TIMEOUT_MS`   | const     | Bounds the best-effort `Page.stopLoading` call issued after a failed `navigate()` at `1_000` milliseconds.                                                                          |
| `BROWSER_WAIT_EVENTS`               | const     | Names the finished transitions and animations that wake a parked wait.                                                                                                              |

##### Page helpers

The following fence composes the page-level helpers behind trusted input, network interception, storage, coverage, and HAR recording.

```ts
import {
	browserHARHeadersToRecord,
	browserHeadersToProtocol,
	browserPDFToParams,
	browserScreenshotToParams,
	compileActionabilityFunction,
	compileBrowserBindingCleanup,
	compileBrowserBindingResult,
	compileBrowserBindingSource,
	compileScreenshotCleanupExpression,
	compileScreenshotPreparationExpression,
	compileStorageClearExpression,
	compileStorageReadExpression,
	compileStorageRestoreExpression,
	computeBrowserButtons,
	computeBrowserModifiers,
	concatBytes,
	cookieToProtocol,
	buildBrowserHAREntry,
	extractBrowserChord,
	keyToBrowserInput,
	matchesBrowserCookieURL,
	matchesBrowserRoute,
	matchesBrowserURL,
	mediaToFeatures,
	parseBrowserAXString,
	parseBrowserBindingCall,
	parseBrowserConsoleMessage,
	parseBrowserCookiePartition,
	parseBrowserDownloadProgress,
	parseBrowserDownloadStart,
	parseBrowserPageError,
	parseBrowserRequest,
	parseBrowserRequestFailure,
	parseBrowserResponse,
	parseBrowserResponseRecord,
	parseBrowserSecurity,
	parseBrowserTiming,
	parseBrowserTimingRange,
	parseBrowserWebSocketFrame,
	readBrowserAXValue,
	readBrowserAccessibility,
	readBrowserCookie,
	readBrowserCookies,
	readBrowserCoverageRanges,
	readBrowserHeaders,
	readBrowserMetrics,
	readBrowserProfile,
	readBrowserProfileFrame,
	readBrowserQuad,
	readBrowserRemoteValue,
	readBrowserScriptCoverage,
	readBrowserScriptIdentifier,
	readBrowserStack,
	readBrowserStorageEntries,
	readBrowserStorageOrigin,
	readBrowserStreamChunk,
	readBrowserStyleCoverage,
	settleBrowserTeardown,
	validateBrowserAccessibilityOptions,
	validateBrowserContextOptions,
	validateBrowserEmulationOptions,
	validateBrowserHAR,
	validateBrowserInputOptions,
	validateBrowserPoint,
	validateBrowserRange,
	validateBrowserTimeout,
	validateBrowserViewport,
} from '@orkestrel/browser'

const bytes = new Uint8Array([1, 2, 3])
concatBytes([bytes])
browserHeadersToProtocol({ accept: 'application/json' })
browserHARHeadersToRecord([{ name: 'content-type', value: 'text/plain' }])
browserPDFToParams({ landscape: true })
browserScreenshotToParams({ format: 'png' })
compileActionabilityFunction({ visible: true, stable: true })
compileBrowserBindingSource('lookup')
compileBrowserBindingResult('lookup', 'call-1', true, { found: true })
compileBrowserBindingCleanup('lookup')
compileScreenshotPreparationExpression({ animations: false })
compileScreenshotCleanupExpression('1')
compileStorageReadExpression()
compileStorageRestoreExpression({
	origin: 'https://example.com',
	local: [{ name: 'theme', value: 'dark' }],
	session: [],
})
compileStorageClearExpression()
computeBrowserButtons(['left'])
computeBrowserModifiers(['Control'])
cookieToProtocol({ name: 'session', value: 'value', url: 'https://example.com/' })
keyToBrowserInput('Enter')
extractBrowserChord('Control+Enter')
matchesBrowserURL('https://example.com/api', '**/api')
mediaToFeatures({ scheme: 'dark', motion: 'reduce' })

const request = parseBrowserRequest({
	requestId: 'request-1',
	request: { url: 'https://example.com/api', method: 'GET', headers: {} },
})
if (request !== undefined) {
	matchesBrowserRoute(request, { url: '**/api' })
	buildBrowserHAREntry(
		{ request, started: Date.now(), response: undefined },
		10,
		undefined,
		'Request failed',
	)
}

const cookie = readBrowserCookie(
	{
		name: 'session',
		value: 'value',
		domain: 'example.com',
		path: '/',
		expires: -1,
		size: 12,
		httpOnly: true,
		secure: true,
		session: true,
		priority: 'Medium',
	},
	0,
)
matchesBrowserCookieURL(cookie, 'https://example.com/')

const payload: unknown = {}
parseBrowserAXString(payload)
readBrowserAXValue(payload)
readBrowserAccessibility({ nodes: [] })
parseBrowserBindingCall(payload)
parseBrowserConsoleMessage(payload)
parseBrowserCookiePartition(payload)
readBrowserCookies({ cookies: [] })
readBrowserCoverageRanges([], 0)
parseBrowserDownloadProgress(payload)
parseBrowserDownloadStart(payload)
readBrowserHeaders(payload)
readBrowserMetrics({ metrics: [] })
parseBrowserPageError(payload)
readBrowserProfile({ profile: { startTime: 1, endTime: 2, nodes: [] } })
readBrowserProfileFrame(
	{ functionName: 'main', scriptId: '1', url: '', lineNumber: 0, columnNumber: 0 },
	0,
)
readBrowserQuad({ quads: [[0, 0, 10, 0, 10, 10, 0, 10]] })
readBrowserRemoteValue(payload)
parseBrowserRequestFailure(payload)
parseBrowserResponse(payload)
parseBrowserResponseRecord(payload, 'request-1', 'loader-1', undefined, 0)
readBrowserScriptCoverage({ result: [] })
readBrowserScriptIdentifier({ identifier: '1' })
parseBrowserSecurity(payload)
readBrowserStack(payload)
readBrowserStorageEntries([], 'https://example.com', 'local')
readBrowserStorageOrigin({ local: [], session: [] }, 'https://example.com')
readBrowserStreamChunk({ data: 'hello', eof: true })
readBrowserStyleCoverage({ ruleUsage: [] })
await settleBrowserTeardown(
	async () => undefined,
	async () => undefined,
) // unknown — the value the first failing step threw, or undefined
parseBrowserTiming(payload)
parseBrowserTimingRange(payload, 'dnsStart', 'dnsEnd')
parseBrowserWebSocketFrame(payload)
validateBrowserAccessibilityOptions({ depth: 3 })
validateBrowserInputOptions({ delay: 10, count: 2 })
validateBrowserContextOptions({ origins: ['https://example.com'] })
validateBrowserEmulationOptions({ locale: 'en-US' })
validateBrowserHAR({
	log: { version: '1.2', creator: { name: 'fixture', version: '1' }, entries: [] },
})
validateBrowserPoint({ x: 10, y: 20 })
validateBrowserRange(50, 'quality', 0, 100)
validateBrowserTimeout(1000)
validateBrowserViewport({ width: 1280, height: 720 })
```

#### Elements and readings

| API                                   | Kind      | Summary                                                                                                                                                                                                                           |
| ------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserReading`                      | class     | Represents one captured document, parsed one time and projected to Markdown or plain text in bounded slices.                                                                                                                      |
| `BrowserSnapshot`                     | class     | Represents a navigable, serializable browser DOM snapshot.                                                                                                                                                                        |
| `createBrowserReading`                | function  | Creates a `BrowserReadingInterface` over a captured document, parsing its HTML one time.                                                                                                                                          |
| `createBrowserSnapshot`               | function  | Creates a navigable `BrowserSnapshotInterface` over decoded `BrowserSnapshotInput` data.                                                                                                                                          |
| `BrowserAccessibilityInterface`       | interface | Inspects the accessibility tree.                                                                                                                                                                                                  |
| `BrowserAccessibilitySnapshot`        | interface | Describes a serializable accessibility-tree snapshot.                                                                                                                                                                             |
| `BrowserAXNode`                       | interface | Represents one decoded Chromium accessibility node.                                                                                                                                                                               |
| `BrowserElementGeometry`              | interface | Retains both session-local and page-composed element geometry.                                                                                                                                                                    |
| `BrowserElementInterface`             | interface | Provides actions and reading through a stable document element reference.                                                                                                                                                         |
| `BrowserElementManagerInput`          | interface | Provides the protocol and ownership boundaries used by a page element manager.                                                                                                                                                    |
| `BrowserElementManagerInterface`      | interface | Captures, queries, and retains references to a view's elements.                                                                                                                                                                   |
| `BrowserElementQuery`                 | interface | Describes an accessibility or CSS query within an optional element reference.                                                                                                                                                     |
| `BrowserElementRefusal`               | interface | Describes how an element action reports one refusal its compiled in-page check throws: the reason, and the detail that follows the element's name, or `undefined` for the reason's own wording.                                   |
| `BrowserElementSubject`               | interface | Identifies a manager failure without inventing an element reference.                                                                                                                                                              |
| `BrowserLine`                         | interface | Carries the ordered spans of one addressed document line.                                                                                                                                                                         |
| `BrowserLineSpan`                     | interface | Distinguishes searchable text from generated syntax and actionable references.                                                                                                                                                    |
| `BrowserNode`                         | interface | Represents one serializable DOM node decoded from a CDP DOM snapshot.                                                                                                                                                             |
| `BrowserNodeQuery`                    | interface | Describes a declarative browser-node matcher used by `matchesBrowserNode`.                                                                                                                                                        |
| `BrowserOutline`                      | interface | Carries document-order lines, element counts, and the focused element's row.                                                                                                                                                      |
| `BrowserOutlineNode`                  | interface | Associates an outline row with its frame, session, and optional actionable reference.                                                                                                                                             |
| `BrowserPageElementInterface`         | interface | Provides trusted page input and capture for a referenced element.                                                                                                                                                                 |
| `BrowserPoint`                        | interface | Describes a point in viewport CSS pixels.                                                                                                                                                                                         |
| `BrowserReadingInput`                 | interface | Describes the captured document a reading is built from.                                                                                                                                                                          |
| `BrowserReadingInterface`             | interface | Represents one captured document, parsed one time and projected to Markdown or plain text in bounded slices.                                                                                                                      |
| `BrowserReadResult`                   | interface | Describes one slice of a reading's projection.                                                                                                                                                                                    |
| `BrowserSearch`                       | interface | Carries the opening line and optional search text of an addressed window.                                                                                                                                                         |
| `BrowserSnapshotInput`                | interface | Describes the serializable input for a navigable browser snapshot — the form a `BrowserSnapshot` is built from and serializes back to.                                                                                            |
| `BrowserSnapshotInterface`            | interface | Represents a navigable, serializable snapshot of every document attached to a page, extending `BrowserSnapshotInput` with walking, structural relationships, search, and path derivation over plain `BrowserNode` values.         |
| `BrowserAccessibilityOptions`         | interface | Describes the options for an accessibility snapshot.                                                                                                                                                                              |
| `BrowserOutlineOptions`               | interface | Configures an outline's element limit and optional subtree.                                                                                                                                                                       |
| `BrowserReadOptions`                  | interface | Describes the options for one slice of a reading's Markdown or plain-text projection.                                                                                                                                             |
| `BrowserSnapshotOptions`              | interface | Describes the options configuring capture through `BrowserPageInterface` `snapshot()`. The snapshot entity's creation input is `BrowserSnapshotInput`.                                                                            |
| `validateBrowserAccessibilityOptions` | function  | Validates Accessibility-domain snapshot bounds.                                                                                                                                                                                   |
| `BrowserElementReason`                | type      | Identifies the refusal an element action reports.                                                                                                                                                                                 |
| `BrowserElementWorldFunction`         | type      | Resolves the page-owned isolated world for a particular frame and session.                                                                                                                                                        |
| `BrowserNodePredicate`                | type      | Names the predicate form accepted by `BrowserSnapshotInterface` find, filter, and closest methods.                                                                                                                                |
| `BrowserReadinessFunction`            | type      | Waits for the current document's DOM readiness.                                                                                                                                                                                   |
| `BrowserRect`                         | type      | Represents a rectangle in CSS pixels: x, y, width, height.                                                                                                                                                                        |
| `BrowserReferenceFunction`            | type      | Allocates the next reference from the owning browser context.                                                                                                                                                                     |
| `abbreviateBrowserText`               | function  | Abbreviates displayed metadata without splitting a Unicode code point.                                                                                                                                                            |
| `belongsBrowserOutline`               | function  | Checks whether a node descends from another within one session's captured tree.                                                                                                                                                   |
| `boundBrowserText`                    | function  | Bounds a tool string at a character limit, appending a footer that names the cut and the caller's closing clause.                                                                                                                 |
| `collectBrowserWords`                 | function  | Collects distinct lowercase words of at least 3 letters or digits.                                                                                                                                                                |
| `composeBrowserPoint`                 | function  | Composes a frame-local point with its ancestor frame offsets.                                                                                                                                                                     |
| `extractBrowserSlice`                 | function  | Extracts one bounded slice of a projected text, cutting after a line break where one fits.                                                                                                                                        |
| `filterBrowserOutline`                | function  | Filters document-order outline rows by accessibility role and name.                                                                                                                                                               |
| `findBrowserText`                     | function  | Finds the first line contributing a whitespace-normalized match across consecutive text spans.                                                                                                                                    |
| `isBrowserNodeQuery`                  | function  | Tests whether a browser-node matcher is a declarative query rather than a predicate.                                                                                                                                              |
| `isBrowserNodeVisible`                | function  | Tests whether a captured node has a non-empty rendered layout box.                                                                                                                                                                |
| `matchesBrowserNode`                  | function  | Tests a captured node against a declarative query.                                                                                                                                                                                |
| `normalizeBrowserName`                | function  | Normalizes an accessible name for display and matching.                                                                                                                                                                           |
| `renderBrowserElement`                | function  | Renders an element as its outline row reads: role, quoted name, and reference.                                                                                                                                                    |
| `renderBrowserFooter`                 | function  | Renders an exact addressed-range footer, including the next line when content remains.                                                                                                                                            |
| `renderBrowserLine`                   | function  | Joins a projected line's spans without adding an address.                                                                                                                                                                         |
| `renderBrowserOutline`                | function  | Renders document-order accessibility lines with a bounded element count.                                                                                                                                                          |
| `renderBrowserOutlineRow`             | function  | Renders one outline row: the node's role, quoted accessible name, reference, and states.                                                                                                                                          |
| `renderBrowserSearch`                 | function  | Renders shared search text and chooses its context line within the requested range.                                                                                                                                               |
| `renderBrowserSpans`                  | function  | Renders an element as searchable text separated from references and syntax.                                                                                                                                                       |
| `renderBrowserWindow`                 | function  | Selects whole addressed rows after reserving the header and exact footer.                                                                                                                                                         |
| `requireBrowserReference`             | function  | Requires a tool argument to be an element reference in any spelling `parseBrowserReference` accepts, and returns its canonical form.                                                                                              |
| `scanBrowserLines`                    | function  | Finds the highest-scoring text lines within an inclusive range using whole words and prefixes.                                                                                                                                    |
| `validateBrowserLines`                | function  | Refuses invalid line coordinates before selecting content.                                                                                                                                                                        |
| `validateBrowserPoint`                | function  | Validates viewport input coordinates.                                                                                                                                                                                             |
| `wrapBrowserLine`                     | function  | Wraps spans before numbering, marking hard continuations with a leading ↳.                                                                                                                                                        |
| `BROWSER_ELEMENT_REFUSALS`            | const     | Maps the first line of each refusal the compiled element functions throw, without its `Error:` prefix, to the reason and the one-line detail an element action reports it with.                                                   |
| `BROWSER_INTERACTIVE_ROLES`           | const     | Names accessibility roles that receive actionable outline references.                                                                                                                                                             |
| `BROWSER_OUTLINE_LIMIT`               | const     | Bounds the default number of actionable elements in an outline.                                                                                                                                                                   |
| `BROWSER_OUTLINE_OMITTED_ROLES`       | const     | Names accessibility roles whose own rows add no outline content.                                                                                                                                                                  |
| `BROWSER_READ_CHANGED_NOTE`           | const     | Reports changed line numbers without restarting a continuation.                                                                                                                                                                   |
| `BROWSER_READ_CONTEXT`                | const     | Opens a search window one line before its first match.                                                                                                                                                                            |
| `BROWSER_READ_LINES`                  | const     | Caps a default reading window at 100 addressed lines.                                                                                                                                                                             |
| `BROWSER_READ_MATCHES`                | const     | Caps the displayed search hit list at 50 line numbers.                                                                                                                                                                            |
| `BROWSER_READ_WIDTH`                  | const     | Wraps projection rows at 800 UTF-16 units, leaving room for receipt metadata.                                                                                                                                                     |
| `BROWSER_REFERENCE_PREFIX`            | const     | Prefixes stable element references within a browser context.                                                                                                                                                                      |
| `BROWSER_SEARCH_PATTERN`              | const     | Matches one word of an outline search and of a row's role and name: a run of at least 3 letters or digits.                                                                                                                        |
| `BROWSER_SNAPSHOT_NODE_LIMIT`         | const     | Sets the default maximum node count accepted from a decoded CDP DOM snapshot, `100_000`.                                                                                                                                          |
| `BROWSER_TEXT_ROLES`                  | const     | Names accessibility roles rendered as text without an actionable reference.                                                                                                                                                       |
| `BROWSER_TYPED_ROLES`                 | const     | Names the accessibility roles the `type` tool writes to: `textbox`, `searchbox`, and `spinbutton` take typed text, and `combobox` and `listbox` take a select control's option or, for a text input with suggestions, typed text. |

##### Render numbered lines

The following fence builds searchable spans, reads an inclusive window, and renders its continuation. The compiler calls produce expressions for an observation installed by `compileSubmitObserverExpression`; the wait preserves that observation, and release removes it only for its owning token.

```ts
import type { BrowserLine, BrowserOutlineNode } from '@orkestrel/browser'
import {
	abbreviateBrowserText,
	belongsBrowserOutline,
	compileSubmitReleaseExpression,
	compileSubmitWaitExpression,
	redactBrowserText,
	renderBrowserFooter,
	renderBrowserLine,
	renderBrowserPassage,
	findBrowserText,
	renderBrowserSearch,
	renderBrowserReceiptWindow,
	renderBrowserSpans,
	renderBrowserWindow,
	scanBrowserLines,
	validateBrowserLines,
	wrapBrowserLine,
} from '@orkestrel/browser'

const root: BrowserOutlineNode = {
	id: 'root',
	session: 'main',
	reference: undefined,
	properties: {},
	parent: undefined,
	children: ['delivery'],
	backend: undefined,
	frame: undefined,
	ignored: false,
	role: undefined,
	name: undefined,
	description: undefined,
	value: undefined,
}
const link: BrowserOutlineNode = {
	...root,
	children: [],
	id: 'delivery',
	parent: 'root',
	session: 'main',
	reference: 'e12345',
	role: 'link',
	name: 'Shipping',
	properties: { url: 'https://shop.example.test/delivery' },
}
belongsBrowserOutline(link, root, new Map([['main:root', root]])) // true
const lines: readonly BrowserLine[] = [
	{ spans: renderBrowserSpans(link, 'https://shop.example.test/') },
	{ spans: [{ category: 'text', text: 'We ship every weekday.' }] },
	{ spans: [{ category: 'text', text: 'Contact the workshop.' }] },
]
renderBrowserLine(lines[0] ?? { spans: [] }) // 'link "Shipping" [ref=e12345] /delivery'
scanBrowserLines(lines, 'ship') // [1, 2]
scanBrowserLines(lines, 'e12345') // []
findBrowserText(lines, 'We ship every weekday.') // 2
renderBrowserSearch(lines, 1, undefined, 'Shipping') // { from: 1, text: '1 line matches "Shipping": 1' }
renderBrowserReceiptWindow(
	{
		url: 'https://shop.example.test/',
		title: 'Delivery',
		lines,
		from: 1,
		tabs: [],
		changed: false,
	},
	'Read.',
	4000,
) // receipt and addressed window share the limit
scanBrowserLines(lines, 'delivery', 2) // []
validateBrowserLines(1, 2, lines.length)
renderBrowserWindow(lines, 1, 2, 'Delivery', 4_000)
// Delivery
// 1: link "Shipping" [ref=e12345] /delivery
// 2: We ship every weekday.
// [lines 1–2 of 3; 1 below; call read with from 3 for more]
renderBrowserFooter(3, 3, 3) // '[lines 3–3 of 3; 2 above; end of page]'
renderBrowserPassage(
	{
		url: 'https://shop.example.test/',
		title: 'Delivery',
		lines,
		from: 2,
		to: 2,
		search: 'shipping',
		tabs: [],
		changed: true,
	},
	4_000,
)
// page "Delivery" https://shop.example.test/ (3 lines)
// This read shows lines 2–2 of 3; line 3 is not shown yet.
// The page changed since the last view; line numbers might differ.
// 1 line matches "shipping": 2
// 2: We ship every weekday.
// [lines 2–2 of 3; 1 above, 1 below; call read with from 3 for more]
renderBrowserPassage(
	{
		url: 'https://shop.example.test/',
		title: 'Delivery',
		lines,
		from: 3,
		search: 'delivery',
		tabs: [],
		changed: false,
	},
	4_000,
)
// page "Delivery" https://shop.example.test/ (3 lines)
// No line from 3 on matches "delivery"; the best match is line 1:
// 1: link "Shipping" [ref=e12345] /delivery
// 3: Contact the workshop.
// [lines 3–3 of 3; 2 above; end of page]
wrapBrowserLine({ spans: [{ category: 'text', text: 'x'.repeat(801) }] }).map(renderBrowserLine)
// ['x'.repeat(800), '↳x']
abbreviateBrowserText('Alpine Kettle', 7) // 'Alpine…'
redactBrowserText('Order for Ada', ['Ada']) // 'Order for [redacted]'
compileSubmitWaitExpression(1, 200)
compileSubmitReleaseExpression(1)
```

#### Toolset

| API                              | Kind      | Summary                                                                                                                                                                                                                                                      |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BrowserToolset`                 | class     | Publishes the browser vocabulary as `@orkestrel/tool` tools over one view and adopts the view's own tools beside them.                                                                                                                                       |
| `createBrowserToolset`           | function  | Creates a toolset over a caller-owned view, enabling page tools when the view is a page.                                                                                                                                                                     |
| `BrowserAction`                  | interface | Describes what became of one action the toolset performed.                                                                                                                                                                                                   |
| `BrowserHoldInterface`           | interface | Owns the toolset while a replay runs; `destroy` releases it.                                                                                                                                                                                                 |
| `BrowserInvocation`              | interface | Describes a WebMCP invocation observed on the protocol.                                                                                                                                                                                                      |
| `BrowserInvocationResult`        | interface | Carries a terminal WebMCP status and its untrusted output or error.                                                                                                                                                                                          |
| `BrowserRegistryInterface`       | interface | Mirrors the experimental WebMCP protocol domain for a page.                                                                                                                                                                                                  |
| `BrowserTool`                    | interface | Describes a registered WebMCP tool and its owning document.                                                                                                                                                                                                  |
| `BrowserToolAnnotation`          | interface | Transliterates the WebMCP protocol's `Annotation` type, retaining its wire spelling.                                                                                                                                                                         |
| `BrowserToolRemoval`             | interface | Identifies a removed WebMCP tool by document and name.                                                                                                                                                                                                       |
| `BrowserToolsetInterface`        | interface | Publishes the browser vocabulary as tools over one current view and adopts the page's own tools beside them.                                                                                                                                                 |
| `BrowserToolsetResult`           | interface | Carries a performed call's tool result beside its structured action, present when the call reached a handler, and the value a failed handler threw.                                                                                                          |
| `BrowserToolSourceInterface`     | interface | Supplies page-registered tools to a toolset through a contract free of protocol types.                                                                                                                                                                       |
| `BrowserActionabilityOptions`    | interface | Describes the actionability checks performed before element input.                                                                                                                                                                                           |
| `BrowserRegistryOptions`         | interface | Configures registry listeners and listener-error handling.                                                                                                                                                                                                   |
| `BrowserToolsetOptions`          | interface | Configures a browser toolset.                                                                                                                                                                                                                                |
| `BrowserToolsetReadOptions`      | interface | Configures a fresh line window within a whole-result character limit.                                                                                                                                                                                        |
| `BrowserRegistryEventMap`        | type      | Maps registry changes and observed WebMCP invocation events.                                                                                                                                                                                                 |
| `BrowserToolName`                | type      | Names a tool the browser toolset reserves: the generic tools, the staged `dialog`, the opt-in `switch`, and the journey tools `record`, `save`, `journeys`, `edit`, `replay`, `forget`, and `capture`, which a toolset constructed with `journeys` reserves. |
| `BrowserToolsetEventMap`         | type      | Maps the events a toolset emits.                                                                                                                                                                                                                             |
| `BrowserToolsetReason`           | type      | Names why a toolset declined a page tool.                                                                                                                                                                                                                    |
| `BrowserToolSourceEventMap`      | type      | Maps the signal a tool source emits when its page's tools change.                                                                                                                                                                                            |
| `deriveBrowserToolSchema`        | function  | Derives the advertised input schema from an authored one, adding a required `purpose` parameter when the schema requires nothing.                                                                                                                            |
| `redactBrowserText`              | function  | Redacts registered secrets before projection wrapping or output clipping.                                                                                                                                                                                    |
| `renderBrowserToolOutput`        | function  | Renders tool strings unchanged, content-array text blocks joined, and other values as bounded JSON.                                                                                                                                                          |
| `validateBrowserToolArguments`   | function  | Refuses a tool call that carries a parameter its definition does not advertise, naming the parameters the tool takes.                                                                                                                                        |
| `BROWSER_ACTION_OUTCOMES`        | const     | Lists every outcome a `BrowserAction` and a run step carry: `done`, `refused`, `timeout`, and `interrupted`.                                                                                                                                                 |
| `BROWSER_ACTION_STAGES`          | const     | Lists every navigation stage a `BrowserAction` and a run step carry: `requested`, `committed`, and `loaded`.                                                                                                                                                 |
| `BROWSER_OBSERVATION_TOOL_NAMES` | const     | Names the tools that observe the view without recording an action.                                                                                                                                                                                           |
| `BROWSER_REGISTRY_ABSENT_CODE`   | const     | Identifies the CDP method-not-found response when WebMCP is absent.                                                                                                                                                                                          |
| `BROWSER_REGISTRY_OUTPUT_LIMIT`  | const     | Bounds adopted tool JSON output and error messages to 4096 UTF-16 code units.                                                                                                                                                                                |
| `BROWSER_SUBMIT_KEY`             | const     | Names the isolated-world property that holds the `submit` observer an action installs before its input, `'__orkestrelSubmit'`.                                                                                                                               |
| `BROWSER_TOOL_CAPTURE_MS`        | const     | Reserves `1_000` milliseconds of an action receipt's `BROWSER_TOOL_TIMEOUT_MS` deadline for the view capture, so a receipt whose navigation wait reaches its bound still carries the view.                                                                   |
| `BROWSER_TOOL_CHANGED_NOTE`      | const     | Holds the note an action receipt carries in place of the view when the page changed under the capture twice: once after the action, and again during the one retry that follows the page's readiness.                                                        |
| `BROWSER_TOOL_COPY`              | const     | Holds the advertised definition of each reserved tool: its description, its JSON Schema parameters, and its annotations.                                                                                                                                     |
| `BROWSER_TOOL_CUT_FOOTER`        | const     | Holds the clause that ends a cut result without an addressed page window.                                                                                                                                                                                    |
| `BROWSER_TOOL_DEADLINE_NOTE`     | const     | Holds the note an action receipt carries in place of the view when the receipt's deadline passed before the view could be captured.                                                                                                                          |
| `BROWSER_TOOL_HANDLED_STATUS`    | const     | Holds the status of a handled submission whose settle observed a change.                                                                                                                                                                                     |
| `BROWSER_TOOL_LIMIT`             | const     | Bounds each tool result and error message at `4_000` UTF-16 code units including its footer.                                                                                                                                                                 |
| `BROWSER_TOOL_NAME_PATTERN`      | const     | Matches a page tool name the toolset can advertise: 1 to 64 ASCII letters, digits, underscores, and hyphens.                                                                                                                                                 |
| `BROWSER_TOOL_NAMES`             | const     | Names the eight page tools: `read`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`, and `switch`.                                                                                                                                                    |
| `BROWSER_TOOL_PENDING_NOTE`      | const     | Holds the refusal for a hold requested while an earlier input remains pending.                                                                                                                                                                               |
| `BROWSER_TOOL_TIMEOUT_LIMIT_MS`  | const     | Caps the `wait` tool's `timeout` parameter at `30_000` milliseconds.                                                                                                                                                                                         |
| `BROWSER_TOOL_TIMEOUT_MS`        | const     | Sets the `wait` tool's default and an action receipt's bound on a requested navigation, `5_000` milliseconds.                                                                                                                                                |
| `BROWSER_TOOL_UNCHANGED_STATUS`  | const     | Holds the status of a handled submission with no rendered change before the deadline.                                                                                                                                                                        |

##### Element and tool helpers

The following fence composes the element, reading, and tool helpers the element managers and the toolset are built from.

```ts
import {
	isBrowserError,
	BROWSER_TOOL_COPY,
	BROWSER_TOOL_CUT_FOOTER,
	boundBrowserText,
	compileHitFunction,
	compileQueryWaitExpression,
	compileReadFunction,
	compileSelectFunction,
	compileSubmitObserverExpression,
	compileSubmitReadExpression,
	compileTextWaitExpression,
	composeBrowserPoint,
	deriveBrowserToolSchema,
	extractBrowserSlice,
	filterBrowserOutline,
	normalizeBrowserKey,
	normalizeBrowserName,
	parseBrowserInvocation,
	parseBrowserInvocationResult,
	parseBrowserReference,
	parseBrowserToolInteger,
	parseBrowserRemoval,
	parseBrowserTool,
	readBrowserToolString,
	readBrowserWorld,
	renderBrowserOutlineRow,
	renderBrowserOutline,
	renderBrowserReceipt,
	renderBrowserToolOutput,
	requireBrowserReference,
	validateBrowserToolArguments,
} from '@orkestrel/browser'

parseBrowserReference('[ref=e12]') // 'e12'
parseBrowserReference('x12') // undefined
parseBrowserToolInteger('7') // 7
parseBrowserToolInteger('07') // undefined
requireBrowserReference('e12') // 'e12'; bare '12' throws a coded BrowserError
normalizeBrowserKey('ctrl+a') // 'Control+a'
normalizeBrowserName('  Place   order ') // 'Place order'
composeBrowserPoint({ x: 10, y: 10 }, [{ x: 100, y: 50 }]) // { x: 110, y: 60 }
extractBrowserSlice('one\ntwo\nthree', 0, 8) // { text: 'one\ntwo\n', offset: 0, total: 13 }
boundBrowserText('x'.repeat(5_000), 4_000, BROWSER_TOOL_CUT_FOOTER).length // 4000, including the footer
try {
	validateBrowserToolArguments(BROWSER_TOOL_COPY.read, { from: 1, search: 'cart', ref: 'e1' })
} catch (error) {
	if (!isBrowserError(error)) throw error
	error.code // 'ARGUMENT'
}
const element = {
	id: 'button',
	session: 'main',
	reference: 'e4',
	properties: {},
	parent: undefined,
	children: [],
	backend: undefined,
	frame: undefined,
	ignored: false,
	role: 'button',
	name: 'Place order',
	description: undefined,
	value: undefined,
}
const nodes = [element]
const view = '1: button "Place order" [ref=e4]'
renderBrowserOutlineRow(element) // 'button "Place order" [ref=e4]'
const rows = filterBrowserOutline(nodes, { role: 'button', name: 'place' })
renderBrowserOutline('https://example.test/cart', 'Cart', rows, 150) // { url, title, lines, listed, found, focus }
renderBrowserReceipt({ action: 'Clicked button "Place order" [ref=e4]', view }) // the receipt line, then the view
renderBrowserToolOutput([{ type: 'text', text: 'Found 3 cars' }]) // 'Found 3 cars'
readBrowserToolString({ search: 'cart' }, 'search') // 'cart'
deriveBrowserToolSchema(undefined) // a schema requiring a purpose string
const tool = parseBrowserTool({}) // BrowserTool | undefined
const removal = parseBrowserRemoval({}) // BrowserToolRemoval | undefined
const invocation = parseBrowserInvocation({}) // BrowserInvocation | undefined
const settled = parseBrowserInvocationResult({}) // BrowserInvocationResult | undefined
const world = readBrowserWorld({ executionContextId: 1 }, 'main') // execution context id
const read = compileReadFunction() // returns { url, title, html } in the isolated world
const hit = compileHitFunction() // tests whether a hit node is the element or inside it
const select = compileSelectFunction(['Large']) // selects the options whose value or label matches
const observe = compileSubmitObserverExpression(7) // records every submit event for action 7
const submitted = compileSubmitReadExpression(7) // resolves { destinations, prevented, submitted, implicit } and preserves the observer; null for another token
const waitText = compileTextWaitExpression('Order placed', 5_000, 'wait-1')
const waitQuery = compileQueryWaitExpression(5_000, 'wait-2')
```

#### Journeys and stores

| API                                    | Kind      | Summary                                                                                                                                                                                   |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserRecorder`                      | class     | Records semantic steps from completed toolset actions and omits refused or timed-out actions.                                                                                             |
| `BrowserReplay`                        | class     | Prepares and replays a journey under a toolset hold, retaining its executed prefix.                                                                                                       |
| `MemoryBrowserJourneyStore`            | class     | Keeps owned journey snapshots and revision counters across deletion.                                                                                                                      |
| `MemoryBrowserRunStore`                | class     | Keeps owned runs under their journey names and producer ids without directories.                                                                                                          |
| `createBrowserRecorder`                | function  | Creates a recorder over toolset actions.                                                                                                                                                  |
| `createBrowserReplay`                  | function  | Creates a replay of one journey revision.                                                                                                                                                 |
| `createMemoryBrowserJourneyStore`      | function  | Creates an in-memory journey store with persistent revision counters.                                                                                                                     |
| `createMemoryBrowserRunStore`          | function  | Creates an in-memory run store without capture directories.                                                                                                                               |
| `BrowserCodegenGesture`                | interface | Carries a sanitized gesture from the page listener without password values.                                                                                                               |
| `BrowserCodegenScript`                 | interface | Carries the module `compileBrowserJourney` emits with the gap steps that refuse it.                                                                                                       |
| `BrowserJourney`                       | interface | Describes one user intent as data; `next` is the number the next added step takes.                                                                                                        |
| `BrowserJourneyInput`                  | interface | Names and describes a journey built from recorded steps.                                                                                                                                  |
| `BrowserJourneyParameter`              | interface | Declares one parameter a journey takes: its default, or none when it is a secret.                                                                                                         |
| `BrowserJourneyRevision`               | interface | Carries a journey with the revision the store assigned; `revision` is absent for a journey the store never held.                                                                          |
| `BrowserJourneyStep`                   | interface | Describes a step with its identity: `s` followed by a positive integer, stable across edits and never reused.                                                                             |
| `BrowserJourneyStepInput`              | interface | Describes one step before it holds an id: a call of a toolset tool with its element or tab named as data.                                                                                 |
| `BrowserJourneyStoreInterface`         | interface | Keeps journeys by name with a revision per write.                                                                                                                                         |
| `BrowserJourneyTab`                    | interface | Names the tab a `switch` step moves to, portably.                                                                                                                                         |
| `BrowserJourneyTarget`                 | interface | Names the element an acting step acts on the way a receipt names it, with the record-time evidence a developer reads when a resolution is refused.                                        |
| `BrowserJourneyValidationContext`      | interface | Identifies the parameter binding that failed journey validation.                                                                                                                          |
| `BrowserRecorderInterface`             | interface | Records the steps of a journey from one source as they happen and turns them into a journey.                                                                                              |
| `BrowserReplayInterface`               | interface | Replays one journey over a toolset.                                                                                                                                                       |
| `BrowserRun`                           | interface | Describes one run of a journey; `inputs` omits secret values; `fault` carries the run file's write failure or the failure that stopped it before a step ran.                              |
| `BrowserRunSlot`                       | interface | Names the run directory a store created, as data.                                                                                                                                         |
| `BrowserRunStep`                       | interface | Describes one replayed step; `action`, `trigger`, and `result` carry the meaning of the skill's `JournalStep` fields.                                                                     |
| `BrowserRunStoreInterface`             | interface | Keeps runs by the journey name and run id the run carries.                                                                                                                                |
| `BrowserStoreFault`                    | interface | Names one entry a listing could not read.                                                                                                                                                 |
| `BrowserStorePage`                     | interface | Carries one page of a listing with the entries it could not read.                                                                                                                         |
| `BrowserHARReplayOptions`              | interface | Describes HAR replay behavior.                                                                                                                                                            |
| `BrowserJourneyOptions`                | interface | Configures the journey toolset a toolset constructs.                                                                                                                                      |
| `BrowserJourneyWriteOptions`           | interface | Constrains a journey write atomically at the store.                                                                                                                                       |
| `BrowserRecorderOptions`               | interface | Configures a recorder.                                                                                                                                                                    |
| `BrowserReplayOptions`                 | interface | Configures one replay.                                                                                                                                                                    |
| `BrowserStoreOptions`                  | interface | Carries the signal a store call honours.                                                                                                                                                  |
| `BrowserStorePageOptions`              | interface | Configures one page of a store listing, with cancellation.                                                                                                                                |
| `validateBrowserJourneyWriteOptions`   | function  | Validates the mutually exclusive conditions of a journey write before side effects.                                                                                                       |
| `BrowserCodegenLanguage`               | type      | Names the target language for a compiled codegen script.                                                                                                                                  |
| `BrowserJourneyBinding`                | type      | Binds a native action's string argument to a literal or to one declared parameter by name.                                                                                                |
| `BrowserJourneyEdit`                   | type      | Describes one change to a journey; `editBrowserJourney` applies a batch to a copy, in order, and refuses it whole on the first invalid edit.                                              |
| `BrowserJourneyEditRequest`            | type      | Describes an edit as the `edit` tool receives it over the wire: an added or updated step can name `ref` instead of a target, converted from the current view before the pure editor runs. |
| `BrowserRecorderEventMap`              | type      | Maps the events a recorder emits.                                                                                                                                                         |
| `BrowserReplayEventMap`                | type      | Maps the events a replay emits.                                                                                                                                                           |
| `BrowserRunOutcome`                    | type      | Names how a run ended.                                                                                                                                                                    |
| `buildBrowserJourney`                  | function  | Builds a validated journey from recorded steps and declares their secret bindings.                                                                                                        |
| `collectBrowserJourneyBindings`        | function  | Collects parameter uses from native arguments and target names, keeping page arguments literal.                                                                                           |
| `collectBrowserJourneyTextBindings`    | function  | Collects the parameter names a native `type` step's `text` binds.                                                                                                                         |
| `deriveBrowserJourneySecret`           | function  | Derives an unused lower camel case secret parameter name from an accessible name.                                                                                                         |
| `deriveBrowserJourneyTrigger`          | function  | Derives the trigger text a run records for an action.                                                                                                                                     |
| `editBrowserJourney`                   | function  | Applies an ordered edit batch to a copy and validates its nonempty result and final bindings.                                                                                             |
| `generateBrowserRunId`                 | function  | Generates a run id from an ISO timestamp and a cryptographic hexadecimal suffix.                                                                                                          |
| `isBrowserJourneyBinding`              | function  | Checks whether a native string argument is a literal or a parameter binding.                                                                                                              |
| `isBrowserJourneyTab`                  | function  | Checks whether a tab carries its portable URL and title.                                                                                                                                  |
| `isBrowserJourneyTarget`               | function  | Checks whether a target carries its role, name, and optional evidence.                                                                                                                    |
| `isBrowserJourneyValidationContext`    | function  | Checks whether a validation context identifies a parameter, step, and field.                                                                                                              |
| `isBrowserSecretBinding`               | function  | Checks whether a step binds a declared secret through type.text.                                                                                                                          |
| `normalizeBrowserJourneyReason`        | function  | Normalizes a failure to its first paragraph without an invariant label, directive, or final period.                                                                                       |
| `renderBrowserJourney`                 | function  | Renders a journey with its parameter declarations and stable step ids.                                                                                                                    |
| `renderBrowserJourneyFault`            | function  | Renders an unreadable journey from its name and path-free reason.                                                                                                                         |
| `renderBrowserRun`                     | function  | Renders a run heading and its receipts, followed by the supplied final view.                                                                                                              |
| `renderBrowserRunResult`               | function  | Renders a step receipt without its tool directive or appended view.                                                                                                                       |
| `resolveBrowserJourneyBinding`         | function  | Resolves a native string binding from supplied inputs.                                                                                                                                    |
| `validateBrowserJourney`               | function  | Validates the journey format and its name, nonempty steps, ids, bindings, secrets, JSON, and actions.                                                                                     |
| `validateBrowserJourneyEdit`           | function  | Validates an edit structure and names the operation and field in each refusal.                                                                                                            |
| `validateBrowserJourneyName`           | function  | Checks a journey name before store access.                                                                                                                                                |
| `validateBrowserJourneyParameter`      | function  | Validates a parameter declaration, including the secret-default exclusion.                                                                                                                |
| `validateBrowserJourneyStep`           | function  | Validates one step independently of ids and parameter declarations.                                                                                                                       |
| `validateBrowserRun`                   | function  | Validates a persisted run and the journey it carries.                                                                                                                                     |
| `validateBrowserStorePage`             | function  | Checks the offset and limit of a store page.                                                                                                                                              |
| `BROWSER_CODEGEN_BINDING_NAME`         | const     | Names the CDP runtime binding the codegen recorder script calls into, `'__orkestrelBrowserCodegen'`.                                                                                      |
| `BROWSER_CODEGEN_SOURCE`               | const     | Holds the self-contained document listener installed before a frame resumes. Password input carries a marker; only Enter carries a key. Node indices are local to a document.             |
| `BROWSER_JOURNEY_ACTIONS`              | const     | Names the native actions a journey step can hold: `click`, `type`, `press`, `navigate`, `wait`, `dialog`, and `switch`.                                                                   |
| `BROWSER_JOURNEY_EMPTY_LISTING`        | const     | Holds the result the `journeys` tool returns when no journey is saved.                                                                                                                    |
| `BROWSER_JOURNEY_FORMAT_VERSION`       | const     | Holds the journey and run file format this package writes and reads, `1`.                                                                                                                 |
| `BROWSER_JOURNEY_IDLE_REFUSAL`         | const     | Holds the refusal `save` returns when no journey is recording.                                                                                                                            |
| `BROWSER_JOURNEY_SAVE_SAVED_REFUSAL`   | const     | Holds the refusal `save` returns after a successful save when no journey is recording.                                                                                                    |
| `BROWSER_JOURNEY_NAME_PATTERN`         | const     | Matches a journey name: lowercase letters and digits in words joined by single hyphens, at most 64 characters, and never a Windows reserved device name.                                  |
| `BROWSER_JOURNEY_NON_STEP_TOOLS`       | const     | Names observation and journey tools that cannot become journey steps.                                                                                                                     |
| `BROWSER_JOURNEY_PARAMETER_PATTERN`    | const     | Matches a journey parameter name: a lowercase letter followed by letters and digits.                                                                                                      |
| `BROWSER_JOURNEY_READONLY_REFUSAL`     | const     | Holds the refusal `record`, `save`, `edit`, and `forget` return when the journeys are read-only.                                                                                          |
| `BROWSER_JOURNEY_RECORDING_REFUSAL`    | const     | Holds the refusal `record` returns while another journey is recording.                                                                                                                    |
| `BROWSER_JOURNEY_EMPTY_REFUSAL`        | const     | Holds the refusal `save` returns while the recording has no steps.                                                                                                                        |
| `BROWSER_JOURNEY_RECORD_EMPTY_REFUSAL` | const     | Holds the refusal `record` returns for the same empty recording.                                                                                                                          |
| `BROWSER_JOURNEY_RECORD_STEPS_REFUSAL` | const     | Holds the refusal `record` returns for the same recording with steps.                                                                                                                     |
| `BROWSER_JOURNEY_EDIT_CHOICE_REFUSAL`  | const     | Holds the refusal `edit` returns without a journey when several journeys are saved.                                                                                                       |
| `BROWSER_JOURNEY_EDIT_EMPTY_REFUSAL`   | const     | Holds the refusal `edit` returns without a journey when no journey is saved.                                                                                                              |
| `BROWSER_JOURNEY_STEP_KEYS`            | const     | Names native tool arguments represented by journey targets, tabs, or secret bindings.                                                                                                     |
| `BROWSER_JOURNEY_TOOL_NAMES`           | const     | Names the journey tools a toolset constructed with `journeys` registers and reserves: `record`, `save`, `journeys`, `edit`, `replay`, `forget`, and `capture`.                            |
| `BROWSER_RUN_ID_PATTERN`               | const     | Matches a run id containing an ISO timestamp with hyphenated time and a hexadecimal suffix.                                                                                               |

##### Journey helpers

The following fence validates, edits, renders, and compiles the `add-kettle` journey; see [Journeys](#journeys) for the journey itself. Each helper is pure; a step runs on a live view through the toolset's `follow`, which [`BrowserToolsetInterface`](#browsertoolsetinterface) shows.

```ts
import type { BrowserJourney } from '@orkestrel/browser'
import {
	isBrowserError,
	buildBrowserJourney,
	collectBrowserJourneyBindings,
	collectBrowserJourneyTextBindings,
	compileBrowserJourney,
	compileBrowserJourneyValue,
	deriveBrowserJourneySecret,
	deriveBrowserJourneyTrigger,
	editBrowserJourney,
	generateBrowserRunId,
	isBrowserSecretBinding,
	isBrowserJourneyBinding,
	isBrowserJourneyTab,
	isBrowserJourneyTarget,
	parseBrowserJourney,
	parseBrowserJourneyEdit,
	parseBrowserRun,
	renderBrowserJourney,
	renderBrowserRun,
	renderBrowserRunResult,
	resolveBrowserJourneyBinding,
	validateBrowserJourney,
	validateBrowserJourneyEdit,
	validateBrowserJourneyParameter,
	validateBrowserJourneyStep,
	validateBrowserRun,
} from '@orkestrel/browser'

const journey: BrowserJourney = {
	format: 1,
	name: 'add-kettle',
	description: 'Add the Alpine Kettle to the cart',
	parameters: { email: { default: 'sam@example.test' } },
	next: 6,
	steps: [
		{ id: 's1', action: 'navigate', arguments: { url: 'https://shop.example.test/' } },
		{ id: 's2', action: 'click', arguments: {}, target: { role: 'link', name: 'Alpine Kettle' } },
		{ id: 's3', action: 'click', arguments: {}, target: { role: 'button', name: 'Add to cart' } },
		{
			id: 's4',
			action: 'type',
			arguments: { text: { parameter: 'email' }, submit: true },
			target: { role: 'textbox', name: 'Email' },
		},
		{ id: 's5', action: 'wait', arguments: { text: 'Added to cart' } },
	],
}
validateBrowserJourney(journey) // throws STORE_FORMAT or JOURNEY_INVALID naming the invariant
validateBrowserJourneyStep(journey.steps[3])
try {
	validateBrowserJourneyParameter({ secret: true, default: 'x' })
} catch (error) {
	if (!isBrowserError(error)) throw error
	error.code // 'JOURNEY_INVALID'
}
validateBrowserJourneyEdit({ operation: 'remove', id: 's3' })
validateBrowserRun(JSON.parse(runFile)) // a run.json file's parsed text
parseBrowserJourney({ ...journey, name: 'Add kettle' }) // undefined
parseBrowserJourneyEdit({ operation: 'rename', id: 's3' }) // undefined
parseBrowserRun(JSON.parse(runFile)) // BrowserRun | undefined
buildBrowserJourney([{ id: 's1', action: 'wait', arguments: { text: 'Ready' } }], {
	name: 'check-ready',
	description: 'Check readiness',
})
isBrowserSecretBinding(journey.steps[3], journey.parameters) // false
isBrowserJourneyBinding({ parameter: 'email' }) // true
isBrowserJourneyTarget({ role: 'button', name: 'Add to cart' }) // true
isBrowserJourneyTab({ url: 'https://shop.example.test/cart', title: 'Cart' }) // true
collectBrowserJourneyBindings(journey.steps) // Map { 'email' => ['type.text'] }
resolveBrowserJourneyBinding({ parameter: 'email' }, { email: 'ada@example.test' }) // 'ada@example.test'
deriveBrowserJourneyTrigger(journey.steps[3]) // 'Email'
deriveBrowserJourneySecret('Confirm password') // 'confirmPassword'
deriveBrowserJourneySecret('Password', ['password']) // 'secret1'
const taken = collectBrowserJourneyTextBindings(journey.steps) // ['email']
deriveBrowserJourneySecret('Password', taken)
generateBrowserRunId() // a timestamp and random suffix
const edited = editBrowserJourney(journey, [
	{ operation: 'remove', id: 's3' },
	{ operation: 'add', step: { action: 'press', arguments: { key: 'Enter' } }, after: 's4' },
]) // steps s1, s2, s4, s6, s5; next 7
try {
	editBrowserJourney(journey, [
		{ operation: 'declare', name: 'coupon', parameter: { default: 'TEA10' } },
	])
} catch (error) {
	if (!isBrowserError(error)) throw error
	error.code // 'JOURNEY_EDIT'
}
renderBrowserJourney(edited) // the listing Journeys shows
renderBrowserRun(run, view) // the head line, one line per step, a blank line, and the view
renderBrowserRunResult(
	'Clicked button "Delete" [ref=e7]. A confirm dialog is open: "Delete the draft?"; call dialog.',
) // the line without '; call dialog'
compileBrowserJourneyValue(
	{ text: { parameter: 'email' }, submit: true },
	new Map([['email', 'inputs.email']]),
) // '{ text: inputs.email, submit: true }'
compileBrowserJourney(journey, { language: 'typescript' }) // { source, gaps: [] }
```

#### Errors

| API                      | Kind     | Summary                                                                        |
| ------------------------ | -------- | ------------------------------------------------------------------------------ |
| `BrowserError`           | class    | Reports a browser failure with a typed code and optional JSON context.         |
| `BrowserStepError`       | class    | Reports an incomplete journey step with its action and the code `STEP`.        |
| `BrowserErrorCode`       | type     | Identifies a browser refusal, lifecycle failure, or protocol failure.          |
| `describeBrowserRefusal` | function | Describes an element refusal, adding a fresh-reference instruction for `GONE`. |
| `isBrowserError`         | function | Checks whether a value is a browser error.                                     |
| `isBrowserStepError`     | function | Checks whether a value is a journey step error.                                |

A caught `BrowserStepError` is also a `BrowserError`; check the step guard first when the action matters. Branch on `code`, and use `context.reason` for an `ELEMENT` refusal. `describeBrowserRefusal` builds its receipt. Abort signals reject with their original `signal.reason`, so a caught value need not be a browser error.

The bare code union follows. `TOOLSET_SETTLED` and `TOOLSET_RECEIPT` are **internal** control signals; callers receive their resulting receipt. `TOOLSET_PAGE` refuses a page-only operation on another view. A replay records `JOURNEY_DIALOG` as a step refusal when no interrupted action precedes a dialog step.

```ts
type BrowserErrorCode =
	| 'ARGUMENT'
	| 'CAPTURE_UNAVAILABLE'
	| 'CAPTURE_UNTRUSTED'
	| 'CLOSED'
	| 'CONNECTION'
	| 'DISCONNECTED'
	| 'DOCUMENT'
	| 'DOCUMENT_DESTROYED'
	| 'DOCUMENT_OWN'
	| 'DOCUMENT_SUBMIT'
	| 'ELEMENT'
	| 'ELEMENT_QUERY'
	| 'HAR'
	| 'STORE_ACCESS'
	| 'JOURNEY_AMBIGUOUS'
	| 'JOURNEY_DIALOG'
	| 'JOURNEY_EDIT'
	| 'JOURNEY_EMPTY'
	| 'STORE_FILE'
	| 'STORE_FORMAT'
	| 'JOURNEY_GAP'
	| 'JOURNEY_INPUT'
	| 'JOURNEY_INVALID'
	| 'STORE_LOCKED'
	| 'JOURNEY_MISSING'
	| 'STORE_PATH'
	| 'JOURNEY_PLACEMENT'
	| 'JOURNEY_READONLY'
	| 'JOURNEY_RECORDING'
	| 'JOURNEY_SAVED'
	| 'JOURNEY_STALE'
	| 'JOURNEY_TARGET'
	| 'JSON'
	| 'NAVIGATION'
	| 'PROTOCOL'
	| 'REMOTE'
	| 'RESULT_LIMIT'
	| 'SERVER_BUSY'
	| 'SERVER_CRASH'
	| 'SERVER_ENVIRONMENT'
	| 'SERVER_EXHAUSTED'
	| 'SERVER_HOLDER'
	| 'SERVER_LAUNCH'
	| 'SERVER_SWEEP'
	| 'SERVER_TEARDOWN'
	| 'SERVER_UNAVAILABLE'
	| 'SERVER_UNRESOLVED'
	| 'STEP'
	| 'TARGET_HELD'
	| 'TIMEOUT'
	| 'TOOLSET_BUSY'
	| 'TOOLSET_CAPTURE'
	| 'TOOLSET_CONTEXT'
	| 'TOOLSET_DIALOG'
	| 'TOOLSET_LIMIT'
	| 'TOOLSET_OBSERVE'
	| 'TOOLSET_PAGE'
	| 'TOOLSET_RECEIPT'
	| 'TOOLSET_RESERVED'
	| 'TOOLSET_ROLE'
	| 'TOOLSET_SCHEME'
	| 'TOOLSET_SETTLED'
	| 'TOOLSET_TAB'
```

##### Narrow a browser error

```ts
import { BrowserError, isBrowserError, isBrowserStepError } from '@orkestrel/browser'

const error: unknown = new BrowserError('ARGUMENT', 'A positive limit is required', { limit: 0 })
isBrowserError(error) // true
isBrowserStepError(error) // false
if (isBrowserError(error)) error.code // 'ARGUMENT'
```

#### Protocol layer

| API                                      | Kind      | Summary                                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDPClient`                              | class     | Provides a lightweight Chrome DevTools Protocol client over a `CDPTransportInterface`.                                                                                                                                                                           |
| `createCDPClient`                        | function  | Creates a `CDPClientInterface` bound to the given `CDPTransportInterface`.                                                                                                                                                                                       |
| `BrowserStreamChunk`                     | interface | Represents one decoded IO stream read.                                                                                                                                                                                                                           |
| `BrowserWebSocketFrame`                  | interface | Describes a WebSocket frame payload.                                                                                                                                                                                                                             |
| `BrowserWebSocketInterface`              | interface | Represents one observed WebSocket connection.                                                                                                                                                                                                                    |
| `CDPClientInterface`                     | interface | Provides a lightweight Chrome DevTools Protocol client over a `CDPTransportInterface`.                                                                                                                                                                           |
| `CDPTarget`                              | interface | Represents one entry of the CDP `Target.getTargets` result.                                                                                                                                                                                                      |
| `CDPTransportInterface`                  | interface | Represents the text pipe a `CDPClient` sends and receives JSON-RPC frames over.                                                                                                                                                                                  |
| `CDPClientOptions`                       | interface | Describes the options for creating a `CDPClient` instance.                                                                                                                                                                                                       |
| `CDPSendOptions`                         | interface | Describes the options for one CDP method call.                                                                                                                                                                                                                   |
| `BrowserWebSocketEventMap`               | type      | Maps the WebSocket lifecycle events.                                                                                                                                                                                                                             |
| `CDPClientEventMap`                      | type      | Maps the events a `CDPClientInterface` emits.                                                                                                                                                                                                                    |
| `CDPHandler`                             | type      | Receives a subscribed CDP event with its params record.                                                                                                                                                                                                          |
| `CDPTransportEventMap`                   | type      | Maps the events emitted by a `CDPTransportInterface` — the raw text pipe a `CDPClientInterface` sends and receives JSON-RPC frames over.                                                                                                                         |
| `browserHeadersToProtocol`               | function  | Converts a header record to Fetch-domain name/value entries.                                                                                                                                                                                                     |
| `browserPDFToParams`                     | function  | Validates and compiles Page.printToPDF parameters.                                                                                                                                                                                                               |
| `browserScreenshotToParams`              | function  | Validates and compiles basic Page.captureScreenshot parameters.                                                                                                                                                                                                  |
| `compileActionabilityFunction`           | function  | Compiles the element-side actionability pass used before trusted input.                                                                                                                                                                                          |
| `compileBrowserBindingCleanup`           | function  | Compiles current-document cleanup for one page-side host binding facade.                                                                                                                                                                                         |
| `compileBrowserBindingResult`            | function  | Compiles delivery of a host binding result to one execution context.                                                                                                                                                                                             |
| `compileBrowserBindingSource`            | function  | Compiles the page-side promise facade for one Runtime binding.                                                                                                                                                                                                   |
| `compileBrowserJourney`                  | function  | Compiles a journey into a standalone module that performs each step through the `follow` method of a toolset the module constructs on the page. The module checks its inputs before any step.                                                                    |
| `compileBrowserJourneyValue`             | function  | Compiles a JSON value into the JavaScript literal a generated journey module carries.                                                                                                                                                                            |
| `compileGuardedEvaluateExpression`       | function  | Compiles a `Runtime.evaluate` expression so the in-page code stringifies its own result and throws a recognizable sentinel error before an oversized result would overflow the CDP transport frame.                                                              |
| `compileHitFunction`                     | function  | Compiles the descendant hit check for a resolved element.                                                                                                                                                                                                        |
| `compileQueryWaitExpression`             | function  | Compiles a wait woken by mutations and finished transitions and animations, with one deadline and explicit disconnect ownership.                                                                                                                                 |
| `compileReadFunction`                    | function  | Compiles the in-page function that reads the document's URL, title, and rendered HTML.                                                                                                                                                                           |
| `compileScreenshotCleanupExpression`     | function  | Compiles cleanup for temporary screenshot styles and masks.                                                                                                                                                                                                      |
| `compileScreenshotPreparationExpression` | function  | Compiles temporary animation, caret, and mask setup for a screenshot.                                                                                                                                                                                            |
| `compileSelectFunction`                  | function  | Compiles text selection or select-option assignment against the resolved element.                                                                                                                                                                                |
| `compileStorageClearExpression`          | function  | Compiles an expression that clears local and session storage.                                                                                                                                                                                                    |
| `compileStorageReadExpression`           | function  | Compiles an expression that serializes local and session storage.                                                                                                                                                                                                |
| `compileStorageRestoreExpression`        | function  | Compiles an expression that restores one origin's web storage.                                                                                                                                                                                                   |
| `compileSubmitObserverExpression`        | function  | Compiles the installation of a capture-phase `submit` observer owned by `token` on the window of the world it runs in.                                                                                                                                           |
| `compileSubmitReadExpression`            | function  | Compiles the read of the `submit` observer `compileSubmitObserverExpression` installs for `token`, preserving the observer until cleanup.                                                                                                                        |
| `compileSubmitReleaseExpression`         | function  | Compiles token-scoped cleanup of submission listeners and change observation.                                                                                                                                                                                    |
| `compileSubmitWaitExpression`            | function  | Compiles a bounded wait for the first rendered change after submission.                                                                                                                                                                                          |
| `compileTextWaitExpression`              | function  | Compiles a wait for the presence or absence of visible text, coalesced by tasks.                                                                                                                                                                                 |
| `concatBytes`                            | function  | Concatenates byte chunks without Node-specific buffers.                                                                                                                                                                                                          |
| `cookieToProtocol`                       | function  | Converts a typed cookie input into Chromium protocol fields.                                                                                                                                                                                                     |
| `keyToBrowserInput`                      | function  | Normalizes one key to CDP keyboard event data.                                                                                                                                                                                                                   |
| `mediaToFeatures`                        | function  | Converts typed media preferences to Chromium emulated media features.                                                                                                                                                                                            |
| `parseBrowserAXString`                   | function  | Coerces a string-valued Accessibility-domain AXValue to a string, or `undefined` off-shape.                                                                                                                                                                      |
| `parseBrowserBindingCall`                | function  | Coerces one Runtime binding invocation to a `BrowserBindingCall`, or `undefined` off-shape.                                                                                                                                                                      |
| `parseBrowserConsoleMessage`             | function  | Coerces one `Runtime.consoleAPICalled` event to a `BrowserConsoleMessage`, or `undefined` off-shape.                                                                                                                                                             |
| `parseBrowserCookiePartition`            | function  | Coerces an optional Chromium cookie partition key to a `BrowserCookiePartition`, or `undefined` off-shape.                                                                                                                                                       |
| `parseBrowserDownloadProgress`           | function  | Coerces one `Browser.downloadProgress` event to a `BrowserDownloadProgress`, or `undefined` off-shape.                                                                                                                                                           |
| `parseBrowserDownloadStart`              | function  | Coerces one `Browser.downloadWillBegin` event to a `BrowserDownloadStart`, or `undefined` off-shape.                                                                                                                                                             |
| `parseBrowserInvocation`                 | function  | Coerces a WebMCP `toolInvoked` event without parsing its authored input text.                                                                                                                                                                                    |
| `parseBrowserInvocationResult`           | function  | Coerces a WebMCP `toolResponded` event, preserving output and terminal status.                                                                                                                                                                                   |
| `parseBrowserJourney`                    | function  | Parses a journey without throwing when validation fails.                                                                                                                                                                                                         |
| `parseBrowserJourneyEdit`                | function  | Parses an edit without throwing when its structure fails validation.                                                                                                                                                                                             |
| `parseBrowserPageError`                  | function  | Coerces one `Runtime.exceptionThrown` event to a `BrowserPageError`, or `undefined` off-shape.                                                                                                                                                                   |
| `parseBrowserRect`                       | function  | Coerces a four-number CSS-pixel rectangle to a `BrowserRect`, or `undefined` off-shape.                                                                                                                                                                          |
| `parseBrowserReference`                  | function  | Parses the supported element-reference spellings into their canonical form.                                                                                                                                                                                      |
| `parseBrowserToolInteger`                | function  | Parses an integer or a canonical unsigned decimal string for a tool coordinate.                                                                                                                                                                                  |
| `parseBrowserRemoval`                    | function  | Coerces a WebMCP `RemovedTool` object to its document and name key.                                                                                                                                                                                              |
| `parseBrowserRequest`                    | function  | Coerces one `Network.requestWillBeSent` or `Fetch.requestPaused` event to a `BrowserRequest`, or `undefined` off-shape.                                                                                                                                          |
| `parseBrowserRequestFailure`             | function  | Coerces one `Network.loadingFailed` event to a `BrowserRequestFailure`, or `undefined` off-shape.                                                                                                                                                                |
| `parseBrowserResponse`                   | function  | Coerces one `Network.responseReceived` event to a `BrowserResponse`, or `undefined` off-shape.                                                                                                                                                                   |
| `parseBrowserResponseRecord`             | function  | Coerces one Chromium response object plus its event identity to a `BrowserResponse`, or `undefined` off-shape.                                                                                                                                                   |
| `parseBrowserRun`                        | function  | Parses a run without throwing when validation fails.                                                                                                                                                                                                             |
| `parseBrowserSecurity`                   | function  | Coerces Chromium TLS security details to a `BrowserSecurity`, or `undefined` off-shape.                                                                                                                                                                          |
| `parseBrowserTiming`                     | function  | Coerces Chromium response timing to a `BrowserTiming`, or `undefined` off-shape.                                                                                                                                                                                 |
| `parseBrowserTimingRange`                | function  | Coerces one named start/end pair of Chromium network timing to a `BrowserTimingRange`, or `undefined` off-shape.                                                                                                                                                 |
| `parseBrowserTool`                       | function  | Coerces a WebMCP `Tool` object to its browser-domain representation.                                                                                                                                                                                             |
| `parseBrowserWebSocketFrame`             | function  | Coerces one WebSocket frame event to a `BrowserWebSocketFrame`, or `undefined` off-shape.                                                                                                                                                                        |
| `parseCodegenActionPayload`              | function  | Parses a sanitized document gesture, refusing malformed or secret-bearing payloads.                                                                                                                                                                              |
| `parseNumberArray`                       | function  | Coerces an unknown value to an all-number array, or `undefined` off-shape.                                                                                                                                                                                       |
| `parseSnapshotString`                    | function  | Coerces one CDP snapshot string-table index to its string, or `undefined` off-shape.                                                                                                                                                                             |
| `readBrowserAccessibility`               | function  | Decodes Accessibility-domain nodes into a flat serializable tree, throwing a `BrowserError` off-shape.                                                                                                                                                           |
| `readBrowserAttributes`                  | function  | Decodes flattened CDP node attributes into a frozen record, skipping every off-shape pair.                                                                                                                                                                       |
| `readBrowserAXValue`                     | function  | Decodes an Accessibility-domain AXValue, or `undefined` when the record carries none.                                                                                                                                                                            |
| `readBrowserCookie`                      | function  | Decodes one Chromium cookie, throwing a `BrowserError` off-shape.                                                                                                                                                                                                |
| `readBrowserCookies`                     | function  | Decodes the cookies `Storage.getCookies` returns, throwing a `BrowserError` off-shape.                                                                                                                                                                           |
| `readBrowserCoverageRanges`              | function  | Decodes and normalizes coverage ranges, throwing a `BrowserError` off-shape.                                                                                                                                                                                     |
| `readBrowserFrames`                      | function  | Decodes a flattened CDP `Page.getFrameTree` result into depth-first frame metadata, skipping every off-shape frame, then appends each attached out-of-process iframe target the tree does not list.                                                              |
| `readBrowserHeaders`                     | function  | Decodes a Chromium Headers object into string values, skipping every entry that is neither a string nor a finite number.                                                                                                                                         |
| `readBrowserMetrics`                     | function  | Decodes Performance-domain metrics, throwing a `BrowserError` off-shape.                                                                                                                                                                                         |
| `readBrowserProfile`                     | function  | Decodes one CPU profile, throwing a `BrowserError` off-shape.                                                                                                                                                                                                    |
| `readBrowserProfileFrame`                | function  | Decodes a CPU profile call frame, throwing a `BrowserError` off-shape.                                                                                                                                                                                           |
| `readBrowserQuad`                        | function  | Decodes the first `DOM.getContentQuads` quad and its center, throwing a `BrowserError` off-shape.                                                                                                                                                                |
| `readBrowserRemoteValue`                 | function  | Decodes a Runtime remote object's printable value, falling back to its unserializable form and then its description, or `undefined` when it carries none.                                                                                                        |
| `readBrowserScriptCoverage`              | function  | Decodes JavaScript precise coverage, throwing a `BrowserError` off-shape.                                                                                                                                                                                        |
| `readBrowserScriptIdentifier`            | function  | Decodes the `Page.addScriptToEvaluateOnNewDocument` result, throwing a `BrowserError` off-shape.                                                                                                                                                                 |
| `readBrowserSnapshot`                    | function  | Decodes a CDP `DOMSnapshot.captureSnapshot` result into a serializable `BrowserSnapshotInput`, throwing a `BrowserError` off-shape and a `BrowserError` past the configured node limit.                                                                          |
| `readBrowserStack`                       | function  | Decodes a Chromium runtime stack trace, skipping every off-shape call frame.                                                                                                                                                                                     |
| `readBrowserStorageEntries`              | function  | Decodes a list of web-storage entries, throwing a `BrowserError` off-shape.                                                                                                                                                                                      |
| `readBrowserStorageOrigin`               | function  | Decodes one in-page web-storage snapshot, throwing a `BrowserError` off-shape.                                                                                                                                                                                   |
| `readBrowserStreamChunk`                 | function  | Decodes one `IO.read` response, throwing a `BrowserError` off-shape.                                                                                                                                                                                             |
| `readBrowserStyleCoverage`               | function  | Decodes CSS rule usage, throwing a `BrowserError` off-shape.                                                                                                                                                                                                     |
| `readBrowserToolString`                  | function  | Reads a required string argument from a tool call.                                                                                                                                                                                                               |
| `readBrowserWorld`                       | function  | Reads the execution context id from a CDP `Page.createIsolatedWorld` reply.                                                                                                                                                                                      |
| `readEvaluationResult`                   | function  | Decodes one CDP `Runtime.evaluate` result, throwing a `BrowserError` on a failed evaluation and a `BrowserError` past the guarded result size.                                                                                                                   |
| `readRareBooleanData`                    | function  | Decodes CDP snapshot sparse boolean data into a set of node indexes, skipping every off-shape entry.                                                                                                                                                             |
| `readRareIntegerData`                    | function  | Decodes CDP snapshot sparse integer data into a node-index map, skipping every off-shape entry.                                                                                                                                                                  |
| `readRareStringData`                     | function  | Decodes CDP snapshot sparse string data into a node-index map, skipping every off-shape entry.                                                                                                                                                                   |
| `BROWSER_CONTEXT_LOSS_PATTERN`           | const     | Matches protocol errors caused by replacement or closure of an execution context.                                                                                                                                                                                |
| `BROWSER_RESULT_LIMIT`                   | const     | Caps the serialized-character length for an `evaluate()`/`read()` result at `2_500_000`, enforced in-page before the result is returned to CDP.                                                                                                                  |
| `BROWSER_RESULT_LIMIT_PATTERN`           | const     | Matches the in-page result-limit sentinel error message, anchored immediately after the `Error:` (optionally `Uncaught Error:`) prefix Chromium prepends to a thrown error's description, `/^(?:Uncaught )?Error: \[\[ORKESTREL_BROWSER_RESULT_LIMIT\]\](\d+)/`. |
| `BROWSER_RESULT_LIMIT_SENTINEL_PREFIX`   | const     | Names the distinctive prefix for the in-page result-limit sentinel error, `'[[ORKESTREL_BROWSER_RESULT_LIMIT]]'`, immediately followed by the serialized length.                                                                                                 |

##### Protocol decoding

The following fence composes the snapshot, page recorder, and evaluation helpers around captured CDP payloads.

```ts
import {
	compileGuardedEvaluateExpression,
	isBrowserNodeQuery,
	isBrowserNodeVisible,
	matchesBrowserNode,
	parseBrowserRect,
	parseCodegenActionPayload,
	parseNumberArray,
	parseSnapshotString,
	readBrowserAttributes,
	readBrowserFrames,
	readBrowserSnapshot,
	readEvaluationResult,
	readRareBooleanData,
	readRareIntegerData,
	readRareStringData,
	requireBrowserString,
} from '@orkestrel/browser'

const guarded = compileGuardedEvaluateExpression('document.title', 3_000_000) // wrapped expression string
const gesture = parseCodegenActionPayload({}) // BrowserCodegenGesture | undefined; undefined for a password value
const value = readEvaluationResult({ result: { type: 'string', value: 'Example' } })
const title = requireBrowserString(value, 'Title')
const frames = readBrowserFrames({
	frameTree: { frame: { id: 'main', url: 'https://example.test/' } },
})
const numbers = parseNumberArray([1, 2, 3])
const snapshotStrings = ['id', 'article']
const text = parseSnapshotString(snapshotStrings, 1)
const rareStrings = readRareStringData({ index: [0], value: [1] }, snapshotStrings)
const rareBooleans = readRareBooleanData({ index: [0] })
const rareIntegers = readRareIntegerData({ index: [0], value: [1] })
const rect = parseBrowserRect([0, 0, 100, 40])
const attributes = readBrowserAttributes([0, 1], snapshotStrings)
const decoded = readBrowserSnapshot({ strings: [], documents: [] }, ['display'])
const node = decoded.documents[0]?.nodes[0]
const query = { name: 'article', visible: true }
if (node !== undefined) {
	if (isBrowserNodeQuery(query)) matchesBrowserNode(node, query)
	const rendered = isBrowserNodeVisible(node)
}
```

### Server

The server face finds Chromium installations, launches or attaches to a browser, persists artifacts, and hosts tools over MCP. Browser discovery is selected with `browsers.engine`; MCP launch options live in `browser`, capacity in `pool`, and recording policy in `journeys`.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ cdp: { port: 9222 } })
const discovery = await browser.discover()
const endpoint = discovery.endpoint
await browser.connect()
await browser.ping() // resolves when the connection responds
await browser.destroy()
```

#### Context and page

| API                               | Kind      | Summary                                                                                                                                                                                                                       |
| --------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Browser`                         | class     | Discovers, launches, connects to, and owns Chromium-family browser sessions.                                                                                                                                                  |
| `FileBrowserWriter`               | class     | Persists captured browser bytes to the filesystem through `node:fs/promises`.                                                                                                                                                 |
| `createBrowser`                   | function  | Creates a raw-CDP `BrowserInterface` façade with discovery, connection, and lifecycle management.                                                                                                                             |
| `createBrowserProfile`            | function  | Resolves a persistent caller profile or creates an isolated temporary one.                                                                                                                                                    |
| `createFileBrowserWriter`         | function  | Creates a filesystem-backed `BrowserWriterInterface` that persists bytes through `node:fs/promises`.                                                                                                                          |
| `BrowserDiscoveryResult`          | interface | Describes the result of passive browser discovery.                                                                                                                                                                            |
| `BrowserInterface`                | interface | Wraps a browser with discovery, connection management, and lifecycle control.                                                                                                                                                 |
| `BrowserProfileRecord`            | interface | Names the browser a browse profile serves, which a later start's sweep reads.                                                                                                                                                 |
| `BrowserProfileResult`            | interface | Describes the resolved browser profile directory used for a Chromium-family launch.                                                                                                                                           |
| `BrowserServerCatalog`            | interface | Describes the JSON catalog returned by the holder tools.                                                                                                                                                                      |
| `BrowserOptions`                  | interface | Describes the options for creating a `Browser` instance.                                                                                                                                                                      |
| `SystemBrowserOptions`            | interface | Describes the options overriding the candidate sources for `findSystemBrowsers`.                                                                                                                                              |
| `BrowserConnection`               | type      | Names how the browser connection was established.                                                                                                                                                                             |
| `BrowserEngine`                   | type      | Names a supported browser engine (raw CDP targets Chromium-family browsers only).                                                                                                                                             |
| `BrowserEventMap`                 | type      | Maps the events a `BrowserInterface` emits.                                                                                                                                                                                   |
| `BrowserLaunchFunction`           | type      | Creates a browser a browse server connects while warming its pool.                                                                                                                                                            |
| `BrowserStatus`                   | type      | Names the lifecycle status of a browser wrapper.                                                                                                                                                                              |
| `SystemBrowser`                   | type      | Represents one discovered browser executable on this machine.                                                                                                                                                                 |
| `browserToEngine`                 | function  | Classifies a `/json/version` `Browser` string into a `BrowserEngine` (`Edg/` → edge, `Chrome/` → chrome, else chromium).                                                                                                      |
| `buildInstallPaths`               | function  | Builds the default well-known install-path candidates for a platform, deriving Windows roots from env vars.                                                                                                                   |
| `buildStoreBases`                 | function  | Builds the default Playwright browser store base directories to search for a managed Chromium.                                                                                                                                |
| `buildWindowsRoots`               | function  | Derives Windows install roots from env vars, falling back to well-known literals when absent.                                                                                                                                 |
| `describeBrowserServerLoss`       | function  | Describes a browser loss with its code, cause, and the session state it invalidates.                                                                                                                                          |
| `findEnvOverrides`                | function  | Checks the env-override keys (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) in order and returns every one that exists.                                                                                                        |
| `findInstallPaths`                | function  | Returns every candidate path that exists on disk, in the given order.                                                                                                                                                         |
| `findStorePaths`                  | function  | Searches one store base for the top-level `chromium` link and every `chromium-*` install, highest revision first.                                                                                                             |
| `findSystemBrowsers`              | function  | Enumerates every Chrome/Chromium/Edge executable discoverable on this machine, deduplicated by normalized absolute path.                                                                                                      |
| `formatBrowserLockEntry`          | function  | Formats a process identifier and UUID token as a lock entry name.                                                                                                                                                             |
| `launchBrowserProcess`            | function  | Launches a browser process with raw-CDP debugging flags.                                                                                                                                                                      |
| `normalizeExecutablePath`         | function  | Normalizes an executable path for cross-source deduplication (case-insensitive on Windows).                                                                                                                                   |
| `probePathNames`                  | function  | Probes PATH (`which`/`where`) for every resolvable command name, in the given order.                                                                                                                                          |
| `probeProcess`                    | function  | Probes whether a process has not been confirmed absent.                                                                                                                                                                       |
| `readBrowserEndpoint`             | function  | Reads the CDP endpoint a launched browser announces on its standard error.                                                                                                                                                    |
| `readFirstLine`                   | function  | Returns the first non-empty line of a command's output, without its surrounding whitespace.                                                                                                                                   |
| `removeBrowserProfile`            | function  | Removes a library-owned isolated browser profile.                                                                                                                                                                             |
| `BROWSER_DEFAULT_HOST`            | const     | Sets the default host probed for an existing browser and used for launches, `'127.0.0.1'`, which avoids `localhost` resolving to `::1` when Chromium binds `127.0.0.1`.                                                       |
| `BROWSER_DRAIN_INTERVAL_MS`       | const     | Sets the interval in milliseconds between liveness probes of a terminated browser process group.                                                                                                                              |
| `BROWSER_ENGINE_HINTS`            | const     | Lists the case-insensitive substrings identifying an executable path/name's browser engine, checked by `parseBrowserEngine` in the order `edge` → `chromium` → `chrome`.                                                      |
| `BROWSER_ENV_PATH_KEYS`           | const     | Lists the environment variables checked, in order, for an explicit browser executable path override: `PLAYWRIGHT_EXECUTABLE_PATH`, then `CHROME_PATH`.                                                                        |
| `BROWSER_EXECUTABLE_NAMES`        | const     | Lists the command names probed on PATH when no well-known executable path exists.                                                                                                                                             |
| `BROWSER_EXECUTABLE_PATHS`        | const     | Lists the well-known Chrome/Chromium/Edge executable paths with no platform-specific root, keyed by `process.platform`, leaving `win32` empty because its roots come from `BROWSER_WINDOWS_SUFFIXES`.                         |
| `BROWSER_FILE_STORE_LIMIT`        | const     | Bounds a file-store listing page by default.                                                                                                                                                                                  |
| `BROWSER_HEADLESS_ARG`            | const     | Names the flag that enables headless mode on a launched browser process, `'--headless=new'`.                                                                                                                                  |
| `BROWSER_KILL_GRACE_MS`           | const     | Bounds each launched-process exit window during TERM-to-KILL teardown at `3_000` milliseconds.                                                                                                                                |
| `BROWSER_LAUNCH_ARGS`             | const     | Lists the flags always passed to a launched browser process, alongside the caller's own.                                                                                                                                      |
| `BROWSER_PORT_PROBE_TIMEOUT_MS`   | const     | Bounds the `discover: false` port-occupancy probe before launching at `200` milliseconds, which is short because the probe only needs to detect an already-listening CDP endpoint rather than perform full discovery.         |
| `BROWSER_PROCESS_EXIT_CAUSE`      | const     | Names the machine-readable error-context cause for an owned browser process exiting, `'process-exit'`.                                                                                                                        |
| `BROWSER_PROFILE_PREFIX`          | const     | Names the prefix for isolated browser profiles created beneath the operating-system temp directory, `'orkestrel-browser-'`.                                                                                                   |
| `BROWSER_SERVER_BUSY`             | const     | Names the refusal when every browser is admitted to a holder.                                                                                                                                                                 |
| `BROWSER_SERVER_CONTEXTS`         | const     | Sets the default context capacity per browser, including the shared holder.                                                                                                                                                   |
| `BROWSER_SERVER_CONTEXTS_LIMIT`   | const     | Limits context capacity to the largest measured per-browser count.                                                                                                                                                            |
| `BROWSER_SERVER_COPY`             | const     | Defines the holder tools independently of the shared browser's vocabulary.                                                                                                                                                    |
| `BROWSER_SERVER_CRASH`            | const     | Names the notice that a browser and its session state were lost.                                                                                                                                                              |
| `BROWSER_SERVER_EXHAUSTED`        | const     | Names the diagnostic when the warm floor spends its restart bound.                                                                                                                                                            |
| `BROWSER_SERVER_LAUNCH`           | const     | Names a failed attempt to warm a browser.                                                                                                                                                                                     |
| `BROWSER_SERVER_OPTIONS`          | const     | Names a refused browser server option.                                                                                                                                                                                        |
| `BROWSER_SERVER_POOL_LIMIT`       | const     | Limits the number of warm browsers to 3.                                                                                                                                                                                      |
| `BROWSER_SERVER_POOL_SIZE`        | const     | Sets the default number of warm browsers to 1.                                                                                                                                                                                |
| `BROWSER_SERVER_RECORD`           | const     | Names the browser process record in each profile.                                                                                                                                                                             |
| `BROWSER_SERVER_RESTARTS`         | const     | Permits one failed refill before the next failure spends the bound.                                                                                                                                                           |
| `BROWSER_SERVER_SWEEP`            | const     | Names a failed profile sweep.                                                                                                                                                                                                 |
| `BROWSER_SERVER_TEARDOWN`         | const     | Names a failed browser server teardown.                                                                                                                                                                                       |
| `BROWSER_SERVER_UNAVAILABLE`      | const     | Names the refusal when no browser can serve a call.                                                                                                                                                                           |
| `BROWSER_SERVER_UNRESOLVED`       | const     | Names an interrupted call whose outcome is unknown.                                                                                                                                                                           |
| `BROWSER_TRANSPORT_LOSS_CAUSE`    | const     | Names the machine-readable error-context cause for a CDP transport disconnecting while its browser remains alive, `'transport-loss'`.                                                                                         |
| `BROWSER_TRANSPORT_LOSS_DEFER_MS` | const     | Defers once for `50` milliseconds when a transport loss is observed on an owned process, so a near-simultaneous process-exit event, which libuv might reap slightly later than the socket close, decides the diagnosis first. |
| `BROWSER_WINDOWS_ROOT_FALLBACKS`  | const     | Lists the fallback Windows install roots used when `PROGRAMFILES`, `PROGRAMFILES(X86)`, or `LOCALAPPDATA` is absent.                                                                                                          |
| `BROWSER_WINDOWS_SUFFIXES`        | const     | Lists the Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root (`PROGRAMFILES`, `PROGRAMFILES(X86)`, `LOCALAPPDATA`).                                                          |

##### Discover and launch

| API | Kind | Summary |
| --- | ---- | ------- |

The following fence composes system-browser discovery, a launch, and the endpoint read that replaces HTTP readiness polling.

```ts
import {
	browserToEngine,
	buildInstallPaths,
	buildStoreBases,
	buildWindowsRoots,
	createBrowserProfile,
	fetchCDPTargets,
	findEnvOverrides,
	findInstallPaths,
	findStorePaths,
	findSystemBrowsers,
	launchBrowserProcess,
	normalizeExecutablePath,
	parseBrowserEngine,
	probePathNames,
	readBrowserEndpoint,
	readFirstLine,
	removeBrowserProfile,
} from '@orkestrel/browser/server'

const browsers = findSystemBrowsers() // readonly SystemBrowser[]
const found = findSystemBrowsers()[0] // SystemBrowser | undefined — first entry of findSystemBrowsers()
// findSystemBrowsers({ env: {}, paths: [], names: [], stores: [], engine: 'edge' }) — override any candidate source, narrow by engine

parseBrowserEngine('/usr/bin/msedge') // 'edge'
normalizeExecutablePath('/usr/bin/Chrome', process.platform) // string — case-folded on win32 only
browserToEngine('HeadlessChrome/120.0') // 'chrome' — classifies a /json/version Browser string
const profile = await createBrowserProfile()

// The resolution steps findSystemBrowsers composes:
const env = process.env
findEnvOverrides(env) // readonly string[] — every matching override that exists
const roots = buildWindowsRoots(env) // readonly string[] — PROGRAMFILES / PROGRAMFILES(X86) / LOCALAPPDATA
buildInstallPaths('win32', env) // readonly string[] — well-known Chrome/Edge/Chromium paths
findInstallPaths(buildInstallPaths(process.platform, env)) // readonly string[]
probePathNames(['google-chrome', 'msedge'], process.platform) // readonly string[]
readFirstLine('C:\\bin\\chrome.exe\r\nC:\\other\\chrome.exe\r\n') // 'C:\\bin\\chrome.exe' — CRLF-safe
const stores = buildStoreBases(env, process.platform) // readonly string[]
for (const store of stores) findStorePaths(store, process.platform) // readonly string[]
if (found !== undefined) {
	const child = launchBrowserProcess(found.executable, undefined, true, profile.path) // --remote-debugging-port=0
	if (child.stderr === null) throw new Error('The browser has no endpoint stream')
	const endpoint = await readBrowserEndpoint(child.stderr, AbortSignal.timeout(30_000)) // 'ws://127.0.0.1:PORT/devtools/browser/ID'
	const targets = await fetchCDPTargets(Number(new URL(endpoint).port), 5_000) // Result<readonly CDPTarget[], BrowserError>
	const browser = createBrowser({ cdp: { endpoint } })
	await browser.connect()
	browser.adopt()
	await browser.destroy()
}
await removeBrowserProfile(profile)
```

#### Toolset

| API                         | Kind      | Summary                                                                                                                                                                   |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserMCPServer`          | class     | Implements `BrowserMCPServerInterface`: serves the browser vocabulary and the journey tools over the Model Context Protocol on stdio, and warms Chromium at server start. |
| `createBrowserMCPServer`    | function  | Creates the browse server, which serves the browser vocabulary and the journey tools over the Model Context Protocol on stdio and warms Chromium at server start.         |
| `BrowserMCPServerInterface` | interface | Serves the browser vocabulary and the journey tools over MCP on stdio.                                                                                                    |
| `BrowserMCPServerOptions`   | interface | Configures the browse server.                                                                                                                                             |
| `BrowserServerToolName`     | type      | Names the server tools that manage independent browser holders.                                                                                                           |
| `BROWSER_DEVTOOLS_PATTERN`  | const     | Matches the stderr line Chromium prints when its CDP endpoint accepts connections, and captures the `ws://` endpoint the line names.                                      |
| `BROWSER_SERVER_HOLDER`     | const     | Names the refusal for an unknown or ended holder.                                                                                                                         |

#### Journeys and stores

| API                              | Kind      | Summary                                                                                                                                             |
| -------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FileBrowserJourneyStore`        | class     | Persists journeys with exclusive writes and revision counters retained across deletion.                                                             |
| `FileBrowserRunStore`            | class     | Persists runs and captures only in directories allocated by this instance.                                                                          |
| `createFileBrowserJourneyStore`  | function  | Creates a journey store over an existing filesystem root.                                                                                           |
| `createFileBrowserRunStore`      | function  | Creates a run store over an existing filesystem root.                                                                                               |
| `FileBrowserStoreOptions`        | interface | Configures a file store: its root under the checkout and the listing cap.                                                                           |
| `BROWSER_JOURNEY_LOCK_ATTEMPTS`  | const     | Bounds attempts to acquire a journey lock after concurrent recovery.                                                                                |
| `BROWSER_JOURNEY_LOCK_DIRECTORY` | const     | Names the exclusive journey write lock directory.                                                                                                   |
| `BROWSER_JOURNEY_REVISION_FILE`  | const     | Names the retained journey revision counter.                                                                                                        |
| `BROWSER_JOURNEY_SNAPSHOT_FILE`  | const     | Names the persisted journey snapshot.                                                                                                               |
| `BROWSER_RUN_DIRECTORY`          | const     | Names the journey directory holding its runs.                                                                                                       |
| `BROWSER_RUN_FILE`               | const     | Names the persisted run snapshot.                                                                                                                   |
| `BROWSER_STORE_CACHE_DIRS`       | const     | Names the per-OS default Playwright browser cache directory, relative to the home directory (win32 uses `LOCALAPPDATA` directly).                   |
| `BROWSER_STORE_DEFAULT_DIRS`     | const     | Lists the well-known Playwright browser store base directories checked in addition to `PLAYWRIGHT_BROWSERS_PATH`, starting with `/opt/pw-browsers`. |
| `BROWSER_STORE_ENV_KEY`          | const     | Names the environment variable that carries an additional Playwright browser store base directory, `'PLAYWRIGHT_BROWSERS_PATH'`.                    |
| `BROWSER_STORE_GLOBS`            | const     | Names the glob pattern (relative to a store base) matching a versioned Chromium binary, keyed by `process.platform`.                                |
| `BROWSER_STORE_LINK_NAME`        | const     | Names the top-level Chromium symlink or binary Playwright maintains inside a browser store base, `'chromium'`.                                      |

#### Protocol layer

| API                            | Kind      | Summary                                                                                                                                           |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebSocketCDPTransport`        | class     | Provides a raw CDP text transport backed by `@orkestrel/websocket`.                                                                               |
| `createWebSocketCDPTransport`  | function  | Creates a Node `WebSocket`-backed `CDPTransportInterface` for the given CDP debugger URL.                                                         |
| `BrowserCDPOptions`            | interface | Configures the CDP (Chrome DevTools Protocol) connection.                                                                                         |
| `WebSocketCDPTransportOptions` | interface | Describes the options for creating a `WebSocketCDPTransport` instance.                                                                            |
| `fetchCDPTargets`              | function  | Fetches the current CDP target list from a browser's `/json/list` endpoint, as a `Result` carrying either the targets or a coded `BrowserError`.  |
| `parseBrowserEngine`           | function  | Classifies an executable path/name into a `BrowserEngine` by case-insensitive hint, checked in the order edge → chromium → chrome.                |
| `parseBrowserLockEntry`        | function  | Parses the holder process identifier from a lock entry name.                                                                                      |
| `parseBrowserProfileRecord`    | function  | Parses a profile record naming a positive process identifier and a loopback DevTools endpoint.                                                    |
| `parseBrowserViewport`         | function  | Parses positive integer viewport dimensions in WIDTHxHEIGHT form.                                                                                 |
| `BROWSER_CDP_LIST_PATH`        | const     | Names the path appended to the CDP host to list open targets — pages, workers, and every other target category Chromium reports — `'/json/list'`. |
| `BROWSER_CDP_PROTOCOL`         | const     | Names the protocol prefix for CDP discovery requests, `'http'`.                                                                                   |
| `BROWSER_CDP_VERSION_PATH`     | const     | Names the path appended to the CDP host to fetch version metadata, `'/json/version'`, which is where endpoint discovery reads.                    |
| `BROWSER_DEFAULT_CDP_PORT`     | const     | Sets the default CDP port probed for an existing browser and used for launches, `9222`.                                                           |

##### Connect a transport and writer

The following fence builds the Node transport and the filesystem writer that `Browser` composes.

```ts
import { createFileBrowserWriter, createWebSocketCDPTransport } from '@orkestrel/browser/server'

const transport = createWebSocketCDPTransport({ url: 'ws://127.0.0.1:9222/devtools/browser/abc' })
const writer = createFileBrowserWriter()
await writer.write('shots/hero.png', new Uint8Array([137, 80, 78, 71]))
```

### Browser

The browser face supplies an untrusted DOM view. Drive a same-origin child document from a realm that survives its navigation. `createBrowserToolset(view)` is the same core factory used for pages; `isBrowserPage(view)` selects page capabilities structurally. A DOM view dispatches native DOM actions without user activation.

#### Elements and readings

| API                           | Kind      | Summary                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserDOMView`              | class     | Reads and drives a DOM document from a realm that can reach it, without trusted input.                                                                                                                                                                                                                                                                      |
| `BrowserDOMWait`              | class     | Parks one condition on DOM mutations and finished transitions and animations until it holds, with one deadline and coalesced wake tasks.                                                                                                                                                                                                                    |
| `createBrowserDOMView`        | function  | Creates a view that reads and drives a DOM document without trusted input.                                                                                                                                                                                                                                                                                  |
| `BrowserDOMElementInterface`  | interface | Provides DOM actions through a stable element reference, without trusted input.                                                                                                                                                                                                                                                                             |
| `BrowserDOMViewInterface`     | interface | Provides the document operations of a view that drives a DOM document in its own realm.                                                                                                                                                                                                                                                                     |
| `BrowserDOMWaitInterface`     | interface | Settles one wait parked on DOM mutations and finished transitions and animations.                                                                                                                                                                                                                                                                           |
| `BrowserMutationWait`         | interface | Describes one wait parked on DOM mutations and finished transitions and animations.                                                                                                                                                                                                                                                                         |
| `BrowserNameContext`          | interface | Carries the accessible-name traversal context.                                                                                                                                                                                                                                                                                                              |
| `BrowserDOMViewOptions`       | interface | Configures a view that drives one browser document.                                                                                                                                                                                                                                                                                                         |
| `collectBrowserRoots`         | function  | Collects the tree roots a wait observes under a node: the node's own root, then every open shadow root and every same-origin frame document at or beneath it, recursively.                                                                                                                                                                                  |
| `computeBrowserAlternative`   | function  | Computes the text one node contributes to an accessible name: its own text alternative, or its content.                                                                                                                                                                                                                                                     |
| `computeBrowserName`          | function  | Computes the accessible name of an element, trimmed and whitespace-collapsed.                                                                                                                                                                                                                                                                               |
| `computeBrowserRole`          | function  | Computes the ARIA role of an element from its `role` attribute or its implicit mapping.                                                                                                                                                                                                                                                                     |
| `computeBrowserText`          | function  | Computes the text an element's content contributes to an accessible name, in the flat tree, trimmed and whitespace-collapsed.                                                                                                                                                                                                                               |
| `isBrowserDocument`           | function  | Narrows a value to a `Document` attached to a window.                                                                                                                                                                                                                                                                                                       |
| `listenBrowserNavigation`     | function  | Subscribes one listener to a window's navigation events until a signal aborts.                                                                                                                                                                                                                                                                              |
| `matchesBrowserActivation`    | function  | Checks whether a click on an element activates the `label` that contains it, following the HTML label activation rule.                                                                                                                                                                                                                                      |
| `matchesBrowserBlock`         | function  | Checks whether an element starts a block of its own, the unit that separates runs of text.                                                                                                                                                                                                                                                                  |
| `matchesBrowserHidden`        | function  | Checks whether an element and its subtree are hidden from the rendered page.                                                                                                                                                                                                                                                                                |
| `matchesBrowserInvisible`     | function  | Checks whether an element renders nothing visible of its own.                                                                                                                                                                                                                                                                                               |
| `matchesBrowserOmitted`       | function  | Checks whether an element sits in an omitted subtree: the element or a flat-tree ancestor that `readBrowserParent` reaches matches `matchesBrowserHidden`, through assigned slots, shadow hosts, and the frame elements of same-origin documents.                                                                                                           |
| `matchesBrowserPopup`         | function  | Checks whether activating an element opens another browsing context.                                                                                                                                                                                                                                                                                        |
| `readBrowserBlock`            | function  | Reads the nearest block container of an element, the unit that separates runs of text.                                                                                                                                                                                                                                                                      |
| `readBrowserCapture`          | function  | Reads the URL, title, and rendered markup a DOM reading is built from, refusing a capture over the result limit before any parse.                                                                                                                                                                                                                           |
| `readBrowserContent`          | function  | Reads the untrimmed text an element's content contributes to an accessible name, in the flat tree.                                                                                                                                                                                                                                                          |
| `readBrowserParent`           | function  | Reads an element's parent in the flat tree: the slot it is assigned to in an open shadow root, its parent element, the host of the open shadow root it sits at the top of, or the frame element of its same-origin document.                                                                                                                                |
| `readBrowserStates`           | function  | Reads the pressed, expanded, and selected states the DOM outline assigns to an element's role.                                                                                                                                                                                                                                                              |
| `readBrowserToken`            | function  | Reads a lowercased ARIA token, preserving whitespace and treating empty or undefined tokens as absent.                                                                                                                                                                                                                                                      |
| `skipBrowserSubtree`          | function  | Moves a tree walker past the subtree of its current node.                                                                                                                                                                                                                                                                                                   |
| `BROWSER_CONTENT_NAMED_ROLES` | const     | Names the ARIA roles whose accessible name the accessible-name computation takes from the element's content when no attribute or label names it.                                                                                                                                                                                                            |
| `BROWSER_CONTEXT_TARGETS`     | const     | Names the link and form targets that navigate the current browsing context or one of its ancestors. `_blank` opens another browsing context, and any other name targets the browsing context carrying that name, which `matchesBrowserPopup` resolves.                                                                                                      |
| `BROWSER_DOCUMENT_TIMEOUT_MS` | const     | Sets the default `wait` deadline for DOM waits in a browser document toolset, `5_000` milliseconds.                                                                                                                                                                                                                                                         |
| `BROWSER_EXPANDED_ROLES`      | const     | Names the roles whose ARIA expansion state the DOM outline reads.                                                                                                                                                                                                                                                                                           |
| `BROWSER_IMPLICIT_ROLES`      | const     | Maps an HTML element to the ARIA role the HTML Accessibility API Mappings specification gives it when it carries no `role` attribute.                                                                                                                                                                                                                       |
| `BROWSER_INTERACTIVE_CONTENT` | const     | Selects the HTML interactive content a click inside a `label` can land on without activating the label, as the HTML interactive-content category lists it: `a` with `href`, `audio` and `video` with `controls`, `button`, `details`, `embed`, `iframe`, `img` with `usemap` or `controls`, `input` other than `hidden`, `label`, `select`, and `textarea`. |
| `BROWSER_SELECTED_ROLES`      | const     | Names the roles whose selection state the DOM outline reads.                                                                                                                                                                                                                                                                                                |
| `BROWSER_TYPED_INPUTS`        | const     | Names the `input` type states whose value an untrusted `fill` sets as typed text.                                                                                                                                                                                                                                                                           |

##### DOM helpers

The following fence reads one button the page appends to its own document.

```ts
import {
	collectBrowserRoots,
	computeBrowserAlternative,
	computeBrowserName,
	computeBrowserRole,
	computeBrowserText,
	isBrowserDocument,
	listenBrowserNavigation,
	matchesBrowserActivation,
	matchesBrowserBlock,
	matchesBrowserHidden,
	matchesBrowserInvisible,
	matchesBrowserOmitted,
	matchesBrowserPopup,
	readBrowserBlock,
	readBrowserCapture,
	readBrowserContent,
	readBrowserParent,
	skipBrowserSubtree,
} from '@orkestrel/browser/browser'

const button = document.createElement('button')
button.textContent = 'Save'
document.body.append(button)
if (isBrowserDocument(document)) {
	computeBrowserRole(button) // 'button'
	computeBrowserName(button) // 'Save'
	computeBrowserText(button) // 'Save'
	readBrowserContent(button) // the content that names the element
	computeBrowserAlternative(button.firstChild ?? button) // 'Save'
	matchesBrowserHidden(button) // false
	matchesBrowserInvisible(button) // false
	matchesBrowserOmitted(button) // false
	matchesBrowserBlock(button) // false — an inline-block box is inline
	readBrowserBlock(button, document) // the nearest block ancestor
	readBrowserParent(button) // the parent element, an assigned slot first
	readBrowserCapture(button) // { url, title, html }; throws RESULT_LIMIT past BROWSER_RESULT_LIMIT
	matchesBrowserPopup(button) // whether activating it opens another browsing context
	collectBrowserRoots(document) // the document and every open shadow root and same-origin frame document under it
	const label = button.closest('label')
	if (label !== null) matchesBrowserActivation(button, label)
	const walker = document.createTreeWalker(document.body)
	skipBrowserSubtree(walker) // the node after the current subtree, or null
	const lifetime = new AbortController()
	listenBrowserNavigation(window, () => log('navigated'), lifetime.signal)
}
```

#### Protocol layer

| API                         | Kind      | Summary                                                                  |
| --------------------------- | --------- | ------------------------------------------------------------------------ |
| `SocketCDPTransport`        | class     | Provides a raw CDP text transport over the browser's native `WebSocket`. |
| `createSocketCDPTransport`  | function  | Creates a CDP transport over the browser's native `WebSocket`.           |
| `SocketCDPTransportOptions` | interface | Configures a CDP transport over the browser's `WebSocket`.               |

## Methods

DOM submission refuses when no submit event fires or a field is invalid, naming its validation message. A prevented submit event counts as a handled submission.

Each table lists the callable members of its interface, including inherited methods. Readonly data belongs to the Surface contract. Owner-only plumbing is internal; callers use the managers and records their owner exposes.

#### `BrowserAccessibilityInterface`

| Method     | Summary                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `snapshot` | Reads the full accessibility tree, optionally pruned to the interesting nodes. |

The following example uses an instance supplied by its owner.

```ts
const tree = await page.accessibility.snapshot({ depth: 3 })
log(tree.nodes.map((node) => node.name))
```

#### `BrowserClockInterface`

| Method    | Summary                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `advance` | Moves virtual time forward by the given milliseconds, firing the timers that fall due. |
| `pause`   | Suspends virtual time so no page timer advances.                                       |
| `resume`  | Continues virtual time after a pause.                                                  |
| `start`   | Takes over the page clock, optionally seeding it with an epoch time.                   |
| `stop`    | Returns the page to the real clock, and does nothing when no clock was active.         |

The following example uses an instance supplied by its owner.

```ts
await page.clock.start(Date.parse('2026-01-01T00:00:00Z'))
await page.clock.pause()
await page.clock.advance(5_000)
await page.clock.resume()
await page.clock.stop()
```

#### `BrowserContextInterface`

Use `createBrowserContext(client, { id, viewport, writer, reference })` when supplying a connected client yourself. `proxy` and `origins` belong to `browser.isolate` and are refused by this factory. A context shares its reference allocator across its pages. `destroy` detaches locally; `close` also closes remote pages and disposes the remote context.

| Method    | Summary                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `close`   | Closes remote pages, disposes the remote browser context, and releases local resources.                                                                                                                                                                                                          |
| `create`  | Opens a page in this context.                                                                                                                                                                                                                                                                    |
| `destroy` | Releases local pages and detaches their sessions without disposing the remote browser context.                                                                                                                                                                                                   |
| `page`    | Returns one page by index, or the first page.                                                                                                                                                                                                                                                    |
| `pages`   | Returns every page in creation order.                                                                                                                                                                                                                                                            |
| `sync`    | Synchronizes pages from the given CDP targets, which the server discovers and core never fetches. Performs a destructive diff rather than an additive merge: a page whose target id is missing from `targets` is closed and dropped, and a target that is not yet tracked is attached and added. |

The following example uses an instance supplied by its owner.

```ts
const context = browser.context()
const page = await context?.create({ url: 'https://example.com' })
const all = context?.pages() // readonly BrowserPageInterface[]
await context?.sync(targets) // reconcile pages from discovered CDP targets
await context?.destroy() // local detach
```

#### `BrowserCookieManagerInterface`

| Method    | Summary                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `clear`   | Removes every cookie from the context.                                                       |
| `cookies` | Reads the context cookies, optionally narrowed to the given URLs.                            |
| `remove`  | Removes the context cookies matching the filter; an empty filter is refused with `ARGUMENT`. |
| `set`     | Writes the given cookies into the context.                                                   |

The following example uses an instance supplied by its owner.

```ts
await context.cookies.set([{ name: 'session', value: 'abc', url: 'https://example.com/' }])
log(await context.cookies.cookies(['https://example.com/']))
await context.cookies.remove({ name: 'session' })
await context.cookies.clear()
```

#### `BrowserCoverageInterface`

| Method    | Summary                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `destroy` | Stops an active collector, discarding any failure, and does nothing when no collection is running.                         |
| `start`   | Arms the requested domains. Throws a `BrowserError` when collection is already active or when neither domain is requested. |
| `stop`    | Reads the collected usage and disarms every domain it armed.                                                               |

The following example uses an instance supplied by its owner.

```ts
await page.diagnostics.coverage.start({ javascript: true, css: true })
const usage = await page.diagnostics.coverage.stop() // { scripts, styles }
await page.diagnostics.coverage.destroy()
```

#### `BrowserDiagnosticsInterface`

| Method    | Summary                                                         |
| --------- | --------------------------------------------------------------- |
| `destroy` | Tears down every diagnostics capability this page's group owns. |

The following example uses an instance supplied by its owner.

```ts
await page.diagnostics.destroy()
```

#### `BrowserDialogInterface`

| Method    | Summary                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ |
| `accept`  | Accepts the dialog, optionally supplying prompt text. Throws when the dialog is already handled. |
| `dismiss` | Dismisses the dialog. Throws when the dialog is already handled.                                 |

The following example uses an instance supplied by its owner.

```ts
page.emitter.on('dialog', async (dialog) => {
	if (dialog.category === 'prompt') await dialog.accept('Ada')
	else await dialog.dismiss()
})
```

#### `BrowserDownloadInterface`

| Method  | Summary                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abort` | Aborts the download by sending CDP `Browser.cancelDownload`, and is ignored unless the status is still pending. The status becomes `'aborted'` and the `abort` event fires. |

The following example uses an instance supplied by its owner.

```ts
page.emitter.on('download', async (download) => {
	log(download.id, download.url, download.name)
	download.emitter.on('progress', (received, total) => log(received, total))
	download.emitter.on('complete', (path) => log(path))
	download.emitter.on('abort', () => log('aborted'))
	if (!download.name.endsWith('.pdf')) await download.abort()
})
```

#### `BrowserElementInterface`

| Method   | Summary                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `click`  | Clicks the element, refusing with a coded `BrowserError` when it is gone, hidden, covered, or disabled.                                                                                                                                                                         |
| `fill`   | Replaces the value of a text control with `value`, dispatching the input events that typing fires.                                                                                                                                                                              |
| `focus`  | Moves focus to the element.                                                                                                                                                                                                                                                     |
| `read`   | Captures the element's rendered markup with its document's URL and title as a reading whose `stale` flag tracks later navigations of that document; `BrowserReadingInput` defines the rendered markup.                                                                          |
| `select` | Selects the options of a `select` element whose value or label matches `values`, dispatching `input` and `change`.                                                                                                                                                              |
| `submit` | Submits the form the element belongs to. The CDP placement focuses the element and presses Enter through a trusted key pair, sending the release even after an abort; the DOM placement calls the form's `requestSubmit()` and reports the outcome through a `submit` listener. |

The following example uses an instance supplied by its owner.

```ts
async function order(view: BrowserViewInterface): Promise<void> {
	const [size] = await view.elements.find({ role: 'combobox', name: 'Size' })
	await size?.select(['Large'])
	const [email] = await view.elements.find({ role: 'textbox', name: 'Email' })
	await email?.focus()
	await email?.fill('sam@example.test')
	const reading = await email?.read() // the element's markup with its document's URL and title
	await email?.submit()
	const [done] = await view.elements.find({ role: 'button', name: 'Done' })
	await done?.click()
}
```

#### `BrowserElementManagerInterface`

| Method     | Summary                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clear`    | Drops every reference the manager holds.                                                                                                                                                                                                         |
| `element`  | Returns the element a reference names, or `undefined` when the reference is unknown or was dropped.                                                                                                                                              |
| `elements` | Returns every element the manager holds a reference to.                                                                                                                                                                                          |
| `find`     | Returns the elements matching `query` by role, case-insensitive accessible-name substring, or CSS selector, within an optional referenced element.                                                                                               |
| `outline`  | Captures the view's document as a document-order outline, binding a reference to each interactive element and bounding the referenced rows by `limit`. The outline carries wrapped lines and names the focused referenced row even past `limit`. |
| `wait`     | Resolves with the elements matching `query` after a mutation or a finished transition or animation produces a match, or after none matches when `absent` is set; rejects at the deadline or on abort.                                            |

The following example uses an instance supplied by its owner.

```ts
const outline = await page.elements.outline({ limit: 150 }) // { url, title, lines, listed, found, focus }
log(outline.lines.map(renderBrowserLine)) // unnumbered content; toolset.read() adds line addresses
const [save] = await page.elements.find({ role: 'button', name: 'sav' }) // matches "Save"
const exact = await page.elements.find({ role: 'button', name: 'Save', exact: true }) // "Save" alone, not "save" or "Save draft"
const [email] = await page.elements.find({ css: 'input[type=email]' })
const [done] = await page.elements.wait({ role: 'status' }, { timeout: 5_000 })
await page.elements.wait({ css: '.spinner' }, { absent: true })
page.elements.element('e1') // BrowserPageElementInterface | undefined
page.elements.elements() // every element the manager holds
page.elements.clear() // drops every reference
```

#### `BrowserEmulationManagerInterface`

| Method  | Summary                                                                                  |
| ------- | ---------------------------------------------------------------------------------------- |
| `apply` | Clears the superseded overrides and applies the given ones to every page of the context. |
| `clear` | Removes every override this manager applied.                                             |

The following example uses an instance supplied by its owner.

```ts
await context.emulation.apply({ locale: 'fr-FR', offline: true, headers: { 'x-test': 'one' } })
await context.emulation.clear()
```

#### `BrowserFileChooserInterface`

| Method    | Summary                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `dismiss` | Dismisses the chooser with an empty selection. Throws when the chooser is already handled.                          |
| `upload`  | Sets the chosen files. Throws when a single-file chooser is given several, and when the chooser is already handled. |

The following example uses an instance supplied by its owner.

```ts
page.emitter.on('chooser', async (chooser) => {
	if (chooser.multiple) await chooser.upload(['one.txt', 'two.txt'])
	else await chooser.dismiss()
})
```

#### `BrowserFrameInterface`

| Method        | Summary                                                                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate`    | Evaluates an expression in the frame execution world under the result-size guard.                                                                                                                                                                                                               |
| `handle`      | Evaluates an expression by reference and returns a disposable remote object handle.                                                                                                                                                                                                             |
| `read`        | Captures the document URL, title, and rendered HTML in one size-guarded evaluation in the frame's isolated world and returns them as a reading whose `stale` flag tracks later navigations. The owning page supplies the navigation counter. `BrowserReadingInput` defines the rendered markup. |
| `send`        | Issues a raw CDP method in the frame's current target session, with a trailing `BrowserCallOptions` carrying a per-call `timeout` overriding the client-wide default and a `signal` that aborts the call.                                                                                       |
| `subscribe`   | Subscribes to a CDP event in the frame's current target session.                                                                                                                                                                                                                                |
| `title`       | Resolves the frame document title.                                                                                                                                                                                                                                                              |
| `unsubscribe` | Removes a frame-session CDP event subscription.                                                                                                                                                                                                                                                 |

The following example uses an instance supplied by its owner.

```ts
const child = await page.frame('checkout')
const title = await child?.title()
const result = await child?.evaluate('document.readyState', { timeout: 2_000 })
const reading = await child?.read() // BrowserReadingInterface
const handle = await child?.handle('document.body')
await handle?.destroy()
const onLoad = () => log('loaded')
await child?.subscribe('Page.loadEventFired', onLoad)
await child?.unsubscribe('Page.loadEventFired', onLoad)
const root = await child?.send('DOM.getDocument')
const tree = await child?.send('DOM.getDocument', { depth: 1 }, { timeout: 5_000 })
```

#### `BrowserHARManagerInterface`

| Method   | Summary                                                                        |
| -------- | ------------------------------------------------------------------------------ |
| `clear`  | Drops the recorded entries and any active replay without ending the recording. |
| `replay` | Serves matching requests from an archive instead of from the network.          |
| `start`  | Begins recording exchanges, optionally capturing response content.             |
| `stop`   | Ends recording and returns the archive, writing it when a path was given.      |

The following example uses an instance supplied by its owner.

```ts
await page.network.har.start({ content: true })
const har = await page.network.har.stop()
await page.network.har.replay(har, { fallback: false })
await page.network.har.clear()
```

#### `BrowserHandleInterface`

| Method       | Summary                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `call`       | Runs a function declaration with the handle as `this`, by value.                                |
| `destroy`    | Releases the retained remote object. Idempotent.                                                |
| `properties` | Reads every own property by value.                                                              |
| `property`   | Retains one own property as its own handle, or returns `undefined` when the property is absent. |
| `value`      | Reads the object back by value.                                                                 |

The following example uses an instance supplied by its owner.

```ts
const handle = await page.handle('document.body')
log(await handle.value())
log(await handle.call('function() { return this.tagName }'))
const dataset = await handle.property('dataset')
log(await handle.properties())
await dataset?.destroy()
await handle.destroy()
```

#### `BrowserHoldInterface`

| Method    | Summary                                            |
| --------- | -------------------------------------------------- |
| `destroy` | Releases the toolset to the calls behind the hold. |

The following example uses an instance supplied by its owner.

```ts
const hold = await toolset.hold('add-kettle', { signal })
try {
	await toolset.execute(
		{ id: '1', name: 'click', arguments: { ref: 'e4' } },
		{ signal, caller: hold.token },
	)
} finally {
	hold.destroy()
}
```

#### `BrowserJourneyStoreInterface`

Writes with no condition replace. `{ exclusive: true }` requires absence; `{ revision }` requires the saved positive safe-integer revision. `exclusive: true` with `revision` is refused with `ARGUMENT`; `exclusive: false` equals omission. A failed condition is `JOURNEY_STALE`. Memory and file backends enforce the check and write atomically. Deleting a name preserves its revision counter.

| Method   | Summary                                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delete` | Removes the journey saved under `name` and keeps its revision count, so a recreated journey continues it; a missing name is a no-op. Rejects with `STORE_LOCKED` when another write holds the name.                                                  |
| `get`    | Returns the journey saved under `name` with its revision, or `undefined` when none is saved. Rejects with `STORE_FILE` for a malformed entry, `STORE_FORMAT` for an unknown format, and `STORE_ACCESS` for a permission error, each naming the path. |
| `list`   | Returns one page of the saved journeys sorted by name, starting at `offset` and holding at most `limit` entries, with the entries it could not read in `faults`.                                                                                     |
| `set`    | Saves the journey under its name with the next revision and returns it.                                                                                                                                                                              |

The following example uses an instance supplied by its owner.

```ts
const store = createMemoryBrowserJourneyStore()
const first = await store.set(journey) // { journey, revision: 1 }
const read = await store.get('add-kettle')
if (read?.revision === undefined) throw new Error('Saved journey has no revision')
await store.set(journey, { revision: read.revision }) // { journey, revision: 2 }
try {
	await store.set(journey, { revision: 1 })
} catch (error) {
	if (isBrowserError(error)) log(error.code) // 'JOURNEY_STALE'
}
const page = await store.list({ offset: 0, limit: 20 }) // { entries, truncated: false, faults: [] }
await store.delete('add-kettle')
```

##### Journey tools

The following example uses an instance supplied by its owner.

```ts
const toolset = createBrowserToolset(page, { journeys: { store, runs, readonly: false } })
await toolset.start()
await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'add-kettle' } })
await toolset.destroy() // destroys the journey toolset first: aborts a replay and drops an unsaved recording
```

#### `BrowserKeyboardInterface`

| Method   | Summary                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `down`   | Presses one key and holds it, retaining it in the modifier mask when it is a modifier.                    |
| `insert` | Inserts composed text in one frame, firing no per-key events.                                             |
| `press`  | Presses a chord: holds its modifiers, presses and releases its terminal key, then releases the modifiers. |
| `type`   | Types a string as one press and release per character.                                                    |
| `up`     | Releases one key, dropping it from the modifier mask even when the release frame fails.                   |

The following example uses an instance supplied by its owner.

```ts
await page.keyboard.down('Shift')
await page.keyboard.up('Shift')
await page.keyboard.press('Control+Enter')
await page.keyboard.type('orkestrel', { delay: 10 })
await page.keyboard.insert('pasted text')
```

#### `BrowserMouseInterface`

| Method  | Summary                                                                                      |
| ------- | -------------------------------------------------------------------------------------------- |
| `click` | Moves to the given point, presses, optionally delays, and releases.                          |
| `down`  | Presses a button at the current point, adding it to the pressed mask.                        |
| `drag`  | Presses at the start, moves in the requested steps to the end, and releases.                 |
| `move`  | Moves the pointer to a point, carrying the pressed buttons.                                  |
| `up`    | Releases a button at the current point, dropping it from the mask even when the frame fails. |
| `wheel` | Sends a wheel delta at the current point.                                                    |

The following example uses an instance supplied by its owner.

```ts
await page.mouse.move({ x: 50, y: 20 })
await page.mouse.down('left')
await page.mouse.up('left')
await page.mouse.click({ x: 50, y: 20 }, { button: 'left', count: 2 })
await page.mouse.drag({ x: 10, y: 10 }, { x: 90, y: 90 }, { steps: 20 })
await page.mouse.wheel({ x: 0, y: -120 })
```

#### `BrowserNavigationManagerInterface`

| Method   | Summary                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`   | Resolves on the next `networkIdle` lifecycle event of the page's current loader. Rejects on timeout, and with `signal.reason` on abort.                                          |
| `record` | Opens a record of the navigations the page's frames start from this call on, for an input dispatched into `frame` next. Thrown when the page is closed: the page's closed error. |
| `wait`   | Resolves with the URL of the next navigation, same-document ones included, matching the `*` and `**` glob pattern. Rejects on timeout, and with `signal.reason` on abort.        |

The following example uses an instance supplied by its owner.

```ts
const navigated = page.navigation.wait('**/checkout')
await (await page.elements.find({ css: '#buy' }))[0]?.click()
log(await navigated)
await page.navigation.idle({ signal: AbortSignal.timeout(10_000) })
const record = page.navigation.record(page.id) // before the input the record settles
```

#### `BrowserNavigationRecordInterface`

| Method    | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destroy` | Ends the record and rejects a pending `wait` or `settle`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `settle`  | Follows the earliest navigation started after the record opened in the record's frame, one of its ancestors, or a frame `destinations` names, waiting within `timeout` for a destination to start one. Resolves with the stage reached at completion or at `timeout` and the reason `Page.frameRequestedNavigation` named for the navigation, or `undefined` when none started; a selected frame that detaches ends the wait with the stage it reached. Rejects with `signal.reason` on abort, and when the record ends or the page closes. |
| `wait`    | Resolves when the record's frame or one of its ancestors starts a navigation after the record opened; `settle` reports that navigation's reason. Rejects at `timeout` with `TIMEOUT`, with `signal.reason` on abort, and when the record ends or the page closes.                                                                                                                                                                                                                                                                           |

The following example uses an instance supplied by its owner.

```ts
const record = page.navigation.record(button.frame)
try {
	await Promise.race([record.wait({ timeout: 5_000 }), button.click()])
	const settled = await record.settle({
		destinations: [{ frame: button.frame, relationship: 'parent' }],
		timeout: 4_000,
	}) // { url, stage: 'loaded', reason: 'formSubmissionGet' }, or undefined when nothing started
} finally {
	record.destroy()
}
```

#### `BrowserNetworkManagerInterface`

`routes` is a `BrowserRouteManagerInterface`. Add, remove, and clear interception there; use `apply` for headers, offline mode, and credentials. Omitted and undefined settings stay unchanged. `clear()` resets headers, offline mode, and credentials while retaining routes.

| Method    | Summary                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| `apply`   | Applies the supplied network overrides; omitted keys retain their values.         |
| `clear`   | Clears headers, offline mode, and credentials without removing routes.            |
| `body`    | Reads one observed response body as bytes.                                        |
| `destroy` | Removes every route, unsubscribes, and disables the domains this manager enabled. |
| `json`    | Reads one observed response body as parsed JSON.                                  |
| `start`   | Enables the Network domain and subscribes to its events. Idempotent.              |
| `text`    | Reads one observed response body as text.                                         |

The following example uses an instance supplied by its owner.

```ts
await page.network.start()
page.emitter.on('response', async (response) => {
	log(await page.network.body(response.id))
	log(await page.network.text(response.id))
	log(await page.network.json(response.id))
})
const handler = (route) => route.continue()
await page.network.routes.add({ url: '**/api' }, handler)
await page.network.routes.remove(handler)
await page.network.apply({ headers: { 'x-trace': 'on' } })
await page.network.apply({ offline: true })
await page.network.apply({ credentials: { username: 'ada', password: 'secret' } })
await page.network.clear() // retains the supplied credentials
await page.network.clear() // resets headers, offline mode, and credentials
await page.network.routes.clear()
await page.network.destroy()
```

#### `BrowserPageElementInterface`

| Method       | Summary                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `click`      | Clicks the element, refusing with a coded `BrowserError` when it is gone, hidden, covered, or disabled.                                                                                                                                                                         |
| `drag`       | Drags the element onto the center of `target` with trusted pointer events.                                                                                                                                                                                                      |
| `fill`       | Replaces the value of a text control with `value`, dispatching the input events that typing fires.                                                                                                                                                                              |
| `focus`      | Moves focus to the element.                                                                                                                                                                                                                                                     |
| `hover`      | Moves the pointer onto the element with a trusted mouse event.                                                                                                                                                                                                                  |
| `press`      | Focuses the element and presses `key` through a trusted key pair, sending the release even after an abort.                                                                                                                                                                      |
| `quad`       | Resolves the element's content quad in page coordinates, composed through every frame between the element and the page.                                                                                                                                                         |
| `read`       | Captures the element's rendered markup with its document's URL and title as a reading whose `stale` flag tracks later navigations of that document; `BrowserReadingInput` defines the rendered markup.                                                                          |
| `screenshot` | Captures the page clipped to the element's box.                                                                                                                                                                                                                                 |
| `select`     | Selects the options of a `select` element whose value or label matches `values`, dispatching `input` and `change`.                                                                                                                                                              |
| `submit`     | Submits the form the element belongs to. The CDP placement focuses the element and presses Enter through a trusted key pair, sending the release even after an abort; the DOM placement calls the form's `requestSubmit()` and reports the outcome through a `submit` listener. |
| `upload`     | Sets the files of a file input to `files`, as paths the browser reads.                                                                                                                                                                                                          |

The following example uses an instance supplied by its owner.

```ts
const [size] = await page.elements.find({ role: 'combobox', name: 'Size' })
await size?.select(['Large'])
const [email] = await page.elements.find({ role: 'textbox', name: 'Email' })
await email?.focus()
await email?.fill('sam@example.test')
await email?.press('Tab')
await email?.submit() // a trusted Enter on the control
const [save] = await page.elements.find({ role: 'button', name: 'Save' })
await save?.hover()
await save?.click({ timeout: 5_000 })
const reading = await save?.read() // the element's markup with its document's URL and title
const [file] = await page.elements.find({ css: 'input[type=file]' })
await file?.upload(['./report.pdf'])
const [card, lane] = await page.elements.find({ css: '.card, .lane' })
if (card !== undefined && lane !== undefined) await card.drag(lane)
if (save !== undefined) log(renderBrowserElement(save))
const quad = await save?.quad() // page coordinates
const shot = await save?.screenshot({ format: 'png' })
```

#### `BrowserPageInterface`

A context creates and publishes its pages. The page supplies stable managers and a dormant `recorder`; start recording explicitly. `destroy` releases the local page and its managers, while `close` also requests remote target closure. Frame URL updates, connection assertions, and artifact writes are owner plumbing and have no public methods.

| Method        | Summary                                                                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `back`        | Navigates to the previous history entry, or returns the unchanged URL when none exists.                                                                                                                                                                                                         |
| `close`       | Closes the remote target and releases its resources.                                                                                                                                                                                                                                            |
| `destroy`     | Releases local resources and detaches without closing the remote target.                                                                                                                                                                                                                        |
| `evaluate`    | Evaluates an expression in the frame execution world under the result-size guard.                                                                                                                                                                                                               |
| `forward`     | Navigates to the next history entry, or returns the unchanged URL when none exists.                                                                                                                                                                                                             |
| `frame`       | Looks up a first-class frame by name or URL.                                                                                                                                                                                                                                                    |
| `frames`      | Decodes the flattened frame tree, main frame first.                                                                                                                                                                                                                                             |
| `handle`      | Evaluates an expression by reference and returns a disposable remote object handle.                                                                                                                                                                                                             |
| `navigate`    | Goes to a URL, waits for the requested load condition, and returns the final URL with its response correlation.                                                                                                                                                                                 |
| `pdf`         | Prints the page to PDF bytes, optionally persisted through the injected writer.                                                                                                                                                                                                                 |
| `read`        | Captures the document URL, title, and rendered HTML in one size-guarded evaluation in the frame's isolated world and returns them as a reading whose `stale` flag tracks later navigations. The owning page supplies the navigation counter. `BrowserReadingInput` defines the rendered markup. |
| `reload`      | Reloads the page and returns the final URL with its response correlation.                                                                                                                                                                                                                       |
| `screenshot`  | Captures PNG or JPEG bytes, optionally full-page and persisted through an injected writer.                                                                                                                                                                                                      |
| `send`        | Issues a raw CDP method in the frame's current target session, with a trailing `BrowserCallOptions` carrying a per-call `timeout` overriding the client-wide default and a `signal` that aborts the call.                                                                                       |
| `snapshot`    | Captures and decodes every attached document, shadow root, template content, layout box, and requested computed style.                                                                                                                                                                          |
| `subscribe`   | Subscribes to a CDP event in the frame's current target session.                                                                                                                                                                                                                                |
| `title`       | Resolves the frame document title.                                                                                                                                                                                                                                                              |
| `unsubscribe` | Removes a frame-session CDP event subscription.                                                                                                                                                                                                                                                 |
| `wait`        | Waits for text in the main document body’s `innerText`, or its absence with `absent`, rejecting at the deadline or on abort.                                                                                                                                                                    |

The following example uses an instance supplied by its owner.

```ts
await page.navigate('https://example.com', { condition: 'idle' })
await page.wait('Welcome', { timeout: 5_000 }) // wakes on mutations, transitionend, and animationend
const reading = await page.read()
await page.reload()
await page.back()
await page.forward()
const heading = await page.title()
const result = await page.evaluate('document.title')
const shot = await page.screenshot({ full: true, format: 'png' })
const pdf = await page.pdf({ landscape: true })
const child = await page.frame('checkout') // BrowserFrameInterface | undefined
const children = await page.frames() // readonly BrowserFrameInterface[]
const snapshot = await page.snapshot({ styles: ['display'], rects: true })
await page.close()
```

#### `BrowserPerformanceInterface`

| Method    | Summary                                                                |
| --------- | ---------------------------------------------------------------------- |
| `metrics` | Enables the domain, reads every metric, and disables the domain again. |

The following example uses an instance supplied by its owner.

```ts
const metrics = await page.diagnostics.performance.metrics()
log(metrics.map((metric) => [metric.name, metric.value]))
```

#### `BrowserPermissionManagerInterface`

| Method  | Summary                                                                        |
| ------- | ------------------------------------------------------------------------------ |
| `clear` | Removes every permission override on the context.                              |
| `deny`  | Denies each named permission, optionally for one origin, as its own CDP frame. |
| `grant` | Grants each named permission, optionally for one origin, as its own CDP frame. |

The following example uses an instance supplied by its owner.

```ts
await context.permissions.grant(['geolocation'], 'https://example.com')
await context.permissions.deny(['notifications'], 'https://example.com')
await context.permissions.clear()
```

#### `BrowserPopupManagerInterface`

| Method   | Summary                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record` | Opens a record of the popups the page opens from this call on, for an input dispatched next. Thrown when the page is closed: the page's closed error. |

#### `BrowserPopupRecordInterface`

| Method    | Summary                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destroy` | Ends the record and rejects a pending `settle`.                                                                                                                                                                                                                                                                                                                                               |
| `settle`  | Resolves at once with an empty list when no report arrived after the record opened; otherwise waits within `timeout` until as many adopted popups concluded as reports arrived, and resolves with the announced popups whose `opener` is this page, in announcement order, at that point or at `timeout`. Rejects with `signal.reason` on abort, and when the record ends or the page closes. |

The following example uses an instance supplied by its owner.

```ts
const popups = page.popups.record() // before the input
try {
	await button.click()
	const [popup] = await popups.settle({ timeout: 4_000 }) // the announced popups whose opener is page
	log(popup?.url)
} finally {
	popups.destroy()
}
```

#### `BrowserProfilerInterface`

| Method    | Summary                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| `destroy` | Stops an active profiler, discarding any failure, and does nothing when no profile is running. |
| `start`   | Begins sampling, optionally at an explicit positive integer interval in microseconds.          |
| `stop`    | Ends sampling and decodes the profile's nodes, samples, and time deltas.                       |

The following example uses an instance supplied by its owner.

```ts
await page.diagnostics.profiler.start(100)
const profile = await page.diagnostics.profiler.stop() // { start, end, nodes, samples, deltas }
await page.diagnostics.profiler.destroy()
```

#### `BrowserReadingInterface`

| Method     | Summary                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `markdown` | Returns a slice of the document rendered as Markdown. A bounded slice ends after the last line break in its window when one lies past `offset`, and at `limit` characters otherwise. |
| `text`     | Returns a slice of the document rendered as structural plain text, cut by the rule `markdown` applies.                                                                               |

The following example uses an instance supplied by its owner.

```ts
const reading = await page.read()
let slice = reading.markdown({ limit: 4_000 })
while (slice.offset + slice.text.length < slice.total && !reading.stale)
	slice = reading.markdown({ offset: slice.offset + slice.text.length, limit: 4_000 })
const whole = reading.text() // navigation and footer included
const main = reading.text({ distill: true }) // main content without navigation or footer
```

```ts
import { createBrowserReading, collectBrowserWords } from '@orkestrel/browser'

const reading = createBrowserReading({
	url: 'https://example.test/',
	title: '',
	html: '<nav>Menu</nav><main><p>Blue kettle</p></main>',
})
reading.text().text // 'Menu\nBlue kettle'
reading.text({ distill: true }).text // 'Blue kettle'
const words = [...collectBrowserWords('Blue BLUE to 12')] // ['blue']
```

#### `BrowserRecorderInterface`

`page.recorder` records document gestures and `createBrowserRecorder(toolset)` records toolset actions. Both satisfy this interface. `journey` takes `BrowserJourneyInput`; compile the returned data with `compileBrowserJourney(journey, { language })`. Page recorder bindings are installed internally, with no public attach or script method.

| Method    | Summary                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clear`   | Drops the recorded steps.                                                                                                                                                                                                                                                                                                                                                    |
| `destroy` | Stops recording and releases the recorder's listeners.                                                                                                                                                                                                                                                                                                                       |
| `journey` | Returns the recorded steps as a journey with that name and description, with its parameters derived: every secret marker declares a secret parameter named after its control's accessible name in lower camel case, such as `confirmPassword`, falling back to `secret1`, `secret2`, and so on when the derived name is invalid or taken; `next` is one past the highest id. |
| `start`   | Begins recording from the recorder's source.                                                                                                                                                                                                                                                                                                                                 |
| `steps`   | Returns the steps recorded so far.                                                                                                                                                                                                                                                                                                                                           |
| `stop`    | Stops recording and returns the recorded steps.                                                                                                                                                                                                                                                                                                                              |

The following example uses an instance supplied by its owner.

```ts
const recorder = createBrowserRecorder(toolset, { on: { step: (step) => log(step.id) } })
await recorder.start()
await toolset.tools.execute({ id: '1', name: 'click', arguments: { ref: 'e4' } })
await toolset.tools.execute({ id: '2', name: 'wait', arguments: { text: 'Order placed' } })
await recorder.stop() // s1 click button "Place order", s2 wait "Order placed"
recorder.steps() // the same steps
const journey = recorder.journey({ name: 'place-order', description: 'Place the order' })
recorder.clear()
await recorder.destroy()
```

#### `BrowserRegistryInterface`

| Method    | Summary                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `adopt`   | Projects tools as untrusted executable tools, omitting optional-purpose schemas.          |
| `destroy` | Disables every enabled session, unsubscribes, and rejects pending invocations.            |
| `execute` | Invokes a tool and awaits its terminal event; rejects on abort, invalidation, or timeout. |
| `start`   | Enables observation; returns `false` only when the protocol domain is absent.             |
| `tool`    | Finds a tool; an omitted frame prefers the main document, then registration order.        |
| `tools`   | Returns every registered tool, including shadowed frame registrations.                    |

The following example uses an instance supplied by its owner.

```ts
if (await page.registry.start()) {
	page.registry.emitter.on('change', () => log(page.registry.tools().length))
	const search = page.registry.tool('search-cars') // the main frame's registration first
	if (search !== undefined) {
		const result = await page.registry.execute(search, { make: 'Volvo' }, { timeout: 10_000 })
		log(result.status, result.output) // terminal status and untrusted page output
	}
	const tools = await page.registry.adopt() // readonly ToolInterface[]
	await page.registry.destroy()
}
```

#### `BrowserReplayInterface`

| Method    | Summary                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute` | Prepares the journey, holds the toolset, performs each step in order, and resolves with the run, which stops at the first step that did not complete. Rejects with a coded `BrowserError` at preparation, before any side effect, and on a destroyed toolset. |

The following example uses an instance supplied by its owner.

```ts
const replay = createBrowserReplay(
	toolset,
	{ journey },
	{ inputs: { email: 'ada@example.test' }, runs },
)
replay.emitter.on('step', (step) => log(step.id, step.outcome, step.result))
const run = await replay.execute({ signal: AbortSignal.timeout(60_000) })
run.outcome // 'complete', 'stopped', or 'aborted'
```

#### `BrowserRouteInterface`

| Method     | Summary                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- |
| `abort`    | Fails the request with a Chromium error reason, `'Failed'` by default.                  |
| `continue` | Lets the request proceed, optionally overriding its URL, method, headers, or post body. |
| `fulfill`  | Answers the request locally. Throws when the status is not an integer from 100 to 999.  |

The following example uses an instance supplied by its owner.

```ts
await page.network.routes.add({ url: '**/api' }, async (route) => {
	if (route.handled) return
	await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' })
})
await page.network.routes.add({ url: '**/slow' }, (route) => route.abort('TimedOut'))
await page.network.routes.add({ url: '**/pass' }, (route) => route.continue({ method: 'POST' }))
```

#### `BrowserRouteManagerInterface`

The network manager owns this manager. `remove(handler)` removes routes for that handler, and `clear()` removes all handlers.

| Method   | Summary                                         |
| -------- | ----------------------------------------------- |
| `add`    | Intercepts matching requests with this handler. |
| `clear`  | Removes every route.                            |
| `remove` | Removes every route belonging to this handler.  |

#### `BrowserRunStoreInterface`

`create(name)` always mints a new slot. `capture` writes into that slot; `write?` saves a standalone PNG when the store supports filesystem storage. Memory stores omit `write` and return `undefined` from `capture`.

| Method    | Summary                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `capture` | Writes capture bytes under the name into the run directory `create` created for the slot.                                                                                                                                                  |
| `clear`   | Removes every run and created slot of a journey and returns their count, including unsaved slots; a missing name returns zero. File stores exclude concurrent allocation with the journey lock and refuse a held lock with `STORE_LOCKED`. |
| `create`  | Mints a run id for the journey and creates its run directory exclusively.                                                                                                                                                                  |
| `delete`  | Removes the run stored under the journey name and id; a missing run is a no-op.                                                                                                                                                            |
| `get`     | Returns the run stored under the journey name and id, or `undefined` when none is stored.                                                                                                                                                  |
| `list`    | Returns one page of the journey's runs, starting at `offset` and holding at most `limit` entries, with the entries it could not read in `faults`.                                                                                          |
| `set`     | Writes the run under the journey name and the run id it carries.                                                                                                                                                                           |
| `write`   | Saves a standalone PNG under the runs root without replacing an existing file.                                                                                                                                                             |

The following example uses an instance supplied by its owner.

```ts
const runs = createMemoryBrowserRunStore()
const slot = await runs.create('add-kettle') // a freshly minted id
await runs.capture(slot, 's2.png', bytes) // undefined in memory; 's2.png' in a file store
await runs.set({ ...run, id: slot.id })
await runs.get('add-kettle', slot.id) // the run
await runs.list('add-kettle', { limit: 10 }) // { entries, truncated, faults }
await runs.delete('add-kettle', slot.id)
```

#### `BrowserScriptManagerInterface`

| Method    | Summary                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `add`     | Installs a script evaluated on every new document, and returns its identifier. |
| `destroy` | Removes every installed script and binding this manager owns.                  |
| `expose`  | Binds a host function to a page-global name, callable from page JavaScript.    |
| `remove`  | Removes one installed script by identifier.                                    |
| `revoke`  | Removes one exposed binding and its installed bridge script.                   |

The following example uses an instance supplied by its owner.

```ts
const id = await page.scripts.add('window.__seeded = true')
await page.scripts.expose('add', (a, b) => Number(a) + Number(b))
log(await page.evaluate('add(1, 2)'))
await page.scripts.revoke('add')
await page.scripts.remove(id)
await page.scripts.destroy()
```

#### `BrowserSnapshotInterface`

`depth` and `breadth` traverse from an optional root. `documents` and `styles` serialize as plain data, and `createBrowserSnapshot` restores navigation over them.

| Method        | Summary                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ancestors`   | Returns the ancestors of a node, nearest first, across document and iframe boundaries.                                                                              |
| `breadth`     | Traverses the capture or a subtree breadth-first, yielding its root first.                                                                                          |
| `children`    | Returns the direct children of a node, entering a linked iframe's content document.                                                                                 |
| `closest`     | Returns the nearest match from a node through its ancestors, testing the node first.                                                                                |
| `common`      | Returns the nearest common ancestor of two nodes, counting each node as its own candidate.                                                                          |
| `depth`       | Traverses the whole capture, or one subtree when `root` is given and yielded first, in depth-first order. Visits each node exactly once.                            |
| `descendants` | Traverses one node's subtree in depth-first order, excluding the node itself.                                                                                       |
| `distance`    | Returns the structural edge count between two nodes, or `undefined` when they share no ancestor.                                                                    |
| `document`    | Resolves the captured document a node belongs to.                                                                                                                   |
| `filter`      | Returns every matching node, bounded by an optional `limit`; a negative or fractional limit throws a coded `BrowserError`.                                          |
| `find`        | Returns the first node matching a `BrowserNodeQuery` or a `BrowserNodePredicate`.                                                                                   |
| `parent`      | Returns the structural parent of a node, crossing a document boundary to the owning iframe.                                                                         |
| `path`        | Returns a deterministic frame-qualified structural path for one node.                                                                                               |
| `siblings`    | Returns the structural siblings of a node; `'preceding'` or `'following'` narrows to one side, and omitting the relation returns every sibling but the node itself. |

The following example uses an instance supplied by its owner.

```ts
import type { BrowserSnapshotInput } from '@orkestrel/browser'
import { createBrowserSnapshot, matchesBrowserNode } from '@orkestrel/browser'

const captured = await page.snapshot({ styles: ['display'], rects: true })
const stored: BrowserSnapshotInput = JSON.parse(JSON.stringify(captured)) // { documents, styles }
const snapshot = createBrowserSnapshot(stored) // navigable again, same data

const main = snapshot.find({ name: 'main', visible: true }) // declarative query
const heading = snapshot.find((node) => node.name === 'H1') // predicate
const clickable = snapshot.filter({ clickable: true }, 20) // first 20 matches

if (main !== undefined && heading !== undefined) {
	snapshot.document(main)?.url // the document holding a node
	snapshot.children(main) // direct children, entering iframe content
	snapshot.parent(heading) // structural parent, iframe owner included
	snapshot.siblings(heading, 'preceding') // one structural side
	snapshot.ancestors(heading) // nearest-first, across frames
	snapshot.common(main, heading) // nearest shared ancestor
	snapshot.distance(main, heading) // structural edge count
	snapshot.closest(heading, { name: 'section' }) // self, then ancestors
	snapshot.path(heading) // frame("frame-main") > #document:0 > html:1 > ...

	const perLevel = [...snapshot.breadth({ root: main })]
	const links = [...snapshot.descendants(main)].filter((node) =>
		matchesBrowserNode(node, { name: 'a', visible: true }),
	) // subtree search: descendants + matchesBrowserNode
}
```

#### `BrowserStorageManagerInterface`

| Method     | Summary                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `clear`    | Drops the storage of one origin, or of every origin when given none.    |
| `restore`  | Writes a previously read state back into the context.                   |
| `snapshot` | Reads the context cookies and the per-origin local and session storage. |

The following example uses an instance supplied by its owner.

```ts
const state = await context.storage.snapshot({ origins: ['https://example.com'] })
await context.storage.restore(state)
await context.storage.clear('https://example.com')
```

#### `BrowserToolSourceInterface`

| Method  | Summary                                                                                      |
| ------- | -------------------------------------------------------------------------------------------- |
| `adopt` | Projects the page's current tools as executable tools.                                       |
| `tools` | Lists the registered tools, from which a toolset decides the `schema` and `debugging` skips. |

The following example uses an instance supplied by its owner.

```ts
source.emitter.on('change', async () => {
	const tools = await source.adopt() // readonly ToolInterface[]
	const census = source.tools?.() // readonly BrowserTool[] | undefined
	log(tools.length, census?.length)
})
```

#### `BrowserToolsetInterface`

One factory accepts any `BrowserViewInterface`. Page capabilities follow the structural `isBrowserPage` guard. The caller owns the view and destroys it after the toolset. `execute` returns the tool result with an optional action; `follow` resolves a semantic journey step and raises `BrowserStepError` when it cannot complete. A hold reserves actions for its caller token until destroyed.

| Method     | Summary                                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destroy`  | Stops following the view, rejects queued actions, and removes every tool the toolset added that the manager still holds. The caller retains ownership of the view. A second call returns the first call's promise.                                                                                                               |
| `execute`  | Performs a tool call and returns its structured action when a handler ran.                                                                                                                                                                                                                                                       |
| `follow`   | Performs one recorded step on the current view through `execute` and returns its action.                                                                                                                                                                                                                                         |
| `hold`     | Takes a queue turn and reserves action admission from the call for the returned caller token.                                                                                                                                                                                                                                    |
| `read`     | Renders a fresh page window, including pending move notes, within the requested limit.                                                                                                                                                                                                                                           |
| `describe` | Describes a missing reference using its last shown role and name, or the unknown-reference refusal.                                                                                                                                                                                                                              |
| `redact`   | Redacts registered secrets from unnumbered text before composing a result.                                                                                                                                                                                                                                                       |
| `start`    | Adds the tools, follows the view, and adopts the page's tools; concurrent calls share one startup. Rejects with a coded `BrowserError` and adds nothing when the manager holds a reserved name under a tool the toolset did not add, and rejects with `the browser session ended` when `destroy()` runs before startup finishes. |
| `tabs`     | Lists the open tabs of the toolset's context in the order the `read` header lists them.                                                                                                                                                                                                                                          |

The following example uses an instance supplied by its owner.

```ts
const toolset = createBrowserToolset(page, { context, limit: 4_000 }) // context: BrowserContextInterface
toolset.emitter.on('skip', (name, reason) => log(name, reason)) // 'reserved' | 'held' | 'pattern' | 'schema' | 'debugging'
await toolset.start()
const window = await toolset.read({ from: 1, search: 'cart' })
const result = await toolset.tools.execute({
	id: '1',
	name: 'read',
	arguments: { from: 1, search: 'cart' },
})
toolset.redact('Unnumbered status') // redacts any registered secrets
toolset.describe('e99') // missing-reference text, with the last shown role and name when available
const performed = await toolset.execute({ id: '2', name: 'click', arguments: { ref: 'e4' } })
performed.action // the action, when this call performed one
const hold = await toolset.hold('add-kettle') // waits for its queue turn
await toolset.tools.execute({ id: '3', name: 'click', arguments: { ref: 'e4' } }) // { success: false, error: 'The toolset is replaying add-kettle until it finishes; call read.' }
await toolset.execute(
	{ id: '4', name: 'click', arguments: { ref: 'e4' } },
	{ signal, caller: hold.token },
) // admitted
hold.destroy() // emits release
const action = await toolset.follow('s2', {
	action: 'click',
	arguments: {},
	target: { role: 'link', name: 'Alpine Kettle' },
}) // BrowserAction { action: 'click', outcome: 'done', receipt: 'Clicked link "Alpine Kettle" [ref=e12].', … }
try {
	await toolset.follow('s5', { action: 'wait', arguments: { text: 'Added to cart' } })
} catch (error) {
	if (isBrowserStepError(error)) log(error.action.outcome, error.message) // 'timeout', 's5: "Added to cart" did not appear within 5 s.'
}
await toolset.destroy() // removes the tools it added; the page stays open
```

#### `BrowserTouchInterface`

| Method | Summary                                                                                 |
| ------ | --------------------------------------------------------------------------------------- |
| `tap`  | Dispatches a touch start at the point and a touch end, cancelling the touch on failure. |

The following example uses an instance supplied by its owner.

```ts
await page.touch.tap({ x: 120, y: 240 })
```

#### `BrowserTracingInterface`

| Method    | Summary                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| `destroy` | Stops an active trace, discarding any failure, and does nothing when no trace is running.         |
| `start`   | Begins tracing with the given categories. Throws a `BrowserError` when a trace is already active. |
| `stop`    | Ends tracing, drains the IO stream, and writes it through the page writer when a path was set.    |

The following example uses an instance supplied by its owner.

```ts
await page.diagnostics.tracing.start({ screenshots: true })
const trace = await page.diagnostics.tracing.stop() // { bytes, path }
await page.diagnostics.tracing.destroy()
```

#### `BrowserTransitionInterface`

| Method    | Summary                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `execute` | Starts the work when nothing is in flight, and otherwise joins the running transition and returns its result. |

The following example uses an instance supplied by its owner.

```ts
import { BrowserTransition } from '@orkestrel/browser'

const starting = new BrowserTransition()
await starting.execute(() => transport.start())
const joined = starting.pending // the in-flight promise, or undefined
```

#### `BrowserViewInterface`

| Method       | Summary                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`       | Captures the document URL, title, and rendered markup as a reading whose `stale` flag tracks later navigations; `BrowserReadingInput` defines the rendered markup.                               |
| `screenshot` | Captures PNG or JPEG bytes of the view.                                                                                                                                                          |
| `title`      | Resolves the document title.                                                                                                                                                                     |
| `wait`       | Resolves when the main document body’s `innerText` contains `text`, or lacks it with `absent`; rejects with a `BrowserError` coded `TIMEOUT` at the deadline, and with `signal.reason` on abort. |

The following example uses an instance supplied by its owner.

```ts
async function summarize(view: BrowserViewInterface): Promise<string> {
	await view.wait('Order placed', { timeout: 5_000 })
	const reading = await view.read()
	return `${await view.title()}: ${reading.markdown({ limit: 200 }).text}`
}
```

#### `BrowserWorkerInterface`

| Method     | Summary                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| `close`    | Closes the worker target, tolerating a worker that already terminated. Idempotent. |
| `destroy`  | Stops driving the worker locally without closing its target.                       |
| `evaluate` | Evaluates a guarded expression in the worker and returns its value.                |
| `send`     | Issues one CDP method call on the worker's session.                                |

The following example uses an instance supplied by its owner.

```ts
page.emitter.on('worker', async (worker) => {
	log(await worker.evaluate('self.location.href'))
	await worker.send('Runtime.enable')
	worker.destroy()
	await worker.close()
})
```

#### `BrowserWriterInterface`

| Method  | Summary                                                                         |
| ------- | ------------------------------------------------------------------------------- |
| `write` | Persists the captured bytes to the given path, creating its parent directories. |

The following example uses an instance supplied by its owner.

```ts
import { FileBrowserWriter } from '@orkestrel/browser/server'

const writer = new FileBrowserWriter()
await writer.write('shots/hero.png', new Uint8Array([137, 80, 78, 71]))
```

#### `CDPClientInterface`

| Method        | Summary                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `close`       | Tears down the transport and rejects every pending request.                                                                                                                                                                                     |
| `connect`     | Starts the transport and begins dispatching. Idempotent.                                                                                                                                                                                        |
| `reconnect`   | Closes the transport and re-establishes it.                                                                                                                                                                                                     |
| `send`        | Issues a CDP method call with optional params and a trailing `CDPSendOptions` carrying the `session` to scope it to, a per-call `timeout` overriding the client-wide default, and a `signal` that aborts the call; rejects on timeout or abort. |
| `subscribe`   | Registers a handler for a CDP event, optionally session-scoped.                                                                                                                                                                                 |
| `unsubscribe` | Removes a handler for a CDP event, optionally session-scoped.                                                                                                                                                                                   |

The following example uses an instance supplied by its owner.

```ts
import { createCDPClient } from '@orkestrel/browser'

const client = createCDPClient({ transport })
await client.connect()
const targets = await client.send('Target.getTargets')
const version = await client.send('Browser.getVersion', undefined, {
	signal: AbortSignal.timeout(2_000),
})
const onCreated = (params) => log(params)
client.subscribe('Target.targetCreated', onCreated)
client.unsubscribe('Target.targetCreated', onCreated)
await client.reconnect()
await client.close()
```

#### `CDPTransportInterface`

| Method  | Summary                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `close` | Closes the underlying connection and releases its resources.                                                                                                        |
| `send`  | Writes one raw text frame to the connection. Throws a coded `BrowserError` carrying the transport `url` when called before the connection opens or after it closes. |
| `start` | Opens the underlying connection.                                                                                                                                    |

The following example uses an instance supplied by its owner.

```ts
transport.emitter.on('message', (data) => log(data))
await transport.start()
await transport.send('{"id":1,"method":"Target.getTargets"}')
await transport.close()
```

#### `BrowserInterface`

| Method       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adopt`      | Assumes responsibility for terminating the connected browser.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `close`      | Shuts the remote browser down: sends CDP `Browser.close` best-effort whether attached or owned, and for an owned browser also awaits the exit of the process serving the CDP endpoint plus its POSIX process-group drain, escalating to a kill only where needed. Then closes every tracked context and page, sending remote `Target.closeTarget` and `disposeBrowserContext` whatever the ownership, before releasing the CDP client. This is the way to shut down a browser the instance does not own and still wants terminated.                                                                                 |
| `connect`    | Establishes a connection through the endpoint, then discovery, then a launch. Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `context`    | Returns one context by index, or the first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `contexts`   | Returns every context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `create`     | Opens a page in the default context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `destroy`    | Releases local resources. A launched browser has the process serving its CDP endpoint terminated and its exit awaited — on POSIX that terminate reaches the launch's whole process group and awaits its drain, and on Windows it terminates one process by identifier, the spawned process or the one a launcher handed the endpoint to — which leaves the profile unlocked before cleanup. An adopted attachment is sent CDP `Browser.close`. An attached browser that this instance neither launched nor adopted is detached locally and nothing more, because other clients might share its targets. Idempotent. |
| `disconnect` | Detaches the client-side transport while the remote browser keeps running. An attached CDP session that this instance neither launched nor adopted forgets the endpoint and its ownership becomes `undefined`. A launched or explicitly adopted session retains ownership and its endpoint, so the same instance can reconnect and stays responsible for eventual termination. Transport loss while an owned browser remains alive is resumable the same way.                                                                                                                                                       |
| `discover`   | Probes CDP passively, changing no connection state and neither launching nor attaching, and emits a `discover` event with the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `isolate`    | Creates and registers an isolated CDP context with validated proxy, download, origin, and emulation options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ping`       | Sends CDP `Browser.getVersion` and resolves when the browser answers, changing no state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The following example uses an instance supplied by its owner.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ profile: './profile', cdp: { port: 9222 } })
browser.emitter.on('connect', (mode) => log(mode))
await browser.connect()
const owned = browser.owned // true for a launch; false for an attachment
const page = await browser.create({ url: 'https://example.com' })
const isolated = await browser.isolate({ emulation: { locale: 'en-US' } })
const all = browser.contexts() // readonly BrowserContextInterface[]
const pid = browser.pid // number | undefined — the process serving the CDP endpoint, when this instance owns one
await browser.disconnect() // retains ownership and endpoint for this persistent launch
await browser.connect() // reconnect the same owner
await isolated.close()
await browser.destroy() // terminates and awaits the owned process
```

#### `BrowserMCPServerInterface`

| Method    | Summary                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destroy` | Stops admission, tears down every browser, its toolset, and its profile, then rechecks the folders it answers for.                                                                                                                                                                                                                                                                |
| `start`   | Serves stdio, sweeps the profiles ended servers left, warms the pool, and resolves after the shared holder consumes a prepared context on a warm browser; the legacy handshake and every tool call await the same setup. Rejects with `BROWSER_SERVER_UNAVAILABLE` when no browser can serve and with `CLOSED` after `destroy()`, and resolves when `destroy()` interrupts setup. |

The following example uses an instance supplied by its owner.

```ts
import { createBrowserMCPServer } from '@orkestrel/browser/server'

const server = createBrowserMCPServer({
	root: 'tmp/browsers',
	browser: { headless: true },
	journeys: { readonly: false },
})
await server.start() // resolves after the first warm browser is leased; tools/list answers meanwhile
await server.destroy() // aborts a replay, destroys every browser it launched, and removes each profile
```

#### `BrowserDOMElementInterface`

This interface inherits the element operations without adding a method. DOM actions are untrusted and cannot grant user activation.

| Method   | Summary                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `click`  | Clicks the element, refusing with a coded `BrowserError` when it is gone, hidden, covered, or disabled.                                                                                                                                                                         |
| `fill`   | Replaces the value of a text control with `value`, dispatching the input events that typing fires.                                                                                                                                                                              |
| `focus`  | Moves focus to the element.                                                                                                                                                                                                                                                     |
| `read`   | Captures the element's rendered markup with its document's URL and title as a reading whose `stale` flag tracks later navigations of that document; `BrowserReadingInput` defines the rendered markup.                                                                          |
| `select` | Selects the options of a `select` element whose value or label matches `values`, dispatching `input` and `change`.                                                                                                                                                              |
| `submit` | Submits the form the element belongs to. The CDP placement focuses the element and presses Enter through a trusted key pair, sending the release even after an abort; the DOM placement calls the form's `requestSubmit()` and reports the outcome through a `submit` listener. |

#### `BrowserDOMViewInterface`

The owner supplies a same-origin document from a surviving realm. `trusted` is `false`; the view provides no screenshot or page-output emitter. Destroy the toolset first, then the view.

| Method       | Summary                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `destroy`    | Releases the navigation listeners and every element reference.                                                                                                                                   |
| `read`       | Captures the document URL, title, and rendered markup as a reading whose `stale` flag tracks later navigations; `BrowserReadingInput` defines the rendered markup.                               |
| `screenshot` | Captures PNG or JPEG bytes of the view.                                                                                                                                                          |
| `title`      | Resolves the document title.                                                                                                                                                                     |
| `wait`       | Resolves when the main document body’s `innerText` contains `text`, or lacks it with `absent`; rejects with a `BrowserError` coded `TIMEOUT` at the deadline, and with `signal.reason` on abort. |

The following example uses an instance supplied by its owner.

```ts
const driven = frame.contentDocument
if (driven === null) throw new Error('The frame has no accessible document')
const view = createBrowserDOMView({ document: driven })
log(await view.title())
await view.wait('Saved', { timeout: 2_000 }) // wakes on mutations, load, transitionend, and animationend
const reading = await view.read()
view.destroy()
```

#### `BrowserDOMWaitInterface`

| Method    | Summary                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `execute` | Resolves the first value the check returns other than `undefined`, then releases every observer, the deadline timer, and every listener. |

The following example uses an instance supplied by its owner.

```ts
const driven = frame.contentDocument
if (driven === null) throw new Error('The frame has no accessible document')
const wait = new BrowserDOMWait({
	roots: () => collectBrowserRoots(driven),
	check: () => driven.querySelector('[role=status]') ?? undefined,
	timeout: 5_000,
	start: performance.now(),
	subject: 'Status wait',
})
const status = await wait.execute()
```

## Toolset vocabulary

This section holds the words a model reads: the tools a toolset advertises and the receipts they return. `BROWSER_TOOL_COPY` is the source of every name, parameter, annotation, and description in it.

### Tools

A page-backed toolset advertises `read`, `click`, `type`, `press`, `navigate`, and `wait`, stages `dialog` while a dialog is open, and advertises `switch` with `context`. A view-backed toolset advertises `read`, `click`, `type`, and `wait`. With `journeys`, either placement adds `record`, `save`, `journeys`, `edit`, `replay`, `forget`, and `capture`. Every tool except `journeys` declares at least one required parameter. The removed `look`, `plain`, and `tabs` names are not aliases; the browse server refuses them as unknown tools unless an adopted page tool takes the name. The following table lists the advertised descriptions.

| Tool       | Parameters                                                                                                                                                                  | Annotations                                                                      | Placements                                            | Description                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `read`     | `from` (integer, required), `to` (integer, inclusive), `search` (string, optional)                                                                                          | `pure`, `untrusted`                                                              | CDP and DOM                                           | `Shows numbered lines of the page, with references like e4 to act on. Call it to learn a fact or to find an element.` |
| `click`    | `ref` (string, required)                                                                                                                                                    | none                                                                             | CDP and DOM                                           | `Clicks the referenced element, settles its action, and returns the page.`                                            |
| `type`     | `ref` (string, required), `text` (string, required), `submit` (boolean, true to submit its form after typing), `secret` (boolean, true to keep the text out of the receipt) | none                                                                             | CDP and DOM                                           | `Focuses a field such as a search box and types into it, optionally submits its form, and returns the page.`          |
| `press`    | `key` (string, required)                                                                                                                                                    | none                                                                             | CDP                                                   | `Presses a key or chord, settles its action, and returns the page.`                                                   |
| `navigate` | `url` (string, required)                                                                                                                                                    | none                                                                             | CDP                                                   | `Opens an absolute web address in the current tab and returns the loaded page.`                                       |
| `wait`     | `text` (string, required), `absent` (boolean, true to wait until the text is gone), `timeout` (integer seconds, default 5, at most 30)                                      | `pure`                                                                           | CDP and DOM                                           | `Waits for text to appear or leave, then returns the page.`                                                           |
| `dialog`   | `accept` (boolean, required), `text` (string)                                                                                                                               | none                                                                             | CDP, staged while a dialog opens                      | `Answers the open dialog, settles the interrupted action, and returns the page.`                                      |
| `switch`   | `tab` (string, required)                                                                                                                                                    | none                                                                             | CDP, with `context`                                   | `Selects an open tab that read lists and returns its page.`                                                           |
| `record`   | `journey` (string, required)                                                                                                                                                | none                                                                             | CDP and DOM, with `journeys`                          | `Starts recording your next actions as a journey with that name; call save when it is done.`                          |
| `save`     | `description` (string, required)                                                                                                                                            | none                                                                             | CDP and DOM, with `journeys`                          | `Stops recording and saves the journey; describe what it achieves in one sentence.`                                   |
| `journeys` | `search` (string, optional), `from` (integer, optional, default 1), `to` (integer, inclusive)                                                                               | `pure`, `untrusted`                                                              | CDP and DOM, with `journeys`                          | `Shows saved journeys as numbered lines.`                                                                             |
| `edit`     | `journey` (string, optional, default: the only saved journey), `edits` (`anyOf`: array of `BrowserJourneyEditRequest` or a JSON string of that array, required)             | none                                                                             | CDP and DOM, with `journeys`                          | `Changes a saved journey: add, remove, or update steps by their ids from journeys, or declare a parameter.`           |
| `replay`   | `journey` (string, required), `inputs` (object of strings)                                                                                                                  | none                                                                             | CDP and DOM, with `journeys`                          | `Replays a saved journey step by step; give each parameter's value under inputs.`                                     |
| `capture`  | `full` (boolean, required)                                                                                                                                                  | none                                                                             | CDP and DOM, with `journeys`; requires a trusted view | `Saves the current view as a PNG in the runs directory and returns its path.`                                         |
| `forget`   | `journey` (string, required)                                                                                                                                                | none                                                                             | CDP and DOM, with `journeys`                          | `Removes a saved journey and all its runs; the name is free to record again.`                                         |
| page tools | the page's input schema, plus a required `purpose` string when that schema requires nothing                                                                                 | `untrusted` always; `pure` from `readOnly`; `consequential` from `consequential` | CDP through the registry, DOM through a source        | the page's own description, advertised as authored under `untrusted`                                                  |

`type.text` is described as `The text to type or the option to choose.`

A call to one of the preceding tools that carries a parameter the tool does not advertise is refused before the tool's handler runs, with a `BrowserError` coded `ARGUMENT` whose message is the receipt: `The read tool takes no ref parameter; call read with from, to, and search.` `validateBrowserToolArguments` performs that check; a page tool's arguments are the page's to check.

A text `wait` reads the main document body’s `innerText`; child-frame and shadow-root-owned text don’t count. Offscreen `content-visibility: auto` text can be absent from this reading; `read` can list shadow-root-owned text that never counts here. With `absent: true`, removal, `display: none`, and hidden visibility satisfy the wait. Opacity 0, off-screen positioning, and `aria-hidden` don’t remove text from this reading. In Chromium 154.0.4258.53, a closed `details` body and `hidden="until-found"` text are absent; opening the `details` includes its body. Finished transitions and animations wake both wait engines, including element waits, without a polling timer.

An absent wait succeeds at its first check if the text was never present. Record an appearance wait before dismissal to prove the text was there. A misspelled string, an outline token such as `expanded=true`, or shadow-root-owned text shown by `read` can otherwise pass at once without checking the intended exit. A timeout isn’t recorded, and replay and a generated module stop at it.

The `capture` tool returns only the saved image's absolute path. Set `full` to `true` for the full page or `false` for the viewport. It requires a trusted view with screenshot support and a runs store with `snapshot`; otherwise it refuses with `CAPTURE_UNTRUSTED` or `CAPTURE_UNAVAILABLE`. A held replay refuses it with `TOOLSET_BUSY`. It remains available with read-only journeys, like replay artifacts, and creates no journey or replay record.

### Receipts

Known elements render as `ROLE "NAME" [ref=REF]`, or `ROLE [ref=REF]` without a name. A refusal with a captured element uses `Element ROLE "NAME" [ref=REF]`; one that knows only the reference uses `Element [ref=REF]`, as when the reference is gone or not in view. Token examples such as `e4` are argument values. Every page row retains its `N: ` prefix. Search scores text spans, never reference tokens.

When rows remain after a read or action window, the second header line says `This read shows lines A–B of T; lines B+1–T are not shown yet.` With one remaining row it says `line T is not shown yet.` The renderer reserves that line before fitting whole rows; the footer still names the first omitted line.

`renderBrowserWindow` enables that line through its `partial` boolean, which defaults to `false`. Passage and receipt windows enable it; custom headers do not enable it by their text. A soft wrap breaks earlier in an element's name so its reference stays with the end of that name.

A window does not end on a heading while more page rows follow it. If the last fitting row is a heading, the window ends before it and the next read opens at that heading. The partial-view line and footer both reflect this boundary. A one-row window and a window reaching the page's end keep their heading.

When search misses the requested range, the reply keeps that window. It selects the first page-wide best match before checking for an element reference. If that line has no reference, the reply keeps the plain miss, `No line from F on matches "Q".`; it does not choose a different matching element line. If that line carries at least one element reference, the reply reports `No line from F on matches "Q"; the best match is line M:`, followed by the complete numbered row M. Equal best scores select the first line. The query is abbreviated to 120 UTF-16 units. An unquoted miss sentence appears after the last row, immediately before the footer, with its words unchanged. Its line is reserved before fitting the rows. A best-match sentence with its quoted row and an in-range hit remain under the header. The miss sentence is reserved with the minimum window. If the sentence and the complete quoted row cannot fit, the sentence ends `the best match is line M.` and the quoted row is omitted; that unquoted sentence appears immediately before the footer. A limit that cannot hold the sentence and minimum window is refused. When `to` ends before the last page line, both miss sentences use `from F to T`; otherwise they retain their wording, including `No line matches "Q".` for a page-wide miss from line 1. An in-range hit keeps its match row.

The `read` tool captures numbered accessibility lines, with a header `page "TITLE" URL (TOTAL lines)` and an exact range footer. `from` is a required positive safe integer; omitting it returns `Read requires an integer from, an optional integer to, and optional search text.` The `journeys` tool keeps optional `from` with default 1. For both tools, `to` is optional and inclusive. Both tools accept canonical whole-number decimal strings for `from` and `to`: `"7"` becomes 7, while `"7a"`, `"1.5"`, `"-1"`, `""`, and `"07"` return the existing argument refusal. A window returns at most `BROWSER_READ_LINES` lines and ends earlier when the next whole row would exceed the result limit. A `to` beyond the end is clamped to the page end; the line and character bounds still apply. Reversed ranges, fractional coordinates, and a `from` beyond a nonempty page refuse with `ARGUMENT`. An empty page has no line 0.

Search is optional and combines with the range. It scores text spans, including link destinations, but excludes reference tokens and generated syntax. Words have at least 3 letters or digits and match without case. A prefix matches when the shorter word has at least 4 UTF-16 code units; there is no in-word match or stemming. Only the highest-scoring lines appear in the match list, capped at `BROWSER_READ_MATCHES` line numbers. The window opens one line before the first match without crossing `from`; a miss opens at `from`. A range miss reports the first page-wide best match and its complete row only when that line carries an element reference. A text-only best match keeps the plain range miss; a page-wide miss reports that no line matches.

Every read and receipt window recaptures the page. On the same document, an unchanged projection keeps its line numbers and references. A read from any line, including line 1, that encounters a changed projection carries `The page changed since the last view; line numbers might differ.` and serves fresh lines at the requested range. Follow the footer's `from` line to continue. Line numbers are not element references; actions take references such as `e4`.

The projection includes headings, link destinations, list markers, table rows, named images, and exposed control values. Same-origin links show path, query, and fragment; other links show their absolute address. The projection excludes hidden content. It redacts raw names and values before normalization, wrapping, and numbering, including raw, JSON-escaped, and whitespace-normalized forms of registered typed secrets. Titles, addresses, receipts, notes, errors, and journey content are also redacted before budgeting; numbered windows and footers are never re-redacted. Chromium's exposed password mask is retained. Rows wrap at `BROWSER_READ_WIDTH` UTF-16 units before numbering; a hard continuation starts with `↳` and joins without a space, preserving Unicode code points.

Outline rows append `pressed`, `expanded`, and `selected` only when the state is present, including `false`. The DOM placement reads selection from an explicit ARIA token or native option selectedness; it omits selection on unannotated tabs, treeitems, and ARIA options inside their containers. On Edge 154.0.4258.53, CDP reports `selected=false` for an unannotated tab outside a tablist. That structure is invalid ARIA, and the DOM placement doesn’t emulate its selection default. On the same browser, CDP renders a native `<summary>` as a `DisclosureTriangle` row with `expanded=false` when its details element is closed; the DOM placement omits the summary row. A `treeitem` outside a tree becomes `generic` without these states in CDP; the DOM placement keeps its `treeitem` row with authored expansion and selection. These are declared row-format differences. Consecutive text nodes under one block or owner join in both placements; text inside a named referenced owner is omitted. Joining never crosses blocks, and a label remains separate from its control. Browser accessibility-tree structure can still differ from DOM structure, as the invalid ARIA and summary cases above show.

Every complete browser or journey tool result and error message fits the smaller of the configured `limit` and `BROWSER_TOOL_LIMIT`, including status, header, rows, and footer. The renderer budgets host notes, metadata, and footers before selecting whole rows. The MCP text block has the same bound as a backstop. The `acquire` and `tools` catalog JSON is outside this tool-result bound. A limit too small for the header, footer, and next whole row refuses with `TOOLSET_LIMIT`.

An action receipt starts with its status and a fresh window from line 1, or a bounded capture-failure note. A successful appearance `wait` finds its text in the whitespace-normalized, concatenated text of consecutive projection lines and opens at the first line of that match; otherwise it opens at line 1. Hard-token continuations join without a space. An absent wait or a timeout opens at line 1. With several tabs, the header includes tab ids and titles within its room, marks the current tab if included, and counts omitted tabs.

In the page placement, a handled submission settles before its receipt captures the page. The DOM placement has no rendered-change observer and does not wait for that settle. A detected change reports `the page handled the submission and changed`. With no detected change before the settle deadline, it reports `the page handled the submission and has not changed yet; do not submit again; call read or wait for the text you expect`. Never repeat a submission to obtain its result. Read the receipt before deciding whether another observation is needed. The settlement and cleanup are described under `BrowserToolsetInterface`.

In the following table, `URL` is an address, `REF` an element reference, `ROLE` and `NAME` its accessible role and name, `TITLE` a document title, `TEXT` the supplied text, `KEY` a key or chord, `MESSAGE` a dialog message, and `FRAME` a frame id. `START`, `END`, and `TOTAL` are line coordinates for addressed windows and character coordinates only for an unaddressed cut. `NEXT` is the next line, `BELOW` the remaining lines, and `REASON` a clause without a directive or final period.

| Situation                                                                                                                  | Text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A heading row, an element row, and a text row                                                                              | `# NAME`, `ROLE "NAME" [ref=REF]` with `value="…"`, `pressed=true\|false\|mixed`, `expanded=true\|false`, `selected=true\|false`, `[checked]`, `[disabled]`, or `[tool=NAME]` after it, in that order, and the text itself                                                                                                                                                                                                                                                                  |
| A page header                                                                                                              | `page "TITLE" URL (TOTAL lines)`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A page continuation                                                                                                        | `[lines START–END of TOTAL; BELOW below; call read with from NEXT for more]`                                                                                                                                                                                                                                                                                                                                                                                                                |
| A whole page                                                                                                               | `[lines 1–7 of 7; the whole page]`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The final window                                                                                                           | `[lines 48–52 of 52; 47 above; end of page]`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| An empty page                                                                                                              | `[empty page; the whole page]`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A journey continuation                                                                                                     | `[lines START–END of TOTAL; BELOW below; call journeys with from NEXT for more]`                                                                                                                                                                                                                                                                                                                                                                                                            |
| Insufficient window room, coded `TOOLSET_LIMIT`                                                                            | `The result limit cannot hold the header, footer, and next complete line.`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A click                                                                                                                    | `Clicked button "Place order" [ref=e4].`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A click on an element whose role is in `BROWSER_TYPED_ROLES`                                                               | `Clicked searchbox "Search products" [ref=e35]; call type with e35 to enter text.`                                                                                                                                                                                                                                                                                                                                                                                                          |
| A click in the DOM placement                                                                                               | `Clicked button "Save" [ref=e1]. (untrusted event)`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Text typed through `type`                                                                                                  | `Typed "TEXT" into ROLE "NAME" [ref=REF].`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `type` with `submit` whose form navigates, followed by the destination's view                                              | `Typed "Grace Hopper" into textbox "Name" [ref=e3] and submitted the form.`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| An option chosen through `type`                                                                                            | `Selected "Large" in combobox "Size" [ref=e2] (programmatic).`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `type` on an element whose role is not in `BROWSER_TYPED_ROLES`, with fields in view                                       | `Element link "Checkout" [ref=e15] takes no text; to type, use textbox "Full name" [ref=e19].` Multiple fields join with `or` in view order, each as `ROLE "NAME" [ref=eN]`.                                                                                                                                                                                                                                                                                                                |
| `type` on an element whose role is not in `BROWSER_TYPED_ROLES`, without fields in view                                    | `Element button "Add to cart" [ref=e16] takes no text; call click for a button.`                                                                                                                                                                                                                                                                                                                                                                                                            |
| A key pressed through `press`                                                                                              | `Pressed KEY.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A key pressed through `press` that leaves focus on a referenced element                                                    | `Pressed KEY; focus is on ROLE "NAME" [ref=REF].`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A page opened through `navigate`                                                                                           | `Navigated to URL.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Text `wait` found, and text it did not find within its timeout; with `absent`, text that is gone, and text that stayed     | `"TEXT" is on the page.`, `"Order placed" did not appear within 5 s.`, `"TEXT" is not on the page.`, and `"Saved to drafts" is still on the page after 5 s.`                                                                                                                                                                                                                                                                                                                                |
| A tab `switch` moved to, and a tab that is not open                                                                        | `Switched to t2 URL.` and `Tab "t9" is not open; call read.`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A dialog that opened during the action                                                                                     | `Clicked button "Delete" [ref=e7]. A confirm dialog is open: "MESSAGE"; call dialog.`                                                                                                                                                                                                                                                                                                                                                                                                       |
| A dialog `dialog` handled                                                                                                  | `Accepted the confirm dialog "MESSAGE".` or `Dismissed the confirm dialog "MESSAGE".`                                                                                                                                                                                                                                                                                                                                                                                                       |
| A hold requested while an earlier input remains pending and no dialog is open, coded `TOOLSET_DIALOG`                      | `BROWSER_TOOL_PENDING_NOTE`: `An earlier input is still pending; call read.`                                                                                                                                                                                                                                                                                                                                                                                                                |
| The note before a result when the view moved to a popup, and when its tab closed                                           | `The view moved to a new tab: URL.` and `The tab URL closed; the view returned to URL.`                                                                                                                                                                                                                                                                                                                                                                                                     |
| A settlement that ended `committed`: the navigation committed and has not loaded                                           | `Clicked link "Next" [ref=e3]; the page is still loading URL.`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A settlement that ended `requested`: the navigation was requested and not committed                                        | `Clicked link "Next" [ref=e3]; it requested URL and the page did not change.`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `type` with `submit` whose Enter no form received                                                                          | `Typed "Ada Lovelace" into textbox "Name" [ref=e3] and pressed Enter; no form received the submission.`                                                                                                                                                                                                                                                                                                                                                                                     |
| `press` of Enter in an `input` a form owns that no form received                                                           | `Pressed Enter; no form received the submission.`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| An action whose input document could not be observed, coded `TOOLSET_OBSERVE`                                              | `The action was not sent: frame FRAME, which receives the input, could not be observed for a form submission; call read.`                                                                                                                                                                                                                                                                                                                                                                   |
| The note in place of the view when a capture and its one retry both meet a page change                                     | `(The page changed before the view could be read; call read.)`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A reference the page no longer holds                                                                                       | `Element [ref=e12] is gone because the page changed; call read for fresh refs.`                                                                                                                                                                                                                                                                                                                                                                                                             |
| A shown reference whose element is gone                                                                                    | `Element e4 (searchbox "Search products") is not on this page; use a reference from the latest result.`                                                                                                                                                                                                                                                                                                                                                                                     |
| A reference that never appeared in a result                                                                                | `Element [ref=e99] is not in the current view; call read for fresh refs.`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Any other element refusal                                                                                                  | `Element textbox "Email" [ref=e2] is not editable.`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A parameter the tool does not advertise                                                                                    | `The read tool takes no ref parameter; call read with from, to, and search.`                                                                                                                                                                                                                                                                                                                                                                                                                |
| Any other result or error message cut at the limit                                                                         | `[characters 0–END of TOTAL; the rest was cut]`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A tool called after `destroy()`                                                                                            | `the browser session ended`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Text typed through `type` with `secret`                                                                                    | `Typed a secret into textbox "Password" [ref=e33].`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| An action from a caller without the hold's token, or `forget`, while a replay holds the toolset, coded `TOOLSET_BUSY`      | `The toolset is replaying add-kettle until it finishes; call read.`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `forget`                                                                                                                   | `Forgot add-kettle and its 2 runs; the name is free to record again.` (`1 run` when singular)                                                                                                                                                                                                                                                                                                                                                                                               |
| `forget` refused: missing journey                                                                                          | `No journey is named "add-kettle"; call journeys.`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `forget` refused: the name is recording                                                                                    | `Journey "add-kettle" is recording; call save first, or record another name.`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `forget` refused: a held lock                                                                                              | `Journey add-kettle is locked; call forget again.`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `forget` refused: a store failure                                                                                          | `Forgetting add-kettle failed: REASON; call forget again.`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `record`, followed by the view                                                                                             | `Recording add-kettle; each action you take is a step; call save when it is done.`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `record` refused: an invalid name, a saved name, and a recording in progress                                               | `"Add kettle" is not a journey name; use lowercase words joined by hyphens, such as add-kettle.`, `Journey "add-kettle" is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.`, and `add-kettle is recording; call save before you record another.`                                                                                                                                                      |
| `record`, `save`, `edit`, or `forget` under `journeys.readonly`                                                            | `The journeys are read-only; call replay.`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `save`, followed by the listing                                                                                            | `Saved add-kettle with 5 steps.`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `save` refused: nothing recording, a failed write, and a held lock                                                         | `No journey is recording, so nothing can be saved; answer the user. A journey holds only the actions after record, so call record before them.`, `Saving add-kettle failed: REASON; call save again.`, and `Journey add-kettle is locked; call save again.`                                                                                                                                                                                                                                 |
| `save` refused after a save in this session                                                                                | `Nothing is recording, so there is nothing to save; "add-kettle" is already saved. Answer the user.`                                                                                                                                                                                                                                                                                                                                                                                        |
| `save` refused for an empty recording                                                                                      | `Nothing is recorded for add-kettle yet, and it is still recording. Click and type the flow's steps now, then call save.`                                                                                                                                                                                                                                                                                                                                                                   |
| `record` refused for the same empty recording                                                                              | `add-kettle is already recording and has no steps yet. Click and type the flow's steps now, then call save.`                                                                                                                                                                                                                                                                                                                                                                                |
| `record` refused for the same recording with steps                                                                         | `add-kettle is already recording with 1 step; call save when the flow is done.` or `add-kettle is already recording with 2 steps; call save when the flow is done.`                                                                                                                                                                                                                                                                                                                         |
| `edit` refused without `journey`, when several journeys are saved                                                          | `Edit requires journey, one of "add-kettle", "place-order"; call edit with that name beside edits.`                                                                                                                                                                                                                                                                                                                                                                                         |
| `edit` refused without `journey`, when no journey is saved                                                                 | `No journey is saved, so there is nothing to edit; call record to start one.`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `edit` refused with a non-string `journey`                                                                                 | `The journey parameter must be a string.`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `journeys` with nothing saved                                                                                              | `No journeys are saved; call record to start one.`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A malformed `edits` or `inputs` argument, coded `ARGUMENT`                                                                 | `The edits parameter must be an array or a JSON string of the array.` and `The inputs parameter must be an object of strings.`                                                                                                                                                                                                                                                                                                                                                              |
| An `edits` string that does not parse                                                                                      | `The edits parameter is not valid JSON: REASON; pass an array or a JSON string of the array.`; REASON is the JSON parser's error, such as `Unexpected end of JSON input`.                                                                                                                                                                                                                                                                                                                   |
| `edit`, followed by the listing                                                                                            | `Edited add-kettle.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `edit` refused: an unknown journey, an invalid edit, a stale revision, a held lock, and a reference the view does not hold | `No journey is named "checkout"; call journeys.`, `Edit 2 is refused: it REASON; call journeys.`, `Journey add-kettle changed since you read it; call journeys, then edit again.`, `Journey add-kettle is locked; call edit again.`, `Editing add-kettle failed: REASON; call edit again.`, and `Element [ref=e9] is not in the current view; call read for fresh refs.`                                                                                                                    |
| An edit with no object or operation                                                                                        | `Edit 1 is refused: it has no edit object with an "operation" field; call journeys.` and `Edit 1 is refused: it names no operation among add, update, remove, and declare; call journeys.`                                                                                                                                                                                                                                                                                                  |
| An edit with an unknown or non-JSON field                                                                                  | `Edit 1 is refused: its "OPERATION" carries an unknown field "FIELD"; call journeys.` and `Edit 1 is refused: its "OPERATION" has non-JSON content in "FIELD"; call journeys.`                                                                                                                                                                                                                                                                                                              |
| An added step with malformed anchors                                                                                       | `Edit 1 is refused: its "add" carries both "before" and "after"; call journeys.` and `Edit 1 is refused: its "add" has no step id in "FIELD"; call journeys.`, where FIELD is before or after.                                                                                                                                                                                                                                                                                              |
| An added step with a malformed shape or supplied id                                                                        | `Edit 1 is refused: its "add" has an invalid "step": REASON; call journeys.` and `Edit 1 is refused: its "add" supplies "step.id", which is assigned automatically; call journeys.`                                                                                                                                                                                                                                                                                                         |
| A removal or update without a step id                                                                                      | `Edit 1 is refused: its "remove" names no step in "id"; call journeys.` and `Edit 1 is refused: its "update" names no step in "id"; call journeys.`                                                                                                                                                                                                                                                                                                                                         |
| An update with malformed fields                                                                                            | `Edit 1 is refused: its "update" has no object in "arguments"; call journeys.`, `Edit 1 is refused: its "update" has an invalid "target"; call journeys.`, and `Edit 1 is refused: its "update" has an invalid "tab"; call journeys.`                                                                                                                                                                                                                                                       |
| A declaration with malformed fields                                                                                        | `Edit 1 is refused: its "declare" has no "name"; call journeys.`, `Edit 1 is refused: its "declare" has an invalid "name"; call journeys.`, and `Edit 1 is refused: its "declare" has an invalid "parameter": REASON; call journeys.`                                                                                                                                                                                                                                                       |
| An edit batch whose result has no step                                                                                     | `Edit 2 is refused: it removes the last step; call journeys.`; the index names the removal that emptied the journey.                                                                                                                                                                                                                                                                                                                                                                        |
| `replay` refused at preparation                                                                                            | `Journey add-kettle needs the input "email"; call replay with inputs.`, `Journey add-kettle has no parameter named "emial"; call journeys.`, `Journey add-kettle has a gap at s4 (REASON); call edit to remove or replace s4.`, `Journey add-kettle cannot run here: s3 switch needs a browser context; call journeys.`, `Journey add-kettle cannot run here: s3 press is not available in a page toolset; call journeys.`, and `Journey add-kettle cannot be read: REASON; call journeys.` |
| `replay` refused while a journey records, and while another replay holds the toolset                                       | `Journey add-kettle is recording; call save before you replay another.` and `The toolset is replaying add-kettle until it finishes; call read.`                                                                                                                                                                                                                                                                                                                                             |
| A replay's head line: complete, stopped, and aborted                                                                       | `Replayed add-kettle: 5 of 5 steps.`, `Replay of add-kettle stopped at s3 of 5: REASON.`, and `Replay of add-kettle aborted at s3 of 5.`                                                                                                                                                                                                                                                                                                                                                    |
| A replay whose start page fails to load or uses a refused scheme                                                           | `Replay of NAME stopped before s1 of N: its start page URL did not load: REASON.`, where `REASON` is the navigation failure text.                                                                                                                                                                                                                                                                                                                                                           |
| A replayed step's target that several elements carry, and that none carries                                                | `Step s3 names button "Delete", which 2 elements carry; call edit to remove or replace s3.` and `Step s3 names button "Add to cart", which no element carries; call edit to remove or replace s3.`                                                                                                                                                                                                                                                                                          |

## Journeys

When a step dismisses a message or closes a panel, follow it with a `wait` with `absent` set to `true` for its text, so the journey keeps the exit check.

The vocabulary case in [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) bounds compact JSON containing each tool’s name, description, and input schema at 3,400 UTF-16 code units for the journey tools plus `type.secret`, and at 6,100 for the full list. These are character bounds, not token counts.

A journey is one user intent kept as JSON: a `name`, a one-sentence `description`, the `parameters` it takes, the `next` step number, and `steps` that mirror the toolset's own tool calls. An acting step names its element by role and exact accessible name, the way a receipt names it, and keeps the record-time `reference` and a `css` selector only as evidence a developer reads when a resolution is refused; replay never reads either. A `switch` step names its tab by URL and title. A model records, lists, edits, replays, and forgets journeys through the journey tools; a developer compiles the same steps into a module. `validateBrowserJourney` asserts these invariants, and [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) gives each one a failing case:

1. `name` matches `BROWSER_JOURNEY_NAME_PATTERN`: lowercase words joined by hyphens, at most 64 characters, and none of the reserved device names `con`, `prn`, `aux`, `nul`, `com1` to `com9`, and `lpt1` to `lpt9`.
2. A journey has at least one step. Step ids are unique, each is `s` followed by a number below `next`, and an added step takes `next` and increments it, so a removed id is never reused.
3. A native action carries `target` exactly when it takes `ref`, and `tab` exactly for `switch`; its `arguments` never carry `ref` or `tab`.
4. Every binding names a declared parameter, and every declared parameter is bound by at least one step.
5. A secret parameter binds `type.text` only and has no default.
6. A journey survives `JSON.stringify` and `parseBrowserJourney` unchanged.
7. A step's action is `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, an adopted page tool, or `unresolved`; `read` and the journey tools are never steps.

### Record a journey

The journey file keeps `format: 1` and accepts an optional string `start`. The toolset recorder captures the URL of the view the first recorded step acts in, before the action can navigate or open a popup. `save` redacts the URL through the toolset before storage. A first step on an `about:` page, such as `about:blank` or an `srcdoc` document's `about:srcdoc`, stores no `start`. An older file without `start` remains valid. Edits retain `start`, including removal of s1, and the run retains it in its journey snapshot.

A recorder has three sources, and each one produces the same steps.

- The toolset's actions: `createBrowserRecorder(toolset)`, which the `record` and `save` tools drive, turns each completed action into a step; see [`BrowserRecorderInterface`](#browserrecorderinterface).
- A person's gestures on a page: `page.recorder` turns each gesture into a step; see [`BrowserRecorderInterface`](#browserrecorderinterface).
- A hand-written `journey.json` file or a `BrowserJourney` literal, which `validateBrowserJourney` checks.

A recording never keeps an observation, a refused or timed-out call, a prompt or its answer, a raw event, a cookie, storage, or a secret's value. The toolset recorder uses gaps only for a child frame, a held replay, or an unanswered interruption. The recorder keeps every action that completed, so a model's recording keeps its detours too. Review the listing `journeys` returns before replaying; see [Edit a saved journey](#edit-a-saved-journey) for removing a cart visit.

### Parameters and secrets

A parameter is text whose name matches `BROWSER_JOURNEY_PARAMETER_PATTERN`. A native action's string argument binds one as `{ "parameter": "email" }`: `type.text`, `navigate.url`, `press.key`, `wait.text`, `dialog.text`, and a target's `name` can bind, while a page tool's arguments stay the literal JSON the call sent. A `type` action with `secret`, or a person's typing into a password control, records a secret parameter named after its control's accessible name in lower camel case, such as `confirmPassword`, falling back to `secret1`, `secret2`, and so on; a secret binds `type.text` only, has no default, and makes its step secret by derivation. The value reaches the page and never reaches `journey.json`, `run.json`, the listing, the run render, a receipt, a `BrowserAction`, a capture's name, or a generated module. A run of a journey with a secret parameter records no page output and no captures, because a page can republish the value; the toolset redacts registered typed secrets from the view a receipt carries.

### The listing

When `start` is present, the header places `starts at URL` before the parameters and abbreviates the URL to the same 160-character limit as `read`. For example, the numbered header is `1: place-order "Place an order" starts at http://127.0.0.1:60325/ (parameters: buyer)`.

`BrowserJourneyOptions.limit` defaults to the owner’s `limit`, including when you construct `BrowserJourneyToolset` directly. `BrowserStoreFault` carries the entry’s `name` and a path-free `reason`; `renderBrowserJourneyFault` renders those fields as `NAME cannot be read: REASON`. The `journeys` tool deduplicates faults by name. It defaults `from` to 1 and accepts inclusive `to` and optional `search`. It shares the coordinate parser with `read`. The listing, `save`, and `edit` share global line coordinates, so a footer naming `journeys` resumes at the next line of the complete listing.

`renderBrowserJourney` renders the unnumbered content that `save`, `journeys`, and `edit` wrap in numbered windows: the head line with the parameters, one line per step, a binding as `as NAME`, a secret as `(secret)` in place of its text, a `wait` with `absent` as `, absent` after its text and binding, and never a reference. The following fence shows the listing of `add-kettle`.

```ts
renderBrowserJourney(journey)
// add-kettle "Add the Alpine Kettle to the cart" (parameters: email)
// s1 navigate https://shop.example.test/
// s2 click link "Alpine Kettle"
// s3 click button "Add to cart"
// s4 type "sam@example.test" as email into textbox "Email", submit
// s5 wait "Added to cart"
```

### Forget a journey

`forget` removes the saved journey and all its runs, including unsaved run slots and captures. Its receipt counts the removed slots. It keeps the revision counter, so `record` can reuse the name and the next `save` advances the revision. It refuses a missing name, the name being recorded, an active replay, read-only journeys, or a held lock. Runs are cleared before the journey is deleted, so a failed run removal leaves the saved name available for a retry.

### Replay a journey

When a journey carries `start` and the current tab is on another URL, replay navigates the tab there before resolving s1 and waits for the same load settlement as `navigate`; a tab already on `start` replays in place, so the page's state survives. The toolset's `schemes` option applies. A refused or unsettled start stops before s1, persists a stopped run with no executed steps, and retains the navigation's failure text. Without `start`, replay begins on the current page.

`replay` replays a saved journey as it was recorded, or with `inputs` that replace the parameters' defaults; a parameter without a default, a secret included, needs an input. See [`BrowserReplayInterface`](#browserreplayinterface) for the four stages. The replay resolves each target on the live page by role and exact name, refuses a name that several elements carry or that none carries, and stops at the first step that did not complete, so a step never acts on an element the journey did not name.

A replay writes one `BrowserRun` through its run store: the journey and its revision, the inputs without a secret's value, one `BrowserRunStep` per step executed with its `trigger`, arguments, outcome, receipt, and capture, the `console` and `error` output of a trusted view that declares `emitter`, and the outcome `complete`, `stopped`, or `aborted`. The `replay` tool bounds the run outcome and then captures a page window in the remaining room. When that room cannot hold a window, it returns `(Call read to see the page.)`. The following fence calls `renderBrowserRun` with a numbered view and shows its unbounded render for a complete `add-kettle` run with the input `ada@example.test`.

```ts
renderBrowserRun(run, view)
// Replayed add-kettle: 5 of 5 steps.
// s1 Navigated to https://shop.example.test/.
// s2 Clicked link "Alpine Kettle" [ref=e12].
// s3 Clicked button "Add to cart" [ref=e31].
// s4 Typed "ada@example.test" into textbox "Email" [ref=e33] and submitted the form.
// s5 "Added to cart" is on the page.
//
// page "Cart" https://shop.example.test/cart (5 lines)
// 1: link "Catalogue" [ref=e40] /
// 2: link "Cart" [ref=e41] /cart
// 3: link "Checkout" [ref=e42] /checkout
// 4: # Your cart
// 5: Alpine Kettle
// [lines 1–5 of 5; the whole page]
```

### Two artifacts

The same steps reach two artifacts, and each one is usable without the other. The journey file is the model's artifact: `journeys` lists it, `edit` changes it, and `replay` runs it. The module is the developer's artifact: `compileBrowserJourney` emits a standalone module that imports only `@orkestrel/browser` and runs one `follow` call per step on a toolset the module constructs, so each step runs with the toolset's observers, settlement, dialogs, popups, and receipts, and reaches the page outcome a replay of the same journey reaches. A developer customizes the module by editing a step's target or arguments, inserting page calls between steps, or replacing a step. See [Generate a module from a journey](#generate-a-module-from-a-journey) for the module.

### Where journeys live

A file store keeps its entries under a root that exists before the store is constructed; the constructor resolves it through `realpath` and throws `STORE_PATH` naming the root when it is missing. Every path the store touches lies under the root, and a symbolic link at any component refuses with `STORE_PATH`; the stores guard against a link present when they check a path, not one a writer with access to the root swaps in between the check and the use. The `browse` binary uses the root `tmp/browsers` under its working directory and creates it. The following table lists what the root holds.

| Path                           | Holds                                                                                                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROOT/.profiles/<pid>-<uuid>/` | browser profiles created exclusively for eager pool slots; slot teardown removes them, the startup sweep handles exited owners, and the shutdown recheck retries recorded folders while retaining live, unreadable, or malformed records and reporting persistent removal failures |
| `ROOT/NAME/journey.json`       | the journey and the revision the store assigned it                                                                                                                                                                                                                                 |
| `ROOT/NAME/revision`           | the revision counter, kept across `delete` and recreate                                                                                                                                                                                                                            |
| `ROOT/NAME/journey.lock/`      | the write lock directory; its empty `PID-TOKEN` entry identifies the holder                                                                                                                                                                                                        |
| `ROOT/NAME/runs/ID/run.json`   | one run, under the run id the store minted in `open`                                                                                                                                                                                                                               |
| `ROOT/NAME/runs/ID/sN.png`     | the capture of step `sN` in the page placement                                                                                                                                                                                                                                     |

### Placements

The page placement, a toolset over a `BrowserPageInterface`, records and replays every native action with trusted input, writes a capture per replayed step through a run store that keeps directories, and collects page output. A toolset action on an element in a child frame records as the gap `the element is in a child frame`. The DOM placement, a toolset from `createBrowserToolset` over a DOM view, replays `click`, `type`, `wait`, and its adopted page tools with `(untrusted event)` receipts and writes no captures; its element manager reaches a same-origin child frame, so a step there records as an ordinary step. The `browse` binary serves the page placement over the file stores; see [Register the browse binary with Claude Code](#register-the-browse-binary-with-claude-code) for its hookup and its environment.

## Relation to WebMCP

WebMCP puts a tool registry on the document, `document.modelContext`, so a page can offer its own capabilities to an agent. This package does not depend on it: the toolset drives any page through its own vocabulary, and `read`, `click`, `type`, `press`, `navigate`, `wait`, and `dialog` run against a browser that ships no registry. The Chromium project's intent to experiment, posted to blink-dev on 2026-05-15, names Chrome 157 as the milestone that would ship WebMCP; see [the WebMCP intent to experiment on blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ). The package adapts to WebMCP in both directions and pins that alignment against revision-named mirrors, which [Declared conformance gaps](#declared-conformance-gaps) records. No export is named after WebMCP; an adapter is named in prose.

The following table names each adapter, the contract on each side, and the proof that pins it.

| Adapter                                | This package                                                                                                                                                                                                                                                                                  | WebMCP or `@orkestrel/mcp`                                                                                                                                                                                                                               | Proof                                                                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The tool source contract               | `BrowserToolSourceInterface`: an `emitter` emitting `change`, `adopt()`, and an optional `tools()` census, which `createBrowserToolset` over a DOM view takes as `source`                                                                                                                     | `@orkestrel/mcp`'s `ModelContextInterface`, returned by `createModelContext`, whose `emitter` and `adopt()` satisfy the contract structurally and which carries no census                                                                                | [the type test](../tests/src/browser/types.test.ts) assigns the model context to the contract and refuses a shape without `adopt`; [the composition cases](../tests/src/browser/factories.test.ts) run the installed bridge over this package's double |
| The registry twin's annotation mapping | `BrowserRegistry.adopt()` projects a `BrowserToolAnnotation` onto `@orkestrel/tool`'s annotations: `readOnly` to `pure`, `consequential` to `consequential`, `untrusted` always `true`; a `debugging` tool is skipped by the toolset, and `autosubmit` is retained on the protocol tool alone | the domain's `Annotation` type carries `readOnly`, `untrustedContent`, `consequential`, `debugging`, and `autosubmit`; the specification source's `ToolAnnotations` carries `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, and `debugging` | [the mapping rows](../tests/conformance.test.ts) drive the real `adopt()` over mirror-shaped tools, and [the registry proof](../tests/src/core/BrowserRegistry.test.ts) pins the untrusted mark and the synthetic `purpose`                            |
| The domain mirror the registry parses  | `parseBrowserTool`, `parseBrowserRemoval`, `parseBrowserInvocation`, and `parseBrowserInvocationResult`; the registry sends `enable`, `disable`, `invokeTool`, and `cancelInvocation` and subscribes `toolsAdded`, `toolsRemoved`, `toolInvoked`, and `toolResponded`                         | the `WebMCP` domain of `browser_protocol.json`: the `Tool`, `Annotation`, and `RemovedTool` types, the `InvocationStatus` values `Completed`, `Canceled`, and `Error`, the four commands, and the four events                                            | [the conformance project](../tests/conformance.test.ts) compares every property the parsers read against [the domain mirror](../tests/mirrors/webmcp-domain-dc2ddf369035.json), and every command and event name the registry uses                     |
| The declarative form                   | the element managers mark a form that a registered tool's `backendNodeId` names (CDP), or that carries a `toolname` attribute (DOM), as `[tool=NAME]` after its role and name                                                                                                                 | the declarative attributes of Chrome's explainer; the specification's declarative section is a TODO at revision `19fc56516057`                                                                                                                           | [the CDP mark](../tests/conformance.test.ts) and [the DOM mark](../tests/src/browser/factories.test.ts) each render `form "Search cars" [ref=e5] [tool=search-cars]`                                                                                   |

## Declared conformance gaps

`npm run test:conformance` runs [`tests/conformance.test.ts`](../tests/conformance.test.ts) in Node with the browser disabled, and `npm test` includes it. It starts no browser: it reads three vendored mirrors through [`tests/setupConformance.ts`](../tests/setupConformance.ts), whose reader checks each file's raw-byte SHA-256 against a pinned constant at module load, so a changed byte throws before a row runs. Each row compares one coordinate of an authority with what this package ships and is ruled implement, retain, or exclude; every exclusion names its closer.

The following table records each mirror's upstream, revision, and pin.

| Mirror                                                                                | Upstream                                                                                                                                  | Revision       | SHA-256                                                            |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| [`webmcp-index-19fc56516057.bs`](../tests/mirrors/webmcp-index-19fc56516057.bs)       | the specification source `index.bs` of `webmachinelearning/webmcp`, whole                                                                 | `19fc56516057` | `e6c9b9790fd5cabc11662bbfeb296a6919388d8fd3f23bf7c85258059948b1b9` |
| [`webmcp-webref-e6ba3d7abea7.idl`](../tests/mirrors/webmcp-webref-e6ba3d7abea7.idl)   | webref's `interfaces/webmcp.idl` as `web-platform-tests/wpt` carries it for its `idlharness` case, whole                                  | `e6ba3d7abea7` | `eddabc7932e9fdfe5e7c48efffb6fe4606657c5f45c9799038d361775802f332` |
| [`webmcp-domain-dc2ddf369035.json`](../tests/mirrors/webmcp-domain-dc2ddf369035.json) | the `WebMCP` domain of `json/browser_protocol.json` in `ChromeDevTools/devtools-protocol`, cut at bytes 1404474 to 1415819, end exclusive | `dc2ddf369035` | `13fb565428f1fc1e09bca51b1234536c5c8da77adf0bd952700e6cdbbc4f1bf6` |

The whole protocol file the domain was cut from is pinned without being vendored, at `672d8481c92832907211e85488e216cd5b1a922fde273faff72f7f6cf765899e`. The web-platform-tests `webmcp/` tree at revision `e6ba3d7abea7` is recorded as a listing, [`wpt-webmcp-e6ba3d7abea7.txt`](../tests/mirrors/wpt-webmcp-e6ba3d7abea7.txt). Refresh the mirrors on each version bump of this package and whenever `@orkestrel/mcp`'s bridge advances its reading date: fetch the three files at their upstream heads, record each commit, cut the domain again by byte range, pin the digests again, and rule every row that reddens as implement, retain, or exclude.

**The web-platform-tests cases do not run.** The listing at `e6ba3d7abea7` holds 88 entries, 55 under `webmcp/imperative/` and 28 under `webmcp/declarative/`. Those cases drive a browser's `document.modelContext`, and none of them runs against this package's double, [`tests/fixtures/modelContext.ts`](../tests/fixtures/modelContext.ts). **What it costs:** the double is checked member by member against webref's IDL, and its behavior is checked only by this package's own composition cases. **Closer:** a testharness runner under the Playwright provider that runs those cases against the double.

**The domain's `Tool.stackTrace` is not read.** Every other property of the mirror's `Tool`, `Annotation`, and `RemovedTool` types is one name a parser reads. **What it costs:** an agent never sees where in the page a tool was registered. **Closer:** a developer diagnostics consumer; `stackTrace` is a developer datum, excluded from the agent surface.

**Page tool names follow the providers' rule, not the specification's.** The specification source admits 1 to 128 code points of ASCII alphanumerics, `_`, `-`, and `.`. `BROWSER_TOOL_NAME_PATTERN` admits 1 to 64 of ASCII alphanumerics, `_`, and `-`, the narrowest rule among the model providers the fleet targets, so the toolset skips a page tool named `a.b` or one longer than 64 code points and emits `skip` with `pattern`. **What it costs:** a page tool with such a name is not advertised. **Closer:** the provider charset and bound documented beside `BROWSER_TOOL_NAME_PATTERN` in `src/core/constants.ts`, widened when the providers admit the specification's rule.

**The declarative form runs ahead of the specification source.** The source's declarative section reads "entirely a TODO" at `19fc56516057` and names no `toolname`, `tooldescription`, or `toolautosubmit` attribute, so the `[tool=NAME]` outline mark follows Chrome's explainer. **What it costs:** the mark can drift from the attributes a specification later names. **Closer:** the specification's declarative section.

**webref lags the specification source.** webref's IDL at `e6ba3d7abea7` declares `ontoolchange` alone and three hints, while the source at `19fc56516057` also declares `ontoolactivated`, `ontoolcancel`, and the `debugging` annotation. This package's double declares the source's members, ahead of webref. **What it costs:** the IDL rows compare against the older member list. **Closer:** a webref extraction carrying the source's handlers and the `debugging` annotation.

**`autosubmit` is retained and marked nowhere.** The domain's `Annotation` carries `autosubmit` and the source's `ToolAnnotations` does not, so `BrowserToolAnnotation.autosubmit` keeps the wire value, and no adopted hint and no outline mark carries it. **What it costs:** an agent cannot tell that a page tool submits its form on its own. **Closer:** an `autosubmit` hint in the specification source.

**A `debugging` page tool is not adopted.** The specification marks such a tool for developers, so the toolset skips it with `debugging`, whether it arrives through the registry or through a source census. **What it costs:** none for an agent. **Closer:** an explicit developer-tool opt-in, outside the agent toolset.

**Every page tool is untrusted, whatever its hint.** A page's `untrustedContentHint` of `false` does not lower the mark, because the protocol describes `toolResponded.output` as untrusted and a prompt injection risk, and the conformance project re-reads that description on every run. **What it costs:** a model sees every page tool's output under `untrusted`. **Closer:** none wanted; this is the package's trust boundary.

**The live `WebMCP` domain is unproven on this host.** Chromium 141, the host browser of the service project, answers `WebMCP.enable` with `-32601` and lists no `WebMCP` in `Schema.getDomains`, so [the live service case](../tests/service/browser.test.ts) skips with that reason. The configuration reference of Chrome DevTools MCP 1.10.1, read on 2026-09-29, states that its WebMCP tools need Chrome 150 or later launched with `--enable-features=WebMCP`; see [the Chrome DevTools MCP configuration reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md). The runtime type of `toolResponded.output` and the code `WebMCP.enable` answers on such a Chrome without the flag are unread; a code other than `-32601` rethrows. **What it costs:** the registry is proven against the in-memory transport, `CDPTestServer`, and the domain mirror, and against no shipping registry. **Closer:** the service project on Chrome 150 or later launched with `--enable-features=WebMCP`.

**The in-page composition runs against a double.** Chromium 141, the host browser, exposes no `document.modelContext`, so the composition of `@orkestrel/mcp`'s bridge with `createBrowserToolset` over a DOM view runs against this package's double, and its block for a real registry collects nothing; the absence path asserts that neither `document` nor `navigator` carries a registry, so a registry at either location reddens rather than skips. **What it costs:** the specification's registry location, `Document` in the source against `Navigator` in Chrome's intent, and `executeTool`'s result shape stay unread. **Closer:** a host browser that exposes `document.modelContext`.

## Contract

These invariants hold across the four faces (`src/core`, `src/browser`, `src/server`, and `src/bin`) and this guide. Each names the test that pins it.

1. **Doc ↔ source bijection.** Every row of the `### Core`, `### Server`, and `### Browser` Surface tables is a real export of its face's barrel, and every barrel export appears as a row, exhaustive in each direction; the declarations a barrel does not re-export are the implementation classes [`tests/guides.test.ts`](../tests/guides.test.ts) lists as internal. Every `ts` fence imports only real exports of `@orkestrel/browser`, `@orkestrel/browser/browser`, or `@orkestrel/browser/server`. The `browse` binary in `src/bin` is a fourth face with no export and its own check project, `check:src:bin`; [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts) spawns the built entry the manifest's `bin.browse` names.
2. **The core has no host dependency.** Core imports `@orkestrel/codec`, `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/html`, `@orkestrel/markdown`, and `@orkestrel/tool`. The transport and writer inject host operations. Base64 uses codec directly and every decoder caller handles its `undefined` refusal. The scoped check projects and [configuration proof](../tests/config.test.ts) enforce the environment boundaries; the [page proof](../tests/src/core/BrowserPage.test.ts) covers refused screenshot bytes.
3. **The transport is a dumb text pipe.** `CDPTransportInterface` does no JSON framing of its own; `CDPClient` owns request and response correlation, timeouts, abort signals, and event dispatch over the transport's raw `message`, `close`, and `error` events. [`tests/src/core/CDPClient.test.ts`](../tests/src/core/CDPClient.test.ts) pins it.
4. **Captured bytes never touch a filesystem in core.** A page accepts an optional `BrowserWriterInterface`, injected through `BrowserContext`, and calls `write(path, bytes)` only when a screenshot, PDF, trace, or HAR request carries a `path`; the server supplies `createFileBrowserWriter` through `Browser`. A replay takes each capture's bytes from the view without a `path` and hands them to its run store's `capture`, which writes them only into the run directory its `create` created and creates no directory; the memory run store keeps no bytes. [`tests/src/server/writers/FileBrowserWriter.test.ts`](../tests/src/server/writers/FileBrowserWriter.test.ts) pins the writer, the capture cases of [`tests/src/core/BrowserReplay.test.ts`](../tests/src/core/BrowserReplay.test.ts) pin that no path reaches the page, and [`tests/src/server/stores/FileBrowserRunStore.test.ts`](../tests/src/server/stores/FileBrowserRunStore.test.ts) pins the capture's confinement.
5. **Browser options name their owner.** `browsers.engine` selects discovery; there is no top-level engine option. `BrowserMCPServerOptions.browser` carries `headless`, `executable`, and `viewport`; `pool` carries `size`, `contexts`, and `launch`; `journeys` carries `readonly`. The binary maps its environment into those groups. [Browser](../tests/src/server/Browser.test.ts), [MCP server](../tests/src/server/BrowserMCPServer.test.ts), and [binary](../tests/src/bin/main.test.ts) prove the mappings.
6. **Lifecycle events are observable, never polled.** `BrowserInterface.emitter` fires `idle`, `discover`, `connect`, `disconnect`, `launch`, `page`, `context`, `error`, and `destroy`; `CDPClientInterface.emitter` fires `connect`, `close`, `drop`, and `error`; a recorder, `page.recorder` included, fires `start`, `step`, `stop`, and `clear`, and a replay fires `step`. A page fires `navigate` with `[url, same]` for both a cross-document and a same-document navigation, `session` when an out-of-process frame's session attaches, `popup` for each page it opens, and `dialog`, `close`, and the network and worker events; a context fires `page` for each page it publishes, popups included. A page a context constructs holds its target on the client's connection, and the first such page on a connection enables `Target.setDiscoverTargets` for it; a second live page for a held target is refused with `TARGET_HELD`, and a `create()` that meets a page another path published for its target joins that page, or rejects with `CLOSED` when that page closed. A discovered popup is published one time, after its opener, through the opener's `popup`, the context's `page`, and `pages()`. Limit: when the page holding a popup's target fails its setup, discovery publishes nothing, and a later `sync()` adds the target without a `popup` from its opener. Limit: when `Target.setDiscoverTargets` fails, or the connection ends and another opens, the next page a context constructs on that connection sends it again, and nothing sends it before then; `sync()` is the recovery for a popup that discovery missed meanwhile. The registry fires `change`, `invoke`, and `respond`, and the toolset `adopt`, `skip`, `select`, `action`, `hold`, and `release`. A journey store never polls: a held `journey.lock` refuses at once with `STORE_LOCKED`, and the tool tells the model to call again. Every wait parks on a protocol event, a DOM observer, or an abort signal, and a `setTimeout` survives only as a deadline; the one liveness probe with no event source is the bounded drain of a terminated process group, at `BROWSER_DRAIN_INTERVAL_MS` in `src/server`. An external disconnect emits a coded `error` before `disconnect`; transport loss with the process alive is resumable, and a process exit is terminal. [`tests/src/core/BrowserPage.test.ts`](../tests/src/core/BrowserPage.test.ts), [`tests/src/core/recorders/BrowserCodegen.test.ts`](../tests/src/core/recorders/BrowserCodegen.test.ts), [`tests/src/core/recorders/BrowserRecorder.test.ts`](../tests/src/core/recorders/BrowserRecorder.test.ts), and [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) pin the page, recorder, and toolset events, [`tests/src/server/stores/FileBrowserJourneyStore.test.ts`](../tests/src/server/stores/FileBrowserJourneyStore.test.ts) pins the lock refused at once, and [`tests/src/core/BrowserContext.test.ts`](../tests/src/core/BrowserContext.test.ts) pins target ownership, the joined creation, and popup publication.
7. **Two error classes cover the runtime.** `BrowserError` carries a bare `BrowserErrorCode` and optional JSON context; `BrowserStepError` adds its typed action and the code `STEP`. Guards narrow both. `ARGUMENT`, `CLOSED`, `PROTOCOL`, and `NAVIGATION` distinguish invalid input, closed state, malformed protocol data, and navigation failure. Remote CDP failures use `REMOTE`, disconnected requests use `DISCONNECTED`, and deadlines use `TIMEOUT`. The navigation-load, clock, tracing, and registry deadlines name their operation in context. Shared storage failures use `STORE_*` codes for both journey and run stores. [Errors](../tests/src/core/errors.test.ts), [CDP client](../tests/src/core/CDPClient.test.ts), [page navigation](../tests/src/core/BrowserPage.test.ts), [clock](../tests/src/core/BrowserClock.test.ts), [tracing](../tests/src/core/BrowserTracing.test.ts), and [registry](../tests/src/core/BrowserRegistry.test.ts) prove these contracts.
8. **Oversized results fail clean.** `evaluate()` and `read()` wrap their in-page result with `compileGuardedEvaluateExpression(expression, BROWSER_RESULT_LIMIT)`, which throws the `BROWSER_RESULT_LIMIT_SENTINEL_PREFIX` sentinel before an oversized result could overflow the transport frame; the frame recognizes it through `BROWSER_RESULT_LIMIT_PATTERN` and rejects with `BrowserError` with code `RESULT_LIMIT`, and the connection and the browser process are unaffected. [`tests/service/browser.test.ts`](../tests/service/browser.test.ts) pins both against a real browser.
9. **The page recorder records semantic steps, and a journey compiles to a module that runs as a replay does.** `page.recorder` records each gesture by role and exact accessible name, collapses consecutive edits on one field while the edit is open, and never across a submission, a focus departure, a navigation, or `stop`. `compileBrowserJourney` emits one `follow` call per step on a toolset the module constructs, as `'javascript'` or `'typescript'`, and throws at a gap step. [`tests/src/core/recorders/BrowserCodegen.test.ts`](../tests/src/core/recorders/BrowserCodegen.test.ts) pins the recorder, [`tests/service/codegen.test.ts`](../tests/service/codegen.test.ts) pins its gestures on Chromium against the fixture's own event log, [`tests/src/core/compilers.test.ts`](../tests/src/core/compilers.test.ts) pins the module byte for byte, and the `compiled module equality` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) runs each generated module and its replay to one page outcome with the same receipts.
10. **Doc ↔ source method bijection.** Each `## Methods` table lists exactly the call-signature members of its interface, inherited members included, and each implementing class named for its interface exposes no public method its table omits: the internal page recorder and `BrowserRecorder`, `BrowserReplay`, `BrowserHold`, `BrowserJourneyToolset`, `BrowserMCPServer`, the two memory stores, and the two file stores pair with their interfaces as every earlier class does. The remaining exports are functions, constants, and data contracts. [`tests/guides.test.ts`](../tests/guides.test.ts) pins it.
11. **WebSocket transports report coded failures.** `createWebSocketCDPTransport` supplies the Node transport and `createSocketCDPTransport` the browser transport. Their [Node](../tests/src/server/transports/WebSocketCDPTransport.test.ts) and [browser](../tests/src/browser/transports/SocketCDPTransport.test.ts) proofs exercise real connections, refused opens, and sends after closure.
12. **`Browser.destroy()` escalates SIGTERM to SIGKILL; `close()` is graceful.** On POSIX each launch owns an isolated process group, and `destroy()` signals that group, waiting `BROWSER_KILL_GRACE_MS` before `SIGKILL` and the same bounded window after it; on Windows a launch owns no group, so each step signals one process by identifier. `close()` sends CDP `Browser.close` first and escalates to the same sequence only when an owned process fails to exit within the grace period. Teardown explicitly closes and awaits the owned stderr read pipe, even when a surviving descendant retains its writer. `owned` is `true` for a launched or adopted session, `false` for an active attachment, and `undefined` when no session is represented; `pid` names the process serving the endpoint and stays readable across a `'persistent'` session's `disconnect()`. [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts) pins the sequence and pipe release against spawned processes.
13. **A launch owns the process that serves its endpoint, through the inherited pipe.** Chrome and Chromium serve the endpoint from the process they spawn. A launcher such as Microsoft Edge on Windows instead re-executes the browser with the same `--remote-debugging-port` and exits 0 before the endpoint answers, and the process it spawned inherits its standard error, so `connect()` treats that clean exit as a hand-off: it keeps reading the same pipe on the same `timeout` budget until the `DevTools listening on` line arrives, then reads the `browser` entry of CDP `SystemInfo.getProcessInfo` and owns the process named there. A nonzero exit or a signal rejects at once with a `BrowserError` naming the exit; a pipe that closes without the line rejects with the readiness failure; an endpoint that names no browser process rejects after a best-effort `Browser.close`. The Windows Edge launch reading is recorded in limit 26. The launcher hand-off cases in [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts) pin the rest.
14. **A snapshot is serializable data plus navigation.** `BrowserSnapshot` holds exactly `documents` and `styles`, so `JSON.stringify(snapshot)` yields `{ documents, styles }` and `createBrowserSnapshot(parsed)` navigates it again; every method takes and returns bare `BrowserNode` values, and containment is derived from `ancestors`. [`tests/src/core/BrowserSnapshot.test.ts`](../tests/src/core/BrowserSnapshot.test.ts) pins it.
15. **A reference names one element for as long as that element exists.** A reference is `e` followed by a positive integer. On CDP every page's element manager mints from one counter its browser context owns and binds the reference to `SESSION:BACKEND`, because backend node ids are per renderer; in the DOM placement the view owns the counter and binds a `WeakRef`. The allocator never reuses a number within the context. Across consecutive documents in one tab, a link keeps its reference when its role (`link`), accessible name, and resolved `href` match exactly one link in each document. Duplicate identities in either document, changed names or destinations, and every non-link receive fresh references. Buttons never carry. A child frame's navigation or detachment drops that frame's bindings. The toolset retains each shown reference's last role and name for missing-reference refusals until teardown. A never-shown reference keeps the unknown-reference refusal. A successful action still resets the accepted set; carried references are accepted again because its result lists them. `parseBrowserReference` accepts `e12`, `E12`, `[e12]`, `ref=e12`, and `[ref=e12]`. A journey's `reference` is evidence a developer reads, never a lookup: replay resolves each target by role and exact name. [`tests/src/core/elements/BrowserElementManager.test.ts`](../tests/src/core/elements/BrowserElementManager.test.ts), [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts), and [`tests/src/browser/elements/BrowserDOMElementManager.test.ts`](../tests/src/browser/elements/BrowserDOMElementManager.test.ts) pin it, and the `journey semantic replay` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) pins that a changed page resolves by name and that neither a stored reference nor a matching CSS selector resolves a target.
16. **A reading is captured one time and sliced from one projection.** `frame.read()` issues one size-guarded evaluation in the isolated world; `markdown` and `text` each project the capture one time per mode and cut every slice from it, ending a bounded slice after the last line break in its window when one lies past `offset`. Truncation is derived as `offset + text.length < total`, and `stale` is derived from the navigation epoch, never stored. [`tests/src/core/BrowserReading.test.ts`](../tests/src/core/BrowserReading.test.ts) and [`tests/src/core/BrowserPage.test.ts`](../tests/src/core/BrowserPage.test.ts) pin it.
17. **The registry mirrors the domain and settles every invocation.** `start()` subscribes before it enables, because enabling reports every registered tool; a `-32601` answer unsubscribes and resolves `false`, and any other failure rethrows. `execute` never passes the signal to `invokeTool`, so the invocation id always arrives; an abort or a deadline sends `WebMCP.cancelInvocation` with that id and rejects without waiting for `Canceled`; a navigation or detachment of the tool's frame and `destroy` reject; every terminal status resolves a `BrowserInvocationResult`. A `toolResponded` with an unknown id is held only while an `invokeTool` reply is pending. [`tests/src/core/BrowserRegistry.test.ts`](../tests/src/core/BrowserRegistry.test.ts) pins it.
18. **Actions run one at a time.** The toolset runs actions in first-in, first-out order, and an action holds the queue until its receipt is produced; an action whose signal aborts while queued sends nothing. After a `mousePressed` or `keyDown` is sent, the matching release is sent without the signal, so an abort never leaves a button or key down, and the next action waits for a pending release. Every complete browser or journey tool result and error message fits the smaller of `limit` and `BROWSER_TOOL_LIMIT`, including its footer. A `click`, `type`, or `press` on a page opens `page.navigation.record(frame)` before its first input and settles its receipt through that record, so the receipt's view follows the navigation the record selects, and the toolset holds no frame, session, or loader state of its own. While a replay holds the toolset, an action admitted after the hold that does not carry the hold's token is refused with `TOOLSET_BUSY` rather than queued, and the actions admitted before the hold complete first. The queue, bounds, destroy, hold, and navigation settlement cases in [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts), the selection cases in [`tests/src/core/BrowserNavigationRecord.test.ts`](../tests/src/core/BrowserNavigationRecord.test.ts), and the `claim 6` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) pin it.
19. **A dialog interrupts every tool and stages `dialog`.** Every pending step of every tool is raced against the page's `dialog` event, so a tool returns a receipt naming the dialog while the blocked command waits; the `dialog` tool is advertised while the dialog is open and bypasses the queue, and every other tool refuses with a message naming the open dialog and ending `call dialog.` A replay admits a `dialog` step only after an `interrupted` action, the continuation the toolset stages, and under a hold a `dialog` from another caller is refused with `TOOLSET_BUSY`. The dialog cases in [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) and [`tests/src/core/BrowserReplay.test.ts`](../tests/src/core/BrowserReplay.test.ts), the `confirm()` and `beforeunload` dialog cases in [`tests/service/toolset.test.ts`](../tests/service/toolset.test.ts), and the `claim 6` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) pin it.
20. **CDP input is trusted and DOM input is not.** A page's `trusted` is `true`: clicks, keys, and hovers are `Input` events whose `isTrusted` is `true`. A DOM view's `trusted` is `false`: `click` is `HTMLElement.click()`, `fill` is the native value setter plus `input` and `change`, and `submit` is `requestSubmit()` observed by a `submit` listener, so a form that fails validation reports `did not submit` with the field's `validationMessage`. Its `click` and `type` receipts end `(untrusted event)`. It refuses rather than fakes a key press, a navigation, a file chooser, typing into `contenteditable`, a link or form whose target opens another browsing context, a disabled control, and a cross-origin frame. [`tests/src/browser/elements/BrowserDOMElement.test.ts`](../tests/src/browser/elements/BrowserDOMElement.test.ts) and [`tests/service/document.test.ts`](../tests/service/document.test.ts) pin it.
21. **The toolset's names are reserved at `start()`.** `start()` rejects with a coded `BrowserError` and adds nothing when the manager already holds `read`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`, or `switch` under a tool the toolset did not add, and a page tool under a reserved name is skipped with `reserved`. A page tool named `unresolved` is also skipped as reserved. A toolset constructed with `journeys` also reserves `record`, `save`, `journeys`, `edit`, `replay`, `forget`, and `capture`: construction refuses a manager that holds one with `TOOLSET_RESERVED`, and a page tool under one is skipped with `reserved`. The `browse` server keeps its dispatchers on a manager of its own and forwards to the toolset's, so the toolset meets no foreign name. A consumer that replaces a reserved name after `start()` breaks the path a receipt names, such as `call dialog`. [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts), [`tests/src/core/BrowserJourneyToolset.test.ts`](../tests/src/core/BrowserJourneyToolset.test.ts), and [`tests/src/server/BrowserMCPServer.test.ts`](../tests/src/server/BrowserMCPServer.test.ts) pin it.
22. **A DOM view refuses its own document by default.** `createBrowserDOMView` rejects `globalThis.document` with `DOCUMENT_OWN` unless `own` is `true`. `createBrowserToolset(view)` composes that view without owning it. Destroy the toolset before destroying the view. The [browser factory proof](../tests/src/browser/factories.test.ts) pins the refusal, and the [document service proof](../tests/service/document.test.ts) exercises the composition.
23. **Limit: an `alert()` blocks the driven document.** The DOM placement never replaces `window.alert`, `confirm`, or `prompt`, so a click that opens one blocks the driven document's thread and the action does not return until a person answers it; the CDP placement stages `dialog` instead. [`tests/guides.test.ts`](../tests/guides.test.ts) pins that no `src/browser` module assigns those functions.
24. **Limit: a `debugging` page tool is not adopted.** [Declared conformance gaps](#declared-conformance-gaps) records this limit in its entry "A `debugging` page tool is not adopted". [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) and the skip rows of [`tests/conformance.test.ts`](../tests/conformance.test.ts) pin it.
25. **Limit: the `WebMCP` live proof names its host.** Chromium 141, the host browser, answers `WebMCP.enable` with `-32601`, so the registry conforms to the vendored mirrors and the scripted transports, and this guide claims no interoperability with a shipping registry. [Declared conformance gaps](#declared-conformance-gaps) records this limit and its closer in its entry "The live `WebMCP` domain is unproven on this host". The case in [`tests/service/browser.test.ts`](../tests/service/browser.test.ts) that compares `registry.start()` with whether `Schema.getDomains` lists `WebMCP`, and the live case that skips on that answer, pin it.
26. **Limit: the Windows launch reading covers Edge 154.0.4258.53.** On 2026-10-03, `npm run test:service` launched Edge 154.0.4258.53 on Windows and reported 105 passed tests after commit `73c608f`. That run proves launch and endpoint ownership on that host; it doesn’t establish a launcher hand-off on every Edge installation or a Linux or macOS result. The launcher hand-off cases in [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts) exercise re-execution and inherited stderr with fixture processes.

27. **Owners expose behavior, not drivers.** Frames expose no save, assert, or update; downloads expose no update; WebSockets expose no receive, transmit, fail, or close driver. A context applies emulation before its page creation resolves. [Page setup](../tests/src/core/BrowserPage.test.ts) and [context](../tests/src/core/BrowserContext.test.ts) pin the ordering; guide parity pins the interfaces.
28. **The page recorder is stable and starts explicitly.** `page.recorder` is a dormant `BrowserRecorderInterface` until `start()`. `journey({ name, description })` yields the data that `compileBrowserJourney` compiles. [Page recording](../tests/src/core/recorders/BrowserCodegen.test.ts) pins its lifecycle.
29. **Managers name one operation per behavior.** Network routes use `routes.add/remove/clear`, settings use `apply` with undefined treated as absence and `clear()` to reset all overrides; cookies use `remove(filter)` with a nonempty filter or `clear()`, storage uses `snapshot`, clock uses `active/start/stop`, and HAR reports `active`. Handles and workers release locally through `destroy`. Snapshot traversal uses `depth` or `breadth`; outlines count `listed` and `found`. The [network proof](../tests/src/core/BrowserNetworkManager.test.ts), [cookie proof](../tests/src/core/BrowserCookieManager.test.ts), and [snapshot proof](../tests/src/core/BrowserSnapshot.test.ts) exercise these contracts.
30. **Store conditions are atomic.** `set(journey)` replaces; `exclusive: true` requires absence; a positive safe-integer `revision` requires a match. A mismatch rejects with `JOURNEY_STALE`. Supplying `revision` with `exclusive: true`, or an invalid revision rejects with `ARGUMENT` before writing. Both stores list with `BrowserStorePageOptions`. Run stores mint slots with `create`; filesystem stores optionally save standalone PNGs with `write`. The [memory store proof](../tests/src/core/stores/MemoryBrowserJourneyStore.test.ts) and [file store proof](../tests/src/server/stores/FileBrowserJourneyStore.test.ts) race conditional writes against the real stores.

## Patterns

### Automate a page end-to-end

This demonstration launches a headless browser and loads a self-contained search form. It fills
and submits the form, waits for its result, and reads the resulting content.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ headless: true })
await browser.connect()

try {
	const html = `<form onsubmit="event.preventDefault(); this.insertAdjacentHTML('afterend', '<p id=results>Found ' + this.querySelector('input').value + '</p>')">
		<input id="search" aria-label="Search"><button id="submit">Search</button>
	</form>`
	const page = await browser.create({ url: 'data:text/html,' + encodeURIComponent(html) })
	const [search] = await page.elements.find({ css: '#search' })
	await search?.fill('orkestrel')
	const [submit] = await page.elements.find({ css: '#submit' })
	await submit?.click()
	await page.elements.wait({ css: '#results' })
	const reading = await page.read()
	reading.text().text.includes('Found orkestrel') // true
} finally {
	await browser.destroy()
}
```

### Record a journey from the toolset and save it

A model records a journey by calling `record`, taking its actions, and calling `save`; `read` calls between actions are not steps. The following fence makes those calls through the manager over file stores. Receipt windows are omitted; the saved listing includes its line numbers and footer.

```ts
import { mkdir } from 'node:fs/promises'
import { createBrowserToolset } from '@orkestrel/browser'
import {
	createBrowser,
	createFileBrowserJourneyStore,
	createFileBrowserRunStore,
} from '@orkestrel/browser/server'

await mkdir('tmp/browsers', { recursive: true }) // a file store's root exists before the store
const store = createFileBrowserJourneyStore({ root: 'tmp/browsers' })
const runs = createFileBrowserRunStore({ root: 'tmp/browsers' })
const browser = createBrowser({ headless: true })
await browser.connect()
const page = await browser.create({ url: 'http://127.0.0.1:8080/' })
const toolset = createBrowserToolset(page, { journeys: { store, runs } })
await toolset.start()
await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'add-kettle' } })
// Recording add-kettle; each action you take is a step; call save when it is done.
await toolset.tools.execute({ id: '2', name: 'click', arguments: { ref: 'e1' } }) // Clicked link "Alpine Kettle" [ref=e1].
await toolset.tools.execute({ id: '3', name: 'read', arguments: { from: 1 } }) // no step
await toolset.tools.execute({ id: '4', name: 'click', arguments: { ref: 'e2' } }) // Clicked button "Add to cart" [ref=e2].
await toolset.tools.execute({ id: '5', name: 'wait', arguments: { text: 'Added to cart' } }) // "Added to cart" is on the page.
const saved = await toolset.tools.execute({
	id: '6',
	name: 'save',
	arguments: { description: 'Adds the Alpine Kettle to the cart' },
})
// Saved add-kettle with 3 steps.
// 1: add-kettle "Adds the Alpine Kettle to the cart"
// 2: s1 click link "Alpine Kettle"
// 3: s2 click button "Add to cart"
// 4: s3 wait "Added to cart"
// [lines 1–4 of 4; the whole listing]
```

`save` writes the journey before it ends the recording, so a write that fails or meets a held lock leaves the recording open, and the next `save` writes those steps and the actions recorded after the refusal. The journey lands at `tmp/browsers/add-kettle/journey.json`.

### Replay a journey with inputs

`replay` runs a saved journey from its `start` URL when present, or on the current page when absent; `inputs` carries a value for each parameter, and a parameter with a default takes the default when `inputs` omits it. The following fence replays the `add-kettle` journey of 5 steps, whose `email` parameter defaults to `sam@example.test`, with another address, and its comments show the render's head line and a refused input; see [The listing](#the-listing) for that journey and [Replay a journey](#replay-a-journey) for the whole render.

```ts
const replayed = await toolset.tools.execute({
	id: '7',
	name: 'replay',
	arguments: { journey: 'add-kettle', inputs: { email: 'ada@example.test' } },
})
// Replayed add-kettle: 5 of 5 steps.
await toolset.tools.execute({
	id: '8',
	name: 'replay',
	arguments: { journey: 'add-kettle', inputs: { emial: 'ada@example.test' } },
}) // { success: false, error: 'Journey add-kettle has no parameter named "emial"; call journeys.' }
```

The run lands at `tmp/browsers/add-kettle/runs/ID/run.json` with one `sN.png` capture per replayed step, and `run.json` keeps the inputs without a secret's value. A refused preparation writes no run.

### Edit a saved journey

Read the listing from `journeys`, then edit its step ids in one batch. The following fence declares a customer parameter, binds the name field, and removes a recorded cart visit. It retains one submission.

```ts
await toolset.tools.execute({
	id: '9',
	name: 'journeys',
	arguments: { from: 1, search: 'place-order' },
})
// journeys (4 lines)
// 1 line matches "place-order": 1
// 1: place-order "Order the Alpine Kettle with a name"
// 2: s1 click link "Cart"
// 3: s2 type "Ada Lovelace" into textbox "Full name", submit
// 4: s3 click link "Orders"
// [lines 1–4 of 4; the whole listing]
await toolset.tools.execute({
	id: '10',
	name: 'edit',
	arguments: {
		journey: 'place-order',
		edits: [
			{ operation: 'declare', name: 'customer', parameter: { default: 'Ada Lovelace' } },
			{ operation: 'update', id: 's2', arguments: { text: { parameter: 'customer' } } },
			{ operation: 'remove', id: 's1' },
		],
	},
})
// Edited place-order.
// 1: place-order "Order the Alpine Kettle with a name" (parameters: customer)
// 2: s2 type "Ada Lovelace" as customer into textbox "Full name", submit
// 3: s3 click link "Orders"
// [lines 1–3 of 3; the whole listing]
```

An added or updated step can name `ref` from the current view in place of a target; `edit` converts it to the element's role and exact name before the batch applies, and refuses a reference the view does not hold. `edit` writes at the revision it read, so a write that landed in between is refused with `Journey place-order changed since you read it; call journeys, then edit again.`

### Generate a module from a journey

`compileBrowserJourney` turns a journey into a module a developer runs and customizes; `compileBrowserJourney(page.recorder.journey(input), options)` compiles a page recording the same way. The following fence is the TypeScript module `compileBrowserJourney(journey, { language: 'typescript' })` emits for `add-kettle`, laid out by the formatter. The JavaScript module drops the type import and the annotations.

```ts
import type { BrowserPageInterface } from '@orkestrel/browser'
import { createBrowserToolset } from '@orkestrel/browser'

export async function execute(
	page: BrowserPageInterface,
	inputs: { readonly email?: string } = {},
): Promise<void> {
	for (const name of Object.keys(inputs))
		if (!['email'].includes(name)) throw new Error(name + ': no parameter has that name')
	if (inputs.email !== undefined && typeof inputs.email !== 'string')
		throw new Error('email: the input is not a string')
	const toolset = createBrowserToolset(page)
	await toolset.start()
	try {
		await toolset.follow('s1', {
			action: 'navigate',
			arguments: { url: 'https://shop.example.test/' },
		})
		await toolset.follow('s2', {
			action: 'click',
			arguments: {},
			target: { role: 'link', name: 'Alpine Kettle' },
		})
		await toolset.follow('s3', {
			action: 'click',
			arguments: {},
			target: { role: 'button', name: 'Add to cart' },
		})
		await toolset.follow('s4', {
			action: 'type',
			arguments: { text: inputs.email ?? 'sam@example.test', submit: true },
			target: { role: 'textbox', name: 'Email' },
		})
		await toolset.follow('s5', { action: 'wait', arguments: { text: 'Added to cart' } })
	} finally {
		await toolset.destroy()
	}
}
```

A secret parameter compiles to a required input and passes `{ secret: true }` to its `type` step, and a parameter without a default compiles to a required input. The module checks its inputs before its toolset starts, as replay refuses them at preparation with `JOURNEY_INPUT`: an input that names no parameter throws `NAME: no parameter has that name`, then a required input without a string value throws `NAME: the input is missing`, then a defaulted input that is neither `undefined` nor a string throws `NAME: the input is not a string`, where `NAME` is the input's name. Replay reads an own `undefined` input as omitted, so the module and replay refuse the same inputs. A module with a required parameter reports the first one as missing when `execute` receives no inputs. A journey without parameters compiles no check. A gap step compiles to `throw new Error('s6: the element is in a child frame; handle it here')` at its position, and `gaps` lists it. `follow` throws a `BrowserStepError` whose message is `sN: RECEIPT` and whose `action` is the performed `BrowserAction` when a step did not complete, and returns the `BrowserAction` of an `interrupted` action, so a `dialog` step that follows it answers the pending input.

### Reattach to a running session

A `'persistent'` (profile-backed) launch survives `disconnect()` — the
browser process keeps running, so a later `Browser` can reattach to it through
CDP discovery on the same fixed port. A reattached instance connects as
`'cdp'`, so its own `destroy()` detaches locally and does nothing more — it never sends a
remote close, because another client might still be using the browser. The following fence launches, disconnects, and reattaches.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const port = 9222
const browser = createBrowser({ profile: './profile', cdp: { port } })
await browser.connect() // launches (no browser yet listening on `port`)
const pid = browser.pid // the process an external supervisor can watch

await browser.disconnect() // retains ownership without killing the browser

// ...later, in this process or another...
const reattached = createBrowser({ cdp: { port } })
await reattached.connect() // discovers the still-running browser over CDP
const urls = reattached
	.context()
	?.pages()
	.map((page) => page.url) // correct immediately, no navigate() needed
await reattached.destroy() // detaches locally and nothing more; the browser process keeps running
await browser.destroy() // the original owner terminates and awaits its process
```

An ephemeral launch (no `profile`) can also disconnect and reconnect while its
owning `Browser` instance and process remain alive. A transport-loss disconnect
is likewise resumable — the same `browser` instance can `connect()` again
without a fresh `createBrowser()`.

When the original owner is unavailable, a connected CDP client can explicitly
assume responsibility before disconnecting. Ownership is state, not a string
mode: `owned` is `true` for a launched or adopted session, `false` for an active
attachment, and `undefined` when no session is represented. The following fence adopts an
attached browser.

```ts
const browser = createBrowser({ cdp: { port } })
await browser.connect()
browser.adopt()
await browser.disconnect()
await browser.connect()
await browser.destroy() // closes the adopted remote browser
```

### Gracefully shut down a reattached session

Use `close()` instead of `destroy()` to terminate a browser this instance attached to or
launched: it sends CDP `Browser.close` and, when this instance owns the process, awaits its exit
before falling back to the kill escalation `destroy()` uses. The following fence closes a
reattached browser.

```ts
const reattached = createBrowser({ cdp: { port } })
await reattached.connect() // discovers the still-running browser over CDP

await reattached.close() // best-effort CDP Browser.close; because this instance never owned the process, it does not wait for the remote exit
// a further connect() on this instance throws BrowserError with code CLOSED, same as after destroy()
```

### Drive the core client directly over an injected transport

Drive the client directly in an environment without Node, or in a test whose scripted transport
satisfies `CDPTransportInterface`. The following fence sends one command and subscribes to one
event.

```ts
import { createCDPClient } from '@orkestrel/browser'

const client = createCDPClient({ transport }) // transport: CDPTransportInterface
await client.connect()

const result = await client.send('Page.navigate', { url: 'https://example.com' })
client.subscribe('Page.frameNavigated', (params) => log(params))

await client.close()
```

### Drive a page with a small model

Seed the first turn with `read({ from: 1 })`. The prompt asks the model to search page lines, continue from the line a footer names, and use references from the latest result. This example bounds the agent run to 8 turns; the guide proof checks its prompt and seed, not model task success.

```ts
import { createAgent } from '@orkestrel/agent'
import { createBrowserToolset } from '@orkestrel/browser'
import { createOllama } from '@orkestrel/ollama'
import { createToolManager } from '@orkestrel/tool'

const system =
	'You control a web browser with tools and must call a tool before you answer. ' +
	'The first message shows numbered page lines; references such as e4 name its elements. ' +
	'To learn a fact, call read with from 1 and search words from your question; follow a footer by calling read with its from line. ' +
	"To use the site's search box, call type with its reference, the words, and submit true. " +
	'To press a button or follow a link, call click with its reference from the latest result. Never invent a reference. ' +
	'If text you expect has not appeared, call wait once. ' +
	'When the task is done, answer in one short sentence.'

const toolset = createBrowserToolset(page, { tools: createToolManager() })
await toolset.start()
try {
	const seeded = await toolset.tools.execute({
		id: 'seed',
		name: 'read',
		arguments: { from: 1 },
	})
	const view = seeded.success ? String(seeded.value) : seeded.error
	const agent = createAgent(createOllama({ model: 'qwen3.5:2b-q4_K_M' }), {
		system,
		tools: toolset.tools,
		limit: 8,
	})
	agent.context.messages.add({
		role: 'user',
		content: `Add the Alpine Kettle to the cart.\n\nThe browser's first read of the page:\n${view}`,
	})
	const result = await agent.generate()
	log(result.content)
} finally {
	await toolset.destroy()
}
```

The store predicates check cart state and the submitted query on the page. A read task also checks the fact in the model’s final answer against the fixture’s expected fact; the answer alone does not prove the page actions.

### Host the toolset over MCP

A toolset's manager is an ordinary `@orkestrel/tool` manager, so `@orkestrel/mcp` hosts it for an MCP client. The following fence serves the browser vocabulary over stdio.

```ts
import { createBrowserToolset } from '@orkestrel/browser'
import { createBrowser } from '@orkestrel/browser/server'
import { createMCPServer } from '@orkestrel/mcp'
import { createStdioServer } from '@orkestrel/mcp/server'

const browser = createBrowser({ headless: true })
await browser.connect()
const page = await browser.create({ url: 'https://example.com' })
const toolset = createBrowserToolset(page)
await toolset.start()
const server = createMCPServer({
	identity: { name: 'browser', version: '0.0.19' },
	tools: toolset.tools,
})
await createStdioServer(server).start()
```

The page tools the page registers join the manager as they are adopted and leave it as they are removed, so the client's next `tools/list` sees them. The `browse` binary serves the same vocabulary with the journey tools and starts its browser when the server starts; see [Register the browse binary with Claude Code](#register-the-browse-binary-with-claude-code).

### Register the browse binary with Claude Code

The `browse` binary serves the vocabulary and the journey tools over MCP on stdio, so a client registers it as a command and needs no code. It ships in `@orkestrel/browser` as `dist/bin/main.js`, with `@orkestrel/mcp` as a runtime dependency, and takes no command-line arguments. It reads the following environment variables, and an empty value counts as unset:

- `BROWSE_ROOT`: the root of the journeys, the runs, and the profiles, resolved against the working directory. Default: `tmp/browsers`.
- `BROWSE_HEADLESS`: `true`, `false`, `1`, or `0`. Default: `true`.
- `BROWSE_EXECUTABLE`: the path of the Chromium executable. Default: the browser `findSystemBrowsers` returns first.
- `BROWSE_READONLY`: `true`, `false`, `1`, or `0`; `true` refuses `record`, `save`, `edit`, and `forget`, and `replay` still writes runs. Default: `false`.
- `BROWSE_POOL`: an integer from `1` through `3` setting the number of browsers the server keeps, with holder admission bounded separately by `BROWSE_CONTEXTS`; see [Run work in parallel](#run-work-in-parallel). Default: `1`.
- `BROWSE_CONTEXTS`: an integer from `1` through `4` setting the number of contexts each browser holds, the shared holder's included; see [Run work in parallel](#run-work-in-parallel). Default: `2`.
- `BROWSE_VIEWPORT`: positive integer dimensions in `WIDTHxHEIGHT` form, such as `390x844`. Applies to every page and popup on every browser, refills included. Default: the browser's launch default.

A malformed value ends the process with exit code 1 and one line on standard error. Any other value of `BROWSE_HEADLESS` or `BROWSE_READONLY`, a `BROWSE_POOL` or `BROWSE_CONTEXTS` that is not an integer, and a malformed `BROWSE_VIEWPORT` write a `SERVER_ENVIRONMENT` line, such as `browse: SERVER_ENVIRONMENT: BROWSE_HEADLESS must be true, false, 1, or 0, not "sometimes"`. Viewport dimensions must be positive safe integers written as decimal digits with a lowercase `x` separator and no whitespace. An integer `BROWSE_POOL` outside `1` through `3` writes `browse: ARGUMENT: pool.size must be an integer from 1 through 3`, and an integer `BROWSE_CONTEXTS` outside `1` through `4` writes `browse: ARGUMENT: pool.contexts must be an integer from 1 through 4`. On Linux a server running as root launches Chromium with `--no-sandbox`, because Chromium refuses to start as root with its sandbox on.

Chromium starts when the server starts, before the client sends a request. The server launches its first browser, checks that it answers a CDP ping, and places the shared holder, which the named tools drive, in that browser's prepared context. `initialize` and every tool call wait for that placement, and `ping` and `tools/list` answer while the browser warms. With `BROWSE_POOL` at `2` or `3`, the other browsers warm after the first, and `initialize` does not wait for them. A launch that fails is retried one time. The end of input or `SIGTERM` closes every browser and removes its profile, the process exits with code 0, and a run without a fault writes nothing to standard error.

A client gives a server a limited time to answer `initialize`. On 2026-10-03, Claude Code's documentation gave 30 s and connected servers in the background, the Codex configuration reference gave 10 s through `startup_timeout_sec`, and Cursor's documentation gave no limit; see [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp), [the Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), and [Cursor's MCP documentation](https://cursor.com/docs/context/mcp). On Windows 11 with Edge 154 on 2026-10-04, while a browser test suite ran beside it, the built binary answered `initialize` at most 2.07 s after its spawn at every `BROWSE_POOL` size, a leftover browser to sweep included. No client needs a longer startup timeout.

Set `BROWSE_POOL` to `2` or `3` to keep more than one browser. Each browser warms with one prepared context, and `acquire` places a holder on the live browser with the fewest occupied contexts, so a browser that serves no holder takes the next one. After a browser loss, each holder that was on it recovers at its next call: in a free context on another browser, or after the replacement launch when no browser has a free context. Concurrent calls on one holder share its one recovery. At `1`, every recovery after a browser loss waits for the replacement launch. In the contexts measurement on Windows 11 with Edge 154.0.4258.53 on 2026-10-05, acquiring a context took 113 to 266 ms and relaunching a browser 980 to 1898 ms.

When a holder loses its browser or its context, the shared holder's included, browse never repeats a call. A loss is the browser process exiting, its CDP connection dropping, or a CDP ping it fails before a call or after a failed one; a current-page renderer crash replaces only its holder's context, and a crashed background tab leaves the holder attached. The following list gives what each call answers around a loss:

- A call after the loss runs in a fresh context that starts at `about:blank`, and its text opens with a `SERVER_CRASH:` note that names the cause and the lost page's URL. An element reference from the lost page is refused.
- A call the loss interrupts answers `SERVER_UNRESOLVED:`: its outcome is unknown, and browse did not repeat it. Read the page before you repeat the call.
- A call that completed before the loss keeps its result, and the next call carries the note.
- A call that fails for its own reason on a live browser answers its plain failure, with no note.
- When no browser can serve, the call answers the note, then `SERVER_UNAVAILABLE:` naming the cause.

A hang of the whole browser during a call can take two command deadlines, the call's and then the post-failure ping's, so in Codex set `tool_timeout_sec` for `browse` higher than the default 60 s.

Cancelling a call ends its wait without cancelling the browser's liveness check. Concurrent checks share one ping per slot, so a later call joins the remaining deadline. A failed ping retires the slot and leaves the `SERVER_CRASH:` note for the successor's outcome.

A ping deadline forces the owned process to exit before slot teardown. On Windows, the service proof launches a Node stand-in that completes CDP setup and then withholds replies; it asserts that the pid exits and the call runs on a real browser successor. The `SIGSTOP` proof remains conditional on the host accepting that signal.

When no browser starts at setup, the server refuses on each surface and keeps answering until its input ends. Setup fails, for example, when the first browser fails to launch twice or the root cannot be created. The following list gives what each request answers, where `CAUSE` is the failure's message:

- `initialize` answers the JSON-RPC error `-32000` with the message `SERVER_UNAVAILABLE: CAUSE` and `data.code` set to `SERVER_UNAVAILABLE`.
- `ping` answers `{}`, and `tools/list` answers the vocabulary.
- Every `tools/call` answers an error result whose text opens with `SERVER_UNAVAILABLE:`, so a client that connects without the legacy `initialize` meets the refusal at its first tool call.
- The binary writes `browse: SERVER_UNAVAILABLE: CAUSE` to standard error and exits with code 1 after its input ends.

The server writes each diagnostic as one line on standard error in the form `browse: CODE: DETAIL`, where `CODE` is one of the following codes and `DETAIL` is the cause:

- `SERVER_LAUNCH`: a browser failed to start, and the pool retries it within its bound.
- `SERVER_EXHAUSTED`: setup's warming or a call's acquire rejected with the pool's `create` error after the launch bound was spent; a browser warming after setup that spends the bound writes `SERVER_LAUNCH` lines without this line.
- `SERVER_UNAVAILABLE`: setup was refused, and the binary writes this line before it exits with code 1.
- `SERVER_TEARDOWN`: a browser's termination is unconfirmed or its teardown failed; its profile folder stays until the shutdown recheck, and a shutdown that meets it exits with code 1.
- `SERVER_SWEEP`: the sweep could not read the `.profiles` folder under `BROWSE_ROOT`, and the server serves without it.
- `SERVER_ENVIRONMENT` and `ARGUMENT`: a malformed variable, as the earlier paragraph describes.

At start, beside the launch, the server sweeps the profile folders that ended servers left under `ROOT/.profiles`, where `ROOT` is the `BROWSE_ROOT` directory. It visits each `<pid>-<uuid>` folder whose owning process has exited. It removes a folder with no `browse.json` record or whose recorded browser has exited, closes a recorded browser that still runs at a `ws://127.0.0.1` endpoint and then removes its folder, and keeps a folder whose record it cannot read, whose endpoint names a host other than `127.0.0.1`, or whose browser refuses to close; the shutdown recheck removes the last kind after its browser exits. `initialize` never waits for the sweep. The sweep never visits a bare `ROOT/.profiles/<uuid>` folder, which releases before 0.0.23 left: delete those folders by hand one time, while no `browse` server runs on that root, and leave every `<pid>-<uuid>` folder to the sweep.

Claude Code 2.1.286 registers the binary for a checkout in four steps:

1. Install the package in the checkout with `npm install @orkestrel/browser`.
2. From the checkout root, run `claude mcp add --scope project browse -- node node_modules/@orkestrel/browser/dist/bin/main.js`. It writes the project's `.mcp.json` with the entry `"browse": { "type": "stdio", "command": "node", "args": ["node_modules/@orkestrel/browser/dist/bin/main.js"], "env": {} }` under `mcpServers`; set a variable from the preceding list under `env`, or pass `-e BROWSE_HEADLESS=false` before the `--` of the same command.
3. Run `claude mcp get browse`. Until the server is approved, it reports `Scope: Project config (shared via .mcp.json)` and ``Status: ⏸ Pending approval (run `claude` to approve)``, and Claude Code connects to no unapproved project server.
4. Start `claude` in the checkout and approve `browse` when it asks about the project's MCP servers. `claude mcp reset-project-choices` clears that choice for the checkout.

Steps 2 and 3 ran on 2026-10-01 against a scratch checkout whose `node_modules/@orkestrel/browser` linked this package's build, with their output quoted. The approval in step 4 is interactive, and no approved Claude Code session drove the server in that run; the requests below are illustrative rather than a transcript of that run. With `@orkestrel/mcp` 0.0.34, a client that subscribes through `subscriptions/listen` receives `notifications/tools/list_changed` when the server mirrors a page tool, and a client that connects through `initialize` receives none and sees the tool at its next `tools/list`; which of the two Claude Code 2.1.286 opens is unread.

The following fence is an unexecuted illustration of line-based requests and numbered journey listings. Page windows are omitted. The distribution test below separately drives the packed binary.

```ts
// -> tools/list
// <- read, click, type, press, navigate, wait, dialog, switch, record, save, journeys, edit, replay, forget, capture, acquire, execute, tools, destroy
// -> tools/call navigate { url: 'http://127.0.0.1:35605/' }
// <- Navigated to http://127.0.0.1:35605/.
// -> tools/call record { journey: 'add-kettle' }
// <- Recording add-kettle; each action you take is a step; call save when it is done.
// -> tools/call click { ref: 'e1' }
// <- Clicked link "Alpine Kettle" [ref=e1].
// -> tools/call read { from: 1 }
// The reply contains the numbered product page and its range footer.
// -> tools/call click { ref: 'e2' }
// <- Clicked button "Add to cart" [ref=e2].
// -> tools/call wait { text: 'Added to cart' }
// <- "Added to cart" is on the page.
// -> tools/call save { description: 'Adds the Alpine Kettle to the cart' }
// <- Saved add-kettle with 3 steps.
// <- 1: add-kettle "Adds the Alpine Kettle to the cart"
// <- 2: s1 click link "Alpine Kettle"
// <- 3: s2 click button "Add to cart"
// <- 4: s3 wait "Added to cart"
// <- [lines 1–4 of 4; the whole listing]
// -> tools/call journeys { from: 1 }
// <- journeys (4 lines)
// <- 1: add-kettle "Adds the Alpine Kettle to the cart"
// <- 2: s1 click link "Alpine Kettle"
// <- 3: s2 click button "Add to cart"
// <- 4: s3 wait "Added to cart"
// <- [lines 1–4 of 4; the whole listing]
// -> tools/call navigate { url: 'http://127.0.0.1:35605/' }
// <- Navigated to http://127.0.0.1:35605/.
// -> tools/call replay { journey: 'add-kettle' }
// <- Replayed add-kettle: 3 of 3 steps.
// <- s1 Clicked link "Alpine Kettle" [ref=e3].
// <- s2 Clicked button "Add to cart" [ref=e4].
// <- s3 "Added to cart" is on the page.
```

The `packed browse binary` case of [`tests/distribution.test.ts`](../tests/distribution.test.ts) runs the same command from an installed tarball through `@orkestrel/mcp`'s stdio client: it lists the vocabulary with Chromium absent, then records, saves, lists, edits, and replays a journey.

On 2026-10-04, Claude Code 2.1.285 under `claude -p --mcp-config FILE --strict-mcp-config` and `codex exec` with `-c mcp_servers.browse.command`, `-c mcp_servers.browse.args`, and `-c mcp_servers.browse.env` overrides each started the built binary, where `FILE` names a JSON file holding the `browse` entry, with no saved client configuration. The following list gives what each client showed:

- Claude Code connects `browse` when setup is refused and shows the refusal as the answer to the first tool call, a text that opens with `SERVER_UNAVAILABLE:` and names the cause.
- Codex hides a server whose `initialize` fails: the agent sees no `browse` tools, and neither the agent nor the `exec` output carries the cause. Set `required = true` in the `browse` entry of Codex's MCP configuration: Codex then refuses to start the session and prints the refusal with its cause, such as `required MCP servers failed to initialize: browse: ... SERVER_UNAVAILABLE: spawn ... ENOENT.` (read with `codex exec -c mcp_servers.browse.required=true` on 2026-10-04).
- Codex `exec` asks approval for each `browse` tool that is not read-only. Under the approval policy `never`, it refused `navigate` with `MCP tool call requires approval, but approval policy is never`, and the observation tool ran. That run predates the line-based vocabulary.
- A client that ends its session ends the server before its teardown finishes. On Windows 11 no browser stayed running, and one `<pid>-<uuid>` profile folder without a `browse.json` record stayed; the next start on the same root removes it.

### Run work in parallel

Acquire a holder when work needs a context of its own beside the shared one, such as a subagent that checks a page while you drive another through the named tools. Each holder runs in its own isolated context on a pooled browser, with its own pages and downloads directory, so its calls run beside the shared holder's calls and beside every other holder's. The named tools, such as `navigate` and `read`, keep serving the shared holder unchanged.

The following list gives the holder tools that `BROWSER_SERVER_COPY` defines:

- `acquire { purpose }`: admits a holder and answers JSON with the server-minted `holder` id and its browser's `tools` catalog. The `purpose` text describes the work and names the holder in a capacity refusal. Hand the id to the agent that does the work.
- `execute { holder, name, arguments }`: runs the tool `name` from the holder's catalog with that tool's own arguments inside `arguments`, and answers what the tool answers.
- `tools { holder }`: lists the holder's catalog, including the page tools its current page registers.
- `destroy { holder }`: ends the holder and closes its context. A call still running on that holder answers `SERVER_UNRESOLVED:`, and a repeated `destroy` of the same holder succeeds again.

The following fence shows one holder from `acquire` to `destroy`, one request and the text of its answer per line, with the view after the receipt left out; `HOLDER_ID` stands for the id that `acquire` returns.

```ts
// -> tools/call acquire { purpose: 'Check the cart while the main agent edits the catalog' }
// <- {"holder":"HOLDER_ID","tools":[/* the definitions of read, click, type, and the rest of the catalog */]}
// -> tools/call execute { holder: 'HOLDER_ID', name: 'navigate', arguments: { url: 'https://shop.example/cart' } }
// <- Navigated to https://shop.example/cart.
// -> tools/call tools { holder: 'HOLDER_ID' }
// <- {"holder":"HOLDER_ID","tools":[/* the same catalog, with the page tools the cart page registers */]}
// -> tools/call destroy { holder: 'HOLDER_ID' }
// <- Holder destroyed.
```

`destroy` closes the holder's context and removes its downloads directory, under `ROOT/.profiles/PID-UUID/contexts/GENERATION-UUID/downloads/`. Copy a file out before destroying its holder. The end of the server closes the shared holder's context and removes its downloads too.

A holder that `acquire` admits after a `destroy` starts on a clean slate, which is narrower than a fresh browser. Its context starts with no cookies, local or session storage, IndexedDB data, Cache Storage, service worker registration, HTTP cache entry, or permission override; with its own tabs, element references, and catalog; and with an empty downloads directory. The browser process stays and keeps the memory it holds. In the contexts measurement on Windows 11 with Edge 154.0.4258.53 on 2026-10-05, a browser's private memory rose from about 505 MiB to about 670 MiB over its first 5 context generations and then held through 30; a longer run might show more.

`BROWSE_POOL`, or `pool.size` for `BrowserMCPServer`, counts browsers. `BROWSE_CONTEXTS`, or `pool.contexts`, bounds contexts per browser. Admission is their product, with the shared holder counted; the defaults admit one named holder beside the shared holder. With `contexts: 1`, a size of `3` admits two named holders. At capacity, `acquire` answers immediately with `SERVER_BUSY:` and launches nothing; its text lists each holder by id and purpose, the shared holder as `shared (Shared browser)`, and tells the agent to destroy a holder it no longer needs or to call the named tools to share the shared browser. A holder that `destroy` is ending counts until its context disposal settles. An unknown or ended id answers `SERVER_HOLDER:` and never falls back to the shared holder.

A failure costs a context only to the holders it reaches, and each of them keeps its id. Each gets a fresh context at its own next call, which answers as the loss list in [Register the browse binary with Claude Code](#register-the-browse-binary-with-claude-code) gives. The following list gives the scope of each failure:

- A browser loss costs every holder on that browser its context, the shared holder's included. Each receives its own `SERVER_CRASH:` note on its next call, naming the URL its own page last showed.
- Holders on another browser receive no note and keep their pages and web state.
- A crash of a holder's current page costs only that holder's context. The browser and the other holders on it stay attached.
- A call that either failure interrupts answers `SERVER_UNRESOLVED:`, and browse never repeats it.

Keep the default single browser. Set `BROWSE_POOL` to `2` only when a browser loss must leave some holders running: the holders on the surviving browser keep their pages, at the cost of a second idle browser. In the contexts measurement on Windows 11 with Edge 154.0.4258.53 on 2026-10-05, with one holder, a second browser added about 1 GiB of private memory, 2551 MiB against 1414 MiB, and two holders used 917 MiB as contexts on one browser against 1610 MiB on two browsers.

Replays of one journey run together across holders, each writing its own run. While a replay of a journey persists its run on any holder, `forget` of that journey answers `STORE_LOCKED: Journey NAME is locked; call forget again.`, where `NAME` is the journey's name, and a replay that starts while `forget` runs answers the same refusal for `replay`.

The following list gives the limits of holders:

- The confirmed defaults, `BROWSE_POOL` of `1` and `BROWSE_CONTEXTS` of `2`, admit one named holder beside the shared holder. The user confirmed them on 2026-10-05 from M1 (2026-10-05, library-level under a core-test load: 21.85 s at one context against 12.91 s at two) and M2 (2026-10-05, through the built binary on a quiet host: 49.73 s at one context against 29.72 s at two, with disjoint ranges). M2 did not establish a gain from two contexts to three.
- Contexts isolate automation, not hostile tenants. Every holder on a browser runs in that browser's process, so drive pages that must not share a process from separate `browse` servers.
- Browser relaunches have no bound while a holder uses the browser. A browser lost under a holder spends nothing from the launch bound, and the next grant of a browser restores the bound, so a browser that crashes under every holder's use relaunches at every call that meets the crash. At the default `BROWSE_POOL` of `1` the shared holder always uses the only browser, so a browser that fails every context creation or disposal relaunches the same way.
- A renderer that hangs without crashing raises no loss. While its browser answers the CDP ping, a call that fails on the hung page answers its plain failure with no note and no launch, and the holder keeps that context until `destroy` or a later crash of its page.
- With `BROWSE_HEADLESS=false`, a popup hides the page that opened it, and the hidden page's animation frames stop, so a click on that page can time out. In the contexts measurement on Windows 11 with Edge 154.0.4258.53 on 2026-10-05, headed clicks on a page behind a popup succeeded 3 of 9 times, and headless clicks 9 of 9. The visibility of every busy holder's page is proven in headless mode only.
- `tools/list` mirrors only the shared holder's page tools. A holder's page tools appear only in the catalog that `acquire` and `tools` return, and run through `execute`.
- A holder keeps its context until `destroy` or the end of the server, with no idle timeout. An abandoned holder costs one context and one place of capacity, and the `SERVER_BUSY:` text names it.
- Journey admission covers the holders of one server. A second `browse` process on the same root can still race a replay against `forget`.
- Codex asks approval for `execute` and `destroy`, because neither is advertised read-only, so under an approval policy that asks, every call a holder makes through `execute` prompts. `acquire` carries no read-only annotation either, and `tools` is advertised read-only.

### Publish native tools to a page

A page that runs a built-in browser agent reads tools from its WebMCP registry, and `@orkestrel/mcp`'s bridge publishes a tool manager there. Publish `toolset.native`, never `toolset.tools`: the manager also holds the page tools the toolset adopted from the same registry, and publishing them would register each one as a proxy of itself. The following fence drives a same-origin child document, adopts that document's page tools through the bridge, and publishes the four generic tools back to it.

```ts
import { createBrowserToolset } from '@orkestrel/browser'
import { createBrowserDOMView } from '@orkestrel/browser/browser'
import { createModelContext } from '@orkestrel/mcp/browser'
import { createToolManager } from '@orkestrel/tool'

const driven = frame.contentDocument
const bridge = driven === null ? undefined : createModelContext({ document: driven })
if (driven !== null && bridge !== undefined) {
	const view = createBrowserDOMView({ document: driven })
	const toolset = createBrowserToolset(view, { source: bridge })
	await toolset.start() // adopts the document's registered tools, and again on each change
	const native = createToolManager()
	for (const tool of toolset.native) native.add(tool) // read, click, type, wait
	await bridge.publish(native)
}
```

`createModelContext` returns `undefined` on a browser that ships no `document.modelContext`; see [Declared conformance gaps](#declared-conformance-gaps) for what that leaves unproven.

## Tests

The suites run as Vitest projects, each with a fixed scope:

- `src:core` runs [`tests/src/core`](../tests/src/core) in Node against real entities over an in-memory CDP transport whose replies each test scripts; `src:server` runs [`tests/src/server`](../tests/src/server) in Node against spawned stand-in processes and in-process CDP servers; `src:browser` runs [`tests/src/browser`](../tests/src/browser) in Playwright's Chromium, with a browser launched by this package's own `createBrowser` for the socket transport. `npm run test:src` runs all three. `src:bin` runs [`tests/src/bin`](../tests/src/bin) in Node against the built `dist/bin/main.js`, through `npm run test:src:bin` after `npm run build`.
- `guides` runs [`tests/guides.test.ts`](../tests/guides.test.ts) in Node through `npm run test:guides`; `conformance` runs [`tests/conformance.test.ts`](../tests/conformance.test.ts) in Node against the pinned mirrors; `policy`, `config`, `setup`, and `setup:browser` prove the workspace rules, the configuration, and the shared test infrastructure. `npm test` runs every project named so far.
- `service` runs [`tests/service`](../tests/service) against a real Chromium-family browser on the host and is outside `npm test`; `distribution` packs and installs the package and runs from `prepublishOnly`.

The following list names each test file and what it proves.

- [`tests/guides.test.ts`](../tests/guides.test.ts): the three faces' Surface tables against their barrels, each Methods table against its interface and implementing class, every compared summary and titled example against its source, every fence's imports, every relative link, the README pitch against this guide's tagline, the transcribed `Drive a page with a small model` fence run against a scripted page, the Tools table against `BROWSER_TOOL_COPY`, the journey listing, run render, and generated module fences against what `renderBrowserJourney`, `renderBrowserRun`, and `compileBrowserJourney` return, and the absence of a page-dialog override in `src/browser`.
- [`tests/conformance.test.ts`](../tests/conformance.test.ts): the parsers, commands, events, annotation mapping, skips, and declarative mark against the revision-named `WebMCP` mirrors, and the export scan that keeps `WebMCP` and `ModelContext` out of every exported name.
- [`tests/policy.test.ts`](../tests/policy.test.ts): the workspace rules, including the banned-term sweep over authored Markdown.
- [`tests/config.test.ts`](../tests/config.test.ts): the aliases, the registered projects and their scopes, the target wrappers, and the scripts that gate each proof.
- [`tests/distribution.test.ts`](../tests/distribution.test.ts): the packed archive a consumer installs, its three faces, and their declarations under every module resolution; the `generated journey module` case, which type-checks the modules `compileBrowserJourney` emits against the installed declarations and imports them under Node; and the `packed browse binary` case, which spawns the installed binary through `@orkestrel/mcp`'s stdio client, lists the vocabulary with Chromium absent, then records, saves, lists, edits, and replays a journey.
- [`tests/setup.test.ts`](../tests/setup.test.ts): the scripted CDP fixtures, the element and registry replies, the popup discovery fixtures, the journey module instrument, and the compiled-timer instrument the core suites use; the store suites both twins of each journey store run live in `tests/src/core/stores/suite.ts`.
- [`tests/setupBrowser.test.ts`](../tests/setupBrowser.test.ts): the same-origin probe documents the in-page suites drive.
- [`tests/setupConformance.test.ts`](../tests/setupConformance.test.ts): the mirror reader's digest refusal on a changed byte and the row readers the conformance project uses.
- [`tests/setupGlobal.test.ts`](../tests/setupGlobal.test.ts): the global setup that serves fixtures and launches the browser the in-page suites reach.
- [`tests/setupServer.test.ts`](../tests/setupServer.test.ts): the ports, processes, scratch directories, CDP test server, fixture pages, the journey module stage, and the browse launch double and stdio pair the server and service suites share; the filesystem suite the file stores run, two processes over one directory included, lives in `tests/src/server/stores/suite.ts`.
- [`tests/setupService.test.ts`](../tests/setupService.test.ts): the service project's browser flags, engine selection, and registry reading.
- [`tests/service/browser.test.ts`](../tests/service/browser.test.ts): a real browser's launch, navigation, elements, frames, routes, snapshots, PDF, result limits, reattachment, transport loss, and shutdown; the out-of-process frame click, occlusion, hit-test, stale-reference, reading, and wait proofs; and the `WebMCP` domain reading and its live case.

- [`tests/service/browse.test.ts`](../tests/service/browse.test.ts): eager startup, process and renderer loss, forced exit of a hung Node stand-in, successor calls, and profile cleanup. The synthesized orphan case waits for the owned browser's process-exit event within the sweep's attach and close deadlines plus `BROWSER_KILL_GRACE_MS`.
- [`tests/service/toolset.test.ts`](../tests/service/toolset.test.ts): one toolset task end to end through `createToolManager().execute`, the cart view in the receipt of a click whose form the server answers with a 303 redirect, the destination view after a form submission in a child frame, the `confirm()` and `beforeunload` dialogs, popups and tabs, and each receipt within its deadline; its `journey execute equality` block compares `execute` with a direct call for every native action, an editable combobox, a click that opens a dialog, a tab switch, a link that opens a popup, and a click in a same-origin child frame of the DOM placement.
- [`tests/service/codegen.test.ts`](../tests/service/codegen.test.ts): the page recorder's steps for each gesture on Chromium against the fixture's own event log, the edit boundaries, and a password that never crosses the binding.
- [`tests/service/journey.test.ts`](../tests/service/journey.test.ts): the `journey semantic replay` block, a changed page resolved by name with a duplicate refused before any input and a matching CSS selector refused; the `compiled module equality` block, each generated module and its replay reaching one page outcome with the same receipts, a gap, and the type check; and the `journey replay coordination, preparation, tools, and secrecy` block, the hold, a timeout, preparation before any side effect, the tools over the file stores, and a secret kept out of every artifact.
- [`tests/service/document.test.ts`](../tests/service/document.test.ts): the built in-page face served into a real page and compared with the CDP outline of the same page, and its untrusted receipts against CDP's trusted ones.
- [`tests/src/core/CDPClient.test.ts`](../tests/src/core/CDPClient.test.ts): JSON-RPC framing, session scoping, timeouts, abort signals, reconnects, and teardown over an in-memory transport.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts): the core factories, including a toolset that fills the supplied manager only at `start()`, and the recorder, replay, and memory store factories composed through a recorded replay.
- [`tests/src/core/BrowserContext.test.ts`](../tests/src/core/BrowserContext.test.ts): the context lifecycle, the destructive target diff `sync()` performs, and the popups its pages open.
- [`tests/src/core/BrowserPage.test.ts`](../tests/src/core/BrowserPage.test.ts): navigation, both navigation events, the navigation steps and their ownership rule, out-of-process frame sessions attached paused and resumed after their enablement, DOM readiness, the page input stream, text waits, popups, and the popup records.
- [`tests/src/core/BrowserFrame.test.ts`](../tests/src/core/BrowserFrame.test.ts): evaluation, readings, handles, sends with timeouts and signals, and the result-size guard of one frame.
- [`tests/src/core/BrowserTransition.test.ts`](../tests/src/core/BrowserTransition.test.ts): the shared in-flight transition every joining caller awaits.
- [`tests/src/core/BrowserReading.test.ts`](../tests/src/core/BrowserReading.test.ts): distilled and whole Markdown and text, line-break slicing with a constant total, and derived staleness.
- [`tests/src/core/BrowserRegistry.test.ts`](../tests/src/core/BrowserRegistry.test.ts): detection, the mirror, invocation settlement, cancellation, adoption, and destroy over the `WebMCP` domain.
- [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts): the vocabulary, reserved names, dialogs, the action queue, the submit observers and the navigation settlement of each action, views and tabs, page-tool adoption, bounds, destroy, the trust marker, `execute` and its actions, the hold, the secret receipt, the popup a click settles on, the `tabs()` listing, `follow` and its target and tab resolution, and the construction under `journeys`.
- [`tests/src/core/elements/BrowserPageElement.test.ts`](../tests/src/core/elements/BrowserPageElement.test.ts): the ordered trusted click, its refusals, key and pointer releases after an abort, and the remaining element actions.
- [`tests/src/core/elements/BrowserElementManager.test.ts`](../tests/src/core/elements/BrowserElementManager.test.ts): the outline, session-qualified references, invalidation, queries, waits, and the one isolated world per document.
- [`tests/src/core/BrowserHandle.test.ts`](../tests/src/core/BrowserHandle.test.ts): remote-handle retention and disposal.
- [`tests/src/core/compilers.test.ts`](../tests/src/core/compilers.test.ts): the in-page expressions the wait, read, select, hit, screenshot, and storage compilers emit, with one deadline timer per wait, and the journey module and its literals byte for byte.
- [`tests/src/core/BrowserKeyboard.test.ts`](../tests/src/core/BrowserKeyboard.test.ts): trusted keyboard input and the chord grammar `extractBrowserChord` accepts.
- [`tests/src/core/BrowserMouse.test.ts`](../tests/src/core/BrowserMouse.test.ts): trusted mouse input and the pressed-button mask.
- [`tests/src/core/BrowserTouch.test.ts`](../tests/src/core/BrowserTouch.test.ts): trusted touch input.
- [`tests/src/core/BrowserNetworkManager.test.ts`](../tests/src/core/BrowserNetworkManager.test.ts): request observation, bodies, extra headers, offline mode, and credentials.
- [`tests/src/core/BrowserRoute.test.ts`](../tests/src/core/BrowserRoute.test.ts): interception decided exactly one time by fulfilment, continuation, or abort.
- [`tests/src/core/BrowserHARManager.test.ts`](../tests/src/core/BrowserHARManager.test.ts): HAR recording and replay.
- [`tests/src/core/BrowserWebSocket.test.ts`](../tests/src/core/BrowserWebSocket.test.ts): observed WebSocket frames.
- [`tests/src/core/BrowserDownload.test.ts`](../tests/src/core/BrowserDownload.test.ts): download progress and `abort`.
- [`tests/src/core/BrowserSnapshot.test.ts`](../tests/src/core/BrowserSnapshot.test.ts): snapshot walking, structural relationships, search, paths, and the serializable form.
- [`tests/src/core/BrowserAccessibility.test.ts`](../tests/src/core/BrowserAccessibility.test.ts): accessibility-tree capture.
- [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts): the coercions every protocol parser applies to off-shape input, the reference spellings `parseBrowserReference` accepts, the page recorder's gesture payloads, and the journey, edit, and run parsers.
- [`tests/src/core/BrowserClock.test.ts`](../tests/src/core/BrowserClock.test.ts): the virtual clock.
- [`tests/src/core/BrowserCoverage.test.ts`](../tests/src/core/BrowserCoverage.test.ts): JavaScript and CSS coverage.
- [`tests/src/core/BrowserProfiler.test.ts`](../tests/src/core/BrowserProfiler.test.ts): the sampled CPU profile.
- [`tests/src/core/BrowserTracing.test.ts`](../tests/src/core/BrowserTracing.test.ts): a trace streamed back through the IO domain.
- [`tests/src/core/BrowserPerformance.test.ts`](../tests/src/core/BrowserPerformance.test.ts): Performance-domain metrics.
- [`tests/src/core/BrowserDiagnostics.test.ts`](../tests/src/core/BrowserDiagnostics.test.ts): the diagnostics teardown, which discards a failure from an already-stopped capability.
- [`tests/src/core/BrowserCookieManager.test.ts`](../tests/src/core/BrowserCookieManager.test.ts): context-scoped cookies.
- [`tests/src/core/BrowserStorageManager.test.ts`](../tests/src/core/BrowserStorageManager.test.ts): context-scoped web storage as one serializable state.
- [`tests/src/core/BrowserPermissionManager.test.ts`](../tests/src/core/BrowserPermissionManager.test.ts): context-scoped permission overrides.
- [`tests/src/core/BrowserEmulationManager.test.ts`](../tests/src/core/BrowserEmulationManager.test.ts): context-scoped emulation and the overrides a later page inherits.
- [`tests/src/core/BrowserScriptManager.test.ts`](../tests/src/core/BrowserScriptManager.test.ts): new-document scripts and host bindings.
- [`tests/src/core/recorders/BrowserCodegen.test.ts`](../tests/src/core/recorders/BrowserCodegen.test.ts): the page recorder's semantic steps, edit folding and boundaries, gaps, the password marker, frame installation before resume, its lifecycle, and journey compilation.
- [`tests/src/core/recorders/BrowserRecorder.test.ts`](../tests/src/core/recorders/BrowserRecorder.test.ts): the toolset recorder's steps, the interrupted and child-frame gaps, the held journey's gap, secret bindings, and its lifecycle.
- [`tests/src/core/BrowserReplay.test.ts`](../tests/src/core/BrowserReplay.test.ts): preparation before any hold, execution and stopping, the dialog continuation, abort, the run write and its bound, captures through the run store, output, and secrets.
- [`tests/src/core/BrowserHold.test.ts`](../tests/src/core/BrowserHold.test.ts): the hold's token and its one release.
- [`tests/src/core/BrowserJourneyToolset.test.ts`](../tests/src/core/BrowserJourneyToolset.test.ts): the journey tools, every result and refusal verbatim, the listing and its cut, `readonly`, the signal, the `ref` conversion, and destroy.
- [`tests/src/core/stores/MemoryBrowserJourneyStore.test.ts`](../tests/src/core/stores/MemoryBrowserJourneyStore.test.ts) and [`tests/src/core/stores/MemoryBrowserRunStore.test.ts`](../tests/src/core/stores/MemoryBrowserRunStore.test.ts): the shared store suites over the memory twins, and a capture that keeps no bytes.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts): each journey invariant with a failing case, the step, parameter, and edit validators, and the run validator.
- [`tests/src/core/BrowserDialog.test.ts`](../tests/src/core/BrowserDialog.test.ts): accepting and dismissing a dialog.
- [`tests/src/core/BrowserFileChooser.test.ts`](../tests/src/core/BrowserFileChooser.test.ts): uploading to and dismissing a file chooser.
- [`tests/src/core/BrowserWorker.test.ts`](../tests/src/core/BrowserWorker.test.ts): attached workers.
- [`tests/src/core/BrowserNavigationManager.test.ts`](../tests/src/core/BrowserNavigationManager.test.ts): URL waits across both navigation kinds, network idle, abort, and the records the manager opens.
- [`tests/src/core/BrowserNavigationRecord.test.ts`](../tests/src/core/BrowserNavigationRecord.test.ts): the record's destinations, supersession, loader matching, same-document completion, bounds, abort, and close.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts): the pure decoders, validators, and renderers of `src/core`, the receipt and outline formats included, the exact-name filter, the journey edits, listing, triggers, secret names, run ids, and run render.
- [`tests/src/core/errors.test.ts`](../tests/src/core/errors.test.ts): both error classes, their guards, bare codes, and the step action.
- [`tests/src/browser/BrowserDOMView.test.ts`](../tests/src/browser/BrowserDOMView.test.ts): reading, staleness on the Navigation API, following the window, text waits, and destroy.
- [`tests/src/browser/BrowserDOMWait.test.ts`](../tests/src/browser/BrowserDOMWait.test.ts): the wait parked on mutations and finished transitions and animations across frames and shadow roots, its deadline, abort, and `pagehide`.
- [`tests/src/browser/elements/BrowserDOMElement.test.ts`](../tests/src/browser/elements/BrowserDOMElement.test.ts): untrusted click, fill, select, and submit, and each refusal they name.
- [`tests/src/browser/elements/BrowserDOMElementManager.test.ts`](../tests/src/browser/elements/BrowserDOMElementManager.test.ts): the DOM outline, references, bindings, queries, and waits.
- [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts): the in-page factories, the own-document refusal, and the composition with `@orkestrel/mcp`'s bridge over this package's WebMCP double.
- [`tests/src/browser/helpers.test.ts`](../tests/src/browser/helpers.test.ts): role, name, text, visibility, and traversal helpers.
- [`tests/src/browser/types.test.ts`](../tests/src/browser/types.test.ts): the structural fit of `@orkestrel/mcp`'s model context to `BrowserToolSourceInterface`, and each in-page class against its core contract.
- [`tests/src/browser/transports/SocketCDPTransport.test.ts`](../tests/src/browser/transports/SocketCDPTransport.test.ts): the in-page socket transport against a real browser, with a browser launched without `--remote-allow-origins` as its control.
- [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts): the discover, connect, launch, adopt, disconnect, destroy, and close lifecycle against a spawned stand-in process, the endpoint read from standard error, and the launcher hand-off.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts): system-browser discovery, profiles, the endpoint read, and target fetching.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts): the server factories against real files and a real in-process CDP endpoint, the file store factories included.
- [`tests/src/server/BrowserMCPServer.test.ts`](../tests/src/server/BrowserMCPServer.test.ts): the launch before any request and the vocabulary, the handshake gate, the onset refusal on each surface, the restart bound, failover and its shared acquire, the loss notes and unresolved calls, the sweep and the shutdown recheck, profiles, forwarding with the signal, `dialog`, mirrored page tools, `readonly`, and teardown on the end of input, `SIGTERM`, and `SIGINT`.
- [`tests/src/server/stores/FileBrowserJourneyStore.test.ts`](../tests/src/server/stores/FileBrowserJourneyStore.test.ts), [`tests/src/server/stores/FileBrowserRunStore.test.ts`](../tests/src/server/stores/FileBrowserRunStore.test.ts), and [`tests/src/server/stores/FileBrowserStore.test.ts`](../tests/src/server/stores/FileBrowserStore.test.ts): the shared store suites and the filesystem suite over the file twins, symbolic links at each component, captures confined to an opened run directory, a failed write, and the lock.
- [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts): the manifest's `bin.browse`, the built entry spawned with no browser, its exit on the end of input and on `SIGTERM`, and a malformed environment variable.
- [`tests/src/server/integration.test.ts`](../tests/src/server/integration.test.ts): a registry invocation settled from a reply and an event sent in one socket write.
- [`tests/src/server/transports/WebSocketCDPTransport.test.ts`](../tests/src/server/transports/WebSocketCDPTransport.test.ts): the `WebSocket`-backed transport against a real in-process CDP server.
- [`tests/src/server/writers/FileBrowserWriter.test.ts`](../tests/src/server/writers/FileBrowserWriter.test.ts): the filesystem writer that creates its missing parent directories.
