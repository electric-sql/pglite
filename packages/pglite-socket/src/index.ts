import type { PGlite } from '@electric-sql/pglite'
import { createServer, Server, Socket } from 'net'

// Connection queue timeout in milliseconds
export const CONNECTION_QUEUE_TIMEOUT = 60000 // 60 seconds

/**
 * Options for creating a PGLiteSocketHandler
 */
export interface PGLiteSocketHandlerOptions {
  /** The PGlite database instance */
  db: PGlite
  /** Whether to close the socket when detached (default: false) */
  closeOnDetach?: boolean
  /** Print the incoming and outgoing data to the console in hex and ascii */
  inspect?: boolean
  /** Enable debug logging of method calls */
  debug?: boolean
}

/**
 * Low-level handler for a single socket connection to PGLite
 * Handles the raw protocol communication between a socket and PGLite
 */
export class PGLiteSocketHandler extends EventTarget {
  readonly db: PGlite
  private socket: Socket | null = null
  private active = false
  private closeOnDetach: boolean
  private resolveLock?: () => void
  private rejectLock?: (err: Error) => void
  private inspect: boolean
  private debug: boolean
  private readonly id: number

  // Static counter for generating unique handler IDs
  private static nextHandlerId = 1

  /**
   * Create a new PGLiteSocketHandler
   * @param options Options for the handler
   */
  constructor(options: PGLiteSocketHandlerOptions) {
    super()
    this.db = options.db
    this.closeOnDetach = options.closeOnDetach ?? false
    this.inspect = options.inspect ?? false
    this.debug = options.debug ?? false
    this.id = PGLiteSocketHandler.nextHandlerId++

    this.log('constructor: created new handler')
  }

  /**
   * Get the unique ID of this handler
   */
  public get handlerId(): number {
    return this.id
  }

