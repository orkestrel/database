import {
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, matchesGlob } from 'node:path'
import * as ts from 'typescript'

/** A rule the fleet placement instrument can decide from syntax and a file path. */
export type PolicyRule =
	| 'bridge'
	| 'class'
	| 'constant'
	| 'data'
	| 'domain'
	| 'export'
	| 'factory'
	| 'function'
	| 'mirror'
	| 'parser'
	| 'skill'
	| 'suppression'
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
	readonly directories?: readonly string[]
	readonly line?: number
	readonly message?: string
}

/** Describes a contained temporary directory owned by one vendored test. */
export interface PolicyScratchInterface {
	readonly path: string
	write(target: string, text: string): void
	destroy(): void
}

/**
 * Creates a contained temporary directory owned by one vendored test.
 *
 * @param options - The temporary directory name prefix.
 * @returns The owned scratch directory.
 */
export function createPolicyScratch(options: { readonly prefix: string }): PolicyScratchInterface {
	const root = mkdtempSync(join(tmpdir(), options.prefix))
	return {
		path: root,
		write(target, text) {
			const normalized = normalizePolicyPath(target)
			const segments = normalized.split('/')
			if (
				normalized === '' ||
				normalized.startsWith('/') ||
				segments.some((segment) => segment === '..')
			) {
				throw new Error('Scratch target must stay within its root')
			}
			const path = join(root, ...segments)
			mkdirSync(dirname(path), { recursive: true })
			writeFileSync(path, text, 'utf8')
		},
		destroy() {
			rmSync(root, { recursive: true, force: true })
		},
	}
}

/** Parsed skill frontmatter and the exact scalar source used for bridge comparison. */
export interface SkillFrontmatter {
	readonly keys: readonly string[]
	readonly name: string | undefined
	readonly description: string | undefined
	readonly source: {
		readonly name: string | undefined
		readonly description: string | undefined
	}
}

/** The directory whose immediate child directories form the complete skill family. */
export const SKILL_FAMILY_ROOT = '.agents/skills'

/** The directory whose immediate child directories form the Claude skill bridge family. */
export const SKILL_BRIDGE_ROOT = '.claude/skills'

/** Minimal valid skill text for physical family controls. */
export const SKILL_POLICY_TEXT =
	'---\nname: sample\ndescription: Use this skill for a policy fixture.\n---\n\n# Skill\n'

/** Skill text naming one reference for physical family controls. */
export const SKILL_REFERENCE_TEXT = `${SKILL_POLICY_TEXT}\nRead references/example.md.\n`

/** Minimal valid provider bridge text for physical bridge controls. */
export const SKILL_BRIDGE_TEXT = `${SKILL_POLICY_TEXT}\nRead \`.agents/skills/sample/SKILL.md\`.\n`

/** Canonical skill metadata whose values each carry YAML's escaped apostrophe. */
export const SKILL_APOSTROPHE_METADATA =
	"interface:\n  display_name: 'Owner''s Fixture'\n" +
	"  short_description: 'Exercise the family''s apostrophe rule'\n" +
	"  default_prompt: 'Use $sample for this fixture''s value.'\n"

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

/**
 * Files excluded from the module-data rule because their namespace values hold helper behavior.
 * This exclusion also permits unrelated module data such as `export const RETRIES = 3`.
 */
export const DATA_EXEMPT_FILES: readonly string[] = Object.freeze(['helpers.ts'])

/** Fleet-registered folders whose direct modules each contain one named function. */
export const FUNCTION_DOMAIN_FOLDERS: readonly string[] = Object.freeze([
	'app/browser/composables',
	'src/server/execution',
])

/** Every ambient declaration suffix the source glob collects and the parsed population excludes. */
export const POLICY_AMBIENT_SUFFIXES: readonly string[] = Object.freeze([
	'.d.cts',
	'.d.mts',
	'.d.ts',
])

/** TypeScript source extensions whose declaration syntax the sweep reads. */
export const POLICY_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
	'cts',
	'mts',
	'ts',
	'tsx',
])

/** Every extension through which a mirrored test can name a module. */
export const POLICY_MODULE_EXTENSIONS: readonly string[] = Object.freeze([
	'cts',
	'mts',
	'ts',
	'tsx',
	'vue',
	'scss',
	'css',
])

/** Module extensions whose extensionless stem can resolve a leading-underscore partial. */
export const POLICY_PARTIAL_EXTENSIONS: readonly string[] = Object.freeze(['scss', 'css'])

/** The reserved stem prefix whose mirrored module can resolve inside the tests axis. */
export const POLICY_TESTS_MODULE_PREFIX = 'setup'

/** The complete parsed TypeScript source population under either workspace axis. */
export const POLICY_SOURCE_GLOB = `{app,src}/**/*.{${POLICY_SOURCE_EXTENSIONS.join(',')}}`

/** The complete module population available to mirrored tests under either workspace axis. */
export const POLICY_MODULE_GLOB = `{app,src}/**/*.{${POLICY_MODULE_EXTENSIONS.join(',')}}`

/** The tests-axis setup module population available to mirrored tests. */
export const POLICY_TESTS_MODULE_GLOB = `tests/**/${POLICY_TESTS_MODULE_PREFIX}*.ts`

/** The mirrored module-test population inspected under either workspace axis. */
export const POLICY_TEST_GLOB = 'tests/{app,src}/**/*.test.ts'

// Compose suppression tokens so the instrument does not report its own definitions or controls.
export const POLICY_SUPPRESSION_DIRECTIVE = ['oxlint', '-disable'].join('')

/** Source, test, config, and script files inspected for lint suppression directives. */
export const POLICY_SUPPRESSION_GLOB: readonly string[] = Object.freeze([
	'{src,app,tests,configs,scripts}/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,vue}',
	'*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,vue}',
])

/** Rules whose workspace-wide lint wiring must not be weakened by configuration. */
export const POLICY_WIRING_RULES: readonly string[] = Object.freeze([
	'policy/no-mocking',
	'policy/no-keyword-privacy',
	'typescript/parameter-properties',
	'typescript/explicit-member-accessibility',
])

/** Linted workspace roots that ignore patterns must not reach. */
export const POLICY_WIRING_ROOTS: readonly string[] = Object.freeze([
	'src',
	'app',
	'tests',
	'configs',
])

/** Either lint suppression token the text sweep refuses. */
export const POLICY_SUPPRESSION_PATTERN = new RegExp(
	[['eslint', '-disable'].join(''), POLICY_SUPPRESSION_DIRECTIVE].join('|'),
	'u',
)

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
 * Read the function expression an expression holds directly, through any parentheses.
 *
 * @param expression - The expression to unwrap.
 * @returns The arrow or function expression it holds directly, or `undefined` for anything else.
 */
export function expressionToPolicyFunction(
	expression: ts.Expression | undefined,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
	let current = expression
	while (current !== undefined && ts.isParenthesizedExpression(current)) {
		current = current.expression
	}
	if (current === undefined) return undefined
	return ts.isArrowFunction(current) || ts.isFunctionExpression(current) ? current : undefined
}

