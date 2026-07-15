import { createConnection, type Socket } from 'node:net'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type {
  PostgresToolInvocation,
  PostgresToolRunner,
} from './tool-runner.js'
import {
  RESPONSE_HEADER_WORDS,
  RESPONSE_LENGTH,
  RESPONSE_STATE,
  RESPONSE_STATUS,
  type NativeToolWorkerData,
  type NativeToolWorkerMessage,
  type PollDescriptor,
} from './native-tool-worker-types.js'
import type { NativeToolArtifactIdentity } from './native-tool-identity.js'

const POLLIN = 0x0001
const POLLOUT = 0x0004
const POLLERR = 0x0008
const POLLHUP = 0x0010
const POLLNVAL = 0x0020

export class PGliteToolHostError extends Error {
  override readonly name = 'PGliteToolHostError'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    if (options && 'cause' in options) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

export function createNativeToolRunner(
  command: string,
  moduleUrl: URL,
  expectedArtifact: NativeToolArtifactIdentity,
): PostgresToolRunner {
  return Object.freeze({
    command,
    run: (invocation: PostgresToolInvocation) =>
      runNativeTool(command, moduleUrl, expectedArtifact, invocation),
  })
}

interface OpenSocket {
  readonly socket: Socket
  chunks: Uint8Array[]
  length: number
  ended: boolean
  errno: number
}

async function runNativeTool(
  command: string,
  moduleUrl: URL,
  expectedArtifact: NativeToolArtifactIdentity,
  invocation: PostgresToolInvocation,
): Promise<number> {
  assertInvocation(invocation)
  if (invocation.signal?.aborted) return 130
  assertArtifactIdentity(command, moduleUrl, expectedArtifact)

  const data: NativeToolWorkerData = {
    command,
    argv: [...invocation.argv],
    env: { ...invocation.env },
    cwd: normalizeCwd(invocation.cwd),
    moduleUrl: moduleUrl.href,
  }
  const worker = new Worker(
    new URL('./native-tool-worker.js', import.meta.url),
    {
      workerData: data,
      execArgv: process.execArgv.filter(
        (argument) => !argument.startsWith('--input-type'),
      ),
    },
  )
  const sockets = new Map<number, OpenSocket>()
  const stdin = asyncIterator(invocation.stdin)
  let inputRemainder = new Uint8Array()
  let settled = false
  let streamFailure: unknown
  const pendingPolls = new Set<
    Extract<NativeToolWorkerMessage, { type: 'socket-poll' }>
  >()

  return await new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      invocation.signal?.removeEventListener('abort', abort)
      worker.removeAllListeners()
      for (const socket of sockets.values()) socket.socket.destroy()
      sockets.clear()
      for (const poll of pendingPolls) complete(poll.response, 0)
      pendingPolls.clear()
    }
    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      cleanup()
      if (streamFailure) {
        reject(
          new PGliteToolHostError(`${command} standard I/O failed`, {
            cause: streamFailure,
          }),
        )
      } else {
        resolve(exitCode)
      }
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate()
      reject(
        error instanceof PGliteToolHostError
          ? error
          : new PGliteToolHostError(`${command} host failed`, { cause: error }),
      )
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate().then(() => resolve(130), reject)
    }

    invocation.signal?.addEventListener('abort', abort, { once: true })
    worker.on('message', (message: NativeToolWorkerMessage) => {
      if (message.type === 'stdin') {
        void serviceStdin(message.response).catch((error) => {
          streamFailure = error
          complete(message.response, -1)
        })
      } else if (message.type === 'stdout' || message.type === 'stderr') {
        const stream =
          message.type === 'stdout' ? invocation.stdout : invocation.stderr
        void writeChunk(stream, message.data)
          .then(() => complete(message.response, 0))
          .catch((error) => {
            streamFailure = error
            complete(message.response, -1)
          })
      } else if (message.type === 'socket-connect') {
        connectSocket(message)
      } else if (message.type === 'socket-send') {
        sendSocket(message)
      } else if (message.type === 'socket-receive') {
        receiveSocket(message)
      } else if (message.type === 'socket-poll') {
        pollSockets(message)
      } else if (message.type === 'socket-close') {
        closeSocket(message)
      } else if (message.type === 'result') {
        finish(message.exitCode)
      } else if (message.type === 'error') {
        fail(new PGliteToolHostError(message.message, { cause: message.stack }))
      }
    })
    worker.once('error', fail)
    worker.once('exit', (code) => {
      if (!settled)
        fail(new Error(`${command} Worker exited with status ${code}`))
    })
  })

  async function serviceStdin(response: SharedArrayBuffer): Promise<void> {
    const bytes = responseBytes(response)
    if (inputRemainder.byteLength === 0) {
      const next = await stdin.next()
      if (next.done) {
        complete(response, 0, 0)
        return
      }
      inputRemainder = normalizeInput(next.value)
    }
    const length = Math.min(bytes.byteLength, inputRemainder.byteLength)
    bytes.set(inputRemainder.subarray(0, length))
    inputRemainder = inputRemainder.subarray(length)
    complete(response, 0, length)
  }

  function connectSocket(
    message: Extract<NativeToolWorkerMessage, { type: 'socket-connect' }>,
  ): void {
    const options =
      message.address.transport === 'unix'
        ? { path: message.address.path! }
        : { host: message.address.host!, port: message.address.port! }
    const socket = createConnection(options)
    const state: OpenSocket = {
      socket,
      chunks: [],
      length: 0,
      ended: false,
      errno: 0,
    }
    sockets.set(message.descriptor, state)
    socket.once('connect', () => complete(message.response, 0))
    socket.on('data', (chunk: Buffer) => {
      state.chunks.push(new Uint8Array(chunk))
      state.length += chunk.byteLength
      servicePendingPolls()
    })
    socket.on('end', () => {
      state.ended = true
      servicePendingPolls()
    })
    socket.on('error', (error: NodeJS.ErrnoException) => {
      state.errno = errnoFor(error.code)
      state.ended = true
      if (
        Atomics.load(
          new Int32Array(message.response, 0, RESPONSE_HEADER_WORDS),
          RESPONSE_STATE,
        ) === 0
      ) {
        complete(message.response, -state.errno)
      }
      servicePendingPolls()
    })
  }

  function sendSocket(
    message: Extract<NativeToolWorkerMessage, { type: 'socket-send' }>,
  ): void {
    const state = sockets.get(message.descriptor)
    if (!state || state.ended) {
      complete(message.response, -32)
      return
    }
    state.socket.write(message.data, (error) => {
      complete(
        message.response,
        error ? -errnoFor((error as NodeJS.ErrnoException).code) : 0,
        message.data.length,
      )
    })
  }

  function receiveSocket(
    message: Extract<NativeToolWorkerMessage, { type: 'socket-receive' }>,
  ): void {
    const state = sockets.get(message.descriptor)
    if (!state) {
      complete(message.response, -9)
      return
    }
    if (state.length === 0) {
      complete(
        message.response,
        state.ended ? (state.errno ? -state.errno : 0) : -11,
        0,
      )
      return
    }
    const target = responseBytes(message.response)
    let offset = 0
    const maximum = Math.min(message.maximum, target.byteLength)
    while (offset < maximum && state.chunks.length > 0) {
      const first = state.chunks[0]
      const length = Math.min(first.byteLength, maximum - offset)
      target.set(first.subarray(0, length), offset)
      offset += length
      state.length -= length
      if (length === first.byteLength) state.chunks.shift()
      else state.chunks[0] = first.subarray(length)
    }
    complete(message.response, 0, offset)
  }

  function pollSockets(
    message: Extract<NativeToolWorkerMessage, { type: 'socket-poll' }>,
  ): void {
    if (completePoll(message)) return
    if (message.timeout === 0) {
      complete(message.response, 0, 0)
      return
    }
    pendingPolls.add(message)
    if (message.timeout > 0) {
      const timer = setTimeout(() => {
        if (!pendingPolls.delete(message)) return
        complete(message.response, 0, 0)
      }, message.timeout)
      timer.unref()
    }
  }

  function completePoll(
    message: Extract<NativeToolWorkerMessage, { type: 'socket-poll' }>,
  ): boolean {
    const bytes = responseBytes(message.response)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let ready = 0
    message.descriptors.forEach((descriptor: PollDescriptor, index) => {
      const state = sockets.get(descriptor.descriptor)
      let returned = 0
      if (!state) returned = POLLNVAL | POLLERR
      else {
        if (
          (descriptor.events & POLLIN) !== 0 &&
          (state.length > 0 || state.ended)
        )
          returned |= POLLIN
        if ((descriptor.events & POLLOUT) !== 0 && !state.ended)
          returned |= POLLOUT
        if (state.ended) returned |= POLLHUP
        if (state.errno) returned |= POLLERR
      }
      view.setInt16(index * 2, returned, true)
      if (returned !== 0) ready++
    })
    if (ready === 0) return false
    pendingPolls.delete(message)
    complete(message.response, 0, ready)
    return true
  }

  function servicePendingPolls(): void {
    for (const request of pendingPolls) completePoll(request)
  }

  function closeSocket(
    message: Extract<NativeToolWorkerMessage, { type: 'socket-close' }>,
  ): void {
    const state = sockets.get(message.descriptor)
    if (!state) {
      complete(message.response, -9)
      return
    }
    state.socket.destroy()
    sockets.delete(message.descriptor)
    complete(message.response, 0)
  }
}

