import { cpSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'tsup'

const entryPoints = ['src/index.ts']

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
      cpSync(resolve('release/age.tar.gz'), resolve('dist/age.tar.gz'))
    },
  },
])