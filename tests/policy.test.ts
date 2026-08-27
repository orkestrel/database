import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	BRIDGE_POLICY_CONTROLS,
	createPolicyScratch,
	createSkillMetadata,
	FUNCTION_SOURCE_FILES,
	GENERIC_POLICY_SOURCES,
	inspectPolicyControl,
	inspectPolicyFilenamePaths,
	inspectPolicyMirrorPaths,
	inspectPolicyPortability,
	inspectPolicySources,
	inspectPolicyWorkspace,
	inspectSkillFamily,
	inspectSkillBridges,
	matchesSkillTrigger,
	parseSkillFrontmatter,
	POLICY_CONTROLS,
	POLICY_SUPPRESSION_DIRECTIVE,
	PORTABILITY_POLICY_CONTROLS,
	PORTABILITY_POLICY_EXCLUSION,
	PORTABILITY_POLICY_LOCAL,
	PORTABILITY_POLICY_SPLIT,
	readPolicyPaths,
	readSkillFamily,
	RULES_POLICY_CONTROLS,
	SKILL_BRIDGE_ROOT,
	SKILL_FAMILY_ROOT,
	SKILL_POLICY_APOSTROPHE,
	SKILL_POLICY_BACKTICKED,
	SKILL_POLICY_CONTROLS,
	SKILL_POLICY_EXCLUSION,
	SKILL_POLICY_FENCED,
	SKILL_POLICY_FOLDED,
	SKILL_POLICY_PARAGRAPHS,
	SKILL_POLICY_TEXT,
	stemToPolicyCandidates,
	testToPolicyStem,
} from './setupPolicy.js'

