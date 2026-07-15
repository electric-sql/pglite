import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
import {
  attachPostgresNodeNetworkHost,
  nodeNetworkHostIdentity,
  type PostgresHostBindRequest,
  type PostgresNodeNetworkHost,
  type PostgresNodeNetworkHostAttachment,
} from '@electric-sql/pglite/_internal/node-network-host'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { peerDependencies?: Record<string, string> }

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
  /** `postgres` materializes the listeners selected by PostgreSQL itself. */
  readonly mode?: 'explicit' | 'postgres'
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

  private readonly configuredAddress?: PGliteServerAddress
  private readonly mode: 'explicit' | 'postgres'
  private readonly debug: boolean
  private readonly ownsPostmaster: boolean
  private readonly bridges = new Set<SocketBridge>()
  private server?: Server
  private strictHost?: PostgresNetworkHost
  private networkAttachment?: PostgresNodeNetworkHostAttachment
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
    this.mode = options.mode ?? 'explicit'
    if (this.mode === 'postgres' && options.listen !== undefined) {
      throw new TypeError(
        'listen cannot be combined with PostgreSQL-controlled listener mode',
      )
    }
    this.configuredAddress =
      this.mode === 'explicit'
        ? resolveListenAddress(options.listen ?? {})
        : undefined
    this.debug = options.debug ?? false
    this.ownsPostmaster = ownsPostmaster
  }

  static async create(options: PGliteServerOptions): Promise<PGliteServer> {
    assertCompatibleNetworkHost()
    const ownsPostmaster = !isPostmaster(options.postmaster)
    const postmaster = ownsPostmaster
      ? await PGlitePostmaster.create(options.postmaster)
      : options.postmaster
    const server = new PGliteServer(postmaster, options, ownsPostmaster)

    try {
      if (server.mode === 'postgres') await server.startPostgresListeners()
      else await server.start()
    } catch (error) {
      await server.stopListeners().catch(() => undefined)
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

  get addresses(): readonly PGliteServerAddress[] {
    if (this.mode === 'postgres') return this.strictHost?.addresses ?? []
    return this.currentAddress ? [this.currentAddress] : []
  }

  get connectionCount(): number {
    return this.bridges.size
  }

  get isListening(): boolean {
    return this.mode === 'postgres'
      ? (this.strictHost?.isListening ?? false)
      : this.active
  }

  private async startPostgresListeners(): Promise<void> {
    const host = new PostgresNetworkHost(
      (socket, address) => this.accept(socket, address),
      (type, detail) => this.emit(type, detail),
      this.debug,
    )
    this.strictHost = host
    this.networkAttachment = await attachPostgresNodeNetworkHost(
      this.postmaster,
      host,
    )
    this.active = true
    await Promise.race([
      host.waitForListening(),
      this.postmaster.waitForExit().then(() => {
        throw (
          host.lastError ??
          new Error('PostgreSQL exited before creating a Node listener')
        )
      }),
    ])
  }

  private async start(): Promise<PGliteServerAddress> {
    if (this.server) throw new Error('PGlite socket server is already started')

    const configured = this.configuredAddress
    if (!configured) throw new Error('explicit listener address is unavailable')
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
    if (this.mode === 'postgres') {
      if (!this.active && !this.networkAttachment) return
      this.active = false
      const attachment = this.networkAttachment
      this.networkAttachment = undefined
      await attachment?.detach()
      for (const bridge of this.bridges) {
        bridge.abort(new Error('PGlite socket frontend stopped'))
      }
      await Promise.allSettled([...this.bridges].map(({ closed }) => closed))
      this.strictHost = undefined
      this.emit('close', undefined)
      return
    }
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
    removeSocketMetadata(this.currentAddress ?? this.configuredAddress!)
    this.currentAddress = undefined
    this.emit('close', undefined)
  }

  private async accept(
    socket: Socket,
    address: PGliteServerAddress = this.configuredAddress!,
  ): Promise<void> {
    if (!this.active) {
      socket.destroy()
      return
    }

    if (address.transport === 'tcp') socket.setNoDelay(true)
    const peer: ProtocolPeerInfo =
      address.transport === 'unix'
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

function assertCompatibleNetworkHost(): void {
  const requirement = packageJson.peerDependencies?.['@electric-sql/pglite']
  const expectedVersion = requirement?.replace(/^workspace:/, '')
  if (
    nodeNetworkHostIdentity.contract !== 'node-network-host' ||
    nodeNetworkHostIdentity.abiVersion !== 1 ||
    (expectedVersion &&
      expectedVersion !== '*' &&
      expectedVersion !== nodeNetworkHostIdentity.coreVersion)
  ) {
    throw new Error(
      `Incompatible @electric-sql/pglite Node network host: expected ${expectedVersion ?? 'the packaged peer'} ABI 1, received ${nodeNetworkHostIdentity.coreVersion} ABI ${nodeNetworkHostIdentity.abiVersion}`,
    )
  }
}

interface StrictListenerRecord {
  readonly request: PostgresHostBindRequest
  server?: Server
  address?: PGliteServerAddress
}

class PostgresNetworkHost implements PostgresNodeNetworkHost {
  private readonly listeners = new Map<number, StrictListenerRecord>()
  private readonly listening: Promise<void>
  private resolveListening!: () => void
  private listeningResolved = false
  lastError?: Error

  constructor(
    private readonly accept: (
      socket: Socket,
      address: PGliteServerAddress,
    ) => Promise<void>,
    private readonly emit: (type: string, detail: unknown) => void,
    private readonly debug: boolean,
  ) {
    this.listening = new Promise((resolveListening) => {
      this.resolveListening = resolveListening
    })
  }

  waitForListening(): Promise<void> {
    return this.listening
  }

  get addresses(): readonly PGliteServerAddress[] {
    return [...this.listeners.values()]
      .map(({ address }) => address)
      .filter(
        (address): address is PGliteServerAddress => address !== undefined,
      )
  }

  get isListening(): boolean {
    return this.addresses.length > 0
  }

  async bind(request: PostgresHostBindRequest): Promise<void> {
    assertBindRequest(request)
    if (this.listeners.has(request.listenerId)) {
      throw nodeError('EINVAL', 'duplicate PostgreSQL listener identifier')
    }
    if (request.transport === 'unix') {
      const address = requestedAddress(request)
      if (address.transport !== 'unix') throw nodeError('EINVAL', 'unreachable')
      if (address.lockPath && existsSync(address.lockPath)) {
        throw nodeError(
          'EADDRINUSE',
          `PostgreSQL Unix-socket lock already exists: ${address.lockPath}`,
        )
      }
      writeSocketLock(address)
    }
    this.listeners.set(request.listenerId, { request })
  }

  async listen(
    listenerId: number,
    generation: number,
    backlog: number,
  ): Promise<void> {
    const record = this.listener(listenerId, generation)
    if (record.server) {
      throw nodeError('EINVAL', 'PostgreSQL listener is already active')
    }
    if (!Number.isInteger(backlog) || backlog < 0) {
      throw nodeError('EINVAL', 'invalid PostgreSQL listen backlog')
    }
    const address = requestedAddress(record.request)
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      void this.accept(socket, address)
    })
    record.server = server
    server.on('error', (error) => {
      this.lastError = error
      this.emit('error', error)
    })
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const failed = (error: Error) => {
          server.off('listening', ready)
          rejectListen(error)
        }
        const ready = () => {
          server.off('error', failed)
          try {
            if (address.transport === 'unix') {
              chmodSync(address.path, record.request.unixMode!)
              const group = record.request.unixGroup!
              if (group !== '') chownSync(address.path, -1, Number(group))
            }
            resolveListen()
          } catch (error) {
            rejectListen(error)
          }
        }
        server.once('error', failed)
        server.once('listening', ready)
        if (address.transport === 'unix') {
          server.listen({ path: address.path, backlog })
        } else {
          server.listen({ host: address.host, port: address.port, backlog })
        }
      })
      const actual = server.address()
      record.address =
        address.transport === 'tcp' && actual && typeof actual !== 'string'
          ? { ...address, port: (actual as AddressInfo).port }
          : address
      if (this.debug) {
        console.log(
          `[PGliteServer] PostgreSQL listener ${listenerId}:${generation} ` +
            `active on ${formatAddress(record.address)}`,
        )
      }
      this.emit('listening', record.address)
      if (!this.listeningResolved) {
        this.listeningResolved = true
        this.resolveListening()
      }
    } catch (error) {
      this.lastError = toError(error)
      record.server = undefined
      server.close()
      throw error
    }
  }

  async close(listenerId: number, generation: number): Promise<void> {
    const record = this.listener(listenerId, generation)
    this.listeners.delete(listenerId)
    removeSocketMetadata(record.address ?? requestedAddress(record.request))
    record.address = undefined
    if (record.server) {
      record.server.close()
      record.server = undefined
    }
  }

  private listener(
    listenerId: number,
    generation: number,
  ): StrictListenerRecord {
    const record = this.listeners.get(listenerId)
    if (!record || record.request.generation !== generation) {
      throw nodeError('EBADF', 'stale PostgreSQL listener operation')
    }
    return record
  }
}

