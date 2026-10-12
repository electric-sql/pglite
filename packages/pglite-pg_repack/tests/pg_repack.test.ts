import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_repack } from '../src/index.js'

describe(`pg_repack`, () => {
  let pg: PGlite
  let dataDirArchive: File | Blob

  beforeEach(async () => {
    if (!dataDirArchive) {
      pg = await PGlite.create({
        extensions: { pg_repack },
      })
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        debug: 1,
        extensions: { pg_repack },
        loadDataDir: dataDirArchive,
      })
    }
    await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_repack;')
  })
  afterEach(async () => {
    if (!pg.closed) {
      await pg.close()
    }
  })

  it('can load extension', async () => {
    // Verify the extension is loaded
    const res = await pg.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pg_repack'
      `)

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].extname).toBe('pg_repack')
  })
})
