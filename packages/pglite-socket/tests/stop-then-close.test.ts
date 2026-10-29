import { afterEach, describe, expect, it } from 'vitest'
import type { Socket } from 'node:net'
import { Client } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'

describe('stop() followed by db.close()', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    unhandled.length = 0
  })

  it('does not touch the closed database when a client disconnected in the same turn', async () => {
    process.on('unhandledRejection', onUnhandled)
    const db = await PGlite.create()
    const server = new PGLiteSocketServer({
      db,
      host: '127.0.0.1',
      port: 0,
    })
    await server.start()

    // Shut down from the event-loop turn in which the server sees a client's
    // socket close. The handler's close listener has then queued its
    // cleanup with setImmediate, and stop() and db.close() both finish
    // before that cleanup runs.
    const shutdown = new Promise<void>((resolve, reject) => {
      server['server']!.on('connection', (socket: Socket) => {
        socket.on('close', () => {
          server
            .stop()
            .then(() => db.close())
            .then(resolve, reject)
        })
      })
    })

    const client = new Client({
      host: '127.0.0.1',
      port: Number(server.getServerConn().split(':').at(-1)),
      user: 'postgres',
      database: 'postgres',
    })
    await client.connect()
    await client.query('SELECT 1')
    await client.end()
    await shutdown

    // Let the queued close cleanup run
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(unhandled).toEqual([])
  })
})
