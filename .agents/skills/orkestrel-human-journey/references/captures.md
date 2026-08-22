# The capture portfolio

Take every screenshot from an acceptance journey, at the moment that journey is in the state the
picture names. Never add a test whose only purpose is a screenshot, and never stage a state for the
camera that a journey did not reach through the interface.

## The capture hook

```ts
capture(state: string): Promise<string | undefined>
```

- Return `undefined` and do nothing when the capture flag is unset, so an ordinary run neither
  resizes the viewport nor writes a file.
- Read one variant value that names the theme and the viewport together, and refuse a value that
  names no registered variant.
- Apply that variant's theme and viewport inside the hook, so the run's single variant value is the
  only source of both.
- Write one file named `<state>--<variant>.png` under the workspace's git-ignored `tmp/` tree, and
  return the path it wrote.

## The registry

Declare a frozen list of state names and a frozen list of variants in the journey file.

- Name a state for its surface and its condition — `answer-partial`, `start-storage-failure`,
  `case-delete-confirmation`.
- Register the states the design work actually needs, and place every registered one. Never leave a
  registered state unplaced.
- Wrap the hook in a placement helper that refuses an unregistered state name, refuses a second
  placement of the same state, records each written path, and refuses a filename written twice.
- Place a state from inside the journey that reaches it, immediately after the assertion that
  proves the surface is in that state.

## Variants

- Name a variant as one value carrying both the theme and the viewport, such as `dark-390`. Never
  split them into separate selectors: a split lets a run write a filename describing a combination it
  did not render.
- Render one variant per run, and produce the portfolio — the registry times the variants — by
  repeating the run once per variant.

## The proofs

| Proof                | Runs                        | Asserts                                                                                        |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| Filename expansion   | Always                      | The registry's length and uniqueness, the variant count, and that the expansion is unique      |
| Portfolio membership | Always; disk under the flag | Every registered state was placed; under the flag, the files on disk are exactly the expansion |

- Keep the filename proof always-on, so a registry edit that introduces a duplicate or a collision
  fails the ordinary run.
- Assert placement equality as set equality against the registry, in every run. Never assert a
  count: a count passes while one state is placed twice and another never.
- Under the capture flag, assert the written filenames equal the registry expanded for the run's
  variant, then read each file back and require non-empty contents. Never treat the path a
  screenshot call returned as proof that a file exists.
- Put the membership proof last in the file, after every journey that feeds its tally.

## Transient states

Capture a state that exists only while an activation is in flight from inside that activation,
never after the click returns.

- Attach a one-shot listener to the resolved control, place the capture from inside it, then click
  through the normal verb and await the promise the listener recorded.
- Fail the step when the listener never ran.

## Hygiene

- Keep the portfolio out of version control.
- Regenerate the whole matrix from the journeys after any surface change. Never judge a round
  against a portfolio that is part old and part new.
- Route review of the portfolio to the `orkestrel-polish-surface` campaign, which owns preflight,
  verdicts, and reconciliation. This reference owns only how the journeys generate it.
