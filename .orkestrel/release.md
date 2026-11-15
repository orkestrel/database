# Release wave of 2026-11-14

Layer order: `@orkestrel/contract`; `@orkestrel/sqlite` and `@orkestrel/indexeddb`; `@orkestrel/database`; `@orkestrel/relation`. Each row comes from the package's visit, as `wave.js` wrote it.

| Package | Registry | Ruling | Evidence | Round |
| --- | --- | --- | --- | --- |
| `@orkestrel/contract` | 0.0.23 | bump to 0.0.24, published and confirmed 2026-11-14 | dist moved, ranges same, 0 self-pin hits; release commit `419be61`, pushed with `main` fast-forwarded to it | landed |
| `@orkestrel/sqlite` | 0.0.18 | bump to 0.0.19, published and confirmed 2026-11-14 | dist moved, ranges moved (contract ^0.0.24), 0 self-pin hits; release commit `b1443ac`, pushed with `main` fast-forwarded to it | landed |
| `@orkestrel/indexeddb` | 0.0.18 | bump to 0.0.19, published and confirmed 2026-11-14 | dist moved, ranges moved (contract ^0.0.24), 2 visit self-pin hits in the vendored `guides/browser.md` mirror, ruled inert; release commit `57eeac4`, pushed with `main` fast-forwarded to it | landed |
| `@orkestrel/database` | 0.0.24 | bump to 0.0.25, published and confirmed 2026-11-14 | dist moved, ranges moved (contract ^0.0.24, sqlite and indexeddb ^0.0.19); 7 visit self-pin hits ruled inert (the migration section, the bench baseline labels, a door comment, the vendored browser mirror); release commit `d717ff2`; `main` fast-forwarded to `9c4e449`, the merge that carries main's `0299f8b` | landed |
| `@orkestrel/relation` | 0.0.22 | bump to 0.0.23, published and confirmed 2026-11-14 | dist moved, ranges moved (contract ^0.0.24, database ^0.0.25); 3 visit self-pin hits in the vendored `guides/database.md` mirror, ruled inert; release commit `c2489c1`, pushed with `main` fast-forwarded to it | landed |

The wave closed on 2026-11-14: a registry sweep after the last window lists no `@orkestrel` range in the five packages that trails a release this wave published. Every candidate pin is restored.

# Release wave of 2026-11-14 and 2026-11-15: scaffold 0.0.136 and the quality units

Layer order: `@orkestrel/scaffold`; then the adoption visits of `@orkestrel/contract`, `@orkestrel/sqlite`, and `@orkestrel/indexeddb`; then `@orkestrel/database`; then `@orkestrel/relation`. Each row comes from the package's visit, as `wave.js` wrote it, on Linux with Node 22.23.5 and npm 11.21.1.

| Package | Registry | Ruling | Evidence | Round |
| --- | --- | --- | --- | --- |
| `@orkestrel/scaffold` | 0.0.135 | bump to 0.0.136, published and confirmed 2026-11-14 | dist moved: the Linux fixes of `configs/helpers.ts`, `lane.ts`, and `wave.ts`, the canon rows, the browser bench project, and contract ^0.0.24; release commit `d647970`, pushed with `main` fast-forwarded to it | landed |
| `@orkestrel/contract` | 0.0.24 | no bump | dist same, ranges same, 0 self-pin hits; adoption commits `ef7f2bf` and its re-pin, pushed to the working branch | landed |
| `@orkestrel/sqlite` | 0.0.19 | no bump | dist same, ranges same, 0 self-pin hits; adoption commit `72f0793`, pushed to the working branch | landed |
| `@orkestrel/indexeddb` | 0.0.19 | no bump | dist same, ranges same; 1 self-pin hit in the vendored `guides/browser.md` mirror, ruled inert; adoption commit `df5d14e`, pushed to the working branch | landed |
| `@orkestrel/database` | 0.0.25 | bump to 0.0.26, published and confirmed 2026-11-15 | dist moved, ranges same; 1 self-pin hit in the vendored `guides/probe.md` mirror, ruled inert; release commit `6ab4e29`, pushed with `main` fast-forwarded to it | landed |
| `@orkestrel/relation` | 0.0.23 | bump to 0.0.24, published and confirmed 2026-11-15 | dist same, ranges moved (database ^0.0.26, scaffold ^0.0.136); 2 self-pin hits in the vendored `guides/database.md` and `guides/probe.md` mirrors, ruled inert; release commit `9228254`, pushed with `main` fast-forwarded to it | landed |

The wave closed on 2026-11-15: a registry sweep after the last window lists no `@orkestrel` range in the five packages that trails the version the registry serves. The contract, sqlite, and indexeddb adoption commits ship with each package's next release.

## Standing host-bound readings

| Package | Gate | Reading | Cause | Carrier |
| --- | --- | --- | --- | --- |
| Every family repository on scaffold 0.0.136 | `test:config` | Closed: the case passes on Linux in every visit of this wave. | Scaffold 0.0.136's `isDirectoryPath` answers a path beneath a file as absent (`904503b`). | Closed by scaffold 0.0.136. |
| `@orkestrel/scaffold` 0.0.136 | `test:skills` | Two limits that a Linux container cannot read: ROADMAP 179 (the lane's unwritable run record, which needs a non-root user) and ROADMAP 181 (the discovery proofs, which need the Chromium build the installed Playwright pins). | The container runs as uid 0 and holds Chromium build 1243, where Playwright 1.65.0 pins 1254. | Scaffold `ROADMAP.md` items 179 and 181. |
