# Developer-facing writing rules

These rules govern prose a developer reads, including chat replies, reports, guides, README files,
and commit messages.
`AGENTS.md` § Writing governs prose everywhere, and this file does not restate it; this file adds
only what a developer audience decides. An instruction file follows `AGENTS.md` § Instruction files
first, and these rules wherever a rule here names no different form for it.

## Voice and actor

- Write `must` for a requirement, `can` for an option or an ability, and `might` for a possibility.
  A recommendation takes the imperative, the same form `AGENTS.md` § Writing fixes for instructions.
  Never write `should`, and never soften a recommendation into `We recommend`.
- Address the developer as `you`. Name the software component that acts, and make it the subject of
  the sentence. Reserve `user` for someone using software the developer builds. Never write `we`,
  `our`, or `let's` about agent work.
- Give software no human faculties. A component reports, returns, detects, or refuses; it never
  knows, thinks, wants, or sees.
- Use the passive voice only where naming the actor adds blame and nothing else, such as a defect
  count. Name the actor wherever the reader needs it.
- Use negative contractions (`don't`, `isn't`, `can't`) in a reply or a guide. Do not use them in an
  instruction file.

## Sentence and paragraph order

- Put the condition, the goal, or the location before the instruction, so a reader the instruction
  does not apply to stops at the first clause. Put the result or the reason after it. This governs a
  sentence, not a document: a report still opens with its finding.
- Put the key point in the first sentence of every paragraph and every list item, not only in the
  opening of the reply or the section.
- Keep the helper words `that`, `then`, `of`, `a`, and `the`. Do not drop one for brevity.
- Name the noun after `this`, `these`, or `it` wherever the reader could attach the pronoun to
  another referent.
- State what the reader can do. Do not write a double negative.

## Claims and time

- Claim only what the reader can check. Never write `ensure`, `guarantee`, a superlative, or an
  effort adjective as a claim about behavior, and cite the run behind every number. `ensure`
  addressed to an executor as a directive is outside this ban.
- Write the present tense for what exists. Do not write `currently`, `now`, `new`, `latest`, or
  `soon`; where time matters, give the version or the date.
- Recommend one path, the shortest one you proved. Rule on every option you list, and drop an option
  equivalent to the one you recommend.

## Code tokens, references, and links

- Put a code token in backticks and follow it with a noun: the `parse` method, the `vite.config.ts`
  file, the `--check` flag. Never inflect, pluralize, or possessivize a code token, and never use one
  as an English verb.
- Point to other material with `preceding`, `following`, `earlier`, or `later`, never with `above` or
  `below`. Use `earlier` and `later` for a version range too.
- Write link text as the destination's title or a descriptive phrase, introduced by `see`. Never
  write `here`, `this document`, or a bare URL in prose.
- Paraphrase third-party content and link its source; never paste it into prose you author. A
  vendored mirror is fetched bytes rather than authored prose, and `.claude/rules/documentation.md`
  governs it.

## Structure

- Keep a required fact in the main flow. A note or a notice carries only what the reader can skip,
  never a prerequisite, a step, or a warning the task depends on.
- In a reply or a guide, introduce every list, table, and code fence with a complete sentence naming
  what follows; a rule file's list sits bare under its heading. Number a list only where order or
  rank matters. Use a table only for rows with comparable fields.
- Write a heading in sentence case, verb first for a task and a noun phrase for a concept. Identity
  numbering — a claim, an audit verdict, a plan unit — is data rather than a heading style, and
  stays.

## Examples, numbers, and abbreviations

- Build an example from fictional data with descriptive names and no personally identifiable
  information. Write a placeholder in `UPPER_SNAKE_CASE` and explain it on first use. Never write
  `foo`, `bar`, or `baz`.
- Expand an abbreviation the reader may not know on first use, with the short form in parentheses.
  Skip the expansion for one this audience reads daily, such as `API`, `CLI`, `JSON`, `URL`, or a
  file format.
- Write a numeral for a technical quantity, a version, or a measurement. Write a date as
  `YYYY-MM-DD` in evidence, commit messages, and reports. See `AGENTS.md` § Writing for what
  separates a value from a count.
- Use the serial comma. Mark omitted code with a comment in the sample's language, never with `...`.

## Substitutions

Replace each term in this table with its replacement. Quote a literal code identifier as itself; it
is exempt from every row.

| Term                     | Replacement                               |
| ------------------------ | ----------------------------------------- |
| `should`                 | `must`, `can`, `might`, or the imperative |
| `simply`, `easy`, `just` | Delete                                    |
| `currently`, `now`       | Delete, or give the date                  |
| `new`, `latest`          | Delete, or give the version               |
| `utilize`, `leverage`    | `use`                                     |
| `via`                    | `through`, `by using`                     |
| `in order to`            | `to`                                      |
| `e.g.`, `i.e.`           | `for example`, `that is`                  |
| `etc.`                   | Bound the list, or recast the sentence    |
| `performant`, `robust`   | The measured property                     |
| `allows you to`          | `lets you`                                |
| `and/or`                 | `and`, `or`, or `both`                    |
| `since` (causal)         | `because`                                 |
| `once` (temporal)        | `after`                                   |
| `please`                 | Delete                                    |
| `sanity check`           | `quick check`                             |
| `dummy`                  | `placeholder`                             |
| `blacklist`, `whitelist` | `denylist`, `allowlist`                   |
| `master`, `slave`        | `primary`, `replica`                      |

- Sweep case-insensitively and across inflections when checking prose against the preceding table. A
  pattern for `easy` reaches neither `Easy` nor `easier`, and a temporal `once` most often appears
  as a sentence-initial `Once`.
- Rule every hit by the sense its row bans, not by the match. `once` counts as often as it means
  `after`, and `new` names a value as often as it dates one. Record a hit in a permitted sense as
  permitted rather than dropping it.
- Name the pattern and the paths behind every sweep result, including a clean one. A result naming
  neither reports on the population its pattern admitted rather than on the population it was drawn
  from.
- Write singular `they` for a person of unstated gender.
- This table carries no row for `execute`, `abort`, `kill`, `terminate`, or `run`:
  `.claude/rules/names.md` § Fixed lifecycle vocabulary owns those words, and no row here overrides
  it.

## Not adopted

- Do not add conversational personality, warmth, or memorability to a reply; the prose stays plain.
- Do not import a license to break these rules where a departure reads better; an exception exists
  only where a rule states it.
- `We recommend` as a recommendation form — refused in § Voice and actor.
- Do not apply a source guide's sample indentation or line-length chrome; the repository formatter
  and `.claude/rules/typescript.md` decide code presentation.
- Do not write an unspaced em dash; this project spaces it.
- Do not cap a sentence at a word count; `AGENTS.md` § Writing owns sentence length.
- Do not treat an external word list as vocabulary law; the preceding substitution table is the
  adopted set.
