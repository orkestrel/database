#!/bin/bash
# ============================================================================
# scripts/scaffold.sh — scaffold a brand-new core-only @orkestrel package
# ----------------------------------------------------------------------------
# Usage: scaffold.sh <name> [target-dir]
#
# Host-relative: this script is mirrored into every @orkestrel repo, so it
# never assumes which repo it runs from. The "host" is the repo this copy of
# the script lives in (its parent directory) — every host file it vendors
# (AGENTS.md, scripts/, configs/src/*.core.*, guides/src/guide.md, ...) is
# read relative to that host, and copy-if-present so a host missing an
# optional file (e.g. no core config in a server-only repo) is a warn, not a
# failure.
#
# Target may exist ONLY if empty or containing nothing but a `.git` dir — this
# supports `git clone <empty-repo> <name> && scaffold.sh <name> <name>`.
#
# Provenance: templates (package.json, tsconfig.json, vite.config.ts, the two
# configs/src/*.core.* files, the parity test) are derived from
# @orkestrel/sse + @orkestrel/timeout on 2026-07-18. If either sibling's
# devDependencies or guides-parity harness have moved since, refresh this
# script from the live siblings before trusting its output verbatim.
# ============================================================================

set -uo pipefail

# Unconditionally select a working UTF-8 locale for character-width padding
# (md_table, below) — codepoints, not bytes: an em dash counted as 3 bytes
# would over-pad every markdown table oxfmt re-pads by character width, and a
# pre-existing LC_ALL=C (common in CI) must NOT survive, so this does not use
# `${LC_ALL:-...}`. Probes `locale -a` (case-insensitive) for the first
# UTF-8-capable entry, preferring C.UTF-8 / C.utf8 / en_US.UTF-8 when present.
select_utf8_locale() {
  local available preferred candidate
  available="$(locale -a 2>/dev/null || true)"
  if [ -z "$available" ]; then
    return 1
  fi
  for preferred in C.UTF-8 C.utf8 en_US.UTF-8 en_US.utf8; do
    if grep -qix -- "$preferred" <<<"$available"; then
      echo "$preferred"
      return 0
    fi
  done
  candidate="$(grep -i -m1 -E '^[a-z0-9_.-]*utf-?8$' <<<"$available" || true)"
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return 0
  fi
  return 1
}

if utf8_locale="$(select_utf8_locale)"; then
  export LC_ALL="$utf8_locale"
else
  echo "warn: no UTF-8 locale found on this host — generated markdown tables" >&2
  echo "warn: may mis-pad on non-ASCII cell content and fail format:check" >&2
fi

