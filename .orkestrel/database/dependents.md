# Change list for external dependents, the family release wave of 2026-11-14

This wave publishes `@orkestrel/contract` 0.0.24 first, then `@orkestrel/sqlite` and `@orkestrel/indexeddb`, then `@orkestrel/database`, then `@orkestrel/relation`. Each row names the change a dependent outside this campaign owes, and its evidence. The versions the evidence reads are the registry's on 2026-11-14: agent 0.0.44, reason 0.0.18, tool 0.0.23, toolbox 0.0.33, and workflow 0.0.29.

## Contract 0.0.24

The full migration notes are in contract's `Release 0.0.24` commit (`419be61`). The rows a dependent acts on:

| Package | Change | Evidence |
| --- | --- | --- |
| `@orkestrel/tool` | `Tool.execute` admits through `repairValue` and reads `.value.value`. Its guide names `repairValue` and states that each tool description built on it states the repair. | The user ruled on 2026-11-14 that both doors keep repair. `Tool.execute` calls `admitValue` at `dist/src/core/index.js:287-301`, and `guides/tool.md:414` states the repair. |
| `@orkestrel/reason` | `SubjectDoor` admits through `repairValue` and keeps reporting `repairs`. Its TSDoc and guide keep stating the repair. | The user ruled on 2026-11-14 that both doors keep repair. `SubjectDoor` sits at `dist/src/core/index.js:5097-5150`. |
| `@orkestrel/toolbox` | `requireToolCall` admits through `repairValue`, and its guide and each tool description state the repair. The database tool stays strict. Its row and operation descriptions state that each value must match its column's declared type, as the `tables` operation reports, and that a refusal names every fault. | `dist/src/core/index.js:1902-1913`, `:1077`, and `:3432-3452`. |
| `@orkestrel/agent` | Both sites that re-admit built-in tool arguments use `repairValue`, and agent's guide and each built-in tool description state the repair. | `dist/src/core/index.js:8644` and `:13882`. |
| `@orkestrel/workflow` | `admitDefinition` and `admitPatch` use `repairValue`, and each tool description that reaches them states the repair. | `dist/src/core/index.js:950-955` and `:979-989`. |
| Every dependent | No `admitValue` site reads `.repairs` or `.value.value`, and no mirrored guide names `ContractAdmission`. A closed object that receives a non-enumerable or symbol-keyed member, or an array carrying an own key other than an index, refuses where 0.0.23 admitted it. | Census of every published `@orkestrel` package: contract `tmp/research/admit-census.txt` under database, 2026-11-14. |

## Database, from the coverage wave and the strict write door

| Package | Change | Evidence |
| --- | --- | --- |
| `@orkestrel/toolbox` | The database tool's `remove` reply reads `removed[0]`, but `Table.remove(keys)` returns one boolean. Rewrite the reply shape for the boolean return. Check the query replies and the error text against the query door (`VALIDATION`, forwarded as `DATABASE` with `context.code`), and check the `like` and `glob` descriptions. | `tmp/units/dependents-coverage.md`, toolbox `dist/src/core/index.js:3454-3460`. |
| agent, middleware, queue, terminal, worker, workflow, workspace | Take the contract and database releases, refresh the mirrored guides, and run each suite. A write of a numeric string to a numeric column, or of a column present as `undefined`, refuses with `VALIDATION` and names every fault. A nonconforming stored row raises `DRIVER` on read. | `tmp/units/dependents-coverage.md`; contract design § 7. |

The model-facing limit stands: `@orkestrel/tool` 0.0.23 drops the error code and `context.faults` from a tool result, so a model reads the message text alone, which names every fault within `FAULT_TEXT_LIMIT`. It reopens when a tool release carries the code and faults.

## Database 0.0.26 and relation 0.0.24, from the quality units

Database 0.0.26 adds `extractOrderKeys`, `compareOrderKeys`, and an optional `accept` predicate on `readPlannedRows`, and removes and renames nothing (`6ab4e29`). Relation 0.0.24 changes no dist and pins database `^0.0.26` (`9228254`).

| Package | Change | Evidence |
| --- | --- | --- |
| agent, middleware, queue, terminal, toolbox, worker, workflow, workspace, taverna | Take database 0.0.26, and relation 0.0.24 where relation is declared, so one database copy resolves; change no call. `find` reads one row, a residual order holds only its page, and a residual aggregate folds in one pass, so a suite that counted driver calls reads fewer of them. | The `Table` round-trip cases in `tests/src/server/drivers/SQLiteDriver.test.ts` and `tests/src/browser/drivers/IndexedDBDriver.test.ts` pin each operation's driver calls. |
