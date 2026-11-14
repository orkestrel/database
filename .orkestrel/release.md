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

## Standing host-bound readings

| Package | Gate | Reading | Cause | Carrier |
| --- | --- | --- | --- | --- |
| `@orkestrel/contract` and every family repository on scaffold 0.0.135 | `test:config` | 1 failed: `configuration helpers > resolves a package root from a path the host reports as absent or beneath a file` | On Linux, `lstatSync(path beneath a file, { throwIfNoEntry: false })` throws `ENOTDIR`, because `throwIfNoEntry` covers only `ENOENT` (`tests/config.test.ts:5496`, vendored from scaffold). | No `ROADMAP.md` item yet. Scaffold owes one; the user holds the row in database `tmp/units/scaffold-rows.md` row 6. |
