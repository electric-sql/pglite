import { describe, expect, it } from 'vitest'
import { PGlite as ScopedPGlite } from '@electric-sql/pglite'
import { PGlitePostmaster as ScopedPostmaster } from '@electric-sql/pglite/postmaster'
import { PGliteServer as ScopedServer } from '@electric-sql/pglite-server'
import { pgDump as scopedPgDump } from '@electric-sql/pglite-tools/pg_dump'
import { initdb as scopedInitdb } from '@electric-sql/pglite-tools/initdb'
import { PGlite } from '../src/index.js'
import { PGlitePostmaster } from '../src/postmaster.js'
import { PGliteServer } from '../src/server.js'
import { initdb, pgDump } from '../src/tools.js'

describe('distribution export identity', () => {
  it('re-exports implementation objects without wrapping them', () => {
    expect(PGlite).toBe(ScopedPGlite)
    expect(PGlitePostmaster).toBe(ScopedPostmaster)
    expect(PGliteServer).toBe(ScopedServer)
    expect(pgDump).toBe(scopedPgDump)
    expect(initdb).toBe(scopedInitdb)
  })
})
