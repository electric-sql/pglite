import { parentPort, workerData } from 'node:worker_threads'

try {
  const { module, privateMemory, globalMemory, scopedMemory } = workerData
  const instance = new WebAssembly.Instance(module, {
    cap: {
      private_memory: privateMemory,
      global_memory: globalMemory,
      scoped_memory: scopedMemory,
    },
  })
  const before = instance.exports.atomic_add_global(128, 1)
  const waitResult = Atomics.wait(
    new Int32Array(globalMemory.buffer),
    200,
    0,
    0,
  )
  parentPort.postMessage({ ok: before === 50 && waitResult === 'timed-out' })
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.stack })
}
