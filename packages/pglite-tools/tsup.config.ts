import { defineConfig } from 'tsup'

const entryPoints = [
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
    format: ['esm', 'cjs'],
  },
])
