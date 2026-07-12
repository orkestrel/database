// The consumer-side guides-parity drop-in (PROPOSAL §6): runs `@orkestrel/guide`'s
// checks against this repo's own `guides/README.md` manifest — one row (Router)
// spanning the core/browser/server faces as a multi-dir `GuideModule` (AGENTS §22 —
// one guide per package).

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
	createGuide,
	createSource,
	fenceImports,
	findMissing,
	findUnexampled,
	isExternalLink,
	missingSymbols,
	parseManifest,
	resolveLink,
	symbolKey,
} from '@orkestrel/guide'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const WALK_DIRS = ['src', 'guides', 'tests']
const SELF_SPECIFIERS = ['@orkestrel/router', '@src/core', '@src/browser', '@src/server']

function walk(dir: string, acc: Record<string, string>): void {
	for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		const relative = `${dir}/${entry.name}`
		if (entry.isDirectory()) {
			walk(relative, acc)
			continue
		}
		if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.md')) continue
		acc[relative] = readFileSync(join(ROOT, relative), 'utf8')
	}
}

const files: Record<string, string> = {}
for (const dir of WALK_DIRS) walk(dir, files)
files['AGENTS.md'] = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')

function readText(relative: string): string {
	const text = files[relative]
	if (text === undefined) throw new Error(`Missing file: ${relative}`)
	return text
}

const manifest = parseManifest(readText('guides/README.md'), 'guides')

// Cross-face imports are real in this multi-face package (a listener.md fence imports
// `createDispatcher` from `@src/core`, a navigator.md fence imports core registry types) —
// so the fence-import check resolves each specifier to ITS OWN face's exports rather than
// only the current manifest entry's, per the specifier → module map below.
const SPECIFIER_MODULES: Readonly<Record<string, string>> = {
	'@orkestrel/router': 'src/core',
	'@src/core': 'src/core',
	'@src/browser': 'src/browser',
	'@src/server': 'src/server',
}
const specifierSources = new Map<string, ReturnType<typeof createSource>>()
function exportsFor(specifier: string): readonly string[] {
	const module = SPECIFIER_MODULES[specifier]
	if (module === undefined) return []
	let source = specifierSources.get(module)
	if (source === undefined) {
		source = createSource({ files, module })
		specifierSources.set(module, source)
	}
	return source.exports().map((symbol) => symbol.name)
}

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(readText(entry.spec))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('documents every source export', () => {
			expect(missingSymbols(source.exports(), guide.surface())).toEqual([])
		})
		it('documents only real exports', () => {
			expect(missingSymbols(guide.surface(), source.exports())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(symbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every Surface function', () => {
			const fences = guide.patterns()
			const names = guide
				.surface()
				.filter((symbol) => symbol.kind === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide.patterns()
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			for (const fence of guide.patterns()) {
				for (const { specifier, names } of fenceImports(fence)) {
					if (!SELF_SPECIFIERS.includes(specifier)) continue
					expect(findMissing(names, exportsFor(specifier))).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
		})
	})
}
