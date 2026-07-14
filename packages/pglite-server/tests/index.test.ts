import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PGlitePostmaster,
  ProcessExitKind,
  type PGlitePostmasterExit,
  type PGlitePostmasterShutdownMode,
  type PGliteProtocolConnection,
  type ProtocolPeerInfo,
} from '@electric-sql/pglite/postmaster'
import { PGliteServer } from '../src/index.js'

const servers = new Set<PGliteServer>()
const directories = new Set<string>()

afterEach(async () => {
  await Promise.allSettled([...servers].map((server) => server.close()))
  servers.clear()
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
  directories.clear()
})

describe('PGliteServer', () => {
  it('forwards arbitrary TCP bytes without parsing or reassembly', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = server.address!
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
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = server.address!
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
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = server.address!
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

  it('turns an abrupt client reset into backend EOF', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = server.address!
    if (address.transport !== 'tcp') throw new Error('expected TCP address')
    const socket = createConnection(address.port, address.host)
    await once(socket, 'connect')
    const connection = await postmaster.nextConnection()

    socket.resetAndDestroy()
    await waitFor(() => connection.ended)
    expect(connection.aborted).toBe(false)
    connection.closeBackend()
    await waitFor(() => server.connectionCount === 0)
  })

  it('closes a waiting client immediately when the backend stream fails', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = server.address!
    if (address.transport !== 'tcp') throw new Error('expected TCP address')
    const socket = createConnection(address.port, address.host)
    socket.on('error', () => undefined)
    await once(socket, 'connect')
    const connection = await postmaster.nextConnection()
    const socketClosed = new Promise<void>((resolveClose) => {
      socket.once('close', () => resolveClose())
    })

    connection.failBackend(new Error('synthetic backend failure'))

    await socketClosed
    await waitFor(() => server.connectionCount === 0)
    expect(connection.aborted).toBe(true)
  })

  it('uses PostgreSQL Unix-socket naming and cleans lifecycle metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pglite-socket-'))
    directories.add(directory)
    const postmaster = new FakePostmaster()
    const server = tracked(
      await PGliteServer.create({
        postmaster,
        listen: { directory, port: 55432 },
      }),
    )
    const address = server.address!
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
    await server.close()
    expect(existsSync(address.path)).toBe(false)
    expect(existsSync(address.lockPath!)).toBe(false)
  })

  it('aborts every virtual connection when the frontend stops', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    const address = server.address!
    if (address.transport !== 'tcp') throw new Error('expected TCP address')
    const socket = createConnection(address.port, address.host)
    await once(socket, 'connect')
    const connection = await postmaster.nextConnection()
    await server.close()
    expect(connection.aborted).toBe(true)
    expect(server.connectionCount).toBe(0)
    expect(server.isListening).toBe(false)
  })

  it('does not shut down a caller-owned postmaster', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )

    await expect(server.close({ mode: 'fast' })).rejects.toThrow(
      'caller-owned postmaster',
    )
    expect(server.isListening).toBe(true)
    await server.close()
    expect(postmaster.shutdownCalls).toEqual([])
  })

  it('closes its listener when the postmaster exits', async () => {
    const postmaster = new FakePostmaster()
    const server = tracked(
      await PGliteServer.create({
        postmaster,
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )

    postmaster.exit()
    await waitFor(() => !server.isListening)
    expect(server.address).toBeUndefined()
  })

  it('cleans up only an owned postmaster after listener startup fails', async () => {
    const occupied = tracked(
      await PGliteServer.create({
        postmaster: new FakePostmaster(),
        listen: { host: '127.0.0.1', port: 0 },
      }),
    )
    if (occupied.address?.transport !== 'tcp') {
      throw new Error('expected TCP address')
    }
    const listen = {
      host: occupied.address.host,
      port: occupied.address.port,
    }

    const callerOwned = new FakePostmaster()
    await expect(
      PGliteServer.create({ postmaster: callerOwned, listen }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(callerOwned.shutdownCalls).toEqual([])

    const serverOwned = new FakePostmaster()
    const createPostmaster = vi
      .spyOn(PGlitePostmaster, 'create')
      .mockResolvedValue(serverOwned as unknown as PGlitePostmaster)
    try {
      await expect(
        PGliteServer.create({
          postmaster: { dataDir: '/unused-test-data-directory' },
          listen,
        }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect(serverOwned.shutdownCalls).toEqual(['immediate'])
    } finally {
      createPostmaster.mockRestore()
    }
  })
})

class FakePostmaster {
  readonly peers: ProtocolPeerInfo[] = []
  readonly shutdownCalls: PGlitePostmasterShutdownMode[] = []
  private readonly pending = new AsyncQueue<FakeProtocolConnection>()
  private readonly exitPromise: Promise<PGlitePostmasterExit>
  private resolveExit!: (exit: PGlitePostmasterExit) => void

  constructor() {
    this.exitPromise = new Promise((resolveExit) => {
      this.resolveExit = resolveExit
    })
  }

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

  waitForExit(): Promise<PGlitePostmasterExit> {
    return this.exitPromise
  }

  async shutdown(mode: PGlitePostmasterShutdownMode): Promise<void> {
    this.shutdownCalls.push(mode)
    this.exit()
  }

  exit(): void {
    this.resolveExit({ exitKind: ProcessExitKind.Normal, exitCode: 0 })
  }
}

class FakeProtocolConnection implements PGliteProtocolConnection {
  readonly received: Uint8Array[] = []
  readonly readable: AsyncIterable<Uint8Array>
  readonly closed: Promise<void>
  aborted = false
  ended = false
  writeStarted = false

  private readonly output = new AsyncQueue<Uint8Array | Error | null>()
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

  async end(): Promise<void> {
    this.ended = true
  }

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

  failBackend(error: Error): void {
    this.output.push(error)
    this.resolveClosed()
  }

  private async *readOutput(): AsyncGenerator<Uint8Array> {
    while (true) {
      const value = await this.output.shift()
      if (value === null) return
      if (value instanceof Error) throw value
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

function tracked(server: PGliteServer): PGliteServer {
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
