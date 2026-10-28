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

// Emscripten's NODEFS reads the fs open flags via `process.binding('constants')`,
// which Node.js always denies under its permission model (`node --permission`).
// `require('fs').constants` holds the same values, so swap it in at bundle time.
// Wrapping it as `{ fs: ... }` keeps the `['fs']` lookup emscripten does next working.
const replaceProcessBindingPlugin = {
  name: 'replace-process-binding',
  setup(build: any) {
    build.onLoad({ filter: /release[\\/]pglite\.js$/ }, async (args: any) => {
      const contents = await fs.promises.readFile(args.path, 'utf8')
      return {
        contents: contents.replace(
          /process\.binding\((["'])constants\1\)/g,
          '{ fs: require("fs").constants }',
        ),
        loader: 'js',
      }
    })
  },
}

const entryPoints = [
  'src/index.ts',
  'src/fs/nodefs.ts',
  'src/fs/opfs-ahp.ts',
  'src/fs/base.ts',
  'src/templating.ts',
  'src/live/index.ts',
  'src/worker/index.ts',
  'src/node-postgres/index.ts',
]

const contribDir = path.join(root, 'src', 'contrib')
const contribFiles = await fs.promises.readdir(contribDir)
for (const file of contribFiles) {
  if (file.endsWith('.ts')) {
    entryPoints.push(`src/contrib/${file}`)
  }
}

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
    external: ['../release/pglite.js', '../release/pglite.cjs'],
    esbuildPlugins: [replaceAssertPlugin, replaceProcessBindingPlugin],
    minify: minify,
    shims: true, // Convert import.meta.url to a shim for CJS
    format: ['esm', 'cjs'],
  },
  {
    // Convert the Emscripten ESM bundle to a CJS bundle
    entry: ['release/pglite.js'],
    format: ['cjs'],
    minify: minify,
    shims: true, // Convert import.meta.url to a shim for CJS
    keepNames: true,
    esbuildPlugins: [replaceProcessBindingPlugin],
  },
])
