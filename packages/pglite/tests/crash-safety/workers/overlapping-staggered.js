// Staggered overlap: instance A starts writing, instance B opens after a delay
// while A is still active. Both write concurrently to the same data dir.

import { PGlite } from '../../../dist/index.js'

const dataDir = process.env.PGLITE_DATA_DIR
const cycle = parseInt(process.env.CYCLE || '0', 10)
const staggerMs = parseInt(process.env.STAGGER_MS || '500', 10)

async function run() {
  const pad = 'S'.repeat(300)

  const a = new PGlite(dataDir)
  await a.waitReady
  process.send('a-ready')

  if (cycle === 0) {
    await a.query(`
      CREATE TABLE IF NOT EXISTS stagger_data (
        id SERIAL PRIMARY KEY,
        cycle INTEGER NOT NULL,
        instance TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload TEXT NOT NULL
      )
    `)
    await a.query(
      `CREATE INDEX IF NOT EXISTS idx_stagger_cycle ON stagger_data (cycle)`,
    )
    process.send('schema-created')
  }

  const aWritePromise = (async () => {
    for (let i = 0; i < 30; i++) {
      await a.query(
        `INSERT INTO stagger_data (cycle, instance, seq, payload) VALUES ($1, $2, $3, $4)`,
        [cycle, 'A', i, `c${cycle}-A-${i}-${pad}`],
      )
      if (i % 5 === 0) {
        await new Promise((r) => setTimeout(r, 10))
      }
    }
    await a.query(
      `UPDATE stagger_data SET payload = payload || '-a-updated' WHERE instance = 'A' AND cycle = $1 AND seq < 10`,
      [cycle],
    )
  })()

  await new Promise((r) => setTimeout(r, staggerMs))

  const b = new PGlite(dataDir)
  await b.waitReady
  process.send('b-ready')

  const bWritePromise = (async () => {
    for (let i = 0; i < 30; i++) {
      await b.query(
        `INSERT INTO stagger_data (cycle, instance, seq, payload) VALUES ($1, $2, $3, $4)`,
        [cycle, 'B', i, `c${cycle}-B-${i}-${pad}`],
      )
    }
    // Deletes touch pages A may have cached
    try {
      await b.query(
        `DELETE FROM stagger_data WHERE instance = 'A' AND cycle = $1 AND seq > 20`,
        [cycle],
      )
    } catch (_) {
      /* ignore */
    }
  })()

  await Promise.allSettled([aWritePromise, bWritePromise])
  process.send('overlap-writes-done')

  // A continues with stale cache after B has mutated pages
  try {
    for (let i = 50; i < 60; i++) {
      await a.query(
        `INSERT INTO stagger_data (cycle, instance, seq, payload) VALUES ($1, $2, $3, $4)`,
        [cycle, 'A', i, `c${cycle}-A-stale-${i}-${pad}`],
      )
    }
    process.send('a-stale-writes-done')
  } catch (err) {
    process.send(`a-stale-error:${err.message}`)
  }

  process.send('all-done')
  await new Promise(() => {})
}

run().catch((err) => {
  console.error(`Staggered worker cycle ${cycle} error:`, err)
  try {
    process.send(`fatal:${err.message}`)
  } catch (_) {
    /* ignore */
  }
  process.exit(1)
})
