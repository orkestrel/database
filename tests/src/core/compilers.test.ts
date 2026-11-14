import type { ColumnSchema, MigrationStep, TableSchema } from '@src/core'
import {
	auditDriver,
	captureFailure,
	computeAggregate,
	conformDriver,
	CONFORMANCE_ROWS,
	CONFORMANCE_SCHEMA,
	createMemoryDriver,
	extractKey,
	isDatabaseError,
	planMigration,
	projectMigrationSchema,
	readPlannedAggregate,
	readPlannedRows,
	scanDriver,
	scanPlans,
	sortRows,
	StorageRecorder,
	streamPlannedRows,
	tallyCalls,
} from '@src/core'
import { captureError, collect, invokeUnchecked } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'
import {
	AGGREGATE_ROWS,
	buildCondition,
	buildSeededPage,
	createCrashingDriver,
	createDescendingKeyDriver,
	createDoublyBrokenDriver,
	createListedStorage,
	createMemoryAdapter,
	createMismatchedMetadataDriver,
	createPartialBatchDriver,
	createPlannedDriver,
	createReferenceLeakingDriver,
	createRefusingDriver,
	createRewritingDriver,
	MIGRATION_USERS,
	schema,
	seedConformanceRows,
} from '../../setup.js'

describe('planMigration', () => {
	it('adds a declared table missing from deployed', () => {
		const users = schema({ name: 'users' })
		const plan = planMigration([], [users])
		expect(plan.steps).toEqual([{ operation: 'table.add', table: users }])
	})

	it('removes a deployed table missing from declared', () => {
		const users = schema({ name: 'users' })
		const plan = planMigration([users], [])
		expect(plan.steps).toEqual([{ operation: 'table.remove', table: 'users' }])
	})

	it('orders steps table.remove, then table.add, before per-table changes', () => {
		const gone = schema({ name: 'gone' })
		const fresh = schema({ name: 'fresh' })
		const shared = schema({
			name: 'shared',
			columns: [{ name: 'age', storage: 'integer', optional: true, nullable: false }],
		})
		const sharedBefore = schema({ name: 'shared' })
		const plan = planMigration([gone, sharedBefore], [fresh, shared])
		expect(plan.steps).toEqual([
			{ operation: 'table.remove', table: 'gone' },
			{ operation: 'table.add', table: fresh },
			{
				operation: 'column.add',
				table: 'shared',
				column: { name: 'age', storage: 'integer', optional: true, nullable: false },
			},
		])
	})

	it('adds and removes columns on a shared table', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', storage: 'text', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: true }],
		})
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
			{
				operation: 'column.add',
				table: 'users',
				column: { name: 'age', storage: 'integer', optional: false, nullable: true },
			},
		])
	})

	it('adds and removes index groups by deep equality of the column-name array', () => {
		const columns: readonly ColumnSchema[] = [
			{ name: 'name', storage: 'text', optional: false, nullable: false },
			{ name: 'a', storage: 'text', optional: false, nullable: false },
			{ name: 'b', storage: 'text', optional: false, nullable: false },
		]
		const before = schema({ name: 'users', columns, indexes: [['name'], ['a', 'b']] })
		const after = schema({ name: 'users', columns, indexes: [['name'], ['b', 'a']] })
		const plan = planMigration([before], [after])
		expect(plan.steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('produces no steps for identical schemas', () => {
		const users = schema({
			name: 'users',
			columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
			indexes: [['name']],
		})
		const plan = planMigration([users], [users])
		expect(plan.steps).toEqual([])
	})

	it('produces no steps when only table, column, and index-list order differs', () => {
		const users = schema({
			name: 'users',
			columns: [
				{ name: 'name', storage: 'text', optional: false, nullable: false },
				{ name: 'age', storage: 'integer', optional: true, nullable: false },
			],
			indexes: [['name'], ['age', 'name']],
		})
		const posts = schema({ name: 'posts' })
		const reorderedUsers: TableSchema = {
			...users,
			columns: [...users.columns].reverse(),
			indexes: [...users.indexes].reverse(),
		}
		expect(planMigration([users, posts], [posts, reorderedUsers]).steps).toEqual([])
	})

	it('preserves compound-index column order as migration-significant', () => {
		const columns: readonly ColumnSchema[] = [
			{ name: 'a', storage: 'text', optional: false, nullable: false },
			{ name: 'b', storage: 'text', optional: false, nullable: false },
		]
		const before = schema({ name: 'users', columns, indexes: [['a', 'b']] })
		const after = schema({ name: 'users', columns, indexes: [['b', 'a']] })
		expect(planMigration([before], [after]).steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['a', 'b'] },
			{ operation: 'index.add', table: 'users', index: ['b', 'a'] },
		])
	})

	it('rejects adding a required non-null column to an existing table', () => {
		const before = schema({ name: 'users' })
		const after = schema({
			name: 'users',
			columns: [{ name: 'name', storage: 'text', optional: false, nullable: false }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(error).toMatchObject({
			code: 'MIGRATION',
			message:
				"migrate: required non-null column 'name' cannot be added automatically to existing table 'users'",
			context: { table: 'users', column: 'name' },
		})
	})

	it('throws a MIGRATION DatabaseError when a shared column changes type', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'text', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('users')
	})

	it('throws a MIGRATION DatabaseError when a shared column changes nullability', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const after = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: true }],
		})
		const error = captureError(() => planMigration([before], [after]))
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('MIGRATION')
		expect(isDatabaseError(error) ? String(error.message) : '').toContain('age')
	})

	it('throws MIGRATION when a shared table changes primary or a column changes optionality', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'age', storage: 'integer', optional: false, nullable: false }],
		})
		const primary = { ...before, primary: 'age' }
		const optional = {
			...before,
			columns: before.columns.map((column) =>
				column.name === 'age' ? { ...column, optional: true } : column,
			),
		}
		expect(captureError(() => planMigration([before], [primary]))).toMatchObject({
			code: 'MIGRATION',
		})
		expect(captureError(() => planMigration([before], [optional]))).toMatchObject({
			code: 'MIGRATION',
		})
	})

	it('removes dependent indexes before removing their columns', () => {
		const before = schema({
			name: 'users',
			columns: [{ name: 'legacy', storage: 'text', optional: false, nullable: false }],
			indexes: [['legacy']],
		})
		const after = schema({ name: 'users' })
		expect(planMigration([before], [after]).steps).toEqual([
			{ operation: 'index.remove', table: 'users', index: ['legacy'] },
			{ operation: 'column.remove', table: 'users', column: 'legacy' },
		])
	})

	it('defaults from to 0 and to to 1', () => {
		const plan = planMigration([], [])
		expect(plan.from).toBe(0)
		expect(plan.to).toBe(1)
	})

	it('honors explicit from / to labels', () => {
		const plan = planMigration([], [], 3, 4)
		expect(plan.from).toBe(3)
		expect(plan.to).toBe(4)
	})
})

