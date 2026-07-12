/**
 * A manually-resolved promise pair — the deterministic guard-supersede
 * fixture (AGENTS §16.1): a guard under test `await`s `promise` and the
 * scenario calls `resolve`/`reject` on its own schedule, so a "slow guard"
 * case is timing-deterministic rather than relying on real delays.
 */
export interface DeferredInterface<T> {
	readonly promise: Promise<T>
	resolve(value: T): void
	reject(reason: unknown): void
}

/**
 * Create a {@link DeferredInterface} — a promise whose settlement is driven
 * externally, for deterministic async-guard scenarios (AGENTS §16.1: no real
 * delays for a race that must be exact).
 *
 * @typeParam T - The value the deferred promise resolves to
 * @returns A deferred `promise` plus its `resolve` / `reject`
 */
export function createDeferred<T>(): DeferredInterface<T> {
	let resolve: (value: T) => void = () => {}
	let reject: (reason: unknown) => void = () => {}
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}
