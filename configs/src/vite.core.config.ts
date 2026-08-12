import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { environmentBoundary, outputBoundary } from '../helpers.js'
import { srcCore, resolveWorkspacePath } from '../../vite.config.ts'

export default defineConfig(
	srcCore({
		publicDir: false,
		plugins: [
			outputBoundary('dist/src/core'),
			environmentBoundary('src/core'),
			dts({
				tsconfigPath: resolveWorkspacePath('configs/src/tsconfig.core.json'),
				bundleTypes: {
					extractorConfig: {
						compiler: {
							overrideTsconfig: {
								compilerOptions: { types: ['node'] },
							},
						},
					},
				},
			}),
		],
		build: {
			lib: {
				entry: resolveWorkspacePath('src/core/index.ts'),
				formats: ['es', 'cjs'],
				fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
			},
			outDir: 'dist/src/core',
			rolldownOptions: { external: [/^node:/, /^@orkestrel\//] },
		},
	}),
)
