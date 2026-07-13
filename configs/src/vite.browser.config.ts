import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcBrowser, resolveWorkspacePath, rewriteCoreEntry } from '../../vite.config'

// The published `@src/browser` library build — a thin wrapper around the shared
// `srcBrowser` config in the root vite.config.ts, which already externalizes
// `@src/core` to the sibling `dist/src/core` build. Types are bundled by
// vite-plugin-dts (see configs/src/vite.core.config.ts for the same pattern); the
// `afterBuild` hook normalizes the bundled entry's external core-type imports to the
// shipped `../core/index.js` (see `rewriteCoreEntry`).
export default defineConfig(
	srcBrowser({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.browser.json'),
				bundleTypes: true,
				afterBuild: rewriteCoreEntry('dist/src/browser'),
			}),
		],
	}),
)
