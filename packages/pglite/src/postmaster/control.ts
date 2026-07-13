const CONTROL_MAGIC = 0x50474354
const CONTROL_VERSION = 2
const HEADER_WORDS = 8
const PROCESS_WORDS = 20
const CHILD_KIND_BYTES = 64
const PARAMETER_FILE_BYTES = 1024
const SPAWN_PAYLOAD_BYTES = CHILD_KIND_BYTES + PARAMETER_FILE_BYTES
const CONNECTION_WORDS = 4

const enum HeaderField {
  Magic,
  Version,
  MaxProcesses,
  NextPid,
  WakeSequence,
  LiveProcesses,
  ListenerWakeSequence,
  NextConnectionId,
}

const enum ProcessField {
  Generation,
  Pid,
  ParentPid,
  ProcessGroup,
  Kind,
  State,
  PendingSignals,
  BlockedSignals,
  WakeSequence,
  ExitKind,
  ExitCode,
  ConnectionId,
  Flags,
  SpawnState,
  ScopePolicy,
  ChildKindLength,
  ParameterFileLength,
  TimerDelayMs,
  TimerIntervalMs,
  TimerGeneration,
}

const enum ProcessFlag {
  ParentDead = 1,
}

const enum ConnectionField {
  State,
  Generation,
  ConnectionId,
  Flags,
}

export enum PostgresProcessKind {
  Postmaster = 1,
  Backend,
  Auxiliary,
  BackgroundWorker,
}

export enum ProcessState {
  Free,
  Reserved,
  Starting,
  Runnable,
  Waiting,
  Stopping,
  Exited,
  Failed,
}

export enum ProcessExitKind {
  None,
  Normal,
  Signal,
  WorkerFailure,
}

export enum SpawnRequestState {
  None,
  Ready,
  Claimed,
}

export enum ProcessScopePolicy {
  SelfAlias,
  NewRoot,
  InheritRoot,
  AttachRoot,
}

export enum ConnectionRequestState {
  Free,
  Reserved,
  Ready,
  Claimed,
}

export const PGLITE_SIGNALS = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGTERM: 15,
  SIGALRM: 14,
  SIGCHLD: 17,
  SIGURG: 23,
  SIGUSR1: 10,
  SIGUSR2: 12,
} as const

export interface ProcessHandle {
  readonly slot: number
  readonly pid: number
  readonly generation: number
}

export interface ProcessSnapshot extends ProcessHandle {
  readonly parentPid: number
  readonly processGroup: number
  readonly kind: PostgresProcessKind
  readonly state: ProcessState
  readonly pendingSignals: number
  readonly blockedSignals: number
  readonly wakeSequence: number
  readonly exitKind: ProcessExitKind
  readonly exitCode: number
  readonly connectionId: number
  readonly parentDead: boolean
}

export interface ReserveProcessOptions {
  parentPid?: number
  processGroup?: number
  connectionId?: number
}

export interface SpawnProcessOptions extends ReserveProcessOptions {
  scopePolicy?: ProcessScopePolicy
}

export interface SpawnRequest {
  readonly handle: ProcessHandle
  readonly parentPid: number
  readonly processKind: PostgresProcessKind
  readonly childKind: string
  readonly parameterFile: string
  readonly connectionId: number
  readonly scopePolicy: ProcessScopePolicy
}

export interface VirtualConnectionHandle {
  readonly slot: number
  readonly id: number
  readonly generation: number
}

export interface WaitResult {
  readonly handle: ProcessHandle
  readonly exitKind: ProcessExitKind
  readonly exitCode: number
}

export interface ProcessTimerRequest {
  readonly handle: ProcessHandle
  readonly delayMs: number
  readonly intervalMs: number
  readonly generation: number
}

type WaitAsyncResult =
  | { async: false; value: 'not-equal' | 'timed-out' }
  | {
      async: true
      value: Promise<'ok' | 'not-equal' | 'timed-out'>
    }

const atomicsWaitAsync = (
  Atomics as typeof Atomics & {
    waitAsync: (
      array: Int32Array,
      index: number,
      value: number,
      timeout?: number,
    ) => WaitAsyncResult
  }
).waitAsync

export async function waitAsync(
  words: Int32Array,
  index: number,
  expected: number,
  timeout?: number,
): Promise<'ok' | 'not-equal' | 'timed-out'> {
  const wait = atomicsWaitAsync(words, index, expected, timeout)
  if (!wait.async) return wait.value

  // V8's Atomics.waitAsync promise does not keep Node's event loop alive. A
  // postmaster shutdown can otherwise lose its last Worker while the
  // supervisor is still awaiting a SAB state transition, and Node exits with
  // an unsettled top-level await. Keep one ref'ed host handle for the wait.
  const keepAlive = setInterval(() => {}, 60_000)
  try {
    return await wait.value
  } finally {
    clearInterval(keepAlive)
  }
}

