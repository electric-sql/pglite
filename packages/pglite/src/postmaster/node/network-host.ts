import type { ProcessHandle } from '../shared/control.js'
import { pgliteRuntimeIdentity } from '../../runtime-identity.js'
import type { PGliteContractRequirement } from '../../runtime-contract.js'
import {
  NETWORK_RESPONSE_ERRNO,
  NETWORK_RESPONSE_GENERATION,
  NETWORK_RESPONSE_LISTENER_ID,
  NETWORK_RESPONSE_STATE,
  NETWORK_RESPONSE_WORDS,
  type PostgresHostBindRequest,
  type PostgresNodeNetworkHost,
  type PostgresSocketOperation,
} from '../shared/network-host.js'

const controllers = new WeakMap<object, PostgresNodeNetworkHostController>()

export const nodeNetworkHostIdentity: PGliteContractRequirement = Object.freeze(
  {
    coreVersion: pgliteRuntimeIdentity.pgliteVersion,
    contract: 'node-network-host',
    abiVersion: 1,
  },
)

const ERRNO = {
  EACCES: 2,
  EADDRINUSE: 3,
  EADDRNOTAVAIL: 4,
  EAFNOSUPPORT: 5,
  EBADF: 8,
  EINVAL: 28,
  EIO: 29,
  ENOENT: 44,
  ENOTSUP: 138,
} as const

interface ListenerRecord {
  readonly owner: ProcessHandle
  readonly descriptor: number
  request: PostgresHostBindRequest
  configured: boolean
  listening: boolean
  backlog: number
  materialized: boolean
}

interface HostAttachment {
  readonly token: object
  readonly host: PostgresNodeNetworkHost
}

export interface PostgresNodeNetworkHostAttachment extends AsyncDisposable {
  detach(): Promise<void>
}

export async function attachPostgresNodeNetworkHost(
  postmaster: object,
  host: PostgresNodeNetworkHost,
): Promise<PostgresNodeNetworkHostAttachment> {
  if (!host || typeof host !== 'object') {
    throw new TypeError('PostgreSQL Node network host must be an object')
  }
  for (const method of ['bind', 'listen', 'close'] as const) {
    if (typeof host[method] !== 'function') {
      throw new TypeError(`PostgreSQL Node network host is missing ${method}()`)
    }
  }
  const controller = controllers.get(postmaster)
  if (!controller) {
    throw new TypeError('Object is not a compatible PGlitePostmaster')
  }
  return controller.attach(host)
}

export function registerPostgresNodeNetworkHostController(
  postmaster: object,
  controller: PostgresNodeNetworkHostController,
): void {
  if (controllers.has(postmaster)) {
    throw new Error('PGlitePostmaster already has a network-host controller')
  }
  controllers.set(postmaster, controller)
}

export class PostgresNodeNetworkHostController {
  private readonly listeners = new Map<string, ListenerRecord>()
  private nextListenerId = 1
  private nextGeneration = 1
  private attachment?: HostAttachment
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  dispatch(operation: PostgresSocketOperation, owner: ProcessHandle): void {
    const response = responseWords(operation)
    if (!response) return
    this.enqueue(async () => {
      if (this.disposed) throw errnoError(ERRNO.EBADF)
      if (
        operation.pid !== owner.pid ||
        operation.generation !== owner.generation
      ) {
        throw errnoError(ERRNO.EBADF)
      }
      if (operation.type === 'network-bind') {
        await this.bind(operation, owner, response)
      } else if (operation.type === 'network-configure-unix') {
        await this.configureUnix(operation, owner)
      } else if (operation.type === 'network-listen') {
        await this.listen(operation, owner)
      } else {
        await this.close(operation, owner)
      }
    })
      .then(() => completeResponse(response, 0))
      .catch((error) => completeResponse(response, nodeErrorToErrno(error)))
  }

  async attach(
    host: PostgresNodeNetworkHost,
  ): Promise<PostgresNodeNetworkHostAttachment> {
    const token = {}
    await this.enqueue(async () => {
      if (this.disposed) throw new Error('PGlitePostmaster is closed')
      if (this.attachment) {
        throw new Error('A PostgreSQL Node network host is already attached')
      }
      const attachment = { token, host }
      this.attachment = attachment
      const materialized: ListenerRecord[] = []
      try {
        for (const record of this.listeners.values()) {
          if (!record.configured) continue
          await host.bind(record.request)
          record.materialized = true
          materialized.push(record)
          if (record.listening) {
            await host.listen(
              record.request.listenerId,
              record.request.generation,
              record.backlog,
            )
          }
        }
      } catch (error) {
        for (const record of materialized.reverse()) {
          await host
            .close(record.request.listenerId, record.request.generation)
            .catch(() => undefined)
          record.materialized = false
        }
        this.attachment = undefined
        throw error
      }
    })
    let detached = false
    const detach = async () => {
      if (detached) return
      detached = true
      await this.detach(token)
    }
    return { detach, [Symbol.asyncDispose]: detach }
  }

  processExited(owner: ProcessHandle): void {
    void this.enqueue(async () => {
      const records = [...this.listeners.values()].filter(
        (record) =>
          record.owner.pid === owner.pid &&
          record.owner.generation === owner.generation,
      )
      for (const record of records) await this.closeRecord(record)
    })
  }

