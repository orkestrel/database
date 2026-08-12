# The capture harness

The harness produces the only evidence the verdict lanes are allowed to judge. It is owned
by the campaign owner, not by a review lane, and it is a throwaway instrument: written for
this surface, kept honest, deleted or rebuilt when the surface changes.

## One call, one lifecycle

Background processes started inside one tool call die with that call's process group, and a
verdict round spent on a half-dead harness is a wasted round.

- Write the harness as one self-contained script that spawns its own children, waits for
  readiness, does the capture, and kills them before returning.
- Never leave a child running across calls or expect one to survive its parent.
- Give every child a pinned working directory: a process that resolves assets, config, or
  fixtures relative to the current directory dies silently when launched from elsewhere.
- Pipe child standard error somewhere readable and print it on failure. A discarded stream
  turns a one-line configuration refusal into a debugging round.
- Wait on an observable readiness signal — a served response, a printed line, a health
  probe — never on a fixed sleep.
- Tear down on every exit path, including assertion and setup failure, so a failed capture
  leaves no orphaned server, browser, or port.

## Validate the seed before capturing

Most "the surface is broken" verdicts trace back to a seed the surface legitimately
refused.

- Build seed payloads from the surface's own published contract, not from memory of it: a
  near-miss field name produces an empty screen that looks exactly like a product defect.
- Assert the seeded state is present before shooting: the row exists, the prompt is parked,
  the list is non-empty.
- Drive the surface through its real entry path so the captured state is one a user can
  actually reach.
- Reset to a known state between scenarios; a capture that inherits the previous scenario's
  selection, focus, or scroll proves nothing about either.

## Capture the full portfolio

Every round produces all of it, for every scenario in scope:

| Artifact               | Requirement                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Viewport captures      | The narrow and wide breakpoints the surface actually declares, not one convenient size |
| Theme captures         | Every theme the surface ships, each at both viewports                                  |
| Accessibility snapshot | The rendered accessible tree: roles, names, states, and focus order                    |
| Interaction log        | Each scripted interaction, its trigger, and the observed result                        |
| Console and error log  | Anything the page or process emitted during the run                                    |

- Shoot the whole surface before selecting or focusing anything inside it; a capture taken
  after a selection reports a duplicate or highlighted artifact that does not exist.
- Start a keyboard walk from a neutral state, never from an already-focused control, or the
  log will "prove" a broken order the user never sees.
- Name artifacts so a verdict can cite one exactly: scenario, viewport, theme, step.
- Keep the artifacts of each round beside its verdicts; a round judged against the previous
  round's captures is not a round.

## Preflight before spending a round

The campaign owner opens every artifact before dispatching a verdict lane:

- each capture shows the scenario it claims, in the theme and viewport it claims;
- the seeded state is visible;
- the accessibility snapshot is non-empty and matches the captured screen;
- the interaction log records the interactions the brief asked for;
- nothing in the console log indicates the harness, rather than the surface, failed.

A portfolio that fails preflight is repaired before dispatch. A verdict round is the
most expensive way to discover a harness bug.

## Triage missing evidence to the harness first

When a verdict returns a not-evidenced item, the harness is the first suspect and the
surface is the second. In order:

1. Confirm the artifact that should decide the item exists and is named as the brief said.
2. Confirm the scenario reached the state the item is about.
3. Confirm the seed and the entry path match the surface's real contract.
4. Only then treat it as a product finding.

Every harness gap a round exposes is repaired before the recapture, and the repair is
recorded with the round so the next portfolio is strictly better than the last.
