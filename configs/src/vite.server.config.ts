import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcServer, resolveWorkspacePath, rewriteCoreEntry } from '../../vite.config'

// Types are bundled by vite-plugin-dts (see configs/src/vite.core.config.ts for the
// same pattern); the `afterBuild` hook normalizes the bundled entry's external
// core-type imports to the shipped `../core/index.js` (see `rewriteCoreEntry`).
export default defineConfig(
	srcServer({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.server.json'),
				bundleTypes: true,
				afterBuild: rewriteCoreEntry('dist/src/server'),
			}),
		],
	}),
)
