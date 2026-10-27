import type {
  ChangeSet,
  FileWrite,
  StorageBackend,
  StorageEntry,
} from './memfs-frontend.js'
import { MemfsFrontendFS } from './memfs-frontend.js'

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

// Postgres writes to one WAL segment at a time, keep the handles of the most
// recently written segments open as nearly every query appends to them.
const MAX_OPEN_WAL_HANDLES = 2
const WAL_SEGMENT_RE = /^\/pg_wal\/[0-9A-F]{24}$/

/**
 * Storage backend that mirrors PGDATA in an OPFS directory.
 * Unlike OPFS-AHP, no OPFS file handles are kept open between flushes, except
 * for the sync access handles of the current WAL segments.
 */
export class OpfsBackend implements StorageBackend {
  readonly dataDir: string
  readonly maxConcurrentWrites: number

  #dataDirDh!: FileSystemDirectoryHandle
  // Open WAL segment handles by path, in least recently written order
  #walHandles = new Map<string, FileSystemSyncAccessHandle>()

  constructor(
    dataDir: string,
    {
      maxConcurrentWrites = 16,
    }: Pick<Memfs2OpfsOptions, 'maxConcurrentWrites'> = {},
  ) {
    this.dataDir = dataDir
    this.maxConcurrentWrites = maxConcurrentWrites
  }

  async init() {
    this.#dataDirDh = await this.#resolveOpfsDirectory(this.dataDir, {
      from: await navigator.storage.getDirectory(),
      create: true,
    })
  }

  load(): AsyncIterable<StorageEntry> {
    return loadDir(this.#dataDirDh, '')
  }

  async apply(
    changes: ChangeSet,
    { relaxedDurability }: { relaxedDurability: boolean },
  ) {
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
    for (const op of changes.ops) {
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
    const { wal, data, control } = changes.files
    await runWithConcurrency(wal, this.maxConcurrentWrites, writeWal)
    // Trimmed only once the WAL writes are done, so that a handle is never
    // closed while another write of this flush is about to use it
    this.#trimWalHandles()
    for (const group of [data, control]) {
      await runWithConcurrency(group, this.maxConcurrentWrites, write)
    }
  }

  async close() {
    this.#closeWalHandles()
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

/**
 * PGlite MEMFS to OPFS filesystem: a MEMFS frontend with an OPFS backend.
 */
export class Memfs2OpfsFS extends MemfsFrontendFS {
  declare readonly dataDir: string

  constructor(dataDir: string, options: Memfs2OpfsOptions = {}) {
    super(new OpfsBackend(dataDir, options), { debug: options.debug })
    this.dataDir = dataDir
  }
}

async function* loadDir(
  dh: FileSystemDirectoryHandle,
  path: string,
): AsyncGenerator<StorageEntry> {
  for await (const [name, handle] of (dh as any).entries() as AsyncIterable<
    [string, FileSystemHandle]
  >) {
    const childPath = `${path}/${name}`
    if (handle.kind === 'directory') {
      yield { kind: 'dir', path: childPath }
      yield* loadDir(handle as FileSystemDirectoryHandle, childPath)
    } else {
      const file = await (handle as FileSystemFileHandle).getFile()
      yield {
        kind: 'file',
        path: childPath,
        data: new Uint8Array(await file.arrayBuffer()),
        mtime: file.lastModified,
      }
    }
  }
}

function pathParts(path: string): string[] {
  return path.split('/').filter(Boolean)
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
