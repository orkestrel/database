import type { Condition, Key, Order, ReadInput, ReadPlan, TableSchema } from '@src/core'
import type { IndexedDBError } from '@orkestrel/indexeddb'
import type { StoreDefinition } from '@orkestrel/indexeddb'
import type { AccessPlan } from './types.js'
import { isDefined, isString } from '@orkestrel/contract'
import { normalizeReadInput, compareValues, DatabaseError, findColumn, isKey } from '@src/core'
import {
	rangeAboveKey,
	rangeBelowKey,
	rangeFromKey,
	rangePrefix,
	rangeToKey,
	wrapCall,
} from '@orkestrel/indexeddb'
import { COUNT_LIMIT, INDEXABLE_STORAGE } from './constants.js'

// The IndexedDB driver's planner. Pure functions over the portable `QueryInput`: they rank the
// access paths a read's conditions admit, keep the one they pick native, and leave every other
// clause residual for the core engine.

/**
 * Translates one {@link Condition} to the `IDBKeyRange` it maps to, when its
 * operator is one of the exact key comparisons over scalar operands; otherwise
 * returns `undefined`.
 *
 * @remarks
 * The comparison operators (`equals`/`above`/`below`/`from`/`to`/`between`) and `starts`
 * translate to a key range that a typed (string/number) column can back with an IndexedDB
 * store or index read. `starts` reads from the prefix up to its successor, excluded, through
 * `rangePrefix`, so a string that continues past U+FFFF stays inside the range. The
 * membership / negation / pattern / existence operators (`not`/`like`/`glob`/`ends`/`any`/
 * `none`/`absent`/`present`) have no single exact range. The operand guard (`isKey`) rejects
 * a value that is not a usable key, such as an array, a boolean, `NaN`, or an infinity.
 * `between` returns `undefined` for a reversed pair (`first > second`), because native
 * `IDBKeyRange.bound` throws a `DataError` for it, and the core resolves that read to an
 * empty result. The switch is exhaustive over every {@link ConditionOperator}, so an added
 * operator forces a decision here.
 *
 * @param condition - The condition to translate
 * @returns Its exact key range, or `undefined` when the operator/operands cannot push
 *
 * @example
 * ```ts
 * conditionToRange({ column: 'age', operator: 'from', values: [18], connector: 'and' }) // IDBKeyRange.lowerBound(18)
 * conditionToRange({ column: 'name', operator: 'like', values: ['a%'], connector: 'and' }) // undefined
 * ```
 */
export function conditionToRange(condition: Condition): IDBKeyRange | undefined {
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'equals':
			return isKey(first) ? IDBKeyRange.only(first) : undefined
		case 'above':
			return isKey(first) ? rangeAboveKey(first) : undefined
		case 'below':
			return isKey(first) ? rangeBelowKey(first) : undefined
		case 'from':
			return isKey(first) ? rangeFromKey(first) : undefined
		case 'to':
			return isKey(first) ? rangeToKey(first) : undefined
		case 'between':
			return isKey(first) && isKey(second) && compareValues(first, second) <= 0
				? IDBKeyRange.bound(first, second)
				: undefined
		case 'starts':
			return isString(first) ? rangePrefix(first) : undefined
		case 'not':
		case 'like':
		case 'glob':
		case 'ends':
		case 'any':
		case 'none':
		case 'absent':
		case 'present':
			return undefined
	}
}

/**
 * Builds the key range over a compound index's array keys that binds its leading columns to
 * `values` and, when given, its next column to a range condition.
 *
 * @remarks
 * IndexedDB orders an array key element by element, a shorter array ahead of a longer one it
 * begins, and an array after every number and string. `[...values, value, []]` therefore
 * sorts after every key whose next element is `value`, and `[...values, []]` after every key
 * that begins with `values`. Without a condition the range holds every key that begins with
 * `values`. A condition other than `above`, `below`, `from`, `to`, `between`, or `starts`, an
 * operand that is not a key, and a reversed `between` pair return `undefined`.
 *
 * @param values - The values the leading columns equal, in index order
 * @param condition - The range condition on the next column. Default: none
 * @returns The key range, or `undefined` when the condition has no range
 *
 * @example
 * ```ts
 * buildCompoundRange(['o3']) // IDBKeyRange.bound(['o3'], ['o3', []])
 * buildCompoundRange(['o3'], { column: 'rank', operator: 'from', values: [10], connector: 'and' }) // IDBKeyRange.bound(['o3', 10], ['o3', []])
 * ```
 */
