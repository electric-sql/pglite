import { describe, it, expect, afterEach } from 'vitest'
import { PGlite } from '../dist/index.js'

// initdb writes the time zone it finds in its environment to postgresql.conf.
// The backend runs with TZ=UTC, so initdb must too. Otherwise a non-UTC host
// gets a fixed offset such as 'Etc/GMT+5' (no DST) as the server TimeZone,
// and timestamptz input without an offset is stored at a host-dependent instant.
describe('initdb time zone', () => {
  const hostTZ = process.env.TZ

  afterEach(() => {
    if (hostTZ === undefined) delete process.env.TZ
    else process.env.TZ = hostTZ
  })

  it('is UTC on a non-UTC host', async () => {
    process.env.TZ = 'America/New_York'
    const pg = await PGlite.create()
    const res = await pg.query<{ tz: string; t: Date }>(
      `SELECT current_setting('TimeZone') AS tz,
              '2026-07-01 12:00:00'::timestamptz AS t`,
    )
    await pg.close()
    expect(res.rows[0].tz).toBe('UTC')
    expect(res.rows[0].t.toISOString()).toBe('2026-07-01T12:00:00.000Z')
  })
})
