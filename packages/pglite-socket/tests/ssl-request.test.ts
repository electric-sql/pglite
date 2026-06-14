import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PGLiteSocketHandler,
  SSL_REQUEST_CODE,
  SSL_REQUEST_LENGTH,
} from '../src'

/** Second Int32 of SSLRequest — https://www.postgresql.org/docs/current/protocol-message-formats.html */

function createNetSocketStub() {
  const eventHandlers: Record<string, Array<(data?: unknown) => void>> = {}
  const socket = {
    writable: true,
    remoteAddress: '127.0.0.1',
    remotePort: 12345,
    setNoDelay: vi.fn(),
    write: vi.fn(),
    removeAllListeners: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((event: string, callback: (data?: unknown) => void) => {
      if (!eventHandlers[event]) eventHandlers[event] = []
      eventHandlers[event].push(callback)
      return socket
    }),
    emit(event: string, data?: unknown) {
      eventHandlers[event]?.forEach((h) => h(data))
    },
  }
  return socket as any
}

function createQueryQueueStub() {
  return {
    enqueue: vi.fn().mockResolvedValue(0),
    clearQueueForHandler: vi.fn(),
    clearTransactionIfNeeded: vi.fn().mockResolvedValue(undefined),
    getQueueLength: vi.fn().mockReturnValue(0),
  }
}

async function flushEventLoop(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r))
  await new Promise<void>((r) => setImmediate(r))
}

describe('PGLiteSocketHandler PostgreSQL SSLRequest (protocol-message-formats)', () => {
  let handler: PGLiteSocketHandler
  let socketStub: ReturnType<typeof createNetSocketStub>
  let queryQueueStub: ReturnType<typeof createQueryQueueStub>

  beforeEach(() => {
    queryQueueStub = createQueryQueueStub()
    handler = new PGLiteSocketHandler({
      queryQueue: queryQueueStub as any,
    })
    socketStub = createNetSocketStub()
  })

  afterEach(async () => {
    if (handler?.isAttached) {
      await handler.detach(true)
    }
  })

  it("consumes SSLRequest (8 bytes) and writes 'N' without queueing PGlite protocol", async () => {
    await handler.attach(socketStub)

    const sslRequest = Buffer.alloc(SSL_REQUEST_LENGTH)
    sslRequest.writeInt32BE(SSL_REQUEST_LENGTH, 0)
    sslRequest.writeInt32BE(SSL_REQUEST_CODE, 4)
    socketStub.emit('data', sslRequest)

    await flushEventLoop()

    expect(socketStub.write).toHaveBeenCalledWith(Buffer.from('N'))
    expect(queryQueueStub.enqueue).not.toHaveBeenCalled()
  })
})
