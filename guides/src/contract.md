# Contract

> The contract & validation surface — runtime type guards, guard combinators, flat parsers, and a shape DSL. Narrow `unknown` safely, compose guards, coerce-and-extract a field, or declare a value's shape once and compile it into a guard, parser, JSON Schema, and generator that can never drift. Source: [`src/core`](../../src/core). Surfaced through the `@src/core` barrel.

Validation is where untrusted data — an HTTP body, a parsed JSON blob, a tool argument — crosses into typed code. This module is that crossing: it turns `unknown` into a narrowed `T` (or a clean `undefined`) without ever throwing, so a hostile input becomes a `false`, not a crash. It deliberately ships **flat, total primitives** instead of a full schema framework — every guard is a one-argument pure function, the parsers coerce-or-bail rather than collect errors, and the JSON surface is the lazy boundary, not a recursive validator. The one place recursion is needed (a contract over a nested shape) is opt-in through the shape DSL, where the tree is finite and developer-authored. The payoff: nothing here can hang on a cycle, blow the stack on adversarial depth, or silently let a bad value through.

## Surface

A guard is the `Guard<T>` type from [`types.ts`](../../src/core/types.ts):

```ts
type Guard<T> = (value: unknown) => value is T
```

Every guard takes one `unknown`, returns a `boolean` TypeScript reads as a type predicate, and **never throws** — a value that doesn't fit is simply `false`, even on adversarial input (cycles, hostile prototypes). They are total, pure functions of their argument (AGENTS §14), so they are safe to call on anything, in any order, at any trust boundary.

Three sibling families, three jobs:

- **Validators** (`is*`) answer "_is_ this value a `T`?" — a boolean predicate that narrows in place. No coercion, no transform.
- **Combinators** (`*Of`) build a fresh `Guard<…>` out of existing guards (and accept any bare `(value: unknown) => boolean` predicate), so a complex guard is composed, never hand-written.
- **Parsers** (`parse*`) answer "give me a `T` _or_ `undefined`" — they coerce (`'36'` → `36`) and return the typed value or `undefined`, never throwing. Each parser forms a **sound** pair with the guard for its output type (AGENTS §14): a guard-valid input is returned unchanged, and every non-`undefined` output satisfies that guard, so you can parse-then-trust.

The `*Field` parsers read a (possibly nested) record field via a `FieldPath` (`string | readonly string[]`, in [`src/core/types.ts`](../../src/core/types.ts)) — a single string is **one** key (no dot-splitting); an array descends nested objects/arrays through the `resolveField` core helper. The `whereOf` / `lazyOf` / `transformOf` combinators run caller-supplied callbacks _inside_ a guard body; they contain any throw via the core `attempt` helper, so even a guard that runs your code stays total and returns `false` rather than propagating.

### Primitive & null-ish guards

| Guard               | Kind     | Narrows to        | Behavior                                                                             |
| ------------------- | -------- | ----------------- | ------------------------------------------------------------------------------------ |
| `isNull`            | function | `null`            | Strict `value === null`.                                                             |
| `isUndefined`       | function | `undefined`       | Strict `value === undefined`.                                                        |
| `isDefined`         | function | `T`               | True unless `null` _or_ `undefined` — `0`, `''`, `false` are defined.                |
| `isString`          | function | `string`          | `typeof === 'string'`.                                                               |
| `isNumber`          | function | `number`          | `typeof === 'number'` — **`NaN` / `±Infinity` pass** (they are numbers).             |
| `isFiniteNumber`    | function | `number`          | `isNumber` refined by `Number.isFinite` — rejects `NaN` / `±Infinity`.               |
| `isInteger`         | function | `number`          | `isFiniteNumber` refined by `Number.isInteger`; the sound partner of `parseInteger`. |
| `isBoolean`         | function | `boolean`         | `typeof === 'boolean'`; `0` / `1` do **not** pass.                                   |
| `isTrue`            | function | `true`            | Strict `value === true`.                                                             |
| `isFalse`           | function | `false`           | Strict `value === false`.                                                            |
| `isBigInt`          | function | `bigint`          | `typeof === 'bigint'`.                                                               |
| `isSymbol`          | function | `symbol`          | `typeof === 'symbol'`.                                                               |
| `isNullableString`  | function | `string \| null`  | `null`, or a `string`.                                                               |
| `isNullableNumber`  | function | `number \| null`  | `null`, or a `number` (`NaN` / `±Infinity` pass).                                    |
| `isNullableBoolean` | function | `boolean \| null` | `null`, or a `boolean`.                                                              |

### Structural & collection guards

