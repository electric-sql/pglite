#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [wasmPath, gluePath, dataPath] = process.argv.slice(2)
if (!dataPath) {
  throw new Error('usage: scope-hierarchy.mjs WASM GLUE DATA')
}

const module = await WebAssembly.compile(readFileSync(wasmPath))
const data = readFileSync(dataPath)
const privateMemory = sharedMemory(512)
const globalMemory = sharedMemory(512)
const scopedMemory = sharedMemory(512)
const { default: createPostgres } = await import(pathToFileURL(gluePath).href)

const postgres = await createPostgres({
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
    WebAssembly.instantiate(module, imports).then((instance) =>
      success(instance, module),
    )
    return {}
  },
})

const ensureCapacity = postgres.addFunction(() => 0, 'ii')
postgres._pgl_set_scoped_shmem_host(ensureCapacity)
postgres._pgl_set_scoped_shmem_mode(1)

const Kind = {
  root: 1,
  session: 2,
  transaction: 3,
  subtransaction: 4,
  query: 6,
  parallel: 7,
}
const State = { active: 1, closing: 2, dead: 3 }
const IPC_CREAT = 0o1000
const IPC_RMID = 0

const root = postgres._pgl_shm_scope_root()
assert.notEqual(root, 0n)
const session = createScope(Kind.session, root)
const previousSession = postgres._pgl_shm_scope_enter(session)
const transaction = createScope(Kind.transaction, session)
const previousTransaction = postgres._pgl_shm_scope_enter(transaction)
const subtransaction = createScope(Kind.subtransaction, transaction)
const query = createScope(Kind.query, subtransaction)
const parallel = createScope(Kind.parallel, query)

assert.equal(count(Kind.root, State.active), 1)
assert.equal(count(Kind.session, State.active), 1)
assert.equal(count(Kind.transaction, State.active), 1)
assert.equal(count(Kind.subtransaction, State.active), 1)
assert.equal(count(Kind.query, State.active), 1)
assert.equal(count(Kind.parallel, State.active), 1)

const previousParallel = postgres._pgl_shm_scope_enter(parallel)
const shmid = postgres._pgl_shmget(0, 70_000, IPC_CREAT)
assert.ok(shmid > 0)
const address = postgres._pgl_shmat(shmid, 0, 0) >>> 0
assert.equal((address & 0xc000_0000) >>> 0, 0xc000_0000)
assert.equal(postgres._pgl_shm_scope_handle_for_pointer(address), parallel)
assert.ok(postgres._pgl_shm_scope_bytes(Kind.parallel) >= 131_072n)
assert.equal(postgres._pgl_shm_scope_worker_attach(parallel), 0)
postgres._pgl_shm_scope_leave(previousParallel)

// Closing rejects new attachments but defers generation reuse until both the
// last extant segment attachment and active worker are gone.
assert.equal(postgres._pgl_shm_scope_close(parallel), 0)
assert.equal(count(Kind.parallel, State.closing), 1)
assert.equal(postgres._pgl_shmat(shmid, 0, 0), -1)
assert.equal(postgres._pgl_shmctl(shmid, IPC_RMID, 0), 0)
assert.equal(postgres._pgl_shmdt(address), 0)
assert.equal(count(Kind.parallel, State.closing), 1)
assert.equal(postgres._pgl_shm_scope_worker_detach(parallel), 0)
assert.equal(count(Kind.parallel, State.dead), 1)
assert.equal(postgres._pgl_shm_scope_bytes(Kind.parallel), 0n)

assert.equal(postgres._pgl_shm_scope_close(query), 0)
assert.equal(count(Kind.query, State.dead), 1)

// Subtransaction commit promotes surviving descendants and allocations to
// the parent transaction instead of invalidating them.
const promotedQuery = createScope(Kind.query, subtransaction)
assert.equal(postgres._pgl_shm_scope_promote(subtransaction), 0)
assert.equal(count(Kind.subtransaction, State.dead), 1)
assert.equal(postgres._pgl_shm_scope_close(promotedQuery), 0)

// A reused directory slot preserves its ID but changes generation; a stale
// handle cannot become current again.
const firstGeneration = createScope(Kind.query, transaction)
assert.equal(postgres._pgl_shm_scope_close(firstGeneration), 0)
const secondGeneration = createScope(Kind.query, transaction)
assert.equal(
  Number(firstGeneration & 0xffff_ffffn),
  Number(secondGeneration & 0xffff_ffffn),
)
assert.notEqual(firstGeneration >> 32n, secondGeneration >> 32n)
const beforeStaleEnter = postgres._pgl_shm_scope_current()
postgres._pgl_shm_scope_enter(firstGeneration)
assert.equal(postgres._pgl_shm_scope_current(), beforeStaleEnter)
assert.equal(postgres._pgl_shm_scope_close(secondGeneration), 0)

// Nested SQL execution can legitimately pass 256 QueryDesc instances before
// PostgreSQL's max_stack_depth check fires. Keep the fixed registry large
// enough that PGlite scope bookkeeping cannot replace the PostgreSQL error.
const deepQueries = []
let deepParent = transaction
for (let depth = 0; depth < 512; depth++) {
  const child = createScope(Kind.query, deepParent)
  deepQueries.push(child)
  deepParent = child
}
assert.equal(count(Kind.query, State.active), deepQueries.length)
for (const child of deepQueries.reverse()) {
  assert.equal(postgres._pgl_shm_scope_close(child), 0)
}
assert.equal(count(Kind.query, State.active), 0)

postgres._pgl_shm_scope_leave(previousTransaction)
assert.equal(postgres._pgl_shm_scope_close(transaction), 0)
postgres._pgl_shm_scope_leave(previousSession)
assert.equal(postgres._pgl_shm_scope_close(session), 0)
assert.equal(count(Kind.session, State.dead), 1)
assert.equal(count(Kind.transaction, State.dead), 1)
assert.equal(count(Kind.query, State.active), 0)
assert.equal(count(Kind.parallel, State.active), 0)

postgres.removeFunction(ensureCapacity)
postgres.FS.quit()
console.log('Hierarchical memory-scope artifact test: PASS')

function createScope(kind, parent) {
  const scope = postgres._pgl_shm_scope_create(kind, parent)
  assert.notEqual(scope, 0n)
  return scope
}

function count(kind, state) {
  return postgres._pgl_shm_scope_count(kind, state)
}

function sharedMemory(initial) {
  return new WebAssembly.Memory({ initial, maximum: 16_384, shared: true })
}