describe('projectMigrationSchema', () => {
	const users = MIGRATION_USERS

	it('projects ordered table, column, and index transitions to a fresh valid schema', () => {
		const result = projectMigrationSchema(
			[users],
			[
				{ operation: 'index.remove', table: 'users', index: ['name'] },
				{ operation: 'column.remove', table: 'users', column: 'name' },
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'age', storage: 'integer', optional: true, nullable: false },
				},
				{ operation: 'index.add', table: 'users', index: ['age'] },
			],
		)
		expect(result).toEqual([
			{
				name: 'users',
				primary: 'id',
				columns: [
					{ name: 'age', storage: 'integer', optional: true, nullable: false },
					{ name: 'id', storage: 'text', optional: false, nullable: false },
				],
				indexes: [['age']],
			},
		])
		expect(result[0]).not.toBe(users)
	})

	it('rejects invalid sequential transitions before publishing a schema', () => {
		const cases: ReadonlyArray<readonly MigrationStep[]> = [
			[{ operation: 'table.remove', table: 'missing' }],
			[{ operation: 'column.remove', table: 'users', column: 'id' }],
			[{ operation: 'column.remove', table: 'users', column: 'name' }],
			[{ operation: 'index.add', table: 'users', index: ['missing'] }],
			[{ operation: 'index.remove', table: 'users', index: ['id'] }],
		]
		for (const steps of cases) {
			expect(captureError(() => projectMigrationSchema([users], steps))).toMatchObject({
				code: 'MIGRATION',
			})
		}
	})

	it('accepts optional-only and nullable-only additions but rejects required non-null additions', () => {
		const optional = projectMigrationSchema(
			[users],
			[
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'optional', storage: 'text', optional: true, nullable: false },
				},
			],
		)
		const nullable = projectMigrationSchema(
			[users],
			[
				{
					operation: 'column.add',
					table: 'users',
					column: { name: 'nullable', storage: 'text', optional: false, nullable: true },
				},
			],
		)
		expect(optional[0]?.columns.some((column) => column.name === 'optional')).toBe(true)
		expect(nullable[0]?.columns.some((column) => column.name === 'nullable')).toBe(true)
		expect(
			captureError(() =>
				projectMigrationSchema(
					[users],
					[
						{
							operation: 'column.add',
							table: 'users',
							column: {
								name: 'required',
								storage: 'text',
								optional: false,
								nullable: false,
							},
						},
					],
				),
			),
		).toMatchObject({ code: 'MIGRATION', context: { table: 'users', column: 'required' } })
	})
})

