import { describe, it, expect, beforeEach } from 'vitest'
import { testDTC } from './test-utils.js'
import { PGlite } from '../dist/index.js'

// This test isolates the MessageContext leak reported in
// https://github.com/electric-sql/pglite/issues/779
// It inserts many rows with large JSON literals and then inspects
// pg_backend_memory_contexts to ensure MessageContext has been reset
// between queries and does not accumulate unbounded allocations.

const KB = 1024

function makeJsonBlob(size: number): string {
  // Keep the SQL literal simple (mostly "x" payload) to simulate
  // large messages while avoiding excessive parsing overhead.
  return JSON.stringify({ padding: 'x'.repeat(size) })
}

testDTC(async (defaultDataTransferContainer) => {
  describe('MessageContext reset between queries', () => {
    let db: PGlite

    beforeEach(async () => {
      db = new PGlite({ defaultDataTransferContainer })
      await db.exec(`
        CREATE TABLE IF NOT EXISTS leak_test (
          id SERIAL PRIMARY KEY,
          blob jsonb NOT NULL
        );
      `)
    })

    it('does not accumulate allocations in MessageContext', async () => {
      // Choose sizes to expose the leak without taking too long.
      const blobSize = 100 * KB // ~100KB per row
      const rows = 300 // ~30MB of total SQL literal payload

      const blob = makeJsonBlob(blobSize)

      for (let i = 0; i < rows; i++) {
        await db.exec(`INSERT INTO leak_test (blob) VALUES ('${blob}')`)
      }

      // After the loop, the next query should see a freshly reset
      // MessageContext (reset happens at the start of command read),
      // so used_bytes should remain small (well below the total data inserted).
      const mem = await db.query<{ used_bytes: number }>(`
        SELECT used_bytes
        FROM pg_backend_memory_contexts
        WHERE name = 'MessageContext'
        ORDER BY level
        LIMIT 1
      `)

      expect(mem.rows).toHaveLength(1)
      const used = Number(mem.rows[0].used_bytes)

      // On a correctly resetting build, MessageContext should typically be in the
      // low kilobytes to a few megabytes range. Set an upper bound that will fail
      // if allocations accumulated across the INSERTs (~30MB of literal payload).
      // Using 5MB as a generous ceiling for transient allocations of this SELECT.
      expect(used).toBeLessThan(5 * 1024 * 1024)
    })
  })
})

