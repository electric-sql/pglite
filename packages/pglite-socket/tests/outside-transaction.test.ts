import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'

describe('internal work outside socket transactions', () => {
  let db: PGlite
  let server: PGLiteSocketServer
  let client: Client

  beforeEach(async () => {
    db = await PGlite.create()
    server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 })
    await server.start()
    client = new Client({
      host: '127.0.0.1',
      port: Number(server.getServerConn().split(':').at(-1)),
      user: 'postgres',
      database: 'postgres',
      query_timeout: 5000,
    })
    client.on('error', () => {})
    await client.connect()
    await client.query('CREATE TABLE entries (id integer PRIMARY KEY)')
  })

  afterEach(async () => {
    await client.end()
    await server.stop()
    await db.close()
  })

  it('waits for rollback of an aborted transaction and reads only committed rows', async () => {
    await client.query('INSERT INTO entries VALUES (1)')
    await client.query('BEGIN; INSERT INTO entries VALUES (2)')
    await expect(client.query('SELECT 1 / 0')).rejects.toMatchObject({
      code: '22012',
    })
    let called = false
    const read = server.runOutsideTransaction(async () => {
      called = true
      return db.query<{ id: number }>('SELECT id FROM entries ORDER BY id')
    })
    // Allow queued work a turn without releasing the client's failed transaction.
    await new Promise((resolve) => setImmediate(resolve))
    expect(called).toBe(false)
    await client.query('ROLLBACK')
    expect((await read).rows).toEqual([{ id: 1 }])
  })

  it('rolls back a disconnected client before draining internal work during stop', async () => {
    await client.query('BEGIN; INSERT INTO entries VALUES (2)')
    const read = server.runOutsideTransaction(() =>
      db.query('SELECT id FROM entries'),
    )
    await server.stop()
    expect((await read).rows).toEqual([])
    expect(db.isInTransaction()).toBe(false)
  })

  it('keeps the queue usable after internal work rejects', async () => {
    await expect(
      server.runOutsideTransaction(() => db.query('SELECT 1 / 0')),
    ).rejects.toMatchObject({ code: '22012' })
    expect(
      (await server.runOutsideTransaction(() => db.query('SELECT 42 AS value')))
        .rows,
    ).toEqual([{ value: 42 }])
    expect((await client.query('SELECT 7 AS value')).rows).toEqual([
      { value: 7 },
    ])
  })
})
