import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Worker } from 'node:worker_threads'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serialize } from '@electric-sql/pg-protocol'
import { PGlite } from '../dist/index.js'
import { PGliteWorker } from '../dist/worker/index.js'

// These tests count the calls that reach the filesystem layer of the leader
// worker, as transaction-sync.test.ts does for a direct instance. A real leader
// worker is started in a Node.js worker thread, so the options and the RPC
// between `PGliteWorker` and the worker are exercised as in a browser. The
// filesystem of the worker (fixtures/sync-worker-thread.js) counts the calls and
// keeps a snapshot of PGDATA as of the last sync, as IDBFS persists it.

/** Adapts a `worker_threads` Worker to the Web Worker interface. */
class ThreadWorker {
  #worker: Worker
  #listeners = new Map<unknown, (data: unknown) => void>()

  constructor(workerData: unknown) {
    this.#worker = new Worker(
      new URL('./fixtures/sync-worker-thread.js', import.meta.url),
      { workerData },
    )
  }

  addEventListener(
    _type: 'message',
    callback: (event: { data: any }) => void,
    options?: { once?: boolean },
  ) {
    const listener = (data: unknown) => {
      if (options?.once) this.removeEventListener('message', callback)
      callback({ data })
    }
    this.#listeners.set(callback, listener)
    this.#worker.on('message', listener)
  }

  removeEventListener(_type: 'message', callback: unknown) {
    const listener = this.#listeners.get(callback)
    if (listener) this.#worker.off('message', listener)
    this.#listeners.delete(callback)
  }

  postMessage(message: unknown) {
    this.#worker.postMessage(message)
  }

  terminate() {
    return this.#worker.terminate()
  }
}

/** A leader worker thread and the `PGliteWorker` connected to it. */
async function startWorker(dir: string, name: string) {
  const counters = new SharedArrayBuffer(8)
  const syncCalls = new Int32Array(counters)
  const snapshotFile = join(dir, `${name}.tar`)
  const thread = new ThreadWorker({ counters, snapshotFile })
  const db = await PGliteWorker.create(thread as unknown as Worker, {
    // The id keeps the leader election of one test apart from the others
    id: `worker-sync-test:${name}`,
  })
  return {
    db,
    /** `syncToFs()` calls that reached the filesystem of the worker */
    syncs: () => Atomics.load(syncCalls, 0),
    /** The PGDATA snapshot taken by the last completed sync */
    snapshot: () => new Blob([readFileSync(snapshotFile)]),
  }
}

const concat = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const NOTICE_SQL = `DO $$ BEGIN RAISE NOTICE 'hello from the notice'; END $$`

describe('syncToFs through PGliteWorker', () => {
  let dir: string
  let w: Awaited<ReturnType<typeof startWorker>>

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pglite-worker-sync-'))
    w = await startWorker(dir, 'counts')
    await w.db.exec('CREATE TABLE t (v int)')
  })

  afterAll(async () => {
    await w.db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('syncs once after a parameterised query', async () => {
    const before = w.syncs()
    await w.db.query('INSERT INTO t VALUES ($1)', [1])
    expect(w.syncs() - before).toBe(1)
  })

  it('syncs once after an exec of several statements', async () => {
    const before = w.syncs()
    await w.db.exec('INSERT INTO t VALUES (2); INSERT INTO t VALUES (3)')
    expect(w.syncs() - before).toBe(1)
  })

  it('does not sync inside a transaction, and once after the COMMIT', async () => {
    let atFirstQuery = -1
    let atLastQuery = -1
    await w.db.transaction(async (tx) => {
      atFirstQuery = w.syncs()
      for (let i = 0; i < 7; i++) {
        await tx.query('SELECT $1::int AS v', [i])
      }
      atLastQuery = w.syncs()
    })
    expect(atLastQuery).toBe(atFirstQuery)
    expect(w.syncs() - atLastQuery).toBe(1)
  })

  it('forwards the syncToFs option of execProtocol, execProtocolStream and execProtocolRaw', async () => {
    const message = serialize.query('SELECT 1')

    let before = w.syncs()
    await w.db.execProtocol(message, { syncToFs: false })
    await w.db.execProtocolStream(message, { syncToFs: false })
    await w.db.execProtocolRaw(message, { syncToFs: false })
    expect(w.syncs() - before).toBe(0)

    // Without the option a sync is the default, as on a direct instance
    before = w.syncs()
    await w.db.execProtocol(message)
    await w.db.execProtocolStream(message)
    await w.db.execProtocolRaw(message)
    expect(w.syncs() - before).toBe(3)

    before = w.syncs()
    await w.db.execProtocol(message, { syncToFs: true })
    expect(w.syncs() - before).toBe(1)
  })

  it('forwards the throwOnError option', async () => {
    const message = serialize.query('SELECT * FROM does_not_exist')
    await expect(w.db.execProtocolStream(message)).rejects.toThrow(
      /does_not_exist/,
    )
    const messages = await w.db.execProtocolStream(message, {
      throwOnError: false,
    })
    // The error is a message of the result, not a rejection. The worker
    // sends it with the structured clone algorithm, which keeps its text only.
    expect(
      messages.some((m) => /does_not_exist/.test((m as any).message ?? '')),
    ).toBe(true)
  })

  it('calls onNotice on this side for the notices of a query', async () => {
    const message = serialize.query(NOTICE_SQL)

    const fromProtocol: string[] = []
    await w.db.execProtocol(message, {
      onNotice: (notice) => fromProtocol.push(notice.message!),
    })
    expect(fromProtocol).toEqual(['hello from the notice'])

    const fromStream: string[] = []
    await w.db.execProtocolStream(message, {
      onNotice: (notice) => fromStream.push(notice.message!),
    })
    expect(fromStream).toEqual(['hello from the notice'])

    const fromQuery: string[] = []
    await w.db.exec(NOTICE_SQL, {
      onNotice: (notice) => fromQuery.push(notice.message!),
    })
    expect(fromQuery).toEqual(['hello from the notice'])
  })

  it('streams the raw data of execProtocolRawStream to onRawData', async () => {
    const chunks: Uint8Array[] = []
    const before = w.syncs()
    await w.db.execProtocolRawStream(serialize.query('SELECT 1 AS one'), {
      onRawData: (data) => chunks.push(data),
      syncToFs: false,
    })
    expect(w.syncs() - before).toBe(0)
    const raw = concat(chunks)
    expect(raw.length).toBeGreaterThan(0)
    // The reply of a simple query ends with ReadyForQuery, 'Z'
    expect(String.fromCharCode(raw[raw.length - 6])).toBe('Z')
    expect(new TextDecoder().decode(raw)).toContain('one')
  })
})

describe('durability through PGliteWorker', () => {
  it('has persisted a transaction when it resolves, and the worker is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pglite-worker-durable-'))
    try {
      const w = await startWorker(dir, 'durable')
      await w.db.exec('CREATE TABLE durable (v int)')
      await w.db.transaction(async (tx) => {
        await tx.query('INSERT INTO durable VALUES ($1)', [42])
      })
      // The worker or tab goes away right after the transaction resolved
      await w.db.close()

      const reopened = await PGlite.create({ loadDataDir: w.snapshot() })
      const { rows } = await reopened.query('SELECT v FROM durable')
      expect(rows).toEqual([{ v: 42 }])
      await reopened.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
