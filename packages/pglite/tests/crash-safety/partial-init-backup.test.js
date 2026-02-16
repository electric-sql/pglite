import { describe, it, expect, afterAll } from 'vitest'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tryOpen, cleanupDataDir, testDataDir } from './harness.js'

const dataDir = testDataDir('partial-init-backup')
const parentDir = dirname(dataDir)

afterAll(async () => {
  if (!process.env.RETAIN_DATA) {
    cleanupDataDir(dataDir)
    // Clean up any .corrupt-* backup directories
    if (existsSync(parentDir)) {
      const entries = readdirSync(parentDir)
      for (const entry of entries) {
        if (entry.startsWith(dataDir.split('/').pop() + '.corrupt-')) {
          rmSync(join(parentDir, entry), { recursive: true, force: true })
        }
      }
    }
  }
})

describe('partial init detection: backup instead of wipe', () => {
  it(
    'should move a partially-initialized data dir to a .corrupt-* backup',
    async () => {
      // Create a data directory that looks like a partial initdb:
      // has some files but no PG_VERSION (very early interruption)
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'postgresql.conf'), '# partial config')
      mkdirSync(join(dataDir, 'base'), { recursive: true })

      // Open PGlite — it should detect partial init and move to backup
      const opened = await tryOpen(dataDir)
      expect(opened.success).toBe(true)

      // Verify a .corrupt-* backup was created as a sibling
      const siblings = readdirSync(parentDir)
      const baseName = dataDir.split('/').pop()
      const backups = siblings.filter((s) =>
        s.startsWith(baseName + '.corrupt-'),
      )
      expect(backups.length).toBeGreaterThanOrEqual(1)

      // Verify the backup contains our original files
      const backupPath = join(parentDir, backups[0])
      const backupContents = readdirSync(backupPath)
      expect(backupContents).toContain('postgresql.conf')
      expect(backupContents).toContain('base')

      if (opened.db) {
        await opened.db.close()
      }
    },
    { timeout: 60000 },
  )

  it(
    'should move a data dir with PG_VERSION but incomplete base/ databases to backup',
    async () => {
      // Clean from previous test
      cleanupDataDir(dataDir)
      mkdirSync(dataDir, { recursive: true })

      // Simulate a later-stage partial initdb: PG_VERSION exists
      // but base/ has fewer than 3 database directories
      writeFileSync(join(dataDir, 'PG_VERSION'), '16')
      mkdirSync(join(dataDir, 'base', '1'), { recursive: true })
      writeFileSync(
        join(dataDir, 'base', '1', 'pg_filenode.map'),
        'fake catalog data',
      )
      mkdirSync(join(dataDir, 'global'), { recursive: true })

      const opened = await tryOpen(dataDir)
      expect(opened.success).toBe(true)

      // Verify backup was created
      const siblings = readdirSync(parentDir)
      const baseName = dataDir.split('/').pop()
      const backups = siblings.filter((s) =>
        s.startsWith(baseName + '.corrupt-'),
      )
      expect(backups.length).toBeGreaterThanOrEqual(2) // one from each test

      // Find the latest backup
      const latestBackup = join(parentDir, backups.sort().pop())
      const backupContents = readdirSync(latestBackup)
      expect(backupContents).toContain('PG_VERSION')
      expect(backupContents).toContain('base')
      expect(backupContents).toContain('global')

      if (opened.db) {
        await opened.db.close()
      }
    },
    { timeout: 60000 },
  )

  it(
    'should NOT move a fully-initialized data directory',
    async () => {
      // Clean from previous tests
      cleanupDataDir(dataDir)

      // Let PGlite do a real fresh init
      const opened = await tryOpen(dataDir)
      expect(opened.success).toBe(true)

      // Count backups before closing and reopening
      const siblingsBefore = readdirSync(parentDir)
      const baseName = dataDir.split('/').pop()
      const backupsBefore = siblingsBefore.filter((s) =>
        s.startsWith(baseName + '.corrupt-'),
      )

      if (opened.db) {
        await opened.db.close()
      }

      // Reopen — should NOT create a backup since the dir is fully initialized
      const reopened = await tryOpen(dataDir)
      expect(reopened.success).toBe(true)

      const siblingsAfter = readdirSync(parentDir)
      const backupsAfter = siblingsAfter.filter((s) =>
        s.startsWith(baseName + '.corrupt-'),
      )

      // No new backups should have been created
      expect(backupsAfter.length).toBe(backupsBefore.length)

      if (reopened.db) {
        await reopened.db.close()
      }
    },
    { timeout: 60000 },
  )
})
