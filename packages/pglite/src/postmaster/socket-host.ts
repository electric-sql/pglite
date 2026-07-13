import { ConnectionTransport } from './connection.js'
import {
  type ProcessControlRegistry,
  type ProcessHandle,
  type VirtualConnectionHandle,
} from './control.js'
import type { PostgresMod } from '../postgresMod.js'

const LISTENER_DESCRIPTOR = 0x3d000000
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
const SOCKADDR_IN_BYTES = 16

const ERRNO = {
  EAGAIN: 6,
  EINTR: 27,
  EINVAL: 28,
} as const

interface OpenVirtualConnection {
  readonly handle: VirtualConnectionHandle
  readonly transport: ConnectionTransport
}

export interface VirtualSocketHostOptions {
  readonly module: PostgresMod
  readonly registry: ProcessControlRegistry
  readonly process: ProcessHandle
  readonly privateMemory: WebAssembly.Memory
  readonly connectionBuffers: readonly SharedArrayBuffer[]
  readonly inheritedConnectionId?: number
}

/** Implements PostgreSQL's socket and poll surface over bounded SAB rings. */
export class VirtualSocketHost {
  private readonly callbacks: number[] = []
  private readonly connections = new Map<number, OpenVirtualConnection>()
  private installed = false
  private listenerOpen = false

  constructor(private readonly options: VirtualSocketHostOptions) {}

  install(): void {
    if (this.installed)
      throw new Error('PGlite socket host is already installed')
    const createSocket = this.addFunction(() => this.createSocket(), 'iiii')
    const bindSocket = this.addFunction(
      (descriptor: number) => this.bindSocket(descriptor),
      'iipi',
    )
    const listenSocket = this.addFunction(
      (descriptor: number) => this.listenSocket(descriptor),
      'iii',
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
      bindSocket,
      listenSocket,
      acceptSocket,
      closeSocket,
      receiveSocket,
      sendSocket,
      pollSockets,
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
      if (
        this.options.registry.connectionOwner(connection.handle) ===
        this.options.process.pid
      ) {
        connection.transport.outbound.close()
        this.options.registry.releaseConnection(connection.handle)
      }
    }
    this.connections.clear()
    this.installed = false
  }

  private createSocket(): number {
    if (this.listenerOpen) {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
    this.listenerOpen = true
    return LISTENER_DESCRIPTOR
  }

  private bindSocket(descriptor: number): number {
    return this.listener(descriptor) ? 0 : -1
  }

  private listenSocket(descriptor: number): number {
    return this.listener(descriptor) ? 0 : -1
  }

  private acceptSocket(
    descriptor: number,
    addressPointer: number,
    addressLengthPointer: number,
  ): number {
    if (!this.listener(descriptor)) return -1
    const handle = this.options.registry.waitForConnection()
    if (!handle) return -1
    if (!this.writeLoopbackAddress(addressPointer, addressLengthPointer)) {
      this.options.registry.releaseConnection(handle)
      return -1
    }
    const connectionDescriptor = this.descriptorForConnection(handle.id)
    this.connections.set(connectionDescriptor, {
      handle,
      transport: ConnectionTransport.attach(
        this.options.connectionBuffers[handle.slot],
      ),
    })
    return connectionDescriptor
  }

  private writeLoopbackAddress(
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
    if (
      capacity < SOCKADDR_IN_BYTES ||
      !this.privateRange(addressPointer, SOCKADDR_IN_BYTES)
    ) {
      this.setErrno(ERRNO.EINVAL)
      return false
    }
    new Uint8Array(
      this.options.privateMemory.buffer,
      addressPointer,
      SOCKADDR_IN_BYTES,
    ).fill(0)
    view.setUint16(addressPointer, AF_INET, true)
    view.setUint16(addressPointer + 2, 5432, false)
    view.setUint32(addressPointer + 4, 0x7f000001, false)
    view.setUint32(addressLengthPointer, SOCKADDR_IN_BYTES, true)
    return true
  }

  private closeSocket(descriptor: number): number {
    if (descriptor === LISTENER_DESCRIPTOR && this.listenerOpen) {
      this.listenerOpen = false
      return 0
    }
    const connection = this.connections.get(descriptor)
    if (!connection) return PGL_SOCKET_NOT_HANDLED
    this.connections.delete(descriptor)
    if (
      this.options.registry.connectionOwner(connection.handle) ===
      this.options.process.pid
    ) {
      connection.transport.outbound.close()
      this.options.registry.releaseConnection(connection.handle)
    }
    return 0
  }

  private receiveSocket(
    descriptor: number,
    pointer: number,
    length: number,
  ): number {
    const connection = this.connection(descriptor)
    if (!connection || !this.privateRange(pointer, length)) return -1
    const chunk = connection.transport.inbound.tryRead(length)
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
    const written = connection.transport.outbound.tryWrite(bytes)
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
      if (descriptor === LISTENER_DESCRIPTOR && this.listenerOpen) {
        if (this.options.registry.hasPendingConnection()) returned |= POLLIN
      } else {
        const connection = this.connections.get(descriptor)
        if (connection) {
          if (
            (events & POLLIN) !== 0 &&
            (connection.transport.inbound.usedBytes > 0 ||
              connection.transport.inbound.closed)
          ) {
            returned |= POLLIN
          }
          if (
            (events & POLLOUT) !== 0 &&
            connection.transport.outbound.freeBytes > 0 &&
            !connection.transport.outbound.closed
          ) {
            returned |= POLLOUT
          }
          if (
            connection.transport.inbound.closed ||
            connection.transport.outbound.closed
          ) {
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
      ),
    })
  }

  private listener(descriptor: number): boolean {
    if (descriptor === LISTENER_DESCRIPTOR && this.listenerOpen) return true
    this.setErrno(ERRNO.EINVAL)
    return false
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
