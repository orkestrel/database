---
paths:
  - '**/*.{scss,css}'
  - 'src/styles/**/*'
  - 'tests/setupStyles.ts'
  - 'tests/setupBrowser.ts'
---

# SCSS and CSS rules

SCSS mirrors TypeScript centralization. Concrete token prefixes are project-specific; these structural rules are universal.

## Centralized files

| File           | Sole responsibility                                           |
| -------------- | ------------------------------------------------------------- |
| `_mixins.scss` | `@function` values and `@mixin` declaration emitters          |
| `_tokens.scss` | `:root` public custom-property tokens and cascade-layer order |
| `_theme.scss`  | Token overrides under theme selectors                         |
| `index.scss`   | Sole compilation barrel                                       |

- `_mixins.scss` emits no top-level CSS.
- Consumers load it with `@use '../mixins' as *`.
- Never load `mixins` from `index.scss`.
- `index.scss` is the sole compilation barrel; it loads `tokens`, `theme`, and output partials with `@use`.
- `_tokens.scss` is the token source of truth. Adding a token is allowed; rename/removal is breaking.
- `_theme.scss` only retunes tokens under selectors such as `[data-theme='…']`.
- Component partials never override global tokens.

## Sass mechanisms

- `@function`: pure calculation returning one CSS value.
- `@mixin`: emits declarations and may take `@content`; owns repeated boilerplate.
- `%placeholder`: sharing inside one partial only. It is not reachable across `@use`; cross-file reuse uses mixins.

## Prohibitions

- Check `_tokens.scss` before inventing a token.
- Put global tokens in `_tokens.scss`; put truly component-scoped custom properties on the component selector.
- Never bury tokens in unrelated partials.
- Never use literal colors. Use `var(--token)` or `color-mix()` over tokens.
- Never repeat per-color/per-variant blocks; drive shared structure with one `@each` over a shared list.
- If a pattern appears in at least two partials, move it to `_mixins.scss`.
- A one-partial pattern stays inline; do not create a mixin for one caller.
- Never `@extend` across partials; share through tokens/mixins.
- Never declare a `transition:` without `prefers-reduced-motion: reduce`. Use the project transition mixin, which emits both.
- Animations include `@include reduced-motion { animation: none }`.
- Never wrap rules in a foreign cascade layer. Each partial uses its folder's own layer.
- Declare cascade-layer order once in the consumer entry before `@import 'tailwindcss'`, so utilities win predictably.

## Naming

| Kind            | Form                                                                |
| --------------- | ------------------------------------------------------------------- |
| Function        | lowercase kebab-case verb/noun: `tint`, `clamp`                     |
| Mixin           | lowercase kebab-case verb/verb-noun: `transition`, `reduced-motion` |
| Sass variable   | lowercase kebab-case; `!default` when overridable                   |
| Custom property | project token scheme: `--{scope}-{property}[-modifier]`             |
| Modifier class  | bare adjective/noun: `.surface`, `.muted`, `.accent`                |
| State class     | bare adjective using the shared lifecycle vocabulary                |

State classes are bare adjectives such as `.active` and `.disabled`, chosen consistently with the shared lifecycle vocabulary.

The composable owns interaction state, class application, `aria-*`, and timing. The partial owns visual presentation. Their contracts are stable class names and transition tokens.