  async dispose(): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed) return
      this.disposed = true
      for (const record of [...this.listeners.values()]) {
        await this.closeRecord(record)
      }
      this.attachment = undefined
    })
  }

  private async bind(
    operation: Extract<PostgresSocketOperation, { type: 'network-bind' }>,
    owner: ProcessHandle,
    response: Int32Array,
  ): Promise<void> {
    const key = listenerKey(owner, operation.descriptor)
    if (this.listeners.has(key)) throw errnoError(ERRNO.EINVAL)
    const listenerId = this.nextListenerId++
    const generation = this.nextGeneration++
    if (
      !Number.isSafeInteger(listenerId) ||
      !Number.isSafeInteger(generation)
    ) {
      throw errnoError(ERRNO.EIO)
    }
    const request: PostgresHostBindRequest = {
      listenerId,
      generation,
      ...operation.address,
    }
    const record: ListenerRecord = {
      owner,
      descriptor: operation.descriptor,
      request,
      listening: false,
      backlog: 0,
      configured: operation.address.transport === 'tcp',
      materialized: false,
    }
    if (this.attachment && record.configured) {
      await this.attachment.host.bind(request)
      record.materialized = true
    }
    this.listeners.set(key, record)
    Atomics.store(response, NETWORK_RESPONSE_LISTENER_ID, listenerId)
    Atomics.store(response, NETWORK_RESPONSE_GENERATION, generation)
  }

  private async configureUnix(
    operation: Extract<
      PostgresSocketOperation,
      { type: 'network-configure-unix' }
    >,
    owner: ProcessHandle,
  ): Promise<void> {
    const record = this.assertRecord(operation, owner)
    if (
      record.request.transport !== 'unix' ||
      record.request.path !== operation.path ||
      record.configured ||
      !Number.isInteger(operation.mode) ||
      operation.mode < 0 ||
      operation.mode > 0o7777 ||
      operation.group.includes('\0')
    ) {
      throw errnoError(ERRNO.EINVAL)
    }
    record.request = {
      ...record.request,
      unixMode: operation.mode,
      unixGroup: operation.group,
    }
    if (this.attachment) {
      await this.attachment.host.bind(record.request)
      record.materialized = true
    }
    record.configured = true
  }

  private async listen(
    operation: Extract<PostgresSocketOperation, { type: 'network-listen' }>,
    owner: ProcessHandle,
  ): Promise<void> {
    const record = this.assertRecord(operation, owner)
    if (!Number.isInteger(operation.backlog) || operation.backlog < 0) {
      throw errnoError(ERRNO.EINVAL)
    }
    if (!record.configured) throw errnoError(ERRNO.EINVAL)
    if (this.attachment && record.materialized) {
      await this.attachment.host.listen(
        record.request.listenerId,
        record.request.generation,
        operation.backlog,
      )
    }
    record.listening = true
    record.backlog = operation.backlog
  }

  private async close(
    operation: Extract<PostgresSocketOperation, { type: 'network-close' }>,
    owner: ProcessHandle,
  ): Promise<void> {
    await this.closeRecord(this.assertRecord(operation, owner))
  }

  private assertRecord(
    operation: Extract<
      PostgresSocketOperation,
      {
        type: 'network-configure-unix' | 'network-listen' | 'network-close'
      }
    >,
    owner: ProcessHandle,
  ): ListenerRecord {
    const record = this.listeners.get(listenerKey(owner, operation.descriptor))
    if (
      !record ||
      record.request.listenerId !== operation.listenerId ||
      record.request.generation !== operation.listenerGeneration
    ) {
      throw errnoError(ERRNO.EBADF)
    }
    return record
  }

  private async closeRecord(record: ListenerRecord): Promise<void> {
    this.listeners.delete(listenerKey(record.owner, record.descriptor))
    if (this.attachment && record.materialized) {
      await this.attachment.host.close(
        record.request.listenerId,
        record.request.generation,
      )
    }
    record.materialized = false
  }

  private async detach(token: object): Promise<void> {
    await this.enqueue(async () => {
      const attachment = this.attachment
      if (!attachment || attachment.token !== token) return
      for (const record of this.listeners.values()) {
        if (!record.materialized) continue
        await attachment.host
          .close(record.request.listenerId, record.request.generation)
          .catch(() => undefined)
        record.materialized = false
      }
      this.attachment = undefined
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function listenerKey(owner: ProcessHandle, descriptor: number): string {
  return `${owner.pid}:${owner.generation}:${descriptor}`
}

function responseWords(operation: PostgresSocketOperation): Int32Array | null {
  const { buffer } = operation.response
  if (
    !(buffer instanceof SharedArrayBuffer) ||
    buffer.byteLength !== NETWORK_RESPONSE_WORDS * Int32Array.BYTES_PER_ELEMENT
  ) {
    return null
  }
  return new Int32Array(buffer)
}

function completeResponse(response: Int32Array, errno: number): void {
  Atomics.store(response, NETWORK_RESPONSE_ERRNO, errno)
  Atomics.store(response, NETWORK_RESPONSE_STATE, 1)
  Atomics.notify(response, NETWORK_RESPONSE_STATE)
}

function errnoError(errno: number): Error & { errno: number } {
  return Object.assign(
    new Error(`PostgreSQL network operation failed (${errno})`),
    {
      errno,
    },
  )
}

function nodeErrorToErrno(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'errno' in error &&
    typeof error.errno === 'number' &&
    error.errno > 0
  ) {
    return error.errno
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : ''
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return ERRNO.EACCES
    case 'EADDRINUSE':
      return ERRNO.EADDRINUSE
    case 'EADDRNOTAVAIL':
      return ERRNO.EADDRNOTAVAIL
    case 'EAFNOSUPPORT':
      return ERRNO.EAFNOSUPPORT
    case 'EINVAL':
      return ERRNO.EINVAL
    case 'ENOENT':
      return ERRNO.ENOENT
    case 'ENOTSUP':
      return ERRNO.ENOTSUP
    default:
      return ERRNO.EIO
  }
}
