import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  minify: false,
  shims: true,
  esbuildOptions(options) {
    // Only add shebang to cli.js
    if (options.entryNames === '[name]') {
      options.banner = {
        js: '#!/usr/bin/env node',
      }
    }
  },
})
