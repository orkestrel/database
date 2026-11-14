# Release wave of 2026-11-14

Layer order: `@orkestrel/contract`; `@orkestrel/sqlite` and `@orkestrel/indexeddb`; `@orkestrel/database`; `@orkestrel/relation`. Each row comes from the package's visit, as `wave.js` wrote it.

| Package | Registry | Ruling | Evidence | Round |
| --- | --- | --- | --- | --- |
| `@orkestrel/contract` | 0.0.23 | bump to 0.0.24, published and confirmed 2026-11-14 | dist moved, ranges same, 0 self-pin hits; release commit `419be61`, pushed with `main` fast-forwarded to it | landed |
| `@orkestrel/sqlite` | 0.0.18 | bump to 0.0.19, published and confirmed 2026-11-14 | dist moved, ranges moved (contract ^0.0.24), 0 self-pin hits; release commit `b1443ac`, pushed with `main` fast-forwarded to it | landed |
| `@orkestrel/indexeddb` | 0.0.18 | bump to 0.0.19, published and confirmed 2026-11-14 | dist moved, ranges moved (contract ^0.0.24), 2 visit self-pin hits in the vendored `guides/browser.md` mirror, ruled inert; release commit `57eeac4`, pushed with `main` fast-forwarded to it | landed |

## Standing host-bound readings

| Package | Gate | Reading | Cause | Carrier |
| --- | --- | --- | --- | --- |
| `@orkestrel/contract` and every family repository on scaffold 0.0.135 | `test:config` | 1 failed: `configuration helpers > resolves a package root from a path the host reports as absent or beneath a file` | On Linux, `lstatSync(path beneath a file, { throwIfNoEntry: false })` throws `ENOTDIR`, because `throwIfNoEntry` covers only `ENOENT` (`tests/config.test.ts:5496`, vendored from scaffold). | No `ROADMAP.md` item yet. Scaffold owes one; the user holds the row in database `tmp/units/scaffold-rows.md` row 6. |
