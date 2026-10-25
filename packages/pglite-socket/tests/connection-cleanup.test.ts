import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnection, Socket } from 'node:net'
import { Client } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'

async function waitFor(
  condition: () => boolean,
  timeout = 5000,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return condition()
}

describe('connection slot cleanup', () => {
  let db: PGlite
  let server: PGLiteSocketServer | undefined

  const portOf = (s: PGLiteSocketServer) =>
    Number(s.getServerConn().split(':').at(-1))

  const newClient = (s: PGLiteSocketServer) => {
    const client = new Client({
      host: '127.0.0.1',
      port: portOf(s),
      user: 'postgres',
      database: 'postgres',
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    })
    // An abrupt disconnect also surfaces as an error on the client side.
    client.on('error', () => {})
    return client
  }

  beforeEach(async () => {
    db = await PGlite.create()
  })

  afterEach(async () => {
    await server?.stop()
    server = undefined
    await db.close()
  })

  it('frees the slot when a client disconnects with ECONNRESET', async () => {
    server = new PGLiteSocketServer({
      db,
      host: '127.0.0.1',
      port: 0,
      maxConnections: 2,
    })
    await server.start()

    // More abrupt disconnects than there are slots
    for (let i = 0; i < 3; i++) {
      const client = newClient(server)
      await client.connect()
      await client.query('SELECT 1')
      // Like a client process exiting with its connection still open:
      // the socket is reset (RST), so the server sees ECONNRESET.
      const { connection } = client as Client & {
        connection: { stream: Socket }
      }
      connection.stream.resetAndDestroy()

      expect(
        await waitFor(() => server!.getStats().activeConnections === 0),
      ).toBe(true)
    }

    const client = newClient(server)
    await client.connect()
    const result = await client.query<{ answer: number }>('SELECT 42 AS answer')
    expect(result.rows[0].answer).toBe(42)
    await client.end()
  })

  it('frees the slot when a connection hits the idle timeout', async () => {
    server = new PGLiteSocketServer({
      db,
      host: '127.0.0.1',
      port: 0,
      maxConnections: 1,
      idleTimeout: 100,
    })
    await server.start()

    // Open a connection that never sends anything
    const idle = createConnection({ host: '127.0.0.1', port: portOf(server) })
    idle.on('error', () => {})
    const idleClosed = new Promise<void>((resolve) => idle.on('close', resolve))
    await new Promise<void>((resolve) => idle.on('connect', resolve))
    expect(
      await waitFor(() => server!.getStats().activeConnections === 1),
    ).toBe(true)

    await idleClosed
    expect(
      await waitFor(() => server!.getStats().activeConnections === 0),
    ).toBe(true)

    const client = newClient(server)
    await client.connect()
    const result = await client.query<{ answer: number }>('SELECT 42 AS answer')
    expect(result.rows[0].answer).toBe(42)
    await client.end()
  })
})
