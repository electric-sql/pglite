//binary data writer tuned for encoding binary specific to the postgres binary protocol

export class Writer {
  #bufferView: DataView
  #offset: number = 5

  readonly #littleEndian = false as const
  readonly #encoder = new TextEncoder()
  readonly #headerPosition: number = 0
  constructor(private size = 256) {
    this.#bufferView = this.#allocateBuffer(size)
  }

  #allocateBuffer(size: number): DataView {
    return new DataView(new ArrayBuffer(size))
  }

  private ensure(size: number): void {
    const remaining = this.#bufferView.byteLength - this.#offset
    if (remaining < size) {
      const oldBuffer = this.#bufferView.buffer
      // exponential growth factor of around ~ 1.5
      // https://stackoverflow.com/questions/2269063/buffer-growth-strategy
      const newSize = oldBuffer.byteLength + (oldBuffer.byteLength >> 1) + size
      this.#bufferView = this.#allocateBuffer(newSize)
      new Uint8Array(this.#bufferView.buffer).set(new Uint8Array(oldBuffer))
    }
  }

  public addInt32(num: number): Writer {
    this.ensure(4)
    // this.buffer[this.#offset++] = (num >>> 24) & 0xff
    // this.buffer[this.#offset++] = (num >>> 16) & 0xff
    // this.buffer[this.#offset++] = (num >>> 8) & 0xff
    // this.buffer[this.#offset++] = (num >>> 0) & 0xff
    this.#bufferView.setInt32(this.#offset, num, this.#littleEndian)
    this.#offset += 4
    return this
  }

  public addInt16(num: number): Writer {
    this.ensure(2)
    // this.buffer[this.#offset++] = (num >>> 8) & 0xff
    // this.buffer[this.#offset++] = (num >>> 0) & 0xff
    this.#bufferView.setInt16(this.#offset, num, this.#littleEndian)
    this.#offset += 2
    return this
  }

  public addCString(string: string): Writer {
    if (string) {
      // TODO(msfstef): might be faster to extract `addString` code and
      // ensure length + 1 once rather than length and then +1?
      this.addString(string)
    }

    // set null terminator
    this.ensure(1)
    this.#bufferView.setUint8(this.#offset, 0)
    this.#offset++
    return this
  }

  public addString(string: string = ''): Writer {
    // TODO(msfstef): Write `byteLength` function to get size
    // of string wihtout creating buffer and use `encodeInto`
    // to write into buffer.
    // See https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encodeInto
    const encodedStr = this.#encoder.encode(string)
    const length = encodedStr.byteLength
    this.ensure(length)
    new Uint8Array(this.#bufferView.buffer).set(
      new Uint8Array(encodedStr),
      this.#offset,
    )
    this.#offset += length
    return this
  }

  public add(otherBuffer: ArrayBuffer): Writer {
    this.ensure(otherBuffer.byteLength)
    new Uint8Array(this.#bufferView.buffer).set(
      new Uint8Array(otherBuffer),
      this.#offset,
    )

    this.#offset += otherBuffer.byteLength
    return this
  }

  private join(code?: number): ArrayBuffer {
    if (code) {
      this.#bufferView.setUint8(this.#headerPosition, code)
      // length is everything in this packet minus the code
      const length = this.#offset - (this.#headerPosition + 1)
      this.#bufferView.setInt32(
        this.#headerPosition + 1,
        length,
        this.#littleEndian,
      )
    }
    return this.#bufferView.buffer.slice(code ? 0 : 5, this.#offset)
  }

  public flush(code?: number): ArrayBuffer {
    const result = this.join(code)
    this.#offset = 5
    this.#bufferView = this.#allocateBuffer(this.size)
    return result
  }
}
