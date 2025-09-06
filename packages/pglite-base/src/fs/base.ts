import type { PostgresMod } from '../postgresMod.js'
import type { PGliteInterface } from '../interface.js'
import { dumpTar, type DumpTarCompressionOptions } from './tarUtils.js'

export const WASM_PREFIX = '/tmp/pglite'
export const PGDATA = WASM_PREFIX + '/' + 'base'

export type FsType = 'nodefs' | 'idbfs' | 'memoryfs' | 'opfs-ahp'

/**
 * Filesystem interface.
 * All virtual filesystems that are compatible with PGlite must implement
 * this interface.
 */
export interface Filesystem {
  /**
   * Initiate the filesystem and return the options to pass to the emscripten module.
   */
  init(
    pg: PGliteInterface,
    emscriptenOptions: Partial<PostgresMod>,
  ): Promise<{ emscriptenOpts: Partial<PostgresMod> }>

  /**
   * Sync the filesystem to any underlying storage.
   */
  syncToFs(relaxedDurability?: boolean): Promise<void>

  /**
   * Sync the filesystem from any underlying storage.
   */
  initialSyncFs(): Promise<void>

  /**
   * Dump the PGDATA dir from the filesystem to a gzipped tarball.
   */
  dumpTar(
    dbname: string,
    compression?: DumpTarCompressionOptions,
  ): Promise<File | Blob>

  /**
   * Close the filesystem.
   */
  closeFs(): Promise<void>
}

/**
 * Base class for all emscripten built-in filesystems.
 */
export class EmscriptenBuiltinFilesystem implements Filesystem {
  protected dataDir?: string
  protected pg?: PGliteInterface

  constructor(dataDir?: string) {
    this.dataDir = dataDir
  }

  async init(pg: PGliteInterface, emscriptenOptions: Partial<PostgresMod>) {
    this.pg = pg
    return { emscriptenOpts: emscriptenOptions }
  }

  async syncToFs(_relaxedDurability?: boolean) {}

  async initialSyncFs() {}

  async closeFs() {}

  async dumpTar(dbname: string, compression?: DumpTarCompressionOptions) {
    return dumpTar(this.pg!.Module.FS, PGDATA, dbname, compression)
  }
}

/**
 * Abstract base class for all custom virtual filesystems.
 * Each custom filesystem needs to implement an interface similar to the NodeJS FS API.
 */
export abstract class BaseFilesystem implements Filesystem {
  protected dataDir?: string
  protected pg?: PGliteInterface
  readonly debug: boolean

  constructor(dataDir?: string, { debug = false }: { debug?: boolean } = {}) {
    this.dataDir = dataDir
    this.debug = debug
  }

  async syncToFs(_relaxedDurability?: boolean) {}

  async initialSyncFs() {}

  async closeFs() {}

  async dumpTar(dbname: string, compression?: DumpTarCompressionOptions) {
    return dumpTar(this.pg!.Module.FS, PGDATA, dbname, compression)
  }

  async init(pg: PGliteInterface, emscriptenOptions: Partial<PostgresMod>) {
    this.pg = pg
    const options: Partial<PostgresMod> = {
      ...emscriptenOptions,
      preRun: [
        ...(emscriptenOptions.preRun || []),
        (mod: PostgresMod) => {
          const EMFS = createEmscriptenFS(mod, this)
          mod.FS.mkdir(PGDATA)
          mod.FS.mount(EMFS, {}, PGDATA)
        },
      ],
    }
    return { emscriptenOpts: options }
  }

  // Filesystem API

  abstract chmod(path: string, mode: number): void
  abstract close(fd: number): void
  abstract fstat(fd: number): FsStats
  abstract lstat(path: string): FsStats
  abstract mkdir(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): void
  abstract open(path: string, flags?: string, mode?: number): number
  abstract readdir(path: string): string[]
  abstract read(
    fd: number,
    buffer: Uint8Array, // Buffer to read into
    offset: number, // Offset in buffer to start writing to
    length: number, // Number of bytes to read
    position: number, // Position in file to read from
  ): number
  abstract rename(oldPath: string, newPath: string): void
  abstract rmdir(path: string): void
  abstract truncate(
    path: string,
    len: number, // Length to truncate to - defaults to 0
  ): void
  abstract unlink(path: string): void
  abstract utimes(path: string, atime: number, mtime: number): void
  abstract writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string; mode?: number; flag?: string },
  ): void
  abstract write(
    fd: number,
    buffer: Uint8Array, // Buffer to read from
    offset: number, // Offset in buffer to start reading from
    length: number, // Number of bytes to write
    position: number, // Position in file to write to
  ): number
}

export type FsStats = {
  dev: number
  ino: number
  mode: number
  nlink: number
  uid: number
  gid: number
  rdev: number
  size: number
  blksize: number
  blocks: number
  atime: number
  mtime: number
  ctime: number
}

