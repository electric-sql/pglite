#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data] = process.argv.slice(2)
if (!data) {
  throw new Error('usage: filesystem-factory.mjs REPO_ROOT WASM GLUE DATA')
}

const dataDirectory = await mkdtemp(
  join(tmpdir(), 'pglite-filesystem-factory-'),
)
let postmaster
let session

try {
  const { PGlitePostmaster } = await import(
    pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js'))
      .href
  )
  postmaster = await PGlitePostmaster.create({
    dataDir: `file://${dataDirectory}`,
    maxConnections: 4,
    sharedBuffers: '16MB',
    artifact: { wasm, glue, data },
    workerFilesystem: {
      module: join(
        repoRoot,
        'packages/pglite/tests/fixtures/nodefs-filesystem.mjs',
      ),
      options: { root: dataDirectory },
    },
  })
  session = await createSessionWhenReady(postmaster)
  const result = await session.query('SELECT 6 * 7 AS answer')
  assert.deepEqual(result.rows, [{ answer: 42 }])
  await session.close()
  session = undefined
  await postmaster.close()
  const diagnostics = postmaster.diagnostics()
  assert.equal(diagnostics.livePrivateMemories, 0)
  assert.equal(
    diagnostics.privateMemoriesStarted,
    diagnostics.privateMemoriesReleased,
  )
  console.log('Pluggable Worker filesystem test: PASS')
} finally {
  await session?.close().catch(() => undefined)
  await postmaster?.close().catch(() => undefined)
  await rm(dataDirectory, { recursive: true, force: true })
}

async function createSessionWhenReady(server) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await server.createSession()
    } catch (error) {
      lastError = error
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 100))
    }
  }
  throw lastError ?? new Error('postmaster session did not become ready')
}