/**
 * Whether a variable initializer is directly a function expression.
 *
 * @param initializer - The initializer to inspect.
 * @returns `true` for a direct arrow or function expression.
 */
export function isPolicyFunctionInitializer(initializer: ts.Expression | undefined): boolean {
	return expressionToPolicyFunction(initializer) !== undefined
}

/**
 * Whether a module region holds a module policy function.
 *
 * A module region is syntax outside every permitted function. A permitted function's parameters and
 * the arguments of a call sitting inside one are read under this same rule, because the law grants
 * those positions nothing extra.
 *
 * @param node - The module region to inspect.
 * @returns `true` when the region holds an arrow or function expression the law does not permit.
 * An arrow or function expression passed directly as a call or `new` argument is exempt itself, and
 * reports only for what its parameters and body nest. A class expression is never function syntax.
 */
export function hasModulePolicyFunction(node: ts.Node | undefined): boolean {
	if (node === undefined) return false
	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true
	if (ts.isClassExpression(node)) return false
	if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
		if (hasModulePolicyFunction(node.expression)) return true
		if (node.arguments !== undefined) {
			for (const argument of node.arguments) {
				const permitted = expressionToPolicyFunction(argument)
				if (permitted === undefined) {
					if (hasModulePolicyFunction(argument)) return true
				} else if (nestsPolicyFunction(permitted)) return true
			}
		}
		return false
	}
	let found = false
	ts.forEachChild(node, (child) => {
		if (!found && hasModulePolicyFunction(child)) found = true
	})
	return found
}

/**
 * Whether a permitted function nests a policy function the law does not permit.
 *
 * The function is exempt in its own right. Its parameters read as a module region, and its body
 * reads as the region inside a permitted function, where a nested function keeps permission only by
 * qualifying independently as a direct callback or result.
 *
 * @param node - The permitted callback or returned function to inspect.
 * @returns `true` when its parameters or body nest function syntax the law does not permit.
 */
export function nestsPolicyFunction(node: ts.ArrowFunction | ts.FunctionExpression): boolean {
	for (const parameter of node.parameters) {
		if (hasModulePolicyFunction(parameter)) return true
	}
	if (!ts.isBlock(node.body)) {
		const returned = expressionToPolicyFunction(node.body)
		if (returned !== undefined) return nestsPolicyFunction(returned)
	}
	return hasNestedPolicyFunction(node.body)
}

/**
 * Whether a region inside a permitted function holds a nested policy function.
 *
 * A direct return keeps its permission through control flow. Every other nested function reports
 * unless it independently qualifies as a direct callback. Class-expression members stay outside
 * the instrument's reach.
 *
 * @param node - The region inside a permitted function to inspect.
 * @returns `true` when the region holds function syntax the law does not permit.
 */
