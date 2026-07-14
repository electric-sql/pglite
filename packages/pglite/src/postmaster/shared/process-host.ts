import {
  PGLITE_SIGNALS,
  PostgresProcessKind,
  ProcessExitKind,
  ProcessScopePolicy,
  type ProcessControlRegistry,
  type ProcessHandle,
} from './control.js'
import type { PostgresMod } from '../../postgresMod.js'
import type { ProcessScopedMemoryMode } from './process-types.js'

const POINTER_TAG_MASK = 0xc0000000
const GLOBAL_POINTER_TAG = 0x80000000
const SCOPED_POINTER_TAG = 0xc0000000
const POINTER_OFFSET_MASK = 0x3fffffff
const WNOHANG = 1
const WASM_PAGE_BYTES = 65_536
const GLOBAL_APERTURE_BYTES = 0x40000000

// Emscripten 3.1.74 exposes WASI errno values through its musl headers.
const ERRNO = {
  EAGAIN: 6,
  ECHILD: 12,
  EINTR: 27,
  EINVAL: 28,
  ESRCH: 71,
  ETIMEDOUT: 73,
} as const

export interface PostmasterProcessHostOptions {
  readonly module: PostgresMod
  readonly registry: ProcessControlRegistry
  readonly process: ProcessHandle
  readonly privateMemory: WebAssembly.Memory
  readonly globalMemory: WebAssembly.Memory
  readonly scopedMemory: WebAssembly.Memory
  readonly scopedMemoryMode: ProcessScopedMemoryMode
  readonly debug?: boolean
  readonly connectionIdForDescriptor?: (descriptor: number) => number
}

/**
 * Installs the synchronous PGlite-libc callbacks used by an EXEC_BACKEND
 * PostgreSQL instance. Each instance owns this object and therefore its own
 * callback table entries and signal-handler state.
 */
export class PostmasterProcessHost {
  private readonly callbacks: number[] = []
  private installed = false

  constructor(private readonly options: PostmasterProcessHostOptions) {}

  install(): void {
    if (this.installed)
      throw new Error('PGlite process host is already installed')
    const { module } = this.options

    const spawn = this.addFunction(
      (
        childKindPointer: number,
        parameterFilePointer: number,
        descriptor: number,
        scopeLeaderPid: number,
      ) =>
        this.spawn(
          childKindPointer,
          parameterFilePointer,
          descriptor,
          scopeLeaderPid,
        ),
      'ippii',
    )
    const getpid = this.addFunction(() => this.options.process.pid, 'i')
    const kill = this.addFunction(
      (target: number, signal: number) => this.kill(target, signal),
      'iii',
    )
    const waitpid = this.addFunction(
      (target: number, statusPointer: number, flags: number) =>
        this.waitpid(target, statusPointer, flags),
      'iipi',
    )
    module._pgl_set_process_host(spawn, getpid, kill, waitpid)

    const signalPoll = this.addFunction(
      () => this.options.registry.takeDeliverableSignals(this.options.process),
      'i',
    )
    const signalMask = this.addFunction(
      (mask: number) =>
        this.options.registry.setBlockedSignals(this.options.process, mask),
      'vi',
    )
    const timer = this.addFunction(
      (delayMs: number, intervalMs: number) =>
        this.setTimer(delayMs, intervalMs),
      'idd',
    )
    module._pgl_set_signal_host(signalPoll, signalMask, timer)

    const futexWait = this.addFunction(
      (pointer: number, expected: number, timeoutMs: number) =>
        this.futexWait(pointer, expected, timeoutMs),
      'ipid',
    )
    const futexWake = this.addFunction(
      (pointer: number, count: number) => this.futexWake(pointer, count),
      'ipi',
    )
    module._pgl_set_futex_host(futexWait, futexWake)

    const clockNow = this.addFunction(
      () =>
        BigInt(Math.floor(performance.timeOrigin * 1000)) +
        BigInt(Math.floor(performance.now() * 1000)),
      'j',
    )
    module._pgl_set_clock_host(clockNow)

    const ensureSharedMemory = this.addFunction(
      (requiredBytes: number) =>
        this.ensureMemory(
          this.options.globalMemory,
          requiredBytes,
          'global shared',
        ),
      'ii',
    )
    const ensureScopedMemory = this.addFunction(
      (requiredBytes: number) =>
        this.ensureMemory(
          this.options.scopedMemory,
          requiredBytes,
          'root-scoped shared',
        ),
      'ii',
    )
    module._pgl_set_shmem_host(ensureSharedMemory)
    module._pgl_set_scoped_shmem_host(ensureScopedMemory)
    module._pgl_set_scoped_shmem_mode(
      this.options.scopedMemoryMode === 'dedicated'
        ? 1
        : this.options.scopedMemoryMode === 'compact'
          ? 2
          : 0,
    )
    this.installed = true
  }

