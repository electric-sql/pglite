import { cpSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    clean: true,
    shims: true,
    onSuccess: async () => {
      cpSync(resolve('release/pglite-prepopulatedfs.tar.gz'), resolve('dist/pglite-prepopulatedfs.tar.gz'))
    }    
  }
])
