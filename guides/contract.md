# Contract

> The zero-dependency contract toolkit — runtime type guards, guard combinators,
> coerce-and-extract parsers, and a shape DSL that compiles one declaration into a JSON
> Schema, a guard, a parser, a strict audit, a parse report, and a generator, every one of
> them derived from a single owned snapshot of that declaration.

Validation is where untrusted data — an HTTP body, a parsed JSON blob, a tool argument — crosses into typed code. This module is that crossing: guards turn `unknown` into a narrowed `T` without leaking a hostile input's throw, while parsers return a typed value or `undefined` for readable invalid input. Here a **reader** is a public operation whose documented result depends on inspecting a caller-owned container, and an **advertised read** is the exact property, key, element, iteration, or reflection that operation says it observes. REQUIRED readers refuse an incomplete advertised read with a coded `ContractError`; unreadability never becomes their absence or accept-anything answer. Total guards instead answer `false`; optional lookup/coercion readers (`enumerableKeys`, `resolveField`, `parseArray`, `parseEnum`, and the `parse*Field` family) deliberately answer `undefined`. Schema inversion widens readable unsupported, depth-exhausted, or cyclic nodes to `rawShape({})`, but a traversal that fails is refused as unreadable rather than widened. **READABLE** therefore means every advertised read for the operation being discussed completes; **STABLE** means those observable reads also keep the same answers across separate calls. The module deliberately ships **flat primitives** instead of a full schema framework — every guard is a one-argument total function and parsers coerce-or-bail rather than collect errors. The `parseJSON` / `parseJSONAs` text boundary stays lazy by default; `isJSONValue`, `parseJSONValue`, `cloneJSONValue`, and the record-root `cloneJSONRecord` are explicit deep whole-tree operations. Recursive contracts remain opt-in through the shape DSL, where the tree is finite and developer-authored. Its source is [`src/core`](../src/core), surfaced through the `@src/core` barrel.

## Surface

A guard is the `Guard<T>` type from [`types.ts`](../src/core/types.ts):

```ts
type Guard<T> = (value: unknown) => value is T
```

Every guard takes one `unknown`, returns a `boolean` TypeScript reads as a type predicate, and **never throws** — a value that doesn't fit is `false`, even on adversarial input (cycles, hostile prototypes). Totality is universal (`.claude/rules/patterns.md` § Validation and contracts), so any guard is safe to call on anything at any trust boundary. **Purity is not.** It holds for every guard this module builds out of its own reads, and it cannot hold for any combinator that runs YOUR code inside the guard body. The rule: **any combinator that runs code you supplied inherits whatever that code does** — whether you hand it a callback directly, as `whereOf`, `lazyOf` and `transformOf` do, or hand it a guard it composes. If you passed it, its behaviour is yours. Such a guard is exactly as pure and as order-independent as the callback you hand it: a stateful predicate that counts its own calls answers `true` and then `false` for the SAME argument, and one that appends to a log leaves the write behind. Containment keeps it total either way; what it cannot keep is "function of its argument alone". Hand pure callbacks if you want the whole family's guarantee, and read "in any order" as a promise the guards this module builds from its own reads make.

Sibling families, each with its own job:

- **Validators** (`is*`) answer "_is_ this value a `T`?" — a boolean predicate that narrows in place. No coercion, no transform.
- **Combinators** (`*Of`) build a fresh `Guard<…>` out of existing guards (and accept any bare `(value: unknown) => boolean` predicate), so a complex guard is composed, never hand-written.
- **Parsers** (`parse*`) answer "give me a `T` _or_ `undefined`" for readable input — they coerce (`'36'` → `36`) and return the typed value or `undefined`. `parseRecord` and `parseJSONValue` throw the shared coded read refusal when traversal fails, so a caller can distinguish invalidity from unreadability. Each parser forms a **sound** pair with the guard for its output type (`.claude/rules/patterns.md` § Validation and contracts): a guard-valid readable input is returned unchanged, and every non-`undefined` output satisfies that guard, so you can parse-then-trust.

The `*Field` parsers read a (possibly nested) record field through a `FieldPath` (`string | readonly string[]`, in [`src/core/types.ts`](../src/core/types.ts)) — a single string is **one** key (no dot-splitting); an array descends own properties of nested objects/arrays through the `resolveField` core helper. The root must satisfy `isRecord`, and inherited properties are rejected at every segment. This is deliberate: a field reader receives a record, so accepting a root the module's record guard rejects or a value visible only through its prototype would contradict that contract; arrays remain supported as nested containers because indexed path segments are their own properties. The `whereOf` / `lazyOf` / `transformOf` combinators run caller-supplied callbacks _inside_ a guard body; they contain any throw through the core `attempt` helper, so even a guard that runs your code stays total and returns `false` rather than propagating.

In a guard table a `Shape` cell holds the type the guard narrows to.

### Primitive & null-ish guards

| Guard                  | Kind     | Shape             | Summary                                                                                               |
| ---------------------- | -------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `isNull`               | function | `null`            | Determines whether a value is `null`.                                                                 |
| `isUndefined`          | function | `undefined`       | Determines whether a value is `undefined`.                                                            |
| `isDefined`            | function | `T`               | Determines whether a value is defined (neither `null` nor `undefined`).                               |
| `isString`             | function | `string`          | Determines whether a value is a string.                                                               |
| `isNumber`             | function | `number`          | Determines whether a value is a number.                                                               |
| `isFiniteNumber`       | function | `number`          | Determines whether a value is a finite number (excludes `NaN` and `±Infinity`).                       |
| `isInteger`            | function | `number`          | Determines whether a value is a finite integer (excludes `NaN`, `±Infinity`, and fractional numbers). |
| `isNonNegativeNumber`  | function | `number`          | Determines whether a value is a finite primitive number at or above positive zero.                    |
| `isNonNegativeInteger` | function | `number`          | Determines whether a value is a non-negative finite primitive integer.                                |
| `isBoolean`            | function | `boolean`         | Determines whether a value is a boolean.                                                              |
| `isLiteralValue`       | function | `LiteralValue`    | Determines whether a value belongs to the string, number, or boolean literal domain.                  |
| `isTrue`               | function | `true`            | Determines whether a value is exactly `true`.                                                         |
| `isFalse`              | function | `false`           | Determines whether a value is exactly `false`.                                                        |
| `isBigInt`             | function | `bigint`          | Determines whether a value is a bigint.                                                               |
| `isSymbol`             | function | `symbol`          | Determines whether a value is a symbol.                                                               |
| `isNullableString`     | function | `string \| null`  | Determines whether a value is a string or `null`.                                                     |
| `isNullableNumber`     | function | `number \| null`  | Determines whether a value is a number or `null` (the number may be `NaN` / `±Infinity`).             |
| `isNullableBoolean`    | function | `boolean \| null` | Determines whether a value is a boolean or `null`.                                                    |

### Structural & collection guards

| Guard                 | Kind     | Shape                      | Summary                                                                                                          |
| --------------------- | -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `isObject`            | function | `object`                   | Determines whether a value is a non-null object.                                                                 |
| `isRecord`            | function | `Record<string, unknown>`  | Determines whether a value is a plain record (object literal or null-prototype), not an array or class instance. |
| `isMap`               | function | `ReadonlyMap<K, V>`        | Determines whether a value is a `Map`.                                                                           |
| `isSet`               | function | `ReadonlySet<T>`           | Determines whether a value is a `Set`.                                                                           |
| `isWeakMap`           | function | `WeakMap<object, unknown>` | Determines whether a value is a `WeakMap`.                                                                       |
| `isWeakSet`           | function | `WeakSet<object>`          | Determines whether a value is a `WeakSet`.                                                                       |
| `isDate`              | function | `Date`                     | Determines whether a value is a `Date`.                                                                          |
| `isRegExp`            | function | `RegExp`                   | Determines whether a value is a `RegExp`.                                                                        |
| `isError`             | function | `Error`                    | Determines whether a value is an `Error`.                                                                        |
| `isPromise`           | function | `Promise<T>`               | Determines whether a value is a native `Promise` (use `isPromiseLike` for any thenable).                         |
| `isPromiseLike`       | function | `PromiseLike<T>`           | Determines whether a value is promise-like — an object exposing callable `then`, `catch`, and `finally` methods. |
| `isIterable`          | function | `Iterable<T>`              | Determines whether a value implements the iterable protocol (`Symbol.iterator`).                                 |
| `isAsyncIterable`     | function | `AsyncIterable<T>`         | Determines whether a value implements the async iterable protocol (`Symbol.asyncIterator`).                      |
| `isArrayBuffer`       | function | `ArrayBuffer`              | Determines whether a value is an `ArrayBuffer`.                                                                  |
| `isSharedArrayBuffer` | function | `SharedArrayBuffer`        | Determines whether a value is a `SharedArrayBuffer`.                                                             |

#### Recognizing a plain record

`isRecord` must recognize a plain object from another realm — a `vm.Context`, an iframe, a worker — whose `Object.prototype` is a different object from this realm's. It therefore identifies a foreign `Object.prototype` by the own members every conformant realm puts on it (`constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString`, `valueOf`), each read through its own descriptor so no accessor on a hostile prototype runs, and each required to be an own data property whose value is a function.

That is a structural test rather than a provenance one, and the residual is exactly this: a prototype forged to carry the mandated names as function-valued own data properties passes, while a prototype carrying the same names with no values is refused. A class prototype merely reparented to `null` fails, and so do `Date` and an ordinary class instance. The pass buys acceptance at brand-governed doors and nothing after it — every ownership engine builds a frozen plain record from captured data, so no class instance, class behavior, or forged prototype survives into a snapshot.

### Array & typed-array guards

| Guard                 | Kind     | Shape               | Summary                                                                             |
| --------------------- | -------- | ------------------- | ----------------------------------------------------------------------------------- |
| `isArray`             | function | `readonly T[]`      | Determines whether a value is an array.                                             |
| `isDataView`          | function | `DataView`          | Determines whether a value is a `DataView`.                                         |
| `isArrayBufferView`   | function | `ArrayBufferView`   | Determines whether a value is an `ArrayBufferView` (any typed array or `DataView`). |
| `isInt8Array`         | function | `Int8Array`         | Determines whether a value is an `Int8Array`.                                       |
| `isUint8Array`        | function | `Uint8Array`        | Determines whether a value is a `Uint8Array`.                                       |
| `isUint8ClampedArray` | function | `Uint8ClampedArray` | Determines whether a value is a `Uint8ClampedArray`.                                |
| `isInt16Array`        | function | `Int16Array`        | Determines whether a value is an `Int16Array`.                                      |
| `isUint16Array`       | function | `Uint16Array`       | Determines whether a value is a `Uint16Array`.                                      |
| `isInt32Array`        | function | `Int32Array`        | Determines whether a value is an `Int32Array`.                                      |
| `isUint32Array`       | function | `Uint32Array`       | Determines whether a value is a `Uint32Array`.                                      |
| `isFloat32Array`      | function | `Float32Array`      | Determines whether a value is a `Float32Array`.                                     |
| `isFloat64Array`      | function | `Float64Array`      | Determines whether a value is a `Float64Array`.                                     |
| `isBigInt64Array`     | function | `BigInt64Array`     | Determines whether a value is a `BigInt64Array`.                                    |
| `isBigUint64Array`    | function | `BigUint64Array`    | Determines whether a value is a `BigUint64Array`.                                   |

### Emptiness guards

| Guard              | Kind     | Shape                               | Summary                                                                                                                         |
| ------------------ | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `isEmptyString`    | function | `''`                                | Determines whether a value is the empty string `''`.                                                                            |
| `isEmptyArray`     | function | `readonly []`                       | Determines whether a value is an empty array.                                                                                   |
| `isEmptyObject`    | function | `Record<string \| symbol, never>`   | Determines whether a value is an empty plain object — no OWN keys at all, of any kind: string or symbol, enumerable or not.     |
| `isEmptyMap`       | function | `ReadonlyMap<never, never>`         | Determines whether a value is an empty `Map`.                                                                                   |
| `isEmptySet`       | function | `ReadonlySet<never>`                | Determines whether a value is an empty `Set`.                                                                                   |
| `isNonEmptyString` | function | `string`                            | Determines whether a value is a non-empty string (at least one character).                                                      |
| `isNonEmptyArray`  | function | `readonly [T, ...T[]]`              | Determines whether a value is a non-empty array (at least one element).                                                         |
| `isNonEmptyObject` | function | `Record<string \| symbol, unknown>` | Determines whether a value is a non-empty plain object — at least one own key of any kind: string or symbol, enumerable or not. |
| `isNonEmptyMap`    | function | `ReadonlyMap<K, V>`                 | Determines whether a value is a non-empty `Map` (at least one entry).                                                           |
| `isNonEmptySet`    | function | `ReadonlySet<T>`                    | Determines whether a value is a non-empty `Set` (at least one element).                                                         |

### Function & constructor guards

| Guard                      | Kind     | Shape                                                               | Summary                                                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `isFunction`               | function | `AnyFunction`                                                       | Determines whether a value is callable.                                                                      |
| `isZeroArg`                | function | `ZeroArgFunction`                                                   | Determines whether a value is a function that declares zero parameters (`Function.length === 0`).            |
| `isAsyncFunction`          | function | `AnyAsyncFunction`                                                  | Determines whether a value is a native `async function`.                                                     |
| `isGeneratorFunction`      | function | `(...args: unknown[]) => Generator<unknown, unknown, unknown>`      | Determines whether a value is a generator function (`function*`).                                            |
| `isAsyncGeneratorFunction` | function | `(...args: unknown[]) => AsyncGenerator<unknown, unknown, unknown>` | Determines whether a value is an async generator function (`async function*`).                               |
| `isZeroArgAsync`           | function | `ZeroArgAsyncFunction`                                              | Determines whether a value is a zero-argument async function.                                                |
| `isZeroArgGenerator`       | function | `() => Generator<unknown, unknown, unknown>`                        | Determines whether a value is a zero-argument generator function.                                            |
| `isZeroArgAsyncGenerator`  | function | `() => AsyncGenerator<unknown, unknown, unknown>`                   | Determines whether a value is a zero-argument async generator function.                                      |
| `isConstructor`            | function | `AnyConstructor`                                                    | Determines whether a value can be used as a `new`-target constructor.                                        |
| `isInstance`               | function | `InstanceType<C>`                                                   | Determines whether a value is an instance of a constructor, contained against a throwing `instanceof` check. |

### Combinators

Each combinator builds a fresh guard out of guards you already hold. There is no
`iterableOf`; guard a `Set`, a `Map`, or an array with `setOf`, `mapOf`, or `arrayOf`.

