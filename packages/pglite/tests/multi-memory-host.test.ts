import { describe, expect, it } from 'vitest'
import {
  PgliteMemoryViews,
  auditHostImportManifest,
  getTaggedValue,
  hardenHostImports,
  privateOnlyHostImport,
  privatePointer,
  setTaggedValue,
  stringToTaggedUTF8,
  taggedHostImport,
  taggedUTF8ToString,
} from '../src/wasm/multi-memory.js'

const memory = (shared = false) =>
  new WebAssembly.Memory({ initial: 1, maximum: 4, shared })

describe('multi-memory host ABI', () => {
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

  it('reads and writes tagged values and UTF-8 in each active domain', () => {
    const views = new PgliteMemoryViews({
      private: memory(),
      global: memory(true),
    })
    setTaggedValue(views, 16, -123, 'i32')
    setTaggedValue(views, 0x80000020 | 0, 0xdecafbad, 'u32')
    expect(getTaggedValue(views, 16, 'i32')).toBe(-123)
    expect(getTaggedValue(views, 0x80000020 | 0, 'u32')).toBe(0xdecafbad)
    expect(stringToTaggedUTF8(views, 'global ✓', 0x80000040 | 0, 32)).toBe(10)
    expect(taggedUTF8ToString(views, 0x80000040 | 0)).toBe('global ✓')
  })

  it('brands only pointers safe for legacy Emscripten memory-0 helpers', () => {
    expect(privatePointer(12)).toBe(12)
    expect(privatePointer(0, true)).toBe(0)
    expect(() => privatePointer(0x8000000c | 0)).toThrow(/tagged pointer/)
  })

  it('decodes tagged host-import ranges and guards legacy memory-0 imports', () => {
    const views = new PgliteMemoryViews({
      private: memory(),
      global: memory(true),
    })
    const write = taggedHostImport(
      views,
      [{ index: 0, length: (args) => Number(args[1]) }],
      ([destination, length]) => {
        if (!destination || typeof destination === 'number') {
          throw new Error('pointer was not decoded')
        }
        destination.views.u8.fill(
          7,
          destination.offset,
          destination.offset + Number(length),
        )
        return Number(length)
      },
    )
    expect(write(0x80000020 | 0, 4)).toBe(4)
    expect([...views.global.u8.subarray(32, 36)]).toEqual([7, 7, 7, 7])

    const legacy = privateOnlyHostImport([{ index: 0 }], (pointer) => pointer)
    expect(legacy(16)).toBe(16)
    expect(() => legacy(0x80000010 | 0)).toThrow(/tagged pointer/)
  })

  it('fails closed for unknown, extra, and unclassified imports', async () => {
    const module = await WebAssembly.compile(
      Uint8Array.from([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
        0x01, 0x7f, 0x00, 0x02, 0x0c, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x04, 0x68,
        0x6f, 0x73, 0x74, 0x00, 0x00,
      ]),
    )
    expect(() => auditHostImportManifest(module, [])).toThrow(/unclassified/)
    expect(() =>
      auditHostImportManifest(module, [
        { module: 'env', name: 'host', kind: 'function' },
      ]),
    ).toThrow(/no ABI class/)
    expect(() =>
      auditHostImportManifest(module, [
        {
          module: 'env',
          name: 'host',
          kind: 'function',
          class: 'private-only',
          signature: 'vp',
        },
      ]),
    ).toThrow(/no pointer manifest/)
    expect(() =>
      auditHostImportManifest(module, [
        {
          module: 'env',
          name: 'host',
          kind: 'function',
          class: 'scalar',
        },
        { module: 'env', name: 'extra', kind: 'global' },
      ]),
    ).toThrow(/not imported/)

    const views = new PgliteMemoryViews({
      private: memory(),
      global: memory(true),
    })
    const tagged = taggedHostImport(views, [{ index: 0, length: 1 }], () => {})
    const taggedManifest = [
      {
        module: 'env',
        name: 'host',
        kind: 'function' as const,
        class: 'tagged' as const,
        pointers: [
          {
            index: 0,
            nullable: false,
            length: '1 byte',
            direction: 'in' as const,
          },
        ],
      },
    ]
    expect(() =>
      hardenHostImports(
        module,
        { env: { host: () => {} } },
        taggedManifest,
        {},
      ),
    ).toThrow(/no memory-aware implementation/)
    const hardened = hardenHostImports(
      module,
      { env: { host: () => {} } },
      taggedManifest,
      { 'env.host': tagged },
    )
    expect(() =>
      (hardened.env.host as (value: number) => void)(0x80000010 | 0),
    ).not.toThrow()

    const privateManifest = [
      {
        ...taggedManifest[0],
        class: 'private-only' as const,
      },
    ]
    const privateHardened = hardenHostImports(
      module,
      { env: { host: (value: number) => value } },
      privateManifest,
      {},
    )
    expect(() =>
      (privateHardened.env.host as (value: number) => number)(0x80000010 | 0),
    ).toThrow(/tagged pointer/)
  })
})
