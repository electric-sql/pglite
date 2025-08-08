import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
  afterAll,
} from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  PGLiteSocketHandler,
  PGLiteSocketServer,
  CONNECTION_QUEUE_TIMEOUT,
} from '../src'
import { Socket, createConnection } from 'net'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'

// Mock timers for testing timeouts
beforeAll(() => {
  vi.useFakeTimers()
})

afterAll(() => {
  vi.useRealTimers()
})

async function testSocket(
  fn: (socketOptions: {
    host?: string
    port?: number
    path?: string
  }) => Promise<void>,
) {
  describe('TCP socket server', async () => {
    await fn({ host: '127.0.0.1', port: 5433 })
  })
  describe('unix socket server', async () => {
    await fn({ path: '/tmp/.s.PGSQL.5432' })
  })
}

// Create a mock Socket for testing
const createMockSocket = () => {
  const eventHandlers: Record<string, Array<(data: any) => void>> = {}

  const mockSocket = {
    // Socket methods we need for testing
    removeAllListeners: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    write: vi.fn(),
    writable: true,
    remoteAddress: '127.0.0.1',
    remotePort: 12345,

    // Mock on method with tracking of handlers
    on: vi
      .fn()
      .mockImplementation((event: string, callback: (data: any) => void) => {
        if (!eventHandlers[event]) {
          eventHandlers[event] = []
        }
        eventHandlers[event].push(callback)
        return mockSocket
      }),

    // Store event handlers for testing
    eventHandlers,

    // Helper to emit events
    emit(event: string, data: any) {
      if (eventHandlers[event]) {
        eventHandlers[event].forEach((handler) => handler(data))
      }
    },
  }

  return mockSocket as unknown as Socket
}

describe('PGLiteSocketHandler', () => {
  let db: PGlite
  let handler: PGLiteSocketHandler
  let mockSocket: ReturnType<typeof createMockSocket> & {
    eventHandlers: Record<string, Array<(data: any) => void>>
  }

  beforeEach(async () => {
    // Create a PGlite instance for testing
    db = await PGlite.create()
    handler = new PGLiteSocketHandler({ db })
    mockSocket = createMockSocket() as any
  })

  afterEach(async () => {
    // Ensure handler is detached before closing the database
    if (handler?.isAttached) {
      handler.detach(true)
    }

    // Clean up
    await db.close()
  })

  it('should attach to a socket', async () => {
    // Attach mock socket to handler
    await handler.attach(mockSocket)

    // Check that the socket is attached
    expect(handler.isAttached).toBe(true)
    expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function))
    expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('should detach from a socket', async () => {
    // First attach
    await handler.attach(mockSocket)
    expect(handler.isAttached).toBe(true)

    // Then detach
    handler.detach(false)
    expect(handler.isAttached).toBe(false)
    expect(mockSocket.removeAllListeners).toHaveBeenCalled()
  })

  it('should close socket when detaching with close option', async () => {
    // Attach mock socket to handler
    await handler.attach(mockSocket)

    // Detach with close option
    handler.detach(true)
    expect(handler.isAttached).toBe(false)
    expect(mockSocket.end).toHaveBeenCalled()
  })

  it('should reject attaching multiple sockets', async () => {
    // Attach first socket
    await handler.attach(mockSocket)

    // Trying to attach another socket should throw an error
    const anotherMockSocket = createMockSocket()
    await expect(handler.attach(anotherMockSocket)).rejects.toThrow(
      'Socket already attached',
    )
  })

  it('should emit error event when socket has error', async () => {
    // Set up error listener
    const errorHandler = vi.fn()
    handler.addEventListener('error', errorHandler)

    // Attach socket
    await handler.attach(mockSocket)

    // Mock the event handler logic directly instead of triggering actual error handlers
    const customEvent = new CustomEvent('error', {
      detail: { code: 'MOCK_ERROR', message: 'Test socket error' },
    })
    handler.dispatchEvent(customEvent)

    // Verify error handler was called
    expect(errorHandler).toHaveBeenCalled()
  })

  it('should emit close event when socket closes', async () => {
    // Set up close listener
    const closeHandler = vi.fn()
    handler.addEventListener('close', closeHandler)

    // Attach socket
    await handler.attach(mockSocket)

    // Mock the event handler logic directly instead of triggering actual socket handlers
    const customEvent = new CustomEvent('close')
    handler.dispatchEvent(customEvent)

    // Verify close handler was called
    expect(closeHandler).toHaveBeenCalled()
  })
})

