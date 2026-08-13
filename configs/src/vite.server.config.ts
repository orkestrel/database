import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcServer, resolveWorkspacePath } from '../../vite.config.ts'

// vite-plugin-dts rolls this face into one declaration, and the roll-up reaches
// src/core through a relative source path the tarball does not carry. The rewrite
// below externalizes core through the package's own published root export, on the
// final roll-up only.
export default defineConfig(
	srcServer({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.server.json'),
				bundleTypes: true,
				beforeWriteFile: (path, content) => ({
					content: /[\\/]dist[\\/]src[\\/]server[\\/]index\.d\.ts$/.test(path)
						? content.replaceAll(/(?:\.\.\/)+core\/index\.[jt]s/g, '@orkestrel/database')
						: content,
				}),
			}),
		],
	}),
)
