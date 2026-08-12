import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import * as ts from 'typescript'

/** A rule the fleet placement instrument can decide from syntax and a file path. */
export type PolicyRule =
	| 'class'
	| 'constant'
	| 'data'
	| 'domain'
	| 'export'
	| 'factory'
	| 'function'
	| 'mirror'
	| 'parser'
	| 'type'

/** One TypeScript source supplied to the placement instrument. */
export interface PolicySource {
	readonly path: string
	readonly content: string
}

/** One placement failure reported by the instrument. */
export interface PolicyViolation {
	readonly rule: PolicyRule
	readonly path: string
	readonly line?: number
	readonly message: string
}

/** One physical negative control, including the population boundary it attacks. */
export interface PolicyControl {
	readonly label: string
	readonly membership: string
	readonly rule: PolicyRule
	readonly files: readonly PolicySource[]
}

/** Every centralized module named by the architecture kind table. */
export const CENTRAL_SOURCE_FILES: readonly string[] = Object.freeze([
	'cloners.ts',
	'combinators.ts',
	'compilers.ts',
	'constants.ts',
	'contracts.ts',
	'errors.ts',
	'factories.ts',
	'handlers.ts',
	'helpers.ts',
	'index.ts',
	'inferers.ts',
	'middlewares.ts',
	'parsers.ts',
	'relations.ts',
	'routes.ts',
	'schemas.ts',
	'seeders.ts',
	'shapers.ts',
	'templates.ts',
	'types.ts',
	'validators.ts',
])

/** The exhaustive centralized-file set that permits module functions. */
export const FUNCTION_SOURCE_FILES: readonly string[] = Object.freeze([
	'cloners.ts',
	'combinators.ts',
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

/** Centralized files that permit module data by declaration syntax. */
export const DATA_SOURCE_FILES: readonly string[] = Object.freeze([
	'combinators.ts',
	'constants.ts',
	'contracts.ts',
	'relations.ts',
	'routes.ts',
	'schemas.ts',
	'shapers.ts',
	'templates.ts',
	'validators.ts',
])

/** Fleet-registered folders whose direct modules each contain one named function. */
export const FUNCTION_DOMAIN_FOLDERS: readonly string[] = Object.freeze(['app/browser/composables'])

/** TypeScript source extensions whose declaration syntax the sweep reads. */
export const POLICY_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
	'cts',
	'mts',
	'ts',
	'tsx',
])

/** The complete TypeScript source population inspected under either workspace axis. */
export const POLICY_SOURCE_GLOB = `{app,src}/**/*.{${POLICY_SOURCE_EXTENSIONS.join(',')}}`

/** The mirrored module-test population inspected under either workspace axis. */
export const POLICY_TEST_GLOB = 'tests/{app,src}/**/*.test.ts'

/**
 * Normalize platform separators for stable matching and diagnostics.
 *
 * @param path - The workspace-relative path to normalize.
 * @returns The path with forward slashes and no duplicate separators.
 */
export function normalizePolicyPath(path: string): string {
	return path.replaceAll('\\', '/').replace(/\/+/gu, '/')
}

/**
 * Whether a declaration carries a specified TypeScript modifier.
 *
 * @param node - The declaration to inspect.
 * @param modifier - The modifier syntax to find.
 * @returns `true` when the declaration carries the modifier.
 */
export function hasPolicyModifier(node: ts.Node, modifier: ts.SyntaxKind): boolean {
	return (
		ts.canHaveModifiers(node) &&
		ts.getModifiers(node)?.some((candidate) => candidate.kind === modifier) === true
	)
}

/**
 * Return the one-based line where a syntax node begins.
 *
 * @param node - The syntax node to locate.
 * @returns Its one-based source line.
 */
export function getPolicyLine(node: ts.Node): number {
	const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
	return position.line + 1
}

/**
 * Whether a path is a direct module of a fleet-registered function domain.
 *
 * @param path - The workspace-relative source path to inspect.
 * @returns `true` when the path has the registered function-module shape.
 */
export function isFunctionDomainPath(path: string): boolean {
	const normalized = normalizePolicyPath(path)
	const file = basename(normalized)
	return (
		FUNCTION_DOMAIN_FOLDERS.includes(dirname(normalized).replaceAll('\\', '/')) &&
		/^[a-z][A-Za-z0-9]*\.ts$/u.test(file) &&
		file !== 'index.ts' &&
		file !== 'main.ts' &&
		!CENTRAL_SOURCE_FILES.includes(file)
	)
}