export function hasNestedPolicyFunction(node: ts.Node): boolean {
	if (ts.isFunctionDeclaration(node)) return true
	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true
	if (ts.isClassExpression(node)) return false
	if (ts.isReturnStatement(node)) {
		const returned = expressionToPolicyFunction(node.expression)
		return returned === undefined
			? hasModulePolicyFunction(node.expression)
			: nestsPolicyFunction(returned)
	}
	if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
		return hasModulePolicyFunction(node)
	}
	let found = false
	ts.forEachChild(node, (child) => {
		if (!found && hasNestedPolicyFunction(child)) found = true
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
		const containsFunction = hasModulePolicyFunction(declaration.initializer)
		if (!directFunction && !DATA_SOURCE_FILES.includes(file) && !DATA_EXEMPT_FILES.includes(file)) {
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
 * Inspect an explicit parsed population through the same per-file route as the workspace sweep.
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
 * Read the parsed TypeScript source population beneath one workspace.
 *
 * @param root - The workspace root to read.
 * @returns Every non-ambient TypeScript source under the src and app axes, sorted by path.
 */
export function readPolicySources(root: string): readonly PolicySource[] {
	return globSync(POLICY_SOURCE_GLOB, { cwd: root })
		.map(normalizePolicyPath)
		.filter((path) => !POLICY_AMBIENT_SUFFIXES.some((suffix) => basename(path).endsWith(suffix)))
		.sort()
		.map((path) => ({
			path,
			content: readFileSync(join(root, path), 'utf8'),
		}))
}

/**
 * Derive the extensionless module stem for one mirrored module test.
 *
 * @param path - The workspace-relative test path.
 * @returns The extensionless module stem, or `undefined` for a reserved scope test.
 */
export function testToPolicyStem(path: string): string | undefined {
	const normalized = normalizePolicyPath(path)
	if (basename(normalized) === 'integration.test.ts') return undefined
	if (!normalized.startsWith('tests/') || !normalized.endsWith('.test.ts')) return undefined
	return normalized.slice('tests/'.length, -'.test.ts'.length)
}

/**
 * The candidate set is every module name a registered language resolves for a stem.
 *
 * @param stem - The extensionless workspace-relative module stem.
 * @returns Direct modules, partial modules, then a matching tests-axis setup module.
 */
export function stemToPolicyCandidates(stem: string): readonly string[] {
	const normalized = normalizePolicyPath(stem)
	const directory = dirname(normalized).replaceAll('\\', '/')
	const name = basename(normalized)
	const candidates = POLICY_MODULE_EXTENSIONS.map((extension) => `${normalized}.${extension}`)
	for (const extension of POLICY_PARTIAL_EXTENSIONS) {
		candidates.push(`${directory}/_${name}.${extension}`)
	}
	if (name.startsWith(POLICY_TESTS_MODULE_PREFIX)) candidates.push(`tests/${normalized}.ts`)
	return candidates
}

/**
 * Inspect mirrored test paths against an explicit module-path population.
 *
 * @param tests - The module-test paths to inspect.
 * @param modules - The existing module paths in every registered language.
 * @returns Every missing mirror violation in test-path order.
 */
export function inspectPolicyMirrorPaths(
	tests: readonly string[],
	modules: ReadonlySet<string>,
): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	for (const test of tests) {
		const path = normalizePolicyPath(test)
		const stem = testToPolicyStem(path)
		if (stem === undefined) continue
		const candidates = stemToPolicyCandidates(stem)
		if (!candidates.some((candidate) => modules.has(candidate))) {
			violations.push(
				createPolicyViolation(
					'mirror',
					path,
					`module test requires one matching module: ${candidates.join(', ')}`,
				),
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
	const modules = new Set([
		...globSync(POLICY_MODULE_GLOB, { cwd: root }).sort().map(normalizePolicyPath),
		...globSync(POLICY_TESTS_MODULE_GLOB, { cwd: root }).sort().map(normalizePolicyPath),
	])
	return inspectPolicyMirrorPaths(tests, modules)
}

/**
 * Inspect code-shaped workspace files for lint suppression directives.
 *
 * @param root - The workspace root to inspect.
 * @returns Every suppression occurrence in path and line order.
 */
export function inspectPolicySuppressions(root: string): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	const paths = globSync(POLICY_SUPPRESSION_GLOB, { cwd: root }).map(normalizePolicyPath).sort()
	for (const path of paths) {
		const lines = readFileSync(join(root, path), 'utf8').split('\n')
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]
			if (line !== undefined && POLICY_SUPPRESSION_PATTERN.test(line)) {
				violations.push({
					rule: 'suppression',
					path,
					line: index + 1,
					message: 'file carries a lint suppression directive',
				})
			}
		}
	}
	return violations
}

/**
 * Inspect the lint configuration that keeps policy rules active across the workspace.
 *
 * @param configuration - The parsed Oxlint configuration to inspect.
 * @returns Every wiring violation in rule and configuration order.
 */
export function inspectPolicyConfiguration(configuration: unknown): readonly string[] {
	const violations: string[] = []
	if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) {
		return ['Oxlint configuration must be a record']
	}

	const rules: unknown = Object.getOwnPropertyDescriptor(configuration, 'rules')?.value
	for (const rule of POLICY_WIRING_RULES) {
		const setting =
			typeof rules === 'object' && rules !== null && !Array.isArray(rules)
				? Object.getOwnPropertyDescriptor(rules, rule)?.value
				: undefined
		const severity = Array.isArray(setting) ? setting[0] : setting
		if (severity !== 'error') violations.push(`${rule} must have top-level error severity`)
	}

	const ignorePatterns: unknown = Object.getOwnPropertyDescriptor(
		configuration,
		'ignorePatterns',
	)?.value
	if (ignorePatterns !== undefined && !Array.isArray(ignorePatterns)) {
		violations.push('ignorePatterns must be an array when declared')
	} else if (Array.isArray(ignorePatterns)) {
		for (const pattern of ignorePatterns) {
			if (typeof pattern !== 'string' || pattern.startsWith('!')) continue
			const normalized = normalizePolicyPath(pattern).replace(/^\.\//u, '').replace(/^\//u, '')
			const [first = ''] = normalized.split('/')
			if (
				POLICY_WIRING_ROOTS.some(
					(root) => first === root || (first !== '' && matchesGlob(root, first)),
				)
			) {
				violations.push(`ignorePatterns must not reach ${pattern}`)
			}
		}
	}

	const overrides: unknown = Object.getOwnPropertyDescriptor(configuration, 'overrides')?.value
	if (overrides !== undefined && !Array.isArray(overrides)) {
		violations.push('overrides must be an array when declared')
	} else if (Array.isArray(overrides)) {
		for (const override of overrides) {
			if (typeof override !== 'object' || override === null || Array.isArray(override)) {
				violations.push('override entries must be records')
				continue
			}
			const overrideRules: unknown = Object.getOwnPropertyDescriptor(override, 'rules')?.value
			if (
				overrideRules === undefined ||
				typeof overrideRules !== 'object' ||
				overrideRules === null ||
				Array.isArray(overrideRules)
			) {
				continue
			}
			for (const rule of POLICY_WIRING_RULES) {
				if (Object.getOwnPropertyDescriptor(overrideRules, rule) !== undefined) {
					violations.push(`overrides must not configure ${rule}`)
				}
			}
		}
	}

	return violations
}

/**
 * Resolve an exact-case directory beneath a physical root.
 *
 * @param root - The physical directory from which resolution starts.
 * @param path - The relative directory path to resolve.
 * @returns The resolved directory, or `undefined` when a segment is absent or not a directory.
 */
export function resolvePolicyDirectory(root: string, path: string): string | undefined {
	const normalized = normalizePolicyPath(path)
	if (normalized === '' || normalized === '.') return root
	let current = root
	for (const segment of normalized.split('/')) {
		const entry = readdirSync(current, { withFileTypes: true }).find(
			(candidate) => candidate.name === segment && candidate.isDirectory(),
		)
		if (entry === undefined) return undefined
		current = join(current, entry.name)
	}
	return current
}

/**
 * Whether an exact-case path resolves to a regular file beneath a physical root.
 *
 * @param root - The physical directory from which resolution starts.
 * @param path - The relative file path to inspect.
 * @returns `true` only when every directory and the regular file match exact case.
 */
export function isPolicyFile(root: string, path: string): boolean {
	const normalized = normalizePolicyPath(path)
	const directory = resolvePolicyDirectory(root, dirname(normalized))
	if (directory === undefined) return false
	const name = basename(normalized)
	return readdirSync(directory, { withFileTypes: true }).some(
		(entry) => entry.name === name && entry.isFile(),
	)
}

/**
 * Read the immediate child directories beneath one workspace-relative path.
 *
 * @param root - The workspace root to inspect.
 * @param path - The workspace-relative parent directory.
 * @returns The sorted immediate child directory names.
 */
export function readPolicyDirectories(root: string, path: string): readonly string[] {
	const directory = resolvePolicyDirectory(root, path)
	if (directory === undefined) return []
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
}

/**
 * Discover the skill family from immediate directories in the workspace tree.
 *
 * @param root - The workspace root to inspect.
 * @returns The sorted directory names that belong to the skill family.
 */
export function readSkillFamily(root: string): readonly string[] {
	return readPolicyDirectories(root, SKILL_FAMILY_ROOT)
}

/**
 * Parse one skill document's frontmatter without interpreting arbitrary body lines as keys.
 *
 * @param content - The raw SKILL.md text.
 * @returns The parsed fields and exact scalar source, or `undefined` for an unsupported shape.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | undefined {
	const lines = content.replaceAll('\r\n', '\n').split('\n')
	const rawLines = content.split('\n')
	if (lines[0] !== '---') return undefined
	const boundary = lines.indexOf('---', 1)
	if (boundary === -1) return undefined
	const keys: string[] = []
	let name: string | undefined
	let description: string | undefined
	let nameSource: string | undefined
	let descriptionSource: string | undefined

	for (let index = 1; index < boundary; index += 1) {
		const line = lines[index]
		if (line === undefined) return undefined
		const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/u)
		const key = match?.[1]
		const scalar = match?.[2]
		if (key === undefined || scalar === undefined) return undefined
		if (scalar !== '' && !scalar.startsWith(' ')) return undefined
		keys.push(key)
		let value = scalar === '' ? '' : scalar.slice(1)
		let source = rawLines[index]?.slice(line.indexOf(':') + 1)
		if (source === undefined) return undefined
		if (value === '>-') {
			if (key !== 'description') return undefined
			const folded: string[] = []
			const sourceLines: string[] = [source]
			for (index += 1; index < boundary; index += 1) {
				const continuation = lines[index]
				if (continuation === undefined) return undefined
				if (continuation.trim() === '') {
					folded.push('')
					const rawContinuation = rawLines[index]
					if (rawContinuation === undefined) return undefined
					sourceLines.push(rawContinuation)
					continue
				}
				if (!continuation.startsWith('  ')) {
					index -= 1
					break
				}
				folded.push(continuation.slice(2))
				const rawContinuation = rawLines[index]
				if (rawContinuation === undefined) return undefined
				sourceLines.push(rawContinuation)
			}
			value = ''
			let blanks = 0
			for (const foldedLine of folded) {
				if (foldedLine === '') {
					blanks += 1
					continue
				}
				if (value !== '') value += blanks === 0 ? ' ' : '\n'.repeat(blanks)
				value += foldedLine
				blanks = 0
			}
			source = sourceLines.join('\n')
		} else if (key === 'description' && (/^['"]/u.test(value) || /^[>|][+-]?$/u.test(value))) {
			return undefined
		}
		if (key === 'name') {
			name = value
			nameSource = source
		} else if (key === 'description') {
			description = value
			descriptionSource = source
		}
	}

	return {
		keys,
		name,
		description,
		source: { name: nameSource, description: descriptionSource },
	}
}

/**
 * Test whether a description carries a sentence that begins with the case-sensitive word `Use`.
 *
 * @param description - The parsed skill description.
 * @returns True when the description contains the canonical trigger sentence.
 */
export function matchesSkillTrigger(description: string): boolean {
	return /(?:^|[.!?]\s+)Use \S/u.test(description)
}

/**
 * Read the direct Markdown files owned by one skill's references directory.
 *
 * @param root - The workspace root to inspect.
 * @param name - The discovered skill directory name.
 * @returns Each direct references/name.md path in sorted order.
 */
export function readSkillReferences(root: string, name: string): readonly string[] {
	const directory = resolvePolicyDirectory(root, `${SKILL_FAMILY_ROOT}/${name}/references`)
	if (directory === undefined) return []
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
		.map((entry) => `references/${entry.name}`)
		.sort()
}

/**
 * Create metadata in the canonical skill interface shape.
 *
 * @param name - The skill token the default prompt invokes.
 * @returns Canonical skill interface metadata ending in one newline.
 */
export function createSkillMetadata(name: string): string {
	return (
		[
			'interface:',
			"  display_name: 'Fixture Skill'",
			"  short_description: 'Exercise the skill family policy'",
			`  default_prompt: 'Use $${name} for this fixture.'`,
		].join('\n') + '\n'
	)
}

/**
 * Parse the default prompt from the canonical skill interface shape.
 *
 * Each value is a non-empty single-quoted scalar in which `''` carries an apostrophe.
 *
 * @param content - The raw agents/openai.yaml text.
 * @returns The default prompt scalar as written, or `undefined` when any structural rule fails.
 */
export function parseSkillPrompt(content: string): string | undefined {
	const normalized = content.replaceAll('\r\n', '\n')
	const lines = (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n')
	if (lines.length !== 4 || lines[0] !== 'interface:') return undefined
	const display = lines[1]?.match(/^  display_name: '((?:[^']|'')+)'$/u)
	const description = lines[2]?.match(/^  short_description: '((?:[^']|'')+)'$/u)
	const prompt = lines[3]?.match(/^  default_prompt: '((?:[^']|'')+)'$/u)
	if (display?.[1] === undefined || description?.[1] === undefined || prompt?.[1] === undefined) {
		return undefined
	}
	return prompt[1]
}

