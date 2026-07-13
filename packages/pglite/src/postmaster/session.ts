import { Mutex } from 'async-mutex'
import { BasePGlite } from '../base.js'
import type { DumpTarCompressionOptions } from '../fs/tarUtils.js'
import type {
  DebugLevel,
  ExecProtocolOptions,
  ExecProtocolOptionsStream,
  ExecProtocolResult,
  ParserOptions,
  PGliteInterface,
  SerializerOptions,
  Transaction,
} from '../interface.js'
import { pglUtils } from '@electric-sql/pglite-utils'
import { Parser as ProtocolParser, serialize } from '@electric-sql/pg-protocol'
import {
  DatabaseError,
  type BackendMessage,
  type NoticeMessage,
  type NotificationResponseMessage,
} from '@electric-sql/pg-protocol/messages'
import type { PGliteProtocolConnection } from './postmaster.js'

const FRONTEND_QUERY = 0x51
const FRONTEND_PARSE = 0x50
const FRONTEND_BIND = 0x42
const FRONTEND_EXECUTE = 0x45
const FRONTEND_SYNC = 0x53
const FRONTEND_DESCRIBE = 0x44
const FRONTEND_CLOSE = 0x43
const FRONTEND_COPY_DONE = 0x63
const FRONTEND_COPY_FAIL = 0x66
const FRONTEND_TERMINATE = 0x58

export interface PGlitePostmasterSessionOptions {
  readonly username?: string
  readonly database?: string
  readonly debug?: DebugLevel
  readonly parsers?: ParserOptions
  readonly serializers?: SerializerOptions
}

interface ExchangeResult {
  readonly messages: BackendMessage[]
  readonly data: Uint8Array
}

interface PendingExchange {
  readonly terminalCode: number | null
  readonly raw: Uint8Array[]
  readonly messages: BackendMessage[]
  readonly onRawData?: (data: Uint8Array) => void
  resolve(result: ExchangeResult): void
  reject(error: unknown): void
}