  /**
   * Log a message if debug is enabled
   * @private
   */
  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[PGLiteSocketHandler#${this.id}] ${message}`, ...args)
    }
  }

  /**
   * Attach a socket to this handler
   * @param socket The socket to attach
   * @returns this handler instance
   * @throws Error if a socket is already attached
   */
  public async attach(socket: Socket): Promise<PGLiteSocketHandler> {
    this.log(
      `attach: attaching socket from ${socket.remoteAddress}:${socket.remotePort}`,
    )

    if (this.socket) {
      throw new Error('Socket already attached')
    }

    this.socket = socket
    this.active = true

    // Ensure the PGlite instance is ready
    this.log(`attach: waiting for PGlite to be ready`)
    await this.db.waitReady

    // Hold the lock on the PGlite instance
    this.log(`attach: acquiring exclusive lock on PGlite instance`)
    await new Promise<void>((resolve) => {
      this.db.runExclusive(() => {
        // Ensure we have the lock on the PGlite instance
        resolve()

        // Use a promise to hold the lock on the PGlite instance
        // this can be resolved or rejected by the handler to release the lock
        return new Promise<void>((resolveLock, rejectLock) => {
          this.resolveLock = resolveLock
          this.rejectLock = rejectLock
        })
      })
    })

    // Setup event handlers
    this.log(`attach: setting up socket event handlers`)
    socket.on('data', async (data) => {
      try {
        const result = await this.handleData(data)
        this.log(`socket on data sent: ${result} bytes`)
      } catch (err) {
        this.log('socket on data error: ', err)
      }
    })
    socket.on('error', (err) => this.handleError(err))
    socket.on('close', () => this.handleClose())

    return this
  }

  /**
   * Detach the current socket from this handler
   * @param close Whether to close the socket when detaching (overrides constructor option)
   * @returns this handler instance
   */
  public detach(close?: boolean): PGLiteSocketHandler {
    this.log(`detach: detaching socket, close=${close ?? this.closeOnDetach}`)

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
        this.socket.end()
        this.socket.destroy()
      }
    }

    // Release the lock on the PGlite instance
    this.log(`detach: releasing exclusive lock on PGlite instance`)
    this.resolveLock?.()

    this.socket = null
    this.active = false
    return this
  }

  /**
   * Check if a socket is currently attached
   */
  public get isAttached(): boolean {
    return this.socket !== null
  }

  /**
   * Handle incoming data from the socket
   */
  private async handleData(data: Buffer): Promise<number> {
    if (!this.socket || !this.active) {
      this.log(`handleData: no active socket, ignoring data`)
      return new Promise((_, reject) => reject(`no active socket`))
    }

    this.log(`handleData: received ${data.length} bytes`)

    // Print the incoming data to the console
    this.inspectData('incoming', data)

    try {
      // Process the raw protocol data
      this.log(`handleData: sending data to PGlite for processing`)
      const result = await this.db.execProtocolRaw(new Uint8Array(data))

      this.log(`handleData: received ${result.length} bytes from PGlite`)

      // Print the outgoing data to the console
      this.inspectData('outgoing', result)

      // Send the result back if the socket is still connected
      if (this.socket && this.socket.writable && this.active) {
        if (result.length <= 0) {
          this.log(`handleData: cowardly refusing to send empty packet`)
          return new Promise((_, reject) => reject('no data'))
        }

        const promise = new Promise<number>((resolve, reject) => {
          this.log(`handleData: writing response to socket`)
          if (this.socket) {
            this.socket.write(Buffer.from(result), (err?: Error) => {
              if (err) {
                reject(`Error while writing to the socket ${err.toString()}`)
              } else {
                resolve(result.length)
              }
            })
          } else {
            reject(`No socket`)
          }
        })

        // Emit data event with byte sizes
        this.dispatchEvent(
          new CustomEvent('data', {
            detail: { incoming: data.length, outgoing: result.length },
          }),
        )
        return promise
      } else {
        this.log(
          `handleData: socket no longer writable or active, discarding response`,
        )
        return new Promise((_, reject) =>
          reject(`No socket, not active or not writeable`),
        )
      }
    } catch (err) {
      this.log(`handleData: error processing data:`, err)
      this.handleError(err as Error)
      return new Promise((_, reject) =>
        reject(`Error while processing data ${(err as Error).toString()}`),
      )
    }
  }

  /**
   * Handle errors from the socket
   */
  private handleError(err: Error): void {
    this.log(`handleError:`, err)

    // Emit error event
    this.dispatchEvent(new CustomEvent('error', { detail: err }))

    // Reject the lock on the PGlite instance
    this.log(`handleError: rejecting exclusive lock on PGlite instance`)
    this.rejectLock?.(err)
    this.resolveLock = undefined
    this.rejectLock = undefined

    // Close the connection on error
    this.detach(true)
  }

  /**
   * Handle socket close event
   */
  private handleClose(): void {
    this.log(`handleClose: socket closed`)

    this.dispatchEvent(new CustomEvent('close'))
    this.detach(false) // Already closed, just clean up
  }

  /**
   * Print data in hex and ascii to the console
   */
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

    // Process 16 bytes per line
    for (let offset = 0; offset < data.length; offset += 16) {
      // Calculate current chunk size (may be less than 16 for the last chunk)
      const chunkSize = Math.min(16, data.length - offset)

      // Build the hex representation
      let hexPart = ''
      for (let i = 0; i < 16; i++) {
        if (i < chunkSize) {
          const byte = data[offset + i]
          hexPart += byte.toString(16).padStart(2, '0') + ' '
        } else {
          hexPart += '   ' // 3 spaces for missing bytes
        }
      }

      // Build the ASCII representation
      let asciiPart = ''
      for (let i = 0; i < chunkSize; i++) {
        const byte = data[offset + i]
        // Use printable characters (32-126), replace others with a dot
        asciiPart += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'
      }

      // Print the line with offset in hex, hex values, and ASCII representation
      console.log(
        `${offset.toString(16).padStart(8, '0')}  ${hexPart} ${asciiPart}`,
      )
    }
  }
}

/**
 * Represents a queued connection with timeout
 */
interface QueuedConnection {
  socket: Socket
  clientInfo: {
    clientAddress: string
    clientPort: number
  }
  timeoutId: NodeJS.Timeout
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
  /** Unix socket path to bind to (default: undefined). If specified, takes precedence over host:port */
  path?: string
  /** Print the incoming and outgoing data to the console in hex and ascii */
  inspect?: boolean
  /** Connection queue timeout in milliseconds (default: 10000) */
  connectionQueueTimeout?: number
  /** Enable debug logging of method calls */
  debug?: boolean
}