function assertArtifactIdentity(
  command: string,
  moduleUrl: URL,
  expected: NativeToolArtifactIdentity,
): void {
  const wasmUrl = new URL(moduleUrl.href.replace(/\.js$/, '.wasm'))
  let actual: string
  try {
    actual = createHash('sha256').update(readFileSync(wasmUrl)).digest('hex')
  } catch (error) {
    throw new PGliteToolHostError(`Cannot read ${command} Wasm artifact`, {
      cause: error,
    })
  }
  if (actual !== expected.artifactSha256) {
    throw new PGliteToolHostError(
      `Incompatible ${command} Wasm artifact: expected ${expected.artifactSha256}, received ${actual}`,
    )
  }
}

function assertInvocation(invocation: PostgresToolInvocation): void {
  if (!invocation || typeof invocation !== 'object')
    throw new TypeError('A PostgreSQL tool invocation is required')
  if (!Array.isArray(invocation.argv))
    throw new TypeError('argv must be an array')
  for (const argument of invocation.argv) {
    if (typeof argument !== 'string' || argument.includes('\0'))
      throw new TypeError('argv contains an invalid argument')
  }
  if (!invocation.env || typeof invocation.env !== 'object')
    throw new TypeError('env must be an object')
  for (const stream of [
    invocation.stdin,
    invocation.stdout,
    invocation.stderr,
  ]) {
    if (!stream || typeof stream !== 'object')
      throw new TypeError('stdin, stdout, and stderr streams are required')
  }
}

