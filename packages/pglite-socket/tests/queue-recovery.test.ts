import { describe, it, expect, afterAll } from 'vitest'
import { Client } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'

/**
 * Regression test for https://github.com/electric-sql/pglite/issues/1046 (Defect B)
 *
 * A single internal failure thrown from `execProtocolRawStream` (e.g. a WASM
 * abort or a race with `db.close()`) used to leave the query queue's
 * `processing` flag stuck at `true`, permanently deadlocking the queue for
 * all connections. The queue must recover and keep serving queries.
 */
describe('QueryQueueManager recovers after an internal error', () => {
  let db: PGlite
  let server: PGLiteSocketServer

  const startServer = async () => {
    db = await PGlite.create()
    await db.waitReady

    server = new PGLiteSocketServer({
      db,
      host: '127.0.0.1',
      port: 0, // OS-assigned port
      maxConnections: 100,
    })
    await server.start()

    const port = (server as any).port as number
    return {
      port,
      config: {
        host: '127.0.0.1',
        port,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres',
        connectionTimeoutMillis: 10000,
      },
    }
  }

  afterAll(async () => {
    if (server) {
      await server.stop().catch(() => {})
    }
    if (db) {
      await db.close()
    }
  })

  it('should keep processing queued queries after one query fails internally', async () => {
    const { config } = await startServer()

    // Fault injection: the FIRST Parse message rejects, everything else
    // behaves normally — simulating a single transient internal failure.
    const originalExec = db.execProtocolRawStream.bind(db)
    let injected = false
    db.execProtocolRawStream = async (message: Uint8Array, options: any) => {
      if (!injected && message[0] === 0x50 /* Parse */) {
        injected = true
        throw new Error('injected internal failure')
      }
      return originalExec(message, options)
    }

    // Client 1 trips the injected failure — its query must fail...
    const failingClient = new Client(config)
    // Suppress the expected "Connection terminated unexpectedly" error
    failingClient.on('error', () => {})
    await failingClient.connect()
    await expect(
      failingClient.query({ text: 'SELECT $1::int AS one', values: [1] }),
    ).rejects.toThrow()

    // ...but the queue must not be deadlocked: subsequent queries from a
    // fresh connection must still be processed.
    const healthyClient = new Client(config)
    await healthyClient.connect()
    try {
      const result = await healthyClient.query('SELECT 42 AS answer')
      expect(result.rows[0].answer).toBe(42)
    } finally {
      await healthyClient.end()
      await failingClient.end().catch(() => {})
    }
  }, 30000)

  it('should recover when a queued query is rejected while other queries are pending', async () => {
    const { config } = await startServer()

    const originalExec = db.execProtocolRawStream.bind(db)
    let injected = false
    db.execProtocolRawStream = async (message: Uint8Array, options: any) => {
      if (!injected && message[0] === 0x50 /* Parse */) {
        injected = true
        throw new Error('injected internal failure')
      }
      return originalExec(message, options)
    }

    const clientA = new Client(config)
    // Suppress the expected "Connection terminated unexpectedly" error
    clientA.on('error', () => {})
    await clientA.connect()
    const clientB = new Client(config)
    await clientB.connect()

    try {
      // Fire both concurrently so B is enqueued while/after A fails
      const resultA = clientA.query({
        text: 'SELECT $1::int AS one',
        values: [1],
      })
      const resultB = clientB.query('SELECT 2 AS two')

      // A's connection hits the injected failure — either the query errors
      // or the server closes the socket; both surface as a rejection.
      await expect(resultA).rejects.toThrow()

      // B must complete regardless of what happened to A
      const resB = await resultB
      expect(resB.rows[0].two).toBe(2)
    } finally {
      await clientA.end().catch(() => {})
      await clientB.end().catch(() => {})
    }
  }, 30000)
})