/**
 * High-level server that manages socket connections to PGLite
 * Creates and manages a TCP server and handles client connections
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
  private connectionQueueTimeout: number
  private activeHandler: PGLiteSocketHandler | null = null
  private connectionQueue: QueuedConnection[] = []
  private handlerCount: number = 0

  /**
   * Create a new PGLiteSocketServer
   * @param options Options for the server
   */
  constructor(options: PGLiteSocketServerOptions) {
    super()
    this.db = options.db
    if (options.path) {
      this.path = options.path
    } else {
      if (typeof options.port === 'number') {
        // Keep port undefined on port 0, will be set by the OS when we start the server.
        this.port = options.port ?? options.port
      } else {
        this.port = 5432
      }
      this.host = options.host || '127.0.0.1'
    }
    this.inspect = options.inspect ?? false
    this.debug = options.debug ?? false
    this.connectionQueueTimeout =
      options.connectionQueueTimeout ?? CONNECTION_QUEUE_TIMEOUT

    this.log(`constructor: created server on ${this.host}:${this.port}`)
    this.log(
      `constructor: connection queue timeout: ${this.connectionQueueTimeout}ms`,
    )
  }

  /**
   * Log a message if debug is enabled
   * @private
   */
  private log(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[PGLiteSocketServer] ${message}`, ...args)
    }
  }

  /**
   * Start the socket server
   * @returns Promise that resolves when the server is listening
   */
  public async start(): Promise<void> {
    this.log(`start: starting server on ${this.getServerConn()}`)

    if (this.server) {
      throw new Error('Socket server already started')
    }

    this.active = true
    this.server = createServer((socket) => this.handleConnection(socket))

    return new Promise<void>((resolve, reject) => {
      if (!this.server) return reject(new Error('Server not initialized'))

      this.server.on('error', (err) => {
        this.log(`start: server error:`, err)
        this.dispatchEvent(new CustomEvent('error', { detail: err }))
        reject(err)
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
        const server = this.server
        server.listen(this.port, this.host, () => {
          const address = server.address()
          // We are not using pipes, so return type should be AddressInfo
          if (address === null || typeof address !== 'object') {
            throw Error('Expected address info')
          }
          // Assign the new port number
          this.port = address.port
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

  /**
   * Stop the socket server
   * @returns Promise that resolves when the server is closed
   */
  public async stop(): Promise<void> {
    this.log(`stop: stopping server`)

    this.active = false

    // Clear connection queue
    this.log(
      `stop: clearing connection queue (${this.connectionQueue.length} connections)`,
    )

    this.connectionQueue.forEach((queuedConn) => {
      clearTimeout(queuedConn.timeoutId)
      if (queuedConn.socket.writable) {
        this.log(
          `stop: closing queued connection from ${queuedConn.clientInfo.clientAddress}:${queuedConn.clientInfo.clientPort}`,
        )
        queuedConn.socket.end()
      }
    })
    this.connectionQueue = []

    // Detach active handler if exists
    if (this.activeHandler) {
      this.log(`stop: detaching active handler #${this.activeHandlerId}`)
      this.activeHandler.detach(true)
      this.activeHandler = null
    }

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

  /**
   * Get the active handler ID, or null if no active handler
   */
  private get activeHandlerId(): number | null {
    return this.activeHandler?.handlerId ?? null
  }

  /**
   * Handle a new client connection
   */
  private async handleConnection(socket: Socket): Promise<void> {
    const clientInfo = {
      clientAddress: socket.remoteAddress || 'unknown',
      clientPort: socket.remotePort || 0,
    }

    this.log(
      `handleConnection: new connection from ${clientInfo.clientAddress}:${clientInfo.clientPort}`,
    )

    // If server is not active, close the connection immediately
    if (!this.active) {
      this.log(`handleConnection: server not active, closing connection`)
      socket.end()
      return
    }

    // If we don't have an active handler or it's not attached, we can use this connection immediately
    if (!this.activeHandler || !this.activeHandler.isAttached) {
      this.log(`handleConnection: no active handler, attaching socket directly`)
      this.dispatchEvent(new CustomEvent('connection', { detail: clientInfo }))
      await this.attachSocketToNewHandler(socket, clientInfo)
      return
    }

    // Otherwise, queue the connection
    this.log(
      `handleConnection: active handler #${this.activeHandlerId} exists, queueing connection`,
    )
    this.enqueueConnection(socket, clientInfo)
  }

  /**
   * Add a connection to the queue
   */
  private enqueueConnection(
    socket: Socket,
    clientInfo: { clientAddress: string; clientPort: number },
  ): void {
    this.log(
      `enqueueConnection: queueing connection from ${clientInfo.clientAddress}:${clientInfo.clientPort}, timeout: ${this.connectionQueueTimeout}ms`,
    )

    // Set a timeout for this queued connection
    const timeoutId = setTimeout(() => {
      this.log(
        `enqueueConnection: timeout for connection from ${clientInfo.clientAddress}:${clientInfo.clientPort}`,
      )

      // Remove from queue
      this.connectionQueue = this.connectionQueue.filter(
        (queuedConn) => queuedConn.socket !== socket,
      )

      // End the connection if it's still open
      if (socket.writable) {
        this.log(`enqueueConnection: closing timed out connection`)
        socket.end()
      }

      this.dispatchEvent(
        new CustomEvent('queueTimeout', {
          detail: { ...clientInfo, queueSize: this.connectionQueue.length },
        }),
      )
    }, this.connectionQueueTimeout)

    // Add to queue
    this.connectionQueue.push({ socket, clientInfo, timeoutId })

    this.log(
      `enqueueConnection: connection queued, queue size: ${this.connectionQueue.length}`,
    )

    this.dispatchEvent(
      new CustomEvent('queuedConnection', {
        detail: { ...clientInfo, queueSize: this.connectionQueue.length },
      }),
    )
  }

  /**
   * Process the next connection in the queue
   */
  private processNextInQueue(): void {
    this.log(
      `processNextInQueue: processing next connection, queue size: ${this.connectionQueue.length}`,
    )

    // No connections in queue or server not active
    if (this.connectionQueue.length === 0 || !this.active) {
      this.log(
        `processNextInQueue: no connections in queue or server not active, nothing to do`,
      )
      return
    }

    // Get the next connection
    const nextConn = this.connectionQueue.shift()
    if (!nextConn) return

    this.log(
      `processNextInQueue: processing connection from ${nextConn.clientInfo.clientAddress}:${nextConn.clientInfo.clientPort}`,
    )

    // Clear the timeout
    clearTimeout(nextConn.timeoutId)

    // Check if the socket is still valid
    if (!nextConn.socket.writable) {
      this.log(
        `processNextInQueue: socket no longer writable, skipping to next connection`,
      )
      // Socket closed while waiting, process next in queue
      this.processNextInQueue()
      return
    }

    // Attach this socket to a new handler
    this.attachSocketToNewHandler(nextConn.socket, nextConn.clientInfo).catch(
      (err) => {
        this.log(`processNextInQueue: error attaching socket:`, err)
        this.dispatchEvent(new CustomEvent('error', { detail: err }))
        // Try the next connection
        this.processNextInQueue()
      },
    )
  }

  /**
   * Attach a socket to a new handler
   */
  private async attachSocketToNewHandler(
    socket: Socket,
    clientInfo: { clientAddress: string; clientPort: number },
  ): Promise<void> {
    this.handlerCount++

    this.log(
      `attachSocketToNewHandler: creating new handler for ${clientInfo.clientAddress}:${clientInfo.clientPort} (handler #${this.handlerCount})`,
    )

    // Create a new handler for this connection
    const handler = new PGLiteSocketHandler({
      db: this.db,
      closeOnDetach: true,
      inspect: this.inspect,
      debug: this.debug,
    })

    // Forward error events from the handler
    handler.addEventListener('error', (event) => {
      this.log(
        `handler #${handler.handlerId}: error from handler:`,
        (event as CustomEvent<Error>).detail,
      )
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: (event as CustomEvent<Error>).detail,
        }),
      )
    })

    // Handle close event to process next queued connection
    handler.addEventListener('close', () => {
      this.log(`handler #${handler.handlerId}: closed`)

      // If this is our active handler, clear it
      if (this.activeHandler === handler) {
        this.log(
          `handler #${handler.handlerId}: was active handler, processing next connection in queue`,
        )
        this.activeHandler = null
        // Process next connection in queue
        this.processNextInQueue()
      }
    })

    try {
      // Set as active handler
      this.activeHandler = handler

      this.log(`handler #${handler.handlerId}: attaching socket`)

      // Attach the socket to the handler
      await handler.attach(socket)

      this.dispatchEvent(new CustomEvent('connection', { detail: clientInfo }))
    } catch (err) {
      // If there was an error attaching, clean up
      this.log(`handler #${handler.handlerId}: error attaching socket:`, err)
      this.activeHandler = null
      if (socket.writable) {
        socket.end()
      }
      throw err
    }
  }
}
