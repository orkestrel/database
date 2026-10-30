/** Describes the syntax-node fields supplied to every policy visitor. */
export interface PolicyNode {
	readonly type: string
	readonly range: [number, number]
}

/** Describes the expression fields the policy rules inspect. */
export interface PolicyExpression extends PolicyNode {
	readonly parent?: PolicyExpression | null
	readonly name?: unknown
	readonly value?: unknown
	readonly key?: PolicyExpression
	readonly id?: PolicyExpression | null
	readonly method?: boolean
	readonly kind?:
		| 'const'
		| 'get'
		| 'global'
		| 'init'
		| 'let'
		| 'module'
		| 'namespace'
		| 'set'
		| 'var'
	readonly expression?: boolean
	readonly readonly?: boolean
	readonly test?: PolicyExpression
	readonly alternate?: PolicyExpression | null
	readonly object?: PolicyExpression
	readonly property?: PolicyExpression
	readonly computed?: boolean
	readonly callee?: PolicyExpression
	readonly argument?: PolicyExpression | null
	readonly arguments?: readonly PolicyExpression[]
	readonly elements?: ReadonlyArray<PolicyExpression | null>
	readonly body?: PolicyExpression | readonly PolicyExpression[]
	readonly quasis?: readonly PolicyExpression[]
	readonly expressions?: readonly PolicyExpression[]
	readonly accessibility?: 'private' | 'protected' | 'public' | null
	readonly declare?: boolean
	readonly declaration?: PolicyExpression
	readonly declarations?: readonly PolicyExpression[]
	readonly init?: PolicyExpression | null
	readonly source?: PolicyExpression | null
	readonly specifiers?: readonly PolicyExpression[]
	readonly imported?: PolicyExpression
	readonly exported?: PolicyExpression
}

/** Pairs a name-form kind file's name pattern with the message id a misnamed export reports. */
export interface PolicyNameForm {
	readonly pattern: RegExp
	readonly messageId: string
}

/** Pairs one declared module function with the name a prefix rule reads. */
export interface PolicyBinding {
	readonly node: PolicyExpression
	readonly name: string | undefined
}

/** Describes one comment the comment rules read out of a linted file. */
export interface PolicyComment extends PolicyNode {
	readonly type: 'Block' | 'Line' | 'Shebang'
	readonly value: string
}

/** Describes one reference the scope manager records to a declared variable. */
export interface PolicyReference {
	readonly identifier: PolicyNode
	readonly init?: boolean
	isWrite(): boolean
}

/** Describes one variable the scope manager records for a declaration. */
export interface PolicyVariable {
	readonly identifiers: readonly PolicyNode[]
	readonly references: readonly PolicyReference[]
}

/** Lists the Oxlint source-text operations the comment rules read. */
export interface PolicySourceCode {
	readonly text: string
	getAllComments(): readonly PolicyComment[]
}

/** Adds the Oxlint scope operation the binding rule reads. */
export interface PolicyScopeCode extends PolicySourceCode {
	getDeclaredVariables(node: PolicyNode): readonly PolicyVariable[]
}

/** Pairs one doc block with the declared name its first sentence must not repeat. */
export interface PolicyDoc {
	readonly comment: PolicyComment
	readonly name: string | undefined
}

/** Describes one banned term, the prose it matches, and the replacement its row names. */
export interface PolicyTerm {
	readonly term: string
	readonly pattern: RegExp
	readonly replacement: string
}

/** Pairs one banned-term match with the offset it starts at. */
export interface PolicyHit {
	readonly term: PolicyTerm
	readonly index: number
}

/** Describes one diagnostic a policy rule emits. */
export interface PolicyDiagnostic {
	readonly node: PolicyNode
	readonly messageId: string
	readonly data?: Readonly<Record<string, string>>
}

/** Lists the Oxlint context operations the policy rules use. */
export interface PolicyContext {
	readonly filename: string
	/** Names the directory Oxlint resolves `filename` against. */
	readonly cwd: string
	readonly sourceCode: PolicyScopeCode
	report(diagnostic: PolicyDiagnostic): void
}

/** Describes the rule documentation fields supplied to Oxlint. */
export interface PolicyDocs {
	readonly [key: string]: unknown
	readonly description: string
}

/** Describes the rule metadata fields supplied to Oxlint. */
export interface PolicyMeta {
	readonly type: 'problem'
	readonly docs: PolicyDocs
	readonly messages: Readonly<Record<string, string>>
}

/** Lists the Oxlint visitor entries the policy rules use. */
export interface PolicyVisitor {
	readonly [key: string]: ((node: PolicyNode) => void) | undefined
	readonly Program?: (node: PolicyNode) => void
	readonly CallExpression?: (node: PolicyNode) => void
	readonly ClassDeclaration?: (node: PolicyNode) => void
	readonly FunctionDeclaration?: (node: PolicyNode) => void
	readonly FunctionExpression?: (node: PolicyNode) => void
	readonly ArrowFunctionExpression?: (node: PolicyNode) => void
	readonly ImportDeclaration?: (node: PolicyNode) => void
	readonly ImportExpression?: (node: PolicyNode) => void
	readonly ExportNamedDeclaration?: (node: PolicyNode) => void
	readonly ExportAllDeclaration?: (node: PolicyNode) => void
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
	readonly TSPropertySignature?: (node: PolicyNode) => void
	readonly TSTypeAliasDeclaration?: (node: PolicyNode) => void
	readonly VariableDeclaration?: (node: PolicyNode) => void
}

/** Describes the complete behavior one policy rule exposes. */
export interface PolicyRuleInterface {
	readonly meta: PolicyMeta
	create(context: PolicyContext): PolicyVisitor
}

/** Lists every centralized module the architecture kind table names. */
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
	'plugins.ts',
	'relations.ts',
	'routes.ts',
	'schemas.ts',
	'seeders.ts',
	'shapers.ts',
	'templates.ts',
	'types.ts',
	'validators.ts',
])

/** Lists the exhaustive centralized-file set that permits module functions. */
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
	'plugins.ts',
	'relations.ts',
	'schemas.ts',
	'seeders.ts',
	'shapers.ts',
	'validators.ts',
])

/** Lists the centralized files that permit module data by declaration syntax. */
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
 * Lists the files excluded from the module-data rule because their namespace values hold helper
 * behavior. This exclusion also permits unrelated module data such as `export const RETRIES = 3`.
 */
export const DATA_EXEMPT_FILES: readonly string[] = Object.freeze(['helpers.ts'])

/** Lists the fleet-registered folders whose direct modules each contain one named function. */
export const FUNCTION_DOMAIN_FOLDERS: readonly string[] = Object.freeze([
	'app/browser/composables',
	'app/vue/composables',
	'src/server/execution',
])

/** Lists the published destinations a Vue relative import may reach before independent restrictions. */
export const VUE_SOURCE_ROOTS: readonly string[] = Object.freeze([
	'src/core',
	'src/browser',
	'src/vue',
])