function normalizeCwd(cwd: string | URL | undefined): string | undefined {
  if (cwd instanceof URL) {
    if (cwd.protocol !== 'file:') throw new TypeError('cwd URL must use file:')
    return fileURLToPath(cwd)
  }
  return cwd
}

function asyncIterator(stream: NodeJS.ReadableStream): AsyncIterator<unknown> {
  const iterable = stream as NodeJS.ReadableStream & AsyncIterable<unknown>
  if (typeof iterable[Symbol.asyncIterator] !== 'function')
    throw new TypeError('stdin must be an async-iterable Node stream')
  return iterable[Symbol.asyncIterator]()
}

function normalizeInput(value: unknown): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return value
  throw new TypeError('stdin produced a non-byte chunk')
}

async function writeChunk(
  stream: NodeJS.WritableStream,
  chunk: Uint8Array,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error?: Error | null) =>
      error ? reject(error) : resolve(),
    )
  })
}

function responseBytes(response: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(
    response,
    RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
  )
}

function complete(
  response: SharedArrayBuffer,
  status: number,
  length = 0,
): void {
  const words = new Int32Array(response, 0, RESPONSE_HEADER_WORDS)
  Atomics.store(words, RESPONSE_STATUS, status)
  Atomics.store(words, RESPONSE_LENGTH, length)
  Atomics.store(words, RESPONSE_STATE, 1)
  Atomics.notify(words, RESPONSE_STATE)
}

function errnoFor(code: string | undefined): number {
  switch (code) {
    case 'ENOENT':
      return 2
    case 'EACCES':
      return 13
    case 'ECONNRESET':
      return 104
    case 'ECONNREFUSED':
      return 111
    case 'ETIMEDOUT':
      return 110
    case 'EPIPE':
      return 32
    default:
      return 5
  }
}
