# Browser

> A Chrome DevTools Protocol automation layer for Chromium-family browsers: an
> environment-agnostic core that drives pages, elements, and readings over an injected transport
> and publishes them as agent tools, an in-page face that drives a DOM document with native APIs,
> and a Node runtime that finds, launches, and connects to the browser itself.

The package has three library faces, each with one import specifier, and the `browse` binary.

- The core, `@orkestrel/browser`, compiles against `ESNext` and `WebWorker` with no DOM and no Node. `CDPClient` frames CDP messages over an injected `CDPTransportInterface`; `BrowserContext`, `BrowserPage`, and `BrowserFrame` model a browser context, its tabs, and their documents; `page.elements` outlines a page from its accessibility tree and acts on stable element references with trusted input; `frame.read()` captures a document as a `BrowserReadingInterface` value; `page.registry` mirrors the experimental `WebMCP` protocol domain; and `BrowserToolset` publishes all of it as `@orkestrel/tool` tools that an agent calls. The core also records, edits, replays, and compiles journeys, which [Journeys](#journeys) describes: `BrowserRecorder` and `page.codegen()` record steps, `BrowserReplay` replays them, `BrowserJourneyToolset` gives a model the six journey tools, `compileBrowserJourney` emits a module a developer runs, and two memory stores keep journeys and runs.
- The in-page face, `@orkestrel/browser/browser`, adds the DOM. `BrowserDOMView` drives a document with `HTMLElement.click()`, native value setters, `form.requestSubmit()`, and `MutationObserver`, and reports what an untrusted event cannot do. `createDocumentToolset` publishes the same vocabulary over that view, and `SocketCDPTransport` carries the core client over the browser's own `WebSocket`, so a worker or an extension page drives a browser over CDP.
- The Node runtime, `@orkestrel/browser/server`, adds `Browser`, which discovers a browser listening on a CDP port, attaches to it, or launches one and reads its endpoint from standard error; `WebSocketCDPTransport`; a filesystem-backed browser writer; the file journey and run stores; and `BrowserMCPServer`, which serves the vocabulary and the journey tools over MCP on stdio.
- The `browse` binary, `src/bin`, reads its environment variables and starts a `BrowserMCPServer`, which starts Chromium before the client's first request; see [Register the browse binary with Claude Code](#register-the-browse-binary-with-claude-code) for its hookup.

The in-page face and the Node runtime each import the core, and neither imports the other; the binary imports the core and the Node runtime. Source: [`src/core`](../src/core), [`src/browser`](../src/browser), [`src/server`](../src/server), and [`src/bin`](../src/bin).

## Surface

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

The following fence registers the browser vocabulary in a tool manager, seeds the first message with the page as `look` returns it, and hands that manager to an `@orkestrel/agent` loop over a local model. The system prompt follows the reading vocabulary. The recorded store proof in `@orkestrel/ollama`, using `qwen3.5:2b-q4_K_M` at temperature 0, used the earlier prompt; see [Drive a page with a small model](#drive-a-page-with-a-small-model-1) under Patterns for the sentences it carries and which tasks it passed.

```ts
import { createAgent } from '@orkestrel/agent'
import { createBrowserToolset } from '@orkestrel/browser'
import { createBrowser } from '@orkestrel/browser/server'
import { createOllama } from '@orkestrel/ollama'
import { createToolManager } from '@orkestrel/tool'

const system =
	'You control a web browser with tools and must call a tool before you answer. ' +
	'The first message shows the page as look returns it; references such as e4 name its elements. ' +
	'To learn a fact, call read with search set to words from your question; when its result ends by naming an offset, call read again with that offset. ' +
	"To use the site's search box, call type with its reference, the words, and submit true. " +
	'To press a button or follow a link, call click with its reference from the latest result. Never invent a reference. ' +
	'If text you expect has not appeared, call wait once. ' +
	'When the task is done, answer in one short sentence.'

const browser = createBrowser({ headless: true })
await browser.connect()
const page = await browser.create({ url: 'https://shop.example.test/' })
const toolset = createBrowserToolset(page, { tools: createToolManager() })
await toolset.start()
toolset.tools.tools().map((tool) => tool.name) // ['look', 'read', 'plain', 'click', 'type', 'press', 'navigate', 'wait']
const seeded = await toolset.tools.execute({
	id: 'seed',
	name: 'look',
	arguments: { search: '' },
})
const view = seeded.success ? String(seeded.value) : seeded.error
const agent = createAgent(createOllama({ model: 'qwen3.5:2b-q4_K_M' }), {
	system,
	tools: toolset.tools,
})
agent.context.messages.add({
	role: 'user',
	content: `What does the Alpine Kettle cost?\n\nThe browser shows this page:\n${view}`,
})
const result = await agent.generate()
await toolset.destroy()
await browser.destroy()
```

### Core

The core runs wherever a `CDPTransportInterface` reaches a browser. The following fence drives the CDP client over an injected transport.

```ts
import { createCDPClient } from '@orkestrel/browser'

const client = createCDPClient({ transport }) // transport: CDPTransportInterface
await client.connect()
const targets = await client.send('Target.getTargets')
await client.close()
```

#### Factories

The following table lists the core factories.

| API                               | Kind     | Summary                                                                                                                   |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `createCDPClient`                 | function | Creates a `CDPClientInterface` bound to the given `CDPTransportInterface`.                                                |
| `createBrowserSnapshot`           | function | Creates a navigable `BrowserSnapshotInterface` over decoded `BrowserSnapshotInput` data.                                  |
| `createBrowserReading`            | function | Creates a `BrowserReadingInterface` over a captured document, parsing its HTML one time.                                  |
| `createBrowserToolset`            | function | Creates a `BrowserToolsetInterface` that publishes the browser vocabulary over one page into a `@orkestrel/tool` manager. |
| `createBrowserRecorder`           | function | Creates a recorder over toolset actions.                                                                                  |
| `createBrowserReplay`             | function | Creates a replay of one journey revision.                                                                                 |
| `createMemoryBrowserJourneyStore` | function | Creates an in-memory journey store with persistent revision counters.                                                     |
| `createMemoryBrowserRunStore`     | function | Creates an in-memory run store without capture directories.                                                               |

The following fence creates a reading from captured markup, a toolset over a page with the journey tools over memory stores, a recorder over that toolset, and a replay of the journey the recorder returns.

```ts
import {
	createBrowserReading,
	createBrowserRecorder,
	createBrowserReplay,
	createBrowserSnapshot,
	createBrowserToolset,
	createMemoryBrowserJourneyStore,
	createMemoryBrowserRunStore,
} from '@orkestrel/browser'

const reading = createBrowserReading({
	url: 'https://example.com/',
	title: 'Example',
	html: '<nav>Menu</nav><main><p>Body</p></main>',
})
reading.markdown({ distill: true }) // { text: 'Body', offset: 0, total: 4 }
const snapshot = createBrowserSnapshot(await page.snapshot()) // navigable again from plain data
const store = createMemoryBrowserJourneyStore()
const runs = createMemoryBrowserRunStore()
const toolset = createBrowserToolset(page, { journeys: { store, runs } })
await toolset.start()
const recorder = createBrowserRecorder(toolset)
await recorder.start() // each action the toolset performs from here on is a step
await toolset.tools.execute({ id: '1', name: 'click', arguments: { ref: 'e4' } })
await recorder.stop()
const journey = recorder.journey({ name: 'place-order', description: 'Place the order' })
const run = await createBrowserReplay(toolset, { journey }, { runs }).execute() // run.outcome: 'complete'
```

#### Classes

The following table lists the core classes. Each implements the behavioral interface of the same name plus `Interface`, which [Methods](#methods) documents.

| API                         | Kind  | Summary                                                                                                                                               |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserAccessibility`      | class | Captures Chromium Accessibility-domain snapshots for one page.                                                                                        |
| `BrowserClock`              | class | Controls the Chromium virtual-time budget for deterministic page timers.                                                                              |
| `BrowserCodegen`            | class | Records semantic page gestures and compiles them into a journey module.                                                                               |
| `BrowserContext`            | class | Owns pages and shared state inside one Chromium browser context.                                                                                      |
| `BrowserCookieManager`      | class | Performs cookie operations isolated to one browser context.                                                                                           |
| `BrowserCoverage`           | class | Collects JavaScript precise coverage and CSS rule usage for one page target.                                                                          |
| `BrowserDiagnostics`        | class | Groups the tracing, coverage, performance, and profiler classes beneath one page.                                                                     |
| `BrowserEmulationManager`   | class | Applies rendering, identity, location, and network emulation for context pages.                                                                       |
| `BrowserFrame`              | class | Represents one attached document frame, evaluated through its own CDP execution world.                                                                |
| `BrowserHARManager`         | class | Records and replays HTTP archives over one page network manager.                                                                                      |
| `BrowserKeyboard`           | class | Sends trusted keyboard input through Chromium's CDP Input domain.                                                                                     |
| `BrowserMouse`              | class | Sends trusted mouse input through Chromium's CDP Input domain.                                                                                        |
| `BrowserNavigationManager`  | class | Parks URL-pattern and network-idle waits on page events and abort signals, and opens the records that settle the navigation an input starts.          |
| `BrowserNetworkManager`     | class | Drives the page-scoped Network and Fetch domain lifecycle.                                                                                            |
| `BrowserPage`               | class | Represents a top-level browser page, including its target lifecycle and child frames.                                                                 |
| `BrowserPerformance`        | class | Reads Performance-domain metrics for one frame.                                                                                                       |
| `BrowserPermissionManager`  | class | Applies permission overrides isolated to one browser context.                                                                                         |
| `BrowserProfiler`           | class | Records sampled JavaScript CPU profiles over one frame's Profiler domain.                                                                             |
| `BrowserReading`            | class | Represents one captured document, parsed one time and projected to Markdown or plain text in bounded slices.                                          |
| `BrowserScriptManager`      | class | Installs new-document scripts and promise-based host functions for one page.                                                                          |
| `BrowserSnapshot`           | class | Represents a navigable, serializable browser DOM snapshot.                                                                                            |
| `BrowserStorageManager`     | class | Imports, exports, and clears cookie and web-storage state for one browser context.                                                                    |
| `BrowserToolset`            | class | Publishes the browser vocabulary as `@orkestrel/tool` tools over one view and adopts the view's own tools beside them.                                |
| `BrowserTouch`              | class | Sends trusted touch input through Chromium's CDP Input domain.                                                                                        |
| `BrowserTracing`            | class | Captures Chromium traces streamed through the IO domain.                                                                                              |
| `BrowserTransition`         | class | Runs one asynchronous transition at a time, shared by every caller that joins it.                                                                     |
| `BrowserWebSocket`          | class | Represents an observable WebSocket connection reconstructed from Network-domain events.                                                               |
| `CDPClient`                 | class | Provides a lightweight Chrome DevTools Protocol client over a `CDPTransportInterface`.                                                                |
| `BrowserPageElement`        | class | Drives a referenced DOM element through its document's isolated world and the page input stream.                                                      |
| `BrowserElementManager`     | class | Captures accessibility trees and binds stable references to their owning frame sessions.                                                              |
| `BrowserRecorder`           | class | Records semantic steps from completed toolset actions and omits refused or timed-out actions.                                                         |
| `BrowserReplay`             | class | Prepares and replays a journey under a toolset hold, retaining its executed prefix.                                                                   |
| `BrowserJourneyToolset`     | class | Registers the journey tools `record`, `save`, `journeys`, `edit`, `replay`, and `forget` over a toolset and owns the recording and the active replay. |
| `MemoryBrowserJourneyStore` | class | Keeps owned journey snapshots and revision counters across deletion.                                                                                  |
| `MemoryBrowserRunStore`     | class | Keeps owned runs under their journey names and producer ids without directories.                                                                      |

#### Constants

The following table lists the core constants.

| API                                    | Kind  | Summary                                                                                                                                                                                                                                                          |
| -------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE64_CHARS`                         | const | Holds the index-ordered base64 alphabet used to build `BASE64_LOOKUP`.                                                                                                                                                                                           |
| `BASE64_LOOKUP`                        | const | Maps each base64 character to its 6-bit value, derived from `BASE64_CHARS`.                                                                                                                                                                                      |
| `BROWSER_DEFAULT_TIMEOUT_MS`           | const | Sets the default timeout for browser connection, requests, and navigation, `30_000` milliseconds.                                                                                                                                                                |
| `BROWSER_RESULT_LIMIT`                 | const | Caps the serialized-character length for an `evaluate()`/`read()` result at `2_500_000`, enforced in-page before the result is returned to CDP.                                                                                                                  |
| `BROWSER_RESULT_LIMIT_SENTINEL_PREFIX` | const | Names the distinctive prefix for the in-page result-limit sentinel error, `'[[ORKESTREL_BROWSER_RESULT_LIMIT]]'`, immediately followed by the serialized length.                                                                                                 |
| `BROWSER_RESULT_LIMIT_PATTERN`         | const | Matches the in-page result-limit sentinel error message, anchored immediately after the `Error:` (optionally `Uncaught Error:`) prefix Chromium prepends to a thrown error's description, `/^(?:Uncaught )?Error: \[\[ORKESTREL_BROWSER_RESULT_LIMIT\]\](\d+)/`. |
| `BROWSER_SNAPSHOT_NODE_LIMIT`          | const | Sets the default maximum node count accepted from a decoded CDP DOM snapshot, `100_000`.                                                                                                                                                                         |
| `BROWSER_FRAME_WORLD_NAME`             | const | Names the isolated world used for iframe evaluation, `'__orkestrelBrowserFrame'`.                                                                                                                                                                                |
| `BROWSER_STABLE_FRAME_COUNT`           | const | Sets the number of animation frames whose element bounds must agree before trusted input.                                                                                                                                                                        |
| `BROWSER_CONTEXT_LOSS_PATTERN`         | const | Matches protocol errors caused by replacement or closure of an execution context.                                                                                                                                                                                |
| `BROWSER_WAIT_EVENTS`                  | const | Names the finished transitions and animations that wake a parked wait.                                                                                                                                                                                           |
| `BROWSER_KEY_MODIFIERS`                | const | Maps a canonical modifier name to its CDP Input modifier bit value.                                                                                                                                                                                              |
| `BROWSER_MOUSE_BUTTON_MASKS`           | const | Maps each public mouse button to its CDP Input pressed-button bit value.                                                                                                                                                                                         |
| `BROWSER_HAR_CREATOR`                  | const | Names the tool identity embedded in HAR 1.2 documents.                                                                                                                                                                                                           |
| `BROWSER_SCREENSHOT_ATTRIBUTE`         | const | Names the attribute that tags temporary screenshot styles and masks.                                                                                                                                                                                             |
| `BROWSER_NAVIGATION_REASONS`           | const | Lists every CDP `Page.ClientNavigationReason` value a page accepts as a navigation's reason, as of Chromium 141; a page reads any other reason as undefined.                                                                                                     |
| `BROWSER_RELOAD_NAVIGATION_TYPES`      | const | Lists the CDP `Page.frameStartedNavigating` `navigationType` values that repeat or restore a history entry rather than follow a request, as of Chromium 141.                                                                                                     |
| `BROWSER_SUBMIT_KEY`                   | const | Names the isolated-world property that holds the `submit` observer an action installs before its input, `'__orkestrelSubmit'`.                                                                                                                                   |
| `BROWSER_STOP_LOADING_TIMEOUT_MS`      | const | Bounds the best-effort `Page.stopLoading` call issued after a failed `navigate()` at `1_000` milliseconds.                                                                                                                                                       |
| `BROWSER_DEFAULT_VIEWPORT_WIDTH`       | const | Sets the default viewport width, `1280` pixels.                                                                                                                                                                                                                  |
| `BROWSER_DEFAULT_VIEWPORT_HEIGHT`      | const | Sets the default viewport height, `720` pixels.                                                                                                                                                                                                                  |
| `BROWSER_CODEGEN_BINDING_NAME`         | const | Names the CDP runtime binding the codegen recorder script calls into, `'__orkestrelBrowserCodegen'`.                                                                                                                                                             |
| `BROWSER_CODEGEN_SOURCE`               | const | Holds the self-contained document listener installed before a frame resumes. Password input carries a marker; only Enter carries a key. Node indices are local to a document.                                                                                    |
| `BROWSER_REGISTRY_ABSENT_CODE`         | const | Identifies the CDP method-not-found response when WebMCP is absent.                                                                                                                                                                                              |
| `BROWSER_REGISTRY_OUTPUT_LIMIT`        | const | Bounds adopted tool JSON output and error messages to 4096 UTF-16 code units.                                                                                                                                                                                    |
| `BROWSER_REFERENCE_PREFIX`             | const | Prefixes stable element references within a browser context.                                                                                                                                                                                                     |
| `BROWSER_OUTLINE_LIMIT`                | const | Bounds the default number of actionable elements in an outline.                                                                                                                                                                                                  |
| `BROWSER_SEARCH_PATTERN`               | const | Matches one word of an outline search and of a row's role and name: a run of at least 3 letters or digits.                                                                                                                                                       |
| `BROWSER_INTERACTIVE_ROLES`            | const | Names accessibility roles that receive actionable outline references.                                                                                                                                                                                            |
| `BROWSER_ELEMENT_REFUSALS`             | const | Maps the first line of each refusal the compiled element functions throw, without its `Error: ` prefix, to the reason and the one-line detail an element action reports it with.                                                                                 |
| `BROWSER_OUTLINE_OMITTED_ROLES`        | const | Names accessibility roles whose own rows add no outline content.                                                                                                                                                                                                 |
| `BROWSER_TEXT_ROLES`                   | const | Names accessibility roles rendered as text without an actionable reference.                                                                                                                                                                                      |
| `BROWSER_TOOL_LIMIT`                   | const | Bounds each tool result and error message at `4_000` UTF-16 code units before its footer.                                                                                                                                                                        |
| `BROWSER_TOOL_TIMEOUT_MS`              | const | Sets the `wait` tool's default and an action receipt's bound on a requested navigation, `5_000` milliseconds.                                                                                                                                                    |
| `BROWSER_TOOL_CAPTURE_MS`              | const | Reserves `1_000` milliseconds of an action receipt's `BROWSER_TOOL_TIMEOUT_MS` deadline for the view capture, so a receipt whose navigation wait reaches its bound still carries the view.                                                                       |
| `BROWSER_TOOL_DEADLINE_NOTE`           | const | Holds the note an action receipt carries in place of the view when the receipt's deadline passed before the view could be captured.                                                                                                                              |
| `BROWSER_TOOL_CHANGED_NOTE`            | const | Holds the note an action receipt carries in place of the view when the page changed under the capture twice: once after the action, and again during the one retry that follows the page's readiness.                                                            |
| `BROWSER_TOOL_HANDLED_STATUS`          | const | Holds the status an action receipt carries after a submission a page listener prevented, with no navigation after it, naming `wait` as the next call because the page's outcome can arrive later.                                                                |
| `BROWSER_TOOL_PENDING_NOTE`            | const | Holds the refusal for a hold requested while an earlier input remains pending.                                                                                                                                                                                   |
| `BROWSER_OBSERVATION_TOOL_NAMES`       | const | Names the tools that observe the view without recording an action.                                                                                                                                                                                               |
| `BROWSER_TOOL_CUT_FOOTER`              | const | Holds the clause that ends the footer of a cut result other than an action or `dialog` receipt that carries a view, including `look` and `read` results.                                                                                                         |
| `BROWSER_TOOL_VIEW_FOOTER`             | const | Holds the clause that ends the footer of a cut action or `dialog` receipt that carries a view, and names `look` as the call that finds an element the cut view leaves out.                                                                                       |
| `BROWSER_TYPED_ROLES`                  | const | Names the accessibility roles the `type` tool writes to: `textbox`, `searchbox`, and `spinbutton` take typed text, and `combobox` and `listbox` take a select control's option or, for a text input with suggestions, typed text.                                |
| `BROWSER_TOOL_TIMEOUT_LIMIT_MS`        | const | Caps the `wait` tool's `timeout` parameter at `30_000` milliseconds.                                                                                                                                                                                             |
| `BROWSER_TOOL_NAMES`                   | const | Names every tool the browser toolset reserves: `look`, `read`, `plain`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `tabs`, and `switch`.                                                                                                            |
| `BROWSER_TOOL_NAME_PATTERN`            | const | Matches a page tool name the toolset can advertise: 1 to 64 ASCII letters, digits, underscores, and hyphens.                                                                                                                                                     |
| `BROWSER_SCHEMES`                      | const | Names the URL schemes the `navigate` tool accepts by default: `http:` and `https:`.                                                                                                                                                                              |
| `BROWSER_TOOL_COPY`                    | const | Holds the advertised definition of each reserved tool: its description, its JSON Schema parameters, and its annotations.                                                                                                                                         |
| `BROWSER_JOURNEY_TOOL_NAMES`           | const | Names the journey tools a toolset constructed with `journeys` registers and reserves: `record`, `save`, `journeys`, `edit`, `replay`, and `forget`.                                                                                                              |
| `BROWSER_JOURNEY_ACTIONS`              | const | Names the native actions a journey step can hold: `click`, `type`, `press`, `navigate`, `wait`, `dialog`, and `switch`.                                                                                                                                          |
| `BROWSER_ACTION_OUTCOMES`              | const | Lists every outcome a `BrowserAction` and a run step carry: `done`, `refused`, `timeout`, and `interrupted`.                                                                                                                                                     |
| `BROWSER_ACTION_STAGES`                | const | Lists every navigation stage a `BrowserAction` and a run step carry: `requested`, `committed`, and `loaded`.                                                                                                                                                     |
| `BROWSER_JOURNEY_NAME_PATTERN`         | const | Matches a journey name: lowercase letters and digits in words joined by single hyphens, at most 64 characters, and never a Windows reserved device name.                                                                                                         |
| `BROWSER_JOURNEY_PARAMETER_PATTERN`    | const | Matches a journey parameter name: a lowercase letter followed by letters and digits.                                                                                                                                                                             |
| `BROWSER_RUN_ID_PATTERN`               | const | Matches a run id containing an ISO timestamp with hyphenated time and a hexadecimal suffix.                                                                                                                                                                      |
| `BROWSER_JOURNEY_STEP_KEYS`            | const | Names native tool arguments represented by journey targets, tabs, or secret bindings.                                                                                                                                                                            |
| `BROWSER_JOURNEY_NON_STEP_TOOLS`       | const | Names observation and journey tools that cannot become journey steps.                                                                                                                                                                                            |
| `BROWSER_JOURNEY_FORMAT_VERSION`       | const | Holds the journey and run file format this package writes and reads, `1`.                                                                                                                                                                                        |
| `BROWSER_JOURNEY_EMPTY_LISTING`        | const | Holds the result the `journeys` tool returns when no journey is saved.                                                                                                                                                                                           |
| `BROWSER_JOURNEY_READONLY_REFUSAL`     | const | Holds the refusal `record`, `save`, `edit`, and `forget` return when the journeys are read-only.                                                                                                                                                                 |
| `BROWSER_JOURNEY_RECORDING_REFUSAL`    | const | Holds the refusal `record` returns while another journey is recording.                                                                                                                                                                                           |
| `BROWSER_JOURNEY_IDLE_REFUSAL`         | const | Holds the refusal `save` returns when no journey is recording.                                                                                                                                                                                                   |

#### Errors

Every error carries a machine-readable `code` and an optional `context` record, and each class has a guard. The following table lists the core errors and their guards.

| API                         | Kind     | Summary                                                                                                                                                                                                                                      |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserError`              | class    | Represents the base error for all browser automation operations, carrying the code `BROWSER_ERROR` and a `context` record.                                                                                                                   |
| `BrowserElementError`       | class    | Reports a refused element operation with a reason and, for `GONE`, the refresh directive.                                                                                                                                                    |
| `isBrowserElementError`     | function | Checks whether a value is an element refusal.                                                                                                                                                                                                |
| `BrowserStepError`          | class    | Reports a journey step whose action did not complete, under the code `BROWSER_STEP_ERROR`, with the performed action in `action`.                                                                                                            |
| `isBrowserStepError`        | function | Checks whether a value is a journey step error.                                                                                                                                                                                              |
| `CDPError`                  | class    | Reports that a CDP request received an error response from the remote endpoint, under the code `BROWSER_CDP_ERROR`, with the `method`, the CDP `code`, the `message`, and any `data` in its context.                                         |
| `CDPConnectionError`        | class    | Reports that a CDP request could not be sent or completed because the client was not in a connectable state — not connected, closed while connecting, or the connection dropped mid-request — under the code `BROWSER_CDP_CONNECTION_ERROR`. |
| `CDPTimeoutError`           | class    | Reports that a pending CDP request was not answered within its timeout window, under the code `BROWSER_CDP_TIMEOUT_ERROR`.                                                                                                                   |
| `BrowserResultLimitError`   | class    | Reports that an `evaluate()`/`read()` result exceeded `BROWSER_RESULT_LIMIT` and was rejected in-page before it could overflow the CDP transport frame, under the code `BROWSER_RESULT_LIMIT_ERROR`.                                         |
| `isBrowserError`            | function | Narrows an unknown value to a `BrowserError`.                                                                                                                                                                                                |
| `isCDPError`                | function | Narrows an unknown value to a `CDPError`.                                                                                                                                                                                                    |
| `isCDPConnectionError`      | function | Narrows an unknown value to a `CDPConnectionError`.                                                                                                                                                                                          |
| `isCDPTimeoutError`         | function | Narrows an unknown value to a `CDPTimeoutError`.                                                                                                                                                                                             |
| `isBrowserResultLimitError` | function | Narrows an unknown value to a `BrowserResultLimitError`.                                                                                                                                                                                     |
| `BrowserConnectionError`    | class    | Reports that a CDP connection, discovery, or launch attempt failed, under the code `BROWSER_CONNECTION_ERROR`.                                                                                                                               |
| `isBrowserConnectionError`  | function | Narrows an unknown value to a `BrowserConnectionError`.                                                                                                                                                                                      |

An error names its refusal in `code`. The following table lists every code that reaches a caller, the class that carries it, what throws it, and when.

| Code                           | Class                      | Thrown by                                                                                                                                                              | When                                                                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_ERROR`                | `BrowserError`             | every face                                                                                                                                                             | An argument or option is invalid, a page, frame, handle, worker, or manager is closed or disconnected, a protocol payload is off-shape, a navigation fails or passes its timeout, or a refusal names no code of its own.                                                          |
| `BROWSER_CDP_ERROR`            | `CDPError`                 | `CDPClient.send` and every call that sends through it                                                                                                                  | The remote endpoint answers a request with an error response.                                                                                                                                                                                                                     |
| `BROWSER_CDP_CONNECTION_ERROR` | `CDPConnectionError`       | `CDPClient.send` and every call that sends through it                                                                                                                  | The client is not connected, closes while it connects, or loses the connection while a request is pending.                                                                                                                                                                        |
| `BROWSER_CDP_TIMEOUT_ERROR`    | `CDPTimeoutError`          | `CDPClient.send` and every call that sends through it                                                                                                                  | A request is not answered within its timeout.                                                                                                                                                                                                                                     |
| `BROWSER_RESULT_LIMIT_ERROR`   | `BrowserResultLimitError`  | `evaluate()` and `read()` in both placements, `readBrowserCapture`, and `readBrowserSnapshot`                                                                          | A serialized result or capture is longer than `BROWSER_RESULT_LIMIT` characters, or a DOM snapshot holds more nodes than its limit.                                                                                                                                               |
| `BROWSER_CONNECTION_ERROR`     | `BrowserConnectionError`   | `Browser.connect()`, `WebSocketCDPTransport`, and `SocketCDPTransport`; `fetchCDPTargets` returns it                                                                   | A connection, discovery, or launch attempt fails, or a transport sends before it opens or after it closes.                                                                                                                                                                        |
| `BROWSER_NOT_CONNECTED_ERROR`  | `BrowserNotConnectedError` | `Browser`                                                                                                                                                              | An operation that needs a connection runs while the browser is disconnected.                                                                                                                                                                                                      |
| `BROWSER_DESTROYED_ERROR`      | `BrowserDestroyedError`    | `Browser`                                                                                                                                                              | An operation runs after `destroy()` or `close()`.                                                                                                                                                                                                                                 |
| `BROWSER_ELEMENT_ERROR`        | `BrowserElementError`      | the element actions of both placements, `requireBrowserReference`, and the toolset                                                                                     | An element action is refused, with `context.reason` naming why, or a reference is malformed or absent from the current view.                                                                                                                                                      |
| `BROWSER_STEP_ERROR`           | `BrowserStepError`         | `follow`; a replay records the error's `action` as the step                                                                                                            | A step's action was refused or timed out, or its navigation stopped at `requested` or `committed`.                                                                                                                                                                                |
| `BROWSER_CONTEXT_CLOSED`       | `BrowserError`             | `BrowserContext.create()` and `BrowserContext.sync()`                                                                                                                  | The context is closed, or it closed while `create()` was building the page.                                                                                                                                                                                                       |
| `BROWSER_PAGE_CLOSED`          | `BrowserError`             | `BrowserContext.create()`                                                                                                                                              | The page it created or joined closed before it could return that page.                                                                                                                                                                                                            |
| `BROWSER_TARGET_HELD`          | `BrowserError`             | a page constructed through a context                                                                                                                                   | Another live page holds the page's target.                                                                                                                                                                                                                                        |
| `BROWSER_WAIT_TIMEOUT`         | `BrowserError`             | `wait` on a page or view, `elements.wait`, the outline's wait for DOM readiness, and `BrowserDOMWait`                                                                  | The text or the element does not arrive, or with `absent` does not leave, or the readiness does not arrive before the deadline.                                                                                                                                                   |
| `BROWSER_NAVIGATION_TIMEOUT`   | `BrowserError`             | `navigation.wait`, `navigation.idle`, and a record's `wait`                                                                                                            | No matching navigation, network idle, or navigation start arrives before the timeout.                                                                                                                                                                                             |
| `BROWSER_JSON_ERROR`           | `BrowserError`             | `network.json`                                                                                                                                                         | A response body is not valid JSON.                                                                                                                                                                                                                                                |
| `BROWSER_HAR_ERROR`            | `BrowserError`             | `har.stop`                                                                                                                                                             | The recording failed while it ran.                                                                                                                                                                                                                                                |
| `BROWSER_DOCUMENT`             | `BrowserError`             | `createBrowserDOMView` and `createDocumentToolset`                                                                                                                     | The given value is not a document attached to a window.                                                                                                                                                                                                                           |
| `BROWSER_DOCUMENT_OWN`         | `BrowserError`             | `createBrowserDOMView` and `createDocumentToolset`                                                                                                                     | The given document is `globalThis.document` and `own` is not `true`.                                                                                                                                                                                                              |
| `BROWSER_DOCUMENT_DESTROYED`   | `BrowserError`             | every `BrowserDOMView` call after `destroy()`, and a wait pending at `destroy()`                                                                                       | The view was destroyed.                                                                                                                                                                                                                                                           |
| `BROWSER_DOCUMENT_SUBMIT`      | `BrowserError`             | `submit` in the DOM placement                                                                                                                                          | The form did not submit: its `submit` event was prevented or a field failed validation, which the message names with its `validationMessage`.                                                                                                                                     |
| `BROWSER_ELEMENT_QUERY`        | `BrowserError`             | `find` and `wait` of `BrowserDOMElementManager`                                                                                                                        | The CSS selector is invalid.                                                                                                                                                                                                                                                      |
| `BROWSER_TOOLSET_ARGUMENT`     | `BrowserError`             | every toolset tool and `BrowserToolset` construction                                                                                                                   | A call carries a parameter the tool does not advertise, omits a required string, or carries a value of the wrong type; construction receives a limit that is not a positive integer.                                                                                              |
| `BROWSER_TOOLSET_ROLE`         | `BrowserError`             | `type`                                                                                                                                                                 | The element's role is not in `BROWSER_TYPED_ROLES`.                                                                                                                                                                                                                               |
| `BROWSER_TOOLSET_SCHEME`       | `BrowserError`             | `navigate`                                                                                                                                                             | The address is not absolute, or its scheme is not one the toolset allows.                                                                                                                                                                                                         |
| `BROWSER_TOOLSET_TAB`          | `BrowserError`             | `switch`                                                                                                                                                               | The named tab is not open.                                                                                                                                                                                                                                                        |
| `BROWSER_TOOLSET_DIALOG`       | `BrowserError`             | every toolset tool, `hold()`, and `tabs()`                                                                                                                             | A dialog is open and the tool is not `dialog`, an action waits behind an earlier action whose dialog is still open, `dialog` runs with no dialog open, `hold()` is requested while a dialog is open or an earlier input is pending, or `tabs()` is called while a dialog is open. |
| `BROWSER_TOOLSET_OBSERVE`      | `BrowserError`             | `click`, `type` with `submit`, and `press`                                                                                                                             | The document that receives the input could not be observed for a form submission; the action sends no input, and `context.frame` names that document's frame.                                                                                                                     |
| `BROWSER_TOOLSET_LIMIT`        | `BrowserError`             | `look`, `read`, `plain`, and `journeys`                                                                                                                                | The respective toolset or journeys limit cannot hold the next character at the requested offset.                                                                                                                                                                                  |
| `BROWSER_TOOLSET_RESERVED`     | `BrowserError`             | `start()`                                                                                                                                                              | The manager holds a reserved name under a tool the toolset did not add.                                                                                                                                                                                                           |
| `BROWSER_TOOLSET_CONTEXT`      | `BrowserError`             | the toolset constructor                                                                                                                                                | The options carry `context` without `page`.                                                                                                                                                                                                                                       |
| `BROWSER_TOOLSET_ENDED`        | `BrowserError`             | every toolset tool, `start()`, `tabs()`, and a queued action                                                                                                           | The toolset was destroyed, or `destroy()` ran before startup finished or while the action waited in the queue.                                                                                                                                                                    |
| `BROWSER_TOOLSET_BUSY`         | `BrowserError`             | every action tool, `perform`, `record`, `replay`, and `hold()`                                                                                                         | A replay holds or reserves the toolset and the call lacks its token. `look`, `read`, `plain`, `tabs`, and `wait` pass.                                                                                                                                                            |
| `BROWSER_JOURNEY_FORMAT`       | `BrowserError`             | `validateBrowserJourney`, `validateBrowserRun`, `compileBrowserJourney`, a replay's preparation, and the stores                                                        | A journey or run carries a `format` other than `BROWSER_JOURNEY_FORMAT_VERSION`.                                                                                                                                                                                                  |
| `BROWSER_JOURNEY_INVALID`      | `BrowserError`             | `validateBrowserJourney`, the step, parameter, and run validators, `compileBrowserJourney`, `recorder.journey()`, a replay's preparation, and the memory stores' `set` | A journey breaks an invariant that the message names, or a run's fields are malformed; see [Journeys](#journeys) for the invariants.                                                                                                                                              |
| `BROWSER_JOURNEY_EMPTY`        | `BrowserError`             | `save`                                                                                                                                                                 | The recording has no step; the recorder keeps recording so an action can precede the next save.                                                                                                                                                                                   |
| `BROWSER_JOURNEY_EDIT`         | `BrowserError`             | `editBrowserJourney`, `validateBrowserJourneyEdit`, and `edit`                                                                                                         | An edit is malformed or the batch's final journey breaks an invariant; `context.index` names the edit from 1 and `context.reason` the clause.                                                                                                                                     |
| `BROWSER_JOURNEY_INPUT`        | `BrowserError`             | a replay's preparation, `resolveBrowserJourneyBinding`, and `follow`                                                                                                   | An input names no parameter, a parameter without a default has no input, or a step `follow` receives binds its target name to a parameter.                                                                                                                                        |
| `BROWSER_JOURNEY_GAP`          | `BrowserError`             | a replay's preparation                                                                                                                                                 | A step is `unresolved`.                                                                                                                                                                                                                                                           |
| `BROWSER_JOURNEY_PLACEMENT`    | `BrowserError`             | a replay's preparation                                                                                                                                                 | A native step's action is one the toolset cannot execute, such as `press` in the DOM placement or `switch` without `context`.                                                                                                                                                     |
| `BROWSER_JOURNEY_TARGET`       | `BrowserError`             | `follow`; a replay stops at the step                                                                                                                                   | No element carries the target's role and exact name, or no open tab matches a `switch` step's URL and title.                                                                                                                                                                      |
| `BROWSER_JOURNEY_AMBIGUOUS`    | `BrowserError`             | `follow`; a replay stops at the step                                                                                                                                   | Several elements carry the target's role and exact name, or several tabs match a `switch` step's URL and title.                                                                                                                                                                   |
| `BROWSER_JOURNEY_STALE`        | `BrowserError`             | the journey stores' `set`, and `edit`                                                                                                                                  | `expected` differs from the stored revision.                                                                                                                                                                                                                                      |
| `BROWSER_JOURNEY_LOCKED`       | `BrowserError`             | the file journey store's `set` and `delete`, the file run store's `open` and `clear`, `save`, `edit`, and `forget`                                                     | Another write holds the journey's `journey.lock`; the store refuses at once and never waits.                                                                                                                                                                                      |
| `BROWSER_JOURNEY_FILE`         | `BrowserError`             | the file stores' `get` and `list`, `save`, `edit`, and `forget` for a store failure with no code, and a replay's run write                                             | A stored file is empty, truncated, malformed, or names another journey or run, or the run write passed its bound.                                                                                                                                                                 |
| `BROWSER_JOURNEY_ACCESS`       | `BrowserError`             | the file stores                                                                                                                                                        | The filesystem refused permission; the message names the path.                                                                                                                                                                                                                    |
| `BROWSER_JOURNEY_PATH`         | `BrowserError`             | the file stores and their constructors, the memory stores' name checks, and the memory run store's `capture`                                                           | A journey name is invalid, an id or path escapes the root, a path component is a symbolic link, the root is missing, or a capture names a slot the store did not open.                                                                                                            |
| `BROWSER_JOURNEY_ARGUMENT`     | `BrowserError`             | the stores' `list`, the file stores' constructors, `BrowserJourneyToolset` construction, and `journeys`                                                                | A listing limit is not a positive safe integer, or an offset is not a nonnegative integer; store page offsets must also be safe integers.                                                                                                                                         |
| `BROWSER_JOURNEY_READONLY`     | `BrowserError`             | `record`, `save`, `edit`, and `forget`                                                                                                                                 | The toolset was constructed with `journeys.readonly`.                                                                                                                                                                                                                             |
| `BROWSER_JOURNEY_RECORDING`    | `BrowserError`             | `record`, `save`, `replay`, and `forget`                                                                                                                               | `record` or `replay` runs while a journey is recording, or `save` runs while none is, or `forget` names the recording.                                                                                                                                                            |
| `BROWSER_JOURNEY_SAVED`        | `BrowserError`             | `record`                                                                                                                                                               | A journey of that name is saved.                                                                                                                                                                                                                                                  |
| `BROWSER_JOURNEY_MISSING`      | `BrowserError`             | `edit`, `replay`, and `forget`                                                                                                                                         | No journey of that name is saved.                                                                                                                                                                                                                                                 |
| `BROWSER_SERVER_ENVIRONMENT`   | `BrowserError`             | the `browse` binary                                                                                                                                                    | `BROWSE_HEADLESS` or `BROWSE_READONLY` holds a value other than `true`, `false`, `1`, or `0`; the binary writes `browse: BROWSER_SERVER_ENVIRONMENT: MESSAGE` on one line and exits 1.                                                                                            |

The toolset also carries `BROWSER_TOOLSET_RECEIPT` and `BROWSER_TOOLSET_SETTLED` between its own steps and never lets either reach a caller, and `BROWSER_TOOLSET_PAGE` guards `press`, `navigate`, and `dialog`, which only a page-backed toolset advertises. A replay carries `BROWSER_JOURNEY_DIALOG` for a `dialog` step that follows no `interrupted` action into the run as that step's refusal, and `execute` never rejects with it.

The following fence narrows a caught value with the guards. `BrowserElementError` carries `context.reason`, one of the `BrowserElementReason` values, and a one-line message that ends `; call look for fresh refs.` for `GONE` alone.

```ts
import {
	isBrowserConnectionError,
	isBrowserElementError,
	isBrowserError,
	isBrowserResultLimitError,
	isCDPConnectionError,
	isCDPError,
	isCDPTimeoutError,
} from '@orkestrel/browser'

try {
	await element.click()
} catch (error) {
	if (isBrowserElementError(error))
		log(error.code, error.context) // { reason: 'OCCLUDED', … }
	else if (isCDPError(error)) log(error.code, error.context)
	else if (isCDPConnectionError(error)) log(error.code)
	else if (isCDPTimeoutError(error)) log(error.code)
	else if (isBrowserResultLimitError(error)) log(error.code, error.context)
	else if (isBrowserConnectionError(error)) log(error.code, error.context)
	else if (isBrowserError(error)) log(error.code)
}
```

#### Helpers

The helpers are pure: they decode protocol payloads, validate options, compile in-page expressions, and render tool text, so each runs without a browser. The following table lists the core helpers, parsers, and compilers.

| API                                      | Kind     | Summary                                                                                                                                                                                             |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileQueryWaitExpression`             | function | Compiles a wait woken by mutations and finished transitions and animations, with one deadline and explicit disconnect ownership.                                                                    |
| `compileTextWaitExpression`              | function | Compiles a wait for the presence or absence of visible text, coalesced by tasks.                                                                                                                    |
| `compileSelectFunction`                  | function | Compiles text selection or select-option assignment against the resolved element.                                                                                                                   |
| `compileHitFunction`                     | function | Compiles the descendant hit check for a resolved element.                                                                                                                                           |
| `compileSubmitObserverExpression`        | function | Compiles the installation of a capture-phase `submit` observer owned by `token` on the window of the world it runs in.                                                                              |
| `compileSubmitReadExpression`            | function | Compiles the read of the `submit` observer `compileSubmitObserverExpression` installs for `token`, removing the observer.                                                                           |
| `compileBrowserBindingSource`            | function | Compiles the page-side promise facade for one Runtime binding.                                                                                                                                      |
| `compileBrowserBindingResult`            | function | Compiles delivery of a host binding result to one execution context.                                                                                                                                |
| `compileBrowserBindingCleanup`           | function | Compiles current-document cleanup for one page-side host binding facade.                                                                                                                            |
| `compileScreenshotPreparationExpression` | function | Compiles temporary animation, caret, and mask setup for a screenshot.                                                                                                                               |
| `compileScreenshotCleanupExpression`     | function | Compiles cleanup for temporary screenshot styles and masks.                                                                                                                                         |
| `compileStorageReadExpression`           | function | Compiles an expression that serializes local and session storage.                                                                                                                                   |
| `compileStorageRestoreExpression`        | function | Compiles an expression that restores one origin's web storage.                                                                                                                                      |
| `compileStorageClearExpression`          | function | Compiles an expression that clears local and session storage.                                                                                                                                       |
| `compileGuardedEvaluateExpression`       | function | Compiles a `Runtime.evaluate` expression so the in-page code stringifies its own result and throws a recognizable sentinel error before an oversized result would overflow the CDP transport frame. |
| `compileReadFunction`                    | function | Compiles the in-page function that reads the document's URL, title, and rendered HTML.                                                                                                              |
| `compileActionabilityFunction`           | function | Compiles the element-side actionability pass used before trusted input.                                                                                                                             |
| `normalizeBrowserName`                   | function | Normalizes an accessible name for display and matching.                                                                                                                                             |
| `filterBrowserOutline`                   | function | Filters document-order outline rows by accessibility role and name.                                                                                                                                 |
| `renderBrowserOutline`                   | function | Renders document-order text and referenced elements with a bounded element count.                                                                                                                   |
| `renderBrowserOutlineRow`                | function | Renders one outline row: the node's reference, its role, its quoted accessible name, and the states it carries.                                                                                     |
| `scanBrowserOutline`                     | function | Returns the referenced outline nodes whose role and accessible name share the most words with a search, in document order.                                                                          |
| `collectBrowserWords`                    | function | Collects distinct lowercase words of at least 3 letters or digits.                                                                                                                                  |
| `scanBrowserText`                        | function | Matches the lines sharing the most distinct search words, in document order.                                                                                                                        |
| `renderBrowserMatches`                   | function | Renders matching rows in at most half the available reply room.                                                                                                                                     |
| `composeBrowserPoint`                    | function | Composes a frame-local point with its ancestor frame offsets.                                                                                                                                       |
| `normalizeBrowserKey`                    | function | Normalizes named keys and modifier aliases before trusted keyboard input.                                                                                                                           |
| `renderBrowserToolOutput`                | function | Renders tool strings unchanged, content-array text blocks joined, and other values as bounded JSON.                                                                                                 |
| `deriveBrowserToolSchema`                | function | Derives the advertised input schema from an authored one, adding a required `purpose` parameter when the schema requires nothing.                                                                   |
| `boundBrowserText`                       | function | Bounds a tool string at a character limit, appending a footer that names the cut and the caller's closing clause.                                                                                   |
| `validateBrowserToolArguments`           | function | Refuses a tool call that carries a parameter its definition does not advertise, naming the parameters the tool takes.                                                                               |
| `renderBrowserElement`                   | function | Renders an element as its outline row reads: reference, role, and quoted name.                                                                                                                      |
| `requireBrowserReference`                | function | Requires a tool argument to be an element reference in any spelling `parseBrowserReference` accepts, and returns its canonical form.                                                                |
| `readBrowserToolString`                  | function | Reads a required string argument from a tool call.                                                                                                                                                  |
| `renderBrowserReceipt`                   | function | Renders a tool receipt: the action and its status on one line, the interrupting dialog, then a blank line and the fresh view.                                                                       |
| `decodeBase64`                           | function | Decodes a base64-encoded string into raw bytes.                                                                                                                                                     |
| `encodeBase64`                           | function | Encodes raw bytes as base64 without relying on Node or DOM globals.                                                                                                                                 |
| `textToBytes`                            | function | Encodes UTF-8 text as bytes.                                                                                                                                                                        |
| `bytesToText`                            | function | Decodes UTF-8 bytes as text.                                                                                                                                                                        |
| `browserHeadersToProtocol`               | function | Converts a header record to Fetch-domain name/value entries.                                                                                                                                        |
| `readBrowserHeaders`                     | function | Decodes a Chromium Headers object into string values, skipping every entry that is neither a string nor a finite number.                                                                            |
| `createBrowserHAREntry`                  | function | Builds a standards-shaped HAR 1.2 entry from one observed exchange.                                                                                                                                 |
| `browserHARHeadersToRecord`              | function | Converts HAR name/value headers into a Fetch-domain header record.                                                                                                                                  |
| `validateBrowserHAR`                     | function | Validates the HAR 1.2 fields required for deterministic replay.                                                                                                                                     |
| `matchesBrowserRoute`                    | function | Matches a request against route criteria.                                                                                                                                                           |
| `matchesBrowserURL`                      | function | Matches a URL using Chromium-style `*` and `**` glob segments.                                                                                                                                      |
| `readBrowserScriptIdentifier`            | function | Decodes the `Page.addScriptToEvaluateOnNewDocument` result, throwing a `BrowserError` off-shape.                                                                                                    |
| `validateBrowserPoint`                   | function | Validates viewport input coordinates.                                                                                                                                                               |
| `validateBrowserInputOptions`            | function | Validates the bounded delay, count, and steps of one trusted-input operation.                                                                                                                       |
| `validateBrowserTimeout`                 | function | Validates a public browser timeout before protocol work begins.                                                                                                                                     |
| `validateBrowserViewport`                | function | Validates Chromium viewport metrics.                                                                                                                                                                |
| `validateBrowserEmulationOptions`        | function | Validates context emulation boundaries before partial application.                                                                                                                                  |
| `validateBrowserContextOptions`          | function | Validates isolated-context options before creating remote state.                                                                                                                                    |
| `validateBrowserAccessibilityOptions`    | function | Validates Accessibility-domain snapshot bounds.                                                                                                                                                     |
| `browserPDFToParams`                     | function | Validates and compiles Page.printToPDF parameters.                                                                                                                                                  |
| `browserScreenshotToParams`              | function | Validates and compiles basic Page.captureScreenshot parameters.                                                                                                                                     |
| `validateBrowserRange`                   | function | Validates a finite numeric range.                                                                                                                                                                   |
| `readBrowserAccessibility`               | function | Decodes Accessibility-domain nodes into a flat serializable tree, throwing a `BrowserError` off-shape.                                                                                              |
| `readBrowserAXValue`                     | function | Decodes an Accessibility-domain AXValue, or `undefined` when the record carries none.                                                                                                               |
| `concatBytes`                            | function | Concatenates byte chunks without Node-specific buffers.                                                                                                                                             |
| `readBrowserStreamChunk`                 | function | Decodes one `IO.read` response, throwing a `BrowserError` off-shape.                                                                                                                                |
| `readBrowserScriptCoverage`              | function | Decodes JavaScript precise coverage, throwing a `BrowserError` off-shape.                                                                                                                           |
| `readBrowserStyleCoverage`               | function | Decodes CSS rule usage, throwing a `BrowserError` off-shape.                                                                                                                                        |
| `readBrowserCoverageRanges`              | function | Decodes and normalizes coverage ranges, throwing a `BrowserError` off-shape.                                                                                                                        |
| `readBrowserMetrics`                     | function | Decodes Performance-domain metrics, throwing a `BrowserError` off-shape.                                                                                                                            |
| `readBrowserProfile`                     | function | Decodes one CPU profile, throwing a `BrowserError` off-shape.                                                                                                                                       |
| `readBrowserProfileFrame`                | function | Decodes a CPU profile call frame, throwing a `BrowserError` off-shape.                                                                                                                              |
| `cookieToProtocol`                       | function | Converts a typed cookie input into Chromium protocol fields.                                                                                                                                        |
| `readBrowserCookies`                     | function | Decodes the cookies `Storage.getCookies` returns, throwing a `BrowserError` off-shape.                                                                                                              |
| `readBrowserCookie`                      | function | Decodes one Chromium cookie, throwing a `BrowserError` off-shape.                                                                                                                                   |
| `matchesBrowserCookieURL`                | function | Matches a decoded cookie against one request URL.                                                                                                                                                   |
| `readBrowserStorageOrigin`               | function | Decodes one in-page web-storage snapshot, throwing a `BrowserError` off-shape.                                                                                                                      |
| `readBrowserStorageEntries`              | function | Decodes a list of web-storage entries, throwing a `BrowserError` off-shape.                                                                                                                         |
| `mediaToFeatures`                        | function | Converts typed media preferences to Chromium emulated media features.                                                                                                                               |
| `readBrowserStack`                       | function | Decodes a Chromium runtime stack trace, skipping every off-shape call frame.                                                                                                                        |
| `readBrowserRemoteValue`                 | function | Decodes a Runtime remote object's printable value, falling back to its unserializable form and then its description, or `undefined` when it carries none.                                           |
| `readEvaluationResult`                   | function | Decodes one CDP `Runtime.evaluate` result, throwing a `BrowserError` on a failed evaluation and a `BrowserResultLimitError` past the guarded result size.                                           |
| `requireBrowserString`                   | function | Requires an evaluated browser value to be a string.                                                                                                                                                 |
| `readBrowserWorld`                       | function | Reads the execution context id from a CDP `Page.createIsolatedWorld` reply.                                                                                                                         |
| `extractBrowserSlice`                    | function | Extracts one bounded slice of a projected text, cutting after a line break where one fits.                                                                                                          |
| `readBrowserFrames`                      | function | Decodes a flattened CDP `Page.getFrameTree` result into depth-first frame metadata, skipping every off-shape frame, then appends each attached out-of-process iframe target the tree does not list. |
| `readBrowserQuad`                        | function | Decodes the first `DOM.getContentQuads` quad and its center, throwing a `BrowserError` off-shape.                                                                                                   |
| `extractBrowserChord`                    | function | Extracts a keyboard chord such as `Control+Shift+P` into its parts, throwing a `BrowserError` on an empty chord or an unsupported modifier.                                                         |
| `computeBrowserModifiers`                | function | Computes the CDP Input modifier bitmask.                                                                                                                                                            |
| `computeBrowserButtons`                  | function | Computes the CDP Input pressed-button bitmask.                                                                                                                                                      |
| `keyToBrowserInput`                      | function | Normalizes one key to CDP keyboard event data.                                                                                                                                                      |
| `readRareStringData`                     | function | Decodes CDP snapshot sparse string data into a node-index map, skipping every off-shape entry.                                                                                                      |
| `readRareBooleanData`                    | function | Decodes CDP snapshot sparse boolean data into a set of node indexes, skipping every off-shape entry.                                                                                                |
| `readRareIntegerData`                    | function | Decodes CDP snapshot sparse integer data into a node-index map, skipping every off-shape entry.                                                                                                     |
| `readBrowserAttributes`                  | function | Decodes flattened CDP node attributes into a frozen record, skipping every off-shape pair.                                                                                                          |
| `readBrowserSnapshot`                    | function | Decodes a CDP `DOMSnapshot.captureSnapshot` result into a serializable `BrowserSnapshotInput`, throwing a `BrowserError` off-shape and a `BrowserResultLimitError` past the configured node limit.  |
| `isBrowserNodeQuery`                     | function | Tests whether a browser-node matcher is a declarative query rather than a predicate.                                                                                                                |
| `matchesBrowserNode`                     | function | Tests a captured node against a declarative query.                                                                                                                                                  |
| `isBrowserNodeVisible`                   | function | Tests whether a captured node has a non-empty rendered layout box.                                                                                                                                  |
| `settleBrowserTeardown`                  | function | Awaits every teardown step in order and returns the first failure.                                                                                                                                  |
| `parseBrowserTool`                       | function | Coerces a WebMCP `Tool` object to its browser-domain representation.                                                                                                                                |
| `parseBrowserRemoval`                    | function | Coerces a WebMCP `RemovedTool` object to its document and name key.                                                                                                                                 |
| `parseBrowserInvocation`                 | function | Coerces a WebMCP `toolInvoked` event without parsing its authored input text.                                                                                                                       |
| `parseBrowserInvocationResult`           | function | Coerces a WebMCP `toolResponded` event, preserving output and terminal status.                                                                                                                      |
| `parseBrowserRequest`                    | function | Coerces one `Network.requestWillBeSent` or `Fetch.requestPaused` event to a `BrowserRequest`, or `undefined` off-shape.                                                                             |
| `parseBrowserResponse`                   | function | Coerces one `Network.responseReceived` event to a `BrowserResponse`, or `undefined` off-shape.                                                                                                      |
| `parseBrowserResponseRecord`             | function | Coerces one Chromium response object plus its event identity to a `BrowserResponse`, or `undefined` off-shape.                                                                                      |
| `parseBrowserTiming`                     | function | Coerces Chromium response timing to a `BrowserTiming`, or `undefined` off-shape.                                                                                                                    |
| `parseBrowserTimingRange`                | function | Coerces one named start/end pair of Chromium network timing to a `BrowserTimingRange`, or `undefined` off-shape.                                                                                    |
| `parseBrowserSecurity`                   | function | Coerces Chromium TLS security details to a `BrowserSecurity`, or `undefined` off-shape.                                                                                                             |
| `parseBrowserRequestFailure`             | function | Coerces one `Network.loadingFailed` event to a `BrowserRequestFailure`, or `undefined` off-shape.                                                                                                   |
| `parseBrowserWebSocketFrame`             | function | Coerces one WebSocket frame event to a `BrowserWebSocketFrame`, or `undefined` off-shape.                                                                                                           |
| `parseBrowserBindingCall`                | function | Coerces one Runtime binding invocation to a `BrowserBindingCall`, or `undefined` off-shape.                                                                                                         |
| `parseBrowserAXString`                   | function | Coerces a string-valued Accessibility-domain AXValue to a string, or `undefined` off-shape.                                                                                                         |
| `parseBrowserCookiePartition`            | function | Coerces an optional Chromium cookie partition key to a `BrowserCookiePartition`, or `undefined` off-shape.                                                                                          |
| `parseBrowserConsoleMessage`             | function | Coerces one `Runtime.consoleAPICalled` event to a `BrowserConsoleMessage`, or `undefined` off-shape.                                                                                                |
| `parseBrowserPageError`                  | function | Coerces one `Runtime.exceptionThrown` event to a `BrowserPageError`, or `undefined` off-shape.                                                                                                      |
| `parseBrowserDownloadStart`              | function | Coerces one `Browser.downloadWillBegin` event to a `BrowserDownloadStart`, or `undefined` off-shape.                                                                                                |
| `parseBrowserDownloadProgress`           | function | Coerces one `Browser.downloadProgress` event to a `BrowserDownloadProgress`, or `undefined` off-shape.                                                                                              |
| `parseCodegenActionPayload`              | function | Parses a sanitized document gesture, refusing malformed or secret-bearing payloads.                                                                                                                 |
| `parseNumberArray`                       | function | Coerces an unknown value to an all-number array, or `undefined` off-shape.                                                                                                                          |
| `parseSnapshotString`                    | function | Coerces one CDP snapshot string-table index to its string, or `undefined` off-shape.                                                                                                                |
| `parseBrowserRect`                       | function | Coerces a four-number CSS-pixel rectangle to a `BrowserRect`, or `undefined` off-shape.                                                                                                             |
| `parseBrowserReference`                  | function | Parses the supported element-reference spellings into their canonical form.                                                                                                                         |
| `validateBrowserJourney`                 | function | Validates the journey format and its name, nonempty steps, ids, bindings, secrets, JSON, and actions.                                                                                               |
| `validateBrowserJourneyStep`             | function | Validates one step independently of ids and parameter declarations.                                                                                                                                 |
| `validateBrowserJourneyParameter`        | function | Validates a parameter declaration, including the secret-default exclusion.                                                                                                                          |
| `validateBrowserJourneyEdit`             | function | Validates an edit structure and names the operation and field in each refusal.                                                                                                                      |
| `validateBrowserRun`                     | function | Validates a persisted run and the journey it carries.                                                                                                                                               |
| `buildBrowserJourney`                    | function | Builds a validated journey from recorded steps and declares their secret bindings.                                                                                                                  |
| `isBrowserSecretBinding`                 | function | Checks whether a step binds a declared secret through type.text.                                                                                                                                    |
| `isBrowserJourneyBinding`                | function | Checks whether a native string argument is a literal or a parameter binding.                                                                                                                        |
| `isBrowserJourneyTarget`                 | function | Checks whether a target carries its role, name, and optional evidence.                                                                                                                              |
| `isBrowserJourneyTab`                    | function | Checks whether a tab carries its portable URL and title.                                                                                                                                            |
| `parseBrowserJourney`                    | function | Parses a journey without throwing when validation fails.                                                                                                                                            |
| `parseBrowserJourneyEdit`                | function | Parses an edit without throwing when its structure fails validation.                                                                                                                                |
| `parseBrowserRun`                        | function | Parses a run without throwing when validation fails.                                                                                                                                                |
| `collectBrowserJourneyBindings`          | function | Collects parameter uses from native arguments and target names, keeping page arguments literal.                                                                                                     |
| `resolveBrowserJourneyBinding`           | function | Resolves a native string binding from supplied inputs.                                                                                                                                              |
| `editBrowserJourney`                     | function | Applies an ordered edit batch to a copy and validates its nonempty result and final bindings.                                                                                                       |
| `validateBrowserJourneyName`             | function | Checks a journey name before store access.                                                                                                                                                          |
| `validateBrowserStorePage`               | function | Checks the offset and limit of a store page.                                                                                                                                                        |
| `normalizeBrowserJourneyReason`          | function | Normalizes a failure to its first paragraph without an invariant label, directive, or final period.                                                                                                 |
| `renderBrowserJourneyFault`              | function | Renders an unreadable journey from its name and path-free reason.                                                                                                                                   |
| `isBrowserJourneyValidationContext`      | function | Checks whether a validation context identifies a parameter, step, and field.                                                                                                                        |
| `renderBrowserJourney`                   | function | Renders a journey with its parameter declarations and stable step ids.                                                                                                                              |
| `renderBrowserRun`                       | function | Renders a run heading and its receipts, followed by the supplied final view.                                                                                                                        |
| `renderBrowserRunResult`                 | function | Renders a step receipt without its tool directive or appended view.                                                                                                                                 |
| `deriveBrowserJourneyTrigger`            | function | Derives the trigger text a run records for an action.                                                                                                                                               |
| `deriveBrowserJourneySecret`             | function | Derives an unused lower camel case secret parameter name from an accessible name.                                                                                                                   |
| `collectBrowserJourneyTextBindings`      | function | Collects the parameter names a native `type` step's `text` binds.                                                                                                                                   |
| `generateBrowserRunId`                   | function | Generates a run id from an ISO timestamp and a cryptographic hexadecimal suffix.                                                                                                                    |
| `compileBrowserJourney`                  | function | Compiles a journey into a standalone module that performs each step through the `follow` method of a toolset the module constructs on the page. The module checks its inputs before any step.       |
| `compileBrowserJourneyValue`             | function | Compiles a JSON value into the JavaScript literal a generated journey module carries.                                                                                                               |

The following fence composes the snapshot, page recorder, and evaluation helpers around captured CDP payloads.

```ts
import {
	compileGuardedEvaluateExpression,
	decodeBase64,
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
const gesture = parseCodegenActionPayload(payload) // BrowserCodegenGesture | undefined; undefined for a password value
const value = readEvaluationResult(runtimeResult)
const title = requireBrowserString(value, 'Title')
const frames = readBrowserFrames(frameTreeResult)
const bytes = decodeBase64('iVBORw0=') // Uint8Array [137, 80, 78, 71, 13]
const numbers = parseNumberArray([1, 2, 3])
const text = parseSnapshotString(snapshotStrings, 1)
const rareStrings = readRareStringData(rawRareStrings, snapshotStrings)
const rareBooleans = readRareBooleanData(rawRareBooleans)
const rareIntegers = readRareIntegerData(rawRareIntegers)
const rect = parseBrowserRect([0, 0, 100, 40])
const attributes = readBrowserAttributes(rawAttributes, snapshotStrings)
const decoded = readBrowserSnapshot(rawSnapshot, ['display']) // BrowserSnapshotInput
const node = decoded.documents[0].nodes[0]
const query = { name: 'article', visible: true }
if (isBrowserNodeQuery(query)) matchesBrowserNode(node, query)
const rendered = isBrowserNodeVisible(node)
```

Navigating decoded data is the `BrowserSnapshot` entity's job, not a helper family's; see [`BrowserSnapshotInterface`](#browsersnapshotinterface) later.

The following fence validates, edits, renders, and compiles the `add-kettle` journey; see [Journeys](#journeys) for the journey itself. Each helper is pure; a step runs on a live view through the toolset's `follow`, which [`BrowserToolsetInterface`](#browsertoolsetinterface) shows.

```ts
import type { BrowserJourney } from '@orkestrel/browser'
import {
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
validateBrowserJourney(journey) // throws BROWSER_JOURNEY_FORMAT or BROWSER_JOURNEY_INVALID naming the invariant
validateBrowserJourneyStep(journey.steps[3])
validateBrowserJourneyParameter({ secret: true, default: 'x' }) // throws BROWSER_JOURNEY_INVALID: 'Invariant 5 (secrets): declares a secret with a default'
validateBrowserJourneyEdit({ operation: 'remove', id: 's3' })
validateBrowserRun(JSON.parse(runFile)) // a run.json file's parsed text
parseBrowserJourney({ ...journey, name: 'Add kettle' }) // undefined
parseBrowserJourneyEdit({ operation: 'rename', id: 's3' }) // undefined
parseBrowserRun(JSON.parse(runFile)) // BrowserRun | undefined
buildBrowserJourney([], { name: 'check-ready', description: 'Check readiness' })
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
generateBrowserRunId() // '2026-10-01T03-10-46.448Z-b0cc'
const edited = editBrowserJourney(journey, [
	{ operation: 'remove', id: 's3' },
	{ operation: 'add', step: { action: 'press', arguments: { key: 'Enter' } }, after: 's4' },
]) // steps s1, s2, s4, s6, s5; next 7
editBrowserJourney(journey, [
	{ operation: 'declare', name: 'coupon', parameter: { default: 'TEA10' } },
]) // throws BROWSER_JOURNEY_EDIT: 'Edit 1 is refused: it declares "coupon" but no step binds it'
renderBrowserJourney(edited) // the listing Journeys shows
renderBrowserRun(run, view) // the head line, one line per step, a blank line, and the view
renderBrowserRunResult(
	'Clicked e7 button "Delete". A confirm dialog is open: "Delete the draft?"; call dialog.',
) // the line without '; call dialog'
compileBrowserJourneyValue(
	{ text: { parameter: 'email' }, submit: true },
	new Map([['email', 'inputs.email']]),
) // '{ text: inputs.email, submit: true }'
compileBrowserJourney(journey, { language: 'typescript' }) // { source, gaps: [] }
```

The following fence composes the element, reading, and tool helpers the element managers and the toolset are built from.

```ts
import {
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
	parseBrowserRemoval,
	parseBrowserTool,
	readBrowserToolString,
	readBrowserWorld,
	renderBrowserElement,
	renderBrowserOutline,
	renderBrowserReceipt,
	renderBrowserToolOutput,
	requireBrowserReference,
	validateBrowserToolArguments,
} from '@orkestrel/browser'

parseBrowserReference('[ref=e12]') // 'e12'
parseBrowserReference('x12') // undefined
requireBrowserReference('12') // 'e12'; throws a coded BrowserElementError naming look for 'x12'
normalizeBrowserKey('ctrl+a') // 'Control+a'
normalizeBrowserName('  Place   order ') // 'Place order'
composeBrowserPoint({ x: 10, y: 10 }, [{ x: 100, y: 50 }]) // { x: 110, y: 60 }
extractBrowserSlice('one\ntwo\nthree', 0, 8) // { text: 'one\ntwo\n', offset: 0, total: 13 }
boundBrowserText('x'.repeat(5_000), 4_000, BROWSER_TOOL_CUT_FOOTER) // 4 000 characters, then '\n[characters 0–4000 of 5000; the rest was cut]'
validateBrowserToolArguments(BROWSER_TOOL_COPY.look, { search: 'cart', ref: 'e1' }) // throws BROWSER_TOOLSET_ARGUMENT: 'The look tool takes no ref parameter; call look with search and offset.'
renderBrowserElement(element) // 'e4 button "Place order"'
const rows = filterBrowserOutline(nodes, { role: 'button', name: 'place' })
renderBrowserOutline('https://example.test/cart', 'Cart', rows, 150) // { url, title, text, count, total, matches, focus }
renderBrowserReceipt({ action: 'Clicked e4 button "Place order"', view }) // the receipt line, then the view
renderBrowserToolOutput([{ type: 'text', text: 'Found 3 cars' }]) // 'Found 3 cars'
readBrowserToolString({ search: 'cart' }, 'search') // 'cart'
deriveBrowserToolSchema(undefined) // a schema requiring a purpose string
const tool = parseBrowserTool(toolsAdded.tools[0]) // BrowserTool | undefined
const removal = parseBrowserRemoval(toolsRemoved.tools[0]) // BrowserToolRemoval | undefined
const invocation = parseBrowserInvocation(toolInvoked) // BrowserInvocation | undefined
const settled = parseBrowserInvocationResult(toolResponded) // BrowserInvocationResult | undefined
const world = readBrowserWorld(createIsolatedWorldResult, 'main') // execution context id
const read = compileReadFunction() // returns { url, title, html } in the isolated world
const hit = compileHitFunction() // tests whether a hit node is the element or inside it
const select = compileSelectFunction(['Large']) // selects the options whose value or label matches
const observe = compileSubmitObserverExpression(7) // records every submit event for action 7
const submitted = compileSubmitReadExpression(7) // resolves { destinations, prevented, submitted, implicit }, such as { destinations: ['self'], prevented: false, submitted: true, implicit: true } after an Enter in a form input, and removes the observer; null for another token
const waitText = compileTextWaitExpression('Order placed', 5_000, 'wait-1')
const waitQuery = compileQueryWaitExpression(5_000, 'wait-2')
```

The following fence composes the page-level helpers behind trusted input, network interception, storage, coverage, and HAR recording.

```ts
import {
	browserHARHeadersToRecord,
	browserHeadersToProtocol,
	browserPDFToParams,
	browserScreenshotToParams,
	bytesToText,
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
	createBrowserHAREntry,
	encodeBase64,
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
	textToBytes,
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

const bytes = textToBytes('hello')
bytesToText(bytes)
encodeBase64(bytes)
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
	createBrowserHAREntry(
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
readBrowserAccessibility(payload)
parseBrowserBindingCall(payload)
parseBrowserConsoleMessage(payload)
parseBrowserCookiePartition(payload)
readBrowserCookies(payload)
readBrowserCoverageRanges([], 0)
parseBrowserDownloadProgress(payload)
parseBrowserDownloadStart(payload)
readBrowserHeaders(payload)
readBrowserMetrics(payload)
parseBrowserPageError(payload)
readBrowserProfile(payload)
readBrowserProfileFrame(payload, 0)
readBrowserQuad(payload)
readBrowserRemoteValue(payload)
parseBrowserRequestFailure(payload)
parseBrowserResponse(payload)
parseBrowserResponseRecord(payload, 'request-1', 'loader-1', undefined, 0)
readBrowserScriptCoverage(payload)
readBrowserScriptIdentifier(payload)
parseBrowserSecurity(payload)
readBrowserStack(payload)
readBrowserStorageEntries([], 'https://example.com', 'local')
readBrowserStorageOrigin(payload, 'https://example.com')
readBrowserStreamChunk(payload)
readBrowserStyleCoverage(payload)
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

#### Types

The following table lists the core types.

| API                                 | Kind      | Summary                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CDPTransportEventMap`              | type      | Maps the events emitted by a `CDPTransportInterface` — the raw text pipe a `CDPClientInterface` sends and receives JSON-RPC frames over.                                                                                                                     |
| `CDPTransportInterface`             | interface | Represents the text pipe a `CDPClient` sends and receives JSON-RPC frames over.                                                                                                                                                                              |
| `CDPClientEventMap`                 | type      | Maps the events a `CDPClientInterface` emits.                                                                                                                                                                                                                |
| `CDPClientOptions`                  | interface | Describes the options for creating a `CDPClient` instance.                                                                                                                                                                                                   |
| `CDPSendOptions`                    | interface | Describes the options for one CDP method call.                                                                                                                                                                                                               |
| `CDPHandler`                        | type      | Receives a subscribed CDP event with its params record.                                                                                                                                                                                                      |
| `CDPTarget`                         | interface | Represents one entry of the CDP `Target.getTargets` result.                                                                                                                                                                                                  |
| `CDPClientInterface`                | interface | Provides a lightweight Chrome DevTools Protocol client over a `CDPTransportInterface`.                                                                                                                                                                       |
| `BrowserTransitionFunction`         | type      | Runs the work one `BrowserTransitionInterface` transition performs.                                                                                                                                                                                          |
| `BrowserTransitionInterface`        | interface | Represents one asynchronous transition shared by every caller that arrives while it runs.                                                                                                                                                                    |
| `BrowserWriterInterface`            | interface | Provides a pluggable sink for persisting captured browser bytes to a path.                                                                                                                                                                                   |
| `BrowserViewport`                   | interface | Describes the viewport dimensions for a browser page.                                                                                                                                                                                                        |
| `BrowserWaitUntil`                  | type      | Names the page load condition for navigation — the CDP load event awaited by `navigate()`.                                                                                                                                                                   |
| `BrowserPageOptions`                | interface | Describes the options for creating a `BrowserPage` instance.                                                                                                                                                                                                 |
| `BrowserNavigationOptions`          | interface | Describes the options for page navigation.                                                                                                                                                                                                                   |
| `BrowserNavigationResult`           | interface | Describes the outcome of a top-level navigation command.                                                                                                                                                                                                     |
| `BrowserNavigationWatch`            | interface | Holds the state retained while correlating navigation with Network events.                                                                                                                                                                                   |
| `BrowserNavigationWait`             | interface | Represents one pending navigation or network-idle wait.                                                                                                                                                                                                      |
| `BrowserLoaderFunction`             | type      | Reads the loader id of the page's current document, undefined before the first commit.                                                                                                                                                                       |
| `BrowserNavigationManagerInterface` | interface | Provides URL and network-idle waits associated with one page.                                                                                                                                                                                                |
| `BrowserNavigationRecordInterface`  | interface | Settles the navigation an input into one frame started, from the steps the page accepted after the record opened.                                                                                                                                            |
| `BrowserPopupManagerInterface`      | interface | Opens the records that settle the popups an input into a page opens.                                                                                                                                                                                         |
| `BrowserPopupRecordInterface`       | interface | Settles the popups an input opened, from the `Page.windowOpen` reports the page's own session sends after the record opened.                                                                                                                                 |
| `BrowserDestinationRelationship`    | type      | Names the frame a submission targets relative to the frame whose document submitted, mirroring the HTML `_self`, `_parent`, and `_top` keywords.                                                                                                             |
| `BrowserDestination`                | interface | Pairs a document that recorded a surviving submission with the submission's destination.                                                                                                                                                                     |
| `BrowserSettlementOptions`          | interface | Configures a record's settlement.                                                                                                                                                                                                                            |
| `BrowserNavigationStage`            | type      | Names how far a settled navigation got: requested, committed, or loaded.                                                                                                                                                                                     |
| `BrowserNavigationReason`           | type      | Names why a frame requested a navigation, mirroring the CDP `Page.ClientNavigationReason` values that `Page.frameRequestedNavigation` carries as of Chromium 141.                                                                                            |
| `BrowserSettlementResult`           | interface | Describes the navigation a record settled.                                                                                                                                                                                                                   |
| `BrowserNavigationEventMap`         | type      | Maps the navigation steps a page accepts from the session that owns each frame, which it hands to its navigation and element managers.                                                                                                                       |
| `BrowserInputOptions`               | interface | Describes the options shared by every trusted input operation.                                                                                                                                                                                               |
| `BrowserClickOptions`               | interface | Describes the options for a trusted mouse click.                                                                                                                                                                                                             |
| `BrowserDragOptions`                | interface | Describes the options for a trusted mouse drag.                                                                                                                                                                                                              |
| `BrowserScreenshotOptions`          | interface | Describes the options for taking a page screenshot.                                                                                                                                                                                                          |
| `BrowserScreenshotResult`           | interface | Describes the result of a page screenshot.                                                                                                                                                                                                                   |
| `BrowserTeardownFunction`           | type      | Runs one teardown step to settlement while the first failure is retained.                                                                                                                                                                                    |
| `BrowserHandleInterface`            | interface | Represents a remote JavaScript object retained in one frame execution context.                                                                                                                                                                               |
| `BrowserBindingHandler`             | type      | Runs a host function exposed into page JavaScript.                                                                                                                                                                                                           |
| `BrowserBindingCall`                | interface | Describes a decoded page-to-host binding call.                                                                                                                                                                                                               |
| `BrowserScriptManagerInterface`     | interface | Manages initialization scripts and host bindings for one page.                                                                                                                                                                                               |
| `BrowserScriptEntry`                | interface | Represents one installed new-document script and its optional host binding owner.                                                                                                                                                                            |
| `BrowserAXNode`                     | interface | Represents one decoded Chromium accessibility node.                                                                                                                                                                                                          |
| `BrowserAccessibilitySnapshot`      | interface | Describes a serializable accessibility-tree snapshot.                                                                                                                                                                                                        |
| `BrowserAccessibilityOptions`       | interface | Describes the options for an accessibility snapshot.                                                                                                                                                                                                         |
| `BrowserAccessibilityInterface`     | interface | Inspects the accessibility tree.                                                                                                                                                                                                                             |
| `BrowserTracingOptions`             | interface | Describes the options for a Chromium trace capture.                                                                                                                                                                                                          |
| `BrowserTracingResult`              | interface | Describes the result of a trace capture.                                                                                                                                                                                                                     |
| `BrowserStreamChunk`                | interface | Represents one decoded IO stream read.                                                                                                                                                                                                                       |
| `BrowserTracingInterface`           | interface | Drives the trace capture lifecycle.                                                                                                                                                                                                                          |
| `BrowserCoverageRange`              | interface | Describes a source range reported by JavaScript or CSS coverage.                                                                                                                                                                                             |
| `BrowserFunctionCoverage`           | interface | Describes function coverage inside one script.                                                                                                                                                                                                               |
| `BrowserScriptCoverage`             | interface | Describes JavaScript script coverage.                                                                                                                                                                                                                        |
| `BrowserStyleCoverage`              | interface | Describes CSS stylesheet coverage.                                                                                                                                                                                                                           |
| `BrowserCoverageOptions`            | interface | Describes the options for a coverage capture.                                                                                                                                                                                                                |
| `BrowserCoverageResult`             | interface | Describes combined JavaScript and CSS usage.                                                                                                                                                                                                                 |
| `BrowserCoverageInterface`          | interface | Drives the coverage capture lifecycle.                                                                                                                                                                                                                       |
| `BrowserMetric`                     | interface | Represents one Performance-domain metric.                                                                                                                                                                                                                    |
| `BrowserProfileFrame`               | interface | Describes a JavaScript call frame from a CPU profile.                                                                                                                                                                                                        |
| `BrowserProfileNode`                | interface | Represents one node in a sampled CPU profile.                                                                                                                                                                                                                |
| `BrowserProfile`                    | interface | Describes a sampled CPU profile.                                                                                                                                                                                                                             |
| `BrowserPerformanceInterface`       | interface | Reads Performance-domain metrics.                                                                                                                                                                                                                            |
| `BrowserProfilerInterface`          | interface | Drives the sampled CPU profile lifecycle.                                                                                                                                                                                                                    |
| `BrowserDiagnosticsInterface`       | interface | Groups the diagnostics by capability.                                                                                                                                                                                                                        |
| `BrowserClockInterface`             | interface | Controls Chromium virtual time for deterministic page timers.                                                                                                                                                                                                |
| `BrowserPoint`                      | interface | Describes a point in viewport CSS pixels.                                                                                                                                                                                                                    |
| `BrowserMouseButton`                | type      | Names a mouse button understood by Chromium's Input domain.                                                                                                                                                                                                  |
| `BrowserScreenshotScale`            | type      | Names a screenshot coordinate scale.                                                                                                                                                                                                                         |
| `BrowserKey`                        | interface | Describes normalized CDP keyboard key data.                                                                                                                                                                                                                  |
| `BrowserChord`                      | interface | Describes a parsed keyboard chord.                                                                                                                                                                                                                           |
| `BrowserOperationOptions`           | type      | Collects every option a trusted-input operation can carry.                                                                                                                                                                                                   |
| `BrowserKeyboardInterface`          | interface | Provides keyboard input operations bound to one frame target session.                                                                                                                                                                                        |
| `BrowserMouseInterface`             | interface | Provides mouse input operations bound to one frame target session.                                                                                                                                                                                           |
| `BrowserTouchInterface`             | interface | Provides touch input operations bound to one frame target session.                                                                                                                                                                                           |
| `BrowserActionabilityOptions`       | interface | Describes the actionability checks performed before element input.                                                                                                                                                                                           |
| `BrowserQuad`                       | interface | Describes a decoded content quad and its actionable center.                                                                                                                                                                                                  |
| `BrowserMargin`                     | interface | Describes the paper margin lengths accepted by Chromium print-to-PDF.                                                                                                                                                                                        |
| `BrowserPDFOptions`                 | interface | Describes the options for printing a Chromium page to PDF.                                                                                                                                                                                                   |
| `BrowserPDFResult`                  | interface | Describes the result of printing a page to PDF.                                                                                                                                                                                                              |
| `BrowserDialogCategory`             | type      | Names a JavaScript dialog category reported by Chromium.                                                                                                                                                                                                     |
| `BrowserDialogInterface`            | interface | Represents one active JavaScript dialog.                                                                                                                                                                                                                     |
| `BrowserFileChooserInterface`       | interface | Represents one intercepted file chooser.                                                                                                                                                                                                                     |
| `BrowserDownloadStatus`             | type      | Names a download lifecycle phase.                                                                                                                                                                                                                            |
| `BrowserDownloadEventMap`           | type      | Maps the download progress events.                                                                                                                                                                                                                           |
| `BrowserDownloadProgress`           | interface | Describes a protocol-neutral download progress update.                                                                                                                                                                                                       |
| `BrowserDownloadStart`              | interface | Describes a decoded `Browser.downloadWillBegin` event.                                                                                                                                                                                                       |
| `BrowserDownloadInterface`          | interface | Represents one context download tracked through Chromium's Browser domain.                                                                                                                                                                                   |
| `BrowserConsoleMessage`             | interface | Represents one console API call.                                                                                                                                                                                                                             |
| `BrowserStackFrame`                 | interface | Represents one browser-side stack frame.                                                                                                                                                                                                                     |
| `BrowserPageError`                  | interface | Represents one uncaught page exception.                                                                                                                                                                                                                      |
| `BrowserWorkerCategory`             | type      | Names a worker target category.                                                                                                                                                                                                                              |
| `BrowserWorkerInterface`            | interface | Represents a script worker attached to a page target.                                                                                                                                                                                                        |
| `BrowserPageEventMap`               | type      | Maps the typed page, frame, target, and user-visible browser events.                                                                                                                                                                                         |
| `BrowserRequest`                    | interface | Represents one observed browser request.                                                                                                                                                                                                                     |
| `BrowserSecurity`                   | interface | Describes the TLS details supplied with a browser response.                                                                                                                                                                                                  |
| `BrowserTimingRange`                | interface | Describes the start/end pair for one network timing phase.                                                                                                                                                                                                   |
| `BrowserTiming`                     | interface | Holds network timing values in milliseconds relative to request time.                                                                                                                                                                                        |
| `BrowserResponse`                   | interface | Represents one observed browser response.                                                                                                                                                                                                                    |
| `BrowserRequestFailure`             | interface | Represents one failed browser request.                                                                                                                                                                                                                       |
| `BrowserWebSocketFrame`             | interface | Describes a WebSocket frame payload.                                                                                                                                                                                                                         |
| `BrowserWebSocketEventMap`          | type      | Maps the WebSocket lifecycle events.                                                                                                                                                                                                                         |
| `BrowserWebSocketInterface`         | interface | Represents one observed WebSocket connection.                                                                                                                                                                                                                |
| `BrowserNetworkEventMap`            | type      | Maps the network events a page's network manager emits.                                                                                                                                                                                                      |
| `BrowserRouteQuery`                 | interface | Describes route matching criteria. Omitted fields match all values.                                                                                                                                                                                          |
| `BrowserRouteContinueOptions`       | interface | Describes the overrides supplied when continuing an intercepted request.                                                                                                                                                                                     |
| `BrowserRouteFulfillOptions`        | interface | Describes the synthetic response supplied when fulfilling an intercepted request.                                                                                                                                                                            |
| `BrowserRouteInterface`             | interface | Represents one paused Fetch-domain request.                                                                                                                                                                                                                  |
| `BrowserRouteHandler`               | type      | Runs for a matching intercepted request.                                                                                                                                                                                                                     |
| `BrowserRouteDefinition`            | interface | Represents one installed network route.                                                                                                                                                                                                                      |
| `BrowserHAROptions`                 | interface | Describes the options for a HAR recording.                                                                                                                                                                                                                   |
| `BrowserHARValue`                   | interface | Represents one name/value pair in an HTTP archive.                                                                                                                                                                                                           |
| `BrowserHARCookie`                  | interface | Represents one cookie in an HTTP archive.                                                                                                                                                                                                                    |
| `BrowserHARPost`                    | interface | Describes request body metadata in an HTTP archive.                                                                                                                                                                                                          |
| `BrowserHARContent`                 | interface | Describes response body metadata in an HTTP archive.                                                                                                                                                                                                         |
| `BrowserHARRequest`                 | interface | Describes a HAR 1.2 request entry.                                                                                                                                                                                                                           |
| `BrowserHARResponse`                | interface | Describes a HAR 1.2 response entry.                                                                                                                                                                                                                          |
| `BrowserHARTimings`                 | interface | Holds HAR 1.2 phase timings in milliseconds.                                                                                                                                                                                                                 |
| `BrowserHAREntry`                   | interface | Represents one completed HTTP exchange in a HAR recording.                                                                                                                                                                                                   |
| `BrowserHARPending`                 | interface | Holds recording state until a request finishes; a new value replaces it on each update.                                                                                                                                                                      |
| `BrowserHARCreator`                 | interface | Describes the tool identity embedded in an HTTP archive.                                                                                                                                                                                                     |
| `BrowserHARLog`                     | interface | Describes the HAR 1.2 log object.                                                                                                                                                                                                                            |
| `BrowserHAR`                        | interface | Describes the standards-shaped HAR 1.2 document produced by the network manager.                                                                                                                                                                             |
| `BrowserHARReplayOptions`           | interface | Describes HAR replay behavior.                                                                                                                                                                                                                               |
| `BrowserHARManagerInterface`        | interface | Provides HAR recording and replay operations.                                                                                                                                                                                                                |
| `BrowserNetworkManagerInterface`    | interface | Provides page-scoped network observation and interception.                                                                                                                                                                                                   |
| `BrowserSameSite`                   | type      | Names a cookie same-site policy understood by Chromium.                                                                                                                                                                                                      |
| `BrowserCookiePartition`            | interface | Describes a cookie partition key used by CHIPS-partitioned cookies.                                                                                                                                                                                          |
| `BrowserCookie`                     | interface | Represents one cookie returned from a browser context.                                                                                                                                                                                                       |
| `BrowserCookieInput`                | interface | Describes the input used to create or replace a browser cookie.                                                                                                                                                                                              |
| `BrowserCookieFilter`               | interface | Describes optional narrowing criteria for clearing context cookies.                                                                                                                                                                                          |
| `BrowserCookieManagerInterface`     | interface | Provides cookie operations scoped to one browser context.                                                                                                                                                                                                    |
| `BrowserPermissionManagerInterface` | interface | Provides permission override operations scoped to one browser context.                                                                                                                                                                                       |
| `BrowserStorageEntry`               | interface | Represents one key/value pair from web storage.                                                                                                                                                                                                              |
| `BrowserStorageOrigin`              | interface | Describes an origin-scoped local and session storage snapshot.                                                                                                                                                                                               |
| `BrowserStorageState`               | interface | Describes a portable browser authentication and storage snapshot.                                                                                                                                                                                            |
| `BrowserStorageOptions`             | interface | Describes the options for collecting storage state from selected origins.                                                                                                                                                                                    |
| `BrowserStorageManagerInterface`    | interface | Provides storage-state import, export, and clearing operations.                                                                                                                                                                                              |
| `BrowserCredentials`                | interface | Describes the HTTP basic-auth credentials applied to context pages.                                                                                                                                                                                          |
| `BrowserGeolocation`                | interface | Describes a geographic location override.                                                                                                                                                                                                                    |
| `BrowserMedia`                      | interface | Describes browser color and media feature overrides.                                                                                                                                                                                                         |
| `BrowserUserAgent`                  | interface | Describes user-agent metadata accepted by Chromium emulation.                                                                                                                                                                                                |
| `BrowserEmulationOptions`           | interface | Describes network and rendering overrides inherited by context pages.                                                                                                                                                                                        |
| `BrowserPagesFunction`              | type      | Returns the context's live pages at call time.                                                                                                                                                                                                               |
| `BrowserEmulationManagerInterface`  | interface | Configures context-scoped emulation.                                                                                                                                                                                                                         |
| `BrowserProxy`                      | interface | Describes proxy settings used when creating an isolated browser context.                                                                                                                                                                                     |
| `BrowserDownloadOptions`            | interface | Describes the download policy for a browser context.                                                                                                                                                                                                         |
| `BrowserContextOptions`             | interface | Describes the options for creating and configuring an isolated browser context.                                                                                                                                                                              |
| `BrowserContextEventMap`            | type      | Maps the browser-context lifecycle events.                                                                                                                                                                                                                   |
| `BrowserJourneyBinding`             | type      | Binds a native action's string argument to a literal or to one declared parameter by name.                                                                                                                                                                   |
| `BrowserJourneyParameter`           | interface | Declares one parameter a journey takes: its default, or none when it is a secret.                                                                                                                                                                            |
| `BrowserJourneyTarget`              | interface | Names the element an acting step acts on the way a receipt names it, with the record-time evidence a developer reads when a resolution is refused.                                                                                                           |
| `BrowserJourneyTab`                 | interface | Names the tab a `switch` step moves to, portably.                                                                                                                                                                                                            |
| `BrowserJourneyStepInput`           | interface | Describes one step before it holds an id: a call of a toolset tool with its element or tab named as data.                                                                                                                                                    |
| `BrowserJourneyStep`                | interface | Describes a step with its identity: `s` followed by a positive integer, stable across edits and never reused.                                                                                                                                                |
| `BrowserJourney`                    | interface | Describes one user intent as data; `next` is the number the next added step takes.                                                                                                                                                                           |
| `BrowserJourneyRevision`            | interface | Carries a journey with the revision the store assigned; `revision` is absent for a journey the store never held.                                                                                                                                             |
| `BrowserJourneyEdit`                | type      | Describes one change to a journey; `editBrowserJourney` applies a batch to a copy, in order, and refuses it whole on the first invalid edit.                                                                                                                 |
| `BrowserJourneyEditRequest`         | type      | Describes an edit as the `edit` tool receives it over the wire: an added or updated step can name `ref` instead of a target, converted from the current view before the pure editor runs.                                                                    |
| `BrowserRecorderEventMap`           | type      | Maps the events a recorder emits.                                                                                                                                                                                                                            |
| `BrowserRecorderInterface`          | interface | Records the steps of a journey from one source as they happen and turns them into a journey.                                                                                                                                                                 |
| `BrowserRecorderOptions`            | interface | Configures a recorder.                                                                                                                                                                                                                                       |
| `BrowserAction`                     | interface | Describes what became of one action the toolset performed.                                                                                                                                                                                                   |
| `BrowserStepOutcome`                | type      | Names how one step ended.                                                                                                                                                                                                                                    |
| `BrowserRunOutcome`                 | type      | Names how a run ended.                                                                                                                                                                                                                                       |
| `BrowserToolsetResult`              | interface | Carries a performed call's tool result beside its structured action, present when the call reached a handler, and the value a failed handler threw.                                                                                                          |
| `BrowserHoldInterface`              | interface | Owns the toolset while a replay runs; `destroy` releases it.                                                                                                                                                                                                 |
| `BrowserRunStep`                    | interface | Describes one replayed step; `action`, `trigger`, and `result` carry the meaning of the skill's `JournalStep` fields.                                                                                                                                        |
| `BrowserRun`                        | interface | Describes one run of a journey; `inputs` omits secret values; `fault` carries the run file's write failure.                                                                                                                                                  |
| `BrowserReplayOptions`              | interface | Configures one replay.                                                                                                                                                                                                                                       |
| `BrowserReplayEventMap`             | type      | Maps the events a replay emits.                                                                                                                                                                                                                              |
| `BrowserReplayInterface`            | interface | Replays one journey over a toolset.                                                                                                                                                                                                                          |
| `BrowserStoreOptions`               | interface | Carries the signal a store call honours.                                                                                                                                                                                                                     |
| `BrowserJourneyValidationContext`   | interface | Identifies the parameter binding that failed journey validation.                                                                                                                                                                                             |
| `BrowserStoreFault`                 | interface | Names one entry a listing could not read.                                                                                                                                                                                                                    |
| `BrowserStorePage`                  | interface | Carries one page of a listing with the entries it could not read.                                                                                                                                                                                            |
| `BrowserJourneyStoreInterface`      | interface | Keeps journeys by name with a revision per write.                                                                                                                                                                                                            |
| `BrowserRunSlot`                    | interface | Names the run directory a store opened, as data.                                                                                                                                                                                                             |
| `BrowserRunStoreInterface`          | interface | Keeps runs by the journey name and run id the run carries.                                                                                                                                                                                                   |
| `BrowserJourneyOptions`             | interface | Configures the journey toolset a toolset constructs.                                                                                                                                                                                                         |
| `BrowserJourneyToolsetInterface`    | interface | Registers the six journey tools over a toolset and owns the recording and the active replay.                                                                                                                                                                 |
| `BrowserCodegenLanguage`            | type      | Names the target language for a compiled codegen script.                                                                                                                                                                                                     |
| `BrowserCodegenInterface`           | interface | Records semantic page gestures and compiles the resulting journey.                                                                                                                                                                                           |
| `BrowserCodegenScript`              | interface | Carries the module `compileBrowserJourney` emits with the gap steps that refuse it.                                                                                                                                                                          |
| `BrowserCodegenGesture`             | interface | Carries a sanitized gesture from the page listener without password values.                                                                                                                                                                                  |
| `BrowserReadOptions`                | interface | Describes the options for one slice of a reading's Markdown or plain-text projection.                                                                                                                                                                        |
| `BrowserReadResult`                 | interface | Describes one slice of a reading's projection.                                                                                                                                                                                                               |
| `BrowserReadMatch`                  | interface | Describes a matching line and its character offset in a reading's projection.                                                                                                                                                                                |
| `BrowserEpochFunction`              | type      | Reads the navigation epoch of the frame a reading was captured from.                                                                                                                                                                                         |
| `BrowserReadingInput`               | interface | Describes the captured document a reading is built from.                                                                                                                                                                                                     |
| `BrowserReadingInterface`           | interface | Represents one captured document, parsed one time and projected to Markdown or plain text in bounded slices.                                                                                                                                                 |
| `BrowserSessionFunction`            | type      | Resolves the current CDP session for a frame id.                                                                                                                                                                                                             |
| `BrowserWorldFunction`              | type      | Resolves the isolated-world execution context a page caches for one frame document, creating the world on the given session when none is cached.                                                                                                             |
| `BrowserElementQuery`               | interface | Describes an accessibility or CSS query within an optional element reference.                                                                                                                                                                                |
| `BrowserWaitOptions`                | interface | Configures a text or element wait, including whether absence satisfies it.                                                                                                                                                                                   |
| `BrowserOutlineOptions`             | interface | Configures an outline's element limit, optional subtree, and search.                                                                                                                                                                                         |
| `BrowserOutline`                    | interface | Carries a document-order outline and its included and available element counts.                                                                                                                                                                              |
| `BrowserOutlineNode`                | interface | Associates an outline row with its frame, session, and optional actionable reference.                                                                                                                                                                        |
| `BrowserElementGeometry`            | interface | Retains both session-local and page-composed element geometry.                                                                                                                                                                                               |
| `BrowserElementSubject`             | interface | Identifies a manager failure without inventing an element reference.                                                                                                                                                                                         |
| `BrowserElementReason`              | type      | Identifies the refusal an element action reports.                                                                                                                                                                                                            |
| `BrowserElementRefusal`             | interface | Describes how an element action reports one refusal its compiled in-page check throws: the reason, and the detail that follows the element's name, or `undefined` for the reason's own wording.                                                              |
| `BrowserReferenceFunction`          | type      | Allocates the next reference from the owning browser context.                                                                                                                                                                                                |
| `BrowserElementWorldFunction`       | type      | Resolves the page-owned isolated world for a particular frame and session.                                                                                                                                                                                   |
| `BrowserReadinessFunction`          | type      | Waits for the current document's DOM readiness.                                                                                                                                                                                                              |
| `BrowserElementPointFunction`       | type      | Composes a frame-local point into page coordinates.                                                                                                                                                                                                          |
| `BrowserElementManagerInput`        | interface | Provides the protocol and ownership boundaries used by a page element manager.                                                                                                                                                                               |
| `BrowserElementInput`               | interface | Binds an element to its document identity and the page's shared protocol resources.                                                                                                                                                                          |
| `BrowserReadinessWait`              | interface | Holds the resources of one lifecycle-event readiness wait.                                                                                                                                                                                                   |
| `BrowserElementInterface`           | interface | Provides actions and reading through a stable document element reference.                                                                                                                                                                                    |
| `BrowserPageElementInterface`       | interface | Provides trusted page input and capture for a referenced element.                                                                                                                                                                                            |
| `BrowserElementManagerInterface`    | interface | Captures, queries, and retains references to a view's elements.                                                                                                                                                                                              |
| `BrowserViewEventMap`               | type      | Maps the `console` and `error` events of a view that observes its document's output.                                                                                                                                                                         |
| `BrowserViewInterface`              | interface | Provides the document operations shared by remote and DOM-native views.                                                                                                                                                                                      |
| `BrowserCallOptions`                | interface | Describes the options every asynchronous page, frame, handle, and worker call accepts.                                                                                                                                                                       |
| `BrowserToolAnnotation`             | interface | Transliterates the WebMCP protocol's `Annotation` type, retaining its wire spelling.                                                                                                                                                                         |
| `BrowserTool`                       | interface | Describes a registered WebMCP tool and its owning document.                                                                                                                                                                                                  |
| `BrowserToolRemoval`                | interface | Identifies a removed WebMCP tool by document and name.                                                                                                                                                                                                       |
| `BrowserInvocation`                 | interface | Describes a WebMCP invocation observed on the protocol.                                                                                                                                                                                                      |
| `BrowserInvocationResult`           | interface | Carries a terminal WebMCP status and its untrusted output or error.                                                                                                                                                                                          |
| `BrowserRegistryEventMap`           | type      | Maps registry changes and observed WebMCP invocation events.                                                                                                                                                                                                 |
| `BrowserRegistryOptions`            | interface | Configures registry listeners and listener-error handling.                                                                                                                                                                                                   |
| `BrowserRegistryInterface`          | interface | Mirrors the experimental WebMCP protocol domain for a page.                                                                                                                                                                                                  |
| `BrowserRegistryPending`            | interface | Holds one unsettled registry execution and its resource cleanup.                                                                                                                                                                                             |
| `BrowserToolName`                   | type      | Names a tool the browser toolset reserves: the generic tools, the staged `dialog`, the opt-in `tabs` and `switch`, and the journey tools `record`, `save`, `journeys`, `edit`, `replay`, and `forget`, which a toolset constructed with `journeys` reserves. |
| `BrowserToolsetReason`              | type      | Names why a toolset declined a page tool.                                                                                                                                                                                                                    |
| `BrowserToolSourceEventMap`         | type      | Maps the signal a tool source emits when its page's tools change.                                                                                                                                                                                            |
| `BrowserToolSourceInterface`        | interface | Supplies page-registered tools to a toolset through a contract free of protocol types.                                                                                                                                                                       |
| `BrowserToolsetEventMap`            | type      | Maps the events a toolset emits.                                                                                                                                                                                                                             |
| `BrowserToolsetOptions`             | interface | Configures a browser toolset.                                                                                                                                                                                                                                |
| `BrowserFollowOptions`              | interface | Configures one step a toolset follows.                                                                                                                                                                                                                       |
| `BrowserTab`                        | interface | Describes one open tab of a toolset's context, which the `tabs` tool lists one per line.                                                                                                                                                                     |
| `BrowserToolsetInterface`           | interface | Publishes the browser vocabulary as tools over one current view and adopts the page's own tools beside them.                                                                                                                                                 |
| `BrowserToolsetHandler`             | type      | Runs one toolset tool inside the toolset's boundary.                                                                                                                                                                                                         |
| `BrowserToolsetWatch`               | interface | Holds the listeners a toolset attaches to one followed page.                                                                                                                                                                                                 |
| `BrowserReceipt`                    | interface | Describes one tool receipt before rendering.                                                                                                                                                                                                                 |
| `BrowserFrameInfo`                  | interface | Describes serializable frame metadata decoded from CDP `Page.getFrameTree`.                                                                                                                                                                                  |
| `BrowserFrameInterface`             | interface | Provides the operations shared by a top-level page and an iframe document.                                                                                                                                                                                   |
| `BrowserRect`                       | type      | Represents a rectangle in CSS pixels: x, y, width, height.                                                                                                                                                                                                   |
| `BrowserLayout`                     | interface | Describes layout data associated with one captured DOM node.                                                                                                                                                                                                 |
| `BrowserNode`                       | interface | Represents one serializable DOM node decoded from a CDP DOM snapshot.                                                                                                                                                                                        |
| `BrowserDocument`                   | interface | Represents one document captured in a CDP DOM snapshot.                                                                                                                                                                                                      |
| `BrowserSnapshotInput`              | interface | Describes the serializable input for a navigable browser snapshot — the form a `BrowserSnapshot` is built from and serializes back to.                                                                                                                       |
| `BrowserWalkOrder`                  | type      | Names the structural ordering for a browser snapshot walk.                                                                                                                                                                                                   |
| `BrowserWalkOptions`                | interface | Describes the options for walking a browser snapshot.                                                                                                                                                                                                        |
| `BrowserSiblingRelation`            | type      | Names a structural sibling relationship relative to a browser node.                                                                                                                                                                                          |
| `BrowserSnapshotInterface`          | interface | Represents a navigable, serializable snapshot of every document attached to a page, extending `BrowserSnapshotInput` with walking, structural relationships, search, and path derivation over plain `BrowserNode` values.                                    |
| `BrowserSnapshotOptions`            | interface | Describes the options configuring capture through `BrowserPageInterface` `snapshot()`. The snapshot entity's creation input is `BrowserSnapshotInput`.                                                                                                       |
| `BrowserNodePredicate`              | type      | Names the predicate form accepted by `BrowserSnapshotInterface` find, filter, and closest methods.                                                                                                                                                           |
| `BrowserNodeQuery`                  | interface | Describes a declarative browser-node matcher used by `matchesBrowserNode`.                                                                                                                                                                                   |
| `BrowserPageInterface`              | interface | Abstracts a single top-level browser page, extending `BrowserFrameInterface` with navigation, screenshots, frame discovery, DOM snapshots, codegen, and target teardown.                                                                                     |
| `BrowserContextInterface`           | interface | Represents an isolated browser session over a CDP browser context.                                                                                                                                                                                           |

A page hands the navigation steps it accepts, typed by `BrowserNavigationEventMap`, to its element manager as `BrowserElementManagerInput.steps`, and the manager drops a child frame's references on that frame's cross-document `commit` and on its `detach`. The input’s `recover` callback discards cached DOM readiness after context loss and parks until the destination document is ready. The same emitter reaches the navigation manager through its constructor; see [`BrowserNavigationManagerInterface`](#browsernavigationmanagerinterface). `BrowserToolsetWatch` holds a toolset's `dialog`, `popup`, `close`, and `closed` listeners and no navigation listener, because a toolset follows a navigation through the page's record.

### Server

The Node runtime discovers a browser listening on a CDP port, attaches to it, or launches a Chromium-family process. The following fence probes, connects, and destroys.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ cdp: { port: 9222 } })
const discovery = await browser.discover() // passive probe, no side effects
await browser.connect() // reuses discovery.endpoint if found, else launches
const context = browser.context() // the default context
await browser.destroy() // closes the process and releases resources
```

#### Factories

The following table lists the server factories.

| API                             | Kind     | Summary                                                                                                                                                           |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBrowser`                 | function | Creates a raw-CDP `BrowserInterface` façade with discovery, connection, and lifecycle management.                                                                 |
| `createCDPTransport`            | function | Creates a Node `WebSocket`-backed `CDPTransportInterface` for the given CDP debugger URL.                                                                         |
| `createBrowserWriter`           | function | Creates a filesystem-backed `BrowserWriterInterface` that persists bytes through `node:fs/promises`.                                                              |
| `createFileBrowserJourneyStore` | function | Creates a journey store over an existing filesystem root.                                                                                                         |
| `createFileBrowserRunStore`     | function | Creates a run store over an existing filesystem root.                                                                                                             |
| `createBrowserMCPServer`        | function | Creates the browse server, which serves the browser vocabulary and the journey tools over the Model Context Protocol on stdio and warms Chromium at server start. |

The following fence builds the Node transport and the filesystem writer that `Browser` composes.

```ts
import { createBrowserWriter, createCDPTransport } from '@orkestrel/browser/server'

const transport = createCDPTransport({ url: 'ws://127.0.0.1:9222/devtools/browser/abc' })
const writer = createBrowserWriter()
await writer.write('shots/hero.png', new Uint8Array([137, 80, 78, 71]))
```

#### Classes

The following table lists the server classes.

| API                       | Kind  | Summary                                                                                                                                                                   |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Browser`                 | class | Discovers, launches, connects to, and owns Chromium-family browser sessions.                                                                                              |
| `WebSocketCDPTransport`   | class | Provides a raw CDP text transport backed by `@orkestrel/websocket`.                                                                                                       |
| `FileBrowserWriter`       | class | Persists captured browser bytes to the filesystem through `node:fs/promises`.                                                                                             |
| `FileBrowserJourneyStore` | class | Persists journeys with exclusive writes and revision counters retained across deletion.                                                                                   |
| `FileBrowserRunStore`     | class | Persists runs and captures only in directories allocated by this instance.                                                                                                |
| `BrowserMCPServer`        | class | Implements `BrowserMCPServerInterface`: serves the browser vocabulary and the journey tools over the Model Context Protocol on stdio, and warms Chromium at server start. |

#### Constants

The following table lists the server constants.

| API                               | Kind  | Summary                                                                                                                                                                                                                       |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_DEFAULT_CDP_PORT`        | const | Sets the default CDP port probed for an existing browser and used for launches, `9222`.                                                                                                                                       |
| `BROWSER_DEFAULT_HOST`            | const | Sets the default host probed for an existing browser and used for launches, `'127.0.0.1'`, which avoids `localhost` resolving to `::1` when Chromium binds `127.0.0.1`.                                                       |
| `BROWSER_CDP_PROTOCOL`            | const | Names the protocol prefix for CDP discovery requests, `'http'`.                                                                                                                                                               |
| `BROWSER_CDP_VERSION_PATH`        | const | Names the path appended to the CDP host to fetch version metadata, `'/json/version'`, which is where endpoint discovery reads.                                                                                                |
| `BROWSER_CDP_LIST_PATH`           | const | Names the path appended to the CDP host to list open targets — pages, workers, and every other target category Chromium reports — `'/json/list'`.                                                                             |
| `BROWSER_LAUNCH_ARGS`             | const | Lists the flags always passed to a launched browser process, alongside the caller's own.                                                                                                                                      |
| `BROWSER_HEADLESS_ARG`            | const | Names the flag that enables headless mode on a launched browser process, `'--headless=new'`.                                                                                                                                  |
| `BROWSER_PROFILE_PREFIX`          | const | Names the prefix for isolated browser profiles created beneath the operating-system temp directory, `'orkestrel-browser-'`.                                                                                                   |
| `BROWSER_KILL_GRACE_MS`           | const | Bounds each launched-process exit window during TERM-to-KILL teardown at `3_000` milliseconds.                                                                                                                                |
| `BROWSER_PORT_PROBE_TIMEOUT_MS`   | const | Bounds the `discover: false` port-occupancy probe before launching at `200` milliseconds, which is short because the probe only needs to detect an already-listening CDP endpoint rather than perform full discovery.         |
| `BROWSER_DEVTOOLS_PATTERN`        | const | Matches the stderr line Chromium prints when its CDP endpoint accepts connections, and captures the `ws://` endpoint the line names.                                                                                          |
| `BROWSER_DRAIN_INTERVAL_MS`       | const | Sets the interval in milliseconds between liveness probes of a terminated browser process group.                                                                                                                              |
| `BROWSER_TRANSPORT_LOSS_DEFER_MS` | const | Defers once for `50` milliseconds when a transport loss is observed on an owned process, so a near-simultaneous process-exit event, which libuv might reap slightly later than the socket close, decides the diagnosis first. |
| `BROWSER_PROCESS_EXIT_CAUSE`      | const | Names the machine-readable error-context cause for an owned browser process exiting, `'process-exit'`.                                                                                                                        |
| `BROWSER_TRANSPORT_LOSS_CAUSE`    | const | Names the machine-readable error-context cause for a CDP transport disconnecting while its browser remains alive, `'transport-loss'`.                                                                                         |
| `BROWSER_ENV_PATH_KEYS`           | const | Lists the environment variables checked, in order, for an explicit browser executable path override: `PLAYWRIGHT_EXECUTABLE_PATH`, then `CHROME_PATH`.                                                                        |
| `BROWSER_EXECUTABLE_PATHS`        | const | Lists the well-known Chrome/Chromium/Edge executable paths with no platform-specific root, keyed by `process.platform`, leaving `win32` empty because its roots come from `BROWSER_WINDOWS_SUFFIXES`.                         |
| `BROWSER_WINDOWS_SUFFIXES`        | const | Lists the Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root (`PROGRAMFILES`, `PROGRAMFILES(X86)`, `LOCALAPPDATA`).                                                          |
| `BROWSER_WINDOWS_ROOT_FALLBACKS`  | const | Lists the fallback Windows install roots used when `PROGRAMFILES`, `PROGRAMFILES(X86)`, or `LOCALAPPDATA` is absent.                                                                                                          |
| `BROWSER_EXECUTABLE_NAMES`        | const | Lists the command names probed on PATH when no well-known executable path exists.                                                                                                                                             |
| `BROWSER_STORE_ENV_KEY`           | const | Names the environment variable that carries an additional Playwright browser store base directory, `'PLAYWRIGHT_BROWSERS_PATH'`.                                                                                              |
| `BROWSER_STORE_DEFAULT_DIRS`      | const | Lists the well-known Playwright browser store base directories checked in addition to `PLAYWRIGHT_BROWSERS_PATH`, starting with `/opt/pw-browsers`.                                                                           |
| `BROWSER_STORE_CACHE_DIRS`        | const | Names the per-OS default Playwright browser cache directory, relative to the home directory (win32 uses `LOCALAPPDATA` directly).                                                                                             |
| `BROWSER_STORE_LINK_NAME`         | const | Names the top-level Chromium symlink or binary Playwright maintains inside a browser store base, `'chromium'`.                                                                                                                |
| `BROWSER_ENGINE_HINTS`            | const | Lists the case-insensitive substrings identifying an executable path/name's browser engine, checked by `parseBrowserEngine` in the order `edge` → `chromium` → `chrome`.                                                      |
| `BROWSER_STORE_GLOBS`             | const | Names the glob pattern (relative to a store base) matching a versioned Chromium binary, keyed by `process.platform`.                                                                                                          |
| `BROWSER_JOURNEY_SNAPSHOT_FILE`   | const | Names the persisted journey snapshot.                                                                                                                                                                                         |
| `BROWSER_JOURNEY_REVISION_FILE`   | const | Names the retained journey revision counter.                                                                                                                                                                                  |
| `BROWSER_JOURNEY_LOCK_ATTEMPTS`   | const | Bounds attempts to acquire a journey lock after concurrent recovery.                                                                                                                                                          |
| `BROWSER_JOURNEY_LOCK_DIRECTORY`  | const | Names the exclusive journey write lock directory.                                                                                                                                                                             |
| `BROWSER_RUN_FILE`                | const | Names the persisted run snapshot.                                                                                                                                                                                             |
| `BROWSER_RUN_DIRECTORY`           | const | Names the journey directory holding its runs.                                                                                                                                                                                 |
| `BROWSER_SERVER_POOL_SIZE`        | const | Sets the default number of warm browsers to 1.                                                                                                                                                                                |
| `BROWSER_SERVER_POOL_LIMIT`       | const | Limits the number of warm browsers to 3.                                                                                                                                                                                      |
| `BROWSER_SERVER_RESTARTS`         | const | Permits one failed refill before the next failure spends the bound.                                                                                                                                                           |
| `BROWSER_SERVER_RECORD`           | const | Names the browser process record in each profile.                                                                                                                                                                             |
| `BROWSER_SERVER_EXHAUSTED`        | const | Names the diagnostic when the warm floor spends its restart bound.                                                                                                                                                            |
| `BROWSER_SERVER_LAUNCH`           | const | Names a failed attempt to warm a browser.                                                                                                                                                                                     |
| `BROWSER_SERVER_TEARDOWN`         | const | Names a failed browser server teardown.                                                                                                                                                                                       |
| `BROWSER_SERVER_SWEEP`            | const | Names a failed profile sweep.                                                                                                                                                                                                 |
| `BROWSER_SERVER_OPTIONS`          | const | Names a refused browser server option.                                                                                                                                                                                        |
| `BROWSER_SERVER_UNAVAILABLE`      | const | Names the refusal when no browser can serve a call.                                                                                                                                                                           |
| `BROWSER_SERVER_CRASH`            | const | Names the notice that a browser and its session state were lost.                                                                                                                                                              |
| `BROWSER_SERVER_UNRESOLVED`       | const | Names an interrupted call whose outcome is unknown.                                                                                                                                                                           |
| `BROWSER_FILE_STORE_LIMIT`        | const | Bounds a file-store listing page by default.                                                                                                                                                                                  |

#### Errors

The following table lists the server errors and their guards; `BrowserConnectionError` is a core error, because the in-page transport throws it too.

| API                          | Kind     | Summary                                                                                                                                  |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserNotConnectedError`   | class    | Reports that an operation requiring an active connection was attempted while disconnected, under the code `BROWSER_NOT_CONNECTED_ERROR`. |
| `BrowserDestroyedError`      | class    | Reports that an operation was attempted after the browser wrapper was destroyed, under the code `BROWSER_DESTROYED_ERROR`.               |
| `isBrowserNotConnectedError` | function | Narrows an unknown value to a `BrowserNotConnectedError`.                                                                                |
| `isBrowserDestroyedError`    | function | Narrows an unknown value to a `BrowserDestroyedError`.                                                                                   |

The following fence narrows a failed connection.

```ts
import { isBrowserConnectionError } from '@orkestrel/browser'
import { isBrowserDestroyedError, isBrowserNotConnectedError } from '@orkestrel/browser/server'

try {
	await browser.connect()
} catch (error) {
	if (isBrowserConnectionError(error)) log(error.code, error.context)
	else if (isBrowserNotConnectedError(error)) log(error.code)
	else if (isBrowserDestroyedError(error)) log(error.code)
}
```

#### Helpers

The following table lists the server helpers.

| API                         | Kind     | Summary                                                                                                                                                    |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findSystemBrowsers`        | function | Enumerates every Chrome/Chromium/Edge executable discoverable on this machine, deduplicated by normalized absolute path.                                   |
| `findSystemBrowser`         | function | Locates a Chrome/Chromium/Edge executable on this machine — the first entry of `findSystemBrowsers`.                                                       |
| `formatBrowserLockEntry`    | function | Formats a process identifier and UUID token as a lock entry name.                                                                                          |
| `probeProcess`              | function | Probes whether a process has not been confirmed absent.                                                                                                    |
| `parseBrowserProfileRecord` | function | Parses a profile record naming a positive process identifier and a loopback DevTools endpoint.                                                             |
| `describeBrowserServerLoss` | function | Describes a browser loss with its code, cause, and the session state it invalidates.                                                                       |
| `parseBrowserLockEntry`     | function | Parses the holder process identifier from a lock entry name.                                                                                               |
| `parseBrowserEngine`        | function | Classifies an executable path/name into a `BrowserEngine` by case-insensitive hint, checked in the order edge → chromium → chrome.                         |
| `normalizeExecutablePath`   | function | Normalizes an executable path for cross-source deduplication (case-insensitive on Windows).                                                                |
| `browserToEngine`           | function | Classifies a `/json/version` `Browser` string into a `BrowserEngine` (`Edg/` → edge, `Chrome/` → chrome, else chromium).                                   |
| `createBrowserProfile`      | function | Resolves a persistent caller profile or creates an isolated temporary one.                                                                                 |
| `removeBrowserProfile`      | function | Removes a library-owned isolated browser profile.                                                                                                          |
| `findEnvOverrides`          | function | Checks the env-override keys (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) in order and returns every one that exists.                                     |
| `buildInstallPaths`         | function | Builds the default well-known install-path candidates for a platform, deriving Windows roots from env vars.                                                |
| `buildWindowsRoots`         | function | Derives Windows install roots from env vars, falling back to well-known literals when absent.                                                              |
| `findInstallPaths`          | function | Returns every candidate path that exists on disk, in the given order.                                                                                      |
| `probePathNames`            | function | Probes PATH (`which`/`where`) for every resolvable command name, in the given order.                                                                       |
| `readFirstLine`             | function | Returns the first non-empty line of a command's output, without its surrounding whitespace.                                                                |
| `buildStoreBases`           | function | Builds the default Playwright browser store base directories to search for a managed Chromium.                                                             |
| `findStorePaths`            | function | Searches one store base for the top-level `chromium` link and every `chromium-*` install, highest revision first.                                          |
| `launchBrowserProcess`      | function | Launches a browser process with raw-CDP debugging flags.                                                                                                   |
| `readBrowserEndpoint`       | function | Reads the CDP endpoint a launched browser announces on its standard error.                                                                                 |
| `fetchCDPTargets`           | function | Fetches the current CDP target list from a browser's `/json/list` endpoint, as a `Result` carrying either the targets or a coded `BrowserConnectionError`. |

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
	findSystemBrowser,
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
const found = findSystemBrowser() // SystemBrowser | undefined — first entry of findSystemBrowsers()
// findSystemBrowsers({ env: {}, paths: [], names: [], stores: [], engine: 'edge' }) — override any candidate source, narrow by engine

parseBrowserEngine('/usr/bin/msedge') // 'edge'
normalizeExecutablePath('/usr/bin/Chrome', process.platform) // string — case-folded on win32 only
browserToEngine('HeadlessChrome/120.0') // 'chrome' — classifies a /json/version Browser string
const profile = await createBrowserProfile()
await removeBrowserProfile(profile)

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
	const child = launchBrowserProcess(found.executable, undefined, true) // --remote-debugging-port=0
	const endpoint = await readBrowserEndpoint(child.stderr, AbortSignal.timeout(30_000)) // 'ws://127.0.0.1:PORT/devtools/browser/ID'
	const targets = await fetchCDPTargets(Number(new URL(endpoint).port), 5_000) // Result<readonly CDPTarget[], BrowserError>
}
```

#### Types

The following table lists the server types.

| API                            | Kind      | Summary                                                                                                               |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `BrowserEngine`                | type      | Names a supported browser engine (raw CDP targets Chromium-family browsers only).                                     |
| `BrowserConnection`            | type      | Names how the browser connection was established.                                                                     |
| `BrowserStatus`                | type      | Names the lifecycle status of a browser wrapper.                                                                      |
| `BrowserDiscoveryResult`       | interface | Describes the result of passive browser discovery.                                                                    |
| `SystemBrowserOptions`         | interface | Describes the options overriding `findSystemBrowsers`'/`findSystemBrowser`'s candidate sources.                       |
| `SystemBrowser`                | type      | Represents one discovered browser executable on this machine.                                                         |
| `BrowserProfileRecord`         | interface | Names the browser a browse profile serves, which a later start's sweep reads.                                         |
| `BrowserProfileResult`         | interface | Describes the resolved browser profile directory used for a Chromium-family launch.                                   |
| `BrowserCDPOptions`            | interface | Configures the CDP (Chrome DevTools Protocol) connection.                                                             |
| `BrowserEventMap`              | type      | Maps the events a `BrowserInterface` emits.                                                                           |
| `BrowserOptions`               | interface | Describes the options for creating a `Browser` instance.                                                              |
| `BrowserInterface`             | interface | Wraps a browser with discovery, connection management, and lifecycle control.                                         |
| `WebSocketCDPTransportOptions` | interface | Describes the options for creating a `WebSocketCDPTransport` instance.                                                |
| `FileBrowserStoreOptions`      | interface | Configures a file store: its root under the checkout and the listing cap.                                             |
| `BrowserLaunchFunction`        | type      | Creates a browser a browse server connects while warming its pool.                                                    |
| `BrowserSlot`                  | interface | Holds one warm browser a browse server owns: the browser, its profile, its isolated context, and its started toolset. |
| `BrowserSlotWatch`             | interface | Holds the listeners and resolver of one browser slot's loss watch.                                                    |
| `BrowserMCPServerOptions`      | interface | Configures the browse server.                                                                                         |
| `BrowserMCPServerInterface`    | interface | Serves the browser vocabulary and the journey tools over MCP on stdio.                                                |

### Browser

The in-page face drives a DOM document from a realm that survives that document's navigation: a page driving a same-origin `iframe` it owns or a window it opened, or an extension page driving a document through a content script it can re-create. Its view is untrusted: `view.trusted` is `false`, every event an action dispatches itself carries `isTrusted` `false`, and no action grants user activation. The following fence drives a child document and carries the core client over the browser's `WebSocket`.

```ts
import { createCDPClient } from '@orkestrel/browser'
import {
	createBrowserDOMView,
	createDocumentToolset,
	createSocketCDPTransport,
} from '@orkestrel/browser/browser'

const frame = document.createElement('iframe')
document.body.append(frame)
const view = createBrowserDOMView({ document: frame.contentDocument })
await view.elements.outline() // { text: 'page "" about:blank\n(0 of 0 elements)', … }
view.destroy()

const toolset = createDocumentToolset({ document: frame.contentDocument })
await toolset.start()
toolset.tools.tools().map((tool) => tool.name) // ['look', 'read', 'plain', 'click', 'type', 'wait']

const client = createCDPClient({
	transport: createSocketCDPTransport({ url: 'ws://127.0.0.1:9222/devtools/browser/abc' }),
})
await client.connect() // the browser was started with --remote-allow-origins naming this origin
```

#### Factories

The following table lists the in-page factories.

| API                        | Kind     | Summary                                                                                                                                  |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `createBrowserDOMView`     | function | Creates a view that reads and drives a DOM document without trusted input.                                                               |
| `createDocumentToolset`    | function | Creates a `BrowserToolsetInterface` that publishes the five view tools over a DOM document and adopts a source's page tools beside them. |
| `createSocketCDPTransport` | function | Creates a CDP transport over the browser's native `WebSocket`.                                                                           |

#### Classes

The following table lists the in-page classes. `BrowserDOMView` implements `BrowserDOMViewInterface`, `BrowserDOMElement` implements `BrowserDOMElementInterface`, `BrowserDOMElementManager` implements `BrowserElementManagerInterface`, `BrowserDOMWait` implements `BrowserDOMWaitInterface`, and `SocketCDPTransport` implements `CDPTransportInterface`.

| API                        | Kind  | Summary                                                                                                                                  |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserDOMView`           | class | Reads and drives a DOM document from a realm that can reach it, without trusted input.                                                   |
| `BrowserDOMWait`           | class | Parks one condition on DOM mutations and finished transitions and animations until it holds, with one deadline and coalesced wake tasks. |
| `BrowserDOMElement`        | class | Drives a referenced element of a DOM document without trusted input.                                                                     |
| `BrowserDOMElementManager` | class | Outlines a DOM document from its elements and binds stable references to the interactive ones.                                           |
| `SocketCDPTransport`       | class | Provides a raw CDP text transport over the browser's native `WebSocket`.                                                                 |

#### Constants

The following table lists the in-page constants.

| API                           | Kind  | Summary                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWSER_DOCUMENT_TIMEOUT_MS` | const | Sets the default `wait` deadline for DOM waits in a browser document toolset, `5_000` milliseconds.                                                                                                                                                                                                                                                         |
| `BROWSER_IMPLICIT_ROLES`      | const | Maps an HTML element to the ARIA role the HTML Accessibility API Mappings specification gives it when it carries no `role` attribute.                                                                                                                                                                                                                       |
| `BROWSER_CONTENT_NAMED_ROLES` | const | Names the ARIA roles whose accessible name the accessible-name computation takes from the element's content when no attribute or label names it.                                                                                                                                                                                                            |
| `BROWSER_CONTEXT_TARGETS`     | const | Names the link and form targets that navigate the current browsing context or one of its ancestors. `_blank` opens another browsing context, and any other name targets the browsing context carrying that name, which `matchesBrowserPopup` resolves.                                                                                                      |
| `BROWSER_EXPANDED_ROLES`      | const | Names the roles whose ARIA expansion state the DOM outline reads.                                                                                                                                                                                                                                                                                           |
| `BROWSER_SELECTED_ROLES`      | const | Names the roles whose selection state the DOM outline reads.                                                                                                                                                                                                                                                                                                |
| `BROWSER_TYPED_INPUTS`        | const | Names the `input` type states whose value an untrusted `fill` sets as typed text.                                                                                                                                                                                                                                                                           |
| `BROWSER_INTERACTIVE_CONTENT` | const | Selects the HTML interactive content a click inside a `label` can land on without activating the label, as the HTML interactive-content category lists it: `a` with `href`, `audio` and `video` with `controls`, `button`, `details`, `embed`, `iframe`, `img` with `usemap` or `controls`, `input` other than `hidden`, `label`, `select`, and `textarea`. |

#### Errors

The in-page face declares no error class. It throws the core's coded errors: `BrowserElementError` for an element refusal, `BrowserConnectionError` from `SocketCDPTransport`, and `BrowserError` with the codes `BROWSER_DOCUMENT`, `BROWSER_DOCUMENT_OWN`, and `BROWSER_DOCUMENT_DESTROYED` for a document the view refuses or a view that was destroyed. The core guards in [Errors](#errors) narrow each one.

#### Helpers

The helpers compute the accessible role, name, and text of an element and the visibility rules the outline applies, and read the size-guarded capture a DOM reading is built from. The following table lists them.

| API                         | Kind     | Summary                                                                                                                                                                                                                                           |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readBrowserCapture`        | function | Reads the URL, title, and rendered markup a DOM reading is built from, refusing a capture over the result limit before any parse.                                                                                                                 |
| `isBrowserDocument`         | function | Narrows a value to a `Document` attached to a window.                                                                                                                                                                                             |
| `computeBrowserRole`        | function | Computes the ARIA role of an element from its `role` attribute or its implicit mapping.                                                                                                                                                           |
| `computeBrowserName`        | function | Computes the accessible name of an element, trimmed and whitespace-collapsed.                                                                                                                                                                     |
| `computeBrowserText`        | function | Computes the text an element's content contributes to an accessible name, in the flat tree, trimmed and whitespace-collapsed.                                                                                                                     |
| `readBrowserContent`        | function | Reads the untrimmed text an element's content contributes to an accessible name, in the flat tree.                                                                                                                                                |
| `computeBrowserAlternative` | function | Computes the text one node contributes to an accessible name: its own text alternative, or its content.                                                                                                                                           |
| `matchesBrowserHidden`      | function | Checks whether an element and its subtree are hidden from the rendered page.                                                                                                                                                                      |
| `matchesBrowserInvisible`   | function | Checks whether an element renders nothing visible of its own.                                                                                                                                                                                     |
| `matchesBrowserOmitted`     | function | Checks whether an element sits in an omitted subtree: the element or a flat-tree ancestor that `readBrowserParent` reaches matches `matchesBrowserHidden`, through assigned slots, shadow hosts, and the frame elements of same-origin documents. |
| `readBrowserParent`         | function | Reads an element's parent in the flat tree: the slot it is assigned to in an open shadow root, its parent element, the host of the open shadow root it sits at the top of, or the frame element of its same-origin document.                      |
| `matchesBrowserBlock`       | function | Checks whether an element starts a block of its own, the unit that separates runs of text.                                                                                                                                                        |
| `collectBrowserRoots`       | function | Collects the tree roots a wait observes under a node: the node's own root, then every open shadow root and every same-origin frame document at or beneath it, recursively.                                                                        |
| `matchesBrowserPopup`       | function | Checks whether activating an element opens another browsing context.                                                                                                                                                                              |
| `matchesBrowserActivation`  | function | Checks whether a click on an element activates the `label` that contains it, following the HTML label activation rule.                                                                                                                            |
| `skipBrowserSubtree`        | function | Moves a tree walker past the subtree of its current node.                                                                                                                                                                                         |
| `readBrowserBlock`          | function | Reads the nearest block container of an element, the unit that separates runs of text.                                                                                                                                                            |
| `listenBrowserNavigation`   | function | Subscribes one listener to a window's navigation events until a signal aborts.                                                                                                                                                                    |
| `readBrowserToken`          | function | Reads a lowercased ARIA token, preserving whitespace and treating empty or undefined tokens as absent.                                                                                                                                            |
| `readBrowserStates`         | function | Reads the pressed, expanded, and selected states the DOM outline assigns to an element's role.                                                                                                                                                    |

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
	readBrowserCapture(button) // { url, title, html }; throws BROWSER_RESULT_LIMIT_ERROR past BROWSER_RESULT_LIMIT
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

#### Types

The following table lists the in-page types.

| API                             | Kind      | Summary                                                                                 |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `BrowserDOMViewOptions`         | interface | Configures a view that drives one browser document.                                     |
| `BrowserDocumentToolsetOptions` | interface | Configures a toolset that drives one browser document.                                  |
| `BrowserNameContext`            | interface | Carries the accessible-name traversal context.                                          |
| `BrowserDOMElementInterface`    | interface | Provides DOM actions through a stable element reference, without trusted input.         |
| `BrowserDOMViewInterface`       | interface | Provides the document operations of a view that drives a DOM document in its own realm. |
| `BrowserDOMElementManagerInput` | interface | Binds a DOM element manager to the view that owns it.                                   |
| `BrowserDOMElementInput`        | interface | Binds a DOM element to its reference and the manager that minted it.                    |
| `BrowserMutationWait`           | interface | Describes one wait parked on DOM mutations and finished transitions and animations.     |
| `BrowserDOMWaitInterface`       | interface | Settles one wait parked on DOM mutations and finished transitions and animations.       |
| `SocketCDPTransportOptions`     | interface | Configures a CDP transport over the browser's `WebSocket`.                              |

## Methods

The public methods of each behavioral interface follow, one table per interface; each interface's `readonly` data members stay in its Surface row. The implementing classes and the interfaces they implement are:

- `CDPClient` ↔ `CDPClientInterface`, and `WebSocketCDPTransport` (server) and `SocketCDPTransport` (in-page) ↔ `CDPTransportInterface`;
- `BrowserContext` ↔ `BrowserContextInterface`, `BrowserFrame` ↔ `BrowserFrameInterface`, and `BrowserPage` ↔ `BrowserPageInterface`, which extends both `BrowserFrameInterface` and `BrowserViewInterface<BrowserPageElementInterface>`, so a page's `elements` hands back page elements;
- `BrowserElementManager` (core) and `BrowserDOMElementManager` (in-page) ↔ `BrowserElementManagerInterface`, `BrowserPageElement` ↔ `BrowserPageElementInterface`, and `BrowserDOMElement` ↔ `BrowserDOMElementInterface`, both extending `BrowserElementInterface`;
- `BrowserReading` ↔ `BrowserReadingInterface`, `BrowserRegistry` ↔ `BrowserRegistryInterface`, which also satisfies `BrowserToolSourceInterface`, and `BrowserToolset` ↔ `BrowserToolsetInterface`;
- `BrowserDOMView` ↔ `BrowserDOMViewInterface`, which extends `BrowserViewInterface`, and `BrowserDOMWait` ↔ `BrowserDOMWaitInterface`;
- `BrowserSnapshot` ↔ `BrowserSnapshotInterface`, `BrowserCodegen` ↔ `BrowserCodegenInterface`, which extends `BrowserRecorderInterface`, `BrowserTransition` ↔ `BrowserTransitionInterface`, and `Browser` ↔ `BrowserInterface`;
- `BrowserRecorder` ↔ `BrowserRecorderInterface`, `BrowserReplay` ↔ `BrowserReplayInterface`, `BrowserHold` ↔ `BrowserHoldInterface`, `BrowserJourneyToolset` ↔ `BrowserJourneyToolsetInterface`, `MemoryBrowserJourneyStore` and `FileBrowserJourneyStore` (server) ↔ `BrowserJourneyStoreInterface`, `MemoryBrowserRunStore` and `FileBrowserRunStore` (server) ↔ `BrowserRunStoreInterface`, and `BrowserMCPServer` (server) ↔ `BrowserMCPServerInterface`; `FileBrowserStore` is the filesystem engine the two file stores share and implements no interface of its own;
- a page's `popups` ↔ `BrowserPopupManagerInterface`, whose `record` opens a `BrowserPopupRecordInterface`; both are objects the page builds, with no class of their own;
- `BrowserWebSocket` ↔ `BrowserWebSocketInterface`, `BrowserDownload` ↔ `BrowserDownloadInterface`, `FileBrowserWriter` ↔ `BrowserWriterInterface`, `BrowserNavigationManager` ↔ `BrowserNavigationManagerInterface`, `BrowserNavigationRecord` ↔ `BrowserNavigationRecordInterface`, and `BrowserHandle` ↔ `BrowserHandleInterface`;
- `BrowserScriptManager` ↔ `BrowserScriptManagerInterface`, `BrowserAccessibility` ↔ `BrowserAccessibilityInterface`, `BrowserTracing` ↔ `BrowserTracingInterface`, `BrowserCoverage` ↔ `BrowserCoverageInterface`, `BrowserPerformance` ↔ `BrowserPerformanceInterface`, `BrowserProfiler` ↔ `BrowserProfilerInterface`, `BrowserDiagnostics` ↔ `BrowserDiagnosticsInterface`, and `BrowserClock` ↔ `BrowserClockInterface`;
- `BrowserKeyboard` ↔ `BrowserKeyboardInterface`, `BrowserMouse` ↔ `BrowserMouseInterface`, `BrowserTouch` ↔ `BrowserTouchInterface`, `BrowserDialog` ↔ `BrowserDialogInterface`, `BrowserFileChooser` ↔ `BrowserFileChooserInterface`, and `BrowserWorker` ↔ `BrowserWorkerInterface`;
- `BrowserRoute` ↔ `BrowserRouteInterface`, `BrowserHARManager` ↔ `BrowserHARManagerInterface`, `BrowserNetworkManager` ↔ `BrowserNetworkManagerInterface`, `BrowserCookieManager` ↔ `BrowserCookieManagerInterface`, `BrowserPermissionManager` ↔ `BrowserPermissionManagerInterface`, `BrowserStorageManager` ↔ `BrowserStorageManagerInterface`, and `BrowserEmulationManager` ↔ `BrowserEmulationManagerInterface`.

An interface that extends another repeats every inherited member in its own table, so each table lists the whole callable surface of its interface. `BrowserDOMElementInterface` adds no member to `BrowserElementInterface` and keeps no table until `@orkestrel/guide` reads an empty interface body as empty rather than reading on into the next declaration.

#### `CDPTransportInterface`

The text pipe a `CDPClient` sends and receives JSON-RPC frames over. `WebSocketCDPTransport` implements it over a Node `WebSocket`, and `SocketCDPTransport` over the browser's own.

| Method  | Returns         | Summary                                                                                                                                                                       |
| ------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start` | `Promise<void>` | Opens the underlying connection.                                                                                                                                              |
| `send`  | `Promise<void>` | Writes one raw text frame to the connection. Throws a coded `BrowserConnectionError` carrying the transport `url` when called before the connection opens or after it closes. |
| `close` | `Promise<void>` | Closes the underlying connection and releases its resources.                                                                                                                  |

```ts
transport.emitter.on('message', (data) => log(data))
await transport.start()
await transport.send('{"id":1,"method":"Target.getTargets"}')
await transport.close()
```

#### `CDPClientInterface`

Frames JSON-RPC-shaped CDP method calls and events over an injected
`CDPTransportInterface`. `connect` starts the transport and begins
dispatching; `send` issues a CDP method call, taking its session, per-call
timeout, and abort signal in a trailing `CDPSendOptions`; `emitter` reports the client's own
`connect` / `close` / `drop` / `error` transitions;
`subscribe` / `unsubscribe` register or remove a handler for a CDP event
(optionally session-scoped). Subscriptions are client-level registrations,
not connection-level state — they survive `close()` and a subsequent
`reconnect()` / `connect()`, and resume firing after the client reconnects. Calling
`close()` while a `connect()` is still in flight rejects that in-flight
connect attempt.

| Method        | Returns            | Summary                                                                                                                                                                                                                                         |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect`     | `Promise<void>`    | Starts the transport and begins dispatching. Idempotent.                                                                                                                                                                                        |
| `reconnect`   | `Promise<void>`    | Closes the transport and re-establishes it.                                                                                                                                                                                                     |
| `send`        | `Promise<unknown>` | Issues a CDP method call with optional params and a trailing `CDPSendOptions` carrying the `session` to scope it to, a per-call `timeout` overriding the client-wide default, and a `signal` that aborts the call; rejects on timeout or abort. |
| `subscribe`   | `void`             | Registers a handler for a CDP event, optionally session-scoped.                                                                                                                                                                                 |
| `unsubscribe` | `void`             | Removes a handler for a CDP event, optionally session-scoped.                                                                                                                                                                                   |
| `close`       | `Promise<void>`    | Tears down the transport and rejects every pending request.                                                                                                                                                                                     |

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

#### `BrowserContextInterface`

`BrowserContextOptions.reference` supplies the allocator every page in the context uses, including pages attached by `sync()`. Share one allocator across contexts to keep their references distinct. Without it, each context starts its own counter at `e1`.

An isolated browser session over a CDP browser context; follows the manager
accessor pattern (`page(index?)` / `pages()`).

| Method    | Returns                             | Summary                                                                                                                                                                                                                                                                                          |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page`    | `BrowserPageInterface \| undefined` | Returns one page by index, or the first page.                                                                                                                                                                                                                                                    |
| `pages`   | `readonly BrowserPageInterface[]`   | Returns every page in creation order.                                                                                                                                                                                                                                                            |
| `create`  | `Promise<BrowserPageInterface>`     | Opens a page in this context.                                                                                                                                                                                                                                                                    |
| `sync`    | `Promise<void>`                     | Synchronizes pages from the given CDP targets, which the server discovers and core never fetches. Performs a destructive diff rather than an additive merge: a page whose target id is missing from `targets` is closed and dropped, and a target that is not yet tracked is attached and added. |
| `destroy` | `Promise<void>`                     | Releases local pages and detaches their sessions without disposing the remote browser context.                                                                                                                                                                                                   |
| `close`   | `Promise<void>`                     | Closes remote pages, disposes the remote browser context, and releases local resources.                                                                                                                                                                                                          |

```ts
const context = browser.context()
const page = await context?.create({ url: 'https://example.com' })
const all = context?.pages() // readonly BrowserPageInterface[]
await context?.sync(targets) // reconcile pages from discovered CDP targets
await context?.destroy() // local detach
```

#### `BrowserFrameInterface`

Operations shared by a top-level page and an iframe document. Every asynchronous member takes a trailing `BrowserCallOptions` carrying `timeout` and `signal`. `evaluate` runs in the page's main world; `read` and the element managers run in one isolated world per document, which the page drops on `Runtime.executionContextDestroyed` and `Runtime.executionContextsCleared` and creates again on the next call. A child frame follows its attached out-of-process session when Chromium splits the frame into another target.

A child target runs only after the page has instrumented it. A context configures each page session's auto-attach with `waitForDebuggerOnStart: true`, and the page does the same on each out-of-process frame session, with an `iframe` filter, and on each popup it opens, so every target the page's auto-attach reaches attaches paused. For a frame session the page sends `Page.enable`, `Runtime.enable`, `Page.setLifecycleEventsEnabled`, and `Target.setAutoAttach` and then resumes the target with `Runtime.runIfWaitingForDebugger`; it resumes a worker after `Runtime.enable`, a popup after the popup's domains and network manager start, and any other target at once. The first commit and load of a frame that moved into another process therefore arrive on its new session and carry the loader of the navigation that moved it: on Chromium 141, the new session reports `Page.frameNavigated` with that loader after the resume, the page session then reports the swap, and the new session reports `load` with the same loader. A target the page cannot enable is resumed and then detached, because on Chromium 141 a paused target stays paused after a detach without a resume, so it does not run and its parent document does not reach `load`; the detach waits until the resume attempt settles through a reply, a refusal, the client's timeout, or the connection's close. The page reads a frame session's frame tree only when the attach named no `parentFrameId`, and then only for the frame's parent, URL, and name. [`tests/src/core/BrowserPage.test.ts`](../tests/src/core/BrowserPage.test.ts) pins the order of each step.

| Method        | Returns                            | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | `Promise<string>`                  | Resolves the frame document title.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `read`        | `Promise<BrowserReadingInterface>` | Captures the document URL, title, and rendered HTML in one size-guarded evaluation in the frame's isolated world and returns them as a reading whose `stale` flag tracks later navigations. A frame constructed without an epoch source (a standalone `BrowserFrame` with no `epoch` argument) returns readings whose `stale` stays `false`, because no navigation counter is available to it. `BrowserReadingInput` defines the rendered markup. |
| `evaluate`    | `Promise<unknown>`                 | Evaluates an expression in the frame execution world under the result-size guard.                                                                                                                                                                                                                                                                                                                                                                 |
| `handle`      | `Promise<BrowserHandleInterface>`  | Evaluates an expression by reference and returns a disposable remote object handle.                                                                                                                                                                                                                                                                                                                                                               |
| `send`        | `Promise<unknown>`                 | Issues a raw CDP method in the frame's current target session, with a trailing `BrowserCallOptions` carrying a per-call `timeout` overriding the client-wide default and a `signal` that aborts the call.                                                                                                                                                                                                                                         |
| `subscribe`   | `Promise<void>`                    | Subscribes to a CDP event in the frame's current target session.                                                                                                                                                                                                                                                                                                                                                                                  |
| `unsubscribe` | `Promise<void>`                    | Removes a frame-session CDP event subscription.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `save`        | `Promise<void>`                    | Persists bytes through a page writer; a child frame rejects because it owns no writer.                                                                                                                                                                                                                                                                                                                                                            |
| `assert`      | `void`                             | Throws a coded `BrowserError` when the frame can no longer accept protocol work: a frame throws after the CDP client disconnects, and a page also throws after it closes. Every other member here calls it first.                                                                                                                                                                                                                                 |
| `update`      | `void`                             | Records an externally observed URL as the frame's current `url`, which a page calls from its own `Page.frameNavigated` handler.                                                                                                                                                                                                                                                                                                                   |

```ts
const child = await page.frame('checkout')
const title = await child?.title()
const result = await child?.evaluate('document.readyState', { timeout: 2_000 })
const reading = await child?.read() // BrowserReadingInterface
const handle = await child?.handle('document.body')
await handle?.dispose()
const onLoad = () => log('loaded')
await child?.subscribe('Page.loadEventFired', onLoad)
await child?.unsubscribe('Page.loadEventFired', onLoad)
const root = await child?.send('DOM.getDocument')
const tree = await child?.send('DOM.getDocument', { depth: 1 }, { timeout: 5_000 })
await page.save('./artifact.bin', new Uint8Array([1, 2, 3]))
child?.assert() // throws after the client disconnects, or after the page closes
child?.update('https://example.com/checkout') // record a URL observed elsewhere
```

#### `BrowserViewInterface`

The document operations a remote page and a DOM view share, and the contract a `BrowserToolset` drives. `trusted` is `true` for a `BrowserPage` and `false` for a `BrowserDOMView`, and `elements` is the view's element manager. The capture capability is optional: `emitter` reports the document's output as `BrowserViewEventMap` `console` and `error` events, and `screenshot` captures the view's image bytes. A `BrowserPage` declares both, and a `BrowserDOMView` declares neither. A replay reads output and captures only from a view whose `trusted` is `true` and that declares the member.

| Method       | Returns                            | Summary                                                                                                                                                                                                       |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screenshot` | `Promise<BrowserScreenshotResult>` | Captures PNG or JPEG bytes of the view.                                                                                                                                                                       |
| `title`      | `Promise<string>`                  | Resolves the document title.                                                                                                                                                                                  |
| `read`       | `Promise<BrowserReadingInterface>` | Captures the document URL, title, and rendered markup as a reading whose `stale` flag tracks later navigations; `BrowserReadingInput` defines the rendered markup.                                            |
| `wait`       | `Promise<void>`                    | Resolves when the main document body’s `innerText` contains `text`, or lacks it with `absent`; rejects with a `BrowserError` coded `BROWSER_WAIT_TIMEOUT` at the deadline, and with `signal.reason` on abort. |

The following fence drives a view without knowing its placement.

```ts
async function summarize(view: BrowserViewInterface): Promise<string> {
	await view.wait('Order placed', { timeout: 5_000 })
	const reading = await view.read()
	return `${await view.title()}: ${reading.markdown({ limit: 200 }).text}`
}
```

#### `BrowserPageInterface`

A top-level page. It extends `BrowserFrameInterface` and `BrowserViewInterface`, so its table lists its own operations first and then every inherited member. `trusted` is the constant `true`; `keyboard`, `mouse`, and `touch` dispatch on the page session, whose coordinates Chromium routes into out-of-process frames; and `frames()` lists the frame tree together with every attached out-of-process frame target. The page emits `navigate` with `[url, same]`, `same` being `true` for a same-document navigation, `session` when an out-of-process frame's session attaches, and `popup` for each page it opens.

A page constructed through a context, which passes it a reference allocator, holds its target on the client's connection until it closes, that connection ends, or its setup fails, and the first such page on a connection enables target discovery for it through `Target.setDiscoverTargets`. A second live page for a target another page holds is refused with `BROWSER_TARGET_HELD`. A page constructed directly, as `new BrowserPage(client, target, session)`, holds no target, enables no discovery, and counts as published when its setup completes. A context's `create()` that meets a page another path published for its target joins that page: it applies its `on` hooks, `viewport`, and `url` to that page and resolves with it, and it rejects with `BROWSER_PAGE_CLOSED` when that page closed. A discovered popup is published one time, after its opener, through the opener's `popup`, the context's `page` event, and `pages()`. When the page holding a popup's target fails its setup, discovery publishes nothing and attaches nothing; a later `sync()` adds the target as a page, and the opener emits no `popup` for it.

| Method        | Returns                                       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wait`        | `Promise<void>`                               | Waits for text in the main document body’s `innerText`, or its absence with `absent`, rejecting at the deadline or on abort.                                                                                                                                                                                                                                                                                                                      |
| `navigate`    | `Promise<BrowserNavigationResult>`            | Goes to a URL, waits for the requested load condition, and returns the final URL with its response correlation.                                                                                                                                                                                                                                                                                                                                   |
| `reload`      | `Promise<BrowserNavigationResult>`            | Reloads the page and returns the final URL with its response correlation.                                                                                                                                                                                                                                                                                                                                                                         |
| `back`        | `Promise<BrowserNavigationResult>`            | Navigates to the previous history entry, or returns the unchanged URL when none exists.                                                                                                                                                                                                                                                                                                                                                           |
| `forward`     | `Promise<BrowserNavigationResult>`            | Navigates to the next history entry, or returns the unchanged URL when none exists.                                                                                                                                                                                                                                                                                                                                                               |
| `screenshot`  | `Promise<BrowserScreenshotResult>`            | Captures PNG or JPEG bytes, optionally full-page and persisted through an injected writer.                                                                                                                                                                                                                                                                                                                                                        |
| `pdf`         | `Promise<BrowserPDFResult>`                   | Prints the page to PDF bytes, optionally persisted through the injected writer.                                                                                                                                                                                                                                                                                                                                                                   |
| `frame`       | `Promise<BrowserFrameInterface \| undefined>` | Looks up a first-class frame by name or URL.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `frames`      | `Promise<readonly BrowserFrameInterface[]>`   | Decodes the flattened frame tree, main frame first.                                                                                                                                                                                                                                                                                                                                                                                               |
| `snapshot`    | `Promise<BrowserSnapshotInterface>`           | Captures and decodes every attached document, shadow root, template content, layout box, and requested computed style.                                                                                                                                                                                                                                                                                                                            |
| `codegen`     | `Promise<BrowserCodegenInterface>`            | Starts the action recorder, or returns the running one.                                                                                                                                                                                                                                                                                                                                                                                           |
| `destroy`     | `Promise<void>`                               | Releases local resources and detaches without closing the remote target.                                                                                                                                                                                                                                                                                                                                                                          |
| `close`       | `Promise<void>`                               | Closes the remote target and releases its resources.                                                                                                                                                                                                                                                                                                                                                                                              |
| `title`       | `Promise<string>`                             | Resolves the frame document title.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `read`        | `Promise<BrowserReadingInterface>`            | Captures the document URL, title, and rendered HTML in one size-guarded evaluation in the frame's isolated world and returns them as a reading whose `stale` flag tracks later navigations. A frame constructed without an epoch source (a standalone `BrowserFrame` with no `epoch` argument) returns readings whose `stale` stays `false`, because no navigation counter is available to it. `BrowserReadingInput` defines the rendered markup. |
| `evaluate`    | `Promise<unknown>`                            | Evaluates an expression in the frame execution world under the result-size guard.                                                                                                                                                                                                                                                                                                                                                                 |
| `handle`      | `Promise<BrowserHandleInterface>`             | Evaluates an expression by reference and returns a disposable remote object handle.                                                                                                                                                                                                                                                                                                                                                               |
| `send`        | `Promise<unknown>`                            | Issues a raw CDP method in the frame's current target session, with a trailing `BrowserCallOptions` carrying a per-call `timeout` overriding the client-wide default and a `signal` that aborts the call.                                                                                                                                                                                                                                         |
| `subscribe`   | `Promise<void>`                               | Subscribes to a CDP event in the frame's current target session.                                                                                                                                                                                                                                                                                                                                                                                  |
| `unsubscribe` | `Promise<void>`                               | Removes a frame-session CDP event subscription.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `save`        | `Promise<void>`                               | Persists bytes through a page writer; a child frame rejects because it owns no writer.                                                                                                                                                                                                                                                                                                                                                            |
| `assert`      | `void`                                        | Throws a coded `BrowserError` when the frame can no longer accept protocol work: a frame throws after the CDP client disconnects, and a page also throws after it closes. Every other member here calls it first.                                                                                                                                                                                                                                 |
| `update`      | `void`                                        | Records an externally observed URL as the frame's current `url`, which a page calls from its own `Page.frameNavigated` handler.                                                                                                                                                                                                                                                                                                                   |

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

#### `BrowserElementManagerInterface`

Captures a view's document as an outline and binds a stable reference to each interactive element it lists. A reference is `e` followed by a positive integer, minted from one counter the browser context owns on CDP and the view owns in the DOM placement, so a number is never reused. A cross-document navigation of the main document drops every reference; a child frame's navigation or detachment drops that frame's references. On CDP the outline reads `Accessibility.getFullAXTree` on the page session and on each out-of-process frame session and waits for the current loader's `DOMContentLoaded`; in the DOM placement it walks the document through open shadow roots and same-origin frames and lists an `option` row under each `select`. A query with `exact: true` matches the whole accessible name after whitespace normalization, case-sensitively, which is how a journey step names its element; without it, `name` matches a case-insensitive substring.

| Method     | Returns                        | Summary                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `outline`  | `Promise<BrowserOutline>`      | Captures the view's document as a document-order outline, binding a reference to each interactive element and bounding the referenced rows by `limit`. The outline also lists the rows that best match `search` and names the focused referenced row, both past `limit`. |
| `find`     | `Promise<readonly TElement[]>` | Returns the elements matching `query` by role, case-insensitive accessible-name substring, or CSS selector, within an optional referenced element.                                                                                                                       |
| `wait`     | `Promise<readonly TElement[]>` | Resolves with the elements matching `query` after a mutation or a finished transition or animation produces a match, or after none matches when `absent` is set; rejects at the deadline or on abort.                                                                    |
| `element`  | `TElement \| undefined`        | Returns the element a reference names, or `undefined` when the reference is unknown or was dropped.                                                                                                                                                                      |
| `elements` | `readonly TElement[]`          | Returns every element the manager holds a reference to.                                                                                                                                                                                                                  |
| `clear`    | `void`                         | Drops every reference the manager holds.                                                                                                                                                                                                                                 |

The following fence outlines a page, finds by role and name, and waits for an element a later mutation inserts.

```ts
const outline = await page.elements.outline({ limit: 150 }) // { url, title, text, count, total, matches, focus }
log(outline.text) // page "Cart" https://example.test/cart\n# Your cart\ne1 link "Home"\n…
const [save] = await page.elements.find({ role: 'button', name: 'sav' }) // matches "Save"
const exact = await page.elements.find({ role: 'button', name: 'Save', exact: true }) // "Save" alone, not "save" or "Save draft"
const [email] = await page.elements.find({ css: 'input[type=email]' })
const [done] = await page.elements.wait({ role: 'status' }, { timeout: 5_000 })
await page.elements.wait({ css: '.spinner' }, { absent: true })
page.elements.element('e1') // BrowserPageElementInterface | undefined
page.elements.elements() // every element the manager holds
page.elements.clear() // drops every reference
```

#### `BrowserElementInterface`

The element contract both placements share: `BrowserPageElementInterface` extends it with trusted input on a page, and `BrowserDOMElementInterface` implements it over a DOM element without trusted input. `reference`, `role`, and `name` are Surface data members, and each action refuses with a coded `BrowserElementError`.

| Method   | Returns                            | Summary                                                                                                                                                                                                                                                                         |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `click`  | `Promise<void>`                    | Clicks the element, refusing with a coded `BrowserElementError` when it is gone, hidden, covered, or disabled.                                                                                                                                                                  |
| `fill`   | `Promise<void>`                    | Replaces the value of a text control with `value`, dispatching the input events that typing fires.                                                                                                                                                                              |
| `select` | `Promise<void>`                    | Selects the options of a `select` element whose value or label matches `values`, dispatching `input` and `change`.                                                                                                                                                              |
| `focus`  | `Promise<void>`                    | Moves focus to the element.                                                                                                                                                                                                                                                     |
| `read`   | `Promise<BrowserReadingInterface>` | Captures the element's rendered markup with its document's URL and title as a reading whose `stale` flag tracks later navigations of that document; `BrowserReadingInput` defines the rendered markup.                                                                          |
| `submit` | `Promise<void>`                    | Submits the form the element belongs to. The CDP placement focuses the element and presses Enter through a trusted key pair, sending the release even after an abort; the DOM placement calls the form's `requestSubmit()` and reports the outcome through a `submit` listener. |

The following fence fills and submits a form through a view's element manager without knowing its placement.

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

#### `BrowserPageElementInterface`

Filling and selecting check visibility and enabled state without waiting for animation frames;
filling also checks editability. The actionability compiler samples frames only when its caller
requests `stable: true`, so a hidden tab does not suspend a check that needs no paint.
Pointer actions activate their owning page before sampling stability, because Chromium suspends
animation frames in hidden tabs. The stability check still uses real animation frames.

One referenced element of a page, acted on through trusted input on the page session. `frame` is a Surface data member: the id of the frame whose document holds the element, which a toolset passes to `page.navigation.record`. A click scrolls the element into view, checks that it is visible, enabled, and stable across two animation frames, reads its content quad on its own session, hit-tests the quad center, and dispatches a pressed and released mouse event; each step refuses with a coded `BrowserElementError` whose `context.reason` is `GONE`, `HIDDEN`, `OCCLUDED`, `DISABLED`, `UNTRUSTED`, or `UNKNOWN`, and whose one-line message carries that reason and, for `GONE`, the refresh directive `; call look for fresh refs.` For an element inside an out-of-process frame the point is composed through each frame's content box.

| Method       | Returns                            | Summary                                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hover`      | `Promise<void>`                    | Moves the pointer onto the element with a trusted mouse event.                                                                                                                                                                                                                  |
| `press`      | `Promise<void>`                    | Focuses the element and presses `key` through a trusted key pair, sending the release even after an abort.                                                                                                                                                                      |
| `upload`     | `Promise<void>`                    | Sets the files of a file input to `files`, as paths the browser reads.                                                                                                                                                                                                          |
| `drag`       | `Promise<void>`                    | Drags the element onto the center of `target` with trusted pointer events.                                                                                                                                                                                                      |
| `quad`       | `Promise<BrowserQuad>`             | Resolves the element's content quad in page coordinates, composed through every frame between the element and the page.                                                                                                                                                         |
| `screenshot` | `Promise<BrowserScreenshotResult>` | Captures the page clipped to the element's box.                                                                                                                                                                                                                                 |
| `click`      | `Promise<void>`                    | Clicks the element, refusing with a coded `BrowserElementError` when it is gone, hidden, covered, or disabled.                                                                                                                                                                  |
| `fill`       | `Promise<void>`                    | Replaces the value of a text control with `value`, dispatching the input events that typing fires.                                                                                                                                                                              |
| `select`     | `Promise<void>`                    | Selects the options of a `select` element whose value or label matches `values`, dispatching `input` and `change`.                                                                                                                                                              |
| `focus`      | `Promise<void>`                    | Moves focus to the element.                                                                                                                                                                                                                                                     |
| `read`       | `Promise<BrowserReadingInterface>` | Captures the element's rendered markup with its document's URL and title as a reading whose `stale` flag tracks later navigations of that document; `BrowserReadingInput` defines the rendered markup.                                                                          |
| `submit`     | `Promise<void>`                    | Submits the form the element belongs to. The CDP placement focuses the element and presses Enter through a trusted key pair, sending the release even after an abort; the DOM placement calls the form's `requestSubmit()` and reports the outcome through a `submit` listener. |

The following fence acts on elements the manager found.

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
const quad = await save?.quad() // page coordinates
const shot = await save?.screenshot({ format: 'png' })
```

#### `BrowserReadingInterface`

Captures from a view, frame, or element import the root into an inert document and prune against live layout before projection. Stylesheet-hidden branches and invisible text are absent; a visible descendant of an invisible wrapper remains. Closed details keep their first summary. SVG `switch` keeps the child element with client rects, or its first child element when none has rects, including definitions referenced by `use`; other branches are absent. Canvas, video, and audio fallback text, active floor elements, and content hidden by `content-visibility: hidden` are absent. Assigned light content remains when its slot is displayed; shadow-root-owned text isn't captured. The live document isn't changed.

Forms, displayed dialogs, and buttons become neutral carriers. Text fields and textareas carry live values, with visible placeholders for empty text fields and textareas. A collapsed select carries its selected option's label; a listbox carries displayed option and group labels inside its client area, including unselected rows. Explicit graphic alternatives appear once, while printed button text takes precedence over an accessible name. Links carry their live resolved addresses. Carriers and block `div`, `summary`, and `details` elements receive `br` separators around their contents. The `html` handle contains this normalized capture; caller-supplied HTML remains as supplied. Direct element reads apply the same ancestor visibility and child-pruning rules.

Password and hidden inputs are absent from the capture and every projection, including the data-only fallback for detached roots and documents without a window. Checkbox, radio, range, and color submission values aren't printed text. Native control captions, localized dates, invalid or intermediate number edits, and MathML are omitted rather than guessed. A file input contributes its sole filename; native multiple-file summaries are omitted. Valid committed numbers use their live value. `look` still carries the controls.

Opacity, size, position, clipping outside listboxes, and `content-visibility: auto` don't exclude content. Generated content, text transformations, localized number formatting, textarea clipping, and significant spaces remain fidelity limits. The capture retains `nav`, `header`, `footer`, `aside`, and `menu`; `distill: true` still drops regions and might select a main article. The default `distill: false` keeps the whole captured document. `wait` uses `innerText`, so its text isn't an exact oracle for lowered controls or graphic alternatives.

One captured document, parsed one time and projected to Markdown or to plain text. Each projection runs over the whole document by default and over `html.distill({ base: url })` with `distill: true`, is computed one time per reading and mode, and is cut into slices that share one `total`; the next slice starts at `offset + text.length`. `stale` is derived from the navigation epoch the frame had at capture, which a cross-document navigation, a same-document navigation, and a detachment each advance.

| Method     | Returns             | Summary                                                                                                                                                                              |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `markdown` | `BrowserReadResult` | Returns a slice of the document rendered as Markdown. A bounded slice ends after the last line break in its window when one lies past `offset`, and at `limit` characters otherwise. |
| `text`     | `BrowserReadResult` | Returns a slice of the document rendered as structural plain text, cut by the rule `markdown` applies.                                                                               |

The following fence reads a page in 4 000-character slices.

```ts
const reading = await page.read()
let slice = reading.markdown({ limit: 4_000 })
while (slice.offset + slice.text.length < slice.total && !reading.stale)
	slice = reading.markdown({ offset: slice.offset + slice.text.length, limit: 4_000 })
const whole = reading.text() // navigation and footer included
const main = reading.text({ distill: true }) // main content without navigation or footer
```

The following fence finds matching lines in the whole-page plain-text projection. Match offsets count UTF-16 code units in that projection.

```ts
import {
	createBrowserReading,
	collectBrowserWords,
	scanBrowserText,
	renderBrowserMatches,
} from '@orkestrel/browser'

const reading = createBrowserReading({
	url: 'https://example.test/',
	title: '',
	html: '<nav>Menu</nav><main><p>Blue kettle</p></main>',
})
reading.text().text // 'Menu\nBlue kettle'
reading.text({ distill: true }).text // 'Blue kettle'
const words = [...collectBrowserWords('Blue BLUE to 12')] // ['blue']
const matches = scanBrowserText(reading.text().text, 'blue kettle')
matches // [{ offset: 5, text: 'Blue kettle' }]
renderBrowserMatches(
	'Matches:',
	matches.map((match) => `[${match.offset}] ${match.text}`),
	100,
)
// 'Matches:\n[5] Blue kettle\n\n'
```

#### `BrowserRegistryInterface`

The adapter over the experimental `WebMCP` protocol domain, at `page.registry`. `start` subscribes the domain's four events on the page session and then sends `WebMCP.enable`, and resolves `false` when the browser answers `-32601` (method not found), which Chromium 141 does. The registry enables the domain on each out-of-process frame session the page reports, keys its mirror by frame and name, and emits `change`, `invoke`, and `respond`. `adopt` projects every tool as an untrusted `ToolInterface`: `readOnly` maps to `pure`, `consequential` to `consequential`, and a schema that requires nothing gains a required `purpose` string that is stripped before the invocation.

| Method    | Returns                             | Summary                                                                                   |
| --------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `start`   | `Promise<boolean>`                  | Enables observation; returns `false` only when the protocol domain is absent.             |
| `tool`    | `BrowserTool \| undefined`          | Finds a tool; an omitted frame prefers the main document, then registration order.        |
| `tools`   | `readonly BrowserTool[]`            | Returns every registered tool, including shadowed frame registrations.                    |
| `adopt`   | `Promise<readonly ToolInterface[]>` | Projects tools as untrusted executable tools, omitting optional-purpose schemas.          |
| `execute` | `Promise<BrowserInvocationResult>`  | Invokes a tool and awaits its terminal event; rejects on abort, invalidation, or timeout. |
| `destroy` | `Promise<void>`                     | Disables every enabled session, unsubscribes, and rejects pending invocations.            |

The following fence mirrors a page's registered tools and invokes one.

```ts
if (await page.registry.start()) {
	page.registry.emitter.on('change', () => log(page.registry.tools().length))
	const search = page.registry.tool('search-cars') // the main frame's registration first
	if (search !== undefined) {
		const result = await page.registry.execute(search, { make: 'Volvo' }, { timeout: 10_000 })
		log(result.status, result.output) // 'Completed', the page's untrusted output
	}
	const tools = await page.registry.adopt() // readonly ToolInterface[]
	await page.registry.destroy()
}
```

#### `BrowserToolSourceInterface`

The contract a toolset adopts page tools through, free of protocol types. `BrowserRegistry` satisfies it with its census; `@orkestrel/mcp`'s `ModelContextInterface` satisfies it structurally without one, so a toolset applies only the name checks to that source's tools.

| Method  | Returns                             | Summary                                                                                      |
| ------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `adopt` | `Promise<readonly ToolInterface[]>` | Projects the page's current tools as executable tools.                                       |
| `tools` | `readonly BrowserTool[]`            | Lists the registered tools, from which a toolset decides the `schema` and `debugging` skips. |

The following fence adopts a source's tools on every `change`.

```ts
source.emitter.on('change', async () => {
	const tools = await source.adopt() // readonly ToolInterface[]
	const census = source.tools?.() // readonly BrowserTool[] | undefined
	log(tools.length, census?.length)
})
```

#### `BrowserToolsetInterface`

Publishes the browser vocabulary as `@orkestrel/tool` tools over one current view and adopts the page's tools beside them. A page-backed toolset advertises `look`, `read`, `plain`, `click`, `type`, `press`, `navigate`, and `wait`, stages `dialog` while a dialog is open, and with the `context` option adds `tabs` and `switch`; a view-backed toolset advertises `look`, `read`, `plain`, `click`, `type`, and `wait`. Every tool declares at least one required parameter, `look`, `read`, and `plain` return pages of at most `limit` characters that name the offset of the next page, every other result and error message is cut at `limit` characters plus a footer, and actions run one at a time in first-in, first-out order. `native` holds the generic tools alone, which is what a consumer publishes to a built-in browser agent. [Toolset vocabulary](#toolset-vocabulary) lists each tool and the receipts it returns.

A page-backed `click`, `type`, or `press` produces its receipt in six steps, and the toolset keeps no frame, session, or loader state between them.

1. Observe: `click`, and `type` with `submit`, install a `submit` observer in the isolated world of the element's document, and `press` installs one in every document one `page.frames()` call lists. When the document that receives the input cannot be observed, the action is refused with `BROWSER_TOOLSET_OBSERVE` and sends no input.
2. Record: the action opens `page.navigation.record(frame)` for the element's frame, or for the main frame under `press`, before its first input; `type` opens it before the edit, with or without `submit`.
3. Dispatch: the input races the record's `wait`, so a navigation that starts in the input's frame or an ancestor before the input settles is followed, and the unsettled input stays the queue's barrier.
4. Read: after the input settles, the toolset reads each observer, and every recorded submission that kept its default action names its destination relative to the document that submitted it. The read also reports whether a listener prevented a recorded submission, whether it recorded any, and whether an `input` a form owns received an Enter, which the observer records in the capture phase of `keydown` before the page's handlers run. A read that fails adds nothing.
5. Settle: the record's `settle` follows the earliest navigation that starts in the input's frame, an ancestor, or a destination, and the receipt line names the stage that navigation reached when it did not load; a submission every listener prevented adds no wait. With no surviving destination and no navigation, the receipt line reports that the page handled a prevented submission and names `wait` as the next call, or that no form received an Enter that asked for a submission and recorded none.
6. Capture: the view is captured last and closes the receipt.

One `BROWSER_TOOL_TIMEOUT_MS` deadline bounds the settlement and the capture, and it starts when the input settles or a navigation starts, after any time the action spent queued; `BROWSER_TOOL_CAPTURE_MS` of it is reserved for the capture. Limit: the observers cover only the documents that can receive the input, so a form a script submits in another document adds no wait, and its navigation is followed only when it starts in the input's frame or an ancestor before the settlement ends; a document attached or replaced after the census `press` took is not observed.

A `click`, a `type` with `submit`, or a `press` of Enter also opens `page.popups.record()` beside its navigation record. When the page reports a popup the input opened, the receipt waits within the same deadline for the page to announce it, moves the view to it, and opens its result with `The view moved to a new tab: URL.`; the action's `tab` names the popup.

`tabs()` returns the open tabs of the `context` option as `BrowserTab` values, and the `tabs` tool renders each one as a line of its listing, so a consumer reads the same tabs without parsing that text. Each tab carries the `id` that `switch` takes, its `title`, empty when the title does not answer within `BROWSER_TOOL_TIMEOUT_MS`, its `url`, and whether it is `current`; a toolset without `context` lists none. `tabs()` rejects with `the browser session ended` after `destroy()`, with the signal's reason when its signal aborts, and with `BROWSER_TOOLSET_DIALOG` while a dialog is open on the current tab, and it adds no action, receipt, or run step.

`held` names the acquired hold, or returns `undefined` while no hold owns the toolset. `limit` reports the character limit before a result or error footer. A second `hold` waits for earlier holds to release and honours its signal while waiting.

`follow` performs one recorded step on the current view through `perform`. A `click` or `type` step with a target resolves the one element that carries the target's role and exact accessible name and sends its reference as `ref`, and a stored `reference` or `css` is never read; a `switch` step on a toolset with `context` resolves the one tab `tabs()` lists with the step's URL and title and sends the tab's id as `tab`; every other step sends its arguments unchanged, a page tool's included. Before any input, a missing target or tab refuses with `BROWSER_JOURNEY_TARGET`, several refuse with `BROWSER_JOURNEY_AMBIGUOUS`, and a target name that binds a parameter refuses with `BROWSER_JOURNEY_INPUT`, each naming the step. `follow` returns the `BrowserAction` of a `done` action and of an `interrupted` one, whose dialog a following `dialog` step answers, and throws a `BrowserStepError` whose `action` is the performed action for any other outcome and for a navigation that stopped at `requested` or `committed`. Its `caller` option carries a hold's token, and its `secret` option withholds a `type` step's text. A replay and the module `compileBrowserJourney` emits run every step through it.

`perform` runs the handler a manager call runs and returns the `BrowserAction` beside the tool result, and the toolset emits the same action as `action`; `tools.execute` and `perform` share one path, so a receipt is the same through either, including a secret call whose signal was aborted before the handler ran. A failed `perform` also returns the value its handler threw as `fault`, so a copy of the result keeps a coded `BrowserError`, and a tool's own `execute` rejects with that same value. `hold` takes a queue turn for a replay: until the hold is destroyed, an action whose `context.caller` is not the hold's `token` is refused at admission with `BROWSER_TOOLSET_BUSY`, `dialog` and adopted page tools included, while `look`, `read`, `plain`, `tabs`, and `wait` pass; the toolset emits `hold` and `release` with the journey's name. With the `journeys` option, the toolset constructs a `BrowserJourneyToolset` that adds the six journey tools to the same manager, and destroys it first; see [Journeys](#journeys).

| Method    | Returns                          | Summary                                                                                                                                                                                                                                                                                                                          |
| --------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perform` | `Promise<BrowserToolsetResult>`  | Performs a tool call and returns its structured action when a handler ran.                                                                                                                                                                                                                                                       |
| `follow`  | `Promise<BrowserAction>`         | Performs one recorded step on the current view through `perform` and returns its action.                                                                                                                                                                                                                                         |
| `hold`    | `Promise<BrowserHoldInterface>`  | Takes a queue turn and reserves action admission from the call for the returned caller token.                                                                                                                                                                                                                                    |
| `tabs`    | `Promise<readonly BrowserTab[]>` | Lists the open tabs of the toolset's context in the order the `tabs` tool lists them.                                                                                                                                                                                                                                            |
| `start`   | `Promise<void>`                  | Adds the tools, follows the view, and adopts the page's tools; concurrent calls share one startup. Rejects with a coded `BrowserError` and adds nothing when the manager holds a reserved name under a tool the toolset did not add, and rejects with `the browser session ended` when `destroy()` runs before startup finishes. |
| `destroy` | `Promise<void>`                  | Stops following the view, rejects queued actions, and removes every tool the toolset added that the manager still holds, then calls the `release` option one time; a second call returns the first call's promise.                                                                                                               |

The toolset exposes its reservation and output bound as readonly properties.

| Property | Type                  | Summary                                                                       |
| -------- | --------------------- | ----------------------------------------------------------------------------- |
| `held`   | `string \| undefined` | Names the acquired hold, or returns undefined while no hold owns the toolset. |
| `limit`  | `number`              | Reports the character limit before a result or error footer.                  |

The following fence starts a toolset over a page and runs one tool through its manager.

```ts
const toolset = createBrowserToolset(page, { context, limit: 4_000 }) // context: BrowserContextInterface
toolset.emitter.on('skip', (name, reason) => log(name, reason)) // 'reserved' | 'held' | 'pattern' | 'schema' | 'debugging'
await toolset.start()
const result = await toolset.tools.execute({ id: '1', name: 'look', arguments: { search: 'cart' } })
const performed = await toolset.perform({ id: '2', name: 'click', arguments: { ref: 'e4' } })
performed.action // { action: 'click', target: { role: 'button', name: 'Place order', reference: 'e4', frame }, outcome: 'done', receipt: 'Clicked e4 button "Place order".', … }
const hold = await toolset.hold('add-kettle') // waits for its queue turn
await toolset.tools.execute({ id: '3', name: 'click', arguments: { ref: 'e4' } }) // { success: false, error: 'The toolset is replaying add-kettle until it finishes; call look.' }
await toolset.perform(
	{ id: '4', name: 'click', arguments: { ref: 'e4' } },
	{ signal, caller: hold.token },
) // admitted
hold.destroy() // emits release
const action = await toolset.follow('s2', {
	action: 'click',
	arguments: {},
	target: { role: 'link', name: 'Alpine Kettle' },
}) // BrowserAction { action: 'click', outcome: 'done', receipt: 'Clicked e12 link "Alpine Kettle".', … }
try {
	await toolset.follow('s5', { action: 'wait', arguments: { text: 'Added to cart' } })
} catch (error) {
	if (isBrowserStepError(error)) log(error.action.outcome, error.message) // 'timeout', 's5: "Added to cart" did not appear within 5 s.'
}
await toolset.destroy() // removes the tools it added; the page stays open
```

#### `BrowserSnapshotInterface`

One page capture as navigable data. Its `readonly` members — `documents`
and `styles`, inherited from the Surface `BrowserSnapshotInput` row — are the
entire serialized form; every method that follows derives structure from them on
demand, storing nothing that could drift. Nodes stay
plain `BrowserNode` data — passed in as arguments and handed back unwrapped —
so a snapshot survives `JSON.stringify` and comes back through
`createBrowserSnapshot`. Walks are lazy generators, so `find` stops at the
first match and `filter` stops at its limit.

| Method        | Returns                                 | Summary                                                                                                                                                                   |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walk`        | `Generator<BrowserNode, void, unknown>` | Traverses the whole capture, or one subtree when `root` is given and yielded first, in `'depth'` order by default or in `'breadth'` order. Visits each node exactly once. |
| `descendants` | `Generator<BrowserNode, void, unknown>` | Traverses one node's subtree in depth-first order, excluding the node itself.                                                                                             |
| `document`    | `BrowserDocument \| undefined`          | Resolves the captured document a node belongs to.                                                                                                                         |
| `children`    | `readonly BrowserNode[]`                | Returns the direct children of a node, entering a linked iframe's content document.                                                                                       |
| `parent`      | `BrowserNode \| undefined`              | Returns the structural parent of a node, crossing a document boundary to the owning iframe.                                                                               |
| `siblings`    | `readonly BrowserNode[]`                | Returns the structural siblings of a node; `'preceding'` or `'following'` narrows to one side, and omitting the relation returns every sibling but the node itself.       |
| `ancestors`   | `readonly BrowserNode[]`                | Returns the ancestors of a node, nearest first, across document and iframe boundaries.                                                                                    |
| `common`      | `BrowserNode \| undefined`              | Returns the nearest common ancestor of two nodes, counting each node as its own candidate.                                                                                |
| `distance`    | `number \| undefined`                   | Returns the structural edge count between two nodes, or `undefined` when they share no ancestor.                                                                          |
| `find`        | `BrowserNode \| undefined`              | Returns the first node matching a `BrowserNodeQuery` or a `BrowserNodePredicate`.                                                                                         |
| `filter`      | `readonly BrowserNode[]`                | Returns every matching node, bounded by an optional `limit`; a negative or fractional limit throws a coded `BrowserError`.                                                |
| `closest`     | `BrowserNode \| undefined`              | Returns the nearest match from a node through its ancestors, testing the node first.                                                                                      |
| `path`        | `string`                                | Returns a deterministic frame-qualified structural path for one node.                                                                                                     |

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

	const perLevel = [...snapshot.walk({ root: main, order: 'breadth' })]
	const links = [...snapshot.descendants(main)].filter((node) =>
		matchesBrowserNode(node, { name: 'a', visible: true }),
	) // subtree search: descendants + matchesBrowserNode
}
```

#### `BrowserCodegenInterface`

Records a person's gestures on a page as journey steps, the page source of a recorder, and compiles them into a module. `page.codegen()` returns the page's one recorder. Its listener runs in every frame of the page before the frame resumes and reports each gesture through a runtime binding; the recorder reads the role and exact accessible name of the element the person acted on. A click becomes `click`, except a click on a text control the person then edits, which folds into that `type` step; consecutive edits on one field collapse while the edit is open, and a submission, a focus departure, a navigation, or `stop` closes it. Enter in a field a form owns becomes `type` with `submit: true`, and Enter in an unedited field becomes `press`. A single select change records the option's value when that value selects the option uniquely. A multiple selection, an element in another document, a person's answer to a native dialog, and any other gesture the recorder cannot express become `unresolved` with the reason in `gap`. A navigation the gesture caused is settlement evidence, never a `navigate` step. The listener never sends a password control's value: it sends a marker, and the step binds a secret parameter that `journey` declares. The page calls `attach` with each frame session that attaches while the recorder records, before it resumes that frame.

| Method    | Returns                                  | Summary                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attach`  | `Promise<void>`                          | Installs recording on an attached frame before its owner resumes it.                                                                                                                                                                                                                                                                                                         |
| `start`   | `Promise<void>`                          | Begins recording from the recorder's source.                                                                                                                                                                                                                                                                                                                                 |
| `stop`    | `Promise<readonly BrowserJourneyStep[]>` | Stops recording and returns the recorded steps.                                                                                                                                                                                                                                                                                                                              |
| `steps`   | `readonly BrowserJourneyStep[]`          | Returns the steps recorded so far.                                                                                                                                                                                                                                                                                                                                           |
| `journey` | `BrowserJourney`                         | Returns the recorded steps as a journey with that name and description, with its parameters derived: every secret marker declares a secret parameter named after its control's accessible name in lower camel case, such as `confirmPassword`, falling back to `secret1`, `secret2`, and so on when the derived name is invalid or taken; `next` is one past the highest id. |
| `script`  | `BrowserCodegenScript`                   | Compiles the recorded journey into a standalone module and lists its gaps.                                                                                                                                                                                                                                                                                                   |
| `clear`   | `void`                                   | Drops the recorded steps.                                                                                                                                                                                                                                                                                                                                                    |
| `destroy` | `Promise<void>`                          | Stops recording and releases the recorder's listeners.                                                                                                                                                                                                                                                                                                                       |

The following fence records a person's edit and click, then compiles the steps into a TypeScript module.

```ts
const codegen = await page.codegen({ on: { step: (step) => log(step.id, step.action) } })
// the person types an email address into the Email field and clicks Save
const steps = await codegen.stop() // s1 type textbox "Email", s2 click button "Save"
codegen.steps() // the same steps
const journey = codegen.journey({ name: 'save-email', description: 'Save the email address' })
const { source, gaps } = codegen.script({
	name: 'save-email',
	description: 'Save the email address',
	language: 'typescript',
})
codegen.clear() // drops the recorded steps
await codegen.destroy()
```

#### `BrowserRecorderInterface`

Records the steps of a journey from one source and turns them into a journey. `createBrowserRecorder(toolset)` records the toolset's own actions from its `action`, `hold`, and `release` events: an action whose outcome is `done` becomes its step with the target's role and exact name, and the reference kept as evidence; an `interrupted` action followed by a completed `dialog` becomes both steps, and followed by anything else a gap; a `switch` keeps the tab's URL and title; an action in a child frame becomes the gap `the element is in a child frame`; a secret `type` binds a secret parameter; and the actions between a `hold` and its `release` become one `unresolved` step, `replayed NAME`. `look`, `read`, `plain`, `tabs`, the journey tools, and a refused action are never steps. `start` drops the steps of an earlier recording.

| Method    | Returns                                  | Summary                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`                          | Begins recording from the recorder's source.                                                                                                                                                                                                                                                                                                                                 |
| `stop`    | `Promise<readonly BrowserJourneyStep[]>` | Stops recording and returns the recorded steps.                                                                                                                                                                                                                                                                                                                              |
| `steps`   | `readonly BrowserJourneyStep[]`          | Returns the steps recorded so far.                                                                                                                                                                                                                                                                                                                                           |
| `journey` | `BrowserJourney`                         | Returns the recorded steps as a journey with that name and description, with its parameters derived: every secret marker declares a secret parameter named after its control's accessible name in lower camel case, such as `confirmPassword`, falling back to `secret1`, `secret2`, and so on when the derived name is invalid or taken; `next` is one past the highest id. |
| `clear`   | `void`                                   | Drops the recorded steps.                                                                                                                                                                                                                                                                                                                                                    |
| `destroy` | `Promise<void>`                          | Stops recording and releases the recorder's listeners.                                                                                                                                                                                                                                                                                                                       |

The following fence records a click and a wait through the toolset and turns them into a journey.

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

#### `BrowserReplayInterface`

Replays one journey over a toolset. `execute` runs four stages:

1. Preparation, before any side effect: the journey is validated, the inputs are merged over the parameters' defaults, and a missing or unknown input, a gap step, or a native action the placement cannot execute rejects `execute` with `BROWSER_JOURNEY_INPUT`, `BROWSER_JOURNEY_GAP`, `BROWSER_JOURNEY_PLACEMENT`, or the validator's code before any run exists. A page-backed toolset executes `click`, `type`, `press`, `navigate`, `wait`, `dialog`, and, with `context`, `switch`; the DOM placement executes `click`, `type`, `wait`, and its adopted page tools.
2. Hold: `toolset.hold(name)` takes a queue turn under the call's signal, and the replay destroys the hold in `finally`, abort included.
3. Steps, in order: each step runs through the toolset's `follow`, which resolves its target on the live view by role and exact name, each call carries the hold's token, and the replay judges the `BrowserAction` the toolset returns, never the receipt's text. The run stops after the first step whose outcome is not `done`, and after a navigation that stopped at `requested` or `committed`; an `interrupted` action admits only an immediately following `dialog` step.
4. Finalization: with `runs`, the replay opens a run slot before the first step, writes each capture of a trusted view that declares `screenshot` through `runs.capture`, and writes the run with a bounded write of its own signal, so an aborted run is still written; a failed write is recorded in `fault`.

See [Parameters and secrets](#parameters-and-secrets) for the run of a journey with a secret parameter.

| Method    | Returns               | Summary                                                                                                                                                                                                                                                       |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute` | `Promise<BrowserRun>` | Prepares the journey, holds the toolset, performs each step in order, and resolves with the run, which stops at the first step that did not complete. Rejects with a coded `BrowserError` at preparation, before any side effect, and on a destroyed toolset. |

The following fence replays a journey with an input and writes its run.

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

#### `BrowserHoldInterface`

The queue turn a replay owns. `BrowserHold` mints `token` with `crypto.randomUUID()`, and `destroy` releases the toolset one time however often it runs.

| Method    | Returns | Summary                                            |
| --------- | ------- | -------------------------------------------------- |
| `destroy` | `void`  | Releases the toolset to the calls behind the hold. |

The following fence holds the toolset for one admitted call.

```ts
const hold = await toolset.hold('add-kettle', { signal })
try {
	await toolset.perform(
		{ id: '1', name: 'click', arguments: { ref: 'e4' } },
		{ signal, caller: hold.token },
	)
} finally {
	hold.destroy()
}
```

#### `BrowserJourneyStoreInterface`

Keeps journeys by name with a revision per write. `MemoryBrowserJourneyStore` holds clones in memory, and `FileBrowserJourneyStore` keeps each journey under `ROOT/NAME/` as `journey.json`, which carries the revision beside the journey, with the `revision` counter in its own file. The file store creates `journey.lock/` exclusively for each `set` and `delete`, then exclusively creates an empty entry named `PID-TOKEN` inside it. It enters the mutation only when that entry is the directory’s sole entry. A live holder or an unreadable holder identity refuses at once with `BROWSER_JOURNEY_LOCKED`. A dead holder’s exact entry is unlinked before the empty directory is removed; an empty lock directory is also reclaimed. Acquisition retries up to `BROWSER_JOURNEY_LOCK_ATTEMPTS`, then refuses with `BROWSER_JOURNEY_LOCKED`. Release removes only the holder’s own entry and the emptied directory. Inside the lock the store compares `expected`, takes the next revision, writes a sibling temporary file, and renames it; a failed write removes the temporary file and leaves the earlier revision readable. Both stores keep the revision count across `delete`, so a recreated journey continues it and a writer that read the deleted revision is refused with `BROWSER_JOURNEY_STALE`. A missing journey is `undefined`; a malformed file rejects with `BROWSER_JOURNEY_FILE`, an unknown format with `BROWSER_JOURNEY_FORMAT`, and a permission error with `BROWSER_JOURNEY_ACCESS`, each naming the path.

| Method   | Returns                                             | Summary                                                                                                                                                                                                                                                                            |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`    | `Promise<BrowserJourneyRevision \| undefined>`      | Returns the journey saved under `name` with its revision, or `undefined` when none is saved. Rejects with `BROWSER_JOURNEY_FILE` for a malformed entry, `BROWSER_JOURNEY_FORMAT` for an unknown format, and `BROWSER_JOURNEY_ACCESS` for a permission error, each naming the path. |
| `set`    | `Promise<BrowserJourneyRevision>`                   | Saves the journey under its name with the next revision and returns it.                                                                                                                                                                                                            |
| `delete` | `Promise<void>`                                     | Removes the journey saved under `name` and keeps its revision count, so a recreated journey continues it; a missing name is a no-op. Rejects with `BROWSER_JOURNEY_LOCKED` when another write holds the name.                                                                      |
| `list`   | `Promise<BrowserStorePage<BrowserJourneyRevision>>` | Returns one page of the saved journeys sorted by name, starting at `offset` and holding at most `limit` entries, with the entries it could not read in `faults`.                                                                                                                   |

The following fence saves a journey, writes it again at the revision it read, and lists the store.

```ts
const store = createMemoryBrowserJourneyStore()
const first = await store.set(journey) // { journey, revision: 1 }
const read = await store.get('add-kettle')
await store.set(journey, read?.revision) // { journey, revision: 2 }
await store.set(journey, 1) // rejects with BROWSER_JOURNEY_STALE
const page = await store.list({ offset: 0, limit: 20 }) // { entries, truncated: false, faults: [] }
await store.delete('add-kettle')
```

#### `BrowserRunStoreInterface`

Keeps runs by the journey name and run id the run carries. A run id is the ISO time with `-` for `:`, followed by `-` and 4 hexadecimal digits, such as `2026-10-01T03-07-06.041Z-6d7e`. `FileBrowserRunStore` creates `ROOT/NAME/runs/ID/` exclusively in `open`, retrying with a fresh id on a collision, writes `run.json` there, and writes a capture only into a directory it opened, refusing a slot it did not open, a name outside `sN.png`, and a directory that is missing or a link; it creates no directory for a capture. `MemoryBrowserRunStore` has no directories: `open` mints an id, and `capture` resolves `undefined`, so a step carries no `capture`.

| Method    | Returns                                 | Summary                                                                                                                                                                                                                                             |
| --------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`    | `Promise<BrowserRunSlot>`               | Mints a run id for the journey and creates its run directory exclusively.                                                                                                                                                                           |
| `get`     | `Promise<BrowserRun \| undefined>`      | Returns the run stored under the journey name and id, or `undefined` when none is stored.                                                                                                                                                           |
| `set`     | `Promise<void>`                         | Writes the run under the journey name and the run id it carries.                                                                                                                                                                                    |
| `capture` | `Promise<string \| undefined>`          | Writes capture bytes under the name into the run directory `open` created for the slot.                                                                                                                                                             |
| `delete`  | `Promise<void>`                         | Removes the run stored under the journey name and id; a missing run is a no-op.                                                                                                                                                                     |
| `clear`   | `Promise<number>`                       | Removes every run and opened slot of a journey and returns their count, including unsaved slots; a missing name returns zero. File stores exclude concurrent allocation with the journey lock and refuse a held lock with `BROWSER_JOURNEY_LOCKED`. |
| `list`    | `Promise<BrowserStorePage<BrowserRun>>` | Returns one page of the journey's runs, starting at `offset` and holding at most `limit` entries, with the entries it could not read in `faults`.                                                                                                   |

The following fence opens a run slot, writes a capture and the run, and reads them back.

```ts
const runs = createMemoryBrowserRunStore()
const slot = await runs.open('add-kettle') // { id: '2026-10-01T03-07-06.041Z-6d7e' }
await runs.capture(slot, 's2.png', bytes) // undefined in memory; 's2.png' in a file store
await runs.set({ ...run, id: slot.id })
await runs.get('add-kettle', slot.id) // the run
await runs.list('add-kettle', { limit: 10 }) // { entries, truncated, faults }
await runs.delete('add-kettle', slot.id)
```

#### `BrowserJourneyToolsetInterface`

Registers the six journey tools on the toolset's manager and owns the recording and the active replay. `BrowserToolset` constructs it when given `journeys` and destroys it before its own teardown; it refuses construction with `BROWSER_TOOLSET_RESERVED` when the manager already holds a journey tool's name. See [Journeys](#journeys) for the tools.

| Method    | Returns         | Summary                                                                      |
| --------- | --------------- | ---------------------------------------------------------------------------- |
| `destroy` | `Promise<void>` | Aborts the active replay and removes the six journey tools from the manager. |

The following fence constructs the journey toolset through `BrowserToolset`, starts a recording, and destroys both.

```ts
const toolset = createBrowserToolset(page, { journeys: { store, runs, readonly: false } })
await toolset.start()
await toolset.tools.execute({ id: '1', name: 'record', arguments: { journey: 'add-kettle' } })
await toolset.destroy() // destroys the journey toolset first: aborts a replay and drops an unsaved recording
```

#### `BrowserTransitionInterface`

One asynchronous transition at a time, shared by every caller that joins it
while it runs. An entity keeps its own entry guards — what makes a transition
unnecessary is the entity's own state — and holds one `BrowserTransition` per
transition, so the in-flight identity check is written once instead of once per
lifecycle.

| Method    | Returns      | Summary                                                                                                       |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `execute` | `Promise<T>` | Starts the work when nothing is in flight, and otherwise joins the running transition and returns its result. |

```ts
import { BrowserTransition } from '@orkestrel/browser'

const starting = new BrowserTransition()
await starting.execute(() => transport.start())
const joined = starting.pending // the in-flight promise, or undefined
```

#### `BrowserInterface`

Browser wrapper with discovery, connection management, and lifecycle control. `connect()` tries an explicit `cdp.endpoint`, then passive discovery on `cdp.port`, then a launch whose endpoint it reads from the child's standard error through `readBrowserEndpoint`.

| Method       | Returns                                | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ping`       | `Promise<void>`                        | Sends CDP `Browser.getVersion` and resolves when the browser answers, changing no state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `discover`   | `Promise<BrowserDiscoveryResult>`      | Probes CDP passively, changing no connection state and neither launching nor attaching, and emits a `discover` event with the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `connect`    | `Promise<void>`                        | Establishes a connection through the endpoint, then discovery, then a launch. Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `adopt`      | `void`                                 | Assumes responsibility for terminating the connected browser.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `disconnect` | `Promise<void>`                        | Detaches the client-side transport while the remote browser keeps running. An attached CDP session that this instance neither launched nor adopted forgets the endpoint and its ownership becomes `undefined`. A launched or explicitly adopted session retains ownership and its endpoint, so the same instance can reconnect and stays responsible for eventual termination. Transport loss while an owned browser remains alive is resumable the same way.                                                                                                                                                       |
| `context`    | `BrowserContextInterface \| undefined` | Returns one context by index, or the first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `contexts`   | `readonly BrowserContextInterface[]`   | Returns every context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `isolate`    | `Promise<BrowserContextInterface>`     | Creates and registers an isolated CDP context with validated proxy, download, origin, and emulation options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `create`     | `Promise<BrowserPageInterface>`        | Opens a page in the default context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `destroy`    | `Promise<void>`                        | Releases local resources. A launched browser has the process serving its CDP endpoint terminated and its exit awaited — on POSIX that terminate reaches the launch's whole process group and awaits its drain, and on Windows it terminates one process by identifier, the spawned process or the one a launcher handed the endpoint to — which leaves the profile unlocked before cleanup. An adopted attachment is sent CDP `Browser.close`. An attached browser that this instance neither launched nor adopted is detached locally and nothing more, because other clients might share its targets. Idempotent. |
| `close`      | `Promise<void>`                        | Shuts the remote browser down: sends CDP `Browser.close` best-effort whether attached or owned, and for an owned browser also awaits the exit of the process serving the CDP endpoint plus its POSIX process-group drain, escalating to a kill only where needed. Then closes every tracked context and page, sending remote `Target.closeTarget` and `disposeBrowserContext` whatever the ownership, before releasing the CDP client. This is the way to shut down a browser the instance does not own and still wants terminated.                                                                                 |

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ profile: './profile', cdp: { port: 9222 } })
browser.emitter.on('connect', (mode) => log(mode))
await browser.connect()
const owned = browser.owned // true for this launched session
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

Serves the browser vocabulary and the journey tools over MCP on stdio. The server warms its pool at start and holds one validated lease. Initialization and tool calls await setup; a lost lease is replaced within the pool's restart bound. Each launch creates an exclusive `ROOT/.profiles/PID-UUID/` profile and an isolated context. `tools/list` answers while warming. Adopted page tools are mirrored until withdrawn or their lease is lost.

A disconnect or a crash of the current page retires its slot; a background-page crash leaves the lease intact. Hand-out, per-call, and post-failure pings detect browsers that stopped answering. An interrupted failure answers `BROWSER_SERVER_UNRESOLVED`, a known success remains successful, and pending loss notes prefix the next string outcome on a successor or a refusal. Every pending loss is reported. Calls are never repeated, and replacement pages start at `about:blank`.

The end of input, `SIGINT`, and `SIGTERM` stop admission and destroy the pool. Teardown releases watch listeners, destroys each toolset before its browser, and rechecks recorded folders. Unconfirmed termination retains its slot; a stranded launch prevents further launches. A timed-out ping forces termination before teardown. On Linux, a root process launches with `--no-sandbox`; other launches keep the sandbox.

| Method    | Returns         | Summary                                                                                                                                                                                                                                                                                                                                                            |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `start`   | `Promise<void>` | Serves stdio, sweeps the profiles ended servers left, warms the pool, and resolves after the session leases a warm browser; the legacy handshake and every tool call await the same setup. Rejects with `BROWSER_SERVER_UNAVAILABLE` when no browser can serve and with `BROWSER_TOOLSET_ENDED` after `destroy()`, and resolves when `destroy()` interrupts setup. |
| `destroy` | `Promise<void>` | Stops admission, tears down every browser, its toolset, and its profile, then rechecks the folders it answers for.                                                                                                                                                                                                                                                 |

The following fence serves the vocabulary on the process's standard streams, with the journeys under `tmp/browsers`.

```ts
import { createBrowserMCPServer } from '@orkestrel/browser/server'

const server = createBrowserMCPServer({ root: 'tmp/browsers', headless: true, readonly: false })
await server.start() // resolves after the first warm browser is leased; tools/list answers meanwhile
await server.destroy() // aborts a replay, destroys every browser it launched, and removes each profile
```

#### `BrowserWebSocketInterface`

One WebSocket connection a page's network manager reconstructs from
Network-domain events. The manager owns the connection and drives every method
here; a consumer reads `id` and `url` and subscribes through `emitter`.

| Method     | Returns | Summary                                                                                        |
| ---------- | ------- | ---------------------------------------------------------------------------------------------- |
| `receive`  | `void`  | Reports one received frame. The page's network manager drives it.                              |
| `transmit` | `void`  | Reports one sent frame. The page's network manager drives it.                                  |
| `fail`     | `void`  | Reports a connection fault. The page's network manager drives it.                              |
| `close`    | `void`  | Reports the connection closing and destroys the emitter. The page's network manager drives it. |

```ts
page.network.emitter.on('socket', (socket) => {
	log(socket.id, socket.url)
	socket.emitter.on('receive', (frame) => log(frame.data))
	socket.emitter.on('transmit', (frame) => log(frame.data))
	socket.emitter.on('error', (message) => log(message))
	socket.emitter.on('close', (timestamp) => log(timestamp))
})
// The page's network manager drives the connection from Network-domain events:
socket.receive({ opcode: 1, data: 'pong', masked: false, timestamp: 4 })
socket.transmit({ opcode: 1, data: 'ping', masked: false, timestamp: 3 })
socket.fail('handshake rejected')
socket.close(6)
```

#### `BrowserDownloadInterface`

One context download tracked through Chromium's Browser domain. The owning page
drives `update` from `Browser.downloadProgress`; a consumer calls `abort` and
reads the observed state.

| Method   | Returns         | Summary                                                                                                                                                                     |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abort`  | `Promise<void>` | Aborts the download by sending CDP `Browser.cancelDownload`, and is ignored unless the status is still pending. The status becomes `'aborted'` and the `abort` event fires. |
| `update` | `void`          | Records one step of the download's progress. The owning page drives it.                                                                                                     |

```ts
page.emitter.on('download', (download) => {
	log(download.id, download.url, download.name)
	download.emitter.on('progress', (received, total) => log(received, total))
	download.emitter.on('complete', (path) => log(path))
	download.emitter.on('abort', () => log('aborted'))
})
// The owning page drives progress from Browser.downloadProgress:
download.update({ status: 'pending', received: 512, total: 2_048 })
download.update({ status: 'complete', received: 2_048, total: 2_048, path: './report.pdf' })
await download.abort() // ignored after the download settled
```

#### `BrowserWriterInterface`

The pluggable sink a page persists captured bytes through. Core never touches a
filesystem; server supplies `FileBrowserWriter`.

| Method  | Returns         | Summary                                                                         |
| ------- | --------------- | ------------------------------------------------------------------------------- |
| `write` | `Promise<void>` | Persists the captured bytes to the given path, creating its parent directories. |

```ts
import { FileBrowserWriter } from '@orkestrel/browser/server'

const writer = new FileBrowserWriter()
await writer.write('shots/hero.png', new Uint8Array([137, 80, 78, 71]))
```

#### `BrowserNavigationManagerInterface`

Waits for a navigation the page performs on its own, rather than one the caller started, and for network idle, and opens the record that settles the navigation an input starts. Each wait parks on a protocol event and an abort signal; `wait` resolves on same-document navigations too, `idle` on the next `networkIdle` lifecycle event of the current loader, and both reject at their timeout with `BROWSER_NAVIGATION_TIMEOUT`. The page constructs its manager with two more arguments than the waits need: `steps`, the emitter of the `BrowserNavigationEventMap` steps the page accepts from the session that owns each frame, and `parent`, which returns the parent the page last recorded for a frame, or `undefined` when the page cannot name it. A record opened through the manager rejects its pending waits with the page-closed error when the page closes.

| Method   | Returns                            | Summary                                                                                                                                                                          |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wait`   | `Promise<string>`                  | Resolves with the URL of the next navigation, same-document ones included, matching the `*` and `**` glob pattern. Rejects on timeout, and with `signal.reason` on abort.        |
| `idle`   | `Promise<void>`                    | Resolves on the next `networkIdle` lifecycle event of the page's current loader. Rejects on timeout, and with `signal.reason` on abort.                                          |
| `record` | `BrowserNavigationRecordInterface` | Opens a record of the navigations the page's frames start from this call on, for an input dispatched into `frame` next. Thrown when the page is closed: the page's closed error. |

```ts
const navigated = page.navigation.wait('**/checkout')
await (await page.elements.find({ css: '#buy' }))[0]?.click()
log(await navigated)
await page.navigation.idle({ signal: AbortSignal.timeout(10_000) })
const record = page.navigation.record(page.id) // before the input the record settles
```

#### `BrowserNavigationRecordInterface`

The settlement of the navigation one input starts, read from the steps the page accepts after the record opens. The page accepts every step its own session reports, and a step from a frame session about a frame that no other session owns, so a step from a session the frame left is dropped. The eligible frames are the record's frame, every ancestor the page can name, and the main frame, plus each frame a `settle` destination resolves to; a destination whose parent the page cannot name makes the first start in any frame eligible. A start is a `Page.frameStartedNavigating`, which names the navigation's loader, or a `Page.frameRequestedNavigation` in the current tab, which names none and the navigation's reason, and which the started step then supersedes. A start carries the reason of the latest current-tab request for its frame when that request, from any session the page knows, named the same URL, because the document that initiates a navigation reports the request even when another session owns the navigating frame. Every start of the frame drops the request, and a start whose `navigationType` is in `BROWSER_RELOAD_NAVIGATION_TYPES` takes no reason; the next request for the frame replaces it, and a same-document commit, the frame's removal, and the page's teardown drop it. The earliest eligible start after the record opened is selected, and a later start in that frame before its commit supersedes it; the commit must carry the selected loader when both are known and is otherwise the frame's first commit after the start, the load must carry the commit's loader, and a same-document commit completes the navigation as `loaded`. `settle` never rejects at its timeout, because the stage it reached is the answer: `requested` carries the requested URL, `committed` and `loaded` the committed URL, and every stage carries `reason`, the `BrowserNavigationReason` the request named, or `undefined`. The record selects by arrival, not by cause, so a navigation an earlier action started that begins after the record opened can be selected.

| Method    | Returns                                         | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wait`    | `Promise<void>`                                 | Resolves when the record's frame or one of its ancestors starts a navigation after the record opened; `settle` reports that navigation's reason. Rejects at `timeout` with `BROWSER_NAVIGATION_TIMEOUT`, with `signal.reason` on abort, and when the record ends or the page closes.                                                                                                                                                                                                                                                        |
| `settle`  | `Promise<BrowserSettlementResult \| undefined>` | Follows the earliest navigation started after the record opened in the record's frame, one of its ancestors, or a frame `destinations` names, waiting within `timeout` for a destination to start one. Resolves with the stage reached at completion or at `timeout` and the reason `Page.frameRequestedNavigation` named for the navigation, or `undefined` when none started; a selected frame that detaches ends the wait with the stage it reached. Rejects with `signal.reason` on abort, and when the record ends or the page closes. |
| `destroy` | `void`                                          | Ends the record and rejects a pending `wait` or `settle`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The following fence settles the navigation a click starts, following a submission the click's frame aimed at its parent.

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

#### `BrowserPopupManagerInterface`

Opens the records that settle the popups an input opens, as `page.popups`. A toolset opens one beside the navigation record of each `click`, `type` with `submit`, and `press` of Enter.

| Method   | Returns                       | Summary                                                                                                                                               |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record` | `BrowserPopupRecordInterface` | Opens a record of the popups the page opens from this call on, for an input dispatched next. Thrown when the page is closed: the page's closed error. |

#### `BrowserPopupRecordInterface`

Counts the `Page.windowOpen` reports the page's own session sends after the record opened; on Chromium 141 that report arrives before the reply to the input that opened the window. Each report names one popup, and the record waits until as many popups the page adopted concluded, announced through `popup` or skipped because they closed or failed their setup. A `window.open` that names a window already open sends no report, and a page constructed without a `reference` function takes no part in target discovery and counts no report.

| Method    | Returns                                    | Summary                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settle`  | `Promise<readonly BrowserPageInterface[]>` | Resolves at once with an empty list when no report arrived after the record opened; otherwise waits within `timeout` until as many adopted popups concluded as reports arrived, and resolves with the announced popups whose `opener` is this page, in announcement order, at that point or at `timeout`. Rejects with `signal.reason` on abort, and when the record ends or the page closes. |
| `destroy` | `void`                                     | Ends the record and rejects a pending `settle`.                                                                                                                                                                                                                                                                                                                                               |

The following fence settles the popup a click opens.

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

#### `BrowserHandleInterface`

A retained remote JavaScript object. Release it with `dispose` when done.

| Method       | Returns                                        | Summary                                                                                         |
| ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `value`      | `Promise<unknown>`                             | Reads the object back by value.                                                                 |
| `call`       | `Promise<unknown>`                             | Runs a function declaration with the handle as `this`, by value.                                |
| `property`   | `Promise<BrowserHandleInterface \| undefined>` | Retains one own property as its own handle, or returns `undefined` when the property is absent. |
| `properties` | `Promise<Readonly<Record<string, unknown>>>`   | Reads every own property by value.                                                              |
| `dispose`    | `Promise<void>`                                | Releases the retained remote object. Idempotent.                                                |

```ts
const handle = await page.handle('document.body')
log(await handle.value())
log(await handle.call('function() { return this.tagName }'))
const dataset = await handle.property('dataset')
log(await handle.properties())
await dataset?.dispose()
await handle.dispose()
```

#### `BrowserScriptManagerInterface`

Installs new-document scripts and exposes host functions into page JavaScript.

| Method    | Returns           | Summary                                                                        |
| --------- | ----------------- | ------------------------------------------------------------------------------ |
| `add`     | `Promise<string>` | Installs a script evaluated on every new document, and returns its identifier. |
| `remove`  | `Promise<void>`   | Removes one installed script by identifier.                                    |
| `expose`  | `Promise<void>`   | Binds a host function to a page-global name, callable from page JavaScript.    |
| `revoke`  | `Promise<void>`   | Removes one exposed binding and its installed bridge script.                   |
| `destroy` | `Promise<void>`   | Removes every installed script and binding this manager owns.                  |

```ts
const id = await page.scripts.add('window.__seeded = true')
await page.scripts.expose('add', (a, b) => Number(a) + Number(b))
log(await page.evaluate('add(1, 2)'))
await page.scripts.revoke('add')
await page.scripts.remove(id)
await page.scripts.destroy()
```

#### `BrowserAccessibilityInterface`

Reads the page's accessibility tree as a serializable snapshot.

| Method     | Returns                                 | Summary                                                                        |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| `snapshot` | `Promise<BrowserAccessibilitySnapshot>` | Reads the full accessibility tree, optionally pruned to the interesting nodes. |

```ts
const tree = await page.accessibility.snapshot({ interesting: true })
log(tree.nodes.map((node) => node.name))
```

#### `BrowserTracingInterface`

Captures a Chromium trace streamed back through the IO domain.

| Method    | Returns                         | Summary                                                                                           |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`                 | Begins tracing with the given categories. Throws a `BrowserError` when a trace is already active. |
| `stop`    | `Promise<BrowserTracingResult>` | Ends tracing, drains the IO stream, and writes it through the page writer when a path was set.    |
| `destroy` | `Promise<void>`                 | Stops an active trace, discarding any failure, and does nothing when no trace is running.         |

```ts
await page.diagnostics.tracing.start({ screenshots: true })
const trace = await page.diagnostics.tracing.stop() // { bytes, path }
await page.diagnostics.tracing.destroy()
```

#### `BrowserCoverageInterface`

Collects JavaScript precise coverage and CSS rule usage together.

| Method    | Returns                          | Summary                                                                                                                    |
| --------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`                  | Arms the requested domains. Throws a `BrowserError` when collection is already active or when neither domain is requested. |
| `stop`    | `Promise<BrowserCoverageResult>` | Reads the collected usage and disarms every domain it armed.                                                               |
| `destroy` | `Promise<void>`                  | Stops an active collector, discarding any failure, and does nothing when no collection is running.                         |

```ts
await page.diagnostics.coverage.start({ javascript: true, css: true })
const usage = await page.diagnostics.coverage.stop() // { scripts, styles }
await page.diagnostics.coverage.destroy()
```

#### `BrowserPerformanceInterface`

Reads Performance-domain metrics for one frame.

| Method    | Returns                             | Summary                                                                |
| --------- | ----------------------------------- | ---------------------------------------------------------------------- |
| `metrics` | `Promise<readonly BrowserMetric[]>` | Enables the domain, reads every metric, and disables the domain again. |

```ts
const metrics = await page.diagnostics.performance.metrics()
log(metrics.map((metric) => [metric.name, metric.value]))
```

#### `BrowserProfilerInterface`

Records a sampled JavaScript CPU profile.

| Method    | Returns                   | Summary                                                                                        |
| --------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `start`   | `Promise<void>`           | Begins sampling, optionally at an explicit positive integer interval in microseconds.          |
| `stop`    | `Promise<BrowserProfile>` | Ends sampling and decodes the profile's nodes, samples, and time deltas.                       |
| `destroy` | `Promise<void>`           | Stops an active profiler, discarding any failure, and does nothing when no profile is running. |

```ts
await page.diagnostics.profiler.start(100)
const profile = await page.diagnostics.profiler.stop() // { start, end, nodes, samples, deltas }
await page.diagnostics.profiler.destroy()
```

#### `BrowserDiagnosticsInterface`

Groups the per-page diagnostics capabilities and owns their teardown. `tracing`,
`coverage`, `performance`, and `profiler` are Surface data members.

| Method    | Returns         | Summary                                                         |
| --------- | --------------- | --------------------------------------------------------------- |
| `destroy` | `Promise<void>` | Tears down every diagnostics capability this page's group owns. |

```ts
await page.diagnostics.destroy()
```

#### `BrowserClockInterface`

Controls Chromium virtual time so page timers become deterministic.

| Method      | Returns         | Summary                                                                                |
| ----------- | --------------- | -------------------------------------------------------------------------------------- |
| `install`   | `Promise<void>` | Takes over the page clock, optionally seeding it with an epoch time.                   |
| `pause`     | `Promise<void>` | Suspends virtual time so no page timer advances.                                       |
| `resume`    | `Promise<void>` | Continues virtual time after a pause.                                                  |
| `advance`   | `Promise<void>` | Moves virtual time forward by the given milliseconds, firing the timers that fall due. |
| `uninstall` | `Promise<void>` | Returns the page to the real clock, and does nothing when no clock was installed.      |

```ts
await page.clock.install(Date.parse('2026-01-01T00:00:00Z'))
await page.clock.pause()
await page.clock.advance(5_000)
await page.clock.resume()
await page.clock.uninstall()
```

#### `BrowserKeyboardInterface`

Sends trusted keyboard input on the page session. Held modifiers persist between calls until released.

| Method   | Returns         | Summary                                                                                                   |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| `down`   | `Promise<void>` | Presses one key and holds it, retaining it in the modifier mask when it is a modifier.                    |
| `up`     | `Promise<void>` | Releases one key, dropping it from the modifier mask even when the release frame fails.                   |
| `press`  | `Promise<void>` | Presses a chord: holds its modifiers, presses and releases its terminal key, then releases the modifiers. |
| `type`   | `Promise<void>` | Types a string as one press and release per character.                                                    |
| `insert` | `Promise<void>` | Inserts composed text in one frame, firing no per-key events.                                             |

```ts
await page.keyboard.down('Shift')
await page.keyboard.up('Shift')
await page.keyboard.press('Control+Enter')
await page.keyboard.type('orkestrel', { delay: 10 })
await page.keyboard.insert('pasted text')
```

#### `BrowserMouseInterface`

Sends trusted mouse input on the page session, tracking the pointer position and the pressed-button mask between calls.

| Method  | Returns         | Summary                                                                                      |
| ------- | --------------- | -------------------------------------------------------------------------------------------- |
| `move`  | `Promise<void>` | Moves the pointer to a point, carrying the pressed buttons.                                  |
| `down`  | `Promise<void>` | Presses a button at the current point, adding it to the pressed mask.                        |
| `up`    | `Promise<void>` | Releases a button at the current point, dropping it from the mask even when the frame fails. |
| `click` | `Promise<void>` | Moves to the given point, presses, optionally delays, and releases.                          |
| `drag`  | `Promise<void>` | Presses at the start, moves in the requested steps to the end, and releases.                 |
| `wheel` | `Promise<void>` | Sends a wheel delta at the current point.                                                    |

```ts
await page.mouse.move({ x: 50, y: 20 })
await page.mouse.down('left')
await page.mouse.up('left')
await page.mouse.click({ x: 50, y: 20 }, { button: 'left', count: 2 })
await page.mouse.drag({ x: 10, y: 10 }, { x: 90, y: 90 }, { steps: 20 })
await page.mouse.wheel({ x: 0, y: -120 })
```

#### `BrowserTouchInterface`

Sends trusted touch input on the page session.

| Method | Returns         | Summary                                                                                 |
| ------ | --------------- | --------------------------------------------------------------------------------------- |
| `tap`  | `Promise<void>` | Dispatches a touch start at the point and a touch end, cancelling the touch on failure. |

```ts
await page.touch.tap({ x: 120, y: 240 })
```

#### `BrowserDialogInterface`

One JavaScript dialog awaiting a decision. `category`, `message`, and `default` are Surface data members. A toolset stages its `dialog` tool from the page's `dialog` event.

| Method    | Returns         | Summary                                                                                          |
| --------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `accept`  | `Promise<void>` | Accepts the dialog, optionally supplying prompt text. Throws when the dialog is already handled. |
| `dismiss` | `Promise<void>` | Dismisses the dialog. Throws when the dialog is already handled.                                 |

```ts
page.emitter.on('dialog', async (dialog) => {
	if (dialog.category === 'prompt') await dialog.accept('Ada')
	else await dialog.dismiss()
})
```

#### `BrowserFileChooserInterface`

One intercepted file input selection. `multiple` is a Surface data member.

| Method    | Returns         | Summary                                                                                                             |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `upload`  | `Promise<void>` | Sets the chosen files. Throws when a single-file chooser is given several, and when the chooser is already handled. |
| `dismiss` | `Promise<void>` | Dismisses the chooser with an empty selection. Throws when the chooser is already handled.                          |

```ts
page.emitter.on('chooser', async (chooser) => {
	if (chooser.multiple) await chooser.upload(['one.txt', 'two.txt'])
	else await chooser.dismiss()
})
```

#### `BrowserWorkerInterface`

A dedicated, shared, or service worker attached through its own flattened
session. `id`, `url`, and `category` are Surface data members.

| Method     | Returns            | Summary                                                                            |
| ---------- | ------------------ | ---------------------------------------------------------------------------------- |
| `evaluate` | `Promise<unknown>` | Evaluates a guarded expression in the worker and returns its value.                |
| `send`     | `Promise<unknown>` | Issues one CDP method call on the worker's session.                                |
| `detach`   | `void`             | Stops driving the worker locally without closing its target.                       |
| `close`    | `Promise<void>`    | Closes the worker target, tolerating a worker that already terminated. Idempotent. |

```ts
page.emitter.on('worker', async (worker) => {
	log(await worker.evaluate('self.location.href'))
	await worker.send('Runtime.enable')
	worker.detach()
	await worker.close()
})
```

#### `BrowserRouteInterface`

One paused request, decided exactly once. `id`, `request`, and `handled` are
Surface data members.

| Method     | Returns         | Summary                                                                                 |
| ---------- | --------------- | --------------------------------------------------------------------------------------- |
| `abort`    | `Promise<void>` | Fails the request with a Chromium error reason, `'Failed'` by default.                  |
| `continue` | `Promise<void>` | Lets the request proceed, optionally overriding its URL, method, headers, or post body. |
| `fulfill`  | `Promise<void>` | Answers the request locally. Throws when the status is not an integer from 100 to 999.  |

```ts
await page.network.route({ url: '**/api' }, async (route) => {
	if (route.handled) return
	await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' })
})
await page.network.route({ url: '**/slow' }, (route) => route.abort('TimedOut'))
await page.network.route({ url: '**/pass' }, (route) => route.continue({ method: 'POST' }))
```

#### `BrowserHARManagerInterface`

Records observed exchanges as a HAR 1.2 archive and replays one back.
`recording` is a Surface data member.

| Method   | Returns               | Summary                                                                        |
| -------- | --------------------- | ------------------------------------------------------------------------------ |
| `start`  | `Promise<void>`       | Begins recording exchanges, optionally capturing response content.             |
| `stop`   | `Promise<BrowserHAR>` | Ends recording and returns the archive, writing it when a path was given.      |
| `replay` | `Promise<void>`       | Serves matching requests from an archive instead of from the network.          |
| `clear`  | `Promise<void>`       | Drops the recorded entries and any active replay without ending the recording. |

```ts
await page.network.har.start({ content: true })
const har = await page.network.har.stop()
await page.network.har.replay(har, { strict: true })
await page.network.har.clear()
```

#### `BrowserNetworkManagerInterface`

Page-scoped network observation and interception. `emitter` and `har` are
Surface data members. Every method starts the Network domain first, so the page
begins reporting `request` / `response` / `failure` from the first call.

| Method        | Returns               | Summary                                                                           |
| ------------- | --------------------- | --------------------------------------------------------------------------------- |
| `start`       | `Promise<void>`       | Enables the Network domain and subscribes to its events. Idempotent.              |
| `body`        | `Promise<Uint8Array>` | Reads one observed response body as bytes.                                        |
| `text`        | `Promise<string>`     | Reads one observed response body as text.                                         |
| `json`        | `Promise<unknown>`    | Reads one observed response body as parsed JSON.                                  |
| `route`       | `Promise<void>`       | Intercepts requests matching the query and hands each one to the handler.         |
| `unroute`     | `Promise<void>`       | Removes one handler's routes, or every route when given none.                     |
| `headers`     | `Promise<void>`       | Applies extra HTTP headers to every request the page makes.                       |
| `offline`     | `Promise<void>`       | Emulates an offline connection, or restores connectivity.                         |
| `credentials` | `Promise<void>`       | Applies HTTP basic-auth credentials, or clears them when given none.              |
| `destroy`     | `Promise<void>`       | Removes every route, unsubscribes, and disables the domains this manager enabled. |

```ts
await page.network.start()
page.emitter.on('response', async (response) => {
	log(await page.network.body(response.id))
	log(await page.network.text(response.id))
	log(await page.network.json(response.id))
})
const handler = (route) => route.continue()
await page.network.route({ url: '**/api' }, handler)
await page.network.unroute(handler)
await page.network.headers({ 'x-trace': 'on' })
await page.network.offline(true)
await page.network.credentials({ username: 'ada', password: 'secret' })
await page.network.destroy()
```

#### `BrowserCookieManagerInterface`

Cookie state scoped to one browser context.

| Method    | Returns                             | Summary                                                                           |
| --------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `cookies` | `Promise<readonly BrowserCookie[]>` | Reads the context cookies, optionally narrowed to the given URLs.                 |
| `set`     | `Promise<void>`                     | Writes the given cookies into the context.                                        |
| `clear`   | `Promise<void>`                     | Deletes the context cookies matching the filter, or every cookie when given none. |

```ts
await context.cookies.set([{ name: 'session', value: 'abc', url: 'https://example.com/' }])
log(await context.cookies.cookies(['https://example.com/']))
await context.cookies.clear({ name: 'session' })
```

#### `BrowserPermissionManagerInterface`

Permission overrides scoped to one browser context.

| Method  | Returns         | Summary                                                                        |
| ------- | --------------- | ------------------------------------------------------------------------------ |
| `grant` | `Promise<void>` | Grants each named permission, optionally for one origin, as its own CDP frame. |
| `deny`  | `Promise<void>` | Denies each named permission, optionally for one origin, as its own CDP frame. |
| `clear` | `Promise<void>` | Resets every permission override on the context.                               |

```ts
await context.permissions.grant(['geolocation'], 'https://example.com')
await context.permissions.deny(['notifications'], 'https://example.com')
await context.permissions.clear()
```

#### `BrowserStorageManagerInterface`

Cookie and web-storage state for one browser context, as one serializable value.

| Method    | Returns                        | Summary                                                                 |
| --------- | ------------------------------ | ----------------------------------------------------------------------- |
| `state`   | `Promise<BrowserStorageState>` | Reads the context cookies and the per-origin local and session storage. |
| `restore` | `Promise<void>`                | Writes a previously read state back into the context.                   |
| `clear`   | `Promise<void>`                | Drops the storage of one origin, or of every origin when given none.    |

```ts
const state = await context.storage.state({ origins: ['https://example.com'] })
await context.storage.restore(state)
await context.storage.clear('https://example.com')
```

#### `BrowserEmulationManagerInterface`

Emulation overrides inherited by every page of one context. The offline and
header overrides route through each page's network manager, so applying either
starts that page's Network domain.

| Method   | Returns         | Summary                                                                                  |
| -------- | --------------- | ---------------------------------------------------------------------------------------- |
| `apply`  | `Promise<void>` | Clears the superseded overrides and applies the given ones to every page of the context. |
| `clear`  | `Promise<void>` | Removes every override this manager applied.                                             |
| `attach` | `Promise<void>` | Applies the retained overrides to a newly created page.                                  |

```ts
await context.emulation.apply({ locale: 'fr-FR', offline: true, headers: { 'x-test': 'one' } })
await context.emulation.attach(page)
await context.emulation.clear()
```

#### `BrowserDOMViewInterface`

A view over one DOM document in the realm that runs it. The view follows its window, so a navigation of that window moves it to the window's next document and drops every reference. A reading goes stale on the Navigation API's `navigatesuccess` where the browser ships it, and on `popstate`, `hashchange`, and `pagehide` otherwise. `destroy` releases the listeners, fails pending waits, and makes every later call refuse with `BROWSER_DOCUMENT_DESTROYED`. The view declares neither `emitter` nor `screenshot`, so a replay over it collects no output and takes no capture.

| Method       | Returns                            | Summary                                                                                                                                                                                                       |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `destroy`    | `void`                             | Releases the navigation listeners and every element reference.                                                                                                                                                |
| `screenshot` | `Promise<BrowserScreenshotResult>` | Captures PNG or JPEG bytes of the view.                                                                                                                                                                       |
| `title`      | `Promise<string>`                  | Resolves the document title.                                                                                                                                                                                  |
| `read`       | `Promise<BrowserReadingInterface>` | Captures the document URL, title, and rendered markup as a reading whose `stale` flag tracks later navigations; `BrowserReadingInput` defines the rendered markup.                                            |
| `wait`       | `Promise<void>`                    | Resolves when the main document body’s `innerText` contains `text`, or lacks it with `absent`; rejects with a `BrowserError` coded `BROWSER_WAIT_TIMEOUT` at the deadline, and with `signal.reason` on abort. |

The following fence reads and waits on a child document.

```ts
const view = createBrowserDOMView({ document: frame.contentDocument })
log(await view.title())
await view.wait('Saved', { timeout: 2_000 }) // wakes on mutations, load, transitionend, and animationend
const reading = await view.read()
view.destroy()
```

#### `BrowserDOMWaitInterface`

One wait parked on mutations and finished transitions and animations across a document, its open shadow roots, and its same-origin frame documents. It checks at once, re-checks after each mutation batch and each `load`, and on the task after a `BROWSER_WAIT_EVENTS` event in an observed root, and settles at its deadline with `BROWSER_WAIT_TIMEOUT`, on a `pagehide` with `GONE`, or on abort with the signal's reason. `roots` is a Surface data member. Text and element waits with `absent` that a navigation interrupts resume against the destination in the CDP placement and settle when the text or element is absent; the DOM placement rejects them with `GONE`. Closing a CDP page rejects pending waits without waiting for their deadlines. Destroying a page releases pending text observers before detaching its session. Concurrent waits share isolated-world creation, and aborting a caller abandons only that caller’s wait. Wake tasks run in hidden tabs, where animation frames pause, but browser timer throttling can delay them. Chromium can also withhold transition and animation finish events there: a CSS-only change with no delivered event or later mutation can still reach the deadline. The hidden-tab cases in `tests/service/document.test.ts` pin that limit, the mutation wake, and a delivered finish-event wake in both placements. The CDP document listener doesn’t observe mutations or non-composed transition and animation events inside shadow roots; the DOM placement listens on each observed root.

| Method    | Returns      | Summary                                                                                                                                  |
| --------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `execute` | `Promise<T>` | Resolves the first value the check returns other than `undefined`, then releases every observer, the deadline timer, and every listener. |

The following fence waits for a status element to appear.

```ts
const wait = new BrowserDOMWait({
	roots: () => collectBrowserRoots(frame.contentDocument),
	check: () => frame.contentDocument.querySelector('[role=status]') ?? undefined,
	timeout: 5_000,
	start: performance.now(),
	subject: 'Status wait',
})
const status = await wait.execute()
```

## Toolset vocabulary

This section holds the words a model reads: the tools a toolset advertises and the receipts they return. `BROWSER_TOOL_COPY` is the source of every name, parameter, annotation, and description in it.

### Tools

A page-backed toolset advertises `look`, `read`, `plain`, `click`, `type`, `press`, `navigate`, and `wait`, stages `dialog` while a dialog is open, and advertises `tabs` and `switch` when it is given a `context`; a view-backed toolset over a DOM document advertises `look`, `read`, `plain`, `click`, `type`, and `wait`. Either toolset advertises `record`, `save`, `journeys`, `edit`, `replay`, and `forget` when it is given `journeys`. Every tool declares at least one required parameter, because the streamed tool-call parser of Ollama 0.34.4 rejects a call to a tool that declares no parameter. The following table lists each tool with its advertised description.

| Tool       | Parameters                                                                                                                                                                  | Annotations                                                                      | Placements                                     | Description                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `look`     | `search` (string, required), `offset` (integer, default 0)                                                                                                                  | `pure`, `untrusted`                                                              | CDP and DOM                                    | `Shows the page's text and the elements you can act on, each with a reference like e4. Call it first and after the page changes.`              |
| `read`     | `search` (string, required), `offset` (integer, default 0)                                                                                                                  | `pure`, `untrusted`                                                              | CDP and DOM                                    | `Reads the page as Markdown, with headings, tables, and link addresses. Call it to learn a fact; continue with the offset a cut result names.` |
| `plain`    | `search` (string, required), `offset` (integer, default 0)                                                                                                                  | `pure`, `untrusted`                                                              | CDP and DOM                                    | `Reads the page as plain text, without Markdown, link addresses, or image text. Call it for words to pass to wait or type.`                    |
| `click`    | `ref` (string, required)                                                                                                                                                    | none                                                                             | CDP and DOM                                    | `Clicks the element with that reference.`                                                                                                      |
| `type`     | `ref` (string, required), `text` (string, required), `submit` (boolean, true to submit its form after typing), `secret` (boolean, true to keep the text out of the receipt) | none                                                                             | CDP and DOM                                    | `Types into the text control with that reference; set submit to true to submit its form.`                                                      |
| `press`    | `key` (string, required)                                                                                                                                                    | none                                                                             | CDP                                            | `Presses that key or chord, such as Enter or Control+a.`                                                                                       |
| `navigate` | `url` (string, required)                                                                                                                                                    | none                                                                             | CDP                                            | `Opens that absolute web address in the current tab.`                                                                                          |
| `wait`     | `text` (string, required), `absent` (boolean, true to wait until the text is gone), `timeout` (integer seconds, default 5, at most 30)                                      | `pure`                                                                           | CDP and DOM                                    | `Waits for text to appear; set absent to true to wait for it to leave.`                                                                        |
| `dialog`   | `accept` (boolean, required), `text` (string)                                                                                                                               | none                                                                             | CDP, staged while a dialog opens               | `Accepts or dismisses the open dialog.`                                                                                                        |
| `tabs`     | `search` (string, required)                                                                                                                                                 | `pure`                                                                           | CDP, with `context`                            | `Lists the open tabs; the current one is marked.`                                                                                              |
| `switch`   | `tab` (string, required)                                                                                                                                                    | none                                                                             | CDP, with `context`                            | `Switches to a tab from tabs, such as t2.`                                                                                                     |
| `record`   | `journey` (string, required)                                                                                                                                                | none                                                                             | CDP and DOM, with `journeys`                   | `Starts recording your next actions as a journey with that name; call save when it is done.`                                                   |
| `save`     | `description` (string, required)                                                                                                                                            | none                                                                             | CDP and DOM, with `journeys`                   | `Stops recording and saves the journey; describe what it achieves in one sentence.`                                                            |
| `journeys` | `search` (string, required), `offset` (integer, default 0)                                                                                                                  | `pure`, `untrusted`                                                              | CDP and DOM, with `journeys`                   | `Lists the saved journeys with their steps and the parameters each one takes.`                                                                 |
| `edit`     | `journey` (string, required), `edits` (`anyOf`: array of `BrowserJourneyEditRequest` or a JSON string of that array, required)                                              | none                                                                             | CDP and DOM, with `journeys`                   | `Changes a saved journey: add, remove, or update steps by their ids from journeys, or declare a parameter.`                                    |
| `replay`   | `journey` (string, required), `inputs` (object of strings)                                                                                                                  | none                                                                             | CDP and DOM, with `journeys`                   | `Replays a saved journey step by step; give each parameter's value under inputs.`                                                              |
| `forget`   | `journey` (string, required)                                                                                                                                                | none                                                                             | CDP and DOM, with `journeys`                   | `Removes a saved journey and all its runs; the name is free to record again.`                                                                  |
| page tools | the page's input schema, plus a required `purpose` string when that schema requires nothing                                                                                 | `untrusted` always; `pure` from `readOnly`; `consequential` from `consequential` | CDP through the registry, DOM through a source | the page's own description, advertised as authored under `untrusted`                                                                           |

A call to one of the preceding tools that carries a parameter the tool does not advertise is refused before the tool's handler runs, with a `BrowserError` coded `BROWSER_TOOLSET_ARGUMENT` whose message is the receipt: `The look tool takes no ref parameter; call look with search and offset.` `validateBrowserToolArguments` performs that check; a page tool's arguments are the page's to check.

A text `wait` reads the main document body’s `innerText`; child-frame and shadow-root-owned text don’t count. Offscreen `content-visibility: auto` text is absent from this reading while `read` keeps it; `look` can list shadow-root-owned text that never counts here. With `absent: true`, removal, `display: none`, and hidden visibility satisfy the wait. Opacity 0, off-screen positioning, and `aria-hidden` don’t remove text from this reading. In Chromium 154.0.4258.53, a closed `details` body and `hidden="until-found"` text are absent; opening the `details` includes its body. Finished transitions and animations wake both wait engines, including element waits, without a polling timer.

An absent wait succeeds at its first check if the text was never present. Record an appearance wait before dismissal to prove the text was there. A misspelled string, an outline token such as `expanded=true`, offscreen `content-visibility: auto` text shown by `read`, or shadow-root-owned text shown by `look` can otherwise pass at once without checking the intended exit. A timeout isn’t recorded, and replay and a generated module stop at it.

### Receipts

On `look`, `read`, `plain`, `tabs`, and `journeys`, the required `search` string supplies whole words to match, not a site-search request. Use an empty string to list without matches. Words shorter than 3 letters or digits are ignored. On the first page only, entries sharing the most distinct words come first in a block using at most half the available room. `look` and `tabs` show matching rows; `read` and `plain` show `[OFFSET] LINE`; `journeys` shows `[OFFSET] HEADING` for matching journey headings. The block is outside the paged text, so offsets always address the original projection. An oversized first row is cut with `…` without splitting a surrogate pair, reserving room for the first later row that can fit beside it only when the cut keeps the leading token through its first space. Otherwise it cuts without reserving. Later rows that do not fit are skipped so shorter rows can follow. No matching word or no character before the ellipsis means no block.

The search parameter descriptions are “Words to find on this page; matching elements come first.” on `look`, “Words to find on this page; the lines that share them come first.” on `read` and `plain`, “Words to find; matching tabs come first.” on `tabs`, and “Words to find; matching journeys come first.” on `journeys`.

Outline rows append `pressed`, `expanded`, and `selected` only when the state is present, including `false`. The DOM placement reads selection from an explicit ARIA token or native option selectedness; it omits selection on unannotated tabs, treeitems, and ARIA options inside their containers. On Edge 154.0.4258.53, CDP reports `selected=false` for an unannotated tab outside a tablist. That structure is invalid ARIA, and the DOM placement doesn’t emulate its selection default. On the same browser, CDP renders a native `<summary>` as a `DisclosureTriangle` row with `expanded=false` when its details element is closed; the DOM placement omits the summary row. A `treeitem` outside a tree becomes `generic` without these states in CDP; the DOM placement keeps its `treeitem` row with authored expansion and selection. These are declared row-format differences.

`read` and `plain` project the normalized capture described under `BrowserReadingInterface`, including live field values and selected or displayed option labels. Stylesheet-hidden panels and private controls are absent. `read` returns Markdown with headings, tables, link addresses, and image alternatives; `plain` returns plain text without Markdown, link addresses, or image text. Both keep the whole captured document. Relative links in caller HTML resolve against the reading’s URL, including without distillation.

Every action returns a receipt line followed by a blank line and the fresh view, and every result and error message is cut at `limit` characters plus a footer, which closes with `BROWSER_TOOL_VIEW_FOOTER` for an action or `dialog` receipt that carries a view and with `BROWSER_TOOL_CUT_FOOTER` for any other. `look` lists every referenced element in pages instead: each call captures the view afresh, a page holds at most `limit` characters of the outline and ends after the last line break in its window that lies past the page's start, or at the window's end when no such break fits, without splitting a surrogate pair; the last page ends at the end of the outline, the footer names the offset of the next page, the offset counts outline characters alone, and an offset at or past the end restarts at 0. When `search` shares a word of at least 3 letters or digits with an element's role or name, the first page opens with the elements that share the most, in at most half of the page, before the outline. After a click, a `type` with `submit`, or a `press` that submits a form, the view is the destination's, because the receipt waits for the navigation the submission started, as the steps under [`BrowserToolsetInterface`](#browsertoolsetinterface) describe. When the observer names no surviving destination and no navigation follows, the receipt line states what became of the submission: `BROWSER_TOOL_HANDLED_STATUS`, `the page handled the submission without navigating; call wait for the text you expect`, after a submission a page listener prevented, because the page's outcome can arrive after the receipt, and `no form received the submission` when a `type` with `submit`, or a `press` of Enter that an `input` a form owns received, recorded no submission. The CDP placement's `type` with `submit` ends its action with `and submitted the form` when the observer recorded a submission, or when the navigation the receipt settled names `formSubmissionGet` or `formSubmissionPost` as its `BrowserNavigationReason`, whatever the observer read answered, and with `and pressed Enter` otherwise; the DOM placement calls `requestSubmit()` and ends with `and submitted the form`. A `BrowserElementError` message is one line that carries its reason and, for `GONE` alone, ends with the refresh directive `; call look for fresh refs.`; a refusal that a fresh reference fixes, such as a reference the current view does not hold, names `look` in its own text. A `read` or `plain` at a nonzero offset continues the retained reading only when the view and projection match, unless a navigation has made that reading stale, which recaptures the view; switching projections also recaptures and restarts at 0. An edit to the page that is not a navigation leaves the reading current. The slice restarts at 0 after a recapture and at an offset at or past the retained reading's end, and the footer shows the range returned, or is absent when the whole reading fits.

In the following table `URL` is an address, `REF` an element reference, `ROLE` and `NAME` its accessible role and name, `TITLE` a document title, `TEXT` the text a call carried, `KEY` a key or chord, `MESSAGE` a page-authored dialog message, `FRAME` a frame id, `COUNT` the entries counted in a view or match heading, `AVAILABLE` the elements the page holds, `SEARCH` the `search` parameter carried by `look`, `read`, `plain`, `tabs`, or `journeys`, `MATCHED` the entries that match it, `OFFSET` a character position in the original projection, `LINE` a matching line, `HEADING` a journey heading, `LIMIT` the toolset's `limit`, and `START`, `END`, and `TOTAL` character positions. The journey rows use the journey `add-kettle` as their example name, and `REASON` is a clause that carries no directive and no final period.

| Situation                                                                                                                             | Text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The elements whose role and name share the most words with the `search` parameter of a `look` call, before the view on the first page | `MATCHED elements match "SEARCH":` (`1 element matches` for one), the matching element rows, and a blank line                                                                                                                                                                                                                                                                                                                                                                               |
| The matching lines before a `read` or `plain` projection on the first page                                                            | `COUNT lines match "SEARCH":` (`1 line matches` for one), `[OFFSET] LINE` rows, and a blank line                                                                                                                                                                                                                                                                                                                                                                                            |
| The matching tabs before the tab list                                                                                                 | `COUNT tabs match "SEARCH":` (`1 tab matches` for one), matching tab rows, and a blank line                                                                                                                                                                                                                                                                                                                                                                                                 |
| The matching journey headings before the listing on the first page                                                                    | `COUNT journeys match "SEARCH":` (`1 journey matches` for one), `[OFFSET] HEADING` rows, and a blank line                                                                                                                                                                                                                                                                                                                                                                                   |
| The view `look` returns, first line after any matches                                                                                 | `page "TITLE" URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A heading row, an element row, and a text row                                                                                         | `# NAME`, `REF ROLE "NAME"` with `value="…"`, `pressed=true\|false\|mixed`, `expanded=true\|false`, `selected=true\|false`, `[checked]`, `[disabled]`, or `[tool=NAME]` after it, in that order, and the text itself                                                                                                                                                                                                                                                                        |
| The view's last line                                                                                                                  | `(COUNT of AVAILABLE elements)`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A click                                                                                                                               | `Clicked e4 button "Place order".`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A click on an element whose role is in `BROWSER_TYPED_ROLES`                                                                          | `Clicked e35 searchbox "Search products"; call type with e35 to enter text.`                                                                                                                                                                                                                                                                                                                                                                                                                |
| A click in the DOM placement                                                                                                          | `Clicked e1 button "Save". (untrusted event)`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Text typed through `type`                                                                                                             | `Typed "TEXT" into REF ROLE "NAME".`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `type` with `submit` whose form navigates, followed by the destination's view                                                         | `Typed "Grace Hopper" into e3 textbox "Name" and submitted the form.`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| An option chosen through `type`                                                                                                       | `Selected "Large" in e2 combobox "Size" (programmatic).`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `type` on an element whose role is not in `BROWSER_TYPED_ROLES`                                                                       | `Element e5 button "Search" takes no text; call click for a button.`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A key pressed through `press`                                                                                                         | `Pressed KEY.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A key pressed through `press` that leaves focus on a referenced element                                                               | `Pressed KEY; focus is on REF ROLE "NAME".`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A page opened through `navigate`                                                                                                      | `Navigated to URL.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Text `wait` found, and text it did not find within its timeout; with `absent`, text that is gone, and text that stayed                | `"TEXT" is on the page.`, `"Order placed" did not appear within 5 s.`, `"TEXT" is not on the page.`, and `"Saved to drafts" is still on the page after 5 s.`                                                                                                                                                                                                                                                                                                                                |
| The open tabs `tabs` lists, one line each, after any pending move note                                                                | `t1 "TITLE" URL (current)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A tab `switch` moved to, and a tab that is not open                                                                                   | `Switched to t2 URL.` and `Tab "t9" is not open; call tabs.`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A dialog that opened during the action                                                                                                | `Clicked e7 button "Delete". A confirm dialog is open: "MESSAGE"; call dialog.`                                                                                                                                                                                                                                                                                                                                                                                                             |
| A dialog `dialog` handled                                                                                                             | `Accepted the confirm dialog "MESSAGE".` or `Dismissed the confirm dialog "MESSAGE".`                                                                                                                                                                                                                                                                                                                                                                                                       |
| A hold requested while an earlier input remains pending and no dialog is open, coded `BROWSER_TOOLSET_DIALOG`                         | `BROWSER_TOOL_PENDING_NOTE`: `An earlier input is still pending; call look.`                                                                                                                                                                                                                                                                                                                                                                                                                |
| The note before a result when the view moved to a popup, and when its tab closed                                                      | `The view moved to a new tab: URL.` and `The tab URL closed; the view returned to URL.`                                                                                                                                                                                                                                                                                                                                                                                                     |
| A settlement that ended `committed`: the navigation committed and has not loaded                                                      | `Clicked e3 link "Next"; the page is still loading URL.`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A settlement that ended `requested`: the navigation was requested and not committed                                                   | `Clicked e3 link "Next"; it requested URL and the page did not change.`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A submission a page listener prevented, with no navigation after it                                                                   | `Typed "Ada Lovelace" into e3 textbox "Name" and submitted the form; the page handled the submission without navigating; call wait for the text you expect.`                                                                                                                                                                                                                                                                                                                                |
| `type` with `submit` whose Enter no form received                                                                                     | `Typed "Ada Lovelace" into e3 textbox "Name" and pressed Enter; no form received the submission.`                                                                                                                                                                                                                                                                                                                                                                                           |
| `press` of Enter in an `input` a form owns that no form received                                                                      | `Pressed Enter; no form received the submission.`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| An action whose input document could not be observed, coded `BROWSER_TOOLSET_OBSERVE`                                                 | `The action was not sent: frame FRAME, which receives the input, could not be observed for a form submission; call look.`                                                                                                                                                                                                                                                                                                                                                                   |
| The note in place of the view when a capture and its one retry both meet a page change                                                | `(The page changed before the view could be read; call look.)`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A reference the page no longer holds                                                                                                  | `Element e12 is gone because the page changed; call look for fresh refs.`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A reference the current view does not hold                                                                                            | `Element e99 is not in the current view; call look for fresh refs.`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Any other element refusal                                                                                                             | `Element e2 is not editable.`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A parameter the tool does not advertise                                                                                               | `The look tool takes no ref parameter; call look with search and offset.`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A `read` or `plain` result with more to read                                                                                          | `[characters START–END of TOTAL; call read with offset END for more]` (or `plain` in place of `read`)                                                                                                                                                                                                                                                                                                                                                                                       |
| A `look` result with more to read                                                                                                     | `[characters START–END of TOTAL; call look with offset END for more]`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| An action or `dialog` receipt cut at the limit                                                                                        | `[characters 0–END of TOTAL; the rest was cut; call look with words to find]`                                                                                                                                                                                                                                                                                                                                                                                                               |
| Any other result or error message cut at the limit                                                                                    | `[characters 0–END of TOTAL; the rest was cut]`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A tool called after `destroy()`                                                                                                       | `the browser session ended`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Text typed through `type` with `secret`                                                                                               | `Typed a secret into e33 textbox "Password".`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| An action from a caller without the hold's token, or `forget`, while a replay holds the toolset, coded `BROWSER_TOOLSET_BUSY`         | `The toolset is replaying add-kettle until it finishes; call look.`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `forget`                                                                                                                              | `Forgot add-kettle and its 2 runs; the name is free to record again.` (`1 run` when singular)                                                                                                                                                                                                                                                                                                                                                                                               |
| `forget` refused: missing journey                                                                                                     | `No journey is named "add-kettle"; call journeys.`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `forget` refused: the name is recording                                                                                               | `Journey "add-kettle" is recording; call save first, or record another name.`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `forget` refused: a held lock                                                                                                         | `Journey add-kettle is locked; call forget again.`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `forget` refused: a store failure                                                                                                     | `Forgetting add-kettle failed: REASON; call forget again.`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `record`, followed by the view                                                                                                        | `Recording add-kettle; each action you take is a step; call save when it is done.`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `record` refused: an invalid name, a saved name, and a recording in progress                                                          | `"Add kettle" is not a journey name; use lowercase words joined by hyphens, such as add-kettle.`, `Journey "add-kettle" is saved already; do not call record for it again. Call journeys to list it, edit to change it, or replay to run it, or answer the user.`, and `A journey is recording; call save first.`                                                                                                                                                                           |
| `record`, `save`, `edit`, or `forget` under `journeys.readonly`                                                                       | `The journeys are read-only; call replay.`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `save`, followed by the listing                                                                                                       | `Saved add-kettle with 5 steps.`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `save` refused: nothing recording, a failed write, and a held lock                                                                    | `No journey is recording, so nothing can be saved; answer the user. A journey holds only the actions after record, so call record before them.`, `Saving add-kettle failed: REASON; call save again.`, and `Journey add-kettle is locked; call save again.`                                                                                                                                                                                                                                 |
| `save` refused after a save in this session                                                                                           | `Nothing is recording; "add-kettle" was saved. Call journeys, edit, or replay.`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `save` refused for an empty recording                                                                                                 | `Nothing is recorded for add-kettle: the actions before record are not steps. Perform the flow's actions and call save, or answer the user when the task is done.`                                                                                                                                                                                                                                                                                                                          |
| `journeys` with nothing saved                                                                                                         | `No journeys are saved; call record to start one.`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A `journeys` listing with more to read                                                                                                | `[characters START–END of TOTAL; call journeys with offset END for more]`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A `look`, `read`, or `plain` call whose `limit` cannot hold the next character, coded `BROWSER_TOOLSET_LIMIT`                         | `The look limit of LIMIT characters cannot hold the next character at offset START; raise the toolset limit.` (or `read` or `plain` in place of `look`).                                                                                                                                                                                                                                                                                                                                    |
| A `journeys` call whose `limit` cannot hold the next character, coded `BROWSER_TOOLSET_LIMIT`                                         | `The journeys limit of LIMIT characters cannot hold the next character at offset START; raise the journeys limit.`                                                                                                                                                                                                                                                                                                                                                                          |
| A malformed `edits` or `inputs` argument, coded `BROWSER_TOOLSET_ARGUMENT`                                                            | `The edits parameter must be an array or a JSON string of the array.` and `The inputs parameter must be an object of strings.`                                                                                                                                                                                                                                                                                                                                                              |
| An `edits` string that does not parse                                                                                                 | `The edits parameter is not valid JSON: REASON; pass an array or a JSON string of the array.`; REASON is the JSON parser's error, such as `Unexpected end of JSON input`.                                                                                                                                                                                                                                                                                                                   |
| A negative `journeys` offset, coded `BROWSER_JOURNEY_ARGUMENT`                                                                        | `The offset parameter must be a non-negative integer.`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `edit`, followed by the listing                                                                                                       | `Edited add-kettle.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `edit` refused: an unknown journey, an invalid edit, a stale revision, a held lock, and a reference the view does not hold            | `No journey is named "checkout"; call journeys.`, `Edit 2 is refused: it REASON; call journeys.`, `Journey add-kettle changed since you read it; call journeys, then edit again.`, `Journey add-kettle is locked; call edit again.`, `Editing add-kettle failed: REASON; call edit again.`, and `Element e9 is not in the current view; call look for fresh refs.`                                                                                                                          |
| An edit with no object or operation                                                                                                   | `Edit 1 is refused: it has no edit object with an "operation" field; call journeys.` and `Edit 1 is refused: it names no operation among add, update, remove, and declare; call journeys.`                                                                                                                                                                                                                                                                                                  |
| An edit with an unknown or non-JSON field                                                                                             | `Edit 1 is refused: its "OPERATION" carries an unknown field "FIELD"; call journeys.` and `Edit 1 is refused: its "OPERATION" has non-JSON content in "FIELD"; call journeys.`                                                                                                                                                                                                                                                                                                              |
| An added step with malformed anchors                                                                                                  | `Edit 1 is refused: its "add" carries both "before" and "after"; call journeys.` and `Edit 1 is refused: its "add" has no step id in "FIELD"; call journeys.`, where FIELD is before or after.                                                                                                                                                                                                                                                                                              |
| An added step with a malformed shape or supplied id                                                                                   | `Edit 1 is refused: its "add" has an invalid "step": REASON; call journeys.` and `Edit 1 is refused: its "add" supplies "step.id", which is assigned automatically; call journeys.`                                                                                                                                                                                                                                                                                                         |
| A removal or update without a step id                                                                                                 | `Edit 1 is refused: its "remove" names no step in "id"; call journeys.` and `Edit 1 is refused: its "update" names no step in "id"; call journeys.`                                                                                                                                                                                                                                                                                                                                         |
| An update with malformed fields                                                                                                       | `Edit 1 is refused: its "update" has no object in "arguments"; call journeys.`, `Edit 1 is refused: its "update" has an invalid "target"; call journeys.`, and `Edit 1 is refused: its "update" has an invalid "tab"; call journeys.`                                                                                                                                                                                                                                                       |
| A declaration with malformed fields                                                                                                   | `Edit 1 is refused: its "declare" has no "name"; call journeys.`, `Edit 1 is refused: its "declare" has an invalid "name"; call journeys.`, and `Edit 1 is refused: its "declare" has an invalid "parameter": REASON; call journeys.`                                                                                                                                                                                                                                                       |
| An edit batch whose result has no step                                                                                                | `Edit 2 is refused: it removes the last step; call journeys.`; the index names the removal that emptied the journey.                                                                                                                                                                                                                                                                                                                                                                        |
| `replay` refused at preparation                                                                                                       | `Journey add-kettle needs the input "email"; call replay with inputs.`, `Journey add-kettle has no parameter named "emial"; call journeys.`, `Journey add-kettle has a gap at s4 (REASON); call edit to remove or replace s4.`, `Journey add-kettle cannot run here: s3 switch needs a browser context; call journeys.`, `Journey add-kettle cannot run here: s3 press is not available in a page toolset; call journeys.`, and `Journey add-kettle cannot be read: REASON; call journeys.` |
| `replay` refused while a journey records, and while another replay holds the toolset                                                  | `Journey add-kettle is recording; call save before you replay another.` and `The toolset is replaying add-kettle until it finishes; call look.`                                                                                                                                                                                                                                                                                                                                             |
| A replay's head line: complete, stopped, and aborted                                                                                  | `Replayed add-kettle: 5 of 5 steps.`, `Replay of add-kettle stopped at s3 of 5: REASON.`, and `Replay of add-kettle aborted at s3 of 5.`                                                                                                                                                                                                                                                                                                                                                    |
| A replayed step's target that several elements carry, and that none carries                                                           | `Step s3 names button "Delete", which 2 elements carry; call edit to remove or replace s3.` and `Step s3 names button "Add to cart", which no element carries; call edit to remove or replace s3.`                                                                                                                                                                                                                                                                                          |

## Journeys

The store proof measured the journey tools and `type`'s `secret` at 798 prompt tokens per turn on the store model's tokenizer (`qwen3.5:2b-q4_K_M`), and the full tool list at 1 651, on 2026-10-01 against the tree at `4a10abe`; the measurement moves with the tool copy. A 4 096-token window cut a page task's third turn, while a 16 384-token window held the proof's journey conversation. When a replay's final view must show a delayed confirmation, end the recording with a `wait` for that confirmation. When a step dismisses a message or closes a panel, follow it with a `wait` with `absent` set to `true` for its text, so the journey keeps the exit check.

A vocabulary case in [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) bounds the copy a model reads, each tool's compact JSON name, description, and input schema, at 3 100 characters for the journey tools plus `type`'s `secret` property and at 6 700 for the full list. The measured full copy is 6 675 characters; 6 700 is the smallest multiple of 50 that holds it. The journey copy measures 3 090, giving the same bound rule 3 100. The character bound fails the suite when the copy grows, with no tokenizer installed; it is not a token count.

A journey is one user intent kept as JSON: a `name`, a one-sentence `description`, the `parameters` it takes, the `next` step number, and `steps` that mirror the toolset's own tool calls. An acting step names its element by role and exact accessible name, the way a receipt names it, and keeps the record-time `reference` and a `css` selector only as evidence a developer reads when a resolution is refused; replay never reads either. A `switch` step names its tab by URL and title. A model records, lists, edits, replays, and forgets journeys through the six journey tools; a developer compiles the same steps into a module. `validateBrowserJourney` asserts these invariants, and [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) gives each one a failing case:

1. `name` matches `BROWSER_JOURNEY_NAME_PATTERN`: lowercase words joined by hyphens, at most 64 characters, and none of the reserved device names `con`, `prn`, `aux`, `nul`, `com1` to `com9`, and `lpt1` to `lpt9`.
2. A journey has at least one step. Step ids are unique, each is `s` followed by a number below `next`, and an added step takes `next` and increments it, so a removed id is never reused.
3. A native action carries `target` exactly when it takes `ref`, and `tab` exactly for `switch`; its `arguments` never carry `ref` or `tab`.
4. Every binding names a declared parameter, and every declared parameter is bound by at least one step.
5. A secret parameter binds `type.text` only and has no default.
6. A journey survives `JSON.stringify` and `parseBrowserJourney` unchanged.
7. A step's action is `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, an adopted page tool, or `unresolved`; `look`, `read`, `plain`, `tabs`, and the six journey tools are never steps.

### Record a journey

A recorder has three sources, and each one produces the same steps.

- The toolset's actions: `createBrowserRecorder(toolset)`, which the `record` and `save` tools drive, turns each completed action into a step; see [`BrowserRecorderInterface`](#browserrecorderinterface).
- A person's gestures on a page: `page.codegen()` turns each gesture into a step; see [`BrowserCodegenInterface`](#browsercodegeninterface).
- A hand-written `journey.json` file or a `BrowserJourney` literal, which `validateBrowserJourney` checks.

A recording never keeps an observation, a refused or timed-out call, a prompt or its answer, a raw event, a cookie, storage, or a secret's value. The toolset recorder uses gaps only for a child frame, a held replay, or an unanswered interruption. The recorder keeps every action that completed, so a model's recording keeps its detours too. In the store proof's form task, the model submitted the order a second time after the receipt, and the store recorded two orders (see [Drive a page with a small model](#drive-a-page-with-a-small-model-1)); a recording of such a run carries both submissions. Review the listing `journeys` returns, and `remove` the repeated step through `edit` before you replay the journey.

### Parameters and secrets

A parameter is text whose name matches `BROWSER_JOURNEY_PARAMETER_PATTERN`. A native action's string argument binds one as `{ "parameter": "email" }`: `type.text`, `navigate.url`, `press.key`, `wait.text`, `dialog.text`, and a target's `name` can bind, while a page tool's arguments stay the literal JSON the call sent. A `type` action with `secret`, or a person's typing into a password control, records a secret parameter named after its control's accessible name in lower camel case, such as `confirmPassword`, falling back to `secret1`, `secret2`, and so on; a secret binds `type.text` only, has no default, and makes its step secret by derivation. The value reaches the page and never reaches `journey.json`, `run.json`, the listing, the run render, a receipt, a `BrowserAction`, a capture's name, or a generated module. A run of a journey with a secret parameter records no page output and no captures, because a page can republish the value; a page that displays the value still displays it in the view a receipt carries.

### The listing

`BrowserJourneyOptions.limit` defaults to the owner’s `limit`, including when you construct `BrowserJourneyToolset` directly. `BrowserStoreFault` carries the entry’s `name` and a path-free `reason`; `renderBrowserJourneyFault` renders those fields as `NAME cannot be read: REASON`. The `journeys` tool deduplicates faults by name.

`renderBrowserJourney` lists a journey the way `save`, `journeys`, and `edit` return it: the head line with the parameters, one line per step, a binding as `as NAME`, a secret as `(secret)` in place of its text, a `wait` with `absent` as `, absent` after its text and binding, and never a reference. The following fence shows the listing of `add-kettle`.

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

`replay` replays a saved journey as it was recorded, or with `inputs` that replace the parameters' defaults; a parameter without a default, a secret included, needs an input. See [`BrowserReplayInterface`](#browserreplayinterface) for the four stages. The replay resolves each target on the live page by role and exact name, refuses a name that several elements carry or that none carries, and stops at the first step that did not complete, so a step never acts on an element the journey did not name.

A replay writes one `BrowserRun` through its run store: the journey and its revision, the inputs without a secret's value, one `BrowserRunStep` per step executed with its `trigger`, arguments, outcome, receipt, and capture, the `console` and `error` output of a trusted view that declares `emitter`, and the outcome `complete`, `stopped`, or `aborted`. The `replay` tool returns `renderBrowserRun`: the head line, one line per step with the receipt's directive stripped, a blank line, and the view after the run. The following fence shows the render of a complete `add-kettle` run with the input `ada@example.test`.

```ts
renderBrowserRun(run, view)
// Replayed add-kettle: 5 of 5 steps.
// s1 Navigated to https://shop.example.test/.
// s2 Clicked e12 link "Alpine Kettle".
// s3 Clicked e31 button "Add to cart".
// s4 Typed "ada@example.test" into e33 textbox "Email" and submitted the form.
// s5 "Added to cart" is on the page.
//
// page "Cart" https://shop.example.test/cart
// e40 link "Catalogue"
// e41 link "Cart"
// e42 link "Checkout"
// # Your cart
// Alpine Kettle
// (3 of 3 elements)
```

### Two artifacts

The same steps reach two artifacts, and each one is usable without the other. The journey file is the model's artifact: `journeys` lists it, `edit` changes it, and `replay` runs it. The module is the developer's artifact: `compileBrowserJourney` emits a standalone module that imports only `@orkestrel/browser` and runs one `follow` call per step on a toolset the module constructs, so each step runs with the toolset's observers, settlement, dialogs, popups, and receipts, and reaches the page outcome a replay of the same journey reaches. A developer customizes the module by editing a step's target or arguments, inserting page calls between steps, or replacing a step. See [Generate a module from a journey](#generate-a-module-from-a-journey) for the module.

### Where journeys live

A file store keeps its entries under a root that exists before the store is constructed; the constructor resolves it through `realpath` and throws `BROWSER_JOURNEY_PATH` naming the root when it is missing. Every path the store touches lies under the root, and a symbolic link at any component refuses with `BROWSER_JOURNEY_PATH`; the stores guard against a link present when they check a path, not one a writer with access to the root swaps in between the check and the use. The `browse` binary uses the root `tmp/browsers` under its working directory and creates it. The following table lists what the root holds.

| Path                           | Holds                                                                                                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROOT/.profiles/<pid>-<uuid>/` | browser profiles created exclusively for eager pool slots; slot teardown removes them, the startup sweep handles exited owners, and the shutdown recheck retries recorded folders while retaining live, unreadable, or malformed records and reporting persistent removal failures |
| `ROOT/NAME/journey.json`       | the journey and the revision the store assigned it                                                                                                                                                                                                                                 |
| `ROOT/NAME/revision`           | the revision counter, kept across `delete` and recreate                                                                                                                                                                                                                            |
| `ROOT/NAME/journey.lock/`      | the write lock directory; its empty `PID-TOKEN` entry identifies the holder                                                                                                                                                                                                        |
| `ROOT/NAME/runs/ID/run.json`   | one run, under the run id the store minted in `open`                                                                                                                                                                                                                               |
| `ROOT/NAME/runs/ID/sN.png`     | the capture of step `sN` in the page placement                                                                                                                                                                                                                                     |

### Placements

The page placement, a toolset over a `BrowserPageInterface`, records and replays every native action with trusted input, writes a capture per replayed step through a run store that keeps directories, and collects page output. A toolset action on an element in a child frame records as the gap `the element is in a child frame`. The DOM placement, a toolset from `createDocumentToolset`, replays `click`, `type`, `wait`, and its adopted page tools with `(untrusted event)` receipts and writes no captures; its element manager reaches a same-origin child frame, so a step there records as an ordinary step. The `browse` binary serves the page placement over the file stores; see [Register the browse binary with Claude Code](#register-the-browse-binary-with-claude-code) for its hookup and its environment.

## Relation to WebMCP

WebMCP puts a tool registry on the document, `document.modelContext`, so a page can offer its own capabilities to an agent. This package does not depend on it: the toolset drives any page through its own vocabulary, and `look`, `read`, `plain`, `click`, `type`, `press`, `navigate`, `wait`, and `dialog` run against a browser that ships no registry. The Chromium project's intent to experiment, posted to blink-dev on 2026-05-15, names Chrome 157 as the milestone that would ship WebMCP; see [the WebMCP intent to experiment on blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ). The package adapts to WebMCP in both directions and pins that alignment against revision-named mirrors, which [Declared conformance gaps](#declared-conformance-gaps) records. No export is named after WebMCP; an adapter is named in prose.

The following table names each adapter, the contract on each side, and the proof that pins it.

| Adapter                                | This package                                                                                                                                                                                                                                                                                  | WebMCP or `@orkestrel/mcp`                                                                                                                                                                                                                               | Proof                                                                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The tool source contract               | `BrowserToolSourceInterface`: an `emitter` emitting `change`, `adopt()`, and an optional `tools()` census, which `createDocumentToolset` takes as `source`                                                                                                                                    | `@orkestrel/mcp`'s `ModelContextInterface`, returned by `createModelContext`, whose `emitter` and `adopt()` satisfy the contract structurally and which carries no census                                                                                | [the type test](../tests/src/browser/types.test.ts) assigns the model context to the contract and refuses a shape without `adopt`; [the composition cases](../tests/src/browser/factories.test.ts) run the installed bridge over this package's double |
| The registry twin's annotation mapping | `BrowserRegistry.adopt()` projects a `BrowserToolAnnotation` onto `@orkestrel/tool`'s annotations: `readOnly` to `pure`, `consequential` to `consequential`, `untrusted` always `true`; a `debugging` tool is skipped by the toolset, and `autosubmit` is retained on the protocol tool alone | the domain's `Annotation` type carries `readOnly`, `untrustedContent`, `consequential`, `debugging`, and `autosubmit`; the specification source's `ToolAnnotations` carries `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, and `debugging` | [the mapping rows](../tests/conformance.test.ts) drive the real `adopt()` over mirror-shaped tools, and [the registry proof](../tests/src/core/BrowserRegistry.test.ts) pins the untrusted mark and the synthetic `purpose`                            |
| The domain mirror the registry parses  | `parseBrowserTool`, `parseBrowserRemoval`, `parseBrowserInvocation`, and `parseBrowserInvocationResult`; the registry sends `enable`, `disable`, `invokeTool`, and `cancelInvocation` and subscribes `toolsAdded`, `toolsRemoved`, `toolInvoked`, and `toolResponded`                         | the `WebMCP` domain of `browser_protocol.json`: the `Tool`, `Annotation`, and `RemovedTool` types, the `InvocationStatus` values `Completed`, `Canceled`, and `Error`, the four commands, and the four events                                            | [the conformance project](../tests/conformance.test.ts) compares every property the parsers read against [the domain mirror](../tests/mirrors/webmcp-domain-dc2ddf369035.json), and every command and event name the registry uses                     |
| The declarative form                   | the element managers mark a form that a registered tool's `backendNodeId` names (CDP), or that carries a `toolname` attribute (DOM), as `[tool=NAME]` after its role and name                                                                                                                 | the declarative attributes of Chrome's explainer; the specification's declarative section is a TODO at revision `19fc56516057`                                                                                                                           | [the CDP mark](../tests/conformance.test.ts) and [the DOM mark](../tests/src/browser/factories.test.ts) each render `e5 form "Search cars" [tool=search-cars]`                                                                                         |

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

**The in-page composition runs against a double.** Chromium 141, the host browser, exposes no `document.modelContext`, so the composition of `@orkestrel/mcp`'s bridge with `createDocumentToolset` runs against this package's double, and its block for a real registry collects nothing; the absence path asserts that neither `document` nor `navigator` carries a registry, so a registry at either location reddens rather than skips. **What it costs:** the specification's registry location, `Document` in the source against `Navigator` in Chrome's intent, and `executeTool`'s result shape stay unread. **Closer:** a host browser that exposes `document.modelContext`.

## Contract

These invariants hold across the four faces (`src/core`, `src/browser`, `src/server`, and `src/bin`) and this guide. Each names the test that pins it.

1. **Doc ↔ source bijection.** Every row of the `### Core`, `### Server`, and `### Browser` Surface tables is a real export of its face's barrel, and every barrel export appears as a row, exhaustive in each direction; the declarations a barrel does not re-export are the implementation classes [`tests/guides.test.ts`](../tests/guides.test.ts) lists as internal. Every `ts` fence imports only real exports of `@orkestrel/browser`, `@orkestrel/browser/browser`, or `@orkestrel/browser/server`. The `browse` binary in `src/bin` is a fourth face with no export and its own check project, `check:src:bin`; [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts) spawns the built entry the manifest's `bin.browse` names.
2. **Core is environment-agnostic.** `src/core` imports only `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/html`, `@orkestrel/markdown`, and `@orkestrel/tool`: no `node:*`, no `WebSocket`, no DOM, and no filesystem. `@orkestrel/html` and `@orkestrel/markdown` are string-to-tree-to-string work with no host of their own, and `@orkestrel/tool` supplies the `ToolInterface` and `ToolManagerInterface` values the toolset fills, never re-exported. Every CDP method call and event flows through the injected `CDPTransportInterface`. Host-side CDP boundaries use `@orkestrel/contract` guards; raw `typeof` and `instanceof` checks appear only inside compiled expressions that run in the remote page. The `browser → html` edge is one-way, and `BrowserSnapshot` navigates CDP DOM snapshots rather than HTML source, so it never gains rendering, extraction, or distillation. `src/browser` imports the core, `@orkestrel/contract`, and `@orkestrel/emitter`; `src/server` imports the core, `@orkestrel/contract`, `@orkestrel/emitter`, `@orkestrel/websocket`, `@orkestrel/tool`, `@orkestrel/mcp` for `BrowserMCPServer`, which makes `@orkestrel/mcp` a runtime dependency, and `node:*`, and its file stores import `@orkestrel/contract` and `node:*` alone; `src/bin` imports the core, the server, and `@orkestrel/contract`; the in-page face and the Node runtime never import each other. The scoped `check:src:core`, `check:src:browser`, `check:src:server`, and `check:src:bin` projects and [`tests/config.test.ts`](../tests/config.test.ts) pin the boundaries.
3. **The transport is a dumb text pipe.** `CDPTransportInterface` does no JSON framing of its own; `CDPClient` owns request and response correlation, timeouts, abort signals, and event dispatch over the transport's raw `message`, `close`, and `error` events. [`tests/src/core/CDPClient.test.ts`](../tests/src/core/CDPClient.test.ts) pins it.
4. **Captured bytes never touch a filesystem in core.** A page accepts an optional `BrowserWriterInterface`, injected through `BrowserContext`, and calls `write(path, bytes)` only when a screenshot, PDF, trace, or HAR request carries a `path`; the server supplies `createBrowserWriter` through `Browser`. A replay takes each capture's bytes from the view without a `path` and hands them to its run store's `capture`, which writes them only into the run directory its `open` created and creates no directory; the memory run store keeps no bytes. [`tests/src/server/writers/FileBrowserWriter.test.ts`](../tests/src/server/writers/FileBrowserWriter.test.ts) pins the writer, the capture cases of [`tests/src/core/BrowserReplay.test.ts`](../tests/src/core/BrowserReplay.test.ts) pin that no path reaches the page, and [`tests/src/server/stores/FileBrowserRunStore.test.ts`](../tests/src/server/stores/FileBrowserRunStore.test.ts) pins the capture's confinement.
5. **The server owns the connection lifecycle, and launch readiness is an event.** `Browser.connect()` tries, in order: an explicit `cdp.endpoint`; a passive probe of `{cdp.host}:{cdp.port}` through `discover()`; then a launch. A launch spawns the executable with `--remote-debugging-port` set to `cdp.port`, or to `0` so the operating system picks the port when none is given, with standard error piped, and `readBrowserEndpoint` resolves the `ws://` endpoint from the `DevTools listening on` line the browser prints there, reading across chunk boundaries and draining the stream afterwards. No HTTP request polls for readiness. A found browser is preferred over a launch; `engine` narrows discovery to a preferred engine, and a `BrowserConnectionError` carries the requested `engine` when none matches. `disconnect()` retains process ownership, and `discover: false` probes the port directly only when `cdp.port` is set and rejects with a coded `BrowserConnectionError` naming an occupied port. [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts) resolves a launch with no `GET /json/version` recorded, and [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) pins the endpoint read.
6. **Lifecycle events are observable, never polled.** `BrowserInterface.emitter` fires `idle`, `discover`, `connect`, `disconnect`, `launch`, `page`, `context`, `error`, and `destroy`; `CDPClientInterface.emitter` fires `connect`, `close`, `drop`, and `error`; a recorder, `page.codegen()` included, fires `start`, `step`, `stop`, and `clear`, and a replay fires `step`. A page fires `navigate` with `[url, same]` for both a cross-document and a same-document navigation, `session` when an out-of-process frame's session attaches, `popup` for each page it opens, and `dialog`, `close`, and the network and worker events; a context fires `page` for each page it publishes, popups included. A page a context constructs holds its target on the client's connection, and the first such page on a connection enables `Target.setDiscoverTargets` for it; a second live page for a held target is refused with `BROWSER_TARGET_HELD`, and a `create()` that meets a page another path published for its target joins that page, or rejects with `BROWSER_PAGE_CLOSED` when that page closed. A page constructed directly holds no target, enables no discovery, and counts as published when its setup completes. A discovered popup is published one time, after its opener, through the opener's `popup`, the context's `page`, and `pages()`. Limit: when the page holding a popup's target fails its setup, discovery publishes nothing, and a later `sync()` adds the target without a `popup` from its opener. Limit: when `Target.setDiscoverTargets` fails, or the connection ends and another opens, the next page a context constructs on that connection sends it again, and nothing sends it before then; `sync()` is the recovery for a popup that discovery missed meanwhile. The registry fires `change`, `invoke`, and `respond`, and the toolset `adopt`, `skip`, `select`, `action`, `hold`, and `release`. A journey store never polls: a held `journey.lock` refuses at once with `BROWSER_JOURNEY_LOCKED`, and the tool tells the model to call again. Every wait parks on a protocol event, a DOM observer, or an abort signal, and a `setTimeout` survives only as a deadline; the one liveness probe with no event source is the bounded drain of a terminated process group, at `BROWSER_DRAIN_INTERVAL_MS` in `src/server`. An external disconnect emits a coded `error` before `disconnect`; transport loss with the process alive is resumable, and a process exit is terminal. [`tests/src/core/BrowserPage.test.ts`](../tests/src/core/BrowserPage.test.ts), [`tests/src/core/recorders/BrowserCodegen.test.ts`](../tests/src/core/recorders/BrowserCodegen.test.ts), [`tests/src/core/recorders/BrowserRecorder.test.ts`](../tests/src/core/recorders/BrowserRecorder.test.ts), and [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) pin the page, recorder, and toolset events, [`tests/src/server/stores/FileBrowserJourneyStore.test.ts`](../tests/src/server/stores/FileBrowserJourneyStore.test.ts) pins the lock refused at once, and [`tests/src/core/BrowserContext.test.ts`](../tests/src/core/BrowserContext.test.ts) pins target ownership, the joined creation, and popup publication.
7. **Errors carry a machine-readable `code` and an optional `context`.** `BrowserError` is the base; `CDPError`, `CDPConnectionError`, `CDPTimeoutError`, `BrowserResultLimitError`, `BrowserConnectionError`, `BrowserElementError`, and `BrowserStepError` (core) narrow protocol, connectivity, timeout, oversized-result, connection, element, and journey step faults; `BrowserNotConnectedError` and `BrowserDestroyedError` (server) narrow the lifecycle. `BrowserConnectionError` lives in the core because the in-page `SocketCDPTransport` throws it too. A `BrowserElementError` carries `context.reason`, one of `GONE`, `HIDDEN`, `OCCLUDED`, `DISABLED`, `UNTRUSTED`, and `UNKNOWN`, and a one-line message that ends `; call look for fresh refs.` for `GONE` alone. A `BrowserStepError` carries the performed `BrowserAction` in `action`, and a replay records a step that did not complete from it. Each class ships an `is*` guard, and the code table under [Errors](#errors) names every code that reaches a caller, the `BROWSER_JOURNEY_*` codes, `BROWSER_TOOLSET_BUSY`, and `BROWSER_SERVER_ENVIRONMENT` included. [`tests/src/core/errors.test.ts`](../tests/src/core/errors.test.ts) and [`tests/src/server/errors.test.ts`](../tests/src/server/errors.test.ts) pin the guards; [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts), [`tests/src/core/BrowserReplay.test.ts`](../tests/src/core/BrowserReplay.test.ts), [`tests/src/core/BrowserJourneyToolset.test.ts`](../tests/src/core/BrowserJourneyToolset.test.ts), the store suites, and [`tests/src/bin/main.test.ts`](../tests/src/bin/main.test.ts) pin the journey, busy, and environment codes.
8. **Oversized results fail clean.** `evaluate()` and `read()` wrap their in-page result with `compileGuardedEvaluateExpression(expression, BROWSER_RESULT_LIMIT)`, which throws the `BROWSER_RESULT_LIMIT_SENTINEL_PREFIX` sentinel before an oversized result could overflow the transport frame; the frame recognizes it through `BROWSER_RESULT_LIMIT_PATTERN` and rejects with a coded `BrowserResultLimitError`, and the connection and the browser process are unaffected. [`tests/service/browser.test.ts`](../tests/service/browser.test.ts) pins both against a real browser.
9. **The page recorder records semantic steps, and a journey compiles to a module that runs as a replay does.** `page.codegen()` records each gesture by role and exact accessible name, collapses consecutive edits on one field while the edit is open, and never across a submission, a focus departure, a navigation, or `stop`. `compileBrowserJourney` emits one `follow` call per step on a toolset the module constructs, as `'javascript'` or `'typescript'`, and throws at a gap step. [`tests/src/core/recorders/BrowserCodegen.test.ts`](../tests/src/core/recorders/BrowserCodegen.test.ts) pins the recorder, [`tests/service/codegen.test.ts`](../tests/service/codegen.test.ts) pins its gestures on Chromium against the fixture's own event log, [`tests/src/core/compilers.test.ts`](../tests/src/core/compilers.test.ts) pins the module byte for byte, and the `compiled module equality` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) runs each generated module and its replay to one page outcome with the same receipts.
10. **Doc ↔ source method bijection.** Each `## Methods` table lists exactly the call-signature members of its interface, inherited members included, and each implementing class named for its interface exposes no public method its table omits: `BrowserCodegen`, `BrowserRecorder`, `BrowserReplay`, `BrowserHold`, `BrowserJourneyToolset`, `BrowserMCPServer`, the two memory stores, and the two file stores pair with their interfaces as every earlier class does. Every other export is a function or a data bag. [`tests/guides.test.ts`](../tests/guides.test.ts) pins it.
11. **The WebSocket transports are thin bridges.** `WebSocketCDPTransport` (server) and `SocketCDPTransport` (in-page) connect a `WebSocket` to the CDP debugger URL, race the opening against `timeout` (default `BROWSER_DEFAULT_TIMEOUT_MS`), and bridge the socket's `message`, `close`, and `error` events onto their emitter unchanged. `start()` rejects with a `BrowserConnectionError` carrying the URL on a socket error, a non-open close, or the timeout, and `send` before `start` throws the same coded error. A browser launched without `--remote-allow-origins` naming the caller's origin refuses the in-page handshake. [`tests/src/server/transports/WebSocketCDPTransport.test.ts`](../tests/src/server/transports/WebSocketCDPTransport.test.ts) and [`tests/src/browser/transports/SocketCDPTransport.test.ts`](../tests/src/browser/transports/SocketCDPTransport.test.ts) pin them.
12. **`Browser.destroy()` escalates SIGTERM to SIGKILL; `close()` is graceful.** On POSIX each launch owns an isolated process group, and `destroy()` signals that group, waiting `BROWSER_KILL_GRACE_MS` before `SIGKILL` and the same bounded window after it; on Windows a launch owns no group, so each step signals one process by identifier. `close()` sends CDP `Browser.close` first and escalates to the same sequence only when an owned process fails to exit within the grace period. Teardown explicitly closes and awaits the owned stderr read pipe, even when a surviving descendant retains its writer. `owned` is `true` for a launched or adopted session, `false` for an active attachment, and `undefined` when no session is represented; `pid` names the process serving the endpoint and stays readable across a `'persistent'` session's `disconnect()`. [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts) pins the sequence and pipe release against spawned processes.
13. **A launch owns the process that serves its endpoint, through the inherited pipe.** Chrome and Chromium serve the endpoint from the process they spawn. A launcher such as Microsoft Edge on Windows instead re-executes the browser with the same `--remote-debugging-port` and exits 0 before the endpoint answers, and the process it spawned inherits its standard error, so `connect()` treats that clean exit as a hand-off: it keeps reading the same pipe on the same `timeout` budget until the `DevTools listening on` line arrives, then reads the `browser` entry of CDP `SystemInfo.getProcessInfo` and owns the process named there. A nonzero exit or a signal rejects at once with a `BrowserConnectionError` naming the exit; a pipe that closes without the line rejects with the readiness failure; an endpoint that names no browser process rejects after a best-effort `Browser.close`. The Windows Edge launch reading is recorded in limit 26. The launcher hand-off cases in [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts) pin the rest.
14. **A snapshot is serializable data plus navigation.** `BrowserSnapshot` holds exactly `documents` and `styles`, so `JSON.stringify(snapshot)` yields `{ documents, styles }` and `createBrowserSnapshot(parsed)` navigates it again; every method takes and returns bare `BrowserNode` values, and containment is derived from `ancestors`. [`tests/src/core/BrowserSnapshot.test.ts`](../tests/src/core/BrowserSnapshot.test.ts) pins it.
15. **A reference names one element for as long as that element exists.** A reference is `e` followed by a positive integer. On CDP every page's element manager mints from one counter its browser context owns and binds the reference to `SESSION:BACKEND`, because backend node ids are per renderer; in the DOM placement the view owns the counter and binds a `WeakRef`. No number is reused within the context. A cross-document navigation of the main frame drops every reference, a child frame's navigation or detachment drops that frame's, and a stale or unknown reference refuses `GONE` or `UNKNOWN` with a message naming `look`. `parseBrowserReference` accepts `e12`, `E12`, `12`, `[e12]`, `ref=e12`, and `[ref=e12]`. A journey's `reference` is evidence a developer reads, never a lookup: replay resolves each target by role and exact name. [`tests/src/core/elements/BrowserElementManager.test.ts`](../tests/src/core/elements/BrowserElementManager.test.ts), [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts), and [`tests/src/browser/elements/BrowserDOMElementManager.test.ts`](../tests/src/browser/elements/BrowserDOMElementManager.test.ts) pin it, and the `journey semantic replay` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) pins that a changed page resolves by name and that neither a stored reference nor a matching CSS selector resolves a target.
16. **A reading is captured one time and sliced from one projection.** `frame.read()` issues one size-guarded evaluation in the isolated world; `markdown` and `text` each project the capture one time per mode and cut every slice from it, ending a bounded slice after the last line break in its window when one lies past `offset`. Truncation is derived as `offset + text.length < total`, and `stale` is derived from the navigation epoch, never stored. [`tests/src/core/BrowserReading.test.ts`](../tests/src/core/BrowserReading.test.ts) and [`tests/src/core/BrowserPage.test.ts`](../tests/src/core/BrowserPage.test.ts) pin it.
17. **The registry mirrors the domain and settles every invocation.** `start()` subscribes before it enables, because enabling reports every registered tool; a `-32601` answer unsubscribes and resolves `false`, and any other failure rethrows. `execute` never passes the signal to `invokeTool`, so the invocation id always arrives; an abort or a deadline sends `WebMCP.cancelInvocation` with that id and rejects without waiting for `Canceled`; a navigation or detachment of the tool's frame and `destroy` reject; every terminal status resolves a `BrowserInvocationResult`. A `toolResponded` with an unknown id is held only while an `invokeTool` reply is pending. [`tests/src/core/BrowserRegistry.test.ts`](../tests/src/core/BrowserRegistry.test.ts) pins it.
18. **Actions run one at a time.** The toolset runs actions in first-in, first-out order, and an action holds the queue until its receipt is produced; an action whose signal aborts while queued sends nothing. After a `mousePressed` or `keyDown` is sent, the matching release is sent without the signal, so an abort never leaves a button or key down, and the next action waits for a pending release. Every result and error message is cut at `limit` characters plus a footer. A `click`, `type`, or `press` on a page opens `page.navigation.record(frame)` before its first input and settles its receipt through that record, so the receipt's view follows the navigation the record selects, and the toolset holds no frame, session, or loader state of its own. While a replay holds the toolset, an action admitted after the hold that does not carry the hold's token is refused with `BROWSER_TOOLSET_BUSY` rather than queued, and the actions admitted before the hold complete first. The queue, bounds, destroy, hold, and navigation settlement cases in [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts), the selection cases in [`tests/src/core/BrowserNavigationRecord.test.ts`](../tests/src/core/BrowserNavigationRecord.test.ts), and the `claim 6` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) pin it.
19. **A dialog interrupts every tool and stages `dialog`.** Every pending step of every tool is raced against the page's `dialog` event, so a tool returns a receipt naming the dialog while the blocked command waits; the `dialog` tool is advertised while the dialog is open and bypasses the queue, and every other tool refuses with a message naming the open dialog and ending `call dialog.` A replay admits a `dialog` step only after an `interrupted` action, the continuation the toolset stages, and under a hold a `dialog` from another caller is refused with `BROWSER_TOOLSET_BUSY`. The dialog cases in [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) and [`tests/src/core/BrowserReplay.test.ts`](../tests/src/core/BrowserReplay.test.ts), the `confirm()` and `beforeunload` dialog cases in [`tests/service/toolset.test.ts`](../tests/service/toolset.test.ts), and the `claim 6` block of [`tests/service/journey.test.ts`](../tests/service/journey.test.ts) pin it.
20. **CDP input is trusted and DOM input is not.** A page's `trusted` is `true`: clicks, keys, and hovers are `Input` events whose `isTrusted` is `true`. A DOM view's `trusted` is `false`: `click` is `HTMLElement.click()`, `fill` is the native value setter plus `input` and `change`, and `submit` is `requestSubmit()` observed by a `submit` listener, so a form that fails validation reports `did not submit` with the field's `validationMessage`. Its `click` and `type` receipts end `(untrusted event)`. It refuses rather than fakes a key press, a navigation, a file chooser, typing into `contenteditable`, a link or form whose target opens another browsing context, a disabled control, and a cross-origin frame. [`tests/src/browser/elements/BrowserDOMElement.test.ts`](../tests/src/browser/elements/BrowserDOMElement.test.ts) and [`tests/service/document.test.ts`](../tests/service/document.test.ts) pin it.
21. **The toolset's names are reserved at `start()`.** `start()` rejects with a coded `BrowserError` and adds nothing when the manager already holds `look`, `read`, `plain`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `tabs`, or `switch` under a tool the toolset did not add, and a page tool under a reserved name is skipped with `reserved`. A page tool named `unresolved` is also skipped as reserved. A toolset constructed with `journeys` also reserves `record`, `save`, `journeys`, `edit`, `replay`, and `forget`: construction refuses a manager that holds one with `BROWSER_TOOLSET_RESERVED`, and a page tool under one is skipped with `reserved`. The `browse` server keeps its dispatchers on a manager of its own and forwards to the toolset's, so the toolset meets no foreign name. A consumer that replaces a reserved name after `start()` breaks the path a receipt names, such as `call dialog`. [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts), [`tests/src/core/BrowserJourneyToolset.test.ts`](../tests/src/core/BrowserJourneyToolset.test.ts), and [`tests/src/server/BrowserMCPServer.test.ts`](../tests/src/server/BrowserMCPServer.test.ts) pin it.
22. **The in-page toolset never drives its own document by default.** An action that navigates the realm's own document cannot return, so `createBrowserDOMView` and `createDocumentToolset` refuse `globalThis.document` with `BROWSER_DOCUMENT_OWN` unless `own` is `true`. [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts) pins it.
23. **Limit: an `alert()` blocks the driven document.** The DOM placement never replaces `window.alert`, `confirm`, or `prompt`, so a click that opens one blocks the driven document's thread and the action does not return until a person answers it; the CDP placement stages `dialog` instead. [`tests/guides.test.ts`](../tests/guides.test.ts) pins that no `src/browser` module assigns those functions.
24. **Limit: a `debugging` page tool is not adopted.** [Declared conformance gaps](#declared-conformance-gaps) records this limit in its entry "A `debugging` page tool is not adopted". [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts) and the skip rows of [`tests/conformance.test.ts`](../tests/conformance.test.ts) pin it.
25. **Limit: the `WebMCP` live proof names its host.** Chromium 141, the host browser, answers `WebMCP.enable` with `-32601`, so the registry conforms to the vendored mirrors and the scripted transports, and this guide claims no interoperability with a shipping registry. [Declared conformance gaps](#declared-conformance-gaps) records this limit and its closer in its entry "The live `WebMCP` domain is unproven on this host". The case in [`tests/service/browser.test.ts`](../tests/service/browser.test.ts) that compares `registry.start()` with whether `Schema.getDomains` lists `WebMCP`, and the live case that skips on that answer, pin it.
26. **Limit: the Windows launch reading covers Edge 154.0.4258.53.** On 2026-10-03, `npm run test:service` launched Edge 154.0.4258.53 on Windows and reported 105 passed tests after commit `73c608f`. That run proves launch and endpoint ownership on that host; it doesn’t establish a launcher hand-off on every Edge installation or a Linux or macOS result. The launcher hand-off cases in [`tests/src/server/Browser.test.ts`](../tests/src/server/Browser.test.ts) exercise re-execution and inherited stderr with fixture processes.

## Patterns

### Automate a page end-to-end

This demonstration launches a headless browser, fills and submits a search form, waits for the
results, and reads the resulting content.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ headless: true })
await browser.connect()

const page = await browser.create({ url: 'https://example.com' })
const [search] = await page.elements.find({ css: '#search' })
await search?.fill('orkestrel')
const [submit] = await page.elements.find({ css: '#submit' })
await submit?.click()
await page.elements.wait({ css: '#results' })
const reading = await page.read()

await browser.destroy()
```

### Record a journey from the toolset and save it

A model records a journey by calling `record`, taking its actions, and calling `save`; the observations it calls between them are not steps. The following fence makes the same calls through the manager over file stores, with comments adapted from the `browse` binary’s answers on 2026-10-01 against a two-page loopback shop on Chromium 141.0.7390.37 to the vocabulary that replaces `what` with `search` and adds `plain`. The view after each receipt is left out.

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
await toolset.tools.execute({ id: '2', name: 'click', arguments: { ref: 'e1' } }) // Clicked e1 link "Alpine Kettle".
await toolset.tools.execute({ id: '3', name: 'look', arguments: { search: '' } }) // no step
await toolset.tools.execute({ id: '4', name: 'click', arguments: { ref: 'e2' } }) // Clicked e2 button "Add to cart".
await toolset.tools.execute({ id: '5', name: 'wait', arguments: { text: 'Added to cart' } }) // "Added to cart" is on the page.
const saved = await toolset.tools.execute({
	id: '6',
	name: 'save',
	arguments: { description: 'Adds the Alpine Kettle to the cart' },
})
// Saved add-kettle with 3 steps.
//
// add-kettle "Adds the Alpine Kettle to the cart"
// s1 click link "Alpine Kettle"
// s2 click button "Add to cart"
// s3 wait "Added to cart"
```

`save` writes the journey before it ends the recording, so a write that fails or meets a held lock leaves the recording open, and the next `save` writes those steps and the actions recorded after the refusal. The journey lands at `tmp/browsers/add-kettle/journey.json`.

### Replay a journey with inputs

`replay` runs a saved journey on the current page; `inputs` carries a value for each parameter, and a parameter with a default takes the default when `inputs` omits it. The following fence replays the `add-kettle` journey of 5 steps, whose `email` parameter defaults to `sam@example.test`, with another address, and its comments show the render's head line and a refused input; see [The listing](#the-listing) for that journey and [Replay a journey](#replay-a-journey) for the whole render.

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

`edit` is the review path: read the listing `journeys` returns, then change the journey by step id in one batch, which applies in order and is refused whole on its first invalid edit. A batch can declare a parameter and bind it in the same call, and `remove` drops a step a model repeated. The following fence edits a recorded order form whose model pressed Enter after a `type` that had already submitted: it declares `customer`, binds the name field's text to it, and removes the second submission.

```ts
await toolset.tools.execute({ id: '9', name: 'journeys', arguments: { search: 'place-order' } })
// 1 journey matches "place-order":
// [0] place-order "Order the Alpine Kettle with a name"
//
// place-order "Order the Alpine Kettle with a name"
// s1 type "Ada Lovelace" into textbox "Full name", submit
// s2 press Enter
// s3 wait "Order confirmed"
// s4 click link "Orders"
await toolset.tools.execute({
	id: '10',
	name: 'edit',
	arguments: {
		journey: 'place-order',
		edits: [
			{ operation: 'declare', name: 'customer', parameter: { default: 'Ada Lovelace' } },
			{ operation: 'update', id: 's1', arguments: { text: { parameter: 'customer' } } },
			{ operation: 'remove', id: 's2' },
		],
	},
})
// Edited place-order.
//
// place-order "Order the Alpine Kettle with a name" (parameters: customer)
// s1 type "Ada Lovelace" as customer into textbox "Full name", submit
// s3 wait "Order confirmed"
// s4 click link "Orders"
```

An added or updated step can name `ref` from the current view in place of a target; `edit` converts it to the element's role and exact name before the batch applies, and refuses a reference the view does not hold. `edit` writes at the revision it read, so a write that landed in between is refused with `Journey place-order changed since you read it; call journeys, then edit again.`

### Generate a module from a journey

`compileBrowserJourney` turns a journey into a module a developer runs and customizes; `codegen.script(options)` compiles a page recording the same way. The following fence is the TypeScript module `compileBrowserJourney(journey, { language: 'typescript' })` emits for `add-kettle`, laid out by the formatter. The JavaScript module drops the type import and the annotations.

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

A secret parameter compiles to a required input and passes `{ secret: true }` to its `type` step, and a parameter without a default compiles to a required input. The module checks its inputs before its toolset starts, as replay refuses them at preparation with `BROWSER_JOURNEY_INPUT`: an input that names no parameter throws `NAME: no parameter has that name`, then a required input without a string value throws `NAME: the input is missing`, then a defaulted input that is neither `undefined` nor a string throws `NAME: the input is not a string`, where `NAME` is the input's name. Replay reads an own `undefined` input as omitted, so the module and replay refuse the same inputs. A module with a required parameter reports the first one as missing when `execute` receives no inputs. A journey without parameters compiles no check. A gap step compiles to `throw new Error('s6: the element is in a child frame; handle it here')` at its position, and `gaps` lists it. `follow` throws a `BrowserStepError` whose message is `sN: RECEIPT` and whose `action` is the performed `BrowserAction` when a step did not complete, and returns the `BrowserAction` of an `interrupted` action, so a `dialog` step that follows it answers the pending input.

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
// a further connect() on this instance throws BrowserDestroyedError, same as after destroy()
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

The following prompt follows the reading vocabulary. The recorded store proof in `@orkestrel/ollama` used the earlier argument name and predates the plain-text tool. The toolset follows these rules: every tool declares at least one required parameter, so `look`, `read`, `plain`, `tabs`, and `journeys` take `search`; references are spelled `e4` and the parameter descriptions name one; one observation carries text and references in document order; every action's receipt carries the fresh view; and the first message carries the view, so the model starts from the page rather than from a guess. The system prompt tells the model to call a tool before it answers, states that the first message shows the page as `look` returns it and that references such as `e4` name its elements, names the one call for each kind of step (`read` with `search` set to words from the question, and again with the offset its result names, to learn a fact; `type` with the reference, the words, and `submit true` to use “the site's search box”; `click` with a reference from the latest result to press a button or follow a link; and `wait` one time for text that has not appeared), tells it never to invent a reference, and tells it to answer in one short sentence.

With the earlier prompt, `qwen3.5:2b-q4_K_M` at temperature 0 with 256 predicted tokens a turn met the oracle of all five store tasks against this package's 0.0.19 build, packed from commit `254d107`: read, click, search, and form on their first attempt, and paging on its second. The run took 627.4 s, and its transcripts sit under `tmp/probes/logs/v8/` in `@orkestrel/ollama`; every count and duration in the following list is from them. The list states what the proof asserts for each task and what the transcripts show beside it.

- Read: 2 calls in 55.4 s, `look` and then `read` without an offset. The proof asserts that a result carried the shipping cutoff the seeded view did not and that the answer names it, and the answer named `2:40 PM`.
- Click: 8 calls in 93.6 s. The proof asserts that the cart holds the named product and no other, and it held `Cedar Tea Tray`. On the product page the model called `type` on the button, which was refused with `Element e28 button "Add to cart" takes no text; call click for a button.`, and its `click` on the button returned a receipt whose view was the cart page. The model then called `wait` four times for text it invented and reached the 8-call limit without an answer, which the proof does not assert.
- Search: 5 calls in 141.7 s. The model called `look` and `read`, then `click` on the search box, whose receipt names `type`, then `type` with `submit`, whose receipt carried the results page listing both kettles, then `read` on the results, and answered naming both. The proof asserts that the store recorded a query that matches the task's products and that the answer names exactly those products, so the expected-failure pin the earlier runs held is lifted. In the runs under `v4/`, `c5/`, and `v5/`, the turn ended empty after the click receipt that names `type`. In the run under `v6/`, the model submitted `kettles`, the fixture's substring match found no product for the plural, and the turn ended empty; `@orkestrel/ollama` fixed that match in its store fixture. In the run under `v7/`, the model completed the search and ended with an empty final turn.
- Form: 5 calls in 62.9 s. The proof asserts that the store recorded the order and that the answer names the confirmation code. The `type` with `submit` receipt read `Typed "Ada Lovelace" into e64 textbox "Full name" and submitted the form; the page handled the submission without navigating; call wait for the text you expect.`; the model then submitted again with `press` Enter, whose receipt's view carried the code, called `wait`, and answered with the code. The store recorded two orders: the receipt's directive did not change the model's second submission.
- Paging: the first attempt called `read` seven times without an offset, each returning the first slice, and reached the call limit. The second attempt, 2 calls in 60.0 s, continued at the offset 3998 the footer named, reached the slice that holds `HARBOR-TIDE-7153`, and named the token in its answer, the first run to do so. The proof's oracle stays the continued read, and it does not assert the answer.

The following fence seeds the first turn with the toolset's own `look` result, the way the store proof in `@orkestrel/ollama` runs each task, and bounds the run to 8 turns.

```ts
import { createAgent } from '@orkestrel/agent'
import { createBrowserToolset } from '@orkestrel/browser'
import { createOllama } from '@orkestrel/ollama'
import { createToolManager } from '@orkestrel/tool'

const system =
	'You control a web browser with tools and must call a tool before you answer. ' +
	'The first message shows the page as look returns it; references such as e4 name its elements. ' +
	'To learn a fact, call read with search set to words from your question; when its result ends by naming an offset, call read again with that offset. ' +
	"To use the site's search box, call type with its reference, the words, and submit true. " +
	'To press a button or follow a link, call click with its reference from the latest result. Never invent a reference. ' +
	'If text you expect has not appeared, call wait once. ' +
	'When the task is done, answer in one short sentence.'

const toolset = createBrowserToolset(page, { tools: createToolManager() })
await toolset.start()
try {
	const seeded = await toolset.tools.execute({
		id: 'seed',
		name: 'look',
		arguments: { search: '' },
	})
	const view = seeded.success ? String(seeded.value) : seeded.error
	const agent = createAgent(createOllama({ model: 'qwen3.5:2b-q4_K_M' }), {
		system,
		tools: toolset.tools,
		limit: 8,
	})
	agent.context.messages.add({
		role: 'user',
		content: `Add the Alpine Kettle to the cart.\n\nThe browser shows this page:\n${view}`,
	})
	const result = await agent.generate()
	log(result.content)
} finally {
	await toolset.destroy()
}
```

Read the task's outcome from the page, never from the model's answer: the store proof checks the cart, the submitted query, and the read fact against the page state after each run.

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
- `BROWSE_EXECUTABLE`: the path of the Chromium executable. Default: the browser `findSystemBrowser` finds.
- `BROWSE_READONLY`: `true`, `false`, `1`, or `0`; `true` refuses `record`, `save`, `edit`, and `forget`, and `replay` still writes runs. Default: `false`.
- `BROWSE_POOL`: an integer from `1` through `3` setting the number of browsers the server keeps warm. Default: `1`.

A malformed value ends the process with exit code 1 and one line on standard error. Any other value of `BROWSE_HEADLESS` or `BROWSE_READONLY`, and a `BROWSE_POOL` that is not an integer, writes a `BROWSER_SERVER_ENVIRONMENT` line, such as `browse: BROWSER_SERVER_ENVIRONMENT: BROWSE_HEADLESS must be true, false, 1, or 0, not "sometimes"`. An integer `BROWSE_POOL` outside `1` through `3` writes `browse: BROWSER_SERVER_OPTIONS: pool.size must be an integer from 1 through 3`. On Linux a server running as root launches Chromium with `--no-sandbox`, because Chromium refuses to start as root with its sandbox on.

Chromium starts when the server starts, before the client sends a request. The server launches its first browser, checks that it answers a CDP ping, and leases it to the session. `initialize` and every tool call wait for that lease, and `ping` and `tools/list` answer while the browser warms. With `BROWSE_POOL` at `2` or `3`, the other browsers warm after the first, and `initialize` does not wait for them. A launch that fails is retried one time. The end of input or `SIGTERM` closes every browser and removes its profile, the process exits with code 0, and a run without a fault writes nothing to standard error.

A client gives a server a limited time to answer `initialize`. On 2026-10-03, Claude Code's documentation gave 30 s and connected servers in the background, the Codex configuration reference gave 10 s through `startup_timeout_sec`, and Cursor's documentation gave no limit; see [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp), [the Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), and [Cursor's MCP documentation](https://cursor.com/docs/context/mcp). On Windows 11 with Edge 154 on 2026-10-04, while a browser test suite ran beside it, the built binary answered `initialize` at most 2.07 s after its spawn at every `BROWSE_POOL` size, a leftover browser to sweep included. No client needs a longer startup timeout.

Set `BROWSE_POOL` to `2` or `3` to keep a warm spare for failover. The session holds one browser at a time, and a spare waits idle until the session's browser is lost; the next call then runs on the spare while a replacement warms, and concurrent calls share that one spare. At `1`, the next call after a loss waits for a replacement launch. In the 2026-10-04 run, the next successful call after a kill of the session's browser took a median 1.92 s at `1` and 0.40 s at `2`, and an idle spare's process tree held a median 1.22 GB of summed working set, shared pages counted in every process that maps them.

When the session's browser is lost, browse never repeats a call. A loss is the browser process exiting, its CDP connection dropping, the renderer of its current page crashing, or a CDP ping it fails before a call or after a failed one; a crashed background tab is not a loss. The following list gives what each call answers around a loss:

- A call after the loss runs on a fresh browser that starts at `about:blank`, and its text opens with a `BROWSER_SERVER_CRASH:` note that names the cause and the lost page's URL. An element reference from the lost page is refused.
- A call the loss interrupts answers `BROWSER_SERVER_UNRESOLVED:`: its outcome is unknown, and browse did not repeat it. Read the page before you repeat the call.
- A call that completed before the loss keeps its result, and the next call carries the note.
- A call that fails for its own reason on a live browser answers its plain failure, with no note.
- When no browser can serve, the call answers the note, then `BROWSER_SERVER_UNAVAILABLE:` naming the cause.

When no browser starts at setup, the server refuses on each surface and keeps answering until its input ends. Setup fails, for example, when the first browser fails to launch twice or the root cannot be created. The following list gives what each request answers, where `CAUSE` is the failure's message:

- `initialize` answers the JSON-RPC error `-32000` with the message `BROWSER_SERVER_UNAVAILABLE: CAUSE` and `data.code` set to `BROWSER_SERVER_UNAVAILABLE`.
- `ping` answers `{}`, and `tools/list` answers the vocabulary.
- Every `tools/call` answers an error result whose text opens with `BROWSER_SERVER_UNAVAILABLE:`, so a client that connects without the legacy `initialize` meets the refusal at its first tool call.
- The binary writes `browse: BROWSER_SERVER_UNAVAILABLE: CAUSE` to standard error and exits with code 1 after its input ends.

The server writes each diagnostic as one line on standard error in the form `browse: CODE: DETAIL`, where `CODE` is one of the following codes and `DETAIL` is the cause:

- `BROWSER_SERVER_LAUNCH`: a browser failed to start, and the pool retries it within its bound.
- `BROWSER_SERVER_EXHAUSTED`: a spare failed to start past the bound, so fewer browsers serve than `BROWSE_POOL` names, and the session keeps its browser.
- `BROWSER_SERVER_UNAVAILABLE`: setup was refused, and the binary writes this line before it exits with code 1.
- `BROWSER_SERVER_TEARDOWN`: a browser's termination is unconfirmed or its teardown failed; its profile folder stays until the shutdown recheck, and a shutdown that meets it exits with code 1.
- `BROWSER_SERVER_SWEEP`: the sweep could not read the `.profiles` folder under `BROWSE_ROOT`, and the server serves without it.
- `BROWSER_SERVER_ENVIRONMENT` and `BROWSER_SERVER_OPTIONS`: a malformed variable, as the earlier paragraph describes.

At start, beside the launch, the server sweeps the profile folders that ended servers left under `ROOT/.profiles`, where `ROOT` is the `BROWSE_ROOT` directory. It visits each `<pid>-<uuid>` folder whose owning process has exited. It removes a folder with no `browse.json` record or whose recorded browser has exited, closes a recorded browser that still runs at a `ws://127.0.0.1` endpoint and then removes its folder, and keeps a folder whose record it cannot read, whose endpoint names a host other than `127.0.0.1`, or whose browser refuses to close; the shutdown recheck removes the last kind after its browser exits. `initialize` never waits for the sweep. The sweep never visits a bare `ROOT/.profiles/<uuid>` folder, which releases before 0.0.23 left: delete those folders by hand one time, while no `browse` server runs on that root, and leave every `<pid>-<uuid>` folder to the sweep.

Claude Code 2.1.286 registers the binary for a checkout in four steps:

1. Install the package in the checkout with `npm install @orkestrel/browser`.
2. From the checkout root, run `claude mcp add --scope project browse -- node node_modules/@orkestrel/browser/dist/bin/main.js`. It writes the project's `.mcp.json` with the entry `"browse": { "type": "stdio", "command": "node", "args": ["node_modules/@orkestrel/browser/dist/bin/main.js"], "env": {} }` under `mcpServers`; set a variable from the preceding list under `env`, or pass `-e BROWSE_HEADLESS=false` before the `--` of the same command.
3. Run `claude mcp get browse`. Until the server is approved, it reports `Scope: Project config (shared via .mcp.json)` and ``Status: ⏸ Pending approval (run `claude` to approve)``, and Claude Code connects to no unapproved project server.
4. Start `claude` in the checkout and approve `browse` when it asks about the project's MCP servers. `claude mcp reset-project-choices` clears that choice for the checkout.

Steps 2 and 3 ran on 2026-10-01 against a scratch checkout whose `node_modules/@orkestrel/browser` linked this package's build, with their output quoted. The approval in step 4 is interactive, and no approved Claude Code session drove the server in that run; the exchange that follows drove the command the entry names over stdio directly. With `@orkestrel/mcp` 0.0.34, a client that subscribes through `subscriptions/listen` receives `notifications/tools/list_changed` when the server mirrors a page tool, and a client that connects through `initialize` receives none and sees the tool at its next `tools/list`; which of the two Claude Code 2.1.286 opens is unread.

The following fence adapts the recorded exchange to the vocabulary that replaces `what` with `search` and adds `plain`, one request and the text of its answer per line, with the view after each receipt left out; the replay wrote `tmp/browsers/add-kettle/runs/2026-10-01T03-07-06.041Z-6d7e/` with `run.json`, `s1.png`, `s2.png`, and `s3.png`.

```ts
// -> initialize { protocolVersion: '2025-06-18' }
// <- { protocolVersion: '2025-06-18', serverInfo: { name: 'browse', version: '0.0.19' }, capabilities: { tools: {} } }
// -> tools/list
// <- look, read, plain, click, type, press, navigate, wait, dialog, tabs, switch, record, save, journeys, edit, replay, forget
// -> tools/call navigate { url: 'http://127.0.0.1:35605/' }
// <- Navigated to http://127.0.0.1:35605/.
// -> tools/call record { journey: 'add-kettle' }
// <- Recording add-kettle; each action you take is a step; call save when it is done.
// -> tools/call click { ref: 'e1' }
// <- Clicked e1 link "Alpine Kettle".
// -> tools/call look { search: '' }
// <- page "Alpine Kettle" http://127.0.0.1:35605/kettle
// -> tools/call click { ref: 'e2' }
// <- Clicked e2 button "Add to cart".
// -> tools/call wait { text: 'Added to cart' }
// <- "Added to cart" is on the page.
// -> tools/call save { description: 'Adds the Alpine Kettle to the cart' }
// <- Saved add-kettle with 3 steps.
// -> tools/call journeys { search: '' }
// <- add-kettle "Adds the Alpine Kettle to the cart"
// <- s1 click link "Alpine Kettle"
// <- s2 click button "Add to cart"
// <- s3 wait "Added to cart"
// -> tools/call navigate { url: 'http://127.0.0.1:35605/' }
// <- Navigated to http://127.0.0.1:35605/.
// -> tools/call replay { journey: 'add-kettle' }
// <- Replayed add-kettle: 3 of 3 steps.
// <- s1 Clicked e3 link "Alpine Kettle".
// <- s2 Clicked e4 button "Add to cart".
// <- s3 "Added to cart" is on the page.
```

The `packed browse binary` case of [`tests/distribution.test.ts`](../tests/distribution.test.ts) runs the same command from an installed tarball through `@orkestrel/mcp`'s stdio client: it lists the vocabulary with Chromium absent, then records, saves, lists, edits, and replays a journey.

On 2026-10-04, Claude Code 2.1.285 under `claude -p --mcp-config FILE --strict-mcp-config` and `codex exec` with `-c mcp_servers.browse.command`, `-c mcp_servers.browse.args`, and `-c mcp_servers.browse.env` overrides each started the built binary, where `FILE` names a JSON file holding the `browse` entry, with no saved client configuration. The following list gives what each client showed:

- Claude Code connects `browse` when setup is refused and shows the refusal as the answer to the first tool call, a text that opens with `BROWSER_SERVER_UNAVAILABLE:` and names the cause.
- Codex hides a server whose `initialize` fails: the agent sees no `browse` tools, and neither the agent nor the `exec` output carries the cause. Run the binary from a terminal with the same environment to read its `browse:` lines.
- Codex `exec` asks approval for each `browse` tool that is not read-only. Under the approval policy `never`, it refused `navigate` with `MCP tool call requires approval, but approval policy is never`, and `look` ran.
- A client that ends its session ends the server before its teardown finishes. On Windows 11 no browser stayed running, and one `<pid>-<uuid>` profile folder without a `browse.json` record stayed; the next start on the same root removes it.

### Publish native tools to a page

A page that runs a built-in browser agent reads tools from its WebMCP registry, and `@orkestrel/mcp`'s bridge publishes a tool manager there. Publish `toolset.native`, never `toolset.tools`: the manager also holds the page tools the toolset adopted from the same registry, and publishing them would register each one as a proxy of itself. The following fence drives a same-origin child document, adopts that document's page tools through the bridge, and publishes the five generic tools back to it.

```ts
import { createDocumentToolset } from '@orkestrel/browser/browser'
import { createModelContext } from '@orkestrel/mcp/browser'
import { createToolManager } from '@orkestrel/tool'

const driven = frame.contentDocument
const bridge = driven === null ? undefined : createModelContext({ document: driven })
if (driven !== null && bridge !== undefined) {
	const toolset = createDocumentToolset({ document: driven, source: bridge })
	await toolset.start() // adopts the document's registered tools, and again on each change
	const native = createToolManager()
	for (const tool of toolset.native) native.add(tool) // look, read, plain, click, type, wait
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
- [`tests/service/toolset.test.ts`](../tests/service/toolset.test.ts): one toolset task end to end through `createToolManager().execute`, the cart view in the receipt of a click whose form the server answers with a 303 redirect, the destination view after a form submission in a child frame, the `confirm()` and `beforeunload` dialogs, popups and tabs, and each receipt within its deadline; its `journey perform equality` block compares `perform` with a direct call for every native action, an editable combobox, a click that opens a dialog, a tab switch, a link that opens a popup, and a click in a same-origin child frame of the DOM placement.
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
- [`tests/src/core/BrowserToolset.test.ts`](../tests/src/core/BrowserToolset.test.ts): the vocabulary, reserved names, dialogs, the action queue, the submit observers and the navigation settlement of each action, views and tabs, page-tool adoption, bounds, destroy, the trust marker, `perform` and its actions, the hold, the secret receipt, the popup a click settles on, the `tabs()` listing, `follow` and its target and tab resolution, and the construction under `journeys`.
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
- [`tests/src/core/recorders/BrowserCodegen.test.ts`](../tests/src/core/recorders/BrowserCodegen.test.ts): the page recorder's semantic steps, edit folding and boundaries, gaps, the password marker, frame installation before resume, its lifecycle, and `script`.
- [`tests/src/core/recorders/BrowserRecorder.test.ts`](../tests/src/core/recorders/BrowserRecorder.test.ts): the toolset recorder's steps, the interrupted and child-frame gaps, the held journey's gap, secret bindings, and its lifecycle.
- [`tests/src/core/BrowserReplay.test.ts`](../tests/src/core/BrowserReplay.test.ts): preparation before any hold, execution and stopping, the dialog continuation, abort, the run write and its bound, captures through the run store, output, and secrets.
- [`tests/src/core/BrowserHold.test.ts`](../tests/src/core/BrowserHold.test.ts): the hold's token and its one release.
- [`tests/src/core/BrowserJourneyToolset.test.ts`](../tests/src/core/BrowserJourneyToolset.test.ts): the six tools, every result and refusal verbatim, the listing and its cut, `readonly`, the signal, the `ref` conversion, and destroy.
- [`tests/src/core/stores/MemoryBrowserJourneyStore.test.ts`](../tests/src/core/stores/MemoryBrowserJourneyStore.test.ts) and [`tests/src/core/stores/MemoryBrowserRunStore.test.ts`](../tests/src/core/stores/MemoryBrowserRunStore.test.ts): the shared store suites over the memory twins, and a capture that keeps no bytes.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts): each journey invariant with a failing case, the step, parameter, and edit validators, and the run validator.
- [`tests/src/core/BrowserDialog.test.ts`](../tests/src/core/BrowserDialog.test.ts): accepting and dismissing a dialog.
- [`tests/src/core/BrowserFileChooser.test.ts`](../tests/src/core/BrowserFileChooser.test.ts): uploading to and dismissing a file chooser.
- [`tests/src/core/BrowserWorker.test.ts`](../tests/src/core/BrowserWorker.test.ts): attached workers.
- [`tests/src/core/BrowserNavigationManager.test.ts`](../tests/src/core/BrowserNavigationManager.test.ts): URL waits across both navigation kinds, network idle, abort, and the records the manager opens.
- [`tests/src/core/BrowserNavigationRecord.test.ts`](../tests/src/core/BrowserNavigationRecord.test.ts): the record's destinations, supersession, loader matching, same-document completion, bounds, abort, and close.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts): the pure decoders, validators, and renderers of `src/core`, the receipt and outline formats included, the exact-name filter, the journey edits, listing, triggers, secret names, run ids, and run render.
- [`tests/src/core/errors.test.ts`](../tests/src/core/errors.test.ts): the guard that narrows a caught value to each core error.
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
- [`tests/src/server/errors.test.ts`](../tests/src/server/errors.test.ts): the guard that narrows a caught value to each server error.
- [`tests/src/server/integration.test.ts`](../tests/src/server/integration.test.ts): a registry invocation settled from a reply and an event sent in one socket write.
- [`tests/src/server/transports/WebSocketCDPTransport.test.ts`](../tests/src/server/transports/WebSocketCDPTransport.test.ts): the `WebSocket`-backed transport against a real in-process CDP server.
- [`tests/src/server/writers/FileBrowserWriter.test.ts`](../tests/src/server/writers/FileBrowserWriter.test.ts): the filesystem writer that creates its missing parent directories.
