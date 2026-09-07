/** The syntax-node fields supplied to every policy visitor. */
export interface PolicyNode {
	readonly type: string
	readonly range: [number, number]
}

/** The expression fields inspected by the policy rules. */
export interface PolicyExpression extends PolicyNode {
	readonly parent?: PolicyExpression | null
	readonly name?: unknown
	readonly value?: unknown
	readonly key?: PolicyExpression
	readonly id?: PolicyExpression | null
	readonly method?: boolean
	readonly kind?: 'const' | 'get' | 'init' | 'let' | 'set' | 'var'
	readonly expression?: boolean
	readonly object?: PolicyExpression
	readonly property?: PolicyExpression
	readonly computed?: boolean
	readonly callee?: PolicyExpression
	readonly argument?: PolicyExpression | null
	readonly arguments?: readonly PolicyExpression[]
	readonly body?: PolicyExpression | readonly PolicyExpression[]
	readonly quasis?: readonly PolicyExpression[]
	readonly expressions?: readonly PolicyExpression[]
	readonly accessibility?: 'private' | 'protected' | 'public' | null
	readonly declaration?: PolicyExpression
	readonly declarations?: readonly PolicyExpression[]
	readonly init?: PolicyExpression | null
	readonly source?: PolicyExpression
	readonly specifiers?: readonly PolicyExpression[]
	readonly imported?: PolicyExpression
}

/** One declared module function paired with the name a prefix rule reads. */
export interface PolicyBinding {
	readonly node: PolicyExpression
	readonly name: string | undefined
}

/** One diagnostic emitted by a policy rule. */
export interface PolicyDiagnostic {
	readonly node: PolicyExpression
	readonly messageId: string
	readonly data?: Readonly<Record<string, string>>
}

/** The Oxlint context operations used by the policy rules. */
export interface PolicyContext {
	readonly filename: string
	/** The directory Oxlint resolves `filename` against. */
	readonly cwd: string
	report(diagnostic: PolicyDiagnostic): void
}

/** The rule documentation fields supplied to Oxlint. */
export interface PolicyDocs {
	readonly [key: string]: unknown
	readonly description: string
}

/** The rule metadata fields supplied to Oxlint. */
export interface PolicyMeta {
	readonly type: 'problem'
	readonly docs: PolicyDocs
	readonly messages: Readonly<Record<string, string>>
}

/** The Oxlint visitor entries used by the policy rules. */
export interface PolicyVisitor {
	readonly [key: string]: ((node: PolicyNode) => void) | undefined
	readonly Program?: (node: PolicyNode) => void
	readonly CallExpression?: (node: PolicyNode) => void
	readonly ClassDeclaration?: (node: PolicyNode) => void
	readonly FunctionDeclaration?: (node: PolicyNode) => void
	readonly FunctionExpression?: (node: PolicyNode) => void
	readonly ArrowFunctionExpression?: (node: PolicyNode) => void
	readonly ImportDeclaration?: (node: PolicyNode) => void
	readonly MemberExpression?: (node: PolicyNode) => void
	readonly MethodDefinition?: (node: PolicyNode) => void
	readonly PropertyDefinition?: (node: PolicyNode) => void
	readonly AccessorProperty?: (node: PolicyNode) => void
	readonly TSAbstractMethodDefinition?: (node: PolicyNode) => void
	readonly TSAbstractPropertyDefinition?: (node: PolicyNode) => void
	readonly TSAbstractAccessorProperty?: (node: PolicyNode) => void
	readonly TSDeclareFunction?: (node: PolicyNode) => void
	readonly TSEnumDeclaration?: (node: PolicyNode) => void
	readonly TSInterfaceDeclaration?: (node: PolicyNode) => void
	readonly TSModuleDeclaration?: (node: PolicyNode) => void
	readonly TSTypeAliasDeclaration?: (node: PolicyNode) => void
	readonly VariableDeclaration?: (node: PolicyNode) => void
}

