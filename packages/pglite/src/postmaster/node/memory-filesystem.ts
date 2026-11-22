import { Volume } from 'memfs'
import { BaseFilesystem, type FsStats } from '../../fs/base.js'
import { byteView } from './filesystem-broker.js'

/** One in-memory PGDATA. The supervisor services every worker from this volume. */
export class PostmasterMemoryFilesystem extends BaseFilesystem {
  readonly capabilities = {
    persistence: 'ephemeral',
    multiSession: 'supervisor-broker',
  } as const

  constructor(private readonly volume = new Volume()) {
    super()
  }

  // The initializer mount holds a reference to its classic Wasm runtime.
  // Keep that mount short-lived while the supervisor continues using the volume.
  mountForInitialization() {
    return new PostmasterMemoryFilesystem(this.volume)
  }

  close = this.volume.closeSync.bind(this.volume)
  mkdir = this.volume.mkdirSync.bind(this.volume)
  rename = this.volume.renameSync.bind(this.volume)
  rmdir = this.volume.rmdirSync.bind(this.volume)
  truncate = this.volume.truncateSync.bind(this.volume)
  unlink = this.volume.unlinkSync.bind(this.volume)

  chmod(path: string, mode: number) {
    this.volume.chmodSync(path || '/', mode)
  }

  write(
    fd: number,
    bytes: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) {
    const view = byteView(bytes)
    const source = Buffer.from(view.buffer, view.byteOffset + offset, length)
    return this.volume.writeSync(fd, source, 0, length, position)
  }

  open(path: string, flags = 'r+', mode?: number) {
    return this.volume.openSync(path, flags, mode)
  }

  read(
    fd: number,
    bytes: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) {
    // memfs requires a Buffer destination. Share the caller's byte range.
    const target = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return this.volume.readSync(fd, target, offset, length, position)
  }

  readdir(path: string): string[] {
    return this.volume.readdirSync(path || '/', 'utf8') as string[]
  }

  lstat(path: string): FsStats {
    return fileStats(this.volume.lstatSync(path || '/'))
  }

  fstat(fd: number): FsStats {
    return fileStats(this.volume.fstatSync(fd))
  }

  utimes(path: string, atime: number, mtime: number) {
    this.volume.utimesSync(path || '/', new Date(atime), new Date(mtime))
  }

  writeFile(
    path: string,
    bytes: string | Uint8Array,
    options?: { mode?: number; flag?: string; encoding?: BufferEncoding },
  ) {
    this.volume.writeFileSync(path, bytes, options)
  }

  async closeFs() {
    this.volume.reset()
    this.pg = undefined
  }
}

function fileStats(
  stats: Omit<FsStats, 'atime' | 'mtime' | 'ctime'> & {
    atimeMs: number
    mtimeMs: number
    ctimeMs: number
  },
): FsStats {
  return {
    ...stats,
    atime: stats.atimeMs,
    mtime: stats.mtimeMs,
    ctime: stats.ctimeMs,
  }
}
