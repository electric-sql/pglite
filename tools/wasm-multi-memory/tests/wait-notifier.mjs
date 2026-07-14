import { workerData } from 'node:worker_threads'

const view = new Int32Array(workerData.buffer)
Atomics.store(view, 0, workerData.value)
Atomics.notify(view, 0, 1)
