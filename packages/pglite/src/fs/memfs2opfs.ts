import { EmscriptenBuiltinFilesystem } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import type { PGlite } from '../pglite.js'
import { PGDATA } from '../initdb.js'

export interface Memfs2OpfsOptions {
  /**
   * Maximum number of files written to OPFS concurrently during a flush.
   */
  maxConcurrentWrites?: number
  debug?: boolean
}

// TypeScript doesn't have a built-in type for FileSystemSyncAccessHandle
interface FileSystemSyncAccessHandle {
  close(): void
  flush(): void
  truncate(newSize: number): void
  write(buffer: ArrayBufferView, options: { at: number }): number
}

// The subset of an emscripten MEMFS node that we rely on
interface MemNode {
  name: string
  mode: number
  parent: MemNode
  contents: any // Uint8Array | null for files, { [name]: MemNode } for dirs
  usedBytes: number
  node_ops: any
  stream_ops: any
}

interface DirtyFile {
  // The whole file has to be written, eg. it is new or has been moved
  full: boolean
  // The size of the file has changed through truncate/allocate
  resized: boolean
  // Byte ranges [start, end) that have been written to
  ranges: Array<[number, number]>
}

// Structural changes, in the order they happened. Removals are recorded by
// path, as the node is gone. Directories are recorded by node so that their
// path is resolved at flush time, after any later renames.
type JournalEntry =
  | { op: 'remove'; path: string }
  | { op: 'mkdir'; node: MemNode }

interface FileWrite {
  path: string
  size: number
  full: boolean
  truncate: boolean
  chunks: Array<{ at: number; data: Uint8Array }>
}

interface Snapshot {
  ops: Array<{ op: 'remove' | 'mkdir'; path: string }>
  files: FileWrite[]
  // The raw tracking state, restored if the flush fails
  journal: JournalEntry[]
  dirty: Map<MemNode, DirtyFile>
}

// Merge the range list once it grows past this, keeps memory bounded when
// postgres writes many scattered pages between two flushes.
const MERGE_RANGES_THRESHOLD = 1024

// Postgres writes to one WAL segment at a time, keep the handles of the most
// recently written segments open as nearly every query appends to them.
const MAX_OPEN_WAL_HANDLES = 2
const WAL_SEGMENT_RE = /^\/pg_wal\/[0-9A-F]{24}$/

/**
 * PGlite MEMFS to OPFS filesystem.
 * All operations act on an emscripten MEMFS mounted at PGDATA, so the database
 * behaves exactly as with the in-memory filesystem. The node and stream ops of
 * that mount are wrapped to record which files and directories were touched,
 * and these changes are flushed to OPFS in `syncToFs`, ie. after each query.
 * Unlike OPFS-AHP, no OPFS file handles are kept open between flushes, except
 * for the sync access handles of the current WAL segments.
 */
export class Memfs2OpfsFS extends EmscriptenBuiltinFilesystem {
  declare readonly dataDir: string
  readonly maxConcurrentWrites: number
  readonly debug: boolean

  #opfsRootDh!: FileSystemDirectoryHandle
  #dataDirDh!: FileSystemDirectoryHandle
  #rootNode?: MemNode
  #ops?: { dir: { node: any; stream: any }; file: { node: any; stream: any } }

  #tracking = true
  #journal: JournalEntry[] = []
  #dirty = new Map<MemNode, DirtyFile>()
  #flushing: Promise<void> = Promise.resolve()
  // Open WAL segment handles by path, in least recently written order
  #walHandles = new Map<string, FileSystemSyncAccessHandle>()
  #warnedSymlink = false

