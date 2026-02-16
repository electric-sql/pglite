// Three simultaneous instances on the same data dir, none closed.
// All three write concurrently with stale WASM heaps.

import { PGlite } from '../../../dist/index.js'

const dataDir = process.env.PGLITE_DATA_DIR
const cycle = parseInt(process.env.CYCLE || '0', 10)

async function run() {
  const a = new PGlite(dataDir)
  await a.waitReady
  process.send('instance-a-ready')

  if (cycle === 0) {
    await a.query(`
      CREATE TABLE IF NOT EXISTS triple_data (
        id SERIAL PRIMARY KEY,
        cycle INTEGER NOT NULL,
        instance TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload TEXT NOT NULL
      )
    `)
    await a.query(
      `CREATE INDEX IF NOT EXISTS idx_triple_cycle ON triple_data (cycle)`,
    )
    process.send('schema-created')
  }

  const pad = 'X'.repeat(400)
  for (let i = 0; i < 10; i++) {
    await a.query(
      `INSERT INTO triple_data (cycle, instance, seq, payload) VALUES ($1, $2, $3, $4)`,
      [cycle, 'A', i, `c${cycle}-A-${i}-${pad}`],
    )
  }
  process.send('a-wrote')

  const b = new PGlite(dataDir)
  await b.waitReady
  process.send('instance-b-ready')

  for (let i = 0; i < 10; i++) {
    await b.query(
      `INSERT INTO triple_data (cycle, instance, seq, payload) VALUES ($1, $2, $3, $4)`,
      [cycle, 'B', i, `c${cycle}-B-${i}-${pad}`],
    )
  }
  process.send('b-wrote')

  const c = new PGlite(dataDir)
  await c.waitReady
  process.send('instance-c-ready')

  const writeAll = async (inst, name, start, count) => {
    for (let i = start; i < start + count; i++) {
      await inst.query(
        `INSERT INTO triple_data (cycle, instance, seq, payload) VALUES ($1, $2, $3, $4)`,
        [cycle, name, i, `c${cycle}-${name}-concurrent-${i}-${pad}`],
      )
    }
  }

  await Promise.all([
    writeAll(a, 'A', 100, 20),
    writeAll(b, 'B', 100, 20),
    writeAll(c, 'C', 100, 20),
  ])
  process.send('concurrent-writes-done')

  // Mixed ops: A updates while B and C insert (page conflicts)
  try {
    await Promise.all([
      a.query(
        `UPDATE triple_data SET payload = 'A-updated' WHERE instance = 'A' AND cycle = $1 AND seq < 5`,
        [cycle],
      ),
      b.query(
        `INSERT INTO triple_data (cycle, instance, seq, payload) VALUES ($1, 'B', 200, 'b-extra')`,
        [cycle],
      ),
      c.query(
        `INSERT INTO triple_data (cycle, instance, seq, payload) VALUES ($1, 'C', 200, 'c-extra')`,
        [cycle],
      ),
    ])
  } catch (err) {
    process.send(`mixed-ops-error:${err.message}`)
  }

  process.send('all-done')

  await new Promise(() => {})
}

run().catch((err) => {
  console.error(`Three-instance worker cycle ${cycle} error:`, err)
  try {
    process.send(`fatal:${err.message}`)
  } catch (_) {
    /* ignore */
  }
  process.exit(1)
})