| Guard                 | Kind     | Narrows to                 | Behavior                                                                                                                                                                                                                      |
| --------------------- | -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isObject`            | function | `object`                   | `typeof === 'object' && !== null` — **arrays and class instances pass**, `null` does not.                                                                                                                                     |
| `isRecord`            | function | `Record<string, unknown>`  | Plain objects only: rejects arrays / `null`; realm-agnostic prototype-chain test (prototype is `null`, or its own prototype is `null`) so a plain object from another realm still passes while `Date` / class instances fail. |
| `isMap`               | function | `ReadonlyMap<K, V>`        | `instanceof Map`.                                                                                                                                                                                                             |
| `isSet`               | function | `ReadonlySet<T>`           | `instanceof Set`.                                                                                                                                                                                                             |
| `isWeakMap`           | function | `WeakMap<object, unknown>` | `instanceof WeakMap`.                                                                                                                                                                                                         |
| `isWeakSet`           | function | `WeakSet<object>`          | `instanceof WeakSet`.                                                                                                                                                                                                         |
| `isDate`              | function | `Date`                     | `instanceof Date`.                                                                                                                                                                                                            |
| `isRegExp`            | function | `RegExp`                   | `instanceof RegExp`.                                                                                                                                                                                                          |
| `isError`             | function | `Error`                    | `instanceof Error`.                                                                                                                                                                                                           |
| `isPromise`           | function | `Promise<T>`               | `instanceof Promise` (native promise only).                                                                                                                                                                                   |
| `isPromiseLike`       | function | `PromiseLike<T>`           | An object with callable `then`, `catch`, _and_ `finally` — a bare `{ then }` thenable fails.                                                                                                                                  |
| `isIterable`          | function | `Iterable<T>`              | A `string`, or an object with a callable `Symbol.iterator`.                                                                                                                                                                   |
| `isAsyncIterable`     | function | `AsyncIterable<T>`         | An object with a callable `Symbol.asyncIterator`.                                                                                                                                                                             |
| `isArrayBuffer`       | function | `ArrayBuffer`              | `instanceof ArrayBuffer`.                                                                                                                                                                                                     |
| `isSharedArrayBuffer` | function | `SharedArrayBuffer`        | `instanceof SharedArrayBuffer` when the global exists.                                                                                                                                                                        |

### Array & typed-array guards

| Guard                 | Kind     | Narrows to          | Behavior                                                |
| --------------------- | -------- | ------------------- | ------------------------------------------------------- |
| `isArray`             | function | `readonly T[]`      | `Array.isArray` (no element check — see `arrayOf`).     |
| `isDataView`          | function | `DataView`          | `instanceof DataView`.                                  |
| `isArrayBufferView`   | function | `ArrayBufferView`   | `ArrayBuffer.isView` — any typed array _or_ `DataView`. |
| `isInt8Array`         | function | `Int8Array`         | `instanceof Int8Array`.                                 |
| `isUint8Array`        | function | `Uint8Array`        | `instanceof Uint8Array`.                                |
| `isUint8ClampedArray` | function | `Uint8ClampedArray` | `instanceof Uint8ClampedArray`.                         |
| `isInt16Array`        | function | `Int16Array`        | `instanceof Int16Array`.                                |
| `isUint16Array`       | function | `Uint16Array`       | `instanceof Uint16Array`.                               |
| `isInt32Array`        | function | `Int32Array`        | `instanceof Int32Array`.                                |
| `isUint32Array`       | function | `Uint32Array`       | `instanceof Uint32Array`.                               |
| `isFloat32Array`      | function | `Float32Array`      | `instanceof Float32Array`.                              |
| `isFloat64Array`      | function | `Float64Array`      | `instanceof Float64Array`.                              |
| `isBigInt64Array`     | function | `BigInt64Array`     | `instanceof BigInt64Array` when the global exists.      |
| `isBigUint64Array`    | function | `BigUint64Array`    | `instanceof BigUint64Array` when the global exists.     |

### Emptiness guards

| Guard              | Kind     | Narrows to                          | Behavior                                                          |
| ------------------ | -------- | ----------------------------------- | ----------------------------------------------------------------- |
| `isEmptyString`    | function | `''`                                | Strict `value === ''`.                                            |
| `isEmptyArray`     | function | `readonly []`                       | `isArray` with `length === 0`.                                    |
| `isEmptyObject`    | function | `Record<string \| symbol, never>`   | A record with zero string keys _and_ zero enumerable symbol keys. |
| `isEmptyMap`       | function | `ReadonlyMap<never, never>`         | `Map` with `size === 0`.                                          |
| `isEmptySet`       | function | `ReadonlySet<never>`                | `Set` with `size === 0`.                                          |
| `isNonEmptyString` | function | `string`                            | `isString` with `length > 0`.                                     |
| `isNonEmptyArray`  | function | `readonly [T, ...T[]]`              | `isArray` with `length > 0`.                                      |
| `isNonEmptyObject` | function | `Record<string \| symbol, unknown>` | A record with at least one string _or_ enumerable symbol key.     |
| `isNonEmptyMap`    | function | `ReadonlyMap<K, V>`                 | `Map` with `size > 0`.                                            |
| `isNonEmptySet`    | function | `ReadonlySet<T>`                    | `Set` with `size > 0`.                                            |

### Function & constructor guards

| Guard                      | Kind     | Narrows to                        | Behavior                                                                                                                                                                                                                                      |
| -------------------------- | -------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isFunction`               | function | `AnyFunction`                     | `typeof === 'function'`.                                                                                                                                                                                                                      |
| `isZeroArg`                | function | `ZeroArgFunction`                 | A function whose declared `.length` is `0`.                                                                                                                                                                                                   |
| `isAsyncFunction`          | function | `AnyAsyncFunction`                | `constructor?.name === 'AsyncFunction'` — a non-async fn returning a promise fails.                                                                                                                                                           |
| `isGeneratorFunction`      | function | generator function                | `constructor?.name === 'GeneratorFunction'`.                                                                                                                                                                                                  |
| `isAsyncGeneratorFunction` | function | async generator function          | `constructor?.name === 'AsyncGeneratorFunction'`.                                                                                                                                                                                             |
| `isZeroArgAsync`           | function | `ZeroArgAsyncFunction`            | `isFunction` + `isZeroArg` + `isAsyncFunction`.                                                                                                                                                                                               |
| `isZeroArgGenerator`       | function | zero-arg generator function       | `isZeroArg` + `isGeneratorFunction`.                                                                                                                                                                                                          |
| `isZeroArgAsyncGenerator`  | function | zero-arg async generator function | `isZeroArg` + `isAsyncGeneratorFunction`.                                                                                                                                                                                                     |
| `isConstructor`            | function | `AnyConstructor`                  | A value usable with `new` (probes `Reflect.construct`); backs `instanceOf`.                                                                                                                                                                   |
| `isInstance`               | function | `InstanceType<C>`                 | `value instanceof ctor`, contained via `attempt` (AGENTS §14) — a revoked `Proxy` or a `getPrototypeOf`-trap `Proxy` returns `false` rather than throwing. Backs every `instanceof`-based guard in this file and the `instanceOf` combinator. |

### Combinators

