import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/fs/base.js', () => ({
  BaseFilesystem: class {
    protected dataDir?: string

    constructor(dataDir?: string) {
      this.dataDir = dataDir
    }
  },
  ERRNO_CODES: {},
}))

vi.mock('../src/pglite.js', () => ({ PGlite: class {} }))

import { OpfsAhpFS } from '../src/fs/opfs-ahp.js'
import { isOpfsAhpSupported } from '../src/fs/opfs-ahp-support.js'

describe('isOpfsAhpSupported', () => {
  it('rejects environments without the sync access handle API', () => {
    expect(isOpfsAhpSupported(undefined)).toBe(false)
    expect(isOpfsAhpSupported({ prototype: {} })).toBe(false)
  })

  it('accepts the API shape exposed in Dedicated Web Workers', () => {
    expect(
      isOpfsAhpSupported({
        prototype: { createSyncAccessHandle: () => undefined },
      }),
    ).toBe(true)
  })
})

describe('OpfsAhpFS', () => {
  it('explains that OPFS-AHP requires a Dedicated Web Worker', async () => {
    const fs = new OpfsAhpFS('test')

    await expect(fs.init(undefined as never, {})).rejects.toThrow(
      'OPFS-AHP is only supported in a Dedicated Web Worker because FileSystemFileHandle.createSyncAccessHandle() is not available in this context.',
    )
  })
})
