import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConnectionTransport,
  PGLITE_SIGNALS,
  PostgresProcessKind,
  PostmasterProcessHost,
  ProcessControlRegistry,
  ProcessExitKind,
  ProcessScopePolicy,
  ProcessState,
  SharedLatch,
  SharedWordSemaphore,
  SupervisorTimers,
  VirtualConnectionBroker,
  VirtualConnectionTransport,
  VirtualSocketHost,
  waitAsync,
  createMemoryAwareFdRead,
  createMemoryAwareFdWrite,
  type ProcessHandle,
  type VirtualConnectionHandle,
} from '../dist/postmaster/index.js'
import type { PostgresMod } from '../src/postgresMod.js'
import { PgliteMemoryViews } from '../src/wasm/multi-memory.js'

const workerUrl = new URL(
  '../dist/postmaster/phase4-worker.js',
  import.meta.url,
)
const workers = new Set<Worker>()

interface Phase4WorkerMessage {
  type: string
  signals?: number[]
  scopedAliasesPrivate?: boolean
  tableLength?: number
  connection?: VirtualConnectionHandle
}

describe('tagged WASI host bridge', () => {
  it('reads into a memory-1 iovec payload and preserves the private fast path', () => {
    const privateMemory = sharedMemory()
    const globalMemory = sharedMemory()
    const memories = new PgliteMemoryViews({
      private: privateMemory,
      global: globalMemory,
      scoped: privateMemory,
    })
    const iovecs = 0x100
    const bytesRead = 0x120
    const privateData = new DataView(privateMemory.buffer)
    const payload = new TextEncoder().encode('wal-record')
    privateData.setUint32(iovecs, 0x80000040, true)
    privateData.setUint32(iovecs + 4, payload.byteLength, true)

    const fileSystem = {
      getStream: vi.fn(() => ({ fd: 7 })),
      read: vi.fn(
        (
          _stream: unknown,
          buffer: Uint8Array,
          offset: number,
          length: number,
        ) => {
          buffer.set(payload.subarray(0, length), offset)
          return Math.min(payload.byteLength, length)
        },
      ),
    } as unknown as PostgresMod['FS']
    const original = vi.fn(() => 73)
    const fdRead = createMemoryAwareFdRead(original, memories, () => fileSystem)

    expect(fdRead(7, iovecs, 1, bytesRead)).toBe(0)
    expect(original).not.toHaveBeenCalled()
    expect(privateData.getUint32(bytesRead, true)).toBe(payload.byteLength)
    expect(
      new Uint8Array(globalMemory.buffer, 0x40, payload.byteLength),
    ).toEqual(payload)

    privateData.setUint32(iovecs, 0x200, true)
    expect(fdRead(7, iovecs, 1, bytesRead)).toBe(73)
    expect(original).toHaveBeenCalledWith(7, iovecs, 1, bytesRead)
    expect(fileSystem.read).toHaveBeenCalledTimes(1)
  })

  it('writes a memory-1 iovec payload and preserves the private fast path', () => {
    const privateMemory = sharedMemory()
    const globalMemory = sharedMemory()
    const memories = new PgliteMemoryViews({
      private: privateMemory,
      global: globalMemory,
      scoped: privateMemory,
    })
    const iovecs = 0x100
    const bytesWritten = 0x120
    const privateData = new DataView(privateMemory.buffer)
    const payload = new TextEncoder().encode('checkpoint')
    new Uint8Array(globalMemory.buffer).set(payload, 0x40)
    privateData.setUint32(iovecs, 0x80000040, true)
    privateData.setUint32(iovecs + 4, payload.byteLength, true)

    const writes: Uint8Array[] = []
    const fileSystem = {
      getStream: vi.fn(() => ({ fd: 7 })),
      write: vi.fn(
        (
          _stream: unknown,
          buffer: Uint8Array,
          offset: number,
          length: number,
        ) => {
          writes.push(buffer.slice(offset, offset + length))
          return length
        },
      ),
    } as unknown as PostgresMod['FS']
    const original = vi.fn(() => 73)
    const fdWrite = createMemoryAwareFdWrite(
      original,
      memories,
      () => fileSystem,
    )

    expect(fdWrite(7, iovecs, 1, bytesWritten)).toBe(0)
    expect(original).not.toHaveBeenCalled()
    expect(privateData.getUint32(bytesWritten, true)).toBe(payload.byteLength)
    expect(writes).toEqual([payload])

    privateData.setUint32(iovecs, 0x200, true)
    expect(fdWrite(7, iovecs, 1, bytesWritten)).toBe(73)
    expect(original).toHaveBeenCalledWith(7, iovecs, 1, bytesWritten)
    expect(fileSystem.write).toHaveBeenCalledTimes(1)
  })
})