| Combinator       | Kind     | Builds a guard that…                                                                                                                                                                    |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arrayOf`        | function | accepts an array where **every** element passes the element guard.                                                                                                                      |
| `tupleOf`        | function | accepts an array of **exactly** `n` whose element _i_ passes `guards[i]`.                                                                                                               |
| `setOf`          | function | accepts a `Set` whose every entry passes the element guard.                                                                                                                             |
| `mapOf`          | function | accepts a `Map` whose every key / value pass the key / value guards.                                                                                                                    |
| `recordOf`       | function | accepts an **exact** record matching a `{ key: guard }` shape — optional keys via a key list or `true`; no extra keys.                                                                  |
| `iterableOf`     | function | accepts an iterable whose every yielded entry passes the element guard (consumes it).                                                                                                   |
| `literalOf`      | function | accepts a value `Object.is`-equal to one of the given string / number / boolean literals.                                                                                               |
| `instanceOf`     | function | accepts a value `instanceof` the constructor (a non-constructor yields a `false`-only guard, never a throw).                                                                            |
| `enumOf`         | function | accepts a `string` / `number` that is one of an enum object's values.                                                                                                                   |
| `keyOf`          | function | accepts a value that is an **own** key of the given object (`Object.hasOwn` — inherited keys are rejected).                                                                             |
| `pickOf`         | function | returns a new guard **shape** keeping only the listed keys (feed back into `recordOf`).                                                                                                 |
| `omitOf`         | function | returns a new guard **shape** dropping the listed keys.                                                                                                                                 |
| `andOf`          | function | passes iff **both** guards pass (type `A & B`).                                                                                                                                         |
| `orOf`           | function | passes iff **either** guard passes (type `A \| B`).                                                                                                                                     |
| `notOf`          | function | passes iff the guard fails (`Guard<unknown>`).                                                                                                                                          |
| `complementOf`   | function | passes iff the base passes **and** the excluded guard does not (`Exclude<…>`).                                                                                                          |
| `unionOf`        | function | passes iff **any** guard passes (variadic `orOf`; zero guards → always `false`).                                                                                                        |
| `intersectionOf` | function | passes iff **every** guard passes (variadic `andOf`; zero guards → always `true`).                                                                                                      |
| `whereOf`        | function | passes the base, then refines with a predicate (narrowing overload → `Guard<U>`); a throw is contained as a non-match.                                                                  |
| `lazyOf`         | function | defers building the real guard until first call — the sanctioned recursion entry point; a throw is contained as a non-match.                                                            |
| `transformOf`    | function | passes the base, projects the value, then validates the projection with a target guard; a throw is contained as a non-match.                                                            |
| `nullableOf`     | function | passes iff the value is `null` **or** the guard passes (`T \| null`; `undefined` fails).                                                                                                |
| `optionalOf`     | function | passes iff the value is `undefined` **or** the guard passes (`T \| undefined`; `null` fails) — the optional counterpart of `nullableOf`.                                                |
| `boundsOf`       | function | accepts a **finite** number within an inclusive `[min, max]` (absent bound = unconstrained; `NaN` / `±Infinity` rejected) — reused on a `.length` for string / array length refinement. |
| `matchOf`        | function | accepts a `string` matching a `RegExp` (refines `isString`).                                                                                                                            |
| `stringOf`       | function | accepts a `string` within optional `min` / `max` length and matching an optional `pattern`; bare `isString` when unconstrained.                                                         |

### Parsers

**Coercion policy.** Number and string coerce into each other bidirectionally by design: `parseNumber` accepts a numeric string (`'42'` → `42`) and `parseString` accepts a finite number, stringifying it (`42` → `'42'`) — use `isString` / `isFiniteNumber` directly when you need strict rejection with no coercion. Boolean is a coercion **sink only**, never a source: `parseBoolean` accepts `'true'` / `'false'` / `'1'` / `'0'` / `1` / `0` and coerces them TO a boolean, but `parseNumber` and `parseString` both reject booleans outright — a boolean never coerces into a number or string. `'1'` meaning "the number one" and `'1'` meaning "true" are different domains; only the boolean parser treats the numeric/string forms as booleans.

| Parser                | Kind     | Returns                                                                                                        |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `parseString`         | function | a `string` (a finite number coerces to its decimal string), else `undefined`. Pairs with `isString`.           |
| `parseNumber`         | function | a finite `number` (a numeric string coerces), else `undefined`. Pairs with `isFiniteNumber`.                   |
| `parseInteger`        | function | a finite integer (fractional values rejected), else `undefined`. Pairs with `isInteger`.                       |
| `parseBoolean`        | function | a `boolean` (`'true'`/`'false'`/`'1'`/`'0'`/`1`/`0` coerce), else `undefined`. Pairs with `isBoolean`.         |
| `parseRecord`         | function | the input record by reference, else `undefined`. Pairs with `isRecord`.                                        |
| `parseArray`          | function | the input array by reference (optionally element-guarded), else `undefined`. Pairs with `isArray` / `arrayOf`. |
| `parseEnum`           | function | the matched literal (`Object.is`, string / number / boolean), else `undefined`. Pairs with `literalOf`.        |
| `parseNull`           | function | `null` on a successful parse (every other value, including `undefined`, → `undefined`). Pairs with `isNull`.   |
| `parseJSONValue`      | function | a cycle-safe `JSONValue` — a **deep** gate via `isJSONValue` (walks the whole tree), else `undefined`.         |
| `parseStringField`    | function | `parseString` of a record field read by key or nested `FieldPath`.                                             |
| `parseNumberField`    | function | `parseNumber` of a record field read by key or nested `FieldPath`.                                             |
| `parseIntegerField`   | function | `parseInteger` of a record field read by key or nested `FieldPath`.                                            |
| `parseBooleanField`   | function | `parseBoolean` of a record field read by key or nested `FieldPath`.                                            |
| `parseRecordField`    | function | `parseRecord` of a record field read by key or nested `FieldPath`.                                             |
| `parseArrayField`     | function | `parseArray` of a record field read by key or nested `FieldPath`.                                              |
| `parseEnumField`      | function | `parseEnum` of a record field read by key or nested `FieldPath`.                                               |
| `parseNullField`      | function | `parseNull` of a record field read by key or nested `FieldPath`.                                               |
| `parseJSONValueField` | function | `parseJSONValue` of a record field read by key or nested `FieldPath` — deep-gates that field's whole subtree.  |

### JSON

The lazy, safe JSON boundary — flat primitives, the recursive `JSONValue` metadata contract, and the string entry point. `isJSONValue` is the shipped cycle-safe total guard for JSON data; `isJSONObject` / `isJSONSchema` validators and the ~50-field `JSONSchemaDefinition` remain deliberately omitted. Compose narrower shapes from the combinators, gate untrusted strings with `parseJSONAs`, and read a parsed blob lazily with the `parse*Field` readers.

| API                 | Kind      | Summary                                                                                            |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `isJSONPrimitive`   | function  | Guard: `null`, a string, a **finite** number, or a boolean — real JSON has no `NaN` / `±Infinity`. |
| `isJSONValue`       | function  | Guard: a cycle-free JSON tree; rejects functions, Dates, class instances, `NaN`, and `±Infinity`.  |
| `parseJSON`         | function  | `JSON.parse` that returns `undefined` instead of throwing; the result is `unknown` — narrow it.    |
| `parseJSONAs`       | function  | Parse a JSON string, then validate the result with a guard you bring → `T \| undefined`.           |
| `JSON_SCHEMA_TYPES` | const     | The seven JSON Schema `type` names, frozen — compose with `literalOf(...)` / `parseEnum(...)`.     |
| `JSONPrimitive`     | type      | `string \| number \| boolean \| null` — a flat JSON leaf.                                          |
| `JSONValue`         | type      | recursive JSON data: a primitive, readonly array, or readonly string-keyed record.                 |
| `JSONSchemaType`    | type      | one of the seven JSON Schema `type` names.                                                         |
| `JSONSchema`        | interface | a lean JSON Schema fragment — the keywords `compileSchema` emits and `rawShape` embeds.            |

### Helper

| Helper                  | Kind     | Behavior                                                                                                                                                                                                                   |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempt`               | function | The sanctioned never-throw boundary — runs a callback and returns a `Result<T>`: `{ success: true, value }` on return, `{ success: false, error }` (wrapped in an `Error` if not already one) on throw.                    |
| `enumerableSymbolCount` | function | Count of a value's own enumerable **symbol** keys — backs `isEmptyObject` / `isNonEmptyObject` (string-key counts alone miss symbol-keyed records).                                                                        |
| `resolveField`          | function | Total lookup of a (possibly nested) field from a record by a `FieldPath` — a single string is **one** key (no dot-split); an array descends nested objects. Returns `undefined` off-path. Backs the `parse*Field` parsers. |
| `seededRandom`          | function | Build a deterministic mulberry32 `RandomFunction` from a numeric seed — the default seed source for `compileGenerator` / `createContract`'s `generate`.                                                                    |
| `schemaToParameters`    | function | Narrow a compiled `JSONSchema` to the open tool-parameters record via `isRecord` (§14, never `as`) — the single sanctioned crossing from a compiled contract schema, written once rather than per call site.               |

