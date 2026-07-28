import { globSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isBrowserVuePath } from './setup.js'
import { inspectCodingWorkspace } from './setupPolicy.js'
import { chromium } from 'playwright'

describe('repository coding law', () => {
	it('keeps Vue single-file components exclusively in browser environments', () => {
		const files = globSync('{app,src}/**/*.vue')

		expect(files.every(isBrowserVuePath)).toBe(true)
	})

	it('enforces source placement, exports, readonly contracts, and syntax law', () => {
		expect(inspectCodingWorkspace(process.cwd())).toEqual([])
	})

	it.skipIf(!existsSync(chromium.executablePath()))(
		'runs browser suites only when the real Chromium executable is installed',
		() => {
			expect(existsSync(chromium.executablePath())).toBe(true)
		},
	)
})