export function buildCompoundRange(
	values: readonly Key[],
	condition?: Condition,
): IDBKeyRange | undefined {
	if (condition === undefined) return IDBKeyRange.bound([...values], [...values, []])
	const first = condition.values[0]
	const second = condition.values[1]
	switch (condition.operator) {
		case 'above':
			return isKey(first) ? IDBKeyRange.bound([...values, first, []], [...values, []]) : undefined
		case 'from':
			return isKey(first) ? IDBKeyRange.bound([...values, first], [...values, []]) : undefined
		case 'below':
			return isKey(first)
				? IDBKeyRange.bound([...values], [...values, first], false, true)
				: undefined
		case 'to':
			return isKey(first) ? IDBKeyRange.bound([...values], [...values, first, []]) : undefined
		case 'between':
			return isKey(first) && isKey(second) && compareValues(first, second) <= 0
				? IDBKeyRange.bound([...values, first], [...values, second, []])
				: undefined
		case 'starts': {
			if (!isString(first)) return undefined
			const successor: unknown = rangePrefix(first).upper
			return IDBKeyRange.bound([...values, first], [...values, successor], false, true)
		}
		case 'equals':
		case 'not':
		case 'like':
		case 'glob':
		case 'ends':
		case 'any':
		case 'none':
		case 'absent':
		case 'present':
			return undefined
	}
}

/**
 * Derives the access path one condition admits on the primary key or on a single-column
 * index, or `undefined` when it admits none.
 *
 * @remarks
 * The column must be a flat column the schema declares with an {@link INDEXABLE_STORAGE}
 * storage, and either the primary column or a column whose single-column index exists in
 * `available`. `equals` with a key operand reads one point, `any` with key operands reads its
 * listed keys, and a comparison or `starts` (on a `text` column) reads its range. An index
 * holds no entry for a row whose field is absent or `null`, and `below` and `to` match such a
 * row, so they read an index only for a column declared required. Every other operator binds
 * nothing on a missing row, so it reads an index on an optional or nullable column too.
 *
 * @param condition - The condition to derive a path for
 * @param schema - The table's schema
 * @param available - The index names on the store
 * @returns The access path, or `undefined`
 *
 * @example
 * ```ts
 * deriveConditionPlan(any('age', [36, 18]), schema, ['age']) // { conditions: [that condition], columns: ['age'], prefix: 0, index: 'age', keys: [18, 36] }
 * ```
 */
export function deriveConditionPlan(
	condition: Condition,
	schema: TableSchema,
	available: readonly string[],
): AccessPlan | undefined {
	if (!isString(condition.column)) return undefined
	const column = findColumn(condition.column, schema)
	if (column === undefined || !INDEXABLE_STORAGE.includes(column.storage)) return undefined
	const primary = column.name === schema.primary
	if (!primary && !available.includes(column.name)) return undefined
	const source = primary ? {} : { index: column.name }
	if (condition.operator === 'any') {
		if (!condition.values.every(isKey)) return undefined
		const keys = [...new Set(condition.values.filter(isKey))].sort(compareValues)
		return { conditions: [condition], columns: [column.name], prefix: 0, ...source, keys }
	}
	if (condition.operator === 'starts' && column.storage !== 'text') return undefined
	const required = !column.optional && !column.nullable
	if (!primary && !required && (condition.operator === 'below' || condition.operator === 'to')) {
		return undefined
	}
	const range = conditionToRange(condition)
	if (range === undefined) return undefined
	const prefix = condition.operator === 'equals' ? 1 : 0
	return { conditions: [condition], columns: [column.name], prefix, ...source, range }
}

