import assert from 'node:assert/strict'
import { access, cp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { PGlite, PGliteClusterInUseError } from '@electric-sql/pglite'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'

// Use the published release for the fixture and the locally packed build for every reopen.
const [legacy] = process.argv.slice(2)
const oldRequire = createRequire(join(legacy, 'package.json'))
const { PGlite: Released } = oldRequire('@electric-sql/pglite')
const source = join(legacy, 'pgdata')
const original = await Released.create(source)
await original.exec(
  'CREATE TABLE upgrade_probe (v int); INSERT INTO upgrade_probe VALUES (17)',
)
const dump = await original.dumpDataDir('none')
await original.close()
await assert.rejects(access(join(source, '.pglite/cluster.json')), {
  code: 'ENOENT',
})

for (const mode of ['classic', 'postmaster', 'dump']) {
  const dataDir = join(legacy, mode)
  if (mode !== 'dump') await cp(source, dataDir, { recursive: true })
  const pm =
    mode === 'postmaster'
      ? await PGlitePostmaster.create({ dataDir, initialize: false })
      : undefined
  try {
    const db = pm
      ? await pm.createSession()
      : await PGlite.create({
          dataDir,
          loadDataDir: mode === 'dump' ? dump : undefined,
        })
    try {
      assert.deepEqual((await db.query('SELECT v FROM upgrade_probe')).rows, [
        { v: 17 },
      ])
      await db.exec('INSERT INTO upgrade_probe VALUES (18)')
      const require = createRequire(import.meta.url)
      for (const entry of [
        '@electric-sql/pglite',
        '@electric-sql/pglite/postmaster',
        '@electric-sql/pglite/nodefs',
      ]) {
        await assert.rejects(
          PGlite.create(dataDir),
          (error) =>
            error instanceof PGliteClusterInUseError &&
            error instanceof require(entry).PGliteClusterInUseError,
        )
      }
    } finally {
      await db.close()
    }
  } finally {
    await pm?.close()
  }
  const reopened = await PGlite.create(dataDir)
  try {
    assert.deepEqual(
      (await reopened.query('SELECT v FROM upgrade_probe ORDER BY v')).rows,
      [{ v: 17 }, { v: 18 }],
    )
  } finally {
    await reopened.close()
  }
}

const control = join(source, 'global/pg_control')
await writeFile(control, (await readFile(control)).subarray(0, 32))
await assert.rejects(PGlite.create(source), /pg_control.*truncated/)
await assert.rejects(
  PGlitePostmaster.create({ dataDir: source }),
  /pg_control.*truncated/,
)
