import { cpSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'tsup'

const entryPoints = [
  'src/index.ts',
  'src/pg_dump.ts',
  'src/pg_dump_native.ts',
  'src/pg_isready.ts',
  'src/initdb.ts',
  'src/native-tool-worker.ts',
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
    onSuccess: async () => {
      cpSync(resolve('release/pg_dump.wasm'), resolve('dist/pg_dump.wasm'))
      mkdirSync(resolve('dist/native'), { recursive: true })
      for (const command of ['pg_dump', 'pg_isready']) {
        cpSync(
          resolve(`release/${command}.js`),
          resolve(`dist/native/${command}.js`),
        )
        cpSync(
          resolve(`release/${command}.wasm`),
          resolve(`dist/native/${command}.wasm`),
        )
      }
    },
  },
])
