import { randomUUID } from 'node:crypto'
import { resolve as resolvePath } from 'node:path'
import { Worker } from 'node:worker_threads'
import { NodeClusterLeaseProvider } from './fs/node-cluster-lease.js'
import {
  PGliteInitdbHostError,
  type InitdbRuntimeInvocation,
  type InitdbRuntimeResult,
  type PGliteContractRequirement,
} from './initdb-runtime-contract.js'
import {
  STREAM_CHUNK_BYTES,
  STREAM_RESPONSE_HEADER_WORDS,
  STREAM_RESPONSE_LENGTH,
  STREAM_RESPONSE_STATE,
  STREAM_RESPONSE_STATUS,
  type InitdbWorkerData,
  type InitdbWorkerMessage,
} from './initdb-runtime-worker-types.js'
import { pgliteRuntimeIdentity } from './runtime-identity.js'

export type {
  InitdbRuntimeInvocation,
  InitdbRuntimeResult,
  PGliteClusterManifestV1,
  PGliteContractRequirement,
} from './initdb-runtime-contract.js'
export { PGliteInitdbHostError } from './initdb-runtime-contract.js'

export const initdbRuntimeIdentity: PGliteContractRequirement = Object.freeze({
  coreVersion: pgliteRuntimeIdentity.pgliteVersion,
  contract: 'initdb-runtime',
  abiVersion: 1,
})

export async function runInitdbRuntime(
  invocation: InitdbRuntimeInvocation,
): Promise<InitdbRuntimeResult> {
  assertInvocation(invocation)
  if (invocation.signal?.aborted) return { exitCode: 130 }

  const lease =
    await new NodeClusterLeaseProvider().acquireExclusiveClusterLease(
      resolvePath(invocation.dataDir),
      {
        ownerToken: randomUUID(),
        runtime: 'classic',
        startedAt: new Date().toISOString(),
      },
    )

  const data: InitdbWorkerData = {
    dataDir: invocation.dataDir,
    argv: [...invocation.argv],
    env: { ...invocation.env },
    icuDataDir: invocation.icuDataDir,
    assets: {
      postgresWasm: new URL('./pglite.wasm', import.meta.url).href,
      postgresData: new URL('./pglite.data', import.meta.url).href,
      initdbWasm: new URL('./initdb.wasm', import.meta.url).href,
    },
    coreVersion: initdbRuntimeIdentity.coreVersion,
  }
  let worker: Worker
  try {
    worker = new Worker(
      new URL('./initdb-runtime-worker.js', import.meta.url),
      {
        workerData: data,
        execArgv: process.execArgv.filter(
          (argument) => !argument.startsWith('--input-type'),
        ),
      },
    )
  } catch (error) {
    await lease.release()
    throw error
  }
  const stdin = asyncIterator(invocation.stdin)
  let inputRemainder = new Uint8Array()
  let settled = false
  let streamFailure: unknown

  return await new Promise<InitdbRuntimeResult>((resolve, reject) => {
    const finish = (result: InitdbRuntimeResult) => {
      if (settled) return
      settled = true
      cleanup()
      void lease.release().then(() => resolve(result), reject)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate()
      const failure =
        error instanceof PGliteInitdbHostError
          ? error
          : new PGliteInitdbHostError('Standalone initdb host failed', {
              cause: error,
            })
      void lease.release().then(() => reject(failure), reject)
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      void worker
        .terminate()
        .then(() => lease.release())
        .then(() => resolve({ exitCode: 130 }), reject)
    }
    const cleanup = () => {
      invocation.signal?.removeEventListener('abort', abort)
      worker.removeAllListeners()
    }

    invocation.signal?.addEventListener('abort', abort, { once: true })
    worker.on('message', (message: InitdbWorkerMessage) => {
      if (message.type === 'stdin') {
        void serviceStdin(message.response).catch((error) => {
          streamFailure = error
          completeStreamResponse(message.response, -1)
        })
      } else if (message.type === 'stdout' || message.type === 'stderr') {
        const stream =
          message.type === 'stdout' ? invocation.stdout : invocation.stderr
        void writeChunk(stream, message.data)
          .then(() => completeStreamResponse(message.response, 0))
          .catch((error) => {
            streamFailure = error
            completeStreamResponse(message.response, -1)
          })
      } else if (message.type === 'result') {
        finish({ exitCode: message.exitCode, manifest: message.manifest })
      } else if (message.type === 'error') {
        fail(
          new PGliteInitdbHostError(message.message, {
            cause: streamFailure ?? message.stack,
          }),
        )
      }
    })
    worker.once('error', fail)
    worker.once('exit', (code) => {
      if (!settled) {
        fail(
          streamFailure ??
            new Error(`Standalone initdb Worker exited with status ${code}`),
        )
      }
    })
  })

  async function serviceStdin(response: SharedArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(
      response,
      STREAM_RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
    )
    if (inputRemainder.byteLength === 0) {
      const next = await stdin.next()
      if (next.done) {
        completeStreamResponse(response, 0, 0)
        return
      }
      inputRemainder = normalizeInputChunk(next.value)
    }
    const length = Math.min(bytes.byteLength, inputRemainder.byteLength)
    bytes.set(inputRemainder.subarray(0, length))
    inputRemainder = inputRemainder.subarray(length)
    completeStreamResponse(response, 0, length)
  }
}

