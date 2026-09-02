// A generated browser workspace resolves its own Chromium here rather than in
// `configs/helpers.ts`, because that leaf is vendored byte-identical to every
// workspace and most of them declare no `playwright` to import.

import type { PlaywrightProviderOptions } from '@vitest/browser-playwright'
import { chromium } from 'playwright'
import { accessSync, constants as FS_CONSTANTS, globSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'

/**
 * Lists the Chromium executable layouts inside a `chromium-<revision>` browsers-directory
 * entry, per platform.
 *
 * @remarks
 * The current Playwright build ships Chrome for Testing on macOS. The trailing `Chromium.app`
 * layouts are what earlier builds shipped, so the list spans Playwright versions instead of
 * pinning to the installed one.
 */
export const CHROMIUM_LAYOUTS = Object.freeze([
	'chrome-linux/chrome',
	'chrome-linux64/chrome',
	'chrome-win/chrome.exe',
	'chrome-win64/chrome.exe',
	'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
	'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
	'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
	'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
])

/** Matches the `chromium-<revision>` entry name Playwright installs one managed build into. */
export const CHROMIUM_ENTRY_PATTERN = /^chromium-\d+$/

/** Matches the revision number carried by any path containing a `chromium-<revision>` segment. */
export const CHROMIUM_REVISION_PATTERN = /chromium-(\d+)/

/** Names the directory a managed Linux container installs its bundled Playwright browsers into. */
export const BUNDLED_BROWSERS_ROOT = '/opt/pw-browsers'

/**
 * Lists the bundled Chromium layouts under the managed-container browsers root, as glob patterns.
 *
 * @remarks
 * The revision directory and its inner layout both drift across Playwright builds, and the
 * container also carries a top-level `chromium` alias, so every known shape is globbed.
 */
export const BUNDLED_CHROMIUM_LAYOUTS = Object.freeze([
	'chromium',
	'chromium-*/chrome-linux64/chrome',
	'chromium-*/chrome-linux/chrome',
])

/** Lists the stable Playwright Chromium channels and their standard executable layouts. */
export const SYSTEM_BROWSER_CHANNELS = Object.freeze([
	Object.freeze({
		channel: 'chrome',
		layouts: Object.freeze({
			linux: '/opt/google/chrome/chrome',
			darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			win32: Object.freeze(['Google', 'Chrome', 'Application', 'chrome.exe']),
		}),
	}),
	Object.freeze({
		channel: 'msedge',
		layouts: Object.freeze({
			linux: '/opt/microsoft/msedge/msedge',
			darwin: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			win32: Object.freeze(['Microsoft', 'Edge', 'Application', 'msedge.exe']),
		}),
	}),
])

/**
 * Determines whether a path identifies an executable regular file.
 *
 * @param path - The filesystem path to inspect.
 * @returns True if the path is a regular file with execute access; false otherwise.
 *
 * @example
 * ```ts
 * isBrowserExecutable('/opt/google/chrome/chrome')
 * ```
 */
export function isBrowserExecutable(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false
		accessSync(path, FS_CONSTANTS.X_OK)
		return true
	} catch {
		return false
	}
}

/**
 * Orders two Chromium paths so the highest revision sorts first.
 *
 * @param left - The first path or directory entry to compare.
 * @param right - The second path or directory entry to compare.
 * @returns A negative number when `left` sorts first, positive when `right` does.
 *
 * @remarks
 * Revisions are numbers, so `chromium-1200` outranks `chromium-999` despite sorting below it
 * lexically. A path carrying no revision falls back to descending name order.
 *
 * @example
 * ```ts
 * ['chromium-999', 'chromium-1200'].sort(compareRevisions)
 * ```
 */
