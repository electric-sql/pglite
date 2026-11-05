import { describe, it, expect, vi, afterEach } from 'vitest'
import { PGLiteSocketHandler, SSL_REQUEST_CODE } from '../src'

const CHUNK_BYTES = 64 * 1024
const PROTOCOL_3_0 = 196608

function createSocketStub() {
  const handlers: Record<string, Array<(data?: unknown) => void>> = {}
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
      ;(handlers[event] ??= []).push(callback)
      return socket
    }),
    emit(event: string, data?: unknown) {
      handlers[event]?.forEach((handler) => handler(data))
    },
  }
  return socket as any
}

async function attachedHandler() {
  const queryQueue = {
    enqueue: vi.fn().mockResolvedValue(0),
    clearQueueForHandler: vi.fn(),
    clearTransactionIfNeeded: vi.fn().mockResolvedValue(undefined),
    getQueueLength: vi.fn().mockReturnValue(0),
  }
  const socket = createSocketStub()
  const handler = new PGLiteSocketHandler({ queryQueue: queryQueue as any })
  await handler.attach(socket)
  return { handler, socket, queryQueue }
}

/** Socket data is handled on setImmediate; one turn per chunk drains them in order. */
async function send(socket: any, ...chunks: Buffer[]) {
  for (const chunk of chunks) {
    socket.emit('data', chunk)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function regularMessage(type: string, bodyBytes: number) {
  const message = Buffer.alloc(5 + bodyBytes, 0x78)
  message.write(type, 0)
  message.writeInt32BE(4 + bodyBytes, 1)
  return message
}

function startupMessage() {
  const params = Buffer.from('user\0postgres\0database\0postgres\0\0')
  const message = Buffer.alloc(8 + params.length)
  message.writeInt32BE(message.length, 0)
  message.writeInt32BE(PROTOCOL_3_0, 4)
  params.copy(message, 8)
  return message
}

function splitIntoChunks(message: Buffer) {
  const chunks: Buffer[] = []
  for (let at = 0; at < message.length; at += CHUNK_BYTES) {
    chunks.push(message.subarray(at, at + CHUNK_BYTES))
  }
  return chunks
}

function enqueuedMessages(queryQueue: { enqueue: any }) {
  return queryQueue.enqueue.mock.calls.map((call: unknown[]) => call[1])
}

describe('PGLiteSocketHandler chunked messages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('copies a large message once, not once per chunk', async () => {
    const { socket, queryQueue } = await attachedHandler()
    const message = regularMessage('Q', 4 * 1024 * 1024)
    const concat = vi.spyOn(Buffer, 'concat')

    await send(socket, ...splitIntoChunks(message))

    const copiedBytes = concat.mock.results.reduce(
      (total, result) => total + (result.value as Buffer).length,
      0,
    )
    // The header arrives in the first chunk, which is also joined once.
    expect(copiedBytes).toBe(CHUNK_BYTES + message.length)
    expect(enqueuedMessages(queryQueue)).toHaveLength(1)
    expect(Buffer.compare(enqueuedMessages(queryQueue)[0], message)).toBe(0)
  })

  it('keeps message boundaries when a chunk ends inside the next message', async () => {
    const { socket, queryQueue } = await attachedHandler()
    const first = regularMessage('Q', 10)
    const second = regularMessage('P', 200)
    const stream = Buffer.concat([first, second])
    const cut = first.length + 20

    await send(socket, stream.subarray(0, cut), stream.subarray(cut))

    const messages = enqueuedMessages(queryQueue)
    expect(Buffer.compare(messages[0], first)).toBe(0)
    expect(Buffer.compare(messages[1], second)).toBe(0)
  })

  it('handles a message header split across chunks', async () => {
    const { socket, queryQueue } = await attachedHandler()
    const message = regularMessage('Q', 200)

    await send(socket, message.subarray(0, 3), message.subarray(3))

    expect(Buffer.compare(enqueuedMessages(queryQueue)[0], message)).toBe(0)
  })

  it.each([6, 20])(
    'completes a startup message split after %i bytes',
    async (cut) => {
      const { socket, queryQueue } = await attachedHandler()
      const message = startupMessage()

      await send(socket, message.subarray(0, cut), message.subarray(cut))

      expect(Buffer.compare(enqueuedMessages(queryQueue)[0], message)).toBe(0)
    },
  )

  it('answers an SSLRequest split across chunks', async () => {
    const { socket } = await attachedHandler()
    const message = Buffer.alloc(8)
    message.writeInt32BE(8, 0)
    message.writeInt32BE(SSL_REQUEST_CODE, 4)

    await send(socket, message.subarray(0, 6), message.subarray(6))

    expect(socket.write).toHaveBeenCalledWith(Buffer.from('N'))
  })

  it('drops a partial message when the socket detaches', async () => {
    const { handler, socket, queryQueue } = await attachedHandler()
    const message = regularMessage('Q', 200)
    await send(socket, message.subarray(0, 50))

    await handler.detach()
    const nextSocket = createSocketStub()
    await handler.attach(nextSocket)
    const next = regularMessage('P', 10)
    await send(nextSocket, next)

    expect(Buffer.compare(enqueuedMessages(queryQueue)[0], next)).toBe(0)
  })

  it('emits a data event for every chunk', async () => {
    const { handler, socket } = await attachedHandler()
    const incoming: number[] = []
    handler.addEventListener('data', (event) =>
      incoming.push((event as CustomEvent).detail.incoming),
    )
    const message = regularMessage('Q', 200)

    await send(
      socket,
      message.subarray(0, 100),
      message.subarray(100, 150),
      message.subarray(150),
    )

    expect(incoming).toEqual([100, 50, message.length - 150])
  })
})
