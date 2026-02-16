// Crash safety test harness: spawn a PGlite worker, kill it, verify recovery.

import { fork } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Spawn a worker, optionally kill it on a message or timer, return results.
 */
export async function crashTest(options) {
  const {
    dataDir,
    workerScript,
    killAfterMs = 500,
    signal = 'SIGKILL',
    env = {},
    killOnMessage = null,
  } = options

  const parentDir = resolve(dataDir, '..')
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolvePromise, rejectPromise) => {
    const messages = []
    let workerError = null
    let killed = false
    let killTimer = null

    const child = fork(workerScript, [], {
      env: {
        ...process.env,
        PGLITE_DATA_DIR: dataDir,
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })

    child.on('message', (msg) => {
      messages.push(msg)

      if (killOnMessage && msg === killOnMessage && !killed) {
        killed = true
        if (killTimer) clearTimeout(killTimer)
        child.kill(signal)
      }
    })

    child.on('error', (err) => {
      workerError = err.message
    })

    child.on('exit', (code, sig) => {
      if (killTimer) clearTimeout(killTimer)
      resolvePromise({
        workerKilled: sig === signal || killed,
        workerError,
        workerMessages: messages,
        workerExitCode: code,
        workerSignal: sig,
        stdout,
        stderr,
      })
    })

    if (!killOnMessage) {
      killTimer = setTimeout(() => {
        if (!killed) {
          killed = true
          child.kill(signal)
        }
      }, killAfterMs)
    }

    // Safety timeout
    setTimeout(() => {
      if (!killed) {
        killed = true
        child.kill('SIGKILL')
      }
    }, 30000)
  })
}

/** Try to open PGlite on a possibly-corrupted data dir. Caller must close db on success. */
export async function tryOpen(dataDir, timeoutMs = 15000) {
  const { PGlite } = await import('../../dist/index.js')

  try {
    const db = new PGlite(dataDir)

    await Promise.race([
      db.waitReady,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `PGlite open timed out after ${timeoutMs}ms (likely corrupted)`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ])

    return { success: true, db, error: null }
  } catch (err) {
    return { success: false, db: null, error: err }
  }
}

/** Run basic integrity checks: health query, table scans, index scans. */
export async function verifyIntegrity(db) {
  const issues = []

  try {
    await db.query('SELECT 1 as health_check')
  } catch (err) {
    issues.push(`Basic query failed: ${err.message}`)
    return { intact: false, issues }
  }

  try {
    const tables = await db.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)

    for (const row of tables.rows) {
      try {
        await db.query(`SELECT count(*) FROM "${row.tablename}"`)
      } catch (err) {
        issues.push(`Count on ${row.tablename} failed: ${err.message}`)
      }
    }
  } catch (err) {
    issues.push(`Table listing failed: ${err.message}`)
  }

  try {
    const indexes = await db.query(`
      SELECT indexname, tablename FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY indexname
    `)

    for (const row of indexes.rows) {
      try {
        await db.query(`SELECT count(*) FROM "${row.tablename}"`)
      } catch (err) {
        issues.push(`Index check on ${row.indexname} failed: ${err.message}`)
      }
    }
  } catch (err) {
    issues.push(`Index listing failed: ${err.message}`)
  }

  return { intact: issues.length === 0, issues }
}

export function cleanupDataDir(dataDir) {
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
  const lockFile = dataDir + '.lock'
  if (existsSync(lockFile)) {
    rmSync(lockFile, { force: true })
  }
}

export function testDataDir(scenarioName) {
  const timestamp = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `/tmp/pglite-crash-${scenarioName}-${timestamp}-${rand}`
}