/**
 * Derives the access path a compound index admits for a read's conditions, or `undefined`
 * when it admits none.
 *
 * @remarks
 * The index is matched by `equals` with a key operand on each of its leading columns, and
 * optionally by a range condition on the next column, which {@link buildCompoundRange} maps
 * to one range over its array keys; equality on every column reads one point. The index must
 * exist in `available` under the name {@link deriveIndexedDBIndexName} derives, hold only
 * {@link INDEXABLE_STORAGE} columns, and match at least one column. An index holds no entry
 * for a row that lacks a value in any of its columns, so every column the path leaves
 * unmatched must be declared required, and so must the range column under `below` or `to`.
 *
 * @param conditions - The read's `and`-joined conditions
 * @param index - The compound index's columns, in declared order
 * @param schema - The table's schema
 * @param available - The index names on the store
 * @returns The access path, or `undefined`
 *
 * @example
 * ```ts
 * deriveCompoundPlan([eq('organization', 'o3'), from('rank', 10)], ['organization', 'rank'], schema, ['2#12:organization4:rank'])
 * // { conditions: [both], columns: ['organization', 'rank'], prefix: 1, index: '2#12:organization4:rank', range: bound(['o3', 10], ['o3', []]) }
 * ```
 */
export function deriveCompoundPlan(
	conditions: readonly Condition[],
	index: readonly string[],
	schema: TableSchema,
	available: readonly string[],
): AccessPlan | undefined {
	const name = deriveIndexedDBIndexName(index)
	if (index.length < 2 || !available.includes(name)) return undefined
	const columns = index.map((column) => findColumn(column, schema))
	if (
		!columns.every((column) => column !== undefined && INDEXABLE_STORAGE.includes(column.storage))
	)
		return undefined
	const equalities = index.map((column) =>
		conditions.find(
			(condition) =>
				condition.column === column &&
				condition.operator === 'equals' &&
				isKey(condition.values[0]),
		),
	)
	const missing = equalities.findIndex((condition) => condition === undefined)
	const prefix = missing === -1 ? index.length : missing
	const bound = equalities.slice(0, prefix).filter(isDefined)
	const values = bound.map((condition) => condition.values[0]).filter(isKey)
	const next = columns[prefix]
	const ranged =
		next === undefined
			? undefined
			: conditions.find(
					(condition) =>
						condition.column === next.name &&
						condition.operator !== 'equals' &&
						(condition.operator !== 'starts' || next.storage === 'text') &&
						(!(condition.operator === 'below' || condition.operator === 'to') ||
							(!next.optional && !next.nullable)) &&
						buildCompoundRange(values, condition) !== undefined,
				)
	const matched = prefix + (ranged === undefined ? 0 : 1)
	const open = columns.slice(matched)
	if (
		matched === 0 ||
		!open.every((column) => column !== undefined && !column.optional && !column.nullable)
	) {
		return undefined
	}
	const range =
		prefix === index.length ? IDBKeyRange.only(values) : buildCompoundRange(values, ranged)
	return {
		conditions: ranged === undefined ? bound : [...bound, ranged],
		columns: [...index],
		prefix,
		index: name,
		...(range === undefined ? {} : { range }),
	}
}

/**
 * Ranks an access path by the rule {@link findAccessPlan} reads: a lower rank wins.
 *
 * @remarks
 * Primary-key `equals` or `any` ranks first; then a compound index matched on two or more
 * columns, more columns first; then a single-column index with `equals` or `any`, beside a
 * compound index whose leading column alone an `equals` binds; then a range or `starts` on
 * the primary key, on a single-column index, and on a compound index's leading column, in
 * that order. The rule reads no data: IndexedDB has no statistics
 * and no index intersection, so the planner reads one path, chosen by its shape.
 *
 * @param plan - The access path to rank
 * @returns The rank
 *
 * @example
 * ```ts
 * rankAccessPlan({ conditions: [eq('id', 'u1')], columns: ['id'], prefix: 1, range: only('u1') }) // 0
 * ```
 */
