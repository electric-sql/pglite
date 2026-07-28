import { waitAsync } from './control.js'

const CONNECTION_MAGIC = 0x5047434e
const CONNECTION_VERSION = 1
const HEADER_WORDS = 18

const ConnectionField = {
  Magic: 0,
  Version: 1,
  Generation: 2,
  Capacity: 3,
} as const

const RingField = {
  ReadCursor: 0,
  WriteCursor: 1,
  DataSequence: 2,
  SpaceSequence: 3,
  Closed: 4,
  Error: 5,
} as const

type RingField = (typeof RingField)[keyof typeof RingField]

const RING_WORDS = 6
const INBOUND_BASE = 6
const OUTBOUND_BASE = INBOUND_BASE + RING_WORDS

export class RingAbortedError extends Error {
  constructor(readonly code: number) {
    super(`PGlite connection ring aborted with code ${code}`)
  }
}

export class RingClosedError extends Error {
  constructor() {
    super('cannot write to a closed PGlite connection ring')
  }
}

export class StaleConnectionTransportError extends Error {
  constructor() {
    super('stale PGlite connection transport')
  }
}

export class SharedByteRing {
  private readonly words: Int32Array
  private readonly bytes: Uint8Array

  constructor(
    readonly buffer: SharedArrayBuffer,
    private readonly base: number,
    dataOffset: number,
    readonly capacity: number,
    private readonly onActivity?: () => void,
    private readonly validate?: () => void,
  ) {
    this.words = new Int32Array(buffer)
    this.bytes = new Uint8Array(buffer, dataOffset, capacity)
  }

  tryWrite(input: Uint8Array): number {
    this.checkError()
    if (Atomics.load(this.words, this.field(RingField.Closed)) !== 0) {
      throw new RingClosedError()
    }
    const read = this.cursor(RingField.ReadCursor)
    const write = this.cursor(RingField.WriteCursor)
    const available = this.capacity - ((write - read) >>> 0)
    const length = Math.min(input.length, available)
    if (length === 0) return 0
    copyIntoRing(this.bytes, write % this.capacity, input.subarray(0, length))
    Atomics.store(
      this.words,
      this.field(RingField.WriteCursor),
      (write + length) | 0,
    )
    this.bump(RingField.DataSequence)
    return length
  }

  async write(input: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < input.length) {
      const written = this.tryWrite(input.subarray(offset))
      if (written > 0) {
        offset += written
        continue
      }
      const sequence = Atomics.load(
        this.words,
        this.field(RingField.SpaceSequence),
      )
      if (this.freeBytes === 0) {
        await waitAsync(
          this.words,
          this.field(RingField.SpaceSequence),
          sequence,
        )
      }
    }
  }

  tryRead(maxBytes = this.capacity): Uint8Array | null {
    this.checkError()
    const read = this.cursor(RingField.ReadCursor)
    const write = this.cursor(RingField.WriteCursor)
    const available = (write - read) >>> 0
    if (available === 0) {
      return Atomics.load(this.words, this.field(RingField.Closed)) !== 0
        ? null
        : new Uint8Array()
    }
    const length = Math.min(available, maxBytes)
    const output = copyFromRing(this.bytes, read % this.capacity, length)
    Atomics.store(
      this.words,
      this.field(RingField.ReadCursor),
      (read + length) | 0,
    )
    this.bump(RingField.SpaceSequence)
    return output
  }

  async read(maxBytes = this.capacity): Promise<Uint8Array | null> {
    while (true) {
      const output = this.tryRead(maxBytes)
      if (output === null || output.length > 0) return output
      const sequence = Atomics.load(
        this.words,
        this.field(RingField.DataSequence),
      )
      if (this.usedBytes === 0 && !this.closed) {
        await waitAsync(
          this.words,
          this.field(RingField.DataSequence),
          sequence,
        )
      }
    }
  }

  async waitUntilClosed(): Promise<void> {
    while (!this.closed) {
      const sequence = Atomics.load(
        this.words,
        this.field(RingField.DataSequence),
      )
      if (!this.closed) {
        await waitAsync(
          this.words,
          this.field(RingField.DataSequence),
          sequence,
        )
      }
    }
  }

  close(): void {
    this.validate?.()
    Atomics.store(this.words, this.field(RingField.Closed), 1)
    this.bump(RingField.DataSequence)
    this.bump(RingField.SpaceSequence)
  }

  abort(code = 1): void {
    this.validate?.()
    Atomics.store(this.words, this.field(RingField.Error), code || 1)
    Atomics.store(this.words, this.field(RingField.Closed), 1)
    this.bump(RingField.DataSequence)
    this.bump(RingField.SpaceSequence)
  }

  get closed(): boolean {
    this.validate?.()
    return Atomics.load(this.words, this.field(RingField.Closed)) !== 0
  }

  get freeBytes(): number {
    this.validate?.()
    return this.capacity - this.usedBytes
  }

  get usedBytes(): number {
    this.validate?.()
    return (
      (this.cursor(RingField.WriteCursor) -
        this.cursor(RingField.ReadCursor)) >>>
      0
    )
  }

  private cursor(field: RingField): number {
    return Atomics.load(this.words, this.field(field)) >>> 0
  }

  private checkError(): void {
    this.validate?.()
    const error = Atomics.load(this.words, this.field(RingField.Error))
    if (error !== 0) throw new RingAbortedError(error)
  }

  private bump(field: RingField): void {
    const index = this.field(field)
    Atomics.add(this.words, index, 1)
    Atomics.notify(this.words, index)
    this.onActivity?.()
  }

  private field(field: RingField): number {
    return this.base + field
  }
}

