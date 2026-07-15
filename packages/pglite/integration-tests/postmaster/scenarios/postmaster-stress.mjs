#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [
  repoRoot,
  wasm,
  glue,
  data,
  pgbench,
  outputRoot,
  resultPath,
  testDsaArchive,
  testDsaDescriptor,
] = process.argv.slice(2)
if (!testDsaDescriptor) {
  throw new Error(
    'usage: postmaster-stress.mjs REPO_ROOT WASM GLUE DATA PGBENCH OUTPUT_ROOT RESULT TEST_DSA_ARCHIVE TEST_DSA_DESCRIPTOR',
  )
}
assert.equal(process.arch, 'arm64')
const churnTransactions = Number.parseInt(
  process.env.PGLITE_POSTMASTER_STRESS_CHURN_TRANSACTIONS ?? '10000',
  10,
)
assert.ok(churnTransactions > 0 && churnTransactions % 4 === 0)

const { PGlitePostmaster, PostgresProcessKind } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js')).href
)
const { PGliteServer } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite-server/dist/index.js')).href
)
const testDsa = await extensionFromDescriptor(
  'test_dsa',
  testDsaArchive,
  testDsaDescriptor,
)

const dataDirectory = join(outputRoot, 'stress-pgdata')
const churnScript = join(outputRoot, 'session-churn.sql')
await Promise.all([
  rm(dataDirectory, { recursive: true, force: true }),
  rm(resultPath, { force: true }),
  writeFile(churnScript, 'SELECT 1;\n'),
])

let postmaster
let socket
const startedAt = Date.now()
let peak = processSample()
let sampleTimer

