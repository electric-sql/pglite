import { defineConfig } from 'tsup'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const thisFile = fileURLToPath(new URL(import.meta.url))
const root = path.dirname(thisFile)

const replaceAssertPlugin = {
  name: 'replace-assert',
  setup(build: any) {
    // Resolve `assert` to a blank file
    build.onResolve({ filter: /^assert$/ }, (_args: any) => {
      return { path: path.join(root, 'src', 'polyfills', 'blank.ts') }
    })
  },
}

const entryPoints = [
  'src/index.ts',
  'src/fs/nodefs.ts',
  'src/fs/opfs-ahp.ts',
  'src/fs/http.ts',
  'src/templating.ts',
  'src/live/index.ts',
  'src/vector/index.ts',
  'src/worker/index.ts',
  'src/sync-fetch/node.ts',
  'src/sync-fetch/node-worker.ts',
]

const contribDir = path.join(root, 'src', 'contrib')
const contribFiles = await fs.promises.readdir(contribDir)
for (const file of contribFiles) {
  if (file.endsWith('.ts')) {
    entryPoints.push(`src/contrib/${file}`)
  }
}

export default defineConfig([
  {
    entry: entryPoints,
    sourcemap: true,
    dts: {
      entry: entryPoints,
      resolve: true,
    },
    clean: true,
    external: ['../release/postgres.js', '../release/postgres.cjs'],
    esbuildPlugins: [replaceAssertPlugin],
    minify: true,
    shims: true, // Convert import.meta.url to a shim for CJS
    format: ['esm', 'cjs'],
  },
  {
    // Convert the Emscripten ESM bundle to a CJS bundle
    entry: ['release/postgres.js'],
    format: ['cjs'],
    minify: true,
    shims: true, // Convert import.meta.url to a shim for CJS
    keepNames: true,
  },
])
