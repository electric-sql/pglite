import { describe, it, expect } from 'vitest'
import { mkdtemp, readdir, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testEsmCjsAndDTC } from './test-utils.ts'

async function createCorruptedDataDir() {
  const dataDir = await mkdtemp(join(tmpdir(), 'pglite-startup-wal-repair-'))

  const { PGlite } = await import('../dist/index.js')
  const db = await PGlite.create(dataDir)
  await db.query('CREATE TABLE keep_me (id int primary key, value text)')
  await db.query("INSERT INTO keep_me VALUES (1, 'still here')")
  await db.close()

  const walDir = join(dataDir, 'pg_wal')
  const walFile = (await readdir(walDir)).find((file) =>
    /^[0-9A-F]{24}$/.test(file),
  )
  expect(walFile).toBeDefined()
  await truncate(join(walDir, walFile!), 1024)

  return dataDir
}

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  describe('startup WAL repair', () => {
    it('resets corrupt WAL in place and preserves existing data', async () => {
      const dataDir = await createCorruptedDataDir()
      try {
        const exitCode = process.exitCode
        const recovered = await PGlite.create(dataDir)
        expect(recovered.repairedDataDir).toBe(dataDir)
        await expect(recovered.query('SELECT * FROM keep_me')).resolves.toEqual(
          {
            rows: [{ id: 1, value: 'still here' }],
            fields: [
              { name: 'id', dataTypeID: 23 },
              { name: 'value', dataTypeID: 25 },
            ],
            affectedRows: 0,
          },
        )
        await recovered.close()
        expect(process.exitCode).toBe(exitCode ?? 0)
      } finally {
        await rm(dataDir, { recursive: true, force: true })
      }
    })

    it('can disable automatic WAL repair', async () => {
      const dataDir = await createCorruptedDataDir()
      try {
        await expect(
          PGlite.create({ dataDir, dataDirRepair: 'none' }),
        ).rejects.toThrow(/PGlite failed to start Postgres/)
      } finally {
        await rm(dataDir, { recursive: true, force: true })
      }
    })
  })
})
