import { describe, it, expect } from 'vitest'
import { PGlite, MemoryFS } from '../dist/index.js'

// Regression test: creating a fresh database with a user-provided `fs` option
// boots an inner PGlite instance to run initdb. That inner instance must run
// on its own scratch filesystem — if the user's `fs` leaks into it, the
// filesystem's `init()` runs twice against the same backing resources, which
// breaks any VFS holding exclusive resources (e.g. OPFS sync access handles).
describe('initdb with user-provided fs option', () => {
  it('does not re-init the provided fs for the inner initdb instance', async () => {
    class CountingFS extends MemoryFS {
      initCount = 0
      async init(...args: Parameters<MemoryFS['init']>) {
        this.initCount++
        return super.init(...args)
      }
    }

    const fs = new CountingFS()
    const pg = await PGlite.create({ fs })

    expect(fs.initCount).toBe(1)

    // The store initialized and works end-to-end on the provided fs.
    await pg.exec('CREATE TABLE t (id int)')
    await pg.exec('INSERT INTO t VALUES (1)')
    const res = await pg.query<{ id: number }>('SELECT id FROM t')
    expect(res.rows).toEqual([{ id: 1 }])
    await pg.close()
  })
})
