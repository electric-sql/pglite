// HMR double-instance: opens instance A, then tries to open instance B on the
// same data dir without closing A. Instance B should be blocked by file locking.
// Process stays alive for external SIGKILL.

import { PGlite } from '../../../dist/index.js'

const dataDir = process.env.PGLITE_DATA_DIR
const cycle = parseInt(process.env.CYCLE || '0', 10)
const overlapOps = parseInt(process.env.OVERLAP_OPS || '20', 10)

async function run() {
  const instanceA = new PGlite(dataDir)
  await instanceA.waitReady
  process.send('instance-a-ready')

  if (cycle === 0) {
    await instanceA.query(`
      CREATE TABLE IF NOT EXISTS hmr_data (
        id SERIAL PRIMARY KEY,
        cycle INTEGER NOT NULL,
        instance TEXT NOT NULL,
        phase TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await instanceA.query(`
      CREATE INDEX IF NOT EXISTS idx_hmr_data_cycle ON hmr_data (cycle)
    `)
    await instanceA.query(`
      CREATE INDEX IF NOT EXISTS idx_hmr_data_instance ON hmr_data (instance)
    `)
    process.send('schema-created')
  }

  const padding = 'A'.repeat(500)
  for (let i = 0; i < 10; i++) {
    await instanceA.query(
      `INSERT INTO hmr_data (cycle, instance, phase, seq, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [cycle, 'A', 'pre-hmr', i, `cycle${cycle}-A-pre-${i}-${padding}`],
    )
  }
  process.send('instance-a-wrote')

  // Instance B should fail to open due to file lock
  try {
    const instanceB = new PGlite(dataDir)
    await instanceB.waitReady
    process.send('instance-b-ready')

    for (let i = 0; i < overlapOps; i++) {
      await instanceB.query(
        `INSERT INTO hmr_data (cycle, instance, phase, seq, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [cycle, 'B', 'post-hmr', i, `cycle${cycle}-B-post-${i}-${padding}`],
      )
    }
    process.send('overlap-done')
  } catch (err) {
    process.send('instance-b-blocked')
    process.send(`lock-error:${err.message}`)
  }

  for (let i = 10; i < 20; i++) {
    await instanceA.query(
      `INSERT INTO hmr_data (cycle, instance, phase, seq, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [cycle, 'A', 'post-hmr', i, `cycle${cycle}-A-post-${i}-${padding}`],
    )
  }
  process.send('instance-a-continued')

  process.send('all-operations-done')

  await new Promise(() => {})
}

run().catch((err) => {
  console.error(`HMR worker cycle ${cycle} error:`, err)
  try {
    process.send(`fatal:${err.message}`)
  } catch (_) {
    /* ignore */
  }
  process.exit(1)
})
