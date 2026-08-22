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
	readonly id?: unknown
	readonly method?: boolean
	readonly kind?: 'get' | 'init' | 'set'
	readonly expression?: boolean
	readonly object?: PolicyExpression
	readonly property?: PolicyExpression
	readonly computed?: boolean
	readonly callee?: PolicyExpression
	readonly argument?: PolicyExpression | null
	readonly arguments?: readonly PolicyExpression[]
	readonly body?: PolicyExpression
	readonly quasis?: readonly PolicyExpression[]
	readonly expressions?: readonly PolicyExpression[]
	readonly accessibility?: 'private' | 'protected' | 'public' | null
}

/** One diagnostic emitted by a policy rule. */
export interface PolicyDiagnostic {
	readonly node: PolicyExpression
	readonly messageId: string
	readonly data?: Readonly<Record<string, string>>
}

/** The Oxlint context operations used by the policy rules. */
export interface PolicyContext {
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
	readonly CallExpression?: (node: PolicyNode) => void
	readonly FunctionDeclaration?: (node: PolicyNode) => void
	readonly FunctionExpression?: (node: PolicyNode) => void
	readonly ArrowFunctionExpression?: (node: PolicyNode) => void
	readonly MethodDefinition?: (node: PolicyNode) => void
	readonly PropertyDefinition?: (node: PolicyNode) => void
	readonly AccessorProperty?: (node: PolicyNode) => void
	readonly TSAbstractMethodDefinition?: (node: PolicyNode) => void
	readonly TSAbstractPropertyDefinition?: (node: PolicyNode) => void
	readonly TSAbstractAccessorProperty?: (node: PolicyNode) => void
}

/** The complete behavior exposed by one policy rule. */
export interface PolicyRuleInterface {
	readonly meta: PolicyMeta
	create(context: PolicyContext): PolicyVisitor
}

/** Whether a policy expression is runtime function syntax. */
export function isPolicyFunction(node: PolicyExpression): boolean {
	return (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	)
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
	if (
		node.type !== 'ArrowFunctionExpression' ||
		node.expression !== true ||
		node.body?.type !== 'CallExpression' ||
		node.body.callee?.type !== 'Identifier' ||
		typeof node.body.callee.name !== 'string' ||
		!node.body.callee.name.startsWith('report')
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
	let member: string | undefined
	if (callee.computed) {
		if (property.type === 'Literal' && typeof property.value === 'string') {
			member = property.value
		} else if (
			property.type === 'TemplateLiteral' &&
			property.quasis?.length === 1 &&
			property.expressions?.length === 0
		) {
			const quasi = property.quasis[0]
			const value = quasi?.value
			if (typeof value === 'object' && value !== null) {
				const cooked: unknown = Object.getOwnPropertyDescriptor(value, 'cooked')?.value
				const raw: unknown = Object.getOwnPropertyDescriptor(value, 'raw')?.value
				member = typeof cooked === 'string' ? cooked : typeof raw === 'string' ? raw : undefined
			}
		}
	} else if (property.type === 'Identifier' && typeof property.name === 'string') {
		member = property.name
	}

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

/** The workspace Oxlint plugin. */
export default {
	meta: { name: 'policy' },
	rules: {
		'no-mocking': MOCKING_RULE,
		'no-keyword-privacy': PRIVACY_RULE,
		'no-nested-functions': NESTED_RULE,
	},
}