export function rankAccessPlan(plan: AccessPlan): number {
	const point = plan.keys !== undefined || plan.prefix === plan.columns.length
	if (plan.index === undefined) return point ? 0 : 300
	if (plan.columns.length > 1) {
		return plan.conditions.length > 1 ? 100 - plan.conditions.length : plan.prefix > 0 ? 200 : 302
	}
	return point ? 200 : 301
}

/**
 * Derives the access path an order alone admits: the index whose columns are the order's
 * columns, read in one direction, or `undefined` when no such index serves it.
 *
 * @remarks
 * Every order term must name a flat {@link INDEXABLE_STORAGE} column declared required and
 * share one direction, because an index holds no entry for a row whose field is absent or
 * `null`. An order on the primary key alone needs no index: the store already reads in key
 * order, so this returns `undefined` for it.
 *
 * @param order - The order to serve
 * @param schema - The table's schema
 * @param available - The index names on the store
 * @returns The index path, or `undefined`
 *
 * @example
 * ```ts
 * deriveOrderPlan([{ column: 'rank', direction: 'descending' }], schema, ['rank']) // { conditions: [], columns: ['rank'], prefix: 0, index: 'rank' }
 * ```
 */
export function deriveOrderPlan(
	order: readonly Order[] | undefined,
	schema: TableSchema,
	available: readonly string[],
): AccessPlan | undefined {
	const [first] = order ?? []
	if (order === undefined || first === undefined) return undefined
	const columns = order.map((term) => term.column).filter(isString)
	if (columns.length !== order.length) return undefined
	if (columns.length === 1 && columns[0] === schema.primary) return undefined
	if (!order.every((term) => term.direction === first.direction)) return undefined
	const name = deriveIndexedDBIndexName(columns)
	const declared = columns.map((column) => findColumn(column, schema))
	const required = declared.every(
		(column) =>
			column !== undefined &&
			!column.optional &&
			!column.nullable &&
			INDEXABLE_STORAGE.includes(column.storage),
	)
	return required && available.includes(name)
		? { conditions: [], columns, prefix: 0, index: name }
		: undefined
}

/**
 * Finds the one access path an IndexedDB read takes.
 *
 * @remarks
 * When every connector is `and`, it collects the paths each condition admits
 * ({@link deriveConditionPlan}) and each compound index admits ({@link deriveCompoundPlan}),
 * and takes the lowest {@link rankAccessPlan}, the earlier condition or the earlier declared
 * index on a tie. A second index is never read. With no such path, an order a required index
 * serves takes that index ({@link deriveOrderPlan}); with no condition at all, a `minimum` or
 * `maximum` of a required `integer` or `real` column takes its index; otherwise the read
 * takes the whole store. An `or` connector admits no condition path. The function reads only
 * the input's shape, so the driver finds the same path again from the native side of the
 * plan it built.
 *
 * @param input - The read to find a path for
 * @param schema - The table's schema
 * @param available - The index names on the store
 * @returns The access path
 *
 * @example
 * ```ts
 * findAccessPlan({ conditions: [from('age', 18)] }, schema, ['age']) // { conditions: [from('age', 18)], columns: ['age'], prefix: 0, index: 'age', range: lowerBound(18) }
 * findAccessPlan({ conditions: [like('name', 'a%')] }, schema, []) // { conditions: [], columns: ['id'], prefix: 0 }
 * ```
 */
export function findAccessPlan(
	input: ReadInput,
	schema: TableSchema,
	available: readonly string[],
): AccessPlan {
	const conditions = input.conditions ?? []
	const joined = !conditions.slice(1).some((condition) => condition.connector === 'or')
	const candidates = joined
		? [
				...conditions.map((condition) => deriveConditionPlan(condition, schema, available)),
				...schema.indexes.map((index) => deriveCompoundPlan(conditions, index, schema, available)),
			].filter(isDefined)
		: []
	const [best] = candidates.toSorted((left, right) => rankAccessPlan(left) - rankAccessPlan(right))
	if (best !== undefined) return best
	const ordered = deriveOrderPlan(input.order, schema, available)
	if (ordered !== undefined) return ordered
	const aggregate = input.aggregate
	const column = isString(aggregate?.column) ? findColumn(aggregate.column, schema) : undefined
	const extreme =
		conditions.length === 0 &&
		(aggregate?.operation === 'minimum' || aggregate?.operation === 'maximum') &&
		(column?.storage === 'integer' || column?.storage === 'real')
			? deriveOrderPlan([{ column: column.name, direction: 'ascending' }], schema, available)
			: undefined
	return extreme ?? { conditions: [], columns: [schema.primary], prefix: 0 }
}

