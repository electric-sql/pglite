import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('instantiation', () => {
  testInstatiationMethod('constructor')
  testInstatiationMethod('static `create` factory')
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
    it('should instantiate with defaults', async () => {
      const pg = await instantiateDb()
      const res = await pg.query(`SELECT 1 as one;`)
      expect(res.rows[0]?.['one']).toBe(1)
    })

    it('should instantiate with data dir argument', async () => {
      const pg = await instantiateDb('./pgdata-test')
      const res = await pg.query(`SELECT 1 as one;`)
      expect(res.rows[0]?.['one']).toBe(1)
    })

    it('should instantiate with options', async () => {
      const pg = await instantiateDb({
        dataDir: './pgdata-test',
      })
      const res = await pg.query(`SELECT 1 as one;`)
      expect(res.rows[0]?.['one']).toBe(1)
    })
  })
}
