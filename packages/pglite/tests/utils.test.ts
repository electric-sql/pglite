import { describe, it, expect } from 'vitest'
import { debounceMutex } from '../src/utils'

describe('debounceMutex', () => {
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms))

  it('should execute first and last calls, cancelling intermediate ones', async () => {
    const results: number[] = []
    const fn = async (n: number) => {
      await delay(10)
      results.push(n)
      return n
    }

    const debouncedFn = debounceMutex(fn)

    // Start multiple calls in quick succession
    const calls = [debouncedFn(1), debouncedFn(2), debouncedFn(3)]

    const returnValues = await Promise.all(calls)

    // Check execution order and return values
    expect(results).toEqual([1, 3])
    expect(returnValues).toEqual([1, undefined, 3])
  })

  it('should respect execution order regardless of delays', async () => {
    const results: number[] = []
    const fn = async (n: number, delayMs: number) => {
      await delay(delayMs)
      results.push(n)
      return n
    }

    const debouncedFn = debounceMutex(fn)

    const call1 = debouncedFn(1, 50) // Longer delay, but should complete first
    const call2 = debouncedFn(2, 10) // Should be replaced and return undefined
    const call3 = debouncedFn(3, 10) // Should complete second despite shorter delay

    const returnValues = await Promise.all([call1, call2, call3])

    expect(results).toEqual([1, 3])
    expect(returnValues).toEqual([1, undefined, 3])
  })

  it('should handle errors properly', async () => {
    const fn = async () => {
      throw new Error('Test error')
    }

    const debouncedFn = debounceMutex(fn)
    await expect(debouncedFn()).rejects.toThrow('Test error')
  })
})
