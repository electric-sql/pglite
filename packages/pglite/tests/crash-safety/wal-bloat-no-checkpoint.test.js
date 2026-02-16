/**
 * Crash Safety Test: WAL Bloat Without Checkpoint
 *
 * This test targets the most insidious corruption vector: accumulated WAL
 * entries that never get checkpointed because close() is never called.
 *
 * In real dev usage, developers:
 *   1. Start their app (PGlite opens, creates tables, inserts data)
 *   2. Kill the process (Ctrl+C, crash, OOM, etc.) -- no close(), no checkpoint
 *   3. Restart, repeat -- each time more WAL accumulates
 *   4. After many such cycles, the WAL is enormous and recovery becomes fragile
 *
 * PostgreSQL's WAL recovery is designed to replay from the last checkpoint.
 * But when there's NEVER a checkpoint (because close() never runs and
 * _pgl_shutdown() never fires), the WAL grows unbounded and recovery must
 * replay from the very beginning.
 *
 * This test runs 30+ kill cycles, each adding heavy mixed DML (INSERT, UPDATE,
 * DELETE) with ~1KB rows, index modifications, and schema changes. The worker
 * is SIGKILL'd every time before close() can run.
 *
 * After all cycles, we verify the database can still open and is consistent.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { fork } from 'node:child_process'
import { existsSync, rmSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dataDir = `/tmp/pglite-crash-wal-bloat-${Date.now()}`

afterAll(async () => {
  if (!process.env.RETAIN_DATA) {
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }
})

/**
 * Recursively compute the total size of a directory in bytes.
 */
function dirSizeBytes(dir) {
  let total = 0
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += dirSizeBytes(fullPath)
      } else if (entry.isFile()) {
        total += statSync(fullPath).size
      }
    }
  } catch {
    // directory may not exist yet
  }
  return total
}

/**
 * Spawn worker, let it run inner cycles, then SIGKILL.
 */
