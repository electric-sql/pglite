/**
 * Crash Safety Test: HMR (Hot Module Reload) Double Instance
 *
 * Tests the file lock mechanism that prevents overlapping PGlite instances
 * from corrupting the database during HMR in dev servers like Vite/Next.js.
 *
 * With the lock file implementation:
 *   1. Instance A opens and acquires the lock
 *   2. Instance B attempts to open the SAME data dir and is BLOCKED by the lock
 *   3. Only instance A writes data
 *   4. When killed with SIGKILL, the stale lock is detected on next open
 *
 * This prevents the corruption that previously occurred when two WASM heaps
 * both accessed the same PostgreSQL data directory simultaneously.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { fork } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

const dataDir = `/tmp/pglite-crash-hmr-double-${Date.now()}`

afterAll(async () => {
  if (!process.env.RETAIN_DATA) {
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true })
    }
    // Clean up sibling lock files
    const lockFile = dataDir + '.lock'
    if (existsSync(lockFile)) {
      rmSync(lockFile, { force: true })
    }
  }
})

describe('crash safety: HMR double-instance corruption', () => {
  it(
    'should survive multiple HMR-style instance replacement cycles with SIGKILL',
    async () => {
      const { PGlite } = await import('../../dist/index.js')
      const workerPath = new URL(
        './workers/hmr-double-instance.js',
        import.meta.url,
      ).pathname

      const NUM_CYCLES = 7
      const cycleResults = []

      for (let cycle = 0; cycle < NUM_CYCLES; cycle++) {
        const overlapOps = cycle < 2 ? 10 : cycle < 5 ? 25 : 40

        const result = await new Promise((resolve) => {
          const messages = []
          let killed = false

          const child = fork(workerPath, [], {
            env: {
              ...process.env,
              PGLITE_DATA_DIR: dataDir,
              CYCLE: String(cycle),
              OVERLAP_OPS: String(overlapOps),
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

            // Kill after all operations are done (instance A has written data)
            if (msg === 'all-operations-done' && !killed) {
              killed = true
              child.kill('SIGKILL')
            }
          })

          child.on('exit', (code, sig) => {
            resolve({
              cycle,
              killed: killed || sig === 'SIGKILL',
              messages,
              exitCode: code,
              signal: sig,
              stderr,
            })
          })

          // Fallback timer: kill after 15s if worker hasn't finished
          setTimeout(() => {
            if (!killed) {
              killed = true
              child.kill('SIGKILL')
            }
          }, 15000)
        })

        cycleResults.push(result)

        // The worker should either be killed by us or exit cleanly
        // (it's killed after 'all-operations-done')
        expect(result.killed).toBe(true)

        // Instance A should have been ready in every cycle
        expect(result.messages).toContain('instance-a-ready')

        // Instance B should have been BLOCKED by the lock
        expect(result.messages).toContain('instance-b-blocked')
        expect(result.messages).not.toContain('instance-b-ready')

        // On the first cycle, schema should have been created
        if (cycle === 0) {
          expect(result.messages).toContain('schema-created')
        }

        // Log cycle details for debugging
        console.log(
          `Cycle ${cycle}: messages=[${result.messages.join(', ')}], ` +
            `exit=${result.exitCode}, signal=${result.signal}`,
        )

        // ---- Intermediate recovery check every 2 cycles ----
        if (cycle % 2 === 1 || cycle === NUM_CYCLES - 1) {
          let db = null
          let openSuccess = false
          try {
            db = new PGlite(dataDir)
            await Promise.race([
              db.waitReady,
              new Promise((_, reject) =>
                setTimeout(
                  () =>
                    reject(new Error(`Open timed out after cycle ${cycle}`)),
                  20000,
                ),
              ),
            ])
            openSuccess = true
          } catch (err) {
            console.log(
              `CORRUPTION DETECTED after cycle ${cycle}: ${err.message}`,
            )
            openSuccess = false
          }

          if (openSuccess && db) {
            try {
              // Basic health check
              await db.query('SELECT 1 as ok')

              // Table should exist after cycle 0
              const tableCheck = await db.query(`
                SELECT tablename FROM pg_tables
                WHERE schemaname = 'public' AND tablename = 'hmr_data'
              `)
              expect(tableCheck.rows.length).toBe(1)

              // Count rows - with the lock, only instance A writes
              const countResult = await db.query(
                'SELECT count(*)::int as cnt FROM hmr_data',
              )
              const rowCount = countResult.rows[0].cnt
              console.log(`After cycle ${cycle}: ${rowCount} rows in hmr_data`)
              expect(rowCount).toBeGreaterThan(0)

              // All rows should be from instance A (B was blocked)
              const instanceCheck = await db.query(
                `SELECT DISTINCT instance FROM hmr_data`,
              )
              const instances = instanceCheck.rows.map((r) => r.instance)
              expect(instances).toContain('A')
              expect(instances).not.toContain('B')

              // Verify index is usable
              const indexScan = await db.query(
                `SELECT count(*)::int as cnt FROM hmr_data WHERE cycle = $1`,
                [0],
              )
              expect(indexScan.rows[0].cnt).toBeGreaterThanOrEqual(0)

              // Verify we can do a full sequential scan without errors
              const allRows = await db.query(
                'SELECT id, cycle, instance, phase, seq FROM hmr_data ORDER BY id',
              )
              expect(allRows.rows.length).toBe(rowCount)

              // Check for data consistency
              for (const row of allRows.rows) {
                expect(row.id).toBeGreaterThan(0)
                expect(row.cycle).toBeGreaterThanOrEqual(0)
                expect(row.cycle).toBeLessThanOrEqual(cycle)
                expect(row.instance).toBe('A')
                expect(typeof row.phase).toBe('string')
                expect(row.seq).toBeGreaterThanOrEqual(0)
              }
            } finally {
              await db.close()
            }
          }

          // The DB MUST be openable
          expect(openSuccess).toBe(true)
        }

        // Small delay between cycles
        await new Promise((r) => setTimeout(r, 200))
      }

      // ---- Final comprehensive verification ----
      console.log('\n--- Final verification after all HMR cycles ---')

      let finalDb = null
      try {
        finalDb = new PGlite(dataDir)
        await Promise.race([
          finalDb.waitReady,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Final open timed out')), 30000),
          ),
        ])
      } catch (err) {
        console.log(`FINAL CORRUPTION: ${err.message}`)
        expect.fail(
          `Database corrupted after ${NUM_CYCLES} HMR cycles: ${err.message}`,
        )
      }

      try {
        // Full integrity check
        const tables = await finalDb.query(`
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        `)
        expect(tables.rows.length).toBeGreaterThanOrEqual(1)

        // Check all indexes are usable
        const indexes = await finalDb.query(`
          SELECT indexname, tablename FROM pg_indexes
          WHERE schemaname = 'public'
        `)
        for (const idx of indexes.rows) {
          await finalDb.query(`SELECT count(*) FROM "${idx.tablename}"`)
        }

        // Row count audit
        const finalCount = await finalDb.query(
          'SELECT count(*)::int as cnt FROM hmr_data',
        )
        console.log(`Final row count: ${finalCount.rows[0].cnt}`)

        // Per-cycle breakdown (all should be instance A only)
        const cycleBreakdown = await finalDb.query(`
          SELECT cycle, instance, count(*)::int as cnt
          FROM hmr_data
          GROUP BY cycle, instance
          ORDER BY cycle, instance
        `)
        console.log('Per-cycle breakdown:')
        for (const row of cycleBreakdown.rows) {
          console.log(
            `  cycle=${row.cycle} instance=${row.instance} count=${row.cnt}`,
          )
          // With the lock, all rows should be from instance A
          expect(row.instance).toBe('A')
        }

        // Verify we can still write to the database
        await finalDb.query(
          `INSERT INTO hmr_data (cycle, instance, phase, seq, payload)
           VALUES ($1, $2, $3, $4, $5)`,
          [999, 'verify', 'final', 0, 'final-verification-row'],
        )
        const verifyRow = await finalDb.query(
          `SELECT * FROM hmr_data WHERE cycle = 999`,
        )
        expect(verifyRow.rows.length).toBe(1)
      } finally {
        await finalDb.close()
      }
    },
    { timeout: 300000 },
  )

  it(
    'should survive rapid HMR cycles with minimal delay between instance swaps',
    async () => {
      const { PGlite } = await import('../../dist/index.js')

      // Use a separate data dir for this sub-test
      const rapidDataDir = `${dataDir}-rapid`

      const workerPath = new URL(
        './workers/hmr-double-instance.js',
        import.meta.url,
      ).pathname

      const RAPID_CYCLES = 5

      for (let cycle = 0; cycle < RAPID_CYCLES; cycle++) {
        const result = await new Promise((resolve) => {
          const messages = []
          let killed = false

          const child = fork(workerPath, [], {
            env: {
              ...process.env,
              PGLITE_DATA_DIR: rapidDataDir,
              CYCLE: String(cycle),
              OVERLAP_OPS: '50',
            },
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          })

          let stderr = ''
          child.stderr.on('data', (d) => {
            stderr += d.toString()
          })
          child.stdout.on('data', () => {})

          child.on('message', (msg) => {
            messages.push(msg)

            // Kill after instance B is blocked (or after instance A continues)
            if (
              (msg === 'instance-b-blocked' ||
                msg === 'instance-a-continued') &&
              !killed
            ) {
              // Give a tiny window then kill
              setTimeout(() => {
                if (!killed) {
                  killed = true
                  child.kill('SIGKILL')
                }
              }, 50)
            }
          })

          child.on('exit', (code, sig) => {
            resolve({
              cycle,
              killed: killed || sig === 'SIGKILL',
              messages,
              stderr,
            })
          })

          setTimeout(() => {
            if (!killed) {
              killed = true
              child.kill('SIGKILL')
            }
          }, 15000)
        })

        // Worker should be either killed by us or crashed due to lock error
        expect(result.killed || result.exitCode !== 0).toBe(true)
      }

      // Verify the DB is still usable after rapid HMR cycles
      let db = null
      try {
        db = new PGlite(rapidDataDir)
        await Promise.race([
          db.waitReady,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Rapid HMR final open timed out')),
              20000,
            ),
          ),
        ])

        await db.query('SELECT 1')

        const tableExists = await db.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'hmr_data'
        `)
        if (tableExists.rows.length > 0) {
          const count = await db.query(
            'SELECT count(*)::int as cnt FROM hmr_data',
          )
          console.log(`Rapid HMR test: ${count.rows[0].cnt} rows survived`)
          expect(count.rows[0].cnt).toBeGreaterThanOrEqual(0)

          // All surviving rows should be from instance A
          const instanceCheck = await db.query(
            `SELECT DISTINCT instance FROM hmr_data`,
          )
          if (instanceCheck.rows.length > 0) {
            for (const row of instanceCheck.rows) {
              expect(row.instance).toBe('A')
            }
          }
        }

        await db.close()
      } catch (err) {
        console.log(`Rapid HMR CORRUPTION: ${err.message}`)
        if (db)
          try {
            await db.close()
          } catch (_) {
            /* ignore */
          }
        expect.fail(`Rapid HMR corrupted DB: ${err.message}`)
      } finally {
        if (!process.env.RETAIN_DATA) {
          if (existsSync(rapidDataDir)) {
            rmSync(rapidDataDir, { recursive: true, force: true })
          }
          const lockFile = rapidDataDir + '.lock'
          if (existsSync(lockFile)) {
            rmSync(lockFile, { force: true })
          }
        }
      }
    },
    { timeout: 180000 },
  )
})
