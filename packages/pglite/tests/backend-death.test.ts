import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '../dist/index.js'

// Regression test for https://github.com/electric-sql/pglite/issues/1058
//
// When the WASM backend terminates while `execProtocolRawSync` is processing
// a message (e.g. `exit(1)` after hitting EOF during a `COPY ... FROM STDIN`),
// the protocol loop used to swallow the non-longjmp exception and spin forever,
// synchronously, at 100% CPU. The call never settled and the process had to be
// killed from outside.
describe('backend terminates mid-message', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec('CREATE TABLE backend_death_t(a int)')
  })

  afterAll(async () => {
    if (!db.closed) {
      await db.close()
    }
  })

  it('should reject instead of spinning when the backend exits', async () => {
    // The backend hits EOF during COPY FROM STDIN and exits with status 1
    await expect(db.exec('COPY backend_death_t FROM STDIN')).rejects.toThrow(
      /terminated|exit/i,
    )
  })

  it('should reject promptly for queries issued after the backend died', async () => {
    await expect(
      db.query('SELECT 1 FROM backend_death_t'),
    ).rejects.toThrow(/terminated|exit/i)
  })

  it('should still be able to close the database', async () => {
    await expect(db.close()).resolves.toBeUndefined()
  })
})
