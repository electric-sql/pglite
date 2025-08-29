import type { PGlite } from '@electric-sql/pglite'
import { type Server, type Socket, createServer } from 'net'

// Connection queue timeout in milliseconds
export const CONNECTION_QUEUE_TIMEOUT = 60000 // 60 seconds

/**
 * Represents a queued query waiting for PGlite access
 */
interface QueuedQuery {
  handlerId: number
  message: Uint8Array
  resolve: (result: Uint8Array) => void
  reject: (error: Error) => void
  timestamp: number
}

/**
 * Global query queue manager
 * Ensures only one query executes at a time in PGlite
 */
class QueryQueueManager {
  private queue: QueuedQuery[] = []
  private processing = false
  private db: PGlite
  private debug: boolean

  constructor(db: PGlite, debug = false) {
    this.db = db
    this.debug = debug
  }

  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[QueryQueueManager] ${message}`, ...args)
    }
  }

  async enqueue(handlerId: number, message: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const query: QueuedQuery = {
        handlerId,
        message,
        resolve,
        reject,
        timestamp: Date.now(),
      }

      this.queue.push(query)
      this.log(
        `enqueued query from handler #${handlerId}, queue size: ${this.queue.length}`,
      )

      // Process queue if not already processing
      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const query = this.queue.shift()
      if (!query) break

      const waitTime = Date.now() - query.timestamp
      this.log(
        `processing query from handler #${query.handlerId} (waited ${waitTime}ms)`,
      )

      try {
        // Execute the query with exclusive access to PGlite
        const result = await this.db.runExclusive(async () => {
          return await this.db.execProtocolRaw(query.message)
        })

        this.log(
          `query from handler #${query.handlerId} completed, ${result.length} bytes`,
        )
        query.resolve(result)
      } catch (error) {
        this.log(`query from handler #${query.handlerId} failed:`, error)
        query.reject(error as Error)
      }
    }

    this.processing = false
    this.log(`queue processing complete, queue is empty`)
  }

  getQueueLength(): number {
    return this.queue.length
  }

  clearQueueForHandler(handlerId: number): void {
    const before = this.queue.length
    this.queue = this.queue.filter((q) => {
      if (q.handlerId === handlerId) {
        q.reject(new Error('Handler disconnected'))
        return false
      }
      return true
    })
    const removed = before - this.queue.length
    if (removed > 0) {
      this.log(`cleared ${removed} queries for handler #${handlerId}`)
    }
  }
}

/**
 * Options for creating a PGLiteSocketHandler
 */
export interface PGLiteSocketHandlerOptions {
  /** The query queue manager */
  queryQueue: QueryQueueManager
  /** Whether to close the socket when detached (default: false) */
  closeOnDetach?: boolean
  /** Print the incoming and outgoing data to the console in hex and ascii */
  inspect?: boolean
  /** Enable debug logging of method calls */
  debug?: boolean
  /** Idle timeout in ms (0 to disable, default: 0) */
  idleTimeout?: number
}

/**
 * Handler for a single socket connection to PGlite
 * Each connection can remain open and send multiple queries
 */
export class PGLiteSocketHandler extends EventTarget {
  private queryQueue: QueryQueueManager
  private socket: Socket | null = null
  private active = false
  private closeOnDetach: boolean
  private inspect: boolean
  private debug: boolean
  private readonly id: number
  private messageBuffer: Buffer = Buffer.alloc(0)
  private idleTimer?: NodeJS.Timeout
  private idleTimeout: number
  private lastActivityTime: number = Date.now()

  // Static counter for generating unique handler IDs
  private static nextHandlerId = 1

  constructor(options: PGLiteSocketHandlerOptions) {
    super()
    this.queryQueue = options.queryQueue
    this.closeOnDetach = options.closeOnDetach ?? false
    this.inspect = options.inspect ?? false
    this.debug = options.debug ?? false
    this.idleTimeout = options.idleTimeout ?? 0
    this.id = PGLiteSocketHandler.nextHandlerId++

    this.log('constructor: created new handler')
  }

