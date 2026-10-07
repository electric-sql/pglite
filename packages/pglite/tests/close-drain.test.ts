import { describe, expect, it } from 'vitest'
import { MemoryFS, PGlite } from '../dist/index.js'

class GatedFS extends MemoryFS {
  events: string[] = []
  #gate?: Promise<void>
  #releaseGate: () => void = () => {}

  gateNextRelaxedSync(): () => void {
    this.#gate = new Promise((resolve) => {
      this.#releaseGate = resolve
    })
    return () => this.#releaseGate()
  }

  override async syncToFs(relaxedDurability?: boolean): Promise<void> {
    const kind = relaxedDurability ? 'relaxed' : 'strict'
    this.events.push(`sync:${kind}:start`)
    if (relaxedDurability && this.#gate) {
      const gate = this.#gate
      this.#gate = undefined
      await gate
    }
    await super.syncToFs(relaxedDurability)
    this.events.push(`sync:${kind}:end`)
  }

  override async closeFs(): Promise<void> {
    this.events.push('closeFs')
    await super.closeFs()
  }
}

describe('close with an in-flight relaxed sync', () => {
  it('drains the sync and performs a final strict sync before closing the filesystem', async () => {
    const fs = new GatedFS()
    const pg = await PGlite.create({ fs, relaxedDurability: true })

    // Let any detached sync scheduled during initialization settle before
    // instrumenting the run we assert on.
    await new Promise((resolve) => setTimeout(resolve, 20))
    fs.events.length = 0

    const release = fs.gateNextRelaxedSync()
    await pg.exec('SELECT 1')

    const closePromise = pg.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    // The gated relaxed sync is still in flight; close() must not have
    // reached the filesystem close yet.
    expect(fs.events).not.toContain('closeFs')

    release()
    await closePromise

    const closeFsAt = fs.events.indexOf('closeFs')
    const relaxedEndAt = fs.events.indexOf('sync:relaxed:end')
    const strictEndAt = fs.events.lastIndexOf('sync:strict:end')
    // The in-flight relaxed sync completed, a final strict sync followed it,
    // and only then was the filesystem closed.
    expect(relaxedEndAt).toBeGreaterThanOrEqual(0)
    expect(strictEndAt).toBeGreaterThan(relaxedEndAt)
    expect(closeFsAt).toBeGreaterThan(strictEndAt)
  })
})
