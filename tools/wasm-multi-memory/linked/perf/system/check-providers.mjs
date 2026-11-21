import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [original, candidate] = process.argv.slice(2)
let checked = 0
for (const shared of [false, true]) {
  const filename = 'linked-' + (shared ? 'shared' : 'unshared') + '.wasm'
  const instances = [original, candidate].map((root) => {
    const mem = new WebAssembly.Memory({ initial: 1, maximum: 2, shared })
    const ops = new WebAssembly.Instance(
      new WebAssembly.Module(readFileSync(join(root, filename))),
      { env: { memory: mem } },
    ).exports
    return { mem, ops }
  })
  const [before, after] = instances
  const entries = Object.keys(after.ops).filter((op) => op.includes('_at_'))
  assert.ok(entries.length > 0)
  const outcome = (fn) => {
    try {
      return { value: fn() }
    } catch (e) {
      assert.ok(e instanceof WebAssembly.RuntimeError)
      return { trap: true }
    }
  }
  for (const pages of [1, 2]) {
    for (const { mem } of instances) {
      if (pages === 2) mem.grow(1)
      const bytes = new Uint8Array(mem.buffer)
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 117 + 15) & 255
    }
    for (const op of entries) {
      const [scalar, suffix] = op.split('_at_'),
        offset = Number(suffix)
      const value = scalar.includes('_i64_')
        ? 0xfedcba9876543210n
        : scalar.startsWith('store_f')
          ? -14.125
          : 0xabcdef12
      for (const ptr of [
        0,
        1,
        13,
        65530,
        pages * 65536 - offset - 4,
        pages * 65536 - 1,
        0xfffffff1,
        0xffffffff,
      ]) {
        const args = scalar.startsWith('store') ? [ptr, value] : [ptr]
        assert.deepEqual(
          outcome(() => after.ops[op](...args)),
          outcome(() => before.ops[scalar](...args, offset)),
          op + ' ' + ptr,
        )
      }
      checked++
    }
    assert.deepEqual(
      new Uint8Array(before.mem.buffer),
      new Uint8Array(after.mem.buffer),
    )
  }
  const mem = new DataView(after.mem.buffer)
  mem.setUint32(1, 0x7f812345, true)
  mem.setUint32(7, 0xffc0f123, true)
  for (const [a, b] of [
    [1, 7],
    [7, 1],
    [1, 1],
  ]) {
    const expected =
      BigInt(mem.getUint32(a, true)) | (BigInt(mem.getUint32(b, true)) << 32n)
    assert.equal(
      BigInt.asUintN(64, after.ops.load_f32_pair_ordered(a, b)),
      expected,
    )
  }
  for (const args of [
    [1, 0xffffffff],
    [0xffffffff, 1],
  ])
    assert.throws(
      () => after.ops.load_f32_pair_ordered(...args),
      WebAssembly.RuntimeError,
    )
}
console.log(
  'Provider parity on Node ' +
    process.version +
    ' across ' +
    checked +
    ' operation, memory-type and growth combinations.',
)