/** The complete behavior exposed by one policy rule. */
export interface PolicyRuleInterface {
	readonly meta: PolicyMeta
	create(context: PolicyContext): PolicyVisitor
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

/** The registered function-domain names no source file may take as its stem. */
export const FUNCTION_DOMAIN_NAMES: readonly string[] = Object.freeze(
	FUNCTION_DOMAIN_FOLDERS.map((folder) => folder.slice(folder.lastIndexOf('/') + 1)),
)

/** Every ambient declaration suffix the placement and line-ending rules leave uninspected. */
export const POLICY_AMBIENT_SUFFIXES: readonly string[] = Object.freeze([
	'.d.cts',
	'.d.mts',
	'.d.ts',
])

/** TypeScript source extensions whose declaration syntax the placement rules read. */
export const POLICY_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
	'cts',
	'mts',
	'ts',
	'tsx',
])

/** The lint populations the placement rules run over, as the Oxlint configuration declares them. */
export const POLICY_PLACEMENT_GLOBS: readonly string[] = Object.freeze([
	`app/**/*.{${POLICY_SOURCE_EXTENSIONS.join(',')}}`,
	`src/**/*.{${POLICY_SOURCE_EXTENSIONS.join(',')}}`,
])

/** The lint population the line-ending rule runs over, as the Oxlint configuration declares it. */
export const POLICY_ENDING_GLOBS: readonly string[] = Object.freeze([
	'app/**/*.ts',
	'configs/**/*.ts',
	'src/**/*.ts',
])

/** The file name shape an implementation file takes, holding the class that matches its stem. */
export const POLICY_CLASS_PATTERN = /^[A-Z][A-Za-z0-9]*\.ts$/u

/** The name shape every constants.ts declaration takes. */
export const POLICY_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/u

/** The file name shape a direct module of a registered function domain takes. */
export const POLICY_DOMAIN_PATTERN = /^[a-z][A-Za-z0-9]*\.ts$/u

/** The file name a policy rule keys on, read from either host separator. */
export function pathToPolicyFile(filename: string): string {
	const normalized = filename.replaceAll('\\', '/')
	return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/** The folder path a policy rule keys on, read from either host separator. */
export function pathToPolicyFolder(filename: string): string {
	const normalized = filename.replaceAll('\\', '/')
	const boundary = normalized.lastIndexOf('/')
	return boundary === -1 ? '' : normalized.slice(0, boundary)
}

/**
 * The workspace-relative path when the file sits under the directory the linter resolved it
 * against, else the path as given. The linter resolves each file against its own directory, the
 * workspace root under the `lint` scripts and its package directory under `RuleTester`, so a file
 * outside that directory keeps its path and matches no registered domain folder, because a
 * registered folder is workspace-relative. For a workspace at the filesystem root the prefix is
 * the separator alone. A drive-letter case difference between the two arguments is not folded.
 */
export function pathToPolicyRelative(filename: string, cwd: string): string {
	const normalizedFile = filename.replaceAll('\\', '/')
	const normalizedCwd = cwd.replaceAll('\\', '/').replace(/\/+$/u, '')
	const prefix = `${normalizedCwd}/`
	return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : normalizedFile
}

/** The extensionless stem of one policy file name. */
export function fileToPolicyStem(file: string): string {
	const boundary = file.lastIndexOf('.')
	return boundary <= 0 ? file : file.slice(0, boundary)
}

/** Whether a path names an ambient declaration file, which no policy rule inspects. */
export function isPolicyAmbient(filename: string): boolean {
	const file = pathToPolicyFile(filename)
	return POLICY_AMBIENT_SUFFIXES.some((suffix) => file.endsWith(suffix))
}

/**
 * Whether a path is a direct module of a fleet-registered function domain.
 *
 * The registered folder is a workspace-relative path, compared by equality after the linter's own
 * directory is stripped from the given path.
 */
export function isPolicyDomain(filename: string, cwd: string): boolean {
	const relative = pathToPolicyRelative(filename, cwd)
	const file = pathToPolicyFile(relative)
	const folder = pathToPolicyFolder(relative)
	return (
		FUNCTION_DOMAIN_FOLDERS.some((registered) => folder === registered) &&
		POLICY_DOMAIN_PATTERN.test(file) &&
		file !== 'index.ts' &&
		file !== 'main.ts' &&
		!CENTRAL_SOURCE_FILES.includes(file)
	)
}

/** The identifier name a node carries, or `undefined` for any other syntax. */
export function identifierToPolicyName(
	node: PolicyExpression | null | undefined,
): string | undefined {
	if (node === undefined || node === null || node.type !== 'Identifier') return undefined
	return typeof node.name === 'string' ? node.name : undefined
}

/** The literal text a node carries, through a single-quasi template literal. */
export function expressionToPolicyText(
	node: PolicyExpression | null | undefined,
): string | undefined {
	if (node === undefined || node === null) return undefined
	if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined
	if (
		node.type !== 'TemplateLiteral' ||
		node.quasis?.length !== 1 ||
		node.expressions?.length !== 0
	) {
		return undefined
	}
	const value = node.quasis[0]?.value
	if (typeof value !== 'object' || value === null) return undefined
	const cooked: unknown = Object.getOwnPropertyDescriptor(value, 'cooked')?.value
	const raw: unknown = Object.getOwnPropertyDescriptor(value, 'raw')?.value
	return typeof cooked === 'string' ? cooked : typeof raw === 'string' ? raw : undefined
}

/** The single body expression a node holds, excluding a statement list. */
export function expressionToPolicyBody(node: PolicyExpression): PolicyExpression | undefined {
	const body = node.body
	if (body === undefined) return undefined
	return 'type' in body ? body : undefined
}

/** The top-level statements a program holds. */
export function programToPolicyStatements(node: PolicyExpression): readonly PolicyExpression[] {
	const body = node.body
	if (body === undefined || 'type' in body) return []
	return body
}

/** The declaration a top-level statement holds, through either export form. */
export function statementToPolicyDeclaration(node: PolicyExpression): PolicyExpression | undefined {
	if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
		return node.declaration
	}
	return node
}