/** Lists the additional private destinations an application Vue relative import may reach. */
export const VUE_APPLICATION_ROOTS: readonly string[] = Object.freeze([
	...VUE_SOURCE_ROOTS,
	'app/core',
	'app/browser',
	'app/vue',
])

/** Lists the registered function-domain names no source file may take as its stem. */
export const FUNCTION_DOMAIN_NAMES: readonly string[] = Object.freeze(
	FUNCTION_DOMAIN_FOLDERS.map((folder) => folder.slice(folder.lastIndexOf('/') + 1)),
)

/** Lists every ambient declaration suffix the placement and line-ending rules leave uninspected. */
export const POLICY_AMBIENT_SUFFIXES: readonly string[] = Object.freeze([
	'.d.cts',
	'.d.mts',
	'.d.ts',
])

/** Lists the TypeScript source extensions whose declaration syntax the placement rules read. */
export const POLICY_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
	'cts',
	'mts',
	'ts',
	'tsx',
])

/**
 * Matches the lint populations the placement rules run over, as the Oxlint configuration declares
 * them.
 */
export const POLICY_PLACEMENT_GLOBS: readonly string[] = Object.freeze([
	`app/**/*.{${POLICY_SOURCE_EXTENSIONS.join(',')}}`,
	`src/**/*.{${POLICY_SOURCE_EXTENSIONS.join(',')}}`,
])

/**
 * Matches the lint population the line-ending rule runs over, as the Oxlint configuration declares
 * it.
 */
export const POLICY_ENDING_GLOBS: readonly string[] = Object.freeze([
	'app/**/*.ts',
	'configs/**/*.ts',
	'src/**/*.ts',
])

/** Lists every source extension the nested-function rule reads. */
export const POLICY_CODE_EXTENSIONS: readonly string[] = Object.freeze([
	'cjs',
	'cts',
	'js',
	'jsx',
	'mjs',
	'mts',
	'ts',
	'tsx',
	'vue',
])

/**
 * Matches the lint population the nested-function rule runs over, as the Oxlint configuration
 * declares it.
 */
export const POLICY_NESTED_GLOBS: readonly string[] = Object.freeze(
	['src', 'app', 'tests', 'configs'].map(
		(root) => `${root}/**/*.{${POLICY_CODE_EXTENSIONS.join(',')}}`,
	),
)

/**
 * Matches the lint population the test-helper rule runs over, as the Oxlint configuration declares
 * it: the mirrored test files and the root setup proofs.
 */
export const POLICY_TEST_GLOBS: readonly string[] = Object.freeze([
	'tests/src/**/*.test.ts',
	'tests/app/**/*.test.ts',
	'tests/setup*.test.ts',
])

/**
 * Matches the lint population the skill-script rules run over, as the Oxlint configuration declares
 * it.
 */
export const POLICY_SCRIPT_GLOBS: readonly string[] = Object.freeze([
	'.agents/skills/*/scripts/*.ts',
])

/** Matches the workspace-relative path of a skill script, the file shape the script rule reads. */
export const POLICY_SCRIPT_PATTERN = /^\.agents\/skills\/[^/]+\/scripts\/[^/]+\.ts$/u

/** Holds the one entry guard a skill script runs `main` under, as its source text reads. */
export const POLICY_ENTRY_GUARD =
	'process.argv[1] !== undefined && realpathSync(process.argv[1]) === import.meta.filename'

/** Lists every statement type that declares a name at module scope. */
export const POLICY_DECLARATION_TYPES: readonly string[] = Object.freeze([
	'ClassDeclaration',
	'FunctionDeclaration',
	'TSDeclareFunction',
	'TSEnumDeclaration',
	'TSInterfaceDeclaration',
	'TSModuleDeclaration',
	'TSTypeAliasDeclaration',
	'VariableDeclaration',
])

/**
 * Lists the type nodes a property signature's search for its owning declaration never crosses,
 * because a parameter, call, or construct signature beyond one is an inline type.
 */
export const POLICY_INLINE_TYPES: readonly string[] = Object.freeze([
	'TSCallSignatureDeclaration',
	'TSConstructSignatureDeclaration',
	'TSConstructorType',
	'TSFunctionType',
	'TSMethodSignature',
])

/**
 * Matches the file name shape an implementation file takes, holding the class that matches its
 * stem.
 */
export const POLICY_CLASS_PATTERN = /^[A-Z][A-Za-z0-9]*\.ts$/u

/** Matches the name shape every constants.ts declaration takes. */
export const POLICY_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/u

/** Matches the file name shape a direct module of a registered function domain takes. */
export const POLICY_DOMAIN_PATTERN = /^[a-z][A-Za-z0-9]*\.ts$/u

/** Matches a first word that reads as a third-person verb. */
export const POLICY_VOICE_PATTERN = /^[A-Z][a-z]*s$/u

/** Matches the boundary a description paragraph's first sentence ends at. */
export const POLICY_SENTENCE_PATTERN = /\.\s|\.$/u

/** Matches the continuation marker a doc block repeats on each line after its opening. */
export const POLICY_MARKER_PATTERN = /^\s*\*\s?/u

/** Matches one line break in any host's form. */
export const POLICY_BREAK_PATTERN = /\r\n|\r|\n/u

/** Matches a fenced code block, opening run through closing run. */
export const POLICY_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gmu

/** Matches an inline code span, including one a line break runs through. */
export const POLICY_SPAN_PATTERN = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)/gu

/** Matches a link or inherited-documentation tag, whose target is a symbol rather than prose. */
export const POLICY_TAG_PATTERN = /\{@(?:linkcode|linkplain|link|inheritDoc)\b[^}]*\}/giu

/** Matches a URL, whose segments are an address rather than prose. */
export const POLICY_URL_PATTERN = /https?:\/\/\S+/gu

/** Maps each name-form kind file to the form every function it exports must take. */
export const POLICY_NAME_FORMS: Readonly<Record<string, PolicyNameForm>> = Object.freeze({
	'parsers.ts': Object.freeze({ pattern: /^parse/u, messageId: 'parser' }),
	'factories.ts': Object.freeze({ pattern: /^create/u, messageId: 'factory' }),
	'plugins.ts': Object.freeze({
		pattern: /^create[A-Z][A-Za-z0-9]*Plugins?$/u,
		messageId: 'plugin',
	}),
})

/**
 * Lists the words ending in `s` that open a sentence without being a third-person verb.
 *
 * @remarks
 * The voice rule reads a first word rather than a parsed verb, so a demonstrative, a pronoun, an
 * adverb, and a singular noun ending in `s` each need naming here to stay refused.
 */
