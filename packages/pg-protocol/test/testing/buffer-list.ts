import { byteLengthUtf8 } from '../../src/string-utils'

export default class BufferList {
  constructor(public buffers: ArrayBuffer[] = []) {}

  public add(buffer: ArrayBuffer, front?: boolean) {
    this.buffers[front ? 'unshift' : 'push'](buffer)
    return this
  }

  public addInt16(val: number, front?: boolean) {
    return this.add(new Uint8Array([val >>> 8, val >>> 0]).buffer, front)
  }

  public getByteLength(initial?: number) {
    return this.buffers.reduce((previous, current) => {
      return previous + current.byteLength
    }, initial ?? 0)
  }

  public addInt32(val: number, first?: boolean) {
    return this.add(
      new Uint8Array([
        (val >>> 24) & 0xff,
        (val >>> 16) & 0xff,
        (val >>> 8) & 0xff,
        (val >>> 0) & 0xff,
      ]).buffer,
      first,
    )
  }

  public addCString(val: string, front?: boolean) {
    const len = byteLengthUtf8(val)
    const bufferView = new Uint8Array(len + 1)
    new TextEncoder().encodeInto(val, bufferView)
    bufferView[len] = 0
    return this.add(bufferView.buffer, front)
  }

  public addString(val: string, front?: boolean) {
    const len = byteLengthUtf8(val)
    const bufferView = new Uint8Array(len)
    new TextEncoder().encodeInto(val, bufferView)
    return this.add(bufferView.buffer, front)
  }

  public addChar(char: string, first?: boolean) {
    const bufferView = new TextEncoder().encode(char)
    return this.add(bufferView.buffer, first)
  }

  public addByte(byte: number) {
    return this.add(new Uint8Array([byte]).buffer)
  }

  public join(appendLength?: boolean, char?: string): ArrayBuffer {
    let length = this.getByteLength()
    if (appendLength) {
      this.addInt32(length + 4, true)
      return this.join(false, char)
    }
    if (char) {
      this.addChar(char, true)
      length++
    }
    const result = new ArrayBuffer(length)
    let index = 0
    this.buffers.forEach((buffer) => {
      new Uint8Array(result).set(new Uint8Array(buffer), index)
      index += buffer.byteLength
    })
    return result
  }

  public static concat(...args: ArrayBuffer[]): ArrayBuffer {
    const total = new BufferList()
    for (let i = 0; i < args.length; i++) {
      total.add(args[i])
    }
    return total.join()
  }
}
