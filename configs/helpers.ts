import type { Plugin, Rolldown } from 'vite'
import { parseSync, transformWithOxc, Visitor } from 'vite'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire, isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import {
	closeSync,
	constants as FS_CONSTANTS,
	existsSync,
	fstatSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'

export function hasAsciiUrlControl(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0)
		if (code !== undefined && (code <= 0x1f || code === 0x7f)) return true
	}
	return false
}

export const PACKAGE_MANIFEST_BYTES = 1_048_576
export const ENVIRONMENT_MODULE_BYTES = 8_388_608

/**
 * Throws on a CommonJS import-meta rewrite and forwards every other build log.
 *
 * @param level - The Rolldown log level.
 * @param log - The structured Rolldown log.
 * @param report - The active default log handler.
 * @returns Nothing.
 * @throws An error when Rolldown reports `EMPTY_IMPORT_META`.
 */
export function enforceBuildLog(
	level: Rolldown.LogLevel,
	log: Rolldown.RolldownLog,
	report: Rolldown.LogOrStringHandler,
): void {
	if (log.code === 'EMPTY_IMPORT_META') {
		throw new Error(`[orkestrel-build] ${log.message}`)
	}
	report(level, log)
}

export const WORKSPACE_ROOT = realpathSync.native(
	resolvePath(dirname(fileURLToPath(import.meta.url)), '..'),
)

export function fileSystemPath(pathname: string): string {
	if (!pathname.startsWith('/@fs/')) return pathname
	const candidate = pathname.slice('/@fs/'.length)
	// Vite URL normalization can collapse the leading slash of a POSIX absolute path.
	return candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate)
		? candidate
		: `/${candidate}`
}

export function physicalPath(path: string): string {
	const [pathWithoutQuery] = path.split('?')
	const candidate = fileSystemPath(pathWithoutQuery ?? path)
	const physicalCandidate = /^file:/i.test(candidate) ? fileURLToPath(candidate) : candidate
	const absoluteCandidate =
		physicalCandidate.length === 0
			? WORKSPACE_ROOT
			: isAbsolute(physicalCandidate)
				? physicalCandidate
				: resolvePath(WORKSPACE_ROOT, physicalCandidate)
	return existsSync(absoluteCandidate) ? realpathSync.native(absoluteCandidate) : absoluteCandidate
}

export function sourceFallback(importer: string, source: string): string {
	return /^file:/i.test(source) ? fileURLToPath(source) : resolvePath(dirname(importer), source)
}

export function workspacePath(path: string): string | undefined {
	const relativePath = relative(WORKSPACE_ROOT, physicalPath(path)).replaceAll('\\', '/')
	if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) {
		return undefined
	}
	return relativePath
}

