import { describe, expect } from 'vitest'

declare global {
  let Bun: any
}

export async function expectToThrowAsync(
  fn: () => Promise<void>,
  expected?: string,
) {
  if (typeof Bun !== 'undefined') {
    // @ts-ignore because
    const bunTest = await import('bun:test')
    try {
      await fn()
      throw new Error('function did not throw')
    } catch (err) {
      if (expected) {
        return bunTest.expect(err.message).toBe(expected)
      } else {
        return bunTest.expect(err).toBeDefined()
      }
    }
  }

  return expect(fn).rejects.toThrow(expected)
}

export async function testEsmCjsAndDTC(
  fn: (importType: 'esm' | 'cjs') => Promise<void>,
) {
  describe('esm import', async () => {
    await fn('esm')
  })

  // don't run cjs tests for Bun
  if (typeof Bun !== 'undefined') return

  describe('cjs import', async () => {
    await fn('cjs')
  })
}
