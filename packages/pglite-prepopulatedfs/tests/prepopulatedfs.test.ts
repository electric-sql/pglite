import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { dataDir } from '@electric-sql/pglite-prepopulatedfs'
import * as fs from 'fs/promises'
import { resolve } from 'path'

describe('initdb vs prepopulated FS', () => {
  it('initdb vs prepopulated FS', async () => {
    // warmup
    {
      const start = performance.now()
      const _db = await PGlite.create()
      const end = performance.now()
      const elapsed = end - start
      console.log(`warmup: PGlite.create() took ${elapsed} ms`)
    }

    let elapsedInitDb = 0
    {
      const start = performance.now()
      const _db = await PGlite.create()
      const end = performance.now()
      elapsedInitDb = end - start
      console.log(`initdb: PGlite.create() took ${elapsedInitDb} ms`)
    }
    let elapsedPrepopulated = 0
    {
      const start = performance.now()
      const prepopulatedData = await fs.readFile(
        resolve(import.meta.dirname, '../dist/pglite-prepopulatedfs.tar.gz'),
      )
      const _db = await PGlite.create({
        loadDataDir: new Blob([new Uint8Array(prepopulatedData)]),
      })
      const end = performance.now()
      elapsedPrepopulated = end - start
      console.log(
        `prepopulated: PGlite.create() took ${elapsedPrepopulated} ms`,
      )
    }

    expect(elapsedPrepopulated).toBeLessThan(elapsedInitDb)
  })

  it('works via package import', async () => {
    const d = await dataDir()
    const db = await PGlite.create({ loadDataDir: d })

    await db.exec('CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT)')
    await db.exec("INSERT INTO test_table (name) VALUES ('hello')")
    const result = await db.query('SELECT name FROM test_table')
    expect(result.rows).toEqual([{ name: 'hello' }])

    await db.close()
  })
})