/**
 * Test whether a default prompt names one skill's token in complete form.
 *
 * A skill directory name is lowercase letters and hyphens, so a match followed by either continues
 * a longer name and names a different skill.
 *
 * @param prompt - The default prompt scalar as written.
 * @param name - The discovered skill directory name.
 * @returns True when the prompt carries `$name` as a complete token.
 */
export function matchesSkillToken(prompt: string, name: string): boolean {
	const token = `$${name}`
	for (let index = prompt.indexOf(token); index !== -1; index = prompt.indexOf(token, index + 1)) {
		const next = prompt.charAt(index + token.length)
		if (next === '' || !/[a-z-]/u.test(next)) return true
	}
	return false
}

/**
 * Extract the direct Markdown reference paths named in one skill document.
 *
 * @param content - The raw SKILL.md text.
 * @returns Each distinct references/name.md token in sorted order.
 */
export function extractSkillReferences(content: string): readonly string[] {
	const references = new Set<string>()
	// This raw-text scan includes fenced examples. Over-matching safely requires the named file.
	for (const match of content.matchAll(/references\/[A-Za-z0-9._-]+\.md/gu)) {
		const reference = match[0]
		if (reference !== undefined) references.add(reference)
	}
	return [...references].sort()
}

/**
 * Inspects one skill document for template TODOs outside Markdown code.
 *
 * Coverage includes each literal `TODO` outside a matched pair of single backticks on one line and
 * outside a backtick or tilde fence indented by no more than three spaces. A fence starts with at
 * least three matching markers and ends on a later line starting with the same marker. Four spaces
 * start an indented code block, which this fence scanner does not interpret. An unterminated fence
 * excludes the rest of the file. Inline spans cannot cross lines, and the line discipline cannot
 * validate escaped or repeated delimiters or distinguish a backtick inside a code span's language
 * tag.
 *
 * @param rule - The canonical-skill or provider-bridge population being inspected.
 * @param path - The workspace-relative skill document path.
 * @param content - The raw Markdown text.
 * @returns Every template-TODO violation in line and occurrence order.
 */
export function inspectSkillTemplateTODOs(
	rule: 'bridge' | 'skill',
	path: string,
	content: string,
): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	const lines = content.split(/\r\n|\r|\n/u)
	let fence: string | undefined
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]
		if (line === undefined) continue
		const fenceLine = line.replace(/^ {0,3}/u, '')
		if (fence !== undefined) {
			if (fenceLine.startsWith(fence)) fence = undefined
			continue
		}
		const opening = fenceLine.match(/^(`{3,}|~{3,})/u)?.[1]
		if (opening !== undefined) {
			fence = opening
			continue
		}
		let cursor = 0
		while (cursor < line.length) {
			const openingBacktick = line.indexOf('`', cursor)
			const end = openingBacktick === -1 ? line.length : openingBacktick
			for (
				let todo = line.indexOf('TODO', cursor);
				todo !== -1 && todo < end;
				todo = line.indexOf('TODO', todo + 4)
			) {
				violations.push({
					rule,
					path,
					line: index + 1,
					message: 'skill documents contain no template TODOs',
				})
			}
			if (openingBacktick === -1) break
			const closingBacktick = line.indexOf('`', openingBacktick + 1)
			cursor = closingBacktick === -1 ? openingBacktick + 1 : closingBacktick + 1
		}
	}
	return violations
}

/**
 * Inspect one discovered skill's required files, metadata, token, and references.
 *
 * @param root - The workspace root to inspect.
 * @param name - The discovered skill directory name.
 * @returns Every skill-family violation in invariant order.
 */