| Combinator       | Kind     | Summary                                                                                                                                                                                                                                    |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arrayOf`        | function | Builds a guard that accepts DENSE arrays whose every element satisfies `elementGuard`.                                                                                                                                                     |
| `tupleOf`        | function | Builds a guard that accepts fixed-arity DENSE tuples, testing each index with the corresponding guard.                                                                                                                                     |
| `setOf`          | function | Builds a guard that accepts `Set` instances whose every element satisfies `elementGuard`.                                                                                                                                                  |
| `mapOf`          | function | Builds a guard that accepts `Map` instances where every key satisfies `keyGuard` and every value satisfies `valueGuard`.                                                                                                                   |
| `recordOf`       | function | Builds a guard that accepts plain records matching a guard shape.                                                                                                                                                                          |
| `objectOf`       | function | Builds a guard that accepts non-array objects matching an open guard shape.                                                                                                                                                                |
| `literalOf`      | function | Builds a guard that accepts a provided literal primitive using SameValueZero comparison.                                                                                                                                                   |
| `instanceOf`     | function | Builds a guard that accepts instances of the provided constructor.                                                                                                                                                                         |
| `enumOf`         | function | Builds a guard from a native `enum` or any object whose values are strings or numbers.                                                                                                                                                     |
| `keyOf`          | function | Builds a guard that accepts values that are own keys of the provided object.                                                                                                                                                               |
| `pickOf`         | function | Builds a new guard shape by keeping only the listed keys — the structural equivalent of `Pick<T, K>`. Produces a shape for `recordOf`, not a guard.                                                                                        |
| `omitOf`         | function | Builds a new guard shape by removing the listed keys — the structural equivalent of `Omit<T, K>`. Produces a shape for `recordOf`, not a guard.                                                                                            |
| `andOf`          | function | Combines `left` and `right` with logical AND — passes only when both pass.                                                                                                                                                                 |
| `orOf`           | function | Combines `left` and `right` with logical OR — passes when at least one passes. Prefer `unionOf` for a wider set of variants.                                                                                                               |
| `notOf`          | function | Negates a guard or predicate — passes when `guard` returns `false`.                                                                                                                                                                        |
| `complementOf`   | function | Builds a guard for `Exclude<TBase, TExcluded>` — accepts values that pass `base` but not `excluded`.                                                                                                                                       |
| `unionOf`        | function | Builds a guard that accepts values matching at least one of the provided guards — the variadic form of `orOf`.                                                                                                                             |
| `intersectionOf` | function | Builds a guard that accepts values matching ALL of the provided guards — the variadic form of `andOf`.                                                                                                                                     |
| `whereOf`        | function | Refines a base guard with an additional predicate that runs only when the base passes.                                                                                                                                                     |
| `lazyOf`         | function | Defers guard creation until first use by calling `thunk()` on every invocation.                                                                                                                                                            |
| `transformOf`    | function | Builds a guard that passes when the base passes AND the projection of the value satisfies the target guard. Still narrows to `T` (the base type) — the target check is a validity constraint on a derived view, not a type transformation. |
| `nullableOf`     | function | Extends a guard to also allow `null`.                                                                                                                                                                                                      |
| `optionalOf`     | function | Extends a guard to also allow `undefined` — the optional counterpart of `nullableOf`.                                                                                                                                                      |
| `boundsOf`       | function | Builds a guard that accepts finite numbers within an inclusive `[min, max]` range.                                                                                                                                                         |
| `matchOf`        | function | Builds a guard that accepts strings matching a regular expression.                                                                                                                                                                         |
| `stringOf`       | function | Builds a guard that accepts strings satisfying optional length and pattern refinements — `min` / `max` length and a `pattern`.                                                                                                             |

The bound the combinators carry is not itself a combinator, and its `Value` cell holds
the constant's own literal:

| Bound               | Kind  | Value | Summary                                                                       |
| ------------------- | ----- | ----- | ----------------------------------------------------------------------------- |
| `GUARD_DEPTH_LIMIT` | const | `512` | Caps the active recursion or JSON container depth for runtime guards, frozen. |

### Parsers

**Coercion policy.** Number and string coerce into each other bidirectionally by design: `parseNumber` accepts a numeric string (`'42'` → `42`) and `parseString` accepts a finite number, stringifying it (`42` → `'42'`) — use `isString` / `isFiniteNumber` directly when you need strict rejection with no coercion. Boolean is a coercion **sink only**, never a source: `parseBoolean` accepts `'true'` / `'false'` / `'1'` / `'0'` / `1` / `0` and coerces them TO a boolean, but `parseNumber` and `parseString` both reject booleans outright — a boolean never coerces into a number or string. `'1'` meaning "the number one" and `'1'` meaning "true" are different domains; only the boolean parser treats the numeric/string forms as booleans.

| Parser                | Kind     | Summary                                                                                                      |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `parseString`         | function | Parses an unknown value to a string.                                                                         |
| `parseNumber`         | function | Parses an unknown value to a finite number.                                                                  |
| `parseInteger`        | function | Parses an unknown value to a finite integer.                                                                 |
| `parseBoolean`        | function | Parses an unknown value to a boolean.                                                                        |
| `parseRecord`         | function | Parses an unknown value to a plain record — the input reference, never cloned.                               |
| `parseArray`          | function | Parses an unknown value to an array — the input reference, never cloned — optionally guarding every element. |
| `parseEnum`           | function | Parses an unknown value as one of the allowed literal primitives.                                            |
| `parseNull`           | function | Parses an unknown value to `null`.                                                                           |
| `parseJSONValue`      | function | Parses an unknown value to a cycle-safe JSON value — the input reference, never cloned.                      |
| `parseStringField`    | function | Reads and parses a string field from a record by key or nested key path.                                     |
| `parseNumberField`    | function | Reads and parses a finite-number field from a record by key or nested key path.                              |
| `parseIntegerField`   | function | Reads and parses a finite-integer field from a record by key or nested key path.                             |
| `parseBooleanField`   | function | Reads and parses a boolean field from a record by key or nested key path.                                    |
| `parseRecordField`    | function | Reads and parses a nested record field from a record by key or nested key path.                              |
| `parseArrayField`     | function | Reads and parses an array field from a record by key or nested key path, optionally guarding elements.       |
| `parseEnumField`      | function | Reads and parses an enum field from a record by key or nested key path.                                      |
| `parseNullField`      | function | Reads and parses a `null` field from a record by key or nested key path.                                     |
| `parseJSONValueField` | function | Reads and parses a JSON-value field from a record by key or nested key path.                                 |

### JSON

The safe JSON surface keeps text parsing lazy: `parseJSON` returns `unknown`, while `parseJSONAs` walks only the guard shape supplied by its caller. `isJSONValue` and `parseJSONValue` are shipped explicit deep whole-tree gates; `isBoundedJSONValue` adds the fixed resource boundary, and `isBoundedJSONRecord` adds the record-root invariant. `JSONRecord` and `cloneJSONRecord` provide the record-root ownership contract required by metadata and persistence consumers, while `cloneJSONValue` owns any JSON root. A dedicated `JSONArray` alias, broad deep `isJSONObject` / `isJSONSchema` validators, and the ~50-field `JSONSchemaDefinition` remain deliberately omitted. Compose narrower shapes from the combinators and read a parsed blob field-by-field with the `parse*Field` readers when whole-tree work is unnecessary.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a
guard row's the type it narrows to.

| API                   | Kind      | Shape                                                                                                                                                                                        | Summary                                                                                                                                     |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `isJSONPrimitive`     | function  | `JSONPrimitive`                                                                                                                                                                              | Determines whether a value is a primitive JSON value.                                                                                       |
| `isJSONValue`         | function  | `JSONValue`                                                                                                                                                                                  | Determines whether a value is a cycle-safe JSON value.                                                                                      |
| `isBoundedJSONValue`  | function  | `JSONValue`                                                                                                                                                                                  | Determines whether a value is JSON-valid within the fixed container-depth limit.                                                            |
| `isBoundedJSONRecord` | function  | `JSONRecord`                                                                                                                                                                                 | Determines whether a value is a depth-bounded JSON record.                                                                                  |
| `parseJSON`           | function  | `(value: string) => unknown`                                                                                                                                                                 | Parses a JSON string, returning `undefined` instead of throwing.                                                                            |
| `parseJSONAs`         | function  | `<T>(value: string, guard: Guard<T>) => T \| undefined`                                                                                                                                      | Parses a JSON string and validates the result against a guard.                                                                              |
| `JSON_SCHEMA_TYPES`   | const     | `readonly JSONSchemaType[]`                                                                                                                                                                  | Lists the seven standard JSON Schema `type` names, frozen.                                                                                  |
| `JSONPrimitive`       | type      | `string \| number \| boolean \| null`                                                                                                                                                        | Represents a primitive JSON value — the flat leaf of any JSON document.                                                                     |
| `JSONRecord`          | type      | `{ readonly [key: string]: JSONValue }`                                                                                                                                                      | Represents a readonly string-keyed JSON object record.                                                                                      |
| `JSONValue`           | type      | `JSONPrimitive \| readonly JSONValue[] \| JSONRecord`                                                                                                                                        | Represents a recursive JSON value — primitives, arrays, and object records.                                                                 |
| `JSONSchemaType`      | type      | `'null' \| 'boolean' \| 'object' \| 'array' \| 'number' \| 'integer' \| 'string'`                                                                                                            | Lists the seven standard JSON Schema `type` names.                                                                                          |
| `JSONSchema`          | interface | `{ type?, description?, enum?, minLength?, maxLength?, pattern?, format?, minimum?, maximum?, minItems?, maxItems?, items?, properties?, required?, additionalProperties?, anyOf?, oneOf? }` | Represents a JSON Schema fragment — the supported keyword vocabulary the contract compiler emits and `RawShape` validates before embedding. |
| `SchemaFormat`        | type      | `'date-time' \| 'date' \| 'time' \| 'uuid' \| 'email' \| 'uri'`                                                                                                                              | Lists the closed set of string formats `stringToFormat` recognizes.                                                                         |

### Helper

| Constant               | Kind  | Summary                                                                                       |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `CONTRACT_ERROR_BRAND` | const | Holds the registry-global key used to recognize `ContractError` values across package copies. |

| Helper                  | Kind     | Summary                                                                                                                                                                                                                                                                |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempt`               | function | Invokes a callback once and synchronously captures its exact outcome as a `Result`.                                                                                                                                                                                    |
| `INTRINSICS`            | const    | Captures every host operation this package dispatches through, while this module evaluates.                                                                                                                                                                            |
| `contain`               | function | Runs a public door's whole body and publishes only this package's error class.                                                                                                                                                                                         |
| `appendEntries`         | function | Appends every element of one array onto another, by index.                                                                                                                                                                                                             |
| `limitEntries`          | function | Takes at most `limit` leading elements of an array, by index.                                                                                                                                                                                                          |
| `compareValues`         | function | Orders two primitive keys or indices ascending.                                                                                                                                                                                                                        |
| `sortValues`            | function | Orders primitive keys or indices deterministically, on an owned copy, through the captured sort.                                                                                                                                                                       |
| `pathOf`                | function | Builds a diagnostic path from an existing path and further segments, without dispatching through array iteration.                                                                                                                                                      |
| `readValue`             | function | Reads a value through the shared containment boundary or refuses it with the contract module's uniform read diagnostic.                                                                                                                                                |
| `readArrayEntries`      | function | Snapshots an array through its reflected own-index population.                                                                                                                                                                                                         |
| `readGuardShape`        | function | Snapshots a guard shape and its optional-key mode for a shape combinator.                                                                                                                                                                                              |
| `holds`                 | function | Invokes a predicate through the sanctioned never-throw boundary.                                                                                                                                                                                                       |
| `enumerableKeys`        | function | Snapshots an object's own enumerable string keys through a total boundary.                                                                                                                                                                                             |
| `readOptions`           | function | Validates and snapshots a shape-builder options record through every reflective operation the builder relies on.                                                                                                                                                       |
| `drawRandom`            | function | Draws and validates one generator random sample.                                                                                                                                                                                                                       |
| `enumerableSymbolCount` | function | Counts the enumerable own-symbol keys on a value.                                                                                                                                                                                                                      |
| `matchesJSONValue`      | function | Matches an unknown value against the recursive JSON value structure.                                                                                                                                                                                                   |
| `matchesRecordBrand`    | function | Determines whether a value carries the plain-record brand, raising a hostile prototype observation instead of answering it.                                                                                                                                            |
| `matchesJSONDepth`      | function | Determines whether a readable value stays within the fixed JSON container-depth limit.                                                                                                                                                                                 |
| `resolveField`          | function | Resolves a (possibly nested) field value from a record by a key or key path.                                                                                                                                                                                           |
| `seededRandom`          | function | Builds a deterministic pseudo-random source seeded from a single number.                                                                                                                                                                                               |
| `schemaToParameters`    | function | Narrows a compiled `JSONSchema` down to the open `Readonly<Record<string, unknown>>` shape tool definitions advertise as `parameters` — through the `isRecord` boundary guard, never an assertion, as `.claude/rules/patterns.md` § Validation and contracts requires. |
| `schemaToObject`        | function | Wraps a non-object `JSONSchema` root in a single-property object schema, so an inferred primitive/array/union schema can flow into `schemaToParameters` as an MCP-compatible `inputSchema`.                                                                            |
| `collectMembers`        | function | Collects an array's entries into a membership collection this package owns.                                                                                                                                                                                            |
| `matchesMember`         | function | Determines whether a value is a member of a collected vocabulary, by SameValueZero.                                                                                                                                                                                    |
| `admitMember`           | function | Collects one more member into a vocabulary that grows as a walk proceeds.                                                                                                                                                                                              |
| `matchesVisited`        | function | Determines whether an object is already on a traversal's active path.                                                                                                                                                                                                  |
| `admitVisited`          | function | Records an object as entered on a traversal's active path.                                                                                                                                                                                                             |
| `omitVisited`           | function | Records an object as exited from a traversal's active path.                                                                                                                                                                                                            |
| `retainDepth`           | function | Records one node's answer at one remaining-depth allowance in a shared memo.                                                                                                                                                                                           |
| `collectEntries`        | function | Builds the collector a captured `forEach` sweep appends through.                                                                                                                                                                                                       |
| `readSetEntries`        | function | Snapshots the genuine contents of a caller's `Set` without running an iterator.                                                                                                                                                                                        |
| `readMapEntries`        | function | Snapshots the genuine entries of a caller's `Map` without running an iterator.                                                                                                                                                                                         |
| `matchesPattern`        | function | Determines whether a string is in the language of a pattern this package owns.                                                                                                                                                                                         |
| `readPatternSource`     | function | Reads a regular expression's source text through the captured accessor.                                                                                                                                                                                                |
| `readPatternFlags`      | function | Reads a regular expression's flag text through the captured accessor.                                                                                                                                                                                                  |
| `readPattern`           | function | Rebuilds a caller's regular expression as a stateless pattern this package owns.                                                                                                                                                                                       |
| `ownPattern`            | function | Rebuilds a declaration's regular expression as a stateless pattern this package owns, and refuses an unreadable one under the reader's own name.                                                                                                                       |
| `pinMembers`            | function | Pins every own member of a class prototype as a non-configurable member — non-writable too when it is a data property — and verify the pin took.                                                                                                                       |
| `refuseExpansion`       | function | Refuses a validated declaration whose compiled expansion exceeds `COMPILE_NODE_LIMIT`.                                                                                                                                                                                 |

`matchesJSONDepth` is deliberately depth-only: active cycles terminate successfully at the depth layer but remain invalid JSON, honest sparse holes add no child depth but fail the dense `isJSONValue` contract, and readable exotics pass as leaves but fail JSON validity. `isBoundedJSONValue` therefore performs two total sequential observations — fixed depth first, then the existing JSON guard — rather than promising an atomic snapshot of caller-owned state. It validates but does not own; use `cloneJSONValue` / `cloneJSONRecord` when an independent frozen snapshot is required. The fixed cap is package safety mechanism, not configurable product policy: byte budgets, key budgets, configured wire depth, unsafe-name rejection, descriptor policy, and application-specific limits remain with their consuming package.

### Membership

Membership is the answer a validation package exists to be right about, and it is asked through MODULE BINDINGS rather than through any property. `Set` is the right data structure for SameValueZero membership and the wrong dispatch surface: a caller who writes `Set.prototype.has = () => true` changed what `contract.is`, `literalOf`, `enumOf` and `parseEnum` ANSWERED — no throw, no diagnostic, a wrong yes. Moving those reads onto the `has` method of an exported class reproduces the defect verbatim, because every public class method is dispatched through a prototype every consumer can reach. Relocating an answer onto a reachable member moves the defect rather than removing it. This package instead asks through a module-scope function, which the specification makes immutable to every importer, over an operation `INTRINSICS` captured while it evaluated.

So `matchesMember` / `admitMember` / `collectMembers` own literal, enum and key membership; `matchesVisited` / `admitVisited` / `omitVisited` own cycle and visitation membership; `matchesPattern` / `readPattern` / `readPatternSource` / `readPatternFlags` own pattern membership; and `readSetEntries` / `readMapEntries` read a caller's own `Set` / `Map` through the captured `forEach` rather than through a replaceable iterator. Collection construction is by INDEX rather than from an iterable, because `new Set(values)` reads `Symbol.iterator` off the argument and `add` off the instance — two replaceable dispatches added to remove one.

The scope claim, stated so it can be checked rather than trusted: **no membership answer this package publishes — literal, enum, pattern, set, map, intersection, record key, declared key, or schema keyword — is decided by a property lookup on any object a caller can reach.** The standing proof is `tests/src/core/integration.test.ts`, which sweeps every membership door against every lying host member, against both accessors of `RegExp.prototype`, and against every writable prototype member of every value this package exports as a constructor. That last population is not empty: an earlier sentence here said it was "empty, because each of those classes pins its prototype while it is defined", which ran a true claim about the CLASSES together with a false one about the population. The rule draws from every exported callable, and an ordinary exported FUNCTION's `.prototype.constructor` is writable and always will be — so the corpus is one row per exported plain function and zero rows per exported class. The sweep asserts what it always asserted, that no door consults any of them. The suite pins the corpus's composition against the barrel rather than against a remembered number: every exported plain function contributes exactly one row, every row is a `.prototype.constructor`, and no exported class contributes any. A count stated here drifted for a round after further functions were exported, which is why no number stands here.

What that claim does NOT cover is named rather than left to be discovered: the load-order precondition below, and a caller who replaces a door's own method and then calls that door, which is their arrangement rather than this package's defect.

### Threat model

Stated as a LIMIT, because a security claim that names no boundary is not checkable.

**This package does not defend against an adversary who can modify shared intrinsics in its own realm.** A caller who can assign `String.prototype.trim`, `Object.freeze`, or `Set.prototype.has` is already running arbitrary code in the same realm as this package and can replace the package outright — swap the module, wrap every export, or answer the verification read that any self-check performs. Defending is impossible in principle rather than merely unimplemented, and it is the assumption every comparable validation library makes. The same argument covers the load-order precondition above: a module that evaluates first chooses what `INTRINSICS` captures, and nothing inside the package can reach code that ran before the package existed.

The hardening that exists for that adversary anyway — `contain`, `INTRINSICS`, the module-scope membership functions, `pinMembers`, the indexed publication walks — **stays, raises attacker cost, and is not claimed to be complete.** Its sweeps in `tests/src/core/integration.test.ts` are regression guards over work already paid for, not acceptance gates: a newly discovered intrinsic vector is recorded as a boundary case rather than treated as a release blocker.

What IS guaranteed, with honest intrinsics and hostile DATA:

- **Guards are total.** Every `is*` and every combinator-built guard answers a `boolean` for any input — a throwing getter, a revoked or trap-throwing `Proxy`, a cycle, a 200,000-deep graph, a foreign realm, an exotic host — and never propagates a throw.
- **Published snapshots are frozen and faithful.** A builder freezes what it returns and copies what you hand it; `cloneShape` / `cloneSchema` / `cloneJSONValue` publish deeply frozen graphs that retain no caller reference, and a snapshot that cannot be faithful refuses instead of normalizing.
- **`is`, `parse`, `audit` and `explain` agree.** No input is certified clean by one door and refused by another: the laws in Domains hold for readable, stably-read values, and where a door must perform a read that can fail, every door that answers about the same value performs it.
- **Hostile data is refused with a coded `ContractError`.** Cycles, excessive depth, exotic objects, foreign realms, revoked proxies, throwing accessors and unstable reads reach a coded refusal or a documented non-match, never a raw host error and never an unbounded walk.
- **A shared reference costs one visit, a published bound, or nothing at all.** `COMPILE_DEPTH_LIMIT`, `GUARD_DEPTH_LIMIT`, `FAULT_LIMIT`, `INFER_DEPTH_LIMIT`, `INFER_BREADTH_LIMIT`, `CLONE_NODE_LIMIT` and `COMPILE_NODE_LIMIT` are the published bounds, and where a bound is the wrong instrument the walk carries an identity memo instead. Sharing arrives on BOTH sides and both are answered: `COMPILE_NODE_LIMIT` caps what a shared-child DECLARATION expands into (see Compilers), and `is`, `audit` and `explain` answer a shared-reference VALUE in one visit per (compiled node, object) pair however many paths reach that object. Both halves are needed: without the value-side memo an ordinary graph with several references per level — a few hundred bytes, no attacker, shared references are normal data — costs node reads exponential in its depth. A faulted node is re-walked at its new path, because a fault carries one, and stays bounded by `FAULT_LIMIT`. `cloneJSONValue` and `parse` deliberately still expand and each says so here: `cloneJSONValue` duplicates an alias by contract and caps that at `CLONE_NODE_LIMIT`, and `parse` materializes a tree — see the line below. The claim is about those doors, not about a guard a caller composes: nesting `arrayOf` twenty levels deep builds a walker of your own, and it pays per path.

What is NOT guaranteed, beyond the realm assumption above: a value whose observable reads CHANGE between two calls can leave any two-call law unsatisfied (see Domains), `Date` and `undefined` fall outside the round-trip law, and `schemaToShape`'s memo is ancestor-context-sensitive across graphs (see its row). Two more follow from the memo above and are named rather than left to be discovered. `parse` returns a TREE, so it pays for the tree its input expands into: eighteen shared arrays parse into 262,143 of them in about 370 ms, where `is`, `audit` and `explain` answer the same value in under a millisecond and `cloneJSONValue` refuses that exact graph at `CLONE_NODE_LIMIT`. That cost is the RESULT rather than the walk, which is why it carries no cap — a cap here would refuse a value the caller asked to be handed — so measure an untrusted graph's expansion before parsing it. And within ONE call, `is`, `audit` and `explain` read a given object once per compiled node rather than once per path, so a value whose reads change BETWEEN two reads of the same node can answer differently than it did when every path re-read it. Both are consequences of trading repeated reads for bounded work, and the trade is stated so it can be checked rather than discovered. A third limit belongs to the guards you compose YOURSELF: the memo above lives in a compiled artifact, so a chain you build by hand out of combinators — `arrayOf(arrayOf(...))` and its siblings — has no shared ledger between its independently constructed links and re-reads a shared object once per PATH. Measured: a depth-18 hand-composed chain over an 18-level shared graph answers in about 250 ms, growing fourfold every two levels, where the same value through `createContract` answers in under a millisecond. Compile the declaration when the value may share references; the compiled route is the one this bound covers.

### Types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`.