/** Whether a statement sits at module scope, through either export form. */
export function isPolicyTop(node: PolicyExpression): boolean {
	const parent = node.parent
	if (parent === undefined || parent === null) return false
	if (parent.type === 'Program') return true
	return (
		(parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration') &&
		parent.parent?.type === 'Program'
	)
}

/** Whether a policy expression is runtime function syntax. */
export function isPolicyFunction(node: PolicyExpression): boolean {
	return (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	)
}

/** Whether a node declares a module function, including a signature without a body. */
export function isPolicyDeclaredFunction(node: PolicyExpression): boolean {
	return node.type === 'FunctionDeclaration' || node.type === 'TSDeclareFunction'
}

/** Whether a policy function is anonymous. */
export function isPolicyAnonymous(node: PolicyExpression): boolean {
	return node.type === 'ArrowFunctionExpression' || node.id === null
}

/** Return the outermost parenthesized expression holding a policy function. */
export function functionToPolicyPosition(node: PolicyExpression): PolicyExpression {
	let position = node
	while (position.parent?.type === 'ParenthesizedExpression') {
		position = position.parent
	}
	return position
}

/** Whether a policy function is an anonymous callback passed directly as an argument. */
export function isPolicyCallback(node: PolicyExpression): boolean {
	if (!isPolicyAnonymous(node)) return false
	const position = functionToPolicyPosition(node)
	const parent = position.parent
	return (
		(parent?.type === 'CallExpression' || parent?.type === 'NewExpression') &&
		parent.arguments?.includes(position) === true
	)
}

/** Whether a policy function is an anonymous function returned directly as a result. */
export function isPolicyResult(node: PolicyExpression): boolean {
	if (!isPolicyAnonymous(node)) return false
	const position = functionToPolicyPosition(node)
	const parent = position.parent
	return (
		(parent?.type === 'ReturnStatement' && parent.argument === position) ||
		(parent?.type === 'ArrowFunctionExpression' && parent.body === position)
	)
}

/** Whether an Oxlint function expression represents method syntax. */
export function isPolicyMethod(node: PolicyExpression): boolean {
	const parent = node.parent
	return (
		node.type === 'FunctionExpression' &&
		parent?.value === node &&
		(parent.type === 'MethodDefinition' ||
			(parent.type === 'Property' &&
				(parent.method === true || parent.kind === 'get' || parent.kind === 'set')))
	)
}

/** Whether a policy function sits inside another function before any class-expression boundary. */
export function hasPolicyFunctionAncestor(node: PolicyExpression): boolean {
	let parent = node.parent
	let method = false
	while (parent !== undefined && parent !== null) {
		if (parent.type === 'ClassExpression') return false
		if (parent.type === 'ClassDeclaration' && method) return true
		if (isPolicyFunction(parent)) {
			if (!isPolicyMethod(parent)) return true
			method = true
		}
		parent = parent.parent
	}
	return method
}

/** Whether an arrow is the policy plugin's sanctioned visitor-table delegation. */
export function isPolicyVisitor(node: PolicyExpression): boolean {
	const body = expressionToPolicyBody(node)
	if (
		node.type !== 'ArrowFunctionExpression' ||
		node.expression !== true ||
		body?.type !== 'CallExpression' ||
		body.callee?.type !== 'Identifier' ||
		typeof body.callee.name !== 'string' ||
		!body.callee.name.startsWith('report')
	) {
		return false
	}
	const property = node.parent
	const object = property?.parent
	const returned = object?.parent
	const block = returned?.parent
	const create = block?.parent
	const definition = create?.parent
	return (
		property?.type === 'Property' &&
		property.method === false &&
		property.value === node &&
		object?.type === 'ObjectExpression' &&
		returned?.type === 'ReturnStatement' &&
		returned.argument === object &&
		block?.type === 'BlockStatement' &&
		create?.type === 'FunctionExpression' &&
		definition?.type === 'Property' &&
		definition.method === true &&
		definition.value === create &&
		definition.key?.type === 'Identifier' &&
		definition.key.name === 'create'
	)
}

/**
 * Return the module-scope statement that owns a policy function, or `undefined` when none does.
 *
 * A class declaration or class expression on the way up ends the search, because the placement law
 * reads module regions rather than class members.
 */
export function functionToPolicyRegion(node: PolicyExpression): PolicyExpression | undefined {
	let current = node
	let parent = current.parent
	while (parent !== undefined && parent !== null) {
		if (parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') return undefined
		if (parent.type === 'Program') return statementToPolicyDeclaration(current)
		current = parent
		parent = parent.parent
	}
	return undefined
}

/** Every module function a top-level statement declares, paired with its declared name. */
export function statementToPolicyBindings(node: PolicyExpression): readonly PolicyBinding[] {
	if (isPolicyDeclaredFunction(node)) {
		return [{ node, name: identifierToPolicyName(node.id) }]
	}
	if (node.type !== 'VariableDeclaration') return []
	const bindings: PolicyBinding[] = []
	for (const declarator of node.declarations ?? []) {
		const init = declarator.init
		if (init === undefined || init === null || !isPolicyFunction(init)) continue
		const name = identifierToPolicyName(declarator.id)
		if (name === undefined) continue
		bindings.push({ node: declarator, name })
	}
	return bindings
}

/** Whether a call trims a whole payload before splitting it on a line feed. */
export function isPolicySplit(node: PolicyExpression): boolean {
	if (node.type !== 'CallExpression' || node.arguments?.length !== 1) return false
	const split = node.callee
	if (split?.type !== 'MemberExpression' || split.computed === true) return false
	if (identifierToPolicyName(split.property) !== 'split') return false
	if (expressionToPolicyText(node.arguments[0]) !== '\n') return false
	const trim = split.object
	if (trim?.type !== 'CallExpression' || trim.arguments?.length !== 0) return false
	const read = trim.callee
	return (
		read?.type === 'MemberExpression' &&
		read.computed !== true &&
		identifierToPolicyName(read.property) === 'trim'
	)
}

/** Whether an expression reads the host line ending from a binding named os. */
export function isPolicyTerminator(node: PolicyExpression): boolean {
	return (
		node.type === 'MemberExpression' &&
		node.computed !== true &&
		identifierToPolicyName(node.property) === 'EOL' &&
		identifierToPolicyName(node.object) === 'os'
	)
}

/** Whether an import declaration takes the EOL member from the host module. */
export function importsPolicyTerminator(node: PolicyExpression): boolean {
	const specifier = expressionToPolicyText(node.source)
	if (specifier !== 'node:os' && specifier !== 'os') return false
	return (node.specifiers ?? []).some(
		(element) =>
			element.type === 'ImportSpecifier' && identifierToPolicyName(element.imported) === 'EOL',
	)
}

/** Report function syntax nested inside another function body. */
export function reportNested(context: PolicyContext, node: PolicyExpression): void {
	if (
		!hasPolicyFunctionAncestor(node) ||
		isPolicyMethod(node) ||
		isPolicyCallback(node) ||
		isPolicyResult(node) ||
		isPolicyVisitor(node)
	) {
		return
	}
	context.report({ node, messageId: 'nested' })
}

/** Report banned calls on the named Vitest and Jest framework objects. */
export function reportMocking(context: PolicyContext, node: PolicyExpression): void {
	const callee = node.callee
	if (
		callee === undefined ||
		callee.type !== 'MemberExpression' ||
		callee.object === undefined ||
		callee.property === undefined ||
		callee.computed === undefined
	) {
		return
	}

	const object = callee.object
	if (object.type !== 'Identifier' || (object.name !== 'vi' && object.name !== 'jest')) {
		return
	}

	const property = callee.property
	const member = callee.computed
		? expressionToPolicyText(property)
		: identifierToPolicyName(property)

	switch (member) {
		case 'mock':
		case 'doMock':
		case 'unstable_mockModule':
			context.report({ node, messageId: 'mock' })
			break
		case 'fn':
		case 'spyOn':
			context.report({ node, messageId: 'spy' })
			break
		case 'useFakeTimers':
		case 'setSystemTime':
			context.report({ node, messageId: 'clock' })
			break
		case 'stubGlobal':
		case 'stubEnv':
			context.report({ node, messageId: 'stub' })
			break
	}
}

/** Report TypeScript privacy keywords on class members. */
export function reportPrivacy(context: PolicyContext, node: PolicyExpression): void {
	if (node.accessibility === 'private' || node.accessibility === 'protected') {
		context.report({
			node,
			messageId: 'keyword',
			data: { keyword: node.accessibility },
		})
	}
}

/** Report a centralized declaration that carries no export. */
export function reportHidden(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	if (!CENTRAL_SOURCE_FILES.includes(pathToPolicyFile(context.filename))) return
	if (node.parent?.type !== 'Program') return
	context.report({ node, messageId: 'hidden' })
}

/** Report a type declaration outside types.ts. */
export function reportType(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyTop(node)) return
	if (pathToPolicyFile(context.filename) === 'types.ts') return
	context.report({ node, messageId: 'type' })
}

/** Report a class whose file neither names it nor collects errors. */
export function reportClass(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyTop(node)) return
	const file = pathToPolicyFile(context.filename)
	if (file === 'errors.ts') return
	if (
		POLICY_CLASS_PATTERN.test(file) &&
		identifierToPolicyName(node.id) === fileToPolicyStem(file)
	) {
		return
	}
	context.report({ node, messageId: 'class' })
}

