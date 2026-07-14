import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'

const { module, privateMemory, globalMemory, scopedMemory } = workerData
const instance = await WebAssembly.instantiate(module, {
  env: { memory: privateMemory },
  pglite: { global_memory: globalMemory, scoped_memory: scopedMemory },
})
const tagGlobal = (address) => 0x80000000 | address | 0
const tagScoped = (address) => 0xc0000000 | address | 0
instance.exports.scalar_i32_store(tagGlobal(900), 42)
assert.equal(instance.exports.scalar_i32_load(tagGlobal(900)), 42)
instance.exports.scalar_i32_store(tagScoped(900), 84)
assert.equal(instance.exports.scalar_i32_load(tagScoped(900)), 84)
assert.equal(instance.exports.atomic_wait32(tagGlobal(716), 999, 0n), 1)
assert.equal(instance.exports.atomic_wait32(tagScoped(716), 999, 0n), 1)
parentPort.postMessage('ok')
