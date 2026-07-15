import {
  ConnectionTransport,
  RingAbortedError,
  RingClosedError,
  StaleConnectionTransportError,
} from './connection.js'
import {
  type ProcessControlRegistry,
  type ProcessHandle,
  type VirtualConnectionHandle,
  VirtualConnectionTransport,
} from './control.js'
import type { PostgresMod } from '../../postgresMod.js'
import type { PostgresSocketAddress } from './network-host.js'

const SOCKET_DESCRIPTOR_BASE = 0x3c000000
const CONNECTION_DESCRIPTOR_BASE = 0x3e000000
const POLLIN = 0x0001
const POLLOUT = 0x0004
const POLLERR = 0x0008
const POLLHUP = 0x0010
const POLLNVAL = 0x0020
const POLLRDHUP = 0x2000
const POLLFD_BYTES = 8
const PGL_SOCKET_NOT_HANDLED = -2
const AF_INET = 2
const AF_UNIX = 1
const AF_INET6 = 10
const SOCKADDR_IN_BYTES = 16
const SOCKADDR_IN6_BYTES = 28
const SOCKADDR_UN_BYTES = 110

const ERRNO = {
  EAFNOSUPPORT: 5,
  EAGAIN: 6,
  ECONNREFUSED: 14,
  ECONNRESET: 15,
  EINTR: 27,
  EINVAL: 28,
  EPIPE: 64,
} as const

export interface VirtualSocketNetworkHost {
  bind(descriptor: number, address: PostgresSocketAddress): number
  configureUnix(
    descriptor: number,
    path: string,
    mode: number,
    group: string,
  ): number
  listen(descriptor: number, backlog: number): number
  close(descriptor: number): number
}

interface OpenVirtualConnection {
  readonly handle: VirtualConnectionHandle
  readonly transport: ConnectionTransport
  readonly role: 'client' | 'server'
}

export interface VirtualSocketHostOptions {
  readonly module: PostgresMod
  readonly registry: ProcessControlRegistry
  readonly process: ProcessHandle
  readonly postmaster: ProcessHandle
  readonly privateMemory: WebAssembly.Memory
  readonly connectionBuffers: readonly SharedArrayBuffer[]
  readonly inheritedConnectionId?: number
  readonly networkHost?: VirtualSocketNetworkHost
  readonly debug?: boolean
}

/** Implements PostgreSQL's socket and poll surface over bounded SAB rings. */
export class VirtualSocketHost {
  private readonly callbacks: number[] = []
  private readonly connections = new Map<number, OpenVirtualConnection>()
  private readonly pendingSockets = new Set<number>()
  private readonly listeners = new Set<number>()
  private readonly nestedServerConnections = new Map<
    number,
    VirtualConnectionHandle
  >()
  private nextSocketDescriptor = SOCKET_DESCRIPTOR_BASE
  private installed = false

  constructor(private readonly options: VirtualSocketHostOptions) {}