/**
 * Whether a variable initializer is directly a function expression.
 *
 * @param initializer - The initializer to inspect.
 * @returns `true` for a direct arrow or function expression.
 */
export function isPolicyFunctionInitializer(initializer: ts.Expression | undefined): boolean {
	let expression = initializer
	while (expression !== undefined && ts.isParenthesizedExpression(expression)) {
		expression = expression.expression
	}
	return (
		expression !== undefined &&
		(ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
	)
}

/**
 * Whether an expression contains module-level function syntax.
 *
 * @param node - The initializer subtree to inspect.
 * @returns `true` when the subtree contains an arrow or function expression.
 */
export function hasPolicyFunctionExpression(node: ts.Node | undefined): boolean {
	if (node === undefined) return false
	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true
	if (ts.isClassExpression(node)) return false
	let found = false
	ts.forEachChild(node, (child) => {
		if (!found && hasPolicyFunctionExpression(child)) found = true
	})
	return found
}

/**
 * Create one stable violation for an inspection result.
 *
 * @param rule - The rule that failed.
 * @param path - The workspace-relative source path.
 * @param message - The failure text.
 * @param node - The syntax node that failed, when one exists.
 * @returns The stable violation record.
 */
export function createPolicyViolation(
	rule: PolicyRule,
	path: string,
	message: string,
	node?: ts.Node,
): PolicyViolation {
	return {
		rule,
		path,
		...(node === undefined ? {} : { line: getPolicyLine(node) }),
		message,
	}
}

/**
 * Inspect a registered function module's exact declaration shape.
 *
 * @param path - The workspace-relative source path.
 * @param source - The parsed TypeScript source.
 * @returns A domain-shape violation when the module is malformed.
 */
export function inspectFunctionDomain(
	path: string,
	source: ts.SourceFile,
): readonly PolicyViolation[] {
	const expected = basename(path, '.ts')
	const declarations = source.statements.filter(ts.isFunctionDeclaration)
	const implementations = declarations.filter((declaration) => declaration.body !== undefined)
	const invalid = source.statements.filter(
		(statement) => !ts.isImportDeclaration(statement) && !ts.isFunctionDeclaration(statement),
	)
	const valid =
		implementations.length === 1 &&
		invalid.length === 0 &&
		declarations.length > 0 &&
		declarations.every(
			(declaration) =>
				declaration.name?.text === expected &&
				hasPolicyModifier(declaration, ts.SyntaxKind.ExportKeyword) &&
				!hasPolicyModifier(declaration, ts.SyntaxKind.DefaultKeyword),
		)
	return valid
		? []
		: [
				createPolicyViolation(
					'domain',
					path,
					'registered function modules contain imports and one matching named export',
				),
			]
}

/**
 * Inspect parser and factory function names without inferring their meaning.
 *
 * @param path - The workspace-relative source path.
 * @param file - The source filename.
 * @param name - The declared function name, when present.
 * @param node - The function declaration or binding.
 * @returns A parser or factory name violation when the prefix is wrong.
 */
export function inspectPolicyFunctionName(
	path: string,
	file: string,
	name: string | undefined,
	node: ts.Node,
): readonly PolicyViolation[] {
	if (file === 'parsers.ts' && (name === undefined || !name.startsWith('parse'))) {
		return [createPolicyViolation('parser', path, 'parser functions use the parse prefix', node)]
	}
	if (file === 'factories.ts' && (name === undefined || !name.startsWith('create'))) {
		return [createPolicyViolation('factory', path, 'factory functions use the create prefix', node)]
	}
	return []
}

/**
 * Inspect one variable statement for data and function placement.
 *
 * @param path - The workspace-relative source path.
 * @param file - The source filename.
 * @param statement - The variable statement to inspect.
 * @param functionDomain - Whether the path is a registered function module.
 * @returns Every data, function, parser, and factory violation in declaration order.
 */
export function inspectPolicyVariables(
	path: string,
	file: string,
	statement: ts.VariableStatement,
	functionDomain: boolean,
): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	for (const declaration of statement.declarationList.declarations) {
		const directFunction = isPolicyFunctionInitializer(declaration.initializer)
		const containsFunction = hasPolicyFunctionExpression(declaration.initializer)
		if (!directFunction && !DATA_SOURCE_FILES.includes(file)) {
			violations.push(
				createPolicyViolation('data', path, 'module data sits in a data-kind file', declaration),
			)
		}
		if (containsFunction && !functionDomain && !FUNCTION_SOURCE_FILES.includes(file)) {
			violations.push(
				createPolicyViolation(
					'function',
					path,
					'module function syntax sits in a function-kind file',
					declaration,
				),
			)
		}
		if (directFunction && ts.isIdentifier(declaration.name)) {
			violations.push(...inspectPolicyFunctionName(path, file, declaration.name.text, declaration))
		}
	}
	return violations
}

