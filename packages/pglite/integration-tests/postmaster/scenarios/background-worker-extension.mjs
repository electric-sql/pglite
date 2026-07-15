#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data, archive, descriptorPath] =
  process.argv.slice(2)
if (!descriptorPath) {
  throw new Error(
    'usage: background-worker-extension.mjs REPO_ROOT WASM GLUE DATA ARCHIVE DESCRIPTOR',
  )
}

const { PGlitePostmaster } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js')).href
)
const external = JSON.parse(await readFile(descriptorPath, 'utf8'))
const workerSpi = {
  name: 'worker_spi',
  version: '1.0.0',
  backend: {
    targetKeys: ['wasm32-multi-memory'],
    artifacts: {
      'wasm32-multi-memory': {
        targetKey: external.targetKey,
        target: external.target,
        url: pathToFileURL(archive),
        archiveBytes: external.archiveBytes,
        archiveSha256: external.archiveSha256,
        manifestSha256: external.manifestSha256,
        manifest: external.extensionManifest,
      },
    },
  },
}
const dataDirectory = await mkdtemp(join(tmpdir(), 'pglite-worker-spi-'))
let postmaster

try {
  postmaster = await PGlitePostmaster.create({
    dataDir: `file://${dataDirectory}`,
    maxConnections: 12,
    sharedBuffers: '16MB',
    artifact: { wasm, glue, data },
    extensions: { workerSpi },
  })
  const session = await postmaster.createSession()
  try {
    await poll(async () => {
      const { rows } = await session.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE backend_type = 'worker_spi'",
      )
      return rows[0].count === 2
    })
    await session.exec('CREATE EXTENSION worker_spi')
    const launched = await session.query('SELECT worker_spi_launch(4) AS pid')
    assert.ok(launched.rows[0].pid > 0)
    await poll(async () => {
      const { rows } = await session.query(
        "SELECT to_regclass('schema4.counted') IS NOT NULL AS ready",
      )
      return rows[0].ready
    })
  } finally {
    await session.close()
  }
  console.log('shared preload and background Worker extension: PASS')
} finally {
  await postmaster?.close().catch(() => undefined)
  await rm(dataDirectory, { recursive: true, force: true })
}

async function poll(check) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('background Worker did not become ready')
}
