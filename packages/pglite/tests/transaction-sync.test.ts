import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite, MemoryFS } from '../dist/index.js'

// These tests count the calls that reach the filesystem layer. An `idb://`
// database runs a full IDBFS `syncfs()` for each of them, so a statement that
// syncs needlessly is slow, and a transaction that never syncs is lost on a
// reload. See worker-sync.test.ts for the same through `PGliteWorker`.

/**
 * A filesystem that counts `syncToFs()` calls and keeps a snapshot of PGDATA as
 * of the last sync, as a persistent filesystem like IDBFS would.
 */
class SnapshotFS extends MemoryFS {
  syncCalls = 0
  snapshot?: Blob | File

  override async syncToFs() {
    this.syncCalls += 1
    this.snapshot = await this.dumpTar('snapshot', 'none')
  }
}

describe('syncToFs and transactions', () => {
  let fs: SnapshotFS
  let db: PGlite

  beforeAll(async () => {
    fs = new SnapshotFS()
    db = await PGlite.create({ fs })
    await db.exec('CREATE TABLE t (v int)')
  })

  afterAll(async () => {
    await db.close()
  })

  it('syncs once after a parameterised query', async () => {
    const before = fs.syncCalls
    await db.query('INSERT INTO t VALUES ($1)', [1])
    expect(fs.syncCalls - before).toBe(1)
  })

  it('syncs once after an exec of several statements', async () => {
    const before = fs.syncCalls
    await db.exec('INSERT INTO t VALUES (2); INSERT INTO t VALUES (3)')
    expect(fs.syncCalls - before).toBe(1)
  })

  it('does not sync inside a transaction, and once after the COMMIT', async () => {
    let atFirstQuery = -1
    let atLastQuery = -1
    await db.transaction(async (tx) => {
      atFirstQuery = fs.syncCalls
      for (let i = 0; i < 7; i++) {
        await tx.query('INSERT INTO t VALUES ($1)', [i])
      }
      atLastQuery = fs.syncCalls
    })
    expect(atLastQuery).toBe(atFirstQuery)
    expect(fs.syncCalls - atLastQuery).toBe(1)
  })

  it('syncs once after a ROLLBACK, however the transaction is rolled back', async () => {
    let before = fs.syncCalls
    await db.transaction(async (tx) => {
      await tx.query('INSERT INTO t VALUES ($1)', [1])
      await tx.rollback()
    })
    expect(fs.syncCalls - before).toBe(2) // BEGIN, then the explicit ROLLBACK

    before = fs.syncCalls
    await expect(
      db.transaction(async (tx) => {
        await tx.query('INSERT INTO t VALUES ($1)', [1])
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(fs.syncCalls - before).toBe(2) // BEGIN, then the ROLLBACK
  })

  it('has persisted a transaction when it resolves', async () => {
    const fs = new SnapshotFS()
    const pg = await PGlite.create({ fs })
    await pg.exec('CREATE TABLE durable (v int)')
    await pg.transaction(async (tx) => {
      await tx.query('INSERT INTO durable VALUES ($1)', [42])
    })
    // Reopen from what the filesystem was last synced to, as after a reload
    const reopened = await PGlite.create({ loadDataDir: fs.snapshot })
    const { rows } = await reopened.query('SELECT v FROM durable')
    expect(rows).toEqual([{ v: 42 }])
    await reopened.close()
    await pg.close()
  })
})
