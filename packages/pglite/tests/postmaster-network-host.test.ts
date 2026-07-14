import { describe, expect, it, vi } from 'vitest'
import {
  attachPostgresNodeNetworkHost,
  PostgresNodeNetworkHostController,
  registerPostgresNodeNetworkHostController,
} from '../src/postmaster/node/network-host.js'
import {
  NETWORK_RESPONSE_ERRNO,
  NETWORK_RESPONSE_GENERATION,
  NETWORK_RESPONSE_LISTENER_ID,
  NETWORK_RESPONSE_STATE,
  NETWORK_RESPONSE_WORDS,
  type PostgresNodeNetworkHost,
  type PostgresSocketOperation,
} from '../src/postmaster/shared/network-host.js'
import { decodePostgresSocketAddress } from '../src/postmaster/shared/socket-host.js'

describe('PostgreSQL socket address decoding', () => {
  it('decodes IPv4, IPv6 with scope, and Unix path addresses', () => {
    const memory = new WebAssembly.Memory({ initial: 1 })
    const view = new DataView(memory.buffer)
    const bytes = new Uint8Array(memory.buffer)

    view.setUint16(0x100, 2, true)
    view.setUint16(0x102, 55432, false)
    bytes.set([127, 0, 0, 1], 0x104)
    expect(decodePostgresSocketAddress(memory, 0x100, 16)).toEqual({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 55432,
    })

    view.setUint16(0x200, 10, true)
    view.setUint16(0x202, 5432, false)
    bytes.set([0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 0x208)
    view.setUint32(0x218, 7, true)
    expect(decodePostgresSocketAddress(memory, 0x200, 28)).toEqual({
      transport: 'tcp',
      host: 'fe80::1%7',
      port: 5432,
    })

    const path = new TextEncoder().encode('/tmp/.s.PGSQL.5432')
    view.setUint16(0x300, 1, true)
    bytes.set(path, 0x302)
    bytes[0x302 + path.length] = 0
    expect(decodePostgresSocketAddress(memory, 0x300, path.length + 3)).toEqual(
      { transport: 'unix', path: '/tmp/.s.PGSQL.5432' },
    )
  })

  it('rejects truncated, abstract, and unknown address families', () => {
    const memory = new WebAssembly.Memory({ initial: 1 })
    const view = new DataView(memory.buffer)
    view.setUint16(0, 2, true)
    expect(() => decodePostgresSocketAddress(memory, 0, 8)).toThrow(
      'short sockaddr_in',
    )
    view.setUint16(0, 1, true)
    expect(() => decodePostgresSocketAddress(memory, 0, 3)).toThrow(
      'empty or abstract',
    )
    view.setUint16(0, 99, true)
    expect(() => decodePostgresSocketAddress(memory, 0, 16)).toThrow(
      'unsupported socket family',
    )
  })
})

describe('PostgresNodeNetworkHostController', () => {
  it('replays desired listeners, fences generations, and detaches cleanly', async () => {
    const postmaster = {}
    const controller = new PostgresNodeNetworkHostController()
    registerPostgresNodeNetworkHostController(postmaster, controller)
    const owner = { pid: 101, generation: 4 }

    const bound = await dispatch(controller, owner, {
      type: 'network-bind',
      pid: owner.pid,
      generation: owner.generation,
      descriptor: 50,
      address: { transport: 'tcp', host: '127.0.0.1', port: 5432 },
    })
    expect(bound.errno).toBe(0)
    expect(bound.listenerId).toBeGreaterThan(0)
    expect(bound.listenerGeneration).toBeGreaterThan(0)
    expect(
      await dispatch(controller, owner, {
        type: 'network-listen',
        pid: owner.pid,
        generation: owner.generation,
        descriptor: 50,
        listenerId: bound.listenerId,
        listenerGeneration: bound.listenerGeneration,
        backlog: 64,
      }),
    ).toMatchObject({ errno: 0 })

    const first = fakeHost()
    const attachment = await attachPostgresNodeNetworkHost(postmaster, first)
    expect(first.bind).toHaveBeenCalledWith({
      listenerId: bound.listenerId,
      generation: bound.listenerGeneration,
      transport: 'tcp',
      host: '127.0.0.1',
      port: 5432,
    })
    expect(first.listen).toHaveBeenCalledWith(
      bound.listenerId,
      bound.listenerGeneration,
      64,
    )
    await expect(
      attachPostgresNodeNetworkHost(postmaster, fakeHost()),
    ).rejects.toThrow('already attached')

    const stale = await dispatch(controller, owner, {
      type: 'network-close',
      pid: owner.pid,
      generation: owner.generation,
      descriptor: 50,
      listenerId: bound.listenerId,
      listenerGeneration: bound.listenerGeneration + 1,
    })
    expect(stale.errno).toBe(8)

    await attachment.detach()
    expect(first.close).toHaveBeenCalledWith(
      bound.listenerId,
      bound.listenerGeneration,
    )
    const second = fakeHost()
    const secondAttachment = await attachPostgresNodeNetworkHost(
      postmaster,
      second,
    )
    expect(second.bind).toHaveBeenCalledTimes(1)
    expect(second.listen).toHaveBeenCalledTimes(1)
    await secondAttachment.detach()
    await controller.dispose()
  })

  it('rolls back a partial attachment without losing desired state', async () => {
    const postmaster = {}
    const controller = new PostgresNodeNetworkHostController()
    registerPostgresNodeNetworkHostController(postmaster, controller)
    const owner = { pid: 101, generation: 1 }
    for (const descriptor of [40, 41]) {
      await dispatch(controller, owner, {
        type: 'network-bind',
        pid: owner.pid,
        generation: owner.generation,
        descriptor,
        address: {
          transport: 'tcp',
          host: '127.0.0.1',
          port: 5400 + descriptor,
        },
      })
    }
    const host = fakeHost()
    host.bind
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }),
      )
    await expect(
      attachPostgresNodeNetworkHost(postmaster, host),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    const replacement = fakeHost()
    const attachment = await attachPostgresNodeNetworkHost(
      postmaster,
      replacement,
    )
    expect(replacement.bind).toHaveBeenCalledTimes(2)
    await attachment.detach()
    await controller.dispose()
  })

  it('materializes Unix listeners only after PostgreSQL resolves policy', async () => {
    const postmaster = {}
    const controller = new PostgresNodeNetworkHostController()
    registerPostgresNodeNetworkHostController(postmaster, controller)
    const owner = { pid: 102, generation: 3 }
    const bound = await dispatch(controller, owner, {
      type: 'network-bind',
      pid: owner.pid,
      generation: owner.generation,
      descriptor: 70,
      address: { transport: 'unix', path: '/tmp/.s.PGSQL.55432' },
    })
    const host = fakeHost()
    const attachment = await attachPostgresNodeNetworkHost(postmaster, host)
    expect(host.bind).not.toHaveBeenCalled()

    expect(
      await dispatch(controller, owner, {
        type: 'network-configure-unix',
        pid: owner.pid,
        generation: owner.generation,
        descriptor: 70,
        listenerId: bound.listenerId,
        listenerGeneration: bound.listenerGeneration,
        path: '/tmp/.s.PGSQL.55432',
        mode: 0o770,
        group: '42',
      }),
    ).toMatchObject({ errno: 0 })
    expect(host.bind).toHaveBeenCalledWith({
      listenerId: bound.listenerId,
      generation: bound.listenerGeneration,
      transport: 'unix',
      path: '/tmp/.s.PGSQL.55432',
      unixMode: 0o770,
      unixGroup: '42',
    })
    expect(
      await dispatch(controller, owner, {
        type: 'network-listen',
        pid: owner.pid,
        generation: owner.generation,
        descriptor: 70,
        listenerId: bound.listenerId,
        listenerGeneration: bound.listenerGeneration,
        backlog: 32,
      }),
    ).toMatchObject({ errno: 0 })
    expect(host.listen).toHaveBeenCalledWith(
      bound.listenerId,
      bound.listenerGeneration,
      32,
    )
    await attachment.detach()
    await controller.dispose()
  })
})

