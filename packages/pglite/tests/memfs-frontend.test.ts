import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'
import {
  MemfsFrontendFS,
  type ChangeSet,
  type StorageBackend,
  type StorageEntry,
} from '../dist/fs/memfs-frontend.js'

// Keeps the persisted files in a Map, entries are directories (null) or file
// contents, keyed by path relative to PGDATA.
class MemoryBackend implements StorageBackend {
  entries = new Map<string, Uint8Array | null>()
  failNextApply = false
  applyCount = 0

  async init() {}

  async *load(): AsyncIterable<StorageEntry> {
    // Sorting by path puts parents before their children
    for (const path of [...this.entries.keys()].sort()) {
      const data = this.entries.get(path)
      yield data
        ? { kind: 'file', path, data: data.slice() }
        : { kind: 'dir', path }
    }
  }

  async apply(changes: ChangeSet) {
    if (this.failNextApply) {
      this.failNextApply = false
      throw new Error('apply failed')
    }
    this.applyCount++
    for (const { op, path } of changes.ops) {
      if (op === 'mkdir') {
        this.#mkdirs(path)
      } else {
        for (const key of [...this.entries.keys()]) {
          if (key === path || key.startsWith(path + '/')) {
            this.entries.delete(key)
          }
        }
      }
    }
    const { wal, data, control } = changes.files
    for (const file of [...wal, ...data, ...control]) {
      this.#mkdirs(file.path.slice(0, file.path.lastIndexOf('/')))
      let contents = this.entries.get(file.path) ?? new Uint8Array(0)
      if (file.truncate) contents = resize(contents, file.size)
      for (const { at, data } of file.chunks) {
        if (at + data.length > contents.length) {
          contents = resize(contents, at + data.length)
        }
        contents.set(data, at)
      }
      this.entries.set(file.path, contents)
    }
  }

  async close() {}

  #mkdirs(path: string) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const dir = '/' + parts.slice(0, i).join('/')
      if (!this.entries.has(dir)) this.entries.set(dir, null)
    }
  }
}

function resize(data: Uint8Array, size: number) {
  const resized = new Uint8Array(size)
  resized.set(data.subarray(0, Math.min(size, data.length)))
  return resized
}

// List the PGDATA tree of a running instance, in the backend's format
function memfsEntries(pg: PGlite) {
  const FS = pg.Module.FS
  const entries = new Map<string, Uint8Array | null>()
  const walk = (path: string) => {
    for (const name of FS.readdir('/pglite/data' + path)) {
      if (name === '.' || name === '..') continue
      const child = `${path}/${name}`
      if (FS.isDir(FS.stat('/pglite/data' + child).mode)) {
        entries.set(child, null)
        walk(child)
      } else {
        entries.set(child, FS.readFile('/pglite/data' + child))
      }
    }
  }
  walk('')
  return entries
}

// Paths that differ between two trees. Typed arrays are compared with Buffer,
// toEqual would compare a 16MB WAL segment index by index.
function diffEntries(
  a: Map<string, Uint8Array | null>,
  b: Map<string, Uint8Array | null>,
) {
  const diff: string[] = []
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path)
    const y = b.get(path)
    const same =
      a.has(path) &&
      b.has(path) &&
      (x && y ? Buffer.from(x).equals(Buffer.from(y)) : x === y)
    if (!same) diff.push(path)
  }
  return diff
}

describe('MEMFS frontend with a custom storage backend', () => {
  it('persists the data directory and loads it back', async () => {
    const backend = new MemoryBackend()
    let pg = await PGlite.create({ fs: new MemfsFrontendFS(backend) })
    await pg.exec('CREATE TABLE t (id int, v text)')
    await pg.exec(
      "INSERT INTO t SELECT g, 'row ' || g FROM generate_series(1, 1000) g",
    )
    await pg.exec('CHECKPOINT')
    await pg.exec('DELETE FROM t WHERE id > 500')
    await pg.exec('VACUUM FULL t')

    // The backend holds exactly what is in MEMFS
    expect(diffEntries(backend.entries, memfsEntries(pg))).toEqual([])
    await pg.close()

    pg = await PGlite.create({ fs: new MemfsFrontendFS(backend) })
    const res = await pg.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM t',
    )
    expect(res.rows).toEqual([{ count: 500 }])
    await pg.close()
  })

  it('keeps the changes of a failed flush for the next one', async () => {
    const backend = new MemoryBackend()
    let pg = await PGlite.create({ fs: new MemfsFrontendFS(backend) })
    await pg.exec('CREATE TABLE t (id int)')

    backend.failNextApply = true
    await expect(pg.exec('INSERT INTO t VALUES (1)')).rejects.toThrow(
      'apply failed',
    )
    const applied = backend.applyCount
    await pg.exec('INSERT INTO t VALUES (2)')
    expect(backend.applyCount).toBe(applied + 1)
    expect(diffEntries(backend.entries, memfsEntries(pg))).toEqual([])
    await pg.close()

    pg = await PGlite.create({ fs: new MemfsFrontendFS(backend) })
    const res = await pg.query<{ id: number }>('SELECT id FROM t ORDER BY id')
    expect(res.rows).toEqual([{ id: 1 }, { id: 2 }])
    await pg.close()
  })
})
