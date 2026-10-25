import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import tinytar from 'tinytar/index.js'
import { PGlite } from '../dist/index.js'

const { tar, untar } = tinytar

const tarballTime = new Date('2020-01-02T03:04:05Z')

async function modifyTimeOf(pg: PGlite, name: string) {
  const dump = await pg.dumpDataDir('none')
  const files = untar(new Uint8Array(await dump.arrayBuffer()))
  return files.find((file) => file.name === name)?.modifyTime
}

async function inTempDir(run: (dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pglite-file-times-'))
  try {
    await run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('file modification times', () => {
  let dataDirAtTarballTime: Blob

  beforeAll(async () => {
    const pg = await PGlite.create()
    const dump = await pg.dumpDataDir('none')
    await pg.close()
    const files = untar(new Uint8Array(await dump.arrayBuffer()))
    dataDirAtTarballTime = new Blob([
      tar(files.map((file) => ({ ...file, modifyTime: tarballTime }))),
    ])
  })

  it('are the times initdb wrote the files of a new database', async () => {
    const before = Math.floor(Date.now() / 1000) * 1000
    const pg = await PGlite.create()
    const written = Number(await modifyTimeOf(pg, '/PG_VERSION'))
    await pg.close()
    expect(written).toBeGreaterThanOrEqual(before)
    expect(written).toBeLessThanOrEqual(Date.now())
  })

  it('are restored from the tarball given to loadDataDir', async () => {
    const pg = await PGlite.create({ loadDataDir: dataDirAtTarballTime })
    expect(await modifyTimeOf(pg, '/PG_VERSION')).toEqual(tarballTime)
    await pg.close()
  })

  it('reach the disk through the Node filesystem', async () => {
    await inTempDir(async (dataDir) => {
      const before = Math.floor(Date.now() / 1000) * 1000
      const pg = await PGlite.create(dataDir)
      await pg.close()
      const written = fs.statSync(path.join(dataDir, 'PG_VERSION')).mtimeMs
      expect(written).toBeGreaterThanOrEqual(before)
    })
  })
})