/** Report module data outside a data-kind file. */
export function reportData(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyTop(node)) return
	const file = pathToPolicyFile(context.filename)
	if (DATA_SOURCE_FILES.includes(file) || DATA_EXEMPT_FILES.includes(file)) return
	for (const declarator of node.declarations ?? []) {
		const init = declarator.init
		if (init !== undefined && init !== null && isPolicyFunction(init)) continue
		context.report({ node: declarator, messageId: 'data' })
	}
}

/** Report module function syntax outside a function-kind file. */
export function reportFunction(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	if (FUNCTION_SOURCE_FILES.includes(pathToPolicyFile(context.filename))) return
	if (isPolicyDomain(context.filename, context.cwd)) return
	const region = functionToPolicyRegion(node)
	if (region === undefined) return
	if (isPolicyDeclaredFunction(region)) {
		if (region === node) context.report({ node, messageId: 'function' })
		return
	}
	if (region.type !== 'VariableDeclaration') return
	if (isPolicyCallback(node) || isPolicyResult(node)) return
	context.report({ node, messageId: 'function' })
}

/** Report a constants.ts declaration that is mutable, misnamed, or a bare collection. */
export function reportConstant(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyTop(node)) return
	if (pathToPolicyFile(context.filename) !== 'constants.ts') return
	if (node.kind !== 'const') context.report({ node, messageId: 'mutable' })
	for (const declarator of node.declarations ?? []) {
		const name = identifierToPolicyName(declarator.id)
		if (name === undefined || !POLICY_CONSTANT_PATTERN.test(name)) {
			context.report({ node: declarator, messageId: 'naming' })
		}
		const init = declarator.init
		if (init?.type === 'ArrayExpression' || init?.type === 'ObjectExpression') {
			context.report({ node: declarator, messageId: 'collection' })
		}
	}
}

