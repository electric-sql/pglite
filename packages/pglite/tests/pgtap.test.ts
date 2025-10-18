import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { pgtap } =
    importType === 'esm'
      ? await import('../dist/pgtap/index.js')
      : ((await import(
          '../dist/pgtap/index.cjs'
        )) as unknown as typeof import('../dist/pgtap/index.js'))

  describe(`pgtap`, () => {
    it('can load extension', async () => {
      const pg = new PGlite({
        extensions: {
          pgtap,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

      // Verify the extension is loaded
      const res = await pg.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pgtap'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('pgtap')
    })
  })
})