/**
 * Inspect the const, name, and bare-collection rules for constants.ts.
 *
 * @param path - The workspace-relative source path.
 * @param statement - The variable statement to inspect.
 * @returns Every constants.ts syntax violation in declaration order.
 */
export function inspectPolicyConstants(
	path: string,
	statement: ts.VariableStatement,
): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
		violations.push(
			createPolicyViolation(
				'constant',
				path,
				'constants.ts permits only const declarations',
				statement,
			),
		)
	}
	for (const declaration of statement.declarationList.declarations) {
		if (!ts.isIdentifier(declaration.name) || !/^[A-Z][A-Z0-9_]*$/u.test(declaration.name.text)) {
			violations.push(
				createPolicyViolation(
					'constant',
					path,
					'constants.ts names declarations in UPPER_SNAKE_CASE',
					declaration,
				),
			)
		}
		if (
			declaration.initializer !== undefined &&
			(ts.isArrayLiteralExpression(declaration.initializer) ||
				ts.isObjectLiteralExpression(declaration.initializer))
		) {
			violations.push(
				createPolicyViolation(
					'constant',
					path,
					'constants.ts forbids bare collection literals',
					declaration,
				),
			)
		}
	}
	return violations
}

/**
 * Whether a top-level statement declares a centralized symbol.
 *
 * @param statement - The top-level statement to classify.
 * @returns `true` when the statement declares a symbol governed by the export rule.
 */
export function isPolicyDeclaration(statement: ts.Statement): boolean {
	return (
		ts.isClassDeclaration(statement) ||
		ts.isEnumDeclaration(statement) ||
		ts.isFunctionDeclaration(statement) ||
		ts.isInterfaceDeclaration(statement) ||
		ts.isModuleDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isVariableStatement(statement)
	)
}

/**
 * Inspect one source file against the fleet's syntactic placement register.
 *
 * @param source - The path and TypeScript text to inspect.
 * @returns Every syntactic placement violation in source order.
 */
export function inspectPolicySource(source: PolicySource): readonly PolicyViolation[] {
	const path = normalizePolicyPath(source.path)
	const file = basename(path)
	const syntax = ts.createSourceFile(path, source.content, ts.ScriptTarget.Latest, true)
	const violations: PolicyViolation[] = []
	const functionDomain = isFunctionDomainPath(path)
	const domainNames = FUNCTION_DOMAIN_FOLDERS.map((folder) => basename(folder))

	if (domainNames.includes(basename(file, '.ts'))) {
		violations.push(
			createPolicyViolation(
				'domain',
				path,
				'a registered function domain is a folder rather than a source file',
			),
		)
	}

	for (const statement of syntax.statements) {
		if (
			CENTRAL_SOURCE_FILES.includes(file) &&
			isPolicyDeclaration(statement) &&
			!hasPolicyModifier(statement, ts.SyntaxKind.ExportKeyword)
		) {
			violations.push(
				createPolicyViolation(
					'export',
					path,
					'every centralized declaration is exported',
					statement,
				),
			)
		}

		if (
			(ts.isEnumDeclaration(statement) ||
				ts.isInterfaceDeclaration(statement) ||
				ts.isModuleDeclaration(statement) ||
				ts.isTypeAliasDeclaration(statement)) &&
			file !== 'types.ts'
		) {
			violations.push(
				createPolicyViolation('type', path, 'type declarations sit in types.ts', statement),
			)
		}

		if (ts.isFunctionDeclaration(statement)) {
			if (!functionDomain && !FUNCTION_SOURCE_FILES.includes(file)) {
				violations.push(
					createPolicyViolation(
						'function',
						path,
						'module functions sit in a function-kind file',
						statement,
					),
				)
			}
			violations.push(...inspectPolicyFunctionName(path, file, statement.name?.text, statement))
		}

		if (ts.isVariableStatement(statement)) {
			violations.push(...inspectPolicyVariables(path, file, statement, functionDomain))
			if (file === 'constants.ts') violations.push(...inspectPolicyConstants(path, statement))
		}

		if (ts.isClassDeclaration(statement)) {
			const expected = basename(file, '.ts')
			if (
				file !== 'errors.ts' &&
				(!/^[A-Z][A-Za-z0-9]*\.ts$/u.test(file) || statement.name?.text !== expected)
			) {
				violations.push(
					createPolicyViolation(
						'class',
						path,
						'classes sit in their matching implementation or errors file',
						statement,
					),
				)
			}
		}
	}

	if (functionDomain) violations.push(...inspectFunctionDomain(path, syntax))
	return violations
}

