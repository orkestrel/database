// Bundles the tsc-emitted `dist/src/browser/*.d.ts` tree (produced by
// `tsc -p configs/src/tsconfig.browser.json`) into a single self-contained
// `index.d.ts`, remapping the `@src/core` specifier to `../core/index.js`
// (browser stays ESM-only — no `.d.cts` pass), mirroring the JS build's
// `@src/core` → `../core/index.js` remap.
import { readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { rollup } from 'rollup'
import dts from 'rollup-plugin-dts'

const outDir = fileURLToPath(new URL('../../dist/src/browser', import.meta.url))
const source = `${outDir}/.tsc-index.d.ts`

// tsc's pristine multi-file entry still has the bare `@src/core` specifier —
// rename it aside before bundling so `external: ['@src/core']` matches and
// rollup-plugin-dts leaves the specifier external instead of inlining core's
// types into the browser face.
renameSync(`${outDir}/index.d.ts`, source)

const build = await rollup({
	input: source,
	plugins: [dts()],
	external: ['@src/core'],
})
await build.write({
	file: `${outDir}/index.d.ts`,
	format: 'es',
	paths: { '@src/core': '../core/index.js' },
})
await build.close()
rmSync(source)

// Remove the intermediate per-module declaration files — only the rolled-up
// `index.d.ts` ships. This also covers `dist/src/core`: `tsc -p
// configs/src/tsconfig.browser.json` pulls `@src/core`'s source files into
// its program (to type-check the browser face) and, since core is under the
// shared `rootDir`, re-emits their per-module `.d.ts` alongside core's own
// already-bundled `index.d.ts` / `index.d.cts` — a harmless but stray side
// effect that gets pruned here.
function pruneStrayDeclarations(dir) {
	for (const entry of readdirSync(dir)) {
		const full = `${dir}/${entry}`
		const info = statSync(full)
		if (info.isDirectory()) {
			pruneStrayDeclarations(full)
			continue
		}
		if (entry === 'index.d.ts' || entry === 'index.d.cts') continue
		if (entry.endsWith('.d.ts')) rmSync(full)
	}
}

const coreDir = fileURLToPath(new URL('../../dist/src/core', import.meta.url))
for (const dir of [outDir, coreDir]) {
	pruneStrayDeclarations(dir)
}