function assertInvocation(invocation: InitdbRuntimeInvocation): void {
  if (!invocation || typeof invocation !== 'object') {
    throw new TypeError('An initdb runtime invocation is required')
  }
  if (
    typeof invocation.dataDir !== 'string' ||
    invocation.dataDir.length === 0
  ) {
    throw new TypeError('initdb dataDir must be a non-empty host path')
  }
  if (!Array.isArray(invocation.argv)) {
    throw new TypeError('initdb argv must be an array')
  }
  for (const argument of invocation.argv) {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      throw new TypeError('initdb argv contains an invalid argument')
    }
  }
  if (
    invocation.icuDataDir !== undefined &&
    !(invocation.icuDataDir instanceof Blob)
  ) {
    throw new TypeError('initdb icuDataDir must be a Blob or File')
  }
  for (const stream of [
    invocation.stdin,
    invocation.stdout,
    invocation.stderr,
  ]) {
    if (!stream || typeof stream !== 'object') {
      throw new TypeError('initdb requires stdin, stdout, and stderr streams')
    }
  }
}

function asyncIterator(stream: NodeJS.ReadableStream): AsyncIterator<unknown> {
  const iterable = stream as NodeJS.ReadableStream & AsyncIterable<unknown>
  if (typeof iterable[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('initdb stdin must be an async-iterable Node stream')
  }
  return iterable[Symbol.asyncIterator]()
}

function normalizeInputChunk(value: unknown): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  throw new TypeError('initdb stdin produced a non-byte chunk')
}

function writeChunk(
  stream: NodeJS.WritableStream,
  data: Uint8Array,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const writable = stream as NodeJS.WritableStream & {
      write(
        chunk: Uint8Array,
        callback: (error?: Error | null) => void,
      ): boolean
    }
    writable.write(data, (error) => (error ? reject(error) : resolve()))
  })
}

function completeStreamResponse(
  response: SharedArrayBuffer,
  status: number,
  length = 0,
): void {
  const words = new Int32Array(response, 0, STREAM_RESPONSE_HEADER_WORDS)
  Atomics.store(words, STREAM_RESPONSE_STATUS, status)
  Atomics.store(words, STREAM_RESPONSE_LENGTH, length)
  Atomics.store(words, STREAM_RESPONSE_STATE, 1)
  Atomics.notify(words, STREAM_RESPONSE_STATE)
}

export const initdbRuntimeStreamChunkBytes = STREAM_CHUNK_BYTES
