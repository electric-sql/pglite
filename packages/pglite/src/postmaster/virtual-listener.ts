import { ConnectionTransport } from './connection.js'
import {
  type ProcessControlRegistry,
  type ProcessHandle,
  type VirtualConnectionHandle,
} from './control.js'

export interface PendingVirtualConnection {
  readonly handle: VirtualConnectionHandle
  readonly transport: ConnectionTransport
}

export class VirtualConnectionBroker {
  private readonly connections = new Map<number, PendingVirtualConnection>()
  readonly buffers: readonly SharedArrayBuffer[]

  constructor(
    private readonly registry: ProcessControlRegistry,
    private readonly postmaster: ProcessHandle,
    ringCapacity = 64 * 1024,
  ) {
    this.buffers = Array.from(
      { length: registry.maxProcesses },
      () => ConnectionTransport.create(ringCapacity).buffer,
    )
  }

  connect(): PendingVirtualConnection {
    const handle = this.registry.reserveConnection()
    const transport = ConnectionTransport.attach(
      this.buffers[handle.slot],
      () => this.registry.notifyConnectionOwner(handle),
    )
    transport.reset(handle.generation)
    const connection = {
      handle,
      transport,
    }
    this.connections.set(handle.id, connection)
    try {
      this.registry.publishConnection(handle, this.postmaster)
    } catch (error) {
      this.connections.delete(handle.id)
      throw error
    }
    return connection
  }

  get(connectionId: number): PendingVirtualConnection | undefined {
    return this.connections.get(connectionId)
  }

  delete(connectionId: number, abortCode?: number): boolean {
    const connection = this.connections.get(connectionId)
    if (!connection) return false
    if (abortCode !== undefined) connection.transport.abort(abortCode)
    this.connections.delete(connectionId)
    return true
  }

  close(abortCode = 1): void {
    for (const connection of this.connections.values()) {
      connection.transport.abort(abortCode)
    }
    this.connections.clear()
  }
}
