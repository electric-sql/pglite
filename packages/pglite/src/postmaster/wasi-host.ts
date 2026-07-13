import type { FS as PostgresFileSystem } from '../postgresMod.js'
import { PgliteMemoryViews, type DecodedPointer } from '../wasm/multi-memory.js'

const WASI_EBADF = 8
const IOVEC_BYTES = 8
const U32_BYTES = 4
const MAX_IOVECS = 0x1fffffff

type WasiFdWrite = (
  fd: number,
  iovecs: number,
  iovecCount: number,
  bytesWritten: number,
) => number

type WasiImports = Record<string, Record<string, unknown>>

interface WriteVector {
  readonly length: number
  readonly source: DecodedPointer | null
}

/**
 * Replace Emscripten's memory-0-only WASI fd_write adapter with one that can
 * follow tagged iovec payload pointers. The generated adapter remains the
 * fast path when the iovec array, result cell, and every payload are private.
 */
export function installMemoryAwareWasiFdWrite(
  imports: WebAssembly.Imports,
  memories: PgliteMemoryViews,
  getFileSystem: () => PostgresFileSystem | undefined,
): void {
  const hostImports = imports as WasiImports
  const wasi = hostImports.wasi_snapshot_preview1
  const original = wasi?.fd_write
  if (typeof original !== 'function') {
    throw new Error('Wasm module has no wasi_snapshot_preview1.fd_write import')
  }

  wasi.fd_write = createMemoryAwareFdWrite(
    original as WasiFdWrite,
    memories,
    getFileSystem,
  )
}

export function createMemoryAwareFdWrite(
  original: WasiFdWrite,
  memories: PgliteMemoryViews,
  getFileSystem: () => PostgresFileSystem | undefined,
): WasiFdWrite {
  return (fd, iovecs, iovecCount, bytesWritten) => {
    if (
      !Number.isInteger(iovecCount) ||
      iovecCount < 0 ||
      iovecCount > MAX_IOVECS
    ) {
      throw new RangeError('WASI fd_write iovec count is out of range')
    }

    const iovecArray = memories.decodePointer(
      iovecs,
      iovecCount * IOVEC_BYTES,
      { allowScoped: true },
    )!
    const result = memories.decodePointer(bytesWritten, U32_BYTES, {
      allowScoped: true,
    })!
    const vectors: WriteVector[] = []
    let allPrivate = iovecArray.memory === 0 && result.memory === 0

    for (let index = 0; index < iovecCount; index++) {
      const entry = iovecArray.offset + index * IOVEC_BYTES
      const base = iovecArray.views.data.getUint32(entry, true)
      const length = iovecArray.views.data.getUint32(entry + U32_BYTES, true)
      const source =
        length === 0
          ? null
          : memories.decodePointer(base, length, { allowScoped: true })!
      if (source ? source.memory !== 0 : base >>> 0 >= 0x80000000) {
        allPrivate = false
      }
      vectors.push({ length, source })
    }

    if (allPrivate) {
      return original(fd, iovecs, iovecCount, bytesWritten)
    }

    const fileSystem = getFileSystem()
    if (!fileSystem) {
      throw new Error('WASI fd_write reached tagged memory before FS startup')
    }

    try {
      const stream = fileSystem.getStream(fd)
      if (!stream) return WASI_EBADF

      let total = 0
      for (const vector of vectors) {
        if (vector.length === 0) continue
        const source = vector.source!
        const written = fileSystem.write(
          stream,
          source.views.u8,
          source.offset,
          vector.length,
        )
        if (
          !Number.isInteger(written) ||
          written < 0 ||
          written > vector.length
        ) {
          throw new RangeError('FS.write returned an invalid byte count')
        }
        total += written
        if (written !== vector.length) break
      }
      result.views.data.setUint32(result.offset, total, true)
      return 0
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        (error as { name?: unknown }).name === 'ErrnoError' &&
        typeof (error as { errno?: unknown }).errno === 'number'
      ) {
        return (error as { errno: number }).errno
      }
      throw error
    }
  }
}
