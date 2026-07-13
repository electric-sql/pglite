import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  PGliteProtocolConnection,
  ProtocolPeerInfo,
} from '@electric-sql/pglite/postmaster'
import { PGliteSocketServer } from '../src/index.js'

const servers = new Set<PGliteSocketServer>()
const directories = new Set<string>()

afterEach(async () => {
  await Promise.allSettled([...servers].map((server) => server.stop()))
  servers.clear()
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
  directories.clear()
})

describe('PGliteSocketServer', () => {
  it('forwards arbitrary TCP bytes without parsing or reassembly', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      new PGliteSocketServer({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = await server.start()
    expect(address.transport).toBe('tcp')
    if (address.transport !== 'tcp') throw new Error('expected TCP address')

    const socket = createConnection(address.port, address.host)
    await once(socket, 'connect')
    const connection = await postmaster.nextConnection()
    expect(postmaster.peers).toEqual([
      expect.objectContaining({ transport: 'tcp' }),
    ])

    socket.write(Uint8Array.of(0, 0, 0))
    socket.write(Uint8Array.of(8, 4, 210, 22, 47))
    await waitFor(() => flatten(connection.received).length === 8)
    expect(flatten(connection.received)).toEqual(
      Uint8Array.of(0, 0, 0, 8, 4, 210, 22, 47),
    )

    const response = readBytes(socket, 7)
    connection.publish(Uint8Array.of(78))
    connection.publish(Uint8Array.of(82, 0, 0, 0, 4, 0))
    expect(await response).toEqual(Uint8Array.of(78, 82, 0, 0, 0, 4, 0))

    connection.closeBackend()
    await once(socket, 'close')
    await waitFor(() => server.connectionCount === 0)
    expect(server.connectionCount).toBe(0)
  })

  it('maps concurrent sockets to independent postmaster connections', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      new PGliteSocketServer({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = await server.start()
    if (address.transport !== 'tcp') throw new Error('expected TCP address')
    const sockets = [
      createConnection(address.port, address.host),
      createConnection(address.port, address.host),
    ]
    await Promise.all(sockets.map((socket) => once(socket, 'connect')))
    const connections = await Promise.all([
      postmaster.nextConnection(),
      postmaster.nextConnection(),
    ])
    await waitFor(() => server.connectionCount === 2)

    sockets[0].write(Uint8Array.of(1, 2, 3))
    sockets[1].write(Uint8Array.of(4, 5, 6))
    await waitFor(() => connections.every(({ received }) => received.length))
    expect(flatten(connections[0].received)).toEqual(Uint8Array.of(1, 2, 3))
    expect(flatten(connections[1].received)).toEqual(Uint8Array.of(4, 5, 6))

    connections.forEach((connection) => connection.closeBackend())
    await Promise.all(sockets.map((socket) => once(socket, 'close')))
  })

  it('keeps outbound progress independent while inbound applies backpressure', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      new PGliteSocketServer({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = await server.start()
    if (address.transport !== 'tcp') throw new Error('expected TCP address')
    const socket = createConnection(address.port, address.host)
    await once(socket, 'connect')
    const connection = await postmaster.nextConnection()
    const releaseInbound = connection.blockWrites()

    socket.write(new Uint8Array(32 * 1024).fill(7))
    await waitFor(() => connection.writeStarted)
    const outbound = readBytes(socket, 4)
    connection.publish(Uint8Array.of(9, 8, 7, 6))
    expect(await outbound).toEqual(Uint8Array.of(9, 8, 7, 6))

    releaseInbound()
    await waitFor(() => flatten(connection.received).length === 32 * 1024)
    connection.closeBackend()
    await once(socket, 'close')
  })

  it('uses PostgreSQL Unix-socket naming and cleans lifecycle metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pglite-socket-'))
    directories.add(directory)
    const postmaster = new FakePostmaster()
    const server = tracked(
      new PGliteSocketServer({
        postmaster,
        listen: { directory, port: 55432 },
      }),
    )
    const address = await server.start()
    expect(address).toEqual({
      transport: 'unix',
      directory,
      port: 55432,
      path: join(directory, '.s.PGSQL.55432'),
      lockPath: join(directory, '.s.PGSQL.55432.lock'),
    })
    if (address.transport !== 'unix') throw new Error('expected Unix address')
    expect(existsSync(address.path)).toBe(true)
    expect(existsSync(address.lockPath!)).toBe(true)

    const socket = createConnection(address.path)
    await once(socket, 'connect')
    const connection = await postmaster.nextConnection()
    expect(postmaster.peers).toEqual([{ transport: 'unix' }])
    connection.closeBackend()
    await once(socket, 'close')
    await server.stop()
    expect(existsSync(address.path)).toBe(false)
    expect(existsSync(address.lockPath!)).toBe(false)
  })

  it('aborts every virtual connection when the frontend stops', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      new PGliteSocketServer({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = await server.start()
    if (address.transport !== 'tcp') throw new Error('expected TCP address')
    const socket = createConnection(address.port, address.host)
    await once(socket, 'connect')
    const connection = await postmaster.nextConnection()
    await server.stop()
    expect(connection.aborted).toBe(true)
    expect(server.connectionCount).toBe(0)
    expect(server.isListening).toBe(false)
  })
})

class FakePostmaster {
  readonly peers: ProtocolPeerInfo[] = []
  private readonly pending = new AsyncQueue<FakeProtocolConnection>()

  async openProtocolConnection(
    peer?: ProtocolPeerInfo,
  ): Promise<PGliteProtocolConnection> {
    this.peers.push(peer ?? { transport: 'tcp' })
    const connection = new FakeProtocolConnection()
    this.pending.push(connection)
    return connection
  }

  nextConnection(): Promise<FakeProtocolConnection> {
    return this.pending.shift()
  }
}

class FakeProtocolConnection implements PGliteProtocolConnection {
  readonly received: Uint8Array[] = []
  readonly readable: AsyncIterable<Uint8Array>
  readonly closed: Promise<void>
  aborted = false
  writeStarted = false

  private readonly output = new AsyncQueue<Uint8Array | null>()
  private resolveClosed!: () => void
  private writeBarrier?: Promise<void>

  constructor() {
    this.closed = new Promise((resolveClosed) => {
      this.resolveClosed = resolveClosed
    })
    this.readable = this.readOutput()
  }

  blockWrites(): () => void {
    let release!: () => void
    this.writeBarrier = new Promise((resolveWrite) => {
      release = resolveWrite
    })
    return release
  }

  async write(data: Uint8Array): Promise<void> {
    this.writeStarted = true
    await this.writeBarrier
    this.received.push(data.slice())
  }

  async end(): Promise<void> {}

  abort(): void {
    this.aborted = true
    this.output.push(null)
    this.resolveClosed()
  }

  publish(data: Uint8Array): void {
    this.output.push(data)
  }

  closeBackend(): void {
    this.output.push(null)
    this.resolveClosed()
  }

  private async *readOutput(): AsyncGenerator<Uint8Array> {
    while (true) {
      const value = await this.output.shift()
      if (value === null) return
      yield value
    }
  }
}

class AsyncQueue<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: T) => void> = []

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter(value)
    else this.values.push(value)
  }

  shift(): Promise<T> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve(value)
    return new Promise((resolveValue) => this.waiters.push(resolveValue))
  }
}

function tracked(server: PGliteSocketServer): PGliteSocketServer {
  servers.add(server)
  return server
}

function flatten(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  )
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function readBytes(socket: Socket, count: number): Promise<Uint8Array> {
  return new Promise((resolveRead, rejectRead) => {
    const chunks: Uint8Array[] = []
    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      const bytes = flatten(chunks)
      if (bytes.byteLength >= count) {
        cleanup()
        resolveRead(bytes.slice(0, count))
      }
    }
    const onError = (error: Error) => {
      cleanup()
      rejectRead(error)
    }
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
    }
    socket.on('data', onData)
    socket.on('error', onError)
  })
}

async function waitFor(
  predicate: () => boolean,
  timeout = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise((resolveWait) => setTimeout(resolveWait, 5))
  }
}
