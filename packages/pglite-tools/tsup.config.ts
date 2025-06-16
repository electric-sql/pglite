import { defineConfig } from 'tsup'

const entryPoints = [
  'src/index.ts',
  'src/pg_dump.ts',
]

const minify = process.env.DEBUG === 'true' ? false : true

export default defineConfig([
  {
    entry: entryPoints,
    sourcemap: true,
    dts: {
      entry: entryPoints,
      resolve: true,
    },
    clean: true,
    minify: minify,
    shims: true,
    format: ['esm', 'cjs'],
  },
])