export const POLICY_VOICE_STOPWORDS: readonly string[] = Object.freeze([
	'Access',
	'Across',
	'Address',
	'Alias',
	'Always',
	'Analysis',
	'Assess',
	'Basis',
	'Bias',
	'Bus',
	'Business',
	'Canvas',
	'Chaos',
	'Class',
	'Compress',
	'Cross',
	'Discuss',
	'Dismiss',
	'Express',
	'Focus',
	'Gas',
	'Guess',
	'Harness',
	'Its',
	'Lens',
	'Miss',
	'Numerous',
	'Pass',
	'Perhaps',
	'Plus',
	'Press',
	'Previous',
	'Process',
	'Progress',
	'Series',
	'Sometimes',
	'Status',
	'Success',
	'This',
	'Thus',
	'Unless',
	'Various',
	'Was',
	'Whereas',
	'Witness',
	'Yes',
])

/**
 * Lists every substitution-table row whose ban is unconditional, beside its replacement.
 *
 * @remarks
 * Each pattern is case-insensitive, word-bounded, and global, and carries the inflections its row
 * reaches.
 */
export const POLICY_BANNED_TERMS: readonly PolicyTerm[] = Object.freeze([
	{ term: 'should', pattern: /\bshould\b/giu, replacement: 'must, can, might, or the imperative' },
	{ term: 'simply', pattern: /\bsimply\b/giu, replacement: 'delete' },
	{ term: 'easy', pattern: /\beas(?:y|ier|iest|ily)\b/giu, replacement: 'delete' },
	{ term: 'just', pattern: /\bjust\b/giu, replacement: 'delete' },
	{ term: 'currently', pattern: /\bcurrently\b/giu, replacement: 'delete, or give the date' },
	{ term: 'utilize', pattern: /\butiliz(?:e|es|ed|ing|ation)\b/giu, replacement: 'use' },
	{ term: 'leverage', pattern: /\bleverag(?:e|es|ed|ing)\b/giu, replacement: 'use' },
	{ term: 'via', pattern: /\bvia\b/giu, replacement: 'through, by using' },
	{ term: 'in order to', pattern: /\bin order to\b/giu, replacement: 'to' },
	{ term: 'e.g.', pattern: /\be\.g\./giu, replacement: 'for example' },
	{ term: 'i.e.', pattern: /\bi\.e\./giu, replacement: 'that is' },
	{ term: 'etc.', pattern: /\betc\./giu, replacement: 'bound the list, or recast the sentence' },
	{ term: 'performant', pattern: /\bperformant\b/giu, replacement: 'the measured property' },
	{ term: 'robust', pattern: /\brobust(?:ly|ness)?\b/giu, replacement: 'the measured property' },
	{ term: 'allows you to', pattern: /\ballows you to\b/giu, replacement: 'lets you' },
	{ term: 'and/or', pattern: /\band\/or\b/giu, replacement: 'and, or, or both' },
	{ term: 'please', pattern: /\bplease\b/giu, replacement: 'delete' },
	{ term: 'sanity check', pattern: /\bsanity[ -]check/giu, replacement: 'quick check' },
	{ term: 'dummy', pattern: /\bdumm(?:y|ies)\b/giu, replacement: 'placeholder' },
	{ term: 'blacklist', pattern: /\bblacklist(?:s|ed|ing)?\b/giu, replacement: 'denylist' },
	{ term: 'whitelist', pattern: /\bwhitelist(?:s|ed|ing)?\b/giu, replacement: 'allowlist' },
	{ term: 'slave', pattern: /\bslave\b/giu, replacement: 'replica' },
])

/**
 * Lists every substitution-table row a reader rules by sense, which no pattern matches.
 *
 * @remarks
 * Each row carries a permitted sense: a date value, a version value, a causal clause, the name a
 * replication topology takes, a comparative or spatial relation, and a literal engineering term such
 * as a string escape, a loop `break`, or a request payload. The currency check proves each row is
 * registered here.
 */
export const POLICY_JUDGED_TERMS: readonly string[] = Object.freeze([
	'now',
	'new',
	'latest',
	'once',
	'since',
	'above',
	'below',
	'master',
	'hostile',
	'adversarial',
	'attack',
	'break',
	'forge',
	'bypass',
	'poison',
	'escape',
	'exploit',
	'payload',
])