try {
  postmaster = await PGlitePostmaster.create({
    dataDir: `file://${dataDirectory}`,
    maxConnections: 24,
    sharedBuffers: '16MB',
    privateMaximumMemory: 64 * 1024 * 1024,
    debug: process.env.PGLITE_POSTMASTER_TEST_DEBUG === 'true',
    artifact: { wasm, glue, data },
    extensions: { testDsa },
    // Keep the 10,000-session reclamation measurement independent of the
    // default five-minute timed checkpoint. Checkpointer correctness and
    // crash recovery are exercised separately in this suite.
    startParams: [
      '-c',
      'log_min_messages=warning',
      '-c',
      'checkpoint_timeout=30min',
    ],
    workerFilesystem: {
      module: join(
        repoRoot,
        'packages/pglite/tests/fixtures/nodefs-filesystem.mjs',
      ),
      options: { root: dataDirectory },
    },
  })
  socket = await PGliteServer.create({
    postmaster,
    listen: { host: '127.0.0.1', port: 0 },
  })
  const address = socket.address
  assert.ok(address)
  assert.equal(address.transport, 'tcp')

  sampleTimer = setInterval(() => {
    peak = maximumSample(peak, processSample(postmaster))
  }, 50)

  const probe = await createSessionWhenReady(postmaster)
  await probe.exec(
    'CREATE TABLE restart_test(value int); INSERT INTO restart_test VALUES (42)',
  )
  await probe.close()
  await waitForBackendCount(postmaster, 0)
  const baseline = postmaster.diagnostics()

  const pgbenchEnvironment = {
    ...process.env,
    PGHOST: address.host,
    PGPORT: String(address.port),
    PGUSER: 'postgres',
    PGDATABASE: 'postgres',
    PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: '120',
  }
  const initialization = await run(pgbench, ['-i', '-s', '1', 'postgres'], {
    env: pgbenchEnvironment,
  })
  const single = await benchmark(
    pgbench,
    ['-n', '-c', '1', '-j', '1', '-T', '5', 'postgres'],
    pgbenchEnvironment,
  )
  const multi = await benchmark(
    pgbench,
    ['-n', '-c', '8', '-j', '4', '-T', '8', 'postgres'],
    pgbenchEnvironment,
  )
  const reconnect = await benchmark(
    pgbench,
    ['-n', '-C', '-c', '4', '-j', '4', '-t', '50', 'postgres'],
    pgbenchEnvironment,
  )

  await waitForIdle(postmaster, baseline.livePrivateMemories)
  const beforeChurn = postmaster.diagnostics()
  const churn = await benchmark(
    pgbench,
    [
      '-n',
      '-C',
      '-c',
      '4',
      '-j',
      '4',
      '-t',
      String(churnTransactions / 4),
      '-f',
      churnScript,
      'postgres',
    ],
    pgbenchEnvironment,
  )
  assert.equal(churn.transactions, churnTransactions)
  await waitForIdle(postmaster, baseline.livePrivateMemories, 120_000)
  const afterChurn = postmaster.diagnostics()
  assert.ok(
    afterChurn.privateMemoriesStarted - beforeChurn.privateMemoriesStarted >=
      churnTransactions,
  )
  assert.ok(
    afterChurn.privateMemoriesReleased - beforeChurn.privateMemoriesReleased >=
      churnTransactions,
  )
  assert.equal(
    afterChurn.livePrivateMemories,
    baseline.livePrivateMemories,
    'session churn retained private Wasm memories',
  )
  assert.ok(
    afterChurn.v8BackingStoreCollections >
      beforeChurn.v8BackingStoreCollections,
    'session churn did not collect retired V8 Wasm backing stores',
  )
  assert.ok(
    afterChurn.retiredScopedMemoriesAwaitingCollection < 128,
    'retired scoped memories exceeded the bounded collection interval',
  )

  const dsa = await createSessionWhenReady(postmaster)
  await dsa.exec('CREATE EXTENSION test_dsa')
  await dsa.query('SELECT test_dsa_basic()')
  await dsa.query('SELECT test_dsa_resowners()')
  const dsaWarm = postmaster.diagnostics()
  for (let iteration = 0; iteration < 20; iteration++) {
    await dsa.query('SELECT test_dsa_basic()')
    await dsa.query('SELECT test_dsa_resowners()')
  }
  await dsa.query('SELECT pg_stat_force_next_flush()')
  const stats = await dsa.query(`
    SELECT numbackends >= 1 AS has_backends, xact_commit > 0 AS has_commits
      FROM pg_stat_database
     WHERE datname = current_database()
  `)
  assert.deepEqual(stats.rows, [{ has_backends: true, has_commits: true }])
  const dsaAfter = postmaster.diagnostics()
  assert.equal(
    dsaAfter.globalMemoryBytes,
    dsaWarm.globalMemoryBytes,
    'global DSM/DSA churn grew memory after its warm high-water mark',
  )
  assert.equal(
    dsaAfter.scopedMemoryBytes,
    dsaWarm.scopedMemoryBytes,
    'scoped DSM/DSA churn grew backing memory after its warm high-water mark',
  )
  assert.equal(
    dsaAfter.scopedLifetime.allocatedBytes,
    dsaWarm.scopedLifetime.allocatedBytes,
    'scoped DSM/DSA churn retained allocated segments',
  )
  assert.ok(
    dsaAfter.scopedLifetime.allocationGeneration >
      dsaWarm.scopedLifetime.allocationGeneration,
    'scoped DSM/DSA segments were not released and reused',
  )
  await dsa.close()

  const crashSession = await createSessionWhenReady(postmaster)
  const crashedPid = (
    await crashSession.query('SELECT pg_backend_pid() AS pid')
  ).rows[0].pid
  const crashGeneration = postmaster.diagnostics().globalShmAllocationGeneration
  await terminateBackendWorker(postmaster, crashedPid)
  await assert.rejects(
    withTimeout(
      crashSession.query('SELECT 1'),
      10_000,
      'crashed session close',
    ),
    /abort|closed|connection|ring/i,
  )
  await crashSession.close().catch(() => undefined)

  const recovered = await createSessionWhenReady(postmaster, 120_000)
  assert.deepEqual(
    (await recovered.query('SELECT value FROM restart_test')).rows,
    [{ value: 42 }],
  )
  await recovered.close()
  const recoveredDiagnostics = postmaster.diagnostics()
  assert.ok(
    recoveredDiagnostics.globalShmAllocationGeneration > crashGeneration,
    'crash recovery did not replace the primary shared-memory generation',
  )
  assert.equal(
    postmaster.registry.handles().some(({ pid }) => pid === crashedPid),
    false,
    'crash recovery retained the stale process handle',
  )

  await waitForIdle(postmaster, baseline.livePrivateMemories, 120_000)
  const beforeShutdown = postmaster.diagnostics()
  clearInterval(sampleTimer)
  sampleTimer = undefined
  await socket.close()
  await postmaster.close()
  const shutdown = postmaster.diagnostics()
  assert.equal(shutdown.livePrivateMemories, 0)
  assert.equal(
    shutdown.privateMemoriesStarted,
    shutdown.privateMemoriesReleased,
  )
  assert.equal(shutdown.retiredScopedMemoriesAwaitingCollection, 0)

  let abiCeiling
  try {
    await PGlitePostmaster.create({
      dataDir: `file://${dataDirectory}`,
      initialize: false,
      globalMaximumMemory: 1024 * 1024 * 1024 + 65_536,
      artifact: { wasm, glue, data },
    })
  } catch (error) {
    abiCeiling = error
  }
  assert.match(String(abiCeiling), /1 GiB ABI/)

  peak = maximumSample(peak, processSample())
  const reclaimedProcess = processSample()
  assert.ok(
    peak.rss < 2 * 1024 * 1024 * 1024,
    `RSS exceeded 2 GiB: ${peak.rss}`,
  )
  assert.ok(
    reclaimedProcess.virtualBytes < 512 * 1024 * 1024 * 1024,
    `released backing stores retained more than 512 GiB of virtual address space: ${reclaimedProcess.virtualBytes}`,
  )
  assert.ok(
    reclaimedProcess.virtualBytes < peak.virtualBytes,
    'backend shutdown did not reclaim V8 virtual address reservations',
  )

  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        schema: 1,
        status: 'pass',
        elapsedMs: Date.now() - startedAt,
        architecture: process.arch,
        pgbench: {
          initialization: initialization.stdout.trim(),
          single,
          multi,
          reconnect,
          churn,
        },
        sessionChurn: {
          requested: churnTransactions,
          concurrency: 4,
          before: beforeChurn,
          after: afterChurn,
        },
        dsmDsa: { warm: dsaWarm, after: dsaAfter },
        crashRecovery: {
          policy: 'postgres-in-place-reset',
          crashedPid,
          generationBefore: crashGeneration,
          recovered: recoveredDiagnostics,
        },
        ceiling: { bytes: 1024 * 1024 * 1024, diagnostic: abiCeiling?.message },
        baseline,
        beforeShutdown,
        shutdown,
        peak,
        virtualAddress: {
          semantics: 'sparse-v8-guard-reservations-with-deferred-gc',
          transientPeakBytes: peak.virtualBytes,
          reclaimedBytes: reclaimedProcess.virtualBytes,
          reclaimedLimitBytes: 512 * 1024 * 1024 * 1024,
        },
      },
      null,
      2,
    )}\n`,
  )
  console.log('PGlite postmaster pgbench, memory, and crash tests: PASS')
} catch (error) {
  console.error(
    `Postmaster stress failure diagnostics: ${JSON.stringify(
      {
        current: processSample(postmaster),
        peak,
        postmaster: postmaster?.diagnostics(),
      },
      null,
      2,
    )}`,
  )
  throw error
} finally {
  if (sampleTimer) clearInterval(sampleTimer)
  await socket?.close().catch(() => undefined)
  await postmaster?.close().catch(() => undefined)
}

async function benchmark(command, args, env) {
  const started = Date.now()
  const result = await run(command, args, { env })
  const transactionsMatch = result.stdout.match(
    /number of transactions actually processed:\s+(\d+)(?:\/(\d+))?/,
  )
  const latencyMatch = result.stdout.match(/latency average = ([0-9.]+) ms/)
  const tpsMatches = [...result.stdout.matchAll(/^tps = ([0-9.]+)/gm)]
  assert.ok(
    transactionsMatch,
    `missing pgbench transaction count:\n${result.stdout}`,
  )
  assert.ok(
    tpsMatches.length > 0,
    `missing pgbench throughput:\n${result.stdout}`,
  )
  return {
    arguments: args,
    elapsedMs: Date.now() - started,
    transactions: Number(transactionsMatch[1]),
    requestedTransactions: transactionsMatch[2]
      ? Number(transactionsMatch[2])
      : undefined,
    latencyAverageMs: latencyMatch ? Number(latencyMatch[1]) : undefined,
    tps: Number(tpsMatches.at(-1)[1]),
    output: result.stdout.trim(),
  }
}

async function run(command, args, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr })
      else
        reject(
          new Error(
            `${command} exited with ${code ?? signal}\n${stdout}\n${stderr}`,
          ),
        )
    })
  })
}

async function createSessionWhenReady(postmaster, timeout = 60_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    let session
    try {
      session = await withTimeout(
        postmaster.createSession(),
        10_000,
        'session startup',
      )
      await session.query('SELECT 1')
      return session
    } catch (error) {
      lastError = error
      await session?.close().catch(() => undefined)
      await delay(100)
    }
  }
  throw lastError ?? new Error('postmaster did not recover before deadline')
}

async function waitForBackendCount(postmaster, target, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const backends = postmaster.registry
      .handles()
      .flatMap((handle) => {
        try {
          return [postmaster.registry.snapshot(handle)]
        } catch (error) {
          // The supervisor may reap a backend between handles() and
          // snapshot(); that means the backend has already left the count.
          if (String(error).includes('stale PGlite process handle')) return []
          throw error
        }
      })
      .filter(({ kind }) => kind === PostgresProcessKind.Backend).length
    if (backends <= target) return
    await delay(25)
  }
  throw new Error(`backend count did not return to ${target}`)
}

async function waitForIdle(postmaster, target, timeout = 30_000) {
  const desired = target ?? postmaster.diagnostics().livePrivateMemories
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (postmaster.diagnostics().livePrivateMemories <= desired) return
    await delay(25)
  }
  throw new Error(
    `private memories did not return to ${desired}: ${JSON.stringify(postmaster.diagnostics())}`,
  )
}

function processSample(postmaster) {
  const memory = process.memoryUsage()
  const status = awaitableProcStatus()
  const diagnostics = postmaster?.diagnostics()
  return {
    rss: memory.rss,
    virtualBytes: status.virtualBytes,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    livePrivateMemories: diagnostics?.livePrivateMemories ?? 0,
    privateMemoryBytes: diagnostics?.privateMemoryBytes ?? 0,
    globalMemoryBytes: diagnostics?.globalMemoryBytes ?? 0,
  }
}

async function terminateBackendWorker(postmaster, pid) {
  const record = postmaster.workers?.get(pid)
  assert.ok(record, `PostgreSQL Worker ${pid} is not live`)
  await record.worker.terminate()
}

function awaitableProcStatus() {
  try {
    const text = requireStatus()
    const match = text.match(/^VmSize:\s+(\d+) kB$/m)
    return { virtualBytes: match ? Number(match[1]) * 1024 : 0 }
  } catch {
    return { virtualBytes: 0 }
  }
}

function requireStatus() {
  // The test runs only in the pinned Linux container. Synchronous sampling
  // keeps the 50 ms high-water timer from overlapping file reads.
  return readFileSync('/proc/self/status', 'utf8')
}

function maximumSample(left, right) {
  return Object.fromEntries(
    Object.keys(left).map((key) => [key, Math.max(left[key], right[key])]),
  )
}

function withTimeout(promise, timeout, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout)
    }),
  ]).finally(() => clearTimeout(timer))
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function extensionFromDescriptor(name, archive, descriptorPath) {
  const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
  return {
    name,
    version: descriptor.extensionManifest.extensionVersion,
    backend: {
      targetKeys: ['wasm32-multi-memory'],
      artifacts: {
        'wasm32-multi-memory': {
          targetKey: descriptor.targetKey,
          target: descriptor.target,
          url: pathToFileURL(archive),
          archiveBytes: descriptor.archiveBytes,
          archiveSha256: descriptor.archiveSha256,
          manifestSha256: descriptor.manifestSha256,
          manifest: descriptor.extensionManifest,
        },
      },
    },
  }
}