export function compareRevisions(left: string, right: string): number {
	const leftRevision = CHROMIUM_REVISION_PATTERN.exec(left)?.[1]
	const rightRevision = CHROMIUM_REVISION_PATTERN.exec(right)?.[1]
	if (leftRevision === undefined || rightRevision === undefined) return right.localeCompare(left)
	return Number(rightRevision) - Number(leftRevision)
}

/**
 * Reads the executable path of Playwright's pinned Chromium revision.
 *
 * @returns The pinned executable path, or `undefined` when this platform has none.
 *
 * @remarks
 * Playwright throws rather than returning a path when the current platform carries no initialized
 * executable, and an unguarded call would fail configuration evaluation for every project.
 *
 * @example
 * ```ts
 * resolvePinnedBrowser()
 * ```
 */
export function resolvePinnedBrowser(): string | undefined {
	try {
		const pinned = chromium.executablePath()
		return pinned.length === 0 ? undefined : pinned
	} catch {
		return undefined
	}
}

/**
 * Resolves a launchable Playwright-managed Chromium executable: the pinned revision when installed,
 * otherwise a `chromium` / `chromium.exe` alias or any other `chromium-*` revision under the same
 * Playwright browsers directory. A pinned-revision miss is not Chromium absence — managed
 * containers ship one usable build, often behind a revision-agnostic alias, for many Playwright
 * versions.
 *
 * @param pinned - The executable path for Playwright's pinned Chromium revision.
 * @returns The managed executable path, or `undefined` when none is executable.
 *
 * @example
 * ```ts
 * resolveManagedBrowser('/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome')
 * ```
 */
export function resolveManagedBrowser(pinned: string): string | undefined {
	if (isBrowserExecutable(pinned)) return pinned
	let revisionRoot = dirname(pinned)
	for (;;) {
		if (CHROMIUM_ENTRY_PATTERN.test(basename(revisionRoot))) break
		const parent = dirname(revisionRoot)
		if (parent === revisionRoot) return undefined
		revisionRoot = parent
	}
	const browsersRoot = dirname(revisionRoot)
	for (const alias of ['chromium', 'chromium.exe']) {
		const candidate = resolvePath(browsersRoot, alias)
		if (isBrowserExecutable(candidate)) return candidate
	}
	let entries: readonly string[]
	try {
		entries = readdirSync(browsersRoot)
	} catch {
		return undefined
	}
	const revisions = entries
		.filter((entry) => CHROMIUM_ENTRY_PATTERN.test(entry))
		.sort(compareRevisions)
	for (const revision of revisions) {
		for (const layout of CHROMIUM_LAYOUTS) {
			const candidate = resolvePath(browsersRoot, revision, layout)
			if (isBrowserExecutable(candidate)) return candidate
		}
	}
	return undefined
}

/**
 * Resolves the Chromium a managed Linux container bundles outside the Playwright cache.
 *
 * @param platform - The Node platform the container runs on.
 * @param root - The bundled browsers directory to search.
 * @returns The highest matching executable path, or `undefined` when none is executable.
 *
 * @example
 * ```ts
 * resolveBundledBrowser('linux', BUNDLED_BROWSERS_ROOT)
 * ```
 */
export function resolveBundledBrowser(platform: NodeJS.Platform, root: string): string | undefined {
	if (platform !== 'linux') return undefined
	for (const layout of BUNDLED_CHROMIUM_LAYOUTS) {
		let matches: readonly string[]
		try {
			matches = globSync(layout, { cwd: root })
		} catch {
			return undefined
		}
		for (const match of [...matches].sort(compareRevisions)) {
			const candidate = resolvePath(root, match)
			if (isBrowserExecutable(candidate)) return candidate
		}
	}
	return undefined
}

/**
 * Resolves the first installed stable system Chromium channel.
 *
 * @param platform - The Node platform whose standard layouts this call probes.
 * @param environment - The process environment supplying Windows installation roots.
 * @returns `chrome`, then `msedge`, or `undefined` when neither is executable.
 *
 * @example
 * ```ts
 * resolveSystemBrowser(process.platform, process.env)
 * ```
 */
