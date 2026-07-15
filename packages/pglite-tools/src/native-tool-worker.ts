import { parentPort, workerData } from 'node:worker_threads'
import {
  RESPONSE_CHUNK_BYTES,
  RESPONSE_HEADER_WORDS,
  RESPONSE_LENGTH,
  RESPONSE_STATE,
  RESPONSE_STATUS,
  type NativeToolWorkerData,
  type NativeToolWorkerMessage,
  type PollDescriptor,
  type SocketAddress,
} from './native-tool-worker-types.js'

if (!parentPort) throw new Error('Native PostgreSQL tool must run in a Worker')
const port = parentPort
const data = workerData as NativeToolWorkerData

const SOCKET_DESCRIPTOR_BASE = 0x3c000000
const POLLFD_BYTES = 8
const AF_UNIX = 1
const AF_INET = 2
const AF_INET6 = 10
const decoder = new TextDecoder('utf-8', { fatal: true })

interface ToolModule {
  HEAPU8: Uint8Array
  ENV: Record<string, string>
  FS: {
    chdir(path: string): void
    mkdirTree(path: string): void
    mount(type: unknown, options: { root: string }, mountpoint: string): void
    filesystems: { readonly NODEFS?: unknown }
  }
  addFunction(callback: CallableFunction, signature: string): number
  removeFunction(callback: number): void
  _pgl_set_socket_host(...callbacks: number[]): void
  ___errno_location(): number
  callMain(argv: string[]): number | undefined
}

type ToolFactory = (options: Record<string, unknown>) => Promise<ToolModule>

void run().catch((error) => {
  port.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  } satisfies NativeToolWorkerMessage)
})

async function run(): Promise<void> {
  const imported = (await import(data.moduleUrl)) as { default: ToolFactory }
  let exitCode = 0
  let stdin = new Uint8Array()
  let stdinOffset = 0
  const output = {
    stdout: [] as number[],
    stderr: [] as number[],
  }
  const callbacks: number[] = []

  const module = await imported.default({
    noInitialRun: true,
    thisProgram: data.command,
    arguments: [],
    stdin: () => {
      if (stdinOffset >= stdin.length) {
        const response = request({ type: 'stdin' })
        const length = response.length
        if (length === 0) return null
        stdin = response.bytes.slice(0, length)
        stdinOffset = 0
      }
      return stdin[stdinOffset++]
    },
    stdout: (byte: number | null) => outputByte('stdout', byte),
    stderr: (byte: number | null) => outputByte('stderr', byte),
    print: (text: string) => outputText('stdout', text),
    printErr: (text: string) => outputText('stderr', text),
    onExit: (status: number) => {
      exitCode = status
    },
    preRun: [
      (mod: ToolModule) => {
        for (const [name, value] of Object.entries(data.env)) {
          if (value === undefined) delete mod.ENV[name]
          else mod.ENV[name] = value
        }
        mountHostPaths(mod)
        installSocketHost(mod, callbacks)
      },
    ],
  })

  const returned = module.callMain([...data.argv])
  if (typeof returned === 'number') exitCode = returned
  flush('stdout')
  flush('stderr')
  for (const callback of callbacks) module.removeFunction(callback)
  port.postMessage({
    type: 'result',
    exitCode,
  } satisfies NativeToolWorkerMessage)

  function outputByte(stream: 'stdout' | 'stderr', byte: number | null): void {
    if (byte === null) {
      flush(stream)
      return
    }
    output[stream].push(byte)
    if (byte === 10 || output[stream].length >= RESPONSE_CHUNK_BYTES)
      flush(stream)
  }

  function outputText(stream: 'stdout' | 'stderr', text: string): void {
    flush(stream)
    const bytes = new TextEncoder().encode(`${text}\n`)
    streamRequest(stream, bytes)
  }

  function flush(stream: 'stdout' | 'stderr'): void {
    const pending = output[stream]
    if (pending.length === 0) return
    output[stream] = []
    streamRequest(stream, Uint8Array.from(pending))
  }
}

