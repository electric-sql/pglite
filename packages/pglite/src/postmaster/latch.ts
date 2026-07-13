import {
  PGLITE_SIGNALS,
  type ProcessControlRegistry,
  type ProcessHandle,
} from './control.js'

export const SHARED_LATCH_WORDS = 2

const enum LatchField {
  IsSet,
  OwnerPid,
}

export class SharedLatch {
  constructor(
    private readonly words: Int32Array,
    private readonly base: number,
    private readonly registry: ProcessControlRegistry,
  ) {
    if (base < 0 || base + SHARED_LATCH_WORDS > words.length) {
      throw new RangeError('shared latch is outside its memory')
    }
    if (!(words.buffer instanceof SharedArrayBuffer)) {
      throw new TypeError('shared latch requires SharedArrayBuffer memory')
    }
  }

  initialize(owner: ProcessHandle): void {
    if (!this.registry.isCurrent(owner)) {
      throw new Error(`cannot assign latch to stale process ${owner.pid}`)
    }
    Atomics.store(this.words, this.field(LatchField.IsSet), 0)
    Atomics.store(this.words, this.field(LatchField.OwnerPid), owner.pid)
  }

  own(owner: ProcessHandle): void {
    if (!this.registry.isCurrent(owner)) {
      throw new Error(`cannot assign latch to stale process ${owner.pid}`)
    }
    if (
      Atomics.compareExchange(
        this.words,
        this.field(LatchField.OwnerPid),
        0,
        owner.pid,
      ) !== 0
    ) {
      throw new Error('shared latch already has an owner')
    }
  }

  disown(owner: ProcessHandle): void {
    if (
      Atomics.compareExchange(
        this.words,
        this.field(LatchField.OwnerPid),
        owner.pid,
        0,
      ) !== owner.pid
    ) {
      throw new Error(`process ${owner.pid} does not own the shared latch`)
    }
  }

  set(): void {
    Atomics.store(this.words, this.field(LatchField.IsSet), 1)
    const ownerPid = Atomics.load(this.words, this.field(LatchField.OwnerPid))
    if (ownerPid !== 0) {
      this.registry.queueSignal(ownerPid, PGLITE_SIGNALS.SIGURG)
    }
  }

  reset(): void {
    Atomics.store(this.words, this.field(LatchField.IsSet), 0)
  }

  wait(owner: ProcessHandle, timeout?: number): boolean {
    const started = performance.now()
    while (true) {
      if (this.isSet) return true
      const elapsed = performance.now() - started
      if (timeout !== undefined && elapsed >= timeout) return false
      const sequence = this.registry.wakeSequence(owner)
      if (this.isSet) continue
      this.registry.wait(
        owner,
        sequence,
        timeout === undefined ? undefined : Math.max(0, timeout - elapsed),
      )
    }
  }

  get isSet(): boolean {
    return Atomics.load(this.words, this.field(LatchField.IsSet)) !== 0
  }

  private field(field: LatchField): number {
    return this.base + field
  }
}