/**
 * Checks whether an access path reads its rows in an order, ties broken by primary key in
 * the order's direction.
 *
 * @remarks
 * Every term must share one direction. A term on a column an `equals` binds orders nothing.
 * The store, a point of an index, and an `any` list read in primary-key order, so they serve
 * an order that is the primary key alone, or nothing beyond bound columns. An index range
 * reads in index order, so it serves an order whose remaining terms are the index's unbound
 * columns, in sequence.
 *
 * @param plan - The access path
 * @param order - The order to serve
 * @param primary - The primary column
 * @returns True if the path reads in that order; false otherwise
 *
 * @example
 * ```ts
 * matchesAccessOrder(findAccessPlan({ conditions: [from('age', 18)] }, schema, ['age']), [{ column: 'age', direction: 'descending' }], 'id') // true
 * ```
 */
export function matchesAccessOrder(
	plan: AccessPlan,
	order: readonly Order[],
	primary: string,
): boolean {
	const [first] = order
	if (first === undefined || !order.every((term) => term.direction === first.direction))
		return false
	const bound = plan.keys === undefined ? plan.columns.slice(0, plan.prefix) : []
	const rest = order.filter((term) => !(isString(term.column) && bound.includes(term.column)))
	const keyed =
		plan.index === undefined || plan.keys !== undefined || plan.prefix === plan.columns.length
	const [lead] = rest
	if (lead === undefined || (rest.length === 1 && lead.column === primary)) return keyed
	const open = plan.columns.slice(plan.prefix)
	return (
		plan.index !== undefined &&
		plan.keys === undefined &&
		rest.length === open.length &&
		rest.every((term, position) => term.column === open[position])
	)
}

/**
 * Checks whether a read lists the primary keys of its access path and sorts them, rather than
 * walking its source in order.
 *
 * @remarks
 * An `any` list reads one list per key and sorts their union; an index range that is not a
 * point reads index order, so a read that asks for key order, which an absent `order` does,
 * lists and sorts its primary keys too. Every other path walks its source in the read's order.
 *
 * @param plan - The access path
 * @param order - The read's order, or `undefined` for key order
 * @param primary - The primary column
 * @returns True if the read lists and sorts its primary keys; false otherwise
 *
 * @example
 * ```ts
 * matchesKeyList(findAccessPlan({ conditions: [from('age', 18)] }, schema, ['age']), undefined, 'id') // true
 * ```
 */
export function matchesKeyList(
	plan: AccessPlan,
	order: readonly Order[] | undefined,
	primary: string,
): boolean {
	const keyed = order ?? [{ column: primary, direction: 'ascending' }]
	return plan.keys !== undefined || !matchesAccessOrder(plan, keyed, primary)
}

/**
 * Resolves the count a native `getAll`, `getAllKeys`, or `advance` call takes for a row count.
 *
 * @remarks
 * IndexedDB refuses a count past {@link COUNT_LIMIT} with a `TypeError`, and no store holds
 * that many rows, so a larger count reads as no count, which reads every row.
 *
 * @param count - The row count, or `undefined` for every row
 * @returns The count to pass, or `undefined` for every row
 *
 * @example
 * ```ts
 * resolveCount(10) // 10
 * resolveCount(Number.MAX_SAFE_INTEGER) // undefined
 * ```
 */
export function resolveCount(count: number | undefined): number | undefined {
	return count === undefined || count > COUNT_LIMIT ? undefined : count
}