describe('computeAggregate', () => {
	const rows = AGGREGATE_ROWS

	it('counts every row', () => {
		expect(computeAggregate(rows, 'count', 'amount')).toBe(4)
	})

	it('coerces numeric strings and ignores non-numeric cells', () => {
		expect(computeAggregate(rows, 'sum', 'amount')).toBe(30)
		expect(computeAggregate(rows, 'average', 'amount')).toBe(15)
		expect(computeAggregate(rows, 'minimum', 'amount')).toBe(10)
		expect(computeAggregate(rows, 'maximum', 'amount')).toBe(20)
	})

	it('refuses an operation outside AGGREGATE_OPERATIONS rather than answering a maximum', () => {
		const error = captureError(() =>
			invokeUnchecked(undefined, computeAggregate, [rows, 'median', 'amount']),
		)
		expect(error).toMatchObject({ code: 'VALIDATION', context: { operation: 'median' } })
		expect(isDatabaseError(error)).toBe(true)
	})

	it('computes extrema for rows beyond the engine argument limit', () => {
		const pressureRows = Array.from({ length: 1_000_000 }, (_, index) => ({
			value: index - 500_000,
		}))
		expect.soft(() => computeAggregate(pressureRows, 'minimum', 'value')).not.toThrow()
		expect.soft(() => computeAggregate(pressureRows, 'maximum', 'value')).not.toThrow()
		expect(computeAggregate(pressureRows, 'minimum', 'value')).toBe(-500_000)
		expect(computeAggregate(pressureRows, 'maximum', 'value')).toBe(499_999)
	}, 30_000)

	it('preserves signed zero for extrema in reversed order', () => {
		expect(computeAggregate([{ value: 0 }, { value: -0 }], 'minimum', 'value')).toBe(-0)
		expect(computeAggregate([{ value: -0 }, { value: 0 }], 'maximum', 'value')).toBe(0)
	})

	it('returns undefined for non-count aggregates over no numeric values', () => {
		expect(computeAggregate([{ a: 'x' }], 'sum', 'a')).toBeUndefined()
		expect(computeAggregate([], 'average', 'a')).toBeUndefined()
	})
})

describe('streamPlannedRows', () => {
	it('applies the residual conditions and page over scan for a storage without plan', async () => {
		const driver = createMemoryDriver()
		await seedConformanceRows(driver)
		const rows = await Array.fromAsync(
			streamPlannedRows(
				driver,
				'users',
				{},
				{
					conditions: [buildCondition('age', 'above', [17])],
					offset: 1,
					limit: 2,
				},
			),
		)
		expect(rows.map((row) => row.id)).toEqual(['b', 'g'])
	})

	it('streams the native side of a planned storage and runs the step around each pull', async () => {
		const driver = createPlannedDriver()
		await seedConformanceRows(driver)
		const steps: number[] = []
		const rows = await Array.fromAsync(
			streamPlannedRows(
				driver,
				'users',
				{ conditions: [buildCondition('name', 'starts', ['Ada'])] },
				{},
				async () => {
					steps.push(steps.length)
				},
			),
		)
		expect(rows.map((row) => row.id)).toEqual(['a', 'h'])
		expect(steps).toHaveLength(6)
	})

	it('propagates a step that throws after a pull and closes the source', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await seedConformanceRows(recorder.driver)
		const steps: number[] = []
		const failure = await captureFailure(() =>
			Array.fromAsync(
				streamPlannedRows(recorder.driver, 'users', {}, {}, async () => {
					steps.push(steps.length)
					if (steps.length === 2) throw new Error('stopped')
				}),
			),
		)
		expect(failure).toEqual(new Error('stopped'))
		expect(tallyCalls(recorder.calls, 'scan')).toMatchObject({ calls: 1, rows: 1 })
	})
})

