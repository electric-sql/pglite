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

  /**
   * Create a new PGLiteSocketHandler
   * @param options Options for the handler
   */
  constructor(options: PGLiteSocketHandlerOptions) {
    super()
    this.db = options.db
    this.closeOnDetach = options.closeOnDetach ?? false
    this.inspect = options.inspect ?? false
  }

  /**
   * Attach a socket to this handler
   * @param socket The socket to attach
   * @returns this handler instance
   * @throws Error if a socket is already attached
   */
  public async attach(socket: Socket): Promise<PGLiteSocketHandler> {
    if (this.socket) {
      throw new Error('Socket already attached')
    }

    this.socket = socket
    this.active = true

    // Ensure the PGlite instance is ready
    await this.db.waitReady

    // Hold the lock on the PGlite instance
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
    socket.on('data', (data) => this.handleData(data))
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
    if (!this.socket) {
      return this
    }

    // Remove all listeners
    this.socket.removeAllListeners('data')
    this.socket.removeAllListeners('error')
    this.socket.removeAllListeners('close')

    // Close the socket if requested
    if (close ?? this.closeOnDetach) {
      if (this.socket.writable) {
        this.socket.end()
      }
    }

    // Release the lock on the PGlite instance
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
  private async handleData(data: Buffer): Promise<void> {
    if (!this.socket || !this.active) {
      return
    }

    // Print the incoming data to the console
    this.inspectData('incoming', data)

    try {
      // Process the raw protocol data
      const result = await this.db.execProtocolRaw(new Uint8Array(data))
      // Print the outgoing data to the console
      this.inspectData('outgoing', result)

      // Send the result back if the socket is still connected
      if (this.socket && this.socket.writable && this.active) {
        this.socket.write(Buffer.from(result))

        // Emit data event with byte sizes
        this.dispatchEvent(
          new CustomEvent('data', {
            detail: { incoming: data.length, outgoing: result.length },
          }),
        )
      }
    } catch (err) {
      this.handleError(err as Error)
    }
  }

  /**
   * Handle errors from the socket
   */
  private handleError(err: Error): void {
    // Emit error event
    this.dispatchEvent(new CustomEvent('error', { detail: err }))

    // Reject the lock on the PGlite instance
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
  /** Print the incoming and outgoing data to the console in hex and ascii */
  inspect?: boolean
  /** Connection queue timeout in milliseconds (default: 10000) */
  connectionQueueTimeout?: number
}

/**
 * High-level server that manages socket connections to PGLite
 * Creates and manages a TCP server and handles client connections
 */
export class PGLiteSocketServer extends EventTarget {
  readonly db: PGlite
  private server: Server | null = null
  private port: number
  private host: string
  private active = false
  private inspect: boolean
  private connectionQueueTimeout: number
  private activeHandler: PGLiteSocketHandler | null = null
  private connectionQueue: QueuedConnection[] = []

  /**
   * Create a new PGLiteSocketServer
   * @param options Options for the server
   */
  constructor(options: PGLiteSocketServerOptions) {
    super()
    this.db = options.db
    this.port = options.port || 5432
    this.host = options.host || '127.0.0.1'
    this.inspect = options.inspect ?? false
    this.connectionQueueTimeout = options.connectionQueueTimeout ?? CONNECTION_QUEUE_TIMEOUT
  }

  /**
   * Start the socket server
   * @returns Promise that resolves when the server is listening
   */
  public async start(): Promise<void> {
    if (this.server) {
      throw new Error('Socket server already started')
    }

    this.active = true
    this.server = createServer((socket) => this.handleConnection(socket))

    return new Promise<void>((resolve, reject) => {
      if (!this.server) return reject(new Error('Server not initialized'))

      this.server.on('error', (err) => {
        this.dispatchEvent(new CustomEvent('error', { detail: err }))
        reject(err)
      })

      this.server.listen(this.port, this.host, () => {
        this.dispatchEvent(
          new CustomEvent('listening', {
            detail: { port: this.port, host: this.host },
          }),
        )
        resolve()
      })
    })
  }

  /**
   * Stop the socket server
   * @returns Promise that resolves when the server is closed
   */
  public async stop(): Promise<void> {
    this.active = false

    // Clear connection queue
    this.connectionQueue.forEach(queuedConn => {
      clearTimeout(queuedConn.timeoutId)
      if (queuedConn.socket.writable) {
        queuedConn.socket.end()
      }
    })
    this.connectionQueue = []

    // Detach active handler if exists
    if (this.activeHandler) {
      this.activeHandler.detach(true)
      this.activeHandler = null
    }

    if (!this.server) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      if (!this.server) return resolve()

      this.server.close(() => {
        this.server = null
        this.dispatchEvent(new CustomEvent('close'))
        resolve()
      })
    })
  }

  /**
   * Handle a new client connection
   */
  private async handleConnection(socket: Socket): Promise<void> {
    const clientInfo = {
      clientAddress: socket.remoteAddress || 'unknown',
      clientPort: socket.remotePort || 0,
    }

    // If server is not active, close the connection immediately
    if (!this.active) {
      socket.end()
      return
    }

    // If we don't have an active handler or it's not attached, we can use this connection immediately
    if (!this.activeHandler || !this.activeHandler.isAttached) {
      this.dispatchEvent(new CustomEvent('connection', { detail: clientInfo }))
      await this.attachSocketToNewHandler(socket, clientInfo)
      return
    }

    // Otherwise, queue the connection
    this.enqueueConnection(socket, clientInfo)
  }

  /**
   * Add a connection to the queue
   */
  private enqueueConnection(socket: Socket, clientInfo: { clientAddress: string; clientPort: number }): void {
    // Set a timeout for this queued connection
    const timeoutId = setTimeout(() => {
      // Remove from queue
      this.connectionQueue = this.connectionQueue.filter(queuedConn => queuedConn.socket !== socket)
      
      // End the connection if it's still open
      if (socket.writable) {
        socket.end()
      }

      this.dispatchEvent(
        new CustomEvent('queueTimeout', { 
          detail: { ...clientInfo, queueSize: this.connectionQueue.length } 
        })
      )
    }, this.connectionQueueTimeout)

    // Add to queue
    this.connectionQueue.push({ socket, clientInfo, timeoutId })

    this.dispatchEvent(
      new CustomEvent('queuedConnection', { 
        detail: { ...clientInfo, queueSize: this.connectionQueue.length } 
      })
    )
  }

  /**
   * Process the next connection in the queue
   */
  private processNextInQueue(): void {
    // No connections in queue or server not active
    if (this.connectionQueue.length === 0 || !this.active) {
      return
    }

    // Get the next connection
    const nextConn = this.connectionQueue.shift()
    if (!nextConn) return

    // Clear the timeout
    clearTimeout(nextConn.timeoutId)

    // Check if the socket is still valid
    if (!nextConn.socket.writable) {
      // Socket closed while waiting, process next in queue
      this.processNextInQueue()
      return
    }

    // Attach this socket to a new handler
    this.attachSocketToNewHandler(nextConn.socket, nextConn.clientInfo)
      .catch(err => {
        this.dispatchEvent(new CustomEvent('error', { detail: err }))
        // Try the next connection
        this.processNextInQueue()
      })
  }

  /**
   * Attach a socket to a new handler
   */
  private async attachSocketToNewHandler(
    socket: Socket, 
    clientInfo: { clientAddress: string; clientPort: number }
  ): Promise<void> {
    // Create a new handler for this connection
    const handler = new PGLiteSocketHandler({
      db: this.db,
      closeOnDetach: true,
      inspect: this.inspect,
    })

    // Forward error events from the handler
    handler.addEventListener('error', (event) => {
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: (event as CustomEvent<Error>).detail,
        }),
      )
    })

    // Handle close event to process next queued connection
    handler.addEventListener('close', () => {
      // If this is our active handler, clear it
      if (this.activeHandler === handler) {
        this.activeHandler = null
        // Process next connection in queue
        this.processNextInQueue()
      }
    })

    try {
      // Set as active handler
      this.activeHandler = handler
      
      // Attach the socket to the handler
      await handler.attach(socket)
      
      this.dispatchEvent(new CustomEvent('connection', { detail: clientInfo }))
    } catch (err) {
      // If there was an error attaching, clean up
      this.activeHandler = null
      if (socket.writable) {
        socket.end()
      }
      throw err
    }
  }
}
