import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'
import { Socket, createConnection } from 'net'

const TEST_PORT = 5436

function startupMessage(): Buffer {
  const params = Buffer.from('user\0postgres\0database\0postgres\0\0', 'utf8')
  const buf = Buffer.alloc(8 + params.length)
  buf.writeInt32BE(8 + params.length, 0)
  buf.writeInt32BE(196608, 4)
  params.copy(buf, 8)
  return buf
}

function message(tag: string, payload: Buffer): Buffer {
  const buf = Buffer.alloc(5 + payload.length)
  buf.write(tag, 0, 'ascii')
  buf.writeInt32BE(4 + payload.length, 1)
  payload.copy(buf, 5)
  return buf
}

const query = (sql: string) => message('Q', Buffer.from(sql + '\0', 'utf8'))
const copyData = (data: string) => message('d', Buffer.from(data, 'utf8'))
const copyDone = () => message('c', Buffer.alloc(0))
const copyFail = (reason: string) =>
  message('f', Buffer.from(reason + '\0', 'utf8'))

/**
 * Minimal wire-protocol client: writes raw messages and waits for a
 * response message with a given tag, discarding everything before it.
 */
class WireClient {
  socket: Socket
  private buffer = Buffer.alloc(0)
  private waiters = new Set<() => void>()

  constructor(port: number) {
    this.socket = createConnection({ host: '127.0.0.1', port })
    this.socket.on('data', (data) => {
      this.buffer = Buffer.concat([this.buffer, data])
      for (const waiter of this.waiters) waiter()
    })
  }

  connected(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.on('connect', () => resolve())
      this.socket.on('error', reject)
    })
  }

  async waitFor(tag: string, timeout = 15000): Promise<Buffer> {
    const want = tag.charCodeAt(0)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(scan)
        reject(new Error(`timeout waiting for '${tag}'`))
      }, timeout)
      const scan = () => {
        let offset = 0
        while (this.buffer.length - offset >= 5) {
          const msgTag = this.buffer[offset]
          const length = 1 + this.buffer.readInt32BE(offset + 1)
          if (this.buffer.length - offset < length) break
          if (msgTag === want) {
            const payload = Buffer.from(
              this.buffer.subarray(offset + 5, offset + length),
            )
            this.buffer = this.buffer.subarray(offset + length)
            this.waiters.delete(scan)
            clearTimeout(timer)
            resolve(payload)
            return
          }
          offset += length
        }
        this.buffer = this.buffer.subarray(offset)
      }
      this.waiters.add(scan)
      scan()
    })
  }

  end() {
    this.socket.end()
  }
}

async function connect(port: number): Promise<WireClient> {
  const client = new WireClient(port)
  await client.connected()
  client.socket.write(startupMessage())
  await client.waitFor('Z')
  return client
}

