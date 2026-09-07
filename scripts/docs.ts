// ============================================================================
// scripts/docs.ts - the documentation-parity seed, run as `npm run docs`.
// ----------------------------------------------------------------------------
// With no flag it reads the guide index, compares every guide against the source
// it documents, and prints one line per disagreement. With `--to guide` or
// `--to source` it rewrites the named side through the readers and replacers
// `@orkestrel/guide` ships. The seed writes files and nothing else: it starts no
// process, formats nothing, and reads no network, so run `npm run format` after
// a write.
//
// `tests/guides.test.ts` reports the same disagreements and never writes.
// Converge the two sides here, never by weakening that gate.
//
// This entry is self-contained and imports no sibling: a target receives the
// file alone, so a module-scope declaration here has no centralized file to sit
// in. `.claude/rules/architecture.md` § Declaration placement is what permits
// that, and every declaration below stays local for the same reason.
// ============================================================================
import type {
	Drift,
	GuideInterface,
	GuideModule,
	ManifestEntry,
	SourceExample,
} from '@orkestrel/guide'
import {
	collectExamples,
	collectKeys,
	collectTitles,
	computeSymbolKey,
	createGuide,
	createSource,
	extractSourceLines,
	findDrift,
	locateComment,
	normalizeComment,
	parseManifest,
	replaceCell,
	replaceExample,
	replaceSummary,
	selectModuleKeys,
	spliceSpan,
} from '@orkestrel/guide'
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

/** Names the option the seed accepts, with the values it takes. */
const USAGE = 'usage: npm run docs [-- --to guide|--to source]'

/** Matches the files the guide readers reflect over, the same set the gate inventories. */
const INVENTORY: readonly string[] = ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md']

/** Names the package manifest whose bare name selects this workspace's own guide. */
const MANIFEST_FILE = 'package.json'

/** Names the concept index every guide row is read from. */
const INDEX_FILE = 'guides/README.md'

/** Names the file whose blockquote pitch equals this workspace's own guide tagline. */
const README_FILE = 'README.md'

/** Names the compared pair the pitch reports under. */
const PITCH_KEY = 'pitch'

/** Pairs one indexed guide with the source it documents and the disagreements between them. */
interface Row {
	readonly spec: string
	readonly guide: GuideInterface
	readonly drift: readonly Drift[]
	readonly titles: ReadonlyMap<string, SourceExample>
	readonly summaries: ReadonlySet<string>
	readonly index: ReadonlyMap<string, string>
}

/** Holds what one direction did with one row: the lines to print and the values to tally. */
interface Outcome {
	readonly lines: readonly string[]
	readonly written: number
	readonly reported: number
}

/**
 * Reads the inventory the guide readers reflect over.
 *
 * @param root - The workspace root to read from.
 * @returns Root-relative forward-slash keys mapped to file text.
 */
function readInventory(root: string): Record<string, string> {
	const files: Record<string, string> = {}
	for (const key of globSync([...INVENTORY], { cwd: root })) {
		files[key.replaceAll('\\', '/')] = readFileSync(resolve(root, key), 'utf8')
	}
	return files
}

/**
 * Reads the workspace's own bare package name.
 *
 * @param root - The workspace root to read from.
 * @returns The name after the scope, or `undefined` when the manifest declares none.
 */
function readShortName(root: string): string | undefined {
	const path = resolve(root, MANIFEST_FILE)
	if (!existsSync(path)) return undefined
	let manifest: unknown
	try {
		manifest = JSON.parse(readFileSync(path, 'utf8'))
	} catch {
		return undefined
	}
	if (typeof manifest !== 'object' || manifest === null) return undefined
	const name: unknown = Object.getOwnPropertyDescriptor(manifest, 'name')?.value
	if (typeof name !== 'string' || name.length === 0) return undefined
	return name.slice(name.lastIndexOf('/') + 1)
}

/**
 * Renders one side of a compared pair.
 *
 * @param text - The text that side carries, or `undefined` when it carries none.
 * @returns The text as a quoted single-line literal, or `absent`.
 */
function formatSide(text: string | undefined): string {
	return text === undefined ? 'absent' : JSON.stringify(text)
}

/**
 * Renders one disagreement as a single line.
 *
 * @param spec - The guide the disagreement was found in.
 * @param drift - The disagreement, with the text each side carries.
 * @returns The spec, the key, and each side's text or `absent`.
 */
function formatDrift(spec: string, drift: Drift): string {
	return `${spec} ${drift.key}: guide ${formatSide(drift.guide)} source ${formatSide(drift.source)}`
}

/**
 * Renders one disagreement a write left standing, with why it stands.
 *
 * @param spec - The guide the disagreement was found in.
 * @param drift - The disagreement, with the text each side carries.
 * @param reason - What stopped the write.
 * @returns The disagreement's line with the reason after it.
 */
function formatReported(spec: string, drift: Drift, reason: string): string {
	return `${formatDrift(spec, drift)}; ${reason}`
}

