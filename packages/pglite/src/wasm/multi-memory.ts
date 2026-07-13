const PRIVATE_LIMIT = 0x80000000
const SHARED_APERTURE = 0x40000000
const TAG_MASK = 0xc0000000
const GLOBAL_TAG = 0x80000000
const SCOPED_TAG = 0xc0000000

export type PgliteMemoryIndex = 0 | 1 | 2

export interface WasmViews {
  readonly buffer: ArrayBuffer | SharedArrayBuffer
  readonly i8: Int8Array
  readonly u8: Uint8Array
  readonly i16: Int16Array
  readonly u16: Uint16Array
  readonly i32: Int32Array
  readonly u32: Uint32Array
  readonly i64: BigInt64Array
  readonly u64: BigUint64Array
  readonly f32: Float32Array
  readonly f64: Float64Array
  readonly data: DataView
}

function createViews(memory: WebAssembly.Memory): WasmViews {
  const buffer = memory.buffer
  return {
    buffer,
    i8: new Int8Array(buffer),
    u8: new Uint8Array(buffer),
    i16: new Int16Array(buffer),
    u16: new Uint16Array(buffer),
    i32: new Int32Array(buffer),
    u32: new Uint32Array(buffer),
    i64: new BigInt64Array(buffer),
    u64: new BigUint64Array(buffer),
    f32: new Float32Array(buffer),
    f64: new Float64Array(buffer),
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

export type WasmValueType =
  | 'i8'
  | 'u8'
  | 'i16'
  | 'u16'
  | 'i32'
  | 'u32'
  | 'i64'
  | 'u64'
  | 'float'
  | 'double'
  | '*'

const valueSize = (type: WasmValueType): number => {
  switch (type) {
    case 'i8':
    case 'u8':
      return 1
    case 'i16':
    case 'u16':
      return 2
    case 'i32':
    case 'u32':
    case 'float':
    case '*':
      return 4
    case 'i64':
    case 'u64':
    case 'double':
      return 8
  }
}

export function getTaggedValue(
  memories: PgliteMemoryViews,
  pointer: number,
  type: WasmValueType,
): number | bigint {
  const decoded = memories.decodePointer(pointer, valueSize(type))!
  const { data } = decoded.views
  const offset = decoded.offset
  switch (type) {
    case 'i8':
      return data.getInt8(offset)
    case 'u8':
      return data.getUint8(offset)
    case 'i16':
      return data.getInt16(offset, true)
    case 'u16':
      return data.getUint16(offset, true)
    case 'i32':
      return data.getInt32(offset, true)
    case 'u32':
      return data.getUint32(offset, true)
    case 'i64':
      return data.getBigInt64(offset, true)
    case 'u64':
      return data.getBigUint64(offset, true)
    case 'float':
      return data.getFloat32(offset, true)
    case 'double':
      return data.getFloat64(offset, true)
    case '*':
      return data.getUint32(offset, true)
  }
}

export function setTaggedValue(
  memories: PgliteMemoryViews,
  pointer: number,
  value: number | bigint,
  type: WasmValueType,
): void {
  const decoded = memories.decodePointer(pointer, valueSize(type))!
  const { data } = decoded.views
  const offset = decoded.offset
  switch (type) {
    case 'i8':
      data.setInt8(offset, Number(value))
      return
    case 'u8':
      data.setUint8(offset, Number(value))
      return
    case 'i16':
      data.setInt16(offset, Number(value), true)
      return
    case 'u16':
      data.setUint16(offset, Number(value), true)
      return
    case 'i32':
      data.setInt32(offset, Number(value), true)
      return
    case 'u32':
    case '*':
      data.setUint32(offset, Number(value), true)
      return
    case 'i64':
      data.setBigInt64(offset, BigInt(value), true)
      return
    case 'u64':
      data.setBigUint64(offset, BigInt(value), true)
      return
    case 'float':
      data.setFloat32(offset, Number(value), true)
      return
    case 'double':
      data.setFloat64(offset, Number(value), true)
  }
}

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

export function taggedUTF8ToString(
  memories: PgliteMemoryViews,
  pointer: number,
  maxBytesToRead?: number,
): string {
  const first = memories.decodePointer(pointer, 1)!
  const available = first.views.u8.byteLength - first.offset
  const limit = Math.min(maxBytesToRead ?? available, available)
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('maximum string length must be non-negative')
  }
  const bytes = first.views.u8.subarray(first.offset, first.offset + limit)
  const terminator = bytes.indexOf(0)
  if (terminator < 0 && maxBytesToRead === undefined) {
    throw new RangeError('unterminated UTF-8 string')
  }
  return textDecoder.decode(
    terminator < 0 ? bytes : bytes.subarray(0, terminator),
  )
}

export function stringToTaggedUTF8(
  memories: PgliteMemoryViews,
  value: string,
  pointer: number,
  maxBytesToWrite: number,
): number {
  if (!Number.isSafeInteger(maxBytesToWrite) || maxBytesToWrite <= 0) {
    throw new RangeError('maximum string length must include a terminator')
  }
  const destination = memories.decodePointer(pointer, maxBytesToWrite)!
  const encoded = textEncoder.encode(value)
  const written = Math.min(encoded.byteLength, maxBytesToWrite - 1)
  destination.views.u8.set(encoded.subarray(0, written), destination.offset)
  destination.views.u8[destination.offset + written] = 0
  return written
}

declare const privatePointerBrand: unique symbol
export type PrivatePointer = number & { readonly [privatePointerBrand]: true }

/** Assert the contract required by an unmodified Emscripten memory-0 helper. */
export function privatePointer(
  pointer: number,
  nullable = false,
): PrivatePointer {
  if (!Number.isInteger(pointer))
    throw new TypeError('pointer must be an integer')
  const ptr = pointer >>> 0
  if (ptr === 0 && nullable) return ptr as PrivatePointer
  if (ptr === 0 || ptr >= PRIVATE_LIMIT) {
    throw new RangeError('Emscripten memory-0 helper received a tagged pointer')
  }
  return ptr as PrivatePointer
}

export interface RuntimePointerParameter {
  index: number
  nullable?: boolean
  length: number | ((args: readonly WasmHostValue[]) => number)
}

export type WasmHostValue = number | bigint
export type DecodedHostArgument = WasmHostValue | DecodedPointer | null
const taggedHostImportBrand = Symbol('pglite.taggedHostImport')
export type TaggedHostFunction = ((
  ...args: WasmHostValue[]
) => WasmHostValue | void) & { readonly [taggedHostImportBrand]: true }

/**
 * Adapts a narrow, memory-aware PGlite host operation to a Wasm import. The
 * host implementation receives decoded ranges and never has to inspect tags.
 */
export function taggedHostImport(
  memories: PgliteMemoryViews,
  pointerParameters: readonly RuntimePointerParameter[],
  implementation: (
    args: readonly DecodedHostArgument[],
  ) => WasmHostValue | void,
): TaggedHostFunction {
  const indexes = new Set<number>()
  for (const parameter of pointerParameters) {
    if (indexes.has(parameter.index)) {
      throw new Error(`duplicate pointer parameter ${parameter.index}`)
    }
    indexes.add(parameter.index)
  }

  const wrapped = (...args: WasmHostValue[]) => {
    const decoded: DecodedHostArgument[] = [...args]
    for (const parameter of pointerParameters) {
      const raw = args[parameter.index]
      if (typeof raw !== 'number') {
        throw new TypeError(`pointer parameter ${parameter.index} is not i32`)
      }
      const length =
        typeof parameter.length === 'function'
          ? parameter.length(args)
          : parameter.length
      decoded[parameter.index] = memories.decodePointer(raw, length, {
        nullable: parameter.nullable,
      })
    }
    return implementation(decoded)
  }
  Object.defineProperty(wrapped, taggedHostImportBrand, { value: true })
  return wrapped as TaggedHostFunction
}

/**
 * Guards an unchanged Emscripten helper whose implementation closes over the
 * memory-0 HEAP views. Tagged arguments fail before the helper can truncate or
 * misinterpret them.
 */
export function privateOnlyHostImport<
  T extends (...args: WasmHostValue[]) => WasmHostValue | void,
>(
  pointerParameters: readonly Pick<
    RuntimePointerParameter,
    'index' | 'nullable'
  >[],
  implementation: T,
): T {
  return ((...args: WasmHostValue[]) => {
    for (const parameter of pointerParameters) {
      const raw = args[parameter.index]
      if (typeof raw !== 'number') {
        throw new TypeError(`pointer parameter ${parameter.index} is not i32`)
      }
      args[parameter.index] = privatePointer(raw, parameter.nullable)
    }
    return implementation(...args)
  }) as T
}

export type HostImportClass =
  | 'scalar'
  | 'opaque-indirect'
  | 'private-only'
  | 'tagged'

export interface HostImportPointerParameter {
  index: number
  nullable: boolean
  /** Human- and tool-readable C/ABI length expression. */
  length: string
  direction: 'in' | 'out' | 'inout'
}

export interface HostImportManifestEntry {
  module: string
  name: string
  kind: WebAssembly.ImportExportKind
  class?: HostImportClass
  signature?: string
  pointers?: readonly HostImportPointerParameter[]
  returnPointer?: 'none' | 'private' | 'tagged'
}

export type HostImports = Record<string, Record<string, unknown>>
export type TaggedHostImplementations = Record<string, TaggedHostFunction>

export function auditHostImportManifest(
  module: WebAssembly.Module,
  manifest: readonly HostImportManifestEntry[],
): void {
  const expected = WebAssembly.Module.imports(module)
  const key = (entry: {
    module: string
    name: string
    kind: WebAssembly.ImportExportKind
  }) => `${entry.module}\u0000${entry.name}\u0000${entry.kind}`
  const byKey = new Map(manifest.map((entry) => [key(entry), entry]))
  if (byKey.size !== manifest.length) {
    throw new Error('host import manifest contains duplicate entries')
  }
  for (const imported of expected) {
    const entry = byKey.get(key(imported))
    if (!entry) {
      throw new Error(
        `unclassified Wasm import: ${imported.module}.${imported.name} (${imported.kind})`,
      )
    }
    byKey.delete(key(imported))
    if (imported.kind === 'function' && !entry.class) {
      throw new Error(
        `function import has no ABI class: ${imported.module}.${imported.name}`,
      )
    }
    if (
      imported.kind === 'function' &&
      entry.signature?.includes('p') &&
      (!entry.pointers || entry.pointers.length === 0)
    ) {
      throw new Error(
        `pointer-bearing import has no pointer manifest: ${imported.module}.${imported.name}`,
      )
    }
  }
  if (byKey.size) {
    const extra = [...byKey.values()][0]
    throw new Error(
      `host import manifest entry is not imported: ${extra.module}.${extra.name} (${extra.kind})`,
    )
  }
}

/**
 * Applies an audited manifest to the generated Emscripten imports. Scalar and
 * opaque table-call imports pass through, private-only imports gain tag guards,
 * and every tagged import requires an explicitly memory-aware replacement.
 */
export function hardenHostImports(
  module: WebAssembly.Module,
  imports: HostImports,
  manifest: readonly HostImportManifestEntry[],
  taggedImplementations: TaggedHostImplementations,
): HostImports {
  auditHostImportManifest(module, manifest)
  const hardened = Object.fromEntries(
    Object.entries(imports).map(([moduleName, values]) => [
      moduleName,
      { ...values },
    ]),
  )

  for (const entry of manifest) {
    if (entry.kind !== 'function') continue
    const values = hardened[entry.module]
    const original = values?.[entry.name]
    if (typeof original !== 'function') {
      throw new Error(
        `host function is not bound: ${entry.module}.${entry.name}`,
      )
    }
    const key = `${entry.module}.${entry.name}`
    if (entry.class === 'tagged') {
      const replacement = taggedImplementations[key]
      if (!replacement || replacement[taggedHostImportBrand] !== true) {
        throw new Error(
          `tagged host import has no memory-aware implementation: ${key}`,
        )
      }
      values[entry.name] = replacement
    } else if (entry.class === 'private-only') {
      values[entry.name] = privateOnlyHostImport(
        entry.pointers ?? [],
        original as (...args: WasmHostValue[]) => WasmHostValue | void,
      )
    }
  }
  return hardened
}