/**
 * Narrows a key range to the keys past one key in a cursor direction, for a stream that
 * resumes after the final key of its last batch.
 *
 * @remarks
 * `next` keeps the keys at or above `key` (above it when `open` is true) and `prev` the keys
 * at or below it. It returns `undefined` when no key of `range` lies past `key`. An absent
 * `range` stands for every key.
 *
 * @param range - The range to narrow, or `undefined` for every key
 * @param key - The key to resume past
 * @param direction - The cursor direction
 * @param open - If `true`, excludes `key`; if `false`, keeps it
 * @returns The narrowed range, or `undefined` when nothing remains
 *
 * @example
 * ```ts
 * narrowRange(IDBKeyRange.bound('a', 'm'), 'c', 'next', true) // IDBKeyRange.bound('c', 'm', true, false)
 * narrowRange(IDBKeyRange.bound('a', 'm'), 'm', 'next', true) // undefined
 * ```
 */
export function narrowRange(
	range: IDBKeyRange | undefined,
	key: IDBValidKey,
	direction: IDBCursorDirection,
	open: boolean,
): IDBKeyRange | undefined {
	const forward = direction === 'next' || direction === 'nextunique'
	const limit: unknown = forward ? range?.upper : range?.lower
	if (range === undefined || limit === undefined) {
		return forward ? IDBKeyRange.lowerBound(key, open) : IDBKeyRange.upperBound(key, open)
	}
	const exclusive = forward ? range.upperOpen : range.lowerOpen
	const position = indexedDB.cmp(key, limit) * (forward ? 1 : -1)
	if (position > 0 || (position === 0 && (open || exclusive))) return undefined
	return forward
		? IDBKeyRange.bound(key, limit, open, exclusive)
		: IDBKeyRange.bound(limit, key, exclusive, open)
}

/**
 * Reads the index names each listed store of a connected database holds, in one readonly
 * transaction.
 *
 * @remarks
 * A store the database does not hold is left out of the map.
 *
 * @param database - The connected native database
 * @param stores - The store names to read
 * @returns Each held store's index names
 *
 * @example
 * ```ts
 * readIndexNames(await createIndexedDBDatabase({ name: 'library', stores: { books: { indexes: [{ name: 'author', path: 'author' }] } } }).connect(), ['books']) // Map { 'books' => ['author'] }
 * ```
 */
export function readIndexNames(
	database: IDBDatabase,
	stores: readonly string[],
): ReadonlyMap<string, readonly string[]> {
	const held = [...new Set(stores)].filter((store) => database.objectStoreNames.contains(store))
	if (held.length === 0) return new Map()
	const transaction = wrapCall(() => database.transaction(held, 'readonly'))
	return new Map(
		held.map((store) => [store, Array.from(transaction.objectStore(store).indexNames)] as const),
	)
}

/**
 * Splits a read into the part IndexedDB answers natively and the residual the core runs —
 * the IndexedDB driver's `plan`.
 *
 * @remarks
 * The native side holds the conditions of the path {@link findAccessPlan} picks, which a key
 * range, a key list, or an index point answers exactly. The order is native when
 * {@link matchesAccessOrder} holds for that path. The page is native when no condition and
 * no order stays residual. `count` is native when no condition stays residual; `minimum` and
 * `maximum` also need the path to read the aggregated column's own key, on a required
 * `integer` or `real` column. Every other clause is residual. A side that carries nothing is
 * `{}`.
 *
 * @param input - The read to split
 * @param schema - The table's schema
 * @param available - The index names on the store
 * @returns The plan
 *
 * @example
 * ```ts
 * planIndexedDBQuery({ conditions: [from('age', 18), like('name', 'a%')], limit: 10 }, schema, ['age'])
 * // { native: { conditions: [from('age', 18)] }, residual: { conditions: [like('name', 'a%')], limit: 10 } }
 * ```
 */
