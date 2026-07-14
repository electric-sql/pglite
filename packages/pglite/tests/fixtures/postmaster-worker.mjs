import assert from 'node:assert/strict'
import { parentPort, workerData } from 'node:worker_threads'
import {
  ConnectionTransport,
  PostgresProcessKind,
  ProcessControlRegistry,
  ProcessExitKind,
  ProcessScopePolicy,
  ProcessState,
} from '../../dist/postmaster/internal.js'

const data = workerData
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
    await runEcho()
  } else if (data.mode === 'spawn') {
    runSpawn()
  } else if (data.mode === 'listener') {
    runListener()
  } else {
    throw new Error(`unsupported postmaster test Worker mode: ${data.mode}`)
  }
  registry.markExit(data.handle, ProcessExitKind.Normal, 0)
} catch (error) {
  registry.markExit(data.handle, ProcessExitKind.WorkerFailure, 1)
  throw error
}

function runSignals() {
  let waiting = true
  while (waiting) {
    registry.transition(data.handle, ProcessState.Waiting)
    const sequence = registry.wakeSequence(data.handle)
    const mask = registry.takeDeliverableSignals(data.handle)
    if (mask !== 0) {
      registry.transition(data.handle, ProcessState.Runnable)
      parentPort?.postMessage({
        type: 'signals',
        signals: signalsFromMask(mask),
      })
      waiting = false
      continue
    }
    registry.wait(data.handle, sequence)
    registry.transition(data.handle, ProcessState.Runnable)
  }
}

async function runEcho() {
  assert.ok(data.connectionBuffer)
  const connection = ConnectionTransport.attach(data.connectionBuffer)
  let chunk = await connection.inbound.read(7)
  while (chunk !== null) {
    await connection.outbound.write(chunk)
    chunk = await connection.inbound.read(7)
  }
  connection.outbound.close()
}

function runSpawn() {
  assert.ok(data.spawn)
  const child = registry.requestSpawn(
    data.handle,
    PostgresProcessKind.Backend,
    data.spawn.childKind,
    data.spawn.parameterFile,
    {
      connectionId: data.spawn.connectionId,
      scopePolicy: ProcessScopePolicy.NewRoot,
    },
  )
  parentPort?.postMessage({ type: 'spawn-requested', child })
  runSignals()
}

function runListener() {
  const connection = registry.waitForConnection(2_000)
  assert.ok(connection)
  parentPort?.postMessage({ type: 'accepted', connection })
  registry.releaseConnection(connection)
  runSignals()
}

function signalsFromMask(mask) {
  const result = []
  for (let signal = 1; signal <= 31; signal++) {
    if ((mask & (1 << (signal - 1))) !== 0) result.push(signal)
  }
  return result
}