export class ConnectionTransport {
  readonly inbound: SharedByteRing
  readonly outbound: SharedByteRing
  readonly capacity: number
  private readonly words: Int32Array
  private expectedGeneration: number

  private constructor(
    readonly buffer: SharedArrayBuffer,
    onActivity?: () => void,
  ) {
    this.words = new Int32Array(buffer)
    if (Atomics.load(this.words, ConnectionField.Magic) !== CONNECTION_MAGIC) {
      throw new Error('invalid PGlite connection magic')
    }
    if (
      Atomics.load(this.words, ConnectionField.Version) !== CONNECTION_VERSION
    ) {
      throw new Error('unsupported PGlite connection version')
    }
    this.capacity = Atomics.load(this.words, ConnectionField.Capacity)
    this.expectedGeneration = Atomics.load(
      this.words,
      ConnectionField.Generation,
    )
    if (
      buffer.byteLength !==
      HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT + this.capacity * 2
    ) {
      throw new Error('invalid PGlite connection buffer size')
    }
    const inboundOffset = HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT
    this.inbound = new SharedByteRing(
      buffer,
      INBOUND_BASE,
      inboundOffset,
      this.capacity,
      onActivity,
      () => this.validateGeneration(),
    )
    this.outbound = new SharedByteRing(
      buffer,
      OUTBOUND_BASE,
      inboundOffset + this.capacity,
      this.capacity,
      onActivity,
      () => this.validateGeneration(),
    )
  }

  static create(
    capacity = 64 * 1024,
    generation = 1,
    onActivity?: () => void,
  ): ConnectionTransport {
    if (
      !Number.isInteger(capacity) ||
      capacity <= 0 ||
      capacity >= 0x40000000 ||
      capacity % 2 !== 0
    ) {
      throw new RangeError('connection capacity is outside the supported range')
    }
    const buffer = new SharedArrayBuffer(
      HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT + capacity * 2,
    )
    const words = new Int32Array(buffer)
    Atomics.store(words, ConnectionField.Magic, CONNECTION_MAGIC)
    Atomics.store(words, ConnectionField.Version, CONNECTION_VERSION)
    Atomics.store(words, ConnectionField.Generation, generation)
    Atomics.store(words, ConnectionField.Capacity, capacity)
    return new ConnectionTransport(buffer, onActivity)
  }

  static attach(
    buffer: SharedArrayBuffer,
    onActivity?: () => void,
  ): ConnectionTransport {
    return new ConnectionTransport(buffer, onActivity)
  }

  reset(generation: number): void {
    if (!Number.isInteger(generation) || generation <= 0) {
      throw new RangeError('connection generation must be a positive integer')
    }
    // Invalidate every older transport before clearing reusable ring state.
    // Otherwise a stale frontend can race reset() and close or abort the next
    // connection occupying this slot while the old generation is still
    // visible.
    Atomics.store(this.words, ConnectionField.Generation, generation)
    this.expectedGeneration = generation
    for (const base of [INBOUND_BASE, OUTBOUND_BASE]) {
      for (let field = 0; field < RING_WORDS; field++) {
        Atomics.store(this.words, base + field, 0)
      }
    }
    new Uint8Array(
      this.buffer,
      HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
    ).fill(0)
  }

  get generation(): number {
    return this.expectedGeneration
  }

  private validateGeneration(): void {
    if (
      Atomics.load(this.words, ConnectionField.Generation) !==
      this.expectedGeneration
    ) {
      throw new StaleConnectionTransportError()
    }
  }

  async *readable(): AsyncGenerator<Uint8Array> {
    while (true) {
      const chunk = await this.outbound.read()
      if (chunk === null) return
      yield chunk
    }
  }

  write(data: Uint8Array): Promise<void> {
    return this.inbound.write(data)
  }

  end(): void {
    this.inbound.close()
  }

  abort(code = 1): void {
    this.inbound.abort(code)
    this.outbound.abort(code)
  }

  waitForClose(): Promise<void> {
    return this.outbound.waitUntilClosed()
  }
}

function copyIntoRing(
  target: Uint8Array,
  offset: number,
  source: Uint8Array,
): void {
  const first = Math.min(source.length, target.length - offset)
  target.set(source.subarray(0, first), offset)
  if (first < source.length) target.set(source.subarray(first), 0)
}

function copyFromRing(
  source: Uint8Array,
  offset: number,
  length: number,
): Uint8Array {
  const output = new Uint8Array(length)
  const first = Math.min(length, source.length - offset)
  output.set(source.subarray(offset, offset + first), 0)
  if (first < length) output.set(source.subarray(0, length - first), first)
  return output
}