function fakeHost() {
  return {
    bind: vi.fn<PostgresNodeNetworkHost['bind']>().mockResolvedValue(undefined),
    listen: vi
      .fn<PostgresNodeNetworkHost['listen']>()
      .mockResolvedValue(undefined),
    close: vi
      .fn<PostgresNodeNetworkHost['close']>()
      .mockResolvedValue(undefined),
  }
}

type OperationRequest = PostgresSocketOperation extends infer Operation
  ? Operation extends PostgresSocketOperation
    ? Omit<Operation, 'response'>
    : never
  : never

async function dispatch(
  controller: PostgresNodeNetworkHostController,
  owner: { pid: number; generation: number },
  operation: OperationRequest,
): Promise<{
  errno: number
  listenerId: number
  listenerGeneration: number
}> {
  const buffer = new SharedArrayBuffer(
    NETWORK_RESPONSE_WORDS * Int32Array.BYTES_PER_ELEMENT,
  )
  const words = new Int32Array(buffer)
  controller.dispatch(
    { ...operation, response: { buffer } } as PostgresSocketOperation,
    owner,
  )
  await Atomics.waitAsync(words, NETWORK_RESPONSE_STATE, 0).value
  return {
    errno: Atomics.load(words, NETWORK_RESPONSE_ERRNO),
    listenerId: Atomics.load(words, NETWORK_RESPONSE_LISTENER_ID),
    listenerGeneration: Atomics.load(words, NETWORK_RESPONSE_GENERATION),
  }
}
