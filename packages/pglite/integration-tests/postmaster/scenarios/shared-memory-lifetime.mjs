#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [wasmPath, gluePath, dataPath] = process.argv.slice(2)
if (!dataPath) {
  throw new Error('usage: shared-memory-lifetime.mjs WASM GLUE DATA')
}

const compiled = await WebAssembly.compile(readFileSync(wasmPath))
const data = readFileSync(dataPath)
const globalMemory = sharedMemory()
const rootMemory = sharedMemory()
const { default: createPostgres } = await import(pathToFileURL(gluePath).href)
const root = await instantiate()
const child = await instantiate()
const IPC_CREAT = 0o1000
const IPC_RMID = 0
const size = 70_000

// Allocation defaults to cluster-global storage in each fresh process.
const globalId = root.module._pgl_shmget(0, size, IPC_CREAT)
const globalAddress = root.module._pgl_shmat(globalId, 0, 0) >>> 0
assert.equal(globalAddress >>> 30, 2)
assert.equal(child.module._pgl_shm_domain_current(), 0)
const previous = root.module._pgl_shm_domain_push(1)
const id = root.module._pgl_shmget(0, size, IPC_CREAT)
const address = root.module._pgl_shmat(id, 0, 0) >>> 0
root.module._pgl_shm_domain_pop(previous)
assert.equal(root.module._pgl_shm_domain_current(), 0)
assert.equal(address >>> 30, 3)

// An attached worker keeps a removed segment's bytes unavailable for reuse.
const childAddress = child.module._pgl_shmat(id, 0, 0) >>> 0
assert.equal(childAddress, address)
new Uint32Array(rootMemory.buffer)[(address & 0x3fff_ffff) >>> 2] = 0x51a7_c0de
assert.equal(root.module._pgl_shmctl(id, IPC_RMID, 0), 0)
assert.equal(root.module._pgl_shmdt(address), 0)
assert.equal(root.module._pgl_shmat(id, 0, 0), -1)
root.module._pgl_shm_domain_push(1)
const otherId = root.module._pgl_shmget(0, size, IPC_CREAT)
const otherAddress = root.module._pgl_shmat(otherId, 0, 0) >>> 0
assert.notEqual(otherAddress, address)
assert.equal(
  new Uint32Array(rootMemory.buffer)[(childAddress & 0x3fff_ffff) >>> 2],
  0x51a7_c0de,
)

// The final detach makes those bytes reusable without query/transaction scopes.
assert.equal(child.module._pgl_shmdt(childAddress), 0)
const reusedId = root.module._pgl_shmget(0, size, IPC_CREAT)
const reusedAddress = root.module._pgl_shmat(reusedId, 0, 0) >>> 0
assert.notEqual(reusedId, id)
assert.equal(reusedAddress, address)
assert.equal(root.module._pgl_shmat(id, 0, 0), -1)
for (const [segmentId, segmentAddress] of [
  [otherId, otherAddress],
  [reusedId, reusedAddress],
  [globalId, globalAddress],
]) {
  assert.equal(root.module._pgl_shmctl(segmentId, IPC_RMID, 0), 0)
  assert.equal(root.module._pgl_shmdt(segmentAddress), 0)
}
root.module._pgl_shm_domain_pop(previous)
root.dispose()
child.dispose()
console.log('Shared segment lifetime artifact test: PASS')

async function instantiate() {
  const callbacks = []
  const module = await createPostgres({
    noInitialRun: true,
    noExitRuntime: true,
    wasmMemory: sharedMemory(),
    getPreloadedPackage: () =>
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    instantiateWasm(imports, success) {
      imports.pglite = {
        ...(imports.pglite ?? {}),
        global_memory: globalMemory,
        scoped_memory: rootMemory,
      }
      WebAssembly.instantiate(compiled, imports).then((instance) =>
        success(instance, compiled),
      )
      return {}
    },
  })
  const ensureCapacity = module.addFunction(() => 0, 'ii')
  callbacks.push(ensureCapacity)
  module._pgl_set_shmem_host(ensureCapacity)
  module._pgl_set_scoped_shmem_host(ensureCapacity)
  module._pgl_set_scoped_shmem_mode(1)
  return {
    module,
    dispose() {
      callbacks.forEach((callback) => module.removeFunction(callback))
    },
  }
}

function sharedMemory() {
  return new WebAssembly.Memory({ initial: 512, maximum: 512, shared: true })
}
