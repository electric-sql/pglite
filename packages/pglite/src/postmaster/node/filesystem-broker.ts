import { Buffer } from 'node:buffer'
import {
  BaseFilesystem,
  ERRNO_CODES,
  type Filesystem,
  type FsStats,
} from '../../fs/base.js'
import type { PGlite } from '../../pglite.js'
import type { ProcessHandle } from '../shared/control.js'

const HEADER_WORDS = 16
const HEADER_BYTES = HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT
const CHANNEL_BYTES = 64 * 1024
const IO_CHUNK_BYTES = 48 * 1024

enum ChannelWord {
  State = 0,
  Sequence = 1,
  RequestMetadataBytes = 2,
  RequestDataBytes = 3,
  ResponseMetadataBytes = 4,
  ResponseDataBytes = 5,
}

enum ChannelState {
  Idle = 0,
  Request = 1,
  Response = 2,
  Closed = 3,
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export interface BrokeredFilesystemBackend extends Filesystem {
  chmod(path: string, mode: number): void
  close(fd: number): void
  fstat(fd: number): FsStats
  lstat(path: string): FsStats
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void
  open(path: string, flags?: string, mode?: number): number
  readdir(path: string): string[]
  read(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number
  rename(oldPath: string, newPath: string): void
  rmdir(path: string): void
  truncate(path: string, len: number): void
  unlink(path: string): void
  utimes(path: string, atime: number, mtime: number): void
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string; mode?: number; flag?: string },
  ): void
  write(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number
}

export interface BrokeredFilesystemChannel {
  readonly buffer: SharedArrayBuffer
}

export interface BrokeredFilesystemDiagnostics {
  readonly requests: number
  readonly failedRequests: number
  readonly handlesOpened: number
  readonly handlesClosed: number
  readonly liveChannels: number
  readonly liveHandles: number
}

interface BrokerChannelRecord {
  readonly handle: ProcessHandle
  readonly channel: BrokeredFilesystemChannel
  readonly descriptors: Map<number, number>
  nextDescriptor: number
}

interface BrokerRequest {
  readonly operation: string
  readonly arguments: unknown[]
}

interface BrokerResponse {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: SerializedError
}

interface SerializedError {
  readonly name: string
  readonly message: string
  readonly code?: string | number
  readonly errno?: string | number
}

interface BrokerResult {
  readonly value?: unknown
  readonly data?: Uint8Array
}

/** Supervisor-owned synchronous adapter for an ordinary PGlite BaseFilesystem. */
export class BrokeredFilesystemHost {
  private readonly channels = new Map<string, BrokerChannelRecord>()
  private closed = false
  private requests = 0
  private failedRequests = 0
  private handlesOpened = 0
  private handlesClosed = 0

  constructor(private readonly backend: BrokeredFilesystemBackend) {}

  attach(handle: ProcessHandle): BrokeredFilesystemChannel {
    if (this.closed) throw new Error('PGlite filesystem broker is closed')
    const key = processKey(handle)
    if (this.channels.has(key)) {
      throw new Error(`filesystem broker already has process ${key}`)
    }
    const channel = { buffer: new SharedArrayBuffer(CHANNEL_BYTES) }
    this.channels.set(key, {
      handle,
      channel,
      descriptors: new Map(),
      nextDescriptor: 1,
    })
    return channel
  }

  dispatch(handle: ProcessHandle, sequence: number): void {
    const record = this.channels.get(processKey(handle))
    if (!record) return
    const words = channelWords(record.channel)
    if (
      Atomics.load(words, ChannelWord.State) !== ChannelState.Request ||
      Atomics.load(words, ChannelWord.Sequence) !== sequence
    ) {
      this.writeResponse(record.channel, {
        ok: false,
        error: serializeError(
          new Error('stale or malformed PGlite filesystem broker request'),
        ),
      })
      return
    }

    this.requests++
    try {
      const { request, data } = readRequest(record.channel)
      const result = this.execute(record, request, data)
      this.writeResponse(
        record.channel,
        { ok: true, value: result.value },
        result.data,
      )
    } catch (error) {
      this.failedRequests++
      this.writeResponse(record.channel, {
        ok: false,
        error: serializeError(error),
      })
    }
  }

