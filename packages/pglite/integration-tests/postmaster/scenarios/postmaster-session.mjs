#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data] = process.argv.slice(2)
if (!data) {
  throw new Error('usage: postmaster-session.mjs REPO_ROOT WASM GLUE DATA')
}

async function main() {
  const { PGlitePostmaster } = await import(
    pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js'))
      .href
  )
  const dataDirectory = await mkdtemp(
    join(tmpdir(), 'pglite-postmaster-session-'),
  )
  let postmaster

  try {
    postmaster = await withTimeout(
      PGlitePostmaster.create({
        dataDir: `file://${dataDirectory}`,
        maxConnections: 8,
        sharedBuffers: '16MB',
        artifact: { wasm, glue, data },
        debug: process.env.PGLITE_POSTMASTER_TEST_DEBUG === 'true',
      }),
      60_000,
      'postmaster startup',
    )
    console.log('postmaster started')

    const { connection, reader } = await connectWhenReady(postmaster)
    console.log('protocol backend ready')
    const startupFrames = reader.frames
    assert.ok(startupFrames.some((frame) => frame.type === 'R'))
    assert.ok(startupFrames.some((frame) => frame.type === 'K'))
    assert.equal(startupFrames.at(-1)?.type, 'Z')

    const select = await simpleQuery(reader, connection, 'SELECT 1')
    assert.deepEqual(select.rows, [['1']])

    const ddl = await simpleQuery(
      reader,
      connection,
      'CREATE TABLE session_gate(id int primary key, value text);' +
        "INSERT INTO session_gate VALUES (42, 'multi-memory');" +
        'SELECT id, value FROM session_gate;',
    )
    assert.deepEqual(ddl.rows, [['42', 'multi-memory']])
    console.log('protocol DDL/DML passed')

    const releasedBeforeTerminate =
      postmaster.diagnostics().privateMemoriesReleased
    await connection.write(frontendMessage('X', new Uint8Array()))
    await withTimeout(connection.closed, 15_000, 'backend connection close')
    await waitFor(
      () =>
        postmaster.diagnostics().privateMemoriesReleased >
        releasedBeforeTerminate,
      15_000,
      'backend private-memory release',
    )
    const after = postmaster.diagnostics()
    assert.ok(after.privateMemoriesReleased > 0)
    assert.ok(after.globalMemoryBytes >= 16 * 1024 * 1024)
    assert.ok(after.globalMemoryBytes < 64 * 1024 * 1024)

    const sessionA = await withTimeout(
      postmaster.createSession(),
      30_000,
      'normal session A startup',
    )
    const sessionB = await withTimeout(
      postmaster.createSession(),
      30_000,
      'normal session B startup',
    )
    console.log('normal sessions ready')
    const normalQuery = await sessionA.query('SELECT 40 + $1::int AS answer', [
      2,
    ])
    assert.deepEqual(normalQuery.rows, [{ answer: 42 }])

    await sessionA.exec(
      'CREATE TEMP TABLE session_private(value text);' +
        "INSERT INTO session_private VALUES ('session-a');",
    )
    const isolated = await sessionB.query(
      "SELECT to_regclass('pg_temp.session_private') IS NULL AS isolated",
    )
    assert.deepEqual(isolated.rows, [{ isolated: true }])

    const concurrent = await Promise.all([
      sessionA.query('SELECT pg_sleep(0.05), 11 AS value'),
      sessionB.query('SELECT 22 AS value'),
    ])
    assert.equal(concurrent[0].rows[0].value, 11)
    assert.equal(concurrent[1].rows[0].value, 22)

    let resolveNotification
    const notification = new Promise((resolve) => {
      resolveNotification = resolve
    })
    await sessionA.listen('session_notify', (payload) =>
      resolveNotification(payload),
    )
    await sessionB.exec("NOTIFY session_notify, 'multi-memory'")
    assert.equal(
      await withTimeout(notification, 15_000, 'LISTEN/NOTIFY delivery'),
      'multi-memory',
    )
    console.log('concurrent sessions and notifications passed')

    const releasedBeforeSessionClose =
      postmaster.diagnostics().privateMemoriesReleased
    await Promise.all([sessionA.close(), sessionB.close()])
    await waitFor(
      () =>
        postmaster.diagnostics().privateMemoriesReleased >=
        releasedBeforeSessionClose + 2,
      15_000,
      'session private-memory release',
    )
    const releasedAfterSessions =
      postmaster.diagnostics().privateMemoriesReleased
    assert.ok(releasedAfterSessions >= after.privateMemoriesReleased + 2)

    await withTimeout(postmaster.close(), 15_000, 'clean postmaster shutdown')
    const shutdown = postmaster.diagnostics()
    assert.equal(shutdown.liveProcesses, 0)
    assert.equal(shutdown.livePrivateMemories, 0)
    assert.equal(
      shutdown.privateMemoriesStarted,
      shutdown.privateMemoriesReleased,
    )

    console.log('Postmaster/backend protocol test: PASS')
  } finally {
    await postmaster?.close().catch((error) => console.error(error))
    await rm(dataDirectory, { recursive: true, force: true })
  }
}

