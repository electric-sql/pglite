import { describe, expect, it } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  describe('postgresConfig', () => {
    it('applies postmaster settings at startup', async () => {
      const db = await PGlite.create({
        dataDir: 'memory://',
        postgresConfig: {
          max_replication_slots: 12,
          max_wal_senders: 12,
          wal_level: 'logical',
        },
      })

      const settings = await db.query<{
        name: string
        setting: string
      }>(
        "SELECT name, setting FROM pg_settings WHERE name IN ('max_replication_slots', 'max_wal_senders', 'wal_level') ORDER BY name",
      )

      expect(settings.rows).toEqual([
        {
          name: 'max_replication_slots',
          setting: '12',
        },
        {
          name: 'max_wal_senders',
          setting: '12',
        },
        {
          name: 'wal_level',
          setting: 'logical',
        },
      ])

      await db.close()
    })
  })
})
