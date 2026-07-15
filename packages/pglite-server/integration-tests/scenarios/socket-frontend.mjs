#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'

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
  const { PGliteServer } = await import(
    pathToFileURL(join(repoRoot, 'packages/pglite-server/dist/index.js')).href
  )
  const root = await mkdtemp(join(tmpdir(), 'pglite-socket-frontend-'))
  const dataDirectory = join(root, 'data')
  const socketDirectory = join(root, 'socket')
  let postmaster
  let tcp
  let unix
  let owned
  let strict
  let strictPostmaster
  let occupied

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
    tcp = await PGliteServer.create({
      postmaster,
      listen: { host: '127.0.0.1', port: 0 },
    })
    unix = await PGliteServer.create({
      postmaster,
      listen: { directory: socketDirectory, port: 55432 },
    })
    const tcpAddress = tcp.address
    const unixAddress = unix.address
    assert.ok(tcpAddress)
    assert.ok(unixAddress)
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

    await tcp.close()
    await unix.close()
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

    owned = await PGliteServer.create({
      postmaster: {
        dataDir: `file://${join(root, 'owned-data')}`,
        maxConnections: 4,
        sharedBuffers: '16MB',
        artifact: { wasm, glue, data },
      },
      listen: { host: '127.0.0.1', port: 0 },
    })
    const ownedAddress = owned.address
    if (ownedAddress?.transport !== 'tcp') {
      throw new Error('owned server did not create a TCP listener')
    }
    const ownedReadiness = await runUntilSuccess(
      pgIsReady,
      [],
      {
        ...commonEnvironment,
        PGHOST: ownedAddress.host,
        PGPORT: String(ownedAddress.port),
      },
      30_000,
    )
    assert.equal(
      ownedReadiness.code,
      0,
      `${ownedReadiness.stdout}\n${ownedReadiness.stderr}`,
    )
    const ownedPostmaster = owned.postmaster
    await owned.close({ mode: 'fast' })
    assert.equal(ownedPostmaster.diagnostics().liveProcesses, 0)
    owned = undefined

    const strictPort = await reservePort()
    const strictPostmasterOptions = (dataName) => ({
      dataDir: `file://${join(root, dataName)}`,
      maxConnections: 4,
      sharedBuffers: '16MB',
      artifact: { wasm, glue, data },
      respectPostgresqlConfig: true,
      startParams: [
        '-c',
        'listen_addresses=127.0.0.1',
        '-c',
        `port=${strictPort}`,
        '-c',
        'unix_socket_directories=',
      ],
    })
    strictPostmaster = await withTimeout(
      PGlitePostmaster.create(strictPostmasterOptions('strict-failure-data')),
      60_000,
      'strict failure postmaster startup',
    )

    occupied = createServer()
    await new Promise((resolveListen, rejectListen) => {
      occupied.once('error', rejectListen)
      occupied.listen(strictPort, '127.0.0.1', resolveListen)
    })
    await assert.rejects(
      PGliteServer.create({ postmaster: strictPostmaster, mode: 'postgres' }),
      (error) => error?.code === 'EADDRINUSE',
    )
    await strictPostmaster.shutdown('immediate')
    strictPostmaster = undefined
    await new Promise((resolveClose, rejectClose) =>
      occupied.close((error) =>
        error ? rejectClose(error) : resolveClose(undefined),
      ),
    )
    occupied = undefined

    strictPostmaster = await withTimeout(
      PGlitePostmaster.create(strictPostmasterOptions('strict-success-data')),
      60_000,
      'strict postmaster startup',
    )

    strict = await PGliteServer.create({
      postmaster: strictPostmaster,
      mode: 'postgres',
    })
    assert.equal(strict.address, undefined)
    assert.deepEqual(strict.addresses, [
      { transport: 'tcp', host: '127.0.0.1', port: strictPort },
    ])
    const strictResult = await runUntilSuccess(
      psql,
      ['-X', '--no-psqlrc', '-A', '-t', '-c', 'SELECT 6 * 7'],
      {
        ...commonEnvironment,
        PGHOST: '127.0.0.1',
        PGPORT: String(strictPort),
      },
      30_000,
    )
    assert.equal(strictResult.code, 0, strictResult.stderr)
    assert.match(strictResult.stdout, /^42$/m)
    const strictConcurrent = await Promise.all(
      [11, 22, 33].map((value) =>
        run(
          psql,
          [
            '-X',
            '--no-psqlrc',
            '-A',
            '-t',
            '-c',
            `SELECT pg_sleep(0.1), ${value}`,
          ],
          {
            ...commonEnvironment,
            PGHOST: '127.0.0.1',
            PGPORT: String(strictPort),
          },
        ),
      ),
    )
    assert.ok(
      strictConcurrent.every(({ code }) => code === 0),
      strictConcurrent.map(({ stderr }) => stderr).join('\n'),
    )
    assert.deepEqual(
      strictConcurrent.map(({ stdout }) => Number(stdout.trim().split('|')[1])),
      [11, 22, 33],
    )

    const strictAdmin = await strictPostmaster.createSession()
    await strictAdmin.exec("ALTER ROLE postgres PASSWORD 'strict-secret'")
    await writeFile(
      join(root, 'strict-success-data', 'pg_hba.conf'),
      'host all all 127.0.0.1/32 scram-sha-256\n',
    )
    const reload = await strictAdmin.query(
      'SELECT pg_reload_conf() AS reloaded',
    )
    assert.deepEqual(reload.rows, [{ reloaded: true }])
    const noPassword = await run(
      psql,
      ['-X', '--no-psqlrc', '-w', '-c', 'SELECT 1'],
      {
        ...commonEnvironment,
        PGHOST: '127.0.0.1',
        PGPORT: String(strictPort),
        PGPASSFILE: '/dev/null',
      },
    )
    assert.notEqual(noPassword.code, 0)
    assert.match(
      noPassword.stderr,
      /(?:no password supplied|password authentication failed)/,
    )
    const withPassword = await run(
      psql,
      ['-X', '--no-psqlrc', '-w', '-A', '-t', '-c', 'SELECT 8 * 8'],
      {
        ...commonEnvironment,
        PGHOST: '127.0.0.1',
        PGPORT: String(strictPort),
        PGPASSFILE: '/dev/null',
        PGPASSWORD: 'strict-secret',
      },
    )
    assert.equal(withPassword.code, 0, withPassword.stderr)
    assert.match(withPassword.stdout, /^64$/m)
    await strictAdmin.close()
    await strict.close()
    strict = undefined
    await strictPostmaster.shutdown('fast')
    strictPostmaster = undefined

    const strictSocketDirectory = join(root, 'strict-socket')
    await mkdir(strictSocketDirectory)
    strictPostmaster = await withTimeout(
      PGlitePostmaster.create({
        dataDir: `file://${join(root, 'strict-unix-data')}`,
        maxConnections: 4,
        sharedBuffers: '16MB',
        artifact: { wasm, glue, data },
        respectPostgresqlConfig: true,
        startParams: [
          '-c',
          'listen_addresses=',
          '-c',
          `port=${strictPort}`,
          '-c',
          `unix_socket_directories=${strictSocketDirectory}`,
          '-c',
          'unix_socket_permissions=0750',
        ],
      }),
      60_000,
      'strict Unix postmaster startup',
    )
    strict = await PGliteServer.create({
      postmaster: strictPostmaster,
      mode: 'postgres',
    })
    const strictSocketPath = join(
      strictSocketDirectory,
      `.s.PGSQL.${strictPort}`,
    )
    assert.deepEqual(strict.addresses, [
      {
        transport: 'unix',
        path: strictSocketPath,
        directory: strictSocketDirectory,
        port: strictPort,
        lockPath: `${strictSocketPath}.lock`,
      },
    ])
    assert.equal((await stat(strictSocketPath)).mode & 0o777, 0o750)
    await access(`${strictSocketPath}.lock`)
    assert.equal((await stat(`${strictSocketPath}.lock`)).mode & 0o777, 0o600)
    const strictUnixResult = await runUntilSuccess(
      psql,
      ['-X', '--no-psqlrc', '-A', '-t', '-c', 'SELECT 7 * 6'],
      {
        ...commonEnvironment,
        PGHOST: strictSocketDirectory,
        PGPORT: String(strictPort),
      },
      30_000,
    )
    assert.equal(strictUnixResult.code, 0, strictUnixResult.stderr)
    assert.match(strictUnixResult.stdout, /^42$/m)

    const strictUnixAdmin = await strictPostmaster.createSession()
    await strictUnixAdmin.exec("ALTER ROLE postgres PASSWORD 'local-secret'")
    await writeFile(
      join(root, 'strict-unix-data', 'pg_hba.conf'),
      'local all all scram-sha-256\n',
    )
    const strictUnixReload = await strictUnixAdmin.query(
      'SELECT pg_reload_conf() AS reloaded',
    )
    assert.deepEqual(strictUnixReload.rows, [{ reloaded: true }])
    const strictUnixNoPassword = await run(
      psql,
      ['-X', '--no-psqlrc', '-w', '-c', 'SELECT 1'],
      {
        ...commonEnvironment,
        PGHOST: strictSocketDirectory,
        PGPORT: String(strictPort),
        PGPASSFILE: '/dev/null',
      },
    )
    assert.notEqual(strictUnixNoPassword.code, 0)
    assert.match(
      strictUnixNoPassword.stderr,
      /(?:no password supplied|password authentication failed)/,
    )
    const strictUnixWithPassword = await run(
      psql,
      ['-X', '--no-psqlrc', '-w', '-A', '-t', '-c', 'SELECT 9 * 9'],
      {
        ...commonEnvironment,
        PGHOST: strictSocketDirectory,
        PGPORT: String(strictPort),
        PGPASSFILE: '/dev/null',
        PGPASSWORD: 'local-secret',
      },
    )
    assert.equal(strictUnixWithPassword.code, 0, strictUnixWithPassword.stderr)
    assert.match(strictUnixWithPassword.stdout, /^81$/m)
    await strictUnixAdmin.close()
    await strict.close()
    strict = undefined
    await assert.rejects(access(strictSocketPath))
    await assert.rejects(access(`${strictSocketPath}.lock`))
    await strictPostmaster.shutdown('fast')
    strictPostmaster = undefined

    console.log('Native TCP/Unix socket frontend test: PASS')
  } finally {
    if (occupied) {
      await new Promise((resolveClose) => occupied.close(() => resolveClose()))
    }
    await strict?.close().catch(() => undefined)
    await strictPostmaster?.shutdown('immediate').catch(() => undefined)
    await owned?.close({ mode: 'immediate' }).catch(() => undefined)
    await tcp?.close().catch(() => undefined)
    await unix?.close().catch(() => undefined)
    await postmaster?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('port probe did not return a TCP address')
  }
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) =>
      error ? rejectClose(error) : resolveClose(undefined),
    ),
  )
  return address.port
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
