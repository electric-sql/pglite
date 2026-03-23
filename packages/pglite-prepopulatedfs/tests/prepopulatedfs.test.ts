import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
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
    }
    const prepopulatedTimes: number[] = []
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      const prepopulatedData = await fs.readFile(
        resolve(import.meta.dirname, '../release/pglite-prepopulatedfs.tar.gz'),
      )
      const _db = await PGlite.create({
        loadDataDir: new Blob([new Uint8Array(prepopulatedData)]),
      })
      const elapsed = performance.now() - start
      prepopulatedTimes.push(elapsed)
    }
    prepopulatedTimes.sort((a, b) => a - b)
    const trimmed = prepopulatedTimes.slice(1, -1)
    const elapsedPrepopulated =
      trimmed.reduce((s, v) => s + v, 0) / trimmed.length

    console.log(
      `InitDb speed: prepopulated avg (trimmed) ${elapsedPrepopulated.toFixed(2)} ms vs. classic initdb ${elapsedInitDb.toFixed(2)} ms`,
    )

    expect(elapsedPrepopulated).toBeLessThan(elapsedInitDb)
  })
})