export function planIndexedDBQuery(
	input: ReadInput,
	schema: TableSchema,
	available: readonly string[],
): ReadPlan {
	const read = normalizeReadInput(input)
	const plan = findAccessPlan(read, schema, available)
	const conditions = (read.conditions ?? []).filter(
		(condition) => !plan.conditions.includes(condition),
	)
	const ordered = read.order !== undefined && matchesAccessOrder(plan, read.order, schema.primary)
	const paged = conditions.length === 0 && (read.order === undefined || ordered)
	const page = {
		...(read.limit === undefined ? {} : { limit: read.limit }),
		...(read.offset === undefined ? {} : { offset: read.offset }),
	}
	const aggregate = read.aggregate
	const column = isString(aggregate?.column) ? findColumn(aggregate.column, schema) : undefined
	const extreme =
		column !== undefined &&
		!column.optional &&
		!column.nullable &&
		(column.storage === 'integer' || column.storage === 'real') &&
		plan.keys === undefined &&
		plan.columns.length === 1 &&
		plan.columns[0] === column.name
	const reduced =
		aggregate !== undefined &&
		conditions.length === 0 &&
		(aggregate.operation === 'count' ||
			((aggregate.operation === 'minimum' || aggregate.operation === 'maximum') && extreme))
	return {
		native: normalizeReadInput({
			conditions: plan.conditions,
			...(ordered && read.order !== undefined ? { order: read.order } : {}),
			...(paged ? page : {}),
			...(reduced && aggregate !== undefined ? { aggregate } : {}),
		}),
		residual: normalizeReadInput({
			conditions,
			...(ordered || read.order === undefined ? {} : { order: read.order }),
			...(paged ? {} : page),
			...(reduced || aggregate === undefined ? {} : { aggregate }),
		}),
	}
}

/**
 * Maps a backend {@link IndexedDBError} to the portable `DatabaseError` taxonomy
 * — the default mapping used everywhere except inside `migrate()`.
 *
 * @remarks
 * No backend fault may leak through `DriverInterface` as a raw `IndexedDBError`.
 * `CONSTRAINT` (a unique-key violation) is a `CONFLICT` — the same code every
 * other backend uses for a duplicate key. `CLOSED`/`NOT_OPEN`/`INVALID` (the
 * connection is gone, never opened, or the native handle is stale) collapse to
 * `CLOSED`. `QUOTA` and `RECORD` (a stored value that is no record) are `DRIVER` faults
 * carrying a machine-readable `context.code` so a caller can branch without parsing the
 * message; `RECORD` names the store and the primary key, never the stored value. A
 * blocked open or versionchange is nonterminal in the backend and remains pending until the
 * competing connection closes, so it never reaches this error mapper. Every other code
 * (`UPGRADE` here — see {@link mapMigrationError} for the `migrate()`-only remapping to
 * `MIGRATION` — `ABORTED`, `NOT_FOUND`, `DATA`, `OPEN`, `INACTIVE`, `READONLY`, `UNKNOWN`)
 * is an unexpected infrastructure fault and maps to `DRIVER` — the driver opens
 * its own readwrite transactions, so a `READONLY` fault can only mean the
 * backend behaved unexpectedly. The original error is always preserved as
 * `context.cause` for diagnostics.
 *
 * @param error - The backend error to translate
 * @returns The portable `DatabaseError`
 *
 * @example
 * ```ts
 * import { IndexedDBError } from '@orkestrel/indexeddb'
 *
 * mapIndexedDBError(new IndexedDBError('CONSTRAINT', 'duplicate key')).code // 'CONFLICT'
 * mapIndexedDBError(new IndexedDBError('RECORD', 'not a record')).context?.code // 'RECORD'
 * ```
 */
export function mapIndexedDBError(error: IndexedDBError): DatabaseError {
	switch (error.code) {
		case 'CONSTRAINT':
			return new DatabaseError('CONFLICT', error.message, { cause: error })
		case 'CLOSED':
		case 'NOT_OPEN':
		case 'INVALID':
			return new DatabaseError('CLOSED', error.message, { cause: error })
		case 'QUOTA':
			return new DatabaseError('DRIVER', error.message, { cause: error, code: 'QUOTA' })
		case 'RECORD':
			return new DatabaseError('DRIVER', error.message, { cause: error, code: 'RECORD' })
		case 'UPGRADE':
		case 'ABORTED':
		case 'NOT_FOUND':
		case 'DATA':
		case 'OPEN':
		case 'INACTIVE':
		case 'READONLY':
		case 'UNKNOWN':
			return new DatabaseError('DRIVER', error.message, { cause: error })
	}
}

