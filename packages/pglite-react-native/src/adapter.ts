import {
  Parser,
  serialize as protocolSerialize,
} from '@electric-sql/pg-protocol'
// Minimal local copies of types to avoid importing the full pglite interface (which pulls Node/Emscripten types)
export type DebugLevel = 0 | 1 | 2 | 3 | 4 | 5

import { getPGLiteNative } from './nativeBridge'

function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export interface ExecProtocolOptions {
  syncToFs?: boolean
  throwOnError?: boolean
  onNotice?: (notice: any) => void
  dataTransferContainer?: 'cma' | 'file'
}
export interface ExecProtocolResult {
  messages: any[]
  data: Uint8Array
}

/**
 * React Native adapter that reuses BasePGlite patterns and bridges execProtocol/Raw to Nitro.
 * This maintains the exact JS API parity with the web build.
 */
export class PGliteReactNative {
  readonly debug: DebugLevel = 0

  #closed = false
  #listenMutex = { runExclusive: async <T>(fn: () => Promise<T>) => await fn() }
  #protocolParser = new Parser()

  readonly waitReady: Promise<void> = Promise.resolve()
  #handshakeDone = false

  // Parameter serialization to strings as required by pg-protocol
  // Based on web PGlite serialization patterns but simplified for React Native
  private serializeParam(param: any): string {
    // Handle common JavaScript types, converting to strings as expected by pg-protocol
    if (typeof param === 'number') {
      // Numbers → strings (pg-protocol and PostgreSQL will handle type conversion)
      return param.toString()
    }
    if (typeof param === 'boolean') {
      // Booleans → PostgreSQL boolean format ('t' or 'f')
      return param ? 't' : 'f'
    }
    if (param instanceof Date) {
      // Dates → ISO strings (for TIMESTAMP type)
      return param.toISOString()
    }
    if (Array.isArray(param)) {
      // Arrays → PostgreSQL array format (simplified)
      return JSON.stringify(param)
    }
    if (typeof param === 'object' && param !== null) {
      // Objects → JSON strings (for JSON/JSONB types)
      return JSON.stringify(param)
    }
    // Everything else → string
    return param.toString()
  }

  // Determine the correct PostgreSQL OID for a parameter
  private getParamOid(param: any): number {
    if (param === null || param === undefined) {
      return 25 // TEXT - null values can be any type
    }
    if (typeof param === 'number') {
      return Number.isInteger(param) ? 23 : 701 // INT4 for integers, FLOAT8 for floats
    }
    if (typeof param === 'boolean') {
      return 16 // BOOL
    }
    if (param instanceof Date) {
      return 1184 // TIMESTAMPTZ
    }
    if (Array.isArray(param)) {
      return 114 // JSON (simplified approach for arrays)
    }
    if (typeof param === 'object') {
      return 114 // JSON
    }
    return 25 // TEXT for strings and everything else
  }