### Types

| Type                     | Kind      | Shape                                                                                                                                        |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Failure`                | interface | `{ success: false, error: E }` — the discriminated failure branch of a `Result`.                                                             |
| `FieldPath`              | type      | `string \| readonly string[]` — a single key, or a path descending nested records; consumed by `resolveField` and the `parse*Field` parsers. |
| `Guard`                  | type      | `(value: unknown) => value is T` — the core predicate.                                                                                       |
| `GuardType`              | type      | extracts `T` from a `Guard<T>`.                                                                                                              |
| `GuardsShape`            | type      | `Readonly<Record<string, Guard<unknown>>>` — a `recordOf` shape.                                                                             |
| `FromGuards`             | type      | the readonly record type a `GuardsShape` validates.                                                                                          |
| `OptionalFromGuards`     | type      | `FromGuards` with the listed keys made optional.                                                                                             |
| `TupleFromGuards`        | type      | the readonly tuple type a `tupleOf` guard list validates.                                                                                    |
| `UnionToIntersection`    | type      | distributes a union into an intersection (powers `IntersectionFromGuards`).                                                                  |
| `IntersectionFromGuards` | type      | the intersection type a guard list validates.                                                                                                |
| `Parser`                 | type      | `(value: unknown) => T \| undefined` — the parser shape.                                                                                     |
| `Result`                 | type      | `Success<T> \| Failure<E>` — discriminated union for operations that can succeed or fail without throwing.                                   |
| `Success`                | interface | `{ success: true, value: T }` — the discriminated success branch of a `Result`.                                                              |
| `AnyConstructor`         | type      | `new (...args: unknown[]) => T`.                                                                                                             |
| `AnyFunction`            | type      | `(...args: unknown[]) => unknown`.                                                                                                           |
| `AnyAsyncFunction`       | type      | `(...args: unknown[]) => Promise<unknown>`.                                                                                                  |
| `ZeroArgFunction`        | type      | `() => unknown`.                                                                                                                             |
| `ZeroArgAsyncFunction`   | type      | `() => Promise<unknown>`.                                                                                                                    |

### Shape builders

Declarative constructors for the `ContractShape` union (`src/core/shapers.ts`). One shape compiles into a guard, parser, schema, and generator (see the compilers, below).

| Builder         | Kind     | Builds                                                                                                                                                                                                                                                                                |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stringShape`   | function | a string shape with optional `min` / `max` / `pattern`.                                                                                                                                                                                                                               |
| `numberShape`   | function | a numeric shape with optional bounds.                                                                                                                                                                                                                                                 |
| `integerShape`  | function | a numeric shape fixed to integers (`integer: true`).                                                                                                                                                                                                                                  |
| `booleanShape`  | function | a boolean shape.                                                                                                                                                                                                                                                                      |
| `nullShape`     | function | a shape accepting only `null`.                                                                                                                                                                                                                                                        |
| `literalShape`  | function | a shape accepting one of fixed literals from a `values` array, with optional `description` — `Infer` is their union.                                                                                                                                                                  |
| `arrayShape`    | function | an array shape over an element shape, with optional length bounds.                                                                                                                                                                                                                    |
| `objectShape`   | function | an object shape from a property map (closed to unknown keys by default).                                                                                                                                                                                                              |
| `recordShape`   | function | an open object (dictionary) whose values all match one shape — `Infer` is `Readonly<Record<string, Infer<value>>>`.                                                                                                                                                                   |
| `unionShape`    | function | a union of variant shapes (`anyOf`; the compiled guard/parser accept any matching variant).                                                                                                                                                                                           |
| `oneOfShape`    | function | a union that emits `oneOf`; the compiled guard/parser enforce EXACTLY one variant match — a value matching two-or-more variants (or none) is rejected / parses to `undefined`, no coercion fallback for ambiguous input. Prefer `unionShape` when overlapping matches are acceptable. |
| `optionalShape` | function | wraps a shape so it may be absent (an optional object field).                                                                                                                                                                                                                         |
| `nullableShape` | function | wraps a shape so it may be `null`.                                                                                                                                                                                                                                                    |
| `jsonShape`     | function | a JSON passthrough shape — validates the value is real JSON (`isJSONValue`); the sound counterpart of `rawShape`.                                                                                                                                                                     |
| `rawShape`      | function | embeds a raw `JSONSchema` fragment — the guard accepts any value.                                                                                                                                                                                                                     |

