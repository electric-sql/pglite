#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [
  repoRoot,
  wasm,
  glue,
  data,
  nativeRoot,
  testLibraryRoot,
  testOutputRoot,
  dataDirectory,
  readyPath,
  resultPath,
  portText,
] = process.argv.slice(2)
if (!portText) {
  throw new Error(
    'usage: regression-server.mjs REPO_ROOT WASM GLUE DATA NATIVE TESTLIB TEST_OUTPUT PGDATA READY RESULT PORT',
  )
}

const port = Number(portText)
assert.ok(Number.isInteger(port) && port > 0 && port < 65_536)
assert.equal(process.arch, 'arm64')

const { PGlitePostmaster } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js')).href
)
const { PGliteServer } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite-server/dist/index.js')).href
)

await Promise.all([
  rm(readyPath, { force: true }),
  rm(resultPath, { force: true }),
])

const startedAt = Date.now()
const parallelParams =
  process.env.PGLITE_POSTMASTER_TEST_ENABLE_PARALLEL === 'true'
    ? [
        '-c',
        'max_parallel_workers=8',
        '-c',
        'max_parallel_workers_per_gather=4',
        '-c',
        'max_parallel_maintenance_workers=4',
      ]
    : []
const icuArchive = await readFile(
  join(repoRoot, 'packages/pglite-icu-full/static/icu.76.tgz'),
)
const postmaster = await PGlitePostmaster.create({
  dataDir: `file://${dataDirectory}`,
  maxConnections: 48,
  sharedBuffers: '32MB',
  icuDataDir: new Blob([icuArchive]),
  artifact: { wasm, glue, data },
  debug: process.env.PGLITE_POSTMASTER_TEST_DEBUG === 'true',
  startParams: [
    '-c',
    'datestyle=Postgres, MDY',
    '-c',
    'intervalstyle=postgres_verbose',
    '-c',
    'timezone=America/Los_Angeles',
    '-c',
    `dynamic_library_path=${testLibraryRoot}:$libdir`,
    '-c',
    'log_min_messages=warning',
    ...parallelParams,
  ],
  workerFilesystem: {
    module: join(
      repoRoot,
      'packages/pglite/tests/fixtures/nodefs-filesystem.mjs',
    ),
    options: {
      root: dataDirectory,
      mounts: [
        { root: testOutputRoot, path: testOutputRoot },
        { root: join(testOutputRoot, 'icu'), path: '/pglite/icu' },
      ],
    },
  },
})
const socket = await PGliteServer.create({
  postmaster,
  listen: { host: '127.0.0.1', port },
})

let stopping = false
let peak = sample()
const sampleTimer = setInterval(() => {
  peak = maximumSample(peak, sample())
}, 100)

try {
  const setup = await createSessionWhenReady(postmaster)
  try {
    for (const database of ['regression', 'isolation_regression']) {
      const exists = await setup.query(
        'SELECT EXISTS (SELECT FROM pg_database WHERE datname = $1) AS exists',
        [database],
      )
      if (!exists.rows[0].exists) {
        await setup.exec(`CREATE DATABASE ${database} TEMPLATE template0`)
      }
    }
  } finally {
    await setup.close()
  }

  const address = socket.address
  assert.ok(address)
  assert.equal(address.transport, 'tcp')
  await writeFile(
    readyPath,
    `${JSON.stringify(
      {
        schema: 1,
        status: 'ready',
        pid: process.pid,
        architecture: process.arch,
        host: address.host,
        port: address.port,
        nativeRoot,
        testLibraryRoot,
        startupMs: Date.now() - startedAt,
        diagnostics: postmaster.diagnostics(),
      },
      null,
      2,
    )}\n`,
  )
} catch (error) {
  clearInterval(sampleTimer)
  await socket.close().catch(() => undefined)
  await postmaster.close().catch(() => undefined)
  throw error
}

async function stop(signal, failed = false) {
  if (stopping) return
  stopping = true
  clearInterval(sampleTimer)
  const beforeShutdown = postmaster.diagnostics()
  await socket.close().catch((error) => console.error(error))
  await postmaster.close().catch((error) => console.error(error))
  const shutdown = postmaster.diagnostics()
  peak = maximumSample(peak, sample())
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        schema: 1,
        status: failed ? 'fail' : 'pass',
        signal,
        elapsedMs: Date.now() - startedAt,
        beforeShutdown,
        shutdown,
        peak,
      },
      null,
      2,
    )}\n`,
  )
  await rm(readyPath, { force: true })
  process.exit(failed ? 1 : 0)
}

process.on('SIGTERM', () => void stop('SIGTERM'))
process.on('SIGINT', () => void stop('SIGINT'))
process.on('uncaughtException', (error) => {
  console.error(error)
  void stop('uncaughtException', true)
})
process.on('unhandledRejection', (error) => {
  console.error(error)
  void stop('unhandledRejection', true)
})

async function createSessionWhenReady(server) {
  const deadline = Date.now() + 60_000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await server.createSession()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw lastError ?? new Error('postmaster did not become ready')
}

function sample() {
  const memory = process.memoryUsage()
  const diagnostics = postmaster.diagnostics()
  return {
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    liveProcesses: diagnostics.liveProcesses,
    livePrivateMemories: diagnostics.livePrivateMemories,
    privateMemoryBytes: diagnostics.privateMemoryBytes,
    globalMemoryBytes: diagnostics.globalMemoryBytes,
  }
}

function maximumSample(left, right) {
  return Object.fromEntries(
    Object.keys(left).map((key) => [key, Math.max(left[key], right[key])]),
  )
}
