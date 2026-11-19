import assert from 'node:assert/strict'

// Read only the import section instead of disassembling the whole module to
// WAT. Large extension modules (notably PostGIS) produce WAT larger than
// Node's child-process buffers, while the information audited here occupies
// only a few bytes in the Wasm binary.
export function memoryImportTypes(bytes) {
  const reader = binaryReader(bytes)
  assert.deepEqual([...reader.bytes(8)], [0, 97, 115, 109, 1, 0, 0, 0])

  const memories = new Map()
  while (!reader.done()) {
    const sectionId = reader.byte()
    const section = binaryReader(reader.bytes(reader.uleb()))
    if (sectionId !== 2) continue

    const count = section.uleb()
    for (let index = 0; index < count; index++) {
      const module = section.string()
      const name = section.string()
      const kind = section.byte()
      switch (kind) {
        case 0: // function type index
          section.uleb()
          break
        case 1: // table type
          section.byte()
          readLimits(section)
          break
        case 2: // memory type
          memories.set(`${module}\0${name}`, readLimits(section))
          break
        case 3: // global type
          section.byte()
          section.byte()
          break
        case 4: // tag type
          section.uleb()
          section.uleb()
          break
        default:
          throw new Error(`unsupported Wasm import kind ${kind}`)
      }
    }
    assert.equal(section.done(), true, 'trailing bytes in Wasm import section')
    return memories
  }
  return memories
}

function readLimits(reader) {
  const flags = reader.uleb()
  const hasMaximum = (flags & 1) !== 0
  const shared = (flags & 2) !== 0
  const memory64 = (flags & 4) !== 0
  const initialPages = reader.uleb()
  const maximumPages = hasMaximum ? reader.uleb() : undefined
  assert.equal(memory64, false, 'memory64 imports are outside wasm32-initial')
  return { initialPages, maximumPages, shared }
}

function binaryReader(bytes) {
  let offset = 0
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    byte() {
      assert.ok(offset < view.length, 'unexpected end of Wasm binary')
      return view[offset++]
    },
    bytes(length) {
      assert.ok(offset + length <= view.length, 'truncated Wasm binary')
      const result = view.subarray(offset, offset + length)
      offset += length
      return result
    },
    uleb() {
      let result = 0
      let shift = 0
      while (true) {
        const byte = this.byte()
        result += (byte & 0x7f) * 2 ** shift
        assert.ok(Number.isSafeInteger(result), 'Wasm integer exceeds JS range')
        if ((byte & 0x80) === 0) return result
        shift += 7
        assert.ok(shift < 56, 'invalid Wasm unsigned LEB128')
      }
    },
    string() {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        this.bytes(this.uleb()),
      )
    },
    done() {
      return offset === view.length
    },
  }
}
