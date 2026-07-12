// Rewrites the repo-internal '@src/core' path alias left behind in emitted
// .d.ts declaration files (tsc does not resolve tsconfig `paths` aliases in
// declaration emit, unlike vite's runtime bundling which does) into the
// depth-correct relative specifier pointing at dist/src/core/index.js.
import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const ALIAS_PATTERN = /(['"])@src\/core\1/g

function findDeclarationFiles(dir) {
	const results = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		const info = statSync(full)
		if (info.isDirectory()) {
			results.push(...findDeclarationFiles(full))
		} else if (entry.endsWith('.d.ts')) {
			results.push(full)
		}
	}
	return results
}

function relativeSpecifierToCore(file, coreDir) {
	const fromDir = dirname(file)
	let rel = relative(fromDir, join(coreDir, 'index.js'))
	rel = rel.split(sep).join('/')
	if (!rel.startsWith('.')) {
		rel = `./${rel}`
	}
	return rel
}

function rewriteFile(file, coreDir) {
	const original = readFileSync(file, 'utf8')
	if (!original.includes('@src/core')) {
		return false
	}
	const specifier = relativeSpecifierToCore(file, coreDir)
	const rewritten = original.replace(
		ALIAS_PATTERN,
		(_match, quote) => `${quote}${specifier}${quote}`,
	)
	if (rewritten !== original) {
		writeFileSync(file, rewritten, 'utf8')
		return true
	}
	return false
}

function main() {
	const target = process.argv[2]
	if (!target) {
		console.error('Usage: rewrite.paths.mjs <dist-subtree-dir>')
		process.exit(1)
	}
	const targetDir = resolve(process.cwd(), target)
	const coreDir = join(dirname(targetDir), 'core')
	const files = findDeclarationFiles(targetDir)
	let changed = 0
	for (const file of files) {
		if (rewriteFile(file, coreDir)) {
			changed += 1
		}
	}
	console.log(`Rewrote @src/core alias in ${changed} declaration file(s) under ${target}`)
}

main()