export class ProcessControlRegistry {
  readonly buffer: SharedArrayBuffer
  readonly words: Int32Array
  readonly maxProcesses: number

  private constructor(buffer: SharedArrayBuffer) {
    this.buffer = buffer
    this.words = new Int32Array(buffer)
    if (Atomics.load(this.words, HeaderField.Magic) !== CONTROL_MAGIC) {
      throw new Error('invalid PGlite process-control magic')
    }
    if (Atomics.load(this.words, HeaderField.Version) !== CONTROL_VERSION) {
      throw new Error('unsupported PGlite process-control version')
    }
    this.maxProcesses = Atomics.load(this.words, HeaderField.MaxProcesses)
    if (
      buffer.byteLength !==
      (HEADER_WORDS + this.maxProcesses * PROCESS_WORDS) *
        Int32Array.BYTES_PER_ELEMENT +
        this.maxProcesses * SPAWN_PAYLOAD_BYTES +
        this.maxProcesses * CONNECTION_WORDS * Int32Array.BYTES_PER_ELEMENT
    ) {
      throw new Error('invalid PGlite process-control buffer size')
    }
  }

  static create(maxProcesses: number): ProcessControlRegistry {
    if (!Number.isInteger(maxProcesses) || maxProcesses <= 0) {
      throw new RangeError('maxProcesses must be a positive integer')
    }
    const buffer = new SharedArrayBuffer(
      (HEADER_WORDS + maxProcesses * PROCESS_WORDS) *
        Int32Array.BYTES_PER_ELEMENT +
        maxProcesses * SPAWN_PAYLOAD_BYTES +
        maxProcesses * CONNECTION_WORDS * Int32Array.BYTES_PER_ELEMENT,
    )
    const words = new Int32Array(buffer)
    Atomics.store(words, HeaderField.Magic, CONTROL_MAGIC)
    Atomics.store(words, HeaderField.Version, CONTROL_VERSION)
    Atomics.store(words, HeaderField.MaxProcesses, maxProcesses)
    Atomics.store(words, HeaderField.NextPid, 10_000)
    Atomics.store(words, HeaderField.NextConnectionId, 1)
    return new ProcessControlRegistry(buffer)
  }

  static attach(buffer: SharedArrayBuffer): ProcessControlRegistry {
    return new ProcessControlRegistry(buffer)
  }