/** A normal PGlite client surface backed by one real PostgreSQL backend. */
export class PGlitePostmasterSession
  extends BasePGlite
  implements PGliteInterface, AsyncDisposable
{
  readonly waitReady: Promise<void>
  readonly debug: DebugLevel

  #ready = false
  #closing = false
  #closed = false
  #readerError: unknown
  #pending?: PendingExchange
  #protocolParser = new ProtocolParser()
  #wireMutex = new Mutex()
  #queryMutex = new Mutex()
  #transactionMutex = new Mutex()
  #listenMutex = new Mutex()
  #notifyListeners = new Map<string, Set<(payload: string) => void>>()
  #globalNotifyListeners = new Set<(channel: string, payload: string) => void>()

  private constructor(
    private readonly connection: PGliteProtocolConnection,
    options: PGlitePostmasterSessionOptions,
    private readonly onClose: (session: PGlitePostmasterSession) => void,
  ) {
    super()
    this.debug = options.debug ?? 0
    if (options.parsers) this.parsers = { ...this.parsers, ...options.parsers }
    if (options.serializers) {
      this.serializers = { ...this.serializers, ...options.serializers }
    }
    void this.#readLoop()
    this.waitReady = this.#initialize(options)
  }

  static async create(
    connection: PGliteProtocolConnection,
    options: PGlitePostmasterSessionOptions = {},
    onClose: (session: PGlitePostmasterSession) => void = () => {},
  ): Promise<PGlitePostmasterSession> {
    const session = new PGlitePostmasterSession(connection, options, onClose)
    try {
      await session.waitReady
      return session
    } catch (error) {
      connection.abort(error)
      throw error
    }
  }

  get ready(): boolean {
    return this.#ready && !this.#closing && !this.#closed
  }

  get closed(): boolean {
    return this.#closed
  }

  async close(): Promise<void> {
    if (this.#closed || this.#closing) return
    this.#closing = true
    try {
      await this.waitReady.catch(() => {})
      if (!this.#closed) {
        await this.connection.write(serialize.end())
        await this.connection.end()
        await this.connection.closed
      }
    } finally {
      this.connection.abort()
      this.#ready = false
      this.#closed = true
      this.#closing = false
      this.onClose(this)
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  async execProtocolRaw(
    message: Uint8Array,
    _options: ExecProtocolOptions = {},
  ): Promise<Uint8Array> {
    return (await this.#exchange(message)).data
  }

  async execProtocolRawStream(
    message: Uint8Array,
    { onRawData }: ExecProtocolOptionsStream,
  ): Promise<void> {
    await this.#exchange(message, onRawData)
  }

  async execProtocol(
    message: Uint8Array,
    options: ExecProtocolOptions = {},
  ): Promise<ExecProtocolResult> {
    const result = await this.#exchange(message)
    this.#handleMessages(result.messages, options)
    return result
  }

  async execProtocolStream(
    message: Uint8Array,
    options: ExecProtocolOptions = {},
  ): Promise<BackendMessage[]> {
    const result = await this.#exchange(message)
    this.#handleMessages(result.messages, options)
    return result.messages
  }

  async syncToFs(): Promise<void> {
    // NODEFS writes are direct. PostgreSQL owns fsync/checkpoint durability.
  }

  async _handleBlob(blob?: File | Blob): Promise<void> {
    if (blob) {
      throw new Error(
        'Blob-backed COPY is not yet available for postmaster sessions',
      )
    }
  }

  async _getWrittenBlob(): Promise<File | Blob | undefined> {
    return undefined
  }

  async _cleanupBlob(): Promise<void> {}

  async _checkReady(): Promise<void> {
    if (this.#closing) throw new Error('PGlite session is closing')
    if (this.#closed) throw new Error('PGlite session is closed')
    if (!this.#ready) await this.waitReady
  }

  _runExclusiveQuery<T>(fn: () => Promise<T>): Promise<T> {
    return this.#queryMutex.runExclusive(fn)
  }

  _runExclusiveTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.#transactionMutex.runExclusive(fn)
  }

  async listen(
    channel: string,
    callback: (payload: string) => void,
    tx?: Transaction,
  ): Promise<(tx?: Transaction) => Promise<void>> {
    return this.#listenMutex.runExclusive(async () => {
      const pgChannel = pglUtils.toPostgresName(channel)
      const listeners = this.#notifyListeners.get(pgChannel) ?? new Set()
      this.#notifyListeners.set(pgChannel, listeners)
      listeners.add(callback)
      try {
        await (tx ?? this).exec(`LISTEN ${channel}`)
      } catch (error) {
        listeners.delete(callback)
        if (listeners.size === 0) this.#notifyListeners.delete(pgChannel)
        throw error
      }
      return async (transaction?: Transaction) => {
        await this.unlisten(pgChannel, callback, transaction)
      }
    })
  }

  async unlisten(
    channel: string,
    callback?: (payload: string) => void,
    tx?: Transaction,
  ): Promise<void> {
    await this.#listenMutex.runExclusive(async () => {
      const pgChannel = pglUtils.toPostgresName(channel)
      const listeners = this.#notifyListeners.get(pgChannel)
      if (callback) listeners?.delete(callback)
      else listeners?.clear()
      if (!listeners || listeners.size === 0) {
        await (tx ?? this).exec(`UNLISTEN ${channel}`)
        this.#notifyListeners.delete(pgChannel)
      }
    })
  }

  onNotification(
    callback: (channel: string, payload: string) => void,
  ): () => void {
    this.#globalNotifyListeners.add(callback)
    return () => this.#globalNotifyListeners.delete(callback)
  }

  offNotification(callback: (channel: string, payload: string) => void): void {
    this.#globalNotifyListeners.delete(callback)
  }

  async dumpDataDir(
    _compression?: DumpTarCompressionOptions,
  ): Promise<File | Blob> {
    throw new Error(
      'A consistent live-cluster data-directory dump is not yet implemented',
    )
  }

  async #initialize(options: PGlitePostmasterSessionOptions): Promise<void> {
    const startup = serialize.startup({
      user: options.username ?? 'postgres',
      database: options.database ?? 'postgres',
    })
    const result = await this.#exchange(startup, undefined, null)
    const error = result.messages.find(
      (message): message is DatabaseError => message instanceof DatabaseError,
    )
    if (error) throw error
    if (
      !result.messages.some((message) => message.name === 'authenticationOk')
    ) {
      throw new Error('PostgreSQL startup did not authenticate the session')
    }
    this.#ready = true
    await this._initArrayTypes()
  }

  async #exchange(
    message: Uint8Array,
    onRawData?: (data: Uint8Array) => void,
    explicitTerminalCode?: number | null,
  ): Promise<ExchangeResult> {
    return this.#wireMutex.runExclusive(async () => {
      if (this.#readerError) throw this.#readerError
      if (this.#closed) throw new Error('PGlite session is closed')
      const terminalCode =
        explicitTerminalCode === undefined
          ? lastFrontendMessageCode(message)
          : explicitTerminalCode
      if (terminalCode === FRONTEND_TERMINATE) {
        throw new Error('Use close() to terminate a PGlite session')
      }
      const outbound = needsProtocolFlush(terminalCode)
        ? concatBytes([message, serialize.flush()])
        : message

      const response = new Promise<ExchangeResult>((resolve, reject) => {
        this.#pending = {
          terminalCode,
          raw: [],
          messages: [],
          onRawData,
          resolve,
          reject,
        }
      })
      try {
        await this.connection.write(outbound)
      } catch (error) {
        this.#pending = undefined
        throw error
      }
      return response
    })
  }

  async #readLoop(): Promise<void> {
    const decoder = new BackendFrameDecoder()
    try {
      for await (const chunk of this.connection.readable) {
        for (const raw of decoder.push(chunk)) this.#receiveFrame(raw)
      }
      decoder.finish()
      if (!this.#closing && !this.#closed) {
        throw new Error('PostgreSQL backend closed the session unexpectedly')
      }
    } catch (error) {
      this.#readerError = error
      this.#pending?.reject(error)
      this.#pending = undefined
    }
  }

  #receiveFrame(raw: Uint8Array): void {
    let message: BackendMessage | undefined
    this.#protocolParser.parse(raw, (parsed) => {
      message = parsed
    })
    if (!message)
      throw new Error('PostgreSQL protocol parser produced no frame')

    if (message.name === 'notification') {
      this.#receiveNotification(message as NotificationResponseMessage)
    }

    const pending = this.#pending
    if (!pending) {
      if (message.name === 'notice' && this.debug > 0) console.warn(message)
      return
    }
    pending.raw.push(raw)
    pending.messages.push(message)
    pending.onRawData?.(raw)
    if (isTerminalResponse(pending.terminalCode, message)) {
      this.#pending = undefined
      pending.resolve({
        messages: pending.messages,
        data: concatBytes(pending.raw),
      })
    }
  }

  #handleMessages(
    messages: readonly BackendMessage[],
    { throwOnError = true, onNotice }: ExecProtocolOptions,
  ): void {
    let databaseError: DatabaseError | undefined
    for (const message of messages) {
      if (message instanceof DatabaseError && !databaseError) {
        databaseError = message
      } else if (message.name === 'notice') {
        if (this.debug > 0) console.warn(message)
        onNotice?.(message as NoticeMessage)
      }
    }
    if (throwOnError && databaseError) throw databaseError
  }

  #receiveNotification(message: NotificationResponseMessage): void {
    for (const listener of this.#notifyListeners.get(message.channel) ?? []) {
      queueMicrotask(() => listener(message.payload))
    }
    for (const listener of this.#globalNotifyListeners) {
      queueMicrotask(() => listener(message.channel, message.payload))
    }
  }
}

