#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [wasmPath, gluePath, dataPath] = process.argv.slice(2)
if (!dataPath) {
  throw new Error('usage: compact-binding.mjs WASM GLUE DATA')
}

const compiled = await WebAssembly.compile(readFileSync(wasmPath))
const data = readFileSync(dataPath)
const { default: createPostgres } = await import(pathToFileURL(gluePath).href)
const rootPrivate = sharedMemory(512)
const childPrivate = sharedMemory(512)
const globalMemory = sharedMemory(512)
const root = await instantiate(rootPrivate, rootPrivate, 2)
const rootScope = root.module._pgl_shm_scope_root()
const registryOffset = root.module._pgl_shm_registry_offset() >>> 0

assert.notEqual(rootScope, 0n)
assert.ok(registryOffset > 0x20_000)
assert.notEqual(registryOffset, 0x1_0000)
const frontierAfterRegistry = root.module._pgl_shm_compact_frontier() >>> 0
assert.ok(frontierAfterRegistry > registryOffset)

const session = root.module._pgl_shm_scope_create(2, rootScope)
const previousSession = root.module._pgl_shm_scope_enter(session)
const query = root.module._pgl_shm_scope_create(6, session)
const previousQuery = root.module._pgl_shm_scope_enter(query)
const shmid = root.module._pgl_shmget(0, 6 * 1024 * 1024, 0o1000)
assert.ok(shmid > 0)
const address = root.module._pgl_shmat(shmid, 0, 0) >>> 0
const segmentOffset = address & 0x3fff_ffff
assert.equal((address & 0xc000_0000) >>> 0, 0xc000_0000)
assert.ok(segmentOffset >= frontierAfterRegistry)
const frontierAfterScoped = root.module._pgl_shm_compact_frontier() >>> 0
assert.ok(frontierAfterScoped >= segmentOffset + 6 * 1024 * 1024)

// Emscripten malloc and compact DSM share sbrk_val. A large private allocation
// may use old free heap or acquire a new disjoint root after the compact block,
// but it must never cross the range already reserved for memory 2.
const privateAllocationSize = 24 * 1024 * 1024
const privateAllocation = root.module._malloc(privateAllocationSize) >>> 0
assert.ok(privateAllocation > 0)
assert.ok(
  privateAllocation + privateAllocationSize <= segmentOffset ||
    privateAllocation >= frontierAfterScoped,
  'private malloc overlapped the compact scoped-memory reservation',
)
root.module._free(privateAllocation)

// A parallel-style child has its own memory 0 but reaches the leader's exact
// compact registry, sbrk frontier, and segment through inherited memory 2.
const child = await instantiate(childPrivate, rootPrivate, 2)
assert.equal(child.module._pgl_shm_scope_root(), rootScope)
assert.equal(child.module._pgl_shm_registry_offset() >>> 0, registryOffset)
const childPreviousQuery = child.module._pgl_shm_scope_enter(query)
const childAddress = child.module._pgl_shmat(shmid, 0, 0) >>> 0
assert.equal(childAddress, address)
new Uint32Array(rootPrivate.buffer)[segmentOffset >>> 2] = 0x51a7_c0de
assert.equal(
  new Uint32Array(rootPrivate.buffer)[(childAddress & 0x3fff_ffff) >>> 2],
  0x51a7_c0de,
)
const childShmid = child.module._pgl_shmget(0, 2 * 1024 * 1024, 0o1000)
assert.ok(childShmid > 0)
assert.ok(root.module._pgl_shm_compact_frontier() >>> 0 > frontierAfterScoped)

assert.equal(child.module._pgl_shmctl(childShmid, 0, 0), 0)
child.module._pgl_shm_scope_leave(childPreviousQuery)
assert.equal(child.module._pgl_shmdt(childAddress), 0)
assert.equal(root.module._pgl_shmctl(shmid, 0, 0), 0)
assert.equal(root.module._pgl_shmdt(address), 0)
root.module._pgl_shm_scope_leave(previousQuery)
assert.equal(root.module._pgl_shm_scope_close(query), 0)
root.module._pgl_shm_scope_leave(previousSession)
assert.equal(root.module._pgl_shm_scope_close(session), 0)

