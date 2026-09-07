import { defineConfig, mergeConfig } from 'vite'
import { declarationRollup, rewriteCoreSpecifier } from '../helpers.js'
import { srcBrowser, resolveWorkspacePath } from '../../vite.config.ts'

// The roll-up reaches src/core through a specifier the tarball does not carry, so the rewrite
// externalizes core through the package's own published root export, on the final roll-up alone.
export default defineConfig(
	mergeConfig(srcBrowser(), {
		plugins: [
			declarationRollup({
				project: resolveWorkspacePath('configs/src/tsconfig.browser.json'),
				rewrite: rewriteCoreSpecifier,
			}),
		],
	}),
)
