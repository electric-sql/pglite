import { Worker } from 'worker_threads'
import type { SyncFetch } from './types.js'

const CHUNK_SIZE = 64 * 1024 // 64KB

export const syncFetchNode: SyncFetch = (
  url: string,
  range?: { start: number; end: number },
): Uint8Array => {
  // Shared buffer for communication (chunk size + sync flag)
  const sharedBuffer = new SharedArrayBuffer(CHUNK_SIZE + 4) // 4 extra bytes for synchronization
  const int32View = new Int32Array(sharedBuffer, 0, 1) // Used for synchronization
  const dataView = new Uint8Array(sharedBuffer, 4) // Used to store each chunk of data

  // Create a new worker
  const worker = new Worker(new URL('./node-worker.js', import.meta.url), {
    workerData: { url, range, sharedBuffer, chunkSize: CHUNK_SIZE },
  })

  const receivedChunks: Uint8Array[] = []

  try {
    while (true) {
      // Block the main thread until the worker signals that a chunk is ready or an error occurs
      Atomics.wait(int32View, 0, 0)

      // Check for an error signal
      const signal = Atomics.load(int32View, 0)
      if (signal < 0) {
        // Terminate the worker and throw an error if the signal indicates failure
        worker.terminate()
        throw new Error(`Failed to fetch data: ${url}`)
      }

      // Check if the worker signaled completion
      if (signal === 0) {
        // If chunk length is 0, it means the worker has finished sending data
        break
      }

      // Store the chunk data
      receivedChunks.push(dataView.slice(0, signal))

      // Reset the sync flag for the next chunk
      Atomics.store(int32View, 0, 0)
      Atomics.notify(int32View, 0) // Signal worker that we're ready for the next chunk
    }

    // Concatenate all the received chunks into a single Uint8Array
    const totalLength = receivedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    )
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of receivedChunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  } finally {
    worker.terminate() // Ensure the worker is terminated
  }
}
