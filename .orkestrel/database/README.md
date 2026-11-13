# Database family campaign folder

This folder is the whole briefing for the campaign on `@orkestrel/database`, `@orkestrel/relation`, `@orkestrel/sqlite`, and `@orkestrel/indexeddb`. A session on any machine starts from it alone, with fresh clones of the four repositories and of `@orkestrel/scaffold` for the canon. It cites only tracked files, commits, and published URLs. A `[record: …]` mark in a research file names a scratch record that is not tracked, and the line beside it stands on its tracked carrier.

## Read order

1. `plan.md`: the goal, the exit criterion, § State, § Sequence, and § Open decisions.
2. `tenets.md`: the standing directives every change follows.
3. `designs/native.md`: the ruled native-first design. Read its units and releases in § 8 and the Addendum.
4. `research/strategies-database.md`: the database family's patterns with their evidence, the anti-patterns this campaign hit, the work per package, and the rulings on the Agent file's questions.
5. `research/strategies-agent.md`: the Agent campaign's patterns for building a fast and correct custom mechanism.
6. `research/intake.md`: the user's principle and taverna's requests and measurements, verbatim.
7. `research/audit.md`: the capability audit the design rules on, cited against database 0.0.23, sqlite 0.0.18, indexeddb 0.0.18, and relation 0.0.21.

`ledger.md` holds one row per dispatched unit and per user ruling.

## Start a session

Follow scaffold's `.claude/rules/campaign.md` § Start a session:

- read this folder in the read order above;
- run `git status`, `git log @{upstream}..`, and the dispatch skill's sweep in each repository;
- reconcile each difference with `plan.md` § State before acting.

## Ids

- **A unit** is named by its row in `designs/native.md` § 8, or its step in `plan.md` § Sequence.
- **A tenet** is named by its id in `tenets.md`. An id with no prefix is in `research/strategies-database.md`, and an `A-` id is in `research/strategies-agent.md`.
- **A design addendum** is a section appended to `designs/native.md`.