describe('readPlannedRows, readPlannedAggregate, and scanPlans', () => {
	it('answers a planned read and a scan-only read alike', async () => {
		const planned = createPlannedDriver()
		const memory = createMemoryDriver()
		for (const driver of [planned, memory]) {
			await driver.open(CONFORMANCE_SCHEMA)
			for (const row of CONFORMANCE_ROWS) {
				const key = extractKey(row, 'id')
				if (key !== undefined) await driver.write('users', key, row)
			}
		}
		const input = { conditions: [buildCondition('age', 'above', [17])], limit: 2 }
		const aggregate = { operation: 'sum' as const, column: 'age' }
		expect(await readPlannedRows(planned, 'users', input)).toEqual(
			await readPlannedRows(memory, 'users', input),
		)
		expect(await readPlannedAggregate(planned, 'users', input, aggregate)).toBe(
			await readPlannedAggregate(memory, 'users', input, aggregate),
		)
		expect(await collect(scanPlans(planned, 'plan'))).toEqual([])
	})

	it('reports an answer that differs from the core engine', async () => {
		const driver = createPlannedDriver('ignored')
		await driver.open(CONFORMANCE_SCHEMA)
		for (const row of CONFORMANCE_ROWS) {
			const key = extractKey(row, 'id')
			if (key !== undefined) await driver.write('users', key, row)
		}
		const findings = await collect(scanPlans(driver, 'plan'))
		expect(findings.length).toBeGreaterThan(0)
		expect(new Set(findings.map((finding) => finding.check))).toEqual(
			new Set(['plan-differential']),
		)
	})
})

describe('readPlannedRows — the read procedure Table runs', () => {
	it('stops the residual stream at offset + limit matches, as Table.records does', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await recorder.driver.open(CONFORMANCE_SCHEMA)
		for (const row of CONFORMANCE_ROWS) {
			const key = extractKey(row, 'id')
			if (key !== undefined) await recorder.driver.write('users', key, row)
		}
		const input = { conditions: [buildCondition('age', 'above', [30])], limit: 1 }
		const { value, calls } = await recorder.measure(() =>
			readPlannedRows(recorder.driver, 'users', input),
		)
		expect(value.map((row) => row.id)).toEqual(['a'])
		expect(tallyCalls(calls, 'scan')).toMatchObject({ calls: 1, rows: 1 })
	})
})

describe('readPlannedRows — a residual order holds only its page', () => {
	const page = { order: [{ column: 'age', direction: 'descending' as const }], offset: 1, limit: 2 }

	it('answers the page sortRows pages over seeded rows', async () => {
		for (const seed of Array.from({ length: 300 }, (_, index) => index + 1)) {
			const { rows, order, offset, limit } = buildSeededPage(seed)
			const read = await readPlannedRows(createListedStorage(rows), 'items', {
				order,
				offset,
				limit,
			})
			expect(
				read.map((row) => row.id),
				`seed ${String(seed)}`,
			).toEqual(
				sortRows(rows, order)
					.slice(offset, offset + limit)
					.map((row) => row.id),
			)
		}
	})

	it('consults no row outside offset + limit once the walk ends', async () => {
		const driver = createRewritingDriver('age', 100, new Set(['g', 'h', 'b']))
		await seedConformanceRows(driver)
		const read = await readPlannedRows(driver, 'users', page)
		expect(read.map((row) => row.id)).toEqual(['h', 'b'])
	})

	it('reads no row for a zero limit', async () => {
		const recorder = new StorageRecorder(createMemoryDriver())
		await seedConformanceRows(recorder.driver)
		const { value, calls } = await recorder.measure(() =>
			readPlannedRows(recorder.driver, 'users', { ...page, limit: 0 }),
		)
		expect(value).toEqual([])
		expect(tallyCalls(calls, 'scan').calls).toBe(0)
	})

	it('refuses an invalid page', async () => {
		const driver = createMemoryDriver()
		await seedConformanceRows(driver)
		await expect(readPlannedRows(driver, 'users', { ...page, limit: -1 })).rejects.toMatchObject({
			code: 'VALIDATION',
		})
	})
})

