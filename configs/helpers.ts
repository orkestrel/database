import type { Plugin, Rolldown } from 'vite'
import { parseSync, transformWithOxc, Visitor } from 'vite'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import {
	closeSync,
	constants as FS_CONSTANTS,
	existsSync,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'

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