/** Report a parsers.ts function whose name lacks the parse prefix. */
export function reportParser(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyTop(node)) return
	if (pathToPolicyFile(context.filename) !== 'parsers.ts') return
	for (const binding of statementToPolicyBindings(node)) {
		if (binding.name === undefined || !binding.name.startsWith('parse')) {
			context.report({ node: binding.node, messageId: 'parser' })
		}
	}
}

/** Report a factories.ts function whose name lacks the create prefix. */
export function reportFactory(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyTop(node)) return
	if (pathToPolicyFile(context.filename) !== 'factories.ts') return
	for (const binding of statementToPolicyBindings(node)) {
		if (binding.name === undefined || !binding.name.startsWith('create')) {
			context.report({ node: binding.node, messageId: 'factory' })
		}
	}
}

/** Report a registered function domain taken as a file, or a malformed module inside one. */
export function reportDomain(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	const file = pathToPolicyFile(context.filename)
	if (FUNCTION_DOMAIN_NAMES.includes(fileToPolicyStem(file))) {
		context.report({ node, messageId: 'file' })
	}
	if (!isPolicyDomain(context.filename, context.cwd)) return
	const expected = fileToPolicyStem(file)
	let implementations = 0
	let malformed = 0
	for (const statement of programToPolicyStatements(node)) {
		if (statement.type === 'ImportDeclaration') continue
		const declaration = statementToPolicyDeclaration(statement)
		if (declaration === undefined || !isPolicyDeclaredFunction(declaration)) {
			malformed += 1
			continue
		}
		if (declaration.type === 'FunctionDeclaration') implementations += 1
		if (
			statement.type !== 'ExportNamedDeclaration' ||
			identifierToPolicyName(declaration.id) !== expected
		) {
			malformed += 1
		}
	}
	if (implementations !== 1 || malformed > 0) context.report({ node, messageId: 'module' })
}

