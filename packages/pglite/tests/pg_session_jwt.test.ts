import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { pg_session_jwt } =
    importType === 'esm'
      ? await import('../dist/pg_session_jwt/index.js')
      : ((await import(
          '../dist/pg_session_jwt/index.cjs'
        )) as unknown as typeof import('../dist/pg_session_jwt/index.js'))

  describe(`pg_session_jwt`, () => {
    it('fallback mode reads request.jwt.claims', async () => {
      const pg = new PGlite({
        extensions: {
          pg_session_jwt,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_session_jwt;')
      await pg.transaction(async (tx) => {
        // `set_config(..., true)` is LOCAL to the current transaction, mirroring
        // how PostgREST sets `request.jwt.claims`.
        await tx.query(
          `select set_config('request.jwt.claims', '{"sub":"user_123","role":"anon"}', true);`,
        )

        const res = await tx.query<{ user_id: string | null }>(
          'select auth.user_id() as user_id;',
        )
        expect(res.rows[0].user_id).toBe('user_123')
      })
    })
  })
})
