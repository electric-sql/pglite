// Untimed diagnostic run. Each isolate logs its own Wasm work on the common Node clock.
const { appendFileSync } = require('node:fs')
const threads = require('node:worker_threads')
const { threadId, workerData } = threads
const log = (op, start, detail) =>
  appendFileSync(
    process.env.PGLITE_STARTUP_TRACE,
    JSON.stringify({
      threadId,
      pid: workerData?.process?.pid,
      op,
      start,
      ms: performance.now() - start,
      detail,
    }) + '\n',
  )
globalThis.pglStartupEvent = log
log('isolate', performance.now())
if (threads.isMainThread) {
  threads.Worker = new Proxy(threads.Worker, {
    construct(target, args) {
      const start = performance.now()
      const worker = Reflect.construct(target, args)
      if (args[1]?.workerData?.process) {
        const detail = {
          thread: worker.threadId,
          pid: args[1].workerData.process.pid,
        }
        worker.once('online', () => log('worker online', start, detail))
        function onMessage(message) {
          if (message.type !== 'runtime-ready') return
          log('worker runtime ready', start, detail)
          worker.off('message', onMessage)
        }
        worker.on('message', onMessage)
      }
      return worker
    },
  })
  require('node:module').syncBuiltinESMExports()
}
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
