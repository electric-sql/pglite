import { EmscriptenBuiltinFilesystem } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import type { PGlite } from '../pglite.js'
import { PGDATA } from '../initdb.js'

// Storage backend interface:
// Paths are relative to PGDATA and start with a slash, eg. "/base/1/1259".

export interface FileWrite {
  path: string
  // Size of the file after the write
  size: number
  // The chunks are the whole file
  full: boolean
  // Resize the file to `size`
  truncate: boolean
  chunks: Array<{ at: number; data: Uint8Array }>
}

export interface ChangeSet {
  // Structural changes, to apply in order and before the file writes. A remove
  // is recursive, removing a path that doesn't exist is not an error.
  ops: Array<{ op: 'remove' | 'mkdir'; path: string }>
  // To write in this group order: the WAL before the data files and
  // pg_control last, so that an interrupted flush leaves a state postgres can
  // recover from.
  files: { wal: FileWrite[]; data: FileWrite[]; control: FileWrite[] }
}

export type StorageEntry =
  | { kind: 'dir'; path: string }
  | { kind: 'file'; path: string; data: Uint8Array; mtime?: number }

/**
 * Where a MemfsFrontendFS persists its files.
 */
export interface StorageBackend {
  /**
   * Called once, before the emscripten module starts.
   */
  init(): Promise<void>
  /**
   * List the persisted entries, parents before their children.
   */
  load(): AsyncIterable<StorageEntry>
  /**
   * Persist the changes of one flush. Never called concurrently, if it throws
   * the changes stay pending and are passed again with the next flush.
   */
  apply(
    changes: ChangeSet,
    options: { relaxedDurability: boolean },
  ): Promise<void>
  /**
   * Called once, after the final flush.
   */
  close(): Promise<void>
}

export interface MemfsFrontendOptions {
  debug?: boolean
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

interface Snapshot {
  changes: ChangeSet
  // The raw tracking state, restored if the flush fails
  journal: JournalEntry[]
  dirty: Map<MemNode, DirtyFile>
}

// Merge the range list once it grows past this, keeps memory bounded when
// postgres writes many scattered pages between two flushes.
const MERGE_RANGES_THRESHOLD = 1024

/**
 * PGlite filesystem with a MEMFS frontend and a pluggable storage backend.
 * All operations act on an emscripten MEMFS mounted at PGDATA, so the database
 * behaves exactly as with the in-memory filesystem. The node and stream ops of
 * that mount are wrapped to record which files and directories were touched,
 * and these changes are passed to the backend in `syncToFs`, ie. after each
 * query.
 */
export class MemfsFrontendFS extends EmscriptenBuiltinFilesystem {
  readonly backend: StorageBackend
  readonly debug: boolean

  #rootNode?: MemNode
  #ops?: { dir: { node: any; stream: any }; file: { node: any; stream: any } }

  #tracking = true
  #journal: JournalEntry[] = []
  #dirty = new Map<MemNode, DirtyFile>()
  #flushing: Promise<void> = Promise.resolve()
  #warnedSymlink = false

  constructor(
    backend: StorageBackend,
    { debug = false }: MemfsFrontendOptions = {},
  ) {
    super()
    this.backend = backend
    this.debug = debug
  }

  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    this.pg = pg
    await this.backend.init()
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
   * Load the files persisted by the backend into the MEMFS mount.
   */
  async initialSyncFs() {
    const FS = this.pg!.Module.FS
    this.#tracking = false
    try {
      for await (const entry of this.backend.load()) {
        const path = PGDATA + entry.path
        if (entry.kind === 'dir') {
          FS.mkdir(path, 0o700)
        } else {
          FS.writeFile(path, entry.data, { mode: 0o600, canOwn: true } as any)
          if (entry.mtime !== undefined) {
            FS.utime(path, entry.mtime, entry.mtime)
          }
        }
      }
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
    await this.backend.close()
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
              console.warn('MEMFS frontend: symlinks are not persisted')
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
      await this.backend.apply(snapshot.changes, { relaxedDurability })
    } catch (e) {
      this.#restoreSnapshot(snapshot)
      throw e
    }
    if (this.debug) {
      const { ops, files } = snapshot.changes
      const count = files.wal.length + files.data.length + files.control.length
      console.log(`MEMFS frontend: flushed ${ops.length} ops, ${count} files`)
    }
  }

  /**
   * Synchronously capture the pending changes, including a copy of the data to
   * write, so that the filesystem can keep changing while the flush runs.
   */
  #takeSnapshot(): Snapshot {
    const mod = this.pg!.Module
    const FS = mod.FS as any
    const ops: ChangeSet['ops'] = []
    for (const entry of this.#journal) {
      if (entry.op === 'remove') {
        ops.push(entry)
      } else if (FS.isDir(entry.node.mode) && this.#isAttached(entry.node)) {
        ops.push({ op: 'mkdir', path: this.#relPath(mod, entry.node) })
      }
    }
    // Write the WAL before the data files and pg_control last, so that an
    // interrupted flush leaves a state postgres can recover from.
    const files: ChangeSet['files'] = { wal: [], data: [], control: [] }
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
      const path = this.#relPath(mod, node)
      const group = path.startsWith('/pg_wal/')
        ? files.wal
        : path === '/global/pg_control'
          ? files.control
          : files.data
      group.push({
        path,
        size,
        full: dirty.full,
        truncate: dirty.full || dirty.resized,
        chunks,
      })
    }
    const snapshot = {
      changes: { ops, files },
      journal: this.#journal,
      dirty: this.#dirty,
    }
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