  public get handlerId(): number {
    return this.id
  }

  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[PGLiteSocketHandler#${this.id}] ${message}`, ...args)
    }
  }

  public async attach(socket: Socket): Promise<PGLiteSocketHandler> {
    this.log(
      `attach: attaching socket from ${socket.remoteAddress}:${socket.remotePort}`,
    )

    if (this.socket) {
      throw new Error('Socket already attached')
    }

    this.socket = socket
    this.active = true
    this.lastActivityTime = Date.now()

    // Set up socket options
    socket.setKeepAlive(true, 30000)
    socket.setNoDelay(true)

    // Set up idle timeout if configured
    if (this.idleTimeout > 0) {
      this.resetIdleTimer()
    }

    // Setup event handlers
    this.log(`attach: setting up socket event handlers`)

    socket.on('data', (data) => {
      this.lastActivityTime = Date.now()
      this.resetIdleTimer()

      setImmediate(async () => {
        try {
          const result = await this.handleData(data)
          this.log(`socket on data sent: ${result} bytes`)
        } catch (err) {
          this.log('socket on data error: ', err)
          this.handleError(err as Error)
        }
      })
    })

    socket.on('error', (err) => {
      setImmediate(() => this.handleError(err))
    })

    socket.on('close', () => {
      setImmediate(() => this.handleClose())
    })

    this.log(`attach: socket handler ready`)
    return this
  }

  private resetIdleTimer(): void {
    if (this.idleTimeout <= 0) return

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      const idleTime = Date.now() - this.lastActivityTime
      this.log(`idle timeout after ${idleTime}ms`)
      this.handleError(new Error('Idle timeout'))
    }, this.idleTimeout)
  }

  public detach(close?: boolean): PGLiteSocketHandler {
    this.log(`detach: detaching socket, close=${close ?? this.closeOnDetach}`)

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }

    // Clear any pending queries for this handler
    this.queryQueue.clearQueueForHandler(this.id)

    if (!this.socket) {
      this.log(`detach: no socket attached, nothing to do`)
      return this
    }

    // Remove all listeners
    this.socket.removeAllListeners('data')
    this.socket.removeAllListeners('error')
    this.socket.removeAllListeners('close')

    // Close the socket if requested
    if (close ?? this.closeOnDetach) {
      if (this.socket.writable) {
        this.log(`detach: closing socket`)
        try {
          this.socket.end()
          this.socket.destroy()
        } catch (err) {
          this.log(`detach: error closing socket:`, err)
        }
      }
    }

    this.socket = null
    this.active = false
    this.messageBuffer = Buffer.alloc(0)

    this.log(`detach: handler cleaned up`)
    return this
  }

  public get isAttached(): boolean {
    return this.socket !== null
  }

  private async handleData(data: Buffer): Promise<number> {
    if (!this.socket || !this.active) {
      this.log(`handleData: no active socket, ignoring data`)
      return 0
    }

    this.log(`handleData: received ${data.length} bytes`)

    // Append to buffer for message reassembly
    this.messageBuffer = Buffer.concat([this.messageBuffer, data])

    // Print the incoming data to the console
    this.inspectData('incoming', data)

    try {
      let totalProcessed = 0

      while (this.messageBuffer.length > 0) {
        // Determine message length
        let messageLength = 0
        let isComplete = false

        // Handle startup message (no type byte, just length)
        if (this.messageBuffer.length >= 4) {
          const firstInt = this.messageBuffer.readInt32BE(0)

          if (this.messageBuffer.length >= 8) {
            const secondInt = this.messageBuffer.readInt32BE(4)
            // PostgreSQL 3.0 protocol version
            if (secondInt === 196608 || secondInt === 0x00030000) {
              messageLength = firstInt
              isComplete = this.messageBuffer.length >= messageLength
            }
          }

          // Regular message (type byte + length)
          if (!isComplete && this.messageBuffer.length >= 5) {
            const msgLength = this.messageBuffer.readInt32BE(1)
            messageLength = 1 + msgLength
            isComplete = this.messageBuffer.length >= messageLength
          }
        }

        if (!isComplete || messageLength === 0) {
          this.log(
            `handleData: incomplete message, buffering ${this.messageBuffer.length} bytes`,
          )
          break
        }

        // Extract and process complete message
        const message = this.messageBuffer.slice(0, messageLength)
        this.messageBuffer = this.messageBuffer.slice(messageLength)

        this.log(`handleData: processing message of ${message.length} bytes`)

        // Check if socket is still active before processing
        if (!this.active || !this.socket) {
          this.log(`handleData: socket no longer active, stopping processing`)
          break
        }

        // Queue the query for execution
        // This allows multiple connections to queue queries simultaneously
        const result = await this.queryQueue.enqueue(
          this.id,
          new Uint8Array(message),
        )

        this.log(`handleData: received ${result.length} bytes from PGlite`)

        // Print the outgoing data to the console
        this.inspectData('outgoing', result)

        // Send response if available
        if (
          result.length > 0 &&
          this.socket &&
          this.socket.writable &&
          this.active
        ) {
          await new Promise<number>((resolve, reject) => {
            this.log(`handleData: writing response to socket`)
            if (this.socket?.writable) {
              this.socket.write(Buffer.from(result), (err?: any) => {
                if (err) {
                  this.log(`handleData: error writing to socket:`, err)
                  reject(err)
                } else {
                  resolve(result.length)
                }
              })
            } else {
              this.log(`handleData: socket no longer writable`)
              resolve(0)
            }
          }).catch((writeErr) => {
            this.log(`handleData: failed to write to socket:`, writeErr)
            throw writeErr
          })
        }

        totalProcessed += message.length
      }

      // Emit data event with byte sizes
      this.dispatchEvent(
        new CustomEvent('data', {
          detail: { incoming: data.length, outgoing: totalProcessed },
        }),
      )

      return totalProcessed
    } catch (err) {
      this.log(`handleData: error processing data:`, err)
      throw err
    }
  }

  private handleError(err: Error): void {
    if (!this.active) {
      this.log(`handleError: handler not active, ignoring error`)
      return
    }

    // ECONNRESET is expected behavior when clients disconnect
    if (err.message?.includes('ECONNRESET')) {
      this.log(
        `handleError: client disconnected (ECONNRESET) - normal behavior`,
      )
    } else if (err.message?.includes('Idle timeout')) {
      this.log(`handleError: connection idle timeout`)
    } else {
      this.log(`handleError:`, err)
    }

    this.active = false

    // Emit error event
    this.dispatchEvent(new CustomEvent('error', { detail: err }))

    // Clean up
    this.detach(true)
  }

  private handleClose(): void {
    this.log(`handleClose: socket closed`)
    this.active = false
    this.dispatchEvent(new CustomEvent('close'))
    this.detach(false)
  }

  private inspectData(
    direction: 'incoming' | 'outgoing',
    data: Buffer | Uint8Array,
  ): void {
    if (!this.inspect) return
    console.log('-'.repeat(75))
    if (direction === 'incoming') {
      console.log('-> incoming', data.length, 'bytes')
    } else {
      console.log('<- outgoing', data.length, 'bytes')
    }

    for (let offset = 0; offset < data.length; offset += 16) {
      const chunkSize = Math.min(16, data.length - offset)

      let hexPart = ''
      for (let i = 0; i < 16; i++) {
        if (i < chunkSize) {
          const byte = data[offset + i]
          hexPart += byte.toString(16).padStart(2, '0') + ' '
        } else {
          hexPart += '   '
        }
      }

      let asciiPart = ''
      for (let i = 0; i < chunkSize; i++) {
        const byte = data[offset + i]
        asciiPart += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'
      }

      console.log(
        `${offset.toString(16).padStart(8, '0')}  ${hexPart} ${asciiPart}`,
      )
    }
  }
}