/** Report source that reads the host line ending or splits arrived text before trimming it. */
export function reportEnding(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	if (isPolicySplit(node)) context.report({ node, messageId: 'split' })
	if (isPolicyTerminator(node)) context.report({ node, messageId: 'terminator' })
}

/** Report an import that takes the host line ending from the operating-system module. */
export function reportEndingImport(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	if (importsPolicyTerminator(node)) context.report({ node, messageId: 'terminator' })
}

/** Ban function declarations and assignments inside another function body. */
export const NESTED_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow function declarations and assignments inside another function body.',
		},
		messages: {
			nested:
				'Extract the function to module scope or make instance-bound work a method; only direct anonymous callbacks and returned anonymous functions may stay in a function body.',
		},
	},
	create(context) {
		return {
			FunctionDeclaration: (node) => reportNested(context, node),
			FunctionExpression: (node) => reportNested(context, node),
			ArrowFunctionExpression: (node) => reportNested(context, node),
		}
	},
}

/** Ban framework mocking, spying, fake clocks, and global or environment stubs. */
export const MOCKING_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow named vi and jest mocking APIs; a renamed import alias escapes this name-based rule.',
		},
		messages: {
			mock: 'Replace module mocking with a real injected collaborator; a missing seam is a missing injection point, not an untestable truth.',
			spy: 'Use createRecorder from @orkestrel/test; framework spies and mock functions are banned.',
			clock:
				'Use real short timers and waitForDelay from @orkestrel/test; never replace the host clock.',
			stub: 'Drive the real implementation or a protocol-faithful fixture; never stub globals or environment.',
		},
	},
	create(context) {
		return {
			CallExpression: (node) => reportMocking(context, node),
		}
	},
}

