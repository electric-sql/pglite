import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PGlite, MemoryFS } from '../dist/index.js'
import { NodeFS } from '../dist/fs/nodefs.js'

describe('Filesystem.existsInPgData', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pglite-exists-'))
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  it('MemoryFS: nothing before init, the data dir once running', async () => {
    const memFs = new MemoryFS()
    expect(await memFs.existsInPgData('PG_VERSION')).toBe(false)
    const pg = await PGlite.create({ fs: memFs })
    expect(await memFs.existsInPgData('PG_VERSION')).toBe(true)
    expect(await memFs.existsInPgData('/base')).toBe(true)
    expect(await memFs.existsInPgData('')).toBe(true)
    expect(await memFs.existsInPgData('nope')).toBe(false)
    await pg.close()
  })

  it('NodeFS: queries the host directory, before and after init', async () => {
    const dataDir = path.join(tmpDir, 'node')
    const first = new NodeFS(dataDir)
    expect(await first.existsInPgData('PG_VERSION')).toBe(false)
    const pg = await PGlite.create({ fs: first })
    expect(await first.existsInPgData('PG_VERSION')).toBe(true)
    await pg.close()

    const second = new NodeFS(dataDir)
    expect(await second.existsInPgData('PG_VERSION')).toBe(true)
    expect(await second.existsInPgData('base/1')).toBe(true)
    expect(await second.existsInPgData('PG_VERSION/x')).toBe(false)
    expect(await second.existsInPgData('nope')).toBe(false)
  })

  it('rejects paths escaping PGDATA', async () => {
    await expect(new MemoryFS().existsInPgData('../etc')).rejects.toThrow()
  })
})
