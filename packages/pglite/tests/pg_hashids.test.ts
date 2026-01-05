import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { pg_hashids } =
    importType === 'esm'
      ? await import('../dist/pg_hashids/index.js')
      : ((await import(
          '../dist/pg_hashids/index.cjs'
        )) as unknown as typeof import('../dist/pg_hashids/index.js'))

  describe(`pg_hashids`, () => {
    it('can load extension', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.query<{ extname: string }>(`
        SELECT extname
        FROM pg_extension
        WHERE extname = 'pg_hashids'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('pg_hashids')
    })

    it('should return a hash using the default alphabet and empty salt', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(`SELECT id_encode(1001);`)

      expect(res[0].rows[0].id_encode).toEqual('jNl')
    })

    it('should return a hash using the default alphabet and supplied salt', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(`SELECT id_encode(1234567, 'This is my salt');`)

      expect(res[0].rows[0].id_encode).toEqual('Pdzxp')
    })

    it('should return a hash using the default alphabet, salt and minimum hash length', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(
        `SELECT id_encode(1234567, 'This is my salt', 10);`,
      )

      expect(res[0].rows[0].id_encode).toEqual('PlRPdzxpR7')
    })

    it('should return a hash using the supplied alphabet, salt and minimum hash length', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(
        `SELECT id_encode(1234567, 'This is my salt', 10, 'abcdefghijABCDxFGHIJ1234567890');`,
      )

      expect(res[0].rows[0].id_encode).toEqual('3GJ956J9B9')
    })

    it('should decode previously generated hash', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(
        `SELECT id_decode('PlRPdzxpR7', 'This is my salt', 10);`,
      )

      expect(res[0].rows[0].id_decode).toEqual([1234567])
    })

    it('should decode previously generated hash using the supplied alphabet', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(
        `SELECT id_decode('3GJ956J9B9', 'This is my salt', 10, 'abcdefghijABCDxFGHIJ1234567890');`,
      )

      expect(res[0].rows[0].id_decode).toEqual([1234567])
    })

    it('should decode previously generated hash into a single integer', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(`SELECT id_decode_once('jNl');`)

      expect(res[0].rows[0].id_decode_once).toEqual(1001)
    })

    it('should decode previously generated hash into a single integer using the supplied salt', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(
        `SELECT id_decode_once('Pdzxp', 'This is my salt');`,
      )

      expect(res[0].rows[0].id_decode_once).toEqual(1234567)
    })

    it('should decode previously generated hash into a single integer using the supplied salt and minimum hash length', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(
        `SELECT id_decode_once('PlRPdzxpR7', 'This is my salt', 10);`,
      )

      expect(res[0].rows[0].id_decode_once).toEqual(1234567)
    })

    it('should decode previously generated hash into a single integer using the supplied alphabet', async () => {
      const pg = new PGlite({
        extensions: {
          pg_hashids,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_hashids;')

      const res = await pg.exec(
        `SELECT id_decode_once('3GJ956J9B9', 'This is my salt', 10, 'abcdefghijABCDxFGHIJ1234567890');`,
      )

      expect(res[0].rows[0].id_decode_once).toEqual(1234567)
    })
  })
})
