import { describe, expect, it } from 'vitest'
import { MemoryFS, PGlite } from '../dist/index.js'

class RejectingFS extends MemoryFS {
  readonly failure = new Error('forced detached sync failure')
  readonly failureObserved: Promise<void>
  #failNextRelaxedSync = false
  #resolveFailureObserved: () => void = () => {}

  constructor() {
    super()
    this.failureObserved = new Promise((resolve) => {
      this.#resolveFailureObserved = resolve
    })
  }

  failNextRelaxedSync(): void {
    this.#failNextRelaxedSync = true
  }

  override async syncToFs(relaxedDurability?: boolean): Promise<void> {
    if (relaxedDurability && this.#failNextRelaxedSync) {
      this.#failNextRelaxedSync = false
      this.#resolveFailureObserved()
      throw this.failure
    }
    await super.syncToFs(relaxedDurability)
  }
}

class AwaitedFailureFS extends MemoryFS {
  readonly failure = new Error('forced awaited sync failure')
  syncCalls = 0
  #failNextSync = false

  failNextSync(): void {
    this.#failNextSync = true
  }

  override async syncToFs(relaxedDurability?: boolean): Promise<void> {
    this.syncCalls += 1
    if (this.#failNextSync) {
      this.#failNextSync = false
      throw this.failure
    }
    await super.syncToFs(relaxedDurability)
  }
}

describe('relaxed-durability filesystem sync failure', () => {
  it('latches a detached relaxed rejection for the next public query and sync', async () => {
    const fs = new RejectingFS()
    const pg = await PGlite.create({ fs, relaxedDurability: true })
    fs.failNextRelaxedSync()

    await pg.exec('SELECT 1')
    await fs.failureObserved

    await expect(pg.exec('SELECT 2')).rejects.toBe(fs.failure)
    await expect(pg.syncToFs()).rejects.toBe(fs.failure)

    // close() calls the filesystem directly rather than going through the
    // latched public syncToFs(), so a store whose syncs recovered can still
    // persist its final state.
    await pg.close()
  })

  it('does NOT latch an awaited failure — the caller gets it once and the filesystem stays reachable', async () => {
    // With relaxedDurability: false the rejection already reaches the caller,
    // so latching would only REPLAY it at the next syncToFs() and shadow a
    // stateful filesystem's own failure policy (a custom fs may poison itself
    // and must be the one deciding what later calls throw).
    const fs = new AwaitedFailureFS()
    const pg = await PGlite.create({ fs, relaxedDurability: false })
    await pg.exec('CREATE TABLE t (v int)')

    fs.failNextSync()
    await expect(pg.exec('INSERT INTO t VALUES (1)')).rejects.toBe(fs.failure)

    const callsAfterFailure = fs.syncCalls
    // The next query must reach the filesystem again — not a replayed latch.
    await pg.exec('SELECT 1')
    expect(fs.syncCalls).toBeGreaterThan(callsAfterFailure)
    await pg.close()
  })
})
