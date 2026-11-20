import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite, MemoryFS } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  // A MemoryFS whose sync takes a while, like a persistent store (idb://).
  class SlowFS extends MemoryFS {
    started = 0
    finished = 0
    async syncToFs(relaxedDurability?: boolean) {
      this.started++
      await new Promise((resolve) => setTimeout(resolve, 50))
      await super.syncToFs(relaxedDurability)
      this.finished++
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  describe('syncToFs', () => {
    it('waits for a queued sync instead of resolving before it runs', async () => {
      const fs = new SlowFS()
      const pg = await PGlite.create({ fs })
      await pg.exec('CREATE TABLE t (v int)')
      fs.started = 0
      fs.finished = 0

      // Resolves with how many syncs had finished when the promise settled.
      const track = (p: Promise<unknown>) => p.then(() => fs.finished)

      const a = track(pg.syncToFs())
      await sleep(10) // sync 1 is now running
      const b = track(pg.syncToFs()) // queued behind sync 1 (sync 2)
      const c = track(pg.syncToFs()) // requested while sync 2 is still queued

      // Only sync 2 started after B and C were called, so both must wait for it.
      expect(await Promise.all([a, b, c])).toEqual([1, 2, 2])
      expect(fs.started).toBe(2)

      await pg.close()
    })

    it('does not resolve a query before the queued sync persists it', async () => {
      const fs = new SlowFS()
      const pg = await PGlite.create({ fs })
      await pg.exec('CREATE TABLE t (v int)')
      fs.finished = 0

      const first = pg.syncToFs()
      await sleep(10) // sync 1 is now running
      const queued = pg.syncToFs() // sync 2 is queued
      const finishedWhenInsertResolved = await pg
        .query('INSERT INTO t VALUES (1)')
        .then(() => fs.finished)

      // The insert ran after sync 1 started, so only sync 2 can carry it.
      expect(finishedWhenInsertResolved).toBe(2)

      await Promise.all([first, queued])
      await pg.close()
    })

    it('still returns at once with relaxedDurability', async () => {
      const fs = new SlowFS()
      const pg = await PGlite.create({ fs, relaxedDurability: true })
      await pg.exec('CREATE TABLE t (v int)')
      await sleep(100) // let background syncs from setup finish
      fs.finished = 0

      await pg.syncToFs()
      await pg.syncToFs()
      expect(fs.finished).toBe(0)

      await sleep(150)
      await pg.close()
    })
  })
})