  install(): void {
    if (this.installed)
      throw new Error('PGlite socket host is already installed')
    const createSocket = this.addFunction(() => this.createSocket(), 'iiii')
    const connectSocket = this.addFunction(
      (descriptor: number, addressPointer: number, addressLength: number) =>
        this.connectSocket(descriptor, addressPointer, addressLength),
      'iipi',
    )
    const bindSocket = this.addFunction(
      (descriptor: number, addressPointer: number, addressLength: number) =>
        this.bindSocket(descriptor, addressPointer, addressLength),
      'iipi',
    )
    const listenSocket = this.addFunction(
      (descriptor: number, backlog: number) =>
        this.listenSocket(descriptor, backlog),
      'iii',
    )
    const configureUnixSocket = this.addFunction(
      (
        descriptor: number,
        pathPointer: number,
        groupPointer: number,
        mode: number,
      ) =>
        this.configureUnixSocket(descriptor, pathPointer, groupPointer, mode),
      'iippi',
    )
    const acceptSocket = this.addFunction(
      (
        descriptor: number,
        addressPointer: number,
        addressLengthPointer: number,
      ) => this.acceptSocket(descriptor, addressPointer, addressLengthPointer),
      'iipp',
    )
    const closeSocket = this.addFunction(
      (descriptor: number) => this.closeSocket(descriptor),
      'ii',
    )
    const receiveSocket = this.addFunction(
      (descriptor: number, pointer: number, length: number) =>
        this.receiveSocket(descriptor, pointer, length),
      'iipii',
    )
    const sendSocket = this.addFunction(
      (descriptor: number, pointer: number, length: number) =>
        this.sendSocket(descriptor, pointer, length),
      'iipii',
    )
    const pollSockets = this.addFunction(
      (pointer: number, count: number, timeout: number) =>
        this.pollSockets(pointer, count, timeout),
      'ipii',
    )
    this.options.module._pgl_set_socket_host(
      createSocket,
      connectSocket,
      bindSocket,
      listenSocket,
      acceptSocket,
      closeSocket,
      receiveSocket,
      sendSocket,
      pollSockets,
      configureUnixSocket,
    )

    if (this.options.inheritedConnectionId) {
      this.restoreInheritedConnection(this.options.inheritedConnectionId)
    }
    this.installed = true
  }

  connectionIdForDescriptor(descriptor: number): number {
    return this.connections.get(descriptor)?.handle.id ?? 0
  }

  descriptorForConnection(connectionId: number): number {
    return CONNECTION_DESCRIPTOR_BASE + connectionId
  }

  dispose(): void {
    if (!this.installed) return
    for (const callback of this.callbacks)
      this.options.module.removeFunction(callback)
    this.callbacks.length = 0
    for (const connection of this.connections.values()) {
      this.closeConnection(connection)
    }
    for (const handle of this.nestedServerConnections.values()) {
      try {
        this.options.registry.releaseConnection(handle)
      } catch {
        // A failed child startup or postmaster crash may already have
        // invalidated the generation. Cleanup is generation-safe.
      }
    }
    for (const descriptor of this.listeners) {
      this.options.networkHost?.close(descriptor)
    }
    this.connections.clear()
    this.nestedServerConnections.clear()
    this.pendingSockets.clear()
    this.listeners.clear()
    this.installed = false
  }

  private createSocket(): number {
    const descriptor = this.nextSocketDescriptor++
    if (descriptor >= CONNECTION_DESCRIPTOR_BASE) {
      this.setErrno(ERRNO.EAGAIN)
      return -1
    }
    this.pendingSockets.add(descriptor)
    return descriptor
  }

