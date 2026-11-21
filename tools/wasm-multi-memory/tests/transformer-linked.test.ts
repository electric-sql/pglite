import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'
import { artifact } from './support/artifacts.js'

const sdk = process.env.PGLITE_LINKED_SDK

test.skipIf(!sdk)(
  'runs the SDK opcode fixture with private, shared and aliased heaps',
  async () => {
    await promisify(execFile)('pglite-linked-transform', [
      artifact('opcodes.wasm'),
      artifact('opcodes.linked.wasm'),
      artifact('linked-report.json'),
    ])
    const providers = await Promise.all(
      ['unshared', 'shared'].map(async (kind) =>
        WebAssembly.compile(await readFile(join(sdk!, `linked-${kind}.wasm`))),
      ),
    )
    const { linkMemory } = await import(
      '../../../packages/pglite/src/wasm/linked-memory.js'
    )
    const client = await WebAssembly.compile(
      await readFile(artifact('opcodes.linked.wasm')),
    )
    const makeHeap = (shared: boolean) =>
      new WebAssembly.Memory({ initial: 2, maximum: 16, shared })

    for (const separate of [false, true]) {
      const local = makeHeap(false)
      const global = separate ? makeHeap(true) : local
      const scoped = separate ? makeHeap(true) : local
      const heaps = [local, global, scoped]
      const imports = await linkMemory(
        local,
        global,
        scoped,
        async (shared) => providers[Number(shared)],
      )
      const ordered = imports.pgl_global.load_f32x8_ordered_v1 as (
        address: number,
      ) => bigint[]
      const words = [
        0xff800001, 0x80000000, 0x7f800001, 0, 1, 0xffffffff, 0x7fc10001, 17,
      ]
      for (const base of [9, global.buffer.byteLength - 32]) {
        const view = new DataView(global.buffer)
        words.forEach((word, i) => view.setUint32(base + 4 * i, word, true))
        const expected = [0, 2, 4, 6].map(
          (i) => BigInt(words[i + 1]) | (BigInt(words[i]) << 32n),
        )
        assert.deepEqual(
          ordered(base).map((bits) => BigInt.asUintN(64, bits)),
          expected,
        )
      }
      assert.throws(
        () => ordered(global.buffer.byteLength - 31),
        WebAssembly.RuntimeError,
      )
      assert.throws(() => ordered(0xfffffffc), WebAssembly.RuntimeError)
      new Uint8Array(global.buffer).fill(0, global.buffer.byteLength - 32)
      const ops = (
        await WebAssembly.instantiate(client, {
          env: { memory: local },
          ...imports,
        })
      ).exports as Record<string, (...args: number[]) => number>
      const tags = [0, 0x80000000, 0xc0000000]
      for (const [domain, heap] of heaps.entries()) {
        const ptr = tags[domain] | 32
        ops.scalar_i32_store(ptr, 0x10203040 + domain)
        assert.equal(
          new DataView(heap.buffer).getUint32(39, true),
          0x10203040 + domain,
        )
        assert.equal(ops.scalar_i32_load(ptr), 0x10203040 + domain)
        assert.throws(
          () =>
            ops.scalar_i32_load(tags[domain] | (heap.buffer.byteLength - 8)),
          WebAssembly.RuntimeError,
        )
      }

      for (const [dst, destination] of heaps.entries()) {
        for (const [src, source] of heaps.entries()) {
          new Uint8Array(source.buffer).set([1, 2, 3, 4, 5, 6], 128)
          ops.bulk_copy(tags[dst] | 130, tags[src] | 128, 6)
          assert.deepEqual(
            [...new Uint8Array(destination.buffer, 130, 6)],
            [1, 2, 3, 4, 5, 6],
          )
          const end = source.buffer.byteLength
          assert.throws(
            () => ops.bulk_copy(tags[dst] | 130, tags[src] | (end - 2), 6),
            WebAssembly.RuntimeError,
          )
          assert.deepEqual(
            [...new Uint8Array(destination.buffer, 130, 6)],
            [1, 2, 3, 4, 5, 6],
          )
          ops.bulk_copy(
            tags[dst] | destination.buffer.byteLength,
            tags[src] | end,
            0,
          )
          assert.throws(
            () =>
              ops.bulk_copy(
                tags[dst] | (destination.buffer.byteLength - 2),
                tags[src] | 128,
                6,
              ),
            WebAssembly.RuntimeError,
          )
          assert.deepEqual(
            [...new Uint8Array(destination.buffer).slice(-2)],
            [0, 0],
          )
        }
      }
      global.grow(1)
      ops.bulk_copy(tags[1] | 0x20000, 128, 2)
      assert.deepEqual([...new Uint8Array(global.buffer, 0x20000, 2)], [1, 2])
      assert.equal(ops.atomic_i32_atomic_rmw_add(tags[1] | 252, 3), 0)
      assert.equal(ops.atomic_i32_atomic_load(tags[1] | 252), 3)
      assert.throws(
        () => ops.atomic_i32_atomic_load(tags[1] | 253),
        WebAssembly.RuntimeError,
      )
    }
  },
)