afterEach(async () => {
  await Promise.all([...workers].map((worker) => worker.terminate()))
  workers.clear()
})

describe('Phase 4 process portability primitives', () => {
  it('can align the synthetic postmaster PID with a foreground host process', () => {
    const registry = ProcessControlRegistry.create(4, 42_000)
    const postmaster = registry.reserve(PostgresProcessKind.Postmaster)

    expect(postmaster.pid).toBe(42_000)
    expect(() => ProcessControlRegistry.create(4, 0)).toThrow(
      'initialPid must be a positive signed 32-bit integer',
    )
  })

  it('queues blocked signals and dispatches them in the target Worker', async () => {
    const registry = ProcessControlRegistry.create(8)
    const parent = registry.reserve(PostgresProcessKind.Postmaster)
    registry.transition(parent, ProcessState.Runnable)
    const child = registry.reserve(PostgresProcessKind.Backend, {
      parentPid: parent.pid,
    })
    registry.setBlockedSignals(child, signalMask(PGLITE_SIGNALS.SIGUSR1))

    const worker = spawnSignalWorker(registry, child)
    await messageOfType(worker, 'ready')
    expect(registry.queueSignal(child.pid, PGLITE_SIGNALS.SIGUSR1)).toBe(1)
    await expect(noMessageOfType(worker, 'signals', 30)).resolves.toBe(true)

    const deliveredPromise = messageOfType(worker, 'signals')
    registry.setBlockedSignals(child, 0)
    const delivered = await deliveredPromise
    expect(delivered.signals).toEqual([PGLITE_SIGNALS.SIGUSR1])

    const result = await registry.waitpid(parent.pid, child.pid, 2_000)
    expect(result?.exitKind).toBe(ProcessExitKind.Normal)
    expect(result?.exitCode).toBe(0)
    registry.reap(child)
    expect(registry.queueSignal(child.pid, 0)).toBe(0)
  })

  it('moves an EXEC_BACKEND request from a Worker through the Control SAB', async () => {
    const registry = ProcessControlRegistry.create(8)
    const root = registry.reserve(PostgresProcessKind.Postmaster)
    registry.transition(root, ProcessState.Runnable)
    const requester = registry.reserve(PostgresProcessKind.Auxiliary, {
      parentPid: root.pid,
    })
    const spawnPromise = registry.waitForSpawn(2_000)
    const privateMemory = sharedMemory()
    const worker = track(
      new Worker(workerUrl, {
        workerData: {
          controlBuffer: registry.buffer,
          handle: requester,
          privateMemory,
          globalMemory: sharedMemory(),
          scopedMemory: privateMemory,
          module: emptyModule(),
          mode: 'spawn',
          spawn: {
            childKind: 'backend',
            parameterFile: '/pgdata/pgsql_tmp/backend.parameters',
            connectionId: 91,
          },
        },
      }),
    )
    await messageOfType(worker, 'ready')
    const request = await spawnPromise
    expect(request).toMatchObject({
      parentPid: requester.pid,
      processKind: PostgresProcessKind.Backend,
      childKind: 'backend',
      parameterFile: '/pgdata/pgsql_tmp/backend.parameters',
      connectionId: 91,
      scopePolicy: ProcessScopePolicy.NewRoot,
    })
    expect(request?.handle.pid).toBeGreaterThan(requester.pid)
    expect(request && registry.completeSpawn(request)).toBe(true)

    if (!request) throw new Error('missing spawn request')
    const signalsPromise = messageOfType(worker, 'signals')
    registry.queueSignalHandle(requester, PGLITE_SIGNALS.SIGUSR1)
    expect((await signalsPromise).signals).toEqual([PGLITE_SIGNALS.SIGUSR1])
    expect(
      (await registry.waitpid(root.pid, requester.pid, 2_000))?.exitCode,
    ).toBe(0)
    registry.markExit(request.handle, ProcessExitKind.WorkerFailure, 70)
  })

  it('wakes a Worker blocked on the virtual postmaster listener', async () => {
    const registry = ProcessControlRegistry.create(4)
    const postmaster = registry.reserve(PostgresProcessKind.Postmaster)
    const privateMemory = sharedMemory()
    const worker = track(
      new Worker(workerUrl, {
        workerData: {
          controlBuffer: registry.buffer,
          handle: postmaster,
          privateMemory,
          globalMemory: sharedMemory(),
          scopedMemory: privateMemory,
          module: emptyModule(),
          mode: 'listener',
        },
      }),
    )
    await messageOfType(worker, 'ready')
    const acceptedPromise = messageOfType(worker, 'accepted')
    const broker = new VirtualConnectionBroker(registry, postmaster, 64)
    const pending = broker.connect()
    const accepted = await acceptedPromise
    expect(accepted.connection).toEqual(pending.handle)
    expect(broker.get(pending.handle.id)?.transport).toBe(pending.transport)

    const signalsPromise = messageOfType(worker, 'signals')
    registry.queueSignalHandle(postmaster, PGLITE_SIGNALS.SIGTERM)
    expect((await signalsPromise).signals).toEqual([PGLITE_SIGNALS.SIGTERM])
    broker.close()
  })

  it('blocks and wakes on a shared-word PostgreSQL semaphore', async () => {
    const registry = ProcessControlRegistry.create(4)
    const owner = registry.reserve(PostgresProcessKind.Backend)
    const globalMemory = sharedMemory()
    const semaphore = new SharedWordSemaphore(
      new Int32Array(globalMemory.buffer),
      0,
    )
    semaphore.initialize(0)
    const privateMemory = sharedMemory()
    const worker = track(
      new Worker(workerUrl, {
        workerData: {
          controlBuffer: registry.buffer,
          handle: owner,
          privateMemory,
          globalMemory,
          scopedMemory: privateMemory,
          module: emptyModule(),
          mode: 'semaphore',
          sharedWordIndex: 0,
        },
      }),
    )
    await messageOfType(worker, 'ready')
    await expect(
      noMessageOfType(worker, 'semaphore-acquired', 30),
    ).resolves.toBe(true)
    const acquiredPromise = messageOfType(worker, 'semaphore-acquired')
    semaphore.unlock()
    await acquiredPromise
    expect(semaphore.count).toBe(0)
  })

  it('uses SIGURG to wake a Worker waiting on a shared latch', async () => {
    const registry = ProcessControlRegistry.create(4)
    const owner = registry.reserve(PostgresProcessKind.Backend)
    const globalMemory = sharedMemory()
    const latch = new SharedLatch(
      new Int32Array(globalMemory.buffer),
      8,
      registry,
    )
    latch.initialize(owner)
    const privateMemory = sharedMemory()
    const worker = track(
      new Worker(workerUrl, {
        workerData: {
          controlBuffer: registry.buffer,
          handle: owner,
          privateMemory,
          globalMemory,
          scopedMemory: privateMemory,
          module: emptyModule(),
          mode: 'latch',
          sharedWordIndex: 8,
        },
      }),
    )
    await messageOfType(worker, 'ready')
    await expect(noMessageOfType(worker, 'latch-set', 30)).resolves.toBe(true)
    const latchPromise = messageOfType(worker, 'latch-set')
    latch.set()
    expect((await latchPromise).signals).toEqual([PGLITE_SIGNALS.SIGURG])
  })

  it('delivers negative-PID signals to a virtual process group', async () => {
    const registry = ProcessControlRegistry.create(8)
    const parent = registry.reserve(PostgresProcessKind.Postmaster)
    registry.transition(parent, ProcessState.Runnable)
    const group = 42_000
    const handles = [
      registry.reserve(PostgresProcessKind.Backend, {
        parentPid: parent.pid,
        processGroup: group,
      }),
      registry.reserve(PostgresProcessKind.BackgroundWorker, {
        parentPid: parent.pid,
        processGroup: group,
      }),
    ]
    const groupWorkers = handles.map((handle) =>
      spawnSignalWorker(registry, handle),
    )
    await Promise.all(
      groupWorkers.map((worker) => messageOfType(worker, 'ready')),
    )

    const deliveredPromise = Promise.all(
      groupWorkers.map((worker) => messageOfType(worker, 'signals')),
    )
    expect(registry.queueSignal(-group, PGLITE_SIGNALS.SIGURG)).toBe(2)
    const delivered = await deliveredPromise
    expect(delivered.map((message) => message.signals)).toEqual([
      [PGLITE_SIGNALS.SIGURG],
      [PGLITE_SIGNALS.SIGURG],
    ])
  })

  it('fires generation-safe supervisor SIGALRM timers', async () => {
    const registry = ProcessControlRegistry.create(4)
    const parent = registry.reserve(PostgresProcessKind.Postmaster)
    registry.transition(parent, ProcessState.Runnable)
    const child = registry.reserve(PostgresProcessKind.Backend, {
      parentPid: parent.pid,
    })
    const worker = spawnSignalWorker(registry, child)
    await messageOfType(worker, 'ready')
    const timers = new SupervisorTimers(registry)
    const timerLoop = timers.run()
    const deliveredPromise = messageOfType(worker, 'signals')
    registry.requestTimer(child, 20)

    const delivered = await deliveredPromise
    expect(delivered.signals).toEqual([PGLITE_SIGNALS.SIGALRM])
    expect(
      (await registry.waitpid(parent.pid, child.pid, 2_000))?.handle,
    ).toEqual(child)
    timers.close()
    registry.requestTimer(parent, 0)
    await timerLoop
  })

  it('moves a saturated full-duplex byte stream through bounded SAB rings', async () => {
    const registry = ProcessControlRegistry.create(4)
    const parent = registry.reserve(PostgresProcessKind.Postmaster)
    registry.transition(parent, ProcessState.Runnable)
    const child = registry.reserve(PostgresProcessKind.Backend, {
      parentPid: parent.pid,
      connectionId: 7,
    })
    const connection = ConnectionTransport.create(32, 7)
    const privateMemory = sharedMemory()
    const globalMemory = sharedMemory()
    const worker = track(
      new Worker(workerUrl, {
        workerData: {
          controlBuffer: registry.buffer,
          handle: child,
          privateMemory,
          globalMemory,
          scopedMemory: privateMemory,
          connectionBuffer: connection.buffer,
          module: emptyModule(),
          mode: 'echo',
        },
      }),
    )
    const ready = await messageOfType(worker, 'ready')
    expect(ready.scopedAliasesPrivate).toBe(true)
    expect(ready.tableLength).toBe(0)
    expect(privateMemory).not.toBe(globalMemory)

    const input = Uint8Array.from({ length: 4_097 }, (_, index) => index % 251)
    const outputPromise = collect(connection.readable())
    await connection.write(input)
    connection.end()
    const output = await outputPromise
    expect(output).toEqual(input)
    expect(
      (await registry.waitpid(parent.pid, child.pid, 2_000))?.exitCode,
    ).toBe(0)
  })

  it('prevents a stale frontend from closing a reused connection ring', () => {
    const current = ConnectionTransport.create(32, 1)
    const stale = ConnectionTransport.attach(current.buffer)

    current.reset(2)

    expect(() => stale.end()).toThrow('stale PGlite connection transport')
    expect(() => stale.abort()).toThrow('stale PGlite connection transport')
    expect(current.inbound.closed).toBe(false)
    expect(current.outbound.closed).toBe(false)
  })

  it('handles both synchronous and asynchronous Atomics.waitAsync results', async () => {
    const words = new Int32Array(new SharedArrayBuffer(4))
    expect(await waitAsync(words, 0, 1, 1_000)).toBe('not-equal')
    expect(await waitAsync(words, 0, 0, 1)).toBe('timed-out')
  })

  it('binds the PGlite libc process callbacks to the Control SAB', async () => {
    const registry = ProcessControlRegistry.create(8)
    const parent = registry.reserve(PostgresProcessKind.Postmaster)
    registry.transition(parent, ProcessState.Runnable)
    const privateMemory = sharedMemory()
    const globalMemory = sharedMemory()
    const fake = fakeModule(privateMemory)
    writeCString(privateMemory, 64, 'backend')
    writeCString(privateMemory, 128, '/pgdata/pgsql_tmp/backend.parameters')
    const host = new PostmasterProcessHost({
      module: fake.module,
      registry,
      process: parent,
      privateMemory,
      globalMemory,
      scopedMemory: privateMemory,
      scopedMemoryMode: 'disabled',
    })
    host.install()

    const childPid = fake.invoke(fake.processHost[0], 64, 128, -1, 0)
    const request = registry.claimSpawn()
    expect(request).toMatchObject({
      childKind: 'backend',
      parameterFile: '/pgdata/pgsql_tmp/backend.parameters',
      connectionId: 0,
      scopePolicy: ProcessScopePolicy.NewRoot,
      scopeRoot: request?.handle,
    })
    expect(request?.handle.pid).toBe(childPid)
    if (!request) throw new Error('missing callback spawn request')
    expect(registry.completeSpawn(request)).toBe(true)

    writeCString(privateMemory, 192, 'bgworker')
    const parallelPid = fake.invoke(fake.processHost[0], 192, 128, -1, childPid)
    const parallel = registry.claimSpawn()
    expect(parallel).toMatchObject({
      childKind: 'bgworker',
      scopePolicy: ProcessScopePolicy.AttachRoot,
      scopeRoot: request.handle,
    })
    expect(parallel?.handle.pid).toBe(parallelPid)
    if (!parallel) throw new Error('missing parallel callback spawn request')
    expect(registry.completeSpawn(parallel)).toBe(true)

    fake.invoke(fake.signalHost[1], signalMask(PGLITE_SIGNALS.SIGUSR1))
    registry.queueSignalHandle(parent, PGLITE_SIGNALS.SIGUSR1)
    expect(fake.invoke(fake.signalHost[0])).toBe(0)
    fake.invoke(fake.signalHost[1], 0)
    expect(fake.invoke(fake.signalHost[0])).toBe(
      signalMask(PGLITE_SIGNALS.SIGUSR1),
    )

    fake.invoke(fake.signalHost[2], 25, 10)
    expect(registry.timerRequest(parent)).toMatchObject({
      delayMs: 25,
      intervalMs: 10,
    })

    const globalWords = new Int32Array(globalMemory.buffer)
    globalWords[3] = 9
    expect(fake.invoke(fake.futexHost[1], 0x8000000c, 1)).toBe(0)
    expect(fake.invoke(fake.futexHost[0], 0x8000000c, 8, 0)).toBe(-1)
    expect(new Int32Array(privateMemory.buffer)[1]).toBe(6)

    const realtimeMicroseconds = fake.invoke(fake.clockHost[0])
    expect(realtimeMicroseconds).toBeGreaterThan(Date.now() * 1000 - 1_000_000)
    expect(realtimeMicroseconds).toBeLessThan(Date.now() * 1000 + 1_000_000)

    const performanceNow = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000.001)
    const firstMicrosecond = fake.invoke(fake.clockHost[0])
    const nextMicrosecond = fake.invoke(fake.clockHost[0])
    performanceNow.mockRestore()
    expect(nextMicrosecond - firstMicrosecond).toBe(1)

    expect(fake.invoke(fake.shmemHost[0], 2 * 65_536)).toBe(0)
    expect(globalMemory.buffer.byteLength).toBe(2 * 65_536)
    expect(fake.invoke(fake.shmemHost[0], 0x40000001)).toBe(-1)
    expect(fake.scopedShmemMode).toEqual([0])

    registry.markExit(parallel.handle, ProcessExitKind.Normal, 0)
    registry.markExit(request.handle, ProcessExitKind.Normal, 5)
    expect(fake.invoke(fake.processHost[3], childPid, 256, 0)).toBe(childPid)
    expect(new Int32Array(privateMemory.buffer)[64]).toBe(5 << 8)
    host.dispose()
  })

  it('uses pre-shared connection slots for exact virtual poll and socket I/O', async () => {
    const registry = ProcessControlRegistry.create(8)
    const postmaster = registry.reserve(PostgresProcessKind.Postmaster)
    registry.transition(postmaster, ProcessState.Runnable)
    const broker = new VirtualConnectionBroker(registry, postmaster, 32)
    const postmasterMemory = sharedMemory()
    const postmasterModule = fakeModule(postmasterMemory)
    const postmasterSockets = new VirtualSocketHost({
      module: postmasterModule.module,
      registry,
      process: postmaster,
      postmaster,
      privateMemory: postmasterMemory,
      connectionBuffers: broker.buffers,
    })
    postmasterSockets.install()
    const listener = postmasterModule.invoke(
      postmasterModule.socketHost[0],
      1,
      1,
      0,
    )
    expect(
      postmasterModule.invoke(postmasterModule.socketHost[2], listener, 0, 0),
    ).toBe(0)
    expect(
      postmasterModule.invoke(postmasterModule.socketHost[3], listener, 16),
    ).toBe(0)

    const pending = broker.connect()
    const acceptView = new DataView(postmasterMemory.buffer)
    acceptView.setUint32(768, 128, true)
    const descriptor = postmasterModule.invoke(
      postmasterModule.socketHost[4],
      listener,
      800,
      768,
    )
    expect(acceptView.getUint32(768, true)).toBe(16)
    expect(acceptView.getUint16(800, true)).toBe(2)
    expect(acceptView.getUint16(802, false)).toBe(5432)
    expect(acceptView.getUint32(804, false)).toBe(0x7f000001)
    expect(registry.connectionPeer(pending.handle)).toEqual({
      transport: VirtualConnectionTransport.Tcp,
      userId: 0,
      groupId: 0,
    })
    expect(postmasterSockets.connectionIdForDescriptor(descriptor)).toBe(
      pending.handle.id,
    )

    const backend = registry.reserve(PostgresProcessKind.Backend, {
      parentPid: postmaster.pid,
      connectionId: pending.handle.id,
    })
    const backendMemory = sharedMemory()
    const backendModule = fakeModule(backendMemory)
    const backendSockets = new VirtualSocketHost({
      module: backendModule.module,
      registry,
      process: backend,
      postmaster,
      privateMemory: backendMemory,
      connectionBuffers: broker.buffers,
      inheritedConnectionId: pending.handle.id,
    })
    backendSockets.install()

    await pending.transport.write(Uint8Array.of(1, 2, 3, 4))
    const poll = new DataView(backendMemory.buffer)
    poll.setInt32(512, descriptor, true)
    poll.setInt16(516, 1, true)
    expect(backendModule.invoke(backendModule.socketHost[8], 512, 1, 100)).toBe(
      1,
    )
    expect(poll.getInt16(518, true) & 1).toBe(1)
    expect(
      backendModule.invoke(backendModule.socketHost[6], descriptor, 600, 16, 0),
    ).toBe(4)
    expect([...new Uint8Array(backendMemory.buffer, 600, 4)]).toEqual([
      1, 2, 3, 4,
    ])

    new Uint8Array(backendMemory.buffer, 700, 3).set([7, 8, 9])
    expect(
      backendModule.invoke(backendModule.socketHost[7], descriptor, 700, 3, 0),
    ).toBe(3)
    expect([...(await pending.transport.outbound.read(3))!]).toEqual([7, 8, 9])
    expect(backendModule.invoke(backendModule.socketHost[5], descriptor)).toBe(
      0,
    )
    await pending.transport.waitForClose()
    expect(broker.release(pending.handle.id)).toBe(true)

    // A libpq client running inside a backend uses the same bounded rings to
    // connect back through the postmaster. This is the path used by dblink
    // and postgres_fdw; the client and server views reverse ring direction.
    const clientDescriptor = backendModule.invoke(
      backendModule.socketHost[0],
      1,
      1,
      0,
    )
    const clientAddress = new DataView(backendMemory.buffer)
    clientAddress.setUint16(900, 1, true)
    expect(
      backendModule.invoke(
        backendModule.socketHost[1],
        clientDescriptor,
        900,
        110,
      ),
    ).toBe(0)

    acceptView.setUint32(768, 128, true)
    const nestedAcceptedDescriptor = postmasterModule.invoke(
      postmasterModule.socketHost[4],
      listener,
      800,
      768,
    )
    const nestedConnectionId = postmasterSockets.connectionIdForDescriptor(
      nestedAcceptedDescriptor,
    )
    const nestedHandle = registry.findConnection(nestedConnectionId)
    if (!nestedHandle) throw new Error('missing nested virtual connection')
    expect(registry.connectionInitiator(nestedHandle)).toBe(backend.pid)

    const nestedBackend = registry.reserve(PostgresProcessKind.Backend, {
      parentPid: postmaster.pid,
      connectionId: nestedConnectionId,
    })
    const nestedMemory = sharedMemory()
    const nestedModule = fakeModule(nestedMemory)
    const nestedSockets = new VirtualSocketHost({
      module: nestedModule.module,
      registry,
      process: nestedBackend,
      postmaster,
      privateMemory: nestedMemory,
      connectionBuffers: broker.buffers,
      inheritedConnectionId: nestedConnectionId,
    })
    nestedSockets.install()

    new Uint8Array(backendMemory.buffer, 920, 3).set([11, 12, 13])
    expect(
      backendModule.invoke(
        backendModule.socketHost[7],
        clientDescriptor,
        920,
        3,
        0,
      ),
    ).toBe(3)
    expect(
      nestedModule.invoke(
        nestedModule.socketHost[6],
        nestedAcceptedDescriptor,
        940,
        3,
        0,
      ),
    ).toBe(3)
    expect([...new Uint8Array(nestedMemory.buffer, 940, 3)]).toEqual([
      11, 12, 13,
    ])

    new Uint8Array(nestedMemory.buffer, 960, 2).set([21, 22])
    const clientWakeSequence = registry.snapshot(backend).wakeSequence
    expect(
      nestedModule.invoke(
        nestedModule.socketHost[7],
        nestedAcceptedDescriptor,
        960,
        2,
        0,
      ),
    ).toBe(2)
    expect(registry.snapshot(backend).wakeSequence).toBeGreaterThan(
      clientWakeSequence,
    )
    expect(
      backendModule.invoke(
        backendModule.socketHost[6],
        clientDescriptor,
        980,
        2,
        0,
      ),
    ).toBe(2)
    expect([...new Uint8Array(backendMemory.buffer, 980, 2)]).toEqual([21, 22])

    expect(
      nestedModule.invoke(nestedModule.socketHost[5], nestedAcceptedDescriptor),
    ).toBe(0)
    nestedSockets.dispose()
    expect(registry.findConnection(nestedConnectionId)).toBeUndefined()

    // A terminated nested backend is a normal broken socket.  The cached
    // libpq client must observe EPIPE so postgres_fdw can reconnect; a host
    // exception here would crash the outer backend and trigger recovery.
    new Uint8Array(backendMemory.buffer, 920, 1).set([31])
    expect(
      backendModule.invoke(
        backendModule.socketHost[7],
        clientDescriptor,
        920,
        1,
        0,
      ),
    ).toBe(-1)
    expect(new Int32Array(backendMemory.buffer)[1]).toBe(64)
    expect(
      backendModule.invoke(backendModule.socketHost[5], clientDescriptor),
    ).toBe(0)
    expect(
      postmasterModule.invoke(
        postmasterModule.socketHost[5],
        nestedAcceptedDescriptor,
      ),
    ).toBe(0)

    const unixPending = broker.connect({
      transport: VirtualConnectionTransport.Unix,
      userId: 123,
      groupId: 123,
    })
    acceptView.setUint32(768, 128, true)
    const unixDescriptor = postmasterModule.invoke(
      postmasterModule.socketHost[4],
      listener,
      800,
      768,
    )
    expect(acceptView.getUint32(768, true)).toBe(110)
    expect(acceptView.getUint16(800, true)).toBe(1)
    expect(registry.connectionPeer(unixPending.handle)).toEqual({
      transport: VirtualConnectionTransport.Unix,
      userId: 123,
      groupId: 123,
    })
    expect(
      postmasterModule.invoke(postmasterModule.socketHost[5], unixDescriptor),
    ).toBe(0)
    expect(broker.abort(unixPending.handle.id)).toBe(true)
    await unixPending.transport.waitForClose()
    expect(broker.release(unixPending.handle.id)).toBe(true)
    postmasterSockets.dispose()
    backendSockets.dispose()
    broker.close()
  })
})

