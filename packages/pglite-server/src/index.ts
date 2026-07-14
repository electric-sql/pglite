import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net'
import {
  PGlitePostmaster,
  type PGlitePostmasterOptions,
  type PGlitePostmasterShutdownMode,
  type PGliteProtocolConnection,
  type ProtocolPeerInfo,
} from '@electric-sql/pglite/postmaster'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 5432

export interface PGliteServerTcpListenOptions {
  readonly host?: string
  readonly port?: number
  readonly path?: never
  readonly directory?: never
}

export interface PGliteServerUnixPathListenOptions {
  readonly path: string
  readonly host?: never
  readonly directory?: never
  readonly port?: never
}

export interface PGliteServerUnixDirectoryListenOptions {
  readonly directory: string
  readonly port?: number
  readonly host?: never
  readonly path?: never
}

export type PGliteServerListenOptions =
  | PGliteServerTcpListenOptions
  | PGliteServerUnixPathListenOptions
  | PGliteServerUnixDirectoryListenOptions

export type PGliteServerAddress =
  | {
      readonly transport: 'tcp'
      readonly host: string
      readonly port: number
    }
  | {
      readonly transport: 'unix'
      readonly path: string
      readonly directory?: string
      readonly port?: number
      readonly lockPath?: string
    }

interface PGliteServerBaseOptions {
  readonly listen?: PGliteServerListenOptions
  readonly debug?: boolean
}

export type PGliteServerPostmaster = Pick<
  PGlitePostmaster,
  'openProtocolConnection' | 'waitForExit' | 'shutdown'
>

export interface PGliteServerWithPostmasterOptions
  extends PGliteServerBaseOptions {
  /** A caller-owned postmaster. Closing the server does not close it. */
  readonly postmaster: PGliteServerPostmaster
}

export interface PGliteServerOwnedPostmasterOptions
  extends PGliteServerBaseOptions {
  /** Options used to create a postmaster owned by the server. */
  readonly postmaster: PGlitePostmasterOptions
}

export type PGliteServerOptions =
  | PGliteServerWithPostmasterOptions
  | PGliteServerOwnedPostmasterOptions

export interface PGliteServerCloseOptions {
  /** Valid only when the server created and owns its postmaster. */
  readonly mode?: PGlitePostmasterShutdownMode
}

/**
 * A byte-transparent Node socket frontend for `PGlitePostmaster`.
 *
 * PostgreSQL, not this package, owns startup, authentication, protocol
 * framing, session state, connection admission, cancellation, and errors.
 * Each accepted OS socket maps to one raw virtual postmaster connection.
 */
export class PGliteServer extends EventTarget {
  readonly postmaster: PGliteServerPostmaster

  private readonly configuredAddress: PGliteServerAddress
  private readonly debug: boolean
  private readonly ownsPostmaster: boolean
  private readonly bridges = new Set<SocketBridge>()
  private server?: Server
  private currentAddress?: PGliteServerAddress
  private active = false
  private closePromise?: Promise<void>

  private constructor(
    postmaster: PGliteServerPostmaster,
    options: PGliteServerBaseOptions,
    ownsPostmaster: boolean,
  ) {
    super()
    this.postmaster = postmaster
    this.configuredAddress = resolveListenAddress(options.listen ?? {})
    this.debug = options.debug ?? false
    this.ownsPostmaster = ownsPostmaster
  }

  static async create(options: PGliteServerOptions): Promise<PGliteServer> {
    const ownsPostmaster = !isPostmaster(options.postmaster)
    const postmaster = ownsPostmaster
      ? await PGlitePostmaster.create(options.postmaster)
      : options.postmaster
    const server = new PGliteServer(postmaster, options, ownsPostmaster)

    try {
      await server.start()
    } catch (error) {
      if (ownsPostmaster) {
        await postmaster.shutdown('immediate').catch(() => undefined)
      }
      throw error
    }

    void postmaster
      .waitForExit()
      .then(() => server.stopListeners())
      .catch((error) => server.emit('error', toError(error)))
    return server
  }

  get address(): PGliteServerAddress | undefined {
    return this.currentAddress
  }

  get connectionCount(): number {
    return this.bridges.size
  }

  get isListening(): boolean {
    return this.active
  }

