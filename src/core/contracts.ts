import type { ContractInterface } from '@orkestrel/contract'
import type { QueryInput } from './types.js'
import { createContract } from '@orkestrel/contract'
import { queryInputShape } from './shapers.js'

/**
 * Holds the compiled contract of a portable read, which a table admits every read through.
 *
 * @example
 * ```ts
 * import { queryInputContract } from '@orkestrel/database'
 *
 * queryInputContract.is({ conditions: [{ column: 'age', operator: 'similar', values: [1], connector: 'and' }] }) // false
 * ```
 */
export const queryInputContract: ContractInterface<QueryInput> = createContract(queryInputShape)