/**
 * Renders the pitch pair as a single line.
 *
 * @param spec - The guide whose tagline the pitch is compared with.
 * @param pitch - The README's blockquote pitch, or `undefined` when it carries none.
 * @param tagline - The guide's blockquote tagline, or `undefined` when it carries none.
 * @returns The spec, the key, and each side's text or `absent`.
 */
function formatPitch(spec: string, pitch: string | undefined, tagline: string | undefined): string {
	return `${spec} ${PITCH_KEY}: readme ${formatSide(pitch)} tagline ${formatSide(tagline)}`
}

/**
 * Collects the compared keys a guide's Surface and Methods tables carry.
 *
 * @param guide - The parsed guide.
 * @returns One key per documented symbol and per documented member.
 */
function collectCells(guide: GuideInterface): ReadonlySet<string> {
	const keys = new Set<string>()
	for (const symbol of guide.surface()) keys.add(computeSymbolKey(symbol))
	for (const group of guide.methods()) {
		for (const entry of group.methods) keys.add(`${group.interface}.${entry.name}`)
	}
	return keys
}

/**
 * Collects one line per input the run needs and the workspace does not carry.
 *
 * @param files - The workspace inventory the readers reflect over.
 * @param entries - The indexed rows, or `undefined` when the workspace carries no index.
 * @returns One line per missing input, each naming the file it is missing.
 */
function collectMissing(
	files: Readonly<Record<string, string>>,
	entries: readonly ManifestEntry[] | undefined,
): readonly string[] {
	if (entries === undefined) {
		return [`${INDEX_FILE}: the workspace carries no concept index to read`]
	}
	return entries
		.filter((entry) => files[entry.spec] === undefined)
		.map((entry) => `${entry.spec}: the concept index names it and the workspace does not carry it`)
}

/**
 * Indexes every compared key a module's files carry to the file carrying it.
 *
 * @param files - The workspace inventory the readers reflect over.
 * @param module - The source directories the guide documents.
 * @returns Each key mapped to the first file declaring it.
 */
function buildIndex(
	files: Readonly<Record<string, string>>,
	module: GuideModule,
): ReadonlyMap<string, string> {
	const index = new Map<string, string>()
	for (const file of selectModuleKeys(files, module)) {
		const text = files[file]
		if (text === undefined) continue
		for (const key of collectKeys(extractSourceLines(text)).values()) {
			if (!index.has(key)) index.set(key, file)
		}
	}
	return index
}

/**
 * Splits a compared example text into the block a replacer writes.
 *
 * @param name - The declaration or member whose doc block carries the block.
 * @param title - The heading text the fence and the tag pair on.
 * @param text - The compared text: the language on the first line, the body beneath.
 * @returns The block, carrying no language when the first line is empty.
 */
function splitExample(name: string, title: string, text: string): SourceExample {
	const at = text.indexOf('\n')
	const language = at === -1 ? text : text.slice(0, at)
	const code = at === -1 ? '' : text.slice(at + 1)
	return language.length === 0 ? { name, title, code } : { name, title, code, language }
}

/**
 * Finds the compared key of the doc block carrying one titled example.
 *
 * @param texts - The current text of every file, keyed root-relative.
 * @param index - Each compared key mapped to the file declaring it.
 * @param name - The declaration or member the block belongs to.
 * @param title - The heading text the tag carries.
 * @returns The key `locateComment` reaches the block by, or `undefined` when none does.
 */
function findExample(
	texts: ReadonlyMap<string, string>,
	index: ReadonlyMap<string, string>,
	name: string,
	title: string,
): string | undefined {
	for (const [key, file] of index) {
		if (key !== name && !key.endsWith(` ${name}`) && !key.endsWith(`.${name}`)) continue
		const text = texts.get(file)
		if (text === undefined) continue
		const span = locateComment(text, key)
		if (span === undefined) continue
		const block = text.slice(span.start, span.end)
		if (collectExamples(normalizeComment(block), name).some((one) => one.title === title)) {
			return key
		}
	}
	return undefined
}

/**
 * Reports every disagreement one row carries, writing nothing.
 *
 * @param row - The indexed guide and its disagreements.
 * @returns One line per disagreement, each left standing.
 */
function reportRow(row: Row): Outcome {
	return {
		lines: row.drift.map((drift) => formatDrift(row.spec, drift)),
		written: 0,
		reported: row.drift.length,
	}
}

/**
 * Carries every summary disagreement of one row across to its guide.
 *
 * @param row - The indexed guide and its disagreements.
 * @param texts - The current text of every file, keyed root-relative, rewritten in place.
 * @returns The lines left standing and the values to tally.
 */
function writeGuide(row: Row, texts: Map<string, string>): Outcome {
	const start = texts.get(row.spec)
	if (start === undefined) return reportRow(row)
	const lines: string[] = []
	let text = start
	let written = 0
	for (const drift of row.drift) {
		if (!row.summaries.has(drift.key)) {
			lines.push(formatReported(row.spec, drift, 'the guide fence owns an example'))
			continue
		}
		if (drift.source === undefined) {
			lines.push(formatReported(row.spec, drift, 'the source side carries no text'))
			continue
		}
		const replaced = replaceCell(text, drift.key, drift.source)
		if (replaced === undefined) {
			lines.push(formatReported(row.spec, drift, 'no Summary cell carries the key'))
			continue
		}
		if (replaced === text) continue
		text = replaced
		written += 1
	}
	if (text !== start) texts.set(row.spec, text)
	return { lines, written, reported: lines.length }
}