class BackendFrameDecoder {
  #buffer = new Uint8Array()

  push(chunk: Uint8Array): Uint8Array[] {
    this.#buffer = concatBytes([this.#buffer, chunk])
    const frames: Uint8Array[] = []
    let offset = 0
    while (this.#buffer.byteLength - offset >= 5) {
      const view = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset + offset,
        this.#buffer.byteLength - offset,
      )
      const length = view.getUint32(1, false)
      if (length < 4) throw new Error('invalid PostgreSQL backend frame length')
      const frameLength = length + 1
      if (frameLength > 64 * 1024 * 1024) {
        throw new Error('PostgreSQL backend frame exceeds the 64 MiB limit')
      }
      if (this.#buffer.byteLength - offset < frameLength) break
      frames.push(this.#buffer.slice(offset, offset + frameLength))
      offset += frameLength
    }
    if (offset) this.#buffer = this.#buffer.slice(offset)
    return frames
  }

  finish(): void {
    if (this.#buffer.byteLength !== 0) {
      throw new Error('PostgreSQL backend closed with a truncated frame')
    }
  }
}

function lastFrontendMessageCode(message: Uint8Array): number {
  let offset = 0
  let last = -1
  while (offset < message.byteLength) {
    if (message.byteLength - offset < 5) {
      throw new Error('truncated PostgreSQL frontend message')
    }
    const length = new DataView(
      message.buffer,
      message.byteOffset + offset + 1,
      4,
    ).getUint32(0, false)
    if (length < 4 || offset + length + 1 > message.byteLength) {
      throw new Error('invalid PostgreSQL frontend message length')
    }
    last = message[offset]
    offset += length + 1
  }
  if (last < 0) throw new Error('empty PostgreSQL frontend message')
  return last
}

function isTerminalResponse(
  frontendCode: number | null,
  message: BackendMessage,
): boolean {
  if (message.name === 'error') return true
  if (frontendCode === null) return message.name === 'readyForQuery'
  switch (frontendCode) {
    case FRONTEND_QUERY:
    case FRONTEND_SYNC:
      return message.name === 'readyForQuery'
    case FRONTEND_PARSE:
      return message.name === 'parseComplete'
    case FRONTEND_BIND:
      return message.name === 'bindComplete'
    case FRONTEND_DESCRIBE:
      return message.name === 'rowDescription' || message.name === 'noData'
    case FRONTEND_EXECUTE:
      return (
        message.name === 'commandComplete' ||
        message.name === 'emptyQuery' ||
        message.name === 'portalSuspended' ||
        message.name === 'copyInResponse'
      )
    case FRONTEND_CLOSE:
      return message.name === 'closeComplete'
    case FRONTEND_COPY_DONE:
      return message.name === 'commandComplete'
    case FRONTEND_COPY_FAIL:
      return false
    default:
      throw new Error(
        `unsupported PostgreSQL frontend message: 0x${frontendCode.toString(16)}`,
      )
  }
}

function needsProtocolFlush(frontendCode: number | null): boolean {
  return (
    frontendCode === FRONTEND_PARSE ||
    frontendCode === FRONTEND_BIND ||
    frontendCode === FRONTEND_EXECUTE ||
    frontendCode === FRONTEND_DESCRIBE ||
    frontendCode === FRONTEND_CLOSE ||
    frontendCode === FRONTEND_COPY_DONE ||
    frontendCode === FRONTEND_COPY_FAIL
  )
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  )
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
