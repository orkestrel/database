import { defineConfig } from 'vite'
import {
	declarationRollup,
	environmentBoundary,
	outputBoundary,
	resolveExternal,
} from '../helpers.js'
import { peers, srcCore, resolveWorkspacePath } from '../../vite.config.ts'

export default defineConfig(
	srcCore({
		publicDir: false,
		plugins: [
			outputBoundary('dist/src/core'),
			environmentBoundary('src/core'),
			declarationRollup({
				project: resolveWorkspacePath('configs/src/tsconfig.core.json'),
				types: ['node'],
			}),
		],
		build: {
			lib: {
				entry: resolveWorkspacePath('src/core/index.ts'),
				formats: ['es', 'cjs'],
				fileName: (format: string) => (format === 'es' ? 'index.js' : 'index.cjs'),
			},
			outDir: 'dist/src/core',
			rolldownOptions: {
				external: (id: string) => resolveExternal(id, { peers, refused: [], siblings: [] }),
			},
		},
	}),
)