  constructor(
    dataDir: string,
    { maxConcurrentWrites = 16, debug = false }: Memfs2OpfsOptions = {},
  ) {
    super(dataDir)
    this.maxConcurrentWrites = maxConcurrentWrites
    this.debug = debug
  }

  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    this.pg = pg
    this.#opfsRootDh = await navigator.storage.getDirectory()
    this.#dataDirDh = await this.#resolveOpfsDirectory(this.dataDir, {
      from: this.#opfsRootDh,
      create: true,
    })
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: PostgresMod) => {
          mod.FS.mkdirTree(PGDATA)
          mod.FS.mount(this.#createFsType(mod) as any, {}, PGDATA)
        },
      ],
    }
    return { emscriptenOpts: options }
  }

  /**
   * Load the files persisted in OPFS into the MEMFS mount.
   */
  async initialSyncFs() {
    this.#tracking = false
    try {
      await this.#loadDir(this.#dataDirDh, PGDATA)
    } finally {
      this.#tracking = true
    }
  }

  async syncToFs(relaxedDurability = false) {
    // Flushes must not overlap: each one applies the changes since the last
    const flush = this.#flushing.then(() => this.#flush(relaxedDurability))
    this.#flushing = flush.catch(() => {})
    await flush
  }

  async closeFs(): Promise<void> {
    await this.syncToFs()
    this.#closeWalHandles()
    this.pg!.Module.FS.quit()
  }

  // Emscripten filesystem:

  #createFsType(mod: PostgresMod) {
    const MEMFS = mod.FS.filesystems.MEMFS as any
    return {
      mount: (mount: any): MemNode => {
        const root = MEMFS.mount(mount) as MemNode
        // MEMFS.ops_table is created lazily by the first MEMFS.createNode
        this.#ops ??= this.#createOps(mod, MEMFS.ops_table)
        this.#patchNode(mod, root)
        this.#rootNode = root
        return root
      },
      syncfs: (_mount: any, _populate: any, done: (err?: any) => void) => {
        done(null)
      },
    }
  }

  /**
   * Create copies of the MEMFS ops tables with the operations that change the
   * filesystem wrapped to record the change.
   */
  #createOps(mod: PostgresMod, memfsOps: any) {
    const FS = mod.FS as any
    const dirNode = memfsOps.dir.node
    const fileNode = memfsOps.file.node
    const fileStream = memfsOps.file.stream
    const setattr = (node: MemNode, attr: any) => {
      fileNode.setattr(node, attr)
      if (attr.size !== undefined && FS.isFile(node.mode)) {
        this.#markResized(node)
      }
    }
    return {
      dir: {
        node: {
          ...dirNode,
          setattr,
          mknod: (parent: MemNode, name: string, mode: number, dev: any) => {
            const node = dirNode.mknod(parent, name, mode, dev) as MemNode
            this.#patchNode(mod, node)
            this.#markCreated(mod, node)
            return node
          },
          rename: (oldNode: MemNode, newDir: MemNode, newName: string) => {
            const oldPath = this.#relPath(mod, oldNode)
            dirNode.rename(oldNode, newDir, newName)
            // The moved node is written again in full at its new path
            this.#markRemoved(oldPath)
            this.#markCreated(mod, oldNode)
          },
          unlink: (parent: MemNode, name: string) => {
            dirNode.unlink(parent, name)
            this.#markRemoved(this.#joinPath(this.#relPath(mod, parent), name))
          },
          rmdir: (parent: MemNode, name: string) => {
            dirNode.rmdir(parent, name)
            this.#markRemoved(this.#joinPath(this.#relPath(mod, parent), name))
          },
          symlink: (parent: MemNode, newName: string, oldPath: string) => {
            if (this.#tracking && !this.#warnedSymlink) {
              this.#warnedSymlink = true
              console.warn('MEMFS2OPFS: symlinks are not persisted to OPFS')
            }
            return dirNode.symlink(parent, newName, oldPath)
          },
        },
        stream: memfsOps.dir.stream,
      },
      file: {
        node: { ...fileNode, setattr },
        stream: {
          ...fileStream,
          write: (
            stream: any,
            buffer: Uint8Array,
            offset: number,
            length: number,
            position: number,
            canOwn?: boolean,
          ) => {
            const written = fileStream.write(
              stream,
              buffer,
              offset,
              length,
              position,
              canOwn,
            )
            this.#markRange(stream.node, position, position + written)
            return written
          },
          // MEMFS.msync calls MEMFS.stream_ops.write directly, not our wrapper
          msync: (
            stream: any,
            buffer: Uint8Array,
            offset: number,
            length: number,
            mmapFlags: any,
          ) => {
            const ret = fileStream.msync(
              stream,
              buffer,
              offset,
              length,
              mmapFlags,
            )
            this.#markRange(stream.node, offset, offset + length)
            return ret
          },
          allocate: (stream: any, offset: number, length: number) => {
            fileStream.allocate(stream, offset, length)
            this.#markResized(stream.node)
          },
        },
      },
    }
  }

  #patchNode(mod: PostgresMod, node: MemNode) {
    const FS = mod.FS as any
    if (FS.isDir(node.mode)) {
      node.node_ops = this.#ops!.dir.node
      node.stream_ops = this.#ops!.dir.stream
    } else if (FS.isFile(node.mode)) {
      node.node_ops = this.#ops!.file.node
      node.stream_ops = this.#ops!.file.stream
    }
  }

  // Change tracking:

  #dirtyFile(node: MemNode): DirtyFile {
    let dirty = this.#dirty.get(node)
    if (!dirty) {
      dirty = { full: false, resized: false, ranges: [] }
      this.#dirty.set(node, dirty)
    }
    return dirty
  }

  #markRange(node: MemNode, start: number, end: number) {
    if (!this.#tracking || end <= start) return
    const dirty = this.#dirtyFile(node)
    if (dirty.full) return
    const ranges = dirty.ranges
    const last = ranges[ranges.length - 1]
    if (last && start <= last[1] && end >= last[0]) {
      // Sequential writes extend the previous range
      last[0] = Math.min(last[0], start)
      last[1] = Math.max(last[1], end)
    } else {
      ranges.push([start, end])
      if (ranges.length > MERGE_RANGES_THRESHOLD) {
        dirty.ranges = mergeRanges(ranges)
      }
    }
  }

  #markResized(node: MemNode) {
    if (!this.#tracking) return
    this.#dirtyFile(node).resized = true
  }

  #markRemoved(path: string) {
    if (!this.#tracking) return
    this.#journal.push({ op: 'remove', path })
  }

  #markCreated(mod: PostgresMod, node: MemNode) {
    if (!this.#tracking) return
    const FS = mod.FS as any
    if (FS.isDir(node.mode)) {
      this.#journal.push({ op: 'mkdir', node })
      for (const child of Object.values(node.contents) as MemNode[]) {
        this.#markCreated(mod, child)
      }
    } else if (FS.isFile(node.mode)) {
      const dirty = this.#dirtyFile(node)
      dirty.full = true
      dirty.ranges = []
    }
  }

  // Flushing:

  async #flush(relaxedDurability: boolean) {
    if (this.#journal.length === 0 && this.#dirty.size === 0) return
    const snapshot = this.#takeSnapshot()
    try {
      await this.#writeSnapshot(snapshot, relaxedDurability)
    } catch (e) {
      this.#restoreSnapshot(snapshot)
      throw e
    }
  }

  /**
   * Synchronously capture the pending changes, including a copy of the data to
   * write, so that the filesystem can keep changing while the flush runs.
   */
  #takeSnapshot(): Snapshot {
    const mod = this.pg!.Module
    const FS = mod.FS as any
    const ops: Snapshot['ops'] = []
    for (const entry of this.#journal) {
      if (entry.op === 'remove') {
        ops.push(entry)
      } else if (FS.isDir(entry.node.mode) && this.#isAttached(entry.node)) {
        ops.push({ op: 'mkdir', path: this.#relPath(mod, entry.node) })
      }
    }
    const files: FileWrite[] = []
    for (const [node, dirty] of this.#dirty) {
      // Skip files that have been removed since they were written to
      if (!FS.isFile(node.mode) || !this.#isAttached(node)) continue
      const size = node.usedBytes
      const ranges = dirty.full
        ? [[0, size] as [number, number]]
        : mergeRanges(dirty.ranges)
      const chunks: FileWrite['chunks'] = []
      for (const [start, rangeEnd] of ranges) {
        const end = Math.min(rangeEnd, size)
        if (start >= end) continue
        chunks.push({ at: start, data: copyBytes(node.contents, start, end) })
      }
      files.push({
        path: this.#relPath(mod, node),
        size,
        full: dirty.full,
        truncate: dirty.full || dirty.resized,
        chunks,
      })
    }
    const snapshot = { ops, files, journal: this.#journal, dirty: this.#dirty }
    this.#journal = []
    this.#dirty = new Map()
    return snapshot
  }

  #restoreSnapshot(snapshot: Snapshot) {
    this.#journal = [...snapshot.journal, ...this.#journal]
    for (const [node, old] of snapshot.dirty) {
      const current = this.#dirty.get(node)
      if (!current) {
        this.#dirty.set(node, old)
      } else {
        current.full ||= old.full
        current.resized ||= old.resized
        current.ranges = current.full
          ? []
          : mergeRanges([...old.ranges, ...current.ranges])
      }
    }
  }

  async #writeSnapshot(snapshot: Snapshot, relaxedDurability: boolean) {
    const dirCache = new Map<string, Promise<FileSystemDirectoryHandle>>()
    const getDir = (parts: string[]): Promise<FileSystemDirectoryHandle> => {
      const key = parts.join('/')
      let dh = dirCache.get(key)
      if (!dh) {
        const created: Promise<FileSystemDirectoryHandle> = parts.length
          ? getDir(parts.slice(0, -1)).then((parent) =>
              parent.getDirectoryHandle(parts[parts.length - 1], {
                create: true,
              }),
            )
          : Promise.resolve(this.#dataDirDh)
        dirCache.set(key, created)
        created.catch(() => dirCache.delete(key))
        dh = created
      }
      return dh
    }

    // Structural changes are applied in order, they are cheap
    for (const op of snapshot.ops) {
      const parts = pathParts(op.path)
      if (op.op === 'mkdir') {
        await getDir(parts)
        continue
      }
      // An open sync access handle locks the file, release it before removing
      this.#closeWalHandles(op.path)
      const key = parts.join('/')
      for (const cached of [...dirCache.keys()]) {
        if (cached === key || cached.startsWith(key + '/')) {
          dirCache.delete(cached)
        }
      }
      try {
        const parent = await getDir(parts.slice(0, -1))
        await parent.removeEntry(parts[parts.length - 1], { recursive: true })
      } catch (e: any) {
        // The entry was never flushed to OPFS
        if (e?.name !== 'NotFoundError') throw e
      }
    }

    // Write the WAL before the data files and pg_control last, so that an
    // interrupted flush leaves a state postgres can recover from.
    const wal: FileWrite[] = []
    const data: FileWrite[] = []
    const control: FileWrite[] = []
    for (const file of snapshot.files) {
      if (file.path.startsWith('/pg_wal/')) wal.push(file)
      else if (file.path === '/global/pg_control') control.push(file)
      else data.push(file)
    }
    const getFile = async (path: string) => {
      const parts = pathParts(path)
      const dir = await getDir(parts.slice(0, -1))
      return dir.getFileHandle(parts[parts.length - 1], { create: true })
    }
    const write = async (file: FileWrite) => {
      await writeOpfsFile(await getFile(file.path), file, relaxedDurability)
    }
    const writeWal = async (file: FileWrite) => {
      if (!WAL_SEGMENT_RE.test(file.path)) return write(file)
      let sh = this.#walHandles.get(file.path)
      if (!sh) {
        const fh = await getFile(file.path)
        if (!('createSyncAccessHandle' in fh)) {
          return writeOpfsFile(fh, file, relaxedDurability)
        }
        sh = (await (
          fh as any
        ).createSyncAccessHandle()) as FileSystemSyncAccessHandle
      }
      this.#walHandles.delete(file.path)
      this.#walHandles.set(file.path, sh)
      try {
        writeSyncHandle(sh, file, relaxedDurability)
      } catch (e) {
        this.#closeWalHandles(file.path)
        throw e
      }
    }
    await runWithConcurrency(wal, this.maxConcurrentWrites, writeWal)
    // Trimmed only once the WAL writes are done, so that a handle is never
    // closed while another write of this flush is about to use it
    this.#trimWalHandles()
    for (const group of [data, control]) {
      await runWithConcurrency(group, this.maxConcurrentWrites, write)
    }
    if (this.debug) {
      console.log(
        `MEMFS2OPFS: flushed ${snapshot.ops.length} ops, ${snapshot.files.length} files`,
      )
    }
  }

  #trimWalHandles() {
    for (const [path, sh] of this.#walHandles) {
      if (this.#walHandles.size <= MAX_OPEN_WAL_HANDLES) break
      this.#walHandles.delete(path)
      closeQuietly(sh)
    }
  }

  // Close the open WAL handles at or below path, or all of them
  #closeWalHandles(path?: string) {
    for (const [walPath, sh] of this.#walHandles) {
      if (path && walPath !== path && !walPath.startsWith(path + '/')) continue
      this.#walHandles.delete(walPath)
      closeQuietly(sh)
    }
  }

  // Loading:

  async #loadDir(dh: FileSystemDirectoryHandle, path: string) {
    const FS = this.pg!.Module.FS
    for await (const [name, handle] of (dh as any).entries() as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      const childPath = `${path}/${name}`
      if (handle.kind === 'directory') {
        FS.mkdir(childPath, 0o700)
        await this.#loadDir(handle as FileSystemDirectoryHandle, childPath)
      } else {
        const file = await (handle as FileSystemFileHandle).getFile()
        const data = new Uint8Array(await file.arrayBuffer())
        FS.writeFile(childPath, data, { mode: 0o600, canOwn: true } as any)
        FS.utime(childPath, file.lastModified, file.lastModified)
      }
    }
  }

  // Helpers:

  #isAttached(node: MemNode): boolean {
    while (node.parent !== node) {
      if (node.parent.contents?.[node.name] !== node) return false
      node = node.parent
    }
    return node === this.#rootNode
  }

  // Path of a node relative to the mount point, eg. "/base/1/1259"
  #relPath(mod: PostgresMod, node: MemNode): string {
    return (mod.FS as any).getPath(node).slice(PGDATA.length)
  }

  #joinPath(dir: string, name: string): string {
    return `${dir}/${name}`
  }

  async #resolveOpfsDirectory(
    path: string,
    options: { from: FileSystemDirectoryHandle; create?: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    let dh = options.from
    for (const part of pathParts(path)) {
      dh = await dh.getDirectoryHandle(part, { create: options.create })
    }
    return dh
  }
}