export function inspectSkill(root: string, name: string): readonly PolicyViolation[] {
	const base = `${SKILL_FAMILY_ROOT}/${name}`
	const skill = `${base}/SKILL.md`
	const metadata = `${base}/agents/openai.yaml`
	const violations: PolicyViolation[] = []
	let content: string | undefined
	const hasSkill = isPolicyFile(root, skill)
	if (!hasSkill) {
		violations.push(
			createPolicyViolation('skill', skill, 'skill requires an exact-case regular SKILL.md'),
		)
	} else {
		content = readFileSync(join(root, skill), 'utf8')
		const frontmatter = parseSkillFrontmatter(content)
		if (frontmatter === undefined) {
			violations.push(
				createPolicyViolation('skill', skill, 'SKILL.md frontmatter exists and parses'),
			)
		} else {
			const keys = new Set(frontmatter.keys)
			if (
				frontmatter.keys.length !== 2 ||
				keys.size !== 2 ||
				!keys.has('name') ||
				!keys.has('description')
			) {
				violations.push(
					createPolicyViolation(
						'skill',
						skill,
						'SKILL.md frontmatter contains exactly name and description',
					),
				)
			}
			if (frontmatter.name !== name) {
				violations.push(
					createPolicyViolation('skill', skill, 'SKILL.md frontmatter name matches its directory'),
				)
			}
			if (frontmatter.description === undefined || frontmatter.description.trim() === '') {
				violations.push(createPolicyViolation('skill', skill, 'SKILL.md description is non-empty'))
			} else if (!matchesSkillTrigger(frontmatter.description)) {
				violations.push(
					createPolicyViolation(
						'skill',
						skill,
						'SKILL.md description names when to use the skill in a sentence beginning Use',
					),
				)
			}
		}
		violations.push(...inspectSkillTemplateTODOs('skill', skill, content))
	}
	const hasMetadata = isPolicyFile(root, metadata)
	if (!hasMetadata) {
		violations.push(
			createPolicyViolation(
				'skill',
				metadata,
				'skill requires an exact-case regular agents/openai.yaml',
			),
		)
	} else {
		const prompt = parseSkillPrompt(readFileSync(join(root, metadata), 'utf8'))
		if (prompt === undefined) {
			violations.push(
				createPolicyViolation(
					'skill',
					metadata,
					'agents/openai.yaml matches the canonical four-line interface schema',
				),
			)
		} else if (!matchesSkillToken(prompt, name)) {
			violations.push(
				createPolicyViolation(
					'skill',
					metadata,
					`agents/openai.yaml default_prompt contains the complete token $${name}`,
				),
			)
		}
	}
	const named = content === undefined ? [] : extractSkillReferences(content)
	if (content !== undefined) {
		for (const reference of named) {
			const path = `${base}/${reference}`
			if (!isPolicyFile(root, path)) {
				violations.push(
					createPolicyViolation(
						'skill',
						path,
						`SKILL.md reference resolves to an exact-case regular file: ${reference}`,
					),
				)
			} else {
				violations.push(
					...inspectSkillTemplateTODOs('skill', path, readFileSync(join(root, path), 'utf8')),
				)
			}
		}
	}
	for (const reference of readSkillReferences(root, name)) {
		if (!named.includes(reference)) {
			violations.push(
				createPolicyViolation(
					'skill',
					`${base}/${reference}`,
					`references Markdown file is named by SKILL.md: ${reference}`,
				),
			)
		}
	}
	const references = resolvePolicyDirectory(root, `${base}/references`)
	if (references !== undefined) {
		for (const entry of readdirSync(references, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				violations.push(
					createPolicyViolation(
						'skill',
						`${base}/references/${entry.name}`,
						'skill references directory contains no subdirectories',
					),
				)
			}
		}
	}
	const directory = resolvePolicyDirectory(root, base)
	if (directory !== undefined) {
		for (const path of globSync('**/*', { cwd: directory }).map(normalizePolicyPath).sort()) {
			if (resolvePolicyDirectory(directory, path) !== undefined) {
				if (
					path === 'agents' ||
					path === 'references' ||
					path.startsWith('references/') ||
					(!hasSkill && path.toLowerCase() === 'skill.md') ||
					(!hasMetadata && path.toLowerCase() === 'agents/openai.yaml')
				) {
					continue
				}
				violations.push(
					createPolicyViolation(
						'skill',
						`${base}/${path}`,
						'skill directory contains only agents/ and references/ directories',
					),
				)
				continue
			}
			if (!isPolicyFile(directory, path)) continue
			const file = basename(path).toLowerCase()
			if (file === 'readme.md' || file === 'changelog.md') {
				violations.push(
					createPolicyViolation(
						'skill',
						`${base}/${path}`,
						'skill directory contains no README.md or CHANGELOG.md',
					),
				)
				continue
			}
			if (
				path === 'SKILL.md' ||
				path === 'agents/openai.yaml' ||
				/^references\/[^/]+\.md$/u.test(path) ||
				(!hasSkill &&
					(path.toLowerCase() === 'skill.md' || path.toLowerCase().startsWith('skill.md/'))) ||
				(!hasMetadata && path.toLowerCase() === 'agents/openai.yaml') ||
				(path.startsWith('references/') && path.slice('references/'.length).includes('/'))
			) {
				continue
			}
			violations.push(
				createPolicyViolation(
					'skill',
					`${base}/${path}`,
					'skill directory contains only SKILL.md, agents/openai.yaml, and references/*.md',
				),
			)
		}
	}
	return violations
}

/**
 * Inspect every immediate member of the discovered skill family.
 *
 * @param root - The workspace root to inspect.
 * @returns Every skill-family violation in directory and invariant order.
 */
export function inspectSkillFamily(root: string): readonly PolicyViolation[] {
	const violations: PolicyViolation[] = []
	for (const name of readSkillFamily(root)) violations.push(...inspectSkill(root, name))
	return violations
}

/**
 * Inspect one provider bridge against its canonical skill twin.
 *
 * @param root - The workspace root to inspect.
 * @param name - The shared canonical and bridge directory name.
 * @returns Every bridge violation in frontmatter, body, and directory order.
 */
