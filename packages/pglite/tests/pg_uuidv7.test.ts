import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { pg_uuidv7 } =
    importType === 'esm'
      ? await import('../dist/pg_uuidv7/index.js')
      : ((await import(
          '../dist/pg_uuidv7/index.cjs'
        )) as unknown as typeof import('../dist/pg_uuidv7/index.js'))

  describe(`pg_uuidv7`, () => {
    it('can load extension', async () => {
      const pg = new PGlite({
        extensions: {
          pg_uuidv7,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_uuidv7;')

      // Verify the extension is loaded
      const res = await pg.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pg_uuidv7'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('pg_uuidv7')
    })

    it('should generate uuiv7', async () => {
      const pg = new PGlite({
        extensions: {
          pg_uuidv7,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_uuidv7;')

      const res = await pg.exec(`SELECT uuid_generate_v7();`)

      expect(res[0].rows[0].uuid_generate_v7.length).toEqual(36)

    })

   it('should generate uuiv7', async () => {
      const pg = new PGlite({
        extensions: {
          pg_uuidv7,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_uuidv7;')

      const res = await pg.exec(`SELECT uuid_v7_to_timestamptz('018570bb-4a7d-7c7e-8df4-6d47afd8c8fc');`)

      expect(res[0].rows[0].uuid_v7_to_timestamptz.toISOString()).toEqual('2023-01-02T04:26:40.637Z')

    })
})
})