function pathParts(path: string): string[] {
  return path.split('/').filter(Boolean)
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }
  return merged
}

function copyBytes(contents: any, start: number, end: number): Uint8Array {
  if (!contents) return new Uint8Array(end - start)
  return new Uint8Array(
    contents.subarray
      ? contents.subarray(start, end)
      : contents.slice(start, end),
  )
}

/**
 * Write the changed parts of a file, opening and closing the handle.
 * Sync access handles are only available in dedicated workers, elsewhere
 * we fall back to a writable stream.
 */
async function writeOpfsFile(
  fh: FileSystemFileHandle,
  file: FileWrite,
  relaxedDurability: boolean,
) {
  if ('createSyncAccessHandle' in fh) {
    const sh: FileSystemSyncAccessHandle = await (
      fh as any
    ).createSyncAccessHandle()
    try {
      writeSyncHandle(sh, file, relaxedDurability)
    } finally {
      sh.close()
    }
  } else {
    const writable = await (fh as any).createWritable({
      keepExistingData: !file.full,
    })
    try {
      if (file.truncate && !file.full) {
        await writable.truncate(file.size)
      }
      for (const chunk of file.chunks) {
        await writable.write({
          type: 'write',
          position: chunk.at,
          data: chunk.data,
        })
      }
      await writable.close()
    } catch (e) {
      await writable.abort().catch(() => {})
      throw e
    }
  }
}

function writeSyncHandle(
  sh: FileSystemSyncAccessHandle,
  file: FileWrite,
  relaxedDurability: boolean,
) {
  if (file.truncate) sh.truncate(file.size)
  for (const chunk of file.chunks) {
    sh.write(chunk.data, { at: chunk.at })
  }
  if (!relaxedDurability) sh.flush()
}

function closeQuietly(sh: FileSystemSyncAccessHandle) {
  try {
    sh.close()
  } catch (e) {
    // Already closed
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      await fn(items[next++])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
}