  // COMMENTED OUT: May be needed if BasePGlite doesn't handle startup properly
  // @ts-ignore - keeping for potential future use
  private async ensureStartup(syncToFs = true): Promise<void> {
    if (this.#handshakeDone) return
    // Send a startup packet to establish the session, mirroring web client handshake
    const startup = protocolSerialize.startup({
      user: 'postgres',
      database: 'template1',
    })
    const buf = concatBuffers(startup, protocolSerialize.sync())
    console.log('[PGL RN] startup send len=', buf.length)
    const data = await this.execProtocolRaw(buf, { syncToFs })
    console.log('[PGL RN] startup recv bytes=', data.length)
    const msgs: any[] = []
    const parser = new Parser()
    parser.parse(data, (m: any) => msgs.push(m))
    console.log(
      '[PGL RN] startup messages=',
      msgs.map((m: any) => m.name),
    )

    // If backend requested password (AuthenticationMD5 or similar), send password and Sync
    if (
      msgs.some(
        (m: any) =>
          m.name === 'authenticationMD5Password' ||
          m.name === 'authenticationCleartextPassword',
      )
    ) {
      const pass = concatBuffers(
        protocolSerialize.password('postgres'),
        protocolSerialize.sync(),
      )
      console.log('[PGL RN] password send len=', pass.length)
      const data2 = await this.execProtocolRaw(pass, { syncToFs })
      console.log('[PGL RN] password recv bytes=', data2.length)
      const msgs2: any[] = []
      const parser2 = new Parser()
      parser2.parse(data2, (m: any) => msgs2.push(m))
      console.log(
        '[PGL RN] password messages=',
        msgs2.map((m: any) => m.name),
      )
    }

    // Handshake done
    this.#handshakeDone = true
  }


  async close(): Promise<void> {
    if (this.#closed) return
    await getPGLiteNative().close()
    this.#closed = true
  }

  // Custom query implementation with proper parameter serialization (like BasePGlite)
  async query<T = any>(
    query: string,
    params: any[] = [],
    options?: any,
  ): Promise<{
    rows: T[]
    fields: { name: string; dataTypeID: number }[]
    affectedRows?: number
  }> {
    // Prepare + Bind + Execute using extended protocol, mirroring web flow
    const messages: any[] = []

    // RN: batch extended-protocol into a single request to match WASM semantics.
    // Convert parameters to strings as required by pg-protocol (LegalValue = string | ArrayBuffer | ArrayBufferView | null)
    const values = params.map((v) =>
      v == null
        ? null
        : v instanceof ArrayBuffer || ArrayBuffer.isView(v)
          ? v
          : this.serializeParam(v),
    )

    await this.ensureStartup(options?.syncToFs ?? true)

    // For parameterized queries, we need to provide parameter types
    // Determine the correct OID for each parameter based on its JavaScript type
    const paramTypes =
      options?.paramTypes ||
      (params.length > 0 ? params.map(param => this.getParamOid(param)) : undefined)
    

    // Debug individual messages - use unnamed statement to match WASM version
    const parseMsg = protocolSerialize.parse({
      text: query,
      types: paramTypes,
    })
    const describeStmtMsg = protocolSerialize.describe({ type: 'S' })
    const bindMsg = protocolSerialize.bind({ values })
    const describePortalMsg = protocolSerialize.describe({ type: 'P' })
    const executeMsg = protocolSerialize.execute({})
    const syncMsg = protocolSerialize.sync()

    // The mobile backend requires us to work around its single-message limitation
    // by sending the complete extended protocol sequence as one batch

    const completeSequence = concatBuffers(
      concatBuffers(
        concatBuffers(concatBuffers(parseMsg, describeStmtMsg), bindMsg),
        concatBuffers(describePortalMsg, executeMsg),
      ),
      syncMsg,
    )


    const { messages: batchedMessages } = await this.execProtocol(
      completeSequence,
      options,
    )
    const batchNames = batchedMessages.map((m: any) => m.name)

    // TEMPORARILY DISABLED: Fallback to simple protocol to debug extended protocol
    if (
      false &&
      !batchNames.some(
        (n: string) =>
          n === 'rowDescription' || n === 'dataRow' || n === 'commandComplete',
      )
    ) {
      // const simple = concatBuffers(
      //   protocolSerialize.query(query),
      //   protocolSerialize.sync(),
      // )
      // console.log('[PGL RN] simple send len=', simple.length)
      // const { messages: simpleMessages } = await this.execProtocol(
      //   simple,
      //   options,
      // )
      // console.log(
      //   '[PGL RN] simple recv messages=',
      //   simpleMessages.map((m: any) => m.name),
      // )
      // messages.push(...simpleMessages)
    } else {
      messages.push(...batchedMessages)
    }

    // Parse messages into Results shape (minimal)
    let fields: { name: string; dataTypeID: number }[] = []
    let rows: any[] = []
    let affectedRows = 0

    for (const msg of messages) {
      switch (msg.name) {
        case 'rowDescription':
          fields = msg.fields.map((f: any) => ({
            name: f.name,
            dataTypeID: f.dataTypeID,
          }))
          break
        case 'dataRow':
          if (Array.isArray(msg.fields)) {
            const row: any = {}
            for (let i = 0; i < msg.fields.length; i++) {
              row[fields[i]?.name ?? String(i)] = msg.fields[i]
            }
            rows.push(row)
          }
          break
        case 'commandComplete': {
          const parts = String(msg.text ?? '').split(' ')
          const first = parts[0]
          if (first === 'INSERT') affectedRows += parseInt(parts[2] ?? '0', 10)
          else if (['UPDATE', 'DELETE', 'COPY', 'MERGE'].includes(first))
            affectedRows += parseInt(parts[1] ?? '0', 10)
          break
        }
      }
    }

    return { rows, fields, ...(affectedRows ? { affectedRows } : {}) }
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

    try {
      let messageCount = 0
      // Reset parser for each new protocol session to ensure clean state
      this.#protocolParser = new Parser() 
      this.#protocolParser.parse(data, (msg: any) => {
        messageCount++
        results.push(msg)
        // Handle errors and notices like the web version
        if (msg.name === 'error') {
          throw msg // Throw PostgreSQL errors as exceptions
        }
        if (msg.name === 'notice' && onNotice) onNotice(msg as any)
      })
    } catch (error: any) {
      console.error('[PGL RN] Protocol parser error:', error)
      console.error('[PGL RN] Error stack:', error.stack)
    }
    return { messages: results, data }
  }

  // BasePGlite abstract hooks
  async syncToFs(): Promise<void> {
    // No-op for now (native fsyncs are implicit); preserve option for strict durability later
  }
  async _handleBlob(_blob?: File | Blob): Promise<void> {}
  async _getWrittenBlob(): Promise<File | Blob | undefined> {
    return undefined
  }
  async _cleanupBlob(): Promise<void> {}
  async _checkReady(): Promise<void> {
    await this.waitReady
  }
  async _runExclusiveQuery<T>(fn: () => Promise<T>): Promise<T> {
    return await fn()
  }
  async _runExclusiveTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return await fn()
  }

  // Notifications are parsed from protocol messages in execProtocol (same as web)
  async listen(channel: string, callback: (payload: string) => void) {
    return this._runExclusiveListen(async () => {
      // On RN we rely on protocol notifications; BasePGlite manages listeners.
      // The SQL LISTEN command itself is issued from BasePGlite higher-level calls.
      return async () => {
        await this.unlisten(channel, callback)
      }
    })
  }
  async unlisten(_channel: string, _callback?: (payload: string) => void) {}
  _runExclusiveListen<T>(fn: () => Promise<T>): Promise<T> {
    return this.#listenMutex.runExclusive(fn)
  }
}
