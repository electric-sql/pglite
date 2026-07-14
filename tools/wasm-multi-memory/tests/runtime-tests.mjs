#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'

const [originalPath, transformedPath, reportPath] = process.argv.slice(2)
const originalBytes = await readFile(originalPath)
const transformedBytes = await readFile(transformedPath)
const report = JSON.parse(await readFile(reportPath, 'utf8'))

const makeMemory = () =>
  new WebAssembly.Memory({ initial: 2, maximum: 16, shared: true })
const instantiateOriginal = async (memory) =>
  WebAssembly.instantiate(originalBytes, { env: { memory } })
const instantiateTransformed = async (
  privateMemory,
  globalMemory = makeMemory(),
  scopedMemory = privateMemory,
) =>
  WebAssembly.instantiate(transformedBytes, {
    env: { memory: privateMemory },
    pglite: { global_memory: globalMemory, scoped_memory: scopedMemory },
  })
const tagGlobal = (address) => 0x80000000 | address | 0
const tagScoped = (address) => 0xc0000000 | address | 0

assert.equal(report.abi.pointerABI, 'pglite-tagged-i32-v1')
assert.ok(
  ['three-domain-generic', 'three-domain-generic-private-fast-path'].includes(
    report.abi.profile,
  ),
)
for (const key of [
  'load',
  'store',
  'atomic-load',
  'atomic-store',
  'atomic-rmw',
  'atomic-cmpxchg',
  'atomic-wait',
  'atomic-notify',
  'simd-load',
  'simd-lane-load',
  'simd-lane-store',
  'memory-copy',
  'memory-fill',
]) {
  assert.ok(
    report.rewritten[key] > 0,
    `missing rewritten inventory entry ${key}`,
  )
}
for (const key of [
  'memory-init-private',
  'memory-size-private',
  'memory-grow-private',
  'atomic-fence',
]) {
  assert.ok(
    report.allowlisted[key] > 0,
    `missing allowlisted inventory entry ${key}`,
  )
}

const privateMemory = makeMemory()
const globalMemory = makeMemory()
const scopedMemory = makeMemory()
const originalMemory = makeMemory()
const original = (await instantiateOriginal(originalMemory)).instance.exports
const transformed = (
  await instantiateTransformed(privateMemory, globalMemory, scopedMemory)
).instance.exports
const originalView = new DataView(originalMemory.buffer)
const privateView = new DataView(privateMemory.buffer)
const globalView = new DataView(globalMemory.buffer)
const scopedView = new DataView(scopedMemory.buffer)
const exportedNames = Object.keys(transformed)
const bytesAt = (memory, address, size = 24) => [
  ...new Uint8Array(memory.buffer, address, size),
]
const seed = (memory, address, salt) => {
  const bytes = new Uint8Array(memory.buffer, address, 24)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (salt + i * 17) & 0xff
}
const valueFor = (name, value) =>
  name.includes('_i64_') || name.startsWith('scalar_i64_')
    ? BigInt(value)
    : name.startsWith('scalar_f')
      ? value + 0.25
      : value

