# The approval and the upload window

The npm approval is the user's click, and the window it opens is five minutes long. Reach that
click with a live chain, and spend the window without losing it.

## Arm the terminal

- Run the login and every publish under `script -qfc '<command>' <log>`. npm offers the approval
  only when it sees a TTY; without one it fails `EOTP` with no way to answer.
- Pass `--browser=false` to `npm login` and to every `npm publish`. Without it npm prints
  `Press ENTER to open in the browser...` and blocks. Never answer that prompt with a newline: the
  web flow consumes the newline on a later read, drops to a legacy `Username:` prompt, and exits
  **zero** without authenticating. With the flag npm prints the URL and polls, and stdin stays
  untouched.
- Hold stdin open and write nothing to it. Use a fifo held open by a long `sleep`. EOF drops npm
  to the same legacy prompt a stray newline does.
- Run `npm login` before any publish. The `npm publish` command does not open the browser flow:
  unauthenticated it returns `E404` on `PUT`, which reads as a missing package rather than as a
  missing credential.
- Confirm authentication with `npm whoami`, never with an exit code. The legacy fallthrough exits
  zero.
- Re-probe `whoami` immediately before opening the window. A stored credential expires
  mid-session, so a session-start answer does not hold.
- Read a login log that shows the spinner and then a legacy `Username:` prompt as an expired
  attempt rather than as a prompt to answer. Kill it by process id and mint a fresh flow.
- On a Windows host, Git Bash ships no `script` binary, so the upload step is operator-driven:
  prepare the layer, prove the gates, surface the exact `npm publish` command, and the operator
  runs it in a real terminal. Everything before and after the upload — bumps, re-pins, gates,
  registry reads — stays with the Orchestrator. The fifo stdin law still binds on that host.

## Reach the approval

- Launch the login chain only when the user has signalled they are at the keyboard and will click
  within ten minutes. An approval URL expires unclicked in about ten to fifteen minutes, and an
  overnight gap expires the session credential with it.
- Expect an approval for each stage. The `npmjs.com/login/cli/<id>` URL authenticates the session;
  the `npmjs.com/auth/cli/<id>` URL authorizes the publish and opens the five-minute window. Tell
  the user both are coming, or the second link reads as the first having failed.
- Say that approving the publish one opens a five-minute window covering the rest of the layer.
- Surface each approval URL the moment it appears in the log, and take the **last** one in log
  order. npm mints a new URL whenever an attempt starts again, and the log accumulates every one,
  so a URL chosen by sorting rather than by position is already dead when the user opens it.
- Read the URL out of the journal in the foreground and surface it before arming any watcher. A
  watcher-based relay can fail silently, and its silence is indistinguishable from a chain that
  has not reached the URL yet.
- Relay the URL as plain text. A decorated link did not render for the operator, who then had
  nothing to click while the window ran down.
- Re-read the log before treating an approval as failed. The chain is usually still alive on a
  later URL, so surface that one rather than starting the chain again.
- Read a `404` on an approval URL as a publish that already succeeded and consumed it. Read the
  registry before calling it a failure.

## Spend the window

- The window opens when the user approves, not when the first publish starts.
- Open each layer with one package: publish it alone, surface its approval URL the moment the
  journal shows it, and confirm the upload from the registry before starting the rest.
- Then chase the remaining uploads back-to-back in one process with no gap. An upload started
  within seconds of an approval frequently rides that approval, and each one that does not mints
  its own URL.
- Relay every new URL to the user the moment it appears, through a journal watcher, and never
  pause the chain to wait for a click: a poll outlives the relay.
- Tell the user to click only the URL last in log order. A click on a superseded URL poisons the live attempt
  — the current poll fails `403 Forbidden - GET /-/v1/done` mid-flight. After any such 403,
  confirm no publish process is live, then mint one fresh attempt.
- **Never retry a publish that is still waiting for its authorization.** Each `npm publish`
  attempt mints a new `authId` and invalidates the previous one, so a retry loop makes the URL a
  moving target the user cannot approve in time. The abandoned poll then reports
  `403 Forbidden - GET /-/v1/done?authId=…`, which reads as a permissions problem and is the
  abandoned attempt colliding with the live one. Publish the first package of a layer with exactly
  one attempt.
- Retry only an upload that failed **inside** an already-open window. `EOTP` there is intermittent
  contention rather than the window closing: retry about three times, and retry a failed set after
  the layer ends. Packages have landed on the third attempt and on a later pass with no new
  approval. These are different failures wearing similar codes; a retry fixes in-window contention
  and causes the moving approval target.
- Expect a large layer to outlast one window. Size batches to what uploads in five minutes and
  name each planned approval point to the user, rather than discovering them mid-run.
- The contract's serialization law binds every upload in the window, and
  `.agents/orchestration.md` § Long-running commands binds the chain that runs them.

## Read the verdict from the registry

- Read the result from the registry, not from an exit code. A piped `npm publish` reports the exit
  status of the pipeline, and a CDN read straight after a publish can still serve the previous
  version.
- Treat a `404` after a first publish as pending rather than failed. A first publish creates the
  packument and can serve `404` for minutes after success, so for a package with no prior version
  re-read on an interval before reporting either way. A bump serving the old version is CDN lag,
  same rule.
- Rule on a pack-time manifest-rewriting warning by fetching the registry's copy of the manifest,
  never by the warning's own text.
- Re-read the registry before telling the user a package failed. A chain still running, a retry
  that landed, and CDN lag all produce a failure reading that the registry contradicts, and a
  false failure report costs a needless approval and a needless republish.