function runWorkerAndKill(workerPath, cycle, innerCycles, killStrategy) {
  return new Promise((resolve) => {
    const messages = []
    let killed = false
    let killTimer = null

    const child = fork(workerPath, [], {
      env: {
        ...process.env,
        PGLITE_DATA_DIR: dataDir,
        INNER_CYCLES: String(innerCycles),
        START_CYCLE: String(cycle),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })

    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.stdout.on('data', () => {}) // drain

    child.on('message', (msg) => {
      messages.push(msg)

      if (
        killStrategy.onMessage &&
        msg.startsWith(killStrategy.onMessage) &&
        !killed
      ) {
        killed = true
        if (killTimer) clearTimeout(killTimer)
        child.kill('SIGKILL')
      }
    })

    child.on('exit', (code, sig) => {
      if (killTimer) clearTimeout(killTimer)
      resolve({
        cycle,
        killed: killed || sig === 'SIGKILL',
        messages,
        exitCode: code,
        signal: sig,
        stderr,
      })
    })

    // Timer-based kill if no message trigger
    if (killStrategy.afterMs && !killStrategy.onMessage) {
      killTimer = setTimeout(() => {
        if (!killed) {
          killed = true
          child.kill('SIGKILL')
        }
      }, killStrategy.afterMs)
    }

    // Safety timeout
    setTimeout(() => {
      if (!killed) {
        killed = true
        child.kill('SIGKILL')
      }
    }, 60000)
  })
}

describe('crash safety: WAL bloat without checkpoint (30+ kill cycles)', () => {
  it(
    'should survive 35 kill cycles of heavy DML without any checkpoint',
    async () => {
      const { PGlite } = await import('../../dist/index.js')
      const workerPath = new URL(
        './workers/wal-bloat-no-checkpoint.js',
        import.meta.url,
      ).pathname

      const TOTAL_OUTER_CYCLES = 35
      const allResults = []

      // Track data dir size growth over time
      const sizeHistory = []

      // Track the cumulative start cycle for worker numbering
      let nextStartCycle = 0

      for (let outerCycle = 0; outerCycle < TOTAL_OUTER_CYCLES; outerCycle++) {
        // Vary the kill strategy to hit different points in the DML cycle:
        //   - Early cycles: kill after schema + first inserts (mid-DML)
        //   - Middle cycles: kill after inserts but before updates complete
        //   - Late cycles: kill after full cycles complete but before close()
        //   - Some cycles: kill on a timer for unpredictable timing

        let innerCycles
        let killStrategy
        const startCycle = nextStartCycle

        if (outerCycle === 0) {
          // First cycle: let schema creation + first batch complete
          innerCycles = 2
          killStrategy = { onMessage: `cycle-done:${startCycle + 1}` }
        } else if (outerCycle < 5) {
          // Kill mid-insert (after first inner cycle's inserts)
          innerCycles = 3
          killStrategy = { onMessage: `inserts-done:${startCycle + 1}` }
        } else if (outerCycle < 10) {
          // Kill mid-update
          innerCycles = 2
          killStrategy = { onMessage: `updates-done:${startCycle}` }
        } else if (outerCycle < 15) {
          // Kill mid-delete
          innerCycles = 2
          killStrategy = { onMessage: `deletes-done:${startCycle}` }
        } else if (outerCycle < 20) {
          // Kill after a full cycle completes (dirty but "consistent" state)
          innerCycles = 3
          killStrategy = { onMessage: `cycle-done:${startCycle}` }
        } else if (outerCycle < 25) {
          // Timer-based kill for unpredictable timing (500ms-2000ms)
          innerCycles = 4
          killStrategy = { afterMs: 500 + outerCycle * 60 }
        } else if (outerCycle < 30) {
          // Let many cycles run, kill after all are done (max WAL, no checkpoint)
          innerCycles = 5
          killStrategy = { onMessage: 'all-cycles-done' }
        } else {
          // Final stretch: aggressive timer kills (200ms)
          innerCycles = 3
          killStrategy = { afterMs: 200 }
        }

        nextStartCycle += innerCycles

        const result = await runWorkerAndKill(
          workerPath,
          startCycle,
          innerCycles,
          killStrategy,
        )

        allResults.push(result)

        // Track directory size
        const currentSize = dirSizeBytes(dataDir)
        sizeHistory.push({ outerCycle, sizeBytes: currentSize })

        // Log progress every 5 cycles
        if (outerCycle % 5 === 0 || outerCycle === TOTAL_OUTER_CYCLES - 1) {
          const sizeMB = (currentSize / 1024 / 1024).toFixed(2)
          const messagesPreview = result.messages.slice(0, 5).join(', ')
          console.log(
            `Outer cycle ${outerCycle}/${TOTAL_OUTER_CYCLES}: ` +
              `size=${sizeMB}MB, killed=${result.killed}, ` +
              `messages=[${messagesPreview}...]`,
          )
        }

        // The worker should have been killed OR crashed (crashing on open
        // is itself evidence of corruption from previous cycles)
        const workerCrashedOrKilled = result.killed || result.exitCode !== 0
        if (!result.killed && result.exitCode !== 0) {
          console.log(
            `  Worker CRASHED on its own at outer cycle ${outerCycle} (exit=${result.exitCode}): ${result.stderr.slice(0, 200)}`,
          )
          // If the worker can't even open the DB, that's corruption — skip remaining cycles
          if (
            result.messages.length === 0 ||
            !result.messages.includes('ready')
          ) {
            console.log(
              `  CORRUPTION: Worker couldn't open DB at outer cycle ${outerCycle}`,
            )
            break
          }
        }
        expect(workerCrashedOrKilled).toBe(true)

        // For message-based kills, the worker MUST have started (it sent the trigger)
        // For timer-based kills, the worker may not have had time to open the DB
        // (especially after WAL bloat makes recovery slow) — that's OK
        if (result.killed && !killStrategy.afterMs) {
          const started =
            result.messages.includes('ready') ||
            result.messages.includes('schema-created') ||
            result.messages.some((m) => m.startsWith('cycle-start:'))
          expect(started).toBe(true)
        } else if (
          result.killed &&
          killStrategy.afterMs &&
          result.messages.length === 0
        ) {
          // Worker couldn't even open before timer — WAL bloat is severe
          console.log(
            `  WAL BLOAT: Worker couldn't open DB within ${killStrategy.afterMs}ms at outer cycle ${outerCycle}`,
          )
        }

        // Intermediate verification every 10 cycles to catch progressive corruption
        if (outerCycle > 0 && outerCycle % 10 === 0) {
          console.log(
            `\n--- Intermediate check after outer cycle ${outerCycle} ---`,
          )
          let checkDb = null
          try {
            checkDb = new PGlite(dataDir)
            await Promise.race([
              checkDb.waitReady,
              new Promise((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        `Intermediate open timed out at cycle ${outerCycle}`,
                      ),
                    ),
                  30000,
                ),
              ),
            ])

            // Basic health
            await checkDb.query('SELECT 1')

            // Count rows
            const count = await checkDb.query(
              'SELECT count(*)::int as cnt FROM wal_stress',
            )
            console.log(`  wal_stress rows: ${count.rows[0].cnt}`)

            const logCount = await checkDb.query(
              'SELECT count(*)::int as cnt FROM wal_stress_log',
            )
            console.log(`  wal_stress_log rows: ${logCount.rows[0].cnt}`)

            // Verify indexes work
            await checkDb.query(
              `SELECT count(*) FROM wal_stress WHERE kind = 'alpha'`,
            )
            await checkDb.query(
              `SELECT count(*) FROM wal_stress WHERE cycle = 0`,
            )

            // Full sequential scan
            const allRows = await checkDb.query(
              'SELECT id, cycle, batch, kind FROM wal_stress ORDER BY id',
            )
            expect(allRows.rows.length).toBe(count.rows[0].cnt)

            await checkDb.close()

            // IMPORTANT: After this close(), a checkpoint DOES run.
            // This resets the WAL accumulation. For the purest test of
            // "never checkpointed" WAL, we only do this check occasionally.
            console.log(`  (checkpoint occurred due to close() -- WAL reset)`)
          } catch (err) {
            console.log(`  CORRUPTION at cycle ${outerCycle}: ${err.message}`)
            if (checkDb)
              try {
                await checkDb.close()
              } catch (_) {
                /* ignore */
              }
            expect.fail(
              `DB corrupted after ${outerCycle} kill cycles: ${err.message}`,
            )
          }
        }

        // No delay between cycles - maximum aggression
      }

      // ---- Final comprehensive verification ----
      console.log('\n====== FINAL VERIFICATION ======')
      console.log(`Completed ${TOTAL_OUTER_CYCLES} outer kill cycles`)
      console.log(`Data dir size history:`)
      for (const s of sizeHistory.filter(
        (_, i) => i % 5 === 0 || i === sizeHistory.length - 1,
      )) {
        console.log(
          `  Cycle ${s.outerCycle}: ${(s.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
        )
      }

      const finalSize = dirSizeBytes(dataDir)
      console.log(
        `Final data dir size: ${(finalSize / 1024 / 1024).toFixed(2)} MB`,
      )

      let finalDb = null
      try {
        finalDb = new PGlite(dataDir)
        await Promise.race([
          finalDb.waitReady,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Final open timed out (WAL bloat)')),
              60000,
            ),
          ),
        ])
      } catch (err) {
        console.log(
          `FINAL CORRUPTION after ${TOTAL_OUTER_CYCLES} cycles: ${err.message}`,
        )
        expect.fail(`DB corrupted after all WAL bloat cycles: ${err.message}`)
      }

      try {
        // Health check
        await finalDb.query('SELECT 1 as ok')

        // Verify tables exist
        const tables = await finalDb.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
          ORDER BY tablename
        `)
        const tableNames = tables.rows.map((r) => r.tablename)
        expect(tableNames).toContain('wal_stress')
        expect(tableNames).toContain('wal_stress_log')
        console.log(`Tables: ${tableNames.join(', ')}`)

        // Row counts
        const stressCount = await finalDb.query(
          'SELECT count(*)::int as cnt FROM wal_stress',
        )
        const logCount = await finalDb.query(
          'SELECT count(*)::int as cnt FROM wal_stress_log',
        )
        console.log(`wal_stress rows: ${stressCount.rows[0].cnt}`)
        console.log(`wal_stress_log rows: ${logCount.rows[0].cnt}`)
        expect(stressCount.rows[0].cnt).toBeGreaterThan(0)

        // Index verification
        const indexes = await finalDb.query(`
          SELECT indexname, tablename FROM pg_indexes
          WHERE schemaname = 'public'
          ORDER BY indexname
        `)
        console.log(
          `Indexes: ${indexes.rows.map((r) => r.indexname).join(', ')}`,
        )
        for (const idx of indexes.rows) {
          await finalDb.query(`SELECT count(*) FROM "${idx.tablename}"`)
        }

        // Full sequential scan of wal_stress
        const allRows = await finalDb.query(
          'SELECT id, cycle, batch, kind, counter FROM wal_stress ORDER BY id',
        )
        expect(allRows.rows.length).toBe(stressCount.rows[0].cnt)

        // Verify data integrity: no NULLs in NOT NULL columns
        for (const row of allRows.rows) {
          expect(row.id).not.toBeNull()
          expect(row.cycle).not.toBeNull()
          expect(row.batch).not.toBeNull()
          expect(row.kind).not.toBeNull()
          expect(['alpha', 'beta', 'gamma', 'delta']).toContain(row.kind)
        }

        // Aggregate checks
        const kindCounts = await finalDb.query(`
          SELECT kind, count(*)::int as cnt, avg(counter)::int as avg_counter
          FROM wal_stress
          GROUP BY kind
          ORDER BY kind
        `)
        console.log('Kind distribution:')
        for (const row of kindCounts.rows) {
          console.log(
            `  ${row.kind}: ${row.cnt} rows, avg_counter=${row.avg_counter}`,
          )
        }

        // Verify cycle distribution (should span multiple cycles)
        const cycleDist = await finalDb.query(`
          SELECT min(cycle)::int as min_cycle, max(cycle)::int as max_cycle,
                 count(DISTINCT cycle)::int as distinct_cycles
          FROM wal_stress
        `)
        console.log(
          `Cycle range: ${cycleDist.rows[0].min_cycle} - ${cycleDist.rows[0].max_cycle}, ` +
            `${cycleDist.rows[0].distinct_cycles} distinct cycles`,
        )
        expect(cycleDist.rows[0].distinct_cycles).toBeGreaterThan(1)

        // Verify log table integrity
        const logRows = await finalDb.query(
          'SELECT id, cycle, operation, row_count FROM wal_stress_log ORDER BY id',
        )
        expect(logRows.rows.length).toBe(logCount.rows[0].cnt)
        for (const row of logRows.rows) {
          expect(row.operation).toBe('full-cycle')
          expect(row.row_count).toBeGreaterThan(0)
        }

        // Verify we can still write after recovery
        await finalDb.query(
          `INSERT INTO wal_stress (cycle, batch, kind, value, counter)
           VALUES ($1, $2, $3, $4, $5)`,
          [99999, 0, 'alpha', 'final-verification-row', 0],
        )
        const verifyRow = await finalDb.query(
          `SELECT * FROM wal_stress WHERE cycle = 99999`,
        )
        expect(verifyRow.rows.length).toBe(1)

        // Verify we can still UPDATE after recovery
        await finalDb.query(
          `UPDATE wal_stress SET counter = -1 WHERE cycle = 99999`,
        )
        const updatedRow = await finalDb.query(
          `SELECT counter FROM wal_stress WHERE cycle = 99999`,
        )
        expect(updatedRow.rows[0].counter).toBe(-1)

        // Verify we can still DELETE after recovery
        await finalDb.query(`DELETE FROM wal_stress WHERE cycle = 99999`)
        const deletedRow = await finalDb.query(
          `SELECT count(*)::int as cnt FROM wal_stress WHERE cycle = 99999`,
        )
        expect(deletedRow.rows[0].cnt).toBe(0)
      } finally {
        await finalDb.close()
      }
    },
    { timeout: 300000 },
  )

  it(
    'should survive burst-mode: 15 extremely rapid kill cycles with no delay',
    async () => {
      const { PGlite } = await import('../../dist/index.js')
      const burstDataDir = `${dataDir}-burst`
      const workerPath = new URL(
        './workers/wal-bloat-no-checkpoint.js',
        import.meta.url,
      ).pathname

      const BURST_CYCLES = 15

      for (let i = 0; i < BURST_CYCLES; i++) {
        // Each burst cycle: open, do 1-2 inner cycles of heavy DML, SIGKILL
        // Kill very aggressively: 300ms timer (may kill mid-INSERT)
        const burstResult = await new Promise((resolve) => {
          const messages = []
          let killed = false

          const child = fork(workerPath, [], {
            env: {
              ...process.env,
              PGLITE_DATA_DIR: burstDataDir,
              INNER_CYCLES: '2',
              START_CYCLE: String(i * 2),
            },
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          })

          child.stderr.on('data', () => {})
          child.stdout.on('data', () => {})

          child.on('message', (msg) => {
            messages.push(msg)
          })

          child.on('exit', (code, sig) => {
            resolve({
              killed: killed || sig === 'SIGKILL',
              exitCode: code,
              messages,
            })
          })

          // Very aggressive: kill after 300ms no matter what
          setTimeout(() => {
            if (!killed) {
              killed = true
              child.kill('SIGKILL')
            }
          }, 300)

          // Safety
          setTimeout(() => {
            if (!killed) {
              killed = true
              child.kill('SIGKILL')
            }
          }, 30000)
        })

        // Worker should either be killed by timer, crash on open, or crash during DML
        const workerKilled = burstResult.killed
        const workerCrashed =
          burstResult.exitCode !== 0 && burstResult.exitCode !== null
        const workerCouldntOpen = !burstResult.messages.includes('ready')

        if (workerCouldntOpen && !workerKilled) {
          console.log(
            `  Burst cycle ${i}: Worker couldn't open DB (corruption from previous cycles)`,
          )
          break // DB is corrupted, no point continuing
        }

        // The worker must have been killed OR crashed (either before or after opening)
        expect(workerKilled || workerCrashed || workerCouldntOpen).toBe(true)
      }

      // Verify after burst
      console.log('\n--- Burst mode verification ---')
      const burstSize = dirSizeBytes(burstDataDir)
      console.log(
        `Burst data dir size: ${(burstSize / 1024 / 1024).toFixed(2)} MB`,
      )

      let db = null
      try {
        db = new PGlite(burstDataDir)
        await Promise.race([
          db.waitReady,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Burst mode final open timed out')),
              30000,
            ),
          ),
        ])

        await db.query('SELECT 1')

        // The table may or may not exist depending on whether the first
        // cycle's schema creation completed before the 300ms kill
        const tableCheck = await db.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'wal_stress'
        `)

        if (tableCheck.rows.length > 0) {
          const count = await db.query(
            'SELECT count(*)::int as cnt FROM wal_stress',
          )
          console.log(`Burst mode rows: ${count.rows[0].cnt}`)

          // Full scan
          const rows = await db.query(
            'SELECT id, cycle, kind FROM wal_stress ORDER BY id',
          )
          expect(rows.rows.length).toBe(count.rows[0].cnt)
        } else {
          // Table doesn't exist = schema creation was killed every time.
          // This is a valid outcome, not corruption.
          console.log('Burst mode: schema never completed (killed too fast)')
        }

        // Verify DB is writable
        await db.query(`
          CREATE TABLE IF NOT EXISTS burst_verify (id SERIAL PRIMARY KEY, ok BOOLEAN)
        `)
        await db.query(`INSERT INTO burst_verify (ok) VALUES (true)`)
        const verify = await db.query('SELECT ok FROM burst_verify')
        expect(verify.rows[0].ok).toBe(true)

        await db.close()
      } catch (err) {
        console.log(`Burst mode CORRUPTION: ${err.message}`)
        if (db)
          try {
            await db.close()
          } catch (_) {
            /* ignore */
          }
        expect.fail(`Burst mode corrupted DB: ${err.message}`)
      } finally {
        if (!process.env.RETAIN_DATA) {
          if (existsSync(burstDataDir)) {
            rmSync(burstDataDir, { recursive: true, force: true })
          }
          const lockFile = burstDataDir + '.lock'
          if (existsSync(lockFile)) {
            rmSync(lockFile, { force: true })
          }
        }
      }
    },
    { timeout: 180000 },
  )
})