  reserve(
    kind: PostgresProcessKind,
    options: ReserveProcessOptions = {},
  ): ProcessHandle {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      const stateIndex = this.index(slot, ProcessField.State)
      if (
        Atomics.compareExchange(
          this.words,
          stateIndex,
          ProcessState.Free,
          ProcessState.Reserved,
        ) !== ProcessState.Free
      ) {
        continue
      }

      const generationIndex = this.index(slot, ProcessField.Generation)
      let generation = (Atomics.add(this.words, generationIndex, 1) + 1) >>> 0
      if (generation === 0) {
        generation = 1
        Atomics.store(this.words, generationIndex, generation)
      }
      const pid = Atomics.add(this.words, HeaderField.NextPid, 1)
      const parentPid = options.parentPid ?? 0
      const processGroup = options.processGroup ?? pid
      Atomics.store(this.words, this.index(slot, ProcessField.Pid), pid)
      Atomics.store(
        this.words,
        this.index(slot, ProcessField.ParentPid),
        parentPid,
      )
      Atomics.store(
        this.words,
        this.index(slot, ProcessField.ProcessGroup),
        processGroup,
      )
      Atomics.store(this.words, this.index(slot, ProcessField.Kind), kind)
      Atomics.store(
        this.words,
        this.index(slot, ProcessField.ConnectionId),
        options.connectionId ?? 0,
      )
      Atomics.add(this.words, HeaderField.LiveProcesses, 1)
      this.wakeRegistry()
      return { slot, pid, generation }
    }
    throw new Error('PGlite process-control registry is full')
  }

  requestSpawn(
    parent: ProcessHandle,
    processKind: PostgresProcessKind,
    childKind: string,
    parameterFile: string,
    options: SpawnProcessOptions = {},
  ): ProcessHandle {
    this.assertCurrent(parent)
    const childKindBytes = encodeBounded(
      childKind,
      CHILD_KIND_BYTES,
      'child kind',
    )
    const parameterFileBytes = encodeBounded(
      parameterFile,
      PARAMETER_FILE_BYTES,
      'backend parameter filename',
    )
    const handle = this.reserve(processKind, {
      ...options,
      parentPid: parent.pid,
    })
    const payload = new Uint8Array(
      this.buffer,
      this.payloadOffset(handle.slot),
      SPAWN_PAYLOAD_BYTES,
    )
    payload.fill(0)
    payload.set(childKindBytes)
    payload.set(parameterFileBytes, CHILD_KIND_BYTES)
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.ScopePolicy),
      options.scopePolicy ?? ProcessScopePolicy.SelfAlias,
    )
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.ChildKindLength),
      childKindBytes.length,
    )
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.ParameterFileLength),
      parameterFileBytes.length,
    )
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.State),
      ProcessState.Starting,
    )
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.SpawnState),
      SpawnRequestState.Ready,
    )
    this.wake(handle)
    this.wakeRegistry()
    return handle
  }

  claimSpawn(): SpawnRequest | undefined {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      if (
        Atomics.compareExchange(
          this.words,
          this.index(slot, ProcessField.SpawnState),
          SpawnRequestState.Ready,
          SpawnRequestState.Claimed,
        ) !== SpawnRequestState.Ready
      ) {
        continue
      }
      const pid = Atomics.load(this.words, this.index(slot, ProcessField.Pid))
      const handle = {
        slot,
        pid,
        generation: Atomics.load(
          this.words,
          this.index(slot, ProcessField.Generation),
        ),
      }
      if (!this.isCurrent(handle)) {
        Atomics.store(
          this.words,
          this.index(slot, ProcessField.SpawnState),
          SpawnRequestState.None,
        )
        continue
      }
      const childKindLength = this.spawnLength(
        slot,
        ProcessField.ChildKindLength,
        CHILD_KIND_BYTES,
      )
      const parameterFileLength = this.spawnLength(
        slot,
        ProcessField.ParameterFileLength,
        PARAMETER_FILE_BYTES,
      )
      const payload = new Uint8Array(
        this.buffer,
        this.payloadOffset(slot),
        SPAWN_PAYLOAD_BYTES,
      )
      return {
        handle,
        parentPid: Atomics.load(
          this.words,
          this.index(slot, ProcessField.ParentPid),
        ),
        processKind: Atomics.load(
          this.words,
          this.index(slot, ProcessField.Kind),
        ) as PostgresProcessKind,
        childKind: new TextDecoder().decode(
          payload.subarray(0, childKindLength),
        ),
        parameterFile: new TextDecoder().decode(
          payload.subarray(
            CHILD_KIND_BYTES,
            CHILD_KIND_BYTES + parameterFileLength,
          ),
        ),
        connectionId: Atomics.load(
          this.words,
          this.index(slot, ProcessField.ConnectionId),
        ),
        scopePolicy: Atomics.load(
          this.words,
          this.index(slot, ProcessField.ScopePolicy),
        ) as ProcessScopePolicy,
      }
    }
    return undefined
  }

  async waitForSpawn(timeoutMs?: number): Promise<SpawnRequest | undefined> {
    const started = performance.now()
    while (true) {
      const request = this.claimSpawn()
      if (request) return request
      const elapsed = performance.now() - started
      if (timeoutMs !== undefined && elapsed >= timeoutMs) return undefined
      const sequence = Atomics.load(this.words, HeaderField.WakeSequence)
      if (this.hasReadySpawn()) continue
      const remaining =
        timeoutMs === undefined ? undefined : Math.max(0, timeoutMs - elapsed)
      await waitAsync(this.words, HeaderField.WakeSequence, sequence, remaining)
    }
  }

  completeSpawn(request: SpawnRequest): boolean {
    if (!this.isCurrent(request.handle)) return false
    return (
      Atomics.compareExchange(
        this.words,
        this.index(request.handle.slot, ProcessField.SpawnState),
        SpawnRequestState.Claimed,
        SpawnRequestState.None,
      ) === SpawnRequestState.Claimed
    )
  }

  failSpawn(request: SpawnRequest, exitCode = 1): boolean {
    if (!this.completeSpawn(request)) return false
    return this.markExit(
      request.handle,
      ProcessExitKind.WorkerFailure,
      exitCode,
    )
  }

  reserveConnection(): VirtualConnectionHandle {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      const stateIndex = this.connectionIndex(slot, ConnectionField.State)
      if (
        Atomics.compareExchange(
          this.words,
          stateIndex,
          ConnectionRequestState.Free,
          ConnectionRequestState.Reserved,
        ) !== ConnectionRequestState.Free
      ) {
        continue
      }
      const generationIndex = this.connectionIndex(
        slot,
        ConnectionField.Generation,
      )
      let generation = (Atomics.add(this.words, generationIndex, 1) + 1) >>> 0
      if (generation === 0) {
        generation = 1
        Atomics.store(this.words, generationIndex, generation)
      }
      const id = Atomics.add(this.words, HeaderField.NextConnectionId, 1)
      Atomics.store(
        this.words,
        this.connectionIndex(slot, ConnectionField.ConnectionId),
        id,
      )
      return { slot, id, generation }
    }
    throw new Error('PGlite virtual-listener queue is full')
  }

  publishConnection(
    connection: VirtualConnectionHandle,
    postmaster: ProcessHandle,
  ): void {
    this.assertConnection(connection, ConnectionRequestState.Reserved)
    this.assertCurrent(postmaster)
    Atomics.store(
      this.words,
      this.connectionIndex(connection.slot, ConnectionField.State),
      ConnectionRequestState.Ready,
    )
    this.wakeListener()
    this.wake(postmaster)
  }

  acceptConnection(): VirtualConnectionHandle | undefined {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      if (
        Atomics.compareExchange(
          this.words,
          this.connectionIndex(slot, ConnectionField.State),
          ConnectionRequestState.Ready,
          ConnectionRequestState.Claimed,
        ) !== ConnectionRequestState.Ready
      ) {
        continue
      }
      return {
        slot,
        id: Atomics.load(
          this.words,
          this.connectionIndex(slot, ConnectionField.ConnectionId),
        ),
        generation: Atomics.load(
          this.words,
          this.connectionIndex(slot, ConnectionField.Generation),
        ),
      }
    }
    return undefined
  }

  waitForConnection(timeout?: number): VirtualConnectionHandle | undefined {
    const started = performance.now()
    while (true) {
      const connection = this.acceptConnection()
      if (connection) return connection
      const elapsed = performance.now() - started
      if (timeout !== undefined && elapsed >= timeout) return undefined
      const sequence = Atomics.load(
        this.words,
        HeaderField.ListenerWakeSequence,
      )
      if (this.hasReadyConnection()) continue
      Atomics.wait(
        this.words,
        HeaderField.ListenerWakeSequence,
        sequence,
        timeout === undefined ? undefined : Math.max(0, timeout - elapsed),
      )
    }
  }

  async waitForConnectionAsync(
    timeout?: number,
  ): Promise<VirtualConnectionHandle | undefined> {
    const started = performance.now()
    while (true) {
      const connection = this.acceptConnection()
      if (connection) return connection
      const elapsed = performance.now() - started
      if (timeout !== undefined && elapsed >= timeout) return undefined
      const sequence = Atomics.load(
        this.words,
        HeaderField.ListenerWakeSequence,
      )
      if (this.hasReadyConnection()) continue
      await waitAsync(
        this.words,
        HeaderField.ListenerWakeSequence,
        sequence,
        timeout === undefined ? undefined : Math.max(0, timeout - elapsed),
      )
    }
  }

  releaseConnection(connection: VirtualConnectionHandle): void {
    this.assertConnection(connection, ConnectionRequestState.Claimed)
    Atomics.store(
      this.words,
      this.connectionIndex(connection.slot, ConnectionField.ConnectionId),
      0,
    )
    Atomics.store(
      this.words,
      this.connectionIndex(connection.slot, ConnectionField.Flags),
      0,
    )
    Atomics.store(
      this.words,
      this.connectionIndex(connection.slot, ConnectionField.State),
      ConnectionRequestState.Free,
    )
    this.wakeListener()
  }

  assignConnectionOwner(
    connection: VirtualConnectionHandle,
    owner: ProcessHandle,
  ): void {
    this.assertConnection(connection, ConnectionRequestState.Claimed)
    this.assertCurrent(owner)
    Atomics.store(
      this.words,
      this.connectionIndex(connection.slot, ConnectionField.Flags),
      owner.pid,
    )
    this.wake(owner)
  }

  notifyConnectionOwner(connection: VirtualConnectionHandle): boolean {
    if (!this.isConnectionCurrent(connection)) return false
    const ownerPid = Atomics.load(
      this.words,
      this.connectionIndex(connection.slot, ConnectionField.Flags),
    )
    if (ownerPid === 0) return false
    const owner = this.lookup(ownerPid)
    if (!owner) return false
    this.wake(owner)
    return true
  }

  findConnection(connectionId: number): VirtualConnectionHandle | undefined {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      if (
        Atomics.load(
          this.words,
          this.connectionIndex(slot, ConnectionField.ConnectionId),
        ) !== connectionId
      ) {
        continue
      }
      const state = Atomics.load(
        this.words,
        this.connectionIndex(slot, ConnectionField.State),
      )
      if (state === ConnectionRequestState.Free) return undefined
      return {
        slot,
        id: connectionId,
        generation:
          Atomics.load(
            this.words,
            this.connectionIndex(slot, ConnectionField.Generation),
          ) >>> 0,
      }
    }
    return undefined
  }

  hasPendingConnection(): boolean {
    return this.hasReadyConnection()
  }

  connectionOwner(connection: VirtualConnectionHandle): number {
    if (!this.isConnectionCurrent(connection)) return 0
    return Atomics.load(
      this.words,
      this.connectionIndex(connection.slot, ConnectionField.Flags),
    )
  }

  notify(handle: ProcessHandle): void {
    this.assertCurrent(handle)
    this.wake(handle)
  }

  isCurrent(handle: ProcessHandle): boolean {
    return (
      handle.slot >= 0 &&
      handle.slot < this.maxProcesses &&
      Atomics.load(
        this.words,
        this.index(handle.slot, ProcessField.Generation),
      ) === handle.generation &&
      Atomics.load(this.words, this.index(handle.slot, ProcessField.Pid)) ===
        handle.pid &&
      Atomics.load(this.words, this.index(handle.slot, ProcessField.State)) !==
        ProcessState.Free
    )
  }

  transition(handle: ProcessHandle, state: ProcessState): void {
    this.assertCurrent(handle)
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.State),
      state,
    )
    this.wake(handle)
  }

  snapshot(handle: ProcessHandle): ProcessSnapshot {
    this.assertCurrent(handle)
    const load = (field: ProcessField) =>
      Atomics.load(this.words, this.index(handle.slot, field))
    return {
      ...handle,
      parentPid: load(ProcessField.ParentPid),
      processGroup: load(ProcessField.ProcessGroup),
      kind: load(ProcessField.Kind) as PostgresProcessKind,
      state: load(ProcessField.State) as ProcessState,
      pendingSignals: load(ProcessField.PendingSignals),
      blockedSignals: load(ProcessField.BlockedSignals),
      wakeSequence: load(ProcessField.WakeSequence),
      exitKind: load(ProcessField.ExitKind) as ProcessExitKind,
      exitCode: load(ProcessField.ExitCode),
      connectionId: load(ProcessField.ConnectionId),
      parentDead: (load(ProcessField.Flags) & ProcessFlag.ParentDead) !== 0,
    }
  }

  lookup(pid: number): ProcessHandle | undefined {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      if (
        Atomics.load(this.words, this.index(slot, ProcessField.State)) !==
          ProcessState.Free &&
        Atomics.load(this.words, this.index(slot, ProcessField.Pid)) === pid
      ) {
        return {
          slot,
          pid,
          generation: Atomics.load(
            this.words,
            this.index(slot, ProcessField.Generation),
          ),
        }
      }
    }
    return undefined
  }

  setBlockedSignals(handle: ProcessHandle, mask: number): void {
    this.assertCurrent(handle)
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.BlockedSignals),
      mask,
    )
    this.wake(handle)
  }

  peekDeliverableSignals(handle: ProcessHandle): number {
    this.assertCurrent(handle)
    return (
      Atomics.load(
        this.words,
        this.index(handle.slot, ProcessField.PendingSignals),
      ) &
      ~Atomics.load(
        this.words,
        this.index(handle.slot, ProcessField.BlockedSignals),
      )
    )
  }

  queueSignal(target: number, signal: number): number {
    if (signal === 0) {
      return this.targets(target).length
    }
    const bit = signalBit(signal)
    const targets = this.targets(target)
    for (const handle of targets) {
      Atomics.or(
        this.words,
        this.index(handle.slot, ProcessField.PendingSignals),
        bit,
      )
      this.wake(handle)
    }
    return targets.length
  }

  queueSignalHandle(handle: ProcessHandle, signal: number): boolean {
    if (!this.isCurrent(handle)) return false
    if (signal !== 0) {
      Atomics.or(
        this.words,
        this.index(handle.slot, ProcessField.PendingSignals),
        signalBit(signal),
      )
      this.wake(handle)
    }
    return true
  }

  takeDeliverableSignals(handle: ProcessHandle): number {
    this.assertCurrent(handle)
    const pendingIndex = this.index(handle.slot, ProcessField.PendingSignals)
    const blocked = Atomics.load(
      this.words,
      this.index(handle.slot, ProcessField.BlockedSignals),
    )
    while (true) {
      const pending = Atomics.load(this.words, pendingIndex)
      const deliverable = pending & ~blocked
      if (deliverable === 0) return 0
      if (
        Atomics.compareExchange(
          this.words,
          pendingIndex,
          pending,
          pending & ~deliverable,
        ) === pending
      ) {
        return deliverable
      }
    }
  }

  requestTimer(handle: ProcessHandle, delayMs: number, intervalMs = 0): number {
    this.assertCurrent(handle)
    const delay = timerMilliseconds(delayMs, 'timer delay')
    const interval = timerMilliseconds(intervalMs, 'timer interval')
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.TimerDelayMs),
      delay,
    )
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.TimerIntervalMs),
      interval,
    )
    const generation =
      (Atomics.add(
        this.words,
        this.index(handle.slot, ProcessField.TimerGeneration),
        1,
      ) +
        1) >>>
      0
    this.wakeRegistry()
    return generation
  }

  timerRequest(handle: ProcessHandle): ProcessTimerRequest {
    this.assertCurrent(handle)
    return {
      handle,
      delayMs: Atomics.load(
        this.words,
        this.index(handle.slot, ProcessField.TimerDelayMs),
      ),
      intervalMs: Atomics.load(
        this.words,
        this.index(handle.slot, ProcessField.TimerIntervalMs),
      ),
      generation:
        Atomics.load(
          this.words,
          this.index(handle.slot, ProcessField.TimerGeneration),
        ) >>> 0,
    }
  }

  handles(): ProcessHandle[] {
    const handles: ProcessHandle[] = []
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      const state = Atomics.load(
        this.words,
        this.index(slot, ProcessField.State),
      )
      if (state === ProcessState.Free) continue
      handles.push({
        slot,
        pid: Atomics.load(this.words, this.index(slot, ProcessField.Pid)),
        generation:
          Atomics.load(
            this.words,
            this.index(slot, ProcessField.Generation),
          ) >>> 0,
      })
    }
    return handles
  }

  wakeSequence(handle: ProcessHandle): number {
    this.assertCurrent(handle)
    return Atomics.load(
      this.words,
      this.index(handle.slot, ProcessField.WakeSequence),
    )
  }

  wait(handle: ProcessHandle, sequence: number, timeout?: number): string {
    this.assertCurrent(handle)
    return Atomics.wait(
      this.words,
      this.index(handle.slot, ProcessField.WakeSequence),
      sequence,
      timeout,
    )
  }

  async waitAsync(
    handle: ProcessHandle,
    sequence: number,
    timeout?: number,
  ): Promise<string> {
    this.assertCurrent(handle)
    return waitAsync(
      this.words,
      this.index(handle.slot, ProcessField.WakeSequence),
      sequence,
      timeout,
    )
  }

  markExit(
    handle: ProcessHandle,
    exitKind: ProcessExitKind,
    exitCode: number,
  ): boolean {
    if (!this.isCurrent(handle)) return false
    const stateIndex = this.index(handle.slot, ProcessField.State)
    const state = Atomics.load(this.words, stateIndex)
    if (state === ProcessState.Exited || state === ProcessState.Failed) {
      return false
    }
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.ExitKind),
      exitKind,
    )
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.ExitCode),
      exitCode,
    )
    Atomics.store(
      this.words,
      stateIndex,
      exitKind === ProcessExitKind.WorkerFailure
        ? ProcessState.Failed
        : ProcessState.Exited,
    )
    Atomics.sub(this.words, HeaderField.LiveProcesses, 1)
    this.wake(handle)

    const parentPid = Atomics.load(
      this.words,
      this.index(handle.slot, ProcessField.ParentPid),
    )
    const parent = this.lookup(parentPid)
    if (parent) this.queueSignalHandle(parent, PGLITE_SIGNALS.SIGCHLD)
    this.markChildrenParentDead(handle.pid)
    this.wakeRegistry()
    return true
  }

  findExitedChild(parentPid: number, targetPid = -1): WaitResult | undefined {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      const state = Atomics.load(
        this.words,
        this.index(slot, ProcessField.State),
      )
      if (state !== ProcessState.Exited && state !== ProcessState.Failed)
        continue
      const pid = Atomics.load(this.words, this.index(slot, ProcessField.Pid))
      if (targetPid > 0 && pid !== targetPid) continue
      if (
        Atomics.load(this.words, this.index(slot, ProcessField.ParentPid)) !==
        parentPid
      ) {
        continue
      }
      const handle = {
        slot,
        pid,
        generation: Atomics.load(
          this.words,
          this.index(slot, ProcessField.Generation),
        ),
      }
      return {
        handle,
        exitKind: Atomics.load(
          this.words,
          this.index(slot, ProcessField.ExitKind),
        ) as ProcessExitKind,
        exitCode: Atomics.load(
          this.words,
          this.index(slot, ProcessField.ExitCode),
        ),
      }
    }
    return undefined
  }

  async waitpid(
    parentPid: number,
    targetPid = -1,
    timeoutMs?: number,
  ): Promise<WaitResult | undefined> {
    const started = performance.now()
    while (true) {
      const exited = this.findExitedChild(parentPid, targetPid)
      if (exited) return exited
      const elapsed = performance.now() - started
      if (timeoutMs !== undefined && elapsed >= timeoutMs) return undefined
      const sequence = Atomics.load(this.words, HeaderField.WakeSequence)
      const remaining =
        timeoutMs === undefined ? undefined : Math.max(0, timeoutMs - elapsed)
      await waitAsync(this.words, HeaderField.WakeSequence, sequence, remaining)
    }
  }

  hasChild(parentPid: number, targetPid = -1): boolean {
    for (const handle of this.handles()) {
      if (targetPid > 0 && handle.pid !== targetPid) continue
      if (this.snapshot(handle).parentPid === parentPid) return true
    }
    return false
  }

  registryWakeSequence(): number {
    return Atomics.load(this.words, HeaderField.WakeSequence)
  }

  waitForRegistryChange(sequence: number, timeout?: number): string {
    return Atomics.wait(this.words, HeaderField.WakeSequence, sequence, timeout)
  }

  async waitForRegistryChangeAsync(
    sequence: number,
    timeout?: number,
  ): Promise<string> {
    return waitAsync(this.words, HeaderField.WakeSequence, sequence, timeout)
  }

  reap(handle: ProcessHandle): WaitResult {
    const snapshot = this.snapshot(handle)
    if (
      snapshot.state !== ProcessState.Exited &&
      snapshot.state !== ProcessState.Failed
    ) {
      throw new Error(`cannot reap live process ${handle.pid}`)
    }
    const result = {
      handle,
      exitKind: snapshot.exitKind,
      exitCode: snapshot.exitCode,
    }
    const base = this.index(handle.slot, 0)
    const generation = Atomics.load(
      this.words,
      this.index(handle.slot, ProcessField.Generation),
    )
    for (let field = 0; field < PROCESS_WORDS; field++) {
      Atomics.store(this.words, base + field, 0)
    }
    new Uint8Array(
      this.buffer,
      this.payloadOffset(handle.slot),
      SPAWN_PAYLOAD_BYTES,
    ).fill(0)
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.Generation),
      generation,
    )
    Atomics.store(
      this.words,
      this.index(handle.slot, ProcessField.State),
      ProcessState.Free,
    )
    this.wakeRegistry()
    return result
  }

  private targets(target: number): ProcessHandle[] {
    const result: ProcessHandle[] = []
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      const state = Atomics.load(
        this.words,
        this.index(slot, ProcessField.State),
      )
      if (
        state === ProcessState.Free ||
        state === ProcessState.Exited ||
        state === ProcessState.Failed
      ) {
        continue
      }
      const pid = Atomics.load(this.words, this.index(slot, ProcessField.Pid))
      const group = Atomics.load(
        this.words,
        this.index(slot, ProcessField.ProcessGroup),
      )
      if ((target > 0 && pid !== target) || (target < 0 && group !== -target)) {
        continue
      }
      result.push({
        slot,
        pid,
        generation: Atomics.load(
          this.words,
          this.index(slot, ProcessField.Generation),
        ),
      })
    }
    return result
  }

  private markChildrenParentDead(parentPid: number): void {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      if (
        Atomics.load(this.words, this.index(slot, ProcessField.ParentPid)) !==
        parentPid
      ) {
        continue
      }
      const state = Atomics.load(
        this.words,
        this.index(slot, ProcessField.State),
      )
      if (state === ProcessState.Free) continue
      Atomics.or(
        this.words,
        this.index(slot, ProcessField.Flags),
        ProcessFlag.ParentDead,
      )
      const handle = this.lookup(
        Atomics.load(this.words, this.index(slot, ProcessField.Pid)),
      )
      if (handle) this.wake(handle)
    }
  }

  private hasReadySpawn(): boolean {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      if (
        Atomics.load(this.words, this.index(slot, ProcessField.SpawnState)) ===
        SpawnRequestState.Ready
      ) {
        return true
      }
    }
    return false
  }

  private hasReadyConnection(): boolean {
    for (let slot = 0; slot < this.maxProcesses; slot++) {
      if (
        Atomics.load(
          this.words,
          this.connectionIndex(slot, ConnectionField.State),
        ) === ConnectionRequestState.Ready
      ) {
        return true
      }
    }
    return false
  }

  private assertConnection(
    connection: VirtualConnectionHandle,
    state: ConnectionRequestState,
  ): void {
    if (
      connection.slot < 0 ||
      connection.slot >= this.maxProcesses ||
      Atomics.load(
        this.words,
        this.connectionIndex(connection.slot, ConnectionField.Generation),
      ) !== connection.generation ||
      Atomics.load(
        this.words,
        this.connectionIndex(connection.slot, ConnectionField.ConnectionId),
      ) !== connection.id ||
      Atomics.load(
        this.words,
        this.connectionIndex(connection.slot, ConnectionField.State),
      ) !== state
    ) {
      throw new Error(
        `stale PGlite connection handle ${connection.id}/${connection.generation}`,
      )
    }
  }

  private isConnectionCurrent(connection: VirtualConnectionHandle): boolean {
    if (connection.slot < 0 || connection.slot >= this.maxProcesses) {
      return false
    }
    return (
      Atomics.load(
        this.words,
        this.connectionIndex(connection.slot, ConnectionField.Generation),
      ) === connection.generation &&
      Atomics.load(
        this.words,
        this.connectionIndex(connection.slot, ConnectionField.ConnectionId),
      ) === connection.id &&
      Atomics.load(
        this.words,
        this.connectionIndex(connection.slot, ConnectionField.State),
      ) !== ConnectionRequestState.Free
    )
  }

  private spawnLength(
    slot: number,
    field: ProcessField,
    maximum: number,
  ): number {
    const length = Atomics.load(this.words, this.index(slot, field))
    if (length < 0 || length > maximum) {
      throw new Error(`corrupt PGlite spawn payload length ${length}`)
    }
    return length
  }

  private wake(handle: ProcessHandle): void {
    const index = this.index(handle.slot, ProcessField.WakeSequence)
    Atomics.add(this.words, index, 1)
    Atomics.notify(this.words, index)
  }

  private wakeRegistry(): void {
    Atomics.add(this.words, HeaderField.WakeSequence, 1)
    Atomics.notify(this.words, HeaderField.WakeSequence)
  }

  private wakeListener(): void {
    Atomics.add(this.words, HeaderField.ListenerWakeSequence, 1)
    Atomics.notify(this.words, HeaderField.ListenerWakeSequence)
  }

  private assertCurrent(handle: ProcessHandle): void {
    if (!this.isCurrent(handle)) {
      throw new Error(
        `stale PGlite process handle ${handle.pid}/${handle.generation}`,
      )
    }
  }

  private index(slot: number, field: ProcessField | number): number {
    return HEADER_WORDS + slot * PROCESS_WORDS + field
  }

  private payloadOffset(slot: number): number {
    return (
      (HEADER_WORDS + this.maxProcesses * PROCESS_WORDS) *
        Int32Array.BYTES_PER_ELEMENT +
      slot * SPAWN_PAYLOAD_BYTES
    )
  }

  private connectionIndex(slot: number, field: ConnectionField): number {
    return (
      this.connectionOffset() / Int32Array.BYTES_PER_ELEMENT +
      slot * CONNECTION_WORDS +
      field
    )
  }

  private connectionOffset(): number {
    return (
      (HEADER_WORDS + this.maxProcesses * PROCESS_WORDS) *
        Int32Array.BYTES_PER_ELEMENT +
      this.maxProcesses * SPAWN_PAYLOAD_BYTES
    )
  }
}

function encodeBounded(
  value: string,
  maximum: number,
  name: string,
): Uint8Array {
  if (value.includes('\0')) throw new Error(`${name} cannot contain NUL`)
  const encoded = new TextEncoder().encode(value)
  if (encoded.length === 0 || encoded.length >= maximum) {
    throw new RangeError(`${name} exceeds the ${maximum - 1}-byte limit`)
  }
  return encoded
}

function signalBit(signal: number): number {
  if (!Number.isInteger(signal) || signal <= 0 || signal > 31) {
    throw new RangeError(`unsupported signal number ${signal}`)
  }
  return 1 << (signal - 1)
}

function timerMilliseconds(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 0x7fffffff) {
    throw new RangeError(`${name} is outside the supported range`)
  }
  return Math.ceil(value)
}

export function signalsFromMask(mask: number): number[] {
  const result: number[] = []
  for (let signal = 1; signal <= 31; signal++) {
    if ((mask & signalBit(signal)) !== 0) result.push(signal)
  }
  return result
}
