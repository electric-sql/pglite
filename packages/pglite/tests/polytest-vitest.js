import { expect } from 'vitest'

async function expectToThrowAsync(fn, expected) {
  if (typeof Bun !== 'undefined') {
    const bunTest = await import('bun:test')
    try {
      await fn()
      throw new Error('function did not throw')
    } catch (err) {
      return bunTest.expect(err.message).toBe(expected)
    }
  }

  return expect(fn).rejects.toThrow(expected)
}

export { expectToThrowAsync }
