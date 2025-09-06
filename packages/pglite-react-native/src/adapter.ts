import {
  BasePGlite,
  type DebugLevel,
  type ExecProtocolOptions,
  type ExecProtocolResult,
  type Transaction,
} from '@electric-sql/pglite-base'
import { Parser } from '@electric-sql/pg-protocol'
import { Mutex } from 'async-mutex'

import { getPGLiteNative } from './nativeBridge'

// Utility for debugging protocol messages (kept minimal for mobile debugging)
function debugDumpWire(prefix: string, buf: Uint8Array) {
  if (!console.log) return // Skip if no console available

  try {
    console.log(`[PGL RN] ${prefix} total=${buf.byteLength} bytes`)
    // Just log basic info - detailed protocol inspection is handled by BasePGlite
  } catch (e) {
    // Silently ignore debug failures
  }
}

/**
 * React Native PGlite implementation that extends BasePGlite
 * This maintains the exact JS API parity with the web build.
 */
export class PGliteReactNative extends BasePGlite {
  readonly debug: DebugLevel = 0

  #closed = false
  #queryMutex = new Mutex()
  #transactionMutex = new Mutex()
  #listenMutex = new Mutex()
  #protocolParser = new Parser()

  readonly waitReady: Promise<void>

  readonly ready = true
  readonly closed = false
  readonly Module: any = null // Not applicable for native implementation

  constructor() {
    super()
    // Initialize the native backend and set up ready promise
    this.waitReady = this.#init()
  }

  async #init(): Promise<void> {
    // Native backend initialization is handled by the native side
    // Initialize array types for proper serialization/parsing
    await this._initArrayTypes()
  }

  // Implementation of BasePGlite abstract methods

  async close(): Promise<void> {
    if (this.#closed) return
    await getPGLiteNative().close()
    this.#closed = true
  }

  async syncToFs(): Promise<void> {
    // No-op for now (native fsyncs are implicit); preserve option for strict durability later
  }

  async _handleBlob(_blob?: File | Blob): Promise<void> {
    // Mobile doesn't support blob handling yet
  }

  async _getWrittenBlob(): Promise<File | Blob | undefined> {
    return undefined
  }

  async _cleanupBlob(): Promise<void> {
    // No-op for mobile
  }

  async _checkReady(): Promise<void> {
    await this.waitReady
  }

  async _runExclusiveQuery<T>(fn: () => Promise<T>): Promise<T> {
    return await this.#queryMutex.runExclusive(fn)
  }

  async _runExclusiveTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return await this.#transactionMutex.runExclusive(fn)
  }

  // Additional required methods for full interface compatibility

  async listen(
    channel: string,
    callback: (payload: string) => void,
    tx?: Transaction,
  ): Promise<() => Promise<void>> {
    return this.#listenMutex.runExclusive(async () => {
      // On RN we rely on protocol notifications; BasePGlite manages listeners.
      // The SQL LISTEN command itself is issued from BasePGlite higher-level calls.
      return async () => {
        await this.unlisten(channel, callback, tx)
      }
    })
  }

  async unlisten(
    _channel: string,
    _callback?: (payload: string) => void,
    _tx?: Transaction,
  ): Promise<void> {
    // Implementation handled by higher-level BasePGlite notification system
  }

  onNotification(
    _callback: (channel: string, payload: string) => void,
  ): () => void {
    // Return a no-op unsubscribe function for now
    return () => {}
  }

  offNotification(_callback: (channel: string, payload: string) => void): void {
    // No-op for now
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return await this._runExclusiveQuery(fn)
  }

  async describeQuery(_query: string): Promise<any> {
    throw new Error('describeQuery not implemented for React Native yet')
  }

  async dumpDataDir(_compression?: any): Promise<File | Blob> {
    throw new Error('dumpDataDir not implemented for React Native')
  }

  async execProtocolRaw(
    message: Uint8Array,
    { syncToFs = true }: ExecProtocolOptions = {},
  ): Promise<Uint8Array> {
    // Nitro requires a real ArrayBuffer. Use zero-copy when aligned and non-shared; otherwise copy.
    const view =
      message.byteOffset === 0 &&
      message.byteLength === message.buffer.byteLength
        ? message
        : new Uint8Array(
            message.buffer.slice(
              message.byteOffset,
              message.byteOffset + message.byteLength,
            ),
          )

    // Ensure we pass ArrayBuffer (not SharedArrayBuffer) to Nitro
    let ab: ArrayBuffer
    const bufLike = view.buffer
    if (
      bufLike instanceof ArrayBuffer &&
      view.byteOffset === 0 &&
      view.byteLength === bufLike.byteLength
    ) {
      ab = bufLike
    } else {
      // Copy into a new ArrayBuffer to guarantee the correct type and tight view
      ab = new ArrayBuffer(view.byteLength)
      new Uint8Array(ab).set(view)
    }
    try {
      const resultAb = await getPGLiteNative().execProtocolRaw(ab, { syncToFs })
      // Wrap back into Uint8Array without copying
      return new Uint8Array(resultAb)
    } catch (error) {
      console.error('[PGL RN] Native call failed:', error)
      throw error
    }
  }

  async execProtocol(
    message: Uint8Array,
    { syncToFs = true, onNotice }: ExecProtocolOptions = {},
  ): Promise<ExecProtocolResult> {
    const data = await this.execProtocolRaw(message, { syncToFs })
    const results: any[] = []

    if (this.debug > 0) {
      debugDumpWire('recv', data)
    }

    try {
      // Reset parser for each new protocol session to ensure clean state
      this.#protocolParser = new Parser()
      this.#protocolParser.parse(data, (msg: any) => {
        results.push(msg)
        // Handle errors and notices like the web version
        if (msg.name === 'error') {
          throw msg // Throw PostgreSQL errors as exceptions
        }
        if (msg.name === 'notice' && onNotice) onNotice(msg as any)
      })
    } catch (error: unknown) {
      if (this.debug > 0) {
        console.error('[PGL RN] Protocol parser error:', error)
      }
      throw error
    }
    return { messages: results, data }
  }
}
