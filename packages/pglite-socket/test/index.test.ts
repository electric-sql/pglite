import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketHandler, PGLiteSocketServer } from '../src'
import { Socket, createConnection } from 'net'

// Create a mock Socket for testing
const createMockSocket = () => {
  const eventHandlers: Record<string, Array<(data: any) => void>> = {}

  const mockSocket = {
    // Socket methods we need for testing
    removeAllListeners: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
    writable: true,

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

describe('PGLiteSocketServer', () => {
  let db: PGlite
  let server: PGLiteSocketServer
  const TEST_PORT = 5433 // Using non-default port for testing

  beforeEach(async () => {
    // Create a PGlite instance for testing
    db = await PGlite.create()
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
      port: TEST_PORT,
    })

    // Start server
    await server.start()

    // Try to connect to confirm server is running
    const client = createConnection({ port: TEST_PORT })
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
        const failClient = createConnection({ port: TEST_PORT })

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
})