// Differentially execute every scalar load and store shape in both domains.
for (const name of exportedNames.filter(
  (name) => name.startsWith('scalar_') && name.includes('_load'),
)) {
  seed(originalMemory, 1000, 3)
  seed(privateMemory, 1000, 3)
  seed(globalMemory, 1000, 91)
  seed(scopedMemory, 1000, 177)
  const privateExpected = original[name](1000)
  seed(originalMemory, 1000, 91)
  const globalExpected = original[name](1000)
  seed(originalMemory, 1000, 177)
  const scopedExpected = original[name](1000)
  assert.equal(
    transformed[name](1000),
    privateExpected,
    `${name} private result`,
  )
  assert.equal(
    transformed[name](tagGlobal(1000)),
    globalExpected,
    `${name} global result`,
  )
  assert.equal(
    transformed[name](tagScoped(1000)),
    scopedExpected,
    `${name} scoped result`,
  )
}
for (const name of exportedNames.filter(
  (name) => name.startsWith('scalar_') && name.includes('_store'),
)) {
  const value = valueFor(name, 0x1234)
  for (const memory of [
    originalMemory,
    privateMemory,
    globalMemory,
    scopedMemory,
  ]) {
    new Uint8Array(memory.buffer, 1000, 24).fill(0)
  }
  original[name](1000, value)
  transformed[name](1000, value)
  assert.deepEqual(
    bytesAt(privateMemory, 1000),
    bytesAt(originalMemory, 1000),
    `${name} private bytes`,
  )
  transformed[name](tagGlobal(1000), value)
  assert.deepEqual(
    bytesAt(globalMemory, 1000),
    bytesAt(originalMemory, 1000),
    `${name} global bytes`,
  )
  transformed[name](tagScoped(1000), value)
  assert.deepEqual(
    bytesAt(scopedMemory, 1000),
    bytesAt(originalMemory, 1000),
    `${name} scoped bytes`,
  )
}

// Differentially execute all atomic load/store/RMW/cmpxchg widths and ops.
for (const name of exportedNames.filter((name) =>
  /^atomic_i(32|64)_atomic_load/.test(name),
)) {
  seed(originalMemory, 1120, 5)
  seed(privateMemory, 1120, 5)
  seed(globalMemory, 1120, 101)
  seed(scopedMemory, 1120, 193)
  const privateExpected = original[name](1120)
  seed(originalMemory, 1120, 101)
  const globalExpected = original[name](1120)
  seed(originalMemory, 1120, 193)
  const scopedExpected = original[name](1120)
  assert.equal(
    transformed[name](1120),
    privateExpected,
    `${name} private result`,
  )
  assert.equal(
    transformed[name](tagGlobal(1120)),
    globalExpected,
    `${name} global result`,
  )
  assert.equal(
    transformed[name](tagScoped(1120)),
    scopedExpected,
    `${name} scoped result`,
  )
}
for (const name of exportedNames.filter((name) =>
  /^atomic_i(32|64)_atomic_store/.test(name),
)) {
  const value = valueFor(name, 0x31)
  for (const memory of [
    originalMemory,
    privateMemory,
    globalMemory,
    scopedMemory,
  ]) {
    new Uint8Array(memory.buffer, 1120, 24).fill(0)
  }
  original[name](1120, value)
  transformed[name](1120, value)
  assert.deepEqual(
    bytesAt(privateMemory, 1120),
    bytesAt(originalMemory, 1120),
    `${name} private bytes`,
  )
  transformed[name](tagGlobal(1120), value)
  assert.deepEqual(
    bytesAt(globalMemory, 1120),
    bytesAt(originalMemory, 1120),
    `${name} global bytes`,
  )
  transformed[name](tagScoped(1120), value)
  assert.deepEqual(
    bytesAt(scopedMemory, 1120),
    bytesAt(originalMemory, 1120),
    `${name} scoped bytes`,
  )
}
for (const name of exportedNames.filter((name) =>
  /^atomic_i(32|64)_atomic_rmw/.test(name),
)) {
  const i64 = name.startsWith('atomic_i64_')
  const expected = i64 ? 9n : 9
  const operand = i64 ? 3n : 3
  const replacement = i64 ? 13n : 13
  const args = name.includes('cmpxchg') ? [expected, replacement] : [operand]
  for (const memory of [
    originalMemory,
    privateMemory,
    globalMemory,
    scopedMemory,
  ]) {
    new Uint8Array(memory.buffer, 1120, 24).fill(0)
    const view = new DataView(memory.buffer)
    if (i64) view.setBigUint64(1128, 9n, true)
    else view.setUint32(1124, 9, true)
  }
  const privateExpected = original[name](1120, ...args)
  const privateActual = transformed[name](1120, ...args)
  assert.equal(privateActual, privateExpected, `${name} private return`)
  assert.deepEqual(
    bytesAt(privateMemory, 1120),
    bytesAt(originalMemory, 1120),
    `${name} private bytes`,
  )

  new Uint8Array(originalMemory.buffer, 1120, 24).fill(0)
  if (i64) originalView.setBigUint64(1128, 9n, true)
  else originalView.setUint32(1124, 9, true)
  const globalExpected = original[name](1120, ...args)
  const globalActual = transformed[name](tagGlobal(1120), ...args)
  assert.equal(globalActual, globalExpected, `${name} global return`)
  assert.deepEqual(
    bytesAt(globalMemory, 1120),
    bytesAt(originalMemory, 1120),
    `${name} global bytes`,
  )

  new Uint8Array(originalMemory.buffer, 1120, 24).fill(0)
  if (i64) originalView.setBigUint64(1128, 9n, true)
  else originalView.setUint32(1124, 9, true)
  const scopedExpected = original[name](1120, ...args)
  const scopedActual = transformed[name](tagScoped(1120), ...args)
  assert.equal(scopedActual, scopedExpected, `${name} scoped return`)
  assert.deepEqual(
    bytesAt(scopedMemory, 1120),
    bytesAt(originalMemory, 1120),
    `${name} scoped bytes`,
  )
}

