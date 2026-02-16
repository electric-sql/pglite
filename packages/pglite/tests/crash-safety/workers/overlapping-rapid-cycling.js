// Rapid instance cycling: opens N instances on the same data dir without
// closing any. All hold stale WASM heaps simultaneously. Simulates worst-case
// dev server rapid reload.

import { PGlite } from '../../../dist/index.js'

const dataDir = process.env.PGLITE_DATA_DIR
const numInstances = parseInt(process.env.NUM_INSTANCES || '10', 10)

async function run() {
  const instances = []
  const pad = 'R'.repeat(500)

  const first = new PGlite(dataDir)
  await first.waitReady
  instances.push(first)

  await first.query(`
    CREATE TABLE IF NOT EXISTS rapid_data (
      id SERIAL PRIMARY KEY,
      instance_num INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL
    )
  `)
  await first.query(
    `CREATE INDEX IF NOT EXISTS idx_rapid_inst ON rapid_data (instance_num)`,
  )
  process.send('schema-created')

  await first.query(
    `INSERT INTO rapid_data (instance_num, seq, payload) VALUES ($1, $2, $3)`,
    [0, 0, `inst-0-row-0-${pad}`],
  )
  process.send('instance-0-wrote')

  for (let i = 1; i < numInstances; i++) {
    const inst = new PGlite(dataDir)
    await inst.waitReady
    instances.push(inst)

    await inst.query(
      `INSERT INTO rapid_data (instance_num, seq, payload) VALUES ($1, $2, $3)`,
      [i, 0, `inst-${i}-row-0-${pad}`],
    )
    process.send(`instance-${i}-wrote`)

    // Stale cache: also write from a random older instance
    if (instances.length > 2) {
      const oldIdx = Math.floor(Math.random() * (instances.length - 1))
      try {
        await instances[oldIdx].query(
          `INSERT INTO rapid_data (instance_num, seq, payload) VALUES ($1, $2, $3)`,
          [oldIdx, i, `inst-${oldIdx}-stale-write-from-cycle-${i}-${pad}`],
        )
      } catch (err) {
        process.send(`stale-write-error-${oldIdx}:${err.message}`)
      }
    }
  }

  process.send('all-instances-created')

  try {
    await Promise.all(
      instances.map((inst, idx) =>
        inst.query(
          `INSERT INTO rapid_data (instance_num, seq, payload) VALUES ($1, $2, $3)`,
          [idx, 999, `inst-${idx}-final-burst-${pad}`],
        ),
      ),
    )
    process.send('final-burst-done')
  } catch (err) {
    process.send(`final-burst-error:${err.message}`)
  }

  process.send('all-done')

  await new Promise(() => {})
}

run().catch((err) => {
  console.error(`Rapid cycling worker error:`, err)
  try {
    process.send(`fatal:${err.message}`)
  } catch (_) {
    /* ignore */
  }
  process.exit(1)
})