/**
 * Inspect an explicit source population through the same per-file route as the workspace sweep.
 *
 * @param sources - The TypeScript files to inspect.
 * @returns Every syntactic placement violation in source order.
 */
export function inspectPolicySources(sources: readonly PolicySource[]): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	for (const source of sources) violations.push(...inspectPolicySource(source))
	return violations
}

/**
 * Read the complete TypeScript source population beneath one workspace.
 *
 * @param root - The workspace root to read.
 * @returns Every TypeScript source under the src and app axes, sorted by path.
 */
export function readPolicySources(root: string): readonly PolicySource[] {
	return globSync(POLICY_SOURCE_GLOB, { cwd: root })
		.sort()
		.map((path) => ({
			path: normalizePolicyPath(path),
			content: readFileSync(join(root, path), 'utf8'),
		}))
}

/**
 * Derive the required source module for one mirrored module test.
 *
 * @param path - The workspace-relative test path.
 * @returns The required TypeScript source path, or `undefined` for a reserved scope test.
 */
export function testToPolicySource(path: string): string | undefined {
	const normalized = normalizePolicyPath(path)
	if (basename(normalized) === 'integration.test.ts') return undefined
	if (!normalized.startsWith('tests/') || !normalized.endsWith('.test.ts')) return undefined
	return `${normalized.slice('tests/'.length, -'.test.ts'.length)}.ts`
}

/**
 * Inspect mirrored test paths against an explicit source-path population.
 *
 * @param tests - The module-test paths to inspect.
 * @param sources - The existing TypeScript source paths.
 * @returns Every missing mirror violation in test-path order.
 */
export function inspectPolicyMirrorPaths(
	tests: readonly string[],
	sources: ReadonlySet<string>,
): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	for (const test of tests) {
		const path = normalizePolicyPath(test)
		const source = testToPolicySource(path)
		if (source !== undefined && !sources.has(source)) {
			violations.push(
				createPolicyViolation('mirror', path, `module test requires matching source ${source}`),
			)
		}
	}
	return violations
}

/**
 * Inspect every mirrored module test beneath one workspace.
 *
 * @param root - The workspace root to inspect.
 * @returns Every missing mirror violation in test-path order.
 */
export function inspectPolicyMirrors(root: string): readonly PolicyViolation[] {
	const tests = globSync(POLICY_TEST_GLOB, { cwd: root }).sort().map(normalizePolicyPath)
	const sources = new Set(
		globSync('{app,src}/**/*.ts', { cwd: root }).sort().map(normalizePolicyPath),
	)
	return inspectPolicyMirrorPaths(tests, sources)
}

/**
 * Inspect source placement and test mirrors across one workspace.
 *
 * @param root - The workspace root to inspect.
 * @returns Every source-placement and mirror violation.
 */
export function inspectPolicyWorkspace(root: string): readonly PolicyViolation[] {
	return [...inspectPolicySources(readPolicySources(root)), ...inspectPolicyMirrors(root)]
}

/**
 * Write a control to a real temporary workspace and run the production sweep over it.
 *
 * @param control - The physical fixture and expected rule boundary.
 * @returns Every violation reported through the production workspace route.
 */