function spawnSignalWorker(
  registry: ProcessControlRegistry,
  handle: ProcessHandle,
): Worker {
  const privateMemory = sharedMemory()
  return track(
    new Worker(workerUrl, {
      workerData: {
        controlBuffer: registry.buffer,
        handle,
        privateMemory,
        globalMemory: sharedMemory(),
        scopedMemory: privateMemory,
        module: emptyModule(),
        mode: 'signals',
      },
    }),
  )
}

function sharedMemory(): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: 1, maximum: 4, shared: true })
}

function emptyModule(): WebAssembly.Module {
  return new WebAssembly.Module(
    Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
  )
}

function track(worker: Worker): Worker {
  workers.add(worker)
  worker.once('exit', () => workers.delete(worker))
  return worker
}

function messageOfType(
  worker: Worker,
  type: string,
): Promise<Phase4WorkerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => {
      if (!isWorkerMessage(message) || message.type !== type) return
      cleanup()
      resolve(message)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number) => {
      cleanup()
      reject(new Error(`phase4 Worker exited before ${type}: ${code}`))
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
  })
}

function noMessageOfType(
  worker: Worker,
  type: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const onMessage = (message: unknown) => {
      if (!isWorkerMessage(message) || message.type !== type) return
      clearTimeout(timer)
      worker.off('message', onMessage)
      resolve(false)
    }
    const timer = setTimeout(() => {
      worker.off('message', onMessage)
      resolve(true)
    }, timeoutMs)
    worker.on('message', onMessage)
  })
}

