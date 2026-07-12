// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` test project. `node:fs` / `node:path` imports belong here, never
// in `setup.ts`, which browser projects also load. Anchor every path to
// `WORKSPACE_ROOT` so the runner's cwd never matters (AGENTS §16.1).

import type { TableSchema } from '@src/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A fresh on-disk database path under the OS temp dir, with a `cleanup` thunk
// that removes its directory. Used by tests that need real file persistence
// across a close / reopen. Call `cleanup` in `afterEach` so no temp file leaks
// (AGENTS §16.1).
export function tempDatabasePath(): { readonly path: string; readonly cleanup: () => void } {
	const directory = mkdtempSync(join(tmpdir(), 'database-json-'))
	return {
		path: join(directory, 'database.json'),
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	}
}

/**
 * Build the shared driver-conformance schema the JSON `DriverInterface` battery
 * runs against (AGENTS §16.1) — a `users` table carrying one of each codec-relevant
 * column type (text, `integer`, `boolean`, a nullable `json`) and a `posts` table
 * keyed by a non-`id` primary column (`slug`), so the driver test proves the CRUD /
 * key-order / snapshot / codec contract.
 *
 * @param options - `indexes` parameterizes the `users` table's secondary index set
 *   (each inner array is one index's column list); defaults to `[['name']]`. The
 *   `posts` table is always unindexed.
 * @returns The two-table schema (`users` + `posts`)
 */
export function driverSchema(options?: {
	indexes?: readonly (readonly string[])[]
}): readonly TableSchema[] {
	return [
		{
			name: 'users',
			primary: 'id',
			columns: [
				{ name: 'id', type: 'text', nullable: false },
				{ name: 'name', type: 'text', nullable: false },
				{ name: 'age', type: 'integer', nullable: false },
				{ name: 'active', type: 'boolean', nullable: false },
				{ name: 'meta', type: 'json', nullable: true },
			],
			indexes: options?.indexes ?? [['name']],
		},
		{
			name: 'posts',
			primary: 'slug',
			columns: [
				{ name: 'slug', type: 'text', nullable: false },
				{ name: 'title', type: 'text', nullable: false },
			],
			indexes: [],
		},
	]
}