  detach(handle: ProcessHandle): void {
    const key = processKey(handle)
    const record = this.channels.get(key)
    if (!record) return
    this.channels.delete(key)
    for (const descriptor of record.descriptors.values()) {
      try {
        this.backend.close(descriptor)
      } catch {
        this.failedRequests++
      }
      this.handlesClosed++
    }
    record.descriptors.clear()
    const words = channelWords(record.channel)
    Atomics.store(words, ChannelWord.State, ChannelState.Closed)
    Atomics.notify(words, ChannelWord.State)
  }

  diagnostics(): BrokeredFilesystemDiagnostics {
    return {
      requests: this.requests,
      failedRequests: this.failedRequests,
      handlesOpened: this.handlesOpened,
      handlesClosed: this.handlesClosed,
      liveChannels: this.channels.size,
      liveHandles: [...this.channels.values()].reduce(
        (total, channel) => total + channel.descriptors.size,
        0,
      ),
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const record of [...this.channels.values()]) {
      this.detach(record.handle)
    }
    let syncError: unknown
    try {
      await this.backend.syncToFs()
    } catch (error) {
      syncError = error
    }
    try {
      await this.backend.closeFs()
    } catch (closeError) {
      if (syncError !== undefined) {
        const combined = new Error(
          'PGlite filesystem broker sync and close both failed',
        ) as Error & { errors: unknown[] }
        combined.errors = [syncError, closeError]
        throw combined
      }
      throw closeError
    }
    if (syncError !== undefined) throw syncError
  }

  private execute(
    record: BrokerChannelRecord,
    request: BrokerRequest,
    data: Uint8Array,
  ): BrokerResult {
    const args = request.arguments
    switch (request.operation) {
      case 'chmod':
        this.backend.chmod(stringArg(args, 0), numberArg(args, 1))
        return {}
      case 'close': {
        const local = numberArg(args, 0)
        const descriptor = this.descriptor(record, local)
        try {
          this.backend.close(descriptor)
        } finally {
          record.descriptors.delete(local)
          this.handlesClosed++
        }
        return {}
      }
      case 'fstat':
        return {
          value: this.backend.fstat(
            this.descriptor(record, numberArg(args, 0)),
          ),
        }
      case 'lstat':
        return { value: this.backend.lstat(stringArg(args, 0)) }
      case 'mkdir':
        this.backend.mkdir(
          stringArg(args, 0),
          objectArg(args, 1) as
            | { recursive?: boolean; mode?: number }
            | undefined,
        )
        return {}
      case 'open': {
        const descriptor = this.backend.open(
          stringArg(args, 0),
          optionalStringArg(args, 1),
          optionalNumberArg(args, 2),
        )
        const local = record.nextDescriptor++
        record.descriptors.set(local, descriptor)
        this.handlesOpened++
        return { value: local }
      }
      case 'readdir':
        return { value: this.backend.readdir(stringArg(args, 0)) }
      case 'read': {
        const length = boundedLength(numberArg(args, 1))
        const target = new Uint8Array(length)
        const count = this.backend.read(
          this.descriptor(record, numberArg(args, 0)),
          target,
          0,
          length,
          numberArg(args, 2),
        )
        if (!Number.isInteger(count) || count < 0 || count > length) {
          throw new Error('brokered filesystem returned an invalid read count')
        }
        return { value: count, data: target.subarray(0, count) }
      }
      case 'rename':
        this.backend.rename(stringArg(args, 0), stringArg(args, 1))
        return {}
      case 'rmdir':
        this.backend.rmdir(stringArg(args, 0))
        return {}
      case 'truncate':
        this.backend.truncate(stringArg(args, 0), numberArg(args, 1))
        return {}
      case 'unlink':
        this.backend.unlink(stringArg(args, 0))
        return {}
      case 'utimes':
        this.backend.utimes(
          stringArg(args, 0),
          numberArg(args, 1),
          numberArg(args, 2),
        )
        return {}
      case 'writeFile': {
        const kind = stringArg(args, 1)
        this.backend.writeFile(
          stringArg(args, 0),
          kind === 'string' ? textDecoder.decode(data) : data,
          objectArg(args, 2) as
            | { encoding?: string; mode?: number; flag?: string }
            | undefined,
        )
        return {}
      }
      case 'write': {
        const count = this.backend.write(
          this.descriptor(record, numberArg(args, 0)),
          data,
          0,
          data.byteLength,
          numberArg(args, 1),
        )
        if (!Number.isInteger(count) || count < 0 || count > data.byteLength) {
          throw new Error('brokered filesystem returned an invalid write count')
        }
        return { value: count }
      }
      default:
        throw new Error(
          `unsupported PGlite filesystem broker operation: ${request.operation}`,
        )
    }
  }

