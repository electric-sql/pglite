import { describe, expect, it } from 'vitest'
import { PgliteMemoryViews } from '../src/wasm/multi-memory.js'

const memory = (shared = false) =>
  new WebAssembly.Memory({ initial: 1, maximum: 4, shared })

describe('multi-memory views', () => {
  it('decodes private, global, and opt-in scoped pointers as unsigned i32', () => {
    const privateMemory = memory()
    const globalMemory = memory(true)
    const scopedMemory = memory(true)
    const views = new PgliteMemoryViews({
      private: privateMemory,
      global: globalMemory,
      scoped: scopedMemory,
    })

    expect(views.decodePointer(24, 8)).toMatchObject({
      memory: 0,
      offset: 24,
    })
    expect(views.decodePointer(0x80000018 | 0, 8)).toMatchObject({
      memory: 1,
      offset: 24,
    })
    expect(() => views.decodePointer(0xc0000018 | 0, 8)).toThrow(/reserved/)
    expect(
      views.decodePointer(0xc0000018 | 0, 8, { allowScoped: true }),
    ).toMatchObject({ memory: 2, offset: 24 })
  })

  it('rejects null, aperture crossings, and memory overruns', () => {
    const views = new PgliteMemoryViews({
      private: memory(),
      global: memory(true),
    })

    expect(() => views.decodePointer(0, 1)).toThrow(/null/)
    expect(views.decodePointer(0, 0, { nullable: true })).toBeNull()
    expect(() => views.decodePointer(0x40000000, 1)).toThrow(
      /bound Wasm memory/,
    )
    expect(() => views.decodePointer(0xbfffffff | 0, 2)).toThrow(/aperture/)
    expect(() => views.decodePointer(65535, 2)).toThrow(/bound Wasm memory/)
  })

  it('refreshes every view family after private and shared memory growth', () => {
    const privateMemory = memory()
    const globalMemory = memory(true)
    const views = new PgliteMemoryViews({
      private: privateMemory,
      global: globalMemory,
    })
    const privateBefore = views.private
    const globalBefore = views.global

    privateMemory.grow(1)
    globalMemory.grow(1)

    expect(views.private.u8 === privateBefore.u8).toBe(false)
    expect(views.global.u8 === globalBefore.u8).toBe(false)
    expect(views.private.u8.byteLength).toBe(2 * 65536)
    expect(views.global.u8.byteLength).toBe(2 * 65536)
  })
})
