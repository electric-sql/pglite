// Untimed diagnostic run. Each isolate logs its own Wasm work on the common Node clock.
const { appendFileSync } = require('node:fs')
const { threadId, workerData } = require('node:worker_threads')
const log = (op, start, detail) =>
  appendFileSync(
    process.env.PGLITE_STARTUP_TRACE,
    JSON.stringify({
      threadId,
      process: workerData?.process?.kind,
      op,
      start,
      ms: performance.now() - start,
      detail,
    }) + '\n',
  )
globalThis.pglStartupEvent = log
log('isolate', performance.now())
const wasm = WebAssembly
for (const name of ['compile', 'instantiate']) {
  const original = wasm[name].bind(wasm)
  wasm[name] = async (...args) => {
    const start = performance.now()
    try {
      return await original(...args)
    } finally {
      log(name, start, args[0]?.byteLength)
    }
  }
}
for (const name of ['Module', 'Instance']) {
  wasm[name] = new Proxy(wasm[name], {
    construct(original, args) {
      const start = performance.now()
      try {
        return Reflect.construct(original, args)
      } finally {
        log(name, start, args[0]?.byteLength)
      }
    },
  })
}
const grow = wasm.Memory.prototype.grow
wasm.Memory.prototype.grow = function (pages) {
  const start = performance.now()
  const previous = grow.call(this, pages)
  log('grow', start, { previous, pages })
  return previous
}
