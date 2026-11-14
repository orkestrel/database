import {
	arrayShape,
	integerShape,
	literalShape,
	objectShape,
	optionalShape,
	rawShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'

/**
 * Declares a portable read, `QueryInput`, as a closed contract shape.
 *
 * @remarks
 * Each condition is a union keyed on `operator`, and each variant fixes the arity of `values`:
 * none for `absent` and `present`; one for `equals`, `not`, `above`, `below`, `from`, and
 * `to`; one string for `like`, `glob`, `starts`, and `ends`; two for `between`; and a list of
 * any length for `any` and `none`. A `column` is a column name or a non-empty list of keys, and
 * a `connector` is `and` or `or`. An ordering term is a `column` and a `direction`. `limit` and
 * `offset` are nonnegative integers. An operand is any value but `undefined`, which an array
 * member of a shape cannot declare; a table admits `undefined` itself, on an optional column.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { queryInputShape } from '@orkestrel/database'
 *
 * const query = createContract(queryInputShape)
 * query.is({ conditions: [{ column: 'age', operator: 'between', values: [18], connector: 'and' }] }) // false
 * ```
 */
export const queryInputShape = objectShape({
	conditions: optionalShape(
		arrayShape(
			unionShape(
				objectShape({
					column: unionShape(stringShape(), arrayShape(stringShape(), { min: 1 })),
					operator: literalShape(['absent', 'present']),
					values: arrayShape(rawShape({}), { max: 0 }),
					connector: literalShape(['and', 'or']),
				}),
				objectShape({
					column: unionShape(stringShape(), arrayShape(stringShape(), { min: 1 })),
					operator: literalShape(['equals', 'not', 'above', 'below', 'from', 'to']),
					values: arrayShape(rawShape({}), { min: 1, max: 1 }),
					connector: literalShape(['and', 'or']),
				}),
				objectShape({
					column: unionShape(stringShape(), arrayShape(stringShape(), { min: 1 })),
					operator: literalShape(['like', 'glob', 'starts', 'ends']),
					values: arrayShape(stringShape(), { min: 1, max: 1 }),
					connector: literalShape(['and', 'or']),
				}),
				objectShape({
					column: unionShape(stringShape(), arrayShape(stringShape(), { min: 1 })),
					operator: literalShape(['between']),
					values: arrayShape(rawShape({}), { min: 2, max: 2 }),
					connector: literalShape(['and', 'or']),
				}),
				objectShape({
					column: unionShape(stringShape(), arrayShape(stringShape(), { min: 1 })),
					operator: literalShape(['any', 'none']),
					values: arrayShape(rawShape({})),
					connector: literalShape(['and', 'or']),
				}),
			),
		),
	),
	order: optionalShape(
		arrayShape(
			objectShape({
				column: unionShape(stringShape(), arrayShape(stringShape(), { min: 1 })),
				direction: literalShape(['ascending', 'descending']),
			}),
		),
	),
	limit: optionalShape(integerShape({ min: 0 })),
	offset: optionalShape(integerShape({ min: 0 })),
})
