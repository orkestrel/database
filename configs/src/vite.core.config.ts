import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { srcCore, resolveWorkspacePath } from '../../vite.config'

export default defineConfig(
	srcCore({
		plugins: [
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.core.json'),
				bundleTypes: true,
			}),
		],
		build: {
			lib: {
				entry: resolveWorkspacePath('src/core/index.ts'),
				formats: ['es', 'cjs'],
				fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
			},
			outDir: 'dist/src/core',
		},
	}),
)