### Shape types

| Type                  | Kind      | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ContractShape`       | type      | the discriminated union of every shape descriptor.                                                                                                                                                                                                                                                                                                                                                                                         |
| `StringShape`         | interface | `{ type: 'string', min?, max?, pattern?, … }`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `NumberShape`         | interface | `{ type: 'number', min?, max?, integer?, … }`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `BooleanShape`        | interface | `{ type: 'boolean', … }`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `NullShape`           | interface | `{ type: 'null', … }`.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `LiteralShape`        | interface | `{ type: 'literal', values, … }`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ArrayShape`          | interface | `{ type: 'array', items, min?, max?, … }`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ObjectShape`         | interface | `ObjectShape<P, A>` — `{ type:'object', properties:P, additionalProperties?:A, … }`; `A` carries the open-value shape into `Infer`.                                                                                                                                                                                                                                                                                                        |
| `UnionShape`          | interface | `{ type: 'union', variants, mode?, … }`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `OptionalShape`       | interface | `{ type: 'optional', inner }`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `NullableShape`       | interface | `{ type: 'nullable', inner }`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `JSONShape`           | interface | `{ type: 'json', … }` — accepts any JSON value (`isJSONValue`).                                                                                                                                                                                                                                                                                                                                                                            |
| `RawShape`            | interface | `{ type: 'raw', schema }`.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Infer`               | type      | the static type a `ContractShape` describes. Inferring the full widened `ContractShape` union bails out lazily to `unknown` (the union is a type-level fixed point); pass shapes narrowly for exact inference.                                                                                                                                                                                                                             |
| `InferObject`         | type      | `Infer` of an object shape — required + optional keys, plus an index signature folded from `additionalProperties`. A pure record (no fixed properties) folds via `InferIndex` and stays precisely typed; a mixed shape (fixed properties plus an open, shape-typed tail) folds via `InferOpenIndex` — named keys keep their declared types, extra keys infer as `unknown` (the runtime guard still validates them against the tail shape). |
| `InferIndex`          | type      | the index-signature contribution of a pure record shape's `additionalProperties` (empty `properties`, the `recordShape` case): `false` → none, `true` → `unknown`-valued, a shape → its own `Infer`, precisely typed.                                                                                                                                                                                                                      |
| `InferOpenIndex`      | type      | the index-signature contribution of a MIXED object shape's `additionalProperties` (non-empty `properties` plus an open tail): `false` → none, `true` → `unknown`-valued; a shape widens to `{ readonly [k: string]: unknown }` rather than the shape's own `Infer`, since a typed index would collapse a differently-typed fixed property to `never` and make the object unconstructable.                                                  |
| `InferMutable`        | type      | `Infer<S>` with `readonly` stripped at the TOP LEVEL only — a shallow strip. Nested object/array properties remain readonly.                                                                                                                                                                                                                                                                                                               |
| `InferUnion`          | type      | `Infer` of a union shape — the union of its variants.                                                                                                                                                                                                                                                                                                                                                                                      |
| `StringShapeOptions`  | interface | options for `stringShape`.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `NumberShapeOptions`  | interface | options for `numberShape` / `integerShape`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `BooleanShapeOptions` | interface | options for `booleanShape`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `NullShapeOptions`    | interface | options for `nullShape`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `JSONShapeOptions`    | interface | options for `jsonShape`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `LiteralShapeOptions` | interface | options for `literalShape`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ArrayShapeOptions`   | interface | options for `arrayShape`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ObjectShapeOptions`  | interface | options for `objectShape` — generic in `A` (the `additionalProperties` shape).                                                                                                                                                                                                                                                                                                                                                             |
| `RecordShapeOptions`  | interface | options for `recordShape`.                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Compilers

