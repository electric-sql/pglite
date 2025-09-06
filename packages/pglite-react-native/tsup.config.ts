import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  external: [
    'react-native',
    'expo',
    'react-native-nitro-modules',
  ],
  noExternal: [
    '@electric-sql/pglite-base',
    '@electric-sql/pg-protocol',
    'async-mutex',
  ],
  treeshake: true,
  splitting: false,
  minify: false,
})