#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data, dedicatedPath] = process.argv.slice(2)
if (!dedicatedPath) {
  throw new Error(
    'usage: compact-postmaster.mjs REPO_ROOT WASM GLUE DATA DEDICATED_JSON',
  )
}

const dedicated = JSON.parse(await readFile(dedicatedPath, 'utf8'))
const privateInitialBytes = 32 * 1024 * 1024
const dataDirectory = await mkdtemp(join(tmpdir(), 'pglite-compact-'))
const sessions = []
let postmaster

try {
  const { PGlitePostmaster } = await import(
    pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js'))
      .href
  )
  postmaster = await PGlitePostmaster.create({
    dataDir: `file://${dataDirectory}`,
    maxConnections: 12,
    sharedBuffers: '16MB',
    artifact: { wasm, glue, data },
    scopedMemoryMode: 'compact',
    startParams: [
      '-c',
      'max_worker_processes=16',
      '-c',
      'max_parallel_workers=4',
      '-c',
      'max_parallel_workers_per_gather=2',
    ],
  })

  for (let index = 0; index < 3; index++) {
    sessions.push(await open(postmaster))
  }
  const startup = postmaster.diagnostics()
  assert.equal(startup.scopedMemoryMode, 'compact')
  assert.equal(startup.liveScopedMemories, 0)
  assert.equal(startup.scopedMemoriesStarted, 0)
  assert.equal(startup.scopedMemoryBytes, 0)
  assert.equal(startup.compactRootBindings, startup.scopedLifetime.readyRoots)
  assert.equal(startup.scopedLifetime.activeSessionScopes, sessions.length)
  assert.equal(startup.scopedLifetime.closingScopes, 0)
  const dedicatedBindingBytes = bindingBytes(dedicated.startup)
  const compactBindingBytes = bindingBytes(startup)
  const dedicatedBindingBytesPerRoot =
    dedicatedBindingBytes / dedicated.startup.scopedLifetime.readyRoots
  const compactBindingBytesPerRoot =
    compactBindingBytes / startup.scopedLifetime.readyRoots
  assert.ok(
    compactBindingBytesPerRoot < dedicatedBindingBytesPerRoot,
    'compact binding did not reduce normalized per-root Wasm backing-store bytes',
  )

  const [leader, control] = sessions
  await control.exec(`
    CREATE UNLOGGED TABLE compact_test(value int NOT NULL);
    INSERT INTO compact_test SELECT generate_series(1, 250000);
    ALTER TABLE compact_test SET (parallel_workers = 2);
    ANALYZE compact_test;
  `)
  await leader.exec(`
    SET min_parallel_table_scan_size = 0;
    SET parallel_setup_cost = 0;
    SET parallel_tuple_cost = 0;
    SET max_parallel_workers_per_gather = 2;
  `)
  const beforeParallel = postmaster.diagnostics()
  const explained = await leader.query(`
    EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON)
    SELECT sum(value)::bigint FROM compact_test
  `)
  assert.match(
    JSON.stringify(explained.rows),
    /"Workers Launched":(?:\s*)[1-9]/,
  )
  assert.deepEqual(
    (await leader.query('SELECT sum(value)::bigint AS total FROM compact_test'))
      .rows,
    [{ total: 31_250_125_000 }],
  )
  const afterParallel = postmaster.diagnostics()
  assert.ok(
    afterParallel.privateMemoriesStarted >
      beforeParallel.privateMemoriesStarted,
  )
  assert.ok(
    afterParallel.compactRootBindings <= beforeParallel.compactRootBindings,
    'parallel query created a new compact root instead of inheriting its leader',
  )
  assert.equal(afterParallel.scopedMemoriesStarted, 0)
  assert.equal(afterParallel.scopedLifetime.activeParallelContextScopes, 0)
  assert.equal(afterParallel.scopedLifetime.activeQueryScopes, 0)
  assert.equal(afterParallel.scopedLifetime.activeWorkers, 0)
  assert.equal(afterParallel.scopedLifetime.closingScopes, 0)

  await Promise.all(sessions.map((session) => session.close()))
  sessions.length = 0
  await postmaster.close()
  const shutdown = postmaster.diagnostics()
  assert.equal(shutdown.livePrivateMemories, 0)
  assert.equal(shutdown.liveScopedMemories, 0)
  assert.equal(shutdown.compactRootBindings, 0)
  assert.equal(shutdown.scopedLifetime.readyRoots, 0)
  assert.equal(
    shutdown.privateMemoriesStarted,
    shutdown.privateMemoriesReleased,
  )

  console.log('Compact postmaster and memory-value test: PASS')
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
    lastError ?? new Error('compact postmaster session did not become ready')
  )
}

function bindingBytes(diagnostics) {
  return (
    diagnostics.totalUniqueMemoryBytes -
    diagnostics.globalMemoryBytes -
    diagnostics.liveProcesses * privateInitialBytes
  )
}