describe('readPlannedRows — a predicate', () => {
	it('applies the predicate ahead of a residual page, holding only that page', async () => {
		const driver = createRewritingDriver('age', 100, new Set(['g', 'h', 'a']))
		await seedConformanceRows(driver)
		const read = await readPlannedRows(
			driver,
			'users',
			{ order: [{ column: 'age', direction: 'descending' }], offset: 1, limit: 2 },
			undefined,
			(row) => row.name !== 'ada',
		)
		expect(read.map((row) => row.id)).toEqual(['h', 'a'])
	})

	it('pages after the predicate and the residual conditions when no order is residual', async () => {
		const driver = createMemoryDriver()
		await seedConformanceRows(driver)
		const read = await readPlannedRows(
			driver,
			'users',
			{ conditions: [buildCondition('age', 'above', [0])], limit: 2 },
			undefined,
			(row) => typeof row.name === 'string' && row.name.length > 3,
		)
		expect(read.map((row) => row.id)).toEqual(['c', 'h'])
	})

	it('streams a native order and stops at the page', async () => {
		const recorder = new StorageRecorder(createPlannedDriver())
		await seedConformanceRows(recorder.driver)
		const { value, calls } = await recorder.measure(() =>
			readPlannedRows(
				recorder.driver,
				'users',
				{ order: [{ column: 'age', direction: 'ascending' }], limit: 1 },
				undefined,
				(row) => typeof row.age === 'number' && row.age > 30,
			),
		)
		expect(value.map((row) => row.id)).toEqual(['a'])
		expect(tallyCalls(calls, 'records').calls).toBe(0)
		expect(tallyCalls(calls, 'stream')).toMatchObject({ calls: 1, rows: 6 })
	})
})

describe('readPlannedAggregate — a residual aggregate folds each row as it streams', () => {
	it('reads each row as it arrives and holds none once the walk ends', async () => {
		const driver = createRewritingDriver('age', 1000)
		await seedConformanceRows(driver)
		const values = await Promise.all(
			(['count', 'sum', 'average', 'minimum', 'maximum'] as const).map((operation) =>
				readPlannedAggregate(driver, 'users', {}, { operation, column: 'age' }),
			),
		)
		expect(values).toEqual([9, 203, 25.375, -5, 65])
	})
})

describe('conformDriver', () => {
	it('resolves for a conformant driver (the reference memory driver)', async () => {
		await expect(conformDriver(() => createMemoryDriver())).resolves.toBeUndefined()
	})

	it('rejects with a CONFORMANCE DatabaseError when read violates copy-out isolation', async () => {
		const error = await conformDriver(() => createReferenceLeakingDriver()).catch(
			(caught: unknown) => caught,
		)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
	})

	it('rejects with a CONFORMANCE DatabaseError when keys are not ascending', async () => {
		const error = await conformDriver(() => createDescendingKeyDriver()).catch(
			(caught: unknown) => caught,
		)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
	})
})