  private descriptor(record: BrokerChannelRecord, local: number): number {
    const descriptor = record.descriptors.get(local)
    if (descriptor === undefined) {
      throw filesystemError(ERRNO_CODES.EBADF, 'Bad file descriptor')
    }
    return descriptor
  }

  private writeResponse(
    channel: BrokeredFilesystemChannel,
    response: BrokerResponse,
    data: Uint8Array = new Uint8Array(),
  ): void {
    let metadata = textEncoder.encode(JSON.stringify(response))
    if (metadata.byteLength + data.byteLength > payload(channel).byteLength) {
      data = new Uint8Array()
      metadata = textEncoder.encode(
        JSON.stringify({
          ok: false,
          error: serializeError(
            new RangeError('PGlite filesystem broker response is too large'),
          ),
        } satisfies BrokerResponse),
      )
    }
    const bytes = payload(channel)
    bytes.set(metadata, 0)
    bytes.set(data, metadata.byteLength)
    const words = channelWords(channel)
    Atomics.store(words, ChannelWord.ResponseMetadataBytes, metadata.byteLength)
    Atomics.store(words, ChannelWord.ResponseDataBytes, data.byteLength)
    Atomics.store(words, ChannelWord.State, ChannelState.Response)
    Atomics.notify(words, ChannelWord.State)
  }
}

/** Worker-local BaseFilesystem facade backed by a supervisor SAB channel. */
export class BrokeredFilesystem extends BaseFilesystem {
  private sequence = 0

  constructor(
    dataDir: string,
    private readonly channel: BrokeredFilesystemChannel,
    private readonly notify: (sequence: number) => void,
    debug = false,
  ) {
    super(dataDir, { debug })
  }

  chmod(path: string, mode: number): void {
    this.request('chmod', [path, mode])
  }

  close(fd: number): void {
    this.request('close', [fd])
  }

  fstat(fd: number): FsStats {
    return this.request('fstat', [fd]).value as FsStats
  }

  lstat(path: string): FsStats {
    return this.request('lstat', [path]).value as FsStats
  }

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void {
    this.request('mkdir', [path, options])
  }

  open(path: string, flags?: string, mode?: number): number {
    return numberResult(this.request('open', [path, flags, mode]).value)
  }

