import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/messages.ts'],
    format: ['cjs', 'esm'],
    outDir: 'dist',
    dts: true,
    minify: true,
    sourcemap: true,
    clean: true,
  },
])
