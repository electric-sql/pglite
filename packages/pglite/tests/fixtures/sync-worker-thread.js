// The leader worker used by tests/worker-sync.test.ts, run as a Node.js worker
// thread. It adapts the Web Worker globals that `worker()` expects to
// `worker_threads`, and gives PGlite a filesystem that counts `syncToFs()`
// calls and writes a snapshot of PGDATA each time, the way IDBFS persists it.
import { parentPort, workerData } from 'node:worker_threads'
import { writeFileSync } from 'node:fs'
import { PGlite, MemoryFS } from '../../dist/index.js'
import { worker } from '../../dist/worker/index.js'

const { counters, snapshotFile } = workerData
const syncCalls = new Int32Array(counters)

globalThis.postMessage = (message) => parentPort.postMessage(message)
globalThis.addEventListener = (type, callback, options) => {
  if (type !== 'message') return
  const listener = (data) => {
    if (options?.once) parentPort.off('message', listener)
    callback({ data })
  }
  parentPort.on('message', listener)
}

class SnapshotFS extends MemoryFS {
  async syncToFs() {
    Atomics.add(syncCalls, 0, 1)
    const tar = await this.dumpTar('snapshot', 'none')
    writeFileSync(snapshotFile, new Uint8Array(await tar.arrayBuffer()))
    Atomics.add(syncCalls, 1, 1)
  }
}

worker({
  async init() {
    return new PGlite({ fs: new SnapshotFS() })
  },
})
