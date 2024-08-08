import type { PostgresMod } from '../../postgresMod.js'
import type { OpfsAhp } from './opfsAhp.js'
import { ERRNO_CODES } from './types.js'

export type FileSystemType = Emscripten.FileSystemType & {
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

export interface OpfsMount extends FS.Mount {
  opts: {
    root: string
  }
}

type OpfsNode = FSNode

type EmscriptenFS = PostgresMod['FS'] & {
  createNode: (
    parent: FSNode | null,
    name: string,
    mode: number,
    dev?: any,
  ) => FSNode
}

/**
 * Create an emscripten filesystem that uses the AHP filesystem.
 * @param Module The emscripten module
 * @param opfsAhp The AHP filesystem - see `OpfsAhp.ts`
 * @returns The emscripten filesystem
 */
export const createOPFSAHP = (Module: PostgresMod, opfsAhp: OpfsAhp) => {
  const FS = Module.FS as EmscriptenFS
  const OPFS = {
    tryFSOperation<T>(f: () => T): T {
      try {
        return f()
      } catch (e: any) {
        if (!e.code) throw e
        if (e.code === 'UNKNOWN') throw new FS.ErrnoError(ERRNO_CODES.EINVAL)
        throw new FS.ErrnoError(e.code)
      }
    },
    mount(_mount: OpfsMount): FSNode {
      return OPFS.createNode(null, '/', 16384 | 511, 0)
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
    ): OpfsNode {
      if (!FS.isDir(mode) && !FS.isFile(mode)) {
        throw new FS.ErrnoError(28)
      }
      const node = FS.createNode(parent, name, mode)
      node.node_ops = OPFS.node_ops
      node.stream_ops = OPFS.stream_ops
      return node
    },
    getMode: function (path: string): number {
      log('getMode', path)
      return OPFS.tryFSOperation(() => {
        const stats = opfsAhp.lstat(path)
        return stats.mode
      })
    },
    realPath: function (node: FSNode): string {
      const parts: string[] = []
      while (node.parent !== node) {
        parts.push(node.name)
        node = node.parent as FSNode
      }
      parts.push((node.mount as OpfsMount).opts.root)
      parts.reverse()
      return parts.join('/')
    },
    node_ops: {
      getattr(node: OpfsNode): FS.Stats {
        log('getattr', OPFS.realPath(node))
        const path = OPFS.realPath(node)
        return OPFS.tryFSOperation(() => {
          const stats = opfsAhp.lstat(path)
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
      setattr(node: OpfsNode, attr: FS.Stats): void {
        log('setattr', OPFS.realPath(node), attr)
        const path = OPFS.realPath(node)
        OPFS.tryFSOperation(() => {
          if (attr.mode !== undefined) {
            opfsAhp.chmod(path, attr.mode)
          }
          if (attr.size !== undefined) {
            opfsAhp.truncate(path, attr.size)
          }
          if (attr.timestamp !== undefined) {
            opfsAhp.utimes(path, attr.timestamp, attr.timestamp)
          }
          if (attr.size !== undefined) {
            opfsAhp.truncate(path, attr.size)
          }
        })
      },
      lookup(parent: FSNode, name: string): OpfsNode {
        log('lookup', OPFS.realPath(parent), name)
        const path = [OPFS.realPath(parent), name].join('/')
        const mode = OPFS.getMode(path)
        return OPFS.createNode(parent, name, mode)
      },
      mknod(
        parent: FSNode,
        name: string,
        mode: number,
        dev: unknown,
      ): OpfsNode {
        log('mknod', OPFS.realPath(parent), name, mode, dev)
        const node = OPFS.createNode(parent, name, mode, dev)
        // create the backing node for this in the fs root as well
        const path = OPFS.realPath(node)
        return OPFS.tryFSOperation(() => {
          if (FS.isDir(node.mode)) {
            opfsAhp.mkdir(path, { mode })
          } else {
            opfsAhp.writeFile(path, '', { mode })
          }
          return node
        })
      },
      rename(oldNode: OpfsNode, newDir: OpfsNode, newName: string): void {
        log('rename', OPFS.realPath(oldNode), OPFS.realPath(newDir), newName)
        const oldPath = OPFS.realPath(oldNode)
        const newPath = [OPFS.realPath(newDir), newName].join('/')
        OPFS.tryFSOperation(() => {
          opfsAhp.rename(oldPath, newPath)
        })
        oldNode.name = newName
      },
      unlink(parent: OpfsNode, name: string): void {
        log('unlink', OPFS.realPath(parent), name)
        const path = [OPFS.realPath(parent), name].join('/')
        try {
          opfsAhp.unlink(path)
        } catch (e: any) {
          // no-op
        }
      },
      rmdir(parent: OpfsNode, name: string): void {
        log('rmdir', OPFS.realPath(parent), name)
        const path = [OPFS.realPath(parent), name].join('/')
        return OPFS.tryFSOperation(() => {
          opfsAhp.rmdir(path)
        })
      },
      readdir(node: OpfsNode): string[] {
        log('readdir', OPFS.realPath(node))
        const path = OPFS.realPath(node)
        return OPFS.tryFSOperation(() => {
          return opfsAhp.readdir(path)
        })
      },
      symlink(parent: FSNode, newName: string, oldPath: string): void {
        log('symlink', OPFS.realPath(parent), newName, oldPath)
        // This is not supported by OPFS
        throw new FS.ErrnoError(63)
      },
      readlink(node: FSNode): string {
        log('readlink', OPFS.realPath(node))
        // This is not supported by OPFS
        throw new FS.ErrnoError(63)
      },
    },
    stream_ops: {
      open(stream: FSStream): void {
        log('open stream', OPFS.realPath(stream.node))
        const path = OPFS.realPath(stream.node)
        return OPFS.tryFSOperation(() => {
          if (FS.isFile(stream.node.mode)) {
            stream.shared.refcount = 1
            stream.nfd = opfsAhp.open(path)
          }
        })
      },
      close(stream: FSStream): void {
        log('close stream', OPFS.realPath(stream.node))
        return OPFS.tryFSOperation(() => {
          if (
            FS.isFile(stream.node.mode) &&
            stream.nfd &&
            --stream.shared.refcount === 0
          ) {
            opfsAhp.close(stream.nfd)
          }
        })
      },
      dup(stream: FSStream) {
        log('dup stream', OPFS.realPath(stream.node))
        stream.shared.refcount++
      },
      read(
        stream: FSStream, // Stream to read from
        buffer: Uint8Array, // Buffer to read into - Wrong type in @types/emscripten
        offset: number, // Offset in buffer to start writing to
        length: number, // Number of bytes to read
        position: number, // Position in file to read from
      ): number {
        log('read stream', OPFS.realPath(stream.node), offset, length, position)
        if (length === 0) return 0
        const ret = OPFS.tryFSOperation(() =>
          opfsAhp.read(
            stream.nfd!,
            buffer as unknown as Int8Array,
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
        log(
          'write stream',
          OPFS.realPath(stream.node),
          offset,
          length,
          position,
        )
        return OPFS.tryFSOperation(() =>
          opfsAhp.write(
            stream.nfd!,
            buffer.buffer as unknown as Int8Array,
            offset,
            length,
            position,
          ),
        )
      },
      llseek(stream: FSStream, offset: number, whence: number): number {
        log('llseek stream', OPFS.realPath(stream.node), offset, whence)
        let position = offset
        if (whence === 1) {
          position += stream.position
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            OPFS.tryFSOperation(() => {
              const stat = opfsAhp.fstat(stream.nfd!)
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
        log(
          'mmap stream',
          OPFS.realPath(stream.node),
          length,
          position,
          prot,
          flags,
        )
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV)
        }

        const ptr = (Module as any).mmapAlloc(length) // TODO: Fix type and check this is exported

        OPFS.stream_ops.read(
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
        log(
          'msync stream',
          OPFS.realPath(stream.node),
          offset,
          length,
          mmapFlags,
        )
        OPFS.stream_ops.write(stream, buffer, 0, length, offset)
        return 0
      },
    },
  } satisfies FileSystemType
  return OPFS
}

function log(..._args: any[]) {
  // console.log(...args);
}
