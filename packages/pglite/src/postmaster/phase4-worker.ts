import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'
import {
  ProcessControlRegistry,
  ProcessExitKind,
  ProcessScopePolicy,
  ProcessState,
  PostgresProcessKind,
  signalsFromMask,
  type ProcessHandle,
} from './control.js'
import { ConnectionTransport } from './connection.js'
import { SharedLatch } from './latch.js'
import { SharedWordSemaphore } from './semaphore.js'

interface Phase4WorkerData {
  controlBuffer: SharedArrayBuffer
  handle: ProcessHandle
  privateMemory: WebAssembly.Memory
  globalMemory: WebAssembly.Memory
  scopedMemory: WebAssembly.Memory
  connectionBuffer?: SharedArrayBuffer
  module?: WebAssembly.Module
  mode: 'signals' | 'echo' | 'spawn' | 'listener' | 'semaphore' | 'latch'
  sharedWordIndex?: number
  spawn?: {
    childKind: string
    parameterFile: string
    connectionId: number
  }
}

const data = workerData as Phase4WorkerData
const registry = ProcessControlRegistry.attach(data.controlBuffer)
const table = new WebAssembly.Table({ initial: 0, element: 'anyfunc' })

assert.ok(data.privateMemory.buffer instanceof SharedArrayBuffer)
assert.ok(data.globalMemory.buffer instanceof SharedArrayBuffer)
assert.notStrictEqual(data.privateMemory, data.globalMemory)
assert.strictEqual(data.scopedMemory, data.privateMemory)

registry.transition(data.handle, ProcessState.Starting)
if (data.module) new WebAssembly.Instance(data.module, {})
registry.transition(data.handle, ProcessState.Runnable)
parentPort?.postMessage({
  type: 'ready',
  pid: data.handle.pid,
  tableLength: table.length,
  scopedAliasesPrivate: data.scopedMemory === data.privateMemory,
})

try {
  if (data.mode === 'signals') {
    runSignals()
  } else if (data.mode === 'echo') {
    runEcho()
  } else if (data.mode === 'spawn') {
    runSpawn()
  } else if (data.mode === 'listener') {
    runListener()
  } else if (data.mode === 'semaphore') {
    runSemaphore()
  } else {
    runLatch()
  }
  registry.markExit(data.handle, ProcessExitKind.Normal, 0)
} catch (error) {
  registry.markExit(data.handle, ProcessExitKind.WorkerFailure, 1)
  throw error
}

function runSignals(): void {
  while (true) {
    registry.transition(data.handle, ProcessState.Waiting)
    const sequence = registry.wakeSequence(data.handle)
    const mask = registry.takeDeliverableSignals(data.handle)
    if (mask !== 0) {
      registry.transition(data.handle, ProcessState.Runnable)
      const signals = signalsFromMask(mask)
      parentPort?.postMessage({ type: 'signals', signals })
      return
    }
    registry.wait(data.handle, sequence)
    registry.transition(data.handle, ProcessState.Runnable)
  }
}

function runEcho(): void {
  const connectionBuffer = data.connectionBuffer
  assert.ok(connectionBuffer)
  const connection = ConnectionTransport.attach(connectionBuffer)
  while (true) {
    const chunk = connection.inbound.readBlocking(7)
    if (chunk === null) break
    connection.outbound.writeBlocking(chunk)
  }
  connection.outbound.close()
}

function runSpawn(): void {
  const spawn = data.spawn
  assert.ok(spawn)
  const child = registry.requestSpawn(
    data.handle,
    PostgresProcessKind.Backend,
    spawn.childKind,
    spawn.parameterFile,
    {
      connectionId: spawn.connectionId,
      scopePolicy: ProcessScopePolicy.NewRoot,
    },
  )
  parentPort?.postMessage({ type: 'spawn-requested', child })
  runSignals()
}

function runListener(): void {
  const connection = registry.waitForConnection(2_000)
  assert.ok(connection)
  parentPort?.postMessage({ type: 'accepted', connection })
  registry.releaseConnection(connection)
  runSignals()
}

function runSemaphore(): void {
  const index = data.sharedWordIndex
  assert.ok(index !== undefined)
  const semaphore = new SharedWordSemaphore(
    new Int32Array(data.globalMemory.buffer),
    index,
  )
  assert.ok(semaphore.lock(2_000))
  parentPort?.postMessage({ type: 'semaphore-acquired' })
}

function runLatch(): void {
  const index = data.sharedWordIndex
  assert.ok(index !== undefined)
  const latch = new SharedLatch(
    new Int32Array(data.globalMemory.buffer),
    index,
    registry,
  )
  assert.ok(latch.wait(data.handle, 2_000))
  parentPort?.postMessage({
    type: 'latch-set',
    signals: signalsFromMask(registry.takeDeliverableSignals(data.handle)),
  })
}
