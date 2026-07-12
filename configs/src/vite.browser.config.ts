import { defineConfig } from 'vite'
import { srcBrowser } from '../../vite.config'

// The published `@src/browser` library build — a thin wrapper around the shared
// `srcBrowser` config in the root vite.config.ts, which already externalizes
// `@src/core` to the sibling `dist/src/core` build.
export default defineConfig(srcBrowser())
