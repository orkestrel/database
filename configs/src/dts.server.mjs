// Bundles the tsc-emitted `dist/src/server/*.d.ts` tree (produced by
// `tsc -p configs/src/tsconfig.server.json`) into a single self-contained
// `index.d.ts`, then rolls a second pass into `index.d.cts` — mirroring the
// JS build's format-aware `@src/core` remap so the ESM types face imports
// `../core/index.js` (→ core's `index.d.ts`) and the CJS types face imports
// `../core/index.cjs` (→ core's `index.d.cts`), per node16/nodenext
// declaration-file resolution.
import { readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { rollup } from 'rollup'
import dts from 'rollup-plugin-dts'

const outDir = fileURLToPath(new URL('../../dist/src/server', import.meta.url))
const source = `${outDir}/.tsc-index.d.ts`

// tsc's pristine multi-file entry still has the bare `@src/core` specifier —
// rename it aside so BOTH bundle passes below start from that same pristine
// input. Bundling the previous pass's OUTPUT (which already rewrote
// `@src/core` to a relative `../core/index.*` specifier) would make the
// `external: ['@src/core']` match nothing, so rollup-plugin-dts inlines
// `../core/index.js` as an unresolved local file instead of leaving it
// external — duplicating core's types into the server face and defeating
// the whole point of the format-aware remap.
renameSync(`${outDir}/index.d.ts`, source)

async function bundle(file, corePath) {
	const build = await rollup({
		input: source,
		plugins: [dts()],
		external: ['@src/core'],
	})
	await build.write({ file, format: 'es', paths: { '@src/core': corePath } })
	await build.close()
}

await bundle(`${outDir}/index.d.ts`, '../core/index.js')
await bundle(`${outDir}/index.d.cts`, '../core/index.cjs')
rmSync(source)

// Remove the intermediate per-module declaration files — only the two
// rolled-up entry declarations (`index.d.ts`, `index.d.cts`) ship. This also
// covers `dist/src/core`: `tsc -p configs/src/tsconfig.server.json` pulls
// `@src/core`'s source files into its program (to type-check the server
// face) and, since core is under the shared `rootDir`, re-emits their
// per-module `.d.ts` alongside core's own already-bundled `index.d.ts` /
// `index.d.cts` — a harmless but stray side effect that gets pruned here.
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