/** Ban compile-time-only TypeScript privacy keywords on class members. */
export const PRIVACY_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow private and protected class members in favor of runtime-enforced # privacy.',
		},
		messages: {
			keyword: 'Use runtime-enforced # privacy; TypeScript {{keyword}} is compile-time-only.',
		},
	},
	create(context) {
		return {
			MethodDefinition: (node) => reportPrivacy(context, node),
			PropertyDefinition: (node) => reportPrivacy(context, node),
			AccessorProperty: (node) => reportPrivacy(context, node),
			TSAbstractMethodDefinition: (node) => reportPrivacy(context, node),
			TSAbstractPropertyDefinition: (node) => reportPrivacy(context, node),
			TSAbstractAccessorProperty: (node) => reportPrivacy(context, node),
		}
	},
}

/** Ban a centralized declaration that no export reaches. */
export const HIDDEN_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow an unexported declaration in a centralized module.',
		},
		messages: {
			hidden:
				'Export this declaration or fold it into its caller; a centralized module hides nothing.',
		},
	},
	create(context) {
		return {
			ClassDeclaration: (node) => reportHidden(context, node),
			FunctionDeclaration: (node) => reportHidden(context, node),
			TSDeclareFunction: (node) => reportHidden(context, node),
			TSEnumDeclaration: (node) => reportHidden(context, node),
			TSInterfaceDeclaration: (node) => reportHidden(context, node),
			TSModuleDeclaration: (node) => reportHidden(context, node),
			TSTypeAliasDeclaration: (node) => reportHidden(context, node),
			VariableDeclaration: (node) => reportHidden(context, node),
		}
	},
}

/** Ban a type declaration outside its module's types.ts. */
export const TYPE_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow an interface, type alias, enum, or namespace outside types.ts.',
		},
		messages: {
			type: 'Move this declaration to the module types.ts file, which holds every reusable type.',
		},
	},
	create(context) {
		return {
			TSEnumDeclaration: (node) => reportType(context, node),
			TSInterfaceDeclaration: (node) => reportType(context, node),
			TSModuleDeclaration: (node) => reportType(context, node),
			TSTypeAliasDeclaration: (node) => reportType(context, node),
		}
	},
}

/** Ban a class outside the implementation file that names it. */
export const CLASS_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow a class outside errors.ts or the file named for it.',
		},
		messages: {
			class: 'Move this class to a PascalCase implementation file named for it, or to errors.ts.',
		},
	},
	create(context) {
		return {
			ClassDeclaration: (node) => reportClass(context, node),
		}
	},
}

/** Ban module data outside a data-kind file. */
export const DATA_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow a module-scope value declaration outside a data-kind file.',
		},
		messages: {
			data: 'Move this module data to constants.ts or another data-kind file.',
		},
	},
	create(context) {
		return {
			VariableDeclaration: (node) => reportData(context, node),
		}
	},
}