  private async start(): Promise<PGliteServerAddress> {
    if (this.server) throw new Error('PGlite socket server is already started')

    const configured = this.configuredAddress
    if (configured.transport === 'unix') {
      mkdirSync(dirname(configured.path), { recursive: true })
      if (configured.lockPath && existsSync(configured.lockPath)) {
        throw new Error(
          `PostgreSQL Unix-socket lock already exists: ${configured.lockPath}`,
        )
      }
    }

    const server = createServer({ allowHalfOpen: true }, (socket) => {
      void this.accept(socket)
    })
    this.server = server
    this.active = true

    const startupError = (error: Error) => {
      this.emit('error', error)
    }
    server.on('error', startupError)

    let lockWritten = false
    try {
      await new Promise<void>((resolveStart, rejectStart) => {
        const reject = (error: Error) => rejectStart(error)
        server.once('error', reject)
        const ready = () => {
          server.off('error', reject)
          resolveStart()
        }
        if (configured.transport === 'unix') {
          server.listen(configured.path, ready)
        } else {
          server.listen(configured.port, configured.host, ready)
        }
      })

      if (configured.transport === 'tcp') {
        const address = server.address()
        if (!address || typeof address === 'string') {
          throw new Error('TCP listener did not return an address')
        }
        this.currentAddress = {
          transport: 'tcp',
          host: configured.host,
          port: (address as AddressInfo).port,
        }
      } else {
        this.currentAddress = configured
        if (configured.lockPath) {
          writeSocketLock(configured)
          lockWritten = true
        }
      }

      this.log(`listening on ${formatAddress(this.currentAddress)}`)
      this.emit('listening', this.currentAddress)
      return this.currentAddress
    } catch (error) {
      this.active = false
      this.server = undefined
      server.close()
      if (lockWritten && configured.transport === 'unix') {
        rmSync(configured.lockPath!, { force: true })
      }
      throw error
    }
  }

  async close(options: PGliteServerCloseOptions = {}): Promise<void> {
    if (!this.ownsPostmaster && options.mode !== undefined) {
      throw new Error(
        'A shutdown mode cannot be passed for a caller-owned postmaster',
      )
    }
    this.closePromise ??= this.finishClose(options.mode)
    return this.closePromise
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private async finishClose(
    mode: PGlitePostmasterShutdownMode | undefined,
  ): Promise<void> {
    await this.stopListeners()
    if (this.ownsPostmaster) await this.postmaster.shutdown(mode ?? 'smart')
  }

  private async stopListeners(): Promise<void> {
    const server = this.server
    if (!server) return

    // Stop admission before aborting bridges. `server.close()` does not
    // resolve until existing sockets close, so initiate it first and await it
    // only after both pumps have been woken.
    this.active = false
    this.server = undefined
    const serverClosed = new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()))
    })

    for (const bridge of this.bridges) {
      bridge.abort(new Error('PGlite socket frontend stopped'))
    }
    await Promise.allSettled([...this.bridges].map(({ closed }) => closed))
    await serverClosed
    removeSocketMetadata(this.currentAddress ?? this.configuredAddress)
    this.currentAddress = undefined
    this.emit('close', undefined)
  }

  private async accept(socket: Socket): Promise<void> {
    if (!this.active) {
      socket.destroy()
      return
    }

    if (this.configuredAddress.transport === 'tcp') socket.setNoDelay(true)
    const peer: ProtocolPeerInfo =
      this.configuredAddress.transport === 'unix'
        ? { transport: 'unix' }
        : {
            transport: 'tcp',
            remoteAddress: socket.remoteAddress,
            remotePort: socket.remotePort,
          }

    try {
      const connection = await this.postmaster.openProtocolConnection(peer)
      if (!this.active || socket.destroyed) {
        connection.abort(new Error('socket closed before virtual admission'))
        socket.destroy()
        return
      }
      const bridge = new SocketBridge(socket, connection, this.debug)
      this.bridges.add(bridge)
      this.emit('connection', {
        transport: peer.transport,
        remoteAddress: peer.remoteAddress,
        remotePort: peer.remotePort,
      })
      try {
        await bridge.closed
      } finally {
        this.bridges.delete(bridge)
      }
    } catch (error) {
      socket.destroy()
      this.emit('connection-error', toError(error))
    }
  }

  private log(message: string): void {
    if (this.debug) console.log(`[PGliteServer] ${message}`)
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

class SocketBridge {
  readonly closed: Promise<void>

  private abortReason?: Error

  constructor(
    private readonly socket: Socket,
    private readonly connection: PGliteProtocolConnection,
    private readonly debug: boolean,
  ) {
    this.closed = this.run()
  }

  abort(reason: unknown): void {
    if (this.abortReason) return
    this.abortReason = toError(reason)
    try {
      this.connection.abort(this.abortReason)
    } catch {
      // A generation-safe transport can already have been released and
      // reused after PostgreSQL closed it. Never let a stale bridge mutate
      // the next connection occupying that ring slot.
    }
    this.socket.destroy(this.abortReason)
  }

  private async run(): Promise<void> {
    const onSocketError = (error: Error) => {
      if (!this.abortReason) {
        this.abortReason = error
        // A TCP reset is an ordinary PostgreSQL client disconnect, not a
        // backend failure.  Close only the frontend-to-backend direction so
        // recv() observes EOF and PostgreSQL performs normal proc_exit(0)
        // cleanup.  Reserve a ring abort for an internal bridge failure or
        // an explicit frontend shutdown.
        void this.connection.end().catch((closeError) => {
          try {
            this.connection.abort(closeError)
          } catch {
            // The ring was already released and reused by a newer client.
          }
        })
      }
    }
    this.socket.on('error', onSocketError)

    // Observe each pump failure immediately. Waiting for both before aborting
    // deadlocks when the backend ring fails while the client is still waiting
    // for a response and therefore keeps its write half open.
    const results = await Promise.allSettled([
      this.watchPump(this.pumpInbound()),
      this.watchPump(this.pumpOutbound()),
    ])
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (failure && !this.abortReason) this.abort(failure.reason)

    this.socket.off('error', onSocketError)
    if (!this.socket.destroyed) this.socket.destroy()
    await this.connection.closed.catch(() => undefined)
    if (this.debug && failure) {
      console.error('[PGliteServer] bridge failed', failure.reason)
    }
  }

  private async watchPump(pump: Promise<void>): Promise<void> {
    try {
      await pump
    } catch (error) {
      if (!this.abortReason) this.abort(error)
      throw error
    }
  }

  private async pumpInbound(): Promise<void> {
    try {
      for await (const chunk of this.socket) {
        const bytes =
          typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk)
        if (bytes.byteLength > 0) await this.connection.write(bytes)
      }
      await this.connection.end()
    } catch (error) {
      if (!this.abortReason) throw error
    }
  }

  private async pumpOutbound(): Promise<void> {
    try {
      for await (const chunk of this.connection.readable) {
        if (this.socket.destroyed) return
        if (!this.socket.write(chunk)) await waitForDrain(this.socket)
      }
      if (!this.socket.destroyed) {
        await new Promise<void>((resolveEnd) => this.socket.end(resolveEnd))
      }
    } catch (error) {
      if (!this.abortReason) throw error
    }
  }
}