Turn one `ContractShape` into the four lockstep outputs (`src/core/compilers.ts`). The individual compilers return untyped runtime functions; `createContract` is the typed entry point — its `is` / `parse` / `generate` carry `Infer<S>` by inferring once, at the boundary (so the recursion stays cheap). `compileGuard` / `compileParser` reuse the existing combinators and parsers rather than re-implementing them, and apply each leaf's refinements (`min` / `max` / `pattern`) through the **same** combinators — `stringOf` for a string's length/pattern and `boundsOf` for a number's value and an array's length — so a compiled parser and guard enforce the same constraints and can never drift.

| API                 | Kind      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateShape`     | function  | shape → `void` — a pure recursive fail-fast prepass (§12): throws on `min > max`, an empty integer range, an empty literal/union, a literal shape containing a non-finite (`NaN` / `Infinity` / `-Infinity`) number value, or an `optionalShape` anywhere but a direct object-property value. `createContract` runs it first.                                                                                                                                                                                                                                                                                  |
| `compileGuard`      | function  | shape → a `Guard<Infer<S>>` (generic in the shape; reuses `recordOf` / `arrayOf` / `unionOf` / `literalOf` / `nullableOf` / `whereOf`; refines leaves via `stringOf` / `boundsOf`).                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `compileParser`     | function  | shape → a `Parser<Infer<S>>` (generic in the shape) that coerces (reuses `parseString` / `parseInteger` / `parseRecord` / …) **then** re-applies each leaf's refinement (the same `stringOf` / `boundsOf`), so a non-`undefined` parse satisfies the guard. An `anyOf`-mode union (`unionShape`) first tries an identity pass (a guard-valid value is returned unchanged) before falling back to ordered per-variant coercion; a `oneOf`-mode union (`oneOfShape`) instead requires the raw value to guard-match EXACTLY one variant, with no coercion fallback for an ambiguous (zero- or multi-match) input. |
| `compileSchema`     | function  | shape → a `JSONSchema` — emission over the finite shape; it never inspects a runtime value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `compileGenerator`  | function  | shape + a `RandomFunction` → `Infer<S>` (generic in the shape); throws on an empty literal/union, a pattern-constrained `stringShape` it cannot satisfy, or a `rawShape` (its embedded schema is arbitrary and cannot be auto-generated) (§12). Honors an array's `max: 0` and a `numberShape`'s integer fractional bounds.                                                                                                                                                                                                                                                                                    |
| `createContract`    | function  | shape → a typed `ContractInterface<Infer<S>>` bundling `schema` / `is` / `parse` / `generate`; runs `validateShape` first, so a malformed shape throws immediately rather than compiling a silently-wrong contract.                                                                                                                                                                                                                                                                                                                                                                                            |
| `ContractInterface` | interface | the compiled-contract bundle — `{ schema, is, parse, generate }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RandomFunction`    | type      | `() => number` in `[0, 1)` — the seed source for `generate`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

> A shape nesting a `rawShape` or a pattern-constrained `stringShape` still compiles cleanly (`compileSchema` / `compileGuard` / `compileParser` all succeed) — only `generate()` throws at CALL time, once it walks down into that leaf, because a `rawShape`'s embedded schema is arbitrary and a pattern the generator cannot satisfy has no auto-generatable sample.

### Reporting

The diagnostic counterpart of `compileGuard` / `compileParser`: instead of a `boolean` or a coerced value, `compileReporter` returns every structured `Fault` a value has against a shape — MIRROR-PARSE semantics, so it reuses the exact leaf parsers/guards `compileParser` uses and the soundness invariant `explain(v).length === 0 ⟺ parse(v) !== undefined` holds structurally (`explain` mirrors `parse`'s coercion leniency, not the stricter `is`).

| API               | Kind     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileReporter` | function | shape + value (+ optional path) → `readonly Fault[]`, self-recursive. A leaf that fails to coerce reports one `'type'` fault; a coercible leaf that violates a refinement reports one `'constraint'` fault per violated refinement. An absent required object key reports `'missing'`; a present key recurses. Closed-object extras never fault (parse drops them); a constraining `additionalProperties` shape recurses extras against it. An `anyOf` union with no matching variant reports one `'variant'` summary plus the closest variant's own faults (fewest faults; ties favor the lowest index); a `oneOf` union reports `'oneOf'` with the raw guard-match count (0 also appends the closest variant's faults, ≥2 stands alone). Faults are collected in stable pre-order and capped at `FAULT_LIMIT`; a hostile getter or throwing `Proxy` trap is contained via `attempt` and surfaces as one top-level type fault, never a throw. |
| `shapeToKind`     | function | shape → `FaultKind` — projects a `ContractShape` to the kind it describes (`numberShape` → `'integer'` when `integer: true`, else `'number'`; `optionalShape` / `nullableShape` project through their inner shape; `rawShape` → `'json'`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `preview`         | function | value → `string` — a short, TOTAL preview for a `Fault`'s `received` field. A primitive renders as its literal (a string is `JSON.stringify`-escaped and clipped to `PREVIEW_LIMIT`); everything else (an object, array, function, class instance) renders as its bare `typeof` tag — NEVER traversed or stringified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `FAULT_LIMIT`     | const    | `64` — the maximum `Fault` entries a single `explain` report ever returns, frozen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PREVIEW_LIMIT`   | const    | `64` — the maximum character length of a `preview`-rendered string before it is clipped with a trailing `…`, frozen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Fault`           | type     | discriminated union on `reason`: `'type'` (`{ path, expected, received }`), `'missing'` (`{ path, expected }`), `'constraint'` (`{ path, expected, constraint, limit?, received }`), `'variant'` (`{ path, variants }`), `'oneOf'` (`{ path, matched }`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `FaultKind`       | type     | `'string' \| 'number' \| 'integer' \| 'boolean' \| 'null' \| 'literal' \| 'array' \| 'object' \| 'union' \| 'json'` — the kind a fault expected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `FaultConstraint` | type     | `'min' \| 'max' \| 'pattern' \| 'integer'` — the refinement a `'constraint'` fault violates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed (its `readonly` data members, `schema` / `is`, stay in the Surface row above). `ContractInterface` has no implementing class: `createContract` builds it as a plain object whose shape conforms to the interface exactly, so the table below is its per-instance surface (AGENTS §22).

#### `ContractInterface`

| Method     | Returns            | Behavior                                                                                                                                                                                 |
| ---------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`    | `T \| undefined`   | Coerce a value to the contract's type (`'36'` → `36`) **and** enforce every leaf refinement (`min` / `max` / `pattern`), or `undefined`. A non-`undefined` result always satisfies `is`. |
| `explain`  | `readonly Fault[]` | Report every structured parse fault a value has, mirroring `parse`'s coercion (not `is`). Empty means valid: `explain(v).length === 0 ⟺ parse(v) !== undefined`.                         |
| `generate` | `T`                | Deterministic seed data from an optional `RandomFunction` (defaults seeded).                                                                                                             |

## Contract

These invariants hold across `src/core` ↔ `contract.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `type` row in the `## Surface` tables is a real export of the contract source tree, and every contract-module export appears as a Surface row — exhaustive, both directions (AGENTS §22). Adding, renaming, or removing a guard breaks the parity gate until the doc is reconciled.
2. **Guards are total (§14).** Every guard takes one `unknown`, returns a `boolean` type predicate, and **never throws** — adversarial input yields `false`. The only deferral is `lazyOf`, whose thunk runs per call; `whereOf` / `lazyOf` / `transformOf` contain a callback throw as a non-match via the core `attempt` helper.
3. **Parse ↔ guard soundness (§14).** Each standalone leaf parser (`parseString`, …) pairs with the guard for its **output type**: a guard-valid input is returned unchanged (by identity, never rejected), and every non-`undefined` output satisfies that type guard. Coercion of otherwise-invalid inputs is a bonus on top, not a violation. The **compiled** contract goes further: `compileParser` (and thus `createContract`'s `parse`) re-applies every leaf REFINEMENT after coercion through the same combinators (`stringOf` / `boundsOf`) `compileGuard` uses — so a non-`undefined` `contract.parse` always satisfies `contract.is`, refinements (`min` / `max` / `pattern`) included, and the two cannot drift.
4. **Types are the source of truth.** `Guard`, `Parser`, and the guard-shape types are declared in [`types.ts`](../../src/core/types.ts) first; guards and parsers conform to them, never the reverse.
5. **`createContract` validates before it compiles (§12).** `validateShape` runs as a fail-fast prepass — a malformed shape (`min > max`, an empty integer range, an empty literal/union, a literal shape holding a non-finite number value, or an `optionalShape` placed anywhere but a direct object-property value) throws immediately instead of silently producing a wrong guard, parser, schema, or generator. `optionalShape` is legal in exactly one position: as the value of an object property.
6. **DOC ↔ SOURCE method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class exposes the same public methods, no more (AGENTS §22). A renamed / added / removed method breaks the gate until the table is reconciled.

What ships for JSON is the **flat, lazy boundary** in the `### JSON` table above. The **deep** recursive JSON value / object / JSON-Schema validators (and the ~50-field `JSONSchemaDefinition`) are intentionally **not** part of this surface — keeping them total on cyclic / deep input needs the cycle-and-depth machinery this template avoids. Build only the piece you need from the combinators, where you need it.

## Patterns

### Narrowing `unknown`

```ts
import { isFiniteNumber, isRecord, isString } from '@src/core'

function describe(value: unknown): string {
	if (isString(value)) return value.toUpperCase() // value: string
	if (isFiniteNumber(value)) return value.toFixed(2) // value: number (no NaN / Infinity)
	if (isRecord(value)) return Object.keys(value).join(',') // value: Record<string, unknown>
	return 'other'
}
```

### Composing with `recordOf` / `arrayOf` / `unionOf`

Build a complex guard out of leaf guards — never hand-roll the structural walk. `recordOf` is **exact** (extra keys fail), and the shape it took is reusable: `pickOf` / `omitOf` derive a related guard from it without restating fields.

```ts
import { arrayOf, isNumber, isString, literalOf, pickOf, recordOf, unionOf } from '@src/core'

const userShape = {
	id: isString,
	age: isNumber,
	role: literalOf('admin', 'member', 'guest'),
	tags: arrayOf(isString),
}
const isUser = recordOf(userShape)
isUser({ id: 'u1', age: 36, role: 'admin', tags: [] }) // true
isUser({ id: 'u1', age: 36, role: 'admin', tags: [], extra: true }) // false (exact — no extra keys)

// Derive a narrower guard from the same shape — no field repetition.
const isUserRef = recordOf(pickOf(userShape, ['id', 'role'])) // Guard<{ id: string; role: 'admin' | … }>

const isId = unionOf(isString, isNumber) // Guard<string | number>
```

### Recursive guards with `lazyOf`

`lazyOf` is the sanctioned recursion entry point — the thunk defers construction so a self-referential guard never references itself before it exists.

```ts
import type { Guard } from '@src/core'
import { arrayOf, isNumber, lazyOf, orOf } from '@src/core'

// A number-tree: a number, or an array of trees.
const isNumberTree: Guard<unknown> = orOf(isNumber, arrayOf(lazyOf(() => isNumberTree)))
isNumberTree([1, [2, 3], 4]) // true
isNumberTree(['x']) // false
```

### Guards narrow, parsers coerce

```ts
import { isString, parseIntegerField, parseStringField } from '@src/core'

isString(36) // false — a guard never converts

// `*Field` parsers resolve a nested path (a single string is ONE key, no dot-split).
const data = { user: { profile: { name: 'Ada', age: '36' } } }
parseStringField(data, ['user', 'profile', 'name']) // 'Ada'
parseIntegerField(data, ['user', 'profile', 'age']) // 36  (coerced from '36')
```

### Parsing JSON safely

The boundary is `parseJSONAs` (validate a known shape in one step) or `parseJSON` + the `parse*Field` readers (parse once, then pull only what you need — never walking the whole document).

```ts
import {
	arrayOf,
	isString,
	JSON_SCHEMA_TYPES,
	parseEnumField,
	parseJSON,
	parseJSONAs,
	parseRecord,
	parseRecordField,
	recordOf,
} from '@src/core'

// 1. Validate a known shape — only the guard's shape is walked.
const isConfig = recordOf({ host: isString, tags: arrayOf(isString) })
parseJSONAs('{"host":"localhost","tags":["a"]}', isConfig) // { host: 'localhost', tags: ['a'] }
parseJSONAs('nope', isConfig) // undefined — never throws

// 2. Or parse once, then read fields lazily — no full-tree validation, including JSON Schema.
const blob = parseRecord(parseJSON('{"schema":{"type":"object","properties":{}}}'))
if (blob) {
	parseEnumField(blob, ['schema', 'type'], JSON_SCHEMA_TYPES) // 'object' (a JSONSchemaType)
	parseRecordField(blob, ['schema', 'properties']) // {} (a nested record), or undefined
}
```

### Declaring a shape

```ts
import type { Infer } from '@src/core'
import {
	arrayShape,
	integerShape,
	literalShape,
	objectShape,
	optionalShape,
	stringShape,
} from '@src/core'

const user = objectShape({
	name: stringShape({ min: 1 }),
	age: integerShape({ min: 0, max: 120 }),
	role: literalShape(['admin', 'member', 'guest']),
	tags: arrayShape(stringShape()),
	bio: optionalShape(stringShape()), // may be absent
})

type User = Infer<typeof user>
// { readonly name: string; readonly age: number; readonly role: 'admin' | 'member' | 'guest';
//   readonly tags: readonly string[]; readonly bio?: string }
```

The compilers turn this one declaration into a guard, parser, JSON Schema, and generator — see the compilers section.

### Compiling a contract

`createContract` is the typed entry point — one shape in, the four lockstep outputs out, on a single object.

```ts
import { createContract, integerShape, objectShape, seededRandom, stringShape } from '@src/core'

const user = createContract(objectShape({ name: stringShape({ min: 1 }), age: integerShape() }))

user.is({ name: 'Ada', age: 36 }) // true — a typed guard (narrows to Infer<typeof shape>)
user.parse({ name: 'Ada', age: '36' }) // { name: 'Ada', age: 36 } — coerces, or undefined
user.parse({ name: '', age: 36 }) // undefined — '' violates name min:1 (parse enforces refinements, like is)
user.explain({ name: '', age: 36 }) // [{ reason: 'constraint', path: ['name'], expected: 'string', constraint: 'min', limit: 1, received: '""' }]
user.schema // { type: 'object', properties: { … }, required: ['name', 'age'], additionalProperties: false }
user.generate(seededRandom(42)) // reproducible seed data; omit the arg for a wall-clock-seeded source
```

One declaration; the guard, parser, schema, and generator never drift because they're all derived from it — and `parse` rejects exactly what `is` rejects (refinements included).

### Practices

- **Guards narrow, parsers coerce.** `isNumber('36')` is `false`. Need `'36'` → `36`? Use `parseNumber`.
- **`isNumber` accepts `NaN`; reach for `isFiniteNumber`** (or `isInteger`) when `NaN` / `±Infinity` must be rejected.
- **`isObject` is broad, `isRecord` is strict.** Arrays and class instances satisfy `isObject` but fail `isRecord` — use `isRecord` for plain config / JSON-style objects.
- **`recordOf` is exact.** Extra keys fail by default; declare optional keys with a key list or `true`, and derive related shapes with `pickOf` / `omitOf`.
- **Use `lazyOf` for self-referential guards** — never reference a guard inside its own definition without it.
- **JSON is lazy here.** The flat `isJSONPrimitive` and the `parseJSON` / `parseJSONAs` boundary ship; the deep recursive JSON / JSON-Schema validators do not. Validate just the shape you need (`parseJSONAs` with a composed guard), and read a parsed blob field-by-field with the `parse*Field` readers — never walk a whole document.

## Tests

- [`tests/src/core/validators.test.ts`](../../tests/src/core/validators.test.ts) — per-guard behavior (incl. `isJSONPrimitive`) + parse ↔ guard soundness corpus.
- [`tests/src/core/combinators.test.ts`](../../tests/src/core/combinators.test.ts) — combinator semantics (`recordOf` exactness, `tupleOf` arity, `lazyOf` per-call thunk, `whereOf` / `transformOf` throw-containment, `boundsOf` / `matchOf` / `stringOf` leaf refinements, …).
- [`tests/src/core/parsers.test.ts`](../../tests/src/core/parsers.test.ts) — coercion + soundness pairings + nested-field reads.
- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — `enumerableSymbolCount`, `seededRandom`, and `schemaToParameters` (a compiled-contract record schema passes through by reference; a non-record yields `undefined`).
- [`tests/src/core/shapers.test.ts`](../../tests/src/core/shapers.test.ts) — shape builders + `Infer` derivation.
- [`tests/src/core/compilers.test.ts`](../../tests/src/core/compilers.test.ts) — `compileSchema` / `compileGuard` / `compileParser` / `compileGenerator` + `createContract` round-trip, incl. parse↔guard refinement parity (out-of-bounds leaves parse to `undefined`).
- [`tests/src/core/reporters.test.ts`](../../tests/src/core/reporters.test.ts) — `compileReporter` soundness matrix (`explain` empty ⟺ `parse` defined), nested/array/union/oneOf fault shapes, hostile-input containment (Proxy, huge array/string, cycles), and the `createContract` `explain` wiring.

## See also

- [`AGENTS.md`](../../AGENTS.md) — the rules; §14 guard totality + parse↔guard soundness, §22 documentation-as-contracts.
- [`README.md`](../README.md) — the guides index.