describe('scanDriver', () => {
	it('yields no findings for a conformant driver (the reference memory driver)', async () => {
		const findings: unknown[] = []
		for await (const finding of scanDriver(() => createMemoryDriver())) findings.push(finding)
		expect(findings).toEqual([])
	})

	it('yields lazily — breaking after the first finding never throws and never drains the rest', async () => {
		const collected: string[] = []
		for await (const finding of scanDriver(() => createDoublyBrokenDriver())) {
			collected.push(finding.check)
			break
		}
		expect(collected).toEqual(['copy-in'])
	})

	it('yields a finding (not an escaped throw) when a driver method throws unexpectedly', async () => {
		const findings: Array<{ check: string; message: string }> = []
		for await (const finding of scanDriver(() => createCrashingDriver())) {
			findings.push({ check: finding.check, message: finding.message })
		}
		expect(findings.some((finding) => finding.message === 'scan exploded')).toBe(true)
	})

	it('yields a finding when a driver throws a value that no message can render', async () => {
		const reason: object = Object.create(null)
		const findings = await auditDriver(() =>
			createMemoryAdapter(createMemoryDriver(), { open: () => Promise.reject(reason) }),
		)
		expect(findings[0]).toEqual({
			check: 'open-close',
			message: 'unknown failure',
			context: { error: reason },
		})
		expect(findings.every((finding) => finding.context?.error === reason)).toBe(true)
	})

	it('yields one rendered finding per phase when a driver that declares every member refuses to open', async () => {
		const reason: object = Object.create(null)
		const findings = await auditDriver(() => createRefusingDriver(reason))
		expect(findings.map((finding) => finding.check)).toEqual([
			'open-close',
			'read-missing',
			'write-read',
			'insert-atomic',
			'delete',
			'mutation-abort',
			'order',
			'clear',
			'journal-rollback',
			'batch',
			'non-id-primary',
			'nested-roundtrip',
			'migrate',
			'stream',
			'transaction',
			'metadata-stamp',
			'plan',
			'transaction-batch',
		])
		expect(
			findings.every(
				(finding) => finding.message === 'unknown failure' && finding.context.error === reason,
			),
		).toBe(true)
	})

	it('runs the metadata/stamp phase for a driver that implements both hooks and finds a mismatched read', async () => {
		const findings: string[] = []
		for await (const finding of scanDriver(() => createMismatchedMetadataDriver())) {
			findings.push(finding.check)
		}
		expect(findings).toContain('metadata-fresh')

		// And the reference MemoryDriver — which implements metadata/stamp — passes cleanly.
		const clean: string[] = []
		for await (const finding of scanDriver(() => createMemoryDriver())) clean.push(finding.check)
		expect(clean.some((check) => check.startsWith('metadata'))).toBe(false)
	})

	it('runs the batch phase and finds a violation when a list insert applies the rows ahead of a conflict', async () => {
		const findings: string[] = []
		for await (const finding of scanDriver(() => createPartialBatchDriver())) {
			findings.push(finding.check)
		}
		expect(findings).toEqual(['batch-atomic'])

		// And the reference MemoryDriver applies a batch whole and passes cleanly.
		const clean: string[] = []
		for await (const finding of scanDriver(() => createMemoryDriver())) clean.push(finding.check)
		expect(clean).toEqual([])
	})
})

describe('scanDriver — the plan phase', () => {
	it('passes a planned driver that answers every read exactly', async () => {
		expect(await auditDriver(() => createPlannedDriver())).toEqual([])
	})

	it('reports a dropped condition as an invariant and a differential finding', async () => {
		const checks = (await auditDriver(() => createPlannedDriver('dropped'))).map(
			(finding) => finding.check,
		)
		expect(checks).toContain('plan-invariant')
		expect(checks).toContain('plan-differential')
		expect(checks).toContain('plan-scoped-invariant')
	})

	it('reports an empty residual list as the empty invariant', async () => {
		const findings = await auditDriver(() => createPlannedDriver('listed'))
		const [first] = findings
		expect(first?.check).toBe('plan-invariant')
		expect(first?.context.faults).toEqual(['empty'])
	})

	it('reports a transaction capability that lacks the native members', async () => {
		const findings = await auditDriver(() => createPlannedDriver('unscoped'))
		expect(findings.map((finding) => finding.check)).toEqual(['plan-capability'])
		expect(findings[0]?.context).toEqual({
			expected: { plan: true, records: true, stream: true, aggregate: true },
			actual: { plan: false, records: false, stream: false, aggregate: false },
		})
	})
})

// A driver wrapper violating two independent invariants, copy-out isolation and reversed key
// order: auditDriver reports both, and conformDriver reports only the first.

describe('auditDriver', () => {
	it('returns an empty array for a conformant driver (the reference memory driver)', async () => {
		await expect(auditDriver(() => createMemoryDriver())).resolves.toEqual([])
	})

	it('reports BOTH violations of a driver breaking two independent invariants', async () => {
		const findings = await auditDriver(() => createDoublyBrokenDriver())
		const checks = findings.map((finding) => finding.check)
		expect(checks).toContain('copy-in')
		expect(checks).toContain('keys-order')
	})
})

describe('conformDriver (fail-fast over scanDriver)', () => {
	it('throws only the FIRST violation of a driver breaking two independent invariants', async () => {
		const error = await conformDriver(() => createDoublyBrokenDriver()).catch(
			(caught: unknown) => caught,
		)
		expect(isDatabaseError(error)).toBe(true)
		expect(isDatabaseError(error) ? error.code : 'not-database').toBe('CONFORMANCE')
		expect(isDatabaseError(error) ? error.context?.check : undefined).toBe('copy-in')
	})
})