/** Returns the file name a policy rule keys on, read from either host separator. */
export function pathToPolicyFile(filename: string): string {
	const normalized = filename.replaceAll('\\', '/')
	return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/** Returns the folder path a policy rule keys on, read from either host separator. */
export function pathToPolicyFolder(filename: string): string {
	const normalized = filename.replaceAll('\\', '/')
	const boundary = normalized.lastIndexOf('/')
	return boundary === -1 ? '' : normalized.slice(0, boundary)
}

/**
 * Returns the workspace-relative path when the file sits under the directory the linter resolved it
 * against, else the path as given. The linter resolves each file against its own directory, the
 * workspace root under the `lint` scripts and its package directory under `RuleTester`, so a file
 * outside that directory keeps its path and matches no registered domain folder, because a
 * registered folder is workspace-relative. For a workspace at the filesystem root the prefix is the
 * separator alone. A drive-letter case difference between the two arguments is not folded.
 */
export function pathToPolicyRelative(filename: string, cwd: string): string {
	const normalizedFile = filename.replaceAll('\\', '/')
	const normalizedCwd = cwd.replaceAll('\\', '/').replace(/\/+$/u, '')
	const prefix = `${normalizedCwd}/`
	return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : normalizedFile
}

/**
 * Computes a lexical workspace-relative destination from an absolute Vue importer and its cwd.
 * Refuses unclassifiable locations, noncanonical relative segments, and traversal above the
 * workspace. Query and fragment text is excluded from the path without decoding it; callers retain
 * the original specifier for independent restrictions. No filesystem or module resolution occurs.
 */
export function computePolicyTarget(
	filename: string,
	cwd: string,
	specifier: string,
): string | undefined {
	const relative = pathToPolicyRelative(filename, cwd)
	const location = relative.split('/')
	if (
		!/^(?:\/|[A-Za-z]:\/)/u.test(cwd.replaceAll('\\', '/')) ||
		/(?:^|\/)\.{1,2}(?:\/|$)/u.test(cwd.replaceAll('\\', '/')) ||
		relative === filename.replaceAll('\\', '/') ||
		location.length < 3 ||
		(location[0] !== 'src' && location[0] !== 'app') ||
		location[1] !== 'vue' ||
		location.some((part) => part === '' || part === '.' || part === '..')
	) {
		return undefined
	}
	const path = specifier.split(/[?#]/u)[0] ?? ''
	if (!/^\.{1,2}(?:\/|$)/u.test(path) || path.includes('\\') || path.includes('//')) {
		return undefined
	}
	const parts = path.replace(/\/$/u, '').split('/')
	const first = parts.findIndex((part) => part !== '.' && part !== '..')
	const boundary = first === -1 ? parts.length : first
	const leading = parts.slice(0, boundary)
	const parents = leading.filter((part) => part === '..').length
	const remaining = parts.slice(boundary)
	const directory = pathToPolicyFolder(relative).split('/')
	if (
		(parents === 0 && leading.length !== 1) ||
		(parents !== 0 && parents !== leading.length) ||
		parents > directory.length ||
		remaining.some((part) => part === '' || part === '.' || part === '..')
	) {
		return undefined
	}
	return [...directory.slice(0, directory.length - parents), ...remaining].join('/')
}

/** Reports a literal relative import or re-export whose actual destination leaves its Vue boundary. */
export function reportVueImport(context: PolicyContext, node: PolicyExpression): void {
	const source = node.source
	if (source?.type !== 'Literal' || typeof source.value !== 'string') return
	if (!/^\.{1,2}(?:[/?#]|$)/u.test(source.value)) return
	const target = computePolicyTarget(context.filename, context.cwd, source.value)
	const roots = pathToPolicyRelative(context.filename, context.cwd).startsWith('app/vue/')
		? VUE_APPLICATION_ROOTS
		: VUE_SOURCE_ROOTS
	if (
		target !== undefined &&
		roots.some((root) => target === root || target.startsWith(root + '/'))
	)
		return
	context.report({ node, messageId: 'vue' })
}

/** Returns the extensionless stem of one policy file name. */
export function fileToPolicyStem(file: string): string {
	const boundary = file.lastIndexOf('.')
	return boundary <= 0 ? file : file.slice(0, boundary)
}

/** Reports whether a path names an ambient declaration file, which no policy rule inspects. */
export function isPolicyAmbient(filename: string): boolean {
	const file = pathToPolicyFile(filename)
	return POLICY_AMBIENT_SUFFIXES.some((suffix) => file.endsWith(suffix))
}

/**
 * Reports whether a path is a direct module of a fleet-registered function domain.
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

/** Returns the identifier name a node carries, or `undefined` for any other syntax. */
export function identifierToPolicyName(
	node: PolicyExpression | null | undefined,
): string | undefined {
	if (node === undefined || node === null || node.type !== 'Identifier') return undefined
	return typeof node.name === 'string' ? node.name : undefined
}

/** Returns the literal text a node carries, through a single-quasi template literal. */
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

/** Returns the single body expression a node holds, excluding a statement list. */
export function expressionToPolicyBody(node: PolicyExpression): PolicyExpression | undefined {
	const body = node.body
	if (body === undefined) return undefined
	return 'type' in body ? body : undefined
}

/** Returns the top-level statements a program holds. */
export function programToPolicyStatements(node: PolicyExpression): readonly PolicyExpression[] {
	const body = node.body
	if (body === undefined || 'type' in body) return []
	return body
}

/** Returns the declaration a top-level statement holds, through either export form. */
export function statementToPolicyDeclaration(node: PolicyExpression): PolicyExpression | undefined {
	if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
		return node.declaration
	}
	return node
}

/** Reports whether a statement sits at module scope, through either export form. */
export function isPolicyTop(node: PolicyExpression): boolean {
	const parent = node.parent
	if (parent === undefined || parent === null) return false
	if (parent.type === 'Program') return true
	return (
		(parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration') &&
		parent.parent?.type === 'Program'
	)
}

/** Reports whether a policy expression is runtime function syntax. */
export function isPolicyFunction(node: PolicyExpression): boolean {
	return (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	)
}

/** Reports whether a node declares a module function, including a signature without a body. */
export function isPolicyDeclaredFunction(node: PolicyExpression): boolean {
	return node.type === 'FunctionDeclaration' || node.type === 'TSDeclareFunction'
}

/** Returns a policy function's position through parentheses, object values, and array elements. */
export function functionToPolicyPosition(node: PolicyExpression): PolicyExpression {
	const parent = node.parent
	if (parent === undefined || parent === null) return node
	if (parent.type === 'ParenthesizedExpression') return functionToPolicyPosition(parent)
	if (
		parent.type === 'Property' &&
		parent.kind === 'init' &&
		parent.method === false &&
		parent.computed !== true &&
		parent.value === node &&
		parent.parent?.type === 'ObjectExpression'
	) {
		return functionToPolicyPosition(parent.parent)
	}
	if (parent.type === 'ArrayExpression' && parent.elements?.includes(node) === true) {
		return functionToPolicyPosition(parent)
	}
	return node
}

/** Returns a policy node's position through its enclosing parentheses alone. */
export function nodeToPolicyOuter(node: PolicyExpression): PolicyExpression {
	const parent = node.parent
	return parent?.type === 'ParenthesizedExpression' ? nodeToPolicyOuter(parent) : node
}

/** Reports whether a literal position is admitted as an argument, return, or arrow body. */
export function isPolicyPosition(position: PolicyExpression): boolean {
	const parent = position.parent
	return (
		((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') &&
			parent.arguments?.includes(position) === true) ||
		(parent?.type === 'ReturnStatement' && parent.argument === position) ||
		(parent?.type === 'ArrowFunctionExpression' && parent.body === position)
	)
}

/** Reports whether a function expression is passed as an argument through its literal position. */
export function isPolicyCallback(node: PolicyExpression): boolean {
	if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') return false
	const position = functionToPolicyPosition(node)
	const parent = position.parent
	return (
		(parent?.type === 'CallExpression' || parent?.type === 'NewExpression') &&
		isPolicyPosition(position)
	)
}

/** Reports whether a function expression is returned as a result through its literal position. */
export function isPolicyResult(node: PolicyExpression): boolean {
	if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') return false
	const position = functionToPolicyPosition(node)
	const parent = position.parent
	return (
		(parent?.type === 'ReturnStatement' || parent?.type === 'ArrowFunctionExpression') &&
		isPolicyPosition(position)
	)
}

/** Reports whether an Oxlint function expression represents method syntax. */
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

/**
 * Reports whether a policy function sits inside another function before any class-expression
 * boundary.
 *
 * @param node - The function node whose ancestors are read.
 * @param method - If `true`, a method body was already crossed on the way up; if `false`, none was.
 *   Default: `false`.
 * @returns True if a non-method function, or a method inside a class declaration, encloses the node
 *   before a class expression does; false otherwise.
 */
export function hasPolicyFunctionAncestor(node: PolicyExpression, method = false): boolean {
	const parent = node.parent
	if (parent === undefined || parent === null) return method
	if (parent.type === 'ClassExpression') return false
	if (parent.type === 'ClassDeclaration' && method) return true
	if (isPolicyFunction(parent)) {
		return !isPolicyMethod(parent) || hasPolicyFunctionAncestor(parent, true)
	}
	return hasPolicyFunctionAncestor(parent, method)
}

/**
 * Returns the module-scope statement that owns a policy function, or `undefined` when none does.
 *
 * A class declaration or class expression on the way up ends the search, because the placement law
 * reads module regions rather than class members.
 */
export function functionToPolicyRegion(node: PolicyExpression): PolicyExpression | undefined {
	const parent = node.parent
	if (parent === undefined || parent === null) return undefined
	if (parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') return undefined
	if (parent.type === 'Program') return statementToPolicyDeclaration(node)
	return functionToPolicyRegion(parent)
}

/** Lists every module function a top-level statement declares, paired with its declared name. */
export function statementToPolicyBindings(node: PolicyExpression): readonly PolicyBinding[] {
	if (isPolicyDeclaredFunction(node)) {
		return [{ node, name: identifierToPolicyName(node.id) }]
	}
	if (node.type !== 'VariableDeclaration') return []
	// The iterator consumes one declarator at a time and reads a hole as an `undefined` declarator,
	// as a `for…of` over the list would.
	return Iterator.from(node.declarations ?? [])
		.flatMap((declarator) => {
			const init = declarator.init
			if (init === undefined || init === null || !isPolicyFunction(init)) return []
			const name = identifierToPolicyName(declarator.id)
			return name === undefined ? [] : [{ node: declarator, name }]
		})
		.toArray()
}

/** Reports whether a call trims a whole payload before splitting it on a line feed. */
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

/** Reports whether an expression reads the host line ending from a binding named os. */
export function isPolicyTerminator(node: PolicyExpression): boolean {
	return (
		node.type === 'MemberExpression' &&
		node.computed !== true &&
		identifierToPolicyName(node.property) === 'EOL' &&
		identifierToPolicyName(node.object) === 'os'
	)
}

/** Reports whether an import declaration takes the EOL member from the host module. */
export function importsPolicyTerminator(node: PolicyExpression): boolean {
	const specifier = expressionToPolicyText(node.source)
	if (specifier !== 'node:os' && specifier !== 'os') return false
	return (node.specifiers ?? []).some(
		(element) =>
			element.type === 'ImportSpecifier' && identifierToPolicyName(element.imported) === 'EOL',
	)
}

/**
 * Blanks every character of a matched region, holding its length and its line breaks.
 *
 * @param text - The matched region to blank.
 * @returns The region with each character outside a line break replaced by a space.
 */
export function blankPolicyText(text: string): string {
	return text.replace(/[^\n]/gu, ' ')
}

/**
 * Blanks the regions of a text whose content is code, an address, or a symbol rather than prose.
 *
 * @remarks
 * A fenced block, an inline code span a line break runs through, a link tag, and a URL each carry
 * tokens a reader is meant to copy rather than read, so a banned term inside one is not prose. Each
 * region is blanked in place, so every offset the caller reports stays the offset in the original
 * text.
 *
 * @param text - The prose to strip, with any continuation marker already removed.
 * @returns The same text with every code, tag, and address region replaced by spaces.
 */
export function stripPolicyCode(text: string): string {
	const fenced = text.replace(POLICY_FENCE_PATTERN, blankPolicyText)
	const spanned = fenced.replace(POLICY_SPAN_PATTERN, blankPolicyText)
	const tagged = spanned.replace(POLICY_TAG_PATTERN, blankPolicyText)
	return tagged.replace(POLICY_URL_PATTERN, blankPolicyText)
}

/**
 * Reads every banned term a stripped text carries, in offset order.
 *
 * @param text - The prose to read, already stripped of its code regions.
 * @returns One hit per match, each naming its row and the offset the match starts at.
 */
export function textToPolicyHits(text: string): readonly PolicyHit[] {
	return POLICY_BANNED_TERMS.flatMap((term) =>
		[...text.matchAll(term.pattern)].map((match) => ({ term, index: match.index })),
	).sort((left, right) => left.index - right.index)
}

/**
 * Reads one doc block's description paragraph, which ends at its first block tag.
 *
 * @param comment - The doc block to read.
 * @returns The description with continuation markers removed and whitespace collapsed.
 */
export function commentToPolicyParagraph(comment: PolicyComment): string {
	const lines = comment.value
		.split(POLICY_BREAK_PATTERN)
		.map((line) => line.replace(POLICY_MARKER_PATTERN, ''))
	const end = lines.findIndex((text) => text.trimStart().startsWith('@'))
	return lines
		.slice(0, end === -1 ? lines.length : end)
		.join(' ')
		.replace(/\s+/gu, ' ')
		.trim()
}

/**
 * Reads the opening word of a description paragraph, punctuation removed.
 *
 * @param paragraph - The collapsed description paragraph.
 * @returns The paragraph's first word reduced to its letters, empty where it has none.
 */
export function paragraphToPolicyOpener(paragraph: string): string {
	const first = paragraph.match(/^\S+/u)?.[0] ?? ''
	return first.replace(/[^A-Za-z]/gu, '')
}

/**
 * Reports whether an opening word reads as a third-person verb.
 *
 * @param word - The opening word to judge.
 * @returns True if the word ends in `s` and names no registered non-verb; false otherwise.
 */
export function isPolicyVoiced(word: string): boolean {
	return POLICY_VOICE_PATTERN.test(word) && !POLICY_VOICE_STOPWORDS.includes(word)
}

/**
 * Reads the doc block written directly above one top-level statement.
 *
 * @remarks
 * A statement takes the last comment that closes before it, and takes it only where that comment is
 * a doc block and nothing but whitespace separates the two. A blank line between them is still
 * whitespace, so the pairing survives one. Every comment is read where a `findLast` would stop at
 * the nearest one.
 *
 * @param statement - The top-level statement to pair.
 * @param comments - Every comment of the linted file, in source order.
 * @param sourceCode - The source-text reader supplying the text between a comment and the statement.
 * @returns The paired doc block, or `undefined` where the statement has none.
 */
export function statementToPolicyDoc(
	statement: PolicyExpression,
	comments: readonly PolicyComment[],
	sourceCode: PolicySourceCode,
): PolicyComment | undefined {
	const start = statement.range[0]
	const previous = Iterator.from(comments)
		.flatMap((comment) => (comment.range[1] <= start ? [comment] : []))
		.toArray()
		.at(-1)
	if (previous === undefined || previous.type !== 'Block') return undefined
	if (!previous.value.startsWith('*')) return undefined
	if (sourceCode.text.slice(previous.range[1], start).trim() !== '') return undefined
	return previous
}

/**
 * Pairs every exported top-level statement with the doc block written directly above it.
 *
 * @param node - The program node whose top-level statements are read.
 * @param sourceCode - The source-text reader supplying the comments and the text between them.
 * @returns One entry per documented export, each naming its block and its declared symbol.
 */
export function programToPolicyDocs(
	node: PolicyExpression,
	sourceCode: PolicySourceCode,
): readonly PolicyDoc[] {
	// The iterator consumes one entry at a time and reads a hole as an `undefined` entry, as a
	// `for…of` over the list would. The comments are read once, and a statement pairs with one only
	// where it is an export.
	const comments = sourceCode.getAllComments()
	return Iterator.from(programToPolicyStatements(node))
		.flatMap((statement) => {
			if (!statement.type.startsWith('Export')) return []
			const comment = statementToPolicyDoc(statement, comments, sourceCode)
			if (comment === undefined) return []
			const declaration = statement.declaration
			return [
				{
					comment,
					name:
						identifierToPolicyName(declaration?.id) ??
						identifierToPolicyName(declaration?.declarations?.[0]?.id),
				},
			]
		})
		.toArray()
}

/** Reports a doc block whose first sentence is not a third-person summary of its own symbol. */
export function reportVoice(context: PolicyContext, doc: PolicyDoc): void {
	const paragraph = commentToPolicyParagraph(doc.comment)
	if (!isPolicyVoiced(paragraphToPolicyOpener(paragraph))) {
		context.report({ node: doc.comment, messageId: 'voice' })
	}
	const name = doc.name
	if (name === undefined) return
	const sentence = paragraph.split(POLICY_SENTENCE_PATTERN)[0] ?? ''
	const repeat = new RegExp(`(?<![\\w$])${name.replaceAll('$', '\\$')}(?![\\w$])`, 'u')
	if (repeat.test(sentence)) {
		context.report({ node: doc.comment, messageId: 'name', data: { name } })
	}
}

/** Reports every voice failure among the doc blocks one program's exports carry. */
export function reportDocs(context: PolicyContext, node: PolicyExpression): void {
	for (const doc of programToPolicyDocs(node, context.sourceCode)) reportVoice(context, doc)
}

/** Reports every banned term one comment's prose carries. */
export function reportTerm(context: PolicyContext, comment: PolicyComment): void {
	const lines = comment.value
		.split(POLICY_BREAK_PATTERN)
		.map((line) => line.replace(POLICY_MARKER_PATTERN, ''))
	for (const hit of textToPolicyHits(stripPolicyCode(lines.join('\n')))) {
		context.report({
			node: comment,
			messageId: 'term',
			data: { term: hit.term.term, replacement: hit.term.replacement },
		})
	}
}

/** Reports every banned term the comments of one linted file carry. */
export function reportComments(context: PolicyContext): void {
	for (const comment of context.sourceCode.getAllComments()) reportTerm(context, comment)
}

/** Reports function syntax nested inside another function body. */
export function reportNested(context: PolicyContext, node: PolicyExpression): void {
	if (!hasPolicyFunctionAncestor(node) || isPolicyCallback(node) || isPolicyResult(node)) {
		return
	}
	if (isPolicyMethod(node)) {
		if (node.parent?.type === 'MethodDefinition') return
		const object = node.parent?.parent
		if (object?.type === 'ObjectExpression') {
			const position = functionToPolicyPosition(object)
			if (isPolicyPosition(position)) return
		}
	}
	context.report({ node, messageId: 'nested' })
}

/** Reports banned calls on the named Vitest and Jest framework objects. */
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

/** Reports TypeScript privacy keywords on class members. */
export function reportPrivacy(context: PolicyContext, node: PolicyExpression): void {
	if (node.accessibility === 'private' || node.accessibility === 'protected') {
		context.report({
			node,
			messageId: 'keyword',
			data: { keyword: node.accessibility },
		})
	}
}

/** Checks whether code writes a declared variable anywhere but in its own declaration. */
export function isPolicyReassigned(variable: PolicyVariable): boolean {
	return variable.references.some(
		(reference) =>
			reference.isWrite() &&
			reference.init !== true &&
			!variable.identifiers.includes(reference.identifier),
	)
}

/**
 * Checks whether a node sits inside a `declare` module, namespace, or global augmentation.
 *
 * @remarks
 * A declaration inside such a block carries no `declare` flag of its own and no value, because the
 * block is the ambient context. A `global` block is ambient wherever it stands.
 */
export function isPolicyInDeclaredModule(node: PolicyExpression): boolean {
	const parent = node.parent
	if (parent === undefined || parent === null) return false
	return (
		(parent.type === 'TSModuleDeclaration' &&
			(parent.declare === true || parent.kind === 'global')) ||
		isPolicyInDeclaredModule(parent)
	)
}

/** Reports a let declaration that prefer-const leaves: one reassigned or declared without a value. */
export function reportLet(context: PolicyContext, node: PolicyExpression): void {
	if (
		node.kind !== 'let' ||
		node.declare === true ||
		isPolicyAmbient(context.filename) ||
		isPolicyInDeclaredModule(node)
	) {
		return
	}
	const head = node.parent?.type === 'ForInStatement' || node.parent?.type === 'ForOfStatement'
	const bare =
		!head &&
		(node.declarations ?? []).some(
			(declarator) => declarator.init === undefined || declarator.init === null,
		)
	if (bare || context.sourceCode.getDeclaredVariables(node).some(isPolicyReassigned)) {
		context.report({ node, messageId: 'let' })
	}
}

/** Reports a centralized declaration that carries no export. */
export function reportHidden(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	if (!CENTRAL_SOURCE_FILES.includes(pathToPolicyFile(context.filename))) return
	if (node.parent?.type !== 'Program') return
	context.report({ node, messageId: 'hidden' })
}

/** Reports a type declaration outside types.ts. */
export function reportType(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyTop(node)) return
	if (pathToPolicyFile(context.filename) === 'types.ts') return
	context.report({ node, messageId: 'type' })
}

/** Reports a class whose file neither names it nor collects errors. */
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

/** Reports module data outside a data-kind file. */
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

/** Reports a module-scope function, class, or function-valued binding a test file declares. */
export function reportTestHelper(context: PolicyContext, node: PolicyExpression): void {
	if (!isPolicyTop(node)) return
	if (node.type !== 'VariableDeclaration') {
		context.report({ node, messageId: 'helper' })
		return
	}
	for (const declarator of node.declarations ?? []) {
		const init = declarator.init
		if (init === undefined || init === null) continue
		if (isPolicyFunction(init) || init.type === 'ClassExpression') {
			context.report({ node: declarator, messageId: 'helper' })
		}
	}
}

/** Reports module function syntax outside a function-kind file. */
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
	const position = nodeToPolicyOuter(node)
	// Module placement admits direct callbacks; a literal member still belongs in a function file.
	if (
		(node.type === 'ArrowFunctionExpression' || node.id === null) &&
		functionToPolicyPosition(node) === position &&
		(isPolicyCallback(node) || isPolicyResult(node))
	) {
		return
	}
	context.report({ node, messageId: 'function' })
}

/** Reports a constants.ts declaration that is mutable, misnamed, or a bare collection. */
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

/**
 * Reports a function in the named kind file whose name breaks that file's form, an export specifier
 * or exported import alias there that publishes a name outside it, and a star re-export there, whose
 * names the form cannot read.
 */
export function reportName(context: PolicyContext, node: PolicyExpression, file: string): void {
	const form = POLICY_NAME_FORMS[file]
	if (form === undefined || pathToPolicyFile(context.filename) !== file) return
	if (node.type === 'ExportAllDeclaration') {
		context.report({ node, messageId: form.messageId })
		return
	}
	if (node.type === 'ExportNamedDeclaration') {
		const alias = node.declaration
		if (alias?.type === 'TSImportEqualsDeclaration') {
			const name = identifierToPolicyName(alias.id)
			if (name === undefined || !form.pattern.test(name)) {
				context.report({ node: alias, messageId: form.messageId })
			}
		}
		for (const specifier of node.specifiers ?? []) {
			const exported = specifier.exported
			const name =
				typeof exported?.name === 'string'
					? exported.name
					: typeof exported?.value === 'string'
						? exported.value
						: undefined
			if (name === undefined || !form.pattern.test(name)) {
				context.report({ node: specifier, messageId: form.messageId })
			}
		}
		return
	}
	if (!isPolicyTop(node)) return
	for (const binding of statementToPolicyBindings(node)) {
		if (binding.name === undefined || !form.pattern.test(binding.name)) {
			context.report({ node: binding.node, messageId: form.messageId })
		}
	}
}

/** Reports a registered function domain taken as a file, or a malformed module inside one. */
export function reportDomain(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	const file = pathToPolicyFile(context.filename)
	if (FUNCTION_DOMAIN_NAMES.includes(fileToPolicyStem(file))) {
		context.report({ node, messageId: 'file' })
	}
	if (!isPolicyDomain(context.filename, context.cwd)) return
	const expected = fileToPolicyStem(file)
	// The iterator consumes one statement at a time and reads a hole as an `undefined` statement, as
	// a `for…of` over the body would. Each statement is judged whole before the next is read.
	const members = Iterator.from(programToPolicyStatements(node))
		.flatMap((statement) => {
			if (statement.type === 'ImportDeclaration') return []
			const declaration = statementToPolicyDeclaration(statement)
			if (declaration === undefined || !isPolicyDeclaredFunction(declaration)) {
				return [{ implementation: false, malformed: true }]
			}
			return [
				{
					implementation: declaration.type === 'FunctionDeclaration',
					malformed:
						statement.type !== 'ExportNamedDeclaration' ||
						identifierToPolicyName(declaration.id) !== expected,
				},
			]
		})
		.toArray()
	const implementations = members.filter(({ implementation }) => implementation).length
	const malformed = members.some((member) => member.malformed)
	if (implementations !== 1 || malformed) context.report({ node, messageId: 'module' })
}

/** Reports source that reads the host line ending or splits arrived text before trimming it. */
export function reportEnding(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	if (isPolicySplit(node)) context.report({ node, messageId: 'split' })
	if (isPolicyTerminator(node)) context.report({ node, messageId: 'terminator' })
}

/** Reports an import that takes the host line ending from the operating-system module. */
export function reportEndingImport(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename)) return
	if (importsPolicyTerminator(node)) context.report({ node, messageId: 'terminator' })
}

/** Reports whether a path is a skill script, the one file shape the script rule reads. */
export function isPolicyScript(filename: string, cwd: string): boolean {
	return POLICY_SCRIPT_PATTERN.test(pathToPolicyRelative(filename, cwd))
}

/** Reports whether a statement is the one entry guard a skill script runs its main under. */
export function isPolicyGuard(statement: PolicyExpression, sourceCode: PolicySourceCode): boolean {
	const test = statement.test
	if (statement.type !== 'IfStatement' || test === undefined) return false
	if (statement.alternate !== undefined && statement.alternate !== null) return false
	const text = sourceCode.text.slice(test.range[0], test.range[1]).replace(/\s+/gu, ' ')
	return text === POLICY_ENTRY_GUARD
}

/** Reports a skill script's top-level statement that is hidden, undocumented, or runs at import. */
export function reportScript(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || !isPolicyScript(context.filename, context.cwd)) return
	const sourceCode = context.sourceCode
	const comments = sourceCode.getAllComments()
	const statements = programToPolicyStatements(node)
	const guard = statements.findIndex((statement) => isPolicyGuard(statement, sourceCode))
	for (const [index, statement] of statements.entries()) {
		if (statement.type === 'ImportDeclaration' || index === guard) continue
		const declaration = statement.declaration
		if (
			statement.type === 'ExportNamedDeclaration' &&
			declaration !== undefined &&
			declaration !== null
		) {
			if (statementToPolicyDoc(statement, comments, sourceCode) === undefined) {
				context.report({ node: statement, messageId: 'doc' })
			}
			continue
		}
		context.report({
			node: statement,
			messageId: POLICY_DECLARATION_TYPES.includes(statement.type) ? 'hidden' : 'entry',
		})
	}
}

/** Reports whether a property signature sits in an interface or in a type alias's object type. */
export function isPolicyOwned(node: PolicyExpression): boolean {
	const parent = node.parent
	if (parent === undefined || parent === null) return false
	if (parent.type === 'TSInterfaceDeclaration' || parent.type === 'TSTypeAliasDeclaration') {
		return true
	}
	if (POLICY_INLINE_TYPES.includes(parent.type)) return false
	return isPolicyOwned(parent)
}

/** Reports a property signature of an interface or type alias that is not readonly. */
export function reportMutable(context: PolicyContext, node: PolicyExpression): void {
	if (isPolicyAmbient(context.filename) || node.readonly === true) return
	if (isPolicyOwned(node)) context.report({ node, messageId: 'mutable' })
}

/** Bans function declarations and assignments inside another function body. */
export const NESTED_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow nested functions except callbacks passed as arguments or returned as results, directly or as members of object or array literals in those positions.',
		},
		messages: {
			nested:
				'Extract the function to module scope or make instance-bound work a method; only a callback passed as an argument or returned as the result, directly or as a member of an object or array literal in that position, may stay in a function body.',
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

/** Bans framework mocking, spying, fake clocks, and global or environment stubs. */
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

/** Bans compile-time-only TypeScript privacy keywords on class members. */
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

/** Bans a let declaration that prefer-const does not already report. */
export const LET_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a let declaration that is reassigned or declared without a value; prefer-const reports the rest.',
		},
		messages: {
			let: 'Declare this binding with const and derive its value: an expression, a helper that returns it, or a for…of over entries() in place of a counter.',
		},
	},
	create(context) {
		return {
			VariableDeclaration: (node) => reportLet(context, node),
		}
	},
}