export function isBoundaryExemptModule(id: string): boolean {
	const normalizedId = id.replaceAll('\\', '/')
	const [path] = normalizedId.split(/[?#]/)
	if (
		path === undefined ||
		normalizedId.startsWith('\0') ||
		normalizedId.includes('virtual:') ||
		normalizedId === '@vite/client' ||
		normalizedId === '@vite/env' ||
		normalizedId.startsWith('/@id/') ||
		normalizedId.startsWith('/@vite/') ||
		normalizedId.startsWith('/__vite') ||
		normalizedId.startsWith('/__vitest') ||
		normalizedId.startsWith('@vitest/browser') ||
		normalizedId.includes('/@vitest/browser/')
	) {
		return true
	}
	let physicalId: string | undefined
	try {
		physicalId = physicalPath(id).replaceAll('\\', '/')
	} catch {
		physicalId = undefined
	}
	for (const candidate of physicalId === undefined ? [path] : [path, physicalId]) {
		if (candidate.split('/').some((segment) => segment.toLowerCase() === 'node_modules')) {
			return true
		}
	}
	return false
}

export function isWorkspaceBoundaryModule(id: string): boolean {
	if (isBoundaryExemptModule(id)) return false
	const normalizedId = id.replaceAll('\\', '/')
	const [path] = normalizedId.split(/[?#]/)
	if (path === undefined) return false
	let candidate = fileSystemPath(path)
	try {
		if (/^file:/i.test(candidate)) candidate = fileURLToPath(candidate)
	} catch {
		return false
	}
	const rootRelative = /^\/(?:app|src)\/(?:core|browser|server)\//.test(candidate)
	const absoluteCandidate = rootRelative
		? resolvePath(WORKSPACE_ROOT, candidate.slice(1))
		: isAbsolute(candidate)
			? candidate
			: resolvePath(WORKSPACE_ROOT, candidate)
	const relativeId = relative(WORKSPACE_ROOT, absoluteCandidate).replaceAll('\\', '/')
	return (
		relativeId !== '..' &&
		!relativeId.startsWith('../') &&
		!isAbsolute(relativeId) &&
		/^(?:app|src)\/(?:core|browser|server)\//.test(relativeId)
	)
}

export function isOutsideWorkspacePath(path: string): boolean {
	const [pathWithoutQuery] = path.split('?')
	if (pathWithoutQuery === undefined) return false
	return isAbsolute(fileSystemPath(pathWithoutQuery))
}

export function containedPath(root: string, target: string): boolean {
	const relativePath = relative(root, target)
	return (
		relativePath === '' ||
		(relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	)
}

export function packageNameOf(source: string): string | undefined {
	const [sourcePath] = source.replaceAll('\\', '/').split(/[?#]/)
	if (
		sourcePath === undefined ||
		sourcePath.length === 0 ||
		sourcePath.startsWith('.') ||
		sourcePath.startsWith('/') ||
		sourcePath.startsWith('#') ||
		sourcePath.startsWith('file:') ||
		/^[A-Za-z]:\//.test(sourcePath) ||
		isBuiltin(sourcePath)
	) {
		return undefined
	}
	const segments = sourcePath.split('/')
	if (sourcePath.startsWith('@')) {
		const [scope, name] = segments
		return scope === undefined || name === undefined ? undefined : `${scope}/${name}`
	}
	return segments[0]
}

export function readBoundedFile(path: string, limit: number): string | undefined {
	if (!existsSync(path)) return undefined
	try {
		const status = lstatSync(path)
		if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1 || status.size > limit) {
			return undefined
		}
		const handle = openSync(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW)
		try {
			const current = fstatSync(handle)
			if (
				!current.isFile() ||
				current.nlink !== 1 ||
				current.dev !== status.dev ||
				current.ino !== status.ino ||
				current.size !== status.size ||
				current.mtimeMs !== status.mtimeMs ||
				current.ctimeMs !== status.ctimeMs
			) {
				return undefined
			}
			const bytes = Buffer.allocUnsafe(current.size + 1)
			let offset = 0
			for (;;) {
				const count = readSync(handle, bytes, offset, bytes.length - offset, null)
				if (count === 0) break
				offset += count
				if (offset > current.size) return undefined
			}
			const final = fstatSync(handle)
			if (
				!final.isFile() ||
				final.nlink !== 1 ||
				final.dev !== current.dev ||
				final.ino !== current.ino ||
				final.size !== current.size ||
				final.size !== offset ||
				final.mtimeMs !== current.mtimeMs ||
				final.ctimeMs !== current.ctimeMs
			) {
				return undefined
			}
			return bytes.toString('utf8', 0, offset)
		} finally {
			closeSync(handle)
		}
	} catch {
		return undefined
	}
}

export function packageManifestName(directory: string): string | undefined {
	const content = readBoundedFile(resolvePath(directory, 'package.json'), PACKAGE_MANIFEST_BYTES)
	if (content === undefined) return undefined
	try {
		const manifest: unknown = JSON.parse(content)
		if (typeof manifest !== 'object' || manifest === null) return undefined
		const manifestName = Object.getOwnPropertyDescriptor(manifest, 'name')?.value
		return typeof manifestName === 'string' && packageNameOf(manifestName) === manifestName
			? manifestName
			: undefined
	} catch {
		return undefined
	}
}

export function isPackageBoundary(directory: string): boolean {
	const segments = directory.replaceAll('\\', '/').split('/')
	let nodeModules = -1
	for (const [index, segment] of segments.entries()) {
		if (segment.toLowerCase() === 'node_modules') nodeModules = index
	}
	if (nodeModules < 0) return false
	const packageSegments = segments.slice(nodeModules + 1)
	return (
		(packageSegments.length === 1 && packageSegments[0]?.startsWith('@') === false) ||
		(packageSegments.length === 2 &&
			packageSegments[0]?.startsWith('@') === true &&
			packageSegments[1]?.length !== 0)
	)
}

export function packageRootOf(packageName: string, resolvedPath: string): string | undefined {
	const physical = physicalPath(resolvedPath)
	let current =
		existsSync(physical) && lstatSync(physical).isDirectory() ? physical : dirname(physical)
	for (;;) {
		const boundary = isPackageBoundary(current)
		const manifest = resolvePath(current, 'package.json')
		if (boundary || existsSync(manifest)) {
			return packageManifestName(current) === packageName ? realpathSync.native(current) : undefined
		}
		const parent = dirname(current)
		if (parent === current) return undefined
		current = parent
	}
}

export function packageRootForResolved(resolvedPath: string): string | undefined {
	const physical = physicalPath(resolvedPath)
	let current =
		existsSync(physical) && lstatSync(physical).isDirectory() ? physical : dirname(physical)
	for (;;) {
		const boundary = isPackageBoundary(current)
		const manifest = resolvePath(current, 'package.json')
		if (boundary || existsSync(manifest)) {
			return packageManifestName(current) === undefined ? undefined : realpathSync.native(current)
		}
		const parent = dirname(current)
		if (parent === current) return undefined
		current = parent
	}
}

export function trustedPackageRootFor(
	target: string,
	trustedPackageRoots: ReadonlySet<string>,
): string | undefined {
	const physical = physicalPath(target)
	for (const root of trustedPackageRoots) {
		if (containedPath(root, physical)) return root
	}
	return undefined
}

export function isStylesheetPath(path: string): boolean {
	return /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:[?#]|$)/.test(path)
}

export function environmentPathError(owner: string, target: string): string | undefined {
	const targetApplication = target.startsWith('app/')
	const targetBrowser = target.startsWith('app/browser/') || target.startsWith('src/browser/')
	const targetServer = target.startsWith('app/server/') || target.startsWith('src/server/')
	const stylesheet = isStylesheetPath(target)
	if (owner.startsWith('src/') && targetApplication) {
		return 'Published modules cannot depend on private application modules'
	}
	if (owner.endsWith('/core') && (stylesheet || targetBrowser || targetServer)) {
		return 'Core modules must remain host-independent'
	}
	if (owner.endsWith('/browser') && targetServer) {
		return 'Browser modules cannot depend on Node or server-only modules'
	}
	if (owner.endsWith('/server') && (stylesheet || targetBrowser)) {
		return 'Server modules cannot depend on Vue or browser-only modules'
	}
	return undefined
}

export function environmentSourceError(owner: string, source: string): string | undefined {
	const normalizedSource = source.replaceAll('\\', '/')
	if (hasAsciiUrlControl(normalizedSource)) {
		return 'Environment module URLs cannot contain ASCII controls'
	}
	const [sourcePath] = normalizedSource.split(/[?#]/)
	const builtin = sourcePath !== undefined && isBuiltin(sourcePath)
	const unsupportedScheme =
		sourcePath !== undefined &&
		/^[A-Za-z][A-Za-z0-9+.-]*:/.test(sourcePath) &&
		!builtin &&
		!/^file:/i.test(sourcePath) &&
		!/^[A-Za-z]:\//.test(sourcePath)
	const browserPackage =
		/^(?:(?:vue|vite)(?:[/?#]|$)|@(?:vue|vitejs)\/|@(?:app|src)\/browser(?:[/?#]|$)|@orkestrel\/[^/]+\/browser(?:[/?#]|$))/.test(
			normalizedSource,
		)
	const serverPackage =
		/^(?:@(?:app|src)\/server(?:[/?#]|$)|@orkestrel\/[^/]+\/server(?:[/?#]|$))/.test(
			normalizedSource,
		)
	const stylesheet = isStylesheetPath(normalizedSource)
	if (unsupportedScheme) return 'Environment modules cannot import non-Node URL schemes'
	if (owner.startsWith('src/') && /^@app(?:[/?#]|$)/.test(normalizedSource)) {
		return 'Published modules cannot depend on private application modules'
	}
	if (owner.endsWith('/core') && (builtin || browserPackage || serverPackage || stylesheet)) {
		return 'Core modules must remain host-independent'
	}
	if (owner.endsWith('/browser') && (builtin || serverPackage)) {
		return 'Browser modules cannot depend on Node or server-only modules'
	}
	if (owner.endsWith('/server') && (browserPackage || stylesheet)) {
		return 'Server modules cannot depend on Vue or browser-only modules'
	}
	return undefined
}

export function enforceOutputPath(configured: string, expected: string): void {
	if (relative(expected, configured) !== '') {
		throw new Error(
			'[orkestrel-output-boundary] Build output must use its exact configured workspace directory',
		)
	}
	const workspaceRelative = relative(WORKSPACE_ROOT, expected)
	if (
		workspaceRelative === '..' ||
		workspaceRelative.startsWith(`..${sep}`) ||
		isAbsolute(workspaceRelative)
	) {
		throw new Error('[orkestrel-output-boundary] Build output must remain inside the workspace')
	}
	let current = WORKSPACE_ROOT
	for (const segment of workspaceRelative.split(sep)) {
		if (segment.length === 0) continue
		current = resolvePath(current, segment)
		if (!existsSync(current)) continue
		const status = lstatSync(current)
		if (status.isSymbolicLink() || !status.isDirectory()) {
			throw new Error(
				'[orkestrel-output-boundary] Build output and its existing parents must be real directories',
			)
		}
		if (workspacePath(realpathSync.native(current)) === undefined) {
			throw new Error('[orkestrel-output-boundary] Build output must remain inside the workspace')
		}
	}
}

export function outputBoundary(output: string): Plugin {
	const expected = resolvePath(WORKSPACE_ROOT, output)
	let configured = expected
	let build = false
	return {
		name: 'orkestrel-output-boundary',
		enforce: 'pre',
		configResolved(config) {
			if (config.publicDir !== '') {
				throw new Error(
					'[orkestrel-output-boundary] Public directories are disabled; every output must come from the audited graph',
				)
			}
			if (
				output.endsWith('/browser') &&
				config.build.lib === false &&
				config.build.assetsInlineLimit !== 0
			) {
				throw new Error(
					'[orkestrel-output-boundary] Browser assets must remain external for output auditing',
				)
			}
			const outputOptions = config.build.rolldownOptions.output
			const outputs = Array.isArray(outputOptions) ? outputOptions : [outputOptions]
			for (const options of outputs) {
				if (options?.dir !== undefined || options?.file !== undefined) {
					throw new Error(
						'[orkestrel-output-boundary] Rolldown output directories and files cannot override the configured output',
					)
				}
			}
			build = config.command === 'build'
			configured = resolvePath(config.root, config.build.outDir)
		},
		buildStart() {
			if (build) enforceOutputPath(configured, expected)
		},
	}
}

/**
 * Describes the compiler scope a face resolves to, as its declaration emit and its roll-up both
 * read it.
 */
export interface ProjectScope {
	readonly lib: readonly string[]
	readonly types: readonly string[]
	readonly root: string
}

/**
 * Describes the `overrideTsconfig` a declaration roll-up hands the extractor, and every option it
 * may read.
 */
export interface ExtractorOverride {
	readonly compilerOptions: {
		readonly types: readonly string[]
		readonly lib: readonly string[]
		readonly target: string
		readonly module: string
		readonly moduleResolution: string
		readonly skipLibCheck: boolean
		readonly strict: boolean
	}
	readonly files: readonly string[]
}

/**
 * Lists the extractor exports a declaration roll-up dereferences, named as that package publishes
 * them.
 */
export interface ExtractorModule {
	readonly Extractor: { readonly invoke: (config: unknown, options: unknown) => unknown }
	readonly ExtractorConfig: { readonly prepare: (options: unknown) => unknown }
}

/**
 * Configures one published face's declaration roll-up.
 *
 * @remarks
 * `project` is the absolute path of that face's TypeScript project file. `types` overrides the
 * `types` the extractor's own program reads, and defaults to the face's resolved `types`. `rewrite`
 * receives the finished roll-up and returns what the face ships; a face that omits it ships the
 * roll-up as the extractor wrote it.
 */
export interface DeclarationRollupOptions {
	readonly project: string
	readonly types?: readonly string[]
	readonly rewrite?: (content: string) => string
}

/**
 * Checks whether a value is a list of strings.
 *
 * @param value - The value to check.
 * @returns True if the value is an array whose every member is a string; false otherwise.
 */
export function isStringList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

/**
 * Checks whether a value exposes the extractor entry a declaration roll-up calls.
 *
 * @param value - The loaded extractor module.
 * @returns True if the value carries the `Extractor.invoke` and `ExtractorConfig.prepare` entry
 * points; false otherwise.
 *
 * @remarks
 * The guard reads each member through `Reflect.get`. A loader can hand back a module object whose
 * members are reachable only through its prototype, so an own-descriptor read misses them and
 * refuses a module that carries `Extractor.invoke` and `ExtractorConfig.prepare`.
 */
export function isExtractorModule(value: unknown): value is ExtractorModule {
	if (typeof value !== 'object' || value === null) return false
	const extractor: unknown = Reflect.get(value, 'Extractor')
	const configuration: unknown = Reflect.get(value, 'ExtractorConfig')
	if (typeof extractor !== 'function' || typeof configuration !== 'function') return false
	return (
		typeof Reflect.get(extractor, 'invoke') === 'function' &&
		typeof Reflect.get(configuration, 'prepare') === 'function'
	)
}

/**
 * Returns the standard output of the workspace TypeScript compiler run as a process.
 *
 * @param compiler - The absolute path of the compiler's JavaScript entry.
 * @param args - The compiler arguments that follow that entry.
 * @returns The compiler's standard output.
 * @throws An error carrying the compiler's own output when it fails or exits non-zero.
 */
export function readCompilerOutput(compiler: string, args: readonly string[]): string {
	const result = spawnSync(process.execPath, [compiler, ...args], {
		cwd: WORKSPACE_ROOT,
		encoding: 'utf8',
	})
	if (result.error !== undefined || result.status !== 0) {
		throw new Error(
			`[orkestrel-declaration-rollup] The declaration compiler failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
		)
	}
	return result.stdout ?? ''
}

/**
 * Parses a `tsc --showConfig` reading into the compiler scope a face's roll-up requires.
 *
 * @param text - The compiler's `--showConfig` output.
 * @param project - The absolute path of the project file that produced that output.
 * @returns That scope with `root` resolved against the project file, or `undefined` when the
 * project resolves no `lib`, no `types`, or no `rootDir`.
 */
export function parseProjectScope(text: string, project: string): ProjectScope | undefined {
	try {
		const parsed: unknown = JSON.parse(text)
		if (typeof parsed !== 'object' || parsed === null) return undefined
		const options: unknown = Object.getOwnPropertyDescriptor(parsed, 'compilerOptions')?.value
		if (typeof options !== 'object' || options === null) return undefined
		const lib: unknown = Object.getOwnPropertyDescriptor(options, 'lib')?.value
		const types: unknown = Object.getOwnPropertyDescriptor(options, 'types')?.value
		const root: unknown = Object.getOwnPropertyDescriptor(options, 'rootDir')?.value
		if (!isStringList(lib) || !isStringList(types) || typeof root !== 'string') return undefined
		return { lib, types, root: resolvePath(dirname(project), root) }
	} catch {
		return undefined
	}
}

/**
 * Builds the `overrideTsconfig` the extractor analyses one emitted face entry under.
 *
 * @param entry - The absolute path of the emitted declaration entry.
 * @param lib - The face's own resolved `lib`.
 * @param types - The `types` the extractor's program reads.
 * @returns That override.
 *
 * @remarks
 * The extractor runs its own bundled compiler engine, so the override carries the face's resolved
 * `lib` and `types` and nothing else the face resolved. Passing the face's full options, a `paths`
 * table, or a `typescriptCompilerFolder` leaves that engine unable to follow a symbol.
 */
export function buildExtractorOverride(
	entry: string,
	lib: readonly string[],
	types: readonly string[],
): ExtractorOverride {
	return {
		compilerOptions: {
			types,
			lib,
			target: 'ESNext',
			module: 'ESNext',
			moduleResolution: 'bundler',
			skipLibCheck: true,
			strict: true,
		},
		files: [entry],
	}
}

/**
 * Rewrites every core specifier in a roll-up to the workspace package's published name.
 *
 * @param content - The finished roll-up.
 * @returns That roll-up with each core specifier replaced.
 * @throws An error when the workspace manifest names no package.
 *
 * @remarks
 * A browser or server face reaches core through an `@src/core` alias or a relative core path, and
 * the extractor keeps either external and writes it through unchanged. Neither spelling exists in
 * the published tarball, so both become the package's own root export. A core face passes no
 * `rewrite` at all, because that face's declarations quote both spellings as documentation.
 */
export function rewriteCoreSpecifier(content: string): string {
	const name = packageManifestName(WORKSPACE_ROOT)
	if (name === undefined) {
		throw new Error('[orkestrel-declaration-rollup] The workspace manifest names no package')
	}
	return content.replaceAll(/(?:\.\.\/)+core\/index\.[jt]s/g, name).replaceAll('@src/core', name)
}

/**
 * Rolls one published face's declarations into the single file that face ships.
 *
 * @param options - The face's roll-up options.
 * @returns The Vite plugin that performs that roll-up.
 *
 * @remarks
 * At `closeBundle`, after Vite has written every format of the face, the plugin emits the face's
 * declarations with the workspace compiler run as a process into a scratch directory made fresh
 * under the host temporary directory, hands the emitted entry to the extractor's own engine,
 * applies `rewrite`, and removes the scratch directory. Keeping the scratch outside the face's own
 * output means its unconditional removal can never take a sibling the face already published, such
 * as its own `declarations` folder. The extractor is a publishing workspace's development
 * dependency, so this vendored leaf defers loading it to that hook: a workspace that publishes no
 * library installs no extractor, never reaches the hook, and never resolves the package at build
 * or at check.
 */
export function declarationRollup(options: DeclarationRollupOptions): Plugin {
	let output = WORKSPACE_ROOT
	let source = ''
	let build = false
	return {
		name: 'orkestrel-declaration-rollup',
		configResolved(config) {
			build = config.command === 'build'
			output = resolvePath(config.root, config.build.outDir)
			source =
				config.build.lib !== false && typeof config.build.lib.entry === 'string'
					? config.build.lib.entry
					: ''
		},
		closeBundle() {
			if (!build) return
			const declaration = source.replace(/\.tsx?$/, '.d.ts')
			if (declaration === source) {
				throw new Error(
					'[orkestrel-declaration-rollup] The face must build one TypeScript library entry',
				)
			}
			const load = createRequire(import.meta.url)
			const compiler = load.resolve('typescript/bin/tsc')
			const scope = parseProjectScope(
				readCompilerOutput(compiler, ['--showConfig', '-p', options.project]),
				options.project,
			)
			if (scope === undefined) {
				throw new Error(
					'[orkestrel-declaration-rollup] The face project must resolve its lib, types, and root',
				)
			}
			const scratch = mkdtempSync(join(tmpdir(), 'orkestrel-declarations-'))
			const rollup = resolvePath(output, 'index.d.ts')
			try {
				readCompilerOutput(compiler, [
					'-p',
					options.project,
					'--declaration',
					'--emitDeclarationOnly',
					'--noEmit',
					'false',
					'--outDir',
					scratch,
				])
				const entry = resolvePath(scratch, relative(scope.root, declaration))
				// A literal `import()` of the extractor reddens `tsc` in a workspace that does not
				// install it, and a variable specifier reddens `import/no-dynamic-require`, so the
				// literal `createRequire` call is the form that clears every gate in an app-only
				// workspace.
				const loaded: unknown = load('@microsoft/api-extractor')
				if (!isExtractorModule(loaded)) {
					throw new Error(
						'[orkestrel-declaration-rollup] The declaration extractor exposes no entry point',
					)
				}
				const prepared: unknown = loaded.ExtractorConfig.prepare({
					configObject: {
						projectFolder: WORKSPACE_ROOT,
						mainEntryPointFilePath: entry,
						bundledPackages: [],
						compiler: {
							overrideTsconfig: buildExtractorOverride(
								entry,
								scope.lib,
								options.types ?? scope.types,
							),
						},
						apiReport: { enabled: false },
						docModel: { enabled: false },
						tsdocMetadata: { enabled: false },
						dtsRollup: { enabled: true, untrimmedFilePath: rollup },
						messages: {
							compilerMessageReporting: { default: { logLevel: 'none' } },
							extractorMessageReporting: { default: { logLevel: 'none' } },
							tsdocMessageReporting: { default: { logLevel: 'none' } },
						},
					},
					configObjectFullPath: resolvePath(WORKSPACE_ROOT, 'api-extractor.json'),
					packageJsonFullPath: resolvePath(WORKSPACE_ROOT, 'package.json'),
				})
				const outcome: unknown = loaded.Extractor.invoke(prepared, {
					localBuild: true,
					showVerboseMessages: false,
					showDiagnostics: false,
				})
				const succeeded: unknown =
					typeof outcome === 'object' && outcome !== null
						? Reflect.get(outcome, 'succeeded')
						: undefined
				if (succeeded !== true) {
					throw new Error('[orkestrel-declaration-rollup] The declaration roll-up failed')
				}
				if (options.rewrite !== undefined) {
					writeFileSync(rollup, options.rewrite(readFileSync(rollup, 'utf8')), 'utf8')
				}
			} finally {
				rmSync(scratch, { recursive: true, force: true })
			}
		},
	}
}

export function decodeAssetSource(source: string): string | undefined {
	try {
		return decodeURI(source)
	} catch {
		return undefined
	}
}

export async function environmentAssetSources(
	code: string,
	id: string,
	emitted = false,
): Promise<readonly string[]> {
	const [path] = id.split('?')
	if (
		path === undefined ||
		(!/\.[cm]?[jt]sx?$/.test(path) && !/[?&]html-proxy(?:[=&]|$)/.test(id))
	) {
		return []
	}
	const sources: string[] = []
	const transformed = await transformWithOxc(code, path)
	const visitor = new Visitor({
		ImportExpression(node) {
			if (emitted) return
			let value: string | undefined
			if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
				value = node.source.value
			} else if (node.source.type === 'TemplateLiteral' && node.source.expressions.length === 0) {
				value = node.source.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('')
			} else {
				throw new Error(
					'[orkestrel-environment-boundary] Dynamic imports must use static string values',
				)
			}
			const decoded = decodeAssetSource(value)
			if (decoded === undefined) {
				throw new Error('[orkestrel-environment-boundary] Module URLs must use valid URI encoding')
			}
			sources.push(decoded)
		},
		NewExpression(node) {
			if (emitted) return
			const [source, base] = node.arguments
			if (
				node.callee.type !== 'Identifier' ||
				node.callee.name !== 'URL' ||
				base?.type !== 'MemberExpression' ||
				base.object.type !== 'MetaProperty' ||
				base.object.meta.name !== 'import' ||
				base.object.property.name !== 'meta' ||
				base.property.type !== 'Identifier' ||
				base.property.name !== 'url'
			) {
				return
			}
			let value: string | undefined
			if (source?.type === 'Literal' && typeof source.value === 'string') {
				const decoded = decodeAssetSource(source.value)
				if (decoded === undefined) {
					throw new Error('[orkestrel-environment-boundary] Asset URLs must use valid URI encoding')
				}
				value = decoded
			} else if (source?.type === 'TemplateLiteral') {
				const decodedQuasis: string[] = []
				for (const quasi of source.quasis) {
					const decoded = decodeAssetSource(quasi.value.cooked ?? quasi.value.raw)
					if (decoded === undefined) {
						throw new Error(
							'[orkestrel-environment-boundary] Asset URLs must use valid URI encoding',
						)
					}
					decodedQuasis.push(decoded)
				}
				if (source.expressions.length > 0) {
					throw new Error(
						'[orkestrel-environment-boundary] Asset URLs must use static string values',
					)
				}
				value = decodedQuasis.join('__orkestrel__')
			} else {
				throw new Error('[orkestrel-environment-boundary] Asset URLs must use static string values')
			}
			if (value === undefined) return
			if (
				value.startsWith('.') ||
				value.startsWith('/') ||
				/^file:/i.test(value) ||
				/^[A-Za-z]:[\\/]/.test(value)
			) {
				sources.push(value)
			}
		},
	})
	visitor.visit(parseSync(path, transformed.code).program)
	return sources
}

export function environmentBoundary(
	owner: 'src/core' | 'src/browser' | 'src/server' | 'app/core' | 'app/browser' | 'app/server',
): Plugin {
	const trustedPackageRoots = new Set<string>()
	let environmentRoot = WORKSPACE_ROOT
	return {
		name: 'orkestrel-environment-boundary',
		enforce: 'pre',
		configResolved(config) {
			environmentRoot = physicalPath(config.root)
		},
		async resolveId(source, importer) {
			if (importer === undefined || !isWorkspaceBoundaryModule(importer)) return null
			if (isBoundaryExemptModule(source)) return null
			const normalizedSource = source.replaceAll('\\', '/')
			const sourceError = environmentSourceError(owner, normalizedSource)
			if (sourceError !== undefined) this.error(sourceError)
			const importerPath = workspacePath(importer)
			const physicalImporter = physicalPath(importer)
			const importerPackageRoot = trustedPackageRootFor(physicalImporter, trustedPackageRoots)
			if (importerPath === undefined && importerPackageRoot === undefined) return null
			const [layer, environment] = importerPath?.split('/') ?? []
			if (
				importerPackageRoot === undefined &&
				((layer !== 'app' && layer !== 'src') ||
					(environment !== 'core' && environment !== 'browser' && environment !== 'server'))
			) {
				return null
			}
			const pathLike =
				normalizedSource.startsWith('.') ||
				normalizedSource.startsWith('/') ||
				/^file:/i.test(normalizedSource) ||
				/^[A-Za-z]:[\\/]/.test(normalizedSource)
			const fallbackSource =
				normalizedSource.startsWith('.') ||
				normalizedSource.startsWith('/') ||
				/^file:/i.test(normalizedSource)
					? sourceFallback(physicalImporter, normalizedSource)
					: ''
			const resolution = await this.resolve(source, importer, { skipSelf: true })
			const [resolvedId] = resolution?.id.split('?') ?? []
			const physicalResolution = resolvedId === undefined ? undefined : physicalPath(resolvedId)
			if (
				importerPackageRoot !== undefined &&
				(pathLike || normalizedSource.startsWith('#')) &&
				physicalResolution !== undefined &&
				!containedPath(importerPackageRoot, physicalResolution)
			) {
				if (normalizedSource.startsWith('#')) {
					const mappedPackageRoot =
						workspacePath(physicalResolution) === undefined
							? packageRootForResolved(physicalResolution)
							: undefined
					if (mappedPackageRoot === undefined) {
						return this.error(
							'Dependency package imports must resolve inside an exact physical package root',
						)
					}
					trustedPackageRoots.add(mappedPackageRoot)
				} else {
					this.error('Dependency modules cannot import files outside their physical package root')
				}
			}
			if (
				!pathLike &&
				!normalizedSource.startsWith('#') &&
				physicalResolution !== undefined &&
				workspacePath(physicalResolution) === undefined
			) {
				const packageName = packageNameOf(normalizedSource)
				const packageRoot =
					packageName === undefined ? undefined : packageRootOf(packageName, physicalResolution)
				if (packageRoot === undefined || !containedPath(packageRoot, physicalResolution)) {
					return this.error('Resolved dependencies must remain inside their physical package root')
				}
				trustedPackageRoots.add(packageRoot)
			}
			const resolvedSource = workspacePath(resolution?.id ?? fallbackSource)
			if (pathLike && resolvedSource === undefined && importerPackageRoot === undefined) {
				this.error('Environment modules cannot import files outside the workspace')
			}
			const pathError =
				resolvedSource === undefined
					? undefined
					: environmentPathError(`${layer}/${environment}`, resolvedSource)
			if (pathError !== undefined) this.error(pathError)
			return null
		},
		async load(id) {
			if (!isWorkspaceBoundaryModule(id)) return null
			const physicalImporter = physicalPath(id)
			const trustedPackageRoot = trustedPackageRootFor(physicalImporter, trustedPackageRoots)
			const inferredPackageRoot =
				trustedPackageRoot === undefined ? packageRootForResolved(physicalImporter) : undefined
			const packageRoot =
				trustedPackageRoot ??
				(inferredPackageRoot !== undefined && isPackageBoundary(inferredPackageRoot)
					? inferredPackageRoot
					: undefined)
			if (packageRoot === undefined || !/\.[cm]?[jt]sx?$/.test(physicalImporter)) {
				return null
			}
			const code = readBoundedFile(physicalImporter, ENVIRONMENT_MODULE_BYTES)
			if (code === undefined) {
				return this.error('Dependency module source must be a bounded regular file')
			}
			for (const source of await environmentAssetSources(code, id)) {
				const normalizedSource = source.replaceAll('\\', '/')
				const sourceError = environmentSourceError(owner, normalizedSource)
				if (sourceError !== undefined) this.error(sourceError)
				const sourcePathError = environmentPathError(owner, normalizedSource)
				if (sourcePathError !== undefined) this.error(sourcePathError)
				const pathLike =
					normalizedSource.startsWith('.') ||
					normalizedSource.startsWith('/') ||
					/^file:/i.test(normalizedSource) ||
					/^[A-Za-z]:[\\/]/.test(normalizedSource)
				if (
					pathLike &&
					!containedPath(
						packageRoot,
						physicalPath(sourceFallback(physicalImporter, normalizedSource)),
					)
				) {
					this.error('Dependency modules cannot import files outside their physical package root')
				}
			}
			return null
		},
		async generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if (output.type === 'chunk') {
					for (const source of await environmentAssetSources(
						output.code,
						output.fileName.endsWith('.js') ? output.fileName : `${output.fileName}.js`,
						true,
					)) {
						const normalizedSource = source.replaceAll('\\', '/')
						const sourceError = environmentSourceError(owner, normalizedSource)
						if (sourceError !== undefined) this.error(sourceError)
					}
					continue
				}
				for (const original of output.originalFileNames) {
					const physical = physicalPath(
						isAbsolute(original) ? original : resolvePath(environmentRoot, original),
					)
					if (isBoundaryExemptModule(original) || isBoundaryExemptModule(physical)) continue
					const target = workspacePath(physical)
					if (target === undefined) {
						if (trustedPackageRootFor(physical, trustedPackageRoots) === undefined) {
							this.error('Environment modules cannot import files outside the workspace')
						}
						continue
					}
					const pathError = environmentPathError(owner, target)
					if (pathError !== undefined) this.error(pathError)
				}
			}
		},
		buildEnd(error) {
			if (error !== undefined) return
			for (const id of this.getModuleIds()) {
				if (!isWorkspaceBoundaryModule(id)) continue
				const target = workspacePath(id)
				if (target === undefined) {
					if (
						isOutsideWorkspacePath(id) &&
						trustedPackageRootFor(physicalPath(id), trustedPackageRoots) === undefined
					) {
						this.error('Environment modules cannot import files outside the workspace')
					}
					continue
				}
				const pathError = environmentPathError(owner, target)
				if (pathError !== undefined) this.error(pathError)
			}
		},
		transform: {
			order: 'pre',
			async handler(code, id) {
				if (!isWorkspaceBoundaryModule(id)) return null
				const target = workspacePath(id)
				const physicalImporter = physicalPath(id)
				const importerPackageRoot = trustedPackageRootFor(physicalImporter, trustedPackageRoots)
				if (target === undefined) {
					if (isOutsideWorkspacePath(id) && importerPackageRoot === undefined) {
						this.error('Environment modules cannot import files outside the workspace')
					}
				} else {
					const pathError = environmentPathError(owner, target)
					if (pathError !== undefined) this.error(pathError)
				}
				const environmentModule =
					target !== undefined && /^(?:app|src)\/(?:core|browser|server)\//.test(target)
				if (!environmentModule && importerPackageRoot === undefined) return null
				for (const source of await environmentAssetSources(code, id)) {
					const normalizedSource = source.replaceAll('\\', '/')
					const sourceError = environmentSourceError(owner, normalizedSource)
					if (sourceError !== undefined) this.error(sourceError)
					const [sourcePath] = normalizedSource.split(/[?#]/)
					if (sourcePath !== undefined && isBuiltin(sourcePath)) continue
					const resolution = await this.resolve(normalizedSource, id, { skipSelf: true })
					const fallbackSource = sourceFallback(physicalImporter, normalizedSource)
					const physicalSource = physicalPath(resolution?.id ?? fallbackSource)
					if (importerPackageRoot !== undefined) {
						const pathLike =
							normalizedSource.startsWith('.') ||
							normalizedSource.startsWith('/') ||
							/^file:/i.test(normalizedSource) ||
							/^[A-Za-z]:[\\/]/.test(normalizedSource)
						if (pathLike && !containedPath(importerPackageRoot, physicalSource)) {
							this.error(
								'Dependency modules cannot import files outside their physical package root',
							)
						}
						if (!pathLike && !containedPath(importerPackageRoot, physicalSource)) {
							const packageName = packageNameOf(normalizedSource)
							const packageRoot = normalizedSource.startsWith('#')
								? workspacePath(physicalSource) === undefined
									? packageRootForResolved(physicalSource)
									: undefined
								: packageName === undefined
									? undefined
									: packageRootOf(packageName, physicalSource)
							if (packageRoot === undefined || !containedPath(packageRoot, physicalSource)) {
								return this.error(
									'Resolved dependencies must remain inside their physical package root',
								)
							}
							trustedPackageRoots.add(packageRoot)
						}
						continue
					}
					const resolvedSource = workspacePath(physicalSource)
					if (resolvedSource === undefined) {
						return this.error('Environment modules cannot import files outside the workspace')
					}
					const assetError = environmentPathError(owner, resolvedSource)
					if (assetError !== undefined) this.error(assetError)
				}
				return null
			},
		},
	}
}
