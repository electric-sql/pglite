import { describe, expect, it } from 'vitest'
import { linkMemory } from '../src/wasm/linked-memory.js'
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

it('copies between cached heap views across shared and unshared growth', async () => {
  const local = memory()
  const shared = memory(true)
  const empty = await WebAssembly.compile(
    Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0),
  )
  const { pgl_bulk: bulk } = await linkMemory(
    local,
    shared,
    shared,
    async () => empty,
  )
  const limit = shared.buffer.byteLength
  new Uint8Array(local.buffer).set([7, 8, 9], 1)
  bulk.copy10(1, 1, 3)
  local.grow(1)
  shared.grow(1)
  bulk.copy01(limit, 1, 3)
  bulk.copy10(limit, limit, 3)
  expect([...new Uint8Array(shared.buffer, limit, 3)]).toEqual([7, 8, 9])
  new Uint8Array(shared.buffer).set([1, 2, 3], limit - 3)
  bulk.copy21(limit - 2, limit - 3, 3)
  expect([...new Uint8Array(shared.buffer, limit - 3, 4)]).toEqual([1, 1, 2, 3])

  const end = shared.buffer.byteLength
  bulk.copy01(end, end, 0)
  expect(() => bulk.copy01(end, end + 1, 0)).toThrow(WebAssembly.RuntimeError)
  expect(() => bulk.copy01(limit, end - 1, 2)).toThrow(WebAssembly.RuntimeError)
  expect([...new Uint8Array(local.buffer, limit, 3)]).toEqual([7, 8, 9])
})