/** Ban module function syntax outside a function-kind file. */
export const FUNCTION_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow module-scope function syntax outside a function-kind file or a registered function domain.',
		},
		messages: {
			function:
				'Move this function to a function-kind file or a registered function-domain module; only a directly passed callback and a directly returned function may sit in module data.',
		},
	},
	create(context) {
		return {
			ArrowFunctionExpression: (node) => reportFunction(context, node),
			FunctionDeclaration: (node) => reportFunction(context, node),
			FunctionExpression: (node) => reportFunction(context, node),
			TSDeclareFunction: (node) => reportFunction(context, node),
		}
	},
}

/** Ban a constants.ts declaration that is mutable, misnamed, or a bare collection. */
export const CONSTANT_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a non-const, non-UPPER_SNAKE_CASE, or bare-collection declaration in constants.ts.',
		},
		messages: {
			mutable: 'Declare every constants.ts binding with const.',
			naming: 'Name every constants.ts declaration in UPPER_SNAKE_CASE.',
			collection: 'Freeze this collection through a call; constants.ts holds no bare literal.',
		},
	},
	create(context) {
		return {
			VariableDeclaration: (node) => reportConstant(context, node),
		}
	},
}

/** Ban a parsers.ts function whose name lacks the parse prefix. */
export const PARSER_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow a parsers.ts function whose name does not start with parse.',
		},
		messages: {
			parser:
				'Name this parsers.ts function with the parse prefix, or move it to its own kind file.',
		},
	},
	create(context) {
		return {
			FunctionDeclaration: (node) => reportParser(context, node),
			TSDeclareFunction: (node) => reportParser(context, node),
			VariableDeclaration: (node) => reportParser(context, node),
		}
	},
}

/** Ban a factories.ts function whose name lacks the create prefix. */
export const FACTORY_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow a factories.ts function whose name does not start with create.',
		},
		messages: {
			factory:
				'Name this factories.ts function with the create prefix, or move it to its own kind file.',
		},
	},
	create(context) {
		return {
			FunctionDeclaration: (node) => reportFactory(context, node),
			TSDeclareFunction: (node) => reportFactory(context, node),
			VariableDeclaration: (node) => reportFactory(context, node),
		}
	},
}

/** Ban a malformed module in a registered function domain, and a file named for one. */
export const DOMAIN_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a registered function domain taken as a source file, and a domain module that is not one exported function named for its file.',
		},
		messages: {
			file: 'Make this registered function domain a folder rather than a source file.',
			module:
				'Give this registered function module imports and one exported function named for its file.',
		},
	},
	create(context) {
		return {
			Program: (node) => reportDomain(context, node),
		}
	},
}

/** Ban host-specific line-ending handling. */
export const ENDING_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow reading the host line ending and trimming an arrived payload before splitting it.',
		},
		messages: {
			split: 'Split arrived text on the line-ending pattern, then trim each line.',
			terminator: 'Emit a line feed rather than the host line ending.',
		},
	},
	create(context) {
		return {
			CallExpression: (node) => reportEnding(context, node),
			MemberExpression: (node) => reportEnding(context, node),
			ImportDeclaration: (node) => reportEndingImport(context, node),
		}
	},
}

/** The workspace Oxlint plugin. */
export default {
	meta: { name: 'policy' },
	rules: {
		'no-mocking': MOCKING_RULE,
		'no-keyword-privacy': PRIVACY_RULE,
		'no-nested-functions': NESTED_RULE,
		'no-hidden-declaration': HIDDEN_RULE,
		'no-misplaced-type': TYPE_RULE,
		'no-misplaced-class': CLASS_RULE,
		'no-misplaced-data': DATA_RULE,
		'no-misplaced-function': FUNCTION_RULE,
		'no-malformed-constant': CONSTANT_RULE,
		'no-misnamed-parser': PARSER_RULE,
		'no-misnamed-factory': FACTORY_RULE,
		'no-malformed-domain': DOMAIN_RULE,
		'no-host-line-endings': ENDING_RULE,
	},
}
