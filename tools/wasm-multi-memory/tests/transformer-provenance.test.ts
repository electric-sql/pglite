import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'vitest'
import { artifact } from './support/artifacts.js'

it('proves private, global, and scoped pointer provenance', async () => {
  const report = JSON.parse(
    await readFile(artifact('provenance.report.json'), 'utf8'),
  )
  const privateMemory = new WebAssembly.Memory({
    initial: 2,
    maximum: 16,
    shared: true,
  })
  const globalMemory = new WebAssembly.Memory({
    initial: 2,
    maximum: 16,
    shared: true,
  })
  const scopedMemory = new WebAssembly.Memory({
    initial: 2,
    maximum: 16,
    shared: true,
  })
  const stack = new WebAssembly.Global({ value: 'i32', mutable: true }, 112)
  const slot = new WebAssembly.Global({ value: 'i32', mutable: true }, 144)
  const { instance } = await WebAssembly.instantiate(
    await readFile(artifact('provenance.multi.wasm')),
    {
      env: { memory: privateMemory, __stack_pointer: stack },
      'GOT.mem': { private_slot: slot },
      pglite: { global_memory: globalMemory, scoped_memory: scopedMemory },
    },
  )
  const privateView = new DataView(privateMemory.buffer)
  const globalView = new DataView(globalMemory.buffer)
  const scopedView = new DataView(scopedMemory.buffer)

  for (const [address, value] of [
    [96, 1],
    [104, 2],
    [128, 3],
    [144, 4],
    [176, 6],
    [180, 7],
    [184, 9],
    [196, 11],
  ]) {
    privateView.setInt32(address, value, true)
  }
  globalView.setInt32(160, 5, true)
  globalView.setInt32(164, 8, true)
  scopedView.setInt32(160, 15, true)
  privateView.setUint32(192, 0x800000c0, true)
  globalView.setInt32(192, 12, true)

  assert.equal(instance.exports.constant(), 1)
  assert.equal(instance.exports.constant_global(), 5)
  assert.equal(instance.exports.constant_scoped(), 15)
  assert.equal(instance.exports.stack(), 2)
  assert.equal(instance.exports.allocator_and_internal(), 3)
  assert.equal(instance.exports.got(), 4)
  assert.equal(instance.exports.unknown(0x800000a0), 5)
  assert.equal(instance.exports.unknown(176), 6)
  assert.equal(instance.exports.marked(176), 6)
  assert.equal(instance.exports.marked_parameter(184), 9)
  assert.equal(instance.exports.conditional_marked(184, 1), 9)
  assert.equal(instance.exports.conditional_marked(0x800000a4, 0), 8)
  assert.equal(instance.exports.block_address_join(192, 0), 11)
  assert.equal(instance.exports.block_address_join(192, 1), 12)
  assert.equal(instance.exports.loop(176, 2), 13)
  assert.equal(instance.exports.loop(0x800000a0, 2), 13)
  assert.equal(instance.exports.unrooted_pointer_cycle(0x8000009c, 2), 8)
  assert.equal(report.abi.profile, 'three-domain-provenance')
  assert.equal(report.privateReturnExports[0], 'palloc')
  assert.equal(report.privateIdentityExports[0], 'pgl_private_pointer')
  assert.equal(report.removedPrivateIdentityCalls, 4)
  assert.equal(report.explicitPrivateParameters.length, 2)
  assert.ok(report.inferredPrivateParameters >= 1)
  assert.ok(report.directPrivate.load >= 4)
  assert.equal(report.directGlobal.load, 1)
  assert.equal(report.directScoped.load, 1)
  assert.ok(report.rewritten.load >= 1)
  assert.equal(
    report.directPrivateProofs['constant-local-flow'],
    report.directPrivate.load,
  )
})
