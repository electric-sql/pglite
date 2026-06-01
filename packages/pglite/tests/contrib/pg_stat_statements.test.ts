import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { testEsmCjsAndDTC } from '../test-utils.ts'
import { PGlite } from '../../dist/index.js'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../../dist/index.js')
      : ((await import(
          '../../dist/index.cjs'
        )) as unknown as typeof import('../../dist/index.js'))

  const { pg_stat_statements } =
    importType === 'esm'
      ? await import('../../dist/contrib/pg_stat_statements.js')
      : ((await import(
          '../../dist/contrib/pg_stat_statements.cjs'
        )) as unknown as typeof import('../../dist/contrib/pg_stat_statements.js'))

  describe(`pg_stat_statements`, () => {
    let db: PGlite
    let dataDirArchive: File | Blob | undefined = undefined
    beforeEach(async () => {
      if (!dataDirArchive) {
        db = await PGlite.create({
          extensions: { pg_stat_statements },
        })
        dataDirArchive = await db.dumpDataDir('gzip')
      } else {
        db = await PGlite.create({
          extensions: { pg_stat_statements },
          loadDataDir: dataDirArchive,
        })
      }
      await db.exec('CREATE EXTENSION IF NOT EXISTS pg_stat_statements;')
    })

    afterEach(async () => {
      if (!db.closed) {
        await db.close()
      }
    })

    it('can load extension', async () => {
      // Verify the extension is loaded
      const res = await db.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pg_stat_statements'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('pg_stat_statements')
    })
  })
})