# Print a left-aligned markdown table, column widths sized to the widest cell
# per column (character count) — matches oxfmt's markdown table re-padding, so
# generated tables pass `format:check` without a formatter run.
# Usage: md_table "Header1<TAB>Header2<TAB>..." "row1c1<TAB>row1c2<TAB>..." ...
#
# NOTE: bash's `printf -v x "%-Ns"` pads to N BYTES, not N characters — a
# multi-byte cell (e.g. one containing an em dash) would under-pad by however
# many extra bytes its multi-byte codepoints cost. pad_cell(), below, computes
# the padding length from `${#text}` (character count under a UTF-8 locale)
# and appends plain-ASCII spaces directly, sidestepping printf's byte width.
pad_cell() {
  local text="$1" width="$2" len n spaces=""
  len=${#text}
  n=$((width - len))
  if ((n > 0)); then
    spaces="$(printf '%*s' "$n" '')"
  fi
  printf '%s%s' "$text" "$spaces"
}

md_table() {
  local header="$1"
  shift
  local -a headercells
  IFS=$'\t' read -r -a headercells <<<"$header"
  local ncols=${#headercells[@]}
  local -a widths
  local i
  for ((i = 0; i < ncols; i++)); do
    widths[i]=${#headercells[i]}
  done
  local -a rows=("$@")
  local row
  for row in "${rows[@]}"; do
    local -a cells
    IFS=$'\t' read -r -a cells <<<"$row"
    for ((i = 0; i < ncols; i++)); do
      local cell="${cells[i]:-}" len
      len=${#cell}
      if ((len > widths[i])); then widths[i]=$len; fi
    done
  done
  local line dashes
  line="|"
  for ((i = 0; i < ncols; i++)); do
    line="$line $(pad_cell "${headercells[i]}" "${widths[i]}") |"
  done
  echo "$line"
  line="|"
  for ((i = 0; i < ncols; i++)); do
    dashes="$(printf '%*s' "${widths[i]}" '')"
    line="$line ${dashes// /-} |"
  done
  echo "$line"
  for row in "${rows[@]}"; do
    local -a cells
    IFS=$'\t' read -r -a cells <<<"$row"
    line="|"
    for ((i = 0; i < ncols; i++)); do
      line="$line $(pad_cell "${cells[i]:-}" "${widths[i]}") |"
    done
    echo "$line"
  done
}

usage() {
  echo "Usage: $(basename "$0") <name> [target-dir]" >&2
  echo "  <name>       must match ^[a-z][a-z0-9-]*$" >&2
  echo "  [target-dir] optional; defaults to <host-root>/../<name>" >&2
  echo "               must not already exist, or must be empty, or must" >&2
  echo "               contain nothing but a .git directory" >&2
}

name="${1:-}"
if [ -z "$name" ]; then
  echo "error: missing <name>" >&2
  usage
  exit 2
fi
if ! [[ "$name" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "error: invalid name '$name' — must match ^[a-z][a-z0-9-]*\$" >&2
  usage
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
host_root="$(cd "$script_dir/.." && pwd)"

target="${2:-"$host_root/../$name"}"

# ---------------------------------------------------------------------------
# Target validation — may exist only if empty or .git-only.
# ---------------------------------------------------------------------------
abort_incomplete() {
  echo "error: scaffold incomplete — target may be partial: $1" >&2
  exit 1
}

if [ -e "$target" ]; then
  if [ ! -d "$target" ]; then
    echo "error: target '$target' exists and is not a directory" >&2
    exit 2
  fi
  # A non-zero `find` exit (permission error, transient I/O failure, ...) is
  # NOT "empty" — treat it as a refusal rather than silently proceeding (A3).
  if ! entries=$(find "$target" -mindepth 1 -maxdepth 1 -not -name '.git'); then
    echo "error: could not inspect target '$target' — refusing to proceed" >&2
    exit 2
  fi
  if [ -n "$entries" ]; then
    echo "error: target '$target' exists and is not empty (beyond .git) — refusing to overwrite" >&2
    exit 2
  fi
fi

mkdir -p "$target" || abort_incomplete "mkdir -p '$target' failed"
target="$(cd "$target" && pwd)" || abort_incomplete "could not resolve target '$target'"

if [ ! -d "$target/.git" ]; then
  git init -b main "$target" >/dev/null || abort_incomplete "git init failed at '$target'"
fi

# PascalCase of <name> — hyphens are word breaks.
pascal="$(echo "$name" | awk 'BEGIN{FS="-"} {out="";for(i=1;i<=NF;i++){s=$i;out=out toupper(substr(s,1,1)) substr(s,2)};printf "%s",out}')"

# Pre-rendered, oxfmt-width markdown tables for the two guide files — the
# padding depends on the interpolated name/pascal length, so it is computed
# here (once) via md_table rather than hand-padded in the heredocs below.
concept_table="$(md_table "Concept	Spec	Source	Tests" \
  "${pascal}	[\`src/${name}.md\`](src/${name}.md)	[\`src/core\`](../src/core)	[\`tests/src/core\`](../tests/src/core)")"

directory_table="$(md_table "Directory	Guide" \
  "\`src/core\`	[\`src/${name}.md\`](src/${name}.md)")"

factories_table="$(md_table "API	Kind	Summary" \
  "\`create${pascal}\`	function	Create a \`${pascal}Interface\` from \`${pascal}Options\`.")"

entities_table="$(md_table "API	Kind	Summary" \
  "\`${pascal}\`	class	Implements \`${pascal}Interface\` exactly.")"

types_table="$(md_table "Type	Kind	Shape" \
  "\`${pascal}Options\`	interface	\`{ id?: string }\` — options for \`create${pascal}\` / the constructor." \
  "\`${pascal}Interface\`	interface	\`{ id: string }\` — a working \`${pascal}\`, pure data.")"

created=0

# Track and print any host file that was expected but absent (copy-if-present).
warn_missing() {
  echo "warn: host is missing '$1' — skipping" >&2
}

copy_file() {
  local rel="$1"
  local src="$host_root/$rel"
  local dst="$target/$rel"
  if [ ! -e "$src" ]; then
    warn_missing "$rel"
    return
  fi
  mkdir -p "$(dirname "$dst")" || abort_incomplete "mkdir -p for '$rel' failed"
  cp -a "$src" "$dst" || abort_incomplete "cp '$rel' failed"
  created=$((created + 1))
}

copy_tree() {
  local rel="$1"
  local src="$host_root/$rel"
  if [ ! -e "$src" ]; then
    warn_missing "$rel"
    return
  fi
  mkdir -p "$(dirname "$target/$rel")" || abort_incomplete "mkdir -p for '$rel' failed"
  cp -a "$src" "$target/$rel" || abort_incomplete "cp -a '$rel' failed"
  local count
  count=$(find "$target/$rel" -type f | wc -l) || abort_incomplete "could not count files under '$rel'"
  created=$((created + count))
}

write_file() {
  local rel="$1"
  local dst="$target/$rel"
  mkdir -p "$(dirname "$dst")" || abort_incomplete "mkdir -p for '$rel' failed"
  cat >"$dst" || abort_incomplete "writing '$rel' failed"
  created=$((created + 1))
}

# ---------------------------------------------------------------------------
# A) COPY-FROM-HOST — byte-copy, copy-if-present / warn-and-skip if absent.
# ---------------------------------------------------------------------------
copy_file "AGENTS.md"
copy_file "CLAUDE.md"
copy_file "SCAFFOLD.md"
copy_file "LICENSE"
copy_tree ".claude"
copy_file ".github/workflows/ci.yml"
copy_file ".editorconfig"
copy_file ".gitattributes"
copy_file ".gitignore"
copy_file ".oxfmtrc.json"
copy_file ".oxlintrc.json"
copy_file ".oxlintignore"
copy_file ".prettierignore"
copy_tree "scripts"
copy_file "guides/src/guide.md"

if [ -d "$target/scripts" ]; then
  chmod +x "$target"/scripts/*.sh 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# B) TEMPLATE FILES — name-interpolated heredocs, pre-formatted to oxfmt.
# ---------------------------------------------------------------------------

write_file "package.json" <<EOF
{
	"name": "@orkestrel/${name}",
	"version": "0.0.1",
	"description": "TODO: one-line description. Part of the @orkestrel line.",
	"keywords": [
		"${name}",
		"typescript"
	],
	"homepage": "https://github.com/orkestrel/${name}#readme",
	"bugs": "https://github.com/orkestrel/${name}/issues",
	"license": "MIT",
	"repository": {
		"type": "git",
		"url": "git+https://github.com/orkestrel/${name}.git"
	},
	"files": [
		"dist",
		"README.md"
	],
	"type": "module",
	"sideEffects": false,
	"main": "./dist/src/core/index.cjs",
	"module": "./dist/src/core/index.js",
	"types": "./dist/src/core/index.d.ts",
	"exports": {
		".": {
			"import": {
				"types": "./dist/src/core/index.d.ts",
				"default": "./dist/src/core/index.js"
			},
			"require": {
				"types": "./dist/src/core/index.d.cts",
				"default": "./dist/src/core/index.cjs"
			}
		},
		"./package.json": "./package.json"
	},
	"publishConfig": {
		"access": "public"
	},
	"scripts": {
		"clean": "node -e \"try{require('node:fs').rmSync('dist',{recursive:true,force:true})}catch{}\"",
		"copy": "node -e \"const fs=require('node:fs'),p=require('node:path'),a=process.argv[1],b=process.argv[2];fs.mkdirSync(p.dirname(b),{recursive:true});fs.cpSync(a,b,{force:true});console.log('Copied: '+a+' to '+b)\"",
		"tmp:txt": "node -e \"const fs=require('node:fs'),p=require('node:path');function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){walk(f)}else if(!e.name.endsWith('.md')&&!e.name.endsWith('.txt')){const t=f+'.txt';if(!fs.existsSync(t)){fs.renameSync(f,t)}else{console.warn('Skipping '+f+' — target exists: '+t)}}}}try{walk('tmp')}catch(e){if(e.code!=='ENOENT')throw e}\"",
		"scaffold": "bash scripts/scaffold.sh",
		"lint": "oxlint --config .oxlintrc.json --fix .",
		"check": "tsc --noEmit --project tsconfig.json && npm run check:src",
		"check:src": "npm run check:src:core",
		"check:src:core": "tsc --noEmit -p configs/src/tsconfig.core.json",
		"format": "oxfmt --config .oxfmtrc.json --write .",
		"format:check": "oxfmt --config .oxfmtrc.json --check .",
		"lint:check": "oxlint --config .oxlintrc.json .",
		"test": "npm run test:src && npm run test:guides",
		"test:src": "vitest run --config vite.config.ts --no-cache --reporter=dot --project src:core",
		"test:src:core": "vitest run --config vite.config.ts --no-cache --reporter=dot --project src:core",
		"test:guides": "vitest run --config vite.config.ts --reporter=dot --project guides",
		"build": "npm run clean && npm run build:src",
		"build:src": "npm run build:src:core",
		"build:src:core": "vite build --config configs/src/vite.core.config.ts && npm run copy dist/src/core/index.d.ts dist/src/core/index.d.cts",
		"prepublishOnly": "npm run format:check && npm run lint:check && npm run check && npm run build && npm test"
	},
	"devDependencies": {
		"@microsoft/api-extractor": "^7.58.11",
		"@orkestrel/guide": "^0.0.5",
		"@types/node": "^26.1.1",
		"oxfmt": "^0.59.0",
		"oxlint": "^1.74.0",
		"typescript": "^6.0.3",
		"vite": "^8.1.5",
		"vite-plugin-dts": "^5.0.3",
		"vitest": "^4.1.10"
	},
	"engines": {
		"node": ">=22"
	}
}
EOF

write_file "tsconfig.json" <<'EOF'
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"lib": ["ESNext", "DOM", "DOM.Iterable"],
		"types": ["node", "vite/client", "vitest/globals"],

		"moduleDetection": "force",
		"resolveJsonModule": true,

		"strict": true,
		"noImplicitOverride": true,
		"noFallthroughCasesInSwitch": true,
		"forceConsistentCasingInFileNames": true,
		"skipLibCheck": true,

		"noEmit": true,
		"paths": {
			"@src/core": ["./src/core/index.ts"]
		}
	},
	"exclude": ["node_modules", "dist", "tmp"]
}
EOF

write_file "vite.config.ts" <<'EOF'
import type { UserConfig } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import tsconfig from './tsconfig.json' with { type: 'json' }
import { fileURLToPath, URL } from 'node:url'

export function resolveWorkspacePath(relativePath: string): string {
	return fileURLToPath(new URL(relativePath, import.meta.url))
}

const resolve = {
	alias: Object.entries(tsconfig.compilerOptions.paths).reduce(
		(a, [k, v]) => Object.assign(a, { [k]: resolveWorkspacePath(v[0]) }),
		{},
	),
}

// Base: shared resolve + build defaults + src:core tests.
export const srcCore = (config?: UserConfig): UserConfig =>
	mergeConfig(
		{
			resolve,
			build: {
				emptyOutDir: true,
				sourcemap: true,
				minify: false,
			},
			test: {
				name: { label: 'src:core', color: 'magenta' },
				include: ['tests/src/core/**/*.test.ts'],
				setupFiles: ['./tests/setup.ts'],
				environment: 'node',
				browser: { enabled: false },
			},
		},
		config ?? {},
	)

// Extends srcCore: the guides-parity suite. Node env — it reads the real
// guides/*.md and the documented source modules off disk — but resolves like core tests.
export const guides = (config?: UserConfig): UserConfig =>
	srcCore(
		mergeConfig(
			{
				test: {
					name: { label: 'guides', color: 'green' },
					include: ['tests/guides/**/*.test.ts'],
					exclude: ['tests/src/**/*.test.ts', 'tests/setup.test.ts'],
				},
			},
			config ?? {},
		),
	)

export default defineConfig({
	resolve,
	test: {
		projects: [srcCore, guides],
	},
})
EOF

write_file "configs/src/tsconfig.core.json" <<'EOF'
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"lib": ["ESNext"],
		"noEmit": false,
		"declaration": true,
		"emitDeclarationOnly": true,
		"rootDir": "../../src/core",
		"outDir": "../../dist/src/core"
	},
	"include": ["../../src/core/**/*.ts"]
}
EOF

write_file "configs/src/vite.core.config.ts" <<'EOF'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcCore, resolveWorkspacePath } from '../../vite.config'

export default defineConfig(
	srcCore({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.core.json'),
				bundleTypes: true,
			}),
		],
		build: {
			lib: {
				entry: resolveWorkspacePath('src/core/index.ts'),
				formats: ['es', 'cjs'],
				fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
			},
			outDir: 'dist/src/core',
			rollupOptions: {
				external: [/^node:/, /^@orkestrel\//],
			},
		},
	}),
)
EOF

write_file "tests/guides/src/parity.test.ts" <<EOF
// The consumer-side guides-parity drop-in (PROPOSAL §6): runs \`@orkestrel/guide\`'s
// checks against this repo's own \`guides/README.md\` manifest.

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
const SELF_SPECIFIERS = ['@orkestrel/${name}', '@src/core']

function walk(dir: string, acc: Record<string, string>): void {
	for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		const relative = \`\${dir}/\${entry.name}\`
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
	if (text === undefined) throw new Error(\`Missing file: \${relative}\`)
	return text
}

const manifest = parseManifest(readText('guides/README.md'), 'guides')

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(readText(entry.spec))
	const source = createSource({ files, module: entry.source })

	describe(\`\${entry.concept}\`, () => {
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
			const entity = group.interface.replace(/Interface\$/, '')
			describe(\`\${group.interface}\`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(\`\${entity} exposes no undocumented method\`, () => {
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
			const entity = group.interface.replace(/Interface\$/, '')
			describe(\`\${group.interface} examples\`, () => {
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

		it('imports only real exports in every \`\`\`ts fence', () => {
			const exportNames = source.exports().map((symbol) => symbol.name)
			for (const fence of guide.patterns()) {
				for (const { specifier, names } of fenceImports(fence)) {
					if (!SELF_SPECIFIERS.includes(specifier)) continue
					expect(findMissing(names, exportNames)).toEqual([])
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
EOF

# ---------------------------------------------------------------------------
# C) GENERATED-MINIMAL stubs — name/Pascal-interpolated, pre-formatted.
# ---------------------------------------------------------------------------

write_file "src/core/types.ts" <<EOF
/** Options for \`create${pascal}\`. */
export interface ${pascal}Options {
	readonly id?: string
}

/** A working \`${pascal}\` — pure data, no behavior. */
export interface ${pascal}Interface {
	readonly id: string
}
EOF

write_file "src/core/${pascal}.ts" <<EOF
import type { ${pascal}Interface, ${pascal}Options } from './types.js'

/**
 * A working \`${pascal}\` — pure data, no behavior.
 *
 * @example
 * \`\`\`ts
 * const instance = new ${pascal}({ id: 'example' })
 * \`\`\`
 */
export class ${pascal} implements ${pascal}Interface {
	readonly id: string

	constructor(options: ${pascal}Options = {}) {
		this.id = typeof options.id === 'string' ? options.id : crypto.randomUUID()
	}
}
EOF

write_file "src/core/factories.ts" <<EOF
import type { ${pascal}Interface, ${pascal}Options } from './types.js'
import { ${pascal} } from './${pascal}.js'

/**
 * Create a \`${pascal}Interface\`.
 *
 * @param options - An optional \`id\` (defaults to a random UUID)
 * @returns A working {@link ${pascal}Interface}
 *
 * @example
 * \`\`\`ts
 * import { create${pascal} } from '@src/core'
 *
 * const instance = create${pascal}({ id: 'example' })
 * \`\`\`
 */
export function create${pascal}(options: ${pascal}Options = {}): ${pascal}Interface {
	return new ${pascal}(options)
}
EOF

write_file "src/core/index.ts" <<EOF
export type * from './types.js'
export * from './${pascal}.js'
export * from './factories.js'
EOF

write_file "tests/setup.ts" <<'EOF'
// ── Call recorder (a real callback, not a mock) ──────────────────────────────
//
// AGENTS §16.1: when a test only needs to count calls or inspect arguments, use a
// recorder — a real listener that records every invocation — rather than a test-
// framework spy. `handler` is a genuine callback; `calls` is each invocation's
// argument tuple, in order.

/** A real call-recording callback over an argument tuple (AGENTS §16.1). */
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

/**
 * Create a {@link TestRecorderInterface} — a real callback that records each
 * invocation's arguments, for asserting what fired and with what (AGENTS §16.1).
 *
 * @typeParam TArgs - The argument tuple the recorded handler receives
 * @returns A recorder whose `handler` records into `calls`
 */
export function createRecorder<TArgs extends readonly unknown[]>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler(...args: TArgs) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}
EOF

write_file "tests/src/core/${pascal}.test.ts" <<EOF
import type { ${pascal}Interface } from '@src/core'
import { ${pascal} } from '@src/core'
import { describe, expect, it } from 'vitest'

// The ${pascal} entity — id assignment (explicit / generated) and independence
// across instances. Factory-level assertions live in factories.test.ts.

describe('${pascal}', () => {
	it('round-trips an explicit id', () => {
		const instance: ${pascal}Interface = new ${pascal}({ id: 'example' })

		expect(instance.id).toBe('example')
	})

	it('generates a non-empty id when none is given', () => {
		const instance = new ${pascal}()

		expect(typeof instance.id).toBe('string')
		expect(instance.id.length).toBeGreaterThan(0)
	})

	it('gives distinct instances distinct generated ids', () => {
		const a = new ${pascal}()
		const b = new ${pascal}()

		expect(a.id).not.toBe(b.id)
	})
})
EOF

write_file "tests/src/core/factories.test.ts" <<EOF
import type { ${pascal}Interface } from '@src/core'
import { create${pascal}, ${pascal} } from '@src/core'
import { describe, expect, expectTypeOf, it } from 'vitest'

// The ${pascal} factory — that \`create${pascal}\` returns a working ${pascal}Interface
// backed by a real ${pascal} instance.

describe('create${pascal}', () => {
	it('returns a ${pascal} instance', () => {
		const instance = create${pascal}()

		expect(instance).toBeInstanceOf(${pascal})
	})

	it('honors the id option', () => {
		const instance = create${pascal}({ id: 'example' })

		expect(instance.id).toBe('example')
	})

	it('create${pascal} returns a ${pascal}Interface', () => {
		expectTypeOf(create${pascal}()).toEqualTypeOf<${pascal}Interface>()
	})
})
EOF

write_file "guides/src/${name}.md" <<EOF
# ${pascal}

> TODO: one-paragraph description of \`${pascal}\` — what it is, what problem it
> solves, and how it fits the \`@orkestrel\` line. Source: [\`src/core\`](../../src/core).
> Surfaced through the \`@src/core\` barrel.

## Surface

TODO: a short intro line, then a minimal usage example:

\`\`\`ts
import { create${pascal} } from '@src/core'

const instance = create${pascal}({ id: 'example' })
\`\`\`

### Factories

${factories_table}

### Entities

${entities_table}

### Types

${types_table}

## Tests

- [\`tests/src/core/${pascal}.test.ts\`](../../tests/src/core/${pascal}.test.ts) —
  id assignment (explicit / generated) and independence across instances.
- [\`tests/src/core/factories.test.ts\`](../../tests/src/core/factories.test.ts) —
  \`create${pascal}\` returns a working \`${pascal}Interface\` backed by a real \`${pascal}\`.

## See also

- [\`AGENTS.md\`](../../AGENTS.md) — the rules.
- [\`guide.md\`](guide.md) — the mirrored guide for \`@orkestrel/guide\`, the
  devDependency powering this repo's guides-parity test suite.
- [\`README.md\`](../README.md) — the guides index.
EOF

write_file "guides/README.md" <<EOF
# Guides

A dual-axis index into this repository's guides — by concept, and by directory (AGENTS §22).

## By concept

${concept_table}

## By directory

${directory_table}

## Dependency reference

[\`src/guide.md\`](src/guide.md) is a byte-identical mirror of the guide for
\`@orkestrel/guide\` — the devDependency powering this repo's guides-parity test
suite (\`tests/guides/src/parity.test.ts\`). It documents **that package's**
surface (\`Guide\` / \`Source\`, the manifest and comparison helpers), not anything
sourced in this repo; it is kept here so a reader of the parity suite can see
the primitives it is built from without leaving this guide set.

## See also

- [\`AGENTS.md\`](../AGENTS.md) — the rules; §22 documentation-as-contracts.
EOF

write_file "README.md" <<EOF
# @orkestrel/${name}

TODO: one-line description. Part of the \`@orkestrel\` line.

## Install

\`\`\`sh
npm install @orkestrel/${name}
\`\`\`

## Usage

\`\`\`ts
import { create${pascal} } from '@orkestrel/${name}'

const instance = create${pascal}({ id: 'example' })
\`\`\`

## Guide

For the full surface, see [\`guides/src/${name}.md\`](guides/src/${name}.md).

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
EOF

# ---------------------------------------------------------------------------
# Report.
# ---------------------------------------------------------------------------
echo ""
echo "Scaffolded @orkestrel/${name} at $target ($created files created)."
echo "Templates derived from @orkestrel/sse + @orkestrel/timeout on 2026-07-18 —"
echo "refresh scaffold.sh from live siblings if their devDeps/parity harness moved since."
echo ""
echo "Next steps:"
echo "  cd $target && npm install"
echo "  npm run format:check && npm run lint:check && npm run check && npm run build && npm run test"
echo ""
echo "TODO before publishing: fill in package.json's description/keywords and the"
echo "guide/README prose placeholders (currently TODO stubs)."
