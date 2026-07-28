#!/usr/bin/env node

import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data, rawModule, transformedModule, auditPath] =
  process.argv.slice(2)
if (!auditPath) {
  throw new Error(
    'usage: dynamic-side-module.mjs REPO_ROOT WASM GLUE DATA RAW_MODULE TRANSFORMED_MODULE AUDIT',
  )
}

const audit = JSON.parse(await readFile(auditPath, 'utf8'))
assert.equal(audit.status, 'pass')
const dataDirectory = await mkdtemp(join(tmpdir(), 'pglite-dylink-'))
const rawName = 'pglite_dynamic_probe_raw.so'
const transformedName = 'pglite_dynamic_probe.so'
const incompatibleName = 'pglite_dynamic_probe_incompatible.so'
const sessions = []
let postmaster

try {
  const { PGlitePostmaster } = await import(
    pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js'))
      .href
  )
  postmaster = await PGlitePostmaster.create({
    dataDir: `file://${dataDirectory}`,
    maxConnections: 8,
    sharedBuffers: '16MB',
    artifact: { wasm, glue, data },
  })

  await copyFile(rawModule, join(dataDirectory, rawName))
  await copyFile(transformedModule, join(dataDirectory, transformedName))
  const incompatible = Buffer.from(await readFile(transformedModule))
  replaceOnce(incompatible, 'pglite-tagged-i32-v1', 'pglite-tagged-i32-v0')
  await writeFile(join(dataDirectory, incompatibleName), incompatible)

  const first = await open(postmaster)
  const second = await open(postmaster)
  sessions.push(first, second)

  await expectError(
    first.exec(`
      CREATE FUNCTION pglite_dynamic_probe_raw(integer) RETURNS text
      AS '/pglite/data/${rawName}', 'pglite_dynamic_probe'
      LANGUAGE C STRICT
    `),
    /memory ABI sections; expected exactly one/,
  )
  await expectError(
    first.exec(`
      CREATE FUNCTION pglite_dynamic_probe_incompatible(integer) RETURNS text
      AS '/pglite/data/${incompatibleName}', 'pglite_dynamic_probe'
      LANGUAGE C STRICT
    `),
    /incompatible memory ABI/,
  )

  await first.exec(`
    CREATE FUNCTION pglite_dynamic_probe(integer) RETURNS text
    AS '/pglite/data/${transformedName}', 'pglite_dynamic_probe'
    LANGUAGE C STRICT
  `)
  const before = postmaster.diagnostics()
  const firstCall = parseProbe(
    (await first.query('SELECT pglite_dynamic_probe(7) AS value')).rows[0]
      .value,
  )
  const secondCall = parseProbe(
    (await first.query('SELECT pglite_dynamic_probe(9) AS value')).rows[0]
      .value,
  )
  const otherBackend = parseProbe(
    (await second.query('SELECT pglite_dynamic_probe(11) AS value')).rows[0]
      .value,
  )
  const after = postmaster.diagnostics()

  assert.equal(firstCall.privateCalls, 1)
  assert.equal(secondCall.privateCalls, 2)
  assert.equal(otherBackend.privateCalls, 1)
  assert.ok(firstCall.sharedOid >= 10_000)
  assert.ok(secondCall.sharedOid >= firstCall.sharedOid)
  assert.ok(otherBackend.sharedOid >= 10_000)
  assert.equal(firstCall.scopedTag, 3)
  assert.equal(secondCall.scopedTag, 3)
  assert.equal(otherBackend.scopedTag, 3)
  assert.equal(firstCall.value, (7 ^ 0x51a7_c0de) >>> 0)
  assert.equal(secondCall.value, (9 ^ 0x51a7_c0de) >>> 0)
  assert.equal(otherBackend.value, (11 ^ 0x51a7_c0de) >>> 0)
  assert.equal(after.scopedLifetime.activeQueryScopes, 0)
  assert.equal(after.scopedLifetime.activeParallelContextScopes, 0)
  assert.equal(
    after.scopedLifetime.allocatedBytes,
    before.scopedLifetime.allocatedBytes,
  )

  await Promise.all(sessions.map((session) => session.close()))
  sessions.length = 0
  await postmaster.close()
  const shutdown = postmaster.diagnostics()
  assert.equal(shutdown.livePrivateMemories, 0)
  assert.equal(shutdown.liveScopedMemories, 0)
  assert.equal(shutdown.scopedLifetime.readyRoots, 0)

  console.log('Transformed dynamic side-module runtime test: PASS')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  await postmaster?.close().catch(() => undefined)
  await rm(dataDirectory, { recursive: true, force: true })
}

async function open(server) {
  const deadline = Date.now() + 60_000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await server.createSession()
    } catch (error) {
      lastError = error
      if (error?.code !== '57P03') throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw (
    lastError ??
    new Error('dynamic side-module postmaster did not become ready')
  )
}

async function expectError(promise, pattern) {
  try {
    await promise
    assert.fail(`expected error matching ${pattern}`)
  } catch (error) {
    assert.match(String(error), pattern)
  }
}

function parseProbe(value) {
  assert.equal(typeof value, 'string')
  const parts = value.split(':').map(Number)
  assert.equal(parts.length, 4)
  assert.ok(parts.every(Number.isSafeInteger))
  return {
    privateCalls: parts[0],
    sharedOid: parts[1],
    scopedTag: parts[2],
    value: parts[3],
  }
}

function replaceOnce(buffer, from, to) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to))
  const offset = buffer.indexOf(from)
  assert.ok(offset >= 0, `could not find ${from} in transformed side module`)
  assert.equal(buffer.indexOf(from, offset + 1), -1)
  buffer.write(to, offset, 'utf8')
}
