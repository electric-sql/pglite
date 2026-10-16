import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { Client } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { serialize } from '@electric-sql/pg-protocol'
import { PGLiteSocketServer } from '../src'

describe('extended-query error recovery', () => {
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
    await client.connect()
    await client.query(
      'CREATE TEMP TABLE repro (id int PRIMARY KEY); INSERT INTO repro VALUES (1)',
    )
  })

  afterEach(async () => {
    // Stop delivery of stray responses after a failed protocol assertion.
    const { connection } = client as Client & {
      connection: { stream: { destroy(): void } }
    }
    connection.stream.destroy()
    await client.end()
    await server.stop()
    await db.close()
  })

  it('sends one ReadyForQuery per error cycle and preserves bound SELECT results', async () => {
    const messages: string[] = []
    const { connection } = client as Client & { connection: EventEmitter }
    connection.on('message', (message: { name: string }) => {
      messages.push(message.name)
    })

    for (let cycle = 1; cycle <= 100; cycle++) {
      messages.length = 0
      await expect(
        client.query('INSERT INTO repro VALUES ($1)', [1]),
      ).rejects.toMatchObject({ code: '23505' })
      const result = await client.query(
        'SELECT $1::int AS cycle, $2::text AS marker',
        [cycle, `row-${cycle}`],
      )
      expect(result.rows, `rows at cycle ${cycle}`).toEqual([
        { cycle, marker: `row-${cycle}` },
      ])
      expect(messages, `backend messages at cycle ${cycle}`).toEqual([
        'parseComplete',
        'bindComplete',
        'noData',
        'error',
        'readyForQuery',
        'parseComplete',
        'bindComplete',
        'rowDescription',
        'dataRow',
        'commandComplete',
        'readyForQuery',
      ])
    }
  })

  it('does not emit duplicate ReadyForQuery with a complete raw protocol batch', async () => {
    // Bypass the socket and node-postgres entirely to locate the defect.
    await db.exec(
      'CREATE TABLE raw_repro (id int PRIMARY KEY); INSERT INTO raw_repro VALUES (1)',
    )
    const batch = Buffer.concat(
      [
        serialize.parse({ text: 'INSERT INTO raw_repro VALUES ($1)' }),
        serialize.bind({ values: ['1'] }),
        serialize.describe({ type: 'P' }),
        serialize.execute({}),
        serialize.sync(),
      ].map((message) => Buffer.from(message)),
    )
    const response = Buffer.from(await db.execProtocolRaw(batch))
    const types: string[] = []
    for (let offset = 0; offset < response.length; ) {
      types.push(String.fromCharCode(response[offset]))
      offset += 1 + response.readInt32BE(offset + 1)
    }
    expect(types).toEqual(['1', '2', 'n', 'E', 'Z'])
  })
})
