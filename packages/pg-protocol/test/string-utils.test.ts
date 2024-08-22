import { describe, it, expect } from 'vitest'
import { byteLengthUtf8 } from '../src/string-utils' // Adjust the import based on your file structure

describe('byteLengthUtf8', () => {
  it('should return 0 for an empty string', () => {
    expect(byteLengthUtf8('')).toBe(0)
  })

  it('should return the correct byte length for ASCII characters', () => {
    expect(byteLengthUtf8('hello')).toBe(5) // Each character is 1 byte
  })

  it('should return the correct byte length for extended ASCII characters', () => {
    expect(byteLengthUtf8('©')).toBe(2) // © is U+00A9, which is 2 bytes in UTF-8
  })

  it('should return the correct byte length for characters from the BMP', () => {
    expect(byteLengthUtf8('你好')).toBe(6) // Each character is 3 bytes in UTF-8
  })

  it('should return the correct byte length for surrogate pairs', () => {
    expect(byteLengthUtf8('𝄞')).toBe(4) // 𝄞 is U+1D11E, which is 4 bytes in UTF-8
  })

  it('should handle mixed content correctly', () => {
    expect(byteLengthUtf8('hello 你好 𝄞')).toBe(17) // 5 + 1 + 6 + 1 + 4 bytes
  })

  it('should correctly handle emoji characters', () => {
    expect(byteLengthUtf8('😀')).toBe(4) // 😀 is U+1F600, which is 4 bytes in UTF-8
  })

  it('should handle complex strings with different languages and symbols', () => {
    const complexStr = 'The quick brown 🦊 jumps over 13 lazy 🐶! 你好世界'
    expect(byteLengthUtf8(complexStr)).toBe(58) // Mix of ASCII, emoji, and Chinese characters
  })
})
