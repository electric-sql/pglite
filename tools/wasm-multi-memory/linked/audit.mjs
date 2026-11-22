import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { memoryImportTypes } from '../wasm-memory-imports.mjs'

// A valid module declaring two memories must fail on the engine used for this audit.
const twoMemories = Buffer.from('0061736d0100000005050200010001', 'hex')
assert.equal(WebAssembly.validate(twoMemories), false)
const modules = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const providerExports = new Set(
  WebAssembly.Module.exports(
    new WebAssembly.Module(readFileSync(modules['linked-shared.wasm'])),
  ).map((entry) => entry.name),
)
const classic = new WebAssembly.Module(readFileSync(modules['pglite.wasm']))
const embedded = WebAssembly.Module.customSections(
  classic,
  'pglite.linked-unshared',
)
assert.equal(embedded.length, 1)
assert.deepEqual(
  Buffer.from(embedded[0]),
  readFileSync(modules['linked-unshared.wasm']),
)
for (const shared of [false, true]) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared })
  const name = shared ? 'linked-shared.wasm' : 'linked-unshared.wasm'
  const provider = new WebAssembly.Module(readFileSync(modules[name]))
  assert.deepEqual(
    new Set(WebAssembly.Module.exports(provider).map((entry) => entry.name)),
    providerExports,
  )
  const ops = new WebAssembly.Instance(provider, { env: { memory } }).exports
  ops.store_i32_4(8, 17, 4)
  assert.equal(ops.load_i32_4u(12, 0), 17)
  assert.throws(() => ops.load_i32_4u(-4, 8), WebAssembly.RuntimeError)
  assert.throws(() => ops.load_i32_4u(65535, 0), WebAssembly.RuntimeError)
  memory.grow(1)
  ops.store_i32_4(65536, 91, 0)
  assert.equal(ops.load_i32_4u(65536, 0), 91)
  assert.equal(ops.cmpxchg_i32_4(65536, 91, 22, 0), 91)
  assert.equal(ops.load_i32_4u_atomic(65536, 0), 22)
}
const counts = {}
const sideModules = {}
let vectorHash
for (const [name, path] of Object.entries(modules)) {
  const bytes = readFileSync(path)
  const module = new WebAssembly.Module(bytes)
  const imports = memoryImportTypes(bytes)
  if (
    name.startsWith('postmaster.data/') ||
    name === 'postmaster.wasm' ||
    /^(postgis|vector|linked_probe)\.tar\.gz\/.*\.so$/.test(name) ||
    (process.env.PGLITE_AUDIT_LINKED_ARCHIVES === '1' &&
      /\.tar\.gz\/.*\.so$/.test(name))
  ) {
    assert.deepEqual([...imports.keys()], ['env\0memory'], name)
    const sections = WebAssembly.Module.customSections(
      module,
      'pglite.linked-memory.abi',
    )
    assert.equal(sections.length, 1, name)
    assert.equal(
      new TextDecoder().decode(sections[0]),
      'pglite-linked-wasm32-v1',
      name,
    )
  }
  for (const { shared } of imports.values()) {
    assert.equal(shared, name === 'linked-shared.wasm', name)
  }
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.module === 'pgl_global' || entry.module === 'pgl_scoped') {
      assert.ok(
        entry.kind === 'function' && providerExports.has(entry.name),
        name + ' ' + entry.name,
      )
    }
  }
  const category = name.includes('.data/')
    ? name.split('/')[0]
    : name.includes('.tar.gz/')
      ? 'archives'
      : 'standalone'
  counts[category] = (counts[category] ?? 0) + 1
  if (category === 'archives')
    sideModules[name] = createHash('sha256').update(bytes).digest('hex')
  if (name.endsWith('/vector.so'))
    vectorHash = createHash('sha256').update(bytes).digest('hex')
}
assert.ok(vectorHash)
console.log(
  JSON.stringify(
    {
      node: process.version,
      supportsNativeMultiMemory: false,
      modules: Object.keys(modules).length,
      counts,
      vectorSha256: vectorHash,
      sideModules,
    },
    null,
    2,
  ),
)
