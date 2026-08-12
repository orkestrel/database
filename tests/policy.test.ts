import { describe, expect, it } from 'vitest'
import {
	FUNCTION_SOURCE_FILES,
	GENERIC_POLICY_SOURCES,
	inspectPolicyControl,
	inspectPolicyMirrorPaths,
	inspectPolicySources,
	inspectPolicyWorkspace,
	POLICY_CONTROLS,
} from './setupPolicy.js'

describe('fleet policy register', () => {
	it('keeps handlers in the function set and routes out', () => {
		expect(FUNCTION_SOURCE_FILES).toContain('handlers.ts')
		expect(FUNCTION_SOURCE_FILES).not.toContain('routes.ts')
	})

	it('accepts a differently shaped workspace without a core environment', () => {
		expect(inspectPolicySources(GENERIC_POLICY_SOURCES)).toEqual([])
	})

	it('accepts matching mirrors across arbitrary axes and environments', () => {
		const tests = [
			'tests/src/worker/Worker.test.ts',
			'tests/app/browser/routes.test.ts',
			'tests/app/edge/deep/integration.test.ts',
		]
		const sources = new Set(['src/worker/Worker.ts', 'app/browser/routes.ts'])
		expect(inspectPolicyMirrorPaths(tests, sources)).toEqual([])
	})
})

describe('instrument negative controls', () => {
	for (const control of POLICY_CONTROLS) {
		it(`${control.label} [membership: ${control.membership}]`, () => {
			const violations = inspectPolicyControl(control)
			expect(violations.some((violation) => violation.rule === control.rule)).toBe(true)
		})
	}
})

describe('repository policy', () => {
	it('enforces placement and mirrors over the real workspace', () => {
		expect(inspectPolicyWorkspace(process.cwd())).toEqual([])
	})
})