export function inspectBridge(root: string, name: string): readonly PolicyViolation[] {
	const canonicalPath = `${SKILL_FAMILY_ROOT}/${name}/SKILL.md`
	const bridgeBase = `${SKILL_BRIDGE_ROOT}/${name}`
	const bridgePath = `${bridgeBase}/SKILL.md`
	if (!isPolicyFile(root, bridgePath)) {
		return [
			createPolicyViolation('bridge', bridgePath, 'bridge requires an exact-case regular SKILL.md'),
		]
	}
	const content = readFileSync(join(root, bridgePath), 'utf8')
	const bridge = parseSkillFrontmatter(content)
	const canonical = isPolicyFile(root, canonicalPath)
		? parseSkillFrontmatter(readFileSync(join(root, canonicalPath), 'utf8'))
		: undefined
	const violations: PolicyViolation[] = []
	if (bridge === undefined) {
		violations.push(
			createPolicyViolation('bridge', bridgePath, 'bridge SKILL.md frontmatter parses'),
		)
	} else {
		const keys = new Set(bridge.keys)
		if (
			bridge.keys.length !== 2 ||
			keys.size !== 2 ||
			!keys.has('name') ||
			!keys.has('description')
		) {
			violations.push(
				createPolicyViolation(
					'bridge',
					bridgePath,
					'bridge SKILL.md frontmatter contains exactly name and description',
				),
			)
		}
	}
	if (bridge !== undefined && canonical !== undefined) {
		if (bridge.source.name !== canonical.source.name) {
			violations.push(
				createPolicyViolation(
					'bridge',
					bridgePath,
					'bridge frontmatter name matches its canonical twin',
				),
			)
		}
		if (bridge.source.description !== canonical.source.description) {
			violations.push(
				createPolicyViolation(
					'bridge',
					bridgePath,
					'bridge frontmatter description matches its canonical twin',
				),
			)
		}
	}
	const normalized = content.replaceAll('\r\n', '\n')
	const boundary = normalized.indexOf('\n---', 3)
	const body = boundary === -1 ? normalized : normalized.slice(boundary + '\n---'.length)
	if (!body.includes(canonicalPath)) {
		violations.push(
			createPolicyViolation(
				'bridge',
				bridgePath,
				`bridge body names its canonical workflow: ${canonicalPath}`,
			),
		)
	}
	violations.push(...inspectSkillTemplateTODOs('bridge', bridgePath, content))
	if (resolvePolicyDirectory(root, `${bridgeBase}/references`) !== undefined) {
		violations.push(
			createPolicyViolation(
				'bridge',
				`${bridgeBase}/references`,
				'bridge owns no references directory',
			),
		)
	}
	return violations
}

/**
 * Inspect the provider bridge set and every bridge shared with the canonical skill family.
 *
 * @param root - The workspace root to inspect.
 * @returns Every bridge-set and bridge-content violation in directory order.
 */
export function inspectSkillBridges(root: string): readonly PolicyViolation[] {
	const canonical = readSkillFamily(root)
	const bridges = readPolicyDirectories(root, SKILL_BRIDGE_ROOT)
	const bridgeSet = new Set(bridges)
	const canonicalSet = new Set(canonical)
	const violations: PolicyViolation[] = []
	for (const name of canonical) {
		if (!bridgeSet.has(name)) {
			violations.push(
				createPolicyViolation(
					'bridge',
					`${SKILL_BRIDGE_ROOT}/${name}`,
					'canonical skill has a matching provider bridge directory',
				),
			)
		} else {
			violations.push(...inspectBridge(root, name))
		}
	}
	for (const name of bridges) {
		if (!canonicalSet.has(name)) {
			violations.push(
				createPolicyViolation(
					'bridge',
					`${SKILL_BRIDGE_ROOT}/${name}`,
					'provider bridge directory has a canonical skill twin',
				),
			)
		}
	}
	return violations
}

/**
 * Inspect every policy rule across one workspace.
 *
 * @param root - The workspace root to inspect.
 * @returns Every source, mirror, suppression, skill, and bridge violation.
 */
export function inspectPolicyWorkspace(root: string): readonly PolicyViolation[] {
	return [
		...inspectPolicySources(readPolicySources(root)),
		...inspectPolicyMirrors(root),
		...inspectPolicySuppressions(root),
		...inspectSkillFamily(root),
		...inspectSkillBridges(root),
	]
}

/**
 * Write a control to a real temporary workspace and run the production sweep over it.
 *
 * The control's rule selects the sweep: `skill` inspects the canonical family, `bridge` inspects
 * provider bridges, and every other rule inspects the whole workspace route.
 *
 * @param control - The physical fixture and expected rule boundary.
 * @returns Every violation reported through the production workspace route.
 */
export function inspectPolicyControl(control: PolicyControl): readonly PolicyViolation[] {
	const scratch = createPolicyScratch({ prefix: 'orkestrel-policy-' })
	try {
		for (const file of control.files) {
			scratch.write(file.path, file.content)
		}
		for (const directory of control.directories ?? []) {
			const marker = `${directory}/.policy-control`
			scratch.write(marker, '')
			rmSync(join(scratch.path, marker))
		}
		if (control.rule === 'skill') return inspectSkillFamily(scratch.path)
		if (control.rule === 'bridge') return inspectSkillBridges(scratch.path)
		return inspectPolicyWorkspace(scratch.path)
	} finally {
		scratch.destroy()
	}
}

/** Physical negative controls, one for each rule the instrument claims to enforce. */
export const POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a suppression directive in a scanned source file',
		membership: 'source, test, config, and script files in the suppression population',
		rule: 'suppression',
		files: [
			{
				path: 'scripts/control.ts',
				content: `// ${POLICY_SUPPRESSION_DIRECTIVE}\ndebugger\n`,
			},
		],
	},
	{
		label: 'rejects a suppression directive in a root TSX file',
		membership: 'root code files in the suppression population',
		rule: 'suppression',
		files: [
			{
				path: 'probeRoot.tsx',
				content: `// ${POLICY_SUPPRESSION_DIRECTIVE}\ndebugger\n`,
			},
		],
	},
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
	{
		label: 'rejects a module whose stem only prefixes the test stem',
		membership: 'module paths whose exact extensionless stem differs from the test stem',
		rule: 'mirror',
		files: [
			{ path: 'app/browser/WidgetPanel.vue', content: '<template></template>\n' },
			{ path: 'tests/app/browser/Widget.test.ts', content: '' },
		],
	},
	{
		label: 'rejects a partial whose stem differs from the test stem',
		membership: 'partial module paths whose exact underscore-free stem differs from the test stem',
		rule: 'mirror',
		files: [
			{ path: 'app/browser/styles/_token.scss', content: '' },
			{ path: 'tests/app/browser/styles/tokens.test.ts', content: '' },
		],
	},
	{
		label: 'rejects a test with no module candidate',
		membership: 'module tests with no matching module path in any registered form',
		rule: 'mirror',
		files: [{ path: 'tests/app/browser/Widget.test.ts', content: '' }],
	},
	{
		label: 'rejects a non-setup module inside tests',
		membership: 'tests-axis modules whose stem does not start with setup',
		rule: 'mirror',
		files: [
			{ path: 'tests/app/core/widget.ts', content: '' },
			{ path: 'tests/app/core/widget.test.ts', content: '' },
		],
	},
	{
		label: 'rejects a type in a non-ambient env module',
		membership: 'non-ambient TypeScript modules whose filename is not types.ts',
		rule: 'type',
		files: [{ path: 'app/browser/env.ts', content: 'export interface EnvironmentInterface {}\n' }],
	},
	{
		label: 'rejects a property-held arrow in constants.ts',
		membership: 'module-level function syntax not passed directly as an argument',
		rule: 'function',
		files: [
			{
				path: 'app/edge/constants.ts',
				content: 'export const HANDLERS = Object.freeze({ run: () => undefined })\n',
			},
		],
	},
	{
		label: 'rejects a callback parameter default function',
		membership: 'function expressions in callback parameter defaults',
		rule: 'function',
		files: [
			{
				path: 'app/edge/constants.ts',
				content: 'export const VALUES = Object.freeze(C.map((c = () => 1) => c))\n',
			},
		],
	},
	{
		label: 'rejects a destructured callback parameter default function',
		membership: 'function expressions in destructured callback parameter defaults',
		rule: 'function',
		files: [
			{
				path: 'app/edge/constants.ts',
				content: 'export const VALUES = Object.freeze(C.map(({ f = () => 1 }) => f))\n',
			},
		],
	},
	{
		label: 'rejects an assignment inside callback control flow',
		membership: 'function assignments inside callback control-flow branches',
		rule: 'function',
		files: [
			{
				path: 'app/edge/constants.ts',
				content:
					'export const VALUES = Object.freeze(C.map((c) => { if (c) { const f = () => 1; return f() } return 2 }))\n',
			},
		],
	},
	{
		label: 'rejects an assignment inside a direct callback',
		membership: 'function assignments inside the body of a callback passed directly as an argument',
		rule: 'function',
		files: [
			{
				path: 'app/edge/constants.ts',
				content:
					'export const VALUES = Object.freeze(C.map((c) => { const f = () => c; return f() }))\n',
			},
		],
	},
	{
		label: 'rejects a declaration inside a direct callback',
		membership:
			'function declarations inside the body of a callback passed directly as an argument',
		rule: 'function',
		files: [
			{
				path: 'app/edge/constants.ts',
				content:
					'export const LABELS = Object.freeze(COLUMNS.map((column) => { function format() { return column.label } return format() }))\n',
			},
		],
	},
	{
		label: 'rejects an assignment two direct callbacks down',
		membership: 'function assignments inside a callback the outer callback passes directly',
		rule: 'function',
		files: [
			{
				path: 'app/edge/constants.ts',
				content:
					'export const VALUES = Object.freeze(C.map((c) => wrap((d) => { const g = () => d; return g() })))\n',
			},
		],
	},
])

