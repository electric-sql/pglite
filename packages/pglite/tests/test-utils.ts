import { describe, expect } from 'vitest'
import type { DataTransferContainer } from '../dist/index.js'

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
  fn: (
    importType: 'esm' | 'cjs',
    defaultDataTransferContainer: DataTransferContainer,
  ) => Promise<void>,
) {
  describe('esm import', async () => {
    describe('cma data transfer container', async () => {
      await fn('esm', 'cma')
    })
    describe('file data transfer container', async () => {
      await fn('esm', 'file')
    })
  })

  // don't run cjs tests for Bun
  if (typeof Bun !== 'undefined') return

  describe('cjs import', async () => {
    describe('cma data transfer container', async () => {
      await fn('cjs', 'cma')
    })
    describe('file data transfer container', async () => {
      await fn('cjs', 'file')
    })
  })
}

export async function testDTC(
  fn: (defaultDataTransferContainer: DataTransferContainer) => Promise<void>,
) {
  describe('cma data transfer container', async () => {
    await fn('cma')
  })
  describe('file data transfer container', async () => {
    await fn('file')
  })
}

export async function testSocket(
  fn: (socketOptions: {
    host?: string
    port?: number
    path?: string
  }) => Promise<void>,
) {
  describe('TCP socket server', async () => {
    await fn({ host: '127.0.0.1', port: 5433 })
  })
  describe('unix socket server', async () => {
    await fn({ path: '/tmp/.s.PGSQL.5432' })
  })
}
