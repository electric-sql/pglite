import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { hypopg } from '../src/index.js'

describe(`hypopg`, () => {
  let pg: PGlite
  let dataDirArchive: File | Blob

  beforeEach(async () => {
    if (!dataDirArchive) {
      pg = await PGlite.create({
        extensions: { hypopg },
      })
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        debug: 1,
        extensions: { hypopg },
        loadDataDir: dataDirArchive,
      })
    }
    await pg.exec('CREATE EXTENSION IF NOT EXISTS hypopg;')
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
        WHERE extname = 'hypopg'
      `)

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].extname).toBe('hypopg')
  })
})
