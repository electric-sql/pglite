import { defineConfig } from 'tsup'

const publicEntry = {
  index: 'src/index.ts',
  postmaster: 'src/postmaster.ts',
  server: 'src/server.ts',
  tools: 'src/tools.ts',
}

const minify = process.env.DEBUG !== 'true'

export default defineConfig([
  {
    entry: publicEntry,
    sourcemap: true,
    dts: {
      entry: publicEntry,
      resolve: true,
    },
    clean: true,
    minify,
    shims: true,
    format: ['esm', 'cjs'],
  },
  {
    entry: { cli: 'src/bin.ts' },
    sourcemap: true,
    clean: false,
    minify,
    shims: true,
    format: ['esm'],
  },
])