/** Bans a centralized declaration that no export reaches. */
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

/** Bans a type declaration outside its module's types.ts. */
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

/** Bans a class outside the implementation file that names it. */
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

/** Bans module data outside a data-kind file. */
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

/** Bans module function syntax outside a function-kind file. */
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

/** Bans a constants.ts declaration that is mutable, misnamed, or a bare collection. */
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

/** Bans a parsers.ts function or export whose name lacks the parse prefix. */
export const PARSER_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow a parsers.ts function or export whose name does not start with parse.',
		},
		messages: {
			parser:
				'Name this parsers.ts function or export with the parse prefix, or move it to its own kind file.',
		},
	},
	create(context) {
		return {
			ExportAllDeclaration: (node) => reportName(context, node, 'parsers.ts'),
			ExportNamedDeclaration: (node) => reportName(context, node, 'parsers.ts'),
			FunctionDeclaration: (node) => reportName(context, node, 'parsers.ts'),
			TSDeclareFunction: (node) => reportName(context, node, 'parsers.ts'),
			VariableDeclaration: (node) => reportName(context, node, 'parsers.ts'),
		}
	},
}

/** Bans a factories.ts function or export whose name lacks the create prefix. */
export const FACTORY_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a factories.ts function or export whose name does not start with create.',
		},
		messages: {
			factory:
				'Name this factories.ts function or export with the create prefix, or move it to its own kind file.',
		},
	},
	create(context) {
		return {
			ExportAllDeclaration: (node) => reportName(context, node, 'factories.ts'),
			ExportNamedDeclaration: (node) => reportName(context, node, 'factories.ts'),
			FunctionDeclaration: (node) => reportName(context, node, 'factories.ts'),
			TSDeclareFunction: (node) => reportName(context, node, 'factories.ts'),
			VariableDeclaration: (node) => reportName(context, node, 'factories.ts'),
		}
	},
}

