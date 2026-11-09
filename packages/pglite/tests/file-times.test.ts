import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import tinytar from 'tinytar/index.js'
import { PGlite } from '../dist/index.js'
import { BaseFilesystem, ERRNO_CODES, type FsStats } from '../dist/fs/base.js'

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

function errno<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)
      .code as keyof typeof ERRNO_CODES
    throw Object.assign(new Error((error as Error).message), {
      code: ERRNO_CODES[code] ?? ERRNO_CODES.EINVAL,
    })
  }
}

function fsStats(stats: fs.Stats): FsStats {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    nlink: stats.nlink,
    uid: stats.uid,
    gid: stats.gid,
    rdev: stats.rdev,
    size: stats.size,
    blksize: stats.blksize,
    blocks: stats.blocks,
    atime: stats.atimeMs,
    mtime: stats.mtimeMs,
    ctime: stats.ctimeMs,
  }
}

class HostDirectoryFS extends BaseFilesystem {
  constructor(private readonly root: string) {
    super()
  }

  #host(name: string) {
    return path.join(this.root, name)
  }

  chmod(name: string, mode: number) {
    errno(() => fs.chmodSync(this.#host(name), mode & 0o7777))
  }

  close(fd: number) {
    errno(() => fs.closeSync(fd))
  }

  fstat(fd: number) {
    return errno(() => fsStats(fs.fstatSync(fd)))
  }

  lstat(name: string) {
    return errno(() => fsStats(fs.lstatSync(this.#host(name))))
  }

  mkdir(name: string, options?: { recursive?: boolean; mode?: number }) {
    errno(() => fs.mkdirSync(this.#host(name), options))
  }

  open(name: string) {
    return errno(() => fs.openSync(this.#host(name), 'r+'))
  }

  readdir(name: string) {
    return errno(() => fs.readdirSync(this.#host(name)))
  }

  read(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) {
    return errno(() => fs.readSync(fd, buffer, offset, length, position))
  }

  rename(oldName: string, newName: string) {
    errno(() => fs.renameSync(this.#host(oldName), this.#host(newName)))
  }

  rmdir(name: string) {
    errno(() => fs.rmdirSync(this.#host(name)))
  }

  truncate(name: string, length: number) {
    errno(() => fs.truncateSync(this.#host(name), length))
  }

  unlink(name: string) {
    errno(() => fs.unlinkSync(this.#host(name)))
  }

  utimes(name: string, atime: number, mtime: number) {
    errno(() =>
      fs.utimesSync(this.#host(name), new Date(atime), new Date(mtime)),
    )
  }

  writeFile(
    name: string,
    data: string | Uint8Array,
    options?: { mode?: number },
  ) {
    errno(() => fs.writeFileSync(this.#host(name), data, options))
  }

  write(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) {
    return errno(() =>
      fs.writeSync(fd, new Uint8Array(buffer), offset, length, position),
    )
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

  it('reach a custom filesystem', async () => {
    await inTempDir(async (root) => {
      const pg = await PGlite.create({
        fs: new HostDirectoryFS(root),
        loadDataDir: dataDirAtTarballTime,
      })
      const { rows } = await pg.query<{ one: number }>('SELECT 1 AS one')
      await pg.close()
      expect(rows).toEqual([{ one: 1 }])
      expect(fs.statSync(path.join(root, 'PG_VERSION')).mtime).toEqual(
        tarballTime,
      )
    })
  })
})