function assertBindRequest(request: PostgresHostBindRequest): void {
  if (
    !Number.isSafeInteger(request.listenerId) ||
    request.listenerId <= 0 ||
    !Number.isSafeInteger(request.generation) ||
    request.generation <= 0
  ) {
    throw nodeError('EINVAL', 'invalid PostgreSQL listener identity')
  }
  if (request.transport === 'tcp') {
    if (
      typeof request.host !== 'string' ||
      request.host.length === 0 ||
      !Number.isInteger(request.port) ||
      request.port! < 0 ||
      request.port! > 65_535 ||
      request.path !== undefined
    ) {
      throw nodeError('EINVAL', 'invalid PostgreSQL TCP bind request')
    }
  } else {
    if (
      typeof request.path !== 'string' ||
      request.path.length === 0 ||
      request.host !== undefined ||
      request.port !== undefined ||
      !Number.isInteger(request.unixMode) ||
      request.unixMode! < 0 ||
      request.unixMode! > 0o7777 ||
      typeof request.unixGroup !== 'string' ||
      (request.unixGroup !== '' && !/^\d+$/.test(request.unixGroup))
    ) {
      throw nodeError('EINVAL', 'invalid PostgreSQL Unix bind request')
    }
  }
}

function requestedAddress(
  request: PostgresHostBindRequest,
): PGliteServerAddress {
  return request.transport === 'unix'
    ? unixAddress(resolve(request.path!))
    : { transport: 'tcp', host: request.host!, port: request.port! }
}

function unixAddress(path: string): PGliteServerAddress {
  const match = /\/\.s\.PGSQL\.(\d+)$/.exec(path)
  const port = match ? Number(match[1]) : undefined
  return {
    transport: 'unix',
    path,
    directory: dirname(path),
    port,
    lockPath: `${path}.lock`,
  }
}

function nodeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
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
  writeFileSync(address.lockPath, `${contents}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
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