/** Physical in-family controls for every skill-family assertion class. */
export const SKILL_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a SKILL.md without frontmatter',
		membership: 'exact-case regular SKILL.md files in discovered skill directories',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: '# Skill\n' },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects an unsupported description scalar shape',
		membership: 'description scalars in discovered skill frontmatter',
		rule: 'skill',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: |\n  Use this skill for a policy fixture.\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects extra frontmatter keys',
		membership: 'parsed frontmatter keys in discovered skill documents',
		rule: 'skill',
		message: 'SKILL.md frontmatter contains exactly name and description',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: Use this skill for a policy fixture.\nlicense: MIT\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a frontmatter name that differs from its directory',
		membership: 'parsed names in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md frontmatter name matches its directory',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: other\ndescription: Use this skill for a policy fixture.\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects an empty skill description',
		membership: 'parsed descriptions in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md description is non-empty',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: '---\nname: sample\ndescription: \n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a description without a Use sentence',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		message: 'SKILL.md description names when to use the skill in a sentence beginning Use',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: Exercise the skill family policy.\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a single-quoted description scalar',
		membership: 'description scalars in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md frontmatter exists and parses',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					"---\nname: sample\ndescription: 'Use this skill for a policy fixture.'\n---\n\n# Skill\n",
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a double-quoted description scalar',
		membership: 'description scalars in discovered skill frontmatter',
		rule: 'skill',
		message: 'SKILL.md frontmatter exists and parses',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: "Use this skill for a policy fixture."\n---\n\n# Skill\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects an unnamed Markdown reference file',
		membership: 'Markdown files directly beneath a discovered skill references directory',
		rule: 'skill',
		message: 'references Markdown file is named by SKILL.md: references/orphan.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/references/orphan.md', content: '# Orphan\n' },
		],
	},
	{
		label: 'rejects a template TODO in skill prose',
		membership:
			'TODO occurrences outside inline backtick spans and fences indented no more than three spaces in canonical SKILL.md files and the references/*.md files they name',
		rule: 'skill',
		message: 'skill documents contain no template TODOs',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content: `${SKILL_POLICY_TEXT}\nTODO: describe the workflow\n`,
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a template TODO in a CR-only skill reference',
		membership:
			'TODO occurrences outside inline backtick spans and fenced code blocks in named canonical skill references using CR line endings',
		rule: 'skill',
		line: 5,
		message: 'skill documents contain no template TODOs',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_REFERENCE_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{
				path: '.agents/skills/sample/references/example.md',
				content: '# Example\r```text\rTODO: fenced\r```\rTODO: describe the workflow\r',
			},
		],
	},
	{
		label: 'rejects a template TODO in a four-space-indented fence opener',
		membership:
			'TODO occurrences inside a four-space-indented fence opener and closer, which forms an indented code block outside the fence population, in discovered skill documents',
		rule: 'skill',
		message: 'skill documents contain no template TODOs',
		files: [
			{
				path: '.agents/skills/sample/SKILL.md',
				content:
					SKILL_POLICY_TEXT +
					'\n3. Return the verdict.\n\n    ```text\n    TODO: describe the workflow\n    ```\n',
			},
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a nested references directory',
		membership: 'directories directly beneath a discovered skill references directory',
		rule: 'skill',
		message: 'skill references directory contains no subdirectories',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/references/nested/detail.md', content: '# Detail\n' },
		],
	},
	{
		label: 'rejects an auxiliary changelog in a skill directory',
		membership: 'files at any depth inside a discovered skill directory',
		rule: 'skill',
		message: 'skill directory contains no README.md or CHANGELOG.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/CHANGELOG.MD', content: '# Changes\n' },
		],
	},
	{
		label: 'rejects a non-contract file in a skill directory',
		membership: 'regular files at any depth inside a discovered skill directory',
		rule: 'skill',
		message: 'skill directory contains only SKILL.md, agents/openai.yaml, and references/*.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
			{ path: '.agents/skills/sample/run.sh', content: '#!/bin/sh\n' },
		],
	},
	{
		label: 'rejects an empty non-contract directory in a skill directory',
		membership: 'directories at any depth inside a discovered skill directory',
		rule: 'skill',
		message: 'skill directory contains only agents/ and references/ directories',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
		directories: ['.agents/skills/sample/assets'],
	},
	{
		label: 'rejects a missing exact-case SKILL.md',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/skill.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a missing exact-case agents/openai.yaml',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/OpenAI.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects a non-regular SKILL.md',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md/child.txt', content: '' },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
	{
		label: 'rejects malformed agents/openai.yaml metadata',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: 'interface: {}\n' },
		],
	},
	{
		label: 'rejects a default prompt with the wrong skill token',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('other') },
		],
	},
	{
		label: 'rejects a default prompt whose token extends the skill name',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.agents/skills/sample/agents/openai.yaml',
				content: createSkillMetadata('samplex'),
			},
		],
	},
	{
		label: 'rejects a dangling exact-case SKILL.md reference',
		membership: 'references/name.md tokens extracted from canonical SKILL.md text',
		rule: 'skill',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_REFERENCE_TEXT },
			{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		],
	},
])

