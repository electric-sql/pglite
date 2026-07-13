export const SHARED_SEMAPHORE_WORDS = 2

const enum SemaphoreField {
  Count,
  WakeSequence,
}

export class SharedWordSemaphore {
  constructor(
    private readonly words: Int32Array,
    private readonly base: number,
  ) {
    if (base < 0 || base + SHARED_SEMAPHORE_WORDS > words.length) {
      throw new RangeError('shared semaphore is outside its memory')
    }
    if (!(words.buffer instanceof SharedArrayBuffer)) {
      throw new TypeError('shared semaphore requires SharedArrayBuffer memory')
    }
  }

  initialize(count = 1): void {
    validateCount(count)
    Atomics.store(this.words, this.field(SemaphoreField.Count), count)
    Atomics.store(this.words, this.field(SemaphoreField.WakeSequence), 0)
  }

  tryLock(): boolean {
    const countIndex = this.field(SemaphoreField.Count)
    while (true) {
      const count = Atomics.load(this.words, countIndex)
      if (count <= 0) return false
      if (
        Atomics.compareExchange(this.words, countIndex, count, count - 1) ===
        count
      ) {
        return true
      }
    }
  }

  lock(timeout?: number): boolean {
    const started = performance.now()
    while (true) {
      if (this.tryLock()) return true
      const elapsed = performance.now() - started
      if (timeout !== undefined && elapsed >= timeout) return false
      const sequenceIndex = this.field(SemaphoreField.WakeSequence)
      const sequence = Atomics.load(this.words, sequenceIndex)
      if (Atomics.load(this.words, this.field(SemaphoreField.Count)) > 0) {
        continue
      }
      Atomics.wait(
        this.words,
        sequenceIndex,
        sequence,
        timeout === undefined ? undefined : Math.max(0, timeout - elapsed),
      )
    }
  }

  unlock(): void {
    Atomics.add(this.words, this.field(SemaphoreField.Count), 1)
    this.wake()
  }

  reset(): void {
    Atomics.store(this.words, this.field(SemaphoreField.Count), 0)
    this.wake()
  }

  get count(): number {
    return Atomics.load(this.words, this.field(SemaphoreField.Count))
  }

  private wake(): void {
    const index = this.field(SemaphoreField.WakeSequence)
    Atomics.add(this.words, index, 1)
    Atomics.notify(this.words, index, 1)
  }

  private field(field: SemaphoreField): number {
    return this.base + field
  }
}

function validateCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('semaphore count must be a non-negative integer')
  }
}
