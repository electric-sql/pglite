import { workerData } from 'worker_threads'
import * as http from 'http'
import * as https from 'https'
import { URL } from 'url'

function fetch(
  url: string,
  range: { start: number; end: number } | undefined,
  sharedBuffer: SharedArrayBuffer,
  chunkSize: number,
) {
  const parsedUrl = new URL(url)
  const client = parsedUrl.protocol === 'https:' ? https : http

  const options = {
    headers: range
      ? {
          Range: `bytes=${range.start}-${range.end}`,
        }
      : {},
  }

  try {
    client
      .get(url, options, (response) => {
        const int32View = new Int32Array(sharedBuffer, 0, 1) // Used for synchronization
        const dataView = new Uint8Array(sharedBuffer, 4) // Used to store each chunk of data

        if (range && response.statusCode !== 206) {
          // Set a negative value to indicate an error to the main thread
          Atomics.store(int32View, 0, -1)
          Atomics.notify(int32View, 0)
          return
        } else if (!range && response.statusCode !== 200) {
          // Set a negative value to indicate an error to the main thread
          Atomics.store(int32View, 0, -1)
          Atomics.notify(int32View, 0)
          return
        }

        response.on('data', (chunk) => {
          if (Buffer.isBuffer(chunk)) {
            let chunkOffset = 0
            const chunkBuffer = new Uint8Array(chunk)

            while (chunkOffset < chunkBuffer.length) {
              const bytesToCopy = Math.min(
                chunkSize,
                chunkBuffer.length - chunkOffset,
              )
              dataView.set(
                chunkBuffer.slice(chunkOffset, chunkOffset + bytesToCopy),
              )

              // Notify the main thread that the chunk is ready
              Atomics.store(int32View, 0, bytesToCopy)
              Atomics.notify(int32View, 0)

              // Wait for the main thread to process this chunk
              Atomics.wait(int32View, 0, bytesToCopy)

              // Move the chunk offset
              chunkOffset += bytesToCopy
            }
          }
        })

        response.on('end', () => {
          // Notify the main thread that no more data is coming
          Atomics.store(int32View, 0, 0)
          Atomics.notify(int32View, 0)
        })

        response.on('error', (_err) => {
          // Set a negative value to indicate an error to the main thread
          Atomics.store(int32View, 0, -1)
          Atomics.notify(int32View, 0)
        })
      })
      .on('error', (_err) => {
        // Set a negative value to indicate an error to the main thread
        const int32View = new Int32Array(sharedBuffer, 0, 1)
        Atomics.store(int32View, 0, -1)
        Atomics.notify(int32View, 0)
      })
  } catch (error) {
    // Handle any synchronous errors
    const int32View = new Int32Array(sharedBuffer, 0, 1)
    Atomics.store(int32View, 0, -1)
    Atomics.notify(int32View, 0)
  }
}

// Run the fetch synchronously
const { url, range, sharedBuffer, chunkSize } = workerData
fetch(url, range, sharedBuffer, chunkSize)
