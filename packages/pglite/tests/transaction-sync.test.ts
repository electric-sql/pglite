import { describe, expect, it } from 'vitest'
import { MemoryFS, PGlite } from '../dist/index.js'

class CountingFS extends MemoryFS {
  syncCalls = 0
  failSyncs = false

  override async syncToFs(relaxedDurability?: boolean): Promise<void> {
    this.syncCalls += 1
    if (this.failSyncs) {
      throw new Error('sync failed')
    }
    await super.syncToFs(relaxedDurability)
  }
}

describe('transaction end synchronization', () => {
  it('syncs to the filesystem after COMMIT before transaction() resolves', async () => {
    const fs = new CountingFS()
    const pg = await PGlite.create({ fs })
    await pg.exec('CREATE TABLE t (v int)')

    let syncsAtCallbackEnd = -1
    await pg.transaction(async (tx) => {
      await tx.exec('INSERT INTO t VALUES (1)')
      syncsAtCallbackEnd = fs.syncCalls
    })
    // The terminal COMMIT must end with the same awaited sync as a top-level
    // exec; without it a committed transaction is not persisted until some
    // later unrelated query runs.
    expect(fs.syncCalls).toBeGreaterThan(syncsAtCallbackEnd)
    await pg.close()
  })

  it('syncs after an explicit tx.rollback()', async () => {
    const fs = new CountingFS()
    const pg = await PGlite.create({ fs })
    await pg.exec('CREATE TABLE t (v int)')

    let syncsAtCallbackEnd = -1
    await pg.transaction(async (tx) => {
      await tx.exec('INSERT INTO t VALUES (1)')
      await tx.rollback()
      syncsAtCallbackEnd = fs.syncCalls
    })
    expect(fs.syncCalls).toBeGreaterThan(syncsAtCallbackEnd)
    await pg.close()
  })

  it('syncs after the ROLLBACK issued for a throwing callback', async () => {
    const fs = new CountingFS()
    const pg = await PGlite.create({ fs })
    await pg.exec('CREATE TABLE t (v int)')

    let syncsAtCallbackEnd = -1
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec('INSERT INTO t VALUES (1)')
        syncsAtCallbackEnd = fs.syncCalls
        throw new Error('force rollback')
      }),
    ).rejects.toThrow('force rollback')
    expect(fs.syncCalls).toBeGreaterThan(syncsAtCallbackEnd)
    await pg.close()
  })

  it('syncs after an explicit tx.rollback() followed by a throwing callback', async () => {
    const fs = new CountingFS()
    const pg = await PGlite.create({ fs })
    await pg.exec('CREATE TABLE t (v int)')

    let syncsAtCallbackEnd = -1
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec('INSERT INTO t VALUES (1)')
        await tx.rollback()
        syncsAtCallbackEnd = fs.syncCalls
        throw new Error('after explicit rollback')
      }),
    ).rejects.toThrow('after explicit rollback')
    expect(fs.syncCalls).toBeGreaterThan(syncsAtCallbackEnd)
    await pg.close()
  })

  it('syncs when the terminal COMMIT itself fails', async () => {
    const fs = new CountingFS()
    const pg = await PGlite.create({ fs })
    await pg.exec(`
      CREATE TABLE parent (id int PRIMARY KEY);
      CREATE TABLE child (
        pid int REFERENCES parent (id) DEFERRABLE INITIALLY DEFERRED
      );
    `)

    let syncsAtCallbackEnd = -1
    await expect(
      pg.transaction(async (tx) => {
        // Violates the deferred constraint only at COMMIT, so the terminal
        // COMMIT throws and Postgres rolls the transaction back implicitly.
        await tx.exec('INSERT INTO child VALUES (42)')
        syncsAtCallbackEnd = fs.syncCalls
      }),
    ).rejects.toThrow(/violates foreign key constraint/)
    expect(fs.syncCalls).toBeGreaterThan(syncsAtCallbackEnd)
    await pg.close()
  })

  it('does not mask the callback error when the terminal sync fails', async () => {
    const fs = new CountingFS()
    const pg = await PGlite.create({ fs })
    await pg.exec('CREATE TABLE t (v int)')

    await expect(
      pg.transaction(async (tx) => {
        await tx.rollback()
        fs.failSyncs = true
        throw new Error('callback cause')
      }),
    ).rejects.toThrow('callback cause')

    // The sync failure surfaces on the next operation rather than masking
    // the callback error above.
    await expect(pg.query('SELECT 1')).rejects.toThrow('sync failed')
    fs.failSyncs = false
    await pg.close().catch(() => {})
  })
})