for (const name of exportedNames.filter(
  (name) => name.startsWith('simd_') && name.includes('load'),
)) {
  seed(originalMemory, 1240, 7)
  seed(privateMemory, 1240, 7)
  seed(globalMemory, 1240, 109)
  seed(scopedMemory, 1240, 211)
  const args = name.includes('_lane') ? [1240, 0x44556677] : [1240]
  const privateExpected = original[name](...args)
  seed(originalMemory, 1240, 109)
  const globalExpected = original[name](...args)
  seed(originalMemory, 1240, 211)
  const scopedExpected = original[name](...args)
  assert.equal(
    transformed[name](...args),
    privateExpected,
    `${name} private result`,
  )
  args[0] = tagGlobal(1240)
  assert.equal(
    transformed[name](...args),
    globalExpected,
    `${name} global result`,
  )
  args[0] = tagScoped(1240)
  assert.equal(
    transformed[name](...args),
    scopedExpected,
    `${name} scoped result`,
  )
}
for (const name of exportedNames.filter(
  (name) => name.startsWith('simd_') && name.includes('store'),
)) {
  for (const memory of [
    originalMemory,
    privateMemory,
    globalMemory,
    scopedMemory,
  ]) {
    new Uint8Array(memory.buffer, 1240, 24).fill(0)
  }
  original[name](1240, 0x11223344)
  transformed[name](1240, 0x11223344)
  assert.deepEqual(
    bytesAt(privateMemory, 1240),
    bytesAt(originalMemory, 1240),
    `${name} private bytes`,
  )
  transformed[name](tagGlobal(1240), 0x11223344)
  assert.deepEqual(
    bytesAt(globalMemory, 1240),
    bytesAt(originalMemory, 1240),
    `${name} global bytes`,
  )
  transformed[name](tagScoped(1240), 0x11223344)
  assert.deepEqual(
    bytesAt(scopedMemory, 1240),
    bytesAt(originalMemory, 1240),
    `${name} scoped bytes`,
  )
}

for (const [name, value] of [
  ['scalar_i32_store', 0x12345678],
  ['scalar_i32_store8', 0x71],
  ['scalar_i32_store16', 0x3344],
]) {
  originalView.setUint32(80, 0, true)
  privateView.setUint32(80, 0, true)
  globalView.setUint32(80, 0, true)
  scopedView.setUint32(80, 0, true)
  original[name](73, value)
  transformed[name](73, value)
  assert.deepEqual(
    new Uint8Array(privateMemory.buffer, 73, 16),
    new Uint8Array(originalMemory.buffer, 73, 16),
    `${name} private`,
  )
  transformed[name](tagGlobal(73), value)
  assert.deepEqual(
    new Uint8Array(globalMemory.buffer, 73, 16),
    new Uint8Array(originalMemory.buffer, 73, 16),
    `${name} global`,
  )
  transformed[name](tagScoped(73), value)
  assert.deepEqual(
    new Uint8Array(scopedMemory.buffer, 73, 16),
    new Uint8Array(originalMemory.buffer, 73, 16),
    `${name} scoped`,
  )
}