type EmscriptenFileSystem = Emscripten.FileSystemType & {
  createNode: (
    parent: FSNode | null,
    name: string,
    mode: number,
    dev?: any,
  ) => FSNode
  node_ops: FS.NodeOps
  stream_ops: FS.StreamOps & {
    dup: (stream: FSStream) => void
    mmap: (
      stream: FSStream,
      length: number,
      position: number,
      prot: any,
      flags: any,
    ) => { ptr: number; allocated: boolean }
    msync: (
      stream: FSStream,
      buffer: Uint8Array,
      offset: number,
      length: number,
      mmapFlags: any,
    ) => number
  }
} & { [key: string]: any }

type FSNode = FS.FSNode & {
  node_ops: FS.NodeOps
  stream_ops: FS.StreamOps
}

type FSStream = FS.FSStream & {
  node: FSNode
  shared: {
    refcount: number
  }
}

type FSMount = FS.Mount & {
  opts: {
    root: string
  }
}

type EmscriptenFS = PostgresMod['FS'] & {
  createNode: (
    parent: FSNode | null,
    name: string,
    mode: number,
    dev?: any,
  ) => FSNode
}

export const ERRNO_CODES = {
  EBADF: 8,
  EBADFD: 127,
  EEXIST: 20,
  EINVAL: 28,
  EISDIR: 31,
  ENODEV: 43,
  ENOENT: 44,
  ENOTDIR: 54,
  ENOTEMPTY: 55,
} as const

/**
 * Create an emscripten filesystem that uses the BaseFilesystem.
 * @param Module The emscripten module
 * @param baseFS The BaseFilesystem implementation
 * @returns The emscripten filesystem
 */
