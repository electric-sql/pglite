// Record successful instantiation of the packaged side modules in each isolate.
const { createHash } = require('node:crypto')
const { readFileSync, appendFileSync } = require('node:fs')
const { threadId } = require('node:worker_threads')
const bySize = JSON.parse(readFileSync(process.env.PGLITE_OBSERVE_MANIFEST))
if (process.argv[2] === 'classic') {
  const { createHook } = require('node:async_hooks')
  let workers = 0
  createHook({
    init(_id, type) {
      if (type === 'WORKER') workers++
    },
  }).enable()
  process.on('exit', () =>
    require('node:assert/strict').equal(workers, 0, 'classic started a worker'),
  )
}
const hashes = new WeakMap()
const reported = new Set()
function record(module, bytes) {
  if (!bytes || !bySize[bytes.byteLength]) return
  const hash = createHash('sha256')
    .update(
      ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes),
    )
    .digest('hex')
  if (bySize[bytes.byteLength].includes(hash)) hashes.set(module, hash)
}
function linked(module) {
  const hash = hashes.get(module)
  if (!hash || reported.has(hash)) return
  reported.add(hash)
  appendFileSync(
    process.env.PGLITE_OBSERVE_LOG,
    JSON.stringify({ threadId, hash }) + '\n',
  )
}
const wasm = WebAssembly
const compile = wasm.compile.bind(wasm)
wasm.compile = async function (bytes, ...args) {
  const module = await compile(bytes, ...args)
  record(module, bytes)
  return module
}
wasm.Module = new Proxy(wasm.Module, {
  construct(target, args) {
    const module = Reflect.construct(target, args)
    record(module, args[0])
    return module
  },
})
wasm.Instance = new Proxy(wasm.Instance, {
  construct(target, args) {
    const instance = Reflect.construct(target, args)
    linked(args[0])
    return instance
  },
})
const instantiate = wasm.instantiate.bind(wasm)
wasm.instantiate = async function (input, ...args) {
  const result = await instantiate(input, ...args)
  if (result.module) record(result.module, input)
  linked(result.module ?? input)
  return result
}
