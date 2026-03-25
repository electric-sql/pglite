import { defineConfig } from 'tsup'

const minify = process.env.DEBUG === 'true' ? false : true

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    outDir: 'dist',
    dts: true,
    minify: minify,
    sourcemap: true,
    clean: true,
  },
])
