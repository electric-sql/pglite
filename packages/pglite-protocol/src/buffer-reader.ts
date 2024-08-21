const emptyBuffer = new ArrayBuffer(0)

export class BufferReader {
  #bufferView: DataView = new DataView(emptyBuffer)
  #offset: number

  // TODO(bmc): support non-utf8 encoding?
  readonly #encoding: string = 'utf-8' as const
  readonly #decoder = new TextDecoder(this.#encoding)
  readonly #littleEndian: boolean = false as const

  constructor(offset: number = 0) {
    this.#offset = offset
  }

  public setBuffer(offset: number, buffer: ArrayBuffer): void {
    this.#offset = offset
    this.#bufferView = new DataView(buffer)
  }

  public int16(): number {
    // const result = this.buffer.readInt16BE(this.#offset)
    const result = this.#bufferView.getInt16(this.#offset, this.#littleEndian)
    this.#offset += 2
    return result
  }

  public byte(): number {
    // const result = this.bufferView[this.#offset]
    const result = this.#bufferView.getUint8(this.#offset)
    this.#offset++
    return result
  }

  public int32(): number {
    // const result = this.buffer.readInt32BE(this.#offset)
    const result = this.#bufferView.getInt32(this.#offset, this.#littleEndian)
    this.#offset += 4
    return result
  }

  public string(length: number): string {
    // const result = this.#bufferView.toString(
    //   this.#encoding,
    //   this.#offset,
    //   this.#offset + length,
    // )
    // this.#offset += length

    const result = this.#decoder.decode(this.bytes(length))
    return result
  }

  public cstring(): string {
    // const start = this.#offset
    // let end = start
    // while (this.#bufferView[end++] !== 0) {}

    const start = this.#offset
    let end = start
    while (this.#bufferView.getUint8(end++) !== 0) {}
    const result = this.string(end - start - 1)
    this.#offset = end
    return result
  }

  public bytes(length: number): ArrayBuffer {
    // const result = this.buffer.slice(this.#offset, this.#offset + length)
    const result = this.#bufferView.buffer.slice(
      this.#offset,
      this.#offset + length,
    )
    this.#offset += length
    return result
  }
}
