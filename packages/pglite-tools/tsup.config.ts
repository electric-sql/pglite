import { defineConfig } from 'tsup'

const entryPoints = [
  'src/index.ts',
  'src/pg_dump.ts',
]

export default defineConfig([
  {
    entry: entryPoints,
    sourcemap: true,
    dts: {
      entry: entryPoints,
      resolve: true,
    },
    clean: true,
    minify: true,
    shims: true,
    format: ['esm', 'cjs'],
  },
])