/**
 * Options for creating a PGLiteSocketServer
 */
export interface PGLiteSocketServerOptions {
  /** The PGlite database instance */
  db: PGlite
  /** The port to listen on (default: 5432) */
  port?: number
  /** The host to bind to (default: 127.0.0.1) */
  host?: string
  /** Unix socket path to bind to (default: undefined) */
  path?: string
  /** Print the incoming and outgoing data to the console in hex and ascii */
  inspect?: boolean
  /** Enable debug logging of method calls */
  debug?: boolean
  /** Idle timeout in ms (0 to disable, default: 0) */
  idleTimeout?: number
  /** Maximum concurrent connections (default: 100) */
  maxConnections?: number
}

/**
 * PGLite Socket Server with support for multiple concurrent connections
 * Connections remain open and queries are queued at the query level
 */
export class PGLiteSocketServer extends EventTarget {
  readonly db: PGlite
  private server: Server | null = null
  private port?: number
  private host?: string
  private path?: string
  private active = false
  private inspect: boolean
  private debug: boolean
  private idleTimeout: number
  private maxConnections: number
  private handlers: Set<PGLiteSocketHandler> = new Set()
  private queryQueue: QueryQueueManager

  constructor(options: PGLiteSocketServerOptions) {
    super()
    this.db = options.db
    if (options.path) {
      this.path = options.path
    } else {
      this.port = options.port ?? 5432
      this.host = options.host || '127.0.0.1'
    }
    this.inspect = options.inspect ?? false
    this.debug = options.debug ?? false
    this.idleTimeout = options.idleTimeout ?? 0
    this.maxConnections = options.maxConnections ?? 100

    // Create the shared query queue
    this.queryQueue = new QueryQueueManager(this.db, this.debug)

    this.log(`constructor: created server on ${this.getServerConn()}`)
    this.log(`constructor: max connections: ${this.maxConnections}`)
    if (this.idleTimeout > 0) {
      this.log(`constructor: idle timeout: ${this.idleTimeout}ms`)
    }
  }

  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[PGLiteSocketServer] ${message}`, ...args)
    }
  }

  public async start(): Promise<void> {
    this.log(`start: starting server on ${this.getServerConn()}`)

    if (this.server) {
      throw new Error('Socket server already started')
    }

    // Ensure PGlite is ready before accepting connections
    await this.db.waitReady

    this.active = true
    this.server = createServer((socket) => {
      setImmediate(() => this.handleConnection(socket))
    })

    this.server.maxConnections = this.maxConnections

    return new Promise<void>((resolve, reject) => {
      if (!this.server) return reject(new Error('Server not initialized'))

      this.server.on('error', (err) => {
        this.log(`start: server error:`, err)
        this.dispatchEvent(new CustomEvent('error', { detail: err }))
        if (!this.active) {
          reject(err)
        }
      })

      if (this.path) {
        this.server.listen(this.path, () => {
          this.log(`start: server listening on ${this.getServerConn()}`)
          this.dispatchEvent(
            new CustomEvent('listening', {
              detail: { path: this.path },
            }),
          )
          resolve()
        })
      } else {
        this.server.listen(this.port, this.host, () => {
          this.log(`start: server listening on ${this.getServerConn()}`)
          this.dispatchEvent(
            new CustomEvent('listening', {
              detail: { port: this.port, host: this.host },
            }),
          )
          resolve()
        })
      }
    })
  }

  public getServerConn(): string {
    if (this.path) return this.path
    return `${this.host}:${this.port}`
  }

  public async stop(): Promise<void> {
    this.log(`stop: stopping server`)

    this.active = false

    // Detach all handlers
    this.log(`stop: detaching ${this.handlers.size} handlers`)
    for (const handler of this.handlers) {
      handler.detach(true)
    }
    this.handlers.clear()

    if (!this.server) {
      this.log(`stop: server not running, nothing to do`)
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      if (!this.server) return resolve()

      this.server.close(() => {
        this.log(`stop: server closed`)
        this.server = null
        this.dispatchEvent(new CustomEvent('close'))
        resolve()
      })
    })
  }

  private async handleConnection(socket: Socket): Promise<void> {
    const clientInfo = {
      clientAddress: socket.remoteAddress || 'unknown',
      clientPort: socket.remotePort || 0,
    }

    this.log(
      `handleConnection: new connection from ${clientInfo.clientAddress}:${clientInfo.clientPort}`,
    )
    this.log(
      `handleConnection: active connections: ${this.handlers.size}, queued queries: ${this.queryQueue.getQueueLength()}`,
    )

    if (!this.active) {
      this.log(`handleConnection: server not active, closing connection`)
      try {
        socket.end()
      } catch (err) {
        this.log(`handleConnection: error closing socket:`, err)
      }
      return
    }

    // Check connection limit
    if (this.handlers.size >= this.maxConnections) {
      this.log(`handleConnection: max connections reached, rejecting`)
      socket.write(Buffer.from('Too many connections\n'))
      socket.end()
      return
    }

    // Create a new handler for this connection
    const handler = new PGLiteSocketHandler({
      queryQueue: this.queryQueue,
      closeOnDetach: true,
      inspect: this.inspect,
      debug: this.debug,
      idleTimeout: this.idleTimeout,
    })

    // Track this handler
    this.handlers.add(handler)

    // Handle errors
    handler.addEventListener('error', (event) => {
      const error = (event as CustomEvent<Error>).detail

      if (error?.message?.includes('ECONNRESET')) {
        this.log(
          `handler #${handler.handlerId}: client disconnected (ECONNRESET)`,
        )
      } else if (error?.message?.includes('Idle timeout')) {
        this.log(`handler #${handler.handlerId}: idle timeout`)
      } else {
        this.log(`handler #${handler.handlerId}: error:`, error)
      }
    })

    // Handle close event
    handler.addEventListener('close', () => {
      this.log(`handler #${handler.handlerId}: closed`)
      this.handlers.delete(handler)
      this.log(`handleConnection: active connections: ${this.handlers.size}`)
    })

    try {
      await handler.attach(socket)
      this.dispatchEvent(new CustomEvent('connection', { detail: clientInfo }))
    } catch (err) {
      this.log(`handleConnection: error attaching socket:`, err)
      this.handlers.delete(handler)
      this.dispatchEvent(new CustomEvent('error', { detail: err }))
      try {
        socket.end()
      } catch (closeErr) {
        this.log(`handleConnection: error closing socket:`, closeErr)
      }
    }
  }

  public getStats() {
    return {
      activeConnections: this.handlers.size,
      queuedQueries: this.queryQueue.getQueueLength(),
      maxConnections: this.maxConnections,
    }
  }
}
