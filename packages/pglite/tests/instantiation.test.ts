import { describe, it, expect, afterAll } from 'vitest'
import { PGlite } from '../dist/index.js'
import * as fs from 'fs/promises'

describe('instantiation', () => {
  testInstatiationMethod('constructor')
  testInstatiationMethod('static `create` factory')

  it('should apply options when the data dir is undefined', async () => {
    const pg = await PGlite.create(undefined, { debug: 1 })

    expect(pg.debug).toBe(1)
  })
})

function testInstatiationMethod(
  method: 'constructor' | 'static `create` factory',
) {
  const instantiateDb = async (...args) => {
    switch (method) {
      case 'constructor':
        return new PGlite(...args)
      case 'static `create` factory':
        return await PGlite.create(...args)
      default:
        throw new Error(`Invalid instantiation method ${method}`)
    }
  }

  describe(`${method}`, () => {
    const folderPath = './pgdata-test'
    afterAll(async () => {
      await fs.rm(folderPath, { force: true, recursive: true })
    })
    it('should instantiate with defaults', async () => {
      const pg = await instantiateDb()
      const res = await pg.query(`SELECT 1 as one;`)
      expect(res.rows[0]?.['one']).toBe(1)
    })

    it('should instantiate with data dir argument', async () => {
      const pg = await instantiateDb(folderPath)
      const res = await pg.query(`SELECT 1 as one;`)
      expect(res.rows[0]?.['one']).toBe(1)
    })

    it('should instantiate with options', async () => {
      const pg = await instantiateDb({
        dataDir: folderPath,
      })
      const res = await pg.query(`SELECT 1 as one;`)
      expect(res.rows[0]?.['one']).toBe(1)
    })
  })
}
