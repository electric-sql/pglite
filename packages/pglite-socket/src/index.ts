import type { PGlite } from '@electric-sql/pglite'
import { createServer, Server, Socket } from 'net'

/**
 * Options for creating a PGLiteSocketHandler
 */
export interface PGLiteSocketHandlerOptions {
  /** The PGlite database instance */
  db: PGlite
  /** Whether to close the socket when detached (default: false) */
  closeOnDetach?: boolean
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

  /**
   * Create a new PGLiteSocketHandler
   * @param options Options for the handler
   */
  constructor(options: PGLiteSocketHandlerOptions) {
    super()
    this.db = options.db
    this.closeOnDetach = options.closeOnDetach ?? false
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

    try {
      // Process the raw protocol data
      const result = await this.db.execProtocolRaw(new Uint8Array(data))

      // Send the result back if the socket is still connected
      if (this.socket && this.socket.writable && this.active) {
        this.socket.write(Buffer.from(result))

        // Emit data event with byte sizes
        this.dispatchEvent(
          new CustomEvent('data', {
            detail: { incoming: data.length, outgoing: result.byteLength },
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
  private socketHandler: PGLiteSocketHandler | null = null
  private active = false

  /**
   * Create a new PGLiteSocketServer
   * @param options Options for the server
   */
  constructor(options: PGLiteSocketServerOptions) {
    super()
    this.db = options.db
    this.port = options.port || 5432
    this.host = options.host || '127.0.0.1'
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

    // Create a new socket handler for this server
    this.socketHandler = new PGLiteSocketHandler({
      db: this.db,
      closeOnDetach: true,
    })

    // Forward error events from the handler
    this.socketHandler.addEventListener('error', (event) => {
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: (event as CustomEvent<Error>).detail,
        }),
      )
    })

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

    if (this.socketHandler) {
      this.socketHandler.detach(true)
      this.socketHandler = null
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
    // Only allow one client at a time as per requirements
    if (this.socketHandler?.isAttached || !this.active) {
      socket.end()
      return
    }

    // Attach the socket to our handler
    await this.socketHandler?.attach(socket)

    const clientInfo = {
      clientAddress: socket.remoteAddress || 'unknown',
      clientPort: socket.remotePort || 0,
    }

    this.dispatchEvent(new CustomEvent('connection', { detail: clientInfo }))
  }
}
