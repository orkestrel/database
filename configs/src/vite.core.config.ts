import { defineConfig } from 'vite'
import { srcCore, resolveWorkspacePath } from '../../vite.config'

export default defineConfig(
	srcCore({
		build: {
			lib: {
				entry: resolveWorkspacePath('src/core/index.ts'),
				formats: ['es'],
				fileName: () => 'index.js',
			},
			outDir: 'dist/src/core',
		},
	}),
)