const createEmscriptenFS = (Module: PostgresMod, baseFS: BaseFilesystem) => {
  const FS = Module.FS as EmscriptenFS
  const log = baseFS.debug ? console.log : null
  const EMFS = {
    tryFSOperation<T>(f: () => T): T {
      try {
        return f()
      } catch (e: any) {
        if (!e.code) throw e
        if (e.code === 'UNKNOWN') throw new FS.ErrnoError(ERRNO_CODES.EINVAL)
        throw new FS.ErrnoError(e.code)
      }
    },
    mount(_mount: FSMount): FSNode {
      return EMFS.createNode(null, '/', 16384 | 511, 0)
    },
    syncfs(
      _mount: FS.Mount,
      _populate: any, // This has the wrong type in @types/emscripten
      _done: (err?: number | null) => unknown,
    ): void {
      // noop
    },
    createNode(
      parent: FSNode | null,
      name: string,
      mode: number,
      _dev?: any,
    ): FSNode {
      if (!FS.isDir(mode) && !FS.isFile(mode)) {
        throw new FS.ErrnoError(28)
      }
      const node = FS.createNode(parent, name, mode)
      node.node_ops = EMFS.node_ops
      node.stream_ops = EMFS.stream_ops
      return node
    },
    getMode: function (path: string): number {
      log?.('getMode', path)
      return EMFS.tryFSOperation(() => {
        const stats = baseFS.lstat(path)
        return stats.mode
      })
    },
    realPath: function (node: FSNode): string {
      const parts: string[] = []
      while (node.parent !== node) {
        parts.push(node.name)
        node = node.parent as FSNode
      }
      parts.push((node.mount as FSMount).opts.root)
      parts.reverse()
      return parts.join('/')
    },
    node_ops: {
      getattr(node: FSNode): FS.Stats {
        log?.('getattr', EMFS.realPath(node))
        const path = EMFS.realPath(node)
        return EMFS.tryFSOperation(() => {
          const stats = baseFS.lstat(path)
          return {
            ...stats,
            dev: 0,
            ino: node.id,
            nlink: 1,
            rdev: node.rdev,
            atime: new Date(stats.atime),
            mtime: new Date(stats.mtime),
            ctime: new Date(stats.ctime),
          }
        })
      },
      setattr(node: FSNode, attr: FS.Stats): void {
        log?.('setattr', EMFS.realPath(node), attr)
        const path = EMFS.realPath(node)
        EMFS.tryFSOperation(() => {
          if (attr.mode !== undefined) {
            baseFS.chmod(path, attr.mode)
          }
          if (attr.size !== undefined) {
            baseFS.truncate(path, attr.size)
          }
          if (attr.timestamp !== undefined) {
            baseFS.utimes(path, attr.timestamp, attr.timestamp)
          }
          if (attr.size !== undefined) {
            baseFS.truncate(path, attr.size)
          }
        })
      },
      lookup(parent: FSNode, name: string): FSNode {
        log?.('lookup', EMFS.realPath(parent), name)
        const path = [EMFS.realPath(parent), name].join('/')
        const mode = EMFS.getMode(path)
        return EMFS.createNode(parent, name, mode)
      },
      mknod(parent: FSNode, name: string, mode: number, dev: unknown): FSNode {
        log?.('mknod', EMFS.realPath(parent), name, mode, dev)
        const node = EMFS.createNode(parent, name, mode, dev)
        // create the backing node for this in the fs root as well
        const path = EMFS.realPath(node)
        return EMFS.tryFSOperation(() => {
          if (FS.isDir(node.mode)) {
            baseFS.mkdir(path, { mode })
          } else {
            baseFS.writeFile(path, '', { mode })
          }
          return node
        })
      },
      rename(oldNode: FSNode, newDir: FSNode, newName: string): void {
        log?.('rename', EMFS.realPath(oldNode), EMFS.realPath(newDir), newName)
        const oldPath = EMFS.realPath(oldNode)
        const newPath = [EMFS.realPath(newDir), newName].join('/')
        EMFS.tryFSOperation(() => {
          baseFS.rename(oldPath, newPath)
        })
        oldNode.name = newName
      },
      unlink(parent: FSNode, name: string): void {
        log?.('unlink', EMFS.realPath(parent), name)
        const path = [EMFS.realPath(parent), name].join('/')
        try {
          baseFS.unlink(path)
        } catch (e: any) {
          // no-op
        }
      },
      rmdir(parent: FSNode, name: string): void {
        log?.('rmdir', EMFS.realPath(parent), name)
        const path = [EMFS.realPath(parent), name].join('/')
        return EMFS.tryFSOperation(() => {
          baseFS.rmdir(path)
        })
      },
      readdir(node: FSNode): string[] {
        log?.('readdir', EMFS.realPath(node))
        const path = EMFS.realPath(node)
        return EMFS.tryFSOperation(() => {
          return baseFS.readdir(path)
        })
      },
      symlink(parent: FSNode, newName: string, oldPath: string): void {
        log?.('symlink', EMFS.realPath(parent), newName, oldPath)
        // This is not supported by EMFS
        throw new FS.ErrnoError(63)
      },
      readlink(node: FSNode): string {
        log?.('readlink', EMFS.realPath(node))
        // This is not supported by EMFS
        throw new FS.ErrnoError(63)
      },
    },
    stream_ops: {
      open(stream: FSStream): void {
        log?.('open stream', EMFS.realPath(stream.node))
        const path = EMFS.realPath(stream.node)
        return EMFS.tryFSOperation(() => {
          if (FS.isFile(stream.node.mode)) {
            stream.shared.refcount = 1
            stream.nfd = baseFS.open(path)
          }
        })
      },
      close(stream: FSStream): void {
        log?.('close stream', EMFS.realPath(stream.node))
        return EMFS.tryFSOperation(() => {
          if (
            FS.isFile(stream.node.mode) &&
            stream.nfd &&
            --stream.shared.refcount === 0
          ) {
            baseFS.close(stream.nfd)
          }
        })
      },
      dup(stream: FSStream) {
        log?.('dup stream', EMFS.realPath(stream.node))
        stream.shared.refcount++
      },
      read(
        stream: FSStream, // Stream to read from
        buffer: Uint8Array, // Buffer to read into - Wrong type in @types/emscripten
        offset: number, // Offset in buffer to start writing to
        length: number, // Number of bytes to read
        position: number, // Position in file to read from
      ): number {
        log?.(
          'read stream',
          EMFS.realPath(stream.node),
          offset,
          length,
          position,
        )
        if (length === 0) return 0
        const ret = EMFS.tryFSOperation(() =>
          baseFS.read(
            stream.nfd!,
            buffer as unknown as Uint8Array,
            offset,
            length,
            position,
          ),
        )
        return ret
      },
      write(
        stream: FSStream, // Stream to write to
        buffer: Uint8Array, // Buffer to read from - Wrong type in @types/emscripten
        offset: number, // Offset in buffer to start writing from
        length: number, // Number of bytes to write
        position: number, // Position in file to write to
      ): number {
        log?.(
          'write stream',
          EMFS.realPath(stream.node),
          offset,
          length,
          position,
        )
        return EMFS.tryFSOperation(() =>
          baseFS.write(
            stream.nfd!,
            buffer.buffer as unknown as Uint8Array,
            offset,
            length,
            position,
          ),
        )
      },
      llseek(stream: FSStream, offset: number, whence: number): number {
        log?.('llseek stream', EMFS.realPath(stream.node), offset, whence)
        let position = offset
        if (whence === 1) {
          position += stream.position
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            EMFS.tryFSOperation(() => {
              const stat = baseFS.fstat(stream.nfd!)
              position += stat.size
            })
          }
        }
        if (position < 0) {
          throw new FS.ErrnoError(28)
        }
        return position
      },
      mmap(
        stream: FSStream,
        length: number,
        position: number,
        prot: any,
        flags: any,
      ) {
        log?.(
          'mmap stream',
          EMFS.realPath(stream.node),
          length,
          position,
          prot,
          flags,
        )
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV)
        }

        const ptr = (Module as any).mmapAlloc(length) // TODO: Fix type and check this is exported

        EMFS.stream_ops.read(
          stream,
          Module.HEAP8 as unknown as Uint8Array,
          ptr,
          length,
          position,
        )
        return { ptr, allocated: true }
      },
      msync(
        stream: FSStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        mmapFlags: any,
      ) {
        log?.(
          'msync stream',
          EMFS.realPath(stream.node),
          offset,
          length,
          mmapFlags,
        )
        EMFS.stream_ops.write(stream, buffer, 0, length, offset)
        return 0
      },
    },
  } satisfies EmscriptenFileSystem
  return EMFS
}