/** Bans a plugins.ts function or export whose name is not a create-prefixed plugin or plugins form. */
export const PLUGIN_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a plugins.ts function or export whose name is not create…Plugin or create…Plugins.',
		},
		messages: {
			plugin:
				'Name this plugins.ts function or export create…Plugin, or create…Plugins for a collection, or move it to its own kind file.',
		},
	},
	create(context) {
		return {
			ExportAllDeclaration: (node) => reportName(context, node, 'plugins.ts'),
			ExportNamedDeclaration: (node) => reportName(context, node, 'plugins.ts'),
			FunctionDeclaration: (node) => reportName(context, node, 'plugins.ts'),
			TSDeclareFunction: (node) => reportName(context, node, 'plugins.ts'),
			VariableDeclaration: (node) => reportName(context, node, 'plugins.ts'),
		}
	},
}

/** Bans a malformed module in a registered function domain, and a file named for one. */
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

/** Bans literal relative imports and re-exports outside the importing Vue face's permitted roots. */
export const VUE_IMPORT_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow Vue relative imports outside the faces their importing file may reach.',
		},
		messages: {
			vue: 'Keep this Vue relative import within the permitted source and application faces.',
		},
	},
	create(context) {
		return {
			ImportDeclaration: (node) => reportVueImport(context, node),
			ImportExpression: (node) => reportVueImport(context, node),
			ExportNamedDeclaration: (node) => reportVueImport(context, node),
			ExportAllDeclaration: (node) => reportVueImport(context, node),
		}
	},
}