  readdir(path: string): string[] {
    const value = this.request('readdir', [path]).value
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === 'string')
    ) {
      throw new Error('brokered filesystem returned an invalid directory list')
    }
    return value
  }

  read(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number {
    let total = 0
    while (total < length) {
      const requestLength = Math.min(length - total, IO_CHUNK_BYTES)
      const response = this.request('read', [
        fd,
        requestLength,
        position + total,
      ])
      const count = numberResult(response.value)
      if (count > response.data.byteLength || count > requestLength) {
        throw new Error('brokered filesystem returned invalid read data')
      }
      buffer.set(response.data.subarray(0, count), offset + total)
      total += count
      if (count < requestLength) break
    }
    return total
  }

  rename(oldPath: string, newPath: string): void {
    this.request('rename', [oldPath, newPath])
  }

  rmdir(path: string): void {
    this.request('rmdir', [path])
  }

  truncate(path: string, len: number): void {
    this.request('truncate', [path, len])
  }

  unlink(path: string): void {
    this.request('unlink', [path])
  }

  utimes(path: string, atime: number, mtime: number): void {
    this.request('utimes', [path, atime, mtime])
  }

  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string; mode?: number; flag?: string },
  ): void {
    const bytes =
      typeof data === 'string'
        ? Buffer.from(data, (options?.encoding ?? 'utf8') as BufferEncoding)
        : data
    if (bytes.byteLength > IO_CHUNK_BYTES) {
      const descriptor = this.open(path, options?.flag ?? 'w', options?.mode)
      try {
        let position = 0
        while (position < bytes.byteLength) {
          const count = this.write(
            descriptor,
            bytes,
            position,
            bytes.byteLength - position,
            position,
          )
          if (count === 0) {
            throw new Error('brokered filesystem writeFile made no progress')
          }
          position += count
        }
      } finally {
        this.close(descriptor)
      }
      return
    }
    this.request(
      'writeFile',
      [path, typeof data === 'string' ? 'string' : 'bytes', options],
      bytes,
    )
  }

  write(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number {
    const bytes = byteView(buffer)
    let total = 0
    while (total < length) {
      const requestLength = Math.min(length - total, IO_CHUNK_BYTES)
      const chunk = bytes.subarray(
        offset + total,
        offset + total + requestLength,
      )
      const count = numberResult(
        this.request('write', [fd, position + total], chunk).value,
      )
      total += count
      if (count < requestLength) break
    }
    return total
  }

  async closeFs(): Promise<void> {
    this.pg?.Module.FS.quit()
  }

  private request(
    operation: string,
    args: unknown[],
    data: Uint8Array = new Uint8Array(),
  ): { value?: unknown; data: Uint8Array } {
    const request = textEncoder.encode(
      JSON.stringify({ operation, arguments: args } satisfies BrokerRequest),
    )
    const bytes = payload(this.channel)
    if (request.byteLength + data.byteLength > bytes.byteLength) {
      throw new RangeError('PGlite filesystem broker request is too large')
    }
    const words = channelWords(this.channel)
    if (Atomics.load(words, ChannelWord.State) !== ChannelState.Idle) {
      throw new Error('PGlite filesystem broker channel is busy')
    }
    this.sequence++
    bytes.set(request, 0)
    bytes.set(data, request.byteLength)
    Atomics.store(words, ChannelWord.Sequence, this.sequence)
    Atomics.store(words, ChannelWord.RequestMetadataBytes, request.byteLength)
    Atomics.store(words, ChannelWord.RequestDataBytes, data.byteLength)
    // Publishing Request is the release operation. The supervisor cannot
    // observe a partially populated payload or stale request metadata.
    Atomics.store(words, ChannelWord.State, ChannelState.Request)
    this.notify(this.sequence)

    while (Atomics.load(words, ChannelWord.State) === ChannelState.Request) {
      Atomics.wait(words, ChannelWord.State, ChannelState.Request)
    }
    const state = Atomics.load(words, ChannelWord.State)
    if (state === ChannelState.Closed) {
      throw new Error('PGlite filesystem broker channel closed')
    }
    if (state !== ChannelState.Response) {
      throw new Error('PGlite filesystem broker returned an invalid state')
    }

    const metadataLength = Atomics.load(
      words,
      ChannelWord.ResponseMetadataBytes,
    )
    const dataLength = Atomics.load(words, ChannelWord.ResponseDataBytes)
    assertPayloadLengths(this.channel, metadataLength, dataLength)
    const response = JSON.parse(
      textDecoder.decode(bytes.subarray(0, metadataLength)),
    ) as BrokerResponse
    const responseData = bytes.slice(
      metadataLength,
      metadataLength + dataLength,
    )
    Atomics.store(words, ChannelWord.State, ChannelState.Idle)
    if (!response.ok) throw deserializeError(response.error)
    return { value: response.value, data: responseData }
  }
}

export function isBrokeredFilesystemBackend(
  filesystem: Filesystem,
): filesystem is BrokeredFilesystemBackend {
  const candidate = filesystem as unknown as Record<string, unknown>
  return [
    'chmod',
    'close',
    'fstat',
    'lstat',
    'mkdir',
    'open',
    'readdir',
    'read',
    'rename',
    'rmdir',
    'truncate',
    'unlink',
    'utimes',
    'writeFile',
    'write',
  ].every((method) => typeof candidate[method] === 'function')
}

/** Keep a broker backing object alive after the single-user initdb runtime exits. */
export function initializerFilesystem(
  backend: BrokeredFilesystemBackend,
): Filesystem {
  // PGlite may recursively create a no-initdb instance with the same
  // Filesystem while bootstrapping a fresh cluster. Calls to closeFs have no
  // instance argument, but they are nested in LIFO order. Pop before awaiting
  // so an intentionally un-awaited inner close cannot race the outer close.
  const instances: PGlite[] = []
  return {
    async init(instance, options) {
      instances.push(instance)
      return backend.init(instance, options)
    },
    initialSyncFs: () => backend.initialSyncFs(),
    syncToFs: (relaxed) => backend.syncToFs(relaxed),
    dumpTar: (dbname, compression) => backend.dumpTar(dbname, compression),
    async closeFs() {
      const instance = instances.pop()
      try {
        await backend.syncToFs()
      } finally {
        instance?.Module.FS.quit()
      }
    },
  }
}

