import { defineConfig } from 'tsup'
import  { doBundle } from './scripts/bundle-static-assets'

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
      doBundle()
    }    
  }
])