/** Bans host-specific line-ending handling. */
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

/** Bans a doc block above an export whose first sentence is not a third-person summary. */
export const VOICE_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a description paragraph that opens on a word other than a third-person verb, and one that names the symbol it documents.',
		},
		messages: {
			voice:
				'Open this description with a third-person verb ending in s, such as Creates, Returns, or Checks whether.',
			name: 'State what the symbol does without naming {{name}} in the first sentence.',
		},
	},
	create(context) {
		return {
			Program: (node) => reportDocs(context, node),
		}
	},
}

/** Bans a skill script top-level statement that is hidden, undocumented, or runs at import. */
export const SCRIPT_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow an unexported declaration, an undocumented export, and a statement beyond the one guarded entry in a skill script.',
		},
		messages: {
			hidden:
				'Export this declaration; a skill script exports every declaration so its proof can test each one.',
			doc: 'Write a one-sentence TSDoc summary directly above this export.',
			entry:
				'Move this statement into a function; a skill script holds imports, exported declarations, and the one process.argv[1] guard that runs main, and an import runs nothing.',
		},
	},
	create(context) {
		return {
			Program: (node) => reportScript(context, node),
		}
	},
}

/** Bans a property signature in an interface or type alias that is not readonly. */
export const MUTABLE_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a property signature without readonly in an interface or in the object type of a type alias.',
		},
		messages: {
			mutable:
				'Declare this property readonly; a contract exposes its members and no holder rewrites them.',
		},
	},
	create(context) {
		return {
			TSPropertySignature: (node) => reportMutable(context, node),
		}
	},
}

