#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data, nativeRoot] = process.argv.slice(2)
if (!nativeRoot) {
  throw new Error(
    'usage: socket-frontend.mjs REPO_ROOT WASM GLUE DATA NATIVE_ROOT',
  )
}

const psql = join(nativeRoot, 'build/src/bin/psql/psql')
const pgIsReady = join(nativeRoot, 'build/src/bin/scripts/pg_isready')
const pgbench = join(nativeRoot, 'build/src/bin/pgbench/pgbench')
const libraryPath = join(nativeRoot, 'build/src/interfaces/libpq')

async function main() {
  const { PGlitePostmaster } = await import(
    pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js'))
      .href
  )
  const { PGliteSocketServer } = await import(
    pathToFileURL(join(repoRoot, 'packages/pglite-socket/dist/index.js')).href
  )
  const root = await mkdtemp(join(tmpdir(), 'pglite-socket-frontend-'))
  const dataDirectory = join(root, 'data')
  const socketDirectory = join(root, 'socket')
  let postmaster
  let tcp
  let unix

  try {
    postmaster = await withTimeout(
      PGlitePostmaster.create({
        dataDir: `file://${dataDirectory}`,
        maxConnections: 8,
        sharedBuffers: '16MB',
        artifact: { wasm, glue, data },
      }),
      60_000,
      'postmaster startup',
    )
    tcp = new PGliteSocketServer({
      postmaster,
      listen: { host: '127.0.0.1', port: 0 },
    })
    unix = new PGliteSocketServer({
      postmaster,
      listen: { directory: socketDirectory, port: 55432 },
    })
    const tcpAddress = await tcp.start()
    const unixAddress = await unix.start()
    assert.equal(tcpAddress.transport, 'tcp')
    assert.equal(unixAddress.transport, 'unix')
    const releasedBeforeClients =
      postmaster.diagnostics().privateMemoriesReleased

    const commonEnvironment = {
      ...process.env,
      LD_LIBRARY_PATH: libraryPath,
      PGDATABASE: 'postgres',
      PGUSER: 'postgres',
      PGSSLMODE: 'prefer',
    }
    const tcpEnvironment = {
      ...commonEnvironment,
      PGHOST: tcpAddress.host,
      PGPORT: String(tcpAddress.port),
    }
    const unixEnvironment = {
      ...commonEnvironment,
      PGHOST: socketDirectory,
      PGPORT: '55432',
    }

    const readiness = await runUntilSuccess(
      pgIsReady,
      [],
      tcpEnvironment,
      30_000,
    )
    assert.equal(readiness.code, 0, `${readiness.stdout}\n${readiness.stderr}`)
    assert.match(readiness.stdout, /accepting connections/)

    const tcpResult = await run(
      psql,
      [
        '-X',
        '--no-psqlrc',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "CREATE TABLE socket_gate(id int primary key, value text); INSERT INTO socket_gate VALUES (42, 'tcp'); SELECT id || ':' || value FROM socket_gate;",
      ],
      tcpEnvironment,
    )
    assert.equal(tcpResult.code, 0, tcpResult.stderr)
    assert.match(tcpResult.stdout, /^42:tcp$/m)

    const unixResult = await run(
      psql,
      [
        '-X',
        '--no-psqlrc',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "UPDATE socket_gate SET value = 'unix' WHERE id = 42; SELECT id || ':' || value FROM socket_gate;",
      ],
      unixEnvironment,
    )
    assert.equal(unixResult.code, 0, unixResult.stderr)
    assert.match(unixResult.stdout, /^42:unix$/m)

    const versions = await Promise.all(
      [psql, pgIsReady, pgbench].map((tool) =>
        run(tool, ['--version'], {
          ...process.env,
          LD_LIBRARY_PATH: libraryPath,
        }),
      ),
    )
    assert.ok(versions.every(({ code }) => code === 0))
    assert.deepEqual(
      versions.map(({ stdout }) => stdout.trim()),
      [
        'psql (PostgreSQL) 18.3',
        'pg_isready (PostgreSQL) 18.3',
        'pgbench (PostgreSQL) 18.3',
      ],
    )

    await tcp.stop()
    await unix.stop()
    await waitFor(
      () =>
        postmaster.diagnostics().privateMemoriesReleased >=
        releasedBeforeClients + 3,
      15_000,
      'native client backend cleanup',
    )
    const beforeShutdown = postmaster.diagnostics()
    assert.ok(
      beforeShutdown.privateMemoriesReleased >= releasedBeforeClients + 3,
    )
    await withTimeout(postmaster.close(), 15_000, 'postmaster shutdown')
    const shutdown = postmaster.diagnostics()
    assert.equal(shutdown.liveProcesses, 0)
    assert.equal(shutdown.livePrivateMemories, 0)

    console.log('Native TCP/Unix socket frontend test: PASS')
  } finally {
    await tcp?.stop().catch(() => undefined)
    await unix?.stop().catch(() => undefined)
    await postmaster?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}

function run(command, args, environment) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', rejectRun)
    child.once('close', (code, signal) =>
      resolveRun({
        code: code ?? (signal ? 128 : 1),
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    )
  })
}

async function runUntilSuccess(command, args, environment, timeout) {
  const deadline = Date.now() + timeout
  let result
  do {
    result = await run(command, args, environment)
    if (result.code === 0) return result
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 100))
  } while (Date.now() < deadline)
  return result
}

async function waitFor(predicate, timeout, label) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label} timed out`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
}

async function withTimeout(promise, timeout, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          timeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

await main()
