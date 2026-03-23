import { PGlite } from '@electric-sql/pglite'
import { resolve } from 'path'
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    sourcemap: true,
    clean: true,
    shims: true,
    format: ['esm', 'cjs'],
    onSuccess: async () => {
      const pglite = await PGlite.create()
      const dataDirArchive = await pglite.dumpDataDir('gzip')
      const fs = await import('fs')
      fs.writeFileSync(resolve('dist/pglite-prepopulatedfs.tar.gz'), await dataDirArchive.arrayBuffer() as any)
      // cpSync(resolve('release/pglite-prepopulatedfs.tar.gz'), resolve('dist/pglite-prepopulatedfs.tar.gz'))
    }
  },
])