| Type                     | Kind      | Shape                                                                                                                            | Summary                                                                                                                                        |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Failure`                | interface | `{ success, error }`                                                                                                             | Represents the discriminated failure branch of a `Result`.                                                                                     |
| `ArrayRead<T = unknown>` | interface | `{ entries, dense }`                                                                                                             | Represents the owned result of reading one array through its reflected own-index lens.                                                         |
| `GuardShapeRead`         | interface | `{ guards, names, optional, vocabulary }`                                                                                        | Represents the owned result of reading one guard shape and its optional-key mode.                                                              |
| `BoundsRead`             | interface | `{ min?, max? }`                                                                                                                 | Represents a derived numeric bounds pair, either member absent.                                                                                |
| `EntryCollectorFunction` | type      | `(value: unknown, key: unknown) => void`                                                                                         | Represents the collector a captured `forEach` sweep invokes per entry.                                                                         |
| `StringGuardOptions`     | interface | `{ min?, max?, pattern? }`                                                                                                       | Groups the options for the `stringOf` guard builder.                                                                                           |
| `FieldPath`              | type      | `string \| readonly string[]`                                                                                                    | Addresses one field in a record: a single key, or an ordered list of keys to descend through nested objects.                                   |
| `Guard`                  | type      | `(value: unknown) => value is T`                                                                                                 | Represents a runtime type guard: returns `true` when `value` satisfies `T` and narrows it.                                                     |
| `GuardType`              | type      | `G extends Guard<infer T> ? T : never`                                                                                           | Extracts the guarded type `T` from a `Guard<T>`.                                                                                               |
| `GuardsShape`            | type      | `Readonly<Record<string, Guard<unknown>>>`                                                                                       | Represents a mapping of string keys to guards.                                                                                                 |
| `FromGuards`             | type      | `Readonly<{ [K in keyof G]: GuardType<G[K]> }>`                                                                                  | Resolves a `GuardsShape` to a readonly object type of its guarded property types.                                                              |
| `OptionalFromGuards`     | type      | `Readonly<{ [P in Exclude<keyof S, K[number]>]: FromGuards<S>[P] } & { [P in Extract<keyof S, K[number]>]?: FromGuards<S>[P] }>` | Mirrors `FromGuards`, but every key listed in `K` becomes a true optional member (`?`) rather than a required key widened with `\| undefined`. |
| `TupleFromGuards`        | type      | `Readonly<{ [K in keyof Ts]: GuardType<Ts[K]> }>`                                                                                | Maps a tuple of element guards to a readonly tuple of their guarded types.                                                                     |
| `UnionToIntersection`    | type      | `(U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never`                                          | Converts a union type to an intersection type.                                                                                                 |
| `IntersectionFromGuards` | type      | `UnionToIntersection<GuardType<Gs[number]>>`                                                                                     | Intersects the types guarded by a tuple of guards — backs `intersectionOf`.                                                                    |
| `Parser`                 | type      | `(value: unknown) => T \| undefined`                                                                                             | Coerces an unknown value to `T`, or returns `undefined`.                                                                                       |
| `LiteralValue`           | type      | `string \| number \| boolean`                                                                                                    | Represents a string, number, or boolean literal.                                                                                               |
| `Result`                 | type      | `Success<T> \| Failure<E>`                                                                                                       | Represents a discriminated union for operations that can succeed or fail without throwing.                                                     |
| `ReadValueOptions`       | interface | `{ subject?, code?, context? }`                                                                                                  | Represents optional diagnostic metadata for a required read.                                                                                   |
| `ContainOptions`         | interface | `{ code?, context? }`                                                                                                            | Represents optional diagnostic metadata for a public door's containment boundary.                                                              |
| `ShapeProperty`          | interface | `{ key, child }`                                                                                                                 | Represents one captured property of an object shape, held as an ordered entry rather than as a `Map` pair.                                     |
| `Success`                | interface | `{ success, value }`                                                                                                             | Represents the discriminated success branch of a `Result`.                                                                                     |
| `AnyConstructor`         | type      | `new (...args: unknown[]) => T`                                                                                                  | Represents a constructor signature that produces instances of `T`.                                                                             |
| `AnyFunction`            | type      | `(...args: unknown[]) => unknown`                                                                                                | Represents a function accepting any arguments and returning `unknown`.                                                                         |
| `AnyAsyncFunction`       | type      | `(...args: unknown[]) => Promise<unknown>`                                                                                       | Represents an async function accepting any arguments and returning a `Promise`.                                                                |
| `ZeroArgFunction`        | type      | `() => unknown`                                                                                                                  | Represents a function accepting zero arguments and returning `unknown`.                                                                        |
| `ZeroArgAsyncFunction`   | type      | `() => Promise<unknown>`                                                                                                         | Represents an async function accepting zero arguments and returning a `Promise`.                                                               |

### Classes

`ContractError` is documented in full under its own heading following this table.

| API             | Kind  | Summary                                                                                      |
| --------------- | ----- | -------------------------------------------------------------------------------------------- |
| `ContractError` | class | Carries a machine-readable contract category, optional context, and an exact optional cause. |

### `ContractError`

`CONTRACT_ERROR_BRAND` is the registry-global symbol captured while `constants.ts` evaluates. The constructor stores the error itself under that key, and `isContractError` requires the descriptor value to be the value under inspection. That identity check keeps cross-copy recognition and refuses accidental property lookalikes and transparent wrappers: a proxy forwards a descriptor that stores its target, not the proxy. The registry makes the stamp forgeable by design. A complete `Error` subclass forgery with the exact name, a declared code, and its own identity stored under `Symbol.for('@orkestrel/contract.error')` passes recognition. The brand is therefore a cross-copy recognition marker, not proof that this package constructed the value.

The one error class thrown across this module — an `Error` subclass carrying a machine-readable `code`, optional structured `context`, and an exact optional `cause`, from [`errors.ts`](../src/core/errors.ts). Omitting `cause` creates no own cause property; supplying `cause: undefined` creates an own property whose value is exactly `undefined`; every other cause retains its identity. Both optional options are read as OWN properties and ownership is established before the value is read at all, so an inherited `cause` or `context` counts as omission: an unqualified read of an absent option would leave the container and land on `Object.prototype`, which any caller can write, and would let that caller decide what a refusal an engine authored carries. `code` is required by the options type, so an internal literal always carries it own; a caller who hands in a container that INHERITS `code` still gets the inherited value, because the type promised a value rather than an own property, and that caller is choosing what its own error carries. `name` is fixed to `'ContractError'`; `code` and `context` are readonly. The constructor stamps the global own-property brand `Symbol.for('@orkestrel/contract.error')`. `isContractError` requires that brand plus the native `Error` base, a prototype other than `Error.prototype`, the exact `ContractError` name, and a declared `ContractCode`. The global symbol registry makes recognition work across duplicate installations and ESM/CommonJS module copies at 0.0.13 or later. A copy earlier than 0.0.13 stamps no brand, so its errors remain outside the type. An ordinary `Error`, a plain object, or a partial property lookalike remains outside the type.

These refusal families may throw, and whenever they do they throw only this class: REQUIRED READS (`readValue` and the public inferer/helper/combinator/compiler readers layered over it — normally `structure` with `<reader>: <subject> could not be read`, while `RegExp` readers use `pattern`), shape CONSTRUCTION (every builder validates every runtime argument position before returning — `bound` / `range` / `empty` / `placement` / `pattern` / `literal` / `structure`), CLONING (`cloneJSONValue` / `cloneJSONRecord` for inexact JSON data, cycles, or hostile traversal; `cloneSchema` / `cloneShape` / `ownShape`, and `rawShape` through its snapshot — `clone` plus declaration-policy codes), VALIDATION (`validateShape` and `ShapeValidator` — `range` / `empty` / `placement` / `structure` / `literal` / `cycle` / `bound` / `pattern`), the COMPILATION gate (every `compile*` export plus `createContract` routes through that same `validateShape` — the same declaration-policy codes, plus `depth`), and GENERATION (`compileGenerator` on an unsatisfiable request — `generate`; `drawRandom` on a broken sample source — `random`). Every message opens with the reader that OWNS the rule it enforces, never the engine that happened to run it. A declaration rule belongs to the shared gate and reads `validateShape: …` wherever it is applied, including inside `ShapeCloner`, which enforces the same rules while capturing; `cloneShape: …` is reserved for the ownership rules the cloner itself owns — own data discriminants, inherited fields, accessors, read stability, unreadable property maps, and a failed snapshot; and `ShapeCloner.clone: …`, `SchemaCloner.clone: …`, `JSONCloner.clone: …` and `ShapeValidator.validate: …` name a refusal about the CALL rather than the declaration, such as reentry. One rule therefore has one diagnostic at each of those doors: `cloneShape`, `ownShape`, `validateShape`, `ShapeValidator`, every `compile*` export and `createContract` report the same malformed declaration with the same code and the same message, across every declaration-policy family the gate owns (`placement`, `range`, `bound`, `pattern`, `empty`, `literal`, `cycle`, `depth`, `structure`). That is a statement about those doors and those families, enforced by a sweep rather than asserted: it says nothing about a door outside the list. `createContract` observes its caller’s source twice — once as the declaration, once while cloning it — so a LIVE declaration that changes between those walks can be refused by ownership rather than by the gate, and each refusal names the boundary that owns the rule it broke. An error adopted by identity from another engine keeps the prefix that engine gave it. Hand-authored string declarations use the same unflagged-pattern policy as builders: a stable genuine `RegExp` carrying flags is a `pattern` refusal, and inline pattern constructs are the supported alternative. Total guards and optional readers use their non-throwing outcomes; `compileReporter` contains its diagnostic walk, while required `parse`/`audit` reads and schema inversion refuse traversal failure. Root ownership, including the frozen-state probe itself, is contained before standalone compilation begins: a revoked `Proxy`, throwing getter, or caller-thrown value becomes a coded `clone` / `structure` `ContractError`. Malformed containers, hostile proxies, and wrong primitives at any builder position become coded `ContractError` values. Every public door that can refuse runs its whole body through `contain`, which republishes anything that is not this class under the door's own name with the exact thrown value as `cause`; a door whose body cannot throw carries no boundary, because wrapping code that cannot fail misreports where the refusals are. A boundary placed per STATEMENT is only ever as complete as the last sweep, while a boundary at the door covers whatever the body reaches, enumerated or not. Its limits are named rather than promised away. A boundary covers a BODY, so it cannot reach a parameter-default initializer, which is evaluated in the function environment before the first statement runs: the one such default this package had (`compileGenerator`'s wall-clock seed) was moved into the contained body, and any future computed default belongs there too. And a boundary is not a fidelity guarantee: containment answers what a door may THROW, while what a door PUBLISHES under a redirect that lies instead of throwing is the separate job of `INTRINSICS`, the module-scope membership functions layered over it, and the indexed publication walks. Every such site is reached from the captured table — which is a claim a sweep checks, not a claim this sentence makes.

```ts
import { ContractError, isContractError } from '@orkestrel/contract'

const error = new ContractError('Minimum exceeds maximum', {
	code: 'range',
	context: { path: ['properties', 'age'] },
})
isContractError(error) // true
```

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a
guard row's the type it narrows to.

| API                    | Kind      | Shape                                                                                                                                                             | Summary                                                                  |
| ---------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `isContractError`      | function  | `ContractError`                                                                                                                                                   | Checks whether an unknown value is a `ContractError`.                    |
| `ContractCode`         | type      | `'bound' \| 'range' \| 'empty' \| 'placement' \| 'structure' \| 'literal' \| 'cycle' \| 'pattern' \| 'generate' \| 'random' \| 'clone' \| 'depth' \| 'expansion'` | Names the machine-readable category carried by a `ContractError`.        |
| `CONTRACT_CODES`       | const     | `readonly ContractCode[]`                                                                                                                                         | Lists every declared `ContractCode` refusal category, frozen.            |
| `ContractErrorContext` | interface | `{ path?, shape?, limit?, received? }`                                                                                                                            | Represents the optional structured details carried by a `ContractError`. |
| `ContractErrorOptions` | interface | `{ code, context?, cause? }`                                                                                                                                      | Represents the construction options for a `ContractError`.               |

### Cloners

`JSONCloner` is the public state-owning JSON engine. Its constructor only retains the source; the first `clone()` performs the iterative snapshot and settles once. A successful instance replays the exact same deeply frozen root without another source read, while a failed instance releases partial traversal working state and rethrows its exact class-owned `ContractError` without another read, retaining the source and exact error for replay. That terminal settlement is nonredirectable, which needs each of these: its ownership record and error construction dispatch only through intrinsics captured while the module evaluated, AND every optional diagnostic option is read as an own property, so a construction never consults a prototype chain the caller can write. Neither replacing an intrinsic after construction nor installing a `cause`, `context` or `path` accessor on `Object.prototype` can make the first call escape with a raw value or make the replay disagree with it — including when the caller arms the pollution from inside its own reflective trap, after the walk has begun. A redirected working-state member is contained instead, and settles as an ordinary owned refusal. Active reentry permanently poisons nested, outer, and later calls with one cause-free `JSONCloner.clone: JSON cloning may not be reentered` error (`clone`, `{ shape: 'json' }`), even when hostile source code catches the nested throw. Distinct instances are independent. `cloneJSONValue` constructs a fresh instance on every call, so every eager call re-observes its source and produces a distinct composite root or distinct diagnostic when identity is observable.

`SchemaCloner` is the corresponding public state-owning JSON Schema engine. Its inert constructor retains one schema graph; the first `clone()` performs an iterative identity-memoized snapshot and settles once. Success replays the exact deeply frozen root, preserving shared and cyclic edges; failure rethrows the exact class-owned `ContractError`. Both outcomes release traversal frames and the active memo through preconstructed replacement state before nonredirectable terminal publication, while retaining the source and exact terminal result. Nonredirectable carries the same requirements here, and the diagnostic `path` is read as an own property too, so a translated foreign failure reports no path rather than one a polluted prototype supplied. Active reentry permanently poisons nested, outer, and later calls with one cause-free `SchemaCloner.clone: schema cloning may not be reentered` error (`clone`, `{ shape: 'schema' }`), including when hostile source code catches the nested throw and continues. Enumeration refusal is cause-free; property-read refusal retains the exact thrown cause, including an explicit `undefined`; unexpected foreign failures are translated once. Only errors created by that instance replay as terminal errors. Distinct instances are independent, while `cloneSchema` constructs a fresh instance for every eager call.

`ShapeCloner` is the public state-owning contract-shape engine. Its source-only constructor is inert; the first `clone()` requires every node to satisfy the realm-neutral plain-record brand before discriminant observation, then iteratively captures and wires the graph, composes raw nodes through `SchemaCloner`, freezes the completed root, validates that exact root through `ShapeValidator`, and only then applies deferred source-fidelity refusal. Success and failure replay the exact terminal root or class-owned/adopted `ContractError` without rereading the source. Active reentry permanently poisons nested, outer, and later calls with one cause-free `ShapeCloner.clone: shape cloning may not be reentered` error (`clone`, `{ shape: 'shape' }`), including caught reentry. Only errors created by this instance or adopted directly from its schema cloner or validator may replay by identity; unexpected foreign failures become `cloneShape: failed to create an owned shape snapshot` with the exact cause. Terminal settlement releases graph-working state through preconstructed replacement state before nonredirectable terminal publication, while retaining the source and exact terminal result. Distinct instances are independent, while `cloneShape` constructs a fresh instance for every eager call.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A class row's `Shape` cell holds the interface it
implements, or its constructor signature where it implements none.

| API                     | Kind      | Shape                   | Summary                                                                   |
| ----------------------- | --------- | ----------------------- | ------------------------------------------------------------------------- |
| `JSONCloner`            | class     | `JSONClonerInterface`   | Owns the state of one exact JSON snapshot operation.                      |
| `JSONClonerInterface`   | interface | `{} plus clone`         | Settles one exact JSON snapshot of a retained source, then replays it.    |
| `SchemaCloner`          | class     | `SchemaClonerInterface` | Owns the state of one JSON Schema snapshot operation.                     |
| `SchemaClonerInterface` | interface | `{} plus clone`         | Settles one JSON Schema snapshot of a retained schema, then replays it.   |
| `ShapeCloner`           | class     | `ShapeClonerInterface`  | Owns the state of one contract-shape snapshot operation.                  |
| `ShapeClonerInterface`  | interface | `{} plus clone`         | Settles one contract-shape snapshot of a retained shape, then replays it. |

`cloneShape` is the fresh eager boundary over `ShapeCloner`: every call constructs a new class instance and invokes `clone()`, so separate calls re-observe the source and produce distinct composite roots or diagnostics when identity is observable.

`ownShape` returns a successful independent eager snapshot for both frozen and unfrozen sources. After failure it rethrows a non-`clone` `ContractError` or any failure for an unfrozen source. For a frozen source whose clone failure is `clone`-coded or foreign, it validates the source with a fresh `ShapeValidator`, prefers that validator's `ContractError` when present, and otherwise rethrows the original clone failure.

The machinery behind owned snapshots (see Shape builders, below) — from [`JSONCloner.ts`](../src/core/JSONCloner.ts), [`SchemaCloner.ts`](../src/core/SchemaCloner.ts), [`ShapeCloner.ts`](../src/core/ShapeCloner.ts), and the eager boundaries in [`cloners.ts`](../src/core/cloners.ts). The JSON cloner accepts only exact acyclic JSON data, rejects sparse or decorated arrays and non-data record properties without invoking accessors, and builds deeply frozen standard arrays plus null-prototype records. “Decorated” means the array own-key set contains anything other than intrinsic `length` and every canonical index, including an extra, substituted, symbol, hidden, or accessor key. Index writability and configurability are normalized rather than treated as JSON data, so frozen arrays and nonwritable data indices remain valid. Because JSON persistence is a tree, repeated noncyclic source aliases are duplicated into distinct equal output branches; active-path back-edges fail as cycles. `cloneJSONRecord` adds record-root validation over the same engine. `cloneSchema` preserves shared-child identity and closes cyclic schema edges onto its clone; `cloneShape` preserves sharing, carries one accepted declaration population into its clone, and runs the complete declaration gate on that carried clone before returning, so a cyclic shape is refused with the same `cycle` diagnosis as every other shape entry. A key literally named `__proto__` stays own data. Every hostile reflective operation is contained through the sanctioned total boundary, and so is every caller-reachable dispatch on the declaration gate's own path: `ShapeValidator.validate` and `validateShape` translate a failure they did not author into a coded `ContractError` carrying the exact thrown value, rather than rethrowing it verbatim. JSON reflection failures and schema enumeration failures remain cause-free. A schema property-read failure instead retains the exact thrown value as its cause, including an explicit `undefined`; caller-owned errors never become terminal errors by identity. Only the exact errors owned or explicitly adopted by an engine can replay by terminal identity.

| API                | Kind     | Summary                                                                                        |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| `cloneJSONValue`   | function | Deep-clones exact JSON data into an owned frozen snapshot.                                     |
| `cloneJSONRecord`  | function | Deep-clones an exact JSON object record into an owned frozen snapshot.                         |
| `cloneSchema`      | function | Deep-clones a JSON Schema graph into an owned frozen snapshot.                                 |
| `cloneShape`       | function | Deep-clones a contract shape graph into an owned frozen snapshot.                              |
| `CLONE_NODE_LIMIT` | const    | Caps at `262144` the number of nodes one JSON snapshot may produce, frozen.                    |
| `ownShape`         | function | Takes ownership of a contract shape node as an independent `cloneShape` snapshot of its graph. |

This constructs a `JSONCloner` directly and clones a record through `cloneJSONRecord`, showing that each snapshot is independently owned.

```ts
import type { JSONClonerInterface } from '@orkestrel/contract'
import { cloneJSONRecord, JSONCloner } from '@orkestrel/contract'

const settings = { enabled: true }
const cloner: JSONClonerInterface = new JSONCloner(settings) // no source read yet
const settingsClone = cloner.clone()
cloner.clone() === settingsClone // true — terminal success replays exactly

const clone = cloneJSONRecord({ primary: settings, fallback: settings })
clone.primary === clone.fallback // false — JSON tree branches are independently owned
Object.isFrozen(clone.primary) // true
```

This constructs a `SchemaCloner` directly, showing that its `clone` replays a schema whose shared child keeps its graph identity.

```ts
import type { JSONSchema, SchemaClonerInterface } from '@orkestrel/contract'
import { SchemaCloner } from '@orkestrel/contract'

const child: JSONSchema = { type: 'string' }
const schemaCloner: SchemaClonerInterface = new SchemaCloner({ anyOf: [child, child] })
const schema = schemaCloner.clone()
schema.anyOf?.[0] === schema.anyOf?.[1] // true — graph identity is preserved
schemaCloner.clone() === schema // true — terminal success replays exactly
```

### Shape builders

Declarative constructors for the `ContractShape` union (`src/core/shapers.ts`). The `deriveLengthBounds` and `deriveRangeBounds` rows sit in this section because schema inversion consumes them, and they live in `src/core/helpers.ts`: they build no shape, they reduce a keyword pair to a numeric bound. One shape compiles into a JSON Schema, a guard, a parser, a strict audit, a parse report, and a generator (see the compilers, below). Builders omit absent options from the produced shape object: an option left `undefined` is not present as a key, so `Object.keys`, `in` checks, and spreads see only the options actually provided.

**The snapshot-ownership model.** A builder freezes the node it returns and copies every collection you hand it — a `values` list, a `properties` map, a variant list, a `rawShape` fragment — while a `pattern` is captured and re-exposed as a fresh frozen `RegExp` per read, so editing your originals afterwards cannot reach the shape. `objectShape` enumerates a caller-owned property declaration once and carries that key/value snapshot. `cloneShape`, which must also validate a hand-authored graph, first requires every node to be a plain, null-prototype, or foreign-realm record before it reads the discriminant, then captures each declared field through own descriptors plus two agreeing reads before it builds the shell. Missing fields are carried as absent without a read; inherited fields and ordinary accessors are refused without invocation. The documented `pattern` accessor is the one exception, and its two frozen genuine-RegExp results must independently expose agreeing primitive-string `source` and `flags` pairs; no caller scalar object or conversion hook is retained. Structural children, literal values, variants, property maps, and raw-schema roots are then wired only from those captured references, never by rereading the source node. Property maps retain their separate stability mechanism: `cloneShape` compares exactly two caller enumerations and refuses second-population disagreement, while the first enumeration obtains every property child's own data descriptor and requires its value plus two reads to agree by identity. The complete declaration gate validates the carried cloned root; it does not repair or replace a captured population. Consequently, `createContract` reads a property entry exactly as often as `cloneShape` does — twice, and the two readings must agree — because it reaches the declaration the same way: there is no discarded pre-ownership walk, so there is no second caller population to disagree with the captured one. That single captured clone controls every artifact, an invalid captured population is refused by the gate that runs over the clone, and no third caller value read occurs. `ownShape` retains the already-performed `cloneShape` result for frozen and unfrozen inputs alike, so no caller-owned root or reference-bearing child is returned by identity. Thus a malformed value container, raw-schema child, discriminant, scalar, or structural slot cannot become plausible merely because copying would normalize it. A hand-authored `{ category: 'string', pattern }` node receives the same accessor-owned pattern snapshot as builder output and must likewise use an unflagged genuine local- or foreign-realm `RegExp`; inline constructs express the supported flag-like behavior. `createContract` takes its own `cloneShape` snapshot of the whole graph, so its `schema` / `is` / `parse` / `audit` / `explain` / `generate` are fixed at construction and cannot drift with a later edit to the shape you passed. The practical rule: build shapes with the builders, and treat a shape you assemble by hand as caller-owned until a compiler or `ownShape` has copied it.

| Builder              | Kind     | Summary                                                                                                                                                                                                                                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stringShape`        | function | Builds a string `StringShape`.                                                                                                                                                                                                                                                          |
| `numberShape`        | function | Builds a numeric `NumberShape`.                                                                                                                                                                                                                                                         |
| `integerShape`       | function | Builds an integer `NumberShape` — forces `integer: true`.                                                                                                                                                                                                                               |
| `booleanShape`       | function | Builds a `BooleanShape`.                                                                                                                                                                                                                                                                |
| `nullShape`          | function | Builds a `NullShape`.                                                                                                                                                                                                                                                                   |
| `literalShape`       | function | Builds a literal shape from a fixed set of primitive values.                                                                                                                                                                                                                            |
| `arrayShape`         | function | Builds an `ArrayShape` from an element shape.                                                                                                                                                                                                                                           |
| `objectShape`        | function | Builds an `ObjectShape` from a property map.                                                                                                                                                                                                                                            |
| `recordShape`        | function | Builds an open `ObjectShape` with no fixed properties — a dictionary.                                                                                                                                                                                                                   |
| `unionShape`         | function | Builds a `UnionShape` from a list of variant shapes (`anyOf` in JSON Schema).                                                                                                                                                                                                           |
| `oneOfShape`         | function | Builds a `UnionShape` that emits `oneOf` (exactly one match) in JSON Schema.                                                                                                                                                                                                            |
| `optionalShape`      | function | Wraps a shape so it may be absent (`undefined`).                                                                                                                                                                                                                                        |
| `nullableShape`      | function | Wraps a shape so it may be `null`.                                                                                                                                                                                                                                                      |
| `jsonShape`          | function | Builds a `JSONShape`.                                                                                                                                                                                                                                                                   |
| `rawShape`           | function | Builds a `RawShape` from a supported JSON Schema fragment.                                                                                                                                                                                                                              |
| `schemaToShape`      | function | Converts a runtime `JSONSchema` value into a validating `ContractShape` — the inverse of `compileSchema`. Unlike direct `rawShape` construction, which rejects malformed supported-vocabulary keywords, this conversion is total and widens an inexpressible input to a valid raw `{}`. |
| `deriveLengthBounds` | function | Derives `min`/`max` shape bounds from a pair of non-negative-integer JSON Schema length keywords (`minLength`/`maxLength`, `minItems`/`maxItems`).                                                                                                                                      |
| `deriveRangeBounds`  | function | Derives `min`/`max` shape bounds from a pair of finite-number JSON Schema range keywords (`minimum`/`maximum`).                                                                                                                                                                         |

Raw-schema validation is deliberately structural and vocabulary-domain validation, not a full JSON Schema solver. It checks that every keyword is supported, every keyword value has the declared runtime domain, arrays are dense and vocabularies unique where required, every member captured from a present `properties`, dense `anyOf`, or dense `oneOf` population is a plain record, patterns compile, and the graph stays acyclic and within the depth limit. Population is determined by membership, so a present member valued `undefined` is refused rather than erased as absence; omitted optional keywords, plus explicitly `undefined` `items` and `additionalProperties`, retain their absence behavior. It does not resolve cross-keyword contradictions such as `minLength: 5` with `maxLength: 1`, require each `required` name to appear in `properties`, enforce keyword/type coherence, compare `enum` members with `type`, or restrict `format` to a known vocabulary; those semantic interactions remain the responsibility of a full JSON Schema implementation.

`rawShape` first validates the caller-visible fragment, clones it exactly once, validates that exact owned clone, and returns that same frozen clone. A caller phase change that makes the captured population invalid is therefore refused; a valid captured population is the one published, and failures during the single clone retain the established `cloneSchema` diagnostic.

Direct declaration populations are dense data arrays too. A sparse literal is refused immediately with `validateShape: values must be a dense data array` at the container path `[…path, 'values']`; a sparse union is refused symmetrically with `validateShape: variants must be a dense data array` at `[…path, 'variants']`. Both are cause-free `structure` diagnostics, before any descriptor/stability walk. Raw `enum`, `required`, `anyOf`, and `oneOf` retain their existing dense-array vocabulary and apply it to the same bounded reflected snapshot.

`schemaToShape` is the sole entry point for the conversion. The walk behind it is interned, so the door's name is the only one a refusal ever carries and the caller reaches the host failure through one `cause`.

The precedence below assumes a readable node. A readable malformed keyword is ignored and widens according to the listed rule; a keyword access, enumeration, or recursive traversal that throws is not malformed schema vocabulary and is refused with `ContractError { code: 'structure', context: { shape: 'schema' } }`.

`schemaToShape`'s precedence, top-down at each node (every keyword read is type-guarded; a malformed keyword is IGNORED, not thrown): (1) `enum` (≥ 1 string/number/boolean entry) → `literalShape`. (2) `oneOf` (≥ 1 record entry) → `oneOfShape` over the recursed variants, PROVIDED the record-entry count is at or under `INFER_BREADTH_LIMIT`; over the cap, building a subset union would be strictly narrower than the schema's full union, so the node widens to `rawShape` instead of sampling a subset. (3) `anyOf` identically → `unionShape`, with the same over-cap widen-to-`rawShape` rule rather than a subset union. (4) `type: 'string'/'number'/'integer'/'boolean'/'null'` → the matching primitive shape, with `minLength`/`maxLength`/`minimum`/`maximum` bounds kept only when well-formed and non-contradictory (a malformed or `min > max` pair drops to unbounded — widening, never narrowing). (5) `type: 'array'` → `arrayShape`, recursing into a record-valued `items` (else `rawShape`), with `minItems`/`maxItems` bounds. (6) `type: 'object'` (or no `type`/`enum`/`oneOf`/`anyOf` but a record `properties`) → `objectShape`: a property not listed in `required` is wrapped `optionalShape`; `additionalProperties: false` closes, a record value recurses into it (`objectShape` validates extras against that shape directly — no widening needed), and `true` / ABSENT / anything malformed leaves it open (`true`) — absent matches JSON Schema's own default, and `valueToSchema` / `samplesToSchema` always emit the keyword explicitly, so an absent value only arises from a hand-written schema. When `properties` has MORE keys than `INFER_BREADTH_LIMIT`, the schema's own `additionalProperties` is OVERRIDDEN and forced open (`true`) regardless of `false` or a record value — a key dropped past the sampling cap was never checked against a closed or record-valued rest shape, so forcing the object open is the only sound widening — mirroring the inferers' own `truncated ? true : !closed` rule. (7) Everything else — `{}`, an unrecognized `type`, exhausted depth (`INFER_DEPTH_LIMIT`), or a cyclic re-encounter — widens to `rawShape` (NOT `jsonShape`: `{}` is JSON Schema’s accept-anything schema, and `rawShape` is its exact inverse — its guard accepts every defined value and it re-emits `{}` verbatim, whereas `jsonShape`’s `isJSONValue` guard would reject the exotic originals (`Map`, `Set`, a class instance, a function, `NaN`) whose inferred schema is exactly `{}`). A `WeakMap` memo (keyed by schema-node identity + remaining depth), mirroring the inferers, guards a shared-reference schema DAG against exponential re-conversion. **Its key does not carry the active-ancestor set, and that is observable**: a node first reached through a CYCLIC path is cached with the shape it widened to at the back-edge, and a later ACYCLIC path is served that cached shape instead of descending further. Two schemas differing only in which sibling holds the cyclic node therefore convert to different shapes. Every such difference is a WIDENING — an accept-anything `rawShape` — so no value is wrongly rejected and the round-trip law is unaffected; what it costs is determinism ACROSS graphs, not within one, since the same input always converts the same way. This is stated as a limit rather than repaired because both repairs (dropping the ancestor set, or threading a cycle-affected flag through three public signatures) change the published surface.

**Round-trip law:** for any READABLE value `v` — including `NaN`, `±Infinity`, a `Map`, a `Set`, a class instance, a function, a symbol, a bigint, and readable cyclic hosts — `compileGuard(schemaToShape(valueToSchema(v)))(v) === true`, with widening as the ONLY source of looseness, never narrowing. An unreadable host is refused before the law produces a schema. The law otherwise retains its three limits: JSON absence, `Date` serialization, and unstable reads between inference and validation. A widened node cannot be auto-generated: `createContract(schemaToShape(x)).generate()` throws when the conversion widened anywhere; its parser returns `undefined` for readable invalid input and propagates the shared coded refusal when a required read fails.

```ts
import { samplesToSchema, schemaToShape, createContract } from '@orkestrel/contract'

const schema = samplesToSchema([
	{ id: 1, name: 'Ada' },
	{ id: 2, name: 'Grace' },
])
const contract = createContract(schemaToShape(schema))
contract.parse({ id: 3, name: 'Alan' }) // { id: 3, name: 'Alan' }
contract.parse({ id: 'nope', name: 'x' }) // undefined
```

### Shape types

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A resolver whose value is a multi-branch
conditional carries none, and its `Summary` states what the resolution produces.

| Type                  | Kind      | Shape                                                                                                                                                                           | Summary                                                                                                                                                                                                           |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContractShape`       | type      | `StringShape \| NumberShape \| BooleanShape \| NullShape \| LiteralShape \| ArrayShape \| ObjectShape \| UnionShape \| OptionalShape \| NullableShape \| JSONShape \| RawShape` | Describes a value declaratively — a declaration the shape builders build and the compilers turn into a guard, a parser, a JSON Schema, and a generator.                                                           |
| `StringShape`         | interface | `{ category, min?, max?, pattern?, description? }`                                                                                                                              | Describes a string with optional length and pattern constraints.                                                                                                                                                  |
| `NumberShape`         | interface | `{ category, min?, max?, integer?, description? }`                                                                                                                              | Describes a number with optional bounds; `integer` restricts to whole numbers.                                                                                                                                    |
| `BooleanShape`        | interface | `{ category, description? }`                                                                                                                                                    | Describes a boolean — accepts only `true` or `false`.                                                                                                                                                             |
| `NullShape`           | interface | `{ category, description? }`                                                                                                                                                    | Describes a null value — accepts only `null`.                                                                                                                                                                     |
| `LiteralShape`        | interface | `{ category, values, description? }`                                                                                                                                            | Describes a literal — accepts exactly one of a fixed set of primitive values.                                                                                                                                     |
| `ArrayShape`          | interface | `{ category, items, min?, max?, description? }`                                                                                                                                 | Describes an array with an element shape and optional length bounds.                                                                                                                                              |
| `ObjectShape`         | interface | `{ category, properties, additionalProperties?, description? }`                                                                                                                 | Describes an object — a map of property names to child shapes.                                                                                                                                                    |
| `UnionShape`          | interface | `{ category, variants, mode?, description? }`                                                                                                                                   | Describes a union — accepts a value matching any one variant (first match wins).                                                                                                                                  |
| `OptionalShape`       | interface | `{ category, inner }`                                                                                                                                                           | Wraps an inner shape that may be absent (`undefined`).                                                                                                                                                            |
| `NullableShape`       | interface | `{ category, inner }`                                                                                                                                                           | Wraps an inner shape that may be `null`.                                                                                                                                                                          |
| `JSONShape`           | interface | `{ category, description? }`                                                                                                                                                    | Describes a JSON passthrough — accepts any JSON value.                                                                                                                                                            |
| `RawShape`            | interface | `{ category, schema }`                                                                                                                                                          | Describes a validated raw JSON Schema passthrough — embeds a supported schema fragment directly.                                                                                                                  |
| `Infer`               | type      |                                                                                                                                                                                 | Resolves the static TypeScript type a `ContractShape` describes.                                                                                                                                                  |
| `InferObject`         | type      |                                                                                                                                                                                 | Resolves `Infer` of an object shape's `properties` — the required keys, plus the `optional`-wrapped keys as optional members, plus the index-signature contribution of `additionalProperties` (see `InferIndex`). |
| `InferIndex`          | type      |                                                                                                                                                                                 | Computes the index-signature contribution of a pure record shape's `additionalProperties` — the `recordShape` case, where `properties` is empty.                                                                  |
| `InferOpenIndex`      | type      |                                                                                                                                                                                 | Computes the index-signature contribution of a MIXED object shape's `additionalProperties` — one with both fixed `properties` and an open tail.                                                                   |
| `InferMutable`        | type      | `{ -readonly [K in keyof Infer<S>]: Infer<S>[K] }`                                                                                                                              | Strips the TOP-LEVEL `readonly` modifiers from `Infer` (a shallow strip — nested object/array properties stay readonly) — for consumers writing the parsed value's own fields.                                    |
| `InferUnion`          | type      | `V extends ReadonlyArray<infer U> ? (U extends ContractShape ? Infer<U> : never) : never`                                                                                       | Resolves `Infer` of a union shape's `variants` — the union of each variant's inferred type.                                                                                                                       |
| `StringShapeOptions`  | interface | `{ min?, max?, pattern?, description? }`                                                                                                                                        | Groups the options for `StringShape` (through `stringShape`).                                                                                                                                                     |
| `NumberShapeOptions`  | interface | `{ min?, max?, integer?, description? }`                                                                                                                                        | Groups the options for `NumberShape` (through `numberShape` / `integerShape`).                                                                                                                                    |
| `BooleanShapeOptions` | interface | `{ description? }`                                                                                                                                                              | Groups the options for `BooleanShape` (through `booleanShape`).                                                                                                                                                   |
| `NullShapeOptions`    | interface | `{ description? }`                                                                                                                                                              | Groups the options for `NullShape` (through `nullShape`).                                                                                                                                                         |
| `JSONShapeOptions`    | interface | `{ description? }`                                                                                                                                                              | Groups the options for `JSONShape` (through `jsonShape`).                                                                                                                                                         |
| `LiteralShapeOptions` | interface | `{ description? }`                                                                                                                                                              | Groups the options for `LiteralShape` (through `literalShape`).                                                                                                                                                   |
| `ArrayShapeOptions`   | interface | `{ min?, max?, description? }`                                                                                                                                                  | Groups the options for `ArrayShape` (through `arrayShape`).                                                                                                                                                       |
| `ObjectShapeOptions`  | interface | `{ additionalProperties?, description? }`                                                                                                                                       | Groups the options for `ObjectShape` (through `objectShape`).                                                                                                                                                     |
| `RecordShapeOptions`  | interface | `{ description? }`                                                                                                                                                              | Groups the options for record shapes (through `recordShape`).                                                                                                                                                     |

### Compilers

Turn one `ContractShape` into the six lockstep outputs — `schema` / `is` / `parse` / `audit` / `explain` / `generate` (`src/core/compilers.ts`). `createContract` is the one door in this section that returns an entity rather than a compiled projection, so it lives in `src/core/factories.ts` over the same engine. Two engines sit under those functions. `ShapeValidator` owns the sole stateful declaration walk; `validateShape` constructs a fresh validator as its eager function boundary, while `cloners.ts`, `ShapeCloner`, and the shape builders use the class directly so lower validation no longer imports the compiler module. `ContractCompiler` owns ownership, preparation, and the six artifact families; every function in this section is a real typed door over it that requests exactly the root it is named for, so asking for a guard never compiles a generator. LOCKSTEP here means DERIVED FROM ONE SNAPSHOT, not equal in what they accept: `createContract` compiles all six from a single owned copy of the declaration, so no later edit to the shape you passed can move one of them without the others. It does not mean the six accept the same values — deliberately, they do not (see Domains, below). The individual compilers return untyped runtime functions; `createContract` is the typed entry point — its `is` / `parse` / `generate` carry `Infer<S>` by inferring once, at the boundary (so the recursion stays cheap). `compileGuard` / `compileParser` / `compileReporter` / `compileAuditor` reuse the existing combinators and parsers rather than re-implementing them: `literalOf` IS the literal match at all four (one SameValueZero implementation, taking its vocabulary as an array), and each leaf's refinements (`min` / `max` / `pattern`) are read off the one shape node rather than restated per artifact — `compileGuard` and `compileParser` compose them through the **same** combinators (`stringOf` for a string's length and pattern, `boundsOf` for a number's value and an array's length), while `compileReporter` and `compileAuditor` check those same three against that same node inline, so each violated refinement can carry its own fault; the pattern test is the same flag-stripped owned `RegExp` in every artifact (`matchOf` for the two reports, the identical construction inside `stringOf` for the guard and parser). No artifact — not `compileGuard`, not `compileParser`, not `compileReporter`, not `compileAuditor` — holds a bound of its own to drift from the other three. What the four do NOT share is the leaf TYPE test: `compileGuard` and `compileAuditor` demand a `string`, `compileParser` and `compileReporter` accept whatever `parseString` coerces — which is where the two domains part company. Every entry point reaches the same declaration-rule set through validation or ownership, and `cloneShape` asks that claim of the carried cloned root after its node fields have completed descriptor/two-read capture and its property map has completed its separate enumeration and child-capture checks. The validator mirrors the ownership boundary by rejecting ordinary declared-field accessors before `Reflect.get`, while preserving the documented `pattern` exception. No entry can therefore launder a malformed property/variant/value container, discriminant, scalar accessor, vocabulary, raw-schema child, or structural child into a plausible contract. Every compiled object artifact — guard, parser, reporter, auditor, and the inference direction too — reads an object through the one `enumerableKeys` property view (own enumerable string keys, the set `JSON.stringify` serializes), so all of them see the SAME key set. What each does with an undeclared key in that set differs by design: for a CLOSED object `is` rejects the object, `audit` reports an `'extra'` fault at the key, `parse` drops the key WITHOUT reading it, `explain` says nothing about it, and `schema` forbids it with `additionalProperties: false`. For an OPEN one they all READ it, including under `additionalProperties: true` where nothing constrains the value: open means unconstrained, not unobserved, and the parser copies every such key into its result. Skipping that read on three of the four doors is how `is`, `audit` and `explain` all certified a value clean that `parse` then refused as unreadable.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a
guard row's the type it narrows to. A class row's `Shape` cell holds the interface it
implements, or its constructor signature where it implements none.

| API                         | Kind      | Shape                                                                      | Summary                                                                                                                                                                                    |
| --------------------------- | --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ShapeValidator`            | class     | `ShapeValidatorInterface`                                                  | Validates one retained contract-shape source live on every call.                                                                                                                           |
| `ShapeValidatorInterface`   | interface | `{ expansion } plus validate`                                              | Validates one retained contract-shape source on demand.                                                                                                                                    |
| `validateShape`             | function  | `(shape: ContractShape) => void`                                           | Gates recursive compiler work on shape structure, depth, and cycles.                                                                                                                       |
| `compileGuard`              | function  | `<S extends ContractShape>(shape: S) => Guard<Infer<S>>`                   | Compiles a `ContractShape` into a runtime type guard.                                                                                                                                      |
| `compileParser`             | function  | `<S extends ContractShape>(shape: S) => Parser<Infer<S>>`                  | Compiles a `ContractShape` into an input parser.                                                                                                                                           |
| `compileSchema`             | function  | `(shape: ContractShape) => JSONSchema`                                     | Compiles a `ContractShape` into a JSON Schema document.                                                                                                                                    |
| `compileGenerator`          | function  | `<S extends ContractShape>(shape: S, random?: RandomFunction) => Infer<S>` | Compiles a `ContractShape` into a deterministic seed value.                                                                                                                                |
| `createContract`            | function  | `<S extends ContractShape>(shape: S) => ContractInterface<Infer<S>>`       | Compiles a `ContractShape` into a `ContractInterface` — the lockstep outputs from one declaration, lockstep meaning derived from one owned snapshot rather than accepting the same values. |
| `ContractInterface`         | interface | `{ schema, is } plus parse, audit, explain, generate`                      | Represents a compiled contract — the lockstep outputs derived from one shape.                                                                                                              |
| `ContractCompiler`          | class     | `ContractCompilerInterface`                                                | Owns one contract shape's artifacts and their bundle, compiled lazily.                                                                                                                     |
| `ContractCompilerInterface` | interface | `{ schema, guard, parser, auditor, reporter, generator, contract }`        | Owns one contract shape's compiled artifacts plus their bundle, lazily.                                                                                                                    |
| `RandomFunction`            | type      | `() => number`                                                             | Represents a deterministic random source returning a value in `[0, 1)`.                                                                                                                    |
| `AuditorFunction`           | type      | `(value: unknown, path?: readonly string[]) => readonly AuditFault[]`      | Represents a compiled strict-domain diagnostic — the shape of `compileAuditor` bound to one shape.                                                                                         |
| `ReporterFunction`          | type      | `(value: unknown, path?: readonly string[]) => readonly Fault[]`           | Represents a compiled coercive-domain diagnostic — the shape of `compileReporter` bound to one shape.                                                                                      |
| `SeederFunction`            | type      | `(random?: RandomFunction) => T`                                           | Represents a compiled seed-data source — the shape of `compileGenerator` bound to one shape.                                                                                               |
| `GENERATION_ATTEMPT_LIMIT`  | const     | `number`                                                                   | Caps at `32` the number of candidate-generation attempts for a constrained generated value, frozen.                                                                                        |
| `COMPILE_DEPTH_LIMIT`       | const     | `number`                                                                   | Caps at `512` the supported nesting depth of a compiled contract shape, frozen.                                                                                                            |
| `COMPILE_NODE_LIMIT`        | const     | `number`                                                                   | Caps at `16384` the number of nodes a compiled artifact may expand a shape into, frozen.                                                                                                   |
| `PRESENCE_MASK_LIMIT`       | const     | `number`                                                                   | Caps at `31` the number of object keys one compiled presence mask carries, frozen.                                                                                                         |

`ContractCompilerInterface` declares no call-signature member, so it has no Methods table: its
whole surface is the readonly data properties — `schema` (a `JSONSchema`), `guard` (a
`Guard<Infer<S>>`), `parser` (a `Parser<Infer<S>>`), `auditor` (an `AuditorFunction`), `reporter`
(a `ReporterFunction`), `generator` (a `SeederFunction<Infer<S>>`), and `contract` (a
`ContractInterface<Infer<S>>`). `contract` is the frozen bundle whose own enumerable keys are
`schema`, `is`, `parse`, `audit`, `explain`, and `generate` in that order, each holding the exact
value the corresponding getter publishes — `contract.is` is exactly `compiler.guard`, by
identity rather than as a copy of it.

Compilation costs ONE ownership and ONE validation per call, not one per node. Every `compile*` entry and `createContract` construct a `ContractCompiler`, which owns the declaration once, validates that owned graph once, and indexes each unique node and structural edge once; the artifact families are postorder passes over that index. This is what replaced the arrangement where each recursive invocation re-ran `ownShape` AND `validateShape` over the subgraph it received — quadratic work for a linear declaration, and the reason a 129-node depth chain used to measure 6.3 ms of gate plus 7.9 ms of ownership and a 257-node chain 26.0 + 41.9 ms. A 30-alias depth-100 declaration now compiles a guard in 3 ms and a whole contract in 4 ms, against 640 ms and 1.87 s before. `createContract` precompiles every artifact, so `audit`, `explain` and `generate` re-walk and re-gate nothing on a later call either; `contract.audit` and `compileAuditor` are the same compiled function reached by different names. A compiled artifact is no longer a TREE either. Each family holds one entry per unique node and a parent points at its children, so a shared child is compiled once and the emitted schema preserves that sharing — which is why the cap boundary stopped being expensive: `createContract` over the two-edge-per-level DAG at the 16,383-node boundary now takes under a millisecond where it took 1,342 ms, because it compiles fourteen nodes rather than sixteen thousand. Cost tracks AUTHORED nodes and edges instead: measured here, a depth-100 chain and a 30-alias depth-100 staircase answer every door in 1–5 ms, and a flat 10,001-node object takes 52–68 ms per artifact and 110 ms for a whole contract. One level past the cap boundary — 32,767 emitted nodes over thirty-one authored ones — still refuses in about two milliseconds with code `expansion`, because the count is measured over the captured graph rather than by walking the expansion. What the cap now protects is the consumer's side of the artifacts rather than the compiler's: `generate` materializes the whole tree, and so does serializing the schema. The JSON cloner is capped for the opposite reason — it DUPLICATES a shared alias by contract rather than re-walking it: see `CLONE_NODE_LIMIT`. The `samplesToSchema` family is not on this list and was never meant to be reachable: its record path carried neither an ancestor set nor a memo, so an ordinary shared reference bought `k^depth` visits; it now memoizes a single-row slot on `(row, remaining depth)` exactly as the record branch of `valueToSchema` does. Everything above is the DECLARATION side, and for one release that was the only side measured. A compiled artifact applies each child artifact once per OCCURRENCE, which is right for a tree and wrong for a graph, so a value whose levels each held two references to one object was walked once per PATH: twenty-two shared arrays against a twenty-three-node chain of `arrayShape` — zero aliases in the declaration, every published limit satisfied — cost 524,286 node reads, 4.4 s for `is` and 8.4 s for `audit`, growing fourfold per two levels, while the same declaration over a TREE value answered instantly and `valueToSchema` answered the same graph in 4 ms because it already memoized. The verdict families now carry a per-CALL identity memo keyed by `(compiled node, value object)`, and the same value now costs thirty-six reads and under a millisecond. These details are exact rather than incidental. The guard reuses either answer while the auditor and reporter reuse only the CLEAN one, because a fault carries the path it was found at and emptiness carries nothing — a faulted node is re-walked and bounded by `FAULT_LIMIT` instead. Each node's memo is tagged with the call that filled it and nothing else releases it, so an answer never survives into a later call where the caller may have changed the value. And a leaf is not tracked at all: it descends into no child, so tracking one would buy nothing and would replace the package's own guards and parsers in the artifacts a leaf-rooted declaration publishes. `parse` is deliberately absent from that list, because its result IS the expansion; the threat model names what that costs.

String and array length bounds deliberately use the builders' FULL rule — every present bound is a non-negative safe integer — rather than merely checking finiteness. A finiteness-only gate would close the `NaN` / infinity bypass but still admit hand-authored negative, fractional, and unsafe-integer length keywords that no builder can produce and that are not valid JSON Schema length bounds. Matching the builders costs compatibility only for those already-malformed hand-authored shapes; it preserves every legitimate builder output and keeps guard, parser, audit, and schema semantics on one domain.

> A shape nesting a `rawShape` or a pattern-constrained `stringShape` still compiles cleanly (`compileSchema` / `compileGuard` / `compileParser` all succeed) — only `generate()` throws at CALL time, once it walks down into that leaf, because a `rawShape`'s embedded schema is arbitrary and a pattern the generator cannot satisfy has no auto-generatable sample.

The depth gate is why a pathological shape fails as a diagnosis rather than as a stack overflow — and it holds whether you reach the compilers through `createContract` or call one directly:

```ts
import type { ContractShape } from '@orkestrel/contract'
import { arrayShape, compileGuard, stringShape, validateShape } from '@orkestrel/contract'

let deep: ContractShape = stringShape()
for (let level = 0; level < 600; level += 1) deep = { category: 'array', items: deep }

validateShape(deep) // throws a ContractError with code 'depth'
compileGuard(deep) // the same throw — every compile* entry fidelity-checks ownership, then gates
```

Every builder validates every runtime argument position before freezing its result. At every options position, a primitive or readable array/class instance throws a `structure` `ContractError` saying that the builder's options must be a plain record. A failure while reading any option key that builder consumes, or while snapshotting the options record, routes through the shared constructor as `<builder>: options could not be read`; no failed read becomes an absent option. Each consumed option is read once and its one non-`undefined` answer is copied into the snapshot as own enumerable data, including inherited and non-enumerable answers; unrelated properties remain irrelevant. `{}` is accepted and constrains nothing. Invalid bounds use the total `preview` diagnostic, so even a hostile `Symbol.toPrimitive` receives the existing `bound` refusal instead of leaking its raw error. The wider construction gate also covers `description` domains, child-shape slots, finite/ranged bounds, non-empty dense unique literal/union vocabularies, integer-range satisfiability, optional placement, and `rawShape`'s recursive supported-schema vocabulary. A malformed builder call therefore throws a coded `ContractError` at construction instead of leaking a raw host error or returning a node that only a later compiler rejects. Hand-authored declarations remain checked at ownership and by `validateShape` before artifact recursion.

```ts
import type { ContractShape } from '@orkestrel/contract'
import { compileGuard, objectShape } from '@orkestrel/contract'

const source: { readonly child: ContractShape } = JSON.parse('{}')
objectShape({ child: source.child }) // throws ContractError { code: 'structure', context: { path: ['properties', 'child'] } }
```

### Inferers

The **reverse** direction of `compileSchema` (`src/core/inferers.ts`): instead of emitting a `JSONSchema` from a developer-authored `ContractShape`, these infer a `JSONSchema` at runtime from an unknown/opaque value — a database row, a parsed endpoint payload — so an inferred schema can flow through the same `schemaToParameters` → `createTool` → MCP `inputSchema` bridge a hand-declared shape does. Unlike a shape tree (finite, developer-authored, never cyclic), a runtime value may be arbitrarily deep, wide, or self-referential, so every inferer here is bounded on three axes: a `WeakSet` ancestor set (cycle safety), a decrementing depth budget (`INFER_DEPTH_LIMIT` default), and a per-container sampling cap (`INFER_BREADTH_LIMIT` default) — never a type parameter, conditional type, mapped type, or overload. Readable unsupported values may widen where documented; a failed read throws the shared coded refusal instead of producing a schema.

One deliberate asymmetry with the compiled direction: an inferred schema is a PLAIN, MUTABLE result, not an owned frozen snapshot. `compileSchema` and `contract.schema` are frozen because they must stay in lockstep with a guard and parser compiled beside them; `valueToSchema` / `samplesToSchema` answer a question about one value and hand you the answer to edit — annotate a `description`, drop a column, merge two fragments. When you need the ownership guarantee, take it explicitly: `cloneSchema(schema)` for a frozen copy, `rawShape(schema)` to embed one in a shape, or `createContract(schemaToShape(schema))` for the full compiled bundle.

The canonicalization leaves (`canonicalStringify`, `encodeLeaf`) and the format-classification leaves (`classifyFormat`, `matchesISOInstant`) are listed here beside the inferers that consume them, and they live in `src/core/helpers.ts`: each is a pure encoding or classification leaf that emits no schema.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a
guard row's the type it narrows to.

| API                    | Kind      | Shape                                                                         | Summary                                                                                                                                                                           |
| ---------------------- | --------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `valueToSchema`        | function  | `(value: unknown, options?: ValueToSchemaOptions) => JSONSchema`              | Infers a `JSONSchema` for one unknown value — the reverse direction of `compileSchema`.                                                                                           |
| `samplesToSchema`      | function  | `(samples: readonly unknown[], options?: ValueToSchemaOptions) => JSONSchema` | Infers a `JSONSchema` from a set of example values — the multi-example counterpart of `valueToSchema` (for example inferring one schema from several database rows).              |
| `unifySchemas`         | function  | `(schemas: readonly JSONSchema[]) => JSONSchema`                              | Unifies a list of inferred `JSONSchema` fragments into one schema.                                                                                                                |
| `canonicalStringify`   | function  | `(value: unknown) => string \| undefined`                                     | Renders a value as a deterministic, key-sorted JSON string — or `undefined` when it has no faithful JSON encoding.                                                                |
| `encodeLeaf`           | function  | `(value: unknown) => string \| undefined`                                     | Encodes one non-container value the way JSON encodes it, or `undefined` when JSON cannot encode it at all.                                                                        |
| `buildSampleMemo`      | function  | `() => SampleMemo`                                                            | Builds one empty `SampleMemo` node.                                                                                                                                               |
| `readSampleMemo`       | function  | `(memo: SampleMemo, reader: string) => SampleMemo`                            | Checks that a value really is a `SampleMemo` before a walk stores a published schema in it.                                                                                       |
| `inferPrimitiveEnum`   | function  | `(values: readonly unknown[], limit: number) => JSONSchema \| undefined`      | Infers an `{ enum: [...] }` fragment for a low-cardinality, repeated primitive slot — the multi-sample-only counterpart to `stringToFormat` (`valueToSchema` never emits `enum`). |
| `stringToFormat`       | function  | `(value: string) => SchemaFormat \| undefined`                                | Classifies a string against the `SchemaFormat` vocabulary.                                                                                                                        |
| `classifyFormat`       | function  | `(value: string) => SchemaFormat \| undefined`                                | Classifies an already-bounded string against the pattern-only and calendar-checked `SchemaFormat` vocabulary.                                                                     |
| `samplesToFormat`      | function  | `(values: readonly unknown[]) => SchemaFormat \| undefined`                   | Classifies a list of sample values against the `SchemaFormat` vocabulary, requiring unanimity.                                                                                    |
| `matchesISOInstant`    | function  | `(value: string) => boolean`                                                  | Checks whether a supported ISO-8601 date or date-time names a real instant.                                                                                                       |
| `ValueToSchemaOptions` | interface | `{ limits?, closed?, format?, enum? }`                                        | Groups the options for `valueToSchema` / `samplesToSchema`.                                                                                                                       |
| `ValueToSchemaLimits`  | interface | `{ depth?, properties? }`                                                     | Holds the per-walk budgets `ValueToSchemaOptions` groups under `limits`.                                                                                                          |
| `SampleMemo`           | interface | `{ rows, schemas }`                                                           | Holds the per-walk memo the multi-sample walk behind `samplesToSchema` owns, keyed by the ORDERED identities of the rows a slot collected.                                        |
| `sanitizeDepth`        | function  | `(value: number \| undefined) => number`                                      | Resolves a caller's depth budget to one the traversal can actually survive.                                                                                                       |
| `sanitizeBudget`       | function  | `(value: number \| undefined, fallback: number) => number`                    | Sanitizes a user-supplied inference budget (`limits.depth` / `limits.properties`) to a finite non-negative integer, selecting a valid fallback for anything else.                 |
| `INFER_DEPTH_LIMIT`    | const     | `number`                                                                      | Caps at `32` the object/array nesting depth `valueToSchema` walks, frozen.                                                                                                        |
| `INFER_BREADTH_LIMIT`  | const     | `number`                                                                      | Caps by default at `256` the number of object properties / array elements `valueToSchema` samples per container, frozen.                                                          |
| `INFER_ENUM_LIMIT`     | const     | `number`                                                                      | Caps by default at `12` the number of distinct values a multi-sample slot may hold before enum inference gives up and falls back to a bare `type`, frozen.                        |
| `FORMAT_MAX_LENGTH`    | const     | `number`                                                                      | Caps at `128` the string length `stringToFormat` attempts to classify, frozen.                                                                                                    |
| `FORMAT_PATTERNS`      | const     | `Readonly<Record<'uuid' \| 'email' \| 'uri', RegExp>>`                        | Holds the pure-regex matchers backing `stringToFormat`'s pattern-only formats (`uuid` / `email` / `uri`), frozen as data.                                                         |

Canonicalization classifies every non-null object at the read boundary before choosing a traversal. Arrays retain the dense indexed path; the shared realm-neutral `matchesRecordBrand` rule selects sorted own keys for ordinary, null-prototype, and foreign-realm plain records; every other readable exotic object — including a class whose prototype a caller reparented to `null` — keeps the existing `JSON.stringify` fallback. A failed prototype inspection is unreadable structure, reported as `canonicalStringify: value could not be read`.

> **MCP caveat.** A non-object root schema — `valueToSchema('hello')` infers `{ type: 'string' }` — is structurally accepted by `schemaToParameters` (any `JSONSchema` is a record), but MCP clients expect an object-shaped `inputSchema`. Wrap a non-object schema with `schemaToObject` (a single required `value` property) before advertising it as a tool's parameters.

```ts
import { samplesToSchema, schemaToParameters, valueToSchema } from '@orkestrel/contract'

// One opaque row → a schema, ready for the schemaToParameters → createTool bridge.
const row = { id: 1, name: 'Ada', tags: ['admin', 'staff'] }
valueToSchema(row)
// { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' },
//   tags: { type: 'array', items: { type: 'string' } } },
//   required: ['id', 'name', 'tags'], additionalProperties: false }

// Several rows → a key is required only when every row has it.
samplesToSchema([{ id: 1 }, { id: 2, name: 'Ada' }])
// { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } },
//   required: ['id'], additionalProperties: false }

schemaToParameters(valueToSchema(row)) // the open record a tool advertises as `parameters`
```

### Reporting

One diagnostic for each artifact that answers yes-or-no. `compileReporter` is the counterpart of `compileParser`: instead of a coerced value it returns every structured `Fault` a value has against a shape — MIRROR-PARSE semantics, so it reuses the exact leaf parsers/guards `compileParser` uses and the soundness invariant `explain(v).length === 0 ⟺ parse(v) !== undefined` holds structurally for READABLE input (`explain` mirrors `parse`'s coercion leniency, not the stricter `is`). `compileAuditor` is the counterpart of `compileGuard`: instead of a `boolean` it returns every `AuditFault` a value has against the STRICT domain, reusing the leaf guards `compileGuard` uses, so `audit(v).length === 0 ⟺ is(v)`. Each report mirrors exactly one artifact, and neither mirrors both, because `is` and `parse` accept different values — which is the subject of the next section. Before either pair compiles, `validateShape` rejects structural and bound-domain malformations; the laws are evaluated only for a valid declaration. Both biconditionals span two separate calls, so both require STABLE reads; the parse biconditional additionally requires the read to succeed rather than raise its coded refusal (see Domains).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a
guard row's the type it narrows to.

| API                   | Kind      | Shape                                                                                                                                                                                                                                            | Summary                                                                                                                                 |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `compileAuditor`      | function  | `(shape: ContractShape, value: unknown, path?: readonly string[]) => readonly AuditFault[]`                                                                                                                                                      | Audits a value against the strict acceptance domain of a `ContractShape`.                                                               |
| `compileReporter`     | function  | `(shape: ContractShape, value: unknown, path?: readonly string[]) => readonly Fault[]`                                                                                                                                                           | Compiles a `ContractShape` into a structured fault report for a value — the diagnostic counterpart of `compileGuard` / `compileParser`. |
| `buildStringFaults`   | function  | `(shape: StringShape, value: string, path: readonly string[], pattern?: RegExp) => readonly Fault[]`                                                                                                                                             | Builds the refinement faults a string value has against a `StringShape`.                                                                |
| `buildNumberFaults`   | function  | `(shape: NumberShape, value: number, path: readonly string[]) => readonly Fault[]`                                                                                                                                                               | Builds the refinement faults a number value has against a `NumberShape`.                                                                |
| `buildArrayFaults`    | function  | `(shape: ArrayShape, length: number, path: readonly string[]) => readonly Fault[]`                                                                                                                                                               | Builds the length faults an array has against an `ArrayShape`.                                                                          |
| `selectClosestFaults` | function  | `<T extends AuditFault>(reports: ReadonlyArray<readonly T[]>) => readonly T[]`                                                                                                                                                                   | Selects the report of the variant that came closest to matching.                                                                        |
| `shapeToKind`         | function  | `(shape: ContractShape) => FaultKind`                                                                                                                                                                                                            | Projects a `ContractShape` to the `FaultKind` it describes.                                                                             |
| `preview`             | function  | `(value: unknown) => string`                                                                                                                                                                                                                     | Renders an unknown value as a short, safe, TOTAL string for a `Fault`'s `received` field.                                               |
| `FAULT_LIMIT`         | const     | `number`                                                                                                                                                                                                                                         | Caps at `64` the number of `Fault` / `AuditFault` entries a single `explain` or `audit` report ever returns, frozen.                    |
| `PREVIEW_LIMIT`       | const     | `number`                                                                                                                                                                                                                                         | Caps at `64` the character length of a `preview`-rendered string, frozen.                                                               |
| `Fault`               | type      | `{ reason: 'type', path, expected, received } \| { reason: 'missing', path, expected } \| { reason: 'constraint', path, expected, constraint, limit?, received } \| { reason: 'variant', path, variants } \| { reason: 'oneOf', path, matched }` | Represents a single structured parse-failure diagnostic — one entry of an `ContractInterface.explain` report.                           |
| `ExtraFault`          | interface | `{ reason, path }`                                                                                                                                                                                                                               | Represents a key present on a value that its closed object shape does not declare.                                                      |
| `AuditFault`          | type      | `Fault \| ExtraFault`                                                                                                                                                                                                                            | Covers every fault an audit reports — the parse faults plus undeclared keys.                                                            |
| `FaultKind`           | type      | `'string' \| 'number' \| 'integer' \| 'boolean' \| 'null' \| 'literal' \| 'array' \| 'object' \| 'union' \| 'json'`                                                                                                                              | Names the kind of value a `Fault` expected — the shape-projected counterpart of a `ContractShape`'s `category`.                         |
| `FaultConstraint`     | type      | `'min' \| 'max' \| 'pattern' \| 'integer'`                                                                                                                                                                                                       | Names the refinement a `Fault` of reason `'constraint'` violates.                                                                       |

#### How a union is audited and reported

An `anyOf` union stops at the FIRST variant that reports nothing, in declaration order, and runs no later variant plan. `is` and `parse` make the same stop at the first accepting variant, so `is`, `parse`, `audit` and `explain` agree on a value one variant accepts and a later one cannot read: a refusal a later variant would have raised, such as an object variant's prototype probe, is never reached.

An `anyOf` union with no matching variant reports one `'variant'` summary plus the closest variant's own faults — fewest faults, ties favouring the lowest index. A `oneOf` union runs every variant plan, because its verdict is the match count rather than the first acceptance, and reports `'oneOf'` with the raw guard-match count; a count of `0` also appends the closest variant's faults, and a count of `2` or more stands alone. A value a later `oneOf` variant cannot read therefore still reaches the same coded refusal.

Arrays report from the shared owned sparse snapshot: an owned hole retains its per-index fault, a hostile absent source index is never read, and a failed snapshot retains the root array type fault. The auditor stops once `FAULT_LIMIT` faults exist, so even a native-maximum sparse length performs no absent source-index reads.

#### Supplying a rebuilt pattern

`buildStringFaults` applies whatever pattern it is handed and never re-reads `shape.pattern`, so a supplied pattern decides the match, the `limit` text, and whether a pattern fault is reported at all. Supply the rebuild of this same shape's own pattern, built through `readPattern`, and the report matches the omitted form, `limit` text included, because `readPattern` preserves `source` exactly. A `g` or `y` pattern makes repeated answers for one value disagree, so do not supply one.

Stripping `g` and `y` is what makes a rebuild reusable: it carries no `lastIndex` an answer could move. `compileAuditor` and `compileReporter` therefore read the declaration's `pattern` accessor once while the plan is built and hand the rebuild down as the trailing argument, instead of minting a `RegExp` per answered value. Left to rebuild, the helper asks the shape's `pattern` accessor once for the presence test that decides whether a pattern was declared at all, and once more for the rebuild that decides the match.

A leaf that declares no refinement has no refinement question, so its compiled plan answers empty past the type test without entering the helper. The helper's whole body reads the caller's SHAPE, so it runs through the same `readValue` boundary `shapeToKind` uses. The compiled doors gate a non-`RegExp` `pattern` and a non-finite bound long before the helper sees them, so the package's own path never arrives off-domain — but the door is published, and a shape a `StringShape` annotation merely vouched for reaches it unchecked.

### Domains

A compiled contract describes TWO sets of values, not one. `is` and `schema` describe the canonical domain — the values the declaration literally admits. `parse` is a map INTO that domain whose preimage is deliberately larger: it coerces `'36'` into `36` and drops a closed object's undeclared keys, so it accepts inputs `is` rejects and answers with a value `is` accepts. `explain` diagnoses the map; `audit` diagnoses the domain.

The laws that bind those domains:

```text
audit(v).length   === 0   ⟺   is(v)
explain(v).length === 0   ⟺   parse(v) !== undefined
parse(v) !== undefined    ⟹   is(parse(v))
```

Under the module-wide READABLE and STABLE definitions at the top of this guide, all three laws require stable reads, and the two parse laws additionally require readable input. Each relates two separate calls, and every call reads the value it is handed, so each holds for a value whose observable reads succeed and do not change between calls. A failed required read raises the shared coded refusal instead of producing the `undefined` result used for honest invalidity, and the read population is the same at every door: a read one door performs and another skips is a two-call law broken in one call, which is what an unread open-object extra and `parseRecord`'s eager whole-record probe each produced. A getter that answers `'allowed'` on its first read and `42` on its second, or a `Proxy` whose traps change behavior mid-flight, can leave `audit` empty and still fail `is` — the audit read one value and `is` read another. No law spanning two calls can promise otherwise, and no artifact re-reads a value to close the gap. `Object.freeze` alone does not establish those conditions because it is shallow and does not stabilize accessors. `explain`'s invariant carries both preconditions; `audit`'s carries stability for the identical two-call reason.

The ordering between the two reports follows from those three rather than standing as a fourth law: `audit(v).length === 0 ⟹ explain(v).length === 0`. Every value in the canonical domain is inside `parse`'s preimage, so a clean audit implies a clean explain; the converse fails for exactly the inputs `parse` had to work on. Reach for `audit` when you need to know what `parse` silently repaired, and for `explain` when you need to know why it gave up.

`parse` therefore is not the identity function on the values `is` already accepts. It differs in three ways:

- **Coercion.** `'36'` parses to `36` against an `integerShape`, and a string that trims to a declared literal parses to that literal. The input fails `is` and earns a `'type'` fault from `audit`; `explain` reports nothing, because nothing failed the parse.
- **Dropped extras.** A key a closed object shape does not declare is dropped from the parsed result. `is` rejects the object, `audit` reports one `'extra'` fault at the key, `schema` forbids it with `additionalProperties: false`, and `explain` stays silent — the parser repaired it, so there is nothing to explain.
- **A null-prototype copy.** The compiled object parser assembles its result on `Object.create(null)` and copies the declared keys into it, so `parse` returns a NEW null-prototype record and never the record you handed it — `contract.parse(v) !== v` holds even when `contract.is(v)` was already `true`. The copy satisfies `is` (`isRecord` accepts a `null` prototype directly) and is not frozen; the cloners build null-prototype records for the same reason — a key literally named `__proto__` has to land as own data instead of mutating a prototype. An array shape likewise returns a fresh standard array. A leaf returns its input by identity, and a union returns a guard-valid value unchanged — its identity pass runs before any coercion — so the rebuild belongs to the object and array branches, not to every `parse`.

```ts
import { createContract, integerShape, objectShape } from '@orkestrel/contract'

const contract = createContract(objectShape({ age: integerShape() }))
const input = { age: 36 }

contract.is(input) // true — already in the canonical domain
contract.parse(input) === input // false — an object parse always rebuilds
Object.getPrototypeOf(contract.parse(input)) // null
```

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed (its `readonly` data members, `schema` / `is`, stay in the Surface row above). `ContractInterface` has no implementing class: `createContract` builds it as a plain object whose shape conforms to the interface exactly, so the table below is its per-instance surface (`AGENTS.md`, Documentation contract).

#### `JSONClonerInterface`

| Method  | Returns     | Summary                                                         |
| ------- | ----------- | --------------------------------------------------------------- |
| `clone` | `JSONValue` | Clones the retained source into exact, deeply frozen JSON data. |

#### `SchemaClonerInterface`

| Method  | Returns      | Summary                                                                    |
| ------- | ------------ | -------------------------------------------------------------------------- |
| `clone` | `JSONSchema` | Clones the retained schema into a deeply frozen identity-preserving graph. |

#### `ShapeClonerInterface`

| Method  | Returns         | Summary                                                                   |
| ------- | --------------- | ------------------------------------------------------------------------- |
| `clone` | `ContractShape` | Clones the retained shape into a deeply frozen identity-preserving graph. |

This constructs a `ShapeCloner` directly, showing that its `clone` replays the same owned shape on a repeated call.

```ts
import type { ShapeClonerInterface } from '@orkestrel/contract'
import { ShapeCloner, stringShape } from '@orkestrel/contract'

const shapeCloner: ShapeClonerInterface = new ShapeCloner(stringShape({ pattern: /^ready$/ }))
const owned = shapeCloner.clone()
shapeCloner.clone() === owned // true — terminal success replays exactly
```

#### `ShapeValidatorInterface`

| Method     | Returns | Summary                                   |
| ---------- | ------- | ----------------------------------------- |
| `validate` | `void`  | Validates the retained shape declaration. |

`ShapeValidatorInterface` also carries one readonly data property, `expansion`: the number of
nodes the last successful `validate()` found the retained declaration expands into, one per node
per incoming edge, and `undefined` both before the first successful pass and after a failed one,
because neither measured one. `validateShape` reads it to apply `COMPILE_NODE_LIMIT`, and
`refuseExpansion` refuses an absent measurement rather than reading it as a small count.

##### Diagnostic precedence and reentry

Immediate depth outranks deferred structure, cycle, and domain diagnoses. Within a string declaration the fixed domain order is invalid `min`, invalid `max`, flagged pattern, then contradictory range.

Every nested and outer call inside an active pass shares the exact reentry poison object, which carries no own cause. Cleanup restores idle state, so a later independent call observes the source again. A failed pass, including a caught-reentry-poisoned outer pass, leaves `expansion` undefined, and a later successful pass replaces it.

The whole traversal is contained, and its cleanup builds its active-path set from an intrinsic captured at module evaluation, so no caller-reachable dispatch on the path can put a raw value through this door. A contained failure this class did not author is translated into `validateShape: shape reflection failed` (code `structure`, root path) carrying the exact thrown value as its cause.

#### `ContractInterface`

| Method     | Returns                 | Summary                                                                  |
| ---------- | ----------------------- | ------------------------------------------------------------------------ |
| `parse`    | `T \| undefined`        | Coerces a readable value to the contract's type, or returns `undefined`. |
| `audit`    | `readonly AuditFault[]` | Reports every strict fault a value has against this contract.            |
| `explain`  | `readonly Fault[]`      | Reports every structured parse fault a value has against this contract.  |
| `generate` | `T`                     | Produces deterministic seed data for this contract.                      |

## Contract

These invariants hold across `src/core` ↔ `contract.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `type` row in the `## Surface` tables is a real export of the contract source tree, and every contract-module export appears as a Surface row — exhaustive, both directions (`AGENTS.md`, Documentation contract). Adding, renaming, or removing a guard breaks the parity gate until the doc is reconciled.
2. **Guards are total.** `.claude/rules/patterns.md` § Validation and contracts requires it: every guard takes one `unknown`, returns a `boolean` type predicate, and **never throws** — adversarial input yields `false`. The only deferral is `lazyOf`, whose thunk runs per call; `whereOf` / `lazyOf` / `transformOf` contain a callback throw as a non-match through the core `attempt` helper.
3. **Parse ↔ guard soundness.** `.claude/rules/patterns.md` § Validation and contracts mandates it. On readable input, each standalone leaf parser (`parseString`, …) pairs with the guard for its **output type**: a guard-valid input is returned unchanged (by identity, never rejected), and every non-`undefined` output satisfies that type guard. Coercion of otherwise-invalid inputs is a bonus on top, not a violation; a failed required read is a coded refusal, not an `undefined` parse result. The **compiled** contract goes further: `compileParser` (and thus `createContract`'s `parse`) re-applies every leaf REFINEMENT after coercion through the same combinators (`stringOf` / `boundsOf`) `compileGuard` uses — so a non-`undefined` `contract.parse` always satisfies `contract.is`, refinements (`min` / `max` / `pattern`) included. That law is about parse's OUTPUT. Its readable INPUT domain is deliberately wider than `is` — a coercible leaf, a closed object's extra key — and no amount of shared machinery closes that gap, because it is the feature. What cannot drift is `compileGuard` and `compileParser`, both compiled from one snapshot; what differs, permanently, is the set each accepts (see Domains). `audit` is the report for the stricter of the two.
4. **Types are the source of truth.** `Guard`, `Parser`, and the guard-shape types are declared in [`types.ts`](../src/core/types.ts) first; guards and parsers conform to them, never the reverse.
5. **`createContract` validates before it compiles.** The declaration is owned once and that OWNED graph is validated once, before any artifact is built, and the same is true at every `compile*` entry — a malformed shape (a structural child that is not a shape, `min > max`, a non-finite number bound, an empty integer range, an empty literal/union, a literal shape holding a non-finite number value, an `optionalShape` placed anywhere but a direct object-property value, a structural cycle, or nesting past `COMPILE_DEPTH_LIMIT`) throws a coded `ContractError` immediately instead of silently producing a wrong guard, parser, schema, audit, report, or generator. `optionalShape` is legal in exactly one position: as the value of an object property. ONE population, one rule set: ownership refuses a malformed structural slot, scalar field, or bound rather than normalizing it, so the graph the gate judges is the graph the artifacts compile from — there is no earlier reading of the caller's live source that is validated and then thrown away.
6. **DOC ↔ SOURCE method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class exposes the same public methods, no more (`AGENTS.md`, Documentation contract). A renamed / added / removed method breaks the gate until the table is reconciled.
7. **Compilation owns its input.** A builder freezes what it produces, copies what you hand it, and re-exposes a `pattern` as a fresh frozen `RegExp` per read; every `compile*` entry point takes its argument through `ownShape`, which always returns an independent clone, and `createContract` snapshots unconditionally. Ownership refuses a non-record node before discriminant normalization and retains only primitive-string RegExp `source` / `flags` pairs. A shape you keep a reference to can never change what an already-compiled artifact does, and a compiled `schema` is deeply frozen — so the six outputs stay in lockstep with the declaration they came from, lockstep meaning derived from that one snapshot rather than agreeing on which values to accept.

The `parseJSON` / `parseJSONAs` text boundary is **lazy by default**: keep the result unknown, validate only a supplied shape, or read fields individually. Whole-tree work is explicit through the shipped `isJSONValue`, fixed-cap `isBoundedJSONValue` / `isBoundedJSONRecord`, `parseJSONValue`, `cloneJSONValue`, and record-root `cloneJSONRecord`; `JSONRecord` is the reusable record-root type. A dedicated `JSONArray` alias and broad deep JSON-Schema validators / `JSONSchemaDefinition` remain omitted; compose any narrower contract a consumer actually needs.

## Patterns

### Capturing synchronous outcomes losslessly

`attempt` records one synchronous callback invocation without interpreting the result. `Result<T>` resolves to `Result<T, unknown>` through the safe default, so the failure branch must be narrowed before member access. Domain boundaries can preserve that unknown value as an exact cause. Promises and thenables remain ordinary return values; handle their later settlement separately.

```ts
import { attempt, ContractError } from '@orkestrel/contract'

const reason = Object.freeze({ category: 'offline' })
const failure = attempt(() => {
	throw reason
})
if (!failure.success) {
	const error = new ContractError('Read failed', { code: 'structure', cause: failure.error })
	Object.is(error.cause, reason) // true
}

const promise = Promise.resolve(42)
const pending = attempt(() => promise)
pending.success && pending.value === promise // true — settlement was not observed
```

### Narrowing `unknown`

Guard a value against each candidate type in turn, narrowing it before use.

```ts
import { isFiniteNumber, isRecord, isString } from '@orkestrel/contract'

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
import {
	arrayOf,
	isNumber,
	isString,
	literalOf,
	pickOf,
	recordOf,
	unionOf,
} from '@orkestrel/contract'

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

### Accepting foreign interface implementations with `objectOf`

Use `objectOf` for values returned through a foreign interface. It checks only the declared members, admits unknown members, and reads through the prototype chain. Arrays remain outside this object contract.

```ts
import { isBoolean, objectOf } from '@orkestrel/contract'

class ForeignResult {
	get conclusion(): boolean {
		return true
	}
}

const isResult = objectOf({ conclusion: isBoolean })
isResult(new ForeignResult()) // true
isResult({ conclusion: true, metadata: 'retained' }) // true
isResult([]) // false
```

### Recursive guards with `lazyOf`

`lazyOf` is the sanctioned recursion entry point — the thunk defers construction so a self-referential guard never references itself before it exists.

```ts
import type { Guard } from '@orkestrel/contract'
import { arrayOf, isNumber, lazyOf, orOf } from '@orkestrel/contract'

// A number-tree: a number, or an array of trees.
const isNumberTree: Guard<unknown> = orOf(isNumber, arrayOf(lazyOf(() => isNumberTree)))
isNumberTree([1, [2, 3], 4]) // true
isNumberTree(['x']) // false
```

### Guards narrow, parsers coerce

A guard rejects a wrong-typed value outright, while a `*Field` parser reads a nested path and coerces it.

```ts
import { isString, parseIntegerField, parseStringField } from '@orkestrel/contract'

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
} from '@orkestrel/contract'

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

### Checking structural JSON safely

`matchesJSONValue(entry, ancestors)` is the cycle-safe structural JSON predicate used internally by `isJSONValue`. Pass the `unknown` candidate as `entry` and the active parent path as `ancestors: WeakSet<object>`; readable input returns a `boolean`, while a failed direct traversal gets the shared coded refusal. `isJSONValue` owns the outer guard boundary that converts that refusal to `false`.

```ts
import { matchesJSONValue } from '@orkestrel/contract'

matchesJSONValue({ nested: [1, 'x', null] }, new WeakSet()) // true
```

### Declaring a shape

Declare an object shape from the builders, then derive its static type with `Infer`.

```ts
import type { Infer } from '@orkestrel/contract'
import {
	arrayShape,
	integerShape,
	literalShape,
	objectShape,
	optionalShape,
	stringShape,
} from '@orkestrel/contract'

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

The compilers turn this one declaration into a JSON Schema, a guard, a parser, a strict audit, a parse report, and a generator — see the compilers section.

### Validating a live shape source

`ShapeValidator` is useful when one retained caller-owned declaration must be checked more than once. Its constructor is inert; every `validate()` is a new observation, and within one call each unique node is observed exactly once however many positions it occupies. `validateShape(shape)` remains the equivalent one-shot eager function.

```ts
import type { ContractShape, ShapeValidatorInterface } from '@orkestrel/contract'
import { ShapeValidator, validateShape } from '@orkestrel/contract'

const shape: ContractShape = { category: 'string', min: 1 }
const validator: ShapeValidatorInterface = new ShapeValidator(shape) // no shape read yet

validator.validate() // live pass succeeds
Reflect.set(shape, 'min', -1)
validator.validate() // throws ContractError { code: 'bound' }
Reflect.set(shape, 'min', 1)
validator.validate() // fresh recovery pass succeeds

validateShape(shape) // constructs a fresh validator and validates eagerly
```

### Compiling a contract

`createContract` is the typed entry point — one shape in, the six lockstep outputs out, on a single object.

```ts
import {
	createContract,
	integerShape,
	objectShape,
	seededRandom,
	stringShape,
} from '@orkestrel/contract'

const user = createContract(objectShape({ name: stringShape({ min: 1 }), age: integerShape() }))

user.is({ name: 'Ada', age: 36 }) // true — a typed guard (narrows to Infer<typeof shape>)
user.parse({ name: 'Ada', age: '36' }) // { name: 'Ada', age: 36 } — coerces, or undefined
user.parse({ name: '', age: 36 }) // undefined — '' violates name min:1 (parse enforces refinements, like is)
user.explain({ name: '', age: 36 }) // [{ reason: 'constraint', path: ['name'], expected: 'string', constraint: 'min', limit: 1, received: '""' }]
user.schema // the owned, deeply frozen { type: 'object', properties: { … }, required: ['name', 'age'], additionalProperties: false }
user.generate(seededRandom(42)) // reproducible seed data; omit the arg for a wall-clock-seeded source
```

### Auditing an undeclared key

This audits a value against a closed object shape, showing that `parse` drops an undeclared key that `audit` still reports.

```ts
import { createContract, objectShape, stringShape } from '@orkestrel/contract'

const contract = createContract(objectShape({ id: stringShape() }))
const value = { id: 'a', debug: true }

contract.is(value) // false
contract.parse(value) // { id: 'a' }
contract.audit(value) // [{ reason: 'extra', path: ['debug'] }]
contract.explain(value) // []
```

Reach for `ContractCompiler` directly when you want ONE artifact, or
want the declaration owned and validated once and then to pay for artifacts as
you ask for them. `createContract` is that class with all six requested:

```ts
import type { ContractCompilerInterface } from '@orkestrel/contract'
import { ContractCompiler, objectShape, stringShape } from '@orkestrel/contract'

const shape = objectShape({ id: stringShape({ min: 1 }) })
const compiler: ContractCompilerInterface<typeof shape> = new ContractCompiler(shape)
// Nothing has been read yet — construction observes the declaration not at all.

compiler.guard({ id: 'a' }) // true; the first read owns and validates, once
compiler.guard === compiler.guard // true — every getter replays its exact artifact
compiler.contract.is === compiler.guard // true — the bundle holds these exact values
```

One declaration; the schema, guard, parser, both reports, and the generator are all derived from one owned snapshot of it, so no later edit to the shape can move one of them without the others. Derived together is not the same as equal, though, and the block above is the proof: `is` rejects the undeclared key, `schema` forbids it, `audit` names it, `parse` drops it, and `explain` has nothing to say. See Domains for the three laws that hold between them.

When you want one artifact, hold the artifact rather than the compiler. A compiler releases its working set — the owned graph, the node index, the order, and every family plan — after every family exists, so a compiler read for one artifact and then kept holds all of it for as long as you keep the compiler. Each compiled artifact closes over the child entries its family needed while that family was built, so it answers on its own and outlives the compiler that produced it. The following block reads one guard and keeps no reference to the compiler behind it:

```ts
import { ContractCompiler, objectShape, stringShape } from '@orkestrel/contract'

// The compiler is never named: the guard is what leaves the expression, and the
// compiler it came from is unreachable the moment that expression finishes.
const isTicket = new ContractCompiler(objectShape({ id: stringShape({ min: 1 }) })).guard

isTicket({ id: 'T-1' }) // true — a compiled artifact carries its own plan
isTicket({ id: '' }) // false — an empty id fails the min:1 refinement
```

`createContract` is written the same way, so a contract it returns holds its own values and no route back to the compiler that built them. Part of the declaration travels with those values: the `audit` and `explain` functions close over the owned leaf and array nodes whose bounds they report, and an array node carries the subgraph under its `items` field.

### From an existing API/DB to an MCP tool

`samplesToSchema` with `format` and `enum` turned on infers a richer schema from a handful of rows than the bare defaults — string columns that unanimously look like dates/UUIDs/emails gain a `format` keyword, and low-cardinality repeated string/number columns gain an `enum` list, both of which flow VERBATIM to the model reading the tool's `inputSchema`. `schemaToObject` then guarantees an object root before `schemaToParameters` narrows it to the open record a tool advertises.

```ts
import { samplesToSchema, schemaToObject, schemaToParameters } from '@orkestrel/contract'

const rows = [
	{
		id: '550e8400-e29b-41d4-a716-446655440000',
		status: 'active',
		joined: '2024-01-15',
	},
	{
		id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
		status: 'inactive',
		joined: '2024-02-02',
	},
	{
		id: '9b2e8f14-3c7a-4d21-9f6e-2a1b8c4d5e6f',
		status: 'active',
		joined: '2024-03-10',
	},
]

const schema = samplesToSchema(rows, { format: true, enum: true })
// { type: 'object', properties: {
//     id: { type: 'string', format: 'uuid' },
//     joined: { type: 'string', format: 'date' },
//     status: { enum: ['active', 'inactive'] } },
//   required: ['id', 'joined', 'status'], additionalProperties: false }

const parameters = schemaToParameters(schemaToObject(schema)) // already object-rooted — schemaToObject is a no-op here
```

Wiring this into an actual MCP tool crosses package boundaries: `@orkestrel/tool`'s `createTool` accepts the same `parameters` record this schema resolves to, and `@orkestrel/mcp` renames `parameters` → `inputSchema` with zero transform when it registers the tool — so whatever keywords `samplesToSchema` emits here (`format`, `enum`, `description`) reach the model reading the tool definition verbatim; there is no server-side stripping or reinterpretation. Three things to keep in mind before wiring real data through this path:

- **Pre-convert `bigint` fields.** `JSON.stringify` throws on a `bigint`, and `valueToSchema` / `samplesToSchema` themselves infer `{}` for a `bigint` leaf (it is not JSON-representable) — convert an ID or counter column to a `number` or a decimal `string` before sampling it, or the column infers as accept-anything instead of a typed leaf.
- **A non-object root still needs `schemaToObject`.** Sampling a column of bare values (not rows) infers a non-object schema (`{ type: 'string' }`, an `enum`-only fragment, …); `schemaToObject` wraps it under a single required `value` key so the wrapped payload matches the shape a tool call actually sends — read the argument back out at `value`, not at the schema's own root.
- **An inferred contract validates but does not generate.** `schema` / `is` / `audit` / `explain` remain available on an inferred shape, and `parse` returns `undefined` for readable invalid input while preserving the shared coded refusal for a failed required read. `generate()` throws a `generate` `ContractError` as soon as it walks into any node the conversion widened to `rawShape` — and widening is the normal case for inferred schemas (a `{}` fragment, an unrecognized `type`, an over-cap union, exhausted depth, a cyclic re-encounter). Treat an inferred contract as a validator; keep seed data on a hand-declared shape.

The inferred schema is not only an advertised `inputSchema` — `schemaToShape` turns it back into a `ContractShape`, so the SAME inference also gives the tool a runtime validator for incoming call arguments (`createContract(schemaToShape(schema)).parse(args)`), with no separate hand-written contract to keep in sync.

**Full loop — infer, validate, reject:**

```ts
import { samplesToSchema, schemaToShape, createContract } from '@orkestrel/contract'

const rows = [
	{ id: 1, name: 'Ada', role: 'admin' },
	{ id: 2, name: 'Grace', role: 'member' },
]
const schema = samplesToSchema(rows)
const contract = createContract(schemaToShape(schema))

contract.parse({ id: 3, name: 'Alan', role: 'guest' })
// { id: 3, name: 'Alan', role: 'guest' } — in-shape, accepted

contract.parse({ id: 'nope', name: 'x', role: 'y' })
// undefined — out-of-shape, rejected

contract.explain({ id: 'nope', name: 'x', role: 'y' })
// [{ reason: 'type', path: ['id'], expected: 'integer', received: '"nope"' }]
```

### Practices

- **Guards narrow, parsers coerce.** `isNumber('36')` is `false`. Need `'36'` → `36`? Use `parseNumber`.
- **`isNumber` accepts `NaN`; reach for `isFiniteNumber`** (or `isInteger`) when `NaN` / `±Infinity` must be rejected.
- **`isObject` is broad, `isRecord` is strict.** Arrays and ordinary class instances satisfy `isObject` but fail `isRecord` — use `isRecord` for plain config / JSON-style objects. `isRecord` is a structural brand, not a provenance check, so a class whose prototype has been forged into a realm prototype — with the seven mandated names carried as function-valued own data properties — passes it; see `matchesRecordBrand` for that residual and its exact cost.
- **`recordOf` is exact.** Extra keys fail by default; declare optional keys with a key list or `true`, and derive related shapes with `pickOf` / `omitOf`.
- **`objectOf` is open.** Use it for objects or callables a foreign interface returns when only the declared members belong to this package's check.
- **Use `lazyOf` for self-referential guards** — never reference a guard inside its own definition without it.
- **JSON text parsing is lazy by default.** Use `parseJSONAs` with a composed guard or read a `parseJSON` result field-by-field when that is sufficient. Choose `isJSONValue`, fixed-cap `isBoundedJSONValue` / `isBoundedJSONRecord`, `parseJSONValue`, `cloneJSONValue`, or record-root `cloneJSONRecord` only when an explicit deep whole-tree guard, bounded guard, parser, or owned snapshot is required. `JSONRecord` serves real record-root consumers; a dedicated `JSONArray` alias and broad deep JSON-Schema validation remain outside the surface.

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ `src/core` bijection (value and type exports), the `## Methods` ↔ implementing-class bijection read from the real prototypes, and the equality gate: every `Summary` cell against its declaration's description paragraph, the titled `Compiling a contract` fence against the `@example` block of that title (pinned so the titled pair cannot be retired silently), and the README pitch against this guide's tagline. It also runs the flagship fences and asserts the values their comments claim.
- [`tests/src/core/JSONCloner.test.ts`](../tests/src/core/JSONCloner.test.ts) — direct root-imported `JSONCloner`/interface contract: inert construction, exact prototype, terminal identity and zero rereads, failure working-set release, atomic settlement while every terminal-path intrinsic is redirected, caught/uncaught reentry poisoning, independent instances, eager parity, caller-error containment, graph/descriptor/order/freeze/mutation behavior, and iterative depth.
- [`tests/src/core/SchemaCloner.test.ts`](../tests/src/core/SchemaCloner.test.ts) — direct root-imported `SchemaCloner`/interface contract: inert construction, exact prototype, terminal replay and zero rereads, caught/uncaught reentry precedence, independent instances, exact provenance and paths, enumerable-string observation, aliases/cycles, shells/order/freeze/depth, atomic settlement while every terminal-path intrinsic is redirected, and success/failure working-state release with a real collection control.
- [`tests/src/core/cloners.test.ts`](../tests/src/core/cloners.test.ts) — eager JSON and schema behavior plus the shape function boundaries: fresh `cloneShape` roots/failures/source observation, overload/runtime and compact class parity, and genuine `ownShape` frozen-failure precedence and independent-success behavior.
- [`tests/src/core/combinators.test.ts`](../tests/src/core/combinators.test.ts) — guard-combinator semantics, refinement composition, exact records/tuples, open-object and member-carrying-callable controls including the prototype-accessor proof, lazy recursion, thrown-value containment, dense array membership, genuine foreign-pattern ownership/flag stripping, and the unreadable-brand versus proxy/forgery diagnostic split.
- [`tests/src/core/ContractCompiler.test.ts`](../tests/src/core/ContractCompiler.test.ts) — the lazy engine's own contract: the pinned getters, construction that observes nothing, per-root replay identity and the frozen bundle, one entry per unique node, terminal adoption/reentry poison, release, the shared-edge staircase and the bounded expansion refusal, and door-versus-getter agreement across every shape category.
- [`tests/src/core/compilers.test.ts`](../tests/src/core/compilers.test.ts) — the `compile*` exports and `createContract`, including schema/guard/parser/generator behavior, the public depth boundary, strict auditor and coercive reporter fault semantics, hostile input containment, and contract wiring. It binds genuine foreign patterns through every compiler, exact captured property populations read twice (including refusal of an invalid captured population, and the absence of any further caller read), and the validator/cloner/compiler/contract forgery matrix. The explicit declaration matrix covers non-record roots and children, object-valued RegExp `source` / `flags`, present raw `undefined` populations, and flagged-pattern refusal, with plain/null-prototype/foreign records plus valid local/foreign/accessor patterns as controls; no generated message inventory or source pin participates.
- [`tests/src/core/errors.test.ts`](../tests/src/core/errors.test.ts) — cross-copy `ContractError` recognition through distinct source-module instances, including transparent-wrapper, stripped-brand subclass, plain-error, complete self-branded forgery, and undeclared-code controls.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — the entity door `createContract` driven directly: an eager bundle whose roots are data properties carrying one artifact identity through destructuring and through a spread, the generic overload and the widened-`ContractShape` overload each answering at every root, a malformed declaration refused at the call itself with the authoring door's own diagnosis rather than a rewrap, and `is` agreeing with `compileGuard` over a corpus that exercises each verdict.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — helper behavior including `attempt`, reflected reads, fixed JSON-depth boundaries/aliases/cycles/sparse populations/hostile hosts, option capture, random/schema utilities, `preview`, and `shapeToKind`; it also owns `ContractError` construction, exhaustive `ContractCode` preservation, exact causes, and `isContractError` containment.
- [`tests/src/core/SampleInferer.test.ts`](../tests/src/core/SampleInferer.test.ts) — the interned `SampleInferer` reached by relative source path: the ordered row-prefix memo served to a slot collecting the same rows in the same order and missed by slots whose rows arrive in a different order or at a different remaining depth, no memo carried across two walks over one row list, and the closed flag reaching the emitted opening.
- [`tests/src/core/ValueInferer.test.ts`](../tests/src/core/ValueInferer.test.ts) — the interned `ValueInferer` reached by relative source path and driven with the depth and breadth budgets its door sanitizes away: a container root widened at every budget not above zero, a leaf root classified without consulting the budget, one level of descent on a fractional budget, descent past the cap the door imposes, and a negative breadth budget that samples no member and forces the record open.
- [`tests/src/core/inferers.test.ts`](../tests/src/core/inferers.test.ts) — schema inference, unification, depth/breadth limits, deterministic sampling, readable widening, hostile traversal, sparse populations, and canonical serialization, including direct/public/consumer failed-prototype classification plus readable record/exotic controls.
- [`tests/src/core/integration.test.ts`](../tests/src/core/integration.test.ts) — the one explicit layout exception: genuine public cross-module composition, seeded generation/guard/parser/schema round trips, and guard-combinator integration. Unit and type-carrier behavior remains in mirrored suites.
- [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts) — coercion, field parsing, parse/guard soundness, reflected dense arrays, record/JSON boundaries, and coded unreadable-input refusal.
- [`tests/src/core/SchemaShaper.test.ts`](../tests/src/core/SchemaShaper.test.ts) — the interned `SchemaShaper` reached by relative source path: a node two branches share converted exactly once and re-converted at a different remaining depth, a cyclic schema widened at the re-encountered node instead of recursed into, and an unreadable keyword's read failure escaping the walk carrying no door name of its own.
- [`tests/src/core/ShapeCloner.test.ts`](../tests/src/core/ShapeCloner.test.ts) — canonical direct root-imported `ShapeCloner`/interface contract: inert source-only construction, exact prototype, terminal success/failure replay without rereads, caught/uncaught/replacement reentry poison, independent instances, exact error provenance and foreign containment, plain-record branding before discriminant observation, category/field/population observation and ordering, sharing/paths/optional placement, raw-schema composition, completed-root validation before deferred fidelity, primitive RegExp scalar ownership without coercion, freezing/mutation isolation, iterative depth refusal, atomic settlement while every terminal-path intrinsic is redirected, and symmetric terminal working-state release with a real three-reference collection control.
- [`tests/src/core/shapers.test.ts`](../tests/src/core/shapers.test.ts) — builders and `Infer`/`InferMutable`, with explicit `BUILDER_CASES` option positions and public keys driving real plain/frozen/null-prototype and hostile get/has/descriptor/own-key/revoked controls. It also covers caller/post-clone raw-schema populations and diagnostic precedence, genuine foreign-pattern ownership and flag policy, inverse schema construction, and inference depth/breadth behavior without reading or parsing project source.
- [`tests/src/core/ShapeValidator.test.ts`](../tests/src/core/ShapeValidator.test.ts) — direct public validator behavior: inert construction, repeatable live passes and reentry poison, precedence, depth/cycle handling, dense populations, raw-schema keywords, the present-`undefined` rule — an own raw-population member holding `undefined` is a present declaration rather than an absent one, so it is validated — and flagged-pattern observation/order/repair.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — primitive, non-negative numeric, structural, bounded-JSON, and JSON/record/RegExp guards; genuine `node:vm` record/RegExp values; depth-versus-validity and sequential-observation controls; zero-read duck/tag/accessor/proxy/revoked opposites; hostile-value totality; and parser/guard soundness corpora.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; see § Documentation contract. Guard totality and parse↔guard soundness are `.claude/rules/patterns.md` § Validation and contracts.
- [`README.md`](README.md) — the guides index.
