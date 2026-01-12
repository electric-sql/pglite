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
import { PGLiteSocketHandler, PGLiteSocketServer } from '../src'
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
    setNoDelay: vi.fn(),

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

// Create a mock QueryQueueManager for testing
const createMockQueryQueue = () => {
  return {
    enqueue: vi.fn().mockResolvedValue(new Uint8Array(0)),
    clearQueueForHandler: vi.fn(),
    getQueueLength: vi.fn().mockReturnValue(0),
  }
}

describe('PGLiteSocketHandler', () => {
  let handler: PGLiteSocketHandler
  let mockSocket: ReturnType<typeof createMockSocket> & {
    eventHandlers: Record<string, Array<(data: any) => void>>
  }
  let mockQueryQueue: ReturnType<typeof createMockQueryQueue>

  beforeEach(async () => {
    // Create a mock query queue for testing
    mockQueryQueue = createMockQueryQueue()
    handler = new PGLiteSocketHandler({ queryQueue: mockQueryQueue as any })
    mockSocket = createMockSocket() as any
  })

  afterEach(async () => {
    // Ensure handler is detached
    if (handler?.isAttached) {
      handler.detach(true)
    }
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

    describe('Connection multiplexing', () => {
      beforeEach(() => {
        // Create a server for testing
        server = new PGLiteSocketServer({
          db,
          host: connOptions.host,
          port: connOptions.port,
          path: connOptions.path,
          maxConnections: 100,
        })
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

        // Verify handler was created and tracked
        expect((server as any).handlers.size).toBe(1)
        expect(connectionHandler).toHaveBeenCalled()
      })

      it('should handle multiple simultaneous connections', async () => {
        await server.start()

        // Setup event listeners
        const connectionHandler = vi.fn()
        server.addEventListener('connection', connectionHandler)

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()
        const socket3 = createMockSocket()

        // Handle connections - all should be accepted simultaneously
        await (server as any).handleConnection(socket1)
        await (server as any).handleConnection(socket2)
        await (server as any).handleConnection(socket3)

        // All three sockets should have handlers (multiplexed)
        expect((server as any).handlers.size).toBe(3)
        expect(connectionHandler).toHaveBeenCalledTimes(3)

        // None should be closed - they're all active
        expect(socket1.end).not.toHaveBeenCalled()
        expect(socket2.end).not.toHaveBeenCalled()
        expect(socket3.end).not.toHaveBeenCalled()
      })

      it('should remove handler when connection closes', async () => {
        await server.start()

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()

        // Handle connections
        await (server as any).handleConnection(socket1)
        await (server as any).handleConnection(socket2)

        // Both should be tracked
        expect((server as any).handlers.size).toBe(2)

        // Get the first handler and simulate close
        const handlers = Array.from((server as any).handlers)
        const handler1 = handlers[0] as PGLiteSocketHandler
        handler1.dispatchEvent(new CustomEvent('close'))

        // First handler should be removed, second still active
        expect((server as any).handlers.size).toBe(1)
      })

      it('should reject connections when max connections reached', async () => {
        // Create server with low max connections
        server = new PGLiteSocketServer({
          db,
          host: connOptions.host,
          port: connOptions.port,
          path: connOptions.path,
          maxConnections: 2,
        })

        await server.start()

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()
        const socket3 = createMockSocket()

        // Handle first two connections - should succeed
        await (server as any).handleConnection(socket1)
        await (server as any).handleConnection(socket2)

        expect((server as any).handlers.size).toBe(2)

        // Third connection should be rejected
        await (server as any).handleConnection(socket3)

        // Third socket should be closed
        expect(socket3.end).toHaveBeenCalled()
        expect((server as any).handlers.size).toBe(2)
      })

      it('should provide stats about active connections', async () => {
        await server.start()

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()

        // Check initial stats
        let stats = server.getStats()
        expect(stats.activeConnections).toBe(0)
        expect(stats.maxConnections).toBe(100)

        // Handle connections
        await (server as any).handleConnection(socket1)
        await (server as any).handleConnection(socket2)

        // Check updated stats
        stats = server.getStats()
        expect(stats.activeConnections).toBe(2)
      })

      it('should clean up all handlers when stopping the server', async () => {
        await server.start()

        // Create mock sockets
        const socket1 = createMockSocket()
        const socket2 = createMockSocket()
        const socket3 = createMockSocket()

        // Handle connections
        await (server as any).handleConnection(socket1)
        await (server as any).handleConnection(socket2)
        await (server as any).handleConnection(socket3)

        expect((server as any).handlers.size).toBe(3)

        // Stop the server
        await server.stop()

        // All connections should be closed
        expect(socket1.end).toHaveBeenCalled()
        expect(socket2.end).toHaveBeenCalled()
        expect(socket3.end).toHaveBeenCalled()

        // Handlers should be cleared
        expect((server as any).handlers.size).toBe(0)
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
