import { globSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as ts from 'typescript'

/** Centralized source modules whose top-level declarations must all be exported. */
export const CENTRAL_SOURCE_FILES: readonly string[] = Object.freeze([
	'combinators.ts',
	'cloners.ts',
	'compilers.ts',
	'constants.ts',
	'contracts.ts',
	'errors.ts',
	'factories.ts',
	'helpers.ts',
	'handlers.ts',
	'inferers.ts',
	'middlewares.ts',
	'parsers.ts',
	'relations.ts',
	'schemas.ts',
	'seeders.ts',
	'shapers.ts',
	'templates.ts',
	'types.ts',
	'validators.ts',
])

/** Centralized files that own module-scope function declarations. */
export const FUNCTION_SOURCE_FILES: readonly string[] = Object.freeze([
	'combinators.ts',
	'cloners.ts',
	'compilers.ts',
	'errors.ts',
	'factories.ts',
	'handlers.ts',
	'helpers.ts',
	'inferers.ts',
	'middlewares.ts',
	'parsers.ts',
	'relations.ts',
	'schemas.ts',
	'seeders.ts',
	'shapers.ts',
	'validators.ts',
])

/** Centralized files that own module-scope data declarations. */
export const DATA_SOURCE_FILES: readonly string[] = Object.freeze([
	'combinators.ts',
	'constants.ts',
	'contracts.ts',
	'relations.ts',
	'schemas.ts',
	'shapers.ts',
	'templates.ts',
	'validators.ts',
])

/** Worker-only value globals that WebWorker typing must not expose to core implementations. */
export const WORKER_SCOPE_VALUE_GLOBALS: readonly string[] = Object.freeze([
	'name',
	'onrtctransform',
	'close',
	'postMessage',
	'dispatchEvent',
	'location',
	'onerror',
	'onlanguagechange',
	'onoffline',
	'ononline',
	'onrejectionhandled',
	'onunhandledrejection',
	'self',
	'importScripts',
	'fonts',
	'caches',
	'crossOriginIsolated',
	'indexedDB',
	'isSecureContext',
	'origin',
	'scheduler',
	'createImageBitmap',
	'reportError',
	'cancelAnimationFrame',
	'requestAnimationFrame',
	'onmessage',
	'onmessageerror',
	'addEventListener',
	'removeEventListener',
])

/** Virtual source text used while binding one policy-inspected module. */
export const POLICY_SOURCE_TEXTS: Map<string, string> = new Map()

/** One script block extracted from a Vue SFC by the official compiler. */
export interface VueScriptBlockInterface {
	readonly content: string
	readonly lang?: string
}

/** An injected official Vue SFC script-block extractor. */
export interface VueScriptExtractorInterface {
	(path: string, content: string): readonly VueScriptBlockInterface[]
}

/** Normalize platform separators and duplicate glob segments for stable diagnostics. */
export function normalizePolicyPath(path: string): string {
	return path.replaceAll('\\', '/').replace(/\/+/gu, '/')
}

/** Whether a declaration carries an explicit export modifier. */
export function hasExportModifier(node: ts.Node): boolean {
	return (
		ts.canHaveModifiers(node) &&
		ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
			true
	)
}

/** Whether a declaration carries a specified modifier. */
export function hasModifier(node: ts.Node, modifier: ts.SyntaxKind): boolean {
	return (
		ts.canHaveModifiers(node) &&
		ts.getModifiers(node)?.some((candidate) => candidate.kind === modifier) === true
	)
}

/** Whether a module specifier uses a URL scheme other than Node's builtin namespace. */
export function isUnsupportedModuleSpecifier(specifier: string): boolean {
	return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(specifier) && !specifier.startsWith('node:')
}

/** Whether an arrow/function expression is an anonymous callback passed directly as an argument. */
export function isDirectCallback(node: ts.ArrowFunction | ts.FunctionExpression): boolean {
	const parent = node.parent
	return (
		(ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
		parent.arguments?.some((argument) => argument === node) === true
	)
}

/**
 * Whether an arrow/function expression is returned directly as a factory or combinator result.
 *
 * @param node - The function expression to inspect
 * @returns `true` when the node is a direct return value, including one parenthesized layer
 */
export function isDirectReturn(node: ts.ArrowFunction | ts.FunctionExpression): boolean {
	const parent = node.parent
	if (ts.isReturnStatement(parent)) return true
	if (ts.isArrowFunction(parent) && parent.body === node) return true
	if (!ts.isParenthesizedExpression(parent)) return false
	const container = parent.parent
	return (
		ts.isReturnStatement(container) || (ts.isArrowFunction(container) && container.body === parent)
	)
}

/** Whether a function expression is assigned by one module-scope variable declaration. */
export function isModuleFunction(node: ts.ArrowFunction | ts.FunctionExpression): boolean {
	const declaration = node.parent
	const list = declaration.parent
	const statement = list.parent
	return (
		ts.isVariableDeclaration(declaration) &&
		ts.isVariableDeclarationList(list) &&
		ts.isVariableStatement(statement) &&
		ts.isSourceFile(statement.parent)
	)
}

/**
 * Format a syntax node's source position as a one-based line and character.
 *
 * @param node - The syntax node whose starting position to format
 * @returns The node's one-based `line:character` position
 */
export function formatPolicyPosition(node: ts.Node): string {
	const source = node.getSourceFile()
	const position = source.getLineAndCharacterOfPosition(node.getStart())
	return `${String(position.line + 1)}:${String(position.character + 1)}`
}

/** Whether a property signature belongs to a centralized interface or type alias contract. */
export function isContractProperty(node: ts.PropertySignature): boolean {
	let parent: ts.Node = node.parent
	while (ts.isTypeLiteralNode(parent)) parent = parent.parent
	return ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)
}

/** Whether the sole production triple-slash reference is the generated browser Vite contract. */
export function hasAllowedTripleSlashReference(path: string, source: ts.SourceFile): boolean {
	return (
		path.replaceAll('\\', '/') === 'app/browser/env.d.ts' &&
		source.referencedFiles.length === 0 &&
		source.libReferenceDirectives.length === 0 &&
		source.typeReferenceDirectives.length === 1 &&
		source.typeReferenceDirectives[0]?.fileName === 'vite/client'
	)
}

/**
 * Whether the policy compiler can read one source path.
 *
 * @param path - The source path to inspect
 * @returns `true` when the virtual or physical source exists
 */
export function hasPolicySource(path: string): boolean {
	return POLICY_SOURCE_TEXTS.has(path) || ts.sys.fileExists(path)
}

/**
 * Read one virtual or physical policy source.
 *
 * @param path - The source path to read
 * @returns The source text when present
 */
export function readPolicySource(path: string): string | undefined {
	return POLICY_SOURCE_TEXTS.get(path) ?? ts.sys.readFile(path)
}

/**
 * Parse one virtual or physical policy source for the compiler host.
 *
 * @param path - The source path to parse
 * @param language - The requested TypeScript language target
 * @returns The parsed source file when present
 */
export function createPolicySource(
	path: string,
	language: ts.ScriptTarget | ts.CreateSourceFileOptions,
): ts.SourceFile | undefined {
	const content = readPolicySource(path)
	return content === undefined ? undefined : ts.createSourceFile(path, content, language, true)
}

/**
 * Bind one policy-inspected module without loading ambient host declarations.
 *
 * @param path - The source path used in diagnostics
 * @param content - The TypeScript source text to bind
 * @returns A one-file TypeScript program whose checker resolves lexical bindings
 */
export function createPolicyProgram(path: string, content: string): ts.Program {
	const options: ts.CompilerOptions = {
		allowJs: true,
		noLib: true,
		noResolve: true,
		target: ts.ScriptTarget.Latest,
		types: [],
	}
	POLICY_SOURCE_TEXTS.set(path, content)
	const host = ts.createCompilerHost(options)
	host.fileExists = hasPolicySource
	host.readFile = readPolicySource
	host.getSourceFile = createPolicySource
	const program = ts.createProgram([path], options, host)
	POLICY_SOURCE_TEXTS.delete(path)
	return program
}

/**
 * Whether an identifier is a standalone runtime value reference.
 *
 * @param node - The identifier occurrence to classify
 * @param checker - The binder used to distinguish lexical values from ambient globals
 * @returns `true` only when the occurrence reads or writes a runtime value
 */
export function isValueReferenceIdentifier(node: ts.Identifier, checker: ts.TypeChecker): boolean {
	if (ts.isPartOfTypeNode(node)) return false

	let ancestor: ts.Node = node.parent
	while (!ts.isSourceFile(ancestor) && !ts.isStatement(ancestor)) {
		if (ts.isTypeQueryNode(ancestor)) return false
		if (ts.isComputedPropertyName(ancestor) && ts.isTypeElement(ancestor.parent)) return false
		ancestor = ancestor.parent
	}

	const parent = node.parent
	if (
		(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
		(ts.isPropertyAssignment(parent) && parent.name === node) ||
		(ts.isPropertyDeclaration(parent) && parent.name === node) ||
		(ts.isPropertySignature(parent) && parent.name === node) ||
		(ts.isMethodDeclaration(parent) && parent.name === node) ||
		(ts.isMethodSignature(parent) && parent.name === node) ||
		(ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
		(ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
		(ts.isVariableDeclaration(parent) && parent.name === node) ||
		(ts.isParameter(parent) && parent.name === node) ||
		(ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
		(ts.isFunctionDeclaration(parent) && parent.name === node) ||
		(ts.isFunctionExpression(parent) && parent.name === node) ||
		(ts.isClassDeclaration(parent) && parent.name === node) ||
		(ts.isClassExpression(parent) && parent.name === node) ||
		(ts.isInterfaceDeclaration(parent) && parent.name === node) ||
		(ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
		(ts.isTypeParameterDeclaration(parent) && parent.name === node) ||
		(ts.isEnumDeclaration(parent) && parent.name === node) ||
		(ts.isEnumMember(parent) && parent.name === node) ||
		(ts.isModuleDeclaration(parent) && parent.name === node) ||
		ts.isImportClause(parent) ||
		ts.isImportSpecifier(parent) ||
		ts.isNamespaceImport(parent) ||
		ts.isImportEqualsDeclaration(parent) ||
		ts.isExportSpecifier(parent) ||
		ts.isNamespaceExport(parent) ||
		ts.isNamespaceExportDeclaration(parent) ||
		(ts.isLabeledStatement(parent) && parent.label === node) ||
		(ts.isBreakOrContinueStatement(parent) && parent.label === node) ||
		(ts.isJsxAttribute(parent) && parent.name === node)
	) {
		return false
	}
	return (
		(ts.isShorthandPropertyAssignment(parent)
			? checker.getShorthandAssignmentValueSymbol(parent)
			: checker.getSymbolAtLocation(node)) === undefined
	)
}

/** Inspect a Vue single-file component for syntax that can bypass declared import policy. */
export function inspectVueCodingLaw(
	path: string,
	scripts: readonly VueScriptBlockInterface[] = [],
): readonly string[] {
	const violations: string[] = []
	for (const [index, script] of scripts.entries()) {
		if (
			script.lang !== 'ts' &&
			script.lang !== 'tsx' &&
			script.lang !== 'mts' &&
			script.lang !== 'cts'
		) {
			violations.push(`${path}.script-${String(index)} requires a TypeScript script language`)
		}
		const extension =
			script.lang === 'tsx' || script.lang === 'mts' || script.lang === 'cts' ? script.lang : 'ts'
		violations.push(
			...inspectCodingLaw(`${path}.script-${String(index)}.${extension}`, script.content),
		)
	}
	return violations
}

/** Add syntax-wide coding-law violations while traversing one source tree. */
export function inspectCodingNode(
	path: string,
	node: ts.Node,
	violations: string[],
	checker: ts.TypeChecker,
): void {
	if (
		/^(?:app|src)[\\/]core[\\/]/u.test(path) &&
		ts.isIdentifier(node) &&
		WORKER_SCOPE_VALUE_GLOBALS.includes(node.text) &&
		isValueReferenceIdentifier(node, checker)
	) {
		violations.push(
			`${path}:${formatPolicyPosition(node)} forbids worker-scope global ${node.text} in core`,
		)
	}
	if (
		ts.isAsExpression(node) ||
		ts.isTypeAssertionExpression(node) ||
		ts.isNonNullExpression(node)
	) {
		violations.push(`${path}:${formatPolicyPosition(node)} forbids type/non-null assertions`)
	}
	if (node.kind === ts.SyntaxKind.AnyKeyword) {
		violations.push(`${path}:${formatPolicyPosition(node)} forbids any`)
	}
	if (
		(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
		node.moduleSpecifier !== undefined &&
		ts.isStringLiteral(node.moduleSpecifier) &&
		isUnsupportedModuleSpecifier(node.moduleSpecifier.text)
	) {
		violations.push(`${path}:${formatPolicyPosition(node)} forbids non-Node URL module specifiers`)
	}
	if (
		ts.isPropertySignature(node) &&
		isContractProperty(node) &&
		!hasModifier(node, ts.SyntaxKind.ReadonlyKeyword)
	) {
		violations.push(`${path}:${formatPolicyPosition(node)} requires readonly contract properties`)
	}
	if (
		ts.isCallExpression(node) &&
		node.expression.kind === ts.SyntaxKind.ImportKeyword &&
		(node.arguments.length !== 1 || !node.arguments.every(ts.isStringLiteral))
	) {
		violations.push(
			`${path}:${formatPolicyPosition(node)} requires dynamic imports to use string literals so import policy remains enforceable`,
		)
	}
	if (
		ts.isCallExpression(node) &&
		node.expression.kind === ts.SyntaxKind.ImportKeyword &&
		node.arguments.length === 1 &&
		node.arguments.every(ts.isStringLiteral) &&
		isUnsupportedModuleSpecifier(node.arguments[0]?.text ?? '')
	) {
		violations.push(`${path}:${formatPolicyPosition(node)} forbids non-Node URL module specifiers`)
	}
	if (ts.isFunctionDeclaration(node) && !ts.isSourceFile(node.parent)) {
		violations.push(`${path}:${formatPolicyPosition(node)} forbids nested function declarations`)
	}
	if (
		(ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
		!isDirectCallback(node) &&
		!isDirectReturn(node) &&
		!isModuleFunction(node)
	) {
		violations.push(`${path}:${formatPolicyPosition(node)} forbids hidden function assignments`)
	}
	ts.forEachChild(node, (child) => inspectCodingNode(path, child, violations, checker))
}

/** Inspect one TypeScript source module for repository coding-law violations. */
export function inspectCodingLaw(path: string, content: string): readonly string[] {
	const violations: string[] = []
	const program = createPolicyProgram(path, content)
	const source = program.getSourceFile(path)
	if (source === undefined) throw new Error(`Policy source was not bound at ${path}`)
	const checker = program.getTypeChecker()
	const file = basename(path)

	if (/\.[cm]?jsx?$/u.test(path)) {
		violations.push(`${path} production modules use TypeScript source extensions`)
	}
	if (/@ts-(?:expect-error|ignore|nocheck)|eslint-disable|oxlint-disable/u.test(content)) {
		violations.push(`${path} forbids suppression directives`)
	}
	if (
		(source.referencedFiles.length > 0 ||
			source.libReferenceDirectives.length > 0 ||
			source.typeReferenceDirectives.length > 0) &&
		!hasAllowedTripleSlashReference(path, source)
	) {
		violations.push(`${path} forbids triple-slash references outside app/browser/env.d.ts`)
	}

	if (file === 'index.ts') {
		for (const statement of source.statements) {
			if (
				!ts.isExportDeclaration(statement) ||
				statement.exportClause !== undefined ||
				statement.isTypeOnly ||
				statement.moduleSpecifier === undefined
			) {
				violations.push(`${path} barrels contain only export * declarations`)
			}
		}
	}

	for (const statement of source.statements) {
		if (
			(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
			file !== 'types.ts'
		) {
			violations.push(`${path} centralizes interfaces and type aliases in types.ts`)
		}
		if (
			CENTRAL_SOURCE_FILES.includes(file) &&
			(ts.isClassDeclaration(statement) ||
				ts.isFunctionDeclaration(statement) ||
				ts.isInterfaceDeclaration(statement) ||
				ts.isTypeAliasDeclaration(statement) ||
				ts.isVariableStatement(statement)) &&
			!hasExportModifier(statement)
		) {
			violations.push(`${path} exports every centralized declaration`)
		}
		if (ts.isFunctionDeclaration(statement) && !FUNCTION_SOURCE_FILES.includes(file)) {
			violations.push(`${path} places module functions in their centralized kind file`)
		}
		if (ts.isVariableStatement(statement) && !DATA_SOURCE_FILES.includes(file)) {
			violations.push(`${path} places module data in its centralized kind file`)
		}
		if (
			ts.isClassDeclaration(statement) &&
			file !== 'errors.ts' &&
			!/^[A-Z][A-Za-z0-9]*\.ts$/u.test(file)
		) {
			violations.push(`${path} places each class in its matching implementation or errors file`)
		}
		if (ts.isEnumDeclaration(statement) && file !== 'types.ts') {
			violations.push(`${path} centralizes enum contracts in types.ts`)
		}
		if (file === 'constants.ts' && ts.isVariableStatement(statement)) {
			if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
				violations.push(`${path} constants.ts permits only const declarations`)
			}
			for (const declaration of statement.declarationList.declarations) {
				if (
					!ts.isIdentifier(declaration.name) ||
					!/^[A-Z][A-Z0-9_]*$/u.test(declaration.name.text)
				) {
					violations.push(
						`${path}:${formatPolicyPosition(declaration)} requires UPPER_SNAKE_CASE constants`,
					)
				}
				if (
					declaration.initializer !== undefined &&
					(ts.isArrayLiteralExpression(declaration.initializer) ||
						ts.isObjectLiteralExpression(declaration.initializer))
				) {
					violations.push(
						`${path}:${formatPolicyPosition(declaration)} freezes collection constants`,
					)
				}
			}
		}
	}

	if (/^[A-Z][A-Za-z0-9]*\.ts$/u.test(file)) {
		const classes = source.statements.filter(ts.isClassDeclaration)
		const invalid = source.statements.filter(
			(statement) => !ts.isImportDeclaration(statement) && !ts.isClassDeclaration(statement),
		)
		if (
			classes.length !== 1 ||
			invalid.length !== 0 ||
			classes[0]?.name?.text !== file.slice(0, -3) ||
			classes[0] === undefined ||
			!hasExportModifier(classes[0])
		) {
			violations.push(
				`${path} implementation modules contain imports and one matching exported class`,
			)
		}
		for (const member of classes[0]?.members ?? []) {
			if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
				violations.push(`${path}:${formatPolicyPosition(member)} uses runtime # privacy`)
			}
		}
	}

	inspectCodingNode(path, source, violations, checker)
	return violations
}

/** Inspect every production TypeScript module under one workspace. */
export function inspectCodingWorkspace(
	root: string,
	vueScripts?: VueScriptExtractorInterface,
): readonly string[] {
	const violations: string[] = []
	for (const path of globSync('{app,src}/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,vue}', {
		cwd: root,
	})) {
		const content = readFileSync(join(root, path), 'utf8')
		const normalizedPath = normalizePolicyPath(path)
		if (path.endsWith('.vue') && !normalizedPath.startsWith('app/browser/')) {
			violations.push(`${normalizedPath} Vue components belong in app/browser`)
		}
		violations.push(
			...(path.endsWith('.vue')
				? inspectVueCodingLaw(normalizedPath, vueScripts?.(normalizedPath, content))
				: inspectCodingLaw(normalizedPath, content)),
		)
	}
	return violations
}
