import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  sourcemap: true,
  dts: true,
  clean: true,
  format: ['esm'],
  esbuildOptions(options, context) {
    options.inject = ['src/buffer-polyfill.ts']
  },
})