function mountHostPaths(module: ToolModule): void {
  const nodefs = module.FS.filesystems.NODEFS
  if (!nodefs) return
  const roots = new Set<string>()
  if (data.cwd) roots.add(data.cwd)
  for (const name of ['HOME', 'PGPASSFILE', 'PGSERVICEFILE', 'PGSYSCONFDIR']) {
    const value = data.env[name]
    if (!value || !value.startsWith('/')) continue
    roots.add(
      name === 'HOME' || name === 'PGSYSCONFDIR' ? value : dirname(value),
    )
  }
  for (const root of [...roots].sort(
    (left, right) => left.length - right.length,
  )) {
    if (
      [...roots].some(
        (parent) => parent !== root && root.startsWith(`${parent}/`),
      )
    )
      continue
    module.FS.mkdirTree(root)
    module.FS.mount(nodefs, { root }, root)
  }
  if (data.cwd) {
    module.ENV.PWD = data.cwd
    module.FS.chdir(data.cwd)
  }
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

function installSocketHost(module: ToolModule, callbacks: number[]): void {
  let nextDescriptor = SOCKET_DESCRIPTOR_BASE
  const add = (callback: CallableFunction, signature: string): number => {
    const pointer = module.addFunction(callback, signature)
    callbacks.push(pointer)
    return pointer
  }
  const createSocket = add(() => nextDescriptor++, 'iiii')
  const connectSocket = add(
    (descriptor: number, pointer: number, length: number) => {
      try {
        const address = decodeAddress(module.HEAPU8.buffer, pointer, length)
        const response = request({
          type: 'socket-connect',
          descriptor,
          address,
        })
        return resultOrErrno(module, response.status)
      } catch {
        return fail(module, 22)
      }
    },
    'iipi',
  )
  const closeSocket = add((descriptor: number) => {
    if (descriptor < SOCKET_DESCRIPTOR_BASE) return -2
    const response = request({ type: 'socket-close', descriptor })
    return resultOrErrno(module, response.status)
  }, 'ii')
  const receiveSocket = add(
    (descriptor: number, pointer: number, maximum: number) => {
      const response = request(
        { type: 'socket-receive', descriptor, maximum },
        Math.min(maximum, RESPONSE_CHUNK_BYTES),
      )
      if (response.status < 0) return fail(module, -response.status)
      module.HEAPU8.set(response.bytes.subarray(0, response.length), pointer)
      return response.length
    },
    'iipii',
  )
  const sendSocket = add(
    (descriptor: number, pointer: number, length: number) => {
      const bytes = module.HEAPU8.slice(pointer, pointer + length)
      const response = request({ type: 'socket-send', descriptor, data: bytes })
      if (response.status < 0) return fail(module, -response.status)
      return response.length
    },
    'iipii',
  )
  const pollSockets = add((pointer: number, count: number, timeout: number) => {
    const view = new DataView(module.HEAPU8.buffer)
    const descriptors: PollDescriptor[] = []
    for (let index = 0; index < count; index++) {
      const base = pointer + index * POLLFD_BYTES
      descriptors.push({
        descriptor: view.getInt32(base, true),
        events: view.getInt16(base + 4, true),
      })
    }
    const response = request(
      { type: 'socket-poll', descriptors, timeout },
      count * 2,
      timeout < 0 ? undefined : timeout + 30_000,
    )
    if (response.status < 0) return fail(module, -response.status)
    const returned = new DataView(
      response.bytes.buffer,
      response.bytes.byteOffset,
      response.bytes.byteLength,
    )
    for (let index = 0; index < count; index++) {
      view.setInt16(
        pointer + index * POLLFD_BYTES + 6,
        returned.getInt16(index * 2, true),
        true,
      )
    }
    return response.length
  }, 'ipii')
  module._pgl_set_socket_host(
    createSocket,
    connectSocket,
    0,
    0,
    0,
    closeSocket,
    receiveSocket,
    sendSocket,
    pollSockets,
    0,
  )
}

type RequestBase =
  | { readonly type: 'stdin' }
  | {
      readonly type: 'socket-connect'
      readonly descriptor: number
      readonly address: SocketAddress
    }
  | {
      readonly type: 'socket-send'
      readonly descriptor: number
      readonly data: Uint8Array
    }
  | {
      readonly type: 'socket-receive'
      readonly descriptor: number
      readonly maximum: number
    }
  | {
      readonly type: 'socket-poll'
      readonly descriptors: readonly PollDescriptor[]
      readonly timeout: number
    }
  | { readonly type: 'socket-close'; readonly descriptor: number }

function request(
  operation: RequestBase,
  payloadBytes = RESPONSE_CHUNK_BYTES,
  waitMilliseconds = 30_000,
): {
  readonly status: number
  readonly length: number
  readonly bytes: Uint8Array
} {
  const response = new SharedArrayBuffer(
    RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT + payloadBytes,
  )
  port.postMessage({ ...operation, response } satisfies NativeToolWorkerMessage)
  const words = new Int32Array(response, 0, RESPONSE_HEADER_WORDS)
  const result = Atomics.wait(words, RESPONSE_STATE, 0, waitMilliseconds)
  if (result === 'timed-out')
    throw new Error(`${operation.type} host request timed out`)
  return {
    status: Atomics.load(words, RESPONSE_STATUS),
    length: Atomics.load(words, RESPONSE_LENGTH),
    bytes: new Uint8Array(
      response,
      RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
    ),
  }
}

function streamRequest(type: 'stdout' | 'stderr', data: Uint8Array): void {
  const response = new SharedArrayBuffer(
    RESPONSE_HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT,
  )
  port.postMessage({ type, data, response } satisfies NativeToolWorkerMessage)
  const words = new Int32Array(response)
  if (Atomics.wait(words, RESPONSE_STATE, 0, 30_000) === 'timed-out')
    throw new Error(`${type} host request timed out`)
  if (Atomics.load(words, RESPONSE_STATUS) < 0)
    throw new Error(`${type} stream rejected a write`)
}

function resultOrErrno(module: ToolModule, status: number): number {
  return status < 0 ? fail(module, -status) : status
}

function fail(module: ToolModule, errno: number): -1 {
  const pointer = module.___errno_location()
  new Int32Array(module.HEAPU8.buffer)[pointer >> 2] = errno
  return -1
}

function decodeAddress(
  memory: ArrayBufferLike,
  pointer: number,
  length: number,
): SocketAddress {
  if (pointer < 0 || length < 2 || pointer + length > memory.byteLength)
    throw new RangeError('invalid socket address')
  const view = new DataView(memory as ArrayBuffer, pointer, length)
  const bytes = new Uint8Array(memory as ArrayBuffer, pointer, length)
  const family = view.getUint16(0, true)
  if (family === AF_INET && length >= 16) {
    return {
      transport: 'tcp',
      port: view.getUint16(2, false),
      host: `${bytes[4]}.${bytes[5]}.${bytes[6]}.${bytes[7]}`,
    }
  }
  if (family === AF_INET6 && length >= 28) {
    const words: string[] = []
    for (let offset = 8; offset < 24; offset += 2)
      words.push(view.getUint16(offset, false).toString(16))
    return {
      transport: 'tcp',
      port: view.getUint16(2, false),
      host: words.join(':'),
    }
  }
  if (family === AF_UNIX && length <= 110) {
    let end = 2
    while (end < length && bytes[end] !== 0) end++
    if (end === 2) throw new RangeError('empty Unix socket path')
    return { transport: 'unix', path: decoder.decode(bytes.subarray(2, end)) }
  }
  throw new RangeError(`unsupported socket family ${family}`)
}