/** Bans a module-scope function, class, or fixture factory in a mirrored test file or setup proof. */
export const HELPER_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow a module-scope function, class, or function-valued binding in a test file; shared test infrastructure lives in the root setup modules.',
		},
		messages: {
			helper:
				'Move this declaration into the root setup module its environment names (tests/setup.ts, tests/setupServer.ts, or tests/setupBrowser.ts), export it, and import it; a test file imports shared infrastructure and declares none of its own.',
		},
	},
	create(context) {
		return {
			FunctionDeclaration: (node) => reportTestHelper(context, node),
			ClassDeclaration: (node) => reportTestHelper(context, node),
			VariableDeclaration: (node) => reportTestHelper(context, node),
		}
	},
}

/** Bans a comment carrying a term the substitution table bans unconditionally. */
export const TERM_RULE: PolicyRuleInterface = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow an unconditionally banned substitution-table term in comment prose, outside code spans, fenced blocks, link tags, and URLs.',
		},
		messages: {
			term: 'Replace {{term}} in this comment: {{replacement}}.',
		},
	},
	create(context) {
		return {
			Program: () => reportComments(context),
		}
	},
}

/** Declares the workspace Oxlint plugin. */
export default {
	meta: { name: 'policy' },
	rules: {
		'no-mocking': MOCKING_RULE,
		'no-keyword-privacy': PRIVACY_RULE,
		'no-let': LET_RULE,
		'no-nested-functions': NESTED_RULE,
		'no-hidden-declaration': HIDDEN_RULE,
		'no-misplaced-type': TYPE_RULE,
		'no-misplaced-class': CLASS_RULE,
		'no-misplaced-data': DATA_RULE,
		'no-misplaced-function': FUNCTION_RULE,
		'no-malformed-constant': CONSTANT_RULE,
		'no-misnamed-parser': PARSER_RULE,
		'no-misnamed-factory': FACTORY_RULE,
		'no-misnamed-plugin': PLUGIN_RULE,
		'no-malformed-domain': DOMAIN_RULE,
		'no-cross-vue-face': VUE_IMPORT_RULE,
		'no-host-line-endings': ENDING_RULE,
		'no-malformed-summary': VOICE_RULE,
		'no-banned-term': TERM_RULE,
		'no-malformed-script': SCRIPT_RULE,
		'no-mutable-property': MUTABLE_RULE,
		'no-test-helper': HELPER_RULE,
	},
}
