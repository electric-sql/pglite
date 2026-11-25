import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'

const TEST_PORT = 5435

describe('PGLite Socket Server concurrency regression', () => {
  let db: PGlite
  let server: PGLiteSocketServer
  let sql: ReturnType<typeof postgres>

  beforeAll(async () => {
    db = await PGlite.create()
    await db.waitReady

    server = new PGLiteSocketServer({
      db,
      host: '127.0.0.1',
      port: TEST_PORT,
      maxConnections: 10,
    })

    await server.start()

    sql = postgres({
      host: '127.0.0.1',
      port: TEST_PORT,
      database: 'postgres',
      username: 'postgres',
      password: 'postgres',
      idle_timeout: 5,
      connect_timeout: 10,
      max: 10,
    })
  })

  afterAll(async () => {
    await sql?.end({ timeout: 1 }).catch(() => {})
    await server?.stop().catch(() => {})
    await db?.close().catch(() => {})
  })

  it('keeps extended protocol state isolated across pooled connections', async () => {
    for (let i = 0; i < 20; i++) {
      const [valueResult, timezoneResult] = await Promise.all([
        sql.unsafe('select $1::int as value', [i]),
        sql.unsafe("select current_setting('timezone') as timezone", []),
      ])

      expect(valueResult[0].value).toBe(i)
      expect(typeof timezoneResult[0].timezone).toBe('string')
    }
  })
})