privateView.setUint32(103, 0xdecafbad, true)
globalView.setUint32(103, 0x5a17c0de, true)
scopedView.setUint32(103, 0xa11ce55e, true)
assert.equal(transformed.scalar_i32_load(96) >>> 0, 0xdecafbad)
assert.equal(transformed.scalar_i32_load(tagGlobal(96)) >>> 0, 0x5a17c0de)
assert.equal(transformed.scalar_i32_load(tagScoped(96)) >>> 0, 0xa11ce55e)

transformed.reset_side_effect_count()
transformed.side_effect_store(120, 99)
assert.equal(transformed.side_effect_count(), 1)
assert.equal(transformed.side_effect_load(120), 99)
assert.equal(transformed.side_effect_count(), 2)
transformed.side_effect_copy(160, 120, 4)
assert.equal(transformed.side_effect_count(), 4)

assert.throws(() => transformed.scalar_i32_load(0), WebAssembly.RuntimeError)
assert.throws(
  () => transformed.scalar_i32_load(0x7ffffffc),
  WebAssembly.RuntimeError,
)
assert.throws(
  () => transformed.scalar_i32_load(tagGlobal(0x3ffffffc)),
  WebAssembly.RuntimeError,
)
assert.throws(
  () => transformed.scalar_i32_load(tagScoped(0x3ffffffc)),
  WebAssembly.RuntimeError,
)

const domains = [
  { name: 'private', memory: privateMemory, pointer: (address) => address },
  { name: 'global', memory: globalMemory, pointer: tagGlobal },
  { name: 'scoped', memory: scopedMemory, pointer: tagScoped },
]
const copyBytes = [...Array(16).keys()]
for (const destination of domains) {
  for (const source of domains) {
    new Uint8Array(source.memory.buffer, 300, 16).set(copyBytes)
    new Uint8Array(destination.memory.buffer, 400, 16).fill(0)
    transformed.bulk_copy(destination.pointer(400), source.pointer(300), 16)
    assert.deepEqual(
      [...new Uint8Array(destination.memory.buffer, 400, 16)],
      copyBytes,
      `${source.name} to ${destination.name} memory.copy`,
    )
  }
  transformed.bulk_fill(destination.pointer(520), 0xa5, 16)
  assert.deepEqual(
    [...new Uint8Array(destination.memory.buffer, 520, 16)],
    Array(16).fill(0xa5),
    `${destination.name} memory.fill`,
  )
}

const aliased = makeMemory()
const aliasExports = (await instantiateTransformed(aliased, aliased, aliased))
  .instance.exports
const aliasView = new Uint8Array(aliased.buffer)
aliasView.set([0, 1, 2, 3, 4, 5, 6, 7], 600)
aliasExports.bulk_copy(tagGlobal(602), 600, 6)
assert.deepEqual([...aliasView.slice(600, 608)], [0, 1, 0, 1, 2, 3, 4, 5])
aliasView.set([0, 1, 2, 3, 4, 5, 6, 7], 600)
aliasExports.bulk_copy(tagScoped(602), tagGlobal(600), 6)
assert.deepEqual([...aliasView.slice(600, 608)], [0, 1, 0, 1, 2, 3, 4, 5])

const atomicPrivate = new Int32Array(privateMemory.buffer)
const atomicGlobal = new Int32Array(globalMemory.buffer)
const atomicScoped = new Int32Array(scopedMemory.buffer)
atomicPrivate[180] = 7
atomicGlobal[180] = 11
atomicScoped[180] = 17
assert.equal(transformed.atomic_i32_atomic_rmw_add(716, 3), 7)
assert.equal(transformed.atomic_i32_atomic_rmw_add(tagGlobal(716), 5), 11)
assert.equal(transformed.atomic_i32_atomic_rmw_add(tagScoped(716), 7), 17)
assert.equal(atomicPrivate[180], 10)
assert.equal(atomicGlobal[180], 16)
assert.equal(atomicScoped[180], 24)
assert.equal(transformed.atomic_wait32(716, 999, 0n), 1)
assert.equal(transformed.atomic_wait32(tagGlobal(716), 999, 0n), 1)
assert.equal(transformed.atomic_wait32(tagScoped(716), 999, 0n), 1)
assert.equal(transformed.atomic_notify(tagGlobal(716), 1), 0)
assert.equal(transformed.atomic_notify(tagScoped(716), 1), 0)