/**
 * Maps a backend {@link IndexedDBError} to the portable `DatabaseError` taxonomy
 * for use inside `migrate()` — the one context where `UPGRADE` means the
 * migration itself failed, not a generic driver fault.
 *
 * @remarks
 * `migrate()` reconnects at a bumped version inside `onupgradeneeded`; a
 * rejection there (an inapplicable step, a native `ConstraintError` from a
 * duplicate index, …) surfaces as `IndexedDBError` `UPGRADE` and must become a
 * `MIGRATION` `DatabaseError` so a caller can distinguish "this migration plan
 * failed" from "the driver hit an unrelated infrastructure fault". A `RECORD` raise, a
 * stored value that is no record, is `MIGRATION` there too. Every other code defers to
 * {@link mapIndexedDBError} unchanged.
 *
 * @param error - The backend error to translate
 * @returns The portable `DatabaseError`
 *
 * @example
 * ```ts
 * import { IndexedDBError } from '@orkestrel/indexeddb'
 *
 * mapMigrationError(new IndexedDBError('UPGRADE', 'upgrade failed')).code // 'MIGRATION'
 * mapMigrationError(new IndexedDBError('CONSTRAINT', 'duplicate key')).code // 'CONFLICT'
 * ```
 */
export function mapMigrationError(error: IndexedDBError): DatabaseError {
	if (error.code === 'UPGRADE' || error.code === 'RECORD') {
		return new DatabaseError('MIGRATION', error.message, { cause: error })
	}
	return mapIndexedDBError(error)
}

/**
 * Derives an IndexedDB index name for a declared column group — a bare column
 * name for a single-column index, a deterministic collision-free encoding for a
 * compound one.
 *
 * @remarks
 * Naming a compound index by joining its columns with `_` (`['a', 'b'] →
 * 'a_b'`) collides with a single-column index over a column literally named
 * `'a_b'` — the same name, two different key paths (`'a_b'` vs `['a', 'b']`),
 * which either throws a native `ConstraintError` from a duplicate
 * `createIndex` call at open, or (worse) lets {@link deriveConditionPlan}'s name-based
 * lookup match the wrong index. A single-column index keeps the bare column
 * name — {@link deriveConditionPlan} matches `available.includes(condition.column)` by
 * that exact name, so a single-column index must stay named after its column
 * verbatim. A compound index instead encodes each column as a length-prefixed
 * segment (`'2#1:a1:b'`), so the boundary between columns is self-describing
 * and cannot be reconstructed by any other column list — including one
 * containing a column that happens to look like an encoded segment.
 *
 * @param columns - The index's column group, in declared order
 * @returns The index name to pass to `createIndex` / read back from `indexNames`
 *
 * @example
 * ```ts
 * deriveIndexedDBIndexName(['age']) // 'age'
 * deriveIndexedDBIndexName(['a', 'b']) // '2#1:a1:b'
 * ```
 */
export function deriveIndexedDBIndexName(columns: readonly string[]): string {
	const [column] = columns
	if (columns.length === 1 && column !== undefined) return column
	return `${columns.length}#${columns.map((part) => `${part.length}:${part}`).join('')}`
}

/**
 * Projects a table schema into the IndexedDB wrapper's store definition.
 *
 * @remarks
 * The definition is what an ordered versionchange migration creates the store
 * from, carrying each declared index under the name {@link deriveIndexedDBIndexName}
 * derives for its column group.
 *
 * @param schema - Portable table schema
 * @returns Store definition with declared indexes
 */
export function schemaToStore(schema: TableSchema): StoreDefinition {
	return {
		indexes: schema.indexes.map((columns) => {
			const [column] = columns
			return {
				name: deriveIndexedDBIndexName(columns),
				path: columns.length === 1 && column !== undefined ? column : [...columns],
			}
		}),
	}
}
