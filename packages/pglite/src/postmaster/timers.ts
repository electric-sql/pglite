import {
  PGLITE_SIGNALS,
  type ProcessTimerRequest,
  type ProcessControlRegistry,
  type ProcessHandle,
} from './control.js'

export class SupervisorTimers {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly generations = new Map<string, number>()
  private running = false
  private closed = false

  constructor(private readonly registry: ProcessControlRegistry) {}

  async run(): Promise<void> {
    if (this.running)
      throw new Error('supervisor timer loop is already running')
    this.running = true
    this.closed = false
    try {
      while (!this.closed) {
        this.refreshRequests()
        const sequence = this.registry.registryWakeSequence()
        this.refreshRequests()
        if (!this.closed) {
          await this.registry.waitForRegistryChangeAsync(sequence, 1_000)
        }
      }
    } finally {
      this.running = false
    }
  }

  cancel(handle: ProcessHandle): void {
    const key = timerKey(handle)
    const timer = this.timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(key)
  }

  close(): void {
    this.closed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.generations.clear()
  }

  private refreshRequests(): void {
    const live = new Set<string>()
    for (const handle of this.registry.handles()) {
      const key = timerKey(handle)
      let request: ProcessTimerRequest
      try {
        // A Worker may be reaped between handles() taking its snapshot and
        // this SAB read. Treat that generation as gone instead of failing the
        // supervisor loop during ordinary process exit.
        request = this.registry.timerRequest(handle)
      } catch {
        continue
      }
      live.add(key)
      if (this.generations.get(key) === request.generation) continue
      this.generations.set(key, request.generation)
      this.arm(request)
    }
    for (const key of this.generations.keys()) {
      if (live.has(key)) continue
      const timer = this.timers.get(key)
      if (timer !== undefined) clearTimeout(timer)
      this.timers.delete(key)
      this.generations.delete(key)
    }
  }

  private arm(request: ProcessTimerRequest): void {
    this.cancel(request.handle)
    if (request.delayMs === 0) return
    const key = timerKey(request.handle)
    const fire = () => {
      this.timers.delete(key)
      if (
        !this.registry.queueSignalHandle(request.handle, PGLITE_SIGNALS.SIGALRM)
      ) {
        return
      }
      if (request.intervalMs > 0 && !this.closed) {
        this.timers.set(key, setTimeout(fire, request.intervalMs))
      }
    }
    this.timers.set(key, setTimeout(fire, request.delayMs))
  }
}

function timerKey(handle: ProcessHandle): string {
  return `${handle.slot}:${handle.generation}`
}