/** Physical controls for provider-bridge assertions. */
export const BRIDGE_POLICY_CONTROLS: readonly PolicyControl[] = Object.freeze([
	{
		label: 'rejects a canonical skill without a provider bridge',
		membership: 'immediate directories beneath .agents/skills',
		rule: 'bridge',
		message: 'canonical skill has a matching provider bridge directory',
		files: [{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT }],
	},
	{
		label: 'rejects a provider bridge without a canonical skill',
		membership: 'immediate directories beneath .claude/skills',
		rule: 'bridge',
		message: 'provider bridge directory has a canonical skill twin',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.claude/skills/sample/SKILL.md', content: SKILL_BRIDGE_TEXT },
			{
				path: '.claude/skills/extra/SKILL.md',
				content:
					'---\nname: extra\ndescription: Use this skill for a policy fixture.\n---\n\nRead `.agents/skills/extra/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge without an exact-case SKILL.md',
		membership: 'provider bridge directories shared with the canonical family',
		rule: 'bridge',
		message: 'bridge requires an exact-case regular SKILL.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.claude/skills/sample/skill.md', content: SKILL_BRIDGE_TEXT },
		],
	},
	{
		label: 'rejects malformed bridge frontmatter',
		membership: 'exact-case regular SKILL.md files in shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge SKILL.md frontmatter parses',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content: '# Bridge\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects extra bridge frontmatter keys',
		membership: 'parsed frontmatter keys in shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge SKILL.md frontmatter contains exactly name and description',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: Use this skill for a policy fixture.\nlicense: MIT\n---\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge name that drifts from its canonical twin',
		membership: 'parsed frontmatter in shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge frontmatter name matches its canonical twin',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content:
					'---\nname: other\ndescription: Use this skill for a policy fixture.\n---\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge description that drifts from its canonical twin',
		membership: 'matching immediate directories beneath .agents/skills and .claude/skills',
		rule: 'bridge',
		message: 'bridge frontmatter description matches its canonical twin',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content:
					'---\nname: sample\ndescription: >-\n  Use this skill for a policy fixture.\n---\n\nRead `.agents/skills/sample/SKILL.md`.\n',
			},
		],
	},
	{
		label: 'rejects a bridge body without its canonical workflow path',
		membership: 'bodies of exact-case regular bridge SKILL.md files',
		rule: 'bridge',
		message: 'bridge body names its canonical workflow: .agents/skills/sample/SKILL.md',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content: `${SKILL_POLICY_TEXT}\nRead the canonical workflow.\n`,
			},
		],
	},
	{
		label: 'rejects a template TODO in bridge prose',
		membership:
			'TODO occurrences outside inline backtick spans and fenced code blocks in exact-case bridge SKILL.md files shared with the canonical family',
		rule: 'bridge',
		message: 'skill documents contain no template TODOs',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{
				path: '.claude/skills/sample/SKILL.md',
				content: `${SKILL_BRIDGE_TEXT}\nTODO: describe the bridge\n`,
			},
		],
	},
	{
		label: 'rejects a references directory owned by a provider bridge',
		membership: 'shared provider bridge directories',
		rule: 'bridge',
		message: 'bridge owns no references directory',
		files: [
			{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
			{ path: '.claude/skills/sample/SKILL.md', content: SKILL_BRIDGE_TEXT },
			{ path: '.claude/skills/sample/references/detail.md', content: '# Detail\n' },
		],
	},
])

/** An in-family skill whose metadata values carry escaped apostrophes, proving they parse. */
export const SKILL_POLICY_APOSTROPHE: PolicyControl = Object.freeze({
	label: 'accepts escaped apostrophes in agents/openai.yaml values',
	membership: 'immediate directories beneath .agents/skills',
	rule: 'skill',
	files: [
		{ path: '.agents/skills/sample/SKILL.md', content: SKILL_POLICY_TEXT },
		{ path: '.agents/skills/sample/agents/openai.yaml', content: SKILL_APOSTROPHE_METADATA },
	],
})

/** A folded description containing a colon, proving continuation lines do not become keys. */
export const SKILL_POLICY_FOLDED: PolicyControl = Object.freeze({
	label: 'accepts a folded description containing a colon',
	membership: 'folded description scalars in discovered skill frontmatter',
	rule: 'skill',
	files: [
		{
			path: '.agents/skills/sample/SKILL.md',
			content:
				'---\nname: sample\ndescription: >-\n  Use this skill when a continuation contains: a colon.\n---\n\n# Skill\n',
		},
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
	],
})

/** A healthy skill reference whose prose carries the documented backticked TODO form. */
export const SKILL_POLICY_BACKTICKED: PolicyControl = Object.freeze({
	label: 'accepts a backticked TODO in skill prose',
	membership: 'TODO occurrences inside matched inline backtick spans in discovered skill documents',
	rule: 'skill',
	files: [
		{ path: '.agents/skills/sample/SKILL.md', content: SKILL_REFERENCE_TEXT },
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
		{
			path: '.agents/skills/sample/references/example.md',
			content: '- every `TODO`, deferred branch, placeholder, or documented omission in scope.\n',
		},
	],
})

/** A healthy skill whose fenced example carries a template-TODO spelling. */
export const SKILL_POLICY_FENCED: PolicyControl = Object.freeze({
	label: 'accepts a TODO in a three-space-indented fenced skill example',
	membership:
		'TODO occurrences inside fenced code blocks indented no more than three spaces in discovered skill documents',
	rule: 'skill',
	files: [
		{
			path: '.agents/skills/sample/SKILL.md',
			content:
				SKILL_POLICY_TEXT +
				'\n3. Return the verdict.\n\n   ```text\n   TODO: describe the workflow\n   ```\n',
		},
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
	],
})

/** A folded description whose blank scalar line separates its paragraphs. */
export const SKILL_POLICY_PARAGRAPHS: PolicyControl = Object.freeze({
	label: 'accepts a folded description containing two paragraphs',
	membership: 'folded description scalars in discovered skill frontmatter',
	rule: 'skill',
	files: [
		{
			path: '.agents/skills/sample/SKILL.md',
			content:
				'---\nname: sample\ndescription: >-\n  First paragraph.\n\n  Use `--app` when a policy fixture needs it.\n---\n\n# Skill\n',
		},
		{ path: '.agents/skills/sample/agents/openai.yaml', content: createSkillMetadata('sample') },
	],
})

/** A bridge skill outside the discovered family, used to prove the membership boundary. */
export const SKILL_POLICY_EXCLUSION: PolicyControl = Object.freeze({
	label: 'excludes .claude/skills from the skill family',
	membership: 'directories outside .agents/skills',
	rule: 'skill',
	files: [{ path: '.claude/skills/bridge/SKILL.md', content: SKILL_POLICY_TEXT }],
})

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