async function waitForDrain(socket: Socket): Promise<void> {
  await new Promise<void>((resolveDrain, rejectDrain) => {
    const cleanup = () => {
      socket.off('drain', onDrain)
      socket.off('close', onClose)
      socket.off('error', onError)
    }
    const onDrain = () => {
      cleanup()
      resolveDrain()
    }
    const onClose = () => {
      cleanup()
      rejectDrain(
        new Error('socket closed while applying outbound backpressure'),
      )
    }
    const onError = (error: Error) => {
      cleanup()
      rejectDrain(error)
    }
    socket.once('drain', onDrain)
    socket.once('close', onClose)
    socket.once('error', onError)
  })
}

function resolveListenAddress(
  listen: PGliteServerListenOptions,
): PGliteServerAddress {
  if ('path' in listen && listen.path !== undefined) {
    return { transport: 'unix', path: resolve(listen.path) }
  }
  if ('directory' in listen && listen.directory !== undefined) {
    const port = validatedPort(listen.port ?? DEFAULT_PORT, false)
    const directory = resolve(listen.directory)
    const path = join(directory, `.s.PGSQL.${port}`)
    return {
      transport: 'unix',
      directory,
      port,
      path,
      lockPath: `${path}.lock`,
    }
  }
  return {
    transport: 'tcp',
    host: listen.host ?? DEFAULT_HOST,
    port: validatedPort(listen.port ?? DEFAULT_PORT, true),
  }
}

function validatedPort(value: number, allowZero: boolean): number {
  if (
    !Number.isInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 65_535
  ) {
    throw new RangeError(`invalid PostgreSQL socket port: ${value}`)
  }
  return value
}

function formatAddress(address: PGliteServerAddress): string {
  return address.transport === 'unix'
    ? address.path
    : `${address.host}:${address.port}`
}

function writeSocketLock(
  address: Extract<PGliteServerAddress, { transport: 'unix' }>,
): void {
  if (!address.lockPath || !address.directory || !address.port) return
  const contents = [
    process.pid,
    address.directory,
    Math.floor(Date.now() / 1_000),
    address.port,
    address.directory,
    '',
    'ready',
  ].join('\n')
  writeFileSync(address.lockPath, `${contents}\n`, { flag: 'wx' })
}

function removeSocketMetadata(address: PGliteServerAddress): void {
  if (address.transport !== 'unix') return
  if (address.lockPath && existsSync(address.lockPath)) {
    rmSync(address.lockPath, { force: true })
  }
  // Node normally removes its Unix socket on server close. Remove a leftover
  // only after our own listener has closed or failed startup.
  if (existsSync(address.path)) rmSync(address.path, { force: true })
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isPostmaster(
  value: PGliteServerPostmaster | PGlitePostmasterOptions,
): value is PGliteServerPostmaster {
  const candidate = value as Partial<PGliteServerPostmaster>
  return (
    typeof candidate.openProtocolConnection === 'function' &&
    typeof candidate.waitForExit === 'function' &&
    typeof candidate.shutdown === 'function'
  )
}
