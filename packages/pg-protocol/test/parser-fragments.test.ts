import { describe, expect, it, vi } from 'vitest'
import { Parser } from '../src'
import buffers from './testing/test-buffers'
import type {
  BackendMessage,
  DataRowMessage,
  CopyDataMessage,
} from '../src/messages'

const fields = ['é🙂 fragmented row', null, 'last']
const frame = buffers.dataRow(fields)

function bounded(bytes: Uint8Array): DataView {
  const storage = new Uint8Array(bytes.length + 14)
  storage.fill(255)
  storage.set(bytes, 7)
  return new DataView(storage.buffer, 7, bytes.length)
}

describe('fragment snapshots', () => {
  it.each(Array.from({ length: frame.length - 1 }, (_, i) => i + 1))(
    'preserves bounded views split at byte %i',
    (split) => {
      const parser = new Parser()
      const messages: BackendMessage[] = []
      const first = bounded(frame.subarray(0, split))
      parser.parse(first, (message) => messages.push(message))
      expect(messages).toHaveLength(0)
      new Uint8Array(first.buffer).fill(0)
      parser.parse(bounded(frame.subarray(split)), (message) =>
        messages.push(message),
      )
      expect(messages).toHaveLength(1)
      expect((messages[0] as DataRowMessage).fields).toEqual(fields)
    },
  )

  it('copies a non-aliased continuation directly into owned storage', () => {
    const parser = new Parser()
    parser.parse(frame.subarray(0, 8), () => {})
    const spy = vi.spyOn(ArrayBuffer.prototype, 'slice')
    const messages: BackendMessage[] = []
    try {
      parser.parse(bounded(frame.subarray(8)), (message) =>
        messages.push(message),
      )
      expect((messages[0] as DataRowMessage).fields).toEqual(fields)
      // Text decoding also uses views; this whole row needs no temporary slices.
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('snapshots an aliased view before compacting the pending fragment', () => {
    const prefix = buffers.commandComplete('x'.repeat(100))
    const split = 15
    const owned = new Uint8Array(prefix.length + split)
    owned.set(prefix)
    owned.set(frame.subarray(0, split), prefix.length)
    const parser = new Parser()
    const messages: BackendMessage[] = []
    // ArrayBuffer inputs are handed over without a snapshot, as before.
    parser.parse(owned.buffer, (message) => messages.push(message))
    owned.set(frame.subarray(split), 0)
    parser.parse(
      new DataView(owned.buffer, 0, frame.length - split),
      (message) => messages.push(message),
    )
    expect(messages.map((m) => m.name)).toEqual(['commandComplete', 'dataRow'])
    expect((messages[1] as DataRowMessage).fields).toEqual(fields)
  })

  it('finishes taking a snapshot before calling user callbacks', () => {
    const parser = new Parser()
    const messages: BackendMessage[] = []
    parser.parse(frame.subarray(0, 8), () => {})
    const remainder = new Uint8Array(frame.length - 8 + frame.length)
    remainder.set(frame.subarray(8))
    remainder.set(frame, frame.length - 8)
    parser.parse(remainder, (message) => {
      messages.push(message)
      remainder.fill(0)
    })
    expect(messages).toHaveLength(2)
    expect(messages.map((m) => (m as DataRowMessage).fields)).toEqual([
      fields,
      fields,
    ])
  })

  it('keeps binary results owned after input mutation and parser reuse', () => {
    const payload = new Uint8Array([0, 255, 128, 1])
    const packet = buffers.copyData(payload.buffer)
    const parser = new Parser()
    const messages: BackendMessage[] = []
    parser.parse(packet.subarray(0, 6), (message) => messages.push(message))
    parser.parse(packet.subarray(6), (message) => messages.push(message))
    packet.fill(0)
    parser.parse(frame, (message) => messages.push(message))
    expect(Array.from((messages[0] as CopyDataMessage).chunk)).toEqual(
      Array.from(payload),
    )
    expect((messages[1] as DataRowMessage).fields).toEqual(fields)
  })
})