describe('COPY FROM STDIN over pglite-socket', () => {
  let db: PGlite
  let server: PGLiteSocketServer

  beforeAll(async () => {
    db = await PGlite.create()
    server = new PGLiteSocketServer({
      db,
      port: TEST_PORT,
      host: '127.0.0.1',
    })
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
    await db.close()
  })

  async function waitForDisconnect() {
    while (server.getStats().activeConnections > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it('copies rows and leaves the connection and server healthy', async () => {
    const client = await connect(TEST_PORT)

    client.socket.write(query('CREATE TABLE copy_test (id int, name text)'))
    await client.waitFor('Z')

    client.socket.write(query('COPY copy_test FROM STDIN'))
    const copyIn = await client.waitFor('G')
    expect(copyIn.readUInt8(0)).toBe(0) // text format

    client.socket.write(copyData('1\talice\n'))
    client.socket.write(copyData('2\tbob\n'))
    client.socket.write(copyDone())
    const complete = await client.waitFor('C')
    expect(complete.toString('utf8')).toContain('COPY 2')
    await client.waitFor('Z')

    // Same connection still works after the COPY
    client.socket.write(query('SELECT count(*) FROM copy_test'))
    const row = await client.waitFor('D')
    expect(row.toString('utf8')).toContain('2')
    await client.waitFor('Z')
    client.end()
    await waitForDisconnect()

    // A fresh connection must not be poisoned by the earlier COPY
    const client2 = new WireClient(TEST_PORT)
    await client2.connected()
    client2.socket.write(startupMessage())
    const auth = await client2.waitFor('R')
    expect(auth.readInt32BE(0)).toBe(0) // AuthenticationOk
    await client2.waitFor('Z')
    client2.end()
    await waitForDisconnect()
  })

  it('reports errors for a failing COPY without desyncing', async () => {
    const client = await connect(TEST_PORT)

    client.socket.write(query('COPY missing_table FROM STDIN'))
    await client.waitFor('G')
    client.socket.write(copyData('1\n'))
    client.socket.write(copyDone())
    const err = await client.waitFor('E')
    expect(err.toString('utf8')).toContain('missing_table')
    await client.waitFor('Z')

    // Same connection still works after the failed COPY
    client.socket.write(query('SELECT 1'))
    await client.waitFor('D')
    await client.waitFor('Z')
    client.end()
    await waitForDisconnect()
  })

  it('aborts cleanly on CopyFail', async () => {
    const client = await connect(TEST_PORT)

    client.socket.write(query('CREATE TABLE copy_fail_test (id int)'))
    await client.waitFor('Z')

    client.socket.write(query('COPY copy_fail_test FROM STDIN'))
    await client.waitFor('G')
    client.socket.write(copyData('1\n'))
    client.socket.write(copyFail('client changed its mind'))
    const err = await client.waitFor('E')
    expect(err.toString('utf8')).toContain('COPY from stdin failed')
    await client.waitFor('Z')

    // Same connection still works after the aborted COPY
    client.socket.write(query('SELECT count(*) FROM copy_fail_test'))
    const row = await client.waitFor('D')
    expect(row.toString('utf8')).toContain('0')
    await client.waitFor('Z')
    client.end()
    await waitForDisconnect()
  })

  it('does not treat COPY FROM STDIN inside a string literal as a copy', async () => {
    const client = await connect(TEST_PORT)

    // If the sniffer false-positived here, the handler would buffer waiting
    // for CopyData and this query would never produce a DataRow.
    client.socket.write(query(`SELECT 'COPY t FROM STDIN' AS s`))
    const row = await client.waitFor('D')
    expect(row.toString('utf8')).toContain('COPY t FROM STDIN')
    await client.waitFor('Z')
    client.end()
    await waitForDisconnect()
  })

  it('detects COPY FROM STDIN behind leading comments', async () => {
    const client = await connect(TEST_PORT)

    client.socket.write(query('CREATE TABLE copy_comment_test (id int)'))
    await client.waitFor('Z')

    client.socket.write(
      query('-- bulk load\n/* fixture */ COPY copy_comment_test FROM STDIN'),
    )
    await client.waitFor('G')
    client.socket.write(copyData('7\n'))
    client.socket.write(copyDone())
    const complete = await client.waitFor('C')
    expect(complete.toString('utf8')).toContain('COPY 1')
    await client.waitFor('Z')
    client.end()
    await waitForDisconnect()
  })

  it('does not buffer COPY TO STDOUT', async () => {
    const client = await connect(TEST_PORT)

    client.socket.write(query('CREATE TABLE copy_out_test (id int)'))
    await client.waitFor('Z')
    client.socket.write(query('INSERT INTO copy_out_test VALUES (42)'))
    await client.waitFor('Z')

    client.socket.write(query('COPY copy_out_test TO STDOUT'))
    await client.waitFor('H') // CopyOutResponse
    const data = await client.waitFor('d')
    expect(data.toString('utf8')).toContain('42')
    await client.waitFor('Z')
    client.end()
    await waitForDisconnect()
  })
})