/**
 * Carries every disagreement of one row across to the source it documents.
 *
 * @param row - The indexed guide and its disagreements.
 * @param texts - The current text of every file, keyed root-relative, rewritten in place.
 * @returns The lines left standing and the values to tally.
 */
function writeSource(row: Row, texts: Map<string, string>): Outcome {
	const lines: string[] = []
	let written = 0
	for (const drift of row.drift) {
		if (drift.guide === undefined) {
			lines.push(formatReported(row.spec, drift, 'the guide side carries no text'))
			continue
		}
		const summary = row.summaries.has(drift.key)
		const example = row.titles.get(drift.key)
		const key = summary
			? drift.key
			: example === undefined
				? undefined
				: findExample(texts, row.index, example.name, drift.key)
		const file = key === undefined ? undefined : row.index.get(key)
		const text = file === undefined ? undefined : texts.get(file)
		if (key === undefined || file === undefined || text === undefined) {
			lines.push(formatReported(row.spec, drift, 'no doc block carries the key'))
			continue
		}
		const span = locateComment(text, key)
		if (span === undefined) {
			lines.push(formatReported(row.spec, drift, 'no doc block carries the key'))
			continue
		}
		const block = text.slice(span.start, span.end)
		const rewritten =
			example === undefined || summary
				? replaceSummary(block, drift.guide)
				: replaceExample(block, splitExample(example.name, drift.key, drift.guide))
		if (rewritten === undefined) {
			lines.push(formatReported(row.spec, drift, 'the doc block refused the rewrite'))
			continue
		}
		const spliced = spliceSpan(text, span, rewritten)
		if (spliced === text) continue
		texts.set(file, spliced)
		written += 1
	}
	return { lines, written, reported: lines.length }
}

const args = process.argv.slice(2)
const direction =
	args.length === 2 && args[0] === '--to' && (args[1] === 'guide' || args[1] === 'source')
		? args[1]
		: undefined
if (direction === undefined && args.length > 0) {
	process.stdout.write(`${USAGE}\n`)
	process.exitCode = 2
} else {
	const root = process.cwd()
	const files = readInventory(root)
	const manifest = files[INDEX_FILE]
	const entries = manifest === undefined ? undefined : parseManifest(manifest, 'guides')
	const missing = collectMissing(files, entries)
	if (entries === undefined || missing.length > 0) {
		for (const line of missing) process.stdout.write(`${line}\n`)
		process.exitCode = 2
	} else {
		// One current text per file, seeded once and rewritten in place, so a second
		// row over the same file rewrites what the first row left rather than the
		// bytes the run started from. The inventory stays frozen beside it, as what
		// each flush compares against to decide whether a file moved.
		const texts = new Map(Object.entries(files))
		const rows: Row[] = []
		for (const entry of entries) {
			const markdown = files[entry.spec]
			if (markdown === undefined) continue
			const guide = createGuide(markdown)
			const source = createSource({ files, module: entry.source })
			rows.push({
				spec: entry.spec,
				guide,
				drift: findDrift(guide, source),
				titles: collectTitles(guide, source),
				summaries: collectCells(guide),
				index: buildIndex(files, entry.source),
			})
		}

		const lines: string[] = []
		let found = 0
		let written = 0
		let reported = 0
		for (const row of rows) {
			found += row.drift.length
			const outcome =
				direction === undefined
					? reportRow(row)
					: direction === 'guide'
						? writeGuide(row, texts)
						: writeSource(row, texts)
			lines.push(...outcome.lines)
			written += outcome.written
			reported += outcome.reported
		}

		const name = readShortName(root)
		const readme = files[README_FILE]
		const own =
			name === undefined ? undefined : rows.find((row) => row.spec === `guides/${name}.md`)
		if (own !== undefined && readme !== undefined) {
			const pitch = createGuide(readme).tagline()
			const tagline = own.guide.tagline()
			if (pitch !== tagline) {
				found += 1
				reported += 1
				lines.push(
					direction === undefined
						? formatPitch(own.spec, pitch, tagline)
						: `${formatPitch(own.spec, pitch, tagline)}; the README pitch is authored by hand`,
				)
			}
		}

		const changed: string[] = []
		for (const [file, text] of texts) {
			if (text === files[file]) continue
			writeFileSync(resolve(root, file), text)
			changed.push(file)
		}
		changed.sort()

		for (const file of changed) process.stdout.write(`wrote ${file}\n`)
		for (const line of lines) process.stdout.write(`${line}\n`)
		process.stdout.write(
			direction === undefined
				? `rows read: ${rows.length}, disagreements found: ${found}\n`
				: `rows read: ${rows.length}, disagreements found: ${found}, written: ${written}, reported: ${reported}\n`,
		)
		if (changed.length > 0) process.stdout.write('next: npm run format\n')
		process.exitCode = reported > 0 ? 1 : 0
	}
}