function readRequest(channel: BrokeredFilesystemChannel): {
  request: BrokerRequest
  data: Uint8Array
} {
  const words = channelWords(channel)
  const metadataLength = Atomics.load(words, ChannelWord.RequestMetadataBytes)
  const dataLength = Atomics.load(words, ChannelWord.RequestDataBytes)
  assertPayloadLengths(channel, metadataLength, dataLength)
  const bytes = payload(channel)
  const request = JSON.parse(
    textDecoder.decode(bytes.subarray(0, metadataLength)),
  ) as BrokerRequest
  if (
    !request ||
    typeof request.operation !== 'string' ||
    !Array.isArray(request.arguments)
  ) {
    throw new TypeError('invalid PGlite filesystem broker request')
  }
  return {
    request,
    data: bytes.slice(metadataLength, metadataLength + dataLength),
  }
}

function channelWords(channel: BrokeredFilesystemChannel): Int32Array {
  return new Int32Array(channel.buffer, 0, HEADER_WORDS)
}

function payload(channel: BrokeredFilesystemChannel): Uint8Array {
  return new Uint8Array(channel.buffer, HEADER_BYTES)
}

function assertPayloadLengths(
  channel: BrokeredFilesystemChannel,
  metadata: number,
  data: number,
): void {
  if (
    !Number.isInteger(metadata) ||
    !Number.isInteger(data) ||
    metadata < 0 ||
    data < 0 ||
    metadata + data > payload(channel).byteLength
  ) {
    throw new RangeError('invalid PGlite filesystem broker payload lengths')
  }
}

function processKey(handle: ProcessHandle): string {
  return `${handle.pid}:${handle.generation}`
}

function stringArg(args: unknown[], index: number): string {
  const value = args[index]
  if (typeof value !== 'string') throw new TypeError('expected string argument')
  return value
}

function optionalStringArg(args: unknown[], index: number): string | undefined {
  const value = args[index]
  if (value === undefined || value === null) return undefined
  return stringArg(args, index)
}

function numberArg(args: unknown[], index: number): number {
  const value = args[index]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('expected finite number argument')
  }
  return value
}

function optionalNumberArg(args: unknown[], index: number): number | undefined {
  const value = args[index]
  if (value === undefined || value === null) return undefined
  return numberArg(args, index)
}

function objectArg(
  args: unknown[],
  index: number,
): Record<string, unknown> | undefined {
  const value = args[index]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('expected object argument')
  }
  return value as Record<string, unknown>
}

function boundedLength(length: number): number {
  if (!Number.isInteger(length) || length < 0 || length > IO_CHUNK_BYTES) {
    throw new RangeError('invalid PGlite filesystem broker I/O length')
  }
  return length
}

function numberResult(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('brokered filesystem returned an invalid number')
  }
  return value
}

function byteView(
  value: Uint8Array | ArrayBuffer | SharedArrayBuffer,
): Uint8Array {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    return new Uint8Array(value)
  }
  throw new TypeError('brokered filesystem received an invalid byte buffer')
}

function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) }
  }
  const record = error as Error & {
    code?: string | number
    errno?: string | number
  }
  return {
    name: error.name,
    message: error.message,
    ...(record.code === undefined ? {} : { code: record.code }),
    ...(record.errno === undefined ? {} : { errno: record.errno }),
  }
}

function deserializeError(serialized: SerializedError | undefined): Error {
  const error = new Error(
    serialized?.message ?? 'PGlite filesystem broker error',
  )
  error.name = serialized?.name ?? 'Error'
  if (serialized?.code !== undefined) {
    ;(error as Error & { code?: string | number }).code = serialized.code
  }
  if (serialized?.errno !== undefined) {
    ;(error as Error & { errno?: string | number }).errno = serialized.errno
  }
  return error
}

function filesystemError(code: number, message: string): Error {
  const error = new Error(message) as Error & { code: number }
  error.code = code
  return error
}
