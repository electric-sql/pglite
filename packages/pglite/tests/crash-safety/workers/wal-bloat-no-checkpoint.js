// WAL bloat: heavy INSERT/UPDATE/DELETE without ever calling close() or CHECKPOINT.
// Parent SIGKILLs at random points. Tests recovery under extreme WAL pressure
// with complex entries (DDL, partial indexes, scatter updates).

import { PGlite } from '../../../dist/index.js'

const dataDir = process.env.PGLITE_DATA_DIR
const innerCycles = parseInt(process.env.INNER_CYCLES || '10', 10)
const startCycle = parseInt(process.env.START_CYCLE || '0', 10)

let seed = startCycle * 1000 + 42
function nextRand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed
}

async function run() {
  const db = new PGlite(dataDir)
  await db.waitReady
  process.send('ready')

  // Idempotent — prior cycle may have been killed mid-schema-creation
  await db.query(`
    CREATE TABLE IF NOT EXISTS wal_stress (
      id SERIAL PRIMARY KEY,
      cycle INTEGER NOT NULL,
      batch INTEGER NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_wal_stress_cycle ON wal_stress (cycle)
  `)
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_wal_stress_kind ON wal_stress (kind)
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS wal_stress_log (
      id SERIAL PRIMARY KEY,
      cycle INTEGER NOT NULL,
      operation TEXT NOT NULL,
      row_count INTEGER,
      logged_at TIMESTAMP DEFAULT NOW()
    )
  `)
  process.send('schema-created')

  for (let c = 0; c < innerCycles; c++) {
    const cycleNum = startCycle + c
    process.send(`cycle-start:${cycleNum}`)

    const padding = 'W'.repeat(800)
    for (let i = 0; i < 50; i++) {
      const kind = ['alpha', 'beta', 'gamma', 'delta'][nextRand() % 4]
      await db.query(
        `INSERT INTO wal_stress (cycle, batch, kind, value, counter)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          cycleNum,
          i,
          kind,
          `c${cycleNum}-b${i}-${kind}-${padding}`,
          nextRand() % 10000,
        ],
      )
    }
    process.send(`inserts-done:${cycleNum}`)

    const kinds = ['alpha', 'beta', 'gamma', 'delta']
    const targetKind = kinds[nextRand() % 4]
    await db.query(
      `UPDATE wal_stress
       SET counter = counter + $1, value = value || $2, updated_at = NOW()
       WHERE kind = $3`,
      [nextRand() % 100, `-upd${cycleNum}`, targetKind],
    )

    const updateCycle = nextRand() % (cycleNum + 1)
    await db.query(
      `UPDATE wal_stress
       SET counter = counter + 1
       WHERE cycle = $1 AND batch < 25`,
      [updateCycle],
    )

    const step = (nextRand() % 5) + 2
    await db.query(
      `UPDATE wal_stress
       SET value = LEFT(value, 200) || $1
       WHERE id % $2 = 0`,
      [`-scatter${cycleNum}`, step],
    )

    process.send(`updates-done:${cycleNum}`)

    if (cycleNum > 2) {
      const deleteCycle = nextRand() % Math.max(1, cycleNum - 1)
      const deleteLimit = (nextRand() % 15) + 5
      await db.query(
        `DELETE FROM wal_stress
         WHERE id IN (
           SELECT id FROM wal_stress
           WHERE cycle = $1 AND batch >= $2
           ORDER BY id
           LIMIT $3
         )`,
        [deleteCycle, 30, deleteLimit],
      )
    }

    if (cycleNum % 3 === 0) {
      await db.query(
        `DELETE FROM wal_stress
         WHERE kind = $1 AND cycle < $2 AND batch > 40`,
        [kinds[nextRand() % 4], cycleNum],
      )
    }

    process.send(`deletes-done:${cycleNum}`)

    await db.query(
      `INSERT INTO wal_stress_log (cycle, operation, row_count)
       VALUES ($1, $2, (SELECT count(*) FROM wal_stress))`,
      [cycleNum, 'full-cycle'],
    )

    // Occasional DDL to diversify WAL entries
    if (cycleNum % 5 === 0 && cycleNum > 0) {
      const colName = `extra_${cycleNum}`
      await db.query(`
        ALTER TABLE wal_stress ADD COLUMN IF NOT EXISTS ${colName} TEXT DEFAULT NULL
      `)

      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_wal_stress_c${cycleNum}
        ON wal_stress (counter)
        WHERE cycle = ${cycleNum}
      `)

      process.send(`ddl-done:${cycleNum}`)
    }

    if (cycleNum % 4 === 0) {
      await db.query(
        `UPDATE wal_stress
         SET counter = counter + $1
         WHERE cycle >= $2`,
        [1, Math.max(0, cycleNum - 3)],
      )
    }

    process.send(`cycle-done:${cycleNum}`)
  }

  process.send('all-cycles-done')

  // No close() or CHECKPOINT — keep alive for SIGKILL.
  // setInterval needed because a bare Promise doesn't keep Node alive.
  setInterval(() => {}, 60000)
  await new Promise(() => {})
}

run().catch((err) => {
  console.error(`WAL bloat worker error:`, err)
  try {
    process.send(`fatal:${err.message}`)
  } catch (_) {
    /* ignore */
  }
  process.exit(1)
})