  private connectSocket(
    descriptor: number,
    addressPointer: number,
    addressLength: number,
  ): number {
    if (
      !this.pendingSockets.has(descriptor) ||
      !this.privateRange(addressPointer, addressLength) ||
      addressLength < 2
    ) {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
    const family = new DataView(this.options.privateMemory.buffer).getUint16(
      addressPointer,
      true,
    )
    if (this.options.debug) {
      console.error(
        `[postgres:${this.options.process.pid}] virtual connect ` +
          `fd=${descriptor} family=${family} length=${addressLength}`,
      )
    }
    const transport =
      family === AF_UNIX
        ? VirtualConnectionTransport.Unix
        : family === AF_INET || family === AF_INET6
          ? VirtualConnectionTransport.Tcp
          : undefined
    if (transport === undefined) {
      if (this.options.debug) {
        console.error(
          `[postgres:${this.options.process.pid}] unsupported virtual ` +
            `socket family ${family}`,
        )
      }
      this.setErrno(ERRNO.ECONNREFUSED)
      return -1
    }

    let handle: VirtualConnectionHandle | undefined
    try {
      handle = this.options.registry.reserveConnection(
        {
          transport,
          userId: 123,
          groupId: 123,
        },
        this.options.process,
      )
      const connection = ConnectionTransport.attach(
        this.options.connectionBuffers[handle.slot],
        () => this.options.registry.notifyConnectionOwner(handle!),
      )
      connection.reset(handle.generation)
      this.options.registry.publishConnection(handle, this.options.postmaster)
      this.pendingSockets.delete(descriptor)
      this.connections.set(descriptor, {
        handle,
        transport: connection,
        role: 'client',
      })
      return 0
    } catch (error) {
      if (handle) this.options.registry.cancelReservedConnection(handle)
      if (this.options.debug) {
        console.error(
          `[postgres:${this.options.process.pid}] virtual connect failed`,
          error,
        )
      }
      this.setErrno(ERRNO.EAGAIN)
      return -1
    }
  }

  private bindSocket(
    descriptor: number,
    addressPointer: number,
    addressLength: number,
  ): number {
    if (!this.pendingSockets.has(descriptor)) {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
    if (this.options.networkHost) {
      let address: PostgresSocketAddress
      try {
        address = decodePostgresSocketAddress(
          this.options.privateMemory,
          addressPointer,
          addressLength,
        )
      } catch (error) {
        this.setErrno(
          error instanceof UnsupportedSocketFamilyError
            ? ERRNO.EAFNOSUPPORT
            : ERRNO.EINVAL,
        )
        return -1
      }
      const result = this.options.networkHost.bind(descriptor, address)
      if (result !== 0) return result
    }
    this.listeners.add(descriptor)
    return 0
  }

  private listenSocket(descriptor: number, backlog: number): number {
    if (!this.listener(descriptor)) return -1
    return this.options.networkHost?.listen(descriptor, backlog) ?? 0
  }

  private configureUnixSocket(
    descriptor: number,
    pathPointer: number,
    groupPointer: number,
    mode: number,
  ): number {
    if (
      !this.listener(descriptor) ||
      pathPointer === 0 ||
      groupPointer === 0 ||
      !Number.isInteger(mode) ||
      mode < 0 ||
      mode > 0o7777
    ) {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
    let path: string
    let group: string
    try {
      path = this.options.module.UTF8ToString(pathPointer)
      group = this.options.module.UTF8ToString(groupPointer)
    } catch {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
    return (
      this.options.networkHost?.configureUnix(descriptor, path, mode, group) ??
      0
    )
  }

  private acceptSocket(
    descriptor: number,
    addressPointer: number,
    addressLengthPointer: number,
  ): number {
    if (!this.listener(descriptor)) return -1
    const handle = this.options.registry.acceptConnection()
    if (!handle) {
      // PostgreSQL configures listening sockets as nonblocking. A single
      // pending connection can make multiple listener descriptors readable;
      // after one descriptor claims it, the others must not trap the
      // postmaster outside its signal-dispatch loop.
      this.setErrno(ERRNO.EAGAIN)
      return -1
    }
    if (!this.writePeerAddress(handle, addressPointer, addressLengthPointer)) {
      ConnectionTransport.attach(
        this.options.connectionBuffers[handle.slot],
      ).abort(1)
      return -1
    }
    const connectionDescriptor = this.descriptorForConnection(handle.id)
    this.connections.set(connectionDescriptor, {
      handle,
      transport: ConnectionTransport.attach(
        this.options.connectionBuffers[handle.slot],
        () => this.options.registry.notifyConnectionInitiator(handle),
      ),
      role: 'server',
    })
    if (this.options.registry.connectionInitiator(handle) !== 0) {
      this.nestedServerConnections.set(handle.id, handle)
    }
    return connectionDescriptor
  }

  private writePeerAddress(
    connection: VirtualConnectionHandle,
    addressPointer: number,
    addressLengthPointer: number,
  ): boolean {
    // accept(2) permits both pointers to be null when the caller does not need
    // a peer address. PostgreSQL supplies sockaddr_storage and requires a
    // valid family for HBA matching and pg_getnameinfo_all().
    if (addressPointer === 0 && addressLengthPointer === 0) return true
    if (
      addressPointer === 0 ||
      addressLengthPointer === 0 ||
      !this.privateRange(addressLengthPointer, 4)
    ) {
      this.setErrno(ERRNO.EINVAL)
      return false
    }
    const view = new DataView(this.options.privateMemory.buffer)
    const capacity = view.getUint32(addressLengthPointer, true)
    const peer = this.options.registry.connectionPeer(connection)
    const addressBytes =
      peer.transport === VirtualConnectionTransport.Unix
        ? SOCKADDR_UN_BYTES
        : SOCKADDR_IN_BYTES
    if (
      capacity < addressBytes ||
      !this.privateRange(addressPointer, addressBytes)
    ) {
      this.setErrno(ERRNO.EINVAL)
      return false
    }
    new Uint8Array(
      this.options.privateMemory.buffer,
      addressPointer,
      addressBytes,
    ).fill(0)
    if (peer.transport === VirtualConnectionTransport.Unix) {
      view.setUint16(addressPointer, AF_UNIX, true)
    } else {
      view.setUint16(addressPointer, AF_INET, true)
      view.setUint16(addressPointer + 2, 5432, false)
      view.setUint32(addressPointer + 4, 0x7f000001, false)
    }
    view.setUint32(addressLengthPointer, addressBytes, true)
    return true
  }

  private closeSocket(descriptor: number): number {
    if (this.pendingSockets.delete(descriptor)) {
      if (this.listeners.delete(descriptor)) {
        return this.options.networkHost?.close(descriptor) ?? 0
      }
      return 0
    }
    const connection = this.connections.get(descriptor)
    if (!connection) return PGL_SOCKET_NOT_HANDLED
    this.connections.delete(descriptor)
    this.closeConnection(connection)
    return 0
  }

  private receiveSocket(
    descriptor: number,
    pointer: number,
    length: number,
  ): number {
    const connection = this.connection(descriptor)
    if (!connection || !this.privateRange(pointer, length)) return -1
    let chunk: Uint8Array | null
    try {
      chunk = this.readRing(connection).tryRead(length)
    } catch (error) {
      return this.connectionFailure(error)
    }
    if (chunk === null) return 0
    if (chunk.length === 0) {
      this.setErrno(ERRNO.EAGAIN)
      return -1
    }
    new Uint8Array(
      this.options.privateMemory.buffer,
      pointer,
      chunk.length,
    ).set(chunk)
    return chunk.length
  }

  private sendSocket(
    descriptor: number,
    pointer: number,
    length: number,
  ): number {
    const connection = this.connection(descriptor)
    const validRange = this.privateRange(pointer, length)
    if (!connection || !validRange) return -1
    const bytes = new Uint8Array(
      this.options.privateMemory.buffer,
      pointer,
      length,
    )
    let written: number
    try {
      written = this.writeRing(connection).tryWrite(bytes)
    } catch (error) {
      return this.connectionFailure(error)
    }
    if (written === 0 && length > 0) {
      this.setErrno(ERRNO.EAGAIN)
      return -1
    }
    return written
  }

  private pollSockets(pointer: number, count: number, timeout: number): number {
    if (!this.privateRange(pointer, count * POLLFD_BYTES)) return -1
    const started = performance.now()
    while (true) {
      if (this.options.registry.peekDeliverableSignals(this.options.process)) {
        this.setErrno(ERRNO.EINTR)
        return -1
      }
      const ready = this.scanPollDescriptors(pointer, count)
      if (ready > 0 || timeout === 0) return ready
      const elapsed = performance.now() - started
      if (timeout > 0 && elapsed >= timeout) return 0
      const sequence = this.options.registry.wakeSequence(this.options.process)
      if (this.scanPollDescriptors(pointer, count) > 0) continue
      this.options.registry.wait(
        this.options.process,
        sequence,
        timeout < 0 ? 50 : Math.min(50, Math.max(0, timeout - elapsed)),
      )
    }
  }

  private scanPollDescriptors(pointer: number, count: number): number {
    const view = new DataView(this.options.privateMemory.buffer)
    const parentDead = this.options.registry.snapshot(
      this.options.process,
    ).parentDead
    let ready = 0
    for (let index = 0; index < count; index++) {
      const base = pointer + index * POLLFD_BYTES
      const descriptor = view.getInt32(base, true)
      const events = view.getInt16(base + 4, true)
      let returned = 0
      if (this.listeners.has(descriptor)) {
        if (this.options.registry.hasPendingConnection()) returned |= POLLIN
      } else {
        const connection = this.connections.get(descriptor)
        if (connection) {
          const readRing = this.readRing(connection)
          const writeRing = this.writeRing(connection)
          if (
            (events & POLLIN) !== 0 &&
            (readRing.usedBytes > 0 || readRing.closed)
          ) {
            returned |= POLLIN
          }
          if (
            (events & POLLOUT) !== 0 &&
            writeRing.freeBytes > 0 &&
            !writeRing.closed
          ) {
            returned |= POLLOUT
          }
          if (readRing.closed || writeRing.closed) {
            returned |= POLLHUP | POLLRDHUP
          }
        } else if (descriptor >= CONNECTION_DESCRIPTOR_BASE) {
          returned |= POLLNVAL | POLLERR
        } else if (parentDead) {
          // EXEC_BACKEND Workers do not inherit PostgreSQL's parent-death
          // pipe.  Wake its WaitEventSet slot from the generation-checked
          // Control SAB parent state instead.
          returned |= POLLHUP
        }
      }
      view.setInt16(base + 6, returned, true)
      if (returned !== 0) ready++
    }
    return ready
  }

  private restoreInheritedConnection(connectionId: number): void {
    const handle = this.options.registry.findConnection(connectionId)
    if (!handle) throw new Error(`missing inherited connection ${connectionId}`)
    this.options.registry.assignConnectionOwner(handle, this.options.process)
    this.connections.set(this.descriptorForConnection(connectionId), {
      handle,
      transport: ConnectionTransport.attach(
        this.options.connectionBuffers[handle.slot],
        () => this.options.registry.notifyConnectionInitiator(handle),
      ),
      role: 'server',
    })
    if (this.options.registry.connectionInitiator(handle) !== 0) {
      this.nestedServerConnections.set(handle.id, handle)
    }
  }

  private listener(descriptor: number): boolean {
    if (this.listeners.has(descriptor)) return true
    this.setErrno(ERRNO.EINVAL)
    return false
  }

  private readRing(connection: OpenVirtualConnection) {
    return connection.role === 'server'
      ? connection.transport.inbound
      : connection.transport.outbound
  }

  private writeRing(connection: OpenVirtualConnection) {
    return connection.role === 'server'
      ? connection.transport.outbound
      : connection.transport.inbound
  }

  private closeConnection(connection: OpenVirtualConnection): void {
    if (
      connection.role === 'server' &&
      this.options.registry.connectionOwner(connection.handle) !==
        this.options.process.pid
    ) {
      // The postmaster closes its accepted descriptor after handing the
      // connection to an EXEC_BACKEND child. Only the assigned backend owns
      // the ring endpoints and may publish EOF to the client.
      return
    }
    try {
      const readRing = this.readRing(connection)
      const writeRing = this.writeRing(connection)
      if (!writeRing.closed) writeRing.close()
      if (!readRing.closed) readRing.close()
    } catch (error) {
      // A reused generation belongs to another connection and must never be
      // closed by this stale descriptor.
      if (!(error instanceof StaleConnectionTransportError)) throw error
    }
  }

  private connectionFailure(error: unknown): number {
    if (error instanceof RingClosedError) {
      this.setErrno(ERRNO.EPIPE)
      return -1
    }
    if (
      error instanceof RingAbortedError ||
      error instanceof StaleConnectionTransportError
    ) {
      this.setErrno(ERRNO.ECONNRESET)
      return -1
    }
    throw error
  }

  private connection(descriptor: number): OpenVirtualConnection | undefined {
    const connection = this.connections.get(descriptor)
    if (!connection) this.setErrno(ERRNO.EINVAL)
    return connection
  }

  private privateRange(pointer: number, length: number): boolean {
    if (
      !Number.isInteger(pointer) ||
      !Number.isInteger(length) ||
      pointer < 0 ||
      length < 0 ||
      pointer + length > this.options.privateMemory.buffer.byteLength
    ) {
      this.setErrno(ERRNO.EINVAL)
      return false
    }
    return true
  }

  private setErrno(value: number): void {
    const pointer = this.options.module.___errno_location()
    new Int32Array(this.options.privateMemory.buffer)[pointer / 4] = value
  }

  private addFunction(callback: CallableFunction, signature: string): number {
    const index = this.options.module.addFunction(callback, signature)
    this.callbacks.push(index)
    return index
  }
}

class UnsupportedSocketFamilyError extends Error {}

export function decodePostgresSocketAddress(
  memory: WebAssembly.Memory,
  pointer: number,
  length: number,
): PostgresSocketAddress {
  if (
    !Number.isInteger(pointer) ||
    !Number.isInteger(length) ||
    pointer < 0 ||
    length < 2 ||
    pointer + length > memory.buffer.byteLength
  ) {
    throw new RangeError('invalid PostgreSQL socket address range')
  }
  const view = new DataView(memory.buffer, pointer, length)
  const bytes = new Uint8Array(memory.buffer, pointer, length)
  const family = view.getUint16(0, true)
  if (family === AF_INET) {
    if (length < SOCKADDR_IN_BYTES) throw new RangeError('short sockaddr_in')
    return {
      transport: 'tcp',
      port: view.getUint16(2, false),
      host: `${bytes[4]}.${bytes[5]}.${bytes[6]}.${bytes[7]}`,
    }
  }
  if (family === AF_INET6) {
    if (length < SOCKADDR_IN6_BYTES) throw new RangeError('short sockaddr_in6')
    const words: number[] = []
    for (let offset = 8; offset < 24; offset += 2) {
      words.push(view.getUint16(offset, false))
    }
    const scope = view.getUint32(24, true)
    return {
      transport: 'tcp',
      port: view.getUint16(2, false),
      host: `${formatIpv6(words)}${scope === 0 ? '' : `%${scope}`}`,
    }
  }
  if (family === AF_UNIX) {
    if (length > SOCKADDR_UN_BYTES) throw new RangeError('long sockaddr_un')
    let end = 2
    while (end < length && bytes[end] !== 0) end++
    if (end === 2 || bytes[2] === 0) {
      throw new RangeError('empty or abstract Unix socket path')
    }
    const path = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(2, end),
    )
    if (path.includes('\0')) throw new RangeError('invalid Unix socket path')
    return { transport: 'unix', path }
  }
  throw new UnsupportedSocketFamilyError(`unsupported socket family ${family}`)
}

function formatIpv6(words: readonly number[]): string {
  let bestStart = -1
  let bestLength = 0
  for (let start = 0; start < words.length; ) {
    if (words[start] !== 0) {
      start++
      continue
    }
    let end = start + 1
    while (end < words.length && words[end] === 0) end++
    if (end - start > bestLength && end - start >= 2) {
      bestStart = start
      bestLength = end - start
    }
    start = end
  }
  if (bestStart < 0) return words.map((word) => word.toString(16)).join(':')
  const left = words
    .slice(0, bestStart)
    .map((word) => word.toString(16))
    .join(':')
  const right = words
    .slice(bestStart + bestLength)
    .map((word) => word.toString(16))
    .join(':')
  return `${left}::${right}`
}
