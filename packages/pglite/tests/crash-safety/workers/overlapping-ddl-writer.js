// DDL/DML writer: runs DDL or DML ops based on WRITER_MODE env var.
// Killed externally by parent to simulate crash.

import { PGlite } from '../../../dist/index.js'

const dataDir = process.env.PGLITE_DATA_DIR
const mode = process.env.WRITER_MODE || 'dml'
const cycle = parseInt(process.env.CYCLE || '0', 10)

async function run() {
  const pad = 'D'.repeat(300)

  const db = new PGlite(dataDir)
  await db.waitReady
  process.send('ready')

  if (mode === 'ddl') {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ddl_base (
          id SERIAL PRIMARY KEY,
          cycle INTEGER NOT NULL,
          data TEXT NOT NULL
        )
      `)
      process.send('base-table-ready')

      const tbl = `ddl_cycle_${cycle}`
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${tbl} (
          id SERIAL PRIMARY KEY,
          val TEXT NOT NULL,
          num INTEGER DEFAULT 0
        )
      `)
      process.send('new-table-created')

      await db.query(
        `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS extra TEXT DEFAULT 'none'`,
      )
      process.send('alter-done')

      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_${tbl}_val ON ${tbl} (val)`,
      )
      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_${tbl}_num ON ${tbl} (num)`,
      )
      process.send('indexes-created')

      for (let i = 0; i < 30; i++) {
        await db.query(
          `INSERT INTO ${tbl} (val, num, extra) VALUES ($1, $2, $3)`,
          [`val-${i}`, i * 10, `extra-${i}-${pad}`],
        )
      }
      process.send('ddl-inserts-done')

      for (let i = 0; i < 20; i++) {
        await db.query(`INSERT INTO ddl_base (cycle, data) VALUES ($1, $2)`, [
          cycle,
          `ddl-writer-${i}-${pad}`,
        ])
      }
      process.send('ddl-base-inserts-done')
    } catch (err) {
      process.send(`ddl-error:${err.message}`)
    }
  } else {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ddl_base (
          id SERIAL PRIMARY KEY,
          cycle INTEGER NOT NULL,
          data TEXT NOT NULL
        )
      `)
      process.send('base-table-ready')

      for (let i = 0; i < 50; i++) {
        await db.query(`INSERT INTO ddl_base (cycle, data) VALUES ($1, $2)`, [
          cycle,
          `dml-writer-${i}-${pad}`,
        ])
      }
      process.send('dml-inserts-done')

      await db.query(
        `UPDATE ddl_base SET data = data || '-updated' WHERE cycle = $1`,
        [cycle],
      )
      process.send('dml-updates-done')

      await db.query(`DELETE FROM ddl_base WHERE cycle = $1 AND id % 3 = 0`, [
        cycle,
      ])
      process.send('dml-deletes-done')
    } catch (err) {
      process.send(`dml-error:${err.message}`)
    }
  }

  process.send('all-done')

  await new Promise(() => {})
}

run().catch((err) => {
  console.error(`DDL writer (${mode}) cycle ${cycle} error:`, err)
  try {
    process.send(`fatal:${err.message}`)
  } catch (_) {
    /* ignore */
  }
  process.exit(1)
})
