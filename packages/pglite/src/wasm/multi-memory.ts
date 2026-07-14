const PRIVATE_LIMIT = 0x80000000
const SHARED_APERTURE = 0x40000000
const TAG_MASK = 0xc0000000
const GLOBAL_TAG = 0x80000000
const SCOPED_TAG = 0xc0000000

export type PgliteMemoryIndex = 0 | 1 | 2

export interface WasmViews {
  readonly buffer: ArrayBuffer | SharedArrayBuffer
  readonly u8: Uint8Array
  readonly data: DataView
}
function createViews(memory: WebAssembly.Memory): WasmViews {
  const buffer = memory.buffer
  return {
    buffer,
    u8: new Uint8Array(buffer),
    data: new DataView(buffer),
  }
}

class RefreshingViews {
  #views: WasmViews

  constructor(readonly memory: WebAssembly.Memory) {
    this.#views = createViews(memory)
  }

  get current(): WasmViews {
    const buffer = this.memory.buffer
    // An unshared grow detaches the old buffer, so do not inspect its
    // byteLength. Shared growth also makes memory.buffer return a new,
    // larger SharedArrayBuffer object.
    if (this.#views.buffer !== buffer) {
      this.#views = createViews(this.memory)
    }
    return this.#views
  }
}

export interface PgliteMemories {
  private: WebAssembly.Memory
  global: WebAssembly.Memory
  scoped?: WebAssembly.Memory
}

export interface DecodePointerOptions {
  nullable?: boolean
  allowScoped?: boolean
}

export interface DecodedPointer {
  readonly pointer: number
  readonly memory: PgliteMemoryIndex
  readonly offset: number
  readonly length: number
  readonly views: WasmViews
}

/**
 * Owns the typed-array view families for the tagged PGlite pointer ABI.
 * Accessors refresh lazily after either shared or unshared Wasm memory growth.
 */
export class PgliteMemoryViews {
  readonly #private: RefreshingViews
  readonly #global: RefreshingViews
  readonly #scoped?: RefreshingViews

  constructor(memories: PgliteMemories) {
    this.#private = new RefreshingViews(memories.private)
    this.#global = new RefreshingViews(memories.global)
    this.#scoped = memories.scoped
      ? new RefreshingViews(memories.scoped)
      : undefined
  }

  get private(): WasmViews {
    return this.#private.current
  }

  get global(): WasmViews {
    return this.#global.current
  }

  get scoped(): WasmViews | undefined {
    return this.#scoped?.current
  }

  forMemory(memory: PgliteMemoryIndex): WasmViews {
    if (memory === 0) return this.private
    if (memory === 1) return this.global
    const scoped = this.scoped
    if (!scoped) throw new RangeError('scoped memory is not bound')
    return scoped
  }

  decodePointer(
    pointer: number,
    length: number,
    options: DecodePointerOptions = {},
  ): DecodedPointer | null {
    if (!Number.isInteger(pointer)) {
      throw new TypeError('pointer must be a 32-bit integer')
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError('pointer length must be a non-negative safe integer')
    }

    const ptr = pointer >>> 0
    if (ptr === 0) {
      if (options.nullable) return null
      throw new RangeError('null pointer is not allowed')
    }

    const tag = (ptr & TAG_MASK) >>> 0
    let memory: PgliteMemoryIndex
    let offset: number
    let aperture: number

    if ((ptr & GLOBAL_TAG) === 0) {
      memory = 0
      offset = ptr
      aperture = PRIVATE_LIMIT
    } else if (tag === GLOBAL_TAG) {
      memory = 1
      offset = ptr & 0x3fffffff
      aperture = SHARED_APERTURE
    } else if (tag === SCOPED_TAG) {
      if (!options.allowScoped) {
        throw new RangeError('scoped pointer tag is reserved in the v1 ABI')
      }
      memory = 2
      offset = ptr & 0x3fffffff
      aperture = SHARED_APERTURE
    } else {
      throw new RangeError(`invalid pointer tag: 0x${tag.toString(16)}`)
    }

    const end = offset + length
    if (!Number.isSafeInteger(end) || end > aperture) {
      throw new RangeError('pointer range crosses its memory aperture')
    }

    const views = this.forMemory(memory)
    if (end > views.buffer.byteLength) {
      throw new RangeError('pointer range exceeds the bound Wasm memory')
    }

    return { pointer: ptr, memory, offset, length, views }
  }
}