export function inspectPolicyControl(control: PolicyControl): readonly PolicyViolation[] {
	const root = mkdtempSync(join(tmpdir(), 'orkestrel-policy-'))
	try {
		for (const file of control.files) {
			const path = join(root, ...normalizePolicyPath(file.path).split('/'))
			mkdirSync(dirname(path), { recursive: true })
			writeFileSync(path, file.content, 'utf8')
		}
		return inspectPolicyWorkspace(root)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

/** Physical negative controls, one for each rule the instrument claims to enforce. */
export const POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a type outside types.ts',
		membership: 'top-level type declarations whose filename is not types.ts',
		rule: 'type',
		files: [{ path: 'src/mobile/helpers.ts', content: 'export interface ValueInterface {}\n' }],
	},
	{
		label: 'rejects an inline function in routes.ts',
		membership: 'module-level function syntax whose filename is absent from the function register',
		rule: 'function',
		files: [
			{
				path: 'src/worker/routes.ts',
				content: 'export const ROUTES = Object.freeze([{ handler: () => undefined }])\n',
			},
		],
	},
	{
		label: 'rejects data in handlers.ts',
		membership: 'module data whose filename is absent from the data register',
		rule: 'data',
		files: [{ path: 'app/edge/handlers.ts', content: "export const STATUS = 'ready'\n" }],
	},
	{
		label: 'rejects a hidden centralized declaration',
		membership: 'centralized declarations without an export modifier',
		rule: 'export',
		files: [{ path: 'src/worker/helpers.ts', content: 'function buildValue(): void {}\n' }],
	},
	{
		label: 'rejects a class that differs from its file',
		membership: 'class declarations outside errors.ts whose names differ from their filename',
		rule: 'class',
		files: [{ path: 'app/desktop/Widget.ts', content: 'export class Other {}\n' }],
	},
	{
		label: 'rejects mutable constants',
		membership: 'variable statements in constants.ts that are not const',
		rule: 'constant',
		files: [{ path: 'src/worker/constants.ts', content: 'export let COUNT = 1\n' }],
	},
	{
		label: 'rejects lower-case constants',
		membership: 'declarations in constants.ts whose names are not UPPER_SNAKE_CASE',
		rule: 'constant',
		files: [{ path: 'src/worker/constants.ts', content: 'export const count = 1\n' }],
	},
	{
		label: 'rejects bare collection constants',
		membership: 'declarations in constants.ts with direct array or object literal initializers',
		rule: 'constant',
		files: [{ path: 'src/worker/constants.ts', content: 'export const VALUES = []\n' }],
	},
	{
		label: 'rejects a parser without the parse prefix',
		membership: 'function declarations in parsers.ts whose names do not start with parse',
		rule: 'parser',
		files: [{ path: 'app/edge/parsers.ts', content: 'export function coerceValue(): void {}\n' }],
	},
	{
		label: 'rejects a factory without the create prefix',
		membership: 'function declarations in factories.ts whose names do not start with create',
		rule: 'factory',
		files: [{ path: 'app/edge/factories.ts', content: 'export function buildValue(): void {}\n' }],
	},
	{
		label: 'rejects a malformed registered function module',
		membership: 'direct camelCase modules in a registered function-domain folder',
		rule: 'domain',
		files: [
			{
				path: 'app/browser/composables/useTheme.ts',
				content: 'export function useMode(): void {}\n',
			},
		],
	},
	{
		label: 'rejects a file named for a function domain',
		membership: 'source files whose stem is registered as a function-domain folder name',
		rule: 'domain',
		files: [{ path: 'app/edge/composables.ts', content: '' }],
	},
	{
		label: 'rejects a function in an unregistered domain',
		membership: 'function modules whose parent path is absent from the domain register',
		rule: 'function',
		files: [
			{ path: 'src/worker/jobs/runTask.ts', content: 'export function runTask(): void {}\n' },
		],
	},
	{
		label: 'rejects an unmirrored module test',
		membership: 'module tests below tests/src or tests/app except integration.test.ts',
		rule: 'mirror',
		files: [
			{
				path: 'tests/app/worker/jobs/probe.test.ts',
				content: "import { it } from 'vitest'\nit('runs', () => {})\n",
			},
		],
	},
])

/** A differently shaped workspace with app, browser, and worker environments but no core. */
export const GENERIC_POLICY_SOURCES: readonly PolicySource[] = Object.freeze([
	{
		path: 'src/worker/types.ts',
		content: 'export interface TaskInterface { readonly id: string }\n',
	},
	{ path: 'src/worker/Worker.ts', content: 'export class Worker {}\n' },
	{
		path: 'app/browser/composables/useTheme.ts',
		content: 'export function useTheme(): void {}\n',
	},
	{ path: 'app/browser/handlers.ts', content: 'export function open(): void {}\n' },
	{
		path: 'app/browser/routes.ts',
		content:
			"import { open } from './handlers.js'\nexport const ROUTES = Object.freeze([{ method: 'GET', path: '/', handler: open }])\n",
	},
	{
		path: 'src/worker/constants.ts',
		content: "export const LABELS = Object.freeze(['ready'])\n",
	},
])
