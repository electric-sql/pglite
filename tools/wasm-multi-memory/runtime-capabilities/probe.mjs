#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'

const bytes = await readFile(process.argv[2])
if (process.argv.includes('--expect-reject')) {
  assert.equal(
    WebAssembly.validate(bytes),
    false,
    `${process.version} unexpectedly accepted the multi-memory artifact`,
  )
  console.log(`${process.version} rejection: ok`)
  process.exit(0)
}

assert.ok(Number(process.versions.node.split('.')[0]) >= 22)
assert.equal(WebAssembly.validate(bytes), true)
const memory = (maximum) =>
  new WebAssembly.Memory({ initial: 1, maximum, shared: true })
const globalMemory = memory(16384)
const privateA = memory(32768)
const privateB = memory(32768)
const scopedA = memory(16384)
const scopedB = memory(16384)
const module = new WebAssembly.Module(bytes)
const imports = (privateMemory, scopedMemory) => ({
  cap: {
    private_memory: privateMemory,
    global_memory: globalMemory,
    scoped_memory: scopedMemory,
  },
})
const a = new WebAssembly.Instance(module, imports(privateA, scopedA))
const b = new WebAssembly.Instance(module, imports(privateB, scopedB))

a.exports.store_private(64, 111)
b.exports.store_private(64, 222)
assert.equal(a.exports.load_private(64), 111)
assert.equal(b.exports.load_private(64), 222)
a.exports.store_global(128, 42)
assert.equal(b.exports.load_global(128), 42)
assert.equal(a.exports.atomic_add_global(128, 8), 42)
assert.equal(b.exports.load_global(128), 50)
a.exports.copy_global_to_private(256, 128, 4)
assert.equal(a.exports.load_private(256), 50)

const aliased = memory(16384)
const compact = new WebAssembly.Instance(module, imports(aliased, aliased))
compact.exports.store_private(512, 0x11223344)
assert.equal(compact.exports.load_scoped(512), 0x11223344)
compact.exports.copy_private_to_scoped(514, 512, 4)

const before = a.exports.size_private()
privateA.grow(1)
assert.equal(a.exports.size_private(), before + 1)

await new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
    workerData: {
      module,
      privateMemory: privateB,
      globalMemory,
      scopedMemory: scopedB,
    },
  })
  worker.once('message', (result) =>
    result.ok ? resolve() : reject(new Error(result.error)),
  )
  worker.once('error', reject)
  worker.once(
    'exit',
    (code) => code && reject(new Error(`capability worker exited ${code}`)),
  )
})
assert.equal(a.exports.load_global(128), 51)

console.log(`${process.version} multi-memory and Worker transfer: ok`)