atomicGlobal[0x10000 / Int32Array.BYTES_PER_ELEMENT] = 41
assert.equal(transformed.tagged_immediate_atomic_cmpxchg(41, 73), 41)
assert.equal(atomicGlobal[0x10000 / Int32Array.BYTES_PER_ELEMENT], 73)

const positiveImmediateBase = 56
const positiveLoadAddress = 0x10018 + positiveImmediateBase
globalView.setUint32(positiveLoadAddress, 0x5a17c0de, true)
assert.equal(
  transformed.tagged_immediate_positive_load(positiveImmediateBase) >>> 0,
  0x5a17c0de,
)
transformed.tagged_immediate_positive_store(
  positiveImmediateBase,
  0xdecafbad | 0,
)
assert.equal(globalView.getUint32(positiveLoadAddress, true), 0xdecafbad)
const positiveAtomicAddress = 0x10000 + positiveImmediateBase
atomicGlobal[positiveAtomicAddress / Int32Array.BYTES_PER_ELEMENT] = 19
assert.equal(
  transformed.tagged_immediate_positive_atomic_cmpxchg(
    positiveImmediateBase,
    19,
    23,
  ),
  19,
)
assert.equal(
  atomicGlobal[positiveAtomicAddress / Int32Array.BYTES_PER_ELEMENT],
  23,
)

// Deterministic differential fuzz over all domains and deliberately aliased
// memory objects. Operations use non-null, in-bounds pointers; trap behavior is
// exercised separately above.
let state = 0x9e3779b9
const random = () => {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return state >>> 0
}
const model = new Uint8Array(4096)
const fuzzMemory = makeMemory()
const fuzz = (await instantiateTransformed(fuzzMemory, fuzzMemory, fuzzMemory))
  .instance.exports
const actual = new Uint8Array(fuzzMemory.buffer)
for (let i = 0; i < 2000; i++) {
  const address = 8 + (random() % 4000)
  const pointerTag = random() % 3
  const pointer =
    pointerTag === 0
      ? address
      : pointerTag === 1
        ? tagGlobal(address)
        : tagScoped(address)
  if (random() & 1) {
    const value = random() & 0xff
    const size = 1 + (random() % Math.min(32, 4096 - address))
    fuzz.bulk_fill(pointer, value, size)
    model.fill(value, address, address + size)
  } else {
    const source = 8 + (random() % 4000)
    const size = 1 + (random() % Math.min(32, 4096 - Math.max(address, source)))
    const sourceTag = random() % 3
    const sourcePointer =
      sourceTag === 0
        ? source
        : sourceTag === 1
          ? tagGlobal(source)
          : tagScoped(source)
    fuzz.bulk_copy(pointer, sourcePointer, size)
    model.copyWithin(address, source, source + size)
  }
  assert.deepEqual(actual.slice(0, 4096), model, `fuzz iteration ${i}`)
}

// The transformed module and all shared memories must survive Worker
// structured cloning and indexed atomic use in the Worker.
const module = await WebAssembly.compile(transformedBytes)
await new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./worker-runtime.mjs', import.meta.url), {
    workerData: { module, privateMemory, globalMemory, scopedMemory },
  })
  worker.once('message', (message) =>
    message === 'ok' ? resolve() : reject(new Error(message)),
  )
  worker.once('error', reject)
  worker.once(
    'exit',
    (code) => code && reject(new Error(`worker exited ${code}`)),
  )
})

console.log('runtime semantics: ok')
