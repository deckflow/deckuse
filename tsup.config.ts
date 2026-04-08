import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    minify: true,
    shims: true,
  },
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    minify: true,
    shims: true,
    outExtension() {
      return { js: '.cjs' }
    },
    esbuildOptions(options) {
      options.banner ??= {}
      options.banner.js = '#!/usr/bin/env node'
    },
  },
])
