import { parentPort, workerData } from 'node:worker_threads'
import { executeInitdbRuntime } from './initdb-runtime-host.js'
import {
  STREAM_CHUNK_BYTES,
  STREAM_RESPONSE_HEADER_WORDS,
  STREAM_RESPONSE_LENGTH,
  STREAM_RESPONSE_STATE,
  STREAM_RESPONSE_STATUS,
  type InitdbWorkerData,
  type InitdbWorkerMessage,
} from './initdb-runtime-worker-types.js'

if (!parentPort) throw new Error('initdb runtime Worker has no parent port')

const port = parentPort
const data = workerData as InitdbWorkerData
const encoder = new TextEncoder()
let stdin = new Uint8Array()
let stdinOffset = 0

void executeInitdbRuntime(data, {
  readByte() {
    if (stdinOffset >= stdin.byteLength) refillStdin()
    if (stdinOffset >= stdin.byteLength) return null
    return stdin[stdinOffset++]
  },
  writeStdout(text) {
    write('stdout', text)
  },
  writeStderr(text) {
    write('stderr', text)
  },
})
  .then(({ exitCode, manifest }) => {
    send({ type: 'result', exitCode, manifest })
    port.close()
  })
  .catch((error) => {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    port.close()
  })

function refillStdin(): void {
  const response = new SharedArrayBuffer(
    STREAM_RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT +
      STREAM_CHUNK_BYTES,
  )
  send({ type: 'stdin', response })
  waitForResponse(response, 'stdin')
  const words = new Int32Array(response, 0, STREAM_RESPONSE_HEADER_WORDS)
  const length = Atomics.load(words, STREAM_RESPONSE_LENGTH)
  stdin = new Uint8Array(
    response,
    STREAM_RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
    length,
  )
  stdinOffset = 0
}

function write(type: 'stdout' | 'stderr', text: string): void {
  const response = new SharedArrayBuffer(
    STREAM_RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
  )
  send({ type, data: encoder.encode(`${text}\n`), response })
  waitForResponse(response, type)
}

function waitForResponse(response: SharedArrayBuffer, operation: string): void {
  const words = new Int32Array(response, 0, STREAM_RESPONSE_HEADER_WORDS)
  Atomics.wait(words, STREAM_RESPONSE_STATE, 0)
  if (Atomics.load(words, STREAM_RESPONSE_STATUS) !== 0) {
    throw new Error(`initdb ${operation} stream failed`)
  }
}

function send(message: InitdbWorkerMessage): void {
  port.postMessage(message)
}
