import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'

const dataDir = `/tmp/pglite-lock-test-${Date.now()}`

afterAll(async () => {
  if (!process.env.RETAIN_DATA) {
    for (const p of [dataDir, dataDir + '.lock']) {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true })
    }
  }
})

describe('NodeFS data directory locking', () => {
  it('should block a second instance from opening the same data directory', async () => {
    const { PGlite } = await import('../dist/index.js')

    const db1 = new PGlite(dataDir)
    await db1.waitReady

    // Lock file should exist while db1 is open
    expect(existsSync(dataDir + '.lock')).toBe(true)

    // Second instance on same dir must throw
    let lockError = null
    try {
      const db2 = new PGlite(dataDir)
      await db2.waitReady
      await db2.close()
    } catch (err) {
      lockError = err
    }

    expect(lockError).not.toBeNull()
    expect(lockError.message).toContain('is already in use')

    // First instance should still work fine
    const result = await db1.query('SELECT 1 as ok')
    expect(result.rows[0].ok).toBe(1)

    await db1.close()
  }, 30000)

  it('should let a second instance take over with the takeover option', async () => {
    const { PGlite } = await import('../dist/index.js')
    const { NodeFS } = await import('../dist/fs/nodefs.js')

    const db1 = new PGlite(dataDir)
    await db1.waitReady

    // With takeover, the second instance cleanly closes the first and
    // becomes the owner (Node is single threaded, so the close cannot
    // interleave with a write).
    const db2 = new PGlite({ fs: new NodeFS(dataDir, { takeover: true }) })
    await db2.waitReady

    expect(db1.closed).toBe(true)

    // The first instance now fails cleanly instead of corrupting files
    let closedError = null
    try {
      await db1.query('SELECT 1')
    } catch (err) {
      closedError = err
    }
    expect(closedError).not.toBeNull()

    // The new owner works
    const result = await db2.query('SELECT 1 as ok')
    expect(result.rows[0].ok).toBe(1)

    await db2.close()
  }, 30000)

  it('should allow reopening after the first instance is closed', async () => {
    const { PGlite } = await import('../dist/index.js')

    // Lock file should be cleaned up after close
    expect(existsSync(dataDir + '.lock')).toBe(false)

    const db = new PGlite(dataDir)
    await db.waitReady
    const result = await db.query('SELECT 1 as ok')
    expect(result.rows[0].ok).toBe(1)
    await db.close()
  }, 30000)

  it('should block while another live process holds the lock', async () => {
    const { PGlite } = await import('../dist/index.js')

    // Spawn a real child process that stays alive, and claim the lock in its name.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'])
    try {
      await new Promise((resolve) => setTimeout(resolve, 100))
      writeFileSync(dataDir + '.lock', `${child.pid}\n0\n`)

      // The holder process is alive, so opening must be refused.
      let lockError = null
      try {
        const db = new PGlite(dataDir)
        await db.waitReady
        await db.close()
      } catch (err) {
        lockError = err
      }

      expect(lockError).not.toBeNull()
      expect(lockError.message).toContain('may be in use')
      expect(lockError.message).toContain(String(child.pid))
    } finally {
      // Kill the holder and wait for it to actually exit, even if an
      // assertion above failed.
      child.kill('SIGKILL')
      await new Promise((resolve) => child.on('exit', resolve))
      rmSync(dataDir + '.lock', { force: true })
    }
  }, 30000)

  it('should reclaim a stale lock left by a dead process', async () => {
    const { PGlite } = await import('../dist/index.js')

    // A PID that is not running: its lock is stale and must be reclaimed
    // automatically, with no manual lock removal required.
    writeFileSync(dataDir + '.lock', '999999\n0\n')

    const db = new PGlite(dataDir)
    await db.waitReady
    const result = await db.query('SELECT 1 as ok')
    expect(result.rows[0].ok).toBe(1)
    await db.close()
  }, 30000)
})