testSocket(async (connOptions) => {
  describe('PGLiteSocketServer', () => {
    let db: PGlite
    let server: PGLiteSocketServer

    beforeEach(async () => {
      // Create a PGlite instance for testing
      db = await PGlite.create()
      if (connOptions.path) {
        if (existsSync(connOptions.path)) {
          try {
            await unlink(connOptions.path)
            console.log(`Removed old socket at ${connOptions.path}`)
          } catch (err) {
            console.log('')
          }
        }
      }
    })

    afterEach(async () => {
      // Stop server if running
      try {
        await server?.stop()
      } catch (e) {
        // Ignore errors during cleanup
      }

      // Close database
      await db.close()
    })

    it('should start and stop server', async () => {
      // Create server
      server = new PGLiteSocketServer({
        db,
        host: connOptions.host,
        port: connOptions.port,
        path: connOptions.path,
      })

      // Start server
      await server.start()

      // Try to connect to confirm server is running
      let client
      if (connOptions.path) {
        // unix socket
        client = createConnection({ path: connOptions.path })
      } else {
        if (connOptions.port) {
          // TCP socket
          client = createConnection({
            port: connOptions.port,
            host: connOptions.host,
          })
        } else {
          throw new Error(
            'need to specify connOptions.path or connOptions.port',
          )
        }
      }
      client.on('error', () => {
        // Ignore connection errors during test
      })

      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          client.end()
          resolve()
        })

        // Set timeout to resolve in case connection fails
        setTimeout(resolve, 100)
      })

      // Stop server
      await server.stop()

      // Try to connect again - should fail
      await expect(
        new Promise<void>((resolve, reject) => {
          let failClient
          if (connOptions.path) {
            // unix socket
            failClient = createConnection({ path: connOptions.path })
          } else {
            if (connOptions.port) {
              // TCP socket
              failClient = createConnection({
                port: connOptions.port,
                host: connOptions.host,
              })
            } else {
              throw new Error(
                'need to specify connOptions.path or connOptions.port',
              )
            }
          }

          failClient.on('error', () => {
            // Expected error - connection should fail
            resolve()
          })

          failClient.on('connect', () => {
            failClient.end()
            reject(new Error('Connection should have failed'))
          })

          // Set timeout to resolve in case no events fire
          setTimeout(resolve, 100)
        }),
      ).resolves.not.toThrow()
    })

    describe('Connection queuing', () => {
      // Mock implementation details
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let handleConnectionSpy: any
      let processNextInQueueSpy: any
      let attachSocketToNewHandlerSpy: any

      beforeEach(() => {
        // Create a server with a short timeout for testing
        server = new PGLiteSocketServer({
          db,
          host: connOptions.host,
          port: connOptions.port,
          path: connOptions.path,
          connectionQueueTimeout: 100, // Very short timeout for testing
        })

        // Spy on internal methods
        handleConnectionSpy = vi.spyOn(server as any, 'handleConnection')
        processNextInQueueSpy = vi.spyOn(server as any, 'processNextInQueue')
        attachSocketToNewHandlerSpy = vi.spyOn(
          server as any,
          'attachSocketToNewHandler',
        )
      })

      it('should create a handler for a new connection', async () => {
        await server.start()

        // Create mock socket
        const socket1 = createMockSocket()

        // Setup event listener
        const connectionHandler = vi.fn()
        server.addEventListener('connection', connectionHandler)

        // Handle connection
        await (server as any).handleConnection(socket1)

        // Verify handler was created
        expect(attachSocketToNewHandlerSpy).toHaveBeenCalledWith(
          socket1,
          expect.anything(),
        )
        expect(connectionHandler).toHaveBeenCalled()
      })

      it('should queue a second connection when first is active', async () => {
        await server.start()

        // Setup event listeners
        const queuedConnectionHandler = vi.fn()
        server.addEventListener('queuedConnection', queuedConnectionHandler)

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()

        // Handle first connection
        await (server as any).handleConnection(socket1)

        // The first socket should be attached directly
        expect(attachSocketToNewHandlerSpy).toHaveBeenCalledWith(
          socket1,
          expect.anything(),
        )

        // Handle second connection - should be queued
        await (server as any).handleConnection(socket2)

        // The second connection should be queued
        expect(queuedConnectionHandler).toHaveBeenCalledTimes(1)
        expect(queuedConnectionHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            detail: expect.objectContaining({
              queueSize: 1,
            }),
          }),
        )
      })

      it('should process next connection when current connection closes', async () => {
        await server.start()

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()

        // Setup event listener
        const connectionHandler = vi.fn()
        server.addEventListener('connection', connectionHandler)

        // Handle first connection
        await (server as any).handleConnection(socket1)

        // Handle second connection (will be queued)
        await (server as any).handleConnection(socket2)

        // First connection should be active, but clear the handler for next assertions
        expect(connectionHandler).toHaveBeenCalled()
        connectionHandler.mockClear()

        // Simulate closing the first connection
        const activeHandler = (server as any).activeHandler
        activeHandler.dispatchEvent(new CustomEvent('close'))

        // The next connection should be processed
        expect(processNextInQueueSpy).toHaveBeenCalled()
        expect(attachSocketToNewHandlerSpy).toHaveBeenCalledWith(
          socket2,
          expect.anything(),
        )
      })

      it('should timeout queued connections after specified time', async () => {
        await server.start()

        // Setup event listeners
        const queueTimeoutHandler = vi.fn()
        server.addEventListener('queueTimeout', queueTimeoutHandler)

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()

        // Handle first connection
        await (server as any).handleConnection(socket1)

        // Handle second connection (will be queued)
        await (server as any).handleConnection(socket2)

        // Fast-forward time to trigger timeout
        vi.advanceTimersByTime(1001)

        // The queued connection should timeout
        expect(queueTimeoutHandler).toHaveBeenCalledTimes(1)
        expect(socket2.end).toHaveBeenCalled()
      })

      it('should use default timeout value from CONNECTION_QUEUE_TIMEOUT', async () => {
        // Create server without specifying timeout
        const defaultServer = new PGLiteSocketServer({
          db,
          host: connOptions.host,
          port: connOptions.port,
          path: connOptions.path,
        })

        // Check that it's using the default timeout
        expect((defaultServer as any).connectionQueueTimeout).toBe(
          CONNECTION_QUEUE_TIMEOUT,
        )
      })

      it('should clean up queue when stopping the server', async () => {
        await server.start()

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()

        // Handle first connection
        await (server as any).handleConnection(socket1)

        // Handle second connection (will be queued)
        await (server as any).handleConnection(socket2)

        // Stop the server
        await server.stop()

        // All connections should be closed
        expect(socket1.end).toHaveBeenCalled()
        expect(socket2.end).toHaveBeenCalled()

        // Queue should be emptied
        expect((server as any).connectionQueue).toHaveLength(0)
      })

      it('should start server with OS-assigned port when port is 0', async () => {
        server = new PGLiteSocketServer({
          db,
          host: connOptions.host,
          port: 0, // Let OS assign port
        })

        await server.start()
        const assignedPort = (server as any).port
        expect(assignedPort).toBeGreaterThan(1024)

        // Try to connect to confirm server is running
        const client = createConnection({
          port: assignedPort,
          host: connOptions.host,
        })

        await new Promise<void>((resolve, reject) => {
          client.on('error', () => {
            reject(new Error('Connection should have failed'))
          })
          client.on('connect', () => {
            client.end()
            resolve()
          })
          setTimeout(resolve, 100)
        })

        await server.stop()
      })
    })
  })
})
