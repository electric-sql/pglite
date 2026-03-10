import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, writeFileSync, rmSync } from 'node:fs'

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
    expect(lockError.message).toContain('already in use')
    expect(lockError.message).toContain(String(process.pid))

    // First instance should still work fine
    const result = await db1.query('SELECT 1 as ok')
    expect(result.rows[0].ok).toBe(1)

    await db1.close()
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

  it('should override a stale lock from a dead process', async () => {
    const { PGlite } = await import('../dist/index.js')

    // Write a fake lock file with a PID that doesn't exist
    writeFileSync(dataDir + '.lock', '999999\n0\n')

    // Should succeed — stale lock gets overridden
    const db = new PGlite(dataDir)
    await db.waitReady
    const result = await db.query('SELECT 1 as ok')
    expect(result.rows[0].ok).toBe(1)
    await db.close()
  }, 30000)
})