async function connectWhenReady(postmaster) {
  let lastError = 'server did not respond'
  const deadline = Date.now() + 60_000
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const connection = await postmaster.openProtocolConnection({
      transport: 'tcp',
      remoteAddress: '127.0.0.1',
    })
    const reader = new ProtocolReader(connection.readable)
    await connection.write(
      startupMessage({ user: 'postgres', database: 'postgres' }),
    )
    try {
      for (;;) {
        const frame = await withTimeout(
          reader.readFrame(),
          Math.min(2_000, Math.max(1, deadline - Date.now())),
          'startup response',
        )
        if (!frame) break
        reader.frames.push(frame)
        if (frame.type === 'E') lastError = decodeError(frame.payload)
        if (frame.type === 'Z') return { connection, reader }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    connection.abort()
    if (attempt % 5 === 4)
      console.log(
        `backend not ready after ${attempt + 1} attempts: ${lastError}`,
      )
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`postmaster never reached ReadyForQuery: ${lastError}`)
}

async function simpleQuery(reader, connection, sql) {
  await connection.write(
    frontendMessage(
      'Q',
      concat(new TextEncoder().encode(sql), Uint8Array.of(0)),
    ),
  )
  const rows = []
  const types = []
  for (;;) {
    const frame = await withTimeout(
      reader.readFrame(),
      30_000,
      'query response',
    )
    assert.ok(frame, 'backend closed during query')
    types.push(frame.type)
    if (frame.type === 'E') throw new Error(decodeError(frame.payload))
    if (frame.type === 'D') rows.push(decodeDataRow(frame.payload))
    if (frame.type === 'Z') return { rows, types }
  }
}

class ProtocolReader {
  frames = []
  #iterator
  #buffer = new Uint8Array()

  constructor(readable) {
    this.#iterator = readable[Symbol.asyncIterator]()
  }

  async readFrame() {
    while (this.#buffer.length < 5) {
      if (!(await this.#readChunk())) return null
    }
    const view = new DataView(
      this.#buffer.buffer,
      this.#buffer.byteOffset,
      this.#buffer.byteLength,
    )
    const length = view.getUint32(1, false)
    assert.ok(length >= 4 && length <= 64 * 1024 * 1024)
    const total = 1 + length
    while (this.#buffer.length < total) {
      if (!(await this.#readChunk())) throw new Error('truncated backend frame')
    }
    const type = String.fromCharCode(this.#buffer[0])
    const payload = this.#buffer.slice(5, total)
    this.#buffer = this.#buffer.slice(total)
    return { type, payload }
  }

  async #readChunk() {
    const next = await this.#iterator.next()
    if (next.done) return false
    this.#buffer = concat(this.#buffer, next.value)
    return true
  }
}

function startupMessage(parameters) {
  const parts = [u32(196608)]
  for (const [key, value] of Object.entries(parameters)) {
    parts.push(cstring(key), cstring(value))
  }
  parts.push(cstring('client_encoding'), cstring('UTF8'), Uint8Array.of(0))
  const body = concat(...parts)
  return concat(u32(body.length + 4), body)
}

function frontendMessage(type, payload) {
  return concat(
    Uint8Array.of(type.charCodeAt(0)),
    u32(payload.length + 4),
    payload,
  )
}

function decodeDataRow(payload) {
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  )
  const count = view.getUint16(0, false)
  const values = []
  let offset = 2
  for (let index = 0; index < count; index++) {
    const length = view.getInt32(offset, false)
    offset += 4
    if (length < 0) values.push(null)
    else {
      values.push(
        new TextDecoder().decode(payload.subarray(offset, offset + length)),
      )
      offset += length
    }
  }
  return values
}

function decodeError(payload) {
  const fields = []
  let offset = 0
  while (offset < payload.length && payload[offset] !== 0) {
    const code = String.fromCharCode(payload[offset++])
    const end = payload.indexOf(0, offset)
    if (end < 0) break
    fields.push(
      `${code}:${new TextDecoder().decode(payload.subarray(offset, end))}`,
    )
    offset = end + 1
  }
  return fields.join(' ')
}

function cstring(value) {
  return concat(new TextEncoder().encode(value), Uint8Array.of(0))
}

function u32(value) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function concat(...arrays) {
  const output = new Uint8Array(
    arrays.reduce((sum, value) => sum + value.length, 0),
  )
  let offset = 0
  for (const value of arrays) {
    output.set(value, offset)
    offset += value.length
  }
  return output
}

async function withTimeout(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`${label} timed out after ${milliseconds} ms`)),
          milliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitFor(predicate, milliseconds, label) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${label} timed out after ${milliseconds} ms`)
}

await main()