  dispose(): void {
    if (!this.installed) return
    for (const callback of this.callbacks)
      this.options.module.removeFunction(callback)
    this.callbacks.length = 0
    this.installed = false
  }

  private spawn(
    childKindPointer: number,
    parameterFilePointer: number,
    descriptor: number,
    scopeLeaderPid: number,
  ): number {
    try {
      const childKind = this.privateString(childKindPointer)
      const parameterFile = this.privateString(parameterFilePointer)
      const connectionId =
        descriptor < 0
          ? 0
          : (this.options.connectionIdForDescriptor?.(descriptor) ?? descriptor)
      const childProcessKind = processKind(childKind)
      const scope = this.scopePolicy(childProcessKind, scopeLeaderPid)
      const child = this.options.registry.requestSpawn(
        this.options.process,
        childProcessKind,
        childKind,
        parameterFile,
        {
          connectionId,
          ...scope,
        },
      )
      return child.pid
    } catch {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
  }

  private scopePolicy(
    childKind: PostgresProcessKind,
    scopeLeaderPid: number,
  ): {
    scopePolicy: ProcessScopePolicy
    scopeRoot?: ProcessHandle
  } {
    if (scopeLeaderPid > 0) {
      const leader = this.options.registry.lookup(scopeLeaderPid)
      if (!leader) throw new Error(`scope leader ${scopeLeaderPid} is not live`)
      const root = this.options.registry.snapshot(leader).scopeRoot
      if (!root) throw new Error(`scope leader ${scopeLeaderPid} has no root`)
      return {
        scopePolicy: ProcessScopePolicy.AttachRoot,
        scopeRoot: root,
      }
    }
    const parent = this.options.registry.snapshot(this.options.process)
    if (parent.kind === PostgresProcessKind.Postmaster) {
      return {
        scopePolicy:
          childKind === PostgresProcessKind.Auxiliary
            ? ProcessScopePolicy.SelfAlias
            : ProcessScopePolicy.NewRoot,
      }
    }
    return {
      scopePolicy: parent.scopeRoot
        ? ProcessScopePolicy.InheritRoot
        : ProcessScopePolicy.SelfAlias,
    }
  }

  private kill(target: number, signal: number): number {
    try {
      if (this.options.registry.queueSignal(target, signal) > 0) return 0
      this.setErrno(ERRNO.ESRCH)
    } catch {
      this.setErrno(ERRNO.EINVAL)
    }
    return -1
  }

  private waitpid(
    target: number,
    statusPointer: number,
    flags: number,
  ): number {
    const { registry, process } = this.options
    while (true) {
      const exited = registry.findExitedChild(process.pid, target)
      if (exited) {
        if (statusPointer !== 0) {
          this.privateI32(
            statusPointer,
            encodeWaitStatus(exited.exitKind, exited.exitCode),
          )
        }
        registry.reap(exited.handle)
        return exited.handle.pid
      }
      if (!registry.hasChild(process.pid, target)) {
        this.setErrno(ERRNO.ECHILD)
        return -1
      }
      if ((flags & WNOHANG) !== 0) return 0

      const deliverable = registry.peekDeliverableSignals(process)
      if ((deliverable & ~signalMask(PGLITE_SIGNALS.SIGCHLD)) !== 0) {
        this.setErrno(ERRNO.EINTR)
        return -1
      }
      const sequence = registry.wakeSequence(process)
      if (registry.findExitedChild(process.pid, target)) continue
      registry.wait(process, sequence, 50)
    }
  }

  private setTimer(delayMs: number, intervalMs: number): number {
    try {
      this.options.registry.requestTimer(
        this.options.process,
        delayMs,
        intervalMs,
      )
      return 0
    } catch {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
  }

  private futexWait(
    pointer: number,
    expected: number,
    timeoutMs: number,
  ): number {
    try {
      const { words, index } = this.futexLocation(pointer)
      const indefinite = timeoutMs < 0 || !Number.isFinite(timeoutMs)
      const waitFor = indefinite ? 50 : Math.min(timeoutMs, 50)
      const result = Atomics.wait(words, index, expected | 0, waitFor)
      if (result === 'ok') return 0
      if (result === 'not-equal') {
        this.setErrno(ERRNO.EAGAIN)
        return -1
      }
      if (indefinite || timeoutMs > waitFor) return 0
      this.setErrno(ERRNO.ETIMEDOUT)
      return -1
    } catch {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
  }

  private futexWake(pointer: number, count: number): number {
    try {
      const { words, index } = this.futexLocation(pointer)
      return Atomics.notify(words, index, Math.max(0, count))
    } catch {
      this.setErrno(ERRNO.EINVAL)
      return -1
    }
  }

  private ensureMemory(
    memory: WebAssembly.Memory,
    requiredBytes: number,
    label: string,
  ): number {
    try {
      const required = requiredBytes >>> 0
      if (required === 0 || required > GLOBAL_APERTURE_BYTES) return -1
      const currentPages = memory.buffer.byteLength / WASM_PAGE_BYTES
      const requiredPages = Math.ceil(required / WASM_PAGE_BYTES)
      if (this.options.debug) {
        console.error(
          `[postgres:${this.options.process.pid}] ${label} memory request ` +
            `${required} bytes (current ${memory.buffer.byteLength})`,
        )
      }
      if (requiredPages > currentPages)
        memory.grow(requiredPages - currentPages)
      return 0
    } catch (error) {
      if (this.options.debug) console.error(error)
      return -1
    }
  }

  private futexLocation(pointer: number): { words: Int32Array; index: number } {
    const unsigned = pointer >>> 0
    const tag = (unsigned & POINTER_TAG_MASK) >>> 0
    const offset = tag === 0 ? unsigned : unsigned & POINTER_OFFSET_MASK
    const memory =
      tag === 0
        ? this.options.privateMemory
        : tag === GLOBAL_POINTER_TAG
          ? this.options.globalMemory
          : tag === SCOPED_POINTER_TAG
            ? this.options.scopedMemory
            : undefined
    if (!memory || offset % Int32Array.BYTES_PER_ELEMENT !== 0) {
      throw new RangeError('invalid tagged futex address')
    }
    const words = new Int32Array(memory.buffer)
    const index = offset / Int32Array.BYTES_PER_ELEMENT
    if (index >= words.length)
      throw new RangeError('futex address is out of bounds')
    return { words, index }
  }

  private privateString(pointer: number): string {
    this.assertPrivatePointer(pointer)
    return this.options.module.UTF8ToString(pointer)
  }

  private privateI32(pointer: number, value: number): void {
    this.assertPrivatePointer(pointer)
    const words = new Int32Array(this.options.privateMemory.buffer)
    if (
      pointer % Int32Array.BYTES_PER_ELEMENT !== 0 ||
      pointer / 4 >= words.length
    ) {
      throw new RangeError('private i32 pointer is out of bounds')
    }
    words[pointer / 4] = value
  }

  private assertPrivatePointer(pointer: number): void {
    if (((pointer >>> 0) & POINTER_TAG_MASK) !== 0 || pointer <= 0) {
      throw new RangeError('expected a private-memory pointer')
    }
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

function processKind(childKind: string): PostgresProcessKind {
  if (childKind === 'backend' || childKind === 'dead-end backend') {
    return PostgresProcessKind.Backend
  }
  if (childKind === 'bgworker') return PostgresProcessKind.BackgroundWorker
  return PostgresProcessKind.Auxiliary
}

function encodeWaitStatus(kind: ProcessExitKind, code: number): number {
  return kind === ProcessExitKind.Signal ? code & 0x7f : (code & 0xff) << 8
}

function signalMask(signal: number): number {
  return 1 << (signal - 1)
}