describe('policy scratch', () => {
	it('contains every write within its root', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-policy-containment-' })
		try {
			expect(() => scratch.write('inside/fixture.ts', '')).not.toThrow()
			expect(() => scratch.write('../escape', '')).toThrow(
				'Scratch target must stay within its root',
			)
		} finally {
			scratch.destroy()
		}
	})
})

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

	it('excludes documentation from the suppression population', () => {
		expect(
			inspectPolicyControl({
				label: 'excludes documentation from the suppression population',
				membership: 'files outside source, test, config, and script code',
				rule: 'suppression',
				files: [
					{
						path: 'guides/sample.md',
						content: `<!-- ${POLICY_SUPPRESSION_DIRECTIVE} -->\n`,
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

describe('skill family policy', () => {
	// The family is read from the workspace it runs in, so a membership literal would
	// bind this file to one workspace. The relationship binds in every workspace: a
	// direct `node:fs` read of the canonical root is a second mechanism that reports
	// the same directories, and reports none where the root is absent.
	//
	// The root is spelled here as literal segments rather than read from
	// `SKILL_FAMILY_ROOT`, and that literal is what makes this read a second
	// mechanism. Both sides reading the constant would move together when it drifts,
	// so the case would stay green for every value the constant ever holds. Against
	// the literal, a drifted constant desyncs the sides and reddens this case in a
	// workspace that has the tree, while a workspace without one still passes on
	// both readings being empty.
	it('discovers exactly the directories the canonical skill root holds', () => {
		const root = join(process.cwd(), '.agents', 'skills')
		const held = existsSync(root)
			? readdirSync(root, { withFileTypes: true })
					.filter((entry) => entry.isDirectory())
					.map((entry) => entry.name)
					.sort()
			: []
		const family = readSkillFamily(process.cwd())
		expect(family.length > 0).toBe(held.length > 0)
		expect([...family]).toEqual(held)
	})

	it('requires every discovered skill file, metadata token, and reference', () => {
		expect(inspectSkillFamily(process.cwd())).toEqual([])
	})

	it('parses a folded description containing a colon as exactly the name and description keys', () => {
		const skill = SKILL_POLICY_FOLDED.files.find((file) => file.path.endsWith('/SKILL.md'))
		const frontmatter = parseSkillFrontmatter(skill?.content ?? '')
		expect(frontmatter?.keys).toEqual(['name', 'description'])
		expect(frontmatter?.name).toBe('sample')
		expect(frontmatter?.description).toBe('Use this skill when a continuation contains: a colon.')
	})

	for (const control of SKILL_POLICY_CONTROLS) {
		it(`${control.label} [membership: ${control.membership}]`, () => {
			const violations = inspectPolicyControl(control)
			expect(violations).toHaveLength(1)
			expect(violations[0]?.rule).toBe(control.rule)
			expect(control.line === undefined || violations[0]?.line === control.line).toBe(true)
			expect(control.message === undefined || violations[0]?.message === control.message).toBe(true)
		})
	}

	it(`${SKILL_POLICY_APOSTROPHE.label} [membership: ${SKILL_POLICY_APOSTROPHE.membership}]`, () => {
		expect(inspectPolicyControl(SKILL_POLICY_APOSTROPHE)).toEqual([])
	})

	it(`${SKILL_POLICY_FOLDED.label} [membership: ${SKILL_POLICY_FOLDED.membership}]`, () => {
		expect(inspectPolicyControl(SKILL_POLICY_FOLDED)).toEqual([])
	})

	it(`${SKILL_POLICY_BACKTICKED.label} [membership: ${SKILL_POLICY_BACKTICKED.membership}]`, () => {
		expect(inspectPolicyControl(SKILL_POLICY_BACKTICKED)).toEqual([])
	})

	it(`${SKILL_POLICY_FENCED.label} [membership: ${SKILL_POLICY_FENCED.membership}]`, () => {
		expect(inspectPolicyControl(SKILL_POLICY_FENCED)).toEqual([])
	})

	it('parses a folded description containing more than one paragraph', () => {
		const skill = SKILL_POLICY_PARAGRAPHS.files.find((file) => file.path.endsWith('/SKILL.md'))
		const frontmatter = parseSkillFrontmatter(skill?.content ?? '')
		expect(frontmatter?.keys).toEqual(['name', 'description'])
		expect(frontmatter?.description).toBe(
			'First paragraph.\nUse `--app` when a policy fixture needs it.',
		)
		expect(matchesSkillTrigger(frontmatter?.description ?? '')).toBe(true)
		expect(inspectPolicyControl(SKILL_POLICY_PARAGRAPHS)).toEqual([])
	})

	it(`${SKILL_POLICY_EXCLUSION.label} [membership: ${SKILL_POLICY_EXCLUSION.membership}]`, () => {
		expect(inspectPolicyControl(SKILL_POLICY_EXCLUSION)).toEqual([])
	})
})

describe('skill bridge policy', () => {
	it('matches every real provider bridge to its canonical skill', () => {
		expect(inspectSkillBridges(process.cwd())).toEqual([])
	})

	for (const control of BRIDGE_POLICY_CONTROLS) {
		it(`${control.label} [membership: ${control.membership}]`, () => {
			const violations = inspectPolicyControl(control)
			expect(violations).toHaveLength(1)
			expect(violations[0]?.rule).toBe(control.rule)
			expect(control.line === undefined || violations[0]?.line === control.line).toBe(true)
			expect(control.message === undefined || violations[0]?.message === control.message).toBe(true)
		})
	}
})

describe('rule map policy', () => {
	for (const control of RULES_POLICY_CONTROLS) {
		it(`${control.label} [membership: ${control.membership}]`, () => {
			const violations = inspectPolicyControl(control)
			expect(violations).toHaveLength(1)
			expect(violations[0]?.rule).toBe(control.rule)
			expect(control.message === undefined || violations[0]?.message === control.message).toBe(true)
		})
	}
})

describe('portability policy', () => {
	for (const control of PORTABILITY_POLICY_CONTROLS) {
		it(`${control.label} [membership: ${control.membership}]`, () => {
			const violations = inspectPolicyControl(control)
			expect(violations).toHaveLength(1)
			expect(violations[0]?.rule).toBe(control.rule)
			expect(control.message === undefined || violations[0]?.message === control.message).toBe(true)
		})
	}

	for (const control of [
		PORTABILITY_POLICY_EXCLUSION,
		PORTABILITY_POLICY_LOCAL,
		PORTABILITY_POLICY_SPLIT,
	]) {
		it(`${control.label} [membership: ${control.membership}]`, () => {
			expect(inspectPolicyControl(control)).toEqual([])
		})
	}

	it('rejects a character Windows refuses inside a path segment', () => {
		// A Windows host refuses to create this name, so the population itself is the control.
		expect(inspectPolicyFilenamePaths(['src/worker/read<write>.ts'])).toEqual([
			{
				rule: 'portability',
				path: 'src/worker/read<write>.ts',
				message: 'path segments avoid the characters Windows refuses',
			},
		])
	})

	it('rejects sibling paths that differ by case alone', () => {
		// A Windows host folds the pair into one file, so the population itself is the control.
		expect(inspectPolicyFilenamePaths(['guides/Readme.md', 'guides/readme.md'])).toEqual([
			{
				rule: 'portability',
				path: 'guides/readme.md',
				message: 'path differs from guides/Readme.md by case alone',
			},
		])
	})

	it('accepts sibling paths that differ by more than case', () => {
		expect(
			inspectPolicyFilenamePaths([
				'guides/readme.md',
				'guides/readmes.md',
				'src/worker/helpers.ts',
			]),
		).toEqual([])
	})
})

describe('repository policy', () => {
	it('enforces placement and mirrors over the real workspace', () => {
		expect(inspectPolicyWorkspace(process.cwd())).toEqual([])
	})

	// A target reads the canon from the installed package, so its tree carries the
	// pointer pair and no `.agents/` directory, no rule map, and no skill bridges.
	// This vendored suite runs there, and every inspector it routes through has to
	// stay silent on that shape.
	it('accepts a target holding the pointer pair and no canon tree', () => {
		const scratch = createPolicyScratch({ prefix: 'orkestrel-policy-pointer-' })
		try {
			scratch.write(
				'AGENTS.md',
				'# AGENTS.md\n\nRead `node_modules/@orkestrel/scaffold/dist/host/AGENTS.md` for the canon.\n',
			)
			scratch.write(
				'CLAUDE.md',
				'# Claude Code bridge\n\nRead the `AGENTS.md` file beside this one first.\n',
			)
			scratch.write('.claude/settings.json', '{\n\t"permissions": {\n\t\t"allow": []\n\t}\n}\n')
			scratch.write(
				'.claude/agents/orkestrel.md',
				'# Orkestrel\n\nThe agent carrying the package catalog.\n',
			)
			scratch.write(
				'package.json',
				'{\n\t"name": "target",\n\t"private": true,\n\t"scripts": {\n\t\t"test": "vitest run"\n\t}\n}\n',
			)
			expect(inspectPolicyWorkspace(scratch.path)).toEqual([])
			// The control: the same workspace with one canonical skill planted and no
			// bridge beside it reports the twin violation, so the empty result above is a
			// sweep that ran rather than a sweep with nothing it could report.
			scratch.write(`${SKILL_FAMILY_ROOT}/sample/SKILL.md`, SKILL_POLICY_TEXT)
			scratch.write(`${SKILL_FAMILY_ROOT}/sample/agents/openai.yaml`, createSkillMetadata('sample'))
			expect(inspectPolicyWorkspace(scratch.path)).toEqual([
				{
					rule: 'bridge',
					path: `${SKILL_BRIDGE_ROOT}/sample`,
					message: 'canonical skill has a matching provider bridge directory',
				},
			])
		} finally {
			scratch.destroy()
		}
	})

	it('reaches every branch of the workspace-authored path population', () => {
		const paths = readPolicyPaths(process.cwd())
		expect(paths).toContain('tests/setupPolicy.ts')
		expect(paths).toContain('.claude/settings.json')
		expect(paths).toContain('package.json')
		expect(paths).toContain('.gitattributes')
	})

	it('keeps every workspace path, script, and source portable', () => {
		expect(inspectPolicyPortability(process.cwd())).toEqual([])
	})
})
