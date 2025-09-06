import { defineConfig } from 'tsup'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const thisFile = fileURLToPath(new URL(import.meta.url))
const root = path.dirname(thisFile)

const entryPoints = [
  'src/index.ts',
  'src/templating.ts',
  'src/fs/base.ts',
  'src/fs/nodefs.ts',
  'src/fs/tarUtils.ts',
  'src/vector/index.ts',
  'src/pg_ivm/index.ts',
  'src/postgresMod.ts',
  'src/extensionUtils.ts',
  'src/interface.ts',
  'src/types.ts',
  'src/parse.ts',
  'src/errors.ts',
  'src/utils.ts',
  'src/base.ts',
]

// Add contrib files
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
    // Temporarily disable DTS due to type issues - the main pglite package has types
    // dts: {
    //   entry: entryPoints,
    //   resolve: true,
    // },
    clean: true,
    minify: minify,
    shims: true, // Convert import.meta.url to a shim for CJS
    format: ['esm', 'cjs'],
    noExternal: ['tinytar'], // Bundle tinytar dependency
  },
])