export function resolveSystemBrowser(
	platform: NodeJS.Platform,
	environment: NodeJS.ProcessEnv,
): string | undefined {
	if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') return undefined
	const roots = new Set<string>()
	if (platform === 'win32') {
		for (const root of [
			environment.LOCALAPPDATA,
			environment.PROGRAMFILES,
			environment['PROGRAMFILES(X86)'],
		]) {
			if (root !== undefined && root.length > 0) roots.add(root)
		}
		const homeDrive = environment.HOMEDRIVE
		if (homeDrive !== undefined && homeDrive.length > 0) {
			roots.add(join(homeDrive, 'Program Files'))
			roots.add(join(homeDrive, 'Program Files (x86)'))
		}
	}
	for (const browser of SYSTEM_BROWSER_CHANNELS) {
		if (platform === 'win32') {
			for (const root of roots) {
				if (isBrowserExecutable(join(root, ...browser.layouts.win32))) return browser.channel
			}
			continue
		}
		if (isBrowserExecutable(browser.layouts[platform])) return browser.channel
	}
	return undefined
}

/**
 * Resolves Playwright provider options for whatever browser this host can actually launch.
 *
 * @param pinned - The executable path for Playwright's pinned Chromium revision, when it has one.
 * @param platform - The Node platform whose standard layouts this call probes.
 * @param environment - The process environment supplying operator overrides and Windows roots.
 * @param root - The managed-container bundled browsers directory to search.
 * @returns Provider options naming an executable, a WebSocket endpoint, or a channel.
 *
 * @remarks
 * Precedence, most important first: `PLAYWRIGHT_EXECUTABLE_PATH`, `PLAYWRIGHT_WS_ENDPOINT`,
 * `PLAYWRIGHT_CHANNEL`, the managed Playwright Chromium, the container's bundled Chromium, a
 * verified system channel, then the platform default channel. An operator override outranks
 * discovery and is returned exactly as given: none of those environment values is checked
 * against the filesystem, because verifying an override would defeat the override. The pinned
 * managed revision outranks anything found on the host because it is deterministic. The installed
 * pinned revision returns empty options so Playwright keeps its own default launch semantics. Only
 * a discovered system channel is verified before it is named. The platform default is unverified
 * as well and exists only as a last resort: Windows takes `msedge`, which ships with the OS and
 * never collides with a foreground Chrome.
 *
 * @example
 * ```ts
 * resolveBrowser(resolvePinnedBrowser(), process.platform, process.env)
 * ```
 */
export function resolveBrowser(
	pinned: string | undefined,
	platform: NodeJS.Platform,
	environment: NodeJS.ProcessEnv,
	root: string = BUNDLED_BROWSERS_ROOT,
): PlaywrightProviderOptions {
	const executable = environment.PLAYWRIGHT_EXECUTABLE_PATH
	if (executable !== undefined && executable.length > 0) {
		return { launchOptions: { executablePath: executable } }
	}
	const endpoint = environment.PLAYWRIGHT_WS_ENDPOINT
	if (endpoint !== undefined && endpoint.length > 0) {
		return { connectOptions: { wsEndpoint: endpoint } }
	}
	const requested = environment.PLAYWRIGHT_CHANNEL
	if (requested !== undefined && requested.length > 0) {
		return { launchOptions: { channel: requested } }
	}
	const managed = pinned === undefined ? undefined : resolveManagedBrowser(pinned)
	if (managed !== undefined) {
		return managed === pinned ? {} : { launchOptions: { executablePath: managed } }
	}
	const bundled = resolveBundledBrowser(platform, root)
	if (bundled !== undefined) return { launchOptions: { executablePath: bundled } }
	const fallback = platform === 'win32' ? 'msedge' : 'chrome'
	return { launchOptions: { channel: resolveSystemBrowser(platform, environment) ?? fallback } }
}