// Repeat the same 8 MiB scoped plus 24 MiB private demand with a dedicated
// memory 2. This is deliberately a value measurement, not a requirement that
// compact wins: a shared sbrk frontier can trade away allocator placement and
// fault isolation even though it removes a backing store at idle.
const dedicatedPrivate = sharedMemory(512)
const dedicatedScoped = sharedMemory(2)
const dedicated = await instantiate(dedicatedPrivate, dedicatedScoped, 1)
const dedicatedRootScope = dedicated.module._pgl_shm_scope_root()
const dedicatedSession = dedicated.module._pgl_shm_scope_create(
  2,
  dedicatedRootScope,
)
const dedicatedPreviousSession =
  dedicated.module._pgl_shm_scope_enter(dedicatedSession)
const dedicatedQuery = dedicated.module._pgl_shm_scope_create(
  6,
  dedicatedSession,
)
const dedicatedPreviousQuery =
  dedicated.module._pgl_shm_scope_enter(dedicatedQuery)
const dedicatedShmidA = dedicated.module._pgl_shmget(0, 6 * 1024 * 1024, 0o1000)
const dedicatedShmidB = dedicated.module._pgl_shmget(0, 2 * 1024 * 1024, 0o1000)
assert.ok(dedicatedShmidA > 0)
assert.ok(dedicatedShmidB > 0)
const dedicatedPrivateAllocation =
  dedicated.module._malloc(privateAllocationSize) >>> 0
assert.ok(dedicatedPrivateAllocation > 0)
dedicated.module._free(dedicatedPrivateAllocation)
assert.equal(dedicated.module._pgl_shmctl(dedicatedShmidB, 0, 0), 0)
assert.equal(dedicated.module._pgl_shmctl(dedicatedShmidA, 0, 0), 0)
dedicated.module._pgl_shm_scope_leave(dedicatedPreviousQuery)
assert.equal(dedicated.module._pgl_shm_scope_close(dedicatedQuery), 0)
dedicated.module._pgl_shm_scope_leave(dedicatedPreviousSession)
assert.equal(dedicated.module._pgl_shm_scope_close(dedicatedSession), 0)

root.dispose()
child.dispose()
dedicated.dispose()
console.log('Compact memory binding artifact test: PASS')

async function instantiate(privateMemory, scopedMemory, scopedMemoryMode) {
  const callbacks = []
  const module = await createPostgres({
    noInitialRun: true,
    noExitRuntime: true,
    wasmMemory: privateMemory,
    getPreloadedPackage: () =>
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    instantiateWasm(imports, success) {
      imports.pglite = {
        ...(imports.pglite ?? {}),
        global_memory: globalMemory,
        scoped_memory: scopedMemory,
      }
      WebAssembly.instantiate(compiled, imports).then((instance) =>
        success(instance, compiled),
      )
      return {}
    },
  })
  const ensureGlobal = module.addFunction(
    (requiredBytes) => ensureMemory(globalMemory, requiredBytes),
    'ii',
  )
  const ensureScoped = module.addFunction(
    (requiredBytes) => ensureMemory(scopedMemory, requiredBytes),
    'ii',
  )
  callbacks.push(ensureGlobal, ensureScoped)
  module._pgl_set_shmem_host(ensureGlobal)
  module._pgl_set_scoped_shmem_host(ensureScoped)
  module._pgl_set_scoped_shmem_mode(scopedMemoryMode)
  return {
    module,
    dispose() {
      for (const callback of callbacks) module.removeFunction(callback)
      module.FS.quit()
    },
  }
}

function ensureMemory(memory, requiredBytes) {
  if (requiredBytes > 0x4000_0000) return -1
  const missing = requiredBytes - memory.buffer.byteLength
  if (missing <= 0) return 0
  try {
    memory.grow(Math.ceil(missing / 65_536))
    return 0
  } catch {
    return -1
  }
}

function sharedMemory(initial) {
  return new WebAssembly.Memory({ initial, maximum: 16_384, shared: true })
}
