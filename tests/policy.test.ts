import { describe, expect, it } from 'vitest'
import {
	FUNCTION_SOURCE_FILES,
	GENERIC_POLICY_SOURCES,
	inspectPolicyControl,
	inspectPolicyMirrorPaths,
	inspectPolicySources,
	inspectPolicyWorkspace,
	POLICY_CONTROLS,
	stemToPolicyCandidates,
	testToPolicyStem,
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
		const modules = new Set(['src/worker/Worker.ts', 'app/browser/routes.ts'])
		expect(inspectPolicyMirrorPaths(tests, modules)).toEqual([])
	})

	it('derives mirror candidates in module resolution order', () => {
		const stem = testToPolicyStem('tests/app/core/setupBrowser.test.ts')
		expect(stem).toBe('app/core/setupBrowser')
		expect(stemToPolicyCandidates('app/core/setupBrowser')).toEqual([
			'app/core/setupBrowser.cts',
			'app/core/setupBrowser.mts',
			'app/core/setupBrowser.ts',
			'app/core/setupBrowser.tsx',
			'app/core/setupBrowser.vue',
			'app/core/setupBrowser.scss',
			'app/core/setupBrowser.css',
			'app/core/_setupBrowser.scss',
			'app/core/_setupBrowser.css',
			'tests/app/core/setupBrowser.ts',
		])
		expect(testToPolicyStem('tests/app/core/integration.test.ts')).toBeUndefined()
	})
})

describe('policy population controls', () => {
	it('accepts a Vue module mirror', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a Vue module mirror',
				membership: 'registered module extensions with an exact test stem',
				rule: 'mirror',
				files: [
					{ path: 'app/browser/Widget.vue', content: '<template></template>\n' },
					{ path: 'tests/app/browser/Widget.test.ts', content: '' },
				],
			}),
		).toEqual([])
	})

	it('accepts a TSX module mirror', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a TSX module mirror',
				membership: 'registered module extensions with an exact test stem',
				rule: 'mirror',
				files: [
					{ path: 'app/browser/Widget.tsx', content: '' },
					{ path: 'tests/app/browser/Widget.test.ts', content: '' },
				],
			}),
		).toEqual([])
	})

	it('accepts an MTS module mirror', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts an MTS module mirror',
				membership: 'registered module extensions with an exact test stem',
				rule: 'mirror',
				files: [
					{ path: 'app/browser/Widget.mts', content: '' },
					{ path: 'tests/app/browser/Widget.test.ts', content: '' },
				],
			}),
		).toEqual([])
	})

	it('accepts a CTS module mirror', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a CTS module mirror',
				membership: 'registered module extensions with an exact test stem',
				rule: 'mirror',
				files: [
					{ path: 'app/browser/Widget.cts', content: '' },
					{ path: 'tests/app/browser/Widget.test.ts', content: '' },
				],
			}),
		).toEqual([])
	})

	it('accepts a Sass partial module mirror', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a Sass partial module mirror',
				membership: 'registered partial extensions with an exact underscore-free test stem',
				rule: 'mirror',
				files: [
					{ path: 'app/browser/styles/_tokens.scss', content: '' },
					{ path: 'tests/app/browser/styles/tokens.test.ts', content: '' },
				],
			}),
		).toEqual([])
	})

	it('accepts a setup module mirror inside tests', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a setup module mirror inside tests',
				membership: 'tests-axis setup modules with an exact test stem',
				rule: 'mirror',
				files: [
					{ path: 'tests/app/core/setup.ts', content: '' },
					{ path: 'tests/app/core/setup.test.ts', content: '' },
				],
			}),
		).toEqual([])
	})

	it('excludes a .d.ts ambient declaration from placement', () => {
		expect(
			inspectPolicyControl({
				label: 'excludes a .d.ts ambient declaration from placement',
				membership: 'ambient TypeScript declarations',
				rule: 'type',
				files: [
					{
						path: 'app/browser/env.d.ts',
						content: 'export interface EnvironmentInterface {}\n',
					},
				],
			}),
		).toEqual([])
	})

	it('excludes a .d.mts ambient declaration from placement', () => {
		expect(
			inspectPolicyControl({
				label: 'excludes a .d.mts ambient declaration from placement',
				membership: 'ambient TypeScript declarations',
				rule: 'type',
				files: [
					{
						path: 'app/browser/env.d.mts',
						content: 'export interface EnvironmentInterface {}\n',
					},
				],
			}),
		).toEqual([])
	})

	it('excludes a .d.cts ambient declaration from placement', () => {
		expect(
			inspectPolicyControl({
				label: 'excludes a .d.cts ambient declaration from placement',
				membership: 'ambient TypeScript declarations',
				rule: 'type',
				files: [
					{
						path: 'app/browser/env.d.cts',
						content: 'export interface EnvironmentInterface {}\n',
					},
				],
			}),
		).toEqual([])
	})

	it('accepts a direct callback argument in constants.ts', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a direct callback argument in constants.ts',
				membership: 'anonymous callbacks passed directly as call arguments',
				rule: 'function',
				files: [
					{
						path: 'app/edge/constants.ts',
						content: 'export const LABELS = Object.freeze(COLUMNS.map((column) => column.label))\n',
					},
				],
			}),
		).toEqual([])
	})

	it('accepts a helper namespace in helpers.ts', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a helper namespace in helpers.ts',
				membership: 'camelCase helper namespaces containing function behavior',
				rule: 'data',
				files: [
					{
						path: 'app/edge/helpers.ts',
						content: 'export const formatters = Object.freeze({ money: build(fmt) })\n',
					},
				],
			}),
		).toEqual([])
	})

	it('accepts a concise-body direct return in constants.ts', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a concise-body direct return in constants.ts',
				membership: 'anonymous functions returned directly through a concise arrow body',
				rule: 'function',
				files: [
					{
						path: 'app/edge/constants.ts',
						content: 'export const WRAPPED = wrap(() => () => 1)\n',
					},
				],
			}),
		).toEqual([])
	})

	it('accepts a returned function inside a direct callback', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts a returned function inside a direct callback',
				membership: 'anonymous functions returned directly by a return statement',
				rule: 'function',
				files: [
					{
						path: 'app/edge/constants.ts',
						content:
							'export const LABELS = Object.freeze(COLUMNS.map((column) => { return () => column.label }))\n',
					},
				],
			}),
		).toEqual([])
	})

	it('accepts directly returned functions through callback control flow', () => {
		expect(
			inspectPolicyControl({
				label: 'accepts directly returned functions through callback control flow',
				membership: 'anonymous functions returned directly through control-flow branches',
				rule: 'function',
				files: [
					{
						path: 'app/edge/constants.ts',
						content:
							'export const VALUES = Object.freeze(C.map((c) => { if (c) return () => 1; return () => 2 }))\n',
					},
				],
			}),
		).toEqual([])
	})

	it('excludes Vue text from the placement population', () => {
		expect(
			inspectPolicyControl({
				label: 'excludes Vue text from the placement population',
				membership: 'files outside the declared TypeScript source extensions',
				rule: 'type',
				files: [
					{
						path: 'app/browser/Panel.vue',
						content: '<script setup lang="ts">\nexport interface PanelInterface {}\n</script>\n',
					},
				],
			}),
		).toEqual([])
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