function isWorkerMessage(message: unknown): message is Phase4WorkerMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string'
  )
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of source) {
    chunks.push(chunk)
    length += chunk.length
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function signalMask(signal: number): number {
  return 1 << (signal - 1)
}

type NumericCallback = (...arguments_: number[]) => bigint | number | void

interface FakeModule {
  readonly module: PostgresMod
  readonly processHost: number[]
  readonly signalHost: number[]
  readonly futexHost: number[]
  readonly clockHost: number[]
  readonly shmemHost: number[]
  readonly scopedShmemHost: number[]
  readonly scopedShmemMode: number[]
  readonly socketHost: number[]
  invoke(index: number, ...arguments_: number[]): number
}

function fakeModule(memory: WebAssembly.Memory): FakeModule {
  const callbacks = new Map<number, NumericCallback>()
  let nextCallback = 1
  const processHost: number[] = []
  const signalHost: number[] = []
  const futexHost: number[] = []
  const clockHost: number[] = []
  const shmemHost: number[] = []
  const scopedShmemHost: number[] = []
  const scopedShmemMode: number[] = []
  const socketHost: number[] = []
  const bytes = () => new Uint8Array(memory.buffer)
  const module = {
    wasmMemory: memory,
    HEAP32: new Int32Array(memory.buffer),
    UTF8ToString(pointer: number) {
      let end = pointer
      const heap = bytes()
      while (heap[end] !== 0) end++
      return new TextDecoder().decode(heap.subarray(pointer, end))
    },
    ___errno_location: () => 4,
    addFunction(callback: NumericCallback) {
      const index = nextCallback++
      callbacks.set(index, callback)
      return index
    },
    removeFunction(index: number) {
      callbacks.delete(index)
    },
    _pgl_set_process_host(...indices: number[]) {
      processHost.push(...indices)
    },
    _pgl_set_signal_host(...indices: number[]) {
      signalHost.push(...indices)
    },
    _pgl_set_futex_host(...indices: number[]) {
      futexHost.push(...indices)
    },
    _pgl_set_clock_host(...indices: number[]) {
      clockHost.push(...indices)
    },
    _pgl_set_shmem_host(...indices: number[]) {
      shmemHost.push(...indices)
    },
    _pgl_set_scoped_shmem_host(...indices: number[]) {
      scopedShmemHost.push(...indices)
    },
    _pgl_set_scoped_shmem_mode(mode: number) {
      scopedShmemMode.push(mode)
    },
    _pgl_set_socket_host(...indices: number[]) {
      socketHost.push(...indices)
    },
  } as unknown as PostgresMod
  return {
    module,
    processHost,
    signalHost,
    futexHost,
    clockHost,
    shmemHost,
    scopedShmemHost,
    scopedShmemMode,
    socketHost,
    invoke(index, ...arguments_) {
      const callback = callbacks.get(index)
      if (!callback) throw new Error(`missing callback ${index}`)
      return Number(callback(...arguments_))
    },
  }
}

function writeCString(
  memory: WebAssembly.Memory,
  offset: number,
  value: string,
): void {
  const encoded = new TextEncoder().encode(value)
  const output = new Uint8Array(memory.buffer, offset, encoded.length + 1)
  output.set(encoded)
  output[encoded.length] = 0
}
