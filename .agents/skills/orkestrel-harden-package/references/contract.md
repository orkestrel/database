# Adopt `@orkestrel/contract`

## Inspect the exact installed package

Never work from a remembered contract version or copied API list. Read:

1. `package.json` and the lockfile for the declared and resolved versions.
2. The vendored `guides/src/contract.md` when present.
3. The installed package's declaration file and exports.
4. Relevant package source or current canonical guide when semantics remain unclear.

Do not add `@orkestrel/contract` unless the user authorizes a dependency change. When it is already declared, use it to its full semantically appropriate extent.

## Build an overlap matrix

Inventory local code involving:

- primitive, structural, instance, collection, and total guards;
- guard combinators and refinements;
- coercing parsers and field readers;
- JSON parsing and narrowing;
- `Result`, success/failure outcomes, and safe exception capture;
- contract shapes, compiled guards/parsers/schemas/generators/reporters;
- finite/integer checks, error narrowing, and hostile-boundary containment.

For each local symbol, record:

| Local symbol | Contract candidate | Same semantics? | Difference | Decision | Required tests |
| ------------ | ------------------ | --------------- | ---------- | -------- | -------------- |

Replace only when semantics match or the current contract primitive is intentionally better for the desired API. A similar name is not proof.

## Refactor without wrappers

- Import the originating contract symbol directly when it already expresses the required operation.
- Update downstream call sites atomically.
- Delete rename-only, pass-through, and compatibility wrappers.
- Keep a local helper only when it adds a real invariant, composition, projection, domain translation, or boundary.
- Do not re-export contract symbols from another package's barrel.
- Prefer one compiled contract over independently maintained guard/parser/schema logic when the package genuinely needs those outputs.
- Prefer contract outcomes and safe attempt boundaries over repeated ad hoc `try`/`catch` shapes when their failure semantics match.

Do not force contract abstractions into plain control flow where they obscure behavior or change the error contract.

## Prove strictness and soundness

Test every adopted boundary for relevant invariants:

- guards are total for adversarial values and hostile prototypes;
- parsed values satisfy the paired guard;
- guard-valid values retain identity when promised;
- invalid or ambiguous values fail in the documented form;
- caught non-`Error` throws normalize as documented;
- compiled schema, parser, guard, generator, and reporter stay aligned when used;
- finite, integer, `NaN`, infinities, signed zero, cycles, depth, and cross-realm behavior are covered where applicable.

Run the centralization sweep after replacement so obsolete local types, helpers, constants, and tests do not remain.
