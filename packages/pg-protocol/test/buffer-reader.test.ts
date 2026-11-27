import { describe, expect, it } from 'vitest'
import { BufferReader } from '../src/buffer-reader'

describe('BufferReader text', () => {
  it.each(['plain text', 'é🙂漢字', 'a\0b', '', '﻿text'])(
    'decodes %j with the standard UTF-8 decoder',
    (text) => {
      const input = new TextEncoder().encode(text)
      const reader = new BufferReader()
      reader.setBuffer(0, input.buffer)
      expect(reader.string(input.length)).toBe(new TextDecoder().decode(input))
    },
  )

  it('reads the selected window and advances to the following byte', () => {
    const reader = new BufferReader()
    const input = new Uint8Array([99, 65, 66, 42])
    reader.setBuffer(1, input.buffer)
    expect(reader.string(2)).toBe('AB')
    expect(reader.byte()).toBe(42)
  })

  it('replaces invalid UTF-8 as the standard decoder does', () => {
    const input = new Uint8Array([0xf0, 0x28, 0x8c, 0x28])
    const reader = new BufferReader()
    reader.setBuffer(0, input.buffer)
    expect(reader.string(input.length)).toBe(new TextDecoder().decode(input))
  })

  it('keeps decoded strings independent of later buffer reuse', () => {
    const input = new TextEncoder().encode('first')
    const reader = new BufferReader()
    reader.setBuffer(0, input.buffer)
    const first = reader.string(input.length)
    input.set(new TextEncoder().encode('later'))
    reader.setBuffer(0, input.buffer)
    expect(reader.string(input.length)).toBe('later')
    expect(first).toBe('first')
  })

  it('keeps bytes as an independent owning copy', () => {
    const input = new Uint8Array([1, 2, 3])
    const reader = new BufferReader()
    reader.setBuffer(0, input.buffer)
    const owned = reader.bytes(input.length)
    input.fill(9)
    expect([...owned]).toEqual([1, 2, 3])
    owned.fill(7)
    expect([...input]).toEqual([9, 9, 9])
  })

  it('preserves truncated-window decoding and cursor advancement', () => {
    const input = new TextEncoder().encode('abc')
    const reader = new BufferReader()
    reader.setBuffer(1, input.buffer)
    expect(reader.string(8)).toBe('bc')
    expect(() => reader.byte()).toThrow(RangeError)
  })

  it('preserves an empty negative-length window and its cursor', () => {
    const input = new TextEncoder().encode('abc')
    const reader = new BufferReader()
    reader.setBuffer(2, input.buffer)
    expect(reader.string(-1)).toBe('')
    expect(reader.byte()).toBe(98)
  })
})
